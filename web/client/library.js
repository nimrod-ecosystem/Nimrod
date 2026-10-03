// library.js — THE MODULES LIBRARY: everything you can put on a screen, in one place, to look through.
//
// Mike, 2026-10-02: *"the shop to add items to your profile. Sandbox/game should also be a toggle on the
// shop (inventory, or items you can add to the scene.) Maybe we should call it something other than the
// shop so people don't think there's money involved. That could actually be the modules module. Where you
// could pick anything to add to any other module. So there could be categories like games, learning,
// visual, furniture, 3d etc. And be able to sort and filter."*
//
// And on Switch module: *"It should probably open the modules module in the place of the module you
// selected to switch. Then you could double click on the module you want in the modules module and it
// would replace the modules module."* And: *"Things like modules, pictures, themes where there are a lot of
// options shouldn't be set up to have to click through them all as default. That could be an option for
// switch users."*
//
// This file is the library itself, with no page and no module around it: the ITEMS (pure), the
// CATEGORIES, sorting and filtering (pure), the AI actions that put a module where another one is, and
// `mountLibrary` — the grid somebody looks through. `modules/library.js` is the module (type `library`,
// titled "Modules"); kiosk.js mounts the same module IN A PANEL'S PLACE for Switch module.
//
// =====================================================================================================
// THE DECISIONS, each argued, each a default (Rule 1) and on Mike's list:
//
// 1. NOT A SHOP, AND NO MONEY WORDS. "Modules" is the title (Mike's own suggestion), "Library" only in
//    code. Nothing here costs anything: the Nimrod Game's unlocks (unlocks.js) are points that "have no
//    real world value", and the library only shows what the game already says, with every way round it.
//
// 2. WHAT IS IN IT: modules (the catalog — the same descriptions the modules page shows), SCENES (the
//    rooms and the live scenes: each is a module with one setting chosen, so it can be put in a place
//    like any module), FURNITURE (the room's pieces) and 3D BRICKS (the published parts list). Furniture
//    and bricks are shown, explained and searchable, but CANNOT BE PUT IN A PANEL'S PLACE: a sofa is not a
//    panel, and putting one piece into a room of your own is not built yet. Their details say exactly
//    that, rather than the library hiding them (D16: dimmed and explained, never hidden).
//
// 3. CATEGORIES ARE TAGS, NOT FOLDERS: Brain games is a game AND learning; Photos is something to look at
//    AND about your people. One item, several chips. Derived from the catalog's own groups where no table
//    entry says otherwise (comfort -> To look at, practice -> Learning, record -> Keeping track), so a new
//    module lands somewhere sensible before anybody files it. The table is the override, and the suite
//    checks every catalog module ends up with at least one known chip.
//
// 4. POINTER, TOUCH AND KEYBOARD FIRST. One press (click, tap, Enter) shows what a thing is; a second
//    press on "Put it here" — or a double click — puts it there. Arrows walk the grid. A switch gets the
//    same stops ONE AT A TIME by default (it is never stranded), and "rows, then items" scanning is an
//    OPTION (`scan: 'rows'`), not the default — Mike: click-through "could be an option for switch users,
//    but would be very frustrating for most people". The search box is for a keyboard and is never a stop.
//
// 5. WHAT IF NOBODY ANSWERS? In another panel's place, the library puts that panel back by itself after
//    `idleMs` with nobody touching it (default two minutes, the room's close-up wait; "Never" is a
//    choice). The panel it covers is hidden, not torn down, so coming back is instant and nothing is lost.
//    As a panel of its own it is just a panel: nothing waits on anybody.
//
// 6. RECENT FIRST. In a panel's place the top row is what the panel WAS (when it has been switched away
//    from it), then the last few modules switched to — the commonest answer is "the one I had a minute
//    ago". Sort: by name (default: predictable for somebody looking for a thing), recently used, most used.

import { CATALOG, USE, NOT_FOR_CAREGIVERS, titleFor } from './modules_catalog.js';
import { FURNITURE, FURNITURE_GROUPS } from './room_parts.js';
import { ROOM_PRESETS } from './room_presets.js';
import { listScenes } from './livescene.js';
import { listManifests, getManifest } from './module.js';
import { lockWords, poolLabel, MODE_OPTIONS, POINTS_DISCLAIMER } from './unlocks.js';
import { registerAIAction } from './nimrod_ai.js';
import { PANEL_LIST_TOPIC, PLACE_MODULE_TOPIC } from './actions.js';

export const LIBRARY_TYPE = 'library';
export const LIBRARY_TITLE = 'Modules';

// ---------------------------------------------------------------------------------------------------
// CATEGORIES (decision 3). The order is the chip order: "Everything" first, then what most people come
// for, the room's things last.
// ---------------------------------------------------------------------------------------------------
export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'all', label: 'Everything' }),
  Object.freeze({ id: 'visual', label: 'To look at' }),
  Object.freeze({ id: 'games', label: 'Games' }),
  Object.freeze({ id: 'learning', label: 'Learning' }),
  Object.freeze({ id: 'people', label: 'People and talking' }),
  Object.freeze({ id: 'tracking', label: 'Keeping track' }),
  Object.freeze({ id: 'tools', label: 'Tools' }),
  Object.freeze({ id: 'scenes', label: 'Scenes' }),
  Object.freeze({ id: 'furniture', label: 'Furniture' }),
  Object.freeze({ id: '3d', label: '3D bricks' }),
]);
export const CATEGORY_IDS = Object.freeze(CATEGORIES.map((c) => c.id));
const GROUP_CATEGORY = Object.freeze({ comfort: 'visual', practice: 'learning', record: 'tracking' });

// The overrides. A module not named here gets its catalog group's chip.
export const MODULE_CATEGORIES = Object.freeze({
  photos: ['visual', 'people'], personal: ['visual', 'people'], youtube: ['visual'], music: ['visual'],
  karaoke: ['visual', 'games'], director: ['visual'], camera: ['visual'], clock: ['visual', 'tools'],
  board: ['people', 'tools'], wallpaper: ['visual'], scene: ['visual', 'scenes'], room: ['visual', 'scenes'],
  note: ['people', 'visual'], avatar: ['people', 'visual'], weather: ['visual'], pond: ['visual', 'games'],
  call: ['people'], pressgame: ['games'], comet: ['games'], comet_ambient: ['visual', 'games'],
  button: ['visual', 'people'], educational: ['learning'], bank: ['learning', 'tools'],
  trivia: ['games', 'learning'], wordforge: ['games', 'learning'], lessons: ['learning'], algebra: ['learning'],
  word_games: ['games', 'learning'], spelling: ['learning', 'games'], think_games: ['learning', 'games'],
  word_builder: ['games', 'learning'], brain_games: ['games', 'learning'], name_that: ['games', 'learning', 'people'],
  solitaire: ['games'], brickbreaker: ['games'], rhythm: ['games'], sprint: ['tools'], quests: ['games', 'tracking'],
  progress: ['tracking'], calculator: ['tools'], reading_log: ['tracking'], scoreboard: ['tracking', 'games'],
  voice_review: ['tracking'], nimrod: ['tools'], devices: ['tools'], whats_new: ['tools'], library: ['tools'],
});
export function categoriesFor(entry) {
  const own = MODULE_CATEGORIES[entry && entry.type];
  if (Array.isArray(own) && own.length) return [...own];
  const g = GROUP_CATEGORY[entry && entry.group];
  return g ? [g] : ['tools'];
}

