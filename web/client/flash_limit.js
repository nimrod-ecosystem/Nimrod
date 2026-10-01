// flash_limit.js — HOW MANY TIMES A SECOND ANYTHING ON THIS SCREEN MAY FLASH. One setting, one helper.
//
// MIKE_CHANGE_LIST.md rows 2.43 + 2.48. Every repeated visible change on the screen (a tile lighting, a
// pulse, a wave on a colour, a sign flickering) reads its period from here:
//
//   flashLimit(ctx)                 what a MODULE calls. Reads `ctx.flashLimitPerSecond` (a value or a
//                                   getter the host supplies). A host that supplies nothing: no limit.
//   flashProfile(ctx)               the same, plus whether the WCAG 2.3.1 small-or-faint exception is on.
//   flashLimitFrom(rows, layer)     what the HOST calls: the screen's and the person's settings rows,
//                                   with the starting-defaults layer filling only what nobody chose
//                                   (`withStartingDefaults`, so "defaults, never locks" still holds).
//   minFlashPeriodMs(limit, {jitterMs, belowThreshold})  the shortest gap between two repeats. 0 = none.
//   maxPerMinute(limit)             the same, as "per minute" (a tempo). Infinity = none.
//
// A "flash" is WCAG's: a pair of opposing changes (lit then dark). Anything that repeats a visible
// change repeats a flash once per period.
//
// ---------------------------------------------------------------------------------------
// *** NO LIMIT BY DEFAULT. THE PHOTOSENSITIVITY BOX SETS ONE; ANYBODY CAN RAISE OR REMOVE IT. ***
// Mike, 2026-10-01, on the old fixed ceiling of 3 that no setting could raise: *"That's only for the
// photosensitivity setting. I wouldn't make it impossible to raise. That cap shouldn't be there for
// everyone though."* So:
//   * a screen nobody set up has NO flash limit - every module runs at its own natural rate;
//   * the "Flashing can cause seizures" starting-default box sets 3 a second, any size (WCAG 2.3.2's
//     form - research decision, note AR: "the default is 2.3.2");
//   * the menu offers: no limit, 3 a second except small or faint flashes (WCAG 2.3.1, the looser
//     published form - "the floor is 2.3.1"), 3, 2 and 1 a second, any size;
//   * NOTHING CLAMPS A CHOICE. A stored 5, or 0.5, is obeyed as 5 or 0.5. Only a value that is not a
//     rate at all (text, a negative, zero, true) is ignored - and an ignored value counts as NOT CHOSEN,
//     so the starting-defaults layer under it still applies (a corrupted row never quietly removes the
//     limit somebody's box set).
//
// WHY ZERO IS NOT "NEVER FLASH": a zero would have to mean "nothing on the screen may ever change twice",
// which no module can honour; "nothing moves" is its own setting (`reduceMotion`). If Mike wants a
// "never flash" toggle it is a separate control, not a number here.
//
// *** WCAG 2.3.1 TODAY BEHAVES AS 3 A SECOND FOR EVERY MODULE. *** Its exception is for flashes below the
// general and red flash thresholds (small area, small luminance change, no saturated red). No module can
// measure its own flash area or luminance change as it draws, so none declares `belowThreshold` yet, and
// every one keeps 3 a second. The choice is still worth offering and recording: it is the published
// floor, and a module that CAN show it is small and faint (a thin outline, say) passes
// `{ belowThreshold: true }` to `minFlashPeriodMs` and is then not limited under it.
//
// *** THE MARGIN: ONE 60 Hz FRAME (or the source's own tick). *** A screen draws whole frames, so a
// change due at time t lands up to one frame late. At exactly three a second four onsets can
// therefore land inside one closed second. So n repeats are spaced so that n gaps exceed a second
// PLUS the jitter: period > (1000 + jitter) / n. For something sampled on a slower tick than the
// frame (automation's LFO re-reads every 100 ms) the tick IS the jitter.
// ---------------------------------------------------------------------------------------

