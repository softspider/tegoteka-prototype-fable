// Правила обозримости: предел количества, страницы, крайние позиции.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideDisplay, pageSlice, pageCount, edgeSlice, cleanNumber, cleanDisplay, LIMIT_RANGE, EDGE_COUNT,
} from '../shared/display.mjs';
import { sortItems, selectionOf, ownItemsOf } from '../shared/model.mjs';
import { demo } from './helpers.mjs';

test('предел количества: при N элементах показаны все, при N+1 — скрыты', () => {
  assert.equal(decideDisplay({ display: 'limit', count: 4, limit: 4 }), 'all');
  assert.equal(decideDisplay({ display: 'limit', count: 5, limit: 4 }), 'hidden');
  assert.equal(decideDisplay({ display: 'limit', count: 1, limit: 1 }), 'all');
});

test('скрытое множество отличается от пустого при любом способе показа', () => {
  for (const display of ['limit', 'fit', 'pages']) {
    assert.equal(decideDisplay({ display, count: 0, limit: 1, fits: false }), 'empty');
  }
  assert.equal(decideDisplay({ display: 'limit', count: 2, limit: 1 }), 'hidden');
  assert.equal(decideDisplay({ display: 'fit', count: 2, limit: 100, fits: false }), 'hidden');
});

test('вместимость экрана: решение следует за измерением, а не за пределом', () => {
  assert.equal(decideDisplay({ display: 'fit', count: 50, limit: 1, fits: true }), 'all');
  assert.equal(decideDisplay({ display: 'fit', count: 1, limit: 100, fits: false }), 'hidden');
  assert.equal(decideDisplay({ display: 'fit', count: 1, limit: 100, fits: null }), 'measuring');
});

test('постраничный просмотр доступен независимо от численности', () => {
  assert.equal(decideDisplay({ display: 'pages', count: 1, limit: 100 }), 'pages');
  assert.equal(decideDisplay({ display: 'pages', count: 10_000, limit: 1 }), 'pages');
});

test('страницы охватывают множество без пропусков и повторов и соблюдают сортировку', () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  for (const size of [1, 4, 10, 23, 50]) {
    const seen = [];
    const pages = pageCount(items.length, size);
    for (let page = 0; page < pages; page++) {
      const slice = pageSlice(items, page, size);
      assert.equal(slice.pages, pages);
      assert.equal(slice.from, seen.length + 1);
      seen.push(...slice.items);
      assert.equal(slice.to, seen.length);
    }
    assert.deepEqual(seen, items, `размер страницы ${size}`);
  }
  // Неполная последняя страница и номер за пределами.
  assert.deepEqual(pageSlice(items, 2, 10).items, [20, 21, 22]);
  assert.equal(pageSlice(items, 99, 10).page, 2);
  assert.equal(pageSlice(items, -5, 10).page, 0);
  assert.deepEqual(pageSlice([], 0, 10), { items: [], page: 0, pages: 1, from: 0, to: 0, total: 0 });
});

test('крайние позиции — первые и последние элементы текущей сортировки', () => {
  const d = demo();
  const selection = selectionOf(d.index, []);
  const byTime = sortItems(selection, 'time');
  assert.deepEqual(edgeSlice(byTime, 'first', 3).map((item) => item.title), ['Анна', 'Игорь', null]);
  assert.deepEqual(edgeSlice(byTime, 'last', 3).map((item) => item.title), ['Кухня', 'Ремонт', 'Общее']);
  // По названию: одинаковые названия — недавно изменённый первым, без названия — в конце.
  const byTitle = sortItems(selection, 'title');
  assert.deepEqual(edgeSlice(byTitle, 'last', 4).map((item) => item.content.text ?? item.title),
    ['План электрики при ремонте кухни', 'Подготовить ремонт', 'Срочно согласовать бюджет ремонта кухни', 'Полить сад']);
  assert.equal(edgeSlice(byTitle, 'first').length, EDGE_COUNT);
  assert.equal(edgeSlice(byTitle, 'first', 50).length, 9);
});

test('скрытие не меняет состав выборки и собственных элементов', () => {
  const d = demo();
  const node = d.ids('ремонт');
  const selection = selectionOf(d.index, node);
  assert.equal(decideDisplay({ display: 'limit', count: selection.length, limit: 3 }), 'hidden');
  assert.equal(selection.length, 4);
  // Собственных элементов мало, а выборка больше предела.
  assert.equal(decideDisplay({ display: 'limit', count: ownItemsOf(d.index, node).length, limit: 3 }), 'all');
});

test('значения настроек приводятся к допустимым границам', () => {
  assert.equal(cleanNumber('15', LIMIT_RANGE, 12), 15);
  assert.equal(cleanNumber(0, LIMIT_RANGE, 12), 1);
  assert.equal(cleanNumber(10_000, LIMIT_RANGE, 12), 200);
  assert.equal(cleanNumber('много', LIMIT_RANGE, 12), 12);
  assert.equal(cleanNumber(undefined, LIMIT_RANGE, 12), 12);
  assert.equal(cleanDisplay('pages'), 'pages');
  assert.equal(cleanDisplay('что-то'), 'limit');
});
