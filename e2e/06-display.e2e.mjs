// Вторая итерация, CHECKS.md: «Обозримость» (предел количества), «Постраничный просмотр
// и крайние позиции», «Навигация и сохранение выбора».
// Данные: набор E0–E9, четыре элемента с медиа и пять элементов {сад}; значения N и P указаны в каждом сценарии.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, api, extendedWorkspace, createWorkspace, openWorkspace, addTags, nodeTags, items, itemIds, transitions, setMode, setSort,
  setDisplay, setNumberSetting, segmentCount, hiddenCount, activeValue, count, menuAction, shot, t,
} from './helpers.mjs';
import { createIndex, selectionOf, ownItemsOf, sortItems } from '../shared/model.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const closed = (page) => page.waitForSelector(t('item-dialog'), { state: 'detached' });

/** Ожидаемый порядок идентификаторов выбранного состава по данным сервера. */
async function expectedIds(id, names, mode, sort) {
  const { workspace } = await api(env.base, 'GET', `/api/workspaces/${id}`);
  const index = createIndex(workspace);
  const tagIds = names.map((name) => index.tagByName.get(name).id);
  return sortItems(mode === 'own' ? ownItemsOf(index, tagIds) : selectionOf(index, tagIds), sort).map((item) => item.id);
}

async function addItem(page, title) {
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), `Текст «${title}»`);
  await page.fill(t('editor-title'), title);
  await page.click(t('editor-save'));
  await closed(page);
}

for (const mode of ['own', 'selection']) {
  const label = mode === 'own' ? 'собственные элементы' : 'выборка узла';
  // Узел {сад}: 6 собственных элементов, 7 элементов выборки.
  const total = mode === 'own' ? 6 : 7;

  test(`предел N=${total}, ${label}: при N показаны все, при N+1 скрыты; изменение данных и предела без перехода`, async () => {
    const id = await extendedWorkspace(env.base, { limit: total });
    const page = await openWorkspace(env.context, env.base, id);
    await setMode(page, mode);
    await addTags(page, 'сад');
    assert.equal(await activeValue(page, 'display-switch'), 'limit', 'способ по умолчанию — предел количества');
    assert.equal((await items(page)).length, total, 'при N элементах показаны все');
    assert.equal(await hiddenCount(page), null);

    // N+1: добавление элемента без перехода в другой узел.
    await addItem(page, 'Слива');
    assert.deepEqual(await nodeTags(page), ['сад']);
    assert.equal(await hiddenCount(page), total + 1, 'при N+1 элементы скрыты');
    assert.equal((await items(page)).length, 0);
    assert.equal(await segmentCount(page, 'mode-switch', mode), total + 1, 'счётчик показывает полное число');
    await shot(page, `06-hidden-${mode}`);

    // Удаление элемента возвращает показ: удаляем через запрошенные крайние позиции.
    await page.click(t('show-first'));
    await menuAction(page, page.locator('[data-testid=item]', { hasText: 'Слива' }), 'item-delete');
    await page.click(t('confirm-ok'));
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=item-list] [data-testid=item]').length === n, total);
    assert.equal(await hiddenCount(page), null);

    // Изменение предела в настройках.
    await setNumberSetting(page, 'setting-limit', total - 1);
    assert.equal(await hiddenCount(page), total);
    assert.match(await page.textContent(t('hidden-state')), new RegExp(`Больше предела: ${total - 1}`));
    await setNumberSetting(page, 'setting-limit', total);
    assert.equal((await items(page)).length, total);
    assert.deepEqual(page.problems, []);
  });
}

test('сужение и расширение набора тегов пересчитывают показ в обе стороны; собственных мало, выборка больше N (N=4)', async () => {
  const id = await extendedWorkspace(env.base, { limit: 4 });
  const page = await openWorkspace(env.context, env.base, id);
  await setMode(page, 'selection');
  assert.equal(await hiddenCount(page), 18, 'корень: выборка больше предела');
  await addTags(page, 'ремонт');
  assert.equal(await hiddenCount(page), 6);
  await addTags(page, 'кухня');
  assert.equal(await hiddenCount(page), null, 'сужение до 4 элементов открывает показ');
  assert.equal((await items(page)).length, 4);
  await page.click('[data-testid=node-tags] [data-tag="кухня"] .tag-remove');
  assert.equal(await hiddenCount(page), 6, 'расширение снова скрывает');

  // Собственных элементов мало, а выборка больше N.
  await setMode(page, 'own');
  assert.deepEqual((await items(page)).map((item) => item.title), ['Ремонт']);
  assert.equal(await hiddenCount(page), null);
  await setMode(page, 'selection');
  assert.equal(await hiddenCount(page), 6, 'при переключении на выборку действует её количество');
  assert.deepEqual(page.problems, []);
});

