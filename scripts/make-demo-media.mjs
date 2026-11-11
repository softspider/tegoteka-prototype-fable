// Воспроизводимо создаёт примеры медиа в demo-media/: изображение, аудио,
// видео и документ. Нужны ffmpeg и Playwright (Chromium). Готовые файлы уже
// лежат в репозитории; сценарий нужен, только чтобы получить их заново.
//
//   node scripts/make-demo-media.mjs

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo-media');

function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg завершился с кодом ${code}`))));
    child.stdin.end(input);
  });
}

const FONT = "font-family: 'DejaVu Sans', Arial, sans-serif";

const KITCHEN = `<!doctype html><html><body style="margin:0;background:#fbfaf6">
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" style="${FONT}">
  <rect width="640" height="420" fill="#fbfaf6"/>
  <text x="32" y="44" font-size="22" font-weight="700" fill="#1c1b1a">Эскиз кухни</text>
  <text x="32" y="68" font-size="13" fill="#6b665e">Планировка 3,6 × 2,8 м · вид сверху</text>
  <rect x="60" y="96" width="520" height="280" fill="#fff" stroke="#1c1b1a" stroke-width="6"/>
  <rect x="66" y="102" width="330" height="58" fill="#dff1ee" stroke="#0f6e63" stroke-width="2"/>
  <text x="80" y="137" font-size="14" fill="#0a544b">Рабочая поверхность</text>
  <rect x="270" y="110" width="78" height="42" rx="6" fill="#fff" stroke="#0f6e63" stroke-width="2"/>
  <circle cx="309" cy="131" r="6" fill="none" stroke="#0f6e63" stroke-width="2"/>
  <text x="283" y="176" font-size="11" fill="#6b665e">мойка</text>
  <rect x="396" y="102" width="70" height="58" fill="#f9eadc" stroke="#9c4a17" stroke-width="2"/>
  <circle cx="416" cy="120" r="8" fill="none" stroke="#9c4a17" stroke-width="2"/><circle cx="446" cy="120" r="8" fill="none" stroke="#9c4a17" stroke-width="2"/>
  <circle cx="416" cy="143" r="8" fill="none" stroke="#9c4a17" stroke-width="2"/><circle cx="446" cy="143" r="8" fill="none" stroke="#9c4a17" stroke-width="2"/>
  <text x="408" y="176" font-size="11" fill="#6b665e">плита</text>
  <rect x="504" y="102" width="70" height="70" fill="#eceae6" stroke="#55524d" stroke-width="2"/>
  <text x="498" y="190" font-size="11" fill="#6b665e">холодильник</text>
  <rect x="210" y="236" width="170" height="88" rx="10" fill="#fdf6df" stroke="#d9a520" stroke-width="2"/>
  <text x="272" y="285" font-size="14" fill="#6b5310">Стол</text>
  <circle cx="190" cy="280" r="13" fill="#fff" stroke="#d9a520" stroke-width="2"/><circle cx="400" cy="280" r="13" fill="#fff" stroke="#d9a520" stroke-width="2"/>
  <circle cx="295" cy="218" r="13" fill="#fff" stroke="#d9a520" stroke-width="2"/><circle cx="295" cy="342" r="13" fill="#fff" stroke="#d9a520" stroke-width="2"/>
  <line x1="60" y1="300" x2="60" y2="356" stroke="#fbfaf6" stroke-width="8"/>
  <path d="M60 356 A56 56 0 0 1 116 300" fill="none" stroke="#55524d" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="72" y="368" font-size="11" fill="#6b665e">дверь</text>
  <line x1="470" y1="376" x2="560" y2="376" stroke="#7fb6e6" stroke-width="8"/>
  <text x="494" y="366" font-size="11" fill="#6b665e">окно</text>
  <g fill="#b3261e"><circle cx="150" cy="96" r="5"/><circle cx="360" cy="96" r="5"/><circle cx="580" cy="230" r="5"/></g>
  <text x="444" y="404" font-size="11" fill="#b3261e">● розетки</text>
