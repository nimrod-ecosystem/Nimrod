// modules/room.js — A ROOM, AS A MODULE: so the room renderer can be tried on the modules page.
//
// Change list rows 2.33, 2.34 and 2.37. The renderer is `../room_scene.js` (Claude Design's rules,
// ported); the rooms are `../room_presets.js`. This file is only the module: settings as data, a
// mount, the verbs, and what a press does when nothing on the page answers it.
//
// *** WHAT IT IS NOT, YET: the room is not the screen here. *** Step 6 Stage R is where a dashboard's
// scene becomes a room and real modules mount in its slots. Here the room is ONE PANEL: its display
// objects (the cabinet, the bookshelf) lift a flat, labelled, empty slot — the place a transport bar
// or the edit menus will go — and its button objects publish the SAME verbs the plain bar's buttons
// will (`system/fullscreen`, `system/settings`) on the bus. Nothing in the kiosk answers those topics
// yet (kiosk.js is Stage R's to wire), so on a page where nobody claims the press:
//   * the flower pot puts THIS PANEL into full screen and out again — the nearest honest meaning of
//     "full screen on/off" for one panel;
//   * the door says, for a moment, where settings open on a real screen. It is a note at the top of
//     the panel that closes itself (never a dialog, never waiting on anybody).
//
// *** THE INVARIANT. *** A room takes no input and asks for none: left alone it is scenery with a
// clock on the wall. The one state a press can open — a lifted panel — goes back by itself after
// "Put a lifted panel back after" (default one minute), unless somebody chose "Never".
//
// *** NOTIFICATIONS. *** The lamp lights and the cat's ears perk up when the wake phrase is heard
// (`speech/listening`, the same event listening_cue.js answers — the on-screen cue still comes; the
// room only adds to it). Anything else can make the room react by publishing `room/notify` with
// `{ event: 'message' | 'call' | 'visitor' | 'timer' | 'wake', ms? }`.

import { registerModule } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { mountRoomScene, RENDER_DEFAULTS } from '../room_scene.js';
import { listPresets, presetRecipe, DEFAULT_PRESET } from '../room_presets.js';
import { LISTENING_TOPIC } from '../input_speech.js';

// Every default argued (Rule 1), and every one of them a setting:
//   preset 'theRoom'   the room whose furniture carries the controls: it is the one that shows what
//                      this renderer is FOR (objects that are buttons, displays that lift). Design's
//                      four starter rooms are one press away.
//   light 'auto'       Design's rule 5: follow the real clock. Fixed day/evening/night for anybody
//                      who wants the look without the change (a night owl, a screen in a dark room).
//   labels 'always'    Design: an object's meaning is never only its picture. "When pointed at" is
//                      for somebody who finds the chips busy and can point.
//   motion 'gentle'    the same ladder, words and default as `scene` and `wallpaper`.
//   liftReturnMs 60000 the invariant's way out (room_scene.js RENDER_DEFAULTS says why a minute).
//   zoom 'off'         Design (room-add-ons §1): zoom on focus is off by default, 1.1–1.5×.
//   signWords ''       empty keeps each room's own words; anything typed goes on every sign in it.
//   showSlots false    an editing aid (Design's "Show slot sizes"), not something a room shows.
export const DEFAULTS = Object.freeze({
  preset: DEFAULT_PRESET, light: 'auto', labels: 'always', motion: 'gentle',
  liftReturnMs: RENDER_DEFAULTS.liftReturnMs, zoom: 'off', signWords: '', showSlots: false,
});

export const SETTINGS = [
  { key: 'preset', label: 'Which room', kind: 'choice', default: DEFAULTS.preset, level: 'essential',
    options: listPresets() },
  { key: 'light', label: 'Light', kind: 'choice', default: DEFAULTS.light, level: 'essential',
    options: [
      { value: 'auto', label: 'Follows the clock' },
      { value: 'day', label: 'Day' },
      { value: 'evening', label: 'Evening' },
      { value: 'night', label: 'Night' },
    ] },
  { key: 'labels', label: 'Labels on objects', kind: 'choice', default: DEFAULTS.labels, level: 'essential',
    options: [
      { value: 'always', label: 'Always' },
      { value: 'pointed', label: 'When pointed at' },
    ] },
  { key: 'signWords', label: 'Words on the signs', kind: 'text', default: DEFAULTS.signWords, level: 'standard',
    placeholder: 'The room’s own words', maxLength: 40 },
  { key: 'motion', label: 'Movement', kind: 'choice', default: DEFAULTS.motion, level: 'standard',
    options: [
      { value: 'gentle', label: 'gentle — as designed' },
      { value: 'calm', label: 'calm — slower' },
      { value: 'still', label: 'still — no movement at all' },
    ] },
  { key: 'liftReturnMs', label: 'Put a lifted panel back after', kind: 'choice', default: DEFAULTS.liftReturnMs,
    level: 'standard',
    options: [
      { value: 30000, label: '30 seconds' },
      { value: 60000, label: '1 minute' },
      { value: 120000, label: '2 minutes' },
      { value: 0, label: 'Never (put it back yourself)' },
    ] },
  { key: 'zoom', label: 'Grow what the cursor is on', kind: 'choice', default: DEFAULTS.zoom, level: 'standard',
    options: [
      { value: 'off', label: 'Off' },
      { value: '1.1', label: 'A little (1.1×)' },
      { value: '1.25', label: 'Some (1.25×)' },
      { value: '1.5', label: 'A lot (1.5×)' },
    ] },
  { key: 'showSlots', label: 'Show slot sizes', kind: 'toggle', default: DEFAULTS.showSlots, level: 'advanced',
    onLabel: 'Shown', offLabel: 'Hidden' },
];

