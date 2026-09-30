// room_notify.js — WHAT A ROOM DOES WHEN SOMETHING HAPPENS: rules of event → object → does.
//
// Claude Design, room-add-ons §6 (and its sheet): *"Pick an event, pick an object, pick what it does.
// The on-screen cue always comes too; objects only add to it."*
//
//   { on: 'wake' | 'message' | 'call' | 'visitor' | 'timer' | 'custom', name?,   // name: custom only
//     object: 'lamp' | 'cat' | <a furniture part> | <an item id> | null,          // null: sound only
//     does: 'light' | 'fire' | 'pulse' | 'perk' | 'open' | 'sound',
//     sound: null | 'chime-soft' | 'chime-bright' | 'knock' }                      // an add-on to any rule
//
// This file is the RULES — what is valid, what an object can do, what the defaults are, how one
// press steps a rule — and nothing else. `room_scene.js` plays them (`reactionsFor`, `notify`,
// `testRule`); `room_notify_editor.js` is the editor; `modules/room.js` stores them.
//
// ---------------------------------------------------------------------------------------
// WHERE THE RULES LIVE: ON THE ROOM, AS PLACED ON A SCREEN (the room module's own state row,
// key `notify`). Argued both ways, because the brief asked:
//   * PER PROFILE (one list for the person, whatever room they are in) is simpler to explain and
//     follows the person — "I never want the lamp to flash" said once.
//   * PER ROOM is what the rules are ABOUT: they name objects, and a room without a fireplace
//     cannot light one. A person with a bedroom and a living room may well want the call to light
//     the fire in one and the lamp in the other.
//   Recommendation, and what is built: per room. The FAMILY names ('lamp', 'cat', 'speaker') are
//   what the editor offers, not item ids, so a list survives changing to another room that has a
//   lamp too. A rule whose object the room lacks is KEPT and says "(not in this room)" in the
//   editor — never silently dropped, because switching rooms and back must not lose it.
//   No list stored = Design's defaults. An EMPTY list is somebody who removed every rule, which is
//   a choice, and it is kept as one.
// ---------------------------------------------------------------------------------------
//
// *** THE CUE ALWAYS COMES TOO. *** Nothing here is ever the only sign that something happened:
// `modules/room.js` shows the event in words (`CUES`) beside every reaction unless the publisher
// says it drew its own (`cueShown: true` — the listening cue, a call screen).
//
// *** NO DEFAULT MAKES A SOUND. *** Design: "The 'I heard you' tone is OFF by default. The visual cue
// carries it." Design's sheet also draws "message → speaker pulses + soft chime"; that chime is NOT a
// default here, argued: a room that chimes for every message chimes at 3 a.m. at somebody's
// bedside, and the pulse plus the cue already say it. One press on the rule's Sound adds it.

import { DEFAULT_NOTIFY_RULES } from './room_scene.js';
import { FURNITURE } from './room_parts.js';

export const NOTIFY_EVENTS_LIST = Object.freeze([
  { value: 'wake', label: 'Wake phrase heard' },
  { value: 'message', label: 'A message arrives' },
  { value: 'call', label: 'A call comes in' },
  { value: 'visitor', label: 'A visitor arrives' },
  { value: 'timer', label: 'A timer ends' },
  { value: 'custom', label: 'Something else' },
]);
export const REACTIONS = Object.freeze([
  { value: 'light', label: 'Lights up' },
  { value: 'fire', label: 'Fire lights' },
  { value: 'pulse', label: 'Pulses' },
  { value: 'perk', label: 'Ears perk up' },
  { value: 'open', label: 'Opens a crack' },
  { value: 'sound', label: 'A sound only' },
]);
export const SOUNDS = Object.freeze([
  { value: null, label: 'No sound' },
  { value: 'chime-soft', label: 'Soft chime' },
  { value: 'chime-bright', label: 'Bright chime' },
  { value: 'knock', label: 'Knock' },
]);
// The words of the on-screen cue for each event (the room shows them unless the publisher drew its own).
export const CUES = Object.freeze({
  wake: 'I heard you.',
  message: 'A message arrived.',
  call: 'A call is coming in.',
  visitor: 'Someone is at the door.',
  timer: 'Time is up.',
});
export const DEFAULT_RULES = DEFAULT_NOTIFY_RULES;
export const NAME_MAX = 40;
const DEFAULT_CUSTOM_NAME = 'My event';

