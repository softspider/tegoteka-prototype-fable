// Просмотр узла: текущие теги, предлагаемые переходы, элементы.
import { html, cx, useState, useEffect, useRef, formatTime, formatNumber, formatMs, countItems, plural } from './lib.mjs';
import {
  state, node, navigate, goRoot, goBack, goForward, canGoBack, canGoForward, setMode, setSort, setScreen,
  currentView, openDialog, setNotice, tagNames,
} from './store.mjs';
import { Icon, Tag, NodeTags, Segmented } from './components.mjs';
import { TagInput } from './tag-input.mjs';
import { ContentView } from './content-view.mjs';
import { COMPACT_TRANSITIONS, nodeKey, isOwnItem } from '/shared/model.mjs';

const PAGE = 12;
const ITEMS_STEP = 40;

// ---------- Текущий узел ----------

export function NodeBar() {
  const tagIds = node();
  const index = state.index;
  const bar = useRef(null);
  // Высота панели меняется вместе с числом выбранных тегов; под неё подстраивается закреплённая панель переходов.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--nodebar-h', `${bar.current.offsetHeight}px`);
    });
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);

  const addTags = (names) => {
    const ids = [];
    for (const name of names) {
      const tag = index.tagByName.get(name);
      if (!tag) return `Тега «${name}» нет в рабочей области. Узел задаётся только доступными тегами; новый тег появляется при разметке элемента.`;
      if (!tagIds.includes(tag.id)) ids.push(tag.id);
    }
    if (ids.length) navigate([...tagIds, ...ids]);
    return null;
  };

  return html`<section class="nodebar" aria-label="Текущий узел" data-testid="nodebar" ref=${bar}>
    <div class="nav-buttons">
      <button type="button" class="icon-button" onClick=${goBack} disabled=${!canGoBack()} title="Назад по истории переходов (Alt+←)"
        aria-label="Назад" data-testid="nav-back"><${Icon} name="back" size=${18} /></button>
      <button type="button" class="icon-button" onClick=${goForward} disabled=${!canGoForward()} title="Вперёд по истории переходов (Alt+→)"
        aria-label="Вперёд" data-testid="nav-forward"><${Icon} name="forward" size=${18} /></button>
      <button type="button" class="button button-quiet" onClick=${goRoot} disabled=${tagIds.length === 0}
        title="Снять все выбранные теги" data-testid="nav-root"><${Icon} name="home" />В корень</button>
    </div>
    <div class="node-current">
      <span class="node-caption">Текущий узел</span>
      <div class="node-tags" data-testid="node-tags">
        ${tagIds.length === 0
          ? html`<span class="root-mark" data-testid="root-mark">корень · теги не выбраны</span>`
          : tagIds.map((id) => html`<${Tag} key=${id} tag=${index.tagById.get(id)} variant="node"
              removeLabel=${`Убрать тег ${index.tagById.get(id).name} из выбранных`}
              onRemove=${() => navigate(tagIds.filter((other) => other !== id))} />`)}
        <${TagInput} mode="nav" selectedIds=${tagIds} onAdd=${addTags} inputId="nav-tag-input" testId="nav-input"
          placeholder=${tagIds.length ? 'добавить тег…' : 'Введите тег, чтобы сузить выборку'} />
      </div>
    </div>
  </section>`;
}

// ---------- Предлагаемые переходы ----------

function Transition({ transition, sign, max }) {
  const index = state.index;
  const share = max > 0 ? Math.max(0.06, transition.selection / max) : 0;
  const target = transition.tagIds.length ? tagNames(transition.tagIds).join(' ') : 'корень';
  return html`<li>
    <button type="button" class=${cx('transition', `transition-${transition.direction}`)} onClick=${() => navigate(transition.tagIds)}
      title=${`Перейти в узел: ${target}`} data-testid="transition" data-label=${`${sign} ${transition.label}`}>
      <span class="transition-sign" aria-hidden="true">${sign}</span>
      <span class="transition-tags">
        <span class="visually-hidden">${sign === '+' ? 'добавить' : 'убрать'} </span>
        ${transition.changed.map((id) => html`<${Tag} key=${id} tag=${index.tagById.get(id)} variant=${sign === '+' ? 'added' : 'removed'} />`)}
        ${sign === '−' && transition.changed.length > 1
          ? html`<span class="transition-rest" data-testid="transition-rest">остаётся: ${target}</span>` : null}
      </span>
      <span class="transition-counts">
        <span class="transition-total" title="Элементов в выборке узла" data-testid="transition-selection">${formatNumber(transition.selection)}</span>
        ${state.settings.showOwnCounts
          ? html`<span class="transition-own" title="Собственных элементов узла" data-testid="transition-own">собств. ${formatNumber(transition.own)}</span>` : null}
      </span>
      <span class="transition-bar" aria-hidden="true"><span style=${`width:${Math.round(share * 100)}%`}></span></span>
    </button>
  </li>`;
}

