// CHECKS.md, «Диагностическая проверка объёма данных»: 10 000 элементов, 100 тегов.
// Время действия измеряется в странице: от события до второго кадра после него.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  setup, api, createWorkspace, openWorkspace, nodeTags, transitions, count, shot, t, ARTIFACTS,
} from './helpers.mjs';
import { createIndex, selectionOf, nodeKey } from '../shared/model.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const LIMIT_MS = 2000; // Порог не приёмочный: он лишь показывает, что интерфейс не «зависает».

/** Выполняет действие в странице и возвращает время до второго следующего кадра. */
function timed(page, script, argument) {
  return page.evaluate(async ({ script: source, argument: value }) => {
    const action = new Function('arg', source);
    const started = performance.now();
    action(value);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.round((performance.now() - started) * 10) / 10;
  }, { script, argument });
}
const click = (page, selector) => timed(page, 'document.querySelector(arg).click()', selector);
const type = (page, value) => timed(page, `
  const input = document.getElementById('nav-tag-input');
  input.focus();
  input.value = arg;
  input.dispatchEvent(new Event('input', { bubbles: true }));`, value);
const enter = (page) => timed(page, `
  document.getElementById('nav-tag-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`);

test('диагностический набор: отбор, переходы, автодополнение и доступность интерфейса', async (context) => {
  const results = {};
  let started = Date.now();
  const id = await createWorkspace(env.base, 'diagnostic');
  results['Создание набора на сервере'] = Date.now() - started;

  // Незаполненный узел с непустой выборкой находим по тем же данным.
  const { workspace } = await api(env.base, 'GET', `/api/workspaces/${id}`);
  assert.equal(workspace.items.length, 10_000);
  assert.equal(workspace.tags.length, 100);
  assert.ok(workspace.items.every((item) => item.tags.length >= 1 && item.tags.length <= 6));
  const index = createIndex(workspace);
  let unfilled = null;
  for (let a = 0; a < 100 && !unfilled; a++) {
    for (let b = a + 1; b < 100; b++) {
      const tagIds = [workspace.tags[a].id, workspace.tags[b].id];
      if (!index.filled.has(nodeKey(tagIds)) && selectionOf(index, tagIds).length > 0) {
        unfilled = { names: [workspace.tags[a].name, workspace.tags[b].name], selection: selectionOf(index, tagIds).length };
        break;
      }
    }
  }
  assert.ok(unfilled, 'в наборе есть незаполненный узел с непустой выборкой');

  started = Date.now();
  const page = await openWorkspace(env.context, env.base, id);
  results['Открытие рабочей области (загрузка и первый показ)'] = Date.now() - started;
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((entry) => Math.round(entry.duration))))
      .observe({ entryTypes: ['longtask'] });
  });
  await page.click(t('open-settings'));
  await page.check(t('setting-timings'));
  await page.keyboard.press('Escape');

  // Корень: выборка из 10 000 элементов показывается порциями.
  assert.equal(await count(page, t('empty-own')), 1);
  results['Корень: показать выборку (10 000 элементов)'] = await click(page, '[data-testid=mode-switch] [data-value=selection]');
  assert.equal(await count(page, t('item')), 40);
  results['Корень: сортировка по названию'] = await click(page, '[data-testid=sort-switch] [data-value=title]');
  results['Корень: сортировка по времени'] = await click(page, '[data-testid=sort-switch] [data-value=time]');
  results['Корень: показать ещё 40 элементов'] = await click(page, '[data-testid=show-more]');
  assert.equal(await count(page, t('item')), 80);
  assert.equal((await transitions(page, 'descendants')).length, 6);
  results['Корень: раскрыть все переходы (100)'] = await click(page, '[data-testid=descendants] [data-testid=transition-toggle]');
  assert.match(await page.textContent(t('transition-pager')), /1–12 из 100/);
  await shot(page, '05-root-10000');

  // Автодополнение в корне.
  results['Корень: автодополнение, пустой ввод'] = await timed(page, 'document.getElementById("nav-tag-input").click()');
  assert.equal(await count(page, '[data-suggest]'), 10);
  results['Корень: автодополнение, ввод «с»'] = await type(page, 'с');
  assert.ok(await count(page, '[data-suggest]') > 0);
  results['Корень: автодополнение, ввод «ре»'] = await type(page, 'ре');
  // Сначала совпадения с начала названия (по частоте), затем вхождения.
  assert.deepEqual(await page.$$eval('[data-suggest]', (rows) => rows.map((row) => row.dataset.suggest)), ['рецепт', 'ремонт', 'море', 'кредит', 'встреча']);

  // Переход по самому частому тегу, затем в незаполненный узел.
  results['Переход в узел самого частого тега'] = await type(page, `${workspace.tags[0].name} `);
  assert.deepEqual(await nodeTags(page), [workspace.tags[0].name]);
  results['Переход по предложенному потомку'] = await click(page, '[data-testid=descendants] [data-testid=transition]');
  assert.equal((await nodeTags(page)).length, 2);
  results['Назад по истории'] = await click(page, '[data-testid=nav-back]');
  results['Выход в корень'] = await click(page, '[data-testid=nav-root]');
  await type(page, unfilled.names.join(' '));
  results[`Переход в незаполненный узел (${unfilled.names.join(' ')})`] = await enter(page);
  assert.deepEqual(await nodeTags(page), unfilled.names);
  assert.equal(await page.textContent('[data-testid=mode-switch] [data-value=own] .segment-count'), '0');
  assert.equal(await page.textContent('[data-testid=mode-switch] [data-value=selection] .segment-count'), String(unfilled.selection));
  results['Незаполненный узел: автодополнение, ввод «с»'] = await type(page, 'с');
  await type(page, '');
  const timings = await page.textContent(t('timings'));
  await shot(page, '05-unfilled-node');

  // Изменение данных: запись всей рабочей области на диск.
  await page.keyboard.press('Escape');
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Новая запись в большом наборе');
  started = Date.now();
  await page.click(t('editor-save'));
  await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  results['Добавление элемента (с записью на диск)'] = Date.now() - started;
  assert.equal(await page.textContent('[data-testid=mode-switch] [data-value=selection] .segment-count'), String(unfilled.selection + 1));

  const longTasks = await page.evaluate(() => window.__longTasks);
  results['Самая долгая непрерывная задача в странице'] = Math.max(0, ...longTasks);

  const lines = Object.entries(results).map(([name, ms]) => `${name}: ${ms} мс`);
  lines.push(`Показатели интерфейса для незаполненного узла — ${timings.replace(/\s+/g, ' ').trim()}`);
  for (const line of lines) context.diagnostic(line);
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await fs.writeFile(path.join(ARTIFACTS, 'volume.txt'), `${lines.join('\n')}\n`);

  for (const [name, ms] of Object.entries(results)) {
    if (name.startsWith('Создание')) continue;
    assert.ok(ms < LIMIT_MS, `${name}: ${ms} мс`);
  }
  assert.deepEqual(page.problems, []);
});
