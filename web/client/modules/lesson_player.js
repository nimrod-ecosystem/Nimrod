// modules/lesson_player.js - "LESSONS": plays a lesson file (lesson_file.js) as Read, Slides or Watch. Row 2.92.
//
// THE NAME AND THE TYPE (Mike, 2026-10-17): *"I think lessons is the better name. Let's keep that for a name, but use the
// new system we're working on. There was never anything built for the old system."* This registers as 'lessons', the
// type the old topic-cards module had (now parked as modules/lesson_topics.js), so a screen's old Lessons panel opens
// as this one; and as 'lesson_player', its type for its first day, so a panel placed then still opens. It also took
// the old module's one job the games depend on: routing lessons' questions into Trivia and Word Forge (and so Quiz
// mix), and saying when a lesson was finished (below, THE QUESTIONS GO TO THE GAMES).
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
import { TRIVIA_LESSON_QUESTIONS, WORDFORGE_LESSON_QUESTIONS, createLessons, routedLessonQuestions, transcriptPool,
  QUESTIONS_TO, MADE_LESSONS_KEY, madeLessonsFrom } from '../lessons.js';
import { TRANSCRIPT_STREAM } from '../transcript_quiz.js';
import { LESSON_PARTS, CLASS_MINUTES, draftLessonPrompt, lessonFromReply, madeLessonId, TOPIC_MAX, LEARNER_MAX } from '../lesson_prompt.js';
import { createAI } from '../ai.js';

export const LESSON_FORMS = Object.freeze(['watch', 'slides', 'read']);
// How long a beat stays in Watch after its words, at the least (Rule 1: a setting; the words' own time is added).
export const WATCH_HOLD_MS = 4000;
// About how long one spoken word takes, to give the voice time to finish before Watch moves on. Measured on the
// site's own voices, not exactly: a little slower than conversation, which is the pace these voices are set to.
export const MS_PER_WORD = 420;
// How long the AI on this computer is given to write a lesson. The transcript quiz measured a 7B model on a CPU-only
// desktop at 1-4 minutes for three questions; a whole lesson is far more, so the same 15 minutes it defaults to, with
// Cancel on screen the whole time. [A guess, on Mike's list; a setting when anybody needs another.]
export const MAKE_TIMEOUT_MS = 15 * 60 * 1000;

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
  // Carried from the old Lessons (same key, so a screen that chose already keeps its choice); "both" by default, as
  // Mike ruled for it on 2026-09-23. Quiz mix plays what Trivia gets.
  { key: 'questionsTo', label: 'The lessons\u2019 questions also play in', kind: 'choice', default: 'both', level: 'advanced',
    options: [{ value: 'both', label: 'Trivia and Word Forge' }, { value: 'trivia', label: 'Trivia only' },
      { value: 'wordforge', label: 'Word Forge only' }, { value: 'none', label: 'Neither' }] },
];
export { QUESTIONS_TO };

// *** THE QUESTIONS GO TO THE GAMES (taken over from the old Lessons, 2026-10-17). *** Trivia and Word Forge each read
// a profile row of lesson questions (lessons.js TRIVIA_LESSON_QUESTIONS / WORDFORGE_LESSON_QUESTIONS), held back by
// topic until that topic's lesson was finished (lessons.js gate; quest mode; sandbox, the default, opens all). The rows
// are written here, whole, from every built-in lesson's review questions, the topic being the lesson's id and its
// title carried for the round's name, plus the approved transcript questions ("Quiz from a video"), computed in
// lessons.js `routedLessonQuestions` so the two modules writing these rows write the same set. Finishing a lesson (reaching its end, in any form) is "watched" in the same log
// the old module wrote, so in quest mode its questions open then. Written only when what the row holds differs.
/** The rows' items for `to` (lessons.js `routedLessonQuestions`, without the transcript pool). PURE. */
export const routedQuestions = (to = 'both', lessons = BUILTIN_LESSONS) => routedLessonQuestions(to, { lessons });
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
.lp-ask button[data-lit],.lp-nav button[data-lit]{outline:4px solid var(--scan-ring,var(--focus,var(--accent,currentColor)));outline-offset:2px}
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
.lp-make{overflow:auto}
.lp-make-in{max-width:44rem;margin:0 auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;text-align:left}
.lp-make-in h3,.lp-make-in h4{margin:.4em 0 .1em}
.lp-make-f{display:flex;flex-direction:column;gap:4px;font-weight:600}
.lp-make input[type=text],.lp-make select,.lp-make textarea{box-sizing:border-box;width:100%;min-height:44px;padding:8px 10px;border:1px solid var(--border,currentColor);border-radius:8px;background:var(--surface,transparent);color:var(--text);font:inherit;font-weight:400}
.lp-make textarea{resize:vertical;font-size:.85rem}
.lp-make-parts{border:1px solid var(--border,currentColor);border-radius:8px;display:flex;flex-wrap:wrap;gap:6px 16px}
.lp-make-parts label{display:flex;align-items:center;gap:6px;min-height:44px}
.lp-make-row{display:flex;flex-wrap:wrap;gap:8px}
.lp-make-row button{min-height:48px;padding:8px 16px;border-radius:10px;border:2px solid var(--border,currentColor);background:var(--surface,transparent);color:var(--text);font:inherit;cursor:pointer}
.lp-make-row button:disabled{opacity:.55;cursor:default}
.lp-make-problems{margin:0;padding-left:1.2em;font-size:.88rem}
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
export function readHTML(lesson, look = 'grownup', { unchecked = false } = {}) {
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
  // A made lesson's sources are as its AI gave them: nothing here checked them (lesson_prompt.js), and it says so.
  if (notes.length) parts.push(`<h3 data-lp-sources>${unchecked ? 'Sources, as the AI gave them (not checked)' : 'Sources'}</h3>`
    + `<ol class="lp-fn">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>`);
  return `<article class="lp-read" data-lp-read>${parts.join('')}</article>`;
}

