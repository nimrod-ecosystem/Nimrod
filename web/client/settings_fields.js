// settings_fields.js — MODULES DECLARE THEIR SETTINGS AS DATA; THE SHELL RENDERS THEM.
//
// Slice 1 built the menu shell and left a disabled "arriving next" row where a panel's own
// settings belong. This is that row, and the reason it is DATA rather than markup is the
// only architectural argument in the file:
//
//   IF A MODULE HANDS OVER ITS OWN MARKUP, THE SHELL DOES NOT KNOW WHAT THE CONTROLS ARE.
//   It cannot move a cursor through them, so it cannot walk them with `next`, so the menu is
//   unreachable by anyone driving with one switch — who is exactly the person this product
//   exists for. A declared field is the only version where `next` and `select` reach it.
//
// THE ONE ABSOLUTE IN THIS FILE, stated plainly because the rule is that they get stated:
// *a control that cannot be reached by the only input somebody has is not a control.* That
// is the SAFETY reading of the one-button rule and it is why a field that cannot be cycled
// renders DISABLED AND LABELED rather than absent — a missing row sends people hunting for
// something that was never there.
//
// AND IT IS NARROWED, deliberately: it binds WHAT THE PERSON AT THE BEDSIDE USES. It does
// NOT bind the admin tools a clinician drives on a laptop — a precedence-sequence editor or
// a tag manager is a pointer-friendly, power-user job, and trying to make drag-to-reorder
// switch-operable ships something nobody can use. Two audiences, two rules, said out loud so
// nobody applies the wrong one.
//
// ---------------------------------------------------------------------------------------
// THE SIX KINDS, and what `select` does to each
//
//   toggle   flips it
//   choice   cycles to the next option, AND WRAPS -- or, past a few options and for anybody who
//            has not asked to step, OPENS THE CHOICE PICKER (2026-10-02, "HOW SOMEBODY CHOOSES")
//   number   steps by `step`, AND WRAPS at max back to min
//   color    cycles to the next colour in its palette, AND WRAPS (see below)
//   text     opens a TEXT BOX (see below). NOT cycleable, and honest about it.
//   picture  opens the PICTURE PICKER (see below; added 2026-10-02). Not cycleable either.
//
// WHY WRAPPING IS THE WHOLE CONTRACT: with one switch you can only travel ONE WAY. A control
// that stops at its maximum strands the person there with no way back. Same rule the menu
// cursor and the focus ring already follow, for the same reason.
//
// ---------------------------------------------------------------------------------------
// TEXT — CHANGED 2026-09-28, and what survived the change.
//
// What this said until today: *"text: NOT cycleable, and honest about it. Free text and pickers
// over live data (a folder path, an album of four hundred) render read-only with a reason, and
// stay editable where they already live."* Half of that was right and is KEPT; half was a
// smaller product than it needed to be and is gone.
//
//   KEPT: a person with only a switch cannot type, and the row SAYS SO ("needs a keyboard") -
//   in the hint, on every text row, whether or not a keyboard is plugged in. Stepping a text
//   field is still a no-op, and `cycleable` is still false. No fake affordance.
//
//   GONE: "read-only in the menu". It refused the keyboard and the mouse that COULD type, so
//   every text setting in the product (a sprint's name, a subject, an API key) was unreachable
//   from the one menu meant to hold every setting - each module grew its own text box instead,
//   which is the per-module-menu drift `settings.js` exists to stop. Mike, asked what to do
//   about a name that has to be typed: *"plain text box is fine"* / *"keyboard box now"*.
//
// SO: a text field is `editable` unless declared `readOnly`. Its row is a cursor STOP (the
// keyboard user walks to it with the same arrows as everything else); `select` or a click
// opens an inline box in the menu; Enter/Save commits, Escape/Cancel leaves it unchanged. The
// box itself lives in `settings.js` - this file only says the field is editable and hands the
// row a `commit(value)` that reports through `onStep` like every other write (see below).
//
// THE COST, stated rather than hidden: an editable text row is now one more stop on a switch
// user's walk, and pressing select on it opens a box they cannot use. Every menu move (`next`,
// `prev`, `back`, `select`) leaves the box, so it is one wasted press, never a trap. A field
// that is genuinely OWNED elsewhere - a picker over live data, like photos' album - declares
// `readOnly` and stays the disabled signpost it always was.
//
// ---------------------------------------------------------------------------------------
// COLOR — ADDED 2026-09-28 (Mike: *"settings for font, style, and color ... the color picker
// should be in the settings menu"*).
//
// The value is a hex string, `#rrggbb`. Its options are a PALETTE of named colours -
// `color_picker.js`'s DEFAULT_PALETTE unless the field declares its own `options` - and
// stepping cycles through them and wraps, exactly like a choice, so a colour is reachable from
// one switch. The menu ALSO draws the swatches and the browser's fine picker for a pointer;
// those are not cursor stops, and a value chosen with the fine picker is a real value, not a
// dead one: the row names it by its nearest palette colour plus the hex, and the next press
// steps on from THAT colour's place rather than jumping to the top.
//
// FONT NEEDS NO KIND. A `choice` of font options is exactly the control a font wants; adding a
// kind for it would be a second engine for the same walk.
//
// ---------------------------------------------------------------------------------------
// PICTURE — ADDED 2026-10-02 (Mike: *"Having the pictures scroll through all your pictures in the
// settings menu isn't a good way to do it. There should be upload or a folder picker."*).
//
// Until today a picture was a `choice` whose options were every file in a folder, so choosing one
// was a walk past every other one, one press each. A picture is now its own kind, and `select` does
// not step it: it OPENS the shared picker (`picture_picker.js`) — recent pictures first, "add one
// from this device", and a folder's thumbnails in a grid a switch scans by rows. So the row is a real
// stop (`opens`), not disabled and not cycleable, and nothing here walks a list of files.
//
// WHAT IS STORED is a reference, never the picture: with `sourceKey` (the button's `imageFrom`), the
// path at `key` and the source id at `sourceKey` - the two keys the button already stored, so no saved
// row moves; without it, `{ sourceId, path }` at `key`. The row's `commit(ref)` writes them through
// the same `onStep` as every other row (`null` is "No picture", where `allowNone` is not false).
// THE BYTES ARE NEVER IN A SETTINGS ROW, argued: a settings row is synced to the platform and
// read on every screen; a photo is megabytes, and putting it there would send somebody's picture to
// the server this project promises never sees media. Even a "tiny" one: there is no size at which a
// person's photo stops being their photo, and a reference costs nothing.
//
// THE MENU OPENS IT, and this file still does not touch the page: the row carries `picture` (what
// is chosen now, and the sources to choose from), and `settings.js` mounts the picker where its pages
// go. A host that renders rows itself and only calls `run()` gets the picker as a dialog over the
// page, loaded only when the row is pressed.
//
// ---------------------------------------------------------------------------------------
// PLAYERS — ADDED 2026-10-06 (Mike: "Picking the players will need to be a universal thing").
//
// Who is playing, as seats (player_picker.js argues the seats). Like a picture row it is a stop that
// OPENS a picker (`player_picker.js`, in the menu's page slot; a dialog for a host that only calls
// `run()`), never a step. The value: '' hands the choice to the screen ("This screen's players"),
// on a field that allows it (`follow`, default true: a game's own row); otherwise a list of seats.
// An OLD TEXT VALUE ("Ann, Bob", the free-text row this replaces) is read as guests, at read time
// only - like `legacy` and `aliases`, nothing stored is rewritten until somebody picks again.
// `max`: the most players (default and ceiling player_picker.js MAX_SEATS).
//
// ---------------------------------------------------------------------------------------
// WHAT THIS FILE MUST NEVER DO: WRITE.
//
// Nothing here calls `state.set()`. `stepValue` computes the next value and `fieldItems`
// reports `(key, nextValue, field)` through `onStep`, and stops. A typed value or a picked
// colour (`commit()` on a text or colour row, 2026-09-28) goes out THROUGH THE SAME `onStep` -
// one write path, so a host that knows where one value lives knows where all of them do. The
// name is historical; it is the write callback. ONLY THE HOST KNOWS WHERE A
// VALUE LIVES — there are six homes for one (instance, module, screen, device, person,
// account) and they are an INHERITANCE CHAIN, not six buckets. Baking a destination in here
// would have to be unpicked the day the chain arrives. The chain itself is not built yet;
// this is the seam it plugs into.
//
// EVERYTHING BELOW IS PURE. `stepValue` is the entire one-button contract in one function,
// so it is tested alone and exhaustively — which is the mitigation for the real cost of a
// big options surface. Options do not bloat the CODE (one engine, declarations as data);
// they bloat the COMBINATION SPACE, which cannot be tested end to end. So the resolver gets
// hammered on its own and the wiring gets tested once.

