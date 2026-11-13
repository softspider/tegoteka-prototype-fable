// Вторая итерация, FABLE.md: замечания к существующей реализации.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  setup, createWorkspace, openWorkspace, addTags, nodeTags, items, setMode, setSort, activeValue, count, unmarkedCount,
  editedTags, shot, t,
} from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const closed = (page) => page.waitForSelector(t('item-dialog'), { state: 'detached' });
const tagInput = '[data-testid=markup-input] input';
const focused = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName);
const glossaryDescription = async (page, name) => {
  await page.click(t('open-glossary'));
  const text = (await page.locator(`[data-testid=glossary-row][data-tag="${name}"]`).locator(t('glossary-description')).textContent()).trim();
  await page.keyboard.press('Escape');
  await page.waitForSelector(t('glossary-dialog'), { state: 'detached' });
  return text;
};
const tagCount = (page) => page.textContent('[data-testid=open-glossary] .counter');

test('описание нового тега предлагается при немедленном сохранении в редакторе элемента', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));

  // Новый тег набран, но не подтверждён: сохранение откладывается, описание предложено.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Запись с новым тегом');
  await page.fill(tagInput, 'свежий');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('description-offer'));
  assert.equal(await count(page, t('item-dialog')), 1, 'форма остаётся открытой');
  assert.equal(await tagCount(page), '15', 'до подтверждения ничего не сохранено');
  assert.deepEqual(await editedTags(page), ['свежий'], 'набранный тег вошёл в набор');
  assert.equal(await page.inputValue(tagInput), '');
  await page.waitForFunction(() => document.activeElement?.dataset.testid === 'new-tag-description-свежий');
  await shot(page, '08-description-offer-editor');
  await page.keyboard.type('Только что добавлен');
  await page.click(t('editor-save'));
  await closed(page);
  assert.equal(await tagCount(page), '16');
  assert.equal(await glossaryDescription(page, 'свежий'), 'Только что добавлен');

  // Пропуск описания допустим: повторное сохранение без ввода.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Запись без описания тега');
  await page.fill(tagInput, 'без_описания');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('description-offer'));
  await page.click(t('editor-save'));
  await closed(page);
  assert.equal(await glossaryDescription(page, 'без_описания'), 'Описание не задано');

  // Существующий тег, набранный без подтверждения, сохраняется сразу.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Запись с существующим тегом');
  await page.fill(tagInput, 'мечта');
  await page.click(t('editor-save'));
  await closed(page);
  assert.equal(await tagCount(page), '17');

  // Несколько тегов: подтверждённый существующий и неподтверждённый новый.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Смешанный ввод');
  // Длинный список подсказок не заслоняет кнопки формы.
  await page.fill(tagInput, 'а');
  const overlap = await page.evaluate(() => {
    const list = document.querySelector('[data-testid=suggestions]').getBoundingClientRect();
    const foot = document.querySelector('.modal-foot').getBoundingClientRect();
    return list.bottom > foot.top && list.top < foot.bottom;
  });
  assert.equal(overlap, false);
  await page.fill(tagInput, 'сад совсем_новый');
  assert.deepEqual(await editedTags(page), ['сад']);
  await page.click(t('editor-save'));
  await page.waitForSelector(t('description-offer'));
  assert.deepEqual(await editedTags(page), ['сад', 'совсем_новый']);
  assert.equal(await count(page, '[data-testid=new-tags] .fresh-row'), 1);
  await page.click(t('editor-save'));
  await closed(page);

  // Тег, подтверждённый Enter: поле описания видно до сохранения, сохранение — одним действием.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Подтверждённый ввод');
  await page.fill(tagInput, 'подтверждённый');
  await page.keyboard.press('Enter');
  assert.equal(await count(page, t('new-tag-description-подтверждённый')), 1);
  assert.equal(await count(page, t('description-offer')), 0);
  await page.click(t('editor-save'));
  await closed(page);

  // Тот же путь при изменении существующего элемента.
  await page.click(t('item-edit'));
  await page.fill(tagInput, 'при_изменении');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('description-offer'));
  await page.fill(t('new-tag-description-при_изменении'), 'Добавлен при изменении');
  await page.click(t('editor-save'));
  await closed(page);
  assert.equal(await glossaryDescription(page, 'при_изменении'), 'Добавлен при изменении');
  assert.deepEqual(page.problems, []);
});

