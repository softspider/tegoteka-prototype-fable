// CHECKS.md, «Создание, редактирование и теги».
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, createWorkspace, openWorkspace, addTags, nodeTags, items, labels, transitions, setMode, count, unmarkedCount,
  typeMarkupTags, editedTags, menuAction, shot, t,
} from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const closed = (page) => page.waitForSelector(t('item-dialog'), { state: 'detached' });
const card = (page, text) => page.locator('[data-testid=item]', { hasText: text });
const byText = async (page, text) => (await items(page)).find((item) => item.text === text);
const originalTags = (page) => page.locator('[data-testid=original-tags] .tag').evaluateAll((tags) =>
  tags.map((tag) => `${tag.classList.contains('tag-removed') ? '−' : ''}${tag.dataset.tag}`));
const glossaryRow = (page, name) => page.locator(`[data-testid=glossary-row][data-tag="${name}"]`);

async function create(page, { title, text, save = 'editor-save' }) {
  if (title !== undefined) await page.fill(t('editor-title'), title);
  if (text !== undefined) await page.fill(t('editor-text'), text);
  await page.click(t(save));
  await closed(page);
}

test('создание: предложенная разметка, изменённый набор, быстрое сохранение без разметки', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт');

  await page.click(t('add-item'));
  assert.deepEqual(await editedTags(page), ['ремонт']);
  await shot(page, '03-create-dialog');
  await create(page, { title: 'Обои', text: 'Выбрать обои' });
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  assert.deepEqual((await items(page)).map((item) => item.title), ['Обои', 'Ремонт'], 'новый элемент — собственный и первый по времени');
  assert.equal(await count(page, t('notice')), 0);

  // Предложенный набор изменён: элемент принадлежит другому узлу, предлагается переход.
  await page.click(t('add-item'));
  await page.click('[data-testid=edited-tags] [data-tag="ремонт"] .tag-remove');
  await typeMarkupTags(page, 'сад');
  assert.deepEqual(await editedTags(page), ['сад']);
  await create(page, { title: 'Яблоня', text: 'Посадить яблоню' });
  assert.deepEqual(await nodeTags(page), ['ремонт'], 'после сохранения текущий узел прежний');
  assert.equal((await items(page)).some((item) => item.title === 'Яблоня'), false);
  assert.deepEqual(await page.locator('[data-testid=notice] .tag').evaluateAll((tags) => tags.map((tag) => tag.dataset.tag)), ['сад']);
  await shot(page, '03-saved-to-other-node');
  await page.click(t('notice-go'));
  assert.deepEqual(await nodeTags(page), ['сад']);
  assert.deepEqual((await items(page)).map((item) => item.title), ['Яблоня', 'Без названия']);

  // Быстрое сохранение без разметки.
  await page.click(t('add-item'));
  await create(page, { title: 'На потом', text: 'Разметить позже', save: 'editor-save-unmarked' });
  assert.equal(await unmarkedCount(page), 2);
  assert.equal((await items(page)).some((item) => item.title === 'На потом'), false);
  await page.click(t('notice-markup'));
  assert.deepEqual(await page.$$eval('[data-testid=queue-item] .queue-title', (rows) => rows.map((row) => row.textContent)), ['Набросок', 'На потом']);
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-done'), '11');
  assert.equal(await page.getAttribute(t('markup-progress'), 'data-total'), '13');
  const width = await page.$eval('[data-testid=markup-progress] .progress-bar span', (bar) => bar.style.width);
  assert.equal(width, '84.6%');
  await shot(page, '03-markup-progress');
  assert.deepEqual(page.problems, []);
});

