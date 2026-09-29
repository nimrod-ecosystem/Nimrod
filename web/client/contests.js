// contests.js — "I THINK THIS QUESTION IS WRONG", from any game, held until a person looks.
//
// Mike, 2026-09-28: "Maybe add a contest button to the questions? In case you think it's wrong when
// you're playing." After a question is answered (right or wrong) in the Lessons quiz, in Trivia and
// in Word Forge, the player can contest it. A contest:
//   * never changes points already earned or the answer that was recorded, and is never a wrong
//     answer — this file opens ONE stream, its own, and nothing here can reach the points ledger or
//     the trial log (PRINCIPLES.md: being wrong must not cost anything; neither must saying so);
//   * is recorded here, append-only, with which screen raised it, the question, its answer, its
//     source line when it has one, and the time;
//   * HOLDS the question out of this profile's decks until a person clears it (Lessons' review list:
//     "Contested while playing", Clear / Keep out).
//
// *** ONE SHARED, PER-PROFILE STREAM, ARGUED. *** The transcript-lessons log (transcript_quiz.js)
// already holds flags on generated questions, and a transcript question contested anywhere IS still
// flagged there (modules/lessons.js does it — the pool is built from that log, so that is what keeps
// it out of the routed rows). But Trivia and Word Forge also ask hand-written bank rows and pack
// questions, which have no home in that log and no id at all. Three options were weighed:
//   - a per-GAME stream (Trivia's contests, Word Forge's contests): a question routed to both games
//     would need contesting twice, and the review list would read three logs;
//   - per-INSTANCE events (`ctx.events`): two Trivia panels, or a phone and a desktop, would each
//     hold their own view of what is contested — the review list could not find them at all;
//   - one well-known per-PROFILE stream, reached with `ctx.makeEvents(CONTESTS_STREAM)` the same
//     way `points` and `lessons` already are. Chosen: every game and the review list read one log,
//     a question contested in Trivia is held in Word Forge too, and append-only means two devices
//     clearing and contesting at once cannot silently undo each other (the same reason the unlock
//     log and the review log are logs and not state documents).
//
// *** THE KEY: the question's text AND its right answer, normalized, hashed. ***
//   - Not an id: bank rows and pack items have none, and a position would re-point every contest
//     the moment somebody reorders their bank.
//   - The question as the player SAW it, normalized the way `grounded` compares text (case,
//     punctuation, spacing, `1,500` = `1500`), so "What is 2+2?" and "what is 2 + 2" are one question.
//   - WITH the answer, for two reasons found while building this: Word Forge asks every sentence
//     pair with the same prompt ("Which sentence is better writing?"), so text alone would hold all
//     of them at once; and a caregiver who FIXES a wrong answer in their bank gets the corrected row
//     back in play by itself — what was contested was that question with that answer, not the words
//     of the question. The cost: fixing only a wrong DISTRACTOR leaves the key unchanged, so that
//     row stays held until somebody presses Clear, which is the review list's job anyway.
//   - Hashed (FNV-1a, like `questionId`) so a long sentence pair is not a key; the event keeps the
//     readable question and answer beside it for the review list.
//   A question routed to both games (a pack or transcript question) has the same text and answer in
//   both, so one contest holds it in both. A word Word Forge asks two ways (meaning / fill the blank)
//   is keyed by the WORD in Word Forge (see wordforge.js), so either way of asking holds both.
//
// WHO: there are no accounts or roles yet (row 2.21's guardian lock is unbuilt), so a contest does
// not claim one. It records which screen raised it (`module`), which is true, and nothing that isn't.

import { normalizeText } from './transcript_quiz.js';

export const CONTESTS_STREAM = 'contests';
// Bus nudge, like `lesson/unlocked`: another panel on the same screen refreshes at once rather than
// on its next poll. Published after the row is written, never instead of it.
export const CONTEST_TOPIC = 'contest/changed';
export const CONTEST_KINDS = Object.freeze({
  CONTEST: 'contest',     // { key, module, question, answer, source?, chosen?, qid?, at, cid }
  CLEAR: 'clear',         // { key }  a person put it back
  KEEP_OUT: 'keep-out',   // { key }  a person agreed: it stays out
});
export const CONTEST_STATUS = Object.freeze({ HELD: 'held', CLEARED: 'cleared', KEPT_OUT: 'kept-out' });

// FNV-1a, 32-bit, base 36 — the same non-security hash transcript_quiz.js uses for question ids.
function hash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The key a contest holds a question by (see the header). '' when there is no question. */
export function contestKey(question, answer) {
  const q = normalizeText(question);
  if (!q) return '';
  return `c-${hash(`${q}|${normalizeText(answer)}`)}`;
}

