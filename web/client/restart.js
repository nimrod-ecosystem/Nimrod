// restart.js — what a screen does when the power comes back.
//
// Mike, describing the case this exists for: *"when things go wonky and someone wants to
// cold boot."* Power-cycling is the universal repair, and today it lands you back in
// whatever state was wonky — same screen, first module. There has to be a way to say
// "when this comes back, go somewhere known-good."
//
// THREE HONEST OPTIONS, and no fourth:
//   resume  — where she was, module and all. Best when nothing is wrong.
//   top     — this screen, from the first module. Today's behavior, and the default,
//             because changing what existing screens do on reboot without being asked is
//             not a change anybody consented to.
//   screen  — a NAMED screen, whatever the URL happens to say. The escape hatch.
//
// WHY THIS IS DEVICE-LOCAL AND NOT ON THE SERVER — the one decision here worth arguing.
//
// Everything else in this project belongs to a PERSON and follows them between machines,
// and that is right for bindings, routing and themes. This is the exception, for two
// reasons that both point the same way:
//
//   1. IT MUST BE READABLE FROM WHATEVER SCREEN YOU LAND ON. If "boot to screen A" were
//      stored in screen A's settings, then being stuck on screen B — the actual failure —
//      would be the one situation where the setting cannot be found. A per-screen setting
//      solves the case where nothing is wrong and fails the case it exists for.
//   2. IT IS A RECOVERY PATH, so it has to work when the network does not. A cold boot
//      during an outage is exactly when somebody reaches for this. localStorage is on the
//      disk in the room; the server may as well be on the moon.
//
// The cost is honest and worth stating: a clinician cannot set this remotely. Someone has
// to be standing at the screen. For a repair gesture, that is who is there anyway.
//
// THE POSITION IS ALSO LOCAL, and for a plainer reason: "which module was showing" changes
// every time somebody presses next, and writing that to a server would be a network round
// trip per press, forever, to record something no other device wants to know.

//
// *** "AFTER A RESTART, OPEN:" (row 2.70, Mike 2026-10-09). *** *"Yes, have a chosen one. I want cold boot to be there
// for anyone that gets lost."* Three changes, and this file stays the one place the rule lives:
//   1. ONE ROW, A LIST. The three rows ("Pick up where it left off" / "Start this screen from the top" / "Always come
//      back to <the screen you are on>") are one choice row, "After a restart, open", whose values are Home (this
//      screen as it starts: 'top', still the default), "Where it left off" ('resume') and EVERY dashboard on the
//      account by name ('screen:<id>'). FOR the list: Mike's ask is to CHOOSE one, and the old gesture only offered
//      the one you happened to be standing on -- to choose "her pictures" you had to go there first. AGAINST: a list
//      is something to step through, the reason the old row named one screen. One row is also one stop on the
//      switch walk where there were three, so the walk is shorter, not longer.
//      THE DEFAULT, ARGUED: Home ('top'). A screen nobody set up behaves exactly as it did, and "Home" is a chosen
//      one in Mike's sense -- the dashboard the screen is opened on, never "the last one used". What Christine's
//      bench screen should open (her pictures full screen) is that screen's content, chosen on it, not a code default.
//   2. ONLY A RESTART. The chosen dashboard is opened on a COLD start (`isColdStart`): the browser started (the Pi
//      launcher says so with `?boot=1`, kiosk-launch.sh), or this tab opened the page for the first time (nothing in
//      sessionStorage yet). A reload -- a refresh, the recovery ladder's reload, a new version picked up -- is not a
//      restart and does not send anybody to the chosen dashboard.
//   3. A NEW VERSION KEEPS THE PERSON WHERE THEY WERE (`markKeepPlace` / `takeKeepPlace`). The version watch reloads
//      only when nothing is going on, and the person who was looking at a dashboard opened from Home should find it
//      there afterwards, on the same panel. Only that reload: a refresh or the recovery ladder lands on Home as it
//      always has (FOR keeping place on every reload: one rule. AGAINST, and it wins: the recovery ladder reloads a
//      screen because something on it stopped; putting the person straight back on that dashboard repeats the fault).
// Kept device-local, for the reasons above: the Pi carries its choice with it when it is swapped into a room.

export const MODES = ['resume', 'top', 'screen'];
export const DEFAULT_MODE = 'top';

const KEY = 'nimrod.restart';
// A page that has ALREADY bounced must not bounce again. Two screens each naming the other
// would otherwise ping-pong forever, and a redirect loop on a bedside screen is a black
// screen nobody can explain. sessionStorage is exactly the right lifetime: it survives the
// redirect and dies with the tab, so a real power cycle starts fresh.
const HOP = 'nimrod.restart.hopped';

const readJSON = (store, key) => {
  try { return JSON.parse(store.getItem(key) || 'null'); } catch { return null; }
};

