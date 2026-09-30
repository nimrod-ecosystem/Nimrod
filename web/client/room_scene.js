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
//
// *** THE SECOND PASS (row 2.37 items 4, 6, 7, 11, 13; room-add-ons §1, §4, §5, §8, §9). ***
//   library  a bookshelf whose BOOKS ARE MODULES: press a book and that module opens (the same
//            `system/module` verb anything else would send; see MODULE_TOPIC). The shelf itself lifts
//            a flat list of its books, so a switch walks shelf -> books, Back first.
//   closeup  a desk, sofa, armchair or bed: pressing it zooms the room into that area. BACK is the first
//            thing in the scan, `back()` leaves it, and it returns by itself after `closeupReturnMs`.
//   the window  can carry the WEATHER in a pane (from `weather/now`, weather_icons.js pictures), an
//            AI VISIT in another (`visit()`), and be a button that opens the weather.
//   pet      now ANY item with `pet` (not only the cat): a hop that honours reduced motion, a mark that
//            shows either way, and an optional sound the host plays (`onSound(name, { event:'pet' })`).
// These are OPTIONS ON THE EXISTING PIECES (`applyRoomOptions`), not new kinds of thing: a room recipe
// with none of them set draws exactly as before.

import { STAGE, ROOM_SHELLS, WALL_FINISHES, FLOOR_FINISHES, FURNITURE, ROOM_LIGHTS, lightFor as partsLightFor,
  MOUNT_KINDS, MODULE_LABELS, frameSpec, buildFurniture, buildPictureFrame, buildNameSign, buildWallClock,
  buildWallCalendar, buildCat, applyStyle } from './room_parts.js';
import { mountScene } from './livescene.js';
import { iconSvg } from './weather_icons.js';
import { getManifest } from './module.js';

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

// *** OPEN ONE MODULE, BY TYPE: action `module.open`, topic `system/module` { module, claim }. *** A book,
// or the window's weather. The kiosk answers it with its own `arr.showModule(type)` — exactly what
// pressing that panel's chip does — and claims it only when this screen HAS that module, so a book for a
// module the screen lacks is answered honestly by the room. NOT in ROOM_ACTIONS on purpose: that table
// is the set of screen controls the kiosk answers one-for-one with actions.js SYSTEM_TOPICS (kiosk_test
// checks the two are equal), and "open the module named in the payload" is not a bindable screen
// control with no argument. Until the kiosk's lines land (see the report), nobody claims it and the
// room says what the press would do.
export const MODULE_TOPIC = 'system/module';
// *** WHICH MODULES ARE ON THIS SCREEN: `system/module-list` { reply(list) }. *** A library with no
// books of its own asks; the kiosk replies with the screen's modules (types, or { module, label }).
// Nobody answering (the modules page, a test) leaves DEFAULT_BOOKS.
export const MODULE_LIST_TOPIC = 'system/module-list';
// The weather module's "what it is like now" (see the report for weather.js's two lines), and the
// room's request for it when a room mounts after the last one went by.
export const WEATHER_NOW_TOPIC = 'weather/now';
export const WEATHER_ASK_TOPIC = 'weather/ask';

// *** THE BOOKS A LIBRARY HAS WHEN NOTHING SAYS WHICH (Rule 1: argued, and a setting in modules/room.js).
// A few of the modules most people have: photos first (photos outrank every game), then the clock, the
// weather, videos and the AAC board. FOR: a shelf is never empty, and every book is a real module.
// AGAINST: they may not be THIS person's modules — which is why a library asks the screen first, and a
// book for a module the screen lacks says so instead of doing nothing.
export const DEFAULT_BOOKS = Object.freeze(['photos', 'clock', 'weather', 'youtube', 'board']);
// Design's bookshelf has four shelves of seven books (room_parts.js `bookshelf`). Geometry, not a
// preference: a 29th book has no place on the drawing. The flat list (lifted) shows them all anyway.
export const BOOKS_PER_SHELF = 7;
export const SHELVES = 4;
export const MAX_BOOKS = BOOKS_PER_SHELF * SHELVES;

// Which parts a close-up works on (Mike, §7.2.13: "the desk or couch"; Design §8). A bed and an armchair
// are the same kind of place. A part not listed here can still be given `role:'closeup'` in a recipe.
export const CLOSEUP_PARTS = Object.freeze(['desk', 'sofa', 'armchair', 'bed']);
// *** HOW FAR A CLOSE-UP ZOOMS. *** Not settings, argued (Rule 1) — both are framing, the way a
// stylesheet's margins are: the area is shown with PAD of its own size around it on every side, so the
// thing and what is on and around it are in view; and never more than MAX_ZOOM, past which the room's
// art (drawn at 960×540) turns to blobs. A bigger pad shows less of the desk; a bigger cap shows mush.
export const CLOSEUP_PAD = 0.35;
export const CLOSEUP_MAX_ZOOM = 3;
// Design (room-add-ons §8): "a 400 ms scale toward the object, or an instant cut under reduced motion".
export const CLOSEUP_MOVE_MS = 400;

