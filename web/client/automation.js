// automation.js — ANY NUMERIC SETTING CAN BE DRIVEN BY AN INPUT. Change list row 2.41.
//
// Mike, 2026-09-30: *"Kind of like midi automations add things like hue, lightness, saturation as
// parameters that can receive input from something else. Could be cool for escape room type
// puzzles with hidden writing. Lots of other fun uses."* Chat's note: any numeric setting becomes a
// parameter you can bind to a source — a verb, the clock, a sensor, a game event, or another
// module's output — the same shape as binding a switch to a verb (`actions.js`: "a verb is just a
// variable").
//
// A BINDING is structural, like a link in `links.js` — WHAT drives WHAT, no value on it:
//
//   { id, target: { instance, key }, source: {...}, map: {...} }
//
//   target   one module instance's numeric setting (the instance id the kiosk mounts it under).
//   source   where the number comes from:
//              bus    { kind:'bus', topic, path?, range? }   any topic with a numeric payload -
//                     a sensor, a game event, a score. A `links.js` value envelope ({value, ...})
//                     is read as its `value`, so another module's data-link output just works.
//              link   { kind:'link', instance, port, range? }  another module's declared port;
//                     the topic is `links.js`'s own `linkTopic`, not a second addressing scheme.
//              verb   { kind:'verb', up, down?, step?, start?, wrap? }  a switch steps a value.
//              clock  { kind:'clock', points?, tickMs? }  a time-of-day curve.
//              lfo    { kind:'lfo', shape?, periodMs?, tickMs? }  a sine or triangle wave.
//              data   { kind:'data', query?, win?, what?, tickMs?, range? }  WHAT'S BEEN PLAYED on this screen
//                     (row 2.62 step 3): a number from play_charts.js `playNumber` - how many plays, plays of
//                     the most played thing, or how many different things - over today / this week / this month
//                     / all time, for every player or one. Read from THIS DEVICE's record only (plays.js; no
//                     server call), again when a play lands and once every `tickMs`. See `dataRangeFor`.
//   map      input range -> the setting's own min/max, a curve, smoothing, and what happens when
//            the source goes quiet. See `normalizeMap`.
//
// *** AUTOMATION IS A LAYER, NEVER A WRITE. *** The value somebody set by hand is the BASE and
// stays in storage untouched. `wrapState` hands a module a state handle whose `get()` and whose
// subscribers see base + overlay; the overlay lives only in memory. Removing a binding deletes its
// overlay key, and the module is handed the base row again - the SAME OBJECT the base handle
// returns, so "restored exactly" is identity, not a comparison.
//
// *** WHY THE STATE HANDLE AND NOT EACH MODULE. *** `live_settings_test` proves every module with a
// settings menu subscribes to `ctx.state` and re-reads on change. That subscription is the one
// door every setting already comes through, so wrapping the handle makes every module automatable
// with no change to any of them. What that cannot reach is listed in the report (row 2.41 in
// MIKE_CHANGE_LIST): a setting a module reads from somewhere OTHER than `ctx.state`.
//
// *** WHY THIS REUSES links/conditioning/actions/settings_fields RATHER THAN BEING A PARALLEL
// SYSTEM. *** `links.mapRange` is the input-range map (clamped, the same way a data link maps).
// `conditioning.createContinuousConditioner` is the unchanged-value guard and rate limit an
// automation needs on its way into a module. `settings_fields.stepValue` is how a verb steps the
// value - wrapping included, so one switch can never strand a dial at its top. `actions.verbTopic`
// names the verb. An automation is NOT a data link, argued: a link joins two declared PORTS and no
// module declares its settings as ports; making every numeric setting a port would change every
// manifest for a job the settings declarations already do. A binding here reads like a link whose
// sink is a setting, and when settings become ports it can become one.
//
// *** SAFETY. *** A value is clamped to the field's declared min/max every time, and then to any
// product floor this file knows about (`DEFAULT_GUARDS`) - the master volume never goes under the
// screen's own "never quieter than". The floors THEMSELVES are not bindable: an automation that can
// lower a minimum can remove the guarantee the minimum exists for. The mixer channel floors (calls
// 60%, AAC voice 60%) are applied by `audio_bus.js` DOWNSTREAM of any fader, so a fader driven to 0
// still plays a call at its floor - `automation_test` proves it through the real bus.
//
// EVERY CONSTANT IS A DEFAULT on `AUTOMATION_DEFAULTS`, overridable per binding. Listed for Mike.

import { fieldsFor, normalizeField, stepValue } from './settings_fields.js';
import { mapRange, linkTopic } from './links.js';
import { createContinuousConditioner } from './conditioning.js';
import { verbTopic } from './actions.js';
import { MASTER_DEFAULTS } from './master_volume.js';
import { floorKey } from './mixer.js';
import { CHANNELS } from './audio_bus.js';
import { FLASH_LIMIT_DEFAULT, FRAME_MS, minFlashPeriodMs, normalizeFlashLimit } from './flash_limit.js';
import { NUMBER_QUERIES, WINDOWS as DATA_WINDOWS, playNumber } from './play_charts.js';

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const SOURCE_KINDS = ['bus', 'link', 'verb', 'clock', 'lfo', 'data'];
export const CURVES = ['linear', 'ease-in', 'ease-out', 'steps', 'peak'];
export const LFO_SHAPES = ['sine', 'triangle'];
export const QUIET = ['hold', 'release'];

