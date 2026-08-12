// Interstitials — short segments that play BETWEEN videos (docs/modules/
// interstitials.md). This is sub-slice 1: the GENERATED kind only (educational —
// alphabet / counting / vocab). Recorded personal messages + R-key capture are a
// later sub-slice.
//
// It is built on the platform's spine, like photos/youtube:
//   content library (data)  ->  shared weighted picker (rng.js)  ->  render + speak
//   -> append-only play event  (picker stats derive from the log; no mutable record)
//
// CONTENT AS MEANING (DECISIONS.md). A generated item is SEMANTIC DATA, never
// pre-rendered: a graphic VALUE (`{type:'number', value:3}`) + a line to `speak`.
// The renderer draws the graphic LIVE in the profile's theme (it uses the CSS
// variables the shell already set on :root, so it themes for FREE) and speaks the
// line via the profile's VOICE (voice.js `speak()`), so changing theme or voice
// re-renders / re-speaks every segment with no re-authoring.
//
// THREE-QUADRANT LAYOUT + THE INVARIANT CAMERA. A 2×2 grid: TL = the Cici presenter
// (for generated content), TR = the self-view camera which NEVER changes (for
// Christine that rearview "mirror" is her constant orientation anchor — never
// cover it), BL = subject photo + name, BR = the live graphic. Only three quadrants
// carry the changing segment; TR is constant — hence "three-quadrant".
//
// NON-BLOCKING + SKIPPABLE. A segment never requires input. `interstitial/next`
// advances (auto by a timer, or any source); `interstitial/skip` cancels the
// current speech and moves on. Weighted pick avoids immediate repeats and (via the
// `kind` diversity axis) avoids three counting items in a row.
//
// TWO INJECTION SEAMS for deterministic tests (no audio, no camera):
//   * ctx.speak(text, voicePref)  overrides voice.js speak() — a test records calls.
//   * cfg.selfView=false          skips getUserMedia (the test drives logic only).
//
// PROFILE VOICE ACCESS (noted for later). Voice is a PROFILE setting, not this
// module's own state, so the module opens a read handle on the profile's `settings`
// blob (`/api/profiles/{profileId}/state/settings`). That's self-contained (no
// contract change), but "a module reads profile settings" is a pattern worth
// formalizing via ctx once a second speaking module needs it.

import { registerModule } from '../module.js';
import { createState } from '../state.js';
import { pick, statsFromEvents } from '../rng.js';
import { speak as speakDefault, cancel as cancelSpeak } from '../voice.js';

// A small default library so a fresh instance shows something immediately. Data
// only — the meaning, not pixels. Editable/extendable later via the module's state.
const DEFAULT_ITEMS = [
  { id: 'count-1', kind: 'counting', graphic: { type: 'number', value: 1 }, speak: 'One.', enabled: true, weight: 1 },
  { id: 'count-3', kind: 'counting', graphic: { type: 'number', value: 3 }, speak: 'Three. One, two, three.', enabled: true, weight: 1 },
  { id: 'count-5', kind: 'counting', graphic: { type: 'number', value: 5 }, speak: 'Five. Count with me: one, two, three, four, five.', enabled: true, weight: 1 },
  { id: 'letter-a', kind: 'alphabet', graphic: { type: 'letters', value: 'A' }, speak: 'A. A is for apple.', enabled: true, weight: 1 },
  { id: 'letter-b', kind: 'alphabet', graphic: { type: 'letters', value: 'B' }, speak: 'B. B is for ball.', enabled: true, weight: 1 },
  { id: 'word-cup', kind: 'vocab', graphic: { type: 'word', value: 'cup' }, speak: 'Cup. This is a cup.', enabled: true, weight: 1 },
  { id: 'word-dog', kind: 'vocab', graphic: { type: 'word', value: 'dog' }, speak: 'Dog. The dog says woof.', enabled: true, weight: 1 },
];

const DEFAULTS = { items: null, intervalSec: 20, autoPlay: false, selfView: true, presenter: 'Cici' };
const RECENT_CAP = 8;

// The live graphic, drawn from the VALUE (semantic data), styled by the theme's CSS
// vars. Pure + exported so it can be unit-tested without mounting the module.
//   number: big numeral + up to 10 counting dots
//   letters: the upcased letter(s)
//   word: the word spelled out, then whole
export function graphicHTML(g) {
  if (!g || g.type === 'none') return '';
  if (g.type === 'number') {
    const n = Math.max(0, Math.min(20, Number(g.value) || 0));
    const dots = n > 0 && n <= 10 ? `<div class="ig-dots">${'<i></i>'.repeat(n)}</div>` : '';
    return `<div class="ig-number" data-value="${n}">${n}</div>${dots}`;
  }
  if (g.type === 'letters') {
    return `<div class="ig-letters">${String(g.value ?? '').toUpperCase()}</div>`;
  }
  if (g.type === 'word') {
    const w = String(g.value ?? '');
    const spelled = w.split('').map((c) => `<span>${c.toUpperCase()}</span>`).join('');
    return `<div class="ig-word"><div class="ig-spell">${spelled}</div><div class="ig-wordfull">${w}</div></div>`;
  }
  return '';
}

