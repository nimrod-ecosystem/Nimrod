// cat_guide.js — NIMROD THE CAT, THE GUIDE. A second walk on the guided tour's engine.
//
// Change list row 2.26 (d) and §cat-walkthrough. Mike, 2026-09-29, answering "Yes" to all of it:
//   * Nimrod the cat is the guide, and the first walk teaches the settings menu and the transport
//     bar on the name sign and the picture of game step 1 (the steps: `game/cat_steps.js`);
//   * the cat appears ONLY when asked — a visible "Show me how" — or at a quest/game step. It never
//     pops up uninvited, which is the reason everybody hated Clippy;
//   * it is ALWAYS dismissible: one obvious Close, and Escape;
//   * how chatty it is is the person's setting;
//   * its words ALSO go through the output bus (`output.say`), so somebody who cannot read the
//     bubble hears them, arbitrated with everything else that talks on that screen.
//
// ---------------------------------------------------------------------------------------
// *** IT IS NOT A SECOND TOUR ENGINE. ***
// ---------------------------------------------------------------------------------------
//
// Row 2.26 says reuse the tour's recorded-playback mechanism (change list C$8) rather than build a
// second one, and this file is the proof it was: `mountTour` from `tour.js` does ALL of the
// walking — the position that survives navigation, "the tour never performs the action", the
// holding state with a link when the next step is on another page, `next()` always terminating,
// the ring, the reduced-motion ring, the start gate. What this file adds sits on the options
// `tour.js` grew for it (its header lists them, each defaulting to the old behaviour):
//
//   the cat himself    `decorate` puts his picture in the panel; `onPlace` turns his paw toward
//                      the ring (`poseToward`).
//   the words          `sayFor` picks the step's words for the chattiness setting (`catWords`).
//   the voice          `onStep` hands the same words to `output.say` — the page's output bus.
//   Escape             `escapeCloses`, which steps aside for the settings menu's own Escape.
//   following along    a step whose `doneWhen` matches is done: the cat moves on by itself (and
//                      skips it on arrival), and `advanceOn: 'click'` moves on as the target is
//                      pressed. The person still does every step; the cat only notices.
//   resting            nobody touching the page for `restMinutes` closes him (see below).
//   Back               `backButton` (Mike, 2026-09-29: "There should also be a previous button in
//                      case you want to go back"). A step reached by Back is NOT auto-skipped as
//                      done, or Back would bounce straight forward again.
//   holding the bar    while the step he is on points at something inside the kiosk's transport
//                      bar, he asks the host to keep the bar on screen (`holdBar`, the kiosk
//                      handle's own seam), and lets go the moment he points elsewhere or leaves.
//
// ---------------------------------------------------------------------------------------
// THE SAFETY INVARIANT, AND WHY THIS SHAPE HOLDS IT
// ---------------------------------------------------------------------------------------
//
// CLAUDE.md: A SCREEN MUST NEVER ENTER A STATE THAT ONLY AN INPUT CAN LEAVE, WHEN THE PERSON IN
// FRONT OF IT CANNOT GIVE THAT INPUT. The cat never does:
//   * no scrim, no `aria-modal`, no focus trap — the overlay is `pointer-events:none` except its own
//     panel (inherited from `tour.js`, checked again in `dev/cat_guide_test.html`), so everything
//     underneath keeps working while he is up;
//   * he is never a gate: nothing waits for him, and pressing Next enough times ends the walk;
//   * if nobody answers he just waits, harmlessly — and after `restMinutes` with nobody touching the
//     page he closes himself, so an abandoned walk is not left over a screen somebody watches.
//   * he never starts himself: `mountCat` returns null until `startCat` has run in this browser
//     (the "Show me how" button, or a quest step calling it), exactly the tour's start gate.

import { mountTour, startTour, resetTour, tourStarted, allTourSteps, samePage, findTarget } from './tour.js';

