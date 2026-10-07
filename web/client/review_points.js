// review_points.js — POINTS FOR REVIEWING QUESTIONS: what a review pays, who it pays, and the rules that keep it
// from being farmed.
//
// Mike, 2026-10-06: *"I'm thinking about maybe having Oscar review questions for his schoolwork. There should
// also be education points awarded for reviewing questions as well. That can be a feature for everyone to
// incentivize reviewing their own questions. Maybe clicking on the wiki link gives points as well as the review."*
//
// =====================================================================================================
// THE RULES, each argued, each a default (Rule 1) with its setting on the Nimrod Game page (unlocks.js):
//
// 1. WHAT IS WRITTEN: one ordinary points award (points.js `award`), type `Bonus`, source `reviews`, tagged with
//    the question's review key. Bonus feeds the School currency, exactly like a right answer in Trivia and the
//    tour's learning-on pay. WITH LEARNING OFF the record is the same and is COUNTED as game points — unlocks.js
//    decision 6 ("the switches change how that one record is counted, not what was written"). Argued:
//      FOR writing Play when learning is off: the record would say plainly it was a game point.
//      AGAINST, and it wins: decision 6's own reasons — a record that depends on a switch's position the day it
//      was written cannot be re-counted when somebody turns learning on later, and every other learning-ish
//      award (Trivia, Word Forge, lessons) already writes School and lets the switches count it.
//    NOT the `School` type: that one is focused school TIME and carries minutes the weekly hours engine counts.
//    A review is a decision, not a minute of a subject, and a press that claimed school hours would be the one
//    farming that costs something real (a homeschool hours record). [Guess, on Mike's list.]
//    PAID WHATEVER THE SWITCHES, like a game's right answers (unlocks.js decision 7: "games keep paying as they
//    always have"). Reviewing by playing happens inside Trivia, which pays for the answer anyway; a review that
//    paid only with a switch on, beside an answer that pays always, would be the odd one out.
//
// 2. WHO IT PAYS: the points of the SCREEN the review was done for — the same ledger every game pays into
//    (points.js: the ledger is per screen, and a screen belongs to one person). In Trivia that is the screen the
//    panel is on, exactly as Trivia's own answers are paid. On /reviews.html it is the screen the page says
//    ("Who is reviewing", then "Points are kept on"), so Oscar reviewing on the family login earns Oscar's.
//
// 3. *** THE SAME POINTS WHATEVER THE VERDICT. *** "Looks right", "Something is wrong" and "Fixed — ask it
//    again" each pay the same, once. A points rule that paid more for a pass would pay people to pass wrong
//    questions — the exact thing review exists to catch.
//
// 4. *** ONCE PER QUESTION, PER SCREEN. *** A question that has paid is never paid again on that screen's
//    points, whatever is pressed later (read from the ledger's own tags; the ledger is the only record). A
//    question somebody else on the login reviewed is already reviewed for everyone, so it is not offered to
//    review again — that is pack_reviews.js's rule, not a points rule. KNOWN BOUND: the ledger reads its newest
//    1000 events; a question reviewed longer ago than that could pay again, but only if it came back for review
//    ("Fixed — ask it again" puts it back), which is itself new work.
//
// 5. *** A REVIEW MUST BE A LOOK, NOT A PRESS. *** No points when the verdict comes less than `reviewMinSeconds`
//    (default 5) after the question went up — or, where the page cannot say when it went up (Trivia), after the
//    reviewer's previous verdict. The verdict itself is always saved; only the points are held back, and the page
//    says why. Skipping pays nothing (pack_reviews.js: a skipped question was not looked at). Argued: FOR no
//    timer — a fast reader on an easy question is honest. AGAINST, and it wins as the default: reading a question,
//    its options and the marked answer takes longer than five seconds for nearly anybody, and the cost to the
//    fast reader is one point, never the review. `0` turns it off.
//
// 6. *** OPENING THE SOURCE ADDS A SMALLER AMOUNT — ONCE, AND ONLY WITH A VERDICT. *** Opening a question's
//    "Where this comes from" link pays `reviewSourcePoints` (default 0.5) once per question, when that question
//    also gets a verdict (before or after the click, in the same sitting). Argued: FOR paying on the click alone
//    (Mike: "clicking on the wiki link gives points") — simple, and it is the click that is the good habit.
//    AGAINST, and it wins: a click alone is "opening and leaving" — a whole pack's links could be clicked in a
//    minute without reading one question. Tied to a verdict, the click still pays, but only as part of a real
//    review. ON A SCREEN nothing opens (page_links.js), so the source bonus cannot be earned there: a QR code
//    scanned on a phone is not something this page can see.
//
// 7. *** A DAILY CAP: `reviewDailyCap` (default 50) points a day from reviewing, per screen. *** The same idea as
//    points.js's per-game daily cap: reviewing is real work, but it must not become the screen's main income.
//    Fifty is roughly forty questions with their sources checked — a solid sitting for a schoolday. `0` is no
//    limit. A review over the cap is still saved; the page says the day's review points are all earned.
// =====================================================================================================

