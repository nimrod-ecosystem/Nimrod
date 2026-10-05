// screen_lock.js — LOCK THIS SCREEN: EVERYTHING INSIDE KEEPS WORKING; THE WAYS OUT ARE GONE (2026-10-05).
//
// Mike, 2026-10-05: *"I could have a lock/unlock like ctrl + shift + L. Set to lock the dashboard. That way
// people could control things within whatever dashboards/modules but can't get back out to the computer.
// I'd like to be able to stay out of it though when I unlock, so we can watch Netflix and stuff."*
//
// *** WHAT "LOCKED" IS, AND WHY IT IS THE OPPOSITE OF A MODAL. *** Nothing is put in front of anything.
// Photos keep changing, a video keeps playing, a call keeps ringing and can be answered, a game is played,
// the panels are switched, paused and made bigger, the dashboards tray swaps dashboards. What goes is every
// way OUT of the screen and every way of CHANGING ITS SETUP:
//   * leaving: the tray's "Set up dashboards" row (it navigates to the composer), leaving full screen,
//     links that open another page or tab, `window.open`, the browser's own leave-the-page keys where the
//     page is allowed to stop them (Ctrl+L, Ctrl+T, Alt+Left, F11, F12 ...), the right-click menu ("Open
//     in new tab", "Back", "Inspect"), dragging a link out, and the computer's file dialogs (a file picker
//     is a window onto the whole computer);
//   * changing the setup: the edit view, the map, a panel's edit corner, Switch module, the Modules library
//     in a panel's place, the room's reactions editor, making a ready-made dashboard, and every ⚙ row that
//     is not about using what is on screen (see "THE ⚙ MENU WHILE LOCKED" below).
// CLAUDE.md's invariant is that a screen must never enter a state only an input can leave when the person
// in front of it cannot give that input. A lock that hid content until somebody unlocked it would be exactly
// that; this one hides nothing, so "what if nobody answers?" has the answer the invariant wants: nothing
// happens, and the screen keeps doing what it was doing.
//
// *** WHAT THE PAGE CANNOT STOP, SAID OUT LOUD. *** A web page cannot take keys from the operating system or
// the window manager (Ctrl+Alt+Del, Alt+F4 outside full screen, a labwc keybind), and outside full screen
// it cannot take the browser's reserved keys (Ctrl+T, Ctrl+N, Ctrl+W). In full screen it asks for the
// Keyboard Lock (`navigator.keyboard.lock`, Chromium): then those keys come to the page first (and are
// refused here), and leaving full screen takes holding Escape rather than a tap. The rest is the
// computer's job - on a Pi, the kiosk launcher and its watchdog: see the Pi plan in the report that
// shipped this (and on Mike's list). The page's lock is the part a browser can do; it is not a sandbox.
//
// *** THE CHORD: Ctrl+Shift+L, AS AN ORDINARY BINDING. *** It follows Cici's own Ctrl+Shift+L precedent
// (input_keyboard.js notes it) and collides with nothing on this site (the gate toggle is Ctrl+Shift+E; the
// kiosk's bare keys are digits, H, C, F, [, ], \, M, W and O). It is a binding on the `system/screen-lock`
// action (actions.js SYSTEM_ACTIONS), so Devices can move it to another key or a switch. Added the way the
// review keys are (pack_reviews.js `missingReviewBindings`): IN MEMORY where a person's saved record does not
// already bind the action or use the key - never written back. NOT a spoken route: anybody in the room can
// speak, and "unlock" said aloud would be no lock at all.
//
// *** STATE IS PER DEVICE, NOT PER SCREEN RECORD. *** Kept in this browser's storage (`LOCK_STORE_KEY`), so it
// survives a reload and a reboot, and a laptop showing the same dashboard is not locked because the Pi is.
//   AGAINST, and it is real: the owner cannot unlock it from their phone, because the server never hears of it.
//   It loses because the lock is about the keyboard and the browser IN FRONT OF THIS SCREEN; a remote unlock
//   is a remote control of the live screen, which this project keeps out on purpose. On Mike's list.
//
// *** DEFAULT: UNLOCKED, FOR A NEW SCREEN. *** Argued:
//   FOR locked by default: a care-room screen is safe from the first boot, before anybody thinks of it.
//   AGAINST, and it wins: an owner who has never heard of the chord would boot a screen whose setup they
//   cannot reach - stranded out of their own screen on day one, with nothing on it saying why. Unlocked is
//   how every screen behaves today; locking is one press in ⚙ (This screen) or the chord.
//
// *** "STAY OUT OF IT" WHEN SOMEBODY UNLOCKS (`stayOut`). *** Three states, not two: never locked (today's
// screen, exactly as it was), locked, and unlocked BY A PERSON. Only the third stays out of the way: the
// site's own pulls stand down - the new-version reload (version_watch.js: the hold reason `unlocked`) and
// the recovery ladder's reload and reboot rungs (recovery.js) - until it is locked again. A screen nobody
// ever locked keeps both, so the bench still follows deploys. The site has no other pull: nothing re-enters
// full screen by itself (a browser refuses that without a press) and nothing returns to the dashboard on a
// timer. The pull that matters on a Pi is the launcher's Restart=always, which is Pi work (the report's plan;
// `createLockReporter` below is the site's half of it).
//
// *** A PIN TO UNLOCK: OFF BY DEFAULT. *** Argued:
//   FOR on: the chord is a secret anybody can learn by watching once, or by reading this file.
//   AGAINST, and it wins for a default: in a care room the people in front of the screen cannot press a
//   three-key chord at all, so the chord already is the barrier; a PIN on top is one more thing an owner can
//   forget, and a forgotten PIN on a device-only lock is only undone by clearing this browser's saved data.
//   WHO THE CHORD FAILS FOR: a room where somebody CAN press keys - a curious grandchild, another resident who
//   uses a keyboard, a visitor who knows the shortcut - and an owner with a touch screen and no keyboard,
//   who cannot press a chord to unlock at all. Both are served by turning the PIN on: it is typed on the
//   keypad the strip draws, so touch alone unlocks it. Stored as a salted hash (SHA-256 where the browser
//   has it), in this browser only - a deterrent, not account security.
//
// *** "LOCK AGAIN BY ITSELF": OFF BY DEFAULT. *** Argued:
//   FOR on: an owner who forgets to lock before walking out leaves the screen open all night.
//   AGAINST, and it wins: the page cannot see what happens outside it. An owner watching Netflix in another
//   window is, to this page, nobody using it - and a lock that fired then would be the pull-back Mike asked
//   to be spared. So: off unless chosen, counts idle only while this page is SHOWING (a hidden page's clock
//   starts again when it is shown), and its hours are the owner's choice (1, 2, 4 or 8).
//
// *** THE PIN STRIP IS A STRIP, NOT A SCRIM (the dashboards tray's rule, kiosk.js `toggleScreens`). *** It
// sits low on the screen, the panels keep playing above it, and it puts itself away after `PIN_STRIP_IDLE_MS`
// untouched, on Escape and on ✕. Nobody answering it costs nothing.
//
// Everything deciding is here and pure-ish (storage, clock, timers, document and window injected), so
// dev/screen_lock_test.html drives it a step at a time; kiosk.js wires it to the screen ("LOCK THIS SCREEN").

