// Хранилище на диске и HTTP-интерфейс сервера: данные и файлы переживают перезапуск.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/server.mjs';

async function withServer(dataDir, action) {
  const server = await startServer({ port: 0, dataDir });
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'сервер слушает только локальный адрес');
  const call = async (method, url, body, headers) => {
    const response = await fetch(new URL(url, server.url), {
      method,
      headers: body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, data: await response.clone().json().catch(() => null), response };
  };
  try {
    return await action(call, server);
  } finally {
    await server.close();
  }
}

test('рабочая область, файл и состояние просмотра сохраняются между запусками', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tegoteka-store-'));
  try {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const ids = await withServer(dataDir, async (call) => {
      assert.deepEqual((await call('GET', '/api/workspaces')).data, { workspaces: [], lastId: null });
      const { data: created } = await call('POST', '/api/workspaces', { name: 'Копия набора', preset: 'demo' });
      const ws = created.workspace.id;
      assert.deepEqual([created.workspace.items, created.workspace.unmarked, created.workspace.tags], [10, 1, 15]);

      const upload = await call('POST', `/api/workspaces/${ws}/files`, bytes, {
        'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('данные.bin'),
      });
      assert.equal(upload.status, 201);
      assert.equal(upload.data.name, 'данные.bin');
      assert.equal(upload.data.size, 10);
      const saved = await call('POST', `/api/workspaces/${ws}/ops`, {
        type: 'createItem', title: 'Файл', content: { kind: 'file', ...upload.data }, tags: ['сад', 'архив'], tagDescriptions: { архив: 'Старые данные' },
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.version, 1);

      // Отклонённая операция ничего не меняет.
      const rejected = await call('POST', `/api/workspaces/${ws}/ops`, { type: 'renameTag', id: saved.data.patch.upsertTags[0].id, name: 'сад' });
      assert.equal(rejected.status, 422);
      assert.equal(rejected.data.error.code, 'tag_exists');

      const state = { history: { entries: [[], [saved.data.patch.upsertTags[0].id]], index: 1 }, view: { mode: 'selection', sort: 'title' } };
      assert.equal((await call('PUT', `/api/workspaces/${ws}/state`, state)).status, 200);
      await call('GET', `/api/workspaces/${ws}`);
      return { ws, fileId: upload.data.fileId, state };
    });

    await withServer(dataDir, async (call) => {
      const list = (await call('GET', '/api/workspaces')).data;
      assert.equal(list.lastId, ids.ws, 'запомнена последняя открытая рабочая область');
      const { data } = await call('GET', `/api/workspaces/${ids.ws}`);
      assert.equal(data.workspace.items.length, 11);
      assert.equal(data.workspace.version, 1);
      assert.equal(data.workspace.tags.find((tag) => tag.name === 'архив').description, 'Старые данные');
      assert.deepEqual(data.state, ids.state);

      const file = await call('GET', `/api/workspaces/${ids.ws}/files/${ids.fileId}`);
      assert.deepEqual(new Uint8Array(await file.response.arrayBuffer()), bytes, 'сохранён сам файл, байт в байт');
      assert.match(file.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''%D0%B4/);
      const range = await call('GET', `/api/workspaces/${ids.ws}/files/${ids.fileId}`, undefined, { Range: 'bytes=4-6' });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-range'), 'bytes 4-6/10');

      // Удаление элемента удаляет и его файл.
      const item = data.workspace.items.find((candidate) => candidate.title === 'Файл');
      await call('POST', `/api/workspaces/${ids.ws}/ops`, { type: 'deleteItem', id: item.id });
      assert.equal((await call('GET', `/api/workspaces/${ids.ws}/files/${ids.fileId}`)).status, 404);
      assert.deepEqual(await fs.readdir(path.join(dataDir, 'workspaces', ids.ws, 'files')), []);
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('сервер отклоняет посторонние адреса и выход за пределы каталогов', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tegoteka-store-'));
  try {
    await withServer(dataDir, async (call, server) => {
      assert.equal((await call('GET', '/api/workspaces/..%2F..%2Fetc')).status, 404);
      assert.equal((await call('GET', '/shared/..%2Fserver%2Fserver.mjs')).status, 404);
      assert.equal((await call('GET', '/shared/model.mjs')).status, 200);
      const foreign = await fetch(new URL('/api/workspaces', server.url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://example.com' }, body: '{"name":"x"}',
      });
      assert.equal(foreign.status, 403);
      assert.equal((await call('POST', '/api/workspaces', { name: 'x', preset: 'нет' })).status, 400);
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('диагностический набор воспроизводим', async () => {
  const { fillDiagnostic } = await import('../shared/demo.mjs');
  const { emptyWorkspace } = await import('../shared/ops.mjs');
  const build = (seed) => fillDiagnostic(emptyWorkspace({ id: 'w', name: 'д', now: 0 }), 1_000_000_000, { seed, items: 500 });
  const a = build(7);
  assert.deepEqual(a.items.map((item) => item.tags), build(7).items.map((item) => item.tags));
  assert.notDeepEqual(a.items.map((item) => item.tags), build(8).items.map((item) => item.tags));
  assert.equal(new Set(a.tags.map((tag) => tag.name)).size, 100);
  assert.ok(a.items.every((item) => item.tags.length >= 1 && item.tags.length <= 6 && new Set(item.tags).size === item.tags.length));
});
