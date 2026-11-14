// The lesson editor (admin only): write or edit a lesson pack in the browser.
//
// The admin fills in the course, the week, the lessons (text, optional MP3 audio)
// and optional quiz questions, then presses Publish. The server builds the pack
// and publishes it with the same checks as an uploaded zip. Nothing reaches
// learners until Publish is pressed.
//
// The form keeps its state in one object (`st`). Typing only updates that object;
// buttons that change the structure (add, remove, move) draw the form again.
// A copy of the text is also kept in this browser, so a closed tab does not lose it.

import * as api from './api.js';
import { markdown } from './markdown.js';

const MAX_AUDIO = 2 * 1024 * 1024;   // same limit as the server
const LANGS = [['en', 'English'], ['fr', 'Français'], ['rw', 'Kinyarwanda']];

const blankLesson = () => ({ title: '', body: '', duration_min: '10', audio: null, quiz: null });
const blankQuestion = () => ({ prompt: '', options: ['', ''], correct_index: 0, explanation: '' });
const newSpec = () => ({
  course: { title: '', subject: '', language: 'en', level: 'primary', description: '' },
  pack: { title: '', week_number: '1' },
  lessons: [blankLesson()],
});

// "lessons.2.quiz.questions.0.prompt" -> sets that field.
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) { o = o[k]; if (o === undefined || o === null) return; }
  o[last] = value;
}

const draftKey = (id) => `accessed:editor:${id}`;
const readDraft = (id) => { try { return JSON.parse(localStorage.getItem(draftKey(id))); } catch { return null; } };
const writeDraft = (id, data) => { try { localStorage.setItem(draftKey(id), JSON.stringify(data)); } catch {} };
const dropDraft = (id) => { try { localStorage.removeItem(draftKey(id)); } catch {} };

