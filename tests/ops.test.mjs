// Операции над данными: создание, изменение, замена содержания, теги.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OpError, applyPatch } from '../shared/ops.mjs';
import { selectionOf, ownItemsOf, neighborsOf, createIndex } from '../shared/model.mjs';
import { parseTagInput, normalizeTagName } from '../shared/tags.mjs';
import { demo, labels, transitionLabels } from './helpers.mjs';

const text = (value) => ({ kind: 'text', text: value });

test('E7 и E8 — разные элементы с пустым содержанием', () => {
  const d = demo();
  const [e7, e8] = [d.e(7), d.e(8)];
  assert.equal(e7.content.kind, 'empty');
  assert.equal(e8.content.kind, 'empty');
  assert.notEqual(e7.id, e8.id);
  d.op({ type: 'updateItem', id: e7.id, title: 'Игорь Артемьев' });
  assert.equal(d.e(8).title, 'Анна');
  d.op({ type: 'deleteItem', id: e7.id });
  assert.equal(d.e(7), null);
  assert.deepEqual(d.e(8).tags, d.ids('день_рождения', 'июнь', '10', 'анна'));
});

test('пустой набор тегов делает E9 собственным элементом корня', () => {
  const d = demo();
  assert.equal(selectionOf(d.index, []).length, 9);
  d.op({ type: 'updateItem', id: d.e(9).id, tags: [] });
  assert.deepEqual(d.e(9).tags, []);
  assert.equal(selectionOf(d.index, []).length, 10);
  assert.deepEqual(labels(d, ownItemsOf(d.index, [])), ['E0', 'E9']);
  assert.equal(d.index.unmarked.length, 0);
});

test('создание без разметки пополняет список неразмеченных и не меняет выборки', () => {
  const d = demo();
  d.op({ type: 'createItem', title: 'Быстрая', content: text('Без тегов'), tags: null });
  assert.equal(d.index.unmarked.length, 2);
  assert.equal(selectionOf(d.index, []).length, 9);
});

test('изменение названия или тегов сохраняет элемент, изменение содержания заменяет запись', () => {
  const d = demo();
  const e1 = d.e(1);
  d.op({ type: 'updateItem', id: e1.id, title: 'Ремонт квартиры', tags: ['ремонт', 'срочно'] });
  assert.equal(d.e(1).id, e1.id);
  assert.equal(d.e(1).content.text, 'Подготовить ремонт');

  const { result, patch } = d.op({ type: 'updateItem', id: e1.id, content: text('Подготовить ремонт кухни') });
  assert.equal(result.replacedId, e1.id);
  assert.notEqual(result.itemId, e1.id);
  assert.equal(d.e(1), null);
  assert.deepEqual(patch.removeItemIds, [e1.id]);
  const replacement = d.item(result.itemId);
  assert.equal(replacement.title, 'Ремонт квартиры');
  assert.deepEqual(replacement.tags, d.ids('ремонт', 'срочно'));
  assert.equal(d.ws.items.length, 10);
});

test('сохранение без изменений не обновляет время и не меняет идентификатор', () => {
  const d = demo();
  const e3 = d.e(3);
  const before = e3.modifiedAt;
  const { result } = d.op({ type: 'updateItem', id: e3.id, title: 'План', tags: ['электрика', 'кухня', 'ремонт'], content: text(e3.content.text) });
  assert.equal(result.changed, false);
  assert.equal(d.e(3).modifiedAt, before);
});

test('новый тег попадает в набор с описанием или без и остаётся после удаления элемента', () => {
  const d = demo();
  const { result } = d.op({
    type: 'createItem', title: 'Плитка', content: text('Выбрать плитку'),
    tags: ['ремонт', 'Плитка', 'ванная'], tagDescriptions: { плитка: 'Отделочный материал' },
  });
  const byName = Object.fromEntries(d.ws.tags.map((tag) => [tag.name, tag]));
  assert.equal(byName['плитка'].description, 'Отделочный материал');
  assert.equal(byName['ванная'].description, '');
  d.op({ type: 'deleteItem', id: result.itemId });
  assert.ok(d.ws.tags.some((tag) => tag.name === 'плитка'));
  assert.equal(d.index.usage.get(byName['плитка'].id) ?? 0, 0);
});

test('перемещение — замена разметки набором тегов указанного узла', () => {
  const d = demo();
  const e2 = d.e(2);
  d.op({ type: 'updateItem', id: e2.id, tags: ['ремонт', 'кухня'] });
  assert.equal(d.e(2).id, e2.id);
  assert.deepEqual(labels(d, ownItemsOf(d.index, d.ids('ремонт', 'кухня'))), ['E2']);
  assert.deepEqual(ownItemsOf(d.index, d.ids('кухня')), []);
});

test('переименование тега действует во всей области; занятое название отклоняется', () => {
  const d = demo();
  const [kitchen] = d.ids('кухня');
  const before = labels(d, selectionOf(d.index, [kitchen]));
  d.op({ type: 'renameTag', id: kitchen, name: 'Кухня-гостиная' });
  assert.equal(d.ws.tags.find((tag) => tag.id === kitchen).name, 'кухня-гостиная');
  assert.deepEqual(labels(d, selectionOf(d.index, d.ids('кухня-гостиная'))), before);
  assert.equal(d.index.tagByName.has('кухня'), false);

  const version = d.ws.version;
  assert.throws(() => d.op({ type: 'renameTag', id: kitchen, name: 'сад' }), (error) => error instanceof OpError && error.code === 'tag_exists');
  assert.equal(d.ws.tags.find((tag) => tag.id === kitchen).name, 'кухня-гостиная');
  assert.equal(d.ws.version, version);
});

