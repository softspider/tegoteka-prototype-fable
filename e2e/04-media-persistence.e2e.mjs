// CHECKS.md, «Просмотр, медиа и сохранение».
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  setup, createWorkspace, openWorkspace, addTags, nodeTags, items, labels, setMode, setSort, activeValue, count,
  unmarkedCount, typeMarkupTags, shot, t, MEDIA,
} from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const closed = (page) => page.waitForSelector(t('item-dialog'), { state: 'detached' });
const card = (page, text) => page.locator('[data-testid=item]', { hasText: text });

async function addFile(page, { file, title, tags }) {
  await page.click(t('add-item'));
  await page.click('[data-testid=content-kind] [data-value=file]');
  await page.setInputFiles(t('editor-file'), file);
  await page.fill(t('editor-title'), title);
  await typeMarkupTags(page, tags);
  await page.click(t('editor-save'));
  await closed(page);
}

/** Проверяет, что содержимое файлов действительно доступно в браузере. */
async function mediaState(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid=item] img');
    const audio = document.querySelector('[data-testid=item] audio');
    const video = document.querySelector('[data-testid=item] video');
    return image?.complete && image.naturalWidth > 0 && audio?.readyState >= 1 && video?.readyState >= 1;
  });
  return page.evaluate(() => ({
    image: document.querySelector('[data-testid=item] img').naturalWidth,
    audio: Math.round(document.querySelector('[data-testid=item] audio').duration * 10) / 10,
    video: [document.querySelector('[data-testid=item] video').videoWidth, Math.round(document.querySelector('[data-testid=item] video').duration)],
  }));
}

test('сортировка по времени последнего изменения и по названию', async () => {
  const page = await openWorkspace(env.context, env.base, await createWorkspace(env.base, 'demo'));
  await setMode(page, 'selection');
  assert.equal(await activeValue(page, 'sort-switch'), 'time');
  assert.deepEqual(await labels(page), ['E8', 'E7', 'E6', 'E5', 'E4', 'E3', 'E2', 'E1', 'E0']);
  await setSort(page, 'title');
  // E6 без названия — в конце; среди двух «План» недавно изменённый E5 раньше E3.
  assert.deepEqual(await labels(page), ['E8', 'E7', 'E2', 'E0', 'E5', 'E3', 'E1', 'E4', 'E6']);
  await shot(page, '04-sort-by-title');

  // Изменение названия и изменение разметки обновляют время последнего изменения.
  await card(page, 'План электрики').locator(t('item-edit')).click();
  await page.fill(t('editor-title'), 'План');
  await page.click(t('editor-save'));
  await closed(page);
  assert.deepEqual(await labels(page), ['E8', 'E7', 'E2', 'E0', 'E5', 'E3', 'E1', 'E4', 'E6'], 'сохранение без изменений порядок не меняет');
  await card(page, 'Общая запись').locator(t('item-edit')).click();
  await page.fill(t('editor-title'), 'Общее, дополнено');
  await page.click(t('editor-save'));
  await closed(page);
  await card(page, 'План электрики').locator(t('item-edit')).click();
  await typeMarkupTags(page, 'схема');
  await page.click(t('editor-save'));
  await closed(page);
  assert.deepEqual(await labels(page), ['E8', 'E7', 'E2', 'E0', 'E3', 'E5', 'E1', 'E4', 'E6'], 'среди двух «План» первым стал изменённый E3');
  await setSort(page, 'time');
  assert.deepEqual((await labels(page)).slice(0, 3), ['E3', 'E0', 'E8']);
  assert.deepEqual(page.problems, []);
});

