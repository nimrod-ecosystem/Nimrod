// transcript_quiz.js — QUESTIONS FROM A PASTED TRANSCRIPT, CHECKED AGAINST IT (row 2.24, §0h).
//
// The flow this is the pure half of (Mike, 2026-09-28, register 253/257/258): watch a video in
// Lessons -> paste its transcript -> a local model writes questions -> they are asked right away
// -> after enough are answered, the video's points are paid -> the questions join the long-term
// pool through the existing lesson routing (`modules/lessons.js` `questionsTo`).
//
// *** THE ANSWER KEY COMES FROM THE TRANSCRIPT, AND THAT IS CHECKED, NOT HOPED FOR. *** A model
// asked for questions will also happily invent facts. So every question must carry the line it
// came from (`source_line`), and `grounded()` below — deterministic, no model involved — keeps a
// question only when (1) that line really is in the transcript and (2) the answer's words really
// are in that line. A question that fails is DROPPED and counted as rejected, never quietly kept.
// This is §0h's "grounded-by-construction check", agreed 2026-09-17.
//
// WHAT THIS DOES NOT CHECK, stated so nobody reads more into a pass than is there: that the
// VIDEO is right. The transcript is the evidence; a video can be wrong. Register 258's fact
// check ("the model looks claims up") is NOT BUILT in this pass — its lookup source (Wikipedia's
// API was suggested) is not chosen, and it needs network. Also not built here: checkpoints for
// long videos, notes-first (253), books (2.23's reading log feeds a later version).
//
// Everything here is pure: no DOM, no network, no clock. `modules/lessons.js` is the caller.

import { lengthTells } from './packs.js';
import { worth as mcqWorth } from './mcq_scoring.js';

// ---------------------------------------------------------------------------------------------
// TIMESTAMPS — how long the video was
// ---------------------------------------------------------------------------------------------

// `12:34`, `1:02:03`, with an optional `.5`/`,500` fraction (subtitle files) that is ignored.
const STAMP = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,]\d+)?$/;
const LEADING_STAMP = /^\s*((?:\d{1,2}:)?\d{1,3}:\d{2})(?:[.,]\d+)?(?=\s|$)/;

/** Seconds for one timestamp string, or null when it is not one. */
export function parseTimestamp(text) {
  const m = STAMP.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  if (ss > 59 || (m[1] && mm > 59)) return null;
  return h * 3600 + mm * 60 + ss;
}

// Every timestamp the transcript carries, in seconds.
//
// YouTube's "Show transcript" pastes each stamp ON ITS OWN LINE, with the words on the next. When
// a paste has lines like that, ONLY those count — so a line of speech that merely starts with a
// time ("45:00 minutes later...") cannot stretch the video. A paste with no own-line stamps falls
// back to stamps LEADING a line (`0:05 Hello there`, the other common copy format). A time in the
// middle of a sentence is never read as one.
function stamps(transcript) {
  const lines = String(transcript).split(/\r?\n/);
  const own = lines.map(parseTimestamp).filter((s) => s !== null);
  if (own.length) return own;
  return lines.map((l) => { const m = LEADING_STAMP.exec(l); return m ? parseTimestamp(m[1]) : null; })
    .filter((s) => s !== null);
}

/**
 * The video's length in WHOLE minutes, rounded UP, read from its last (largest) timestamp — or
 * null when there is nothing to read, in which case the UI asks, with MINUTE_CHOICES.
 *
 * Rounded up because the last stamp is where the last line STARTS; the video runs a little past
 * it. The largest stamp rather than the literal last one, so a stray early stamp pasted at the
 * end cannot shrink it. Only `0:00` (no length at all) is null, not 0 — a zero-minute video would
 * pay nothing and require nothing, which is not a real lesson.
 */
export function videoMinutes(transcript) {
  if (typeof transcript !== 'string' || !transcript.trim()) return null;
  const all = stamps(transcript);
  if (!all.length) return null;
  const last = Math.max(...all);
  return last > 0 ? Math.ceil(last / 60) : null;
}

// Offered when a transcript carries no timestamps. A short fixed list rather than a number field,
// for the same reason `settings_fields.js` gives: every stop costs a press on one switch. It is a
// UI convenience, not a rule — any whole number of minutes is legal everywhere else in this file.
export const MINUTE_CHOICES = [3, 5, 10, 15, 20, 30, 45, 60];

