// Правила обозримости: способы показа элементов выбранного состава.
// Чистые функции; измерение вместимости экрана выполняет интерфейс.

export const DISPLAY_METHODS = ['limit', 'fit', 'pages'];
export const DEFAULT_DISPLAY = 'limit';
export const DEFAULT_LIMIT = 12;
export const DEFAULT_PAGE_SIZE = 10;
export const EDGE_COUNT = 5;
export const LIMIT_RANGE = [1, 200];
export const PAGE_SIZE_RANGE = [1, 100];

/** Целое число в допустимых границах; иначе запасное значение. */
export function cleanNumber(value, [min, max], fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function cleanDisplay(value) {
  return DISPLAY_METHODS.includes(value) ? value : DEFAULT_DISPLAY;
}

/**
 * Что показывать для множества из count элементов:
 *   'empty'     — элементов нет;
 *   'all'       — показаны все;
 *   'hidden'    — элементы есть, но скрыты ограничением обозримости;
 *   'measuring' — вместимость экрана ещё не измерена;
 *   'pages'     — постраничный просмотр.
 * fits — результат измерения для способа «по вместимости экрана».
 */
export function decideDisplay({ display, count, limit, fits }) {
  if (count === 0) return 'empty';
  if (display === 'pages') return 'pages';
  if (display === 'fit') return fits === true ? 'all' : fits === false ? 'hidden' : 'measuring';
  return count <= limit ? 'all' : 'hidden';
}

export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Страница отсортированного множества: без пропусков и повторов. */
export function pageSlice(items, page, pageSize) {
  const pages = pageCount(items.length, pageSize);
  const current = Math.min(Math.max(0, page), pages - 1);
  const from = current * pageSize;
  const slice = items.slice(from, from + pageSize);
  return { items: slice, page: current, pages, from: slice.length ? from + 1 : 0, to: from + slice.length, total: items.length };
}

/** Крайние позиции отсортированного множества: первые или последние count элементов. */
export function edgeSlice(items, edge, count = EDGE_COUNT) {
  const size = Math.min(count, items.length);
  return edge === 'last' ? items.slice(items.length - size) : items.slice(0, size);
}