test('изображение, аудио, видео и другой файл: добавление, просмотр, замена, сохранность после перезапуска', async () => {
  const id = await createWorkspace(env.base, 'demo');
  let page = await openWorkspace(env.context, env.base, id);
  await addFile(page, { file: path.join(MEDIA, 'kitchen-sketch.png'), title: 'Эскиз кухни', tags: 'ремонт кухня эскиз' });
  await addFile(page, { file: path.join(MEDIA, 'birthday-melody.mp3'), title: 'Мелодия', tags: 'день_рождения музыка' });
  await addFile(page, { file: path.join(MEDIA, 'garden-timelapse.webm'), title: 'Сад за день', tags: 'сад видео' });
  await addFile(page, { file: path.join(MEDIA, 'renovation-estimate.pdf'), title: 'Смета ремонта', tags: 'ремонт бюджет документ' });

  await setMode(page, 'selection');
  const kinds = async () => Object.fromEntries((await items(page)).filter((item) => item.kind !== 'text' && item.kind !== 'empty')
    .map((item) => [item.title, item.kind]));
  assert.deepEqual(await kinds(), { 'Эскиз кухни': 'image', 'Мелодия': 'audio', 'Сад за день': 'video', 'Смета ремонта': 'file' });
  assert.deepEqual(await mediaState(page), { image: 640, audio: 4.1, video: [320, 4] });
  await shot(page, '04-media-list');

  // Воспроизведение видео и аудио.
  const played = await page.evaluate(async () => {
    const result = {};
    for (const name of ['video', 'audio']) {
      const media = document.querySelector(`[data-testid=item] ${name}`);
      media.muted = true;
      await media.play();
      await new Promise((resolve) => setTimeout(resolve, 700));
      media.pause();
      result[name] = media.currentTime > 0.2;
    }
    return result;
  });
  assert.deepEqual(played, { video: true, audio: true });

  // Другой файл открывается и скачивается; изображение открывается целиком.
  const hrefs = await card(page, 'Смета ремонта').locator('.file-row a').evaluateAll((links) => links.map((link) => link.href));
  assert.equal(hrefs.length, 2);
  const opened = await fetch(hrefs[0]);
  assert.equal(opened.headers.get('content-type'), 'application/pdf');
  assert.equal((await opened.arrayBuffer()).byteLength, (await fs.stat(path.join(MEDIA, 'renovation-estimate.pdf'))).size);
  assert.match((await fetch(hrefs[1])).headers.get('content-disposition'), /^attachment/);
  await card(page, 'Эскиз кухни').locator('.image-button').click();
  await page.waitForSelector(t('image-dialog'));
  await shot(page, '04-image-full');
  await page.keyboard.press('Escape');

  // При изменении разметки содержание доступно для просмотра и воспроизведения.
  const sketch = (await items(page)).find((item) => item.title === 'Эскиз кухни');
  await card(page, 'Эскиз кухни').locator(t('item-edit')).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=item-dialog] img')?.naturalWidth > 0);
  assert.equal(await page.locator('[data-testid=item-dialog] img').evaluate((image) => image.naturalWidth), 640);
  await typeMarkupTags(page, 'планировка');
  await shot(page, '04-edit-image-tags');
  await page.click(t('editor-save'));
  await closed(page);
  const retagged = (await items(page)).find((item) => item.title === 'Эскиз кухни');
  assert.equal(retagged.id, sketch.id);
  assert.deepEqual(retagged.tags, ['ремонт', 'кухня', 'эскиз', 'планировка']);
  await card(page, 'Сад за день').locator(t('item-edit')).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=item-dialog] video')?.readyState >= 1);
  assert.equal(await page.locator('[data-testid=item-dialog] video').evaluate((video) => video.videoWidth), 320);
  await page.click(t('editor-cancel'));
  await closed(page);

  // Замена файла: запись заменяется новым элементом, прежний файл удаляется с диска.
  // Файл передаётся из памяти: так проверяется и русское имя файла.
  const replacement = { name: 'заметки к смете.txt', mimeType: 'text/plain', buffer: Buffer.from('Уточнить цены на плитку.\n') };
  const estimate = (await items(page)).find((item) => item.title === 'Смета ремонта');
  await card(page, 'Смета ремонта').locator(t('item-edit')).click();
  await page.setInputFiles(t('editor-file'), replacement);
  await page.waitForSelector(t('content-changed-note'));
  await page.click(t('editor-save'));
  await page.click(t('reminder-save'));
  await closed(page);
  const replaced = (await items(page)).find((item) => item.title === 'Смета ремонта');
  assert.notEqual(replaced.id, estimate.id);
  assert.match(await card(page, 'Смета ремонта').locator('.file-name').textContent(), /заметки к смете\.txt/);
  const filesDir = path.join(env.dataDir, 'workspaces', id, 'files');
  assert.equal((await fs.readdir(filesDir)).length, 4, 'на диске — ровно четыре файла содержания');

  // Описание тега и состояние просмотра перед перезапуском.
  await page.click(t('open-glossary'));
  await page.locator('[data-testid=glossary-row][data-tag="эскиз"]').locator(t('glossary-describe')).click();
  await page.fill(t('description-input'), 'Рисунок от руки');
  await page.click(t('description-save'));
  await page.keyboard.press('Escape');
  await setSort(page, 'title');
  await addTags(page, 'ремонт', 'кухня');
  await page.waitForTimeout(300);
  await page.close();

  await env.restart();
  page = await openWorkspace(env.context, env.base, id);
  assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня'], 'восстановлен последний посещённый узел');
  assert.equal(await activeValue(page, 'mode-switch'), 'selection');
  assert.equal(await activeValue(page, 'sort-switch'), 'title');
  assert.deepEqual((await items(page)).map((item) => item.title), ['План', 'План', 'Смета', 'Эскиз кухни']);
  await page.click(t('nav-back'));
  await page.click(t('nav-back'));
  assert.deepEqual(await nodeTags(page), [], 'история переходов сохранена');

  assert.deepEqual(await kinds(), { 'Эскиз кухни': 'image', 'Мелодия': 'audio', 'Сад за день': 'video', 'Смета ремонта': 'file' });
  assert.deepEqual(await mediaState(page), { image: 640, audio: 4.1, video: [320, 4] });
  const byTitle = Object.fromEntries((await items(page)).map((item) => [item.title, item.tags]));
  assert.deepEqual(byTitle['Эскиз кухни'], ['ремонт', 'кухня', 'эскиз', 'планировка']);
  assert.deepEqual(byTitle['Мелодия'], ['день_рождения', 'музыка']);
  assert.deepEqual(byTitle['Сад за день'], ['сад', 'видео']);
  assert.deepEqual(byTitle['Смета ремонта'], ['ремонт', 'бюджет', 'документ']);
  assert.deepEqual(byTitle['Игорь'], ['день_рождения', 'май', '5', 'игорь', 'артемьев']);
  assert.equal(await unmarkedCount(page), 1, 'состояние разметки сохранено');
  const note = await fetch(await card(page, 'Смета ремонта').locator('.file-row a').first().getAttribute('href').then((href) => new URL(href, env.base)));
  assert.equal(await note.text(), 'Уточнить цены на плитку.\n');
  await page.click(t('open-glossary'));
  assert.equal(await page.locator('[data-testid=glossary-row][data-tag="эскиз"]').locator(t('glossary-description')).textContent(), 'Рисунок от руки');
  assert.equal(await page.locator('[data-testid=glossary-row][data-tag="бюджет"]').locator(t('glossary-description')).textContent(), 'Планируемые расходы');
  for (const name of await fs.readdir(filesDir)) assert.ok((await fs.stat(path.join(filesDir, name))).size > 0);
  assert.deepEqual(page.problems, []);
});

