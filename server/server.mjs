// Локальный сервер прототипа Теготеки: отдаёт интерфейс и хранит данные на диске.
//
//   node server/server.mjs
//
// Переменные окружения: PORT (по умолчанию 4173), HOST (127.0.0.1),
// TEGOTEKA_DATA_DIR (каталог data/ в корне проекта), TEGOTEKA_MAX_FILE_MB (200).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, StoreError } from './store.mjs';
import { guessMime, isInlineSafe } from '../shared/content.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_ROOTS = { '/shared/': path.join(PROJECT, 'shared'), '/': path.join(PROJECT, 'public') };
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new StoreError(413, 'body_too_large', 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new StoreError(400, 'bad_json', 'Запрос не удалось разобрать.');
  }
}

async function serveStatic(req, res, pathname) {
  const prefix = pathname.startsWith('/shared/') ? '/shared/' : '/';
  const root = STATIC_ROOTS[prefix];
  const relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return sendJson(res, 404, { error: { message: 'Не найдено.' } });
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Не найдено');
  }
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

async function serveFile(req, res, store, workspaceId, fileId, download) {
  const info = await store.fileInfo(workspaceId, fileId);
  const inline = !download && isInlineSafe(info.mime);
  const headers = {
    'Content-Type': inline ? info.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(info.name)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'",
  };
  const range = parseRange(req.headers.range, info.size);
  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
    return res.end();
  }
  if (range) {
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      'Content-Length': range.end - range.start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(info.path, range).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(info.path).pipe(res);
}

async function handleApi(req, res, store, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const method = req.method;

  if (parts[0] !== 'workspaces') throw new StoreError(404, 'not_found', 'Не найдено.');
  if (parts.length === 1) {
    if (method === 'GET') return sendJson(res, 200, await store.list());
    if (method === 'POST') return sendJson(res, 201, { workspace: await store.create(await readJsonBody(req)) });
  }
  const id = parts[1];
  if (parts.length === 2) {
    if (method === 'GET') return sendJson(res, 200, await store.open(id));
    if (method === 'PATCH') return sendJson(res, 200, { workspace: await store.rename(id, (await readJsonBody(req)).name) });
    if (method === 'DELETE') {
      await store.remove(id);
      return sendJson(res, 200, { ok: true });
    }
  }
  if (parts.length === 3 && parts[2] === 'ops' && method === 'POST') {
    return sendJson(res, 200, await store.apply(id, await readJsonBody(req)));
  }
  if (parts.length === 3 && parts[2] === 'state' && method === 'PUT') {
    await store.saveState(id, await readJsonBody(req));
    return sendJson(res, 200, { ok: true });
  }
  if (parts.length === 3 && parts[2] === 'files' && method === 'POST') {
    const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')) || 'файл';
    let mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!mime || mime === 'application/octet-stream') mime = guessMime(name);
    const staged = await store.stageFile(id, req);
    return sendJson(res, 201, { ...staged, name, mime });
  }
  if (parts.length === 4 && parts[2] === 'files' && (method === 'GET' || method === 'HEAD')) {
    return serveFile(req, res, store, id, parts[3], url.searchParams.has('download'));
  }
  throw new StoreError(404, 'not_found', 'Не найдено.');
}

function isLocalRequest(req, allowAnyHost) {
  if (allowAnyHost) return true;
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Запускает сервер. Возвращает { url, port, dataDir, close() }. */
export async function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 4173);
  const dataDir = path.resolve(options.dataDir ?? process.env.TEGOTEKA_DATA_DIR ?? path.join(PROJECT, 'data'));
  const maxFileBytes = Number(process.env.TEGOTEKA_MAX_FILE_MB ?? 200) * 1024 * 1024;
  const allowAnyHost = host !== '127.0.0.1' && host !== 'localhost';

  const store = new Store({ dataDir, mediaDir: path.join(PROJECT, 'demo-media'), maxFileBytes });
  await store.init();

  const server = http.createServer(async (req, res) => {
    try {
      if (!isLocalRequest(req, allowAnyHost)) return sendJson(res, 403, { error: { code: 'forbidden', message: 'Запрос отклонён.' } });
      const url = new URL(req.url, 'http://local');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, store, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { message: 'Метод не поддерживается.' } });
      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error instanceof StoreError) {
        return sendJson(res, error.status, { error: { code: error.code, message: error.message } });
      }
      console.error(error);
      return sendJson(res, 500, { error: { code: 'internal', message: 'Внутренняя ошибка сервера. Подробности — в консоли сервера.' } });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}/`,
    dataDir,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const running = await startServer();
    console.log(`Теготека запущена: ${running.url}`);
    console.log(`Данные хранятся в каталоге: ${running.dataDir}`);
    console.log('Остановить: Ctrl+C');
    const stop = () => running.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error('Порт занят. Задайте другой: PORT=4180 npm start');
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}