import { withStartingDefaults } from './starting_defaults.js';

export const FLASH_LIMIT_KEY = 'flashLimitPerSecond';
/** The stored value for "no limit" (a settings row goes through JSON, which has no Infinity). */
export const FLASH_NO_LIMIT = 'none';
/** The stored value for WCAG 2.3.1: 3 a second, except flashes below the general and red thresholds. */
export const FLASH_WCAG_231 = 'wcag-2.3.1';
/** The published count both WCAG criteria use, and what the photosensitivity box sets (2.3.2's form). */
export const FLASH_LIMIT_WCAG = 3;
/** What a screen with no setting and no starting default gets: no limit (a normalized limit is a number). */
export const FLASH_LIMIT_DEFAULT = Infinity;
/** One 60 Hz frame: how late a change can land on screen. */
export const FRAME_MS = 1000 / 60;
/** Tempos are offered and shown as round numbers: a per-minute cap rounds DOWN to a multiple of this. */
export const PER_MINUTE_STEP = 5;

/** Is `v` a real flash-limit choice (as opposed to unset or garbage)? */
export function isFlashLimitChoice(v) {
  if (v === FLASH_NO_LIMIT || v === FLASH_WCAG_231 || v === Infinity) return true;
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/**
 * Any value in, a usable limit (flashes a second) out. Infinity = no limit. 'wcag-2.3.1' reads as 3
 * (its exception is only reachable through `flashProfile`). Never clamped; garbage reads as the default.
 */
export function normalizeFlashLimit(v) {
  if (v && typeof v === 'object' && 'perSecond' in v) return normalizeFlashLimit(v.perSecond);
  if (!isFlashLimitChoice(v)) return FLASH_LIMIT_DEFAULT;
  if (v === FLASH_NO_LIMIT || v === Infinity) return Infinity;
  if (v === FLASH_WCAG_231) return FLASH_LIMIT_WCAG;
  return Number(v);
}

/** { perSecond, belowThresholdExempt } - the limit plus whether the WCAG 2.3.1 exception is on. */
export function normalizeFlashProfile(v) {
  if (v && typeof v === 'object' && 'perSecond' in v) {
    return { perSecond: normalizeFlashLimit(v.perSecond), belowThresholdExempt: !!v.belowThresholdExempt };
  }
  return { perSecond: normalizeFlashLimit(v), belowThresholdExempt: v === FLASH_WCAG_231 };
}

const readCtx = (ctx) => {
  try {
    let v = ctx ? ctx[FLASH_LIMIT_KEY] : undefined;
    if (typeof v === 'function') v = v();
    return v;
  } catch { return undefined; }
};

/**
 * THE MODULE'S READ. `ctx.flashLimitPerSecond` may be a value or a function; anything missing or
 * broken is no limit. Read it when you need it (it is a getter on the kiosk, so it follows a change).
 */
export function flashLimit(ctx) { return normalizeFlashLimit(readCtx(ctx)); }
export function flashProfile(ctx) { return normalizeFlashProfile(readCtx(ctx)); }

// Strictness order: the lower rate first; at the same rate, no exception is stricter than 2.3.1's.
const stricter = (a, b) => (a.perSecond !== b.perSecond ? a.perSecond < b.perSecond
  : (!a.belowThresholdExempt && b.belowThresholdExempt));

/**
 * THE HOST'S PROFILE. `rows` is one settings row or a list (the screen's, the person's). A row that
 * CHOSE a value keeps it - the starting-defaults layer fills only when no row did. Where more than one
 * row chose, THE STRICTER WINS: a room screen is seen by everyone in the room, so the lowest limit
 * anybody set is the one that protects them all. (A default, argued, on Mike's list.) A value that is
 * not a rate (garbage) is NOT a choice, so it can never cancel the layer.
 */
export function flashProfileFrom(rows, layer = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter((r) => r && typeof r === 'object');
  const chosen = list.map((r) => r[FLASH_LIMIT_KEY]).filter(isFlashLimitChoice).map(normalizeFlashProfile);
  if (chosen.length) return chosen.reduce((best, p) => (stricter(p, best) ? p : best));
  const fromLayer = withStartingDefaults({}, layer || {})[FLASH_LIMIT_KEY];
  return normalizeFlashProfile(isFlashLimitChoice(fromLayer) ? fromLayer : undefined);
}

/** THE HOST'S READ: the limit (a number; Infinity = none) for these rows over this layer. */
export function flashLimitFrom(rows, layer = {}) { return flashProfileFrom(rows, layer).perSecond; }

/**
 * The shortest period (ms) a repeating visible change may have at `limit` (a number, a stored value or
 * a profile). 0 when there is no limit - and 0 under WCAG 2.3.1 for a caller that passes
 * `belowThreshold: true` (its flash is small and faint; see the header).
 */
export function minFlashPeriodMs(limit, { jitterMs = FRAME_MS, belowThreshold = false } = {}) {
  const p = normalizeFlashProfile(limit);
  if (belowThreshold && p.belowThresholdExempt) return 0;
  if (!Number.isFinite(p.perSecond)) return 0;
  const j = Math.max(0, Number(jitterMs) || 0);
  return (1000 + j) / p.perSecond;
}

/**
 * The most repeats a MINUTE at `limit` (a tempo cap), rounded DOWN to a multiple of PER_MINUTE_STEP.
 * Infinity when there is no limit. At 3: 175 (3 gaps of 60000/175 = 1028.6 ms > 1000 + one frame).
 * At 2: 115. At 1: 55.
 */
export function maxPerMinute(limit, { jitterMs = FRAME_MS, step = PER_MINUTE_STEP } = {}) {
  const period = minFlashPeriodMs(limit, { jitterMs });
  if (!(period > 0)) return Infinity;
  const s = Math.max(1, Number(step) || 1);
  return Math.floor(60000 / period / s) * s;
}

/**
 * THE COUNTER THE SUITES USE: the most onsets inside any CLOSED one-second window (two onsets exactly
 * 1000 ms apart are in the same second - the stricter reading). `times` ascending, in ms.
 */
export function worstInAnySecond(times, windowMs = 1000) {
  const t = [...(times || [])].sort((a, b) => a - b);
  let worst = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i] - t[j] > windowMs) j++;
    worst = Math.max(worst, i - j + 1);
  }
  return worst;
}

