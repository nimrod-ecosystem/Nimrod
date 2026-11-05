// advance.js - "DELAY TIMER THEN VERB": moving on by itself, or waiting for Next. One piece, shared.
//
// Mike, 2026-11-05 (row 2.207): "Since this is something that will be reused multiple places, it should probably be its own
// thing ... the same mechanic for picture slideshow. The difference being this would wait for the page to be read before
// starting the timer. Kind of the same mechanic for scanning. Delay timer then verb."
//
// It was already one function, inside quiz_flow.js (row 2.66, THE WAIT AFTER AN ANSWER), used by the Lessons panel, Word
// games and every quiz_view game; it lives here now, under its own name, and quiz_flow.js re-exports every name it had, so
// nothing that imported it changes. Its rule: 'press' waits for Next; with no voice, the reading time and then the pause;
// with a voice, the pause after the voice finishes and never before the reading time, with a backstop if the voice never
// says it has finished. What to read is the caller's: the Lessons panel passes what a slide says AND shows (pageWords).
// NOT moved onto it yet (proposal_shared_advance_20261105, Goldfish gate): Trivia (it has no auto-advance at all, so that is
// a new option), the photo slideshow (no caption to read; videos keep their own end), scanning (a separate yes).
//
// The stored values and keys are unchanged ('read' | 'press', afterBeatMs, readWpm), so no screen's saved choice moves.

// THE DEFAULTS (argued where they were set, row 2.66; quiz_flow.js FLOW_DEFAULTS uses these):
//   afterAnswer  'read' (go on by itself once it has been read) | 'press' (wait for Next).
//   afterBeatMs  the moment after the reading. 2 s, argued: the old celebration was 3 s with a ~2.5 s line in it, so about
//                half a second after the voice; the old shown answer was 5 s, about 2.5 s after. 2 s is a breath to look at
//                the answer without the next question feeling slow; a setting, 1 to 12 s. (The Lessons panel's own Pace is
//                3 s, its own row.)
//   readWpm      the reading pace when nothing is said aloud. 160 words a minute, argued: an easy pace for reading aloud to
//                oneself, slower than an adult's silent 200-250, because the people this is for include slow readers; Slow
//                (100) and Quick (220) are a setting away.
export const ADVANCE_DEFAULTS = Object.freeze({ afterAnswer: 'read', afterBeatMs: 2000, readWpm: 160 });

/** How long `text` takes to read at `wpm` words a minute (0 for no words). */
export function readingMs(text, wpm = ADVANCE_DEFAULTS.readWpm) {
  const n = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean).length;
  const w = Number(wpm) > 0 ? Number(wpm) : ADVANCE_DEFAULTS.readWpm;
  return n ? Math.round((n / w) * 60000) : 0;
}

/**
 * THE BACKSTOP, for a voice that never says it has finished: the words at a slow speaking pace (100 a
 * minute) plus 10 s. Not a setting, argued: it is reached only when the speech channel's own report never
 * arrives, which output_channels.js's 30 s watchdog already prevents on a real screen; it only keeps a
 * broken voice from holding an answer up for ever.
 */
export const speechBackstopMs = (text) => readingMs(text, 100) + 10000;

export const waitsForNext = (cfg) => !!cfg && cfg.afterAnswer === 'press';
const beatOf = (cfg) => { const n = Number(cfg?.afterBeatMs); return Number.isFinite(n) && n >= 0 ? n : ADVANCE_DEFAULTS.afterBeatMs; };

/**
 * THE ONE RULE (the header). `start({ cfg, text, spoken, holdMs, onDone })` after a celebration or a shown
 * answer: `text` is what was said (or would have been), `spoken` a promise for the end of saying it (or
 * null when nothing is being said, or the end cannot be known), `holdMs` an adapter's least time, if any.
 *   'press'   nothing is started: the screen waits for Next.
 *   no voice  onDone after the reading time + the beat.
 *   a voice   onDone the beat after the voice finishes, never before the reading time; the backstop if the
 *             voice never reports.
 * `stop()` cancels (a press, a new question); a voice finishing after that is ignored.
 */
export function createAfterWait({ setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  now = () => Date.now() } = {}) {
  let t = null;
  let token = 0;
  const clear = () => { if (t !== null) { try { clearTimer(t); } catch { /* gone */ } t = null; } };
  return {
    start({ cfg = {}, text = '', spoken = null, holdMs = 0, onDone = () => {} } = {}) {
      token += 1;
      clear();
      if (waitsForNext(cfg)) return 'press';
      const mine = token;
      const readMs = Math.max(readingMs(text, cfg.readWpm), Number(holdMs) > 0 ? Number(holdMs) : 0);
      const beat = beatOf(cfg);
      const go = () => { if (mine !== token) return; t = null; onDone(); };
      if (!spoken || typeof spoken.then !== 'function') { t = setTimer(go, readMs + beat); return 'read'; }
      const began = now();
      t = setTimer(go, Math.max(readMs, speechBackstopMs(text)) + beat);
      const heard = () => {
        if (mine !== token) return;
        clear();
        t = setTimer(go, Math.max(0, readMs - (now() - began)) + beat);
      };
      spoken.then(heard, heard);
      return 'speech';
    },
    stop() { token += 1; clear(); },
    pending: () => t !== null,
  };
}
/** The same piece under the name Mike gave the mechanic: delay timer, then the verb (`onDone`). */
export const createAdvance = createAfterWait;
