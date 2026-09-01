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
import { createOutputBus } from './output.js';
import { createAudioBus } from './audio_bus.js';
import { createCameraOwner } from './camera_owner.js';
import { defaultChannels } from './output_channels.js';
import { REMOTE_STREAM } from './output_remote.js';
import { normalizeLayout, isArranged, gridStyle, slotStyle } from './layout.js';
import { mountSettings } from './settings.js';
import { fieldsFor, fieldItems, normalizeField } from './settings_fields.js';
import { controlPages, CONTROL_ITEMS } from './controls_view.js';
import { connectionsPage, CONNECTION_ITEMS } from './connections.js';
import { createHealthWatch } from './health.js';
import { nextAction, applied, cleared, chooseFallback, DEFAULT_POLICY,
         RECOVERY_SETTINGS } from './recovery.js';
import { listManifests } from './module.js';
import { mountInputRuntime, INPUTS_KEY } from './input_runtime.js';
import { mountCursor } from './cursor.js';
import { createMicOwner } from './mic_owner.js';
import { DEFAULT_BINDINGS } from './input_keyboard.js';
import { attachDriveToBus } from './drive.js';
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
import './modules/trivia.js';    // registers 'trivia'
import './modules/bank.js';      // registers 'bank' (the shared questions + words)
import './modules/lessons.js';
import './modules/algebra.js';
import './modules/pond.js';
import './modules/wallpaper.js';
import './modules/board.js';
import './modules/comet.js';
import './modules/pressgame.js';
import './modules/call.js';
import './modules/view.js';

const MIRROR_SIZES = ['sm', 'md', 'lg'];
const CORNERS = ['tr', 'br', 'bl', 'tl'];
const KDEF = { mirror: { size: 'lg', corner: 'tr' }, clock: { corner: 'bl' } };
const wrap = (i, n) => ((i % n) + n) % n;

