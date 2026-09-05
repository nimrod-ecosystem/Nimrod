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

  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const live = new Map();   // host element -> record, so a page can unmount what it mounted

  return {
    bus, output, audio, profileId, backend, sources,

    /**
     * Mount `type` into `host`. Returns the module record, or throws — the caller decides what
     * a failure looks like, because a dev harness wants to report it and a public page wants
     * to quietly say "this one needs a camera".
     */
    mount(type, host, extra = {}) {
      const rec = mountModule(type, {
        mount: host, bus, rootBus: bus, user: null, profileId, personId: null,
        instanceId: `${type}-try`,
        state: backend.makeState(`${type}-try`, {}, profileId),
        events: backend.makeEvents(`${type}-try`, {}, profileId),
        makeState: (key, opts) => backend.makeState(key, opts, profileId),
        makeEvents: (key, opts) => backend.makeEvents(key, opts, profileId),
        makePersonState: backend.makePersonState,
        output, audio, micOwner, cameraOwner, sources, rand,
        // The kiosk builds this from a live drive socket. There is none here, and a module
        // that says so on screen is more use than one reporting a failure it does not have.
        callTransport: null,
        aim: null,
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
    },
  };
}
