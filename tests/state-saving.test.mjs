// Сохранение состояния просмотра и последней области при параллельных записях.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { startServer } from '../server/server.mjs';

async function tempStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tegoteka-state-'));
  const store = new Store({ dataDir, mediaDir: path.resolve('demo-media'), maxFileBytes: 1024 * 1024 });
  await store.init();
  return { dataDir, store, cleanup: () => fs.rm(dataDir, { recursive: true, force: true }) };
}

const stateOf = (n) => ({ rev: n, history: { entries: [[], [`t${n}`]], index: 1 }, view: { mode: 'selection', sort: 'title', display: 'pages' }, settings: { limit: n } });

async function leftovers(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { recursive: true })) if (entry.endsWith('.tmp')) found.push(entry);
  return found;
}

test('20 одновременных сохранений состояния: все успешны, файл корректен, сохранено последнее', async () => {
  const { dataDir, store, cleanup } = await tempStore();
  try {
    const { id } = await store.create({ name: 'Параллельно', preset: 'demo' });
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => store.saveState(id, stateOf(i + 1))));
    assert.deepEqual(results.filter((result) => result.status === 'rejected').map((result) => result.reason.message), []);
    const file = path.join(dataDir, 'workspaces', id, 'state.json');
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), stateOf(20));
    assert.deepEqual(await leftovers(dataDir), [], 'временных файлов не осталось');
    // Повторное открытие отдаёт то же состояние.
    assert.deepEqual((await store.open(id)).state, stateOf(20));
  } finally {
    await cleanup();
  }
});

test('более старое состояние, пришедшее позже, не заменяет более новое', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const { id } = await store.create({ name: 'Порядок', preset: 'empty' });
    // Перекрывающиеся сохранения в обратном порядке отметок.
    const results = await Promise.all([5, 4, 3, 2, 1].map((n) => store.saveState(id, stateOf(n))));
    assert.deepEqual(results.map((result) => result.saved), [true, false, false, false, false]);
    assert.deepEqual((await store.open(id)).state, stateOf(5));
    assert.equal((await store.saveState(id, stateOf(6))).saved, true);
    assert.deepEqual((await store.open(id)).state, stateOf(6));
  } finally {
    await cleanup();
  }
});

test('отметка сохранения читается с диска после перезапуска; состояние без отметки сохраняется', async () => {
  const { dataDir, store, cleanup } = await tempStore();
  try {
    const { id } = await store.create({ name: 'Перезапуск', preset: 'empty' });
    await store.saveState(id, stateOf(10));
    const reopened = new Store({ dataDir, mediaDir: path.resolve('demo-media'), maxFileBytes: 1024 });
    await reopened.init();
    assert.equal((await reopened.saveState(id, stateOf(9))).saved, false);
    assert.deepEqual((await reopened.open(id)).state, stateOf(10));
    assert.equal((await reopened.saveState(id, stateOf(11))).saved, true);

    // Состояние первой итерации отметки не имеет.
    const legacy = await store.create({ name: 'Без отметки', preset: 'empty' });
    const old = { history: { entries: [[]], index: 0 }, view: { mode: 'own', sort: 'time' } };
    assert.equal((await store.saveState(legacy.id, old)).saved, true);
    assert.deepEqual((await store.open(legacy.id)).state, old);
  } finally {
    await cleanup();
  }
});

test('одновременное открытие областей: запись последней области не ломается', async () => {
  const { dataDir, store, cleanup } = await tempStore();
  try {
    const a = await store.create({ name: 'А', preset: 'demo' });
    const b = await store.create({ name: 'Б', preset: 'empty' });
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => store.open(i % 2 ? a.id : b.id)));
    assert.deepEqual(results.filter((result) => result.status === 'rejected').map((result) => result.reason.message), []);
    const app = JSON.parse(await fs.readFile(path.join(dataDir, 'app.json'), 'utf8'));
    assert.equal(app.lastWorkspaceId, a.id, 'запомнена область из последнего по порядку открытия');
    assert.equal((await store.list()).lastId, a.id);
    await store.open(b.id);
    assert.equal((await store.list()).lastId, b.id);
    // Перекрытие двух путей записи: состояние и последняя область одновременно.
    const mixed = await Promise.allSettled([
      ...Array.from({ length: 10 }, (_, i) => store.saveState(a.id, stateOf(i + 1))),
      ...Array.from({ length: 10 }, () => store.open(a.id)),
      ...Array.from({ length: 10 }, (_, i) => store.setLast(i % 2 ? a.id : b.id)),
    ]);
    assert.equal(mixed.filter((result) => result.status === 'rejected').length, 0);
    assert.deepEqual((await store.open(a.id)).state, stateOf(10));
    assert.deepEqual(await leftovers(dataDir), []);
  } finally {
    await cleanup();
  }
});

test('через HTTP: 20 одновременных запросов сохранения успешны, после перезапуска — актуальное состояние', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tegoteka-state-'));
  try {
    let server = await startServer({ port: 0, dataDir });
    const call = (method, url, body) => fetch(new URL(url, server.url), {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const { workspace } = await (await call('POST', '/api/workspaces', { name: 'HTTP', preset: 'demo' })).json();
    const url = `/api/workspaces/${workspace.id}/state`;
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => call('PUT', url, stateOf(i + 1))));
    assert.deepEqual(responses.map((response) => response.status), Array(20).fill(200));
    // Быстрые последовательные изменения.
    for (let n = 21; n <= 40; n++) assert.equal((await call('PUT', url, stateOf(n))).status, 200);
    assert.equal((await call('PUT', url, 'не объект')).status, 400);
    await server.close();

    server = await startServer({ port: 0, dataDir });
    const reopened = await (await call('GET', `/api/workspaces/${workspace.id}`)).json();
    assert.deepEqual(reopened.state, stateOf(40));
    assert.equal(reopened.workspace.items.length, 10, 'содержание элементов не затронуто');
    await server.close();
    assert.deepEqual(await leftovers(dataDir), []);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
