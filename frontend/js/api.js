import { API_URL } from './config.js';
import { getToken } from './store.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; } // status 0 = no connection
}

const authHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(auth ? authHeaders() : {}) };
  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    if (res.status === 401 && auth) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError((data && data.error) || 'REQUEST_FAILED', res.status);
  }
  return data;
}

/* auth */
export const register = ({ username, password, full_name, email, phone_number }) => {
  const body = { username, password, full_name: full_name || username };
  if (email) body.email = email;
  if (phone_number) body.phone_number = phone_number;
  return request('/auth/register', { method: 'POST', body, auth: false });
};
export const login = (identifier, password) =>
  request('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
export const resetPassword = (identifier, code, new_password) =>
  request('/auth/reset-password', { method: 'POST', body: { identifier, code, new_password }, auth: false });
export const createResetCode = (identifier) =>
  request('/auth/reset-code', { method: 'POST', body: { identifier } });
export const getMe = () => request('/auth/me');
export const getSummary = () => request('/progress/summary');

/* content */
export const getCourses = () => request('/content/courses');
export const getPacks = (courseId) => request(`/content/courses/${courseId}/packs`);
export const confirmDownload = (packId, body) =>
  request(`/content/packs/${packId}/confirm`, { method: 'POST', body });

// Returns the raw Response so the caller can read the body in chunks and show progress.
export async function fetchPack(packId) {
  let res;
  try {
    res = await fetch(`${API_URL}/content/packs/${packId}/download`, { headers: authHeaders() });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('session-expired'));
    let message = 'REQUEST_FAILED';
    try { message = (await res.json()).error || message; } catch {}
    throw new ApiError(message, res.status);
  }
  return res;
}

/* sync */
export const syncBatch = (body) => request('/sync', { method: 'POST', body });

/* admin: publish content (admin accounts only) */
export const getPublished = () => request('/content/admin/published');

// The body is the zip file itself, so the browser sends it in one piece.
export async function uploadPack(file) {
  let res;
  try {
    res = await fetch(`${API_URL}/content/admin/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/zip', ...authHeaders() }, body: file,
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('session-expired'));
    const err = new ApiError((data && data.error) || 'REQUEST_FAILED', res.status);
    err.details = (data && data.details) || [];
    throw err;
  }
  return data;
}

/* admin: lesson editor */
async function adminFetch(path, { method = 'GET', json, raw, type } = {}) {
  const headers = { ...authHeaders() };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (raw !== undefined) { headers['Content-Type'] = type; body = raw; }
  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('session-expired'));
    const err = new ApiError((data && data.error) || 'REQUEST_FAILED', res.status);
    err.details = (data && data.details) || [];
    throw err;
  }
  return data;
}
export const getPackSource = (packId) => adminFetch(`/content/admin/packs/${packId}/source`);
export const saveLessons = (spec) => adminFetch('/content/admin/lessons', { method: 'POST', json: spec });
export const deleteLesson = (packId, key) => adminFetch(`/content/admin/packs/${packId}/lessons/${encodeURIComponent(key)}`, { method: 'DELETE' });
export const uploadAudio = (file) => adminFetch('/content/admin/audio', { method: 'POST', raw: file, type: 'audio/mpeg' });
