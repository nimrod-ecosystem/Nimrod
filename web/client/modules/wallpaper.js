// modules/wallpaper.js — the live wallpaper. Something worth looking at while a screen waits.
//
// Mike, 2026-08-30: build it as a module a container swaps in, **not** as a feature inside
// the video modules — *"implemented per module it would be written three times and drift,
// exactly like the rotation core."* Written once, every module gets a dignified held state,
// including ones nobody has written yet.
//
// The content rules, the flash-rate floor and the reasoning behind the motion ladder are in
// `wallpaper.js`. This file is the module: a mount, a slow clock, and a `<video>`/`<img>`
// when somebody has given us a folder.
//
// ---------------------------------------------------------------------------------------
// IT IS A HELD STATE, NOT A SCREENSAVER — and the difference is the whole design
// ---------------------------------------------------------------------------------------
//
// The paused segment is still there and still marked paused. The wallpaper is what is
// *shown* meanwhile, and coming back returns to where she was. That is why the container
// raises this OVER the stage instead of routing a state-machine transition through it: see
// the long note in `director.js`, which is where the real trap turned out to live.
//
// **The invariant, on this module's own terms.** A wallpaper is a state a screen can enter,
// so it must never be a state only an input can leave. Three separate things end it and none
// of them is a person: the module that published the hold publishes its end; that module
// being destroyed releases the hold (`held.js`); and the hold's own notify clock — six hours
// by default — is untouched and still running underneath. The wallpaper does not change what
// happens when the wait runs out. It changes what the wait looks like.
//
// ---------------------------------------------------------------------------------------
// A SLOW CLOCK, ON PURPOSE
// ---------------------------------------------------------------------------------------
//
// The ambient redraws about four times a second, not sixty. At the drift rates in
// `wallpaper.js` a faster clock would render frames indistinguishable from each other while
// keeping a Pi 400's CPU warm for six hours — and the low rate is itself part of the
// flash-rate argument rather than only an optimisation.
//
// ---------------------------------------------------------------------------------------
// STANDALONE TOO
// ---------------------------------------------------------------------------------------
//
// It registers as an ordinary module, so it can be put on a screen on its own — which is
// what somebody wants when the answer to "she has nothing to look at" is "something calm,
// all the time" rather than "something for the gaps". It needs no server and no files in
// that mode, which also makes it the honest last resort when everything else is unreachable.

import { registerModule } from '../module.js';
import { createMediaSourcesClient, resolveListing, mediaUrl } from '../media_sources.js';
import {
  MOTIONS, VIDEO_POLICIES, ambientFrame, frameToCss, motionOf,
  usableItems, nextItem, wallpaperMode,
} from '../wallpaper.js';

const DEFAULTS = {
  sourceId: '', album: '',
  motion: 'gentle',
  allowVideo: 'auto',
  perItemMs: 60000,        // how long one picture stays before the next
};

// The ambient's redraw period. See the header — deliberately slow.
const TICK_MS = 250;

// The cross-fade between two pictures. Long enough that nothing reads as a cut, short enough
// that a person glancing over sees a picture rather than a blur.
const FADE_MS = 2500;

// `perItemMs` is a CHOICE and it wraps, because a one-switch cursor can only travel one way.
export const SETTINGS = [
  { key: 'motion', label: 'Movement', kind: 'choice', default: 'gentle', level: 'standard',
    options: [
      { value: 'gentle', label: 'gentle — a slow drift' },
      { value: 'calm',   label: 'calm — slower and softer' },
      { value: 'still',  label: 'still — no movement at all' },
    ] },
  { key: 'allowVideo', label: 'Play video wallpapers', kind: 'choice', default: 'auto',
    level: 'standard',
    options: [
      { value: 'auto',   label: 'only when movement is gentle' },
      { value: 'always', label: 'always' },
      { value: 'never',  label: 'never — pictures only' },
    ] },
  { key: 'perItemMs', label: 'Change picture every', kind: 'choice', default: 60000,
    level: 'standard',
    options: [
      { value: 30000,  label: '30 seconds' },
      { value: 60000,  label: '1 minute' },
      { value: 300000, label: '5 minutes' },
      { value: 900000, label: '15 minutes' },
    ] },
];

