// Хранилище на диске: каталог данных с рабочими областями.
//
//   <data>/app.json                      — последняя открытая рабочая область
//   <data>/workspaces/<id>/workspace.json — элементы, теги и описания
//   <data>/workspaces/<id>/state.json     — узел, история, режим, сортировка, настройки
//   <data>/workspaces/<id>/files/<fileId> — файлы содержания элементов

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { applyOp, emptyWorkspace, OpError } from '../shared/ops.mjs';
import { fillDemo, fillDiagnostic, DEMO_MEDIA } from '../shared/demo.mjs';

const WORKSPACE_ID = /^w[0-9a-f]{10}$/;
const FILE_ID = /^f[0-9a-f]{16}$/;

export const PRESETS = ['empty', 'demo', 'demo-media', 'diagnostic'];

export class StoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Записи одного файла выполняются по очереди, каждая — через собственный
// временный файл: параллельные сохранения не мешают друг другу, а файл на
// диске всегда целый.
const writeQueues = new Map();
let temporaryCounter = 0;

function writeJsonAtomic(file, value, pretty) {
  const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  const write = async () => {
    temporaryCounter += 1;
    const temporary = `${file}.${process.pid}.${temporaryCounter}.tmp`;
    try {
      await fsp.writeFile(temporary, text);
      await fsp.rename(temporary, file);
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
  };
  const result = (writeQueues.get(file) ?? Promise.resolve()).then(write);
  const tail = result.catch(() => {});
  writeQueues.set(file, tail);
  tail.then(() => {
    if (writeQueues.get(file) === tail) writeQueues.delete(file);
  });
  return result;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export class Store {
  constructor({ dataDir, mediaDir, maxFileBytes }) {
    this.dataDir = dataDir;
    this.mediaDir = mediaDir;
    this.maxFileBytes = maxFileBytes;
    this.root = path.join(dataDir, 'workspaces');
    this.cache = new Map();
    this.queues = new Map();
    this.stateRevisions = new Map();
  }

  async init() {
    await fsp.mkdir(this.root, { recursive: true });
  }

  dir(id) {
    if (!WORKSPACE_ID.test(id)) throw new StoreError(404, 'workspace_missing', 'Рабочая область не найдена.');
    return path.join(this.root, id);
  }

  filePath(id, fileId) {
    if (!FILE_ID.test(fileId)) throw new StoreError(404, 'file_missing', 'Файл не найден.');
    return path.join(this.dir(id), 'files', fileId);
  }

  /** Выполняет действия с одним ключом (рабочей областью, её состоянием) строго по очереди. */
  enqueue(key, action) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(action, action);
    const tail = next.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return next;
  }

  async load(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const dir = this.dir(id);
    const ws = await readJson(path.join(dir, 'workspace.json'), null);
    if (!ws) throw new StoreError(404, 'workspace_missing', 'Рабочая область не найдена.');
    await this.removeOrphanFiles(id, ws);
    // Временные файлы, оставшиеся от прерванной записи.
    for (const name of await fsp.readdir(dir)) {
      if (name.endsWith('.tmp')) await fsp.rm(path.join(dir, name), { force: true });
    }
    this.cache.set(id, ws);
    return ws;
  }

  /** Удаляет загруженные, но не сохранённые в элементах файлы. */
  async removeOrphanFiles(id, ws) {
    const used = new Set();
    for (const item of ws.items) if (item.content.kind === 'file') used.add(item.content.fileId);
    const filesDir = path.join(this.dir(id), 'files');
    for (const name of await fsp.readdir(filesDir).catch(() => [])) {
      if (!used.has(name)) await fsp.rm(path.join(filesDir, name), { force: true });
    }
  }

  async save(ws) {
    await writeJsonAtomic(path.join(this.dir(ws.id), 'workspace.json'), ws, ws.items.length <= 500);
  }

  summary(ws) {
    return {
      id: ws.id,
      name: ws.name,
      createdAt: ws.createdAt,
      items: ws.items.length,
      unmarked: ws.items.filter((item) => item.tags === null).length,
      tags: ws.tags.length,
    };
  }

  async list() {
    const summaries = [];
    for (const id of await fsp.readdir(this.root)) {
      if (!WORKSPACE_ID.test(id)) continue;
      try {
        summaries.push(this.summary(await this.load(id)));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
      }
    }
    summaries.sort((a, b) => a.createdAt - b.createdAt);
    const app = await readJson(path.join(this.dataDir, 'app.json'), {});
    return { workspaces: summaries, lastId: summaries.some((s) => s.id === app.lastWorkspaceId) ? app.lastWorkspaceId : null };
  }

  /** Запоминает последнюю открытую рабочую область. */
  async setLast(id) {
    this.dir(id);
    await writeJsonAtomic(path.join(this.dataDir, 'app.json'), { lastWorkspaceId: id }, true);
  }

  async create({ name, preset = 'empty', options }) {
    if (!PRESETS.includes(preset)) throw new StoreError(400, 'bad_preset', 'Неизвестная заготовка рабочей области.');
    const title = String(name ?? '').trim().slice(0, 80);
    if (!title) throw new StoreError(400, 'bad_name', 'Укажите название рабочей области.');
    const id = `w${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    const ws = emptyWorkspace({ id, name: title, now });
    await fsp.mkdir(path.join(this.dir(id), 'files'), { recursive: true });

    if (preset === 'demo' || preset === 'demo-media') fillDemo(ws, now);
    if (preset === 'demo-media') await this.addDemoMedia(ws, now);
    if (preset === 'diagnostic') fillDiagnostic(ws, now, sanitizeDiagnosticOptions(options));
    ws.version = 0;

    await this.save(ws);
    this.cache.set(id, ws);
    return this.summary(ws);
  }

  async addDemoMedia(ws, now) {
    let clock = now - 3_600_000;
    for (const media of DEMO_MEDIA) {
      const source = path.join(this.mediaDir, media.file);
      const fileId = newFileId();
      await fsp.copyFile(source, this.filePath(ws.id, fileId));
      const { size } = await fsp.stat(source);
      clock += 60_000;
      applyOp(ws, {
        type: 'createItem',
        title: media.title,
        content: { kind: 'file', fileId, name: media.name, mime: media.mime, size },
        tags: media.tags,
      }, { now: () => clock, hasFile: () => true });
    }
  }

  async rename(id, name) {
    const title = String(name ?? '').trim().slice(0, 80);
    if (!title) throw new StoreError(400, 'bad_name', 'Укажите название рабочей области.');
    return this.enqueue(id, async () => {
      const ws = await this.load(id);
      ws.name = title;
      await this.save(ws);
      return this.summary(ws);
    });
  }

  async remove(id) {
    return this.enqueue(id, async () => {
      const dir = this.dir(id);
      this.cache.delete(id);
      this.stateRevisions.delete(id);
      await fsp.rm(dir, { recursive: true, force: true });
    });
  }

  async open(id) {
    const ws = await this.load(id);
    // Запись последней области ставится в очередь сразу: порядок записей следует порядку открытий.
    const remembered = this.setLast(id);
    remembered.catch(() => {});
    const state = await readJson(path.join(this.dir(id), 'state.json'), {});
    await remembered;
    return { workspace: ws, state };
  }

  /**
   * Сохраняет состояние просмотра. state.rev — отметка времени клиента:
   * более старое состояние, пришедшее позже, не заменяет более новое.
   */
  async saveState(id, state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new StoreError(400, 'bad_state', 'Состояние просмотра задано неверно.');
    }
    await this.load(id);
    return this.enqueue(`${id}:state`, async () => {
      const file = path.join(this.dir(id), 'state.json');
      let known = this.stateRevisions.get(id);
      if (known === undefined) known = Number((await readJson(file, {})).rev) || 0;
      const rev = Number(state.rev) || 0;
      if (rev < known) return { saved: false, rev: known };
      await writeJsonAtomic(file, state, true);
      this.stateRevisions.set(id, rev);
      return { saved: true, rev };
    });
  }

  /** Применяет одну операцию и сохраняет рабочую область. */
  async apply(id, op) {
    return this.enqueue(id, async () => {
      const ws = await this.load(id);
      const env = { now: () => Date.now(), hasFile: (fileId) => FILE_ID.test(fileId) && fs.existsSync(this.filePath(id, fileId)) };
      let outcome;
      try {
        outcome = applyOp(ws, op, env);
      } catch (error) {
        if (error instanceof OpError) throw new StoreError(422, error.code, error.message);
        this.cache.delete(id);
        throw error;
      }
      try {
        await this.save(ws);
      } catch (error) {
        this.cache.delete(id);
        throw error;
      }
      for (const fileId of outcome.releasedFiles) {
        await fsp.rm(this.filePath(id, fileId), { force: true });
      }
      return { version: ws.version, patch: outcome.patch, result: outcome.result };
    });
  }

  /** Сохраняет загружаемый файл; элемент ссылается на него последующей операцией. */
  async stageFile(id, stream) {
    await this.load(id);
    const fileId = newFileId();
    const target = this.filePath(id, fileId);
    const temporary = `${target}.part`;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let size = 0;
    const limit = this.maxFileBytes;
    const counter = new Transform({
      transform(chunk, encoding, done) {
        size += chunk.length;
        if (size > limit) done(new StoreError(413, 'file_too_large', `Файл больше ${Math.round(limit / 1048576)} МБ.`));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(stream, counter, fs.createWriteStream(temporary));
      await fsp.rename(temporary, target);
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
    return { fileId, size };
  }

  /** Сведения о файле сохранённого элемента. */
  async fileInfo(id, fileId) {
    const ws = await this.load(id);
    const file = this.filePath(id, fileId);
    for (const item of ws.items) {
      if (item.content.kind === 'file' && item.content.fileId === fileId) {
        const { size } = await fsp.stat(file);
        return { path: file, size, name: item.content.name, mime: item.content.mime };
      }
    }
    throw new StoreError(404, 'file_missing', 'Файл не найден.');
  }
}

function newFileId() {
  return `f${crypto.randomBytes(8).toString('hex')}`;
}

function sanitizeDiagnosticOptions(options = {}) {
  const clean = {};
  const integer = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : undefined);
  const seed = integer(options.seed, 0, 0xffffffff);
  const items = integer(options.items, 1, 200_000);
  const tags = integer(options.tags, 1, 2000);
  if (seed !== undefined) clean.seed = seed;
  if (items !== undefined) clean.items = items;
  if (tags !== undefined) clean.tags = tags;
  return clean;
}
