// master_volume.js — "LOUDER" AND "QUIETER" MOVE THE WHOLE SCREEN.
//
// Mike, 2026-09-30 (row 2.28 call 4), on what "louder" should move: *"I think it would control the
// audio busses master volume."* The first cut (0024a29) moved the focused video's own volume, so
// "louder" did nothing while focus sat on a clock. This answers `verb/volume-up` and
// `verb/volume-down` - whether they came from a spoken phrase or a switch bound in the binder -
// by moving `audio_bus.js`'s master one step, whatever has focus. The router leaves those two
// verbs alone (MASTER_VERBS in actions.js), so nothing else answers them.
//
// *** AN INTERIM MASTER. *** Row 2.35 turns the audio bus into a mixer with a fader and a minimum
// per channel; this is the one number that exists before that, and it keeps its settings keys so
// the mixer can take them over.
//
// *** KEPT WITH THE SCREEN, LIKE A TV KEEPS ITS VOLUME. *** Written to the screen's own settings
// (the kiosk's profile settings row, where its theme and panel backgrounds already live), not to
// this browser's localStorage. The deciding fact is local: the two bedside units get physically
// swapped, and a per-device volume would reset on every swap - the new unit would come up at full
// volume in a room where somebody had turned it down. The screen's settings come with the screen.
//
// Pure wiring: it takes the bus, the audio bus and a read/write pair for the settings row, so the
// host decides where "the screen's settings" are (see the report for the kiosk lines).

import { verbTopic, MASTER_VERBS } from './actions.js';

export const MASTER_DEFAULTS = Object.freeze({
  // Full, like a TV out of the box: a screen nobody has touched sounds exactly as it did before
  // the master existed.
  volume: 100,
  // One step. 20%: the step Mike OK'd for the video's own volume (row 2.28 call 3), for the same
  // reason - every spoken step costs a whole sentence, so a step too small to hear is a command
  // that seems not to work, and five steps from quietest to full is few enough to say.
  step: 20,
  // The floor, in percent. The audio bus's own MASTER_FLOOR (10%) - see its note for why the
  // master never reaches silence. Higher is offered for a caregiver who never wants a "quieter"
  // from somebody passing through to bury the screen.
  floor: 10,
});

// *** THE SETTINGS, at the SCREEN level (like a TV's volume: it belongs to the screen, not to
// whoever is signed in). Every one reachable with one switch - bounded numbers and choices. ***
export const MASTER_FIELDS = [
  { key: 'masterVolume', label: 'Volume', kind: 'number', default: MASTER_DEFAULTS.volume,
    min: 10, max: 100, step: 10, unit: '%', level: 'essential' },
  { key: 'masterStep', label: 'How much “louder” or “quieter” changes it', kind: 'choice',
    default: MASTER_DEFAULTS.step, level: 'advanced',
    options: [
      { value: 10, label: 'a little' },
      { value: 20, label: 'a step you can hear' },
      { value: 25, label: 'a big step' },
    ] },
  { key: 'masterFloor', label: 'Never quieter than', kind: 'choice',
    default: MASTER_DEFAULTS.floor, level: 'advanced',
    options: [
      { value: 10, label: '10%' },
      { value: 20, label: '20%' },
      { value: 30, label: '30%' },
    ] },
];

const num = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function attachMasterVolume({
  bus = null,
  audio = null,
  read = () => ({}),       // the screen's settings row
  write = null,            // (patch) => void, to save it; optional
} = {}) {
  let level = MASTER_DEFAULTS.volume;
  let step = MASTER_DEFAULTS.step;
  let floor = MASTER_DEFAULTS.floor;
  const offs = [];

  function values() {
    try { return read() || {}; } catch { return {}; }
  }
  function save(pct) {
    if (typeof write !== 'function') return;
    try { write({ masterVolume: pct }); } catch (err) { console.error('master volume: save', err); }
  }
  // The audio bus clamps and guards too; this keeps the NUMBER the settings row shows honest.
  function enact() {
    try { audio?.setMasterFloor?.(floor / 100); } catch (err) { console.error('master volume: floor', err); }
    try { audio?.setMaster?.(level / 100); } catch (err) { console.error('master volume: set', err); }
  }

  /** Re-read the settings row: on attach, and whenever the host's settings change. */
  function sync() {
    const v = values();
    const f = num(v.masterFloor);
    floor = Number.isFinite(f) && f > 0 && f <= 100 ? f : MASTER_DEFAULTS.floor;
    const s = num(v.masterStep);
    step = Number.isFinite(s) && s > 0 && s <= 100 ? s : MASTER_DEFAULTS.step;
    const saved = num(v.masterVolume);
    // A BROKEN saved volume is FULL volume, never silence; a real one under the floor is the
    // floor, and is saved back that way so the menu row never shows a number that is not playing.
    const next = Number.isFinite(saved) ? Math.max(floor, Math.min(100, saved)) : MASTER_DEFAULTS.volume;
    level = next;
    if (Number.isFinite(saved) && next !== saved) save(next);
    enact();
    return level;
  }

  function stepBy(dir) {
    level = Math.max(floor, Math.min(100, level + (dir < 0 ? -step : step)));
    enact();
    save(level);
    return level;
  }

  sync();
  if (bus && typeof bus.subscribe === 'function') {
    const [up, down] = MASTER_VERBS;
    // A DIRECTION, NEVER AN AMOUNT: whatever a sender put in the payload, one press is one step.
    offs.push(bus.subscribe(verbTopic(up), () => stepBy(1)));
    offs.push(bus.subscribe(verbTopic(down), () => stepBy(-1)));
  }

  return {
    level: () => level,
    louder: () => stepBy(1),
    quieter: () => stepBy(-1),
    sync,
    destroy() { offs.forEach((off) => { try { off(); } catch { /* gone */ } }); offs.length = 0; },
  };
}
