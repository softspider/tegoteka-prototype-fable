// Общие средства браузерных сценариев: отдельный сервер на временном каталоге
// данных и случайном порту 127.0.0.1, отдельная рабочая область на сценарий.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MEDIA = path.join(PROJECT, 'demo-media');
export const ARTIFACTS = path.join(PROJECT, 'e2e', 'artifacts');

export async function newDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tegoteka-e2e-'));
}

/** Запускает сервер прототипа отдельным процессом. */
export async function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(PROJECT, 'server', 'server.mjs')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', TEGOTEKA_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Сервер не запустился: ${log}`)), 10_000);
    const onData = (chunk) => {
      log += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`Сервер завершился с кодом ${code}: ${log}`)));
  });
  if (!base.startsWith('http://127.0.0.1:')) throw new Error(`Неожиданный адрес сервера: ${base}`);
  return {
    base,
    stop: () => new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    }),
  };
}

export async function api(base, method, url, body) {
  const response = await fetch(new URL(url, base), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${url}: ${data.error?.message}`);
  return data;
}

export async function createWorkspace(base, preset, name = `Проверка ${preset}`) {
  return (await api(base, 'POST', '/api/workspaces', { name, preset })).workspace.id;
}

export const op = (base, id, body) => api(base, 'POST', `/api/workspaces/${id}/ops`, body);

/** Открывает рабочую область на новой странице и ждёт готовности интерфейса. */
export async function openWorkspace(context, base, id) {
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', (error) => page.problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') page.problems.push(`console: ${message.text()}`);
  });
  await page.goto(`${base}#ws=${id}`);
  await page.waitForSelector(`[data-testid=app][data-workspace="${id}"]`);
  return page;
}

export const t = (id) => `[data-testid="${id}"]`;

/** Добавляет теги к выбранным через поле ввода. */
export async function addTags(page, ...names) {
  for (const name of names) {
    await page.fill('#nav-tag-input', name);
    await page.keyboard.press('Enter');
  }
}

export async function nodeTags(page) {
  return page.$$eval('[data-testid=node-tags] .tag-node', (tags) => tags.map((tag) => tag.dataset.tag));
}

/** Элементы списка: название, текст, признак собственного, теги. */
export async function items(page) {
  return page.$$eval('[data-testid=item-list] [data-testid=item]', (cards) => cards.map((card) => ({
    id: card.dataset.itemId,
    title: card.querySelector('[data-testid=item-title]').textContent,
    text: card.querySelector('[data-content=text]')?.textContent ?? null,
    kind: card.querySelector('[data-content]').dataset.content,
    own: card.dataset.own === 'true',
    badge: Boolean(card.querySelector('[data-testid=own-badge]')),
    tags: [...card.querySelectorAll('[data-testid=item-tags] .tag')].map((tag) => tag.dataset.tag),
  })));
}

const DEMO_TEXTS = {
  'Общая запись': 'E0', 'Подготовить ремонт': 'E1', 'Заметка о кухне': 'E2', 'План электрики при ремонте кухни': 'E3',
  'Срочно согласовать бюджет ремонта кухни': 'E4', 'Бюджет электрики при ремонте кухни': 'E5', 'Полить сад': 'E6',
  'Запись для последующей разметки': 'E9',
};

/** Обозначения E0–E9 для элементов демонстрационного набора в порядке показа. */
export async function labels(page) {
  return (await items(page)).map((item) => DEMO_TEXTS[item.text] ?? { Игорь: 'E7', Анна: 'E8' }[item.title] ?? item.title);
}

export async function transitions(page, group) {
  return page.$$eval(`[data-testid=${group}] [data-testid=transition]`, (rows) => rows.map((row) => row.dataset.label));
}

export async function setMode(page, mode) {
  await page.click(`[data-testid=mode-switch] [data-value=${mode}]`);
}

export async function setSort(page, sort) {
  await page.click(`[data-testid=sort-switch] [data-value=${sort}]`);
}

export async function activeValue(page, switchId) {
  return page.$eval(`[data-testid=${switchId}] .is-active`, (button) => button.dataset.value);
}

export const count = (page, selector) => page.locator(selector).count();

export async function unmarkedCount(page) {
  return Number((await page.textContent(t('unmarked-count'))).replace(/\s/g, ''));
}

/** Вводит теги в редакторе разметки открытого диалога или режима разметки. */
export async function typeMarkupTags(page, text) {
  const input = page.locator('[data-testid=markup-input] input').last();
  await input.fill(`${text} `);
}

export async function editedTags(page) {
  return page.locator('[data-testid=edited-tags] .tag').evaluateAll((tags) => tags.map((tag) => tag.dataset.tag));
}

export async function shot(page, name) {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

/** Общая обвязка файла сценариев: сервер, браузер, контекст. */
export async function setup() {
  const dataDir = await newDataDir();
  let server = await startServer(dataDir);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ru-RU' });
  return {
    dataDir,
    context,
    get base() {
      return server.base;
    },
    /** Перезапуск сервера на том же каталоге данных. */
    async restart() {
      await server.stop();
      server = await startServer(dataDir);
      return server.base;
    },
    async close() {
      await browser.close();
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
