// input_dwell.js — HOLDING STILL IS THE CLICK.
//
// Found by auditing the private `cici_color.js` against this repo's `input_marker.js`, which
// is what `nimrod-check-first` is for. The detection half ported faithfully — same DET_W/H,
// same gain, smooth, hueTol, satMin, valMin, minPx, all the numbers tuned in the room. **The
// ACTIVATION half did not come across at all.** Nothing in this repo turns `input/aim` into a
// press: the marker moves a cursor and there it stops.
//
// Which means the public color tracker was not a stale copy of the private one. It was an
// incomplete one, and incomplete in the half that decides whether the person driving it can SELECT
// anything or only point at it. A tracker that cannot click is a demo.
//
// ---------------------------------------------------------------------------------------
// THE MECHANISM, and the one line in it that is a safety property
// ---------------------------------------------------------------------------------------
//
// Anchor where the aim is. If it wanders further than `radius`, re-anchor and restart the
// clock. If it stays inside for `dwellMs`, that is a press.
//
// *** AND THEN IT WILL NOT FIRE AGAIN UNTIL THE AIM HAS LEFT. ***
//
// That is `mustLeave`, and it is not an anti-jitter nicety — it is the whole difference
// between an input and a fault. Without it, somebody who is still gets a click every 1.8
// seconds, forever: not a stuck key that a person notices and lifts, but a screen being
// operated at random by somebody who has stopped moving. For the person this exists for —
// who cannot reliably move on purpose, let alone on demand — that is the worst failure this
// file could have. The re-arm distance is `radius * leaveFactor` rather than `radius`, so a
// detector shivering on the boundary cannot chatter the two states against each other.
//
// A REPEAT MODE IS NOT BUILT, and that is a gap rather than a rule: somebody scrolling a long
// list by holding a head-pointer still has a real want, and it is a legitimate one. It would
// be a separate setting, off by default, with its own decision — not a relaxation of this.
//
// ---------------------------------------------------------------------------------------
// PIXELS, NOT NORMALIZED UNITS — and it is deliberate
// ---------------------------------------------------------------------------------------
//
// `aim.js` reports 0..1 of the viewport, which is the right unit for a POSITION: it survives
// a resize and a different screen. A dwell radius is not a position. It is a statement about
// how steady somebody's hand or head is, which is physical, and 70px is the number that was
// tuned on a real screen at a real bedside. Stored in pixels and converted from the aim on
// the way in, so the same setting means the same steadiness on a bigger display.
//
// ---------------------------------------------------------------------------------------
// WHY IT IS A DEVICE ON THE INPUT BUS AND NOT PART OF THE TRACKER
// ---------------------------------------------------------------------------------------
//
// It listens to `input/aim`, so it works for ANY producer — the color marker, a head
// pointer, a mouse belonging to somebody who can move a pointer but cannot click. Building it
// inside `input_marker.js` would have made "can this person select things" a property of
// which camera trick they use, which is exactly the coupling the aim bus was created to
// remove.
//
// It emits `down` then `up` immediately, so **a dwell cannot satisfy a `holdMs` binding.**
// There is no long-press by holding still, because holding still is already the gesture. Said
// out loud because a binding that silently never fires is a miserable thing to debug.

import { AIM_TOPIC } from './aim.js';

export const DWELL_DEVICE = 'dwell';
export const DWELL_CONTROL = 'rest';

export const DWELL_DEFAULTS = {
  enabled: true,
  // Every number below is the private bedside build's, not a fresh guess.
  dwellMs: 1800,      // how long the aim must rest before it counts as a press
  radius: 70,         // px the aim may wander while resting
  leaveFactor: 1.5,   // how far outside `radius` the aim must go before it can fire again
};

/** How far apart two points are, in px. Exported because the re-arm rule is worth testing. */
export function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The dwell state machine, as a pure step function.
 *
 * `state` is `{ anchor, t0, mustLeave }` and comes back as a NEW object plus what happened.
 * Pure so the timing can be tested as arithmetic rather than by waiting 1.8 seconds forty
 * times — the same reason `output.js` injects its clock.
 *
 * `point` is null when there is no aim at all (the detector lost the marker). That CLEARS the
 * anchor rather than freezing the clock: a marker that vanishes for two seconds and reappears
 * on the same spot has not been held there, and treating it as if it had would fire a press
 * nobody made.
 */
