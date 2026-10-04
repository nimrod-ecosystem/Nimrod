// doc_merge.js — A THREE-WAY MERGE FOR A SETTINGS DOC WHOSE WRITE THE SERVER REFUSED AS STALE.
//
// state.js already does optimistic concurrency: a PUT carries the version it read, a stale one comes back
// 409 with the server's truth, and the handle REBASES and retries. Its rebase is per TOP-LEVEL key: the
// keys this handle changed win, wholesale. For a screen's settings doc that is too coarse to be safe: the
// whole arrangement lives under ONE key (`kiosk`), so a door changed on this screen and a look changed on
// another device at the same moment are both "a change to `kiosk`", and the rebase quietly throws the other
// device's away. (Mike's list 09-30, the gap left by d377083: "an edit made on another device while that
// screen shows could be overwritten.")
//
// This file is the finer rule, opt-in (state.js `merge`): given the doc as last confirmed by the server
// (`base`), this handle's copy (`mine`) and the server's new truth (`theirs`):
//   * a part only ONE side changed takes that side's value -- at any depth, so a door on piece A (here) and a
//     look on piece B (elsewhere) both survive, and so do two different keys of the SAME piece;
//   * a part BOTH sides changed to the same value is simply that value;
//   * a part both sides changed DIFFERENTLY is a true conflict, settled by `prefer` (below), and reported in
//     `lost` (or `replaced`) so the caller can say so -- an edit is never dropped without a word.
//
// *** THE CONFLICT POLICY: THE OTHER DEVICE'S VALUE STANDS (`prefer: 'theirs'`, the default). Argued. ***
//   FOR 'theirs': the server already accepted it, and its author is somewhere else -- a phone, Home -- where
//     nothing this screen does can tell them it was undone. The edit made HERE was made against a copy that
//     was already out of date, and the person who made it is standing at the screen that can say so. "Never
//     lose an edit silently" can only be kept for the edit whose author can be told, so that is the one that
//     gives way. Everything else in the local edit is still re-applied on top.
//   FOR 'mine': it is the later press in wall-clock terms, and the rest of state.js is last-write-wins; the
//     person at the screen sees their change stick.
//   AGAINST 'mine', and it decides it: the other device's author is told nothing and finds their change gone.
//   The window is small (a synced doc polls every 1.5 s, sooner with push), so this is rare either way.
//   `prefer: 'mine'` is one word away for a caller that wants it. On Mike's list.
//
// *** WHAT IS MERGED AT WHICH GRAIN. ***
//   Plain objects: key by key, recursively.
//   Arrays: element by element ONLY when all three have the same length and, where elements carry an `id`,
//     the same id at every position -- then position N is the same thing on every side (a room's recipe
//     items, a placed list nobody reordered). An array whose SHAPE both sides changed (an item added here and
//     another removed there, a reorder) is one value, and a conflict if both changed it.
//   A ROOM SCENE (`kiosk.layout.scene`, `kind` room or room3d): a room that names only its preset has no
//     recipe of its own until a door or a look COPIES the preset's in (room_doors.js header). Two devices each
//     doing that would look like two different recipes appearing at once, so before merging, a side without a
//     recipe is given its preset's (when kind and preset agree), and after, the room goes back to naming only
//     its preset if the merged recipe is exactly the preset's again (`tidyScene`). When the kind or preset
//     differs between the sides, the scene is ONE value: a door from the old room laid onto a new one would
//     be a recipe from one room under the name of another.

import { sceneRecipe, tidyScene } from './room_doors.js';

const J = (v) => JSON.stringify(v === undefined ? null : v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const idOf = (v) => (isObj(v) && typeof v.id === 'string' ? v.id : null);

function sameShape(a, b, c) {
  if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) return false;
  if (a.length !== b.length || a.length !== c.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ia = idOf(a[i]), ib = idOf(b[i]), ic = idOf(c[i]);
    if (ia !== ib || ia !== ic) return false;
  }
  return true;
}

/**
 * Three-way merge of plain JSON values. Returns `{ value, lost, replaced }`: `lost` lists the paths (arrays
 * of keys) where this side's change gave way (`prefer: 'theirs'`); `replaced` where the other side's did
 * (`prefer: 'mine'`). `atomic(path, base, mine, theirs)` may say a part is one value, never merged inside.
 * An `undefined` result means "no such key".
 */
