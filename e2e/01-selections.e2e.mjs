// CHECKS.md, «Выборки и состояния разметки».
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, createWorkspace, openWorkspace, addTags, nodeTags, items, labels, setMode, activeValue, count, unmarkedCount,
  typeMarkupTags, shot, t,
} from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

test('корень: собственные элементы — только E0; выборка — E0–E8; E9 в списке неразмеченных', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  assert.deepEqual(await nodeTags(page), []);
  assert.equal(await count(page, t('root-mark')), 1);
  assert.equal(await activeValue(page, 'mode-switch'), 'own');
  assert.deepEqual(await labels(page), ['E0']);

  await setMode(page, 'selection');
  assert.deepEqual((await labels(page)).sort(), ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
  assert.equal(await unmarkedCount(page), 1);
  await shot(page, '01-root-selection');

  await page.click(t('open-markup'));
  assert.deepEqual(await page.$$eval('[data-testid=queue-item] .queue-title', (rows) => rows.map((row) => row.textContent)), ['Набросок']);
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-done'), '9');
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-total'), '10');
  await shot(page, '01-markup-mode');
  assert.deepEqual(page.problems, []);
});

test('узлы {ремонт}, {ремонт, кухня} и {мечта}', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт');
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  assert.deepEqual(await labels(page), ['E1']);
  await setMode(page, 'selection');
  assert.deepEqual((await labels(page)).sort(), ['E1', 'E3', 'E4', 'E5']);

  // Переключение режима сохраняет выбранные теги; собственные элементы выделены.
  const selection = await items(page);
  assert.deepEqual(selection.filter((item) => item.own).map((item) => item.text), ['Подготовить ремонт']);
  assert.deepEqual(selection.filter((item) => item.badge).map((item) => item.text), ['Подготовить ремонт']);
  await shot(page, '01-repair-selection-own-highlighted');
  await setMode(page, 'own');
  assert.deepEqual(await nodeTags(page), ['ремонт']);

  await addTags(page, 'кухня');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  assert.equal(await count(page, t('empty-own')), 1, 'обозначено отсутствие собственных элементов');
  await shot(page, '01-unfilled-node');
  await page.click(t('empty-show-selection'));
  assert.deepEqual((await labels(page)).sort(), ['E3', 'E4', 'E5']);
  assert.equal((await items(page)).some((item) => item.own), false);

  // {мечта}: тег вне выборки задаётся полным названием; узел доступен и пуст.
  await page.click(t('nav-root'));
  await page.fill('#nav-tag-input', 'мечта');
  assert.equal(await count(page, '[data-suggest="мечта"]'), 0);
  assert.equal(await count(page, t('suggest-outside')), 1);
  await page.keyboard.press('Enter');
  assert.deepEqual(await nodeTags(page), ['мечта']);
  assert.equal(await count(page, t('empty-selection')), 1);
  await setMode(page, 'own');
  assert.equal(await count(page, t('empty-selection')), 1);
  assert.equal(await count(page, '[data-testid=descendants] [data-testid=transition]'), 0);
  await shot(page, '01-dream-node');
  assert.deepEqual(page.problems, []);
});

test('E7 и E8 остаются разными элементами с пустым содержанием', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'день_рождения');
  await setMode(page, 'selection');
  let list = await items(page);
  assert.deepEqual(list.map((item) => [item.title, item.kind]).sort(), [['Анна', 'empty'], ['Игорь', 'empty']]);
  const anna = list.find((item) => item.title === 'Анна');

  await page.locator('[data-testid=item]', { hasText: 'Игорь' }).locator(t('item-edit')).click();
  await page.fill(t('editor-title'), 'Игорь Артемьев');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  list = await items(page);
  assert.deepEqual(list.map((item) => item.title).sort(), ['Анна', 'Игорь Артемьев']);
  assert.deepEqual(list.find((item) => item.title === 'Анна'), anna);

  await page.locator('[data-testid=item]', { hasText: 'Игорь Артемьев' }).locator(t('item-delete')).click();
  await page.click(t('confirm-ok'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=item]').length === 1);
  assert.deepEqual(await items(page), [anna]);
  assert.deepEqual(page.problems, []);
});

test('пустой набор тегов делает E9 собственным элементом корня; до сохранения выборки не меняются', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  const selectionCount = () => page.textContent('[data-testid=mode-switch] [data-value=selection] .segment-count');
  assert.equal(await selectionCount(), '9');

  await page.click(t('open-markup'));
  // Черновик разметки не сохранён: выборки прежние.
  await typeMarkupTags(page, 'сад');
  await page.click(t('markup-exit'));
  assert.equal(await selectionCount(), '9');
  assert.equal(await unmarkedCount(page), 1);
  await addTags(page, 'сад');
  assert.deepEqual(await labels(page), ['E6']);
  await page.click(t('nav-root'));

  await page.click(t('open-markup'));
  // Черновик сохраняется до конца сеанса; для проверки задаём пустой набор.
  assert.equal(await count(page, '[data-testid=edited-tags] .tag'), 1);
  await page.click('[data-testid=edited-tags] .tag-remove');
  await page.click(t('markup-save'));
  await page.waitForSelector(t('markup-done'));
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-done'), '10');
  await page.click(t('markup-exit'));
  assert.equal(await unmarkedCount(page), 0);
  assert.equal(await selectionCount(), '10');
  assert.deepEqual((await labels(page)).sort(), ['E0', 'E9']);
  assert.deepEqual(page.problems, []);
});

test('к оставшимся неразмеченным элементам можно вернуться после перезапуска', async () => {
  const id = await createWorkspace(env.base, 'demo');
  let page = await openWorkspace(env.context, env.base, id);
  for (const title of ['Позже 1', 'Позже 2']) {
    await page.click(t('add-item'));
    await page.fill(t('editor-title'), title);
    await page.fill(t('editor-text'), `Текст «${title}»`);
    await page.click(t('editor-save-unmarked'));
    await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  }
  assert.equal(await unmarkedCount(page), 3);
  await page.click(t('open-markup'));
  // Очередь: давно ждущие первыми. Размечаем «Набросок».
  await typeMarkupTags(page, 'сад черновик');
  await page.click(t('markup-save'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=queue-item]').length === 2);
  assert.equal(await page.textContent(t('markup-session')), 'За этот заход размечено: 1.');
  await page.close();

  await env.restart();
  page = await openWorkspace(env.context, env.base, id);
  assert.equal(await unmarkedCount(page), 2);
  await page.click(t('open-markup'));
  assert.deepEqual(await page.$$eval('[data-testid=queue-item] .queue-title', (rows) => rows.map((row) => row.textContent)), ['Позже 1', 'Позже 2']);
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-done'), '10');
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-total'), '12');
  await page.click(t('markup-exit'));
  await addTags(page, 'сад');
  await setMode(page, 'selection');
  assert.deepEqual((await labels(page)).sort(), ['E6', 'E9']);
  assert.deepEqual(page.problems, []);
});
