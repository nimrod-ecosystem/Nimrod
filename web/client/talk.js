// talk.js — THE BOARD, ON ITS OWN, WITH NOTHING IN FRONT OF IT.
//
// `/talk.html` is the communication board as a whole page: no sign-in, no account, no screen
// to compose first, nothing to set up. Open the link on a phone or a tablet and you are
// talking.
//
// ---------------------------------------------------------------------------------------
// WHY THIS IS A PAGE AND NOT "JUST USE THE KIOSK"
// ---------------------------------------------------------------------------------------
//
// The kiosk is the right surface for a screen somebody LIVES at — a profile, a layout, a
// theme, panels that remember things. Every one of those is a reason it cannot be handed to
// somebody in a room in the next thirty seconds:
//
//   * `kiosk.html` needs a session or a device key. Signing in with Google on a Fire tablet's
//     browser, at a bedside, is not a thing that happens.
//   * It needs a profile with a screen on it, which means somebody has been to the composer
//     on a desktop first.
//   * It hardcodes a near-black page background and pairs it with `--ink`, which is a dark
//     colour in four of the five themes — the measured contrast defect in `MIKE_CHANGE_LIST`
//     §B6. A board is the last surface that should inherit that.
//
// So: a static page, served by the same server as everything else, with no API call in its
// path at all. It cannot be broken by a database, an expired cookie or a deploy of the
// backend. **The failure mode of a talking aid should not include "the server was down."**
//
// ---------------------------------------------------------------------------------------
// IT SAYS THINGS IN THE ROOM. IT DOES NOT SUMMON ANYBODY.
// ---------------------------------------------------------------------------------------
//
// Same boundary as `modules/board.js`, restated here because this page is the one somebody
// would be tempted to give a phone number to. Selections speak, and stop. Nothing is sent
// anywhere. `PRINCIPLES.md` §2 carries the full statement.
//
// ---------------------------------------------------------------------------------------
// NOTHING LEAVES THE DEVICE
// ---------------------------------------------------------------------------------------
//
// Settings and the selection log live in `localStorage` and are never posted. That is partly
// because there is nobody to post them AS on a page with no sign-in — and partly because it
// is the direction Mike set for recording generally (F10, F20: *"Does it have to go to the
// server if it's saving locally?"*). This page is the first thing in the repo that is
// local-first by construction rather than by intention, and it is a small enough surface to
// be the place that shape gets tried.
//
// The log is capped and is a ring: it exists so somebody can find out whether the board is
// working — which words get used, which never do — and it is never shown to the person using
// the board. See the header of `modules/board.js` on why.

import { createBus } from './bus.js';
import { mountModule } from './module.js';
import { createAim, AIM_TOPIC } from './aim.js';
import { mountCursor, CURSOR_DEFAULTS, STYLES, SIZE_MIN, SIZE_MAX, SIZE_STEP } from './cursor.js';
import { createDwell, DWELL_DEFAULTS } from './input_dwell.js';
import { SCAN_DEFAULTS } from './input_scan.js';
import { speak, waitForVoices, listVoices } from './voice.js';
import { BOARD_TOPIC } from './modules/board.js';
import './modules/board.js';

const STORE_KEY = 'nimrod.talk.v1';
const LOG_KEY = 'nimrod.talk.log.v1';
const LOG_CAP = 500;

// ---------------------------------------------------------------------------------------
// THE NUMBERS, AND WHY EACH ONE IS WHERE IT IS
// ---------------------------------------------------------------------------------------
//
// Ranges rather than stops, because the two numbers a caregiver actually needs to change —
// scan speed and dwell time — are the two that have to be adjusted with the person in front
// of the screen, and a set of named stops always turns out to have the right value between
// two of them.
export const SCAN_MIN = 1000, SCAN_MAX = 60000, SCAN_STEP = 500;
export const DWELL_MIN = 300, DWELL_MAX = 6000, DWELL_STEP = 100;

