// room_scene.js — A ROOM, BUILT FROM A JSON RECIPE, AND THE SLOTS IN IT WHERE REAL THINGS GO.
//
// Change list rows 2.33 (guide-and-rooms), 2.34 (the room is the screen) and 2.37 (room add-ons).
// The recipe schema and the rules are Claude Design's (`RoomScene.d.ts`, `RoomScene.jsx`,
// `room-is-the-screen/room.js`, `room-add-ons/README.md`); the pieces are `room_parts.js`. This file
// is the renderer: vanilla DOM, no React, one call to mount and one object back.
//
//   const scene = mountRoomScene(host, recipe, { bus, labels: 'always' });
//   scene.slots()            Map slotId -> { el, size, units, needs, fits, ... }  (the host fills el)
//   scene.notify('wake')     the lamp lights, the cat's ears perk up
//   scene.destroy()
//
// *** THE RULES IT KEEPS, EACH ONE DESIGN'S, EACH ONE TESTED (dev/room_scene_test.html). ***
//
//   1. CONTENT STAYS READABLE AT NIGHT. The lighting layer dims walls, floor and furniture only.
//      Frames, signs, the clock, the calendar and module slots draw ABOVE it, in their own layer;
//      lamp and fire glow draw above it too, blended with `screen`, so a lamp lights a dark room.
//   2. MODULE SLOTS ARE WHERE REAL MODULES MOUNT. `kind:'module'` reserves wall space; every role
//      object offers a slot inside its own shape. This file NEVER mounts a module itself: it hands
//      the host an empty element and its size (step 6 Stage R does the mounting).
//   3. DEPTH: floor things anchor at their foot and scale by 0.72 + (clamp(y,55,106) - 66)/34 × 0.5,
//      drawn back to front by `ground ?? y`, rugs first.
//   4. SIDE WALLS: a wall thing with `wall:'left'|'right'` gets `sideWallTransform()`'s matrix —
//      squashed across by 0.56, larger toward the front, sheared toward the vanishing point.
//   5. `light:'auto'` follows the real clock (day 7–17, evening 17–20, night otherwise), and
//      `view:'auto'` picks the window's live scene from the light.
//   6. MOTION is decoration and sits inside the reduced-motion guard. The clock's second hand hides
//      under reduced motion; the hour and minute hands always move, because they are information.
//
// *** AND THE PRODUCT'S OWN INVARIANT (CLAUDE.md): a screen must never enter a state that only an
// input can leave, when the person in front of it cannot give that input. *** The one state here
// that could be that is a LIFTED panel (a display object chosen, its module lifted flat over the
// room). It puts itself back after `liftReturnMs` with nobody touching it; see `lift()`.
//
// *** ROLES (room-is-the-screen §3, room-add-ons §1). *** Any object can take one:
//   button   runs an action: publishes it on the bus (see ROOM_ACTIONS) — the SAME verb the plain
//            bar's button sends, so a flower pot and a switch end in the same place
//   label    shows a flat name chip, nothing to press
//   display  shows a module inside the object's slot, and LIFTS it flat when chosen
//   keys     one of a group of objects that are keys (a wall of pictures as a keypad)
// plus, automatically, `pet` on every animal part (Mike, §7.2: "You should definitely be able to pet
// any animals."). Every role object carries a flat LABEL CHIP: an object's meaning is never only its
// picture.

import { STAGE, ROOM_SHELLS, WALL_FINISHES, FLOOR_FINISHES, FURNITURE, ROOM_LIGHTS, lightFor as partsLightFor,
  MOUNT_KINDS, MODULE_LABELS, frameSpec, buildFurniture, buildPictureFrame, buildNameSign, buildWallClock,
  buildWallCalendar, buildCat, applyStyle } from './room_parts.js';
import { mountScene } from './livescene.js';

export const W = STAGE.w;
export const H = STAGE.h;
export const lightFor = partsLightFor;

// Design: "Sizes are in grid units: 1u = 40px of the 960×540 stage."
export const GRID_UNIT = 40;
// *** THE LIFTED PANEL'S UNIT: 80 REAL PIXELS PER GRID UNIT. *** Not a setting, argued (Rule 1):
// it is a layout proportion, the kind of number a stylesheet holds. It exists so a lifted module is
// "full size" — Design's words — whatever size the room is drawn: the transport bar needs 3×1, so it
// lifts to 240×80, which keeps every button in it at 44px or more (Design's floor for a target).
// Smaller and a lifted bar's buttons fall under 44px; larger and a 3×2 module fills a phone.
export const LIFT_UNIT = 80;
// Design (room-add-ons): "the object scales up ... capped at 2.5×. Above the cap, the editor says so
// and offers 'Lift flat instead'."
export const GROW_CAP = 2.5;
// Design (room-add-ons §1): zoom on focus is settable from 1.1× to 1.5×, off by default.
export const ZOOM_RANGE = Object.freeze([1.1, 1.5]);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------------------------
// THE MATHS. Pure, exported, and unit-tested.
// ---------------------------------------------------------------------------------------------

/** Design's depth scale for a floor thing whose foot (or floor line) is at `y` percent. */
export function depthScale(y) {
  return 0.72 + (clamp(Number(y) || 0, 55, 106) - 66) / 34 * 0.5;
}

/* *** SIDE WALLS. *** Design's matrix. A wall thing on a side wall is drawn ON that wall:
   foreshortened across, sheared to follow the wall's slope at its height, and larger toward the
   front, where the wall is nearer. Its x / y are still stage percent, so nothing about storing it
   changes; the shape of the wall at that point decides the transform. Lines on a side wall run to
   the vanishing point at eye height in the middle of the back wall, so a thing at eye level sits
   nearly level and one near the floor or ceiling tilts more. */
export function sideWallTransform(shell, it) {
  const b = shell.back, side = it.wall;
  const L = b.l, R = b.r, B = b.b;
  const u = side === 'left' ? clamp(it.x / L, 0.02, 0.98) : clamp((100 - it.x) / (100 - R), 0.02, 0.98);
  const hh = 100 + u * (B - 100);
  const vpX = (L + R) / 2, vpY = B * 0.45;
  const shear = ((vpY - it.y) * H) / ((vpX - it.x) * W);
  const s = Math.min(1.45, hh / B);
  return { sx: 0.56 * s, sy: s, shear };
}

/** Which wall a stage x falls on for a shell. Dragging past a corner reassigns the wall. */
export function wallAt(shell, x) {
  const b = shell.back;
  if (shell.left && x < b.l) return 'left';
  if (shell.right && x > b.r) return 'right';
  return 'back';
}

/** What the window looks out on: a live scene key, or `auto` following the light (Design). */
export function viewFor(view, light) {
  if (view && view !== 'auto') return view;
  return light === 'night' ? 'night' : light === 'evening' ? 'fall' : 'cozy';
}

