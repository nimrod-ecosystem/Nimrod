// aac_clips.js — WHERE A BOARD WORD'S RECORDED CLIP LIVES. The one rule, in one place.
//
// It lived in talk.js (the /talk.html page), which plays the clip first and the device's voice second.
// The AAC board MODULE now needs it too (call loadouts, 2026-10-09): a card with a recorded clip sends
// that clip INTO a live call's audio (call_mix.js), and talk.js imports modules/board.js, so the board
// cannot import talk.js back. talk.js re-exports these, so nothing that used them changes.
//
// The rule is cici_voice.js's (the bedside build), so one set of recordings serves both: lower case,
// every run of anything else becomes one underscore, add `.wav`. "Thank you" -> thank_you.wav.
// The clips are Piper (en_US-libritts-high, speaker 552) - see aac/audio/README.md.

// Where the seventeen shipped clips are, relative to a page in web/client (talk.html, kiosk.html).
// The board's and talk.html's default; each can point somewhere else (talk.js `clipBase`, the board's
// `callClipBase`), so this is a starting point, not a constant anybody is held to.
export const DEFAULT_CLIP_BASE = './aac/audio';

/** A word to the file name that says it, without `.wav`. Pure. */
export function clipSlug(text) {
  return String(text == null ? '' : text).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** The URL a word's recording would live at, or null when clips are off (an empty base). Pure. */
export function clipUrl(text, base) {
  const b = String(base == null ? '' : base).replace(/\/+$/, '');
  const s = clipSlug(text);
  return b && s ? `${b}/${s}.wav` : null;
}
