// Показ содержания элемента: текст, изображение, аудио, видео, другой файл, пустое.
import { html, cx, useState, formatSize } from './lib.mjs';
import { state, openDialog } from './store.mjs';
import { Icon, Modal } from './components.mjs';
import { fileUrl } from './api.mjs';
import { mediaKind } from '/shared/content.mjs';

function FileRow({ content, url, downloadUrl, note }) {
  return html`<div class="file-row">
    <span class="file-icon"><${Icon} name="file" size=${20} /></span>
    <span class="file-meta">
      <span class="file-name">${content.name}</span>
      <span class="file-size">${formatSize(content.size)}${note ? ` · ${note}` : ''}</span>
    </span>
    ${url ? html`<a class="button button-small" href=${url} target="_blank" rel="noopener"><${Icon} name="external" size=${14} />Открыть</a>` : null}
    ${downloadUrl ? html`<a class="button button-small" href=${downloadUrl} download=${content.name}><${Icon} name="download" size=${14} />Скачать</a>` : null}
  </div>`;
}

/**
 * content — содержание элемента. localUrl — адрес ещё не сохранённого файла
 * (предпросмотр в редакторе). compact — уменьшенные изображения и видео в списках;
 * текст не обрезается никогда. eager — загружать изображения сразу: размеры
 * нужны для проверки вместимости экрана.
 */
export function ContentView({ content, localUrl, compact, eager }) {
  const [failed, setFailed] = useState(false);
  if (content.kind === 'empty') {
    return html`<p class="content-empty" data-content="empty">Пустое содержание</p>`;
  }
  if (content.kind === 'text') {
    return html`<p class="content-text" data-content="text">${content.text}</p>`;
  }
  const kind = mediaKind(content.mime);
  const url = localUrl ?? fileUrl(state.ws.id, content.fileId);
  const downloadUrl = localUrl ? null : fileUrl(state.ws.id, content.fileId, true);
  const unsupported = 'браузер не может показать этот формат';

  if (kind === 'image' && !failed) {
    return html`<div class="content-media" data-content="image">
      <button type="button" class="image-button" title="Открыть изображение целиком"
        onClick=${() => openDialog({ type: 'image', url, name: content.name })}>
        <img src=${url} alt=${content.name} loading=${eager ? 'eager' : 'lazy'} class=${cx('content-image', compact && 'is-compact')} onError=${() => setFailed(true)} />
      </button>
      <${FileRow} content=${content} downloadUrl=${downloadUrl} />
    </div>`;
  }
  if (kind === 'audio' && !failed) {
    return html`<div class="content-media" data-content="audio">
      <audio controls preload="metadata" src=${url} class="content-audio" onError=${() => setFailed(true)}></audio>
      <${FileRow} content=${content} downloadUrl=${downloadUrl} />
    </div>`;
  }
  if (kind === 'video' && !failed) {
    return html`<div class="content-media" data-content="video">
      <video controls preload="metadata" src=${url} class=${cx('content-video', compact && 'is-compact')} onError=${() => setFailed(true)}></video>
      <${FileRow} content=${content} downloadUrl=${downloadUrl} />
    </div>`;
  }
  return html`<div class="content-media" data-content="file">
    <${FileRow} content=${content} url=${localUrl ? null : url} downloadUrl=${downloadUrl} note=${failed ? unsupported : null} />
  </div>`;
}

export function ImageDialog({ url, name }) {
  return html`<${Modal} title=${name} size="wide" testId="image-dialog">
    <img src=${url} alt=${name} class="lightbox-image" />
  <//>`;
}
