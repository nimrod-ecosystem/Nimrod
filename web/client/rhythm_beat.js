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

// *** TWO CAPS, AND ONLY ONE OF THEM IS ALWAYS THERE. ***
//
// 1. THE GAME'S OWN TOP SPEED, MAX_BPM = 300 (2026-10-01). Mike, on the old 175: *"Why the cap?"* -
//    it existed only because of the flash limit, and the flash limit is no longer on for everybody
//    (flash_limit.js). What is left is what the tiles can physically show and a press can be judged
//    against. Argued:
//      FOR going higher: a 60 Hz screen could draw a lit-then-dark tile up to 30 beats a second.
//      AGAINST, and it sets 300: at 300 a beat is 200 ms, so a tile is lit for 100 ms (six frames)
//      and the judging window is at most 80 ms (40% of the gap). Faster, the lit half drops under six
//      frames and the window under the jitter a browser adds to a press (a frame, plus a switch's
//      own debounce), so "on the beat" stops being something the game can measure. 300 is also past
//      almost any music this would play along with. A default, on Mike's list; one constant to change.
// 2. THE SCREEN'S FLASH LIMIT, WHEN ONE IS SET. A lit tile going dark and lighting again is a flash,
//    and a tile lights once per beat, so the beat is the flash rate. `flash_limit.js`'s
//    `maxPerMinute(limit)` is the one formula: at 3 a second it is 175 (three gaps of 1029 ms, more
//    than a second plus a 60 Hz frame - why not 180), at 2 it is 115, at 1 it is 55. With no limit set
//    it is Infinity and only cap 1 applies. A faster tempo from elsewhere on the screen is halved
//    until it fits under both (`lightEvery`).
//
// Every function below takes the limit as an optional last argument; omitted, it is the default
// (no limit), so the game's own range applies.
import { FLASH_LIMIT_DEFAULT, maxPerMinute, normalizeFlashLimit } from './flash_limit.js';

export const MAX_BPM = 300;
// Below 30 a "beat" is two seconds of nothing: not a rhythm any more, and too slow to feel. A flash
// limit under about half a flash a second would cap the tempo below 30; the cap wins (`clampBpm`).
export const MIN_BPM = 30;

/** The fastest tempo at this flash limit: the lower of the game's own top (300) and the limit's cap. */
export const maxBpmFor = (limit = FLASH_LIMIT_DEFAULT) => Math.min(MAX_BPM, maxPerMinute(normalizeFlashLimit(limit)));

// The tempo setting's choices. The slow end is where a switch user starts (the module's default is 60:
// one beat a second); the fast end reaches the game's own top. A choice above the screen's flash limit
// is slowed to the limit while that limit is set (the setting's note says so).
export const TEMPOS = Object.freeze([40, 50, 60, 72, 90, 110, 130, 150, 180, 240, 300]);

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

export function clampBpm(bpm, limit = FLASH_LIMIT_DEFAULT) {
  const top = maxBpmFor(limit);
  const n = Number(bpm);
  if (!Number.isFinite(n) || n <= 0) return Math.min(60, top);
  // The flash cap is applied LAST, so it wins over the floor if they ever cross.
  return Math.min(top, Math.max(MIN_BPM, n));
}

/** For a tempo from elsewhere: light every nth beat, n a power of two, so the lights stay under the limit. */
export function lightEvery(bpm, limit = FLASH_LIMIT_DEFAULT) {
  const top = maxBpmFor(limit);
  const b = Number(bpm);
  if (!Number.isFinite(b) || b <= 0) return 1;
  let n = 1;
  while (b / n > top && n < 64) n *= 2;
  return n;
}

export const intervalFor = (bpm, limit = FLASH_LIMIT_DEFAULT) => 60000 / clampBpm(bpm, limit);

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
