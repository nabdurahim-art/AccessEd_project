import { strings, LANGUAGES } from './strings.js';
import { MIN_PASSWORD, MAX_PASSWORD } from './config.js';
import * as api from './api.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { createLearnScreens } from './learn.js';
import * as packs from './packs.js';
import { applyTheme, setTheme, getTheme, THEMES } from './theme.js';
import { avatarHTML, resizeToAvatar } from './avatar.js';
import { createAdminScreen } from './admin.js';
import { createEditorScreens } from './editor.js';

applyTheme();

// Ask the browser to keep downloaded lessons even when the phone is low on space.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// "Install" help. Chrome on Android gives us an install event (caught early in index.html).
// iPhone and iPad never do, so we show the steps instead. Same for browsers that stay silent.
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = navigator.userAgent || '';
const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)|WhatsApp|Snapchat|TikTok/i.test(ua); // in-app browsers cannot install
const installEvent = () => window.__installEvent || null;
const REDRAW_FOR_INSTALL = ['profile', 'welcome', 'auth', ''];
const redrawInstall = () => { if (REDRAW_FOR_INSTALL.includes(currentName())) route(); };
window.addEventListener('install-ready', redrawInstall);
window.addEventListener('appinstalled', () => { window.__installEvent = null; redrawInstall(); });

const $app = document.getElementById('app');
const $banner = document.getElementById('banner');
const $tabbar = document.getElementById('tabbar');
const LEARNER_TABS = ['home', 'courses', 'progress', 'profile'];
const ADMIN_TABS = ['content', 'admin', 'profile']; // Lessons, Upload zip, Account
const LEARNER_ONLY = ['home', 'courses', 'progress', 'course', 'pack', 'lesson', 'quiz'];
const isAdmin = () => (store.getUser() || {}).role === 'admin';
const adminMode = () => isAdmin() && store.getView() !== 'learner'; // false for learners, and for an admin viewing as a learner
const tabsNow = () => (adminMode() ? ADMIN_TABS : LEARNER_TABS);
const homeFor = () => (adminMode() ? 'content' : 'home');
const USERNAME_RULE = /^[A-Za-z0-9_]{3,30}$/; // same rule as the backend

let lang = store.getLang() || 'en';
const t = (key, vars = {}) => {
  if (key === 'days' && Number(vars.n) === 1) key = 'day'; // 1 day, not 1 days
  const text = (strings[lang] && strings[lang][key]) || strings.en[key] || key;
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
};
// Always escape anything a user typed or a pack contains before putting it in HTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  courses: '<path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>',
  progress: '<path d="M5 20v-6M12 20V6M19 20v-10"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  cross: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const icon = (name, size = 24) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---------- status banner ---------- */
let pending = 0; // progress and quiz results saved on this phone but not sent yet

function renderBanner() {
  const online = navigator.onLine;
  const signedIn = Boolean(store.getToken());
  let cls = 'banner--on';
  let title;
  let body = '';
  if (!online) { cls = 'banner--off'; title = t('offlineTitle'); body = t('offlineBody'); }
  else if (signedIn && pending === 0) { title = t('syncedTitle'); }
  else if (signedIn) { title = t('syncingTitle'); }
  else { title = t('connectedTitle'); body = t('connectedBody'); }
  $banner.className = 'banner ' + cls;
  $banner.innerHTML = `<strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}`;
}

async function updatePending() {
  const u = store.getUser();
  pending = u && store.getToken() ? await sync.pendingCount(u.user_id) : 0;
  renderBanner();
}

// Called after saving progress or a quiz result: update the banner, then send if online.
async function afterSave() {
  await updatePending();
  const u = store.getUser();
  if (!u) return null;
  const rewards = await sync.syncNow(u.user_id);
  await updatePending();
  if (rewards && (rewards.points_earned > 0 || rewards.new_badges.length)) refreshUser();
  if (rewards && navigator.onLine) api.getSummary().then((s) => store.setSummary(u.user_id, s)).catch(() => {});
  return rewards;
}

window.addEventListener('offline', renderBanner);
window.addEventListener('online', () => { renderBanner(); afterSave(); refreshUser(); });

