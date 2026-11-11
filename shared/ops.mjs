// Операции над рабочей областью. Каждая операция либо применяется целиком,
// либо отклоняется с ошибкой до любых изменений данных.
//
// applyOp(ws, op, env) изменяет ws на месте и возвращает
// { patch, result, releasedFiles }. env: { now(), hasFile(fileId) }.

import { normalizeTagName, tagNameError } from './tags.mjs';

export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_DESCRIPTION_LENGTH = 1000;

export class OpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function emptyWorkspace({ id, name, now }) {
  return { format: 1, id, name, createdAt: now, version: 0, seq: 0, clock: 0, tags: [], items: [] };
}

function nextTime(ws, env) {
  ws.clock = Math.max(env.now(), ws.clock + 1);
  return ws.clock;
}

function nextId(ws, prefix) {
  ws.seq += 1;
  return `${prefix}${ws.seq}`;
}

function newPatch() {
  return { upsertItems: [], removeItemIds: [], upsertTags: [], removeTagIds: [] };
}

function normalizeTitle(raw) {
  const title = String(raw ?? '').trim().replace(/\s+/gu, ' ');
  if (title.length > MAX_TITLE_LENGTH) throw new OpError('title_too_long', `Название длиннее ${MAX_TITLE_LENGTH} знаков.`);
  return title || null;
}

function normalizeDescription(raw) {
  const description = String(raw ?? '').trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new OpError('description_too_long', `Описание длиннее ${MAX_DESCRIPTION_LENGTH} знаков.`);
  }
  return description;
}

function normalizeContent(raw, env) {
  if (!raw || raw.kind === 'empty') return { kind: 'empty' };
  if (raw.kind === 'text') {
    const text = String(raw.text ?? '').replace(/\r\n?/g, '\n');
    if (text.length > MAX_TEXT_LENGTH) throw new OpError('text_too_long', `Текст длиннее ${MAX_TEXT_LENGTH} знаков.`);
    return text.trim() ? { kind: 'text', text } : { kind: 'empty' };
  }
  if (raw.kind === 'file') {
    const fileId = String(raw.fileId ?? '');
    if (!fileId || !env.hasFile(fileId)) throw new OpError('file_missing', 'Файл не найден: загрузите его заново.');
    return {
      kind: 'file',
      fileId,
      name: String(raw.name ?? 'файл').slice(0, 255),
      mime: String(raw.mime || 'application/octet-stream').slice(0, 127),
      size: Number(raw.size) || 0,
    };
  }
  throw new OpError('bad_content', 'Неизвестный вид содержания.');
}

function sameContent(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'text') return a.text === b.text;
  if (a.kind === 'file') return a.fileId === b.fileId;
  return true;
}

