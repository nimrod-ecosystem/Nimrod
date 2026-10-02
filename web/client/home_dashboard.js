// home_dashboard.js — THE HOME PAGE AS A DASHBOARD: its settings, where a signed-in person lands, the
// save history, and the DRAFT that makes Save mean something. Rows 2.29 and 2.30 (2026-09-30).
//
// Mike, 2.29: "what is currently the modules tab should just be the home page", and on first sign-in
// it "opens up with the profile module. In the edit view. The settings menu can have a setting to
// open up in edit or live view." 2.30: "An option to save that module ... save as or maybe a warning
// popup if you're going to overwrite ... a save history ... save last X versions ... A way to select
// which module your viewing." The page is `modules.html`; this file is everything on it that can be
// tested without a page: pure functions and one small factory (`createDraft`).
//
// *** EXPLICIT SAVE, ON THIS PAGE ONLY. *** Everywhere else in the product a change saves as it is made
// (composer.js, the kiosk's own menu). Here, a SETTING changed on the module you are looking at is held
// in a draft until Save; what the module does while you use it (a score, where a slideshow is up to)
// is not a setting and saves as it always did. That split is `isSetting` below: a key the module
// DECLARES in its settings (settings_fields.js), plus the per-panel background. The real kiosk is not
// touched by any of this -- it never loads this file -- so a screen nobody is at keeps autosaving.
//
// *** NOTHING HERE WAITS ON ANYBODY. *** A draft that is never saved is simply never written; a page
// left with unsaved changes asks only as the browser's own "leave this page?", which a person at a
// computer answers and a screen nobody is at never shows (the kiosk is not this page).
//
// DEFAULTS, every one a setting (Mike's Rule 1), argued where it is declared:
//   openIn 'edit'           Mike: first sign-in opens the profile "in the edit view".
//   keepVersions 20         Mike's own question ("keep the last 20?"). Design's prototype said 10; 20 is
//                           cheap (a version is a few hundred bytes of settings) and costs nobody a
//                           version they wanted. Choices 5 / 10 / 20 / 50, Design's.
//   warnOverwrite true      Design: "Warn before saving over", On by default.
//   chromeSurface 'follow'  Mike: "follow scene settings ... Make see through the default". Following
//                           reads the screen's own panel background; a screen that never chose one
//                           gets see-through here (see `chromeSurfaceFor`).
//   welcomeDone false       the welcome card shows until somebody says "Don't show this again".
//   barHideMs 6000          in full screen the bar tucks itself away after this long (Design: 6 s). FOR
//                           6: entering full screen is itself a press on the bar, and the next thing
//                           somebody new wants is often the way back out, so the bar should still be
//                           there to be read; the kiosk's own bar uses 3 s for a screen nobody is at.
//                           AGAINST: 6 s of bar over a full-screen photo is 6 s of the photo covered.
//                           Design's number wins until somebody sits at it; 0 ("Never") is one press
//                           away for anybody who wants the bar to stay.
//
// *** WHERE THE PAGE'S ACTIONS LIVE (2026-09-30 follow-up). *** Design put Modules, Save, Save as and
// History INSIDE the real transport bar, and the page settings INSIDE the one ⚙ menu. The page hands the
// embedded kiosk a `host` (kiosk.js); what that host shows is built here (`homeBarItems`, `homeMenuModel`,
// `homeShellLabel`) so the bar and the menu can be checked without a page. Every one of them names an
// `act`, and the page's ONE `press(act)` does it -- Save is the same thing from the bar, the menu, the
// fallback bar and a switch.

import { fieldsFor } from './settings_fields.js';