test('удаление тега «ремонт»: четыре элемента сохраняются, E1 переходит в корень', () => {
  const d = demo();
  const [repair] = d.ids('ремонт');
  assert.equal(d.index.usage.get(repair), 4);
  const { result } = d.op({ type: 'deleteTag', id: repair });
  assert.equal(result.affected, 4);
  assert.equal(d.ws.items.length, 10);
  assert.equal(d.ws.tags.some((tag) => tag.name === 'ремонт'), false);
  assert.deepEqual(labels(d, ownItemsOf(d.index, [])), ['E0', 'E1']);
  assert.deepEqual(d.e(3).tags, d.ids('кухня', 'электрика'));
  assert.deepEqual(d.e(4).tags, d.ids('кухня', 'бюджет', 'срочно'));
  // Взаимный порядок затронутых элементов по времени сохраняется.
  const order = [1, 3, 4, 5].map((n) => d.e(n).modifiedAt);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('удаление элемента обновляет выборки и предлагаемые переходы', () => {
  const d = demo();
  const node = d.ids('ремонт', 'кухня');
  d.op({ type: 'deleteItem', id: d.e(3).id });
  assert.deepEqual(labels(d, selectionOf(d.index, node)), ['E4', 'E5']);
  // Без E3 узел E5 становится соседним заполненным потомком.
  assert.deepEqual(transitionLabels(d.index, neighborsOf(d.index, node).descendants, '+').sort(),
    ['+ бюджет срочно', '+ бюджет электрика']);
});

test('ошибочная операция не изменяет данные', () => {
  const d = demo();
  const snapshot = JSON.stringify(d.ws);
  assert.throws(() => d.op({ type: 'createItem', title: 'x', content: text('y'), tags: ['новый', 'плохой;тег'] }), OpError);
  assert.throws(() => d.op({ type: 'createItem', title: 'x', content: { kind: 'file', fileId: 'нет' }, tags: ['новый'] }), OpError);
  assert.throws(() => d.op({ type: 'updateItem', id: d.e(0).id, tags: null }), OpError);
  assert.throws(() => d.op({ type: 'deleteItem', id: 'нет' }), OpError);
  assert.throws(() => d.op({ type: 'addTag', name: 'сад' }), OpError);
  assert.equal(JSON.stringify(d.ws), snapshot);
});

test('замена файла освобождает прежний файл, текст из пробелов — пустое содержание', () => {
  const d = demo();
  d.files.add('f1').add('f2');
  const file = (fileId) => ({ kind: 'file', fileId, name: 'фото.png', mime: 'image/png', size: 10 });
  const created = d.op({ type: 'createItem', title: 'Фото', content: file('f1'), tags: ['сад'] });
  const replaced = d.op({ type: 'updateItem', id: created.result.itemId, content: file('f2') });
  assert.deepEqual(replaced.releasedFiles, ['f1']);
  assert.equal(d.item(replaced.result.itemId).content.fileId, 'f2');
  const removed = d.op({ type: 'deleteItem', id: replaced.result.itemId });
  assert.deepEqual(removed.releasedFiles, ['f2']);
  const blank = d.op({ type: 'createItem', title: 'Пусто', content: text('   \n'), tags: [] });
  assert.equal(d.item(blank.result.itemId).content.kind, 'empty');
});

test('результат операции воспроизводится на копии рабочей области', () => {
  const d = demo();
  const copy = structuredClone(d.ws);
  const steps = [
    { type: 'createItem', title: 'Новый', content: text('Текст'), tags: ['ремонт', 'новый_тег'] },
    { type: 'updateItem', id: d.e(1).id, content: text('Другое содержание') },
    { type: 'deleteItem', id: d.e(6).id },
    { type: 'renameTag', id: d.ids('кухня')[0], name: 'столовая' },
    { type: 'deleteTag', id: d.ids('бюджет')[0] },
  ];
  for (const step of steps) applyPatch(copy, structuredClone(d.op(step).patch));
  const view = (ws) => {
    const index = createIndex(ws);
    return {
      tags: ws.tags.map((tag) => `${tag.id}:${tag.name}`).sort(),
      items: ws.items.map((item) => `${item.id}:${item.title}:${item.tags?.join(',')}:${item.modifiedAt}`).sort(),
      filled: [...index.filled.keys()].sort(),
    };
  };
  assert.deepEqual(view(copy), view(d.ws));
});

test('разбор ввода тегов', () => {
  assert.deepEqual(parseTagInput('Ремонт, кухня;  ЭЛЕКТРИКА ремонт #срочно'), ['ремонт', 'кухня', 'электрика', 'срочно']);
  assert.equal(normalizeTagName('  День рождения '), 'день_рождения');
  assert.deepEqual(parseTagInput('  '), []);
});
