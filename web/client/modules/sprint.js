// sprint.js — the SPRINT (Pomodoro) timer: a school-day work clock, and the
// first thing that feeds the points ledger.
//
// A sprint is a fixed block of focused work followed by a break. Finish the WORK
// block and you bank points; skip it and you don't. That single rule is why this
// module exists before the games: it is the smallest honest point SOURCE, so the
// ledger seam (points.js) gets proven by something real rather than by a stub.
//
// CONTENT-AS-MEANING. Nothing here is styled or voiced in the module. It draws with
// the theme's CSS variables (theme.js) and announces phase changes through the
// profile's VOICE (voice.js). Change the profile's theme or voice and the timer
// re-renders / re-speaks for free. The teal+amber "Forge" look the learning tools were
// specified in is therefore a THEME (`forge` in theme.js), not code in this file.
//
// THE BUS. The module never names its input. It opens ONE sink on `sprint/control`
// and its own buttons are just one source bound to that topic — so a keyboard, a
// physical button, a switch, or a companion app can drive the timer with no change
// here. It emits `sprint/done` for anything that wants to react, and awards points
// through the ledger (which appends the durable record AND publishes `points/award`).
//
// TIME. Durations are minutes in config, milliseconds internally, and the deadline
// (`endsAt`) is persisted — so a reload mid-sprint resumes where it was instead of
// restarting. A sprint whose deadline passed while the tab was closed still counts
// if it ended within `resumeGraceMin`; older than that it EXPIRES with no points
// (the timer measures focused work, and a sprint abandoned yesterday wasn't that).
//
// TESTABILITY (ctx injection, same convention as director.js/educational.js):
//   ctx.now()                     -> ms  (default Date.now)
//   ctx.setTicker(fn, ms) / ctx.clearTicker(id)   (default setInterval/clearInterval)
//   ctx.speak(text, voicePref)    (default voice.js speak — a test records calls)
//   ctx.tickMs                    tick period (default 250)

import { registerModule } from '../module.js';
import { speak as speakDefault, cancel as cancelSpeak } from '../voice.js';
import { createPointsLedger } from '../points.js';

export const SOURCE = 'sprint';
// MIKE_CHANGE_LIST.md §0a item 6, sprint fourth in priority order.
//
// *** HONEST ABOUT WHAT THIS IS AND IS NOT. *** Sprint has no external stimulus the way
// board's scan-highlight or call's ring does: `complete()` below auto-advances straight into
// the next phase with nobody waited on, so there is no "she was asked, how fast did she
// answer" moment anywhere in a normal run. The one real, measurable gap is self-initiated on
// BOTH ends — she chooses when to pause and when to resume — so what this records is PAUSE
// DURATION, the "held" shape (`held.js`'s own sense: a stop somebody is understood to be
// present for and coming back from), not a reaction time. Recorded as that, not dressed up
// as the other thing.
//
// *** ITS OWN STREAM, NOT `ctx.events`, AND NOT `telemetry.js` EITHER — both checked, both
// wrong for this. *** `ctx.events` is this INSTANCE's own private stream, and an existing
// test asserts it stays empty on purpose (`sprint_test.html`: "nothing was double-written to
// the instance stream") — every durable record sprint makes already goes through the SHARED
// points ledger instead, and this must not quietly break that. `telemetry.js`'s `session/
// trial` — the mechanism trivia/wordforge/algebra/pressgame all correctly use for their own
// latency — was tried first and rejected: its `log()` treats every trial as right-or-wrong
// (`correct: responded ? (correct === true) : null` — there is no way to pass "no such
// concept" through it), and a pause has no correct answer. Forcing it through would have
// written a fabricated `correct: false` — the exact "never a fabricated number" rule this
// whole audit exists to enforce, just aimed at a different field. A dedicated, named,
// NOT-per-instance stream (`ctx.makeEvents`, the same seam `lessons.js`'s own `LESSONS_
// STREAM` and `wordforge.js`'s shared bank both already use for "somewhere real that is not
// this instance's own storage") says exactly what it is and nothing more.
export const RESUME_STREAM = 'sprint-resume';
export const RESUME_KIND = 'resumed';

