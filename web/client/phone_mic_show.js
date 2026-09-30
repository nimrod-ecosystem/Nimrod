// phone_mic_show.js — WHAT A PHONE SHOWS WHILE IT IS THE ROOM'S MICROPHONE, AND WHAT KEEPS IT AWAKE.
//
// Row 2.44. Mike, 2026-09-30: *"I'm thinking a phone stand by the monitor and put the clock or some
// other module on it while it charges."* And: *"Does it need to be an app. Can I turn off sleep and
// have it be a nimrod dashboard or module?"* No app: the phone page (`phone_mic.html`), a screen wake
// lock, and Android's screen pinning. This file is the two pieces that answer "a module on it":
//
//   * `mountShownModule` - one module, mounted on the phone page through the ordinary module
//     contract (`mountModule`), inside a box it cannot paint out of, and replaced by a plain
//     message if it fails - at import, at mount, at init, or later (an uncaught error from its file).
//     THE MICROPHONE DOES NOT DEPEND ON IT. The sender (`phone_mic.js`) never sees the module.
//   * `createWakeHold` - the screen wake lock, re-asked for when the page comes back, and an honest
//     status when the browser cannot or will not hold it, so the page can say what to do instead.
//
// ---------------------------------------------------------------------------------------
// WHY THE PHONE PAGE HOSTS THE MODULE, AND NOT A "PHONE MICROPHONE" MODULE IN A DASHBOARD
// ---------------------------------------------------------------------------------------
//
// Three ways in were on the table. Mike, on the several ways into one thing: *"they should all
// really just be the same thing."* Argued, both sides:
//
//  (a) THE PHONE PAGE HOSTS A MODULE (chosen). The page owns the microphone, the Stop button and the
//      "microphone on" bar; the module lives in a box below the bar.
//      FOR: the one promise that matters - *you can always see that this phone is listening, and
//      stop it with one press* - is kept by the code that holds the microphone, not by whoever lays
//      out a dashboard. The bar sits in the browser's TOP LAYER (a manual popover), above anything
//      a module can draw at any z-index; the module's box contains its paint, so even a
//      `position:fixed; inset:0` overlay stays inside it. A failing module costs a message, never
//      the microphone. Small: no kiosk, no drive socket as a screen, nothing else loaded.
//      AGAINST: one module, not a whole dashboard; and it is a second place that mounts modules
//      (after the kiosk and the modules page) - though through the same `mountModule` door, so it
//      is the same contract, not a copy of it.
//  (b) A `phone_mic` SENDER MODULE any dashboard can hold.
//      FOR: the most literal "same thing" - any layout, any neighbours, the kiosk's own chrome.
//      AGAINST, and these are why not today: (1) the module contract confines a module to
//      `ctx.mount`, so a sender module CANNOT draw a bar that no other panel covers - the kiosk
//      decides what is on top, can put another panel full screen, and can park the sender with
//      `onHide`, which would be a live microphone with nothing on screen saying so. Keeping the
//      promise would need a chrome-level slot in the kiosk (kiosk work, not this file's to take).
//      (2) A phone running the kiosk joins that person's drive room as a SCREEN, and the kiosk
//      mounts a phone-microphone RECEIVER on every screen - so the phone's own offer (fanned out to
//      every screen of the person) would reach its own receiver, which could answer first and turn
//      the real screen away as "busy". That needs "a screen that is sending does not receive"
//      before (b) is safe.
//  (c) BOTH, SHARING ONE SENDER. That is where this lands in time: the sender is already one piece
//      (`createPhoneMicSender`), and the wake hold and the module host here are separate, testable
//      pieces a sender module could reuse. When the kiosk has a slot nothing can cover, (b) is a thin
//      wrapper over the same three parts. Until then, (a) is the only one of the three whose
//      "microphone on" state is unmistakable by construction rather than by arrangement.
//
// ---------------------------------------------------------------------------------------
// WHICH MODULES A PHONE MAY SHOW, AND WHY IT IS A SHORT LIST
// ---------------------------------------------------------------------------------------
//
// NOT every module. A module on this page shares the room with an open microphone, so the list is
// the ones that (1) make no sound - anything that plays would be picked up and sent to the screen,
// and the page promises it plays nothing; (2) open no camera and no microphone of their own - the
// page promises "sound only, and never a camera"; and (3) need nothing from an account - the phone
// is signed in as somebody allowed to use the screen, and a module that reached into THAT person's
// screens from a phone in a stand would be a second, unannounced way in. The host enforces (2) as
// well as the list does: the camera and microphone owners it hands over refuse every request.
//
//   clock  - silent in its clock mode. Its timer and Pomodoro modes BEEP (a short tone at zero),
//            which the microphone would hear. Left in: somebody choosing a timer on the phone chose
//            the beep. On Mike's list.
//   pond   - calm water; silent, touch only.
//
// Growing the list is one line in `SHOW_CHOICES` + `MODULE_FILES`, after checking the three rules.
// Photos is the obvious next one and is NOT here yet: it needs a media source, and the one a phone
// would use is the account's server photos - rule (3). On Mike's list.
//
// THE MODULE'S OWN SETTINGS ARE KEPT ON THE PHONE (the browser's local store, under a `phone-mic`
// scope that no screen lists), not on any screen of the account. A clock on the phone set to 24-hour
// must not change the clock on the screen it is listening for. Its settings are reachable only
// through the module's own controls here - the universal settings menu lives in the kiosk.