// ---------------------------------------------------------------------------------------
// THE DEFAULTS. Each is a best guess with its reason; each is overridable on the binding.
// ---------------------------------------------------------------------------------------
export const AUTOMATION_DEFAULTS = Object.freeze({
  // What a bus/link/verb/clock/lfo value is read as when the binding does not say. 0..1 because
  // that is what `wrapValue`'s continuous ports and every sensor normalised to a fraction send.
  inputRange: Object.freeze([0, 1]),
  // An LFO: one slow breath every four seconds. Slow enough to read as a glow, not a flicker -
  // anything under ~0.5 s is a flashing light, and flashing is its own clinical question.
  lfoPeriodMs: 4000,
  lfoShape: 'sine',
  // How often an LFO re-reads itself: 10 a second. Smooth enough for a colour to look continuous;
  // cheap enough for a Pi 400 (a colour-only change repaints two CSS properties, see button.js).
  lfoTickMs: 100,
  // The clock is a time of day, so once a minute is plenty.
  clockTickMs: 60000,
  // The clock's curve: [hour (0..24), value (0..1)] pairs, joined by straight lines and wrapping
  // round midnight. Off at night, up through the morning, down through the evening: the shape a
  // "brighter by day" automation wants. A guess; any binding brings its own.
  clockPoints: Object.freeze([[0, 0], [7, 0], [9, 1], [20, 1], [22, 0]].map((p) => Object.freeze(p))),
  // A verb press moves a tenth of the input range - ten presses end to end - and WRAPS, because a
  // one-switch user can only travel one way (settings_fields.js: "wrapping is the whole contract").
  verbStep: 0.1,
  verbStart: 0,
  verbWrap: true,
  // Smoothing off: a value lands when it arrives. A glide is a choice (`smoothMs`), not a default,
  // because a puzzle wants the words to appear the moment the dial is right.
  smoothMs: 0,
  smoothTickMs: 50,
  // No rate limit by default; the conditioner's unchanged-value guard already drops repeats.
  minIntervalMs: 0,
  // A source that stops talking HOLDS its last value (argued at `normalizeMap`).
  whenQuiet: 'hold',
  quietMs: 0,
  // The peak curve (the escape-room one): full at `center`, falling to nothing `width` either side.
  peakCenter: 0.5,
  peakWidth: 0.1,
  steps: 4,
  // WHAT'S BEEN PLAYED (row 2.62 step 3). The question a new data rule asks: how many plays this week, every
  // player - the chart module's own first view ("Top played this week"), so the two start on the same days.
  dataQuery: 'plays',
  dataWin: 'week',
  dataWhat: 'all',
  // How often a data rule reads the device's record again BY ITSELF, besides every play as it lands: once a
  // minute. For "today" turning over at midnight, and for plays another tab on this device made (each tab keeps
  // its own copy in memory - plays.js "KNOWN BOUNDS"). The same minute modules/charts.js REFRESH_MS re-reads on;
  // one IndexedDB read a minute. Overridable per rule (`tickMs`), never under a second.
  dataTickMs: 60000,
  // What a data rule's number is read across when the rule does not say (its "lowest / highest"): 0 up to about
  // TEN PLAYS A DAY over the window - 10 today, 70 this week, 300 this month. Argued: FOR a fixed 0..1 like the
  // other sources: one rule for all. AGAINST, and it wins: a count is never 0..1, so every new rule would be at
  // its top after one play. Ten a day is a guess at "a good day" for music and videos; a photo frame logs a play
  // per photo and passes it in an hour, which is why the editor shows the range and steps it. "All time" has no
  // natural top; 1000 is a hundred days of that, a slow fill that is still moving after months.
  dataRanges: Object.freeze({ today: Object.freeze([0, 10]), week: Object.freeze([0, 70]),
    month: Object.freeze([0, 300]), all: Object.freeze([0, 1000]) }),
});

/** The default lowest / highest for a data rule over this window (AUTOMATION_DEFAULTS.dataRanges). */
export function dataRangeFor(win) {
  const r = AUTOMATION_DEFAULTS.dataRanges[win] || AUTOMATION_DEFAULTS.dataRanges[AUTOMATION_DEFAULTS.dataWin];
  return [r[0], r[1]];
}

// ---------------------------------------------------------------------------------------
// THE GUARDS. What automation may never do, beyond a field's own declared range.
//
//   locked     keys that cannot be bound at all, with the reason the editor shows.
//   floorFrom  keys whose lowest allowed value depends on another setting in the same row.
//
// Deliberately a SHORT list of the product's own safety numbers, not a policy engine. A module can
// also opt a field out with `automatable: false` on its declaration.
// ---------------------------------------------------------------------------------------
const FLOOR_REASON = 'a safety minimum: an automation that could lower it would remove the guarantee';
export const DEFAULT_GUARDS = Object.freeze({
  locked: new Map([
    ['masterFloor', FLOOR_REASON],
    ...CHANNELS.map((c) => [floorKey(c.id), FLOOR_REASON]),
    // A live microphone's gain. Its howl guard (amplify.js) is what protects the room, and a gain
    // that an LFO or a sensor keeps moving is exactly the thing that sets a howl off. A guess, on
    // Mike's list: the argument FOR allowing it is a hearing aid that follows the room's noise.
    ['amplifyGain', 'a live microphone: a moving gain fights the howl guard that protects the room'],
  ]),
  floorFrom: new Map([
    // The master never goes under the screen's own "never quieter than" (master_volume.js /
    // audio_bus.js MASTER_FLOOR). The field's min (10) is the lowest floor; a screen set to 30%
    // keeps 30% against any automation.
    ['masterVolume', (row) => {
      const f = Number(row?.masterFloor);
      return Number.isFinite(f) && f > 0 && f <= 100 ? f : MASTER_DEFAULTS.floor;
    }],
  ]),
});