// Defaults are the classic Pomodoro, with the points atom the curriculum uses:
// one point ~= one minute of focused work, so a 25-minute sprint banks 25.
export const DEFAULTS = {
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  cyclesBeforeLong: 4,
  pointsPerMin: 1,
  mult: 1,
  task: '',
  resumeGraceMin: 60,
};

// The stacking multipliers from the homeschool conventions, as a picker.
export const MULTIPLIERS = [
  { value: 1,   label: 'x1  solo' },
  { value: 1.5, label: 'x1.5  stretch hour' },
  { value: 2,   label: 'x2  alongside family' },
];

const PHASES = {
  idle:  { label: 'Ready',      minKey: null },
  work:  { label: 'Sprint',     minKey: 'workMin' },
  break: { label: 'Break',      minKey: 'breakMin' },
  long:  { label: 'Long break', minKey: 'longBreakMin' },
};

// ---------- pure helpers (shared by the module and its test) ----------

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(Number(ms) / 1000) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function phaseLabel(phase) { return (PHASES[phase] || PHASES.idle).label; }

// How long a phase runs, in ms, given the config.
export function phaseMs(phase, cfg = {}) {
  const key = (PHASES[phase] || PHASES.idle).minKey;
  if (!key) return 0;
  const min = Number(cfg[key]);
  return (Number.isFinite(min) && min > 0 ? min : DEFAULTS[key]) * 60000;
}

// What a finished WORK sprint is worth: minutes x points-per-minute, before the
// multiplier (the ledger stores base and multiplier separately so both stay visible).
export function sprintPoints(cfg = {}) {
  const min = Number(cfg.workMin);
  const ppm = Number(cfg.pointsPerMin);
  return Math.round(
    (Number.isFinite(min) && min > 0 ? min : DEFAULTS.workMin) *
    (Number.isFinite(ppm) && ppm > 0 ? ppm : DEFAULTS.pointsPerMin),
  );
}

// work -> break (or long break every Nth) -> work. `cycle` counts finished sprints.
export function nextPhase(phase, cycle = 0, cyclesBeforeLong = DEFAULTS.cyclesBeforeLong) {
  const n = Number(cyclesBeforeLong) > 0 ? Number(cyclesBeforeLong) : DEFAULTS.cyclesBeforeLong;
  if (phase === 'work') {
    const done = cycle + 1;
    return { phase: done % n === 0 ? 'long' : 'break', cycle: done };
  }
  return { phase: 'work', cycle };
}

// ---------- the module ----------


