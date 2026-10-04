// answer_source.js — "SHOW WHERE THE ANSWER COMES FROM": the player's own source line, after the answer.
// (And, at the bottom, "SAY WHY AFTER THE ANSWER": the item's explanation, the line above it.)
//
// Mike, 2026-10-04: "Maybe even have an option to always show the source when the answer is given that's on
// by default."
//
// 69deea7 put a per-item `source` on every question (packs.js, PER-ITEM SOURCES) and showed it only to a
// reviewer (pack_reviews.js `sourceHtml`, the Trivia review strip and /reviews.html). This is the PLAYER's
// side of the same field: one small, quiet line under the answer, once the answer is given — never before,
// because a source named while the question is open can give the answer away ("Source: NASA — the Sun").
//
// One settings row and one renderer, here rather than inside trivia.js, so any quiz game whose items carry a
// source declares the identical row (`answerSourceField()`) the way every game declares `ownScoreField()`.
// Today only Trivia's do (think_games, brain_banks and name_that carry no sources).
//
// ---------------------------------------------------------------------------------------------------------
// THE CHOICES, ARGUED
// ---------------------------------------------------------------------------------------------------------
//   * ON BY DEFAULT — Mike's words. It is honest (the player can see what a "right answer" rests on), and it
//     costs nothing on a question with no source: nothing is drawn.
//   * "COMMON KNOWLEDGE" SHOWS NOTHING ON THE DEFAULT. For: it is honest — the question was not checked against
//     a document. Against, and it decides the default: 181 of the 192 starter questions are common knowledge,
//     so "Source: common knowledge" would sit under nearly every answer, saying nothing a player can use. The
//     reviewer still sees it (and why) in the strip. So it is the middle stop of the same row, not a second
//     row: 'all' says "Source: common knowledge" — never the reviewer's note, which is fact-check reasoning,
//     not something to read under an answer.
//   * A NAMED REFERENCE'S NOTE IS SHOWN ("Encyclopaedia Britannica — giraffe"): there it is usually the
//     article, which is the useful half.
//   * ON A SCREEN (ctx.isScreen) IT IS PLAIN TEXT WITH THE HOST — a tab opened on a screen is a stray page
//     nobody there can close (page_links.js). Off a screen it is a link that opens a new tab.
//   * AN UNTITLED LINK SHOWS ITS HOST ONLY ("klobuchar.senate.gov"), not the whole address: the reviewer's
//     strip shows the full address because a reviewer checks it; a player is not going to read a path.
//   * NOT READ ALOUD, AND NO ROW FOR IT. Trivia reads nothing aloud — not the question, not "Correct." — so a
//     "read the source aloud" row would be a setting that changes nothing (the defect trivia.js's own
//     `tryingPoints` comment describes). `answerSourceText` is the words, ready for the day a game does speak.

import { COMMON_KNOWLEDGE } from './packs.js';

export const ANSWER_SOURCE_KEY = 'showSource';
export const ANSWER_SOURCE_MODES = ['on', 'all', 'off'];
export const ANSWER_SOURCE_DEFAULT = 'on';

/** The settings row a quiz game declares. `standard`: it is a thing somebody changes. */
export function answerSourceField({ level = 'standard', note = null } = {}) {
  return {
    key: ANSWER_SOURCE_KEY, label: 'Show where the answer comes from', kind: 'choice',
    default: ANSWER_SOURCE_DEFAULT, level,
    options: [
      { value: 'on', label: 'On' },
      { value: 'all', label: 'On, and say "common knowledge" too' },
      { value: 'off', label: 'Off' },
    ],
    note: note || 'A small line under the answer, once it is given, naming what the question rests on. '
      + 'Only questions that name a source show one.',
  };
}

/** What the saved settings mean. A plain true/false (anything that wrote a switch) still means on/off. */
export function answerSourceMode(saved = {}) {
  const v = (saved || {})[ANSWER_SOURCE_KEY];
  if (v === true) return 'on';
  if (v === false) return 'off';
  return ANSWER_SOURCE_MODES.includes(v) ? v : ANSWER_SOURCE_DEFAULT;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isHttp = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim());
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isCommon = (s) => !s.url && String(s.ref || '').trim().toLowerCase() === COMMON_KNOWLEDGE;

