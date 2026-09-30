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
// WHAT `grounded` DOES NOT CHECK, stated so nobody reads more into a pass than is there: that the
// VIDEO is right. The transcript is the evidence; a video can be wrong. That is register 258's
// FACT CHECK, below (`factCheck`, built 2026-09-28 with Wikipedia as the source, Mike's pick): the
// question is looked up, and a question Wikipedia seems to contradict is FLAGGED — held out of the
// pool until a person looks. It never rewrites the answer key. Not built here: checkpoints for
// long videos, notes-first (253), books (2.23's reading log feeds a later version).
//
// Everything here is pure: no DOM, no network, no clock. `modules/lessons.js` is the caller. The
// one async function, `factCheck`, is handed its lookup and its model as functions and touches
// neither the network nor the page itself.

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
 * *** MIKE'S RULE, 2026-09-29 (row 2.24): *** "default to 1 per minute for the first 5 minutes and
 * one for every two and a half minutes after that." So 3 min -> 3, 5 -> 5, 10 -> 7, 17 -> 9,
 * 60 -> 27. A PARTIAL later stretch adds nothing (17 min = 5 + 12 min, and 12 / 2.5 is 4.8 -> 4):
 * "one for every two and a half minutes" is read as whole stretches, so a question is never owed
 * for time the video did not run. Every number is a setting (`modules/lessons.js`); `minimum`
 * defaults to 1 because Mike's rule has no floor (chat's earlier "minimum 3" would have made a
 * 1-minute clip owe 3). The requirement is ALSO capped at the questions that were actually written
 * (`startQuiz`), so it is always reachable.
 *
 * This is how many the student must get RIGHT. How many the model WRITES is not derived from it at
 * all (Mike, same day: "I didn't want a number like that put on the amount of questions made") —
 * see `buildPrompt` and `splitTranscript`.
 *
 *   firstMinutes  the opening stretch at the faster rate (0 = none)       default 5
 *   firstEvery    one per this many minutes in that stretch                default 1
 *   perMinutes    one per this many minutes after it                       default 2.5
 *   minimum       never fewer than this                                    default 1
 */
export function requiredAnswers(minutes, { firstMinutes = 5, firstEvery = 1, perMinutes = 2.5, minimum = 1 } = {}) {
  const pos = (v, dflt) => (Number(v) > 0 ? Number(v) : dflt);
  const opening = Number(firstMinutes) >= 0 && Number.isFinite(Number(firstMinutes)) ? Number(firstMinutes) : 5;
  const early = pos(firstEvery, 1);
  const later = pos(perMinutes, 2.5);
  const floor = Number(minimum) >= 1 ? Math.floor(Number(minimum)) : 1;
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return floor;
  // A hair of tolerance, so 7.5 / 2.5 is 3 and not 2.9999…
  const whole = (x) => Math.floor(x + 1e-9);
  const count = whole(Math.min(m, opening) / early) + whole(Math.max(0, m - opening) / later);
  return Math.max(floor, count);
}

/**
 * The transcript in pieces the model can actually read, as cleaned prose (`cleanTranscript`).
 *
 * *** WHY, MEASURED 2026-09-29: *** Ollama on this desktop runs with a 4,096-token context window
 * (its own server log: "vram-based default context … default_num_ctx=4096" on a machine with no
 * graphics card). The prompt, the transcript and the questions written back all share it, and a
 * transcript that does not fit is cut SILENTLY — questions would only ever cover the start. That
 * is `§long-transcript-context`. Pieces of `maxWords` (default 900, roughly six minutes of speech,
 * about 1,200 tokens, leaving room for the prompt and the answer) keep every part of the video in
 * front of the model. A setting, because a model with a bigger window wants bigger pieces.
 *
 * Split at sentence ends where the transcript has them; auto-generated captions often have none,
 * so a run with no sentence end inside the limit is cut between words. A piece is always a
 * contiguous run of the cleaned text, so a line quoted from it is found by `grounded` in the whole.
 */