const FIELDS = Object.fromEntries(SETTINGS.map(normalizeField).filter(Boolean).map((f) => [f.key, f]));

/** What is in force, read through each declaration — the same reading the settings menu does. */
export function configFrom(row = {}) {
  const cfg = {};
  for (const f of Object.values(FIELDS)) cfg[f.key] = fieldValue(f, row || {});
  for (const k of ['preset', 'light', 'labels', 'motion', 'zoom']) {
    if (!FIELDS[k].options.some((x) => x.value === cfg[k])) cfg[k] = DEFAULTS[k];
  }
  if (!FIELDS.liftReturnMs.options.some((x) => x.value === cfg.liftReturnMs)) cfg.liftReturnMs = DEFAULTS.liftReturnMs;
  cfg.signWords = String(cfg.signWords ?? '').slice(0, 40);
  cfg.showSlots = !!cfg.showSlots;
  return cfg;
}

// What the renderer is told, from what the settings say.
const renderOpts = (cfg) => ({
  light: cfg.light, labels: cfg.labels, motion: cfg.motion, liftReturnMs: cfg.liftReturnMs,
  zoom: cfg.zoom === 'off' ? null : Number(cfg.zoom), signWords: cfg.signWords, showSlots: cfg.showSlots,
});

registerModule(
  { type: 'room', title: 'Room', core: 'new',
    // `none`: the room, its art, its clock and its window's scene need no server, no files of the
    // person's and no network — the same answer `scene` gives. The frames' two sample pictures
    // are bundled with the site like the rest of it.
    dependsOn: 'none', importance: 'optional',
    description: 'A room you can look into: furniture, a window onto a live scene, a clock and a '
      + 'calendar on the wall. Its furniture can hold the screen’s controls.',
    settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = configFrom({});
    let scene = null;
    let host = null;
    let torn = false;
    const offs = [];

    // A press nobody on the page answered. See the header for why each of these is the honest one.
    function onUnclaimed(action, { api } = {}) {
      if (torn) return;
      if (action === 'fullscreen.toggle') {
        const doc = mount.ownerDocument;
        try {
          if (doc.fullscreenElement) doc.exitFullscreen?.()?.catch?.(() => {});
          else mount.requestFullscreen?.()?.catch?.(() => api?.toast('Full screen is not available here.'));
        } catch { api?.toast('Full screen is not available here.'); }
        return;
      }
      if (action === 'settings.open') { api?.toast('On a screen, this door opens Settings.'); return; }
      api?.toast('Nothing here answers that yet.');
    }

    function apply(row) {
      const next = configFrom(row || {});
      const presetChanged = next.preset !== cfg.preset;
      cfg = next;
      if (!scene) return;
      if (presetChanged) scene.setRecipe(presetRecipe(cfg.preset));
      scene.setOptions(renderOpts(cfg));
    }

    return {
      // For a test: the renderer, so a suite can look at what it drew without re-deriving it.
      __scene: () => scene,
      init() {
        mount.innerHTML = '';
        host = document.createElement('div');
        host.className = 'room-mod';
        host.setAttribute('data-room-mod', '');
        host.style.cssText = 'position:relative;width:100%;height:100%;min-height:120px;overflow:hidden';
        mount.append(host);
        cfg = configFrom(state?.get?.() || {});
        scene = mountRoomScene(host, presetRecipe(cfg.preset), { ...renderOpts(cfg), bus: ctx.bus, onUnclaimed });
        const sub = state?.subscribe?.((row) => apply(row));
        if (typeof sub === 'function') offs.push(sub);
        // THE VERBS. `next`/`prev` walk the room's objects in Design's scan order, `select` presses
        // the one the cursor is on, `back` puts a lifted panel back. Through `ctx.bus`, so each also
        // answers on this instance's own scoped alias (bus.js `scope`).
        ctx.bus?.subscribe?.('room/next', () => scene?.focusNext());
        ctx.bus?.subscribe?.('room/prev', () => scene?.focusPrev());
        ctx.bus?.subscribe?.('room/select', () => scene?.select());
        ctx.bus?.subscribe?.('room/back', () => scene?.back());
        // Objects react alongside the on-screen cue, never instead of it.
        ctx.bus?.subscribe?.(LISTENING_TOPIC, (p) => {
          if (!scene) return;
          if (p && p.on) scene.notify('wake', { ms: Number(p.ms) > 0 ? Math.min(30000, Number(p.ms) + 2000) : undefined });
          else scene.clearReactions();
        });
        ctx.bus?.subscribe?.('room/notify', (p) => {
          const event = typeof p === 'string' ? p : p?.event;
          if (scene && event) scene.notify(event, Number(p?.ms) > 0 ? { ms: Number(p.ms) } : {});
        });
      },
      onResize() { scene?.fit(); },
      // Parked while covered, like `scene`: nothing moves behind something else. Coming back is instant.
      onHide() { scene?.setOptions({ motion: 'still' }); },
      onShow() { scene?.setOptions({ motion: cfg.motion }); },
      destroy() {
        torn = true;
        while (offs.length) { try { offs.pop()(); } catch { /* gone */ } }
        scene?.destroy();
        scene = null;
        mount.innerHTML = '';
        host = null;
      },
    };
  },
);
