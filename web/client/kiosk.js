// kiosk.js — the full-screen PRODUCT surface (as opposed to index.html, the dev
// harness). It opens ONE profile full-screen, caregiver-driven by keyboard + mouse
// (the patient isn't controlling it yet), with:
//
//   * a big STAGE that shows one module at a time (photos / youtube / the Lineup
//     director / …), switchable with number keys or the on-screen dots;
//   * persistent HUD OVERLAYS — the camera self-view "mirror" and a translucent
//     clock — mounted ONCE and left running while the stage changes. The model is
//     "one content surface + a small HUD", not the old four-quadrant split.
//   * MIRROR MODE (M): the camera fills the whole screen; press again to return.
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
} = {}) {
  bus = bus || createBus();
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
          <button data-act="mirror" title="mirror mode (M) — camera full screen">Mirror</button>
          <button data-act="settings" title="settings (S)">⚙</button>
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
  // The kiosk has NO input bus (it lives in the Inputs panel on the home side), so the
  // menu is driven straight from this file's key handler. That is the whole reason the
  // shell exposes imperative moves instead of only listening for verbs — see settings.js.
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
    // Not gated here YET: the gate is the three-way role switch in input.js, which the
    // kiosk does not run. Claiming to gate while having nothing to gate with would be a
    // lie in the code. It arrives with the input bus.
    gated: false,
  });
  controlsEl.querySelector('[data-act="settings"]').addEventListener('click', () => menu.toggle());
  (async () => {
    try {
      const p = await profiles.get(profileId);
      if (!p?.person_id || !profiles.people) return;
      const who = (await profiles.people()).find((x) => x.id === p.person_id);
      if (who) { whoName = who.name; menu.refresh(); }
    } catch { /* offline, or signed out: the menu simply does not name anyone */ }
  })();

  // auto-hide the control bar
  let hideT = null;
  function poke() { controlsEl.classList.remove('hidden'); clearTimeout(hideT); hideT = setTimeout(() => controlsEl.classList.add('hidden'), 3000); }
  root.addEventListener('mousemove', poke); poke();

  const onKey = (e) => {
    // THE MENU EATS EVERYTHING WHILE IT IS OPEN. Without this, an arrow press would both
    // move the menu cursor and change her photo behind it — the same "two things happened"
    // bug the router's pause flag prevents where a bus exists.
    if (menu.isOpen()) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') menu.next();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') menu.prev();
      else if (e.key === 'Enter' || e.key === ' ') menu.select();
      else if (e.key === 'Escape' || e.key.toLowerCase() === 's') menu.close();
      else return;
      e.preventDefault();
      poke();
      return;
    }
    if (e.key.toLowerCase() === 's') { menu.open(); poke(); return; }
    if (e.key >= '1' && e.key <= '9') { const i = Number(e.key) - 1; if (i < stageDefs.length) showPrimary(i); else return; }
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextInPrimary(); }
    else if (e.key === 'ArrowLeft') showPrimary(primary - 1);
    else if (e.key === 'ArrowUp') showPrimary(primary + 1);
    else if (e.key.toLowerCase() === 'h') { goHome(); return; }
    else if (e.key.toLowerCase() === 'm') toggleMirrorFull();
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else if (e.key === '[') cycleMirrorSize(-1);
    else if (e.key === ']') cycleMirrorSize(1);
    else if (e.key === '\\') cycleMirrorCorner();
    else return;
    poke();
  };
  window.addEventListener('keydown', onKey);

  if (layout) await mountLayout(); else await showPrimary(0);

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
