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
// EDITING is the SAME editor as the room's, as Design and chat asked ("build one editor, not two", note CP): the panel's
// ✎ corner, then a press on a piece or a person chooses it (edit mode, `editTargets` below); the handles a room piece
// has (room_handles.js, on the SVG stage) drag it, scale it about its foot and turn it about its centre; and its rows -
// across, down, size, rotation, facing - are the same change as numbers, and what a switch walks (Design's rule: "everything
// a drag does has a button"). The scene as a whole adds a piece or a person, undoes, puts Design's scene back, and copies
// it for the site's defaults file (nimrod_defaults.js). An edited scene is the panel's own (`recipe` on its settings).
// Nothing here waits on anybody; nothing moves but what Design animates, and that only without "reduce motion".
//
// PI 400 (Design: "Crafted is heavier ... fine as a still image"). The scene is drawn ONCE per change of settings (or of
// the hour's light), never per frame; Design's own moving parts are CSS inside its drawing. MEASURED on the bench Pi 400
// (2026-10-25, 1920x1080, Chromium 148, the village and Market day): still, with Design's animations running, 60 fps in
// both looks; first draw to the screen 0.13-0.33 s; redrawn every frame 5-11 fps (toon about 1.5x crafted, not 4x);
// the whole SVG moved without a layer 13-19 fps, but ON ITS OWN LAYER (`will-change: transform`) 54 fps, as fast as a
// canvas bitmap (55) - so a scene that pans or zooms promotes the SVG instead of drawing a bitmap by hand. Never redraw
// per frame. (An <img> of the SVG moved: 10 fps - not that.)

import { registerModule } from '../module.js';
import { VILLAGE_SCENES, PIECES, PIECE_GROUPS, sceneSvg } from '../village_kit.js';
import { CAST, CAST_IDS, castSvg } from '../cast.js';
import { lightFor } from '../room_parts.js';
import { NIMROD_DEFAULTS, defaultFor, defaultsEntry } from '../nimrod_defaults.js';

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

// ---- EDITING (pure; the module below wires it to edit mode) ----
// The stage is 1600x900 (village_kit.js). The steps are Design's village builder's: 10 across and down, 15 degrees a
// turn; its size range, 0.1 to 4 (the handles any whole degree and any size inside it).
export const STAGE = Object.freeze({ w: 1600, h: 900 });
export const MOVE_STEP = 10;
export const TURN_STEP = 15;
export const SIZE_RANGE = Object.freeze([0.1, 4]);
// How many changes Undo steps back through: the room's 30 (arrangement.js ROOM_UNDO_MAX), for the same reason.
export const UNDO_MAX = 30;
// How many pieces a scene may hold. Design's starting scenes have up to ~40; 120 is three times that, and each one is a
// drawing the Pi 400 redraws when the scene changes.
export const PIECES_MAX = 120;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const normDeg = (d) => { let x = ((Number(d) || 0) % 360 + 360) % 360; if (x > 180) x -= 360; return Math.round(x); };
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A piece's or a person's name: "Market stall", "Princess Jess". PURE. */
export function pieceName(it = {}) {
  return (it.cast ? CAST[it.cast]?.name : PIECES[it.piece]?.label) || it.cast || it.piece || 'Piece';
}
// A LESSON PIECE'S OWN SETTINGS (Design's village builder's, same names and ranges as village_kit.js reads them): what a
// counting table holds and how many, a signboard's letters, how many rows of the castle wall are up, the candles, which
// way the market scale tips. The things to count are the builder's list.
export const COUNT_THINGS = Object.freeze(['loaf', 'apple', 'egg', 'coin', 'cup', 'candle', 'sack', 'key', 'duck', 'ball', 'star']);
const HOLDERS = ['table', 'basket', 'crate'];
const OWN = {
  countTable: [
    { key: 'object', label: 'What to count', kind: 'choice', level: 'essential', default: 'loaf', options: COUNT_THINGS.map((o) => ({ value: o, label: o[0].toUpperCase() + o.slice(1) })) },
    { key: 'count', label: 'How many', kind: 'number', min: 0, max: 10, step: 1, level: 'essential', default: 5, note: 'in rows of five' },
    { key: 'holder', label: 'On a', kind: 'choice', level: 'essential', default: 'table', options: HOLDERS.map((h) => ({ value: h, label: h[0].toUpperCase() + h.slice(1) })) },
  ],
  letterSign: [{ key: 'text', label: 'Letters', kind: 'text', editable: true, maxLength: 8, level: 'essential', default: 'CAT', note: 'up to 8; _ is a gap' }],
  wallBuild: [{ key: 'rows', label: 'Rows built', kind: 'number', min: 0, max: 6, step: 1, level: 'essential', default: 3 }],
  candleStand: [{ key: 'count', label: 'Candles', kind: 'number', min: 1, max: 7, step: 1, level: 'essential', default: 3 }],
  marketScale: [{ key: 'tilt', label: 'Tips toward', kind: 'choice', level: 'essential', default: 0,
    options: [{ value: -1, label: 'Left' }, { value: 0, label: 'Level' }, { value: 1, label: 'Right' }] }],
};
/** A piece's own settings beyond where it stands (a lesson piece's), as fields. PURE. */
export function pieceOwnFields(it = {}) { return (it.piece && OWN[it.piece]) || []; }