/**
 * The transcript as prose: stamps removed (own-line and leading), lines joined. This is what the
 * model is sent — the stamps cost tokens, which on a CPU-only machine is minutes, and a model
 * sent them tends to copy them into its `source_line`. `grounded` normalizes the same way, so a
 * line quoted from this text is found in the original.
 */
export function cleanTranscript(transcript) {
  return String(transcript == null ? '' : transcript).split(/\r?\n/)
    .filter((l) => parseTimestamp(l) === null)
    .map((l) => l.replace(LEADING_STAMP, ''))
    .map((l) => l.trim()).filter(Boolean)
    .join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// THE REQUIREMENT
// ---------------------------------------------------------------------------------------------

/**
 * How many correct answers (or points) a video of `minutes` asks for.
 *
 * *** THE DEFAULT IS CHAT'S PROPOSAL AND IS NOT YET CHOSEN BY MIKE *** (register 258, "1 correct
 * answer per 2 minutes of video, minimum 3": 5 min -> 3, 10 -> 5, 60 -> 30, an estimate, not
 * measured). And Mike, later the same day (register 261.3): "I don't think we should try to set
 * questions per minute too strictly. Some minutes could justify more questions than others." So
 * both numbers are SETTINGS (`modules/lessons.js`), and the model is asked for what the content
 * supports rather than a strict per-minute count — see `buildPrompt`. Chat's other suggestion, a
 * share of the lesson's questions instead of a rate, is not built; this is the seam it would
 * replace.
 */
export function requiredAnswers(minutes, { perMinutes = 2, minimum = 3 } = {}) {
  const rate = Number(perMinutes) > 0 ? Number(perMinutes) : 2;
  const floor = Number(minimum) >= 1 ? Math.floor(Number(minimum)) : 3;
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return floor;
  return Math.max(floor, Math.ceil(m / rate));
}

// ---------------------------------------------------------------------------------------------
// THE PROMPT, AND READING WHAT COMES BACK
// ---------------------------------------------------------------------------------------------

/**
 * Chat-API messages asking for up to `count` questions as strict JSON. `source_line` must be
 * copied verbatim, because `grounded` looks for it. Wrong options of similar length and form to
 * the answer — the length tell (row 2.25) is the easiest way a generated set becomes guessable;
 * `lengthTellsFor` checks the result anyway. "Fewer if the transcript does not support that many"
 * is Mike's register 261.3: the model writes what the content supports.
 */
export function buildPrompt(transcript, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const text = cleanTranscript(transcript);
  const system = [
    'You write multiple-choice quiz questions about a video, using ONLY its transcript.',
    'Every correct answer must be stated in the transcript. Do not use outside knowledge.',
    'Reply with strict JSON only, no prose, in exactly this shape:',
    // `source_line` FIRST, on purpose: a model writes in order, so it picks the sentence and then
    // takes the answer out of it. Measured 2026-09-28 with the answer asked for first, qwen2.5:7b
    // quoted the sentence BEFORE the one holding the answer, and the check rejected all three.
    '{"questions": [{"source_line": "...", "question": "...", "answer": "...", "wrong": ["...", "...", "..."]}]}',
    'For each question: first copy one sentence from the transcript into "source_line", exactly, word for word (verbatim).',
    'Then write a question whose answer is a word or phrase taken from that same sentence.',
    '"answer" should use the same words the transcript uses.',
    // Measured 2026-09-28 (first real run in the Lessons panel): without this, qwen2.5:7b made the
    // WHOLE source sentence the answer ("The taller the bar, the bigger the amount."). That passes
    // the check trivially, and a verbatim sentence among three edited copies is guessable.
    'Keep each answer short: a word or a short phrase, not the whole sentence. The question must not contain the answer.',
    'Prefer questions about the main ideas of the video, not small details.',
    'Write exactly three wrong options of similar length and form to the answer, so length does not give the answer away.',
    'Wrong options must be plausible but clearly wrong according to the transcript.',
  ].join('\n');
  const user = `Write up to ${n} questions (fewer if the transcript does not support that many good ones).\n\n`
    + `TRANSCRIPT:\n${text}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const firstStr = (o, keys) => { for (const k of keys) { const v = str(o[k]); if (v) return v; } return ''; };

// Candidate JSON texts inside a model reply, most likely first: the whole reply, a fenced block,
// then the widest {...} and [...] spans.
function jsonCandidates(text) {
  const t = String(text);
  const out = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) out.push(fence[1]);
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const a = t.indexOf(open); const b = t.lastIndexOf(close);
    if (a >= 0 && b > a) out.push(t.slice(a, b + 1));
  }
  return out;
}

/**
 * Well-formed items from a model reply: `[{ question, answer, wrong: [3], source_line }]`.
 * Tolerant of prose and code fences around the JSON, of a bare array or `{questions: [...]}`, and
 * of the common field-name variants models drift into. Anything malformed is left out; garbage
 * gives `[]`. Never throws.
 */
export function parseQuestions(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  // The first candidate that parses AND holds a list wins — "Sure! [ {...} ]" must not stop at
  // the lone object inside the array just because that also parses.
  let list = [];
  for (const c of jsonCandidates(text)) {
    let data;
    try { data = JSON.parse(c); } catch { continue; }
    const l = Array.isArray(data) ? data
      : (data && typeof data === 'object' && Array.isArray(data.questions)) ? data.questions : null;
    if (l) { list = l; break; }
  }
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const question = firstStr(it, ['question', 'q']);
    const answer = firstStr(it, ['answer', 'correct', 'correct_answer']);
    const source = firstStr(it, ['source_line', 'source', 'quote', 'sourceLine']);
    const rawWrong = [it.wrong, it.wrong_answers, it.distractors, it.incorrect].find(Array.isArray) || [];
    const seen = new Set([answer.toLowerCase()]);
    const wrong = [];
    for (const w of rawWrong) {
      const s = str(w);
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      wrong.push(s);
      if (wrong.length === 3) break;
    }
    if (!question || !answer || !source || wrong.length < 3) continue;
    out.push({ question, answer, wrong, source_line: source });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// *** grounded — THE DETERMINISTIC CHECK ***
// ---------------------------------------------------------------------------------------------

/** Lowercase, punctuation to spaces, whitespace collapsed; `1,500` -> `1500`. */
export function normalizeText(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')            // thousands separators
    .replace(/[‘’']/g, '')               // don't -> dont, on both sides alike
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')           // a full stop is not part of a word; 3.5 stays
    .replace(/\s+/g, ' ').trim();
}

// Words that carry no fact of their own. An answer is checked by its OTHER words; an answer made
// of nothing but these ("It is") has nothing to check and fails. Deliberately small: every word
// added here is a word the check stops looking for.
const STOPWORDS = new Set(('a an the of in on at to for and or by with from is are was were be '
  + 'been it its that this these those as into their they them there than then so which who what '
  + 'about can do does did has have had not no yes very just also').split(' '));

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1000000 };
const numberOf = (w) => (/^\d+(\.\d+)?$/.test(w) ? Number(w)
  : Object.prototype.hasOwnProperty.call(NUMBER_WORDS, w) ? NUMBER_WORDS[w] : null);

// One word "appears" in a line when the line holds the same word, or the same word with or
// without a plain plural ending (-s / -es). Whole words only: "hive" is not in "beehive". This is
// the whole of the fuzziness, on purpose — anything looser starts accepting answers the line does
// not actually give.
function wordIn(word, lineWords) {
  const forms = new Set([word, `${word}s`, `${word}es`]);
  if (word.endsWith('es')) forms.add(word.slice(0, -2));
  if (word.endsWith('s')) forms.add(word.slice(0, -1));
  return lineWords.some((w) => forms.has(w));
}

// A source line shorter than this proves nothing: "six legs" is in a lot of transcripts.
const MIN_SOURCE_WORDS = 3;

/**
 * THE CHECK. `{ ok, reason }`. Passes only when:
 *   1. `source_line`, normalized, appears in the normalized transcript (lines joined, stamps gone,
 *      so a quote spanning YouTube's mid-sentence line breaks is still found), as whole words; and
 *   2. every CONTENT word of the answer (not a stopword) appears in that source line, as a whole
 *      word, allowing only a plain plural ending; and
 *   3. every NUMBER in the answer (digits or a number word, `1,500` = `1500`, `six` = `6`) equals a
 *      number in the source line.
 * Never throws; junk in is `{ ok: false }`.
 */
export function grounded(item, transcript) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'not a question' };
  if (typeof transcript !== 'string' || !transcript.trim()) return { ok: false, reason: 'no transcript' };
  const line = normalizeText(item.source_line);
  const lineWords = line ? line.split(' ') : [];
  if (lineWords.length < MIN_SOURCE_WORDS) return { ok: false, reason: 'the quoted line is too short to check' };
  const whole = ` ${normalizeText(cleanTranscript(transcript))} `;
  if (!whole.includes(` ${line} `)) return { ok: false, reason: 'the quoted line is not in the transcript' };

  const answerWords = normalizeText(item.answer).split(' ').filter(Boolean);
  const content = answerWords.filter((w) => !STOPWORDS.has(w));
  if (!content.length) return { ok: false, reason: 'the answer has no words to check' };

  const lineNumbers = new Set(lineWords.map(numberOf).filter((n) => n !== null));
  for (const w of content) {
    const n = numberOf(w);
    if (n !== null) {
      if (!lineNumbers.has(n)) return { ok: false, reason: `the answer's number "${w}" is not in the quoted line` };
      continue;
    }
    if (!wordIn(w, lineWords)) return { ok: false, reason: `the answer word "${w}" is not in the quoted line` };
  }
  return { ok: true, reason: null };
}

