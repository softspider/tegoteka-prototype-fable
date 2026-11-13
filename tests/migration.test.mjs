// Данные первой итерации (созданы кодом 5669829) остаются доступны после обновления.
// Проверка идёт на отдельной копии каталога tests/fixtures/iteration-1-data.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/server.mjs';
import { DEMO_MEDIA } from '../shared/demo.mjs';
import { createIndex, selectionOf, ownItemsOf } from '../shared/model.mjs';
import { cleanDisplay, cleanNumber, DEFAULT_LIMIT, DEFAULT_PAGE_SIZE, LIMIT_RANGE, PAGE_SIZE_RANGE } from '../shared/display.mjs';

const FIXTURE = path.resolve('tests/fixtures/iteration-1-data');
const sha = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

test('копия данных первой итерации открывается новой версией без преобразования и без потерь', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tegoteka-migration-'));
  try {
    await fs.cp(FIXTURE, dataDir, { recursive: true });
    const original = JSON.parse(await fs.readFile(path.join(FIXTURE, 'app.json'), 'utf8')).lastWorkspaceId;
    const before = await fs.readFile(path.join(FIXTURE, 'workspaces', original, 'workspace.json'), 'utf8');

    const server = await startServer({ port: 0, dataDir });
    const call = async (method, url, body) => {
      const response = await fetch(new URL(url, server.url), {
        method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.clone().json().catch(() => null), response };
    };
    try {
      const list = (await call('GET', '/api/workspaces')).data;
      assert.equal(list.lastId, original, 'последняя область восстановлена');
      assert.deepEqual(list.workspaces.map((w) => [w.name, w.items, w.unmarked, w.tags]), [['Данные первой итерации', 16, 2, 20]]);

      const { workspace, state } = (await call('GET', `/api/workspaces/${original}`)).data;
      assert.deepEqual(workspace, JSON.parse(before), 'элементы, теги и разметка отданы как сохранены');
      const index = createIndex(workspace);
      const id = (name) => index.tagByName.get(name).id;
      assert.equal(index.tagByName.get('эскиз').description, 'Рисунок от руки');
      assert.equal(index.tagByName.get('итерация_1').description, 'Данные до обновления');
      assert.equal(selectionOf(index, [id('ремонт')]).length, 7);
      assert.equal(ownItemsOf(index, [id('ремонт'), id('итерация_1')]).length, 1);

      // Состояние просмотра прежнего формата: узел, история, состав и сортировка сохранены,
      // недостающие параметры второй итерации получают начальные значения.
      assert.deepEqual(state.history.entries[state.history.index], [id('ремонт'), id('кухня')]);
      assert.deepEqual(state.view, { mode: 'selection', sort: 'title' });
      assert.equal(state.settings.remindOnContentChange, false);
      assert.equal(cleanDisplay(state.view.display), 'limit');
      assert.equal(cleanNumber(state.settings.limit, LIMIT_RANGE, DEFAULT_LIMIT), 12);
      assert.equal(cleanNumber(state.settings.pageSize, PAGE_SIZE_RANGE, DEFAULT_PAGE_SIZE), 10);

      // Файлы содержания совпадают с исходными примерами байт в байт.
      for (const media of DEMO_MEDIA) {
        const item = workspace.items.find((candidate) => candidate.title === media.title);
        const served = await call('GET', `/api/workspaces/${original}/files/${item.content.fileId}`);
        assert.equal(served.status, 200);
        const bytes = Buffer.from(await served.response.arrayBuffer());
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), await sha(path.join('demo-media', media.file)), media.file);
      }

      // Новая версия продолжает работу с теми же данными: изменение и состояние нового формата.
      const added = await call('POST', `/api/workspaces/${original}/ops`, {
        type: 'createItem', title: 'Запись второй итерации', content: { kind: 'text', text: 'Добавлено после обновления' }, tags: ['ремонт'],
      });
      assert.equal(added.status, 200);
      const saved = await call('PUT', `/api/workspaces/${original}/state`, { rev: Date.now(), ...state, view: { ...state.view, display: 'pages' } });
      assert.equal(saved.data.saved, true);
    } finally {
      await server.close();
    }

    const after = JSON.parse(await fs.readFile(path.join(dataDir, 'workspaces', original, 'workspace.json'), 'utf8'));
    assert.equal(after.format, 1, 'формат файла рабочей области не изменён');
    assert.equal(after.items.length, 17);
    assert.deepEqual(after.items.slice(0, 16), JSON.parse(before).items, 'прежние элементы не затронуты');
    assert.equal(await fs.readFile(path.join(FIXTURE, 'workspaces', original, 'workspace.json'), 'utf8'), before, 'исходные данные не тронуты');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
