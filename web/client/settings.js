// settings.js — the UNIVERSAL SETTINGS MENU: the shell, and nothing else yet.
//
// One menu, referenced by every surface, rather than the per-module menus that Cici grew
// and then could not keep coherent (word game "players", vision probe "subject", press its
// own thing, five hand-rolled stylesheets). This slice builds the SHELL: it opens, it can
// be driven, it can be left. What a module contributes to it comes next.
//
// FOUR DECISIONS ARE BAKED IN HERE, and each one is the answer to a way this could fail.
//
// 1. THE MENU OWNS ITS NAVIGATION, and takes drive from whoever has it.
//    The obvious build is to hang this off the verb router. It is also wrong: the router
//    and the whole input bus live inside `inputs.js`, which is a HOME-side panel. The
//    KIOSK — the surface at the bedside, the one that matters — has no input bus at all
//    and is driven by its own keydown handler. A menu that needed the router would work
//    where nobody needs it and be absent where somebody does. So the shell exposes plain
//    imperative moves (`next` / `prev` / `select` / `back`), the kiosk calls them from its
//    key handler, and a host that DOES have a bus calls `attachBus()` to get the same
//    moves from `verb/*`. The day the input bus reaches the kiosk, this menu is already
//    switch-operable with no rewrite.
//
// 2. THE SHELL RENDERS EVERY CONTROL. Modules declare their settings as DATA (see
//    `settings_fields.js`), not as DOM they render themselves. This is not tidiness. If a
//    module hands over
//    its own markup, the shell does not know what the controls ARE, so it cannot move a
//    cursor through them, so the menu is unreachable by anyone driving with one switch —
//    who is exactly the person this product exists for. Declared settings are the only
//    version where `next` and `select` can walk the menu. A `custom` slot stays available
//    for the two or three things a schema genuinely cannot express (the binder itself, a
//    camera preview), and those are moderator-only anyway.
//
// 3. THE CURSOR WRAPS. With one switch you can only travel one way; a list with ends is a
//    list with dead ends. Same rule the verb router already follows for focus.
//
// 4. IT IS MODERATOR-GATED BY DEFAULT, NOT BY LAW. `gated:false` turns it off. Default on,
//    because a settings menu one press away from someone who navigates by scanning is a
//    settings menu that gets opened by accident all day.
//
// WHAT IS DELIBERATELY NOT HERE: the default key binding (slice 3, `S` — `M` and `F` are
// already taken by the kiosk's mirror and fullscreen). Module settings ARRIVED in slice 2 and
// live in `settings_fields.js`, which is pure and knows nothing about this shell: it turns a
// declaration into an ordinary `{ kind:'item', label, hint, run }`, which is exactly what
// `extras` already produced, so the cursor walks them with no special case here.
// The person PICKER is not built into this file: a screen implies its person, so the shell
// STATES who it is for and never guesses. What changed on 2026-09-05 is that there is now a
// named slot for a host to add one — `whoItems`, under the who heading, alongside
// `screenItems` under the screen heading. The kiosk fills both. The shell still knows nothing
// about people or profiles; it renders rows somebody else built, which is decision 2 intact.
//
// WHY THAT MATTERED: a screen handed to nobody rendered "Setting up for …" forever, and the
// SCREEN section held nothing but "Close menu". Two universal headings, no universal content.

import { VERBS, verbTopic, MENU_TAB_TOPIC } from './actions.js';
import { swatchesHTML } from './color_picker.js';
import { mountPicturePicker } from './picture_picker.js';
import { mountChoicePicker } from './choice_picker.js';
import { normalizeField, fieldItems, fieldValue, displayValue, opensPicker, chooseModeOf, PICKER_OVER } from './settings_fields.js';

// ---------------------------------------------------------------------------------
// *** LEVELS: EDIT A SETTING AT WHATEVER LEVEL YOU ARE EDITING (2026-10-02). ***
//
// Mike: "You should really be able to edit something at whatever level you're editing. That should
// probably be a dropdown at the top of the settings menu along with how much to show." The chain is the
// one DECISIONS.md 2026-09-30 ("theme at every level") names and kiosk.js's `fields()` comment has named
// since slice 2: instance, module, screen/dashboard, device, person, account -- "each level is follow or
// its own, and the nearest one set wins". This is that rule, pure, so it is tested without a browser:
//
//   resolveLevel(key, layers, { from })   the nearest level at or above `from` that SET the key
//   levelFieldItems(fields, {...})        a level's rows: each shows the value AT that level, and when the
//                                         level has not set it, says so ("Following: this screen - Blue")
//                                         and steps from "Follow" onto the real choices and back
//
// A LEVEL "SETS" A KEY when its row holds a value that is not null/undefined. "Follow" is written as
// null (state.js keeps a null through JSON; an undefined would vanish on the way to the server and the
// old value would come back on the next poll). The host decides which levels exist on a screen (a
// screen with no person has no person level; nothing stores an account level yet) -- this file only
// walks whatever layers it is handed, in this order, and never invents one.
// ---------------------------------------------------------------------------------
export const SETTING_LEVELS = Object.freeze([
  Object.freeze({ id: 'instance', label: 'this panel' }),
  Object.freeze({ id: 'module', label: 'every panel of this kind' }),
  Object.freeze({ id: 'dashboard', label: 'this dashboard' }),
  Object.freeze({ id: 'screen', label: 'this screen' }),
  Object.freeze({ id: 'device', label: 'this device' }),
  Object.freeze({ id: 'person', label: 'this person' }),
  Object.freeze({ id: 'account', label: 'this account' }),
]);
export const LEVEL_ORDER = Object.freeze(SETTING_LEVELS.map((l) => l.id));
/** The value of a level row's "Follow" option. Never stored: choosing it writes null. */
export const FOLLOW = '__follow__';
const isSetValue = (v) => v !== undefined && v !== null && v !== FOLLOW;
const levelName = (id, labels = {}) => labels[id] || SETTING_LEVELS.find((l) => l.id === id)?.label || id;

/** The nearest level at or above `from` whose row SET `key`: `{ value, at }`, or `{ value: undefined, at: null }`. */
export function resolveLevel(key, layers = {}, { from = LEVEL_ORDER[0], order = LEVEL_ORDER } = {}) {
  const start = Math.max(0, order.indexOf(from));
  for (let i = start; i < order.length; i += 1) {
    const row = layers ? layers[order[i]] : null;
    if (row && typeof row === 'object' && isSetValue(row[key])) return { value: row[key], at: order[i] };
  }
  return { value: undefined, at: null };
}

/** The first level ABOVE `level` (in `order`) -- what "Follow" on `level` follows. Null at the top. */
export function levelAbove(level, order = LEVEL_ORDER) {
  const i = order.indexOf(level);
  return i >= 0 && i + 1 < order.length ? order[i + 1] : null;
}

/**
 * A LEVEL'S ROWS. `fields` are raw declarations (settings_fields.js shape); `layers()` returns
 * `{ [level]: row }` for the levels the host has (read at every paint and press, never a snapshot);
 * `order` is the chain the host offers, most specific first; `write(key, valueOrNull)` stores at `level`.
 * Each row:
 *   * a choice or a toggle gets a FIRST option "Follow <the level above>" -- one press from following to
 *     choosing, and the lap comes back round to following, so a one-switch user can always undo a choice;
 *   * while the level follows, the hint says from where and what: "Following: this screen - Blue";
 *   * any other kind (a number, a colour, text) shows the value in force at this level, and while the
 *     level has its own value a second row "<label>: follow <the level above>" puts it back.
 * Ordinary `fieldItems` rows otherwise (ids `set:<key>` unless `idPrefix` says), so the cursor, the
 * complexity filter and the swatches all work as they do everywhere else.
 */
