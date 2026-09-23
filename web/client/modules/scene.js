// modules/scene.js — "Live scene", a placeable module. A world on a panel, on its own.
//
// From Claude Design, 2026-09-22. Same shape as modules/wallpaper.js on purpose: a module a
// screen can hold by itself when the answer to "she has nothing to look at" is "something calm,
// all the time". It needs no server and no files, so like Wallpaper it is also an honest last
// resort when everything else is unreachable.
//
// The scene bodies live in ../livescene.js, generated from the design system, so this file is
// only the module: settings as data, a mount, and the motion ladder.
//
// *** THE INVARIANT, ON THIS MODULE'S OWN TERMS. *** A scene takes no input and asks for none.
// It cannot be a state only an input can leave, because it is not a state at all — it is scenery.

import { registerModule } from '../module.js';
import { mountScene, listScenes, listOverlays } from '../livescene.js';
import { followWeather } from '../live_weather.js';

const DEFAULTS = { scene: 'theme', motion: 'gentle', weather: 'none' };

export const SETTINGS = [
  // `theme` follows whatever the screen's theme brings, the same default Wallpaper uses, so a
  // profile on a live theme gets its world here without anybody picking it twice.
  { key: 'scene', label: 'Which scene', kind: 'choice', default: 'theme', level: 'standard',
    options: [{ value: 'theme', label: 'Follows the screen’s theme' }, ...listScenes()] },
  { key: 'motion', label: 'Movement', kind: 'choice', default: 'gentle', level: 'standard',
    options: [
      { value: 'gentle', label: 'gentle — as designed' },
      { value: 'calm',   label: 'calm — slower' },
      { value: 'still',  label: 'still — no movement at all' },
    ] },
  // WEATHER IS ONE CHOICE, not five toggles: two kinds of sky at once is not weather.
  // `live` follows the forecast for the place saved on the profile (live_weather.js); with no place
  // saved it is simply dry, never an error.
  { key: 'weather', label: 'Weather', kind: 'choice', default: 'none', level: 'standard',
    options: [
      { value: 'none', label: 'None' },
      { value: 'live', label: 'The real weather outside' },
      ...listOverlays().filter((o) => o.group === 'weather').map((o) => ({ value: o.value, label: o.label })),
    ] },
  // The rest are toggles, one each, because a one-switch cursor walks toggles and settings_fields.js
  // has no multi-select kind.
  ...listOverlays().filter((o) => o.group !== 'weather').map((o) => ({
    key: o.value, label: o.label, kind: 'toggle', default: false, level: 'standard',
    onLabel: 'Yes', offLabel: 'No', note: o.note,
  })),
];

registerModule(
  { type: 'scene', title: 'Live scene',
    description: 'A calm animated world — woods, an aquarium, a night sky. Nothing to press.',
    // `none`: live weather is optional and fails to dry skies, so the module still needs nothing.
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = { ...DEFAULTS };
    let scene = null;

    // What `theme` resolves to: the live theme's scene if the screen wears one, else nimrod.
    const themeScene = () => document.documentElement.getAttribute('data-live-scene') || 'nimrod';
    const opts = () => ({
      scene: cfg.scene === 'theme' ? themeScene() : cfg.scene,
      motion: cfg.motion,
      overlays: [
        cfg.weather === 'live' ? liveKey : (cfg.weather !== 'none' ? cfg.weather : null),
        ...listOverlays().filter((o) => o.group !== 'weather' && cfg[o.value]).map((o) => o.value),
      ].filter(Boolean),
    });
    // The place is a PROFILE fact (a caregiver types a town once, in profile settings), not a
    // per-panel one: every panel on the screen is under the same sky. Code: `ctx.weatherPlace`
    // is a proposed name for however the host exposes it; {lat, lon} already rounded.
    let liveKey = null, live = null;
    function syncLive() {
      const want = cfg.weather === 'live' && ctx.weatherPlace;
      if (!want) { live?.stop(); live = null; liveKey = null; return; }
      if (live) return;
      live = followWeather(ctx.weatherPlace, (k) => { liveKey = k; scene?.set(opts()); });
    }

    return {
      __probe: () => ({ ...opts(), mounted: !!scene }),
      init() {
        mount.innerHTML = '';
        mount.style.position = 'relative';
        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        syncLive();
        scene = mountScene(mount, opts());
        state?.subscribe?.(() => {
          cfg = { ...DEFAULTS, ...(state.get() || {}) };
          syncLive();
          scene?.set(opts());
        });
      },
      onResize() { /* CSS-sized; nothing to recompute */ },
      // Parked while covered, same as Wallpaper's clock: a hidden scene is still paused, not
      // torn down, so coming back is instant.
      onHide() { scene?.set({ motion: 'still' }); },
      onShow() { scene?.set(opts()); },
      destroy() { live?.stop(); scene?.destroy(); scene = null; mount.innerHTML = ''; },
    };
  },
);