// Each source as { words, url? } — `url` only for a real http(s) link. Sources are packs.js `itemSources`'s
// shape ({ url, ref, title, note }), already validated; this re-checks the link anyway, because a bank array
// can arrive from anywhere.
function parts(sources, mode) {
  const list = (Array.isArray(sources) ? sources : []).filter((s) => s && typeof s === 'object');
  const out = [];
  let common = false;
  for (const s of list) {
    if (isCommon(s)) { common = true; continue; }
    const note = s.note ? ` — ${s.note}` : '';
    if (isHttp(s.url)) {
      const host = hostOf(s.url);
      out.push({ words: `${s.title ? `${s.title} (${host})` : host}${note}`, url: s.url.trim() });
    } else if (s.ref) {
      out.push({ words: `${s.ref}${note}` });
    }
  }
  if (!out.length && common && mode === 'all') out.push({ words: COMMON_KNOWLEDGE });
  return out;
}

/** The line as plain words ("Source: NASA (science.nasa.gov)"), or '' when nothing is to be shown. */
export function answerSourceText(sources, { mode = ANSWER_SOURCE_DEFAULT } = {}) {
  if (mode === 'off') return '';
  const p = parts(sources, mode);
  return p.length ? `Source: ${p.map((x) => x.words).join(' · ')}` : '';
}

/**
 * The line as HTML, or '' when nothing is to be shown (setting off, no source, only "common knowledge" on the
 * default). `onScreen`: plain text, never a link.
 */
export function answerSourceHtml(sources, { mode = ANSWER_SOURCE_DEFAULT, onScreen = false, cls = 'tv-answer-src' } = {}) {
  if (mode === 'off') return '';
  const p = parts(sources, mode);
  if (!p.length) return '';
  const body = p.map((x) => (x.url && !onScreen
    ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.words)}</a>`
    : esc(x.words))).join(' · ');
  return `<p class="${cls}" data-answer-source>Source: ${body}</p>`;
}

// ---------------------------------------------------------------------------------------------------------
// "SAY WHY AFTER THE ANSWER" — the item's own `explain` sentence, the line ABOVE the source (2026-10-04)
// ---------------------------------------------------------------------------------------------------------
// Every starter question carries an `explain` sentence (packs_review/; a fact-check pass, 32715ec, corrected
// ten of them), and Trivia dropped it: a right answer said only "Correct.". Here because it is the same kind of
// line as the source — after the answer, never before, one per game's settings — and the order of the two is
// then decided in one file: the explanation first (it is the content: why the answer is right), the source
// under it (what that rests on).
//   * ON BY DEFAULT. For: it is the half of a quiz that teaches, it was written and checked for every starter
//     question, and an item without one draws nothing. Against: a player who wants a brisk quiz reads more per
//     question — so it is a switch, not a constant.
//   * A SWITCH, NOT A CHOICE: there is no middle stop worth a press (unlike the source's "common knowledge").
//   * NEVER BEFORE THE ANSWER, NOR AFTER A WRONG GUESS — an explanation names the answer almost every time.
//   * NO LABEL ("Why:") ON THE PLAYER'S LINE: under "Correct." the sentence reads as the reason by itself. The
//     reviewer's strip DOES label it ("Explanation: ..."), because there it is a thing being checked.
//   * NOT READ ALOUD, AND NO ROW FOR IT — the same reason as the source above: Trivia speaks nothing today.
//     `answerExplainText` is the words, ready for the day it does.
export const ANSWER_EXPLAIN_KEY = 'showExplain';
export const ANSWER_EXPLAIN_DEFAULT = true;

/** The settings row a quiz game declares (a switch). */
export function answerExplainField({ level = 'standard', note = null } = {}) {
  return {
    key: ANSWER_EXPLAIN_KEY, label: 'Say why after the answer', default: ANSWER_EXPLAIN_DEFAULT, level,
    onLabel: 'On', offLabel: 'Off',
    note: note || 'One short sentence under "Correct." saying why that is the answer, once it is given. Only '
      + 'questions that come with an explanation show one. Shown, not read aloud.',
  };
}

/** What the saved settings mean: on unless somebody turned it off (false, or "off" from anything that wrote words). */
export function answerExplainOn(saved = {}) {
  const v = (saved || {})[ANSWER_EXPLAIN_KEY];
  return !(v === false || v === 'off');
}

/** The sentence, trimmed, or '' — anything that is not text counts as none. */
export function answerExplainText(explain) {
  return typeof explain === 'string' ? explain.trim() : '';
}

/**
 * The line as HTML, or '' when there is nothing to say. Showing it only once the answer is given (and whether
 * the setting is on) is the caller's: this draws what it is handed. `label` is for the reviewer's strip.
 */
export function answerExplainHtml(explain, { cls = 'tv-explain', attr = 'data-answer-explain', label = '' } = {}) {
  const t = answerExplainText(explain);
  return t ? `<p class="${cls}" ${attr}>${label ? `${esc(label)} ` : ''}${esc(t)}</p>` : '';
}
