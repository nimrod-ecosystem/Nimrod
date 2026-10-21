// lesson_file.js - WHAT A LESSON FILE IS, AND THE CHECK EVERY ONE PASSES BEFORE A SCREEN PLAYS IT. Row 2.92.
//
// Mike, 2026-10-15/17: lessons for Taylor, Jamie, himself "and anyone else", made by a person's own AI from a few
// ticked boxes and a topic, "Citing everything of course" - then "Only facts" are cited - and played in whatever form
// the learner likes: read it, slides, an AI teacher, two voices, a room; a rendered video is an option too. The shape
// is chat's (Nimrod_Ecosystem docs/from_chat/lesson_shape_20261016.md, "mostly good" - Mike), and this file is its
// contract: the JSON the drafted prompt asks an AI for (first_two_lessons_20261017.md) is exactly what `checkLesson`
// accepts.
//
// A LESSON IS MEANING, NOT A RECORDING (DECISIONS "content-as-meaning"). It holds no colours, fonts, voices or
// animation code: the screen draws it in its theme and speaks it in its voice, and an animation is a NAME from the
// shared library (MOVES). So one file suits every theme, every screen size and every form.
//
//   lesson = {
//     about:     { title, subject?, for?, length?, length_note?, language? }
//     sources:   [{ id, title, author?, date?, link?, read? }]
//     classes:   [{ title, minutes?, goal?, beats: [beat] }]           (chat's "sections": a course's classes)
//     charts:    [{ id, kind: 'bar'|'line'|'pie'|'stacked', title?, rows: [{ label, value, source? }] }]
//     notes:     ['topic', ...]                                          ([[topic]] names, for a notes folder)
//     questions: [question]                                             (review, in the trivia shape)
//   }
//   beat = { say?, show?, cite?, move?, ask? }          at least one of say / show / ask
//     say:  'words'  or  { text, who? }                 who: 'teacher' | 'a' | 'b' (the two-voice form)
//     show: { kind, ... }                               SHOW_KINDS below; the screen draws it
//     cite: ['s1', ...]                                 source ids; every one must be in `sources`
//     move: 'title-rise'                                one of MOVES; unknown names are a problem, not code
//     ask:  question
//   question = { question, answer, wrong: [3 strings], why? }           (trivia's bank shape)
//
// LOOKS (chat's "look" for Numbers 0 to 9, a question still open for Mike): a show may carry a `looks` object,
// { grownup: {...}, child: {...} }, laid over it for that look. The lesson is the same; the things counted change.
//
// PURE. No DOM, no network: a lesson from anywhere (a pack, a file, an AI's answer) is checked here first.

export const SHOW_KINDS = Object.freeze(['heading', 'numeral', 'count', 'word', 'quote', 'picture', 'chart', 'row']);
// The shared animation library's names (lesson_kit.js MOTION has each theme's feel of them). The drafted prompt
// offers an AI exactly these; a name outside them is reported, and the screen plays the beat with no move.
export const MOVES = Object.freeze(['title-rise', 'slide-in-left', 'bars-grow', 'count-in', 'light-in-turn', 'fade']);
export const LOOKS = Object.freeze(['grownup', 'child']);
/** Does any part of this lesson change with the look? (Only then is "Pictures for" worth offering.) PURE. */
export function lessonHasLooks(lesson) {
  for (const c of lesson?.classes || []) for (const b of c?.beats || []) if (b?.show?.looks && Object.keys(b.show.looks).length) return true;
  return false;
}
export const SAY_WHO = Object.freeze(['teacher', 'a', 'b']);
export const CHART_KINDS = Object.freeze(['bar', 'line', 'pie', 'stacked']);
// Bounds, so a runaway answer cannot fill a screen's memory. Argued, not settings: a "one hour" course is a few
// hundred beats at most; these are an order of magnitude past that.
export const LIMITS = Object.freeze({ classes: 60, beats: 600, sources: 300, text: 2000, count: 20 });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = LIMITS.text) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const sayText = (s) => (typeof s === 'string' ? s : isObj(s) ? s.text : '');

