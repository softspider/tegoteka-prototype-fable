// Базовые элементы интерфейса: значки, теги, переключатели, диалоги, сообщения.
import { html, cx, useEffect, useRef } from './lib.mjs';
import { state, closeDialog, dismissToast } from './store.mjs';

const ICONS = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11',
  inbox: 'M4 13l2.5-8h11L20 13v6H4v-6zM4 13h5l1 3h4l1-3h5',
  move: 'M4 12h13M12 7l5 5-5 5M20 5v14',
  target: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  chevron: 'M6 9l6 6 6-6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  check: 'M5 12l5 5 9-10',
  search: 'M11 5a6 6 0 1 0 0 12a6 6 0 0 0 0-12zM20 20l-4.6-4.6',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  note: 'M5 4h14v16H5zM9 9h6M9 13h6',
};

export function Icon({ name, size = 16 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}

/**
 * Тег. variant: node — выбранный тег узла; plain — тег элемента;
 * muted — тег элемента, уже входящий в текущий узел; added / removed / fresh.
 */
export function Tag({ tag, variant = 'plain', onClick, onRemove, removeLabel, sign, title }) {
  const name = tag?.name ?? '?';
  const hint = title ?? (tag?.description ? `${name} — ${tag.description}` : undefined);
  const body = html`${sign ? html`<span class="tag-sign">${sign}</span>` : null}<span class="tag-name">${name}</span>`;
  return html`<span class=${cx('tag', `tag-${variant}`)} title=${hint} data-tag=${name}>
    ${onClick
      ? html`<button type="button" class="tag-main" onClick=${onClick}>${body}</button>`
      : html`<span class="tag-main">${body}</span>`}
    ${onRemove
      ? html`<button type="button" class="tag-remove" onClick=${onRemove} aria-label=${removeLabel ?? `Убрать тег ${name}`}
          title=${removeLabel ?? `Убрать тег ${name}`}><${Icon} name="x" size=${12} /></button>`
      : null}
  </span>`;
}

/** Набор тегов узла; пустой набор обозначается как корень. */
export function NodeTags({ tagIds, variant = 'plain' }) {
  if (tagIds.length === 0) return html`<span class="root-mark">корень</span>`;
  return html`<span class="tag-row">${tagIds.map((id) => html`<${Tag} key=${id} tag=${state.index.tagById.get(id)} variant=${variant} />`)}</span>`;
}

export function Segmented({ label, value, options, onChange, testId }) {
  return html`<div class="segmented" role="group" aria-label=${label} data-testid=${testId}>
    ${options.map((option) => html`<button type="button" key=${option.value}
      class=${cx('segment', value === option.value && 'is-active')}
      aria-pressed=${value === option.value} data-value=${option.value}
      onClick=${() => onChange(option.value)}>
      ${option.label}${option.count !== undefined ? html`<span class="segment-count">${option.count}</span>` : null}
    </button>`)}
  </div>`;
}

/**
 * Диалоговое окно. canClose() возвращает false, если закрывать по Esc или
 * щелчку вне окна нельзя (есть несохранённые изменения).
 */
export function Modal({ title, children, footer, size = 'medium', onClose = closeDialog, canClose, testId }) {
  const ref = useRef(null);
  const handlers = useRef({});
  const tryClose = () => {
    if (!canClose || canClose()) onClose();
  };
  handlers.current.tryClose = tryClose;

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const target = dialog.querySelector('[data-autofocus]') ?? dialog.querySelector('input, textarea, select, button');
    target?.focus();
    document.documentElement.classList.add('modal-open');

    // Клавиши обрабатываются на уровне окна: фокус может оказаться вне диалога,
    // например когда элемент с фокусом удалён из списка.
    const onKeyDown = (event) => {
      const modals = document.querySelectorAll('.modal');
      if (modals[modals.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        handlers.current.tryClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea, select')]
        .filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = dialog.contains(document.activeElement);
      if (!inside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // Диалог ещё в документе в момент очистки, поэтому считаем остальные.
      if (document.querySelectorAll('.modal').length <= 1) document.documentElement.classList.remove('modal-open');
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return html`<div class="backdrop" onMouseDown=${(event) => event.target === event.currentTarget && tryClose()}>
    <div class=${cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-label=${title} ref=${ref} data-testid=${testId}>
      <header class="modal-head">
        <h2>${title}</h2>
        <button type="button" class="icon-button" onClick=${tryClose} aria-label="Закрыть" title="Закрыть"><${Icon} name="x" /></button>
      </header>
      <div class="modal-body">${children}</div>
      ${footer ? html`<footer class="modal-foot">${footer}</footer>` : null}
    </div>
  </div>`;
}

/** Подтверждение действия. */
export function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, cancelLabel = 'Отмена' }) {
  const confirm = async () => {
    closeDialog();
    await onConfirm();
  };
  return html`<${Modal} title=${title} size="small" testId="confirm-dialog" footer=${html`
    <button type="button" class="button" onClick=${closeDialog} data-testid="confirm-cancel">${cancelLabel}</button>
    <button type="button" class=${cx('button', danger ? 'button-danger' : 'button-primary')} onClick=${confirm}
      data-autofocus data-testid="confirm-ok">${confirmLabel}</button>`}>
    ${children}
  <//>`;
}

export function Toasts() {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${state.toasts.map((item) => html`<div key=${item.id} class=${cx('toast', `toast-${item.kind}`)}>
      <span>${item.text}</span>
      <button type="button" class="icon-button" onClick=${() => dismissToast(item.id)} aria-label="Скрыть сообщение"><${Icon} name="x" size=${14} /></button>
    </div>`)}
  </div>`;
}

export function Switch({ checked, onChange, label, hint, testId }) {
  return html`<label class="switch-row">
    <input type="checkbox" class="switch" checked=${checked} onChange=${(event) => onChange(event.target.checked)} data-testid=${testId} />
    <span><span class="switch-label">${label}</span>${hint ? html`<span class="switch-hint">${hint}</span>` : null}</span>
  </label>`;
}
