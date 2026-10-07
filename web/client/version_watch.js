// version_watch.js — A SCREEN PICKS UP A NEW VERSION OF THE SITE BY ITSELF, AT A QUIET MOMENT (2026-10-04).
//
// THE FINDING (the 2-hour bench soak, 2026-10-04): a screen never picks up a deploy. The bench's browser
// had been up 41 hours showing the page it loaded the night before, one deploy behind, because nothing
// ever reloads it. Every deploy is checked on the bench, so every check was of the code before it.
//
// So: poll `GET /api/version` (web/server/version.py: a hash of the client code being served), and when it
// changes, reload the screen ONCE, and only when nothing would be lost. Pages a person works in (Home, the
// landing) never reload by themselves: they show a quiet "A new version is ready" chip with a Reload button.
//
// *** THE SETTING, PER SCREEN: "Pick up new versions by itself", OFF BY DEFAULT (2026-10-04). *** Argued:
//   FOR on: the screen follows a deploy without anybody walking over to it - the bench is the whole reason
//      this exists - and it reloads only when idle, once per version, between two photos.
//   AGAINST, and it wins: a screen in a care facility may run this site around the clock, and with the
//      default on EVERY deploy would reach it within minutes, on its own. Today a deploy arrives only at its
//      next reboot or reload. The project's standing rule is that the live screen is never changed remotely
//      (the person who swaps it does so by hand, and the untouched unit is the rollback). So following
//      deploys has to be a choice made per screen: one row on the bench, where it is wanted. A row that
//      never chose stays exactly as screens are today - it never reloads itself.
//   (First written as ON by default; reversed by the coordinator before commit, for the reason above.)
//
// *** THE HOLD LIST: WHAT "IDLE" MEANS. *** The kiosk answers `hold()` with a reason or null; the reasons:
//   call       a live call, a call ringing (a Call panel's or the screen's own notice), the call view up
//   intercom   an intercom open (it is a call by another name)
//   game       a game started and not finished: a panel told the shell it is PLAYING (game_start.js
//              `PLAY_STATE_TOPIC`) and is not a slideshow or a video (see `playKindOf`). Since 2026-10-07 a game
//              says so only while somebody is playing it: from a press until `GAME_IDLE_MS` (5 minutes) with
//              none (game_start.js `createPlayWatch`), so a game left open does not hold a reload for ever
//   menu       the settings menu, or the dashboards tray, open
//   edit       an edit view or the map open
//   library    the Modules library standing in a panel's place
//   recording  a voice recording IN PROGRESS: an utterance heard and not yet saved, or a reading phrase
//              armed. NOT "recording is switched on" - that is a standing setting, and holding on it would
//              mean a screen that records never updates
//   dictation  a dictation window open. (A GAME's question waiting for a spoken answer counted here too until
//              2026-10-07; it is the game's own hold now, above - counted here, an open answer game never reloaded)
//   helping    somebody driving this screen from another one
//   unlocked   (2026-10-05, screen_lock.js) somebody unlocked this screen to use it for something else (a film):
//              the site stays out of it until it is locked again. A screen nobody ever locked never holds for this
//   input      somebody pressed something in the last `inputQuietMs` (2 minutes). ARGUED: it catches what
//              the list cannot name - a sentence half-built on the talking board, a note being read, a
//              caregiver halfway through something - for the price of a reload two minutes later.
// Nothing here has a ceiling: a screen that is never idle never reloads. ARGUED: every hold is a moment a
// reload would take something from somebody, and a version a few hours late costs nobody anything.
//
// *** THE QUIET MOMENT. *** Idle is required; a quiet moment is preferred. A SLIDESHOW playing: reload as
// the next photo comes up (`quiet('slideshow')`), or after `quietWaitMs` (2 minutes) if it never does - a
// slow slideshow must not hold a fix back for an hour. A VIDEO playing: reload only as it ends
// (`quiet('video')`), however long it is - cutting somebody's video off halfway is the thing to avoid.
//
// *** SAFE BY CONSTRUCTION. ***
//   * NEVER MORE THAN ONCE PER VERSION. A version acted on is written to session storage (it survives
//     the reload, in the same tab) and is never acted on again - so even a server that flaps between two
//     versions mid-deploy reloads a screen at most once for each.
//   * NEVER INTO A DEAD PAGE. Right before acting it asks the server once more, and only a real answer
//     (a 200 with the JSON) lets it reload. A reload while the network is down is the browser's own
//     "no internet" page on a screen nobody can fix - far worse than one deploy behind.
//   * A FAILED POLL IS NOTHING. Not a change, not a reason to do anything: it is counted (`fails`) and the
//     next poll tries again. Offline (`navigator.onLine` false), it does not even try.
//   * OFF MEANS OFF: no polls (one baseline request at boot, so turning it on later can see a deploy that
//     happened while it was off), nothing pending, nothing done.
//
// *** HOW OFTEN: EVERY 5 MINUTES. *** Argued: Mike deploys and then looks at the bench; ten minutes (the
// first guess) is ten minutes of looking at the old code. Each poll is a ~100-byte request that is a 304
// when nothing changed: 288 a day per screen, less traffic than one photo. Shorter buys little - the idle
// wait is usually longer than the poll anyway. A seam, not a person's setting: nobody should have to have
// an opinion about it.
//
// EVERYTHING DECIDING IS HERE AND PURE-ISH: the clock, the timers, the fetch and the storage are injected,
// so the suite (dev/version_watch_test.html) drives every branch a step at a time. The kiosk supplies the
// hold list and the reload (kiosk.js, "PICKING UP A NEW VERSION"); pages get `mountVersionChip`.

