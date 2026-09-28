// module_try.js — MOUNT A MODULE FOR SOMEBODY TO LOOK AT, WITH NOTHING SET UP FIRST.
//
// A module needs a lot before it will run: a bus, an output bus, an audio arbiter, camera and
// microphone owners, a media-source registry, per-instance state and events, and a profile to
// hang them on. The kiosk builds all of that from a signed-in account. A page that just wants
// to SHOW somebody what Photos looks like has none of it.
//
// This is that scaffolding, once, so the two pages that mount modules for looking at do not
// keep a copy each:
//
//   * `modules.html` — the public page describing what you can put on a screen. It could
//     describe a module but never show one, which for a page whose whole job is "should I add
//     this?" is the wrong half of the answer.
//   * `dev/modules_live.html` — the harness that mounts every module and judges whether it
//     actually rendered. It had this scaffolding inline, and it was the only copy.
//
// *** EVERYTHING IT TOUCHES IS LOCAL AND THROWAWAY. *** The backend is `createLocalBackend()`,
// so nothing here reaches the platform, nothing needs an account, and nothing a visitor does
// while poking at a demo panel is written to anybody's real screen. That is what makes it safe
// to put on a public page.

import { createBus } from './bus.js';
import { mountModule, getManifest } from './module.js';
import { createOutputBus } from './output.js';
import { defaultChannels } from './output_channels.js';
import { createAudioBus } from './audio_bus.js';
import { createCameraOwner } from './camera_owner.js';
import { createMicOwner } from './mic_owner.js';
import { createLocalBackend, createLocalMediaSources, seedStarterScreen } from './local_store.js';
import { createProfilesClient, ensureProfile } from './profile.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createAim } from './aim.js';
import { attachPointer } from './input_pointer.js';
import { mountInputRuntime } from './input_runtime.js';
import { DEFAULT_BINDINGS } from './input_keyboard.js';

// *** "EVERY MODULE SHOULD BE FULLY FUNCTIONAL THERE." *** Mike, 2026-09-13, direct
// correction of an earlier decision recorded in this file: "That's the opposite of what I
// want... The modules page is where you use the modules. It's likely to end up being the
// most used page." `aim: null` below used to be argued as deliberate — this page as "a
// settings editor for one module, not a full kiosk." That reasoning did not come from Mike
// and is not what he wants; removed rather than left to mislead the next reader.
//
// Comet's whole point is the head sitting exactly on the cursor (`aim.js`'s own header
// comment) — with no aim producer it renders correctly and simply never moves, which reads
// as broken rather than as a missing feature. This attaches a real aim tracker the same way
// `input_runtime.js` does for the kiosk: `createAim({bus})` feeding `attachPointer`'s
// pointermove reporting. Only the movement half — no buttons are bound here, since neither
// host builds the binding/device layer a real kiosk has, and a bound switch is a separate,
// larger piece of "fully functional" than a mouse or a finger moving the aim.
function attachAim(bus, host) {
  const aim = createAim({ bus });
  // `attachPointer` also wires button-press interception (`onDown`/`onUp`), which needs a
  // real input bus this page does not have. A stub that never claims a binding or a capture
  // keeps those handlers inert without pulling in the whole input stack just for movement.
  const stubInput = { isCapturing: () => false, hasBinding: () => false, down() {}, up() {} };
  const detach = attachPointer(stubInput, { target: host, aim });
  return { aim, detach };
}

/**
 * Build the world a module needs, once, and hand back something that can mount one into any
 * element.
 *
 * `seed` fixes the random sequence so two visits to the same page look the same — a difference
 * between two runs should mean something changed, not that a shuffle came out differently.
 */
