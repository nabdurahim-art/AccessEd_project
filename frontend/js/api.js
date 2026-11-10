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
