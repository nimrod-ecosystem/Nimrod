// Clock — the first default-dashboard module (slice 3a), and now the whole CLOCK FAMILY.
//
// Display-only orientation for a disoriented patient: a large time, the weekday +
// part-of-day ("Tuesday afternoon"), and the date. No inputs, no media, no events.
// Its job in the build order is to establish the default-module + settings-UI
// convention: preferences live in OVERWRITE state, keyed per (user, profile,
// instance), so they persist and travel with the profile.
//
// *** TIMER / STOPWATCH / POMODORO ARE MODES OF THIS MODULE, NOT SEPARATE MODULES. ***
// Mike's own words: "the clock family — clock, timer, stopwatch, Pomodoro as modes not
// modules." A `mode` setting (declared the same way `hour12`/`size`/`tz` already are)
// switches what the panel shows and does; there is still exactly one `type: 'clock'` to
// place on a screen, one gear, one settings menu entry. Nothing about `dependsOn: 'none'`
// changes — a countdown needs nothing the browser doesn't already have, so all four modes
// stay the same good LAST RESORT the clock always was.
//
// *** A NOTE FOR WHOEVER LOOKS AT `sprint.js` NEXT. *** `modules/sprint.js` already
// implements a Pomodoro-shaped work/break timer — but a much bigger one, with a points
// ledger, a task field, voice announcements and a "stacking multiplier" economy built for
// the homeschool curriculum. This mode is deliberately the SMALL one Mike actually asked
// for here: alternating work/break with a visible phase, start/pause/reset, no points, no
// ledger, no voice dependency (importing voice.js would cost this module the
// `dependsOn: 'none'` honesty documented below). The two are not reconciled — that is a
// real question (should the bedside Pomodoro mode and the curriculum's sprint timer become
// one thing?) and it is Mike's to answer, not a judgment call to make silently while adding
// a mode to a different module. Recorded in NOTES_FROM_CODE.md rather than resolved here.

import { registerModule } from '../module.js';

const DEFAULTS = {
  hour12: true, seconds: false, showDate: true, size: 'm', tz: '',
  mode: 'clock',
  // TIMER/POMODORO DURATIONS ARE STORED IN MILLISECONDS AND SHOWN IN MINUTES — the same
  // house rule `photos.js` states for `intervalMs`: one number is comparable, the other is
  // readable, and a menu that displayed "5 minutes" while storing the string "5" would be a
  // menu that looks right and cannot be compared.
  timerMs: 5 * 60 * 1000,
  pomodoroWorkMs: 25 * 60 * 1000,
  pomodoroBreakMs: 5 * 60 * 1000,
};
const ZONES = [
  ['', 'Device'],
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Los_Angeles', 'Pacific'],
  ['UTC', 'UTC'],
];

