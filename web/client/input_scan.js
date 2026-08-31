// input_scan.js — SCANNING: the machine offers the options one at a time, and the person
// answers with the only thing they have.
//
// Extracted out of the private `scan_yesno.js`, which is where this lived as a module. The
// build map asked for the scan LOOP and not only the timing, and the reason it is worth
// separating is the same one that made the input bus worth building: a scan loop written
// inside an AAC board is a scan loop the trivia game, the settings menu and the photo picker
// each have to write again. This file is the loop; the board on top of it is its own module.
//
// ---------------------------------------------------------------------------------------
// *** FIFTEEN SECONDS, AND IT IS NOT A UI DEFAULT ***
// ---------------------------------------------------------------------------------------
//
// The number and its reason come across verbatim from the private source, because the reason
// is a statement about one person's processing and nothing here could re-derive it:
//
//   > *"(>=15s: she understands the task but needs time to process the cue before
//   > signaling)"*
//
// Carried, not re-derived. Read that sentence before anyone "tunes" it: it separates
// understanding from response time, which is the distinction almost every scanning default in
// the field gets wrong in the other direction. A rate that is comfortable for the person
// setting it up is usually far too fast for the person using it, and the failure looks
// identical to not understanding the question.
//
// `settings_audit.js` already models the cost of this: on a 15-second step, walking a settings
// menu is *"six minutes to change one setting."* That is the price of the number, it is known,
// and it is worth paying.
//
// ---------------------------------------------------------------------------------------
// THE WORD IS `step`, AND THAT IS A COLLISION BEING CLOSED RATHER THAN A PREFERENCE
// ---------------------------------------------------------------------------------------
//
// The private module calls this interval the DWELL. So does `settings_audit.js` ("scan
// dwell"). But `input_dwell.js` now uses `dwell` for holding still to click, which is where
// the AT field puts the word — eye-gaze and head-pointer software all say "dwell click", while
// scanning is more often "scan rate" or "step time".
//
// The glossary recorded that collision with a plan: the scanning sense moves, and it moves
// when scanning is extracted rather than before, so the rename lands in the rewrite instead of
// churning a module about to be replaced. **This is that moment.** `stepMs` it is.
//
// ---------------------------------------------------------------------------------------
// HYBRID: THE CLOCK ADVANCES IT, AND SO CAN A PRESS
// ---------------------------------------------------------------------------------------
//
// One switch: the timer advances, the switch selects. Two switches: one advances, one selects.
// This does both at once and neither is a mode — `next()` simply exists, and a setup that
// never binds it never calls it. Somebody who can hit a second switch skips the wait; somebody
// who cannot is not asked to.
//
// `next()` RESTARTS the clock rather than letting the remainder run out. Jumping to an option
// and then being given a third of a second to decide about it is worse than not jumping.
//
// ---------------------------------------------------------------------------------------
// IT WRAPS, AND IT NEVER STOPS ON ITS OWN
// ---------------------------------------------------------------------------------------
//
// **Wrapping** because with one switch you can only travel one way; a list that stopped at the
// end would strand somebody there. Same rule `settings_fields.js` already ships under.
//
// **Never stopping** because a scanner that gave up after N laps would take away the one thing
// the person can operate, at exactly the moment they were taking longer than expected — which
// is the safety invariant in `AGENTS.md` wearing a helpful face. Laps are COUNTED (`laps()`)
// because a caregiver watching the count go up is real information, but nothing here acts on
// it. A scanner that runs all afternoon and is never answered is behaving correctly.

export const SCAN_DEFAULTS = {
  // See the header. This is her number, with her reason, and it is not a UI default.
  stepMs: 15000,
  // A beat after a choice so it registers before the loop starts moving again. Also from the
  // private build.
  pauseMs: 1200,
  // Where the next scan starts: 'first' returns to the top, 'here' carries on from what was
  // chosen. 'first' is the default because a Yes/No board should always offer Yes first, and a
  // person who has just answered should not have to sit through a lap to get back to it.
  restart: 'first',
};

export const RESTARTS = ['first', 'here'];

