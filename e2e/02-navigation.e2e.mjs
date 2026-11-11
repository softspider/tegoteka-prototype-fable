// CHECKS.md, «Соседство и переходы».
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, createWorkspace, openWorkspace, op, addTags, nodeTags, items, labels, transitions, setMode, setSort, activeValue,
  count, editedTags, shot, t,
} from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const text = (value) => ({ kind: 'text', text: value });
const suggested = (page) => page.$$eval('[data-testid=suggestions] [data-suggest]', (rows) => rows.map((row) => row.dataset.suggest));

test('соседние заполненные предки и потомки незаполненного узла {ремонт, кухня}', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт', 'кухня');
  // Заполненный корень не соседний; узел E5 не соседний (между ним и текущим — узел E3).
  assert.deepEqual(await transitions(page, 'ancestors'), ['− кухня', '− ремонт']);
  assert.deepEqual(await transitions(page, 'descendants'), ['+ электрика', '+ бюджет срочно']);
  const counts = (group, id) => page.$$eval(`[data-testid=${group}] [data-testid=${id}]`, (cells) => cells.map((cell) => cell.textContent));
  assert.deepEqual(await counts('descendants', 'transition-selection'), ['2', '1']);
  assert.deepEqual(await counts('ancestors', 'transition-selection'), ['4', '4']);
  assert.deepEqual(await counts('descendants', 'transition-own'), ['собств. 1', 'собств. 1']);
  await shot(page, '02-neighbours');

  await page.click('[data-testid=transition][data-label="+ электрика"]');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'электрика']);
  assert.deepEqual(await labels(page), ['E3']);
  assert.deepEqual(await transitions(page, 'descendants'), ['+ бюджет']);
  assert.deepEqual(await transitions(page, 'ancestors'), ['− кухня электрика', '− ремонт электрика']);

  await page.click('[data-testid=transition][data-label="− кухня электрика"]');
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  assert.deepEqual(await transitions(page, 'ancestors'), ['− ремонт']);
  await page.click('[data-testid=transition][data-label="− ремонт"]');
  assert.deepEqual(await nodeTags(page), []);

  // Число собственных элементов показывается по настройке, размер выборки — всегда.
  await page.click(t('open-settings'));
  await page.uncheck(t('setting-own-counts'));
  await page.keyboard.press('Escape');
  assert.equal(await count(page, t('transition-own')), 0);
  assert.equal(await count(page, t('transition-selection')), 5);
  assert.deepEqual(page.problems, []);
});

test('новый заполненный узел становится промежуточным; удаление элемента восстанавливает соседство', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт');
  const before = ['+ кухня электрика', '+ бюджет кухня срочно'];
  assert.deepEqual(await transitions(page, 'descendants'), before);

  await addTags(page, 'кухня');
  await page.click(t('add-item'));
  assert.deepEqual(await editedTags(page), ['ремонт', 'кухня'], 'теги текущего узла предложены как начальная разметка');
  await page.fill(t('editor-title'), 'Ремонт кухни');
  await page.fill(t('editor-text'), 'Общие заметки о ремонте кухни');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  assert.deepEqual((await items(page)).map((item) => item.title), ['Ремонт кухни']);
  assert.equal(await page.textContent('[data-testid=mode-switch] [data-value=own] .segment-count'), '1');
  assert.equal(await page.textContent('[data-testid=mode-switch] [data-value=selection] .segment-count'), '4');

  await page.click('[data-testid=transition][data-label="− кухня"]');
  assert.deepEqual(await transitions(page, 'descendants'), ['+ кухня']);
  await shot(page, '02-intermediate-node');

  await page.click('[data-testid=transition][data-label="+ кухня"]');
  await page.click(t('item-delete'));
  await page.click(t('confirm-ok'));
  await page.waitForSelector(t('empty-own'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня'], 'после удаления последнего собственного элемента узел остаётся текущим');
  await page.click('[data-testid=transition][data-label="− кухня"]');
  assert.deepEqual(await transitions(page, 'descendants'), before);
  assert.deepEqual(page.problems, []);
});

test('автодополнение учитывает выборку узла; другой набор тегов задаётся явно', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await addTags(page, 'ремонт', 'кухня');
  await page.click('#nav-tag-input');
  assert.deepEqual(await suggested(page), ['бюджет', 'электрика', 'срочно']);
  await shot(page, '02-autocomplete');
  await page.fill('#nav-tag-input', 'с');
  assert.deepEqual(await suggested(page), ['срочно'], '«сад» не предлагается: его нет в выборке узла');
  await page.fill('#nav-tag-input', 'э');
  assert.deepEqual(await suggested(page), ['электрика']);
  await page.fill('#nav-tag-input', 'ре');
  assert.deepEqual(await suggested(page), [], 'уже выбранные теги не предлагаются');
  await page.fill('#nav-tag-input', 'ме');
  assert.deepEqual(await suggested(page), []);
  assert.equal(await count(page, t('suggest-none')), 1);

  // Подсказка добавляет тег щелчком.
  await page.fill('#nav-tag-input', 'бю');
  await page.click('[data-suggest="бюджет"]');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'бюджет']);
  await page.click('[data-testid=node-tags] [data-tag="бюджет"] .tag-remove');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);

  // Тег вне выборки: подсказки нет, но полное название принимается.
  await page.fill('#nav-tag-input', 'сад');
  assert.deepEqual(await suggested(page), []);
  assert.equal(await count(page, t('suggest-outside')), 1);
  await page.keyboard.press('Enter');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'сад']);
  assert.equal(await count(page, t('empty-selection')), 1);

  // Тега нет в рабочей области: переход не выполняется.
  await page.fill('#nav-tag-input', 'нет_такого');
  await page.keyboard.press('Enter');
  assert.match(await page.textContent(t('tag-input-error')), /нет в рабочей области/);
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'сад']);

  // Несколько тегов одной строкой.
  await page.click(t('nav-root'));
  await page.fill('#nav-tag-input', 'ремонт, кухня электрика ');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'электрика']);
  assert.deepEqual(page.problems, []);
});

