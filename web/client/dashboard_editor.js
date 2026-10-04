// dashboard_editor.js — THE EDIT VIEW OF ONE DASHBOARD: the edit windows bound to what is on it.
//
// Stage R built this inside modules/view.js (`edit()`): an edit model made from the dashboard's modules
// placed freely, the Transform and Layers windows over it, and every change applied in place and saved.
// Row 2.38 adds what a thing OPENS and what a frame SHOWS (the Opens-and-shows window), the room's own
// objects as things too (a desk can be a door), the Map, and one switch walk over all of it -- and the
// kiosk now needs the same editor for a screen that is NOT on the dashboard path (Stage 4 is per screen and
// off by default). So the editor lives here, once, and both hosts open it:
//   modules/view.js   `edit()` on a dashboard module (the dashboard path, the modules page, a suite)
//   kiosk.js          `system/edit` on a screen whose panels the kiosk mounts itself (today's path)
//
// WHAT IS APPLIED, AND HOW, for each kind of change (all through the model, so Undo covers every one):
//   a move, a layer, shown, locked   the placed entry, applied by the arrangement in place (Stage R)
//   a module's `opens`               the same entry: the door button appears or goes (arrangement.js syncDoor)
//   a room object's `opens`          the scene's recipe (room_doors.js argues it), applied in place
//                                    (arrangement `applyPlaced` -> room_scene `setObjectOpens`)
//   a frame's `shows`                THAT PANEL'S OWN STATE ROW (`shows`, where 1c97dc5 reads it); the nested
//                                    dashboard watches its row and redraws its inside live (modules/view.js)
// A host that saves (`save`) gets the layout handed to it after each change; one that does not (the
// modules page) keeps it in memory, as that page promises. `shows` is a panel's own row, written always.
//
// NEVER A GATE: the windows are solid and non-modal with Close first (edit_windows.js), nothing waits on
// them, and Close or Escape ends the editing. While a SWITCH is walking them the host hands the walk to
// `editor.scan` (the kiosk pauses the panel router meanwhile, the tray's rule) and gives it back on close.

import { createEditModel, normalizeItem } from './edit_model.js';
import {
  mountTransformWindow, mountLayersWindow, mountLinksWindow, mountMapWindow, mountAutomationWindow, createWindowGroup,
} from './edit_windows.js';
import { getManifest } from './module.js';
import { placedGeometry } from './layout.js';
import { sceneDoors, withDoor, tidyScene } from './room_doors.js';
import { SHOWING_TYPES } from './dashboard_map.js';
import { AUTOMATION_TOPICS } from './automation_topics.js';

/** The windows the edit view opens by default, in this order (the first one's Close is the walk's first stop). */
export const EDIT_WINDOWS_DEFAULT = Object.freeze(['transform', 'layers', 'links']);
// A room object's id in the edit model: prefixed, so it can never collide with a module instance's id.
export const OBJECT_PREFIX = 'room:';
// What a dashboard made from "+ New dashboard" is called (then "New dashboard 2", ...). Renamed in
// Dashboards, on the home page. A guess, on Mike's list: typing a name with one switch is slow (Design's
// Save-as offers ready-made names for the same reason), so it is named for you and renamed later.
export const NEW_DASHBOARD_NAME = 'New dashboard';

