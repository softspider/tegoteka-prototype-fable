// Вторая итерация, CHECKS.md: «Сохранность и регрессия». Данные первой итерации в интерфейсе новой версии.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  setup, nodeTags, items, setMode, setDisplay, activeValue, hiddenCount, unmarkedCount, segmentCount, count, shot, t, PROJECT,
} from './helpers.mjs';

test('данные первой итерации: узел, записи, файлы, описания, разметка и настройки доступны после обновления', async () => {
  const env = await setup({ seed: path.join(PROJECT, 'tests', 'fixtures', 'iteration-1-data') });
  try {
    // Область не указана: открывается последняя, как при обычном запуске.
    const page = await env.context.newPage();
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto(env.base);
    await page.waitForSelector(t('app'));

    assert.deepEqual(await nodeTags(page), ['ремонт', 'кухня'], 'восстановлен последний посещённый узел');
    assert.equal(await activeValue(page, 'mode-switch'), 'selection');
    assert.equal(await activeValue(page, 'sort-switch'), 'title');
    assert.equal(await activeValue(page, 'display-switch'), 'limit', 'способ показа — по умолчанию');
    assert.deepEqual((await items(page)).map((item) => item.title), ['План', 'План', 'Смета', 'Эскиз кухни']);
    assert.equal(await unmarkedCount(page), 2);
    await page.waitForFunction(() => document.querySelector('[data-testid=item] img')?.naturalWidth === 640);
    await shot(page, '10-iteration-1-data');

    // История прежнего формата работает.
    await page.click(t('nav-back'));
    assert.deepEqual(await nodeTags(page), ['ремонт']);
    assert.equal(await segmentCount(page, 'mode-switch', 'selection'), 7);
    await page.click(t('nav-root'));
    // Выборка корня — 14 элементов: больше начального предела 12.
    assert.equal(await hiddenCount(page), 14);
    await setDisplay(page, 'pages');
    assert.equal((await items(page)).length, 10);
    await page.click('[data-testid=pager] [data-testid=page-next]');
    await page.waitForFunction(() => document.querySelector('[data-testid=item] audio')?.readyState >= 1
      || document.querySelector('[data-testid=item] video')?.readyState >= 1 || document.querySelectorAll('[data-testid=item]').length === 4);
    assert.equal((await items(page)).length, 4);

    // Настройки: прежнее отключение напоминания сохранено, новые параметры — начальные.
    await page.click(t('open-settings'));
    assert.equal(await page.isChecked(t('setting-reminder')), false);
    assert.equal(await page.inputValue(t('setting-limit')), '12');
    assert.equal(await page.inputValue(t('setting-page-size')), '10');
    await page.keyboard.press('Escape');
    await page.click(t('open-glossary'));
    assert.equal(await page.locator('[data-testid=glossary-row][data-tag="эскиз"]').locator(t('glossary-description')).textContent(), 'Рисунок от руки');
    assert.equal(await page.locator('[data-testid=glossary-row][data-tag="итерация_1"]').locator(t('glossary-description')).textContent(), 'Данные до обновления');
    await page.keyboard.press('Escape');

    // Неразмеченные элементы первой итерации доступны в режиме разметки.
    await page.click(t('open-markup'));
    assert.equal(await count(page, t('queue-item')), 2);
    await page.click(t('markup-exit'));
    await setMode(page, 'own');
    await page.waitForTimeout(300);
    await page.close();

    // После перезапуска новая версия читает уже своё состояние.
    await env.restart();
    const reopened = await env.context.newPage();
    await reopened.goto(env.base);
    await reopened.waitForSelector(t('app'));
    assert.deepEqual(await nodeTags(reopened), []);
    assert.equal(await activeValue(reopened, 'display-switch'), 'pages');
    assert.equal(await activeValue(reopened, 'mode-switch'), 'own');
    assert.deepEqual(problems, []);
  } finally {
    await env.close();
  }
});
