// Обращения к локальному серверу прототипа.

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, url, body, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined || body instanceof Blob ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined || body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Нет связи с локальным сервером Теготеки. Проверьте, что он запущен.', 'offline', 0);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(data?.error?.message ?? `Ошибка сервера (${response.status}).`, data?.error?.code ?? 'error', response.status);
  }
  return data;
}

const base = (id) => `/api/workspaces/${encodeURIComponent(id)}`;

export const listWorkspaces = () => request('GET', '/api/workspaces');
export const createWorkspace = (name, preset) => request('POST', '/api/workspaces', { name, preset });
export const openWorkspace = (id) => request('GET', base(id));
export const renameWorkspace = (id, name) => request('PATCH', base(id), { name });
export const deleteWorkspace = (id) => request('DELETE', base(id));
export const applyOp = (id, op) => request('POST', `${base(id)}/ops`, op);
export const saveState = (id, state) => request('PUT', `${base(id)}/state`, state);
export const uploadFile = (id, file) =>
  request('POST', `${base(id)}/files`, file, {
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name),
  });
export const fileUrl = (id, fileId, download) => `${base(id)}/files/${fileId}${download ? '?download' : ''}`;
