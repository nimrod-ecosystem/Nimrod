// pack_reviews.js — REVIEW BY PLAYING: unreviewed question packs, played with a quiet "✓ fine / ✗ wrong",
// and the account's record of what a person said about each question.
//
// Mike, 2026-10-03, about the AI-written packs (claude_questions.py; the starter packs in packs_review/):
//   "Can I just play through and pass them? Maybe even play with [the person the screen is for] and just
//    say if any are wrong?"
//
// *** WHY THIS IS THE REAL GUARD, NOT A FORMALITY. *** packs.js refuses a pack with no `source`, but a pack
// can still say "written from memory" in `source.name` and load — the validator checks that a source is
// NAMED, not that the facts are right. An AI-written question can be confidently wrong, and a wrong "right
// answer" taught as fact is worse than no question. A person reading every question while playing it is
// what actually catches that; this file is the bookkeeping for it.
//
// ---------------------------------------------------------------------------------------------------------
// THE REVIEW RULE (argued; Mike's words were "play through and pass them ... say if any are wrong")
// ---------------------------------------------------------------------------------------------------------
//   * PASSED — the question was answered and the player moved on with nobody pressing ✗ (Trivia writes the
//     pass when the question is LEFT, not when it is answered, so the reviewer has the whole answered state —
//     the right answer lit up, the moment a wrong one is easiest to see — to press ✗). "✓ fine" passes it at
//     once. Skipping a question without answering it passes nothing: it was not looked at.
//   * FLAGGED — anybody pressed ✗ (or said "that one is wrong", or pressed the key or a bound switch). It is
//     never dealt again, anywhere on the account, until somebody presses "Fixed — ask it again" on the review
//     page. A note says what is wrong, in that person's words.
//   * A FLAG BEATS A PASS, in either order. A pass is the absence of a complaint; a flag is a person saying
//     "this is wrong", which is the rarer and more informative thing. So a later pass (another device that
//     had not heard yet) never puts a flagged question back — only "Fixed" does.
//   * "FIXED" puts it back to OPEN (not passed): a fixed question is played and reviewed again. Fixing the
//     question's words or its right answer changes its key anyway (it is a new question to review); fixing
//     only a wrong option keeps the key, which is what the button is for.
//   * A PACK IS "REVIEWED" once every question in it has passed or been flagged.
//
// THE KEY is contests.js's `contestKey(question, answer)` — question and right answer, normalised, hashed —
// for contests.js's reasons: a pack item has no id, a position would re-point every review when a pack is
// reordered, and a question held by a contest and one flagged here are then the same question.
//
// WHERE IT IS KEPT: the ACCOUNT's log (`/api/account/reviews`, web/server/pack_reviews.py), so a question
// passed on a phone counts on every screen of that account. Append-only, like the contests log, so two
// devices reviewing at once cannot undo each other. Who and when are stamped by the server.
//
// PROMOTION: a passed question is reviewed for the whole account. A pack with any passed questions is
// offered in Trivia's "Which pack" as "<topic> — N reviewed questions" with the setting OFF, and then plays
// ONLY its passed questions. pack_library.js is not edited (it is the hand-kept list of packs cleared to
// ship, and claude_questions.py's own test checks it names none of these): the per-account list is computed
// from this log, live, on whichever device asks.

import { contestKey } from './contests.js';
import { createEvents } from './events.js';
import { authHeaders } from './auth.js';
import { parsePack, itemSources, COMMON_KNOWLEDGE, difficultyLevel } from './packs.js';
import { REVIEW_FLAG_TOPIC, REVIEW_PASS_TOPIC, REVIEW_ACTIONS } from './actions.js';
import { themeQrColours } from './page_links.js';
import { qrSVG } from './qr.js';
import { createReviewPoints } from './review_points.js';
import { PROFILE_SETTINGS_KEY } from './lessons.js';

export const REVIEWS_URL = '/api/account/reviews';
export const UNREVIEWED_URL = '/api/packs/unreviewed';
export const REVIEW_PACK_PREFIX = 'review:';
export const REVIEW_KINDS = Object.freeze({ PASS: 'pass', FLAG: 'flag', NOTE: 'note', UNFLAG: 'unflag' });
export const REVIEW_STATUS = Object.freeze({ OPEN: 'open', PASSED: 'passed', FLAGGED: 'flagged' });
// Another panel on this screen reviewed something: refresh now rather than on the next poll.
export const REVIEW_TOPIC = 'review/changed';

