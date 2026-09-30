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
// position), `ctx.embedded` (true: no links runner -- a preview is not a screen).

import { registerModule, mountModule } from '../module.js';
import { createArrangement } from '../arrangement.js';

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
      const state = childState(def.id);
      const events = childEvents(def.id);
      const instance = mountModule(def.type, {
        ...ctx, ...childMakes, mount: host, bus: rootBus, state, events,
        profileId: viewId, instanceId: def.id,
      });
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

    return {
      __probe: () => ({
        viewId, ready: !!arrangement, hasLayout: !!arr?.layout(), primary: arr ? arr.primary() : 0,
        stage: arr ? arr.stageDefs().map((d) => d.type) : [],
        slots: arr ? arr.slotRecs.map((r) => r.type) : [],
        overlays: arr ? [['mirror', arr.cameraRec()], ['clock', arr.clockRec()], ['ambient', arr.ambientRec()]]
          .filter(([, r]) => r).map(([k]) => k) : [],
        chrome: root ? { ...root.dataset } : null,
      }),
      __showStage: (i) => arr?.showPrimary(i),

      // ---- the container contract -------------------------------------------------------
      container: true,
      panels: () => (!arr ? [] : arr.layout() ? arr.slotRecs.map(brief) : [arr.stageRec()].filter(Boolean).map(brief)),
      focusRing: () => (arr ? arr.focusRing() : []),
      focused: () => (arr ? brief(arr.focusedRec()) : null),
      modules: () => (arrangement ? arrangement.modules.map((m) => ({ ...m })) : []),
      async focus(id) {
        if (!arr || !id) return false;
        if (arr.layout()) {
          if (!arr.slotRecs.some((r) => r.id === id)) return false;
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
        settingsHandle = childState('settings');
        await settingsHandle?.load?.().catch(() => {});
        if (torn) { try { settingsHandle?.destroy?.(); } catch { /* gone */ } settingsHandle = null; return; }
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
        });

        arr.applyLayout(settings.get());
        if (settingsHandle?.subscribe) {
          const off = settingsHandle.subscribe((s) => { if (!torn) arr.applyLayout(s || {}); });
          if (typeof off === 'function') offs.push(off);
          settingsHandle.startPolling?.();
        }

        arr.setProfile(arrangement);
        // *** THE SAME RESOLVE THE KIOSK USES, AND THIS IS THE POINT OF SHARING IT. *** (It was a
        // second copy here once, and carried G1-G3 for a week after the kiosk's was fixed.) Now it
        // is not even a shared function call: it is the arrangement's own.
        arr.resolve((settings.get().kiosk || {}).layout);
        arr.partition();
        await arr.mountOverlays();
        if (torn) return;
        if (arr.layout()) await arr.mountLayout(); else await arr.showPrimary(0);
        if (torn) return;
        // Links, once the modules exist -- and again whenever the settings change, exactly as the
        // kiosk does. The runner exists only while there are links, so a view with none costs nothing.
        if (arr.screenLinks) {
          arr.screenLinks.sync();
          const off = settingsHandle?.subscribe?.(() => { if (!torn) arr.screenLinks.sync(); });
          if (typeof off === 'function') offs.push(off);
        }
        changed();
        rootBus.publish('view/ready', { viewId, modules: arrangement.modules.length });
      },

      onResize() {},
      onHide() {},

      destroy() {
        torn = true;
        offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
        listeners.clear();
        try { arr?.destroy(); } catch { /* already gone */ }
        // THE LEAK (step 6 plan): opened, set polling, and never closed. Closed here, last, after
        // everything that might read it.
        try { settingsHandle?.destroy?.(); } catch { /* already gone */ }
        settingsHandle = null;
        root?.remove(); root = null;
        stageEl = mirrorEl = clockEl = ambientEl = null;
        arrangement = null; arr = null;
      },
    };
  },
);