export const VERSION_URL = '/api/version';

export const PICK_UP_KEY = 'pickUpVersions';
export const PICK_UP_DEFAULT = false;     // argued in the header: following deploys is chosen per screen
/** The screen-level setting (kiosk.js puts it on the screen's row, Display tab). */
export const PICK_UP_FIELD = Object.freeze({
  key: PICK_UP_KEY,
  label: 'Pick up new versions by itself',
  kind: 'toggle',
  // `standard`: set once by whoever sets the screen up, like the call notice beside it. Not `essential`
  // (that level is legibility and the way out), not `advanced` ("keep this screen as it is" is ordinary).
  level: 'standard',
  default: PICK_UP_DEFAULT,
  onLabel: 'Yes, at a quiet moment',
  offLabel: 'No',
  note: 'When the site is updated, this screen restarts itself once, only when nothing is going on: no call, '
      + 'no game, no menu or editing, nobody pressing. It waits for the next photo, or the end of a video.',
});

/** Whether a screen's row wants it. A row that never chose follows the default (off). */
export function pickUpVersionsOf(row) {
  const v = row && row[PICK_UP_KEY];
  return typeof v === 'boolean' ? v : PICK_UP_DEFAULT;
}

export const VERSION_POLL_MS = 5 * 60 * 1000;
// How often a pending version re-asks "is it quiet yet". Local only (no network): cheap.
export const IDLE_CHECK_MS = 15 * 1000;
export const QUIET_WAIT_MS = 2 * 60 * 1000;
export const INPUT_QUIET_MS = 2 * 60 * 1000;
export const RELOADED_KEY = 'nimrod:version-reloaded';
const DONE_KEEP = 20;                 // versions remembered per tab: far more than one day's deploys

/**
 * What a panel that says it is PLAYING (`PLAY_STATE_TOPIC`) means here. `kind` is the panel's own word
 * (photos.js says 'slideshow', youtube.js 'video'); anything else - every game - is 'game', which holds.
 * A panel that does not say is a game on purpose: holding by mistake costs a late reload; not holding by
 * mistake costs somebody their game.
 */
export function playKindOf(payload) {
  const k = payload && payload.kind;
  return k === 'slideshow' || k === 'video' ? k : 'game';
}

const VERSION_RE = /^[A-Za-z0-9._:-]{4,80}$/;

/**
 * The version the server says, or null when the answer is not one (a 502 page mid-deploy, a captive
 * portal's login page, junk). A network failure THROWS: the watch counts it as a failed poll.
 * `fetchImpl` is looked up at call time, so a page's fetch can be replaced (the suites do).
 */
export async function fetchSiteVersion(fetchImpl = null, url = VERSION_URL) {
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));
  const r = await f(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!r || !r.ok) return null;
  let j = null;
  try { j = await r.json(); } catch { return null; }
  const v = j && typeof j.version === 'string' ? j.version.trim() : '';
  return VERSION_RE.test(v) ? v : null;
}

const defaultStorage = () => {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
};

/**
 * The watch. Returns { start, poll, check, quiet, state, destroy }.
 *   fetchVersion()   the server's version (string), null for "not an answer"; throwing is a failed poll
 *   enabled()        the setting
 *   hold()           a reason string while acting would take something from somebody, else null
 *   quietKind()      'slideshow' | 'video' | null: what on screen makes a "between" moment
 *   act(v, how)      reload (a screen) or show the chip (a page); `how` is 'idle' | 'quiet'
 *   confirm          ask the server once more right before acting (default true; a chip does not need it)
 */