// *** THE REVIEW CONTROL'S OTHER WAYS IN (pointer is the buttons themselves). *** Screen actions, like the
// cursor's: whichever Trivia panel is showing an unreviewed question answers them; nothing else does.
//   * A SWITCH: bind a spare switch, or a long press, to either one in Devices. NOT a stop in the player's
//     walk — the person playing walks the answers exactly as before, and a reviewer's ✗ never costs them a
//     press. See modules/trivia.js for the argument.
//   * THE KEYBOARD: W ("wrong") and O ("okay") by default (REVIEW_KEY_BINDINGS).
//   * VOICE: "that one is wrong" / "that is wrong" / "question wrong" (input_speech.js ROUTES), pressing
//     the same action, so a spoken flag and a switch flag are one thing to bind and one thing to log.
// The two actions are declared in actions.js (registered in the default registry, so a switch or a phrase
// bound to one fires) and re-exported here.
export { REVIEW_FLAG_TOPIC, REVIEW_PASS_TOPIC, REVIEW_ACTIONS };
// W and O, argued: the kiosk already takes F (full screen), C, H, M and the digits as bare letters; W is
// "wrong" and O is "okay", neither is taken, and neither sits next to Enter or the arrows a player uses.
// Ordinary bindings: rebind them in Devices like any other. Same shape as input_keyboard.js's own.
const reviewKey_ = (id, control, actionId, label) => ({
  id, actionId, device: 'keyboard', control,
  edge: 'press', role: 'universal', holdMs: 0, debounceMs: 0, lockoutMs: 0, label,
});
export const REVIEW_KEY_BINDINGS = [
  reviewKey_('default/review-wrong', 'key:w', 'review/wrong', 'This question is wrong (reviewing)'),
  reviewKey_('default/review-fine', 'key:o', 'review/fine', 'This question is fine (reviewing)'),
];

/**
 * The review key bindings a saved input record does not already cover, for a host to add IN MEMORY (never
 * written back) — the same rule kiosk.js `withSpeechBindings` follows: a person who saved a switch setup has
 * a record that replaced every default, and would otherwise never get these keys. A key the record already
 * uses, or an action it already binds, is left alone: what a person set up wins.
 */
export function missingReviewBindings(bindings) {
  const list = Array.isArray(bindings) ? bindings : [];
  return REVIEW_KEY_BINDINGS.filter((b) => !list.some((x) => x && (
    (x.device === b.device && x.control === b.control) || x.actionId === b.actionId)));
}

export const isReviewPackId = (id) => typeof id === 'string' && id.startsWith(REVIEW_PACK_PREFIX);
export const reviewKey = (question, answer) => contestKey(question, answer);

/** A pack's name without the "(AI-written, not yet reviewed)" tail — the option label says the state. */
export function topicName(name) {
  return String(name || '').replace(/\s*\([^)]*review[^)]*\)\s*$/i, '').trim() || String(name || '');
}

function chronological(events) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === 'object');
  if (list.length && list.every((e) => Number.isFinite(Number(e.id)))) return [...list].sort((a, b) => Number(a.id) - Number(b.id));
  return list;
}

/**
 * The log, folded: Map key -> { key, status, pack, question, answer, notes: [{ note, by, at }],
 * passedBy, passedAt, flaggedBy, flaggedAt }. Never throws. See the header for the rule.
 */