export const HOME_STATE_KEY = 'home';            // per-PERSON state key for the settings below
// *** YOUR HOME IS YOUR PROFILE (Mike, 2026-10-02): "The profiles are wrong. That's what the rooms and stuff
// are for ... I'm expecting the home page to be your profile, and you add whatever modules you want to make
// it your own." *** The picker's first row is the person's Home: a dashboard they started from one of the
// examples (dashboards.js EXAMPLE_ORDER) and then made their own. The subject keeps the id 'profile' -- it
// is in links (`?m=profile`), the cat's "Open my profile" and saved walks -- and its title is Your Home.
export const PROFILE_SUBJECT = 'profile';        // the picker's "Your Home" row
export const HOME_TITLE = 'Your Home';
export const HISTORY_PREFIX = 'history-';        // + an instance id, on the screen it lives on
export const PROFILE_HISTORY_KEY = 'history';    // on the profile's own screen
export const KEEP_CHOICES = Object.freeze([5, 10, 20, 50]);
export const CHROME_SURFACES = Object.freeze(['solid', 'veil', 'clear']);
// The key kiosk.js stores a panel's own background under, on the panel's state row.
export const INSTANCE_SURFACE_KEY = 'instancePanelSurface';
// Keys on a SCREEN's settings row that are not settings somebody changes from a menu: the arrangement
// (composer.js owns it, and it autosaves there), the links between modules, and /game/'s stamp.
export const SCREEN_ROW_NOT_SETTINGS = Object.freeze(['kiosk', 'links', 'game']);

// Full screen's bar delay: the choices, in ms (0 = never tuck). Kept in step with shell_verbs.js's.
export const BAR_HIDE_CHOICES = Object.freeze([0, 3000, 6000, 10000, 30000]);

// `homeId` (2026-10-02): WHICH dashboard is this person's Home -- the one made when they picked a starting
// point. null until they pick one (Home then shows the examples up front). Not a menu row: it changes by
// picking ("Start from an example…" makes another and makes it Home; the old one stays in My dashboards).
export const HOME_DEFAULTS = Object.freeze({
  openIn: 'edit', keepVersions: 20, warnOverwrite: true, chromeSurface: 'follow', welcomeDone: false,
  barHideMs: 6000, homeId: null,
});
// An id, not prose (layout.js OPENS_MAX's reasoning): long enough for any id the server makes.
const HOME_ID_MAX = 200;

// What the page's settings panel shows, in order. Each row CYCLES on a press and wraps (Design, and
// settings_fields.js's one-switch rule: a control that stops at its end strands somebody there).
export const HOME_SETTINGS = Object.freeze([
  { key: 'openIn', label: 'Open my Home in',
    options: [['edit', 'Edit view'], ['live', 'Live view']] },
  { key: 'keepVersions', label: 'Keep the last',
    options: KEEP_CHOICES.map((n) => [n, `${n} saved versions`]) },
  { key: 'warnOverwrite', label: 'Warn before saving over',
    options: [[true, 'On'], [false, 'Off']] },
  { key: 'chromeSurface', label: 'Menu and bar background',
    options: [['follow', 'Follow the screen'], ['solid', 'Solid'], ['veil', 'See-through'], ['clear', 'Fully clear']] },
  { key: 'barHideMs', label: 'In full screen, tuck the bar away after',
    options: BAR_HIDE_CHOICES.map((ms) => [ms, ms ? `${ms / 1000} seconds` : 'Never']) },
]);

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/** Stored settings -> every key present and valid. Anything unknown falls back to its default. */
export function readHomeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...HOME_DEFAULTS };
  for (const row of HOME_SETTINGS) {
    if (row.options.some(([v]) => v === r[row.key])) out[row.key] = r[row.key];
  }
  out.welcomeDone = r.welcomeDone === true;
  out.homeId = typeof r.homeId === 'string' && r.homeId.trim() && r.homeId.length <= HOME_ID_MAX ? r.homeId : null;
  return out;
}

/** The next value of one setting, wrapping at the end. */
export function cycleHomeSetting(settings, key) {
  const row = HOME_SETTINGS.find((r) => r.key === key);
  if (!row) return { ...settings };
  const at = row.options.findIndex(([v]) => v === settings[key]);
  return { ...settings, [key]: row.options[(at + 1) % row.options.length][0] };
}

export function homeSettingLabel(settings, key) {
  const row = HOME_SETTINGS.find((r) => r.key === key);
  const hit = row && row.options.find(([v]) => v === settings[key]);
  return hit ? hit[1] : '';
}

/** The menu and bar background on this page. "Follow" takes the screen's own panel background when it
 *  chose one, and see-through when it did not (Mike: see-through is the default). */