</svg></body></html>`;

const ESTIMATE = `<!doctype html><html lang="ru"><body style="${FONT}; margin: 36px; color: #1c1b1a">
<h1 style="font-size: 22px; margin: 0 0 4px">Смета ремонта кухни</h1>
<p style="margin: 0 0 18px; color: #55524d; font-size: 12px">Демонстрационный документ прототипа Теготеки</p>
<table style="border-collapse: collapse; width: 100%; font-size: 13px">
  <tr style="background: #dff1ee"><th style="text-align:left;padding:6px 8px;border:1px solid #cdc7bb">Работа</th>
    <th style="text-align:right;padding:6px 8px;border:1px solid #cdc7bb">Сумма, ₽</th></tr>
  ${[['Электрика: розетки и освещение', '48 000'], ['Сантехника', '36 500'], ['Плитка и затирка', '72 300'], ['Кухонный гарнитур', '185 000'], ['Покраска стен', '21 200']]
    .map(([name, sum]) => `<tr><td style="padding:6px 8px;border:1px solid #cdc7bb">${name}</td><td style="text-align:right;padding:6px 8px;border:1px solid #cdc7bb">${sum}</td></tr>`).join('')}
  <tr style="font-weight:700"><td style="padding:6px 8px;border:1px solid #cdc7bb">Итого</td><td style="text-align:right;padding:6px 8px;border:1px solid #cdc7bb">363 000</td></tr>
</table></body></html>`;

/** Кадр «Сад за день»: t от 0 до 1. */
const garden = (t) => {
  const sunX = 30 + t * 260;
  const sunY = 120 - Math.sin(t * Math.PI) * 90;
  const light = Math.sin(t * Math.PI);
  const sky = `rgb(${Math.round(40 + 120 * light)},${Math.round(70 + 130 * light)},${Math.round(120 + 115 * light)})`;
  const sway = Math.sin(t * Math.PI * 6) * 4;
  const flowers = [50, 105, 160, 215, 270].map((x, i) => `
    <path d="M${x} 180 Q${x + sway} 150 ${x + sway * 1.5} ${128 - (i % 2) * 10}" stroke="#2f7d3b" stroke-width="3" fill="none"/>
    <circle cx="${x + sway * 1.5}" cy="${126 - (i % 2) * 10}" r="${6 + 3 * light}" fill="${['#e5484d', '#f4c95d', '#d86fd0', '#f08a3c', '#f6f1e7'][i]}"/>`).join('');
  return `<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="${sky}"/>
  <circle cx="${sunX}" cy="${sunY}" r="16" fill="#ffd95a"/>
  <rect y="150" width="320" height="30" fill="rgb(${Math.round(30 + 40 * light)},${Math.round(70 + 70 * light)},${Math.round(35 + 25 * light)})"/>
  ${flowers}
</svg></body></html>`;
};

/** Мелодия: до-мажорное арпеджио, 16 бит, моно, 22,05 кГц. */
function melody() {
  const rate = 22050;
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 698.46, 880, 698.46, 523.25, 523.25];
  const noteLength = 0.34;
  const samples = new Int16Array(Math.round(rate * noteLength * notes.length));
  notes.forEach((frequency, n) => {
    const start = Math.round(n * noteLength * rate);
    const length = Math.round(noteLength * rate);
    for (let i = 0; i < length; i++) {
      const time = i / rate;
      const envelope = Math.min(1, time / 0.01) * Math.exp(-time * 5);
      const value = Math.sin(2 * Math.PI * frequency * time) + 0.3 * Math.sin(4 * Math.PI * frequency * time);
      samples[start + i] = Math.round(value * envelope * 0.55 * 32767 / 1.3);
    }
  });
  return Buffer.from(samples.buffer);
}

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

const page = await browser.newPage({ viewport: { width: 640, height: 420 }, deviceScaleFactor: 1 });
await page.setContent(KITCHEN);
await page.screenshot({ path: path.join(OUT, 'kitchen-sketch.png') });

await page.setContent(ESTIMATE);
await page.pdf({ path: path.join(OUT, 'renovation-estimate.pdf'), format: 'A5' });

await page.setViewportSize({ width: 320, height: 180 });
const frames = [];
const FRAME_COUNT = 48;
for (let i = 0; i < FRAME_COUNT; i++) {
  await page.setContent(garden(i / (FRAME_COUNT - 1)));
  frames.push(await page.screenshot({ type: 'png' }));
}
await browser.close();

await ffmpeg(['-f', 'image2pipe', '-framerate', '12', '-c:v', 'png', '-i', '-', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38',
  '-pix_fmt', 'yuv420p', '-an', path.join(OUT, 'garden-timelapse.webm')], Buffer.concat(frames));
await ffmpeg(['-f', 's16le', '-ar', '22050', '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '64k',
  path.join(OUT, 'birthday-melody.mp3')], melody());

for (const name of await fs.readdir(OUT)) {
  const { size } = await fs.stat(path.join(OUT, name));
  console.log(`${name}: ${size} байт`);
}