test('скрытое множество и действительно пустое множество различимы (N=1)', async () => {
  const id = await extendedWorkspace(env.base, { limit: 1 });
  const page = await openWorkspace(env.context, env.base, id);
  await setMode(page, 'selection');
  assert.equal(await hiddenCount(page), 18);
  assert.equal(await count(page, t('empty-selection')), 0);
  assert.match(await page.textContent(t('hidden-state')), /Скрыто элементов: 18/);

  await page.fill('#nav-tag-input', 'мечта');
  await page.keyboard.press('Enter');
  assert.equal(await hiddenCount(page), null);
  assert.equal(await count(page, t('empty-selection')), 1);
  assert.match(await page.textContent(t('empty-selection')), /Нет элементов с выбранными тегами/);
  await shot(page, '06-empty-not-hidden');

  // Незаполненный узел с непустой выборкой: собственных нет, выборка скрыта.
  await page.click(t('nav-root'));
  await addTags(page, 'ремонт', 'кухня');
  await setMode(page, 'own');
  assert.equal(await count(page, t('empty-own')), 1);
  assert.equal(await hiddenCount(page), null);
  await setMode(page, 'selection');
  assert.equal(await hiddenCount(page), 4);
  for (const display of ['fit', 'pages']) {
    await page.click(t('nav-root'));
    await page.fill('#nav-tag-input', 'мечта');
    await page.keyboard.press('Enter');
    await setDisplay(page, display);
    assert.equal(await count(page, t('empty-selection')), 1, `пустое множество при способе ${display}`);
    assert.equal(await hiddenCount(page), null);
    await page.click(t('nav-back'));
    await page.click(t('nav-back'));
  }
  assert.deepEqual(page.problems, []);
});

