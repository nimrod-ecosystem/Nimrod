// modules/overlays.js — "OVERLAYS": the small things that can live over anything - a cat, fireflies, a balloon now and
// then, rain or snow - over any dashboard or any one module. Row 2.104.
//
// Mike, 2026-10-18: *"The overlay options are all in the AAC boards menu for some reason. Overlays should probably be it's
// own module that you can use to add overlays to any module/dashboard."* What he saw were the scene's INHABITANTS
// (livescene.js OVERLAYS: "a scene is a world; an overlay is one small inhabitant that can sit in ANY world"), which only
// the AAC board's background and the Live scene module could show. Now they are their own module:
//   * OVER A WHOLE DASHBOARD: "Over the dashboard" in the Modules library, or Place: Overlay in the editor. It covers
//     the dashboard (layout.js FULL_OVERLAY_TYPES), draws NO world of its own (livescene.js NO_WORLD: only the
//     inhabitants and the weather, on a clear ground), and never catches a press (`passesPresses`, arrangement.js):
//     every panel under it works as before.
//   * OVER ONE MODULE: the same, sized over that panel in the editor.
// The rows (weather, then one toggle per inhabitant) are the ones the Live scene module and the AAC board had; they live
// here now (OVERLAY_FIELDS), and the Live scene module uses these. The AAC board no longer offers them: a board that
// already had a cat keeps drawing it (its saved values are still read), there is just no row there for it any more.
//
// *** THE INVARIANT. *** It takes no input and asks for none, and it is never in the way of a press: scenery.

import { registerModule } from '../module.js';
import { mountScene, listOverlays, NO_WORLD } from '../livescene.js';
import { followWeather } from '../live_weather.js';
import { flashLimit } from '../flash_limit.js';

export const OVERLAYS_TYPE = 'overlays';

/** The rows: weather (one choice: two skies at once is not weather), then one toggle per inhabitant. */
export const OVERLAY_FIELDS = [
  // `live` follows the forecast for the place saved on the profile (live_weather.js); with none saved it is dry.
  { key: 'weather', label: 'Weather', kind: 'choice', default: 'none', level: 'standard',
    options: [
      { value: 'none', label: 'None' },
      { value: 'live', label: 'The real weather outside' },
      ...listOverlays().filter((o) => o.group === 'weather').map((o) => ({ value: o.value, label: o.label })),
    ] },
  // One toggle each, because a one-switch cursor walks toggles and settings_fields.js has no multi-select kind.
  ...listOverlays().filter((o) => o.group !== 'weather').map((o) => ({
    key: o.value, label: o.label, kind: 'toggle', default: false, level: 'standard',
    onLabel: 'Yes', offLabel: 'No', note: o.note,
  })),
];

/** The overlays a set of values asks for (`liveKey`: the live weather's current overlay, or null). PURE. */
export function overlaysFor(cfg = {}, liveKey = null) {
  return [
    cfg.weather === 'live' ? liveKey : (cfg.weather && cfg.weather !== 'none' ? cfg.weather : null),
    ...listOverlays().filter((o) => o.group !== 'weather' && cfg[o.value]).map((o) => o.value),
  ].filter(Boolean);
}

const MOTION_FIELD = { key: 'motion', label: 'Movement', kind: 'choice', default: 'gentle', level: 'standard',
  options: [{ value: 'gentle', label: 'gentle: the usual movement' }, { value: 'calm', label: 'calm: slower' },
    { value: 'still', label: 'still: no movement at all' }] };
// A new panel starts with something to see: a few fireflies. [Guess: the calmest inhabitant; any is one press away.]
const DEFAULTS = { weather: 'none', motion: 'gentle', fireflies: true };
const SETTINGS = [
  ...OVERLAY_FIELDS.map((f) => (f.key === 'fireflies' ? { ...f, default: true } : f)),
  MOTION_FIELD,
];

registerModule(
  { type: OVERLAYS_TYPE, title: 'Overlays', core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'A cat, fireflies, a balloon now and then, rain or snow: over any dashboard or module. Nothing to press.',
    // Over everything, yet never in the way: the box lets every press through to what is under it (arrangement.js),
    // and the switch's walk skips it (there is nothing in it to press).
    passesPresses: true, overlayScan: 'skip',
    settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = { ...DEFAULTS };
    let scene = null;
    let liveKey = null, live = null;
    const opts = () => ({ scene: NO_WORLD, motion: cfg.motion, flashLimit: () => flashLimit(ctx), overlays: overlaysFor(cfg, liveKey) });
    function syncLive() {
      const want = cfg.weather === 'live' && ctx.weatherPlace;
      if (!want) { live?.stop?.(); live = null; liveKey = null; return; }
      if (live) return;
      live = followWeather(ctx.weatherPlace, (k) => { liveKey = k; scene?.set(opts()); });
    }
    return {
      __probe: () => ({ ...opts(), mounted: !!scene }),
      init() {
        mount.innerHTML = '';
        mount.style.position = 'relative';
        mount.style.pointerEvents = 'none';
        mount.style.background = 'transparent';
        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        syncLive();
        scene = mountScene(mount, opts());
        state?.subscribe?.(() => { cfg = { ...DEFAULTS, ...(state.get() || {}) }; syncLive(); scene?.set(opts()); });
      },
      onResize() {},
      onHide() { scene?.set({ motion: 'still' }); },
      onShow() { scene?.set(opts()); },
      destroy() { live?.stop?.(); scene?.destroy(); scene = null; mount.innerHTML = ''; },
    };
  },
);