test('заготовка с примерами медиа открывается с готовыми файлами', async () => {
  const id = await createWorkspace(env.base, 'demo-media');
  const page = await openWorkspace(env.context, env.base, id);
  await setMode(page, 'selection');
  assert.equal((await items(page)).length, 13);
  assert.deepEqual(await mediaState(page), { image: 640, audio: 4.1, video: [320, 4] });
  await shot(page, '04-demo-media');
  assert.deepEqual(page.problems, []);
});

test('пустая рабочая область: первый запуск, первая запись, первый тег, первый неразмеченный элемент', async () => {
  const fresh = await setup();
  try {
    let page = await fresh.context.newPage();
    page.problems = [];
    page.on('pageerror', (error) => page.problems.push(error.message));
    await page.goto(fresh.base);
    await page.waitForSelector(t('welcome'));
    await shot(page, '04-first-launch');
    await page.check(t('preset-empty'));
    await page.fill(t('workspace-name'), 'Мои записи');
    await page.click(t('workspace-create'));
    await page.waitForSelector(t('app'));
    assert.deepEqual(await nodeTags(page), [], 'первый запуск — в корне');
    assert.equal(await count(page, t('empty-workspace')), 1);
    assert.equal(await count(page, t('transition')), 0);
    await shot(page, '04-empty-workspace');

    // Первая запись и первый тег.
    await page.click(t('add-item'));
    await page.fill(t('editor-title'), 'Первая');
    await page.fill(t('editor-text'), 'Первая запись');
    await typeMarkupTags(page, 'начало');
    assert.equal(await count(page, '[data-testid=new-tags] .fresh-row'), 1);
    await page.click(t('editor-save'));
    await closed(page);
    assert.equal(await count(page, t('empty-own')), 1, 'у корня нет собственных элементов, но есть заполненный потомок');
    assert.deepEqual(await page.$$eval('[data-testid=transition]', (rows) => rows.map((row) => row.dataset.label)), ['+ начало']);
    await page.click(t('notice-go'));
    assert.deepEqual(await nodeTags(page), ['начало']);
    assert.deepEqual((await items(page)).map((item) => item.title), ['Первая']);

    // Первый неразмеченный элемент.
    await page.click(t('add-item'));
    await page.fill(t('editor-text'), 'Без тегов и без названия');
    await page.click(t('editor-save-unmarked'));
    await closed(page);
    assert.equal(await unmarkedCount(page), 1);
    await page.click(t('open-markup'));
    assert.equal(await page.getAttribute(t('markup-progress'), 'data-done'), '1');
    assert.equal(await page.getAttribute(t('markup-progress'), 'data-total'), '2');
    assert.deepEqual(page.problems, []);
    await page.waitForTimeout(300);
    await page.close();

    // Повторное открытие без указания области: восстановлены область и последний узел.
    await fresh.restart();
    page = await fresh.context.newPage();
    await page.goto(fresh.base);
    await page.waitForSelector(t('app'));
    assert.deepEqual(await nodeTags(page), ['начало']);
    assert.equal(await unmarkedCount(page), 1);
  } finally {
    await fresh.close();
  }
});
