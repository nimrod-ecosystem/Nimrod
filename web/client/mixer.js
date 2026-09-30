// mixer.js — THE MIXER'S SETTINGS, and the wiring that carries them to the bus and the effects.
//
// Row 2.35, Mike 2026-09-30: *"I think the audio bus needs busses like a mixer. Because you probably
// wouldn't want incoming calls dropping too low. Maybe have minimums for certain channels. Reverbs to
// match your visual setting could be cool. Maybe just leave a hookup for people to use plugins?"*
//
// THREE FILES, ONE JOB EACH:
//   audio_bus.js     the arithmetic: a fader and a minimum per channel, under the master, on top of
//                    the arbiter's ducks and pauses. Every source's level comes from there.
//   mixer_fx.js      the effects: a compressor, a scene-matched reverb and a plugin slot per channel,
//                    for the sound Nimrod plays through Web Audio.
//   this file        what a settings menu shows (MIXER_FIELDS), and attachMixer, which reads the
//                    screen's settings row and pushes it into the other two.
// The master itself stays in master_volume.js (masterVolume / masterStep / masterFloor), because the
// spoken "louder"/"quieter" drive it and its keys were already saved on real screens.
//
// *** KEPT WITH THE SCREEN, like the master and for the same reason: *** the two bedside units get
// physically swapped, and a mix saved in one browser would reset on every swap.
//
// Values are PERCENT integers in the settings row (like masterVolume), 0..1 on the bus.

import { CHANNELS } from './audio_bus.js';
import { REVERB_CHOICES } from './mixer_fx.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const faderKey = (ch) => `fader${cap(String(ch))}`;
export const floorKey = (ch) => `floor${cap(String(ch))}`;
export const compressKey = (ch) => `compress${cap(String(ch))}`;
export const reverbKey = (ch) => `reverb${cap(String(ch))}`;

// *** THE DEFAULTS — BEST GUESSES, ON MIKE'S LIST (MIKE_LIST_20260930 item 2). ***
export const MIXER_DEFAULTS = Object.freeze({
  // Full, so a screen nobody has touched sounds exactly as it did before the mixer existed.
  fader: 100,
  // Calls and the AAC voice: 60%. The two sounds on the screen that are a PERSON talking - "you
  // probably wouldn't want incoming calls dropping too low". 60 rather than 100 so a caregiver who
  // turns the room down at night still gets a quieter call, just never a buried one; rather than 30
  // because 30% of a small Pi speaker across a room is the level that already got the master's
  // floor argued up. Everything else: no minimum (the master's own 10% floor still holds).
  floors: Object.freeze(Object.fromEntries(CHANNELS.map((c) => [c.id, Math.round(c.floor * 100)]))),
  // THE COMPRESSOR, ON FOR THE AAC VOICE ONLY. For: it evens a soft word and a loud one so every
  // word lands, and its makeup gain LIFTS the quiet end (measured, dev/mixer_test.html) - the
  // property a voice that must never be buried wants. Against: it changes how a chosen voice
  // sounds, and on the kiosk today (the browser's own voice) it reaches nothing at all, so ON is a
  // promise it cannot yet keep there. Kept ON because where it does reach (the recorded clips) that
  // is the channel it helps most, and off-by-default would mean nobody ever hears the difference.
  // Off for videos/music (already mastered) and game sounds (their dynamics are the design).
  compress: Object.freeze({ aac: true, media: false, sfx: false }),
  // No reverb anywhere until somebody chooses it: a reverb nobody asked for on a voice is a voice
  // that got harder to understand.
  reverb: 'none',
});

// Only channels that effects can actually reach get effects rows (see mixer_fx.js). A row that does
// nothing looks like a broken row.
const FX_CHANNELS = CHANNELS.filter((c) => c.effects);

const FLOOR_OPTIONS = [
  { value: 0, label: 'no minimum' },
  { value: 20, label: '20%' },
  { value: 40, label: '40%' },
  { value: 60, label: '60%' },
  { value: 80, label: '80%' },
];
const REVERB_LABELS = {
  none: 'none', room: 'a room', hall: 'a hall', outdoor: 'outdoors', scene: 'match the scene',
};

