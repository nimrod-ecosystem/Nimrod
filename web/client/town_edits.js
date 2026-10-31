// town_edits.js — A PERSON'S OWN TOWN: the places they rearranged, kept as room recipes, per theme and per place.
//
// Claude Design's characters handoff (2026-10-12; `town.js`, shipped as it is): "Every indoor place is a room recipe,
// the same format the room builder edits, so a place can be opened, rearranged and saved like anyone's room ... Edits
// are kept per theme and per place." And `cardSvg(card, theme, { town })` draws a person's edited places, so "Edit the
// King's hall and the King's card changes". card_deck.js already passes `town` through (`cardArt(..., { town })`, made
// safe by `cleanTown`); until this file nothing kept any edits, so nothing passed one.
//
// THREE THINGS LIVE HERE, all small:
//   1. THE STORE. One per-person state row, TOWN_KEY ('town'), the same per-person store the avatar, the music
//      favourites and the game ladders use (`ctx.makePersonState(personId, key)`), so a rearranged hall follows the
//      person to every screen, and every card game on any of them draws it. Shape:
//          { v: 1, <deck>: { <placeId>: <recipe> | null, ... }, ... }
//      <deck> is the Design deck id (card_deck.js deckFor: the site's 'default' theme is Design's 'nimrod'), because
//      that is the id town.js and the cards key their places by. A top-level key per theme because the state handle
//      merges a write one top-level key deep: writing one theme's map never touches another theme's.
//      No person on this screen (a demo page, a screen not signed in as anybody): the panel's own row holds the same
//      shape under `town`, so the editor still works there; the card games simply have no edits to read.
//   2. THE EDITS, as pure functions on a recipe (move, bigger, smaller, flip, take out, add a piece). The Town's editor
//      (modules/town.js) is their only caller; they are here so a suite tests them without a panel.
//   3. `watchTownEdits(ctx, onChange)`: what a card game calls to draw the person's town (solitaire, card sort).
//
// *** WHY A RECIPE MAY BE KEPT ON THE SERVER (storage_line.py, Mike's line of 2026-10-07: nothing that is a person's
// content or body goes on the server; small text the site needs across devices stays). *** A recipe is a list of
// furniture ids, positions, sizes and #rrggbb colours: layout data, the same kind of thing as a room panel's
// arrangement, the avatar's figure record ("never a picture") and the board's layout, all already kept on rows. It
// holds no picture, sound, recording or anything somebody said; the only words in it are the built-in name signs
// ("King Kenny", "Bakery"), and the editor offers no way to type new ones. Bounded: at most RECIPE_MAX_ITEMS things a
// place (argued below) and RECIPE_MAX_BYTES a recipe, so every theme's every place edited is a few hundred KB at the
// very most, well inside the server's 2 MiB a row (STATE_MAX_BYTES), which refuses anything bigger anyway.

import { PLACES, TOWN_DRESS, placeRecipe } from './town.js';
import { KIT, KIT_WORLDS, kitByWorld } from './theme_kits.js';
import { FURNITURE, MOUNT_KINDS } from './room_parts.js';
import { cleanTown, deckFor } from './card_deck.js';
import { NIMROD_DEFAULTS, defaultFor } from './nimrod_defaults.js';

export const TOWN_KEY = 'town';
export const TOWN_VERSION = 1;
export const PLACE_IDS = Object.freeze(Object.keys(PLACES));
/** The places that are rooms. The Park is a scene-builder recipe (outdoor) and has no flat editor yet. */
export const EDITABLE_PLACES = Object.freeze(PLACE_IDS.filter((id) => !PLACES[id].outdoor));
/** The themes Design built a town for. Every other theme's town wears the Nimrod dressing (town.js dressFor). */
export const TOWN_THEMES = Object.freeze(Object.keys(TOWN_DRESS));
export const townDeck = (siteThemeId) => deckFor(siteThemeId);

