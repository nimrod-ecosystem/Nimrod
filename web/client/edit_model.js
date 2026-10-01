// edit_model.js — THE STATE BEHIND THE EDIT WINDOWS, with no DOM in it.
//
// Rows 2.33 / 2.34 (Mike, 2026-09-30): snap, centre, grid, rotation, typed transforms,
// copy/paste/duplicate hotkeys, layer depths, bevel/emboss text; scene / screen / overlay; and
// "the state machine/node/module editor [are] just some edit windows you can open in any
// dashboard/module". Design drew the windows (`room-is-the-screen/edit-windows.html`, README §6);
// this file is the part of that prototype that is not a picture: what a number becomes when it is
// typed or stepped, where it snaps, what order the layers are in, what undo puts back.
//
// It edits a LIST OF ITEMS, not modules. An item is plain data:
//
//   { id, name, x, y, scale, rot, layer, place, surface, shown, locked,
//     text?, ink?, ground?, fx? }
//
// so whatever owns the real things (step 6 Stage R, the room editor, the demo page) builds a model
// from its own records, `subscribe`s, and applies what changes. The windows in `edit_windows.js`
// only ever talk to this model — which is what lets them be bound to real placed modules later
// without being rewritten.
//
// *** EVERY NUMBER IN EDIT_DEFAULTS IS A DEFAULT, NOT A RULE (Rule 1). *** Each is Design's value
// where Design gave one, and each can be overridden per model (`createEditModel({ config })`).
// The ones Code chose are listed for Mike (NOTES_FROM_CODE / MIKE_LIST) rather than slipped in.
//
// TWO PLACES THIS DELIBERATELY DIFFERS FROM THE PROTOTYPE, both found by the tests:
//   1. A STEPPER MUST MOVE. In the prototype, with Snap to grid on (5%) and a 1% step, pressing
//      + on X from 50 gives 51, which rounds straight back to 50: the button does nothing, and a
//      switch user has no other way to move it. Here a step with grid snap on goes to the NEXT
//      grid line in the direction pressed.
//   2. The same trap at the centre: with Snap to centre on, a fine step from 50 gives 50.1, which
//      is within 2% of the centre and snaps back to 50 — so nothing could ever be nudged off the
//      centre by fine steps. Here the centre CATCHES a step moving toward it, and never holds one
//      moving away.
//
// And one choice made rather than copied: a TYPED number is taken as typed (`snapTyped: false`).
// The prototype snapped typed values to the grid, so typing 33 gave 35. Typing is the precision
// path (room_as_home §3.3 item 2: "numbers are for precision, buttons are for access"); a person
// who typed 33 meant 33. It is a setting, and it is on Mike's list with both sides argued.

import { contrast } from './theme.js';

export const PLACES = Object.freeze(['scene', 'screen', 'overlay']);
export const SURFACES = Object.freeze(['back', 'left', 'right', 'floor']);
export const PLACE_LABELS = Object.freeze({ scene: 'In the scene', screen: 'Flat on screen', overlay: 'Overlay' });
export const SURFACE_LABELS = Object.freeze({ back: 'Back wall', left: 'Left wall', right: 'Right wall', floor: 'Floor' });
export const TRANSFORM_KEYS = Object.freeze(['x', 'y', 'scale', 'rot', 'layer']);
export const EFFECTS = Object.freeze(['outline', 'glow', 'bevel', 'emboss']);
// The one number each effect has, by name — Design's prototype names.
export const EFFECT_AMOUNT = Object.freeze({ outline: 'w', glow: 'r', bevel: 'd', emboss: 'd' });

const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };

export const EDIT_DEFAULTS = deepFreeze({
  // [normal, fine]. Design: "1% becomes 0.1%, 5° becomes 1°". Scale follows rotation's 5 -> 1.
  steps: { x: [1, 0.1], y: [1, 0.1], scale: [5, 1], rot: [5, 1], layer: [1, 1] },
  // Design's prototype limits. Rotation wraps rather than clamps (see clampValue).
  limits: { x: [0, 100], y: [0, 100], scale: [10, 400], layer: [0, 99] },
  gridSizes: [2.5, 5, 10],
  centreWithin: 2,          // Design: "snap to centre (within 2%, with a guide line)"
  snapTyped: false,         // Code's choice — see the header
  pasteOffset: 5,           // Code's choice: a pasted copy lands this many % right and down, so it is visibly a second thing
  historyMax: 100,          // Code's choice: undo steps kept
  effectMax: 40,            // Design's prototype clamp for every effect amount, px
  glowWarnPx: 20,           // Design: "A glow wider than 20px warns that it blurs letter shapes"
  contrastMin: 4.5,         // WCAG body text. A WARNING level, never a gate (DECISIONS 2026-09-30)
});

