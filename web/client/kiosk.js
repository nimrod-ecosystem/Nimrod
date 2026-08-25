// kiosk.js — the full-screen PRODUCT surface (as opposed to index.html, the dev
// harness). It opens ONE profile full-screen, caregiver-driven by keyboard + mouse
// (the patient isn't controlling it yet), with:
//
//   * a big STAGE that shows one module at a time (photos / youtube / the Lineup
//     director / …), switchable with number keys or the on-screen dots;
//   * persistent HUD OVERLAYS — the camera self-view "mirror" and a translucent
//     clock — mounted ONCE and left running while the stage changes. The model is
//     "one content surface + a small HUD", not the old four-quadrant split.
//   * MIRROR MODE (C): the camera fills the whole screen; press again to return.
//   * an auto-hiding control bar (mouse).
//
// LAYOUT IS PER-PROFILE DATA. The mirror's SIZE + CORNER and the clock's CORNER live
// in the profile `settings` blob (the same one that carries theme + voice), so they
// re-render for free and can be tuned at the bedside — `[`/`]` resize the mirror,
// `\` cycles its corner, and the choice persists to the profile. Defaults: a large
// mirror top-right, the clock bottom-left.
//
// Stage modules are mounted LAZILY (only the visible one is live, so a hidden
// youtube/director isn't playing audio behind the scenes); the HUD overlays are the
// exception. Reuses the exact runtime + container ctx the harness uses, so a Lineup
// director works here. Resilience: state handles + the profile fetch are cached, so a
// brief server outage doesn't blank the screen (the media agent is local).

import { createBus } from './bus.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createProfilesClient } from './profile.js';
import { mountModule } from './module.js';
import { normalizeLayout, isArranged, gridStyle, slotStyle } from './layout.js';
import { mountSettings } from './settings.js';
import { mountInputRuntime, INPUTS_KEY } from './input_runtime.js';
import { DEFAULT_BINDINGS } from './input_keyboard.js';
import { readConfig, writeConfig, writePosition, bootPlan, markHopped, hasHopped,
         restartItems } from './restart.js';
import { takePreviewLayout } from './preview.js';
import { applyTheme } from './theme.js';
import { cachedFetch } from './cache.js';
import './modules/clock.js';
import './modules/camera.js';
import './modules/photos.js';
import './modules/youtube.js';
import './modules/personal.js';
import './modules/educational.js';
import './modules/director.js';
import './modules/sprint.js';
import './modules/quests.js';
import './modules/progress.js';
import './modules/wordforge.js';
import './modules/lessons.js';
import './modules/algebra.js';

const MIRROR_SIZES = ['sm', 'md', 'lg'];
const CORNERS = ['tr', 'br', 'bl', 'tl'];
const KDEF = { mirror: { size: 'lg', corner: 'tr' }, clock: { corner: 'bl' } };
const wrap = (i, n) => ((i % n) + n) % n;