// *** THE BOUNDS, ARGUED. ***
//   RECIPE_MAX_ITEMS 40   The busiest built-in place has 12 things (the Halloween Haunted Hall). 40 is over three times
//                         that: room for a person to fill a room, and still a drawing a Pi 400 makes in a moment on
//                         every card that shows it. Past it, "Add a piece" says the room is full.
//   RECIPE_MAX_BYTES 16 KiB  A built-in recipe is about 1 KB; 40 things with every field set is about 5 KB. 16 KB is
//                         the backstop for a recipe that came from somewhere else (a file, another device).
export const RECIPE_MAX_ITEMS = 40;
export const RECIPE_MAX_BYTES = 16 * 1024;

// The furniture town.js can draw FLAT (its own boxes plus every world piece). The room renderer's door and speaker
// are not in the flat drawing, so they are not offered: a piece that vanishes from the cards would be a lie.
export const BASIC_PIECES = Object.freeze(['sofa', 'armchair', 'bed', 'bookshelf', 'desk', 'sideTable', 'cabinet',
  'tableLamp', 'floorLamp', 'plant', 'rug', 'fireplace', 'window', 'wallShelf']);
const WALL_BASIC = new Set(['window', 'wallShelf']);
export const isWallPiece = (part) => (KIT[part] ? KIT[part].on === 'wall' : WALL_BASIC.has(part));
export const canDraw = (part) => BASIC_PIECES.includes(part) || Object.prototype.hasOwnProperty.call(KIT, part);

const WORLD_LABEL = Object.fromEntries(KIT_WORLDS);

/** "Add a piece", grouped: this world's own pieces first, then every world's, then the plain furniture. */
export function piecesFor(deck) {
  const own = TOWN_THEMES.includes(deck) ? kitByWorld(deck) : [];
  return [
    [`${WORLD_LABEL[deck] || 'This theme'} pieces`, own],
    ['Pieces from every world', kitByWorld('any')],
    ['Furniture', BASIC_PIECES.slice()],
  ].filter(([, ids]) => ids.length);
}

export function pieceName(part) {
  return (FURNITURE[part] && FURNITURE[part].label) || (KIT[part] && KIT[part].label) || String(part || 'Piece');
}