import { PROFILE_SETTINGS_KEY } from './lessons.js';
import { pointsEvents, sumPointsOnBySource, todayKey } from './points.js';

// An AMOUNT earned, in words: exact to two places. Not points.js `fmtPoints`, which floors anything over 1 because
// it is for balances (a balance shown higher than it is would promise what it cannot buy); 1.5 earned is 1.5.
export const fmtAmount = (n) => { const v = Number(n); return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0'; };

export const REVIEW_POINTS_SOURCE = 'reviews';
// unlocks.js GAME_SETTINGS_KEY: the Nimrod Game's own numbers live under it on the screen's settings document, and
// these four live beside its tour and unlock numbers. Written here rather than imported (unlocks.js imports THIS
// file, to draw the rows); review_points_test.html checks the two agree.
export const GAME_SETTINGS_KEY = 'nimrodGame';

export const REVIEW_POINT_DEFAULTS = Object.freeze({
  reviewPoints: 1,            // rule 3: a right answer's worth in Trivia, the ledger's "one small win"
  reviewSourcePoints: 0.5,    // rule 6: smaller, as asked ("as well as the review")
  reviewDailyCap: 50,         // rule 7: 0 = no limit
  reviewMinSeconds: 5,        // rule 5: 0 = no wait
});
export const REVIEW_POINT_CHOICES = Object.freeze({
  reviewPoints: Object.freeze([0, 0.5, 1, 2, 5]),
  reviewSourcePoints: Object.freeze([0, 0.25, 0.5, 1, 2]),
  reviewDailyCap: Object.freeze([0, 20, 50, 100]),
  reviewMinSeconds: Object.freeze([0, 3, 5, 10, 20]),
});
// The rows on the Nimrod Game page, in order: [key, label, (value) -> words].
export const REVIEW_POINT_ROWS = Object.freeze([
  ['reviewPoints', 'Points for each question reviewed', (n) => (n === 0 ? 'None' : `${fmtAmount(n)}`)],
  ['reviewSourcePoints', 'More for opening where a question comes from', (n) => (n === 0 ? 'None' : `${fmtAmount(n)} more`)],
  ['reviewDailyCap', 'Most review points in one day', (n) => (n === 0 ? 'No limit' : `${n}`)],
  ['reviewMinSeconds', 'No points for a review quicker than', (n) => (n === 0 ? 'Any speed counts' : `${n} seconds`)],
]);

/** The four numbers from the Nimrod Game's saved object (`settings.nimrodGame`); anything unusable is its default. */
export function reviewPointPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, d] of Object.entries(REVIEW_POINT_DEFAULTS)) {
    const n = Number(r[k]);
    out[k] = r[k] !== null && r[k] !== '' && r[k] !== undefined && Number.isFinite(n) && n >= 0 ? n : d;
  }
  return out;
}
/** The same, from the whole settings document. */
export const reviewPrefsFromSettings = (values) => reviewPointPrefs((values || {})[GAME_SETTINGS_KEY]);

export const verdictTag = (key) => `review:${key}`;
export const sourceTag = (key) => `review-source:${key}`;