export function reviewsFrom(events) {
  const byKey = new Map();
  const rec = (key) => {
    let r = byKey.get(key);
    if (!r) {
      r = { key, status: REVIEW_STATUS.OPEN, pack: '', question: '', answer: '', notes: [],
        passedBy: null, passedAt: null, flaggedBy: null, flaggedAt: null };
      byKey.set(key, r);
    }
    return r;
  };
  for (const e of chronological(events)) {
    const d = (e && e.data) || {};
    const key = typeof d.key === 'string' ? d.key : '';
    if (!key) continue;
    const at = d.at || e.created_at || null;
    const by = d.by || null;
    const r = rec(key);
    if (d.pack) r.pack = String(d.pack);
    if (d.question) r.question = String(d.question);
    if (d.answer != null && d.question) r.answer = String(d.answer);
    if (e.kind === REVIEW_KINDS.PASS) {
      if (r.status !== REVIEW_STATUS.FLAGGED) { r.status = REVIEW_STATUS.PASSED; r.passedBy = by; r.passedAt = at; }
    } else if (e.kind === REVIEW_KINDS.FLAG) {
      r.status = REVIEW_STATUS.FLAGGED; r.flaggedBy = by; r.flaggedAt = at;
      if (d.note) r.notes.push({ note: String(d.note), by, at });
    } else if (e.kind === REVIEW_KINDS.NOTE) {
      if (d.note) r.notes.push({ note: String(d.note), by, at });
    } else if (e.kind === REVIEW_KINDS.UNFLAG) {
      r.status = REVIEW_STATUS.OPEN; r.flaggedBy = null; r.flaggedAt = null; r.passedBy = null; r.passedAt = null;
    }
  }
  return byKey;
}

export const statusOf = (map, key) => (map && map.get(key)?.status) || REVIEW_STATUS.OPEN;

/** Each item of a trivia pack with its key and status. */
export function packItems(pack, map) {
  return (pack?.items || []).filter((it) => it && it.question && it.correct).map((it) => {
    const key = reviewKey(it.question, it.correct);
    return { item: it, key, status: statusOf(map, key) };
  });
}

// *** THE SOURCE, FOR THE REVIEWER (Mike, 2026-10-04: "Shouldn't the sources be noted when the questions
// are made?"). *** Each item's own `source` (packs.js, "PER-ITEM SOURCES") rides with it into review, so the
// person passing a question can see what it rests on — and open the link — before deciding it is right. This
// is the REVIEWER's version (full address, the note, "none given"), drawn inside the review strip and on
// /reviews.html. The player's own shorter line, after the answer, is answer_source.js (Mike, 2026-10-04:
// "always show the source when the answer is given"), and it steps aside while this strip is showing.
//
// *** "WHERE THIS COMES FROM" (Mike, 2026-10-06: "For reviewing the questions it would be nice if it linked to the
// wiki page and opened in another window"). *** The line leads with those words rather than "Source:" — plain
// words for whoever is reviewing, a teenager doing it for schoolwork included. A link (only http/https) opens in
// a NEW tab or window (`target="_blank"`, `rel="noopener noreferrer"`: the page opened cannot reach back into
// this one, and the site it opens is not told where the reader came from), and its words are the page's title
// with the site's name, or just the site's name — readable without opening it. Common knowledge says "Common
// knowledge" and its reason, with no link. ON A SCREEN (page_links.js's rule) nothing opens: the line shows the
// address to type on a phone or computer, and a code to scan beside it when the theme's colours can draw one.
// Every link carries `data-review-source-link` (and `data-review-key` where the page knows the question), so
// review_points.js can pay for opening it (its rule 6).
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const isWebLink = (url) => /^https?:\/\/[^\s]+$/i.test(String(url || ''));
export const SOURCE_LEAD = 'Where this comes from:';
/** "en.wikipedia.org/wiki/Giraffe": an address as somebody would type it (no https://, no www.). */
export function sourceAddress(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
  } catch { return String(url || ''); }
}
// The theme's code colours on this page (page_links.js `themeQrColours`), or null (then no code: the address is
// the thing that always works).
const pageQrColours = () => {
  try { return typeof document !== 'undefined' && document.documentElement ? themeQrColours(document.documentElement) : null; }
  catch { return null; }
};

/** One source as a plain line: "Title (host)", a reference, or "common knowledge — why". */
export function sourceText(s) {
  if (!s) return '';
  const note = s.note ? ` — ${s.note}` : '';
  if (s.url) return `${s.title ? `${s.title} (${hostOf(s.url)})` : s.url}${note}`;
  return `${s.ref || ''}${note}`;
}

/** The addresses of a list of sources that are web links (what review_points.js pays for opening). */
export const sourceUrls = (sources) => (Array.isArray(sources) ? sources : []).map((s) => s && s.url).filter(isWebLink);

