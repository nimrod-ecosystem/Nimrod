// kiosk.js — the full-screen PRODUCT surface (as opposed to index.html, the dev
// harness). It opens ONE profile full-screen, caregiver-driven by keyboard + mouse
// (the patient isn't controlling it yet), with:
//
//   * a big STAGE that shows one module at a time (photos / youtube / the Lineup
//     director / …), switchable with number keys or the on-screen dots;
//   * a persistent MIRROR — the camera self-view pinned in a corner (her rearview
//     "mirror" / orientation anchor; DECISIONS.md + CONTEXT.md say never cover it),
//     mounted ONCE and left running while the stage changes;
//   * an auto-hiding control bar (mouse).
//
// Stage modules are mounted LAZILY — only the visible one is live, so a hidden
// youtube/director isn't playing audio behind the scenes. The camera is the one
// exception: it stays mounted so the mirror is always there.
//
// It reuses the exact runtime the dev harness uses (bus, per-instance state/events,
// mountModule, the container ctx additions), so a Lineup director works here too.
//
// RESILIENCE TODO (noted, not built): cache the profile config locally so a brief
// coordination-server outage doesn't blank her screen — the media agent is local,
// so photos/videos should keep playing. That graceful-degradation is a near-term
// slice; today the kiosk needs the server reachable at boot.

import { createBus } from './bus.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createProfilesClient } from './profile.js';
import { mountModule } from './module.js';
import { applyTheme } from './theme.js';
import './modules/clock.js';
import './modules/camera.js';
import './modules/photos.js';
import './modules/youtube.js';
import './modules/personal.js';
import './modules/educational.js';
import './modules/director.js';

const CAMERA_TYPE = 'camera';
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
      <div class="k-controls" data-controls>
        <div class="k-mods" data-mods></div>
        <div class="k-actions">
          <button data-act="next" title="next (→ / space)">Next ▸</button>
          <button data-act="mirror" title="toggle mirror (M)">Mirror</button>
          <button data-act="fs" title="fullscreen (F)">⛶</button>
        </div>
      </div>
    </div>`;
  const stageEl = root.querySelector('[data-stage]');
  const mirrorEl = root.querySelector('[data-mirror]');
  const controlsEl = root.querySelector('[data-controls]');
  const modsEl = root.querySelector('[data-mods]');

  const childCtx = (mod) => ({
    bus, user, profileId,
    rootBus: bus, instanceId: mod.id,
    makeState: (key) => createState({ url: profiles.stateURL(profileId, key), user }),
    makeEvents: (key) => createEvents({ url: profiles.eventsURL(profileId, key), user }),
  });

  async function mountInstance(mod, host) {
    const state = createState({ url: profiles.stateURL(profileId, mod.id), user });
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

  // ---- theme (per-profile settings) ---------------------------------------
  const settings = createState({ url: profiles.stateURL(profileId, 'settings'), user });
  await settings.load().catch(() => {});
  applyTheme(document.documentElement, settings.get().theme);
  settings.subscribe((s) => applyTheme(document.documentElement, s.theme));
  settings.startPolling();

  // ---- partition modules: camera -> mirror, the rest -> stage --------------
  const profile = await profiles.get(profileId);
  const stageDefs = [];          // {id,type} for cyclable stage modules (mounted lazily)
  let cameraDef = null;
  for (const mod of profile.modules) {
    if (mod.type === CAMERA_TYPE) cameraDef = mod; else stageDefs.push(mod);
  }

  // the camera mirror is mounted ONCE and left running
  let cameraRec = null;
  if (cameraDef) {
    const host = document.createElement('div'); host.className = 'k-mod';
    mirrorEl.append(host); mirrorEl.hidden = false;
    cameraRec = await mountInstance(cameraDef, host);
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
  function toggleMirror() { if (cameraRec) mirrorEl.hidden = !mirrorEl.hidden; }
  function toggleFs() {
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  controlsEl.querySelector('[data-act="next"]').addEventListener('click', nextInPrimary);
  controlsEl.querySelector('[data-act="mirror"]').addEventListener('click', toggleMirror);
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
    else if (e.key.toLowerCase() === 'm') toggleMirror();
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else return;
    poke();
  };
  window.addEventListener('keydown', onKey);

  await showPrimary(0);

  return {
    stageCount: () => stageDefs.length,
    hasCamera: () => !!cameraRec,
    primaryType: () => stageDefs[primary]?.type ?? null,
    mirrorVisible: () => !mirrorEl.hidden,
    showPrimary,
    next: nextInPrimary,
    toggleMirror,
    destroy() {
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('mousemove', poke);
      clearTimeout(hideT);
      destroyRec(stageRec); destroyRec(cameraRec);
      settings.destroy();
      stageEl.innerHTML = ''; mirrorEl.innerHTML = '';   // drop the mount hosts too
    },
  };
}