export async function createTryHost({ seed = 20260902, profileSeed = true } = {}) {
  const bus = createBus();
  const backend = createLocalBackend();
  // The starter screen exists so the modules that show CONTENT have some. Without it, Photos
  // and YouTube would both report "nothing here", which is true and completely unhelpful to
  // somebody deciding whether to add them.
  const profile = profileSeed
    ? await seedStarterScreen(backend.profiles, backend.makeSettings, backend.makeState)
    : null;
  const profileId = profile ? profile.id : 'demo';
  const sources = createLocalMediaSources();
  const output = createOutputBus({
    channels: defaultChannels({
      mount: document.createElement('div'),
      events: backend.makeEvents('output', {}, profileId),
    }),
  });
  const audio = createAudioBus();
  const cameraOwner = createCameraOwner();
  const micOwner = createMicOwner();
  // Window-scoped, not per-mount: only one module shows at a time on this page (see
  // modules.html's "one at a time, in the big stage"), and a mouse or finger moving
  // anywhere over it should count, the same as it would on a real kiosk.
  const { aim, detach: detachAim } = attachAim(bus, window);

  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // `{rec, id, type}` per host, not just `rec` — the input runtime's own `modules()` needs to
  // list what is actually mounted right now, and deriving that from this one map (rather than
  // a separate "currently mounted" variable) stays correct even if a caller ever mounts more
  // than the "one at a time" the page above assumes, instead of silently trusting that
  // assumption never breaks.
  const live = new Map();   // host element -> {rec, id, type}

  // *** THE BINDABLE INPUT LAYER, ADDED 2026-09-19 — step 3 of the ruled port order
  // (devices as modules, keyboard first) needs somewhere to actually try a keyboard module
  // against real bindings, not just aim's movement-only reporting. ***
  //
  // Reuses `mountInputRuntime` rather than inventing a second copy of the wiring — its own
  // header names exactly this case: "headless and injectable, so it can be... mounted by any
  // surface: kiosk today, a bare module host tomorrow." Fallback bindings only, matching this
  // host's own "everything is throwaway" contract — there is no per-person record to load
  // against a `createLocalBackend()`.
  const runtime = mountInputRuntime({
    bus,
    fallback: DEFAULT_BINDINGS,
    modules: () => [...live.values()].map((v) => ({ id: v.id, type: v.type })),
  });
  await runtime.load();

  return {
    bus, output, audio, profileId, backend, sources, aim, runtime,

    /**
     * Mount `type` into `host`. Returns the module record, or throws — the caller decides what
     * a failure looks like, because a dev harness wants to report it and a public page wants
     * to quietly say "this one needs a camera".
     */
    /**
     * *** THE HANDLES ARE LOADED BEFORE `init()`, THE WAY THE KIOSK DOES IT. ***
     *
     * They were not, and the difference is invisible until it is not. `state.subscribe` replays
     * the current value only `if (loaded)`, so a module that does its first-run work from that
     * callback — `educational.js` did — never ran it here: the kiosk awaits `state.load()`
     * before `init()`, and this did not. The result was a module with seven built-in items
     * rendering an empty box on the one public page whose job is showing modules, and being
     * read as a weak module rather than a host that skipped a step.
     *
     * `load()` is fired and NOT awaited, because `mount` is synchronous and every caller
     * expects a record back immediately. That is enough: it makes the handle report `loaded`
     * and replay to subscribers as soon as it resolves, which is all the contract promises.
     * Modules should not depend on it having happened — `educational.js` now reads
     * `state.get()` directly for the same reason — but a host should still keep its side.
     */
    mount(type, host, extra = {}) {
      const instanceId = `${type}-try`;
      const state = backend.makeState(instanceId, {}, profileId);
      const events = backend.makeEvents(instanceId, {}, profileId);
      state.load?.().catch(() => {});      // offline is not a reason to have no module
      events.load?.().catch(() => {});
      const rec = mountModule(type, {
        mount: host, bus, rootBus: bus, user: null, profileId, personId: null,
        instanceId,
        state,
        events,
        makeState: (key, opts) => backend.makeState(key, opts, profileId),
        makeEvents: (key, opts) => backend.makeEvents(key, opts, profileId),
        makePersonState: backend.makePersonState,
        output, audio, micOwner, cameraOwner, sources, rand,
        // The kiosk builds this from a live drive socket. There is none here, and a module
        // that says so on screen is more use than one reporting a failure it does not have.
        callTransport: null,
        aim,
        ...extra,
      });
      rec.init();
      live.set(host, { rec, id: instanceId, type });
      try { runtime.router.setFocus(instanceId); } catch { /* focus is not load-bearing */ }
      return rec;
    },

    /** Take one down. Safe to call on a host that has nothing on it. */
    unmount(host) {
      const entry = live.get(host);
      if (!entry) return;
      live.delete(host);
      try { entry.rec.destroy(); } catch (err) { console.error('module_try: destroy', err); }
      host.innerHTML = '';
    },

    /** Everything, for a page teardown. */
    destroy() {
      for (const host of [...live.keys()]) this.unmount(host);
      detachAim();
      aim.destroy();
      runtime.destroy();
    },
  };
}

