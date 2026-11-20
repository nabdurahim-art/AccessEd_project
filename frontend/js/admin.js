// "Publish content" screen, for admin accounts only.
//
// The admin picks one or more lesson-pack zips (made with tools/build_packs.py).
// Each zip carries its own course details, so the server does the rest. The
// server also checks that the account is an admin: hiding this screen from other
// accounts is only for convenience, it is not the security.

import * as api from './api.js';

const MAX_BYTES = 15 * 1024 * 1024; // the server's default limit (UPLOAD_MAX_MB)

export function createAdminScreen({ $app, t, esc, icon, nav, store }) {
  let items = [];       // { file, state: 'waiting' | 'busy' | 'ok' | 'fail', text, lines: [] }
  let running = false;

  const levelName = (l) => t(l === 'primary' ? 'levelPrimary' : 'levelSecondary');
  const alive = (id) => nav.id === id;

  function failText(e) {
    if (!(e instanceof api.ApiError)) return t('errGeneric');
    if (e.status === 0) return t('errNetwork');
    if (e.status === 403) return t('adminOnly');
    if (e.status === 413) return t('tooBig');
    return e.message;
  }

  function itemHTML(it) {
    const ok = it.state === 'ok';
    const bad = it.state === 'fail';
    const status = it.state === 'waiting' ? t('waiting') : it.state === 'busy' ? t('publishing') : it.text;
    const lines = (it.lines || []).slice(0, 6).map((l) => `<li>${esc(l)}</li>`).join('');
    return `<div class="pack${bad ? ' is-fail' : ''}">
      <div class="pack-row">
        <div class="pack-title"><b>${esc(it.file.name)}</b><small>${esc(status)}</small></div>
        ${ok ? `<span class="ready">${icon('check', 20)}</span>` : bad ? `<span class="fail-mark">${icon('cross', 20)}</span>` : ''}
      </div>
      ${lines ? `<ul class="fail-list">${lines}</ul>` : ''}
    </div>`;
  }

  function drawQueue() {
    const box = $app.querySelector('#queue');
    const btn = $app.querySelector('#publish-btn');
    if (!box || !btn) return;
    box.innerHTML = items.map(itemHTML).join('');
    const waiting = items.some((i) => i.state === 'waiting');
    btn.disabled = running || !waiting || !navigator.onLine;
    btn.textContent = running ? t('publishing') : t('publishNow');
  }

  // The Content screen: everything that is published, grouped by level.
  async function drawPublished(id) {
    const box = $app.querySelector('#published');
    if (!box) return;
    if (!navigator.onLine) { box.innerHTML = `<p class="muted">${esc(t('needOnline'))}</p>`; return; }
    try {
      const { courses } = await api.getPublished();
      if (!alive(id)) return;
      const withPacks = courses.filter((c) => c.packs.length > 0);
      if (!withPacks.length) { box.innerHTML = `<p class="muted">${esc(t('noContentYet'))}</p>`; return; }
      const packs = withPacks.reduce((n, c) => n + c.packs.length, 0);
      const group = (level) => {
        const list = withPacks.filter((c) => c.level === level);
        return list.length ? `<h2>${esc(levelName(level))}</h2>` + list.map((c) => `
          <div class="pack">
            <b>${esc(c.title)}</b> <span class="tag">${esc(c.language)}</span>
            ${c.packs.map((p) => `<div class="admin-line"><div class="admin-meta"><span>${esc(p.title)}</span>
              <small>${esc(t('version', { v: p.version }))} · ${esc(t('lessonsCount', { n: p.lessons }))} · ${p.size_kb} KB</small></div>
              <span class="admin-actions"><a class="btn btn--outline btn--sm" href="#/edit/${p.pack_id}">${esc(t('editPack'))}</a>
              <button class="btn btn--outline btn--sm btn--danger" data-del-pack="${p.pack_id}" data-title="${esc(c.title + ': ' + p.title)}">${esc(t('deletePack'))}</button></span></div>`).join('')}
          </div>`).join('') : '';
      };
      box.innerHTML = `<p class="muted">${esc(t('contentSummary', { c: withPacks.length, p: packs }))}</p>` + group('primary') + group('secondary');
      box.querySelectorAll('[data-del-pack]').forEach((b) => b.addEventListener('click', async () => {
        if (!window.confirm(t('deletePackConfirm', { title: b.dataset.title }))) return;
        b.disabled = true;
        try {
          await api.deletePack(b.dataset.delPack);
          if (alive(id)) { await drawPublished(id); box.insertAdjacentHTML('afterbegin', `<p class="form-ok">${esc(t('packDeleted'))}</p>`); }
        } catch (e) {
          b.disabled = false;
          if (alive(id)) box.insertAdjacentHTML('afterbegin', `<p class="form-error">${esc(failText(e))}</p>`);
        }
      }));
    } catch (e) {
      if (alive(id)) box.innerHTML = `<p class="form-error">${esc(failText(e))}</p>`;
    }
  }

  async function publishAll(id) {
    running = true;
    drawQueue();
    for (const it of items) {
      if (it.state !== 'waiting') continue;
      it.state = 'busy';
      if (alive(id)) drawQueue();
      try {
        const r = await api.uploadPack(it.file);
        const updated = r.pack.version > 1;
        it.state = 'ok';
        it.text = `${updated ? t('updatedPack') : t('published')}: ${r.course.title} (${levelName(r.course.level)}, ${r.course.language}) · ` +
          `${r.pack.title} · ${t('version', { v: r.pack.version })} · ${t('lessonsCount', { n: r.imported.modules })}` +
          (r.course.created ? ` · ${t('newCourse')}` : '');
      } catch (e) {
        it.state = 'fail';
        it.text = `${t('failedPack')}: ${failText(e)}`;
        it.lines = (e.details || []).filter((d) => d !== e.message);
        if (e.status === 401) return; // the session ended; the app goes back to the welcome screen
      }
      if (alive(id)) drawQueue();
    }
    running = false;
    if (alive(id)) {
      drawQueue();
      const more = $app.querySelector('#after');
      if (more && items.some((i) => i.state === 'ok')) more.innerHTML = `<a class="btn btn--outline" href="#/content">${esc(t('seePublished'))}</a>`;
    }
  }

  function admin() {
    const id = nav.id;
    const u = store.getUser() || {};
    items = [];
    running = false;

    if (u.role !== 'admin') {
      $app.innerHTML = `<h1>${esc(t('publishContent'))}</h1><p class="muted">${esc(t('adminOnly'))}</p>`;
      return;
    }

    $app.innerHTML = `<h1>${esc(t('publishContent'))}</h1>
      <p class="muted">${esc(t('publishIntro'))}</p>
      <div class="photo-actions">
        <button class="btn btn--outline" id="pick-btn">${esc(t('choosePacks'))}</button>
        <button class="btn btn--primary" id="publish-btn" disabled>${esc(t('publishNow'))}</button>
        <input type="file" id="pick-input" accept=".zip,application/zip" multiple hidden>
      </div>
      <div id="queue"></div>
      <div id="after"></div>`;

    const input = $app.querySelector('#pick-input');
    $app.querySelector('#pick-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      for (const file of input.files) {
        if (items.some((i) => i.file.name === file.name && i.file.size === file.size && i.state === 'waiting')) continue;
        if (!/\.zip$/i.test(file.name)) items.push({ file, state: 'fail', text: t('onlyZip') });
        else if (file.size > MAX_BYTES) items.push({ file, state: 'fail', text: t('tooBig') });
        else items.push({ file, state: 'waiting' });
      }
      input.value = ''; // so the same file can be chosen again after a fix
      drawQueue();
    });
    $app.querySelector('#publish-btn').addEventListener('click', () => { if (!running) publishAll(id); });

    drawQueue();
  }

  function content() {
    const id = nav.id;
    const u = store.getUser() || {};
    if (u.role !== 'admin') {
      $app.innerHTML = `<h1>${esc(t('contentTitle'))}</h1><p class="muted">${esc(t('adminOnly'))}</p>`;
      return;
    }
    $app.innerHTML = `<h1>${esc(t('contentTitle'))}</h1>
      <div id="rq-banner"></div>
      <a class="btn btn--primary admin-cta" href="#/edit/new">${esc(t('newPack'))}</a>
      <div id="published"><p class="muted">${esc(t('loading'))}</p></div>`;
    drawPublished(id);
    // Tell the admin when learners are waiting for a reset code.
    if (navigator.onLine) {
      api.getResetRequests().then(({ requests }) => {
        const box = $app.querySelector('#rq-banner');
        if (alive(id) && box && requests.length) {
          box.innerHTML = `<a class="note" href="#/profile"><span><b>${esc(t('rqBanner', { n: requests.length }))}</b><br>${esc(t('rqBannerHint'))}</span></a>`;
        }
      }).catch(() => {});
    }
  }

  return { admin, content };
}
