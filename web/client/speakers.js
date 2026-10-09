// speakers.js — PLAY ON: WHICH SPEAKER SOUND COMES OUT OF. Rows 2.61 and 2.68, notes BI and BJ (2026-10-08).
//
// Mike, 2026-10-08: *"There needs to be an easy way to make it play through whichever speakers you want."* and
// *"Speakers should be under devices. Whatever is set up as default for any screen should work out of the box. You
// could route different things to different Speakers if you want."*
//
// THREE KINDS OF "WHERE", ONE WORD FOR EACH (a "Play on" value is a plain string, so a settings row can hold it):
//   ''               nothing chosen: whatever the row above says, and at the top, the computer's own default
//                    speaker. THAT IS THE OUT-OF-THE-BOX CASE AND NEEDS NOTHING SET UP.
//   'here'           this screen, through the computer's default speaker
//   'out:<name>'     this screen, through one attached speaker, by the name the computer gives it
//   'spotify:<name>' a Spotify speaker, phone or computer, by its Spotify name ('spotify:' = whichever is on)
// By NAME, not by the browser's device id: the id is salted per site and changes when the browser's data is
// cleared, and a name is what a person sees, says ("play on the kitchen speaker") and recognises in a list.
//
// WHAT CAN BE SENT TO A CHOSEN SPEAKER, MEASURED 2026-10-08 in Chrome (dev/spotify_embed_frame_test.html):
//   * sound our own page plays: yes. HTMLMediaElement.setSinkId and AudioContext.setSinkId are both there, so music
//     files (music_local.js) and Amplify (amplify.js setSink) can each go to a speaker of their own.
//   * sound inside SPOTIFY'S or YOUTUBE'S OWN FRAME: NO. Their frames are another site's; the page cannot reach an
//     element inside to call setSinkId on (SecurityError), Chrome does not know a "speaker-selection" permission to
//     hand a frame, and navigator.mediaDevices.selectAudioOutput does not exist in Chrome. Even where it did, only a
//     script inside the frame could use it, and neither player offers one. So the embed and YouTube play through
//     the computer's default speaker; to move them, change the computer's default (on a Pi: the sound settings), or
//     pick a SPOTIFY speaker, which Spotify itself plays on.
//   * Speaker NAMES need the browser's microphone permission (enumerateDevices hides labels until a page has it).
//     A screen that listens for speech has it; one that doesn't lists "Speaker 1", "Speaker 2".

export const PLAY_ON_HERE = 'here';
export const OUT_PREFIX = 'out:';
export const SPOTIFY_PREFIX = 'spotify:';

// THE ROWS ON DEVICES -> SPEAKERS (the screen's own, kiosk.js SCREEN_FIELDS). One per kind of sound that can
// actually be sent somewhere today. Music is the one: its files go to an attached speaker, and its Spotify
// favourites to a Spotify speaker. Videos are not a row, because YouTube's frame cannot be routed (above); a row
// that changes nothing is a stop on the switch walk for nothing. A kind is added here when its player can follow it.
export const SPEAKER_KINDS = Object.freeze([
  { kind: 'music', key: 'speakerMusic', label: 'Music plays on' },
]);
export const speakerKey = (kind) => SPEAKER_KINDS.find((k) => k.kind === kind)?.key || null;

/** A Play on value as `{ kind: 'default'|'here'|'out'|'spotify', name }`. PURE. */
export function parsePlayOn(v) {
  const s = String(v == null ? '' : v);
  if (!s) return { kind: 'default', name: '' };
  if (s === PLAY_ON_HERE) return { kind: 'here', name: '' };
  if (s.startsWith(OUT_PREFIX)) return { kind: 'out', name: s.slice(OUT_PREFIX.length) };
  if (s.startsWith(SPOTIFY_PREFIX)) return { kind: 'spotify', name: s.slice(SPOTIFY_PREFIX.length) };
  return { kind: 'default', name: '' };
}