test('новый тег: предложение описания, пропуск описания, тег остаётся в глоссарии', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await page.click(t('add-item'));
  await typeMarkupTags(page, 'плитка обои');
  assert.equal(await count(page, '[data-testid=new-tags] .fresh-row'), 2, 'для каждого нового тега предложено описание');
  await page.fill(t('new-tag-description-плитка'), 'Отделочный материал');
  await shot(page, '03-new-tags');
  await create(page, { title: 'Отделка', text: 'Плитка и обои' });
  await page.click(t('notice-go'));
  assert.deepEqual(await nodeTags(page), ['плитка', 'обои']);

  await page.click(t('open-glossary'));
  assert.equal(await page.textContent(t('glossary-total')), '17 тегов');
  assert.equal(await glossaryRow(page, 'плитка').locator(t('glossary-description')).textContent(), 'Отделочный материал');
  assert.equal((await glossaryRow(page, 'обои').locator(t('glossary-description')).textContent()).trim(), 'Описание не задано');
  assert.equal(await glossaryRow(page, 'обои').locator(t('glossary-usage')).textContent(), '1 элемент');
  await page.keyboard.press('Escape');

  // Удаление последнего элемента с тегом: тег остаётся доступным.
  await menuAction(page, page, 'item-delete');
  await page.click(t('confirm-ok'));
  await page.waitForSelector(t('empty-selection'));
  assert.deepEqual(await nodeTags(page), ['плитка', 'обои']);
  await page.click(t('open-glossary'));
  assert.equal(await page.textContent(t('glossary-total')), '17 тегов');
  assert.equal(await glossaryRow(page, 'обои').locator(t('glossary-usage')).textContent(), 'не используется');
  // Тег можно добавить и без разметки; занятое название отклоняется.
  await page.fill(t('add-tag-name'), 'Дача');
  await page.fill(t('add-tag-description'), 'Загородный дом');
  await page.click(t('add-tag-save'));
  await glossaryRow(page, 'дача').waitFor();
  await page.fill(t('add-tag-name'), 'сад');
  await page.click(t('add-tag-save'));
  assert.match(await page.textContent('.glossary-add .field-error'), /уже есть/);
  await glossaryRow(page, 'дача').locator(t('glossary-go')).click();
  assert.deepEqual(await nodeTags(page), ['дача']);
  assert.deepEqual(page.problems, []);
});

test('изменение названия и тегов сохраняет элемент; исходная разметка видна; перемещение', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await setMode(page, 'selection');
  const e3 = await byText(page, 'План электрики при ремонте кухни');

  await card(page, 'План электрики при ремонте кухни').locator(t('item-edit')).click();
  assert.deepEqual(await originalTags(page), ['ремонт', 'кухня', 'электрика']);
  assert.equal(await page.inputValue(t('editor-text')), 'План электрики при ремонте кухни', 'содержание доступно при изменении тегов');
  await page.fill(t('editor-title'), 'План электрики');
  await page.click('[data-testid=edited-tags] [data-tag="электрика"] .tag-remove');
  await typeMarkupTags(page, 'свет');
  assert.deepEqual(await originalTags(page), ['ремонт', 'кухня', '−электрика'], 'исходный набор показан для сравнения');
  assert.deepEqual(await editedTags(page), ['ремонт', 'кухня', 'свет']);
  await shot(page, '03-edit-original-tags');
  await page.click(t('editor-save'));
  await closed(page);
  assert.deepEqual(await nodeTags(page), []);
  const renamed = (await items(page)).find((item) => item.title === 'План электрики');
  assert.equal(renamed.id, e3.id, 'изменение названия и тегов сохраняет тот же элемент');
  assert.deepEqual(renamed.tags, ['ремонт', 'кухня', 'свет']);
  assert.equal((await items(page))[0].id, e3.id, 'время последнего изменения обновлено');

  // Перемещение: замена разметки набором тегов текущего узла.
  await addTags(page, 'ремонт');
  const e4 = await byText(page, 'Срочно согласовать бюджет ремонта кухни');
  await menuAction(page, card(page, 'Срочно согласовать'), 'item-move');
  assert.match(await page.textContent(t('move-lead')), /Новая разметка — теги узла/);
  assert.deepEqual(await originalTags(page), ['ремонт', '−кухня', '−бюджет', '−срочно']);
  assert.deepEqual(await editedTags(page), ['ремонт']);
  assert.equal(await page.inputValue(t('editor-text')), 'Срочно согласовать бюджет ремонта кухни');
  await shot(page, '03-move');
  await page.click(t('editor-save'));
  await closed(page);
  const moved = await byText(page, 'Срочно согласовать бюджет ремонта кухни');
  assert.equal(moved.id, e4.id);
  assert.deepEqual(moved.tags, ['ремонт']);
  assert.equal(moved.own, true);

  // Если набор не соответствует содержанию, перемещение отменяется.
  await menuAction(page, card(page, 'Бюджет электрики'), 'item-move');
  await page.click(t('editor-cancel'));
  await closed(page);
  assert.deepEqual((await byText(page, 'Бюджет электрики при ремонте кухни')).tags, ['ремонт', 'кухня', 'электрика', 'бюджет']);
  assert.deepEqual(page.problems, []);
});

