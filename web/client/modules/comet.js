// modules/comet.js — a comet that follows the cursor through a night sky, ported from Cici.
//
// WHAT IT IS FOR, and it is not "a game". The head sits EXACTLY on the cursor — 1:1, never
// drifting on its own — with a luminous trail behind it. That precision is the entire point:
// it makes her own movement unmistakably the thing that moved it. This is the module that
// answers *"did I do that?"* — a question worth answering for somebody re-learning that she
// can.
//
// *** WHAT IT FOLLOWS IS THE AIM, AND THAT IS THE ONLY REASON IT CAN EVER WORK FOR HER. ***
//
// This module is why `aim.js` exists. It read `pointermove` off its own canvas, which means it
// followed a mouse and nothing else — and the person it was written for cannot hold a mouse.
// A hand in front of a camera produces no DOM pointer events at all, so on the screen this was
// built for, the comet simply never moved.
//
// It now subscribes to `input/aim`: one normalized (x, y) from whatever is driving the screen,
// and this module cannot tell a mouse from a hand from a colored marker on a foot. That is the
// point of the seam, and it is what makes "did I do that?" answerable by the person asking it.
//
// Still true, and still worth knowing: a TRACKER that produces those aims is not in this
// codebase yet (see the README's Planned list). What is here is the path it will plug into,
// and a mouse proving that path works today.
//
// Heart balloons rise through the stars. Touch one with the comet and it blooms and chimes.
//
// WHAT CHANGED IN THE PORT, and why each thing had to:
//
//   * Cici's version was an IIFE on a global that injected a <style> into document.head.
//     Here it is a module owning nothing outside `ctx.mount`, so two can coexist.
//   * *** IT ANSWERS VERBS, WHICH IT DID NOT BEFORE. *** The original was cursor-only, so
//     somebody driving with a switch could watch it and never touch a heart. `next` STEERS
//     THE COMET TO THE NEAREST HEART and `select` blooms where it is. Same lesson the pond
//     port learned: a module whose value needs a pointer is a module she may never reach.
//   * THE MUSIC LOADER IS GONE. Cici's comet streamed meditation tracks off the drive through
//     the speaker arbiter. There is no drive, no `meditation.json` and no audio bus here, and
//     a module that fetches a missing manifest on every mount is a module that logs errors
//     forever. The SYNTHESISED tones stay — they are Web Audio, they need no files.
//   * COLORS COME FROM THE THEME where the sky allows it. The night sky itself stays dark by
//     construction (a comet needs somewhere dark to be bright), but the warm palette reads
//     `--beige`, `--rosy`, `--moss` so it follows Dusk with everything else.
//   * IT STOPS WHEN IT IS NOT VISIBLE. A canvas animating behind a hidden panel is battery and
//     heat on a Pi that is on 24/7, for a picture nobody is looking at.

import { registerModule } from '../module.js';
import { AIM_TOPIC, aimIn } from '../aim.js';

const DEFAULTS = {
  hearts: 4,        // how many balloons are up at once
  sound: true,      // synthesised chimes and movement tones
  calm: false,      // motion budget — fewer sparks, no idle pulse, slower drift
  pointer: true,    // does a pointer move the comet
  steerMs: 900,     // how long a `next` glide to a heart takes
  // *** SHOW A SCORE — A SETTING, AND OFF BY DEFAULT (Mike, 2026-09-02). ***
  //
  // The count of hearts caught is kept whether or not it is shown; only the readout is
  // optional. Mike: it plainly is a game, and "we'll want to turn it into something people
  // want to play" — so a score is wanted and this module should have one.
  //
  // WHY OFF BY DEFAULT ANYWAY, and it is not a hedge. This same module is the one that
  // answers "did I do that?" for somebody re-learning that she can move something, and on
  // that screen a running total turns a yes into a number that can go down. Off by default
  // changes nothing on her screen and takes nothing from anybody else — it is one switch.
  // If it should be on for everyone, this one word is the whole change.
  showScore: false,
  // Open to a start screen rather than mid-flight. See pressgame.js for the same setting and
  // the same argument; a bedside panel that is meant to be already running turns it off.
  openToMenu: true,
};

const MAX_SPARKS = 320;
const TRAIL_MS = 700;