/**
 * Find this profile's instance of `type`, adding one for real if it has none yet -- picking a
 * module on the modules page is how you add it to your dashboard, same as the composer. One
 * function so `createLiveHost` and `mountEmbeddedKiosk` (below) cannot disagree about it.
 * `profile.modules` is the caller's cached copy and is mutated so it stays truthful.
 */
export async function ensureModuleInstance(profiles, profileId, profile, type) {
  let mod = profile.modules.find((m) => m.type === type);
  if (mod) return mod;
  mod = await profiles.addModule(profileId, type);
  profile.modules.push(mod);
  return mod;
}

/**
 * `createTryHost`'s signed-in twin. `/modules.html` mounted every module against a
 * throwaway local backend regardless of whether the visitor had an account -- which meant
 * a signed-in person configuring a YouTube schedule there was writing to a sandbox no
 * kiosk could ever read, and the real kiosk correctly showed nothing (Mike, 2026-09-08,
 * live: "The modules page is where you should be able to access the modules without a
 * kiosk. It's not meant to be a separate sandbox. It is where you set up your modules.").
 * That was the actual bug -- the page's whole visual language says "configure your
 * modules here," and for a signed-in visitor it should mean that literally.
 *
 * This mounts against the visitor's REAL default screen (the same one `ensureProfile`
 * hands the kiosk), using the same `createState`/`createEvents` + `/api/profiles/...`
 * URLs kiosk.js's own `stateFor`/`eventsFor` use -- so a setting changed here is the same
 * setting the kiosk reads, not a parallel copy of it.
 *
 * *** STILL NOT THE FULL KIOSK WORLD, BUT LESS SHORT OF IT THAN IT WAS. *** This comment
 * used to claim "no person-aim tracking" was deliberate, part of what keeps this page "a
 * settings editor for one module at a time" rather than a second kiosk. Mike, 2026-09-13,
 * direct correction: "That's the opposite of what I want... Every module should be fully
 * functional there." That reasoning was never his; removed rather than left for the next
 * reader to trust. Aim (mouse/finger position) is wired below, the same producer the real
 * kiosk uses (`aim.js` + `attachPointer`) — no call transport or live drive socket yet,
 * since those need a person on the other end of a call, which nothing on this page has.
 */