// ---------------------------------------------------------------------------------------
// *** FIVE LIVE SETTINGS AND NOT ONE ROW IN THE MENU. ***
// ---------------------------------------------------------------------------------------
//
// This module read all five, honoured all five, and drew its own gear panel to write them --
// and declared none of them. So the only way to change the clock was the gear ON the clock.
//
// THAT IS NOT THE SAME AS "it has settings, just somewhere else". `photos.js` already records
// the case that breaks it: *"on a GRID kiosk that menu currently shows no panel settings at
// all"*. On a bedside screen where panel chrome is not reachable, a clock stuck in 24-hour or
// in the wrong timezone could not be fixed by anybody -- and this is the module whose entire
// job is orienting somebody who is disoriented. Being wrong by an hour matters more here than
// anywhere else on the screen.
//
// Found by an audit rather than by eye: `dev/unread_settings.py`, once it was taught that a
// one-line DEFAULTS is still a DEFAULTS. It had been blind to exactly this shape.
//
// THE GEAR STAYS. Two surfaces for one setting is fine as long as they write the same key,
// which they do -- both go through `state.set` on these names.
const SETTINGS = [
  // ESSENTIAL, all but one, and that is not inflation. Each row is about whether somebody can
  // READ the clock or whether it is telling them the truth, which is the whole module.
  { key: 'hour12', label: 'Clock style', default: true, level: 'essential',
    onLabel: '12-hour (2:30 PM)', offLabel: '24-hour (14:30)' },
  { key: 'showDate', label: 'Show the date', default: true, level: 'essential',
    onLabel: 'Yes', offLabel: 'No' },
  { key: 'size', label: 'Size', kind: 'choice', default: 'm', level: 'essential',
    options: [
      { value: 's', label: 'Small' },
      { value: 'm', label: 'Medium' },
      { value: 'l', label: 'Large' },
    ],
    note: 'Ignored when the panel is small enough that the clock sizes itself to fit.' },
  { key: 'tz', label: 'Time zone', kind: 'choice', default: '', level: 'essential',
    options: ZONES.map(([value, label]) => ({ value, label })),
    note: 'A screen in a care facility is not always in the same zone as whoever set it up.' },
  // *** THE MODE ROW. *** What this panel actually is, before anything about how it looks.
  // Essential, same reasoning as `size`/`tz` above: a panel stuck in the wrong mode is a panel
  // nobody at the bedside can fix without this row.
  { key: 'mode', label: 'What this panel shows', kind: 'choice', default: 'clock',
    level: 'essential',
    options: [
      { value: 'clock', label: 'Clock' },
      { value: 'timer', label: 'Timer' },
      { value: 'stopwatch', label: 'Stopwatch' },
      { value: 'pomodoro', label: 'Pomodoro' },
    ] },
  { key: 'timerMs', label: 'Timer length', kind: 'choice', default: 5 * 60 * 1000,
    level: 'essential',
    options: [
      { value: 1 * 60 * 1000, label: '1 minute' },
      { value: 5 * 60 * 1000, label: '5 minutes' },
      { value: 10 * 60 * 1000, label: '10 minutes' },
      { value: 15 * 60 * 1000, label: '15 minutes' },
      { value: 20 * 60 * 1000, label: '20 minutes' },
      { value: 30 * 60 * 1000, label: '30 minutes' },
    ],
    note: 'Only used in Timer mode.' },
  // ADVANCED: a ticking seconds field is motion on a screen somebody sleeps beside, and almost
  // nobody needs it -- but the person who does will go looking for it deliberately.
  { key: 'seconds', label: 'Show seconds', default: false, level: 'advanced',
    onLabel: 'Yes', offLabel: 'No' },
  // Pomodoro's two durations are ADVANCED rather than essential: 25/5 is the standard and
  // correct default for almost everyone who turns this mode on, so the row that matters
  // (which mode) is essential and the rows that tune it are not.
  { key: 'pomodoroWorkMs', label: 'Pomodoro — work stretch', kind: 'choice',
    default: 25 * 60 * 1000, level: 'advanced',
    options: [
      { value: 15 * 60 * 1000, label: '15 minutes' },
      { value: 20 * 60 * 1000, label: '20 minutes' },
      { value: 25 * 60 * 1000, label: '25 minutes' },
      { value: 45 * 60 * 1000, label: '45 minutes' },
      { value: 50 * 60 * 1000, label: '50 minutes' },
    ],
    note: 'Only used in Pomodoro mode. 25 minutes is the standard Pomodoro.' },
  { key: 'pomodoroBreakMs', label: 'Pomodoro — break', kind: 'choice',
    default: 5 * 60 * 1000, level: 'advanced',
    options: [
      { value: 5 * 60 * 1000, label: '5 minutes' },
      { value: 10 * 60 * 1000, label: '10 minutes' },
      { value: 15 * 60 * 1000, label: '15 minutes' },
    ],
    note: 'Only used in Pomodoro mode.' },
];