// ---------------------------------------------------------------------------------------
// THE HOUSE RULE FOR DURATIONS, written where the validator will look for it.
//
// EVERY STORED DURATION IS IN MILLISECONDS, and its key ends in `Ms`. The declaration carries
// the display unit, so a row reads "8 seconds" while storage holds 8000.
//
// WHY THE KEY HAS TO CHANGE WHEN THE UNIT DOES, and this is the dangerous part rather than
// the arithmetic: if `intervalSec` simply started meaning milliseconds, an un-migrated `8`
// becomes eight MILLISECONDS - a slideshow advancing a hundred and twenty five times a
// second. Renaming makes the old and new values impossible to confuse, makes the migration
// detectable, and makes a value nobody migrated read as ABSENT rather than as absurd.
//
// WHY IT IS WORTH DOING AT ALL, in Mike's words: *"it honestly would be valuable data to me
// right now to know what settings someone in that situation might like."* Three "how
// long between things" settings in two different units cannot be compared, grouped, or set
// together - so they are not data, they are decoration.
// ---------------------------------------------------------------------------------------

// Most permissive last. A field shows when its own level is at or below the active one.
import { DEFAULT_PALETTE, normalizeHex, normalizePalette, nearestColor, describeColor } from './color_picker.js';
// players (2026-10-06): WHO IS PLAYING is its own kind, a stop that opens the shared player picker.
import { normalizeSeats, followsScreen, playersValueLabel, MAX_SEATS } from './player_picker.js';

export const LEVELS = ['essential', 'standard', 'advanced'];
export const KINDS = ['toggle', 'choice', 'number', 'text', 'color', 'picture', 'players'];

// A picture reference, or null. Shared by the reading below and the row's `commit`.
const refOf = (x) => (x && typeof x === 'object' && x.sourceId && x.path
  ? { sourceId: String(x.sourceId), path: String(x.path) } : null);

/** The picture a `picture` field has in force: `{ sourceId, path }`, or null for none. */
export function pictureRef(field, values = {}) {
  if (!field || field.kind !== 'picture') return null;
  const v = values || {};
  if (field.sourceKey) {
    const path = fieldValue(field, v);
    const src = v[field.sourceKey];
    return path && src ? { sourceId: String(src), path: String(path) } : null;
  }
  return refOf(readWithLegacy(v, field.key, field.legacy));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// How many decimal places a step implies. `0.5` has to survive being added to itself twenty
// times without becoming 9.999999999999998 on a row somebody is reading.
function decimalsOf(n) {
  const s = String(n);
  if (s.includes('e') || s.includes('E')) return 6;      // exponent notation: just be generous
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}
const round = (n, d) => Number(Math.round(Number(`${n}e${d}`)) + `e-${d}`);

// `legacy: { key, scale }` - the key this setting used to be stored under, and what to
// multiply the old value by. `{ key: 'intervalSec', scale: 1000 }` is the whole of the
// seconds-to-milliseconds migration for one field.
function normalizeLegacy(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  const scale = Number(raw.scale);
  return { key, scale: Number.isFinite(scale) && scale !== 0 ? scale : 1 };
}

// ---------------------------------------------------------------------------------------
// readWithLegacy - the raw stored value for a key, falling back to where it used to live.
//
// Exported because THREE MODULES STILL HAVE NO DECLARATIONS and need the same fallback. One
// implementation, two callers, rather than four hand-rolled `?? saved.oldKey * 1000` lines
// that will disagree with each other within a month.
//
// PRESENCE IS WHAT COUNTS, not truthiness. A stored `0` is a real value somebody chose, and
// falling back off it would resurrect a setting they had turned off.
// ---------------------------------------------------------------------------------------
export function readWithLegacy(values, key, legacy = null) {
  const at = (k) => (values && typeof values === 'object'
    && Object.prototype.hasOwnProperty.call(values, k)
    && values[k] !== undefined && values[k] !== null)
    ? values[k] : undefined;

  const own = at(key);
  if (own !== undefined) return own;
  if (!legacy) return undefined;
  const old = at(legacy.key);
  if (old === undefined) return undefined;
  const n = Number(old);
  // Garbage in the OLD key is not a value worth carrying forward - it reads as absent, so
  // the default applies, which is the same outcome as never having set it.
  return Number.isFinite(n) ? n * legacy.scale : undefined;
}

// `{ oldValue: newValue }`, kept only where the new value is one of the options — an alias to
// nothing would turn one dead value into another.
function normalizeAliases(raw, options) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [from, to] of Object.entries(raw)) {
    const hit = options.find((o) => String(o.value) === String(to));
    if (hit && !options.some((o) => String(o.value) === from)) out[from] = hit.value;
  }
  return Object.keys(out).length ? out : null;
}

