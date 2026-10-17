// modules/lesson_player.js - "A LESSON": plays a lesson file (lesson_file.js) as Read, Slides or Watch. Row 2.92.
//
// Mike, 2026-10-15/17: lessons in "whatever form you like" from one file - read it, slides, an AI teacher, two
// voices, a room - "Let's get two started". This is the first player: the three forms that need no AI and no room
// (chat's table, lesson_shape_20261016.md section 3). The AI teacher, two voices and the room come next, on the same
// file and the same beats; nothing here has to change for them.
//
//   READ    the report: classes as headings, each beat as a paragraph, what it shows in words, citations as numbered
//           notes, and the review questions with their answers at the end.
//   SLIDES  one beat at a time, the "show" big and the "say" as a caption (and spoken); Next / Back, and a question's
//           answers as big buttons. A person moves it on: this is the form for somebody at the screen.
//   WATCH   the slides, moving on by themselves after each is said. A question is ASKED, then answered after a
//           moment, never waited on: Watch is for a screen nobody may be pressing (CLAUDE.md, "a screen must never
//           enter a state that only an input can leave, when the person in front of it cannot give that input").
// DEFAULT: WATCH, argued. FOR Slides: a lesson is somebody learning, and pressing Next is part of it. AGAINST, and it
// decides it: a lesson placed on a screen for somebody who cannot press anything would sit on its first slide for
// good; Watch plays through, and anybody who can press switches to Slides in one row. A guess for Mike.
//
// DRAWN, NOT STORED (content-as-meaning): numerals, counted things, headings, rows and charts are drawn here in the
// theme's own colours; a picture is DESCRIBED in the file ("a clock face") and shown as that description in a frame
// until Design's pictures exist (row 2.92, assets) - an honest card, never a wrong picture. Animations are the
// shared library's names (lesson_file.js MOVES) played as CSS; with "reduce motion" asked for, none move.
// WHERE IT GOT TO is kept on the panel's own row (`at`), so a lesson stopped part-way carries on there.

import { registerModule } from '../module.js';
import { checkLesson, beatsOf, showFor, citeWords, LOOKS } from '../lesson_file.js';
import { BUILTIN_LESSONS } from '../lessons_builtin.js';

export const LESSON_FORMS = Object.freeze(['watch', 'slides', 'read']);
// How long a beat stays in Watch after its words, at the least (Rule 1: a setting; the words' own time is added).
export const WATCH_HOLD_MS = 4000;
// About how long one spoken word takes, to give the voice time to finish before Watch moves on. Measured on the
// site's own voices, not exactly: a little slower than conversation, which is the pace these voices are set to.
export const MS_PER_WORD = 420;

