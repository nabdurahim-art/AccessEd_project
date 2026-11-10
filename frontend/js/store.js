// Small wrapper around localStorage. Lesson packs and sync queue will use IndexedDB later.
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const del = (k) => { try { localStorage.removeItem(k); } catch {} };

export const getToken = () => get('token');
export const getUser = () => { try { return JSON.parse(get('user')); } catch { return null; } };
export const setUser = (u) => set('user', JSON.stringify(u));
export const setSession = (token, user) => { set('token', token); setUser(user); };
export const clearSession = () => { del('token'); del('user'); };
export const getLang = () => get('lang');
export const setLang = (l) => set('lang', l);

// Last progress summary seen online, kept per learner so a shared phone never mixes them up.
export const getSummary = (uid) => { try { return JSON.parse(get('summary:' + uid)); } catch { return null; } };
export const setSummary = (uid, s) => set('summary:' + uid, JSON.stringify(s));

// Colour mode ('auto', 'light' or 'dark') and profile pictures (one per learner, kept on this device only).
export const getLevel = () => get('level');
export const setLevel = (l) => set('level', l);
export const getTheme = () => get('theme');
export const setTheme = (m) => set('theme', m);
export const getAvatar = (uid) => get('avatar:' + uid);
export const setAvatar = (uid, dataUrl) => { try { localStorage.setItem('avatar:' + uid, dataUrl); return true; } catch { return false; } };
export const delAvatar = (uid) => del('avatar:' + uid);
