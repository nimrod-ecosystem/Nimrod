// rating.js — ADAPTIVE DIFFICULTY, ONCE, FOR EVERY GAME THAT ASKS QUESTIONS (row 2.45). PURE.
//
// Mike, 2026-10-01: *"As you get better it gets harder. Maybe like when people are > 80% correct,
// start adding in some more difficult questions and retiring easier ones"*, difficulty PER PLAYER
// "to play against people with a skill gap", and ratings for QUESTIONS as well as players (Elo for
// both; no model training). Spaced review (register 256) belongs here too: a missed or hard item
// comes back on an expanding schedule.
//
// Nothing in this file touches the DOM, storage, a clock or a random source it was not handed, so
// every rule below is a function the suite calls with numbers. `adaptive_play.js` is the part that
// keeps the ladder and talks to a game.
//
// ---------------------------------------------------------------------------------------
// THE DESIGN, AND THE CASE AGAINST IT
// ---------------------------------------------------------------------------------------
// TWO MECHANISMS, ON PURPOSE:
//   1. ELO, for players AND questions. A right answer moves the player up and the question down by
//      how surprising it was. A question everybody misses climbs into a harder band by itself; an
//      AI-written question with no history starts at the band it was written for and finds its own
//      place. This is the "ratings for questions" half of the ruling.
//   2. MIKE'S THRESHOLD, literally. Each player has a FLOOR level per game. Their pool is the bands
//      `floor .. floor + levelsAtOnce - 1`. When the last `judgeOver` answers average ABOVE
//      `moveUpAbove` (0.8), the floor rises one: the next band is added and the lowest retired.
//      Below `moveDownBelow` it falls one.
//   Inside the pool, a question is chosen whose EXPECTED success for this player is nearest the
//   target (the same 0.8), so a player at the top of a band meets that band's harder questions.
//
// FOR: the threshold is the rule Mike stated and a caregiver can understand ("9 of the last 10
// right, so it moved up"); Elo alone would never say why. Elo alone is also tuned to 50% expected
// success (a fair chess game), which is a frustrating rate for somebody relearning; aiming the pick
// at 80% inside the pool keeps it encouraging. Question ratings mean the seed banks' level labels
// are only a starting guess, corrected by play.
// AGAINST: two mechanisms are more to explain than one, and they can disagree for a while (a
// player whose Elo has risen still sits on a floor until the window fills). A pure Elo pick at a
// target rate would adapt more smoothly. Kept both because the threshold is Mike's ruling and the
// Elo half is what makes "two people with a skill gap" comparable on one screen.
//
// ---------------------------------------------------------------------------------------
// THE NUMBERS, EACH ARGUED (every one is a parameter; the game's settings expose the ones a
// caregiver would change)
// ---------------------------------------------------------------------------------------
//   scale 400     Elo's own: a 400-point gap is 10-to-1 odds. Nothing here needs a different
//                 curve, and keeping the standard one means the numbers read like every other Elo.
//   start 1000    a new player's rating, and the centre of level 1. Arbitrary on any Elo scale;
//                 1000 keeps every rating here positive with room below level 1.
//   bandWidth 150 rating points per level. At 400 scale a 150 gap is about 70/30 odds: one level
//                 up is noticeably harder, not a different game. Two levels (300) is about 85/15.
//   kMax 64 / kMin 16 / settle 10
//                 K is how far one answer moves a rating. Chess uses about 40 for a new player and
//                 10-20 once settled [training knowledge]. Here pools are small and a person's skill
//                 can genuinely change week to week (recovery), so the floor is chess's upper value
//                 (16) and a new player or question starts at 64: about 5 surprising answers move a
//                 new player one level, which is "finds their level within one sitting". K falls
//                 smoothly: kMin + (kMax - kMin) * settle / (settle + n), halfway after 10 answers.
//   helpedScore 0.5
//                 a right answer after a hint or a miss. Elo takes any score from 0 to 1; a helped
//                 answer is real but partial evidence. AGAINST: it can read as "half wrong" to a
//                 person who did get there. It is never SHOWN as a score, only used to rate.
//   UNCERTAINTY DAMPING: a brand-new question moves a settled player half as far, and a brand-new
//                 player moves a settled question half as far. Glicko does this properly with a
//                 variance per rating [training knowledge]; this is the cheap version, so a bad
//                 AI-written question cannot knock a player's rating about before it has a rating.