/** Split parsed items into the ones that pass `grounded` and the rejected ones, each with why. */
export function checkQuestions(items, transcript) {
  const passed = []; const rejected = [];
  for (const it of items || []) {
    const v = grounded(it, transcript);
    if (v.ok) passed.push(it); else rejected.push({ item: it, reason: v.reason });
  }
  return { passed, rejected };
}

// ---------------------------------------------------------------------------------------------
// CONVERSION — into the shapes the existing routing already carries
// ---------------------------------------------------------------------------------------------

function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A parsed item as a lesson/pack question: `{ question, correct, answers (shuffled), source }`. */
export function toLessonQuestion(item, rand = Math.random) {
  return {
    question: item.question,
    correct: item.answer,
    answers: shuffle([item.answer, ...item.wrong.slice(0, 3)], rand),
    source: item.source_line,
  };
}

/**
 * A lesson question as the bank-line row `lessons.js` routes to Trivia and Word Forge —
 * `{ question, answer, wrong, topic }`, the shape `questionsFromPack` already produces — plus the
 * `source` line, so a game that knows to can show where the answer came from (§0h, Mike's own
 * addition). A game that doesn't simply ignores the extra field.
 */
export function toRoutedQuestion(lq, topic) {
  return {
    question: lq.question,
    answer: lq.correct,
    wrong: (lq.answers || []).filter((a) => a !== lq.correct),
    topic,
    source: lq.source || '',
  };
}

