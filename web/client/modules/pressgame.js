// modules/pressgame.js — "Wait / Go": the go/no-go rung, ported from Cici.
//
// A slow breathing field BUILDS a visible charge while she waits. When the invite opens, her
// press cashes that charge as a payoff scaled to how long she held off. Then a quiet STOP
// phase that ends only once she has gone still.
//
// *** THIS IS THE FIRST MODULE ON THIS STACK THAT PRODUCES CLINICAL EVIDENCE, AND THE DATA
// MODEL IS THE JOB. *** The graphics are a day's work; what follows is the part that has to
// be right, because an append-only log has no second chance at a field.
//
// ---------------------------------------------------------------------------------------
// WHAT IT RECORDS, AND WHY EACH ONE IS NOT OBVIOUS
// ---------------------------------------------------------------------------------------
//
// EVIDENCE CANDIDATES, NEVER SCORES. `vision_probe_spec.md` puts it best and this module
// takes the wording over "practice test": *we supply cited evidence; a clinician scores.* A
// practice test is still a test with a result. An evidence candidate is an observation with
// a citation that somebody qualified uses while doing their own scoring. So the CRS-R
// subscale is A FIELD INSIDE the record, never the name on the tin, and nothing here adds
// up to a number anybody could mistake for a rating.
//
// A MISSED PRESS IS NOT PROOF SHE CANNOT RESPOND. It could be arousal, fatigue, attention,
// motor output, or the screen. This module cannot separate those and does not try; it
// produces flags to verify. The clinical value is in latency, consistency and time of day —
// the points are just engagement.
//
// TWO CHANNELS, AND THEY ARE INDEPENDENT (Mike: "the data side of the module is listening
// for those verbs even if they're not reflected in the game's output on the screen"):
//
//   GAMEPLAY     `pressgame/press` — the routed verb. This is what makes something happen.
//   MEASUREMENT  `access/edge` — every physical press and release, including the ones this
//                game ignores. An echo press 200ms after the payoff changes no pixels and is
//                PERSEVERATION in the record. That signal only exists because they are
//                separate subscriptions.
//
// *** HOLD DURATION IS NOT SELF-EXPLANATORY *** (Mike, 2026-08-29). A long hold can mean she
// could not let go, or it can mean the binding ASKED for a long hold. The edge stream carries
// `requiredHoldMs` alongside `heldMs` for exactly this, and both go in the row untouched.
// This module does not classify which one a hold was — that is a judgement about a person.
//
// *** THE MACHINE IS A CONFOUND AND IT IS RECORDED AS ONE *** (Mike: "maybe the game's
// latency/FPS should be recorded"). A latency measurement is only as good as the clock under
// it. If the page stalled between deciding to show GO and actually painting it, then a "580ms
// response" is her plus the stall, and on a Pi 400 that stall is real. So every trial carries
// `goDelayMs` (schedule → paint) and `frameMaxMs` (the worst frame while she was responding).
// A slow trial can then be told from a slow person. THIS IS THE SAME CLASS OF ERROR AS THE
// `heldMs` TAUTOLOGY: a number that looks like it is about her and is partly about the setup.
//
// CALM MODE'S INVITE NEVER TIMES OUT, AND THAT IS THE CORRECT BEHAVIOR. It waits for her
// press however long that takes. This is the windmill case from the invariant: the press IS
// the content, not a gate on content already running, so there is no state here that only an
// input can leave. Only CHALLENGE mode closes the window, and there a missed press is an
// omission — which is a thing somebody opted into.
//
// THE SPOKEN CUES ARE THE INSTRUCTION, NOT DECORATION. Cici's original says "Wait", "Go!",
// "You can stop pressing now" and a reward word in a recorded voice, and the first port of
// this module dropped all of it while reporting only that the MUSIC loader had gone. Those
// are not the same thing: the music was atmosphere, the cues are how somebody who is not
// reading the screen knows what is being asked. They are back, and they go through the
// OUTPUT BUS — this module says WHAT, and the person's own routing decides HOW. That
// matters here specifically, because Cici's version was recording-only (her own voice or
// silence, never browser TTS) and that is a real preference about a real person's screen.
// It is a routing decision, so it lives in their output settings and not in this file.
//
// WHAT THE PORT DROPPED, and why: Cici's meditation-music loader (no drive, no manifest, no
// audio bus here — a module that fetches a missing file on every mount logs errors forever),
// the localStorage player roster (people are the platform's job now, and the session roster
// is a server table), and the document.head stylesheet (scoped to the instance so two can
// coexist). The synthesised tones stay; they need no files.

import { registerModule } from '../module.js';
import { EDGE_TOPIC } from '../input.js';
import { createGameMusic } from '../game_music.js';
import { createMediaSourcesClient } from '../media_sources.js';

// *** BUMP THIS WHENEVER A RECORDED FIELD IS ADDED OR CHANGES MEANING. ***
// It rides on every row as `producer_version`, and it is what lets a reader in two years tell
// "this row predates the field" from "this row had the field and nobody filled it in" —
// without writing anything back into an append-only log. See provenance.py.
const PRODUCER = 'pressgame@1.0';

// The subscale this module bears on. A FIELD, not a label for the export.
const CRSR_SUBSCALE = 'motor';
const CRSR_CANDIDATE = 'object_manipulation_5';

