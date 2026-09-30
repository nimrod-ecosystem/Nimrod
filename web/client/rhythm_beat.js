// rhythm_beat.js — THE BEAT, THE JUDGE AND THE FLASH LIMIT FOR THE RHYTHM GAME, with no DOM and no clock.
//
// Row 2.37 item 10 (MIKE_CHANGE_LIST.md, private repo; room_as_home_20260930.md §7): floor tiles light
// to a beat and you press on the beat. `modules/rhythm.js` is the panel; this file is the arithmetic,
// split out so the suite can check every rule without waiting for a single real beat.
//
// THE BEAT IS AN EQUATION, NOT A TICK (the same shape tempo.js publishes): beat k lands at
// `origin + k * interval`. Everything - which tile is lit, whether a press was on the beat, when the
// next click sounds - is worked out from that and the time now. Nothing counts ticks, so a slow
// frame never makes the beat drift.

// *** THE FLASH LIMIT: WCAG 2.3.1, "Three Flashes or Below Threshold" (Level A). *** A lit tile going
// dark and lighting again is a flash, and a tile lights once per beat, so the beat itself is the
// flash rate. THREE A SECOND would be 180 beats a minute - but a screen shows whole frames, so at
// exactly 180 four onsets can land inside one second by a frame's rounding. MAX_BPM is 175: three
// intervals are then 1029 ms, more than a second plus a 60 Hz frame. This is a SAFETY limit, the one
// kind of absolute this project allows (CLAUDE.md, "Design absolutes"): nobody's preference is
// served by a screen that can trigger a seizure, so no setting goes above it and a faster tempo
// from elsewhere on the screen is halved until it fits (`lightEvery`).
//
// *** THE CAP IS DERIVED FROM THE SCREEN'S FLASH LIMIT, NOT A SEPARATE CONSTANT (2026-09-30). ***
// `flash_limit.js`'s `maxPerMinute(limit)` is the one formula: at the WCAG ceiling (3) it is 175, the
// number this file always used; a person whose limit is 2 gets 115, at 1 gets 55. Every function
// below takes the limit as an optional last argument and defaults to the ceiling.
import { FLASH_LIMIT_MAX, maxPerMinute, normalizeFlashLimit } from './flash_limit.js';

export const FLASH_LIMIT_PER_SEC = FLASH_LIMIT_MAX;
export const MAX_BPM = maxPerMinute(FLASH_LIMIT_MAX);
// Below 30 a "beat" is two seconds of nothing: not a rhythm any more, and too slow to feel. The flash
// limit's own floor (1 a second) caps tempo at 55, so this floor never overrides the limit.
export const MIN_BPM = 30;

/** The fastest tempo at this flash limit (default: the ceiling, 175). */
export const maxBpmFor = (limit = FLASH_LIMIT_MAX) => maxPerMinute(normalizeFlashLimit(limit));

// The tempo setting's choices. Top choice 150, well inside the limit; the slow end is where a switch
// user starts (the module's default is 60: one beat a second).
export const TEMPOS = Object.freeze([40, 50, 60, 72, 90, 110, 130, 150]);

// The timing window, ± milliseconds either side of the beat that still count as "on the beat".
export const WINDOWS = Object.freeze({ tight: 100, normal: 175, generous: 250, 'very-generous': 350 });
// A window never covers more than 40% of the gap between beats either side, so "on the beat" always
// means something: at 150 bpm a 350 ms window would otherwise swallow the whole beat, and every
// press - even one mashed at random - would count.
export const WINDOW_MAX_FRACTION = 0.4;
// A tile stays lit for half the beat: lit then dark, evenly, so the dark half is as easy to see as the
// lit one. Argued, not a setting - a longer light blurs one beat into the next.
export const LIT_FRACTION = 0.5;
export const PATTERNS = Object.freeze(['walk', 'bounce', 'random']);

export function clampBpm(bpm, limit = FLASH_LIMIT_MAX) {
  const top = maxBpmFor(limit);
  const n = Number(bpm);
  if (!Number.isFinite(n) || n <= 0) return Math.min(60, top);
  // The flash cap is applied LAST, so it wins over the floor if they ever cross.
  return Math.min(top, Math.max(MIN_BPM, n));
}

