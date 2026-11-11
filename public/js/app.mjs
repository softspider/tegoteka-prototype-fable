// Точка входа: шапка, экран просмотра или разметки, диалоги.
import { html, render, cx, useEffect, formatNumber } from './lib.mjs';
import { state, useStore, init, openDialog, setScreen, goBack, goForward, canGoBack, canGoForward } from './store.mjs';
import { Icon, Toasts } from './components.mjs';
import { Browse } from './browse.mjs';
import { MarkupMode } from './markup.mjs';
import { ItemDialog, DeleteItemDialog } from './editor.mjs';
import { ImageDialog } from './content-view.mjs';
import {
  GlossaryDialog, DeleteTagDialog, SettingsDialog, WorkspacesDialog, DeleteWorkspaceDialog, Welcome,
} from './dialogs.mjs';

const DIALOGS = {
  item: ItemDialog,
  'delete-item': DeleteItemDialog,
  image: ImageDialog,
  glossary: GlossaryDialog,
  'delete-tag': DeleteTagDialog,
  settings: SettingsDialog,
  workspaces: WorkspacesDialog,
  'delete-workspace': DeleteWorkspaceDialog,
};

function Header() {
  const total = state.index.itemCount;
  const unmarked = state.index.unmarked.length;
  const share = total ? (total - unmarked) / total : 1;
  const inMarkup = state.screen === 'markup';
  return html`<header class="topbar">
    <a class="brand" href="#" onClick=${(event) => { event.preventDefault(); setScreen('browse'); }} title="К просмотру узла">Теготека</a>
    <button type="button" class="button button-quiet workspace-button" onClick=${() => openDialog({ type: 'workspaces' })}
      title="Рабочие области" data-testid="open-workspaces">
      <${Icon} name="layers" /><span class="workspace-current">${state.ws.name}</span><${Icon} name="chevron" size=${14} />
    </button>
    <span class="topbar-spacer"></span>
    <button type="button" class=${cx('button button-quiet', inMarkup && 'is-active')} data-testid="open-markup"
      onClick=${() => setScreen(inMarkup ? 'browse' : 'markup')}
      title=${`Режим разметки. Размечено ${total - unmarked} из ${total}`}>
      <span class="ring" style=${`--share:${share}`} aria-hidden="true"></span>
      Неразмеченные
      <span class=${cx('counter', unmarked > 0 && 'counter-accent')} data-testid="unmarked-count">${formatNumber(unmarked)}</span>
    </button>
    <button type="button" class="button button-quiet" onClick=${() => openDialog({ type: 'glossary' })} data-testid="open-glossary">
      <${Icon} name="book" />Глоссарий<span class="counter">${formatNumber(state.ws.tags.length)}</span></button>
    <button type="button" class="button button-quiet" onClick=${() => openDialog({ type: 'settings' })} data-testid="open-settings">
      <${Icon} name="settings" />Настройки</button>
  </header>`;
}

function App() {
  useStore();
  useEffect(() => {
    const onKeyDown = (event) => {
      if (state.phase !== 'ready' || state.dialogs.length || state.screen !== 'browse') return;
      if (event.altKey && event.key === 'ArrowLeft' && canGoBack()) {
        event.preventDefault();
        goBack();
      } else if (event.altKey && event.key === 'ArrowRight' && canGoForward()) {
        event.preventDefault();
        goForward();
      } else if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) {
        event.preventDefault();
        document.getElementById('nav-tag-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (state.phase === 'loading') return html`<p class="splash">Теготека загружается…</p>`;
  if (state.phase === 'failed') {
    return html`<main class="welcome"><h1>Теготека</h1>
      <p class="field-error" role="alert">Не удалось загрузить данные: ${state.failure}</p>
      <button type="button" class="button button-primary" onClick=${() => location.reload()}>Повторить</button></main>`;
  }
  if (state.phase === 'welcome') return html`<${Welcome} /><${Toasts} />`;

  return html`<div class="app" data-testid="app" data-workspace=${state.ws.id}>
    <${Header} />
    ${state.screen === 'markup' ? html`<${MarkupMode} key=${state.ws.id} />` : html`<${Browse} key=${state.ws.id} />`}
    ${state.dialogs.map((dialog, i) => {
      const Dialog = DIALOGS[dialog.type];
      return html`<${Dialog} key=${`${i}:${dialog.type}:${dialog.itemId ?? dialog.tagId ?? ''}`} ...${dialog} />`;
    })}
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
init();