/** A thing in a place, in words ("Throne", "Name sign: King Kenny"). */
export function itemName(it) {
  if (!it || typeof it !== 'object') return '';
  if (it.kind === 'furniture') return pieceName(it.part);
  if (it.kind === 'sign') return it.name ? `Name sign: ${it.name}` : 'Name sign';
  return (MOUNT_KINDS[it.kind] && MOUNT_KINDS[it.kind].label) || 'Thing';
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = (v) => Math.round(v * 10) / 10;
const copy = (r) => JSON.parse(JSON.stringify(r || {}));
const onWall = (it) => (it.kind === 'furniture' ? isWallPiece(it.part) : true);

// Where a thing may go, in the place's own percent units: a wall thing stays on the wall, a floor thing on the floor
// (y is where it stands). Not settings: they are the room's geometry (town.js SHELLS put the floor line at 66-70%).
export const WALL_Y = Object.freeze([4, 66]);
export const FLOOR_Y = Object.freeze([62, 100]);
export const X_RANGE = Object.freeze([3, 97]);
export const SCALE_RANGE = Object.freeze([0.5, 1.6]);
export const SCALE_STEP = 0.1;

/** Move thing `i` by (dx, dy) percent. A thing standing on another (a lamp on a table, `ground`) moves with it. */
export function moveItem(recipe, i, dx = 0, dy = 0) {
  const r = copy(recipe);
  const it = r.items && r.items[i];
  if (!it) return r;
  const [lo, hi] = onWall(it) ? WALL_Y : FLOOR_Y;
  const x = round1(clamp((Number(it.x) || 0) + dx, X_RANGE[0], X_RANGE[1]));
  const y = round1(clamp((Number(it.y) || 0) + dy, lo, hi));
  if (Number.isFinite(it.ground)) it.ground = round1(clamp(it.ground + (y - (Number(it.y) || 0)), lo, hi));
  it.x = x; it.y = y;
  return r;
}
/** Grow or shrink thing `i` by `steps` of SCALE_STEP, inside SCALE_RANGE. */
export function scaleItem(recipe, i, steps = 1) {
  const r = copy(recipe);
  const it = r.items && r.items[i];
  if (!it) return r;
  it.scale = round1(clamp((Number(it.scale) || 1) + steps * SCALE_STEP, SCALE_RANGE[0], SCALE_RANGE[1]));
  if (it.scale === 1) delete it.scale;
  return r;
}
// =====================================================================================================
// THE ONE EDITOR'S ROWS FOR A TOWN PIECE (row 2.145 step 2, 2026-10-31). The Town's pieces are edit-mode targets now
// (modules/town.js editTargets), so the one editor (editor.js) shows a Town piece's place, size and facing under
// Transform, the same rows a room piece has (room_edits.js pieceFields): absolute values, not Rearrange's "move left".
// *** NOT room_edits.js's functions, argued. *** room_edits.js names its pieces by id and stands a thing on the floor by
// the room renderer's rule; Town's drawing is by index and by Town's own rule (`onWall`: everything but a few wall
// pieces stands), and a room piece's edit skips signs and mounts, which Town moves. So the BOUNDS are shared (they are
// these, imported there) and the functions are Town's: the same clamps as moveItem and scaleItem above.
// *** NO TURN. *** Town's flat drawing (town.js placeSvg) draws a size and a flip, never a turn: a Rotation row would
// write a number nothing draws.
// =====================================================================================================
// How far one ‹ or › moves a Town piece: Rearrange's own "Move left" (modules/town.js imports it from here). 4% of the
// room: about a chair's width at the back, a third of one at the front -- fine enough to place a lamp beside a chair,
// coarse enough that crossing the room is ~20 presses, not 100.
export const MOVE_STEP = 4;
const FACING = [{ value: 'drawn', label: 'As drawn' }, { value: 'turned', label: 'Turned round' }];
/** Thing `it`'s rows, as settings_fields.js fields. PURE. */
export function itemFields(it) {
  if (!it || typeof it !== 'object') return [];
  const wall = onWall(it);
  const [lo, hi] = wall ? WALL_Y : FLOOR_Y;
  return [
    { key: 'x', label: 'Left or right', kind: 'number', min: X_RANGE[0], max: X_RANGE[1], step: MOVE_STEP, level: 'essential',
      default: 50, note: '‹ moves it left, › right' },
    wall
      ? { key: 'y', label: 'Higher or lower', kind: 'number', min: lo, max: hi, step: MOVE_STEP, level: 'essential', default: 30,
        note: '‹ moves it up, › down' }
      : { key: 'y', label: 'Nearer or further', kind: 'number', min: lo, max: hi, step: MOVE_STEP, level: 'essential', default: 92,
        note: '‹ moves it further back, › nearer' },
    { key: 'size', label: 'Size', kind: 'number', min: SCALE_RANGE[0], max: SCALE_RANGE[1], step: SCALE_STEP, level: 'essential',
      default: 1, note: '1 is its usual size' },
    { key: 'facing', label: 'Facing', kind: 'choice', level: 'essential', default: 'drawn', options: FACING.map((o) => ({ ...o })) },
  ];
}
/** What those rows show now. PURE. */
export function itemValues(it) {
  if (!it || typeof it !== 'object') return {};
  return { x: Number(it.x) || 0, y: Number(it.y) || 0, size: Number(it.scale) || 1, facing: it.flip ? 'turned' : 'drawn' };
}
/**
 * The recipe with thing `i` changed by `patch` ({ x?, y?, size?, facing? }), absolute values each kept inside moveItem's
 * and scaleItem's bounds; a thing standing on another (`ground`) moves up and down with it. The recipe unchanged (a
 * copy) when there is no thing `i`. PURE.
 */
export function withItemEdit(recipe, i, patch = {}) {
  const r = copy(recipe);
  const it = r.items && r.items[i];
  if (!it || !patch || typeof patch !== 'object') return r;
  if ('x' in patch && Number.isFinite(Number(patch.x))) it.x = round1(clamp(Number(patch.x), X_RANGE[0], X_RANGE[1]));
  if ('y' in patch && Number.isFinite(Number(patch.y))) {
    const [lo, hi] = onWall(it) ? WALL_Y : FLOOR_Y;
    const was = Number(it.y) || 0;
    const y = round1(clamp(Number(patch.y), lo, hi));
    if (Number.isFinite(it.ground)) it.ground = round1(clamp(it.ground + (y - was), lo, hi));
    it.y = y;
  }
  if ('size' in patch && Number.isFinite(Number(patch.size))) {
    const s = round1(clamp(Number(patch.size), SCALE_RANGE[0], SCALE_RANGE[1]));
    if (s === 1) delete it.scale; else it.scale = s;
  }
  if ('facing' in patch) { if (patch.facing === 'turned') it.flip = true; else delete it.flip; }
  return r;
}
// A copy goes 2 steps (8%) to the right of what it copies, or to the left at the right-hand edge. FOR: on top of the
// first it would look like nothing happened; 8% is clear of a chair and still in the same part of the room. AGAINST: a
// wide piece (a sofa) still overlaps its copy -- one or two › presses away.
const COPY_OFFSET = 2 * MOVE_STEP;
/** The recipe with a copy of thing `i` added last (drawn in front), beside it. { recipe, index }: index -1 when the
 * room is full or there is no thing `i`. PURE. */
export function copyItem(recipe, i) {
  const r = copy(recipe);
  r.items = Array.isArray(r.items) ? r.items : [];
  const it = r.items[i];
  if (!it || r.items.length >= RECIPE_MAX_ITEMS) return { recipe: r, index: -1 };
  const c = copy(it);
  const x = Number(c.x) || 0;
  c.x = round1(clamp(x + COPY_OFFSET <= X_RANGE[1] ? x + COPY_OFFSET : x - COPY_OFFSET, X_RANGE[0], X_RANGE[1]));
  r.items.push(c);
  return { recipe: r, index: r.items.length - 1 };
}

export function flipItem(recipe, i) {
  const r = copy(recipe);
  const it = r.items && r.items[i];
  if (!it) return r;
  if (it.flip) delete it.flip; else it.flip = true;
  return r;
}
export function removeItem(recipe, i) {
  const r = copy(recipe);
  if (r.items && r.items[i]) r.items.splice(i, 1);
  return r;
}
/** Add a piece in the middle of its wall or floor. Returns { recipe, index } (index -1: full, or not drawable). */
export function addPiece(recipe, part) {
  const r = copy(recipe);
  r.items = Array.isArray(r.items) ? r.items : [];
  if (!canDraw(part) || r.items.length >= RECIPE_MAX_ITEMS) return { recipe: r, index: -1 };
  r.items.push(isWallPiece(part) ? { kind: 'furniture', part, x: 50, y: 30 } : { kind: 'furniture', part, x: 50, y: 92 });
  return { recipe: r, index: r.items.length - 1 };
}

/** A recipe made safe to keep and to draw (card_deck.js cleanTown), or null if it is not one. */
export function cleanRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return null;
  const c = cleanTown({ p: recipe }).p;
  if (!c || !Array.isArray(c.items)) return null;
  c.items = c.items.filter((it) => it && typeof it === 'object' && (it.kind !== 'furniture' || canDraw(it.part)))
    .slice(0, RECIPE_MAX_ITEMS);
  if (JSON.stringify(c).length > RECIPE_MAX_BYTES) return null;
  return c;
}