// The window's four panes, as fractions of its box (the mullions in room_parts.js `window`).
export const WINDOW_PANES = Object.freeze([
  [0.04, 0.04, 0.445, 0.43], [0.515, 0.04, 0.445, 0.43],
  [0.04, 0.50, 0.445, 0.46], [0.515, 0.50, 0.445, 0.46],
]);
export const PANE_OVERLAYS = Object.freeze(['weather', 'visit']);
export const topicForAction = (action) => ROOM_ACTIONS[action]?.topic
  || (typeof action === 'string' && /^[a-z0-9_-]+\/[a-z0-9_./#-]+$/i.test(action) ? action : null);

// What the room itself publishes, so a host (or a test) can hear it.
export const ROOM_TOPICS = Object.freeze({
  pressed: 'room/pressed',   // { id, role, action? } — every press of a role object
  key: 'room/key',           // { id, group, key }   — a key object
  pet: 'room/pet',           // { id }               — an animal was petted
  lift: 'room/lift',         // { id, module, lifted }
  closeup: 'room/closeup',   // { id, on }           — the room zoomed into an area, or came back
  book: 'room/book',         // { id, module, claimed } — a book was pressed
});

// The scan rows, in Design's order (room-is-the-screen, "Scanning in a room"). The overlay, plain
// bar and flat bar belong to the host; the room fills the three in the middle.
export const SCAN_ROWS = Object.freeze(['overlay', 'plain', 'things', 'pictures', 'floor', 'bar']);

const ROLES = new Set(['button', 'label', 'display', 'keys', 'pet', 'library', 'closeup']);
const DEFAULT_SLOT = [0.05, 0.05, 0.9, 0.9];
// Roles that are a PLACE or a CREATURE, not a holder: no module slot, no grow-to-fit.
const NO_SLOT = new Set(['pet', 'library', 'closeup']);

/** Is this item an animal someone can pet? The cat, anything with `pet` set, or a part declared one. */
export const isAnimal = (it) => !!it && it.pet !== false
  && (it.kind === 'cat' || (it.pet && typeof it.pet === 'object') || it.pet === true || !!FURNITURE[it.part]?.animal);

/** A module type's name for a book spine or a chip: the room's own labels, the manifest, or the type. */
export function moduleLabel(type) {
  if (!type) return '';
  if (MODULE_LABELS[type]) return MODULE_LABELS[type];
  try { const t = getManifest(type)?.title; if (t) return String(t); } catch { /* no registry */ }
  return String(type).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** A list of books from anything a setting, a recipe or a reply may say: types, or { module, label }.
    Unknown shapes are dropped, duplicates kept once, at most MAX_BOOKS. */
export function normalizeBooks(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const b of list) {
    const module = typeof b === 'string' ? b.trim() : typeof b?.module === 'string' ? b.module.trim() : typeof b?.type === 'string' ? b.type.trim() : '';
    if (!module || seen.has(module)) continue;
    seen.add(module);
    const label = typeof b === 'object' && typeof (b.label || b.title) === 'string' && (b.label || b.title).trim() ? (b.label || b.title).trim() : moduleLabel(module);
    out.push({ module, label });
    if (out.length >= MAX_BOOKS) break;
  }
  return out;
}

// *** THE SECOND-PASS OPTIONS, applied to a recipe as data (the renderer and the room module both
// read them; a Stage R dashboard can pass the same object). *** Each value's own default is in
// RENDER_DEFAULTS below ('recipe' = do what the recipe says, which is how every room drew before);
// the room MODULE's defaults are argued in modules/room.js.
//   shelf        'recipe' | 'library'   every bookshelf becomes a library (over a role it had)
//   windowShows  'recipe' | 'view' | 'weather'   the weather in the window's lower-right pane, or none
//   windowPress  'recipe' | 'weather' | 'nothing'  a window with no role opens the weather module
//   closeups     'recipe' | 'on' | 'off'  desks, sofas, armchairs and beds zoom into their area
export function applyRoomOptions(recipe = {}, opts = {}) {
  const items = (Array.isArray(recipe.items) ? recipe.items : []).map((it0) => {
    if (!it0 || typeof it0 !== 'object') return it0;
    let it = it0;
    const part = it.kind === 'furniture' ? it.part : null;
    if (part === 'bookshelf' && opts.shelf === 'library' && it.role !== 'library') {
      const { role, module, needs, slot, action, interactive, ...rest } = it;
      void role; void module; void needs; void slot; void action; void interactive;
      it = { ...rest, role: 'library', label: it.role ? 'Books' : (it.label || 'Books') };
    }
    if (FURNITURE[part]?.view) {
      if (opts.windowShows === 'weather' || opts.windowShows === 'view') {
        const panes = Array.isArray(it.panes) ? it.panes.slice(0, 4) : [];
        while (panes.length < 4) panes.push(null);
        for (let i = 0; i < 4; i++) if (panes[i] === 'weather') panes[i] = null;
        if (opts.windowShows === 'weather') panes[3] = 'weather';
        it = { ...it, panes };
      }
      if (!it.role && !it.interactive && opts.windowPress === 'weather') {
        it = { ...it, role: 'button', action: 'module.open', module: 'weather', label: it.label || 'Weather' };
      }
    }
    if (CLOSEUP_PARTS.includes(part)) {
      if (opts.closeups === 'on' && !it.role && !it.interactive) it = { ...it, role: 'closeup' };
      else if (opts.closeups === 'off' && it.role === 'closeup') { const { role, ...rest } = it; void role; it = rest; }
    }
    return it;
  });
  return { ...recipe, items };
}

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
    else if (mode === 'library') role = 'library';
    else if (does === 'pet') role = 'pet';
    else if (does === 'closeup') role = 'closeup';
    else role = 'label';
    action = action || ia.select?.action || null;
  }
  if (!role && isAnimal(it)) role = 'pet';
  if (!role) return null;
  const zoomRaw = Number(it.zoom ?? ia?.hover?.zoom);
  const zoom = Number.isFinite(zoomRaw) && zoomRaw > 1 ? clamp(zoomRaw, ZOOM_RANGE[0], ZOOM_RANGE[1]) : null;
  const def = it.kind === 'furniture' ? FURNITURE[it.part] : null;
  const fallbackLabel = role === 'pet' ? (it.kind === 'cat' ? 'Nimrod' : def?.label || 'Animal')
    : role === 'library' ? 'Books'
      : (role === 'button' && action !== 'module.open' && ROOM_ACTIONS[action]?.label) || MODULE_LABELS[module] || (module ? moduleLabel(module) : null)
        || it.key || def?.label || MOUNT_KINDS[it.kind]?.label || 'Object';
  const needs = Array.isArray(it.needs) && it.needs.length === 2 ? it.needs.map((n) => Math.max(0, Number(n) || 0)) : [1, 1];
  const slot = Array.isArray(it.slot) && it.slot.length === 4 ? it.slot.map(Number) : DEFAULT_SLOT;
  const petRaw = it.pet && typeof it.pet === 'object' ? it.pet : (FURNITURE[it.part]?.animal && typeof FURNITURE[it.part].animal === 'object' ? FURNITURE[it.part].animal : {});
  return {
    role, action, module, needs, slot, zoom,
    label: String(it.label || fallbackLabel),
    group: it.group || null, key: it.key ?? null,
    grow: it.grow !== false && !!module && !NO_SLOT.has(role) && action !== 'module.open',
    // What petting it sounds like: the cat purrs; another animal says what it says, or nothing.
    petSound: role === 'pet' ? (typeof petRaw.sound === 'string' ? petRaw.sound || null : it.kind === 'cat' ? 'purr' : null) : null,
    books: role === 'library' ? normalizeBooks(it.books) : null,
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
// A rule answers an event by its kind, or — `on:'custom'` — by its own name (room-add-ons §6: the
// mapping store and editor are `room_notify.js`, `room_notify_editor.js`).
const ruleAnswers = (r, event) => r?.on === event || (r?.on === 'custom' && typeof r.name === 'string' && r.name === event);
/**
 * Which items react to `event`, and how: [{ index, id, does }], plus a `{ index: -1, id: null,
 * does: 'sound', sound }` for each sound a rule asks for (the host plays it: `onSound`).
 *   rules  use these instead of the recipe's (Test in the editor: one rule, alone)
 *   only   leave out objects that react to everything (`reacts`) — also for Test
 */
export function reactionsFor(recipe = {}, event, { rules: over = null, only = false } = {}) {
  const items = recipe.items || [];
  const rules = Array.isArray(over) ? over : Array.isArray(recipe.notify) ? recipe.notify : DEFAULT_NOTIFY_RULES;
  const out = [];
  const seen = new Set();
  const add = (index, does) => {
    const d = REACTS_AS[does] || null;
    if (!d || seen.has(index + ':' + d)) return;
    seen.add(index + ':' + d);
    out.push({ index, id: items[index].id, does: d });
  };
  const sounds = [];
  for (const r of rules) {
    if (!ruleAnswers(r, event)) continue;
    items.forEach((it, i) => { if (matchesObject(it, r.object)) add(i, r.does); });
    if (typeof r.sound === 'string' && r.sound && !sounds.includes(r.sound)) sounds.push(r.sound);
  }
  // `reacts` on an object: it reacts to every event (room-is-the-screen §4).
  if (!only) items.forEach((it, i) => { if (it.reacts) add(i, it.reacts); });
  for (const s of sounds) out.push({ index: -1, id: null, does: 'sound', sound: s });
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
//   restMs 300           Design (room-add-ons §1): "Cursor over fires on pointer rest (after 300 ms)
//                        and when the switch scan lands on the object. They're the same event."
//                        Resting that long on an object PICKS it, for Nimrod's help; passing over
//                        it on the way to him does not.
//   onCatPress null      (room-add-ons §2, Mike §7.1.2) pressing Nimrod asks the host to explain
//                        what is picked: `({ id, selected, api }) => handled`. Handled = help; not
//                        handled (no host, or the person turned cat help off) = he is petted, as
//                        before. Stroking him or holding the switch on him always pets (§9).
//   shelf / windowShows / windowPress / closeups  'recipe'  — see applyRoomOptions: the renderer's own
//                        default changes nothing about a recipe; the room module turns them on.
//   books null           a library with no books of its own asks the screen (MODULE_LIST_TOPIC), then
//                        falls back to DEFAULT_BOOKS.
//   closeupReturnMs 120000  a close-up goes back to the whole room by itself after two minutes with
//                        nobody touching it. Longer than a lifted panel's minute because a close-up is a
//                        PLACE to be (sitting at the desk), not a control reached for; short enough that
//                        an unattended screen is the whole room again soon. 0 = never.
//   aiVisits 'news'      Design: "AI visits: Never / Sometimes / When it has news". An avatar appears in
//                        a pane only when something publishes a visit, and never at night unless
//                        'anytime' was chosen (Design: "never at night unless asked").
//   petSound true        petting plays the animal's sound through the host (`onSound`), which scales it
//                        by the screen's master volume. It answers the person's OWN press — unlike the
//                        wake tone Mike turned off, which sounds unasked.
//   weather null         what the window's weather pane shows until `weather/now` says otherwise.
export const RENDER_DEFAULTS = Object.freeze({
  labels: 'always', motion: 'gentle', liftReturnMs: 60000, notifyMs: 8000, petMs: 2600, zoom: null, showSlots: false,
  restMs: 300, onCatPress: null,
  shelf: 'recipe', windowShows: 'recipe', windowPress: 'recipe', closeups: 'recipe', books: null,
  closeupReturnMs: 120000, aiVisits: 'news', petSound: true, weather: null,
});
const OPTION_KEYS = ['shelf', 'windowShows', 'windowPress', 'closeups'];
// *** THE SECOND PASS, TURNED ON: what a room a PERSON sees uses (the room module's defaults, argued in
// modules/room.js). A Stage R dashboard room passes these too — `mountRoomScene(host, recipe,
// { bus, ...OBJECT_DEFAULTS })` — so the room on a real screen and the room on the modules page agree.
export const OBJECT_DEFAULTS = Object.freeze({ shelf: 'library', windowShows: 'weather', windowPress: 'weather', closeups: 'on' });

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

  // The recipe as given, and the recipe as drawn (the second-pass options applied to it as data).
  let baseRecipe = normalizeRecipe(recipeIn);
  const derive = () => normalizeRecipe(applyRoomOptions(baseRecipe, o));
  let recipe = derive();
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
  let pickedId = null;       // the last object the scan landed on, the pointer rested on, or pressed
  let lastPress = null;      // what the last press did (for a host, and a test)
  let cam = null;            // a close-up: { id, z, cx, cy, idle, back }
  let camMoveTimer = null;
  let screenBooks = null;    // what the screen said its modules are (MODULE_LIST_TOPIC), or null
  let weatherNow = null;     // set from o.weather below, once readWeather exists
  let visitNow = null;       // { text, label } while an AI visit is showing
  let visitTimer = null;
  const petTimers = new Map();
  const busOffs = [];

  // ------------------------------------------------------------------ fitting the stage
  let scale = 1;
  function fit() {
    const r = root.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    if (!(k > 0)) return scale;
    scale = k;
    // A close-up is one more transform after the fit: the area's centre to the stage's centre, grown.
    const camT = cam ? ` translate(${W / 2}px, ${H / 2}px) scale(${cam.z}) translate(${-cam.cx}px, ${-cam.cy}px)` : '';
    stage.style.transform = `translate(${(r.width - W * k) / 2}px, ${(r.height - H * k) / 2}px) scale(${k})${camT}`;
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
      if (def.view) rec.panes = buildPanes(it, box);
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

  // ------------------------------------------------------------------ the window's panes
  // Each pane can hold an overlay (room-add-ons §4: `panes: [{ overlay: 'weather' }, …]`; here a pane is
  // just its overlay's name, or `{ overlay }`). They draw in the CONTENT layer, above the lighting, so the
  // weather reads at night like every other piece of content (Design rule 1), placed with the window's
  // own transform so a window on a side wall carries them in perspective.
  const paneKind = (p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? p.overlay : null);
  function buildPanes(it, box) {
    const host = doc.createElement('span');
    host.className = 'rs-panes';          // not an .rs-item: it is the window's, not a thing of its own
    host.dataset.panesFor = it.id;
    placeEl(host, box);
    applyStyle(host, { width: box.w, height: box.h, pointerEvents: 'none' });
    const panes = WINDOW_PANES.map(([l, t, w, h], i) => {
      const p = doc.createElement('span');
      p.className = 'rs-pane';
      p.dataset.pane = String(i);
      applyStyle(p, { left: l * 100 + '%', top: t * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
      host.append(p);
      return p;
    });
    contentL.append(host);
    return { host, panes };
  }
  /** Where the visit goes: the first pane marked 'visit', else the first pane with nothing in it. */
  function visitPane(it) {
    const kinds = [0, 1, 2, 3].map((i) => paneKind((it.panes || [])[i]));
    const marked = kinds.indexOf('visit');
    return marked >= 0 ? marked : Math.max(0, kinds.findIndex((k) => !k));
  }
  function visitAllowed() {
    if (o.aiVisits === 'never') return false;
    if (o.aiVisits === 'anytime') return true;
    return light !== 'night';
  }
  function paintPanes() {
    for (const r of recs) {
      if (!r?.panes) continue;
      const vp = visitNow && visitAllowed() ? visitPane(r.it) : -1;
      r.panes.panes.forEach((p, i) => {
        p.replaceChildren();
        delete p.dataset.overlay;
        const kind = paneKind((r.it.panes || [])[i]);
        if (i === vp) {
          p.dataset.overlay = 'visit';
          const v = doc.createElement('span');
          v.className = 'rs-visit';
          v.setAttribute('role', 'img');
          v.setAttribute('aria-label', visitNow.label);
          // No avatar art yet (Design has not drawn the parts library): a plain speech mark, and the
          // words in a toast. An avatar is one `src` away (`visit({ src })`).
          if (visitNow.src) { const img = doc.createElement('img'); img.src = visitNow.src; img.alt = ''; v.append(img); }
          else v.textContent = '…';
          p.append(v);
        } else if (kind === 'weather' && weatherNow) {
          p.dataset.overlay = 'weather';
          const w = doc.createElement('span');
          w.className = 'rs-wx';
          w.dataset.weather = weatherNow.icon;
          if (weatherNow.stale) w.dataset.stale = '1';
          w.innerHTML = iconSvg(weatherNow.icon, { label: weatherNow.words, cls: 'rs-wx-icon' });
          const t = doc.createElement('b');
          t.className = 'rs-wx-temp';
          t.textContent = weatherNow.temp;
          w.append(t);
          p.append(w);
        }
      });
    }
  }
  /** What `weather/now` said, made safe to draw: { icon, words, temp, spoken, stale } or null. */
  function readWeather(p) {
    if (!p || typeof p !== 'object') return null;
    const icon = typeof p.icon === 'string' && p.icon ? p.icon : 'unknown';
    const words = typeof p.words === 'string' ? p.words.slice(0, 60) : '';
    const tv = p.temp == null ? '' : String(p.temp).slice(0, 8);
    const temp = tv ? (/°/.test(tv) ? tv : `${tv}°`) : '';
    const spoken = typeof p.spoken === 'string' && p.spoken ? p.spoken.slice(0, 200)
      : [temp, words.toLowerCase()].filter(Boolean).join(' and ');
    return { icon, words, temp, spoken, stale: !!p.stale };
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
      btn.setAttribute('aria-label', role.role === 'pet'
        ? (it.kind === 'cat' && typeof o.onCatPress === 'function' ? `${role.label}: press for help, stroke to pet` : `Pet ${role.label}`)
        : role.role === 'library' ? `${role.label}: press for the list of books`
          : role.role === 'closeup' ? `${role.label}: look closer` : role.label);
      btn.addEventListener('click', () => {
        // A stroke that already petted him ends in a click; that click is the same gesture.
        if (btn.dataset.stroked) { delete btn.dataset.stroked; return; }
        press(it.id);
      });
      if (role.role === 'pet') wireStroke(btn, it.id);
      wrap.append(btn);
      rec.button = btn;
    }
    if (role.role === 'library') buildSpines(rec, wrap);
    if (!NO_SLOT.has(role.role)) {
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
    // Resting the pointer on it picks it (Design's "cursor over"), for Nimrod to explain.
    if (role.role !== 'pet') {
      let rest = null;
      wrap.addEventListener('pointerenter', () => { cancel(rest); rest = later(() => { rest = null; pickedId = it.id; }, Math.max(0, Number(o.restMs) || 0)); });
      wrap.addEventListener('pointerleave', () => { cancel(rest); rest = null; });
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
    if (o.showSlots && !NO_SLOT.has(role.role)) {
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

  // ------------------------------------------------------------------ the library's books
  /** The books on a library: its own, else the host's, else what the screen said, else DEFAULT_BOOKS. */
  function booksFor(rec) {
    return rec.role?.books || normalizeBooks(Array.isArray(o.books) ? o.books : null) || screenBooks
      || normalizeBooks(DEFAULT_BOOKS.slice());
  }
  // Each book is a spine on Design's shelves (room_parts.js `bookshelf`: seven books across at
  // 10 + i × 11.4 %, 9.4 % wide; shelves at 5 + row × 23.5 % from the bottom), top shelf first, so the
  // drawing and the list read in the same order. A spine is for a POINTER: pressing one opens its module
  // at once (Mike, §7.2.4: "Click on the book and the module opens"). It is too narrow to be a 44px
  // target, so it is not in the scan — the shelf is, and it lifts the same books as a flat list.
  function buildSpines(rec, wrap) {
    const books = booksFor(rec);
    const shelf = doc.createElement('span');
    shelf.className = 'rs-books';
    books.forEach((b, i) => {
      const row = SHELVES - 1 - Math.floor(i / BOOKS_PER_SHELF);
      const col = i % BOOKS_PER_SHELF;
      const spine = doc.createElement('button');
      spine.type = 'button';
      spine.className = 'rs-book';
      spine.dataset.book = b.module;
      spine.dataset.tint = String((col + row * 2) % 7);
      spine.setAttribute('aria-label', `Open ${b.label}`);
      spine.title = b.label;
      applyStyle(spine, { left: 10 + col * 11.4 + '%', width: '9.4%', bottom: 5 + row * 23.5 + '%', height: '19%' });
      const t = doc.createElement('span');
      t.className = 'rs-book-name';
      t.textContent = b.label;
      spine.append(t);
      spine.addEventListener('click', (e) => { e.stopPropagation(); lastPress = openBook(rec.it.id, b.module) || lastPress; });
      shelf.append(spine);
    });
    wrap.append(shelf);
    rec.books = books;
  }
  /** Open a book's module: the one verb (MODULE_TOPIC) — the kiosk answers with `showModule`. */
  function openBook(id, module) {
    const rec = recOf(id);
    if (!rec || destroyed || !module) return null;
    if (lifted?.id === id) putBack();
    pickedId = id;
    publish(ROOM_TOPICS.pressed, { id, role: rec.role?.role || 'library', action: 'module.open', module });
    const claimed = openModule(module, id);
    publish(ROOM_TOPICS.book, { id, module, claimed });
    return { did: 'book', module, claimed };
  }
  /** Publish `system/module` for a type; the host's onUnclaimed hears it when nobody answered. */
  function openModule(module, id) {
    let claimed = false;
    publish(MODULE_TOPIC, { action: 'module.open', module, source: 'room', objectId: id, claim: () => { claimed = true; } });
    if (!claimed) { try { o.onUnclaimed?.('module.open', { id, module, topic: MODULE_TOPIC, api }); } catch (err) { console.error('room: onUnclaimed', err); } }
    return claimed;
  }
  /** Ask the screen which modules it has (once per build, and only for a library that needs it). */
  function askForBooks() {
    if (!o.bus || Array.isArray(o.books)) return;
    if (!recs.some((r) => r.role?.role === 'library' && !r.role.books)) return;
    // A reply may come now or later; either way a CHANGED list redraws the shelf, an unchanged one
    // does nothing (so a rebuild asking again cannot loop).
    let sync = true, again = false;
    publish(MODULE_LIST_TOPIC, { claim: () => {}, reply: (list) => {
      const a = normalizeBooks(list);
      if (destroyed || !a || !a.length || JSON.stringify(a) === JSON.stringify(screenBooks)) return;
      screenBooks = a;
      if (sync) again = true; else build();
    } });
    sync = false;
    if (again) build();
  }

  // Petting with a pointer: a stroke across him counts (room-add-ons §9). 30px of travel while
  // pressed on him; a plain press is a press, handled by the click.
  function wireStroke(btn, id) {
    let down = null, travelled = 0;
    btn.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; travelled = 0; delete btn.dataset.stroked; });
    btn.addEventListener('pointermove', (e) => {
      if (!down) return;
      travelled += Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = { x: e.clientX, y: e.clientY };
      if (travelled >= 30) { travelled = -1e9; btn.dataset.stroked = '1'; pet(id); lastPress = { did: 'pet', via: 'stroke' }; }
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
    if (cam) closeupExit();
    for (const id of petTimers.values()) cancel(id);
    petTimers.clear();
    recs = [];
    pickedId = null;
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
    paintPanes();
    focusIdx = -1;
    fit();
    askForBooks();
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
    // A visit is not shown at night unless 'anytime' was chosen: the light changing can hide or show it.
    if (views) paintPanes();
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
    const r = pressInner(id);
    if (r) lastPress = r;
    return r;
  }
  function pressInner(id) {
    const rec = recOf(id);
    if (!rec || !rec.role || destroyed) return null;
    const { role, it } = rec;
    flashPressed(rec);
    if (role.role !== 'pet') pickedId = it.id;
    publish(ROOM_TOPICS.pressed, { id: it.id, role: role.role, action: role.action || null });
    switch (role.role) {
      case 'button': {
        // Open a module (the window's weather): the same one verb a book sends.
        if (role.action === 'module.open') {
          const claimed = role.module ? openModule(role.module, it.id) : false;
          return { did: 'action', action: role.action, topic: MODULE_TOPIC, module: role.module, claimed };
        }
        const topic = topicForAction(role.action);
        let claimed = false;
        if (topic) publish(topic, { action: role.action, source: 'room', objectId: it.id, claim: () => { claimed = true; } });
        if (!claimed) { try { o.onUnclaimed?.(role.action, { id: it.id, topic, api }); } catch (err) { console.error('room: onUnclaimed', err); } }
        return { did: 'action', action: role.action, topic, claimed };
      }
      case 'display': lift(it.id); return { did: 'lift' };
      case 'library': lift(it.id); return { did: 'lift', library: true };
      case 'closeup': return closeup(it.id) ? { did: 'closeup' } : { did: 'nothing' };
      case 'keys': publish(ROOM_TOPICS.key, { id: it.id, group: role.group, key: role.key }); return { did: 'key', key: role.key };
      case 'pet': {
        // NIMROD IS THE HELP BUTTON (Mike, §7.1.2). Only the cat, only on a press — never when the
        // scan merely lands on him — and only if the host answers; otherwise he is petted.
        if (it.kind === 'cat' && typeof o.onCatPress === 'function') {
          let handled = false;
          try { handled = !!o.onCatPress({ id: it.id, selected: pickedId ? describe(pickedId) : null, api }); }
          catch (err) { console.error('room: onCatPress', err); }
          if (handled) return { did: 'help', selected: pickedId };
        }
        pet(it.id);
        return { did: 'pet' };
      }
      default: return { did: 'nothing' };
    }
  }

  // ------------------------------------------------------------------ petting
  // ANY ANIMAL (Mike, §7.2.11; Design §9). The cat takes his happy pose; another animal HOPS (a
  // decoration, so inside the motion guard: under reduced motion it does not move at all). Either way a
  // small heart shows above it for as long as the petting lasts — the still signal that it happened,
  // which is the one a person who asked for no motion gets. The sound is the host's (`onSound`), scaled
  // by the screen's master volume; `petSound: false` keeps petting silent.
  function catRestPose(rec) { return rec.perked ? 'idle' : (rec.it.pose || 'sleeping'); }
  function pet(id) {
    const rec = recOf(id);
    if (!rec || !isAnimal(rec.it) || destroyed) return false;
    rec.petting = true;
    if (rec.cat) rec.cat.setPose('happy');
    else if (animated()) rec.el.classList.add('rs-petted');
    rec.el.dataset.petted = '1';
    let mark = overL.querySelector(`.rs-pet-mark[data-pet-for="${rec.it.id}"]`);
    if (!mark) {
      mark = doc.createElement('span');
      mark.className = 'rs-pet-mark';
      mark.dataset.petFor = rec.it.id;
      mark.setAttribute('aria-hidden', 'true');
      const b = rec.box.visible;
      applyStyle(mark, { left: b.left + b.w / 2, top: b.top });
      overL.append(mark);
    }
    publish(ROOM_TOPICS.pet, { id });
    const sound = rec.role?.petSound;
    if (o.petSound !== false && sound) { try { o.onSound?.(sound, { event: 'pet', id }); } catch (err) { console.error('room: onSound', err); } }
    cancel(petTimers.get(id));
    petTimers.set(id, later(() => {
      petTimers.delete(id);
      rec.petting = false;
      rec.cat?.setPose(catRestPose(rec));
      rec.el?.classList.remove('rs-petted');
      if (rec.el) delete rec.el.dataset.petted;
      mark.remove();
    }, o.petMs));
    return true;
  }

  // ------------------------------------------------------------------ lifting a display flat
  function lift(id) {
    const rec = recOf(id);
    if (!rec || destroyed) return false;
    if (rec.role?.role === 'library') return liftLibrary(rec);
    if (!rec.slotEl) return false;
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
  /**
   * THE LIBRARY, LIFTED: the shelf's books as a flat list of full-size buttons, the way out first.
   * The same panel, the same "goes back by itself" and the same scan takeover as any lifted display
   * (so it can never be a state only an input can leave), with books where a module's slot would be.
   */
  function liftLibrary(rec) {
    if (lifted) putBack();
    const id = rec.it.id;
    const panel = doc.createElement('div');
    panel.className = 'rs-lift rs-lift-library';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', rec.role.label);
    panel.dataset.liftFor = id;
    const head = doc.createElement('div');
    head.className = 'rs-lift-head';
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'rs-lift-back';
    back.dataset.scan = '';
    back.dataset.row = 'overlay';
    back.textContent = 'Put it back';
    back.addEventListener('click', () => putBack());
    const title = doc.createElement('h3');
    title.className = 'rs-lift-title';
    title.textContent = rec.role.label;
    head.append(back, title);
    const list = doc.createElement('div');
    list.className = 'rs-booklist';
    for (const b of rec.books || booksFor(rec)) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'rs-booklist-book';
      btn.dataset.scan = '';
      btn.dataset.row = 'overlay';
      btn.dataset.book = b.module;
      btn.textContent = b.label;
      btn.addEventListener('click', () => { lastPress = openBook(id, b.module) || lastPress; });
      list.append(btn);
    }
    panel.append(head, list);
    liftL.append(panel);
    lifted = { id, panel, slotEl: null, home: null, next: null, idle: null };
    const arm = () => { cancel(lifted?.idle); if (lifted && o.liftReturnMs > 0) lifted.idle = later(() => putBack(), o.liftReturnMs); };
    for (const ev of ['pointerdown', 'keydown', 'focusin', 'wheel']) panel.addEventListener(ev, arm);
    lifted.arm = arm;
    arm();
    focusIdx = -1;
    publish(ROOM_TOPICS.lift, { id, module: null, lifted: true, library: true });
    paintScan();
    return true;
  }

  function putBack() {
    if (!lifted) return false;
    const { id, panel, slotEl, home, next } = lifted;
    cancel(lifted.idle);
    lifted = null;
    if (!slotEl) {
      // The library's list: nothing of the room's was moved into it.
      panel.remove();
      focusIdx = -1;
      publish(ROOM_TOPICS.lift, { id, module: null, lifted: false, library: true });
      paintScan();
      return true;
    }
    delete slotEl.dataset.empty;
    if (home) home.insertBefore(slotEl, next && next.parentNode === home ? next : null);
    panel.remove();
    focusIdx = -1;
    publish(ROOM_TOPICS.lift, { id, module: recOf(id)?.role?.module || null, lifted: false });
    try { o.onLift?.({ id, el: slotEl, lifted: false }); } catch (err) { console.error('room: onLift', err); }
    paintScan();
    return true;
  }

  // ------------------------------------------------------------------ a close-up (a point of view)
  /** Where a close-up looks, and how far: the area around the object, fitted to the stage, kept inside it. */
  function camFor(rec) {
    const b = rec.box.visible;
    const w = Math.max(1, b.w * (1 + 2 * CLOSEUP_PAD)), h = Math.max(1, b.h * (1 + 2 * CLOSEUP_PAD));
    const z = clamp(Math.min(W / w, H / h), 1, CLOSEUP_MAX_ZOOM);
    const hw = W / (2 * z), hh = H / (2 * z);
    return { z, cx: clamp(b.left + b.w / 2, hw, W - hw), cy: clamp(b.top + b.h / 2, hh, H - hh) };
  }
  /** The part of the stage a close-up shows, in stage px. */
  function camView() {
    if (!cam) return { left: 0, top: 0, right: W, bottom: H };
    const hw = W / (2 * cam.z), hh = H / (2 * cam.z);
    return { left: cam.cx - hw, top: cam.cy - hh, right: cam.cx + hw, bottom: cam.cy + hh };
  }
  function animateCam() {
    // Design: 400 ms toward the object, an instant cut under reduced motion. The class is only on while
    // the camera moves, so a resize never animates.
    root.classList.remove('rs-cam-move');
    cancel(camMoveTimer);
    if (!animated()) return;
    root.classList.add('rs-cam-move');
    camMoveTimer = later(() => { camMoveTimer = null; root.classList.remove('rs-cam-move'); }, CLOSEUP_MOVE_MS + 50);
  }
  /**
   * Zoom into an area (Mike, §7.2.13; Design §8). THE WAY BACK IS THERE THREE WAYS: a flat Back button,
   * first in the scan; `back()` (the room/back verb); and by itself after `closeupReturnMs` with nobody
   * touching the room. Never a state only an input can leave.
   */
  function closeup(id) {
    const rec = recOf(id);
    if (!rec || destroyed) return false;
    if (lifted) putBack();
    const was = cam;
    if (was) cancel(was.idle);
    cam = { id, ...camFor(rec), idle: null, back: was?.back || null };
    if (!cam.back) {
      const back = doc.createElement('button');
      back.type = 'button';
      back.className = 'rs-closeup-back';
      back.dataset.scan = '';
      back.dataset.row = 'overlay';
      back.textContent = 'Back to the room';
      back.addEventListener('click', () => closeupExit());
      liftL.append(back);
      cam.back = back;
    }
    cam.back.setAttribute('aria-label', `Back to the room from the ${rec.role?.label || 'close-up'}`);
    root.dataset.closeup = id;
    animateCam();
    fit();
    armCloseup();
    focusIdx = -1;
    publish(ROOM_TOPICS.closeup, { id, on: true });
    paintScan();
    return true;
  }
  function armCloseup() {
    if (!cam) return;
    cancel(cam.idle);
    cam.idle = o.closeupReturnMs > 0 ? later(() => closeupExit(), o.closeupReturnMs) : null;
  }
  function closeupExit() {
    if (!cam) return false;
    const { id, idle, back } = cam;
    cancel(idle);
    cam = null;
    back?.remove();
    delete root.dataset.closeup;
    if (!destroyed) { animateCam(); fit(); }
    focusIdx = -1;
    publish(ROOM_TOPICS.closeup, { id, on: false });
    paintScan();
    return true;
  }
  // Anything a person does in the room keeps a close-up open (the idle clock starts again).
  const onActivity = () => { if (cam) armCloseup(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) root.addEventListener(ev, onActivity, { passive: true });

  // ------------------------------------------------------------------ scanning
  /** The things a switch walks, in Design's order. A lifted panel takes over, its way out first;
      in a close-up, Back comes first and then only what is in view. */
  function scanTargets() {
    if (lifted) return [...lifted.panel.querySelectorAll('[data-scan]')];
    if (cam) {
      const v = camView();
      const inView = recs.filter((r) => r.button && r.it.id !== cam.id).filter((r) => {
        const b = r.box.visible;
        return b.left < v.right && b.left + b.w > v.left && b.top < v.bottom && b.top + b.h > v.top;
      });
      inView.sort((a, c) => (SCAN_ROWS.indexOf(a.button.dataset.row) - SCAN_ROWS.indexOf(c.button.dataset.row)) || (a.it.x - c.it.x));
      return [cam.back, ...inView.map((r) => r.button)];
    }
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
    if (wrap) {
      const rec = recOf(wrap.dataset.id);
      rec?.zoomOn?.();
      // The scan landing on a thing picks it for Nimrod; landing on an animal does not (he is how
      // you ASK about what is picked, so scanning past him must not forget it).
      if (rec && rec.role?.role !== 'pet') pickedId = rec.it.id;
    }
    return t;
  }

  // ------------------------------------------------------------------ Nimrod's help, and petting by holding
  /** An object, described for whoever explains it (cat_help.js explainObject). */
  function describe(id) {
    const rec = recOf(id);
    if (!rec) return null;
    const { it, role } = rec;
    const el = rec.wrap || rec.el;
    let rect = null;
    try { const r = el.getBoundingClientRect(); rect = { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; } catch { rect = null; }
    return {
      kind: 'object', id: it.id,
      role: role?.role || null, label: role?.label || FURNITURE[it.part]?.label || MOUNT_KINDS[it.kind]?.label || it.id,
      module: role?.module || null, moduleLabel: role?.module ? (MODULE_LABELS[role.module] || role.label) : null,
      action: role?.action || null, actionLabel: ROOM_ACTIONS[role?.action]?.label || null,
      key: role?.key ?? null, group: role?.group || null,
      part: it.part || it.kind, partLabel: FURNITURE[it.part]?.label || MOUNT_KINDS[it.kind]?.label || null,
      help: typeof it.help === 'string' && it.help ? it.help : null,
      rect, el,
    };
  }
  /** Holding the switch on an animal pets it (room-add-ons §9), whatever a press on it does. */
  function hold() {
    const list = scanTargets();
    if (focusIdx < 0 || !list.length) return false;
    const rec = recOf(list[focusIdx % list.length].dataset.id);
    if (!rec || rec.role?.role !== 'pet') return false;
    const ok = pet(rec.it.id);
    if (ok) lastPress = { did: 'pet', via: 'hold' };
    return ok;
  }
  /** While Nimrod is out explaining something, the room's own cat steps away (he "moves"). */
  function catAway(on) {
    for (const r of recs) if (r.it.kind === 'cat' && r.el) r.el.style.visibility = on ? 'hidden' : '';
  }
  function focusStep(d) {
    const list = scanTargets();
    if (!list.length) return null;
    focusIdx = focusIdx < 0 ? (d > 0 ? 0 : list.length - 1) : (focusIdx + d + list.length) % list.length;
    lifted?.arm?.();
    onActivity();
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
  function notify(event, { ms = o.notifyMs, rules = null, only = false } = {}) {
    if (destroyed) return [];
    clearReactions();
    const list = reactionsFor(recipe, event, { rules, only });
    for (const { index, does, sound } of list) {
      if (does === 'sound') {
        // Sound is the host's (the room module scales it by the screen's master volume).
        try { o.onSound?.(sound, { event }); } catch (err) { console.error('room: onSound', err); }
        continue;
      }
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

  // ------------------------------------------------------------------ the window: weather and visits
  function setWeather(p) {
    weatherNow = readWeather(p);
    paintPanes();
    return weatherNow;
  }
  /**
   * YOUR AI, AT THE WINDOW (Mike, §7.2.1; Design §4: "appears in a pane only when it has something to
   * say, and never at night unless asked"). `{ text, label?, src?, ms? }`. The words show as a note;
   * the pane shows a speech mark (or `src`, an avatar picture, when there is one). It goes by itself
   * after `ms` (default notifyMs). Returns false when the setting says no, or there is no window.
   */
  function visit(p = {}) {
    if (destroyed || !visitAllowed() || !recs.some((r) => r?.panes)) return false;
    const text = typeof p.text === 'string' ? p.text.trim().slice(0, 200) : '';
    const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 40) : 'Your assistant';
    const src = typeof p.src === 'string' && /^(https?:|\/|data:image\/|\.)/.test(p.src) ? p.src : null;
    visitNow = { text, label, src };
    paintPanes();
    const ms = Number(p.ms) > 0 ? Math.min(60000, Number(p.ms)) : o.notifyMs;
    if (text) toast(`${label}: ${text}`, ms);
    cancel(visitTimer);
    visitTimer = later(() => { visitTimer = null; visitNow = null; paintPanes(); }, ms);
    return true;
  }
  // The weather module says what it is like out; the room keeps it for its window. Only when a window
  // shows the weather, so a room without one opens no listener.
  function listen() {
    while (busOffs.length) { try { busOffs.pop()(); } catch { /* gone */ } }
    if (!o.bus?.subscribe) return;
    const wants = recs.some((r) => r?.panes && (r.it.panes || []).some((k) => paneKind(k) === 'weather'));
    if (!wants) return;
    const off = o.bus.subscribe(WEATHER_NOW_TOPIC, (p) => { if (!destroyed) setWeather(p); });
    if (typeof off === 'function') busOffs.push(off);
    if (!weatherNow) publish(WEATHER_ASK_TOPIC, { from: 'room' });
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
    /** The room's notification rules (room_notify.js); null = Design's defaults. No rebuild. */
    setNotify(rules) {
      clearReactions();
      const notify = Array.isArray(rules) ? rules.slice() : undefined;
      baseRecipe = { ...baseRecipe, notify };
      recipe = { ...recipe, notify };
    },
    /** The editor's Test: that one rule, alone, as if its event had happened. */
    testRule(rule, { ms } = {}) {
      if (!rule) return [];
      const event = rule.on === 'custom' ? rule.name : rule.on;
      return notify(event, { rules: [rule], only: true, ...(ms != null ? { ms } : {}) });
    },
    scanTargets,
    focusNext: () => focusStep(1),
    focusPrev: () => focusStep(-1),
    focused: () => { const l = scanTargets(); return focusIdx < 0 || !l.length ? null : l[focusIdx % l.length]; },
    select,
    // Back, in the order a person would expect: a lifted panel first, then a close-up.
    back: () => (lifted ? putBack() : cam ? closeupExit() : false),
    describe, hold, catAway,
    picked: () => pickedId,
    lastPress: () => lastPress,
    toast,
    fit,
    timers: () => timers.size,
    // The second pass.
    closeup, closeupExit,
    closedUp: () => (cam ? cam.id : null),
    camera: () => (cam ? { id: cam.id, z: cam.z, cx: cam.cx, cy: cam.cy } : null),
    openBook, books: (id) => (recOf(id)?.books || []).map((b) => ({ ...b })),
    /** Ask the screen again which modules it has (its modules changed). */
    refreshBooks() { screenBooks = null; askForBooks(); if (!screenBooks) build(); },
    setWeather, weather: () => (weatherNow ? { ...weatherNow } : null),
    visit, visiting: () => !!visitNow && visitAllowed(),
    setRecipe(next) { baseRecipe = normalizeRecipe(next); recipe = derive(); shell = ROOM_SHELLS[recipe.shell]; build(); listen(); scheduleTick(); },
    setOptions(next = {}) {
      const rebuild = ['showSlots', 'signWords', 'zoom', 'pictureFor', 'assetBase', 'books', ...OPTION_KEYS].some((k) => k in next && JSON.stringify(next[k]) !== JSON.stringify(o[k]));
      Object.assign(o, next);
      root.dataset.labels = o.labels === 'pointed' ? 'pointed' : 'always';
      if ('weather' in next) weatherNow = readWeather(next.weather);
      if (rebuild) { recipe = derive(); build(); listen(); }
      if ('closeupReturnMs' in next) armCloseup();
      applyMotion();
      applyLight(true);
      scheduleTick();
    },
    destroy() {
      if (destroyed) return;
      putBack();
      closeupExit();
      clearReactions();
      destroyed = true;
      while (busOffs.length) { try { busOffs.pop()(); } catch { /* gone */ } }
      for (const ev of ['pointerdown', 'keydown', 'wheel']) root.removeEventListener(ev, onActivity);
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
  weatherNow = readWeather(o.weather);
  build();
  listen();
  scheduleTick();
  return api;
}