// WHAT THE SETTINGS MENU SHOWS.
//
// Added 2026-09-05. This module read eight config keys and declared NONE of them, so every one was
// live config that no UI could write - the same defect F4 turned out to be. It matters more than
// it did last week: the transport bar now makes the settings menu reachable on a grid kiosk, so
// an undeclared panel is one somebody can select and then find nothing to change.
//
// KIND follows the rule `photos.js` states: with one switch you walk a control one press at a
// time and can only travel one way, so THE NUMBER OF STOPS IS THE COST. Short lists of
// known-good values are choices; genuine ranges where any value means something are numbers.
//
// LEVEL: only what somebody actually changes is `standard`. Everything that prices the economy
// is `advanced`, so the common case is a short menu rather than a long one.
const SETTINGS = [
  { key: 'workMin', label: 'Sprint length', kind: 'choice', default: 25, level: 'standard',
    unit: 'minutes',
    options: [{ value: 10, label: '10 minutes' }, { value: 15, label: '15 minutes' },
              { value: 25, label: '25 minutes' }, { value: 45, label: '45 minutes' }] },
  { key: 'breakMin', label: 'Break', kind: 'choice', default: 5, level: 'standard',
    options: [{ value: 3, label: '3 minutes' }, { value: 5, label: '5 minutes' },
              { value: 10, label: '10 minutes' }] },
  { key: 'task', label: 'What this sprint is for', kind: 'text', default: '',
    level: 'standard', placeholder: 'Anything' },
  { key: 'mult', label: 'Multiplier', kind: 'choice', default: 1, level: 'standard',
    options: MULTIPLIERS },
  { key: 'longBreakMin', label: 'Long break', kind: 'choice', default: 15, level: 'advanced',
    options: [{ value: 10, label: '10 minutes' }, { value: 15, label: '15 minutes' },
              { value: 30, label: '30 minutes' }] },
  { key: 'cyclesBeforeLong', label: 'Sprints before a long break', kind: 'number', default: 4,
    level: 'advanced', min: 1, max: 12, step: 1 },
  { key: 'pointsPerMin', label: 'Points a minute', kind: 'number', default: 1,
    level: 'advanced', min: 0, max: 5, step: 1 },
  // How long a sprint may be picked back up after the screen was left. Not a preference so
  // much as a judgement about what counts as the same sitting.
  { key: 'resumeGraceMin', label: 'Pick a sprint back up within', kind: 'choice', default: 60,
    level: 'advanced',
    options: [{ value: 0, label: 'Never — start fresh' }, { value: 15, label: '15 minutes' },
              { value: 60, label: 'An hour' }, { value: 240, label: 'Four hours' }] },
];