export const RATING_DEFAULTS = Object.freeze({
  start: 1000,
  scale: 400,
  bandWidth: 150,
  kMax: 64,
  kMin: 16,
  settle: 10,
  helpedScore: 0.5,
});

// Mike's numbers (and the two around them). See `adaptive_play.js`'s settings for the argument.
export const LADDER_DEFAULTS = Object.freeze({
  moveUpAbove: 0.8,
  moveDownBelow: 0.5,
  judgeOver: 10,
  levelsAtOnce: 2,
  target: 0.8,
  spread: 4,
  avoidRecent: 4,
});

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const opt = (o = {}) => ({ ...RATING_DEFAULTS, ...(o || {}) });

/** The chance this player gets this question right, 0..1. */
export function expected(playerRating, questionRating, scale = RATING_DEFAULTS.scale) {
  return 1 / (1 + 10 ** ((num(questionRating, 0) - num(playerRating, 0)) / num(scale, 400)));
}

/** 1 for somebody (or something) never rated, falling towards 0 as answers accumulate. */
export function uncertainty(n, settle = RATING_DEFAULTS.settle) {
  const k = Math.max(0, Math.floor(num(n, 0)));
  const s = Math.max(1, num(settle, 10));
  return s / (s + k);
}

/** How far one answer moves a rating that has `n` answers behind it. */
export function kFactor(n, o = {}) {
  const c = opt(o);
  return c.kMin + (c.kMax - c.kMin) * uncertainty(n, c.settle);
}

/** The score one finished question is worth to the rating: 1 clean, `helpedScore` helped, 0 missed. */
export function scoreOf(outcome, o = {}) {
  if (outcome === 'clean') return 1;
  if (outcome === 'helped') return opt(o).helpedScore;
  return 0;
}

/**
 * ONE ANSWER, BOTH RATINGS. `player` and `question` are `{ rating, n }` (missing = new).
 * `score` 0..1. Returns new copies and what happened; never mutates.
 */
export function rateAnswer(player = {}, question = {}, score = 0, o = {}) {
  const c = opt(o);
  const rp = num(player?.rating, c.start);
  const rq = num(question?.rating, c.start);
  const np = Math.max(0, Math.floor(num(player?.n, 0)));
  const nq = Math.max(0, Math.floor(num(question?.n, 0)));
  const s = Math.max(0, Math.min(1, num(score, 0)));
  const e = expected(rp, rq, c.scale);
  const kp = kFactor(np, c) * (1 - 0.5 * uncertainty(nq, c.settle));
  const kq = kFactor(nq, c) * (1 - 0.5 * uncertainty(np, c.settle));
  const dp = kp * (s - e);
  return {
    player: { rating: rp + dp, n: np + 1 },
    question: { rating: rq - kq * (s - e), n: nq + 1 },
    expected: e,
    change: dp,
  };
}

// ---------------------------------------------------------------------------------------
// LEVELS AND BANDS
// ---------------------------------------------------------------------------------------

/** The rating at the centre of a level: where a seed question written "for level 3" starts. */
export function levelRating(level, o = {}) {
  const c = opt(o);
  return c.start + (Math.max(1, Math.floor(num(level, 1))) - 1) * c.bandWidth;
}

/** The level a rating sits in (1 is the floor; nothing is below level 1). */
export function levelOf(rating, o = {}) {
  const c = opt(o);
  return Math.max(1, 1 + Math.round((num(rating, c.start) - c.start) / c.bandWidth));
}

/** The levels a player's pool covers right now. */
export function poolLevels(floor, levelsAtOnce = LADDER_DEFAULTS.levelsAtOnce, maxLevel = Infinity) {
  const span = Math.max(1, Math.floor(num(levelsAtOnce, 2)));
  const top = Number.isFinite(maxLevel) ? Math.max(1, Math.floor(maxLevel)) : Infinity;
  const lo = Math.max(1, Math.min(Math.floor(num(floor, 1)), top));
  const hi = Math.min(top, lo + span - 1);
  return { lo, hi };
}

/**
 * THE POOL: questions whose CURRENT rating falls in the player's levels. A question's level is read
 * from its rating, not from the label it was written with, so a "level 2" question everybody misses
 * drifts out of level 2 by itself.
 *   questions  [{ id, rating }]
 */