function sameTagSet(a, b) {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Проверяет названия и возвращает план: какие теги уже есть, какие будут созданы. */
function planTags(ws, names, descriptions) {
  if (!Array.isArray(names)) throw new OpError('bad_tags', 'Набор тегов задан неверно.');
  const byName = new Map(ws.tags.map((tag) => [tag.name, tag]));
  const plan = [];
  const seen = new Set();
  for (const raw of names) {
    const name = normalizeTagName(raw);
    const error = tagNameError(name);
    if (error) throw new OpError('bad_tag_name', error);
    if (seen.has(name)) continue;
    seen.add(name);
    const existing = byName.get(name);
    plan.push(existing ? { tag: existing } : { name, description: normalizeDescription(descriptions?.[name]) });
  }
  return plan;
}

/** Создаёт недостающие теги и возвращает идентификаторы в порядке ввода. */
function commitTags(ws, plan, patch) {
  return plan.map((entry) => {
    if (entry.tag) return entry.tag.id;
    const tag = { id: nextId(ws, 't'), name: entry.name, description: entry.description };
    ws.tags.push(tag);
    patch.upsertTags.push(tag);
    return tag.id;
  });
}

function findItem(ws, id) {
  const position = ws.items.findIndex((item) => item.id === id);
  if (position < 0) throw new OpError('item_missing', 'Элемент не найден: возможно, он уже удалён.');
  return position;
}

function findTag(ws, id) {
  const tag = ws.tags.find((candidate) => candidate.id === id);
  if (!tag) throw new OpError('tag_missing', 'Тег не найден: возможно, он уже удалён.');
  return tag;
}

function fileStillUsed(ws, fileId) {
  return ws.items.some((item) => item.content.kind === 'file' && item.content.fileId === fileId);
}

const handlers = {
  /** Создание элемента. tags: null — без разметки, массив названий — с разметкой. */
  createItem(ws, op, env, patch) {
    const title = normalizeTitle(op.title);
    const content = normalizeContent(op.content, env);
    const plan = op.tags === null || op.tags === undefined ? null : planTags(ws, op.tags, op.tagDescriptions);
    const time = nextTime(ws, env);
    const item = {
      id: nextId(ws, 'i'),
      title,
      content,
      tags: plan ? commitTags(ws, plan, patch) : null,
      createdAt: time,
      modifiedAt: time,
    };
    ws.items.push(item);
    patch.upsertItems.push(item);
    return { result: { itemId: item.id } };
  },

  /**
   * Изменение названия, разметки и содержания одним действием. Изменение
   * содержания заменяет запись новым элементом с новым идентификатором.
   */
  updateItem(ws, op, env, patch) {
    const position = findItem(ws, op.id);
    const item = ws.items[position];
    const title = op.title === undefined ? item.title : normalizeTitle(op.title);
    const content = op.content === undefined ? item.content : normalizeContent(op.content, env);
    let plan;
    if (op.tags === undefined) plan = undefined;
    else if (op.tags === null) {
      if (item.tags !== null) throw new OpError('bad_tags', 'Заданную разметку нельзя отменить; задайте пустой набор тегов.');
      plan = undefined;
    } else plan = planTags(ws, op.tags, op.tagDescriptions);

    const tags = plan ? commitTags(ws, plan, patch) : item.tags;
    const contentChanged = !sameContent(content, item.content);
    const titleChanged = title !== item.title;
    const tagsChanged = !sameTagSet(tags, item.tags);

    if (contentChanged) {
      const time = nextTime(ws, env);
      const replacement = { id: nextId(ws, 'i'), title, content, tags, createdAt: time, modifiedAt: time };
      ws.items[position] = replacement;
      patch.removeItemIds.push(item.id);
      patch.upsertItems.push(replacement);
      const releasedFiles = [];
      if (item.content.kind === 'file' && !fileStillUsed(ws, item.content.fileId)) releasedFiles.push(item.content.fileId);
      return { result: { itemId: replacement.id, replacedId: item.id }, releasedFiles };
    }

    item.tags = tags;
    if (titleChanged || tagsChanged) {
      item.title = title;
      item.modifiedAt = nextTime(ws, env);
    }
    patch.upsertItems.push(item);
    return { result: { itemId: item.id, changed: titleChanged || tagsChanged } };
  },

  deleteItem(ws, op, env, patch) {
    const position = findItem(ws, op.id);
    const [item] = ws.items.splice(position, 1);
    patch.removeItemIds.push(item.id);
    const releasedFiles = [];
    if (item.content.kind === 'file' && !fileStillUsed(ws, item.content.fileId)) releasedFiles.push(item.content.fileId);
    return { result: { itemId: item.id }, releasedFiles };
  },

  addTag(ws, op, env, patch) {
    const name = normalizeTagName(op.name);
    const error = tagNameError(name);
    if (error) throw new OpError('bad_tag_name', error);
    if (ws.tags.some((tag) => tag.name === name)) {
      throw new OpError('tag_exists', `Тег «${name}» уже есть в рабочей области.`);
    }
    const tag = { id: nextId(ws, 't'), name, description: normalizeDescription(op.description) };
    ws.tags.push(tag);
    patch.upsertTags.push(tag);
    return { result: { tagId: tag.id } };
  },

  describeTag(ws, op, env, patch) {
    const tag = findTag(ws, op.id);
    tag.description = normalizeDescription(op.description);
    patch.upsertTags.push(tag);
    return { result: { tagId: tag.id } };
  },

  /** Переименование во всей рабочей области; назначения элементам сохраняются. */
  renameTag(ws, op, env, patch) {
    const tag = findTag(ws, op.id);
    const name = normalizeTagName(op.name);
    const error = tagNameError(name);
    if (error) throw new OpError('bad_tag_name', error);
    if (name !== tag.name) {
      if (ws.tags.some((other) => other.name === name)) {
        throw new OpError('tag_exists', `Тег «${name}» уже есть в рабочей области. Выберите другое название.`);
      }
      tag.name = name;
    }
    patch.upsertTags.push(tag);
    return { result: { tagId: tag.id } };
  },

  /** Удаление тега из набора и из разметки элементов; сами элементы сохраняются. */
  deleteTag(ws, op, env, patch) {
    const tag = findTag(ws, op.id);
    const affected = ws.items
      .filter((item) => item.tags !== null && item.tags.includes(tag.id))
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
    for (const item of affected) {
      item.tags = item.tags.filter((id) => id !== tag.id);
      item.modifiedAt = nextTime(ws, env);
      patch.upsertItems.push(item);
    }
    ws.tags = ws.tags.filter((candidate) => candidate.id !== tag.id);
    patch.removeTagIds.push(tag.id);
    return { result: { tagId: tag.id, affected: affected.length } };
  },
};

export function applyOp(ws, op, env) {
  const handler = handlers[op?.type];
  if (!handler) throw new OpError('bad_op', 'Неизвестная операция.');
  const patch = newPatch();
  const { result, releasedFiles = [] } = handler(ws, op, env, patch);
  ws.version += 1;
  return { patch, result, releasedFiles };
}

/** Применяет результат операции к копии рабочей области в браузере. */
export function applyPatch(ws, patch) {
  if (patch.removeItemIds.length) {
    const removed = new Set(patch.removeItemIds);
    ws.items = ws.items.filter((item) => !removed.has(item.id));
  }
  if (patch.upsertItems.length) {
    const position = new Map(ws.items.map((item, i) => [item.id, i]));
    for (const item of patch.upsertItems) {
      const i = position.get(item.id);
      if (i === undefined) ws.items.push(item);
      else ws.items[i] = item;
    }
  }
  if (patch.removeTagIds.length) {
    const removed = new Set(patch.removeTagIds);
    ws.tags = ws.tags.filter((tag) => !removed.has(tag.id));
  }
  for (const tag of patch.upsertTags) {
    const i = ws.tags.findIndex((candidate) => candidate.id === tag.id);
    if (i < 0) ws.tags.push(tag);
    else ws.tags[i] = tag;
  }
}