import { LAYERS } from './layers.js';

export const SCREEN_LOCK_ACTION = 'system/screen-lock';   // = actions.js SYSTEM_ACTIONS (the suite checks they agree)
export const SCREEN_LOCK_TOPIC = 'system/screen-lock';
/** Published on the screen's bus whenever the lock changes: { locked, stayOut, hasPin, by }. */
export const LOCK_STATE_TOPIC = 'screen/lock';
export const LOCK_STORE_KEY = 'nimrod:screen-lock';
export const LOCK_HELPER_KEY = 'nimrod:lock-helper';
export const LOCK_HELPER_PARAM = 'lockHelper';
export const LOCK_CONTROL = 'key:ctrl+shift+l';

// HARD-CODED, each with its reason (CLAUDE.md porting rule 1):
//   PIN 4-8 digits    a phone's own range: shorter is guessable at a glance, longer is not typed at a bedside.
//   5 tries, 30 s     a wrong guess costs a half-minute after five, so the keypad cannot be walked in a minute.
//   45 s strip idle   long enough to fetch reading glasses, short enough that a strip left by somebody who
//                     walked away is gone before anybody else notices it.
//   1/2/4/8 hours     "lock again by itself" choices: an evening's film, a long one, an afternoon, a night.
//   60 s heartbeat    the Pi helper hears the state at least once a minute (it is a localhost request).
export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PIN_TRIES = 5;
export const PIN_WAIT_MS = 30 * 1000;
export const PIN_STRIP_IDLE_MS = 45 * 1000;
export const RELOCK_CHOICES = Object.freeze([0, 1, 2, 4, 8]);
export const RELOCK_TICK_MS = 60 * 1000;
export const HELPER_BEAT_MS = 60 * 1000;

// ---------------------------------------------------------------------------------------------------------
// THE CHORD, AS A BINDING (input_keyboard.js's shape, pack_reviews.js's in-memory rule).
// ---------------------------------------------------------------------------------------------------------
export const LOCK_KEY_BINDINGS = Object.freeze([Object.freeze({
  id: 'default/screen-lock', actionId: SCREEN_LOCK_ACTION, device: 'keyboard', control: LOCK_CONTROL,
  edge: 'press', role: 'universal', holdMs: 0, debounceMs: 0, lockoutMs: 0, label: 'Lock or unlock this screen',
})]);