export async function createLiveHost({ user }) {
  const bus = createBus();
  const profiles = createProfilesClient({ user });
  const profileId = await ensureProfile(profiles, user);
  const profile = await profiles.get(profileId);   // profile.modules cached + mutated below
  // WHOSE SCREEN THIS IS — the same fact `profile.person_id` already carries for the real
  // kiosk (`kiosk.js`'s own boot lookup reads it identically). Was hardcoded `null` in this
  // host's `mount()` ctx below; a module that reads `ctx.personId` here saw nobody, even
  // though the profile it was mounted against genuinely belongs to somebody.
  const personId = profile.person_id || null;
  const sources = createLocalMediaSources();        // per-DEVICE folder sources; real either way
  const output = createOutputBus({ channels: defaultChannels({}) });
  const audio = createAudioBus();
  const cameraOwner = createCameraOwner();
  const micOwner = createMicOwner();
  const rand = Math.random;
  const { aim, detach: detachAim } = attachAim(bus, window);

  // `{rec, id, type}` per host — see createTryHost's own comment on why this drives the input
  // runtime's `modules()` directly rather than a separate "currently mounted" variable.
  const live = new Map();

  // *** THE BINDABLE INPUT LAYER, ADDED 2026-09-19 — FALLBACK BINDINGS ONLY, DELIBERATELY,
  // REVERSED FROM THAT DAY'S ORIGINAL REASONING 2026-09-20. ***
  //
  // This used to also load the person's REAL saved bindings here (`runtime.useState(...)`
  // against `profiles.personStateURL`), on the reasoning that "trying a module here means
  // trying it against the actual switch setup it will really be used with." That reasoning
  // was wrong in exactly the case it was meant to help: `input_pointer.js`'s own header names
  // it outright — "a great many switch interfaces present themselves to the computer as a
  // MOUSE CLICK" — so anyone whose real setup binds a mouse-presenting switch to a verb (a
  // common case, not an edge one) found their own direct mouse clicks on THIS PREVIEW's
  // answer buttons hijacked by that binding: a click on one option registered as "confirm
  // whatever the scan cursor is on" instead, which only reads as "clicking answers doesn't
  // work" — reported by Mike, reproduced directly (`modules.html`'s Trivia/Word Forge
  // preview, a real saved `pointer:mouse -> verb/select` binding from an earlier session).
  //
  // Mike's own framing of this page settles which side of the tradeoff wins: "it's more of a
  // place to try out the different software modules" — the MODULE's behavior, not a person's
  // own accessibility calibration. Testing a real switch against a real module belongs on the
  // real dashboard/kiosk, where there is no competing direct-click surface to collide with.
  // Fallback-only matches `createTryHost`'s already-safe behavior, so this preview no longer
  // depends on what happens to be bound on whichever account is previewing it.
  const runtime = mountInputRuntime({
    bus,
    fallback: DEFAULT_BINDINGS,
    modules: () => [...live.values()].map((v) => ({ id: v.id, type: v.type })),
  });
  await runtime.load();

  const ensureInstance = (type) => ensureModuleInstance(profiles, profileId, profile, type);

  return {
    bus, output, audio, profileId, profile, sources, aim, runtime, live: true,

    /** MUST be awaited before `mount(type, ...)` — resolving/creating the real instance
     *  is a network call, unlike the throwaway host's synthetic per-type key. */
    ensure: ensureInstance,

    mount(type, host, extra = {}) {
      const mod = profile.modules.find((m) => m.type === type);
      if (!mod) throw new Error(`module_try: ${type} was not ensured before mount`);
      const state = createState({ url: profiles.stateURL(profileId, mod.id), user });
      const events = createEvents({ url: profiles.eventsURL(profileId, mod.id), user });
      state.load?.().catch(() => {});
      events.load?.().catch(() => {});
      const rec = mountModule(type, {
        mount: host, bus, rootBus: bus, user, profileId, personId,
        instanceId: mod.id,
        state,
        events,
        makeState: (key, opts) => createState({ url: profiles.stateURL(profileId, key), user, ...opts }),
        makeEvents: (key, opts) => createEvents({ url: profiles.eventsURL(profileId, key), user, ...opts }),
        // Real gap, found while wiring the keyboard module's ctx: this host never exposed
        // `makePersonState` at all, unlike `createTryHost` (which passes its local backend's
        // version straight through). Same `(personId, key, opts)` shape as everywhere else.
        makePersonState: (pid, key, opts = {}) => (profiles.personStateURL
          ? createState({ url: profiles.personStateURL(pid, key), user, ...opts })
          : null),
        output, audio, micOwner, cameraOwner, sources, rand,
        callTransport: null,
        aim,
        ...extra,
      });
      rec.init();
      live.set(host, { rec, id: mod.id, type });
      try { runtime.router.setFocus(mod.id); } catch { /* focus is not load-bearing */ }
      return rec;
    },

    unmount(host) {
      const entry = live.get(host);
      if (!entry) return;
      live.delete(host);
      try { entry.rec.destroy(); } catch (err) { console.error('module_try: destroy', err); }
      host.innerHTML = '';
    },

    destroy() {
      for (const host of [...live.keys()]) this.unmount(host);
      detachAim();
      aim.destroy();
      runtime.destroy();
    },
  };
}