/**
 * *** FAILURE BACKOFF: A RUN OF BROKEN ITEMS MUST NOT BECOME A STROBE - FOR EVERYBODY. *** (Photosensitivity
 * audit, 2026-09-30.) Photos, personal videos and YouTube all move on the moment an item errors - right
 * for one broken file, and a strobe when EVERY file is broken: each new item appears, fails in a few
 * milliseconds, and the next replaces it, as fast as the browser can go.
 *
 * *** THIS IS NOT A FLASH SETTING, SO "NO LIMIT" DOES NOT REMOVE IT (argued, 2026-10-01). ***
 *   FOR letting it follow the limit to zero: Mike's ruling is that no cap is there for everyone.
 *   AGAINST, and it wins: the ruling is about effects somebody CHOSE - a fast game, a party light. A
 *   dead folder spinning is a malfunction nobody chose, and it also spins a Pi 400's CPU and the logs.
 *   Nobody is served by it at any limit. So it holds at the published 3-a-second numbers whatever the
 *   limit says, and only a STRICTER limit lengthens it.
 *
 * How long the `streak`-th failure IN A ROW must stay up (from when it appeared) before the next item
 * replaces it:
 *   1st         one 3-a-second period, or the screen's period if longer - 339 ms; 1017 ms at 1 a second
 *   2nd, 3rd... BASE, doubling, capped: 2 s, 4 s, 8 s, 16 s, 30 s, 30 s ...
 *
 * NUMBERS ARGUED (defaults, on Mike's list): BASE 2 s is the photo slideshow's own floor
 * (photos.js scheduleAdvance), so a broken run is never faster than the fastest a working slideshow
 * may go. CAP 30 s: long enough that a dead folder is not a spinner on a Pi 400; short enough that
 * one good item among many broken ones is still reached within a few minutes. The streak resets the
 * moment anything plays properly, so NORMAL TIMING NEVER CHANGES - only a failure is ever held.
 *
 * `failureFloorMs(limit)` is the first hold un-rounded: a clip that ENDS sooner than this after it
 * appeared did not really play (photos.js / personal.js use it for that test).
 */
