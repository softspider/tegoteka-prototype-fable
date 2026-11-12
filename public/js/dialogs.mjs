// Глоссарий тегов, настройки и рабочие области.
import { html, cx, useState, formatNumber, countItems, plural, formatTime } from './lib.mjs';
import {
  state, node, navigate, runOp, closeDialog, openDialog, toast, setSetting, setScreen,
  createWorkspace, openWorkspace, renameWorkspace, deleteWorkspace,
} from './store.mjs';
import { Icon, Modal, ConfirmDialog, Tag, Switch } from './components.mjs';
import { sortTags } from '/shared/model.mjs';
import { LIMIT_RANGE, PAGE_SIZE_RANGE } from '/shared/display.mjs';
import { normalizeTagName } from '/shared/tags.mjs';

// ---------- Глоссарий ----------

function GlossaryRow({ tag }) {
  const [editing, setEditing] = useState(null); // 'name' | 'description'
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const used = state.index.usage.get(tag.id) ?? 0;
  const selected = node().includes(tag.id);

  const start = (what) => {
    setEditing(what);
    setValue(what === 'name' ? tag.name : tag.description);
    setError(null);
  };
  const submit = async (event) => {
    event.preventDefault();
    try {
      if (editing === 'name') await runOp({ type: 'renameTag', id: tag.id, name: value });
      else await runOp({ type: 'describeTag', id: tag.id, description: value });
      setEditing(null);
    } catch (failure) {
      setError(failure.message);
    }
  };
  const go = () => {
    closeDialog();
    setScreen('browse');
    navigate([tag.id]);
  };

  return html`<li class="glossary-row" data-testid="glossary-row" data-tag=${tag.name}>
    <div class="glossary-main">
      ${editing === 'name' ? html`<form class="inline-form" onSubmit=${submit}>
        <input type="text" class="input" value=${value} onInput=${(event) => { setValue(event.target.value); setError(null); }}
          aria-label="Новое название тега" data-autofocus data-testid="rename-input" ref=${(el) => el?.focus()} />
        <button type="submit" class="button button-small button-primary" data-testid="rename-save">Переименовать</button>
        <button type="button" class="button button-small" onClick=${() => setEditing(null)}>Отмена</button>
      </form>` : html`<${Tag} tag=${tag} variant=${selected ? 'node' : 'plain'} />`}
      <span class="glossary-usage" data-testid="glossary-usage">${used === 0 ? 'не используется' : countItems(used)}</span>
    </div>
    ${editing === 'description' ? html`<form class="inline-form" onSubmit=${submit}>
      <input type="text" class="input" value=${value} maxlength="1000" onInput=${(event) => setValue(event.target.value)}
        aria-label="Описание тега" placeholder="Что означает этот тег" data-testid="description-input" ref=${(el) => el?.focus()} />
      <button type="submit" class="button button-small button-primary" data-testid="description-save">Сохранить</button>
      <button type="button" class="button button-small" onClick=${() => setEditing(null)}>Отмена</button>
    </form>` : html`<p class=${cx('glossary-description', !tag.description && 'is-empty')} data-testid="glossary-description">
      ${tag.description || 'Описание не задано'}</p>`}
    ${error ? html`<p class="field-error" role="alert" data-testid="glossary-error">${error}</p>` : null}
    <div class="glossary-actions">
      <button type="button" class="button button-small button-quiet" onClick=${go} data-testid="glossary-go"
        title="Сделать текущим узел с одним этим тегом"><${Icon} name="target" size=${14} />В узел</button>
      <button type="button" class="button button-small button-quiet" onClick=${() => start('description')} data-testid="glossary-describe">
        <${Icon} name="note" size=${14} />Описание</button>
      <button type="button" class="button button-small button-quiet" onClick=${() => start('name')} data-testid="glossary-rename">
        <${Icon} name="edit" size=${14} />Переименовать</button>
      <button type="button" class="button button-small button-quiet button-danger-quiet"
        onClick=${() => openDialog({ type: 'delete-tag', tagId: tag.id })} data-testid="glossary-delete">
        <${Icon} name="trash" size=${14} />Удалить</button>
    </div>
  </li>`;
}