for (const mode of ['own', 'selection']) {
  const label = mode === 'own' ? 'собственные элементы' : 'выборка узла';
  const total = mode === 'own' ? 6 : 7;

  test(`страницы, ${label} (N=2, P=3): без пропусков и повторов, неполная последняя страница, изменение P, сортировка`, async () => {
    const id = await extendedWorkspace(env.base, { limit: 2, pageSize: 3 });
    const page = await openWorkspace(env.context, env.base, id);
    await setMode(page, mode);
    await addTags(page, 'сад');
    assert.equal(await hiddenCount(page), total, 'количество больше N');
    await page.click(t('show-pages'));
    assert.equal(await activeValue(page, 'display-switch'), 'pages', 'страницы доступны независимо от предела');

    const walk = async () => {
      const seen = [];
      const sizes = [];
      const pages = Number(await page.getAttribute(t('pager'), 'data-pages'));
      for (let n = 1; n <= pages; n++) {
        assert.equal(await page.getAttribute(t('pager'), 'data-page'), String(n));
        const ids = await itemIds(page);
        sizes.push(ids.length);
        seen.push(...ids);
        if (n < pages) await page.click('[data-testid=pager] [data-testid=page-next]');
      }
      assert.equal(await page.isDisabled('[data-testid=pager] [data-testid=page-next]'), true);
      return { seen, sizes };
    };

    let result = await walk();
    assert.deepEqual(result.sizes, mode === 'own' ? [3, 3] : [3, 3, 1]);
    assert.deepEqual(result.seen, await expectedIds(id, ['сад'], mode, 'time'), 'страницы охватывают состав по порядку сортировки');
    assert.match(await page.textContent(t('pager-label')), new RegExp(`${mode === 'own' ? '4–6' : '7–7'} из ${total}`));
    await shot(page, `06-pages-${mode}`);

    // Изменение P: номер страницы сбрасывается, охват прежний.
    await setNumberSetting(page, 'setting-page-size', 4);
    assert.equal(await page.getAttribute(t('pager'), 'data-page'), '1');
    result = await walk();
    assert.deepEqual(result.sizes, mode === 'own' ? [4, 2] : [4, 3]);
    assert.deepEqual(result.seen, await expectedIds(id, ['сад'], mode, 'time'));

    // Сортировка по названию: одинаковые названия — недавно изменённый первым, без названия — в конце.
    await setSort(page, 'title');
    assert.equal(await page.getAttribute(t('pager'), 'data-page'), '1');
    result = await walk();
    assert.deepEqual(result.seen, await expectedIds(id, ['сад'], mode, 'title'));
    await page.click('[data-testid=pager] [data-testid=page-first]');
    const titles = (await items(page)).map((item) => `${item.title}: ${item.text?.slice(0, 15) ?? ''}`);
    assert.deepEqual(titles.slice(0, 3), ['Айва: Собрать урожай', 'Груша: Абзац 1. Груша ', mode === 'own' ? 'Яблоня: Купить саженец' : 'Сад за день: ']);

    // Страницы доступны и при числе элементов меньше предела.
    await setNumberSetting(page, 'setting-limit', 100);
    assert.equal(await count(page, t('pager')), 1);
    assert.equal((await items(page)).length, 4);
    assert.deepEqual(page.problems, []);
  });

  test(`крайние позиции, ${label} (N=3): первые и последние элементы текущей сортировки; смена сортировки не открывает показ`, async () => {
    const id = await extendedWorkspace(env.base, { limit: 3 });
    const page = await openWorkspace(env.context, env.base, id);
    await setMode(page, mode);
    await addTags(page, 'сад');
    assert.equal(await hiddenCount(page), total);

    // Сама смена сортировки не включает исключение для крайних позиций.
    await setSort(page, 'title');
    assert.equal(await hiddenCount(page), total);
    assert.equal((await items(page)).length, 0);
    await setSort(page, 'time');
    assert.equal(await hiddenCount(page), total);

    const byTime = await expectedIds(id, ['сад'], mode, 'time');
    await page.click(t('show-first'));
    assert.deepEqual(await itemIds(page), byTime.slice(0, 5));
    assert.match(await page.textContent(t('edge-head')), new RegExp(`Первые 5 из ${total}`));
    await shot(page, `06-edge-first-${mode}`);
    await page.click(t('show-last'));
    assert.deepEqual(await itemIds(page), byTime.slice(-5));
    assert.match(await page.textContent(t('edge-head')), new RegExp(`Последние 5 из ${total}`));

    // Запрошенные крайние позиции следуют текущей сортировке.
    const byTitle = await expectedIds(id, ['сад'], mode, 'title');
    await setSort(page, 'title');
    assert.deepEqual(await itemIds(page), byTitle.slice(-5));
    const last = await items(page);
    assert.deepEqual(last.slice(-2).map((item) => item.title), ['Без названия', 'Без названия'], 'элементы без названия — в конце');
    await page.click(t('show-first'));
    assert.deepEqual(await itemIds(page), byTitle.slice(0, 5));
    const yablonya = (await items(page)).filter((item) => item.title === 'Яблоня').map((item) => item.text);
    assert.deepEqual(yablonya, ['Купить саженец', 'Побелить ствол'], 'одинаковые названия — недавно изменённый первым');

    // Счётчики не ограничиваются показанными крайними элементами.
    assert.equal(await segmentCount(page, 'mode-switch', mode), total);
    await page.click(t('hide-edge'));
    assert.equal(await hiddenCount(page), total);
    // Запрос действует в пределах узла.
    await page.click(t('show-first'));
    await page.click(t('nav-root'));
    await page.click(t('nav-back'));
    assert.equal(await hiddenCount(page), total);
    assert.deepEqual(page.problems, []);
  });
}

test('навигация при скрытых элементах (N=1): ввод и удаление тегов, автодополнение, переходы, история, корень; счётчики не зависят от способа показа', async () => {
  const id = await extendedWorkspace(env.base, { limit: 1 });
  const page = await openWorkspace(env.context, env.base, id);
  await setMode(page, 'selection');
  assert.equal(await hiddenCount(page), 18);

  // Автодополнение и ввод тега.
  await page.fill('#nav-tag-input', 'ре');
  assert.deepEqual(await page.$$eval('[data-suggest]', (rows) => rows.map((row) => row.dataset.suggest)), ['ремонт']);
  await page.keyboard.press('Enter');
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  assert.equal(await hiddenCount(page), 6);

  // Счётчики и переходы одинаковы при всех способах показа.
  const snapshot = async () => ({
    own: await segmentCount(page, 'mode-switch', 'own'),
    selection: await segmentCount(page, 'mode-switch', 'selection'),
    down: await transitions(page, 'descendants'),
    up: await transitions(page, 'ancestors'),
    counts: await page.$$eval('[data-testid=transition-selection]', (cells) => cells.map((cell) => cell.textContent)),
  });
  const reference = await snapshot();
  assert.deepEqual([reference.own, reference.selection], [1, 6]);
  assert.deepEqual(reference.down, ['+ кухня электрика', '+ бюджет документ', '+ кухня эскиз', '+ бюджет кухня срочно']);
  for (const display of ['pages', 'fit', 'limit']) {
    await setDisplay(page, display);
    assert.deepEqual(await snapshot(), reference, `способ показа ${display}`);
  }
  await page.click(t('show-last'));
  assert.deepEqual(await snapshot(), reference, 'при показанных крайних позициях');

  // Предлагаемый переход, удаление тега, история и корень.
  await page.click('[data-testid=transition][data-label="+ кухня электрика"]');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'электрика']);
  assert.equal(await hiddenCount(page), 2);
  await page.click('[data-testid=node-tags] [data-tag="электрика"] .tag-remove');
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня']);
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'электрика']);
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['ремонт']);
  await page.click(t('nav-forward'));
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня', 'электрика']);
  await page.click(t('nav-root'));
  assert.deepEqual(await nodeTags(page), []);
  assert.equal(await hiddenCount(page), 18);
  assert.equal(await activeValue(page, 'mode-switch'), 'selection');
  assert.deepEqual(page.problems, []);
});