export const SNAP_DEFAULTS = Object.freeze({
  snapGrid: true, showGrid: false, gridSize: 5, snapCenter: true, fine: false,
});

// Design's prototype values for the paired shadows. Data, so a theme or a person can change them.
export const FX_DEFAULTS = deepFreeze({
  outline: { on: false, w: 3, c: '#3a2614' },
  glow: { on: false, r: 12, c: '#ffd36e' },
  bevel: { on: false, d: 2, light: 'rgba(255,255,255,.55)', dark: 'rgba(0,0,0,.5)' },
  emboss: { on: false, d: 2, light: 'rgba(255,255,255,.6)', dark: 'rgba(0,0,0,.4)' },
});

const round1 = (v) => Math.round(v * 10) / 10;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const cfgOf = (config) => ({ ...EDIT_DEFAULTS, ...(config || {}),
  steps: { ...EDIT_DEFAULTS.steps, ...(config?.steps || {}) },
  limits: { ...EDIT_DEFAULTS.limits, ...(config?.limits || {}) } });

// ---------------------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------------------

/** Keep a value in range. Rotation WRAPS into [-180, 180): 190° is -170°, not 180°. */
export function clampValue(key, v, config) {
  const c = cfgOf(config);
  // null and '' are "nothing typed", not zero — Number(null) is 0, which moved things to the edge.
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  v = Number(v);
  if (!Number.isFinite(v)) return null;
  if (key === 'rot') return round1((((v + 180) % 360) + 360) % 360 - 180);
  const [lo, hi] = c.limits[key] || [-Infinity, Infinity];
  if (key === 'layer') return Math.max(lo, Math.min(hi, Math.round(v)));
  return round1(Math.max(lo, Math.min(hi, v)));
}

/** The step a − / + press moves `key` by, given Fine steps. */
export function stepSize(key, fine, config) {
  const s = cfgOf(config).steps[key] || [1, 1];
  return fine ? s[1] : s[0];
}

/** Nearest grid line. */
export function snapToGrid(v, g) { return g > 0 ? round1(Math.round(v / g) * g) : v; }

/** The next grid line strictly past `from` in direction `dir` — so a step always moves. */
export function nextGridLine(from, dir, g) {
  const eps = 1e-6;
  const n = dir > 0 ? Math.floor(from / g + eps) + 1 : Math.ceil(from / g - eps) - 1;
  return round1(n * g);
}

/**
 * What a new value for `key` becomes, before clamping.
 *
 *   via 'step'  from + dir*step; grid snap goes to the next line; the centre catches a step
 *               moving toward it (or across it) and never holds one moving away.
 *   via 'type'  exactly what was typed, unless `snapTyped`.
 *   via 'drag'  grid and centre both apply (a pointer shortcut; nothing needs it).
 *
 * Grid and centre apply to X and Y only. Fine steps bypasses the grid, not the centre.
 */
export function resolveValue(key, { value, from, dir = 0, via = 'type', snap = SNAP_DEFAULTS, config } = {}) {
  const c = cfgOf(config);
  const s = { ...SNAP_DEFAULTS, ...(snap || {}) };
  const positional = key === 'x' || key === 'y';
  let v;
  if (via === 'step') {
    const st = stepSize(key, s.fine, c);
    v = positional && s.snapGrid && !s.fine ? nextGridLine(from, dir, s.gridSize) : from + dir * st;
    if (positional && s.snapCenter) {
      const toward = (50 - from) * dir > 0;
      const crossed = (from < 50 && v > 50) || (from > 50 && v < 50);
      if (toward && (Math.abs(v - 50) <= c.centreWithin || crossed)) v = 50;
    }
    return v;
  }
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  v = Number(value);
  if (!Number.isFinite(v)) return null;
  const snapping = via === 'drag' || c.snapTyped;
  if (positional && snapping) {
    if (s.snapGrid && !s.fine) v = snapToGrid(v, s.gridSize);
    if (s.snapCenter && Math.abs(v - 50) <= c.centreWithin) v = 50;
  }
  return v;
}

