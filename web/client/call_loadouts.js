// call_loadouts.js — WHAT A SCREEN SHOWS WHEN IT ANSWERS A CALL: ONE CALL DASHBOARD, SEVERAL LOADOUTS
// (2026-10-09).
//
// Mike, 2026-10-09: "I think it's separate dashboards. We could have some default call dashboards for any mix
// of video/audio/AAC calls. The subtitles would also be a good option for calls. I guess it would just want to
// be one call dashboard with different loadouts? So the settings you could choose audio/video/AAC and the
// transport bar has standard buttons for mic/cam on/off."
//
// So: ONE call view (kiosk.js `openCallView`, the screen's call over its panels), and a SCREEN SETTING, "Calls
// open as", that picks its loadout:
//
//     video          the call fills the view: their video, this room's camera sent        (today's call view)
//     audio          the call fills the view: their name card, this room's camera NOT opened
//     video_board    the call and an AAC board, side by side (or one above the other on a tall screen)
//     audio_board    the same, with their name card and no camera
//
// and a second, "Captions on calls": off / this screen's recogniser / and the other computers its voice
// settings name (call_captions.js). Captions are their own choice, not a fifth and sixth loadout, because they
// go with any of the four.
//
// *** WHY A LOADOUT OF THE CALL VIEW AND NOT A READY-MADE DASHBOARD THE SCREEN SWAPS TO. *** Argued:
//   FOR a real dashboard (dashboards.js's records, made once, swapped to on answer, swapped back after): it is
//   exactly Mike's word, and a person could open it in the editor and move anything.
//   AGAINST, and it wins for now: a swap tears down whatever was showing (a video loses its place, a game its
//   round) and puts it all back afterwards; making the dashboard the first time is several writes to the server
//   in the seconds after somebody pressed Answer, on a screen whose call must not wait for anything; and
//   kiosk.js's own call view header already argued the overlay: it chooses no panel, survives a dashboard swap,
//   and "everything returns as it was" is removing it. So the loadouts are DATA in the dashboard records' own
//   shape (`modules` + `layout` with layout.js presets), laid out by layout.js's own grid CSS, and the call view
//   draws them. What a person can change today: the loadout, the captions, and the board in it, which follows
//   the screen's "every AAC board panel" settings (its own row is `call-board`). Moving pieces around inside the
//   call view in the editor is NOT built; if it is wanted, these records are what a made dashboard would be
//   made from (on Mike's list).
//
// A SCREEN WITH A CALL PANEL ON IT is unchanged: the panel rings and the call is in the panel, beside whatever
// else that dashboard has (a Board panel next to it already sends words into the call, ee74d82). A loadout is
// what the screen does when there is no panel to hold the call.

import { PRESETS } from './layout.js';

export const CALL_OPENS_KEY = 'callOpensAs';
export const CALL_CAPTIONS_KEY = 'callCaptions';

// The four, as data in the dashboard records' shape. `camera`: this room's camera is opened and sent.
// `theirVideo`: their picture is shown (an audio loadout shows their name card; their video can still be shown
// from the bar's "Show their video"). `board`: an AAC board beside the call.
export const CALL_LOADOUTS = Object.freeze({
  video: Object.freeze({
    key: 'video', label: 'Video', camera: true, theirVideo: true, board: false,
    modules: Object.freeze([{ ref: 'call', type: 'call' }]),
    layout: Object.freeze({ preset: 'full', slots: Object.freeze(['call']) }),
  }),
  audio: Object.freeze({
    key: 'audio', label: 'Audio only', camera: false, theirVideo: false, board: false,
    modules: Object.freeze([{ ref: 'call', type: 'call' }]),
    layout: Object.freeze({ preset: 'full', slots: Object.freeze(['call']) }),
  }),
  video_board: Object.freeze({
    key: 'video_board', label: 'Video + talk board', camera: true, theirVideo: true, board: true,
    modules: Object.freeze([{ ref: 'call', type: 'call' }, { ref: 'board', type: 'board' }]),
    layout: Object.freeze({ preset: 'side', slots: Object.freeze(['board', 'call']) }),
  }),
  audio_board: Object.freeze({
    key: 'audio_board', label: 'Audio + talk board', camera: false, theirVideo: false, board: true,
    modules: Object.freeze([{ ref: 'call', type: 'call' }, { ref: 'board', type: 'board' }]),
    layout: Object.freeze({ preset: 'side', slots: Object.freeze(['board', 'call']) }),
  }),
});
export const CALL_LOADOUT_ORDER = Object.freeze(['video', 'audio', 'video_board', 'audio_board']);

// *** THE DEFAULT IS 'video', WHICH IS WHAT A CALL VIEW DID BEFORE THIS. *** Argued:
//   FOR video: no screen changes under anybody on the day this ships; a caller who rings with video is seen,
//   and sees the room, as before.
//   FOR a board loadout: the person this product was built for talks with a board, and a board out of reach
//   during a call is the gap ee74d82 named. AGAINST as the DEFAULT: most people who answer a call do not use a
//   board, and half the view given to one is half the view taken from the person calling. One row away.
//   FOR audio: a camera that opens because somebody pressed Answer is a camera somebody did not choose. AGAINST:
//   the caller chose a video call, and the room's picture is most of what a family call is for.
export const CALL_OPENS_DEFAULT = 'video';

