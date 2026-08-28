// activity.js — HAS ANYTHING HAPPENED ON THIS PAGE RECENTLY?
//
// *** THIS FILE USED TO BE CALLED presence.js AND THAT NAME WAS A LIE. ***
//
// It was written to answer "is somebody in the room?", which is the right question for a
// held pause — a screen paused with a person standing next to it strands nobody; a screen
// paused in an empty room is the failure the whole invariant is about.
//
// It cannot answer that question. Mike pushed on it and he was right to. What it actually
// observes is INPUT ON THIS PAGE, which is a much weaker thing, and the name hid the gap.
//
// ---------------------------------------------------------------------------------------
// *** THE SPECIFIC BLIND SPOT, AND IT IS EXACTLY MIKE'S SCENARIO ***
//
// Her parents visit, and pause the video by clicking the YouTube player's own pause button.
// That click lands inside a CROSS-ORIGIN IFRAME. This file sees NOTHING:
//
//   * DOM listeners on `document` never fire — the event is in another origin's frame.
//   * `navigator.userActivation.isActive` may propagate from a child frame per spec, but it
//     is UNVERIFIED here, and it expires within seconds either way, so it can never sustain
//     a signal across a two-hour visit.
//   * `input/device` only fires for one of HER switches, which a visitor will not touch.
//
// So: **during a visit where the only thing anybody touches is the YouTube player, this file
// reports "nobody here" the entire time.**
//
// ---------------------------------------------------------------------------------------
// WHAT THAT MEANS FOR THE HELD PAUSE, stated plainly so nobody trusts it further than it goes
//
// The hold does NOT depend on this file, and that is the important part:
//
//   * `youtube.js` holds a pause because THE MODULE HAS A PAUSE BUTTON ON SCREEN — a fact
//     about the module, not a measurement. That is what makes the four hours work.
//   * This file only ever EXTENDS a hold that is already running, or upgrades a system pause
//     in `personal.js` when somebody demonstrably used the page.
//
// **The practical consequence, and it should be a known limitation rather than a surprise:**
// on the default four-hour setting, a very long visit where nobody touches anything outside
// the YouTube iframe will see the video resume once, at the four-hour mark. The fix for that
// is the SETTING (12 hours, or never) — not a cleverer version of this file.
//
// A camera-based presence check is the only thing that would really answer the original
// question, and the camera is already in the room for the mirror. That is a much bigger
// decision than this bug deserved and it is NOT taken here.

// How long after some input we still call it "just now". Long enough to cover the gap
// between a press and the event it caused, short enough that it is not a memory.
export const RECENT_MS = 5000;

const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

/**
 * Track when this page last saw input.
 *
 * `now` and `target` are injectable so this is tested against a fake clock and a detached
 * element rather than by waiting and clicking.
 */
export function createActivity({
  now = () => Date.now(),
  target = (typeof document !== 'undefined' ? document : null),
  userActivation = () => (typeof navigator !== 'undefined' ? navigator.userActivation : null),
} = {}) {
  // Starts at "never", not at "now". A screen that has just booted in an empty room has not
  // seen anybody, and pretending otherwise would hold the very first pause for four hours.
  let last = 0;
  const listeners = [];

  function note() { last = now(); }

  if (target && target.addEventListener) {
    for (const name of EVENTS) {
      const fn = () => note();
      // Capture + passive: this must observe everything without altering or delaying any of
      // it. An observer that swallowed a click would be a bug in every module at once.
      target.addEventListener(name, fn, { capture: true, passive: true });
      listeners.push([name, fn]);
    }
  }

  function activation() {
    try { return !!userActivation()?.isActive; } catch { return false; }
  }

  return {
    note,
    lastAt: () => last,
    sinceMs: () => (last ? now() - last : Infinity),

    /**
     * Has this page seen input in the last `withinMs`?
     *
     * NOT "is somebody in the room" — see the header. A `false` here means "nothing has
     * happened on this page", which is consistent with an empty room AND with somebody
     * sitting quietly watching, or using an embed this page cannot see into.
     */
    recent(withinMs = RECENT_MS) {
      if (activation()) return true;
      return !!last && (now() - last) <= withinMs;
    },

    destroy() {
      if (!target || !target.removeEventListener) return;
      for (const [name, fn] of listeners) {
        target.removeEventListener(name, fn, { capture: true });
      }
      listeners.length = 0;
    },
  };
}

// One tracker for the page. Modules share it: this is a fact about the PAGE, not about a
// panel, and four modules each attaching their own listeners would be four copies of the
// same answer.
let shared = null;
export function pageActivity() {
  if (!shared) shared = createActivity();
  return shared;
}

// Tests reach in through this rather than through module internals.
export function _resetPageActivity(next = null) { shared = next; }