// =====================================================================================================
// THE REAL KIOSK, IN A BOX ON THE MODULES PAGE.
//
// Mike, 2026-09-13: the modules page "is where you use the modules... every module should be
// fully functional there". A module whose settings are reachable only through the universal
// settings menu (camera, clock and photos hide their inline gear on purpose) had none there,
// because the transport bar and that menu existed only inside `kiosk.js`. And DECISIONS.md
// (2026-09-17): a dashboard is a module that contains modules, so there should be ONE
// implementation of the bar and the menu, built once. So this does not copy the chrome into the
// hosts above: it mounts `mountKiosk` itself, sized to the stage box (`embedded: true`, kiosk.css's
// `.k-embed`).
//
// *** WHAT `embedded` TURNS OFF, AND WHY THIS PAGE NEEDS EACH ONE *** (the full list is on the
// option in kiosk.js): no remote-drive socket, so a page open in a tab never presents itself as
// somebody's screen; and FALLBACK BINDINGS ONLY, never the person's saved ones, which is the same
// reversal `createLiveHost` documents above (a saved `pointer:mouse` binding turns every direct
// click on a preview into a switch press).
//
// *** THE HUD TYPES GET A ONE-SLOT LAYOUT, SO THEY ARE PANELS TOO. *** Unplaced, the kiosk draws the
// camera and clock as overlays and ambient modules as a background layer, with no bar or menu of
// their own -- which first shipped here as "plain host, no chrome" and left their settings
// unreachable on this page. But `partition()` treats ANY module placed in a slot as an ordinary
// panel, so for those types this hands the kiosk `embedLayout: {preset:'full', slots:[id]}` (held
// in memory only; kiosk.js never writes a layout back) and they get the same bar and menu as
// everything else. `isKioskPanel` now only decides which types need that placement.
// =====================================================================================================

/** Does the kiosk show this type as a PANEL (a chip on the bar, a slot or the stage)? */
export function isKioskPanel(type) {
  return !!type && type !== 'camera' && type !== 'clock' && getManifest(type)?.mount !== 'ambient';
}

