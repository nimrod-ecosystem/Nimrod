// tempo.js — TEMPO IS A VALUE, NOT A BUS. §1.2 item 3 of bus_and_generator_20260910.md.
//
// Publishing "the current beat" at any useful resolution is a bus flood: 120 bpm at
// sixteenth-note resolution is 8 messages a second to every subscriber, and fanning that out
// through a synchronous bus loop (`bus.js` has no queue — see its own header) to twenty
// panels on a Pi 400 is a measurement nobody has taken and a risk nobody needs to run.
//
// So: publish the EQUATION, once, whenever it changes — `{bpm, origin, meter}` — and let
// every subscriber compute "where am I in the bar" locally from wall-clock time. `origin` is
// the wall-clock moment beat 0 of bar 0 landed, so any later moment converts to a beat
// position with one division and no drift between subscribers, because they are all doing
// the same arithmetic against the same shared origin rather than counting independently
// from whenever each of them happened to start listening.
//
// THIS IS ALSO THE ONLY FORM AUDIO CAN USE. Web Audio schedules ahead of its own clock and
// cannot be driven by bus messages arriving on the main thread; Tone.js's transport (the
// already-picked choice for whenever Music/Tone.js starts — see the change list) wants a
// tempo/origin pair to schedule against, not a stream of tick events, so this is not a
// simplification made FOR the bus — it is the shape the eventual consumer needs anyway.
//
// *** THE ONE DEFAULT TO KEEP: NOTHING BINDS TO THIS AUTOMATICALLY. *** §1.2 item 4: a scan
// rate is a person's motor parameter, and "a layout never changes under somebody without a
// decision" has an exact analogue — a scan rate never changes under somebody without a
// decision either. A module that wants to move on the beat imports `nextBeatAt` and decides
// to; nothing here reaches into `input_scan.js` or anywhere else on its own.

import { createContinuousConditioner } from './conditioning.js';

// One well-known topic — tempo is a SCREEN-WIDE fact (like the daypart, like the theme), not
// per-instance, so it does not go through `bus.js`'s instance addressing (item 2) the way a
// data link's value does. Anything on the screen that cares reads the same one.
export const TEMPO_TOPIC = 'tempo/value';

// ---------------------------------------------------------------------------------------
// normalizeTempo — never throws, drops what it cannot use. `bpm` must be a real, positive
// number (a tempo of 0 or negative is nonsense, not a "very slow" edge case worth accepting).
// `origin` defaults to now — set the tempo and the bar starts counting from this moment,
// which is the natural default for "start the piece now" and is overridable for anything
// that needs to align to a bar that already started elsewhere. `meter` defaults to 4 (4/4),
// the ordinary case, and is rounded to a whole number of beats per bar.
// ---------------------------------------------------------------------------------------
export function normalizeTempo(raw) {
  const bpm = Number(raw?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  const originRaw = Number(raw?.origin);
  const origin = Number.isFinite(originRaw) ? originRaw : Date.now();
  const meterRaw = Math.round(Number(raw?.meter));
  const meter = Number.isFinite(meterRaw) && meterRaw > 0 ? meterRaw : 4;
  return { bpm, origin, meter };
}

// ---------------------------------------------------------------------------------------
// createTempoSender — publishes ONLY on change, reusing the continuous-class conditioner
// from `conditioning.js` rather than a bespoke equality check re-deriving the same rule a
// second time. `shallowEqualValue` (its default comparator) is exactly right for a plain
// {bpm, origin, meter} object.
// ---------------------------------------------------------------------------------------
export function createTempoSender(bus, { conditioner = null } = {}) {
  const guard = conditioner || createContinuousConditioner();
  function set(raw) {
    const t = normalizeTempo(raw);
    if (!t) return false;
    const verdict = guard.next(t, Date.now());
    if (!verdict.accepted) return false;
    bus.publish(TEMPO_TOPIC, t);
    return true;
  }
  return { set };
}

// ---------------------------------------------------------------------------------------
// The subscriber-side math — pure, and this is the whole point: nothing ticks, everything
// that wants a beat position computes it on demand from wall-clock + the last tempo value.
// ---------------------------------------------------------------------------------------

// How many beats (fractional) have elapsed since origin, at `atMs`. The one division
// everything else is built from. Clamped to 0 — a moment before origin is "not started yet",
// not a negative beat count nothing downstream expects.
export function beatsSince(tempo, atMs = Date.now()) {
  const msPerBeat = 60000 / tempo.bpm;
  return Math.max(0, (atMs - tempo.origin) / msPerBeat);
}

// {bar, beat, fraction} — which bar (0-based), which beat within it (0-based), and how far
// through that beat (0..1). The fraction is what a metronome-driven visual reads to place
// itself smoothly between two beats instead of snapping from one to the next.
export function barPosition(tempo, atMs = Date.now()) {
  const beats = beatsSince(tempo, atMs);
  const bar = Math.floor(beats / tempo.meter);
  const beatInBar = beats - bar * tempo.meter;
  return { bar, beat: Math.floor(beatInBar), fraction: beatInBar - Math.floor(beatInBar) };
}

// The wall-clock moment the NEXT beat lands, strictly after `afterMs`. What a module that
// deliberately wants to move on the beat (Wait-and-Go's charge, a hold-ladder tier — see the
// generator's own §3.4.9) schedules a real timer against, rather than polling `barPosition`
// in a loop.
export function nextBeatAt(tempo, afterMs = Date.now()) {
  const msPerBeat = 60000 / tempo.bpm;
  const nextBeatIndex = Math.floor(beatsSince(tempo, afterMs)) + 1;
  return tempo.origin + nextBeatIndex * msPerBeat;
}