export const DEFAULTS = {
  // *** YES / NO / OTHER FIRST. *** Mike, 2026-09-03: *"yes/no/other first, then the 4x4."*
  // It is also the honest starting point for somebody who has never used a board: three
  // enormous targets and an escape from a forced choice, which is what the third card is for
  // (see `aac_vocab.js`). The 4x4 is one tap away and there is a link straight to it.
  boardId: 'yesno',

  // Contrast. The board carries its own dark palette and every value on it clears the WCAG
  // floor (§F7-numbers), so this starts off; it is here because the person who needs 21:1
  // needs it immediately and should not have to find a menu.
  highContrast: false,

  // Scanning, off. Most people who use a board touch it, and turning the scan on for
  // everybody turns a board that answers a tap into one that answers a tap eventually.
  scan: false,
  stepMs: SCAN_DEFAULTS.stepMs,        // 15s — carried from the bedside build, not chosen here
  reveal: 'all',

  // Dwell, off, and the reason it is off is stronger than "most people do not need it": on a
  // touchscreen a tap already selects, so with both on the dwell clock never gets to finish.
  // Turning dwell on therefore turns TAP-TO-SELECT OFF by default (`tapSelects` below), which
  // is a real change to how the screen behaves and not something to do to somebody quietly.
  dwell: false,
  dwellMs: DWELL_DEFAULTS.dwellMs,     // 1800ms — the bedside build's number
  dwellRadius: DWELL_DEFAULTS.radius,  // 70px of allowed wander
  tapSelects: true,

  // The cursor. `tracking` means it is drawn only when something other than a mouse is
  // aiming — see `cursor.js`. On this page a finger is not a mouse, so a touch DOES draw it,
  // which is what somebody watching from across the room wants to see.
  cursorShow: 'tracking',
  cursorStyle: CURSOR_DEFAULTS.style,
  cursorSize: CURSOR_DEFAULTS.size,
  cursorColor: CURSOR_DEFAULTS.color,

  // *** THE WORD, WRITTEN BIG, WHENEVER A CARD IS CHOSEN. DEFAULT ON. ***
  //
  // Because the speech may not arrive. Web Speech voices are per-device, and a Fire tablet or
  // a Pi can have none installed at all — the private build ships recorded audio for exactly
  // this reason, and this page has no audio to ship. A board that is silently silent has told
  // nobody anything. A board that also writes the word across the top has still said it, to
  // whoever is in the room, which is the entire audience.
  //
  // It times out on its own and never takes a tap, so it cannot become something a person has
  // to dismiss.
  sayBanner: true,
  speakAloud: true,
  rate: 1,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);

// ---------------------------------------------------------------------------------------
// STORAGE — and every read of it is allowed to fail
// ---------------------------------------------------------------------------------------
//
// A private window, a browser with site data blocked, a Fire tablet in a restricted profile:
// `localStorage` throws on ACCESS in some of these, not just on write. A board that refused to
// render because it could not save a preference would be the worst possible trade, so every
// path here degrades to "this session only" and the page carries on.
function readStore(key, dflt) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return dflt;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : dflt;
  } catch { return dflt; }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** URL overrides, so one bookmark can be a whole configuration. */
export function fromQuery(search, base = DEFAULTS) {
  const q = new URLSearchParams(search || '');
  const out = {};
  const on = (s) => s === '1' || s === 'true' || s === 'yes' || s === 'on';
  const has = (k) => q.has(k) && q.get(k) !== '';
  if (has('board')) out.boardId = q.get('board') === 'care' ? 'care' : 'yesno';
  if (has('hc')) out.highContrast = on(q.get('hc'));
  if (has('scan')) out.scan = on(q.get('scan'));
  if (has('step')) out.stepMs = clamp(num(q.get('step'), base.stepMs), SCAN_MIN, SCAN_MAX);
  if (has('dwell')) out.dwell = on(q.get('dwell'));
  if (has('dwellms')) out.dwellMs = clamp(num(q.get('dwellms'), base.dwellMs), DWELL_MIN, DWELL_MAX);
  if (has('cursor')) out.cursorSize = clamp(num(q.get('cursor'), base.cursorSize), SIZE_MIN, SIZE_MAX);
  if (has('tap')) out.tapSelects = on(q.get('tap'));
  if (has('quiet')) out.speakAloud = !on(q.get('quiet'));
  return out;
}