/* ---------- tab bar ---------- */
function renderTabs(current) {
  const tabs = tabsNow();
  const show = tabs.includes(current);
  $tabbar.hidden = !show; // phones hide the menu inside a lesson; desktop keeps it (see CSS)
  const names = { home: 'tabHome', courses: 'tabCourses', progress: 'tabProgress', profile: adminMode() ? 'tabAccount' : 'tabProfile', admin: 'tabPublish', content: 'tabContent' };
  const icons = { admin: 'upload', content: 'pencil' };
  $tabbar.innerHTML = tabs.map((tab) =>
    `<a class="tab" href="#/${tab}" ${show && tab === current ? 'aria-current="page"' : ''}>${icon(icons[tab] || tab)}<span>${esc(t(names[tab]))}</span></a>`
  ).join('');
}

/* ---------- router ---------- */
const nav = { id: 0 }; // changes on every screen, so slow loads never draw on the wrong screen
const go = (path) => { location.hash = path === 'welcome' ? '#/' : '#/' + path; };
const parts = () => (location.hash || '#/').slice(2).split('/');
const currentName = () => parts()[0] || 'welcome';

function route() {
  const [first, ...args] = parts();
  const name = first || 'welcome';
  const signedIn = Boolean(store.getToken());
  const tab = tabsNow().includes(name);
  const inside = tab || LEARNER_ONLY.includes(name) || ['admin', 'content', 'edit', 'profile'].includes(name);
  if (!signedIn && inside) return go('welcome');
  if (signedIn && (name === 'welcome' || name === 'auth' || name === 'forgot')) return go(homeFor());
  if (signedIn && adminMode() && LEARNER_ONLY.includes(name)) return go('content'); // admins see the admin screens
  if (signedIn && !isAdmin() && ['admin', 'content', 'edit'].includes(name)) return go('home');

  document.getElementById('shell').dataset.auth = signedIn ? 'in' : 'out';
  nav.id++;
  learn.stopAudio();
  renderBanner();
  renderTabs(tab ? name : name === 'course' || name === 'pack' ? 'courses' : '');
  $app.scrollTop = 0;
  (Object.hasOwn(screens, name) && typeof screens[name] === 'function' ? screens[name] : screens.welcome)(args);
}
window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => { store.clearSession(); pending = 0; go('welcome'); route(); });

/* ---------- screens ---------- */
// The install box: a button when the browser allows it, otherwise the steps to follow.
function installHTML() {
  if (isInstalled()) return '';
  let body;
  if (installEvent() && !isInApp) {
    return `<div class="note">${icon('shield', 22)}<span>${esc(t('installHint'))}</span></div>
      <div class="photo-actions"><button class="btn btn--primary" id="install-btn">${esc(t('installApp'))}</button></div>`;
  }
  if (isInApp) body = t('installInApp');
  else if (isIos) body = t('installIos');
  else body = t('installMenu');
  return `<div class="note">${icon('shield', 22)}<span><b>${esc(t('installHow'))}</b><br>${esc(body)}</span></div>`;
}
function bindInstall() {
  const btn = $app.querySelector('#install-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ev = installEvent(); window.__installEvent = null;
    if (ev) { ev.prompt(); await ev.userChoice.catch(() => {}); }
    route();
  });
}

const form = { notice: '', mode: 'register', name: '', username: '', password: '', contact: '', submitted: false, busy: false, error: '' };

const learn = createLearnScreens({ $app, t, esc, icon, go, nav, store, lang: () => lang, afterSave, reroute: () => route() });

const adminScreens = createAdminScreen({ $app, t, esc, icon, nav, store });
const editorScreens = createEditorScreens({ $app, t, esc, icon, nav, store });