/** A question in the trivia shape, or null with the reason in `why`. PURE. */
export function checkQuestion(q) {
  if (!isObj(q)) return { q: null, why: 'not a question' };
  const question = str(q.question), answer = str(q.answer, 300);
  const wrong = Array.isArray(q.wrong) ? q.wrong.map((w) => str(w, 300)).filter(Boolean) : [];
  if (!question) return { q: null, why: 'a question has no words' };
  if (!answer) return { q: null, why: `"${question.slice(0, 40)}" has no right answer` };
  if (wrong.length < 1) return { q: null, why: `"${question.slice(0, 40)}" has no wrong answers to choose from` };
  if (wrong.some((w) => w.toLowerCase() === answer.toLowerCase())) return { q: null, why: `"${question.slice(0, 40)}" lists its right answer as wrong` };
  return { q: { question, answer, wrong: wrong.slice(0, 3), ...(str(q.why) ? { why: str(q.why) } : {}) }, why: '' };
}

/**
 * Check a lesson. Returns { lesson, problems }: `lesson` is a clean copy the screen can play (null when nothing in it
 * could be), `problems` every reason in plain words, each with where it is ("Class 2, beat 4"). A beat with a problem
 * it can survive (an unknown move, a missing source id) is kept, without the broken part, and the problem is listed.
 * PURE.
 */