export function levelFieldItems(fields = [], {
  level = 'screen', layers = () => ({}), order = LEVEL_ORDER, write = null, labels = {},
  complexity = 'standard', idPrefix = 'set:', defaultLabel = 'the default',
} = {}) {
  const read = () => { try { return (typeof layers === 'function' ? layers() : layers) || {}; } catch { return {}; } };
  const above = levelAbove(level, order);
  const aboveName = above ? levelName(above, labels) : defaultLabel;
  const out = [];
  for (const raw of fields || []) {
    const base = normalizeField(raw);
    if (!base) continue;
    const key = base.key;
    const own = () => (read()[level] || {})[key];
    const inherited = () => (above ? resolveLevel(key, read(), { from: above, order }) : { value: undefined, at: null });
    const followHint = () => {
      const inh = inherited();
      const where = inh.at ? levelName(inh.at, labels) : defaultLabel;
      const shown = displayValue(base, fieldValue(base, inh.at ? { [key]: inh.value } : {}));
      return `Following: ${where} — ${shown}`;
    };
    const store = (k, v) => { try { write?.(k, v === FOLLOW ? null : v); } catch (err) { console.warn('settings: level write threw', err); } };
    if (base.kind === 'choice' || base.kind === 'toggle') {
      const real = base.kind === 'toggle'
        ? [{ value: true, label: base.onLabel }, { value: false, label: base.offLabel }]
        : (base.options || []);
      const derived = {
        ...raw, kind: 'choice', default: FOLLOW,
        options: [{ value: FOLLOW, label: `Follow ${aboveName}` }, ...real],
      };
      const items = fieldItems([normalizeField(derived)].filter(Boolean), {
        values: () => ({ [key]: isSetValue(own()) ? own() : FOLLOW }),
        level: complexity, idPrefix, onStep: (k, v) => store(k, v),
      });
      for (const it of items) {
        const following = !isSetValue(own());
        out.push({ ...it, level, following, ...(following ? { hint: followHint() } : {}) });
      }
      continue;
    }
    const items = fieldItems([base], {
      values: () => ({ [key]: isSetValue(own()) ? own() : inherited().value }),
      level: complexity, idPrefix, onStep: (k, v) => store(k, v),
    });
    for (const it of items) {
      const following = !isSetValue(own());
      out.push({ ...it, level, following, ...(following ? { hint: followHint() } : {}) });
      if (!following) {
        out.push({ kind: 'item', id: `${idPrefix}${key}:follow`, level, label: `${base.label}: follow ${aboveName}`,
          hint: 'put it back to following', run: () => store(key, null) });
      }
    }
  }
  return out;
}

/**
 * THE DEVICE LEVEL's row: this browser's own storage (`localStorage` shape), one JSON record. A storage
 * that refuses (a private window) is an empty row that writes nowhere -- the level still renders, it just
 * keeps nothing, and `persisted` says so. `{ get, set(patch), subscribe(fn) -> off, persisted }`.
 */
export const DEVICE_SETTINGS_KEY = 'nimrod:device-settings';
export function createLocalRow({
  storage = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })(),
  key = DEVICE_SETTINGS_KEY,
} = {}) {
  let row = {};
  let persisted = !!storage;
  try { const raw = storage ? storage.getItem(key) : null; if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') row = v; } }
  catch { persisted = false; }
  const subs = new Set();
  return {
    get: () => ({ ...row }),
    set(patch = {}) {
      const next = { ...row };
      for (const [k, v] of Object.entries(patch || {})) { if (v === null || v === undefined) delete next[k]; else next[k] = v; }
      row = next;
      try { storage?.setItem(key, JSON.stringify(row)); persisted = !!storage; } catch { persisted = false; }
      for (const fn of [...subs]) { try { fn({ ...row }); } catch (err) { console.warn('settings: device row subscriber', err); } }
    },
    subscribe(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); },
    get persisted() { return persisted; },
  };
}

export const MENU_VERB = 'menu';
export const MENU_TOPIC = verbTopic(MENU_VERB);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------
// PURE: the cursor.
//
// Separated from the DOM on purpose — the navigation rules (wrapping, skipping headings,
// skipping anything disabled) are the part that has to be RIGHT for a person with one
// switch, and they are testable without rendering anything.
// ---------------------------------------------------------------------------------
export function createNav(items = []) {
  // Only real, enabled items are stops. A heading is a signpost, and stopping on one
  // costs a press and gives nothing back.
  const stops = [];
  (items || []).forEach((it, n) => {
    if (it && it.kind === 'item' && !it.disabled) stops.push(n);
  });
  let at = 0;

  const cur = () => (stops.length ? items[stops[at]] : null);

  return {
    stops: () => stops.slice(),
    count: () => stops.length,
    index: () => (stops.length ? stops[at] : -1),
    current: cur,
    setIndex(n) {
      const p = stops.indexOf(n);
      if (p >= 0) at = p;
      return cur();
    },
    // Wraps, both ways. See decision 3.
    next() { if (!stops.length) return null; at = (at + 1) % stops.length; return cur(); },
    prev() { if (!stops.length) return null; at = (at - 1 + stops.length) % stops.length; return cur(); },
  };
}

