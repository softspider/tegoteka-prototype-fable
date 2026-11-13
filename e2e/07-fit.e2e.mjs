// Вторая итерация, CHECKS.md: «Обозримость» — показ по вместимости экрана.
// Данные: пустая область и по четыре элемента с одинаковой разметкой — короткие тексты {короткие},
// длинные тексты {длинные}; изображение и текст в {картинка}; один очень длинный текст {роман}.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, createWorkspace, openWorkspace, op, addTags, items, setMode, setDisplay, hiddenCount, segmentCount, count, shot, t,
  PHONE, DESKTOP, MEDIA,
} from './helpers.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const paragraph = 'Длинная заметка: порядок работ, материалы, сроки, договорённости с мастерами и всё, что нужно держать перед глазами при планировании. ';
const LONG = paragraph.repeat(4);
const NOVEL = paragraph.repeat(40);

async function fitWorkspace() {
  const id = await createWorkspace(env.base, 'empty', 'Вместимость экрана', { limit: 1, pageSize: 2 });
  const text = (value) => ({ kind: 'text', text: value });
  for (let n = 1; n <= 4; n++) await op(env.base, id, { type: 'createItem', title: `Короткая ${n}`, content: text(`Заметка ${n}`), tags: ['короткие'] });
  for (let n = 1; n <= 4; n++) await op(env.base, id, { type: 'createItem', title: `Длинная ${n}`, content: text(LONG), tags: ['длинные'] });
  await op(env.base, id, { type: 'createItem', title: 'Роман', content: text(NOVEL), tags: ['роман'] });
  // Потомок узла {короткие} с длинным текстом: входит в выборку, но не в собственные элементы.
  await op(env.base, id, { type: 'createItem', title: 'Длинный потомок', content: text(NOVEL), tags: ['короткие', 'подробно'] });
  return id;
}

/** Геометрия показа: помещается ли список от своего начала до нижней границы окна без прокрутки. */
async function geometry(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid=fit-area]')?.dataset.fits !== 'null');
  return page.evaluate(() => {
    const area = document.querySelector('[data-testid=fit-area]');
    const list = area.querySelector('.fit-list');
    const reserve = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fit-reserve'));
    const top = Math.round(area.getBoundingClientRect().top + window.scrollY);
    return {
      fits: area.dataset.fits === 'true',
      room: Number(area.dataset.room),
      expectedRoom: Math.floor(window.innerHeight - reserve - (area.getBoundingClientRect().top + window.scrollY)),
      listHeight: list ? list.offsetHeight : null,
      top,
      reserve,
      viewport: window.innerHeight,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
      visibleCards: document.querySelectorAll('[data-testid=item-list] [data-testid=item]').length,
      probeCards: document.querySelectorAll('[data-testid=probe-item]').length,
    };
  });
}