export function poolFor(questions = [], floor = 1, o = {}) {
  const c = { ...LADDER_DEFAULTS, ...opt(o), ...(o || {}) };
  const { lo, hi } = poolLevels(floor, c.levelsAtOnce, c.maxLevel);
  return (questions || []).filter((q) => {
    const l = Math.min(levelOf(q.rating, c), Number.isFinite(c.maxLevel) ? c.maxLevel : Infinity);
    return l >= lo && l <= hi;
  });
}

/** The average score over the last `judgeOver` answers, or null while there are fewer. */
export function recentRate(recent = [], judgeOver = LADDER_DEFAULTS.judgeOver) {
  const n = Math.max(1, Math.floor(num(judgeOver, 10)));
  const r = (recent || []).filter((x) => Number.isFinite(Number(x))).map(Number);
  if (r.length < n) return null;
  const last = r.slice(-n);
  return last.reduce((a, b) => a + b, 0) / n;
}

/**
 * MIKE'S RULE. 'up' when the recent rate is ABOVE `moveUpAbove` (strictly: "> 80%", so 9 of 10),
 * 'down' when below `moveDownBelow` (0 turns moving down off), else null.
 */
export function judgeWindow(recent = [], o = {}) {
  const c = { ...LADDER_DEFAULTS, ...(o || {}) };
  const rate = recentRate(recent, c.judgeOver);
  if (rate == null) return null;
  if (rate > num(c.moveUpAbove, 0.8)) return 'up';
  if (num(c.moveDownBelow, 0) > 0 && rate < num(c.moveDownBelow, 0)) return 'down';
  return null;
}

/**
 * A player's floor after one more answer. Returns `{ floor, recent, moved }`; the window starts
 * again after a move, so one good streak moves one level, not three.
 */
export function stepFloor({ floor = 1, recent = [] } = {}, score = 0, o = {}) {
  const c = { ...LADDER_DEFAULTS, ...(o || {}) };
  const keep = Math.max(1, Math.floor(num(c.judgeOver, 10)));
  const next = [...(recent || []), Math.max(0, Math.min(1, num(score, 0)))].slice(-keep);
  const dir = judgeWindow(next, c);
  const top = Number.isFinite(c.maxLevel) ? Math.max(1, Math.floor(c.maxLevel)) : Infinity;
  const f = Math.max(1, Math.floor(num(floor, 1)));
  if (dir === 'up' && f < top) return { floor: f + 1, recent: [], moved: 'up' };
  if (dir === 'down' && f > 1) return { floor: f - 1, recent: [], moved: 'down' };
  return { floor: f, recent: next, moved: null };
}

/**
 * CHOOSE ONE: the questions whose expected success for this player is nearest `target`, the best
 * `spread` of them, one at random. Anything asked in the last `avoidRecent` turns is left out
 * unless that would leave nothing. Returns the question or null.
 */
export function choose(questions = [], { playerRating = RATING_DEFAULTS.start, recentIds = [], rand = Math.random,
  ...o } = {}) {
  const c = { ...LADDER_DEFAULTS, ...opt(o), ...(o || {}) };
  const list = (questions || []).filter(Boolean);
  if (!list.length) return null;
  const avoid = new Set((recentIds || []).slice(-Math.max(0, Math.floor(num(c.avoidRecent, 0)))));
  const fresh = list.filter((q) => !avoid.has(q.id));
  const from = fresh.length ? fresh : list;
  const t = num(c.target, 0.8);
  const ranked = from.map((q) => ({ q, d: Math.abs(expected(playerRating, q.rating, c.scale) - t) }))
    .sort((a, b) => a.d - b.d || String(a.q.id).localeCompare(String(b.q.id)));
  const best = ranked.slice(0, Math.max(1, Math.floor(num(c.spread, 4))));
  const i = Math.min(best.length - 1, Math.floor(num(rand(), 0) * best.length));
  return best[Math.max(0, i)].q;
}

