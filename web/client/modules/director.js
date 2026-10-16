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
//     The only real provider today is `youtube`; the rest render as labeled
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

import { registerModule, mountModule, getManifest, extendCtx } from '../module.js';
import './photos.js';   // registers 'photos', the Pictures turn's module (row 2.87)
// A Lineup with rules (row 2.87, Stage 1; lineup.js): a saved Lineup preset decides each turn.
import { cleanEntries, pickEntry, LINEUP_TYPE, freshnessWeights, FRESH_DEFAULT, FRESH_FIELD } from '../lineup.js';
import { createPresetLibrary } from '../presets.js';
import { followPerson } from '../person_known.js';
import { panelPlays } from '../plays.js';
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
  // PICTURES (row 2.87 (2), Mike 2026-10-14: "rotate pictures, videos, songs, lessons and voice messages"): the real
  // Photos module, wrapped (`inner`) - see `makeTurnAdapter`. Photos keeps its own rules; the Lineup only gives it a turn.
  { id: 'pictures',    label: 'Pictures',       real: true, inner: 'photos' },
  { id: 'wordgame',    label: 'Word game',      real: false },
  { id: 'trivia',      label: 'Trivia',         real: false },
  { id: 'singalong',   label: 'Sing-along',     real: false },
];
const ALL = PROVIDERS.map((p) => p.id);