export function chromeSurfaceFor(settings, screenPanelSurface) {
  const pick = settings && settings.chromeSurface;
  if (CHROME_SURFACES.includes(pick)) return pick;
  return CHROME_SURFACES.includes(screenPanelSurface) ? screenPanelSurface : 'veil';
}

// ---------------------------------------------------------------------------------------------------
// WHAT THE BAR AND THE MENU SHOW (the host, 2026-09-30 follow-up).
//
// `view` is what the page knows right now: { title, target, dirty, busy, pickerOpen, docCurrent,
// settings }. `target` is the page's HOME.target (null while nothing is open, `{ live, kind }` after).
// ---------------------------------------------------------------------------------------------------
/** The status, in words (Design: "what state the module is in, in words"). */
export function homeStatusText({ target = null, dirty = false, docCurrent = null } = {}) {
  if (!target) return '';
  if (!target.live) return target.kind !== 'module' ? 'Not made yet — Save makes it' : 'Not on your screen yet — Save adds it';
  if (dirty) return 'Unsaved changes';
  return docCurrent ? `Saved as “${docCurrent}”` : 'Not saved under a name yet';
}

/**
 * The bar's first group, in Design's order. Every button is always there; one that cannot act now is
 * DISABLED (dimmed), never left out. Save is the primary button while there is something to save.
 * Edit / Done editing and Full screen are NOT here: they are the bar's own ⚙ and ⛶ (`homeShellLabel`).
 */
// *** "SWITCH MODULE", ON THE REAL BAR (Mike, 2026-10-02: "modules on a dashboard should be as hot swappable
// as possible"). *** On your Home, the bar's Panel ▸ already chooses a panel; Switch module swaps THAT one
// for another in the same place (home_profile.js swapInLayout). It is a host item, so it is drawn by the
// placed bar like Save, with no change to the bar itself. Dimmed where it cannot act (a module page, a Home
// not made yet), never hidden. `canSwitch`: the page says whether a live Home is on the stage.
export function homeBarItems({ title = '', target = null, dirty = false, busy = false, pickerOpen = false,
  docCurrent = null, canSwitch = false, switchOpen = false } = {}) {
  const t = target;
  return [
    { act: 'picker', label: `Modules: ${title || '…'}`, title: 'choose what you are looking at', expanded: !!pickerOpen },
    { act: 'save', label: 'Save', title: 'keep what you changed', disabled: !t || busy, primary: !!t && (dirty || !t.live) },
    { act: 'saveas', label: 'Save as…', title: 'keep a copy under a new name', disabled: !t || busy },
    { act: 'history', label: 'History', title: 'your last saves; restoring deletes nothing', disabled: !t || !t.live || busy },
    { act: 'switch', label: 'Switch module', title: 'another module in the place of the one Panel ▸ chose',
      disabled: !canSwitch || busy, expanded: !!switchOpen },
    { kind: 'status', text: homeStatusText({ target: t, dirty, docCurrent }), dirty: !!dirty },
  ];
}

/** Words for the bar's own gear and full-screen buttons on Home: the gear IS Edit (edit view is the
 *  menu open), and ⛶ IS Full screen. Null = leave that button as it is. */
export function homeShellLabel(act, { menuOpen = false, full = false } = {}) {
  if (act === 'settings') return menuOpen ? '⚙ Done editing' : '⚙ Edit';
  if (act === 'fs') return full ? '⛶ Leave full screen' : '⛶ Full screen';
  return null;
}

/**
 * The ⚙ menu's section for this page (settings.js items, each with the `act` the page's press does).
 * The same actions as the bar, so they are reachable even when no placed bar is there (the plain bar's
 * ⚙ opens this menu), then the page's settings -- each row cycles on a press and wraps -- then the
 * welcome and Nimrod's walk. Rows that cannot act are disabled (the menu's scan skips them).
 */
