// Режим разметки: отдельная работа со списком неразмеченных элементов.
import { html, cx, useState, useEffect, useRef, formatTime, formatNumber } from './lib.mjs';
import { state, node, runOp, setScreen, setDraft, openDialog, announceSaved, tagNames, navigate, setNotice } from './store.mjs';
import { Icon, NodeTags, AddButton } from './components.mjs';
import { MarkupEditor, commitPendingTags } from './tag-input.mjs';
import { focusDescription } from './editor.mjs';
import { ContentView } from './content-view.mjs';
import { sortItems } from '/shared/model.mjs';
import { contentLabel } from '/shared/content.mjs';

const TAG_INPUT_ID = 'markup-tag-input';

export function Progress() {
  const total = state.index.itemCount;
  const left = state.index.unmarked.length;
  const done = total - left;
  const share = total ? done / total : 1;
  return html`<div class="progress" data-testid="markup-progress" data-done=${done} data-total=${total}>
    <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax=${total} aria-valuenow=${done}
      aria-label="Прогресс разметки"><span style=${`width:${(share * 100).toFixed(1)}%`}></span></div>
    <p class="progress-text">
      Размечено <strong>${formatNumber(done)}</strong> из ${formatNumber(total)} · ${left === 0 ? 'неразмеченных нет' : `осталось ${formatNumber(left)}`}
    </p>
  </div>`;
}

