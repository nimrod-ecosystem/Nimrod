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
// dashboard itself is a type of module ... a container module"). Since row 2.34 (2026-10-01) the
// registered type IS `dashboard`, with `view` kept as an alias (see the registration at the bottom).
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
// 2026-10-02, the builder dashboard (dashboards.js `builder`): the options of what is chosen in a panel being
// edited, and the modules library's place. Registered here, with the dashboard that holds them, so every
// page that can mount a dashboard can mount the builder (the kiosk's own module list is not this file's).
import './edit_options.js';
import './library_slot.js';
import { createArrangement } from '../arrangement.js';
import { flashLimit } from '../flash_limit.js';
// Row 2.38: a change that only moves a room object's door is a placement change too (room_doors.js).
import { classifyLayoutChange as layoutChange } from '../room_doors.js';
// Stage R: the edit windows, bound to this dashboard's modules placed freely (`edit()` below). Since row
// 2.38 the editor itself is dashboard_editor.js, shared with the kiosk's own path.
import { openDashboardEditor } from '../dashboard_editor.js';
import { mapLoader } from '../dashboard_map.js';
// Row 2.38: a dashboard placed INSIDE another one (recursion), its depth and its live limit.
import { DASHBOARD_GO_TOPIC, NEST_OPEN_TOPIC, nestMode, nestLiveDepthFrom, NEST_LIVE_DEPTH_KEY } from '../dashboard_nest.js';
// 2026-10-02: a panel's own sound (its volume, its room, a TV's things), and where the bar sits in a room.
import { watchPanelSound } from '../panel_sound.js';
import { barPlaceFrom, cabinetSlot, CABINET_STRIP_STYLE, fitBarInto, unfitBar } from '../room_bar.js';
// 2026-10-02: which panel a dashboard opens with being edited (edit_mode.js `editPanel`).
import { editSettingsFrom } from '../edit_mode.js';

// ---------------------------------------------------------------------------------------
// *** ROW 2.38: A DASHBOARD INSIDE A DASHBOARD ("turtles all the way down"). ***
// ---------------------------------------------------------------------------------------
// Placed as an ordinary module (a billboard, a picture frame, a TV in a room), a `dashboard` shows ANOTHER
// dashboard: the one its own setting `shows` names. Its host marks it NESTED by handing `ctx.nestDepth`
// (1 = inside the screen's dashboard; this file hands depth + 1 to its own children, and kiosk.js hands 1
// to the modules it mounts itself). A dashboard with no `nestDepth` is a screen's own, exactly as before.
//
// *** WHAT A NESTED ONE DOES NOT INHERIT. *** A child's ctx is its parent's, extended (module.js
// `extendCtx`), so without this list a nested dashboard would quietly be its parent again: the parent's
// `viewId`, its lent settings doc, its arrangement, its layout override, its placed bar and menu, its input
// router, its health watch and its restart record. A nested one is a PICTURE of another dashboard: its own
// doc, its own arrangement, no chrome, its own little focus (never the screen's router: a switch walks the
// screen, and presses the billboard as one thing), no health watch, no links (`embedded`), and an
// in-memory restart record.
//
// *** LIVE TO A DEPTH, THEN A CARD (dashboard_nest.js argues the default). *** At depth <= `nestLiveDepth`
// (the screen's setting, handed down as `ctx.nestLiveDepth`) it mounts the dashboard for real; deeper, it
// draws a CARD -- the dashboard's name and what is on it -- and mounts nothing. That is what makes a cycle
// safe: a dashboard showing itself renders (limit + 1) times and stops.
//   WHY A CARD AND NOT A PICTURE OF THE LAST RENDER: a browser has no way to photograph a piece of a page
//   without a large library re-drawing the DOM into a canvas, which on a Pi costs more than the live level
//   it would replace. A card costs one read of the screen record, says what is in there, and is
//   honest that it is not live.
//
// *** PRESSING IT IS GOING IN. *** A clear button over the whole thing publishes `dashboard/go { id }` (the
// kiosk's load-then-swap); a switch's `select` on it arrives as `dashboard/open` (actions.js MODULE_VERBS).
// So nothing inside a nested dashboard takes a press: you press the billboard, and the billboard becomes
// the screen.
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};

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

