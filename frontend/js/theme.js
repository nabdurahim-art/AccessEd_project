// Light, dark or follow the phone/computer setting. The choice is remembered on this device.
import * as store from './store.js';

export const THEMES = ['auto', 'light', 'dark'];
export const getTheme = () => (THEMES.includes(store.getTheme()) ? store.getTheme() : 'auto');

const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyTheme(mode = getTheme()) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
  const isDark = mode === 'dark' || (mode === 'auto' && dark && dark.matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#0F1626' : '#1D4E89');
}

export function setTheme(mode) {
  store.setTheme(mode);
  applyTheme(mode);
}

// In "auto" mode, follow the system when it changes.
if (dark && dark.addEventListener) dark.addEventListener('change', () => applyTheme());
