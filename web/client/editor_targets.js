// editor_targets.js — THE ONE EDITOR'S MODEL: everything on a dashboard that can be edited, as ONE TREE (row 2.145
// step 1, 2026-10-31). No DOM: editor.js draws it.
//
// Mike, 2026-10-27: *"This setup isn't good. There should just be one thing built for this. It should feel like editing a
// scene in Godot or Blender."* The proposal (docs/for_chat/proposals_dc_20261027.md, DC 2, approved) is three areas -- a
// scene tree, the view, an inspector -- over ONE small interface that every editable thing answers:
//   id, parent, label, kind, transform (or none), fields(), set(), children()
// Step 1 (this file and editor.js) is that interface, the tree and the inspector over what EDIT MODE already edits: a
// dashboard's panels and its room. Nothing here is a second editor: a node's settings ARE edit mode's selection for it
// (edit_mode.js `selectionFor`), so a row in the inspector is the same row, written the same way, as the in-panel card's.
//
// *** THE TREE. ***
//   dash                        the dashboard ('dashboard')
//     cell:<i>                  each cell of its layout preset, in order ('cell'); its panel under it
//       panel:<id>              a panel ('panel'); its own things under it (edit_mode.js `targetsOf`): a sign's words
//         panel:<id>/<target>   ('part'), a village's pieces
//     place:<overlay|screen|scene>  panels placed freely, by where they sit ('group', edit_model.js PLACE_LABELS)
//       panel:<id>
//     panel:scene:room          the dashboard's room ('room', arrangement.js ROOM_PANEL_ID)
//       panel:scene:room/<id>   its furniture ('piece'; a piece's id is its recipe id, room_edits.js withIds: stable)
// No layout (the old one-at-a-time stage): the panel showing sits under `dash` directly.
// A panel's `whole` target (a room's walls and floor, a village's scene) is NOT a row of its own: it IS the panel, so the
// panel's row stands for it (`wholeId`), the way edit mode chooses it when nothing else is.
// Every panel row is one of the arrangement's `editRecs()` -- exactly the records `editPanel` accepts -- so choosing a row
// can never ask edit mode for a panel it does not know.
//
// *** TRANSFORM. *** Where a thing stands, its size, its turn, as numbers (every number with ‹ and ›, for one switch):
//   a placed panel      x, y, size, turn, layer, where it sits, which wall: the placed list, through the SAME edit model
//                       the edit windows use (dashboard_editor.js), so its save is their merge-save and Undo is theirs.
//   a room / village    the piece's own rows its target names as `transformKeys` (edit_mode.js contract).
//   piece
//   anything else       none: a panel in a grid cell is placed by its cell; a room has no place of its own.
// (row 2.145 step 2, 2026-10-31) ALL OF THEM SHOWN ONE WAY: `presentTransform` below -- the same order, size as a
// percent, where it stands as a percent of the stage -- whatever units each owner keeps them in.
//
// *** WORDS (row 2.145 step 3, 2026-10-31). *** Only while the editor's Words are shown (`buildTree(arr, { words })`,
// editor_words.js `wordsSource`; absent, the tree is exactly steps 1 and 2's):
//       panel:<id>/<target>          a thing holding the panel's OWN words (a sign's words) is kind 'words', not 'part'
//                                    -- the same row, the same id, its label its words ("Words: “Ada”")
//       words:<id>:<words>[#n]       the SITE's words shown in that panel ('sitewords'), after its things
//     words:screen                   "Words on this screen" ('wordsgroup'), last: words pressed outside the panels, and
//       words:screen:<words>[#n]     this page's other changes in the draft list ('sitewords')
// A 'sitewords' node belongs to no panel's settings (`panelId` null, its panel in `owner`): fields() is null, set() does
// nothing -- its words are changed through the draft list, in the inspector (editor.js). The id is the ORIGINAL words,
// so it stays the same while a change is shown in place and after a reload (a change is not shown again at load).
import { targetsOf, selectionFor } from './edit_mode.js';
import { normalizeField } from './settings_fields.js';
import { preset } from './layout.js';
import { PLACES, SURFACES, PLACE_LABELS, SURFACE_LABELS, EDIT_DEFAULTS as MODEL_DEFAULTS } from './edit_model.js';
import { getManifest } from './module.js';
import { ROOM_PANEL_ID } from './arrangement.js';
import { WORDS_GROUP_ID } from './editor_words.js';