/** Top first: highest layer first; a tie goes to the later item (drawn last, so on top). */
export function layerOrder(items) {
  return items.map((it, i) => [it, i]).sort((a, b) => (b[0].layer - a[0].layer) || (b[1] - a[1])).map(([it]) => it);
}

/**
 * Move one item up (+1) or down (-1) one place in the layer order, by SWAPPING layer numbers with
 * its neighbour — so the set of numbers in use is unchanged and nothing else moves. When the two
 * share a number, their places in the list swap instead (the list order is the tie-breaker), so a
 * tie never invents a number that collides with a third thing. Returns a new array, or null.
 */
export function moveLayer(items, id, dir) {
  const order = layerOrder(items);
  const pos = order.findIndex((it) => it.id === id);
  if (pos < 0) return null;
  const other = order[pos - Math.sign(dir)];
  if (!other) return null;
  const me = order[pos];
  if (me.layer === other.layer) {
    const out = [...items];
    const i = out.indexOf(me), j = out.indexOf(other);
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }
  return items.map((it) => (it.id === me.id ? { ...it, layer: other.layer } : it.id === other.id ? { ...it, layer: me.layer } : it));
}

/** To the top (+1) or the bottom (-1): repeated single moves, so the numbers stay the same set. */
export function sendLayer(items, id, dir) {
  let cur = items, moved = false;
  for (let i = 0; i < items.length; i++) {
    const next = moveLayer(cur, id, dir);
    if (!next) break;
    cur = next; moved = true;
  }
  return moved ? cur : null;
}

// ---------------------------------------------------------------------------------------
// TEXT EFFECTS
// ---------------------------------------------------------------------------------------

export function normalizeFx(fx) {
  const out = {};
  for (const k of EFFECTS) out[k] = { ...FX_DEFAULTS[k], ...((fx && fx[k]) || {}) };
  return out;
}

/**
 * The CSS for a set of effects, as properties (for `Object.assign(el.style, …)`-style callers)
 * and as a string. Outline is a stroke drawn UNDER the fill (`paint-order: stroke fill`), doubled
 * because half of a centred stroke is hidden behind the letter. Bevel and emboss are paired light
 * and dark shadows, opposite ways round.
 */
export function textEffectsCss(fx) {
  const f = normalizeFx(fx);
  const sh = [];
  if (f.bevel.on) sh.push(`${-f.bevel.d}px ${-f.bevel.d}px 0 ${f.bevel.light}`, `${f.bevel.d}px ${f.bevel.d}px 0 ${f.bevel.dark}`);
  if (f.emboss.on) sh.push(`${f.emboss.d}px ${f.emboss.d}px 0 ${f.emboss.light}`, `${-f.emboss.d}px ${-f.emboss.d}px 0 ${f.emboss.dark}`);
  if (f.glow.on) sh.push(`0 0 ${f.glow.r}px ${f.glow.c}`, `0 0 ${f.glow.r * 2}px ${f.glow.c}`);
  const props = { textShadow: sh.join(', ') || 'none' };
  if (f.outline.on) { props.webkitTextStroke = `${f.outline.w * 2}px ${f.outline.c}`; props.paintOrder = 'stroke fill'; }
  const css = `text-shadow:${props.textShadow};`
    + (f.outline.on ? `-webkit-text-stroke:${props.webkitTextStroke};paint-order:stroke fill;` : '');
  return { props, css };
}

/**
 * How readable the text is, and what to warn about.
 *
 * *** EFFECTS NEVER CARRY THE CONTRAST. *** The ratio is the text's own colour (`ink`) against
 * what is behind it (`ground`), with every effect OFF — `fx` is not an argument to the ratio at
 * all. So switching an outline off can never be the thing that makes text unreadable: if it only
 * read because of the outline, it is already warned about.
 *
 * *** A WARNING, NEVER A BLOCKER *** (Mike, 2026-09-30: "don't make contrast a blocker. Maybe just
 * a warning."). Nothing here refuses a colour; the model accepts every change and reports this.
 */
