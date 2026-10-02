// panel_sound.js — ONE PANEL'S OWN SOUND: its volume, "sound like it's in the room", and on a TV (a
// dashboard placed in a dashboard) the sound of each thing on it. 2026-10-02.
//
// Mike, on a TV in a room showing a live dashboard that plays sound: *"It has to be accessible through
// the transport bar and settings menu. Would be nice if you could add room reverb to things in the room
// as an option. Probably not something we need to include in the site as a default."*
//
// WHERE EACH PIECE LIVES, and why here: the rows are declared once in this file and kept on the PANEL'S
// OWN state row (the row its own settings already live in), under keys no module declares or reads -
// the `instancePanelSurface` idea. Two hosts mount panels (kiosk.js `mountInstance`, and a dashboard's
// own children in modules/view.js), and both call `watchPanelSound` on the row they made, so a level
// set from the menu, from the bar's chip or from another device is applied the same way on both.
// The bus does the hearing (audio_bus.js `setLevel`); the effects do the room (mixer_fx.js
// `setOwnerReverb`, reached through `audio.setOwnerReverb`, which the kiosk adds without making an
// audio context for it).
//
// DEFAULTS, argued (Rule 1):
//   volume 1 ("As loud as the rest")  a panel nobody touched sounds exactly as it did before this.
//   room   'off'                      Mike: "Probably not something we need to include in the site as a
//                                     default." Level `advanced` ("Everything"), so it is not one more
//                                     stop on the usual one-switch walk for a thing set once, if ever.
//   volume at `standard`             "this panel is too loud" is an everyday want; one stop, on panels
//                                     that make sound only.

// mixer_fx.js ROOM_SOUND_CHOICES, written out so a dashboard (modules/view.js) importing this does not pull
// the effects (and their plugin loader) in with it; audio_bus_test checks the two lists agree.
export const ROOM_SOUND_CHOICES = Object.freeze(['off', 'small', 'large']);

export const PANEL_VOLUME_KEY = 'panelVolume';
export const ROOM_SOUND_KEY = 'roomSound';
// What a TV's own row keeps about the things on it: { [innerOwnerId]: true } for each one muted.
export const NESTED_MUTED_KEY = 'nestedMuted';
// The level a chip's "sound on" goes back to when somebody muted the panel from the bar.
export const PANEL_VOLUME_ON_KEY = 'panelVolumeOn';

export const PANEL_VOLUME_FIELD = Object.freeze({
  key: PANEL_VOLUME_KEY, label: 'This panel’s volume', kind: 'choice', level: 'standard', default: 1,
  options: Object.freeze([
    { value: 1, label: 'As loud as the rest' },
    { value: 0.75, label: 'A little quieter' },
    { value: 0.5, label: 'Half as loud' },
    { value: 0.25, label: 'Much quieter' },
    { value: 0, label: 'Muted' },
  ]),
});

export const ROOM_SOUND_FIELD = Object.freeze({
  key: ROOM_SOUND_KEY, label: 'Sound like it’s in the room', kind: 'choice', level: 'advanced', default: 'off',
  help: 'Adds a little echo to this panel’s own sound, as if it were across the room. Only for sound the screen plays itself (not a YouTube video).',
  options: Object.freeze([
    { value: 'off', label: 'Off' },
    { value: 'small', label: 'A small room' },
    { value: 'large', label: 'A large room' },
  ]),
});

/** The volume in a row: 0..1, anything broken or unset is 1 (never silence by accident). */
export function panelVolumeFrom(row) {
  const v = row && row[PANEL_VOLUME_KEY];
  if (v === null || v === undefined || v === '') return 1;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}
export function roomSoundFrom(row) {
  const v = row && row[ROOM_SOUND_KEY];
  return ROOM_SOUND_CHOICES.includes(v) ? v : 'off';
}
export function nestedMutedFrom(row) {
  const m = row && row[NESTED_MUTED_KEY];
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** Apply one panel's row to the bus and the effects. `id` is the panel's instance id. */
export function applyPanelSound(audio, id, row) {
  if (!audio || !id) return;
  try { audio.setLevel?.(id, panelVolumeFrom(row)); } catch (err) { console.error('panel sound: volume', err); }
  try { audio.setOwnerReverb?.(id, roomSoundFrom(row)); } catch (err) { console.error('panel sound: room', err); }
  // A TV's things: each one muted by name is a level of 0 on [tv, thing]; the rest are cleared.
  try {
    const muted = nestedMutedFrom(row);
    const seen = new Set();
    for (const [inner, on] of Object.entries(muted)) {
      if (!inner) continue;
      seen.add(inner);
      audio.setLevel?.([id, inner], on ? 0 : 1);
    }
    for (const inner of audio.ownersWithin?.(id) || []) if (!seen.has(inner)) audio.setLevel?.([id, inner], 1);
  } catch (err) { console.error('panel sound: on a TV', err); }
}

/**
 * Follow one panel's state row: apply now and on every change. Returns the unsubscribe. Clears what it
 * set when it stops (a panel swapped away must not leave its level behind on the bus).
 */
export function watchPanelSound(audio, id, state) {
  if (!audio || !id || !state?.subscribe) return () => {};
  let off = null;
  try { off = state.subscribe((s) => applyPanelSound(audio, id, s || {})); } catch { off = null; }
  return () => {
    try { off?.(); } catch { /* already gone */ }
    try { audio.setLevel?.(id, 1); audio.setOwnerReverb?.(id, 'off'); } catch { /* the bus may be gone */ }
  };
}

/** The chip's toggle: muted <-> the level it had. A patch for the panel's own row. */
export function toggleMutePatch(row) {
  const v = panelVolumeFrom(row);
  if (v > 0) return { [PANEL_VOLUME_KEY]: 0, [PANEL_VOLUME_ON_KEY]: v };
  const back = Number(row && row[PANEL_VOLUME_ON_KEY]);
  return { [PANEL_VOLUME_KEY]: Number.isFinite(back) && back > 0 && back <= 1 ? back : 1 };
}
