// Заготовки рабочих областей: демонстрационный набор из prototype/CHECKS.md
// и воспроизводимый диагностический набор.

import { applyOp } from './ops.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Набор E0–E9. Порядок задаёт возрастание времени последнего изменения. */
export const DEMO_ITEMS = [
  { title: 'Общее', text: 'Общая запись', tags: [] },
  { title: 'Ремонт', text: 'Подготовить ремонт', tags: ['ремонт'] },
  { title: 'Кухня', text: 'Заметка о кухне', tags: ['кухня'] },
  { title: 'План', text: 'План электрики при ремонте кухни', tags: ['ремонт', 'кухня', 'электрика'] },
  { title: 'Смета', text: 'Срочно согласовать бюджет ремонта кухни', tags: ['ремонт', 'кухня', 'бюджет', 'срочно'] },
  { title: 'План', text: 'Бюджет электрики при ремонте кухни', tags: ['ремонт', 'кухня', 'электрика', 'бюджет'] },
  { title: null, text: 'Полить сад', tags: ['сад'] },
  { title: 'Игорь', text: null, tags: ['день_рождения', 'май', '5', 'игорь', 'артемьев'] },
  { title: 'Анна', text: null, tags: ['день_рождения', 'июнь', '10', 'анна'] },
  { title: 'Набросок', text: 'Запись для последующей разметки', tags: null },
];

export const DEMO_UNUSED_TAG = 'мечта';
export const DEMO_TAG_DESCRIPTIONS = { бюджет: 'Планируемые расходы' };

/** Примеры медиа из каталога demo-media/ для заготовки «с примерами медиа». */
export const DEMO_MEDIA = [
  {
    file: 'kitchen-sketch.png', name: 'Эскиз кухни.png', mime: 'image/png',
    title: 'Эскиз кухни', tags: ['ремонт', 'кухня', 'эскиз'],
  },
  {
    file: 'birthday-melody.mp3', name: 'Мелодия.mp3', mime: 'audio/mpeg',
    title: 'Мелодия для поздравления', tags: ['день_рождения', 'музыка'],
  },
  {
    file: 'garden-timelapse.webm', name: 'Сад.webm', mime: 'video/webm',
    title: 'Сад за день', tags: ['сад', 'видео'],
  },
  {
    file: 'renovation-estimate.pdf', name: 'Смета ремонта.pdf', mime: 'application/pdf',
    title: 'Смета ремонта', tags: ['ремонт', 'бюджет', 'документ'],
  },
];

/** Заполняет пустую рабочую область набором E0–E9. now — момент создания. */
export function fillDemo(ws, now) {
  let clock = now - (DEMO_ITEMS.length + 1) * DAY;
  const env = { now: () => clock, hasFile: () => false };
  for (const item of DEMO_ITEMS) {
    clock += DAY;
    applyOp(ws, {
      type: 'createItem',
      title: item.title,
      content: item.text === null ? { kind: 'empty' } : { kind: 'text', text: item.text },
      tags: item.tags,
      tagDescriptions: DEMO_TAG_DESCRIPTIONS,
    }, env);
  }
  applyOp(ws, { type: 'addTag', name: DEMO_UNUSED_TAG, description: '' }, env);
  ws.version = 0;
  return ws;
}

// ---------- Диагностический набор ----------

export const DIAGNOSTIC_DEFAULTS = { seed: 20261111, items: 10_000, tags: 100, minTags: 1, maxTags: 6, skew: 0.7 };