// An in-memory stand-in for localStorage/sessionStorage. The kiosk remembers "where she left off"
// and "which screen to come back to" in device storage; an embed on a public page must not write
// either into the visitor's real browser storage, where the actual kiosk would later read it.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/**
 * Mount the real kiosk into `stage` with `type` brought forward. Returns
 * `{ kiosk, showModule(type), destroy() }`.
 *
 * SIGNED OUT (`user` falsy): a throwaway one-module screen for `type`, over the browser's local
 * backend. The screen is an in-memory object, NOT a row in the visitor's local profile list --
 * `createLocalProfilesClient().create()` would leave a "screen" behind on every pick (and after
 * every closed tab), and it would show up in their Dashboards and stop the starter screen from
 * ever being seeded. Only module state rows are written, under a `try-<type>` scope nothing lists.
 *
 * SIGNED IN: the visitor's REAL default screen (`ensureProfile`) and the REAL instance of `type`
 * on it -- added when missing (`ensureModuleInstance`, shared with `createLiveHost`) BEFORE the
 * kiosk boots, so the kiosk's module list is never stale. Its state, events and screen settings
 * are the real ones, so a change here is the change the dashboard reads. If `showModule` later
 * asks for a type the screen does not have, that adds it and rebuilds the kiosk, rather than
 * mutating the kiosk's internals.
 *
 * *** THE KIOSK IS HANDED THE SCREEN'S ONE PICKED MODULE, NOT THE WHOLE SCREEN. *** Mounting the
 * whole real screen was the first design, and it was tried: the visitor picks Trivia and gets
 * their entire dashboard -- the live camera overlay covering half of it (and opening the webcam
 * on a public page), the clock, every other panel mounting and playing at once. So `get()` is
 * scoped to the picked type, `list()` is empty (no other screens to hop to from a preview),
 * `moveToPerson` is withheld (a preview must not hand somebody's screen to another person), and
 * the kiosk ignores the saved arrangement (`embedded`). What is real is the instance and the
 * settings; what is deliberately not is the surrounding screen.
 *
 * `reloadPage` here means "rebuild this embed": the kiosk calls it for the recovery ladder's
 * reload rung, for a corrected layout arriving after boot, and after handing the screen to another
 * person. Reloading the modules page would be the wrong reading of any of them.
 */
export async function mountEmbeddedKiosk({ stage, user = null, type }) {
  // Dynamic, so the two hosts above (and every page that only wants THEM) do not drag in the
  // whole kiosk and, with it, every module registration -- `modules.html` deliberately does not
  // register `settings` or `keyboard`.
  const { mountKiosk } = await import('./kiosk.js');
  let kiosk = null;
  let current = type;
  let torn = false;
  let busy = false;
  let again = false;

  // A panel type needs no arrangement (it goes on the stage). A HUD/ambient type is PLACED in a one-
  // slot layout so it is a panel too -- see the header above.
  const placeFor = (id) => (isKioskPanel(current) ? null : { preset: 'full', slots: [id] });

  async function boot() {
    stage.innerHTML = '';
    const seams = {
      navigate: () => {},
      reloadPage: () => { rebuild().catch((err) => console.error('module_try: rebuild', err)); },
      storage: memoryStorage(), session: memoryStorage(),
      sources: createLocalMediaSources(),
      embedded: true,
    };
    if (user) {
      const real = createProfilesClient({ user });
      const profileId = await ensureProfile(real, user);
      const profile = await real.get(profileId);
      const mod = await ensureModuleInstance(real, profileId, profile, current);
      const pick = current;
      const { moveToPerson, ...rest } = real;   // withheld: see the header above
      const profiles = {
        ...rest,
        list: async () => [],
        get: async (id) => {
          const p = await real.get(id);
          return { ...p, modules: (p.modules || []).filter((m) => m.type === pick) };
        },
      };
      kiosk = await mountKiosk(stage, { ...seams, user, profileId, profiles, embedLayout: placeFor(mod.id) });
    } else {
      const backend = createLocalBackend();
      const profileId = `try-${current}`;
      const screen = { id: profileId, name: 'Try it', person_id: null,
                       modules: [{ id: `${current}-try`, type: current, position: 0 }] };
      const profiles = {
        list: async () => [],
        get: async () => ({ ...screen, modules: screen.modules.map((m) => ({ ...m })) }),
        stateURL: (pid, key) => `local:${pid}::${key}`,
        eventsURL: (pid, key) => `local:${pid}::${key}`,
      };
      kiosk = await mountKiosk(stage, {
        ...seams, user: null, profileId, profiles,
        makeState: backend.makeState, makeEvents: backend.makeEvents,
        embedLayout: placeFor(screen.modules[0].id),
      });
    }
    if (torn) { try { kiosk.destroy(); } catch { /* already gone */ } kiosk = null; return; }
    await kiosk.showModule(current);
  }

  function teardown() {
    const k = kiosk; kiosk = null;
    try { k?.destroy(); } catch (err) { console.error('module_try: kiosk destroy', err); }
    stage.innerHTML = '';
  }

  // One rebuild at a time; a request that arrives while one is running runs once after it. Capped
  // at three in a row: a kiosk that asks to be rebuilt every time it boots would otherwise spin
  // for ever on somebody's page, and a stale embed is a better failure than a busy loop.
  async function rebuild() {
    if (torn) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      let n = 0;
      do { again = false; teardown(); await boot(); } while (again && !torn && ++n < 3);
      again = false;
    } finally { busy = false; }
  }

  busy = true;
  try { await boot(); } finally { busy = false; }
  if (again) await rebuild();

  return {
    get kiosk() { return kiosk; },
    async showModule(t) {
      if (torn || !t) return false;
      current = t;
      if (kiosk && await kiosk.showModule(t)) return true;
      await rebuild();                    // not on this screen yet: rebuild around it
      return !!kiosk && kiosk.showModule(t);
    },
    destroy() {
      torn = true;
      teardown();
    },
  };
}
