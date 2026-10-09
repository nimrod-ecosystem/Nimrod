// modules/brickbreaker.js — BRICK-BREAKER, PLAYABLE ON ONE SWITCH.
//
// Row 2.37 item 10 (MIKE_CHANGE_LIST.md, private repo; room_as_home_20260930.md §7): *"Floor tiles
// and bricks can be used for rhythm and brick-breaker games."* Built standalone first; the bricks
// are drawn from theme custom properties (`--wall-brick`, `--wall-mortar`) so that when this is
// placed on the room's wall, the room sets two properties and the wall IS the game. The rules and
// the physics are `../breakout.js`; this file is the panel.
//
// *** THE ONE-SWITCH SCHEME, ARGUED (the default is `sweep`). ***
// Three ways one press can play brick-breaker; all three are built, and `control` picks:
//   sweep  (DEFAULT) The paddle glides back and forth by itself. A press STOPS it; the next press
//          starts it again - heading TOWARD THE BALL, so one press means "go and get it" and the
//          next means "stop here". The player makes one real decision per ball: where to stop.
//   steps  Nothing moves until told: next / prev move the paddle a step, select launches. For two
//          switches, arrow keys, or somebody who wants no timing at all.
//   follow The paddle catches every ball by itself; a press changes WHERE on the paddle it lands
//          (left, straight, right), which steers the rebound. Cause and effect with no failing.
// FOR `sweep` as the default: it is the only one of the three where a single switch makes a
// decision that matters, which is the difference between playing and watching. The ball is slow by
// default (breakout.js BALL_SPEEDS) and the paddle is wide, so the decision is not a race. And
// "toward the ball" on restart removes the worst case of a sweep (the paddle heading the wrong way
// with no switch to turn it round).
// AGAINST: timing is the hardest thing a switch asks for - switch users often take half a second or
// more from deciding to the press landing, and after a brain injury that can be longer and less
// steady. For them `sweep` is a game of misses, which is why missing costs nothing here (below),
// why sweep speed is its own setting, and why `follow` exists. If Mike's first user cannot time a
// press, `follow` is the better default for them - but a default is for somebody nobody has met yet.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. ***
//   * Lives are OFF by default: a missed ball comes back to the paddle and goes again by itself
//     after a few seconds (a setting; 0 = only on a press). With lives on, running out shows
//     "Again!" beside the field for REST_MS and a new game starts by itself; a press starts it at once.
//   * A cleared wall says "Wall down!" for REST_MS and the next wall goes up by itself.
//   * A GAME NOBODY IS PLAYING COMES TO REST. It starts still (the first press launches), and after
//     IDLE_BALLS balls in a row are lost with no press in between, it stops launching and the sweep
//     stops: an empty room does not get a ball bouncing forever. The next press picks it up again.
//     That is inaction, not a gate - nothing on the panel is waiting behind a press but the game.
//   * No sound before the first press, and music only while somebody is playing.
//
// *** MADE OF NIMROD BRICKS, IN THE THEME'S COLOURS (brick games, 2026-10-09; Mike: "the Brick Breaker game should
// be made of Nimrod bricks and you can have it follow your theme"). *** Every brick in the wall is the printed brick
// seen from the front (../brick_face.js), each row a colour from the theme's palette; the paddle is the theme's accent
// and the ball its strongest text colour. Nothing in it blinks: a brick that goes, goes once (a short fade, none at
// all with reduced motion), so the screen's flash limit has nothing to hold back. `look: plain` is the old wall.
//
// THE SCORE is bricks broken this game, on the score contract (`../score_source.js`); drawn here
// only when no scoreboard shows it. A cleared wall pays NOTHING by default (see `wallPoints`).
//
// *** PAUSE, AND THE COMMANDS (Mike, 2026-10-02, off the live site): "I couldn't find a way to pause
// it. I would suggest maybe space bar by default and having escape pause it and bring up its settings
// menu. It would actually be good for voice control: right, left, stop (stops the paddle), launch,
// pause (pauses and brings up settings), resume. It'd be good for color/hand/etc. tracking also." ***
//   * PAUSED IS OBVIOUS AND STILL: a "Paused" sign on the field, the music and the sounds stop, the
//     loop stops, and nothing (pointer, tracker, step) moves the paddle. A press, "resume", the pause
//     key again or Back goes on. Opening the screen's settings menu pauses it too (`shell/state`).
//   * KEYS, ONCE THE GAME HAS THE KEYBOARD (it takes it when clicked or touched): ESCAPE pauses and opens
//     the screen's settings menu, which is about this panel (`pauseOpensMenu`, on by default). Handled on
//     the game's own root, never the window - two games on one screen must not pause each other.
//   *** SPACE IS THE SCREEN'S PLAY / PAUSE NOW, NOT THIS GAME'S (Mike, 2026-10-02 late: "I think space
//     should be universal for play/pause and primary select will launch"). *** Space is bound for the
//     whole screen to the bar's Pause / Play (input_keyboard.js), which sends this panel `pause` / `play`
//     when it is the selected one - so Space pauses brick breaker whether or not it was clicked, which is
//     what the old game-owned Space could not do. A pause that comes from the bar (`meta.from ===
//     'transport'`) only pauses: it is a transport button, not "pause and show me the settings". The game's
//     own key is now P or nothing (`pauseKey`, off by default); a saved 'space' reads as off.
//   *** IT DOES NOT START ITSELF, AND THE BALL DOES NOT GO BY ITSELF (Mike, same day: "It shouldn't
//     default to auto launch. That could be a setting. People might want it open without necessarily
//     playing."). *** `autostart` off (game_start.js argues it): a Start button over a demo the computer
//     plays (game_agent.js), silent, never scoring; any press starts a real game, and select launches.
//     `autoLaunch` is now 0 by default (a resting ball waits for a press); the old 3 seconds is one choice.
//   * VERBS (actions.js MODULE_VERBS, so each is a switch binding too): left / right a step, stop (the
//     gliding paddle), launch, pause (and the menu, as Escape), play = resume. Spoken while this panel
//     has focus through the manifest's `voice` (input_speech.js `moduleVoiceTable`): "stop" here is the
//     paddle, where everywhere else it means pause.
//   * A TRACKER CAN DRIVE THE PADDLE: `brickbreaker/aim { x: 0..1 }` (0 = the field's left edge, 1 =
//     its right; the instance's own `brickbreaker/aim#<id>` too) puts the paddle there, exactly as a
//     pointer over the field does. And the screen's AIM (aim.js `input/aim`) over the field from
//     anything that is not a mouse or a finger (those already arrive as pointer events) does the same,
//     so a colour or hand tracker that reports an aim needs nothing written for this game. Argued, not
//     a setting: it is the pointer rule, for a pointer the operating system cannot see.

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { createGameMusic } from '../game_music.js';
import { SYSTEM_TOPICS } from '../actions.js';
import { AIM_TOPIC, aimIn } from '../aim.js';
import { SHELL_STATE } from '../shell_verbs.js';
import {
  autostartFields, attractFields, shouldAutostart, panelAlone, createPlayWatch, demoLimitMs, demoReturnMs,
  ATTRACT_DEFAULTS, START_VOICE, START_LINES, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';
import { gameAgentFor, askAgent } from '../game_agent.js';
import { ensureBrickFaceStyle, cellsAlong } from '../brick_face.js';
import {
  FIELD_W, FIELD_H, BALL_R, PADDLE_H, PADDLE_Y, BALL_SPEEDS, PADDLE_WIDTHS, SWEEP_SPEEDS, STEP_SIZES,
  CONTROLS, newGame, launch, step, setPaddleX, nudgePaddle, landingX, togglePause, setPaused, nextWall, aliveCount,
} from '../breakout.js';

export const GAME = 'brickbreaker';
export const SCORE_LABEL = 'Brick breaker: bricks';

// "Wall down!" / "Again!" stay up this long before the next wall starts by itself. Long enough to
// read a short line at kiosk distance; short enough not to feel like a screen you have to get past.
// A press skips it. Argued, not a setting: nobody's play changes with it.
export const REST_MS = 3000;
// A game nobody is playing comes to rest after this many balls lost in a row with no press. Three,
// not one: a single miss is ordinary play, and somebody thinking between presses must not have
// the game stop under them. Argued, not a setting; on Mike's list.
export const IDLE_BALLS = 3;
// The topic a tracker publishes to put the paddle somewhere: `{ x: 0..1 }` across the field.
export const AIM = `${GAME}/aim`;
// The game's own pause key, once it has the keyboard. Space is not one any more (the header says why); a
// saved 'space' is read as 'off', which is what Space does here now anyway (the screen's play / pause).
export const PAUSE_KEYS = Object.freeze({ p: 'p', off: null });
// The demo paddle moves no faster than `follow` mode's own (the ball's speed x 1.5): fast enough to get
// to the ball, so the misses come from the agent's aim, not from a paddle that cannot keep up.
export const DEMO_PADDLE_SPEED = 1.5;
// The spoken commands while this panel has focus (input_speech.js `moduleVoiceTable`). Only "stop" and
// "stop the paddle" differ from the screen-wide table (where bare "stop" is pause); the rest are listed
// so the game's whole vocabulary is in one place. "Start" (game_start.js START_VOICE) is play: it starts
// a game that is waiting, and on a game in play it is resume, which changes nothing.
export const VOICE = Object.freeze({
  left: 'left', right: 'right', stop: 'stop', 'stop the paddle': 'stop', launch: 'launch',
  pause: 'pause', resume: 'play', ...START_VOICE,
});

export const DEFAULTS = Object.freeze({
  // Off: Space is the screen's play / pause (input_keyboard.js), which reaches this game whenever it is
  // the selected panel. P is for somebody who wants a key of the game's own as well.
  pauseKey: 'off',
  // game_start.js argues all four: a game waits for Start, the computer plays meanwhile, silently.
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
  // Escape and the Pause command also open the settings menu (Mike: "pause (pauses and brings up
  // settings)"). Off: they only pause.
  pauseOpensMenu: true,
  control: 'sweep',
  ballSpeed: 'slow',
  paddleWidth: 'wide',
  sweepSpeed: 'slow',
  restart: 'toward',
  stepSize: 'medium',
  // Seconds a resting ball waits before it goes by itself; 0 = only on a press. 0 by default (Mike: "It
  // shouldn't default to auto launch. That could be a setting."). FOR 3 s (the old default): a one-switch
  // player's every press then goes on stopping the paddle, never on launching. AGAINST, and it wins: a ball
  // that goes by itself is the game playing without the person; select launching is one press a ball.
  autoLaunch: 0,
  lives: 0,               // 0 = off
  rows: 4,
  cols: 8,
  // brick games (2026-10-09). 'nimrod': each brick drawn as a Nimrod brick, one keyed socket per 40 mm cell, a theme
  // colour a row. 'plain': the flat bricks it had before. FOR nimrod by default: Mike asked for it ("made of Nimrod
  // bricks"), and on this site the bricks ARE the product. AGAINST: busier bricks, a little harder to read as
  // targets on a small panel. One setting away.
  look: 'nimrod',
  sounds: true,
  music: 'ambient',       // Mike, 2026-08-29: "The games should still have music."
  musicVolume: 0.3,
  // *** A CLEARED WALL PAYS NOTHING BY DEFAULT. *** Both sides:
  //   FOR paying: a cleared wall is a real result, and comet and the press games pay Play points.
  //   AGAINST, and it wins for the default: points.js pays for achievement, not time. With lives off
  //   and the ball coming back forever, every wall falls eventually to anybody who keeps the panel
  //   open - and in `follow` mode nobody even has to catch. That is paying for time.
  //   So a setting pays a set number of Play points per wall; a family that wants it turns it on.
  wallPoints: 0,
});

const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Bricks broken this game. A Scoreboard on the same screen can show it instead.' }),
  { key: 'control', label: 'How the paddle moves', kind: 'choice', default: 'sweep', level: 'essential',
    options: [
      { value: 'sweep', label: 'It glides by itself; a press stops it and starts it (one switch)' },
      { value: 'steps', label: 'Next and previous move it a step; select launches' },
      { value: 'follow', label: 'It catches every ball; a press changes the angle' },
    ],
    note: 'A pointer can always move the paddle, and a click is a press.' },
  ...autostartFields({ on: false }),
  ...attractFields({ on: true, sound: true }),
  { key: 'pauseKey', label: 'A key of its own that pauses', kind: 'choice', default: 'off', level: 'advanced',
    options: [{ value: 'off', label: 'None: Space (the screen\'s pause / play) does it' }, { value: 'p', label: 'P' }],
    note: 'Once the game has been clicked or touched. Escape always pauses.' },
  { key: 'pauseOpensMenu', label: 'Escape and the Pause command also open the settings', default: true,
    level: 'standard', onLabel: 'Yes', offLabel: 'No, they only pause' },
  { key: 'ballSpeed', label: 'Ball speed', kind: 'choice', default: 'slow', level: 'essential',
    options: [
      { value: 'very-slow', label: 'Very slow' }, { value: 'slow', label: 'Slow' },
      { value: 'medium', label: 'Medium' }, { value: 'fast', label: 'Fast' },
    ] },
  { key: 'paddleWidth', label: 'Paddle', kind: 'choice', default: 'wide', level: 'standard',
    options: [{ value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }, { value: 'very-wide', label: 'Very wide' }] },
  { key: 'sweepSpeed', label: 'How fast the paddle glides', kind: 'choice', default: 'slow', level: 'standard',
    options: [{ value: 'slow', label: 'Slow' }, { value: 'medium', label: 'Medium' }, { value: 'fast', label: 'Fast' }],
    note: 'Only when it glides by itself.' },
  { key: 'restart', label: 'When the paddle starts again', kind: 'choice', default: 'toward', level: 'standard',
    options: [{ value: 'toward', label: 'It heads toward the ball' }, { value: 'onward', label: 'It carries on the way it was going' }],
    note: 'Only when it glides by itself.' },
  { key: 'stepSize', label: 'How far one press moves the paddle', kind: 'choice', default: 'medium', level: 'standard',
    options: [{ value: 'small', label: 'A little' }, { value: 'medium', label: 'Some' }, { value: 'large', label: 'A lot' }] },
  { key: 'autoLaunch', label: 'A ball on the paddle goes by itself after', kind: 'choice', default: 0, level: 'standard',
    options: [{ value: 0, label: 'Never: only on a press' }, { value: 2, label: '2 seconds' }, { value: 3, label: '3 seconds' },
      { value: 5, label: '5 seconds' }, { value: 8, label: '8 seconds' }] },
  { key: 'lives', label: 'Balls per game', kind: 'choice', default: 0, level: 'standard',
    options: [{ value: 0, label: 'As many as you like' }, { value: 3, label: '3, then it starts again' }, { value: 5, label: '5, then it starts again' }] },
  { key: 'rows', label: 'Rows of bricks', kind: 'choice', default: 4, level: 'advanced',
    options: [2, 3, 4, 5, 6].map((v) => ({ value: v, label: String(v) })), note: 'Starts with the next wall.' },
  { key: 'cols', label: 'Bricks across', kind: 'choice', default: 8, level: 'advanced',
    options: [5, 6, 8, 10].map((v) => ({ value: v, label: String(v) })), note: 'Starts with the next wall.' },
  { key: 'look', label: 'The bricks', kind: 'choice', default: 'nimrod', level: 'standard',
    options: [{ value: 'nimrod', label: 'Nimrod bricks, in the theme\'s colours' }, { value: 'plain', label: 'Plain bricks' }] },
  { key: 'sounds', label: 'Bounce sounds', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'music', label: 'Music', kind: 'choice', default: 'ambient', level: 'standard',
    options: [{ value: 'ambient', label: 'Quiet background music' }, { value: 'off', label: 'No music' }] },
  { key: 'musicVolume', label: 'How loud the music is', kind: 'choice', default: 0.3, level: 'advanced',
    options: [{ value: 0.15, label: 'Very quiet' }, { value: 0.3, label: 'Quiet' }, { value: 0.5, label: 'Medium' }] },
  { key: 'wallPoints', label: 'Play points for a wall knocked down', kind: 'number', default: 0, min: 0, max: 20, step: 1,
    level: 'advanced', note: '0 means walls pay nothing. With the ball coming back forever, any wall falls in the end.' },
];

