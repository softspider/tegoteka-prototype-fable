// Теговая модель: узлы, выборки, соседство заполненных узлов, автодополнение,
// сортировка и история переходов. Чистые функции без обращения к хранилищу.
//
// Рабочая область: { tags: [{id, name, description}], items: [{id, title,
// content, tags, modifiedAt}] }. У неразмеченного элемента tags === null,
// у размеченного — массив идентификаторов тегов (возможно, пустой).

const collator = new Intl.Collator('ru', { numeric: true });

export const COMPACT_TRANSITIONS = 6;

/** Ключ узла: не зависит от порядка тегов. */
export function nodeKey(tagIds) {
  return [...tagIds].sort().join(' ');
}

export function sameNode(a, b) {
  return a.length === b.length && nodeKey(a) === nodeKey(b);
}

function includes(big, small) {
  for (let i = 0; i < big.length; i++) {
    if ((big[i] & small[i]) !== small[i]) return false;
  }
  return true;
}

/** Строит индекс рабочей области. Перестраивается после каждого изменения данных. */
export function createIndex(ws) {
  const tagById = new Map();
  const tagByName = new Map();
  const bit = new Map();
  ws.tags.forEach((tag, i) => {
    tagById.set(tag.id, tag);
    tagByName.set(tag.name, tag);
    bit.set(tag.id, i);
  });
  const words = Math.max(1, Math.ceil(ws.tags.length / 32));

  const maskOf = (tagIds) => {
    const mask = new Int32Array(words);
    for (const id of tagIds) {
      const i = bit.get(id);
      if (i === undefined) return null;
      mask[i >> 5] |= 1 << (i & 31);
    }
    return mask;
  };

  const marked = [];
  const unmarked = [];
  const filled = new Map();
  const usage = new Map();
  for (const item of ws.items) {
    if (item.tags === null) {
      unmarked.push(item);
      continue;
    }
    const key = nodeKey(item.tags);
    let node = filled.get(key);
    if (!node) {
      node = { key, tagIds: [...item.tags], mask: maskOf(item.tags), size: item.tags.length, own: 0 };
      filled.set(key, node);
    }
    node.own += 1;
    marked.push({ item, mask: node.mask, key });
    for (const id of item.tags) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  return {
    tags: ws.tags,
    tagById,
    tagByName,
    maskOf,
    marked,
    unmarked,
    filled,
    filledList: [...filled.values()],
    usage,
    itemCount: ws.items.length,
    cache: new Map(),
  };
}

/** Все теги набора доступны в рабочей области. */
export function isAvailableNode(index, tagIds) {
  return tagIds.every((id) => index.tagById.has(id));
}

/** Выборка узла: размеченные элементы, которым назначены все теги набора. */
export function selectionOf(index, tagIds) {
  const mask = index.maskOf(tagIds);
  if (!mask) return [];
  const result = [];
  for (const entry of index.marked) {
    if (includes(entry.mask, mask)) result.push(entry.item);
  }
  return result;
}

/** Собственные элементы узла: разметка совпадает с набором тегов узла. */
export function ownItemsOf(index, tagIds) {
  const key = nodeKey(tagIds);
  if (!index.filled.has(key)) return [];
  const result = [];
  for (const entry of index.marked) {
    if (entry.key === key) result.push(entry.item);
  }
  return result;
}

export function isOwnItem(item, tagIds) {
  return item.tags !== null && sameNode(item.tags, tagIds);
}

function selectionSize(nodes, mask) {
  let total = 0;
  for (const node of nodes) {
    if (includes(node.mask, mask)) total += node.own;
  }
  return total;
}

function tagNames(index, tagIds) {
  return tagIds.map((id) => index.tagById.get(id)?.name ?? id);
}

function byName(index) {
  return (a, b) => collator.compare(index.tagById.get(a).name, index.tagById.get(b).name);
}

function byPriority(a, b) {
  return a.changed.length - b.changed.length || b.selection - a.selection || collator.compare(a.label, b.label);
}

/**
 * Соседние заполненные предки и потомки узла в порядке навигационного
 * приоритета. Каждый переход: { tagIds, changed, label, selection, own }.
 */
export function neighborsOf(index, tagIds) {
  const key = nodeKey(tagIds);
  const cached = index.cache.get(`n:${key}`);
  if (cached) return cached;

  const result = { ancestors: [], descendants: [] };
  const current = index.maskOf(tagIds);
  if (current) {
    const size = tagIds.length;
    const larger = [];
    const smaller = [];
    for (const node of index.filledList) {
      if (node.size > size) {
        if (includes(node.mask, current)) larger.push(node);
      } else if (node.size < size) {
        if (includes(current, node.mask)) smaller.push(node);
      }
    }

    // Потомки: минимальные по включению заполненные надмножества.
    larger.sort((a, b) => a.size - b.size);
    const minimal = [];
    for (const node of larger) {
      if (!minimal.some((m) => m.size < node.size && includes(node.mask, m.mask))) minimal.push(node);
    }
    const selected = new Set(tagIds);
    for (const node of minimal) {
      const changed = node.tagIds.filter((id) => !selected.has(id)).sort(byName(index));
      result.descendants.push({
        direction: 'down',
        tagIds: [...tagIds, ...changed],
        changed,
        label: tagNames(index, changed).join(' '),
        selection: selectionSize(larger, node.mask),
        own: node.own,
      });
    }

    // Предки: максимальные по включению заполненные подмножества.
    smaller.sort((a, b) => b.size - a.size);
    const maximal = [];
    for (const node of smaller) {
      if (!maximal.some((m) => m.size > node.size && includes(m.mask, node.mask))) maximal.push(node);
    }
    for (const node of maximal) {
      const kept = new Set(node.tagIds);
      const changed = tagIds.filter((id) => !kept.has(id)).sort(byName(index));
      result.ancestors.push({
        direction: 'up',
        tagIds: tagIds.filter((id) => kept.has(id)),
        changed,
        label: tagNames(index, changed).join(' '),
        selection: selectionSize(index.filledList, node.mask),
        own: node.own,
      });
    }

    result.descendants.sort(byPriority);
    result.ancestors.sort(byPriority);
  }

  index.cache.set(`n:${key}`, result);
  return result;
}

function rankMatch(name, query) {
  if (!query) return 0;
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return -1;
}

/**
 * Автодополнение при навигации: теги элементов выборки узла, которые ещё не
 * выбраны и соответствуют введённому тексту.
 */
export function suggestForNavigation(index, tagIds, query, limit = 12) {
  const key = nodeKey(tagIds);
  let frequency = index.cache.get(`f:${key}`);
  if (!frequency) {
    frequency = new Map();
    const selected = new Set(tagIds);
    for (const item of selectionOf(index, tagIds)) {
      for (const id of item.tags) {
        if (!selected.has(id)) frequency.set(id, (frequency.get(id) ?? 0) + 1);
      }
    }
    index.cache.set(`f:${key}`, frequency);
  }
  const matches = [];
  for (const [id, count] of frequency) {
    const tag = index.tagById.get(id);
    const rank = rankMatch(tag.name, query);
    if (rank >= 0) matches.push({ tag, count, rank });
  }
  matches.sort((a, b) => a.rank - b.rank || b.count - a.count || collator.compare(a.tag.name, b.tag.name));
  return { total: matches.length, items: matches.slice(0, limit) };
}

/** Автодополнение при разметке: все теги рабочей области, кроме уже назначенных. */
export function suggestForMarkup(index, excludeIds, query, limit = 12) {
  const excluded = new Set(excludeIds);
  const matches = [];
  for (const tag of index.tags) {
    if (excluded.has(tag.id)) continue;
    const rank = rankMatch(tag.name, query);
    if (rank >= 0) matches.push({ tag, count: index.usage.get(tag.id) ?? 0, rank });
  }
  matches.sort((a, b) => a.rank - b.rank || b.count - a.count || collator.compare(a.tag.name, b.tag.name));
  return { total: matches.length, items: matches.slice(0, limit) };
}

/** Сортировка: 'time' — недавно изменившиеся первыми; 'title' — по названию. */
export function sortItems(items, sort) {
  const recentFirst = (a, b) => b.modifiedAt - a.modifiedAt;
  const sorted = [...items];
  if (sort !== 'title') return sorted.sort(recentFirst);
  return sorted.sort((a, b) => {
    if (!a.title && !b.title) return recentFirst(a, b);
    if (!a.title) return 1;
    if (!b.title) return -1;
    return collator.compare(a.title, b.title) || recentFirst(a, b);
  });
}

export function sortTags(tags) {
  return [...tags].sort((a, b) => collator.compare(a.name, b.name));
}

// ---------- История переходов ----------

export const HISTORY_LIMIT = 200;

export function createHistory(tagIds = []) {
  return { entries: [[...tagIds]], index: 0 };
}

export function currentNode(history) {
  return history.entries[history.index];
}

/** Переход к узлу: прежнее продолжение истории заменяется этим переходом. */
export function historyVisit(history, tagIds) {
  if (sameNode(currentNode(history), tagIds)) return history;
  let entries = history.entries.slice(0, history.index + 1);
  entries.push([...tagIds]);
  if (entries.length > HISTORY_LIMIT) entries = entries.slice(entries.length - HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

function findStep(history, direction, isAvailable) {
  const here = nodeKey(currentNode(history));
  for (let i = history.index + direction; i >= 0 && i < history.entries.length; i += direction) {
    const entry = history.entries[i];
    if (isAvailable(entry) && nodeKey(entry) !== here) return i;
  }
  return -1;
}

export function historyCanStep(history, direction, isAvailable) {
  return findStep(history, direction, isAvailable) >= 0;
}

/** Назад (direction = -1) или вперёд (+1) к ближайшему доступному посещению. */
export function historyStep(history, direction, isAvailable) {
  const i = findStep(history, direction, isAvailable);
  return i < 0 ? history : { entries: history.entries, index: i };
}

/** Удаление тега из рабочей области: текущий узел теряет этот тег. */
export function historyDropTag(history, tagId) {
  const node = currentNode(history);
  if (!node.includes(tagId)) return history;
  const entries = [...history.entries];
  entries[history.index] = node.filter((id) => id !== tagId);
  return { entries, index: history.index };
}

/** Приводит сохранённую историю к актуальному набору тегов рабочей области. */
export function restoreHistory(saved, hasTag) {
  if (!saved || !Array.isArray(saved.entries) || saved.entries.length === 0) return createHistory();
  const entries = saved.entries
    .slice(-HISTORY_LIMIT)
    .map((entry) => (Array.isArray(entry) ? entry.filter((id) => typeof id === 'string') : []));
  const index = Math.min(Math.max(0, Number(saved.index) || 0), entries.length - 1);
  entries[index] = entries[index].filter(hasTag);
  return { entries, index };
}
