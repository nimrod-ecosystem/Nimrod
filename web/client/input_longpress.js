// input_longpress.js — HOLD A SWITCH FOR THE PLAIN BAR. Step 6 Stage 3b (2026-09-30).
//
// Design, room-is-the-screen, "The plain bar (the invariant)": the plain transport bar opens by
// Escape, automatically when no placed module carries the bar, and by *"a long switch press, 1.5 s by
// default, settable from 1 to 3 s. A fill ring appears after 250 ms and says 'Keep holding for the
// plain bar', so the gesture can be learned. A short press is an ordinary switch press."* Mike took
// those numbers as the defaults (MIKE_LIST_20260930, Q8). Nothing in the input layer had a long
// press before this: `input.js` has a MINIMUM hold before a press counts, and `input_dwell.js` says
// outright that a dwell cannot be one.
//
// *** IT LISTENS TO THE PHYSICAL EDGES, NOT TO THE VERBS. *** `input.js` publishes every down and up
// of every control on `access/edge` (EDGE_TOPIC), bound or not, with one `pressId` per physical
// press. That is exactly the measurement a long press is, so this needs no hook in the input bus and
// no binding: any bound switch, key or button held long enough summons the bar, whatever it is bound
// to. Which is the point -- the plain bar is the way back when a dashboard has gone wrong, and it must
// not depend on anybody having thought to bind it.
//
// *** WHAT COUNTS. *** A bound control on a device a person presses: a switch, a key, a gamepad or HID
// button. NOT a pointer (holding a mouse button is how you drag, and free placement is coming) and NOT
// an unbound control (a key nobody gave a job, or a modifier). A SYNTHESIZED release (`auto`: the
// max-hold watchdog, a window blur) ends the hold like a real one -- nobody is holding any more.
//
// *** WHAT IT DOES NOT DO, SAID OUT LOUD. *** A press-edge binding fires on the way DOWN, so a long
// press has already delivered its ordinary press by the time the ring appears. Telling the two apart
// would mean holding back EVERY press until the switch is released or the hold runs out -- latency on
// every press, for every switch user, to protect a gesture that exists for emergencies. Not done.
// Summoning the plain bar is harmless on top of whatever the press did.
//
// ONCE PER PRESS. Holding on past the threshold does not summon it again.

import { EDGE_TOPIC } from './input.js';
import {
  PLAIN_BAR_SHOW, PLAIN_BAR_RING, PLAIN_BAR_RING_END,
  PLAIN_BAR_HOLD_DEFAULT_MS, PLAIN_BAR_HOLD_MIN_MS, PLAIN_BAR_HOLD_MAX_MS, PLAIN_BAR_RING_AFTER_MS,
} from './shell_verbs.js';

// Device classes a person PRESSES. `pointer` and `other` (the dwell, a face gesture) are left out.
export const LONGPRESS_CLASSES = ['switch', 'keyboard', 'gamepad', 'hid', 'serial', 'bluetooth'];

/** The hold length actually used: a number of ms, clamped to 1-3 s; anything else is the default. */
export function clampHoldMs(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return PLAIN_BAR_HOLD_DEFAULT_MS;
  return Math.min(PLAIN_BAR_HOLD_MAX_MS, Math.max(PLAIN_BAR_HOLD_MIN_MS, n));
}

export function createLongPress({
  bus,
  holdMs = () => PLAIN_BAR_HOLD_DEFAULT_MS,      // read at every press: a setting changes live
  ringAfterMs = PLAIN_BAR_RING_AFTER_MS,
  classes = LONGPRESS_CLASSES,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!bus) throw new Error('createLongPress: bus is required');
  const held = new Map();       // pressId -> { ringT, fireT, ringing, fired }
  let destroyed = false;

  function end(id, fired) {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    if (h.ringT != null) clearTimer(h.ringT);
    if (h.fireT != null) clearTimer(h.fireT);
    if (h.ringing && !h.fired) bus.publish(PLAIN_BAR_RING_END, { pressId: id, fired: !!fired });
  }

  const off = bus.subscribe(EDGE_TOPIC, (e) => {
    if (destroyed || !e) return;
    const id = e.pressId;
    if (e.phase === 'up') { end(id, false); return; }
    if (e.phase !== 'down' || !e.bound || !classes.includes(e.deviceClass)) return;
    end(id, false);                                   // never two timers for one press
    const ms = clampHoldMs(typeof holdMs === 'function' ? holdMs() : holdMs);
    const h = { ringT: null, fireT: null, ringing: false, fired: false };
    held.set(id, h);
    h.ringT = setTimer(() => {
      h.ringT = null;
      if (held.get(id) !== h) return;
      h.ringing = true;
      bus.publish(PLAIN_BAR_RING, { pressId: id, holdMs: ms, ringAfterMs, startedAt: now() });
    }, Math.min(ringAfterMs, ms));
    h.fireT = setTimer(() => {
      h.fireT = null;
      if (held.get(id) !== h) return;
      h.fired = true;
      if (h.ringing) bus.publish(PLAIN_BAR_RING_END, { pressId: id, fired: true });
      bus.publish(PLAIN_BAR_SHOW, { via: 'long-press', pressId: id });
    }, ms);
  });

  return {
    /** How many presses are being timed right now (for a test, and a diagnostic page). */
    holding: () => held.size,
    destroy() {
      destroyed = true;
      for (const id of [...held.keys()]) end(id, false);
      try { off?.(); } catch { /* already gone */ }
    },
  };
}
