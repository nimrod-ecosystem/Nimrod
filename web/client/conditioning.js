// conditioning.js — the wire-transform family, by class. §1.2 item 2 of
// bus_and_generator_20260910.md:
//
//   "Conditioning is not unique to inputs; it is a transform family whose members are
//    chosen by traffic class. A score does not bounce — agreed — but a score needs 'do not
//    re-publish an unchanged value' (the feedback guard), a continuous value needs
//    rate-limiting and smoothing (the tremor filter and dwell are exactly this, on `aim`),
//    and a press needs debounce, hold, lockout and a stuck-switch watchdog. Same shape — a
//    stateful transform on the wire — three member sets... conditioning lives on the wire
//    for every class; which conditioners apply is fixed by whether the port is an event or
//    a continuous value, and the physical ones (debounce, hold, lockout) are the
//    event-class members."
//
// `input.js` already implements debounce/hold/lockout, correctly, and stays exactly as it
// is — this file does not replace it or reach into its state. What `input.js` has is coupled
// to DEVICES and BINDINGS (a holdMs that inherits from a device registry, a binding id keyed
// lockout); a data link's event-class port has neither. This extracts the same THREE RULES,
// same names, same timing semantics, same rejection reasons, as pure functions over nothing
// but timestamps — so an event-class link, or anything else on the wire that is not a
// physical press, gets the identical family without depending on the input system at all.
//
// EVENT-CLASS MEMBERS: debounce, minimum hold, repeat lockout — the note's own three, in the
// note's own order.
// CONTINUOUS-CLASS MEMBERS: the unchanged-value guard, and rate limiting — the note's other
// two ("a score needs the feedback guard... a continuous value needs rate-limiting").
//
// Note "condition" itself is SPENT in `docs/glossary.md` §3 — the clinical sense in
// README.md/AGENTS.md. "Conditioning" is a different, already-shipped word (input.js's own
// holdMs/debounceMs/lockoutMs system) and stays that word here; nothing in this file uses
// the bare noun.

// ---------------------------------------------------------------------------------------
// EVENT-CLASS: createEventConditioner — debounce, minimum hold, repeat lockout.
//
// Mirrors input.js's own timing rules exactly, because they are the reference implementation
// and diverging from them here would mean the same word means two different waits depending
// on which file you are reading:
//
//   debounce   judged on the RAW down edge, against the PREVIOUS raw down edge — a bounce
//              must not even start a hold timer, so this is checked first and always updates
//              `lastDownAt`, accepted or not.
//   hold       the control (or condition) must persist at least `holdMs` before it counts;
//              released early reports 'too-short', exactly input.js's own reason.
//   lockout    judged against the last ACCEPTED fire, not the last raw edge — a repeat
//              inside the window is suppressed even if it would otherwise pass debounce
//              and hold cleanly.
//
// Usage is two calls, because a hold has a start and an end and the verdict about lockout
// can only be known once the duration is: `down(at)` first, and if it returns null (not
// rejected), the caller reports the eventual release through `up(downAt, at)`. An event with
// no duration at all (already known to be instantaneous) can call `up(at, at)` directly —
// `heldMs` will be 0, which only matters if `holdMs > 0` was actually asked for.
// ---------------------------------------------------------------------------------------
export function createEventConditioner({ debounceMs = 0, holdMs = 0, lockoutMs = 0 } = {}) {
  let lastDownAt = null;
  let lastFireAt = null;

  function down(at = Date.now()) {
    if (debounceMs > 0 && lastDownAt != null && at - lastDownAt < debounceMs) {
      lastDownAt = at;
      return { accepted: false, reason: 'debounce' };
    }
    lastDownAt = at;
    return null;   // proceed — the caller reports `up` once the duration is known
  }

  function up(downAt, at = Date.now()) {
    const heldMs = Math.max(0, at - downAt);
    if (holdMs > 0 && heldMs < holdMs) return { accepted: false, reason: 'too-short', heldMs };
    if (lockoutMs > 0 && lastFireAt != null && at - lastFireAt < lockoutMs) {
      return { accepted: false, reason: 'lockout', heldMs };
    }
    lastFireAt = at;
    return { accepted: true, heldMs };
  }

  return { down, up };
}

// ---------------------------------------------------------------------------------------
// CONTINUOUS-CLASS: createContinuousConditioner — the unchanged-value guard, rate limiting.
//
//   unchanged   a value identical to the last one ACCEPTED is dropped — "a score does not
//               bounce" but it also should not re-publish 40 twice in a row for no reason.
//               Checked first: an unchanged value should never even reach the rate check,
//               the same way a bounce never reaches the hold timer above.
//   rate limit  a value that IS different is still dropped if it arrives inside
//               `minIntervalMs` of the last one that was actually sent — latest-wins is the
//               caller's job (hold the newest rejected value and try again on the next
//               tick); this function only says whether THIS call may send now.
//
// `equalValue` defaults to a shallow comparison — `===` for primitives, and for a plain
// {x, y}-shaped object (an `aim` reading, say) equal keys and equal primitive values. A port
// carrying something richer supplies its own comparator rather than this guessing at one.
// ---------------------------------------------------------------------------------------
export function shallowEqualValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export function createContinuousConditioner({ minIntervalMs = 0, equalValue = shallowEqualValue } = {}) {
  let lastValue; let hasValue = false; let lastSentAt = null;

  function next(value, at = Date.now()) {
    if (hasValue && equalValue(value, lastValue)) return { accepted: false, reason: 'unchanged' };
    if (minIntervalMs > 0 && lastSentAt != null && at - lastSentAt < minIntervalMs) {
      return { accepted: false, reason: 'rate-limited' };
    }
    lastValue = value; hasValue = true; lastSentAt = at;
    return { accepted: true };
  }

  return { next };
}

// The one lookup a link's own wiring needs: which family applies. A pure function so the
// (future) patch-bay UI and a runtime sender can both ask the same question without either
// one hardcoding the class->family mapping a second time.
export function conditionerFamily(portClass) {
  return portClass === 'event' ? 'event' : 'continuous';
}