// ---------------------------------------------------------------------------------------
// SPACED REVIEW (register 256) — a missed or hard item comes back, further apart each time
// ---------------------------------------------------------------------------------------
//
// THE SCHEDULE, ARGUED. A step is either `{ q: n }` (after n more questions in this sitting) or
// `{ d: n }` (n days later). 'standard' is: 2 questions, 5 questions, then 1, 3, 7, 14, 30 days.
//   * The in-sitting steps are SPACED RETRIEVAL, the memory technique speech therapists use after
//     brain injury and in dementia care: recall at expanding intervals, starting short enough that
//     the answer is still in reach [training knowledge]. Clinicians count it in seconds (15 s, 30 s,
//     1 min, 2 min ...); a game asks a question every 20-60 seconds, so "2 questions, then 5" is
//     that ladder in the unit a game has. Asking it AGAIN at once would test repetition, not recall.
//   * The day steps are the common expanding schedule (each gap roughly double the last, the
//     Leitner box / SM-2 shape) [training knowledge], ending at a month, after which the item is
//     taken as learned and leaves the review list. AGAINST: a month is long for somebody whose
//     memory is the thing being worked on; 'days' and 'off' are the other choices, and the steps
//     are data, so a therapist's own schedule is one array.
//   * WHAT RESETS IT: a miss, or a right answer that needed a hint, puts the item back at step 0.
//     A clean right answer when it is DUE moves it one step on. A clean answer before it was due
//     changes nothing (it was not a review).
export const REVIEW_SCHEDULES = Object.freeze({
  standard: Object.freeze([{ q: 2 }, { q: 5 }, { d: 1 }, { d: 3 }, { d: 7 }, { d: 14 }, { d: 30 }]),
  days: Object.freeze([{ d: 1 }, { d: 3 }, { d: 7 }, { d: 14 }, { d: 30 }]),
  off: Object.freeze([]),
});
export const DAY_MS = 24 * 60 * 60 * 1000;

const stepsOf = (steps) => (Array.isArray(steps) ? steps : (REVIEW_SCHEDULES[steps] || REVIEW_SCHEDULES.standard));

function dueAtStep(i, steps, { now = 0, asked = 0, sitting = null } = {}) {
  const s = steps[i];
  if (s && Number(s.q) > 0) return { step: i, dueAsked: asked + Number(s.q), dueAt: now, sitting };
  const days = Number(s?.d) > 0 ? Number(s.d) : 1;
  return { step: i, dueAsked: null, dueAt: now + days * DAY_MS, sitting };
}

/** Is a review entry due now? */
export function isDue(entry, { now = 0, asked = 0, sitting = null } = {}) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.dueAsked != null && entry.sitting != null && entry.sitting === sitting) return asked >= entry.dueAsked;
  // A question-count step from an earlier sitting is due as soon as a new sitting starts.
  return now >= num(entry.dueAt, 0);
}

/**
 * The review entry after one finished question, or null when the item has nothing to review
 * (never missed, or learned off the end of the schedule, or review is off).
 *   outcome  'clean' | 'helped' | 'missed'
 */
export function scheduleReview(entry, outcome, { now = 0, asked = 0, sitting = null, steps = 'standard' } = {}) {
  const list = stepsOf(steps);
  if (!list.length) return null;
  const at = { now, asked, sitting };
  if (outcome === 'helped' || outcome === 'missed') return dueAtStep(0, list, at);
  if (!entry) return null;
  if (!isDue(entry, at)) return entry;
  const next = num(entry.step, 0) + 1;
  if (next >= list.length) return null;
  return dueAtStep(next, list, at);
}

/** The ids due now, most overdue first. `review` is `{ id: entry }`. */
export function dueIds(review = {}, at = {}) {
  return Object.entries(review || {})
    .filter(([, e]) => isDue(e, at))
    .sort(([, a], [, b]) => {
      const qa = a.dueAsked != null && a.sitting === at.sitting;
      const qb = b.dueAsked != null && b.sitting === at.sitting;
      if (qa && qb) return a.dueAsked - b.dueAsked;
      if (qa !== qb) return qa ? -1 : 1;
      return num(a.dueAt, 0) - num(b.dueAt, 0);
    })
    .map(([id]) => id);
}

/** The outcome word for one finished question, from what the quiz engine reports. */
export function outcomeOf({ right = false, misses = 0, hintsGiven = 0 } = {}) {
  if (!right) return 'missed';
  return (misses > 0 || hintsGiven > 0) ? 'helped' : 'clean';
}