export const isFloor = (it) => (it.kind === 'furniture' ? FURNITURE[it.part]?.on === 'floor' : MOUNT_KINDS[it.kind]?.on === 'floor');
export const isContent = (it) => it.kind !== 'furniture' && it.kind !== 'cat';

/** Design's draw order, as item indexes: wall things; floor things back to front, rugs first;
    content (which goes in its own layer, above the lighting). */
export function drawOrder(items = []) {
  const all = items.map((it, i) => ({ it, i }));
  const flat = (it) => (FURNITURE[it.part]?.flat ? 1 : 0);
  return {
    wall: all.filter(({ it }) => !isFloor(it) && !isContent(it)).map(({ i }) => i),
    floor: all.filter(({ it }) => isFloor(it))
      .sort((a, c) => (flat(c.it) - flat(a.it)) || ((a.it.ground ?? a.it.y) - (c.it.ground ?? c.it.y)))
      .map(({ i }) => i),
    content: all.filter(({ it }) => isContent(it)).map(({ i }) => i),
  };
}

/** A content mount's own size, before its `scale`. A sign's depends on its words, so this is only
    an estimate for it; the renderer measures the real one. */
export function contentSize(it) {
  switch (it.kind) {
    case 'frame': {
      const width = it.width || 110;
      const spec = frameSpec(it.frame || 'classic', it.aspect || '1:1');
      return { w: width, h: spec.h * width / spec.w };
    }
    case 'module': return { w: it.w || 200, h: it.h || 124 };
    case 'clock': return { w: it.size || 92, h: it.size || 92 };
    case 'calendar': { const w = it.width || 84; return { w, h: Math.round(w * 0.819 + 16) }; }
    default: return { w: 120, h: 40 };
  }
}

/**
 * Where an item sits on the stage: its CSS (left/top as stage percent, size in stage px, transform)
 * and its VISIBLE size — what a person sees after depth, scale and a side wall's squash.
 */
export function itemBox(it, shell = ROOM_SHELLS.room) {
  const floor = isFloor(it);
  const def = it.kind === 'furniture' ? FURNITURE[it.part] : null;
  const sc = it.scale ?? 1;
  const k = sc * (floor ? depthScale(it.ground ?? it.y) : 1);
  let w, h, mk;
  if (def) { w = def.box[0] * k; h = def.box[1] * k; mk = 1; }
  else if (it.kind === 'cat') { w = h = (it.size || 110) * k; mk = 1; }
  else { const c = contentSize(it); w = c.w; h = c.h; mk = sc; }
  const side = !floor && (it.wall === 'left' || it.wall === 'right') && shell[it.wall] ? sideWallTransform(shell, it) : null;
  const f = it.flip ? -1 : 1;
  const transform = side
    ? `translate(-50%, -50%) matrix(${side.sx * mk * f}, ${side.shear * side.sx * mk * f}, 0, ${side.sy * mk}, 0, 0)`
    : `translate(-50%, ${floor ? '-100%' : '-50%'})${mk !== 1 ? ` scale(${mk})` : ''}${it.flip ? ' scaleX(-1)' : ''}`;
  const vw = side ? w * side.sx * mk : w * mk;
  const vh = side ? h * side.sy * mk : h * mk;
  const cx = (it.x / 100) * W, cy = (it.y / 100) * H;
  return {
    left: it.x, top: it.y, w, h, k, transform, origin: floor ? '50% 100%' : '50% 50%',
    floor, side, cx, anchorY: cy,
    visible: { w: vw, h: vh, left: cx - vw / 2, top: floor ? cy - vh : cy - vh / 2 },
  };
}

/** Whole grid units a size in stage px holds (Design: 1u = 40px). */
export const gridUnits = (w, h) => [Math.max(0, Math.floor(w / GRID_UNIT + 1e-6)), Math.max(0, Math.floor(h / GRID_UNIT + 1e-6))];

/**
 * *** TOO-BIG MODULE -> THE OBJECT GROWS (Mike, 2026-09-30 §7.1.4; Design, room-add-ons). ***
 * The scale that makes a slot of `w`×`h` stage px hold `needs` grid units, never below 1 and capped
 * at GROW_CAP. `capped` says it still does not fit, which is when the object lifts flat instead.
 */
export function growToFit(w, h, needs = [1, 1], cap = GROW_CAP) {
  const [nw, nh] = needs;
  const want = Math.max(nw * GRID_UNIT / Math.max(w, 1e-6), nh * GRID_UNIT / Math.max(h, 1e-6));
  if (want <= 1) return { scale: 1, capped: false };
  return want > cap ? { scale: cap, capped: true } : { scale: want * 1.0001, capped: false };
}