export function createEditorScreens({ $app, t, esc, icon, nav, store }) {
  let st = null;
  let saveTimer = null;

  const alive = (me) => st === me && nav.id === me.navId;

  // Turns the editor's numbers (kept as text while typing) into what the server expects.
  const num = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));

  function specToSend(spec) {
    return {
      course: { ...spec.course },
      pack: { title: spec.pack.title, week_number: num(spec.pack.week_number) },
      lessons: spec.lessons.map((l) => ({
        ...(l.key ? { key: l.key } : {}),
        title: l.title,
        body: l.body,
        duration_min: num(l.duration_min),
        audio: l.audio ? (l.audio.keep ? { keep: true } : { token: l.audio.token }) : null,
        quiz: l.quiz ? {
          pass_mark: num(l.quiz.pass_mark),
          questions: l.quiz.questions.map((q) => ({
            prompt: q.prompt, options: q.options, correct_index: q.correct_index, explanation: q.explanation,
          })),
        } : null,
      })),
    };
  }

  // The copy kept in this browser. New audio is not kept: its upload expires.
  function draftOf(spec) {
    const s = JSON.parse(JSON.stringify(specToSend(spec)));
    s.lessons.forEach((l) => { if (l.audio && !l.audio.keep) l.audio = null; });
    return s;
  }
  function fromDraft(d) {
    return {
      course: { ...newSpec().course, ...d.course },
      pack: { title: d.pack.title || '', week_number: String(d.pack.week_number ?? '1') },
      lessons: d.lessons.map((l) => ({
        ...(l.key ? { key: l.key } : {}),
        title: l.title || '', body: l.body || '', duration_min: String(l.duration_min ?? '10'),
        audio: l.audio && l.audio.keep ? { keep: true } : null,
        quiz: l.quiz ? {
          pass_mark: String(l.quiz.pass_mark ?? '70'),
          questions: (l.quiz.questions || []).map((q) => ({
            prompt: q.prompt || '', options: Array.isArray(q.options) && q.options.length >= 2 ? q.options : ['', ''],
            correct_index: Number.isInteger(q.correct_index) ? q.correct_index : 0, explanation: q.explanation || '',
          })),
        } : null,
      })),
    };
  }
  // What the server sends back, in the editor's own shape.
  function fromSource(src) {
    return {
      course: { title: src.course.title, subject: src.course.subject, language: src.course.language,
        level: src.course.level, description: src.course.description || '' },
      pack: { title: src.pack.title, week_number: String(src.pack.week_number) },
      lessons: src.lessons.map((l) => ({
        key: l.key, title: l.title, body: l.body, duration_min: String(l.duration_min ?? 10),
        audio: l.audio ? { keep: true } : null,
        quiz: l.quiz ? {
          pass_mark: String(l.quiz.pass_mark ?? 70),
          questions: l.quiz.questions.map((q) => ({
            prompt: q.prompt, options: [...q.options], correct_index: q.correct_index, explanation: q.explanation || '',
          })),
        } : null,
      })),
    };
  }

  function failText(e) {
    if (!(e instanceof api.ApiError)) return t('errGeneric');
    if (e.status === 0) return t('errNetwork');
    if (e.status === 403) return t('adminOnly');
    return e.message;
  }
  const failMsg = (e) => ({ ok: false, text: failText(e), lines: (e.details || []).filter((d) => d !== e.message) });

  /* ---------- drawing ---------- */
  const field = (label, path, value, extra = '') => {
    const id = `f-${path.replace(/\./g, '-')}`;
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      <input id="${id}" data-p="${path}" value="${esc(value)}" ${extra}></div>`;
  };
  const area = (label, path, value, cls = '', rows = 3, hint = '') => {
    const id = `f-${path.replace(/\./g, '-')}`;
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      <textarea id="${id}" class="${cls}" rows="${rows}" data-p="${path}">${esc(value)}</textarea>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  };

  function questionHTML(li, qi, q) {
    const base = `lessons.${li}.quiz.questions.${qi}`;
    return `<div class="ed-q">
      <div class="ed-lesson-head"><b>${esc(t('question', { n: qi + 1 }))}</b>
        <button class="btn btn--outline btn--sm" data-a="del-question" data-l="${li}" data-q="${qi}">${esc(t('removeQuestion'))}</button></div>
      ${field(t('questionText'), `${base}.prompt`, q.prompt)}
      <fieldset class="ed-answers"><legend>${esc(t('answersTick'))}</legend>
        ${q.options.map((o, oi) => `<div class="ed-opt">
          <input type="radio" name="c-${li}-${qi}" data-a="correct" data-l="${li}" data-q="${qi}" data-o="${oi}" ${q.correct_index === oi ? 'checked' : ''} aria-label="${esc(t('correctAnswer', { n: oi + 1 }))}">
          <input type="text" data-p="${base}.options.${oi}" value="${esc(o)}" placeholder="${esc(t('answerN', { n: oi + 1 }))}" aria-label="${esc(t('answerN', { n: oi + 1 }))}">
          ${q.options.length > 2 ? `<button class="btn btn--outline btn--sm" data-a="del-option" data-l="${li}" data-q="${qi}" data-o="${oi}" aria-label="${esc(t('removeAnswer'))}">×</button>` : ''}
        </div>`).join('')}
        ${q.options.length < 6 ? `<button class="btn btn--outline btn--sm" data-a="add-option" data-l="${li}" data-q="${qi}">${esc(t('addAnswer'))}</button>` : ''}
      </fieldset>
      ${field(t('explanation'), `${base}.explanation`, q.explanation)}
    </div>`;
  }

  function audioHTML(li, l) {
    let info = '';
    if (l.audioBusy) info = `<p class="muted">${esc(t('uploading'))}</p>`;
    else if (l.audio && l.audio.keep) info = `<p>${esc(t('audioKept'))}</p>`;
    else if (l.audio) info = `<p>${esc(l.audio.name)} · ${l.audio.size_kb} KB</p><audio controls src="${esc(l.audio.url)}"></audio>`;
    return `<div class="field"><label>${esc(t('audioLabel'))}</label>${info}
      <div class="photo-actions">
        <button class="btn btn--outline" data-a="pick-audio" data-l="${li}" ${l.audioBusy ? 'disabled' : ''}>${esc(t(l.audio ? 'replaceAudio' : 'addAudio'))}</button>
        ${l.audio ? `<button class="btn btn--outline" data-a="del-audio" data-l="${li}">${esc(t('removeAudio'))}</button>` : ''}
        <input type="file" hidden accept=".mp3,audio/mpeg" data-a="audio-file" data-l="${li}">
      </div></div>`;
  }

  function lessonHTML(li, l, count) {
    const base = `lessons.${li}`;
    const published = Boolean(l.key);
    const preview = st.previews[li];
    return `<div class="pack ed-lesson">
      <div class="ed-lesson-head"><b>${esc(t('lessonN', { n: li + 1 }))}</b>
        <span class="ed-tools">
          <button class="btn btn--outline btn--sm" data-a="up" data-l="${li}" aria-label="${esc(t('moveUp'))}" ${li === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn--outline btn--sm" data-a="down" data-l="${li}" aria-label="${esc(t('moveDown'))}" ${li === count - 1 ? 'disabled' : ''}>↓</button>
          ${published ? '' : `<button class="btn btn--outline btn--sm" data-a="del-lesson" data-l="${li}">${esc(t('removeLesson'))}</button>`}
        </span></div>
      ${published ? `<p class="hint">${esc(t('publishedKeep'))}</p>` : ''}
      ${field(t('lessonTitle'), `${base}.title`, l.title)}
      ${field(t('fMinutes'), `${base}.duration_min`, l.duration_min, 'type="number" inputmode="numeric" min="1" max="240"')}
      ${preview
        ? `<div class="field"><label>${esc(t('lessonText'))}</label><div class="ed-preview lesson">${markdown(l.body, esc) || `<p class="muted">—</p>`}</div></div>`
        : area(t('lessonText'), `${base}.body`, l.body, 'ed-body', 10, t('textHelp'))}
      <button class="btn btn--outline btn--sm" data-a="preview" data-l="${li}">${esc(t(preview ? 'editText' : 'preview'))}</button>
      ${audioHTML(li, l)}
      <div class="field"><label>${esc(t('quiz'))}</label>
        ${l.quiz ? `
          ${field(t('passMark'), `${base}.quiz.pass_mark`, l.quiz.pass_mark, 'type="number" inputmode="numeric" min="0" max="100"')}
          ${l.quiz.questions.map((q, qi) => questionHTML(li, qi, q)).join('')}
          <div class="photo-actions">
            <button class="btn btn--outline" data-a="add-question" data-l="${li}">${esc(t('addQuestion'))}</button>
            <button class="btn btn--outline" data-a="del-quiz" data-l="${li}">${esc(t('removeQuiz'))}</button>
          </div>`
        : `<button class="btn btn--outline btn--sm" data-a="add-quiz" data-l="${li}">${esc(t('addQuiz'))}</button>`}
      </div>
    </div>`;
  }

  function messageHTML() {
    const m = st.flash || st.msg;
    if (!m) return '';
    return `<div class="ed-box ${m.ok ? 'ed-box--ok' : 'ed-box--bad'}" id="ed-msg" role="${m.ok ? 'status' : 'alert'}">
      <b>${esc(m.text)}</b>${m.lines && m.lines.length ? `<ul>${m.lines.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  function render(scrollToMessage = false) {
    if (!st || !st.root.isConnected) return;
    const top = $app.scrollTop;
    const s = st.spec;
    const locked = st.id !== 'new';
    const when = st.restore ? new Date(st.restore.at).toLocaleString() : '';
    st.root.innerHTML = `
      <a class="back" href="#/content">${icon('back', 18)} <span>${esc(t('tabContent'))}</span></a>
      <h1>${esc(t(locked ? 'editPackTitle' : 'newPackTitle'))}</h1>
      ${st.restore ? `<div class="ed-box ed-box--bad"><b>${esc(t('draftFound', { time: when }))}</b>
        <div class="photo-actions"><button class="btn btn--primary" data-a="restore">${esc(t('restore'))}</button>
        <button class="btn btn--outline" data-a="discard">${esc(t('discard'))}</button></div></div>` : ''}
      ${st.flash ? messageHTML() : ''}
      <section class="ed-sec"><h2>${esc(t('courseSection'))}</h2>
        ${locked ? `<div class="note"><span>${esc(t('lockedNote'))}</span></div>` : ''}
        ${field(t('fTitle'), 'course.title', s.course.title, locked ? 'disabled' : '')}
        ${field(t('fSubject'), 'course.subject', s.course.subject)}
        <div class="field"><label>${esc(t('schoolLevel'))}</label>
          <div class="segment" role="group">
            ${['primary', 'secondary'].map((lv) => `<button data-a="level" data-v="${lv}" aria-pressed="${s.course.level === lv}" ${locked ? 'disabled' : ''}>${esc(t(lv === 'primary' ? 'levelPrimary' : 'levelSecondary'))}</button>`).join('')}
          </div></div>
        <div class="field"><label for="f-course-language">${esc(t('fLanguage'))}</label>
          <select id="f-course-language" data-p="course.language" ${locked ? 'disabled' : ''}>
            ${LANGS.map(([c, n]) => `<option value="${c}" ${s.course.language === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          </select></div>
        ${area(t('fDescription'), 'course.description', s.course.description, '', 2)}
      </section>
      <section class="ed-sec"><h2>${esc(t('packSection'))}</h2>
        ${field(t('fPackTitle'), 'pack.title', s.pack.title)}
        ${field(t('fWeek'), 'pack.week_number', s.pack.week_number, `type="number" inputmode="numeric" min="1" ${locked ? 'disabled' : ''}`)}
      </section>
      <section class="ed-sec"><h2>${esc(t('lessonsSection'))}</h2>
        ${s.lessons.map((l, i) => lessonHTML(i, l, s.lessons.length)).join('')}
        <button class="btn btn--outline" data-a="add-lesson">${esc(t('addLesson'))}</button>
      </section>
      ${st.flash ? '' : messageHTML()}
      <div class="ed-bar">
        <p class="hint">${esc(t('publishHint'))}</p>
        <button class="btn btn--primary" data-a="publish" ${st.busy ? 'disabled' : ''}>${esc(t(st.busy ? 'publishing' : 'publishNow'))}</button>
      </div>`;
    $app.scrollTop = scrollToMessage ? 0 : top;
    if (scrollToMessage) {
      const box = st.root.querySelector('#ed-msg');
      if (box) box.scrollIntoView({ block: 'center' });
    }
  }

  /* ---------- changes ---------- */
  function touched() {
    st.dirty = true;
    clearTimeout(saveTimer);
    const me = st;
    saveTimer = setTimeout(() => { if (st === me) writeDraft(me.id, { at: Date.now(), spec: draftOf(me.spec) }); }, 600);
  }

  function setLessons(fn) { fn(st.spec.lessons); st.previews = {}; touched(); render(); }

  async function addAudio(li, file) {
    const me = st;
    const l = me.spec.lessons[li];
    if (!l || !file) return;
    if (!/\.mp3$/i.test(file.name)) { me.msg = { ok: false, text: t('audioNotMp3') }; render(true); return; }
    if (file.size > MAX_AUDIO) { me.msg = { ok: false, text: t('audioTooBig') }; render(true); return; }
    me.msg = null;
    l.audioBusy = true; render();
    try {
      const r = await api.uploadAudio(file);
      l.audio = { token: r.token, name: file.name, size_kb: r.size_kb, url: URL.createObjectURL(file) };
      touched();
    } catch (e) {
      me.msg = failMsg(e);
    }
    l.audioBusy = false;
    if (alive(me)) render(Boolean(me.msg));
  }

  async function publish() {
    const me = st;
    if (me.busy) return;
    me.busy = true; me.msg = null; me.flash = null;
    render();
    try {
      const r = await api.saveLessons(specToSend(me.spec));
      const src = await api.getPackSource(r.pack.pack_id); // so new lessons get their keys
      dropDraft(me.id); dropDraft('new'); dropDraft(r.pack.pack_id);
      if (!alive(me)) return;
      me.id = String(r.pack.pack_id);
      history.replaceState(null, '', `#/edit/${me.id}`);
      me.spec = fromSource(src);
      me.dirty = false;
      me.previews = {};
      me.flash = { ok: true, text: `${r.message} (${t('version', { v: r.pack.version })}, ${t('lessonsCount', { n: r.imported.modules })})` };
    } catch (e) {
      me.msg = failMsg(e);
    }
    me.busy = false;
    if (alive(me)) render(true);
  }

  const ACTIONS = {
    level: (d) => { st.spec.course.level = d.v; touched(); render(); },
    'add-lesson': () => setLessons((ls) => ls.push(blankLesson())),
    'del-lesson': (d) => setLessons((ls) => ls.splice(+d.l, 1)),
    up: (d) => { const i = +d.l; if (i > 0) setLessons((ls) => ls.splice(i - 1, 0, ls.splice(i, 1)[0])); },
    down: (d) => { const i = +d.l; setLessons((ls) => { if (i < ls.length - 1) ls.splice(i + 1, 0, ls.splice(i, 1)[0]); }); },
    preview: (d) => { st.previews[+d.l] = !st.previews[+d.l]; render(); },
    'add-quiz': (d) => { st.spec.lessons[+d.l].quiz = { pass_mark: '70', questions: [blankQuestion()] }; touched(); render(); },
    'del-quiz': (d) => { st.spec.lessons[+d.l].quiz = null; touched(); render(); },
    'add-question': (d) => { st.spec.lessons[+d.l].quiz.questions.push(blankQuestion()); touched(); render(); },
    'del-question': (d) => {
      const qs = st.spec.lessons[+d.l].quiz.questions;
      qs.splice(+d.q, 1);
      if (qs.length === 0) st.spec.lessons[+d.l].quiz = null; // a quiz needs a question
      touched(); render();
    },
    'add-option': (d) => { st.spec.lessons[+d.l].quiz.questions[+d.q].options.push(''); touched(); render(); },
    'del-option': (d) => {
      const q = st.spec.lessons[+d.l].quiz.questions[+d.q];
      const o = +d.o;
      q.options.splice(o, 1);
      if (q.correct_index === o) q.correct_index = 0;
      else if (q.correct_index > o) q.correct_index -= 1;
      touched(); render();
    },
    'pick-audio': (d) => { const f = st.root.querySelector(`input[data-a="audio-file"][data-l="${d.l}"]`); if (f) f.click(); },
    'del-audio': (d) => { st.spec.lessons[+d.l].audio = null; touched(); render(); },
    restore: () => { st.spec = fromDraft(st.restore.spec); st.restore = null; st.dirty = true; render(); },
    discard: () => { dropDraft(st.id); st.restore = null; render(); },
    publish: () => publish(),
  };

  function attach(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled || !root.contains(b)) return;
      const fn = ACTIONS[b.dataset.a];
      if (fn) fn(b.dataset);
    });
    root.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.dataset || !el.dataset.p) return;
      setPath(st.spec, el.dataset.p, el.value);
      touched();
    });
    root.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.a === 'correct') {
        st.spec.lessons[+el.dataset.l].quiz.questions[+el.dataset.q].correct_index = +el.dataset.o;
        touched();
      } else if (el.dataset.a === 'audio-file') {
        const file = el.files && el.files[0];
        el.value = '';
        addAudio(+el.dataset.l, file);
      }
    });
  }

  window.addEventListener('beforeunload', (e) => {
    if (st && st.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- the screen ---------- */
  async function edit(args) {
    const id = (args && args[0]) || 'new';
    const u = store.getUser() || {};
    if (u.role !== 'admin') {
      $app.innerHTML = `<h1>${esc(t('newPackTitle'))}</h1><p class="muted">${esc(t('adminOnly'))}</p>`;
      return;
    }
    if (id !== 'new' && !/^\d+$/.test(id)) { location.hash = '#/content'; return; }

    $app.innerHTML = `<div id="ed"><p class="muted">${esc(t('loading'))}</p></div>`;
    const root = $app.querySelector('#ed');
    const me = {
      id, root, navId: nav.id, spec: newSpec(), dirty: false, busy: false,
      msg: null, flash: null, restore: null, previews: {},
    };
    st = me;
    attach(root);

    if (id !== 'new') {
      try {
        me.spec = fromSource(await api.getPackSource(id));
      } catch (e) {
        if (alive(me)) root.innerHTML = `<a class="back" href="#/content">${icon('back', 18)} <span>${esc(t('tabContent'))}</span></a><p class="form-error">${esc(failText(e))}</p>`;
        return;
      }
      if (!alive(me)) return;
    }

    const saved = readDraft(id);
    if (saved && saved.spec && saved.spec.course && saved.spec.pack && Array.isArray(saved.spec.lessons) &&
        JSON.stringify(saved.spec) !== JSON.stringify(draftOf(me.spec))) {
      me.restore = saved;
    }
    render();
  }

  return { edit };
}