/**
 * The "Where this comes from:" line(s) for a review screen, as HTML (see the note above). No source at all says
 * so — that is the question to check hardest. `onScreen: true` (a real screen, ctx.isScreen; page_links.js argues
 * it): the same words as plain text, NOT a link, then the address to open on a phone or computer and a code to
 * scan. `key`: the question's review key, put on each link for review_points.js. `colours`: the code's colours
 * (default: this page's theme; null draws no code).
 */
export function sourceHtml(sources, { cls = 'tv-review-src', onScreen = false, key = '', colours } = {}) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) {
    return `<p class="${cls}" data-review-source="none">${SOURCE_LEAD} none given — check this one against a source.</p>`;
  }
  const qrc = onScreen ? (colours === undefined ? pageQrColours() : colours) : null;
  return list.map((s) => {
    const note = s.note ? ` <span class="${cls}-note">— ${escHtml(s.note)}</span>` : '';
    if (s.url && isWebLink(s.url)) {
      const label = s.title ? `${escHtml(s.title)} (${escHtml(hostOf(s.url))})` : escHtml(hostOf(s.url));
      if (onScreen) {
        const addr = sourceAddress(s.url);
        let qr = '';
        if (qrc) {
          try { qr = qrSVG(s.url, { level: 'M', quiet: 4, dark: qrc.dark, light: qrc.light, title: `Scan to open ${addr}` }); }
          catch (err) { console.error('pack reviews: source code', err); qr = ''; }
        }
        return `<p class="${cls}" data-review-source="url">${SOURCE_LEAD} <span data-review-source-plain>${label}</span>${note}`
          + `<br><span class="${cls}-addr">On a phone or computer, open <strong data-review-source-address>${escHtml(addr)}</strong></span>`
          + `${qr ? `<span data-review-source-qr style="display:block;width:min(120px,40%);margin:4px 0">${qr}</span>` : ''}</p>`;
      }
      return `<p class="${cls}" data-review-source="url">${SOURCE_LEAD} <a href="${escHtml(s.url)}" target="_blank" `
        + `rel="noopener noreferrer" data-review-source-link${key ? ` data-review-key="${escHtml(key)}"` : ''}>${label}</a>${note}</p>`;
    }
    const common = String(s.ref || '').toLowerCase() === COMMON_KNOWLEDGE;
    const words = common ? 'Common knowledge' : escHtml(s.ref || s.url || '');
    return `<p class="${cls}" data-review-source="${common ? 'common' : 'ref'}">${SOURCE_LEAD} ${words}${note}</p>`;
  }).join('');
}

/** { total, passed, flagged, open, reviewed } — `reviewed` once nothing is left open. */
export function packProgress(pack, map) {
  const rows = packItems(pack, map);
  const n = (s) => rows.filter((r) => r.status === s).length;
  const open = n(REVIEW_STATUS.OPEN);
  return { total: rows.length, passed: n(REVIEW_STATUS.PASSED), flagged: n(REVIEW_STATUS.FLAGGED), open,
    reviewed: rows.length > 0 && open === 0 };
}

/**
 * What Trivia may deal from a review pack, in its bank shape `{ question, answer, wrong, review, explain? }`.
 * FLAGGED never. PASSED always. OPEN only with the setting on — and then each carries `review.status:
 * 'open'`, which is what puts the review control on screen.
 */
export function playableBank(pack, map, { includeUnreviewed = false, packId = '' } = {}) {
  const out = [];
  for (const { item, key, status } of packItems(pack, map)) {
    if (status === REVIEW_STATUS.FLAGGED) continue;
    if (status === REVIEW_STATUS.OPEN && !includeUnreviewed) continue;
    const row = { question: item.question, answer: item.correct,
      wrong: (item.answers || []).filter((a) => a !== item.correct),
      review: { key, packId, status, sources: itemSources(item.source) } };
    // The item's `explain` (Trivia's "Say why after the answer"). On the row itself, not under `review`: a
    // PASSED question plays with no review strip and says why under "Correct." like any pack question.
    const why = typeof item.explain === 'string' ? item.explain.trim() : '';
    if (why) row.explain = why;
    // The item's difficulty as its starting level (packs.js difficultyLevel), so a PASSED question plays at
    // its level like any pack question. Open ones carry it too; Trivia does not use it while reviewing.
    const level = difficultyLevel(item.difficulty);
    if (level) row.level = level;
    out.push(row);
  }
  return out;
}

