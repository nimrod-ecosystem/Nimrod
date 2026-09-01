// director.js — the content DIRECTOR: a container module that runs the state
// machine (statemachine.js) and hands its OWN window to one segment provider at
// a time. This is Mike's "drop the state machine into the window you want and it
// hands its inner region to one child provider" — the shared stage is the
// container's own region, not a special global surface.
//
// It is a thin MODULE wrapper over the validated engine:
//   * config = the content-director machine (weighted daypart-gated rotation over
//     segment providers). Overridable from state.config; defaults baked below.
//   * it MOUNTS child provider modules into its own slots and shows one at a time.
//     The only real provider today is `youtube`; the rest render as labelled
//     placeholders until their modules land (Personal videos, Educational, …) —
//     the same "stub the not-yet-built half" pattern youtube used for its player.
//   * the engine subscribes to `segment/done` and, on it, weighted-picks the next
//     provider and publishes `<provider>/activate`; this module shows that slot.
//   * the BIG button skips the whole SEGMENT (emits `segment/done{skipped}`);
//     within-segment controls (youtube's own ‹ ›) stay inside the child.
//
// CHILD MOUNTING SEAM: a container needs to make per-child state/events handles and
// a bus its children can scope. The app passes those on ctx (additive, ignored by
// leaf modules): `rootBus` (children mount on it; mountModule re-scopes per child),
// `instanceId` (namespaces child storage keys), and `makeState`/`makeEvents`
// (per-key handle factories). Child storage lives under `<instanceId>.<provider>`,
// its own row — never colliding with a sibling instance.

import { registerModule, mountModule } from '../module.js';
import { createMachine } from '../statemachine.js';
import { createWatchdog } from '../watchdog.js';
import { HELD_BEGIN, HELD_END } from '../held.js';
import '../modules/wallpaper.js';   // registers the type this container raises over its stage

// Segment providers the director can rotate through. `real:true` mounts the actual
// module; `real:false` renders a placeholder until that module exists.
export const PROVIDERS = [
  { id: 'youtube',     label: 'Video',          real: true  },
  { id: 'personal',    label: 'Personal video', real: true  },
  { id: 'educational', label: 'Educational',    real: true  },
  { id: 'wordgame',    label: 'Word game',      real: false },
  { id: 'trivia',      label: 'Trivia',         real: false },
  { id: 'singalong',   label: 'Sing-along',     real: false },
];
const ALL = PROVIDERS.map((p) => p.id);

// The default machine config: a weighted daypart-gated rotation. Morning &
// sleepytime enable YouTube ONLY (they run their existing playlists — the person may
// be sleeping); daytime and primetime enable everything (Mike: "anything daytime
// can also be primetime"). Editable per profile via state.config later.
export const DIRECTOR_CONFIG = {
  initial: 'youtube',
  daypart: {
    enabled: {
      morning:    ['youtube'],
      daytime:    ALL,
      primetime:  ALL,
      sleepytime: ['youtube'],
    },
  },
  on: { 'segment/done': [ { pick: { from: ALL } } ] },
  states: Object.fromEntries(PROVIDERS.map((p) => [p.id, { enter: { publish: p.id + '/activate' } }])),
};

