// Правила различения тегов (см. prototype/DECISIONS.md, «Различение тегов»).

export const MAX_TAG_LENGTH = 64;

const SEPARATORS = /[\s,;]+/u;

/** Приводит одно название тега к хранимому виду. */
export function normalizeTagName(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .trim()
    .replace(/^#+/u, '')
    .toLowerCase()
    .replace(/\s+/gu, '_');
}

/** Возвращает текст ошибки или null, если название допустимо. */
export function tagNameError(name) {
  if (!name) return 'Название тега не может быть пустым.';
  if (name.length > MAX_TAG_LENGTH) return `Название тега длиннее ${MAX_TAG_LENGTH} знаков.`;
  if (/[\s,;]/u.test(name)) return 'В названии тега не может быть пробелов, запятых и точек с запятой.';
  return null;
}

/** Разбирает строку с несколькими тегами: «ремонт, кухня электрика». */
export function parseTagInput(text) {
  const seen = new Set();
  const names = [];
  for (const part of String(text ?? '').split(SEPARATORS)) {
    const name = normalizeTagName(part);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