// FNV-1a, 32-bit, base 36. Not security — an id that is the same for the same text.
function hash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Stable id for a question: the same question on the same topic is the same id, across batches. */
export function questionId(topic, lq) {
  return `tq-${hash(`${topic}|${normalizeText(lq.question)}|${normalizeText(lq.correct)}`)}`;
}

/**
 * Identifies ONE video's transcript on ONE topic, for paying once. Built from the normalized
 * prose, so re-pasting the same transcript (with different line breaks or case) is the same key,
 * and a different transcript is a different one.
 */
export function transcriptKey(topic, transcript) {
  return `${topic}:${hash(normalizeText(cleanTranscript(transcript)))}`;
}

/** Row 2.25's length-tell warnings over a generated set (packs.js's own check, unchanged). */
export function lengthTellsFor(lessonQuestions) {
  return lengthTells({ kind: 'trivia', items: lessonQuestions || [] });
}

// ---------------------------------------------------------------------------------------------
// THE QUIZ — asked right away. A wrong answer never strands anyone.
// ---------------------------------------------------------------------------------------------
//
// Mike (2.24): a wrong answer "shows the explanation and the question comes back later in the same
// session, so the requirement is always reachable". So a wrong answer moves the question to the
// BACK of the queue (it only comes straight back when it is the last one left). One press per
// showing: the explanation is the source line, shown after every answer, right or wrong.
//
// TWO MODES (Mike: "number of correct answers or number of points", a setting; correct answers is
// his default). In points mode a correct answer is worth the SAME ladder Trivia and Word Forge use
// (`mcq_scoring.js`: 1, 0.75, 0.5, 0.25 by misses on that question) rather than a third rule. That
// mode could run out of questions short of the target, so when the queue empties unmet it deals
// the questions again — a fresh pass, misses reset — and the target stays reachable.