// His own position, apart from the site tour's: the kiosk mounts both, and finishing one must not
// cancel the other.
export const CAT_KEYS = Object.freeze({ pos: 'nimrod:catStep', done: 'nimrod:catDone' });
export const CAT_PREFS_KEY = 'nimrod:catPrefs';
export const CAT_SOURCE = 'nimrod-cat';             // `source` on everything he says, for the log
export const CAT_TOPIC = 'nimrod-cat';              // bus: nimrod-cat/next, /prev, /skip

// HOW CHATTY HE IS — the person's setting. Each step carries three lengths (`game/cat_steps.js`).
export const CHATTINESS = Object.freeze([
  { value: 'few', label: 'A few' },
  { value: 'some', label: 'Some' },
  { value: 'lots', label: 'Lots' },
]);

// DEFAULTS, each a setting and each argued, none a rule:
//   chat 'some'     one or two sentences: what to press and what it is for. 'few' drops the why,
//                   which is what makes a walk teach rather than just steer; 'lots' adds a line per
//                   step, which is the Clippy failure for anybody who did not ask for it.
//   speak true      his words go to the output bus as `say`. Mike's ask was that somebody who
//                   cannot read the bubble hears them. The PERSON'S output routing still decides
//                   whether `say` becomes speech on that screen; this is only whether he asks.
//   follow true     he notices a step you have done and moves on. Off, he waits for Next.
//   restMinutes 10  nobody touching the page for this long closes him (0 = never). Long enough to
//                   read, choose a photo and come back; short enough that a walk abandoned on a
//                   screen somebody watches does not sit there all night. Re-opening is one press.
export const DEFAULT_CAT_PREFS = Object.freeze({ chat: 'some', speak: true, follow: true, restMinutes: 10 });
export const REST_CHOICES = Object.freeze([0, 5, 10, 30]);

export const POSES = Object.freeze(['idle', 'wave', 'talking', 'thinking', 'happy',
  'point-up', 'point-down', 'point-left', 'point-right']);

// HIS SIZE, 84px: big enough that which way the paw points reads at a glance, small enough that the
// bubble stays one short band across a phone. A host may pass `size`; it is not a person's setting
// because nothing about it is a preference anybody has asked for — say so if that changes.
export const CAT_SIZE_PX = 84;

export const catAssetBase = () => new URL('./design-assets/nimrod-cat/', import.meta.url).href;
export const catImageURL = (pose, animated = false, base = catAssetBase()) =>
  `${base}${pose}${animated ? '-animated' : ''}.svg`;

const hasStorage = () => typeof localStorage !== 'undefined';

/** The person's cat settings, every field validated and defaulted. Never throws. */
export function readCatPrefs(storage = (hasStorage() ? localStorage : null)) {
  let raw = {};
  try { raw = JSON.parse(storage?.getItem(CAT_PREFS_KEY) || '{}') || {}; } catch { raw = {}; }
  const out = { ...DEFAULT_CAT_PREFS };
  if (CHATTINESS.some((c) => c.value === raw.chat)) out.chat = raw.chat;
  if (typeof raw.speak === 'boolean') out.speak = raw.speak;
  if (typeof raw.follow === 'boolean') out.follow = raw.follow;
  if (Number.isFinite(raw.restMinutes) && raw.restMinutes >= 0) out.restMinutes = raw.restMinutes;
  return out;
}

