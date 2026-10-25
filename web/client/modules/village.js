// modules/village.js - THE CASTLE AND THE VILLAGE (Design's item 45, row 2.118; Design System19, 2026-10-24/25).
//
// Claude Design's village handoff: "A scene is plain data. Nothing is drawn in a fixed position" - `{ look, time, frame,
// pieces: [{ piece | cast, x, y, scale, rot, flip, ... }] }` on a 1600x900 stage, x and y the FOOT, drawn by
// village_kit.js (shipped as it is) with the cast from cast.js (King Kenny, Queen Rose, Jack, Robin, Princess Jess, Prince
// Vince, Merlin, the knights Michael and Gladys, Nimrod the cat, the villagers). This panel SHOWS a village scene:
//   Which scene   Market day (counting and spelling), The village, The castle, or Empty - Design's starting scenes.
//   Look          Crafted (paper and felt, Design's default) or Toon (ink line and cel shade).
//   Time of day   Following the clock (day, evening, night, the room's own hours: room_parts.js lightFor), or fixed.
//   Card frame    The crafted look's cardboard frame, on or off.
// EDITING (moving, scaling and turning pieces) is the next step: the SAME editor as the room's (room_handles.js), on the
// same fields, as Design and chat asked ("build one editor, not two"). Nothing here waits on anybody; nothing moves but
// what Design animates, and that only without "reduce motion".
//
// PI 400 (Design: "Crafted is heavier ... fine as a still image"). The scene is drawn ONCE per change of settings (or of
// the hour's light), never per frame; Design's own moving parts are CSS inside its drawing. Measuring frame rates on the
// bench is on Design's list back (README "What Design needs back" 1).

import { registerModule } from '../module.js';
import { VILLAGE_SCENES, sceneSvg } from '../village_kit.js';
import { castSvg } from '../cast.js';
import { lightFor } from '../room_parts.js';
import { NIMROD_DEFAULTS, defaultFor } from '../nimrod_defaults.js';

export const TYPE = 'village';
export const TITLE = 'Castle and village';
// Where the cat's pictures are on this site (cast.js reads `<assetBase>nimrod-cat/...`).
export const ASSET_BASE = '/design-assets/';
// How often a scene following the clock looks again to see whether evening or night has come. Five minutes: the light
// changes at three fixed hours (room_parts.js lightFor), so this is at most five minutes late, and costs one check.
export const LIGHT_CHECK_MS = 5 * 60 * 1000;

const sceneOptions = () => Object.entries(VILLAGE_SCENES).map(([value, s]) => ({ value, label: s.label || value }));
export const SETTINGS = [
  { key: 'scene', label: 'Which scene', kind: 'choice', default: 'village', level: 'essential', options: sceneOptions() },
  { key: 'look', label: 'Look', kind: 'choice', default: 'crafted', level: 'standard',
    options: [{ value: 'crafted', label: 'Crafted (paper and felt)' }, { value: 'toon', label: 'Toon (ink line)' }] },
  { key: 'time', label: 'Time of day', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Follow the clock' }, { value: 'day', label: 'Day' }, { value: 'evening', label: 'Evening' },
      { value: 'night', label: 'Night' }] },
  { key: 'frame', label: 'Card frame (crafted look)', kind: 'toggle', default: true, level: 'advanced', onLabel: 'On', offLabel: 'Off',
    appliesWhen: (v) => (v?.look || 'crafted') === 'crafted' },
];

/** The recipe a panel shows: its own, else the chosen starting scene's, with the panel's look, time and frame. PURE. */
export function recipeFor(cfg = {}, now = new Date(), defaults = NIMROD_DEFAULTS) {
  const own = cfg.recipe && typeof cfg.recipe === 'object' && Array.isArray(cfg.recipe.pieces) ? cfg.recipe : null;
  const sceneId = VILLAGE_SCENES[cfg.scene] ? cfg.scene : 'village';
  // The designer's own version of the scene, when nimrod_defaults.js has one (Design's item 42.3); else Design's.
  const base = own || defaultFor('village', [sceneId], defaults) || (VILLAGE_SCENES[sceneId] || Object.values(VILLAGE_SCENES)[0]).recipe;
  const time = ['day', 'evening', 'night'].includes(cfg.time) ? cfg.time : lightFor('auto', now);
  return { ...base, look: cfg.look === 'toon' ? 'toon' : 'crafted', time, frame: cfg.frame !== false };
}

registerModule(
  { type: TYPE, title: TITLE, core: 'new',
    description: 'Design\'s castle and village: King Kenny, Queen Rose, Jack, Robin, Princess Jess, Prince Vince, Merlin, '
      + 'the knights and the villagers, in paper-and-felt or toon, by day, evening or night.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    let cfg = {};
    let dead = false;
    let timer = null;
    let drawn = '';
    const now = () => (typeof ctx.now === 'function' ? new Date(ctx.now()) : new Date());

    function draw() {
      if (dead) return;
      const r = recipeFor(cfg, now());
      const key = JSON.stringify(r);
      if (key === drawn) return;          // nothing changed: the scene is not redrawn (the Pi's sake)
      drawn = key;
      let svg = '';
      try { svg = sceneSvg(r, { assetBase: ASSET_BASE, castSvg }); } catch (err) { console.error('village: draw', err); svg = ''; }
      mount.innerHTML = `<div class="vg-root mod-box" data-village="${String(cfg.scene || 'village').replace(/[^\w-]/g, '')}" data-look="${r.look}" data-time="${r.time}"`
        + ` style="height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden">`
        + `${svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}</div>`;
    }
    function arm() {
      if (timer != null) { clearT(timer); timer = null; }
      if (dead || (cfg.time && cfg.time !== 'auto')) return;
      timer = setT(() => { timer = null; draw(); arm(); }, LIGHT_CHECK_MS);
    }
    return {
      __probe: () => ({ recipe: recipeFor(cfg, now()), drawn: !!drawn }),
      init() {
        cfg = { ...(state?.get?.() || {}) };
        state?.subscribe?.((s) => { if (dead) return; cfg = { ...(s || {}) }; draw(); arm(); });
        draw();
        arm();
      },
      onShow() { draw(); },
      onResize() {},
      destroy() { dead = true; if (timer != null) clearT(timer); timer = null; mount.innerHTML = ''; },
    };
  },
);