export function homeMenuModel({ title = '', target = null, dirty = false, busy = false, docCurrent = null,
  settings = HOME_DEFAULTS, catReady = true, canSwitch = false } = {}) {
  const s = readHomeSettings(settings);
  const t = target;
  const item = (act, label, extra = {}) => ({ kind: 'item', id: `home:${act}`, act, label, ...extra });
  return [
    { kind: 'heading', id: 'home-head', label: 'This page (Home)' },
    item('picker', `Modules: ${title || '…'}`, { hint: 'choose what you are looking at' }),
    item('save', 'Save', { hint: homeStatusText({ target: t, dirty, docCurrent }) || 'nothing open', disabled: !t || busy }),
    item('saveas', 'Save as…', { hint: 'a copy under a new name', disabled: !t || busy }),
    item('history', 'History…', { hint: `your last ${s.keepVersions} saves`, disabled: !t || !t.live || busy }),
    item('switch', 'Switch module…', { hint: 'another module in the place of the chosen one', disabled: !canSwitch || busy }),
    // The starting points are up front on the page; this row is how a switch (or the plain bar's ⚙) gets
    // back to them once a Home exists.
    item('examples', 'Start from an example…', { hint: 'ready-made Homes to begin from' }),
    ...HOME_SETTINGS.map((r) => item(`set:${r.key}`, r.label, { hint: homeSettingLabel(s, r.key) })),
    // (Its id is the old welcome card's; since 2026-10-02 the starting points are what greets you.)
    item('rewelcome', 'Show the examples when I arrive', { hint: 'they open up front again, until you say not to' }),
    item('cat', 'Show me how', { hint: 'Nimrod the cat walks you through this page', disabled: !catReady }),
  ];
}

// ---------------------------------------------------------------------------------------------------
// WHERE A VISITOR LANDS (row 2.29).
//
// Signed OUT: the page it always was -- the parts, described, one of them running. Signed IN: Home.
// Without `?m=`, Home opens on the person's profile, in the view their setting says, with the welcome
// card until they have said not to show it. With `?m=<type>`, the module they asked for, live -- a
// link to one module is a request to look at it, not to edit it.
// ---------------------------------------------------------------------------------------------------
export function homeLanding({ signedIn = false, wanted = null, known = () => false, settings = HOME_DEFAULTS } = {}) {
  const s = readHomeSettings(settings);
  if (!signedIn) {
    return { home: false, subject: wanted && known(wanted) ? wanted : null, view: 'live', welcome: false };
  }
  if (wanted && wanted !== PROFILE_SUBJECT && known(wanted)) {
    return { home: true, subject: wanted, view: 'live', welcome: false };
  }
  return { home: true, subject: PROFILE_SUBJECT, view: s.openIn, welcome: !s.welcomeDone };
}

// ---------------------------------------------------------------------------------------------------
// THE SAVE HISTORY (row 2.30; change list C$7).
//
// One JSON doc per thing that can be saved, stored as ordinary state on the screen it belongs to:
//   { current: <the name it was last saved under> | null,
//     saved:   { <name>: <snapshot> },            -- "Save as" copies, kept until somebody saves over one
//     versions:[ { name, at, snapshot, restoredFrom? } ] }   -- newest first, the last `keep` of them
// A snapshot is `{ <state key>: { <setting>: value } }` -- settings only (see the header).
//
// *** RESTORING NEVER DELETES. *** A restore opens the old version as unsaved changes (Design); saving
// it then adds a NEW version on top, so the one you restored over is still in the list.
// *** PRUNING HAPPENS ONLY ON A SAVE. *** Lowering "Keep the last" deletes nothing by itself; the next
// save trims to the new number. So trying a smaller number and changing your mind costs nothing.
// ---------------------------------------------------------------------------------------------------
export const emptyHistory = () => ({ current: null, saved: {}, versions: [] });

export function readHistory(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const saved = r.saved && typeof r.saved === 'object' ? r.saved : {};
  const versions = Array.isArray(r.versions)
    ? r.versions.filter((v) => v && typeof v.name === 'string' && typeof v.at === 'number' && v.snapshot)
    : [];
  const current = typeof r.current === 'string' && Object.prototype.hasOwnProperty.call(saved, r.current)
    ? r.current : null;
  return { current, saved: { ...saved }, versions: versions.map((v) => ({ ...v })) };
}

export const cleanName = (name) => String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 60);

export function wouldOverwrite(doc, name) {
  const n = cleanName(name);
  return !!n && Object.prototype.hasOwnProperty.call(readHistory(doc).saved, n);
}