// THE PRE-DAWN HOURS GET THEIR OWN NAME, and this is not cosmetic. This module's whole
// job is orienting someone who is disoriented, and at 4:33am it used to read "Monday
// night" — which to anyone reading it means about ten in the evening. Wrong by twenty
// hours, on the one panel whose only purpose is being right about this.
//
// Saying "Monday early morning" is unambiguous: it is genuinely Monday, and "early"
// cannot be mistaken for the evening.
//
// NOT SHARED WITH daypart.js ON PURPOSE. That file schedules content and its bands are
// one real household’s rhythm (morning starts at 6, sleepytime at 21); these bands are how a person
// would describe the hour out loud. Same clock, two different questions, and forcing one
// answer would make one of them wrong.
// EXPORTED so the orientation rules can be tested directly. Both of these carry corrections
// that came back after being fixed -- the pre-dawn naming and the duplicated weekday -- and a
// rule that has regressed once will regress again if nothing is watching it.
export function partOfDay(hour) {
  if (hour < 5) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export function fmt(cfg, now) {
  const zone = cfg.tz ? { timeZone: cfg.tz } : {};
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: cfg.hour12,
    ...(cfg.seconds ? { second: '2-digit' } : {}), ...zone,
  }).format(now);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', ...zone }).format(now);
  const date = new Intl.DateTimeFormat(undefined,
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...zone }).format(now);
  // 0–23 hour in the chosen zone, for part-of-day.
  const h = parseInt(new Intl.DateTimeFormat('en-US',
    { hour: 'numeric', hour12: false, ...zone }).format(now), 10) % 24;
  // *** THE WEEKDAY IS SAID ONCE, NOT TWICE. ***
  //
  // Mike, 2026-09-02: *"How many times have I said to lose the wednesday morning?!? There's only
  // a few words there and 2 of them are the day of the week."* On screen it read
  //
  //     1:30 AM  /  Wednesday Early Morning  /  Wednesday, September 2, 2026
  //
  // — three lines, and the same word opening two of them. On the one panel whose entire job is
  // orienting somebody, half the words were spent repeating themselves.
  //
  // This is a REPEAT correction. It was not written down the previous times, which is why it
  // came back; it is in `DECISIONS.md` now.
  //
  // The pre-dawn argument above is untouched and still load-bearing: "early morning" is here so
  // that 4:33am cannot read as the evening. What goes is the duplicated weekday — and only when
  // the date line is actually showing it. With `showDate` off there is nothing else naming the
  // day, so this line keeps it rather than leaving a disoriented person with "early morning" and
  // no idea which one.
  const when = cfg.showDate ? partOfDay(h) : `${weekday} ${partOfDay(h)}`;
  return { time, when, date };
}

// *** DURATION FORMATTING FOR THE TIMER/STOPWATCH/POMODORO MODES. ***
// mm:ss under an hour, h:mm:ss once a stopwatch runs past one — a stopwatch left running
// for a long visit should not read "127:41" when "2:07:41" is what a person actually reads
// off a clock. Rounds rather than floors so the display never sits one second ahead of a
// zero it already reported (see the timer's zero-alert below, which fires on this reaching
// zero — floor would let the DISPLAY hit 0:00 a tick before the alert did).
// EXPORTED for the same reason `partOfDay`/`fmt` are: a rule worth having is a rule worth
// testing directly, without going through a mounted instance.
export function fmtDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const wholeSecs = Math.round(total);
  const h = Math.floor(wholeSecs / 3600);
  const m = Math.floor((wholeSecs % 3600) / 60);
  const s = wholeSecs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