/**
 * `questions`: lesson questions each with an `id`. `required` is capped at what the quiz can give
 * (the number of questions), so a model that produced fewer grounded questions than the video's
 * requirement cannot strand anyone.
 */
export function startQuiz(questions, { required = 3, mode = 'correct', rand = Math.random } = {}) {
  const items = {};
  for (const q of questions || []) if (q && q.id && !items[q.id]) items[q.id] = q;
  const ids = Object.keys(items);
  const s = {
    mode: mode === 'points' ? 'points' : 'correct',
    items, rand,
    queue: shuffle(ids, rand),
    misses: {},
    correct: 0, points: 0,
    required: Math.max(1, Math.min(Math.max(1, Math.floor(Number(required) || 1)), ids.length || 1)),
    met: false,
    exhausted: ids.length === 0,
  };
  return s;
}

export function quizCurrent(s) {
  if (!s || s.met || s.exhausted || !s.queue.length) return null;
  return s.items[s.queue[0]] || null;
}

const have = (s) => (s.mode === 'points' ? s.points : s.correct);

/** Answer the current question with the chosen OPTION TEXT. Mutates `s`; returns what happened. */
export function quizAnswer(s, chosen) {
  const q = quizCurrent(s);
  if (!q) return { correct: false, done: true };
  const id = q.id;
  const correct = chosen === q.correct;
  let earned = 0;
  s.queue.shift();
  if (correct) {
    earned = s.mode === 'points' ? mcqWorth(s.misses[id] || 0, 1) : 1;
    s.correct += 1;
    s.points += earned;
    s.misses[id] = 0;
  } else {
    s.misses[id] = (s.misses[id] || 0) + 1;
    s.queue.push(id);                              // back of the line: later, not never
  }
  if (have(s) >= s.required - 1e-9) s.met = true;
  if (!s.met && !s.queue.length) {
    const left = Object.keys(s.items);
    if (left.length) { s.queue = shuffle(left, s.rand); for (const k of left) s.misses[k] = 0; }
    else s.exhausted = true;
  }
  return { correct, earned, correctAnswer: q.correct, source: q.source || '', id, met: s.met };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export function quizProgress(s) {
  const h = have(s);
  const unit = s.mode === 'points' ? 'points' : 'correct answers';
  return { have: h, need: s.required, met: !!s.met, unit,
    text: `${fmt(h)} of ${fmt(s.required)} ${unit} needed` };
}

/**
 * Take a question out of this quiz (somebody flagged it "this looks wrong"). The requirement
 * shrinks to what the rest can still give, so flagging is never a way to get stuck.
 */
export function quizDrop(s, id) {
  if (!s || !s.items[id]) return;
  delete s.items[id];
  s.queue = s.queue.filter((k) => k !== id);
  const left = Object.keys(s.items).length;
  if (s.mode === 'correct') {
    // Already-answered questions are still in `items`; what can still be earned is what has been
    // plus one per question still waiting.
    const possible = s.correct + s.queue.length;
    s.required = Math.max(1, Math.min(s.required, possible || 1));
  } else {
    s.required = Math.max(1, Math.min(s.required, left || 1));
  }
  if (have(s) >= s.required - 1e-9 && s.correct > 0) s.met = true;
  if (!s.met && !s.queue.length) {
    if (left) { s.queue = shuffle(Object.keys(s.items), s.rand); }
    else s.exhausted = true;
  }
}

// ---------------------------------------------------------------------------------------------
// THE REVIEW LOG (§0h) — an append-only stream, like the unlock log, for the same reason
// ---------------------------------------------------------------------------------------------
//
// Generated questions, the verdicts on them, "this looks wrong" flags and the pay-once marker all
// live in ONE well-known, per-PROFILE events stream (`TRANSCRIPT_STREAM`). An append-only log
// rather than a state document for the reason `lessons.js`'s own header gives for unlocks: state
// is last-write-wins, so two people approving on two devices could silently undo each other, and
// there would be no record of who flagged what. The current status is derived: latest event wins.

export const TRANSCRIPT_STREAM = 'transcript-lessons';
export const REVIEW_KINDS = Object.freeze({
  QUESTIONS: 'questions',     // { topic, topicLabel, key, autoApproved, items: [lesson q + id], rejected, model }
  REVIEW: 'review',           // { id, verdict: 'approved' | 'rejected' }
  FLAG: 'flag',               // { id, by: 'player' | 'caregiver', reason? }
  UNFLAG: 'unflag',           // { id }  a person cleared the flag
  PAID: 'paid',               // { topic, key, amount, subject }
});

// The derivation needs events IN THE ORDER THEY HAPPENED, and array order cannot be trusted for
// that (found 2026-09-28): the server's list is OLDEST first (`db.py list_events`, reversed "for
// display"), but `events.js`'s `append` splices a fresh row onto the FRONT (its comment says the
// list is newest first). So a cache that was loaded and then appended to is in neither order. The
// server's `id` is an autoincrementing integer, so events that carry one are sorted by it; ones
// without (test fixtures) keep the order they came in, read as oldest first — the server's order.
function chronological(events) {
  const list = [...(events || [])].filter(Boolean);
  const num = (e) => Number(e.id);
  if (list.length && list.every((e) => Number.isFinite(num(e)))) return list.sort((a, b) => num(a) - num(b));
  return list;
}

/**
 * Every generated question with its current review status:
 * `{ id, topic, topicLabel, key, question, correct, answers, source, status, flagged, flags }`.
 * Status starts 'pending' — the review queue is ON by default (§0h) — or 'approved' when the
 * batch was generated with auto-approve on. Auto-approve is recorded AT GENERATION rather than
 * read at display time, so turning it on later does not silently approve a backlog nobody saw.
 */
export function reviewItems(events) {
  const byId = new Map();
  for (const e of chronological(events)) {
    const d = (e && e.data) || {};
    if (e.kind === REVIEW_KINDS.QUESTIONS) {
      for (const q of Array.isArray(d.items) ? d.items : []) {
        if (!q || !q.id || byId.has(q.id)) continue;       // the first time a question appears counts
        byId.set(q.id, { ...q, topic: d.topic, topicLabel: d.topicLabel || d.topic, key: d.key,
          status: d.autoApproved ? 'approved' : 'pending', flagged: false, flags: [] });
      }
    } else if (e.kind === REVIEW_KINDS.REVIEW) {
      const it = byId.get(d.id);
      if (it && (d.verdict === 'approved' || d.verdict === 'rejected')) it.status = d.verdict;
    } else if (e.kind === REVIEW_KINDS.FLAG) {
      const it = byId.get(d.id);
      if (it) { it.flagged = true; it.flags.push({ by: d.by || 'someone', reason: d.reason || '' }); }
    } else if (e.kind === REVIEW_KINDS.UNFLAG) {
      const it = byId.get(d.id);
      if (it) it.flagged = false;
    }
  }
  return [...byId.values()];
}

/** What joins the long-term pool: approved AND not flagged. A flag holds it out until cleared. */
export function poolFrom(items) {
  return (items || []).filter((i) => i.status === 'approved' && !i.flagged);
}

/**
 * Has this transcript's video already been paid? Either record counts: the `paid` marker in the
 * review log, or a points event tagged `transcript:<key>` — the payment itself. Two, because the
 * points ledger is read through a window (points.js "KNOWN BOUND") and the marker is written
 * second; each covers the other's gap.
 */
export function isPaid(events, key, pointsEvents = []) {
  if (!key) return false;
  if ((events || []).some((e) => e && e.kind === REVIEW_KINDS.PAID && e.data && e.data.key === key)) return true;
  const tag = `transcript:${key}`;
  return (pointsEvents || []).some((e) => e && e.data && Array.isArray(e.data.tags) && e.data.tags.includes(tag));
}