// Sounds: a pitch per event, low enough to sit under a voice. Argued constants, not settings - the
// setting is whether there are sounds at all.
const TONES = { paddle: [330, 70, 'triangle'], wall: [262, 40, 'sine'], brick: [523, 60, 'square'],
  miss: [165, 220, 'sine'], cleared: [659, 260, 'triangle'] };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v, of) => `${((v / of) * 100).toFixed(3)}%`;
const pick = (v, table, dflt) => (Object.prototype.hasOwnProperty.call(table, v) ? table[v] : table[dflt]);

/** The one line under the field, for a phase. Exported so the suite reads it without a DOM. */
export function statusFor(g, { control = 'sweep', idle = false, autoLaunch = 3 } = {}) {
  switch (g.phase) {
    case 'paused': return 'Paused. Press to go on.';
    case 'cleared': return 'Wall down! A new wall is going up.';
    case 'again': return 'Again! A new game is starting.';
    case 'ready':
      if (idle) return 'Press to play.';
      return autoLaunch > 0 ? 'Press to launch, or it goes by itself.' : 'Press to launch.';
    default:
      if (control === 'sweep') return g.paddle.moving ? 'Press to stop the paddle.' : 'Press to move the paddle.';
      if (control === 'follow') return 'Press to change the angle.';
      return 'Move the paddle with next and previous.';
  }
}