const SETTINGS = [
  { key: 'lessonId', label: 'Which lesson', kind: 'choice', default: BUILTIN_LESSONS[0].id, level: 'essential',
    options: BUILTIN_LESSONS.map((l) => ({ value: l.id, label: l.label })) },
  { key: 'form', label: 'How it is shown', kind: 'choice', default: 'watch', level: 'essential',
    options: [{ value: 'watch', label: 'Watch: it plays by itself' }, { value: 'slides', label: 'Slides: press Next to go on' },
      { value: 'read', label: 'Read: all of it, as a page' }] },
  { key: 'look', label: 'Pictures for', kind: 'choice', default: 'grownup', level: 'standard',
    note: 'The same lesson; only the things shown change (cups and keys, or ducks and apples).',
    options: [{ value: 'grownup', label: 'A grown-up' }, { value: 'child', label: 'A child' }] },
  { key: 'speak', label: 'Say it aloud', kind: 'toggle', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No, captions only' },
  { key: 'holdMs', label: 'In Watch, each part stays at least', kind: 'choice', default: WATCH_HOLD_MS, level: 'advanced',
    options: [{ value: 2000, label: '2 seconds' }, { value: 4000, label: '4 seconds' }, { value: 8000, label: '8 seconds' }, { value: 15000, label: '15 seconds' }],
    appliesWhen: (v) => (v?.form || 'watch') === 'watch' },
];
export const LESSON_SETTINGS = SETTINGS;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "3 cups", "1 cup", "no cups": what a count shows, in words. PURE. */
export function countWords(n, thing = '') {
  const t = String(thing || '').trim();
  if (!t) return String(n);
  if (n === 0) return `no ${t}s`;
  return `${n} ${n === 1 ? t : `${t}s`}`;
}
/** What a show is, in words (the Read form, and a screen reader). PURE. */
export function showWords(show, lesson) {
  if (!show) return '';
  if (show.kind === 'heading' || show.kind === 'word') return show.text;
  if (show.kind === 'quote') return `“${show.text}”${show.by ? ` (${show.by})` : ''}`;
  if (show.kind === 'numeral') return `The number ${show.n}${WORDS[show.n] ? ` (${WORDS[show.n]})` : ''}`;
  if (show.kind === 'count') return countWords(show.n, show.thing);
  if (show.kind === 'picture') return `A picture of ${show.of}`;
  if (show.kind === 'row') return show.items.join(', ');
  if (show.kind === 'chart') {
    const c = (lesson?.charts || []).find((x) => x.id === show.chart);
    return c ? `${c.title ? `${c.title}: ` : ''}${c.rows.map((r) => `${r.label} ${r.value}`).join(', ')}` : '';
  }
  return '';
}
/** The answers to a question in a fixed shuffled order (the same each time it is shown, so a switch learns it). PURE. */
export function answersOf(q) {
  const all = [q.answer, ...q.wrong];
  let h = 0;
  for (const ch of q.question) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = all.slice();
  for (let i = out.length - 1; i > 0; i -= 1) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const CSS = `
.lp{position:relative;height:100%;display:flex;flex-direction:column;color:var(--text);background:var(--bg,transparent);font:inherit;overflow:hidden}
.lp-top{display:flex;justify-content:space-between;gap:10px;padding:8px 14px;color:var(--text-muted,var(--text));font-size:.9rem}
.lp-stage{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:10px 18px;text-align:center}
.lp-show{display:flex;align-items:center;justify-content:center;min-height:0;max-width:100%}
.lp-numeral{font-size:min(40cqh,40cqw);line-height:1;font-weight:700;color:var(--accent,var(--text))}
.lp-heading{font-size:clamp(1.4rem,7cqw,3rem);font-weight:700}
.lp-word{font-size:clamp(1.6rem,9cqw,4rem);font-weight:700}
.lp-quote{font-size:clamp(1.1rem,4cqw,2rem);font-style:italic;max-width:40ch}
.lp-count{display:flex;flex-direction:column;align-items:center;gap:8px}
.lp-dots{display:grid;grid-template-columns:repeat(var(--lp-cols,5),auto);gap:min(2.4cqw,14px)}
.lp-dots i{display:block;width:min(9cqw,9cqh,64px);height:min(9cqw,9cqh,64px);border-radius:50%;background:var(--accent,var(--text))}
.lp-dots i.lp-empty{background:transparent;border:2px dashed var(--border,currentColor)}
.lp-thing{font-size:clamp(1rem,4cqw,1.8rem);color:var(--text)}
.lp-picture{border:2px solid var(--border,currentColor);border-radius:16px;padding:22px 26px;max-width:32rem;font-size:clamp(1.1rem,4cqw,1.8rem);background:var(--surface,transparent)}
.lp-picture small{display:block;font-size:.7em;color:var(--text-muted,var(--text));margin-bottom:6px}
.lp-row{display:flex;flex-wrap:wrap;gap:min(2cqw,12px);justify-content:center}
.lp-row span{min-width:1.6em;padding:6px 10px;border-radius:10px;border:2px solid var(--border,currentColor);font-size:clamp(1.3rem,6cqw,2.6rem);font-weight:700}
.lp-bars{display:flex;flex-direction:column;gap:6px;width:min(36rem,90%);text-align:left}
.lp-bar{display:grid;grid-template-columns:8em 1fr 3em;gap:8px;align-items:center}
.lp-bar b{display:block;height:1.1em;background:var(--accent,var(--text));border-radius:4px;transform-origin:left}
.lp-say{font-size:clamp(1rem,3.4cqw,1.6rem);max-width:46ch}
.lp-cite{font-size:.85rem;color:var(--text-muted,var(--text))}
.lp-ask{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.lp-ask button,.lp-nav button{min-height:56px;min-width:88px;padding:8px 18px;border-radius:12px;border:2px solid var(--border,currentColor);background:var(--surface,transparent);color:var(--text);font:inherit;font-size:clamp(1.1rem,4cqw,1.8rem);cursor:pointer}
.lp-ask button[data-lit],.lp-nav button[data-lit]{outline:4px solid var(--accent,currentColor);outline-offset:2px}
.lp-ask button.lp-right{border-color:var(--accent,currentColor)}
.lp-said{font-size:clamp(1rem,3cqw,1.4rem)}
.lp-nav{display:flex;justify-content:center;gap:12px;padding:8px}
.lp-nav button{font-size:1rem;min-height:48px}
.lp-read{overflow:auto;padding:14px 20px;max-width:46rem;margin:0 auto;line-height:1.5}
.lp-read h2{margin:.2em 0}.lp-read h3{margin:1em 0 .2em}
.lp-read .lp-goal,.lp-read .lp-fn{color:var(--text-muted,var(--text));font-size:.9rem}
@keyframes lp-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes lp-left{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
@keyframes lp-fade{from{opacity:0}to{opacity:1}}
@keyframes lp-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes lp-lit{0%,100%{background:transparent}50%{background:var(--accent,currentColor);color:var(--surface,#fff)}}
.lp-m-title-rise .lp-show{animation:lp-rise .6s ease-out both}
.lp-m-slide-in-left .lp-show{animation:lp-left .6s ease-out both}
.lp-m-fade .lp-show{animation:lp-fade .8s ease-out both}
.lp-m-count-in .lp-dots i{animation:lp-fade .4s ease-out both;animation-delay:calc(var(--i) * .7s)}
.lp-m-bars-grow .lp-bar b{animation:lp-grow .9s ease-out both}
.lp-m-light-in-turn .lp-row span{animation:lp-lit .9s ease-in-out both;animation-delay:calc(var(--i) * .9s)}
@media (prefers-reduced-motion: reduce){.lp *{animation:none !important}}
`;
function ensureCss(doc) {
  if (!doc || doc.getElementById('lesson-player-css')) return;
  const s = doc.createElement('style');
  s.id = 'lesson-player-css';
  s.textContent = CSS;
  doc.head.append(s);
}

/** The HTML for one show, drawn big (the Slides and Watch forms). PURE. */
export function showHTML(show, lesson) {
  if (!show) return '';
  const k = show.kind;
  if (k === 'numeral') return `<div class="lp-numeral" data-lp-numeral="${show.n}">${show.n}</div>`;
  if (k === 'heading') return `<div class="lp-heading">${esc(show.text)}</div>`;
  if (k === 'word') return `<div class="lp-word">${esc(show.text)}</div>`;
  if (k === 'quote') return `<div class="lp-quote">“${esc(show.text)}”${show.by ? `<br><small>${esc(show.by)}</small>` : ''}</div>`;
  if (k === 'count') {
    // A five-frame (rows of five, the last row filled with empty places) from 5 up, so 7 reads as five and two.
    const five = show.frame === 'five';
    const places = five ? Math.max(5, Math.ceil(show.n / 5) * 5) : show.n;
    const dots = Array.from({ length: places }, (_, i) => (i < show.n ? `<i style="--i:${i}"></i>` : '<i class="lp-empty"></i>')).join('');
    const cols = five ? 5 : Math.min(5, Math.max(1, show.n));
    return `<div class="lp-count" data-lp-count="${show.n}"><div class="lp-dots" style="--lp-cols:${cols}">${dots}</div>`
      + `<div class="lp-thing">${esc(countWords(show.n, show.thing))}</div></div>`;
  }
  if (k === 'picture') return `<div class="lp-picture" data-lp-picture><small>A picture of</small>${esc(show.of)}</div>`;
  if (k === 'row') return `<div class="lp-row">${show.items.map((x, i) => `<span style="--i:${i}">${esc(x)}</span>`).join('')}</div>`;
  if (k === 'chart') {
    const c = (lesson?.charts || []).find((x) => x.id === show.chart);
    if (!c) return '';
    const max = Math.max(...c.rows.map((r) => Math.abs(r.value)), 1);
    return `<div class="lp-bars" role="table" aria-label="${esc(c.title || 'Chart')}">${c.title ? `<b>${esc(c.title)}</b>` : ''}${c.rows.map((r) =>
      `<div class="lp-bar" role="row"><span role="cell">${esc(r.label)}</span><b style="width:${Math.round((Math.abs(r.value) / max) * 100)}%" role="presentation"></b><span role="cell">${esc(r.value)}</span></div>`).join('')}</div>`;
  }
  return '';
}

/** The whole lesson as a page (the Read form). PURE. */
export function readHTML(lesson, look = 'grownup') {
  const notes = [];
  const fn = (cite) => {
    if (!cite || !cite.length) return '';
    notes.push(citeWords(lesson, cite));
    return `<sup class="lp-fn">${notes.length}</sup>`;
  };
  const parts = [`<h2>${esc(lesson.about.title)}</h2>`];
  if (lesson.about.for) parts.push(`<p class="lp-goal">For ${esc(lesson.about.for)}</p>`);
  for (const c of lesson.classes) {
    parts.push(`<h3>${esc(c.title)}</h3>`);
    if (c.goal) parts.push(`<p class="lp-goal">${esc(c.goal)}</p>`);
    for (const b of c.beats) {
      const show = showFor(b.show, look);
      const words = [b.say?.text, show && show.kind !== 'heading' ? `[${showWords(show, lesson)}]` : ''].filter(Boolean).join(' ');
      if (words) parts.push(`<p>${esc(words)}${fn(b.cite)}</p>`);
      if (b.ask) parts.push(`<p><b>${esc(b.ask.question)}</b> ${esc(b.ask.answer)}${b.ask.why ? `. ${esc(b.ask.why)}` : ''}</p>`);
    }
  }
  if (lesson.questions.length) {
    parts.push('<h3>Questions to try</h3><ol>');
    for (const q of lesson.questions) parts.push(`<li>${esc(q.question)} <i>${esc(q.answer)}</i></li>`);
    parts.push('</ol>');
  }
  if (notes.length) parts.push(`<h3>Sources</h3><ol class="lp-fn">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>`);
  return `<article class="lp-read" data-lp-read>${parts.join('')}</article>`;
}

registerModule(
  { type: 'lesson_player', title: 'A lesson', core: 'new', dependsOn: 'local', importance: 'optional',
    description: 'A lesson to watch, step through as slides, or read: Numbers 0 to 9 to begin with.', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const setTimer = ctx.setTimer || ((f, ms) => setTimeout(f, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    let cfg = {};
    let lesson = null, problems = [];
    let beats = [];
    let at = 0;
    let picked = null;          // the answer chosen on the beat showing (Slides), or 'shown' (Watch revealed it)
    let lit = -1;               // the switch's place among the buttons
    let timer = null;
    let dead = false;
    let rootEl = null;
    let lastSaid = '';

    const setting = (k, d) => (cfg[k] === undefined ? d : cfg[k]);
    const form = () => (LESSON_FORMS.includes(cfg.form) ? cfg.form : 'watch');
    const look = () => (LOOKS.includes(cfg.look) ? cfg.look : 'grownup');

    function load() {
      const id = setting('lessonId', BUILTIN_LESSONS[0].id);
      const entry = BUILTIN_LESSONS.find((l) => l.id === id) || BUILTIN_LESSONS[0];
      const r = checkLesson(entry.lesson);
      lesson = r.lesson; problems = r.problems;
      beats = lesson ? beatsOf(lesson) : [];
      at = Math.max(0, Math.min(beats.length, Number(state?.get?.()?.at) || 0));
    }

    function say(text) {
      lastSaid = text || '';
      if (!text || cfg.speak === false) return;
      try {
        if (ctx.output?.say) ctx.output.say(text, { source: 'lesson' });
        else ctx.speak?.(text);
      } catch (e) { console.error('lesson: say', e); }
    }
    const stopTimer = () => { if (timer != null) { clearTimer(timer); timer = null; } };
    function keepAt() { try { state?.set?.({ at }); } catch { /* memory only */ } }

    function go(n) {
      stopTimer();
      at = Math.max(0, Math.min(beats.length, n));
      picked = null; lit = -1;
      keepAt();
      render();
      enter();
    }
    // A beat arrives: said, and in Watch the clock to the next one (a question is asked, then answered, then on).
    function enter() {
      if (dead || form() === 'read') return;
      const b = beats[at]?.beat;
      if (!b) { if (at >= beats.length) say(`That is the end of ${lesson?.about.title || 'the lesson'}.`); return; }
      const words = [b.say?.text, b.ask ? b.ask.question : ''].filter(Boolean).join(' ');
      say(words);
      if (form() !== 'watch') return;
      const hold = Math.max(1000, Number(setting('holdMs', WATCH_HOLD_MS)) || WATCH_HOLD_MS);
      const wait = hold + words.split(/\s+/).filter(Boolean).length * MS_PER_WORD;
      timer = setTimer(() => {
        timer = null;
        if (dead) return;
        if (b.ask && picked == null) {
          // Watch never waits on an answer: it shows and says it, then moves on.
          picked = 'shown'; render(); say(`It is ${b.ask.answer}.${b.ask.why ? ` ${b.ask.why}` : ''}`);
          timer = setTimer(() => { timer = null; if (!dead) go(at + 1); }, hold);
          return;
        }
        go(at + 1);
      }, wait);
    }

    function stageHTML() {
      if (at >= beats.length) {
        return `<div class="lp-stage lp-m-title-rise"><div class="lp-show"><div class="lp-heading">The end</div></div>`
          + `<div class="lp-say">${esc(lesson.about.title)}</div></div>`;
      }
      const { beat: b, klass } = beats[at];
      const show = showFor(b.show, look());
      let ask = '';
      if (b.ask) {
        const answers = answersOf(b.ask);
        if (picked == null && form() === 'slides') {
          ask = `<div class="lp-ask" role="group" aria-label="${esc(b.ask.question)}">${answers.map((a, i) =>
            `<button type="button" data-lp-answer="${esc(a)}"${i === lit ? ' data-lit' : ''}>${esc(a)}</button>`).join('')}</div>`;
        } else if (picked != null) {
          const right = picked === b.ask.answer;
          const words = picked === 'shown' ? `It is ${b.ask.answer}.` : right ? `Yes, ${b.ask.answer}.` : `Not quite: it is ${b.ask.answer}.`;
          ask = `<p class="lp-said" data-lp-result="${picked === 'shown' ? 'shown' : right ? 'right' : 'wrong'}">${esc(words)}${b.ask.why ? ` ${esc(b.ask.why)}` : ''}</p>`;
        } else {
          ask = `<div class="lp-ask">${answers.map((a) => `<button type="button" disabled>${esc(a)}</button>`).join('')}</div>`;
        }
      }
      const cite = b.cite ? `<p class="lp-cite">Source: ${esc(citeWords(lesson, b.cite))}</p>` : '';
      return `<div class="lp-stage${b.move ? ` lp-m-${b.move}` : ''}" data-lp-beat="${at}">
          ${show ? `<div class="lp-show" role="img" aria-label="${esc(showWords(show, lesson))}">${showHTML(show, lesson)}</div>` : ''}
          ${b.say ? `<p class="lp-say">${esc(b.say.text)}</p>` : ''}
          ${b.ask ? `<p class="lp-say"><b>${esc(b.ask.question)}</b></p>` : ''}
          ${ask}${cite}
        </div><span hidden>${esc(klass.title)}</span>`;
    }

    function render() {
      if (dead || !rootEl) return;
      if (!lesson) {
        rootEl.innerHTML = `<div class="lp"><div class="lp-stage"><p>This lesson could not be played.</p><p class="lp-cite">${esc(problems[0] || '')}</p></div></div>`;
        return;
      }
      if (form() === 'read') { rootEl.innerHTML = `<div class="lp" data-lp-form="read">${readHTML(lesson, look())}</div>`; return; }
      const cur = beats[Math.min(at, beats.length - 1)];
      const top = at >= beats.length ? lesson.about.title : `${cur.klass.title}`;
      const count = at >= beats.length ? '' : `${at + 1} of ${beats.length}`;
      const nav = form() === 'slides'
        ? `<div class="lp-nav"><button type="button" data-lp-act="back"${at === 0 ? ' disabled' : ''}>Back</button>`
          + `<button type="button" data-lp-act="${at >= beats.length ? 'again' : 'next'}">${at >= beats.length ? 'Start again' : 'Next'}</button></div>`
        : (at >= beats.length ? '<div class="lp-nav"><button type="button" data-lp-act="again">Start again</button></div>' : '');
      rootEl.innerHTML = `<div class="lp" data-lp-form="${form()}"><div class="lp-top"><span>${esc(top)}</span><span>${esc(count)}</span></div>${stageHTML()}${nav}</div>`;
    }

    function answer(a) {
      const b = beats[at]?.beat;
      if (!b?.ask || picked != null) return;
      picked = a;
      render();
      const right = a === b.ask.answer;
      say(right ? `Yes, ${b.ask.answer}.` : `Not quite. It is ${b.ask.answer}.`);
    }
    function act(name) {
      if (name === 'next') go(at + 1);
      else if (name === 'back') go(at - 1);
      else if (name === 'again') go(0);
    }
    function onClick(e) {
      const t = e.target instanceof Element ? e.target.closest('[data-lp-answer],[data-lp-act]') : null;
      if (!t || !mount.contains(t) || t.disabled) return;
      if (t.dataset.lpAnswer != null) answer(t.dataset.lpAnswer);
      else act(t.dataset.lpAct);
    }
    // A switch: next/prev walk the buttons showing (answers, then Back and Next); select presses the lit one.
    const walk = () => [...mount.querySelectorAll('.lp-ask button:not([disabled]), .lp-nav button:not([disabled])')];
    function moveLit(d) { const n = walk().length; if (!n) return; lit = lit < 0 ? (d > 0 ? 0 : n - 1) : ((lit + d) % n + n) % n; paintLit(); }
    function paintLit() { walk().forEach((b, i) => { if (i === lit) b.dataset.lit = ''; else delete b.dataset.lit; }); }
    function selectLit() { const b = walk()[lit]; if (b) b.click(); else if (form() === 'slides') act(at >= beats.length ? 'again' : 'next'); }

    function apply(s) {
      const was = { ...cfg };
      cfg = { ...(s || {}) };
      if (was.lessonId !== cfg.lessonId && was.lessonId !== undefined) { load(); go(0); return; }
      if (was.form !== cfg.form || was.look !== cfg.look) { stopTimer(); render(); enter(); }
    }

    return {
      __probe: () => ({ at, total: beats.length, form: form(), look: look(), picked, said: lastSaid, problems: problems.slice(), title: lesson?.about.title || '' }),
      init() {
        ensureCss(mount.ownerDocument || document);
        mount.innerHTML = '<div class="lp-root mod-box" style="height:100%" data-lesson-player></div>';
        rootEl = mount.querySelector('[data-lesson-player]');
        mount.addEventListener('click', onClick);
        cfg = { ...(state?.get?.() || {}) };
        load();
        state?.subscribe?.((s) => { if (!dead) apply(s); });
        // The bar's and a switch's verbs (actions.js MODULE_VERBS lesson_player). In Watch nothing waits to be pressed,
        // so next / prev move a part on or back; in Slides they walk the buttons, and select presses the lit one.
        bus?.subscribe?.('lesson/next', () => { if (form() === 'watch') go(at + 1); else moveLit(1); });
        bus?.subscribe?.('lesson/prev', () => { if (form() === 'watch') go(at - 1); else moveLit(-1); });
        bus?.subscribe?.('lesson/select', () => selectLit());
        bus?.subscribe?.('lesson/back', () => go(at - 1));
        render();
        enter();
      },
      onShow() { if (!timer) enter(); },
      onHide() { stopTimer(); try { state?.flush?.(); } catch { /* nothing to do */ } },
      onResize() {},
      destroy() {
        dead = true;
        stopTimer();
        mount.removeEventListener('click', onClick);
        try { ctx.output?.cancel?.(); } catch { /* gone */ }
      },
    };
  },
);