test('напоминание перед сохранением изменённого содержания и его отключение', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  const original = await byText(page, 'Общая запись');

  // Изменение только названия напоминания не вызывает.
  await page.click(t('item-edit'));
  await page.fill(t('editor-title'), 'Общее!');
  await page.click(t('editor-save'));
  await closed(page);
  assert.equal((await items(page))[0].id, original.id);

  await page.click(t('item-edit'));
  await page.fill(t('editor-text'), 'Общая запись, новая редакция');
  assert.equal(await count(page, t('content-changed-note')), 1);
  await page.click(t('editor-save'));
  await page.waitForSelector(t('content-reminder'));
  assert.match(await page.textContent(t('content-reminder')), /Теги должны соответствовать новому содержанию/);
  await shot(page, '03-content-reminder');
  await page.click(t('reminder-back'));
  assert.equal(await page.inputValue(t('editor-text')), 'Общая запись, новая редакция');
  await page.click(t('editor-save'));
  await page.check(t('reminder-disable'));
  await page.click(t('reminder-save'));
  await closed(page);
  const replaced = (await items(page))[0];
  assert.equal(replaced.text, 'Общая запись, новая редакция');
  assert.equal(replaced.title, 'Общее!');
  assert.notEqual(replaced.id, original.id, 'изменение содержания заменяет запись новым элементом');
  assert.equal((await items(page)).length, 1);

  // Напоминание отключено.
  await page.click(t('item-edit'));
  await page.fill(t('editor-text'), 'Третья редакция');
  await page.click(t('editor-save'));
  await closed(page);
  assert.equal((await items(page))[0].text, 'Третья редакция');

  // Настройка возвращает напоминание.
  await page.click(t('open-settings'));
  assert.equal(await page.isChecked(t('setting-reminder')), false);
  await page.check(t('setting-reminder'));
  await page.keyboard.press('Escape');
  await page.click(t('item-edit'));
  await page.click('[data-testid=content-kind] [data-value=empty]');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('content-reminder'));
  await page.click(t('reminder-save'));
  await closed(page);
  assert.equal((await items(page))[0].kind, 'empty');
  assert.deepEqual(page.problems, []);
});

test('редактирование из выборки и из режима разметки; текущий узел после сохранения прежний', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'кухня');
  await setMode(page, 'selection');
  await card(page, 'Бюджет электрики').locator(t('item-edit')).click();
  await typeMarkupTags(page, 'проверено');
  await page.click(t('editor-save'));
  await closed(page);
  assert.deepEqual(await nodeTags(page), ['кухня']);
  assert.deepEqual((await byText(page, 'Бюджет электрики при ремонте кухни')).tags, ['ремонт', 'кухня', 'электрика', 'бюджет', 'проверено']);
  await page.click(t('notice-go'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'электрика', 'бюджет', 'проверено']);
  assert.deepEqual(await labels(page), ['E5']);

  // Переход в узел элемента прямо из карточки.
  await page.click(t('nav-root'));
  await card(page, 'Полить сад').locator(t('item-goto')).click();
  assert.deepEqual(await nodeTags(page), ['сад']);

  // Режим разметки: изменение неразмеченного элемента без назначения тегов.
  await page.click(t('open-markup'));
  await page.click(t('markup-edit'));
  assert.deepEqual(await originalTags(page), []);
  assert.match(await page.textContent(t('original-tags')), /не задана/);
  await page.fill(t('editor-title'), 'Набросок (уточнён)');
  await page.click(t('editor-save-unmarked'));
  await closed(page);
  assert.deepEqual(await page.$$eval('[data-testid=queue-item] .queue-title', (rows) => rows.map((row) => row.textContent)), ['Набросок (уточнён)']);
  assert.equal(await unmarkedCount(page), 1);
  // Разметка с переходом в узел элемента.
  await page.click(t('use-node-tags'));
  assert.deepEqual(await editedTags(page), ['сад']);
  await typeMarkupTags(page, 'идея');
  await page.click(t('markup-save'));
  await page.waitForSelector(t('markup-done'));
  await page.click(t('notice-go'));
  assert.deepEqual(await nodeTags(page), ['сад', 'идея']);
  assert.deepEqual((await items(page)).map((item) => item.title), ['Набросок (уточнён)']);
  assert.deepEqual(page.problems, []);
});