/** Has this question already paid this kind of review point on this screen? (Rule 4: the ledger is the record.) */
export function reviewPaid(events, tag) {
  return pointsEvents(events).some((e) => e.data && e.data.source === REVIEW_POINTS_SOURCE
    && Array.isArray(e.data.tags) && e.data.tags.includes(tag));
}

/** How much of today's cap is left (Infinity with no cap). Never below 0. */
export function capLeft(events, cap, now = Date.now()) {
  const c = Number(cap);
  if (!(c > 0)) return Infinity;
  return Math.max(0, c - sumPointsOnBySource(events, todayKey(now), REVIEW_POINTS_SOURCE));
}

/**
 * WHAT ONE VERDICT PAYS (pure). `{ amount, reason }` — reason null when it pays, else one of:
 *   'off'      the setting is 0           'too-fast'  rule 5
 *   'paid'     this question already paid 'cap'       rule 7, nothing left today
 * `lookedMs`: how long the question was looked at (null = unknown, and then it is not held against anybody).
 */
export function verdictPay({ events = [], key, prefs = REVIEW_POINT_DEFAULTS, lookedMs = null, now = Date.now(), paidHere = null } = {}) {
  const p = { ...REVIEW_POINT_DEFAULTS, ...(prefs || {}) };
  if (!(p.reviewPoints > 0)) return { amount: 0, reason: 'off' };
  if ((paidHere && paidHere.has(verdictTag(key))) || reviewPaid(events, verdictTag(key))) return { amount: 0, reason: 'paid' };
  if (p.reviewMinSeconds > 0 && lookedMs != null && lookedMs < p.reviewMinSeconds * 1000) return { amount: 0, reason: 'too-fast' };
  const left = capLeft(events, p.reviewDailyCap, now);
  if (!(left > 0)) return { amount: 0, reason: 'cap' };
  return { amount: Math.min(p.reviewPoints, left), reason: null };
}

/** What opening a question's source pays, once that question has a verdict (rule 6). Same shape as verdictPay. */
export function sourcePay({ events = [], key, prefs = REVIEW_POINT_DEFAULTS, now = Date.now(), paidHere = null } = {}) {
  const p = { ...REVIEW_POINT_DEFAULTS, ...(prefs || {}) };
  if (!(p.reviewSourcePoints > 0)) return { amount: 0, reason: 'off' };
  if ((paidHere && paidHere.has(sourceTag(key))) || reviewPaid(events, sourceTag(key))) return { amount: 0, reason: 'paid' };
  const left = capLeft(events, p.reviewDailyCap, now);
  if (!(left > 0)) return { amount: 0, reason: 'cap' };
  return { amount: Math.min(p.reviewSourcePoints, left), reason: null };
}

/** The page's words for what a verdict earned. `name` is the person; '' when there is nobody to name. */
export function paidWords(result, { name = '' } = {}) {
  if (!result) return '';
  const who = name ? ` for ${name}` : '';
  const total = (result.amount || 0) + (result.source?.amount || 0);
  if (total > 0) {
    const src = result.source?.amount > 0 ? ` (${fmtAmount(result.source.amount)} of it for opening where it comes from)` : '';
    return `+${fmtAmount(total)} point${total === 1 ? '' : 's'}${who}${src}.`;
  }
  switch (result.reason) {
    case 'too-fast': return 'No points for that one: it was quicker than the wait for a real look. The review still counts.';
    case 'paid': return 'No points: this question has already earned its review points.';
    case 'cap': return 'No points: today’s review points are all earned. The review still counts.';
    case 'off': return '';
    default: return '';
  }
}

/**
 * THE TRACKER: pays one screen's ledger for reviews done through it. `ledger` is a points.js ledger;
 * `settings` a state handle on that screen's settings document (or null: the defaults). `sourcesOf(key)` lists
 * a question's source addresses (pack_reviews.js knows them). `now` for a suite.
 *
 *   shown(key)              a question went up for review (the look timer starts; rule 5)
 *   decided(key, {question}) a verdict was saved -> { amount, reason, source }   (never throws)
 *   opened(url, key?)       a source link was opened; pays with that question's verdict (rule 6)
 *   last()                  the most recent result, for the page's words
 */