const EVENT_SET = new Set(NOTIFY_EVENTS_LIST.map((e) => e.value));
const DOES_SET = new Set(REACTIONS.map((r) => r.value));
const SOUND_SET = new Set(SOUNDS.map((s) => s.value).filter(Boolean));
const LAMPS = ['tableLamp', 'floorLamp'];

/** The name a person sees for an object value. */
export function objectLabel(object) {
  if (object == null) return 'No object';
  if (object === 'lamp') return 'Lamp';
  if (object === 'cat') return 'Nimrod';
  return FURNITURE[object]?.label || String(object);
}
const known = (object) => object === 'lamp' || object === 'cat' || !!FURNITURE[object];

/** What an object can do. Everything can pulse and sound; the rest is what the thing IS. */
export function doesFor(object) {
  if (object == null) return ['sound'];
  if (object === 'lamp' || LAMPS.includes(object)) return ['light', 'pulse', 'sound'];
  if (object === 'fireplace') return ['fire', 'light', 'pulse', 'sound'];
  if (object === 'cat') return ['perk', 'pulse', 'sound'];
  if (object === 'door') return ['open', 'pulse', 'sound'];
  return ['pulse', 'sound'];
}

/** A rule, validated: null when it cannot be one. Never throws. */
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!EVENT_SET.has(raw.on) || !DOES_SET.has(raw.does)) return null;
  const out = { on: raw.on, object: null, does: raw.does, sound: null };
  if (raw.on === 'custom') {
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, NAME_MAX) : '';
    if (!name) return null;
    out.name = name;
  }
  const object = typeof raw.object === 'string' && raw.object.trim() ? raw.object.trim() : null;
  if (!object && raw.does !== 'sound') return null;
  out.object = object;
  // A reaction the object cannot do becomes the first it can (a lamp has no ears). An object this
  // file does not know (an item id) keeps what it was given: the scene decides.
  if (object && known(object) && !doesFor(object).includes(out.does)) out.does = doesFor(object)[0];
  out.sound = SOUND_SET.has(raw.sound) ? raw.sound : null;
  if (out.does === 'sound' && !out.sound) out.sound = SOUNDS[1].value;
  return out;
}

/** The room's stored rules: { rules, custom }. Nothing stored = Design's defaults (custom false). */
export function readRules(row = {}) {
  const raw = row?.notify;
  if (!Array.isArray(raw)) return { rules: DEFAULT_RULES.map((r) => ({ ...r })), custom: false };
  return { rules: raw.map(normalizeRule).filter(Boolean), custom: true };
}

/** The objects a room can react with, as editor choices: families and parts, not item ids. */
export function objectsIn(recipe = {}) {
  const out = [];
  const seen = new Set();
  const add = (value) => { if (!seen.has(value)) { seen.add(value); out.push({ value, label: objectLabel(value) }); } };
  for (const it of Array.isArray(recipe?.items) ? recipe.items : []) {
    if (!it) continue;
    if (it.kind === 'cat') add('cat');
    else if (it.kind === 'furniture' && FURNITURE[it.part]) add(LAMPS.includes(it.part) ? 'lamp' : it.part);
  }
  return out;
}

/** "Wake phrase heard → Lamp → Lights up" */
export function describeRule(rule) {
  const ev = rule?.on === 'custom' ? `“${rule.name}”` : (NOTIFY_EVENTS_LIST.find((e) => e.value === rule?.on)?.label || rule?.on);
  const does = REACTIONS.find((r) => r.value === rule?.does)?.label || rule?.does;
  const snd = rule?.sound && rule.does !== 'sound' ? ` + ${SOUNDS.find((s) => s.value === rule.sound)?.label.toLowerCase()}` : '';
  return rule?.does === 'sound'
    ? `${ev} → ${SOUNDS.find((s) => s.value === rule.sound)?.label || 'a sound'}`
    : `${ev} → ${objectLabel(rule?.object)} → ${does}${snd}`;
}

/** The on-screen words for a rule's (or an event's) cue. */
export function cueFor(ruleOrEvent) {
  const r = typeof ruleOrEvent === 'string' ? { on: ruleOrEvent } : (ruleOrEvent || {});
  if (r.on === 'custom') return r.name || DEFAULT_CUSTOM_NAME;
  return CUES[r.on] || String(r.on || '');
}

const nextOf = (list, v) => list[(Math.max(-1, list.indexOf(v)) + 1) % list.length];

