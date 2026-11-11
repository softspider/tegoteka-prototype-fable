// Виды содержания элемента и определение вида файла.

const MIME_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  zip: 'application/zip', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function guessMime(fileName) {
  const extension = String(fileName ?? '').toLowerCase().split('.').pop();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** 'image' | 'audio' | 'video' | 'other' — как показывать файл. */
export function mediaKind(mime) {
  const type = String(mime ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

/** Подпись вида содержания для интерфейса. */
export function contentLabel(content) {
  if (content.kind === 'empty') return 'Пустое содержание';
  if (content.kind === 'text') return 'Текст';
  return { image: 'Изображение', audio: 'Аудио', video: 'Видео', other: 'Файл' }[mediaKind(content.mime)];
}

/** Типы, которые безопасно открывать прямо во вкладке браузера. */
export function isInlineSafe(mime) {
  const type = String(mime ?? '').toLowerCase();
  if (type === 'image/svg+xml') return false;
  return (
    type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/') ||
    type === 'application/pdf' || type === 'text/plain' || type === 'text/csv'
  );
}
