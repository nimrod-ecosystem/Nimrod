// flash_limit.js — HOW MANY TIMES A SECOND ANYTHING ON THIS SCREEN MAY FLASH. One number, one helper.
//
// MIKE_CHANGE_LIST.md rows 2.43 + 2.48: `starting_defaults.js` gives the "Flashing can cause seizures"
// box the setting `flashLimitPerSecond: 3` (WCAG 2.3.1). Until this file NOTHING READ IT - rhythm had
// its own 175 bpm constant and automation its own one-second LFO floor. Now there is one reader:
//
//   flashLimit(ctx)                 what a MODULE calls. Reads `ctx.flashLimitPerSecond` (a value or a
//                                   getter the host supplies); a host that supplies nothing gets 3.
//   flashLimitFrom(rows, layer)     what the HOST calls: the screen's and the person's settings rows,
//                                   with the starting-defaults layer filling only what nobody chose
//                                   (`withStartingDefaults`, so "defaults, never locks" still holds).
//   minFlashPeriodMs(limit, {jitterMs})  the shortest gap between two repeats of a visible change.
//   maxPerMinute(limit)             the same, as "per minute" (a tempo).
//
// A "flash" is WCAG's: a pair of opposing changes (lit then dark). Anything that repeats a visible
// change - a tile lighting, a pulse, a wave on a colour - repeats a flash once per period.
//
// ---------------------------------------------------------------------------------------
// *** THE CEILING IS 3 AND NO SETTING GOES ABOVE IT. *** This is a SAFETY invariant - the one kind of
// absolute CLAUDE.md allows - so it is stated as one, and listed for Mike's sign-off (not yet given):
//   WHO WANTS THE OPPOSITE? A party screen that wants a strobe; a music visualiser. Real wants. But a
//   screen whose first home is a bedside cannot tell who is looking at it, and a seizure is not a
//   preference somebody opted into. A strobe mode, if Mike wants one, is its own separately-argued
//   feature with its own warning - not this number set to 10.
//   WHAT HAPPENS IF NOBODY ANSWERS? Nothing: this is a cap, never a gate. Nothing waits for it.
//
// *** THE FLOOR IS 1, ARGUED (a default, on Mike's list). ***
//   FOR allowing lower (0.5, or "never"): a person who wants nothing to flash at all is real.
//   AGAINST, and it wins for now: under one a second a repeat is no longer a flash in the sense the
//   published guidance means (it is about seizure-rate flicker), every slow pulse on the product
//   (listening cue 1.6 s, room ring 1.4 s, clock alert 1 s) would have to be rebuilt to honour it,
//   and "nothing moves" is already its own setting (`reduceMotion`, the "movement makes me unwell"
//   box). If Mike wants "never flash", that is a toggle beside this, not a smaller number.
//
// *** THE MARGIN: ONE 60 Hz FRAME (or the source's own tick). *** A screen draws whole frames, so a
// change due at time t lands up to one frame late. At exactly three a second four onsets can
// therefore land inside one closed second. So n repeats are spaced so that n gaps exceed a second
// PLUS the jitter: period > (1000 + jitter) / n. For something sampled on a slower tick than the
// frame (automation's LFO re-reads every 100 ms) the tick IS the jitter.
// ---------------------------------------------------------------------------------------

import { withStartingDefaults } from './starting_defaults.js';

export const FLASH_LIMIT_KEY = 'flashLimitPerSecond';
/** WCAG 2.3.1 / 2.3.2. The ceiling: no setting, layer or host goes above it. */
export const FLASH_LIMIT_MAX = 3;
/** The lowest limit a setting may ask for (argued above; on Mike's list). */
export const FLASH_LIMIT_MIN = 1;
/** What a screen with no setting and no starting default gets: the ceiling itself. */
export const FLASH_LIMIT_DEFAULT = FLASH_LIMIT_MAX;
/** One 60 Hz frame: how late a change can land on screen. */
export const FRAME_MS = 1000 / 60;
/** Tempos are offered and shown as round numbers: a per-minute cap rounds DOWN to a multiple of this. */
export const PER_MINUTE_STEP = 5;

/** Any value in, a usable limit out: clamped to [MIN, MAX]; garbage reads as the default (3). */
export function normalizeFlashLimit(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return FLASH_LIMIT_DEFAULT;
  const n = Number(v);
  if (!Number.isFinite(n)) return FLASH_LIMIT_DEFAULT;
  return Math.max(FLASH_LIMIT_MIN, Math.min(FLASH_LIMIT_MAX, n));
}

/**
 * THE MODULE'S READ. `ctx.flashLimitPerSecond` may be a number or a function; anything missing or
 * broken is 3 - a module mounted by a host that knows nothing of this is exactly as safe as before.
 * Read it when you need it (it is a getter on the kiosk, so it follows a changed setting).
 */
