// call_sound.js — WHAT HAPPENS TO THE SCREEN'S OTHER SOUND DURING A CALL. The screen's half of "hear the same thing".
//
// Mike, 2026-10-12 (row 2.79): "we both see and hear the same thing at the same time... the same pictures and videos on
// a call or even just to know I'm looking at the same things when it's not a call." Watch along (play_sync.js) gave the
// SEE half. The HEAR half starts here: on a call, a video the two of them are watching together has to keep playing,
// quietly, under the voices. Until now a call always silenced it (audio_bus.js CALL_MODES, Mike 2026-08-29: "in the case
// of auto answer I would have anything else playing sound pause, and make that an option for any call") - and that option
// existed in the bus but no setting ever reached it.
//
// Two settings on the SCREEN's row, beside the volume and the mixer (kiosk.js SOUND_FIELDS). The screen's, not the
// person's: it is about the room - a bedside screen where the film should keep going under a call and a hallway screen
// where nothing should murmur under one are different rooms, like the volume itself.
//
// Pure wiring, like master_volume.js: it takes the audio bus, a read for the settings row, and a `watched()` that says
// whether somebody is watching along right now (kiosk.js reads play_sync.js's sender: sharing on AND somebody seeing).

import { CALL_DUCK_TO } from './audio_bus.js';

// *** DURING A CALL, OTHER SOUND: THREE CHOICES, AND THE DEFAULT IS "PAUSES, UNLESS SOMEONE IS WATCHING ALONG". ***
// Argued for Mike's list:
//   * 'pause' (the behaviour until today). FOR: Mike's 2026-08-29 ruling word for word, and the safest reading of a
//     drop-in call that opens by itself - nothing is left murmuring under a conversation nobody chose. AGAINST: on a
//     call while watching along it stops the very thing the two people are watching together, which is the exact case
//     Mike described on 2026-10-12. A screen on this choice can never "hear the same thing" on a call.
//   * 'together' (CHOSEN). Pauses for every ordinary call, exactly as 08-29 says, and plays quietly under the voices
//     only while somebody is watching along - which can only happen when the screen allows following and somebody on
//     "Who may see this screen" is seeing it (asked first by default; the screen says "Sharing your screen with ...").
//     That is the moment Mike's 10-12 words are about, and the only one. AGAINST: somebody on a drop-in call while a
//     third person happens to be watching along gets the quiet film rather than the pause - the bus cannot tell
//     whether the caller is the one following (the follower's identity is not on the screen's side of the call).
//     Judged rare and harmless (quieter, never louder than the call), and cheaper than linking two separate sockets.
//   * 'duck' (always under the voices). FOR: somebody who likes a radio murmuring under every call. AGAINST: exactly
//     what 08-29 rejected for the default ("a distraction nobody chose"), so it is a choice, never the default.
// Who wants each? 'pause': a caregiver who wants calls clean, watch along or not. 'duck': the radio person. Neither is
// illegitimate, so all three are offered.
export const CALL_SOUND_KEY = 'callOtherSound';
export const CALL_SOUND_DEFAULT = 'together';
export const CALL_SOUND_FIELD = Object.freeze({
  key: CALL_SOUND_KEY,
  label: 'During a call, other sound',
  kind: 'choice',
  // `standard`: a real choice a caregiver makes once, like "Let people follow what this screen is playing".
  level: 'standard',
  default: CALL_SOUND_DEFAULT,
  options: Object.freeze([
    Object.freeze({ value: 'pause', label: 'pauses' }),
    Object.freeze({ value: 'together', label: 'pauses, but plays quietly under the voices while someone watches along' }),
    Object.freeze({ value: 'duck', label: 'plays quietly under the voices' }),
  ]),
  note: 'Videos and music on this screen during a call. “Watches along” means someone on “Who may see this screen” is '
    + 'seeing what this screen plays. Quietly means under the call, never louder than it: the call always comes first.',
});

// *** HOW QUIET "QUIETLY" IS: 30% BY DEFAULT (audio_bus.js CALL_DUCK_TO argues the number). *** Three stops, so it is
// three presses on one switch: 15% (a quiet or hard-to-hear speaker needs more room), 30%, 50% (the old sentence-cue
// depth; for when the far end must hear the film through this screen's microphone). `advanced`: set once, rarely.
export const CALL_UNDER_KEY = 'callUnderLevel';
export const CALL_UNDER_DEFAULT = Math.round(CALL_DUCK_TO * 100);
export const CALL_UNDER_FIELD = Object.freeze({
  key: CALL_UNDER_KEY,
  label: 'Under the voices, other sound plays at',
  kind: 'choice',
  level: 'advanced',
  default: CALL_UNDER_DEFAULT,
  options: Object.freeze([
    Object.freeze({ value: 15, label: '15%' }),
    Object.freeze({ value: 30, label: '30%' }),
    Object.freeze({ value: 50, label: '50%' }),
  ]),
});

export const CALL_SOUND_FIELDS = Object.freeze([CALL_SOUND_FIELD, CALL_UNDER_FIELD]);

/** The row's "During a call, other sound", or the default for anything that is not one of the choices. */
export function callSoundOf(row) {
  const v = row && row[CALL_SOUND_KEY];
  return CALL_SOUND_FIELD.options.some((o) => o.value === v) ? v : CALL_SOUND_DEFAULT;
}
/** The row's level under the voices, 0..1 (one of the offered stops, or the default). */
export function callUnderOf(row) {
  const n = Number(row && row[CALL_UNDER_KEY]);
  return (CALL_UNDER_FIELD.options.some((o) => o.value === n) ? n : CALL_UNDER_DEFAULT) / 100;
}

export function attachCallSound({
  audio = null,
  read = () => ({}),           // the screen's settings row
  watched = () => false,       // is somebody watching along right now?
} = {}) {
  let mode = CALL_SOUND_DEFAULT;
  let under = CALL_UNDER_DEFAULT / 100;
  let isWatched = false;
  const values = () => { try { return read() || {}; } catch { return {}; } };

  /** Re-read the row and whether anybody is watching along, and tell the bus. Safe to call often. */
  function sync() {
    const row = values();
    mode = callSoundOf(row);
    under = callUnderOf(row);
    try { isWatched = !!watched(); } catch { isWatched = false; }
    try { audio?.setCallMode?.(mode); } catch (err) { console.error('call sound: mode', err); }
    try { audio?.setCallDuck?.(under); } catch (err) { console.error('call sound: level', err); }
    try { audio?.setWatched?.(isWatched); } catch (err) { console.error('call sound: watched', err); }
    return { mode, under, watched: isWatched };
  }

  sync();
  return {
    sync,
    mode: () => mode,
    under: () => under,
    watched: () => isWatched,
    destroy() { /* nothing held: the bus keeps its last mode, which is the screen's own setting */ },
  };
}
