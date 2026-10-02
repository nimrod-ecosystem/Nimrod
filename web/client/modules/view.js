// modules/view.js — A VIEW: an arrangement of modules, as a module.
//
// *** THIS IS MIKE'S ARCHITECTURE, AND IT REPLACES A SPECIAL CASE RATHER THAN ADDING TO IT. ***
//
//   Mike, 2026-08-29: *"in a way it almost seems like a kiosk is a module, isn't it? It's just
//   a module that holds other modules … fix that rather than patch over it. We need to get it
//   right the first time as opposed to building on top of something that's gonna give us more
//   and more problems down the road."*
//
// He is right, and `director.js` already proves the pattern: a module that mounts other modules
// through `mountModule`, re-scoping the bus per child. A view is the same idea one level up.
//
// ---------------------------------------------------------------------------------------
// WHAT WAS WRONG, AND WHY A BESPOKE SWAP WAS THE SYMPTOM
// ---------------------------------------------------------------------------------------
// The word "kiosk" was doing two jobs:
//
//   THE SURFACE  builds the buses (input runtime, output, audio, camera owner, drive socket),
//                owns the chrome and the recovery ladder. Exactly one, per page.
//   THE VIEW     a set of modules and where they sit. Swappable, and there can be many.
//
// Only the first has to be page-level. Welding them together is why changing what is on the
// screen used to mean NAVIGATING THE PAGE - which destroys every bus, releases the camera and
// closes the socket - and why the in-place swap had to be hand-written at all. With a view as
// a module, swapping is `destroy one, mount another`: lifecycle the runtime already has.
//
// *** AND IT DISSOLVES A QUESTION RATHER THAN ANSWERING IT. *** The in-place swap left a gap:
// a swapped-in arrangement rendered under the ORIGINAL one's theme and camera position,
// because settings were loaded once by the surface. A view owns its own chrome, so it brings
// its camera corner and its grid with it BY CONSTRUCTION. There is nothing left to decide.
//
// ---------------------------------------------------------------------------------------
// THE VOCABULARY, AND WHY IT IS BORROWED RATHER THAN INVENTED
// ---------------------------------------------------------------------------------------
// *** "SCREEN" WAS DOING TWO JOBS, AND THE COLLISION IS ALREADY IN THE CODE. ***
// `screen_pair.js` opens "HOW A FAMILY ADOPTS A BEDSIDE SCREEN" - a physical device, with a
// `device_keys` credential. `home.js` offers "Screens - make and fill your screens" - an
// arrangement of modules. The SERVER already keeps them apart (`profiles` vs `device_keys`);
// only the words were muddled, which is the dangerous shape because nothing fails.
//
// *** AND THIS WAS NEARLY CALLED A "SCENE", WHICH WOULD HAVE BUILT THE SAME COLLISION AGAIN. ***
// Mike asked whether there is familiar terminology for a bigger thing - one verb that sets
// lights, music and several devices at once, a "movie mode". There is, and it is already
// called a SCENE: Home Assistant, HomeKit, Hue and Sonos all use the word that way. (Harmony
// calls it an "Activity".) OBS uses "scene" the way this file nearly did - an arrangement on
// one canvas - so the word is genuinely ambiguous across domains, and we had picked the
// minority reading of a word we are about to meet in an HA integration.
//
// So the vocabulary is Home Assistant's, because that is the system we will be talking to and
// the intuitions users arrive with:
//
//     MODULE   one thing on a display          (HA calls it a card; Mike prefers module)
//     VIEW     an arrangement of modules on ONE display          <- this file
//     SCENE    one verb setting many views on many devices,      <- reserved, not built
//              plus lights, music, whatever else
//
// A VIEW IS DEVICE-AGNOSTIC ON PURPOSE. The same view is the same view on her Pi, on a tablet,
// or in a preview pane. Nothing here knows what it is being shown on, which is what lets a
// person's own call view - with their own AAC board on it - follow them between devices.
//
// (`layout` is NOT the free name: it already means the GRID - which preset, which slot.
// A view HAS a layout.)