/**
 * ONE PRESS, ONE STEP: the rule with `field` moved to its next value, still valid. The settings
 * menu's one-button contract, so a single switch can edit a rule without a keyboard (except a
 * custom event's NAME, which is words, and says it needs a keyboard).
 *   objects  the room's `objectsIn()`: the object steps through them, then "no object" (sound only)
 */
export function stepRule(rule, field, objects = []) {
  const r = { ...rule };
  if (field === 'on') {
    r.on = nextOf(NOTIFY_EVENTS_LIST.map((e) => e.value), r.on);
    if (r.on === 'custom') r.name = r.name || DEFAULT_CUSTOM_NAME;
    else delete r.name;
  } else if (field === 'object') {
    const values = [...objects.map((o) => o.value), null];
    if (r.object != null && !values.includes(r.object)) values.unshift(r.object);
    r.object = nextOf(values, r.object ?? null);
    const can = doesFor(r.object);
    if (!can.includes(r.does)) r.does = can[0];
    if (r.does === 'sound' && !r.sound) r.sound = SOUNDS[1].value;
  } else if (field === 'does') {
    const was = r.does;
    r.does = nextOf(doesFor(r.object), r.does);
    if (r.does === 'sound' && !r.sound) r.sound = SOUNDS[1].value;
    // Leaving "a sound only" drops the sound it needed: a sound on top of a reaction is chosen on
    // the Sound button, never picked up by accident while stepping past.
    if (was === 'sound' && r.does !== 'sound') r.sound = null;
  } else if (field === 'sound') {
    const values = SOUNDS.map((s) => s.value).filter((v) => r.does !== 'sound' || v);
    r.sound = nextOf(values, r.sound ?? null);
  }
  return normalizeRule(r) || rule;
}

/** A new rule for "+ Add a rule": a wake rule on the first object the room has. */
export function newRule(objects = []) {
  const object = objects[0]?.value ?? null;
  return normalizeRule({ on: 'wake', object, does: doesFor(object)[0], sound: object ? null : SOUNDS[1].value });
}

// ---------------------------------------------------------------------------------------------
// THE SOUNDS. Synthesised, short, once — nothing continuous, so nothing to register with the
// speaker arbiter; scaled by the audio bus's master volume like word_games.js's chime, so a
// screen somebody turned down stays down.
// ---------------------------------------------------------------------------------------------
const VOICES = {
  'chime-soft': [[523.25, 0, 0.5, 'triangle'], [659.25, 0.16, 0.5, 'triangle']],
  'chime-bright': [[880, 0, 0.45, 'sine'], [1318.5, 0.12, 0.45, 'sine']],
  knock: [[180, 0, 0.09, 'square'], [180, 0.22, 0.09, 'square']],
  // Petting the cat (row 2.37 item 11): two low, soft, overlapping notes — a purr, not a chime. Not in
  // SOUNDS, so the notification editor does not offer it; it is the room's own answer to a stroke.
  purr: [[98, 0, 0.7, 'triangle'], [110, 0.18, 0.7, 'triangle'], [98, 0.4, 0.6, 'triangle']],
};
/** The sounds playSound knows, notification ones and the room's own (a purr). */
export const SOUND_NAMES = Object.freeze(Object.keys(VOICES));
let actx = null;
export function playSound(name, { level = 1, win = (typeof window !== 'undefined' ? window : null) } = {}) {
  const notes = VOICES[name];
  if (!notes) return false;
  try {
    const AC = win && (win.AudioContext || win.webkitAudioContext);
    if (!AC) return false;
    actx = actx || new AC();
    if (actx.state === 'suspended') actx.resume?.().catch(() => {});
    const peak = 0.1 * Math.max(0, Math.min(1, Number(level)));
    if (!(peak > 0)) return false;
    for (const [freq, at, len, type] of notes) {
      const o = actx.createOscillator();
      const v = actx.createGain();
      o.type = type;
      o.frequency.value = freq;
      const s = actx.currentTime + at;
      v.gain.setValueAtTime(0, s);
      v.gain.linearRampToValueAtTime(peak, s + 0.02);
      v.gain.exponentialRampToValueAtTime(0.0001, s + len);
      o.connect(v).connect(actx.destination);
      o.start(s);
      o.stop(s + len + 0.02);
    }
    return true;
  } catch (err) { console.error('room_notify: sound', err); return false; }
}
