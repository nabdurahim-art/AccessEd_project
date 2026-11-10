// Profile picture. It is shrunk to a small square and kept on this device only, per learner.
import * as store from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TINTS = ['var(--primary-soft)', 'var(--tint-green)', 'var(--tint-sun)'];
const SAFE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export function initials(u) {
  const parts = String(u.full_name || u.username || '?').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || '?';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return (first[0] + (last[0] || '')).toUpperCase();
}

export function avatarHTML(u, size = 44) {
  const saved = u && u.user_id != null ? store.getAvatar(u.user_id) : null;
  if (saved && SAFE.test(saved)) {
    return `<img class="avatar" style="--s:${size}px" src="${saved}" alt="">`;
  }
  const seed = [...String(u.username || u.full_name || '')].reduce((n, c) => n + c.charCodeAt(0), 0);
  return `<span class="avatar" style="--s:${size}px;background:${TINTS[seed % TINTS.length]}" aria-hidden="true">${esc(initials(u))}</span>`;
}

// Turns any picture into a centred 256 x 256 JPEG (about 15-30 KB) as a data URL.
export async function resizeToAvatar(file, size = 256) {
  if (!file || !/^image\//.test(file.type)) throw new Error('type');
  if (file.size > 15 * 1024 * 1024) throw new Error('big');
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('type')); };
      img.src = url;
    });
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, size, size);
  c.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}