export const ROOT_ID = 'dash';
/** A panel's node id, or one of its things'. */
export const nodeIdFor = (panelId, targetId = null) => (targetId ? `panel:${panelId}/${targetId}` : `panel:${panelId}`);

const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
const titleOf = (rec) => rec?.title || safe(() => getManifest(rec?.type)?.title, null) || rec?.type || rec?.id || 'A panel';

// =====================================================================================================
// THE PLACED PANEL'S TRANSFORM ROWS (edit_model.js's own numbers: its limits and its normal steps, so a ›
// here moves a panel exactly as a + in the Transform window does).
// =====================================================================================================
// (row 2.145 step 2, 2026-10-31: decimals 1 on x, y, size and turn -- see presentTransform below, which sets them.)
const [X_LO, X_HI] = MODEL_DEFAULTS.limits.x;
const [Y_LO, Y_HI] = MODEL_DEFAULTS.limits.y;
const [S_LO, S_HI] = MODEL_DEFAULTS.limits.scale;
const [L_LO, L_HI] = MODEL_DEFAULTS.limits.layer;
export const PLACED_TRANSFORM_FIELDS = Object.freeze([
  { key: 'x', label: 'Left or right', kind: 'number', min: X_LO, max: X_HI, step: MODEL_DEFAULTS.steps.x[0], unit: '%', level: 'essential',
    default: 50, note: '‹ moves it left, › right' },
  { key: 'y', label: 'Up or down', kind: 'number', min: Y_LO, max: Y_HI, step: MODEL_DEFAULTS.steps.y[0], unit: '%', level: 'essential',
    default: 50, note: '‹ moves it up, › down' },
  { key: 'scale', label: 'Size', kind: 'number', min: S_LO, max: S_HI, step: MODEL_DEFAULTS.steps.scale[0], unit: '%', level: 'essential',
    default: 100, note: '100 is its usual size' },
  // 175, not 180, argued: the model keeps a turn in -180..<180 (edit_model.js clampValue: 180 IS -180), so with 180 as the
  // top a › from 175 would land on -180 and a ‹ from -180 would try 180, be turned back into -180, and never move. With
  // 175 the row goes round both ways. AGAINST: 180 itself is not offered by ‹ ›; it is -180, which is the same turn.
  { key: 'rot', label: 'Rotation', kind: 'number', min: -180, max: 175, step: MODEL_DEFAULTS.steps.rot[0], unit: '°', level: 'essential',
    default: 0, note: '‹ turns it left, › right' },
  { key: 'layer', label: 'Layer', kind: 'number', min: L_LO, max: L_HI, step: MODEL_DEFAULTS.steps.layer[0], level: 'essential',
    default: 0, note: 'higher is in front' },
  { key: 'place', label: 'Where it sits', kind: 'choice', level: 'essential', default: 'screen',
    options: PLACES.map((p) => ({ value: p, label: PLACE_LABELS[p] || p })) },
  { key: 'surface', label: 'Which wall', kind: 'choice', level: 'essential', default: 'back',
    options: SURFACES.map((s) => ({ value: s, label: SURFACE_LABELS[s] || s })),
    appliesWhen: (v) => v?.place === 'scene' },
]);
const PLACED_KEYS = PLACED_TRANSFORM_FIELDS.map((f) => f.key);

/**
 * A placed panel's Transform as a selection (edit_mode.js's shape, so renderOptions draws it): read from the edit model
 * (`model.item(id)`), written through it -- one undoable step per press, saved by its host (dashboard_editor.js).
 */
export function placedTransformSel(model, id, { title = '' } = {}) {
  if (!model || !id) return null;
  return {
    panelId: id, type: 'placed', title, target: null, label: 'Transform', help: '',
    // (step 2: through the same presentation as every other Transform, so a placed panel reads like a room piece.)
    fields: presentFields(PLACED_TRANSFORM_FIELDS.map((f) => normalizeField(f)).filter(Boolean)),
    transformKeys: PLACED_KEYS.slice(),
    actions: [],
    values: () => safe(() => model.item(id), null) || {},
    set: (key, value) => {
      try {
        if (key === 'place') return model.setPlace(value, { id });
        if (key === 'surface') return model.setSurface(value, { id });
        return model.set(key, value, { id, via: 'type' });
      } catch (err) { console.error('editor: transform', err); return false; }
    },
  };
}

