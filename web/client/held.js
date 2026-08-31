// held.js — THE HELD SIGNAL: "somebody stopped this, and it is waiting for them."
//
// `youtube.js` and `personal.js` both already have a held state and both already draw the
// same ⏸ chip for it. What neither of them had was a way to SAY SO to anything else, which
// is why a held screen could only ever show a frozen frame: the one piece of information
// that would let a container do something better never left the module.
//
// This file is that piece of information, and it is deliberately nothing else. Two topics
// and the bookkeeping that keeps them honest.
//
// ---------------------------------------------------------------------------------------
// WHY THIS IS A SHARED FILE AND NOT TWO STRING CONSTANTS
// ---------------------------------------------------------------------------------------
//
// The bookkeeping is the part worth sharing. A module signalling a hold has to get three
// things right, and all three are easy to get wrong the same way twice:
//
//   1. BEGIN IS IDEMPOTENT. `setHeld(true)` is called from several places in youtube.js —
//      the pause branch, the 'never' branch, the poll — and a topic that fires on every one
//      of them makes any listener count holds rather than observe one.
//   2. END ONLY FIRES IF IT BEGAN. Otherwise every ordinary `onPlaying` publishes an end for
//      a hold that never happened, and a listener cannot tell the difference.
//   3. *** DESTROY RELEASES. *** A module torn down while held must publish its end on the
//      way out. This is the one that matters: without it, whatever reacted to the hold is
//      left in a state that only the destroyed module could have left — the safety invariant
//      in `AGENTS.md`, arriving through the back door of a lifecycle bug rather than through
//      a design decision. `release()` exists for exactly that line in `destroy()`.
//
// ---------------------------------------------------------------------------------------
// THE WORD
// ---------------------------------------------------------------------------------------
//
// **`held`, not `paused`.** The distinction is already load-bearing in `youtube.js`: a PAUSE
// is any stop, including buffering and an OS audio-focus change; a HOLD is the subset where
// somebody is understood to be present and coming back, which is why it gets a clock in
// hours instead of seconds. Only the second one should put a wallpaper up — a screen that
// swapped to a wallpaper every time the network hiccuped would be worse than the frozen
// frame it replaced.
//
// `held` was already the word in both modules and in the `held` event kind, so nothing is
// being claimed here that was not already spent.

export const HELD_BEGIN = 'held/begin';
export const HELD_END   = 'held/end';

/**
 * The held signal for one module instance.
 *
 * `source` is the module type ('youtube', 'personal', …) so a listener can say whose hold it
 * is; `info` is merged into the begin payload for anything that wants detail (`reason`, an
 * item id). Payloads are data for a listener, never instructions — nothing downstream should
 * branch on a field this file does not document.
 */
export function createHeldSignal(bus, source, { publish } = {}) {
  const send = publish || ((topic, payload) => bus?.publish?.(topic, payload));
  let on = false;

  return {
    isHeld: () => on,

    begin(info = {}) {
      if (on) return false;                       // rule 1 — one hold, one begin
      on = true;
      send(HELD_BEGIN, { source, ...info });
      return true;
    },

    end(info = {}) {
      if (!on) return false;                      // rule 2 — no end without a begin
      on = false;
      send(HELD_END, { source, ...info });
      return true;
    },

    // rule 3 — for destroy(). Same as end(), named for the call site so it reads as the
    // obligation it is rather than as an optional tidy-up.
    release() { return this.end({ reason: 'gone' }); },
  };
}