// The warm palette. Read from the theme so Dusk reaches it, with Cici's originals as the
// fallbacks — those are the values the module was tuned against.
function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return [
    v('--beige', '#fff3d9'),
    v('--gold', '#ffd36e'),
    v('--rosy', '#d3968c'),
    v('--moss', '#9ec7b0'),
    v('--sage', '#cfe0d9'),
  ];
}

const SETTINGS = [
  { key: 'showScore', label: 'Score', default: false, level: 'essential',
    onLabel: 'Show hearts caught', offLabel: 'No score on screen' },
  { key: 'openToMenu', label: 'When the panel opens', default: true, level: 'essential',
    onLabel: 'Show a start screen first', offLabel: 'Start straight away' },
  { key: 'hearts', label: 'Hearts floating up', kind: 'choice', default: 4, level: 'essential',
    options: [
      { value: 0, label: 'None — just the comet' },
      { value: 2, label: 'A couple' },
      { value: 4, label: 'Four' },
      { value: 7, label: 'Lots' },
    ] },
  { key: 'calm', label: 'Motion', default: false, level: 'essential',
    onLabel: 'Calm — less movement', offLabel: 'Normal' },
  { key: 'sound', label: 'Sound', default: true, level: 'essential',
    onLabel: 'Chimes on', offLabel: 'Silent' },
  { key: 'pointer', label: 'A pointer moves the comet', default: true, level: 'standard' },
  // FIVE STOPS, NOT A SLIDER — same argument as the pond's ripple interval. A range is right
  // for a real continuum and wrong for a short list of good answers, and on a fifteen-second
  // scan dwell a slider is minutes of somebody's life to cross.
  { key: 'steerMs', label: 'Gliding to a heart takes', kind: 'choice', default: 900,
    level: 'advanced',
    options: [
      { value: 400, label: 'almost no time' },
      { value: 900, label: 'about a second' },
      { value: 1800, label: 'a slow drift' },
      { value: 3000, label: 'a very slow drift' },
    ] },
];