for (const [format, viewport] of [['смартфон 390×844', PHONE], ['десктоп 1440×1000', DESKTOP]]) {
  const tag = viewport === PHONE ? 'phone' : 'desktop';

  test(`${format}: одинаковое число коротких и длинных элементов — решение зависит от фактического размещения`, async () => {
    const page = await openWorkspace(env.context, env.base, await fitWorkspace());
    await page.setViewportSize(viewport);
    await setDisplay(page, 'fit');

    // Собственные элементы: четыре коротких помещаются.
    await addTags(page, 'короткие');
    let g = await geometry(page);
    assert.equal(g.room, g.expectedRoom, 'доступная область считается от начала списка до нижней границы окна за вычетом места управления');
    assert.equal(g.reserve, viewport === PHONE ? 84 : 20, 'на узком экране учитывается место кнопки создания');
    assert.equal(g.fits, true);
    assert.ok(g.listHeight <= g.room);
    assert.equal(g.visibleCards, 4);
    assert.equal(await hiddenCount(page), null);
    // Показанные элементы действительно целиком видны без прокрутки.
    const lastBottom = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid=item-list] [data-testid=item]');
      return cards[cards.length - 1].getBoundingClientRect().bottom;
    });
    assert.ok(lastBottom <= viewport.height - g.reserve, `нижний край последней карточки ${lastBottom} в пределах области`);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await shot(page, `07-fit-shown-${tag}`);

    // Столько же длинных элементов не помещаются: показ запрещён, скрытие содержания не применяется.
    await page.click(t('nav-root'));
    await addTags(page, 'длинные');
    g = await geometry(page);
    assert.equal(g.fits, false);
    assert.ok(g.listHeight > g.room, `высота списка ${g.listHeight} больше доступной ${g.room}`);
    assert.equal(g.visibleCards, 0);
    assert.equal(g.probeCards, 4, 'измерен полный список из четырёх карточек');
    assert.equal(await hiddenCount(page), 4);
    assert.equal(await page.getAttribute(t('hidden-state'), 'data-reason'), 'fit');
    assert.match(await page.textContent(t('hidden-state')), /Не помещаются на экране/);
    const clipped = await page.$$eval('[data-testid=probe-item] [data-content=text]', (texts) => texts.some((el) => el.scrollHeight > el.clientHeight + 1));
    assert.equal(clipped, false, 'текст карточек не обрезается и не прокручивается внутри');
    await shot(page, `07-fit-hidden-${tag}`);

    // Выборка узла: собственные помещаются, а выборка с длинным потомком — нет.
    await page.click(t('nav-root'));
    await addTags(page, 'короткие');
    assert.equal((await geometry(page)).fits, true);
    await setMode(page, 'selection');
    assert.equal(await segmentCount(page, 'mode-switch', 'selection'), 5);
    g = await geometry(page);
    assert.equal(g.fits, false);
    assert.equal(await hiddenCount(page), 5);
    await setMode(page, 'own');
    assert.equal((await geometry(page)).visibleCards, 4);
    assert.deepEqual(page.problems, []);
  });

  test(`${format}: один элемент, не помещающийся целиком, не считается поместившимся; он доступен через страницы и крайние позиции`, async () => {
    const page = await openWorkspace(env.context, env.base, await fitWorkspace());
    await page.setViewportSize(viewport);
    await setDisplay(page, 'fit');
    await addTags(page, 'роман');
    const g = await geometry(page);
    assert.equal(g.fits, false);
    assert.equal(g.probeCards, 1);
    assert.ok(g.listHeight > g.room);
    assert.equal(await hiddenCount(page), 1);

    await page.click(t('show-first'));
    assert.deepEqual((await items(page)).map((item) => item.title), ['Роман']);
    await page.click(t('hide-edge'));
    await page.click(t('show-pages'));
    assert.deepEqual((await items(page)).map((item) => item.title), ['Роман']);
    assert.deepEqual(page.problems, []);
  });
}

test('уменьшение и увеличение доступной области экрана пересчитывают условие', async () => {
  const page = await openWorkspace(env.context, env.base, await fitWorkspace());
  await page.setViewportSize(DESKTOP);
  await setDisplay(page, 'fit');
  await addTags(page, 'короткие');
  assert.equal((await geometry(page)).fits, true);

  // Меньше по высоте: те же четыре элемента перестают помещаться.
  await page.setViewportSize({ width: 1440, height: 480 });
  await page.waitForSelector(t('hidden-state'));
  let g = await geometry(page);
  assert.equal(g.fits, false);
  assert.equal(g.viewport, 480);
  assert.equal(await hiddenCount(page), 4);
  await page.setViewportSize(DESKTOP);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=item-list] [data-testid=item]').length === 4);
  assert.equal(await hiddenCount(page), null);

  // Уже по ширине: карточки становятся выше, переходы встают над списком.
  await page.setViewportSize({ width: 390, height: 520 });
  await page.waitForSelector(t('hidden-state'));
  g = await geometry(page);
  assert.equal(g.fits, false);
  assert.equal(g.reserve, 84);
  await page.setViewportSize(PHONE);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=item-list] [data-testid=item]').length === 4);

  // Пространство, занятое управлением: длинный набор выбранных тегов сдвигает список вниз.
  const before = (await geometry(page)).room;
  await page.click(t('nav-root'));
  const many = ['альфа_длинный_тег', 'бета_длинный_тег', 'гамма_длинный_тег', 'дельта_длинный_тег', 'эпсилон_длинный_тег', 'дзета_длинный_тег'];
  await page.click(t('open-glossary'));
  for (const name of many) {
    await page.fill(t('add-tag-name'), name);
    await page.click(t('add-tag-save'));
  }
  await page.keyboard.press('Escape');
  await page.click(t('add-item'));
  await page.fill(t('editor-text'), 'Запись с длинным набором тегов');
  await page.fill('[data-testid=markup-input] input', `${many.join(' ')} `);
  await page.click(t('editor-save'));
  await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  await page.click(t('notice-go'));
  g = await geometry(page);
  assert.ok(g.room < before, `доступная область уменьшилась: ${g.room} < ${before}`);
  assert.equal(g.room, g.expectedRoom);
  assert.deepEqual(page.problems, []);
});