test('история переходов, выход в корень, сохранение режима и сортировки', async () => {
  const id = await createWorkspace(env.base, 'demo');
  const page = await openWorkspace(env.context, env.base, id);
  const disabled = (testId) => page.isDisabled(t(testId));
  assert.equal(await disabled('nav-back'), true);
  assert.equal(await disabled('nav-root'), true);

  await setMode(page, 'selection');
  await setSort(page, 'title');
  await addTags(page, 'ремонт');
  await addTags(page, 'кухня');
  await page.click(t('nav-root'));
  assert.deepEqual(await nodeTags(page), [], 'выход в корень снимает все теги одним действием');
  await addTags(page, 'сад');
  assert.equal(await disabled('nav-forward'), true);

  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), []);
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  await page.click(t('nav-forward'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  assert.equal(await activeValue(page, 'mode-switch'), 'selection');
  assert.equal(await activeValue(page, 'sort-switch'), 'title');

  // Изменение данных не создаёт посещения и не удаляет продолжение истории.
  await op(env.base, id, { type: 'createItem', title: 'Со стороны', content: text('Добавлено мимо интерфейса'), tags: ['ремонт'] });
  await page.click(t('add-item'));
  await page.fill(t('editor-title'), 'Новая запись');
  await page.fill(t('editor-text'), 'Запись о ремонте кухни');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  assert.equal(await disabled('nav-forward'), false);
  await page.click(t('nav-forward'));
  assert.deepEqual(await nodeTags(page), []);
  await page.click(t('nav-forward'));
  assert.deepEqual(await nodeTags(page), ['сад']);
  assert.equal(await disabled('nav-forward'), true);

  // Новый переход после возврата заменяет прежнее продолжение.
  await page.click(t('nav-back'));
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  await page.click('[data-testid=transition][data-label="− ремонт"]');
  assert.deepEqual(await nodeTags(page), ['кухня']);
  assert.equal(await disabled('nav-forward'), true);
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);

  // Клавиатура: Alt+← и Alt+→.
  await page.keyboard.press('Alt+ArrowLeft');
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);

  await page.click(t('nav-root'));
  assert.equal(await activeValue(page, 'mode-switch'), 'selection');
  assert.equal(await activeValue(page, 'sort-switch'), 'title');
  assert.deepEqual(page.problems, []);
});

test('компактный набор переходов; остальные доступны по запросу; длинный набор тегов', async () => {
  const id = await createWorkspace(env.base, 'demo');
  const many = ['альфа', 'бета', 'гамма', 'дельта', 'эпсилон', 'дзета', 'эта', 'тета', 'йота'];
  for (const name of many) await op(env.base, id, { type: 'createItem', title: name, content: text(`Запись ${name}`), tags: [name] });
  const page = await openWorkspace(env.context, env.base, id);

  assert.equal((await transitions(page, 'descendants')).length, 6, 'по умолчанию — компактный набор');
  assert.equal(await page.textContent('[data-testid=descendants] [data-testid=transition-toggle]'), 'Показать все переходы: 14');
  await page.click('[data-testid=descendants] [data-testid=transition-toggle]');
  assert.equal((await transitions(page, 'descendants')).length, 12, 'первая страница');
  assert.match(await page.textContent(t('transition-pager')), /1–12 из 14/);
  await page.click('[data-testid=transition-pager] [aria-label="Следующая страница"]');
  // В обозначении перечислены все добавляемые теги.
  assert.deepEqual(await transitions(page, 'descendants'), ['+ 10 анна день_рождения июнь', '+ 5 артемьев день_рождения игорь май']);
  await page.fill(t('transition-filter'), 'сад');
  assert.deepEqual(await transitions(page, 'descendants'), ['+ сад']);
  await shot(page, '02-all-descendants');
  await page.fill(t('transition-filter'), '');
  await page.click('[data-testid=transition-pager] [aria-label="Следующая страница"]');
  await page.click('[data-testid=transition][data-label="+ 5 артемьев день_рождения игорь май"]');
  assert.deepEqual((await nodeTags(page)).sort(), ['5', 'артемьев', 'день_рождения', 'игорь', 'май']);

  // Длинный набор тегов: девять выбранных тегов, девять соседних предков.
  await page.click(t('nav-root'));
  await page.fill('#nav-tag-input', `${many.join(' ')} `);
  assert.deepEqual(await nodeTags(page), many);
  assert.equal(await count(page, t('empty-selection')), 1);
  assert.equal((await transitions(page, 'ancestors')).length, 6);
  await page.click('[data-testid=ancestors] [data-testid=transition-toggle]');
  assert.equal((await transitions(page, 'ancestors')).length, 9);
  assert.ok((await transitions(page, 'ancestors')).every((label) => label.split(' ').length === 9), 'каждый переход перечисляет все восемь удаляемых тегов');
  await shot(page, '02-long-tag-set');
  await page.setViewportSize({ width: 420, height: 800 });
  for (const testId of ['nav-root', 'nav-back', 'add-item', 'mode-switch']) {
    assert.equal(await page.isVisible(t(testId)), true, `${testId} доступен на узком экране`);
  }
  await shot(page, '02-long-tag-set-narrow');
  assert.deepEqual(page.problems, []);
});