const storeOf = (s) => s || (typeof localStorage !== 'undefined' ? localStorage : null);

// Everything for one account, in one row: { mode, screenId, positions: {profileId: index} }
export function readConfig(user, storage = undefined) {
  const store = storeOf(storage);
  if (!store) return { mode: DEFAULT_MODE, screenId: '', positions: {} };
  const all = readJSON(store, KEY) || {};
  const mine = all[user || ''] || {};
  return {
    mode: MODES.includes(mine.mode) ? mine.mode : DEFAULT_MODE,
    screenId: typeof mine.screenId === 'string' ? mine.screenId : '',
    positions: (mine.positions && typeof mine.positions === 'object') ? { ...mine.positions } : {},
  };
}

export function writeConfig(user, patch, storage = undefined) {
  const store = storeOf(storage);
  const next = { ...readConfig(user, storage), ...patch };
  if (!MODES.includes(next.mode)) next.mode = DEFAULT_MODE;
  if (!store) return next;
  try {
    const all = readJSON(store, KEY) || {};
    all[user || ''] = next;
    store.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode: the setting simply does not persist */ }
  return next;
}

export const readPosition = (user, profileId, storage = undefined) => {
  const n = readConfig(user, storage).positions[profileId];
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export function writePosition(user, profileId, index, storage = undefined) {
  if (!profileId || !Number.isInteger(index) || index < 0) return;
  const cfg = readConfig(user, storage);
  // Written whatever the mode is, so switching to "resume" later does not begin by
  // forgetting where she was.
  writeConfig(user, { positions: { ...cfg.positions, [profileId]: index } }, storage);
}

// PURE. What this page should do, given the config and where it currently is.
//
//   { redirectTo, stageIndex }
//
// `stageCount` clamps a remembered index: a screen can lose modules between boots, and
// restoring position 4 of a 2-module screen is a blank stage.
//   `cold`  (row 2.70) a restart: only then does a chosen dashboard take the device anywhere. Default true, so a
//           caller that never says is today's behavior.
//   `keep`  (row 2.70) a new version was picked up: the panel it was on, whatever the mode (`markKeepPlace`).
export function bootPlan({
  config = null,
  currentProfileId = '',
  stageCount = 0,
  hopped = false,
  cold = true,
  keep = false,
} = {}) {
  const cfg = config || { mode: DEFAULT_MODE, screenId: '', positions: {} };

  if (cold && cfg.mode === 'screen' && cfg.screenId && cfg.screenId !== currentProfileId && !hopped) {
    return { redirectTo: cfg.screenId, stageIndex: 0 };
  }
  if (cfg.mode === 'resume' || keep) {
    const want = cfg.positions[currentProfileId];
    const n = Number.isInteger(want) && want >= 0 ? want : 0;
    return { redirectTo: null, stageIndex: stageCount > 0 ? Math.min(n, stageCount - 1) : 0 };
  }
  return { redirectTo: null, stageIndex: 0 };
}

// The hop guard, kept here so the rule and its lifetime live together.
export function markHopped(storage = undefined) {
  const s = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  try { s?.setItem(HOP, '1'); } catch { /* private mode */ }
}
export function hasHopped(storage = undefined) {
  const s = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  try { return s?.getItem(HOP) === '1'; } catch { return false; }
}

// ---- A RESTART, TOLD FROM A RELOAD (row 2.70) ------------------------------------------------------------------
// The launcher's flag (kiosk-launch.sh adds it to the address it opens; nothing else does).
export const BOOT_PARAM = 'boot';
// This tab has loaded the page before. sessionStorage: survives a reload, dies with the browser.
const TAB = 'nimrod.restart.tab';
// A new version is being picked up: where the person was (`markKeepPlace`). One reload long.
const KEEP = 'nimrod.restart.keep';
const sessOf = (s) => s || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);

/** Whether `search` (a location.search) carries the launcher's `boot=1`. */
export function hasBootParam(search = '') {
  try { return new URLSearchParams(search || '').get(BOOT_PARAM) === '1'; } catch { return false; }
}
/** `href` with the launcher's flag taken out, so the page's own reloads are not restarts. */
export function withoutBootParam(href = '') {
  try {
    const u = new URL(href, 'http://x.invalid');
    u.searchParams.delete(BOOT_PARAM);
    return href.startsWith('http') ? u.href : `${u.pathname}${u.search}${u.hash}`;
  } catch { return href; }
}
/**
 * A COLD START: the launcher said so (`boot=1`, whatever else is true), or this tab has never got as far as starting
 * the screen (no mark in sessionStorage). The mark, not the browser's "this was a reload": kiosk.html reloads ITSELF
 * while it waits for the server after a power cut, and that is still the restart. Only with no sessionStorage to read
 * does the browser's word decide (`navType`: 'navigate' | 'reload' | 'back_forward' | ...).
 *   search    location.search          session   sessionStorage (or a stand-in)
 */