export function newDashboardName(list = [], base = NEW_DASHBOARD_NAME) {
  const taken = new Set((list || []).map((d) => String(d?.name || '').trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/**
 * openDashboardEditor(opts) -> editor
 *   arr              the arrangement (arrangement.js) whose placed modules and room are edited
 *   mountIn          the element a box for the windows is added to (absolute, top right), or
 *   host             an element to put the windows in as they are
 *   baseLayout()     the layout as SAVED (what a change is made from); default `arr.layout()`
 *   apply(layout)    applies a layout in place; default `arr.applyPlaced`
 *   save(layout, base) persists it (absent: memory only). `base` is the layout as saved that the windows last
 *                    matched; the host merges `layout` onto its doc as it is now (doc_merge.js `mergeLayoutSave`)
 *                    and may return `{ layout }`, what it saved, which is then what `apply` is given (2026-10-04)
 *   windows          which windows open first (EDIT_WINDOWS_DEFAULT)
 *   listDashboards() -> Promise<[{ id, name }]>   the person's dashboards (for Opens / Shows and the map)
 *   createDashboard(name) -> Promise<{ id, name }> "+ New dashboard" (absent: disabled)
 *   currentId()      this dashboard's id
 *   loadMap()        -> Promise<{ graph }> (absent: no Map button)
 *   onGo(id)         the map's "go there"
 *   hidePolicy       hide = mute's question (ad7dc49), asked when a person hides a panel by hand
 *   onClose()        after the editing ended (any way)
 *   onChange()       after it opened, closed or applied something (a host redraws its bar)
 *   automation       row 2.41: the screen's automation engine (automation.js), whose `wrapState` layers
 *                    THESE panels' states. Given, Layers offers "Automation…" (the Automation window,
 *                    `windows.automation`, put away by its own Close like the map). Absent: not offered.
 *                    The window saves nothing itself: a binding is saved by the engine's own `onChange`,
 *                    exactly as before -- so this adds a way IN, not a new permission.
 *   chooseMode       2026-10-04: the person's "How you choose things" ('point' | 'step', or a getter), handed to
 *                    the Automation window, whose switch walk it picks (edit_windows.js). Absent: point.
 *                    `scan.back()` is the walk's back: true when a window used it (came out of a row, or put
 *                    the Automation window away), false when the host should end the editing as before.
 *   topics           2026-10-04: the message names the Automation window offers for "a message" (a value or a
 *                    getter; automation_panel.js `topics`). Absent: automation_topics.js AUTOMATION_TOPICS -- the
 *                    messages that carry a number, each with a plain label -- so a new message rule is finished by
 *                    switch alone, on every host, with no host change. [] offers only the names rules already use.
 */
export function openDashboardEditor(opts = {}) {
  const {
    arr, mountIn = null, host = null, baseLayout = () => arr.layout(), apply = (l) => arr.applyPlaced(l),
    save = null, windows = EDIT_WINDOWS_DEFAULT, listDashboards = null, createDashboard = null,
    currentId = () => null, loadMap = null, onGo = null, hidePolicy = null, onClose = null, onChange = null,
    automation = null, chooseMode = 'point', topics = AUTOMATION_TOPICS,
  } = opts;
  if (!arr) throw new Error('openDashboardEditor: an arrangement is required');
  const doc = (host || mountIn)?.ownerDocument || document;
  const notes = [];
  const known = () => new Set(((arr.profile && arr.profile()) || { modules: [] }).modules.map((m) => m.id));
  const tell = () => { try { onChange?.(); } catch (err) { console.error('dashboard_editor: onChange', err); } };

  // ---- the things: placed modules, then the room's own objects ----
  const toItem = (e) => {
    const g = placedGeometry(e);
    const rec = arr.recFor(e.id);
    const it = { id: e.id, name: rec?.title || rec?.type || e.id, x: g.x, y: g.y, scale: g.scale, rot: g.rot,
      layer: g.layer, place: e.place, surface: g.surface, shown: e.shown !== false, locked: e.locked === true,
      opens: typeof e.opens === 'string' ? e.opens : null };
    if (rec && SHOWING_TYPES.includes(rec.type)) {
      let shows = null;
      try { shows = rec.state?.get?.()?.shows ?? null; } catch { shows = null; }
      Object.assign(it, { canShow: true, shows });
    }
    return it;
  };
  const objectItems = () => (typeof arr.roomObjects === 'function' ? arr.roomObjects() : []).map((o) => ({
    id: `${OBJECT_PREFIX}${o.id}`, objectId: o.id, name: o.name, fixed: true, opens: o.opens || null,
  }));
  const fromItem = (it, prev) => {
    const e = { ...(prev || { id: it.id }), place: it.place, x: it.x, y: it.y, scale: it.scale, rot: it.rot, layer: it.layer };
    if (it.place === 'scene') e.surface = it.surface; else delete e.surface;
    if (it.shown === false) e.shown = false; else delete e.shown;
    if (it.locked) e.locked = true; else delete e.locked;
    if (it.opens) e.opens = it.opens; else delete e.opens;           // row 2.38
    return e;
  };

  const model = createEditModel({ items: [...arr.placed().map(toItem), ...objectItems()] });
  let closed = false;
  let syncing = false;
  // *** WHAT A SAVE IS MADE FROM, AND THE BASE IT CARRIES (2026-10-04, later; d40424f left this gap). *** The model is
  // built ONCE, here, and is not told when another device moves something while the windows are open (the host moves
  // it on the screen; the windows still show the old place). Every change used to write the WHOLE placed list from
  // the model over the layout as saved now -- so a panel moved elsewhere went back where the windows last saw it.
  // Now, for a host that saves: `synced` is the layout as saved that the model matches (the saved layout at open,
  // then each save's own `next`), and a change is written as `synced` with only what the model changed laid onto it
  // (`entryLike`: an entry keeps its saved form, key for key, except where the windows now say something else).
  // `save(next, synced)` merges that onto the doc as it is now (doc_merge.js `mergeLayoutSave`, the host's policy
  // and quiet line) and may return `{ layout }`, what was actually saved: that is what the screen is moved to, in
  // place (`apply`), so the other device's move stays on the screen too.
  //   `synced` stays the model's view (`next`), NOT the merge: the windows still show the old place for a panel
  //   moved elsewhere, so the next change must not read that old place as a move made here. (FOR re-filling the
  //   model with the merge instead: the windows would show the new place. AGAINST, and it decides it: Undo restores
  //   the model's earlier items, which hold the old place, and would then write it back over the other device's
  //   move. This way Undo undoes only what was done here.)
  // A host that does not save (the modules page: memory only) is unchanged: the layout it holds now, plus the model.
  const savable = typeof save === 'function';
  const startLayout = () => baseLayout() || arr.layout() || { preset: 'full', slots: [] };
  let synced = savable ? JSON.parse(JSON.stringify(startLayout())) : null;
  const J = (v) => JSON.stringify(v === undefined ? null : v);
  /** `stored` (an entry as saved) with only the keys the windows changed (`it`) laid on; a new one is `it`'s own. */
  function entryLike(stored, it) {
    const mine = fromItem(it, stored);
    if (!stored) return mine;
    const was = fromItem(normalizeItem(toItem(stored)), stored);   // what the windows made of it when it was saved
    const out = { ...stored };
    for (const k of new Set([...Object.keys(was), ...Object.keys(mine)])) {
      if (J(mine[k]) === J(was[k])) continue;
      if (mine[k] === undefined) delete out[k]; else out[k] = mine[k];
    }
    return out;
  }
  /** The layout to save: `base` with the placed things (`entryOf`) and the room objects' doors from the model. */
  function build(base, entryOf) {
    const ok = known();
    const placed = model.items().filter((it) => !it.fixed && ok.has(it.id)).map(entryOf);
    const next = { ...base, placed };
    if (savable && !placed.length && !Array.isArray(base.placed)) delete next.placed;   // nothing added, nothing changed
    // Room objects' doors, onto the scene's recipe.
    // (2026-10-02: the 3D room's furniture too -- room_doors.js reads and writes either kind of room.)
    let scene = base.scene || null;
    const objs = model.items().filter((it) => it.fixed && it.objectId);
    if (scene && (scene.kind === 'room' || scene.kind === 'room3d') && objs.length) {
      const now = sceneDoors(scene);
      for (const it of objs) {
        if ((now[it.objectId] || null) !== (it.opens || null)) scene = withDoor(scene, it.objectId, it.opens) || scene;
      }
      scene = tidyScene(scene);
      if (JSON.stringify(scene) !== JSON.stringify(base.scene)) next.scene = scene;
    }
    return next;
  }
  const unsub = model.subscribe((evt) => {
    if (!evt || evt.type !== 'items' || syncing || closed) return;
    const items = model.items();
    const ok = known();
    const mods = items.filter((it) => !it.fixed);
    const ghosts = mods.filter((it) => !ok.has(it.id));
    if (ghosts.length) {
      notes.push('A copy of a module needs a module of its own on this screen. That is not built yet, so the copy was not placed.');
      syncing = true;
      try { for (const g of ghosts) model.remove(g.id); } finally { syncing = false; }
    }
    // Placement and module doors.
    let next;
    let shown = null;
    if (savable) {
      const stored = new Map((Array.isArray(synced?.placed) ? synced.placed : []).filter((e) => e && e.id).map((e) => [e.id, e]));
      next = build(synced || startLayout(), (it) => entryLike(stored.get(it.id), it));
      let r;
      try { r = save(next, synced); } catch (err) { console.error('dashboard_editor: save', err); r = undefined; }
      synced = next;
      if (r && typeof r === 'object' && r.layout) shown = r.layout;
    } else {
      const prev = new Map(arr.placed().map((e) => [e.id, e]));
      next = build(startLayout(), (it) => fromItem(it, prev.get(it.id)));
    }
    Promise.resolve(apply(shown || next)).then(() => tell()).catch((err) => console.error('dashboard_editor: apply', err));
    // Frames: what each one shows is its own row.
    for (const it of model.items().filter((x) => x.canShow && ok.has(x.id))) {
      const rec = arr.recFor(it.id);
      let cur = null;
      try { cur = rec?.state?.get?.()?.shows ?? null; } catch { cur = null; }
      if ((cur || null) !== (it.shows || null)) {
        try { rec?.state?.set?.({ shows: it.shows || null }); } catch (err) { console.error('dashboard_editor: shows', err); }
      }
    }
  });

  // ---- the person's dashboards, for the choices and the map ----
  let dashList = null;
  async function refresh() {
    if (typeof listDashboards !== 'function') { dashList = []; return dashList; }
    try { dashList = ((await listDashboards()) || []).filter((d) => d && d.id).map((d) => ({ id: d.id, name: d.name })); }
    catch { dashList = dashList || []; }
    return dashList;
  }
  async function makeNew() {
    if (typeof createDashboard !== 'function') return null;
    const name = newDashboardName(dashList || []);
    const d = await createDashboard(name);
    if (!d || !d.id) return null;
    dashList = [...(dashList || []), { id: d.id, name: d.name || name }];
    return { id: d.id, name: d.name || name };
  }

  // ---- the windows ----
  const box = host || doc.createElement('div');
  if (!host) {
    box.className = 'v-edit';
    box.style.cssText = 'position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:8px;'
      + 'max-height:calc(100% - 16px);overflow:auto;z-index:var(--z-menus,600);pointer-events:auto';
    (mountIn || doc.body).append(box);
  }
  const opened = {};
  const group = createWindowGroup(() => Object.values(opened));
  // Windows whose own Close puts only THEM away (the editing goes on); Close on any other ends the editing.
  const SIDE = new Set(['map', 'automation']);
  // Row 2.41: what is on this dashboard, for the Automation window -- every module, slotted or placed.
  const autoPanels = () => (((arr.profile && arr.profile()) || { modules: [] }).modules || []).filter((m) => m && m.id).map((m) => {
    const rec = arr.recFor?.(m.id) || null;
    const manifest = getManifest(m.type) || null;
    return { id: m.id, title: rec?.title || manifest?.title || m.type || m.id, manifest, instance: rec?.instance || null };
  });
  const chosenPanel = () => { const it = model.selected(); return it && !it.fixed ? it.id : null; };
  function close() {
    if (closed) return;
    closed = true;
    for (const w of Object.values(opened)) { try { w.destroy(); } catch { /* gone */ } }
    for (const k of Object.keys(opened)) delete opened[k];
    try { unsub(); } catch { /* gone */ }
    if (!host) box.remove();
    try { onClose?.(); } catch (err) { console.error('dashboard_editor: onClose', err); }
    tell();
  }
  function mountOne(kind) {
    if (closed || opened[kind]) return opened[kind] || null;
    const h = doc.createElement('div');
    // The map goes last; every other window keeps the order it was asked for.
    box.append(h);
    if (kind === 'transform') opened[kind] = mountTransformWindow(h, model, { onClose: close });
    else if (kind === 'layers') {
      opened[kind] = mountLayersWindow(h, model, {
        onClose: close,
        // A person hiding a panel by hand (Layers' Shown/Hidden) may be asked what its sound should do.
        onShownToggle: (id, shown) => { if (!shown) { try { hidePolicy?.personHid?.(id); } catch { /* not load-bearing */ } } },
        onAutomation: automation ? () => toggle('automation') : null,
        automationOpen: () => !!opened.automation,
      });
    } else if (kind === 'links') {
      opened[kind] = mountLinksWindow(h, model, {
        onClose: close, dashboards: () => dashList, refresh, current: currentId,
        onNew: typeof createDashboard === 'function' ? () => makeNew() : null,
        onMap: typeof loadMap === 'function' ? () => toggle('map') : null,
        mapOpen: () => !!opened.map,
      });
    } else if (kind === 'map' && typeof loadMap === 'function') {
      // The map's own Close puts the map away; the editing goes on (Close on any OTHER window ends it).
      opened[kind] = mountMapWindow(h, {
        load: loadMap, current: currentId,
        onGo: (id) => { try { onGo?.(id); } catch (err) { console.error('dashboard_editor: go', err); } },
        onClose: () => { delete opened.map; h.remove(); opened.links?.render?.(); },
      });
    } else if (kind === 'automation' && automation) {
      // Row 2.41. Its own Close puts it away; the editing goes on (as the map).
      opened[kind] = mountAutomationWindow(h, {
        engine: automation, panels: autoPanels, selected: chosenPanel, chooseMode, topics,
        onClose: () => { delete opened.automation; h.remove(); opened.layers?.render?.(); tell(); },
      });
    } else { h.remove(); return null; }
    return opened[kind];
  }
  function toggle(kind) {
    if (closed) return false;
    if (opened[kind]) {
      try { opened[kind].close(); } catch { /* gone */ }
      if (!SIDE.has(kind)) return false;           // (closing any window but the map or Automation ends the editing)
      delete opened[kind];
      return false;
    }
    const ok = !!mountOne(kind);
    if (ok && kind === 'automation') tell();
    return ok;
  }
  for (const k of windows) mountOne(k);
  tell();
  return {
    model,
    windows: opened,
    scan: group,
    notes: () => notes.slice(),
    dashboards: () => (dashList ? dashList.slice() : null),
    refresh,
    toggle,
    close,
    isOpen: () => !closed,
    el: box,
  };
}