const DEFAULTS = {
  waitMs: 10000,        // how long the wait runs before the invite opens
  minWaitMs: 2500,      // never shorter than this
  challenge: false,     // challenge closes the invite window; calm waits forever
  adaptiveWait: true,   // challenge only: faster after a clean wait, slower after a press
  stopQuietMs: 3000,    // STOP ends after this long with no press
  sound: true,
  // AMBIENT BY DEFAULT, so a game has music on a machine nobody has configured. Point it at
  // a linked folder for real tracks; see game_music.js for why falling back is not failing.
  music: 'ambient',     // 'ambient' | 'folder' | 'off'
  musicSourceId: '',
  musicAlbum: '',
  musicVolume: 0.3,
  speak: true,          // say the cues aloud, through the person's own output routing
  rewardWord: 'Well done',
  calm: false,          // motion budget
  // OPEN TO A MENU RATHER THAN STRAIGHT INTO PLAY (Mike, 2026-09-02).
  //
  // The panel used to mount and be mid-round immediately, so somebody looking at it for the
  // first time was already being measured and had no way to know what it wanted. A start
  // screen says what the game is before it asks anything of them.
  //
  // IT IS A SETTING RATHER THAN A FIXED BEHAVIOUR, and the reason is the bedside. Turning it
  // off restores the old straight-to-play mount, which is what a screen meant to be already
  // running wants — one that boots unattended, or that lives in a quadrant nobody walks up
  // to. Either way the breathing field keeps drawing BEHIND the menu, so the panel is never
  // a dead rectangle while it waits, and the menu is left by the same press the game itself
  // is played with — no new input, and nothing here needs a pointer.
  openToMenu: true,

  // *** ASK BEFORE LEAVING (Mike, 2026-09-03: "an option for an are you sure you want to exit
  // without saving popup that defaults to off. Could be a good thing for clinicians"). ***
  //
  // OFF BY DEFAULT. A confirm is the right tool for somebody running a session they do not
  // want to lose by catching a switch; it is the wrong tool for a person whose only input is
  // that switch, for whom every extra press is work.
  //
  // AND IT CANNOT STRAND ANYBODY, which is the part that had to be designed rather than
  // added. The prompt is answered by REPEATING the same exit input — one switch, no scanning
  // between two buttons — and if nobody answers it at all it times out and the game simply
  // carries on. Inaction leaves you playing. That is the difference between a confirm and a
  // gate: nothing here enters a state that only an input can leave.
  confirmExit: false,
  confirmMs: 12000,
};

// Only speak a cue if the phase it belongs to lasts long enough to hear it. Cici's original
// carried the same rule (`cueVoiceMinMs`) and the reason is not politeness: a cue that is
// still being said when the phase it announces has ended is actively misleading.
const CUE_MIN_MS = 1200;

// *** THE GENTLE LINES, WHILE SHE IS MASHING. *** Cici's original plays one of these at
// random when she presses during the wait, and again during the stop phase once the first
// "you can stop" has been said.
//
// READ THEM: not one of them tells her she is wrong. "Not yet" and "almost" are about the
// TASK; "relax" and "loosen your grip" are about her hand. A go/no-go task punishes early
// presses by definition, and the voice is where that could easily have become scolding
// somebody for a movement they did not choose. It does not, and that is deliberate.
const REMINDERS = [
  'Relax',
  'Loosen your grip',
  'Not yet',
  'Easy now',
  'Almost',
];

// A press can re-trigger a line after a couple of seconds, and no sooner. Cici's
// `reminderMinMs`, and the reason is the whole design of the stop phase: somebody
// perseverating presses FAST, and a line per press would be a voice talking over itself at
// the exact moment she is least able to act on it.
const REMINDER_MIN_MS = 2500;

const WAIT_SPEED = 0.85;      // a clean wait shortens by ~15%; a press lengthens by the same
const SAFETY_FLOOR_MS = 1500; // photosensitivity: full-screen cycling stays well under flash rates
const CELEBRATION_MS = 1500;
const MAX_SPARKS = 260;

const SETTINGS = [
  { key: 'openToMenu', label: 'When the panel opens', default: true, level: 'essential',
    onLabel: 'Show a start screen first', offLabel: 'Start playing straight away' },
  { key: 'confirmExit', label: 'Leaving a session', default: false, level: 'standard',
    onLabel: 'Ask before ending it', offLabel: 'Leave straight away' },
  { key: 'waitMs', label: 'How long the wait runs', kind: 'choice', default: 10000, level: 'essential',
    options: [
      { value: 4000, label: 'A few seconds' },
      { value: 10000, label: 'About ten seconds' },
      { value: 20000, label: 'A long wait' },
      { value: 40000, label: 'A very long wait' },
    ] },
  { key: 'challenge', label: 'Mode', default: false, level: 'essential',
    onLabel: 'Challenge — the invite can time out', offLabel: 'Calm — the invite waits for her' },
  { key: 'sound', label: 'Sound', default: true, level: 'essential',
    onLabel: 'Tones on', offLabel: 'Silent' },
  { key: 'speak', label: 'Say the cues out loud', default: true, level: 'essential',
    onLabel: 'Spoken — "Wait", "Go"', offLabel: 'On screen only' },
  { key: 'rewardWord', label: 'What it says when they get it', kind: 'text', default: 'Well done',
    level: 'standard' },
  { key: 'music', label: 'Music', kind: 'choice', default: 'ambient', level: 'essential',
    options: [
      { value: 'ambient', label: 'A quiet hum — needs nothing' },
      { value: 'folder', label: 'From a folder of music' },
      { value: 'off', label: 'No music' },
    ] },
  { key: 'musicSourceId', label: 'Music from', kind: 'choice', default: '', level: 'standard',
    emptyLabel: 'No source connected' },
  { key: 'musicAlbum', label: 'Music folder', kind: 'text', default: '', level: 'standard',
    placeholder: 'Everything', note: 'set in Media / Sources' },
  { key: 'musicVolume', label: 'How loud the music is', kind: 'choice', default: 0.3,
    level: 'standard',
    options: [
      { value: 0.15, label: 'Very quiet' },
      { value: 0.3, label: 'Quiet' },
      { value: 0.55, label: 'Present' },
    ] },
  { key: 'calm', label: 'Motion', default: false, level: 'standard',
    onLabel: 'Calm — less movement', offLabel: 'Normal' },
  { key: 'stopQuietMs', label: 'After a win, wait for stillness', kind: 'choice', default: 3000,
    level: 'advanced',
    options: [
      { value: 0, label: 'Not at all' },
      { value: 3000, label: 'A few seconds' },
      { value: 6000, label: 'Longer' },
    ] },
];

