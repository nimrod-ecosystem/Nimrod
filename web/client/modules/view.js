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

import { registerModule, mountModule } from '../module.js';
import { normalizeLayout, isArranged, gridStyle, slotStyle } from '../layout.js';

const MIRROR_SIZES = ['sm', 'md', 'lg'];
const CORNERS = ['tr', 'br', 'bl', 'tl'];
// The same defaults the kiosk has always used, so a view mounted from an existing
// arrangement looks exactly as it did before it became a module.
export const VIEW_DEFAULTS = { mirror: { size: 'lg', corner: 'tr' }, clock: { corner: 'bl' } };

// A module type that is pulled OUT of the flow into its own overlay. Kept as data rather than
// an `if`, because the next one (a call's picture-in-picture) is the same shape.
export const OVERLAY_TYPES = { camera: 'mirror', clock: 'clock' };

/** Which modules go where, given an arrangement and its layout. PURE, and exported because
 *  it is the one place that decides — two code paths deciding where a camera goes is how a
 *  swapped scene ends up subtly different from the same scene opened directly. */
export function partition(modules = [], layout = null) {
  const placed = new Set(layout ? layout.slots.filter(Boolean) : []);
  const out = { slots: layout ? layout.slots.slice() : [], stage: [], overlays: {} };
  for (const mod of modules) {
    if (placed.has(mod.id)) continue;                       // it lives in a slot
    const overlay = OVERLAY_TYPES[mod.type];
    if (overlay) out.overlays[overlay] = mod;
    else if (!layout) out.stage.push(mod);                  // no layout: the one-at-a-time stage
  }
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
    const viewId = ctx.viewId || ctx.viewId || ctx.profileId;
    const { mount, user } = ctx;
    const rootBus = ctx.rootBus || ctx.bus;      // children mount here; mountModule re-scopes
    const profiles = ctx.profiles || null;
    const makeState = ctx.makeState || null;
    const makeEvents = ctx.makeEvents || null;

    let root = null, stageEl = null, mirrorEl = null, clockEl = null;
    let arrangement = null, layout = null, parts = null;
    let primary = 0;
    let stageRec = null;
    const slotRecs = [];
    const overlayRecs = {};

    // Per-CHILD handles, keyed to this view's arrangement rather than to whatever the
    // surface was mounted with. A view shown somewhere else must still find its own data.
    const childState = (id) => (makeState ? makeState(id, {}, viewId) : null);
    const childEvents = (id) => (makeEvents ? makeEvents(id, {}, viewId) : null);

    function destroyRec(rec) {
      if (!rec) return;
      try { rec.instance.destroy(); } catch { /* noop */ }
      try { rec.state?.destroy?.(); } catch { /* noop */ }
      try { rec.events?.destroy?.(); } catch { /* noop */ }
    }

    async function mountChild(def, host) {
      const state = childState(def.id);
      const events = childEvents(def.id);
      const instance = mountModule(def.type, {
        ...ctx, mount: host, bus: rootBus, state, events,
        profileId: viewId, instanceId: def.id,
      });
      await state?.load?.().catch(() => {});
      await events?.load?.().catch(() => {});
      instance.init();
      state?.startPolling?.();
      events?.startPolling?.();
      return { instance, state, events, def };
    }

    async function showStage(i) {
      if (!parts.stage.length) return;
      primary = ((i % parts.stage.length) + parts.stage.length) % parts.stage.length;
      destroyRec(stageRec); stageRec = null;
      stageEl.innerHTML = '';
      const host = document.createElement('div');
      host.className = 'k-mod';
      stageEl.append(host);
      stageRec = await mountChild(parts.stage[primary], host);
      rootBus.publish('view/stage', { viewId, moduleId: parts.stage[primary].id, index: primary });
    }

    async function build() {
      // A GRID, if this arrangement has one; otherwise the one-at-a-time stage. Both shapes
      // already existed on the kiosk; a view is where they now live.
      if (layout) {
        stageEl.className = 'k-stage k-grid';
        stageEl.setAttribute('style', gridStyle(layout.preset));
        for (let i = 0; i < layout.slots.length; i++) {
          const cell = document.createElement('div');
          cell.className = 'k-cell mod-box';
          cell.setAttribute('style', slotStyle(layout.preset, i));
          stageEl.append(cell);
          const id = layout.slots[i];
          if (!id) continue;                                 // an empty slot is allowed
          const def = arrangement.modules.find((m) => m.id === id);
          if (!def) continue;
          const host = document.createElement('div');
          host.className = 'k-mod';
          cell.append(host);
          slotRecs.push(await mountChild(def, host));
        }
      } else {
        await showStage(0);
      }

      for (const [slot, def] of Object.entries(parts.overlays)) {
        const el = slot === 'mirror' ? mirrorEl : clockEl;
        const host = document.createElement('div');
        host.className = 'k-mod';
        el.append(host);
        el.hidden = false;
        overlayRecs[slot] = await mountChild(def, host);
      }
    }

    function applyChrome(settings = {}) {
      // *** THE SCENE'S OWN CHROME, WHICH IS THE POINT. *** Where the picture-in-picture sits
      // belongs to the arrangement, not to whatever was mounted before it. This is the gap the
      // in-place swap had, closed by construction.
      const k = settings.kiosk || {};
      const m = { ...VIEW_DEFAULTS.mirror, ...(k.mirror || {}) };
      const c = { ...VIEW_DEFAULTS.clock, ...(k.clock || {}) };
      root.dataset.mirrorSize = MIRROR_SIZES.includes(m.size) ? m.size : VIEW_DEFAULTS.mirror.size;
      root.dataset.mirrorCorner = CORNERS.includes(m.corner) ? m.corner : VIEW_DEFAULTS.mirror.corner;
      root.dataset.clockCorner = CORNERS.includes(c.corner) ? c.corner : VIEW_DEFAULTS.clock.corner;
    }

    return {
      __probe: () => ({
        viewId, ready: !!arrangement, hasLayout: !!layout, primary,
        stage: parts ? parts.stage.map((d) => d.type) : [],
        slots: slotRecs.map((r) => r.def.type),
        overlays: Object.keys(overlayRecs),
        chrome: root ? { ...root.dataset } : null,
      }),
      __showStage: (i) => showStage(i),

      async init() {
        root = document.createElement('div');
        root.className = 'view';
        stageEl = document.createElement('div'); stageEl.className = 'k-stage';
        mirrorEl = document.createElement('div'); mirrorEl.className = 'k-mirror'; mirrorEl.hidden = true;
        clockEl = document.createElement('div'); clockEl.className = 'k-clock'; clockEl.hidden = true;
        root.append(stageEl, mirrorEl, clockEl);
        mount.append(root);

        try {
          arrangement = ctx.arrangement || (profiles ? await profiles.get(viewId) : null);
        } catch (err) {
          console.error('view: could not load', viewId, err);
          arrangement = null;
        }
        if (!arrangement || !Array.isArray(arrangement.modules)) {
          // *** A SCENE THAT CANNOT LOAD SAYS SO RATHER THAN RENDERING NOTHING. *** A blank
          // region on a screen somebody is sitting at is indistinguishable from a crash.
          stageEl.innerHTML = '<p class="view-empty">This view could not be loaded.</p>';
          return;
        }

        // Its OWN settings — theme and chrome travel with the arrangement.
        const settingsHandle = childState('settings');
        await settingsHandle?.load?.().catch(() => {});
        const settings = settingsHandle?.get?.() || {};
        applyChrome(settings);
        if (settingsHandle?.subscribe) {
          settingsHandle.subscribe((s) => applyChrome(s || {}));
          settingsHandle.startPolling?.();
        }

        const saved = (settings.kiosk || {}).layout;
        layout = isArranged(saved)
          ? normalizeLayout(saved, arrangement.modules.map((m) => m.id))
          : null;
        parts = partition(arrangement.modules, layout);
        await build();
        rootBus.publish('view/ready', { viewId, modules: arrangement.modules.length });
      },

      onResize() {},
      onHide() {},

      destroy() {
        destroyRec(stageRec); stageRec = null;
        while (slotRecs.length) destroyRec(slotRecs.pop());
        for (const k of Object.keys(overlayRecs)) { destroyRec(overlayRecs[k]); delete overlayRecs[k]; }
        root?.remove(); root = null;
        stageEl = mirrorEl = clockEl = null;
        arrangement = null; layout = null; parts = null;
      },
    };
  },
);