registerModule(
  // FALLBACK EXPOSURE. A clock needs nothing but the browser - but Mike's point stands:
  // *"even clock can have a fail state if the time/date isn't right."* There is no safe
  // module, only a least-exposed one, which is why the vocabulary is `dependsOn` rather than
  // `cannotFail`. This makes it a good LAST RESORT, not a guarantee.
  { dependsOn: 'none',
    type: 'clock', title: 'Clock', description: 'The time, the day and the date — for somebody who has lost track of all three',
    settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = { ...DEFAULTS };
    let timer = null;

    // *** THE TESTABILITY SEAM, SAME CONVENTION AS `call.js`'s `ctx.callIO`. ***
    // Nothing here reaches for `Date.now()`/`setInterval` directly — every mode's math runs
    // off `now()`, and the paint loop runs off `setTick`, so a test can hand this a clock it
    // controls by hand and prove the countdown is exact ARITHMETIC rather than a real wait.
    // Absent (the real kiosk, always) these are the ordinary browser globals, so nothing about
    // production behavior changes by this existing.
    const io = ctx.clockIO || {};
    const now = io.now || (() => Date.now());
    const setTick = io.setTick || ((fn, ms) => setInterval(fn, ms));
    const clearTick = io.clearTick || ((id) => clearInterval(id));

    // ---------------------------------------------------------------------------------
    // TIMER — counts down from `cfg.timerMs`, alerts once at zero.
    // ---------------------------------------------------------------------------------
    // `endsAt` (a wall-clock deadline), not an accumulating per-tick countdown — the same
    // shape `call.js`'s ring timer and `sprint.js`'s sprint deadline already use, and for the
    // same reason: a countdown that subtracts a fixed amount every tick drifts by however
    // late each tick actually ran, and a countdown recomputed as `endsAt - now()` cannot drift
    // at all, however irregular the ticks are.
    let timerRunning = false;
    let timerRemainingMs = cfg.timerMs;
    let timerEndsAt = null;
    // TRUE from the first Start until the next Reset. While false, `paint` keeps
    // `timerRemainingMs` synced live to the SETTING — so changing "Timer length" in the gear
    // updates the number on screen immediately. Once it is true the countdown (or the
    // finished 0:00) is left alone: a timer that silently refilled itself the moment it hit
    // zero would erase the very alert it just fired.
    let timerStartedOnce = false;
    let alertUntil = 0;              // the visual/audible alert auto-clears; see fireAlert
    let alertKind = null;

    function timerReset() {
      timerRunning = false; timerEndsAt = null;
      timerRemainingMs = cfg.timerMs;
      timerStartedOnce = false;
    }
    function timerStart() {
      if (timerRunning || timerRemainingMs <= 0) return;
      timerEndsAt = now() + timerRemainingMs;
      timerRunning = true;
      timerStartedOnce = true;
    }
    function timerPause() {
      if (!timerRunning) return;
      timerRemainingMs = Math.max(0, timerEndsAt - now());
      timerRunning = false; timerEndsAt = null;
    }
    // Called every tick. Returns the ms left; fires the zero alert exactly once per run.
    function timerAdvance() {
      if (!timerRunning) return timerRemainingMs;
      const remain = Math.max(0, timerEndsAt - now());
      timerRemainingMs = remain;
      if (remain <= 0) {
        timerRunning = false; timerEndsAt = null;
        fireAlert('timer');
      }
      return timerRemainingMs;
    }

    // ---------------------------------------------------------------------------------
    // STOPWATCH — counts up from zero. `startedAt` carries the elapsed time across a
    // pause/resume the same way: resuming sets `startedAt = now() - elapsedMs`, so the
    // clock never has to remember "how much was banked before the pause" separately.
    // ---------------------------------------------------------------------------------
    let swRunning = false;
    let swElapsedMs = 0;
    let swStartedAt = null;

    function swReset() { swRunning = false; swElapsedMs = 0; swStartedAt = null; }
    function swStart() {
      if (swRunning) return;
      swStartedAt = now() - swElapsedMs;
      swRunning = true;
    }
    function swPause() {
      if (!swRunning) return;
      swElapsedMs = now() - swStartedAt;
      swRunning = false; swStartedAt = null;
    }
    function swAdvance() {
      if (swRunning) swElapsedMs = now() - swStartedAt;
      return swElapsedMs;
    }

    // ---------------------------------------------------------------------------------
    // POMODORO — work/break, alternating, auto-continuing (standard Pomodoro behavior: a
    // finished stretch rolls straight into the next one rather than stopping and waiting to
    // be told). Same `endsAt` shape as the timer, with one addition: on a transition the new
    // deadline is `endsAt += duration` rather than `now() + duration`, so a screen that missed
    // several ticks in a row (a hidden tab, a slow device) still ends each phase at the
    // moment it was SCHEDULED to end, not late by however much time was missed. That is the
    // same drift the timer avoids, carried across a whole run of phases instead of just one.
    // ---------------------------------------------------------------------------------
    function pomoDuration(phase) { return phase === 'work' ? cfg.pomodoroWorkMs : cfg.pomodoroBreakMs; }
    let pomoPhase = 'work';
    let pomoRunning = false;
    let pomoRemainingMs = pomoDuration('work');
    let pomoEndsAt = null;
    // Same reasoning as `timerStartedOnce` above: while a Pomodoro has never been started,
    // its remaining time stays synced to the "work stretch" setting live.
    let pomoStartedOnce = false;

    function pomoReset() {
      pomoRunning = false; pomoEndsAt = null;
      pomoPhase = 'work'; pomoRemainingMs = pomoDuration('work');
      pomoStartedOnce = false;
    }
    function pomoStart() {
      if (pomoRunning) return;
      pomoEndsAt = now() + pomoRemainingMs;
      pomoRunning = true;
      pomoStartedOnce = true;
    }
    function pomoPause() {
      if (!pomoRunning) return;
      pomoRemainingMs = Math.max(0, pomoEndsAt - now());
      pomoRunning = false; pomoEndsAt = null;
    }
    function pomoAdvance() {
      if (!pomoRunning) return pomoRemainingMs;
      // BOUNDED, not a bare `while (true)` — a clock is never allowed to hang the tab it is
      // on, whatever the deadline math says. In practice one or two iterations ever fire.
      for (let guard = 0; guard < 1000; guard += 1) {
        const remain = pomoEndsAt - now();
        if (remain > 0) { pomoRemainingMs = remain; break; }
        pomoPhase = pomoPhase === 'work' ? 'break' : 'work';
        pomoEndsAt += pomoDuration(pomoPhase);
        pomoRemainingMs = Math.max(0, pomoEndsAt - now());
        fireAlert(pomoPhase === 'break' ? 'pomodoro-break' : 'pomodoro-work');
      }
      return pomoRemainingMs;
    }

    // *** THE ALERT: VISUAL ALWAYS, AUDIBLE BEST-EFFORT, AND IT CLEARS ITSELF. ***
    //
    // No import of `voice.js`/`output.js` for this — either would cost the clock the
    // `dependsOn: 'none'` honesty at the top of this file, for a beep. `AudioContext` is a
    // browser primitive, same tier as `setInterval`, so reaching for it directly keeps the
    // clock's dependency footprint exactly what it always was.
    //
    // IT CLEARS ITSELF AFTER A FEW SECONDS RATHER THAN WAITING TO BE DISMISSED. This is the
    // invariant from CLAUDE.md in one small control: a screen must never enter a state only
    // an input can leave, when the person in front of it cannot give that input. Nobody
    // answering a finished timer must not leave the panel stuck flashing red forever — the
    // safe shape is a flash that fades on its own, not a gate that waits for a press.
    function fireAlert(kind) {
      alertKind = kind;
      alertUntil = now() + 4000;
      try {
        const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (Ctx) {
          const actx = new Ctx();
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.frequency.value = kind === 'pomodoro-break' ? 660 : 880;
          osc.connect(gain); gain.connect(actx.destination);
          gain.gain.setValueAtTime(0.0001, actx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.2, actx.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.6);
          osc.start();
          osc.stop(actx.currentTime + 0.65);
          osc.onended = () => { try { actx.close(); } catch { /* already gone */ } };
        }
      } catch { /* best effort — the visual alert is the one that always works */ }
    }

    function paint() {
      const nowMs = now();
      const root = mount.querySelector('.clock');
      if (!root) return;
      root.dataset.size = cfg.size;
      root.dataset.mode = cfg.mode;

      const clockOn = cfg.mode === 'clock';
      mount.querySelector('[data-time]').hidden = !clockOn;
      mount.querySelector('[data-when]').hidden = !clockOn;
      const dateEl = mount.querySelector('[data-date]');
      dateEl.hidden = !clockOn || !cfg.showDate;
      if (clockOn) {
        const { time, when, date } = fmt(cfg, new Date(nowMs));
        mount.querySelector('[data-time]').textContent = time;
        mount.querySelector('[data-when]').textContent = when;
        dateEl.textContent = date;
      }

      const cdEl = mount.querySelector('[data-cd]');
      cdEl.hidden = clockOn;
      if (!clockOn) {
        let label; let valueMs; let running; let doneAtZero;
        if (cfg.mode === 'timer') {
          // Never started (or just Reset): track the SETTING live, so changing "Timer
          // length" in the gear updates the number on screen before anybody presses Start.
          if (!timerStartedOnce) timerRemainingMs = cfg.timerMs;
          valueMs = timerAdvance();
          label = 'Timer'; running = timerRunning; doneAtZero = valueMs <= 0;
        } else if (cfg.mode === 'stopwatch') {
          valueMs = swAdvance();
          label = 'Stopwatch'; running = swRunning; doneAtZero = false;
        } else { // pomodoro
          if (!pomoStartedOnce) pomoRemainingMs = pomoDuration(pomoPhase);
          valueMs = pomoAdvance();
          label = pomoPhase === 'work' ? 'Pomodoro — work' : 'Pomodoro — break';
          running = pomoRunning; doneAtZero = false;
        }
        mount.querySelector('[data-cd-label]').textContent = label;
        mount.querySelector('[data-cd-value]').textContent = fmtDuration(valueMs);
        const toggleBtn = mount.querySelector('[data-cd-toggle]');
        toggleBtn.textContent = running ? 'Pause' : 'Start';
        // A finished, un-reset timer disables Start rather than silently refilling — see
        // `timerStartedOnce` above. Pomodoro and the stopwatch never reach this state: the
        // stopwatch has no "finished", and Pomodoro rolls into its next phase on its own.
        toggleBtn.disabled = !running && doneAtZero;
        toggleBtn.setAttribute('aria-pressed', running ? 'true' : 'false');
        const alerted = nowMs < alertUntil;
        root.dataset.alerted = alerted ? '1' : '0';
        mount.querySelector('[data-cd-status]').textContent =
          alerted ? (alertKind === 'timer' ? "Time's up" : `${pomoPhase === 'work' ? 'Work' : 'Break'} time`)
          : '';
      }
    }

    function toggleCd() {
      if (cfg.mode === 'timer') { timerRunning ? timerPause() : timerStart(); }
      else if (cfg.mode === 'stopwatch') { swRunning ? swPause() : swStart(); }
      else if (cfg.mode === 'pomodoro') { pomoRunning ? pomoPause() : pomoStart(); }
      paint();
    }
    function resetCd() {
      if (cfg.mode === 'timer') timerReset();
      else if (cfg.mode === 'stopwatch') swReset();
      else if (cfg.mode === 'pomodoro') pomoReset();
      alertUntil = 0;
      paint();
    }

    // Reflect saved config into the controls (only when config changes, so a live
    // tick never clobbers a control the user is interacting with).
    function syncControls() {
      mount.querySelectorAll('[data-opt]').forEach((el) => {
        const key = el.dataset.opt;
        if (el.type === 'checkbox') el.checked = !!cfg[key];
        else el.value = cfg[key];
      });
    }

    let prevMode = null;
    // Whenever `mode` actually CHANGES, the mode being switched to starts clean — the
    // reasonable expectation when you turn the dial from Clock to Timer is a fresh Timer,
    // not whatever a previous visit left mid-count. Switching AWAY and back later is the
    // same case: this fires again on the way back in.
    function syncModeState() {
      if (cfg.mode === prevMode) return;
      prevMode = cfg.mode;
      timerReset(); swReset(); pomoReset();
      alertUntil = 0; alertKind = null;    // an old mode's alert must not bleed into a new one
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="clock" data-size="m" data-mode="clock" data-alerted="0">
            <div class="time" data-time>—</div>
            <div class="when" data-when></div>
            <div class="date" data-date></div>
            <div class="cd" data-cd hidden>
              <div class="cd-label" data-cd-label></div>
              <div class="cd-value" data-cd-value>—</div>
              <div class="cd-status" data-cd-status></div>
              <div class="cd-controls">
                <button type="button" data-cd-toggle aria-label="start or pause">Start</button>
                <button type="button" data-cd-reset aria-label="reset">Reset</button>
              </div>
            </div>
            <button class="gear" data-gear aria-label="clock settings">⚙</button>
            <div class="settings" data-settings hidden>
              <label><input type="checkbox" data-opt="hour12"> 12-hour</label>
              <label><input type="checkbox" data-opt="seconds"> seconds</label>
              <label><input type="checkbox" data-opt="showDate"> date</label>
              <label>size
                <select data-opt="size"><option value="s">S</option><option value="m">M</option><option value="l">L</option></select>
              </label>
              <label>zone
                <select data-opt="tz">${ZONES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
              </label>
              <label>mode
                <select data-opt="mode">
                  <option value="clock">Clock</option>
                  <option value="timer">Timer</option>
                  <option value="stopwatch">Stopwatch</option>
                  <option value="pomodoro">Pomodoro</option>
                </select>
              </label>
            </div>
          </div>`;

        // *** APPENDED AFTER, NOT INLINE AT THE TOP. *** A `<style>` written as the FIRST thing
        // in the template literal above (as this was originally) becomes `mount.firstElementChild`
        // -- and `dev/fit_test.html`'s resize check reads exactly that element's
        // `getBoundingClientRect()` to prove a module notices its box growing. A `<style>` tag
        // has no size, so the check saw "root:0x0" forever, resize or not -- a real regression
        // this exact change introduced, caught by `fit_test.html` (`clock: notices the box grew`)
        // and fixed by matching `call.js`'s own convention: build the style element separately,
        // append it AFTER the real content is already in the DOM. Where a `<style>` tag sits
        // does not change what it styles -- only which element answers `firstElementChild`.
        const style = document.createElement('style');
        style.textContent = `
          .clock .cd{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}
          .clock .cd-label{font-size:1rem;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.04em}
          .clock .cd-value{font-weight:800;color:var(--text-strong);font-variant-numeric:tabular-nums;
            font-size:clamp(2.2rem, 12cqw, 4.6rem); line-height:1}
          .clock .cd-status{min-height:1.3em;font-size:1rem;font-weight:700;color:var(--accent-warm-deep, #a85f52)}
          .clock[data-alerted="1"] .cd-value{animation:clockAlertPulse 1s ease-in-out infinite}
          @keyframes clockAlertPulse{0%,100%{opacity:1}50%{opacity:.3}}
          .clock .cd-controls{display:flex;gap:14px;flex-wrap:wrap;justify-content:center}
          .clock .cd-controls button{min-width:120px;min-height:64px;font-size:1.15rem;font-weight:700;
            border-radius:var(--radius, 16px);border:2px solid var(--accent);background:var(--surface);
            color:var(--text-strong);cursor:pointer;padding:10px 20px}
          .clock .cd-controls button:disabled{opacity:.5;cursor:default}
          .clock .cd-controls button[data-cd-toggle]{background:var(--accent);color:var(--on-dark)}
        `;
        mount.appendChild(style);

        mount.querySelector('[data-gear]').addEventListener('click', () => {
          const s = mount.querySelector('[data-settings]');
          s.hidden = !s.hidden;
        });

        // Each control writes its key into overwrite state (versioned, per profile).
        mount.querySelectorAll('[data-opt]').forEach((el) => {
          el.addEventListener('change', () => {
            const key = el.dataset.opt;
            const value = el.type === 'checkbox' ? el.checked : el.value;
            state.set({ [key]: value });
          });
        });

        // THE ON-PANEL CONTROLS. Real and wired to the real state machines above — not a
        // cosmetic pair of buttons, so a press here does what it says whether it came from a
        // mouse, a touch, or a switch bound to a click on this element.
        mount.querySelector('[data-cd-toggle]').addEventListener('click', toggleCd);
        mount.querySelector('[data-cd-reset]').addEventListener('click', resetCd);

        // Server is the source of truth: adopt saved config (own writes, first
        // load, or another device via the poller), then repaint.
        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          syncControls();
          syncModeState();
          paint();
        });

        paint();
        timer = setTick(paint, 1000);
      },
      onResize() {},
      onHide() {},
      destroy() { clearTick(timer); timer = null; },
    };
  },
);