test('описание нового тега предлагается при немедленном сохранении в режиме разметки', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await page.click(t('open-markup'));
  await page.fill(tagInput, 'черновой');
  await page.click(t('markup-save'));
  await page.waitForSelector(t('description-offer'));
  assert.equal(await unmarkedCount(page), 1, 'разметка ещё не сохранена');
  assert.equal(await tagCount(page), '15');
  assert.deepEqual(await editedTags(page), ['черновой']);
  await page.waitForFunction(() => document.activeElement?.dataset.testid === 'new-tag-description-черновой');
  await shot(page, '08-description-offer-markup');
  await page.keyboard.type('Требует доработки');
  await page.click(t('markup-save'));
  await page.waitForSelector(t('markup-done'));
  assert.equal(await unmarkedCount(page), 0);
  await page.click(t('markup-exit'));
  assert.equal(await glossaryDescription(page, 'черновой'), 'Требует доработки');

  // Пропуск описания в режиме разметки.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Ещё один неразмеченный');
  await page.click(t('editor-save-unmarked'));
  await closed(page);
  await page.click(t('open-markup'));
  await page.fill(tagInput, 'пропущенный');
  await page.click(t('markup-save'));
  await page.waitForSelector(t('description-offer'));
  await page.click(t('markup-save'));
  await page.waitForSelector(t('markup-done'));
  await page.click(t('markup-exit'));
  assert.equal(await glossaryDescription(page, 'пропущенный'), 'Описание не задано');
  assert.deepEqual(page.problems, []);
});

test('Escape сразу после появления диалога закрывает его; фокус возвращается, интерфейс работает дальше', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));

  // Escape отправляется в тот же момент, когда окно появляется в документе.
  await page.evaluate(() => {
    window.__escapes = 0;
    window.__observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added.nodeType === 1 && (added.matches('.backdrop') || added.querySelector('.modal'))) {
            window.__escapes += 1;
            (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          }
        }
      }
    });
    window.__observer.observe(document.body, { childList: true, subtree: true });
  });
  let sent = 0;
  for (const opener of ['open-glossary', 'open-settings', 'open-workspaces', 'add-item']) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click(t(opener));
      sent += 1;
      await page.waitForFunction((expected) => window.__escapes === expected && !document.querySelector('.modal'), sent, { timeout: 2000 });
      assert.equal(await focused(page), opener, 'фокус вернулся на кнопку, открывшую окно');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('modal-open')), false);
    }
  }
  await page.evaluate(() => window.__observer.disconnect());

  // Клавиша с клавиатуры сразу за щелчком.
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.click(t('open-glossary'));
    await page.keyboard.press('Escape');
    await page.waitForSelector(t('glossary-dialog'), { state: 'detached', timeout: 2000 });
  }

  // Последующая работа: окно открывается, поля и кнопки действуют, Tab остаётся внутри окна.
  await page.click(t('open-glossary'));
  await page.fill(t('glossary-filter'), 'рем');
  assert.deepEqual(await page.$$eval('[data-testid=glossary-row]', (rows) => rows.map((row) => row.dataset.tag)), ['ремонт']);
  for (let n = 0; n < 12; n++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.modal'))), true, 'фокус не уходит за пределы окна');
  await page.locator('[data-testid=glossary-row][data-tag="ремонт"]').locator(t('glossary-go')).click();
  assert.deepEqual(await nodeTags(page), ['ремонт']);

  // Несохранённые изменения: Escape не закрывает форму молча.
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Черновик');
  await page.keyboard.press('Escape');
  assert.equal(await count(page, t('item-dialog')), 1);
  assert.match(await page.textContent(t('item-dialog')), /Есть несохранённые изменения/);
  await page.click(t('editor-cancel'));
  await closed(page);

  // Вложенное окно: Escape закрывает только верхнее.
  await page.click(t('open-glossary'));
  await page.locator('[data-testid=glossary-row][data-tag="сад"]').locator(t('glossary-delete')).click();
  await page.keyboard.press('Escape');
  await page.waitForSelector(t('confirm-dialog'), { state: 'detached' });
  assert.equal(await count(page, t('glossary-dialog')), 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector(t('glossary-dialog'), { state: 'detached' });
  assert.deepEqual(page.problems, []);
});