export function writeCatPrefs(storage = (hasStorage() ? localStorage : null), patch = {}) {
  const next = { ...readCatPrefs(storage), ...patch };
  try { storage?.setItem(CAT_PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return readCatPrefs({ getItem: () => JSON.stringify(next) });
}

/** A step's words at a chattiness level. */
export function catWords(step, chat = DEFAULT_CAT_PREFS.chat) {
  if (!step) return '';
  if (chat === 'few') return step.brief || step.say || '';
  if (chat === 'lots') return [step.say, step.more].filter(Boolean).join(' ');
  return step.say || step.brief || '';
}

/** Which way to point from `from` (his picture) to `to` (the ring). Vertical wins a tie. */
export function poseToward(from, to) {
  if (!from || !to) return 'talking';
  const cx = (r) => r.left + (r.width || 0) / 2;
  const cy = (r) => r.top + (r.height || 0) / 2;
  const dx = cx(to) - cx(from), dy = cy(to) - cy(from);
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'point-up' : 'point-down';
  return dx < 0 ? 'point-left' : 'point-right';
}

/** Begin (or begin again) the walk. What "Show me how", or a quest step, calls. */
export const startCat = (steps, storage = (hasStorage() ? localStorage : null)) =>
  startTour(steps, storage, { keys: CAT_KEYS });
export const catStarted = (storage = (hasStorage() ? localStorage : null)) =>
  tourStarted(storage, { keys: CAT_KEYS });
export const resetCat = (storage = (hasStorage() ? localStorage : null)) =>
  resetTour(storage, { keys: CAT_KEYS });

// Fetch an animated pose as text. Same origin, our own vetted files (see ATTRIBUTIONS.md and the
// suite's asset check); `inlineSvg` below still strips anything active, because an inlined SVG is
// part of the page and "we checked it once" is not a guard.
const defaultLoadSvg = (url) => fetch(url).then((r) => (r.ok ? r.text() : null));

function inlineSvg(doc, text) {
  if (!text || !doc?.defaultView?.DOMParser) return null;
  const parsed = new doc.defaultView.DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
  svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href') && !a.value.startsWith('#')) el.removeAttribute(a.name);
    }
  }
  return doc.importNode(svg, true);
}

/**
 * Mount the cat on this page. Returns null unless a walk was started in this browser (or `start`
 * is passed — the "Show me how" press itself), so a host may call it unconditionally.
 *
 *   steps      the walk (`game/cat_steps.js`)
 *   path       which page this is, as the steps name pages
 *   output     the page's output bus (`createOutputBus`); his words go to its `say`
 *   goThere    (page) -> { say, label, href } for the link when the next step is elsewhere
 *   holdBar    (on) -> void: keep the host's transport bar on screen (true) or let it go (false).
 *              Called only on a change. The kiosk passes its handle's `holdBar`; elsewhere omit it.
 *   barSelector  what "inside the bar" means for `holdBar`: the kiosk's `[data-controls]`.
 */