// Server ids are increasing integers; order by them when every row has one (the cache can hold rows
// in neither order — see transcript_quiz.js `chronological`), else keep the order given.
function chronological(events) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === 'object');
  if (list.length && list.every((e) => Number.isFinite(Number(e.id)))) return [...list].sort((a, b) => Number(a.id) - Number(b.id));
  return list;
}

/**
 * Every contested question, oldest first:
 * `{ key, question, answer, source, qid, status, modules, contests: [{ module, at, cid, chosen }], lastAt }`.
 * Latest word wins — a contest holds it, Clear puts it back, Keep out keeps it out — except that a
 * new contest on a question a person already chose to keep out leaves it kept out (the decision was
 * made; asking again would only put it back in front of them). Never throws.
 */
export function contestsFrom(events) {
  const byKey = new Map();
  for (const e of chronological(events)) {
    const d = (e && e.data) || {};
    const key = typeof d.key === 'string' ? d.key : '';
    if (!key) continue;
    if (e.kind === CONTEST_KINDS.CONTEST) {
      if (!d.question || !d.module) continue;
      let c = byKey.get(key);
      if (!c) {
        c = { key, question: String(d.question), answer: String(d.answer ?? ''), source: '', qid: null,
          status: CONTEST_STATUS.HELD, modules: [], contests: [], lastAt: null };
        byKey.set(key, c);
      }
      if (d.source) c.source = String(d.source);
      if (d.qid) c.qid = String(d.qid);
      if (!c.modules.includes(d.module)) c.modules.push(String(d.module));
      c.contests.push({ module: String(d.module), at: d.at || e.created_at || null, cid: d.cid || null,
        chosen: d.chosen ?? null });
      c.lastAt = d.at || e.created_at || c.lastAt;
      if (c.status !== CONTEST_STATUS.KEPT_OUT) c.status = CONTEST_STATUS.HELD;
    } else if (e.kind === CONTEST_KINDS.CLEAR) {
      const c = byKey.get(key); if (c) c.status = CONTEST_STATUS.CLEARED;
    } else if (e.kind === CONTEST_KINDS.KEEP_OUT) {
      const c = byKey.get(key); if (c) c.status = CONTEST_STATUS.KEPT_OUT;
    }
  }
  return [...byKey.values()];
}

/** The keys a deck must leave out: still waiting for a person, or kept out by one. */
export function heldKeys(events) {
  return new Set(contestsFrom(events).filter((c) => c.status !== CONTEST_STATUS.CLEARED).map((c) => c.key));
}

const newCid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The live handle — the same shape as `createLessons` (`load`/`startPolling`/`subscribe`/`get`/
 * `destroy`). Polled slowly by default: a contest from another device is not a race, and the games
 * only consult it when a round is dealt.
 */
export function createContests({ makeEvents, bus = null, limit = 1000, pollMs = 15000 } = {}) {
  if (typeof makeEvents !== 'function') throw new Error('createContests: ctx.makeEvents is required');
  const stream = makeEvents(CONTESTS_STREAM, { limit, pollMs });
  const events = () => (stream.get() && stream.get().events) || [];

  // Resolves to what was written, or null — never throws into a game: a contest that could not be
  // saved must not break the question on screen (the caller says so rather than pretending).
  async function write(kind, data) {
    try {
      await stream.append(kind, data);
      if (bus) bus.publish(CONTEST_TOPIC, { kind, key: data.key });
      return data;
    } catch (err) {
      console.error('contests: could not record', err);
      return null;
    }
  }

  // `key` is for a game whose deck item is not the question shown (Word Forge asks one WORD two
  // ways, and keys the word — see its `itemKey`); everyone else lets the question and answer make it.
  async function contest({ module, question, answer = '', source = '', chosen = null, qid = null, key: given = '' } = {}) {
    const key = question ? (given || contestKey(question, answer)) : '';
    if (!key || !module) return null;
    const data = { key, module: String(module), question: String(question), answer: String(answer ?? ''),
      at: new Date().toISOString(), cid: newCid() };
    if (source) data.source = String(source);
    if (chosen != null) data.chosen = String(chosen);
    if (qid) data.qid = String(qid);
    return write(CONTEST_KINDS.CONTEST, data);
  }

  return {
    contest,
    clear: (key) => (key ? write(CONTEST_KINDS.CLEAR, { key: String(key) }) : Promise.resolve(null)),
    keepOut: (key) => (key ? write(CONTEST_KINDS.KEEP_OUT, { key: String(key) }) : Promise.resolve(null)),
    list: () => contestsFrom(events()),
    held: () => heldKeys(events()),
    isHeld: (question, answer) => heldKeys(events()).has(contestKey(question, answer)),
    load: () => stream.load(),
    startPolling: () => stream.startPolling(),
    subscribe: (fn) => stream.subscribe(fn),
    get: () => stream.get(),
    destroy: () => stream.destroy(),
  };
}