export function stepDwell(state, point, t, cfg = {}) {
  const { dwellMs, radius, leaveFactor } = { ...DWELL_DEFAULTS, ...cfg };
  const s = state || { anchor: null, t0: 0, mustLeave: null };

  if (!point) return { state: { ...s, anchor: null }, fire: false, progress: 0 };

  // Re-arming after a press: nothing at all happens until the aim has genuinely left.
  if (s.mustLeave) {
    if (distance(point, s.mustLeave) <= radius * leaveFactor) {
      return { state: s, fire: false, progress: 0 };
    }
    return { state: { anchor: point, t0: t, mustLeave: null }, fire: false, progress: 0 };
  }

  if (!s.anchor || distance(point, s.anchor) > radius) {
    return { state: { anchor: point, t0: t, mustLeave: null }, fire: false, progress: 0 };
  }

  const progress = dwellMs > 0 ? Math.min(1, (t - s.t0) / dwellMs) : 1;
  if (progress >= 1) {
    // The anchor becomes the exclusion zone, not the current point: somebody drifting slowly
    // would otherwise carry the zone along with them and never leave it.
    return { state: { anchor: null, t0: 0, mustLeave: s.anchor }, fire: true, progress: 1 };
  }
  return { state: s, fire: false, progress };
}

/**
 * The live adapter. Subscribes to the aim, presses the input bus, reports progress for a ring.
 *
 * `input` is optional — without one it still reports progress, which is what the calibration
 * panel wants when it is showing somebody what dwelling feels like without wiring it to
 * anything.
 */
export function createDwell({
  input = null,
  bus = null,
  device = DWELL_DEVICE,
  control = DWELL_CONTROL,
  settings = () => ({}),
  onProgress = null,
  onFire = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // The aim arrives normalized; this turns it into the pixels the radius is expressed in.
  viewport = () => ({
    w: (typeof window !== 'undefined' ? window.innerWidth : 1920) || 1920,
    h: (typeof window !== 'undefined' ? window.innerHeight : 1080) || 1080,
  }),
  // How often the clock is re-checked. The aim itself only ticks when the pointer MOVES, and
  // a dwell is defined by not moving — so a poll is not an optimisation choice here, it is the
  // only thing that can ever notice the thing this file exists to notice.
  tickMs = 100,
} = {}) {
  let state = { anchor: null, t0: 0, mustLeave: null };
  let point = null;            // last aim, in px
  let suppressed = 0;          // a COUNTER, not a flag — see suppress()
  let timer = null;
  let off = null;
  let lastProgress = -1;
  let destroyed = false;

  const cfg = () => ({ ...DWELL_DEFAULTS, ...(settings() || {}) });

  function report(p) {
    if (p === lastProgress) return;
    lastProgress = p;
    try { onProgress?.(p); } catch (err) { console.error('dwell: onProgress', err); }
  }

  function tick() {
    if (destroyed) return;
    const c = cfg();
    if (!c.enabled || suppressed > 0) { state = { ...state, anchor: null }; report(0); return; }
    const r = stepDwell(state, point, now(), c);
    state = r.state;
    report(r.progress);
    if (r.fire) {
      try {
        // down then up, with no gap — see the header on why a dwell cannot be a long press.
        input?.down?.(device, control);
        input?.up?.(device, control);
        onFire?.({ at: now(), point });
      } catch (err) { console.error('dwell: fire', err); }
    }
  }

  function run() {
    tick();
    if (!destroyed) timer = setTimer(run, tickMs);
  }

  if (bus?.subscribe) {
    off = bus.subscribe(AIM_TOPIC, (a) => {
      if (!a || a.x == null || a.y == null) { point = null; return; }
      const v = viewport();
      point = { x: a.x * v.w, y: a.y * v.h };
    });
  }

  timer = setTimer(run, tickMs);

  return {
    // Nested, because more than one thing can have a reason to hold it off — an open settings
    // menu AND a calibration preview — and a boolean would let whichever finished first
    // re-enable it underneath the other.
    suppress(on) { suppressed = Math.max(0, suppressed + (on ? 1 : -1)); },
    isSuppressed: () => suppressed > 0,
    // For a test, and for a producer that has its own position and no bus.
    feed(px) { point = px; },
    progress: () => Math.max(0, lastProgress),
    state: () => ({ ...state }),
    reset() { state = { anchor: null, t0: 0, mustLeave: null }; report(0); },
    destroy() {
      destroyed = true;
      if (timer != null) { clearTimer(timer); timer = null; }
      try { off?.(); } catch { /* already gone */ }
      off = null;
    },
  };
}