/**
 * The extra "Which pack" options for this account: with the setting OFF, only packs with passed questions
 * ("Animals — 12 reviewed questions"), and an unreviewed pack with none is not listed at all; with it ON,
 * every review pack, saying how many are left. `listing` is the server's rows, `packs` a Map id -> pack.
 */
export function reviewPackOptions(listing, packs, map, { includeUnreviewed = false } = {}) {
  const out = [];
  for (const entry of Array.isArray(listing) ? listing : []) {
    if (!entry || entry.kind !== 'trivia') continue;
    const pack = packs?.get?.(entry.id);
    if (!pack) continue;
    const p = packProgress(pack, map);
    const name = topicName(pack.name || entry.name);
    if (includeUnreviewed) {
      out.push({ value: entry.id, label: p.reviewed
        ? `${name} — reviewed (${p.passed} of ${p.total} passed)`
        : `${name} — reviewing: ${p.open} of ${p.total} left` });
    } else if (p.passed > 0) {
      out.push({ value: entry.id, label: `${name} — ${p.passed} reviewed question${p.passed === 1 ? '' : 's'}` });
    }
  }
  return out;
}

/** Every flagged question across the listed packs, with what is known about it. Oldest flag first. */
export function flaggedList(listing, packs, map) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(listing) ? listing : []) {
    const pack = packs?.get?.(entry.id);
    if (!pack) continue;
    for (const { item, key, status } of packItems(pack, map)) {
      if (status !== REVIEW_STATUS.FLAGGED || seen.has(key)) continue;
      seen.add(key);
      const r = map.get(key);
      out.push({ key, packId: entry.id, packName: topicName(pack.name || entry.name), file: entry.url || entry.file || '',
        question: item.question, answer: item.correct, answers: item.answers || [], explain: item.explain || '',
        sources: itemSources(item.source), notes: r.notes, flaggedBy: r.flaggedBy, flaggedAt: r.flaggedAt });
    }
  }
  // A flag on a question no listed pack still holds (the file was fixed, renamed or removed) is still shown,
  // from what the log kept, so nothing flagged silently disappears from the list.
  for (const r of map ? map.values() : []) {
    if (r.status !== REVIEW_STATUS.FLAGGED || seen.has(r.key)) continue;
    out.push({ key: r.key, packId: r.pack, packName: '(no longer in a listed pack)', file: '',
      question: r.question, answer: r.answer, answers: [], explain: '', sources: [],
      notes: r.notes, flaggedBy: r.flaggedBy, flaggedAt: r.flaggedAt, orphan: true });
  }
  return out.sort((a, b) => String(a.flaggedAt || '').localeCompare(String(b.flaggedAt || '')));
}

/** "Export flagged": plain text to paste to Code (or anybody) — what is wrong, where it lives. */
export function exportFlagged(list, { now = new Date() } = {}) {
  const rows = Array.isArray(list) ? list : [];
  const day = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  const lines = [`Flagged questions (${rows.length}), exported ${day}.`,
    'Each was marked wrong while playing. Fix the question, its right answer or its options in the pack file, or delete it.', ''];
  let pack = null;
  for (const r of rows) {
    if (r.packName !== pack) {
      pack = r.packName;
      lines.push(`Pack: ${r.packName}${r.file ? ` (${r.file})` : ''}`);
    }
    lines.push(`- Question: ${r.question}`);
    lines.push(`  Marked right: ${r.answer}`);
    if (r.answers && r.answers.length) lines.push(`  Options: ${r.answers.join(' | ')}`);
    if (r.explain) lines.push(`  Its explanation: ${r.explain}`);
    if (!r.orphan) {
      const srcs = (r.sources || []).map((s) => (s.url && s.title ? `${s.title} <${s.url}>${s.note ? ` — ${s.note}` : ''}` : sourceText(s)));
      lines.push(`  Its source: ${srcs.length ? srcs.join(' | ') : '(none given)'}`);
    }
    for (const n of r.notes || []) lines.push(`  What's wrong: ${n.note}${n.by ? ` (${n.by})` : ''}`);
    if (!(r.notes || []).length) lines.push("  What's wrong: (no note)");
    lines.push(`  Flagged${r.flaggedBy ? ` by ${r.flaggedBy}` : ''}${r.flaggedAt ? ` on ${String(r.flaggedAt).slice(0, 10)}` : ''}; key ${r.key}`);
  }
  return lines.join('\n');
}

