// Состояние приложения и действия пользователя.
import * as api from './api.mjs';
import { useState, useEffect } from './lib.mjs';
import {
  createIndex, selectionOf, ownItemsOf, neighborsOf, sortItems, nodeKey, sameNode, isAvailableNode,
  createHistory, currentNode, historyVisit, historyStep, historyCanStep, historyDropTag, restoreHistory,
} from '/shared/model.mjs';
import { applyPatch } from '/shared/ops.mjs';
import {
  cleanDisplay, cleanNumber, DEFAULT_DISPLAY, DEFAULT_LIMIT, DEFAULT_PAGE_SIZE, LIMIT_RANGE, PAGE_SIZE_RANGE,
} from '/shared/display.mjs';

const DEFAULT_SETTINGS = {
  remindOnContentChange: true, showOwnCounts: true, showTimings: false, limit: DEFAULT_LIMIT, pageSize: DEFAULT_PAGE_SIZE,
};

export const state = {
  phase: 'loading', // loading | welcome | ready | failed
  failure: null,
  workspaces: [],
  ws: null,
  index: null,
  history: createHistory(),
  view: { mode: 'own', sort: 'time', display: DEFAULT_DISPLAY },
  settings: { ...DEFAULT_SETTINGS },
  page: 0, // номер страницы постраничного просмотра
  edge: null, // запрошенные крайние позиции: 'first' | 'last'
  saveFailed: false, // состояние просмотра не удалось сохранить
  screen: 'browse', // browse | markup
  drafts: {}, // несохранённые наборы тегов в режиме разметки: { itemId: [названия] }
  dialogs: [],
  notice: null,
  toasts: [],
  timings: {},
};

const listeners = new Set();
function emit() {
  for (const listener of listeners) listener();
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    // Состояние могло измениться до подписки (эффект выполняется после отрисовки).
    listener();
    return () => listeners.delete(listener);
  }, []);
  return state;
}

// ---------- Сообщения ----------

let toastSeq = 0;
export function toast(text, kind = 'info') {
  const id = ++toastSeq;
  state.toasts = [...state.toasts, { id, text, kind }];
  emit();
  setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 4000);
}

export function dismissToast(id) {
  state.toasts = state.toasts.filter((item) => item.id !== id);
  emit();
}

export function setNotice(notice) {
  state.notice = notice;
  emit();
}

export function openDialog(dialog) {
  state.dialogs = [...state.dialogs, dialog];
  emit();
}

export function closeDialog() {
  state.dialogs = state.dialogs.slice(0, -1);
  emit();
}

// ---------- Рабочие области ----------

function rebuild() {
  state.index = createIndex(state.ws);
  viewCache = null;
}

export async function refreshWorkspaces() {
  const { workspaces, lastId } = await api.listWorkspaces();
  state.workspaces = workspaces;
  emit();
  return lastId;
}

export async function init() {
  try {
    const lastId = await refreshWorkspaces();
    const fromHash = /^#ws=(\w+)$/.exec(location.hash)?.[1];
    const id = state.workspaces.find((w) => w.id === fromHash)?.id ?? lastId ?? state.workspaces[0]?.id;
    if (!id) {
      state.phase = 'welcome';
      emit();
      return;
    }
    await openWorkspace(id);
  } catch (error) {
    state.phase = 'failed';
    state.failure = error.message;
    emit();
  }
}

export async function openWorkspace(id) {
  const { workspace, state: saved } = await api.openWorkspace(id);
  state.ws = workspace;
  rebuild();
  state.history = restoreHistory(saved.history, (tagId) => state.index.tagById.has(tagId));
  state.view = {
    mode: saved.view?.mode === 'selection' ? 'selection' : 'own',
    sort: saved.view?.sort === 'title' ? 'title' : 'time',
    display: cleanDisplay(saved.view?.display),
  };
  state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) };
  state.settings.limit = cleanNumber(state.settings.limit, LIMIT_RANGE, DEFAULT_LIMIT);
  state.settings.pageSize = cleanNumber(state.settings.pageSize, PAGE_SIZE_RANGE, DEFAULT_PAGE_SIZE);
  state.page = 0;
  state.edge = null;
  state.screen = 'browse';
  state.drafts = {};
  state.dialogs = [];
  state.notice = null;
  state.phase = 'ready';
  history.replaceState(null, '', `#ws=${id}`);
  document.title = `${workspace.name} — Теготека`;
  emit();
}