// *** REGISTERED AS `dashboard` (row 2.34, 2026-10-01), WITH `view` KEPT AS AN ALIAS. *** Mike's word for
// this thing is "dashboard" ("the dashboard itself is a type of module ... a container module"), and the
// step 6 plan's question 1 recommended it. `view` stays registered -- the SAME factory under its old name,
// its manifest saying `aliasOf: 'dashboard'` -- so anything saved or written against `view` (a screen
// record, a state machine's mount, a page not yet updated) keeps loading. The file keeps its name: it is
// imported from five places, and a rename of the file is a separate, mechanical commit.
export const DASHBOARD_TYPE = 'dashboard';
export const DASHBOARD_ALIASES = Object.freeze(['view']);
const DASHBOARD_MANIFEST = {
  type: DASHBOARD_TYPE, title: 'Dashboard',
  description: 'A set of modules and where they sit — switchable as one thing',
  importance: 'normal', dependsOn: 'server', settings: [],
};

function dashboardFactory(ctx) {
    // Row 2.38: how deep this one is (0 = a screen's own dashboard), and so whether it is NESTED.
    const depth = Number.isInteger(ctx.nestDepth) && ctx.nestDepth > 0 ? ctx.nestDepth : 0;
    const nested = depth > 0;
    // `viewId` is which arrangement to show. It is a ctx value rather than a setting because
    // a view is mounted BY something that already knows which one it wants — a surface at
    // boot, or a state machine switching.
    // (Row 2.38: a NESTED one is the exception -- what it shows is its own setting, `shows`, read at init.)
    let viewId = nested ? null : (ctx.viewId || ctx.profileId);
    const { mount, user } = ctx;
    const rootBus = ctx.rootBus || ctx.bus;      // children mount here; mountModule re-scopes
    const profiles = ctx.profiles || null;
    // A nested one takes the UNSCOPED makers its ancestors handed down (`nestMakeState`): the `makeState`
    // in its own ctx is its parent's, already bound to the parent's dashboard id (`childMakes` below).
    const makeState = (nested ? ctx.nestMakeState : ctx.makeState) || null;
    const makeEvents = (nested ? ctx.nestMakeEvents : ctx.makeEvents) || null;
    // The live limit: the screen's setting, as a number or a getter, read when it is needed.
    const liveLimit = () => {
      let v;
      try { v = typeof ctx.nestLiveDepth === 'function' ? ctx.nestLiveDepth() : ctx.nestLiveDepth; } catch { v = undefined; }
      return nestLiveDepthFrom({ [NEST_LIVE_DEPTH_KEY]: v });
    };
    // What a nested one never takes from its parent (see the header above).
    const hostRouter = nested ? null : ctx.router;
    const hostHealth = nested ? null : ctx.health;
    const hostStorage = nested ? memStorage() : ctx.storage;
    const hostEmbedded = nested ? true : ctx.embedded === true;
    const hostChrome = nested ? [] : ctx.chrome;
    const hostWrapState = nested ? null : ctx.wrapState;
    const hostStartIndex = nested ? 0 : ctx.startIndex;

    let root = null, stageEl = null, mirrorEl = null, clockEl = null, ambientEl = null;
    let arrangement = null;
    let arr = null;
    let settingsHandle = null;
    const offs = [];                             // every subscription this view made, undone on destroy
    // Row 2.38: the subscriptions made while FILLING it (its settings, its links, its opener) -- undone on
    // destroy and also when a nested one is told to show something else and fills itself again.
    const fillOffs = [];
    const listeners = new Set();                 // onChange
    const settingsListeners = new Set();         // onSettings (Stage 4)
    // a doc the host lends (Stage 4), never closed here. (Never a nested one's: the lent doc is the screen's.)
    const borrowedSettings = nested ? null : (ctx.settingsHandle || null);
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
      try { rec.offSound?.(); } catch { /* noop */ }
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
      // (`stateKey`: a panel switched to another type reads that type's own row -- arrangement.js
      // `switchPanel`, kiosk.js `mountInstance` says why.)
      const raw = childState(def.stateKey || def.id);
      let state = raw;
      if (raw && typeof hostWrapState === 'function') {
        try { state = hostWrapState(def.id, raw, def.type) || raw; } catch (err) {
          console.error('view: wrapState', err); state = raw;
        }
      }
      const events = childEvents(def.stateKey || def.id);
      // `extendCtx`, not a spread: the host's getters (`personId`, `callTransport`, `aim`...) stay
      // getters for the child, so a child mounted before a value arrives still sees it. 2026-09-30.
      const instance = mountModule(def.type, extendCtx(ctx, {
        ...childMakes, mount: host, bus: rootBus, state, events,
        profileId: viewId, instanceId: def.id,
        // Row 2.38: a dashboard among the children is one level deeper, and finds the unscoped makers.
        // (A host's own unscoped makers win -- the kiosk's `childCtx` hands them -- because a host's
        // `makeState` may itself be bound to one screen; without one, this dashboard's own.)
        nestDepth: depth + 1,
        ...((ctx.nestMakeState || makeState) ? { nestMakeState: ctx.nestMakeState || makeState } : {}),
        ...((ctx.nestMakeEvents || makeEvents) ? { nestMakeEvents: ctx.nestMakeEvents || makeEvents } : {}),
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
      // THIS PANEL'S OWN SOUND (panel_sound.js): the same rows, applied the same way as the kiosk's panels.
      const offSound = watchPanelSound(ctx.audio, def.id, state);
      instance.init();
      state?.startPolling?.();
      events?.startPolling?.();
      return { instance, state, events, type: def.type, id: def.id,
               title: instance.manifest?.title, el: host, offSound, ...(def.stateKey ? { stateKey: def.stateKey } : {}) };
    }

    // THE HOST'S HEALTH WATCH, if it handed one in. A watch must never break a mount.
    function watchRec(rec) {
      if (!rec) return rec;
      try { hostHealth?.watch?.(rec.id, rec.type); } catch { /* not load-bearing */ }
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
    const router = hostRouter || localRouter;

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
      // After the listeners: the placed bar has just redrawn its chips, so a bar on the cabinet is fitted
      // to what it now holds (2026-10-02).
      placeChromeBar();
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
        // NOT the host either (2026-10-02, late): its box is the bar's box, and while the bar is tucked away
        // (`visibility:hidden`) that empty box still took a press meant for the panel under it -- measured, a
        // calculator key under a tucked bar was unpressable. What the module DRAWS takes presses (set below,
        // once it has drawn); the box around it never does.
        dock.style.pointerEvents = 'none';
        host.style.pointerEvents = 'none';
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
        if (def.over === true) {
          for (const c of host.children) { if (!c.style.pointerEvents) c.style.pointerEvents = 'auto'; }
        }
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
    // *** THE BAR ON THE ROOM'S CABINET (2026-10-02; room_bar.js argues it and the default). *** The ONE
    // placed bar's host is moved -- never remounted -- between its dock and the room object that holds the
    // transport bar, as this dashboard's `barPlace` setting says. Run on every change (a room drawn or torn
    // down takes the slot with it: back to the dock, and in again when the room is back) and on a settings
    // change. Nothing about the bar itself changes: its buttons, chips and words are the same module's.
    let placingBar = false;
    function placeChromeBar() {
      if (placingBar || torn) return;
      placingBar = true;
      try {
        const want = barPlaceFrom(settingsHandle?.get?.() || {});
        const slot = want === 'cabinet' && arr ? cabinetSlot(arr.roomSlots?.()) : null;
        for (const rec of chromeRecs.values()) {
          if (rec.role !== 'bar' || !rec.host || rec.status === 'failed') continue;
          if (!rec.dockEl) rec.dockEl = rec.host.parentNode;
          if (slot && slot.el) {
            if (rec.host.parentNode !== slot.el) {
              if (rec.plainCss == null) rec.plainCss = rec.host.style.cssText;
              slot.el.append(rec.host);
            }
            rec.host.style.cssText = CABINET_STRIP_STYLE;
            // (The host is a module mount, and modules.css gives every one `overflow:auto !important`; the
            // fitted bar never needs a scrollbar, and a scrollbar on a strip this small hides a third of it.)
            rec.host.style.setProperty('overflow', 'hidden', 'important');
            rec.host.dataset.onCabinet = slot.id || '1';
            // The whole bar, scaled to the strip (room_bar.js `fitBarInto`), and again whenever the strip
            // changes size -- the cabinet pressed and lifted flat is a bigger strip, and a bigger bar.
            const fit = () => { try { fitBarInto(rec.host.querySelector('.tb-bar'), rec.host); } catch { /* not drawn yet */ } };
            fit();
            if (!rec.fitRO && typeof ResizeObserver !== 'undefined') {
              rec.fitRO = new ResizeObserver(() => { if (rec.host.dataset.onCabinet) fit(); });
              rec.fitRO.observe(rec.host);
            }
          } else if (rec.dockEl && (rec.host.parentNode !== rec.dockEl || rec.host.dataset.onCabinet)) {
            rec.dockEl.append(rec.host);
            if (rec.plainCss != null) { rec.host.style.cssText = rec.plainCss; rec.plainCss = null; }
            delete rec.host.dataset.onCabinet;
            try { rec.fitRO?.disconnect(); } catch { /* gone */ }
            rec.fitRO = null;
            unfitBar(rec.host.querySelector('.tb-bar'));
          }
        }
      } catch (err) { console.error('view: placing the bar', err); }
      finally { placingBar = false; }
    }
    /** Where the placed bar is: 'cabinet' | 'dock' | null (no bar). For the menu and the suites. */
    function barPlace() {
      const rec = [...chromeRecs.values()].find((r) => r.role === 'bar' && r.host && r.status !== 'failed');
      if (!rec) return null;
      return rec.host.dataset.onCabinet ? 'cabinet' : 'dock';
    }

    function removeChrome(id) {
      const rec = chromeRecs.get(id);
      if (!rec) return false;
      chromeRecs.delete(id);
      try { rec.fitRO?.disconnect(); } catch { /* already gone */ }
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
    const overridden = !nested && 'layoutOverride' in ctx;
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
    //
    // ROW 2.38: the editor is dashboard_editor.js now (shared with the kiosk's own path), and it edits
    // more: what each thing OPENS, what a frame SHOWS, the room's own objects' doors, and the Map. The
    // person's dashboards come from the screens client; the map reads every dashboard's rows through the
    // UNSCOPED makers (a nested one's `nestMakeState`, else this one's own), never this dashboard's
    // scoped `childMakes`.
    const rowMaker = ctx.nestMakeState || makeState;
    function openEdit({ windows, host: winHost = null } = {}) {
      if (!arr || !root) return null;
      if (editor) return editor;
      const ed = openDashboardEditor({
        arr, mountIn: root, host: winHost,
        ...(windows ? { windows } : {}),
        baseLayout: () => rawLayout || arr.layout(),
        apply: (next) => applyPlacedHere(next),
        // Saved unless the host handed the layout in and did not say it may be saved (the modules page:
        // memory only, as it promises). A REAL screen hands its boot layout in too (Stage 4) and says
        // `saveLayout` -- without it, an edit on a real screen's dashboard was never written anywhere.
        save: (overridden && ctx.saveLayout !== true) || !settingsHandle?.set ? null : (next) => {
          try {
            const cur = settingsHandle.get?.()?.kiosk || {};
            settingsHandle.set({ kiosk: { ...cur, layout: next } });
          } catch (err) { console.error('view: saving the placement', err); }
        },
        listDashboards: typeof profiles?.list === 'function' ? () => profiles.list() : null,
        createDashboard: typeof profiles?.create === 'function'
          ? (name) => profiles.create(name, (() => { try { return arrangement?.person_id || ctx.personId || ''; } catch { return ''; } })())
          : null,
        currentId: () => viewId,
        loadMap: typeof profiles?.list === 'function' && typeof rowMaker === 'function'
          ? mapLoader({ profiles, makeRow: (pid, key) => rowMaker(key, { cacheKey: null }, pid), title: (t) => getManifest(t)?.title || t })
          : null,
        onGo: (id) => { try { rootBus?.publish?.(DASHBOARD_GO_TOPIC, { id, source: 'map', claim: () => {} }); } catch (err) { console.error('view: map go', err); } },
        // A person hiding a panel by hand may be asked what its sound should do (hide = mute, ad7dc49).
        hidePolicy: { personHid: (id) => ctx.hidePolicy?.personHid?.(id) },
        onClose: () => { if (editor === ed) editor = null; },
        onChange: () => changed(),
        // The screen's automation engine, so Layers offers "Automation..." (edit_windows' automation window).
        automation: typeof hostWrapState === 'function' ? (ctx.automation || null) : null,
        // 2026-10-04: the person's "How you choose things" (the kiosk's ctx.chooseMode), which picks how a switch
        // walks the Automation window (rows for step through, one at a time for point and click).
        chooseMode: () => { try { return typeof ctx.chooseMode === 'function' ? ctx.chooseMode() : (ctx.chooseMode || 'point'); } catch { return 'point'; } },
      });
      editor = ed;
      changed();
      return editor;
    }

    // ---- ROW 2.38: the nested one's card, and pressing it ------------------------------------------
    // *** A NESTED ONE IS A PANEL, AND A PANEL THAT SAYS NOTHING IS JUDGED STALLED (health.js). *** A
    // billboard publishes nothing of its own, so after 15 minutes the recovery ladder would swap it away.
    // The right fix is a HEALTH_EXPECT row (`dashboard: { idle: true }`, and `view`) -- in health.js, which
    // this change does not touch -- so until it lands, a nested dashboard says it is here: once as it
    // comes up and every NEST_PULSE_MS after, tagged with its own panel id (health.js's owner rule).
    // Not a setting (Rule 1, argued): it is a liveness signal far inside the watch's 15-minute bound and
    // its 2-minute settle, not something a person tunes; remove it when the row lands.
    const NEST_PULSE_MS = 5 * 60 * 1000;
    let pulseT = null;
    const pulse = () => {
      try { rootBus?.publish?.('dashboard/state', { shows: viewId, depth, mode: nestMode_ }, { panel: ctx.instanceId || null }); }
      catch { /* a pulse must never break a panel */ }
    };
    function startPulse() {
      if (!nested || pulseT || torn) return;
      pulse();
      pulseT = setInterval(pulse, NEST_PULSE_MS);
    }
    let opener = null;
    let nestMode_ = nested ? null : 'screen';
    /** Going in: the screen shows the dashboard this one shows (the kiosk's load-then-swap). */
    function openNested(source) {
      if (!nested || !viewId || torn) return false;
      let claimed = false;
      try {
        rootBus?.publish?.(DASHBOARD_GO_TOPIC, { id: viewId, source, instanceId: ctx.instanceId || null,
          depth, claim: () => { claimed = true; } });
      } catch (err) { console.error('view: open', err); }
      return claimed;
    }
    function addOpener(name) {
      if (!root || opener) return;
      opener = document.createElement('button');
      opener.type = 'button';
      opener.className = 'v-nest-open';
      const label = `open ${name || 'this dashboard'}`;
      opener.setAttribute('aria-label', label);
      opener.title = label;
      // Above anything the nested dashboard draws (its root is its own stacking context: `.view` isolates).
      opener.style.cssText = 'position:absolute;inset:0;z-index:calc(var(--z-menus, 600) + 10);margin:0;padding:0;border:0;'
        + 'background:transparent;cursor:pointer';
      opener.addEventListener('click', (e) => { e.stopPropagation(); openNested('pointer'); });
      root.append(opener);
      // A switch: `select` on this panel arrives as `dashboard/open` (actions.js MODULE_VERBS.dashboard).
      const off = ctx.bus?.subscribe?.(NEST_OPEN_TOPIC, () => { openNested('scan'); });
      if (typeof off === 'function') fillOffs.push(off);
    }
    /** The card: a dashboard too deep to draw live, or none chosen. `rec` is its screen record (or null). */
    function drawCard(rec, sentence = null) {
      nestMode_ = sentence ? 'empty' : 'card';
      if (!stageEl) return;
      const card = document.createElement('div');
      card.className = 'v-nest-card';
      card.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
        + 'justify-content:center;gap:.4em;padding:6%;text-align:center;overflow:hidden;'
        + 'background:var(--surface, #fffdf3);color:var(--text, #0A3323);border:2px solid var(--border, #c8cfa8);'
        + 'border-radius:10px;font:600 clamp(11px,2.4vmin,22px)/1.25 -apple-system,BlinkMacSystemFont,'
        + 'Segoe UI,Roboto,sans-serif';
      const title = document.createElement('div');
      title.className = 'v-nest-name';
      title.textContent = sentence || (rec && rec.name) || 'A dashboard';
      card.append(title);
      if (!sentence) {
        const mods = (rec && Array.isArray(rec.modules) ? rec.modules : []).filter((m) => m && m.type)
          .map((m) => getManifest(m.type)?.title || m.type);
        if (mods.length) {
          const what = document.createElement('div');
          what.className = 'v-nest-what';
          what.style.cssText = 'font-weight:400;opacity:.8;font-size:.8em';
          what.textContent = mods.slice(0, 4).join(' · ') + (mods.length > 4 ? ` +${mods.length - 4}` : '');
          card.append(what);
        }
        const hint = document.createElement('div');
        hint.style.cssText = 'font-weight:400;opacity:.7;font-size:.75em';
        hint.textContent = 'Press to go in';
        card.append(hint);
      }
      stageEl.append(card);
    }

    // Declared, not returned directly, so the chrome modules can be handed THIS object as their
    // container (`ctx.container`).
    const self = {
      // Row 2.38: how this dashboard is drawn -- 'screen' (a screen's own), 'live' / 'card' (nested),
      // 'empty' (nested, nothing chosen) -- with its depth and what it shows. For the suites and the map.
      nest: () => ({ depth, mode: nestMode_, shows: nested ? viewId : null, limit: nested ? liveLimit() : null }),
      open: () => openNested('call'),
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
      // 2026-10-02 -- "Switch module": the panel `id` becomes a `type`, in place, remembered on this
      // dashboard (arrangement.js `switchPanel` argues the keep-the-old-row rule).
      switchPanel: (id, type) => (arr ? arr.switchPanel(id, type) : Promise.resolve(false)),
      // ...and Home's editor: ANOTHER instance into a slot, the arrangement's list and placement updated
      // (arrangement.js `replaceSlot`, then the placement through the in-place path). The caller saves.
      replace: async (oldId, def, nextLayout) => {
        if (!arr || !def?.id) return { applied: false };
        if (arr.slotRecs.some((r) => r.id === oldId)) {
          const ok = await arr.replaceSlot(oldId, def);
          if (nextLayout) rawLayout = nextLayout;
          changed();
          return { applied: !!ok, replaced: !!ok };
        }
        const p = arr.profile();
        arr.setProfile({ ...p, modules: [...(p.modules || []).filter((m) => m.id !== oldId), { ...def }] });
        return applyPlacedHere(nextLayout);
      },
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      // 2026-10-02 -- EDIT ANY MODULE IN PLACE (edit_mode.js): edit panel `id` (on true), stop (false) or
      // toggle; which one is being edited ({ id, target } | null); choose a thing in it (null: the panel).
      editPanel: (id, on) => (arr ? arr.editPanel(id, on) : false),
      editingPanel: () => (arr ? arr.editing() : null),
      editSelect: (targetId = null) => (arr ? arr.editSelect(targetId) : null),
      // THIS DASHBOARD'S ARRANGEMENT (arrangement.js), read-only by convention. Read by the kiosk
      // shell (its plain bar, its menu, recovery's hands) and by the placed transport bar, so both
      // bars draw from the same functions rather than a reshaped copy. Null until `init` built it.
      arrangement: () => arr,
      // ---- chrome (Stage 3b; see above) ----
      chrome: () => chromeStatus(),
      removeChrome,
      // 2026-10-02: where the placed bar is ('cabinet' | 'dock' | null), and whether this dashboard has a
      // room object that can hold it (the menu offers the row only then).
      barPlace,
      canHoldBar: () => !!(arr && cabinetSlot(arr.roomSlots?.())),
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

        // ---- Row 2.38: NESTED -- which dashboard, and live or a card ----
        if (nested) {
          root.classList.add('v-nested');
          root.dataset.nestDepth = String(depth);
          viewId = showsOf(ctx.state?.get?.());
          startPulse();
          // *** WHAT IT SHOWS IS LIVE (the map editor's Shows: <dashboard>). *** Its own row changing --
          // the edit window, another device, a script -- empties this frame and fills it again with the
          // new dashboard. Only THIS panel: the screen around it, and the panel's box, stay as they are.
          //   FOR this over a remount of the panel by its host: the host need not know what a frame is,
          //   and a change from another device arrives the same way as one made here. AGAINST: a few lines
          //   here that a remount would not need. (A remount reads the row from the server again, and
          //   the change just written may not have reached it yet: the frame would show the OLD one.)
          const off = ctx.state?.subscribe?.((s) => {
            const n = showsOf(s);
            if (!torn && n !== viewId) reshow(n).catch((err) => console.error('view: shows', err));
          });
          if (typeof off === 'function') offs.push(off);
        }
        const first = fill();
        chain = first.catch(() => {});
        await first;
      },

      onResize() {},
      onHide() {},

      destroy() {
        torn = true;
        clearInterval(pulseT); pulseT = null;          // row 2.38
        try { editor?.close(); } catch { /* already gone */ }
        editor = null;
        offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
        fillOffs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
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

    // ---- FILLING IT: everything `init` did after drawing its four hosts (row 2.38 split it out, so a
    // nested dashboard told to show something else can EMPTY itself and fill again). `gen` is which fill
    // is current: one superseded mid-way (two quick changes) stops at its next await and leaves no trace.
    let gen = 0;
    const showsOf = (s) => { const v = s && s.shows; return typeof v === 'string' && v.trim() ? v.trim() : null; };
    async function fill() {
      const g = gen;
      const stale = () => torn || g !== gen;
      if (nested) {
          if (!viewId) { root.dataset.nest = 'empty'; drawCard(null, 'Nothing is chosen to show here yet.'); return; }
          if (nestMode(depth, liveLimit()) === 'card') {
            root.dataset.nest = 'card';
            let rec = null;
            try { rec = profiles ? await profiles.get(viewId) : null; } catch { rec = null; }
            if (stale()) return;
            drawCard(rec);
            addOpener(rec?.name);
            return;
          }
          root.dataset.nest = 'live';
          nestMode_ = 'live';
        }

        try {
          arrangement = (!nested && ctx.arrangement) || (profiles ? await profiles.get(viewId) : null);
        } catch (err) {
          console.error('view: could not load', viewId, err);
          arrangement = null;
        }
        if (stale()) return;
        if (!arrangement || !Array.isArray(arrangement.modules)) {
          // *** A VIEW THAT CANNOT LOAD SAYS SO RATHER THAN RENDERING NOTHING. *** A blank
          // region on a screen somebody is sitting at is indistinguishable from a crash.
          stageEl.innerHTML = '<p class="view-empty">This view could not be loaded.</p>';
          // (Nested: still pressable -- going in is the screen's own load-then-swap, which says what it can.)
          if (nested) addOpener(null);
          return;
        }
        // A nested one that is live: pressing it (anywhere) is going in.
        if (nested) addOpener(arrangement.name);

        // Its OWN settings — theme and chrome travel with the arrangement. KEPT, so `destroy()`
        // can close it: this handle used to be opened, set polling, and never closed.
        // STAGE 4: a host that already holds THIS dashboard's settings doc open (the kiosk, for the
        // screen it booted on) lends it (`ctx.settingsHandle`), so one doc is not polled twice. A lent
        // handle is used, never loaded again and never closed here: it is the host's.
        settingsHandle = borrowedSettings || childState('settings');
        if (!borrowedSettings) await settingsHandle?.load?.().catch(() => {});
        if (stale()) {
          if (!borrowedSettings) { try { settingsHandle?.destroy?.(); } catch { /* gone */ } }
          settingsHandle = null; return;
        }
        const settings = {
          get: () => settingsHandle?.get?.() || {},
          set: (p) => settingsHandle?.set?.(p),
        };

        arr = createArrangement({
          bus: rootBus, user, storage: hostStorage, embedded: hostEmbedded, settings,
          kioskEl: root, stageEl, mirrorEl, clockEl, ambientEl,
          mountInstance: mountChild, destroyRec, watchRec, renderMods: changed,
          runtime: () => ({ router }),
          health: () => hostHealth || { forget() {} },
          profileId: () => viewId,
          // The host screen's flash limit (flash_limit.js), for this dashboard's room, read live.
          flashLimit: () => flashLimit(ctx),
          // 2026-10-02: the "make it bigger" corner on each panel -- not on a NESTED one's panels: its
          // opener covers them, and going in is how they are reached (arrangement.js says why).
          corners: !nested,
          // 2026-10-02, edit mode on this dashboard's room (arrangement.js ROOM_PANEL_ID): a door or a Room
          // row it changes is saved exactly where the edit view saves (see `openEdit`'s `save`), and the host
          // is told first (`ctx.expectLayout`) so a room this dashboard redraws itself is not reloaded.
          layoutStore: {
            get: () => rawLayout || null,
            save: (next) => {
              rawLayout = next;
              if ((overridden && ctx.saveLayout !== true) || !settingsHandle?.set) return;
              try {
                ctx.expectLayout?.(next);
                const cur = settingsHandle.get?.()?.kiosk || {};
                settingsHandle.set({ kiosk: { ...cur, layout: next } });
              } catch (err) { console.error('view: saving the room', err); }
            },
          },
          listDashboards: typeof profiles?.list === 'function' ? () => profiles.list() : null,
        });

        arr.applyLayout(settings.get());
        if (settingsHandle?.subscribe) {
          const off = settingsHandle.subscribe((s) => {
            if (torn) return;
            arr.applyLayout(s || {});
            placeChromeBar();                 // 2026-10-02: the bar on the room's cabinet, or not
            // STAGE 4: whoever shows this dashboard's own settings (its theme, R3) hears they changed.
            for (const fn of settingsListeners) { try { fn(s || {}); } catch (err) { console.error('view: onSettings', err); } }
          });
          if (typeof off === 'function') fillOffs.push(off);
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
        if (stale()) return;
        // STAGE 4: `ctx.startIndex` -- where a cold boot lands on a one-at-a-time stage (the kiosk's
        // restart record), clamped; mounting index 0 first and then moving would start a module for nothing.
        const start = Number.isInteger(hostStartIndex) && hostStartIndex > 0 && hostStartIndex < arr.stageDefs().length
          ? hostStartIndex : 0;
        if (arr.layout()) await arr.mountLayout(); else await arr.showPrimary(start);
        if (stale()) return;
        // Links, once the modules exist -- and again whenever the settings change, exactly as the
        // kiosk does. The runner exists only while there are links, so a view with none costs nothing.
        if (arr.screenLinks) {
          arr.screenLinks.sync();
          const off = settingsHandle?.subscribe?.(() => { if (!torn) arr?.screenLinks?.sync(); });
          if (typeof off === 'function') fillOffs.push(off);
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
          if (typeof off === 'function') fillOffs.push(off);
        }
        // The placed chrome, once there are panels for a bar to name. Started, not awaited: see
        // CHROME above. Every role it will carry is 'pending' from this moment.
        const placed = Array.isArray(hostChrome) ? hostChrome.filter((d) => d && d.id && d.type) : [];
        for (const def of placed) mountChrome(def).catch((err) => console.error('view: chrome', err));
        // 2026-10-02: a dashboard that OPENS with one of its panels being edited (its settings doc's
        // `editPanel`, an instance id: the builder's top left). Not a nested one (it is pressed as one thing).
        if (!nested) {
          const ep = editSettingsFrom(settings.get()).panel;
          if (ep) { try { arr.editPanel(ep, true); } catch (err) { console.error('view: edit panel', err); } }
        }
        changed();
        rootBus.publish('view/ready', { viewId, modules: arrangement.modules.length });
    }

    // Row 2.38: EMPTY a nested dashboard so it can be filled with another one -- everything `fill` made,
    // undone, and the four hosts left in place (the panel's box, its pulse and its row watch stay).
    function empty() {
      gen++;
      try { editor?.close(); } catch { /* already gone */ }
      editor = null;
      fillOffs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
      for (const id of [...chromeRecs.keys()]) removeChrome(id);
      try { arr?.destroy(); } catch { /* already gone */ }
      if (!borrowedSettings) { try { settingsHandle?.destroy?.(); } catch { /* already gone */ } }
      settingsHandle = null; arr = null; arrangement = null; rawLayout = null; lastStage = null;
      try { opener?.remove(); } catch { /* gone */ }
      opener = null;
      for (const el of [stageEl, mirrorEl, clockEl, ambientEl]) el?.replaceChildren();
      if (stageEl) { stageEl.className = 'k-stage'; stageEl.removeAttribute('style'); }
      if (mirrorEl) mirrorEl.hidden = true;
      if (clockEl) clockEl.hidden = true;
      if (ambientEl) ambientEl.hidden = true;
      if (root) delete root.dataset.nest;
      nestMode_ = nested ? null : 'screen';
    }
    // One refill at a time, in order, and only for the LATEST choice: two quick changes do one refill each
    // at most, never two fills at once over the same hosts.
    let chain = Promise.resolve();
    let wantShows = null;
    function reshow(n) {
      wantShows = n;
      chain = chain.then(async () => {
        if (torn || wantShows === viewId) return;
        viewId = wantShows;
        empty();
        await fill();
        if (torn) return;
        changed();
        pulse();
      }).catch((err) => console.error('view: refill', err));
      return chain;
    }
    return self;
}

registerModule(DASHBOARD_MANIFEST, dashboardFactory);
for (const alias of DASHBOARD_ALIASES) {
  registerModule({ ...DASHBOARD_MANIFEST, type: alias, aliasOf: DASHBOARD_TYPE,
    title: 'Dashboard (old name: view)' }, dashboardFactory);
}