// *** VOCABULARY, SUPERSEDED 2026-09-30 (DECISIONS.md, "The room is the screen..."). *** "Scene"
// now means THE BACKDROP a dashboard sits in (the room, fall, a castle, a live theme) -- the word the
// person using the site already uses -- and the Home-Assistant sense above is renamed "PRESET". The
// paragraph above is left as it was written. And Mike's word for this file's thing is "dashboard" ("the
// dashboard itself is a type of module ... a container module"); the registered type stays `view`
// for now because several suites enumerate registered types, and the rename is its own commit.
//
// ---------------------------------------------------------------------------------------
// STEP 6 STAGE 2 (2026-09-30): A THIN MODULE OVER `arrangement.js`
// ---------------------------------------------------------------------------------------
// This file used to carry its own copy of what the kiosk does -- and, being a copy, it had fallen
// behind: no ambient layer, unnamed cells, no empty-screen sentence, no per-panel background, nothing
// handed to a health watch, no focus and no unplaced swap -- and it leaked: the settings handle it
// opened was never closed, so every destroyed view kept polling. Now the arrangement itself is the
// ONE copy (`createArrangement`, moved out of kiosk.js at Stage 1), and this module only supplies
// what differs about being a module: its own DOM, its own per-child state scope, and the container
// contract below.
//
// *** THE CONTAINER CONTRACT (the step 6 plan's seam). *** `container: true`, and synchronous reads so
// a bar can call them while it draws: `panels()`, `focusRing()`, `focused()`, `modules()`; and the
// moves: `focus(id)`, `bring(type)`, `remount(id)`, `swap(id, type)`; `onChange(fn)` fires whenever what
// those return may have changed. From Stage 3b the bar and the settings menu are modules placed IN a
// dashboard (Mike, 2026-09-30) and this is what they read.
//
// WHAT THE HOST MAY HAND IN, all optional: `ctx.router` (the input router, so a switch and this view
// agree on focus -- without one the view keeps its own), `ctx.health` (a health watch: every panel
// is `watch`ed, a swapped one `forget`-ed), `ctx.storage` (where the one-at-a-time stage remembers its
// position -- a preview host MUST pass its own, or the real device's restart record is written),
// `ctx.embedded` (true: no links runner -- a preview is not a screen), `ctx.layoutOverride` (use this
// arrangement, `null` included, instead of the one saved in the view's settings).
// STAGE 4 (the real kiosk mounts this): `ctx.settingsHandle` (the host already holds this dashboard's
// settings doc open: use it, never reload or close it), `ctx.wrapState(id, state, type)` (a layer over
// each panel's own state -- the kiosk's automation), `ctx.startIndex` (where a one-at-a-time stage
// starts), and a chrome def's `over: true` (dock it over the stage's edge, not as a row). Read back:
// `settings()`, `settingsDoc()`, `onSettings(fn)` (the theme is the dashboard's own, R3) and `rootEl()`.

import { registerModule, mountModule, extendCtx, getManifest } from '../module.js';
// The chrome a dashboard can place (Stage 3b): registered here, with the thing that places them, so a
// page that can mount a dashboard can mount its bar and its menu. Not in modules_catalog.js: they are
// not something a caregiver picks from the modules page, they are what every dashboard starts with.
import './transport_bar.js';
import './settings_menu.js';
import { createArrangement } from '../arrangement.js';
import { flashLimit } from '../flash_limit.js';
import { layoutChange, placedGeometry } from '../layout.js';
// Stage R: the edit windows, bound to this dashboard's modules placed freely (`edit()` below).
import { createEditModel } from '../edit_model.js';
import { mountTransformWindow, mountLayersWindow } from '../edit_windows.js';

// The same defaults the kiosk has always used, so a view mounted from an existing
// arrangement looks exactly as it did before it became a module. (arrangement.js's own copy is the
// one applied; view_test's "falls back to the shipped default" check fails if the two drift.)
export const VIEW_DEFAULTS = { mirror: { size: 'lg', corner: 'tr' }, clock: { corner: 'bl' } };

// A module type that is pulled OUT of the flow into its own overlay, and which overlay.
export const OVERLAY_TYPES = { camera: 'mirror', clock: 'clock' };

/** Which modules go where, given an arrangement and its layout. PURE, and exported because a
 *  caller may want to ask without mounting anything. Since Stage 2 it is ANSWERED BY THE
 *  ARRANGEMENT -- the same resolve and partition the view and the kiosk run -- rather than by a
 *  second copy: two code paths deciding where a camera goes is how a swapped screen ends up subtly
 *  different from the same screen opened directly. (So a slot whose module is gone is repaired here
 *  exactly as it is on screen.) An ambient module is reported as `overlays.ambient`. */
export function partition(modules = [], layout = null) {
  const a = createArrangement({ embedded: true });      // no DOM, no links, nothing mounted
  a.setProfile({ modules });
  a.resolve(layout);
  a.partition();
  const out = { slots: a.layout() ? a.layout().slots.slice() : [], stage: a.stageDefs().slice(), overlays: {} };
  const hud = a.hudDefs();
  for (const def of [hud.camera, hud.clock]) if (def) out.overlays[OVERLAY_TYPES[def.type]] = def;
  if (hud.ambient) out.overlays.ambient = hud.ambient;
  return out;
}