test('быстрые последовательные изменения состояния просмотра сохраняются; после перезагрузки — актуальное состояние', async () => {
  const id = await createWorkspace(env.base, 'demo');
  const page = await openWorkspace(env.context, env.base, id);
  const saves = [];
  page.on('requestfinished', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/state')) saves.push(request.postDataJSON().rev);
  });

  // 41 изменение подряд без пауз: переключение состава и сортировки.
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      document.querySelector(`[data-testid=mode-switch] [data-value=${i % 2 ? 'own' : 'selection'}]`).click();
      document.querySelector(`[data-testid=sort-switch] [data-value=${i % 2 ? 'time' : 'title'}]`).click();
    }
    document.querySelector('[data-testid=mode-switch] [data-value=selection]').click();
  });
  // Последнее изменение — переход — и немедленная перезагрузка страницы.
  await page.click('[data-testid=transition][data-label="+ ремонт"]');
  await page.reload();
  await page.waitForSelector(`[data-testid=app][data-workspace="${id}"]`);
  assert.deepEqual(await nodeTags(page), ['ремонт'], 'сохранён последний переход');
  assert.equal(await activeValue(page, 'mode-switch'), 'selection');
  assert.equal(await activeValue(page, 'sort-switch'), 'time');
  assert.equal(await count(page, t('save-warning')), 0);

  // Файл состояния корректен и содержит последнее отправленное состояние.
  const file = path.join(env.dataDir, 'workspaces', id, 'state.json');
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.view.mode, 'selection');
  assert.equal(stored.history.entries.length, 2);
  assert.ok(saves.length >= 2 && saves.length < 42, `запросы объединяются: отправлено ${saves.length} из 42 изменений`);
  assert.deepEqual(saves, [...saves].sort((a, b) => a - b), 'запросы идут по порядку');
  assert.ok(stored.rev >= saves[saves.length - 1]);
  const names = await fs.readdir(path.dirname(file));
  assert.deepEqual(names.filter((name) => name.endsWith('.tmp')), []);
  assert.deepEqual(page.problems, []);
});

test('неудача сохранения состояния видна пользователю и повторяется до успеха', async () => {
  const id = await createWorkspace(env.base, 'demo');
  const page = await openWorkspace(env.context, env.base, id);
  const fail = (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"сбой записи"}}' });

  await page.route('**/api/workspaces/*/state', fail);
  await setMode(page, 'selection');
  await page.waitForSelector(t('save-warning'));
  assert.match(await page.textContent(t('save-warning')), /Состояние просмотра не сохранено/);
  await shot(page, '08-save-warning');
  // Работа продолжается; изменения накапливаются.
  await setSort(page, 'title');
  await addTags(page, 'кухня');
  assert.equal((await items(page)).length, 4);
  assert.equal(await count(page, t('save-warning')), 1);

  // Повтор по кнопке после устранения сбоя.
  await page.unroute('**/api/workspaces/*/state');
  await page.click(t('save-retry'));
  await page.waitForSelector(t('save-warning'), { state: 'detached' });
  await page.reload();
  await page.waitForSelector(`[data-testid=app][data-workspace="${id}"]`);
  assert.deepEqual(await nodeTags(page), ['кухня']);
  assert.equal(await activeValue(page, 'mode-switch'), 'selection');
  assert.equal(await activeValue(page, 'sort-switch'), 'title');

  // Автоматический повтор без участия пользователя.
  await page.route('**/api/workspaces/*/state', fail);
  await setMode(page, 'own');
  await page.waitForSelector(t('save-warning'));
  await page.unroute('**/api/workspaces/*/state');
  await page.waitForSelector(t('save-warning'), { state: 'detached', timeout: 10_000 });
  await page.reload();
  await page.waitForSelector(`[data-testid=app][data-workspace="${id}"]`);
  assert.equal(await activeValue(page, 'mode-switch'), 'own');
  // Ошибки 500 в консоли — это смоделированный сбой; других ошибок нет.
  assert.deepEqual(page.problems.filter((problem) => !problem.includes('status of 500')), []);
});
