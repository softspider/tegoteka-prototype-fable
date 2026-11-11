// Создание, редактирование, перемещение и удаление элемента.
import { html, useState, useEffect, useMemo, formatSize } from './lib.mjs';
import { state, node, runOp, closeDialog, openDialog, announceSaved, setSetting, tagNames, toast } from './store.mjs';
import { Icon, Modal, ConfirmDialog, Segmented, NodeTags, Tag } from './components.mjs';
import { MarkupEditor } from './tag-input.mjs';
import { ContentView } from './content-view.mjs';
import * as api from './api.mjs';
import { parseTagInput } from '/shared/tags.mjs';

const TAG_INPUT_ID = 'editor-tag-input';

function sameNames(a, b) {
  return a.length === b.length && a.every((name) => b.includes(name));
}

/**
 * Диалог элемента.
 *   itemId не задан — создание; теги текущего узла предложены как начальная разметка.
 *   moveTo — перемещение: разметка заменена набором тегов указанного узла.
 */
export function ItemDialog({ itemId, moveTo }) {
  const item = useMemo(() => (itemId ? state.ws.items.find((candidate) => candidate.id === itemId) : null), [itemId]);
  const creating = !item;
  const current = node();
  const originalNames = item ? (item.tags === null ? null : tagNames(item.tags)) : undefined;
  const initialNames = moveTo ? tagNames(moveTo) : creating ? tagNames(current) : originalNames ?? [];

  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState(item ? item.content.kind : 'text');
  const [text, setText] = useState(item?.content.kind === 'text' ? item.content.text : '');
  const [file, setFile] = useState(null);
  const [names, setNames] = useState(initialNames);
  const [descriptions, setDescriptions] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reminder, setReminder] = useState(null);
  const [dontRemind, setDontRemind] = useState(false);
  const [guard, setGuard] = useState(false);

  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => localUrl && URL.revokeObjectURL(localUrl), [localUrl]);

  const keptFile = item?.content.kind === 'file' && !file ? item.content : null;
  const contentChanged = !creating && (
    kind !== item.content.kind ||
    (kind === 'text' && text.replace(/\r\n?/g, '\n') !== item.content.text) ||
    (kind === 'file' && Boolean(file))
  );
  const dirty = creating
    ? Boolean(title.trim() || text.trim() || file || !sameNames(names, tagNames(current)))
    : contentChanged || title.trim() !== (item.title ?? '') || !sameNames(names, originalNames ?? []) || (originalNames === null && names.length > 0);

  /** Теги, набранные в поле ввода, но ещё не подтверждённые. */
  const pendingNames = () => {
    const pending = parseTagInput(document.getElementById(TAG_INPUT_ID)?.value ?? '');
    return [...names, ...pending.filter((name) => !names.includes(name))];
  };

  const buildContent = async () => {
    if (kind === 'empty') return { kind: 'empty' };
    if (kind === 'text') return { kind: 'text', text };
    if (file) {
      const uploaded = await api.uploadFile(state.ws.id, file);
      return { kind: 'file', fileId: uploaded.fileId, name: uploaded.name, mime: uploaded.mime, size: uploaded.size };
    }
    if (keptFile) return keptFile;
    throw new Error('Выберите файл или другой вид содержания.');
  };

  const save = async ({ withMarkup, confirmed = false }) => {
    const finalNames = withMarkup ? pendingNames() : null;
    if (withMarkup) setNames(finalNames);
    if (kind === 'file' && !file && !keptFile) {
      setError('Выберите файл или другой вид содержания.');
      return;
    }
    if (contentChanged && state.settings.remindOnContentChange && !confirmed) {
      setReminder({ withMarkup, names: finalNames });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const content = await buildContent();
      const op = creating
        ? { type: 'createItem', title, content, tags: finalNames, tagDescriptions: descriptions }
        : { type: 'updateItem', id: item.id, title, content, tagDescriptions: descriptions, ...(withMarkup ? { tags: finalNames } : {}) };
      const result = await runOp(op);
      closeDialog();
      announceSaved(result.itemId, creating ? 'добавлен' : 'сохранён');
    } catch (failure) {
      setError(failure.message);
      setReminder(null);
      setSaving(false);
    }
  };

  const confirmReminder = () => {
    if (dontRemind) setSetting('remindOnContentChange', false);
    const { withMarkup } = reminder;
    setReminder(null);
    save({ withMarkup, confirmed: true });
  };

  const onFile = (event) => {
    const picked = event.target.files?.[0];
    if (picked) setFile(picked);
  };

  const heading = creating ? 'Новый элемент' : moveTo ? 'Перемещение элемента' : 'Изменение элемента';
  const unmarkedItem = !creating && item.tags === null;
  const canUseNode = !sameNames(names, tagNames(current));

  const canClose = () => {
    if (saving) return false;
    if (dirty) {
      setGuard(true);
      return false;
    }
    return true;
  };

  if (reminder) {
    return html`<${Modal} key="reminder" title="Проверьте теги" size="small" testId="content-reminder" onClose=${() => setReminder(null)} footer=${html`
      <button type="button" class="button" onClick=${() => setReminder(null)} data-testid="reminder-back">Вернуться к редактированию</button>
      <button type="button" class="button button-primary" onClick=${confirmReminder} data-autofocus data-testid="reminder-save">Сохранить</button>`}>
      <p>Содержание изменено. Теги должны соответствовать новому содержанию.</p>
      <div class="reminder-tags">
        ${reminder.names === null
          ? html`<span class="markup-none">разметка не задана</span>`
          : reminder.names.length === 0
            ? html`<span class="markup-none">пустой набор тегов</span>`
            : reminder.names.map((name) => html`<${Tag} key=${name} tag=${state.index.tagByName.get(name) ?? { name }} />`)}
      </div>
      <label class="check-row">
        <input type="checkbox" checked=${dontRemind} onChange=${(event) => setDontRemind(event.target.checked)} data-testid="reminder-disable" />
        Больше не напоминать (можно вернуть в настройках)
      </label>
    <//>`;
  }

  const previewContent = kind === 'file' && file
    ? { kind: 'file', name: file.name, mime: file.type || 'application/octet-stream', size: file.size, fileId: '' }
    : keptFile;

  return html`<${Modal} key="editor" title=${heading} size="large" testId="item-dialog" canClose=${canClose} footer=${html`
    ${!creating ? html`<button type="button" class="button button-danger-quiet foot-left" disabled=${saving}
      onClick=${() => { closeDialog(); openDialog({ type: 'delete-item', itemId: item.id }); }}
      data-testid="editor-delete"><${Icon} name="trash" />Удалить</button>` : null}
    <button type="button" class="button" onClick=${closeDialog} disabled=${saving} data-testid="editor-cancel">Отмена</button>
    ${creating || unmarkedItem ? html`<button type="button" class="button" disabled=${saving}
      onClick=${() => save({ withMarkup: false })} data-testid="editor-save-unmarked"
      title="Элемент попадёт в список неразмеченных">${creating ? 'Сохранить без разметки' : 'Сохранить, не размечая'}</button>` : null}
    <button type="button" class="button button-primary" disabled=${saving} onClick=${() => save({ withMarkup: true })} data-testid="editor-save">
      ${saving ? 'Сохранение…' : moveTo ? 'Переместить' : creating || unmarkedItem ? 'Сохранить с разметкой' : 'Сохранить'}</button>`}>

    ${moveTo ? html`<p class="dialog-lead" data-testid="move-lead">Разметка элемента будет заменена набором тегов узла:
      <${NodeTags} tagIds=${moveTo} />. Сверьте теги с содержанием; если они ему не соответствуют, отмените перемещение.</p>` : null}
    ${guard ? html`<p class="field-error" role="alert">Есть несохранённые изменения. Сохраните их или нажмите «Отмена».</p>` : null}

    <div class="editor-grid">
      <div class="editor-column">
        <label class="field">
          <span class="field-label">Название <span class="field-optional">необязательно</span></span>
          <input type="text" class="input" value=${title} maxlength="200" onInput=${(event) => setTitle(event.target.value)}
            data-autofocus=${creating || undefined} data-testid="editor-title" placeholder="Помогает узнать элемент в списке" />
        </label>

        <div class="field">
          <span class="field-label">Содержание</span>
          <${Segmented} label="Вид содержания" value=${kind} onChange=${setKind} testId="content-kind" options=${[
            { value: 'text', label: 'Текст' },
            { value: 'file', label: 'Файл' },
            { value: 'empty', label: 'Пусто' },
          ]} />
          ${kind === 'text' ? html`<textarea class="input textarea" rows="6" value=${text} onInput=${(event) => setText(event.target.value)}
            placeholder="Заметка, цитата, тост, стихи…" data-testid="editor-text"></textarea>` : null}
          ${kind === 'file' ? html`<div class="file-picker">
            ${previewContent ? html`<${ContentView} content=${previewContent} localUrl=${file ? localUrl : undefined} />` : null}
            <label class="button file-button">
              <${Icon} name="file" />${previewContent ? 'Заменить файл' : 'Выбрать файл'}
              <input type="file" class="visually-hidden" onChange=${onFile} data-testid="editor-file" />
            </label>
            <p class="field-hint">Изображение, аудио, видео или любой другой файл. ${file ? `Выбран: ${file.name}, ${formatSize(file.size)}.` : ''}</p>
          </div>` : null}
          ${kind === 'empty' ? html`<p class="field-hint">У элемента не будет содержания: о чём он, скажут название и теги.</p>` : null}
          ${contentChanged ? html`<p class="field-note" data-testid="content-changed-note">Содержание изменено: при сохранении запись будет заменена новым элементом.</p>` : null}
        </div>
      </div>

      <div class="editor-column">
        <div class="field">
          <label class="field-label" for=${TAG_INPUT_ID}>Теги</label>
          <${MarkupEditor} names=${names} onNames=${setNames} original=${originalNames} descriptions=${descriptions}
            onDescriptions=${setDescriptions} inputId=${TAG_INPUT_ID} autoFocus=${Boolean(moveTo)} />
          ${creating && sameNames(names, tagNames(current)) && current.length > 0
            ? html`<p class="field-hint">Предложены теги текущего узла. Их можно оставить, дополнить или изменить.</p>` : null}
          ${canUseNode ? html`<button type="button" class="link-button" onClick=${() => setNames(tagNames(current))} data-testid="use-node-tags">
            Заменить набором текущего узла: ${current.length ? tagNames(current).join(' ') : 'корень (пустой набор)'}</button>` : null}
        </div>
      </div>
    </div>
    ${error ? html`<p class="field-error" role="alert" data-testid="editor-error">${error}</p>` : null}
  <//>`;
}

export function DeleteItemDialog({ itemId }) {
  const item = state.ws.items.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const remove = async () => {
    try {
      await runOp({ type: 'deleteItem', id: itemId });
      toast('Элемент удалён из рабочей области.');
    } catch (failure) {
      toast(failure.message, 'error');
    }
  };
  return html`<${ConfirmDialog} title="Удалить элемент?" confirmLabel="Удалить элемент" danger onConfirm=${remove}>
    <p>Элемент «${item.title ?? 'Без названия'}» будет удалён из рабочей области. Восстановить его нельзя.</p>
    <div class="confirm-preview"><${ContentView} content=${item.content} compact /></div>
  <//>`;
}
