// Общие вспомогательные средства интерфейса.
export {
  html, render, h, Component, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
} from '/vendor/preact-htm.mjs';

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** Русское склонение: plural(3, 'элемент', 'элемента', 'элементов'). */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function countItems(n) {
  return `${formatNumber(n)} ${plural(n, 'элемент', 'элемента', 'элементов')}`;
}

const numberFormat = new Intl.NumberFormat('ru');
export function formatNumber(n) {
  return numberFormat.format(n);
}

const sameYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const otherYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function formatTime(ms) {
  const date = new Date(ms);
  return (date.getFullYear() === new Date().getFullYear() ? sameYear : otherYear).format(date);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} КБ`;
  return `${(bytes / 1048576).toFixed(1)} МБ`;
}

export function formatMs(ms) {
  if (ms === undefined || ms === null) return '—';
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} мс`;
}
