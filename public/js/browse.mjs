// Просмотр узла: текущие теги, предлагаемые переходы, элементы и способы их показа.
import { html, cx, useState, useEffect, useLayoutEffect, useRef, formatTime, formatNumber, formatMs } from './lib.mjs';
import {
  state, node, navigate, goRoot, goBack, goForward, canGoBack, canGoForward, setMode, setSort, setDisplay, setPage, setEdge,
  setScreen, currentView, openDialog, setNotice, tagNames,
} from './store.mjs';
import { Icon, Tag, NodeTags, Segmented, Menu, AddButton } from './components.mjs';
import { TagInput } from './tag-input.mjs';
import { ContentView } from './content-view.mjs';
import { COMPACT_TRANSITIONS, nodeKey, isOwnItem } from '/shared/model.mjs';
import { decideDisplay, pageSlice, edgeSlice, EDGE_COUNT } from '/shared/display.mjs';

const TRANSITIONS_PAGE = 12;
// Ниже этой высоты карточка не бывает: множество крупнее заведомо не поместится на экране.
const MIN_CARD_HEIGHT = 56;

// ---------- Текущий узел ----------

export function NodeBar() {
  const tagIds = node();
  const index = state.index;
  const bar = useRef(null);
  // Высота панели меняется вместе с числом выбранных тегов; под неё подстраивается закреплённая колонка переходов.
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
      if (!tag) return `Тега «${name}» нет в рабочей области.`;
      if (!tagIds.includes(tag.id)) ids.push(tag.id);
    }
    if (ids.length) navigate([...tagIds, ...ids]);
    return null;
  };

  return html`<section class="nodebar" aria-label="Текущий узел" data-testid="nodebar" ref=${bar}>
    <div class="nav-buttons">
      <button type="button" class="icon-button" onClick=${goBack} disabled=${!canGoBack()} title="Назад (Alt+←)"
        aria-label="Назад" data-testid="nav-back"><${Icon} name="back" size=${20} /></button>
      <button type="button" class="icon-button" onClick=${goForward} disabled=${!canGoForward()} title="Вперёд (Alt+→)"
        aria-label="Вперёд" data-testid="nav-forward"><${Icon} name="forward" size=${20} /></button>
      <button type="button" class="icon-button" onClick=${goRoot} disabled=${tagIds.length === 0}
        title="В корень: снять все теги" aria-label="В корень" data-testid="nav-root"><${Icon} name="home" size=${19} /></button>
    </div>
    <div class="node-tags" data-testid="node-tags">
      ${tagIds.length === 0
        ? html`<span class="root-mark" data-testid="root-mark">корень</span>`
        : tagIds.map((id) => html`<${Tag} key=${id} tag=${index.tagById.get(id)} variant="node"
            removeLabel=${`Убрать тег ${index.tagById.get(id).name}`}
            onRemove=${() => navigate(tagIds.filter((other) => other !== id))} />`)}
      <${TagInput} mode="nav" selectedIds=${tagIds} onAdd=${addTags} inputId="nav-tag-input" testId="nav-input"
        placeholder=${tagIds.length ? 'ещё тег…' : 'Тег…'} />
    </div>
    <${AddButton} />
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
      <span class="t-sign" aria-hidden="true">${sign}</span>
      <span class="t-tags">
        <span class="visually-hidden">${sign === '+' ? 'добавить' : 'убрать'} </span>
        ${transition.changed.map((id) => html`<span class="t-tag" key=${id}>${index.tagById.get(id).name}</span>`)}
        ${sign === '−' && transition.changed.length > 1
          ? html`<span class="t-rest" data-testid="transition-rest">→ ${target}</span>` : null}
      </span>
      <span class="t-count" title="Элементов в выборке узла" data-testid="transition-selection">${formatNumber(transition.selection)}</span>
      ${state.settings.showOwnCounts
        ? html`<span class="own-count" title="Собственных элементов узла" data-testid="transition-own">${formatNumber(transition.own)}</span>` : null}
      <span class="t-bar" aria-hidden="true"><span style=${`width:${Math.round(share * 100)}%`}></span></span>
    </button>
  </li>`;
}