export function mountCat(root, {
  steps = [],
  path = (typeof location !== 'undefined' ? location.pathname : '/'),
  storage = (hasStorage() ? localStorage : null),
  doc = (typeof document !== 'undefined' ? document : null),
  output = null,
  bus = null,
  start = false,
  requireStarted = true,
  reducedMotion = null,          // null = ask the system, and keep asking
  goThere = null,
  holdBar = null,
  barSelector = '[data-controls]',
  onFinish = null,
  onStep: hostOnStep = null,
  loadSvg = defaultLoadSvg,
  assetBase = catAssetBase(),
  size = CAT_SIZE_PX,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!root || !doc) return null;
  const win = doc.defaultView || null;

  // ALREADY THERE. The walk was sending somebody to this page and they came by another way (the
  // profile opened from Home, say, while the cat still pointed at the game page's buttons). Jump
  // FORWARD to this page's first step after the saved one; never backward, never on a fresh start.
  if (!start) {
    try {
      const all = allTourSteps(steps);
      const saved = storage?.getItem(CAT_KEYS.pos);
      const si = all.findIndex((s) => s.id === saved);
      if (si >= 0 && !storage?.getItem(CAT_KEYS.done) && !samePage(all[si].page, path)) {
        const j = all.findIndex((s, k) => k > si && samePage(s.page, path));
        if (j >= 0) storage?.setItem(CAT_KEYS.pos, all[j].id);
      }
    } catch { /* private mode: the walk resumes where it was, which is the old behaviour */ }
  }

  let prefs = readCatPrefs(storage);
  let reduced = reducedMotion == null ? mqReduced(win) : !!reducedMotion;
  let fig = null;
  let pose = null;
  let curStep = null;
  let curWaiting = false;
  let lastSaid = null;
  let finished = false;
  let rested = false;
  let restTimer = null;
  let handle = null;
  let backedTo = null;           // the step Back brought him to: not auto-skipped while he is on it
  let barHeld = false;
  const svgCache = new Map();
  const offs = [];

  const matches = (sel) => { try { return !!doc.querySelector(sel); } catch { return false; } };

  // ---- his picture ---------------------------------------------------------------------------
  function ensureMotionCss() {
    if (!doc.head || doc.head.querySelector('link[data-cat-motion]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${assetBase}motion.css`;
    link.setAttribute('data-cat-motion', '');
    doc.head.append(link);
  }

  function loadPose(p) {
    if (!svgCache.has(p)) {
      svgCache.set(p, Promise.resolve().then(() => loadSvg(catImageURL(p, true, assetBase))).catch(() => null));
    }
    return svgCache.get(p);
  }

  // REDUCED MOTION USES THE STILL DRAWING, full stop — not the animated one with its animations
  // switched off by `motion.css`'s own guard (which it also has). The still is shown first in every
  // case, so the cat is never blank while the animated one loads, or if it never does.
  function setPose(p, force = false) {
    if (!fig || (!force && p === pose)) return;
    pose = p;
    fig.dataset.pose = p;
    const img = doc.createElement('img');
    img.src = catImageURL(p, false, assetBase);
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;display:block';
    fig.replaceChildren(img);
    fig.dataset.motion = 'still';
    if (reduced) return;
    ensureMotionCss();
    const f = fig;
    loadPose(p).then((text) => {
      if (finished || reduced || pose !== p || f !== fig) return;
      const svg = inlineSvg(doc, text);
      if (!svg) return;
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('aria-hidden', 'true');
      svg.removeAttribute('role');
      f.replaceChildren(svg);
      f.dataset.motion = 'animated';
    });
  }

  function basePose(step, waiting) {
    if (waiting) return 'idle';
    if (step?.pose && step.pose !== 'point') return step.pose;
    return 'talking';
  }

  // ---- the panel -------------------------------------------------------------------------------
  function decorate(panel, step, { waiting }) {
    curStep = step;
    curWaiting = waiting;
    panel.setAttribute('data-cat', '');
    const body = doc.createElement('div');
    body.setAttribute('data-cat-body', '');
    body.style.cssText = 'min-width:0;flex:1';
    while (panel.firstChild) body.append(panel.firstChild);
    fig = doc.createElement('div');
    fig.setAttribute('data-cat-figure', '');
    fig.setAttribute('aria-hidden', 'true');   // decoration: the words beside him are the content
    fig.className = 'nimrod-cat';
    fig.style.cssText = `flex:none;width:${size}px;height:${size}px`;
    panel.append(fig, body);
    setPose(basePose(step, waiting), true);

    // HOW CHATTY — right where it matters, one press each, so a switch can reach it too.
    const rowEl = body.querySelector('[data-tour-row]');
    const skipBtn = rowEl?.querySelector('[data-tour-skip]');
    if (rowEl && skipBtn) {
      const lvl = CHATTINESS.find((c) => c.value === prefs.chat) || CHATTINESS[1];
      const chat = doc.createElement('button');
      chat.type = 'button';
      chat.setAttribute('data-cat-chat', '');
      chat.title = 'How much Nimrod says. Press to change.';
      chat.textContent = `Words: ${lvl.label}`;
      chat.style.cssText = skipBtn.style.cssText;
      chat.addEventListener('click', () => cycleChat());
      rowEl.insertBefore(chat, skipBtn);
    }
  }

  // ---- holding the bar -------------------------------------------------------------------------
  // Worked out from the element the step actually resolves to, not from the step's id: a step whose
  // target is a list points at a row in the open menu (not the bar: let go) or at the gear when the
  // menu is shut (the bar: hold), and this follows that as it changes. The element, not the ring:
  // Panel ▸ has no size when a screen has one panel, and the bar still has to show for that step.
  function setHold(on) {
    if (on === barHeld || typeof holdBar !== 'function') return;
    barHeld = on;
    try { holdBar(on); } catch (err) { console.error('cat: holdBar', err); }
  }
  function updateHold() {
    if (finished || curWaiting || !curStep?.target) { setHold(false); return; }
    let inBar = false;
    try { inBar = !!findTarget(doc, curStep.target)?.closest?.(barSelector); } catch { inBar = false; }
    setHold(inBar);
  }

  function onPlace(rect) {
    updateHold();
    if (!fig || !curStep || curWaiting) return;
    if (curStep.pose && curStep.pose !== 'point') return;
    if (!curStep.target || !rect) { setPose('talking'); return; }
    setPose(poseToward(fig.getBoundingClientRect(), rect));
  }

  // ---- his voice -------------------------------------------------------------------------------
  function hush() {
    if (lastSaid != null) { try { output?.cancel?.(lastSaid); } catch { /* already said */ } }
    lastSaid = null;
  }
  function speak(text) {
    // The words that were superseded are taken back first: a new step must not queue behind the
    // last one's sentence, which would leave him describing a button the person already pressed.
    hush();
    if (!prefs.speak || !text || typeof output?.say !== 'function') return;
    try { lastSaid = output.say(text, { source: CAT_SOURCE }); } catch (err) { console.error('cat: say', err); }
  }

  function onStep(step, n, info) {
    try { hostOnStep?.(step, n, info); } catch (err) { console.error('cat: onStep', err); }
    resetRest();
    // Reached by Back: he stays on it even if it is done — going back to look is the point.
    // (A repaint keeps `via`, so changing his chattiness on that step does not skip it either.)
    backedTo = info.via === 'back' ? step : null;
    // Done already (the profile was made last week): move on without saying it. After the tour
    // has finished rendering, never from inside its render.
    if (!info.waiting && prefs.follow && step !== backedTo && step.doneWhen && matches(step.doneWhen)) {
      Promise.resolve().then(() => { if (!finished && handle && handle.step() === step && !handle.waiting()) handle.next(); });
      return;
    }
    speak(info.text);
  }

  function cycleChat() {
    const i = CHATTINESS.findIndex((c) => c.value === prefs.chat);
    setPrefs({ chat: CHATTINESS[(i + 1) % CHATTINESS.length].value });
  }

  function setPrefs(patch) {
    prefs = writeCatPrefs(storage, patch);
    resetRest();
    if (!finished) handle?.repaint();
    return { ...prefs };
  }

  // ---- resting -----------------------------------------------------------------------------------
  function resetRest() {
    if (restTimer != null) { clearTimer(restTimer); restTimer = null; }
    if (finished || !(prefs.restMinutes > 0)) return;
    restTimer = setTimer(() => {
      restTimer = null;
      if (finished) return;
      rested = true;
      handle?.skip();
    }, prefs.restMinutes * 60000);
  }

  function cleanup() {
    if (restTimer != null) { clearTimer(restTimer); restTimer = null; }
    offs.splice(0).forEach((f) => { try { f(); } catch { /* already gone */ } });
    hush();
    // Every way he leaves comes through here, so this is the one place the bar is let go.
    setHold(false);
  }

  handle = mountTour(root, {
    steps, path, storage, doc, bus, start, requireStarted, reducedMotion,
    keys: CAT_KEYS,
    topic: CAT_TOPIC,
    label: 'Nimrod the cat',
    skipLabel: 'Close',
    escapeCloses: true,
    backButton: true,
    goThere,
    // A set width, not just a cap: a fixed box at left:50% otherwise shrinks to the half of the
    // screen to its right, and the bubble came out a tall narrow column.
    panelStyle: 'display:flex;gap:14px;align-items:center;width:min(62ch,94vw);max-width:94vw',
    sayFor: (step) => catWords(step, prefs.chat),
    decorate,
    onPlace,
    onStep,
    onFinish: (reason) => {
      finished = true;
      cleanup();
      try { onFinish?.(rested ? 'rested' : reason); } catch (err) { console.error('cat: onFinish', err); }
    },
  });
  if (!handle) { finished = true; cleanup(); return null; }

  // ---- following along ----------------------------------------------------------------------------
  // Something on the page changed (the menu opened, a step's button went to "done", the bar came
  // back): re-measure the ring and, if this step is now done, move on. Changes inside his own panel
  // are ignored — re-drawing the panel is a change, and reacting to it would loop.
  let pending = null;
  function check() {
    pending = null;
    if (finished || !handle) return;
    const step = handle.step();
    if (!handle.waiting() && prefs.follow && step !== backedTo && step?.doneWhen && matches(step.doneWhen)) {
      handle.next(); return;
    }
    handle.refresh();
  }
  const MO = win?.MutationObserver;
  if (MO) {
    const obs = new MO((records) => {
      if (finished || !handle) return;
      if (records.every((r) => handle.el.contains(r.target))) return;
      if (pending == null) pending = setTimer(check, 80);
    });
    obs.observe(doc.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'data-done', 'aria-disabled', 'data-focused', 'open'],
    });
    offs.push(() => obs.disconnect());
    offs.push(() => { if (pending != null) { clearTimer(pending); pending = null; } });
  }

  // Pressing a step's own target, where that leaves the page. Capture, and synchronous, so the
  // position is written before the browser follows the link.
  const onClick = (e) => {
    if (finished || !handle || handle.waiting()) return;
    const step = handle.step();
    if (step?.advanceOn !== 'click') return;
    const el = findTarget(doc, step.target);
    if (!el || !el.contains(e.target)) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    handle.next();
  };
  doc.addEventListener('click', onClick, true);
  offs.push(() => doc.removeEventListener('click', onClick, true));

  // Anybody touching the page is somebody there: the rest clock starts again.
  if (win?.addEventListener) {
    const poke = () => resetRest();
    for (const ev of ['pointerdown', 'keydown']) {
      win.addEventListener(ev, poke, { capture: true, passive: true });
      offs.push(() => win.removeEventListener(ev, poke, { capture: true, passive: true }));
    }
    // Follow the system's reduced-motion setting live, like the tour's ring does.
    if (reducedMotion == null) {
      try {
        const mq = win.matchMedia?.('(prefers-reduced-motion: reduce)');
        const onMq = (e) => { reduced = !!e.matches; if (pose) setPose(pose, true); };
        mq?.addEventListener?.('change', onMq);
        if (mq?.removeEventListener) offs.push(() => mq.removeEventListener('change', onMq));
      } catch { /* no matchMedia: whatever was read at mount stands */ }
    }
  }

  return {
    el: handle.el,
    next: () => handle.next(),
    prev: () => handle.prev(),
    close: () => handle.skip(),
    step: () => handle.step(),
    index: () => handle.index(),
    total: handle.total,
    waiting: () => handle.waiting(),
    shown: () => handle.shown(),
    refresh: () => handle.refresh(),
    check,
    pose: () => pose,
    motion: () => fig?.dataset.motion || null,
    reduced: () => reduced,
    prefs: () => ({ ...prefs }),
    setPrefs,
    lastSaid: () => lastSaid,
    // Tearing a page down is not closing him: the walk carries on on the next page.
    destroy() { if (finished) return; finished = true; cleanup(); handle.destroy(); },
  };
}

function mqReduced(win) {
  try { return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}