// *** READ FORGIVINGLY (row 2.111, chat's note CJ, 2026-10-21). *** "Their field names differ a little (the AIs didn't
// follow the shape exactly), so please read them forgivingly and say what you had to guess." Three Right to repair files
// (docs/from_chat/lessons: Cici's, Claude's, a Sonnet batch) each bent the shape a different way. `forgiveLesson` maps
// what they wrote onto the shape BEFORE the check, and says every guess it made (they are listed with the problems, so a
// person sees what was read how). A file already in the shape comes through untouched, with no guesses. PURE.
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
const firstOf = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return undefined; };
function showFromText(text, charts, guess, at) {
  const s = String(text || '').trim();
  if (!s) return null;
  const quoted = s.match(/['"\u2018\u201c]([^'"\u2019\u201d]{2,120})['"\u2019\u201d]/);
  let m;
  if (/^title\b/i.test(s) && quoted) { guess(`${at}: "${s.slice(0, 50)}" read as a heading, "${quoted[1]}".`); return { kind: 'heading', text: quoted[1] }; }
  if ((m = s.match(/^(?:big number|key word|keyword|definition card|word)\s*:\s*([^.]+(?:\.\d+[^.]*)?)/i))) {
    guess(`${at}: "${s.slice(0, 50)}" read as a key word, "${m[1].trim()}".`); return { kind: 'word', text: m[1].trim() };
  }
  if (/^chart\b/i.test(s) && charts.length) {
    const words = new Set(lc(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    let best = charts[0], score = -1;
    for (const c of charts) {
      const n = lc(`${c.title || ''} ${c.id || ''}`).split(/[^a-z0-9]+/).filter((w) => words.has(w)).length;
      if (n > score) { score = n; best = c; }
    }
    guess(`${at}: "${s.slice(0, 50)}" read as the chart "${best.title || best.id}".`);
    return { kind: 'chart', chart: best.id };
  }
  return { kind: 'picture', of: s.slice(0, 300) };
}
function showFromObject(o, guess, at) {
  if (!isObj(o) || o.kind) return o;
  const k = Object.keys(o)[0];
  const v = o[k];
  const text = Array.isArray(v) ? v.flat().join(', ') : String(v == null ? '' : v);
  const map = { heading: 'heading', title: 'heading', key_word: 'word', keyword: 'word', word: 'word', big_number: 'word',
    number: 'word', quote: 'quote', picture: 'picture', image: 'picture', map: 'picture', diagram: 'picture', chart: 'chart',
    list: 'row', two_columns: 'picture' };
  const kind = map[k];
  if (!kind) return o;
  if (k !== kind) guess(`${at}: "${k}" shown as ${kind === 'row' ? 'a row' : kind === 'picture' ? 'a picture' : `a ${kind}`}.`);
  if (kind === 'chart') return { kind: 'chart', chart: String(v) };
  if (kind === 'row') return { kind: 'row', items: (Array.isArray(v) ? v : [v]).map((x) => String(x)) };
  if (kind === 'picture') return { kind: 'picture', of: k === 'two_columns' && Array.isArray(v) ? v.map((col) => (Array.isArray(col) ? col.join(': ') : col)).join('; ') : (k === 'map' ? `a map: ${text}` : text) };
  return { kind, text };
}
export function forgiveLesson(raw) {
  const guesses = [];
  if (!isObj(raw)) return { raw, guesses };
  const r = JSON.parse(JSON.stringify(raw));
  const guess = (g) => { if (!guesses.includes(g)) guesses.push(g); };
  // about: a topic where a title belongs.
  if (isObj(r.about) && !r.about.title && r.about.topic) { r.about.title = String(r.about.topic); guess('The title was read from "about.topic".'); }
  if (isObj(r.about) && !r.about.for && (r.about.learner || r.about.audience)) {
    r.about.for = String(Array.isArray(r.about.audience) ? r.about.audience.join(', ') : (r.about.learner || r.about.audience));
  }
  // sources: ids given when missing (cited by number: 1 is the first), url / read_date / publisher read where the shape has others.
  const srcIds = [];
  if (Array.isArray(r.sources)) {
    let numbered = false, urls = false, pubs = false;
    r.sources = r.sources.map((s, i) => {
      if (!isObj(s)) return s;
      const o = { ...s };
      if (!o.id) { o.id = `s${i + 1}`; numbered = true; }
      if (!o.link && o.url) { o.link = o.url; urls = true; }
      if (!o.read && o.read_date) o.read = o.read_date;
      if (!o.author && o.publisher) { o.author = o.publisher; pubs = true; }
      srcIds.push(String(o.id));
      return o;
    });
    if (numbered) guess('Sources had no ids: they were numbered s1, s2, ... in order, and a citation by number (1) is that source.');
    if (urls) guess('A source\'s "url" was read as its link.');
    if (pubs) guess('A source\'s publisher was read as its author where it named none.');
  }
  const citeFix = (c) => {
    const list = Array.isArray(c) ? c : c == null || c === '' ? [] : [c];
    return list.map((x) => (typeof x === 'number' || /^\d+$/.test(String(x)) ? `s${Number(x)}` : String(x)));
  };
  // charts: kind from "type"; rows from "data" ([label, value, source?]); an id when missing.
  if (Array.isArray(r.charts)) {
    r.charts = r.charts.map((c, i) => {
      if (!isObj(c)) return c;
      const o = { ...c };
      if (!o.id) { o.id = `c${i + 1}`; guess(`Chart ${i + 1} had no id: called "c${i + 1}".`); }
      if (!o.kind && o.type) { o.kind = lc(o.type).replace(/s$/, ''); guess(`Chart "${o.id}": its "type" (${o.type}) read as its kind.`); }
      if (!Array.isArray(o.rows) && Array.isArray(o.data)) {
        const src = citeFix(o.source_id || o.source || [])[0];
        o.rows = o.data.map((d) => (Array.isArray(d)
          ? { label: String(d[0]), value: parseFloat(String(d[1]).replace(/[^0-9.\-]/g, '')), ...(src ? { source: src } : {}) }
          : isObj(d) ? { label: firstOf(d, ['label', 'name', 'x']), value: Number(firstOf(d, ['value', 'y', 'count'])), source: d.source } : d));
        guess(`Chart "${o.id}": its "data" read as rows (label, number${src ? ', the chart\'s source' : ''}).`);
      }
      return o;
    });
  }
  const charts = Array.isArray(r.charts) ? r.charts.filter(isObj) : [];
  // questions: right_answer / wrong_answers; looked up by id when a beat asks one.
  const qFix = (q) => {
    if (!isObj(q)) return q;
    const o = { ...q };
    if (!o.question && (o.q || o.text)) o.question = o.q || o.text;
    if (!o.answer && (o.right_answer || o.right || o.correct)) o.answer = o.right_answer || o.right || o.correct;
    if (!o.wrong && (o.wrong_answers || o.wrongs)) o.wrong = o.wrong_answers || o.wrongs;
    return o;
  };
  const byId = new Map();
  if (Array.isArray(r.questions)) {
    const before = J2(r.questions);
    r.questions = r.questions.map(qFix);
    for (const q of r.questions) if (isObj(q) && q.id) byId.set(String(q.id), q);
    if (J2(r.questions) !== before) guess('Questions\' "right_answer" / "wrong_answers" read as the answer and the wrong ones.');
  }
  // beats
  if (Array.isArray(r.classes)) {
    r.classes.forEach((c, ci) => {
      if (!isObj(c) || !Array.isArray(c.beats)) return;
      c.beats = c.beats.map((b, bi) => {
        if (!isObj(b)) return b;
        const at = `Class ${ci + 1}, beat ${bi + 1}`;
        const o = { ...b };
        // who says it, and what
        const who = o.who_says_it || (isObj(o.say) ? o.say.who : null);
        const whoKey = (w) => { const x = lc(w); return x === 'a' || x === 'voice a' ? 'a' : x === 'b' || x === 'voice b' ? 'b' : x ? 'teacher' : null; };
        if (isObj(o.say) && o.say.who && !SAY_WHO.includes(o.say.who)) o.say = { ...o.say, who: whoKey(o.say.who) };
        // show
        if (typeof o.show === 'string') o.show = showFromText(o.show, charts, guess, at);
        else if (isObj(o.show) && !o.show.kind) o.show = showFromObject(o.show, guess, at);
        // ask: by id, {q,right,wrong}, or a plain question with no answers (said, not asked)
        if (isObj(o.ask) && o.ask.question_id && byId.has(String(o.ask.question_id))) { o.ask = { ...byId.get(String(o.ask.question_id)) }; guess('A beat asking a question by its id was given that question.'); }
        else if (isObj(o.ask) && o.ask.question_id && !o.ask.question) {
          delete o.ask;
          guess(`${at}: it asks question "${b.ask.question_id}", which is not in the file, so nothing is asked there.`);
        }
        else if (isObj(o.ask)) o.ask = qFix(o.ask);
        else if (typeof o.ask === 'string' && o.ask.trim()) {
          const q = o.ask.trim();
          o.say = o.say || { text: q, ...(who ? { who: whoKey(who) } : {}) };
          if (isObj(o.say) && o.say.text !== q) o.say = { ...o.say, text: `${o.say.text} ${q}` };
          delete o.ask;
          guess(`${at}: a question with no answers to choose from ("${q.slice(0, 40)}") is said, not asked.`);
        }
        if (!o.say && who && o.show && o.show.kind === 'picture') {
          o.say = { text: o.show.of, who: whoKey(who) };
          guess(`${at}: nothing to say, so what it shows is said.`);
        }
        if (o.cite != null) o.cite = citeFix(o.cite);
        delete o.who_says_it; delete o.section;
        return o;
      });
    });
  }
  // notes: [[topic]] names, from sentences, {topic, links}, or {id, title}
  if (Array.isArray(r.notes)) {
    const names = [];
    let changed = false;
    for (const n of r.notes) {
      if (typeof n === 'string') { if (n.length <= 60) names.push(n); else changed = true; continue; }
      if (isObj(n)) {
        changed = true;
        if (n.topic) names.push(String(n.topic));
        if (n.title) names.push(String(n.title));
        for (const l of Array.isArray(n.links) ? n.links : []) names.push(String(l));
      }
    }
    if (changed) guess('Notes were read as topic names (a long sentence is not one, and was left out).');
    r.notes = names;
  }
  return { raw: r, guesses };
}
const J2 = (v) => JSON.stringify(v);

export function checkLesson(input) {
  const problems = [];
  if (!isObj(input)) return { lesson: null, problems: ['This is not a lesson file (it should be one JSON object).'] };
  // Read forgivingly first (above): what an AI wrote close to the shape, mapped onto it, every guess said.
  const { raw, guesses } = forgiveLesson(input);
  for (const g of guesses) problems.push(`Read as: ${g}`);
  const about = isObj(raw.about) ? raw.about : {};
  const title = str(about.title, 200);
  if (!title) problems.push('The lesson has no title (about.title).');
  const sources = [];
  const ids = new Set();
  for (const [i, s] of (Array.isArray(raw.sources) ? raw.sources : []).slice(0, LIMITS.sources).entries()) {
    const id = str(s?.id, 40);
    if (!isObj(s) || !id) { problems.push(`Source ${i + 1} has no id.`); continue; }
    if (ids.has(id)) { problems.push(`Two sources are both called "${id}".`); continue; }
    if (!str(s.title, 300)) problems.push(`Source "${id}" has no title.`);
    ids.add(id);
    sources.push({ id, title: str(s.title, 300), ...(str(s.author, 200) ? { author: str(s.author, 200) } : {}),
      ...(str(s.date, 40) ? { date: str(s.date, 40) } : {}), ...(str(s.link, 600) ? { link: str(s.link, 600) } : {}),
      ...(str(s.read, 40) ? { read: str(s.read, 40) } : {}) });
  }
  const charts = [];
  const chartIds = new Set();
  for (const [i, c] of (Array.isArray(raw.charts) ? raw.charts : []).entries()) {
    const id = str(c?.id, 40);
    if (!isObj(c) || !id) { problems.push(`Chart ${i + 1} has no id.`); continue; }
    const kind = CHART_KINDS.includes(c.kind) ? c.kind : 'bar';
    if (c.kind && !CHART_KINDS.includes(c.kind)) problems.push(`Chart "${id}" asks for a kind there is none of ("${c.kind}"); drawn as bars.`);
    const rows = [];
    for (const r of Array.isArray(c.rows) ? c.rows : []) {
      const label = str(r?.label, 120), value = Number(r?.value);
      if (!label || !Number.isFinite(value)) { problems.push(`Chart "${id}" has a row without a label or a number.`); continue; }
      if (r.source && !ids.has(String(r.source))) problems.push(`Chart "${id}", row "${label}": source "${r.source}" is not in the sources.`);
      rows.push({ label, value, ...(r.source && ids.has(String(r.source)) ? { source: String(r.source) } : {}) });
    }
    if (!rows.length) { problems.push(`Chart "${id}" has no rows.`); continue; }
    chartIds.add(id);
    charts.push({ id, kind, ...(str(c.title, 200) ? { title: str(c.title, 200) } : {}), rows });
  }
  let beatCount = 0;
  const classes = [];
  for (const [ci, c] of (Array.isArray(raw.classes) ? raw.classes : []).slice(0, LIMITS.classes).entries()) {
    const where = `Class ${ci + 1}`;
    if (!isObj(c)) { problems.push(`${where} is not a class.`); continue; }
    const beats = [];
    for (const [bi, b] of (Array.isArray(c.beats) ? c.beats : []).entries()) {
      const at = `${where}, beat ${bi + 1}`;
      if (beatCount >= LIMITS.beats) { problems.push(`More than ${LIMITS.beats} beats: the rest are left out.`); break; }
      const beat = checkBeat(b, at, { ids, chartIds, problems });
      if (beat) { beats.push(beat); beatCount += 1; }
    }
    if (!beats.length) { problems.push(`${where} has nothing in it to show or say.`); continue; }
    const minutes = Number(c.minutes);
    classes.push({ title: str(c.title, 200) || `Part ${ci + 1}`, ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {}),
      ...(str(c.goal, 400) ? { goal: str(c.goal, 400) } : {}), beats });
  }
  if (!classes.length) problems.push('The lesson has no classes with anything in them.');
  const questions = [];
  for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
    const r = checkQuestion(q);
    if (r.q) questions.push(r.q); else problems.push(`Review question: ${r.why}.`);
  }
  const notes = [...new Set((Array.isArray(raw.notes) ? raw.notes : []).map((n) => str(String(n || ''), 80).replace(/^\[\[|\]\]$/g, '')).filter(Boolean))];
  if (!title || !classes.length) return { lesson: null, problems };
  return {
    lesson: {
      about: { title, ...Object.fromEntries(['subject', 'for', 'length', 'length_note', 'language']
        .map((k) => [k, str(about[k], 400)]).filter(([, v]) => v)) },
      sources, classes, charts, notes, questions,
    },
    problems,
  };
}