function TransitionGroup({ title, icon, sign, transitions, paged, testId }) {
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
  if (total === 0) return null;
  const max = transitions.reduce((value, t) => Math.max(value, t.selection), 0);
  let shown = transitions;
  let filtered = transitions;
  if (!expanded) {
    shown = transitions.slice(0, COMPACT_TRANSITIONS);
  } else if (paged) {
    const query = filter.trim().toLowerCase();
    if (query) filtered = transitions.filter((t) => t.label.includes(query));
    shown = filtered.slice(page * TRANSITIONS_PAGE, page * TRANSITIONS_PAGE + TRANSITIONS_PAGE);
  }
  const pages = Math.ceil(filtered.length / TRANSITIONS_PAGE);

  return html`<section class=${cx('tgroup', expanded && 'is-expanded')} data-testid=${testId}>
    <h3 class="tgroup-title"><${Icon} name=${icon} size=${15} />${title}<span class="group-count" title="Всего переходов">${total}</span></h3>
    ${expanded && paged && total > TRANSITIONS_PAGE ? html`<label class="filter-field tgroup-filter">
      <${Icon} name="search" size=${14} />
      <input type="search" class="input-plain" placeholder="Тег" aria-label="Найти переход по тегу" value=${filter} data-testid="transition-filter"
        onInput=${(event) => { setFilter(event.target.value); setPage(0); }} />
    </label>` : null}
    <ul class=${cx('tlist', expanded && !paged && 'is-scroll')}>
      ${shown.map((t) => html`<${Transition} key=${nodeKey(t.tagIds)} transition=${t} sign=${sign} max=${max} />`)}
      ${total > COMPACT_TRANSITIONS ? html`<li><button type="button" class="transition transition-more"
        onClick=${() => { setExpanded(!expanded); setPage(0); setFilter(''); }} data-testid="transition-toggle">
        ${expanded ? 'Свернуть' : `Все ${total}`}</button></li>` : null}
    </ul>
    ${expanded && paged && filtered.length === 0 ? html`<p class="group-empty">Нет переходов с таким тегом.</p>` : null}
    ${expanded && paged && pages > 1 ? html`<div class="pager" data-testid="transition-pager">
      <button type="button" class="icon-button" disabled=${page === 0} onClick=${() => setPage(page - 1)} aria-label="Предыдущая страница"><${Icon} name="back" /></button>
      <span>${page * TRANSITIONS_PAGE + 1}–${Math.min(filtered.length, page * TRANSITIONS_PAGE + TRANSITIONS_PAGE)} из ${filtered.length}</span>
      <button type="button" class="icon-button" disabled=${page >= pages - 1} onClick=${() => setPage(page + 1)} aria-label="Следующая страница"><${Icon} name="forward" /></button>
    </div>` : null}
  </section>`;
}

export function Transitions({ neighbors }) {
  const none = neighbors.ancestors.length === 0 && neighbors.descendants.length === 0;
  return html`<aside class="transitions" aria-label="Предлагаемые переходы" data-testid="transitions">
    <${TransitionGroup} title="Расширить" icon="up" sign="−" transitions=${neighbors.ancestors} testId="ancestors" />
    <${TransitionGroup} title="Сузить" icon="down" sign="+" transitions=${neighbors.descendants} paged testId="descendants" />
    ${none ? html`<p class="group-empty" data-testid="no-transitions">Переходов нет</p>` : null}
  </aside>`;
}

// ---------- Элементы ----------