/** For a tempo from elsewhere: light every nth beat, n a power of two, so the lights stay under the limit. */
export function lightEvery(bpm, limit = FLASH_LIMIT_MAX) {
  const top = maxBpmFor(limit);
  const b = Number(bpm);
  if (!Number.isFinite(b) || b <= 0) return 1;
  let n = 1;
  while (b / n > top && n < 64) n *= 2;
  return n;
}

export const intervalFor = (bpm, limit = FLASH_LIMIT_MAX) => 60000 / clampBpm(bpm, limit);

/** The window actually used at this interval: the setting, capped at WINDOW_MAX_FRACTION of the gap. */
export function windowMs(setting, intervalMs) {
  const w = typeof setting === 'number' ? setting : (WINDOWS[setting] ?? WINDOWS.generous);
  return Math.max(10, Math.min(w, intervalMs * WINDOW_MAX_FRACTION));
}

/**
 * Judge a press. Returns { k, delta, verdict }: k is the NEAREST beat, delta is how far off (ms,
 * negative = early), verdict 'hit' | 'early' | 'late'. `offset` moves the centre for somebody whose
 * presses land consistently late (a switch takes time to close).
 */
export function judge(pressMs, { origin, interval, window, offset = 0 }) {
  const t = pressMs - (Number(offset) || 0);
  const k = Math.round((t - origin) / interval);
  const delta = t - (origin + k * interval);
  const verdict = Math.abs(delta) <= window ? 'hit' : (delta < 0 ? 'early' : 'late');
  return { k, delta, verdict };
}

/** Where beat `rel` (0 = the first beat of this run) falls: counting in, playing, or resting. */
export function roundOf(rel, { countIn = 4, roundBeats = 16, restBeats = 4 } = {}) {
  if (rel < 0) return { phase: 'before', round: 0, beat: 0 };
  if (!(roundBeats > 0)) {
    if (rel < countIn) return { phase: 'count', round: 0, left: countIn - rel, beat: rel };
    return { phase: 'play', round: 0, beat: rel - countIn };
  }
  const L = countIn + roundBeats + restBeats;
  const round = Math.floor(rel / L);
  const j = rel % L;
  if (j < countIn) return { phase: 'count', round, left: countIn - j, beat: j };
  if (j < countIn + roundBeats) return { phase: 'play', round, beat: j - countIn };
  return { phase: 'rest', round, beat: j - countIn - roundBeats };
}

// A small seeded hash, so 'random' is the same sequence for the same seed (the suite, and a replay).
function hash(k, seed) {
  let h = (Math.imul(k | 0, 2654435761) ^ Math.imul(seed | 0, 1597334677)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Which tile lights on beat `rel`. walk: 0,1,2,3,0,1...  bounce: 0,1,2,3,2,1,0...  random: any
 * tile but the one just lit (a tile lighting twice in a row looks like it never went out).
 * Returns a function rel -> tile, remembering the random sequence as it goes.
 */
export function createPattern(pattern, n, seed = 1) {
  const count = Math.max(1, Math.round(Number(n) || 1));
  if (pattern === 'bounce' && count > 2) {
    const period = 2 * count - 2;
    return (rel) => { const i = ((rel % period) + period) % period; return i < count ? i : period - i; };
  }
  if (pattern === 'random' && count > 1) {
    const memo = new Map();
    const at = (rel) => {
      if (rel <= 0) return hash(0, seed) % count;
      if (memo.has(rel)) return memo.get(rel);
      // Fill forward from the nearest known beat, so a long jump costs one pass, not recursion.
      let from = rel - 1;
      while (from > 0 && !memo.has(from)) from--;
      let prev = from <= 0 ? hash(0, seed) % count : memo.get(from);
      for (let r = Math.max(1, from + 1); r <= rel; r++) {
        const t = (prev + 1 + (hash(r, seed) % (count - 1))) % count;
        memo.set(r, t); prev = t;
      }
      if (memo.size > 256) for (const key of [...memo.keys()].slice(0, 128)) memo.delete(key);
      return memo.get(rel);
    };
    return at;
  }
  return (rel) => ((rel % count) + count) % count;
}
