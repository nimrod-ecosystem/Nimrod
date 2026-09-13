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
import { mountModule } from './module.js';
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

  const live = new Map();   // host element -> record, so a page can unmount what it mounted

  return {
    bus, output, audio, profileId, backend, sources, aim,

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
      const state = backend.makeState(`${type}-try`, {}, profileId);
      const events = backend.makeEvents(`${type}-try`, {}, profileId);
      state.load?.().catch(() => {});      // offline is not a reason to have no module
      events.load?.().catch(() => {});
      const rec = mountModule(type, {
        mount: host, bus, rootBus: bus, user: null, profileId, personId: null,
        instanceId: `${type}-try`,
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
      live.set(host, rec);
      return rec;
    },

    /** Take one down. Safe to call on a host that has nothing on it. */
    unmount(host) {
      const rec = live.get(host);
      if (!rec) return;
      live.delete(host);
      try { rec.destroy(); } catch (err) { console.error('module_try: destroy', err); }
      host.innerHTML = '';
    },

    /** Everything, for a page teardown. */
    destroy() {
      for (const host of [...live.keys()]) this.unmount(host);
      detachAim();
      aim.destroy();
    },
  };
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
  const sources = createLocalMediaSources();        // per-DEVICE folder sources; real either way
  const output = createOutputBus({ channels: defaultChannels({}) });
  const audio = createAudioBus();
  const cameraOwner = createCameraOwner();
  const micOwner = createMicOwner();
  const rand = Math.random;
  const { aim, detach: detachAim } = attachAim(bus, window);

  const live = new Map();

  /** Find this profile's instance of `type`, adding one for real if it has none yet --
   *  picking a module here is how you add it to your dashboard, same as the composer. */
  async function ensureInstance(type) {
    let mod = profile.modules.find((m) => m.type === type);
    if (mod) return mod;
    mod = await profiles.addModule(profileId, type);
    profile.modules.push(mod);
    return mod;
  }

  return {
    bus, output, audio, profileId, profile, sources, aim, live: true,

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
        mount: host, bus, rootBus: bus, user, profileId, personId: null,
        instanceId: mod.id,
        state,
        events,
        makeState: (key, opts) => createState({ url: profiles.stateURL(profileId, key), user, ...opts }),
        makeEvents: (key, opts) => createEvents({ url: profiles.eventsURL(profileId, key), user, ...opts }),
        output, audio, micOwner, cameraOwner, sources, rand,
        callTransport: null,
        aim,
        ...extra,
      });
      rec.init();
      live.set(host, rec);
      return rec;
    },

    unmount(host) {
      const rec = live.get(host);
      if (!rec) return;
      live.delete(host);
      try { rec.destroy(); } catch (err) { console.error('module_try: destroy', err); }
      host.innerHTML = '';
    },

    destroy() {
      for (const host of [...live.keys()]) this.unmount(host);
      detachAim();
      aim.destroy();
    },
  };
}