/** A piece's rows, as settings_fields.js fields (the same rows as a room piece's, room_edits.js pieceFields), then its
 * own settings. PURE. */
export function pieceFields(it = {}) {
  return [...transformFields(), ...pieceOwnFields(it)];
}
function transformFields() {
  return [
    { key: 'x', label: 'Left or right', kind: 'number', min: 0, max: STAGE.w, step: MOVE_STEP, level: 'essential', default: 800,
      note: '‹ moves it left, › right' },
    { key: 'y', label: 'Nearer or further', kind: 'number', min: 0, max: STAGE.h, step: MOVE_STEP, level: 'essential', default: 860,
      note: 'where its feet are: ‹ further back, › nearer' },
    { key: 'size', label: 'Size', kind: 'number', min: SIZE_RANGE[0], max: SIZE_RANGE[1], step: 0.05, level: 'essential', default: 1,
      note: '1 is its usual size' },
    { key: 'rotate', label: 'Rotation', kind: 'number', min: -180, max: 180, step: TURN_STEP, level: 'essential', default: 0, unit: '°',
      note: '‹ turns it left, › right; the round handle above a chosen piece turns it too' },
    { key: 'facing', label: 'Facing', kind: 'choice', level: 'essential', default: 'drawn',
      options: [{ value: 'drawn', label: 'As drawn' }, { value: 'turned', label: 'Turned round' }] },
  ];
}
/** What those rows show now. PURE. */
export function pieceValues(it = {}) {
  const own = Object.fromEntries(pieceOwnFields(it).map((f) => [f.key, it[f.key] ?? f.default]));
  return { x: Math.round(Number(it.x) || 0), y: Math.round(Number(it.y) || 0), size: Number(it.scale ?? 1) || 1,
    rotate: normDeg(it.rot), facing: it.flip ? 'turned' : 'drawn', ...own };
}
/** One own setting kept inside what village_kit.js draws (its range, its options; letters as capitals). Null: not one. PURE. */
function ownValue(f, v) {
  if (f.kind === 'number') { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, f.min, f.max) : null; }
  if (f.kind === 'choice') { const o = f.options.find((x) => String(x.value) === String(v)); return o ? o.value : null; }
  if (f.kind === 'text') return String(v ?? '').toUpperCase().replace(/\s+/g, '_').slice(0, f.maxLength);
  return null;
}
/** The scene with piece `i` changed by `patch` ({ x?, y?, size?, rotate?, facing? }), kept on the stage. Null: no such piece. PURE. */
export function withPieceEdit(recipe, i, patch = {}) {
  if (!recipe || !Array.isArray(recipe.pieces) || !recipe.pieces[i]) return null;
  const r = clone(recipe);
  const it = r.pieces[i];
  if (patch.x != null && Number.isFinite(Number(patch.x))) it.x = round1(clamp(Number(patch.x), 0, STAGE.w));
  if (patch.y != null && Number.isFinite(Number(patch.y))) it.y = round1(clamp(Number(patch.y), 0, STAGE.h));
  if (patch.size != null && Number.isFinite(Number(patch.size))) it.scale = Math.round(clamp(Number(patch.size), ...SIZE_RANGE) * 100) / 100;
  if (patch.rotate != null) { const d = normDeg(patch.rotate); if (d) it.rot = d; else delete it.rot; }
  if (patch.facing != null) { if (patch.facing === 'turned') it.flip = true; else delete it.flip; }
  for (const f of pieceOwnFields(it)) {
    if (!(f.key in patch)) continue;
    const v = ownValue(f, patch[f.key]);
    if (v !== null) it[f.key] = v;
  }
  return r;
}
/** The scene without piece `i`. PURE. */
export function withoutPiece(recipe, i) {
  if (!recipe || !Array.isArray(recipe.pieces) || !recipe.pieces[i]) return null;
  const r = clone(recipe);
  r.pieces.splice(i, 1);
  return r;
}
/** The scene with piece `i` copied, a step to the right of it. `{ recipe, index }`, or null. PURE. */
export function withCopy(recipe, i) {
  if (!recipe || !Array.isArray(recipe.pieces) || !recipe.pieces[i] || recipe.pieces.length >= PIECES_MAX) return null;
  const r = clone(recipe);
  const it = clone(r.pieces[i]);
  it.x = round1(clamp((Number(it.x) || 0) + 6 * MOVE_STEP, 0, STAGE.w));
  r.pieces.push(it);
  return { recipe: r, index: r.pieces.length - 1 };
}
/** "piece:<key>" or "cast:<id>", added in the middle of the stage (a sky piece in the sky), as Design's builder does. PURE. */
export function withNewPiece(recipe, what) {
  const [kind, key] = String(what || '').split(':');
  const ok = kind === 'cast' ? !!CAST[key] : kind === 'piece' ? !!PIECES[key] : false;
  if (!recipe || !ok) return { recipe: null, why: 'There is no such piece.' };
  if ((recipe.pieces || []).length >= PIECES_MAX) return { recipe: null, why: `This scene is full (${PIECES_MAX} things).` };
  const r = clone(recipe);
  r.pieces = Array.isArray(r.pieces) ? r.pieces : [];
  r.pieces.push(kind === 'cast' ? { cast: key, x: 800, y: 860, scale: key === 'nimrod' ? 0.5 : 0.62 }
    : { piece: key, x: 800, y: PIECES[key].sky ? 260 : 820 });
  return { recipe: r, index: r.pieces.length - 1 };
}
/** What "Add a piece or a person" offers: Design's groups of pieces, then the people. PURE. */
export function addOptions() {
  const out = [{ value: '', label: 'Choose one' }];
  for (const g of PIECE_GROUPS) {
    for (const [k, p] of Object.entries(PIECES)) if (p.group === g) out.push({ value: `piece:${k}`, label: `${g}: ${p.label}` });
  }
  for (const id of CAST_IDS) out.push({ value: `cast:${id}`, label: `People: ${CAST[id].name}` });
  return out;
}
/** The scene as the panel keeps it: its pieces and label (look, time and frame are the panel's settings). PURE. */
export function ownRecipe(r) {
  const { look, time, frame, ...rest } = clone(r || {});
  return { ...rest, pieces: Array.isArray(rest.pieces) ? rest.pieces : [] };
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
    let current = null;                   // the recipe drawn now
    let saidTimer = null;
    const undo = [];
    const now = () => (typeof ctx.now === 'function' ? new Date(ctx.now()) : new Date());

    function draw() {
      if (dead) return;
      const r = recipeFor(cfg, now());
      current = r;
      const key = JSON.stringify(r);
      if (key === drawn) return;          // nothing changed: the scene is not redrawn (the Pi's sake)
      drawn = key;
      let svg = '';
      // `editable` only numbers the pieces (data-i), so edit mode can choose them; Design's own grab cursor and handles
      // are left out (the room's handles are the editor, drawn by the dashboard while a piece is chosen).
      try { svg = sceneSvg(r, { assetBase: ASSET_BASE, castSvg, editable: true }).replace(/ style="cursor:grab"/g, ''); }
      catch (err) { console.error('village: draw', err); svg = ''; }
      mount.innerHTML = `<div class="vg-root mod-box" data-village="${String(cfg.scene || 'village').replace(/[^\w-]/g, '')}" data-look="${r.look}" data-time="${r.time}"`
        + ` style="height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">`
        + `${svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}`
        + `<p class="vg-said" data-vg-said aria-live="polite" style="position:absolute;left:8px;bottom:8px;margin:0;padding:4px 10px;border-radius:8px;`
        + `background:var(--surface,#fff);color:var(--text,#222);font-size:.9rem" hidden></p></div>`;
    }
    function say(text) {
      const p = mount.querySelector('[data-vg-said]');
      if (!p) return;
      p.textContent = text; p.hidden = false;
      if (saidTimer != null) clearT(saidTimer);
      saidTimer = setT(() => { saidTimer = null; const q = mount.querySelector('[data-vg-said]'); if (q) q.hidden = true; }, 4000);
    }

    // ---- editing: the panel's own scene, saved; one Undo step per change ----
    function keep(recipe, { undoable = true } = {}) {
      if (!recipe || dead) return false;
      if (undoable && current) { undo.push(ownRecipe(current)); if (undo.length > UNDO_MAX) undo.shift(); }
      cfg = { ...cfg, recipe: recipe ? ownRecipe(recipe) : null };
      draw();                             // drawn now, so the handles can sit on the new piece at once
      try { state?.set?.({ ...cfg }); } catch (err) { console.error('village: save', err); }
      return true;
    }
    const editPiece = (i, patch) => keep(withPieceEdit(current, i, patch));
    function undoOnce() {
      const prev = undo.pop();
      if (!prev) { say('Nothing to undo.'); return false; }
      return keep(prev, { undoable: false });
    }
    function putBack() {
      if (!cfg.recipe) { say('This is already the scene as it comes.'); return false; }
      if (current) { undo.push(ownRecipe(current)); if (undo.length > UNDO_MAX) undo.shift(); }
      cfg = { ...cfg, recipe: null };
      draw();
      try { state?.set?.({ ...cfg }); } catch (err) { console.error('village: save', err); }
      say('Put back as it comes.');
      return true;
    }
    async function copyDefault() {
      const sceneId = VILLAGE_SCENES[cfg.scene] ? cfg.scene : 'village';
      const text = defaultsEntry('village', [sceneId], ownRecipe(current), { made: now().toISOString().slice(0, 10) });
      try {
        const cb = ctx.clipboard || mount.ownerDocument?.defaultView?.navigator?.clipboard;
        if (!cb?.writeText) throw new Error('no clipboard');
        await cb.writeText(text);
        say('Copied: this scene, as a starting scene for the site.');
        return text;
      } catch { say('This browser would not copy it.'); return null; }
    }
    function pieceTargets() {
      const r = current;
      if (!r || !Array.isArray(r.pieces)) return [];
      const out = [];
      for (const g of mount.querySelectorAll('[data-i]')) {
        const i = Number(g.getAttribute('data-i'));
        const it = r.pieces[i];
        if (!it) continue;
        const v = pieceValues(it);
        out.push({
          id: `piece-${i}`, label: pieceName(it), el: g,
          help: `${pieceName(it)}. Drag it to move it, drag the corner square to change its size, or the round handle to turn it.`,
          fields: pieceFields(it), values: () => pieceValues(current?.pieces?.[i] || it),
          set: (patch) => { editPiece(i, patch); },
          actions: [
            { id: 'copy', label: 'Copy it', run: () => { const got = withCopy(current, i); if (got) keep(got.recipe); else say(`This scene is full (${PIECES_MAX} things).`); } },
            { id: 'remove', label: 'Take it out', run: () => { keep(withoutPiece(current, i)); } },
            { id: 'undo', label: 'Undo', run: () => { undoOnce(); } },
          ],
          // The room's handles (room_handles.js svgGeometry), drawn by the dashboard while this is chosen. x and y are the
          // foot; the size scales about it, the turn is about the centre (village_kit.js draws it so).
          handles: { el: g.parentNode, piece: { x: v.x, y: v.y, size: v.size, rotate: v.rotate, flip: !!it.flip }, floor: true, movable: true,
            geometry: 'svg', onCommit: (p) => { editPiece(i, p); } },
        });
      }
      return out;
    }
    function sceneTarget() {
      const root = mount.querySelector('.vg-root');
      if (!root) return null;
      return {
        id: 'scene', label: 'The scene', el: root, whole: true,
        help: 'The scene. Press a piece or a person to move it, or add one here.',
        fields: [...SETTINGS, { key: 'addPiece', label: 'Add a piece or a person', kind: 'choice', level: 'essential', default: '',
          options: addOptions(), note: 'it goes in the middle, to move from there' }],
        values: () => ({ ...Object.fromEntries(SETTINGS.map((f) => [f.key, cfg[f.key] ?? f.default])), addPiece: '' }),
        set: (patch) => {
          if (!patch) return;
          if (patch.addPiece) {
            const got = withNewPiece(current, patch.addPiece);
            if (!got.recipe) { say(got.why); return; }
            keep(got.recipe);
            say(`Added: ${pieceName(got.recipe.pieces[got.index])}. Press it to move it.`);
            return;
          }
          const rest = { ...patch }; delete rest.addPiece;
          if (Object.keys(rest).length) { cfg = { ...cfg, ...rest }; draw(); arm(); try { state?.set?.({ ...cfg }); } catch (err) { console.error('village: save', err); } }
        },
        actions: [
          { id: 'undo', label: 'Undo', run: () => { undoOnce(); } },
          { id: 'putBack', label: 'Put the scene back', note: 'as it comes, every change undone', run: () => { putBack(); } },
          { id: 'default', label: 'Copy as the default', note: 'this scene, ready to become a starting scene', run: () => { copyDefault(); } },
        ],
      };
    }
    function arm() {
      if (timer != null) { clearT(timer); timer = null; }
      if (dead || (cfg.time && cfg.time !== 'auto')) return;
      timer = setT(() => { timer = null; draw(); arm(); }, LIGHT_CHECK_MS);
    }
    return {
      __probe: () => ({ recipe: recipeFor(cfg, now()), drawn: !!drawn, undo: undo.length }),
      // Nearest first (edit_mode.js): every piece and person, then the scene itself.
      editTargets: () => { const s = sceneTarget(); return [...pieceTargets(), ...(s ? [s] : [])]; },
      __edit: { editPiece, undoOnce, putBack, copyDefault },
      init() {
        cfg = { ...(state?.get?.() || {}) };
        state?.subscribe?.((s) => { if (dead) return; cfg = { ...(s || {}) }; draw(); arm(); });
        draw();
        arm();
      },
      onShow() { draw(); },
      onResize() {},
      destroy() {
        dead = true;
        if (timer != null) clearT(timer); timer = null;
        if (saidTimer != null) clearT(saidTimer); saidTimer = null;
        mount.innerHTML = '';
      },
    };
  },
);
