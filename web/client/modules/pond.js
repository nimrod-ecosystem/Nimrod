// modules/pond.js — a calm pond, ported from Cici.
//
// WHY THIS ONE FIRST, of everything Cici grew. Christine cannot reach for anything, so a
// module whose value depends on being played is a module she never gets to use. A pond has
// value with NO interaction at all — it is something to look at that moves and is quiet —
// and then rewards any interaction it does get. That ordering is the right one for a screen
// somebody sits at all day: ambient first, cause-and-effect second, game never.
//
// WHAT CHANGED IN THE PORT, and why each thing had to:
//
//   * Cici's version was an IIFE registering on a global and injecting a <style> tag into
//     the document head. Here it is a module: it gets `ctx.mount` and owns nothing outside
//     it. That is what lets two ponds exist on one screen without fighting.
//   * IT ANSWERS VERBS. The original was cursor-and-click, which for Christine means it was
//     ambient-only. `select` drops a splash wherever the last disturbance was, so a single
//     switch can make something happen — which is the whole cause-and-effect point, and it
//     was unreachable before.
//   * COLOURS COME FROM THE THEME, not from constants. Cici's pond is hardcoded teal; here
//     it reads `--midnight`, `--moss`, `--rosy` and `--beige`, so it follows Dusk at night
//     like everything else on the screen.
//   * IT STOPS WHEN IT IS NOT VISIBLE. A canvas animating behind a hidden panel is battery
//     and heat on a Pi that is on 24/7, for a picture nobody is looking at.
//
// EVERY KNOB IS A SETTING, with the default named beside it.

import { registerModule } from '../module.js';

const DEFAULTS = {
  // How often the pond stirs by itself, in milliseconds. The pond has to look alive when
  // nobody is touching it, because most of the time nobody is.
  ambientMs: 1500,
  // Ambient ripples off entirely — for a screen where any motion is too much.
  ambient: true,
  // Does moving a pointer disturb the water? Off is a legitimate choice for a screen with
  // a stray mouse plugged in that nobody is using.
  pointer: true,
  // Motion budget. `calm` halves the ripple count and slows the shimmer.
  calm: false,
};

const MAX_RIPPLES = 80;

function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    deep: v('--midnight', '#105666'),
    weed: v('--moss', '#839958'),
    crest: v('--beige', '#F7F4D5'),
    catch: v('--rosy', '#D3968C'),
  };
}

