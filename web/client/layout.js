// layout.js — how a screen is ARRANGED. The one thing the composer and the kiosk must
// agree on, so it lives in neither of them.
//
// A layout is a preset plus a slot assignment:
//
//     { preset: 'quad', slots: ['<moduleId>', '<moduleId>', null, '<moduleId>'] }
//
// Slots hold MODULE INSTANCE IDs, not types, because one screen can hold two of the same
// module (two photo panels pointed at different folders) and they must stay distinct.
// A null slot renders empty — a half-built arrangement is a normal state to be in, not an
// error, and the composer should never refuse to save one.
//
// The kiosk falls back to its original one-module-at-a-time stage when a profile has no
// layout, so every screen that existed before this file keeps working untouched.

export const PRESETS = [
  { id: 'full',  label: 'Full screen', slots: 1, cols: '1fr',     rows: '1fr' },
  { id: 'side',  label: 'Side by side', slots: 2, cols: '1fr 1fr', rows: '1fr' },
  { id: 'stack', label: 'Stacked',      slots: 2, cols: '1fr',     rows: '1fr 1fr' },
  { id: 'quad',  label: 'Four up',      slots: 4, cols: '1fr 1fr', rows: '1fr 1fr' },
  { id: 'main',  label: 'Main + two',   slots: 3, cols: '2fr 1fr', rows: '1fr 1fr',
    // slot 0 spans both rows of the left column; 1 and 2 stack on the right.
    areas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
  // *** MORE WAYS TO ARRANGE A DASHBOARD (Mike, 2026-10-02: "an easy way to change the layout of any
  // dashboard. Probably more choices for layouts"). *** The four he named, and no more, argued:
  //   three   Three across: three things of equal weight side by side (a clock, the weather, photos) --
  //           the one arrangement of three that `main` cannot make, because `main` always favours one.
  //   twoone  Two over one: two small things above a wide one (two games over a video).
  //   onethree One over three: the wide thing first (the photos), three small ones under it.
  //   strip   Big + side strip: one large panel and three small ones stacked beside it -- the TV layout,
  //           a picture with a column of controls.
  // AGAINST MORE (six up, a 3x3): every preset is a stop in the menu's Layout list and a button in the
  // composer, and a sixth or ninth of a 10-inch tablet is too small to read across a room; free placement
  // (the editor) is there for anything the grid cannot do. AGAINST FEWER: the three-panel and four-panel
  // shapes people ask for were not makeable at all -- `quad` and `main` were the only multi-panel answers.
  // Areas are grid-area shorthand: row-start / column-start / row-end / column-end.
  { id: 'three', label: 'Three across', slots: 3, cols: '1fr 1fr 1fr', rows: '1fr' },
  { id: 'twoone', label: 'Two over one', slots: 3, cols: '1fr 1fr', rows: '1fr 1fr',
    areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'] },
  { id: 'onethree', label: 'One over three', slots: 4, cols: '1fr 1fr 1fr', rows: '2fr 1fr',
    areas: ['1 / 1 / 2 / 4', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3', '2 / 3 / 3 / 4'] },
  { id: 'strip', label: 'Big + side strip', slots: 4, cols: '3fr 1fr', rows: '1fr 1fr 1fr',
    areas: ['1 / 1 / 4 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3', '3 / 2 / 4 / 3'] },
];

export const DEFAULT_PRESET = 'full';

export function preset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS.find((p) => p.id === DEFAULT_PRESET);
}

export function slotCount(id) { return preset(id).slots; }

// Bring any stored layout into a shape the renderer can trust:
//   * an unknown preset falls back to the default rather than blanking the screen;
//   * the slot list is padded/truncated to the preset's slot count;
//   * a module that has since been REMOVED from the profile is dropped (its id no longer
//     resolves, and rendering a dangling reference is how a kiosk ends up blank);
//   * a module appearing twice keeps only its first slot — one instance cannot be mounted
//     into two places at once.
export function normalizeLayout(layout, validIds = []) {
  const valid = new Set(validIds);
  const p = preset(layout && layout.preset);
  const seen = new Set();
  const slots = [];
  const raw = Array.isArray(layout && layout.slots) ? layout.slots : [];
  for (let i = 0; i < p.slots; i++) {
    const id = raw[i];
    if (id && valid.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
    else slots.push(null);
  }
  const out = { preset: p.id, slots };
  // STAGE R (2026-09-30): the second placement kind and the scene, kept ONLY when present, so a
  // layout without them is byte-for-byte what it always was (every saved screen, every signature the
  // 09-12 watch compares, every suite that deep-compares a layout).
  const placed = normalizePlaced(layout && layout.placed, valid, seen);
  if (placed.length) out.placed = placed;
  const scene = normalizeScene(layout && layout.scene);
  if (scene) out.scene = scene;
  return out;
}

// Has anyone actually arranged anything? An all-empty layout is treated as "no layout",
// so saving a preset and then walking away doesn't leave a blank kiosk.
// STAGE R: a module PLACED freely counts, so a screen whose only modules are placed in the scene is
// a real layout -- before this it resolved to "no layout" and fell back to the one-at-a-time stage.
export function isArranged(layout) {
  if (!layout) return false;
  if (Array.isArray(layout.slots) && layout.slots.some(Boolean)) return true;
  return Array.isArray(layout.placed) && layout.placed.some((p) => p && p.id);
}

// =====================================================================================================
// *** FREE PLACEMENT (step 6 Stage R, Mike 2026-09-30: "free placement is back"). ***
//
// Beside the snapped grid, a layout may carry `placed`: modules placed freely, each with a PLACE --
//
//   { id, place: 'scene' | 'screen' | 'overlay', x, y, w?, h?, scale?, rot?, layer?, surface?, slot?,
//     shown?, locked?, opens? }      (`opens`: another dashboard's id -- pressing this one shows it, row 2.38)
//
//   scene    in the dashboard's scene (the room): in one of the room's slots (`slot`, a recipe item's
//            id), or at x/y on a surface (`surface`: back / left / right wall, floor).
//   screen   flat, above the scene and the grid, below overlays.
//   overlay  pinned above everything but the bar and the menus (Design: "it takes the scan first").
//
// x/y are the CENTRE, in percent of the dashboard (Design's stage percent); w/h are percent too;
// `scale` is percent (100 = as drawn); `rot` degrees, wrapped into [-180, 180); `layer` orders things
// WITHIN their place. The same ranges `edit_model.js` edits with (EDIT_DEFAULTS.limits), so a value the
// edit windows produce is never clamped differently here.
//
// And optionally `scene`: `{ kind: 'room', preset?, recipe? }` (Design's model, room-is-the-screen §1:
// `{ kind: 'room', recipe } | { kind: 'ground', theme } | { kind: 'plain' }`).
//
// *** ONE PLACE PER INSTANCE. *** A module in a slot is not also placed (the slot wins, because it was
// the older decision), and one placed twice keeps its first entry -- the same rule the slots follow.

export const PLACES = Object.freeze(['scene', 'screen', 'overlay']);
export const PLACE_SURFACES = Object.freeze(['back', 'left', 'right', 'floor']);

// *** EVERY NUMBER HERE IS A DEFAULT, NOT A RULE (Rule 1). *** Applied at render time only, never
// written into a saved layout, so changing one later changes every screen that did not choose. x/y 50
// and scale 100, rot 0, layer 0 are edit_model.js's own defaults. w/h 30 is Code's: big enough to read
// a panel on a TV across a room, small enough that a newly placed module does not cover the screen.
// On Mike's list.
export const PLACED_DEFAULTS = Object.freeze({
  x: 50, y: 50, w: 30, h: 30, scale: 100, rot: 0, layer: 0, surface: 'back',
});

const LIMITS = { x: [0, 100], y: [0, 100], w: [1, 100], h: [1, 100], scale: [10, 400], layer: [0, 99] };
const round1 = (v) => Math.round(v * 10) / 10;
function num(key, v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (key === 'rot') return round1((((n + 180) % 360) + 360) % 360 - 180);
  const [lo, hi] = LIMITS[key];
  return key === 'layer' ? Math.max(lo, Math.min(hi, Math.round(n))) : round1(Math.max(lo, Math.min(hi, n)));
}

/** One placed entry, with only the keys it may carry; null if it has no id. Ids are not checked here. */
export function normalizePlacedEntry(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const e = { id: String(raw.id), place: PLACES.includes(raw.place) ? raw.place : 'screen' };
  for (const k of ['x', 'y', 'w', 'h', 'scale', 'rot', 'layer']) {
    const v = num(k, raw[k]);
    if (v !== undefined) e[k] = v;
  }
  if (PLACE_SURFACES.includes(raw.surface)) e.surface = raw.surface;
  if (typeof raw.slot === 'string' && raw.slot) e.slot = raw.slot;
  if (raw.shown === false) e.shown = false;
  if (raw.locked === true) e.locked = true;
  // ROW 2.38: a placed module can be a DOOR -- pressing it shows another dashboard (`opens`: its id).
  // Kept as data on the placement, not on the module's own settings: what pressing a thing does HERE is
  // the layout's, the way where it sits is (the map editor edits layouts).
  const opens = typeof raw.opens === 'string' ? raw.opens.trim() : '';
  if (opens && opens.length <= OPENS_MAX) e.opens = opens;
  return e;
}
// An id, not prose: long enough for any id the server makes, short enough that junk is dropped.
export const OPENS_MAX = 200;

/** The placed list, against the ids that exist; `taken` is the slots' ids (the slot wins). */
export function normalizePlaced(list, validIds = null, taken = new Set()) {
  if (!Array.isArray(list)) return [];
  const valid = validIds instanceof Set ? validIds : validIds ? new Set(validIds) : null;
  const seen = new Set(taken);
  const out = [];
  for (const raw of list) {
    const e = normalizePlacedEntry(raw);
    if (!e || seen.has(e.id) || (valid && !valid.has(e.id))) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** The dashboard's scene, or null for "none" (today's screen: the theme's own backdrop). */
export function normalizeScene(scene) {
  if (!scene || typeof scene !== 'object') return null;
  if (scene.kind === 'room') {
    const s = { kind: 'room' };
    if (typeof scene.preset === 'string' && scene.preset) s.preset = scene.preset;
    if (scene.recipe && typeof scene.recipe === 'object') s.recipe = JSON.parse(JSON.stringify(scene.recipe));
    return s;
  }
  // 2026-10-02: the 3D room (room3d.js), on the same terms as the room -- a preset or its own recipe --
  // plus the one option it has that a person sets per dashboard: whether its camera drifts (off unless
  // 'on'; room3d.js argues why). Nothing else rides along.
  if (scene.kind === 'room3d') {
    const s = { kind: 'room3d' };
    if (typeof scene.preset === 'string' && scene.preset) s.preset = scene.preset;
    if (scene.recipe && typeof scene.recipe === 'object') s.recipe = JSON.parse(JSON.stringify(scene.recipe));
    if (scene.options && scene.options.drift === 'on') s.options = { drift: 'on' };
    return s;
  }
  if (scene.kind === 'plain') return { kind: 'plain' };
  if (scene.kind === 'ground') return typeof scene.theme === 'string' ? { kind: 'ground', theme: scene.theme } : { kind: 'ground' };
  return null;
}

/** A placed entry with every default filled, for drawing. Nothing here is ever saved. */
export function placedGeometry(entry) {
  const e = entry || {};
  const g = { ...PLACED_DEFAULTS };
  for (const k of ['x', 'y', 'w', 'h', 'scale', 'rot', 'layer']) if (typeof e[k] === 'number') g[k] = e[k];
  if (PLACE_SURFACES.includes(e.surface)) g.surface = e.surface;
  return g;
}

/**
 * *** WHICH KIND OF CHANGE IS THIS -- AND SO, CAN IT BE APPLIED IN PLACE? ***
 *
 * The 09-12 stale-layout watch (kiosk.js) reloads the screen whenever the saved layout differs from
 * the one it booted with. With free placement, every saved drag, typed X or snap would be such a
 * difference -- the screen would reload under somebody's finger on every move (the step 6 plan's
 * third breaker). So:
 *
 *   'none'       the same layout.
 *   'placement'  only `placed` differs (a module moved, changed place, was added or removed from the
 *                free placement), and the screen stays arranged: applied IN PLACE (arrangement.js
 *                `applyPlaced`) -- the moved module moves, nothing else is touched, nothing reloads.
 *   'grid'       anything else: the preset, the slots, the scene, or the screen going from arranged to
 *                the one-at-a-time stage (or back). Today's behaviour, whatever the caller did before.
 *
 * Compared on the RAW saved values, the same way the watch always compared them, so 'none' is exactly
 * "the two JSON strings are equal" and no Stage 0 check can tell the difference.
 */
export function layoutChange(before, after) {
  const a = before || null, b = after || null;
  if (JSON.stringify(a) === JSON.stringify(b)) return 'none';
  if (isArranged(a) !== isArranged(b)) return 'grid';
  const { placed: pa, ...ra } = a || {};
  const { placed: pb, ...rb } = b || {};
  if (JSON.stringify(ra) !== JSON.stringify(rb)) return 'grid';
  return 'placement';
}

// The CSS a renderer needs for the container and each slot. Kept here so the composer's
// little preview and the real kiosk cannot drift apart.
export function gridStyle(presetId) {
  const p = preset(presetId);
  return `display:grid;grid-template-columns:${p.cols};grid-template-rows:${p.rows};`;
}

export function slotStyle(presetId, i) {
  const p = preset(presetId);
  return p.areas && p.areas[i] ? `grid-area:${p.areas[i]};` : '';
}

/**
 * *** RESOLVE A SAVED LAYOUT AGAINST THE MODULES THAT ACTUALLY EXIST — AND REPAIR ORPHANS. ***
 *
 * `normalizeLayout` correctly nulls a slot whose module id is gone; it cannot render something
 * that is not there. What it could not know is that downstream, a null slot is skipped
 * silently AND the fallback stage is switched off whenever a layout exists at all. So a module
 * that was still in the profile, but whose slot had been orphaned, rendered NOWHERE — not in
 * its slot, not on the stage.
 *
 * Reported off the live site three ways at once: a Photos panel missing from an arranged
 * screen, an arrangement "not being what renders", and a screen announcing *"This screen's
 * panels were removed"* while its panel sat in the profile, un-removed.
 *
 * Two repairs, and both are repairs rather than preferences:
 *
 *   1. **An orphaned slot gets an unplaced module**, if one is going spare. ONLY slots that
 *      held something and lost it — an intentionally empty slot stays empty, because "three
 *      panels and a gap" is an arrangement somebody may have meant. This fixes corruption
 *      without overriding intent. Camera and clock are never treated as spare: an unplaced one
 *      of those is a HUD overlay by design, not a panel waiting for a home.
 *   2. **An arrangement that resolves to nothing is not an arrangement.** Returning null hands
 *      the caller back to its own no-layout path, which renders the modules that do exist.
 *
 * Lives here rather than in the kiosk because two callers already resolve layouts — the kiosk
 * at boot and again on a screen swap — and a third (`view.js`) renders them. One copy.
 */
export function resolveLayout(saved, modules = []) {
  if (!isArranged(saved)) return null;
  const l = normalizeLayout(saved, modules.map((m) => m.id));
  const rawSlots = Array.isArray(saved && saved.slots) ? saved.slots : [];
  // Stage R: a module placed freely is placed, so it is never "spare" for an orphaned slot.
  const placed = new Set([...l.slots.filter(Boolean), ...(l.placed || []).map((p) => p.id)]);
  const spare = modules.filter((m) => !placed.has(m.id)
    && m.type !== 'camera' && m.type !== 'clock');
  for (let i = 0; i < l.slots.length && spare.length; i++) {
    if (!l.slots[i] && rawSlots[i]) l.slots[i] = spare.shift().id;
  }
  return l.slots.some(Boolean) || (l.placed && l.placed.length) ? l : null;
}

/**
 * *** A SAVED LAYOUT WITH ANOTHER PRESET (the menu's Layout list, 2026-10-02). ***
 *
 * The panels keep their places, in order: slot 0 stays slot 0, and so on. A preset with MORE slots is
 * filled from the modules on this screen that no slot or free placement holds (never the camera or the
 * clock -- unplaced, those are the HUD, `resolveLayout`'s own rule). A preset with FEWER slots keeps the
 * extra ids in the saved list: they render nowhere (`normalizeLayout` reads only the preset's count, and
 * the bar still offers them as unplaced chips), and switching back to a bigger preset puts them back
 * where they were -- so trying a layout costs nothing. Anything else on the layout (`placed`, `scene`)
 * is kept as it was. Pure: returns a new layout, writes nothing.
 */
// `spareOk(module)`: the host's say on which spare modules may fill a slot (the kiosk leaves out an
// ambient module, which is scenery, not a panel). Absent: every module but the camera and the clock.
export function withPreset(saved, presetId, modules = [], { spareOk = null } = {}) {
  const p = preset(presetId);
  const valid = new Set((modules || []).map((m) => m && m.id).filter(Boolean));
  const base = saved && typeof saved === 'object' ? { ...saved } : {};
  const free = new Set((Array.isArray(base.placed) ? base.placed : []).map((e) => e && e.id).filter(Boolean));
  const seen = new Set();
  const slots = [];
  for (const id of Array.isArray(base.slots) ? base.slots : []) {
    if (id && valid.has(id) && !seen.has(id) && !free.has(id)) { seen.add(id); slots.push(id); }
    else slots.push(null);
  }
  const spare = (modules || []).filter((m) => m && m.id && !seen.has(m.id) && !free.has(m.id)
    && m.type !== 'camera' && m.type !== 'clock'
    && (typeof spareOk !== 'function' || (() => { try { return spareOk(m) !== false; } catch { return true; } })()));
  for (let i = 0; i < p.slots && spare.length; i += 1) {
    if (i >= slots.length) slots.push(null);
    if (!slots[i]) { const m = spare.shift(); slots[i] = m.id; seen.add(m.id); }
  }
  while (slots.length < p.slots) slots.push(null);
  // Trailing empties beyond the preset carry nothing worth keeping.
  while (slots.length > p.slots && !slots[slots.length - 1]) slots.pop();
  return { ...base, preset: p.id, slots };
}

// Which modules are placed, and which are left over — the composer shows both.
// (Placed in a slot OR placed freely: both are "on the screen".)
export function placement(layout, modules = []) {
  const l = normalizeLayout(layout, modules.map((m) => m.id));
  const placed = new Set([...l.slots.filter(Boolean), ...(l.placed || []).map((p) => p.id)]);
  return { layout: l, unplaced: modules.filter((m) => !placed.has(m.id)) };
}