export function createReviewPoints({ ledger, settings = null, sourcesOf = () => [], now = () => Date.now() } = {}) {
  if (!ledger || typeof ledger.award !== 'function') throw new Error('createReviewPoints: a points ledger is required');
  const ready = Promise.allSettled([ledger.load?.(), settings?.load?.()]);
  const paidHere = new Set();     // paid by THIS tracker, before the append is back in the window
  const opened = new Map();       // url -> when it was opened, this sitting
  const decidedAt = new Map();    // key -> when its verdict was saved, this sitting
  let shownKey = null;
  let shownAt = null;
  let lastVerdictAt = now();      // rule 5's fallback: since the reviewer's previous verdict (or since starting)
  let lastResult = null;
  let chain = Promise.resolve();  // one award at a time, so two quick presses cannot both pass the cap check
  const subs = new Set();         // told after anything is paid (a page redraws what it says)
  const changed = () => { for (const fn of [...subs]) { try { fn(lastResult); } catch (err) { console.error('review points: subscriber', err); } } };
  const prefs = () => { try { return reviewPrefsFromSettings(settings?.get?.() || {}); } catch { return { ...REVIEW_POINT_DEFAULTS }; } };
  const events = () => { try { return ledger.events ? ledger.events() : []; } catch { return []; } };
  const urlsOf = (key) => { try { return (sourcesOf(key) || []).filter(Boolean); } catch { return []; } };
  const queue = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  async function award(tag, amount, key, question, what) {
    paidHere.add(tag);
    try {
      await ledger.award({ amount, type: 'Bonus', source: REVIEW_POINTS_SOURCE,
        tags: ['review', tag], note: `${what}: ${String(question || key).slice(0, 200)}` });
      return true;
    } catch (err) { paidHere.delete(tag); console.error('review points: could not record', err); return false; }
  }

  async function paySource(key, question) {
    const s = sourcePay({ events: events(), key, prefs: prefs(), now: now(), paidHere });
    if (s.amount > 0 && !(await award(sourceTag(key), s.amount, key, question, 'Checked where a question comes from'))) {
      return { amount: 0, reason: 'failed' };
    }
    return s;
  }

  return {
    ready,
    shown(key) { shownKey = key || null; shownAt = now(); },
    decided(key, { question = '' } = {}) {
      return queue(async () => {
        await ready;
        if (!key) return null;
        const t = now();
        const since = shownKey === key && shownAt != null ? shownAt : lastVerdictAt;
        lastVerdictAt = t;
        decidedAt.delete(key);      // re-set, so the Map's order stays "most recently decided last"
        decidedAt.set(key, t);
        const v = verdictPay({ events: events(), key, prefs: prefs(), lookedMs: t - since, now: t, paidHere });
        let result = { ...v };
        if (v.amount > 0 && !(await award(verdictTag(key), v.amount, key, question, 'Reviewed a question'))) {
          result = { amount: 0, reason: 'failed' };
        }
        // Rule 6: a source of THIS question opened this sitting (before the verdict) pays now.
        const urls = urlsOf(key);
        if (urls.some((u) => opened.has(u))) result.source = await paySource(key, question);
        lastResult = { key, ...result };
        changed();
        return lastResult;
      });
    },
    opened(url, key = null) {
      const u = String(url || '');
      if (!u) return Promise.resolve(null);
      opened.set(u, now());
      // Opened AFTER the verdict: pays now, against the question it belongs to (named, or the most recently
      // decided one whose sources include it). Opened before one: it waits for that question's verdict.
      const k = key || [...decidedAt.keys()].reverse().find((d) => urlsOf(d).includes(u)) || null;
      if (!k || !decidedAt.has(k)) return Promise.resolve(null);
      return queue(async () => {
        await ready;
        const s = await paySource(k, '');
        if (s.amount > 0) {
          if (lastResult && lastResult.key === k) lastResult = { ...lastResult, source: s };
          changed();
        }
        return s;
      });
    },
    last: () => lastResult,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    prefs,
    todayEarned: () => sumPointsOnBySource(events(), todayKey(now()), REVIEW_POINTS_SOURCE),
  };
}