// =====================================================================================================
// ONE TRANSFORM, HOWEVER EACH THING KEEPS ITS NUMBERS (row 2.145 step 2, 2026-10-31).
// Mike's "editing a scene in Godot or Blender": a thing's place, size and turn read the same whatever it is. Underneath
// they are kept four ways, and none of them changes here (each owner keeps its own units, bounds and rounding):
//   a room piece (room_edits.js)   x, y: stage percent (3-97; a wall's or a floor's band)  size: x1, 0.5-1.6   turn: degrees
//   a Town piece (town_edits.js)   the same as a room's (its bounds are Town's: room_edits.js imports them)   no turn
//   a village piece (village.js)   x, y: stage PIXELS (0-1600, 0-900)   size: x1, 0.1-4   turn: degrees
//   a placed panel (edit_model.js) x, y: percent 0-100   size: PERCENT 10-400 ('scale')   turn: degrees ('rot')
// THIS IS DISPLAY ONLY: settings_fields.js's own `displayScale` / `displayDecimals` / `unit` (the row divides by it;
// stepping, wrapping and bounds stay in the stored units), on a COPY of each field. So:
//   * SIZE IS A PERCENT EVERYWHERE ("100 %"). FOR: the placed panels already say it so, and a percent is what a person
//     types ("make it 120"). AGAINST: a room's "1.2" was what its own card said; the in-panel card still says that, the
//     inspector says "120 %". The in-panel card is the small fallback (edit_mode.js); the editor is the place with numbers.
//   * WHERE IT STANDS IS A PERCENT OF THE STAGE EVERYWHERE. A room's, Town's and a placed panel's already are. The
//     village's are pixels on a stage whose size is its rows' own top (0..1600 across, 0..900 down: village.js declares
//     them so), so a position row whose range is 0..N with N over 100 is shown as N/100 a percent. FOR: read from the
//     row's own declaration, so nothing here names the village or copies its stage size. AGAINST: it is a rule about a
//     range, not a declared unit -- a future row kept in pixels on a stage NOT starting at 0 would show as it is kept
//     (pixels with a % after them would be wrong, so such a row keeps no % either: see `stage` below). One decimal: a
//     village step (10 px) is 0.6 % across, and "50.6 %" is honest where "51 %" is not.
//   * X, Y, A PLACED PANEL'S SIZE AND TURN SHOW ONE DECIMAL (`decimals: 1`): every owner keeps them to a tenth
//     (room_edits.js round1, town_edits.js round1, edit_model.js clampValue round1), so a typed 33.5 is shown 33.5,
//     not 34. A room's and the village's turn stay whole degrees: their owners round them so.
//   * A TURN GOES ROUND (`wraps: 360`): typed 190 is -170, as the edit windows already take it (edit_model.js clampValue).
//   * THE ORDER IS ONE ORDER: where it stands, its size, its turn, which way it faces, which wall; then a placed panel's
//     layer and where it sits. Each keeps its own words for up and down ("Nearer or further" on a floor, "Higher or
//     lower" on a wall, "Up or down" for a panel): they say which way a press moves it, which one word could not.
// =====================================================================================================
export const TRANSFORM_ORDER = Object.freeze(['x', 'y', 'size', 'scale', 'rotate', 'rot', 'facing', 'wall', 'layer', 'place', 'surface']);
const TURN_KEYS = new Set(['rotate', 'rot']);
const orderOf = (k) => { const i = TRANSFORM_ORDER.indexOf(k); return i < 0 ? TRANSFORM_ORDER.length : i; };