registerModule(
    // `local`, MEASURED RATHER THAN GUESSED (2026-09-05). Mounted with every handle rejecting -
    // a dead platform, with the factories still present the way a real kiosk supplies them -
    // this module still renders a playable timer. It runs; it just stops being evidence.
    //
    // That is exactly `pressgame`'s stated precedent, and the reason this matters is the
    // RECOVERY LADDER: `dependsOn` feeds its fallback ranking, and an ABSENT value is read as
    // the pessimistic `server`. So leaving it off made a screen that lost the platform swap
    // AWAY from a game that would have kept working - which is the opposite of what a fallback
    // is for.
  // *** "Focus timer", NOT "Sprint". *** G13, Mike: it *"should say what kind of timer it is,
  // since people looking for it will know the name of the technique."* Same reasoning as the
  // AAC board rename: "Sprint" is what this project calls it, and a name only the people who
  // built it recognise is a name that finds nobody. Pomodoro is the term somebody would
  // actually type, so it is in the description here and in the copy on the parts page, where
  // the search reads it.
  //
  // The type stays `sprint`, and so does `SOURCE` above — that string groups every point this
  // module has ever awarded, and renaming it would orphan the history it is the source of.
  { type: 'sprint', title: 'Focus timer',
    description: 'A Pomodoro focus timer — finish a sprint, bank the points',
    dependsOn: 'local', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now         = ctx.now || (() => Date.now());
    // Its own stream, deliberately not `ctx.events` — see RESUME_STREAM's own comment above
    // for exactly why. Built lazily so a module mounted without `ctx.makeEvents` (an older
    // test harness, say) degrades to "no resume record" rather than crashing on mount.
    const resumeStream = ctx.makeEvents ? ctx.makeEvents(RESUME_STREAM) : null;
    const setTicker   = ctx.setTicker || ((fn, ms) => setInterval(fn, ms));
    const clearTicker = ctx.clearTicker || ((id) => clearInterval(id));
    const speak       = ctx.speak || speakDefault;
    const tickMs      = ctx.tickMs != null ? ctx.tickMs : 250;

    let ledger = null;        // the shared points ledger (this module's own handle)
    let settings = null;      // the profile settings blob — for the voice preference
    let voicePref = {};
    let ticker = null;
    let cfg = { ...DEFAULTS };
    let run = { phase: 'idle', endsAt: null, remainMs: null, cycle: 0 };
    let notice = '';          // transient line under the clock
    let completing = false;   // guards against a tick firing complete() twice
    // WHEN THE CURRENT PAUSE STARTED — in-memory only, on purpose. Reloading mid-pause loses
    // it the same way `notice` and `completing` above already do; a pause left over a reload
    // could span hours or days for reasons that have nothing to do with how quickly she
    // resumes, and that is a different question from the one this measures.
    let pausedAt = null;

    const el = (sel) => mount.querySelector(sel);
    function num(v, dflt) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : dflt; }
    const cfgOf = (s) => ({
      workMin:          num(s.workMin, DEFAULTS.workMin),
      breakMin:         num(s.breakMin, DEFAULTS.breakMin),
      longBreakMin:     num(s.longBreakMin, DEFAULTS.longBreakMin),
      cyclesBeforeLong: num(s.cyclesBeforeLong, DEFAULTS.cyclesBeforeLong),
      pointsPerMin:     num(s.pointsPerMin, DEFAULTS.pointsPerMin),
      mult:             num(s.mult, DEFAULTS.mult),
      resumeGraceMin:   num(s.resumeGraceMin, DEFAULTS.resumeGraceMin),
      task:             typeof s.task === 'string' ? s.task : DEFAULTS.task,
    });

    const isRunning = () => run.phase !== 'idle' && run.endsAt != null;
    const isPaused  = () => run.phase !== 'idle' && run.remainMs != null;
    const remaining = () =>
      isRunning() ? Math.max(0, run.endsAt - now())
      : isPaused() ? run.remainMs
      : phaseMs('work', cfg);

    // ---- persistence: run + config both live in the instance's overwrite state ----
    function persist(patch) {
      run = { ...run, ...patch };
      state.set(patch);
    }

    // ---- transitions ----

    function startPhase(phase, { announce = true } = {}) {
      const ms = phaseMs(phase, cfg);
      persist({ phase, endsAt: now() + ms, remainMs: null });
      if (announce) {
        say(phase === 'work'
          ? `Sprint started. ${cfg.workMin} minutes${cfg.task ? ' on ' + cfg.task : ''}.`
          : `${phaseLabel(phase)}. ${Math.round(ms / 60000)} minutes.`);
      }
      render();
    }

    function start() {
      notice = '';
      if (isPaused()) {
        // The pause is over — record how long it lasted BEFORE anything else changes, the
        // same "capture first, mutate state after" order board.js and call.js both use for
        // their own latency.
        const latencyMs = pausedAt != null ? Math.max(0, now() - pausedAt) : null;
        pausedAt = null;
        if (latencyMs != null) {
          try {
            resumeStream?.append?.(RESUME_KIND, {
              at: now(), phase: run.phase, latencyMs,
            })?.catch?.((err) => console.error('sprint: log', err));
          } catch (err) { console.error('sprint: log', err); }
        }
        persist({ endsAt: now() + run.remainMs, remainMs: null }); render(); return;
      }
      if (isRunning()) return;
      startPhase(run.phase === 'idle' ? 'work' : run.phase);
    }

    function pause() {
      if (!isRunning()) return;
      pausedAt = now();
      persist({ remainMs: Math.max(0, run.endsAt - now()), endsAt: null });
      render();
    }

    function toggle() { if (isRunning()) pause(); else start(); }

    // Skipping ENDS the phase without earning: a sprint you didn't sit through isn't
    // worth points, and quietly awarding them would make the whole ledger a lie.
    function skip() {
      if (run.phase === 'idle') return;
      const skipped = run.phase;
      const { phase, cycle } = nextPhase(skipped, run.cycle, cfg.cyclesBeforeLong);
      persist({ cycle });
      bus.publish('sprint/done', { phase: skipped, reason: 'skipped', points: 0, task: cfg.task, cycle });
      notice = skipped === 'work' ? 'Sprint skipped — no points.' : '';
      startPhase(phase);
    }

    function reset() {
      cancelSpeak();
      persist({ phase: 'idle', endsAt: null, remainMs: null, cycle: 0 });
      notice = '';
      // A pause that ends in a reset rather than a resume was never really "resumed" — no
      // record is made for it (an abandoned pause is a different fact than a fast one, the
      // same reasoning as a declined call getting no answer-latency record), and the
      // timestamp itself must not survive to be misread against whatever starts next.
      pausedAt = null;
      render();
    }

    // The phase ran out. A finished WORK phase is the one thing that awards points.
    async function complete(phase, { earned = true } = {}) {
      if (completing) return;
      completing = true;
      try {
        const { phase: next, cycle } = nextPhase(phase, run.cycle, cfg.cyclesBeforeLong);
        persist({ cycle });

        let value = 0;
        if (phase === 'work' && earned) {
          const awarded = await ledger.award({
            amount: sprintPoints(cfg),
            mult: cfg.mult,
            type: 'School',          // school TIME — carries minutes for the weekly engine
            minutes: cfg.workMin,
            source: SOURCE,
            tags: ['sprint', ...(cfg.task ? [cfg.task] : [])],
            note: cfg.task || `${cfg.workMin}-minute sprint`,
          }).catch((err) => { console.error('sprint: award failed', err); return null; });
          value = awarded ? awarded.value : 0;
          notice = value ? `Sprint complete — +${value} points.` : 'Sprint complete (points not saved).';
        } else if (phase === 'work') {
          notice = 'Sprint expired while away — no points.';
        } else {
          notice = '';
        }

        bus.publish('sprint/done', { phase, reason: 'ended', points: value, task: cfg.task, cycle });

        if (phase === 'work' && earned) {
          say(`Sprint complete. ${value} points. ${phaseLabel(next)}, ${Math.round(phaseMs(next, cfg) / 60000)} minutes.`);
          startPhase(next, { announce: false });   // one announcement, not two
        } else {
          startPhase(next, { announce: earned });
        }
      } finally {
        completing = false;
      }
    }

    function say(text) {
      try { speak(text, voicePref); } catch (err) { console.error('sprint: speak', err); }
    }

    // ---- the clock tick ----
    function tick() {
      if (!isRunning()) return;
      if (now() >= run.endsAt) { complete(run.phase); return; }
      renderClock();
    }

    // A deadline that passed while nobody was watching: still counts if it landed
    // inside the grace window, expires (no points) if it's older than that.
    function reconcileOnLoad() {
      if (run.phase === 'idle' || run.endsAt == null) return;
      const overdue = now() - run.endsAt;
      if (overdue < 0) return;                                    // still running — just resume
      complete(run.phase, { earned: overdue <= cfg.resumeGraceMin * 60000 });
    }

    // ---- render ----
    function renderClock() {
      const c = el('[data-clock]');
      if (c) c.textContent = formatClock(remaining());
    }

    function render() {
      // NOTE: the root's `data-phase` is the CSS hook only. The visible label uses
      // `data-plabel` — a querySelector('[data-phase]') would match the ROOT first and
      // setting its textContent would erase the whole module.
      const rootEl = mount.querySelector('.sprint');
      if (!rootEl) return;
      rootEl.dataset.phase = run.phase;
      el('[data-plabel]').textContent = phaseLabel(run.phase);
      renderClock();
      el('[data-toggle]').textContent = isRunning() ? 'Pause' : (isPaused() ? 'Resume' : 'Start');
      const inSet = run.cycle % cfg.cyclesBeforeLong + (run.phase === 'work' ? 1 : 0);
      el('[data-cycle]').textContent = `sprint ${Math.min(inSet, cfg.cyclesBeforeLong)} of ${cfg.cyclesBeforeLong}`;
      el('[data-notice]').textContent = notice;
      const task = el('[data-task]');
      if (task && document.activeElement !== task && task.value !== cfg.task) task.value = cfg.task;
      const mult = el('[data-mult]');
      if (mult && Number(mult.value) !== cfg.mult) mult.value = String(cfg.mult);
      el('[data-worth]').textContent = `worth +${Math.round(sprintPoints(cfg) * cfg.mult)}`;
    }

    function renderTotals() {
      const t = el('[data-today]');
      if (t && ledger) t.textContent = `${ledger.totalToday(now())} points today`;
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="sprint" data-phase="idle">
            <div class="s-phase" data-plabel>Ready</div>
            <div class="s-clock" data-clock>25:00</div>
            <div class="s-notice" data-notice></div>
            <input class="s-task" data-task type="text" placeholder="What are you working on?" aria-label="task">
            <div class="s-row">
              <button class="s-btn s-primary" data-toggle>Start</button>
              <button class="s-btn" data-skip>Skip</button>
              <button class="s-btn" data-reset>Reset</button>
            </div>
            <div class="s-row s-meta">
              <select class="s-mult" data-mult aria-label="multiplier">
                ${MULTIPLIERS.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}
              </select>
              <span class="s-worth" data-worth></span>
            </div>
            <div class="s-foot"><span data-cycle></span> · <span data-today>0 points today</span></div>
          </div>`;

        // ONE sink. Anything that can publish here can drive the timer.
        bus.subscribe('sprint/control', (action) => {
          switch (typeof action === 'string' ? action : action && action.action) {
            case 'start':  return start();
            case 'pause':  return pause();
            case 'toggle': return toggle();
            case 'skip':   return skip();
            case 'reset':  return reset();
            default:       return undefined;
          }
        });

        // This module's own buttons are just one source bound to that topic.
        const buttons = bus.createSource('sprint-buttons');
        bus.addBinding({ source: 'sprint-buttons', signal: 'press', topic: 'sprint/control', transform: (p) => p.action });
        el('[data-toggle]').addEventListener('click', () => buttons.emit('press', { action: 'toggle' }));
        el('[data-skip]').addEventListener('click',   () => buttons.emit('press', { action: 'skip' }));
        el('[data-reset]').addEventListener('click',  () => buttons.emit('press', { action: 'reset' }));

        el('[data-task]').addEventListener('input', (e) => { cfg.task = e.target.value; state.set({ task: cfg.task }); });
        el('[data-mult]').addEventListener('change', (e) => {
          cfg.mult = num(e.target.value, DEFAULTS.mult);
          state.set({ mult: cfg.mult });
          render();
        });

        // The shared, profile-scoped ledger — the same stream every game will write to.
        ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus });
        ledger.subscribe(renderTotals);
        ledger.load().then(() => ledger.startPolling()).catch(() => {});

        // Voice is a per-profile render setting, read the same way educational.js reads it.
        if (ctx.makeState) {
          settings = ctx.makeState('settings');
          settings.subscribe((s) => { voicePref = (s && s.voice) || {}; });
          settings.load().then(() => settings.startPolling()).catch(() => {});
        }

        state.subscribe((s) => {
          const snap = s || {};
          cfg = cfgOf(snap);
          run = {
            phase: PHASES[snap.phase] ? snap.phase : 'idle',
            endsAt: Number.isFinite(Number(snap.endsAt)) && snap.endsAt != null ? Number(snap.endsAt) : null,
            remainMs: Number.isFinite(Number(snap.remainMs)) && snap.remainMs != null ? Number(snap.remainMs) : null,
            cycle: Number(snap.cycle) > 0 ? Number(snap.cycle) : 0,
          };
          render();
        });

        render();
        reconcileOnLoad();
        ticker = setTicker(tick, tickMs);
      },

      onResize() {},

      // Leaving the screen must not lose an in-flight sprint: the deadline is already
      // persisted, so flushing is all that's needed — the timer keeps its own time.
      onHide() { state.flush(); },

      destroy() {
        if (ticker != null) { clearTicker(ticker); ticker = null; }
        cancelSpeak();
        if (ledger) { ledger.destroy(); ledger = null; }
        if (settings) { settings.destroy(); settings = null; }
        resumeStream?.destroy?.();
      },
    };
  },
);