/** Bring anything stored or asked for into range, so nothing downstream has to re-check. */
export function normalizeCfg(raw) {
  const c = { ...DEFAULTS, ...(raw || {}) };
  c.boardId = c.boardId === 'care' ? 'care' : 'yesno';
  c.stepMs = clamp(num(c.stepMs, DEFAULTS.stepMs), SCAN_MIN, SCAN_MAX);
  c.dwellMs = clamp(num(c.dwellMs, DEFAULTS.dwellMs), DWELL_MIN, DWELL_MAX);
  c.dwellRadius = clamp(num(c.dwellRadius, DEFAULTS.dwellRadius), 10, 400);
  c.cursorSize = clamp(num(c.cursorSize, DEFAULTS.cursorSize), SIZE_MIN, SIZE_MAX);
  if (!STYLES.includes(c.cursorStyle)) c.cursorStyle = CURSOR_DEFAULTS.style;
  if (!['tracking', 'always', 'never'].includes(c.cursorShow)) c.cursorShow = 'tracking';
  if (!['all', 'one'].includes(c.reveal)) c.reveal = 'all';
  c.rate = clamp(num(c.rate, 1), 0.5, 2);
  ['highContrast', 'scan', 'dwell', 'tapSelects', 'sayBanner', 'speakAloud']
    .forEach((k) => { c[k] = !!c[k]; });
  return c;
}

// ---------------------------------------------------------------------------------------
// THE STATE HANDLE THE BOARD MODULE SEES
// ---------------------------------------------------------------------------------------
//
// `modules/board.js` expects the same `{ get, set, subscribe }` every module gets from the
// host. It is given a VIEW of this page's settings rather than a store of its own, so there
// is exactly one saved object and no way for the board's idea of `highContrast` and the
// sheet's idea of it to drift apart.
export function boardStateFrom(getCfg, onSet) {
  const subs = new Set();
  return {
    get: () => {
      const c = getCfg();
      return {
        boardId: c.boardId, scan: c.scan, stepMs: c.stepMs, reveal: c.reveal,
        highContrast: c.highContrast, followTheme: false, tapSelects: c.tapSelects,
      };
    },
    set: (patch) => onSet(patch),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    flush: () => {},
    // The host calls this after it has changed the settings, so the module re-reads.
    notify: () => subs.forEach((f) => { try { f(); } catch (err) { console.error('talk: sub', err); } }),
  };
}

/** A capped, local-only ring of what was chosen. Never posted, never shown on this screen. */
export function localEvents(read = readStore, write = writeStore) {
  return {
    append(kind, data) {
      try {
        const rows = read(LOG_KEY, { rows: [] }).rows || [];
        rows.push({ kind, ...data });
        // A RING, not an unbounded list: this page can be open for weeks on a tablet by a
        // bed, and a log that grows forever eventually fills the origin's quota and then
        // every write fails — including, on some browsers, the settings write next to it.
        while (rows.length > LOG_CAP) rows.shift();
        write(LOG_KEY, { rows });
      } catch (err) { console.error('talk: log', err); }
      return Promise.resolve();
    },
    // `read` and `clear` catch for the same reason `append` does, and it is not belt-and-
    // braces: the store is INJECTED, so "the default one already swallows errors" is a fact
    // about one caller rather than about this function. A suite passing a store that throws
    // found this immediately, which is what a suite is for.
    read() {
      try { return read(LOG_KEY, { rows: [] }).rows || []; }
      catch { return []; }
    },
    clear() {
      try { return write(LOG_KEY, { rows: [] }); }
      catch { return false; }
    },
  };
}

// ---------------------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------------------

