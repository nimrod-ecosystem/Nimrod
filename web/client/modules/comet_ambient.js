// modules/comet_ambient.js — COMET'S HEARTS, HEADLESS: A SCENE ITEM, NOT A PANEL.
//
// Mike, 2026-09-26, on the earlier headless-Comet proposal ("I would even add an option to comet
// to... go headless, so the balloons go over the other modules"): *"I think so"* — the balloons
// become an overlay you can set frequency/speed/points on, decorative or "something to do," with
// "some sort of hit box module to interact with anything." Built on `mount:'ambient'`
// (`§ambient-layer`) rather than a per-instance toggle on `comet` itself — `NOTES_FROM_CODE.md`,
// 2026-09-26, has the full reasoning for why an INTERACTIVE item cannot live in `livescene.js`'s
// own overlay system (deliberately inert: `aria-hidden`, `pointer-events:none` — confirmed by
// reading the mount code, not assumed) while the already-proven ambient mechanism (real ctx/bus/
// ledger access, `pointer-events:auto` on its own surface) has exactly the shape being asked for.
//
// *** WHAT THIS REUSES FROM `comet.js`, AND WHAT IT HONESTLY DOES NOT. ***
//
// The MECHANICS are shared exactly, not re-derived: heart spawn/sway math is the same formula
// `comet.js` has always used, and "can this be pressed" now runs through `hitbox.js` — the same
// squared-distance-vs-radius check `comet.js`'s own `updateHearts` runs, extracted there in the
// same pass that built this file (see that file's own comment on the change).
//
// The ELABORATE CANVAS ART — the sky's nebula gradients, the heart's own bezier-curve shape and
// glow, the comet head's halo, the trail/spark particle system — is NOT extracted and shared
// here. That is roughly 300 lines of hand-tuned rendering in a shipped, loved game, and
// refactoring it to be genuinely shared, under this session's time budget, with no way to look
// at both renders side by side and confirm the panel version is pixel-identical afterward, is a
// real regression risk this file declines to take. This module draws its OWN simpler scene
// instead: still hearts that rise and sway, still a followed cursor when interactive, honestly
// LESS elaborate than the panel game — not a silent downgrade dressed up as the same thing.
// Worth a real shared `comet_core.js` later, done with a person actually looking at both.
//
// *** NO DEDICATED FOCUS-CYCLE SLOT FOR AMBIENT CONTENT, AND THAT IS A REAL, NAMED GAP. ***
// `kiosk.js`'s transport bar cycles through STAGE panels; an ambient-mounted module has never
// been part of that cycle (checked: nothing in kiosk.js addresses `mount:'ambient'` content by
// the transport bar today). This module still answers ordinary bus verbs on ITS OWN scoped
// topic (`comet_ambient/seek`, mirroring `comet.js`'s own `next`), which a caregiver CAN bind a
// switch to directly — the same seam every module gets — but there is no "whatever is focused"
// convenience for it the way a stage panel has. Interactive mode's POINTER path (the aim itself,
// same as `comet.js`) works regardless of focus, since it needs none.

import { registerModule } from '../module.js';
import { AIM_TOPIC, aimIn } from '../aim.js';
import { hitCircle, nearest, createHoverTracker } from '../hitbox.js';
import { createPointsLedger } from '../points.js';

const DEFAULTS = {
  mode: 'decorative',  // 'decorative' | 'interactive' — Mike's own two words for it
  count: 4,             // how many hearts drift at once — same vocabulary as comet.js's `hearts`
  speed: 1,              // multiplies rise speed
  points: 1,             // points per catch, interactive mode only
  calm: false,
};