export const FAIL_BACKOFF_RATE = FLASH_LIMIT_WCAG;
export const FAIL_BACKOFF_BASE_MS = 2000;
export const FAIL_BACKOFF_CAP_MS = 30000;
export function failureFloorMs(limit = FLASH_LIMIT_DEFAULT) {
  return Math.max(minFlashPeriodMs(FAIL_BACKOFF_RATE), minFlashPeriodMs(limit));
}
export function failureBackoffMs(streak, limit = FLASH_LIMIT_DEFAULT) {
  const first = Math.ceil(failureFloorMs(limit));
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  if (n === 1) return first;
  return Math.max(first, Math.min(FAIL_BACKOFF_CAP_MS, FAIL_BACKOFF_BASE_MS * 2 ** (n - 2)));
}

/**
 * The settings row a host's menu shows (the screen's or the person's). Ordered loosest to strictest, so
 * one switch walks it in one direction and wraps. Level 'standard' - a caregiver's setting.
 * Not automatable: a safety setting that a sensor or a wave could change is not one.
 */
export const FLASH_LIMIT_OPTIONS = Object.freeze([
  Object.freeze({ value: FLASH_NO_LIMIT, label: 'No limit' }),
  Object.freeze({ value: FLASH_WCAG_231, label: '3 a second, except small or faint flashes (WCAG 2.3.1)' }),
  Object.freeze({ value: 3, label: '3 a second, any size (WCAG 2.3.2)' }),
  Object.freeze({ value: 2, label: '2 a second' }),
  Object.freeze({ value: 1, label: '1 a second' }),
]);
export const FLASH_LIMIT_FIELD = Object.freeze({
  key: FLASH_LIMIT_KEY,
  label: 'Flashing limit',
  kind: 'choice',
  default: FLASH_NO_LIMIT,
  level: 'standard',
  options: FLASH_LIMIT_OPTIONS,
  note: 'How often tiles, pulses and waves on this screen may flash. The "Flashing can cause seizures" '
    + 'starting setting picks 3 a second, any size. Any choice here can be raised, lowered or removed.',
  automatable: false,
});

/**
 * The same field, but an UNSET row shows what is really in force: the starting-defaults layer's value
 * (`layer` is the layer object or a function returning it). Without this a screen whose box set 3 would
 * show "No limit" in the menu while obeying 3.
 */
export function flashLimitFieldWith(layer) {
  return Object.freeze({
    ...FLASH_LIMIT_FIELD,
    defaultFrom: () => {
      let l;
      try { l = typeof layer === 'function' ? layer() : layer; } catch { l = null; }
      const v = l && typeof l === 'object' ? l[FLASH_LIMIT_KEY] : undefined;
      return isFlashLimitChoice(v) ? v : undefined;
    },
  });
}

/** A limit in plain words ("no limit", "3 a second, any size"...), for previews and notes. */
export function sayFlashLimit(v) {
  if (!isFlashLimitChoice(v) || normalizeFlashLimit(v) === Infinity) return 'no limit';
  const hit = FLASH_LIMIT_OPTIONS.find((o) => String(o.value) === String(v));
  if (hit) return hit.label.replace(/ \(WCAG [0-9.]+\)$/, '');
  const n = Number(v);
  return `${n} a second`;
}