test('выбор состава, способа показа и сортировки сохраняется при изменении данных, переходах, истории, выходе в корень и перезапуске', async () => {
  const id = await extendedWorkspace(env.base, { limit: 3, pageSize: 4 });
  let page = await openWorkspace(env.context, env.base, id);
  const choice = async () => [await activeValue(page, 'mode-switch'), await activeValue(page, 'display-switch'), await activeValue(page, 'sort-switch')];
  assert.deepEqual(await choice(), ['own', 'limit', 'time'], 'начальный выбор');

  await setMode(page, 'selection');
  await setDisplay(page, 'pages');
  await setSort(page, 'title');
  const chosen = ['selection', 'pages', 'title'];

  await addTags(page, 'сад');
  assert.deepEqual(await choice(), chosen);
  await page.click('[data-testid=pager] [data-testid=page-next]');
  assert.equal(await page.getAttribute(t('pager'), 'data-page'), '2');
  // Изменение данных: выбор прежний, для нового результата показ пересчитан.
  await addItem(page, 'Вишня');
  assert.deepEqual(await choice(), chosen);
  assert.match(await page.textContent(t('pager-label')), /из 8/);
  await page.click('[data-testid=transition][data-label="− сад"]');
  assert.deepEqual(await choice(), chosen);
  assert.equal(await page.getAttribute(t('pager'), 'data-page'), '1', 'для нового узла страницы начинаются с первой');
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), ['сад']);
  assert.deepEqual(await choice(), chosen);
  await page.click(t('nav-forward'));
  await page.click(t('nav-back'));
  await page.click(t('nav-root'));
  assert.deepEqual(await nodeTags(page), []);
  assert.deepEqual(await choice(), chosen);

  // Способ «по вместимости экрана» тоже сохраняется.
  await setDisplay(page, 'fit');
  await addTags(page, 'мечта');
  assert.deepEqual(await choice(), ['selection', 'fit', 'title']);
  await page.waitForTimeout(300);
  await page.close();

  await env.restart();
  page = await openWorkspace(env.context, env.base, id);
  assert.deepEqual(await choice(), ['selection', 'fit', 'title']);
  assert.deepEqual(await nodeTags(page), ['мечта']);
  await page.click(t('open-settings'));
  assert.equal(await page.inputValue(t('setting-limit')), '3');
  assert.equal(await page.inputValue(t('setting-page-size')), '4');
  assert.deepEqual(page.problems, []);
});

test('начальные значения: предел 12, страница 10, пять крайних элементов; настройки принимают только допустимые числа', async () => {
  const id = await createWorkspace(env.base, 'demo-media', 'Начальные значения', null);
  const page = await openWorkspace(env.context, env.base, id);
  await setMode(page, 'selection');
  assert.equal(await hiddenCount(page), 13, 'в выборке корня 13 элементов — больше начального предела 12');
  assert.match(await page.textContent(t('hidden-state')), /Больше предела: 12/);
  await page.click(t('show-first'));
  assert.equal((await items(page)).length, 5);
  await page.click(t('hide-edge'));
  await page.click(t('show-pages'));
  assert.equal((await items(page)).length, 10);
  assert.match(await page.textContent(t('pager-label')), /1–10 из 13/);

  await page.click(t('open-settings'));
  assert.equal(await page.inputValue(t('setting-limit')), '12');
  assert.equal(await page.inputValue(t('setting-page-size')), '10');
  for (const bad of ['0', '-3', '2.5', '', '1000']) {
    await page.fill(t('setting-page-size'), bad);
    assert.equal(await page.getAttribute(t('setting-page-size'), 'aria-invalid'), 'true', `значение «${bad}» отклонено`);
  }
  await page.fill(t('setting-limit'), '13');
  await page.keyboard.press('Escape');
  assert.match(await page.textContent(t('pager-label')), /1–10 из 13/, 'недопустимый размер страницы не применён');
  await setDisplay(page, 'limit');
  assert.equal((await items(page)).length, 13);
  assert.deepEqual(page.problems, []);
});
