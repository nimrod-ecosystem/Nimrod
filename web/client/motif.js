// motif.js — A SHORT MUSICAL THEME FOR A PERSON OR A CHARACTER (row 2.309, chat's note GV, 2026-11-27; part 1, step 1 of
// answers_gu_gv_gw_20261127.md). Mike: "Your suggestions for the songs will be a good starting point."
//
// A few bars as DATA (notes and how long each is), played in the browser with WebAudio: no AI, nothing downloaded, nothing
// recorded. Everybody has one with nothing set: a theme MADE FROM THEIR NAME (the same name always makes the same theme, so
// the cat's is the cat's on every screen), which a person can replace with their own. Later steps play it as a notifier
// ("Mike is here": room_notify.js's Sound) and string a day's themes into a song of the day. Instrumental only.
//
// *** IT GOES THROUGH THE AUDIO BUS (audio_bus.js), as everything that makes sound must. *** Registered as a sound effect
// (`sfx`, the lowest tier), so speech and a call duck it, and active only while it plays. Quiet hours and off are the
// caller's (the same settings every sound on the screen keeps).
//
// *** THE NUMBERS (Rule 1, argued; each overridable by the theme's own data). ***
//   scale     the major pentatonic (no two notes clash, so any name makes something pleasant: the reason folk tunes and
//             children's songs live there), from middle C up an octave and a half.
//   notes     5 to 8 for a made theme: long enough to be a tune, short enough to be a signal; at most 16 for one somebody
//             writes (a notifier must not become a song).
//   tempo     112 beats a minute (a walking pace: lively without hurry); 60 to 180 accepted.
//   length    at most 6 seconds however it is written, so a theme is never longer than the moment it marks.
//   level     0.18 of full: a little above the site's chime (output_channels.js createSoundChannel, 0.12), since a tune of
//             several soft notes reads quieter than one bright beep.

export const MOTIF_SCALE = Object.freeze([60, 62, 64, 67, 69, 72, 74, 76, 79]);   // MIDI: C4 D4 E4 G4 A4 C5 D5 E5 G5
export const MOTIF_DEFAULTS = Object.freeze({ tempo: 112, level: 0.18, maxNotes: 16, maxSeconds: 6, instrument: 'bell' });
export const INSTRUMENTS = Object.freeze(['bell', 'soft', 'pluck']);

const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

/** A theme as it may be stored: { notes: [[midi, beats], ...], tempo?, instrument? }, checked and bounded. PURE. */
export function normalizeMotif(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const notes = (Array.isArray(r.notes) ? r.notes : []).slice(0, MOTIF_DEFAULTS.maxNotes)
    .map((n) => (Array.isArray(n) ? [Math.round(clampN(n[0], 36, 96, 60)), clampN(n[1], 0.25, 4, 1)] : null)).filter(Boolean);
  if (!notes.length) return null;
  const out = { notes, tempo: Math.round(clampN(r.tempo, 60, 180, MOTIF_DEFAULTS.tempo)),
    instrument: INSTRUMENTS.includes(r.instrument) ? r.instrument : MOTIF_DEFAULTS.instrument };
  // Never longer than maxSeconds: the tail is cut, never sped up (a theme keeps its own pace).
  const beat = 60 / out.tempo;
  let t = 0;
  out.notes = out.notes.filter(([, b]) => { if (t + b * beat > MOTIF_DEFAULTS.maxSeconds + 1e-9) return false; t += b * beat; return true; });
  return out.notes.length ? out : null;
}

/** How long it plays, in seconds. PURE. */
export function motifSeconds(m) {
  const t = normalizeMotif(m);
  return t ? t.notes.reduce((s, [, b]) => s + b, 0) * (60 / t.tempo) : 0;
}

// A small, even hash of a name (FNV-1a), so a name always makes the same theme and close names make different ones.
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The theme made from a name: 5 to 8 notes of the pentatonic scale, stepping more often than leaping (as sung tunes do),
 * ending on the home note or the fifth so it sounds finished, with a longer last note. PURE and the same for the same name.
 */