const SETTINGS = [
  { key: 'mode', label: 'Balloons', kind: 'choice', default: 'decorative', level: 'essential',
    options: [
      { value: 'decorative', label: 'Just for looks' },
      { value: 'interactive', label: 'Something to catch' },
    ] },
  { key: 'count', label: 'How many at once', kind: 'choice', default: 4, level: 'standard',
    options: [
      { value: 0, label: 'None' }, { value: 2, label: 'A couple' },
      { value: 4, label: 'Four' }, { value: 7, label: 'Lots' },
    ] },
  { key: 'speed', label: 'How fast they rise', kind: 'choice', default: 1, level: 'standard',
    options: [
      { value: 0.5, label: 'Slower' }, { value: 1, label: 'As designed' }, { value: 1.5, label: 'Faster' },
    ] },
  // Only spent in 'interactive' mode — declared regardless, the same honesty `sprint.js`'s own
  // dailyCap keeps for a knob that is real but only sometimes live.
  { key: 'points', label: 'Points per catch', kind: 'number', default: 1, level: 'advanced',
    min: 0, max: 10, step: 0.5 },
  { key: 'calm', label: 'Motion', default: false, level: 'standard',
    onLabel: 'Calm — less movement', offLabel: 'Normal' },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Pure — the exact spawn math `comet.js`'s own `spawnHeart` uses, `speed` folded into `vy`
// rather than threaded through every caller the way `comet.js` folds `calm()` into `dt` at the
// call site. Exported so a test can check the distribution without a canvas.
export function spawnHeart(initial, speed, now = () => performance.now()) {
  const h = {
    x: 0.08 + Math.random() * 0.84,
    vy: (0.00004 + Math.random() * 0.00004) * speed,
    phase: Math.random() * Math.PI * 2,
    swayAmp: 0.02 + Math.random() * 0.03,
    swayFreq: 0.0005 + Math.random() * 0.0006,
    size: 0.09 + Math.random() * 0.04,
    born: now(),
  };
  h.y = initial ? 0.12 + Math.random() * 0.78 : 1.15 + Math.random() * 0.3;
  return h;
}

// Pure — identical sway formula to comet.js's own `heartX`.
export function heartX(h, t, W) {
  return (h.x + Math.sin(t * h.swayFreq + h.phase) * h.swayAmp) * W;
}

registerModule(
  { type: 'comet_ambient', title: 'Comet (ambient)', mount: 'ambient',
    description: 'Hearts drifting behind your other panels — decorative, or something to catch.',
    // No honest built-in fallback needed here any more than the panel version has one — canvas
    // and (in interactive mode) the points ledger, no server, no files.
    importance: 'optional', dependsOn: 'none', settings: SETTINGS },
  (ctx) => {
    const { mount, bus } = ctx;
    let cfg = { ...DEFAULTS };
    let torn = false;

    let canvas = null, c2d = null;
    let W = 1, H = 1, DPR = 1;
    let hearts = [];
    // The "head" — wherever interaction is currently happening. -1 means "nowhere yet", the
    // same sentinel `comet.js` uses, for the same reason: a comparison against a real position
    // must not accidentally match (0, 0).
    let cx = -1, cy = -1;
    let steer = null;          // an in-flight `seek` glide, same shape as comet.js's own
    let simT = 0, last = 0, raf = 0, running = false;
    let observer = null;
    let ledger = null;
    let caught = 0;
    const hover = createHoverTracker();
    const offs = [];

    const nowMs = () => performance.now();

    function buildHearts() {
      hearts = [];
      for (let i = 0; i < cfg.count; i++) hearts.push({ ...spawnHeart(true, cfg.speed, nowMs), id: `h${i}-${Math.random()}` });
    }

    function resize() {
      if (!canvas) return;
      const r = mount.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      c2d.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    async function catchHeart(i, hx, hy) {
      caught += 1;
      hearts[i] = { ...spawnHeart(false, cfg.speed, nowMs), id: hearts[i].id };
      if (cfg.mode !== 'interactive' || !ledger) return;
      try {
        await ledger.award({ amount: cfg.points, source: 'comet_ambient', note: 'caught a balloon' });
      } catch (err) { console.error('comet_ambient: award', err); }
    }

    function step(dt) {
      simT += dt;
      const minD = Math.min(W, H);
      const calmMul = cfg.calm ? 0.6 : 1;
      for (let i = 0; i < hearts.length; i++) {
        const h = hearts[i];
        h.y -= h.vy * dt * calmMul;
        if (h.y < -0.25) { hearts[i] = { ...spawnHeart(false, cfg.speed, nowMs), id: h.id }; continue; }
      }
      if (cfg.mode !== 'interactive') return;

      // A `seek` glide in progress moves the head; a real aim (see `onAim`) overrides it
      // immediately, same rule `comet.js` follows for the identical reason.
      if (steer) {
        const k = clamp((simT - steer.t0) / 700, 0, 1);
        const e = 1 - (1 - k) ** 3;
        cx = steer.fx + (steer.tx - steer.fx) * e;
        cy = steer.fy + (steer.ty - steer.fy) * e;
        if (k >= 1) steer = null;
      }
      if (cx < 0) return;

      // *** THE CATCH, THROUGH THE SHARED HIT-BOX MODULE. *** `hover.update` reports which
      // hearts are newly ENTERED this tick — exactly the moment a DOM button's `:hover` would
      // fire, or Godot's `Area2D.mouse_entered` — and that moment IS the catch: `comet.js`'s own
      // game has never needed a separate "press", touching a heart has always been enough.
      const live = hearts.map((h) => ({ id: h.id, x: heartX(h, simT, W), y: h.y * H, r: h.size * minD }));
      const { entered } = hover.update(cx, cy, live);
      for (const id of entered) {
        const i = hearts.findIndex((h) => h.id === id);
        if (i < 0) continue;
        const h = hearts[i];
        catchHeart(i, heartX(h, simT, W), h.y * H);
        hover.forget(id);   // the id is about to be reassigned to a respawned heart
      }
    }

    function draw() {
      // TRANSPARENT, ON PURPOSE — this sits behind every panel (`--z-world`-adjacent, via the
      // shared `.k-ambient` surface); painting an opaque background here would black out
      // whatever the screen's own panel-backgrounds/live-scene setting is meant to show through.
      c2d.clearRect(0, 0, W, H);
      const minD = Math.min(W, H);
      for (const h of hearts) {
        const hx = heartX(h, simT, W), hy = h.y * H, r = h.size * minD;
        const grow = clamp((nowMs() - h.born) / 500, 0, 1);
        c2d.globalAlpha = 0.85 * grow;
        const g = c2d.createRadialGradient(hx, hy, 0, hx, hy, r * 1.4);
        g.addColorStop(0, '#ff9bb0'); g.addColorStop(0.6, '#ff6f91'); g.addColorStop(1, 'rgba(211,84,111,0)');
        c2d.fillStyle = g;
        c2d.beginPath(); c2d.arc(hx, hy, r, 0, Math.PI * 2); c2d.fill();
      }
      c2d.globalAlpha = 1;
      // A soft, minimal head — not comet.js's own halo/trail/sparks (see this file's own
      // header) — just enough that "did I do that" still has an answer when interactive.
      if (cfg.mode === 'interactive' && cx >= 0) {
        const halo = c2d.createRadialGradient(cx, cy, 0, cx, cy, 22);
        halo.addColorStop(0, 'rgba(255,211,110,0.5)');
        halo.addColorStop(1, 'rgba(211,150,140,0)');
        c2d.fillStyle = halo;
        c2d.beginPath(); c2d.arc(cx, cy, 22, 0, Math.PI * 2); c2d.fill();
      }
    }

    function frame(ts) {
      if (!running) return;
      const dt = last ? Math.min(64, ts - last) : 16;
      last = ts;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    // Real aim always wins over a `seek` glide, same rule comet.js follows.
    const onAim = (a) => {
      if (cfg.mode !== 'interactive') return;
      const p = aimIn(a, canvas, { inside: false });
      if (!p) return;
      steer = null;
      cx = p.x; cy = p.y;
    };

    // *** THE ACCESSIBILITY PATH, THE SAME REASON `comet.js`'s OWN `next` EXISTS. *** Bound to
    // this instance's own scoped topic (`ctx.bus` is already `bus.scope(ctx.instanceId)`'d by
    // `mountModule`), so a caregiver can bind a switch to it directly — see this file's own
    // header on why that is a real, explicit binding rather than "whatever is focused."
    function seekNearest() {
      if (cfg.mode !== 'interactive' || !hearts.length) return;
      const from = cx >= 0 ? { x: cx, y: cy } : { x: W / 2, y: H * 0.9 };
      const candidates = hearts
        .map((h) => ({ x: heartX(h, simT, W), y: h.y * H }))
        .filter((p) => p.y >= -0.1 * H);
      const best = nearest(from.x, from.y, candidates);
      if (!best) return;
      steer = { fx: from.x, fy: from.y, tx: best.x, ty: best.y, t0: simT };
      if (cx < 0) { cx = from.x; cy = from.y; }
    }

    return {
      __step: (dt = 16) => step(dt),
      __probe: () => ({
        cx, cy, running, hearts: hearts.length, caught, cfg: { ...cfg },
      }),
      async init() {
        mount.innerHTML = '';
        canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;inset:0;display:block';
        mount.appendChild(canvas);
        c2d = canvas.getContext('2d');

        cfg = { ...DEFAULTS, ...(ctx.state?.get?.() || {}) };
        resize();
        buildHearts();

        try { ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus }); ledger.load().catch(() => {}); }
        catch (err) { ledger = null; console.error('comet_ambient: no points ledger', err); }

        offs.push(ctx.state?.subscribe?.(() => {
          const prevCount = cfg.count;
          cfg = { ...DEFAULTS, ...(ctx.state.get() || {}) };
          if (cfg.count !== prevCount) buildHearts();
        }) || (() => {}));

        offs.push(bus.subscribe(AIM_TOPIC, onAim));
        if (ctx.aim?.latest?.()) onAim(ctx.aim.latest());
        offs.push(bus.subscribe('comet_ambient/seek', seekNearest));

        observer = new IntersectionObserver((entries) => {
          const vis = entries.some((en) => en.isIntersecting);
          if (vis) start(); else stop();
        }, { threshold: 0.01 });
        observer.observe(mount);
        start();
      },
      onResize() { resize(); },
      onHide() { stop(); },
      destroy() {
        torn = true;
        stop();
        observer?.disconnect();
        offs.forEach((f) => { try { f(); } catch { /* nothing to do */ } });
        offs.length = 0;
        ledger?.destroy?.();
        canvas = null; c2d = null; hearts = [];
      },
    };
  },
);