export function measureText({ ink, ground, fx } = {}, config) {
  const c = cfgOf(config);
  const f = normalizeFx(fx);
  const warnings = [];
  const ratio = ink && ground ? contrast(ink, ground) : null;
  if (ratio !== null && ratio < c.contrastMin) {
    warnings.push({ code: 'contrast',
      text: `The text is ${ratio.toFixed(1)}:1 against what is behind it, below ${c.contrastMin}:1. Effects are not counted, so a darker or lighter text colour is the fix.` });
  }
  if (f.glow.on && f.glow.r > c.glowWarnPx) {
    warnings.push({ code: 'glow-wide', text: 'A glow this wide can blur the letter shapes at a distance.' });
  }
  return { ratio, ok: ratio === null ? null : ratio >= c.contrastMin, warnings };
}

// ---------------------------------------------------------------------------------------
// THE MODEL
// ---------------------------------------------------------------------------------------

export function normalizeItem(raw, i = 0) {
  const it = { ...(raw || {}) };
  it.id = String(it.id ?? `item-${i + 1}`);
  it.name = String(it.name ?? it.id);
  it.x = clampValue('x', it.x ?? 50) ?? 50;
  it.y = clampValue('y', it.y ?? 50) ?? 50;
  it.scale = clampValue('scale', it.scale ?? 100) ?? 100;
  it.rot = clampValue('rot', it.rot ?? 0) ?? 0;
  it.layer = clampValue('layer', it.layer ?? i) ?? i;
  it.place = PLACES.includes(it.place) ? it.place : 'screen';
  it.surface = SURFACES.includes(it.surface) ? it.surface : 'back';
  it.shown = it.shown !== false;
  it.locked = it.locked === true;
  if (it.fx || typeof it.text === 'string') it.fx = normalizeFx(it.fx);
  return it;
}

export const hasText = (it) => !!(it && (typeof it.text === 'string' || it.fx));

/**
 * createEditModel({ items, selectedId, snap, config, clipboard, newId })
 *
 * `clipboard` is optional `{ get(), set(item) }`, so a host can share one clipboard across
 * dashboards; without it the model keeps its own. `newId(base, taken)` is injectable for hosts
 * whose ids mean something.
 *
 * Every change notifies subscribers with `{ type, … }`:
 *   'items'  something about the things changed (ids: which)    — undoable
 *   'select' the selection changed                              — not undoable (view state)
 *   'snap'   a snap / grid / fine setting changed               — not undoable (view state)
 */