const screens = {
  ...learn,
  ...adminScreens,
  ...editorScreens,
  stopAudio: undefined, // helper, not a screen

  welcome() {
    $app.innerHTML = `
      <div class="center">
        <div class="brand">${icon('courses', 30)} AccessEd</div>
        <div class="hero">${icon('courses', 64)}</div>
        <h1 class="tagline">${esc(t('tagline'))}</h1>
        <p class="subtitle">${esc(t('subtitle'))}</p>
        <p class="label">${esc(t('chooseLanguage'))}</p>
        <div class="stack">
          ${LANGUAGES.map((l) => `<button class="btn ${l.code === lang ? 'btn--primary' : 'btn--outline'}" data-lang="${l.code}">${l.label}</button>`).join('')}
        </div>
        <div class="stack" style="margin-top:18px">${installHTML()}</div>
      </div>`;
    bindInstall();
    $app.querySelectorAll('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => { setLanguage(b.dataset.lang); go('auth'); }));
  },

  auth() {
    const reg = form.mode === 'register';
    const username = form.username.trim();
    const userErr = !form.submitted ? ''
      : !username ? t('usernameError')
        : reg && !USERNAME_RULE.test(username) ? t('usernameRule') : '';
    const nameErr = reg && form.submitted && !form.name.trim() ? t('fullNameError') : '';
    const pwErr = form.submitted && (form.password.length < MIN_PASSWORD || form.password.length > MAX_PASSWORD)
      ? t('passwordError', { min: MIN_PASSWORD }) : '';

    $app.innerHTML = `
      <h1>${esc(t('learningStarts'))}</h1>
      <div class="segment" role="tablist">
        ${['register', 'login'].map((m) => `<button role="tab" aria-selected="${form.mode === m}" data-mode="${m}">${esc(t(m))}</button>`).join('')}
      </div>
      ${reg ? `<div class="field ${nameErr ? 'has-error' : ''}">
        <label for="fullname">${esc(t('fullName'))}</label>
        <input id="fullname" value="${esc(form.name)}" placeholder="${esc(t('fullNameHint'))}" autocomplete="name" maxlength="100">
        ${nameErr ? `<div class="msg">${esc(nameErr)}</div>` : ''}
      </div>` : ''}
      <div class="field ${userErr ? 'has-error' : ''}">
        <label for="username">${esc(t('username'))}</label>
        <input id="username" value="${esc(form.username)}" placeholder="${esc(t('usernamePlaceholder'))}" autocomplete="username" autocapitalize="none" autocorrect="off">
        ${userErr ? `<div class="msg">${esc(userErr)}</div>` : ''}
      </div>
      <div class="field ${pwErr ? 'has-error' : ''}">
        <label for="password">${esc(t('password'))}</label>
        <div class="pw">
          <input id="password" type="password" value="${esc(form.password)}" autocomplete="${reg ? 'new-password' : 'current-password'}">
          <button type="button" class="pw-toggle" id="pw-toggle" aria-label="${esc(t('showPassword'))}" aria-pressed="false">${icon('eye', 22)}</button>
        </div>
        ${pwErr ? `<div class="msg">${esc(pwErr)}</div>` : ''}
      </div>
      ${reg ? `
        <div class="field">
          <label for="contact">${esc(t('contactLabel'))}</label>
          <input id="contact" value="${esc(form.contact)}" placeholder="${esc(t('contactHint'))}" inputmode="email" autocapitalize="none">
        </div>
        <div class="note">${icon('shield', 22)}<span>${esc(t('sharedPhone'))}</span></div>` : ''}
      ${form.notice ? `<p class="form-ok" role="status">${esc(form.notice)}</p>` : ''}
      ${form.error ? `<p class="form-error" role="alert">${esc(form.error)}</p>` : ''}
      ${reg ? '' : `<p class="forgot"><a href="#/forgot" id="forgot-link">${esc(t('forgotLink'))}</a></p>`}
      <button class="btn btn--primary" id="submit" ${form.busy ? 'disabled' : ''}>${esc(reg ? t('registerFree') : t('login'))}</button>
      <p class="footer-note">${esc(t('logoutHint'))}</p>
      <div class="stack" style="margin-top:14px">${installHTML()}</div>`;
    bindInstall();

    $app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      form.mode = b.dataset.mode; form.error = ''; form.submitted = false; screens.auth();
    }));
    const fullname = $app.querySelector('#fullname');
    if (fullname) fullname.addEventListener('input', (e) => { form.name = e.target.value; });
    $app.querySelector('#username').addEventListener('input', (e) => { form.username = e.target.value; });
    $app.querySelector('#password').addEventListener('input', (e) => { form.password = e.target.value; });
    const pwToggle = $app.querySelector('#pw-toggle');
    pwToggle.addEventListener('click', () => {
      const input = $app.querySelector('#password');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      pwToggle.innerHTML = icon(show ? 'eyeOff' : 'eye', 22);
      pwToggle.setAttribute('aria-label', t(show ? 'hidePassword' : 'showPassword'));
      pwToggle.setAttribute('aria-pressed', String(show));
      input.focus();
    });
    const contact = $app.querySelector('#contact');
    if (contact) contact.addEventListener('input', (e) => { form.contact = e.target.value; });
    $app.querySelector('#submit').addEventListener('click', submitAuth);
  },

  forgot() {
    const f = forgotForm;
    $app.innerHTML = `
      <a class="back" href="#/auth" id="back-login">${icon('back', 20)} ${esc(t('backToLogin'))}</a>
      <h1>${esc(t('forgotTitle'))}</h1>
      <p class="muted">${esc(t('forgotIntro'))}</p>
      <div class="field"><label for="f-who">${esc(t('resetWho'))}</label>
        <input id="f-who" value="${esc(f.who)}" autocomplete="username" autocapitalize="none" autocorrect="off"></div>
      <div class="field"><label for="f-code">${esc(t('resetCode'))}</label>
        <input id="f-code" value="${esc(f.code)}" placeholder="${esc(t('resetCodeHint'))}" autocapitalize="characters" autocorrect="off" spellcheck="false"></div>
      <div class="field ${f.pwErr ? 'has-error' : ''}"><label for="f-pw">${esc(t('newPassword'))}</label>
        <input id="f-pw" type="password" value="${esc(f.pw)}" autocomplete="new-password">
        ${f.pwErr ? `<div class="msg">${esc(t('passwordError', { min: MIN_PASSWORD }))}</div>` : ''}</div>
      ${f.error ? `<p class="form-error" role="alert">${esc(f.error)}</p>` : ''}
      <button class="btn btn--primary" id="f-submit" ${f.busy ? 'disabled' : ''}>${esc(t('resetSubmit'))}</button>`;
    $app.querySelector('#f-who').addEventListener('input', (e) => { f.who = e.target.value; });
    $app.querySelector('#f-code').addEventListener('input', (e) => { f.code = e.target.value; });
    $app.querySelector('#f-pw').addEventListener('input', (e) => { f.pw = e.target.value; });
    $app.querySelector('#f-submit').addEventListener('click', submitReset);
  },

  async progress() {
    const id = nav.id;
    const u = store.getUser() || {};
    const bar = (p) => `<div class="bar"><i style="width:${p}%"></i></div>`;
    const draw = async (sum, note) => {
      const next = sum && sum.next_lesson;
      const have = next ? await packs.localPack(next.pack_id) : null;
      if (id !== nav.id) return;
      const points = sum ? sum.points : u.points ?? 0;
      const streak = sum ? sum.streak_days : u.streak_days ?? 0;
      $app.innerHTML = `
        <h1>${esc(t('tabProgress'))}</h1>
        <div class="tiles">
          <div class="tile" style="background:var(--tint-sun)"><b>${points}</b>${esc(t('points'))}</div>
          <div class="tile" style="background:var(--primary-soft)"><b>${esc(t('days', { n: streak }))}</b>${esc(t('streak'))}</div>
        </div>
        ${sum ? `
          <p class="sum-line"><b>${esc(t('lessonsDone', { c: sum.overall.modules_completed, n: sum.overall.modules_total }))}</b> · ${sum.overall.percent}%</p>
          ${bar(sum.overall.percent)}
          ${sum.courses.map((c) => `<div class="sum-course"><span>${esc(c.title)}</span><b>${c.percent}%</b></div>${bar(c.percent)}`).join('')}
          ${next ? `<h2>${esc(t('upNext'))}</h2>${have
            ? `<a class="pack pack-row" href="#/lesson/${next.pack_id}/${encodeURIComponent(next.module_key)}"><span class="pack-title"><b>${esc(next.title)}</b></span>${icon('chevron', 18)}</a>`
            : `<div class="pack"><b>${esc(next.title)}</b></div>`}` : ''}
          <h2>${esc(t('badges'))}</h2>
          ${sum.badges.length ? `<div class="chips">${sum.badges.map((b) => `<span class="chip">${esc(b.name)}</span>`).join('')}</div>`
            : `<p class="muted">${esc(t('noBadges'))}</p>`}
          ${note ? `<p class="small muted">${esc(note)}</p>` : ''}` : `<p class="muted">${esc(t('noProgress'))}</p>`}`;
    };

    const saved = store.getSummary(u.user_id);
    await draw(saved, navigator.onLine ? '' : t('summaryOffline'));
    if (!navigator.onLine) return;
    try {
      const fresh = await api.getSummary();
      store.setSummary(u.user_id, fresh);
      await draw(fresh, '');
    } catch { if (saved) await draw(saved, t('summaryOffline')); }
  },

  profile() {
    const u = store.getUser() || {};
    const hasPhoto = !!store.getAvatar(u.user_id);
    const theme = getTheme();
    const themeNames = { auto: 'themeAuto', light: 'themeLight', dark: 'themeDark' };
    $app.innerHTML = `
      <div class="profile-head">
        ${avatarHTML(u, 88)}
        <div><h1>${esc(u.full_name || u.username || '')}</h1><p class="muted">@${esc(u.username || '')}</p></div>
      </div>
      <p class="role-chip role-chip--${u.role === 'admin' ? 'admin' : 'learner'}">${esc(t('loggedInAs', { role: t(u.role === 'admin' ? 'roleAdmin' : 'roleLearner') }))} · @${esc(u.username || '')}</p>
      ${isAdmin() ? `<button class="btn ${adminMode() ? 'btn--outline' : 'btn--primary'} admin-cta" id="view-swap">${esc(t(adminMode() ? 'viewAsLearner' : 'backToAdmin'))}</button>` : ''}
      <div class="photo-actions">
        <button class="btn btn--outline" id="photo-btn">${esc(t(hasPhoto ? 'changePhoto' : 'addPhoto'))}</button>
        ${hasPhoto ? `<button class="btn btn--outline" id="photo-remove">${esc(t('removePhoto'))}</button>` : ''}
        <input type="file" id="photo-input" accept="image/*" hidden>
      </div>
      <p class="small muted">${esc(t('photoHint'))}</p>
      <p class="form-error" id="photo-msg" role="alert" hidden></p>
      ${installHTML()}
      ${adminMode() ? resetToolHTML() : ''}
      <h2>${esc(t('appearance'))}</h2>
      <div class="segment" role="group" aria-label="${esc(t('appearance'))}">
        ${THEMES.map((m) => `<button data-theme-pick="${m}" aria-pressed="${m === theme}">${esc(t(themeNames[m]))}</button>`).join('')}
      </div>
      <h2>${esc(t('language'))}</h2>
      <div class="stack">
        ${LANGUAGES.map((l) => `<button class="btn ${l.code === lang ? 'btn--primary' : 'btn--outline'}" data-lang="${l.code}">${l.label}</button>`).join('')}
      </div>
      <div style="margin-top:20px"><button class="btn btn--outline" id="logout">${esc(t('logout'))}</button></div>`;
    $app.querySelectorAll('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => { setLanguage(b.dataset.lang); route(); }));
    $app.querySelectorAll('[data-theme-pick]').forEach((b) =>
      b.addEventListener('click', () => { setTheme(b.dataset.themePick); screens.profile(); }));

    bindInstall();
    if (adminMode()) bindResetTool();

    const input = $app.querySelector('#photo-input');
    const msg = $app.querySelector('#photo-msg');
    const fail = (key) => { msg.textContent = t(key); msg.hidden = false; };
    $app.querySelector('#photo-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      msg.hidden = true;
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const data = await resizeToAvatar(file);
        if (!store.setAvatar(u.user_id, data)) return fail('photoSaveError');
        screens.profile();
      } catch (e) {
        fail(e && e.message === 'big' ? 'photoBigError' : 'photoTypeError');
      }
    });
    const rm = $app.querySelector('#photo-remove');
    if (rm) rm.addEventListener('click', () => { store.delAvatar(u.user_id); screens.profile(); });

    // Lessons stay on the phone after log out, so the next learner can use them.
    $app.querySelector('#logout').addEventListener('click', () => { store.clearSession(); store.setView('admin'); pending = 0; go('welcome'); });
    const swap = $app.querySelector('#view-swap');
    if (swap) swap.addEventListener('click', () => { store.setView(adminMode() ? 'learner' : 'admin'); go(adminMode() ? 'content' : 'home'); });
  },
};

