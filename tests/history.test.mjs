// История переходов.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory, currentNode, historyVisit, historyStep, historyCanStep, historyDropTag, restoreHistory,
} from '../shared/model.mjs';

const always = () => true;

test('назад, вперёд и новый переход после возврата', () => {
  let h = createHistory();
  h = historyVisit(h, ['a']);
  h = historyVisit(h, ['a', 'b']);
  h = historyVisit(h, ['c']);
  assert.equal(historyCanStep(h, 1, always), false);
  h = historyStep(h, -1, always);
  assert.deepEqual(currentNode(h), ['a', 'b']);
  h = historyStep(h, -1, always);
  assert.deepEqual(currentNode(h), ['a']);
  h = historyStep(h, 1, always);
  assert.deepEqual(currentNode(h), ['a', 'b']);
  // Движение по истории новых записей не добавляет.
  assert.equal(h.entries.length, 4);
  // Новый переход заменяет прежнее продолжение.
  h = historyVisit(h, ['d']);
  assert.deepEqual(h.entries, [[], ['a'], ['a', 'b'], ['d']]);
  assert.equal(historyCanStep(h, 1, always), false);
});

test('переход в текущий узел не добавляет посещения; узел может встречаться неоднократно', () => {
  let h = createHistory();
  h = historyVisit(h, ['a', 'b']);
  assert.equal(historyVisit(h, ['b', 'a']), h);
  h = historyVisit(h, []);
  h = historyVisit(h, ['a', 'b']);
  assert.equal(h.entries.length, 4);
});

test('удаление тега: текущий узел теряет тег, недоступные посещения пропускаются', () => {
  let h = createHistory();
  h = historyVisit(h, ['x']);
  h = historyVisit(h, ['a']);
  h = historyVisit(h, ['a', 'x']);
  const size = h.entries.length;
  h = historyDropTag(h, 'x');
  assert.deepEqual(currentNode(h), ['a']);
  assert.equal(h.entries.length, size);
  const available = (entry) => !entry.includes('x');
  // Предыдущее посещение — тот же узел {a}, перед ним недоступный {x}: назад ведёт в корень.
  h = historyStep(h, -1, available);
  assert.deepEqual(currentNode(h), []);
  assert.equal(historyCanStep(h, -1, available), false);
  h = historyStep(h, 1, available);
  assert.deepEqual(currentNode(h), ['a']);
});

test('восстановление сохранённой истории', () => {
  assert.deepEqual(restoreHistory(null, always), createHistory());
  const restored = restoreHistory({ entries: [[], ['a', 'gone']], index: 1 }, (id) => id !== 'gone');
  assert.deepEqual(currentNode(restored), ['a']);
  assert.deepEqual(restoreHistory({ entries: [['a']], index: 7 }, always).index, 0);
});