/** The server's list of packs waiting for review. [] on any failure — never throws into a game. */
export async function listUnreviewedPacks({ fetchImpl = (...a) => fetch(...a), user } = {}) {
  try {
    const res = await fetchImpl(UNREVIEWED_URL, { headers: authHeaders(user) });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.packs) ? j.packs : [];
  } catch { return []; }
}

/** Fetch and validate one listed pack (packs.js `parsePack`: a pack that fails validation never loads). */
export async function loadReviewPack(entry, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const res = await fetchImpl(entry.url);
  if (!res.ok) throw new Error(`pack "${entry.url}" -> ${res.status}`);
  return parsePack(await res.text());
}

/**
 * Everything a reviewer's screen needs, loaded together: the listing, each listed pack, and the log.
 * `events` is any events handle (events.js's shape); without one it is made on the account's URL.
 * Returns the handle; `ready` resolves once the first load is in (whatever failed is simply empty).
 */
export function createPackReviews({ events = null, user, push = null, bus = null, pollMs = 30000,
                                   listPacks = null, loadPack = null, fetchImpl = null } = {}) {
  const log = events || createEvents({ url: REVIEWS_URL, user, push, pollMs, limit: 5000 });
  const f = fetchImpl || ((...a) => fetch(...a));
  const lister = listPacks || (() => listUnreviewedPacks({ fetchImpl: f, user }));
  const loader = loadPack || ((entry) => loadReviewPack(entry, { fetchImpl: f }));
  let listing = [];
  const packs = new Map();
  const subs = new Set();
  let dead = false;
  const map = () => reviewsFrom((log.get && log.get() && log.get().events) || []);
  const notify = () => { for (const fn of [...subs]) { try { fn(); } catch (err) { console.error('pack reviews: subscriber', err); } } };
  const offLog = log.subscribe ? log.subscribe(() => notify()) : null;

  async function loadPacks() {
    listing = (await lister()) || [];
    await Promise.all(listing.map(async (entry) => {
      if (packs.has(entry.id)) return;
      try { packs.set(entry.id, await loader(entry)); }
      catch (err) { console.error(`pack reviews: ${entry.url} did not load`, err); }
    }));
  }
  const ready = Promise.all([
    loadPacks().catch(() => {}),
    Promise.resolve(log.load ? log.load() : null).catch(() => {}),
  ]).then(() => { if (!dead) notify(); });

  async function write(kind, data) {
    try {
      await log.append(kind, data);
      if (bus) bus.publish(REVIEW_TOPIC, { kind, key: data.key });
      return true;
    } catch (err) {
      console.error('pack reviews: could not record', err);
      return false;
    }
  }
  // *** REVIEW POINTS (review_points.js): a handle that has been told where to pay (`payInto`) pays once a
  // verdict is SAVED — the same for a pass, a flag or "Fixed", whatever was said (its rule 3). One tracker per
  // handle; `payInto` again replaces it.
  let points = null;
  let offRoot = null;
  const payFor = async (key, question) => {
    if (!points) return;
    try { await points.decided(key, { question }); } catch (err) { console.error('pack reviews: points', err); }
  };
  // `person` (the review page's "Who is reviewing"): a person on this login. The server checks it and signs the
  // row with their name; left out, the row is signed as it always was.
  const verdict = (kind) => async ({ question, answer, packId = '', place = '', note = '', person = '' } = {}) => {
    const key = reviewKey(question, answer);
    if (!key || !question) return false;
    const data = { key, question: String(question), answer: String(answer ?? '') };
    if (isReviewPackId(packId)) data.pack = packId;
    if (place) data.place = String(place).slice(0, 80);
    if (note) data.note = String(note);
    if (person) data.person = String(person);
    const ok = await write(kind, data);
    if (ok) await payFor(key, question);
    return ok;
  };
  /** Every source address of the question with this key, from the listed packs (review_points.js rule 6). */
  function sourceUrlsOf(key) {
    for (const pack of packs.values()) {
      const hit = (pack?.items || []).find((it) => it && it.question && it.correct && reviewKey(it.question, it.correct) === key);
      if (hit) return sourceUrls(itemSources(hit.source));
    }
    return [];
  }
  /** Every question still OPEN (not passed, not flagged) in the listed trivia packs, pack by pack, in pack order:
   *  what the review page deals one at a time. `{ key, item, packId, packName, sources }`. */
  function openQuestions() {
    const out = [];
    const seen = new Set();
    const m = map();
    for (const entry of listing) {
      if (!entry || entry.kind !== 'trivia') continue;
      const pack = packs.get(entry.id);
      if (!pack) continue;
      for (const { item, key, status } of packItems(pack, m)) {
        if (status !== REVIEW_STATUS.OPEN || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, item, packId: entry.id, packName: topicName(pack.name || entry.name), sources: itemSources(item.source) });
      }
    }
    return out;
  }

  return {
    ready,
    listing: () => listing,
    packs: () => packs,
    packById: (id) => packs.get(id) || null,
    entryById: (id) => listing.find((e) => e.id === id) || null,
    map,
    status: (question, answer) => statusOf(map(), reviewKey(question, answer)),
    pass: verdict(REVIEW_KINDS.PASS),
    flag: verdict(REVIEW_KINDS.FLAG),
    note: (key, text, { person = '' } = {}) => (key && String(text || '').trim()
      ? write(REVIEW_KINDS.NOTE, { key, note: String(text).trim(), ...(person ? { person: String(person) } : {}) })
      : Promise.resolve(false)),
    // "Fixed — ask it again" is a verdict too (review_points.js rule 3): it pays like a pass or a flag, once.
    unflag: async (key, { person = '', question = '' } = {}) => {
      if (!key) return false;
      const ok = await write(REVIEW_KINDS.UNFLAG, { key, ...(person ? { person: String(person) } : {}) });
      if (ok) await payFor(key, question || map().get(key)?.question || '');
      return ok;
    },
    options: (opts) => reviewPackOptions(listing, packs, map(), opts),
    flagged: () => flaggedList(listing, packs, map()),
    openQuestions,
    sourceUrlsOf,
    progress: (id) => (packs.get(id) ? packProgress(packs.get(id), map()) : null),
    /**
     * PAY REVIEWS DONE THROUGH THIS HANDLE INTO ONE SCREEN'S POINTS (review_points.js). `ledger`: that screen's
     * points ledger; `makeState`: its maker (the settings document is read for the Nimrod Game's review numbers),
     * or `settings` directly; `root`: an element whose source links count when opened (Trivia's panel, the review
     * page). Returns the tracker (`shown`, `decided`, `opened`, `last`), or null without a ledger. Never throws.
     */
    payInto({ ledger = null, makeState = null, settings = null, root = null, now } = {}) {
      offRoot?.(); offRoot = null; points = null;
      if (!ledger) return null;
      let st = settings;
      let own = null;     // a settings handle made here is this handle's to close
      try { if (!st && typeof makeState === 'function') own = st = makeState(PROFILE_SETTINGS_KEY); } catch { st = null; }
      offRoot = () => { try { own?.destroy?.(); } catch { /* gone */ } };
      try { points = createReviewPoints({ ledger, settings: st, sourcesOf: sourceUrlsOf, ...(now ? { now } : {}) }); }
      catch (err) { console.error('pack reviews: no review points', err); points = null; return null; }
      if (root && typeof root.addEventListener === 'function') {
        // click covers a press, Enter on a focused link and a tap; auxclick a middle-button "open in a new tab".
        const onOpen = (e) => {
          const a = e.target && e.target.closest ? e.target.closest('a[data-review-source-link]') : null;
          if (!a || !points) return;
          points.opened(a.getAttribute('href') || '', a.getAttribute('data-review-key') || null);
        };
        root.addEventListener('click', onOpen);
        root.addEventListener('auxclick', onOpen);
        const closeOwn = offRoot;
        offRoot = () => { root.removeEventListener('click', onOpen); root.removeEventListener('auxclick', onOpen); closeOwn(); };
      }
      return points;
    },
    points: () => points,
    reload: () => Promise.resolve(log.load ? log.load() : null).catch(() => {}),
    startPolling: () => log.startPolling?.(),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    destroy: () => { dead = true; subs.clear(); offLog?.(); offRoot?.(); offRoot = null; points = null; log.destroy?.(); },
  };
}