import { mountModule } from './module.js';
import { createBus } from './bus.js';

// The choices on the phone page, in order. `none` keeps the original full-page "Microphone on".
export const SHOW_CHOICES = Object.freeze([
  Object.freeze({ value: 'clock', label: 'The clock' }),
  Object.freeze({ value: 'pond', label: 'Pond (calm water)' }),
  Object.freeze({ value: 'none', label: 'Nothing else: the whole screen says the microphone is on' }),
]);
// DEFAULT: the clock. Mike's own words for the stand ("put the clock ... on it while it charges").
// For the pillow, somebody picks "Nothing else" once and the phone remembers it.
export const DEFAULT_SHOW = 'clock';

export const MODULE_FILES = Object.freeze({
  clock: './modules/clock.js',
  pond: './modules/pond.js',
});

/** The choice, cleaned: anything unknown falls back to the default. Pure. */
export function showChoice(v) {
  return SHOW_CHOICES.some((c) => c.value === v) ? v : DEFAULT_SHOW;
}

export const labelOf = (type) => (SHOW_CHOICES.find((c) => c.value === type)?.label || 'This module');

// The plain message a failed module leaves behind. Says the one thing somebody at the phone needs:
// the microphone is not affected.
export const FAILED_TEXT = 'This could not be shown. The microphone is not affected.';

// ---------------------------------------------------------------------------------------
// OWNERS THAT SAY NO
// ---------------------------------------------------------------------------------------
// Handed to the module as `ctx.cameraOwner` / `ctx.micOwner`. Any call refuses, with a reason a
// module already knows how to show ("not allowed"). A module that ignores ctx and calls the browser
// directly is what the short list above is for.
function refusingOwner(what) {
  const no = () => { const e = new Error(`the phone microphone page does not open the ${what} for a module`); e.name = 'NotAllowedError'; return e; };
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;   // not a thenable, not a primitive
      if (prop === 'refuses') return true;
      return () => Promise.reject(no());
    },
  });
}

// ---------------------------------------------------------------------------------------
// THE MODULE, IN A BOX
// ---------------------------------------------------------------------------------------

/**
 * Mount `type` into `box`. Never throws: a failure anywhere - the import, the mount, `init()`, or
 * an uncaught error from the module's own file later - takes the module down and leaves
 * `FAILED_TEXT` in the box. Returns `{ type, ok(), why(), fail(why), destroy() }`.
 *
 *   importModule(path)   loads the module's file (registers it). Injectable for tests.
 *   makeState/makeEvents per-instance handles; default: the browser's local store, `phone-mic` scope.
 *   win                  where uncaught errors are heard (`error` / `unhandledrejection`).
 */
