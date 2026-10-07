// question_pick.js — WHICH QUESTION, FOR THIS PLAYER: the shared randomizer, plus how well a question fits them.
//
// Mike, 2026-10-06: "We should be using the same randomizer we use for everything else for the games, but it
// also takes into account the difficulty of questions it asks any user." So a question is drawn through rng.js's
// `pick` - the picker photos and YouTube use, with its freshness (never-asked first), recency (not again too soon)
// and diversity terms - with ONE more factor on each question's weight: how near the player's expected chance of
// getting it right is to the ladder's target (rating.js LADDER_DEFAULTS.target, 80%).
//
//   weight = rng_weight(question) × fit(expected chance for this player)
//
// That is the formula in Code's proposal (docs/for_chat/question_ranking_design_20261006.md, "Choosing the next
// question"). TODAY the expected chance comes from the per-game ladder (one rating per person per game, Elo against
// the question's own rating). The per-subject ranks Mike and chat are discussing would replace only `expectedOf`:
// everything else here stays. That is the seam: `pickQuestion` takes the chance as a function and never asks where
// it came from.
//
// PURE: no DOM, no storage, no clock. `now` and `rand` are passed in, so a suite can draw exactly.

import { pick } from './rng.js';
import { expected, LADDER_DEFAULTS, RATING_DEFAULTS } from './rating.js';

// THE FIT'S SHAPE, argued (each a parameter; nobody playing tunes it, so it is not a setting):
//   target 0.8   the ladder's own target (rating.js): questions somebody gets right about four times in five.
//                Kept the same number so the mix and the games it borrows from aim at the same place.
//   width 0.2    a bell around the target: a question 0.2 off it (60% or 100%) is about a third as likely as one
//                on it, 0.4 off about one in fifty. Narrower and the draw is nearly "the closest question" again
//                (rating.js `choose`), which repeats the same few; wider and difficulty stops mattering.
export const FIT_DEFAULTS = Object.freeze({ target: LADDER_DEFAULTS.target, width: 0.2 });

/** How well an expected chance fits: 1 on the target, falling away either side (a bell curve). PURE. */
export function fitOf(chance, { target = FIT_DEFAULTS.target, width = FIT_DEFAULTS.width } = {}) {
  const e = chance == null || chance === '' ? NaN : Number(chance);
  if (!Number.isFinite(e)) return 1;              // nothing known: no opinion
  const w = Number(width) > 0 ? Number(width) : FIT_DEFAULTS.width;
  const d = (e - Number(target)) / w;
  return Math.exp(-d * d);
}

/** The chance a player of `playerRating` gets a question of `questionRating` right (rating.js Elo). */
export const chanceOf = (playerRating, questionRating, scale = RATING_DEFAULTS.scale) =>
  expected(playerRating, questionRating, scale);

/**
 * ONE QUESTION FROM `cands` ([{ id, ... }]), drawn through rng.js with the fit as one more factor.
 *   expectedOf(c)  this player's chance at candidate c (0..1). THE PART THE PER-SUBJECT RANKS REPLACE.
 *   stats          id -> { n, last }: how often and when THIS player was asked each (rng.js statsFromEvents)
 *   recent         ids asked lately, oldest first (rng.js's hard "not again so soon" and diversity)
 *   channels       id -> a source id (rng.js diversity: not two from one source running), optional
 *   now, rand      injected; target, width  the fit (FIT_DEFAULTS); rng  any rng.js option overrides
 * Returns one of `cands`, or null for none.
 */
export function pickQuestion(cands, { expectedOf = () => null, stats = {}, recent = [], channels = null,
  now = 0, rand = Math.random, target = FIT_DEFAULTS.target, width = FIT_DEFAULTS.width, rng = {} } = {}) {
  const list = (cands || []).filter((c) => c && c.id != null);
  if (!list.length) return null;
  const byId = new Map();
  for (const c of list) if (!byId.has(String(c.id))) byId.set(String(c.id), c);
  const ids = [...byId.keys()];
  const fit = (id) => {
    let e = null;
    try { e = expectedOf(byId.get(id)); } catch { e = null; }
    return fitOf(e, { target, width });
  };
  const id = pick(ids, stats || {}, { now, rand, recent: (recent || []).map(String),
    ...(channels ? { channels } : {}), ...rng, factor: fit });
  return byId.get(id) || null;
}

/**
 * A `chooser` for adaptive_play.js `deal` (its pool is [{ id, rating, item }] and it passes the player's rating):
 * the same draw, with the chance from the ladder's Elo. `statsFor()` / `now()` / `rand` as above.
 */
export function ladderChooser({ statsFor = () => ({}), now = () => 0, rand = Math.random, scale = RATING_DEFAULTS.scale,
  target = FIT_DEFAULTS.target, width = FIT_DEFAULTS.width } = {}) {
  return (pool, { playerRating = RATING_DEFAULTS.start, recentIds = [] } = {}) => pickQuestion(pool, {
    expectedOf: (q) => chanceOf(playerRating, q.rating, scale),
    stats: statsFor(), recent: recentIds, now: now(), rand, target, width,
  });
}

// ---------------------------------------------------------------------------------------------------
// WHAT A RIGHT ANSWER IS WORTH IN THE MIX'S TABLE (Quiz mix, modules/quiz_mix.js)
// ---------------------------------------------------------------------------------------------------
// Mike asked that a mixed table be fair across a skill gap; Code's proposal: "a right answer is worth more the
// harder it was for that player". Kept to one line a caregiver can read:
//
//   a clean right answer:  1 + round(2 × (1 − chance))      chance = this player's expected chance at it
//   right after a miss or a hint: 1           shown or skipped: 0
//
// So a question the player was expected to get (above 75%) is 1, a coin-flip (25%..75%) is 2, and one they were
// expected to miss three times in four is 3. ARGUED, and the case against: the ladder already deals each player
// questions at their OWN level, so most answers land near the same chance for everybody, and the table is fair
// with plain points too - the weighting only tells when somebody reaches above their level. That is what makes it
// worth keeping (a beginner's stretch counts as much as an expert's), and plain points are one setting away.
// Not the 3PL guessing floor from the proposal yet (a yes / no right answer counts the same as a spoken one).
export function turnPoints({ right = false, misses = 0, hintsGiven = 0, revealed = false, skipped = false, chance = null,
  scoring = 'harder' } = {}) {
  if (!right || revealed || skipped) return 0;
  if (scoring === 'plain') return 1;
  if (misses > 0 || hintsGiven > 0) return 1;
  const e = chance == null || chance === '' ? NaN : Number(chance);
  if (!Number.isFinite(e)) return 1;
  return 1 + Math.round(2 * (1 - Math.max(0, Math.min(1, e))));
}