// ---------------------------------------------------------------------------------
// PURE: what the menu contains, given the situation.
//
// A plain data list so the shape can be asserted in a test without a browser, and so the
// module settings that arrive in slice 2 splice in rather than requiring a rewrite.
// ---------------------------------------------------------------------------------
export function buildItems({
  person = null,
  subject = null,
  extras = [],
  // The focused panel's own settings, already built into items by `fieldItems`. They arrive
  // as ITEMS rather than as declarations so this file never has to learn what a field is -
  // the rules that matter for one button (wrapping, stepping, what is not cycleable) are
  // pure and live next door, where they can be hammered without a browser.
  fields = [],
  // *** THE TWO UNIVERSAL SECTIONS HAD A FRAME AND NO CONTENT. ***
  //
  // Mike, from a screenshot of the live kiosk on 2026-09-05: the menu rendered
  // "SETTING UP FOR …" with no name after it, and a SCREEN heading with nothing under it but
  // "Close menu". The frame was right and empty, which is arguably worse than absent — it
  // promises two answers and gives neither.
  //
  // These are the slots the host fills. They exist as SEPARATE slots rather than being folded
  // into `extras` because `extras` lands in the middle, between the panel and the screen, and
  // a row about WHO belongs under the who heading or it is not answering that heading.
  //
  // The shell still knows nothing about people or screens — it renders rows the host built,
  // which is decision 2 unchanged.
  whoItems = [],
  screenItems = [],
  canFullscreen = false,
  isFullscreen = false,
  // See the Home row below. Default true, because "there should be SOME way out" is the
  // default that survived F18's correction.
  includeHome = true,
  // "Close menu", by default. False only for the menu drawn IN A PANEL (mountSettings `asPanel`): a panel
  // is not something that opens, so a row that closes it would leave an empty box on the dashboard.
  includeClose = true,
  // TABS (2026-10-02; see "TABS" above mountSettings). When a host has tabs, every row is TAGGED
  // with the tab it belongs to: its own `tab` if the host gave one, else its slot's default here
  // (`{ who, subject, extras, screen }`). Absent, nothing is tagged and the list is exactly what it
  // always was. The ways out are tagged `*end`: they are on every tab.
  slotTabs = null,
} = {}) {
  const out = [];
  if (slotTabs) {
    const res = buildItems({ person, subject, extras, fields, whoItems, screenItems, canFullscreen,
      isFullscreen, includeHome, includeClose });
    // Which slot each row came from, by walking the slots in the order buildItems lays them out.
    let slot = 'who';
    return res.map((it) => {
      if (it.kind === 'heading' && it.id === 'who') slot = 'who';
      else if (it.kind === 'heading' && it.id === 'subject') slot = 'subject';
      else if (it.kind === 'heading' && it.id === 'screen' && !it.tab) slot = 'screen';
      else if (slot === 'subject' && !(fields || []).includes(it) && it.id !== 'panel-settings') slot = 'extras';
      if (['fullscreen', 'home', 'close'].includes(it.id) && it.kind === 'item' && !it.tab) return { ...it, tab: '*end' };
      return it.tab ? it : { ...it, tab: slotTabs[slot] || slotTabs.screen || null };
    });
  }

  // WHO. Stated here; PICKED by whatever the host puts in `whoItems`.
  //
  // THREE STATES, NOT TWO, and the third is the one that was being told as the first:
  //   { name }   somebody — say their name.
  //   null       still looking. "…" keeps the menu the same height while the lookup runs, so
  //              the cursor does not jump under somebody's hand mid-press.
  //   false      the lookup FINISHED and there is nobody. A screen that has never been handed
  //              to a person is an ordinary state, not an error — and it is the state that was
  //              rendering as a permanent "…", i.e. as "still loading, forever".
  //
  // Saying "…" for "nobody" is the failure Mike saw: an answer that never arrives is
  // indistinguishable from a question nobody asked.
  out.push({
    kind: 'heading',
    id: 'who',
    label: person === false
      ? 'Not set up for anybody yet'
      : `Setting up for ${person?.name || '…'}`,
  });
  for (const w of whoItems || []) {
    if (w && w.kind) out.push(w);
    else if (w) out.push({ kind: 'item', ...w });
  }

  // THE SUBJECT. With nine panels on a screen, "settings" is ambiguous — the same problem
  // the verb vocabulary hit, with the same answer: the focused panel. Naming it here is
  // what makes the menu honest about which panel it is about to change.
  out.push({
    kind: 'heading',
    id: 'subject',
    // (2026-10-02, levels: a subject that is a LEVEL rather than a panel -- "Every Photos panel", "This
    // screen" -- names itself with `heading`.)
    label: subject ? (subject.heading || `This panel — ${subject.title || subject.type}`) : 'No panel selected',
  });
  if (subject && fields.length) {
    out.push(...fields);
  } else if (subject) {
    // A PANEL WITH NOTHING TO CHANGE STILL GETS A ROW. Dropping it would leave the heading
    // naming a panel and then nothing underneath, which reads as a menu that failed to load;
    // the sentence is short and it is the truth.
    out.push({
      kind: 'item',
      id: 'panel-settings',
      label: `Nothing to change in ${subject.title || subject.type}`,
      disabled: true,
    });
  }
  // With no subject the heading above already says "No panel selected", and repeating it
  // costs a row on a screen where rows are presses.

  // Whatever the host has that this shell should not know about — the person picker on
  // home, "Set up controls", anything later.
  for (const e of extras || []) {
    if (e && e.kind) out.push(e);
    else if (e) out.push({ kind: 'item', ...e });
  }

  out.push({ kind: 'heading', id: 'screen', label: 'Screen' });
  // SCREEN-LEVEL SETTINGS — the things that belong to this screen rather than to one panel
  // on it. They come from the host because only the host knows where a screen's settings
  // live; the shell renders them exactly like a panel's, so the one-switch cursor walks them
  // with no special case.
  //
  // They go ABOVE full screen / Home / Close deliberately: those three are ways OUT, and a
  // list whose ways out are in the middle is a list somebody scans past.
  for (const it of screenItems || []) {
    if (it && it.kind) out.push(it);
    else if (it) out.push({ kind: 'item', ...it });
  }
  if (canFullscreen) {
    out.push({
      kind: 'item',
      id: 'fullscreen',
      label: isFullscreen ? 'Leave full screen' : 'Full screen',
    });
  }
  // A Home button, here, by default.
  //
  // *** THIS WAS WRITTEN AS AN ABSOLUTE AND IT WAS NOT MIKE'S. *** The previous comment said
  // the way out is "never hidden, at any complexity level, by any host", and called itself
  // the one rule in the project allowed to be absolute. Nobody signed that off: it was put
  // here by a Claude in 28861e4, it is not in `PRINCIPLES.md`, and only Mike declares an
  // absolute. Corrected 2026-09-03 when he read it back: *"I don't know if I said to write
  // that. Home shouldn't always be visible."*
  //
  // WHAT HE ACTUALLY WANTS, and it is a better design than the rule was: Home is a
  // DESTINATION, not a fixture. The site is itself a module, so "home" is going to the home
  // module — which means a kiosk could put it in a corner panel, or on the coming global
  // transport bar (the one that selects which module it is driving, or the audio player, or
  // the kiosk), or leave it here in the menu, or several of those at once. Where it lives
  // becomes a setting.
  //
  // WHAT SURVIVES THE CORRECTION IS SMALLER AND IS A DEFAULT, NOT A RULE: there should be
  // SOME way out, and the person who needs one most is the one who cannot find another way
  // back — so this menu offers one unless a host has deliberately put it somewhere else.
  // "Reachable" was the thing worth protecting; "always visible on this screen" was the
  // overreach, and it is the difference Mike drew himself.
  // ...and `includeHome` is how a host says it HAS put one somewhere else, which is exactly
  // the case F18 left room for. A module opening this menu about ITSELF passes false: from
  // inside one panel of a screen, "Home" would mean navigating the whole kiosk away, which is
  // not that panel's to offer and is already on the shell's own menu. A row that cannot
  // honestly do what it says is worse than an absent one.
  if (includeHome) out.push({ kind: 'item', id: 'home', label: 'Home' });
  if (includeClose) out.push({ kind: 'item', id: 'close', label: 'Close menu' });

  return out;
}