registerModule(
  { type: 'wallpaper', title: 'Wallpaper',
    description: 'Something calm on screen. Works with no files at all, or plays from a folder you choose.',
    // No server and no files needed for the built-in ambient, which is exactly what makes it
    // usable as a fallback when nothing else is reachable — same argument as comet.js.
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, user } = ctx;
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    const now = ctx.now || (() => Date.now());
    const client = createMediaSourcesClient({ user, cache: true, personId: ctx.personId || null });

    let cfg = { ...DEFAULTS };
    let items = [];
    let recent = [];
    let current = null;
    let source = null;
    let loadSeq = 0;
    let destroyed = false;
    let tick = null, swap = null;
    let t0 = now();
    let layers = [];          // the two cross-fading media layers
    let front = 0;

    // KEPT SEPARATE FROM `cfg.motion`, the same way comet.js and pond.js keep the system's
    // request apart from the saved setting: folding them makes the settings row lie.
    let systemReduced = false;
    let mq = null, onMq = null;

    const motion = () => motionOf(cfg.motion, systemReduced);
    const policy = () => (VIDEO_POLICIES.includes(cfg.allowVideo) ? cfg.allowVideo : 'auto');
    const perItemMs = () => Math.max(5000, Number(cfg.perItemMs) || DEFAULTS.perItemMs);
    const pool = () => usableItems(items, { policy: policy(), motion: motion() });

    const el = (s) => mount.querySelector(s);

    // The theme's own hue, so the wallpaper is not a second palette arguing with the one the
    // profile chose. Falls back to a neutral blue when read outside a themed page.
    function themeHue() {
      try {
        const v = getComputedStyle(mount).getPropertyValue('--wallpaper-hue').trim();
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      } catch { /* not in a document, or no theme */ }
      return 210;
    }

    function paintAmbient() {
      const box = el('[data-ambient]');
      if (!box) return;
      box.style.background = frameToCss(ambientFrame(now() - t0, { motion: motion(), hueBase: themeHue() }));
    }

    function startTick() {
      stopTick();
      paintAmbient();
      // 'still' means still: one frame and no clock at all, rather than a clock redrawing an
      // identical frame forever.
      if (motion() === 'still') return;
      const run = () => {
        if (destroyed) return;
        paintAmbient();
        tick = setTimer(run, TICK_MS);
      };
      tick = setTimer(run, TICK_MS);
    }
    function stopTick() { if (tick != null) { clearTimer(tick); tick = null; } }

    // ------------------------------------------------------------------------------------
    // MEDIA
    // ------------------------------------------------------------------------------------

    function clearLayer(l) {
      l.innerHTML = '';
      l.style.opacity = '0';
    }

    function showItem(it) {
      if (!it || !source) return;
      current = it;
      recent = [...recent, it.id].slice(-12);
      const back = layers[1 - front];
      if (!back) return;
      back.innerHTML = '';
      const url = mediaUrl(source.base_url, it.path);
      if (it.kind === 'video') {
        const v = document.createElement('video');
        // Muted with no unmute — see the header of `wallpaper.js`. `playsInline` so iOS does
        // not take the video full-screen over the rest of the screen.
        v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true;
        v.playsInline = true; v.setAttribute('playsinline', '');
        v.src = url;
        back.append(v);
        v.play?.().catch(() => { /* a wallpaper that will not autoplay is not an error worth showing */ });
      } else {
        const img = document.createElement('img');
        img.alt = '';                  // decorative: a wallpaper is not content to announce
        img.src = url;
        back.append(img);
      }
      // Cross-fade. At `still` there is no fade — a hard change is less motion than a
      // dissolve, which is the whole point of that setting.
      const fadeMs = motion() === 'still' ? 0 : FADE_MS;
      back.style.transition = fadeMs ? `opacity ${fadeMs}ms linear` : 'none';
      layers[front].style.transition = back.style.transition;
      back.style.opacity = '1';
      layers[front].style.opacity = '0';
      front = 1 - front;
      // The layer that just went out keeps its video decoding until the fade is over; then it
      // is emptied, or an hour of wallpaper leaves twenty <video> elements running.
      const gone = layers[1 - front];
      setTimer(() => { if (!destroyed && gone !== layers[front]) clearLayer(gone); }, fadeMs + 50);
    }

    function advance() {
      const p = pool();
      if (!p.length) { render(); return; }
      showItem(nextItem(p, { recent, rand: ctx.rand || Math.random, now: now() }));
    }

    function startSwap() {
      stopSwap();
      if (wallpaperMode(items, { policy: policy(), motion: motion() }) !== 'media') return;
      const run = () => {
        if (destroyed) return;
        advance();
        swap = setTimer(run, perItemMs());
      };
      swap = setTimer(run, perItemMs());
    }
    function stopSwap() { if (swap != null) { clearTimer(swap); swap = null; } }

    function render() {
      const media = wallpaperMode(items, { policy: policy(), motion: motion() }) === 'media';
      const box = el('[data-media]');
      if (box) box.hidden = !media;
      // The ambient stays UNDERNEATH rather than being torn down: a picture that fails to
      // load, or a folder that goes away mid-session, then falls back to something instead of
      // to a black rectangle.
      const amb = el('[data-ambient]');
      if (amb) amb.hidden = false;
    }

    async function ensureSource() {
      const sources = await client.list();
      if (cfg.sourceId) {
        const found = sources.find((s) => s.id === cfg.sourceId);
        if (found) return found;
      }
      const qp = new URLSearchParams(location.search);
      const ws = qp.get('wallpaperSource');
      if (ws) {
        const base = ws.replace(/\/+$/, '');
        const existing = sources.find((s) => s.base_url === base);
        const src = existing || await client.add({ label: 'dev wallpaper', base_url: base, kind: 'agent' });
        state.set({ sourceId: src.id, album: qp.get('wallpaperAlbum') || cfg.album });
        return src;
      }
      return null;
    }

    async function reload() {
      const seq = ++loadSeq;
      let src = null;
      // *** A WALLPAPER NEVER REPORTS AN ERROR ON SCREEN. *** It is the thing shown when
      // something else has stopped; putting "source unreachable" in front of somebody who did
      // not ask for a wallpaper in the first place turns a calm screen into a fault report.
      // The ambient is always underneath, so every failure here has somewhere to land.
      try { src = await ensureSource(); }
      catch (e) { console.warn('wallpaper: sources', e); }
      if (seq !== loadSeq || destroyed) return;
      if (!src) { source = null; items = []; render(); return; }
      let listing = null;
      try { listing = await resolveListing(src, cfg.album); }
      catch (e) { console.warn('wallpaper: listing', e); }
      if (seq !== loadSeq || destroyed) return;
      source = src;
      items = (listing?.items || []).filter((it) => it.kind === 'image' || it.kind === 'video');
      render();
      if (pool().length) { advance(); startSwap(); }
    }

    function applyConfig() {
      startTick();
      render();
      startSwap();
    }

    return {
      __probe: () => ({
        motion: motion(), policy: policy(), systemReduced,
        mode: wallpaperMode(items, { policy: policy(), motion: motion() }),
        items: items.length, usable: pool().length,
        currentId: current?.id || null,
        ticking: tick != null, swapping: swap != null,
        css: el('[data-ambient]')?.style.background || '',
      }),

      init() {
        mount.innerHTML = `
          <div class="wp">
            <div class="wp-ambient" data-ambient></div>
            <div class="wp-media" data-media hidden>
              <div class="wp-layer" data-layer></div>
              <div class="wp-layer" data-layer></div>
            </div>
          </div>`;
        layers = [...mount.querySelectorAll('[data-layer]')];

        mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        systemReduced = !!mq?.matches;
        onMq = (e) => { systemReduced = e.matches; applyConfig(); };
        mq?.addEventListener?.('change', onMq);

        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        t0 = now();
        applyConfig();

        state?.subscribe?.(() => {
          cfg = { ...DEFAULTS, ...(state.get() || {}) };
          applyConfig();
          reload().catch((e) => console.warn('wallpaper: reload', e));
        });

        // `wallpaper/next` so the same skip any other module offers is available here. It is
        // a convenience, never a requirement: nothing waits for it.
        bus?.subscribe?.('wallpaper/next', () => advance());

        reload().catch((e) => console.warn('wallpaper: load', e));
      },

      onResize() { /* the layers are CSS-sized; nothing to recompute */ },
      onHide() { stopTick(); stopSwap(); },
      onShow() { applyConfig(); },

      destroy() {
        destroyed = true;
        stopTick(); stopSwap();
        mq?.removeEventListener?.('change', onMq);
        for (const l of layers) { try { clearLayer(l); } catch { /* already gone */ } }
        layers = [];
        mount.innerHTML = '';
      },
    };
  },
);

export { MOTIONS };
