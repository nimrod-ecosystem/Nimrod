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
import { parsePack } from './packs.js';
import { REVIEW_FLAG_TOPIC, REVIEW_PASS_TOPIC, REVIEW_ACTIONS } from './actions.js';

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

/** { total, passed, flagged, open, reviewed } — `reviewed` once nothing is left open. */
export function packProgress(pack, map) {
  const rows = packItems(pack, map);
  const n = (s) => rows.filter((r) => r.status === s).length;
  const open = n(REVIEW_STATUS.OPEN);
  return { total: rows.length, passed: n(REVIEW_STATUS.PASSED), flagged: n(REVIEW_STATUS.FLAGGED), open,
    reviewed: rows.length > 0 && open === 0 };
}

/**
 * What Trivia may deal from a review pack, in its bank shape `{ question, answer, wrong, review }`.
 * FLAGGED never. PASSED always. OPEN only with the setting on — and then each carries `review.status:
 * 'open'`, which is what puts the review control on screen.
 */
export function playableBank(pack, map, { includeUnreviewed = false, packId = '' } = {}) {
  const out = [];
  for (const { item, key, status } of packItems(pack, map)) {
    if (status === REVIEW_STATUS.FLAGGED) continue;
    if (status === REVIEW_STATUS.OPEN && !includeUnreviewed) continue;
    out.push({ question: item.question, answer: item.correct,
      wrong: (item.answers || []).filter((a) => a !== item.correct),
      review: { key, packId, status } });
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
        notes: r.notes, flaggedBy: r.flaggedBy, flaggedAt: r.flaggedAt });
    }
  }
  // A flag on a question no listed pack still holds (the file was fixed, renamed or removed) is still shown,
  // from what the log kept, so nothing flagged silently disappears from the list.
  for (const r of map ? map.values() : []) {
    if (r.status !== REVIEW_STATUS.FLAGGED || seen.has(r.key)) continue;
    out.push({ key: r.key, packId: r.pack, packName: '(no longer in a listed pack)', file: '',
      question: r.question, answer: r.answer, answers: [], explain: '',
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
  const verdict = (kind) => ({ question, answer, packId = '', place = '', note = '' } = {}) => {
    const key = reviewKey(question, answer);
    if (!key || !question) return Promise.resolve(false);
    const data = { key, question: String(question), answer: String(answer ?? '') };
    if (isReviewPackId(packId)) data.pack = packId;
    if (place) data.place = String(place).slice(0, 80);
    if (note) data.note = String(note);
    return write(kind, data);
  };

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
    note: (key, text) => (key && String(text || '').trim()
      ? write(REVIEW_KINDS.NOTE, { key, note: String(text).trim() }) : Promise.resolve(false)),
    unflag: (key) => (key ? write(REVIEW_KINDS.UNFLAG, { key }) : Promise.resolve(false)),
    options: (opts) => reviewPackOptions(listing, packs, map(), opts),
    flagged: () => flaggedList(listing, packs, map()),
    progress: (id) => (packs.get(id) ? packProgress(packs.get(id), map()) : null),
    reload: () => Promise.resolve(log.load ? log.load() : null).catch(() => {}),
    startPolling: () => log.startPolling?.(),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    destroy: () => { dead = true; subs.clear(); offLog?.(); log.destroy?.(); },
  };
}