// The default in force for this row: `defaultFrom(values)` when the field has one and it answers,
// else the static `default`.
function defaultFor(field, values) {
  if (field.defaultFrom) {
    try {
      const v = field.defaultFrom(values || {});
      if (v !== undefined && v !== null) return v;
    } catch { /* a broken module must not take the menu with it */ }
  }
  return field.default;
}

// Accepts `['a', 'b']` or `[{ value, label }]`, because a module author will write both and
// being fussy about it buys nothing.
// An option may also carry what the choice PICKER previews it with (choice_picker.js, 2026-10-02):
// `swatch` (a colour or a list of them), `font` (a CSS family), `thumb` (a picture URL), and a `hint`
// (a few words under its name). Carried through untouched; nothing here reads them.
const OPTION_EXTRAS = ['hint', 'swatch', 'font', 'thumb'];
function normalizeOptions(raw) {
  const out = [];
  const seen = new Set();
  for (const o of Array.isArray(raw) ? raw : []) {
    const value = (o && typeof o === 'object') ? o.value : o;
    if (value === undefined || value === null) continue;
    const key = String(value);
    // A DUPLICATE VALUE IS NOT HARMLESS: `findIndex` returns the first, so cycling off the
    // second copy jumps backwards and the list appears to stick. First one wins.
    if (seen.has(key)) continue;
    seen.add(key);
    const opt = { value, label: String((o && typeof o === 'object' && o.label) || value) };
    if (o && typeof o === 'object') {
      for (const k of OPTION_EXTRAS) if (o[k] !== undefined && o[k] !== null && o[k] !== '') opt[k] = o[k];
    }
    out.push(opt);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// HOW SOMEBODY CHOOSES — A PRESS STEPS, OR A LONG LIST OPENS (2026-10-02).
//
// Mike: *"Things like modules, pictures, themes where there are a lot of options shouldn't be set up
// to have to click through them all as default. That could be an option for switch users, but would
// be very frustrating for most people."*
//
// So a `choice` with MORE THAN `PICKER_OVER` options opens the choice picker (choice_picker.js) on a
// press, instead of stepping to the next option; a short one still steps. And a person can say they
// choose by stepping — "How you choose things: Step through (for a switch)" — and then every choice
// steps, however long, exactly as before: for a single switch the walk IS the way to choose, and the
// picker, though it scans by rows, is one more thing to learn.
//
// *** THE THRESHOLD, 5, ARGUED (a default, and an option: `pickerOver` on the menu, `picker` on a
// field). *** Opening a picker and choosing costs 2 presses, always. Stepping to a given option costs,
// on average, half a lap: (n - 1) / 2. Those are equal at n = 5 (4 presses worst, 2 on average, and
// every step shows its value in the row's hint as it goes), and from 6 the walk costs more on average
// than the list. Below that the cycle is the quicker control AND applies each value as it goes, which
// is what a 3-way "Panel backgrounds" wants. The short choices in the product today — on/off, the three
// complexity levels, burn-in, panel backgrounds, the five switch-hold times — all stay quick rows; the
// themes (twelve), a sign's fonts and frames, the wallpapers and scenes become lists.
//
// A FIELD MAY SAY: `picker: true` (always a list, e.g. four layouts with pictures) or `picker: false`
// (always a step, e.g. a long list of numbers a person nudges). The person's "step through" beats both.
// Colours are not affected: their row already draws every swatch for a pointer, beside the step.
// ---------------------------------------------------------------------------------------
export const PICKER_OVER = 5;
export const CHOOSE_MODE_KEY = 'chooseMode';
export const CHOOSE_MODES = Object.freeze(['point', 'step']);
export const DEFAULT_CHOOSE_MODE = 'point';
/** The field for the person's own choice. `essential`: it changes how every long list behaves, so no
 *  level may hide it. Two options, so it is itself a quick row (a switch flips it in one press). */
export const CHOOSE_MODE_FIELD = Object.freeze({
  key: CHOOSE_MODE_KEY, label: 'How you choose things', kind: 'choice', level: 'essential',
  default: DEFAULT_CHOOSE_MODE,
  options: Object.freeze([
    Object.freeze({ value: 'point', label: 'Point and click: long lists open as a list' }),
    Object.freeze({ value: 'step', label: 'Step through (for a switch): each press moves to the next' }),
  ]),
});
/** A stored value (or a host's answer) as one of CHOOSE_MODES; anything else is the default. */
export function chooseModeOf(v) {
  return CHOOSE_MODES.includes(v) ? v : DEFAULT_CHOOSE_MODE;
}
/** Does a press on this field open the choice picker (true) or step it (false)? Pure. */
export function opensPicker(field, { mode = DEFAULT_CHOOSE_MODE, over = PICKER_OVER } = {}) {
  if (!field || field.kind !== 'choice' || field.readOnly || !field.cycleable) return false;
  if (chooseModeOf(mode) === 'step') return false;
  if (field.picker === true) return true;
  if (field.picker === false) return false;
  const n = Number(over);
  return (field.options || []).length > (Number.isFinite(n) && n >= 0 ? n : PICKER_OVER);
}

// ---------------------------------------------------------------------------------------
// normalizeField — one declaration in, one usable field out (or null).
//
// A BAD DECLARATION IS DROPPED, NEVER THROWN. One module shipping a malformed field must not
// be able to stop the settings menu from opening: the menu is how somebody repairs a screen,
// so it has to survive the thing that is broken.
// ---------------------------------------------------------------------------------------
export function normalizeField(raw = {}) {
  const key = raw && typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;

  const level = LEVELS.includes(raw.level) ? raw.level : 'standard';
  const label = String(raw.label || key);
  const options = normalizeOptions(raw.options);

  // The declared kind wins; otherwise infer from what is there. Inference is worth having
  // because `{ key: 'calm', default: false }` is what somebody actually writes.
  let kind = KINDS.includes(raw.kind) ? raw.kind : null;
  if (!kind) {
    if (options.length) kind = 'choice';
    else if (typeof raw.default === 'boolean') kind = 'toggle';
    else if (isNum(raw.default)) kind = 'number';
    else kind = 'text';
  }

  const f = {
    key, label, kind, level,
    default: raw.default,
    note: raw.note ? String(raw.note) : null,
    // WHERE THIS VALUE USED TO LIVE. A declaration rather than code, so the next unit change
    // is a line in a manifest instead of a migration script somebody has to remember to run
    // - and so the module, the settings menu and anything that later groups settings across
    // panels all read the migrated value through ONE function.
    legacy: normalizeLegacy(raw.legacy),
    // A DEFAULT THAT DEPENDS ON THE OTHER SETTINGS (added 2026-09-29 for `button`: the words'
    // colour nobody has chosen should be the one that READS on the sign they did choose — light
    // words on a chalkboard, dark ones on a brass plate). `defaultFrom(values)` gets the stored row
    // and returns the default in force; `default` stays the static fallback (and what a reader
    // with no row sees). Read by `fieldValue`, so the module, the menu row and the swatch all name
    // the SAME colour — the menu never says "Black" over white words. A function that throws or
    // returns nothing falls back to `default`: the menu must survive a broken module.
    defaultFrom: typeof raw.defaultFrom === 'function' ? raw.defaultFrom : null,
    // A SETTING THAT ONLY MATTERS SOMETIMES (added 2026-09-29, Mike: "hide it"). `appliesWhen(values)`
    // gets the stored row; false means the row would change nothing on the screen right now (the
    // button's background colour under a designed sign with no frame — the sign brings its own
    // ground), so the menu leaves the row out rather than offering a control that visibly does
    // nothing. The VALUE is untouched and comes back into force the moment the row applies again.
    // A function that throws shows the row: a broken module must not hide its own settings.
    appliesWhen: typeof raw.appliesWhen === 'function' ? raw.appliesWhen : null,
    cycleable: false,
    // Can a KEYBOARD or a POINTER set it in the menu, when a switch cannot? Only text, today.
    editable: false,
    why: null,
  };

  if (kind === 'toggle') {
    f.default = raw.default === undefined ? false : !!raw.default;
    f.onLabel = String(raw.onLabel || 'On');
    f.offLabel = String(raw.offLabel || 'Off');
    f.cycleable = true;
  } else if (kind === 'choice') {
    f.options = options;
    f.default = raw.default === undefined ? (options[0]?.value ?? '') : raw.default;
    f.emptyLabel = String(raw.emptyLabel || 'Not set');
    // RENAMED VALUES (added 2026-09-29): `aliases: { oldId: newId }`. `legacy` above is for a
    // KEY that moved; this is for a VALUE that did — `button`'s placeholder sign `plaque` became
    // Design's `plate`. Read-time only, like `legacy`: nothing is rewritten in storage, and the
    // row shows (and steps from) the new value, so a saved choice never reads as dead.
    f.aliases = normalizeAliases(raw.aliases, options);
    // List or step (see HOW SOMEBODY CHOOSES above): the field's own say, or null for the threshold.
    f.picker = raw.picker === true ? true : (raw.picker === false ? false : null);
    // What the picker previews an option with when the option does not say ('theme': its colours).
    f.preview = typeof raw.preview === 'string' && raw.preview ? raw.preview : null;
    if (options.length >= 2) f.cycleable = true;
    // NOT AN ERROR, AND NOT HIDDEN. "No photo source connected" is a state a real screen sits
    // in, and the row saying so is the only place a caregiver learns it.
    else f.why = options.length ? 'only one to choose from' : 'nothing to choose from yet';
  } else if (kind === 'number') {
    let min = isNum(raw.min) ? raw.min : (typeof raw.min === 'string' && raw.min !== '' && isNum(Number(raw.min)) ? Number(raw.min) : null);
    let max = isNum(raw.max) ? raw.max : (typeof raw.max === 'string' && raw.max !== '' && isNum(Number(raw.max)) ? Number(raw.max) : null);
    if (min !== null && max !== null && min > max) { const t = min; min = max; max = t; }
    let step = Math.abs(Number(raw.step));
    if (!Number.isFinite(step) || step === 0) step = 1;
    f.min = min; f.max = max; f.step = step;
    f.decimals = Math.max(decimalsOf(step), decimalsOf(min ?? 0), decimalsOf(max ?? 0));
    f.unit = raw.unit ? String(raw.unit) : '';
    f.unitOne = raw.unitOne ? String(raw.unitOne) : '';
    // STORE ONE UNIT, SHOW THE ONE A HUMAN THINKS IN. Mike: *"I'd let the user see things in
    // seconds wherever relevant."* Storage stays milliseconds so durations are comparable
    // across modules; `displayScale` is what the ROW divides by. Nothing else in the file
    // knows about it - stepping, wrapping and bounds all happen in stored units, so the
    // one-button contract is untouched.
    //
    // `inputs.js` already learned the human half of this: *"every number here is in
    // milliseconds, which nobody thinks in."* This is the fix for that, made declarable.
    const ds = Number(raw.displayScale);
    f.displayScale = Number.isFinite(ds) && ds > 0 ? ds : 1;
    const dd = Number(raw.displayDecimals);
    f.displayDecimals = Number.isFinite(dd) && dd >= 0
      ? Math.floor(dd)
      // Derived from what a single STEP looks like once scaled: a 500ms step shown in
      // seconds needs one decimal, a 1000ms step needs none. Guessing wrong here shows
      // somebody "1.5 seconds" as "2 seconds", which makes the control look broken.
      : Math.min(3, Math.max(0, decimalsOf(round(step / f.displayScale, 6))));
    f.default = isNum(raw.default) ? raw.default : (min ?? 0);
    // AN UNBOUNDED NUMBER CANNOT WRAP, and a one-button user walking a number with no ceiling
    // is walking forever. So bounds are what makes a number cycleable at the bedside; without
    // them it is a keyboard field wearing a number's clothes, and it says so.
    if (min === null || max === null) f.why = 'needs a keyboard';
    else if (min === max) f.why = 'only one value';
    else f.cycleable = true;
  } else if (kind === 'color') {
    // THE PALETTE IS A DEFAULT, NOT A LAW: a field's own `options` replace it (any of the shapes
    // `normalizePalette` accepts). Held twice on purpose - `palette` in the picker's own
    // `{ id, name, hex }` shape for the swatches, `options` in the `{ value, label }` shape every
    // other reader of a field (the audit, `pressesToWalk`) already understands.
    const declared = Array.isArray(raw.options) && raw.options.length ? normalizePalette(raw.options) : null;
    f.palette = declared && declared.length ? declared : normalizePalette(DEFAULT_PALETTE);
    f.options = f.palette.map((c) => ({ value: c.hex, label: c.name }));
    // A garbage default is not a colour; the first on the list is the one guaranteed to be.
    f.default = normalizeHex(raw.default) || f.options[0]?.value || '';
    if (f.options.length >= 2) f.cycleable = true;
    else f.why = f.options.length ? 'only one to choose from' : 'nothing to choose from yet';
  } else if (kind === 'picture') {
    // See PICTURE in the header. Not cycleable (nothing here steps through files) and not a text
    // box; a stop that OPENS the picker. Only ever this kind when declared - never inferred.
    f.sourceKey = typeof raw.sourceKey === 'string' && raw.sourceKey.trim() ? raw.sourceKey.trim() : null;
    f.default = f.sourceKey ? (raw.default == null ? '' : String(raw.default)) : (refOf(raw.default) || null);
    f.emptyLabel = String(raw.emptyLabel || 'No picture');
    f.allowNone = raw.allowNone !== false;
    // The sources to choose from, when a mounted instance hands its own client over (through
    // `settingsChoices`); otherwise the picker asks the registry itself.
    f.sources = raw.sources && typeof raw.sources.list === 'function' ? raw.sources : null;
    f.opens = true;
  } else if (kind === 'players') {
    // See PLAYERS in the header. Only ever this kind when declared - never inferred.
    f.follow = raw.follow !== false;
    const mx = Math.floor(Number(raw.max));
    f.max = Number.isFinite(mx) && mx >= 1 ? Math.min(MAX_SEATS, mx) : MAX_SEATS;
    f.default = f.follow ? '' : [];
    f.opens = true;
  } else {
    f.default = raw.default === undefined ? '' : String(raw.default);
    // `secret: true` -- a key or token. Mike, 2026-09-28: "mask it". Anyone at a shared or bedside
    // screen can open the menu, so the row shows only the last four characters, the text box opens
    // EMPTY (the value is never put into the page), and saving an empty box keeps what is there.
    f.secret = raw.secret === true;
    f.placeholder = String(raw.placeholder || (f.secret ? 'Type a new one to replace it' : 'Not set'));
    // STILL SAID, on every text row (see the header's TEXT section): a switch cannot type.
    f.why = 'needs a keyboard';
    // ...but a keyboard and a mouse can, so the menu gives them a box. `readOnly` below undoes
    // this for a field that is only REPORTED here.
    f.editable = true;
    const ml = Number(raw.maxLength);
    // No length limit is invented: how long a name or a caption may be is the module's call.
    f.maxLength = Number.isFinite(ml) && ml > 0 ? Math.floor(ml) : null;
  }

  // WHAT THIS SETTING NEEDS IN ORDER TO WORK AT ALL. Mike: *"It should also be clearly marked
  // wherever it can be set up."* The earlier version of that rule only covered RUNTIME - say
  // no in words rather than failing silently - and his addition is better: the requirement
  // belongs on the ROW, so nobody enables something at home that quietly will not work at the
  // facility. `direct` means the two devices have to be able to reach each other without
  // going through the platform, which today means a VPN.
  //
  // The shell renders it; nothing here enforces it, because whether a requirement is MET is a
  // runtime question and this file is pure.
  f.requires = typeof raw.requires === 'string' && raw.requires.trim() ? raw.requires.trim() : null;

  // An explicit `readOnly` beats everything: it is how a field that is REPORTED here but
  // OWNED somewhere else (a source picker, a folder path) gets a row without a fake handle.
  if (raw.readOnly) {
    f.cycleable = false;
    f.editable = false;
    f.opens = false;
    f.readOnly = true;
    f.why = f.why || 'changed where it lives';
  }
  if (f.note) f.why = f.note;
  return f;
}

// ---------------------------------------------------------------------------------------
// fieldValue — what is IN FORCE for this field right now.
//
// Coercion is not tidiness. A `<select>` writes strings, so `intervalSec` has been living in
// storage as `"15"` since photos shipped; `"15" + 2` is `"152"`, which as a slideshow
// interval is two and a half minutes of the same photo. Read coerces, so stepping is
// arithmetic and not string concatenation.
// ---------------------------------------------------------------------------------------
export function fieldValue(field, values = {}) {
  if (!field) return undefined;
  // Own key first, then wherever this setting used to live, then the default. Absent, null
  // and undefined inherit the default. AN EMPTY STRING DOES NOT — `sourceId: ''` is a real
  // saved value meaning "no source chosen", and overwriting it with a default would undo
  // somebody's clearing of it.
  let raw = readWithLegacy(values, field.key, field.legacy);
  if (raw === undefined || raw === null) raw = defaultFor(field, values);

  if (field.kind === 'toggle') {
    if (typeof raw === 'string') return raw !== '' && raw !== 'false' && raw !== '0';
    return !!raw;
  }
  if (field.kind === 'choice') {
    // MATCHED LOOSELY, RETURNED CANONICALLY. Option values are whatever the module declared -
    // numbers for an interval, strings for an id - while storage has been through JSON and a
    // <select>, which writes strings. Comparing strictly meant a stored "15" matched no
    // numeric option, so a perfectly good saved value looked like a DEAD one and a single
    // press would "recover" it to the first option - silently changing a setting somebody
    // had chosen. Match on the string form, then hand back the DECLARED value, so everything
    // downstream compares strictly against one canonical type.
    const opts = field.options || [];
    const hit = opts.find((o) => o.value === raw)
      || opts.find((o) => String(o.value) === String(raw));
    if (hit) return hit.value;
    if (field.aliases && raw !== undefined
        && Object.prototype.hasOwnProperty.call(field.aliases, String(raw))) {
      return field.aliases[String(raw)];
    }
    return raw === undefined ? '' : raw;
  }
  if (field.kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return field.default;
    // CLAMPED ON READ, because this function answers "what is in force", and a stored 200 on
    // a field that maxes at 60 is not in force at 200 — the module clamps it too. Reporting
    // the stored number here would put a figure on the screen that nothing is obeying.
    if (isNum(field.min) && n < field.min) return field.min;
    if (isNum(field.max) && n > field.max) return field.max;
    return round(n, field.decimals ?? 0);
  }
  if (field.kind === 'color') {
    // Canonical on read, so "#D32F2F" from one surface and "#d32f2f" from another are the same
    // colour to everything downstream. Garbage is not in force; the default is.
    return normalizeHex(raw) || normalizeHex(defaultFor(field, values)) || field.default;
  }
  if (field.kind === 'picture') {
    // With a `sourceKey` the value is the PATH (a string, as the button always stored it); without
    // one it is the whole reference, or null.
    if (field.sourceKey) return raw === undefined || raw === null ? '' : String(raw);
    return refOf(raw);
  }
  if (field.kind === 'players') {
    // '' (the screen's players) where the field allows it, else the seats; an old typed list reads as guests.
    if (field.follow && followsScreen(raw)) return '';
    return normalizeSeats(raw, { max: field.max });
  }
  return raw === undefined ? '' : String(raw);
}

// ---------------------------------------------------------------------------------------
// stepValue — THE ONE-BUTTON CONTRACT, and the reason this file is worth testing alone.
//
// `dir` is +1 or -1. One switch only ever sends +1; a d-pad, a controller or a keyboard can
// send -1, which is the general rule this project follows everywhere: THE FULL VOCABULARY IS
// FASTER, THE MINIMAL ONE STILL WORKS. Nobody is locked out, nobody is slowed down.
// ---------------------------------------------------------------------------------------
export function stepValue(field, current, dir = 1) {
  if (!field || !field.cycleable) return current;
  const d = Number(dir) < 0 ? -1 : 1;

  if (field.kind === 'toggle') {
    // Direction is ignored, and that is correct rather than lazy: with two states, "back" and
    // "forward" land on the same place. Pretending otherwise would be a lie in the code.
    return !current;
  }

  if (field.kind === 'choice') {
    const opts = field.options || [];
    if (!opts.length) return current;
    const at = opts.findIndex((o) => o.value === current);
    // A STORED VALUE THAT IS NOT IN THE LIST TAKES ONE PRESS TO BECOME VALID AGAIN. It happens
    // for real: a media source gets deleted and every panel pointing at it holds a dead id.
    // Landing on the first option is the repair, and it is reachable from a single switch.
    if (at < 0) return opts[0].value;
    return opts[(at + d + opts.length) % opts.length].value;
  }

  if (field.kind === 'number') {
    const { min, max, step } = field;
    const dec = field.decimals ?? 0;
    // A GARBAGE VALUE BECOMES VALID IN ONE PRESS, landing on the minimum - the same recovery
    // the choice branch above makes, and for the same reason. Treating it as "start from min
    // and then step" instead would skip the minimum, so the one value guaranteed to be legal
    // is the one value a press could not reach.
    if (!Number.isFinite(Number(current))) return min;
    const cur = Number(current);
    const n = round(cur + step * d, dec);
    // OVERSHOOT LANDS ON THE BOUND FIRST, THEN WRAPS. With min 2, max 9, step 2 the naive
    // version jumps 8 -> 10 -> wrap -> 2 and 9 IS NEVER REACHABLE, so a declared maximum
    // silently is not one. Stopping at the bound for one press costs nothing and makes every
    // declared bound reachable from a single switch.
    if (n > max) return cur < max ? max : min;
    if (n < min) return cur > min ? min : max;
    return n;
  }

  if (field.kind === 'color') {
    const opts = field.options || [];
    if (!opts.length) return current;
    const cur = normalizeHex(current);
    // Garbage recovers to the first colour in one press - the choice branch's repair.
    if (!cur) return opts[0].value;
    let at = opts.findIndex((o) => o.value === cur);
    // A COLOUR OFF THE LIST IS NOT DEAD. Unlike a deleted media source it is a real choice
    // somebody made with the fine picker, and the row is showing it as "Close to Blue". So the
    // press moves on from where the row SAID it was - Blue's place - rather than jumping to the
    // top, which would read as the control ignoring what is set.
    if (at < 0) {
      const near = nearestColor(cur, field.palette || opts.map((o) => ({ hex: o.value, name: o.label })));
      at = near ? opts.findIndex((o) => o.value === normalizeHex(near.hex)) : -1;
      if (at < 0) return opts[0].value;
    }
    return opts[(at + d + opts.length) % opts.length].value;
  }

  return current;
}

// ---------------------------------------------------------------------------------------
// displayValue — the words on the row. Read by somebody standing up, so no units of
// milliseconds and no raw enum keys.
// ---------------------------------------------------------------------------------------
export function displayValue(field, value) {
  if (!field) return '';
  if (field.secret) {
    const v = String(value ?? '');
    return v ? `\u2022\u2022\u2022\u2022${v.length > 8 ? v.slice(-4) : ''}` : 'Not set';
  }
  if (field.kind === 'toggle') return value ? field.onLabel : field.offLabel;
  if (field.kind === 'choice') {
    const hit = (field.options || []).find((o) => o.value === value);
    if (hit) return hit.label;
    if (value === '' || value === undefined || value === null) return field.emptyLabel;
    // Naming the mismatch rather than showing a bare id: this is what a deleted media source
    // looks like from the bedside, and "not one of the choices" is the sentence that explains
    // why the panel is empty.
    return `${value} — not one of the choices`;
  }
  if (field.kind === 'number') {
    const scale = field.displayScale || 1;
    const shown = scale === 1 ? value : round(Number(value) / scale, field.displayDecimals ?? 0);
    const unit = (shown === 1 && field.unitOne) ? field.unitOne : field.unit;
    return unit ? `${shown} ${unit}` : String(shown);
  }
  if (field.kind === 'color') {
    // The NAME, because it may be heard rather than seen. Off the list: the nearest name plus the
    // hex, honest that it is not exactly that colour.
    return describeColor(value, field.palette) || field.default;
  }
  if (field.kind === 'picture') {
    // The picture's file name, without its folders - what somebody would recognise it by.
    const path = value && typeof value === 'object' ? value.path : value;
    const name = String(path || '').split('/').pop();
    return name || field.emptyLabel;
  }
  if (field.kind === 'players') return playersValueLabel(value, { follow: field.follow });
  return value === '' || value === undefined || value === null ? field.placeholder : String(value);
}

// Is this field shown at the active complexity level? `essential` is the stripped-down set
// for a patient's own screen, `standard` is what an average user expects, `advanced` is
// sequences, precedence and raw timings.
//
// NOTE ON THE TRAP IN COMPLEXITY LEVELS, since this is the function that would spring it: a
// level that hides the control which changes the level is a one-way door. This filter is
// applied ONLY to module fields — Home, Close and every other way out are built in
// `settings.js` and are not filtered by anything, at any level. When the level itself becomes
// a field in the tree, its escape has to be built in the same commit, not after.
export function showsAtLevel(field, level = 'standard') {
  const active = LEVELS.indexOf(LEVELS.includes(level) ? level : 'standard');
  const mine = LEVELS.indexOf(field?.level || 'standard');
  return mine <= active;
}

// ---------------------------------------------------------------------------------------
// fieldItems — fields in, ordinary settings-menu items out.
//
// They are ordinary on purpose: `{ kind: 'item', label, hint, run }` is exactly what `extras`
// already produces, so the shell's cursor walks them with no special case and slice 1's
// wrapping, heading-skipping and disabled-skipping all apply for free.
//
// `values` MAY BE A FUNCTION, and passing one is the safer call. An item built against a
// snapshot steps from the value that was current when the menu was PAINTED, so two presses
// without a repaint in between produce the same result twice — which from a switch reads as
// the second press being dropped. A function is read at press time and cannot do that.
// ---------------------------------------------------------------------------------------
export function fieldItems(fields = [], {
  values = {},
  level = 'standard',
  onStep = null,
  dir = 1,
  idPrefix = 'set:',
} = {}) {
  const read = typeof values === 'function' ? values : () => values;
  const out = [];
  for (const f of fields || []) {
    if (!f || !showsAtLevel(f, level)) continue;
    if (f.appliesWhen) {
      let applies = true;
      try { applies = f.appliesWhen(read() || {}) !== false; } catch { applies = true; }
      if (!applies) continue;
    }
    const value = fieldValue(f, read() || {});
    const shown = displayValue(f, value);
    // What the row says after the value. An EDITABLE text row keeps "needs a keyboard" AND its
    // note - the note used to replace the reason, which was fine while the reason was the whole
    // story, but now the row is usable by some people and not others and has to say both.
    const says = f.cycleable ? [shown]
      : f.editable ? [shown, 'needs a keyboard', f.note]
      : f.opens ? [shown, f.note]
      : [shown, f.why];
    const item = {
      kind: 'item',
      id: `${idPrefix}${f.key}`,
      label: f.label,
      // The current value IS the hint. A settings row that does not say what it is set to
      // makes somebody press it to find out, which on a one-way cursor means going all the
      // way round to undo the answer.
      // The requirement rides in the hint, so it is visible WHERE THE SETTING IS SET rather
      // than only when it fails.
      hint: [...says, f.requires === 'direct' ? 'needs a direct connection (VPN)' : f.requires]
        .filter(Boolean).join(' · '),
      // An editable text row is a real stop: a keyboard user reaches it with the same arrows. So is
      // a picture row: `select` opens the picker.
      disabled: !f.cycleable && !f.editable && !f.opens,
      key: f.key,
      field: f,
      value,
      run: () => {
        if (f.kind === 'players' && onStep) {
          // (players) The same, for the player picker: a dialog over the page, loaded only when pressed.
          import('./player_picker.js').then((m) => m.openPlayersDialog({
            ...item.players, onPick: (v) => { item.commit(v); },
          })).catch((err) => console.warn('settings: could not open the player picker', err));
          return;
        }
        if (f.opens && onStep) {
          // A host that renders rows itself (and is not `settings.js`, which opens the picker in its
          // own pages) gets it as a dialog. Imported only now, so this file stays free of the page.
          import('./picture_picker.js').then((m) => m.openPictureDialog({
            ...item.picture, onPick: (ref) => { item.commit(ref); },
          })).catch((err) => console.warn('settings: could not open the picture picker', err));
          return;
        }
        if (!f.cycleable || !onStep) return;
        const now = fieldValue(f, read() || {});
        onStep(f.key, stepValue(f, now, dir), f);
      },
      // SETTING A VALUE OUTRIGHT - a typed string, a swatch, the fine picker - rather than
      // stepping to the next one. Reports through the SAME `onStep` and returns whether it did,
      // so the shell can close the box either way. A value equal to the one in force is not a
      // write: no event, no state churn, for a change nobody made.
      commit: (raw) => {
        if (!onStep || f.readOnly) return false;
        let next;
        if (f.kind === 'text' && f.editable) {
          // Trimmed: a switch that emulates Space, pressed in the box, must not be able to pad a
          // name with blanks and have that count as a change.
          next = String(raw == null ? '' : raw).trim();
          if (f.maxLength) next = next.slice(0, f.maxLength);
          // A secret's box opens empty, so an empty save means "keep it", never "erase it".
          if (f.secret && !next) return false;
        } else if (f.kind === 'color' && f.options && f.options.length) {
          next = normalizeHex(raw);
          if (!next) return false;
        } else if (f.kind === 'choice' && f.cycleable) {
          // A CHOICE SET OUTRIGHT, from the choice picker (2026-10-02). Only one of its own options -
          // matched loosely, written canonically, as `fieldValue` reads - never a value it does not offer.
          const opts = f.options || [];
          const hit = opts.find((o) => o.value === raw) || opts.find((o) => String(o.value) === String(raw));
          if (!hit) return false;
          next = hit.value;
        } else if (f.kind === 'picture') {
          // A REFERENCE, or null for "No picture". Anything else (a URL, a File, bytes) is refused:
          // see PICTURE in the header for why a picture never goes into a settings row.
          const ref = refOf(raw);
          if (!ref && raw != null) return false;
          if (!ref && !f.allowNone) return false;
          const now = pictureRef(f, read() || {});
          if ((!ref && !now) || (ref && now && ref.sourceId === now.sourceId && ref.path === now.path)) return false;
          if (f.sourceKey) {
            // The source first, then the path: the two keys the button has always stored. "No
            // picture" clears only the path, so the folder somebody was choosing from is kept.
            if (ref) onStep(f.sourceKey, ref.sourceId, f);
            onStep(f.key, ref ? ref.path : '', f);
          } else {
            onStep(f.key, ref, f);
          }
          return true;
        } else if (f.kind === 'players') {
          // (players) '' (the screen's players, where the field allows it) or seats; nothing else is a value.
          if (f.follow && (raw === '' || raw == null)) next = '';
          else if (Array.isArray(raw)) {
            next = normalizeSeats(raw, { max: f.max });
            if (!next.length) return false;
          } else return false;
          if (JSON.stringify(next) === JSON.stringify(fieldValue(f, read() || {}))) return false;
          onStep(f.key, next, f);
          return true;
        } else {
          return false;
        }
        if (next === fieldValue(f, read() || {})) return false;
        onStep(f.key, next, f);
        return true;
      },
    };
    if (f.editable) {
      item.edit = { kind: 'text', value: f.secret ? '' : value, placeholder: f.placeholder, maxLength: f.maxLength };
    }
    if (f.kind === 'color' && !f.readOnly) item.color = { value, palette: f.palette || [] };
    // What the choice picker needs, on every steppable choice row: the options (with their previews),
    // what is chosen now, and its title. Whether a press OPENS it is the host's call at press time
    // (`opensPicker`, with the person's mode) - so `run()` stays the step it always was, for every host
    // and suite that presses a row by calling it.
    if (f.kind === 'choice' && f.cycleable && !f.readOnly) {
      item.choice = { options: f.options, value, title: f.label, key: f.key, preview: f.preview };
    }
    // What the picker needs to open on this row: what is chosen now, where to choose from, whether
    // "No picture" is offered, and its title (the row's own label, so it says what it is for).
    if (f.kind === 'players') {
      // (players) What the player picker needs: what is chosen now, whether "This screen's players" is offered, the
      // most players, and its title. Who the people are is the HOST's (settings.js `playerHost`): this file knows none.
      item.players = { value, follow: f.follow, max: f.max, title: f.label };
    } else if (f.opens) {
      item.picture = { value: pictureRef(f, read() || {}), sources: f.sources, allowNone: f.allowNone, title: f.label };
    }
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// fieldsFor — a module's declared fields, with any LIVE options merged in.
//
// The manifest declaration stays STATIC — it is the contract, it is inspectable without
// mounting anything, and a modules tab will want to read it off a module that is not running.
// But some options genuinely are data: which media sources this account has, which albums
// that source holds. So a MOUNTED INSTANCE may offer `settingsChoices()` returning
// `{ key: [options] }`, and those replace the declared ones for that key only.
//
// It has to be SYNCHRONOUS. It is called while the menu paints, and a menu that waits on a
// network round trip to draw a row is a menu that looks broken on a bad facility connection.
// A module with live choices caches them from work it was already doing.
// ---------------------------------------------------------------------------------------
export function fieldsFor(manifest = null, instance = null) {
  let decls = manifest?.settings;
  if (typeof decls === 'function') {
    try { decls = decls(); } catch { decls = []; }
  }
  if (!Array.isArray(decls)) return [];

  // `instance` may be the record `mountModule` returns or the raw factory result; a caller
  // holding one should not have to know which.
  const impl = instance?.impl || instance;
  let live = {};
  const fn = impl && typeof impl.settingsChoices === 'function' ? impl.settingsChoices : null;
  // A MODULE THAT THROWS WHILE THE MENU IS OPENING MUST NOT TAKE THE MENU WITH IT — the menu
  // is the tool for repairing the broken thing. It falls back to the declared options.
  if (fn) { try { live = fn.call(impl) || {}; } catch { live = {}; } }

  const out = [];
  for (const d of decls) {
    if (!d || typeof d.key !== 'string') continue;
    // A live entry is OPTIONS (an array) for every kind but one: a picture row's live entry is an
    // object, `{ sources }` - the instance's own media client, so the picker lists what it lists.
    let merged = d;
    if (Object.prototype.hasOwnProperty.call(live, d.key)) {
      const v = live[d.key];
      merged = v && !Array.isArray(v) && typeof v === 'object' && v.sources
        ? { ...d, sources: v.sources } : { ...d, options: v };
    }
    const f = normalizeField(merged);
    if (f) out.push(f);
  }
  return out;
}
