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

// Segment providers the director can rotate through. `real:true` mounts the actual
// module; `real:false` renders a placeholder until that module exists.
export const PROVIDERS = [
  { id: 'youtube',     label: 'Video',          real: true  },
  { id: 'personal',    label: 'Personal video', real: true  },
  { id: 'educational', label: 'Educational',    real: false },
  { id: 'wordgame',    label: 'Word game',      real: false },
  { id: 'trivia',      label: 'Trivia',         real: false },
  { id: 'singalong',   label: 'Sing-along',     real: false },
];
const ALL = PROVIDERS.map((p) => p.id);

// The default machine config: a weighted daypart-gated rotation. Morning &
// sleepytime enable YouTube ONLY (they run their existing playlists — Christine may
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
  { type: 'director', title: 'Lineup', description: 'rotates videos, personal videos & learning by time of day' },
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
    const adapters = {};      // provider id -> { activate, deactivate, destroy, flush, resize }
    const slots = {};         // provider id -> slot element
    let phTimer = null;       // the active placeholder's auto-finish timer

    const stage = () => mount.querySelector('[data-stage]');
    function setLabel(id) {
      const el = mount.querySelector('[data-dlabel]');
      const p = PROVIDERS.find((x) => x.id === id);
      if (el) el.textContent = p ? p.label : (id || '');
    }

    // Hand the window to one provider: hide the others, activate this one.
    function showProvider(id) {
      if (id === current) { adapters[id]?.activate?.(); return; }
      if (current && adapters[current]) adapters[current].deactivate?.();
      current = id;
      for (const pid of Object.keys(slots)) slots[pid].hidden = (pid !== id);
      setLabel(id);
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
          });
          child.init();
          cState.startPolling(); cEvents.startPolling();
        },
        // every activation advances the child to its next segment (directed children
        // don't autostart, so this is what shows content; an empty one hands back).
        activate() { rootBus.publish(`${p.id}/next`); },
        deactivate() { /* no pause API yet — hidden; real pause is a polish item */ },
        flush() { try { cState?.flush?.(); } catch { /* noop */ } },
        resize() { try { child?.onResize?.(); } catch { /* noop */ } },
        destroy() { try { child?.destroy(); } catch { /* noop */ } cState?.destroy?.(); cEvents?.destroy?.(); },
      };
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="director">
            <div class="d-stage" data-stage></div>
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

        // react to the engine's activation topics
        for (const p of PROVIDERS) bus.subscribe(`${p.id}/activate`, () => showProvider(p.id));

        const saved = state.get() || {};
        const cfg = saved.config || DIRECTOR_CONFIG;

        (async () => {
          for (const p of PROVIDERS) {
            if (p.real) { const a = makeChildAdapter(p); await a.mount(slots[p.id]); adapters[p.id] = a; }
            else adapters[p.id] = placeholderAdapter(p, slots[p.id]);
          }
          machine = createMachine(cfg, { bus, setTimer, clearTimer, now: io.now, rand: io.rand });
          machine.start();               // enters 'youtube' -> youtube/activate -> showProvider('youtube')
        })().catch((e) => console.error('director init', e));
      },
      onResize() { for (const id of Object.keys(adapters)) adapters[id].resize?.(); },
      onHide() { for (const id of Object.keys(adapters)) adapters[id].flush?.(); },
      destroy() {
        try { machine?.stop(); } catch { /* noop */ }
        if (phTimer != null) { clearTimer(phTimer); phTimer = null; }
        for (const id of Object.keys(adapters)) { try { adapters[id].destroy?.(); } catch { /* noop */ } }
      },
    };
  },
);