// *** HOW FAST AN LFO MAY SWING. Two floors; the one-second floor is now a FLASH floor (2026-10-01). ***
//
// 1. WITH A FLASH LIMIT SET (flash_limit.js, `flashLimitPerSecond`): never faster than once a second,
//    AND never faster than the limit allows - exactly as before. One LFO period is one full swing, one
//    flash; the jitter is the LFO's own tick (it re-reads on a 100 ms tick, so a peak can land up to a
//    tick early or late). At 3 and at 2 a second the one-second floor is the stricter; at 1 a second
//    the limit wins (about 1117 ms at the default tick: a second, plus a tick, plus a frame).
// 2. WITH NO FLASH LIMIT: only the SAMPLING floor - four ticks (400 ms at the default 100 ms tick).
//    Argued, because the one-second floor used to apply to everybody:
//      FOR keeping one second for everyone: a slow wave is calmer, and this product's first home is a
//      bedside.
//      AGAINST, and it wins: the one-second floor was written as a flash rule ("three flashes",
//      WCAG 2.3.1, with margin) - it IS the flash cap in another file, and Mike's ruling is that the
//      cap is for the photosensitivity setting, not for everybody. The calm default is still there:
//      a new LFO breathes every 4 s (`lfoPeriodMs`). What remains is physics: a wave re-read four
//      times a period draws a recognisable swing; at two samples a sine can read the same value twice
//      and alias to a flat line, so below four ticks the "wave" is noise. A default, on Mike's list.
// A fast BUS source (a sensor flapping) is covered by the event floor below, not by this.
// A stored binding is NEVER rewritten by any of this - it runs slower while a limit is stricter, and
// at its own speed again when the limit is raised or removed.
export const LFO_MIN_PERIOD_MS = 1000;
export const LFO_MIN_TICKS = 4;

/** The shortest LFO period allowed at this flash limit and tick. */
export function lfoMinPeriodMs(limit = FLASH_LIMIT_DEFAULT, tickMs = AUTOMATION_DEFAULTS.lfoTickMs) {
  const tick = Math.min(1000, Math.max(0, Number(tickMs) || 0));
  const sampling = LFO_MIN_TICKS * tick;
  if (!Number.isFinite(normalizeFlashLimit(limit))) return sampling;
  // The jitter: the wave's own tick (a peak is read up to a tick from where it really is), plus the
  // frame the change is then drawn on. A tick is capped at a second - a slower tick is its own limit.
  const jitterMs = tick + FRAME_MS;
  return Math.max(LFO_MIN_PERIOD_MS, minFlashPeriodMs(limit, { jitterMs }));
}

// *** THE EVENT FLOOR: A BUS, LINK OR VERB SOURCE MOVES A SETTING AT MOST ONCE A FLASH PERIOD. ***
// (Photosensitivity audit, 2026-09-30.) `minIntervalMs` defaults to 0, so a flapping sensor on a
// colour or a lightness flashed as fast as it flapped - the LFO had a floor, the event sources had
// none. Now on every bus/link/verb binding a REVERSAL of direction (or the first move from rest) -
// the thing that makes a flash, WCAG's "pair of opposing changes" - lands at most once every
// `minFlashPeriodMs(limit)` (339 ms at 3, 1017 ms at 1), latest value wins. A change in the same
// direction is never held: a ramp is not a flash, and a dial clicked up three times shows each
// click. Gated on the MAPPED value (so a `peak` curve's turn counts) before any `smoothMs` glide,
// so a glide stays smooth (gating its 50 ms ticks would turn a glide into steps).
//
// ALL NUMBER TARGETS, NOT ONLY "VISIBLE" ONES - argued both ways:
//   FOR visible-only: a volume following a sensor has no reason to wait a third of a second.
//   AGAINST, and it wins: nothing declares which numbers are visible. A key-name guess (hue,
//   opacity, bright...) fails OPEN on the first module that calls its brightness `level`, and this
//   is a safety floor; it has to fail shut. The cost is small - the newest value always lands within
//   one period - and a field that is genuinely not visible opts out with `visual: false` on its
//   declaration (a fact about the field, like `automatable: false`, not a preference).
// clock (once a minute) and lfo (its own floor, lfoMinPeriodMs) are not gated again. An explicit
// `minIntervalMs` still applies on top, exactly as before.
export function eventFloorMs(limit = FLASH_LIMIT_DEFAULT) {
  return Math.ceil(minFlashPeriodMs(limit));
}
// (2026-10-07) A DATA source is gated too: it is an event source (a play lands, a minute passes), and a count can
// reverse - at midnight "today" drops to 0, and a slideshow of quick plays then pushes it up again. Fail shut.
export function eventFloorApplies(source, rawDecl = null) {
  if (!source || !['bus', 'link', 'verb', 'data'].includes(source.kind)) return false;
  return !(rawDecl && rawDecl.visual === false);
}

const num = (v, d) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : d; };
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const roundTo = (v, d) => { const p = 10 ** Math.max(0, Math.min(6, d | 0)); return Math.round(v * p) / p; };