function checkBeat(b, at, { ids, chartIds, problems }) {
  if (!isObj(b)) { problems.push(`${at} is not a beat.`); return null; }
  const out = {};
  const said = str(sayText(b.say));
  if (said) {
    const who = isObj(b.say) && SAY_WHO.includes(b.say.who) ? b.say.who : null;
    out.say = who ? { text: said, who } : { text: said };
  }
  if (b.show != null) {
    const show = checkShow(b.show, at, { chartIds, problems });
    if (show) out.show = show;
  }
  if (b.ask != null) {
    const r = checkQuestion(b.ask);
    if (r.q) out.ask = r.q; else problems.push(`${at}: ${r.why}.`);
  }
  if (b.move != null) {
    if (MOVES.includes(b.move)) out.move = b.move;
    else problems.push(`${at}: "${b.move}" is not one of the animations (${MOVES.join(', ')}); it plays with none.`);
  }
  if (Array.isArray(b.cite) && b.cite.length) {
    const ok = b.cite.map(String).filter((id) => ids.has(id));
    for (const id of b.cite.map(String).filter((x) => !ids.has(x))) problems.push(`${at} cites "${id}", which is not in the sources.`);
    if (ok.length) out.cite = [...new Set(ok)];
  }
  if (!out.say && !out.show && !out.ask) { problems.push(`${at} has nothing to show, say or ask.`); return null; }
  return out;
}