/** The lock binding a saved record does not already cover: it binds the action, or uses the key, and it is left alone. */
export function missingLockBindings(bindings) {
  const list = Array.isArray(bindings) ? bindings : [];
  return LOCK_KEY_BINDINGS.filter((b) => !list.some((x) => x && (
    (x.device === b.device && x.control === b.control) || x.actionId === b.actionId))).map((b) => ({ ...b }));
}

/** "key:ctrl+shift+l" -> "Ctrl+Shift+L": the words a person reads. Anything else: a plain fallback. */
export function chordWords(control) {
  const s = String(control || '');
  if (!s.startsWith('key:')) return s ? 'its switch' : 'Ctrl+Shift+L';
  return s.slice(4).split('+').map((p) => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt') return 'Alt';
    if (p === 'meta') return 'Meta';
    if (p === ' ') return 'Space';
    return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
  }).join('+');
}

/** The keyboard control bound to the lock right now (a rebinding shows in the words), else the default. */
export function lockControlOf(bindings) {
  const b = (Array.isArray(bindings) ? bindings : []).find((x) => x && x.actionId === SCREEN_LOCK_ACTION);
  if (!b) return LOCK_CONTROL;
  return b.device === 'keyboard' ? b.control : `switch:${b.device}`;
}

/** What a screen says when a locked press is refused. Plain words; never a gate. */
export function lockedLine(what, control = LOCK_CONTROL) {
  return `This screen is locked, so ${what} waits until it is unlocked (${chordWords(control)}).`;
}

// ---------------------------------------------------------------------------------------------------------
// THE RECORD (this browser's storage).
// ---------------------------------------------------------------------------------------------------------
export function normalizeLockRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hours = Number(r.relockHours);
  return {
    v: 1,
    locked: r.locked === true,
    // Only meaningful while unlocked: a person unlocked it, so the site stays out of the way.
    stayOut: r.locked === true ? false : r.stayOut === true,
    pinHash: typeof r.pinHash === 'string' && r.pinHash ? r.pinHash : null,
    pinSalt: typeof r.pinSalt === 'string' && r.pinSalt ? r.pinSalt : null,
    relockHours: RELOCK_CHOICES.includes(hours) ? hours : 0,
  };
}

const defaultStorage = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};
function readRecord(storage) {
  try { const s = storage?.getItem?.(LOCK_STORE_KEY); return normalizeLockRecord(s ? JSON.parse(s) : null); }
  catch { return normalizeLockRecord(null); }
}
function writeRecord(storage, rec) {
  try { storage?.setItem?.(LOCK_STORE_KEY, JSON.stringify(rec)); return true; } catch { return false; }
}

export const isPinShape = (pin) => typeof pin === 'string' && new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