/** The screen-level setting. `standard`: set once by whoever sets the screen up, beside "Calls when there's no Call panel". */
export const CALL_OPENS_FIELD = Object.freeze({
  key: CALL_OPENS_KEY,
  label: 'Calls open as',
  kind: 'choice',
  level: 'standard',
  default: CALL_OPENS_DEFAULT,
  options: CALL_LOADOUT_ORDER.map((k) => ({ value: k, label: CALL_LOADOUTS[k].label })),
  note: 'What this screen shows when it answers a call with no Call panel on it. "Audio only" never opens '
      + 'the camera. The talk board sends each word chosen to the person on the call. The bar has '
      + 'mute, camera and hang-up buttons during every call.',
});

// CAPTIONS OF THE PERSON ON THE CALL (call_captions.js). 'off' by default, argued: captions need a recogniser
// running on this computer (web/speech_service), which most screens do not have yet, and a caption box saying
// "nothing is listening" on every call is noise. The case for on: somebody hard of hearing - one row away.
//   here  only this screen's own recogniser: their voice is turned into words on THIS computer and nowhere else.
//   any   also the other computers this screen's voice settings name (a desktop with a faster recogniser). The
//         caller's voice then goes there too - which is why it is its own choice, not what 'on' means.
export const CALL_CAPTION_MODES = Object.freeze(['off', 'here', 'any']);
export const CALL_CAPTIONS_DEFAULT = 'off';
export const CALL_CAPTIONS_FIELD = Object.freeze({
  key: CALL_CAPTIONS_KEY,
  label: 'Captions on calls',
  kind: 'choice',
  level: 'standard',
  default: CALL_CAPTIONS_DEFAULT,
  options: [
    { value: 'off', label: 'Off' },
    { value: 'here', label: 'On — words worked out on this computer only' },
    { value: 'any', label: 'On — and the other computers in this screen’s voice settings' },
  ],
  note: 'Writes what the person on the call says, under the call. It needs the speech program running on '
      + 'this computer. Nothing is kept: the words go when the call ends.',
});

/** The loadout a screen's row asks for (anything unknown is the default). Pure. */
export function callLoadoutOf(row) {
  const k = row && typeof row[CALL_OPENS_KEY] === 'string' ? row[CALL_OPENS_KEY] : '';
  return CALL_LOADOUTS[k] || CALL_LOADOUTS[CALL_OPENS_DEFAULT];
}
/** 'off' | 'here' | 'any' from a screen's row. Pure. */
export function callCaptionsOf(row) {
  const v = row && row[CALL_CAPTIONS_KEY];
  return CALL_CAPTION_MODES.includes(v) ? v : CALL_CAPTIONS_DEFAULT;
}

// *** WHICH WAY THE BOARD SITS: BY THE SCREEN'S SHAPE. *** Beside the call on a screen wider than it is tall
// (layout.js 'side'), under it on a tall one ('stack' - a phone held upright, a portrait tablet). Not a setting,
// argued: the half the board gets is the same either way, and "beside on a tall phone" would make both halves
// too narrow for cards or a face. A screen exactly square counts as wide.
// *** AND THE CALL TAKES THE HALF THE MIRROR IS IN. *** The room's own picture-in-picture (the mirror, top right
// by default) stays on top of the call view - it IS the self-view (call.js header). So side by side the board is
// LEFT and the call RIGHT, and stacked the call is on TOP: the mirror sits in the call's corner, as a self-view
// does in any call app, and never over a card. A mirror somebody moved to a left or bottom corner can cover the
// board's corner; it can be moved back, or hidden, from the menu.
export function boardPreset({ width = 0, height = 0 } = {}) {
  return Number(height) > Number(width) ? 'stack' : 'side';
}

/**
 * Everything the call view needs to open a call, from the screen's row and its size. Pure.
 *   { key, label, camera, theirVideo, board, captions, preset, slots: ['call', 'board'?], grid }
 * `grid` is layout.js's own CSS for the preset, so the call view and a dashboard cannot draw it differently.
 */
export function callViewPlan(row, { width = 0, height = 0, boardAvailable = true } = {}) {
  const lo = callLoadoutOf(row);
  const board = !!(lo.board && boardAvailable);
  const preset = board ? boardPreset({ width, height }) : 'full';
  const p = PRESETS.find((x) => x.id === preset) || PRESETS[0];
  return {
    key: lo.key, label: lo.label, camera: lo.camera, theirVideo: lo.theirVideo, board,
    captions: callCaptionsOf(row),
    preset, slots: !board ? ['call'] : preset === 'side' ? ['board', 'call'] : ['call', 'board'],
    grid: { cols: p.cols, rows: p.rows },
  };
}