/** One Transform row, as the inspector shows it (a copy; the field itself is untouched). PURE. */
export function presentField(f) {
  if (!f || f.kind !== 'number') return f;
  const out = { ...f };
  if (f.key === 'x' || f.key === 'y') {
    out.decimals = Math.max(Number(f.decimals) || 0, 1);
    const stage = f.min === 0 && Number(f.max) > 100;     // kept in pixels on a stage this wide (the village's)
    if (stage || (Number(f.min) >= 0 && Number(f.max) <= 100)) {
      out.unit = '%';
      out.displayScale = stage ? Number(f.max) / 100 : 1;
      out.displayDecimals = 1;
    }
  } else if (f.key === 'size') {
    out.displayScale = 0.01;
    out.displayDecimals = 0;
    out.unit = '%';
    out.unitOne = '';
    out.note = '100 % is its usual size';
    out.why = out.note;
  } else if (f.key === 'scale') {
    out.decimals = Math.max(Number(f.decimals) || 0, 1);
    out.displayDecimals = 1;
  }
  if (TURN_KEYS.has(f.key)) {
    out.wraps = 360;
    out.unit = '°';
    if (f.key === 'rot') { out.decimals = Math.max(Number(f.decimals) || 0, 1); out.displayDecimals = 1; }
  }
  return out;
}
/** Transform rows in the one order, each presented. PURE. */
export function presentFields(fields) {
  return (Array.isArray(fields) ? fields : []).filter(Boolean).map((f, i) => [f, i])
    .sort((a, b) => (orderOf(a[0].key) - orderOf(b[0].key)) || (a[1] - b[1])).map(([f]) => presentField(f));
}
/** A Transform selection, presented (above): the same rows, written the same way, shown the one way. PURE. */
export function presentTransform(sel) {
  return sel ? { ...sel, fields: presentFields(sel.fields) } : sel;
}

/** A selection split in two: its Transform rows (`transformKeys`, presented) and the rest, its own settings. PURE. */
export function splitSelection(sel) {
  if (!sel) return { transform: null, settings: null };
  const keys = new Set(Array.isArray(sel.transformKeys) ? sel.transformKeys : []);
  const fields = Array.isArray(sel.fields) ? sel.fields : [];
  const tf = fields.filter((f) => keys.has(f.key));
  return {
    transform: tf.length ? presentTransform({ ...sel, label: 'Transform', help: '', fields: tf, actions: [] }) : null,
    settings: { ...sel, label: 'Settings', help: '', fields: fields.filter((f) => !keys.has(f.key)) },
  };
}

// =====================================================================================================
// THE TREE.
// =====================================================================================================
/**
 * buildTree(arr, { placedModel, words }) -> { root, nodes: Map<id, node>, list: [node] (depth first, the order drawn) }
 *   arr          the arrangement (its `editRecs`, `layout`, `placed`, `profile`, `stageRec`)
 *   placedModel  the edit model of the placed panels (dashboard_editor.js), for their Transform; absent: none shown
 *   words        (row 2.145 step 3) editor_words.js `wordsSource(...)` while the editor's Words are shown; absent: no words
 * Each node: { id, parent, label, kind, depth, panelId, targetId, wholeId, place, transform(), fields(), set(k, v),
 *   children() }. Never throws: a panel whose module will not list its things is a row with nothing under it.
 */