// *** THE SETTINGS, at the SCREEN level. *** Every one reachable with one switch: bounded numbers
// and short choices. Faders are `standard` (the thing a caregiver adjusts); minimums and effects are
// `advanced` (set once). Nothing here is `essential`: on a patient screen the one sound control is
// the master (master_volume.js).
export const MIXER_FIELDS = [
  ...CHANNELS.map((c) => ({
    key: faderKey(c.id), label: `${c.label}: volume`, kind: 'number', default: MIXER_DEFAULTS.fader,
    min: 0, max: 100, step: 10, unit: '%', level: 'standard',
  })),
  ...CHANNELS.map((c) => ({
    key: floorKey(c.id), label: `${c.label}: never quieter than`, kind: 'choice',
    default: MIXER_DEFAULTS.floors[c.id], level: 'advanced', options: FLOOR_OPTIONS,
  })),
  ...FX_CHANNELS.map((c) => ({
    key: compressKey(c.id), label: `${c.label}: even out loud and quiet`, kind: 'toggle',
    default: !!MIXER_DEFAULTS.compress[c.id], level: 'advanced',
  })),
  ...FX_CHANNELS.map((c) => ({
    key: reverbKey(c.id), label: `${c.label}: sounds like`, kind: 'choice',
    default: MIXER_DEFAULTS.reverb, level: 'advanced',
    options: REVERB_CHOICES.map((v) => ({ value: v, label: REVERB_LABELS[v] || v })),
  })),
];

const pct = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Read the screen's settings row and push it into the bus (faders, floors) and the effects
 * (compressor, reverb). A broken fader is FULL; a broken floor is that channel's DEFAULT floor;
 * a broken effect switch is its default. Nothing that throws - the read, the bus, the effects - can
 * stop the rest from being applied.
 */
export function attachMixer({ audio = null, fx = null, read = () => ({}), write = null } = {}) {
  function values() {
    try { return read() || {}; } catch { return {}; }
  }
  const call = (what, fn) => { try { fn(); } catch (err) { console.error(`mixer: ${what}`, err); } };

  function sync() {
    const v = values();
    for (const c of CHANNELS) {
      const f = pct(v[faderKey(c.id)]);
      const fader = Number.isFinite(f) && f >= 0 && f <= 100 ? f : MIXER_DEFAULTS.fader;
      const fl = pct(v[floorKey(c.id)]);
      const floor = Number.isFinite(fl) && fl >= 0 && fl <= 100 ? fl : MIXER_DEFAULTS.floors[c.id];
      call('fader', () => audio?.setFader?.(c.id, fader / 100));
      call('floor', () => audio?.setFloor?.(c.id, floor / 100));
    }
    for (const c of FX_CHANNELS) {
      const raw = v[compressKey(c.id)];
      const on = typeof raw === 'boolean' ? raw : !!MIXER_DEFAULTS.compress[c.id];
      const rv = REVERB_CHOICES.includes(v[reverbKey(c.id)]) ? v[reverbKey(c.id)] : MIXER_DEFAULTS.reverb;
      call('compressor', () => fx?.setCompressor?.(c.id, on));
      call('reverb', () => fx?.setReverb?.(c.id, rv));
    }
  }

  sync();

  return {
    sync,
    /** The screen's scene changed: channels set to "match the scene" follow it. */
    setScene(id) { call('scene', () => fx?.setScene?.(id)); },
    /** Save one channel's fader (percent) and apply it. For a mixer screen, when there is one. */
    setFader(ch, percent) {
      const n = pct(percent);
      const next = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : MIXER_DEFAULTS.fader;
      call('fader', () => audio?.setFader?.(ch, next / 100));
      if (typeof write === 'function') call('save', () => write({ [faderKey(ch)]: next }));
      return next;
    },
    state: () => ({ mix: (() => { try { return audio?.mix?.() ?? null; } catch { return null; } })(),
                    fx: (() => { try { return fx?.state?.() ?? null; } catch { return null; } })() }),
    destroy() { /* nothing subscribed; the host owns the bus and the effects */ },
  };
}