function lessonsModule(ctx) {
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
    let finished = false;       // this lesson's end was reached (and told to the log) since it last started over
    let unlocks = null;         // lessons.js's log of finished lessons, made when first needed
    const rows = [];            // the two question rows, to let go of
    let tlog = null;            // the transcript quiz's review log (its approved questions go to the games too)
    let madeRow = null;         // the account's own lessons (lessons.js MADE_LESSONS_KEY)
    let made = [];              // ...read from it
    let unchecked = false;      // the lesson playing is a made one: its sources are as its AI gave them
    let maker = null;           // "Make a new lesson..." while it is open (below); null otherwise
    let aiClient = null;
    let routedPool = null;      // the pool last routed, to route again only when it changes

    const setting = (k, d) => (cfg[k] === undefined ? d : cfg[k]);
    const form = () => (LESSON_FORMS.includes(cfg.form) ? cfg.form : 'watch');
    const look = () => (LOOKS.includes(cfg.look) ? cfg.look : 'grownup');

    const allLessons = () => [...BUILTIN_LESSONS, ...made];
    function load() {
      const id = setting('lessonId', BUILTIN_LESSONS[0].id);
      const entry = allLessons().find((l) => l.id === id) || BUILTIN_LESSONS[0];
      unchecked = !!(entry.made && entry.made.sourcesChecked !== true);
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
      if (at === 0) finished = false;
      keepAt();
      render();
      enter();
      if (at >= beats.length) markFinished();
    }
    // The end reached: "watched", in the log Trivia and Word Forge read (quest mode opens its questions then).
    function markFinished() {
      if (finished || !lesson || typeof ctx.makeEvents !== 'function') return;
      finished = true;
      try {
        unlocks = unlocks || createLessons({ makeEvents: ctx.makeEvents, bus: bus || null });
        Promise.resolve(unlocks.watch(setting('lessonId', BUILTIN_LESSONS[0].id), { label: lesson.about.title }))
          .catch((e) => console.error('lessons: could not note the lesson finished', e));
      } catch (e) { console.error('lessons: could not note the lesson finished', e); }
    }
    function routeQuestions() {
      if (typeof ctx.makeState !== 'function') return;
      const pool = transcriptPool(tlog?.get?.()?.events || []);
      routedPool = JSON.stringify(pool);
      const want = routedLessonQuestions(setting('questionsTo', 'both'), { made, extra: pool });
      for (const [key, items] of [[TRIVIA_LESSON_QUESTIONS, want.trivia], [WORDFORGE_LESSON_QUESTIONS, want.wordforge]]) {
        let row = rows.find((r) => r.__key === key) || null;
        if (!row) {
          try { row = ctx.makeState(key); } catch { row = null; }
          if (!row) continue;
          row.__key = key;
          rows.push(row);
        }
        Promise.resolve(row.load?.()).catch(() => {}).then(() => {
          if (dead) return;
          const has = row.get?.()?.items;
          if (JSON.stringify(has || []) === JSON.stringify(items) && has) return;
          try { row.set?.({ items }); row.flush?.(); } catch (e) { console.error('lessons: could not send questions to the games', e); }
        });
      }
    }
    // A beat arrives: said, and in Watch the clock to the next one (a question is asked, then answered, then on).
    function enter() {
      if (dead || maker || form() === 'read') return;
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
      const cite = b.cite ? `<p class="lp-cite">${unchecked ? 'Source, as the AI gave it (not checked)' : 'Source'}: ${esc(citeWords(lesson, b.cite))}</p>` : '';
      return `<div class="lp-stage${b.move ? ` lp-m-${b.move}` : ''}" data-lp-beat="${at}">
          ${show ? `<div class="lp-show" role="img" aria-label="${esc(showWords(show, lesson))}">${showHTML(show, lesson)}</div>` : ''}
          ${b.say ? `<p class="lp-say">${esc(b.say.text)}</p>` : ''}
          ${b.ask ? `<p class="lp-say"><b>${esc(b.ask.question)}</b></p>` : ''}
          ${ask}${cite}
        </div><span hidden>${esc(klass.title)}</span>`;
    }

    function render() {
      if (dead || !rootEl) return;
      if (maker) { renderMaker(); return; }
      if (!lesson) {
        rootEl.innerHTML = `<div class="lp"><div class="lp-stage"><p>This lesson could not be played.</p><p class="lp-cite">${esc(problems[0] || '')}</p></div></div>`;
        return;
      }
      if (form() === 'read') { rootEl.innerHTML = `<div class="lp" data-lp-form="read">${readHTML(lesson, look(), { unchecked })}</div>`; return; }
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
      const m = e.target instanceof Element ? e.target.closest('[data-lm-act]') : null;
      if (m && mount.contains(m) && !m.disabled) { makerAct(m.dataset.lmAct); return; }
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

    // =================================================================================================================
    // *** MAKE A NEW LESSON (2026-10-17, row 2.92; lesson_prompt.js). *** Opened from the settings menu ("Make a new
    // lesson..."), over the lesson, in this panel. What it is about, who it is for, how long each class is (or the AI
    // decides), and what else to make; the prompt is drafted as they type. Then either copy it to any AI and paste the
    // reply, or ask the AI on this computer. "Check it and keep it": the reply is read and checked (lesson_file.js); a
    // lesson that can be played is kept on the account (lessons.js MADE_LESSONS_KEY) and starts playing here, with every
    // problem the check found listed. Nothing waits on anybody: Close is on screen at every step, a job has Cancel, and
    // the lesson underneath carries on where it was when it is closed.
    // =================================================================================================================
    const ai = () => aiClient || (aiClient = ctx.ai || createAI());
    const draftOf = (m, onComputer = false) => draftLessonPrompt({ topic: m.topic, learner: m.learner, minutes: m.minutes,
      parts: [...m.parts], onComputer });
    function openMaker(mode = 'make') {
      stopTimer();
      try { ctx.output?.cancel?.(); } catch { /* nothing said */ }
      maker = mode === 'remove' ? { mode: 'remove' }
        : { mode: 'make', topic: '', learner: '', minutes: 0, parts: new Set(LESSON_PARTS.filter((p) => p.default).map((p) => p.id)),
          reply: '', how: 'pasted', status: '', problems: [], working: false, controller: null, kept: null };
      render();
      mount.querySelector('[data-lm-field="topic"]')?.focus?.({ preventScroll: true });
    }
    function closeMaker() {
      if (maker?.controller) { try { maker.controller.abort(); } catch { /* gone */ } }
      maker = null;
      render();
      enter();
    }
    function renderMaker() {
      if (maker.mode === 'remove') {
        const cur = made.find((x) => x.id === setting('lessonId', ''));
        rootEl.innerHTML = `<div class="lp lp-make" data-lp-maker="remove"><div class="lp-make-in">
          <h3>Remove \u201c${esc(cur?.label || 'this lesson')}\u201d?</h3>
          <p class="lp-cite">It goes from every screen of this account. Its questions leave Trivia, Word Forge and Quiz mix.</p>
          <div class="lp-make-row"><button type="button" data-lm-act="remove-yes">Remove it</button>
          <button type="button" data-lm-act="close">Keep it</button></div></div></div>`;
        return;
      }
      if (maker.kept) {
        const k = maker.kept;
        rootEl.innerHTML = `<div class="lp lp-make" data-lp-maker="kept"><div class="lp-make-in">
          <h3 data-lm-kept>Kept: \u201c${esc(k.label)}\u201d</h3>
          <p class="lp-cite">It is in \u201cWhich lesson\u201d on every screen of this account. Its sources are as the AI gave them: nothing here checked them.</p>
          ${k.problems.length ? `<p><b>The check found ${k.problems.length === 1 ? 'one thing' : `${k.problems.length} things`} it left out or changed:</b></p>
            <ul class="lp-make-problems" data-lm-problems>${k.problems.slice(0, 30).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p data-lm-problems>The check found nothing wrong.</p>'}
          <div class="lp-make-row"><button type="button" data-lm-act="close">Play it</button></div></div></div>`;
        return;
      }
      const m = maker;
      rootEl.innerHTML = `<div class="lp lp-make" data-lp-maker="make"><div class="lp-make-in">
        <h3>Make a new lesson</h3>
        <label class="lp-make-f">What is it about?
          <input type="text" data-lm-field="topic" maxlength="${TOPIC_MAX}" value="${esc(m.topic)}" placeholder="for example: right to repair"></label>
        <label class="lp-make-f">Who is it for?
          <input type="text" data-lm-field="learner" maxlength="${LEARNER_MAX}" value="${esc(m.learner)}" placeholder="for example: age 13, or a grown-up"></label>
        <label class="lp-make-f">How long is each class?
          <select data-lm-field="minutes">${CLASS_MINUTES.map((n) => `<option value="${n}"${n === m.minutes ? ' selected' : ''}>${n ? `About ${n} minutes` : 'Let the AI decide'}</option>`).join('')}</select></label>
        <fieldset class="lp-make-parts"><legend>Also make</legend>${LESSON_PARTS.map((p) =>
          `<label><input type="checkbox" data-lm-part="${p.id}"${m.parts.has(p.id) ? ' checked' : ''}> ${esc(p.label)}</label>`).join('')}</fieldset>
        <h4>1. Ask an AI</h4>
        <p class="lp-cite">Copy this to an AI you use (such as claude.ai or ChatGPT), or ask the AI on this computer. The one on this computer cannot look things up, so it writes from what it knows.</p>
        <textarea readonly rows="6" data-lm-prompt>${esc(draftOf(m))}</textarea>
        <div class="lp-make-row"><button type="button" data-lm-act="copy">Copy the prompt</button>
          <button type="button" data-lm-act="computer"${m.working ? ' disabled' : ''}>Ask the AI on this computer</button>
          ${m.working ? '<button type="button" data-lm-act="cancel">Cancel</button>' : ''}</div>
        <p class="lp-cite" data-lm-status role="status">${esc(m.status)}</p>
        <h4>2. Paste what it wrote</h4>
        <textarea rows="6" data-lm-reply placeholder="Paste the AI's answer here">${esc(m.reply)}</textarea>
        ${m.problems.length ? `<ul class="lp-make-problems" data-lm-problems role="alert">${m.problems.slice(0, 12).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <div class="lp-make-row"><button type="button" data-lm-act="keep"${m.working ? ' disabled' : ''}>Check it and keep it</button>
          <button type="button" data-lm-act="close">Close</button></div></div></div>`;
    }
    // Typing changes the prompt in place (never a rebuild, so the field keeps its focus).
    function onMakerInput(e) {
      if (!maker || maker.mode !== 'make') return;
      const t = e.target;
      if (!(t instanceof Element) || !mount.contains(t)) return;
      if (t.matches('[data-lm-field="topic"]')) maker.topic = t.value;
      else if (t.matches('[data-lm-field="learner"]')) maker.learner = t.value;
      else if (t.matches('[data-lm-field="minutes"]')) maker.minutes = Number(t.value) || 0;
      else if (t.matches('[data-lm-part]')) { if (t.checked) maker.parts.add(t.dataset.lmPart); else maker.parts.delete(t.dataset.lmPart); }
      else if (t.matches('[data-lm-reply]')) { maker.reply = t.value; maker.how = 'pasted'; return; }
      else return;
      const box = mount.querySelector('[data-lm-prompt]');
      if (box) box.value = draftOf(maker);
    }
    function setStatus(text) {
      if (!maker) return;
      maker.status = text;
      const s = mount.querySelector('[data-lm-status]');
      if (s) s.textContent = text;
    }
    async function askComputer() {
      const m = maker;
      if (!m || m.working) return;
      if (!String(m.topic).trim()) { setStatus('Say what the lesson is about first.'); mount.querySelector('[data-lm-field="topic"]')?.focus?.(); return; }
      m.working = true;
      m.controller = typeof AbortController === 'function' ? new AbortController() : null;
      m.status = 'Writing the lesson with the AI on this computer\u2026 On a computer without a graphics card this can take several minutes.';
      render();
      let r;
      try {
        r = await ai().chat([{ role: 'user', content: draftOf(m, true) }],
          { json: true, temperature: 0.3, timeoutMs: MAKE_TIMEOUT_MS, contextTokens: 8192, signal: m.controller?.signal });
      } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
      if (maker !== m) return;                 // closed while it worked
      m.working = false; m.controller = null;
      if (!r || !r.ok) { m.status = r?.cancelled ? 'Stopped.' : `The AI on this computer did not answer: ${r?.reason || 'no reason given'}`; render(); return; }
      m.reply = r.text || ''; m.how = 'computer';
      m.status = `Written${r.model ? ` by ${r.model}` : ''}. Checking it\u2026`;
      render();
      keepReply();
    }
    function keepReply() {
      const m = maker;
      if (!m || m.mode !== 'make') return;
      const box = mount.querySelector('[data-lm-reply]');
      if (box) m.reply = box.value;
      const r = lessonFromReply(m.reply);
      if (!r.lesson) { m.problems = r.problems.length ? r.problems : ['No lesson could be read.']; render(); return; }
      const label = r.lesson.about.title;
      const id = madeLessonId(label, allLessons().map((l) => l.id));
      const item = { id, label, lesson: r.lesson, made: { how: m.how, at: new Date().toISOString(), sourcesChecked: false } };
      made = [...made, item];
      try { madeRow?.set?.({ items: made.map(({ id: i, label: l, lesson: ls, made: md }) => ({ id: i, label: l, lesson: ls, made: md })) }); madeRow?.flush?.(); }
      catch (err) { console.error('lessons: could not keep the lesson', err); }
      m.kept = { label, problems: r.problems };
      try { state?.set?.({ lessonId: id, at: 0 }); } catch { /* memory only */ }
      cfg = { ...cfg, lessonId: id };
      load(); at = 0; picked = null; lit = -1; finished = false;
      routeQuestions();
      render();
    }
    function removeCurrent() {
      const id = setting('lessonId', '');
      made = made.filter((x) => x.id !== id);
      try { madeRow?.set?.({ items: made }); madeRow?.flush?.(); } catch (err) { console.error('lessons: could not remove the lesson', err); }
      try { state?.set?.({ lessonId: BUILTIN_LESSONS[0].id, at: 0 }); } catch { /* memory only */ }
      cfg = { ...cfg, lessonId: BUILTIN_LESSONS[0].id };
      load(); at = 0;
      routeQuestions();
      closeMaker();
    }
    function makerAct(name) {
      if (name === 'close') closeMaker();
      else if (name === 'keep') keepReply();
      else if (name === 'computer') askComputer();
      else if (name === 'cancel') { try { maker?.controller?.abort(); } catch { /* gone */ } }
      else if (name === 'remove-yes') removeCurrent();
      else if (name === 'copy') {
        const text = draftOf(maker);
        const box = mount.querySelector('[data-lm-prompt]');
        const fallback = () => { try { box?.focus(); box?.select(); } catch { /* nothing to select */ } setStatus('Selected: press Ctrl+C (or \u2318C) to copy it.'); };
        try {
          const p = navigator.clipboard?.writeText?.(text);
          if (p && typeof p.then === 'function') p.then(() => setStatus('Copied. Paste it into your AI, then paste its answer below.'), fallback);
          else fallback();
        } catch { fallback(); }
      }
    }
    // A made lesson, read from the account's row; the lesson playing reloads if it was one and it changed.
    function readMade() {
      const next = madeLessonsFrom(madeRow?.get?.());
      const changed = JSON.stringify(next.map((x) => x.id)) !== JSON.stringify(made.map((x) => x.id));
      made = next;
      if (!changed) return;
      const id = setting('lessonId', BUILTIN_LESSONS[0].id);
      if (!maker && (made.some((x) => x.id === id) || !allLessons().some((x) => x.id === id) || lesson?.about.title !== (allLessons().find((x) => x.id === id)?.lesson?.about?.title))) {
        load(); render(); stopTimer(); enter();
      }
      routeQuestions();
    }

    function apply(s) {
      const was = { ...cfg };
      cfg = { ...(s || {}) };
      if (was.questionsTo !== cfg.questionsTo && was.questionsTo !== undefined) routeQuestions();
      if (was.lessonId !== cfg.lessonId && was.lessonId !== undefined) { load(); if (maker) return; go(0); return; }
      if (was.form !== cfg.form || was.look !== cfg.look) { stopTimer(); render(); enter(); }
    }

    return {
      __probe: () => ({ at, total: beats.length, form: form(), look: look(), picked, said: lastSaid, problems: problems.slice(), title: lesson?.about.title || '',
        unchecked, made: made.map((x) => x.id), maker: maker ? (maker.kept ? 'kept' : maker.mode) : null }),
      init() {
        ensureCss(mount.ownerDocument || document);
        mount.innerHTML = '<div class="lp-root mod-box" style="height:100%" data-lesson-player></div>';
        rootEl = mount.querySelector('[data-lesson-player]');
        mount.addEventListener('click', onClick);
        mount.addEventListener('input', onMakerInput);
        mount.addEventListener('change', onMakerInput);
        cfg = { ...(state?.get?.() || {}) };
        if (typeof ctx.makeState === 'function') {
          try {
            madeRow = ctx.makeState(MADE_LESSONS_KEY);
            made = madeLessonsFrom(madeRow?.get?.());
            madeRow?.subscribe?.(() => { if (!dead) readMade(); });
            Promise.resolve(madeRow?.load?.()).catch(() => {}).then(() => { if (!dead) { madeRow?.startPolling?.(); readMade(); } });
          } catch { madeRow = null; }
        }
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
        if (at >= beats.length) finished = true;   // it opened at the end: told already, when it got there
        // The transcript quiz's approved questions ride along (lessons.js routedLessonQuestions): read its review log,
        // route once it is in, and again whenever its approved pool changes.
        if (typeof ctx.makeEvents === 'function') {
          try {
            tlog = ctx.makeEvents(TRANSCRIPT_STREAM, { limit: 1000, pollMs: 15000 });
            tlog.subscribe?.(() => { if (!dead && JSON.stringify(transcriptPool(tlog.get?.()?.events || [])) !== routedPool) routeQuestions(); });
            Promise.resolve(tlog.load?.()).catch(() => {}).then(() => { if (!dead) { tlog.startPolling?.(); routeQuestions(); } });
          } catch { tlog = null; routeQuestions(); }
        } else routeQuestions();
      },
      onShow() { if (!timer) enter(); },
      // "Which lesson" offers the account's own lessons too (board.js's pattern: what only the mounted panel knows).
      settingsChoices: () => ({ lessonId: allLessons().map((l) => ({ value: l.id, label: l.made ? `${l.label} (made)` : l.label })) }),
      // The maker, from the one menu (row 2.95). `closesMenu`: it opens over the lesson.
      menuItems: () => {
        const cur = made.find((x) => x.id === setting('lessonId', ''));
        return [
          { kind: 'item', id: 'lesson-make', label: 'Make a new lesson…', closesMenu: true,
            hint: 'drafts what to ask an AI, then keeps what it writes', run: () => openMaker('make') },
          ...(cur ? [{ kind: 'item', id: 'lesson-remove', label: 'Remove this lesson…', closesMenu: true,
            hint: `“${cur.label}”, made on this account`, run: () => openMaker('remove') }] : []),
        ];
      },
      onHide() { stopTimer(); try { state?.flush?.(); } catch { /* nothing to do */ } },
      onResize() {},
      destroy() {
        dead = true;
        stopTimer();
        mount.removeEventListener('click', onClick);
        mount.removeEventListener('input', onMakerInput);
        mount.removeEventListener('change', onMakerInput);
        if (maker?.controller) { try { maker.controller.abort(); } catch { /* gone */ } }
        try { madeRow?.destroy?.(); } catch { /* gone */ }
        try { ctx.output?.cancel?.(); } catch { /* gone */ }
        for (const r of rows) { try { r.destroy?.(); } catch { /* gone */ } }
        try { unlocks?.destroy?.(); } catch { /* gone */ }
        try { tlog?.destroy?.(); } catch { /* gone */ }
      },
    };
}

const MANIFEST = { title: 'Lessons', core: 'new', dependsOn: 'local', importance: 'optional',
  description: 'A lesson to watch, step through as slides, or read: Numbers 0 to 9 to begin with.', settings: SETTINGS };
registerModule({ type: 'lessons', ...MANIFEST }, lessonsModule);
// Its type for its first day (2026-10-17): kept so a panel placed then still opens. Unlisted (modules_catalog.js).
registerModule({ type: 'lesson_player', ...MANIFEST }, lessonsModule);