/** One theme's edits from a stored row: { placeId: recipe }, a "put back" (null) and anything unusable left out. */
export function editsFor(row, deck) {
  const m = row && typeof row === 'object' && row[deck] && typeof row[deck] === 'object' ? row[deck] : {};
  const out = {};
  for (const id of EDITABLE_PLACES) {
    const c = m[id] ? cleanRecipe(m[id]) : null;
    if (c) out[id] = c;
  }
  return out;
}

/** The recipe a place draws for this person in this theme: their edit, else the theme's own. */
// (The theme's own: the designer's version when nimrod_defaults.js has one, Design's item 42.3; else town.js's.)
export const recipeFor = (id, deck, edits = {}, defaults = NIMROD_DEFAULTS) => placeRecipe(id, deck, edits[id] || defaultFor('town', [deck, id], defaults) || undefined);

/**
 * The store. `makePersonState(personId, key)` and `personId` (a value or a getter) as the host gives them;
 * `fallback`: the panel's own state handle, used when there is no person.
 * Returns { forDeck(deck), save(deck, placeId, recipe), reset(deck, placeId), isPerson(), subscribe(fn), destroy() }.
 */
export function openTownEdits({ makePersonState = null, personId = null, fallback = null } = {}) {
  let handle = null, handleFor = null, offHandle = null, offFallback = null, dead = false;
  const subs = new Set();
  const pid = () => {
    try { const v = typeof personId === 'function' ? personId() : personId; return v ? String(v) : null; } catch { return null; }
  };
  const notify = () => { if (dead) return; for (const fn of [...subs]) { try { fn(); } catch (err) { console.error('town_edits: subscriber', err); } } };
  function close() {
    try { offHandle?.(); } catch { /* gone */ }
    offHandle = null;
    const h = handle;
    handle = null; handleFor = null;
    if (h) Promise.resolve().then(() => h.flush?.()).catch(() => {}).finally(() => { try { h.destroy?.(); } catch { /* gone */ } });
  }
  function ensure() {
    const p = pid();
    if (dead || !p || typeof makePersonState !== 'function' || handleFor === p) return;
    close();
    let h = null;
    try { h = makePersonState(p, TOWN_KEY) || null; } catch (err) { console.error('town_edits: person state', err); h = null; }
    if (!h) return;
    handle = h; handleFor = p;
    Promise.resolve(h.load?.()).catch(() => {}).then(() => notify());
    try { offHandle = h.subscribe?.(() => notify()) || null; } catch { offHandle = null; }
  }
  try { offFallback = fallback?.subscribe?.(() => { if (!handle) notify(); }) || null; } catch { offFallback = null; }
  const row = () => {
    ensure();
    if (handle) return handle.get?.() || {};
    const r = (fallback?.get?.() || {})[TOWN_KEY];
    return r && typeof r === 'object' ? r : {};
  };
  function write(deck, map) {
    ensure();
    if (handle) handle.set?.({ v: TOWN_VERSION, [deck]: map });
    else if (fallback) fallback.set?.({ [TOWN_KEY]: { ...row(), v: TOWN_VERSION, [deck]: map } });
    notify();
  }
  const rawMap = (deck) => { const m = row()[deck]; return m && typeof m === 'object' ? { ...m } : {}; };
  return {
    forDeck: (deck) => editsFor(row(), deck),
    /** Keep `recipe` as this person's version of `placeId` in `deck`. False if it is not a usable recipe. */
    save(deck, placeId, recipe) {
      if (!EDITABLE_PLACES.includes(placeId) || !deck) return false;
      const c = cleanRecipe(recipe);
      if (!c) return false;
      write(deck, { ...rawMap(deck), [placeId]: c });
      return true;
    },
    /** Put a place back to the theme's own version. Written as null: the state handle merges, so a key left out stays. */
    reset(deck, placeId) {
      if (!EDITABLE_PLACES.includes(placeId) || !deck) return false;
      write(deck, { ...rawMap(deck), [placeId]: null });
      return true;
    },
    isPerson: () => { ensure(); return !!handle; },
    subscribe(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); },
    destroy() {
      dead = true;
      subs.clear();
      try { offFallback?.(); } catch { /* gone */ }
      offFallback = null;
      close();
    },
  };
}

/** The person a module's ctx is for: `ctx.personId` is a value or, on some hosts, a getter function. */
export function personOf(ctx = {}) {
  try { const v = ctx.personId; return (typeof v === 'function' ? v() : v) || null; } catch { return null; }
}

/**
 * For a card game: the person's edited places for whichever theme is on screen, ready for card_deck.js
 * `cardArt(..., { town })`. `ctx` is the module's own (it reads `ctx.makePersonState` and `ctx.personId`).
 * `onChange()` when an edit arrives (from this screen's Town or another screen's). `forTheme(siteThemeId)` is null
 * when there are no edits, so the cards draw Design's default town exactly as before.
 */
export function watchTownEdits(ctx = {}, onChange = null) {
  const store = openTownEdits({
    makePersonState: typeof ctx.makePersonState === 'function' ? ctx.makePersonState : null,
    personId: () => personOf(ctx),
  });
  const off = typeof onChange === 'function' ? store.subscribe(() => onChange()) : () => {};
  return {
    forTheme(siteThemeId) {
      const m = store.forDeck(deckFor(siteThemeId));
      return Object.keys(m).length ? m : null;
    },
    stop() { try { off(); } catch { /* gone */ } store.destroy(); },
  };
}