/**
 * The scan loop.
 *
 * Deliberately knows nothing about cards, speech or the DOM: it owns an ordered list, an
 * index, and a clock. `onStep` and `onSelect` are how anything else finds out.
 *
 * The clock is injected, so the whole of this is testable as arithmetic rather than by waiting
 * fifteen seconds per assertion — which for a fifteen-second default is the difference between
 * a suite that runs and one that does not.
 */
export function createScan({
  items = [],
  settings = () => ({}),
  onStep = null,          // (item, index) — the highlight moved
  onSelect = null,        // (item, index) — somebody chose
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let list = [...items];
  let idx = 0;
  let laps = 0;
  let timer = null;
  let suppressed = 0;
  let running = false;
  let destroyed = false;

  const cfg = () => {
    const s = { ...SCAN_DEFAULTS, ...(settings() || {}) };
    if (!RESTARTS.includes(s.restart)) s.restart = SCAN_DEFAULTS.restart;
    s.stepMs = Math.max(0, Number(s.stepMs) || 0) || SCAN_DEFAULTS.stepMs;
    s.pauseMs = Math.max(0, Number(s.pauseMs) || 0);
    return s;
  };

  const current = () => (list.length ? list[idx] : null);

  function announce() {
    if (!list.length) return;
    try { onStep?.(list[idx], idx); } catch (err) { console.error('scan: onStep', err); }
  }

  function clear() { if (timer != null) { clearTimer(timer); timer = null; } }

  function arm(ms) {
    clear();
    if (destroyed || !running || suppressed > 0 || list.length < 2) return;
    timer = setTimer(tick, ms);
  }

  function tick() {
    timer = null;
    if (destroyed || !running || suppressed > 0) return;
    advance();
    arm(cfg().stepMs);
  }

  function advance() {
    if (!list.length) return;
    const was = idx;
    idx = (idx + 1) % list.length;
    // A lap is counted when the index WRAPS, not every step — so the number means "how many
    // times the whole set has been offered", which is what somebody watching wants to know.
    if (idx <= was) laps += 1;
    announce();
  }

  return {
    // ---- what is on offer -------------------------------------------------------------
    items: () => [...list],
    index: () => idx,
    current,
    laps: () => laps,
    isRunning: () => running && suppressed === 0,

    /**
     * Replace the options. The index goes back to the start rather than being clamped: a new
     * set of choices is a new question, and resuming three items into a list somebody has not
     * seen would offer them an option they were never shown moving to.
     */
    setItems(next) {
      list = [...(next || [])];
      idx = 0;
      laps = 0;
      announce();
      if (running) arm(cfg().stepMs);
    },

    start() {
      if (destroyed) return;
      running = true;
      announce();
      arm(cfg().stepMs);
    },

    stop() { running = false; clear(); },

    /** Jump ahead. The clock restarts — see the header on why the remainder is not kept. */
    next() {
      if (destroyed || !list.length) return null;
      advance();
      arm(cfg().stepMs);
      return current();
    },

    /**
     * Choose whatever is lit.
     *
     * Returns the item so a caller that wants to act synchronously can, and also reports it
     * through `onSelect` so anything else watching hears the same thing. Then it holds for
     * `pauseMs` before the loop starts moving again.
     */
    select() {
      if (destroyed || !list.length) return null;
      const item = list[idx];
      const at = idx;
      const c = cfg();
      clear();
      try { onSelect?.(item, at); } catch (err) { console.error('scan: onSelect', err); }
      if (c.restart === 'first') { idx = 0; laps = 0; }
      if (running) {
        // The pause, then the loop again — announcing where it restarted, because after a
        // beat of silence the person needs to be told what is on offer now.
        timer = setTimer(() => {
          timer = null;
          if (destroyed || !running || suppressed > 0) return;
          announce();
          arm(c.stepMs);
        }, c.pauseMs);
      }
      return item;
    },

    /**
     * Hold the loop off. A COUNT, not a flag, for the same reason as `input_dwell.js`: an open
     * operator menu and a settings panel can each have a reason, and a boolean lets whichever
     * closes first restart it underneath the other.
     */
    suppress(on) {
      suppressed = Math.max(0, suppressed + (on ? 1 : -1));
      if (suppressed > 0) clear();
      else if (running) { announce(); arm(cfg().stepMs); }
    },
    isSuppressed: () => suppressed > 0,

    destroy() { destroyed = true; running = false; clear(); },
  };
}