registerModule(
  { type: 'view', title: 'View',
    description: 'A set of modules and where they sit — switchable as one thing',
    importance: 'normal', dependsOn: 'server', settings: [] },
  (ctx) => {
    // `viewId` is which arrangement to show. It is a ctx value rather than a setting because
    // a view is mounted BY something that already knows which one it wants — a surface at
    // boot, or a state machine switching.
    const viewId = ctx.viewId || ctx.profileId;
    const { mount, user } = ctx;
    const rootBus = ctx.rootBus || ctx.bus;      // children mount here; mountModule re-scopes
    const profiles = ctx.profiles || null;
    const makeState = ctx.makeState || null;
    const makeEvents = ctx.makeEvents || null;

    let root = null, stageEl = null, mirrorEl = null, clockEl = null, ambientEl = null;
    let arrangement = null;
    let arr = null;
    let settingsHandle = null;
    const offs = [];                             // every subscription this view made, undone on destroy
    const listeners = new Set();                 // onChange
    const settingsListeners = new Set();         // onSettings (Stage 4)
    const borrowedSettings = ctx.settingsHandle || null;   // a doc the host lends (Stage 4), never closed here
    let torn = false;

    // Per-CHILD handles, keyed to this view's arrangement rather than to whatever the
    // surface was mounted with. A view shown somewhere else must still find its own data.
    const childState = (id) => (makeState ? makeState(id, {}, viewId) : null);
    const childEvents = (id) => (makeEvents ? makeEvents(id, {}, viewId) : null);

    // *** AND THE SAME SCOPE FOR A CHILD THAT MAKES ITS OWN HANDLE (fixed 2026-08-31). ***
    //
    // `mountChild` spreads `...ctx`, so a child asking for a SHARED row by name — the way
    // `modules/bank.js` reaches one syllabus that Trivia and Word Forge both read — was
    // getting the HOST's `makeState`, whose third argument is the profile. Called with two
    // arguments from inside a module it resolved to `undefined`, and the key came out as
    // `undefined:bank`: not scoped to this view, not scoped to anything, and rejected
    // outright by the server's key rule the moment it tried to save.
    //
    // Caught by `view_test`'s "every child handle is scoped to the view it belongs to" — a
    // check written for the per-child handles above, which happened to also be the only thing
    // watching this. Worth noting for what it says about the seam rather than the bug: a
    // container that hands its own ctx down hands down the host's idea of scope with it.
    const childMakes = {
      ...(makeState ? { makeState: (key, opts = {}) => makeState(key, opts, viewId) } : {}),
      ...(makeEvents ? { makeEvents: (key, opts = {}) => makeEvents(key, opts, viewId) } : {}),
    };

    function destroyRec(rec) {
      if (!rec) return;
      try { rec.instance.destroy(); } catch { /* noop */ }
      try { rec.state?.destroy?.(); } catch { /* noop */ }
      try { rec.events?.destroy?.(); } catch { /* noop */ }
    }

    // How one child is mounted: the arrangement's `mountInstance` hand. Throws if the child does, and
    // the arrangement turns that into the in-cell notice (it is the one that knows where the cell is).
    // Returns the record shape the kiosk's `mountInstance` returns, so the arrangement cannot tell the
    // two hosts apart.
    async function mountChild(def, host) {
      // STAGE 4: a host that layers something over each panel's own state hands in `ctx.wrapState`
      // (the kiosk's automation layer, row 2.41: a bound input drives a panel's number setting without
      // writing it). Absent, the panel gets its own handle exactly as before.
      const raw = childState(def.id);
      let state = raw;
      if (raw && typeof ctx.wrapState === 'function') {
        try { state = ctx.wrapState(def.id, raw, def.type) || raw; } catch (err) {
          console.error('view: wrapState', err); state = raw;
        }
      }
      const events = childEvents(def.id);
      // `extendCtx`, not a spread: the host's getters (`personId`, `callTransport`, `aim`...) stay
      // getters for the child, so a child mounted before a value arrives still sees it. 2026-09-30.
      const instance = mountModule(def.type, extendCtx(ctx, {
        ...childMakes, mount: host, bus: rootBus, state, events,
        profileId: viewId, instanceId: def.id,
      }));
      await state?.load?.().catch(() => {});
      await events?.load?.().catch(() => {});
      // THIS PANEL'S OWN BACKGROUND (`instancePanelSurface`), the same reserved key on the panel's own
      // state row that kiosk.js's `mountInstance` reads, for the same reason: a pick made for one
      // panel reaches that panel's host, and anything else leaves the screen-wide rule in charge.
      state?.subscribe?.((s) => {
        const v = s && s.instancePanelSurface;
        if (v === 'solid' || v === 'veil' || v === 'clear') host.dataset.panelSurface = v;
        else delete host.dataset.panelSurface;
      });
      instance.init();
      state?.startPolling?.();
      events?.startPolling?.();
      return { instance, state, events, type: def.type, id: def.id,
               title: instance.manifest?.title, el: host };
    }

    // THE HOST'S HEALTH WATCH, if it handed one in. A watch must never break a mount.
    function watchRec(rec) {
      if (!rec) return rec;
      try { ctx.health?.watch?.(rec.id, rec.type); } catch { /* not load-bearing */ }
      return rec;
    }

    // FOCUS WITHOUT A ROUTER. On a screen, focus lives in the input router, and the host hands it in
    // (`ctx.router`) so a switch and this view mean the same panel. A view mounted with none (a test,
    // a preview) still needs a "which panel": this is the smallest router the arrangement reads.
    let localFocus = null;
    const localRouter = {
      focused: () => localFocus,
      setFocus: (id) => { localFocus = id ? { id } : null; },
      focusNext() {},
      reachable: () => [],
    };
    const router = ctx.router || localRouter;

    let lastStage = null;
    function changed() {
      // The one-at-a-time stage says what it is showing, as this view always has.
      if (arr && !arr.layout() && arr.stageRec()) {
        const key = arr.stageRec().id;
        if (key !== lastStage) {
          lastStage = key;
          rootBus.publish('view/stage', { viewId, moduleId: key, index: arr.primary() });
        }
      }
      for (const fn of listeners) { try { fn(); } catch (err) { console.error('view: onChange', err); } }
    }

    const brief = (rec) => (rec ? { id: rec.id, type: rec.type, title: rec.title || rec.type } : null);

    // ---- CHROME: the bar, the menu and the edit menus, PLACED in this dashboard (Stage 3b) -----------
    //
    // Mike, 2026-09-30: *"They are modules. They're not being drawn by a module. They're being placed
    // in the dashboard."* `ctx.chrome` is the list: `[{ id, type, dock }]`, a module whose manifest
    // declares `chrome: 'bar' | 'menu' | 'edit'`, docked along one edge (`bottom`, `top`, `left`,
    // `right`). Docking is the first placement there is; placing them IN THE SCENE (the room's
    // cabinet, its door) is the scene-placement stage, and changes where they are drawn, not this.
    //
    // NOT PANELS: they are not in the arrangement's module list, so they get no chip, are never
    // focused, never partitioned into the HUD and never offered as a recovery fallback (recovery.js
    // filters `chrome`). Nor are they health-watched: a bar publishes no heartbeat, and a watch that
    // expects one would call it stalled.
    //
    // *** WHAT THE SHELL NEEDS FROM THIS: WHETHER ANYTHING CARRIES EACH ROLE. *** `chrome()` answers,
    // per role, 'carried' (mounted), 'pending' (still mounting), 'failed' (threw) or 'none' (nothing
    // placed, or it was removed). The shell's PLAIN bar is shown by that answer -- "automatically, when
    // no object carries the transport bar: it was removed, or its module failed to mount within 2 s"
    // (Design) -- and the 2 s is the SHELL's clock, not this: the dashboard only says what it knows.
    // A chrome module that never finishes mounting must not hold up the dashboard either, so they are
    // started and NOT awaited by `init`.
    const CHROME_ROLES = ['bar', 'menu', 'edit'];
    const chromeRecs = new Map();              // id -> { def, role, status, instance, host }
    const docks = {};
    function dockFor(where) {
      const w = ['bottom', 'top', 'left', 'right'].includes(where) ? where : 'bottom';
      if (!docks[w]) {
        docks[w] = document.createElement('div');
        docks[w].className = `v-dock v-dock-${w}`;
        root.append(docks[w]);
        root.classList.add('v-docked', `v-has-${w}`);
      }
      return docks[w];
    }
    function chromeStatus() {
      const out = {};
      for (const role of CHROME_ROLES) {
        const recs = [...chromeRecs.values()].filter((r) => r.role === role);
        out[role] = !recs.length ? 'none'
          : recs.some((r) => r.status === 'carried') ? 'carried'
            : recs.some((r) => r.status === 'pending') ? 'pending' : 'failed';
      }
      return out;
    }
    async function mountChrome(def) {
      const role = getManifest(def.type)?.chrome || def.role || null;
      const host = document.createElement('div');
      host.className = 'v-chrome';
      host.dataset.chrome = role || '';
      const dock = dockFor(def.dock);
      // STAGE 4: `over: true` docks it OVER the stage's edge instead of as a row of the dashboard, so a
      // real screen's panels keep the whole screen and the bar sits over them when it shows (the plain
      // bar always did). Inline, on the dock, so it needs nothing from a stylesheet.
      if (def.over === true) {
        dock.dataset.over = '1';
        dock.style.position = 'absolute';
        dock.style.left = '0'; dock.style.right = '0';
        if ((def.dock || 'bottom') === 'top') dock.style.top = '0'; else dock.style.bottom = '0';
        dock.style.pointerEvents = 'none';
        host.style.pointerEvents = 'auto';
        host.style.height = 'auto';
      }
      dock.append(host);
      const rec = { def, role, status: 'pending', instance: null, host };
      chromeRecs.set(def.id, rec);
      try {
        // No per-instance state: nothing about a placed bar or menu is saved yet. The container is
        // THIS dashboard (`self`), so the bar can read its panels and hear when they change.
        rec.instance = mountModule(def.type, extendCtx(ctx, {
          ...childMakes, mount: host, bus: rootBus, state: null, events: null,
          profileId: viewId, instanceId: def.id, container: self,
        }));
        await rec.instance.init();
        if (torn || chromeRecs.get(def.id) !== rec) { try { rec.instance.destroy(); } catch { /* gone */ } return; }
        rec.status = 'carried';
      } catch (err) {
        console.error(`view: ${def.type} (placed ${role || 'chrome'}) failed to start`, err);
        if (chromeRecs.get(def.id) !== rec) return;
        rec.status = 'failed';
        try { rec.instance?.destroy(); } catch { /* gone */ }
        rec.instance = null;
        host.remove();
      }
      changed();
    }
    function removeChrome(id) {
      const rec = chromeRecs.get(id);
      if (!rec) return false;
      chromeRecs.delete(id);
      try { rec.instance?.destroy(); } catch { /* already gone */ }
      rec.host.remove();
      changed();
      return true;
    }

    // ---- STAGE R: FREE PLACEMENT, APPLIED IN PLACE, AND THE EDIT WINDOWS OVER IT ---------------------
    //
    // `rawLayout` is the layout as SAVED (or as the host handed it in), which is what `layoutChange`
    // compares -- the same comparison the kiosk's 09-12 watch makes. A change that is only a placement
    // change is applied by the arrangement in place (`arr.applyPlaced`): the moved module moves, nothing
    // is remounted. A grid change does what a dashboard always did with one after boot: nothing, until
    // it is rebuilt (the kiosk reloads; Stage 4 is where a dashboard rebuilds itself).
    const overridden = 'layoutOverride' in ctx;
    let rawLayout = null;
    let editor = null;                           // the open edit windows, if any
    async function applyPlacedHere(next) {
      if (!arr) return { applied: false, reason: 'not mounted' };
      const r = await arr.applyPlaced(next);
      if (r && r.applied) { rawLayout = next; changed(); }
      return r;
    }

    // *** THE EDIT WINDOWS, BOUND TO THE MODULES PLACED FREELY. *** (edit_model.js / edit_windows.js,
    // 01a4c69: "whatever owns the real things builds a model from its own records, subscribes, and
    // applies what changes".) Opened by whoever is editing this dashboard -- today the modules page
    // (Stage 3's dashboard path) or a test; a `chrome: 'edit'` menu module is where a switch reaches
    // it, once there is one. The windows are solid and non-modal with Close first (their own promise),
    // so an open editor is never a gate: nothing waits on it, and Close or Escape always ends it.
    //
    // Every 'items' change is written back THROUGH THE ARRANGEMENT (in place), and -- only when this
    // dashboard reads its own saved layout -- saved to its settings doc. A host that handed the layout
    // in (`layoutOverride`: the modules page) is held in memory only, as that page promises.
    //
    // NOT BUILT: a copy/paste/duplicate of a module. A copy needs a module INSTANCE of its own on this
    // screen (profiles.addModule), not just a second box; the model's copy is taken back out and the
    // editor says so in `notes()`, rather than showing a box that is not on the screen.
    function openEdit({ windows = ['transform', 'layers'], host: winHost = null } = {}) {
      if (!arr || !root) return null;
      if (editor) return editor;
      const notes = [];
      const known = () => new Set((arrangement?.modules || []).map((m) => m.id));
      const toItem = (e) => {
        const g = placedGeometry(e);
        const rec = arr.recFor(e.id);
        return { id: e.id, name: rec?.title || rec?.type || e.id, x: g.x, y: g.y, scale: g.scale, rot: g.rot,
          layer: g.layer, place: e.place, surface: g.surface, shown: e.shown !== false, locked: e.locked === true };
      };
      const fromItem = (it, prev) => {
        const e = { ...(prev || { id: it.id }), place: it.place, x: it.x, y: it.y, scale: it.scale, rot: it.rot, layer: it.layer };
        if (it.place === 'scene') e.surface = it.surface; else delete e.surface;
        if (it.shown === false) e.shown = false; else delete e.shown;
        if (it.locked) e.locked = true; else delete e.locked;
        return e;
      };
      const model = createEditModel({ items: arr.placed().map(toItem) });
      let syncing = false;
      const unsub = model.subscribe((evt) => {
        if (!evt || evt.type !== 'items' || syncing || !arr) return;
        const ok = known();
        const ghosts = model.items().filter((it) => !ok.has(it.id));
        if (ghosts.length) {
          notes.push('A copy of a module needs a module of its own on this screen. That is not built yet, so the copy was not placed.');
          syncing = true;
          try { for (const g of ghosts) model.remove(g.id); } finally { syncing = false; }
        }
        const prev = new Map(arr.placed().map((e) => [e.id, e]));
        const placed = model.items().filter((it) => ok.has(it.id)).map((it) => fromItem(it, prev.get(it.id)));
        const base = rawLayout || arr.layout() || { preset: 'full', slots: [] };
        const next = { ...base, placed };
        applyPlacedHere(next).catch((err) => console.error('view: edit', err));
        if (!overridden && settingsHandle?.set) {
          try {
            const cur = settingsHandle.get?.()?.kiosk || {};
            settingsHandle.set({ kiosk: { ...cur, layout: next } });
          } catch (err) { console.error('view: saving the placement', err); }
        }
      });
      const box = winHost || document.createElement('div');
      if (!winHost) {
        box.className = 'v-edit';
        box.style.cssText = 'position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:8px;'
          + 'max-height:calc(100% - 16px);overflow:auto;z-index:var(--z-menus,600);pointer-events:auto';
        root.append(box);
      }
      const opened = {};
      const close = () => {
        if (!editor || editor.model !== model) return;
        editor = null;
        for (const w of Object.values(opened)) { try { w.destroy(); } catch { /* gone */ } }
        try { unsub(); } catch { /* gone */ }
        if (!winHost) box.remove();
        changed();
      };
      // Closing any one window ends the editing (one way out, not a hunt for the last window).
      const mounts = { transform: mountTransformWindow, layers: mountLayersWindow };
      for (const k of windows) {
        if (!mounts[k]) continue;
        const h = document.createElement('div');
        box.append(h);
        // A person hiding a panel by hand (Layers' eye) may be asked what its sound should do (hide = mute,
        // ad7dc49) -- the host's policy, `ctx.hidePolicy`; an automatic hide never asks.
        opened[k] = mounts[k](h, model, {
          onClose: close,
          onShownToggle: (id, shown) => { if (!shown) { try { ctx.hidePolicy?.personHid?.(id); } catch { /* not load-bearing */ } } },
        });
      }
      editor = { model, windows: opened, notes: () => notes.slice(), close };
      changed();
      return editor;
    }

    // Declared, not returned directly, so the chrome modules can be handed THIS object as their
    // container (`ctx.container`).
    const self = {
      __probe: () => ({
        viewId, ready: !!arrangement, hasLayout: !!arr?.layout(), primary: arr ? arr.primary() : 0,
        stage: arr ? arr.stageDefs().map((d) => d.type) : [],
        slots: arr ? arr.slotRecs.map((r) => r.type) : [],
        placed: arr ? arr.placedRecs.map((r) => r.type) : [],
        overlays: arr ? [['mirror', arr.cameraRec()], ['clock', arr.clockRec()], ['ambient', arr.ambientRec()]]
          .filter(([, r]) => r).map(([k]) => k) : [],
        chrome: root ? { ...root.dataset } : null,
      }),
      __showStage: (i) => arr?.showPrimary(i),

      // ---- the container contract -------------------------------------------------------
      container: true,
      // (Stage R: on a laid-out dashboard, every panel -- slotted AND placed freely -- in ring order.)
      panels: () => (!arr ? [] : arr.layout() ? arr.panelRecs().map(brief) : [arr.stageRec()].filter(Boolean).map(brief)),
      focusRing: () => (arr ? arr.focusRing() : []),
      focused: () => (arr ? brief(arr.focusedRec()) : null),
      modules: () => (arrangement ? arrangement.modules.map((m) => ({ ...m })) : []),
      // Stage R: where the modules placed freely are (layout.js's entries), and the in-place move.
      placed: () => (arr ? arr.placed() : []),
      applyPlaced: (layout) => applyPlacedHere(layout),
      edit: (opts) => openEdit(opts),
      editing: () => editor,
      async focus(id) {
        if (!arr || !id) return false;
        if (arr.layout()) {
          if (!arr.panelRecs().some((r) => r.id === id)) return false;
          arr.focusPlaced(id);
          return true;
        }
        const j = arr.stageDefs().findIndex((d) => d.id === id);
        if (j < 0) return false;
        await arr.showPrimary(j);
        return true;
      },
      bring: (type) => (arr ? arr.showModule(type) : Promise.resolve(false)),
      remount: (id) => (arr ? arr.remountPanel(id) : Promise.resolve(false)),
      swap: (id, type) => (arr ? arr.swapPanel(id, type) : Promise.resolve(false)),
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      // THIS DASHBOARD'S ARRANGEMENT (arrangement.js), read-only by convention. Read by the kiosk
      // shell (its plain bar, its menu, recovery's hands) and by the placed transport bar, so both
      // bars draw from the same functions rather than a reshaped copy. Null until `init` built it.
      arrangement: () => arr,
      // ---- chrome (Stage 3b; see above) ----
      chrome: () => chromeStatus(),
      removeChrome,
      // ---- STAGE 4: THIS DASHBOARD'S OWN SETTINGS, for the shell that shows it ----
      // Per-dashboard themes (row 2.34, ruled; the step 6 plan's R3): the theme is part of what a
      // dashboard IS, so the shell reads it here when this dashboard is the one showing, and the menu's
      // Colours row writes it back here. `settings()` is a plain read ({} before init / unloadable);
      // `settingsDoc()` the handle itself (null until init); `onSettings(fn)` fires on every change.
      settings: () => (settingsHandle?.get?.() || {}),
      settingsDoc: () => settingsHandle,
      onSettings(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn); },
      // The element this dashboard draws into (its corners are on it), for the shell and the suites.
      rootEl: () => root,

      async init() {
        root = document.createElement('div');
        root.className = 'view';
        // The same four hosts, in the same order, as the kiosk's own template: the ambient layer
        // behind everything, the stage, and the two HUD corners.
        ambientEl = document.createElement('div'); ambientEl.className = 'k-ambient'; ambientEl.hidden = true;
        ambientEl.setAttribute('aria-hidden', 'true');
        stageEl = document.createElement('div'); stageEl.className = 'k-stage';
        mirrorEl = document.createElement('div'); mirrorEl.className = 'k-mirror'; mirrorEl.hidden = true;
        clockEl = document.createElement('div'); clockEl.className = 'k-clock'; clockEl.hidden = true;
        root.append(ambientEl, stageEl, mirrorEl, clockEl);
        mount.append(root);

        try {
          arrangement = ctx.arrangement || (profiles ? await profiles.get(viewId) : null);
        } catch (err) {
          console.error('view: could not load', viewId, err);
          arrangement = null;
        }
        if (torn) return;
        if (!arrangement || !Array.isArray(arrangement.modules)) {
          // *** A VIEW THAT CANNOT LOAD SAYS SO RATHER THAN RENDERING NOTHING. *** A blank
          // region on a screen somebody is sitting at is indistinguishable from a crash.
          stageEl.innerHTML = '<p class="view-empty">This view could not be loaded.</p>';
          return;
        }

        // Its OWN settings — theme and chrome travel with the arrangement. KEPT, so `destroy()`
        // can close it: this handle used to be opened, set polling, and never closed.
        // STAGE 4: a host that already holds THIS dashboard's settings doc open (the kiosk, for the
        // screen it booted on) lends it (`ctx.settingsHandle`), so one doc is not polled twice. A lent
        // handle is used, never loaded again and never closed here: it is the host's.
        settingsHandle = borrowedSettings || childState('settings');
        if (!borrowedSettings) await settingsHandle?.load?.().catch(() => {});
        if (torn) {
          if (!borrowedSettings) { try { settingsHandle?.destroy?.(); } catch { /* gone */ } }
          settingsHandle = null; return;
        }
        const settings = {
          get: () => settingsHandle?.get?.() || {},
          set: (p) => settingsHandle?.set?.(p),
        };

        arr = createArrangement({
          bus: rootBus, user, storage: ctx.storage, embedded: ctx.embedded === true, settings,
          kioskEl: root, stageEl, mirrorEl, clockEl, ambientEl,
          mountInstance: mountChild, destroyRec, watchRec, renderMods: changed,
          runtime: () => ({ router }),
          health: () => ctx.health || { forget() {} },
          profileId: () => viewId,
          // The host screen's flash limit (flash_limit.js), for this dashboard's room, read live.
          flashLimit: () => flashLimit(ctx),
        });

        arr.applyLayout(settings.get());
        if (settingsHandle?.subscribe) {
          const off = settingsHandle.subscribe((s) => {
            if (torn) return;
            arr.applyLayout(s || {});
            // STAGE 4: whoever shows this dashboard's own settings (its theme, R3) hears they changed.
            for (const fn of settingsListeners) { try { fn(s || {}); } catch (err) { console.error('view: onSettings', err); } }
          });
          if (typeof off === 'function') offs.push(off);
          settingsHandle.startPolling?.();
        }

        arr.setProfile(arrangement);
        // *** THE SAME RESOLVE THE KIOSK USES, AND THIS IS THE POINT OF SHARING IT. *** (It was a
        // second copy here once, and carried G1-G3 for a week after the kiosk's was fixed.) Now it
        // is not even a shared function call: it is the arrangement's own.
        // `ctx.layoutOverride` (Stage 3): a host that knows the arrangement it wants -- the modules page
        // shows ONE picked module, never the screen's saved grid -- hands it in, `null` included.
        rawLayout = overridden ? ctx.layoutOverride : (settings.get().kiosk || {}).layout;
        arr.resolve(rawLayout);
        arr.partition();
        await arr.mountOverlays();
        if (torn) return;
        // STAGE 4: `ctx.startIndex` -- where a cold boot lands on a one-at-a-time stage (the kiosk's
        // restart record), clamped; mounting index 0 first and then moving would start a module for nothing.
        const start = Number.isInteger(ctx.startIndex) && ctx.startIndex > 0 && ctx.startIndex < arr.stageDefs().length
          ? ctx.startIndex : 0;
        if (arr.layout()) await arr.mountLayout(); else await arr.showPrimary(start);
        if (torn) return;
        // Links, once the modules exist -- and again whenever the settings change, exactly as the
        // kiosk does. The runner exists only while there are links, so a view with none costs nothing.
        if (arr.screenLinks) {
          arr.screenLinks.sync();
          const off = settingsHandle?.subscribe?.(() => { if (!torn) arr.screenLinks.sync(); });
          if (typeof off === 'function') offs.push(off);
        }
        // Stage R: a PLACEMENT change saved to this dashboard's own settings (another device, an edit
        // window) is applied in place. Not for a layout the host handed in: that one is the host's.
        if (!overridden && settingsHandle?.subscribe) {
          const off = settingsHandle.subscribe((s) => {
            if (torn || !arr) return;
            const next = ((s || {}).kiosk || {}).layout;
            if (layoutChange(rawLayout, next) === 'placement') {
              applyPlacedHere(next).catch((err) => console.error('view: placement', err));
            }
          });
          if (typeof off === 'function') offs.push(off);
        }
        // The placed chrome, once there are panels for a bar to name. Started, not awaited: see
        // CHROME above. Every role it will carry is 'pending' from this moment.
        const placed = Array.isArray(ctx.chrome) ? ctx.chrome.filter((d) => d && d.id && d.type) : [];
        for (const def of placed) mountChrome(def).catch((err) => console.error('view: chrome', err));
        changed();
        rootBus.publish('view/ready', { viewId, modules: arrangement.modules.length });
      },

      onResize() {},
      onHide() {},

      destroy() {
        torn = true;
        try { editor?.close(); } catch { /* already gone */ }
        editor = null;
        offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
        listeners.clear();
        for (const id of [...chromeRecs.keys()]) removeChrome(id);
        try { arr?.destroy(); } catch { /* already gone */ }
        // THE LEAK (step 6 plan): opened, set polling, and never closed. Closed here, last, after
        // everything that might read it. (Not a LENT one -- Stage 4: that is the host's to close; this
        // view's own subscriptions on it went with `offs` above.)
        if (!borrowedSettings) { try { settingsHandle?.destroy?.(); } catch { /* already gone */ } }
        settingsHandle = null;
        settingsListeners.clear();
        // *** BREAK THE DEAD TREE APART (found by the Stage 4 bench soak, 2026-10-01). *** A module that
        // keeps one of its own elements alive after `destroy` (trivia and wordforge each held ~40 nodes
        // per mount, on every path) keeps EVERY node still connected to it alive too -- and on a screen
        // swap the whole dashboard is detached at once, so one such module held the entire old dashboard
        // (~200-550 nodes per swap, measured, against ~40 when the same panel is swapped off a stage that
        // stays in the page). Taking every element off its parent leaves a leaky module holding only
        // what it holds itself. The modules are already destroyed; nothing here is drawn any more.
        try {
          if (root) for (const n of [...root.querySelectorAll('*')].reverse()) n.remove();
        } catch { /* a tree that will not come apart is still going */ }
        root?.remove(); root = null;
        stageEl = mirrorEl = clockEl = ambientEl = null;
        arrangement = null; arr = null;
      },
    };
    return self;
  },
);