function normalizeRange(raw, fallback) {
  const lo = Number(raw?.[0]), hi = Number(raw?.[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [...fallback];
  return [lo, hi];
}

// ---------------------------------------------------------------------------------------
// normalizeSource / normalizeMap / normalizeBinding — one declaration in, one usable one out, or
// null. Same convention as every other `normalize*` here: a bad row is dropped, never thrown.
// ---------------------------------------------------------------------------------------
export function normalizeSource(raw) {
  const kind = SOURCE_KINDS.includes(raw?.kind) ? raw.kind : null;
  if (!kind) return null;
  const D = AUTOMATION_DEFAULTS;
  if (kind === 'bus') {
    const topic = typeof raw.topic === 'string' ? raw.topic.trim() : '';
    if (!topic) return null;
    const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : null;
    return { kind, topic, path, range: normalizeRange(raw.range, D.inputRange) };
  }
  if (kind === 'link') {
    const instance = String(raw.instance || '').trim();
    const port = String(raw.port || '').trim();
    if (!instance || !port) return null;
    return { kind, instance, port, range: normalizeRange(raw.range, D.inputRange) };
  }
  if (kind === 'verb') {
    const up = String(raw.up || '').trim();
    if (!ID_RE.test(up)) return null;
    const down = raw.down && ID_RE.test(String(raw.down).trim()) ? String(raw.down).trim() : null;
    const range = normalizeRange(raw.range, D.inputRange);
    const span = Math.abs(range[1] - range[0]);
    let step = Math.abs(num(raw.step, D.verbStep));
    if (!(step > 0) || step > span) step = Math.min(D.verbStep, span);
    const lo = Math.min(...range), hi = Math.max(...range);
    const start = Math.max(lo, Math.min(hi, num(raw.start, D.verbStart)));
    return { kind, up, down, step, start, wrap: raw.wrap === undefined ? D.verbWrap : !!raw.wrap, range };
  }
  if (kind === 'clock') {
    const pts = (Array.isArray(raw.points) ? raw.points : D.clockPoints)
      .map((p) => [Number(p?.[0]), Number(p?.[1])])
      .filter(([h, v]) => Number.isFinite(h) && h >= 0 && h <= 24 && Number.isFinite(v))
      .sort((a, b) => a[0] - b[0]);
    const tickMs = Math.max(1000, num(raw.tickMs, D.clockTickMs));
    return { kind, points: pts.length ? pts : D.clockPoints.map((p) => [...p]), tickMs, range: [0, 1] };
  }
  if (kind === 'data') {
    const query = NUMBER_QUERIES.includes(raw.query) ? raw.query : D.dataQuery;
    const win = DATA_WINDOWS.includes(raw.win) ? raw.win : D.dataWin;
    // Any id-shaped player name (plays.js: not a closed list); 'all' is every player but the ones left out.
    const what = typeof raw.what === 'string' && ID_RE.test(raw.what.trim()) ? raw.what.trim() : D.dataWhat;
    const tickMs = Math.max(1000, num(raw.tickMs, D.dataTickMs));
    return { kind, query, win, what, tickMs, range: normalizeRange(raw.range, dataRangeFor(win)) };
  }
  // lfo
  const tickMs = Math.max(16, num(raw.tickMs, D.lfoTickMs));
  // The stored period keeps whatever was asked, down to the sampling floor; the flash floor (one second,
  // and the screen's limit) is applied as it RUNS (`lfoMinPeriodMs`), so it follows a changed limit.
  const periodMs = Math.max(LFO_MIN_TICKS * Math.min(1000, tickMs), num(raw.periodMs, D.lfoPeriodMs));
  const shape = LFO_SHAPES.includes(raw.shape) ? raw.shape : D.lfoShape;
  return { kind, shape, periodMs, tickMs, range: [0, 1] };
}

// `outMin`/`outMax` absent means "the setting's own min and max", resolved when the binding meets
// its field (so a stored binding stays meaningful if a module later widens a range).
//
// *** WHEN THE SOURCE GOES QUIET: HOLD, BY DEFAULT. *** Argued both ways:
//   * FOR release (go back to the person's own value): a sensor that dies should not leave a
//     screen stuck wherever it was.
//   * AGAINST, and it wins as the default: most sources here are EVENTS (a score, a verb, a game
//     step) that are quiet between changes by nature - releasing after a silence would make a
//     puzzle's answer un-happen while somebody reads it. `release` is one field away for the
//     sensor that wants it, and `quietMs: 0` (the default) means "never quiet".
export function normalizeMap(raw = {}) {
  const D = AUTOMATION_DEFAULTS;
  const m = raw && typeof raw === 'object' ? raw : {};
  const opt = (v) => (v === undefined || v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  return {
    inMin: opt(m.inMin),
    inMax: opt(m.inMax),
    outMin: opt(m.outMin),
    outMax: opt(m.outMax),
    curve: CURVES.includes(m.curve) ? m.curve : 'linear',
    steps: Math.max(2, Math.round(num(m.steps, D.steps))),
    center: clamp01(num(m.center, D.peakCenter)),
    width: Math.max(0.001, Math.min(1, num(m.width, D.peakWidth))),
    invert: !!m.invert,
    smoothMs: Math.max(0, num(m.smoothMs, D.smoothMs)),
    minIntervalMs: Math.max(0, num(m.minIntervalMs, D.minIntervalMs)),
    whenQuiet: QUIET.includes(m.whenQuiet) ? m.whenQuiet : D.whenQuiet,
    quietMs: Math.max(0, num(m.quietMs, D.quietMs)),
  };
}

let seq = 0;
export function normalizeBinding(raw) {
  const instance = String(raw?.target?.instance || '').trim();
  const key = String(raw?.target?.key || '').trim();
  if (!instance || !key) return null;
  const source = normalizeSource(raw?.source);
  if (!source) return null;
  let id = String(raw?.id || '').trim();
  if (!ID_RE.test(id)) id = `auto-${Date.now().toString(36)}-${(seq += 1).toString(36)}`;
  return { id, target: { instance, key }, source, map: normalizeMap(raw?.map) };
}

// ---------------------------------------------------------------------------------------
// THE CURVE. `t` is 0..1 (the input, already mapped); the answer is 0..1 of the output range.
// ---------------------------------------------------------------------------------------
export function applyCurve(t, map) {
  const x = clamp01(Number(t) || 0);
  let y;
  switch (map?.curve) {
    case 'ease-in':  y = x * x; break;
    case 'ease-out': y = 1 - (1 - x) * (1 - x); break;
    case 'steps': {
      const n = Math.max(2, map.steps | 0);
      y = Math.min(n - 1, Math.floor(x * n)) / (n - 1);
      break;
    }
    // THE HIDDEN-WRITING CURVE: full at the right answer, nothing away from it. A straight-sided
    // peak rather than a bell, so "how close am I" reads as evenly as it feels on a dial.
    case 'peak': y = Math.max(0, 1 - Math.abs(x - map.center) / map.width); break;
    default: y = x;
  }
  return map?.invert ? 1 - y : y;
}

// The clock curve at an hour (0..24), joined straight between points, wrapping round midnight.
export function clockValue(points, hour) {
  const pts = points || [];
  if (!pts.length) return 0;
  if (pts.length === 1) return pts[0][1];
  const h = ((Number(hour) % 24) + 24) % 24;
  const ext = [[pts[pts.length - 1][0] - 24, pts[pts.length - 1][1]], ...pts, [pts[0][0] + 24, pts[0][1]]];
  for (let i = 1; i < ext.length; i++) {
    const [h0, v0] = ext[i - 1], [h1, v1] = ext[i];
    if (h >= h0 && h <= h1) return h1 === h0 ? v1 : v0 + (v1 - v0) * ((h - h0) / (h1 - h0));
  }
  return pts[0][1];
}

// An LFO at phase 0..1. Both shapes START AT 0, so a new binding eases in rather than jumping.
export function lfoValue(shape, phase) {
  const p = ((Number(phase) % 1) + 1) % 1;
  if (shape === 'triangle') return p < 0.5 ? p * 2 : 2 - p * 2;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
}

// A number out of whatever a topic carried: a bare number, a `links.js` envelope, or `path`.
export function readNumber(payload, path = null) {
  let v = payload;
  if (path) {
    for (const part of path.split('.')) { if (v == null) return NaN; v = v[part]; }
  } else if (v && typeof v === 'object' && 'value' in v) {
    v = v.value;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

// The raw declarations, for the flags `normalizeField` does not carry (`automatable`).
function rawDecls(manifest) {
  let d = manifest?.settings;
  if (typeof d === 'function') { try { d = d(); } catch { d = []; } }
  return Array.isArray(d) ? d : [];
}

// *** THE HOST'S OWN NUMBERS ON A PANEL (2026-10-07, row 2.62's question: "whether an object's own position, scale
// and rotation can be bound today"). *** `extra`: declarations a HOST adds to every panel it mounts - panel_drive.js's
// size, turn, colour shift and move, which the host (not the module) applies to the panel's box. They sit on the same
// state handle, so they are driven exactly like a module's own setting: an overlay in memory, the base untouched. A
// module's own key always wins a clash (a module declaring `driveScale` keeps it). Absent: nothing changes.
function withExtra(decls, norm, extra) {
  const list = Array.isArray(extra) ? extra.filter((d) => d && typeof d.key === 'string' && d.key) : [];
  if (!list.length) return { decls, norm };
  const have = new Set(norm.map((f) => f.key));
  const add = list.filter((d) => !have.has(d.key));
  return { decls: [...decls, ...add], norm: [...norm, ...add.map(normalizeField).filter(Boolean)] };
}

// ---------------------------------------------------------------------------------------
// CAN THIS SETTING BE DRIVEN? `{ ok, why }` - the reason is what the editor shows beside a row it
// will not offer, because a row that is simply missing sends people hunting for it.
// ---------------------------------------------------------------------------------------
export function bindable(field, raw = null, guards = DEFAULT_GUARDS) {
  if (!field) return { ok: false, why: 'no such setting' };
  // The safety reason first: a floor that is a choice today must still say WHY it is off limits
  // the day somebody makes it a number.
  if (guards?.locked?.has(field.key)) return { ok: false, why: guards.locked.get(field.key) };
  if (field.kind !== 'number') {
    return { ok: false, why: `a ${field.kind === 'toggle' ? 'yes/no' : field.kind} setting: only numbers can be driven` };
  }
  if (raw && raw.automatable === false) return { ok: false, why: 'this setting cannot be driven' };
  if (field.readOnly) return { ok: false, why: 'changed where it lives' };
  if (field.min === null || field.max === null) return { ok: false, why: 'it has no range to drive it across' };
  if (field.min === field.max) return { ok: false, why: 'it has only one value' };
  return { ok: true, why: null };
}

/**
 * THE EDITOR'S LIST: every declared setting of a module, with whether it can be driven and why
 * not. `fields` may be passed instead of a manifest (the screen's own settings row).
 */
export function bindableSettings(manifest = null, instance = null, { fields = null, guards = DEFAULT_GUARDS, extra = null } = {}) {
  const { decls, norm } = withExtra(fields || rawDecls(manifest),
    fields ? fields.map(normalizeField).filter(Boolean) : fieldsFor(manifest, instance), extra);
  return norm.map((f) => {
    const raw = decls.find((d) => d && d.key === f.key) || null;
    const b = bindable(f, raw, guards);
    return { key: f.key, label: f.label, kind: f.kind, ok: b.ok, why: b.why,
             min: f.min ?? null, max: f.max ?? null, unit: f.unit || '', field: f };
  });
}

// ---------------------------------------------------------------------------------------
// createAutomation — the engine. One per screen.
//
//   bus         the ROOT bus (verbs arrive on `verb/<id>` there; a scoped bus would miss them).
//   now / setTimer / clearTimer   injectable, so a test runs the clock by hand.
//   onChange    (list) => void, after a binding is added or removed by hand - the host saves it.
//   onStatus    (id, status) => void, optional: 'running', 'waiting for its panel', 'not bindable: ...'.
//   plays       this device's plays (plays.js `devicePlays()`: `get()`, `subscribe()`, `loadAll()`), or a getter for
//               it, read only when a data rule starts - a screen with no data rule never opens the record.
//   screen      the screen whose plays are counted (its profile id), or a getter. A screen's plays only, as every
//               chart counts (modules/charts.js argues it); with no screen a data rule counts nothing (0) rather
//               than the whole device's - it fails shut on whose listening it shows.
//   extraFields the host's own numbers on every panel (`withExtra` above; panel_drive.js), bindable like a
//               module's own. The editor reads them back with `extraFields()`.
// ---------------------------------------------------------------------------------------
export function createAutomation({
  bus = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  guards = DEFAULT_GUARDS,
  onChange = null,
  onStatus = null,
  // The screen's flash limit (flash_limit.js): a number or a function read on every LFO tick, so a
  // changed setting applies to a running wave. Missing or broken reads as no limit (flash_limit.js).
  flashLimit = FLASH_LIMIT_DEFAULT,
  plays = null,
  screen = null,
  extraFields = null,
} = {}) {
  const extra = Array.isArray(extraFields) ? extraFields.filter((d) => d && typeof d.key === 'string' && d.key) : [];
  const playsNow = () => { try { return typeof plays === 'function' ? plays() : plays; } catch { return null; } };
  const screenNow = () => { try { const s = typeof screen === 'function' ? screen() : screen; return s ? String(s) : null; } catch { return null; } };
  const limitNow = () => {
    try { return normalizeFlashLimit(typeof flashLimit === 'function' ? flashLimit() : flashLimit); }
    catch { return FLASH_LIMIT_DEFAULT; }
  };
  const bindings = new Map();     // id -> normalized binding
  const targets = new Map();      // instance -> { fields, raw, handle, overlay, listeners }
  const runners = new Map();      // binding id -> runner
  const status = new Map();       // binding id -> text
  const timers = new Set();       // every live timer, so teardown is checkable
  let dead = false;

  function after(fn, ms) {
    let id = null;
    const wrapped = () => { timers.delete(id); if (!dead) fn(); };
    id = setTimer(wrapped, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) { if (id == null) return; clearTimer(id); timers.delete(id); }
  function setStatus(id, s) {
    status.set(id, s);
    try { onStatus?.(id, s); } catch { /* a listener must not stop the engine */ }
  }

  // ---- the overlay -------------------------------------------------------------------
  function merged(t) {
    const base = t.handle?.get?.() || {};
    if (!t.overlay.size) return base;           // IDENTITY: nothing on top is the base itself
    return { ...base, ...Object.fromEntries(t.overlay) };
  }
  function notify(t) {
    const row = merged(t);
    for (const fn of [...t.listeners]) { try { fn(row); } catch (err) { console.error('automation: subscriber', err); } }
  }
  function setOverlay(instance, key, v) {
    const t = targets.get(instance);
    if (!t) return;
    if (t.overlay.get(key) === v) return;
    t.overlay.set(key, v);
    notify(t);
  }
  function clearOverlay(instance, key) {
    const t = targets.get(instance);
    if (!t || !t.overlay.has(key)) return;
    t.overlay.delete(key);
    notify(t);
  }

  // ---- one running binding ------------------------------------------------------------
  function startRunner(b) {
    stopRunner(b.id);
    const t = targets.get(b.target.instance);
    if (!t) { setStatus(b.id, 'waiting for its panel'); return; }
    const field = t.fields.get(b.target.key);
    const ok = bindable(field, t.raw.get(b.target.key), guards);
    if (!ok.ok) { setStatus(b.id, `not bindable: ${ok.why}`); return; }

    const m = b.map;
    const src = b.source;
    const inRange = [m.inMin ?? src.range[0], m.inMax ?? src.range[1]];
    // The output range, inside the field's own. A binding asking for more than the setting allows
    // gets the setting's bounds - the clamp below would do it anyway; this keeps the curve's shape.
    const lo = Math.max(field.min, Math.min(field.max, m.outMin ?? field.min));
    const hi = Math.max(field.min, Math.min(field.max, m.outMax ?? field.max));
    const decimals = field.decimals ?? 0;
    const floorFn = guards?.floorFrom?.get(b.target.key) || null;

    const r = { offs: [], tick: null, smooth: null, trail: null, quiet: null,
                gateAt: null, gateTrail: null, gatePending: undefined, gateLast: null, gateDir: 0, onsets: [],
                cond: createContinuousConditioner({ minIntervalMs: m.minIntervalMs }),
                applied: null, goal: null, verbValue: src.start };

    // THE SAFETY LINE: every value, every time, whatever produced it.
    function guard(v) {
      let out = Math.max(field.min, Math.min(field.max, v));
      if (floorFn) {
        let fl = null;
        try { fl = Number(floorFn(t.handle?.get?.() || {})); } catch { fl = null; }
        if (Number.isFinite(fl)) out = Math.max(out, Math.min(field.max, fl));
      }
      return roundTo(out, decimals);
    }

    function commit(v) {
      const g = guard(v);
      const verdict = r.cond.next(g, now());
      if (verdict.accepted) { cancel(r.trail); r.trail = null; setOverlay(b.target.instance, b.target.key, g); return; }
      if (verdict.reason === 'rate-limited') {
        // LATEST WINS: the conditioner only says "not now"; the newest value is sent when it may be.
        cancel(r.trail);
        r.trail = after(() => { r.trail = null; commit(r.goal ?? g); }, m.minIntervalMs);
      }
    }

    function glide() {
      r.smooth = null;
      if (r.goal == null) return;
      const from = r.applied ?? r.goal;
      const k = 1 - Math.exp(-AUTOMATION_DEFAULTS.smoothTickMs / m.smoothMs);
      let next = from + (r.goal - from) * k;
      // Snap when within half the last shown decimal, so the glide ENDS rather than creeping forever.
      if (Math.abs(r.goal - next) < 0.5 / 10 ** decimals) next = r.goal;
      r.applied = next;
      commit(next);
      if (next !== r.goal) r.smooth = after(glide, AUTOMATION_DEFAULTS.smoothTickMs);
    }

    function push(v) {
      r.goal = v;
      if (m.smoothMs > 0 && r.applied != null) {
        if (r.smooth == null) r.smooth = after(glide, AUTOMATION_DEFAULTS.smoothTickMs);
      } else {
        r.applied = v;
        commit(v);
      }
    }

    // *** THE EVENT FLOOR (photosensitivity audit, 2026-09-30). *** See the block at eventFloorMs:
    // on a bus, link or verb source, a REVERSAL of the value's direction (up then down: half of
    // WCAG's "pair of opposing changes") may land at most once a flash period, counted from the last
    // reversal or the first move from rest. A change in the SAME direction lands at once - a ramp is
    // not a flash, and a dial turned three clicks up shows each click. LATEST WINS: a reversal
    // arriving too soon is held and the newest value lands the moment the period is up (or at once,
    // if a newer value turns back the way it was already going).
    const floored = eventFloorApplies(src, t.raw.get(b.target.key));
    function gate(v) {
      if (!floored) { push(v); return; }
      const period = eventFloorMs(limitNow());
      const t0 = now();
      const dir = r.gateLast == null || v === r.gateLast ? 0 : Math.sign(v - r.gateLast);
      const onset = dir !== 0 && dir !== r.gateDir;          // a reversal, or the first move from rest
      if (!onset || r.gateAt == null || t0 - r.gateAt >= period) {
        cancel(r.gateTrail); r.gateTrail = null; r.gatePending = undefined;
        if (onset) { r.gateAt = t0; r.onsets.push(t0); if (r.onsets.length > 64) r.onsets.shift(); }
        if (dir !== 0) r.gateDir = dir;
        r.gateLast = v;
        push(v);
        return;
      }
      r.gatePending = v;
      if (r.gateTrail == null) {
        r.gateTrail = after(() => {
          r.gateTrail = null;
          const p = r.gatePending; r.gatePending = undefined;
          if (p !== undefined) gate(p);
        }, Math.max(0, r.gateAt + period - t0));
      }
    }

    function input(raw) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;           // not a number is not an input
      const x = mapRange(n, inRange, [0, 1]);    // links.js: clamped
      const y = applyCurve(x, m);
      gate(lo + y * (hi - lo));                  // the event floor (a no-op for clock and lfo)
      if ((src.kind === 'bus' || src.kind === 'link') && m.quietMs > 0) {
        cancel(r.quiet);
        r.quiet = after(() => {
          r.quiet = null;
          if (m.whenQuiet !== 'release') return;
          cancel(r.smooth); r.smooth = null; cancel(r.trail); r.trail = null;
          r.applied = null; r.goal = null;
          r.cond = createContinuousConditioner({ minIntervalMs: m.minIntervalMs });
          clearOverlay(b.target.instance, b.target.key);
        }, m.quietMs);
      }
    }

    // ---- the sources ----
    if (src.kind === 'bus' || src.kind === 'link') {
      if (!bus) { setStatus(b.id, 'no bus to listen on'); return; }
      const topic = src.kind === 'bus' ? src.topic : linkTopic(bus, { instance: src.instance, port: src.port });
      r.offs.push(bus.subscribe(topic, (p) => input(readNumber(p, src.path))));
    } else if (src.kind === 'verb') {
      if (!bus) { setStatus(b.id, 'no bus to listen on'); return; }
      // THE SETTINGS MENU'S OWN STEP (settings_fields.stepValue): lands on a bound before
      // wrapping, so both ends are reachable from one switch.
      const vlo = Math.min(...src.range), vhi = Math.max(...src.range);
      const dial = normalizeField({ key: 'dial', kind: 'number', min: vlo, max: vhi, step: src.step, default: src.start });
      const step = (dir) => {
        let next = stepValue(dial, r.verbValue, dir);
        if (!src.wrap) next = Math.max(vlo, Math.min(vhi, r.verbValue + src.step * dir));
        r.verbValue = next;                      // the press counts at once; only a reversal is gated
        input(next);
      };
      r.offs.push(bus.subscribe(verbTopic(src.up), () => step(1)));
      if (src.down) r.offs.push(bus.subscribe(verbTopic(src.down), () => step(-1)));
      input(r.verbValue);                        // the dial has a position from the start
    } else if (src.kind === 'clock') {
      const read = () => {
        const d = new Date(now());
        input(clockValue(src.points, d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600));
        r.tick = after(read, src.tickMs);
      };
      read();
    } else if (src.kind === 'lfo') {
      // The period actually run: the binding's, slowed to the screen's flash limit when that is
      // stricter. When it changes mid-wave the ORIGIN moves so the phase carries on from where it
      // was - a limit changing must not make the value jump (a jump is itself a flash).
      const periodNow = () => Math.max(src.periodMs, lfoMinPeriodMs(limitNow(), src.tickMs));
      let period = periodNow();
      let origin = now();
      const read = () => {
        const t = now();
        const p = periodNow();
        if (p !== period) { origin = t - ((t - origin) / period) * p; period = p; }
        r.periodMs = period;
        input(lfoValue(src.shape, (t - origin) / period));
        r.tick = after(read, src.tickMs);
      };
      read();
    } else if (src.kind === 'data') {
      // WHAT'S BEEN PLAYED. Read from what is already in memory now; again (once, however many rows changed) after
      // the record changes - a play landing, a panel's record loading; and every `tickMs`, which first reloads the
      // whole device's record (another tab's plays, and "today" turning over). Nothing here writes the record.
      const log = playsNow();
      const count = () => {
        const who = screenNow();
        if (!who || !log || typeof log.get !== 'function') return 0;
        let events = [];
        try { events = log.get()?.events || []; } catch { events = []; }
        const n = playNumber(events, { query: src.query, win: src.win, what: src.what, screen: who, now: now() });
        return Number.isFinite(n) ? n : 0;
      };
      let queued = false;
      const soon = () => {
        if (queued) return;
        queued = true;
        Promise.resolve().then(() => { queued = false; if (!r.stopped && !dead) input(count()); });
      };
      if (log && typeof log.subscribe === 'function') {
        try { const off = log.subscribe(() => soon()); if (typeof off === 'function') r.offs.push(off); } catch { /* no live nudge */ }
      }
      const reread = () => {
        r.tick = after(reread, src.tickMs);
        if (log && typeof log.loadAll === 'function') {
          Promise.resolve().then(() => log.loadAll()).catch(() => {}).then(() => soon());
        } else soon();
      };
      input(count());
      r.tick = after(reread, src.tickMs);
      if (log && typeof log.loadAll === 'function') Promise.resolve().then(() => log.loadAll()).catch(() => {}).then(() => soon());
    }

    r.stop = () => {
      r.stopped = true;
      r.offs.forEach((off) => { try { off(); } catch { /* gone */ } });
      r.offs.length = 0;
      for (const k of ['tick', 'smooth', 'trail', 'quiet', 'gateTrail']) { cancel(r[k]); r[k] = null; }
    };
    runners.set(b.id, r);
    setStatus(b.id, 'running');
  }

  function stopRunner(id, { restore = true } = {}) {
    const r = runners.get(id);
    if (!r) return;
    runners.delete(id);
    r.stop?.();
    const b = bindings.get(id);
    if (restore && b) clearOverlay(b.target.instance, b.target.key);
  }

  // ---- bindings -----------------------------------------------------------------------
  function add(raw, { silent = false } = {}) {
    if (dead) return { ok: false, reason: 'destroyed' };
    const b = normalizeBinding(raw);
    if (!b) return { ok: false, reason: 'invalid-binding' };
    if (bindings.has(b.id)) return { ok: false, reason: 'duplicate-id' };
    // ONE DRIVER PER SETTING - `links.js`'s cardinality 'one', for the same reason: two automations
    // fighting over one number is a flicker, and "which wins" has no answer anybody would guess.
    const existing = [...bindings.values()].find((x) =>
      x.target.instance === b.target.instance && x.target.key === b.target.key);
    if (existing) return { ok: false, reason: 'already-bound', existing: existing.id };
    const t = targets.get(b.target.instance);
    if (t) {
      const ok = bindable(t.fields.get(b.target.key), t.raw.get(b.target.key), guards);
      if (!ok.ok) return { ok: false, reason: 'not-bindable', why: ok.why };
    }
    bindings.set(b.id, b);
    startRunner(b);
    if (!silent) { try { onChange?.(list()); } catch (err) { console.error('automation: onChange', err); } }
    return { ok: true, binding: b };
  }

  function remove(id, { silent = false } = {}) {
    if (!bindings.has(id)) return false;
    stopRunner(id);
    bindings.delete(id);
    status.delete(id);
    if (!silent) { try { onChange?.(list()); } catch (err) { console.error('automation: onChange', err); } }
    return true;
  }

  // JSON-safe copies: what the host stores.
  function list() { return [...bindings.values()].map((b) => JSON.parse(JSON.stringify(b))); }

  /**
   * REPLACE the set with a stored list - and only touch what CHANGED. A host calls this every
   * time the screen's settings row changes; restarting every binding each time would reset every
   * LFO's phase and every verb dial's position whenever somebody changed an unrelated setting.
   */
  function load(rawList = []) {
    const want = new Map();
    const rejected = [];
    for (const raw of Array.isArray(rawList) ? rawList : []) {
      const b = normalizeBinding(raw);
      if (b && !want.has(b.id)) want.set(b.id, b); else rejected.push(raw);
    }
    for (const id of [...bindings.keys()]) {
      const w = want.get(id);
      if (!w || JSON.stringify(w) !== JSON.stringify(bindings.get(id))) remove(id, { silent: true });
    }
    for (const [id, b] of want) {
      if (bindings.has(id)) continue;
      const res = add(b, { silent: true });
      if (!res.ok) rejected.push({ binding: b, ...res });
    }
    return { count: bindings.size, rejected };
  }

  // ---- targets: the wrapped state handle ---------------------------------------------
  /**
   * Wrap one module instance's state handle. The module gets this instead of the raw handle and
   * needs no change: `get()` and `subscribe` see base + overlay, `set()` writes the base.
   *
   * `set()` DROPS AN ECHO: a key being driven, written back with exactly the driven value, is a
   * module (or a menu) repeating what it was shown, not somebody choosing it - and persisting it
   * would make the automated value the base, so removing the binding would restore nothing.
   * The cost: somebody who deliberately sets a driven setting to exactly its current driven value
   * writes nothing. Every other value they choose goes to the base, and comes into force when the
   * binding goes.
   */
  function wrapState(instance, handle, { manifest = null, fields = null } = {}) {
    if (!handle || !instance) return handle;
    const { decls, norm } = withExtra(fields || rawDecls(manifest),
      fields ? fields.map(normalizeField).filter(Boolean) : fieldsFor(manifest, null), extra);
    const prior = targets.get(instance);
    const t = { handle, fields: new Map(norm.map((f) => [f.key, f])),
                raw: new Map(decls.filter((d) => d && d.key).map((d) => [d.key, d])),
                overlay: new Map(), listeners: new Set() };
    if (prior) for (const b of bindings.values()) if (b.target.instance === instance) stopRunner(b.id, { restore: false });
    targets.set(instance, t);
    for (const b of bindings.values()) if (b.target.instance === instance) startRunner(b);

    const wrapped = Object.assign({}, handle, {
      get: () => merged(t),
      subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        const off = handle.subscribe?.((row) => fn(t.overlay.size ? { ...row, ...Object.fromEntries(t.overlay) } : row));
        t.listeners.add(fn);
        return () => { try { off?.(); } finally { t.listeners.delete(fn); } };
      },
      set(patch) {
        const out = {};
        for (const [k, v] of Object.entries(patch || {})) {
          if (t.overlay.has(k) && Number(v) === t.overlay.get(k)) continue;   // an echo
          out[k] = v;
        }
        if (!Object.keys(out).length) return Promise.resolve();
        return handle.set?.(out);
      },
      destroy() {
        // The panel is going. Its runners stop (no timers, no subscriptions); its BINDINGS stay -
        // they are the screen's, and they start again when the panel is mounted again.
        if (targets.get(instance) === t) {
          for (const b of bindings.values()) if (b.target.instance === instance) stopRunner(b.id, { restore: false });
          targets.delete(instance);
          for (const b of bindings.values()) if (b.target.instance === instance) setStatus(b.id, 'waiting for its panel');
        }
        t.listeners.clear();
        return handle.destroy?.();
      },
      // For a settings menu: the value somebody SET (not the one on screen), and which keys are
      // being driven right now, so a row can say "driven by an automation".
      base: handle,
      automated: () => [...t.overlay.keys()],
    });
    return wrapped;
  }

  function destroy() {
    for (const id of [...runners.keys()]) stopRunner(id);
    for (const id of [...timers]) cancel(id);
    dead = true;
  }

  return {
    add, remove, list, load, wrapState, destroy,
    get: (id) => (bindings.has(id) ? JSON.parse(JSON.stringify(bindings.get(id))) : null),
    status: (id) => status.get(id) || null,
    overlay: (instance) => Object.fromEntries(targets.get(instance)?.overlay || []),
    targets: () => [...targets.keys()],
    // For teardown tests: every timer this engine has armed and not yet seen fire or cancelled.
    activeTimers: () => timers.size,
    running: () => runners.size,
    // The period an LFO binding is ACTUALLY running at (its own, or slower under the flash limit).
    lfoPeriod: (id) => runners.get(id)?.periodMs ?? null,
    flashLimit: () => limitNow(),
    // The host's own numbers on every panel (panel_drive.js), for the editor's list of what can be driven.
    extraFields: () => extra.slice(),
  };
}
