// Правила теговой модели на наборе E0–E9 из prototype/CHECKS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIndex, selectionOf, ownItemsOf, neighborsOf, suggestForNavigation, suggestForMarkup,
  sortItems, nodeKey, isAvailableNode,
} from '../shared/model.mjs';
import { demo, labels, transitionLabels } from './helpers.mjs';

test('исходный набор: десять элементов, один неразмеченный, тег «мечта» не используется', () => {
  const d = demo();
  const index = d.index;
  assert.equal(d.ws.items.length, 10);
  assert.deepEqual(index.unmarked.map((item) => item.title), ['Набросок']);
  assert.equal(index.usage.get(d.ids('мечта')[0]) ?? 0, 0);
  assert.equal(d.ws.tags.find((tag) => tag.name === 'бюджет').description, 'Планируемые расходы');
  const times = d.ws.items.map((item) => item.modifiedAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(new Set(times).size, 10);
});

test('корень: собственный элемент E0, выборка E0–E8', () => {
  const d = demo();
  assert.deepEqual(labels(d, ownItemsOf(d.index, [])), ['E0']);
  assert.deepEqual(labels(d, selectionOf(d.index, [])), ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
});

test('узел {ремонт}: собственный E1, выборка E1, E3, E4, E5', () => {
  const d = demo();
  const node = d.ids('ремонт');
  assert.deepEqual(labels(d, ownItemsOf(d.index, node)), ['E1']);
  assert.deepEqual(labels(d, selectionOf(d.index, node)), ['E1', 'E3', 'E4', 'E5']);
});

test('узел {ремонт, кухня}: собственных нет, выборка E3, E4, E5; порядок тегов не важен', () => {
  const d = demo();
  assert.deepEqual(ownItemsOf(d.index, d.ids('ремонт', 'кухня')), []);
  assert.deepEqual(labels(d, selectionOf(d.index, d.ids('кухня', 'ремонт'))), ['E3', 'E4', 'E5']);
  assert.equal(nodeKey(d.ids('ремонт', 'кухня')), nodeKey(d.ids('кухня', 'ремонт')));
});

test('узел {мечта}: нет собственных элементов и нет выборки, узел доступен', () => {
  const d = demo();
  const node = d.ids('мечта');
  assert.equal(isAvailableNode(d.index, node), true);
  assert.deepEqual(ownItemsOf(d.index, node), []);
  assert.deepEqual(selectionOf(d.index, node), []);
  assert.deepEqual(neighborsOf(d.index, node).descendants, []);
  assert.deepEqual(transitionLabels(d.index, neighborsOf(d.index, node).ancestors, '−'), ['− мечта']);
});

test('соседство для незаполненного узла {ремонт, кухня}', () => {
  const d = demo();
  const index = d.index;
  const { ancestors, descendants } = neighborsOf(index, d.ids('ремонт', 'кухня'));
  // Заполненный корень не соседний: между ним и узлом есть {ремонт} и {кухня}.
  assert.deepEqual(transitionLabels(index, ancestors, '−').sort(), ['− кухня', '− ремонт']);
  // Узел E5 не соседний: между ним и текущим находится заполненный узел E3.
  assert.deepEqual(transitionLabels(index, descendants, '+'), ['+ электрика', '+ бюджет срочно']);
  assert.deepEqual(descendants.map((t) => t.changed.length), [1, 2]);
  assert.deepEqual(descendants.map((t) => t.selection), [2, 1]);
  assert.deepEqual(descendants.map((t) => t.own), [1, 1]);
  assert.deepEqual(ancestors.map((t) => [t.selection, t.own]), [[4, 1], [4, 1]]);
  assert.equal(nodeKey(descendants[0].tagIds), nodeKey(d.ids('ремонт', 'кухня', 'электрика')));
});

test('корень: соседние потомки упорядочены по числу добавляемых тегов', () => {
  const d = demo();
  const index = d.index;
  const { ancestors, descendants } = neighborsOf(index, []);
  assert.deepEqual(ancestors, []);
  assert.deepEqual(transitionLabels(index, descendants, '+'), [
    '+ кухня', '+ ремонт', '+ сад', '+ 10 анна день_рождения июнь', '+ 5 артемьев день_рождения игорь май',
  ]);
});

test('добавление элемента в {ремонт, кухня} делает узел промежуточным, удаление возвращает соседство', () => {
  const d = demo();
  const repair = d.ids('ремонт');
  const before = transitionLabels(d.index, neighborsOf(d.index, repair).descendants, '+');
  assert.deepEqual(before, ['+ кухня электрика', '+ бюджет кухня срочно']);

  const { result } = d.op({ type: 'createItem', title: 'Новый', content: { kind: 'text', text: 'Общее о ремонте кухни' }, tags: ['ремонт', 'кухня'] });
  const node = d.ids('ремонт', 'кухня');
  assert.equal(ownItemsOf(d.index, node).length, 1);
  assert.equal(selectionOf(d.index, node).length, 4);
  assert.deepEqual(transitionLabels(d.index, neighborsOf(d.index, repair).descendants, '+'), ['+ кухня']);

  d.op({ type: 'deleteItem', id: result.itemId });
  assert.deepEqual(transitionLabels(d.index, neighborsOf(d.index, repair).descendants, '+'), before);
  assert.deepEqual(ownItemsOf(d.index, node), []);
});

test('автодополнение навигации учитывает выборку узла', () => {
  const d = demo();
  const index = d.index;
  const node = d.ids('ремонт', 'кухня');
  const names = (query) => suggestForNavigation(index, node, query).items.map((s) => s.tag.name);
  assert.deepEqual(names(''), ['бюджет', 'электрика', 'срочно']);
  assert.deepEqual(names('б'), ['бюджет']);
  assert.deepEqual(names('э'), ['электрика']);
  assert.deepEqual(names('с'), ['срочно']);
  assert.deepEqual(names('м'), []);
  assert.deepEqual(names('ре'), []);
  assert.deepEqual(suggestForNavigation(index, [], 'с').items.map((s) => s.tag.name), ['сад', 'срочно']);
  // При разметке доступны все теги рабочей области, кроме уже назначенных.
  assert.deepEqual(suggestForMarkup(index, node, 'м').items.map((s) => s.tag.name), ['май', 'мечта', 'артемьев']);
  assert.deepEqual(suggestForMarkup(index, node, 'ре').items.map((s) => s.tag.name), []);
});

test('сортировка: по времени — новые первыми; по названию — без названия в конце', () => {
  const d = demo();
  const selection = selectionOf(d.index, []);
  assert.deepEqual(sortItems(selection, 'time').map((item) => labels(d, [item])[0]),
    ['E8', 'E7', 'E6', 'E5', 'E4', 'E3', 'E2', 'E1', 'E0']);
  assert.deepEqual(sortItems(selection, 'title').map((item) => labels(d, [item])[0]),
    ['E8', 'E7', 'E2', 'E0', 'E5', 'E3', 'E1', 'E4', 'E6']);
});

test('изменение названия или разметки обновляет время последнего изменения', () => {
  const d = demo();
  const e0 = d.e(0);
  const before = e0.modifiedAt;
  d.op({ type: 'updateItem', id: e0.id, title: 'Общее (новое)' });
  assert.ok(d.e(0).modifiedAt > before);
  assert.equal(sortItems(selectionOf(d.index, []), 'time')[0].id, e0.id);
  const e1 = d.e(1);
  d.op({ type: 'updateItem', id: e1.id, tags: ['ремонт', 'сад'] });
  assert.equal(sortItems(selectionOf(d.index, []), 'time')[0].id, e1.id);
});

test('индекс работает при числе тегов больше 32', () => {
  const d = demo();
  const names = Array.from({ length: 70 }, (_, i) => `тег_${i}`);
  d.op({ type: 'createItem', title: 'Много', content: { kind: 'empty' }, tags: names });
  d.op({ type: 'createItem', title: 'Часть', content: { kind: 'empty' }, tags: [names[40], names[69]] });
  const index = createIndex(d.ws);
  assert.equal(selectionOf(index, d.ids(names[69])).length, 2);
  assert.equal(selectionOf(index, d.ids(names[33], names[69])).length, 1);
  assert.equal(neighborsOf(index, d.ids(names[69])).descendants.length, 1);
  assert.equal(neighborsOf(index, d.ids(names[69])).descendants[0].changed.length, 1);
});