export function createEditModel({ items = [], selectedId, snap, config, clipboard, newId } = {}) {
  const cfg = cfgOf(config);
  let list = items.map(normalizeItem);
  let sel = selectedId !== undefined ? selectedId : (list.length ? layerOrder(list)[0].id : null);
  let snapState = { ...SNAP_DEFAULTS, ...(snap || {}) };
  if (!cfg.gridSizes.includes(snapState.gridSize)) snapState.gridSize = SNAP_DEFAULTS.gridSize;
  const undoStack = [];
  const redoStack = [];
  let ownClip = null;
  const clip = clipboard || { get: () => ownClip, set: (v) => { ownClip = v; } };
  const subs = new Set();

  const mkId = newId || ((base, taken) => {
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  });

  function emit(evt) {
    for (const fn of [...subs]) { try { fn(evt); } catch (err) { console.error('edit_model: subscriber', err); } }
  }
  const snapshot = () => ({ items: clone(list), sel });
  // `extra` rides on the event, so a subscriber can tell WHAT changed without diffing (a hide, below).
  function commit(nextList, ids, nextSel = sel, extra = null) {
    undoStack.push(snapshot());
    if (undoStack.length > cfg.historyMax) undoStack.shift();
    redoStack.length = 0;
    list = nextList;
    sel = nextSel;
    emit({ type: 'items', ids, ...(extra || {}) });
    return true;
  }
  const get = (id) => list.find((it) => it.id === id) || null;
  const patch = (id, p) => list.map((it) => (it.id === id ? { ...it, ...p } : it));

  const model = {
    config: () => ({ ...cfg }),
    items: () => clone(list),
    item: (id) => clone(get(id)),
    order: () => layerOrder(list).map((it) => it.id),
    selectedId: () => sel,
    selected: () => clone(get(sel)),
    snap: () => ({ ...snapState }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    hasClipboard: () => !!clip.get(),
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    listenerCount: () => subs.size,

    select(id) {
      if (id !== null && !get(id)) return false;
      if (id === sel) return false;
      sel = id;
      emit({ type: 'select', id });
      return true;
    },

    setSnap(p) {
      const next = { ...snapState, ...p };
      if (!cfg.gridSizes.includes(next.gridSize)) next.gridSize = snapState.gridSize;
      for (const k of ['snapGrid', 'showGrid', 'snapCenter', 'fine']) next[k] = !!next[k];
      snapState = next;
      emit({ type: 'snap' });
      return true;
    },
    toggleSnap(k) { return model.setSnap({ [k]: !snapState[k] }); },

    /** A typed (or dragged) value. Returns true if it changed something. */
    set(key, value, { via = 'type', id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !TRANSFORM_KEYS.includes(key)) return false;
      const v = clampValue(key, resolveValue(key, { value, via, snap: snapState, config: cfg }), cfg);
      if (v === null || v === it[key]) return false;
      return commit(patch(id, { [key]: v }), [id]);
    },

    /** A − (dir -1) or + (dir +1) press. */
    step(key, dir, { id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !TRANSFORM_KEYS.includes(key)) return false;
      const v = clampValue(key, resolveValue(key, { from: it[key], dir: Math.sign(dir), via: 'step', snap: snapState, config: cfg }), cfg);
      if (v === null || v === it[key]) return false;
      return commit(patch(id, { [key]: v }), [id]);
    },

    /** Which centre guides to draw for the selected thing. */
    guides() {
      const it = get(sel);
      return { x: !!(it && snapState.snapCenter && it.x === 50), y: !!(it && snapState.snapCenter && it.y === 50) };
    },

    setPlace(place, { id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !PLACES.includes(place) || it.place === place) return false;
      return commit(patch(id, { place }), [id]);
    },
    setSurface(surface, { id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !SURFACES.includes(surface) || it.surface === surface) return false;
      return commit(patch(id, { surface }), [id]);
    },

    // ---- layers ---------------------------------------------------------------------
    /** ▲ (+1) / ▼ (-1). A locked thing does not move; others may move past it. */
    moveLayer(id, dir) {
      const it = get(id);
      if (!it || it.locked) return false;
      const next = moveLayer(list, id, dir);
      if (!next) return false;
      return commit(next, [id]);
    },
    /** Send to front (+1) / back (-1) — room_as_home §3.3 item 5. */
    sendLayer(id, dir) {
      const it = get(id);
      if (!it || it.locked) return false;
      const next = sendLayer(list, id, dir);
      if (!next) return false;
      return commit(next, [id]);
    },
    canMoveLayer(id, dir) { const it = get(id); return !!(it && !it.locked && moveLayer(list, id, dir)); },
    /** Shown / Hidden and Lock work on a locked thing — otherwise nothing could unlock it.
     *  The event says `change: 'shown', shown` so a host can tell a hide from a move (hide_sound.js). */
    toggleShown(id = sel) {
      const it = get(id);
      return it ? commit(patch(id, { shown: !it.shown }), [id], sel, { change: 'shown', shown: !it.shown }) : false;
    },
    toggleLocked(id = sel) { const it = get(id); return it ? commit(patch(id, { locked: !it.locked }), [id]) : false; },

    // ---- text effects ---------------------------------------------------------------
    toggleEffect(name, { id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !hasText(it) || !EFFECTS.includes(name)) return false;
      const fx = normalizeFx(it.fx);
      fx[name].on = !fx[name].on;
      return commit(patch(id, { fx }), [id]);
    },
    /** Set an effect's amount; setting it turns the effect on (Design's prototype does the same). */
    setEffect(name, amount, { id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !hasText(it) || !EFFECTS.includes(name)) return false;
      const n = Number(amount);
      if (!Number.isFinite(n)) return false;
      const fx = normalizeFx(it.fx);
      const k = EFFECT_AMOUNT[name];
      const v = Math.max(0, Math.min(cfg.effectMax, Math.round(n)));
      if (fx[name][k] === v && fx[name].on) return false;
      fx[name][k] = v; fx[name].on = true;
      return commit(patch(id, { fx }), [id]);
    },
    stepEffect(name, dir, { id = sel } = {}) {
      const it = get(id);
      if (!it || !hasText(it)) return false;
      return model.setEffect(name, normalizeFx(it.fx)[name][EFFECT_AMOUNT[name]] + Math.sign(dir), { id });
    },
    /** Change the text's own colour or its ground. Accepted whatever the contrast — see measureText. */
    setTextColors({ ink, ground } = {}, { id = sel } = {}) {
      const it = get(id);
      if (!it || it.locked || !hasText(it)) return false;
      const p = {};
      if (ink !== undefined) p.ink = ink;
      if (ground !== undefined) p.ground = ground;
      return commit(patch(id, p), [id]);
    },
    measure(id = sel) { const it = get(id); return it && hasText(it) ? measureText(it, cfg) : null; },

    // ---- copy / paste / duplicate / delete ------------------------------------------
    copy(id = sel) { const it = get(id); if (!it) return false; clip.set(clone(it)); return true; },
    paste() { const src = clip.get(); return src ? addCopy(src) : false; },
    duplicate(id = sel) { const it = get(id); return it ? addCopy(it) : false; },
    /** Delete. A locked thing is not deleted. Undo puts it back. */
    remove(id = sel) {
      const it = get(id);
      if (!it || it.locked) return false;
      const order = layerOrder(list);
      const pos = order.findIndex((o) => o.id === id);
      const nextSel = id === sel ? (order[pos + 1] || order[pos - 1] || null)?.id ?? null : sel;
      return commit(list.filter((o) => o.id !== id), [id], nextSel);
    },

    // ---- history ----------------------------------------------------------------------
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(snapshot());
      const s = undoStack.pop();
      list = s.items; sel = s.sel;
      emit({ type: 'items', ids: [], history: 'undo' });
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(snapshot());
      const s = redoStack.pop();
      list = s.items; sel = s.sel;
      emit({ type: 'items', ids: [], history: 'redo' });
      return true;
    },
  };

  /** A copy lands offset, on top, unlocked and shown, and becomes the selection. */
  function addCopy(src) {
    const taken = new Set(list.map((o) => o.id));
    const base = String(src.id).replace(/-\d+$/, '');
    const id = mkId(base, taken);
    const top = list.length ? Math.max(...list.map((o) => o.layer)) : -1;
    const copy = normalizeItem({
      ...clone(src), id, name: `${src.name} copy`,
      x: Math.min(100, src.x + cfg.pasteOffset), y: Math.min(100, src.y + cfg.pasteOffset),
      layer: Math.min(cfg.limits.layer[1], top + 1), shown: true, locked: false,
    });
    return commit([...list, copy], [id], id);
  }

  return model;
}