test('переименование тега во всей области; занятое название отклоняется; описание тега', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'кухня');
  await setMode(page, 'selection');
  const before = (await labels(page)).sort();

  await page.click(t('open-glossary'));
  await glossaryRow(page, 'кухня').locator(t('glossary-rename')).click();
  await page.fill(t('rename-input'), 'Столовая');
  await page.click(t('rename-save'));
  await glossaryRow(page, 'столовая').waitFor();
  assert.equal(await glossaryRow(page, 'кухня').count(), 0);
  assert.equal(await glossaryRow(page, 'столовая').locator(t('glossary-usage')).textContent(), '4 элемента');

  // Название «сад» занято: переименование не выполняется.
  await glossaryRow(page, 'столовая').locator(t('glossary-rename')).click();
  await page.fill(t('rename-input'), 'сад');
  await page.click(t('rename-save'));
  assert.match(await page.textContent(t('glossary-error')), /уже есть в рабочей области\. Выберите другое название/);
  await shot(page, '03-rename-conflict');
  await page.keyboard.press('Escape');
  await page.click(t('open-glossary'));
  assert.equal(await glossaryRow(page, 'столовая').count(), 1);
  assert.equal(await glossaryRow(page, 'сад').locator(t('glossary-usage')).textContent(), '1 элемент');

  await glossaryRow(page, 'сад').locator(t('glossary-describe')).click();
  await page.fill(t('description-input'), 'Участок у дома');
  await page.click(t('description-save'));
  assert.equal(await glossaryRow(page, 'сад').locator(t('glossary-description')).textContent(), 'Участок у дома');
  await page.keyboard.press('Escape');

  assert.deepEqual(await nodeTags(page), ['столовая'], 'назначения и выбранный тег сохранены');
  assert.deepEqual((await labels(page)).sort(), before);
  assert.ok((await items(page)).every((item) => item.tags.includes('столовая') && !item.tags.includes('кухня')));
  await page.click(t('nav-root'));
  await page.fill('#nav-tag-input', 'са');
  assert.equal(await page.textContent('[data-suggest="сад"] .suggest-desc'), 'Участок у дома');
  assert.deepEqual(page.problems, []);
});

test('удаление тега «ремонт»: число элементов, отмена, подтверждение, навигация', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт');
  await addTags(page, 'кухня');
  await setMode(page, 'selection');

  await page.click(t('open-glossary'));
  await glossaryRow(page, 'ремонт').locator(t('glossary-delete')).click();
  assert.equal(await page.textContent(t('delete-tag-count')), 'Элементов рабочей области с этим тегом: 4.');
  await shot(page, '03-delete-tag-confirm');
  await page.click(t('confirm-cancel'));
  assert.equal(await glossaryRow(page, 'ремонт').count(), 1, 'отмена сохраняет данные');
  assert.equal(await page.textContent(t('glossary-total')), '15 тегов');

  await glossaryRow(page, 'ремонт').locator(t('glossary-delete')).click();
  await page.click(t('confirm-ok'));
  await glossaryRow(page, 'ремонт').waitFor({ state: 'detached' });
  assert.equal(await page.textContent(t('glossary-total')), '14 тегов');
  await page.keyboard.press('Escape');

  // Тег был выбран: текущим стал узел с оставшимися тегами.
  assert.deepEqual(await nodeTags(page), ['кухня']);
  assert.deepEqual((await labels(page)).sort(), ['E2', 'E3', 'E4', 'E5'], 'элементы сохранены');
  assert.deepEqual((await byText(page, 'План электрики при ремонте кухни')).tags, ['кухня', 'электрика']);
  // Посещение {ремонт} стало недоступным и пропускается.
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), []);
  assert.equal(await page.isDisabled(t('nav-back')), true);
  assert.deepEqual((await labels(page)).sort(), ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
  await setMode(page, 'own');
  assert.deepEqual((await labels(page)).sort(), ['E0', 'E1'], 'E1 стал собственным элементом корня');
  await page.fill('#nav-tag-input', 'ремонт');
  await page.keyboard.press('Enter');
  assert.match(await page.textContent(t('tag-input-error')), /нет в рабочей области/);
  assert.deepEqual(page.problems, []);
});

test('удаление элемента обновляет выборки и предлагаемые переходы', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт', 'кухня');
  await setMode(page, 'selection');
  assert.deepEqual(await transitions(page, 'descendants'), ['+ электрика', '+ бюджет срочно']);
  await menuAction(page, card(page, 'План электрики'), 'item-delete');
  assert.match(await page.textContent(t('confirm-dialog')), /Восстановить его нельзя/);
  await page.click(t('confirm-ok'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=item]').length === 2);
  assert.deepEqual((await labels(page)).sort(), ['E4', 'E5']);
  // Без E3 узел E5 стал соседним заполненным потомком.
  assert.deepEqual((await transitions(page, 'descendants')).sort(), ['+ бюджет срочно', '+ бюджет электрика']);
  assert.deepEqual(page.problems, []);
});