export async function createWorkspace(name, preset) {
  const { workspace } = await api.createWorkspace(name, preset);
  await refreshWorkspaces();
  await openWorkspace(workspace.id);
}

export async function renameWorkspace(id, name) {
  const { workspace } = await api.renameWorkspace(id, name);
  if (state.ws?.id === id) {
    state.ws.name = workspace.name;
    document.title = `${workspace.name} — Теготека`;
  }
  await refreshWorkspaces();
}

export async function deleteWorkspace(id) {
  await api.deleteWorkspace(id);
  await refreshWorkspaces();
  if (state.ws?.id !== id) return;
  const next = state.workspaces[0]?.id;
  if (next) {
    await openWorkspace(next);
  } else {
    state.ws = null;
    state.index = null;
    state.dialogs = [];
    state.phase = 'welcome';
    history.replaceState(null, '', location.pathname);
    document.title = 'Теготека';
    emit();
  }
}

// ---------- Сохранение состояния просмотра ----------

// Одновременно выполняется один запрос; если состояние изменилось, пока он шёл,
// следом отправляется только последнее. Отметка rev растёт с каждым изменением:
// сервер не заменит более новое состояние более старым.
let lastRev = 0;
let queued = null;
let inFlight = false;
let retryTimer = null;
let retryDelay = 1000;

function persist() {
  lastRev = Math.max(Date.now(), lastRev + 1);
  queued = { id: state.ws.id, snapshot: { rev: lastRev, history: state.history, view: state.view, settings: state.settings } };
  pump();
}