registerModule(
  { type: 'director', title: 'Lineup', description: 'Rotates videos, personal messages and learning by time of day, so the screen changes on its own' },
  (ctx) => {
    const { mount, bus, state, user, profileId } = ctx;
    const rootBus = ctx.rootBus || bus;                 // children mount here (re-scoped per child)
    const makeState = ctx.makeState;
    const makeEvents = ctx.makeEvents;
    const instanceId = ctx.instanceId || 'director';
    const io = ctx.machineIO || {};                     // {now,rand,setTimer,clearTimer} — injected in tests
    const setTimer  = io.setTimer  || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = io.clearTimer || ((id) => clearTimeout(id));
    const autoFinishMs = ctx.autoFinishMs != null ? ctx.autoFinishMs : 8000;  // placeholder segment length

    let machine = null;
    let current = null;
    let wallpaper = null;      // the held-state overlay (see THE WALLPAPER below)
    let heldBy = null;         // which provider published the hold we are covering
    let segmentWatch = null;   // the backstop over ANY provider (see below)
    const adapters = {};      // provider id -> { activate, deactivate, destroy, flush, resize }
    const slots = {};         // provider id -> slot element
    let phTimer = null;       // the active placeholder's auto-finish timer
    let torn = false;         // set first thing in destroy(); see the HELD_END handler

    const stage = () => mount.querySelector('[data-stage]');
    function setLabel(id) {
      const el = mount.querySelector('[data-dlabel]');
      const p = PROVIDERS.find((x) => x.id === id);
      if (el) el.textContent = p ? p.label : (id || '');
    }

    // Hand the window to one provider: hide the others, activate this one.
    function showProvider(id) {
      // Re-picking the SAME provider is normal (a weighted pick repeats), and it is still a
      // new segment — so the backstop must be re-armed here too. Without this it stayed
      // disarmed after the first timeout and the screen could freeze again with nothing
      // watching.
      if (id === current) { segmentWatch?.arm(id); adapters[id]?.activate?.(); return; }
      if (current && adapters[current]) adapters[current].deactivate?.();
      current = id;
      for (const pid of Object.keys(slots)) slots[pid].hidden = (pid !== id);
      setLabel(id);
      // *** ARM BEFORE ACTIVATING, AND THE ORDER IS LOAD-BEARING (fixed 2026-08-30). ***
      // `activate()` can hand straight back: an unconfigured provider publishes
      // `segment/done {reason:'empty'}` SYNCHRONOUSLY, which is deliberate — see
      // `makeChildAdapter` — and that re-enters this function for the next provider, which
      // arms the backstop for itself. Arming after the call then overwrote that fresh, correct
      // arm with one keyed to a provider no longer on screen, and the timeout it eventually
      // published named the wrong one. Found by `watchdog_test` once its clock was accurate
      // enough to run the rotation properly. The same order as the re-pick branch above.
      segmentWatch?.arm(id);
      adapters[id]?.activate?.();
    }

    // A not-yet-built provider: a themed card that auto-finishes after a beat, so the
    // rotation keeps flowing. Real modules replace these one slice at a time.
    function placeholderAdapter(p, el) {
      el.innerHTML =
        `<div class="d-ph"><div class="d-ph-kind">${p.label}</div>` +
        `<div class="d-ph-note">segment placeholder — real module lands in a later slice</div></div>`;
      return {
        activate() {
          if (phTimer != null) { clearTimer(phTimer); phTimer = null; }
          phTimer = setTimer(() => {
            phTimer = null;
            rootBus.publish('segment/done', { provider: p.id, reason: 'timeout' });
          }, autoFinishMs);
        },
        deactivate() { if (phTimer != null) { clearTimer(phTimer); phTimer = null; } },
        destroy() { this.deactivate(); },
      };
    }

    // A real provider mounted as a child module in its own slot (youtube, personal, …).
    // Child storage key = `<instanceId>-<providerId>` (server key rule [A-Za-z0-9_-]{1,64};
    // a 32-hex instanceId + dash never collides with a sibling id or the reserved
    // `settings` key). Seeded autoAdvance=false so the DIRECTOR advances it (via
    // `<id>/next` on re-activation), not the child — the child instead just fires
    // `segment/done` when its segment ends.
    function makeChildAdapter(p) {
      let child = null, cState = null, cEvents = null;
      return {
        async mount(el) {
          cState = makeState(`${instanceId}-${p.id}`);
          cEvents = makeEvents(`${instanceId}-${p.id}`);
          await cState.load(); await cEvents.load();
          // directed: the child does NOT autostart or self-advance — the director drives
          // every activation via `<id>/next`, so a hidden child never fires a spurious
          // segment/done, and an unconfigured provider hands straight back.
          const s = cState.get();
          if (s.autoAdvance !== false || s.directed !== true) cState.set({ autoAdvance: false, directed: true });
          child = mountModule(p.id, {              // provider id IS the module type
            mount: el, bus: rootBus, state: cState, events: cEvents, user, profileId,
            playerFactory: ctx.playerFactory,      // youtube uses it; others ignore it
            speak: ctx.speak,                      // educational uses it (real TTS in app; stub in tests)
            setTimer: io.setTimer, clearTimer: io.clearTimer,  // educational's display timer (fake in tests)
            // *** WHAT A CONTAINER OWES ITS CHILDREN. ***
            // A provider mounted here is the SAME module as one mounted directly on a screen,
            // and it has the same needs. Anything the host put on ctx that a child could use
            // has to be handed down or the child silently loses the feature — which is not a
            // crash, just a capability that is present on one surface and absent on the other.
            // `output` is here because a provider whose segment has stopped needs somewhere to
            // say so; `personId` because media is per-person.
            // *** STILL MISSING, DELIBERATELY, AND WRITTEN DOWN RATHER THAN QUIETLY ADDED:
            // `audio` and `cameraOwner`. A video mounted under the director never joins the
            // speaker arbiter, so a game's music plays over it and a spoken cue cannot duck
            // it. That is a real defect and a one-line fix, but it changes what the bedside
            // SOUNDS like, so it wants its own bench test rather than riding in on this one.
            output: ctx.output,
            get personId() { return ctx.personId; },
          });
          child.init();
          cState.startPolling(); cEvents.startPolling();
        },
        // every activation advances the child to its next segment (directed children
        // don't autostart, so this is what shows content; an empty one hands back).
        activate() { rootBus.publish(`${p.id}/next`); },
        // Tell the child it is hidden. It stays mounted (no pause API yet), but anything
        // it has armed — a stall watchdog especially — must stand down, or a hidden
        // provider will end the segment that is currently on screen.
        deactivate() { rootBus.publish(`${p.id}/deactivate`); },
        flush() { try { cState?.flush?.(); } catch { /* noop */ } },
        resize() { try { child?.onResize?.(); } catch { /* noop */ } },
        destroy() { try { child?.destroy(); } catch { /* noop */ } cState?.destroy?.(); cEvents?.destroy?.(); },
      };
    }

    // ------------------------------------------------------------------------------------
    // *** THE WALLPAPER, AND WHY IT IS AN OVERLAY RATHER THAN A STATE. ***
    //
    // Mike's shape was "a module the state machine swaps in", and the argument for it is
    // right: written per module it would be written three times and drift. But routing it
    // through the machine the way every other provider goes through it breaks the one thing
    // the same spec asks for — *"coming back must return to where she was."*
    //
    // Here is the mechanism, because it is not obvious from the config:
    // `showProvider()` deactivates the outgoing adapter, and for a real child `activate()` is
    // `publish('<id>/next')` — the verb means ADVANCE, not resume. A directed child does not
    // autostart, so that is the only way it ever shows anything. So a `wallpaper` state with
    // a `$back` transition would leave the hold correctly, come back to youtube, and then
    // advance it to the NEXT video: the paused clip somebody stepped away from would be gone,
    // which is exactly the thing the hold exists to prevent. The bug would look like a
    // wallpaper bug and live in the activation verb.
    //
    // Making `activate()` mean "advance, unless resuming" would put a second meaning inside
    // the one verb the whole rotation is built on, to serve a case that is not a rotation at
    // all. A hold is not a segment ending. Nothing finished, nothing should advance.
    //
    // So: the wallpaper is a CHILD OF THIS CONTAINER, mounted once, raised OVER the stage
    // while a hold is on and lowered when it ends. Nothing is deactivated, nothing advances,
    // and the paused segment is still exactly where she left it — which is also the literal
    // reading of the spec's own sentence: *"the paused segment is still there and still
    // marked paused; the wallpaper is what is shown meanwhile."*
    //
    // Mike's reason for wanting it in the container is fully served either way: it is written
    // once, and every provider — including ones not written yet — gets it for free by
    // publishing `held/begin` from `held.js`.
    //
    // *** WHAT THIS DOES NOT COVER, and it is worth a decision rather than a silence. ***
    // A youtube module mounted DIRECTLY on a screen, with no director around it, still shows
    // its frozen frame: this container is the only thing here that can mount a child, so it
    // is the only thing that can raise a wallpaper. Doing it for every screen means the SHELL
    // owning an overlay per pane, which is a bigger change than this one and touches every
    // module. Left undone deliberately; noted in `docs/for_chat/`.
    //
    // THE INVARIANT. The overlay is raised and lowered by facts on the bus, never by an input.
    // It comes down when the provider says the hold ended, when the provider is destroyed
    // (`held.js` releases on the way out), and when this container is torn down. The hold's
    // own notify clock is untouched underneath — the wallpaper changes what the wait looks
    // like, not how long it lasts or how it ends.
    // ------------------------------------------------------------------------------------

    function raiseWallpaper(by) {
      heldBy = by || null;
      const el = mount.querySelector('[data-wall]');
      if (!el || !wallpaper) return;
      if (!el.hidden) return;                 // already up; a second begin is not a second one
      el.hidden = false;
      wallpaper.onShow?.();
    }

    function lowerWallpaper() {
      heldBy = null;
      const el = mount.querySelector('[data-wall]');
      if (!el || el.hidden || !wallpaper) return;
      el.hidden = true;
      // Park its clock rather than leaving an animation running behind a hidden div for the
      // next six hours.
      wallpaper.onHide?.();
    }

    return {
      // The escape hatch documented in module.js: a container's overlay has no markup worth
      // asserting on from outside, and "is the wallpaper up" is the whole behaviour here.
      __probe: () => ({ current, heldBy, wallpaperUp: !mount.querySelector('[data-wall]')?.hidden,
                        wallpaperMounted: !!wallpaper }),
      init() {
        mount.innerHTML = `
          <div class="director">
            <div class="d-stage" data-stage></div>
            <div class="d-wall" data-wall hidden></div>
            <div class="d-bar">
              <span class="d-label" data-dlabel></span>
              <button class="d-skip" data-skip aria-label="skip this segment">Skip ▸</button>
            </div>
          </div>`;
        for (const p of PROVIDERS) {
          const slot = document.createElement('div');
          slot.className = 'd-slot'; slot.hidden = true; slot.dataset.prov = p.id;
          stage().append(slot); slots[p.id] = slot;
        }

        // the big Skip button skips the whole SEGMENT — it's just another source
        // onto segment/done, so any input (button, switch, scan) can drive it.
        const skip = bus.createSource('director-skip');
        bus.addBinding({ source: 'director-skip', signal: 'skip', topic: 'segment/done', transform: () => ({ reason: 'skipped' }) });
        mount.querySelector('[data-skip]').addEventListener('click', () => skip.emit('skip'));

        const saved = state.get() || {};

        // react to the engine's activation topics
        for (const p of PROVIDERS) bus.subscribe(`${p.id}/activate`, () => showProvider(p.id));

        // ---- THE BACKSTOP ----
        // A provider's own watchdog (youtube has one) is opt-in, so it cannot be relied on:
        // the next provider someone writes won't have one, and that is exactly the screen
        // that ends up frozen. So the director also watches the SEGMENT. Any provider that
        // is alive says so with `segment/progress`; silence for `segmentSilenceMs` means
        // the rotation moves on regardless of whose fault it was.
        //
        // It is deliberately much slower than a module's own watchdog (default 3 minutes,
        // against youtube's 20 seconds), because a long video is legitimately quiet between
        // heartbeats and cutting one off would be a worse bug than the one being fixed.
        // 0 disables it.
        const silenceMs = Number.isFinite(Number(saved.segmentSilenceMs))
          ? Number(saved.segmentSilenceMs) : 180000;
        segmentWatch = createWatchdog({
          setTimer, clearTimer, stallMs: silenceMs, retries: 0,   // no retry — it can't fix a child
          onGiveUp: (id) => {
            console.warn(`director: no progress from "${id}" — moving on`);
            rootBus.publish('segment/done', { provider: id, reason: 'timeout' });
          },
        });
        // beat(), not ok(): a segment is open-ended, so each heartbeat RESETS the clock.
        // ok() would stop watching after the first one.
        bus.subscribe('segment/progress', () => segmentWatch?.beat());
        // A finished segment is not a stalled one; the next activate re-arms it.
        bus.subscribe('segment/done', () => segmentWatch?.disarm());

        const cfg = saved.config || DIRECTOR_CONFIG;

        // The held signal, from whichever provider is on the stage. See THE WALLPAPER above.
        //
        // *** A HOLD SUSPENDS THE BACKSTOP. Mike's call, 2026-08-31. ***
        // A held provider stops publishing `segment/progress` — deliberately, because it is
        // paused and there is nothing advancing to report. The backstop cannot tell that
        // apart from a video that has frozen, so before this it timed out `segmentSilenceMs`
        // (3 min) into a hold, published `segment/done{timeout}`, and rotated the paused clip
        // away. That is the exact loss the hold exists to prevent, and it made the six-hour
        // `heldNotifyMs` setting unreachable on any directed screen: the pause never lasted
        // long enough to notify anybody.
        //
        // Mike: "it doesn't need to be watching for YouTube if we know YouTube is paused …
        // it's not supposed to be doing anything when it's paused, so the heartbeat's kind of
        // useless there." So the clock STOPS while held and restarts on release, and the
        // hold's own notify clock is what governs the length of a pause — which is what the
        // note above always claimed happened.
        //
        // Nothing is lost by suspending it: a held segment is by definition not advancing, so
        // there is no stall left for the backstop to detect. What it stops watching for is a
        // provider that dies WHILE held, and the exits from that are unchanged — the provider's
        // own destroy releases the hold (`held.js`), and this container's teardown lowers it.
        //
        // *** THE `torn` GUARD IS NOT DEFENSIVE PADDING — WITHOUT IT THIS LEAKS A TIMER. ***
        // `destroy()` disarms the backstop FIRST and destroys the adapters after, and
        // `held.js` releases a live hold on the way out. So a container torn down while held
        // publishes HELD_END after the disarm, and an unguarded re-arm here would start a
        // three-minute timer on a director that no longer exists — a screen watched by
        // something that has been told it is fine, which is the failure `health.js` and this
        // backstop both exist to prevent.
        //
        // The guard is a flag this file owns rather than a `reason` field off the payload,
        // deliberately: `held.js` says payloads are data for a listener and nothing downstream
        // should branch on a field it does not document. Reading our own teardown state needs
        // no such permission and cannot be broken by a change over there.
        //
        // A hold ending during a normal rotation is harmless: `showProvider()` re-arms for the
        // incoming provider a few lines later and overwrites whatever this sets.
        bus.subscribe(HELD_BEGIN, (d) => { raiseWallpaper(d?.source); segmentWatch?.disarm(); });
        bus.subscribe(HELD_END, () => {
          const wasHeld = !!heldBy;
          lowerWallpaper();
          if (wasHeld && current && !torn) segmentWatch?.arm(current);
        });

        (async () => {
          for (const p of PROVIDERS) {
            if (p.real) { const a = makeChildAdapter(p); await a.mount(slots[p.id]); adapters[p.id] = a; }
            else adapters[p.id] = placeholderAdapter(p, slots[p.id]);
          }

          // The wallpaper is mounted once and kept hidden, not mounted on demand: a hold is
          // when the screen is already in a state nobody wanted, and that is the worst moment
          // to be loading a module and fetching a listing. Its own clocks are parked while it
          // is down, so an idle wallpaper costs nothing but the DOM it is made of.
          const wState = makeState(`${instanceId}-wallpaper`);
          const wEvents = makeEvents(`${instanceId}-wallpaper`);
          await wState.load(); await wEvents.load();
          wallpaper = mountModule('wallpaper', {
            mount: mount.querySelector('[data-wall]'), bus: rootBus,
            state: wState, events: wEvents, user, profileId,
            setTimer: io.setTimer, clearTimer: io.clearTimer, now: io.now, rand: io.rand,
            output: ctx.output,
            get personId() { return ctx.personId; },
          });
          wallpaper.init();
          wallpaper.onHide();          // mounted, down, and not spending a clock
          wState.startPolling();
          // A hold that arrived DURING this mount would have found no wallpaper to raise.
          // `heldBy` records it either way, so the overlay catches up here rather than
          // waiting for the next hold — a provider that hands back an empty segment
          // synchronously makes this ordering real, not theoretical.
          if (heldBy) { const h = heldBy; raiseWallpaper(h); }
          machine = createMachine(cfg, { bus, setTimer, clearTimer, now: io.now, rand: io.rand });
          machine.start();               // enters 'youtube' -> youtube/activate -> showProvider('youtube')
        })().catch((e) => console.error('director init', e));
      },
      onResize() { for (const id of Object.keys(adapters)) adapters[id].resize?.(); wallpaper?.onResize?.(); },
      onHide() { for (const id of Object.keys(adapters)) adapters[id].flush?.(); wallpaper?.onHide?.(); },
      // Shown again with a hold still on: the overlay is still up (nothing lowered it), so
      // its clock has to come back with it or the wallpaper is a still frame for six hours —
      // the exact thing it was built to replace.
      onShow() { if (heldBy) wallpaper?.onShow?.(); },
      destroy() {
        torn = true;                 // before anything else — see the HELD_END handler
        segmentWatch?.disarm();
        try { machine?.stop(); } catch { /* noop */ }
        if (phTimer != null) { clearTimer(phTimer); phTimer = null; }
        for (const id of Object.keys(adapters)) { try { adapters[id].destroy?.(); } catch { /* noop */ } }
        try { wallpaper?.destroy(); } catch { /* noop */ } wallpaper = null; heldBy = null;
      },
    };
  },
);
