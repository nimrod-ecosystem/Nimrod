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
  normalizeLayout, isArranged, resolveLayout, gridStyle, slotStyle, placedGeometry, layoutChange,
} from './layout.js';

// Re-exported so the shell (kiosk.js already imports this file) can classify a change without a new
// import line.
export { layoutChange };
import { getManifest } from './module.js';
import { writePosition } from './restart.js';
import { createScreenLinks } from './screen_links.js';

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
  mountInstance, destroyRec, watchRec = (rec) => rec, renderMods = () => {},
  // GETTERS, NOT VALUES. Each is built or changed by the shell AFTER this factory exists -- the input
  // runtime, the health watch, the screen id a swap changes -- so a value captured here would be null
  // (or the boot screen's) forever. The same reason kiosk.js's `childCtx` hands modules getters.
  runtime = () => null, health = () => null, profileId = () => null,
  // The screen's flash limit (flash_limit.js), a getter, for the dashboard's room. Absent: the room uses 3.
  flashLimit = undefined,
} = {}) {
  // THE ARRANGEMENT'S OWN STATE (see the header). Set by `setProfile` and `resolve`, read by every
  // caller through `arr.profile()` / `arr.layout()`.
  let profile = null;
  let layout = null;

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
    const first = panelRecs()[0];
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
    return all.find((r) => r.id === id) || all[0];
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
    paintFocus(id);
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
  let roomFree = null;                      // the layer on the room's stage for freely placed modules
  let placedMounted = false;                // mountPlaced ran for this arrangement (applyPlaced's guard)
  const LAYER_Z = {
    scene: 'calc(var(--z-ambient, 100) + 50)',
    screen: 'calc(var(--z-panels, 200) + 50)',
    overlay: 'var(--z-floating, 400)',
  };
  const placedOf = () => (layout && layout.placed) || [];

  // Every panel on a laid-out screen, in RING ORDER: overlays first (Design: an overlay "takes the scan
  // first"), then the slots, then flat-on-screen, then the scene. With nothing placed: `slotRecs`.
  function panelRecs() {
    if (!placedRecs.length) return slotRecs.slice();
    const by = (place) => placedOf().filter((e) => e.place === place)
      .map((e) => placedRecs.find((r) => r.id === e.id)).filter(Boolean);
    return [...by('overlay'), ...slotRecs, ...by('screen'), ...by('scene')];
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
    if (!scene || scene.kind !== 'room' || roomScene) return;
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

  async function mountPlacedOne(entry) {
    const def = profile.modules.find((m) => m.id === entry.id);
    if (!def) return null;
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
    const host = document.createElement('div'); host.className = 'k-mod';
    host.style.cssText = 'flex:1;min-width:0;min-height:0';
    wrap.append(host);
    // The same rule as a slot: one module that will not start is one broken box, not a broken screen.
    try {
      const rec = watchRec(await mountInstance(def, host));
      placedRecs.push(rec);
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
    if (!placedOf().length && !(layout.scene && layout.scene.kind === 'room')) return;
    await mountRoom();
    for (const entry of placedOf()) await mountPlacedOne(entry);
  }

  function removePlaced(id) {
    const at = placedRecs.findIndex((r) => r.id === id);
    if (at >= 0) destroyRec(placedRecs.splice(at, 1)[0]);
    placedMeta.get(id)?.wrap.remove();
    placedMeta.delete(id);
  }

  function teardownPlaced() {
    while (placedRecs.length) destroyRec(placedRecs.pop());
    placedMeta.clear();
    try { roomScene?.destroy(); } catch { /* already gone */ }
    roomScene = null; roomFree = null;
    for (const k of Object.keys(placedLayers)) { placedLayers[k].remove(); delete placedLayers[k]; }
    placedMounted = false;
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
   * Resolves `{ applied, moved, added, removed }` (id lists), or `{ applied: false, reason }`.
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
    if (!r || !cur || r.preset !== cur.preset || JSON.stringify(r.scene || null) !== JSON.stringify(cur.scene || null)) {
      return { ...none, reason: 'grid' };
    }
    // The mounted slots, with the new placement (one place per instance: a placed id in a slot is dropped).
    const inSlots = new Set(cur.slots.filter(Boolean));
    const nextPlaced = (r.placed || []).filter((e) => !inSlots.has(e.id));
    const l = { ...cur };
    delete l.placed;
    if (nextPlaced.length) l.placed = nextPlaced;
    if (!isArranged(l)) return { ...none, reason: 'grid' };
    if (!placedMounted) { layout = l; return { ...none, applied: true, deferred: true }; }
    const before = new Map(placedOf().map((e) => [e.id, e]));
    const after = l.placed || [];
    const keep = new Set(after.map((e) => e.id));
    const out = { applied: true, moved: [], added: [], removed: [] };
    for (const id of before.keys()) if (!keep.has(id)) { removePlaced(id); out.removed.push(id); }
    layout = l;
    if (after.length || (l.scene && l.scene.kind === 'room')) await mountRoom();
    for (const entry of after) {
      const meta = placedMeta.get(entry.id);
      if (!meta) { await mountPlacedOne(entry); out.added.push(entry.id); continue; }
      if (JSON.stringify(meta.entry) === JSON.stringify(entry)) continue;
      const { el, where } = containerFor(entry);
      if (meta.wrap.parentNode !== el) el.append(meta.wrap);          // re-parented, not remounted
      meta.wrap.dataset.place = entry.place;
      styleWrap(meta.wrap, entry, where);
      const rec = placedRecs.find((r) => r.id === entry.id);
      const wasShown = meta.entry.shown !== false, isShown = entry.shown !== false;
      if (rec && wasShown !== isShown) {
        try { (isShown ? rec.instance?.onShow : rec.instance?.onHide)?.call(rec.instance); } catch { /* not load-bearing */ }
      }
      try { rec?.instance?.onResize?.(); } catch { /* not load-bearing */ }
      meta.entry = entry; meta.where = where;
      out.moved.push(entry.id);
    }
    // Empty layers go, so a screen whose last overlay was removed has no empty overlay layer.
    for (const k of Object.keys(placedLayers)) {
      if (k === 'scene' && roomScene) continue;
      if (!placedLayers[k].children.length) { placedLayers[k].remove(); delete placedLayers[k]; }
    }
    const f = focusedRec();
    if (f) paintFocus(f.id);
    renderMods();
    return out;
  }

  async function applyModules() {
    // Only the MODULES are torn down. Their state/events handles go with them, which is right:
    // those are per-instance and the incoming screen has its own.
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
  const focusRing = () => (layout
    ? panelRecs().map((r) => ({ id: r.id, type: r.type }))
    : stageDefs.map((d) => ({ id: d.id, type: d.type })));

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

  // Every mounted record, and the links runner. The shell tears down everything else.
  function destroy() {
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
    setProfile(next) { profile = next; },
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
    // ---- the mirror/clock corners ----
    applyLayout,
    patchMirror,
    cycleMirrorSize,
    cycleMirrorCorner,
    destroy,
  };
}