function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    beige: v('--beige', '#fff3d9'),
    gold: v('--gold', '#ffd36e'),
    rosy: v('--rosy', '#d3968c'),
    moss: v('--moss', '#9ec7b0'),
    sage: v('--sage', '#cfe0d9'),
  };
}

registerModule(
  { type: 'pressgame', title: 'Wait and Go',
    description: 'Hold off while a charge builds, then press when the invite opens',
    // `local` rather than `none`: the visuals and tones need nothing, but the trial records
    // want somewhere to go. It still RUNS with no server — it just stops being evidence.
    importance: 'optional', dependsOn: 'local', settings: SETTINGS },
  (ctx) => {
    // `output` is OPTIONAL. A surface that has not mounted an output bus (a test rig, the
    // signed-out preview) still gets the whole game with its on-screen text; it just does not
    // speak. A module that threw without one would be a module that needs a whole subsystem
    // to draw a circle.
    const { mount, bus, state, events, output = null, audio = null } = ctx;
    let cfg = { ...DEFAULTS };

    // Kept apart from cfg.calm for the same reason the comet keeps them apart: folding the
    // system's request into the saved setting makes the settings row lie.
    let reducedMotion = false;
    const calm = () => cfg.calm || reducedMotion;

    let root = null, canvas = null, c2d = null, textEl = null, menuEl = null, askEl = null;
    // The exit confirm, when it is switched on. `askAt` is in simT so it times out on the
    // same clock everything else in this module runs on — a test can drive it with __step.
    let askingExit = false, askAt = 0;
    let raf = 0, running = false, lastFrame = 0;
    let W = 1, H = 1, DPR = 1;
    let theme = null, observer = null, visible = true;
    let ac = null, sfx = null;
    let music = null;
    const offs = [];

    // ---- the simulation clock, deliberately not the wall clock -----------------------
    // Everything that MOVES advances by the dt handed to step(), so the module can be driven
    // a frame at a time with no requestAnimationFrame. rAF does not run when a page is not
    // being composited, and a test that depends on it fails for reasons that are not the
    // module's. The comet learned this the hard way; this one inherits the lesson.
    let simT = 0;

    // ---- game state ------------------------------------------------------------------
    // `menu` is the pre-game phase: nothing is measured and no session has started. It is a
    // real phase rather than a flag so `__probe().phase` still answers "what is this panel
    // doing" with one word, and so step()/press() cannot forget to check it.
    let phase = 'wait';              // menu | wait | go | stop
    let phaseStart = 0;              // in simT
    let curWaitMs = DEFAULTS.waitMs;
    let frozenCharge = 0;
    let payoffDone = false;
    let lastPressAt = 0;             // simT of the last press, for the STOP quiet meter
    let echoes = 0;
    let lastReminderAt = -1e9;       // simT of the last gentle line
    let lastStopCueAt = -1e9;
    let saidStop = false;            // has "you can stop" been said this round
    let sparks = [];
    let trialSeq = 0;

    // ---- the machine as a confound ---------------------------------------------------
    // `goDelayMs` is schedule → paint. `frameMaxMs` is the worst frame in the response
    // window. Both exist so a slow trial can be told from a slow person.
    let goScheduledAt = 0;           // simT when the invite was decided on
    let goPaintedAt = null;          // simT of the first frame that actually drew it
    let frameMaxMs = 0;              // worst dt since the window opened
    let frameCount = 0;
    let frameSumMs = 0;

    // ---- the sitting ------------------------------------------------------------------
    // One id for the whole sitting, shared with every row. It is the join a trial uses to
    // cite back to a recording, which is what both clinical specs are built around.
    let sessionId = null;
    const sessionRows = [];          // the local copy, for the evidence record

    function newSessionId() {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
      return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    }

    // ---- the record -------------------------------------------------------------------
    //
    // One row per observation. `extra` is whatever this trial measured; the core fields are
    // the platform's and a row never redefines one (the same rule provenance.merge_extra
    // enforces server-side, for the same reason: the day a module writes its own
    // `principal_type` is the day every filter built on it starts quietly lying).
    const CORE = ['seq', 'kind', 'phase', 'atMs', 'sessionMs', 'crsrSubscale', 'crsrCandidate'];

    function record(kind, extra = {}) {
      for (const k of CORE) {
        if (k in extra) throw new Error(`pressgame: "${k}" is a core field and a trial may not redefine it`);
      }
      const row = {
        seq: ++trialSeq,
        kind,
        phase,
        atMs: Date.now(),
        sessionMs: Math.round(simT),
        // THE SUBSCALE IS A FIELD. This is not a CRS-R export; it is an observation that
        // bears on one, and somebody qualified decides what it is worth.
        crsrSubscale: CRSR_SUBSCALE,
        crsrCandidate: CRSR_CANDIDATE,
        ...extra,
      };
      sessionRows.push(row);
      // Append-only, with the sitting and the build that made it in their own columns.
      // A failure here must not stop the game — she is playing, and a lost row is better
      // than a frozen screen.
      events?.append?.('trial', row, { sessionId, producerVersion: PRODUCER })
        ?.catch?.((err) => console.error('pressgame: trial not stored', err));
      bus.publish('pressgame/trial', row);
      return row;
    }

    // ---- the evidence record (NOT a CRS-R export, and not a score) --------------------
    function evidenceRecord() {
      const of = (k) => sessionRows.filter((r) => r.kind === k);
      const hits = of('hit');
      const lat = hits.map((r) => r.latencyMs).filter((v) => Number.isFinite(v));
      const stops = of('stop_done');
      return {
        producerVersion: PRODUCER,
        sessionId,
        crsrSubscale: CRSR_SUBSCALE,
        crsrCandidate: CRSR_CANDIDATE,
        // Named for what it is. "Session evidence record", never "CRS-R export".
        kind: 'session_evidence_record',
        counts: {
          hits: hits.length,
          omissions: of('omission').length,
          commissions: of('commission').length,
          perseverationEpisodes: stops.length,
          perseverationPresses: stops.reduce((a, r) => a + (r.echoes || 0), 0),
        },
        // Mean is offered because a clinician asked for it, WITH the spread, because a mean
        // of three trials is not a finding and a bare number invites being read as one.
        latency: lat.length
          ? { n: lat.length, meanMs: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length),
              minMs: Math.min(...lat), maxMs: Math.max(...lat) }
          : { n: 0 },
        // The honest framing, carried in the record itself rather than left to a reader's
        // good intentions.
        caveat: 'Evidence candidates, not scores. A missed press is not proof she cannot '
              + 'respond — arousal, fatigue, attention, motor output and the screen itself are '
              + 'not separable here. Points are engagement only.',
        rows: sessionRows.slice(),
      };
    }

    // ---- sound. Synthesised only — nothing to 404. -----------------------------------
    function audioInit() {
      if (ac || !cfg.sound) return;
      try {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return;
        ac = new A();
        sfx = ac.createGain();
        sfx.gain.value = 0.18;
        sfx.connect(ac.destination);
      } catch { ac = null; }
    }
    function tone(freq, ms, type = 'sine') {
      if (!ac || !sfx || !cfg.sound) return;
      try {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(1, ac.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
        o.connect(g); g.connect(sfx); o.start(); o.stop(ac.currentTime + ms / 1000 + 0.02);
      } catch { /* audio is a nicety */ }
    }

    // ---- the spoken cue ----------------------------------------------------------------
    //
    // *** THE MODULE SAYS WHAT; THE PERSON'S SETTINGS DECIDE HOW. *** It emits a `say` on the
    // output bus and never learns whether that became a synthesised voice, a recording, a
    // banner or nothing at all. That matters here specifically: Cici's original was
    // RECORDING-ONLY - her own voice or silence, never browser TTS - and that is a real
    // preference somebody holds about their own screen. It is a ROUTING decision, so it
    // belongs to the person's output settings and not to this file. Hard-coding either
    // answer here would take the choice away from whoever holds the opposite one.
    //
    // `say` rather than `alert`: this is the content, not an interruption, and giving a game
    // cue alert priority would let it preempt something that actually mattered.
    // NOTE: the minPhaseMs guard is currently UNREACHABLE for the wait, because the
    // photosensitivity floor (2500ms) is already above CUE_MIN_MS - no wait can be too short
    // to announce. It is kept because the floor is a setting away from moving and a silently
    // missing guard is worse than an idle one, but nothing tests it, and a guard no test can
    // reach is a guard nobody knows still works. Say so rather than writing a test that
    // cannot fail.
    function cue(text, { minPhaseMs = 0 } = {}) {
      if (!cfg.speak || !text || !output) return;
      if (minPhaseMs && minPhaseMs < CUE_MIN_MS) return;
      try { output.say(String(text)); } catch (err) { console.error('pressgame cue', err); }
    }

    // A gentle line while she is pressing during the wait. Throttled, random, never scolding.
    function maybeRemind() {
      if (simT - lastReminderAt < REMINDER_MIN_MS) return;
      lastReminderAt = simT;
      cue(REMINDERS[Math.floor(Math.random() * REMINDERS.length)]);
    }

    // The stop-phase voice. THREE RULES, all of them Cici's and all of them worth keeping:
    //   * SILENT DURING THE CELEBRATION. She just won; talking over the payoff to tell her to
    //     stop turns the reward into a correction.
    //   * The first line is "you can stop pressing now", ONCE per round.
    //   * After that it is the same gentle lines the wait uses - because by then repeating
    //     the instruction is not adding information, and she has already heard it.
    function maybeStopCue() {
      if (elapsed() < CELEBRATION_MS) return;
      if (simT - lastStopCueAt < REMINDER_MIN_MS) return;
      lastStopCueAt = simT;
      if (!saidStop) { saidStop = true; cue('You can stop pressing now'); return; }
      cue(REMINDERS[Math.floor(Math.random() * REMINDERS.length)]);
    }

    // ---- phases -----------------------------------------------------------------------
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const elapsed = () => simT - phaseStart;
    const floorMs = () => Math.max(SAFETY_FLOOR_MS, cfg.minWaitMs || 0);
    const waitAdapts = () => cfg.adaptiveWait && cfg.challenge;
    // 0 → 1 across the wait. This is the charge she is holding off to build.
    const liveCharge = () => clamp(elapsed() / Math.max(1, curWaitMs), 0, 1);
    const stopCharge = () => (cfg.stopQuietMs > 0
      ? clamp((simT - lastPressAt) / cfg.stopQuietMs, 0, 1) : 1);

    // ---- the start screen --------------------------------------------------------------
    // NOTHING IS RECORDED HERE. A session begins when somebody chooses to begin it, so the
    // trial stream never opens with rows from a panel that was simply on the wall. That also
    // keeps `session_start` honest as the marker of "somebody sat down to this".
    function enterMenu() {
      phase = 'menu'; phaseStart = simT; payoffDone = false; echoes = 0;
      frozenCharge = 0; goPaintedAt = null;
      askingExit = false;
      setText('', '');
      if (askEl) askEl.hidden = true;
      if (menuEl) menuEl.hidden = false;
    }

    // ---- leaving -------------------------------------------------------------------------
    //
    // *** EXIT GOES TO THIS PANEL'S OWN START SCREEN, NOT ANYWHERE ELSE ON THE SCREEN. ***
    // That is what makes it definable at all. On a laid-out kiosk this game is one quadrant of
    // four, so there is no "back" for it to go to — closing the panel would leave a hole in
    // somebody's screen, and going Home is already the menu's job and already never hidden.
    // Ending the sitting and returning to the start screen is the one meaning of "exit" that
    // is true whether the game is the whole screen or a quarter of it.
    //
    // WHAT "SAVE" MEANS HERE, precisely: every trial was already written as it happened, so
    // nothing is waiting to be saved. What exit writes is the SESSION EVIDENCE RECORD — the
    // summary that makes a sitting citable rather than a pile of loose rows. `destroy()` has
    // always written one; now leaving on purpose writes one too, at the moment somebody
    // decided the sitting was over rather than whenever the panel happened to be torn down.
    function endSession(reason) {
      if (!sessionRows.length) return;            // nothing happened; nothing to summarise
      try {
        const ev = evidenceRecord();
        events?.append?.('session_evidence_record', { ...ev, endedBy: reason },
          { sessionId, producerVersion: PRODUCER })?.catch?.(() => {});
      } catch { /* a failed summary must not stop somebody leaving */ }
      sessionRows.length = 0;
      sessionId = newSessionId();                 // the next sitting is a new one
      trialSeq = 0;
    }

    // The exit input. With `confirmExit` off this leaves immediately. With it on, the FIRST
    // one asks and the SECOND one leaves — the same input twice, so it is answerable by
    // somebody with exactly one switch and no way to choose between two on-screen buttons.
    // Ignore it and `confirmMs` later the question goes away and the game carries on.
    function exitGame() {
      if (phase === 'menu') return;               // already there; nothing to leave
      if (cfg.confirmExit && !askingExit) {
        askingExit = true;
        askAt = simT;
        if (askEl) askEl.hidden = false;
        return;
      }
      endSession(askingExit ? 'confirmed' : 'exit');
      enterMenu();
    }

    // Leaving the menu IS starting the session — the two cannot drift apart, which is why
    // init() calls this rather than repeating the pair.
    function startSession() {
      if (menuEl) menuEl.hidden = true;
      enterWait();
      record('session_start', { mode: mode(), waitMs: Math.round(curWaitMs) });
    }

    function enterWait() {
      phase = 'wait'; phaseStart = simT; payoffDone = false; echoes = 0;
      frozenCharge = 0; goPaintedAt = null; frameMaxMs = 0; frameCount = 0; frameSumMs = 0;
      saidStop = false;                 // "you can stop" is once per ROUND, not once per session
      setText('Wait', '');
      // Only if the wait is long enough that the word is still true when it finishes.
      cue('Wait', { minPhaseMs: curWaitMs });
    }

    // Opening the invite. `scheduledAt` is when we DECIDED; the paint stamp comes later.
    function enterGo() {
      frozenCharge = liveCharge();
      phase = 'go'; phaseStart = simT; payoffDone = false;
      goScheduledAt = simT; goPaintedAt = null;
      frameMaxMs = 0; frameCount = 0; frameSumMs = 0;
      setText('Go', 'go');
      tone(660, 220);
      // ALWAYS SPOKEN, no minimum: in calm mode the invite has no length to be shorter than,
      // and "Go" is the one word the whole module exists to deliver.
      cue('Go');
      record('go_shown', { charge: +frozenCharge.toFixed(3), mode: mode() });
    }

    function enterStop() {
      phase = 'stop'; phaseStart = simT; lastPressAt = simT; echoes = 0;
      setText('Stop', 'stop');
      cue(cfg.rewardWord);
    }

    const mode = () => (cfg.challenge ? 'challenge' : 'calm');

    // The frame-health numbers as they stand for the trial being measured.
    function machine() {
      return {
        // Schedule → paint. Null until the invite has actually been drawn once.
        goDelayMs: goPaintedAt == null ? null : Math.round(goPaintedAt - goScheduledAt),
        frameMaxMs: Math.round(frameMaxMs),
        frameMeanMs: frameCount ? Math.round(frameSumMs / frameCount) : null,
        frames: frameCount,
      };
    }

    // ---- what a press does (the GAMEPLAY channel) -------------------------------------
    function press(source) {
      audioInit();
      // The first press is the gesture browsers require before any audio may start. Cici's
      // did exactly this, and for the same reason.
      try { music?.play(); } catch { /* a bed is not worth an exception */ }
      lastPressAt = simT;
      // THE MENU IS LEFT BY THE SAME PRESS THE GAME IS PLAYED WITH. Whoever can play this can
      // start it — one switch, one key, a tap, or the `select` verb — so the start screen
      // cannot become a door that needs an input the player does not have. It is checked
      // FIRST so a press on the menu is never also counted as a commission.
      if (phase === 'menu') { startSession(); return; }
      if (phase === 'wait') {
        // Never punished. A press here is a commission in the record and a bloom on screen.
        bloom(0.45);
        tone(320, 120, 'triangle');
        maybeRemind();
        record('commission', { charge: +liveCharge().toFixed(3), mode: mode(), src: source });
        phaseStart = simT;                              // a press restarts the wait
        if (waitAdapts()) curWaitMs = Math.min(cfg.waitMs, curWaitMs / WAIT_SPEED);
        return;
      }
      if (phase === 'go' && !payoffDone) {
        payoffDone = true;
        const latencyMs = goPaintedAt == null ? null : Math.round(simT - goPaintedAt);
        bloom(1);
        tone(880, 420);
        record('hit', {
          // Measured from when the invite was PAINTED, not when it was decided. If the two
          // differ, the difference is `goDelayMs` and it belonged to the machine.
          latencyMs,
          latencyFromScheduleMs: Math.round(simT - goScheduledAt),
          charge: +frozenCharge.toFixed(3), mode: mode(), src: source,
          machine: machine(),
        });
        if (waitAdapts()) curWaitMs = Math.max(floorMs(), curWaitMs * WAIT_SPEED);
        enterStop();
        return;
      }
      if (phase === 'stop') {
        // *** PERSEVERATION, NOT A FALSE ALARM. *** She already won; these are echoes, and
        // counting them as commissions would describe a different thing entirely.
        echoes++;
        bloom(0.3);
        maybeStopCue();
        record('perseveration', { n: echoes, msSinceHit: Math.round(elapsed()), src: source });
        return;
      }
      record('press_extra', { src: source });
    }

    // ---- the MEASUREMENT channel ------------------------------------------------------
    //
    // Subscribed separately and on purpose. This sees presses the game ignored, presses that
    // were bound to nothing, and every release with its real duration. It writes rows; it
    // NEVER drives the game — if it did, a press would count twice.
    function onEdge(e) {
      if (!e) return;
      if (e.phase === 'down') {
        record('edge_down', {
          deviceClass: e.deviceClass, bound: e.bound, concurrent: e.concurrent,
          requiredHoldMs: e.requiredHoldMs, pressId: e.pressId,
          gamePhase: phase,
        });
        return;
      }
      record('edge_up', {
        deviceClass: e.deviceClass, bound: e.bound, concurrent: e.concurrent,
        // BOTH NUMBERS, ALWAYS TOGETHER. `heldMs` alone cannot tell "she could not let go"
        // from "the binding asked for a long hold", and separating them later is impossible.
        heldMs: e.heldMs, requiredHoldMs: e.requiredHoldMs,
        // A synthesized release. NOBODY LET GO, so release timing from this row is not a
        // measurement of her and a reader has to be able to drop it.
        auto: e.auto,
        pressId: e.pressId,
        gamePhase: phase,
      });
    }

    // ---- visuals ----------------------------------------------------------------------
    function setText(t, cls) {
      if (!textEl) return;
      textEl.textContent = t;
      textEl.className = `pg-text${cls ? ` ${cls}` : ''}`;
    }

    function bloom(strength) {
      if (calm()) { sparks.push(...spawn(Math.round(12 * strength), strength)); return; }
      sparks.push(...spawn(Math.round(70 * strength), strength));
      if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
    }

    function spawn(n, strength) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.06 + Math.random() * 0.22) * (0.4 + strength);
        out.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                   life: 1, r: 2 + Math.random() * 4 });
      }
      return out;
    }

    // *** THE ONLY PLACE TIME ADVANCES. *** Called by the rAF loop and, in a test, directly.
    function step(dt) {
      simT += dt;
      // Frame health, for the machine-as-confound record. Capped: a tab that was hidden for
      // a minute would otherwise report a 60-second "frame".
      const d = Math.min(dt, 500);
      if (d > frameMaxMs) frameMaxMs = d;
      frameCount++; frameSumMs += d;

      // THE CONFIRM EXPIRES, and this is the line that keeps it a question rather than a gate.
      // Nobody answering means the game carries on, so the worst case for somebody who cannot
      // reach their switch is that they keep playing — never that they are held on a prompt.
      if (askingExit && simT - askAt >= (cfg.confirmMs || DEFAULTS.confirmMs)) {
        askingExit = false;
        if (askEl) askEl.hidden = true;
      }

      if (phase === 'wait' && liveCharge() >= 1) {
        if (waitAdapts()) curWaitMs = Math.max(floorMs(), curWaitMs * WAIT_SPEED);
        enterGo();
      } else if (phase === 'go' && !payoffDone) {
        // The invite has now been drawn at least once. This stamp — not the schedule — is
        // what latency is measured from.
        if (goPaintedAt == null) goPaintedAt = simT;
        // *** CALM NEVER TIMES OUT. *** Only challenge closes the window.
        if (cfg.challenge && elapsed() >= curWaitMs) {
          record('omission', {
            charge: +frozenCharge.toFixed(3), mode: mode(), windowMs: Math.round(curWaitMs),
            machine: machine(),
          });
          if (waitAdapts()) curWaitMs = Math.min(cfg.waitMs, curWaitMs / WAIT_SPEED);
          enterWait();
        }
      } else if (phase === 'stop') {
        if (cfg.stopQuietMs <= 0 || (simT - lastPressAt) >= cfg.stopQuietMs) {
          record('stop_done', { echoes, quietMs: cfg.stopQuietMs, mode: mode() });
          enterWait();
        }
      }

      for (const s of sparks) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 0.00018 * dt;
        s.life -= dt / 900;
      }
      sparks = sparks.filter((s) => s.life > 0);
    }

    function draw() {
      if (!c2d) return;
      const charge = phase === 'wait' ? liveCharge() : (phase === 'stop' ? stopCharge() : frozenCharge);
      c2d.fillStyle = '#05070f';
      c2d.fillRect(0, 0, W, H);

      // The breathing field. Its brightness IS the charge, so waiting is visibly worth
      // something rather than being an empty screen somebody is asked to endure.
      const breath = 0.5 + 0.5 * Math.sin(simT * 0.0007);
      const r = Math.max(W, H) * (0.22 + 0.5 * charge);
      const g = c2d.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
      const warm = phase === 'go' ? theme.gold : theme.rosy;
      g.addColorStop(0, warm);
      g.addColorStop(1, 'rgba(5,7,15,0)');
      c2d.globalAlpha = 0.18 + 0.5 * charge * (0.7 + 0.3 * breath);
      c2d.fillStyle = g;
      c2d.beginPath(); c2d.arc(W / 2, H / 2, r, 0, Math.PI * 2); c2d.fill();
      c2d.globalAlpha = 1;

      if (phase === 'stop' && elapsed() < CELEBRATION_MS && !calm()) {
        const a = Math.max(0, 0.35 - elapsed() / 4200);
        if (a > 0) { c2d.globalAlpha = a; c2d.fillStyle = theme.beige; c2d.fillRect(0, 0, W, H); c2d.globalAlpha = 1; }
      }

      for (const s of sparks) {
        c2d.globalAlpha = Math.max(0, s.life);
        c2d.fillStyle = theme.gold;
        c2d.beginPath(); c2d.arc(s.x, s.y, s.r, 0, Math.PI * 2); c2d.fill();
      }
      c2d.globalAlpha = 1;
    }

    function frame(ts) {
      if (!running) return;
      const dt = lastFrame ? Math.min(ts - lastFrame, 50) : 16;
      lastFrame = ts;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!running) { running = true; lastFrame = 0; raf = requestAnimationFrame(frame); } }
    function stopLoop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    function resize() {
      if (!canvas || !root) return;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = root.clientWidth || 1; H = root.clientHeight || 1;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      c2d = canvas.getContext('2d');
      c2d?.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    return {
      // Test hooks. A canvas module has no markup to assert against, so without these its
      // behavior can only be eyeballed — which is not a test. Reached only through `impl`.
      __step: (dt = 16) => step(dt),
      __press: (src = 'test') => press(src),
      __exit: () => exitGame(),
      __edge: (e) => onEdge(e),
      // Exposed so the core-field guard can actually be exercised. Nothing inside this module
      // can currently trip it — onEdge builds its extras by name rather than spreading the
      // event — and a guard no test can reach is a guard nobody knows still works.
      __record: (kind, extra) => record(kind, extra),
      __probe: () => ({
        phase, simT, charge: phase === 'wait' ? liveCharge() : frozenCharge,
        payoffDone, echoes, curWaitMs, sparks: sparks.length, running,
        rows: sessionRows.length, sessionId, calm: calm(), cfg: { ...cfg },
        askingExit,
        goPaintedAt, machine: machine(),
        music: music ? music.state() : null,
      }),
      __rows: () => sessionRows.slice(),
      __evidence: () => evidenceRecord(),

      init() {
        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        curWaitMs = Math.max(floorMs(), cfg.waitMs);
        sessionId = newSessionId();

        root = document.createElement('div');
        root.className = 'm-pressgame';
        const style = document.createElement('style');
        // Scoped to this subtree — no document.head, so two can coexist and destroying one
        // takes its styles with it.
        style.textContent =
          '.m-pressgame{position:absolute;inset:0;overflow:hidden;background:#05070f;touch-action:none}'
          + '.m-pressgame canvas{position:absolute;inset:0;display:block}'
          + '.m-pressgame .pg-text{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);'
          + 'text-align:center;pointer-events:none;font:700 min(12vw,130px)/1 system-ui,sans-serif;'
          + 'color:#fff3d9;text-shadow:0 0 30px rgba(255,180,90,.5),0 3px 18px rgba(0,0,0,.7)}'
          + '.m-pressgame .pg-text.go{color:#fff}'
          + '.m-pressgame .pg-text.stop{color:#cfe0d9}'
          // The start screen. Deliberately NOT a full cover — the field keeps breathing
          // behind it, so a panel waiting to be started still looks alive rather than broken.
          + '.m-pressgame .pg-menu{position:absolute;inset:0;display:flex;flex-direction:column;'
          + 'align-items:center;justify-content:center;gap:2.2cqh;text-align:center;padding:6%;'
          + 'background:radial-gradient(ellipse at center,rgba(5,7,15,.72),rgba(5,7,15,.9));'
          + 'font:400 min(3.2cqw,17px)/1.45 system-ui,sans-serif;color:#cfe0d9}'
          + '.m-pressgame .pg-menu[hidden]{display:none}'
          + '.m-pressgame .pg-menu h2{margin:0;font:700 min(7cqw,40px)/1.1 system-ui,sans-serif;'
          + 'color:#fff3d9;letter-spacing:-.01em}'
          + '.m-pressgame .pg-menu p{margin:0;max-width:34ch;opacity:.88}'
          + '.m-pressgame .pg-start{margin-top:1cqh;padding:.7em 1.9em;border-radius:999px;'
          + 'border:2px solid rgba(255,243,217,.5);background:rgba(255,243,217,.12);'
          + 'color:#fff3d9;font:700 min(4cqw,20px)/1 system-ui,sans-serif;cursor:pointer}'
          + '.m-pressgame .pg-start:focus-visible{outline:3px solid #fff3d9;outline-offset:3px}'
          + '.m-pressgame .pg-hint{font-size:.85em;opacity:.66}'
          // The exit question. A STRIP along the bottom, not a modal: the game is still
          // running behind it and still answerable, because the question is "do you want to
          // stop" and covering the thing being stopped would answer it for them.
          + '.m-pressgame .pg-ask{position:absolute;left:0;right:0;bottom:0;padding:1.4cqh 4%;'
          + 'background:rgba(5,7,15,.86);border-top:2px solid rgba(255,243,217,.35);'
          + 'text-align:center;color:#fff3d9;'
          + 'font:600 min(3.2cqw,16px)/1.4 system-ui,sans-serif}'
          + '.m-pressgame .pg-ask[hidden]{display:none}'
          + '.m-pressgame .pg-ask small{display:block;font-weight:400;opacity:.7}';
        root.appendChild(style);
        canvas = document.createElement('canvas');
        root.appendChild(canvas);
        textEl = document.createElement('div');
        textEl.className = 'pg-text';
        root.appendChild(textEl);

        // The start screen's markup is built whether or not it will be shown, so turning the
        // setting on does not need a remount to have something to show.
        menuEl = document.createElement('div');
        menuEl.className = 'pg-menu';
        menuEl.hidden = true;
        const h = document.createElement('h2');
        h.textContent = 'Wait and Go';
        const p = document.createElement('p');
        p.textContent = 'Hold off while the light builds. When it says Go, press.';
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'pg-start';
        startBtn.textContent = 'Start';
        const hint = document.createElement('div');
        hint.className = 'pg-hint';
        hint.textContent = 'Any press starts it — a switch, a key, or a tap.';
        menuEl.append(h, p, startBtn, hint);
        root.appendChild(menuEl);
        // Routed through press() rather than startSession() so the button is exactly one more
        // press source, like the canvas and the bus — there is no second way to start.
        const onStart = (e) => { e.preventDefault(); press('pointer'); };
        startBtn.addEventListener('click', onStart);
        offs.push(() => startBtn.removeEventListener('click', onStart));

        askEl = document.createElement('div');
        askEl.className = 'pg-ask';
        askEl.hidden = true;
        askEl.innerHTML = 'End this session?'
          + '<small>Do it again to end it — or ignore this and keep playing.</small>';
        root.appendChild(askEl);

        mount.appendChild(root);

        theme = readTheme(mount);
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        reducedMotion = !!mq?.matches;
        const onMq = (e) => { reducedMotion = e.matches; };
        mq?.addEventListener?.('change', onMq);
        offs.push(() => mq?.removeEventListener?.('change', onMq));

        resize();

        // THE BED. Built even when set to 'off' so the setting can be changed without a
        // remount; `off()` simply keeps it quiet.
        music = createGameMusic({
          sources: ctx.sources
            || (ctx.user ? createMediaSourcesClient({ user: ctx.user, personId: ctx.personId }) : null),
          volume: cfg.musicVolume,
          // THE ARBITER. Without it this bed plays over a spoken cue and alongside a video.
          // The id carries the instance so two pressgames are two sources, and the newest
          // one takes the music slot rather than both playing.
          audio,
          audioId: `pressgame-music:${ctx.instanceId || 'pg'}`,
        });
        if (cfg.music === 'off') music.off();
        else if (cfg.music === 'folder') {
          // Async, and deliberately not awaited: a game must not wait on a folder listing
          // before it will draw. It falls back to ambient on its own if the folder is
          // unreachable or has no music in it.
          music.useFolder(cfg.musicSourceId, cfg.musicAlbum).catch(() => {});
        } else music.useAmbient();

        // Straight to play, or to the start screen. `startSession()` is the only path into
        // the wait, so the "somebody began a session" record cannot be skipped either way.
        if (cfg.openToMenu) enterMenu();
        else startSession();

        // A pointer/tap is a press too — the module is device-blind and always was.
        const onDown = () => { press('pointer'); };
        canvas.addEventListener('pointerdown', onDown);
        offs.push(() => canvas.removeEventListener('pointerdown', onDown));

        // GAMEPLAY channel.
        offs.push(bus.subscribe('pressgame/press', () => press('verb')));
        // THE WAY OUT, on its own topic so it is bindable to whatever somebody likes (the
        // `back` verb, by default) and can never be mistaken for a press. It deliberately does
        // NOT go through press(): an exit must not land in the trial record as a commission.
        offs.push(bus.subscribe('pressgame/exit', () => exitGame()));
        // MEASUREMENT channel — separate subscription, never drives the game.
        offs.push(bus.subscribe(EDGE_TOPIC, onEdge));

        // Stop animating when nobody can see it: a canvas running behind a hidden panel is
        // battery and heat on a Pi that is on 24/7, for a picture nobody is looking at.
        if (typeof IntersectionObserver === 'function') {
          observer = new IntersectionObserver((entries) => {
            visible = entries.some((en) => en.isIntersecting);
            if (visible) start();
            else { stopLoop(); try { music?.pause(); } catch { /* already quiet */ } }
          });
          observer.observe(root);
        }
        start();
      },

      onResize() { resize(); },
      // A hidden panel humming to itself is battery and heat on a machine that is on 24/7,
      // for music nobody is in the room for.
      onHide() { stopLoop(); try { music?.pause(); } catch { /* already quiet */ } },

      destroy() {
        stopLoop();
        // The sitting ends with a record of what it was, so a partial session is still
        // citable rather than a pile of loose rows. Routed through the SAME function the exit
        // uses, which is what stops a panel that was already exited from filing a second,
        // empty summary on its way out — `endSession` returns early when there is nothing to
        // summarise, and there is exactly one place that decides what "nothing" means.
        endSession('destroy');
        try { music?.destroy(); } catch { /* already gone */ }
        music = null;
        observer?.disconnect(); observer = null;
        offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
        offs.length = 0;
        try { ac?.close?.(); } catch { /* already closed */ }
        ac = null; sfx = null;
        root?.remove(); root = null; canvas = null; c2d = null; textEl = null; menuEl = null;
        sparks = [];
      },
    };
  },
);