const forgotForm = { who: '', code: '', pw: '', pwErr: false, busy: false, error: '' };

async function submitReset() {
  const f = forgotForm;
  f.error = ''; f.pwErr = false;
  if (!f.who.trim() || !f.code.trim() || !f.pw) { f.error = t('resetNeed'); return screens.forgot(); }
  if (f.pw.length < MIN_PASSWORD || f.pw.length > MAX_PASSWORD) { f.pwErr = true; return screens.forgot(); }
  f.busy = true; screens.forgot();
  try {
    await api.resetPassword(f.who.trim(), f.code.trim(), f.pw);
    form.mode = 'login'; form.username = f.who.trim(); form.password = ''; form.error = ''; form.submitted = false;
    form.notice = t('resetDone');
    f.who = f.code = f.pw = ''; f.busy = false;
    go('auth');
  } catch (e) {
    f.busy = false;
    if (!(e instanceof api.ApiError)) f.error = t('errGeneric');
    else if (e.status === 0) f.error = t('errNetwork');
    else if (e.status === 400 || e.status === 429) f.error = e.message;
    else f.error = t('errGeneric');
    screens.forgot();
  }
}

// Admin tool on the Account screen: make a one-time code for a learner who forgot the password.
function resetToolHTML() {
  return `<h2>${esc(t('adminResetTitle'))}</h2>
    <p class="small muted">${esc(t('adminResetHint'))}</p>
    <div class="field"><input id="rc-who" aria-label="${esc(t('resetWho'))}" placeholder="${esc(t('resetWho'))}" autocapitalize="none" autocorrect="off"></div>
    <button class="btn btn--outline" id="rc-make">${esc(t('makeCode'))}</button>
    <div id="rc-out" aria-live="polite"></div>`;
}
function bindResetTool() {
  const who = $app.querySelector('#rc-who'), out = $app.querySelector('#rc-out'), btn = $app.querySelector('#rc-make');
  btn.addEventListener('click', async () => {
    if (!who.value.trim()) return;
    btn.disabled = true; out.innerHTML = '';
    try {
      const r = await api.createResetCode(who.value.trim());
      out.innerHTML = `<div class="note"><span><b>${esc(t('codeFor', { name: r.username }))}</b><br><span class="reset-code">${esc(r.code)}</span><br>${esc(t('codeNote'))}</span></div>`;
    } catch (e) {
      const msg = !(e instanceof api.ApiError) ? t('errGeneric') : e.status === 0 ? t('errNetwork') : e.status === 403 ? t('adminOnly') : e.message;
      out.innerHTML = `<p class="form-error" role="alert">${esc(msg)}</p>`;
    } finally { btn.disabled = false; }
  });
}