export function merge3(base, mine, theirs, { prefer = 'theirs', atomic = null } = {}) {
  const lost = [], replaced = [];
  const walk = (b, m, t, path) => {
    const jb = J(b), jm = J(m), jt = J(t);
    if (jm === jb) return t;               // only they changed it (or nobody did)
    if (jt === jb) return m;               // only we did
    if (jm === jt) return m;               // both, the same way
    const whole = typeof atomic === 'function' && atomic(path, b, m, t);
    if (!whole && isObj(m) && isObj(t) && (b === undefined || b === null || isObj(b))) {
      const bo = isObj(b) ? b : {};
      const out = {};
      for (const k of new Set([...Object.keys(t), ...Object.keys(m)])) {
        const v = walk(bo[k], m[k], t[k], [...path, k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (!whole && sameShape(b, m, t)) return m.map((x, i) => walk(b[i], x, t[i], [...path, i]));
    // A true conflict: both changed this, differently.
    if (prefer === 'mine') { replaced.push(path); return m; }
    lost.push(path);
    return t;
  };
  const value = walk(base, mine, theirs, []);
  return { value, lost, replaced };
}

const SCENE_PATH = ['kiosk', 'layout', 'scene'];
const isRoom = (s) => isObj(s) && (s.kind === 'room' || s.kind === 'room3d');
function at(doc, path) {
  let v = doc;
  for (const k of path) { if (!isObj(v)) return undefined; v = v[k]; }
  return v;
}
function withAt(doc, path, val) {
  if (!isObj(doc)) return doc;
  const [k, ...rest] = path;
  if (!rest.length) return { ...doc, [k]: val };
  if (!isObj(doc[k])) return doc;
  return { ...doc, [k]: withAt(doc[k], rest, val) };
}

/** The scenes, each with its preset's recipe copied in when another side has a recipe of its own and the
 *  kind and preset agree; null when they do not agree (the scene is then one value). */
function materialized(scenes) {
  const rooms = scenes.filter(isRoom);
  if (!rooms.length || !rooms.some((s) => isObj(s.recipe))) return scenes;
  const sig = (s) => J([s.kind, s.preset || null]);
  if (rooms.length !== scenes.filter((s) => s !== undefined && s !== null).length) return null;
  if (new Set(rooms.map(sig)).size > 1) return null;
  return scenes.map((s) => (isRoom(s) && !isObj(s.recipe) ? { ...s, recipe: sceneRecipe(s) } : s));
}

/**
 * A settings doc merged (see the header): `{ data, lost, replaced }`, `data` being the doc to keep.
 * `base`: the doc as the server last confirmed it to this handle; `mine`: this handle's copy; `theirs`: the
 * server's truth from the refusal.
 */
export function mergeSettingsDoc(base, mine, theirs, { prefer = 'theirs' } = {}) {
  let b = isObj(base) ? base : {}, m = isObj(mine) ? mine : {}, t = isObj(theirs) ? theirs : {};
  const scenes = [at(b, SCENE_PATH), at(m, SCENE_PATH), at(t, SCENE_PATH)];
  const mat = materialized(scenes);
  const sceneWhole = mat === null;
  if (mat && mat !== scenes) {
    [b, m, t] = [b, m, t].map((d, i) => (mat[i] !== scenes[i] ? withAt(d, SCENE_PATH, mat[i]) : d));
  }
  const atomic = (path) => sceneWhole && J(path) === J(SCENE_PATH);
  const r = merge3(b, m, t, { prefer, atomic });
  let data = isObj(r.value) ? r.value : {};
  const s = at(data, SCENE_PATH);
  if (isRoom(s)) data = withAt(data, SCENE_PATH, tidyScene(s));
  return { data, lost: r.lost, replaced: r.replaced };
}

/**
 * A LAYOUT SAVE WHOSE SCREEN WAS WAITED ON (2026-10-04). An edit reads its `base` at the press and saves `next`
 * once the screen is drawn (arrangement.js `save(next, base)`); if the doc moved on meanwhile (`nowSaved`: another
 * device, heard by the poll), `next` is merged onto it rather than laid over it. The write that follows carries a
 * CURRENT version, so the server would take it as it stands -- this is the only place that change can be kept.
 * Same rule and same policy as a refused write (`mergeSettingsDoc`). Returns `{ layout, lost, merged }`: `layout`
 * to save, `lost` as `mergeSettingsDoc`'s (paths in the doc, so `lostEditWords` reads them), `merged` false when
 * nothing had moved (or no base came) and `layout` is `next` itself. One function for every host that saves a
 * layout (kiosk.js, both of its docs; modules/view.js), so the rule is written once.
 */
export function mergeLayoutSave(base, next, nowSaved, { prefer = 'theirs' } = {}) {
  if (base === undefined || J(base) === J(nowSaved)) return { layout: next, lost: [], merged: false };
  const wrap = (l) => ({ kiosk: { layout: l ?? null } });
  const r = mergeSettingsDoc(wrap(base), wrap(next), wrap(nowSaved), { prefer });
  return { layout: r.data?.kiosk?.layout ?? null, lost: r.lost, merged: true };
}

/** The one quiet line a screen shows when a change made on it gave way (one wording, every host). */
export function lostEditWords(lost, name) {
  const what = describeLost(lost) || 'a setting';
  return `A change made here was not kept: ${what} on ${name || 'this dashboard'} was just changed on another device.`;
}

/** What a lost path was about, in a few plain words: "the room", "the layout", or "a setting". */
export function describeLost(paths) {
  const words = new Set();
  for (const p of paths || []) {
    if (p[0] === 'kiosk' && p[1] === 'layout') words.add(p[2] === 'scene' ? 'the room' : 'the layout');
    else words.add('a setting');
  }
  const list = [...words];
  if (!list.length) return '';
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