// ---------------------------------------------------------------------------------------------------
// THE ITEMS (pure). One shape for every kind:
//   { key, kind, id, title, lead, why, needs, note, use, cats, type, settings, placeable, why_not, link }
// `type` is the module a pick puts in the place; `settings` the one choice made on it (a scene).
// `lockKey` is what the Nimrod Game is asked about (only modules are ever locked — unlocks.js).
// ---------------------------------------------------------------------------------------------------
const KIND_LABELS = Object.freeze({ module: 'Module', scene: 'Scene', furniture: 'Furniture', brick: '3D brick' });
export const kindLabel = (k) => KIND_LABELS[k] || k;
const FURNITURE_WHY_NOT = 'A piece of furniture goes in a room, not in a panel’s place. The rooms under Scenes come '
  + 'furnished; putting one piece into a room of your own is not built yet.';
const BRICK_WHY_NOT = 'A brick is a printable part, not something a panel shows. Its 3D model is published: open it to '
  + 'look at it or print it.';

export function moduleItems({ catalog = CATALOG, manifests = listManifests() } = {}) {
  const registered = new Set((manifests || []).map((m) => m && m.type).filter(Boolean));
  return catalog.filter((c) => registered.has(c.type) && !NOT_FOR_CAREGIVERS[c.type]).map((c) => ({
    key: `module:${c.type}`, kind: 'module', id: c.type, type: c.type, title: titleFor(c, manifests),
    lead: c.lead, why: c.why, needs: c.needs, note: c.note || '', use: c.use, group: c.group,
    cats: categoriesFor(c), settings: null, placeable: true, whyNot: '', link: '', lockKey: `module:${c.type}`,
  }));
}

export function sceneItems({ presets = ROOM_PRESETS, scenes = null, manifests = listManifests() } = {}) {
  const has = (t) => (manifests || []).some((m) => m && m.type === t);
  const out = [];
  if (has('room')) {
    for (const [id, p] of Object.entries(presets || {})) {
      out.push({ key: `scene:room:${id}`, kind: 'scene', id: `room:${id}`, type: 'room', title: p.label,
        lead: 'A room to look into, furnished, with a clock and a calendar on the wall.',
        why: 'A Room panel showing this room. Everything about it can be changed afterwards in that panel’s settings.',
        needs: 'Nothing.', note: '', use: 'touch', group: 'comfort', cats: ['scenes', 'visual'],
        settings: { preset: id }, placeable: true, whyNot: '', link: '', lockKey: 'module:room' });
    }
  }
  if (has('scene')) {
    let list = scenes;
    if (!Array.isArray(list)) { try { list = listScenes(); } catch { list = []; } }
    for (const s of list) {
      out.push({ key: `scene:live:${s.value}`, kind: 'scene', id: `live:${s.value}`, type: 'scene', title: s.label,
        lead: 'A calm animated world that never asks for anything.',
        why: 'A Live scene panel showing this world. Its movement can be slowed or stopped in that panel’s settings.',
        needs: 'Nothing.', note: '', use: 'watch', group: 'comfort', cats: ['scenes', 'visual'],
        settings: { scene: s.value }, placeable: true, whyNot: '', link: '', lockKey: 'module:scene' });
    }
  }
  return out;
}

export function furnitureItems({ furniture = FURNITURE, groups = FURNITURE_GROUPS } = {}) {
  const groupOf = (id) => (groups.find(([, ids]) => ids.includes(id)) || ['Furniture'])[0];
  return Object.entries(furniture || {}).map(([id, f]) => ({
    key: `furniture:${id}`, kind: 'furniture', id, type: null, title: f.label,
    lead: `${groupOf(id)}: ${f.on === 'wall' ? 'hangs on the wall' : 'stands on the floor'}.`,
    why: 'One of the pieces the rooms are built from, drawn with Claude Design.',
    needs: 'A room.', note: '', use: null, group: null, cats: ['furniture'], settings: null,
    placeable: false, whyNot: FURNITURE_WHY_NOT, link: '', lockKey: `furniture:${id}`,
  }));
}

/** The published parts list (design-assets/bricks/bricks.json), as items. Anything malformed is skipped. */
export function brickItems(doc) {
  const objs = doc && Array.isArray(doc.objects) ? doc.objects : [];
  return objs.filter((o) => o && typeof o.id === 'string').map((o) => {
    const dims = Array.isArray(o.dims_mm) ? o.dims_mm.join(' × ') : '';
    return {
      key: `brick:${o.id}`, kind: 'brick', id: o.id, type: null, title: String(o.title || o.id),
      lead: `${dims ? `${dims} mm` : 'A brick'}${Number.isFinite(o.sockets) ? `, ${o.sockets} sockets` : ''}.`,
      why: 'A basic Nimrod brick: every side in 40 mm steps, with a socket at the centre of every 40 mm cell, '
        + 'so any two fit together.',
      needs: o.fits_bed_256 === false ? 'A printer bed bigger than 256 mm.' : 'A 3D printer, if you want one in your hand.',
      note: '', use: null, group: null, cats: ['3d'], settings: null, placeable: false, whyNot: BRICK_WHY_NOT,
      link: typeof o.glb === 'string' ? o.glb : '', lockKey: `brick:${o.id}`,
      // Its picture (Blender/render_bricks.py, beside the GLBs) and its card on the bricks page.
      picture: `/design-assets/bricks/renders/${o.id}_sm.png`, page: `/bricks.html#${o.id}`,
    };
  });
}

export function libraryItems(opts = {}) {
  return [...moduleItems(opts), ...sceneItems(opts), ...furnitureItems(opts), ...brickItems(opts.bricks || null)];
}