export function GlossaryDialog() {
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const query = normalizeTagName(filter);
  const tags = sortTags(state.ws.tags).filter((tag) => !query || tag.name.includes(query) || tag.description.toLowerCase().includes(filter.trim().toLowerCase()));

  const add = async (event) => {
    event.preventDefault();
    try {
      await runOp({ type: 'addTag', name, description });
      setName('');
      setDescription('');
      setError(null);
    } catch (failure) {
      setError(failure.message);
    }
  };

  return html`<${Modal} title="Глоссарий тегов" size="large" testId="glossary-dialog">
    <div class="glossary-tools">
      <label class="filter-field">
        <${Icon} name="search" size=${14} />
        <input type="search" class="input-plain" placeholder="Найти тег или описание" value=${filter}
          onInput=${(event) => setFilter(event.target.value)} data-autofocus-desktop data-testid="glossary-filter" />
      </label>
      <span class="glossary-total" data-testid="glossary-total">${formatNumber(state.ws.tags.length)} ${plural(state.ws.tags.length, 'тег', 'тега', 'тегов')}</span>
    </div>
    ${state.ws.tags.length === 0 ? html`<p class="group-empty">Тегов пока нет.</p>` : null}
    ${state.ws.tags.length > 0 && tags.length === 0 ? html`<p class="group-empty">Ничего не найдено.</p>` : null}
    <ul class="glossary-list">${tags.slice(0, 200).map((tag) => html`<${GlossaryRow} key=${tag.id} tag=${tag} />`)}</ul>
    ${tags.length > 200 ? html`<p class="group-empty">Показаны первые 200 тегов — уточните поиск.</p>` : null}
    <form class="glossary-add" onSubmit=${add}>
      <h3>Новый тег</h3>
      <div class="inline-form">
        <input type="text" class="input" placeholder="Название" value=${name} onInput=${(event) => { setName(event.target.value); setError(null); }}
          aria-label="Название нового тега" data-testid="add-tag-name" />
        <input type="text" class="input grow" placeholder="Описание (необязательно)" value=${description}
          onInput=${(event) => setDescription(event.target.value)} aria-label="Описание нового тега" data-testid="add-tag-description" />
        <button type="submit" class="button" disabled=${!name.trim()} data-testid="add-tag-save"><${Icon} name="plus" />Добавить</button>
      </div>
      ${error ? html`<p class="field-error" role="alert">${error}</p>` : null}
    </form>
  <//>`;
}

export function DeleteTagDialog({ tagId }) {
  const tag = state.index.tagById.get(tagId);
  if (!tag) return null;
  const used = state.index.usage.get(tagId) ?? 0;
  const remove = async () => {
    try {
      await runOp({ type: 'deleteTag', id: tagId });
      toast(`Тег «${tag.name}» удалён.`);
    } catch (failure) {
      toast(failure.message, 'error');
    }
  };
  return html`<${ConfirmDialog} title=${`Удалить тег «${tag.name}»?`} confirmLabel="Удалить тег" danger onConfirm=${remove}>
    <p data-testid="delete-tag-count">Элементов рабочей области с этим тегом: <strong>${formatNumber(used)}</strong>.</p>
    <p>${used === 0
      ? 'Тег будет удалён из набора тегов рабочей области.'
      : 'Тег будет удалён из набора тегов и из разметки этих элементов. Сами элементы и остальные их теги сохранятся.'}</p>
  <//>`;
}

// ---------- Настройки ----------

/** Числовая настройка: применяется сразу, если значение в допустимых границах. */
function NumberSetting({ label, name, range, testId }) {
  const [text, setText] = useState(String(state.settings[name]));
  const [min, max] = range;
  const apply = (value) => {
    setText(value);
    const number = Number(value);
    if (value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max) setSetting(name, number);
  };
  const invalid = String(state.settings[name]) !== text.trim();
  return html`<label class="number-row">
    <span class="switch-label">${label}</span>
    <input type="number" class=${cx('input number-input', invalid && 'is-invalid')} inputmode="numeric" min=${min} max=${max} step="1"
      value=${text} onInput=${(event) => apply(event.target.value)} onBlur=${() => setText(String(state.settings[name]))}
      aria-invalid=${invalid} title=${`От ${min} до ${max}`} data-testid=${testId} />
  </label>`;
}

export function SettingsDialog() {
  const settings = state.settings;
  return html`<${Modal} title="Настройки" size="small" testId="settings-dialog">
    <h3 class="settings-title">Показ элементов</h3>
    <${NumberSetting} label="Показывать, если элементов не больше" name="limit" range=${LIMIT_RANGE} testId="setting-limit" />
    <${NumberSetting} label="Элементов на странице" name="pageSize" range=${PAGE_SIZE_RANGE} testId="setting-page-size" />
    <h3 class="settings-title">Прочее</h3>
    <${Switch} checked=${settings.showOwnCounts} onChange=${(value) => setSetting('showOwnCounts', value)}
      label="Число собственных элементов в переходах" testId="setting-own-counts" />
    <${Switch} checked=${settings.remindOnContentChange} onChange=${(value) => setSetting('remindOnContentChange', value)}
      label="Напоминать о тегах при изменении содержания" testId="setting-reminder" />
    <${Switch} checked=${settings.showTimings} onChange=${(value) => setSetting('showTimings', value)}
      label="Время вычислений" testId="setting-timings" />
  <//>`;
}

// ---------- Рабочие области ----------

const PRESETS = [
  { value: 'empty', label: 'Пустая', hint: 'Без элементов и тегов.' },
  { value: 'demo', label: 'Демонстрационный набор', hint: 'Десять записей E0–E9 из проверочных сценариев.' },
  { value: 'demo-media', label: 'Демонстрационный набор с медиа', hint: 'Те же записи и четыре примера: изображение, аудио, видео, документ.' },
  { value: 'diagnostic', label: 'Диагностический набор', hint: '10 000 коротких текстов и 100 тегов для проверки на объёме.' },
];
const PRESET_NAMES = { empty: 'Моя Теготека', demo: 'Демонстрационный набор', 'demo-media': 'Демонстрация с медиа', diagnostic: 'Диагностика 10 000' };

