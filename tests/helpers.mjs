import { applyOp, emptyWorkspace } from '../shared/ops.mjs';
import { fillDemo } from '../shared/demo.mjs';
import { createIndex } from '../shared/model.mjs';

export const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

/** Отдельная копия исходного набора E0–E9 с управляемыми часами. */
export function demo() {
  const ws = fillDemo(emptyWorkspace({ id: 'w-test', name: 'Проверка', now: NOW }), NOW);
  const original = ws.items.map((item) => item.id);
  let clock = NOW;
  const files = new Set();
  const env = { now: () => (clock += 1000), hasFile: (id) => files.has(id) };
  const api = {
    ws,
    files,
    get index() {
      return createIndex(ws);
    },
    op(op) {
      return applyOp(ws, op, env);
    },
    /** Идентификаторы тегов по названиям. */
    ids(...names) {
      return names.map((name) => {
        const tag = ws.tags.find((candidate) => candidate.name === name);
        if (!tag) throw new Error(`Нет тега ${name}`);
        return tag.id;
      });
    },
    /** Элемент E0–E9 по номеру в исходном наборе (null, если удалён или заменён). */
    e(n) {
      return ws.items.find((item) => item.id === original[n]) ?? null;
    },
    item(id) {
      return ws.items.find((item) => item.id === id) ?? null;
    },
  };
  return api;
}

/** Обозначения E0–E9 для списка элементов. */
export function labels(api, items) {
  const names = [];
  for (const item of items) {
    let label = item.id;
    for (let n = 0; n <= 9; n++) if (api.e(n)?.id === item.id) label = `E${n}`;
    names.push(label);
  }
  return names.sort();
}

export function transitionLabels(index, transitions, sign) {
  return transitions.map((t) => `${sign} ${t.changed.map((id) => index.tagById.get(id).name).join(' ')}`);
}