// ---------------------------------------------------------------------------------------------------
// FILTER, SEARCH AND SORT (pure).
// ---------------------------------------------------------------------------------------------------
export const SORTS = Object.freeze([
  Object.freeze({ id: 'name', label: 'By name' }),
  Object.freeze({ id: 'recent', label: 'Recently used' }),
  Object.freeze({ id: 'most', label: 'Most used' }),
]);
export const USE_FILTERS = Object.freeze([
  Object.freeze({ id: 'any', label: 'Anything' }),
  ...Object.entries(USE).map(([id, u]) => Object.freeze({ id, label: u.label })),
]);
const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || id;
export function haystack(it) {
  return [it.title, it.lead, it.why, it.needs, it.note, it.type, it.id, kindLabel(it.kind), ...(it.cats || []).map(catLabel)]
    .filter(Boolean).join(' ').toLowerCase();
}
/** Every typed word must appear somewhere in the item's words, any order, any case. */
export function filterItems(items, { category = 'all', use = 'any', query = '' } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (items || []).filter((it) => {
    if (category && category !== 'all' && !(it.cats || []).includes(category)) return false;
    if (use && use !== 'any' && it.use !== use) return false;
    if (!words.length) return true;
    const h = haystack(it);
    return words.every((w) => h.includes(w));
  });
}
/** `usage`: { recent: [type...] newest first, counts: { type: n } }. Ties go by name. */
export function sortItems(items, sort = 'name', usage = {}) {
  const recent = Array.isArray(usage && usage.recent) ? usage.recent : [];
  const counts = (usage && usage.counts) || {};
  const byName = (a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' });
  const rank = (it) => { const i = it.type ? recent.indexOf(it.type) : -1; return i < 0 ? Infinity : i; };
  const n = (it) => (it.type && Number(counts[it.type])) || 0;
  const list = [...(items || [])];
  if (sort === 'recent') return list.sort((a, b) => (rank(a) - rank(b)) || byName(a, b));
  if (sort === 'most') return list.sort((a, b) => (n(b) - n(a)) || byName(a, b));
  return list.sort(byName);
}

// ---------------------------------------------------------------------------------------------------
// NAMES, AS SOMEBODY SAYS THEM (for the AI actions): "the clock module", "Word Forge", "word_forge".
// ---------------------------------------------------------------------------------------------------
export function normName(s) {
  return String(s || '').toLowerCase().replace(/[’'"“”]/g, '').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|my|module|panel|one|please|now)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
/** A module type from what somebody called it, or null. Only modules the library offers. */
export function resolveModuleName(name, { manifests = listManifests(), catalog = CATALOG } = {}) {
  const n = normName(name);
  if (!n) return null;
  const types = moduleItems({ catalog, manifests });
  const variants = new Set([n, n.replace(/s$/, ''), `${n}s`]);
  const hit = types.find((it) => variants.has(normName(it.type.replace(/_/g, ' '))) || variants.has(it.type)
    || variants.has(normName(it.title)) || variants.has(normName(getManifest(it.type)?.title || '')));
  return hit ? hit.type : null;
}
/** A panel ({ id, type, title }) from an id, a title or a module's name. */
export function resolvePanel(where, panels = [], opts = {}) {
  const raw = String(where || '').trim();
  if (!raw || !Array.isArray(panels)) return null;
  const exact = panels.find((p) => p && p.id === raw);
  if (exact) return exact;
  const n = normName(raw);
  if (!n) return null;
  const byTitle = panels.find((p) => p && normName(p.title) === n);
  if (byTitle) return byTitle;
  const type = resolveModuleName(raw, opts);
  return panels.find((p) => p && (p.type === type || normName(String(p.type).replace(/_/g, ' ')) === n)) || null;
}
/** "calendar where the clock is" / "calendar | clock" -> { module, where }. */
export function parsePlaceArg(arg) {
  const s = String(arg || '').trim().replace(/^["“']|["”']$/g, '').replace(/[.!?]+$/, '');
  const m = s.match(/^(.+?)\s+where\s+(.+?)(?:\s+is(?:\s+now)?)?$/i)
    || s.match(/^(.+?)\s*[|,;]\s*(.+)$/)
    || s.match(/^(.+?)\s+(?:in place of|instead of)\s+(.+)$/i)
    || s.match(/^(.+?)\s+(?:in|into|over)\s+(.+)$/i);
  return m ? { module: m[1].trim(), where: m[2].trim() } : null;
}
/** "clock to calculator" / "clock for calculator" / "clock | calculator" -> { from, to }. */
export function parseSwapArg(arg) {
  const s = String(arg || '').trim().replace(/^["“']|["”']$/g, '').replace(/[.!?]+$/, '');
  const m = s.match(/^(.+?)\s+(?:to|for|with|into)\s+(.+)$/i) || s.match(/^(.+?)\s*[|,;]\s*(.+)$/);
  return m ? { from: m[1].trim(), to: m[2].trim() } : null;
}

// ---------------------------------------------------------------------------------------------------
// THE AI ACTIONS (nimrod_ai.js `registerAIAction`). Mike: *"If you have AI hooked up, you'd want to be able
// to say something like put the calendar module where the clock module is now, please."* Asked for, never
// taken: they wait for a press like every other AI action. Both end in the SAME place as the Switch
// module button — the library in that panel's place, the module picked — so the Nimrod Game's lock is
// asked exactly as it is for a press, and a locked module shows its ways to unlock instead.
//   place  [[place <module> where <panel>]]   the panel becomes that module
//   swap   [[swap <panel> to <module>]]       the same move, named from the panel's side
// WHY TWO NAMES FOR ONE MOVE: a small local model is better at copying the shape the person's sentence
// already had than at reordering it; "swap the clock for the calculator" and "put the calculator where the
// clock is" are both common. (Exchanging two panels' places is a different move and needs the arrangement
// to say where each one is; not built.)
// The panels are ASKED FOR on the bus (`PANEL_LIST_TOPIC`, answered synchronously by the kiosk), so a
// request naming a panel that is not on this screen is ignored before it is ever offered as a button.
// ---------------------------------------------------------------------------------------------------
function askPanels(env) {
  if (Array.isArray(env && env.panels)) return env.panels;
  let list = null;
  try { env?.publish?.(PANEL_LIST_TOPIC, { reply: (l) => { list = Array.isArray(l) ? l : []; } }); } catch { list = null; }
  return list;
}
const moduleTitle = (type) => titleFor({ type, title: (CATALOG.find((c) => c.type === type) || {}).title }, listManifests());
function placeValue(module, where, env) {
  const type = resolveModuleName(module);
  if (!type) return null;
  const panel = resolvePanel(where, askPanels(env) || []);
  return panel ? { type, panel } : null;
}
const offeredTypes = () => CATALOG.filter((c) => !NOT_FOR_CAREGIVERS[c.type]).map((c) => c.type).join(', ');
export const LIBRARY_AI_ACTIONS = Object.freeze([
  Object.freeze({
    name: 'place', args: '<module> where <panel>',
    help: `put a module where a panel on this screen is (the panel's own settings are kept for switching back). Modules: ${offeredTypes()}`,
    check: (arg, env) => {
      const p = parsePlaceArg(arg);
      const v = p && placeValue(p.module, p.where, env);
      return v ? `${v.type} where ${v.panel.id}` : null;
    },
    describe: (value, env) => {
      const p = parsePlaceArg(value); const v = p && placeValue(p.module, p.where, env);
      return v ? `Put ${moduleTitle(v.type)} where ${v.panel.title || moduleTitle(v.panel.type)} is` : 'Put a module in a panel’s place';
    },
    run: (value, env) => {
      const p = parsePlaceArg(value); const v = p && placeValue(p.module, p.where, env);
      if (v) env?.publish?.(PLACE_MODULE_TOPIC, { id: v.panel.id, type: v.type, from: 'ai' });
    },
  }),
  Object.freeze({
    name: 'swap', args: '<panel> to <module>',
    help: 'switch a panel on this screen to another module, in the same place (the same move as place)',
    check: (arg, env) => {
      const p = parseSwapArg(arg);
      const v = p && placeValue(p.to, p.from, env);
      return v ? `${v.panel.id} to ${v.type}` : null;
    },
    describe: (value, env) => {
      const p = parseSwapArg(value); const v = p && placeValue(p.to, p.from, env);
      return v ? `Switch ${v.panel.title || moduleTitle(v.panel.type)} to ${moduleTitle(v.type)}` : 'Switch a panel to another module';
    },
    run: (value, env) => {
      const p = parseSwapArg(value); const v = p && placeValue(p.to, p.from, env);
      if (v) env?.publish?.(PLACE_MODULE_TOPIC, { id: v.panel.id, type: v.type, from: 'ai' });
    },
  }),
]);
let aiOffs = null;
/** Registers `place` and `swap` with the AI's allow-list (once; again is a no-op). Returns the unregister. */
export function registerLibraryAIActions() {
  if (aiOffs) return aiOffs.off;
  const offs = LIBRARY_AI_ACTIONS.map((a) => registerAIAction(a));
  aiOffs = { off: () => { offs.forEach((f) => { try { f(); } catch { /* gone */ } }); aiOffs = null; } };
  return aiOffs.off;
}

// ---------------------------------------------------------------------------------------------------
// THE SETTINGS (Rule 1), declared here so the module and the switch host read the same ones.
//   sort 'name'       decision 6.
//   scan 'follow'     decision 4, through the person's own "How you choose things" (settings_fields.js
//                     CHOOSE_MODE_FIELD, 6fd7575): "point and click" (everybody's default) walks one stop at a
//                     time; "step through" (for a switch) scans rows, then the things in a row. One choice for
//                     every long list, rather than a second switch here that could disagree with it; "Off" and
//                     "Rows" are still here for a library that should differ.
//   cardSize 'medium' 150 px cards: four across a quarter of a 1280 screen, a title readable at arm's length.
//   idleMs 120000     decision 5.
// ---------------------------------------------------------------------------------------------------
export const CARD_SIZES = Object.freeze({ small: 112, medium: 150, large: 210 });
export const LIBRARY_DEFAULTS = Object.freeze({ sort: 'name', scan: 'follow', cardSize: 'medium', idleMs: 120000 });
export const LIBRARY_SETTINGS = Object.freeze([
  { key: 'sort', label: 'Order', kind: 'choice', default: LIBRARY_DEFAULTS.sort, level: 'essential',
    options: SORTS.map((s) => ({ value: s.id, label: s.label })),
    help: 'How the library is ordered. The few you used last are always in the row at the top as well.' },
  { key: 'scan', label: 'Switch scanning', kind: 'choice', default: LIBRARY_DEFAULTS.scan, level: 'standard',
    options: [{ value: 'follow', label: 'As “How you choose things” says' }, { value: 'off', label: 'Off — one thing at a time' },
      { value: 'rows', label: 'Rows, then the things in a row' }],
    help: 'For a switch: walk a row at a time and go into the row you want, instead of every card in turn.' },
  { key: 'cardSize', label: 'Card size', kind: 'choice', default: LIBRARY_DEFAULTS.cardSize, level: 'standard',
    options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }],
    help: 'Bigger cards are easier to read and to hit; smaller ones fit more on the screen.' },
  { key: 'idleMs', label: 'In another panel’s place, put it back after', kind: 'choice', default: LIBRARY_DEFAULTS.idleMs,
    level: 'standard',
    options: [{ value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' }, { value: 300000, label: '5 minutes' },
      { value: 0, label: 'Never' }],
    help: 'When Switch module opens the library in a panel’s place and nobody touches it, the panel comes back by itself.' },
]);

// ---------------------------------------------------------------------------------------------------
// THE GRID (DOM). `mountLibrary(root, opts)` -> { verb, next, prev, select, back, refresh, destroy, __probe }.
//   items      [] or () => []          what to show (libraryItems)
//   moreItems  async () => []          added when it resolves (the bricks list, fetched)
//   host       { mode: 'switch'|'panel', target: { id, type, title, base }, usage(), place(item), cancel(why),
//                bigger(), focus, autoPlace }   — null: browse only (nothing can be put anywhere)
//   gate       an unlocks.js gate handle (or null: everything open)
//   prefs      { sort, scan, cardSize, idleMs, category, use } ; onPrefs(patch) saves a change
//   say(text)  reads a detail aloud (optional)
//   keys       true: handle arrow keys / Enter / Escape itself (a page with no input runtime). A key the
//              page's own keyboard already took (defaultPrevented) is left alone, so nothing moves twice.
// ---------------------------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS_ID = 'library-css';
const CSS = `
.lib{box-sizing:border-box;height:100%;width:100%;display:flex;flex-direction:column;gap:6px;padding:10px;
  color:var(--text);background:var(--surface);font:inherit;position:relative;overflow:hidden;min-height:0}
.lib *{box-sizing:border-box}
.lib button,.lib select,.lib input{font:inherit;color:var(--text)}
.lib-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lib-head h3{margin:0;font-size:1.05rem;flex:1 1 auto;min-width:6em}
.lib-btn{border:1px solid var(--border);background:var(--surface-alt,var(--surface));border-radius:10px;padding:6px 12px;
  cursor:pointer;min-height:40px}
.lib-btn[disabled]{opacity:.55;cursor:default}
.lib-btn.primary{border-color:var(--accent);font-weight:600}
.lib-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.lib-tools input[type=search]{flex:1 1 9em;min-width:7em;padding:7px 10px;border-radius:10px;border:1px solid var(--border);
  background:var(--bg,var(--surface))}
.lib-tools select{padding:7px 8px;border-radius:10px;border:1px solid var(--border);background:var(--bg,var(--surface));max-width:100%}
.lib-more{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.lib-more[hidden]{display:none}
.lib-small{font-size:.85rem;color:var(--text-muted)}
.lib-row{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;flex:0 0 auto;padding:2px 2px 4px;scrollbar-width:thin}
.lib-row[hidden]{display:none}
.lib-row .lib-label{align-self:center;flex:0 0 auto}
.lib-chip{flex:0 0 auto;border:1px solid var(--border);background:var(--surface-alt,var(--surface));border-radius:999px;
  padding:5px 12px;cursor:pointer;min-height:36px;white-space:nowrap}
.lib-chip[aria-pressed=true]{border-color:var(--accent);font-weight:600;box-shadow:inset 0 0 0 1px var(--accent)}
.lib-grid{flex:1 1 auto;min-height:0;overflow:auto;display:grid;gap:8px;align-content:start;padding:2px;
  grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--lib-card,150px)),1fr))}
.lib-card{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;border:1px solid var(--border);
  background:var(--surface-alt,var(--surface));border-radius:12px;padding:9px 10px;cursor:pointer;min-height:84px}
.lib-card[aria-selected=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.lib-card .t{font-weight:600;line-height:1.2}
.lib-card .l{font-size:.85rem;color:var(--text-muted);line-height:1.25;display:-webkit-box;-webkit-line-clamp:3;
  -webkit-box-orient:vertical;overflow:hidden}
.lib-badge{font-size:.75rem;border:1px solid var(--border);border-radius:999px;padding:0 7px;color:var(--text-soft,var(--text-muted))}
.lib-card.is-off .t{color:var(--text-muted)}
.lib .is-scan{outline:3px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.lib .is-row{outline:2px dashed var(--scan-ring, var(--highlight));outline-offset:2px;border-radius:12px}
.lib-detail{position:absolute;left:8px;right:8px;bottom:8px;max-height:72%;overflow:auto;background:var(--surface);
  border:2px solid var(--accent);border-radius:14px;padding:12px 14px;z-index:2}
.lib-detail[hidden]{display:none}
.lib-detail h4{margin:0 0 4px;font-size:1.05rem}
.lib-detail p{margin:4px 0}
.lib-detail .lib-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.lib-note{min-height:1.2em}
.lib-empty{grid-column:1/-1;padding:12px;color:var(--text-muted)}
`;
function ensureCss(doc) {
  if (!doc || doc.getElementById(CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = CSS_ID;
  st.textContent = CSS;
  (doc.head || doc.documentElement).append(st);
}
const RECENT_MAX = 6;   // kiosk.js SWITCH_RECENT_MAX argues six

export function mountLibrary(root, {
  items = [], moreItems = null, host = null, gate = null, prefs = {}, onPrefs = null, say = null, keys = true,
  chooseMode = null,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
} = {}) {
  const doc = root.ownerDocument;
  ensureCss(doc);
  const win = doc.defaultView;
  let torn = false;
  const base = () => (typeof items === 'function' ? (items() || []) : [...(items || [])]);
  let extra = [];             // what `moreItems` brought (the bricks), kept across a refresh
  let all = base();
  const p = { ...LIBRARY_DEFAULTS, category: 'all', use: 'any', ...(prefs || {}) };
  let query = '';
  let detail = null;          // the item whose details are open
  let armed = null;           // 'buy' armed for the open item
  let note = '';
  let busy = false;
  let showMore = false;
  // THE CURSOR. items mode: an index into the flat stops. rows mode: { row, item } (item -1 = the row lit).
  let cur = -1;
  let row = -1; let inRow = -1;
  let idleT = null;
  const mode = host && host.mode ? host.mode : 'browse';
  // How a switch walks it: the library's own choice, or (`follow`) the person's "How you choose things".
  const scanMode = () => {
    if (p.scan === 'rows' || p.scan === 'off') return p.scan;
    let m = 'point';
    try { m = typeof chooseMode === 'function' ? chooseMode() : chooseMode; } catch { m = 'point'; }
    return m === 'step' ? 'rows' : 'off';
  };
  const target = (host && host.target) || null;

  const usage = () => { try { return (host && host.usage && host.usage()) || { recent: [], counts: {} }; } catch { return { recent: [], counts: {} }; } };
  const lockOf = (it) => {
    if (!gate || !it || !it.lockKey) return null;
    try { const s = gate.check(it.lockKey); return s && s.locked ? s : null; } catch { return null; }
  };
  const gateMode = () => { try { return gate ? gate.mode() : 'sandbox'; } catch { return 'sandbox'; } };
  const canPlace = () => !!(host && typeof host.place === 'function');
  const placeWord = mode === 'switch' ? 'Put it here' : 'Use it here';

  root.innerHTML = '';
  const el = doc.createElement('div');
  el.className = 'lib';
  el.dataset.mode = mode;
  el.innerHTML = `
    <div class="lib-head" data-lib-head></div>
    <div class="lib-tools">
      <input type="search" data-lib-q placeholder="Search" aria-label="Search the library">
      <select data-lib-sort aria-label="Order">${SORTS.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>
      <button type="button" class="lib-btn" data-lib-act="more" aria-expanded="false">Filters…</button>
    </div>
    <div class="lib-more" data-lib-more hidden>
      <label class="lib-small">Asks of them <select data-lib-use>${USE_FILTERS.map((u) => `<option value="${u.id}">${esc(u.label)}</option>`).join('')}</select></label>
      <label class="lib-small">The game <select data-lib-mode ${gate ? '' : 'disabled'}>${MODE_OPTIONS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label class="lib-small">Switch scanning <select data-lib-scan><option value="follow">As you choose things</option><option value="off">One at a time</option><option value="rows">Rows, then items</option></select></label>
      <label class="lib-small">Cards <select data-lib-size><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <span class="lib-small" data-lib-disclaimer></span>
    </div>
    <div class="lib-row" data-lib-recent></div>
    <div class="lib-row" data-lib-cats role="toolbar" aria-label="Categories"></div>
    <div class="lib-small lib-note" data-lib-note role="status" aria-live="polite"></div>
    <div class="lib-grid" data-lib-grid role="listbox" aria-label="Everything you can put here"></div>
    <div class="lib-detail" data-lib-detail hidden></div>`;
  root.append(el);
  const $ = (s) => el.querySelector(s);
  const qEl = $('[data-lib-q]');

  function savePrefs(patch) {
    Object.assign(p, patch);
    try { onPrefs?.(patch); } catch (err) { console.error('library: prefs', err); }
  }
  const visible = () => sortItems(filterItems(all, { category: p.category, use: p.use, query }), p.sort, usage());
  const byKey = (k) => all.find((it) => it.key === k) || null;
  function recentItems() {
    const u = usage();
    const out = [];
    const seen = new Set();
    const add = (type, hint) => {
      if (!type || seen.has(type) || (target && type === target.type)) return;
      const it = byKey(`module:${type}`);
      if (!it) return;
      seen.add(type);
      out.push({ it, hint });
    };
    if (target && target.base && target.base !== target.type) add(target.base, 'what this panel was');
    for (const t of (u.recent || [])) { if (out.length >= RECENT_MAX) break; add(t, 'recent'); }
    return out;
  }

  // ---- drawing ----
  function drawHead() {
    const h = $('[data-lib-head]');
    const title = mode === 'switch' && target ? `Switch ${target.title || target.type} to…` : LIBRARY_TITLE;
    h.innerHTML = (mode === 'switch' && target
      ? `<button type="button" class="lib-btn primary" data-lib-act="cancel" title="put it back as it was">Keep ${esc(target.title || target.type)}</button>` : '')
      + `<h3>${esc(title)}</h3>`
      + (mode === 'switch' && host && typeof host.bigger === 'function'
        ? '<button type="button" class="lib-btn" data-lib-act="bigger" title="more room to look through">Bigger</button>' : '');
  }
  function cardHtml(it, sel) {
    const lock = lockOf(it);
    const badges = [];
    if (it.kind !== 'module') badges.push(kindLabel(it.kind));
    if (lock) badges.push('locked');
    if (!it.placeable && mode !== 'browse') badges.push('not for a panel');
    return `<button type="button" class="lib-card${!it.placeable || lock ? ' is-off' : ''}" role="option" data-lib-key="${esc(it.key)}"
      aria-selected="${sel ? 'true' : 'false'}" data-help="${esc(it.lead)}" data-help-title="${esc(it.title)}">
      <span class="t">${esc(it.title)}</span><span class="l">${esc(it.lead)}</span>
      ${badges.length ? `<span>${badges.map((b) => `<span class="lib-badge">${esc(b)}</span>`).join(' ')}</span>` : ''}</button>`;
  }
  function draw() {
    if (torn) return;
    drawHead();
    el.style.setProperty('--lib-card', `${CARD_SIZES[p.cardSize] || CARD_SIZES.medium}px`);
    $('[data-lib-sort]').value = p.sort;
    $('[data-lib-use]').value = p.use;
    $('[data-lib-scan]').value = p.scan;
    $('[data-lib-size]').value = p.cardSize;
    const gm = gateMode();
    $('[data-lib-mode]').value = gm;
    $('[data-lib-disclaimer]').textContent = gm === 'sandbox' ? 'Sandbox: nothing is locked.' : POINTS_DISCLAIMER;
    $('[data-lib-more]').hidden = !showMore;
    $('[data-lib-act="more"]').setAttribute('aria-expanded', String(showMore));
    const rec = recentItems();
    const rEl = $('[data-lib-recent]');
    rEl.hidden = !rec.length;
    rEl.innerHTML = rec.length ? `<span class="lib-small lib-label">Recent</span>${rec.map(({ it, hint }) =>
      `<button type="button" class="lib-chip" data-lib-key="${esc(it.key)}" data-lib-recent-key="${esc(it.key)}" title="${esc(hint)}">${esc(it.title)}${hint === 'what this panel was' ? ' (was)' : ''}</button>`).join('')}` : '';
    $('[data-lib-cats]').innerHTML = CATEGORIES.map((c) =>
      `<button type="button" class="lib-chip" data-lib-cat="${c.id}" aria-pressed="${p.category === c.id}">${esc(c.label)}</button>`).join('');
    const list = visible();
    $('[data-lib-grid]').innerHTML = list.length ? list.map((it) => cardHtml(it, detail && detail.key === it.key)).join('')
      : `<div class="lib-empty">Nothing matches. <button type="button" class="lib-btn" data-lib-act="clear">Show everything</button></div>`;
    $('[data-lib-note]').textContent = note;
    drawDetail();
    paintCursor();
  }
  function drawDetail() {
    const d = $('[data-lib-detail]');
    if (!detail) { d.hidden = true; d.innerHTML = ''; return; }
    const it = detail;
    const lock = lockOf(it);
    const gm = gateMode();
    const words = lock ? lockWords(lock, it.title, gm) : null;
    const u = it.use && USE[it.use] ? `${USE[it.use].label}. ${USE[it.use].hint}` : '';
    const acts = [];
    if (lock) {
      const pts = poolLabel(gm);
      const then = canPlace() && it.placeable ? (mode === 'switch' ? ' and put it here' : ' and use it here') : '';
      acts.push(`<button type="button" class="lib-btn primary" data-lib-act="buy" ${lock.canBuy ? '' : 'disabled'}
        title="${esc(lock.canBuy ? 'two presses: the second one spends them' : 'not enough points yet')}">${esc(armed === 'buy'
        ? `Press again: use ${lock.cost} ${pts}${then}` : `Use ${lock.cost} ${pts}${then}`)}</button>`);
      if (lock.canFree) acts.push(`<button type="button" class="lib-btn" data-lib-act="free">${esc(`Unlock it free${then}`)}</button>`);
      acts.push(`<button type="button" class="lib-btn" data-lib-act="sandbox">${esc(`Sandbox: unlock everything${then}`)}</button>`);
    } else if (it.placeable && canPlace()) {
      acts.push(`<button type="button" class="lib-btn primary" data-lib-act="place" ${busy ? 'disabled' : ''}>${esc(placeWord)}</button>`);
    }
    if (it.link) acts.push(`<a class="lib-btn" href="${esc(it.link)}" target="_blank" rel="noopener" data-lib-act="link">Open the 3D model</a>`);
    if (it.page) acts.push(`<a class="lib-btn" href="${esc(it.page)}" target="_blank" rel="noopener" data-lib-act="page">See every brick</a>`);
    acts.push('<button type="button" class="lib-btn" data-lib-act="close">Back to the list</button>');
    const why = !it.placeable ? it.whyNot
      : !canPlace() ? 'Open Modules on a dashboard (or Switch module there) to put this somewhere.' : '';
    d.innerHTML = `<h4>${esc(it.title)} <span class="lib-badge">${esc(kindLabel(it.kind))}</span></h4>
      ${it.picture ? `<img class="lib-pic" data-lib-pic src="${esc(it.picture)}" alt="" width="96" height="96" loading="lazy" style="float:right;margin:0 0 6px 10px">` : ''}
      <p>${esc(it.lead)}</p>${u ? `<p class="lib-small">${esc(u)}</p>` : ''}
      <p>${esc(it.why)}</p><p class="lib-small">What it needs: ${esc(it.needs)}</p>
      ${it.note ? `<p class="lib-small">${esc(it.note)}</p>` : ''}
      ${words ? `<p data-lib-lock>${esc(words.why)} ${esc(words.how)}</p>` : ''}
      ${why ? `<p class="lib-small" data-lib-whynot>${esc(why)}</p>` : ''}
      <div class="lib-acts">${acts.join('')}</div>`;
    d.hidden = false;
  }

  // ---- the stops a switch / keyboard walks ----
  const q = (s) => [...el.querySelectorAll(s)];
  function headStops() { return q('[data-lib-head] button'); }
  function rows() {
    if (detail) return [q('[data-lib-detail] .lib-acts > *')];
    const out = [];
    const head = headStops(); if (head.length) out.push(head);
    const rec = q('[data-lib-recent] .lib-chip'); if (rec.length) out.push(rec);
    out.push(q('[data-lib-cats] .lib-chip'));
    const cards = q('[data-lib-grid] .lib-card');
    const empty = q('[data-lib-grid] .lib-empty button');
    if (!cards.length) { if (empty.length) out.push(empty); return out.filter((r) => r.length); }
    // A grid row is the cards sharing a top edge (laid out); with no layout (a hidden document, a box
    // not on screen yet) it falls back to four across.
    const tops = cards.map((c) => c.offsetTop);
    if (cards[0].offsetWidth > 0) {
      let r = []; let t = tops[0];
      cards.forEach((c, i) => { if (tops[i] !== t) { out.push(r); r = []; t = tops[i]; } r.push(c); });
      if (r.length) out.push(r);
    } else {
      for (let i = 0; i < cards.length; i += 4) out.push(cards.slice(i, i + 4));
    }
    return out.filter((r) => r.length);
  }
  const flat = () => rows().flat();
  function paintCursor() {
    for (const n of q('.is-scan,.is-row')) n.classList.remove('is-scan', 'is-row');
    let lit = null;
    if (scanMode() === 'rows' && !detail) {
      const rs = rows();
      if (row >= 0 && row < rs.length) {
        if (inRow >= 0 && inRow < rs[row].length) { lit = rs[row][inRow]; lit.classList.add('is-scan'); }
        else rs[row].forEach((n) => n.classList.add('is-row'));
      }
    } else {
      const f = flat();
      if (cur >= 0 && cur < f.length) { lit = f[cur]; lit.classList.add('is-scan'); }
    }
    if (lit) { try { lit.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* old browser */ } }
    else if (scanMode() === 'rows' && row >= 0) { try { rows()[row]?.[0]?.scrollIntoView?.({ block: 'nearest' }); } catch { /* old browser */ } }
  }
  const litEl = () => {
    if (scanMode() === 'rows' && !detail) { const rs = rows(); return rs[row] && inRow >= 0 ? rs[row][inRow] || null : null; }
    return flat()[cur] || null;
  };
  function step(d) {
    poke();
    if (scanMode() === 'rows' && !detail) {
      const rs = rows();
      if (!rs.length) return;
      if (inRow >= 0) { const n = rs[row].length; inRow = ((inRow + d) % n + n) % n; }
      else row = row < 0 ? (d > 0 ? 0 : rs.length - 1) : ((row + d) % rs.length + rs.length) % rs.length;
    } else {
      const n = flat().length;
      if (!n) return;
      cur = cur < 0 ? (d > 0 ? 0 : n - 1) : ((cur + d) % n + n) % n;
    }
    paintCursor();
  }
  // Up / down in the grid: a whole row of cards (items mode); in rows mode, the rows.
  function vertical(d) {
    if (scanMode() === 'rows' || detail) { step(d); return; }
    const f = flat();
    const at = f[cur];
    const rs = rows();
    const ri = rs.findIndex((r) => r.includes(at));
    if (ri < 0) { step(d); return; }
    const col = rs[ri].indexOf(at);
    const nr = rs[Math.max(0, Math.min(rs.length - 1, ri + d))];
    const tgt = nr[Math.min(col, nr.length - 1)];
    cur = f.indexOf(tgt);
    poke(); paintCursor();
  }
  function selectVerb() {
    poke();
    if (scanMode() === 'rows' && !detail) {
      const rs = rows();
      if (row < 0) { row = 0; inRow = -1; paintCursor(); return; }
      if (inRow < 0) {
        // A row with one thing in it is taken by the select that would have entered it (picture_picker's rule).
        if (rs[row] && rs[row].length === 1) { press(rs[row][0]); return; }
        inRow = 0; paintCursor(); return;
      }
      const n = litEl(); if (n) press(n);
      return;
    }
    if (cur < 0) { cur = 0; paintCursor(); return; }       // the first select only lights the first stop
    const n = litEl(); if (n) press(n);
  }
  function backVerb() {
    poke();
    if (detail) { closeDetail(); return; }
    if (scanMode() === 'rows' && inRow >= 0) { inRow = -1; paintCursor(); return; }
    if (mode === 'switch') cancel('back');
  }
  // A press on a stop: exactly what a click on it does -- except that details opened by a press put the
  // cursor on their first button, where a pointer's click lights nothing.
  let pressing = false;
  function press(n) {
    if (!n || n.disabled) return;
    pressing = true;
    try { n.click(); } finally { pressing = false; }
  }

  // ---- what the presses do ----
  function openDetail(it, { focusPrimary = true } = {}) {
    detail = it; armed = null; note = '';
    // The cursor goes to the detail's first button ("Put it here") for a switch or a key; a pointer that
    // opened it lights nothing, and the next select lights the first button.
    cur = focusPrimary ? 0 : -1; row = 0; inRow = -1;
    draw();
    try { say?.(`${it.title}. ${it.lead}`); } catch { /* no voice */ }
  }
  function closeDetail() {
    const k = detail && detail.key;
    detail = null; armed = null;
    draw();
    // Back on the card it was about.
    const f = flat();
    const i = f.findIndex((n) => n.dataset.libKey === k && n.classList.contains('lib-card'));
    if (i >= 0) { cur = i; const rs = rows(); row = rs.findIndex((r) => r.includes(f[i])); inRow = row >= 0 ? rs[row].indexOf(f[i]) : -1; }
    paintCursor();
  }
  async function place(it) {
    if (!it || busy || torn) return false;
    if (!canPlace()) { openDetail(it); return false; }
    if (lockOf(it) || !it.placeable) { openDetail(it); return false; }
    busy = true; note = `Putting ${it.title} here…`; draw();
    let ok = false;
    try { ok = !!(await host.place(it)); } catch (err) { console.error('library: place', err); ok = false; }
    if (torn) return ok;               // it replaced this library: done
    busy = false;
    note = ok ? `${it.title} is here now.` : `${it.title} could not be put here. Nothing changed.`;
    if (ok) { detail = null; armed = null; }
    draw();
    return ok;
  }
  async function unlock(how) {
    const it = detail;
    if (!it || !gate) return;
    if (how === 'buy' && armed !== 'buy') { armed = 'buy'; drawDetail(); paintCursor(); return; }
    let r = null;
    try {
      if (how === 'buy') r = await gate.buy(it.lockKey, { label: it.title });
      else if (how === 'free') r = await gate.unlockFree(it.lockKey);
      else if (how === 'sandbox') r = { ok: !!(await gate.setMode('sandbox')) };
    } catch (err) { console.error('library: unlock', err); r = null; }
    armed = null;
    if (torn) return;
    if (!r || !r.ok) { note = 'That did not unlock. Nothing was spent; press it again to retry.'; draw(); return; }
    if (canPlace() && it.placeable) { await place(it); return; }
    note = `${it.title} is unlocked.`; draw();
  }
  function cancel(why) {
    clearTimer(idleT); idleT = null;
    try { host?.cancel?.(why); } catch (err) { console.error('library: cancel', err); }
  }

  // ---- the idle way out (decision 5) ----
  function poke() {
    if (mode !== 'switch' || torn) return;
    clearTimer(idleT); idleT = null;
    const ms = Number(p.idleMs) || 0;
    if (ms > 0) idleT = setTimer(() => { idleT = null; if (!torn) cancel('idle'); }, ms);
  }

  // ---- events ----
  const onClick = (e) => {
    const t = e.target instanceof win.Element ? e.target : null;
    if (!t) return;
    poke();
    const keyEl = t.closest('[data-lib-key]');
    const act = t.closest('[data-lib-act]')?.dataset.libAct;
    const cat = t.closest('[data-lib-cat]')?.dataset.libCat;
    // Where the cursor follows a click, so a mixed pointer + switch user is never lost.
    const f = flat(); const at = f.indexOf(t.closest('button,a'));
    if (at >= 0) cur = at;
    if (cat) { savePrefs({ category: cat }); draw(); return; }
    if (act === 'cancel') { cancel('keep'); return; }
    if (act === 'bigger') { try { host?.bigger?.(); } catch (err) { console.error('library: bigger', err); } return; }
    if (act === 'more') { showMore = !showMore; draw(); return; }
    if (act === 'clear') { query = ''; qEl.value = ''; savePrefs({ category: 'all', use: 'any' }); draw(); return; }
    if (act === 'close') { closeDetail(); return; }
    if (act === 'place') { place(detail); return; }
    if (act === 'buy' || act === 'free' || act === 'sandbox') { unlock(act); return; }
    if (act === 'link') return;
    if (keyEl) { const it = byKey(keyEl.dataset.libKey); if (it) openDetail(it, { focusPrimary: pressing }); }
  };
  const onDbl = (e) => {
    const t = e.target instanceof win.Element ? e.target.closest('[data-lib-key]') : null;
    if (!t) return;
    const it = byKey(t.dataset.libKey);
    if (it) place(it);
  };
  const onChange = (e) => {
    const t = e.target;
    poke();
    if (t.matches('[data-lib-sort]')) savePrefs({ sort: t.value });
    else if (t.matches('[data-lib-use]')) savePrefs({ use: t.value });
    else if (t.matches('[data-lib-scan]')) { savePrefs({ scan: t.value }); cur = -1; row = -1; inRow = -1; }
    else if (t.matches('[data-lib-size]')) savePrefs({ cardSize: t.value });
    else if (t.matches('[data-lib-mode]') && gate) { Promise.resolve(gate.setMode(t.value)).then(draw, draw); return; }
    else return;
    draw();
  };
  const onInput = (e) => { if (e.target === qEl) { query = qEl.value; poke(); detail = null; cur = -1; draw(); } };
  // Keys, only where nothing else took them (see the header): arrows walk, Enter presses, Escape backs out.
  const onKey = (e) => {
    if (!keys || torn || e.defaultPrevented || !el.contains(e.target)) return;
    const typing = e.target === qEl;
    const k = e.key;
    if (typing && k !== 'Escape' && k !== 'ArrowDown') return;
    let did = true;
    if (k === 'ArrowRight') step(1);
    else if (k === 'ArrowLeft') step(-1);
    else if (k === 'ArrowDown') { if (typing) { cur = -1; step(1); flat()[cur]?.focus?.(); } else vertical(1); }
    else if (k === 'ArrowUp') vertical(-1);
    else if (k === 'Escape') backVerb();
    else did = false;
    if (did) { e.preventDefault(); const n = litEl(); if (n && !typing) n.focus?.(); }
  };
  el.addEventListener('click', onClick);
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('pointerdown', poke, { passive: true });
  win.addEventListener('keydown', onKey);
  const offGate = gate && typeof gate.subscribe === 'function' ? gate.subscribe(() => { if (!torn) draw(); }) : null;

  draw();
  poke();
  if (typeof moreItems === 'function') {
    Promise.resolve().then(moreItems).then((got) => {
      if (torn || !Array.isArray(got) || !got.length) return;
      const have = new Set(all.map((it) => it.key));
      extra = got.filter((it) => it && !have.has(it.key));
      all = [...all, ...extra];
      draw();
    }).catch((err) => { console.error('library: more items', err); });
  }

  /** What a host asked for at open: show one item, or put it straight here (an AI request, already pressed). */
  async function openFor(type, { autoPlace = false } = {}) {
    const it = byKey(`module:${type}`);
    if (!it || torn) return false;
    if (autoPlace && !lockOf(it)) return place(it);
    openDetail(it);
    return false;
  }

  const verbs = { next: () => step(1), prev: () => step(-1), right: () => step(1), left: () => step(-1),
    down: () => vertical(1), up: () => vertical(-1), select: () => selectVerb(), back: () => backVerb() };
  return {
    verb(v) { if (torn || !verbs[v]) return false; verbs[v](); return true; },
    next: verbs.next, prev: verbs.prev, select: verbs.select, back: verbs.back,
    openFor,
    place: (key) => place(byKey(key)),
    setPrefs(patch = {}) { Object.assign(p, patch); if (!torn) draw(); },
    refresh() { if (torn) return; const b = base(); const have = new Set(b.map((it) => it.key)); all = [...b, ...extra.filter((it) => !have.has(it.key))]; draw(); },
    destroy() {
      torn = true;
      clearTimer(idleT); idleT = null;
      try { offGate?.(); } catch { /* gone */ }
      el.removeEventListener('click', onClick); el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('change', onChange); el.removeEventListener('input', onInput);
      el.removeEventListener('pointerdown', poke);
      win.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
    __probe: () => ({
      mode, prefs: { ...p }, scanMode: scanMode(), query, detail: detail ? detail.key : null, note, busy,
      count: all.length, shown: visible().map((it) => it.key),
      recent: recentItems().map(({ it, hint }) => ({ key: it.key, hint })),
      cursor: { cur, row, inRow, lit: litEl()?.dataset?.libKey || litEl()?.dataset?.libAct || litEl()?.dataset?.libCat || null },
      rows: rows().length, idle: !!idleT,
    }),
  };
}
