// watchdog.js — "this should have made progress by now."
//
// Anything that streams can hang without ever failing: a video that loads forever, a photo
// whose fetch never returns, a speech clip that never starts. None of those raise an error
// — a hung request is not an error — so the thing waiting for them waits forever. That is
// how a screen in a care facility ends up frozen on a spinner until somebody visits.
//
// This is the shared answer, in two parts:
//
//   arm(key)   something was asked for; start the clock
//   ok()       it arrived; STOP the clock (a finished load needs no more watching)
//   beat()     it's still alive; RESTART the clock (a heartbeat, for open-ended things)
//   disarm()   never mind (hidden, destroyed, moved on)
//
// `ok` and `beat` are different on purpose, and confusing them is a real bug: a load that
// completes should stop the watchdog, while a long-running segment reporting "still here"
// should reset it. Using `ok` for a heartbeat silences the watchdog after the FIRST beat
// and it never fires again — which is exactly the failure it was built to catch.
//
// If the clock runs out it calls `onRetry(key)` up to `retries` times — most stalls are a
// blip and a second attempt just works — and then `onGiveUp(key)` once. The CALLER decides
// what retry and give-up mean, because only it knows how to re-ask for its own content.
//
// TWO LEVELS ARE INTENDED, and they do different jobs:
//   * a MODULE arms one around its own loads, and retries by reloading its content;
//   * a CONTAINER (the director) arms a slower one around a whole segment, fed by
//     `segment/progress` heartbeats, so a provider that hangs WITHOUT using a watchdog —
//     including one written later by someone who never read this file — still can't freeze
//     the rotation. The backstop exists precisely because the first level is opt-in.
//
// Timers are injectable so this is testable against a fake clock, with no waiting.
//
// `stallMs` may be a NUMBER or a FUNCTION returning one. The function form matters when the
// interval comes from per-profile settings that load asynchronously: capturing the number at
// construction time silently pins whatever the default was, and a later change never takes
// effect until the module is remounted.

export function createWatchdog({
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  stallMs = 20000,
  retries = 1,
  onRetry = null,
  onGiveUp = null,
} = {}) {
  let timer = null;
  let key = null;
  let used = 0;          // retries spent on the CURRENT key
  // A RETRY THAT SUCCEEDS IMMEDIATELY used to leave a timer armed behind it. `fire` calls
  // `onRetry` and then re-arms for the next attempt — but a retry can settle synchronously
  // (a cached video that plays the instant it is asked to, a paused one that resumes), and
  // that calls `ok()` from inside the callback. `ok()` cleared the timer; `fire` then armed
  // a fresh one anyway, against content that was already playing. The result was a working
  // video being nudged every stallMs forever.
  //
  // `epoch` is how `fire` finds out. Anything that changes what is being watched bumps it;
  // if it moved while `onRetry` was running, the callback already decided the outcome and
  // `fire` must not overrule it.
  let epoch = 0;

  const ms = () => {
    const v = typeof stallMs === 'function' ? Number(stallMs()) : Number(stallMs);
    return Number.isFinite(v) && v > 0 ? v : 0;      // 0 (or junk) disables it
  };

  function disarm() {
    if (timer != null) { clearTimer(timer); timer = null; }
    key = null;
    epoch += 1;
  }

  function arm(k = null) {
    // A new key is a new subject: reset the retry budget. Re-arming the SAME key (which is
    // what a retry does) keeps the budget, or a stall would retry forever.
    if (k !== key) used = 0;
    if (timer != null) { clearTimer(timer); timer = null; }
    key = k;
    epoch += 1;
    const wait = ms();
    if (!wait) return;               // 0 disables the watchdog entirely
    timer = setTimer(fire, wait);
  }

  // It arrived. Stops the clock and clears the retry budget, so a stall an hour from now
  // gets its own full set of attempts rather than inheriting an old one.
  function ok() {
    if (timer != null) { clearTimer(timer); timer = null; }
    used = 0;
    epoch += 1;
  }

  // Still alive. Restarts the clock on the SAME subject and clears the retry budget. A
  // no-op when nothing is being watched, so a stray heartbeat can't arm the watchdog
  // against a segment that already ended.
  function beat() {
    if (key === null) return;
    used = 0;
    epoch += 1;
    if (timer != null) { clearTimer(timer); timer = null; }
    const wait = ms();
    if (!wait) return;
    timer = setTimer(fire, wait);
  }

  function fire() {
    timer = null;
    const k = key;
    if (used < retries) {
      used += 1;
      const before = epoch;
      try { onRetry?.(k, used); } catch (err) { console.error('watchdog onRetry', err); }
      // If the retry already settled it — ok(), disarm(), or a move to something else —
      // leave it alone. Re-arming here would watch content that is already playing.
      if (epoch !== before) return;
      // Otherwise the caller has re-asked for the same thing; re-arm for it, budget intact.
      const wait = ms();
      if (!wait) return;
      timer = setTimer(fire, wait);
      return;
    }
    key = null;
    try { onGiveUp?.(k); } catch (err) { console.error('watchdog onGiveUp', err); }
  }

  return {
    arm, ok, beat, disarm,
    armed: () => timer != null,
    key: () => key,
    attempts: () => used,
  };
}