// ---------------------------------------------------------------------------------------
// HOTKEYS (room_as_home §3.3 item 3): Ctrl+C, Ctrl+V, Ctrl+D duplicate, Delete, Ctrl+Z, Ctrl+Y
// (and Ctrl+Shift+Z). Cmd counts as Ctrl. IGNORED WHILE TYPING in a text field — the same test
// the kiosk and the keyboard bus use, so Delete in the X box deletes a character, not the thing.
// ---------------------------------------------------------------------------------------

function typing(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
}

/** Which edit action a key event means, or null. Pure; `handleEditKey` runs it. */
export function editKeyAction(e) {
  if (!e || typing(e.target)) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = String(e.key || '').toLowerCase();
  if (!mod && !e.altKey && (k === 'delete')) return 'remove';
  if (!mod || e.altKey) return null;
  if (k === 'c' && !e.shiftKey) return 'copy';
  if (k === 'v' && !e.shiftKey) return 'paste';
  if (k === 'd' && !e.shiftKey) return 'duplicate';
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/** Run a key event against a model. Returns the action taken, or null. */
export function handleEditKey(model, e) {
  const act = editKeyAction(e);
  if (!act) return null;
  // Ctrl+D is the browser's bookmark key and Ctrl+Z/Y may be the page's; claimed only when the
  // action is one the model knows, so an unrelated page keeps its keys.
  e.preventDefault?.();
  model[act]();
  return act;
}

/** Listen on `target` (a window, a document or an element). Returns `{ destroy }`. */
export function bindEditHotkeys(target, model) {
  const ac = new AbortController();
  target.addEventListener('keydown', (e) => { handleEditKey(model, e); }, { signal: ac.signal });
  return { destroy: () => ac.abort() };
}