/** A salted hash of a PIN: SHA-256 where the browser has it (any https page, and localhost), else FNV-1a. */
export async function hashPin(pin, salt, subtle = (globalThis.crypto && globalThis.crypto.subtle) || null) {
  const text = `${salt}:${pin}`;
  if (subtle && typeof subtle.digest === 'function' && typeof TextEncoder !== 'undefined') {
    try {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
      return `sha256:${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    } catch { /* fall through */ }
  }
  let h = 0x811c9dc5;
  for (let round = 0; round < 64; round += 1) {
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i) + round; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return `fnv:${h.toString(16)}`;
}
const newSalt = () => {
  try {
    const a = new Uint8Array(8); globalThis.crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return Math.random().toString(16).slice(2, 18); }
};

/**
 * The lock. Returns { get, isLocked, staysOut, needsPin, lock, unlock, toggle, setPin, clearPin, setRelockHours,
 * poke, tick, subscribe, destroy }.
 *   storage    this browser's storage (a seam; default localStorage)
 *   now        the clock
 *   setInterval / clearInterval   the relock tick (a seam; pass null for none)
 *   doc        for "is this page showing" (visibilityState) and the activity that counts as somebody here
 */
export function createScreenLock({
  storage = defaultStorage(),
  now = () => Date.now(),
  setIntervalFn = (typeof setInterval !== 'undefined' ? setInterval : null),
  clearIntervalFn = (typeof clearInterval !== 'undefined' ? clearInterval : null),
  doc = (typeof document !== 'undefined' ? document : null),
  hash = hashPin,
} = {}) {
  let rec = readRecord(storage);
  const subs = new Set();
  let lastActive = now();
  let fails = 0;
  let waitUntil = 0;
  let torn = false;

  const view = () => ({ locked: rec.locked, stayOut: rec.stayOut, hasPin: !!rec.pinHash, relockHours: rec.relockHours });
  function emit(by) {
    const s = { ...view(), by };
    for (const fn of [...subs]) { try { fn(s); } catch (err) { console.error('screen lock: a listener', err); } }
  }
  function save(next, by) {
    rec = normalizeLockRecord(next);
    writeRecord(storage, rec);
    emit(by);
  }

  function lock({ by = 'person' } = {}) {
    if (torn) return view();
    if (!rec.locked) save({ ...rec, locked: true, stayOut: false }, by);
    return view();
  }
  /** Unlock. With a PIN set, `pin` must match: { ok: false, reason: 'pin' | 'wrong' | 'wait', waitMs? }. */
  async function unlock({ pin = null, by = 'person' } = {}) {
    if (torn) return { ok: false, reason: 'gone' };
    if (!rec.locked) return { ok: true, already: true };
    if (rec.pinHash) {
      const t = now();
      if (t < waitUntil) return { ok: false, reason: 'wait', waitMs: waitUntil - t };
      if (pin == null || pin === '') return { ok: false, reason: 'pin' };
      const h = await hash(String(pin), rec.pinSalt || '');
      if (h !== rec.pinHash) {
        fails += 1;
        if (fails >= PIN_TRIES) { fails = 0; waitUntil = now() + PIN_WAIT_MS; return { ok: false, reason: 'wait', waitMs: PIN_WAIT_MS }; }
        return { ok: false, reason: 'wrong', triesLeft: PIN_TRIES - fails };
      }
    }
    fails = 0; waitUntil = 0;
    lastActive = now();
    save({ ...rec, locked: false, stayOut: true }, by);
    return { ok: true };
  }
  /** The chord: locked -> unlock (or { ok: false, reason: 'pin' } when a PIN is wanted); else lock. */
  async function toggle({ by = 'person' } = {}) {
    if (rec.locked) return rec.pinHash ? { ok: false, reason: 'pin' } : unlock({ by });
    lock({ by });
    return { ok: true, locked: true };
  }
  async function setPin(pin) {
    if (torn || rec.locked) return { ok: false, reason: 'locked' };
    if (!isPinShape(String(pin || ''))) return { ok: false, reason: 'shape' };
    const salt = newSalt();
    const h = await hash(String(pin), salt);
    save({ ...rec, pinHash: h, pinSalt: salt }, 'pin');
    return { ok: true };
  }
  function clearPin() {
    if (torn || rec.locked) return false;
    save({ ...rec, pinHash: null, pinSalt: null }, 'pin');
    return true;
  }
  function setRelockHours(h) {
    const n = Number(h);
    if (torn || !RELOCK_CHOICES.includes(n)) return false;
    lastActive = now();
    save({ ...rec, relockHours: n }, 'relock');
    return true;
  }

  // ---- "LOCK AGAIN BY ITSELF" (see the header: off by default, and only while this page is showing) ----
  const showing = () => !doc || doc.visibilityState !== 'hidden';
  function poke() { lastActive = now(); }
  /** One look at the clock. Returns true when it locked. Exported for the suite; the interval calls it. */
  function tick() {
    if (torn || rec.locked || !rec.stayOut || !rec.relockHours) return false;
    if (!showing()) { lastActive = now(); return false; }
    if (now() - lastActive < rec.relockHours * 60 * 60 * 1000) return false;
    lock({ by: 'idle' });
    return true;
  }
  const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  const onVis = () => { if (showing()) lastActive = now(); };
  if (doc && typeof doc.addEventListener === 'function') {
    for (const ev of ACTIVITY) doc.addEventListener(ev, poke, { passive: true, capture: true });
    doc.addEventListener('visibilitychange', onVis);
  }
  const timer = setIntervalFn ? setIntervalFn(tick, RELOCK_TICK_MS) : null;

  // Another tab of this browser locked or unlocked it: follow, so two windows never disagree.
  const onStorage = (e) => {
    if (!e || e.key !== LOCK_STORE_KEY) return;
    const was = JSON.stringify(view());
    rec = readRecord(storage);
    if (JSON.stringify(view()) !== was) emit('elsewhere');
  };
  const win = doc && doc.defaultView;
  try { win?.addEventListener?.('storage', onStorage); } catch { /* none */ }

  return {
    get: view,
    isLocked: () => rec.locked,
    staysOut: () => !rec.locked && rec.stayOut,
    needsPin: () => !!rec.pinHash,
    lock, unlock, toggle, setPin, clearPin, setRelockHours, poke, tick,
    subscribe(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); },
    destroy() {
      torn = true;
      subs.clear();
      if (timer && clearIntervalFn) clearIntervalFn(timer);
      if (doc && typeof doc.removeEventListener === 'function') {
        for (const ev of ACTIVITY) doc.removeEventListener(ev, poke, { capture: true });
        doc.removeEventListener('visibilitychange', onVis);
      }
      try { win?.removeEventListener?.('storage', onStorage); } catch { /* none */ }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// THE ⚙ MENU WHILE LOCKED (kiosk.js applies this to the one menu, so a Settings panel gets it too).
// ---------------------------------------------------------------------------------------------------------
// WHICH TABS STAY, argued. The line is "using what is on screen" against "changing the screen's setup":
//   STAY  the selected panel's own settings (a slideshow's speed, a game's level, a video's own volume: the
//         module's own choices are using the module), its Pause / Play and Bigger / Smaller, a live call's
//         controls, the Sound tab (volume first of all - the thing anybody in the room should be able to
//         turn down), and the Display tab's legibility rows (Colours, burn-in, movement and flashing). "How
//         much this menu shows" stays above the tabs.
//   GO    Devices (bindings, voice, connections, keys to other services), People (who the screen is for),
//         This screen (recovery, where a cold boot lands, the screen's own switches, the folders page that
//         opens file dialogs), the levels in "Settings for" (every panel of a kind, the screen, the device,
//         the person) and the pieces of the room, and on the tabs that stay the rows that rearrange or edit
//         (LOCK_MENU_DROPS).
//   AGAINST keeping Colours: a visitor can make the screen ugly. It stays because on a bedside screen it is
//   the legibility control (kiosk.js SCREEN_FIELDS calls it essential) and it is undone in one press.
//   AGAINST dropping the panel's own rows: a module's setting can be a setup choice (which album a slideshow
//   shows). Kept because "control things within whatever dashboards/modules" is Mike's own line, and a
//   module's settings are the module's controls; the ones that open the computer (a folder picker) are
//   refused at the file dialog itself.
export const LOCK_KEEP_TABS = Object.freeze(['module', 'audio', 'display']);
export const LOCK_MENU_DROPS = Object.freeze([
  'switch-module', 'edit-panel', 'piece-edit', 'scan-lap', 'load-pack', 'see-reviews', 'set:instancePanelSurface',
  'set:panelSurface', 'room-reactions', 'layout-pick', 'layout-keep', 'edit-view', 'dashboard-map',
]);
/** The rows a locked menu keeps. `drop`: more ids (the kiosk adds the ones its own constants name). */
export function keepWhileLocked(rows, { drop = [], keepTabs = LOCK_KEEP_TABS } = {}) {
  const gone = new Set([...LOCK_MENU_DROPS, ...drop]);
  return (rows || []).filter((it) => {
    if (!it) return false;
    if (it.id && gone.has(it.id)) return false;
    if (typeof it.id === 'string' && (it.id.startsWith('layout:') || it.id.startsWith('level:'))) return false;
    // A row with no tab of its own lands on the first tab (the panel's), which stays.
    return !it.tab || keepTabs.includes(it.tab) || it.tab === '*end';
  });
}
/** "Settings for" while locked: the panels only - no levels, no pieces of the room. */
export function panelSubjectsOnly(list, { levelPrefix = 'level:', piecePrefix = '' } = {}) {
  return (list || []).filter((s) => s && typeof s.id === 'string' && !s.id.startsWith(levelPrefix)
    && !(piecePrefix && s.id.startsWith(piecePrefix)));
}

// ---------------------------------------------------------------------------------------------------------
// THE GUARDS: what leaves the page, refused while locked. Every one checks `isLocked()` at the moment.
// ---------------------------------------------------------------------------------------------------------
/** Is this keydown one of the browser's leave-the-page keys a page may refuse? Pure; exported for the suite. */
export function isLeaveKey(e) {
  if (!e) return false;
  const k = String(e.key || '').toLowerCase();
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const alt = !!e.altKey;
  const shift = !!e.shiftKey;
  // The keyboard's own browser keys, and the system key (reaches a page only under the Keyboard Lock).
  if (['browserback', 'browserforward', 'browserhome', 'browsersearch', 'browserfavorites', 'launchapplication1',
    'launchapplication2', 'launchmail', 'meta', 'os'].includes(k)) return true;
  // Help (a new tab), the address bar, caret browsing (a dialog), the menu, the browser's own full screen,
  // the developer tools. F5 (reload) is allowed: a reload comes back locked, on this page.
  if (!ctrl && !alt && ['f1', 'f6', 'f7', 'f10', 'f11', 'f12'].includes(k)) return true;
  // Back / forward / home, the address bar, the browser's menus, closing the window.
  if (alt && !ctrl && ['arrowleft', 'arrowright', 'home', 'd', 'e', 'f', 'f4'].includes(k)) return true;
  if (ctrl && !alt) {
    // New / reopened / closed tabs and windows, quitting, the developer tools, profiles, bookmarks, clearing data.
    if (shift && ['t', 'n', 'w', 'q', 'i', 'j', 'c', 'o', 'b', 'm', 'a', 'delete', 'tab'].includes(k)) return true;
    // The address bar, tabs, open / print / save dialogs (each a way to the computer's files), history,
    // downloads, page source, bookmarks, the search box, switching tabs.
    if (!shift && ['l', 't', 'n', 'w', 'q', 'o', 'p', 's', 'h', 'j', 'u', 'd', 'e', 'k', 'tab', 'pagedown',
      'pageup', 'f4'].includes(k)) return true;
    if (/^[1-9]$/.test(k)) return true;            // Ctrl+1..9: another tab
  }
  return false;
}

/** Does following this link leave the page? A new tab, another page, another site, a download. Pure. */
export function isLeavingLink(a, e = {}, loc = (typeof location !== 'undefined' ? location : null)) {
  if (!a || typeof a.getAttribute !== 'function') return false;
  const href = a.getAttribute('href');
  if (href == null || href === '') return false;
  if (a.hasAttribute?.('download')) return true;
  const target = String(a.getAttribute('target') || '').toLowerCase();
  if (target && target !== '_self') return true;
  if (e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  if (/^\s*javascript:/i.test(href)) return false;
  if (href.trim().startsWith('#')) return false;
  let u = null;
  try { u = new URL(href, loc ? loc.href : undefined); } catch { return true; }
  if (!loc) return true;
  return u.origin !== loc.origin || u.pathname !== loc.pathname || u.search !== loc.search;
}

/**
 * Attach the guards. They are always listening and act only while `isLocked()`; `sync()` (call it on every
 * lock change and full-screen change) puts on or takes off the two that replace something global
 * (`window.open`, the file pickers) and asks for, or gives back, the Keyboard Lock.
 *   scope       the element whose links and file inputs are this screen's (the kiosk's root)
 *   onBlocked   told what was refused ('key' | 'link' | 'menu' | 'window' | 'file' | 'drag'), to say so
 *   isFullscreen  whether the page is in full screen now
 */
export function attachLockGuards({
  win = (typeof window !== 'undefined' ? window : null),
  doc = (typeof document !== 'undefined' ? document : null),
  scope = null,
  isLocked = () => false,
  onBlocked = () => {},
  isFullscreen = () => !!(doc && doc.fullscreenElement),
} = {}) {
  if (!win || !doc) return { sync() {}, destroy() {}, wrapped: () => false };
  const inScope = (t) => !scope || (t instanceof win.Node && scope.contains(t));
  const said = (what) => { try { onBlocked(what); } catch { /* saying so must never break the guard */ } };

  const onKey = (e) => {
    if (!isLocked() || !isLeaveKey(e)) return;
    e.preventDefault();
    said('key');
  };
  const onClick = (e) => {
    if (!isLocked() || !inScope(e.target)) return;
    const t = e.target;
    const a = t && typeof t.closest === 'function' ? t.closest('a[href]') : null;
    if (a && isLeavingLink(a, e, win.location)) { e.preventDefault(); said('link'); return; }
    const input = t && typeof t.closest === 'function' ? (t.closest('input[type="file"]') || t.closest('label')?.control || null) : null;
    if (input && String(input.type || '').toLowerCase() === 'file') { e.preventDefault(); said('file'); }
  };
  const onMenu = (e) => { if (isLocked() && inScope(e.target)) { e.preventDefault(); said('menu'); } };
  const onDrag = (e) => {
    if (!isLocked() || !inScope(e.target)) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && (t.closest('a[href]') || t.tagName === 'IMG')) { e.preventDefault(); said('drag'); }
  };
  win.addEventListener('keydown', onKey, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('auxclick', onClick, true);
  doc.addEventListener('contextmenu', onMenu, true);
  doc.addEventListener('dragstart', onDrag, true);

  // ---- The two global replacements, only while locked. Restored exactly as found. ----
  const PICKERS = ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'];
  let saved = null;
  function wrap() {
    if (saved) return;
    saved = { open: win.open };
    win.open = function lockedOpen() { said('window'); return null; };
    for (const p of PICKERS) {
      if (typeof win[p] !== 'function') continue;
      saved[p] = win[p];
      // AbortError is what a person pressing Cancel gives: every caller already treats it as "nothing chosen".
      win[p] = function lockedPicker() {
        said('file');
        const Err = win.DOMException || Error;
        return Promise.reject(new Err('This screen is locked', 'AbortError'));
      };
    }
  }
  function unwrap() {
    if (!saved) return;
    win.open = saved.open;
    for (const p of PICKERS) if (p in saved) win[p] = saved[p];
    saved = null;
  }
  let kbLocked = false;
  function keyboardLock(on) {
    const kb = win.navigator && win.navigator.keyboard;
    if (!kb) return;
    try {
      if (on && !kbLocked && typeof kb.lock === 'function') { kbLocked = true; Promise.resolve(kb.lock()).catch(() => { kbLocked = false; }); }
      else if (!on && kbLocked && typeof kb.unlock === 'function') { kbLocked = false; kb.unlock(); }
    } catch { kbLocked = false; }
  }
  function sync() {
    if (isLocked()) wrap(); else unwrap();
    let fs = false;
    try { fs = !!isFullscreen(); } catch { fs = false; }
    keyboardLock(isLocked() && fs);
  }
  const onFs = () => sync();
  doc.addEventListener('fullscreenchange', onFs);
  sync();

  return {
    sync,
    wrapped: () => !!saved,
    keyboardLocked: () => kbLocked,
    destroy() {
      win.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('auxclick', onClick, true);
      doc.removeEventListener('contextmenu', onMenu, true);
      doc.removeEventListener('dragstart', onDrag, true);
      doc.removeEventListener('fullscreenchange', onFs);
      unwrap();
      keyboardLock(false);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// WHAT IS DRAWN: the "Unlocked" chip, and the PIN strip. Both in the theme's own tokens.
// ---------------------------------------------------------------------------------------------------------
const CSS_ID = 'screen-lock-css';
export function ensureLockCss(doc) {
  if (!doc || doc.getElementById?.(CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = CSS_ID;
  st.textContent = `
  .kiosk[data-screen-locked] .k-editc, .kiosk[data-screen-locked] [data-act="switch"] { display: none !important; }
  .sl-chip { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); z-index: ${LAYERS.transport + 5};
    pointer-events: none; padding: 4px 12px; border-radius: 999px; font: 600 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--surface); color: var(--text); border: 1px solid var(--focus); opacity: .85; white-space: nowrap; }
  .sl-pin { position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%); z-index: ${LAYERS.menus + 5};
    width: min(92%, 420px); padding: 14px 16px; border-radius: 14px; box-sizing: border-box;
    background: var(--surface); color: var(--text); border: 2px solid var(--focus);
    font: 16px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
  .sl-pin[hidden] { display: none; }
  .sl-pin .sl-row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
  .sl-pin .sl-title { font-weight: 700; }
  .sl-pin input { width: 100%; box-sizing: border-box; margin: 10px 0; padding: 10px; font-size: 22px; letter-spacing: .3em;
    text-align: center; border-radius: 10px; border: 2px solid var(--focus); background: var(--bg); color: var(--text); }
  .sl-pin .sl-keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .sl-pin button { min-height: 48px; font: 600 18px/1 system-ui, -apple-system, Segoe UI, sans-serif; border-radius: 10px;
    border: 2px solid var(--focus); background: var(--bg); color: var(--text); cursor: pointer; }
  .sl-pin .sl-say { min-height: 1.4em; margin-top: 8px; }`;
  (doc.head || doc.documentElement).append(st);
}

/** The small plain chip while somebody has unlocked the screen. Not a button: nothing to press by mistake. */
export function mountLockChip(host, { doc = host?.ownerDocument } = {}) {
  if (!host || !doc) return { show() {}, hide() {}, el: null, destroy() {} };
  ensureLockCss(doc);
  const el = doc.createElement('div');
  el.className = 'sl-chip';
  el.dataset.lockChip = '';
  el.setAttribute('role', 'status');
  el.hidden = true;
  host.append(el);
  return {
    el,
    show(text) { el.textContent = text; el.hidden = false; },
    hide() { el.hidden = true; },
    destroy() { el.remove(); },
  };
}

/**
 * The PIN strip: a keypad low on the screen. `open('unlock')` asks for the PIN; `open('set')` asks for a new one
 * twice. `submit(mode, pin)` -> Promise<{ ok, text }>; a 'set' gets the PIN only once both match.
 * Puts itself away after `idleMs` untouched, on Escape and on ✕ (see the header: a strip, never a gate).
 */
export function mountPinStrip(host, {
  doc = host?.ownerDocument, submit = async () => ({ ok: false }), onClose = null,
  idleMs = PIN_STRIP_IDLE_MS, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t),
} = {}) {
  if (!host || !doc) return { open() {}, close() {}, isOpen: () => false, el: null, destroy() {} };
  ensureLockCss(doc);
  const el = doc.createElement('div');
  el.className = 'sl-pin';
  el.dataset.pinStrip = '';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'PIN');
  el.hidden = true;
  el.innerHTML = `
    <div class="sl-row"><span class="sl-title" data-pin-title></span>
      <button type="button" data-pin-key="close" aria-label="Close" style="min-height:40px;min-width:48px">✕</button></div>
    <input type="password" inputmode="numeric" autocomplete="off" maxlength="${PIN_MAX}" data-pin-input aria-label="PIN">
    <div class="sl-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map((k) => (
      `<button type="button" data-pin-key="${k}">${k === 'back' ? '⌫' : k === 'ok' ? 'OK' : k}</button>`)).join('')}</div>
    <div class="sl-say" role="status" aria-live="polite" data-pin-say></div>`;
  host.append(el);
  const input = el.querySelector('[data-pin-input]');
  const titleEl = el.querySelector('[data-pin-title]');
  const sayEl = el.querySelector('[data-pin-say]');
  let mode = null;
  let first = null;              // 'set': the first entry, waiting for the second
  let busy = false;
  let idleT = null;

  const TITLES = {
    unlock: 'Type the PIN to unlock this screen',
    set: `Choose a PIN: ${PIN_MIN} to ${PIN_MAX} numbers`,
    again: 'Type the same PIN again',
  };
  function arm() { if (idleT) clearTimer(idleT); idleT = idleMs > 0 ? setTimer(() => close('idle'), idleMs) : null; }
  function say(text) { sayEl.textContent = text || ''; }
  function open(m = 'unlock') {
    mode = m === 'set' ? 'set' : 'unlock';
    first = null; busy = false;
    titleEl.textContent = TITLES[mode];
    input.value = '';
    say('');
    el.hidden = false;
    try { input.focus({ preventScroll: true }); } catch { /* no focus here */ }
    arm();
  }
  function close(why = 'close') {
    if (el.hidden) return;
    el.hidden = true;
    if (idleT) clearTimer(idleT);
    idleT = null;
    input.value = '';
    mode = null; first = null;
    try { onClose?.(why); } catch (err) { console.error('pin strip: close', err); }
  }
  async function enter() {
    if (busy || !mode) return;
    const pin = input.value.trim();
    input.value = '';
    if (mode === 'set') {
      if (!isPinShape(pin)) { say(`${PIN_MIN} to ${PIN_MAX} numbers, please.`); return; }
      if (first === null) { first = pin; titleEl.textContent = TITLES.again; say(''); return; }
      if (first !== pin) { first = null; titleEl.textContent = TITLES.set; say('Those were not the same. Choose it again.'); return; }
    }
    busy = true;
    let r = null;
    try { r = await submit(mode, pin); } catch (err) { console.error('pin strip: submit', err); r = { ok: false, text: 'That did not work.' }; }
    busy = false;
    if (r && r.ok) { close('done'); return; }
    say((r && r.text) || 'That is not the PIN.');
    if (mode === 'set') { first = null; titleEl.textContent = TITLES.set; }
  }
  function press(k) {
    arm();
    if (k === 'close') { close('close'); return; }
    if (k === 'ok') { enter(); return; }
    if (k === 'back') { input.value = input.value.slice(0, -1); return; }
    if (/^\d$/.test(k) && input.value.length < PIN_MAX) input.value += k;
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pin-key]');
    if (b && el.contains(b)) press(b.dataset.pinKey);
  });
  el.addEventListener('keydown', (e) => {
    arm();
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('escape'); return; }
    if (e.key === 'Enter') { e.preventDefault(); enter(); }
  });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, PIN_MAX); arm(); });
  return {
    el, open, close, press, enter,
    isOpen: () => !el.hidden,
    mode: () => mode,
    destroy() { if (idleT) clearTimer(idleT); el.remove(); },
  };
}

// ---------------------------------------------------------------------------------------------------------
// THE PI'S HALF, FROM THE SITE: tell a helper on this computer what the lock is (the report's Pi plan).
// ---------------------------------------------------------------------------------------------------------
// Off unless the kiosk was launched with `?lockHelper=http://127.0.0.1:<port>/screen-lock` (kept in this
// browser's storage after, like the device key; `?lockHelper=off` forgets it). LOOPBACK ONLY: a link cannot
// make this page post anything to somebody else's server. The page never waits on it and never retries a
// failure except at the next heartbeat - a missing helper is an ordinary computer, not an error.
export function isLoopbackUrl(u) {
  let x = null;
  try { x = new URL(String(u || '')); } catch { return false; }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') return false;
  const h = x.hostname.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
}
export function lockHelperFrom({ search = (typeof location !== 'undefined' ? location.search : ''), storage = defaultStorage() } = {}) {
  let asked = null;
  try { asked = new URLSearchParams(search || '').get(LOCK_HELPER_PARAM); } catch { asked = null; }
  if (asked === 'off') { try { storage?.removeItem?.(LOCK_HELPER_KEY); } catch { /* none */ } return null; }
  if (asked && isLoopbackUrl(asked)) { try { storage?.setItem?.(LOCK_HELPER_KEY, asked); } catch { /* none */ } return asked; }
  let kept = null;
  try { kept = storage?.getItem?.(LOCK_HELPER_KEY) || null; } catch { kept = null; }
  return kept && isLoopbackUrl(kept) ? kept : null;
}
export function createLockReporter({
  url, fetchImpl = (...a) => globalThis.fetch(...a), beatMs = HELPER_BEAT_MS,
  setIntervalFn = (typeof setInterval !== 'undefined' ? setInterval : null),
  clearIntervalFn = (typeof clearInterval !== 'undefined' ? clearInterval : null),
  now = () => Date.now(),
} = {}) {
  if (!url || !isLoopbackUrl(url)) return { report() {}, last: () => null, destroy() {} };
  let last = null;
  function send() {
    if (!last) return;
    try {
      Promise.resolve(fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ ...last, at: now() }),
      })).catch(() => {});
    } catch { /* a helper that is not there is not a crash */ }
  }
  const timer = setIntervalFn && beatMs > 0 ? setIntervalFn(send, beatMs) : null;
  return {
    report(s) { last = { locked: !!s?.locked, stayOut: !!s?.stayOut }; send(); },
    last: () => (last ? { ...last } : null),
    destroy() { if (timer && clearIntervalFn) clearIntervalFn(timer); },
  };
}