// Swapping the whole screen. `kiosk/show` takes a screen id (or {profileId}); `kiosk/back`
// returns to the one before it. A state machine drives these from a state's `enter`.
export const SCREEN_SHOW = 'kiosk/show';
export const SCREEN_BACK = 'kiosk/back';
export const SCREEN_SHOWN = 'kiosk/shown';

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
  // RECOVERY SEAMS. All three exist so the test can walk the whole ladder without anything
  // actually happening - a suite that reloads the page cannot report its own results, and
  // one that reboots a machine is not a suite anybody will run twice.
  reloadPage = () => { if (typeof location !== 'undefined') location.reload(); },
  // Null means THIS DEVICE CANNOT REBOOT ITSELF, which is the honest default: no browser on
  // any platform can restart the host OS. A Nimrod appliance with a local helper supplies one.
  rebootDevice = null,
  onRecovery = null,               // told about every action taken, for the log and the tests
  recoveryNow = () => Date.now(),
  recoveryTick = 60 * 1000,
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
          <!-- HUSH. Not a mute: her voice and any cue still come through, only the media
               stops. It is for the ordinary moment when somebody walks in to talk to her and
               the music is in the way. -->
          <button data-act="hush" data-on="0"
            title="pause the music and video so you can talk (she is still heard)">Hush</button>
          <button data-act="settings" title="settings (Esc or M)">⚙</button>
          <button data-act="fs" title="fullscreen (F)">⛶</button>
        </div>
      </div>
      <div class="k-remote" data-remote hidden>Someone is helping from another screen</div>
      <div data-settings></div>
    </div>`;
  const kioskEl = root.querySelector('.kiosk');
  const stageEl = root.querySelector('[data-stage]');
  const mirrorEl = root.querySelector('[data-mirror]');
  const clockEl = root.querySelector('[data-clock]');
  const controlsEl = root.querySelector('[data-controls]');
  const remoteEl = root.querySelector('[data-remote]');
  const modsEl = root.querySelector('[data-mods]');

  // WHOSE SCREEN THIS IS. Declared UP HERE rather than beside the lookup that fills it,
  // because `childCtx` exposes it as a getter and the first module mounts before that
  // lookup has even started - a `let` further down the file is still in its temporal dead
  // zone at that moment, which threw. Null until the background resolve lands, which every
  // consumer already has to handle anyway.
  let personId = null;

  // The output bus for this surface. Built once, shared by every module on the screen -
  // which is the whole point of it: there is ONE pair of ears, so arbitration has to happen
  // above the modules or two of them talk over each other and produce nothing.
  //
  // Channels are whatever this device actually has. `defaultChannels` omits a channel it
  // cannot provide rather than shipping a broken one, so output.js reports `no-adapter`
  // instead of a message vanishing.
  // *** THE SPEAKER ARBITER, ABOVE THE OUTPUT BUS AND ABOVE EVERY MODULE. ***
  // There is one pair of ears on this screen. A video, a game's music bed and a spoken cue
  // all reach it at once unless something coordinates them, and the coordination has to live
  // above all three - a module cannot know what else is making noise. Built before the output
  // bus because the speech channel registers with it.
  const audio = createAudioBus();

  // *** THE CAMERA ARBITER. *** One webcam, and on Linux a second open of it FAILS rather
  // than sharing - so unlike the speaker this is a strict single owner. It exists mainly to
  // protect one thing: her mirror must not go dark because a call arrived. See camera_owner.js.
  const cameraOwner = createCameraOwner();

  // *** THE MICROPHONE ARBITER. *** Same discipline as the camera and one extra reason for it:
  // two things holding a live microphone is a privacy event, not a resource conflict, and a
  // single owner is the only thing that can honestly answer "is anything listening?". Nothing
  // opens it here — it is opened by whatever acquires it, which today is a call and nothing
  // else. See mic_owner.js for why a call and a recogniser want opposite processing.
  const micOwner = createMicOwner();

  let output = null;
  // *** DECLARED HERE, NOT WHERE THEY ARE BUILT, AND THAT IS NOT TIDINESS. ***
  // `childCtx` below hands modules a GETTER for the aim, because the input runtime is built
  // much further down and a module mounted first would otherwise capture null forever — the
  // same reason `output` and `personId` are getters. But a getter still needs its variable to
  // be IN SCOPE when it runs: with `let runtime` declared next to where it is assigned, the
  // first overlay to mount hit the temporal dead zone and the whole kiosk failed to boot with
  // "Cannot access 'runtime' before initialization". Caught by kiosk_test going from 133
  // passing to zero, which is the useful kind of failure.
  let runtime = null;
  let cursor = null;
  let markerTracker = null;
  let markerState = null;

  // ---- MARKER TRACKING AT THE BEDSIDE -------------------------------------------------
  //
  // OFF UNLESS SOMEBODY TURNED IT ON. Not "started and idle": a screen that opens the webcam
  // because a feature exists is a screen with a camera light on in somebody's room for no
  // reason. The camera is opened only when the setting says to, and released the moment it
  // stops.
  //
  // The calibration is stored PER PERSON, in the same place the input bindings are, and it is
  // POLLED for the same reason: a caregiver can set the sock up on a laptop on the Devices tab
  // and it reaches the bedside within a poll or two, with nobody reloading anything on the
  // screen the person is using. That is the clinical scenario — one person configuring while
  // another is using it — and it needed no new transport, because per-person state already
  // does exactly this for switches.
  //
  // *** THERE IS NO CALIBRATION UI HERE, DELIBERATELY. *** Clicking the sock happens on home.
  // This surface only consumes the numbers — the same split `input_runtime.js` makes, where the
  // runtime consumes bindings and the binder stays on the other side.
  async function startMarkerTracking(personId2) {
    if (markerTracker || !personId2 || !profiles.personStateURL) return;
    const [{ createMarkerTracker, shouldTrack }, { MARKER_KEY }] = await Promise.all([
      import('./input_marker.js'), import('./marker_panel.js'),
    ]);
    markerState = createState({
      url: profiles.personStateURL(personId2, MARKER_KEY),
      user,
      cacheKey: `person:${user}:${personId2}:${MARKER_KEY}`,
    });
    await markerState.load().catch(() => {});     // offline: the shipped default is OFF anyway
    markerTracker = createMarkerTracker({
      aim: runtime.aim,
      cameraOwner,
      settings: () => markerState.get() || {},
    });
    const sync = (saved) => {
      const on = shouldTrack(saved);
      if (on && !markerTracker.isRunning()) {
        markerTracker.start().catch((err) => console.error('kiosk: marker camera', err));
      } else if (!on && markerTracker.isRunning()) {
        markerTracker.stop();
      }
    };
    sync(markerState.get());
    markerState.subscribe?.(sync);
    markerState.startPolling?.();
  }
  try {
    // NO `mount`, SO NO SCREEN CHANNEL - deliberately. A banner adapter rendering into the
    // kiosk root has never been tried on this surface and could land on top of her photos.
    // `say` routes to speech anyway (DEFAULT_ROUTING), and anything routed to `screen` is
    // reported as `no-adapter` rather than vanishing, which is the honest failure. Add it
    // when there is a designated place for a banner and a test that it does not cover
    // anything.
    //
    // *** THE MAILBOX, WIRED (2026-08-31). *** Without an `events` handle `defaultChannels`
    // builds no `remote` channel at all, so `output.notify` on this surface had nowhere to go
    // beyond the room it was already in — which is the wrong answer for the one message this
    // screen actually sends: "the screen has been paused for a while", six hours after
    // somebody paused it. That is addressed to a person who is not here.
    //
    // The stream is the account's own mailbox, not the profile's: it is how a person's OTHER
    // DEVICES hear from this one, and which screen was open when the message was written is
    // beside the point.
    //
    // *** SENDING ONLY. THE RECEIVER IS NOT WIRED, AND THAT IS A DECISION RATHER THAN AN
    // OVERSIGHT. *** `createRemoteReceiver` would let any of the account's devices put text
    // and speech onto THIS screen — which for a bedside screen somebody sits in front of ~24/7
    // is a different feature with its own consent question, not a symmetrical half of this
    // one. The sending half carries no such question: it puts a message in the account's own
    // mailbox and nothing about this room changes.
    output = createOutputBus({
      bus,
      channels: defaultChannels({
        audio,
        events: createEvents({ url: `/api/user-events/${REMOTE_STREAM}`, user }),
      }),
    });
  } catch (err) {
    // A screen that cannot speak is still a screen. Modules treat `output` as optional.
    console.error('kiosk: no output bus', err);
  }

  const ck = (key) => `${user}:${profileId}:${key}`;   // resilience cache key per handle

  const stateFor = (key, opts = {}) => (makeState
    ? makeState(key, opts, profileId)
    : createState({ url: profiles.stateURL(profileId, key), user, cacheKey: ck(key), ...opts }));
  const eventsFor = (key, opts = {}) => (makeEvents
    ? makeEvents(key, opts, profileId)
    : createEvents({ url: profiles.eventsURL(profileId, key), user, ...opts }));

  const childCtx = (mod) => ({
    bus, user, profileId,
    // WHOSE SCREEN THIS IS. Resolved in the background below, so it is a FUNCTION rather
    // than a value - a module mounted before the lookup returns would otherwise capture
    // null forever. Bindings have been per-person since the input runtime landed; this is
    // media catching up to the same idea.
    get personId() { return personId; },
    rootBus: bus, instanceId: mod.id,
    // *** THE OUTPUT BUS, WHICH THE KIOSK DID NOT HAVE. *** Exactly the gap input_runtime.js
    // closed on the other side: the whole output layer was constructed inside the Output TAB,
    // so "how you want to be told things" was configurable where a clinician sets up and
    // silent where the person actually lives. A module that wants to SAY something had
    // nowhere to say it.
    //
    // A getter for the same reason personId is: it is built lazily below, and a module
    // mounted first would otherwise capture undefined forever.
    get output() { return output; },
    // The arbiter itself, for a module that MAKES continuous sound - a music bed, a video.
    // A module that only speaks wants `output`; this is for the things that keep playing.
    audio,
    micOwner,
    // WHERE SOMEBODY IS POINTING, for a module that wants a position rather than a verb -
    // `comet.js` is the reason it exists. A getter for the same reason `output` is: the input
    // runtime is built further down, and a module mounted before it would capture undefined
    // forever. Modules read the aim off the BUS; this handle is only for `latest()`, so a
    // panel mounted mid-session can start under her hand instead of blank.
    get aim() { return runtime?.aim || null; },
    cameraOwner,
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
  // *** `let`, NOT `const`: THE SCREEN CAN BE SWAPPED IN PLACE. *** See `showScreen` below.
  let profile = makeState
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
  let layout = isArranged(savedLayout)
    ? normalizeLayout(savedLayout, profile.modules.map((m) => m.id))
    : null;
  if (previewLayout && layout) showPreviewBadge();

  let stageDefs = [];
  let cameraDef = null, clockDef = null;

  // The partition, as a FUNCTION so a swapped-in screen goes through exactly the same rules
  // as one mounted at boot. Two code paths deciding where a camera goes is how a swapped
  // screen ends up subtly different from the same screen opened directly.
  function partition() {
    const placedIds = new Set(layout ? layout.slots.filter(Boolean) : []);
    stageDefs = [];
    cameraDef = null; clockDef = null;
    for (const mod of profile.modules) {
      if (placedIds.has(mod.id)) continue;                    // it lives in a slot
      if (mod.type === 'camera') cameraDef = mod;
      else if (mod.type === 'clock') clockDef = mod;
      else if (!layout) stageDefs.push(mod);                  // no layout: the old stage
    }
  }
  partition();

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
      slotRecs.push(watchRec(await mountInstance(def, host)));
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
    stageRec = watchRec(await mountInstance(stageDefs[primary], host));
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

  // ---------------------------------------------------------------------------------
  // *** SWAPPING THE WHOLE SCREEN, IN PLACE. ***
  //
  // Mike, 2026-08-29: *"different people's call kiosks will be different. If someone uses an
  // AAC board, they'll need that to use for the call."* That is the argument that settles it -
  // a call screen is not one layout, it is a PERSON'S layout, and somebody who talks through a
  // board needs the board DURING the call. So the state machine has to be able to swap the
  // whole module set, not just what is on the stage.
  //
  // *** WHY IN PLACE AND NOT `navigate('kiosk.html?profile=…')`. *** That path already exists -
  // `restart.js` uses it - but it is a FULL PAGE LOAD: it destroys the audio bus, the camera
  // owner, the input runtime and the drive socket and rebuilds them. For a call that is seconds
  // of black at the worst possible moment, the camera released and re-opened for nothing, and
  // both arbiters made useless across the boundary. Here, only the modules change.
  //
  // WHAT DELIBERATELY DOES NOT CHANGE: input bindings (per PERSON, not per screen), the drive
  // socket, the health watch, the output and audio buses, the camera owner. A screen swap
  // changes what is shown - not who she is, nor what she can press.
  const offsScreen = [];
  let swapping = false;
  const screenStack = [];          // where to go back to

  async function applyModules() {
    // Only the MODULES are torn down. Their state/events handles go with them, which is right:
    // those are per-instance and the incoming screen has its own.
    destroyRec(stageRec); stageRec = null;
    destroyRec(cameraRec); cameraRec = null;
    destroyRec(clockRec); clockRec = null;
    while (slotRecs.length) destroyRec(slotRecs.pop());
    stageEl.innerHTML = ''; stageEl.className = 'k-stage'; stageEl.removeAttribute('style');
    mirrorEl.innerHTML = ''; mirrorEl.hidden = true;
    clockEl.innerHTML = ''; clockEl.hidden = true;

    partition();
    cameraRec = cameraDef ? await mountOverlay(cameraDef, mirrorEl) : null;
    clockRec = clockDef ? await mountOverlay(clockDef, clockEl) : null;
    if (layout) await mountLayout(); else await showPrimary(0);
    renderMods();
  }

  /** Show another screen here, keeping everything that is not a module.
   *  `remember: false` on the return leg, so going back does not stack up forever. */
  async function showScreen(nextId, { remember = true } = {}) {
    if (!nextId || nextId === profileId || swapping) return null;
    swapping = true;
    const from = profileId;
    try {
      const next = makeState
        ? await profiles.get(nextId)
        : await cachedFetch(`profile:${user}:${nextId}`, () => profiles.get(nextId));
      if (!next || !Array.isArray(next.modules)) throw new Error('that screen has no modules');
      if (remember) screenStack.push(from);
      profileId = nextId;
      profile = next;
      // The incoming screen's own arrangement. A PREVIEW layout is a one-shot for the screen
      // it was handed to and must never follow a swap.
      const sl = (settings.get().kiosk || {}).layout;
      layout = isArranged(sl) ? normalizeLayout(sl, profile.modules.map((m) => m.id)) : null;
      await applyModules();
      bus.publish(SCREEN_SHOWN, { profileId: nextId, from });
      return nextId;
    } catch (err) {
      // *** A FAILED SWAP MUST LEAVE HER LOOKING AT SOMETHING. *** Put the id back and leave
      // what is already mounted alone: "the call did not open" is recoverable, a blank screen
      // in a room she cannot leave is not.
      console.error('kiosk: could not show screen', nextId, err);
      profileId = from;
      if (remember) screenStack.pop();
      return null;
    } finally {
      swapping = false;
    }
  }

  /** Back to whatever was showing before the last swap. */
  async function showPreviousScreen() {
    const back = screenStack.pop();
    if (!back) return null;
    return showScreen(back, { remember: false });
  }

  // *** THE STATE MACHINE'S HANDLE ON THIS. *** It needs no new engine primitive: a state's
  // `enter` already publishes a topic with a payload, so `{publish: 'kiosk/show', payload:
  // '<screen id>'}` IS the verb. And that composes with `$back` for free - returning to the
  // previous STATE re-runs its enter, which re-publishes its screen.
  //
  // NOT ON THE DRIVE ALLOWLIST, and that is deliberate: `drive.py` carries a fixed list of
  // verbs a remote party may send, and "replace what is on this screen" is not something a
  // person on the other end of a socket should be able to do unasked.
  offsScreen.push(bus.subscribe(SCREEN_SHOW, (payload) => {
    const id = typeof payload === 'string' ? payload : payload?.profileId;
    showScreen(id).catch(() => {});
  }));
  offsScreen.push(bus.subscribe(SCREEN_BACK, () => { showPreviousScreen().catch(() => {}); }));

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

  // MIRROR MODE (C): make the camera fill the whole screen (the mirror element
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

  // *** THE HUSH BUTTON. *** Cici has had one; this is its twin.
  //
  // IT IS A TOGGLE THAT SAYS WHAT IT IS DOING, and that matters more than it sounds: silence
  // with no visible cause reads as "the screen broke", and somebody who did not press it -
  // an aide arriving mid-shift - has to be able to see why there is no sound and undo it.
  // So the label changes and the button stays lit while it is on.
  const hushBtn = controlsEl.querySelector('[data-act="hush"]');
  function renderHush() {
    const on = !!audio?.isHushed?.();
    hushBtn.dataset.on = on ? '1' : '0';
    hushBtn.textContent = on ? 'Sound off' : 'Hush';
    hushBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    hushBtn.title = on
      ? 'the music and video are paused — press to bring them back'
      : 'pause the music and video so you can talk (she is still heard)';
  }
  hushBtn.addEventListener('click', () => { audio?.hush?.(!audio.isHushed()); renderHush(); });
  renderHush();
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
  // COMPLEXITY LEVEL — essential / standard / advanced. It lives in the profile settings blob
  // for now, which is the `screen` level of the chain; when the chain arrives it becomes an
  // ordinary inherited setting like anything else, and Mike's point stands that a patient's
  // screen may run `essential` while the clinician's laptop runs `advanced` on one account.
  //
  // THERE IS NO WAY TO SET IT FROM HERE YET, ON PURPOSE. A level that hides settings can hide
  // the setting that changes the level, and that door only locks once somebody can close it.
  // The escape gets built in the same commit as the switch, never after. What is safe today:
  // Home, Close and every other way out are built unconditionally in `settings.js` and this
  // filter never sees them.
  const complexity = () => (settings.get() || {}).complexity || 'standard';
  const subjectName = () => (layout || !stageRec ? '' : (stageRec.title || stageRec.type));
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
    // THE FOCUSED PANEL'S OWN SETTINGS, declared by the module and rendered by the shell.
    //
    // THE HOST DOES THE WRITING, and that is the whole seam. `settings_fields.js` computes
    // the next value and hands back `(key, value)`; where that value LIVES is a question only
    // this file can answer, because a setting has six possible homes (instance, module,
    // screen, device, person, account) that form an inheritance chain. Slice 2 writes to the
    // instance, which is the most specific level and therefore correct under any chain order
    // that ever gets built. The day the chain lands, this callback grows a destination —
    // nothing in the pure layer moves.
    //
    // In a laid-out screen every panel is visible at once and there is no single focused
    // subject, so there are no panel settings to show rather than a guess at whose.
    fields: () => {
      const rec = layout ? null : stageRec;
      if (!rec) return [];
      return fieldItems(fieldsFor(rec.instance.manifest, rec.instance), {
        // A FUNCTION, not a snapshot: two presses without a repaint in between would
        // otherwise step from the same stale value twice, and the second press would look
        // dropped — which somebody debugs as a broken switch.
        values: () => rec.state.get() || {},
        level: complexity(),
        onStep: (key, value) => { rec.state.set({ [key]: value }); },
      });
    },
    // THE MENU'S OTHER CONTENT: things the shell should not know about, contributed by the
    // host through `extras` — which is what that hook was for.
    // THE TWO DIAGNOSTIC PAGES. Read lazily through `runtime`, because the menu is built
    // before the input stack is - and because both answer "right now", so a snapshot taken
    // at mount time would be a lie by the time anybody opened it.
    pages: {
      get controls() { return runtime ? controlPages({ runtime, subjectName }).controls : undefined; },
      get activity() { return runtime ? controlPages({ runtime, subjectName }).activity : undefined; },
      // WHAT ELSE THIS CAN TALK TO. Always present, at every complexity level, because a page
      // that is itself hidden until you are advanced enough defeats its own purpose - it
      // exists so that everything ELSE can hide without becoming a secret.
      get connections() {
        return connectionsPage({
          states: () => (settings.get() || {}).connections || {},
          level: complexity,
        });
      },
    },
    extras: () => [
      ...(runtime ? CONTROL_ITEMS : []),
      ...CONNECTION_ITEMS,
      // LETTING THE SCREEN FIX ITSELF, as an ordinary settings row. Turning recovery on used
      // to mean hand-writing state; now it is one press, which is what "turn it on for the
      // bench first" has to mean in practice. Written to the same profile settings blob the
      // engine reads, so there is one source of truth rather than two.
      { kind: 'heading', id: 'recovery-head', label: 'When something stops working' },
      ...fieldItems(RECOVERY_SETTINGS.map(normalizeField).filter(Boolean), {
        values: () => (settings.get() || {}).recovery || {},
        level: complexity(),
        onStep: (key, value) => {
          const cur = (settings.get() || {}).recovery || {};
          settings.set({ recovery: { ...cur, [key]: value } });
        },
      }),
      ...restartItems(restart, {
      screenName: profile?.name ? `“${profile.name}”` : 'this screen',
      onChange: ({ mode }) => {
        // Choosing "always come back here" names THE SCREEN YOU ARE STANDING ON. That is
        // the gesture: walk to the one that works, and say come back here.
        restart = writeConfig(user, mode === 'screen'
          ? { mode, screenId: profileId }
          : { mode }, storage);
        menu.refresh();
      },
    })],
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
  let drive = null;
  (async () => {
    try {
      const p = await profiles.get(profileId);
      if (!p?.person_id) return;
      personId = p.person_id;
      if (profiles.people) {
        const who = (await profiles.people()).find((x) => x.id === p.person_id);
        if (who) { whoName = who.name; menu.refresh(); }
      }
      // REMOTE DRIVE. A verb arriving on the wire is published onto this screen's own
      // bus, so the router, the settings menu and every module answer it exactly as they
      // answer a switch in the room. Remote drive is not a second control path - it is the
      // same one with a longer wire, which is only possible because the input bus got here.
      //
      // AND THE SCREEN SAYS SO. Someone driving this screen from elsewhere is visible to
      // whoever is sitting in front of it: a person who cannot tell whether the thing in
      // front of them is being operated by somebody else has been made a passenger in their
      // own room. CONFIRMED BY MIKE 2026-08-26 as a SAFETY/CONSENT INVARIANT, which is the
      // only category of rule allowed to be absolute here. It is not a setting, it is not
      // hideable at any complexity level, and it does not bend for a nicer-looking screen.
      if (!makeState && profiles.personStateURL) {
        drive = attachDriveToBus(bus, {
          personId: p.person_id,
          user,
          // THE PERSON'S OWN GATE, READ LIVE. This is the whole of Mike's ruling in one
          // argument: the restrictions a driver is subject to are the ones set in the
          // person's section, the same ones the switch in the room is subject to. Read
          // through a function rather than captured, because the gate is flipped mid-session
          // - that IS the "work while she is fidgeting" gesture - and a captured value would
          // be whatever it happened to be when the socket opened.
          gate: () => runtime?.gate() || 'both',
          driverId: p.person_id,
          driverLabel: 'someone helping from another screen',
          onPresence: ({ drivers }) => {
            remoteEl.hidden = !(drivers > 0);
          },
        });
      }
      if (makeState || !profiles.personStateURL) return;
      personOff = await runtime.useState(createState({
        url: profiles.personStateURL(p.person_id, INPUTS_KEY),
        user,
        cacheKey: `person:${user}:${p.person_id}:${INPUTS_KEY}`,
      }));
      await startMarkerTracking(p.person_id);
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

  runtime = mountInputRuntime({
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

  // ---- THE CURSOR -------------------------------------------------------------------
  // Shell-level rather than a module, because it draws on top of whichever module is under
  // it and a module that could draw outside its own mount would break the one rule that lets
  // two copies of anything share a screen. See cursor.js.
  //
  // DEFAULTS TO 'tracking': with a mouse the operating system already draws a pointer, and a
  // second one on top would look like a bug to every desktop visitor. A hand tracker moves
  // nothing the OS knows about, so on that screen this is the only pointer there is.
  const cursorRoot = document.createElement('div');
  kioskEl.append(cursorRoot);
  cursor = mountCursor(cursorRoot, {
    bus,
    aim: runtime.aim,
    settings: () => (settings.get() || {}).cursor || {},
  });
  // A settings edit should move the cursor now, not the next time somebody points.
  settings.subscribe?.(() => { try { cursor?.refresh(); } catch { /* never fatal */ } });

  // ---- RECOVERY: watch the panels, and act only if somebody asked --------
  //
  // *** OFF BY DEFAULT, AND THAT IS THE WHOLE DEPLOYMENT PLAN. ***
  //
  // The kiosk is served from the platform, so this file reaches EVERY screen the moment it
  // deploys - including hers, with no bench step in between. That is not a reason to keep the
  // code out; it is a reason for it to do nothing until somebody turns it on. Off by default
  // means the deploy is inert, the bench Pi can be switched on first, and the blast radius of
  // a bug here is exactly the screens that opted in.
  //
  // THE DECISION LAYER IS ELSEWHERE AND PURE. `health.js` decides whether a panel is broken;
  // `recovery.js` decides what to do about it. This function is only the hands - it performs
  // what it is told and reports what it did. Everything frightening about it has already been
  // walked at a fake clock in two test suites that mount nothing and reboot nothing.
  const health = createHealthWatch({ bus, now: recoveryNow });
  let recoveryHistory = {};
  let recoveryTimer = null;
  let currentFault = null;
  const swappedBack = new Map();          // module id -> the def it replaced

  const recoveryCfg = () => ({ on: false, ...DEFAULT_POLICY,
                               ...((settings.get() || {}).recovery || {}) });

  // A panel is watched from the moment it mounts. Cheap: a heartbeat is any publish on a
  // topic the module already owns, so nothing was added to any module for this.
  function watchRec(rec) {
    if (!rec) return rec;
    try { health.watch(rec.id, rec.type); } catch { /* a watch must never break a mount */ }
    return rec;
  }

  // Is anybody actually here? The reboot rung asks, and getting this wrong means rebooting a
  // screen somebody is using - the one way this feature could actively hurt.
  function screenInUse() {
    if (menu.isOpen()) return true;                       // somebody is standing here, editing
    if (drive?.presence?.().drivers > 0) return true;     // somebody is driving it from elsewhere
    const last = runtime?.recentActivity?.().slice(-1)[0];
    if (last?.at && recoveryNow() - last.at < 10 * 60 * 1000) return true;
    return false;
  }

  // What could replace a broken panel.
  //
  // SOMEBODY'S OWN ORDER FIRST (`recovery.fallbacks`), then the automatic ranking. The
  // ranking sorts by how exposed a module is, which has no idea that this particular person
  // loves her photos and is bored by the clock - only somebody who knows her does.
  //
  // Anything already on this screen is excluded, so a preference list does not have to
  // enumerate every combination: name two things, and whichever is usable gets used.
  // Swapping YouTube for the photos she is already looking at would change nothing and look
  // like the recovery did nothing.
  function fallbackFor(faultType) {
    const onScreen = new Set([stageRec?.type, ...slotRecs.map((r) => r.type)].filter(Boolean));
    return chooseFallback(recoveryCfg().fallbacks, listManifests(),
                          { exclude: [faultType, ...onScreen] });
  }

  function recFor(id) {
    if (stageRec?.id === id) return stageRec;
    return slotRecs.find((r) => r.id === id) || null;
  }

  async function remountPanel(id) {
    const rec = recFor(id);
    if (!rec) return false;
    const def = profile.modules.find((m) => m.id === id) || { id, type: rec.type };
    const host = rec.el;
    destroyRec(rec);
    host.innerHTML = '';
    const fresh = watchRec(await mountInstance(def, host));
    if (stageRec?.id === id) stageRec = fresh;
    else {
      const at = slotRecs.findIndex((r) => r.id === id);
      if (at >= 0) slotRecs[at] = fresh;
    }
    return true;
  }

  async function swapPanel(id, toType) {
    const rec = recFor(id);
    if (!rec || !toType) return false;
    const host = rec.el;
    // Remembered so the panel can come BACK. A module that recovers should get its slot
    // again without anybody driving there, and without this the swap is permanent.
    swappedBack.set(id, { id, type: rec.type });
    health.forget(id);
    destroyRec(rec);
    host.innerHTML = '';
    const fresh = watchRec(await mountInstance({ id, type: toType }, host));
    if (stageRec?.id === id) stageRec = fresh;
    else {
      const at = slotRecs.findIndex((r) => r.id === id);
      if (at >= 0) slotRecs[at] = fresh;
    }
    return true;
  }

  async function recoveryStep() {
    const cfg = recoveryCfg();
    if (!cfg.on) return null;                    // the whole feature, in one line

    const faults = health.faults();
    if (!faults.length) {
      // Recovered. Forget the per-fault history so the cheap rungs are available again if it
      // comes back - the windows survive, which is what stops a returning fault rebooting
      // the screen every twenty minutes.
      if (currentFault) { recoveryHistory = cleared(recoveryHistory); currentFault = null; }
      return null;
    }
    const f = faults[0];
    if (currentFault !== f.module) { currentFault = f.module; }

    const decision = nextAction(
      { module: f.module, since: f.since, kind: f.kind },
      recoveryHistory,
      {
        now: recoveryNow(),
        hour: new Date(recoveryNow()).getHours(),
        inUse: screenInUse(),
        // A fallback is only offered for a panel that is genuinely broken. "Nothing to show"
        // is a setup state with a human repair, and swapping her photos away because nobody
        // has connected a source yet would hide the very thing somebody needs to see.
        fallback: f.kind === 'empty' ? null : fallbackFor(f.type),
        canReboot: !!rebootDevice,
        urgency: f.kind === 'errored' ? 'normal' : 'quiet',
      },
      cfg,
    );

    const done = (extra = {}) => {
      onRecovery?.({ ...decision, fault: f, ...extra });
      return { ...decision, fault: f, ...extra };
    };

    if (decision.action === 'remount') {
      const ok = await remountPanel(f.module);
      recoveryHistory = applied(recoveryHistory, 'remount', recoveryNow());
      return done({ performed: ok });
    }
    if (decision.action === 'reload') {
      recoveryHistory = applied(recoveryHistory, 'reload', recoveryNow());
      const out = done({ performed: true });
      reloadPage();
      return out;
    }
    if (decision.action === 'swap') {
      const ok = await swapPanel(f.module, decision.to);
      recoveryHistory = applied(recoveryHistory, 'swap', recoveryNow());
      return done({ performed: ok });
    }
    if (decision.action === 'reboot') {
      recoveryHistory = applied(recoveryHistory, 'reboot', recoveryNow());
      const out = done({ performed: true });
      try { rebootDevice?.(decision); } catch { /* a helper that is not there is not a crash */ }
      return out;
    }
    if (decision.action === 'notify') {
      recoveryHistory = applied(recoveryHistory, 'notify', recoveryNow());
      return done({ performed: true });
    }
    return done({ performed: false });     // wait / hold / done - nothing to do yet
  }

  if (recoveryTick > 0) {
    recoveryTimer = setInterval(() => { recoveryStep().catch(() => {}); }, recoveryTick);
  }

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
    // The speaker arbiter, so a test (and a future call handler) can reach hush and the
    // call mode without going through a module.
    audio: () => audio,
    cameraOwner: () => cameraOwner,
    // The screen currently showing here, and the swap itself - for a test, and for anything
    // that wants to drive it without going through the bus.
    screenId: () => profileId,
    showScreen,
    showPreviousScreen,
    screenStack: () => [...screenStack],
    stageCount: () => stageDefs.length,
    // NOTE: `layout()` was already taken by the mirror/clock HUD positions below. A second
    // `layout:` key in this same object literal is silently shadowed by it — which is
    // exactly what happened first time. This one is the composed SLOT layout.
    slotLayout: () => (layout ? { ...layout } : null),
    slotCount: () => slotRecs.length,
    slotTypes: () => slotRecs.map((r) => r.type),
    hasCamera: () => !!cameraRec,
    hasClock: () => !!clockRec,
    // WHAT IS ACTUALLY MOUNTED, not what was intended. Those were the same thing until the
    // recovery swap arrived; reporting the DEF after a panel had been replaced meant this
    // said "photos" while the screen showed a clock, which is precisely the class of quiet
    // lie the rest of this project keeps rooting out. `stageDefs` is the plan, `stageRec` is
    // the truth, and a caller asking what is on the stage wants the truth.
    primaryType: () => stageRec?.type ?? stageDefs[primary]?.type ?? null,
    // The focused panel's own saved settings. Exposed so a test can assert WHAT LANDED in
    // storage rather than what the menu says it stored - a row can read "8 seconds" while
    // holding the string "8", and the difference only shows up much later, when somebody
    // tries to compare or group settings across panels.
    stageState: () => ({ ...(stageRec?.state.get() || {}) }),
    mirrorFull: () => mirrorFull,
    layout: () => ({ mirrorSize: kioskEl.dataset.mirrorSize, mirrorCorner: kioskEl.dataset.mirrorCorner, clockCorner: kioskEl.dataset.clockCorner }),
    showPrimary,
    menu,
    runtime,
    // The recovery machinery, exposed so a test can drive it a step at a time rather than
    // waiting on a timer, and so a diagnostic page can show what it currently thinks.
    health,
    recovery: {
      step: recoveryStep,
      faults: () => health.faults(),
      history: () => ({ ...recoveryHistory }),
      enabled: () => recoveryCfg().on,
      inUse: screenInUse,
      fallbackFor,
      // Whether the reboot rung exists on THIS device. No browser on any platform can restart
      // the host OS, so it is false unless a Nimrod appliance supplied a local helper - and
      // the ladder skips the rung rather than waiting on something that can never happen.
      canReboot: () => !!rebootDevice,
    },
    restart: () => ({ ...restart }),
    drive: () => drive,
    next: nextInPrimary,
    toggleMirrorFull,
    setMirror: patchMirror,
    destroy() {
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('mousemove', poke);
      clearTimeout(hideT);
      clearInterval(recoveryTimer);
      health.destroy();
      destroyRec(stageRec); destroyRec(cameraRec); destroyRec(clockRec);
      while (slotRecs.length) destroyRec(slotRecs.pop());
      settings.destroy();
      menu.destroy();
      try { personOff?.(); } catch { /* already gone */ }
      offsScreen.forEach((off) => { try { off(); } catch { /* already gone */ } });
      try { drive?.close(); } catch { /* already gone */ }
      // Silences anything mid-sentence as well as clearing the queue. A screen that is being
      // torn down must not keep talking.
      try { output?.destroy(); } catch { /* already gone */ }
      try { audio?.destroy(); } catch { /* already gone */ }
      try { cameraOwner?.destroy(); } catch { /* already gone */ }
      try { cursor?.destroy(); } catch { /* already gone */ }
      try { markerTracker?.destroy(); } catch { /* already gone */ }
      try { micOwner.destroy(); } catch { /* already gone */ }
      try { markerState?.destroy?.(); } catch { /* already gone */ }
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