/** The words for a Play on value, for a button or a row. PURE. */
export function playOnWords(v, { inherit = 'This screen' } = {}) {
  const p = parsePlayOn(v);
  if (p.kind === 'default') return inherit;
  if (p.kind === 'here') return 'This screen';
  if (p.kind === 'out') return `This screen, through ${p.name || 'a speaker'}`;
  return p.name ? `Spotify: ${p.name}` : 'Spotify: whichever is on';
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---- this computer's speakers -------------------------------------------------------------------------------
let outputs = [];          // [{ deviceId, label }], the last list read; sync for the settings menu (fieldsFor's rule)
let listening = false;
const watchers = new Set();

/** Can this browser send our own page's sound to a chosen speaker? */
export function canChooseSpeaker() {
  try { return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype; } catch { return false; }
}

/** The computer's speakers as the browser lists them, the 'default' and 'communications' stand-ins left out. */
export async function refreshOutputs({ md = (typeof navigator !== 'undefined' ? navigator.mediaDevices : null) } = {}) {
  if (!md || typeof md.enumerateDevices !== 'function') { outputs = []; return outputs; }
  let list = [];
  try { list = await md.enumerateDevices(); } catch { list = []; }
  let n = 0;
  const seen = new Set();
  const next = [];
  for (const d of list || []) {
    if (!d || d.kind !== 'audiooutput' || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    n += 1;
    let label = String(d.label || '').trim() || `Speaker ${n}`;
    while (seen.has(norm(label))) label = `${label} (${n})`;
    seen.add(norm(label));
    next.push({ deviceId: String(d.deviceId || ''), label });
  }
  outputs = next;
  if (!listening && md.addEventListener) {
    listening = true;
    try { md.addEventListener('devicechange', () => { refreshOutputs({ md }); }); } catch { /* listed once */ }
  }
  for (const fn of watchers) { try { fn(outputs); } catch (err) { console.error('speakers', err); } }
  return outputs;
}
/** The last list read (synchronous). */
export const knownOutputs = () => outputs.map((o) => ({ ...o }));
export function watchOutputs(fn) { watchers.add(fn); return () => watchers.delete(fn); }
/** For the suites: put a list in place without a browser. */
export function setOutputsForTest(list) { outputs = (list || []).map((o) => ({ deviceId: String(o.deviceId), label: String(o.label) })); }

/** The device id for a speaker's name: exact, then the first that contains it. '' when none (the default). */
export function sinkIdFor(name, list = outputs) {
  const want = norm(name);
  if (!want) return '';
  const hit = list.find((o) => norm(o.label) === want) || list.find((o) => norm(o.label).includes(want));
  return hit ? hit.deviceId : '';
}

// ---- Spotify's speakers, as last found ----------------------------------------------------------------------
// "Find speakers" in a Music panel asks Spotify; the names are kept on THIS DEVICE so the Speakers rows and the
// Play on chooser can list them without asking Spotify every time a menu opens. Names only, no ids or tokens.
const SPOTIFY_NAMES_KEY = 'nimrod.speakers.spotify';
function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
export function knownSpotifySpeakers() {
  try { const v = JSON.parse(store()?.getItem(SPOTIFY_NAMES_KEY) || '[]'); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; }
  catch { return []; }
}
export function rememberSpotifySpeakers(names) {
  const clean = [...new Set((names || []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 20);
  try { store()?.setItem(SPOTIFY_NAMES_KEY, JSON.stringify(clean)); } catch { /* this device only, and optional */ }
  return clean;
}

/**
 * The choices for a Play on row or the chooser: `[{ value, label }]`. `inherit` is the first choice's words (a
 * panel's row: "As Devices -> Speakers says"; the screen's row: the default speaker). Attached speakers only when
 * the browser can send sound to one and there is more than one to choose between.
 */
export function playOnChoices({ inherit = null, outputsList = outputs, spotify = knownSpotifySpeakers(),
  canRoute = canChooseSpeaker(), spotifyOn = true } = {}) {
  const out = [];
  if (inherit) out.push({ value: '', label: inherit });
  out.push({ value: PLAY_ON_HERE, label: 'This screen' });
  if (canRoute && outputsList.length > 1) {
    for (const o of outputsList) out.push({ value: `${OUT_PREFIX}${o.label}`, label: `This screen, through ${o.label}` });
  }
  if (spotifyOn) {
    out.push({ value: SPOTIFY_PREFIX, label: 'Spotify: whichever is on' });
    for (const n of spotify) out.push({ value: `${SPOTIFY_PREFIX}${n}`, label: `Spotify: ${n}` });
  }
  return out;
}

/** The screen's Speakers rows, for kiosk.js SCREEN_FIELDS, with their choices as known right now. */
export function speakerFields() {
  return SPEAKER_KINDS.map((k) => ({
    key: k.key, label: k.label, kind: 'choice', level: 'standard', default: '',
    // Spotify choices only once a Music panel on this device has found Spotify speakers: a household with no Spotify
    // app is not offered a choice that cannot play.
    options: playOnChoices({ inherit: 'This screen’s own speaker (whatever the computer uses)',
      spotifyOn: knownSpotifySpeakers().length > 0 }).filter((o) => o.value !== PLAY_ON_HERE),
    note: 'Nothing to set up: on its first choice, sound goes wherever this computer already sends it. Spotify and '
      + 'YouTube’s own players always use that speaker; music files can go to another. Spotify speakers appear '
      + 'here after “Find speakers” in a Music panel.',
  }));
}