export function startTalk({
  root = document.getElementById('board'),
  bannerEl = document.getElementById('say'),
  toastEl = document.getElementById('toast'),
  cursorRoot = document.getElementById('cursorlayer'),
  sheetEl = document.getElementById('sheet'),
  openEl = document.getElementById('open'),
  view = window,
  doc = document,
} = {}) {
  let cfg = normalizeCfg({ ...readStore(STORE_KEY, {}), ...fromQuery(view.location?.search) });

  const bus = createBus();
  const aim = createAim({ bus });
  const events = localEvents();
  let voicePref = { rate: cfg.rate };

  const state = boardStateFrom(() => cfg, (patch) => { save(patch); });

  // The keys the board module actually reads. Anything else — the cursor, the banner, the
  // voice — is the shell's, and telling the board about it would make it rebuild all sixteen
  // cards to answer a question it was not asked. That matters while a slider is being
  // dragged: a redraw per pixel also restarts the scan at card one, every pixel.
  const BOARD_KEYS = ['boardId', 'scan', 'stepMs', 'reveal', 'highContrast', 'tapSelects'];
  const touchesBoard = (patch) => Object.keys(patch || {}).some((k) => BOARD_KEYS.includes(k));

  function save(patch) {
    cfg = normalizeCfg({ ...cfg, ...patch });
    // The query string is a one-shot: it sets up this visit, and what gets stored is the
    // result. Otherwise a bookmarked `?scan=1` would silently undo every later change.
    writeStore(STORE_KEY, cfg);
    if (touchesBoard(patch)) state.notify();
    applyShell();
    renderSheet();
  }

  // ---- the board -------------------------------------------------------------------
  const inst = mountModule('board', {
    mount: root, bus, state, events, view,
    // The board asks its host to speak rather than reaching for a synthesiser, which is what
    // lets this page put the word on screen as well — and lets a device with no voice at all
    // still communicate.
    output: { say: (text) => sayIt(text) },
  });
  inst.init();

  // ---- speech, and the visible fallback ---------------------------------------------
  let bannerTimer = null;
  function sayIt(text) {
    const word = String(text == null ? '' : text);
    if (!word) return;
    if (cfg.speakAloud) {
      try { speak(word, voicePref); } catch (err) { console.error('talk: speak', err); }
    }
    if (cfg.sayBanner && bannerEl) {
      bannerEl.textContent = word;
      bannerEl.hidden = false;
      bannerEl.dataset.on = '1';
      clearTimeout(bannerTimer);
      // It goes away by itself. Nothing on this page may need an input in order to stop.
      bannerTimer = setTimeout(() => { bannerEl.dataset.on = ''; }, 1600);
    }
  }

  // ---- the cursor -------------------------------------------------------------------
  const cursor = cursorRoot ? mountCursor(cursorRoot, {
    bus, aim,
    settings: () => ({
      show: cfg.cursorShow, style: cfg.cursorStyle,
      size: cfg.cursorSize, color: cfg.cursorColor,
      // The system pointer stays. Somebody testing this on a desktop with a mouse should not
      // lose their pointer to a page they opened to look at a board.
      hideSystem: false,
    }),
  }) : null;

  // ---- where the aim is, and the dwell on top of it ----------------------------------
  //
  // A finger is reported as its own device rather than as `pointer:mouse`, which is what makes
  // the cursor appear for a touch under the default `tracking` setting. It is also true: a
  // touch is not a mouse, and the difference matters to anything downstream that wants to know
  // whether the operating system is already drawing a pointer.
  const deviceFor = (e) => (e.pointerType === 'mouse' ? 'pointer:mouse' : `pointer:${e.pointerType || 'touch'}`);
  const onPointer = (e) => { try { aim.reportEvent(deviceFor(e), e, view); } catch { /* off-screen */ } };
  root.addEventListener('pointermove', onPointer, { passive: true });
  root.addEventListener('pointerdown', onPointer, { passive: true });
  // A finger LEAVING the glass is not the same as a finger resting still. Without this the
  // last position stays live and a dwell would keep counting on a screen nobody is touching.
  const onPointerGone = () => { try { bus.publish(AIM_TOPIC, null); } catch { /* never fatal */ } };
  root.addEventListener('pointerup', onPointerGone, { passive: true });
  root.addEventListener('pointercancel', onPointerGone, { passive: true });

  // Feed the board's hit-test. The board owns its own rectangles — see `aimAt` in board.js.
  bus.subscribe(AIM_TOPIC, (a) => bus.publish('board/aim', a));

  const dwell = createDwell({
    bus,
    settings: () => ({
      enabled: cfg.dwell, dwellMs: cfg.dwellMs, radius: cfg.dwellRadius,
      leaveFactor: DWELL_DEFAULTS.leaveFactor,
    }),
    onProgress: (p) => { cursor?.progress?.(cfg.dwell ? p : 0); },
    onFire: () => { bus.publish('board/select', {}); },
    viewport: () => ({ w: view.innerWidth || 1, h: view.innerHeight || 1 }),
  });

  // *** A SELECTION MADE ANY OTHER WAY ARMS THE DWELL'S OWN GUARD. ***
  // Otherwise a tap chooses the card, the finger stays where it is, and the dwell clock runs
  // out a moment later and chooses it again — the word said twice, logged twice. See
  // `holdOff` in input_dwell.js.
  bus.subscribe(BOARD_TOPIC, () => { try { dwell.holdOff(); } catch { /* never fatal */ } });

  // ---- keys: the stopgap that makes the two live numbers adjustable in the room ------
  //
  // The settings sheet below is the real answer on a tablet, and it is what Mike will use.
  // These exist because a screen can also be a kiosk with a keyboard or a switch interface
  // wired to keys and no touch at all, and *scanning that cannot be slowed down in the room is
  // scanning that does not work.* Every one of them says out loud what it just did, because a
  // number you changed and cannot see is a number you have to change twice.
  const KEYS = [
    ['s', 'scanning on / off', () => { save({ scan: !cfg.scan }); toast(`Scanning ${cfg.scan ? 'ON' : 'off'}`); }],
    ['d', 'dwell on / off', () => { setDwell(!cfg.dwell); }],
    ['-', 'scan step shorter', () => bumpScan(-1)],
    ['=', 'scan step longer', () => bumpScan(1)],
    ['_', 'scan step shorter', () => bumpScan(-1)],
    ['+', 'scan step longer', () => bumpScan(1)],
    [';', 'dwell shorter', () => bumpDwell(-1)],
    ["'", 'dwell longer', () => bumpDwell(1)],
    ['[', 'cursor smaller', () => bumpCursor(-1)],
    [']', 'cursor bigger', () => bumpCursor(1)],
    ['b', 'switch board', () => { save({ boardId: cfg.boardId === 'care' ? 'yesno' : 'care' }); toast(cfg.boardId === 'care' ? 'Care board' : 'Yes / No / Other'); }],
    ['k', 'high contrast', () => { save({ highContrast: !cfg.highContrast }); toast(`High contrast ${cfg.highContrast ? 'ON' : 'off'}`); }],
    ['m', 'open or close settings', () => toggleSheet()],
    ['f', 'full screen', () => toggleFullscreen()],
  ];
  const KEYMAP = new Map(KEYS.map(([k, , fn]) => [k, fn]));

  function bumpScan(dir) {
    save({ stepMs: clamp(cfg.stepMs + dir * SCAN_STEP, SCAN_MIN, SCAN_MAX) });
    toast(`Scan step ${(cfg.stepMs / 1000).toFixed(1)}s`);
  }
  function bumpDwell(dir) {
    save({ dwellMs: clamp(cfg.dwellMs + dir * DWELL_STEP, DWELL_MIN, DWELL_MAX) });
    toast(`Dwell ${(cfg.dwellMs / 1000).toFixed(1)}s`);
  }
  function bumpCursor(dir) {
    save({ cursorSize: clamp(cfg.cursorSize + dir * SIZE_STEP * 3, SIZE_MIN, SIZE_MAX) });
    cursor?.refresh?.();
    toast(`Cursor ${cfg.cursorSize}px`);
  }
  // Turning dwell on turns tap-to-select off, because a tap fires first and would make the
  // dwell unreachable. Turning it back off restores the tap — a caregiver who tries dwell and
  // decides against it must not be left with a board that no longer answers a finger.
  function setDwell(on) {
    save({ dwell: !!on, tapSelects: !on });
    cursor?.progress?.(0);
    toast(on ? `Dwell ON — hold still ${(cfg.dwellMs / 1000).toFixed(1)}s. Tap is off.`
             : 'Dwell off. Tap chooses again.');
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === ' ' || e.key === 'Enter') { bus.publish('board/select', {}); e.preventDefault(); return; }
    if (e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      bus.publish('board/next', {}); e.preventDefault(); return;
    }
    if (e.key === 'Escape') { closeSheet(); return; }
    const fn = KEYMAP.get(e.key) || KEYMAP.get(String(e.key).toLowerCase());
    if (fn) { fn(); e.preventDefault(); }
  }
  view.addEventListener('keydown', onKey);

  // ---- a toast, because a change you cannot see is a change you make twice -----------
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.dataset.on = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.dataset.on = ''; }, 2200);
  }

  // ---- full screen and staying awake --------------------------------------------------
  async function toggleFullscreen() {
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await doc.documentElement.requestFullscreen?.();
    } catch { toast('This browser would not go full screen'); }
  }
  // A tablet that sleeps in the middle of a conversation is a tablet that stopped being a
  // talking aid. Requested on the first real interaction because every browser requires a
  // gesture, re-requested after a visibility change because the lock is dropped when the page
  // is hidden. Entirely best-effort: nothing here fails if the API is absent, which it is on
  // plenty of the devices this will land on.
  let lock = null;
  async function keepAwake() {
    try {
      if (!navigator.wakeLock || lock) return;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener?.('release', () => { lock = null; });
    } catch { lock = null; }
  }
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) keepAwake(); });
  root.addEventListener('pointerdown', keepAwake, { once: false, passive: true });

  // ---- the caregiver sheet -------------------------------------------------------------
  //
  // *** IT OPENS ON A PRESS AND HOLD, NOT A TAP. ***
  //
  // The button is small and in a corner, which is not enough on its own: the person this page
  // is for may drag a hand across the screen, and a corner is exactly where a hand lands when
  // somebody steadies themselves. A hold is deliberate in a way a brush is not, and it is a
  // gesture a caregiver can be told about in one sentence.
  //
  // It is an ENTRANCE, not a gate. Nothing waits on it, nothing is blocked by it, and the
  // board carries on behind it — so the question `CLAUDE.md` asks of anything that waits for
  // an input ("what happens if nobody answers?") has the right answer here: nothing happens,
  // and the board keeps working.
  let holdTimer = null;
  function armOpen(e) {
    e.preventDefault();
    openEl.dataset.holding = '1';
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { openEl.dataset.holding = ''; openSheet(); }, 650);
  }
  function cancelOpen() { clearTimeout(holdTimer); holdTimer = null; openEl.dataset.holding = ''; }
  if (openEl) {
    openEl.addEventListener('pointerdown', armOpen);
    openEl.addEventListener('pointerup', cancelOpen);
    openEl.addEventListener('pointerleave', cancelOpen);
    openEl.addEventListener('pointercancel', cancelOpen);
  }

  function openSheet() { if (sheetEl) { sheetEl.hidden = false; renderSheet(); } }
  function closeSheet() { if (sheetEl) sheetEl.hidden = true; }
  function toggleSheet() { if (sheetEl?.hidden) openSheet(); else closeSheet(); }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const rowToggle = (key, label, on, note = '') => `
    <div class="row"><div class="lab">${esc(label)}${note ? `<span class="note">${esc(note)}</span>` : ''}</div>
    <button class="sw" data-toggle="${key}" aria-pressed="${on ? 'true' : 'false'}">
      <span>${on ? 'On' : 'Off'}</span></button></div>`;

  const rowRange = (key, label, val, min, max, step, fmt) => `
    <div class="row range"><div class="lab">${esc(label)}<b>${esc(fmt(val))}</b></div>
    <input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;

  function renderSheet() {
    if (!sheetEl || sheetEl.hidden) return;
    const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
    const voices = listVoices();
    sheetEl.innerHTML = `
      <div class="sheetbox" role="dialog" aria-label="Board settings">
        <div class="sheethead">
          <h2>Board settings</h2>
          <button class="close" data-close>Done</button>
        </div>

        <div class="grp">
          <div class="row"><div class="lab">Which board</div>
            <div class="seg">
              <button data-board="yesno" class="${cfg.boardId === 'yesno' ? 'on' : ''}">Yes / No / Other</button>
              <button data-board="care" class="${cfg.boardId === 'care' ? 'on' : ''}">Care board (16)</button>
            </div></div>
          ${rowToggle('highContrast', 'High contrast', cfg.highContrast, 'Black on white, 21:1')}
          ${rowToggle('speakAloud', 'Speak out loud', cfg.speakAloud,
            voices.length ? `${voices.length} voices on this device` : 'no voices found on this device')}
          ${rowToggle('sayBanner', 'Show the word on screen', cfg.sayBanner,
            'the board still says something when there is no voice')}
          <div class="row"><div class="lab">Try it</div>
            <button class="btn" data-test>Say “Hello”</button></div>
        </div>

        <details class="grp adv" ${cfg.scan ? 'open' : ''}>
          <summary>Scanning<span>${cfg.scan ? `on · ${secs(cfg.stepMs)} a card` : 'off'}</span></summary>
          ${rowToggle('scan', 'Scan the cards automatically', cfg.scan)}
          ${rowRange('stepMs', 'Time on each card', cfg.stepMs, SCAN_MIN, SCAN_MAX, SCAN_STEP, secs)}
          <div class="row"><div class="lab">While scanning, show</div>
            <div class="seg">
              <button data-reveal="all" class="${cfg.reveal === 'all' ? 'on' : ''}">all the cards</button>
              <button data-reveal="one" class="${cfg.reveal === 'one' ? 'on' : ''}">one at a time</button>
            </div></div>
          <p class="why">Fifteen seconds is the starting point because the step is set by how long
            a <b>response</b> takes, not how long understanding takes. A rate that feels right to
            the person setting it up is usually far too fast for the person using it.</p>
        </details>

        <details class="grp adv" ${cfg.dwell ? 'open' : ''}>
          <summary>Dwell — holding still is the click<span>${cfg.dwell ? `on · ${secs(cfg.dwellMs)}` : 'off'}</span></summary>
          ${rowToggle('dwell', 'Choose by holding still', cfg.dwell, 'turns tap-to-choose off')}
          ${rowRange('dwellMs', 'How long to hold', cfg.dwellMs, DWELL_MIN, DWELL_MAX, DWELL_STEP, secs)}
          ${rowRange('dwellRadius', 'How much wander is allowed', cfg.dwellRadius, 10, 200, 5, (v) => `${v}px`)}
          ${rowToggle('tapSelects', 'Touching a card still chooses it', cfg.tapSelects,
            'leave this off while dwell is on, or the tap wins')}
        </details>

        <details class="grp adv">
          <summary>Cursor<span>${cfg.cursorShow === 'never' ? 'off' : `${cfg.cursorSize}px`}</span></summary>
          <div class="row"><div class="lab">Show a big cursor</div>
            <div class="seg">
              <button data-cshow="tracking" class="${cfg.cursorShow === 'tracking' ? 'on' : ''}">when tracking</button>
              <button data-cshow="always" class="${cfg.cursorShow === 'always' ? 'on' : ''}">always</button>
              <button data-cshow="never" class="${cfg.cursorShow === 'never' ? 'on' : ''}">never</button>
            </div></div>
          ${rowRange('cursorSize', 'Cursor size', cfg.cursorSize, SIZE_MIN, SIZE_MAX, SIZE_STEP, (v) => `${v}px`)}
          <div class="row"><div class="lab">Shape</div>
            <div class="seg">
              ${STYLES.map((s) => `<button data-cstyle="${s}" class="${cfg.cursorStyle === s ? 'on' : ''}">${s === 'halo' ? 'ring + dot' : s}</button>`).join('')}
            </div></div>
        </details>

        <details class="grp adv">
          <summary>Keys, for a screen with a keyboard or a switch<span>${KEYS.length}</span></summary>
          <ul class="keys">${KEYS.map(([k, what]) => `<li><kbd>${esc(k)}</kbd> ${esc(what)}</li>`).join('')}
            <li><kbd>space</kbd> choose what is lit</li><li><kbd>tab</kbd> move to the next card</li></ul>
        </details>

        <div class="grp">
          <div class="row"><div class="lab">Full screen<span class="note">hides the browser bars — bigger cards</span></div>
            <button class="btn" data-fs>Go full screen</button></div>
          <p class="why">Settings and the log of what was chosen stay on <b>this device</b>. Nothing
            here is sent anywhere, and this page never asks anyone to sign in.</p>
        </div>
      </div>`;
  }

  if (sheetEl) {
    sheetEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-close],[data-board],[data-toggle],[data-reveal],[data-cshow],[data-cstyle],[data-test],[data-fs]');
      if (!t) { if (e.target === sheetEl) closeSheet(); return; }
      if (t.hasAttribute('data-close')) return closeSheet();
      if (t.hasAttribute('data-test')) return sayIt('Hello');
      if (t.hasAttribute('data-fs')) return toggleFullscreen();
      if (t.dataset.board) return save({ boardId: t.dataset.board });
      if (t.dataset.reveal) return save({ reveal: t.dataset.reveal });
      if (t.dataset.cshow) { save({ cursorShow: t.dataset.cshow }); return cursor?.refresh?.(); }
      if (t.dataset.cstyle) { save({ cursorStyle: t.dataset.cstyle }); return cursor?.refresh?.(); }
      if (t.dataset.toggle === 'dwell') return setDwell(!cfg.dwell);
      if (t.dataset.toggle) return save({ [t.dataset.toggle]: !cfg[t.dataset.toggle] });
      return undefined;
    });
    // `input`, not `change`: a caregiver adjusting the scan speed with the person in front of
    // them has to hear the difference WHILE they drag, not after they let go.
    sheetEl.addEventListener('input', (e) => {
      const k = e.target?.dataset?.range;
      if (!k) return;
      const v = Number(e.target.value);
      cfg = normalizeCfg({ ...cfg, [k]: v });
      writeStore(STORE_KEY, cfg);
      if (touchesBoard({ [k]: v })) state.notify();
      if (k.startsWith('cursor')) cursor?.refresh?.();
      const lab = e.target.closest('.row')?.querySelector('.lab b');
      if (lab) lab.textContent = k === 'dwellRadius' || k === 'cursorSize' ? `${v}px` : `${(v / 1000).toFixed(1)}s`;
    });
  }

  function applyShell() {
    doc.documentElement.dataset.hc = cfg.highContrast ? '1' : '';
    if (bannerEl) bannerEl.hidden = !cfg.sayBanner;
    voicePref = { rate: cfg.rate };
  }

  applyShell();
  // Web Speech loads its voices asynchronously, so the sheet's "N voices on this device" line
  // would read zero on a first open. Ask once at boot and re-render if the sheet is open.
  waitForVoices().then(() => renderSheet()).catch(() => {});
  keepAwake();

  return {
    cfg: () => ({ ...cfg }),
    save, bus, aim, dwell, cursor, events, toast,
    board: inst,
    keys: KEYS.map(([k, what]) => ({ key: k, what })),
    openSheet, closeSheet,
    destroy() {
      view.removeEventListener('keydown', onKey);
      root.removeEventListener('pointermove', onPointer);
      root.removeEventListener('pointerdown', onPointer);
      root.removeEventListener('pointerup', onPointerGone);
      root.removeEventListener('pointercancel', onPointerGone);
      clearTimeout(bannerTimer); clearTimeout(toastTimer); clearTimeout(holdTimer);
      try { dwell.destroy(); } catch { /* already gone */ }
      try { cursor?.destroy?.(); } catch { /* already gone */ }
      try { inst.destroy(); } catch { /* already gone */ }
      try { lock?.release?.(); } catch { /* already gone */ }
    },
  };
}
