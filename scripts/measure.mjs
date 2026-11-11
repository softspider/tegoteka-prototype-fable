// Диагностическая проверка объёма данных (prototype/CHECKS.md): строит
// воспроизводимый набор и измеряет отбор, получение переходов и автодополнение
// на уровне модели. Запуск: node scripts/measure.mjs [--items 10000] [--tags 100] [--seed 20261111] [--runs 25]

import os from 'node:os';
import { emptyWorkspace } from '../shared/ops.mjs';
import { fillDiagnostic, DIAGNOSTIC_DEFAULTS } from '../shared/demo.mjs';
import {
  createIndex, selectionOf, ownItemsOf, neighborsOf, suggestForNavigation, sortItems, nodeKey,
} from '../shared/model.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const config = {
  seed: option('seed', DIAGNOSTIC_DEFAULTS.seed),
  items: option('items', DIAGNOSTIC_DEFAULTS.items),
  tags: option('tags', DIAGNOSTIC_DEFAULTS.tags),
};
const RUNS = option('runs', 25);

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(action) {
  const times = [];
  let result;
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    result = action();
    times.push(performance.now() - started);
  }
  return { ms: median(times), max: Math.max(...times), result };
}
const format = (ms) => (ms < 0.01 ? '<0,01' : ms.toFixed(ms < 10 ? 2 : 1).replace('.', ','));

const started = performance.now();
const ws = fillDiagnostic(emptyWorkspace({ id: 'w-measure', name: 'Диагностика', now: Date.now() }), Date.now(), config);
const generated = performance.now() - started;
const build = measure(() => createIndex(ws));
const index = build.result;

// ---------- Распределение ----------
const perItem = new Map();
for (const item of ws.items) perItem.set(item.tags.length, (perItem.get(item.tags.length) ?? 0) + 1);
const usage = ws.tags.map((tag) => index.usage.get(tag.id) ?? 0);

// ---------- Узлы для измерения ----------
const id = (n) => `t${n}`;
const own = (tagIds) => index.filled.get(nodeKey(tagIds))?.own ?? 0;
function findPair(predicate) {
  for (let a = 1; a <= config.tags; a++) {
    for (let b = a + 1; b <= config.tags; b++) {
      const tagIds = [id(a), id(b)];
      if (predicate(tagIds)) return tagIds;
    }
  }
  return null;
}
const nodes = [
  ['Корень', []],
  ['Самый частый тег', [id(1)]],
  ['Самый редкий тег', [id(config.tags)]],
  ['Заполненный узел из двух тегов', findPair((tagIds) => own(tagIds) > 0)],
  ['Незаполненный узел с непустой выборкой', findPair((tagIds) => own(tagIds) === 0 && selectionOf(index, tagIds).length > 0)],
  ['Узел с пустой выборкой', findPair((tagIds) => selectionOf(index, tagIds).length === 0)],
].filter(([, tagIds]) => tagIds);

const rows = [];
for (const [label, tagIds] of nodes) {
  const names = tagIds.map((tagId) => index.tagById.get(tagId).name).join(' ') || '∅';
  const selection = measure(() => selectionOf(index, tagIds));
  const ownItems = measure(() => ownItemsOf(index, tagIds));
  const neighbors = measure(() => {
    index.cache.clear();
    return neighborsOf(index, tagIds);
  });
  const suggestEmpty = measure(() => {
    index.cache.clear();
    return suggestForNavigation(index, tagIds, '');
  });
  const suggestTyped = measure(() => suggestForNavigation(index, tagIds, 'с'));
  const byTime = measure(() => sortItems(selection.result, 'time'));
  const byTitle = measure(() => sortItems(selection.result, 'title'));
  rows.push([
    `${label} (\`${names}\`)`, selection.result.length, ownItems.result.length,
    `${neighbors.result.ancestors.length} / ${neighbors.result.descendants.length}`,
    format(selection.ms), format(neighbors.ms), format(suggestEmpty.ms), format(suggestTyped.ms), format(byTime.ms), format(byTitle.ms),
  ]);
}

console.log(`Среда: Node.js ${process.version}, ${os.cpus()[0]?.model ?? 'процессор неизвестен'} × ${os.cpus().length}, ${os.platform()} ${os.arch()}`);
console.log(`Набор: ${config.items} элементов, ${config.tags} тегов, зерно ${config.seed}; создание набора ${format(generated)} мс`);
console.log(`Заполненных узлов: ${index.filled.size}; построение индекса — ${format(build.ms)} мс (медиана из ${RUNS})`);
console.log(`Тегов на элемент: ${[...perItem].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k} — ${n}`).join('; ')}`);
console.log(`Элементов на тег: наибольшее ${Math.max(...usage)}, медиана ${median(usage)}, наименьшее ${Math.min(...usage)}`);
console.log('');
console.log('| Узел | Выборка | Собств. | Предков / потомков | Отбор, мс | Переходы, мс | Автодополнение (пустой ввод), мс | Автодополнение («с»), мс | Сортировка по времени, мс | Сортировка по названию, мс |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const row of rows) console.log(`| ${row.join(' | ')} |`);