// Mount a kiosk for one profile into `root`. Returns a small control handle
// (also used by the dev test). `profiles`/`bus` are injectable.
// `makeState` / `makeEvents` / `sources` are injectable for the same reason home.html needs
// them: signed out, there is no server to hold any of this, and the kiosk has to run anyway.
// Default to the server-backed handles so every existing caller is unchanged.
export async function mountKiosk(root, {
  user, profileId, profiles, bus, makeState = null, makeEvents = null, sources = null,
  // Seams for the restart behaviour: the test needs its own storage and must never be
  // navigated away from mid-run.
  storage = undefined, session = undefined,
  navigate = (url) => { if (typeof location !== 'undefined') location.replace(url); },
} = {}) {
  bus = bus || createBus();
  // Read before anything else renders: if this screen is not where the device is meant to
  // come back to, the cheapest possible outcome is to leave before mounting a whole kiosk.
  let restart = readConfig(user, storage);
  profiles = profiles || createProfilesClient({ user });

  root.innerHTML = `
    <div class="kiosk">
      <div class="k-stage" data-stage></div>
      <div class="k-mirror" data-mirror hidden></div>
      <div class="k-clock" data-clock hidden></div>
      <div class="k-controls" data-controls>
        <div class="k-mods" data-mods></div>
        <div class="k-actions">
          <button data-act="home" title="back to your screens (H)">⌂ Screens</button>
          <button data-act="next" title="next (→ / space)">Next ▸</button>
          <button data-act="mirror" title="mirror mode (C) — camera full screen">Mirror</button>
          <button data-act="settings" title="settings (Esc or M)">⚙</button>
          <button data-act="fs" title="fullscreen (F)">⛶</button>
        </div>
      </div>
      <div data-settings></div>
    </div>`;
  const kioskEl = root.querySelector('.kiosk');
  const stageEl = root.querySelector('[data-stage]');
  const mirrorEl = root.querySelector('[data-mirror]');
  const clockEl = root.querySelector('[data-clock]');
  const controlsEl = root.querySelector('[data-controls]');
  const modsEl = root.querySelector('[data-mods]');

  const ck = (key) => `${user}:${profileId}:${key}`;   // resilience cache key per handle

  const stateFor = (key, opts = {}) => (makeState
    ? makeState(key, opts, profileId)
    : createState({ url: profiles.stateURL(profileId, key), user, cacheKey: ck(key), ...opts }));
  const eventsFor = (key, opts = {}) => (makeEvents
    ? makeEvents(key, opts, profileId)
    : createEvents({ url: profiles.eventsURL(profileId, key), user, ...opts }));

  const childCtx = (mod) => ({
    bus, user, profileId,
    rootBus: bus, instanceId: mod.id,
    ...(sources ? { sources } : {}),
    makeState: (key, opts) => stateFor(key, opts),
    makeEvents: (key, opts) => eventsFor(key, opts),
  });

  async function mountInstance(mod, host) {
    const state = stateFor(mod.id);
    const events = eventsFor(mod.id);
    const instance = mountModule(mod.type, { mount: host, state, events, ...childCtx(mod) });
    await state.load().catch(() => {});
    await events.load().catch(() => {});
    instance.init();
    state.startPolling(); events.startPolling();
    return { instance, state, events, type: mod.type, id: mod.id, title: instance.manifest.title, el: host };
  }
  function destroyRec(rec) {
    if (!rec) return;
    try { rec.instance.destroy(); } catch { /* noop */ }
    rec.state.destroy?.(); rec.events.destroy?.();
  }

  // ---- per-profile settings: theme + the kiosk LAYOUT (data-driven) --------
  const settings = stateFor('settings');
  function applyLayout(s) {
    const k = (s && s.kiosk) || {};
    const m = { ...KDEF.mirror, ...(k.mirror || {}) };
    const c = { ...KDEF.clock, ...(k.clock || {}) };
    kioskEl.dataset.mirrorSize = MIRROR_SIZES.includes(m.size) ? m.size : KDEF.mirror.size;
    kioskEl.dataset.mirrorCorner = CORNERS.includes(m.corner) ? m.corner : KDEF.mirror.corner;
    kioskEl.dataset.clockCorner = CORNERS.includes(c.corner) ? c.corner : KDEF.clock.corner;
  }
  await settings.load().catch(() => {});
  applyTheme(document.documentElement, settings.get().theme);
  applyLayout(settings.get());
  settings.subscribe((s) => { applyTheme(document.documentElement, s.theme); applyLayout(s); });
  settings.startPolling();

  // persist a mirror change into the profile settings (merges with theme/voice/clock)
  function patchMirror(patch) {
    const cur = settings.get().kiosk || {};
    settings.set({ kiosk: { ...cur, mirror: { ...KDEF.mirror, ...(cur.mirror || {}), ...patch } } });
  }

  // ---- partition modules: camera -> mirror, clock -> clock HUD, rest -> stage
  // cached so a server blip at boot still yields the last-known dashboard layout.
  const profile = makeState
    ? await profiles.get(profileId)        // local backend: it IS the source of truth
    : await cachedFetch(`profile:${user}:${profileId}`, () => profiles.get(profileId));

  // A LAYOUT, if the composer saved one. It wins for whatever it places: a module sitting
  // in a slot is rendered there, so camera/clock only fall back to being HUD overlays when
  // they were NOT placed. With no layout, everything below behaves exactly as it did
  // before this existed — every screen made before the composer keeps working.
  // A PREVIEW layout, if the composer sent one. It is a ONE-SHOT handoff in sessionStorage:
  // read once, cleared immediately, never written to the profile. This is what lets someone
  // try an arrangement — or swap to one temporarily — without committing it, which the
  // composer's save-then-open behaviour otherwise took away.
  const previewLayout = takePreviewLayout(profileId);

  const savedLayout = previewLayout || (settings.get().kiosk || {}).layout;
  const layout = isArranged(savedLayout)
    ? normalizeLayout(savedLayout, profile.modules.map((m) => m.id))
    : null;
  if (previewLayout && layout) showPreviewBadge();
  const placedIds = new Set(layout ? layout.slots.filter(Boolean) : []);

  const stageDefs = [];
  let cameraDef = null, clockDef = null;
  for (const mod of profile.modules) {
    if (placedIds.has(mod.id)) continue;                      // it lives in a slot
    if (mod.type === 'camera') cameraDef = mod;
    else if (mod.type === 'clock') clockDef = mod;
    else if (!layout) stageDefs.push(mod);                    // no layout: the old stage
  }

  // persistent HUD overlays (mounted once, left running)
  async function mountOverlay(def, el) {
    const host = document.createElement('div'); host.className = 'k-mod';
    el.append(host); el.hidden = false;
    return mountInstance(def, host);
  }
  let cameraRec = cameraDef ? await mountOverlay(cameraDef, mirrorEl) : null;
  let clockRec = clockDef ? await mountOverlay(clockDef, clockEl) : null;

  // ---- a LAID-OUT stage: every slot mounted at once, in its grid position ----
  const slotRecs = [];
  async function mountLayout() {
    stageEl.classList.add('k-grid');
    stageEl.setAttribute('style', gridStyle(layout.preset));
    for (let i = 0; i < layout.slots.length; i++) {
      const cell = document.createElement('div');
      // `mod-box` lets the module size itself against this cell (see modules.css).
      cell.className = 'k-cell mod-box';
      cell.setAttribute('style', slotStyle(layout.preset, i));
      stageEl.append(cell);
      const id = layout.slots[i];
      if (!id) continue;                                      // an empty slot is allowed
      const def = profile.modules.find((m) => m.id === id);
      if (!def) continue;
      const host = document.createElement('div'); host.className = 'k-mod';
      cell.append(host);
      slotRecs.push(await mountInstance(def, host));
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
    stageRec = await mountInstance(stageDefs[primary], host);
    // Keep the focus ring in step when the stage was changed by a number key or a dot,
    // or the next switch press would resume from wherever focus was last left.
    runtime?.router.setFocus(stageDefs[primary].id);
    // Where she is, remembered on the device. Written whatever the restart mode is, so
    // turning "pick up where she left off" on later does not start by forgetting.
    writePosition(user, profileId, primary, storage);
    renderMods();
  }
  function renderMods() {
    modsEl.innerHTML = '';
    if (layout) return;                     // nothing to switch between — it's all visible
    stageDefs.forEach((d, j) => {
      const b = document.createElement('button');
      b.className = 'k-dot' + (j === primary ? ' on' : '');
      b.textContent = d.type;
      b.dataset.i = j;
      b.addEventListener('click', () => showPrimary(j));
      modsEl.append(b);
    });
  }

  // "next" within the current stage module — the director advances via segment/done,
  // everything else via <type>/next. Only the visible module is mounted, so this
  // never nudges a hidden one.
  function nextInPrimary() {
    // In a laid-out screen there is no "next": every slot is already on screen. Nudge the
    // first slot instead, so the button still advances a playlist rather than doing nothing.
    if (layout) {
      const rec = slotRecs[0];
      if (!rec) return;
      if (rec.type === 'director') bus.publish('segment/done', { reason: 'skipped' });
      else bus.publish(`${rec.type}/next`);
      return;
    }
    if (!stageRec) return;
    if (stageRec.type === 'director') bus.publish('segment/done', { reason: 'skipped' });
    else bus.publish(`${stageRec.type}/next`);
  }

  // MIRROR MODE (M): make the camera fill the whole screen (the mirror element
  // expands over the stage; press again to return). The camera stream stays mounted.
  let mirrorFull = false;
  function toggleMirrorFull() {
    if (!cameraRec) return;
    mirrorFull = !mirrorFull;
    kioskEl.classList.toggle('mirror-full', mirrorFull);
    try { cameraRec.instance.onResize?.(); } catch { /* noop */ }
  }
  function toggleFs() {
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
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

  // A way OUT. The browser back button was the only route home, which is fine for a
  // paired bedside screen that never leaves the kiosk and wrong for everyone else.
  // It lives in the auto-hiding chrome, so an unattended screen still shows nothing.
  const goHome = () => { location.href = '/home.html'; };
  controlsEl.querySelector('[data-act="home"]').addEventListener('click', goHome);
  controlsEl.querySelector('[data-act="next"]').addEventListener('click', nextInPrimary);
  controlsEl.querySelector('[data-act="mirror"]').addEventListener('click', toggleMirrorFull);
  controlsEl.querySelector('[data-act="fs"]').addEventListener('click', toggleFs);

  // ---- the universal settings menu ----------------------------------------
  //
  // The menu is driven by the INPUT BUS below, so opening it is a bindable verb and works
  // from a switch, not only a keyboard. The shell's imperative moves are what the bus calls
  // into, and remain the fallback for any surface that has no bus.
  //
  // The person's NAME is resolved in the background and never blocks the boot: a screen
  // that will not come up because a name lookup failed is strictly worse than a screen
  // that says "…" where a name goes.
  let whoName = null;
  const menu = mountSettings(root.querySelector('[data-settings]'), {
    person: () => (whoName ? { name: whoName } : null),
    // In a laid-out screen every panel is visible at once and the kiosk has no focus
    // concept yet, so there is no single subject and the menu says so rather than
    // guessing at one.
    subject: () => (layout || !stageRec
      ? null
      // mountInstance flattens the manifest: the record carries `title`, NOT `manifest`.
      // Reading `manifest.title` silently fell back to the raw type, so the menu said
      // "This panel — photos" instead of "Photos".
      : { type: stageRec.type, title: stageRec.title || stageRec.type }),
    fullscreenTarget: root,
    onHome: goHome,
    // THE MENU'S FIRST REAL CONTENT. Until the declarative per-module schema lands, the
    // host contributes items through `extras` — which is what that hook was for.
    extras: () => restartItems(restart, {
      screenName: profile?.name ? `“${profile.name}”` : 'this screen',
      onChange: ({ mode }) => {
        // Choosing "always come back here" names THE SCREEN YOU ARE STANDING ON. That is
        // the gesture: walk to the one that works, and say come back here.
        restart = writeConfig(user, mode === 'screen'
          ? { mode, screenId: profileId }
          : { mode }, storage);
        menu.refresh();
      },
    }),
    // Still ungated at the bedside, deliberately. The three-way switch in input.js gates
    // which BINDINGS fire; it does not answer "is a moderator standing here", and inventing
    // that mapping would be guessing at semantics nobody has decided. Open, and recorded as
    // open rather than papered over with a plausible-looking default.
    gated: false,
  });
  controlsEl.querySelector('[data-act="settings"]').addEventListener('click', () => menu.toggle());
  // WHO THIS SCREEN IS FOR, resolved in the background and never blocking the boot. It
  // brings two things: the name the menu shows, and THE PERSON'S OWN BINDINGS. A screen
  // that will not come up because a name lookup failed is strictly worse than one that
  // says "…" and runs on the defaults.
  //
  // `makeState` means a local backend (the dev test): there is no /api/people behind it,
  // so the defaults simply stand rather than the runtime chasing an endpoint that is not
  // there.
  let personOff = null;
  (async () => {
    try {
      const p = await profiles.get(profileId);
      if (!p?.person_id) return;
      if (profiles.people) {
        const who = (await profiles.people()).find((x) => x.id === p.person_id);
        if (who) { whoName = who.name; menu.refresh(); }
      }
      if (makeState || !profiles.personStateURL) return;
      personOff = await runtime.useState(createState({
        url: profiles.personStateURL(p.person_id, INPUTS_KEY),
        user,
        cacheKey: `person:${user}:${p.person_id}:${INPUTS_KEY}`,
      }));
    } catch { /* offline or signed out: the shipped defaults still drive the screen */ }
  })();

  // ---- THE INPUT BUS, at the bedside ---------------------------------------
  //
  // This is the half that was missing. Modules were never the problem: a module subscribes
  // to `photos/next` on its scoped bus and has no idea a switch exists, which is exactly
  // why the same module runs here, on the home page, or anywhere else. What did not exist
  // was anybody CONSTRUCTING the device half on this surface — so a person's switch drove
  // the binder on a clinician's laptop and nothing at all on the screen they actually use.
  //
  // IT STARTS ON THE SHIPPED DEFAULTS, BEFORE ANY NETWORK. A screen that is undriveable
  // until a fetch returns is undriveable exactly when the network is the thing that broke.
  // The person's own bindings replace them when they arrive, and again whenever they
  // change — which is what makes a clinician editing on a laptop land here within a poll.
  //
  // FOCUS IS THE STAGE. In single-stage mode one module is mounted at a time, so "focus
  // the next panel" and "show the next module" are the same act; wiring onChange to
  // showPrimary is what lets ONE switch reach every module on the screen. In a laid-out
  // screen everything is already visible, so focus merely moves.
  const focusRing = () => (layout
    ? slotRecs.map((r) => ({ id: r.id, type: r.type }))
    : stageDefs.map((d) => ({ id: d.id, type: d.type })));

  const runtime = mountInputRuntime({
    bus,
    modules: focusRing,
    fallback: DEFAULT_BINDINGS,
    onFocus: (m) => {
      if (layout) return;                    // every panel is on screen already
      const i = stageDefs.findIndex((d) => d.id === m.id);
      if (i >= 0 && i !== primary) showPrimary(i);
    },
  });
  await runtime.load();
  // The menu takes the verbs while it is open and hands them back when it closes.
  menu.attachBus(bus, runtime.router);

  // auto-hide the control bar
  let hideT = null;
  function poke() { controlsEl.classList.remove('hidden'); clearTimeout(hideT); hideT = setTimeout(() => controlsEl.classList.add('hidden'), 3000); }
  root.addEventListener('mousemove', poke); poke();

  // WHAT LEFT THIS HANDLER, and what stayed.
  //
  // Arrows, Enter, Space and the menu key are now ORDINARY BINDINGS on the input bus: they
  // are rebindable, they work from a switch, and they behave identically here and on the
  // home page. Handling them here as well would fire everything twice.
  //
  // What stays is the CAREGIVER's chrome — number keys, mirror, fullscreen, home. Those
  // are for whoever is standing at the screen with a keyboard, not for the person using
  // it, and none of them belong in anybody's binding list.
  //
  // MIRROR MOVED FROM M TO C, because M is the menu now and C was the better mnemonic
  // anyway: it is the CAMERA mirror.
  const onKey = (e) => {
    if (menu.isOpen()) return;               // the menu is driven by the bus, not from here
    if (e.key >= '1' && e.key <= '9') { const i = Number(e.key) - 1; if (i < stageDefs.length) showPrimary(i); else return; }
    else if (e.key.toLowerCase() === 'h') { goHome(); return; }
    else if (e.key.toLowerCase() === 'c') toggleMirrorFull();
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else if (e.key === '[') cycleMirrorSize(-1);
    else if (e.key === ']') cycleMirrorSize(1);
    else if (e.key === '\\') cycleMirrorCorner();
    else return;
    poke();
  };
  window.addEventListener('keydown', onKey);

  // ---- WHERE A COLD BOOT LANDS -------------------------------------------
  // `stageDefs.length` clamps a remembered position: a screen can lose modules between
  // boots, and restoring slot 4 of a two-module screen is a blank stage.
  const plan = bootPlan({
    config: restart,
    currentProfileId: profileId,
    stageCount: stageDefs.length,
    hopped: hasHopped(session),
  });
  if (plan.redirectTo) {
    markHopped(session);
    navigate(`kiosk.html?profile=${encodeURIComponent(plan.redirectTo)}`);
  }

  if (layout) await mountLayout(); else await showPrimary(plan.stageIndex);

  return {
    stageCount: () => stageDefs.length,
    // NOTE: `layout()` was already taken by the mirror/clock HUD positions below. A second
    // `layout:` key in this same object literal is silently shadowed by it — which is
    // exactly what happened first time. This one is the composed SLOT layout.
    slotLayout: () => (layout ? { ...layout } : null),
    slotCount: () => slotRecs.length,
    slotTypes: () => slotRecs.map((r) => r.type),
    hasCamera: () => !!cameraRec,
    hasClock: () => !!clockRec,
    primaryType: () => stageDefs[primary]?.type ?? null,
    mirrorFull: () => mirrorFull,
    layout: () => ({ mirrorSize: kioskEl.dataset.mirrorSize, mirrorCorner: kioskEl.dataset.mirrorCorner, clockCorner: kioskEl.dataset.clockCorner }),
    showPrimary,
    menu,
    runtime,
    restart: () => ({ ...restart }),
    next: nextInPrimary,
    toggleMirrorFull,
    setMirror: patchMirror,
    destroy() {
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('mousemove', poke);
      clearTimeout(hideT);
      destroyRec(stageRec); destroyRec(cameraRec); destroyRec(clockRec);
      while (slotRecs.length) destroyRec(slotRecs.pop());
      settings.destroy();
      menu.destroy();
      try { personOff?.(); } catch { /* already gone */ }
      runtime.destroy();
      stageEl.innerHTML = ''; mirrorEl.innerHTML = ''; clockEl.innerHTML = '';
    },
  };
}

function showPreviewBadge() {
  const b = document.createElement('div');
  b.textContent = 'Preview — not saved';
  b.setAttribute('data-preview-badge', '');
  b.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9999;'
    + 'padding:6px 14px;border-radius:999px;font:600 13px/1.2 system-ui,sans-serif;'
    + 'background:rgba(10,51,35,.88);color:#F7F4D5;border:1px solid rgba(247,244,213,.35)';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 6000);
}
