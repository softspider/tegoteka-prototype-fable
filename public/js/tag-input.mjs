// Ввод тегов с автодополнением: для навигации и для разметки.
import { html, cx, useState, useRef, useEffect, useLayoutEffect } from './lib.mjs';
import { state, recordTiming } from './store.mjs';
import { Tag } from './components.mjs';
import { suggestForNavigation, suggestForMarkup } from '/shared/model.mjs';
import { normalizeTagName, parseTagInput, tagNameError } from '/shared/tags.mjs';

const SEPARATOR = /[\s,;]/u;

/**
 * Поле ввода тега.
 *   mode 'nav'    — подсказки по выборке текущего узла; принимаются только теги области.
 *   mode 'markup' — подсказки по всем тегам области; новые названия создают теги.
 * onAdd(names) возвращает текст ошибки или null.
 */
export function TagInput({ mode, selectedIds, onAdd, onBackspace, placeholder, inputId, autoFocus, testId, api }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const index = state.index;

  // Доступ к ещё не подтверждённому вводу: сохранение формы учитывает набранные теги.
  if (api) {
    api.current = {
      pending: () => parseTagInput(text),
      clear: () => {
        setText('');
        setOpen(false);
        setError(null);
      },
    };
  }

  const query = normalizeTagName(text);
  let suggestions = { items: [], total: 0 };
  if (open) {
    const started = performance.now();
    suggestions = mode === 'nav'
      ? suggestForNavigation(index, selectedIds, query, 10)
      : suggestForMarkup(index, selectedIds, query, 10);
    if (mode === 'nav') recordTiming('autocomplete', performance.now() - started);
  }

  const exact = query ? index.tagByName.get(query) : null;
  const exactSelected = exact && selectedIds.includes(exact.id);
  const exactSuggested = exact && suggestions.items.some((s) => s.tag.id === exact.id);
  // Навигация: тег области вне текущей выборки задаётся явно, полным названием.
  const outside = mode === 'nav' && exact && !exactSelected && !exactSuggested;
  const creatable = mode === 'markup' && query && !exact && !tagNameError(query);

  const rows = suggestions.items.map((s) => ({ kind: 'tag', name: s.tag.name, tag: s.tag, count: s.count }));
  if (creatable) rows.push({ kind: 'create', name: query });
  const activeRow = open && rows.length ? rows[Math.min(active, rows.length - 1)] : null;

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const add = (names, rest = '') => {
    const problem = names.length ? onAdd(names) : null;
    if (problem) {
      setError(problem);
      return false;
    }
    setError(null);
    setText(rest);
    setActive(0);
    // После добавления тега список скрыт, чтобы не заслонять остальное; он вернётся при вводе.
    if (!rest) setOpen(false);
    return true;
  };

  const onInput = (event) => {
    const value = event.target.value;
    setError(null);
    setOpen(true);
    setActive(0);
    if (!SEPARATOR.test(value)) {
      setText(value);
      return;
    }
    // Разделитель завершает тег: добавляем всё, что введено до последнего разделителя.
    const endsWithSeparator = SEPARATOR.test(value[value.length - 1]);
    const parts = value.split(/[\s,;]+/u).filter(Boolean);
    const rest = endsWithSeparator ? '' : parts.pop() ?? '';
    if (!add(parseTagInput(parts.join(' ')), rest)) setText(value.trimEnd());
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((n) => Math.min(n + 1, Math.max(rows.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((n) => Math.max(n - 1, 0));
    } else if (event.key === 'Enter') {
      if (!text.trim() && !activeRow) return;
      event.preventDefault();
      event.stopPropagation();
      // Точное название имеет преимущество перед выделенной подсказкой.
      if (query && (exact || !activeRow)) add([query]);
      else if (activeRow) add([activeRow.name]);
    } else if (event.key === 'Tab' && open && activeRow && text.trim()) {
      event.preventDefault();
      add([activeRow.name]);
    } else if (event.key === 'Escape') {
      if (open && (rows.length || text)) {
        event.stopPropagation();
        setOpen(false);
        setText('');
        setError(null);
      }
    } else if (event.key === 'Backspace' && !text && onBackspace) {
      onBackspace();
    }
  };

  const showPanel = Boolean(open && (rows.length > 0 || outside || query));

  // Список подсказок закреплён относительно окна, чтобы его не обрезали прокручиваемые области.
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (!showPanel) return undefined;
    const update = () => {
      const rect = inputRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const upward = below < 240 && rect.top > below;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 328));
      setPlace(upward
        ? `left:${left}px;bottom:${window.innerHeight - rect.top + 6}px;--suggest-room:${Math.max(120, rect.top - 90)}px`
        : `left:${left}px;top:${rect.bottom + 6}px;--suggest-room:${Math.max(120, below - 90)}px`);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showPanel, text, rows.length]);
  return html`<div class="tag-input" data-testid=${testId}>
    <input ref=${inputRef} id=${inputId} type="text" class="tag-input-field" value=${text} placeholder=${placeholder}
      autocomplete="off" autocapitalize="none" spellcheck=${false} data-autofocus=${autoFocus || undefined}
      role="combobox" aria-expanded=${showPanel} aria-autocomplete="list"
      onInput=${onInput} onKeyDown=${onKeyDown}
      onFocus=${() => mode === 'nav' && setOpen(true)} onClick=${() => setOpen(true)} onBlur=${() => setOpen(false)} />
    ${showPanel ? html`<div class="suggest" style=${place ?? 'visibility:hidden'} ref=${listRef} onMouseDown=${(event) => event.preventDefault()} data-testid="suggestions">
      ${rows.length > 0 ? html`<ul class="suggest-list" role="listbox">
        ${rows.map((row, i) => html`<li key=${`${row.kind}:${row.name}`} role="option" aria-selected=${row === activeRow}
          class=${cx('suggest-row', row === activeRow && 'is-active', row.kind === 'create' && 'is-create')}
          onMouseEnter=${() => setActive(i)} onClick=${() => { add([row.name]); inputRef.current?.focus(); }}
          data-suggest=${row.name}>
          ${row.kind === 'create'
            ? html`<span class="suggest-name">Создать тег «${row.name}»</span>`
            : html`<span class="suggest-name">${row.name}</span>
                ${row.tag.description ? html`<span class="suggest-desc">${row.tag.description}</span>` : null}
                <span class="suggest-count" title=${mode === 'nav' ? 'Элементов в выборке после добавления тега' : 'Элементов с этим тегом'}>${row.count}</span>`}
        </li>`)}
      </ul>` : null}
      ${suggestions.total > suggestions.items.length
        ? html`<p class="suggest-note">Показано ${suggestions.items.length} из ${suggestions.total} — уточните название.</p>` : null}
      ${outside ? html`<p class="suggest-note" data-testid="suggest-outside">Тег «${query}» есть в рабочей области, но не встречается в текущей выборке. Enter — перейти в такой узел.</p>` : null}
      ${mode === 'nav' && query && !exact && rows.length === 0
        ? html`<p class="suggest-note" data-testid="suggest-none">В текущей выборке нет тегов, подходящих к «${query}».</p>` : null}
      ${exactSelected ? html`<p class="suggest-note">Тег «${query}» уже выбран.</p>` : null}
    </div>` : null}
    ${error ? html`<p class="field-error" role="alert" data-testid="tag-input-error">${error}</p>` : null}
  </div>`;
}