export function MarkupMode() {
  // Очередь: давно ждущие элементы — первыми.
  const queue = sortItems(state.index.unmarked, 'time').reverse();
  const [selectedId, setSelectedId] = useState(queue[0]?.id ?? null);
  const drafts = state.drafts;
  const [descriptions, setDescriptions] = useState({});
  const [session, setSession] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [offer, setOffer] = useState(false);
  const inputApi = useRef(null);

  const item = queue.find((candidate) => candidate.id === selectedId) ?? queue[0] ?? null;
  useEffect(() => {
    if (item && item.id !== selectedId) setSelectedId(item.id);
  }, [item?.id]);

  const current = node();
  const names = item ? drafts[item.id] ?? [] : [];
  const setNames = (next) => setDraft(item.id, next);

  const select = (id) => {
    setSelectedId(id);
    setError(null);
    setOffer(false);
  };
  const skip = () => {
    const position = queue.findIndex((candidate) => candidate.id === item.id);
    select(queue[(position + 1) % queue.length].id);
  };

  const save = async () => {
    // Набранные, но не подтверждённые теги входят в набор; новым сначала предлагается описание.
    const committed = commitPendingTags(names, inputApi);
    if (committed.error) {
      setError(committed.error);
      return;
    }
    const finalNames = committed.names;
    if (finalNames.length !== names.length) setNames(finalNames);
    if (committed.offered.length > 0) {
      setError(null);
      setOffer(true);
      focusDescription(committed.offered[0]);
      return;
    }
    const position = queue.findIndex((candidate) => candidate.id === item.id);
    const next = queue[position + 1] ?? queue[position - 1] ?? null;
    setSaving(true);
    setError(null);
    try {
      const result = await runOp({ type: 'updateItem', id: item.id, tags: finalNames, tagDescriptions: descriptions });
      setSession(session + 1);
      setOffer(false);
      setSelectedId(next?.id ?? null);
      announceSaved(result.itemId, 'размечен');
    } catch (failure) {
      setError(failure.message);
    }
    setSaving(false);
  };

  const notice = state.notice;
  return html`<div class="markup-mode" data-testid="markup-mode">
    <header class="markup-head">
      <button type="button" class="button" onClick=${() => setScreen('browse')} data-testid="markup-exit">
        <${Icon} name="back" />К просмотру</button>
      <h2>Разметка</h2>
      <${AddButton} />
    </header>
    <${Progress} />
    ${session > 0 ? html`<p class="markup-session" data-testid="markup-session">За этот заход размечено: ${session}.</p>` : null}
    ${notice ? html`<div class="notice" role="status" data-testid="notice">
      <span class="notice-text">${notice.text}</span>
      ${notice.kind === 'node' ? html`<${NodeTags} tagIds=${notice.tagIds} />
        <button type="button" class="button button-small" data-testid="notice-go"
          onClick=${() => { setScreen('browse'); navigate(notice.tagIds); }}>Перейти в этот узел</button>` : null}
      <button type="button" class="icon-button" onClick=${() => setNotice(null)} aria-label="Скрыть сообщение"><${Icon} name="x" size=${14} /></button>
    </div>` : null}

    ${!item ? html`<div class="empty" data-testid="markup-done">
      <h3>Неразмеченных элементов нет</h3>
      <button type="button" class="button button-primary" onClick=${() => setScreen('browse')}>К просмотру</button>
    </div>` : html`<div class="markup-columns">
      <nav class="markup-queue" aria-label="Неразмеченные элементы">
        <h3>Неразмеченные <span class="group-count">${queue.length}</span></h3>
        <ul data-testid="markup-queue">
          ${queue.map((candidate) => html`<li key=${candidate.id}>
            <button type="button" class=${cx('queue-row', candidate.id === item.id && 'is-active')} onClick=${() => select(candidate.id)}
              data-testid="queue-item" aria-current=${candidate.id === item.id ? 'true' : undefined}>
              <span class=${cx('queue-title', !candidate.title && 'is-untitled')}>${candidate.title ?? 'Без названия'}</span>
              <span class="queue-meta">${contentLabel(candidate.content)} · ${formatTime(candidate.modifiedAt)}</span>
              ${drafts[candidate.id]?.length ? html`<span class="queue-draft">черновик: ${drafts[candidate.id].join(' ')}</span>` : null}
            </button>
          </li>`)}
        </ul>
      </nav>

      <section class="markup-work" data-testid="markup-work" data-item-id=${item.id}>
        <header class="item-head">
          <h3 class=${cx('item-title', !item.title && 'is-untitled')}>${item.title ?? 'Без названия'}</h3>
          <time class="item-time">${formatTime(item.modifiedAt)}</time>
        </header>
        <div class="markup-content"><${ContentView} content=${item.content} /></div>
        <div class="field">
          <label class="field-label" for=${TAG_INPUT_ID}>Теги элемента</label>
          <${MarkupEditor} key=${item.id} names=${names} onNames=${setNames} original=${null} descriptions=${descriptions}
            onDescriptions=${setDescriptions} inputId=${TAG_INPUT_ID} inputApi=${inputApi} offer=${offer} />
          ${current.length > 0 && names.join(' ') !== tagNames(current).join(' ')
            ? html`<button type="button" class="link-button" onClick=${() => setNames(tagNames(current))} data-testid="use-node-tags">
                Теги текущего узла: ${tagNames(current).join(' ')}</button>` : null}
        </div>
        ${error ? html`<p class="field-error" role="alert">${error}</p>` : null}
        <div class="markup-actions">
          <button type="button" class="button button-primary" onClick=${save} disabled=${saving} data-testid="markup-save">
            <${Icon} name="check" />${saving ? 'Сохранение…' : 'Сохранить разметку'}</button>
          ${queue.length > 1 ? html`<button type="button" class="button" onClick=${skip} data-testid="markup-skip">Пропустить</button>` : null}
          <span class="actions-spacer"></span>
          <button type="button" class="button button-quiet" onClick=${() => openDialog({ type: 'item', itemId: item.id })} data-testid="markup-edit">
            <${Icon} name="edit" size=${14} />Изменить</button>
          <button type="button" class="button button-quiet button-danger-quiet" onClick=${() => openDialog({ type: 'delete-item', itemId: item.id })}
            data-testid="markup-delete"><${Icon} name="trash" size=${14} />Удалить</button>
        </div>
      </section>
    </div>`}
  </div>`;
}