test('загрузка изображения пересчитывает условие; до загрузки решение не принимается', async () => {
  const id = await createWorkspace(env.base, 'empty', 'Медиа и вместимость', { limit: 1 });
  let page = await openWorkspace(env.context, env.base, id);
  await page.setViewportSize({ width: 1440, height: 560 });
  // Элемент с изображением и два коротких текста с той же разметкой.
  await page.click(t('add-item'));
  await page.click('[data-testid=content-kind] [data-value=file]');
  await page.setInputFiles(t('editor-file'), path.join(MEDIA, 'kitchen-sketch.png'));
  await page.fill(t('editor-title'), 'Эскиз');
  await page.fill('[data-testid=markup-input] input', 'картинка ');
  await page.click(t('editor-save'));
  await page.waitForSelector(t('item-dialog'), { state: 'detached' });
  for (const title of ['Подпись 1', 'Подпись 2']) {
    await op(env.base, id, { type: 'createItem', title, content: { kind: 'text', text: 'Короткий текст' }, tags: ['картинка'] });
  }
  await page.close();

  // Изображение отдаётся с задержкой: пока его размеры неизвестны, элементы не показываются.
  page = await openWorkspace(env.context, env.base, id);
  await page.setViewportSize({ width: 1440, height: 560 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/files/*', async (route) => {
    await held;
    await route.continue();
  });
  await setDisplay(page, 'fit');
  await addTags(page, 'картинка');
  await page.waitForSelector(t('measuring'));
  assert.equal(await page.getAttribute(t('fit-area'), 'data-fits'), 'null');
  assert.equal(await count(page, '[data-testid=item-list] [data-testid=item]'), 0);
  assert.equal(await hiddenCount(page), null);
  const before = await page.evaluate(() => document.querySelector('.fit-list').offsetHeight);
  release();
  let g = await geometry(page);
  assert.ok(g.listHeight > before + 150, `после загрузки изображения список вырос: ${before} → ${g.listHeight}`);
  // 560 пикселей: три элемента с изображением не помещаются.
  assert.equal(g.fits, false);
  assert.equal(await hiddenCount(page), 3);
  await page.unroute('**/files/*');
  await shot(page, '07-fit-media-hidden');

  // Окно выше — помещаются, изображение видно целиком.
  await page.setViewportSize(DESKTOP);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=item-list] [data-testid=item]').length === 3);
  g = await geometry(page);
  assert.equal(g.fits, true);
  const image = await page.evaluate(() => {
    const img = document.querySelector('[data-testid=item-list] img');
    const box = img.getBoundingClientRect();
    return { natural: img.naturalWidth, bottom: box.bottom, ratio: Math.round((box.width / box.height) * 100) };
  });
  assert.equal(image.natural, 640);
  assert.equal(image.ratio, Math.round((640 / 420) * 100), 'изображение уменьшено пропорционально, а не обрезано');
  assert.ok(image.bottom <= DESKTOP.height);
  await shot(page, '07-fit-media-shown');
  assert.deepEqual(page.problems, []);
  await fs.access(path.join(MEDIA, 'kitchen-sketch.png'));
});
