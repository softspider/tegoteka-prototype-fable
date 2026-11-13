// Вторая итерация, CHECKS.md: «Интерфейс и приоритеты». Экраны 390×844 и 1440×1000, эмуляция в Chromium.
// Для каждого действия измеряется фактический путь: видимость без прокрутки и число нажатий.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  setup, createWorkspace, extendedWorkspace, openWorkspace, op, addTags, nodeTags, items, transitions, setMode, setDisplay,
  hiddenCount, count, shot, t, PHONE, DESKTOP, ARTIFACTS,
} from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const closed = (page) => page.waitForSelector(t('item-dialog'), { state: 'detached' });

/** Положение элемента и видимость целиком в окне без прокрутки. */
async function box(page, selector) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height),
      inViewport: r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
    };
  }, selector);
}
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const focusedId = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.id);

for (const [format, viewport] of [['смартфон 390×844', PHONE], ['десктоп 1440×1000', DESKTOP]]) {
  const tag = viewport === PHONE ? 'phone' : 'desktop';
  const phone = viewport === PHONE;

  test(`${format}: пути доступа к навигации, созданию, редактированию, способам показа и настройкам`, async (context) => {
    const report = {};
    // Начальные значения: N=12, P=10. Данные: набор E0–E9, четыре элемента с медиа, пять элементов {сад}.
    const page = await openWorkspace(env.context, env.base, await extendedWorkspace(env.base, null));
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);

    // 1. Навигация: всё видно без прокрутки сразу после открытия.
    report.navigation = {
      'поле ввода тега': await box(page, '#nav-tag-input'),
      'назад': await box(page, t('nav-back')),
      'в корень': await box(page, t('nav-root')),
      'первый переход': await box(page, t('transition')),
      'последний из компактного набора': await box(page, '[data-testid=descendants] li:nth-last-child(2) [data-testid=transition]'),
    };
    for (const [name, place] of Object.entries(report.navigation)) assert.equal(place.inViewport, true, `${name} виден без прокрутки`);
    assert.equal(await noSidewaysScroll(page), true);
    // Переход по предложению — одно нажатие.
    await page.click('[data-testid=transition][data-label="+ сад"]');
    assert.deepEqual(await nodeTags(page), ['сад']);
    // Ввод тега: нажатие на поле, ввод, нажатие на подсказку.
    await page.click(t('nav-root'));
    await page.click('#nav-tag-input');
    await page.keyboard.type('ре');
    const suggestion = await box(page, '[data-suggest="ремонт"]');
    assert.equal(suggestion.inViewport, true, 'подсказка видна целиком');
    await page.click('[data-suggest="ремонт"]');
    assert.deepEqual(await nodeTags(page), ['ремонт']);
    report.navigation['подсказка при вводе'] = suggestion;
    await page.click(t('nav-root'));

    // 2. Создание: кнопка видна без прокрутки; форма открывается с фокусом в поле текста.
    report.creation = { 'кнопка создания': await box(page, t('add-item')) };
    assert.equal(report.creation['кнопка создания'].inViewport, true);
    await page.click(t('add-item'));
    assert.equal(await focusedId(page), 'editor-text', 'после одного нажатия можно сразу вводить текст');
    report.creation['сохранить'] = await box(page, t('editor-save'));
    report.creation['поле тегов'] = await box(page, '[data-testid=markup-input] input');
    assert.equal(report.creation['сохранить'].inViewport, true);
    assert.equal(report.creation['поле тегов'].inViewport, true);
    assert.equal(await noSidewaysScroll(page), true);
    await page.keyboard.type('Новая запись');
    await shot(page, `09-create-form-${tag}`);
    // Видимая область уменьшена, как при открытой экранной клавиатуре: действия формы остаются доступны.
    await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
    await page.waitForTimeout(100);
    report.creation['сохранить при уменьшенной видимой области'] = await box(page, t('editor-save'));
    assert.equal(report.creation['сохранить при уменьшенной видимой области'].inViewport, true);
    await page.setViewportSize(viewport);
    await page.click(t('editor-save'));
    await closed(page);
    assert.equal((await items(page)).some((item) => item.text === 'Новая запись'), true, 'создание: два нажатия и ввод текста');

    // 3. Редактирование: кнопка на карточке, действия формы видны.
    await addTags(page, 'сад');
    report.editing = { 'изменить на первой карточке': await box(page, t('item-edit')) };
    assert.equal(report.editing['изменить на первой карточке'].inViewport, true);
    await page.click(t('item-edit'));
    report.editing['сохранить'] = await box(page, t('editor-save'));
    report.editing['удалить'] = await box(page, t('editor-delete'));
    assert.equal(report.editing['сохранить'].inViewport, true);
    assert.equal(report.editing['удалить'].inViewport, true);
    await page.fill(t('editor-title'), 'Айва (изменено)');
    await page.click(t('editor-save'));
    await closed(page);
    assert.equal((await items(page))[0].title, 'Айва (изменено)');
    // Меню карточки: перемещение и удаление — два нажатия.
    await setMode(page, 'selection');
    await page.click(t('item-menu'));
    report.editing['меню карточки'] = await box(page, '.menu-list');
    assert.equal(await count(page, t('item-delete')), 1);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.menu-list', { state: 'detached' });

    // 4. Способы отображения: три переключателя видны без прокрутки, смена — одно нажатие.
    await page.click(t('nav-root'));
    report.display = {
      'состав': await box(page, t('mode-switch')),
      'сортировка': await box(page, t('sort-switch')),
      'способ показа': await box(page, t('display-switch')),
    };
    for (const [name, place] of Object.entries(report.display)) assert.equal(place.inViewport, true, `${name} виден без прокрутки`);
    assert.equal(await hiddenCount(page), 19, 'выборка корня больше предела: состояние со скрытыми элементами');
    assert.equal(await box(page, t('hidden-state')).then((place) => place.inViewport), true);
    await shot(page, `09-hidden-${tag}`);
    await page.click(t('show-first'));
    await shot(page, `09-edge-${tag}`);
    await setDisplay(page, 'pages');
    assert.equal((await items(page)).length, 10);
    report.display['листание страниц'] = await box(page, '[data-testid=pager] [data-testid=page-next]');
    assert.equal(report.display['листание страниц'].inViewport, true);
    await shot(page, `09-page-${tag}`);
    assert.equal(await noSidewaysScroll(page), true);

    // Страница прокручена до конца: навигация и создание остаются под рукой.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    report.scrolled = {
      'поле ввода тега': await box(page, '#nav-tag-input'),
      'назад': await box(page, t('nav-back')),
      'кнопка создания': await box(page, t('add-item')),
      'переходы': await box(page, t('transition')),
      'листание страниц внизу': await box(page, '[data-testid=pager-bottom] [data-testid=page-next]'),
      'настройки': await box(page, t('open-settings')),
    };
    assert.equal(report.scrolled['поле ввода тега'].inViewport, true, 'панель узла закреплена');
    assert.equal(report.scrolled['назад'].inViewport, true);
    assert.equal(report.scrolled['кнопка создания'].inViewport, true, 'создание доступно без возврата к началу');
    assert.equal(report.scrolled['листание страниц внизу'].inViewport, true);
    assert.equal(report.scrolled['переходы'].inViewport, !phone, 'на широком экране переходы остаются рядом со списком');
    assert.equal(report.scrolled['настройки'].inViewport, false, 'настройки — низший приоритет: нужна прокрутка к началу');
    await page.evaluate(() => window.scrollTo(0, 0));

    // Обозримое множество.
    await setDisplay(page, 'limit');
    await addTags(page, 'ремонт', 'кухня');
    assert.equal((await items(page)).length, 4);
    await shot(page, `09-shown-${tag}`);

    // 5. Настройки: кнопка в верхней строке, изменение предела — нажатие и ввод числа.
    report.settings = { 'кнопка настроек': await box(page, t('open-settings')) };
    assert.equal(report.settings['кнопка настроек'].inViewport, true);
    await page.click(t('open-settings'));
    report.settings['предел'] = await box(page, t('setting-limit'));
    report.settings['размер страницы'] = await box(page, t('setting-page-size'));
    assert.equal(report.settings['предел'].inViewport, true);
    await page.fill(t('setting-limit'), '3');
    await shot(page, `09-settings-${tag}`);
    await page.keyboard.press('Escape');
    assert.equal(await hiddenCount(page), 4);

    // Размеры областей нажатия на узком экране.
    if (phone) {
      report.targets = {};
      for (const [name, selector] of Object.entries({
        'назад': t('nav-back'), 'в корень': t('nav-root'), 'создание': t('add-item'), 'переход': t('transition'),
        'переключатель': '[data-testid=display-switch] .segment', 'первые': t('show-first'),
      })) {
        const place = await box(page, selector);
        report.targets[name] = `${place.width}×${place.height}`;
        assert.ok(place.height >= 32, `${name}: высота области нажатия ${place.height}`);
      }
    }

    // Остальные экраны не требуют прокрутки вбок.
    await page.click(t('open-markup'));
    assert.equal(await noSidewaysScroll(page), true);
    assert.equal(await box(page, t('add-item')).then((place) => place.inViewport), true, 'создание доступно и в режиме разметки');
    await shot(page, `09-markup-${tag}`);
    await page.click(t('markup-exit'));
    await page.click(t('open-glossary'));
    assert.equal(await noSidewaysScroll(page), true);
    await shot(page, `09-glossary-${tag}`);
    await page.keyboard.press('Escape');

    await fs.mkdir(ARTIFACTS, { recursive: true });
    await fs.writeFile(path.join(ARTIFACTS, `layout-${tag}.json`), JSON.stringify(report, null, 2));
    for (const [group, entries] of Object.entries(report)) {
      for (const [name, place] of Object.entries(entries)) {
        context.diagnostic(`${group} · ${name}: ${typeof place === 'string' ? place : `y ${place.top}–${place.bottom}, ${place.inViewport ? 'виден' : 'не виден'}`}`);
      }
    }
    assert.deepEqual(page.problems, []);
  });

  test(`${format}: длинные теги, многочисленные переходы и длинный набор выбранных тегов`, async () => {
    const id = await createWorkspace(env.base, 'empty', 'Длинные теги', null);
    const text = (value) => ({ kind: 'text', text: value });
    const long = (n) => `категория_номер_${String(n).padStart(2, '0')}_с_длинным_названием`;
    for (let n = 1; n <= 30; n++) await op(env.base, id, { type: 'createItem', title: `Запись ${n}`, content: text(`Текст ${n}`), tags: [long(n)] });
    const eight = Array.from({ length: 8 }, (_, i) => long(i + 1));
    await op(env.base, id, { type: 'createItem', title: 'Восемь тегов', content: text('Запись с длинным набором'), tags: eight });
    const page = await openWorkspace(env.context, env.base, id);
    await page.setViewportSize(viewport);

    // Многочисленные переходы: компактный набор и остальные по запросу.
    assert.equal((await transitions(page, 'descendants')).length, 6);
    assert.equal((await page.textContent('[data-testid=descendants] [data-testid=transition-toggle]')).trim(), 'Все 30');
    assert.equal(await noSidewaysScroll(page), true);
    assert.equal((await box(page, t('add-item'))).inViewport, true);
    const switchBox = await box(page, t('display-switch'));
    assert.equal(switchBox.inViewport, true, `переключатели видны под компактным набором переходов: ${JSON.stringify(switchBox)}`);
    await page.click('[data-testid=descendants] [data-testid=transition-toggle]');
    assert.equal((await transitions(page, 'descendants')).length, 12);
    assert.equal(await count(page, t('transition-filter')), 1);
    assert.equal(await count(page, t('transition-pager')), 1);
    await page.fill(t('transition-filter'), '_17_');
    assert.deepEqual(await transitions(page, 'descendants'), [`+ ${long(17)}`]);
    assert.equal(await noSidewaysScroll(page), true);
    await shot(page, `09-many-transitions-${tag}`);
    await page.click('[data-testid=transition]');
    assert.deepEqual(await nodeTags(page), [long(17)]);

    // Длинный набор выбранных тегов: панель узла не вытесняет остальное.
    await page.click(t('nav-root'));
    await setMode(page, 'selection');
    await setDisplay(page, 'pages');
    await page.locator('[data-testid=item]', { hasText: 'Восемь тегов' }).locator(t('item-goto')).click();
    assert.deepEqual(await nodeTags(page), eight);
    const bar = await box(page, t('nodebar'));
    assert.ok(bar.height <= viewport.height * 0.45, `панель узла занимает ${bar.height} из ${viewport.height}`);
    for (const id of ['nav-back', 'nav-root', 'add-item']) assert.equal((await box(page, t(id))).inViewport, true, `${id} доступен`);
    assert.equal(await noSidewaysScroll(page), true);
    // Поле ввода тега видно и до нажатия на него, хотя набор тегов прокручивается внутри панели.
    const inputInsideBar = await page.evaluate(() => {
      const input = document.getElementById('nav-tag-input').getBoundingClientRect();
      const tags = document.querySelector('[data-testid=node-tags]').getBoundingClientRect();
      return input.top >= tags.top && input.bottom <= tags.bottom + 1;
    });
    assert.equal(inputInsideBar, true, 'поле ввода не скрыто за длинным набором тегов');
    // Ввод тега при длинном наборе: поле прокручивается в видимую часть панели, подсказки видны.
    await page.click('#nav-tag-input');
    assert.equal((await box(page, '#nav-tag-input')).inViewport, true);
    assert.equal(await count(page, t('suggestions')), 0, 'в выборке узла нет других тегов');
    await page.keyboard.type('категория_номер_09_с_длинным_названием');
    assert.equal((await box(page, t('suggestions'))).inViewport, true);
    await page.keyboard.press('Enter');
    assert.equal((await nodeTags(page)).length, 9);
    assert.equal(await count(page, t('empty-selection')), 1);
    assert.equal((await box(page, '#nav-tag-input')).inViewport, true, 'поле ввода остаётся видимым после добавления тега');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `09-long-tags-${tag}`);
    // Удаление тега из длинного набора и выход в корень — по одному нажатию.
    await page.click(`[data-testid=node-tags] [data-tag="${long(9)}"] .tag-remove`);
    assert.equal((await nodeTags(page)).length, 8);
    await page.click(t('nav-root'));
    assert.deepEqual(await nodeTags(page), []);
    assert.deepEqual(page.problems, []);
  });
}