const narrowQuery = window.matchMedia('(max-width: 920px)');
function useNarrow() {
  const [narrow, setNarrow] = useState(narrowQuery.matches);
  useEffect(() => {
    const onChange = () => setNarrow(narrowQuery.matches);
    narrowQuery.addEventListener('change', onChange);
    return () => narrowQuery.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

function TransitionGroup({ title, hint, icon, sign, transitions, paged, emptyText, testId }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const key = nodeKey(node());
  useEffect(() => {
    setExpanded(false);
    setFilter('');
    setPage(0);
  }, [key]);

  const total = transitions.length;
  const max = transitions.reduce((value, t) => Math.max(value, t.selection), 0);
  // На узком экране компактный набор вдвое короче, чтобы список элементов оставался близко.
  const compact = useNarrow() ? COMPACT_TRANSITIONS / 2 : COMPACT_TRANSITIONS;
  let shown = transitions;
  let filtered = transitions;
  if (!expanded) {
    shown = transitions.slice(0, compact);
  } else if (paged) {
    const query = filter.trim().toLowerCase();
    if (query) filtered = transitions.filter((t) => t.label.includes(query));
    shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  }
  const pages = Math.ceil(filtered.length / PAGE);

  return html`<section class="transition-group" data-testid=${testId}>
    <h3><${Icon} name=${icon} />${title}<span class="group-count" title="Всего переходов">${total}</span></h3>
    <p class="group-hint">${hint}</p>
    ${total === 0 ? html`<p class="group-empty">${emptyText}</p>` : null}
    ${expanded && paged && total > PAGE ? html`<label class="filter-field">
      <${Icon} name="search" size=${14} />
      <input type="search" class="input-plain" placeholder="Найти по тегу" value=${filter} data-testid="transition-filter"
        onInput=${(event) => { setFilter(event.target.value); setPage(0); }} />
    </label>` : null}
    <ul class=${cx('transition-list', expanded && !paged && 'is-scroll')}>
      ${shown.map((t) => html`<${Transition} key=${nodeKey(t.tagIds)} transition=${t} sign=${sign} max=${max} />`)}
    </ul>
    ${expanded && paged && filtered.length === 0 ? html`<p class="group-empty">Нет переходов с таким тегом.</p>` : null}
    ${expanded && paged && pages > 1 ? html`<div class="pager" data-testid="transition-pager">
      <button type="button" class="icon-button" disabled=${page === 0} onClick=${() => setPage(page - 1)} aria-label="Предыдущая страница"><${Icon} name="back" /></button>
      <span>${page * PAGE + 1}–${Math.min(filtered.length, page * PAGE + PAGE)} из ${filtered.length}</span>
      <button type="button" class="icon-button" disabled=${page >= pages - 1} onClick=${() => setPage(page + 1)} aria-label="Следующая страница"><${Icon} name="forward" /></button>
    </div>` : null}
    ${total > compact ? html`<button type="button" class="link-button" onClick=${() => { setExpanded(!expanded); setPage(0); setFilter(''); }}
      data-testid="transition-toggle">
      ${expanded ? `Показать только первые ${compact}` : `Показать все переходы: ${total}`}
    </button>` : null}
  </section>`;
}

export function Transitions({ neighbors }) {
  return html`<aside class="transitions" aria-label="Предлагаемые переходы" data-testid="transitions">
    <h2 class="panel-title">Переходы</h2>
    <${TransitionGroup} title="Расширить выборку" icon="up" sign="−" transitions=${neighbors.ancestors} testId="ancestors"
      hint="Убрать теги — перейти к соседнему заполненному предку."
      emptyText=${node().length === 0 ? 'Это корень: убирать нечего.' : 'Заполненных предков нет.'} />
    <${TransitionGroup} title="Сузить выборку" icon="down" sign="+" transitions=${neighbors.descendants} paged testId="descendants"
      hint="Добавить теги — перейти к соседнему заполненному потомку."
      emptyText="Заполненных потомков нет." />
  </aside>`;
}

// ---------- Элементы ----------

export function ItemCard({ item, context = 'browse' }) {
  const index = state.index;
  const tagIds = node();
  const marked = item.tags !== null;
  const own = marked && isOwnItem(item, tagIds);
  const selected = new Set(tagIds);
  const inSelection = context === 'browse' && state.view.mode === 'selection';

  return html`<article class=${cx('item', inSelection && own && 'is-own', !marked && 'is-unmarked')} data-testid="item"
    data-item-id=${item.id} data-own=${own ? 'true' : 'false'}>
    <header class="item-head">
      <h3 class=${cx('item-title', !item.title && 'is-untitled')} data-testid="item-title">${item.title ?? 'Без названия'}</h3>
      ${inSelection && own ? html`<span class="badge badge-own" data-testid="own-badge">собственный элемент узла</span>` : null}
      ${!marked ? html`<span class="badge badge-unmarked">не размечен</span>` : null}
      <time class="item-time" title="Время последнего изменения">${formatTime(item.modifiedAt)}</time>
    </header>
    <div class="item-content"><${ContentView} content=${item.content} compact /></div>
    <footer class="item-foot">
      <div class="item-tags" data-testid="item-tags">
        ${!marked ? html`<span class="markup-none">разметка не задана</span>` : null}
        ${marked && item.tags.length === 0 ? html`<span class="markup-none">пустой набор тегов</span>` : null}
        ${marked ? item.tags.map((id) => {
          const tag = index.tagById.get(id);
          if (context !== 'browse') return html`<${Tag} key=${id} tag=${tag} />`;
          return selected.has(id)
            ? html`<${Tag} key=${id} tag=${tag} variant="muted" title=${`${tag.name} — выбран в текущем узле`} />`
            : html`<${Tag} key=${id} tag=${tag} onClick=${() => navigate([...tagIds, id])}
                title=${`${tag.description ? `${tag.name} — ${tag.description}. ` : ''}Добавить «${tag.name}» к выбранным тегам`} />`;
        }) : null}
      </div>
      <div class="item-actions">
        ${context === 'browse' && marked && !own ? html`<button type="button" class="button button-small button-quiet"
          onClick=${() => navigate(item.tags)} title="Перейти в узел, которому принадлежит элемент" data-testid="item-goto">
          <${Icon} name="target" size=${14} />В узел элемента</button>` : null}
        ${context === 'browse' && !own ? html`<button type="button" class="button button-small button-quiet"
          onClick=${() => openDialog({ type: 'item', itemId: item.id, moveTo: tagIds })}
          title="Заменить разметку элемента набором тегов текущего узла" data-testid="item-move">
          <${Icon} name="move" size=${14} />Переместить сюда</button>` : null}
        <button type="button" class="button button-small button-quiet" onClick=${() => openDialog({ type: 'item', itemId: item.id })}
          data-testid="item-edit"><${Icon} name="edit" size=${14} />Изменить</button>
        <button type="button" class="button button-small button-quiet button-danger-quiet"
          onClick=${() => openDialog({ type: 'delete-item', itemId: item.id })} data-testid="item-delete">
          <${Icon} name="trash" size=${14} />Удалить</button>
      </div>
    </footer>
  </article>`;
}

function ItemList({ items, resetKey }) {
  const [limit, setLimit] = useState(ITEMS_STEP);
  const sentinel = useRef(null);
  useEffect(() => setLimit(ITEMS_STEP), [resetKey]);
  useEffect(() => {
    if (!sentinel.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((n) => n + ITEMS_STEP);
    }, { rootMargin: '600px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [resetKey, limit >= items.length]);

  const shown = items.slice(0, limit);
  return html`<div class="item-list" data-testid="item-list">
    ${shown.map((item) => html`<${ItemCard} key=${item.id} item=${item} />`)}
    ${limit < items.length ? html`<div class="more" ref=${sentinel}>
      <button type="button" class="button" onClick=${() => setLimit(limit + ITEMS_STEP)} data-testid="show-more">
        Показать ещё · показано ${formatNumber(shown.length)} из ${formatNumber(items.length)}</button>
    </div>` : null}
  </div>`;
}

function Notice() {
  const notice = state.notice;
  if (!notice) return null;
  return html`<div class="notice" role="status" data-testid="notice">
    <span class="notice-text">${notice.text}</span>
    ${notice.kind === 'node' ? html`<${NodeTags} tagIds=${notice.tagIds} />
      <button type="button" class="button button-small button-primary" data-testid="notice-go"
        onClick=${() => { setScreen('browse'); navigate(notice.tagIds); }}>Перейти в этот узел</button>` : null}
    ${notice.kind === 'unmarked' && state.screen !== 'markup' ? html`<button type="button" class="button button-small button-primary"
      data-testid="notice-markup" onClick=${() => setScreen('markup')}>Открыть неразмеченные</button>` : null}
    <button type="button" class="icon-button" onClick=${() => setNotice(null)} aria-label="Скрыть сообщение"><${Icon} name="x" size=${14} /></button>
  </div>`;
}

function EmptyState({ view }) {
  const tagIds = view.tagIds;
  const add = html`<button type="button" class="button button-primary" onClick=${() => openDialog({ type: 'item' })}>
    <${Icon} name="plus" />Добавить элемент</button>`;
  if (state.index.itemCount === 0) {
    return html`<div class="empty" data-testid="empty-workspace">
      <h3>Рабочая область пуста</h3>
      <p>Добавьте первую запись. Теги можно задать сразу — они попадут в глоссарий — или разметить запись позже.</p>
      ${add}
    </div>`;
  }
  if (view.selection.length === 0) {
    return html`<div class="empty" data-testid="empty-selection">
      <h3>Нет элементов с выбранными тегами</h3>
      <p>${tagIds.length ? 'Ни одному элементу не назначены все выбранные теги сразу. Уберите часть тегов или добавьте сюда элемент.'
        : 'В рабочей области пока нет размеченных элементов.'}</p>
      <div class="empty-actions">${add}
        ${tagIds.length ? html`<button type="button" class="button" onClick=${goRoot}><${Icon} name="home" />В корень</button>` : null}</div>
    </div>`;
  }
  return html`<div class="empty" data-testid="empty-own">
    <h3>У этого узла нет собственных элементов</h3>
    <p>Ни у одного элемента разметка не совпадает с выбранными тегами точно.
      В выборке узла — ${countItems(view.selection.length)} ${plural(view.selection.length, 'из узла-потомка', 'из узлов-потомков', 'из узлов-потомков')}.</p>
    <div class="empty-actions">
      <button type="button" class="button button-primary" onClick=${() => setMode('selection')} data-testid="empty-show-selection">
        <${Icon} name="layers" />Показать выборку</button>
      ${add}
    </div>
  </div>`;
}

function Timings() {
  const t = state.timings;
  return html`<p class="timings" data-testid="timings">
    Вычисления для узла: отбор ${formatMs(t.select)} · сортировка ${formatMs(t.sort)} · переходы ${formatMs(t.neighbors)} ·
    автодополнение ${formatMs(t.autocomplete)} · элементов в выборке ${formatNumber(t.selectionSize ?? 0)}
  </p>`;
}

export function Browse() {
  const view = currentView();
  const mode = state.view.mode;
  const items = mode === 'own' ? view.own : view.selection;
  const resetKey = `${nodeKey(view.tagIds)}|${mode}|${state.view.sort}`;

  return html`<div class="browse">
    <${NodeBar} />
    <div class="columns">
      <${Transitions} neighbors=${view.neighbors} />
      <main class="main" data-testid="main">
        <div class="toolbar">
          <${Segmented} label="Что показывать" value=${mode} onChange=${setMode} testId="mode-switch" options=${[
            { value: 'own', label: 'Собственные элементы', count: formatNumber(view.own.length) },
            { value: 'selection', label: 'Выборка узла', count: formatNumber(view.selection.length) },
          ]} />
          <${Segmented} label="Сортировка" value=${state.view.sort} onChange=${setSort} testId="sort-switch" options=${[
            { value: 'time', label: 'Сначала новые' },
            { value: 'title', label: 'По названию' },
          ]} />
          <button type="button" class="button button-primary toolbar-add" onClick=${() => openDialog({ type: 'item' })} data-testid="add-item">
            <${Icon} name="plus" />Добавить элемент</button>
        </div>
        <${Notice} />
        ${mode === 'selection' && view.selection.length > 0 ? html`<p class="list-caption" data-testid="list-caption">
          ${view.own.length > 0
            ? `Выборка: ${countItems(view.selection.length)}, из них собственных — ${formatNumber(view.own.length)} (выделены).`
            : `Выборка: ${countItems(view.selection.length)}; собственных элементов у узла нет.`}
        </p>` : null}
        ${items.length > 0 ? html`<${ItemList} items=${items} resetKey=${resetKey} />` : html`<${EmptyState} view=${view} />`}
        ${state.settings.showTimings ? html`<${Timings} />` : null}
      </main>
    </div>
  </div>`;
}
