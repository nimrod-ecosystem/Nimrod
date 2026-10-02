// arrangement.js -- WHAT IS ON THIS SCREEN, AND WHERE. Step 6 of the port, Stage 1 (2026-09-30).
//
// The arrangement-owner half of the kiosk, moved out of kiosk.js as a plain factory: resolving the
// saved layout against the modules that exist (and repairing orphans), partitioning the modules into
// slots / the one-at-a-time stage / the HUD overlays / the ambient layer, mounting all of it (the
// failed-slot notices and the empty-screen sentences included), which panel the bar and the ring are
// about (focus, and the unplaced swap), the rebuild a screen swap runs, `showModule`, recovery's hands
// (`recFor` / `remountPanel` / `swapPanel`), the mirror/clock corners, and the screen's links.
//
// *** A PURE MOVE. *** Every function below was cut from kiosk.js and pasted here unchanged, comments
// included, apart from three things handed in as getters -- `runtime()`, `health()`, `profileId()`,
// each built or changed by the shell after this factory exists -- and the three boot-time overlay
// mounts becoming `mountOverlays()`. Proven by a moved-code diff, the calculator port's method. So the
// long comments below still say "this file" and "the kiosk" where they meant kiosk.js: they are the
// history of THIS code, and rewriting them in the same commit would make the move unprovable.
//
// NOT A MODULE YET. Stage 2 puts `modules/view.js` over this, Stage 3 lets the shell mount it as a
// module on the modules page, Stage 4 flips the real kiosk. Until then kiosk.js is the only caller,
// and the kiosk's public handle is unchanged.
//
// WHAT STAYS IN THE SHELL (kiosk.js): sign-in and push, the one-per-screen arbiters (audio, camera,
// mic, output, the drive socket, the call transport), the input runtime and cursor, the health watch
// and the recovery LADDER (it calls the hands here), burn-in, the bar's auto-hide, fullscreen, the
// caregiver hotkeys, the transport bar and the settings menu (they READ this arrangement), and the
// screen stack (`kiosk/show`, `kiosk/back`).
//
// *** THE STATE, AND THE ROOM LEFT IN IT FOR SCENE PLACEMENT. *** Two values are this arrangement's
// own: `profile` (the screen record; its `.modules` are what can be shown) and `layout` (whatever
// `resolveLayout` returned: null, or `{ preset, slots }`). Everything else here is derived from those
// two, or is a mounted record. Callers read ALL of it through functions (`arr.layout()`,
// `arr.stageRec()`, ...), never a captured value, because a swap replaces it. That is the room:
// Mike's 2026-09-30 ruling brings free placement back, so a second placement kind -- a module placed
// IN THE SCENE (x/y, rotation, layer, wall: Design's room recipe, `kind: "module"` items) beside the
// snapped slots -- arrives as one more field on `layout` (`layout.placed`), one more record list beside
// `slotRecs`, and one more place that `partition()`'s placed ids, `recFor()` and `focusRing()` look.
// No caller's shape changes for it. (What it needed OUTSIDE this file -- layout.js dropped unknown
// keys, the composer's save did too, the 09-12 reload watch would reload the screen on every drag --
// is listed in the step 6 plan's 2026-09-30 revision.)
//
// *** STAGE R (2026-09-30): BUILT. *** `layout.placed` (layout.js says what an entry is) is mounted by
// `mountPlaced()` into three layers this file adds to the dashboard, each on the one depth scale
// (layers.css): the SCENE (behind the grid -- the room, when the dashboard's `layout.scene` is one, and
// a module in one of its slots or freely on its walls), the SCREEN (flat, above the grid) and the
// OVERLAY (above everything but the bar and the menus). `placedRecs` sits beside `slotRecs`;
// `partition()`, `unplacedDefs()`, `focusRing()`, `focusedRec()`, `paintFocus()`, `recFor()`,
// `showModule()`, recovery's hands, `applyModules()` and `destroy()` all look there too, and every
// placed record is `watchRec`-ed like a slot. A placement change is applied IN PLACE by
// `applyPlaced()`: the moved module is re-styled (or re-parented onto another layer) -- the same
// instance, nothing remounted -- which is what lets the 09-12 watch leave placement-only changes alone
// (`layoutChange` in layout.js). A layout with nothing placed creates none of it: no layer, no import
// of the room renderer (it is loaded only when a layout names a room), no change to any ring.

import {
  normalizeLayout, isArranged, resolveLayout, gridStyle, slotStyle, placedGeometry, layoutChange, normalizePlacedEntry,
} from './layout.js';

// Re-exported so the shell (kiosk.js already imports this file) can classify a change without a new
// import line.
export { layoutChange };
import { getManifest } from './module.js';
import { writePosition } from './restart.js';
import { createScreenLinks } from './screen_links.js';
import { DASHBOARD_GO_TOPIC, OPENS_TYPE, OPENS_PRESS_TOPIC } from './dashboard_nest.js';
// Row 2.38, the map editor: a change that only moves a room object's door is applied in place too
// (room_doors.js argues where a door is saved and why that is not a rebuild).
import { classifyLayoutChange, sceneDoorChanges, sceneDoors, withDoor, tidyScene } from './room_doors.js';
export { classifyLayoutChange };
import { SHELL_PROMOTE } from './shell_verbs.js';
// 2026-10-02: EDIT ANY MODULE IN PLACE (edit_mode.js argues it). This file owns which panel is being edited
// on this dashboard, the ✎ corner beside ⤢, and the `shell/edit-panel` verb.
import { createEditMode, EDIT_PANEL_TOPIC, editSettingsFrom, ensureEditCss } from './edit_mode.js';
import { moveKeeping } from './dom_move.js';

// =====================================================================================================
// *** MAKE A PANEL BIGGER, ONE LEVEL AT A TIME (2026-10-02). *** Mike: "something that pops up in the
// bottom right corner of each module to make that module full screen in the dashboard and then fullscreen
// on the screen. I guess that would just keep going all the way up and down with nested things. You're
// pretty much just promoting it to one level higher."
//
// THIS FILE OWNS ONE LEVEL: a panel FILLS ITS DASHBOARD (`promote(id)`) -- a slot's cell takes the whole
// grid, a module placed flat on the screen takes the whole dashboard, and every other panel is hidden
// (visibility, never unmounted: they keep playing, as a hidden panel does by default, and come back exactly
// as they were). Pressed again it answers `{ level: 'top' }` and the SHELL takes the next level up (kiosk.js:
// the screen). A nested dashboard (a TV) is one panel of the dashboard it sits in, so it promotes the same
// way, one level at a time; its own panels are reached by going IN (its opener covers them), where they are
// this file's panels again. `demote()` is one level down.
//
// NOT HERE: a module drawn INSIDE A ROOM (in a room's slot, or on one of its walls) has the room's own
// perspective around it; lifting it out to fill the dashboard is the room's close-up's job (room_objects),
// so it gets no corner and promoting it answers `{ level: 'top' }` (the shell's level: the screen).
//
// THE CORNER BUTTON: on every panel this file draws (`corners`, on by default; a nested dashboard passes
// false -- its opener is over it), bottom right, shown on hover or keyboard focus and while promoted. It
// SAYS what was pressed (SHELL_PROMOTE { id }) and the shell decides, so the corner, the menu row, a switch
// and "make it bigger" are one press. 44px: the WCAG 2.5.5 touch-target size, the same floor every other
// control here keeps -- a fixed number on purpose, not a preference (a smaller corner is a missed press).
// =====================================================================================================
const PROMOTE_CSS_ID = 'k-promote-css';
const PROMOTE_PX = 44;
function ensurePromoteCss() {
  if (typeof document === 'undefined' || document.getElementById(PROMOTE_CSS_ID)) return;
  const s = document.createElement('style');
  s.id = PROMOTE_CSS_ID;
  s.textContent = `
.k-promote{position:absolute;right:6px;bottom:6px;z-index:calc(var(--z-panel-contents,300) + 20);
  width:${PROMOTE_PX}px;height:${PROMOTE_PX}px;margin:0;padding:0;border-radius:10px;cursor:pointer;
  border:1px solid rgba(255,255,255,.4);background:rgba(10,20,15,.6);color:#fff;
  font:600 22px/1 system-ui,-apple-system,Segoe UI,sans-serif;opacity:0;transition:opacity .15s}
.k-cell:hover>.k-promote,.k-cell:focus-within>.k-promote,.k-pcell:hover>.k-promote,.k-pcell:focus-within>.k-promote,
.k-stage:hover>.k-promote,.k-stage:focus-within>.k-promote,.k-promote:focus-visible,[data-promoted]>.k-promote{opacity:1}
@media (prefers-reduced-motion: reduce){.k-promote{transition:none}}
[data-promoted-panel]>.k-stage>.k-cell:not([data-promoted]),
[data-promoted-panel]>.k-placed>.k-pcell:not([data-promoted]){visibility:hidden}
[data-promoted-panel]>.k-stage>.k-cell[data-promoted]{grid-area:1/1/-1/-1!important;z-index:5}
[data-promoted-panel]>.k-placed>.k-pcell[data-promoted]{inset:0!important;left:0!important;top:0!important;
  width:100%!important;height:100%!important;transform:none!important;display:flex!important;z-index:99!important}
.kiosk[data-promoted="screen"] .k-mirror,.kiosk[data-promoted="screen"] .k-clock{visibility:hidden}`;
  document.head.append(s);
}

// Where a dashboard remembers its panels switched to another module (`switchPanel`): { id: type }.
export const PANEL_SWITCHES_KEY = 'panelSwitches';
// The dashboard's ROOM, as one more thing edit mode can edit beside its panels (see "THE DASHBOARD'S ROOM,
// EDITED IN PLACE" below). A fixed name, not a module instance's id.
export const ROOM_PANEL_ID = 'scene:room';
// THE ROOM'S PIECES IN THE SWITCH LAP (2026-10-02; "THE ROOM'S PIECES" below). Each pressable piece is a ring
// stop `scene:room/<key>` of this type; actions.js MODULE_VERBS routes its `select` to this topic on that stop.
export const ROOM_PIECE_TYPE = 'room-piece';
export const ROOM_PIECE_PRESS_TOPIC = 'room-piece/press';
export const ROOM_PIECE_PREFIX = `${ROOM_PANEL_ID}/`;
// A PANEL THAT FLOATS ON REQUEST (Mike's list 09-30, Scoreboard item 5; "A PANEL ASKS TO FLOAT" below).
// `shell/place { id, place?: 'overlay' | 'slot', x?, y?, w?, h?, scan?, claim?, reply? }`: a panel asks this
// dashboard to float it over the others, put it back, or put it in / take it out of the switch lap.
// `panel/placed#<id> { id, place, scan }`: what this dashboard tells a panel about where it now is.
export const PLACE_REQUEST_TOPIC = 'shell/place';
export const PLACED_TOPIC = 'panel/placed';

// =================================================================================================
// *** A MOVE THAT KEEPS WHAT IS PLAYING (2026-10-02; Mike's list 09-30, ~row 1325: "Changing a Room row
// reloads a video sitting in the room"). *** `moveKeeping` (dom_move.js, re-exported here): every place this
// file moves a module that is already in the page uses it, so an embedded video carries on.
// Argued against the other way, keeping the module boxes where they are and swapping only the room beneath:
//   FOR it: works in every browser, no fallback.
//   AGAINST it: a module in a room is drawn BY the room -- inside its slot, at its stage's scale, under a 3D
//   wall's transform -- so its box has to be inside the room's own elements. Outside them, every room's
//   projection would have to be redone by hand beside it, and a 3D wall's transform cannot be borrowed by an
//   element that is not inside that wall at all. The only way to "swap the room beneath" is for each renderer to
//   keep its slots, stage and walls as the SAME elements across a redraw -- a promise every later change to
//   room_scene.js and room3d.js would have to keep, for a shape change that adds and removes slots.
// =================================================================================================
export { moveKeeping };

const MIRROR_SIZES = ['sm', 'md', 'lg'];
const CORNERS = ['tr', 'br', 'bl', 'tl'];
const KDEF = { mirror: { size: 'lg', corner: 'tr' }, clock: { corner: 'bl' } };
const wrap = (i, n) => ((i % n) + n) % n;