function checkShow(s, at, { chartIds, problems }) {
  if (!isObj(s) || !SHOW_KINDS.includes(s.kind)) {
    problems.push(`${at}: there is no "${isObj(s) ? s.kind : s}" to show (${SHOW_KINDS.join(', ')}).`);
    return null;
  }
  const base = { kind: s.kind };
  const n = Number(s.n);
  if (s.kind === 'numeral' || s.kind === 'count') {
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.count) { problems.push(`${at}: a ${s.kind} needs a whole number from 0 to ${LIMITS.count}.`); return null; }
    base.n = n;
  }
  if (s.kind === 'count') {
    base.thing = str(s.thing, 60);
    if (s.frame === 'five') base.frame = 'five';
  }
  if (['heading', 'word', 'quote'].includes(s.kind)) {
    const text = str(s.text, 600);
    if (!text) { problems.push(`${at}: a ${s.kind} with no words.`); return null; }
    base.text = text;
    if (s.kind === 'quote' && str(s.by, 200)) base.by = str(s.by, 200);
  }
  if (s.kind === 'picture') {
    // A picture is DESCRIBED (what it shows), never a file: the screen finds or draws one (row 2.92: assets).
    const of = str(s.of, 300);
    if (!of) { problems.push(`${at}: a picture that does not say what it shows.`); return null; }
    base.of = of;
  }
  if (s.kind === 'chart') {
    const id = str(s.chart, 40);
    if (!chartIds.has(id)) { problems.push(`${at}: chart "${id}" is not in the charts.`); return null; }
    base.chart = id;
  }
  if (s.kind === 'row') {
    // A row of items lit one after another (Numbers' "In order"): numerals or words.
    const items = Array.isArray(s.items) ? s.items.map((x) => str(String(x ?? ''), 40)).filter(Boolean).slice(0, 20) : [];
    if (!items.length) { problems.push(`${at}: a row with nothing in it.`); return null; }
    base.items = items;
  }
  if (isObj(s.looks)) {
    const looks = {};
    for (const lk of LOOKS) if (isObj(s.looks[lk])) looks[lk] = { ...(str(s.looks[lk].thing, 60) ? { thing: str(s.looks[lk].thing, 60) } : {}),
      ...(str(s.looks[lk].of, 300) ? { of: str(s.looks[lk].of, 300) } : {}), ...(str(s.looks[lk].text, 600) ? { text: str(s.looks[lk].text, 600) } : {}) };
    if (Object.keys(looks).length) base.looks = looks;
  }
  return base;
}

/** A show with its look laid over it ("grownup" or "child"); the show itself when it has none for that look. PURE. */
export function showFor(show, look = 'child') {
  if (!show || !show.looks || !show.looks[look]) return show;
  const { looks, ...rest } = show;
  return { ...rest, ...looks[look] };
}

/** Every beat in order, with where it is: [{ ci, bi, beat, klass }]. The slides and watch forms walk this. PURE. */
export function beatsOf(lesson) {
  const out = [];
  for (const [ci, c] of (lesson?.classes || []).entries()) for (const [bi, beat] of c.beats.entries()) out.push({ ci, bi, beat, klass: c });
  return out;
}

/** The words for the sources a beat cites ("Repair.org, 2024"), for the line under it. PURE. */
export function citeWords(lesson, cite = []) {
  const by = new Map((lesson?.sources || []).map((s) => [s.id, s]));
  return cite.map((id) => by.get(id)).filter(Boolean).map((s) => [s.author || s.title, s.date].filter(Boolean).join(', ')).join('; ');
}