registerModule(
  { type: 'comet', title: 'Comet',
    description: 'A comet that follows your movement through a night sky, with hearts to catch',
    // dependsOn NONE — canvas and synthesised audio, no server, no files. That makes it a
    // genuinely good fallback when everything else is unreachable.
    importance: 'optional', dependsOn: 'none', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    let cfg = { ...DEFAULTS };

    // KEPT SEPARATE FROM cfg.calm, same reason the pond keeps them apart: folding the
    // system's reduced-motion request into the saved setting makes the settings row lie —
    // it would read "Normal" while the comet ran calm, and whoever changed it would see
    // nothing happen. The saved value is what the person chose; this is what the machine
    // asked for; the comet obeys either.
    let reducedMotion = false;
    const calm = () => cfg.calm || reducedMotion;

    let root = null, canvas = null, c2d = null, scoreEl = null, menuEl = null;
    // Hearts caught this sitting. COUNTED ALWAYS, SHOWN ONLY IF ASKED — the readout is the
    // setting, not the counting, so turning the score on mid-session does not start from zero
    // and lose what already happened.
    let caught = 0;
    // `menu` is the pre-game state: the sky still moves, but nothing is being played yet.
    let started = false;
    let raf = 0, running = false, last = 0;
    let W = 1, H = 1, DPR = 1;
    let cx = -1, cy = -1, lastMoveT = -9999;
    let trail = [], sparks = [], stars = [], hearts = [];
    let warm = null, observer = null;
    let ac = null, sfx = null, lastTone = 0;
    // A `next` glide in progress: where we started, where we are going, and when.
    let steer = null;
    // *** THE SIMULATION CLOCK, AND IT IS DELIBERATELY NOT THE WALL CLOCK. *** Everything that
    // MOVES advances by the dt handed to `step`, so the module can be driven a frame at a time
    // with no requestAnimationFrame at all. That is what makes the behavior testable: rAF does
    // not run when a page is not being composited (a background tab, a headless pane), and a
    // test that depends on it fails for reasons that have nothing to do with the module.
    let simT = 0;
    const offs = [];

    const nowMs = () => performance.now();
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

    // ---- sound. Synthesised only — no files, so nothing to 404. ----------
    function audioInit() {
      if (ac || !cfg.sound) return;
      try {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return;
        ac = new A();
        sfx = ac.createGain();
        sfx.gain.value = 0.6;
        sfx.connect(ac.destination);
      } catch { ac = null; }
    }
    function tone(freq, dur, peak) {
      if (!ac || !cfg.sound) return;
      try {
        const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.02);
      } catch { /* a dead audio context must never stop the picture */ }
    }
    function moveTone(speed) {
      if (nowMs() - lastTone < 55) return;
      lastTone = nowMs();
      tone(340 + clamp(speed, 0, 3) * 220, 0.2, 0.04);
    }
    const chime = () => { tone(880, 0.5, 0.12); tone(1320, 0.45, 0.07); };

    // ---- particles -------------------------------------------------------
    function spark(x, y, speed) {
      const n = calm() ? 1 : 1 + Math.min(4, speed | 0);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.02 * Math.min(W, H)) / 16 * (0.5 + Math.random());
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 500 + Math.random() * 500,
          col: warm[(Math.random() * warm.length) | 0] });
      }
      if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
    }
    function bloom(x, y, col) {
      const n = calm() ? 20 : 56;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.05 + Math.random() * 0.2) * Math.min(W, H) / 16;
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 600 + Math.random() * 700,
          col: col || warm[(Math.random() * warm.length) | 0] });
      }
    }

    // ---- sky -------------------------------------------------------------
    function initStars() {
      stars = [];
      for (let i = 0; i < 150; i++) {
        stars.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.6,
          tw: Math.random() * Math.PI * 2, big: Math.random() < 0.08 });
      }
    }
    function drawSky(ts) {
      // The sky stays dark by construction rather than by theme: a comet needs somewhere
      // dark to be bright, and a light-theme comet is a smudge.
      c2d.fillStyle = '#05060f';
      c2d.fillRect(0, 0, W, H);
      c2d.globalCompositeOperation = 'lighter';
      [[0.3, 0.35, 'rgba(80,60,140,0.10)'], [0.72, 0.66, 'rgba(40,90,100,0.10)']]
        .forEach((nb, i) => {
          const px = W * (nb[0] + 0.04 * Math.sin(ts * 0.00006 + i));
          const py = H * (nb[1] + 0.04 * Math.cos(ts * 0.00005 + i));
          const rg = c2d.createRadialGradient(px, py, 0, px, py, Math.min(W, H) * 0.5);
          rg.addColorStop(0, nb[2]); rg.addColorStop(1, 'rgba(0,0,0,0)');
          c2d.fillStyle = rg; c2d.fillRect(0, 0, W, H);
        });
      for (const st of stars) {
        const tw = 0.5 + 0.5 * Math.sin(ts * 0.002 + st.tw);
        c2d.globalAlpha = (st.big ? 0.7 : 0.45) * (0.5 + 0.5 * tw);
        c2d.fillStyle = st.big ? warm[1] : '#ffffff';
        c2d.beginPath();
        c2d.arc(st.x * W, st.y * H, st.r * (st.big ? 1.6 : 1), 0, Math.PI * 2);
        c2d.fill();
      }
      c2d.globalAlpha = 1;
      c2d.globalCompositeOperation = 'source-over';
    }

    // ---- hearts ----------------------------------------------------------
    // Positions are NORMALIZED (0..1), which is what makes them survive a resize instead of
    // piling into the top-left corner the first time the panel changes size.
    function spawnHeart(initial) {
      const h = {
        x: 0.08 + Math.random() * 0.84,
        vy: 0.00004 + Math.random() * 0.00004,
        phase: Math.random() * Math.PI * 2,
        swayAmp: 0.02 + Math.random() * 0.03,
        swayFreq: 0.0005 + Math.random() * 0.0006,
        size: 0.11 + Math.random() * 0.05,
        born: nowMs(),
      };
      h.y = initial ? 0.12 + Math.random() * 0.78 : 1.15 + Math.random() * 0.3;
      return h;
    }
    function buildHearts() {
      hearts = [];
      for (let i = 0; i < cfg.hearts; i++) hearts.push(spawnHeart(true));
    }
    const heartX = (h, t) => (h.x + Math.sin(t * h.swayFreq + h.phase) * h.swayAmp) * W;

    // ---- the score, and starting ------------------------------------------------------
    // DOM rather than canvas: it is text, so it should be text — selectable, readable by a
    // screen reader, and scaling with the panel instead of with a hand-tuned font size.
    function paintScore() {
      if (!scoreEl) return;
      scoreEl.hidden = !cfg.showScore || !started;
      scoreEl.textContent = `${caught} caught`;
    }

    function enterMenu() {
      started = false;
      if (menuEl) menuEl.hidden = false;
      paintScore();
    }

    // Starting is the same for every source that can start it — the button, a tap, `select`
    // or `next` — so there is only one place that decides what starting means.
    function startGame() {
      if (started) return false;
      started = true;
      caught = 0;
      if (menuEl) menuEl.hidden = true;
      paintScore();
      return true;
    }

    function updateHearts(dt) {
      const minD = Math.min(W, H);
      for (let i = 0; i < hearts.length; i++) {
        const h = hearts[i];
        h.y -= h.vy * dt * (calm() ? 0.6 : 1);
        if (h.y < -0.25) { hearts[i] = spawnHeart(false); continue; }
        // Hearts DRIFT on the start screen but cannot be CAUGHT there. Without this an aim
        // that happened to be over the panel would score before anybody had started, which is
        // both a wrong number and a heart nobody saw themselves take.
        if (!started || cx < 0) continue;
        const hx = heartX(h, nowMs()), hy = h.y * H, r = h.size * minD;
        const dx = hx - cx, dy = hy - cy;
        if (dx * dx + dy * dy < r * r) {
          bloom(hx, hy, '#ff7a96');
          chime();
          caught++;
          paintScore();
          hearts[i] = spawnHeart(false);
        }
      }
    }
    function heartPath(x, y, s) {
      c2d.beginPath();
      c2d.moveTo(x, y + s * 0.55);
      c2d.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.55, y - s * 1.05, x, y - s * 0.45);
      c2d.bezierCurveTo(x + s * 0.55, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.55);
      c2d.closePath();
    }
    function drawHearts(ts) {
      const minD = Math.min(W, H);
      hearts.forEach((h, i) => {
        const grow = clamp((nowMs() - h.born) / 500, 0, 1);
        const hx = heartX(h, ts), hy = h.y * H, r = h.size * minD * (0.7 + 0.3 * grow);
        c2d.globalCompositeOperation = 'lighter';
        const gl = c2d.createRadialGradient(hx, hy, 0, hx, hy, r * 1.7);
        gl.addColorStop(0, 'rgba(255,120,150,0.22)');
        gl.addColorStop(1, 'rgba(0,0,0,0)');
        c2d.globalAlpha = grow; c2d.fillStyle = gl;
        c2d.beginPath(); c2d.arc(hx, hy, r * 1.7, 0, Math.PI * 2); c2d.fill();
        c2d.globalCompositeOperation = 'source-over';
        c2d.globalAlpha = 0.5 * grow;
        c2d.strokeStyle = 'rgba(255,200,210,0.55)'; c2d.lineWidth = 2;
        c2d.beginPath(); c2d.moveTo(hx, hy + r * 0.5);
        c2d.quadraticCurveTo(hx + Math.sin(ts * 0.002 + i) * r * 0.25, hy + r * 1.2,
                             hx + Math.sin(ts * 0.0016 + i) * r * 0.12, hy + r * 1.9);
        c2d.stroke();
        c2d.globalAlpha = grow;
        const bg = c2d.createRadialGradient(hx - r * 0.3, hy - r * 0.45, r * 0.1, hx, hy, r * 1.2);
        bg.addColorStop(0, '#ff9bb0'); bg.addColorStop(0.5, '#ff6f91'); bg.addColorStop(1, '#d3546f');
        c2d.fillStyle = bg; heartPath(hx, hy, r); c2d.fill();
        c2d.globalAlpha = 0.55 * grow; c2d.fillStyle = 'rgba(255,255,255,0.7)';
        c2d.beginPath();
        c2d.ellipse(hx - r * 0.38, hy - r * 0.42, r * 0.2, r * 0.11, -0.6, 0, Math.PI * 2);
        c2d.fill();
        c2d.globalAlpha = 1;
      });
    }

    // ---- comet -----------------------------------------------------------
    function drawTrail() {
      c2d.globalCompositeOperation = 'lighter';
      trail.forEach((p, i) => {
        const k = 1 - p.life / TRAIL_MS;
        if (k <= 0) return;
        c2d.globalAlpha = 0.5 * k;
        c2d.fillStyle = i > trail.length * 0.6 ? warm[1] : warm[2];
        c2d.beginPath();
        c2d.arc(p.x, p.y, (6 + 16 * (i / trail.length)) * k, 0, Math.PI * 2);
        c2d.fill();
      });
      c2d.globalAlpha = 1;
      c2d.globalCompositeOperation = 'source-over';
    }
    function drawSparks() {
      c2d.globalCompositeOperation = 'lighter';
      for (const p of sparks) {
        const k = 1 - p.life / p.max;
        c2d.globalAlpha = k * 0.85;
        c2d.fillStyle = p.col;
        c2d.beginPath(); c2d.arc(p.x, p.y, 3.2 * k + 0.6, 0, Math.PI * 2); c2d.fill();
      }
      c2d.globalAlpha = 1;
      c2d.globalCompositeOperation = 'source-over';
    }
    function drawHead(ts) {
      if (cx < 0) return;
      const idle = nowMs() - lastMoveT > 1500;
      const pulse = idle && !calm() ? 1 + 0.18 * Math.sin(ts * 0.004) : 1;
      const R = 30 * pulse;
      c2d.globalCompositeOperation = 'lighter';
      const halo = c2d.createRadialGradient(cx, cy, 0, cx, cy, R * 1.8);
      halo.addColorStop(0, 'rgba(255,211,110,0.55)');
      halo.addColorStop(0.4, 'rgba(211,150,140,0.22)');
      halo.addColorStop(1, 'rgba(211,150,140,0)');
      c2d.fillStyle = halo;
      c2d.beginPath(); c2d.arc(cx, cy, R * 1.8, 0, Math.PI * 2); c2d.fill();
      const core = c2d.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
      core.addColorStop(0, 'rgba(255,250,235,0.95)');
      core.addColorStop(1, 'rgba(255,243,217,0)');
      c2d.fillStyle = core;
      c2d.beginPath(); c2d.arc(cx, cy, R * 0.6, 0, Math.PI * 2); c2d.fill();
      c2d.globalCompositeOperation = 'source-over';
    }

    // ---- where the comet is ---------------------------------------------
    function moveTo(x, y, fromPointer) {
      const had = cx >= 0;
      const dx = had ? x - cx : 0, dy = had ? y - cy : 0;
      const speed = Math.sqrt(dx * dx + dy * dy) / 16;
      cx = x; cy = y;
      lastMoveT = nowMs();
      trail.push({ x, y, life: 0 });
      if (trail.length > 60) trail.shift();
      if (had && speed > 0.15) {
        spark(x, y, speed);
        if (fromPointer) moveTone(speed);
      }
    }

    // *** THE ACCESSIBILITY ADDITION. *** `next` picks the nearest heart and glides the comet
    // to it over `steerMs`. Without this a switch user watches hearts drift past forever: the
    // comet only ever went where a pointer put it, and she has no pointer.
    //
    // It GLIDES rather than teleports because the trail is the whole point — a jump cut leaves
    // no streak, and the streak is what says "that was you".
    function steerToNearestHeart() {
      if (!hearts.length) return;
      const from = cx >= 0 ? { x: cx, y: cy } : { x: W / 2, y: H * 0.9 };
      const t = nowMs();
      let best = null, bestD = Infinity;
      for (const h of hearts) {
        const hx = heartX(h, t), hy = h.y * H;
        if (hy < -0.1 * H) continue;
        const d = (hx - from.x) ** 2 + (hy - from.y) ** 2;
        if (d < bestD) { bestD = d; best = { x: hx, y: hy }; }
      }
      if (!best) return;
      steer = { fx: from.x, fy: from.y, tx: best.x, ty: best.y, t0: simT };
      if (cx < 0) { cx = from.x; cy = from.y; }
    }
    function stepSteer() {
      if (!steer) return;
      const k = clamp((simT - steer.t0) / Math.max(1, cfg.steerMs), 0, 1);
      // ease-out: fast away, gentle arrival, so the head settles onto the heart
      const e = 1 - (1 - k) ** 3;
      moveTo(steer.fx + (steer.tx - steer.fx) * e, steer.fy + (steer.ty - steer.fy) * e, false);
      if (k >= 1) steer = null;
    }

    // ---- loop ------------------------------------------------------------
    // ADVANCE ONLY - no drawing, no rAF. `frame` adds the picture on top of this.
    function step(dt) {
      simT += dt;
      stepSteer();
      updateHearts(dt);
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].life += dt;
        if (trail[i].life > TRAIL_MS) trail.splice(i, 1);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life += dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 0.00002 * dt;
        if (p.life > p.max) sparks.splice(i, 1);
      }
    }

    function frame(ts) {
      if (!running) return;
      const dt = last ? Math.min(64, ts - last) : 16;
      last = ts;
      step(dt);
      drawSky(ts);
      drawHearts(ts);
      drawTrail();
      drawSparks();
      drawHead(ts);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    function resize() {
      if (!canvas) return;
      const r = mount.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      c2d.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    return {
      // A canvas module has no markup to assert against, so without this its behavior can
      // only be eyeballed - which is not a test. Same escape hatch the pond exposes, and it
      // is reached only through `impl`, never through the lifecycle contract.
      // Drive the simulation a frame at a time, for a test with no compositor. Advances
      // exactly what `frame` advances, and draws nothing.
      __step: (dt = 16) => step(dt),
      __probe: () => ({
        cx, cy, running, steering: !!steer, simT,
        hearts: hearts.length, sparks: sparks.length, trail: trail.length,
        calm: calm(), cfg: { ...cfg }, caught, started,
      }),
      init() {
        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };

        root = document.createElement('div');
        root.className = 'm-comet';
        // Scoped to this instance's subtree — no document.head, so two comets do not fight
        // and destroying one takes its styles with it.
        const style = document.createElement('style');
        style.textContent =
          '.m-comet{position:absolute;inset:0;overflow:hidden;background:#05060f;touch-action:none}' +
          '.m-comet canvas{position:absolute;inset:0;display:block}' +
          // The score sits in a corner, out of the sky. It is deliberately quiet — this is a
          // count of nice things that happened, not a leaderboard.
          '.m-comet .cm-score{position:absolute;top:3%;right:4%;pointer-events:none;' +
          'font:600 min(3.4cqw,18px)/1 system-ui,sans-serif;color:#e8eef0;opacity:.8;' +
          'text-shadow:0 2px 10px rgba(0,0,0,.8)}' +
          '.m-comet .cm-score[hidden]{display:none}' +
          // The start screen. Translucent, so the sky keeps moving behind it and a panel
          // waiting to be started still looks alive.
          '.m-comet .cm-menu{position:absolute;inset:0;display:flex;flex-direction:column;' +
          'align-items:center;justify-content:center;gap:2.2cqh;text-align:center;padding:6%;' +
          'background:radial-gradient(ellipse at center,rgba(5,6,15,.66),rgba(5,6,15,.88));' +
          'font:400 min(3.2cqw,17px)/1.45 system-ui,sans-serif;color:#cfe0d9}' +
          '.m-comet .cm-menu[hidden]{display:none}' +
          '.m-comet .cm-menu h2{margin:0;font:700 min(7cqw,40px)/1.1 system-ui,sans-serif;' +
          'color:#fff3d9;letter-spacing:-.01em}' +
          '.m-comet .cm-menu p{margin:0;max-width:34ch;opacity:.88}' +
          '.m-comet .cm-start{margin-top:1cqh;padding:.7em 1.9em;border-radius:999px;' +
          'border:2px solid rgba(255,243,217,.5);background:rgba(255,243,217,.12);' +
          'color:#fff3d9;font:700 min(4cqw,20px)/1 system-ui,sans-serif;cursor:pointer}' +
          '.m-comet .cm-start:focus-visible{outline:3px solid #fff3d9;outline-offset:3px}' +
          '.m-comet .cm-hint{font-size:.85em;opacity:.66}';
        root.appendChild(style);
        canvas = document.createElement('canvas');
        root.appendChild(canvas);

        scoreEl = document.createElement('div');
        scoreEl.className = 'cm-score';
        scoreEl.hidden = true;
        root.appendChild(scoreEl);

        menuEl = document.createElement('div');
        menuEl.className = 'cm-menu';
        menuEl.hidden = true;
        const h2 = document.createElement('h2');
        h2.textContent = 'Comet';
        const p = document.createElement('p');
        p.textContent = 'Move the comet through the sky and touch the hearts.';
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'cm-start';
        startBtn.textContent = 'Start';
        const hint = document.createElement('div');
        hint.className = 'cm-hint';
        hint.textContent = 'A switch, a key, or a tap will start it.';
        menuEl.append(h2, p, startBtn, hint);
        root.appendChild(menuEl);
        const onStart = (e) => { e.preventDefault(); audioInit(); startGame(); };
        startBtn.addEventListener('click', onStart);
        offs.push(() => startBtn.removeEventListener('click', onStart));
        // A tap anywhere on the panel starts it too, so the button is a signpost rather than
        // the only door — the same reason the canvas is a press source in pressgame.
        const onDown = () => { audioInit(); startGame(); };
        canvas.addEventListener('pointerdown', onDown);
        offs.push(() => canvas.removeEventListener('pointerdown', onDown));

        mount.appendChild(root);
        c2d = canvas.getContext('2d');
        warm = readTheme(mount);

        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        reducedMotion = !!mq?.matches;
        const onMq = (e) => { reducedMotion = e.matches; };
        mq?.addEventListener?.('change', onMq);
        offs.push(() => mq?.removeEventListener?.('change', onMq));

        resize();
        initStars();
        buildHearts();

        // *** THE AIM, FROM THE BUS — which is what makes this module work for the person it
        // was written for. *** It used to read `pointermove` off its own canvas, so it followed
        // a mouse and nothing else; a hand in front of a camera moved nothing, because a
        // tracker produces no DOM pointer events. Now every producer of an aim reaches it
        // through one door, and this module cannot tell them apart — which is the whole point.
        //
        // `inside: false`, so the comet keeps following an aim that has wandered off this
        // panel rather than freezing at the last edge pixel. Somebody whose movement
        // overshoots should not have to hunt their way back onto a rectangle.
        const onAim = (a) => {
          if (!cfg.pointer) return;
          const p = aimIn(a, canvas, { inside: false });
          if (!p) return;
          steer = null;                       // a real aim always wins over a glide
          audioInit();
          moveTo(p.x, p.y, true);
        };
        offs.push(bus.subscribe(AIM_TOPIC, onAim));
        // Place it on whatever the last aim was, so a comet mounted mid-session starts under
        // her hand rather than waiting for a movement she may take a while to make.
        if (ctx.aim?.latest?.()) onAim(ctx.aim.latest());

        // Verbs. `select` blooms where the comet is; `next` goes and gets a heart.
        //
        // ON THE START SCREEN EITHER VERB STARTS IT, and then does nothing else that turn.
        // The menu must be leavable by whatever input the player actually has, and a verb that
        // both started the game AND fired into it would make the first press behave unlike
        // every press after it.
        offs.push(bus.subscribe('comet/spark', () => {
          audioInit();
          if (startGame()) return;
          if (cx < 0) { cx = W / 2; cy = H / 2; }
          bloom(cx, cy);
          chime();
        }));
        offs.push(bus.subscribe('comet/seek', () => {
          audioInit();
          if (startGame()) return;
          steerToNearestHeart();
        }));

        // Only animate while actually on screen — see the header.
        observer = new IntersectionObserver((entries) => {
          const vis = entries.some((en) => en.isIntersecting);
          if (vis) start(); else stop();
        }, { threshold: 0.01 });
        observer.observe(mount);
        // Straight into play, or to the start screen. The sky animates in both cases.
        if (cfg.openToMenu) enterMenu(); else startGame();
        start();
      },
      onResize() { resize(); },
      onHide() { stop(); },
      destroy() {
        stop();
        observer?.disconnect();
        offs.forEach((f) => { try { f(); } catch { /* nothing to do */ } });
        offs.length = 0;
        try { ac?.close?.(); } catch { /* already gone */ }
        ac = null; sfx = null;
        root?.remove();
        root = canvas = c2d = scoreEl = menuEl = null;
        trail = []; sparks = []; stars = []; hearts = [];
      },
    };
  },
);