// HOW LONG A PICTURES TURN LASTS (row 2.87, Rule 1: a setting, not a fixed number). Default 2 minutes: at Photos' own
// default of a new picture every 8 seconds that is about 15 pictures, long enough to be a turn of its own rather than a
// flash between videos, short enough that the next video is not long in coming. FOR longer: pictures are what she most
// wants to see. AGAINST: a Lineup is a mix; a family who wants mostly pictures has a Photos panel. Mike's later
// question - weighing modules with very different amounts of content - is not answered here.
export const PICTURES_TURN_MS = 120000;
export const PICTURES_TURN_FIELD = Object.freeze({
  key: 'picturesTurnMs', label: 'Each turn of pictures lasts', kind: 'choice', default: PICTURES_TURN_MS, level: 'standard',
  options: [
    { value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' }, { value: 300000, label: '5 minutes' },
    { value: 600000, label: '10 minutes' },
  ],
});
// A pictures turn says it is alive this often, well inside the backstop's 3-minute silence (segmentSilenceMs).
export const TURN_BEAT_MS = 30000;

// *** A SAVED LINEUP (row 2.87, Stage 1; lineup.js and the plan). *** The panel's choice of one of the person's Lineup
// presets (made on the Media page). Chosen: each turn is drawn from its entries - module, preset, days, hours, how often
// - and the time-of-day rotation above stands aside. None (the default): exactly what this panel did before.
/** The machine's config with every unguarded `segment/done` transition guarded by `noLineup` (row 2.87). Pure. */
export function withLineupGuard(cfg) {
  const on = { ...((cfg && cfg.on) || {}) };
  if (Array.isArray(on['segment/done'])) on['segment/done'] = on['segment/done'].map((t) => (t && !t.when ? { ...t, when: 'noLineup' } : t));
  return { ...cfg, on };
}
export const LINEUP_PRESET_FIELD = Object.freeze({
  key: 'lineupPresetId', label: 'Use a saved Lineup', kind: 'choice', default: '', level: 'standard',
  emptyLabel: 'No saved Lineup. Turns by time of day, as before',
});

// *** THE BAR NAMES WHAT IS ON SCREEN (row 2.87, Mike 2026-10-14 via chat CA item 3: the bar said "Lineup" on his
// YouTube dashboard). *** A Lineup says what it is showing: `titleNow()` is "<what is showing> (Lineup)" - "YouTube
// (Lineup)" - and every change is published on PANEL_TITLE_TOPIC so the screen redraws its bar and menu (kiosk.js
// reads `titleNow` for the panel's name wherever it names a panel). FOR the child's name first: it is what the person
// is looking at, and Mike's words are "the bar names what is on screen". FOR keeping "(Lineup)": Next on this panel
// skips the whole turn, not one video, and the name is the only place that says so. AGAINST: longer chips. A guess
// for Mike to change. The child's own registered title ("YouTube") when it is a real module, else its label here.
export const PANEL_TITLE_TOPIC = 'kiosk/panel-title';
export const LINEUP_TITLE = 'Lineup';
export function lineupTitle(providerId) {
  if (!providerId) return LINEUP_TITLE;
  const p = PROVIDERS.find((x) => x.id === providerId);
  let t = '';
  try { t = (p && p.real && !p.inner && getManifest(providerId)?.title) || ''; } catch { t = ''; }
  return `${t || (p ? p.label : providerId)} (${LINEUP_TITLE})`;
}

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
    // `server`, MEASURED 2026-09-05 with every handle rejecting. It renders its chrome - a
    // "Skip" control - and NOTHING ELSE. It is a container whose job is running a schedule, and
    // the schedule comes from the platform, so without it there is nothing to direct.
  { type: 'director', title: 'Lineup',
    dependsOn: 'server', description: 'Takes turns between videos, pictures, personal messages and learning by time of day, so the screen changes by itself',
    // (row 2.87 Stage 2) "Give what has played less lately more turns" only matters with a saved Lineup.
    settings: [LINEUP_PRESET_FIELD, { ...FRESH_FIELD, appliesWhen: (v) => !!(v && v.lineupPresetId) }, PICTURES_TURN_FIELD] },
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

    // ---- A SAVED LINEUP (row 2.87, Stage 1) -------------------------------------------------------------------------
    // The person's presets (presets.js), followed as the screen learns who it is for (youtube.js does the same);
    // `knownLineups` feeds the synchronous menu. With a Lineup chosen and holding entries, each turn is drawn by
    // lineup.js `pickEntry` and the machine's own pick stands aside (its transitions are guarded by `noLineup`).
    let lineupLib = null;
    let knownLineups = [];
    let lastEntry = null;         // the entry on now, so one just played is not drawn twice in a row
    // The turn on now (2026-10-16, Mike: turn length "an option per module ... one video for videos, 2 minutes for
    // pictures"): a VIDEO entry with minutes of its own plays video after video until they are up.
    let turnEntry = null, turnStartedAt = 0;
    const VIDEO_TURNS = new Set(['youtube', 'personal']);
    /** A video ended inside a video turn that still has time left: the next video, same turn. */
    function videoTurnGoesOn(p) {
      const e = turnEntry;
      if (!e || !(e.turnMs > 0) || !VIDEO_TURNS.has(e.module) || current !== e.module) return false;
      if (!p || p.reason !== 'ended') return false;
      return (io.now ? io.now() : Date.now()) - turnStartedAt < e.turnMs;
    }
    let offFollow = null;
    // Each turn is logged as a play of its module (source 'lineup'), on this device: Stage 2's freshness reads it.
    const turnPlays = panelPlays(ctx, 'lineup');
    function lineupEntries() {
      const id = (state.get?.() || {}).lineupPresetId;
      if (!lineupLib) return null;
      // (row 2.93) Nothing chosen: the person's default Lineup, when one is marked; else the time-of-day rotation.
      const p = id ? lineupLib.getPreset(id) : lineupLib.defaultFor?.(LINEUP_TYPE);
      const list = p && p.type === LINEUP_TYPE ? cleanEntries(p.settings?.entries) : [];
      return list.length ? list : null;
    }
    const lineupActive = () => !!lineupEntries();
    /** The next turn from the saved Lineup. False when none is in use (the machine's rotation then runs). */
    // A turn with nothing to show hands back AT ONCE (`segment/done` from inside its activate), so a Lineup whose every
    // entry is empty would draw again and again in one breath. Past a few in a row, the next draw waits a moment.
    let drawDepth = 0;
    let drawWait = null;
    function lineupNext() {
      const entries = lineupEntries();
      if (!entries || torn) return false;
      if (drawDepth >= 4) {
        if (drawWait == null) drawWait = setTimer(() => { drawWait = null; lineupNext(); }, 5000);
        return true;
      }
      drawDepth += 1;
      try { return drawOnce(entries); } finally { drawDepth -= 1; }
    }
    function drawOnce(entries) {
      const date = new Date(io.now ? io.now() : Date.now());
      // Stage 2: a module that has had fewer of this Lineup's turns lately comes up more (lineup.js freshnessWeights).
      let weightOf = () => 1;
      try {
        weightOf = freshnessWeights(turnPlays.rows?.() || [], { now: date.getTime(), strength: (state.get?.() || {}).lineupFresh || FRESH_DEFAULT });
      } catch { /* no plays to read: every module weighs the same */ }
      const e = pickEntry(entries, { date, rand: io.rand || Math.random, last: lastEntry, weightOf });
      // Nothing holds now (a gap in the hours): the turn on screen carries on (the plan, question 1).
      if (!e) { if (current) showProvider(current); else rootBus.publish('youtube/activate'); return true; }
      lastEntry = e.id;
      turnEntry = e; turnStartedAt = date.getTime();
      try {
        const a = adapters[e.module];
        const x = a?.inner?.();
        // A YouTube entry plays from the preset it names ('' = this Lineup's own YouTube settings).
        if (e.module === 'youtube' && x?.state && ((x.state.get() || {}).presetId || '') !== e.presetId) x.state.set({ presetId: e.presetId });
        a?.setTurnMs?.(e.turnMs || 0);
      } catch (err) { console.error('director: lineup entry', err); }
      try { turnPlays.played(e.module); } catch { /* not load-bearing */ }
      rootBus.publish(`${e.module}/activate`);
      return true;
    }
    function useLineups(pid) {
      if (torn) return;
      try { lineupLib?.destroy(); } catch { /* gone */ }
      knownLineups = [];
      lineupLib = (pid && ctx.makePersonState)
        ? createPresetLibrary({ makeState: (key, opts) => ctx.makePersonState(pid, key, opts) }) : null;
      if (!lineupLib) return;
      const lib = lineupLib;
      const refresh = () => {
        if (lib !== lineupLib || torn) return;
        knownLineups = lib.listPresets(LINEUP_TYPE);
        // A Lineup chosen before its presets had loaded: its first turn now, rather than after the current one ends.
        if (lastEntry == null && lineupActive()) lineupNext();
      };
      lib.load().then(refresh).catch((err) => console.error('director: lineups load', err));
      lib.subscribe(refresh);
    }

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
      // The screen's bar names what is showing now (row 2.87): tell it there is a new name to read.
      try { rootBus.publish(PANEL_TITLE_TOPIC, { id: instanceId, title: lineupTitle(id) }); } catch { /* no screen listening */ }
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
        // What a person reads for the few seconds it is up (BQ item 6: it said "segment placeholder -- real
        // module lands in a later slice", a note to ourselves). Whether unbuilt ones belong in the rotation at all
        // is a question for Mike, not settled here.
        `<div class="d-ph-note">Not ready yet. The next one starts in a moment.</div></div>`;
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

    // *** A TURN FOR A MODULE THAT DOES NOT KNOW IT IS IN A LINEUP (row 2.87 (2), 2026-10-14: Pictures). ***
    // youtube/personal/educational were written as providers (they answer `<id>/next` and end their own segment).
    // Photos was not, and it is her main module, so it is not rewired: it is mounted as it is, on its own instance id,
    // and this adapter keeps the time.
    //   * It gets the director's WHOLE context (`extendCtx`), unlike the children above: Photos needs what a screen
    //     gives a panel - the person's picture sources, hidden pictures, the flash limit - or it shows nothing.
    //     The children above deliberately get less (see "STILL MISSING" there); that is unchanged.
    //   * Hidden, it is PAUSED (`photos/pause#<its id>`, bus.js's instance address, so a Photos panel elsewhere on
    //     the screen is never touched). Its turn: `photos/play#<id>`, a heartbeat for the backstop, and the turn
    //     ends after `picturesTurnMs` (the Lineup's own setting; default 2 minutes, argued at the setting).
    //   * Nothing to show (no pictures yet): Photos says so on its own panel and the turn still ends on time, so the
    //     Lineup never stops on an empty card.
    function makeTurnAdapter(p) {
      let child = null, cState = null, cEvents = null, gone = false;
      let endTimer = null, beatTimer = null;
      const innerId = `${instanceId}-${p.id}`;
      const addr = (verb) => `${p.inner}/${verb}#${innerId}`;
      const stopTimers = () => {
        if (endTimer != null) { clearTimer(endTimer); endTimer = null; }
        if (beatTimer != null) { clearTimer(beatTimer); beatTimer = null; }
      };
      let entryTurnMs = 0;          // a Lineup entry's own turn length (row 2.87), else the panel's setting
      const turnMs = () => {
        if (entryTurnMs >= 10000) return entryTurnMs;
        const v = Number((state.get() || {}).picturesTurnMs);
        return Number.isFinite(v) && v >= 10000 ? v : PICTURES_TURN_MS;
      };
      const beat = () => {
        rootBus.publish('segment/progress', { provider: p.id });
        beatTimer = setTimer(beat, TURN_BEAT_MS);
      };
      return {
        async mount(el) {
          cState = makeState(innerId);
          cEvents = makeEvents(innerId);
          await cState.load(); await cEvents.load();
          if (gone) { this.destroy(); return; }
          child = mountModule(p.inner, extendCtx(ctx, {
            mount: el, bus: rootBus, state: cState, events: cEvents, instanceId: innerId,
            // "remove this picture" is never answered by a slideshow that is not on screen (photos.js).
            answersOnlyWhenShown: true,
          }));
          child.init();
          cState.startPolling(); cEvents.startPolling();
          // Hidden until its turn: paused, and told it is not showing.
          rootBus.publish(addr('pause'));
          try { child.onHide?.(); } catch { /* noop */ }
          if (current === p.id) this.activate();   // its turn came while it was still mounting
        },
        activate() {
          stopTimers();
          try { child?.onShow?.(); } catch { /* noop */ }
          rootBus.publish(addr('play'));
          beat();
          endTimer = setTimer(() => {
            endTimer = null;
            rootBus.publish('segment/done', { provider: p.id, reason: 'ended' });
          }, turnMs());
        },
        deactivate() { stopTimers(); rootBus.publish(addr('pause')); try { child?.onHide?.(); } catch { /* noop */ } },
        inner: () => (child && cState ? { type: p.inner, instance: child, state: cState } : null),
        setTurnMs: (ms) => { entryTurnMs = Number(ms) || 0; },
        flush() { try { cState?.flush?.(); } catch { /* noop */ } },
        resize() { try { child?.onResize?.(); } catch { /* noop */ } },
        destroy() {
          gone = true;
          stopTimers();
          try { child?.destroy(); } catch { /* noop */ }
          child = null;
          try { cState?.destroy?.(); } catch { /* noop */ }
          try { cEvents?.destroy?.(); } catch { /* noop */ }
          cState = null; cEvents = null;
        },
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
      // *** DESTROYED WHILE STILL MOUNTING IS A REAL SEQUENCE, AND IT USED TO LEAK FOREVER. ***
      //
      // `mount` awaits two loads before it has a `child` to speak of. A `destroy()` arriving in
      // that window found `child === null`, did nothing, and returned — and then the await
      // resolved, `mountModule` ran, `init()` ran, and a module that nobody owns any more armed
      // its heartbeat and kept it. Not a stalled timer: `progressTick` RE-ARMS ITSELF, so it
      // never expires. Every director mount/destroy left two immortal five-second timers behind,
      // one from youtube and one from personal, each holding a dead module's closure alive.
      //
      // Measured, not inferred: six cycles produced 4, 8, 12, 14, 16, 18 outstanding timers.
      // That is R6's failure exactly — *"the failure mode of a leak is a screen that dies at
      // 3am"* — and it is the kind of thing no other suite in this repo could see, because they
      // all mount once and stop.
      let gone = false;
      return {
        async mount(el) {
          cState = makeState(`${instanceId}-${p.id}`);
          cEvents = makeEvents(`${instanceId}-${p.id}`);
          await cState.load(); await cEvents.load();
          // The only await point in this function, so one check covers it. Everything after is
          // synchronous and a later `destroy()` finds a fully built adapter to take down.
          if (gone) { this.destroy(); return; }
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
            // say so; `personId` because media is per-person. `plays`/`playsPanel`: where the child's plays are
            // filed on this device (plays.js `panelPlays`, row 2.58), under the key its events stream had, so its
            // picker keeps its own history and its old server rows come down once. It gets no `instanceId` for
            // this: that would change what the child says on the bus.
            // *** STILL MISSING, DELIBERATELY, AND WRITTEN DOWN RATHER THAN QUIETLY ADDED:
            // `audio` and `cameraOwner`. A video mounted under the director never joins the
            // speaker arbiter, so a game's music plays over it and a spoken cue cannot duck
            // it. That is a real defect and a one-line fix, but it changes what the bedside
            // SOUNDS like, so it wants its own bench test rather than riding in on this one.
            output: ctx.output,
            get personId() { return ctx.personId; },
            // (row 2.87) the person's own store, so a YouTube turn can play from a preset a Lineup entry names.
            makePersonState: ctx.makePersonState,
            personKnown: ctx.personKnown,
            plays: ctx.plays,
            playsPanel: `${instanceId}-${p.id}`,
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
        inner: () => (child && cState ? { type: p.id, instance: child, state: cState } : null),
        flush() { try { cState?.flush?.(); } catch { /* noop */ } },
        resize() { try { child?.onResize?.(); } catch { /* noop */ } },
        // Idempotent, and it has to be: it is called BY `mount` when a teardown overtook it,
        // and again by the director's own destroy over `adapters`.
        destroy() {
          gone = true;
          try { child?.destroy(); } catch { /* noop */ }
          child = null;
          try { cState?.destroy?.(); } catch { /* noop */ }
          try { cEvents?.destroy?.(); } catch { /* noop */ }
          cState = null; cEvents = null;
        },
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
      // asserting on from outside, and "is the wallpaper up" is the whole behavior here.
      __probe: () => ({ current, heldBy, wallpaperUp: !mount.querySelector('[data-wall]')?.hidden,
                        wallpaperMounted: !!wallpaper }),
      // What the screen calls this panel right now (row 2.87): "YouTube (Lineup)", or "Lineup" before the first turn.
      titleNow: () => lineupTitle(current),
      // LIVE OPTIONS for "Use a saved Lineup": this person's Lineup presets (youtube.js's presetId pattern).
      settingsChoices: () => ({ lineupPresetId: knownLineups.map((p) => ({ value: p.id, label: p.name })) }),
      // The module showing now, for the screen's menu to offer its own settings under the Lineup's (row 2.87, Mike:
      // YouTube's own boxes and time pickers are the ones he uses): `{ type, title, manifest, instance, state }`, or null
      // (a turn not built yet, or still mounting). Its settings are its own row, as when it is its own panel.
      childNow: () => {
        const x = current && adapters[current]?.inner?.();
        if (!x) return null;
        const manifest = getManifest(x.type);
        return manifest ? { ...x, manifest, title: manifest.title || x.type } : null;
      },
      init() {
        mount.innerHTML = `
          <div class="director">
            <div class="d-stage" data-stage></div>
            <div class="d-wall" data-wall hidden></div>
            <div class="d-bar">
              <span class="d-label" data-dlabel></span>
              <button class="d-skip" data-skip aria-label="skip this one">Skip ▸</button>
            </div>
          </div>`;
        for (const p of PROVIDERS) {
          const slot = document.createElement('div');
          // *** `mod-box` TOO, and it was the one host in the repo that had forgotten it. ***
          //
          // Measured 2026-09-06, across every shape that hands a module a fixed box:
          // `.k-cell mod-box` and `.trystage mod-box` both report `container-type: size` and
          // `position: relative`; `.d-slot` reported `normal` and `static`.
          //
          // Two consequences, and the second is the one with history. A module inside a
          // director could not use container queries at all -- so the rules that make trivia,
          // Word Forge, lessons and the bank fit a short panel, and the ones that scale the
          // clock, silently did nothing here. And an `inset:0` child resolved against
          // `.director` rather than against its own slot, which is exactly the escape-the-cell
          // bug `.k-mod{position:relative}` in modules.css was written to stop; it is harmless
          // today only because the slot happens to be the same size as the director.
          //
          // Harmless-today is the wrong thing to rely on: the director is what runs the screen
          // at the bedside, and the next provider added here would inherit both problems.
          slot.className = 'd-slot mod-box'; slot.hidden = true; slot.dataset.prov = p.id;
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
        // (row 2.87) A saved Lineup draws the next turn (the machine's own pick is guarded off while it does).
        bus.subscribe('segment/done', (p) => {
          if (!lineupActive()) return;
          // A video turn with time left: the next video, the same turn (re-activating the provider plays its next).
          if (videoTurnGoesOn(p)) { rootBus.publish(`${turnEntry.module}/activate`); return; }
          lineupNext();
        });
        offFollow = followPerson(ctx, (pid) => useLineups(pid));
        // A Lineup chosen in the menu: its first turn now.
        try { state.subscribe?.(() => { if (lineupActive() && lastEntry == null) lineupNext(); if (!lineupActive()) lastEntry = null; }); }
        catch { /* a host without subscribe: the next turn picks it up */ }

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

        // *** THIS LOOP IS THE OTHER HALF OF THE SAME RACE, AND IT IS THE WORSE HALF. ***
        //
        // It used to read `await a.mount(...)` and THEN `adapters[p.id] = a`. So an adapter that
        // was still mounting was not in `adapters` yet — and `destroy()` tears down by iterating
        // `adapters`, so it could not have found it even if it wanted to. The adapter was
        // invisible to the only thing that could have stopped it.
        //
        // Registering FIRST is what makes the guard inside `makeChildAdapter` reachable: destroy
        // now finds the half-built adapter, sets its `gone`, and the mount cleans up after its
        // own await instead of finishing into a screen that is no longer there.
        (async () => {
          for (const p of PROVIDERS) {
            // Somebody tore this down mid-loop. Building the remaining providers would be
            // building them for nobody, and each one is a module with its own clocks.
            if (torn) return;
            if (p.real) { const a = p.inner ? makeTurnAdapter(p) : makeChildAdapter(p); adapters[p.id] = a; await a.mount(slots[p.id]); }
            else adapters[p.id] = placeholderAdapter(p, slots[p.id]);
          }
          if (torn) return;

          // The wallpaper is mounted once and kept hidden, not mounted on demand: a hold is
          // when the screen is already in a state nobody wanted, and that is the worst moment
          // to be loading a module and fetching a listing. Its own clocks are parked while it
          // is down, so an idle wallpaper costs nothing but the DOM it is made of.
          const wState = makeState(`${instanceId}-wallpaper`);
          const wEvents = makeEvents(`${instanceId}-wallpaper`);
          await wState.load(); await wEvents.load();
          // Same await, same race, same fix. A wallpaper mounted after teardown is a second
          // module nobody owns — and `destroy()` has already run past `wallpaper?.destroy()`,
          // so nothing would ever come back for it.
          if (torn) { try { wState.destroy?.(); wEvents.destroy?.(); } catch { /* noop */ } return; }
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
          // And the machine is the third one. `destroy()` calls `machine?.stop()`; starting a
          // machine after that ran leaves its clock ticking against a screen that is gone.
          if (torn) { try { wallpaper?.destroy(); } catch { /* noop */ } wallpaper = null; return; }
          // (row 2.87) While a saved Lineup is in use, the machine's own pick stands aside: every segment/done
          // transition without a guard of its own gets `noLineup`, and lineupNext (below) draws the turn instead.
          machine = createMachine(withLineupGuard(cfg), { bus, setTimer, clearTimer, now: io.now, rand: io.rand,
            guards: { noLineup: () => !lineupActive() } });
          machine.start();               // enters 'youtube' -> youtube/activate -> showProvider('youtube')
          if (lineupActive()) lineupNext();   // a Lineup already loaded: its own first turn
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
        try { offFollow?.(); } catch { /* gone */ }
        if (drawWait != null) { clearTimer(drawWait); drawWait = null; }
        try { lineupLib?.destroy(); } catch { /* gone */ } lineupLib = null;
        try { turnPlays.destroy?.(); } catch { /* gone */ }
        try { machine?.stop(); } catch { /* noop */ }
        if (phTimer != null) { clearTimer(phTimer); phTimer = null; }
        for (const id of Object.keys(adapters)) { try { adapters[id].destroy?.(); } catch { /* noop */ } }
        try { wallpaper?.destroy(); } catch { /* noop */ } wallpaper = null; heldBy = null;
      },
    };
  },
);