/** probe — карточка в невидимом списке для измерения вместимости экрана. */
export function ItemCard({ item, context = 'browse', probe, eager }) {
  const index = state.index;
  const tagIds = node();
  const marked = item.tags !== null;
  const own = marked && isOwnItem(item, tagIds);
  const selected = new Set(tagIds);
  const inSelection = context === 'browse' && state.view.mode === 'selection';
  const menu = [];
  if (context === 'browse' && !own) {
    menu.push({ label: 'Переместить сюда', icon: 'move', testId: 'item-move', onClick: () => openDialog({ type: 'item', itemId: item.id, moveTo: tagIds }) });
  }
  menu.push({ label: 'Удалить', icon: 'trash', danger: true, testId: 'item-delete', onClick: () => openDialog({ type: 'delete-item', itemId: item.id }) });

  return html`<article class=${cx('item', inSelection && own && 'is-own', !marked && 'is-unmarked')} data-testid=${probe ? 'probe-item' : 'item'}
    data-item-id=${item.id} data-own=${own ? 'true' : 'false'}>
    <header class="item-head">
      <h3 class=${cx('item-title', !item.title && 'is-untitled')} data-testid="item-title">${item.title ?? 'Без названия'}</h3>
      ${inSelection && own ? html`<span class="badge badge-own" data-testid="own-badge">собственный</span>` : null}
      ${!marked ? html`<span class="badge badge-unmarked">не размечен</span>` : null}
      <time class="item-time" title="Время последнего изменения">${formatTime(item.modifiedAt)}</time>
    </header>
    <div class="item-content"><${ContentView} content=${item.content} compact eager=${eager} /></div>
    <footer class="item-foot">
      <div class="item-tags" data-testid="item-tags">
        ${!marked ? html`<span class="markup-none">разметка не задана</span>` : null}
        ${marked && item.tags.length === 0 ? html`<span class="markup-none">без тегов</span>` : null}
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
          <${Icon} name="target" size=${14} />В узел</button>` : null}
        <button type="button" class="button button-small button-quiet" onClick=${() => openDialog({ type: 'item', itemId: item.id })}
          data-testid="item-edit"><${Icon} name="edit" size=${14} />Изменить</button>
        <${Menu} label="Ещё действия" items=${menu} testId="item-menu" />
      </div>
    </footer>
  </article>`;
}

function ItemList({ items, probe, eager }) {
  return html`<div class="item-list" data-testid=${probe ? 'probe-list' : 'item-list'}>
    ${items.map((item) => html`<${ItemCard} key=${item.id} item=${item} probe=${probe} eager=${eager} />`)}
  </div>`;
}

/** Элементы есть, но скрыты ограничением обозримости. */
function HiddenPanel({ count, reason }) {
  const edge = Math.min(EDGE_COUNT, count);
  return html`<div class="hidden-panel" data-testid="hidden-state" data-count=${count} data-reason=${reason}>
    <p class="hidden-count"><${Icon} name="hidden" size=${20} />Скрыто элементов: <strong>${formatNumber(count)}</strong></p>
    <p class="hidden-reason">${reason === 'fit' ? 'Не помещаются на экране' : `Больше предела: ${formatNumber(state.settings.limit)}`}</p>
    <div class="hidden-actions">
      <button type="button" class="button" onClick=${() => setEdge('first')} data-testid="show-first">Первые ${edge}</button>
      <button type="button" class="button" onClick=${() => setEdge('last')} data-testid="show-last">Последние ${edge}</button>
      <button type="button" class="button" onClick=${() => setDisplay('pages')} data-testid="show-pages">По страницам</button>
    </div>
  </div>`;
}

/** Крайние позиции отсортированного множества, показанные по запросу. */
function EdgeList({ items }) {
  const edge = state.edge;
  const shown = edgeSlice(items, edge);
  return html`<div class="edge-head" data-testid="edge-head" data-edge=${edge}>
    <span class="edge-title">${edge === 'first' ? 'Первые' : 'Последние'} ${shown.length} из ${formatNumber(items.length)}</span>
    <button type="button" class="button button-small" onClick=${() => setEdge(edge === 'first' ? 'last' : 'first')}
      data-testid=${edge === 'first' ? 'show-last' : 'show-first'}>${edge === 'first' ? 'Последние' : 'Первые'} ${shown.length}</button>
    <button type="button" class="button button-small" onClick=${() => setEdge(null)} data-testid="hide-edge">Скрыть</button>
  </div>
  <${ItemList} items=${shown} />`;
}

function Pager({ slice, testId }) {
  return html`<nav class="pager item-pager" aria-label="Страницы" data-testid=${testId} data-page=${slice.page + 1} data-pages=${slice.pages}>
    <button type="button" class="icon-button" disabled=${slice.page === 0} onClick=${() => setPage(0)}
      aria-label="Первая страница" title="Первая страница" data-testid="page-first"><${Icon} name="first" /></button>
    <button type="button" class="icon-button" disabled=${slice.page === 0} onClick=${() => setPage(slice.page - 1)}
      aria-label="Предыдущая страница" title="Предыдущая страница" data-testid="page-prev"><${Icon} name="back" /></button>
    <span class="pager-label" data-testid="pager-label">${formatNumber(slice.from)}–${formatNumber(slice.to)} из ${formatNumber(slice.total)}</span>
    <button type="button" class="icon-button" disabled=${slice.page >= slice.pages - 1} onClick=${() => setPage(slice.page + 1)}
      aria-label="Следующая страница" title="Следующая страница" data-testid="page-next"><${Icon} name="forward" /></button>
    <button type="button" class="icon-button" disabled=${slice.page >= slice.pages - 1} onClick=${() => setPage(slice.pages - 1)}
      aria-label="Последняя страница" title="Последняя страница" data-testid="page-last"><${Icon} name="last" /></button>
  </nav>`;
}

function PagedList({ items }) {
  const slice = pageSlice(items, state.page, state.settings.pageSize);
  return html`<${Pager} slice=${slice} testId="pager" />
    <${ItemList} items=${slice.items} />
    ${slice.pages > 1 && slice.items.length > 3 ? html`<${Pager} slice=${slice} testId="pager-bottom" />` : null}`;
}

/**
 * Показ по вместимости экрана: все элементы показываются, только если список
 * целиком помещается от своего начала до нижней границы окна без прокрутки.
 * Список сначала строится невидимым и измеряется; пересчёт — при изменении
 * размеров окна, списка (в том числе после загрузки медиа) и всего, что выше.
 */
function FitArea({ items }) {
  const anchor = useRef(null);
  const probe = useRef(null);
  const [fits, setFits] = useState(null);
  const [room, setRoom] = useState(null);

  // Заведомо не помещающееся множество не строится вовсе.
  const possible = room === null ? items.length <= 40 : items.length * MIN_CARD_HEIGHT <= room;

  const measure = () => {
    if (!anchor.current) return;
    const reserve = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fit-reserve')) || 0;
    const top = anchor.current.getBoundingClientRect().top + window.scrollY;
    const available = Math.floor(window.innerHeight - reserve - top);
    let next = false;
    const list = probe.current;
    if (list) {
      const waiting = [...list.querySelectorAll('img')].some((image) => !image.complete)
        || [...list.querySelectorAll('video')].some((video) => video.readyState < 1 && !video.error);
      next = waiting ? null : list.offsetHeight <= available;
    }
    setRoom(available);
    setFits(next);
  };

  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (probe.current) observer.observe(probe.current);
    window.addEventListener('resize', measure);
    // События загрузки медиа не всплывают — ловим их на фазе перехвата.
    const area = anchor.current;
    for (const name of ['load', 'error', 'loadedmetadata']) area.addEventListener(name, measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      for (const name of ['load', 'error', 'loadedmetadata']) area.removeEventListener(name, measure, true);
    };
  }, [possible]);

  const shown = possible && fits === true;
  useClearEdge(shown);
  return html`<div class="fit-anchor" ref=${anchor} data-testid="fit-area" data-fits=${String(possible ? fits : false)} data-room=${room}>
      ${possible ? html`<div class=${cx('fit-list', !shown && 'is-probe')} ref=${probe} inert=${!shown} aria-hidden=${!shown}>
        <${ItemList} items=${items} probe=${!shown} eager />
      </div>` : null}
    </div>
    ${possible && fits === null ? html`<p class="measuring" data-testid="measuring">Проверяется, помещаются ли элементы…</p>` : null}
    ${!possible || fits === false ? (state.edge ? html`<${EdgeList} items=${items} />` : html`<${HiddenPanel} count=${items.length} reason="fit" />`) : null}`;
}

function Notice() {
  const notice = state.notice;
  if (!notice) return null;
  return html`<div class="notice" role="status" data-testid="notice">
    <span class="notice-text">${notice.text}</span>
    ${notice.kind === 'node' ? html`<${NodeTags} tagIds=${notice.tagIds} />
      <button type="button" class="button button-small button-primary" data-testid="notice-go"
        onClick=${() => { setScreen('browse'); navigate(notice.tagIds); }}>Перейти</button>` : null}
    ${notice.kind === 'unmarked' && state.screen !== 'markup' ? html`<button type="button" class="button button-small button-primary"
      data-testid="notice-markup" onClick=${() => setScreen('markup')}>Разметить</button>` : null}
    <button type="button" class="icon-button" onClick=${() => setNotice(null)} aria-label="Скрыть сообщение"><${Icon} name="x" size=${14} /></button>
  </div>`;
}

/** Элементов для показа нет: три различимых состояния. */
function EmptyState({ view }) {
  const tagIds = view.tagIds;
  if (state.index.itemCount === 0) {
    return html`<div class="empty" data-testid="empty-workspace"><h3>Рабочая область пуста</h3></div>`;
  }
  if (view.selection.length === 0) {
    return html`<div class="empty" data-testid="empty-selection">
      <h3>${tagIds.length ? 'Нет элементов с выбранными тегами' : 'Размеченных элементов нет'}</h3>
      ${tagIds.length ? html`<button type="button" class="button" onClick=${goRoot}><${Icon} name="home" />В корень</button>` : null}
    </div>`;
  }
  return html`<div class="empty" data-testid="empty-own">
    <h3>У узла нет собственных элементов</h3>
    <button type="button" class="button" onClick=${() => setMode('selection')} data-testid="empty-show-selection">
      <${Icon} name="layers" />Выборка: ${formatNumber(view.selection.length)}</button>
  </div>`;
}

/** Запрос крайних позиций теряет смысл, как только множество показано целиком. */
function useClearEdge(shownInFull) {
  useEffect(() => {
    if (shownInFull && state.edge) setEdge(null);
  });
}

function ItemsArea({ view }) {
  const items = state.view.mode === 'own' ? view.own : view.selection;
  const display = state.view.display;
  const decision = display === 'fit' ? 'fit' : decideDisplay({ display, count: items.length, limit: state.settings.limit });
  useClearEdge(decision === 'all' || decision === 'empty');
  if (items.length === 0) return html`<${EmptyState} view=${view} />`;
  if (display === 'fit') return html`<${FitArea} key=${`${nodeKey(view.tagIds)}|${state.view.mode}`} items=${items} />`;
  if (decision === 'pages') return html`<${PagedList} items=${items} />`;
  if (decision === 'all') return html`<${ItemList} items=${items} />`;
  return state.edge ? html`<${EdgeList} items=${items} />` : html`<${HiddenPanel} count=${items.length} reason="limit" />`;
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
  const settings = state.settings;

  return html`<div class="browse">
    <${NodeBar} />
    <div class="columns">
      <${Transitions} neighbors=${view.neighbors} />
      <main class="main" data-testid="main">
        <div class="controls">
          <${Segmented} label="Состав элементов" value=${state.view.mode} onChange=${setMode} testId="mode-switch" options=${[
            { value: 'own', label: 'Собственные', count: formatNumber(view.own.length), countClass: 'own-count', title: 'Собственные элементы узла' },
            { value: 'selection', label: 'Выборка', count: formatNumber(view.selection.length), title: 'Вся выборка узла' },
          ]} />
          <${Segmented} label="Сортировка" value=${state.view.sort} onChange=${setSort} testId="sort-switch" options=${[
            { value: 'time', label: 'Новые', title: 'Сначала недавно изменённые' },
            { value: 'title', label: 'А–Я', title: 'По названию' },
          ]} />
          <${Segmented} label="Способ показа" value=${state.view.display} onChange=${setDisplay} testId="display-switch" options=${[
            { value: 'limit', label: `До ${formatNumber(settings.limit)}`, title: `Показывать, если элементов не больше ${settings.limit}` },
            { value: 'fit', label: 'Экран', title: 'Показывать, если все элементы помещаются на экране' },
            { value: 'pages', label: `По ${formatNumber(settings.pageSize)}`, title: `Страницами по ${settings.pageSize}` },
          ]} />
        </div>
        <${Notice} />
        <${ItemsArea} view=${view} />
        ${state.settings.showTimings ? html`<${Timings} />` : null}
      </main>
    </div>
  </div>`;
}
