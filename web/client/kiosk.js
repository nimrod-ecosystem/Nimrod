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

const MIRROR_SIZES = ['sm', 'md', 'lg'];
const CORNERS = ['tr', 'br', 'bl', 'tl'];
const KDEF = { mirror: { size: 'lg', corner: 'tr' }, clock: { corner: 'bl' } };
const wrap = (i, n) => ((i % n) + n) % n;

// Mount a kiosk for one profile into `root`. Returns a small control handle
// (also used by the dev test). `profiles`/`bus` are injectable.
export async function mountKiosk(root, { user, profileId, profiles, bus } = {}) {
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
          <button data-act="next" title="next (→ / space)">Next ▸</button>
          <button data-act="mirror" title="mirror mode (M) — camera full screen">Mirror</button>
          <button data-act="fs" title="fullscreen (F)">⛶</button>
        </div>
      </div>
    </div>`;
  const kioskEl = root.querySelector('.kiosk');
  const stageEl = root.querySelector('[data-stage]');
  const mirrorEl = root.querySelector('[data-mirror]');
  const clockEl = root.querySelector('[data-clock]');
  const controlsEl = root.querySelector('[data-controls]');
  const modsEl = root.querySelector('[data-mods]');

  const ck = (key) => `${user}:${profileId}:${key}`;   // resilience cache key per handle

  const childCtx = (mod) => ({
    bus, user, profileId,
    rootBus: bus, instanceId: mod.id,
    makeState: (key, opts) => createState({ url: profiles.stateURL(profileId, key), user, cacheKey: ck(key), ...opts }),
    makeEvents: (key, opts) => createEvents({ url: profiles.eventsURL(profileId, key), user, ...opts }),
  });

  async function mountInstance(mod, host) {
    const state = createState({ url: profiles.stateURL(profileId, mod.id), user, cacheKey: ck(mod.id) });
    const events = createEvents({ url: profiles.eventsURL(profileId, mod.id), user });
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
  const settings = createState({ url: profiles.stateURL(profileId, 'settings'), user, cacheKey: ck('settings') });
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
  const profile = await cachedFetch(`profile:${user}:${profileId}`, () => profiles.get(profileId));
  const stageDefs = [];
  let cameraDef = null, clockDef = null;
  for (const mod of profile.modules) {
    if (mod.type === 'camera') cameraDef = mod;
    else if (mod.type === 'clock') clockDef = mod;
    else stageDefs.push(mod);
  }

  // persistent HUD overlays (mounted once, left running)
  async function mountOverlay(def, el) {
    const host = document.createElement('div'); host.className = 'k-mod';
    el.append(host); el.hidden = false;
    return mountInstance(def, host);
  }
  let cameraRec = cameraDef ? await mountOverlay(cameraDef, mirrorEl) : null;
  let clockRec = clockDef ? await mountOverlay(clockDef, clockEl) : null;

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

  controlsEl.querySelector('[data-act="next"]').addEventListener('click', nextInPrimary);
  controlsEl.querySelector('[data-act="mirror"]').addEventListener('click', toggleMirrorFull);
  controlsEl.querySelector('[data-act="fs"]').addEventListener('click', toggleFs);

  // auto-hide the control bar
  let hideT = null;
  function poke() { controlsEl.classList.remove('hidden'); clearTimeout(hideT); hideT = setTimeout(() => controlsEl.classList.add('hidden'), 3000); }
  root.addEventListener('mousemove', poke); poke();

  const onKey = (e) => {
    if (e.key >= '1' && e.key <= '9') { const i = Number(e.key) - 1; if (i < stageDefs.length) showPrimary(i); else return; }
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextInPrimary(); }
    else if (e.key === 'ArrowLeft') showPrimary(primary - 1);
    else if (e.key === 'ArrowUp') showPrimary(primary + 1);
    else if (e.key.toLowerCase() === 'm') toggleMirrorFull();
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else if (e.key === '[') cycleMirrorSize(-1);
    else if (e.key === ']') cycleMirrorSize(1);
    else if (e.key === '\\') cycleMirrorCorner();
    else return;
    poke();
  };
  window.addEventListener('keydown', onKey);

  await showPrimary(0);

  return {
    stageCount: () => stageDefs.length,
    hasCamera: () => !!cameraRec,
    hasClock: () => !!clockRec,
    primaryType: () => stageDefs[primary]?.type ?? null,
    mirrorFull: () => mirrorFull,
    layout: () => ({ mirrorSize: kioskEl.dataset.mirrorSize, mirrorCorner: kioskEl.dataset.mirrorCorner, clockCorner: kioskEl.dataset.clockCorner }),
    showPrimary,
    next: nextInPrimary,
    toggleMirrorFull,
    setMirror: patchMirror,
    destroy() {
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('mousemove', poke);
      clearTimeout(hideT);
      destroyRec(stageRec); destroyRec(cameraRec); destroyRec(clockRec);
      settings.destroy();
      stageEl.innerHTML = ''; mirrorEl.innerHTML = ''; clockEl.innerHTML = '';
    },
  };
}
