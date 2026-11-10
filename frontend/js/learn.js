// Courses, packs, lessons and quizzes.
import * as packs from './packs.js';
import * as sync from './sync.js';
import { markdown } from './markdown.js';
import { avatarHTML } from './avatar.js';

export function createLearnScreens(ctx) {
  const { $app, t, esc, icon, go, nav, store } = ctx;
  const userId = () => (store.getUser() || {}).user_id;
  const alive = (id) => id === nav.id; // false once the learner has moved to another screen
  const COLORS = ['var(--tint-green)', 'var(--primary-soft)', 'var(--tint-sun)'];
  const courseIcon = (c) => (/math/i.test(`${c.subject} ${c.title}`) ? 'calc' : /life|science/i.test(`${c.subject} ${c.title}`) ? 'leaf' : 'courses');
  // Courses from an older server have no level: treat them as secondary.
  const levelOf = (c) => (c.level === 'primary' ? 'primary' : 'secondary');
  const LEVELS = ['primary', 'secondary'];
  const getLevel = () => (LEVELS.includes(store.getLevel()) ? store.getLevel() : 'primary');
  const back = (href, label) => `<a class="back" href="${href}">${icon('back', 18)} <span>${esc(label)}</span></a>`;
  const sortedModules = (lp) => [...(lp.manifest.modules || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const lessonHref = (packId, key) => `lesson/${packId}/${encodeURIComponent(key)}`;

  let audio = null;
  const stopAudio = () => { if (audio) { audio.pause(); audio = null; } };
  let qs = null; // state of the quiz being taken

  // Subjects always appear in the same order: Literacy, Maths, English, Science, Social studies, Life skills.
  const SUBJECT_ORDER = ['literacy', 'math', 'english', 'science', 'social', 'life'];
  const subjectRank = (c) => {
    const i = SUBJECT_ORDER.findIndex((s) => `${c.subject} ${c.title}`.toLowerCase().includes(s));
    return i < 0 ? SUBJECT_ORDER.length : i;
  };

  function courseRows(courses) {
    const lang = ctx.lang();
    const ordered = [...courses].sort((a, b) =>
      ((b.language === lang) - (a.language === lang)) || (subjectRank(a) - subjectRank(b)) || String(a.title).localeCompare(String(b.title)));
    return `<div class="course-list">` + ordered.map((c) =>
      `<a class="course" href="#/course/${c.course_id}" style="background:${COLORS[subjectRank(c) % 3]}">${icon(courseIcon(c), 22)}` +
      `<span>${esc(c.title)}${c.language !== lang ? ` <small class="tag">${esc(c.language)}</small>` : ''}</span>${icon('chevron', 18)}</a>`
    ).join('') + `</div>`;
  }

  async function fillCourseList(id) {
    let r;
    try { r = await packs.loadCourses(); } catch { r = { value: [], failed: true }; }
    if (!alive(id)) return;
    const box = $app.querySelector('#list');
    if (!r.value.length) { box.innerHTML = `<p class="muted">${esc(t(r.failed ? 'errGeneric' : 'noCourses'))}</p>`; return; }
    const draw = () => {
      const level = getLevel();
      const shown = r.value.filter((c) => levelOf(c) === level);
      box.innerHTML = `<div class="segment" role="group" aria-label="${esc(t('schoolLevel'))}">` +
        LEVELS.map((l) => `<button data-level="${l}" aria-pressed="${l === level}">${esc(t(l === 'primary' ? 'levelPrimary' : 'levelSecondary'))}</button>`).join('') +
        `</div>` + (shown.length ? courseRows(shown) : `<p class="muted">${esc(t('noCoursesLevel'))}</p>`);
      box.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { store.setLevel(b.dataset.level); draw(); }));
    };
    draw();
  }

  function home() {
    const id = nav.id;
    const u = store.getUser() || {};
    $app.innerHTML = `
      <div class="home-head">${avatarHTML(u, 56)}<h1>${esc(t('hi', { name: u.full_name || u.username || '' }))}</h1></div>
      <div class="stats">${icon('flame', 20)} ${esc(t('days', { n: u.streak_days ?? 0 }))} <span class="pts">${u.points ?? 0} pts</span></div>
      <h2>${esc(t('yourCourses'))}</h2><div id="list"><p class="muted">${esc(t('loading'))}</p></div>`;
    fillCourseList(id);
  }

  function courses() {
    const id = nav.id;
    $app.innerHTML = `<h1>${esc(t('tabCourses'))}</h1><div id="list"><p class="muted">${esc(t('loading'))}</p></div>`;
    fillCourseList(id);
  }

  /* ---------- one course: its weekly packs ---------- */
  function packRow(pk, lp, offline) {
    const mb = pk.file_size_kb < 1024 ? `${pk.file_size_kb} KB` : `${(pk.file_size_kb / 1024).toFixed(1)} MB`;
    let action;
    if (!lp) action = `<button class="btn btn--primary btn--sm" data-dl="${pk.pack_id}" ${offline ? 'disabled' : ''}>${esc(t('download'))}</button>`;
    else if (lp.version < pk.version) action = `<button class="btn btn--tint-sun btn--sm" data-dl="${pk.pack_id}" ${offline ? 'disabled' : ''}>${esc(t('update'))}</button>`;
    else action = `<span class="ready">${icon('check', 18)} ${esc(t('readyOffline'))}</span>`;
    const hasWeek = /\d/.test(pk.title || '') && /^\s*(week|semaine|icyumweru)/i.test(pk.title);
    const head = hasWeek ? esc(pk.title) : `${esc(t('weekN', { n: pk.week_number }))} · ${esc(pk.title)}`;
    const title = `<b>${head}</b><small class="muted">${mb}</small>`;
    return `<div class="pack"><div class="pack-row">` +
      (lp ? `<a class="pack-title" href="#/pack/${pk.pack_id}">${title}</a>` : `<span class="pack-title">${title}</span>`) +
      `${action}</div><div class="dl" hidden><div class="bar"><i></i></div><p class="small"></p></div></div>`;
  }

  async function course([courseId]) {
    const id = nav.id;
    $app.innerHTML = `${back('#/courses', t('tabCourses'))}<h1 id="ct">&nbsp;</h1><div id="packs"><p class="muted">${esc(t('loading'))}</p></div>`;
    const [list, p, local] = await Promise.all([
      packs.loadCourses().catch(() => ({ value: [] })),
      packs.loadPacks(courseId).catch(() => ({ value: null })),
      packs.localPacks(),
    ]);
    if (!alive(id)) return;
    const c = list.value.find((x) => String(x.course_id) === String(courseId));
    $app.querySelector('#ct').textContent = c ? c.title : '';
    const box = $app.querySelector('#packs');
    if (!p.value) { box.innerHTML = `<p class="muted">${esc(t('errGeneric'))}</p>`; return; }
    const have = new Map(local.map((x) => [x.pack_id, x]));
    box.innerHTML = p.value.length ? p.value.map((pk) => packRow(pk, have.get(pk.pack_id), p.offline)).join('')
      : `<p class="muted">${esc(t('noPacks'))}</p>`;

    box.querySelectorAll('[data-dl]').forEach((btn) => btn.addEventListener('click', async () => {
      const pk = p.value.find((x) => String(x.pack_id) === btn.dataset.dl);
      const dl = btn.closest('.pack').querySelector('.dl');
      const bar = dl.querySelector('i');
      const msg = dl.querySelector('p');
      btn.disabled = true;
      dl.hidden = false;
      msg.className = 'small muted';
      msg.textContent = t('keepOpen');
      try {
        await packs.downloadPack(pk, courseId, (f, got, total) => {
          if (!alive(id)) return;
          bar.style.width = Math.round(f * 100) + '%';
          msg.textContent = `${Math.round(f * 100)}% · ${(got / 1048576).toFixed(2)} of ${(total / 1048576).toFixed(1)} MB`;
        });
        if (alive(id)) ctx.reroute();
      } catch (e) {
        if (!alive(id)) return;
        btn.disabled = false;
        msg.className = 'small form-error';
        msg.textContent = e.message === 'CHECKSUM' ? t('errChecksum') : e.message === 'BAD_PACK' ? t('errBadPack')
          : e.status === 0 ? t('errNetwork') : t('errGeneric');
      }
    }));
  }

  /* ---------- a downloaded pack: its lessons ---------- */
  async function pack([packId]) {
    const id = nav.id;
    const lp = await packs.localPack(packId);
    if (!alive(id)) return;
    if (!lp) { $app.innerHTML = `${back('#/courses', t('tabCourses'))}<p class="muted">${esc(t('errBadPack'))}</p>`; return; }
    const prog = new Map((await sync.progressOfPack(userId(), lp.pack_id)).map((r) => [r.module_key, r]));
    if (!alive(id)) return;
    const mods = sortedModules(lp);
    $app.innerHTML = `${back('#/course/' + lp.course_id, t('back'))}<h1>${esc(lp.title)}</h1>` + (mods.length
      ? mods.map((m) => {
        const done = prog.get(m.key) && prog.get(m.key).status === 'completed';
        return `<a class="pack pack-row" href="#/${lessonHref(lp.pack_id, m.key)}"><span class="pack-title"><b>${esc(m.title)}</b>` +
          `<small class="muted">${esc(t('minutes', { n: m.duration_min || '?' }))}${m.quiz ? ' · ' + esc(t('hasQuiz')) : ''}</small></span>` +
          `${done ? `<span class="ready">${icon('check', 18)}</span>` : icon('chevron', 18)}</a>`;
      }).join('')
      : `<p class="muted">${esc(t('noLessons'))}</p>`);
  }

  /* ---------- one lesson ---------- */
  async function lesson([packId, rawKey]) {
    const id = nav.id;
    stopAudio();
    const key = decodeURIComponent(rawKey || '');
    const lp = await packs.localPack(packId);
    if (!alive(id)) return;
    const mods = lp ? sortedModules(lp) : [];
    const idx = mods.findIndex((m) => m.key === key);
    if (idx < 0) { $app.innerHTML = `${back('#/courses', t('tabCourses'))}<p class="muted">${esc(t('errBadPack'))}</p>`; return; }
    const m = mods[idx];
    const hasQuiz = Boolean(m.quiz && Array.isArray(m.quiz.questions) && m.quiz.questions.length);
    const raw = m.body_file ? await packs.fileText(lp.pack_id, m.body_file) : null;
    if (!alive(id)) return;
    const dir = m.body_file && m.body_file.includes('/') ? m.body_file.slice(0, m.body_file.lastIndexOf('/') + 1) : '';
    const extra = (m.assets || []).filter((a) => a.type === 'image' && !(raw && raw.includes(a.path)));
    const label = hasQuiz ? t('takeQuiz') : idx < mods.length - 1 ? t('nextLesson') : t('finishPack');

    $app.innerHTML = `${back('#/pack/' + lp.pack_id, lp.title)}<h1>${esc(m.title)}</h1>
      <p class="muted">${esc(t('minutes', { n: m.duration_min || '?' }))}</p>
      <div class="lesson">${raw ? markdown(raw, esc) : ''}${extra.map((a) => `<img data-path="${esc(a.path)}" alt="${esc(a.alt || '')}">`).join('')}</div>
      ${m.audio ? `<button class="btn btn--outline" id="listen">${icon('play', 20)} <span>${esc(t('listen'))}</span></button>` : ''}
      <div class="lesson-foot">
        <div class="dots">${mods.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>
        <p class="muted">${esc(t('lessonOf', { i: idx + 1, n: mods.length }))}</p>
        <button class="btn btn--primary" id="next">${esc(label)}</button>
      </div>`;

    $app.querySelectorAll('img[data-path]').forEach(async (img) => {
      const url = (await packs.fileUrl(lp.pack_id, img.dataset.path)) || (await packs.fileUrl(lp.pack_id, dir + img.dataset.path));
      if (url && alive(id)) img.src = url;
    });

    const listen = $app.querySelector('#listen');
    if (listen) {
      const word = listen.querySelector('span');
      listen.addEventListener('click', async () => {
        if (!audio) {
          const url = await packs.fileUrl(lp.pack_id, m.audio);
          if (!url) { word.textContent = t('noAudio'); return; }
          audio = new Audio(url);
          audio.addEventListener('ended', () => { word.textContent = t('listen'); });
        }
        if (audio.paused) { audio.play(); word.textContent = t('pause'); } else { audio.pause(); word.textContent = t('listen'); }
      });
    }

    await sync.saveProgress(userId(), lp.pack_id, key, 'in_progress', 10);
    $app.querySelector('#next').addEventListener('click', async () => {
      stopAudio();
      if (hasQuiz) { qs = null; go(`quiz/${lp.pack_id}/${encodeURIComponent(key)}`); return; }
      await sync.saveProgress(userId(), lp.pack_id, key, 'completed');
      ctx.afterSave();
      go(idx < mods.length - 1 ? lessonHref(lp.pack_id, mods[idx + 1].key) : `pack/${lp.pack_id}`);
    });
  }

  /* ---------- quiz ---------- */
  async function quiz([packId, rawKey]) {
    const id = nav.id;
    const key = decodeURIComponent(rawKey || '');
    const lp = await packs.localPack(packId);
    if (!alive(id)) return;
    const mods = lp ? sortedModules(lp) : [];
    const idx = mods.findIndex((m) => m.key === key);
    const m = mods[idx];
    const questions = m && m.quiz ? (m.quiz.questions || []).filter((q) =>
      Array.isArray(q.options) && Number.isInteger(q.correct_index) && q.options[q.correct_index] !== undefined) : [];
    if (!questions.length) { $app.innerHTML = `${back('#/courses', t('tabCourses'))}<p class="muted">${esc(t('errBadPack'))}</p>`; return; }
    if (!qs || qs.packId !== lp.pack_id || qs.key !== key) qs = { packId: lp.pack_id, key, i: 0, correct: 0, selected: null, checked: false };
    const passMark = Number.isInteger(m.quiz.pass_mark) ? m.quiz.pass_mark : 70;
    const nextHref = idx < mods.length - 1 ? lessonHref(lp.pack_id, mods[idx + 1].key) : `pack/${lp.pack_id}`;

    function showQuestion() {
      const q = questions[qs.i];
      const cls = (i) => (qs.checked ? (i === q.correct_index ? 'is-right' : i === qs.selected ? 'is-wrong' : '') : i === qs.selected ? 'is-selected' : '');
      const mark = (i) => (qs.checked && i === q.correct_index ? icon('check', 20) : qs.checked && i === qs.selected ? icon('cross', 20) : '<span class="radio"></span>');
      let feedback = `<p class="muted">${esc(t('chooseOne'))}</p>`;
      if (qs.checked) {
        const right = qs.selected === q.correct_index;
        feedback = `<div class="feedback ${right ? 'ok' : 'bad'}" role="status"><b>${esc(t(right ? 'correct' : 'notQuite'))}</b>` +
          `<span>${esc(right ? '' : t('rightAnswer', { a: q.options[q.correct_index] }) + ' ')}${esc(q.explanation || '')}</span></div>`;
      }
      $app.innerHTML = `<div class="qhead"><b class="accent">${esc(t('questionOf', { i: qs.i + 1, n: questions.length }))}</b><span class="muted">${esc(m.title)}</span></div>
        <h1>${esc(q.prompt)}</h1>
        <div class="options">${q.options.map((o, i) => `<button class="option ${cls(i)}" data-i="${i}" aria-pressed="${qs.selected === i}" ${qs.checked ? 'disabled' : ''}>${mark(i)}<span>${esc(o)}</span></button>`).join('')}</div>
        ${feedback}
        <button class="btn btn--primary" id="act" ${qs.selected === null && !qs.checked ? 'disabled' : ''}>${esc(t(qs.checked ? 'continue' : 'check'))}</button>`;

      $app.querySelectorAll('.option').forEach((b) => b.addEventListener('click', () => { qs.selected = Number(b.dataset.i); showQuestion(); }));
      $app.querySelector('#act').addEventListener('click', () => {
        if (!qs.checked) { qs.checked = true; if (qs.selected === q.correct_index) qs.correct++; showQuestion(); return; }
        qs.i++; qs.selected = null; qs.checked = false;
        if (qs.i >= questions.length) showResults(); else showQuestion();
      });
    }

    async function showResults() {
      const score = Math.round((100 * qs.correct) / questions.length);
      const passed = score >= passMark;
      const right = qs.correct;
      $app.innerHTML = `<p class="muted center">${esc(t('resultsTitle', { title: m.title }))}</p>
        <div class="ring" style="--p:${score}"><div><b>${score}%</b><span>${esc(t('rightCount', { c: right, n: questions.length }))}</span></div></div>
        <h1 class="center">${esc(t(passed ? 'passed' : 'tryAgainTitle'))}</h1>
        <p id="pts" class="center muted">${passed ? '' : esc(t('needScore', { p: passMark }))}</p>
        <div class="stack">
          <button class="btn btn--primary" id="main">${esc(passed ? t(idx < mods.length - 1 ? 'nextLesson' : 'backToPack') : t('tryAgain'))}</button>
          <button class="btn btn--outline" id="alt">${esc(passed ? t('backToPack') : t('backToLesson'))}</button>
        </div>`;
      $app.querySelector('#main').addEventListener('click', () => {
        if (passed) go(nextHref); else { qs = null; quiz([packId, rawKey]); }
      });
      $app.querySelector('#alt').addEventListener('click', () => go(passed ? `pack/${lp.pack_id}` : lessonHref(lp.pack_id, key)));

      await sync.saveAttempt(userId(), lp.pack_id, key, score);
      if (passed) await sync.saveProgress(userId(), lp.pack_id, key, 'completed');
      const rewards = await ctx.afterSave();
      const pts = $app.querySelector('#pts');
      if (pts && alive(id) && passed) {
        pts.textContent = rewards ? (rewards.points_earned > 0 ? t('pointsEarned', { n: rewards.points_earned }) : '') : t('savedOffline');
      }
    }

    showQuestion();
  }

  return { home, courses, course, pack, lesson, quiz, stopAudio };
}