export function splitTranscript(transcript, { maxWords = 900 } = {}) {
  const text = cleanTranscript(transcript);
  if (!text) return [];
  const limit = Number(maxWords) >= 50 ? Math.floor(Number(maxWords)) : 900;
  const words = text.split(' ');
  if (words.length <= limit) return [text];
  const pieces = [];
  let at = 0;
  while (at < words.length) {
    let end = Math.min(words.length, at + limit);
    if (end < words.length) {
      // Back up to the last sentence end in the second half of the piece, if there is one.
      for (let i = end - 1; i > at + Math.floor(limit / 2); i--) {
        if (/[.!?]["'”’)]?$/.test(words[i])) { end = i + 1; break; }
      }
    }
    pieces.push(words.slice(at, end).join(' '));
    at = end;
  }
  return pieces;
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
 *
 * `count` is now OPTIONAL and normally absent (Mike, 2026-09-29: no number derived from the video's
 * length on the questions MADE). Absent, the model is asked for as many good questions as the text
 * supports; given (the "Most questions to write" setting), it is a ceiling, never a target.
 * `{ part, parts }` tells the model it is reading one piece of a longer transcript.
 */
export function buildPrompt(transcript, count = null, { part = 0, parts = 0 } = {}) {
  const n = Number(count) >= 1 && Number.isFinite(Number(count)) ? Math.floor(Number(count)) : 0;
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
  const ask = n
    ? `Write up to ${n} questions (fewer if the transcript does not support that many good ones).`
    : 'Write as many good questions as this transcript supports: one for each idea worth asking about, and none as filler.';
  const piece = parts > 1 ? `\nThis is part ${part} of ${parts} of a longer transcript; ask only about this part.` : '';
  const user = `${ask}${piece}\n\nTRANSCRIPT:\n${text}`;
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
// Every complete `{...}` in `text` that parses and looks like a question (has a `question` or
// `q`), innermost first — the outer `{"questions": [` of a cut-off answer never closes, so only
// the finished items come back. Quotes and escapes are tracked so a brace inside a string is text.
function completeObjects(text) {
  const out = [];
  const starts = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') starts.push(i);
    else if (ch === '}' && starts.length) {
      const from = starts.pop();
      try {
        const o = JSON.parse(text.slice(from, i + 1));
        if (o && typeof o === 'object' && !Array.isArray(o) && ('question' in o || 'q' in o)) out.push(o);
      } catch { /* not a finished object */ }
    }
  }
  return out;
}

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
  // *** A CUT-OFF ANSWER (measured 2026-09-29). *** Asked for as many questions as a piece
  // supports, qwen2.5:7b wrote 1,000+ tokens for one 900-word piece, and prompt + answer share a
  // 4,096-token window here — so an answer can end mid-JSON and nothing above parses. Every
  // question object that did FINISH is still a good question: keep those.
  if (!list.length) list = completeObjects(text);
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
// *** THE FACT CHECK (register 258) — the video's answer against Wikipedia ***
// ---------------------------------------------------------------------------------------------
//
// Four outcomes, and only one of them does anything:
//   'supports'     Wikipedia gives the same answer.                      Nothing happens.
//   'contradicts'  Wikipedia gives an answer that cannot also be right.  The question is FLAGGED.
//   'not-covered'  The articles found do not answer the question.        Nothing happens.
//   'not-checked'  Wikipedia or the model could not be reached, or the check was stopped.
//                  NOT the same as wrong — nothing happens, and it says "not checked".
//
// *** THE MODEL IS NOT SHOWN THE VIDEO'S ANSWER, and that is measured, not a hunch. *** The
// obvious prompt — "here is the text, here is the answer, does the text support, contradict or not
// cover it?" — was tried first, in four wordings, on qwen2.5:7b (the model on this desktop),
// 2026-09-28. With the answer in front of it the model went LOOKING FOR THE ANSWER: for "capital
// of Australia -> Sydney" it said "not covered" with "Canberra, the capital city of Australia" in
// its own passages, and for "legs on an insect -> eight" it said "not covered" (once "supports")
// with "three pairs of jointed legs" in them. Asked the question WITHOUT the answer, the same model
// quoted exactly those sentences and answered "Canberra" and "six". So the check is two steps:
//   1. the model answers the question from the Wikipedia text alone, quoting the sentence it used
//      (`buildFactPrompt`). The quote must really be in the article (`quoteSource`, the same spirit
//      as `grounded`) or the answer is not used — "not covered";
//   2. its answer is compared with the video's: deterministically first (`sameAnswer`: the same
//      words or numbers means "supports", no model needed), and only when the words differ, by a
//      second, short model turn that sees the two answers side by side without being told which
//      came from where (`buildComparePrompt`) — "writing" and "to write" are the same answer,
//      "Sydney" and "Canberra" are not, and only a model can tell those apart.
// The record keeps the quote, the article's title and link, Wikipedia's answer and a reason, so a
// person reviewing a flag sees the evidence, not just a verdict.

export const FACT = Object.freeze({
  SUPPORTS: 'supports', CONTRADICTS: 'contradicts', NOT_COVERED: 'not-covered', NOT_CHECKED: 'not-checked',
});

/** Chat messages: answer `question` from the articles' text ALONE, quoting the sentence used. */
export function buildFactPrompt(question, articles) {
  const system = [
    'You answer one quiz question using ONLY the Wikipedia passages given. Do not use your own knowledge.',
    'Reply with strict JSON only, in exactly this shape:',
    '{"quote": "...", "answer": "..."}',
    '"quote": the sentence from the passages that answers the question, copied exactly, word for word.',
    '"answer": the answer according to that sentence, in a few words.',
    'If no sentence in the passages answers the question, reply {"quote": "", "answer": ""}.',
  ].join('\n');
  const passages = (articles || []).map((a) => `[${a.title}]\n${a.text || a.extract || ''}`).join('\n\n');
  return [{ role: 'system', content: system },
    { role: 'user', content: `PASSAGES:\n${passages}\n\nQUESTION: ${String(question || '').trim()}` }];
}

function firstJSONObject(text) {
  for (const c of jsonCandidates(text)) {
    try { const d = JSON.parse(c); if (d && typeof d === 'object' && !Array.isArray(d)) return d; } catch { /* next */ }
  }
  return null;
}

/** `{ quote, answer }` from the first step's reply; both '' when nothing can be read. Never throws. */
export function parseFactReply(text) {
  const d = typeof text === 'string' && text.trim() ? firstJSONObject(text) : null;
  if (!d) return { quote: '', answer: '' };
  return { quote: firstStr(d, ['quote', 'sentence', 'source', 'source_line']),
           answer: firstStr(d, ['answer', 'passage_answer', 'wikipedia_answer']) };
}

/**
 * The article a quote really comes from, or null. Normalized the same way `grounded` compares a
 * source line with a transcript (case, punctuation, `1,500` = `1500`), as whole words, against the
 * article's FULL introduction — not the trimmed copy the model read, so a "quote" stitched from
 * two sentences that are not next to each other on Wikipedia does not pass. Shorter than three
 * words proves nothing.
 */
export function quoteSource(quote, articles) {
  const q = normalizeText(quote);
  if (!q || q.split(' ').length < MIN_SOURCE_WORDS) return null;
  for (const a of articles || []) {
    const whole = ` ${normalizeText(a && (a.extract || a.text))} `;
    if (whole.includes(` ${q} `)) return a;
  }
  return null;
}

const NEGATION = /\b(not|no|never|none|neither|nor)\b/;

/**
 * Do two short answers say the same thing, by their words? True when every content word (and
 * every number, `six` = `6`) of one is in the other, allowing a plain plural — "nectar" and
 * "floral nectar", "Canberra" and "Canberra". False means "cannot tell from the words", never
 * "different": "writing" and "to write" are false here and the same answer. A negation on either
 * side is always false here (a model decides), since "not Canberra" holds every word of "Canberra".
 */
export function sameAnswer(a, b) {
  const na = normalizeText(a); const nb = normalizeText(b);
  if (!na || !nb || NEGATION.test(na) || NEGATION.test(nb)) return false;
  const within = (x, y) => {
    const content = x.split(' ').filter((w) => w && !STOPWORDS.has(w));
    if (!content.length) return false;
    const ys = y.split(' ');
    const nums = new Set(ys.map(numberOf).filter((n) => n !== null));
    return content.every((w) => (numberOf(w) !== null ? nums.has(numberOf(w)) : wordIn(w, ys)));
  };
  return within(na, nb) || within(nb, na);
}

/** Chat messages: do two answers to `question` mean the same? Neither is labelled with its source. */
export function buildComparePrompt(question, answerA, answerB) {
  const system = [
    'You compare two short answers to the same quiz question.',
    'Reply with strict JSON only, in exactly this shape:',
    '{"reason": "...", "same": "yes" | "no" | "unsure"}',
    'First "reason": one short sentence. Then "same":',
    '"yes": they mean the same thing, or one is a more exact form of the other.',
    '"no": they cannot both be right answers to this question.',
    '"unsure": anything else.',
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content:
    `QUESTION: ${String(question || '').trim()}\nANSWER A: ${String(answerA || '').trim()}\nANSWER B: ${String(answerB || '').trim()}` }];
}

/** `{ same: 'yes' | 'no' | 'unsure', reason }` from the second step's reply. Unreadable is 'unsure'. */
export function parseCompareReply(text) {
  const d = typeof text === 'string' && text.trim() ? firstJSONObject(text) : null;
  if (!d) return { same: 'unsure', reason: '' };
  const v = d.same;
  const s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : str(v).toLowerCase();
  return { same: s === 'yes' || s === 'true' ? 'yes' : s === 'no' || s === 'false' ? 'no' : 'unsure',
           reason: firstStr(d, ['reason', 'why']) };
}

/**
 * Check one question. `lookup(question, answer)` resolves as wikipedia.js's `lookup` does;
 * `chat(messages)` as ai.js's `chat` does (the caller binds the model, timeout and Cancel).
 * Resolves `{ verdict, reason, quote, title, url, wikipediaAnswer, cancelled? }`. Never throws:
 * anything unexpected is 'not-checked', because a check that broke has not checked anything.
 */
export async function factCheck({ question, answer } = {}, { lookup, chat, signal } = {}) {
  const base = { quote: '', title: '', url: '', wikipediaAnswer: '' };
  const stopped = () => ({ ...base, verdict: FACT.NOT_CHECKED, reason: 'Stopped before it was checked.', cancelled: true });
  const notChecked = (reason) => ({ ...base, verdict: FACT.NOT_CHECKED, reason });
  try {
    if (signal?.aborted) return stopped();
    const found = await lookup(question, answer);
    if (found?.cancelled || signal?.aborted) return stopped();
    if (!found || !found.ok) return notChecked((found && found.reason) || 'Could not reach Wikipedia, so this was not checked.');
    const articles = Array.isArray(found.articles) ? found.articles : [];
    if (!articles.length) return { ...base, verdict: FACT.NOT_COVERED, reason: 'Wikipedia had no article that matched this question.' };

    const r1 = await chat(buildFactPrompt(question, articles));
    if (r1?.cancelled || signal?.aborted) return stopped();
    if (!r1 || !r1.ok) return notChecked(`The AI could not check this: ${(r1 && r1.reason) || 'no answer'}`);
    const got = parseFactReply(r1.text);
    const src = got.quote && got.answer ? quoteSource(got.quote, articles) : null;
    if (!src) {
      return { ...base, verdict: FACT.NOT_COVERED, reason: got.quote && got.answer
        ? 'The AI quoted a sentence that is not in the Wikipedia article, so its answer was not used.'
        : 'The Wikipedia articles found do not answer this question.' };
    }
    const found1 = { quote: got.quote, title: src.title, url: src.url, wikipediaAnswer: got.answer };
    if (sameAnswer(answer, got.answer)) {
      return { ...found1, verdict: FACT.SUPPORTS, reason: `Wikipedia gives the same answer: ${got.answer}.` };
    }
    const r2 = await chat(buildComparePrompt(question, answer, got.answer));
    if (r2?.cancelled || signal?.aborted) return stopped();
    if (!r2 || !r2.ok) {
      return { ...found1, verdict: FACT.NOT_CHECKED,
        reason: `The AI could not compare the answers: ${(r2 && r2.reason) || 'no answer'}` };
    }
    const cmp = parseCompareReply(r2.text);
    if (cmp.same === 'yes') {
      return { ...found1, verdict: FACT.SUPPORTS, reason: `Wikipedia's answer, ${got.answer}, means the same.` };
    }
    if (cmp.same === 'no') {
      return { ...found1, verdict: FACT.CONTRADICTS,
        reason: `Wikipedia says "${got.answer}"; the video says "${answer}".${cmp.reason ? ` ${cmp.reason}` : ''}` };
    }
    return { ...found1, verdict: FACT.NOT_COVERED,
      reason: `Wikipedia says "${got.answer}"; it is not clear whether that matches "${answer}".` };
  } catch (err) {
    return notChecked(`The check went wrong: ${String((err && err.message) || err)}`);
  }
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
  QUESTIONS: 'questions',     // { topic, topicLabel, key, autoApproved, factCheck, items: [lesson q + id], rejected, model }
  REVIEW: 'review',           // { id, verdict: 'approved' | 'rejected' }
  FLAG: 'flag',               // { id, by: 'player' | 'caregiver' | 'fact-check', reason?, quote?, title?, url?,
                              //   contest?, contestId?, module? }  (contest: raised while playing, contests.js)
  UNFLAG: 'unflag',           // { id }  a person cleared the flag
  PAID: 'paid',               // { topic, key, amount, subject }
  CHECK: 'check',             // { id, verdict, reason, quote, title, url, wikipediaAnswer, model, ms }  the fact check
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
 * `{ id, topic, topicLabel, key, question, correct, answers, source, status, flagged, flags, check }`.
 * `check` is the latest fact-check result (`factCheck`'s shape) or null. A 'contradicts' result is
 * ALSO written as a FLAG (`by: 'fact-check'`), and it is the flag — the one mechanism every hold
 * already goes through — that keeps the question out of the pool; clearing it works the same way.
 * Status starts 'pending' — the review queue was ON by default (§0h, 2026-09-17; flipped to
 * auto-approve 2026-09-28, below, and still a setting) — or 'approved' when the
 * batch was generated with auto-approve on. Auto-approve is recorded AT GENERATION rather than
 * read at display time, so turning it on later does not silently approve a backlog nobody saw.
 *
 * *** AUTO-APPROVE DEFAULT FLIPPED ON, 2026-09-28 (Mike: "Flip review.") — WHAT THAT MEANS HERE. ***
 * A question joins the pool without a person when it passed `grounded` and, WHEN THE FACT CHECK WAS
 * ON for its batch (`factCheck: true`, recorded at generation beside `autoApproved`), the check did
 * not flag it. So such an item starts 'pending' with `awaitingCheck`, and its first CHECK event —
 * any verdict, 'not-checked' included, since "not checked" is not "wrong" — approves it; a
 * 'contradicts' verdict is also written as a FLAG, which keeps it out until a person clears it. A
 * person's own Approve/Reject before the verdict lands stands (the check never overrules a person).
 * A check that never lands (the page closed mid-check) leaves it pending in the review list, where
 * Approve is one press — inaction, not a stranded screen. Batches from before this carry no
 * `factCheck` and are not held for one.
 */
export function reviewItems(events) {
  const byId = new Map();
  for (const e of chronological(events)) {
    const d = (e && e.data) || {};
    if (e.kind === REVIEW_KINDS.QUESTIONS) {
      const waits = !!(d.autoApproved && d.factCheck);
      for (const q of Array.isArray(d.items) ? d.items : []) {
        if (!q || !q.id || byId.has(q.id)) continue;       // the first time a question appears counts
        byId.set(q.id, { ...q, topic: d.topic, topicLabel: d.topicLabel || d.topic, key: d.key,
          status: d.autoApproved && !waits ? 'approved' : 'pending', awaitingCheck: waits,
          factChecked: !!d.factCheck, flagged: false, flags: [], check: null });
      }
    } else if (e.kind === REVIEW_KINDS.REVIEW) {
      const it = byId.get(d.id);
      if (it && (d.verdict === 'approved' || d.verdict === 'rejected')) { it.status = d.verdict; it.awaitingCheck = false; }
    } else if (e.kind === REVIEW_KINDS.FLAG) {
      const it = byId.get(d.id);
      if (it) {
        it.flagged = true;
        // `contest`: raised with "I think this question is wrong" while playing (contests.js); the
        // contest's own id, so one contest raises at most one flag however many panels see it.
        it.flags.push({ by: d.by || 'someone', reason: d.reason || '', quote: d.quote || '',
          title: d.title || '', url: d.url || '', contest: !!d.contest, contestId: d.contestId || null,
          module: d.module || '' });
      }
    } else if (e.kind === REVIEW_KINDS.CHECK) {
      const it = byId.get(d.id);
      if (it && Object.values(FACT).includes(d.verdict)) {
        it.check = { verdict: d.verdict, reason: d.reason || '', quote: d.quote || '', title: d.title || '',
          url: d.url || '', wikipediaAnswer: d.wikipediaAnswer || '' };
        if (it.awaitingCheck) { it.awaitingCheck = false; if (it.status === 'pending') it.status = 'approved'; }
      }
    } else if (e.kind === REVIEW_KINDS.UNFLAG) {
      const it = byId.get(d.id);
      // `flags` stays the whole history (who flagged what is the point of a log); `flagsCleared`
      // says how many of them a person has already cleared, so a screen can show the current ones.
      if (it) { it.flagged = false; it.flagsCleared = it.flags.length; }
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