/**
 * What pressing Save (or choosing a name in Save as) should do:
 *   'name'   nothing has a name yet -- ask for one (Save as)
 *   'warn'   it would replace a saved one, and the person wants to be asked
 *   'commit' just save
 */
export function saveDecision({ doc, name = null, warn = true, saveAs = false } = {}) {
  const d = readHistory(doc);
  const target = saveAs ? cleanName(name) : (d.current || null);
  if (!target) return { action: 'name', name: null };
  if (warn && wouldOverwrite(d, target)) return { action: 'warn', name: target };
  return { action: 'commit', name: target };
}

/** Save `snapshot` under `name`: it becomes the current save, and the newest version. */
export function commitVersion(doc, { name, snapshot, at = Date.now(), keep = HOME_DEFAULTS.keepVersions, restoredFrom = null } = {}) {
  const d = readHistory(doc);
  const n = cleanName(name);
  if (!n) throw new Error('commitVersion: a name is required');
  const k = KEEP_CHOICES.includes(keep) ? keep : (Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : HOME_DEFAULTS.keepVersions);
  const v = { name: n, at, snapshot: clone(snapshot || {}) };
  if (restoredFrom != null) v.restoredFrom = restoredFrom;
  return {
    current: n,
    saved: { ...d.saved, [n]: clone(snapshot || {}) },
    versions: [v, ...d.versions].slice(0, k),
  };
}

export function versionSnapshot(doc, i) {
  const v = readHistory(doc).versions[i];
  return v ? clone(v.snapshot) : null;
}

/** Ready-made names for Save as (Design: choosing a name is one press; typing with one switch is slow). */
export function suggestNames(doc, { base = '', day = '' } = {}) {
  const d = readHistory(doc);
  const out = [];
  const add = (n) => { const c = cleanName(n); if (c && !out.includes(c)) out.push(c); };
  if (d.current) add(`${d.current} (copy)`);
  add(base);
  if (day) add(`${base || 'My'} for ${day}`.trim());
  add('Evening');
  add('For visitors');
  for (const n of Object.keys(d.saved)) add(n);
  return out.slice(0, 7);
}

// ---------------------------------------------------------------------------------------------------
// WHICH KEYS ARE SETTINGS.
// ---------------------------------------------------------------------------------------------------
/** A module instance's row: what its manifest declares, plus the per-panel background. */
export function settingKeysFor(manifest) {
  const keys = new Set(fieldsFor(manifest).map((f) => f.key));
  keys.add(INSTANCE_SURFACE_KEY);
  return (k) => keys.has(k);
}
/** A screen's settings row: everything but the arrangement, the links and the game's stamp. */
export const isScreenSetting = (k) => !SCREEN_ROW_NOT_SETTINGS.includes(k);