/* ---------- actions ---------- */
function setLanguage(code) {
  lang = code;
  store.setLang(code);
  document.documentElement.lang = code;
}

// "a@b.com" is an email, anything else is a phone number
const splitContact = (v) => {
  const c = v.trim();
  if (!c) return {};
  return c.includes('@') ? { email: c.toLowerCase() } : { phone_number: c };
};

async function submitAuth() {
  form.submitted = true;
  form.error = '';
  const username = form.username.trim();
  const bad = !username || (form.mode === 'register' && (!USERNAME_RULE.test(username) || !form.name.trim()))
    || form.password.length < MIN_PASSWORD || form.password.length > MAX_PASSWORD;
  if (bad) return screens.auth();

  form.busy = true;
  screens.auth();
  try {
    if (form.mode === 'register') await api.register({ username, password: form.password, full_name: form.name.trim(), ...splitContact(form.contact) });
    const res = await api.login(username, form.password);
    store.setSession(res.token, res.user);
    form.password = '';
    form.busy = false;
    refreshUser();
    afterSave();
    go(homeFor());
  } catch (e) {
    form.busy = false;
    if (!(e instanceof api.ApiError)) form.error = t('errGeneric');
    else if (e.status === 0) form.error = t('errNetwork');
    else if (e.status === 401) form.error = t('errCredentials');
    else if (e.status === 409) form.error = t('errExists');
    else if (e.status === 400 || e.status === 429) form.error = e.message; // the server's message is specific
    else form.error = t('errGeneric');
    screens.auth();
  }
}

// Fill in points, streak and full name. If offline, keep the saved copy.
async function refreshUser() {
  if (!store.getToken() || !navigator.onLine) return;
  try {
    const { user } = await api.getMe();
    store.setUser(user);
    if (['home', 'progress', 'profile'].includes(currentName())) route();
  } catch {}
}

/* ---------- start ---------- */
document.documentElement.lang = lang;
route();
refreshUser();
updatePending().then(() => afterSave());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {}); // needs HTTPS or localhost
}