export function flashLimit(ctx) {
  let v;
  try {
    v = ctx ? ctx[FLASH_LIMIT_KEY] : undefined;
    if (typeof v === 'function') v = v();
  } catch { v = undefined; }
  return normalizeFlashLimit(v);
}

/**
 * THE HOST'S READ. `rows` is one settings row or a list (the screen's, the person's). A row that
 * CHOSE a value keeps it - the starting-defaults layer fills only a row that did not. Where more than
 * one row chose, THE STRICTER WINS: a room screen is seen by everyone in the room, so the lowest limit
 * anybody set is the one that protects them all. (A default, argued, on Mike's list.)
 */
export function flashLimitFrom(rows, layer = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter((r) => r && typeof r === 'object');
  const chosen = list
    .map((r) => r[FLASH_LIMIT_KEY])
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map(normalizeFlashLimit);
  if (chosen.length) return Math.min(...chosen);
  return normalizeFlashLimit(withStartingDefaults({}, layer || {})[FLASH_LIMIT_KEY]);
}

/** The shortest period (ms) a repeating visible change may have at `limit` flashes a second. */
export function minFlashPeriodMs(limit, { jitterMs = FRAME_MS } = {}) {
  const j = Math.max(0, Number(jitterMs) || 0);
  return (1000 + j) / normalizeFlashLimit(limit);
}

/**
 * The most repeats a MINUTE at `limit` (a tempo cap), rounded DOWN to a multiple of PER_MINUTE_STEP.
 * At 3 this is 175 (the number rhythm_beat.js has always used, now derived): 3 gaps of 60000/175 =
 * 1028.6 ms > 1000 + one frame. At 2: 115. At 1: 55.
 */
export function maxPerMinute(limit, { jitterMs = FRAME_MS, step = PER_MINUTE_STEP } = {}) {
  const raw = 60000 / minFlashPeriodMs(limit, { jitterMs });
  const s = Math.max(1, Number(step) || 1);
  return Math.floor(raw / s) * s;
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
 * *** FAILURE BACKOFF: A RUN OF BROKEN ITEMS MUST NOT BECOME A STROBE. *** (Photosensitivity audit,
 * 2026-09-30.) Photos, personal videos and YouTube all move on the moment an item errors - right for
 * one broken file, and a strobe when EVERY file is broken: each new item appears, fails in a few
 * milliseconds, and the next replaces it, as fast as the browser can go. This is how long the
 * `streak`-th failure IN A ROW must stay up (from when it appeared) before the next item replaces it:
 *
 *   1st         one flash period - 339 ms at 3, 1017 ms at 1 (was: at once)
 *   2nd, 3rd... BASE, doubling, capped: 2 s, 4 s, 8 s, 16 s, 30 s, 30 s ...
 *
 * NUMBERS ARGUED (defaults, on Mike's list): BASE 2 s is the photo slideshow's own floor
 * (photos.js scheduleAdvance), so a broken run is never faster than the fastest a working slideshow
 * may go. CAP 30 s: long enough that a dead folder is not a spinner on a Pi 400; short enough that
 * one good item among many broken ones is still reached within a few minutes. The streak resets the
 * moment anything plays properly, so NORMAL TIMING NEVER CHANGES - only a failure is ever held.
 */
export const FAIL_BACKOFF_BASE_MS = 2000;
export const FAIL_BACKOFF_CAP_MS = 30000;
export function failureBackoffMs(streak, limit = FLASH_LIMIT_DEFAULT) {
  const first = Math.ceil(minFlashPeriodMs(limit));
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  if (n === 1) return first;
  return Math.max(first, Math.min(FAIL_BACKOFF_CAP_MS, FAIL_BACKOFF_BASE_MS * 2 ** (n - 2)));
}

/**
 * The settings row a host's menu shows (the screen's or the person's). Options only go DOWN from 3:
 * the ceiling is not a choice. Level 'standard' - it is a safety setting, but a caregiver's one.
 */
export const FLASH_LIMIT_FIELD = Object.freeze({
  key: FLASH_LIMIT_KEY,
  label: 'Flashing: no more than',
  kind: 'choice',
  default: FLASH_LIMIT_DEFAULT,
  level: 'standard',
  options: Object.freeze([
    Object.freeze({ value: 3, label: '3 a second (the published limit)' }),
    Object.freeze({ value: 2, label: '2 a second' }),
    Object.freeze({ value: 1, label: '1 a second' }),
  ]),
  note: 'Tiles, pulses and waves on this screen never repeat faster than this. It never goes above 3.',
  automatable: false,
});