// *** THE ACTIONS A BUTTON OBJECT CAN RUN, and the bus topic each one publishes on. ***
// `system/…` beside actions.js's own `system/role-cycle`: these are the screen's own controls, not
// any module's. NOTHING SUBSCRIBES TO THEM YET — the kiosk's full-screen toggle and its settings menu
// are functions inside kiosk.js, not topics. The hook step 6 Stage R needs is one subscriber each
// (see the report for the lines). Until then a button's press is answered by whoever claims it
// (payload.claim()), and `onUnclaimed` lets the host do something honest with the rest.
// Any other action string that contains a '/' IS a topic: a decoration can send any verb, which is
// chat's §3.1 — "a decoration that is a control is an input device".
export const ROOM_ACTIONS = Object.freeze({
  'fullscreen.toggle': { topic: 'system/fullscreen', label: 'Full screen on/off' },
  'settings.open': { topic: 'system/settings', label: 'Settings' },
  'modules.open': { topic: 'system/modules', label: 'Modules' },
  'dashboards.open': { topic: 'system/dashboards', label: 'Dashboards' },
});
export const topicForAction = (action) => ROOM_ACTIONS[action]?.topic
  || (typeof action === 'string' && /^[a-z0-9_-]+\/[a-z0-9_./#-]+$/i.test(action) ? action : null);

// What the room itself publishes, so a host (or a test) can hear it.
export const ROOM_TOPICS = Object.freeze({
  pressed: 'room/pressed',   // { id, role, action? } — every press of a role object
  key: 'room/key',           // { id, group, key }   — a key object
  pet: 'room/pet',           // { id }               — an animal was petted
  lift: 'room/lift',         // { id, module, lifted }
});

// The scan rows, in Design's order (room-is-the-screen, "Scanning in a room"). The overlay, plain
// bar and flat bar belong to the host; the room fills the three in the middle.
export const SCAN_ROWS = Object.freeze(['overlay', 'plain', 'things', 'pictures', 'floor', 'bar']);

const ROLES = new Set(['button', 'label', 'display', 'keys', 'pet']);
const DEFAULT_SLOT = [0.05, 0.05, 0.9, 0.9];

/**
 * An item's role, read from either of Design's two shapes: room-is-the-screen's flat fields
 * (`role`, `action`, `module`, `label`, `slot`, `needs`, `reacts`) or room-add-ons' `interactive`
 * block. Returns null for an object with no role. Every animal gets `pet` unless `pet:false`.
 */
export function normalizeRole(it) {
  if (!it) return null;
  const ia = it.interactive && typeof it.interactive === 'object' ? it.interactive : null;
  let role = ROLES.has(it.role) ? it.role : null;
  let action = it.action || null;
  let module = it.module || null;
  if (!role && ia) {
    const mode = ia.module?.mode;
    const does = ia.select?.do;
    module = module || ia.module?.id || null;
    if (mode === 'keys') role = 'keys';
    else if (mode === 'holds' || mode === 'shows' || mode === 'opens') role = 'display';
    else if (does === 'action') role = 'button';
    else if (does === 'pet') role = 'pet';
    else role = 'label';
    action = action || ia.select?.action || null;
  }
  if (!role && it.kind === 'cat' && it.pet !== false) role = 'pet';
  if (!role) return null;
  const zoomRaw = Number(it.zoom ?? ia?.hover?.zoom);
  const zoom = Number.isFinite(zoomRaw) && zoomRaw > 1 ? clamp(zoomRaw, ZOOM_RANGE[0], ZOOM_RANGE[1]) : null;
  const def = it.kind === 'furniture' ? FURNITURE[it.part] : null;
  const fallbackLabel = role === 'pet' ? 'Nimrod'
    : (role === 'button' && ROOM_ACTIONS[action]?.label) || MODULE_LABELS[module] || module
      || it.key || def?.label || MOUNT_KINDS[it.kind]?.label || 'Object';
  const needs = Array.isArray(it.needs) && it.needs.length === 2 ? it.needs.map((n) => Math.max(0, Number(n) || 0)) : [1, 1];
  const slot = Array.isArray(it.slot) && it.slot.length === 4 ? it.slot.map(Number) : DEFAULT_SLOT;
  return {
    role, action, module, needs, slot, zoom,
    label: String(it.label || fallbackLabel),
    group: it.group || null, key: it.key ?? null,
    grow: it.grow !== false && !!module,
  };
}

// *** NOTIFICATIONS THROUGH OBJECTS (room-add-ons §6; room-is-the-screen §4). *** Rules are
// event -> object -> does. `object` is an item id, or a FAMILY: 'lamp' is any table or floor lamp,
// 'cat' any Nimrod, anything else a furniture part. Design's defaults, verbatim: wake -> lamp and
// cat, message -> speaker, call -> fireplace, visitor -> door. `timer` has no default object.
// *** THE ON-SCREEN CUE ALWAYS COMES TOO; objects only add to it. *** This file draws no cue —
// listening_cue.js does — and nothing here is ever the only sign that something happened.
export const NOTIFY_EVENTS = Object.freeze(['wake', 'message', 'call', 'visitor', 'timer', 'custom']);
export const DEFAULT_NOTIFY_RULES = Object.freeze([
  { on: 'wake', object: 'lamp', does: 'light' },
  { on: 'wake', object: 'cat', does: 'perk' },
  { on: 'message', object: 'speaker', does: 'pulse' },
  { on: 'call', object: 'fireplace', does: 'fire' },
  { on: 'visitor', object: 'door', does: 'open' },
]);
const REACTS_AS = { glow: 'light', light: 'light', pulse: 'pulse', perk: 'perk', fire: 'fire', open: 'open' };
const FAMILY = { lamp: ['tableLamp', 'floorLamp'] };
function matchesObject(it, object) {
  if (!object) return false;
  if (it.id === object) return true;
  if (object === 'cat') return it.kind === 'cat';
  if (it.kind !== 'furniture') return false;
  return (FAMILY[object] || [object]).includes(it.part);
}
/** Which items react to `event`, and how: [{ index, id, does }]. */
export function reactionsFor(recipe = {}, event) {
  const items = recipe.items || [];
  const rules = Array.isArray(recipe.notify) ? recipe.notify : DEFAULT_NOTIFY_RULES;
  const out = [];
  const seen = new Set();
  const add = (index, does) => {
    const d = REACTS_AS[does] || null;
    if (!d || seen.has(index + ':' + d)) return;
    seen.add(index + ':' + d);
    out.push({ index, id: items[index].id, does: d });
  };
  for (const r of rules) {
    if (r?.on !== event) continue;
    items.forEach((it, i) => { if (matchesObject(it, r.object)) add(i, r.does); });
  }
  // `reacts` on an object: it reacts to every event (room-is-the-screen §4).
  items.forEach((it, i) => { if (it.reacts) add(i, it.reacts); });
  return out;
}

/** A copy of a recipe with every default filled and every item given an id. Never mutates. */
export function normalizeRecipe(recipe = {}) {
  const r = recipe && typeof recipe === 'object' ? recipe : {};
  const used = new Set();
  const items = (Array.isArray(r.items) ? r.items : []).filter((it) => it && typeof it === 'object').map((it, i) => {
    let id = typeof it.id === 'string' && it.id ? it.id : `${it.kind || 'item'}${i}`;
    while (used.has(id)) id += '_';
    used.add(id);
    return { ...it, id, x: Number(it.x) || 0, y: Number(it.y) || 0 };
  });
  return {
    shell: ROOM_SHELLS[r.shell] ? r.shell : 'room',
    wall: { ...(r.wall || {}) },
    floor: { ...(r.floor || {}) },
    light: ['day', 'evening', 'night', 'auto'].includes(r.light) ? r.light : 'auto',
    view: typeof r.view === 'string' && r.view ? r.view : 'auto',
    notify: Array.isArray(r.notify) ? r.notify : undefined,
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// THE STYLESHEET, loaded once per page by the renderer itself.
// ---------------------------------------------------------------------------------------------
let cssPromise = null;
export function ensureRoomCss(doc = document) {
  const existing = doc.querySelector('link[data-room-css]');
  if (existing && cssPromise) return cssPromise;
  cssPromise = new Promise((resolve) => {
    let link = existing;
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./room_scene.css', import.meta.url).href;
      link.setAttribute('data-room-css', '');
      doc.head.append(link);
    }
    if (link.sheet) { resolve(true); return; }
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener('error', () => resolve(false), { once: true });
  });
  return cssPromise;
}

export const assetBase = () => new URL('./design-assets/', import.meta.url).href;

// ---------------------------------------------------------------------------------------------
// THE RENDERER
// ---------------------------------------------------------------------------------------------

// Defaults, each argued (Rule 1) and each overridable by the host:
//   labels 'always'      Design: "An object's meaning is never only its picture. It carries a flat
//                        label chip." Always is the reading of that for someone who cannot hover.
//   liftReturnMs 60000   a lifted panel goes back by itself after a minute with nobody touching it
//                        — the invariant's way out; long enough to use a transport bar, short enough
//                        that the room comes back on an unattended screen. 0 = never (a person who
//                        can always press Put it back may want that).
//   notifyMs 8000        how long an object reacts: Design's "didn't catch it" cue closes after 8 s.
//   petMs 2600           how long the happy pose lasts: about two of the sparkle's slow cycles.
export const RENDER_DEFAULTS = Object.freeze({
  labels: 'always', motion: 'gentle', liftReturnMs: 60000, notifyMs: 8000, petMs: 2600, zoom: null, showSlots: false,
});

export function mountRoomScene(host, recipeIn = {}, opts = {}) {
  if (!host) throw new Error('mountRoomScene: a host element is required');
  const doc = host.ownerDocument || document;
  const win = doc.defaultView || window;
  const o = { ...RENDER_DEFAULTS, ...opts };
  const base = o.assetBase || assetBase();
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const setT = o.setTimer || ((fn, ms) => win.setTimeout(fn, ms));
  const clearT = o.clearTimer || ((id) => win.clearTimeout(id));
  ensureRoomCss(doc);

  // Every pending timer, so destroy() can prove it left none behind.
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setT(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => { if (id != null && timers.has(id)) { timers.delete(id); clearT(id); } };

  const mq = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let systemReduced = !!mq?.matches;
  const motion = () => (o.reducedMotion || systemReduced ? 'still' : (['gentle', 'calm', 'still'].includes(o.motion) ? o.motion : 'gentle'));
  const animated = () => motion() !== 'still';

  let recipe = normalizeRecipe(recipeIn);
  let shell = ROOM_SHELLS[recipe.shell];
  let light = 'day';
  let destroyed = false;

  const root = doc.createElement('div');
  root.className = 'rs';
  root.setAttribute('data-room', '');
  const stage = doc.createElement('div');
  stage.className = 'rs-stage';
  const mk = (cls, layer) => { const d = doc.createElement('div'); d.className = `rs-layer ${cls}`; d.dataset.layer = layer; return d; };
  const roomL = mk('rs-room', 'room');
  const veilL = mk('rs-veil', 'light');
  const glowL = mk('rs-glows', 'glow');
  const contentL = mk('rs-content', 'content');
  const overL = mk('rs-over', 'over');
  stage.append(roomL, veilL, glowL, contentL, overL);
  const liftL = doc.createElement('div');
  liftL.className = 'rs-liftlayer';
  root.append(stage, liftL);
  host.append(root);

  // Per item: { it, role, el, art, slotEl, wrap, chip, button, cat, clock, cal, scene }
  let recs = [];
  let lifted = null;         // { id, panel, slotEl, home, idle }
  let focusIdx = -1;
  let reactions = [];        // live reaction elements / undo functions
  let reactTimer = null;
  let toastEl = null, toastTimer = null;
  let tickTimer = null;

  // ------------------------------------------------------------------ fitting the stage
  let scale = 1;
  function fit() {
    const r = root.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    if (!(k > 0)) return scale;
    scale = k;
    stage.style.transform = `translate(${(r.width - W * k) / 2}px, ${(r.height - H * k) / 2}px) scale(${k})`;
    return scale;
  }
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => { if (!destroyed) fit(); }) : null;
  ro?.observe(root);

  // ------------------------------------------------------------------ the room shell
  function drawShell() {
    roomL.replaceChildren();
    const b = shell.back;
    const wall = recipe.wall, floor = recipe.floor;
    const wf = WALL_FINISHES[wall.finish] || WALL_FINISHES.paint;
    const ff = FLOOR_FINISHES[floor.finish] || FLOOR_FINISHES.boards;
    const wallBg = wf.css(wall.color || wf.color), floorBg = ff.css(floor.color || ff.color);
    const div = (st, bg = true) => { const d = doc.createElement('div'); if (bg) d.dataset.bg = '1'; applyStyle(d, { position: 'absolute', ...st }); roomL.append(d); return d; };
    div({ left: b.l + '%', width: b.r - b.l + '%', top: b.t + '%', height: b.b - b.t + '%', background: wallBg }).dataset.wall = 'back';
    if (shell.left) div({ inset: 0, clipPath: shell.left, background: `linear-gradient(90deg,rgba(0,0,0,.2),rgba(0,0,0,.08)),${wallBg}` }).dataset.wall = 'left';
    if (shell.right) div({ inset: 0, clipPath: shell.right, background: `linear-gradient(270deg,rgba(0,0,0,.22),rgba(0,0,0,.1)),${wallBg}` }).dataset.wall = 'right';
    if (wall.wainscot) {
      div({ left: b.l + '%', width: b.r - b.l + '%', top: b.b - 24 + '%', height: '24%', background: `repeating-linear-gradient(90deg,rgba(0,0,0,.16) 0 2px,transparent 2px 64px),${wall.wainscot}`, borderTop: '6px solid ' + wall.wainscot, boxShadow: 'inset 0 6px 0 rgba(255,255,255,.18)' });
      if (shell.left) div({ inset: 0, clipPath: `polygon(0 ${b.b - 24}%,${b.l}% ${b.b - 24}%,${b.l}% ${b.b}%,0 100%)`, background: `linear-gradient(90deg,rgba(0,0,0,.22),rgba(0,0,0,.08)),${wall.wainscot}` });
      if (shell.right) div({ inset: 0, clipPath: `polygon(${b.r}% ${b.b - 24}%,100% ${b.b - 24}%,100% 100%,${b.r}% ${b.b}%)`, background: `linear-gradient(270deg,rgba(0,0,0,.24),rgba(0,0,0,.1)),${wall.wainscot}` });
    }
    if (shell.ceiling) {
      shell.ceiling.forEach((cp) => div({ inset: 0, clipPath: cp, background: `linear-gradient(180deg,rgba(0,0,0,.34),rgba(0,0,0,.18)),${wallBg}` }));
      div({ left: 0, right: 0, top: '3%', height: '3%', background: '#5a3c24', boxShadow: '0 4px 8px rgba(0,0,0,.3)' }, false);
    }
    const fl = div({ inset: 0, clipPath: shell.floor, overflow: 'hidden' });
    fl.dataset.floor = '1';
    // hinged at the FRONT edge and tilted away, so the pattern recedes toward the wall line
    const tilt = doc.createElement('div');
    applyStyle(tilt, { position: 'absolute', left: '-80%', right: '-80%', bottom: 0, height: '320%', background: floorBg, transform: 'perspective(520px) rotateX(66deg)', transformOrigin: '50% 100%' });
    const shade = doc.createElement('div');
    applyStyle(shade, { position: 'absolute', left: 0, right: 0, top: b.b + '%', bottom: 0, background: 'linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,0) 45%)' });
    fl.append(tilt, shade);
    div({ left: b.l + '%', width: b.r - b.l + '%', top: b.b - 2.2 + '%', height: '2.2%', background: '#efe9da', boxShadow: '0 1px 0 rgba(0,0,0,.2)' }, false);
  }

  // ------------------------------------------------------------------ items
  function placeEl(el, box) {
    applyStyle(el, { position: 'absolute', left: box.left + '%', top: box.top + '%', transform: box.transform, transformOrigin: box.origin });
  }
  function signWordsFor(it) {
    const words = typeof o.signWords === 'string' ? o.signWords.trim() : '';
    return words || it.name || 'Name';
  }
  function pictureFor(it) {
    try { const u = o.pictureFor?.(it); if (u) return u; } catch { /* fall through */ }
    return it.src || '';
  }

  function buildItem(it, i) {
    const rec = { it, i, role: normalizeRole(it) };
    const box = itemBox(it, shell);
    const el = doc.createElement('span');
    el.className = 'rs-item';
    el.dataset.item = it.kind + (it.part ? ':' + it.part : '');
    el.dataset.id = it.id;
    placeEl(el, box);
    const def = it.kind === 'furniture' ? FURNITURE[it.part] : null;
    if (def) {
      applyStyle(el, { width: box.w, height: box.h });
      if (def.view) {
        // The window: a live scene behind the frame. Design sized the view larger than the pane and
        // offset it, so the pane shows the middle of the world rather than its edge.
        const pane = doc.createElement('span');
        pane.className = 'rs-view';
        applyStyle(pane, { position: 'absolute', left: '4%', right: '4%', top: '4%', bottom: '4%', overflow: 'hidden', background: '#9fc3d6' });
        const vh = doc.createElement('span');
        applyStyle(vh, { position: 'absolute', width: box.w * 2.2, height: box.h * 1.6, left: -(box.w * 0.6), top: -(box.h * 0.3) });
        pane.append(vh);
        el.append(pane);
        rec.viewHost = vh;
        try { rec.scene = mountScene(vh, { scene: viewFor(recipe.view, light), motion: motion() }); } catch (err) { console.error('room: window view', err); }
      }
      rec.art = buildFurniture(doc, it.part, it.color || def.color);
      el.append(rec.art);
    } else if (it.kind === 'cat') {
      applyStyle(el, { width: box.w, height: box.h });
      rec.cat = buildCat(doc, { pose: it.pose || 'sleeping', size: box.w, base: `${base}nimrod-cat/`, animated });
      rec.art = rec.cat.el;
      el.append(rec.art);
    } else {
      rec.art = buildMount(it, rec);
      if (rec.art) el.append(rec.art);
    }
    rec.el = el;
    rec.box = box;
    return rec;
  }

  function buildMount(it, rec) {
    switch (it.kind) {
      case 'frame': {
        const src = pictureFor(it);
        const f = buildPictureFrame(doc, { src, alt: it.alt || '', frame: it.frame || 'classic', aspect: it.aspect || '1:1',
          width: it.width || 110, fit: it.fit || 'cover', base: `${base}frames/` });
        rec.window = f.window;
        return f.el;
      }
      case 'sign': return buildNameSign(doc, { name: signWordsFor(it), variant: it.variant || 'wood', size: it.size || 'md', color: it.color, font: it.font });
      case 'clock': { rec.clock = buildWallClock(doc, { size: it.size || 92 }); rec.clock.update(now()); return rec.clock.el; }
      case 'calendar': { rec.cal = buildWallCalendar(doc, { width: it.width || 84 }); rec.cal.update(now()); return rec.cal.el; }
      case 'module': {
        const w = it.w || 200, h = it.h || 124;
        const m = doc.createElement('span');
        m.className = 'rs-mount';
        applyStyle(m, { width: w, height: h });
        const slot = doc.createElement('div');
        slot.className = 'rs-slot';
        slot.dataset.slot = it.id;
        const card = doc.createElement('span');
        card.className = 'rs-slot-card';
        const t = doc.createElement('b'); t.textContent = MODULE_LABELS[it.module] || it.module || 'Module';
        const s = doc.createElement('small'); s.textContent = 'module slot';
        card.append(t, s);
        m.append(slot, card);
        rec.slotEl = slot;
        return m;
      }
      default: return null;
    }
  }

  // ------------------------------------------------------------------ role objects (the overlay)
  const rowOf = (it) => (it.kind === 'frame' ? 'pictures' : it.row && SCAN_ROWS.includes(it.row) ? it.row : 'things');

  function effectiveScaleFor(rec) {
    const { it, role } = rec;
    if (!role || !role.grow || role.role === 'pet') return { g: 1, capped: false };
    const b = itemBox(it, shell);
    const [, , sw, sh] = role.slot;
    return growToFit(b.visible.w * sw, b.visible.h * sh, role.needs);
  }

  function buildOverlay(rec) {
    const { it, role } = rec;
    if (!role) return;
    const box = rec.box;
    const wrap = doc.createElement('div');
    wrap.className = 'rs-obj-wrap';
    wrap.dataset.id = it.id;
    wrap.dataset.role = role.role;
    placeEl(wrap, box);
    // The art's own layout size (a sign's words decide its size; everything else is known).
    const w = rec.el.offsetWidth || box.w, h = rec.el.offsetHeight || box.h;
    applyStyle(wrap, { width: w, height: h });
    if (role.role !== 'label') {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'rs-obj';
      btn.dataset.scan = '';
      btn.dataset.row = rowOf(it);
      btn.dataset.id = it.id;
      btn.setAttribute('aria-label', role.role === 'pet' ? 'Pet Nimrod' : role.label);
      btn.addEventListener('click', () => press(it.id));
      if (role.role === 'pet') wireStroke(btn, it.id);
      wrap.append(btn);
      rec.button = btn;
    }
    if (role.role !== 'pet') {
      const [sx, sy, sw, sh] = role.slot;
      if (!rec.slotEl) {
        const slot = doc.createElement('div');
        slot.className = 'rs-slot';
        slot.dataset.slot = it.id;
        applyStyle(slot, { left: sx * 100 + '%', top: sy * 100 + '%', width: sw * 100 + '%', height: sh * 100 + '%' });
        wrap.append(slot);
        rec.slotEl = slot;
        rec.slotHome = wrap;
      }
      if (o.showSlots) {
        const line = doc.createElement('span');
        const info = slotInfo(rec);
        line.className = `rs-slotline${info.fits ? '' : ' no'}`;
        applyStyle(line, { left: sx * 100 + '%', top: sy * 100 + '%', width: sw * 100 + '%', height: sh * 100 + '%' });
        wrap.append(line);
      }
    }
    // Zoom on focus (room-add-ons §1): off unless the object or the host turns it on. It grows from
    // the foot for a floor thing and the centre for a wall thing (the transform origin already says
    // which); an instant step under reduced motion, 150 ms otherwise (the stylesheet's transition).
    const zoom = role.zoom || (Number(o.zoom) > 1 ? clamp(Number(o.zoom), ZOOM_RANGE[0], ZOOM_RANGE[1]) : null);
    if (zoom) {
      const on = () => { for (const e of [rec.el, wrap]) { e.style.setProperty('--rs-zoom', String(zoom)); e.classList.add('is-zoomed'); } };
      const off = () => { if (wrap.classList.contains('is-scan')) return; for (const e of [rec.el, wrap]) e.classList.remove('is-zoomed'); };
      wrap.addEventListener('pointerenter', on); wrap.addEventListener('pointerleave', off);
      wrap.addEventListener('focusin', on); wrap.addEventListener('focusout', off);
      rec.zoomOn = on; rec.zoomOff = off;
    }
    overL.append(wrap);
    rec.wrap = wrap;
    if (role.role !== 'pet') {
      const chip = doc.createElement('span');
      chip.className = 'rs-chip';
      chip.dataset.chipFor = it.id;
      chip.textContent = role.role === 'keys' && role.key != null && !it.label ? String(role.key) : role.label;
      applyStyle(chip, { left: box.visible.left + box.visible.w / 2, top: box.visible.top - 8 });
      overL.append(chip);
      rec.chip = chip;
    }
    if (o.showSlots && role.role !== 'pet') {
      const info = slotInfo(rec);
      const badge = doc.createElement('span');
      badge.className = 'rs-badge';
      badge.dataset.badgeFor = it.id;
      const bb = doc.createElement('b'); bb.textContent = `${info.units[0]}×${info.units[1]}`;
      const need = doc.createElement('span'); need.textContent = `${role.label} needs ${role.needs[0]}×${role.needs[1]}`;
      const verdict = doc.createElement('em');
      verdict.textContent = info.grew > 1 ? `Grew to fit: ${info.grew.toFixed(1)}×` : info.fits ? '✓ Fits' : '✗ Too small';
      badge.append(bb, need, verdict);
      applyStyle(badge, { left: box.visible.left + box.visible.w / 2, top: Math.min(H - 40, box.visible.top + box.visible.h * (role.slot[1] + role.slot[3] / 2)) });
      overL.append(badge);
    }
  }

  // Petting with a pointer: a stroke across him counts (room-add-ons §9). 30px of travel while
  // pressed on him; a plain press is a press, handled by the click.
  function wireStroke(btn, id) {
    let down = null, travelled = 0;
    btn.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; travelled = 0; });
    btn.addEventListener('pointermove', (e) => {
      if (!down) return;
      travelled += Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = { x: e.clientX, y: e.clientY };
      if (travelled >= 30) { travelled = -1e9; pet(id); }
    });
    const up = () => { down = null; };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointerleave', up); btn.addEventListener('pointercancel', up);
  }

  function slotInfo(rec) {
    const { it, role } = rec;
    if (it.kind === 'module') {
      const w = (it.w || 200) * (it.scale ?? 1), h = (it.h || 124) * (it.scale ?? 1);
      const units = gridUnits(w, h);
      const needs = Array.isArray(it.needs) ? it.needs : null;
      return { units, size: { w, h }, needs, fits: needs ? units[0] >= needs[0] && units[1] >= needs[1] : true, grew: 1, capped: false };
    }
    const b = rec.box;
    const [, , sw, sh] = role.slot;
    const w = b.visible.w * sw, h = b.visible.h * sh;
    const units = gridUnits(w, h);
    const fits = units[0] >= role.needs[0] && units[1] >= role.needs[1];
    return { units, size: { w, h }, needs: role.needs, fits, grew: rec.grew || 1, capped: !!rec.capped };
  }

  // ------------------------------------------------------------------ building everything
  function build() {
    for (const r of recs) { try { r.scene?.destroy(); } catch { /* gone */ } }
    if (lifted) putBack();
    recs = [];
    contentL.replaceChildren(); overL.replaceChildren(); glowL.replaceChildren();
    light = currentLight();
    drawShell();
    // Grow-to-fit happens BEFORE the geometry is final: an object whose bound module needs more
    // room than its slot is drawn bigger (it can be undone: remove the binding, and it shrinks back).
    const items = recipe.items.map((it) => {
      const probe = { it, role: normalizeRole(it) };
      const { scale: g, capped } = effectiveScaleFor(probe);
      return g > 1 ? { ...it, scale: (it.scale ?? 1) * g, _grew: g, _capped: capped } : it;
    });
    const order = drawOrder(items);
    const recByIndex = new Map();
    const make = (i) => { const r = buildItem(items[i], i); r.grew = items[i]._grew || 1; r.capped = !!items[i]._capped; recByIndex.set(i, r); return r; };
    for (const i of order.wall) roomL.append(make(i).el);
    for (const i of order.floor) roomL.append(make(i).el);
    for (const i of order.content) contentL.append(make(i).el);
    recs = items.map((_, i) => recByIndex.get(i));
    applyLight(true, false);
    // The overlay needs the art's measured size (a sign's), so it is built after the art is in.
    for (const r of recs) buildOverlay(r);
    focusIdx = -1;
    fit();
  }

  // ------------------------------------------------------------------ light
  function currentLight() { return lightFor(o.light && o.light !== 'recipe' ? o.light : recipe.light, now()); }
  function applyLight(force = false, views = true) {
    const next = currentLight();
    if (!force && next === light) return;
    light = next;
    root.dataset.light = light;
    const veil = ROOM_LIGHTS[light].veil;
    veilL.style.background = veil || '';
    veilL.hidden = !veil;
    // Lamp and fire glow: above the lighting, blended with `screen` (Design, rule 1). Not by day.
    glowL.querySelectorAll('.rm-glow').forEach((g) => g.remove());
    if (light !== 'day') {
      for (const r of recs) {
        const g = r.it.kind === 'furniture' ? FURNITURE[r.it.part]?.glow : null;
        if (!g) continue;
        const def = FURNITURE[r.it.part];
        const k = r.box.k;
        const cx = (r.it.x / 100) * W + (g.x / 100 - 0.5) * def.box[0] * k;
        const cy = (r.it.y / 100) * H - (1 - g.y / 100) * def.box[1] * k;
        const rad = g.r * k * (light === 'night' ? 1.3 : 1);
        const s = doc.createElement('span');
        s.className = 'rm-glow';
        s.dataset.glowFor = r.it.id;
        applyStyle(s, { position: 'absolute', left: cx - rad, top: cy - rad, width: rad * 2, height: rad * 2, borderRadius: '50%',
          background: `radial-gradient(circle,${g.c},transparent 70%)`, mixBlendMode: 'screen', pointerEvents: 'none' });
        glowL.prepend(s);
      }
    }
    const view = viewFor(recipe.view, light);
    if (views) for (const r of recs) if (r.scene) { try { r.scene.set({ scene: view, motion: motion() }); } catch { /* keep the old view */ } }
  }

  function applyMotion() {
    root.dataset.motion = motion();
    for (const r of recs) {
      if (r.scene) { try { r.scene.set({ motion: motion() }); } catch { /* keep */ } }
      r.cat?.refresh();
    }
  }
  const onMq = (e) => { systemReduced = !!e.matches; applyMotion(); scheduleTick(); };
  mq?.addEventListener?.('change', onMq);

  // ------------------------------------------------------------------ the clock tick
  // ONE timer for the whole room. Once a second only while a clock's second hand is showing (it is
  // hidden under reduced motion); otherwise every 20 s, which keeps the minute hand, the calendar
  // and `light:'auto'` honest at a twentieth of the cost.
  function tickMs() {
    const secondHand = animated() && recs.some((r) => r.clock);
    return secondHand ? 1000 : 20000;
  }
  function tick() {
    tickTimer = null;
    if (destroyed) return;
    const d = now();
    for (const r of recs) { r.clock?.update(d); r.cal?.update(d); }
    applyLight();
    scheduleTick();
  }
  function scheduleTick() {
    cancel(tickTimer);
    if (destroyed) return;
    tickTimer = later(tick, tickMs());
  }

  // ------------------------------------------------------------------ pressing
  const recOf = (id) => recs.find((r) => r.it.id === id) || null;
  const publish = (topic, payload) => { try { o.bus?.publish?.(topic, payload); } catch (err) { console.error('room: publish', topic, err); } };

  function flashPressed(rec) {
    if (!rec.button) return;
    rec.button.classList.add('is-pressed');
    later(() => rec.button?.classList.remove('is-pressed'), 180);
  }

  /** Press a role object, exactly as a click on it does. Returns what happened. */
  function press(id) {
    const rec = recOf(id);
    if (!rec || !rec.role || destroyed) return null;
    const { role, it } = rec;
    flashPressed(rec);
    publish(ROOM_TOPICS.pressed, { id: it.id, role: role.role, action: role.action || null });
    switch (role.role) {
      case 'button': {
        const topic = topicForAction(role.action);
        let claimed = false;
        if (topic) publish(topic, { action: role.action, source: 'room', objectId: it.id, claim: () => { claimed = true; } });
        if (!claimed) { try { o.onUnclaimed?.(role.action, { id: it.id, topic, api }); } catch (err) { console.error('room: onUnclaimed', err); } }
        return { did: 'action', action: role.action, topic, claimed };
      }
      case 'display': lift(it.id); return { did: 'lift' };
      case 'keys': publish(ROOM_TOPICS.key, { id: it.id, group: role.group, key: role.key }); return { did: 'key', key: role.key };
      case 'pet': pet(it.id); return { did: 'pet' };
      default: return { did: 'nothing' };
    }
  }

  // ------------------------------------------------------------------ petting
  let petTimer = null;
  function catRestPose(rec) { return rec.perked ? 'idle' : (rec.it.pose || 'sleeping'); }
  function pet(id) {
    const rec = recOf(id);
    if (!rec?.cat) return false;
    rec.petting = true;
    rec.cat.setPose('happy');
    publish(ROOM_TOPICS.pet, { id });
    cancel(petTimer);
    petTimer = later(() => { rec.petting = false; rec.cat?.setPose(catRestPose(rec)); }, o.petMs);
    return true;
  }

  // ------------------------------------------------------------------ lifting a display flat
  function lift(id) {
    const rec = recOf(id);
    if (!rec?.slotEl || destroyed) return false;
    if (lifted) putBack();
    const panel = doc.createElement('div');
    panel.className = 'rs-lift';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', rec.role?.label || 'Lifted');
    panel.dataset.liftFor = id;
    const head = doc.createElement('div');
    head.className = 'rs-lift-head';
    // THE WAY OUT FIRST (Design): in the DOM, in the tab order and in the scan.
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'rs-lift-back';
    back.dataset.scan = '';
    back.dataset.row = 'overlay';
    back.textContent = 'Put it back';
    back.addEventListener('click', () => putBack());
    const title = doc.createElement('h3');
    title.className = 'rs-lift-title';
    title.textContent = rec.role?.label || '';
    head.append(back, title);
    const body = doc.createElement('div');
    body.className = 'rs-lift-body';
    const needs = rec.role?.needs || [3, 1];
    applyStyle(body, { width: Math.max(1, needs[0]) * LIFT_UNIT, height: Math.max(1, needs[1]) * LIFT_UNIT });
    const home = rec.slotEl.parentNode;
    const next = rec.slotEl.nextSibling;
    rec.slotEl.dataset.empty = rec.role?.label || '';
    body.append(rec.slotEl);
    panel.append(head, body);
    liftL.append(panel);
    lifted = { id, panel, slotEl: rec.slotEl, home, next, idle: null };
    // THE INVARIANT'S WAY OUT: nobody touching it for liftReturnMs puts it back by itself.
    const arm = () => { cancel(lifted?.idle); if (lifted && o.liftReturnMs > 0) lifted.idle = later(() => putBack(), o.liftReturnMs); };
    for (const ev of ['pointerdown', 'keydown', 'focusin', 'wheel']) panel.addEventListener(ev, arm);
    lifted.arm = arm;
    arm();
    focusIdx = -1;
    publish(ROOM_TOPICS.lift, { id, module: rec.role?.module || null, lifted: true });
    try { o.onLift?.({ id, el: rec.slotEl, lifted: true }); } catch (err) { console.error('room: onLift', err); }
    paintScan();
    return true;
  }
  function putBack() {
    if (!lifted) return false;
    const { id, panel, slotEl, home, next } = lifted;
    cancel(lifted.idle);
    lifted = null;
    delete slotEl.dataset.empty;
    if (home) home.insertBefore(slotEl, next && next.parentNode === home ? next : null);
    panel.remove();
    focusIdx = -1;
    publish(ROOM_TOPICS.lift, { id, module: recOf(id)?.role?.module || null, lifted: false });
    try { o.onLift?.({ id, el: slotEl, lifted: false }); } catch (err) { console.error('room: onLift', err); }
    paintScan();
    return true;
  }

  // ------------------------------------------------------------------ scanning
  /** The things a switch walks, in Design's order. A lifted panel takes over, its way out first. */
  function scanTargets() {
    if (lifted) return [...lifted.panel.querySelectorAll('[data-scan]')];
    // Row by row in Design's order; inside a row, left to right (a wall of pictures reads like a
    // page: top row first, then left to right).
    const btns = recs.filter((r) => r.button);
    btns.sort((a, c) => (SCAN_ROWS.indexOf(a.button.dataset.row) - SCAN_ROWS.indexOf(c.button.dataset.row))
      || (a.button.dataset.row === 'pictures' ? Math.round(a.it.y) - Math.round(c.it.y) : 0)
      || (a.it.x - c.it.x));
    return btns.map((r) => r.button);
  }
  function paintScan() {
    root.querySelectorAll('.is-scan').forEach((e) => e.classList.remove('is-scan'));
    for (const r of recs) if (r.zoomOff && r.wrap && !r.wrap.matches(':hover')) r.zoomOff();
    const list = scanTargets();
    if (focusIdx < 0 || !list.length) return null;
    focusIdx %= list.length;
    const t = list[focusIdx];
    const wrap = t.closest('.rs-obj-wrap');
    (wrap || t).classList.add('is-scan');
    if (wrap) recOf(wrap.dataset.id)?.zoomOn?.();
    return t;
  }
  function focusStep(d) {
    const list = scanTargets();
    if (!list.length) return null;
    focusIdx = focusIdx < 0 ? (d > 0 ? 0 : list.length - 1) : (focusIdx + d + list.length) % list.length;
    lifted?.arm?.();
    return paintScan();
  }
  function select() {
    const list = scanTargets();
    if (focusIdx < 0 || !list.length) return false;
    list[focusIdx % list.length].click();
    return true;
  }

  // ------------------------------------------------------------------ notifications
  function clearReactions() {
    cancel(reactTimer); reactTimer = null;
    for (const undo of reactions) { try { undo(); } catch { /* gone */ } }
    reactions = [];
  }
  function notify(event, { ms = o.notifyMs } = {}) {
    if (destroyed) return [];
    clearReactions();
    const list = reactionsFor(recipe, event);
    for (const { index, does } of list) {
      const rec = recs[index];
      if (!rec) continue;
      const b = rec.box;
      const cxp = b.visible.left + b.visible.w / 2;
      if (does === 'light' || does === 'fire') {
        const def = rec.it.kind === 'furniture' ? FURNITURE[rec.it.part] : null;
        const g = def?.glow || { x: 50, y: 30, r: 150 };
        const k = b.k || 1;
        const cx = def ? (rec.it.x / 100) * W + (g.x / 100 - 0.5) * def.box[0] * k : cxp;
        const cy = def ? (rec.it.y / 100) * H - (1 - g.y / 100) * def.box[1] * k : b.visible.top;
        const rad = Math.max(120, g.r * k * 1.15);
        const s = doc.createElement('span');
        s.className = `rs-react-glow${does === 'fire' ? ' fire' : ''}`;
        s.dataset.reactFor = rec.it.id;
        applyStyle(s, { left: cx - rad, top: cy - rad, width: rad * 2, height: rad * 2 });
        glowL.append(s);
        reactions.push(() => s.remove());
      } else if (does === 'pulse') {
        const s = doc.createElement('span');
        s.className = 'rs-react-ring';
        s.dataset.reactFor = rec.it.id;
        applyStyle(s, { left: cxp - 40, top: b.visible.top + b.visible.h * 0.62 - 40 });
        overL.append(s);
        reactions.push(() => s.remove());
      } else if (does === 'perk' && rec.cat) {
        rec.perked = true;
        if (!rec.petting) rec.cat.setPose('idle');
        reactions.push(() => { rec.perked = false; if (!rec.petting) rec.cat?.setPose(catRestPose(rec)); });
      } else if (does === 'open') {
        rec.el.classList.add('rs-open');
        reactions.push(() => rec.el.classList.remove('rs-open'));
      } else continue;
      rec.el.dataset.react = does;
      reactions.push(() => { delete rec.el.dataset.react; });
    }
    if (ms > 0 && reactions.length) reactTimer = later(clearReactions, ms);
    return list;
  }

  // ------------------------------------------------------------------ a moment's note
  function toast(text, ms = 4000) {
    cancel(toastTimer);
    toastEl?.remove();
    toastEl = doc.createElement('div');
    toastEl.className = 'rs-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.textContent = String(text || '');
    liftL.append(toastEl);
    toastTimer = later(() => { toastEl?.remove(); toastEl = null; }, ms);
    return toastEl;
  }

  // ------------------------------------------------------------------ the slots, for the host
  function slots() {
    const map = new Map();
    for (const r of recs) {
      if (!r.slotEl) continue;
      const info = slotInfo(r);
      map.set(r.it.id, {
        id: r.it.id,
        kind: r.it.kind === 'module' ? 'module' : r.role?.role || 'module',
        module: r.it.module || r.role?.module || null,
        el: r.slotEl,
        item: r.it,
        size: info.size, units: info.units, needs: info.needs, fits: info.fits, grew: info.grew,
        side: !!r.box.side,
        rect: { ...r.box.visible },
        layer: r.it.kind === 'module' ? 'content' : 'over',
      });
    }
    return map;
  }

  // ------------------------------------------------------------------ the API
  const api = {
    root, stage,
    get light() { return light; },
    get scale() { return scale; },
    recipe: () => recipe,
    slots,
    press, pet, lift, putBack,
    lifted: () => (lifted ? lifted.id : null),
    notify, clearReactions,
    reactions: () => reactions.length,
    scanTargets,
    focusNext: () => focusStep(1),
    focusPrev: () => focusStep(-1),
    focused: () => { const l = scanTargets(); return focusIdx < 0 || !l.length ? null : l[focusIdx % l.length]; },
    select,
    back: () => (lifted ? putBack() : false),
    toast,
    fit,
    timers: () => timers.size,
    setRecipe(next) { recipe = normalizeRecipe(next); shell = ROOM_SHELLS[recipe.shell]; build(); scheduleTick(); },
    setOptions(next = {}) {
      const rebuild = ['showSlots', 'signWords', 'zoom', 'pictureFor', 'assetBase'].some((k) => k in next && next[k] !== o[k]);
      Object.assign(o, next);
      root.dataset.labels = o.labels === 'pointed' ? 'pointed' : 'always';
      if (rebuild) build();
      applyMotion();
      applyLight(true);
      scheduleTick();
    },
    destroy() {
      if (destroyed) return;
      putBack();
      clearReactions();
      destroyed = true;
      for (const id of [...timers]) cancel(id);
      mq?.removeEventListener?.('change', onMq);
      ro?.disconnect();
      for (const r of recs) { try { r.scene?.destroy(); } catch { /* gone */ } }
      recs = [];
      root.remove();
    },
  };

  root.dataset.labels = o.labels === 'pointed' ? 'pointed' : 'always';
  root.dataset.motion = motion();
  build();
  scheduleTick();
  return api;
}