export async function mountShownModule(box, type, {
  importModule = (path) => import(path),
  files = MODULE_FILES,
  makeState = null,
  makeEvents = null,
  win = (typeof window !== 'undefined' ? window : null),
  doc = box?.ownerDocument || (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!box || !doc) throw new Error('mountShownModule: a box is required');
  let rec = null;
  let ok = false;
  let why = null;
  let dead = false;
  const file = files[type] || null;
  const mount = doc.createElement('div');
  mount.className = 'pm-mod mod-box';
  mount.setAttribute('data-module', type);
  box.replaceChildren(mount);

  const offErr = [];
  function listen() {
    if (!win || !file) return;
    const tail = file.replace(/^\.\//, '/');
    const fromModule = (s) => typeof s === 'string' && s.includes(tail);
    const onError = (e) => { if (fromModule(e?.filename)) fail('crashed'); };
    const onRejection = (e) => { if (fromModule(e?.reason?.stack)) fail('crashed'); };
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    offErr.push(() => win.removeEventListener('error', onError), () => win.removeEventListener('unhandledrejection', onRejection));
  }

  function takeDown() {
    const r = rec; rec = null;
    if (r) { try { r.destroy(); } catch (err) { console.error('phone mic: module destroy', err); } }
  }
  function fail(reason) {
    if (dead || why) return;
    why = reason || 'failed';
    ok = false;
    takeDown();
    const p = doc.createElement('p');
    p.className = 'pm-mod-failed';
    p.setAttribute('role', 'status');
    p.textContent = FAILED_TEXT;
    box.replaceChildren(p);
  }

  if (!file) fail('unknown');
  else {
    try {
      await importModule(file);
      if (dead) return handle();
      let stateMaker = makeState;
      let eventsMaker = makeEvents;
      if (!stateMaker || !eventsMaker) {
        const { createLocalBackend } = await import('./local_store.js');
        const backend = createLocalBackend();
        stateMaker = stateMaker || ((key) => backend.makeState(key, {}, 'phone-mic'));
        eventsMaker = eventsMaker || ((key) => backend.makeEvents(key, {}, 'phone-mic'));
      }
      const instanceId = `phone-mic-${type}`;
      const state = stateMaker(instanceId);
      const events = eventsMaker(instanceId);
      state?.load?.().catch?.(() => {});
      events?.load?.().catch?.(() => {});
      const bus = createBus();
      rec = mountModule(type, {
        mount, bus, rootBus: bus, user: null, profileId: 'phone-mic', personId: null, instanceId,
        state, events,
        makeState: (key) => stateMaker(key), makeEvents: (key) => eventsMaker(key),
        makePersonState: () => null,
        output: null, audio: null, sources: null, callTransport: null, aim: null,
        micOwner: refusingOwner('microphone'), cameraOwner: refusingOwner('camera'),
        rand: Math.random,
      });
      if (dead) { takeDown(); return handle(); }
      rec.init();
      ok = true;
      listen();
    } catch (err) {
      console.error(`phone mic: could not show "${type}"`, err);
      fail('failed');
    }
  }

  function handle() {
    return {
      type,
      ok: () => ok && !why,
      why: () => why,
      fail,
      destroy() {
        dead = true;
        for (const off of offErr.splice(0)) { try { off(); } catch { /* gone */ } }
        takeDown();
        box.replaceChildren();
      },
    };
  }
  return handle();
}

// ---------------------------------------------------------------------------------------
// THE SCREEN WAKE LOCK
// ---------------------------------------------------------------------------------------
//
// A browser takes the microphone away when the phone locks or the page goes to the background
// [training knowledge], so the screen must stay on while the microphone is. Statuses:
//   off          not wanted (the microphone is off)
//   held         the browser is keeping the screen on
//   unsupported  this browser has no wake lock (older browsers, or a page not served over https)
//   refused      the browser said no (battery saver can do this)
//   paused       the page is hidden; asked for again when it comes back
//   lost         the browser let it go while the page was showing; asked for again when it comes back
// Anything but `held` while wanted is a reason for the page to say what to do instead.

export const WAKE_STATUSES = ['off', 'held', 'unsupported', 'refused', 'paused', 'lost'];

export function createWakeHold({
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  doc = (typeof document !== 'undefined' ? document : null),
  onChange = null,
} = {}) {
  let want = false;
  let lock = null;
  let status = 'off';
  let asking = null;
  const set = (s) => {
    if (s === status) return;
    status = s;
    try { onChange?.(s); } catch (err) { console.error('wake hold onChange', err); }
  };

  async function acquire() {
    if (!want || lock) return status;
    const wl = nav?.wakeLock;
    if (!wl || typeof wl.request !== 'function') { set('unsupported'); return status; }
    if (doc?.hidden) { set('paused'); return status; }        // a hidden page is always refused
    if (asking) return asking;
    asking = (async () => {
      try {
        const l = await wl.request('screen');
        if (!want) { try { await l?.release?.(); } catch { /* gone */ } return status; }
        lock = l;
        set('held');
        l?.addEventListener?.('release', () => {
          if (lock !== l) return;
          lock = null;
          // Not re-asked here: a browser that lets go while the page is showing (battery saver)
          // would refuse again at once, and a loop of asking is worse than saying so.
          if (want) set(doc?.hidden ? 'paused' : 'lost');
        });
      } catch {
        lock = null;
        if (want) set('refused');
      } finally { asking = null; }
      return status;
    })();
    return asking;
  }

  const onVis = () => {
    if (!want) return;
    if (doc.hidden) { if (!lock) set('paused'); return; }
    acquire();
  };
  doc?.addEventListener?.('visibilitychange', onVis);

  return {
    hold() { want = true; return acquire(); },
    release() {
      want = false;
      const l = lock; lock = null;
      try { l?.release?.(); } catch { /* gone */ }
      set('off');
    },
    status: () => status,
    held: () => !!lock,
    destroy() { this.release(); doc?.removeEventListener?.('visibilitychange', onVis); },
  };
}

/** What the page says for a wake status while the microphone is on. '' = nothing to say. Pure. */
export function wakeNote(status) {
  switch (status) {
    case 'unsupported':
      return 'This browser cannot keep the screen on by itself, and the microphone stops when the screen sleeps. '
        + 'Set the phone’s screen timeout to its longest, or keep it charging with “Stay awake” turned on.';
    case 'refused':
      return 'The phone would not keep the screen on (battery saver can do this). '
        + 'Turn battery saver off, or set the screen timeout to its longest, or the microphone stops when the screen sleeps.';
    case 'lost':
      return 'The phone stopped keeping the screen on. Tap the screen to keep it awake, or set the screen timeout to its longest.';
    default:
      return '';
  }
}

// Help text for the setup page. Android's menus differ by maker and version; the wording says so.
// [training knowledge - not checked on Mike's phone.]
export const KEEP_ON_HELP = `
  <p><b>Keep the screen on.</b> This page asks the phone to keep its screen on while the microphone
    is on. For a phone that lives in a stand, also set the screen timeout to its longest
    (Settings, Display). On Android, “Stay awake” keeps the screen on while charging: it is in
    Developer options (tap Build number seven times under About phone to show them).</p>
  <p><b>Pin this page</b> so it stays in front. On Android: turn on App pinning (Settings, Security,
    or Security and privacy, then More security settings; the name and place differ by phone). Then
    open this page, open Recent apps, tap the browser’s icon at the top of its card, and choose Pin.
    To unpin, hold Back and Recent apps together (or swipe up and hold).</p>
  <p><b>Charging.</b> Charge the phone in its stand, not under or on a pillow.</p>`;