export function buildTree(arr, { placedModel = null, words = null } = {}) {
  const nodes = new Map();
  const list = [];
  const kids = new Map();
  const recs = safe(() => (typeof arr?.editRecs === 'function' ? arr.editRecs() : []) || [], []);
  const recById = new Map(recs.filter((r) => r && r.id).map((r) => [r.id, r]));

  function add(n) {
    const node = {
      parent: null, depth: 0, panelId: null, targetId: null, wholeId: null, place: null, ...n,
      children: () => (kids.get(node.id) || []).map((id) => nodes.get(id)).filter(Boolean),
      transform: () => transformOf(node),
      fields: () => fieldsOf(node),
      set: (key, value) => { const s = fieldsOf(node); return s ? s.set(key, value) : false; },
    };
    if (nodes.has(node.id)) return nodes.get(node.id);    // one record in two places: listed once, first place wins
    nodes.set(node.id, node);
    list.push(node);
    if (node.parent) kids.set(node.parent, [...(kids.get(node.parent) || []), node.id]);
    return node;
  }
  /** The panel's row, then its things under it. */
  function addPanel(rec, parent, depth, place = null) {
    if (!rec || !rec.id || nodes.has(nodeIdFor(rec.id))) return;
    const room = rec.id === ROOM_PANEL_ID;
    const targets = safe(() => targetsOf(rec), []);
    const whole = targets.find((t) => t.whole) || null;
    add({ id: nodeIdFor(rec.id), parent, depth, label: titleOf(rec), kind: room ? 'room' : 'panel', panelId: rec.id,
      wholeId: whole ? whole.id : null, place });
    for (const t of targets) {
      if (t.whole) continue;
      // (step 2: a thing with a Transform of its own -- a village's or Town's piece -- is a 'piece' like a room's; a
      // sign's words are a 'part'.)
      const piece = room || (Array.isArray(t.transformKeys) && t.transformKeys.length > 0);
      // (step 3) A part holding the panel's own words is 'words', labelled by them -- only while Words are shown.
      const own = !piece && words ? safe(() => words.ownLabel(rec, t), null) : null;
      add({ id: nodeIdFor(rec.id, t.id), parent: nodeIdFor(rec.id), depth: depth + 1, label: own || String(t.label || t.id),
        kind: piece ? 'piece' : own ? 'words' : 'part', panelId: rec.id, targetId: t.id });
    }
    // (step 3) The site's words shown in it, after its things.
    if (words) {
      for (const w of safe(() => words.panel(rec, { title: titleOf(rec) }), []) || []) {
        add({ id: w.id, parent: nodeIdFor(rec.id), depth: depth + 1, label: w.label, kind: 'sitewords', owner: rec.id, words: w.words });
      }
    }
  }
  function transformOf(node) {
    // (Only a panel the model holds: one placed after the editor opened is not in it -- it shows no Transform rather than
    // rows that would write nowhere. Closing and opening the editor picks it up.)
    if (node.place && !node.targetId && placedModel && safe(() => placedModel.item(node.panelId), null)) {
      return placedTransformSel(placedModel, node.panelId, { title: node.label });
    }
    if (node.targetId) return splitSelection(fieldsOf(node)).transform;
    return null;
  }
  function fieldsOf(node) {
    const rec = node.panelId ? recById.get(node.panelId) : null;
    if (!rec) return null;
    const targets = safe(() => targetsOf(rec), []);
    const t = node.targetId ? targets.find((x) => x.id === node.targetId) : targets.find((x) => x.whole);
    return safe(() => selectionFor(rec, t || null), null);
  }

  const profile = safe(() => arr.profile(), null);
  add({ id: ROOT_ID, label: profile?.name || 'This dashboard', kind: 'dashboard' });
  const layout = safe(() => arr.layout(), null);
  if (layout && Array.isArray(layout.slots)) {
    const p = preset(layout.preset);
    layout.slots.forEach((slotId, i) => {
      const rec = slotId ? recById.get(slotId) : null;
      const cellId = `cell:${i}`;
      add({ id: cellId, parent: ROOT_ID, depth: 1, kind: 'cell',
        label: `Cell ${i + 1} of ${layout.slots.length}${rec ? '' : ' (empty)'}`, cell: i, preset: p.label });
      if (rec) addPanel(rec, cellId, 2);
    });
    const placed = safe(() => arr.placed(), []) || [];
    for (const where of ['overlay', 'screen', 'scene']) {
      const here = placed.filter((e) => e && e.id && (e.place || 'screen') === where && recById.has(e.id));
      if (!here.length) continue;
      const gid = `place:${where}`;
      add({ id: gid, parent: ROOT_ID, depth: 1, kind: 'group', label: PLACE_LABELS[where] || where, place: null });
      for (const e of here) addPanel(recById.get(e.id), gid, 2, where);
    }
  } else {
    const stage = safe(() => arr.stageRec(), null);
    if (stage && recById.has(stage.id)) addPanel(recById.get(stage.id), ROOT_ID, 1);
  }
  const roomRec = recById.get(ROOM_PANEL_ID);
  if (roomRec) addPanel(roomRec, ROOT_ID, 1);
  // (step 3) "Words on this screen", last, only when it has something in it.
  if (words) {
    const here = safe(() => words.screen(), []) || [];
    if (here.length) {
      add({ id: WORDS_GROUP_ID, parent: ROOT_ID, depth: 1, kind: 'wordsgroup', label: 'Words on this screen' });
      for (const w of here) add({ id: w.id, parent: WORDS_GROUP_ID, depth: 2, label: w.label, kind: 'sitewords', owner: null, words: w.words });
    }
  }
  return { root: nodes.get(ROOT_ID), nodes, list };
}

/** Which row edit mode's choice is (`arr.editing()`: { id, target }); a `whole` target is its panel's row. Null: none. */
export function nodeForEditing(tree, editing) {
  if (!tree || !editing || !editing.id) return null;
  const panel = tree.nodes.get(nodeIdFor(editing.id));
  if (!panel) return null;
  if (!editing.target || editing.target === panel.wholeId) return panel.id;
  const part = tree.nodes.get(nodeIdFor(editing.id, editing.target));
  return part ? part.id : panel.id;
}