// ---------------------------------------------------------------------------------------------------
// THE DRAFT.
//
// `wrap(handle, key, isSetting)` returns a state handle with the SAME shape as `state.js`'s, which the
// kiosk and every module use unchanged. A `set()` is split: settings go to the draft (and every
// subscriber sees them at once, so the module and the menu show the change), everything else goes
// straight to the real handle. `get()` and subscribers see the real row with the draft on top.
//
// A wrapped row can be re-wrapped (the embed rebuilds itself); the draft is kept by KEY, so it survives.
// `seed()` puts values in the draft without calling it a change (a preview's starting setup);
// `restore()` puts a saved snapshot back AS a change. `commitLive()` writes every draft row to the real
// handle it was wrapped around and clears it; a page saving somewhere else (a preview that becomes
// real) reads `pending()`, writes it itself, and calls `reset()`.
// ---------------------------------------------------------------------------------------------------
//
// *** A MODULE SETTING ITSELF UP IS NOT AN EDIT. *** `isUserEdit()` is asked on every held write. Photos
// picks its only source by itself as it starts (`state.set({ sourceId })`), with nobody touching
// anything; holding that as "Unsaved changes" put a leave-this-page question in front of somebody who
// had changed nothing (found by module_try_test). So a setting written when the host says nobody is
// editing goes straight through, as it always did; the page answers "was there a press or a key just
// now". Default: every write is an edit (the pure suite, and any host that does not say).
export function createDraft({ onChange = () => {}, isUserEdit = () => true } = {}) {
  const rows = new Map();       // key -> { base, isSetting, subs:Set<fn> }
  const overlays = new Map();   // key -> { setting: value }
  let dirty = false;

  const changed = () => { try { onChange(); } catch (err) { console.error('home draft: onChange', err); } };
  const merged = (key) => {
    const e = rows.get(key);
    const base = e ? (e.base.get() || {}) : {};
    return { ...base, ...clone(overlays.get(key) || {}) };
  };
  const notifyRow = (key) => {
    const e = rows.get(key);
    if (!e) return;
    for (const fn of [...e.subs]) { try { fn(); } catch (err) { console.error('home draft: subscriber', err); } }
  };

  function wrap(base, key, isSetting = () => true) {
    if (!base) return base;
    const entry = { base, isSetting, subs: new Set() };
    rows.set(key, entry);
    return {
      ...base,
      async load(...a) { await base.load?.(...a); return merged(key); },
      get: () => merged(key),
      set(patch = {}) {
        const own = {}; const held = {};
        const editing = !!isUserEdit();
        for (const [k, v] of Object.entries(patch || {})) (editing && entry.isSetting(k) ? held : own)[k] = v;
        if (Object.keys(own).length) base.set(own);
        if (Object.keys(held).length) {
          overlays.set(key, { ...(overlays.get(key) || {}), ...clone(held) });
          dirty = true;
          notifyRow(key);
          changed();
        }
      },
      subscribe(fn) {
        const w = () => fn(merged(key));
        entry.subs.add(w);
        const off = base.subscribe ? base.subscribe(w) : () => {};
        return () => { entry.subs.delete(w); try { off(); } catch { /* already gone */ } };
      },
    };
  }

  function seed(key, values = {}) {
    overlays.set(key, { ...(overlays.get(key) || {}), ...clone(values) });
    notifyRow(key);
  }

  /** Every drafted row's settings as they stand: the real row's settings with the draft on top. */
  function snapshot() {
    const out = {};
    for (const key of new Set([...rows.keys(), ...overlays.keys()])) {
      const e = rows.get(key);
      const base = e ? (e.base.get() || {}) : {};
      const pick = {};
      for (const [k, v] of Object.entries(base)) if (!e || e.isSetting(k)) pick[k] = v;
      out[key] = { ...clone(pick), ...clone(overlays.get(key) || {}) };
    }
    return out;
  }

  /** Put a saved snapshot back, as unsaved changes. Keys the snapshot does not name are left alone. */
  function restore(snap = {}) {
    for (const [key, values] of Object.entries(snap || {})) {
      overlays.set(key, { ...(overlays.get(key) || {}), ...clone(values || {}) });
      notifyRow(key);
    }
    dirty = true;
    changed();
  }

  function pending() {
    const out = {};
    for (const [key, ov] of overlays) if (Object.keys(ov).length) out[key] = clone(ov);
    return out;
  }

  async function commitLive() {
    for (const [key, ov] of [...overlays]) {
      const e = rows.get(key);
      if (!e || !Object.keys(ov).length) continue;
      e.base.set(clone(ov));
      await e.base.flush?.();
    }
    overlays.clear();
    dirty = false;
    for (const key of rows.keys()) notifyRow(key);
    changed();
  }

  function discard() {
    const keys = [...overlays.keys()];
    overlays.clear();
    dirty = false;
    for (const key of keys) notifyRow(key);
    changed();
  }

  /** A new subject: forget every row and every draft (nothing is written). */
  function reset() {
    rows.clear(); overlays.clear(); dirty = false;
    changed();
  }

  return {
    wrap, seed, snapshot, restore, pending, commitLive, discard, reset,
    dirty: () => dirty,
    wrapped: () => [...rows.keys()],
  };
}

/** Rename a snapshot's rows (a preview's ids -> the real ones it became). Unmapped rows are dropped. */
export function remapSnapshot(snap, map) {
  const out = {};
  for (const [key, values] of Object.entries(snap || {})) {
    const to = map[key];
    if (to) out[to] = clone(values);
  }
  return out;
}