// ---------------------------------------------------------------------------------
// The shell.
// ---------------------------------------------------------------------------------
// A PAGE is the `custom` escape hatch slice 1 promised: the two or three things a
// declarative schema genuinely cannot express. It renders its own DOM, it always has a way
// back, and `back` means "return to the list" rather than "close" while one is open - which
// is what anybody who has ever used a menu expects.
//
// One level, not a stack - and that is a PREFERENCE, not a law. The argument for it is
// real: a menu somebody can get lost three levels down fails the person it is for, and
// every page in front of us today fits. The argument against it has not been hunted yet -
// per-module settings that themselves contain a list (pick a source, then pick an album
// inside it) are the obvious shape that would want depth. Revisit when one turns up rather
// than bending a page into a shape it does not fit.
export function mountSettings(root, {
  person = () => null,
  subject = () => null,
  extras = () => [],
  // The two universal slots, read at every paint like `extras` and for the same reason: the
  // person's name arrives after the boot, and a screen setting shows its CURRENT value.
  whoItems = () => [],
  screenItems = () => [],
  // Read at every paint, never cached. A field row shows its CURRENT value, so a snapshot
  // taken at mount time would show yesterday's number to somebody standing at the screen.
  fields = () => [],
  pages = {},                  // { id: { title, render(el) } }
  onHome = null,
  onSelect = null,             // told about every activation — the host wires the effects
  // *** TOLD WHENEVER THE MENU CLOSES, however it closed. ***
  //
  // `onSelect` cannot serve this: `activate` handles `close` and returns BEFORE calling it,
  // and the menu can also be closed by Escape, by the `back` verb, or by clicking the scrim.
  // A host that needs to know has four paths to miss and no way to catch three of them.
  //
  // It exists because a MODULE can now open this menu about itself. When a game opens to its
  // own settings, closing the menu IS starting the game — and without this the panel would
  // sit there with the menu gone and the game not begun, which is a dead rectangle somebody
  // has to guess their way out of.
  onClose = null,
  gated = true,
  isModerator = () => true,
  onRefused = null,
  fullscreenTarget = null,     // an element, or null for "this surface cannot go fullscreen"
  // (2026-10-05, screen_lock.js) Read at every paint: false while in full screen means no "Leave full screen"
  // row (a locked screen does not leave it from here; entering stays offered). Absent: always true.
  canLeaveFullscreen = null,
  // *** WHERE THE MENU IS ALLOWED TO REACH. ***
  //
  // The default is the whole viewport, which is right for the SHELL's menu — it is the one a
  // person opens about the screen, and it is meant to take the screen over while it is up.
  //
  // `inline` scopes it to whatever it was mounted into. That exists because a MODULE can now
  // open this menu about itself, and a module that covered the entire display to ask about
  // its own settings would be a panel reaching outside its own box — the one thing the module
  // contract forbids. On a grid kiosk a game asking about itself must darken its own quarter
  // and nothing else, or setting up Wait-and-Go would blank out the photographs next to it.
  //
  // It is a positioning choice and nothing else: the same markup, the same one-switch cursor,
  // the same rows. Nothing about what the menu CAN do changes with it.
  inline = false,
  includeHome = true,
  // *** THE SAME MENU, DRAWN IN A PANEL (2026-10-03). *** Mike: "The settings module should be the same as
  // the settings menu. There shouldn't be 2 different things." So the Settings panel (modules/settings.js)
  // mounts THIS menu with the host's own rows (kiosk.js `settingsMenuFor`), and `asPanel` takes away only the
  // chrome that belongs to something that opens and closes:
  //   * it is always open: no Close menu row, and `close()` / `back()` on the list leave it as it is;
  //   * it is not a dialog: no scrim click, no Escape, no focus trap, not `aria-modal` (a keyboard user Tabs
  //     in and out of it like any other panel);
  //   * it never takes the keyboard by itself - focus moves into it only from inside it (a press there).
  // Everything else - the rows, the tabs, "Settings for", the pages, the pickers, the four moves - is this
  // file, unchanged. Implies `inline` (it measures against its box).
  asPanel = false,
  // ---- TABS (2026-10-02; see "TABS" below). All optional: a host that passes none of these gets
  // the one flat list it always had. ----
  // `tabs`: [{ id, label }] or a function returning it, in the order the strip shows them. A tab with
  // no row in it is not shown (an empty tab is a press that leads nowhere).
  tabs = null,
  // Which tab each SLOT's rows land on when a row does not name its own `tab`.
  slotTabs = null,
  // Which tab the menu opens on (read at every open). Absent: the first tab that has rows.
  startTab = null,
  // Row ids pinned ABOVE the tabs, on every tab (Mike: "The choice for what to show should be at the
  // top above the tabs" - the complexity row).
  topIds = [],
  // THE SUBJECT: what the menu's panel rows are about. `subjects()` -> [{ id, label }], and
  // `defaultSubject()` -> the id to start on at every open (the focused panel). The row "Settings
  // for: <label>" sits above the tabs and steps through them; the host reads the choice back with
  // `subjectId()`. Absent: no row, and `subjectId()` is null.
  subjects = null,
  defaultSubject = null,
  onSubject = null,
  // ---- HOW SOMEBODY CHOOSES (2026-10-02; settings_fields.js "HOW SOMEBODY CHOOSES"). ----
  // `chooseMode`: 'point' (a long choice opens the choice picker) or 'step' (every press steps), or a
  // function returning one, read at every press - the host answers from the PERSON's row, where "How
  // you choose things" lives. Absent: 'point', so nobody steps through twelve themes unless they asked.
  chooseMode = 'point',
  // More options than this and a choice row opens the picker (in 'point'). Argued at PICKER_OVER.
  pickerOver = PICKER_OVER,
  documentRef = (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!root) throw new Error('mountSettings: a root element is required');
  const doc = documentRef;
  // A host (or a suite walking the one-switch path) may also set the mode outright; null hands it back.
  let modeOverride = null;
  const tabsOn = !!tabs;
  const SLOT_TABS = slotTabs || { who: 'people', subject: 'module', extras: 'screen', screen: 'display' };
  let tab = null;              // the tab showing, while tabs are on
  let tabList = [];            // the tabs with rows in them, at the last render
  let allItems = [];           // every row, every tab (what `items()` reports)
  let subjectSel = null;       // the chosen subject's id

  let open = false;
  let page = null;             // the open page's id, or null for the list
  // THE ONE TEXT BOX that may be open, as `{ id, draft }`, or null. See "TEXT ROWS" below.
  let editing = null;
  // THE PICKER, while a picture row or a long choice row has it open (see "PICTURE ROWS" and "CHOICE
  // ROWS" below), or null. Either kind answers the same four moves.
  let picker = null;
  // An open page's own moves, when its `render` handed some back (see openPage), or null.
  let pageCtl = null;
  let items = [];
  let nav = createNav([]);
  let returnFocus = null;
  const busOffs = [];
  let router = null;

  root.innerHTML = `
    <div class="st-scrim${inline || asPanel ? ' st-inline' : ''}${asPanel ? ' st-aspanel' : ''}" data-scrim hidden>
      <div class="st-panel" ${asPanel ? 'role="region"' : 'role="dialog" aria-modal="true"'} aria-label="Settings" tabindex="-1" data-panel>
        <div class="st-list" data-list></div>
        <div class="st-page" data-page hidden></div>
      </div>
    </div>`;
  const scrim = root.querySelector('[data-scrim]');
  const panel = root.querySelector('[data-panel]');
  const listEl = root.querySelector('[data-list]');
  const pageEl = root.querySelector('[data-page]');
  // Keyboard focus to the menu. A menu drawn in a panel (`asPanel`) takes it only when it is already inside
  // it - a press on one of its rows - so nothing ELSE on the screen (Nimrod asking for a page, a repaint)
  // ever moves somebody's keyboard into it.
  const grab = () => {
    if (!asPanel) { panel.focus?.(); return; }
    try { const a = doc?.activeElement; if (a && a !== doc.body && root.contains(a)) panel.focus?.(); } catch { /* no document */ }
  };

  const isFullscreen = () => !!(doc && doc.fullscreenElement);

  // ---------------------------------------------------------------------------------
  // TABS (2026-10-02). Mike: "The settings menu needs to be broken up into tabs. The choice for
  // what to show should be at the top above the tabs and then tabs for things like the active
  // module, audio, video, devices, users, etc."
  //
  // WHAT A TAB IS HERE: a filter on the ONE list, never a second menu. Every row is built exactly as
  // before (buildItems, the host's slots) and tagged with one tab; the cursor walks
  //     [Settings for: <subject>] [rows pinned above the tabs] [Tab: <name>] <that tab's rows> [ways out]
  // and wraps. So:
  //   * NO ROW CAN BE LOST TO A TAB: a row whose tab is unknown lands on the first tab (`tabFor`), and
  //     `items()` still reports every row of every tab - kiosk_test compares the two.
  //   * THE WAYS OUT ARE ON EVERY TAB (full screen, Home, Close), last, as they always were.
  //   * ONE SWITCH: the tab row is ONE stop; `select` on it goes to the next tab and the cursor stays
  //     on it, so the next press goes on again. Argued against a stop per tab: six tabs as six stops
  //     would put six presses in front of every row on every walk, which is the cost the tabs exist to
  //     take away. The strip of tab buttons under it is for a POINTER and is not a stop (the colour
  //     swatches' rule). Voice and a bound switch reach `nextTab` / `prevTab` / `showTab` directly.
  //   * THE LEVELS STILL WORK INSIDE A TAB: a level decides which rows exist; a tab only which of them
  //     are showing. A tab left with nothing in it at a level is not offered at that level.
  // ---------------------------------------------------------------------------------
  const safeCall = (fn, dflt) => { try { const v = typeof fn === 'function' ? fn() : fn; return v == null ? dflt : v; } catch (err) { console.warn('settings: host read threw', err); return dflt; } };
  // The mode in force, read at the moment of a press or a paint (never cached: the person can change it
  // from this very menu, and the next press must already obey it).
  const modeNow = () => chooseModeOf(modeOverride || safeCall(chooseMode, 'point'));
  // Does a press on this row open the choice picker? Only a row `fieldItems` built for a choice.
  const opensList = (it) => !!(it && it.choice && it.field && opensPicker(it.field, { mode: modeNow(), over: pickerOver }));
  function subjectList() { return subjects ? (safeCall(subjects, []) || []).filter((s) => s && s.id) : []; }
  function currentSubject() {
    const list = subjectList();
    return list.find((s) => s.id === subjectSel) || list[0] || null;
  }
  function chooseSubject(id) {
    subjectSel = id;
    try { onSubject?.(id); } catch (err) { console.warn('settings: onSubject threw', err); }
  }
  function stepSubject(by = 1) {
    const list = subjectList();
    if (list.length < 2) return null;
    const at = Math.max(0, list.findIndex((s) => s.id === currentSubject()?.id));
    const next = list[(at + by + list.length) % list.length];
    chooseSubject(next.id);
    return next;
  }
  const visibleTab = (t) => tabList.some((d) => d.id === t);
  // The rows of one tab, with any heading that has nothing under it on THIS tab left out.
  // One tab gathers rows from several of the host's slots, so a row may carry `rank` (default 0): the
  // tab is sorted by it, stably, which keeps each section's rows in the order they were built.
  function rowsOf(t, list) {
    const mine = list.map((it, i) => [it, i]).filter(([it]) => it.tab === t)
      .sort((a, b) => ((Number(a[0].rank) || 0) - (Number(b[0].rank) || 0)) || (a[1] - b[1]))
      .map(([it]) => it);
    return mine.filter((it, n) => {
      if (it.kind !== 'heading') return true;
      const nx = mine[n + 1];
      return !!nx && nx.kind !== 'heading';
    });
  }
  function tabbed(flat) {
    const defs = (safeCall(tabs, []) || []).filter((d) => d && d.id);
    const known = new Set(defs.map((d) => d.id));
    const pinned = new Set(topIds || []);
    // Every row has exactly one place: pinned above, the ends, or a tab the strip shows.
    const fallback = defs[0]?.id || null;
    allItems = flat.map((it) => {
      if (pinned.has(it.id)) return { ...it, tab: '*top' };
      if (it.tab === '*end') return it;
      return known.has(it.tab) ? it : { ...it, tab: fallback };
    });
    tabList = defs.filter((d) => allItems.some((it) => it.tab === d.id && it.kind !== 'heading'))
      .map((d) => ({ id: d.id, label: d.label || d.id }));
    if (!visibleTab(tab)) tab = tabList[0]?.id || null;
    const top = [];
    if (subjects) {
      const list = subjectList();
      const cur = currentSubject();
      // By id: a host may build its list afresh at every read (the kiosk does), so the objects differ.
      const at = cur ? list.findIndex((s) => s.id === cur.id) : -1;
      top.push({
        kind: 'item', id: 'subject-pick', tab: '*top',
        label: `Settings for: ${cur ? cur.label : 'this screen'}`,
        ...(list.length > 1 ? { hint: `${at + 1} of ${list.length} — press for the next` } : {}),
        // One subject cannot be changed: a stop that does nothing is a press spent for nothing.
        disabled: list.length < 2,
        subjectPick: true,
      });
    }
    top.push(...allItems.filter((it) => it.tab === '*top'));
    if (tabList.length) {
      const at = tabList.findIndex((d) => d.id === tab);
      top.push({
        kind: 'item', id: 'tabs', tab: '*top', tabStrip: true,
        label: `Tab: ${tabList[at]?.label || ''}`,
        hint: tabList.length > 1 ? `${at + 1} of ${tabList.length} — press for the next tab` : '',
        disabled: tabList.length < 2,
      });
    }
    return [...top, ...rowsOf(tab, allItems), ...allItems.filter((it) => it.tab === '*end')];
  }
  /** Show a tab. The cursor goes to the tab row, so one more press goes on to the next tab. */
  function showTab(id, { focus = 'tabs' } = {}) {
    if (!tabsOn) return null;
    if (!open) { tab = id; return id; }
    render();
    if (!visibleTab(id)) return null;
    tab = id;
    if (editing) editing = null;
    render({ keepCursor: false });
    const n = items.findIndex((it) => it.id === focus && it.kind === 'item' && !it.disabled);
    if (n >= 0) nav.setIndex(n);
    paint();
    return tab;
  }
  function stepTab(by) {
    if (!tabsOn || !tabList.length) return null;
    const at = Math.max(0, tabList.findIndex((d) => d.id === tab));
    return showTab(tabList[(at + by + tabList.length) % tabList.length].id);
  }

  function render({ keepCursor = true } = {}) {
    const flat = buildItems({
      person: person(),
      subject: subject(),
      extras: extras(),
      // A module that throws while the menu is opening must not take the menu with it - the
      // menu is the tool for repairing the broken thing.
      // ...and it SAYS SO on the console rather than swallowing it. A menu that silently
      // shows no settings for a panel that has some is indistinguishable from a panel that
      // declares none, which is a bug nobody can find.
      fields: (() => { try { return fields() || []; }
        catch (err) { console.warn('settings: fields() threw', err); return []; } })(),
      whoItems: (() => { try { return whoItems() || []; }
        catch (err) { console.warn('settings: whoItems() threw', err); return []; } })(),
      screenItems: (() => { try { return screenItems() || []; }
        catch (err) { console.warn('settings: screenItems() threw', err); return []; } })(),
      // (A menu in a panel has no ways out of itself: see `asPanel`.)
      canFullscreen: !!fullscreenTarget && !asPanel && !(isFullscreen() && !safeCall(canLeaveFullscreen, true)),
      includeHome: includeHome && !asPanel,
      includeClose: !asPanel,
      isFullscreen: isFullscreen(),
      slotTabs: tabsOn ? SLOT_TABS : null,
    });
    if (tabsOn) items = tabbed(flat);
    else { items = flat; allItems = flat; }
    const keep = keepCursor ? nav.current()?.id : null;
    nav = createNav(items);
    // Rebuilding must not throw the cursor back to the top under somebody's hand: if the
    // item they were on still exists, stay on it.
    if (keep) {
      const n = items.findIndex((it) => it.id === keep && it.kind === 'item' && !it.disabled);
      if (n >= 0) nav.setIndex(n);
    }
    // A box open on a row that no longer exists (the panel it belonged to went away) closes
    // rather than floating under whatever row took its place.
    if (editing && !items.some((it) => it.id === editing.id && it.edit)) editing = null;
    paint();
  }

  const editInput = () => listEl.querySelector('[data-edit-input]');

  function paint() {
    const at = nav.index();
    // A REPAINT MUST NOT EAT TYPING. The kiosk refreshes this menu when a person's name arrives
    // and after every activation; rebuilding the list replaces the box, so the draft, the focus
    // and the caret are carried across by hand.
    const box = editInput();
    const hadFocus = !!box && doc?.activeElement === box;
    const caret = hadFocus ? [box.selectionStart, box.selectionEnd] : null;
    listEl.innerHTML = items.map((it, n) => {
      if (it.kind === 'heading') return `<div class="st-head">${esc(it.label)}</div>`;
      const on = n === at;
      const dis = it.disabled ? ' disabled' : '';
      const isEditing = !!(editing && it.edit && editing.id === it.id);
      // A colour row carries a chip of its colour beside the name, on the row itself, so the
      // cursor row shows it too and a sighted switch user sees what "Blue" means.
      const chip = it.color && it.color.value
        ? `<span class="st-chip" style="--sw:${esc(it.color.value)}" aria-hidden="true"></span>` : '';
      // `data-id` is the row's stable name (`set:label`, `close`...). `data-n` is its position,
      // which moves whenever a row appears above it; a guide pointing at "the Words row" (the
      // cat, `game/cat_steps.js`) needs the name.
      // A row that OPENS a list (a long choice, a picture) says so before it is pressed: the marker for the
      // eye (settings.css `.st-opens`), `aria-haspopup` for a screen reader.
      const opens = !it.disabled && (opensList(it) || !!it.picture);
      const row = `<button class="st-item${on ? ' on' : ''}${opens ? ' st-opens' : ''}" data-n="${n}" data-id="${esc(it.id)}" type="button"${dis}
        aria-current="${on ? 'true' : 'false'}"${it.edit ? ` aria-expanded="${isEditing ? 'true' : 'false'}"` : ''}${opens ? ' aria-haspopup="dialog"' : ''}>
        <span class="st-label">${esc(it.label)}</span>
        ${it.hint || chip ? `<span class="st-hint">${chip}${esc(it.hint || '')}</span>` : ''}
      </button>`;
      // The swatches are for a POINTER and are not cursor stops (they are not items), so a
      // switch user pays one press for this row and steps it with `select` like any other.
      const swatches = it.color && !it.disabled
        ? swatchesHTML({ palette: it.color.palette, value: it.color.value, label: it.label,
          attrs: `data-for="${n}"` })
        : '';
      // THE TAB STRIP, for a POINTER: one button per tab, under the tab row. Not cursor stops (see
      // TABS); the row above them is the one stop, and `select` on it goes to the next tab.
      const strip = it.tabStrip ? `<div class="st-tabs" role="tablist" aria-label="Settings tabs">${
        tabList.map((d) => `<button type="button" class="st-tab${d.id === tab ? ' on' : ''}" role="tab"
          data-tab="${esc(d.id)}" aria-selected="${d.id === tab ? 'true' : 'false'}">${esc(d.label)}</button>`).join('')
      }</div>` : '';
      if (it.tabStrip) return row + strip;
      const editor = isEditing ? `<div class="st-edit" data-edit-for="${n}">
          <input class="st-input" type="text" data-edit-input value="${esc(editing.draft)}"
            placeholder="${esc(it.edit.placeholder || '')}" aria-label="${esc(it.label)}"
            ${it.edit.maxLength ? `maxlength="${Number(it.edit.maxLength)}"` : ''} autocomplete="off" spellcheck="false">
          <button type="button" class="st-mini" data-edit-save>Save</button>
          <button type="button" class="st-mini" data-edit-cancel>Cancel</button>
        </div>` : '';
      return row + swatches + editor;
    }).join('');
    if (editing && (hadFocus || editing.focus)) {
      const el = editInput();
      if (el) {
        el.focus?.();
        if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text input */ } }
        else { try { el.select(); } catch { /* same */ } }
      }
      editing.focus = false;
    }
    // The cursor must be visible without scrolling to it — someone driving with a switch
    // cannot scroll, and a highlighted row below the fold is the same as no highlight.
    listEl.querySelector('.st-item.on')?.scrollIntoView({ block: 'nearest' });
    // ...and so must the box somebody is typing in.
    editInput()?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---------------------------------------------------------------------------------
  // TEXT ROWS (2026-09-28). Mike: "plain text box is fine" / "keyboard box now".
  //
  // `select` or a click on an editable text row opens ONE inline box under it. Enter or Save
  // commits through the row's `commit()` - which reports through the host's `onStep`, the same
  // write path every other row uses; this file still writes nothing. Escape or Cancel leaves the
  // value as it was.
  //
  // THE BOX NEVER TRAPS ANYBODY. Every move this menu understands leaves it: `next`/`prev`
  // cancel and move on, `back` cancels and stays, `select` saves, closing the menu closes it. So
  // a switch user who lands in it - they can, it is a stop - is one press from out, and the row
  // told them before they pressed that it needs a keyboard.
  //
  // WHY TYPING DOES NOT DRIVE THE MENU OR THE SCREEN, checked rather than assumed: the input
  // bus's keyboard adapter (`input_keyboard.js` `attachKeyboard`) and the kiosk's caregiver keys
  // (`kiosk.js` `onKey`) both return early on `isTyping(e.target)`, and an `<input>` is typing.
  // So ordinary keys are left to bubble (the activity/idle listeners should still see them).
  // ESCAPE is the exception and is stopped at the box: the panel's own keydown below closes the
  // whole menu on Escape, and the bus would read it as the Menu verb.
  // ---------------------------------------------------------------------------------
  function openEditor(item) {
    if (!item || !item.edit) return null;
    if (editing && editing.id === item.id) { editing.focus = true; paint(); return item; }
    editing = { id: item.id, draft: String(item.edit.value ?? ''), focus: true };
    paint();
    return item;
  }

  function endEdit({ save }) {
    if (!editing) return false;
    const it = items.find((x) => x.id === editing.id);
    const draft = editing.draft;
    editing = null;
    let wrote = false;
    if (save && it && typeof it.commit === 'function') {
      try { wrote = !!it.commit(draft); } catch (err) { console.warn('settings: commit threw', err); }
      if (wrote) onSelect?.(it);
    }
    // Focus back to the panel: the box is gone, and the panel is where this menu's keys live
    // (Escape, the focus trap) - leaving it on <body> would put the next Escape nowhere.
    if (open) { render(); grab(); }
    return wrote;
  }
  const saveEdit = () => endEdit({ save: true });
  const cancelEdit = () => endEdit({ save: false });

  // ---------------------------------------------------------------------------------
  // PICTURE ROWS (2026-10-02). Mike: "Having the pictures scroll through all your pictures in the
  // settings menu isn't a good way to do it. There should be upload or a folder picker."
  //
  // A row carrying `picture` (settings_fields.js, kind `picture`) opens the shared picker
  // (`picture_picker.js`) where this menu's pages go, and the four moves drive IT while it is
  // open: rows of pictures by `next`/`prev`, into a row by `select`, out by `back`, and `back` from
  // its rows (or its Cancel) is back to this list. A choice commits through the row's `commit()` -
  // the host's `onStep`, the one write path - and the list comes back with the row showing it.
  // ---------------------------------------------------------------------------------
  function openPicture(item) {
    if (!item || !item.picture) return null;
    if (editing) editing = null;
    if (picker) closePage();
    page = '__picture';
    listEl.hidden = true;
    pageEl.hidden = false;
    pageEl.innerHTML = '<div data-page-body data-picture-page></div>';
    const id = item.id;
    picker = mountPicturePicker(pageEl.querySelector('[data-page-body]'), {
      ...item.picture,
      onPick: (ref) => {
        const it = items.find((x) => x.id === id) || item;
        let wrote = false;
        try { wrote = !!it.commit?.(ref); } catch (err) { console.warn('settings: commit threw', err); }
        closePage();
        if (wrote) onSelect?.(it);
        if (open) { render(); grab(); }
      },
      onCancel: () => { closePage(); grab(); },
    });
    grab();
    return item;
  }

  // ---------------------------------------------------------------------------------
  // CHOICE ROWS WITH MANY OPTIONS (2026-10-02; settings_fields.js "HOW SOMEBODY CHOOSES"). Mike: "Things
  // like modules, pictures, themes where there are a lot of options shouldn't be set up to have to click
  // through them all as default."
  //
  // A choice row `opensPicker` says yes to (past PICKER_OVER options, the person not stepping) opens the
  // choice picker (`choice_picker.js`) where the picture picker opens: the same page slot, the same four
  // moves driving it (rows by `next`/`prev`, into a row by `select`, out by `back`, and `back` from the
  // rows - or "Keep …" - is back to this list with nothing changed). A choice commits through the row's
  // `commit()` - the host's `onStep`, the one write path - and the list comes back on that row, showing it.
  // A person who steps ('step') never sees it: `select` steps the row, as it always has.
  // ---------------------------------------------------------------------------------
  function openChoice(item) {
    if (!item || !item.choice) return null;
    if (editing) editing = null;
    if (picker) closePage();
    page = '__choice';
    listEl.hidden = true;
    pageEl.hidden = false;
    pageEl.innerHTML = '<div data-page-body data-choice-page></div>';
    const id = item.id;
    // The row as it is NOW (a repaint may have rebuilt it since this one was drawn).
    const fresh = items.find((x) => x.id === id) || item;
    picker = mountChoicePicker(pageEl.querySelector('[data-page-body]'), {
      ...fresh.choice,
      onPick: (v) => {
        const it = items.find((x) => x.id === id) || fresh;
        let wrote = false;
        try { wrote = !!it.commit?.(v); } catch (err) { console.warn('settings: commit threw', err); }
        closePage();
        if (wrote) onSelect?.(it);
        if (open) { render(); focusRow(id); grab(); }
      },
      onCancel: () => { closePage(); if (open) focusRow(id); grab(); },
    });
    grab();
    return item;
  }

  // --- the four moves. Everything else in the file exists to serve these. ---
  // While a page is open the only control is Back, so moving does nothing rather than
  // scrolling a cursor nobody can see - except the pickers, which are driven by them, and a page whose
  // `render` handed back moves of its own (see openPage).
  // A move while a box is open leaves the box first (see TEXT ROWS) - never a trap.
  function next() {
    if (open && picker) { picker.next(); return null; }
    if (open && page && pageCtl?.next) { pageCtl.next(); return null; }
    if (!open || page) return null; if (editing) editing = null; const it = nav.next(); paint(); return it;
  }
  function prev() {
    if (open && picker) { picker.prev(); return null; }
    if (open && page && pageCtl?.prev) { pageCtl.prev(); return null; }
    if (!open || page) return null; if (editing) editing = null; const it = nav.prev(); paint(); return it;
  }

  function activate(item) {
    if (!item || item.disabled) return null;
    // The tab row: on to the next tab, the cursor staying on the row (see TABS).
    if (item.tabStrip) { stepTab(1); return item; }
    // "Settings for": on to the next subject. The rows below it follow on the repaint.
    if (item.subjectPick) { stepSubject(1); render(); return item; }
    if (item.page) { openPage(item.page); return item; }
    if (item.picture) return openPicture(item);
    // A long choice opens its list; a short one (or anybody stepping) falls through to `run()`, the step.
    if (opensList(item)) return openChoice(item);
    // A text row opens its box. `onSelect` is not told yet: nothing has been chosen until the
    // box commits (and then it is, from `endEdit`).
    if (item.edit) return openEditor(item);
    if (item.id === 'close') { close(); return item; }
    if (item.id === 'home') {
      close();
      if (onHome) onHome();
      else if (typeof location !== 'undefined') location.href = './home.html';
      return item;
    }
    if (item.id === 'fullscreen') {
      try {
        if (isFullscreen()) { if (safeCall(canLeaveFullscreen, true)) doc.exitFullscreen?.(); }
        else fullscreenTarget?.requestFullscreen?.();
      } catch { /* a browser that refuses is not an error worth showing here */ }
      // The fullscreen change is async; repaint when it lands so the label is truthful.
      setTimeout(render, 0);
      return item;
    }
    if (typeof item.run === 'function') item.run();
    onSelect?.(item);
    // REPAINT AFTER EVERY ACTIVATION. A field row's whole job is to show what it is set to,
    // and stepping it without redrawing leaves the old value on screen - which from a switch
    // reads as the press having been dropped, and the repair for that looks like a hardware
    // fault. `render()` keeps the cursor on the row it was on, so nothing moves under a hand.
    if (open && !page) render();
    return item;
  }

  function select() {
    if (!open) return null;
    if (picker) { picker.select(); return { id: page === '__choice' ? 'choice' : 'picture' }; }
    if (page && pageCtl?.select) { pageCtl.select(); return { id: 'page' }; }
    if (page) { closePage(); return { id: 'page-back' }; }
    // Select while typing is "done": it saves, the same as Enter.
    if (editing) { const id = editing.id; saveEdit(); return { id, saved: true }; }
    return activate(nav.current());
  }

  // BACK LEAVES THE PAGE BEFORE IT LEAVES THE MENU. Closing the whole thing from inside a
  // page would throw away where somebody was, and for a person navigating by scanning,
  // getting back to a place costs real presses. The same for a text box: back leaves the box.
  function back() {
    if (!open) return;
    if (picker) { picker.back(); return; }
    // A page with moves of its own comes out of whatever it is in first; `true` means it did.
    // Otherwise the page closes (if its own back did not already close it) - and the menu stays open.
    if (page && pageCtl?.back) {
      let inner = false;
      try { inner = pageCtl.back() === true; } catch { inner = false; }
      if (!inner && page) closePage();
      return;
    }
    if (page) { closePage(); return; }
    if (editing) { cancelEdit(); return; }
    // A menu in a panel is not a thing that closes: back on its list stays where it is.
    if (asPanel) return;
    close();
  }

  function openPage(id) {
    const def = pages[id];
    if (!def) return null;
    // Whatever was open goes first, so its list cannot keep answering the moves under the new page.
    if (picker || pageCtl) closePage();
    page = id;
    listEl.hidden = true;
    pageEl.hidden = false;
    pageEl.innerHTML = `<div class="st-head">${esc(def.title || id)}</div>
      <div data-page-body></div>
      <button class="st-item on" type="button" data-page-back>
        <span class="st-label">Back</span></button>`;
    // A PAGE MAY HAND BACK MOVES OF ITS OWN (2026-10-02): `render` returning `{ next, prev, select, back }`
    // (a list inside the page - the Settings module's themes) gets the four moves while it is open, so a
    // switch reaches it like any other list. `back()` returning true means it only came out of a row;
    // anything else and the page closes. A page that returns nothing is exactly what it always was.
    try {
      const ctl = def.render(pageEl.querySelector('[data-page-body]'));
      pageCtl = ctl && typeof ctl === 'object' && ['next', 'prev', 'select', 'back'].some((k) => typeof ctl[k] === 'function') ? ctl : null;
    } catch (err) {
      // A page that throws must not strand somebody inside a broken screen with no Back.
      pageEl.querySelector('[data-page-body]').textContent = String(err.message || err);
    }
    grab();
    return id;
  }

  function closePage() {
    if (picker) { const p = picker; picker = null; try { p.destroy(); } catch { /* already gone */ } }
    if (pageCtl) { const c = pageCtl; pageCtl = null; try { c.destroy?.(); } catch { /* already gone */ } }
    page = null;
    pageEl.hidden = true;
    pageEl.innerHTML = '';
    listEl.hidden = false;
    paint();
  }

  function show(opts = null) {
    if (open) {
      // Already open: a request to show a particular tab or row still lands there.
      if (opts && opts.tab) showTab(opts.tab, { focus: opts.focus || 'tabs' });
      else if (opts && opts.focus) focusRow(opts.focus);
      return true;
    }
    // The gate. Refusing SILENTLY would look like a broken switch, so the host is told.
    if (gated && !isModerator()) { onRefused?.({ reason: 'moderator-only' }); return false; }
    open = true;
    returnFocus = doc?.activeElement || null;
    // EVERY OPEN STARTS IN THE SAME PLACE: the subject is the focused panel and the tab is the host's
    // start tab (the panel's). Argued: the same first stops at every open is what a switch user can
    // learn; "where I left it" is a caregiver's convenience that costs the switch user that.
    if (subjects) subjectSel = safeCall(defaultSubject, null);
    if (tabsOn) tab = (opts && opts.tab) || safeCall(startTab, null) || tab;
    // (Without tabs the cursor stays where it was last time, as it always has.)
    render({ keepCursor: !tabsOn });
    if (opts && opts.focus) focusRow(opts.focus);
    scrim.hidden = false;
    // (A menu in a panel is not in front of anything: the panels keep their verbs, and it takes no focus.)
    if (!asPanel) router?.setPaused?.(true);
    grab();
    return true;
  }

  function close({ force = false } = {}) {
    if (!open) return;
    // A menu in a panel only lets go of a page; the panel itself stays (its `destroy` is the way it goes).
    if (asPanel && !force) { if (page) closePage(); return; }
    if (page) closePage();
    // An open box is abandoned, not saved: closing is a way OUT, and saving half a word on the
    // way out would be a write nobody asked for. Removed from the DOM too, so a hidden menu is
    // not holding a focusable text box.
    if (editing) { editing = null; listEl.querySelector('.st-edit')?.remove(); }
    open = false;
    scrim.hidden = true;
    router?.setPaused?.(false);
    // Put keyboard focus back where it was, or the next Tab starts from the top of the
    // document and a sighted keyboard user is lost.
    try { returnFocus?.focus?.(); } catch { /* it may have been unmounted */ }
    returnFocus = null;
    // Last, and never allowed to throw the close: a host that fails while reacting must not
    // leave the menu half-closed, which is the one state nothing can recover from.
    try { onClose?.(); } catch (err) { console.error('settings: onClose', err); }
  }

  function toggle() { return open ? (close(), false) : show(); }

  /** Put the cursor on row `id`, going to its tab first when it is on another. False if it is not a stop. */
  function focusRow(id) {
    if (!open || !id) return false;
    if (tabsOn) {
      const t = allItems.find((it) => it.id === id)?.tab;
      if (t && t !== tab && !String(t).startsWith('*') && visibleTab(t)) { tab = t; render({ keepCursor: false }); }
    }
    const n = items.findIndex((it) => it.id === id && it.kind === 'item' && !it.disabled);
    if (n < 0) return false;
    nav.setIndex(n);
    paint();
    return true;
  }

  /** SHOW what row `id` holds (2026-10-03): its list (a choice or a picture), else its page, else the cursor
   *  on it - going to its tab first. It never STEPS a value, whatever the person's "How you choose things":
   *  somebody (Nimrod) asking the menu to show the themes is asking to see them, not to change one. Null when
   *  there is no such row here. */
  function openRow(id) {
    if (!open || !id) return null;
    if (page) closePage();
    if (editing) editing = null;
    render();
    if (!focusRow(id)) return null;
    const it = items.find((x) => x.id === id);
    if (!it) return null;
    if (it.choice && it.field) return openChoice(it);
    if (it.picture) return openPicture(it);
    if (it.page) { openPage(it.page); return it; }
    return it;
  }

  // --- mouse. Clicking is still how most caregivers will use this. ---
  const listeners = new AbortController();
  const sig = { signal: listeners.signal };

  listEl.addEventListener('click', (e) => {
    // The text box's own buttons, first: they sit in the list but are not rows.
    if (e.target.closest('[data-edit-save]')) { saveEdit(); return; }
    if (e.target.closest('[data-edit-cancel]')) { cancelEdit(); return; }
    if (e.target.closest('.st-edit')) return;            // a click INTO the box is typing, not a choice
    // A TAB BUTTON (a pointer's way to a tab): that tab, the cursor on the tab row.
    const tb = e.target.closest('[data-tab]');
    if (tb) { showTab(tb.dataset.tab); return; }
    // A SWATCH sets its colour outright, through the row's `commit()` - the host's write path.
    const sw = e.target.closest('[data-swatch]');
    if (sw) {
      const n = Number(sw.dataset.for);
      const it = items[n];
      if (!it || typeof it.commit !== 'function') return;
      editing = null;
      nav.setIndex(n);
      if (it.commit(sw.dataset.swatch)) onSelect?.(it);
      render();
      return;
    }
    const btn = e.target.closest('.st-item');
    if (!btn || btn.disabled) return;
    const n = Number(btn.dataset.n);
    // Clicking a DIFFERENT row while typing abandons the box: the click is the person's answer
    // to "are you done with that".
    if (editing && items[n]?.id !== editing.id) editing = null;
    nav.setIndex(n);
    paint();
    activate(items[n]);
  }, sig);

  // The browser's own fine colour picker. `change`, not `input`: `input` fires continuously while
  // somebody drags across the spectrum, and every one of those would be a write.
  listEl.addEventListener('change', (e) => {
    const fine = e.target.closest?.('[data-fine]');
    if (!fine) return;
    const n = Number(fine.dataset.for);
    const it = items[n];
    if (!it || typeof it.commit !== 'function') return;
    nav.setIndex(n);
    if (it.commit(fine.value)) onSelect?.(it);
    render();
  }, sig);

  // The draft, kept in step with the box so a repaint cannot lose it.
  listEl.addEventListener('input', (e) => {
    if (editing && e.target.matches?.('[data-edit-input]')) editing.draft = e.target.value;
  }, sig);

  // Enter and Escape IN THE BOX. Handled here, on the list, because this runs before the panel's
  // own keydown below (the event bubbles box -> list -> panel). See TEXT ROWS for why only
  // Escape is stopped.
  listEl.addEventListener('keydown', (e) => {
    if (!editing || !e.target.matches?.('[data-edit-input]')) return;
    if (e.key === 'Enter') { e.preventDefault(); editing.draft = e.target.value; saveEdit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  }, sig);

  // Clicking the scrim closes. A menu you cannot dismiss by clicking away reads as a
  // crash to anyone who did not mean to open it.
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim && !asPanel) close(); }, sig);

  pageEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-page-back]')) closePage();
  }, sig);

  // --- keyboard. ONLY the keys nothing else owns. ---
  //
  // Arrows and Enter are deliberately NOT handled here. Where an input bus exists they are
  // already bound to verb/next, verb/prev and verb/select, and handling them here too
  // would move the cursor twice per press. The kiosk, which has no bus, calls next()/
  // prev()/select() from its own key handler instead. Two paths, never both at once.
  panel.addEventListener('keydown', (e) => {
    // A menu in a panel is not a dialog: Escape is the screen's (its menu verb), and Tab walks on out of it.
    if (!open || asPanel) return;
    // `stopPropagation` because Escape is ALSO bound (input_keyboard.js's default/menu -> verb/menu
    // -> `toggle()`, via `attachBus`), and the same keystroke bubbles on to the window listener
    // that feeds the input bus. Closing here and then letting that run put the menu straight back:
    // pressing Escape with focus in the panel -- where a click on the gear leaves it -- did
    // nothing, on any host with a single menu and the default bindings (a signed-out kiosk, and
    // the modules-page embed). `M` and the Close row never had the problem: neither reaches this
    // handler.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    // The focus trap. Tab must not walk out of an open modal onto the page behind it. Inputs
    // count since 2026-09-28: the text box and the fine colour picker are focusable too, and a
    // trap that only knew buttons would let Tab walk off the last one of THOSE.
    const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled])')];
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }, sig);

  // --- optional: drive from a verb bus, where one exists. ---
  //
  // `router` is paused while the menu is open so a press does not ALSO reach the panel
  // behind it — pressing "next" in the menu must not advance her photos underneath.
  function attachBus(bus, verbRouter = null) {
    if (!bus) return () => {};
    router = verbRouter || router;
    const off = [
      bus.subscribe(verbTopic('menu'), () => toggle()),
      bus.subscribe(verbTopic('next'), () => { if (open) next(); }),
      bus.subscribe(verbTopic('prev'), () => { if (open) prev(); }),
      bus.subscribe(verbTopic('select'), () => { if (open) select(); }),
      bus.subscribe(verbTopic('back'), () => { if (open) back(); }),
      // "Close the menu" (actions.js ACTION_VERBS, 2026-10-02): closes it and never opens it, so a
      // spoken close heard twice cannot put the menu back.
      bus.subscribe(verbTopic('close'), () => { if (open) close(); }),
      // THE TABS, by a bound switch or a spoken "next tab" / "audio settings" (actions.js MENU_ACTIONS).
      // `{ dir }` steps; `{ tab }` goes to one. Either OPENS the menu when it is closed: "audio
      // settings" said to a closed menu means "show me them", and stepping a closed menu would be a
      // press that shows nothing.
      bus.subscribe(MENU_TAB_TOPIC, (p) => {
        if (!tabsOn) { if (!open) show(); return; }
        const want = p && typeof p.tab === 'string' ? p.tab : null;
        // (Closed and told to STEP: it opens where it always opens. A step from a menu nobody can see
        // would land somewhere nobody chose.)
        if (!open) { show(want ? { tab: want } : null); return; }
        if (want) showTab(want);
        else stepTab(p && Number(p.dir) < 0 ? -1 : 1);
      }),
    ];
    busOffs.push(...off);
    return () => off.forEach((fn) => fn());
  }

  return {
    open: show,
    close,
    toggle,
    isOpen: () => open,
    next, prev, select, back,
    refresh: render,
    openPage,
    closePage,
    page: () => page,
    // The id of the row whose text box is open, or null.
    editing: () => editing?.id || null,
    // ---- how somebody chooses (2026-10-02) ----
    // The mode in force ('point' | 'step'), and an outright setting of it (null hands it back to the host).
    chooseMode: () => modeNow(),
    setChooseMode(m) { modeOverride = m == null ? null : chooseModeOf(m); if (open && !page) paint(); return modeNow(); },
    // Would a press on row `id` open the choice picker right now?
    opensList: (id) => opensList(items.find((it) => it.id === id) || allItems.find((it) => it.id === id)),
    // The open picker's own probe (a choice or a picture picker), or null.
    pickerProbe: () => (picker && typeof picker.__probe === 'function' ? picker.__probe() : null),
    // EVERY row (with tabs: every tab's, each tagged with its `tab`, after the rows above the tabs).
    // What the cursor walks right now is `visibleItems()`.
    items: () => (tabsOn
      ? [...items.filter((it) => it.tab === '*top' && (it.subjectPick || it.tabStrip)),
        ...allItems].map((it) => ({ ...it }))
      : items.map((it) => ({ ...it }))),
    visibleItems: () => items.map((it) => ({ ...it })),
    focusIndex: () => nav.index(),
    focusId: () => nav.current()?.id || null,
    focusRow,
    openRow,
    // Whether this is the menu drawn in a panel (see `asPanel`).
    asPanel: () => !!asPanel,
    // ---- tabs (all null / no-ops on a host without them) ----
    tabs: () => tabList.map((d) => ({ ...d })),
    tab: () => (tabsOn ? tab : null),
    showTab: (id) => showTab(id),
    nextTab: () => stepTab(1),
    prevTab: () => stepTab(-1),
    tabOf: (id) => (allItems.find((it) => it.id === id) || items.find((it) => it.id === id))?.tab || null,
    // ---- the subject ("Settings for") ----
    subjectId: () => (subjects ? (currentSubject()?.id || null) : null),
    setSubject(id) { chooseSubject(id); if (open) render(); return currentSubject()?.id || null; },
    attachBus,
    destroy() {
      close({ force: true });
      listeners.abort();
      busOffs.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
      busOffs.length = 0;
      root.innerHTML = '';
    },
  };
}

// Exported so a host can assert it wired every verb the menu understands.
export const MENU_VERBS = ['menu', 'next', 'prev', 'select', 'back', 'close'];
// ...and what else it answers on the bus: the tabs (actions.js MENU_ACTIONS).
export const MENU_TOPICS = [MENU_TAB_TOPIC];
export const ALL_VERB_IDS = VERBS.map((v) => v.id);