export function CreateWorkspaceForm({ submitLabel = 'Создать и открыть' }) {
  const [preset, setPreset] = useState('demo');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const defaultName = () => {
    const base = PRESET_NAMES[preset];
    const taken = new Set(state.workspaces.map((w) => w.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name.trim() || defaultName(), preset);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  return html`<form class="workspace-form" onSubmit=${submit} data-testid="workspace-form">
    <fieldset class="preset-list">
      <legend class="field-label">Чем наполнить</legend>
      ${PRESETS.map((option) => html`<label key=${option.value} class=${cx('preset', preset === option.value && 'is-active')}>
        <input type="radio" name="preset" value=${option.value} checked=${preset === option.value}
          onChange=${() => setPreset(option.value)} data-testid=${`preset-${option.value}`} />
        <span><span class="preset-label">${option.label}</span><span class="preset-hint">${option.hint}</span></span>
      </label>`)}
    </fieldset>
    <label class="field">
      <span class="field-label">Название рабочей области</span>
      <input type="text" class="input" value=${name} maxlength="80" placeholder=${defaultName()}
        onInput=${(event) => setName(event.target.value)} data-testid="workspace-name" />
    </label>
    ${error ? html`<p class="field-error" role="alert">${error}</p>` : null}
    <button type="submit" class="button button-primary" disabled=${busy} data-testid="workspace-create">
      ${busy ? 'Создание…' : submitLabel}</button>
  </form>`;
}

function WorkspaceRow({ workspace }) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(workspace.name);
  const active = workspace.id === state.ws?.id;
  const guard = (action) => async (event) => {
    event?.preventDefault();
    try {
      await action();
    } catch (failure) {
      toast(failure.message, 'error');
    }
  };
  return html`<li class=${cx('workspace-row', active && 'is-active')} data-testid="workspace-row" data-name=${workspace.name}>
    <div class="workspace-main">
      ${renaming ? html`<form class="inline-form" onSubmit=${guard(async () => { await renameWorkspace(workspace.id, value); setRenaming(false); })}>
        <input type="text" class="input" value=${value} maxlength="80" onInput=${(event) => setValue(event.target.value)}
          aria-label="Название рабочей области" ref=${(el) => el?.focus()} />
        <button type="submit" class="button button-small button-primary">Сохранить</button>
        <button type="button" class="button button-small" onClick=${() => setRenaming(false)}>Отмена</button>
      </form>` : html`<span class="workspace-name">${workspace.name}</span>${active ? html`<span class="badge">открыта</span>` : null}`}
      <span class="workspace-meta">${countItems(workspace.items)} · ${formatNumber(workspace.tags)} ${plural(workspace.tags, 'тег', 'тега', 'тегов')}
        ${workspace.unmarked ? ` · неразмеченных: ${formatNumber(workspace.unmarked)}` : ''} · создана ${formatTime(workspace.createdAt)}</span>
    </div>
    <div class="glossary-actions">
      ${!active ? html`<button type="button" class="button button-small button-primary" data-testid="workspace-open"
        onClick=${guard(() => openWorkspace(workspace.id))}>Открыть</button>` : null}
      <button type="button" class="button button-small button-quiet" onClick=${() => { setValue(workspace.name); setRenaming(true); }}>Переименовать</button>
      <button type="button" class="button button-small button-quiet button-danger-quiet" data-testid="workspace-delete"
        onClick=${() => openDialog({ type: 'delete-workspace', workspace })}>Удалить</button>
    </div>
  </li>`;
}

export function WorkspacesDialog() {
  return html`<${Modal} title="Рабочие области" size="large" testId="workspaces-dialog">
    <ul class="workspace-list">${state.workspaces.map((workspace) => html`<${WorkspaceRow} key=${workspace.id} workspace=${workspace} />`)}</ul>
    <h3 class="section-title">Новая рабочая область</h3>
    <${CreateWorkspaceForm} />
  <//>`;
}

export function DeleteWorkspaceDialog({ workspace }) {
  const remove = async () => {
    try {
      await deleteWorkspace(workspace.id);
      toast(`Рабочая область «${workspace.name}» удалена.`);
    } catch (failure) {
      toast(failure.message, 'error');
    }
  };
  return html`<${ConfirmDialog} title="Удалить рабочую область?" confirmLabel="Удалить всё" danger onConfirm=${remove}>
    <p>Рабочая область «${workspace.name}» будет удалена вместе со всеми элементами (${formatNumber(workspace.items)}), тегами и файлами. Восстановить её нельзя.</p>
  <//>`;
}

export function Welcome() {
  return html`<main class="welcome" data-testid="welcome">
    <h1>Теготека</h1>
    <p class="welcome-lead">Создайте рабочую область.</p>
    <${CreateWorkspaceForm} submitLabel="Создать рабочую область" />
  </main>`;
}