registerModule(
  { type: 'interstitials', title: 'Interstitials', description: 'between-video segments — educational (generated) for now' },
  (ctx) => {
    const { mount, bus, state, events, user, profileId } = ctx;
    const speak = ctx.speak || speakDefault;         // injectable for tests (no audio)

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {}, kinds = {};
    let stats = {};
    let recent = [], history = [], histPos = -1;
    let currentId = null;
    let timer = null;
    let voicePref = {};                              // from the profile's settings blob
    let settings = null;                             // read handle on that blob
    let camStream = null;

    // ---- content library ----------------------------------------------------
    function indexItems() {
      const raw = Array.isArray(cfg.items) && cfg.items.length ? cfg.items : DEFAULT_ITEMS;
      const list = raw.filter((it) => it && it.id && it.enabled !== false);
      items = list;
      ids = list.map((it) => it.id);
      byId = Object.fromEntries(list.map((it) => [it.id, it]));
      kinds = Object.fromEntries(list.map((it) => [it.id, it.kind || it.id]));  // kind = diversity axis
    }

    function render(item) {
      const presenter = cfg.presenter || 'Cici';
      const subjectName = item.subjectName || presenter;
      const subjectPhoto = item.subjectPhoto
        ? `<img src="${item.subjectPhoto}" alt="${subjectName}">`
        : `<div class="ig-avatar">${subjectName.slice(0, 1)}</div>`;
      mount.querySelector('[data-cell="media"]').innerHTML =
        `<div class="ig-presenter"><div class="ig-avatar big">${presenter.slice(0, 1)}</div><span>${presenter}</span></div>`;
      mount.querySelector('[data-cell="subject"]').innerHTML =
        `${subjectPhoto}<span class="ig-name">${subjectName}</span>`;
      mount.querySelector('[data-cell="graphic"]').innerHTML = graphicHTML(item.graphic);
    }

    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      currentId = id;
      render(item);
      if (item.speak) { try { speak(item.speak, voicePref); } catch (e) { console.error('interstitials: speak', e); } }
      if (record) {
        recent.push(id);
        if (recent.length > RECENT_CAP) recent.shift();
        history = history.slice(0, histPos + 1);
        history.push(id); histPos = history.length - 1;
        events.append('play', { id, at: Date.now() }).catch((e) => console.error('interstitials: play log', e));
      }
      scheduleNext();
    }

    function advance() {
      if (!ids.length) return;
      const id = pick(ids, stats, { now: Date.now(), rand: Math.random, recent, channels: kinds });
      if (id) show(id, true);
    }

    function prev() {
      if (histPos > 0) { histPos -= 1; show(history[histPos], false); }
    }

    function skip() { try { cancelSpeak(); } catch { /* noop */ } advance(); }

    // ---- scheduler ----------------------------------------------------------
    function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
    function scheduleNext() {
      clearTimer();
      if (!cfg.autoPlay) return;
      const secs = Math.max(3, Number(cfg.intervalSec) || DEFAULTS.intervalSec);
      timer = setTimeout(() => bus.publish('interstitial/next'), secs * 1000);
    }

    // ---- the invariant self-view camera (TR) --------------------------------
    async function startSelfView() {
      const cell = mount.querySelector('[data-cell="camera"]');
      if (!cfg.selfView || !navigator.mediaDevices?.getUserMedia) {
        cell.innerHTML = '<span class="ig-cammuted">self-view</span>';
        return;
      }
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const v = document.createElement('video');
        v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = camStream;
        cell.innerHTML = ''; cell.append(v);
      } catch {
        cell.innerHTML = '<span class="ig-cammuted">camera off</span>';
      }
    }
    function stopSelfView() {
      if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
    }

    function deriveStats(cache) {
      const plays = (cache.events || [])
        .filter((e) => e.kind === 'play')
        .map((e) => ({ id: e.data?.id, at: e.data?.at || Date.parse(e.created_at) || 0 }));
      return statsFromEvents(plays, { idKey: 'id', atKey: 'at' });
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="interstitial">
            <div class="ig-grid">
              <div class="ig-cell media" data-cell="media"></div>
              <div class="ig-cell camera" data-cell="camera"></div>
              <div class="ig-cell subject" data-cell="subject"></div>
              <div class="ig-cell graphic" data-cell="graphic"></div>
            </div>
            <div class="ig-nav">
              <button class="ig-btn" data-skip>Skip ›</button>
            </div>
          </div>`;

        // sinks — any source (a timer, the youtube "ended" event, a switch) can drive it
        bus.subscribe('interstitial/next', () => advance());
        bus.subscribe('interstitial/prev', () => prev());
        bus.subscribe('interstitial/skip', () => skip());

        const nav = bus.createSource('interstitial-nav');
        bus.addBinding({ source: 'interstitial-nav', signal: 'skip', topic: 'interstitial/skip' });
        mount.querySelector('[data-skip]').addEventListener('click', () => nav.emit('skip'));

        // play history -> picker stats
        events.subscribe((cache) => { stats = deriveStats(cache); });

        // read the profile's VOICE from its settings blob (self-contained; see header)
        settings = createState({ url: `/api/profiles/${profileId}/state/settings`, user });
        settings.subscribe((s) => { voicePref = (s && s.voice) || {}; });
        settings.load().then(() => settings.startPolling()).catch(() => {});

        // config: content library + scheduler options
        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          indexItems();
          if (!ids.length) return;
          if (!currentId || !byId[currentId]) advance();   // start once we have a pool
          else scheduleNext();
        });

        startSelfView();
      },
      onResize() {},
      onHide() { try { cancelSpeak(); } catch { /* noop */ } state.flush(); },
      destroy() {
        clearTimer();
        stopSelfView();
        try { cancelSpeak(); } catch { /* noop */ }
        if (settings) { settings.destroy(); settings = null; }
      },
    };
  },
);