// Canvas wants `rgba(r,g,b,a)`; the theme gives `#rrggbb`. Doing this once per repaint
// rather than per ripple is the difference between smooth and not on a Pi 400.
function rgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${n[0] || 0},${n[1] || 0},${n[2] || 0},${alpha})`;
}

// WHAT THE SETTINGS MENU SHOWS. The shell renders these; this module renders none of it,
// which is the point - a declaration can be walked with one switch, a hand-rolled panel
// cannot. `ambientMs` sits at `advanced` because raw timings are what that level is FOR, and
// because "1500 ms" is not a sentence anybody at a bedside thinks in.
const SETTINGS = [
  { key: 'ambient', label: 'Ripples on its own', default: true, level: 'essential',
    onLabel: 'Yes', offLabel: 'Still water' },
  { key: 'calm', label: 'Motion', default: false, level: 'essential',
    onLabel: 'Calm - less movement', offLabel: 'Normal' },
  { key: 'pointer', label: 'A mouse disturbs the water', default: true, level: 'standard' },
  // FIVE STOPS, NOT TWELVE, and the audit is what said so: as a 500-6000ms range in 500s
  // this was the most expensive control in the product - twelve presses for a lap plus three
  // to reach it, which on a fifteen-second scan dwell is nearly four minutes to change one
  // setting. Five known-good values cover everything anybody wants. Same argument as the
  // slideshow interval, and the same argument every time: a range is the right kind for a
  // real continuum and the wrong kind for a short list of good answers.
  //
  // STORED IN MILLISECONDS, SHOWN IN SECONDS - the house rule, carried by the labels here.
  { key: 'ambientMs', label: 'A ripple every', kind: 'choice', default: 1500,
    level: 'advanced',
    options: [
      { value: 500, label: 'half a second' },
      { value: 1000, label: '1 second' },
      { value: 1500, label: '1.5 seconds' },
      { value: 3000, label: '3 seconds' },
      { value: 6000, label: '6 seconds' },
    ] },
];

registerModule(
  // OPTIONAL, in Mike's own words: *"I'm not too concerned about the pond game. We can lose it
  // if we need to."* That is not a criticism of the module - it is the fact the audit needs,
  // because ranking findings by cost alone pointed at this panel first and it was the one
  // thing in the build nobody would miss. What the port actually bought was the PATTERN for
  // bringing a Cici module across; the pond itself is welcome to go.
  { type: 'pond', title: 'Pond', description: 'calm water that ripples when it is touched',
    // FALLBACK EXPOSURE: a canvas and nothing else, which makes it a genuinely good last
    // resort even though it is the module Mike is least attached to.
    importance: 'optional', dependsOn: 'none', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    let cfg = { ...DEFAULTS };
    // KEPT SEPARATE FROM `cfg.calm` ON PURPOSE. Folding the system's reduced-motion request
    // into the saved setting made the settings row lie: it would read "Normal" while the pond
    // was running calm, and the person changing it would see nothing happen. The saved value
    // is what the person chose; this is what the machine asked for; the pond obeys either.
    let reducedMotion = false;
    const calm = () => cfg.calm || reducedMotion;

    let canvas = null;
    let c2d = null;
    let raf = 0;
    let running = false;
    let W = 1, H = 1, DPR = 1, last = 0, lastAmbient = 0;
    let ripples = [];
    let cx = -1, cy = -1;
    let theme = null;
    let observer = null;
    const offs = [];

    // A person driving with a switch has no pointer, so `select` has to land SOMEWHERE.
    // The middle is the honest default: it is the part of the panel they are looking at.
    const aim = () => (cx >= 0 ? { x: cx, y: cy } : { x: W / 2, y: H / 2 });

    function spawn(x, y, strength) {
      ripples.push({
        x, y, r: 6, max: 1.0 + 0.5 * strength, life: 0,
        dur: (1600 + 900 * strength) * (calm() ? 1.4 : 1),
        strength,
      });
      const cap = calm() ? MAX_RIPPLES / 2 : MAX_RIPPLES;
      if (ripples.length > cap) ripples.splice(0, ripples.length - cap);
    }

    function splash(x, y) {
      spawn(x, y, 1.4);
      const n = calm() ? 2 : 5;
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const d = 14 + Math.random() * 26;
        spawn(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.3 + Math.random() * 0.4);
      }
    }

    function resize() {
      if (!canvas || !c2d) return;
      // Capped at 1.5: a Pi 400 rendering a full-screen canvas at a phone's pixel ratio is
      // how a calm pond becomes a slideshow.
      DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      W = mount.clientWidth || 1;
      H = mount.clientHeight || 1;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      c2d.setTransform(DPR, 0, 0, DPR, 0, 0);
      theme = readTheme(mount);
    }

    function drawWater(ts) {
      const g = c2d.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, rgba(theme.deep, 1));
      g.addColorStop(0.55, rgba(theme.deep, 0.86));
      g.addColorStop(1, 'rgba(6,26,32,1)');
      c2d.fillStyle = g;
      c2d.fillRect(0, 0, W, H);

      const speed = calm() ? 0.5 : 1;
      c2d.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i += 1) {
        const px = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(ts * 0.00013 * speed + i * 1.7)));
        const py = H * (0.2 + 0.6 * (0.5 + 0.5 * Math.cos(ts * 0.00011 * speed + i * 2.3)));
        const rg = c2d.createRadialGradient(px, py, 0, px, py, Math.min(W, H) * 0.28);
        rg.addColorStop(0, rgba(theme.weed, 0.06));
        rg.addColorStop(1, rgba(theme.weed, 0));
        c2d.fillStyle = rg;
        c2d.fillRect(0, 0, W, H);
      }
      c2d.globalCompositeOperation = 'source-over';
    }

    function drawRipple(rp) {
      const k = rp.life / rp.dur;
      const R = rp.r + k * Math.min(W, H) * 0.5 * rp.max;
      const ry = R * 0.6;                    // squashed, so it reads as a surface
      const fade = 1 - k;
      c2d.globalCompositeOperation = 'lighter';
      c2d.globalAlpha = 0.28 * fade * (0.6 + rp.strength);
      c2d.strokeStyle = rgba(theme.crest, 1);
      c2d.lineWidth = 1.6 + 1.4 * rp.strength;
      c2d.beginPath(); c2d.ellipse(rp.x, rp.y, R, ry, 0, 0, Math.PI * 2); c2d.stroke();
      c2d.globalAlpha = 0.16 * fade;
      c2d.strokeStyle = rgba(theme.catch, 1);
      c2d.lineWidth = 1.2;
      c2d.beginPath(); c2d.ellipse(rp.x, rp.y, R * 0.82, ry * 0.82, 0, 0, Math.PI * 2); c2d.stroke();
      c2d.globalAlpha = 1;
      c2d.globalCompositeOperation = 'source-over';
    }

    function frame(ts) {
      if (!running) return;
      const dt = last ? Math.min(ts - last, 50) : 16;
      last = ts;
      if (cfg.ambient && ts - lastAmbient > cfg.ambientMs) {
        lastAmbient = ts;
        spawn(Math.random() * W, H * (0.2 + 0.7 * Math.random()), 0.15 + Math.random() * 0.25);
      }
      drawWater(ts);
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const rp = ripples[i];
        rp.life += dt;
        if (rp.life >= rp.dur) { ripples.splice(i, 1); continue; }
        drawRipple(rp);
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // A canvas animating behind a hidden panel costs battery and heat on a machine that is
    // on around the clock, for a picture nobody can see.
    function applyActive() {
      const visible = mount.offsetParent !== null && document.visibilityState !== 'hidden';
      if (visible) start(); else stop();
    }

    return {
      init() {
        mount.innerHTML = '<div class="pond"><canvas></canvas></div>';
        canvas = mount.querySelector('canvas');
        c2d = canvas.getContext('2d');

        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        // A person who has asked their system for less motion has asked this panel too - but
        // that is recorded beside the setting, never written into it. See `reducedMotion`.
        reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        resize();
        applyActive();

        // BOUND ONCE AND GATED INSIDE, not attached conditionally. Deciding at init meant
        // turning the setting off in the menu did nothing until the panel was remounted, and
        // a setting that silently does not apply is the support call this whole slice exists
        // to prevent.
        mount.addEventListener('pointermove', (e) => {
          if (!cfg.pointer) return;
          const r = canvas.getBoundingClientRect();
          cx = e.clientX - r.left;
          cy = e.clientY - r.top;
          spawn(cx, cy, 0.25);
        });
        mount.addEventListener('pointerdown', (e) => {
          if (!cfg.pointer) return;
          const r = canvas.getBoundingClientRect();
          splash(e.clientX - r.left, e.clientY - r.top);
        });

        // THE PORT'S REAL ADDITION. Cursor-and-click meant Christine could never make
        // anything happen here; a verb means one switch can.
        offs.push(bus.subscribe('pond/splash', () => { const a = aim(); splash(a.x, a.y); }));
        offs.push(bus.subscribe('pond/stir', () => {
          spawn(Math.random() * W, H * (0.2 + 0.7 * Math.random()), 0.5);
        }));

        document.addEventListener('visibilitychange', applyActive);
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => { resize(); applyActive(); });
          observer.observe(mount);
        }
        state?.subscribe?.((s) => { cfg = { ...DEFAULTS, ...(s || {}) }; });
      },

      onResize() { resize(); applyActive(); },
      onHide() { stop(); },

      destroy() {
        stop();
        offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
        offs.length = 0;
        observer?.disconnect();
        document.removeEventListener('visibilitychange', applyActive);
        mount.innerHTML = '';
      },

      // Exposed for the test: the pond is a canvas, so there is nothing in the DOM to
      // assert against and the state has to be readable some other way.
      __probe: () => ({ ripples: ripples.length, running, W, H, cfg: { ...cfg },
                        reducedMotion, calm: calm() }),
    };
  },
);

export const POND_DEFAULTS = DEFAULTS;
export const POND_SETTINGS = SETTINGS;