export function createArrangement({
  bus, user, storage, embedded = false, settings,
  // The DOM the shell drew. The arrangement fills these; it never creates or removes them.
  kioskEl, stageEl, mirrorEl, clockEl, ambientEl,
  // The shell's hands: how a module instance is mounted, torn down and watched (they hold the
  // per-instance state handles and the health watch, which stay in the shell), and how the bar is
  // redrawn once the arrangement has changed what it lists.
  mountInstance, destroyRec, watchRec = (rec) => rec, renderMods: renderModsHost = () => {},
  // GETTERS, NOT VALUES. Each is built or changed by the shell AFTER this factory exists -- the input
  // runtime, the health watch, the screen id a swap changes -- so a value captured here would be null
  // (or the boot screen's) forever. The same reason kiosk.js's `childCtx` hands modules getters.
  runtime = () => null, health = () => null, profileId = () => null,
  // The screen's flash limit (flash_limit.js), a getter, for the dashboard's room. Absent: the room uses flash_limit.js's
  // default (no limit, since 8a89e31).
  flashLimit = undefined,
  // The corner "make it bigger" button on each panel (the header above PROMOTE_CSS_ID). A nested
  // dashboard passes false: its opener covers its panels, and going in is how they are reached.
  corners = true,
  // EDIT MODE ON THE DASHBOARD'S ROOM (2026-10-02; see ROOM_PANEL_ID below). Both optional.
  //   layoutStore  { get() -> the layout as SAVED, save(next) }: where a changed door or Room row is written.
  //                Absent: the change is applied on the screen and kept in memory only (a preview page).
  //   listDashboards() -> Promise<[{ id, name }]>: the choices for what a room object opens.
  layoutStore = null,
  listDashboards = null,
} = {}) {
  // THE ARRANGEMENT'S OWN STATE (see the header). Set by `setProfile` and `resolve`, read by every
  // caller through `arr.profile()` / `arr.layout()`.
  let profile = null;
  let layout = null;
  // Every redraw of the bar is also when a panel's corner may need drawing (a remount, a swap, a switch
  // replaces what is in a cell): one place, so no path that changes a cell can leave one without it.
  function renderMods() {
    try { ensureCorners(); } catch (err) { console.error('arrangement: corners', err); }
    // A panel being edited that was remounted, swapped or taken off: edit mode follows it, or ends.
    try { editMode?.refresh(); } catch (err) { console.error('arrangement: edit mode', err); }
    renderModsHost();
  }

  // ---- the mirror/clock corners: what kiosk.js's header calls the kiosk LAYOUT, in `settings.kiosk`
  function applyLayout(s) {
    const k = (s && s.kiosk) || {};
    const m = { ...KDEF.mirror, ...(k.mirror || {}) };
    const c = { ...KDEF.clock, ...(k.clock || {}) };
    kioskEl.dataset.mirrorSize = MIRROR_SIZES.includes(m.size) ? m.size : KDEF.mirror.size;
    kioskEl.dataset.mirrorCorner = CORNERS.includes(m.corner) ? m.corner : KDEF.mirror.corner;
    kioskEl.dataset.clockCorner = CORNERS.includes(c.corner) ? c.corner : KDEF.clock.corner;
  }

  // persist a mirror change into the profile settings (merges with theme/voice/clock)
  function patchMirror(patch) {
    const cur = settings.get().kiosk || {};
    settings.set({ kiosk: { ...cur, mirror: { ...KDEF.mirror, ...(cur.mirror || {}), ...patch } } });
  }
  // live bedside tuning of the mirror -> persisted to the profile settings
  function cycleMirrorSize(dir) {
    const i = MIRROR_SIZES.indexOf(kioskEl.dataset.mirrorSize);
    const j = Math.max(0, Math.min(MIRROR_SIZES.length - 1, (i < 0 ? MIRROR_SIZES.length - 1 : i) + dir));
    patchMirror({ size: MIRROR_SIZES[j] });
  }
  function cycleMirrorCorner() {
    const i = CORNERS.indexOf(kioskEl.dataset.mirrorCorner);
    patchMirror({ corner: CORNERS[wrap((i < 0 ? 0 : i) + 1, CORNERS.length)] });
  }

  // *** THIS SCREEN'S LINKS (2026-09-28, port-order step 5). *** A link joins one module instance's
  // port to another's, and per the 2026-09-17 ruling (a dashboard is a module that contains modules)
  // it is the CONTAINING screen's own structure: an array `links` beside `layout` on this screen's
  // settings doc, `settings.kiosk.links`, written with real instance ids. `screen_links.js` reads it and
  // owns the runner; THE RUNNER EXISTS ONLY WHILE THAT ARRAY IS NON-EMPTY, so a screen with no links
  // creates nothing and behaves exactly as it always has. There is no patch-bay UI; links are authored
  // by data. NOT in an embed: an embed is a preview host on somebody else's page showing one panel, and
  // wiring a visitor's preview into a real screen's links is not what it is for. Composition
  // identity (does a link enter a screen's fingerprint?) is deliberately untouched: NEW_CORE_SPEC.md
  // §1/§2 still lists it as [design]. `settings` is read lazily, at each `sync()`, never here.
  const screenLinks = embedded ? null : createScreenLinks({
    rootBus: bus, settings: () => settings.get(), modules: () => profile.modules, manifestOf: getManifest,
  });

  // *** A SLOT WHOSE MODULE NO LONGER EXISTS IS AN ORPHAN, AND ORPHANS USED TO EAT PANELS. ***
  //
  // `normalizeLayout` nulls any slot holding an id that is not in the profile — correctly, it
  // cannot render a module that is gone. But two things downstream then conspired:
  //
  //   * `mountLayout` skips a null slot with a bare `continue`, silently; and
  //   * `partition()` only fills `stageDefs` when there is NO layout at all.
  //
  // So a module that exists but whose slot was orphaned renders NOWHERE. Not in its slot, and
  // not on the stage either, because the stage is switched off whenever a layout is present.
  // A screen composed of Photos, Comet and Clock came up with no Photos panel anywhere and no
  // error, and a screen whose ONLY module was Photos came up announcing "This screen's panels
  // were removed" — while the panel sat in the profile, un-removed and unrendered.
  //
  // `isArranged` is checked against the RAW saved layout, which is why an all-orphaned layout
  // still counted as arranged and switched the stage off on its way to rendering nothing.
  //
  // Two repairs, and both are repairs rather than preferences:
  // The resolve-and-repair lives in layout.js, because the kiosk resolves a layout twice (boot
  // and screen swap) and view.js renders them too — one copy, or they drift.
  // Called at boot and by a screen swap -- the same one line both used, so one copy.
  function resolve(savedLayout) {
    // Stage R: a PLACEMENT change that arrived before anything was mounted (the shell's boot gap,
    // between reading the saved layout and resolving it) is what gets resolved, so the screen comes up
    // with the move rather than without it. Only a placement change: a grid change is the shell's.
    if (lateLayout !== undefined) {
      if (layoutChange(savedLayout, lateLayout) === 'placement') savedLayout = lateLayout;
      lateLayout = undefined;
    }
    layout = resolveLayout(savedLayout, profile.modules);
  }
  let lateLayout;                           // see `applyPlaced`, before the first mount

  let stageDefs = [];
  let cameraDef = null, clockDef = null, ambientDef = null;

  // The partition, as a FUNCTION so a swapped-in screen goes through exactly the same rules
  // as one mounted at boot. Two code paths deciding where a camera goes is how a swapped
  // screen ends up subtly different from the same screen opened directly.
  function partition() {
    // Stage R: a module PLACED freely is placed, exactly as one in a slot is -- so a camera placed in
    // the scene is a panel, not the HUD mirror.
    const placedIds = new Set(layout
      ? [...layout.slots.filter(Boolean), ...(layout.placed || []).map((p) => p.id)] : []);
    stageDefs = [];
    cameraDef = null; clockDef = null; ambientDef = null;
    for (const mod of profile.modules) {
      if (placedIds.has(mod.id)) continue;                    // it lives in a slot
      if (mod.type === 'camera') cameraDef = mod;
      else if (mod.type === 'clock') clockDef = mod;
      // A HEADLESS MOUNT, not a third hardcoded type -- a module DECLARES `mount: 'ambient'`
      // on its own manifest rather than kiosk.js naming it, so any future module can opt in
      // without this file changing again.
      else if (getManifest(mod.type)?.mount === 'ambient') ambientDef = mod;
      else if (!layout) stageDefs.push(mod);                  // no layout: the old stage
    }
  }

  // persistent HUD overlays (mounted once, left running)
  // The HUD overlays — the mirror and the corner clock. Same rule as the slots below, and here
  // it is worse if broken: this runs during BOOT, so a camera that throws on a machine with no
  // webcam used to reject before the stage was ever built and leave the whole kiosk on its
  // loading screen. An overlay is decoration on top of the screen; it cannot be allowed to
  // prevent the screen.
  async function mountOverlay(def, el) {
    const host = document.createElement('div'); host.className = 'k-mod';
    el.append(host); el.hidden = false;
    try {
      return await mountInstance(def, host);
    } catch (err) {
      console.error(`kiosk: ${def.type} overlay failed to start`, err);
      // Put the corner back the way it was. A HUD that cannot draw should leave no trace —
      // an empty translucent rectangle in the corner of a bedside screen is a thing somebody
      // has to wonder about, and there is nothing they could do about it.
      host.remove(); el.hidden = true;
      return null;
    }
  }
  let cameraRec = null;
  let clockRec = null;
  let ambientRec = null;
  // At boot, once `partition()` has run. (A swap mounts the same three lines inside `applyModules`.)
  async function mountOverlays() {
    cameraRec = cameraDef ? await mountOverlay(cameraDef, mirrorEl) : null;
    clockRec = clockDef ? await mountOverlay(clockDef, clockEl) : null;
    ambientRec = ambientDef ? await mountOverlay(ambientDef, ambientEl) : null;
  }

  // ---- a LAID-OUT stage: every slot mounted at once, in its grid position ----
  const slotRecs = [];
  // Which panels threw on mount, so the empty-screen message below can tell "nothing was ever
  // put here" apart from "what was put here would not start" — two situations that need
  // completely different things from the person reading them.
  const failedSlots = [];
  // A human name for a module WITHOUT mounting it — the manifest is readable from the registry
  // for exactly this reason. A panel that failed to start has no instance to ask for a title.
  const instanceTitle = (def) => getManifest(def.type)?.title || def.type;
  async function mountLayout() {
    // Each mount reports on its OWN panels. This list was filled here and never emptied, so after a
    // screen swap the empty-screen sentence below named the previous screen's failures as well.
    failedSlots.length = 0;
    stageEl.classList.add('k-grid');
    stageEl.setAttribute('style', gridStyle(layout.preset));
    for (let i = 0; i < layout.slots.length; i++) {
      const cell = document.createElement('div');
      // `mod-box` lets the module size itself against this cell (see modules.css).
      cell.className = 'k-cell mod-box';
      cell.setAttribute('style', slotStyle(layout.preset, i));
      // *** NAME THE CELL, so anything that needs to find one does not count children. ***
      // Added for the guided tour, which has a beat about the live-view corner and had no way
      // to say so: the only selector available was `.k-cell:nth-child(2)`, which points at a
      // POSITION rather than at that panel. Move the layout and a positional selector keeps
      // resolving and starts highlighting the wrong quadrant — silently, which is worse than
      // highlighting nothing. `data-kind` breaks loudly instead, and `record_walkthrough.py`
      // is what hears it.
      cell.setAttribute('data-slot', String(i));
      stageEl.append(cell);
      const id = layout.slots[i];
      if (!id) continue;                                      // an empty slot is allowed
      const def = profile.modules.find((m) => m.id === id);
      if (!def) continue;
      cell.setAttribute('data-kind', def.type);
      const host = document.createElement('div'); host.className = 'k-mod';
      cell.append(host);
      // *** ONE PANEL MUST NOT BE ABLE TO TAKE THE SCREEN DOWN. ***
      //
      // This `await` used to be bare, and that single missing try/catch produced three of the
      // bugs reported off the live site at once. `mountInstance` calls `instance.init()`
      // unguarded, so ANY module throwing on mount rejected here — which aborted the whole
      // loop. Everything in a LATER slot was never built, and `slotRecs` stayed empty, so the
      // check below then announced *"This screen's panels were removed"* on a screen whose
      // panels had not been removed at all. A screen with one module that failed to start
      // rendered as a screen with nothing on it and a message blaming the person for it.
      //
      // Now: the cell says which panel could not start, in that cell, and every other slot
      // still mounts. That is the honest failure — a broken panel is one broken rectangle,
      // not a broken screen — and it is the same rule the Devices tab already follows, where
      // a camera that will not open must not take the switch bindings down with it.
      //
      // Deliberately not a modal, never a gate, and it says what to do rather than reporting a
      // stack trace: this can appear in front of a patient.
      try {
        slotRecs.push(watchRec(await mountInstance(def, host)));
      } catch (err) {
        console.error(`kiosk: ${def.type} failed to start`, err);
        failedSlots.push(def.type);
        host.remove();
        const oops = document.createElement('div');
        oops.setAttribute('data-panel-failed', def.type);
        oops.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
          + 'justify-content:center;text-align:center;padding:4vmin;'
          + 'font:500 clamp(14px,1.9vmin,20px)/1.5 -apple-system,BlinkMacSystemFont,'
          + 'Segoe UI,Roboto,sans-serif;color:var(--text-soft,#5d7064)';
        oops.textContent = `${instanceTitle(def)} could not start. The rest of this screen is fine.`;
        cell.append(oops);
      }
    }

    // *** A SCREEN WITH NOTHING ON IT MUST SAY SO. ***
    //
    // Mike, 2026-09-02: *"Pressing play on the landing page kiosk literally shows nothing."*
    // A saved layout keeps the IDS of the modules that were in its slots. Remove those modules
    // in the composer and the layout still names three slots, so this loop built three cells,
    // found no module for any of them, skipped each one — and produced a perfectly black
    // full-screen page with a control bar at the bottom and no explanation anywhere.
    //
    // Nothing was broken in a way any log would show. Every `continue` above was correct. The
    // defect is that the correct behavior for one slot, repeated for all of them, adds up to a
    // screen that looks like a crash.
    //
    // The composer already guards this — it greys out Open with "a screen needs at least one
    // module to open" — but the kiosk is reachable directly, and the landing page's demo frame
    // reaches it that way. A guard on one door is not a guard.
    //
    // Deliberately NOT a modal and NOT a gate: it is text in the middle of the screen, the
    // control bar stays live, and Screens still gets you out. This can appear in front of a
    // patient, so it says what to do rather than reporting a fault, and it never blocks.
    //
    // Stage R: the modules placed freely are mounted HERE, before this check, so a screen whose panels
    // are all placed in the scene is not announced as empty -- and one whose placed modules all failed
    // names them, the same as failed slots.
    await mountPlaced();
    // The room's ✎ corner: a room with nothing in it yet has no panel whose corners would draw it.
    try { ensureRoomCorner(); } catch { /* not load-bearing */ }
    if (!slotRecs.length && !placedRecs.length) {
      const empty = document.createElement('div');
      empty.setAttribute('data-empty', '');
      empty.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:8vmin;'
        + 'font:500 clamp(18px,2.6vmin,28px)/1.5 -apple-system,BlinkMacSystemFont,'
        + 'Segoe UI,Roboto,sans-serif;color:#cfe0d6';
      // THREE DIFFERENT SITUATIONS, THREE DIFFERENT SENTENCES. They used to be two, and the
      // "removed" one was being shown for the case where nothing had been removed at all —
      // every panel had failed to start. Telling somebody their panels were removed when they
      // were not sends them to fix the wrong thing.
      // *** THEY SAY "Home" BECAUSE THAT IS THE BUTTON ON THE BAR IN FRONT OF THEM. ***
      // All three used to say "Open Screens", and BOTH halves of that went stale in one day:
      // the bar's button is now `Home` (Mike's call) and the tab it leads to is now
      // `Dashboards` (PRIORITY.md #4). So the sentence named a control that exists nowhere.
      // A message that sends somebody to a label they cannot find is worse than no message,
      // and it is the third piece of stale copy this session -- after Lessons pointing at a
      // settings panel that was never built, and the catalog claiming lessons to watch.
      empty.textContent = failedSlots.length
        ? `Nothing on this screen could start (${failedSlots.join(', ')}). Press Home to check it.`
        : layout.slots.length
          ? 'This screen’s panels were removed. Press Home to add some again.'
          : 'Nothing has been added to this screen yet. Press Home to add something.';
      stageEl.append(empty);
    }

    // *** PAINT THE RING, HERE, BECAUSE onFocus ONLY FIRES WHEN FOCUS MOVES. ***
    //
    // Focus starts unset and `focused()` falls back to the first panel — so a grid kiosk came
    // up with a switch already pointed at a panel and no ring anywhere, and the only way to
    // find out where it pointed was to press something and watch what happened. Naming it up
    // front is the entire point of naming it.
    //
    // It lives at the end of `mountLayout` rather than after the input runtime is built,
    // because `mountLayout` runs LATER than that — the first version put it there and painted
    // nothing, since `slotRecs` was still empty. Here it also covers a screen SWAP, which
    // re-runs this function and would otherwise leave the ring on a cell that no longer exists.
    // (Stage R: the first stop of the RING, which is the first slot unless something is placed as an
    // overlay -- an overlay takes the scan first. With nothing placed, exactly `slotRecs[0]` as before.)
    // (2026-10-02: a dashboard whose every panel failed to start can still have a room: its first piece then.)
    // (Scoreboard item 5: the first stop of the LAP -- a panel kept out of it is never where focus starts.)
    const first = ringRecs()[0] || roomStops()[0];
    if (first) {
      try { runtime()?.router?.setFocus?.(first.id); } catch { /* focus is not load-bearing */ }
      paintFocus(first.id);
      renderMods();
    }
  }

  // ---- the stage: one module at a time, mounted lazily --------------------
  let primary = 0;
  let stageRec = null;
  async function showPrimary(i) {
    if (!stageDefs.length) { renderMods(); return; }
    primary = wrap(i, stageDefs.length);
    destroyRec(stageRec); stageRec = null;
    stageEl.innerHTML = '';
    const host = document.createElement('div'); host.className = 'k-mod';
    stageEl.append(host);
    // Guarded for the same reason as the slots: `mountInstance` runs `init()` unguarded, so a
    // module that throws used to reject out of here — leaving a blank stage, no message, and a
    // rejected promise in whatever called this. On a one-module screen that is the entire
    // display gone. Now the panel says so and the controls below still work, so somebody can
    // press Screens and get out.
    try {
      stageRec = watchRec(await mountInstance(stageDefs[primary], host));
    } catch (err) {
      const def = stageDefs[primary];
      console.error(`kiosk: ${def.type} failed to start`, err);
      stageRec = null;
      host.remove();
      const oops = document.createElement('div');
      oops.setAttribute('data-panel-failed', def.type);
      oops.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:8vmin;'
        + 'font:500 clamp(18px,2.6vmin,28px)/1.5 -apple-system,BlinkMacSystemFont,'
        + 'Segoe UI,Roboto,sans-serif;color:#cfe0d6';
      oops.textContent = `${instanceTitle(def)} could not start. Open Screens to check this screen.`;
      stageEl.append(oops);
    }
    // Keep the focus ring in step when the stage was changed by a number key or a dot,
    // or the next switch press would resume from wherever focus was last left.
    runtime()?.router.setFocus(stageDefs[primary].id);
    // Where she is, remembered on the device. Written whatever the restart mode is, so
    // turning "pick up where she left off" on later does not start by forgetting.
    writePosition(user, profileId(), primary, storage);
    renderMods();
  }
  // *** WHAT THE BAR IS ABOUT: THE FOCUSED INSTANCE. ***
  //
  // One function, because the bar, the ring on the panel and the settings menu must never
  // disagree about which panel they mean. Mike's call, 2026-09-05: input focus and the bar's
  // subject are ONE concept — *a bar pointing at one panel while the switch drives another is
  // worse than no bar.* So this reads `router.focused()` rather than keeping a second idea of
  // it alongside.
  //
  // On a laid-out screen every panel is mounted, so focus picks between the slots. On a stage
  // screen only one panel is mounted at a time, so the focused one IS the mounted one.
  function focusedRec() {
    if (!layout) return stageRec;
    // Stage R: every panel -- slots and placed -- in ring order. With nothing placed, `slotRecs`.
    const all = panelRecs();
    if (!all.length) return null;
    const id = runtime()?.router?.focused?.()?.id;
    return all.find((r) => r.id === id) || ringRecs()[0] || all[0];
  }

  /**
   * *** THE MODULES ON THE SCREEN THAT NO SLOT IS SHOWING. ***
   *
   * G9, from Mike testing the live site: *"I added more than three modules to a screen. Only
   * three appear on the bar and the rest are unreachable."* Measured in `transport_test`: a
   * `main` preset has three slots, five modules on the profile, and two of them — Quests and
   * Pond — appear in NO slot, on NO stage and on NO button. `partition()` fills `stageDefs`
   * only when there is no layout at all, so an unplaced module on an arranged screen is not
   * hidden, it is absent. (That is also the whole of *"Quests did not appear on the bar"*:
   * Quests was one of the unplaced ones. With no layout it gets a button like everything else.)
   *
   * Leaving a module unplaced is a legitimate thing to do — the composer treats placed and
   * unplaced as first-class, and "I am not using that one right now" is a real answer. What is
   * not legitimate is that there was then no way back to it from the screen itself.
   */
  function unplacedDefs() {
    if (!layout) return [];
    const placed = new Set([...layout.slots.filter(Boolean), ...(layout.placed || []).map((p) => p.id)]);
    return profile.modules.filter((m) => !placed.has(m.id)
      // The HUD pair are not panels. An unplaced camera is the mirror overlay and an unplaced
      // clock is the corner clock — both already on screen, neither belonging in a slot.
      && m.type !== 'camera' && m.type !== 'clock');
  }

  /**
   * Put an unplaced module into the slot that has focus, and let the one that was there become
   * unplaced in its turn. Nothing is saved: this is what the screen is showing NOW, and a
   * reload comes back to the arrangement somebody actually made.
   *
   * Swapping rather than adding a slot, because the arrangement is the person's — growing a
   * `quad` into a five-panel grid on a button press would rewrite a decision they made in the
   * composer. Swapping says "show me that one instead", which is what pressing its name means.
   */
  async function showUnplaced(def) {
    if (!layout) return;
    // Stage R: a module PLACED freely is already on the screen. Pressing its name focuses it, as a
    // placed slot's chip does -- it must never be swapped into a slot, which would mount it twice.
    if (def && placedRecs.some((r) => r.id === def.id)) { focusPlaced(def.id); return; }
    const focused = focusedRec();
    let i = focused ? layout.slots.indexOf(focused.id) : -1;
    if (i < 0) i = layout.slots.findIndex(Boolean);
    if (i < 0) i = 0;
    const cell = stageEl.querySelector(`[data-slot="${i}"]`);
    if (!cell) return;

    const outgoingId = layout.slots[i];
    const outgoing = slotRecs.find((r) => r.id === outgoingId);
    if (outgoing) {
      destroyRec(outgoing);
      slotRecs.splice(slotRecs.indexOf(outgoing), 1);
    }
    cell.innerHTML = '';
    cell.setAttribute('data-kind', def.type);
    const host = document.createElement('div');
    host.className = 'k-mod';
    cell.append(host);
    layout.slots[i] = def.id;
    try {
      slotRecs.push(watchRec(await mountInstance(def, host)));
      try { runtime()?.router?.setFocus?.(def.id); } catch { /* focus is not load-bearing */ }
      paintFocus(def.id);
    } catch (err) {
      // Same rule as the mount loop: a panel that will not start is one broken rectangle, not
      // a broken screen — and here somebody pressed a button, so it has to say what happened.
      console.error(`kiosk: ${def.type} failed to start`, err);
      const oops = document.createElement('div');
      oops.setAttribute('data-panel-failed', def.type);
      oops.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:4vmin;'
        + 'font:500 clamp(14px,1.9vmin,20px)/1.5 -apple-system,BlinkMacSystemFont,'
        + 'Segoe UI,Roboto,sans-serif;color:var(--text-soft,#5d7064)';
      oops.textContent = `${instanceTitle(def)} could not start. The rest of this screen is fine.`;
      cell.append(oops);
    }
    renderMods();
  }

  // What pressing a PLACED panel's chip does: move focus there and repaint the ring and the bar.
  // A function so `showModule` (below) does exactly the same thing rather than a look-alike.
  function focusPlaced(id) {
    try { runtime()?.router?.setFocus?.(id); } catch { /* focus is not load-bearing */ }
    // A panel kept out of the lap cannot take the router's focus; the ring is painted where focus really is,
    // so the ring and the switch never point at two different panels (the 09-05 rule).
    paintFocus(scanOff(id) ? (ringFocusId() || id) : id);
    renderMods();
  }

  // The ring on the panel. Split out of `onFocus` so the bar can call it too — pressing a
  // button on the bar and cycling focus with a switch have to leave the screen in the same
  // state, or the two controls are describing different screens.
  function paintFocus(id) {
    if (!layout) return;
    for (const cell of stageEl.querySelectorAll('.k-cell')) delete cell.dataset.focused;
    // Stage R: the placed boxes carry the ring too. Their outline is drawn inline (kiosk.css's ring
    // rule is for `.k-cell`), in the same colour and offset.
    for (const m of placedMeta.values()) { delete m.wrap.dataset.focused; m.wrap.style.outline = ''; }
    const rec = slotRecs.find((r) => r.id === id);
    const cell = rec?.el?.closest?.('.k-cell');
    if (cell) cell.dataset.focused = '1';
    const pm = placedMeta.get(id);
    if (pm && placedRecs.some((r) => r.id === id)) {
      pm.wrap.dataset.focused = '1';
      pm.wrap.style.outline = '3px solid var(--accent,#839958)';
      pm.wrap.style.outlineOffset = '2px';
    }
    // A piece of the dashboard's room (THE ROOM'S PIECES, below): the room draws it, in its own scan look;
    // focus anywhere else takes that off.
    if (roomScene && typeof roomScene.focusTarget === 'function') {
      const stop = isPieceId(id) ? roomStops().find((s) => s.id === id) : null;
      try { roomScene.focusTarget(stop ? stop.el : null); } catch (err) { console.error('arrangement: the room\'s focus', err); }
    }
  }

  // =================================================================================================
  // *** STAGE R: MODULES PLACED FREELY -- in the scene, flat on the screen, or an overlay. ***
  //
  // Mike, 2026-09-30: "free placement is back". Design's model (room-is-the-screen §1): a dashboard has
  // a scene (a room, a ground, or plain) and every module has a place. The grid above is the SNAPPED
  // kind; this is the PLACED kind, beside it, from `layout.placed` (layout.js says what an entry is).
  //
  // THREE LAYERS, each created only when something is placed there, each on the one depth scale
  // (layers.css -- no module invents a z-index):
  //   scene    ambient + 50: behind the grid, above the ambient drift. The room is drawn here.
  //   screen   panels + 50: flat, above the grid's panels.
  //   overlay  floating: above everything on the screen, BELOW the bar (500) and the menus (600) --
  //            the way out must stay on top of anything a person places.
  // Each layer passes presses through (`pointer-events:none`); the placed boxes take them back.
  //
  // IN A ROOM, a module placed with a `slot` mounts in that slot of the room (room_scene.js `slots()`:
  // a `kind:'module'` wall mount, or a display object's slot -- the cabinet, the bookshelf). One placed
  // freely sits on the room's own 960x540 stage, so it scales with the room, at the box `itemBox()`
  // gives a `kind:'module'` item there: a side wall's perspective matrix included.
  //
  // NO ROOM (no scene, or a plain one): a scene-placed module sits on the scene layer at x/y.
  // =================================================================================================
  const placedRecs = [];                    // the live array, like `slotRecs`
  const placedMeta = new Map();             // id -> { entry, wrap, where }
  const placedLayers = {};                  // place -> the layer element
  let roomScene = null;                     // the room renderer's handle, while the scene is a room
  let roomHost = null;                      // the element the room is drawn in (edit mode's box for it)
  let roomFree = null;                      // the layer on the room's stage for freely placed modules
  let placedMounted = false;                // mountPlaced ran for this arrangement (applyPlaced's guard)
  const LAYER_Z = {
    scene: 'calc(var(--z-ambient, 100) + 50)',
    screen: 'calc(var(--z-panels, 200) + 50)',
    overlay: 'var(--z-floating, 400)',
  };
  const placedOf = () => (layout && layout.placed) || [];
  // The scene kinds that are drawn as a room the modules can sit in: Design's 2D room, and room3d.js.
  const isRoomScene = (scene) => !!scene && (scene.kind === 'room' || scene.kind === 'room3d');

  // Every panel on a laid-out screen, in RING ORDER: overlays first (Design: an overlay "takes the scan
  // first"), then the slots, then flat-on-screen, then the scene. With nothing placed: `slotRecs`.
  // (Scoreboard item 5: a placed panel kept OUT of the switch lap -- `scanOff` -- is still a panel: the bar, the
  // menu's "Settings for" and edit mode reach it. It is listed LAST, after every panel the lap reaches.)
  function panelRecs() {
    if (!placedRecs.length) return slotRecs.slice();
    const by = (place) => placedOf().filter((e) => e.place === place)
      .map((e) => placedRecs.find((r) => r.id === e.id)).filter(Boolean);
    const all = [...by('overlay'), ...slotRecs, ...by('screen'), ...by('scene')];
    return [...all.filter((r) => !scanOff(r.id)), ...all.filter((r) => scanOff(r.id))];
  }
  // The panels that are stops in the switch lap, in ring order.
  const ringRecs = () => panelRecs().filter((r) => !scanOff(r.id));

  // =================================================================================================
  // *** IN THE SWITCH LAP, OR NOT (Mike's list 09-30, Scoreboard item 5: a floating scoreboard must not
  // "steal the switch scan unless chosen"). *** A placed entry's `scan` (layout.js) is somebody's CHOICE:
  // true = a stop in the lap, false = not. With no choice, the default for its place: every place is in the
  // lap, and an overlay takes it FIRST (Design's rule, unchanged) -- unless the overlay's module declares
  // `overlayScan: 'skip'` on its manifest. Argued:
  //   FOR the module saying it: whether an overlay is something to PRESS (a door, a control) or something to
  //   GLANCE AT (a score, a count) is a fact about the module, and the scoreboard is the second kind -- on a
  //   one-switch lap, a stop nobody needs to press costs a press on every lap, and taking the FIRST stop means
  //   the first press of the day lands on it.
  //   AGAINST: two places decide (the manifest's default, the entry's choice). The entry always wins, and only
  //   overlays read the manifest, so the default can be overridden in one line of the saved layout.
  // A panel out of the lap is NOT out of reach: a pointer presses it directly, and its own buttons offer the
  // choice back (the scoreboard's "Switch scan"). Nothing waits on it either way, so no screen can strand anyone.
  // =================================================================================================
  function scanOff(id) {
    const e = placedMeta.get(id)?.entry;
    if (!e || !placedRecs.some((r) => r.id === id)) return false;
    if (typeof e.scan === 'boolean') return !e.scan;
    if (e.place !== 'overlay') return false;
    const def = profile?.modules?.find((m) => m.id === id);
    try { return getManifest(def?.type)?.overlayScan === 'skip'; } catch { return false; }
  }

  function layerFor(place) {
    if (placedLayers[place]) return placedLayers[place];
    const el = document.createElement('div');
    el.className = `k-placed k-placed-${place}`;
    el.dataset.place = place;
    el.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${LAYER_Z[place]}`;
    kioskEl.append(el);
    placedLayers[place] = el;
    return el;
  }

  // The dashboard's scene, when it is a room. Loaded on demand: a screen with no room never imports
  // the renderer (its art, its live window) at all.
  async function mountRoom() {
    const scene = layout && layout.scene;
    if (!isRoomScene(scene) || roomScene) return;
    // 2026-10-02: a ROOM3D scene (room3d.js: the same idea built from CSS 3D transforms) mounts here too,
    // lazily, with the same handle shape -- `slots()` for modules in its slots, `stage`, `objects()`,
    // `destroy()` -- plus `faceBox()` for a module placed freely on one of its walls (`styleWrap`).
    if (scene.kind === 'room3d') {
      try {
        const { mountRoom3d } = await import('./room3d.js');
        // This device's "3D detail" (room_lod.js DETAIL_FIELD, a screen setting): loaded with the renderer.
        const { lodOptionsFor } = await import('./room_lod.js');
        if (roomScene) return;                // a second call that raced this one already mounted it
        roomItemBox = null;
        const host = document.createElement('div');
        host.className = 'k-room k-room3d';
        host.style.cssText = 'position:absolute;inset:0;pointer-events:auto';
        layerFor('scene').append(host);
        roomHost = host;
        // `bus`: a piece of its furniture that is a door publishes `dashboard/go` on it, as a 2D room's does.
        let detail = 'auto';
        try { detail = (settings?.get?.() || {}).room3dDetail || 'auto'; } catch { detail = 'auto'; }
        roomScene = mountRoom3d(host, scene, { bus, ...lodOptionsFor(detail), ...(scene.options || {}) });
      } catch (err) {
        console.error('arrangement: the 3D room could not be drawn', err);
        roomScene = null;
      }
      return;
    }
    try {
      const [rs, { presetRecipe }, { ROOM_SHELLS }] = await Promise.all([
        import('./room_scene.js'), import('./room_presets.js'), import('./room_parts.js')]);
      const { mountRoomScene } = rs;
      // What a module placed freely on a wall needs to be drawn the way the room draws its own mounts.
      roomItemBox = rs.itemBox; roomShells = ROOM_SHELLS; roomW = rs.W; roomH = rs.H;
      const host = document.createElement('div');
      host.className = 'k-room';
      host.style.cssText = 'position:absolute;inset:0;pointer-events:auto';
      layerFor('scene').append(host);
      roomHost = host;
      // Row 2.37: the same objects (library shelf, weather window, close-ups) as the room module turns on.
      roomScene = mountRoomScene(host, scene.recipe || presetRecipe(scene.preset),
        { bus, ...rs.OBJECT_DEFAULTS, ...(scene.options || {}), ...(flashLimit !== undefined ? { flashLimit } : {}) });
    } catch (err) {
      // A room that will not draw leaves the screen's own backdrop; the modules still mount (flat).
      console.error('arrangement: the room could not be drawn', err);
      roomScene = null;
    }
  }

  // Where one entry goes: `{ el, where }`, where is 'slot' | 'room' | 'flat'.
  function containerFor(entry) {
    if (entry.place === 'scene' && roomScene) {
      const slot = entry.slot ? roomScene.slots().get(entry.slot) : null;
      if (slot && slot.el) return { el: slot.el, where: 'slot' };
      // A 3D room: freely placed on one of its faces (the face is the element; `styleWrap` sizes it).
      if (typeof roomScene.faceBox === 'function') {
        const fb = roomScene.faceBox(entry.surface, placedGeometry(entry));
        if (fb && fb.el) return { el: fb.el, where: 'face' };
      }
      if (!roomFree) {
        roomFree = document.createElement('div');
        roomFree.className = 'k-placed-room';
        roomFree.style.cssText = 'position:absolute;inset:0;pointer-events:none';
        roomScene.stage.append(roomFree);
      }
      return { el: roomFree, where: 'room' };
    }
    return { el: layerFor(entry.place), where: 'flat' };
  }

  // The box's geometry, for where it is. Nothing here mounts or remounts anything.
  let roomItemBox = null, roomShells = null, roomW = 960, roomH = 540;
  function styleWrap(wrap, entry, where) {
    const g = placedGeometry(entry);
    const s = wrap.style;
    s.position = 'absolute';
    s.pointerEvents = 'auto';
    // Shown/Hidden (the Layers window): a hidden module is not drawn, and is still mounted.
    s.display = entry.shown === false ? 'none' : 'flex';
    s.zIndex = String(g.layer);
    for (const k of ['inset', 'left', 'top', 'width', 'height', 'transform', 'transformOrigin']) s[k] = '';
    const turn = g.rot ? ` rotate(${g.rot}deg)` : '';
    if (where === 'slot') {
      s.inset = '0';
      if (turn) s.transform = turn.trim();
      return;
    }
    if (where === 'face' && typeof roomScene?.faceBox === 'function') {
      // x/y/w/h stay the dashboard's percent; room3d.js turns them into a box on the face such that the
      // module's centre is drawn at x/y and its drawn size is w/h (the perspective run backwards).
      const b = roomScene.faceBox(entry.surface, g);
      s.left = `${b.left}%`; s.top = `${b.top}%`; s.width = `${b.width}%`; s.height = `${b.height}%`;
      s.transform = `translate(-50%, -50%)${turn}${g.scale !== 100 ? ` scale(${g.scale / 100})` : ''}`;
      return;
    }
    if (where === 'room' && roomItemBox) {
      const wall = entry.surface === 'left' || entry.surface === 'right' ? entry.surface : undefined;
      const shell = roomShells?.[roomScene?.recipe?.()?.shell] || undefined;
      const box = roomItemBox({ kind: 'module', x: g.x, y: g.y, w: (g.w / 100) * roomW, h: (g.h / 100) * roomH,
        wall, scale: g.scale / 100 }, shell);
      s.left = `${box.left}%`; s.top = `${box.top}%`;
      s.width = `${box.w}px`; s.height = `${box.h}px`;
      s.transform = `${box.transform}${turn}`;
      s.transformOrigin = box.origin;
      return;
    }
    s.left = `${g.x}%`; s.top = `${g.y}%`; s.width = `${g.w}%`; s.height = `${g.h}%`;
    s.transform = `translate(-50%, -50%)${turn}${g.scale !== 100 ? ` scale(${g.scale / 100})` : ''}`;
  }

  // A placed module's box, drawn where its entry says and recorded in `placedMeta`. (Its own function so a
  // panel FLOATED out of its slot -- `floatFromSlot` -- gets exactly the box a mounted one does.)
  function placedWrap(def, entry) {
    const wrap = document.createElement('div');
    // `mod-box` so the module sizes itself against this box, as a slot's cell does.
    wrap.className = 'k-pcell mod-box';
    wrap.dataset.placed = def.id;
    wrap.dataset.place = entry.place;
    wrap.dataset.kind = def.type;
    const { el, where } = containerFor(entry);
    styleWrap(wrap, entry, where);
    el.append(wrap);
    placedMeta.set(def.id, { entry, wrap, where });
    return wrap;
  }

  async function mountPlacedOne(entry) {
    const def = profile.modules.find((m) => m.id === entry.id);
    if (!def) return null;
    const wrap = placedWrap(def, entry);
    const host = document.createElement('div'); host.className = 'k-mod';
    host.style.cssText = 'flex:1;min-width:0;min-height:0';
    wrap.append(host);
    syncDoor(def.id);
    // The same rule as a slot: one module that will not start is one broken box, not a broken screen.
    try {
      const rec = watchRec(await mountInstance(def, host));
      placedRecs.push(rec);
      // A panel SAVED hidden is told so as it mounts (hide = mute, ad7dc49): it was playing after a reload.
      if (entry.shown === false) { try { rec.instance?.onHide?.(); } catch { /* not load-bearing */ } }
      tellPlace(def.id);
      return rec;
    } catch (err) {
      console.error(`kiosk: ${def.type} (placed) failed to start`, err);
      failedSlots.push(def.type);
      host.remove();
      const oops = document.createElement('div');
      oops.setAttribute('data-panel-failed', def.type);
      oops.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:2vmin;'
        + 'font:500 clamp(14px,1.9vmin,20px)/1.5 -apple-system,BlinkMacSystemFont,'
        + 'Segoe UI,Roboto,sans-serif;color:var(--text-soft,#5d7064)';
      oops.textContent = `${instanceTitle(def)} could not start. The rest of this screen is fine.`;
      wrap.append(oops);
      return null;
    }
  }

  async function mountPlaced() {
    placedMounted = true;
    if (!layout) return;
    if (!placedOf().length && !isRoomScene(layout.scene)) return;
    await mountRoom();
    for (const entry of placedOf()) await mountPlacedOne(entry);
  }

  // =================================================================================================
  // *** ROW 2.38: A PLACED MODULE CAN BE A DOOR (`opens` on its entry, layout.js). ***
  // Pressing it shows that dashboard: `dashboard/go { id }`, the verb the kiosk already answers with its
  // load-then-swap and back stack. Two ways to press it, the same two every panel has:
  //   POINTER   a clear button over the whole box. While a module is a door, pressing it IS opening
  //             it -- the module underneath is still drawn (a picture frame still shows its picture), it
  //             just does not take the press as well. FOR: one press, one meaning, which is what a
  //             switch user can predict. AGAINST: a door whose module had its own buttons loses them
  //             here; the edit windows (or removing `opens`) are how it gets them back.
  //   SCAN      the ring reports the door as type `opens` (focusRing), so `select` on it reaches
  //             `opens/press` on that instance (actions.js MODULE_VERBS.opens) and this opens it. A door
  //             is always reachable, even when its module answers no verb at all (a clock).
  // The press carries `claim()` like a room object's: nobody claiming (an embed, a preview) is not an
  // error, it is just a page with nowhere to go.
  // =================================================================================================
  const doorOf = (id) => {
    const o = placedMeta.get(id)?.entry?.opens;
    return typeof o === 'string' && o ? o : null;
  };
  function openDoor(id, source) {
    const target = doorOf(id);
    if (!target) return false;
    let claimed = false;
    try {
      bus?.publish?.(DASHBOARD_GO_TOPIC, { id: target, source, moduleId: id, claim: () => { claimed = true; } });
    } catch (err) { console.error('arrangement: open', err); }
    return claimed;
  }
  function syncDoor(id) {
    const meta = placedMeta.get(id);
    if (!meta) return;
    const target = doorOf(id);
    if (!target) {
      meta.door?.remove(); meta.door = null;
      try { meta.doorOff?.(); } catch { /* gone */ }
      meta.doorOff = null;
      delete meta.wrap.dataset.opens;
      return;
    }
    meta.wrap.dataset.opens = target;
    if (!meta.door) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'k-door';
      b.setAttribute('aria-label', 'open this');
      b.title = 'open this';
      // Above the module in its own box; clear, so what the module draws is what is seen.
      b.style.cssText = 'position:absolute;inset:0;z-index:calc(var(--z-panel-contents, 300) + 10);margin:0;padding:0;border:0;'
        + 'background:transparent;cursor:pointer';
      b.addEventListener('click', (e) => { e.stopPropagation(); openDoor(id, 'placed'); });
      meta.wrap.append(b);
      meta.door = b;
    }
    if (!meta.doorOff && bus?.subscribe) {
      const topic = bus.instanceTopic ? bus.instanceTopic(id, OPENS_PRESS_TOPIC) : `${OPENS_PRESS_TOPIC}#${id}`;
      meta.doorOff = bus.subscribe(topic, () => { openDoor(id, 'scan'); });
    }
  }
  function dropDoor(meta) {
    if (!meta) return;
    try { meta.doorOff?.(); } catch { /* gone */ }
    meta.doorOff = null;
  }

  function removePlaced(id) {
    const at = placedRecs.findIndex((r) => r.id === id);
    if (at >= 0) destroyRec(placedRecs.splice(at, 1)[0]);
    dropDoor(placedMeta.get(id));
    placedMeta.get(id)?.wrap.remove();
    placedMeta.delete(id);
  }

  function teardownPlaced() {
    while (placedRecs.length) destroyRec(placedRecs.pop());
    for (const m of placedMeta.values()) dropDoor(m);
    placedMeta.clear();
    dropPieceSubs();                        // the room's stops go with the room
    try { roomScene?.destroy(); } catch { /* already gone */ }
    roomScene = null; roomFree = null; roomHost = null;
    for (const k of Object.keys(placedLayers)) { placedLayers[k].remove(); delete placedLayers[k]; }
    placedMounted = false;
  }

  // =================================================================================================
  // *** THE HUD PAIR FOLLOW A PLACEMENT CHANGE (2026-10-02; Mike's list 09-30, Stage R item 6: "a removed
  // camera doesn't return to the corner until the next rebuild"). *** `partition()` is the one rule: an
  // UNPLACED camera is the corner mirror, an unplaced clock the corner clock (and an unplaced ambient module
  // the ambient mount). `applyPlaced` changes what is placed WITHOUT a rebuild, so it has to re-run that rule
  // and act on the difference, or the corner stays as the last rebuild left it:
  //   * placed now, in a corner before -> the corner one is torn down BEFORE the panel mounts (`dropHud`),
  //     so one camera is never opened by two instances at once;
  //   * in a corner now, placed before -> it mounts in its corner AFTER the panel is torn down (`raiseHud`).
  // Each answers the ids it moved, so `applyPlaced` can say so (`hud: { dropped, raised }`).
  // =================================================================================================
  const hudSlots = () => [
    { def: () => cameraDef, rec: () => cameraRec, set: (r) => { cameraRec = r; }, el: mirrorEl },
    { def: () => clockDef, rec: () => clockRec, set: (r) => { clockRec = r; }, el: clockEl },
    { def: () => ambientDef, rec: () => ambientRec, set: (r) => { ambientRec = r; }, el: ambientEl },
  ];
  function dropHud() {
    const dropped = [];
    for (const h of hudSlots()) {
      const rec = h.rec();
      if (!rec || (h.def() && h.def().id === rec.id)) continue;
      destroyRec(rec);
      h.set(null);
      if (h.el) { h.el.innerHTML = ''; h.el.hidden = true; }
      dropped.push(rec.id);
    }
    return dropped;
  }
  async function raiseHud() {
    const raised = [];
    for (const h of hudSlots()) {
      const def = h.def();
      if (!def || h.rec() || !h.el) continue;
      const rec = await mountOverlay(def, h.el);
      h.set(rec);
      if (rec) raised.push(def.id);
    }
    return raised;
  }

  /**
   * *** A PLACEMENT CHANGE, APPLIED IN PLACE. ***
   *
   * `next` is a saved layout (raw, as `settings.kiosk.layout` holds it). If it differs from what is
   * mounted only in its free placement (`layoutChange` says 'placement'), each placed module is
   * brought to its new place WITHOUT a remount: moved (re-styled), moved to another layer (the same
   * element re-parented), added (only it mounts), removed (only it is torn down). Nothing else on the
   * screen is touched and nothing reloads -- which is the whole reason the 09-12 watch can leave a
   * placement change alone.
   *
   * Anything else -- a grid change -- is refused (`applied: false`): the caller does what it always did
   * (the kiosk reloads; a dashboard module rebuilds). Before the first mount, the layout is only
   * recorded, and `resolve` / `mountLayout` use it.
   *
   * Resolves `{ applied, moved, added, removed, hud: { dropped, raised } }` (id lists; `hud`: the camera /
   * clock that left or came back to a corner, see `dropHud`), or `{ applied: false, reason }`.
   */
  async function applyPlaced(next) {
    const none = { applied: false, moved: [], added: [], removed: [] };
    if (!profile) { lateLayout = next; return { ...none, applied: true, deferred: true }; }
    const r = resolveLayout(next, profile.modules);
    const cur = layout;
    // Refused when the SHAPE differs: no layout on either side, another preset, another scene. The
    // slots are not compared: the caller classified the saved values already (`layoutChange`), and the
    // mounted slots may differ from the saved ones on purpose -- the unplaced swap is "what the screen
    // shows NOW" and is never saved -- so a move must not undo it, or be refused because of it.
    if (!r || !cur || r.preset !== cur.preset) return { ...none, reason: 'grid' };
    // Row 2.38: scenes that differ ONLY in which dashboard the room's objects open are not a rebuild --
    // each changed object becomes (or stops being) a door, in place (room_scene.js `setObjectOpens`).
    const doors = JSON.stringify(r.scene || null) === JSON.stringify(cur.scene || null) ? []
      : sceneDoorChanges(cur.scene || null, r.scene || null);
    if (!doors) return { ...none, reason: 'grid' };
    // The mounted slots, with the new placement (one place per instance: a placed id in a slot is dropped).
    const inSlots = new Set(cur.slots.filter(Boolean));
    const nextPlaced = (r.placed || []).filter((e) => !inSlots.has(e.id));
    const l = { ...cur };
    delete l.placed;
    if (nextPlaced.length) l.placed = nextPlaced;
    if (doors.length) l.scene = r.scene;      // row 2.38: the scene as saved, its doors moved
    if (!isArranged(l)) return { ...none, reason: 'grid' };
    if (!placedMounted) { layout = l; return { ...none, applied: true, deferred: true }; }
    const before = new Map(placedOf().map((e) => [e.id, e]));
    const after = l.placed || [];
    const keep = new Set(after.map((e) => e.id));
    const out = { applied: true, moved: [], added: [], removed: [], doors: doors.map((d) => d.id), hud: { dropped: [], raised: [] } };
    for (const id of before.keys()) if (!keep.has(id)) { removePlaced(id); out.removed.push(id); }
    layout = l;
    // The HUD pair, by the same rule as a rebuild (see `dropHud`): what is placed now leaves its corner first.
    partition();
    out.hud.dropped = dropHud();
    for (const d of doors) { try { roomScene?.setObjectOpens?.(d.id, d.opens); } catch (err) { console.error('arrangement: door', err); } }
    if (after.length || isRoomScene(l.scene)) await mountRoom();
    for (const entry of after) {
      const meta = placedMeta.get(entry.id);
      if (!meta) { await mountPlacedOne(entry); out.added.push(entry.id); continue; }
      if (JSON.stringify(meta.entry) === JSON.stringify(entry)) continue;
      const { el, where } = containerFor(entry);
      if (meta.wrap.parentNode !== el) moveKeeping(el, meta.wrap);    // re-parented, not remounted (and kept playing)
      meta.wrap.dataset.place = entry.place;
      styleWrap(meta.wrap, entry, where);
      const rec = placedRecs.find((r) => r.id === entry.id);
      const wasShown = meta.entry.shown !== false, isShown = entry.shown !== false;
      if (rec && wasShown !== isShown) {
        try { (isShown ? rec.instance?.onShow : rec.instance?.onHide)?.call(rec.instance); } catch { /* not load-bearing */ }
      }
      try { rec?.instance?.onResize?.(); } catch { /* not load-bearing */ }
      meta.entry = entry; meta.where = where;
      syncDoor(entry.id);                   // row 2.38: `opens` added, changed or taken off
      tellPlace(entry.id);                  // Scoreboard item 5: a panel that now floats (or no longer) is told
      out.moved.push(entry.id);
    }
    // ...and what is no longer placed goes back to its corner, now that its panel is gone.
    out.hud.raised = await raiseHud();
    dropEmptyLayers();
    // The ring stays where focus is -- on a room piece too, not only a panel (THE ROOM'S PIECES).
    const fid = ringFocusId();
    if (fid) paintFocus(fid);
    renderMods();
    return out;
  }

  // Empty layers go, so a screen whose last overlay was removed has no empty overlay layer.
  function dropEmptyLayers() {
    for (const k of Object.keys(placedLayers)) {
      if (k === 'scene' && roomScene) continue;
      if (!placedLayers[k].children.length) { placedLayers[k].remove(); delete placedLayers[k]; }
    }
  }

  // =================================================================================================
  // *** A PANEL ASKS TO FLOAT (Mike's list 09-30, Scoreboard item 5: "'Show as overlay' is one big counter
  // for now -- a true floating overlay needs the dashboard to mount things in front"). ***
  // `shell/place` (PLACE_REQUEST_TOPIC) from a panel of THIS dashboard (another dashboard's panel is not ours,
  // and is not claimed): the dashboard does it, IN PLACE -- the same instance, never remounted, so a count, a
  // game, a video carries on -- saves it where the edit view saves (`layoutStore`), and tells the panel where
  // it now is (`panel/placed#<id>`, PLACED_TOPIC). Three requests:
  //   place: 'overlay'  from a grid slot: out of the slot (left EMPTY -- "three panels and a gap" is a layout
  //                     a person may mean, and filling it with something else would rewrite their grid) and
  //                     into the overlay layer at x/y/w/h (the panel's own suggestion; the edit view moves and
  //                     resizes it from there like any placed thing). Already placed: its place becomes overlay.
  //   place: 'slot'     back into the grid: the first EMPTY slot (where it came from, when nothing else took
  //                     it). No empty slot: flat on the screen in the same box -- never a full grid rewritten.
  //   scan: true|false  in or out of the switch lap (`scanOff`), as somebody chose.
  // `reply({ ok, place?, reason? })` says what happened; `claim()` that this dashboard took it.
  // =================================================================================================
  function tellPlace(id) {
    if (!id || typeof bus?.publish !== 'function') return;
    const e = placedMeta.get(id)?.entry;
    const place = e && placedRecs.some((r) => r.id === id) ? e.place : slotRecs.some((r) => r.id === id) ? 'slot' : null;
    if (!place) return;
    const topic = bus.instanceTopic ? bus.instanceTopic(id, PLACED_TOPIC) : `${PLACED_TOPIC}#${id}`;
    try { bus.publish(topic, { id, place, scan: !scanOff(id) }); } catch (err) { console.error('arrangement: telling a panel where it is', err); }
  }
  /** The layout as SAVED, when the host keeps one; else the one mounted. A copy, to change and save. */
  function savedBase() {
    let raw = null;
    try { raw = layoutStore?.get?.() || null; } catch { raw = null; }
    const b = raw && typeof raw === 'object' ? raw : layout;
    return b ? JSON.parse(JSON.stringify(b)) : null;
  }
  function saveLayout(next) {
    try { layoutStore?.save?.(next); } catch (err) { console.error('arrangement: saving a placement', err); }
  }
  function afterMove(id) {
    try { recFor(id)?.instance?.onResize?.(); } catch { /* not load-bearing */ }
    tellPlace(id);
    const fid = ringFocusId();
    if (fid) paintFocus(fid);
    renderMods();
  }
  function floatFromSlot(id, q, scan) {
    const at = slotRecs.findIndex((r) => r.id === id);
    const rec = slotRecs[at];
    const cell = rec?.el?.closest?.('.k-cell');
    const def = profile?.modules?.find((m) => m.id === id);
    if (!rec || !cell || !def) return { ok: false, reason: 'not in a slot here' };
    const entry = normalizePlacedEntry({ id, place: 'overlay', x: q.x, y: q.y, w: q.w, h: q.h,
      ...(typeof scan === 'boolean' ? { scan } : {}) });
    if (promoted === id) unmarkPromoted();
    // Out of the slot: the cell is left empty, with nothing of this panel on it.
    slotRecs.splice(at, 1);
    cell.querySelectorAll(':scope > .k-promote, :scope > .k-editc').forEach((b) => b.remove());
    cell.removeAttribute('data-kind');
    delete cell.dataset.focused;
    layout = { ...layout, slots: layout.slots.map((s) => (s === id ? null : s)), placed: [...(layout.placed || []), entry] };
    // Into the overlay layer: the SAME host element, re-parented.
    const wrap = placedWrap(def, entry);
    rec.el.style.cssText = 'flex:1;min-width:0;min-height:0';
    moveKeeping(wrap, rec.el);              // the wrap is already in the page, so a video in it carries on
    placedRecs.push(rec);
    syncDoor(id);
    const base = savedBase();
    if (base) {
      saveLayout({ ...base, slots: (Array.isArray(base.slots) ? base.slots : []).map((s) => (s === id ? null : s)),
        placed: [...(Array.isArray(base.placed) ? base.placed : []).filter((e) => e && e.id !== id), entry] });
    }
    afterMove(id);
    return { ok: true, place: 'overlay' };
  }
  async function movePlaced(id, entry) {
    const base = savedBase();
    if (!base) return { ok: false, reason: 'no layout' };
    const list = Array.isArray(base.placed) ? base.placed : [];
    const next = { ...base, placed: list.some((e) => e && e.id === id) ? list.map((e) => (e && e.id === id ? entry : e)) : [...list, entry] };
    let r = null;
    try { r = await applyPlaced(next); } catch (err) { console.error('arrangement: a placement', err); r = null; }
    if (!r || !r.applied) return { ok: false, reason: r?.reason || 'not applied' };
    saveLayout(next);
    return { ok: true, place: entry.place };
  }
  async function backToGrid(id) {
    const meta = placedMeta.get(id);
    const rec = placedRecs.find((r) => r.id === id);
    if (!meta || !rec) return { ok: false, reason: 'not placed here' };
    const i = layout.slots.findIndex((s, n) => !s && stageEl.querySelector(`[data-slot="${n}"]`));
    if (i < 0) return movePlaced(id, { ...meta.entry, place: 'screen' });
    const cell = stageEl.querySelector(`[data-slot="${i}"]`);
    if (promoted === id) unmarkPromoted();
    placedRecs.splice(placedRecs.indexOf(rec), 1);
    dropDoor(meta);
    meta.door?.remove();
    rec.el.removeAttribute('style');
    moveKeeping(cell, rec.el);
    cell.setAttribute('data-kind', rec.type);
    meta.wrap.remove();
    placedMeta.delete(id);
    const rest = (layout.placed || []).filter((e) => e.id !== id);
    layout = { ...layout, slots: layout.slots.map((s, n) => (n === i ? id : s)) };
    if (rest.length) layout.placed = rest; else delete layout.placed;
    // The slots stay in slot order (the lap runs through them in that order).
    const slotOf = (r) => Number(r.el?.closest?.('.k-cell')?.dataset.slot);
    const after = slotRecs.findIndex((r) => slotOf(r) > i);
    slotRecs.splice(after < 0 ? slotRecs.length : after, 0, rec);
    dropEmptyLayers();
    const base = savedBase();
    if (base) {
      const slots = Array.isArray(base.slots) ? [...base.slots] : [];
      while (slots.length <= i) slots.push(null);
      slots[i] = id;
      const next = { ...base, slots };
      const placed = (Array.isArray(base.placed) ? base.placed : []).filter((e) => e && e.id !== id);
      if (placed.length) next.placed = placed; else delete next.placed;
      saveLayout(next);
    }
    afterMove(id);
    return { ok: true, place: 'slot', slot: i };
  }
  async function placePanel(id, q) {
    const scan = typeof q.scan === 'boolean' ? q.scan : undefined;
    const want = q.place;
    if (want !== undefined && want !== 'overlay' && want !== 'slot') return { ok: false, reason: 'unknown place' };
    if (slotRecs.some((r) => r.id === id)) {
      if (want === 'overlay') return floatFromSlot(id, q, scan);
      // A panel in a grid slot is always a stop in the lap; there is nothing else to change.
      return want === 'slot' && scan === undefined ? { ok: true, place: 'slot' } : { ok: false, reason: 'in a slot' };
    }
    if (want === 'slot') return backToGrid(id);
    const cur = placedMeta.get(id)?.entry;
    if (!cur) return { ok: false, reason: 'not placed here' };
    const entry = { ...cur };
    if (want === 'overlay' && cur.place !== 'overlay') { entry.place = 'overlay'; delete entry.surface; delete entry.slot; }
    if (scan !== undefined) entry.scan = scan;
    return movePlaced(id, entry);
  }
  const offPlaceVerb = typeof bus?.subscribe === 'function' ? bus.subscribe(PLACE_REQUEST_TOPIC, (p) => {
    const q = p && typeof p === 'object' ? p : null;
    const id = q && typeof q.id === 'string' ? q.id : null;
    if (!id || !layout) return;
    if (!slotRecs.some((r) => r.id === id) && !placedRecs.some((r) => r.id === id)) return;   // not ours
    try { q.claim?.(); } catch { /* nobody to tell */ }
    Promise.resolve().then(() => placePanel(id, q)).catch((err) => {
      console.error('arrangement: a panel asking to float', err);
      return { ok: false, reason: 'error' };
    }).then((r) => { try { q.reply?.(r); } catch { /* nobody to tell */ } });
  }) : null;

  async function applyModules() {
    // Only the MODULES are torn down. Their state/events handles go with them, which is right:
    // those are per-instance and the incoming screen has its own.
    // (A panel made bigger is made ordinary first: what fills the dashboard next is a new arrangement.)
    if (promoted) { delete kioskEl.dataset.promotedPanel; promoted = null; }
    destroyRec(stageRec); stageRec = null;
    destroyRec(cameraRec); cameraRec = null;
    destroyRec(clockRec); clockRec = null;
    destroyRec(ambientRec); ambientRec = null;
    while (slotRecs.length) destroyRec(slotRecs.pop());
    teardownPlaced();                       // Stage R: placed modules, the room, and their layers
    stageEl.innerHTML = ''; stageEl.className = 'k-stage'; stageEl.removeAttribute('style');
    mirrorEl.innerHTML = ''; mirrorEl.hidden = true;
    clockEl.innerHTML = ''; clockEl.hidden = true;
    ambientEl.innerHTML = ''; ambientEl.hidden = true;

    partition();
    cameraRec = cameraDef ? await mountOverlay(cameraDef, mirrorEl) : null;
    clockRec = clockDef ? await mountOverlay(clockDef, clockEl) : null;
    ambientRec = ambientDef ? await mountOverlay(ambientDef, ambientEl) : null;
    if (layout) await mountLayout(); else await showPrimary(0);
    renderMods();
    // The instances just changed, so every link's two ends may now resolve differently.
    screenLinks?.sync();
  }

  // *** BRING THE MODULE OF THIS TYPE FORWARD, EXACTLY AS PRESSING ITS CHIP DOES. ***
  // For a host that knows a TYPE ("Trivia") rather than an instance id - `modules.html`'s embed.
  // Resolves true if a panel of that type is now the one the bar is about, false if this screen
  // has no such PANEL. The HUD pair and ambient modules are not panels and have no chip, so they
  // are false here on purpose rather than "handled" by pretending.
  async function showModule(type) {
    if (!type) return false;
    // A module PLACED in a slot is a panel whatever its type -- that is `partition()`'s own rule --
    // so it is looked for first. Only an UNPLACED camera/clock/ambient module is not a panel here.
    if (layout) {
      // (Stage R: a module placed freely is a panel too.)
      const rec = slotRecs.find((r) => r.type === type) || placedRecs.find((r) => r.type === type);
      if (rec) { focusPlaced(rec.id); return true; }
    }
    if (type === 'camera' || type === 'clock' || getManifest(type)?.mount === 'ambient') return false;
    if (layout) {
      const def = unplacedDefs().find((d) => d.type === type);
      if (!def) return false;
      await showUnplaced(def);
      return true;
    }
    const j = stageDefs.findIndex((d) => d.type === type);
    if (j < 0) return false;
    if (j !== primary || !stageRec) await showPrimary(j);   // already showing: do not remount it
    return true;
  }

  // FOCUS IS THE STAGE. In single-stage mode one module is mounted at a time, so "focus
  // the next panel" and "show the next module" are the same act; wiring onChange to
  // showPrimary is what lets ONE switch reach every module on the screen. In a laid-out
  // screen everything is already visible, so focus merely moves.
  // (Stage R: on a laid-out screen the ring is every panel -- `panelRecs()`, overlays first. With
  // nothing placed it is the slots, exactly as it was.)
  // (Row 2.38: a placed module that is a DOOR is reported as type `opens`, so the router routes `select`
  // on it to the door -- see `syncDoor`. Nothing else reads the ring's types.)
  // (2026-10-02: and after the panels, the pieces of the dashboard's ROOM -- see "THE ROOM'S PIECES" below.)
  // (Scoreboard item 5: only the panels IN the lap -- `ringRecs`, see `scanOff`.)
  const focusRing = () => (layout
    ? [...ringRecs().map((r) => ({ id: r.id, type: doorOf(r.id) ? OPENS_TYPE : r.type })),
       ...roomStops().map((s) => ({ id: s.id, type: ROOM_PIECE_TYPE }))]
    : stageDefs.map((d) => ({ id: d.id, type: d.type })));

  // =================================================================================================
  // *** THE ROOM'S PIECES, IN THE SWITCH LAP (2026-10-02). *** Mike's list 09-30: "room objects (2D or 3D)
  // aren't in a switch user's scan on a dashboard yet." Each renderer already had its walk (`scanTargets()`:
  // room_scene.js in Design's order, row by row and left to right; room3d.js its doors left to right as drawn;
  // a flattened room is a 2D room, so its door hotspots come the 2D way) -- but only the room MODULE drove it.
  // Here the dashboard's lap reads it: ONE STOP PER PRESSABLE PIECE, IN THE ROOM'S OWN ORDER, and `select` on
  // a stop is a click on that piece (so a door opens its dashboard, a cabinet lifts, the window opens the
  // weather -- whatever a click does, and nothing a click does not).
  //
  // WHERE IN THE LAP: AFTER THE PANELS. A guess, argued (on Mike's list):
  //   FOR after: (1) the ring already runs front to back -- overlays, the grid, flat on the screen, the scene --
  //   and the room IS the scene, the back of it; (2) focus starts on the first stop, and a door there would make
  //   a stray first press LEAVE the dashboard; (3) the panels are what people come for (photos, a call), so
  //   they should not sit behind six pieces of furniture on every lap; (4) on a dashboard that is mostly room
  //   (Home), there are few panels, so the doors come round almost at once anyway.
  //   AGAINST: on a dashboard whose room is its menu, the doors ARE the point and cost a press per panel first.
  //   The ring is one list in one place (here), so turning it round is a one-line change if Mike wants it.
  //
  // SKIPPED, because pressing them does nothing: anything the room draws as no button at all (a lamp, a 3D
  // piece that is not a door, a hotspot that is not one), and a 2D DISPLAY piece with no module in its slot (it
  // would lift an empty box). NOT stops while a panel fills the dashboard (`promoted`): the room cannot be seen.
  //
  // A STOP'S NAME is `scene:room/<key>`: `o:<object id>` for a piece, `b:<module>` for a book, `back` for a
  // close-up's or a lifted panel's way out -- stable while the piece is there, so focus stays on it across a
  // repaint. A press that CHANGES the room (a close-up, a lifted panel, its way back) takes the pressed stop away;
  // focus then goes on from the room's FIRST stop, which is the way out whenever there is one (the room puts it
  // first), so the next select is "Back" rather than a jump to the first panel.
  // =================================================================================================
  const pieceSubs = new Map();               // stop id -> unsubscribe
  function pieceKey(el, i) {
    if (el.dataset?.id) return `o:${el.dataset.id}`;
    if (el.dataset?.book) return `b:${el.dataset.book}`;
    const obj = el.closest?.('[data-object]')?.dataset?.object;
    if (obj) return `o:${obj}`;
    if (el.classList?.contains('rs-lift-back') || el.classList?.contains('rs-closeup-back')) return 'back';
    return `i:${i}`;
  }
  function pieceDoesSomething(el) {
    if (!el || el.disabled) return false;
    const wrap = el.closest?.('.rs-obj-wrap');
    if (wrap && wrap.dataset.role === 'display') {
      let slot = null;
      try { slot = roomScene?.slots?.().get(wrap.dataset.id) || null; } catch { slot = null; }
      return !!slot?.el?.querySelector?.('.k-pcell');
    }
    return true;
  }
  function roomStops() {
    if (!layout || !roomScene || promoted || typeof roomScene.scanTargets !== 'function') return [];
    let els = [];
    try { els = roomScene.scanTargets() || []; } catch (err) { console.error('arrangement: the room\'s stops', err); return []; }
    const seen = new Set();
    const out = [];
    els.forEach((el, i) => {
      if (!pieceDoesSomething(el)) return;
      let key = pieceKey(el, i);
      if (seen.has(key)) key = `${key}~${i}`;
      seen.add(key);
      const id = `${ROOM_PIECE_PREFIX}${key}`;
      out.push({ id, el });
      if (!pieceSubs.has(id) && bus?.subscribe) {
        const topic = bus.instanceTopic ? bus.instanceTopic(id, ROOM_PIECE_PRESS_TOPIC) : `${ROOM_PIECE_PRESS_TOPIC}#${id}`;
        pieceSubs.set(id, bus.subscribe(topic, () => { pressPiece(id); }));
      }
    });
    return out;
  }
  const isPieceId = (id) => typeof id === 'string' && id.startsWith(ROOM_PIECE_PREFIX);
  function dropPieceSubs() {
    for (const off of pieceSubs.values()) { try { off(); } catch { /* gone */ } }
    pieceSubs.clear();
  }
  /** `select` on a stop: a click on that piece, exactly as a pointer's. True if there was one to press. */
  function pressPiece(id) {
    const stop = roomStops().find((s) => s.id === id);
    if (!stop) return false;
    try { stop.el.click(); } catch (err) { console.error('arrangement: pressing a room piece', err); }
    const now = roomStops();
    const next = now.some((s) => s.id === id) ? id : now[0]?.id;
    if (next && next !== id) { try { runtime()?.router?.setFocus?.(next); } catch { /* focus is not load-bearing */ } }
    if (next) { paintFocus(next); renderMods(); }
    return true;
  }
  /** The ring stop focus is on: the router's, when it is one of the ring's; else the panel `focusedRec` names. */
  function ringFocusId() {
    let id = null;
    try { id = runtime()?.router?.focused?.()?.id || null; } catch { id = null; }
    if (isPieceId(id) && roomStops().some((s) => s.id === id)) return id;
    return focusedRec()?.id || null;
  }

  // =================================================================================================
  // *** WHAT THE BAR AND THE MENU ARE ABOUT WHEN THE SCAN IS ON A PIECE OF THE ROOM (2026-10-02; Mike's
  // list 09-30, "with focus on a piece, the bar and the menu still describe the first panel"). ***
  // `focusedTarget()` is the RING STOP focus is on, described: a panel (`kind: 'panel'`, its record), or a
  // piece of the dashboard's room (`kind: 'piece'`): its words, the element, and its OPTIONS -- the very
  // target edit mode shows for it (`roomTargets`, ca64e17: a piece's "Opens"), or, for a stop that is not
  // an object of its own (a book on the shelf, a close-up's or a lifted panel's way back), the room itself
  // (`whole`: Home's Room rows). One description, so the bar, the menu and edit mode cannot disagree.
  //
  // WHY A SECOND FUNCTION AND NOT A CHANGE TO `focusedRec()`. Argued (the coordinator asked):
  //   FOR changing it: one answer to "what is selected", which is the 09-05 rule.
  //   AGAINST, and it wins: `focusedRec()` answers "WHICH PANEL", and over twenty callers ask exactly that
  //   to ACT on a panel -- Next, Back, Pause, Switch module, bigger, the unplaced swap (`showUnplaced`
  //   needs a slot), the cat, view.js's brief, the placed bar's Switch button (files other agents hold).
  //   A piece is not a panel: it has no state row, no instance, no `<type>/next`. Returning it from
  //   `focusedRec()` would hand all of them a record they would half-understand; returning null would
  //   silently change each of them at once, in files this change does not own. So `focusedRec()` keeps
  //   meaning "the panel", and the places that DESCRIBE the selection (the bar's lit chip, the menu's
  //   subject) or must not act on a panel while a piece is selected read this instead (kiosk.js).
  // =================================================================================================
  function pieceTarget(id) {
    if (!isPieceId(id)) return null;
    const stop = roomStops().find((s) => s.id === id);
    if (!stop) return null;
    const key = id.slice(ROOM_PIECE_PREFIX.length);
    let targets = [];
    try { targets = roomTargets() || []; } catch (err) { console.error('arrangement: a piece\'s options', err); targets = []; }
    const objId = key.startsWith('o:') ? key.slice(2).replace(/~\d+$/, '') : null;
    const own = objId ? targets.find((t) => !t.whole && t.id === objId) || null : null;
    const room = targets.find((t) => t.whole) || null;
    // A stop that is not an object (a book, a way back) is named by its own words, as the room draws them.
    const said = (el) => String(el?.getAttribute?.('aria-label') || el?.title || el?.textContent || '').trim();
    const label = own ? String(own.label || own.id) : (said(stop.el) || (room ? room.label : 'The room'));
    return {
      kind: 'piece', id, label, el: stop.el, rec: roomEditRec(),
      target: own || room, whole: !own, objectId: own ? own.id : null,
    };
  }
  function focusedTarget() {
    const piece = pieceTarget(ringFocusId());
    if (piece) return piece;
    const rec = focusedRec();
    return rec ? { kind: 'panel', id: rec.id, label: rec.title || rec.type, el: rec.el || null, rec } : null;
  }
  /** While the room's own options are still loading (Home's Room rows, the dashboards a piece can open):
   *  a promise that settles when they are in; null when there is nothing to wait for. */
  function roomTargetsPending() {
    const waits = [roomRowsLoading, dashLoading].filter(Boolean);
    return waits.length ? Promise.allSettled(waits).then(() => true) : null;
  }

  // ---- recovery's hands. The ladder that decides when to use them (kiosk.js `recoveryStep`) stays
  // in the shell: it cannot live inside the thing it may have to replace.
  const swappedBack = new Map();          // module id -> the def it replaced

  function recFor(id) {
    if (stageRec?.id === id) return stageRec;
    return slotRecs.find((r) => r.id === id) || placedRecs.find((r) => r.id === id) || null;
  }

  // Put a fresh record where the old one was: the stage, a slot, or (Stage R) a placed module.
  function replaceRec(id, fresh) {
    if (stageRec?.id === id) { stageRec = fresh; return; }
    for (const list of [slotRecs, placedRecs]) {
      const at = list.findIndex((r) => r.id === id);
      if (at >= 0) { list[at] = fresh; return; }
    }
  }

  async function remountPanel(id) {
    const rec = recFor(id);
    if (!rec) return false;
    const def = profile.modules.find((m) => m.id === id) || { id, type: rec.type };
    const host = rec.el;
    destroyRec(rec);
    host.innerHTML = '';
    const fresh = watchRec(await mountInstance(def, host));
    replaceRec(id, fresh);
    return true;
  }

  async function swapPanel(id, toType) {
    const rec = recFor(id);
    if (!rec || !toType) return false;
    const host = rec.el;
    // Remembered so the panel can come BACK. A module that recovers should get its slot
    // again without anybody driving there, and without this the swap is permanent.
    swappedBack.set(id, { id, type: rec.type });
    health().forget(id);
    destroyRec(rec);
    host.innerHTML = '';
    const fresh = watchRec(await mountInstance({ id, type: toType }, host));
    replaceRec(id, fresh);
    return true;
  }

  // =================================================================================================
  // *** "SWITCH MODULE" (2026-10-02). *** Mike: "modules on a dashboard should be as hot swappable as
  // possible. Maybe a switch module button on the transport bar for the selected module."
  //
  // A panel switched to another type KEEPS ITS INSTANCE ID: its place (slot, placement, layer), its chip,
  // its focus, its doors - everything that is about WHERE it is. What changes is the type, and the ROW its
  // settings live in: `<id>--<type>` (`stateKey`, read by both mounting hosts). So, argued:
  //   * THE NEW TYPE STARTS FRESH: a clock does not inherit a photo slideshow's keys from a shared row.
  //   * THE OLD ONE IS KEPT: switching back to the original type reads the panel's own row again, and
  //     back to a type it was switched to before reads that type's row - everything as it was left.
  //     AGAINST: rows that are never cleaned up, one per type a panel was ever switched to. They are
  //     small, and losing somebody's settings because they tried another module for a minute is worse.
  //   * IT IS REMEMBERED, on the dashboard's own settings doc (`panelSwitches: { id: type }`), and
  //     applied whenever the arrangement is given its modules (`setProfile`). FOR: "hot swappable" means
  //     the TV keeps showing what it was switched to; a switch that undoes itself at the next restart is a
  //     control that lies. AGAINST: a stray press changes a saved dashboard for everybody using it -
  //     which is why the list it comes from puts the panel's original module first (kiosk.js), one press.
  //   * NOT RECOVERY'S `swapPanel`, which stays exactly as it was: a temporary fallback that is never
  //     saved, and comes back by itself.
  // =================================================================================================
  const switchKey = (id, type) => `${id}--${type}`.slice(0, 64);
  function readSwitches() {
    let sw = null;
    try { sw = settings?.get?.()?.[PANEL_SWITCHES_KEY]; } catch { sw = null; }
    return sw && typeof sw === 'object' && !Array.isArray(sw) ? sw : {};
  }
  function withSwitches(p) {
    if (!p || !Array.isArray(p.modules)) return p;
    const sw = readSwitches();
    if (!Object.keys(sw).length) return p;
    let changed = false;
    const modules = p.modules.map((m) => {
      const t = m && sw[m.id];
      if (!m || typeof t !== 'string' || !t || t === m.type || !getManifest(t)) return m;
      changed = true;
      return { ...m, type: t, switchedFrom: m.type, stateKey: switchKey(m.id, t) };
    });
    return changed ? { ...p, modules } : p;
  }
  async function switchPanel(id, toType) {
    const rec = recFor(id);
    const def = profile?.modules?.find((m) => m.id === id);
    if (!rec || !def || !toType) return false;
    if (toType === rec.type) return true;
    const base = def.switchedFrom || def.type;
    // An unknown type is refused before anything is torn down (back to what it was is always allowed:
    // it was mounted here before).
    if (toType !== base && !getManifest(toType)) return false;
    const next = toType === base
      ? (() => { const { switchedFrom, stateKey, ...rest } = def; void switchedFrom; void stateKey; return { ...rest, type: base }; })()
      : { ...def, type: toType, switchedFrom: base, stateKey: switchKey(id, toType) };
    const host = rec.el;
    try { health()?.forget?.(id); } catch { /* not load-bearing */ }
    destroyRec(rec);
    host.innerHTML = '';
    let fresh = null;
    try {
      fresh = watchRec(await mountInstance(next, host));
    } catch (err) {
      // The new module would not start: the panel goes back to what it was, so nobody is left with a
      // dead box. (The old one started before; if it now will not either, that is recovery's to handle.)
      console.error(`arrangement: switching to ${toType} failed`, err);
      host.innerHTML = '';
      replaceRec(id, watchRec(await mountInstance(def, host)));
      renderMods();
      return false;
    }
    replaceRec(id, fresh);
    profile = { ...profile, modules: profile.modules.map((m) => (m.id === id ? next : m)) };
    stageDefs = stageDefs.map((d) => (d.id === id ? next : d));
    try {
      const nx = { ...readSwitches() };
      if (toType === base) delete nx[id]; else nx[id] = toType;
      settings?.set?.({ [PANEL_SWITCHES_KEY]: nx });
    } catch (err) { console.error('arrangement: remembering a switch', err); }
    const fid = ringFocusId();
    if (fid) paintFocus(fid);
    renderMods();
    return true;
  }
  /** What a panel was before it was switched (its original type), or its own type. */
  const baseTypeOf = (id) => { const d = profile?.modules?.find((m) => m.id === id); return d ? (d.switchedFrom || d.type) : null; };

  // *** REPLACE ONE SLOT'S MODULE WITH ANOTHER INSTANCE (Home's edit flow, 2026-10-02). *** Not a switch:
  // the slot gets a DIFFERENT instance (its own id and row), and the arrangement's module list and layout
  // say so - the shape the Home page's editor saves. Its caller saves the dashboard; this only mounts.
  async function replaceSlot(oldId, def) {
    const at = slotRecs.findIndex((r) => r.id === oldId);
    if (at < 0 || !def?.id) return false;
    const host = slotRecs[at].el;
    try { health()?.forget?.(oldId); } catch { /* not load-bearing */ }
    destroyRec(slotRecs[at]);
    host.innerHTML = '';
    profile = { ...profile, modules: [...profile.modules.filter((m) => m.id !== oldId), { ...def }] };
    if (layout) layout = { ...layout, slots: layout.slots.map((s) => (s === oldId ? def.id : s)) };
    slotRecs[at] = watchRec(await mountInstance(def, host));
    renderMods();
    return true;
  }

  // ---- MAKE A PANEL BIGGER (the header above PROMOTE_CSS_ID) ---------------------------------------
  let promoted = null;                      // the id filling this dashboard, or null
  let promoteTop = null;                    // the id the SHELL has taken further up (its corner says "smaller")
  // The box a panel's corner sits on, and whether it can fill the dashboard in place.
  function promoteBox(id) {
    if (!layout) return stageRec && stageRec.id === id ? { box: stageEl, fills: false } : null;
    const s = slotRecs.find((r) => r.id === id);
    if (s) { const cell = s.el?.closest?.('.k-cell'); return cell ? { box: cell, fills: true } : null; }
    const m = placedMeta.get(id);
    if (m && placedRecs.some((r) => r.id === id)) return { box: m.wrap, fills: m.where === 'flat' };
    return null;
  }
  function unmarkPromoted() {
    if (!promoted) return;
    const pb = promoteBox(promoted);
    if (pb) delete pb.box.dataset.promoted;
    delete kioskEl.dataset.promotedPanel;
    const rec = recFor(promoted);
    promoted = null;
    try { rec?.instance?.onResize?.(); } catch { /* not load-bearing */ }
  }
  /** Fill this dashboard with panel `id`. `{ level: 'dashboard' }` if it now does; `{ level: 'top' }` when
   *  it already fills it (or cannot in place -- a room's module), so the shell takes the next level up;
   *  null when `id` is not a panel here. */
  function promote(id) {
    const pb = promoteBox(id);
    if (!pb) return null;
    if (!pb.fills || promoted === id) return { level: 'top', id };
    unmarkPromoted();
    promoted = id;
    pb.box.dataset.promoted = '1';
    kioskEl.dataset.promotedPanel = id;
    try { recFor(id)?.instance?.onResize?.(); } catch { /* not load-bearing */ }
    renderMods();
    return { level: 'dashboard', id };
  }
  /** One level down, at this dashboard: true if a panel stopped filling it. */
  function demote() {
    if (!promoted) return false;
    unmarkPromoted();
    renderMods();
    return true;
  }
  /** The shell's level above this one: the panel it took up (its corner then reads "smaller"), or null. */
  function setPromoteTop(id) { promoteTop = id || null; try { ensureCorners(); } catch { /* not load-bearing */ } }
  // The room's own ✎ corner (edit mode on the dashboard's room, ROOM_PANEL_ID): bottom right of the room,
  // shown on hover or focus as a panel's is. Only while the scene is a mounted room.
  function ensureRoomCorner() {
    if (!corners || typeof document === 'undefined' || !roomHost) return;
    let e = roomHost.querySelector(':scope > .k-editc');
    if (!editCornerOn() || !roomEditRec()) { e?.remove(); return; }
    if (!e) {
      ensureEditCss(document);
      e = document.createElement('button');
      e.type = 'button';
      e.className = 'k-editc';
      e.textContent = '✎';
      e.dataset.for = ROOM_PANEL_ID;
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        try { bus?.publish?.(EDIT_PANEL_TOPIC, { id: ROOM_PANEL_ID, from: 'corner' }); } catch (err) { console.error('arrangement: edit the room', err); }
      });
      roomHost.append(e);
    }
    const editing = editMode?.active()?.id === ROOM_PANEL_ID;
    const say = editing ? 'Stop editing the room' : 'Edit the room: press a piece of furniture, or the walls, to see its options';
    e.setAttribute('aria-label', say);
    e.setAttribute('aria-pressed', String(editing));
    e.title = say;
  }
  function ensureCorners() {
    if (!corners || typeof document === 'undefined') return;
    try { ensureRoomCorner(); } catch (err) { console.error('arrangement: the room corner', err); }
    const want = layout ? [...slotRecs, ...placedRecs] : [stageRec].filter(Boolean);
    if (!want.length) return;
    ensurePromoteCss();
    for (const r of want) {
      const pb = promoteBox(r.id);
      // A module in a room keeps the room's own close-up (see the header): no corner.
      if (!pb || (layout && !pb.fills)) continue;
      let b = pb.box.querySelector(':scope > .k-promote');
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'k-promote';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          try { bus?.publish?.(SHELL_PROMOTE, { id: b.dataset.for, from: 'corner' }); } catch (err) { console.error('arrangement: promote', err); }
        });
        pb.box.append(b);
      }
      const top = promoteTop === r.id;
      const t = r.title || r.type;
      b.dataset.for = r.id;
      b.textContent = top ? '⤡' : '⤢';
      const say = top ? `Make ${t} smaller` : promoted === r.id ? `Make ${t} fill the screen` : `Make ${t} bigger`;
      b.setAttribute('aria-label', say);
      b.title = say;
      // THE ✎ CORNER (2026-10-02, edit_mode.js): beside ⤢, shown when it is; pressing it edits this panel
      // (or stops). It SAYS what was pressed on the bus, so the corner, a menu row and a switch are one press.
      let e = pb.box.querySelector(':scope > .k-editc');
      if (!editCornerOn()) { e?.remove(); continue; }
      if (!e) {
        ensureEditCss(document);
        e = document.createElement('button');
        e.type = 'button';
        e.className = 'k-editc';
        e.textContent = '✎';
        e.addEventListener('click', (ev) => {
          ev.stopPropagation();
          try { bus?.publish?.(EDIT_PANEL_TOPIC, { id: e.dataset.for, from: 'corner' }); } catch (err) { console.error('arrangement: edit', err); }
        });
        pb.box.append(e);
      }
      e.dataset.for = r.id;
      const editing = editMode?.active()?.id === r.id;
      const sayE = editing ? `Stop editing ${t}` : `Edit ${t}: press a thing in it to see its options`;
      e.setAttribute('aria-label', sayE);
      e.setAttribute('aria-pressed', String(editing));
      e.title = sayE;
    }
  }

  // ---- EDIT MODE (edit_mode.js) ----------------------------------------------------------------------
  // One panel of this dashboard at a time. Built only where there is a page to draw on, and only for a
  // dashboard that draws corners (a NESTED one is pressed as one thing: going in is how its panels are
  // edited, as it is how they are reached).
  const editCornerOn = () => { try { return editSettingsFrom(settings?.get?.() || {}).corner; } catch { return true; } };
  const editPanels = () => [...(layout ? [...slotRecs, ...placedRecs] : [stageRec]), roomEditRec()].filter(Boolean);

  // ---- THE DASHBOARD'S ROOM, EDITED IN PLACE (2026-10-02) ---------------------------------------------
  // Mike: "click on a button or piece of furniture or whatever else and have access to any options for it."
  // A dashboard whose scene is a room (Design's 2D room, or room3d.js) offers the ROOM as one more thing to
  // edit, beside its panels: `ROOM_PANEL_ID`, with its own ✎ corner (bottom right of the room, on hover) and
  // the same verb (`shell/edit-panel { id: 'scene:room' }`). While it is being edited:
  //   * a press on a piece of furniture CHOOSES it and never opens its door; its option is the one the map
  //     editor's Opens window already edits -- which dashboard it opens (room_doors.js `withDoor`), applied
  //     in place (`applyPlaced`, no rebuild) and saved where the editor saves it (`layoutStore`);
  //   * a press on the walls or the floor chooses the room itself: Home's Room rows (home_profile.js
  //     SCENE_ROWS -- shape, walls, floor, light, window; a 3D room's drift and depth), written the way
  //     Home writes them (`setRoomRow`). A row change IS a new room, so the room is drawn again and the
  //     modules in it are moved into the new one (re-parented, never remounted);
  //   * a module sitting in the room is not the room: a press on it reaches it (`passThrough`).
  // Its colours, sizes and places are NOT rows (nothing anywhere sets them yet), so none is offered here.
  let roomRec = null;                      // { rec, scene }: rebuilt when the room is drawn again
  let roomRowsLib = null;                   // home_profile.js, loaded the first time the room is edited
  let roomRowsLoading = null;
  let dashChoices = null;                   // [{ id, name }] for "Opens", fetched the first time
  let dashLoading = null;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const is3dScene = (s) => !!s && s.kind === 'room3d';
  /** The layout as SAVED when the host says, else the one mounted (both include the scene as drawn). */
  function roomBase() {
    let raw = null;
    try { raw = layoutStore?.get?.() || null; } catch { raw = null; }
    if (raw && raw.scene && layout && layout.scene && raw.scene.kind === layout.scene.kind) return clone(raw);
    return layout ? clone(layout) : null;
  }
  const reselectRoom = () => {
    const a = editMode?.active();
    if (a && a.id === ROOM_PANEL_ID) { try { editMode.select(a.target); } catch { /* gone */ } }
  };
  function loadRoomRows() {
    if (roomRowsLib || roomRowsLoading) return;
    roomRowsLoading = import('./home_profile.js').then((m) => { roomRowsLib = m; reselectRoom(); })
      .catch((err) => { console.error('arrangement: room rows', err); })
      .finally(() => { roomRowsLoading = null; });
  }
  function loadDashChoices() {
    if (dashChoices || dashLoading || typeof listDashboards !== 'function') return;
    dashLoading = Promise.resolve().then(() => listDashboards()).then((list) => {
      dashChoices = (Array.isArray(list) ? list : []).filter((d) => d && d.id).map((d) => ({ id: String(d.id), name: String(d.name || d.id) }));
      reselectRoom();
    }).catch(() => { dashChoices = null; }).finally(() => { dashLoading = null; });
  }
  /** What a room object opens, as a settings field: Nothing, or one of the person's other dashboards. */
  function opensField(current) {
    const here = (() => { try { return profileId() || null; } catch { return null; } })();
    const opts = [{ value: '', label: 'Nothing' }];
    for (const d of dashChoices || []) if (d.id !== here) opts.push({ value: d.id, label: d.name });
    if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: current });
    return { key: 'opens', label: 'Opens', kind: 'choice', default: '', level: 'essential', options: opts };
  }
  /** A changed room scene, applied and saved. Doors move in place; anything else redraws the room. */
  async function writeRoomScene(scene) {
    const base = roomBase();
    if (!base || !scene) return false;
    const next = { ...base, scene };
    let r = null;
    try { r = await applyPlaced(next); } catch (err) { console.error('arrangement: room', err); r = null; }
    if (!r || !r.applied) await redrawRoom(next);
    try { layoutStore?.save?.(next); } catch (err) { console.error('arrangement: saving the room', err); }
    reselectRoom();
    return true;
  }
  /**
   * The room drawn again from a new scene (a Room row changed), and every module placed in it MOVED into the
   * new one: their boxes are re-parented, never remounted.
   * (2026-10-02, Mike's list 09-30 ~row 1325: "Changing a Room row reloads a video sitting in the room.") The
   * OLD room now stays in the page, its modules still in it, until the new one is drawn beside it; each box is
   * then moved from one place in the page to the other (`moveKeeping`), never taken out, so an embedded video
   * carries on. Only then does the old room go. (Before, the boxes were taken out first and put back after,
   * and an iframe taken out of the page reloads.) The two rooms overlap for the one step between, in the same
   * layer, the new one on top.
   */
  async function redrawRoom(nextRaw) {
    if (!layout || !profile) return false;
    const r = resolveLayout(nextRaw, profile.modules);
    if (!r || !isRoomScene(r.scene)) return false;
    const oldScene = roomScene, oldHost = roomHost;
    dropPieceSubs();
    roomScene = null; roomFree = null; roomHost = null;
    layout = { ...layout, scene: r.scene };
    try {
      await mountRoom();
      for (const [id, m] of placedMeta) {
        if (m.where === 'flat') continue;
        // A new room that would not draw leaves `roomScene` null: the box goes flat on the scene layer, as at a boot.
        const { el, where } = containerFor(m.entry);
        moveKeeping(el, m.wrap);
        styleWrap(m.wrap, m.entry, where);
        m.where = where;
        try { placedRecs.find((x) => x.id === id)?.instance?.onResize?.(); } catch { /* not load-bearing */ }
      }
    } finally {
      // The old room goes whatever happened above, so the screen is not left showing two rooms.
      try { oldScene?.destroy(); } catch { /* already gone */ }
      try { if (oldHost && oldHost !== roomHost) oldHost.remove(); } catch { /* already gone */ }
    }
    renderMods();
    return true;
  }
  function roomEditRec() {
    if (!roomScene || !roomHost || !layout || !isRoomScene(layout.scene)) { roomRec = null; return null; }
    if (roomRec && roomRec.scene === roomScene) return roomRec.rec;
    const three = is3dScene(layout.scene);
    const rec = {
      id: ROOM_PANEL_ID, type: three ? 'room3d' : 'room-scene', title: three ? '3D room' : 'Room',
      el: roomHost, passThrough: '.k-pcell',
      instance: { editTargets: () => roomTargets() },
      // No state row of its own: every target reads and writes the layout.
      state: { get: () => ({}), set: () => {} },
    };
    roomRec = { rec, scene: roomScene };
    return rec;
  }
  function roomTargets() {
    if (!roomScene) return [];
    loadRoomRows();
    loadDashChoices();
    let objs = [];
    try { objs = roomScene.objectEls?.() || []; } catch { objs = []; }
    const out = objs.filter((o) => o && o.el).map((o) => ({
      id: o.id, label: o.name, el: o.el, also: o.also || [],
      help: `${o.name}: which dashboard it opens when it is pressed, or nothing.`,
      fields: [opensField((sceneDoors(roomBase()?.scene || null) || {})[o.id] || '')],
      values: () => ({ opens: (sceneDoors(roomBase()?.scene || null) || {})[o.id] || '' }),
      set: (patch) => {
        if (!patch || !('opens' in patch)) return;
        const base = roomBase();
        const s = base && withDoor(base.scene, o.id, patch.opens || null);
        if (s) writeRoomScene(tidyScene(s));
      },
    }));
    // The walls and the floor: the room itself, last (it holds everything above).
    const root = roomScene.root || roomHost;
    const rows = () => { try { return roomRowsLib ? roomRowsLib.roomRows(roomBase()) : []; } catch { return []; } };
    const three = is3dScene(layout?.scene);
    const lib = roomRowsLib;
    const fieldRows = lib ? (three ? lib.ROOM3D_ROWS : lib.ROOM_ROWS) : [];
    out.push({
      id: 'room', label: 'The room', el: root, whole: true,
      help: three ? 'The room itself: whether the camera drifts, and how deep the room is.'
        : 'The room itself: its shape, its walls and floor, its light, and what is out of the window.',
      fields: fieldRows.map((row) => ({ key: row.key, label: row.label, kind: 'choice', level: 'essential',
        default: row.options()[0]?.[0], options: row.options().map(([value, label]) => ({ value, label })) })),
      values: () => Object.fromEntries(rows().map((x) => [x.key, x.value])),
      set: (patch) => {
        if (!lib || !patch) return;
        let L = roomBase();
        for (const [k, v] of Object.entries(patch)) { const n = L && lib.setRoomRow(L, k, v); if (n) L = n; }
        if (L && L.scene) writeRoomScene(L.scene);
      },
    });
    return out;
  }

  const editMode = corners && typeof document !== 'undefined' ? createEditMode({
    bus, doc: document,
    recs: editPanels,
    boxOf: (id) => (id === ROOM_PANEL_ID ? roomHost : null) || promoteBox(id)?.box || recFor(id)?.el || null,
    settings: () => { try { return settings?.get?.() || {}; } catch { return {}; } },
    onChange: () => { try { ensureCorners(); } catch { /* not load-bearing */ } },
  }) : null;
  // `shell/edit-panel { id?, on? }`: a panel of THIS dashboard (another dashboard's id is not ours), or,
  // with no id, the focused one. `on` absent toggles.
  // (2026-10-02: with the scan on a piece of the room and no id, it is the ROOM that is edited, that piece
  // chosen -- `focusedTarget`, so "Edit" means what the bar and the menu say is selected. `target`: the
  // thing to choose once editing, as a piece's own menu row asks.)
  const offEditVerb = editMode && typeof bus?.subscribe === 'function' ? bus.subscribe(EDIT_PANEL_TOPIC, (p) => {
    const q = p && typeof p === 'object' ? p : {};
    let id = q.id || null;
    let pick = typeof q.target === 'string' ? q.target : null;
    if (!id && q.on !== false) {
      let t = null;
      try { t = focusedTarget(); } catch { t = null; }
      if (t && t.kind === 'piece' && t.rec) { id = ROOM_PANEL_ID; pick = pick || t.objectId; }
    }
    if (!id) id = (q.on === false ? editMode.active()?.id : focusedRec()?.id) || null;
    if (!id || !editPanels().some((r) => r.id === id)) return;
    if (q.on === false) { if (editMode.active()?.id === id) editMode.leave('verb'); return; }
    if (q.on === true) editMode.enter(id); else editMode.toggle(id);
    if (pick && editMode.active()?.id === id) { try { editMode.select(pick); } catch { /* not one of its things */ } }
  }) : null;
  /** Edit panel `id` (on true), stop (false), or toggle (undefined). True if `id` is a panel here. */
  function editPanel(id, on) {
    if (!editMode || !id || !editPanels().some((r) => r.id === id)) return false;
    if (on === false) { if (editMode.active()?.id === id) editMode.leave('call'); return true; }
    return on === true ? editMode.enter(id) : (editMode.toggle(id), true);
  }

  // Every mounted record, and the links runner. The shell tears down everything else.
  function destroy() {
    try { offEditVerb?.(); editMode?.destroy(); } catch { /* already gone */ }
    try { offPlaceVerb?.(); } catch { /* already gone */ }
    screenLinks?.destroy();
    destroyRec(stageRec); destroyRec(cameraRec); destroyRec(clockRec); destroyRec(ambientRec);
    while (slotRecs.length) destroyRec(slotRecs.pop());
    teardownPlaced();
  }

  return {
    // ---- the state, read through functions: a swap replaces what they return ----
    profile: () => profile,
    layout: () => layout,
    stageDefs: () => stageDefs,
    primary: () => primary,
    stageRec: () => stageRec,
    slotRecs,                          // the live array: mutated in place, never replaced
    placedRecs,                        // Stage R: the same, for modules placed freely
    placed: () => placedOf().map((e) => ({ ...e })),
    // Row 2.38: which dashboard a placed module opens (null: it is not a door), and pressing it.
    opensOf: (id) => doorOf(id),
    openDoor: (id) => openDoor(id, 'call'),
    // Row 2.38, the map editor: the room's objects (not the modules in it) and the door each one is,
    // while this dashboard's scene is a mounted room; [] otherwise.
    roomObjects: () => { try { return roomScene?.objects?.() || []; } catch { return []; } },
    panelRecs,                         // every panel on a laid-out screen, in ring order
    roomScene: () => roomScene,        // the room renderer, while the dashboard's scene is a room
    cameraRec: () => cameraRec,
    clockRec: () => clockRec,
    ambientRec: () => ambientRec,
    screenLinks,                       // null on an embed, or never built
    // What `partition()` decided would be the HUD, before anything mounts (Stage 2: view.js's pure
    // `partition` export answers from this rather than keeping a second copy of the rule).
    hudDefs: () => ({ camera: cameraDef, clock: clockDef, ambient: ambientDef }),
    // ---- changing what is on the screen ----
    // (2026-10-02: with any panel switches this dashboard remembers applied - see `switchPanel`.)
    setProfile(next) { profile = withSwitches(next); },
    resolve,
    partition,
    mountOverlays,
    mountLayout,
    mountPlaced,
    applyPlaced,
    showPrimary,
    applyModules,
    // ---- focus: which panel the bar, the ring and the menu are about ----
    focusedRec,
    // (2026-10-02: the stop focus is on, panel OR piece of the room -- see "WHAT THE BAR AND THE MENU ARE ABOUT".)
    focusedTarget,
    pieceTarget,
    roomTargetsPending,
    focusPlaced,
    focusRing,
    paintFocus,
    unplacedDefs,
    showUnplaced,
    showModule,
    instanceTitle,
    // ---- recovery's hands (the ladder that calls them stays in the shell) ----
    recFor,
    remountPanel,
    swapPanel,
    // ---- "Switch module" and Home's replace (2026-10-02) ----
    switchPanel,
    baseTypeOf,
    replaceSlot,
    // ---- make a panel bigger (2026-10-02; the header above PROMOTE_CSS_ID) ----
    promote,
    demote,
    promotedId: () => promoted,
    setPromoteTop,
    // ---- edit any module in place (2026-10-02; edit_mode.js) ----
    editPanel,
    editing: () => editMode?.active() || null,
    editSelect: (targetId = null) => editMode?.select(targetId) || null,
    editSelection: () => editMode?.selection() || null,
    // The room's slots (room_scene.js `slots()`), while the scene is a mounted room; an empty Map otherwise.
    roomSlots: () => { try { return roomScene?.slots?.() || new Map(); } catch { return new Map(); } },
    // ---- the mirror/clock corners ----
    applyLayout,
    patchMirror,
    cycleMirrorSize,
    cycleMirrorCorner,
    destroy,
  };
}