export function createVersionWatch({
  fetchVersion = () => fetchSiteVersion(),
  enabled = () => true,
  hold = () => null,
  quietKind = () => null,
  act = () => {},
  online = () => (typeof navigator === 'undefined' || navigator.onLine !== false),
  storage = defaultStorage(),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  pollMs = VERSION_POLL_MS,
  checkMs = IDLE_CHECK_MS,
  quietWaitMs = QUIET_WAIT_MS,
  confirm = true,
  onState = null,
} = {}) {
  let known = null;           // the version this page is running (the first good answer)
  let pending = null;         // a newer version, waiting for a quiet moment
  let fails = 0;              // failed polls in a row
  let status = 'starting';
  let reason = null;
  let quietSince = null;
  let acting = false;
  let destroyed = false;
  let pollT = null;
  let checkT = null;
  const done = readDone();

  function readDone() {
    try {
      const a = JSON.parse(storage?.getItem?.(RELOADED_KEY) || '[]');
      return new Set(Array.isArray(a) ? a.filter((s) => typeof s === 'string').slice(-DONE_KEEP) : []);
    } catch { return new Set(); }
  }
  function writeDone() {
    try { storage?.setItem?.(RELOADED_KEY, JSON.stringify([...done].slice(-DONE_KEEP))); } catch { /* private mode: memory only */ }
  }
  const ask = (fn, fallback) => { try { return fn(); } catch (err) { console.error('version watch', err); return fallback; } };
  const holdNow = () => { const r = ask(hold, 'unknown'); return r ? String(r) : null; };
  const state = () => ({ known, pending, fails, status, reason, done: [...done] });
  function set(s, why = null) {
    status = s; reason = why;
    try { onState?.(state()); } catch (err) { console.error('version watch onState', err); }
  }
  async function get() {
    try { return (await fetchVersion()) || null; } catch { return null; }
  }
  function armCheck(ms) {
    if (destroyed || !pending) return;
    if (checkT != null) { try { clearTimer(checkT); } catch { /* gone */ } }
    checkT = setTimer(() => { checkT = null; check().catch((err) => console.error('version watch check', err)); }, Math.max(0, ms));
  }
  function drop() { pending = null; quietSince = null; }

  async function poll() {
    if (destroyed) return 'gone';
    // The baseline is taken even when off: one request at boot, so turning it on later can tell.
    if (known !== null && !ask(enabled, false)) { drop(); set('off'); return 'off'; }
    if (!ask(online, true)) { set('offline'); return 'offline'; }
    const v = await get();
    if (destroyed) return 'gone';
    if (!v) { fails += 1; set('failed'); return 'failed'; }
    fails = 0;
    if (known === null) { known = v; set('current'); return 'baseline'; }
    if (v === known) { drop(); set('current'); return 'same'; }
    if (done.has(v)) { drop(); set('current'); return 'already'; }
    if (!ask(enabled, false)) { drop(); set('off'); return 'off'; }
    if (pending !== v) { pending = v; quietSince = null; }
    set('pending');
    armCheck(0);
    return 'changed';
  }

  async function check() {
    if (destroyed || !pending || acting) return 'none';
    if (!ask(enabled, false)) { set('off'); return 'off'; }
    const why = holdNow();
    if (why) { quietSince = null; set('waiting', why); armCheck(checkMs); return 'waiting'; }
    const qk = ask(quietKind, null);
    if (qk === 'video') { set('quiet-wait', 'video'); armCheck(checkMs); return 'quiet-wait'; }
    if (qk === 'slideshow') {
      if (quietSince === null) quietSince = now();
      const left = quietWaitMs - (now() - quietSince);
      if (left > 0) { set('quiet-wait', 'slideshow'); armCheck(Math.min(checkMs, left)); return 'quiet-wait'; }
    }
    return go('idle');
  }

  /** A quiet moment happened: a photo changed ('slideshow') or a video ended ('video'). */
  async function quiet(kind = null) {
    if (destroyed || !pending || acting) return 'none';
    if (!ask(enabled, false) || holdNow()) return 'none';
    const qk = ask(quietKind, null);
    if (qk && kind && qk !== kind) return 'none';      // a photo changing is not the video's moment
    return go('quiet');
  }

  async function go(how) {
    if (acting) return 'acting';
    acting = true;
    try {
      if (!ask(online, true)) { set('offline'); armCheck(checkMs); return 'offline'; }
      let target = pending;
      if (confirm) {
        const v = await get();
        if (destroyed) return 'gone';
        if (!v) { fails += 1; set('failed'); armCheck(checkMs); return 'failed'; }
        fails = 0;
        if (v === known) { drop(); set('current'); return 'rolled-back'; }
        if (done.has(v)) { drop(); set('current'); return 'already'; }
        target = v;
      }
      // Asked again AFTER the await: a call can ring, a menu open, in the time the server took to answer.
      if (!ask(enabled, false)) { set('off'); return 'off'; }
      const why = holdNow();
      if (why) { pending = target; set('waiting', why); armCheck(checkMs); return 'waiting'; }
      done.add(target); writeDone();
      known = target; drop();
      set('acted', how);
      try { act(target, how); } catch (err) { console.error('version watch act', err); }
      return 'acted';
    } finally { acting = false; }
  }

  function armPoll() {
    if (destroyed || !(pollMs > 0)) return;
    pollT = setTimer(() => {
      pollT = null;
      poll().catch((err) => console.error('version watch poll', err)).finally(armPoll);
    }, pollMs);
  }

  return {
    start() { poll().catch((err) => console.error('version watch poll', err)).finally(armPoll); return this; },
    poll, check, quiet, state,
    destroy() {
      destroyed = true;
      if (pollT != null) { try { clearTimer(pollT); } catch { /* gone */ } pollT = null; }
      if (checkT != null) { try { clearTimer(checkT); } catch { /* gone */ } checkT = null; }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// THE CHIP, for pages a person works in (Home, the landing). Same watch, nothing held, no confirming fetch,
// and the act is SHOWING the chip, never reloading: somebody may be halfway through an edit, and Home's own
// "unsaved changes" question still stands between the Reload button and their work. "Not now" puts it away
// until a newer version. Theme variables only, with plain fallbacks for a page that has none.
// ---------------------------------------------------------------------------------------------------------
const CHIP_STYLE_ID = 'version-chip-style';
const CHIP_CSS = `
.vw-chip{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;
  max-width:calc(100vw - 32px);padding:6px 6px 6px 14px;border-radius:999px;
  background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--line,rgba(0,0,0,.18));
  box-shadow:0 2px 10px rgba(0,0,0,.18);font:600 14px/1.3 var(--font,system-ui,sans-serif)}
.vw-chip[hidden]{display:none}
.vw-chip button{font:inherit;cursor:pointer;border-radius:999px;min-height:32px;padding:0 12px;
  border:1px solid var(--accent,#2c6e49);background:var(--surface,#fff);color:var(--text,#111)}
.vw-chip button[data-version-reload]{background:var(--accent,#2c6e49);color:var(--on-accent,#fff)}
.vw-chip button[data-version-later]{border-color:transparent;padding:0 10px}
`;
let currentChip = null;
/** The chip mounted on this page, if any (a suite finds it through here). */
export function pageVersionChip() { return currentChip; }

export function mountVersionChip({
  doc = (typeof document !== 'undefined' ? document : null),
  host = null,
  fetchVersion = () => fetchSiteVersion(),
  pollMs = VERSION_POLL_MS,
  reload = () => { if (typeof location !== 'undefined') location.reload(); },
  setTimer, clearTimer,
} = {}) {
  if (!doc) return null;
  if (!doc.getElementById(CHIP_STYLE_ID)) {
    const st = doc.createElement('style');
    st.id = CHIP_STYLE_ID;
    st.textContent = CHIP_CSS;
    (doc.head || doc.documentElement).append(st);
  }
  let el = null;
  function hide() { if (el) el.hidden = true; }
  function show() {
    if (!el) {
      el = doc.createElement('div');
      el.className = 'vw-chip';
      el.setAttribute('role', 'status');
      el.dataset.versionChip = '';
      el.innerHTML = '<span>A new version is ready</span>'
        + '<button type="button" data-version-reload>Reload</button>'
        + '<button type="button" data-version-later aria-label="Not now" title="Not now">×</button>';
      el.querySelector('[data-version-reload]').addEventListener('click', () => { try { reload(); } catch (err) { console.error('version chip', err); } });
      el.querySelector('[data-version-later]').addEventListener('click', hide);
      (host || doc.body || doc.documentElement).append(el);
    }
    el.hidden = false;
  }
  const watch = createVersionWatch({
    fetchVersion, act: () => show(), confirm: false, storage: null, pollMs,
    ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}),
  });
  const handle = {
    poll: async () => { const r = await watch.poll(); if (r === 'changed') await watch.check(); return r; },
    shown: () => !!el && !el.hidden,
    state: () => watch.state(),
    destroy() { watch.destroy(); el?.remove(); el = null; if (currentChip === handle) currentChip = null; },
  };
  currentChip = handle;
  // The first poll is the baseline; the timer's polls run through `check` by the watch's own scheduling.
  watch.start();
  return handle;
}