async function pump() {
  if (inFlight || !queued) return;
  clearTimeout(retryTimer);
  const job = queued;
  queued = null;
  inFlight = true;
  let failed = false;
  try {
    await api.saveState(job.id, job.snapshot);
    retryDelay = 1000;
    if (state.saveFailed) {
      state.saveFailed = false;
      emit();
    }
  } catch (error) {
    // Области больше нет — сохранять нечего. Иначе сообщаем и повторяем.
    if (error.status !== 404) {
      failed = true;
      if (!queued) queued = job;
      if (!state.saveFailed) {
        state.saveFailed = true;
        emit();
      }
      retryTimer = setTimeout(pump, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  }
  inFlight = false;
  if (!failed) pump();
}

/** Повторить сохранение состояния немедленно. */
export function retrySave() {
  pump();
}

// Страницу закрывают, а последнее состояние ещё не отправлено.
window.addEventListener('pagehide', () => {
  if (queued) api.saveState(queued.id, queued.snapshot).catch(() => {});
});

// ---------- Навигация ----------

export function node() {
  return currentNode(state.history);
}

const available = (entry) => isAvailableNode(state.index, entry);

/** Переход к узлу с заданным набором тегов. */
export function navigate(tagIds) {
  const unique = [...new Set(tagIds)].filter((id) => state.index.tagById.has(id));
  state.history = historyVisit(state.history, unique);
  state.notice = null;
  resetShown();
  persist();
  emit();
}

export const goRoot = () => navigate([]);
export const canGoBack = () => historyCanStep(state.history, -1, available);
export const canGoForward = () => historyCanStep(state.history, 1, available);

export function goBack() {
  state.history = historyStep(state.history, -1, available);
  state.notice = null;
  resetShown();
  persist();
  emit();
}

export function goForward() {
  state.history = historyStep(state.history, 1, available);
  state.notice = null;
  resetShown();
  persist();
  emit();
}

/** Страница и запрос крайних позиций относятся к одному показанному множеству. */
function resetShown() {
  state.page = 0;
  state.edge = null;
}

/** Состав элементов: 'own' — собственные, 'selection' — выборка узла. */
export function setMode(mode) {
  state.view = { ...state.view, mode };
  resetShown();
  persist();
  emit();
}

/** Смена сортировки не показывает скрытые элементы; уже запрошенные крайние пересчитываются. */
export function setSort(sort) {
  state.view = { ...state.view, sort };
  state.page = 0;
  persist();
  emit();
}

/** Способ показа: 'limit' | 'fit' | 'pages'. */
export function setDisplay(display) {
  state.view = { ...state.view, display: cleanDisplay(display) };
  resetShown();
  persist();
  emit();
}

export function setPage(page) {
  state.page = Math.max(0, page);
  emit();
}

export function setEdge(edge) {
  state.edge = edge;
  emit();
}

export function setSetting(name, value) {
  let clean = value;
  if (name === 'limit') clean = cleanNumber(value, LIMIT_RANGE, state.settings.limit);
  if (name === 'pageSize') {
    clean = cleanNumber(value, PAGE_SIZE_RANGE, state.settings.pageSize);
    state.page = 0;
  }
  state.settings = { ...state.settings, [name]: clean };
  persist();
  emit();
}

export function setDraft(itemId, names) {
  state.drafts = { ...state.drafts, [itemId]: names };
  emit();
}

export function setScreen(screen) {
  state.screen = screen;
  state.notice = null;
  emit();
}

// ---------- Данные текущего узла ----------

let viewCache = null;

/** Собственные элементы, выборка и предлагаемые переходы текущего узла. */
export function currentView() {
  const tagIds = node();
  const key = `${state.ws.version}|${nodeKey(tagIds)}|${state.view.sort}`;
  if (viewCache?.key === key) return viewCache.value;

  const t0 = performance.now();
  const selection = selectionOf(state.index, tagIds);
  const t1 = performance.now();
  const own = ownItemsOf(state.index, tagIds);
  const sortedSelection = sortItems(selection, state.view.sort);
  const sortedOwn = sortItems(own, state.view.sort);
  const t2 = performance.now();
  const neighbors = neighborsOf(state.index, tagIds);
  const t3 = performance.now();

  state.timings = { ...state.timings, select: t1 - t0, sort: t2 - t1, neighbors: t3 - t2, selectionSize: selection.length };
  const value = { tagIds, own: sortedOwn, selection: sortedSelection, neighbors };
  viewCache = { key, value };
  return value;
}

export function recordTiming(name, ms) {
  state.timings = { ...state.timings, [name]: ms };
}

export function tagNames(tagIds) {
  return tagIds.map((id) => state.index.tagById.get(id)?.name ?? '?');
}

// ---------- Изменение данных ----------

/** Выполняет одну операцию на сервере и применяет её результат. */
export async function runOp(op) {
  const ws = state.ws;
  const response = await api.applyOp(ws.id, op);
  if (state.ws !== ws) return response.result;
  if (response.version === ws.version + 1) {
    applyPatch(ws, response.patch);
    ws.version = response.version;
  } else {
    // Данные менялись в другой вкладке: загружаем рабочую область заново.
    const fresh = await api.openWorkspace(ws.id);
    state.ws = fresh.workspace;
  }
  rebuild();
  if (op.type === 'deleteTag') {
    state.history = historyDropTag(state.history, op.id);
    persist();
  }
  const current = node();
  if (!isAvailableNode(state.index, current)) {
    const entries = [...state.history.entries];
    entries[state.history.index] = current.filter((id) => state.index.tagById.has(id));
    state.history = { entries, index: state.history.index };
    persist();
  }
  emit();
  return response.result;
}

/**
 * Сообщение после сохранения элемента: пользователь остаётся в текущем узле;
 * если элемент принадлежит другому узлу, предлагается перейти в него.
 */
export function announceSaved(itemId, verb = 'сохранён') {
  const item = state.ws.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  if (item.tags === null) {
    setNotice({ kind: 'unmarked', text: `Элемент ${verb} без разметки и ждёт в списке неразмеченных.` });
  } else if (state.screen === 'browse' && sameNode(item.tags, node())) {
    state.notice = null;
    toast(`Элемент ${verb} в текущем узле.`);
  } else {
    setNotice({ kind: 'node', text: `Элемент ${verb}. Его узел:`, tagIds: [...item.tags] });
  }
}