/**
 * Редактор разметки элемента: редактируемый набор тегов, исходный набор для
 * сравнения и описания новых тегов.
 *
 *   names        — редактируемый набор (названия в порядке ввода)
 *   original     — исходный набор названий; null — разметка не задана;
 *                  undefined — нового элемента ещё нет в рабочей области
 *   descriptions — описания новых тегов: { название: текст }
 *   inputApi     — доступ к неподтверждённому вводу (см. TagInput)
 *   offer        — сохранение приостановлено, чтобы предложить описания новых тегов
 */
export function MarkupEditor({ names, onNames, original, descriptions, onDescriptions, autoFocus, inputId, inputApi, offer }) {
  const index = state.index;
  const selectedIds = names.map((name) => index.tagByName.get(name)?.id).filter(Boolean);
  const originalSet = new Set(original ?? []);
  const currentSet = new Set(names);
  const fresh = names.filter((name) => !index.tagByName.has(name));

  const add = (incoming) => {
    for (const name of incoming) {
      const problem = tagNameError(name);
      if (problem) return problem;
    }
    const merged = [...names];
    for (const name of incoming) if (!currentSet.has(name)) merged.push(name);
    onNames(merged);
    return null;
  };
  const remove = (name) => onNames(names.filter((candidate) => candidate !== name));

  const variantOf = (name) => {
    if (!index.tagByName.has(name)) return 'fresh';
    if (original !== undefined && original !== null && !originalSet.has(name)) return 'added';
    return 'plain';
  };

  return html`<div class="markup-editor">
    ${original !== undefined ? html`<div class="markup-original" data-testid="original-tags">
      <span class="markup-caption">Исходная разметка</span>
      ${original === null
        ? html`<span class="markup-none">не задана</span>`
        : original.length === 0
          ? html`<span class="markup-none">пустой набор тегов</span>`
          : html`<span class="tag-row">${original.map((name) => html`<${Tag} key=${name}
              tag=${index.tagByName.get(name) ?? { name }} variant=${currentSet.has(name) ? 'muted' : 'removed'}
              title=${currentSet.has(name) ? undefined : 'Убран из редактируемого набора'} />`)}</span>`}
    </div>` : null}
    <div class="markup-current" data-testid="edited-tags">
      ${original !== undefined ? html`<span class="markup-caption">Новая разметка</span>` : null}
      <div class="chip-field">
        ${names.map((name) => html`<${Tag} key=${name} tag=${index.tagByName.get(name) ?? { name }} variant=${variantOf(name)}
          sign=${variantOf(name) === 'added' ? '+' : null}
          title=${variantOf(name) === 'fresh' ? 'Новый тег: будет добавлен в рабочую область при сохранении' : undefined}
          onRemove=${() => remove(name)} />`)}
        <${TagInput} mode="markup" selectedIds=${selectedIds} onAdd=${add} inputId=${inputId} autoFocus=${autoFocus} api=${inputApi}
          onBackspace=${() => names.length && remove(names[names.length - 1])}
          placeholder=${names.length ? 'ещё тег…' : 'Теги через пробел'} testId="markup-input" />
      </div>
    </div>
    ${fresh.length > 0 ? html`<div class=${cx('fresh-tags', offer && 'is-offer')} data-testid="new-tags">
      <span class="markup-caption">Новые теги</span>
      ${offer ? html`<p class="fresh-offer" role="status" data-testid="description-offer">Добавьте описание или сохраните без него.</p>` : null}
      ${fresh.map((name) => html`<label class="fresh-row" key=${name}>
        <${Tag} tag=${{ name }} variant="fresh" />
        <input type="text" class="input" placeholder="Описание (необязательно)" value=${descriptions[name] ?? ''}
          maxlength="1000" data-testid=${`new-tag-description-${name}`}
          onInput=${(event) => onDescriptions({ ...descriptions, [name]: event.target.value })} />
      </label>`)}
    </div>` : null}
  </div>`;
}

/**
 * Подтверждает набранный, но ещё не подтверждённый ввод тегов перед сохранением.
 * Возвращает { names, error, offered }; offered — новые теги, описание которых
 * пользователю ещё не предлагалось.
 */
export function commitPendingTags(names, inputApi) {
  const pending = inputApi.current?.pending() ?? [];
  for (const name of pending) {
    const problem = tagNameError(name);
    if (problem) return { names, error: problem, offered: [] };
  }
  const added = pending.filter((name) => !names.includes(name));
  inputApi.current?.clear();
  return {
    names: [...names, ...added],
    error: null,
    offered: added.filter((name) => !state.index.tagByName.has(name)),
  };
}