registerModule(
  { type: GAME, title: 'Brick breaker', core: 'new',
    description: 'Knock down a wall of bricks with a ball and a paddle. One switch can play: the paddle '
      + 'glides by itself and a press stops it. Slow by default, and a missed ball just comes back.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const audio = ctx.audio || null;
    const rand = ctx.rand || Math.random;
    // THE CLOCK IS INJECTABLE. A hidden document never runs requestAnimationFrame, so a suite hands
    // in `{ now, request, cancel }` and steps it; the real page uses animation frames.
    const clock = ctx.clock || (() => {
      const raf = typeof requestAnimationFrame === 'function';
      return {
        now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
        request: (cb) => (raf ? requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16)),
        cancel: (h) => { if (raf) cancelAnimationFrame(h); else clearTimeout(h); },
      };
    })();
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };

    let cfg = { ...DEFAULTS };
    let g = null;
    let idle = true;              // nobody has pressed since the game came to rest
    let missesSinceInput = 0;
    let armed = false;            // a press has happened on this mount: sound may start
    let stats = { best: 0, walls: 0 };
    let loopHandle = null;
    let last = null;
    let dead = false;
    let hidden = false;
    let rootEl = null, fieldEl = null, ballEl = null, paddleEl = null, sayEl = null, scoreEl = null, aimEl = null, pausedEl = null;
    let menuAsks = 0;             // times this panel asked for the settings menu (the suite reads it)
    let brickEls = new Map();
    let drawnBricks = null;
    let lastSay = '', lastScore = '';
    let score = null, ledger = null, tones = null, music = null;
    // ---- waiting for Start, and the demo (game_start.js, game_agent.js) ----
    let started = true;           // false: the Start button is up and `g` is the demo's game
    let demo = false;             // the computer is playing (only while not started)
    let demoMs = 0;               // how long this demo has run
    let demoRested = false;       // it ran its time (`attractForMs`): the last frame stays
    let demoMemory = {};          // the agent's own notes, thrown away with the demo
    let readyMs = 0;              // how long the demo's ball has sat on its paddle
    let agent = null;
    let restTimer = null;         // a real game come to rest: when the demo comes back
    let overlayEl = null, lastOverlay = null;
    // BEING PLAYED (brick games, 2026-10-09: game_start.js createPlayWatch, which replaced createPlayReporter here):
    // from Start and every press (or aim) until nobody has pressed for GAME_IDLE_MS, or the game comes to rest, so a
    // wall somebody started and walked away from no longer holds the screen's reload for ever. Pause says paused.
    const plays = createPlayWatch(bus, ctx);
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);

    const opts = () => ({
      speed: pick(cfg.ballSpeed, BALL_SPEEDS, 'slow'),
      sweep: pick(cfg.sweepSpeed, SWEEP_SPEEDS, 'slow'),
      control: CONTROLS.includes(cfg.control) ? cfg.control : 'sweep',
      autoLaunchMs: Math.max(0, Number(cfg.autoLaunch) || 0) * 1000,
      restMs: REST_MS,
      idle,
      rand,
    });

    // ---- sound ------------------------------------------------------------------------------
    function sound(ev) {
      if (!cfg.sounds || !armed || !tones) return;
      if (!started && cfg.attractSound !== true) return;     // the demo is silent unless asked
      const t = TONES[ev];
      if (t) tones.tone(t[0], t[1], { type: t[2], level: 0.7 });
    }
    function syncAudio() {
      if (!started) {
        // The demo: never the music; its bounces only with `attractSound` (and only after a press has woken
        // the speaker - a browser will not play before one, and that is fine for a silent default).
        tones?.setActive(!dead && !hidden && armed && demo && !demoRested && cfg.attractSound === true && !!cfg.sounds);
        try { music?.pause(); } catch { /* quiet */ }
        return;
      }
      const playing = !dead && !hidden && armed && g && g.phase !== 'paused' && !idle;
      tones?.setActive(playing && g.phase === 'play' && !!cfg.sounds);
      try {
        if (playing && cfg.music !== 'off') music?.play();
        else music?.pause();
      } catch { /* a bed is not worth an exception */ }
    }

    // ---- saving: the totals only. A ball's position means nothing after a reload. ------------
    function save() { try { state?.set?.({ stats }); } catch (err) { console.error('brickbreaker: save', err); } }

    // ---- the loop: runs only while something is moving ---------------------------------------
    function needsFrames() {
      if (dead || hidden || !g) return false;
      if (!started) return demo && !demoRested;
      if (g.phase === 'paused') return false;
      if (g.phase === 'play' || g.phase === 'cleared' || g.phase === 'again') return true;
      // ready: a sweeping paddle, or a ball about to go by itself
      if (cfg.control === 'sweep' && g.paddle.moving) return true;
      return !idle && Number(cfg.autoLaunch) > 0;
    }
    function ensureLoop() {
      if (loopHandle != null || !needsFrames()) return;
      last = null;
      loopHandle = clock.request(frame);
    }
    function stopLoop() {
      if (loopHandle != null) { try { clock.cancel(loopHandle); } catch { /* gone */ } }
      loopHandle = null; last = null;
    }
    function frame() {
      loopHandle = null;
      if (dead) return;
      const t = clock.now();
      const dt = last == null ? 0 : t - last;
      last = t;
      advance(dt);
      if (needsFrames()) { loopHandle = clock.request(frame); } else last = null;
    }

    // ---- the demo: the computer (or whoever registered) plays a game of its own -------------------
    // `g` IS the demo's game while not started; Start throws it away and deals a fresh one. Nothing here
    // touches the score, the points, the stats or the saved state.
    function demoObservation() {
      return { game: GAME, kind: 'paddle', t: demoMs, actions: ['aim', 'launch'],
        state: { phase: g.phase, ball: { x: g.ball.x, y: g.ball.y, vx: g.ball.vx, vy: g.ball.vy },
          paddle: { x: g.paddle.x, w: g.paddle.w }, landingX: landingX(g), fieldW: FIELD_W, fieldH: FIELD_H, readyMs } };
    }
    function applyDemo(a, dt) {
      if (!a || started || dead || !g) return;
      const o = opts();
      if (a.act === 'launch' && g.phase === 'ready') { launch(g, { speed: o.speed, rand, control: 'steps' }); readyMs = 0; return; }
      if (a.act === 'aim' && g.phase !== 'paused') {
        const want = Math.max(0, Math.min(1, Number(a.x) || 0)) * FIELD_W;
        const max = o.speed * DEMO_PADDLE_SPEED * Math.max(0, dt) / 1000;
        setPaddleX(g, g.paddle.x + Math.max(-max, Math.min(max, want - g.paddle.x)));
      }
    }
    function advanceDemo(dt) {
      if (!demo || demoRested) return [];
      demoMs += dt;
      if (demoMs >= demoLimitMs(cfg.attractForMs)) { demoRested = true; syncAudio(); render(); return []; }
      if (g.phase === 'ready') readyMs += dt; else readyMs = 0;
      const a = askAgent(agent, demoObservation(), { rand, memory: demoMemory }, { onLate: (x) => applyDemo(x, 33) });
      applyDemo(a, dt);
      const events = step(g, dt, { ...opts(), control: 'steps', autoLaunchMs: 0, idle: true });
      for (const ev of events) sound(ev);
      render();
      return events;
    }

    function advance(dt) {
      if (!started) return advanceDemo(dt);
      const before = g.phase;
      const events = step(g, dt, opts());
      for (const ev of events) {
        sound(ev);
        if (ev === 'miss') {
          missesSinceInput++;
          if (missesSinceInput >= IDLE_BALLS) { idle = true; g.paddle.moving = false; plays.rest(); scheduleDemo(); }
        }
        if (ev === 'cleared') {
          stats = { ...stats, walls: (Number(stats.walls) || 0) + 1 };
          pay();
        }
        if (ev === 'brick' && g.broken > (Number(stats.best) || 0)) stats = { ...stats, best: g.broken };
      }
      if (events.includes('cleared') || events.includes('again')) save();
      if (before !== g.phase || events.length) syncAudio();
      render();
      return events;
    }

    function pay() {
      const n = Math.round(Number(cfg.wallPoints) || 0);
      if (!(n > 0) || !ledger) return;
      Promise.resolve(ledger.award({ amount: n, source: GAME, type: 'Play', tags: [GAME],
        note: 'Brick breaker: a wall knocked down' })).catch((err) => console.error('brickbreaker: points', err));
    }

    // ---- presses ------------------------------------------------------------------------------
    function markInput() {
      idle = false; missesSinceInput = 0;
      clearRest();
      if (!armed) { armed = true; tones?.resume(); }
      plays.active();
    }

    // ---- Start, and back to the Start screen ----------------------------------------------------------
    function clearRest() { if (restTimer != null) { try { clearT(restTimer); } catch { /* gone */ } restTimer = null; } }
    // A real game come to rest (nobody pressing): the demo comes back after `attractAfterMs` (0 = never).
    function scheduleDemo() {
      const ms = demoReturnMs(cfg.attractAfterMs);
      if (!(ms > 0) || restTimer != null || dead) return;
      restTimer = setT(() => { restTimer = null; if (!dead && started && idle && g?.phase !== 'paused') toStartScreen(); }, ms);
    }
    const demoWanted = () => cfg.attract !== false && !reducedMotion();
    function toStartScreen() {
      if (dead) return;
      clearRest();
      stopLoop();
      started = false;
      g = newGame({ rows: cfg.rows, cols: cfg.cols, paddle: cfg.paddleWidth, lives: 0 });
      idle = true; missesSinceInput = 0;
      demo = demoWanted();
      demoMs = 0; demoRested = false; demoMemory = {}; readyMs = 0;
      agent = demo ? gameAgentFor(GAME, 'paddle') : null;
      plays.pause();            // a game waiting for Start says it is not playing (game_start.js)
      syncAudio(); render(); ensureLoop();
    }
    // ANY PRESS STARTS A REAL GAME: a fresh wall, the ball on the paddle, waiting for select to launch it.
    function startGame() {
      if (dead || started) return false;
      stopLoop();
      started = true; demo = false; agent = null; demoMemory = {};
      fresh();
      markInput();              // ...which tells the shell it is being played
      syncAudio(); render(); ensureLoop();
      return true;
    }
    function select() {
      if (dead) return;
      if (startGame()) return;
      markInput();
      const o = opts();
      if (g.phase === 'paused') togglePause(g);
      else if (g.phase === 'ready') {
        launch(g, { speed: o.speed, rand, control: o.control });
        if (o.control === 'sweep') g.paddle.moving = true;
      } else if (g.phase === 'cleared' || g.phase === 'again') nextWall(g);
      else if (g.phase === 'play') {
        if (o.control === 'sweep') {
          const p = g.paddle;
          if (p.moving) p.moving = false;
          else {
            if (cfg.restart !== 'onward') {
              const target = landingX(g) ?? g.ball.x;
              if (Math.abs(target - p.x) > 0.5) p.dir = target > p.x ? 1 : -1;
            }
            p.moving = true;
          }
        } else if (o.control === 'follow') {
          g.aim = g.aim === 0 ? 1 : (g.aim === 1 ? -1 : 0);
        }
      }
      syncAudio(); render(); ensureLoop();
    }
    function nudge(dir) {
      if (dead) return;
      if (startGame()) return;
      markInput();
      if (g.phase === 'paused') return;
      if (cfg.control === 'follow') g.aim = dir;
      else {
        g.paddle.moving = false;
        nudgePaddle(g, dir * pick(cfg.stepSize, STEP_SIZES, 'medium'));
      }
      syncAudio(); render(); ensureLoop();
    }
    function back() {
      if (dead || !started) return;      // nothing to pause while it waits for Start
      markInput();
      togglePause(g);
      if (g.phase === 'paused') plays.pause();
      syncAudio(); render();
      if (g.phase === 'paused') stopLoop(); else ensureLoop();
    }

    // ---- pause / resume / the commands (2026-10-02) ------------------------------------------
    // Ask the screen for its settings menu. The kiosk answers `system/settings` by opening the one menu,
    // which is about the focused panel; a host with no menu (a preview page) simply does not claim it,
    // and the game is just paused - nothing here waits on an answer.
    function openMenu() {
      menuAsks++;
      let claimed = false;
      try { bus.publish(SYSTEM_TOPICS.settings, { from: GAME, claim() { claimed = true; } }); }
      catch (err) { console.error('brickbreaker: settings menu', err); }
      return claimed;
    }
    // IDEMPOTENT: pausing a paused game leaves it paused (a command heard twice, a menu opening twice).
    function pauseGame({ menu = false } = {}) {
      if (dead || !g || !started) return;   // a game waiting for Start is not going: nothing to pause
      if (setPaused(g, true)) stopLoop();
      plays.pause();
      syncAudio(); render();
      if (menu && cfg.pauseOpensMenu !== false) openMenu();
    }
    // "Resume" / "play" / the bar's Play / Space: goes on - or, waiting for Start, starts.
    function resumeGame() {
      if (dead || !g) return;
      if (startGame()) return;
      markInput();
      setPaused(g, false);
      syncAudio(); render(); ensureLoop();
    }
    // "Stop": the gliding paddle stops where it is. Nothing else changes - the ball keeps going.
    function stopPaddle() {
      if (dead || !g) return;
      if (startGame()) return;
      markInput();
      if (g.phase === 'paused') return;
      g.paddle.moving = false;
      syncAudio(); render(); ensureLoop();
    }
    // "Launch": a resting ball goes (and, gliding, the paddle starts - the same as a launching press).
    function launchBall() {
      if (dead || !g) return;
      if (startGame()) return;
      markInput();
      if (g.phase !== 'ready') return;
      const o = opts();
      launch(g, { speed: o.speed, rand, control: o.control });
      if (o.control === 'sweep') g.paddle.moving = true;
      syncAudio(); render(); ensureLoop();
    }
    // A tracker (or anything) putting the paddle at `x` (0..1 across the field). The pointer rule.
    function aimAt(p) {
      const x = Number(typeof p === 'number' ? p : p?.x);
      // Not while it waits for Start: an aim is a position, not a press, and the demo's paddle is the demo's.
      if (!Number.isFinite(x) || dead || !g || !started || cfg.control === 'follow' || g.phase === 'paused') return;
      missesSinceInput = 0;
      plays.active();
      g.paddle.moving = false;
      setPaddleX(g, Math.max(0, Math.min(1, x)) * FIELD_W);
      render();
    }
    function onAim(a) {
      if (!a || !fieldEl || a.device === 'pointer:mouse' || a.device === 'pointer:touch') return;
      const at = aimIn(a, fieldEl);
      if (!at) return;
      const r = fieldEl.getBoundingClientRect();
      if (r.width > 0) aimAt({ x: at.x / r.width });
    }
    // Keys, on the game's own root (see the header): the pause key, and Escape.
    function onKey(e) {
      if (dead || !g || e.repeat || !started) return;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        pauseGame({ menu: true });
        return;
      }
      const want = Object.prototype.hasOwnProperty.call(PAUSE_KEYS, cfg.pauseKey) ? PAUSE_KEYS[cfg.pauseKey] : null;
      if (want && String(e.key).toLowerCase() === want) {
        e.preventDefault(); e.stopPropagation();
        if (g.phase === 'paused') resumeGame(); else pauseGame();
      }
    }

    // ---- pointer ----------------------------------------------------------------------------------
    function fieldX(e) {
      if (!fieldEl) return null;
      const r = fieldEl.getBoundingClientRect();
      if (!(r.width > 0)) return null;
      return ((e.clientX - r.left) / r.width) * FIELD_W;
    }
    function onPointerMove(e) {
      if (dead || !started || cfg.control === 'follow' || !g || g.phase === 'paused') return;
      const x = fieldX(e);
      if (x == null) return;
      missesSinceInput = 0;
      plays.active();
      g.paddle.moving = false;
      setPaddleX(g, x);
      render();
    }
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      // The game takes the keyboard when it is clicked or touched, so the pause key and Escape reach it.
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
      if (startGame()) return;           // waiting for Start: a click anywhere on it is Start
      if (cfg.control !== 'follow') { const x = fieldX(e); if (x != null && g.phase !== 'paused') setPaddleX(g, x); }
      select();
      // select() starts a sweep on launch; a pointer is holding the paddle, so it stays put.
      if (cfg.control === 'sweep') g.paddle.moving = false;
    }

    // ---- drawing ---------------------------------------------------------------------------------
    function buildField() {
      if (!fieldEl) return;
      // brick games (2026-10-09): each brick is a Nimrod brick (brick_face.js), one socket per 40 mm cell - a whole
      // brick of the running bond comes out three cells long, a half brick at a row's end two.
      const bricks = g.bricks.map((b) => `<div class="bb-brick nb-face" data-id="${esc(b.id)}" data-row="${b.row % 4}"`
        + ` data-cells="${cellsAlong(b.w, b.h)}" style="left:${pct(b.x, FIELD_W)};top:${pct(b.y, FIELD_H)};width:${pct(b.w, FIELD_W)};`
        + `height:${pct(b.h, FIELD_H)};--nb-cells:${cellsAlong(b.w, b.h)}"></div>`).join('');
      fieldEl.innerHTML = `${bricks}<div class="bb-paddle" data-paddle><span class="bb-aim" data-aim aria-hidden="true"></span></div>`
        + '<div class="bb-ball" data-ball></div>'
        // PAUSED, ON THE FIELD: a sign in the middle, the field dimmed. A sign and not a dialog - nothing
        // here waits behind it but the game, and a press anywhere goes on.
        + '<div class="bb-paused" data-paused hidden><span class="bb-paused-mark" aria-hidden="true">❚❚</span>'
        + '<span class="bb-paused-word">Paused</span></div>';
      brickEls = new Map([...fieldEl.querySelectorAll('.bb-brick')].map((el) => [el.dataset.id, el]));
      ballEl = fieldEl.querySelector('[data-ball]');
      paddleEl = fieldEl.querySelector('[data-paddle]');
      aimEl = fieldEl.querySelector('[data-aim]');
      pausedEl = fieldEl.querySelector('[data-paused]');
      drawnBricks = g.bricks;
    }
    function render() {
      if (dead || !rootEl || !g) return;
      if (drawnBricks !== g.bricks) buildField();
      const bb = rootEl.querySelector('[data-bb]');
      if (bb) {
        bb.dataset.phase = g.phase;
        bb.dataset.control = cfg.control;
        bb.dataset.motion = reducedMotion() ? 'reduce' : 'full';
        bb.dataset.started = started ? '1' : '0';
        bb.dataset.demo = !started && demo && !demoRested ? '1' : '0';
        bb.dataset.look = cfg.look === 'plain' ? 'plain' : 'nimrod';
      }
      // THE START BUTTON, over the field, while it waits. The words are under the field, as always.
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ demo: demo && !demoRested, note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      for (const b of g.bricks) {
        const el = brickEls.get(b.id);
        if (el && el.hidden === b.alive) el.hidden = !b.alive;
      }
      const p = g.paddle;
      if (paddleEl) {
        paddleEl.style.left = pct(p.x - p.w / 2, FIELD_W);
        paddleEl.style.top = pct(PADDLE_Y, FIELD_H);
        paddleEl.style.width = pct(p.w, FIELD_W);
        paddleEl.style.height = pct(PADDLE_H, FIELD_H);
        paddleEl.dataset.moving = p.moving ? '1' : '0';
      }
      if (aimEl) {
        // The aim is an arrow AND a word, not a colour: '↖ left', '↑ straight', '↗ right'.
        const show = cfg.control === 'follow';
        aimEl.hidden = !show;
        if (show) aimEl.textContent = g.aim < 0 ? '↖ left' : (g.aim > 0 ? '↗ right' : '↑ straight');
      }
      if (ballEl) {
        ballEl.style.left = pct(g.ball.x - BALL_R, FIELD_W);
        ballEl.style.top = pct(g.ball.y - BALL_R, FIELD_H);
        ballEl.style.width = pct(BALL_R * 2, FIELD_W);
        ballEl.style.height = pct(BALL_R * 2, FIELD_H);
        ballEl.hidden = g.phase === 'cleared' || g.phase === 'again';
      }
      if (pausedEl && pausedEl.hidden === (g.phase === 'paused')) pausedEl.hidden = g.phase !== 'paused';
      const line = !started ? (demo && !demoRested ? START_LINES.demo : START_LINES.still)
        : statusFor(g, { control: cfg.control, idle, autoLaunch: Number(cfg.autoLaunch) || 0 });
      if (sayEl && line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      // THE DEMO NEVER SCORES: nothing drawn, nothing published.
      if (!started) {
        if (scoreEl && lastScore !== '') { scoreEl.textContent = ''; scoreEl.hidden = true; lastScore = ''; }
        return;
      }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const lives = g.livesLeft != null ? ` · Balls left: ${g.livesLeft}` : '';
      const txt = own ? `Bricks: ${g.broken}${g.walls ? ` · Walls down: ${g.walls}` : ''}${lives}` : '';
      if (scoreEl && txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      try {
        score?.set(g.broken, { detail: `Walls down: ${g.walls} · Best: ${Math.max(Number(stats.best) || 0, g.broken)}` });
      } catch (err) { console.error('brickbreaker: score', err); }
    }

    function fresh() {
      g = newGame({ rows: cfg.rows, cols: cfg.cols, paddle: cfg.paddleWidth, lives: cfg.lives });
      idle = true; missesSinceInput = 0;
    }

    return {
      __probe: () => ({ game: g, cfg: { ...cfg }, idle, armed, missesSinceInput, looping: loopHandle != null,
        stats: { ...stats }, tones: tones?.state() || null, music: music?.state() || null, menuAsks,
        started, demo, demoRested, demoMs, agent: agent?.id || null, restPending: restTimer != null }),
      // The suite's handle on time: advance the game by `dt` ms exactly as a frame would.
      __step: (dt) => (dead ? [] : advance(dt)),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../brickbreaker.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        ensureStartStyle(mount.ownerDocument || (typeof document !== 'undefined' ? document : null));
        ensureBrickFaceStyle(mount.ownerDocument || (typeof document !== 'undefined' ? document : null));
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-bb-css href="${esc(cssHref)}">` : ''}`
          + '<div class="bb-wrap gs-host nb-bricks" data-bb-root tabindex="0" aria-label="Brick breaker"><div class="bb" data-bb>'
          + '<div class="bb-stage"><div class="bb-field" data-field role="img" aria-label="A wall of bricks, a ball and a paddle"></div></div>'
          + '<div class="bb-bar"><p class="bb-say" role="status" aria-live="polite"></p><p class="bb-score" data-score hidden></p></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-bb-root]');
        overlayEl = mount.querySelector('[data-start-host]');
        fieldEl = mount.querySelector('[data-field]');
        sayEl = mount.querySelector('.bb-say');
        scoreEl = mount.querySelector('[data-score]');
        mount.addEventListener('pointermove', onPointerMove);
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('brickbreaker: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null,
          onShownChange: () => render() });
        const id = ctx.instanceId || 'bb';
        tones = createGameTones({ audio, audioId: `${GAME}:${id}`, volume: 0.5,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });
        music = createGameMusic({ audio, audioId: `${GAME}-music:${id}`, volume: cfg.musicVolume,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });

        const applyCfg = (snap) => {
          const s = snap || {};
          const was = cfg;
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          if (!CONTROLS.includes(next.control)) next.control = DEFAULTS.control;
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          if (g && next.paddleWidth !== was.paddleWidth) { g.paddle.w = pick(next.paddleWidth, PADDLE_WIDTHS, 'wide'); setPaddleX(g, g.paddle.x); }
          if (g) { g.rows = next.rows; g.cols = next.cols; }
          if (g && next.lives !== was.lives) {
            const n = Number(next.lives) > 0 ? Math.round(Number(next.lives)) : null;
            g.startLives = n; g.livesLeft = n;
          }
          try { music?.setVolume(next.musicVolume); if (next.music === 'off') music?.off(); else if (was.music === 'off' || !g) music?.useAmbient(); } catch { /* quiet */ }
        };
        applyCfg(state?.get?.());
        fresh();
        // A setting changed while it waits for Start: the demo follows "While nobody is playing" at once.
        state?.subscribe?.((s) => {
          applyCfg(s);
          if (!started && demoWanted() !== demo) { toStartScreen(); return; }
          syncAudio(); render(); ensureLoop();
        });

        bus.subscribe(`${GAME}/next`, () => nudge(1));
        bus.subscribe(`${GAME}/prev`, () => nudge(-1));
        bus.subscribe(`${GAME}/select`, () => select());
        bus.subscribe(`${GAME}/back`, () => back());
        // 2026-10-02: the commands (actions.js MODULE_VERBS; spoken through the manifest's `voice`).
        bus.subscribe(`${GAME}/left`, () => nudge(-1));
        bus.subscribe(`${GAME}/right`, () => nudge(1));
        bus.subscribe(`${GAME}/stop`, () => stopPaddle());
        bus.subscribe(`${GAME}/launch`, () => launchBall());
        // A pause from the bar's Pause / Play (or Space, which is that button) only pauses; a spoken or
        // switched "pause" also asks for the settings (Mike: "pause (pauses and brings up settings)").
        bus.subscribe(`${GAME}/pause`, (_p, _t, meta) => pauseGame({ menu: !(meta && meta.from === 'transport') }));
        bus.subscribe(`${GAME}/resume`, () => resumeGame());
        bus.subscribe(AIM, (p) => aimAt(p));
        bus.subscribe(AIM_TOPIC, (a) => { try { onAim(a); } catch { /* an aim must never break the game */ } });
        // The screen's settings menu opening (from anywhere) pauses a game in play: a ball nobody can see
        // behind the menu is a ball lost. Closing it does NOT resume - the person may not be looking at the
        // field yet; a press, "resume" or the pause key goes on.
        bus.subscribe(SHELL_STATE, (p) => { if (p && p.menuOpen === true && started && g && g.phase !== 'paused') pauseGame(); });
        // A fresh game (the suite, or anything that wants to hand somebody a new wall).
        bus.subscribe(`${GAME}/new`, () => { if (!started) { toStartScreen(); return; } fresh(); stopLoop(); syncAudio(); render(); });
        // Back to the Start screen (and the demo), as if it had come to rest.
        bus.subscribe(`${GAME}/attract`, () => toStartScreen());

        // OPENS WAITING FOR START, unless this panel starts by itself (game_start.js).
        if (shouldAutostart(state?.get?.() || {}, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) {
          started = true; plays.active(); render();
        } else toStartScreen();
      },
      onResize() { render(); },
      onHide() {
        hidden = true;
        if (started && g && g.phase === 'play') { togglePause(g); plays.pause(); }   // somebody coming back finds it paused, not lost
        stopLoop(); syncAudio(); render();
        try { state?.flush?.(); } catch { /* nothing to do */ }
      },
      onShow() { hidden = false; syncAudio(); render(); ensureLoop(); },
      destroy() {
        dead = true;
        clearRest();
        stopLoop();
        mount.removeEventListener('pointermove', onPointerMove);
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('keydown', onKey);
        try { plays.destroy(); } catch { /* gone */ }
        try { tones?.destroy(); } catch { /* gone */ }
        tones = null;
        try { music?.destroy(); } catch { /* gone */ }
        music = null;
        try { score?.destroy(); } catch { /* gone */ }
        score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  },
);

export { FIELD_W, FIELD_H, aliveCount };