export function isColdStart({ search = '', session = undefined, navType = '' } = {}) {
  if (hasBootParam(search)) return true;
  const s = sessOf(session);
  try { if (s) return s.getItem(TAB) !== '1'; } catch { /* unreadable: decide by the browser's word */ }
  return navType !== 'reload' && navType !== 'back_forward';
}
/** This tab has now loaded the page: its next load is a reload, not a restart. */
export function markTab(session = undefined) {
  try { sessOf(session)?.setItem(TAB, '1'); } catch { /* private mode: every load is a restart, which is safe */ }
}
/** Before a new version's reload: where the person is (`boot` = the screen the page was opened on, `id` = showing). */
export function markKeepPlace(session = undefined, { boot = '', id = '' } = {}) {
  try { sessOf(session)?.setItem(KEEP, JSON.stringify({ boot, id })); } catch { /* the reload lands on Home */ }
}
/** After it: the place, once (it is removed as it is read), or null. */
export function takeKeepPlace(session = undefined) {
  const s = sessOf(session);
  let v = null;
  try { v = JSON.parse(s?.getItem(KEEP) || 'null'); } catch { v = null; }
  try { if (typeof s?.removeItem === 'function') s.removeItem(KEEP); else s?.setItem(KEEP, ''); } catch { /* read once is enough */ }
  return v && typeof v.boot === 'string' && typeof v.id === 'string' ? v : null;
}

// ---- WHAT THE SETTINGS MENU SHOWS: ONE ROW (row 2.70) -----------------------------------------------------------
// Kept next to the rules rather than in the kiosk, so the wording and the behavior cannot drift apart.
export const RESTART_HEADING = Object.freeze({ kind: 'heading', id: 'restart', label: 'When the power comes back' });
/** The row's key; with no id prefix its menu id is the same ('restart-open'). Not a settings-doc key: it is stored here. */
export const RESTART_KEY = 'restart-open';
const SCREEN_PREFIX = 'screen:';
/** The row's value for a config: 'top' | 'resume' | 'screen:<id>'. */
export function restartValue(cfg) {
  const c = cfg || {};
  if (c.mode === 'screen' && c.screenId) return `${SCREEN_PREFIX}${c.screenId}`;
  return c.mode === 'resume' ? 'resume' : 'top';
}
/** What to write for a value the row stepped to (writeConfig's patch). */
export function restartPatch(value) {
  const v = String(value || '');
  if (v.startsWith(SCREEN_PREFIX) && v.length > SCREEN_PREFIX.length) return { mode: 'screen', screenId: v.slice(SCREEN_PREFIX.length) };
  return { mode: v === 'resume' ? 'resume' : 'top' };
}
/**
 * The row: "After a restart, open" Home / Where it left off / each dashboard by name.
 *   screens   the account's dashboards ([{ id, name }]), as the picker lists them; may be empty (offline, not loaded)
 *   homeName  the name of the screen this page was opened on
 *   names     id -> name for a chosen dashboard the list does not have (yet)
 * A chosen dashboard missing from the list stays a choice ("the dashboard chosen before"), so opening the menu offline
 * never quietly changes what the device does.
 */
export function restartField({ cfg = null, screens = [], homeId = '', homeName = '', names = null } = {}) {
  const q = (n) => `“${n}”`;
  const options = [
    { value: 'top', label: homeName ? `Home, ${q(homeName)}` : 'Home' },
    { value: 'resume', label: 'Where it left off' },
  ];
  const now = restartValue(cfg);
  const seen = new Set();
  for (const d of Array.isArray(screens) ? screens : []) {
    if (!d || !d.id || seen.has(d.id)) continue;
    // Home is the first choice already; listed again only when it is the one chosen by name.
    if (d.id === homeId && now !== `${SCREEN_PREFIX}${d.id}`) continue;
    seen.add(d.id);
    options.push({ value: `${SCREEN_PREFIX}${d.id}`, label: q(String(d.name || '').trim() || 'A dashboard') });
  }
  if (now.startsWith(SCREEN_PREFIX) && !seen.has(now.slice(SCREEN_PREFIX.length))) {
    const nm = names && typeof names.get === 'function' ? names.get(now.slice(SCREEN_PREFIX.length)) : null;
    options.push({ value: now, label: nm ? q(nm) : 'The dashboard chosen before' });
  }
  // `essential`: the three rows it replaces showed at every level, and it is the setting behind "pull the plug and it
  // comes back somewhere known" -- part of the way out for somebody lost.
  return { key: RESTART_KEY, label: 'After a restart, open', kind: 'choice', level: 'essential', default: 'top', options };
}