const NOUNS = [
  'дом', 'работа', 'семья', 'дети', 'здоровье', 'спорт', 'книга', 'фильм', 'музыка', 'рецепт',
  'поездка', 'отпуск', 'море', 'горы', 'лес', 'город', 'дача', 'сад', 'огород', 'ремонт',
  'кухня', 'ванная', 'спальня', 'мебель', 'электрика', 'сантехника', 'бюджет', 'покупка', 'счёт', 'налог',
  'банк', 'кредит', 'зарплата', 'проект', 'задача', 'встреча', 'звонок', 'письмо', 'договор', 'отчёт',
  'идея', 'цель', 'план', 'мечта', 'привычка', 'дневник', 'заметка', 'цитата', 'анекдот', 'тост',
  'стихи', 'песня', 'подкаст', 'лекция', 'курс', 'язык', 'английский', 'история', 'наука', 'техника',
  'телефон', 'компьютер', 'программа', 'сайт', 'пароль', 'документ', 'паспорт', 'виза', 'билет', 'гостиница',
  'машина', 'гараж', 'велосипед', 'прогулка', 'собака', 'кошка', 'друг', 'сосед', 'коллега', 'учитель',
  'врач', 'лекарство', 'анализ', 'диета', 'завтрак', 'обед', 'ужин', 'праздник', 'подарок', 'свадьба',
  'юбилей', 'день_рождения', 'новый_год', 'весна', 'лето', 'осень', 'зима', 'утро', 'вечер', 'срочно',
];

const WORDS = [
  'проверить', 'записать', 'обсудить', 'купить', 'сравнить', 'вспомнить', 'подготовить', 'уточнить',
  'список', 'вариант', 'вопрос', 'пример', 'результат', 'срок', 'порядок', 'способ',
  'новый', 'старый', 'важный', 'простой', 'удобный', 'короткий', 'общий', 'личный',
  'сегодня', 'завтра', 'потом', 'быстро', 'спокойно', 'заранее', 'вместе', 'отдельно',
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function diagnosticTagNames(count) {
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push(i < NOUNS.length ? NOUNS[i] : `тег_${String(i + 1).padStart(3, '0')}`);
  }
  return names;
}

/**
 * Заполняет пустую рабочую область диагностическим набором. Распределение:
 * число тегов элемента равновероятно от minTags до maxTags; теги выбираются
 * без повторов с весом 1 / ранг^skew (ранг — номер тега в списке с единицы).
 */
export function fillDiagnostic(ws, now, options = {}) {
  const config = { ...DIAGNOSTIC_DEFAULTS, ...options };
  const random = mulberry32(config.seed);
  const names = diagnosticTagNames(config.tags);
  ws.tags = names.map((name, i) => ({ id: `t${i + 1}`, name, description: '' }));
  const weights = names.map((_, i) => 1 / (i + 1) ** config.skew);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const pickTag = (taken, remaining) => {
    let target = random() * remaining;
    for (let i = 0; i < weights.length; i++) {
      if (taken.has(i)) continue;
      target -= weights[i];
      if (target <= 0) return i;
    }
    for (let i = weights.length - 1; i >= 0; i--) if (!taken.has(i)) return i;
    return 0;
  };
  const word = () => WORDS[Math.floor(random() * WORDS.length)];

  const start = now - config.items * 1000;
  ws.items = [];
  for (let n = 1; n <= config.items; n++) {
    const tagCount = config.minTags + Math.floor(random() * (config.maxTags - config.minTags + 1));
    const taken = new Set();
    let remaining = totalWeight;
    for (let k = 0; k < Math.min(tagCount, config.tags); k++) {
      const i = pickTag(taken, remaining);
      taken.add(i);
      remaining -= weights[i];
    }
    const tagIndexes = [...taken];
    const lead = names[tagIndexes[0]].replace(/_/g, ' ');
    const text = `${lead[0].toUpperCase()}${lead.slice(1)}: ${word()} ${word()} ${word()}.`;
    const time = start + n * 1000;
    ws.items.push({
      id: `i${n}`,
      title: random() < 0.15 ? null : `Запись ${String(n).padStart(5, '0')}`,
      content: { kind: 'text', text },
      tags: tagIndexes.map((i) => `t${i + 1}`),
      createdAt: time,
      modifiedAt: time,
    });
  }
  ws.seq = config.items + config.tags;
  ws.clock = now;
  ws.version = 0;
  return ws;
}