export function motifFor(name, { instrument = MOTIF_DEFAULTS.instrument } = {}) {
  let h = hash(String(name || '').trim().toLowerCase() || 'nobody');
  // (`>>> 0` after the xor too: `^` gives a SIGNED 32-bit number, and a negative `h % n` made too few notes for some names.)
  const next = (n) => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = (h ^ (h >>> 12)) >>> 0; return h % n; };
  const count = 5 + next(4);
  const beats = [0.5, 0.5, 1, 1, 1, 1.5];
  let at = 2 + next(3);                        // start somewhere in the middle of the scale
  const notes = [];
  for (let i = 0; i < count - 1; i++) {
    notes.push([MOTIF_SCALE[at], beats[next(beats.length)]]);
    const step = next(10) < 7 ? (next(2) ? 1 : -1) : (next(2) ? 2 : -2);   // mostly steps, sometimes a leap
    at = Math.max(0, Math.min(MOTIF_SCALE.length - 1, at + step));
  }
  // It must FIT, ending and all: the ending is what makes it sound finished, so the middle gives way first (fewer notes, at
  // least four, then shorter ones), never the last note.
  const ending = 2;
  const budget = MOTIF_DEFAULTS.maxSeconds / (60 / MOTIF_DEFAULTS.tempo) - ending;
  const sum = () => notes.reduce((s, [, b]) => s + b, 0);
  while (sum() > budget && notes.length > 4) notes.pop();
  for (let i = notes.length - 1; i >= 0 && sum() > budget; i--) notes[i][1] = 0.5;
  notes.push([next(2) ? 60 : 67, ending]);     // home (C) or the fifth (G), held: it sounds like an ending
  return normalizeMotif({ notes, tempo: MOTIF_DEFAULTS.tempo, instrument });
}

/** A person's or a character's theme: their own when they wrote one, else the one made from their name. PURE. */
export function themeOf({ name = '', motif = null } = {}) {
  return normalizeMotif(motif) || motifFor(name);
}

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

let sharedContext = null;
let playSeq = 0;
/**
 * Play a theme. `bus`: the audio bus (registered as an sfx source while it plays; its gain follows the bus). `context`: an
 * AudioContext (one is made, once, when absent). `level`: 0..1 of the theme's own quiet level. Resolves when it has ended.
 * A page with no WebAudio plays nothing and resolves at once.
 */
export function playMotif(motif, { bus = null, context = null, level = 1, owner = null } = {}) {
  const m = normalizeMotif(motif);
  if (!m) return Promise.resolve(false);
  let ac = context;
  try { ac = ac || sharedContext || (sharedContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)()); } catch { ac = null; }
  if (!ac) return Promise.resolve(false);
  const id = `motif:${++playSeq}`;
  const out = ac.createGain();
  const base = MOTIF_DEFAULTS.level * clampN(level, 0, 1, 1);
  out.gain.value = base;
  out.connect(ac.destination);
  try {
    bus?.register?.(id, { tier: 'sfx', ...(owner ? { owner } : {}), onGain: (g) => { try { out.gain.value = base * clampN(g, 0, 1, 1); } catch { /* gone */ } } });
    bus?.setActive?.(id, true);
  } catch (err) { console.error('motif: the audio bus', err); }
  const beat = 60 / m.tempo;
  let t = (ac.currentTime || 0) + 0.02;
  for (const [midi, beats] of m.notes) {
    const len = beats * beat;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = m.instrument === 'soft' ? 'sine' : m.instrument === 'pluck' ? 'triangle' : 'sine';
    osc.frequency.value = midiHz(midi);
    // A bell rings on past its beat a little, a pluck stops short, a soft note swells: all in the envelope.
    const attack = m.instrument === 'soft' ? 0.06 : 0.008;
    const ring = m.instrument === 'pluck' ? Math.min(0.25, len) : m.instrument === 'bell' ? len * 1.3 : len;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.02, ring));
    osc.connect(env); env.connect(out);
    osc.start(t);
    osc.stop(t + Math.max(attack + 0.05, ring) + 0.05);
    t += len;
  }
  const endMs = Math.ceil((t - (ac.currentTime || 0) + 0.3) * 1000);
  return new Promise((resolve) => {
    setTimeout(() => {
      try { bus?.setActive?.(id, false); bus?.unregister?.(id); } catch { /* gone */ }
      try { out.disconnect(); } catch { /* gone */ }
      resolve(true);
    }, endMs);
  });
}
