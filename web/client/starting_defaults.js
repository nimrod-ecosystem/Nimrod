// starting_defaults.js — STARTING SETTINGS BY NEED AND AGE. DEFAULTS, NEVER LOCKS.
//
// MIKE_CHANGE_LIST.md rows 2.43 + 2.48 (Mike, 2026-09-30):
//   *"Sort of keep things easier by default for anyone that needs it. Not necessarily locks,
//    just a different set of defaults unless a guardian wants to lock anything."*
//   *"Kind of like difficulty level ... Maybe have checkboxes for things like colorblindness/
//    epilepsy/stroke/TBI/Parkinsons/Autism/etc. Can't these type of settings be saved to their
//    devices though? Maybe suggest doing that with a warning that they're putting it online. We
//    don't intend to use it, but no one can guarantee the security of anything."*
//
// THREE INPUTS, ONE OUTPUT. A difficulty-style LEVEL (the settings menu's own `complexity` levels,
// not a second scale), condition BOXES, and an AGE BAND go in; a LAYER of default values comes out.
//
// ---------------------------------------------------------------------------------------
// *** A LAYER UNDERNEATH, NOT A WRITE INTO THE SETTINGS. ***
//
// The layer is never merged INTO anybody's settings. The host reads settings through
// `withStartingDefaults(values, layer)`, which fills only what is UNSET. That one shape is what
// makes all three of Mike's conditions true at once, rather than three separate guards:
//   * "not locks"            - any setting somebody picks simply sits on top of the layer;
//   * never overrides a choice - a chosen value is present, so the layer never reaches it;
//   * "saved to their device" - the layer lives in this device's storage, so applying it puts
//                               nothing online; the screen's online settings are not touched.
// "Chosen" means PRESENT: an own key whose value is not undefined/null. An empty string is a
// choice (somebody cleared it) - the same rule `settings_fields.js`'s `readWithLegacy` uses.
//
// ---------------------------------------------------------------------------------------
// *** ARE THE TICKED BOXES THEMSELVES STORED? Argued, because chat and Mike pulled both ways. ***
//
//   FOR storing only the resulting settings (chat, row 2.43): a stored diagnosis is health data
//   about a person; the software only needs the settings.
//   FOR storing the boxes (Mike, row 2.48 - "stored on the device by default"): (1) a box whose
//   defaults are still "to be filled" sets nothing, so if the box is not kept the answer is simply
//   LOST, and it cannot take effect on the day its defaults are filled in; (2) reopening the
//   picker should show what was ticked, or the next person to open it re-answers from scratch;
//   (3) "which box set this" (row 2.48 note c) needs the box.
//   RECOMMENDATION, BUILT: keep the boxes ON THE DEVICE ONLY, next to the layer. ONLINE, only the
//   settings go by default; the boxes go too only if somebody ticks that separately
//   (`includeAnswers`). "Forget what was ticked" clears them from the device and keeps the
//   settings. Note the settings still hint at a condition (a flash cap says something) - which is
//   why the online warning is shown for the settings-only save too.
//
// ---------------------------------------------------------------------------------------
// *** ONLY PUBLISHED GUIDANCE SETS ANYTHING. *** Every other box is "to be filled": it is shown,
// it can be ticked, it is recorded, and it changes NOTHING until someone fills it from a source.
// Every source below is marked [training knowledge] - none was verified against the standard's
// text from inside this repo. The research brief that would fill the rest is
// `docs/from_chat/research_brief_accessibility_settings_20260911.md` (private repo); whether it
// was ever run is not checked.
//
// THE NUMBERS HERE (3 flashes a second, 44 px) ARE THE STANDARDS' OWN NUMBERS, used as DEFAULTS.
// Each one is an ordinary setting anybody can change. Rule 1 (Mike, 2026-09-11) - listed for him.

// ---------------------------------------------------------------------------------------
// SOURCES
// ---------------------------------------------------------------------------------------
const TK = '[training knowledge] - not verified against the published text from inside this repo';

export const SOURCES = Object.freeze({
  'wcag-2.3.1': { kind: 'published', provenance: TK,
    name: 'WCAG 2.x success criterion 2.3.1, Three Flashes or Below Threshold (Level A)',
    says: 'Nothing flashes more than three times in any one second, unless the flash is below the general and red flash thresholds.' },
  'wcag-2.3.2': { kind: 'published', provenance: TK,
    name: 'WCAG 2.x success criterion 2.3.2, Three Flashes (Level AAA)',
    says: 'Nothing flashes more than three times in any one second - no threshold exception.' },
  'wcag-1.4.1': { kind: 'published', provenance: TK,
    name: 'WCAG 2.x success criterion 1.4.1, Use of Color (Level A)',
    says: 'Colour is not the only visual means of conveying information.' },
  'wcag-2.3.3': { kind: 'published', provenance: TK,
    name: 'WCAG 2.1 success criterion 2.3.3, Animation from Interactions (Level AAA)',
    says: 'Motion animation triggered by interaction can be turned off (written for vestibular disorders).' },
  'mq5-reduced-motion': { kind: 'published', provenance: TK,
    name: 'CSS Media Queries Level 5, prefers-reduced-motion',
    says: 'A person can ask the system to minimise non-essential motion.' },
  'wcag-1.4.6': { kind: 'published', provenance: TK,
    name: 'WCAG 2.x success criterion 1.4.6, Contrast (Enhanced) (Level AAA)',
    says: 'Text has a contrast ratio of at least 7:1 (4.5:1 for large text).' },
  'wcag-2.5.5': { kind: 'published', provenance: TK,
    name: 'WCAG 2.1 success criterion 2.5.5, Target Size (Enhanced) (Level AAA)',
    says: 'Pointer targets are at least 44 by 44 CSS pixels.' },
  'wcag-1.2.4': { kind: 'published', provenance: TK,
    name: 'WCAG 2.x success criterion 1.2.4, Captions (Live) (Level AA)',
    says: 'Live audio has captions.' },
  // Not a clinical source - the product's own control, named so the level is not mistaken for one.
  'mike-2.48': { kind: 'product', provenance: 'MIKE_CHANGE_LIST.md row 2.48 (Mike, 2026-09-30)',
    name: 'Mike\'s ruling: a difficulty-style level',
    says: 'The level is the settings menu\'s own "How much this menu shows" (complexity).' },
});

// ---------------------------------------------------------------------------------------
// THE LEVEL - the menu's own complexity levels (settings_fields.js LEVELS), plus "leave it".
// ---------------------------------------------------------------------------------------
export const LEVEL_OPTIONS = Object.freeze([
  { value: '', label: 'Leave it as it is' },
  { value: 'essential', label: 'Simpler - just the essentials' },
  { value: 'standard', label: 'The usual' },
  { value: 'advanced', label: 'Everything' },
]);

// ---------------------------------------------------------------------------------------
// THE BOXES. Labelled by what they are ABOUT, in plain words, with the familiar name beside it
// (`aka`) so nobody has to translate. `sets` is what a published box fills in; `combine` is how
// two boxes setting the same key agree (the stricter one wins).
// ---------------------------------------------------------------------------------------
const published = (id, label, aka, sets) => ({ id, label, aka, status: 'published', sets });
const toBeFilled = (id, label, aka) => ({ id, label, aka, status: 'to-be-filled', sets: [] });

export const CONDITIONS = Object.freeze([
  published('photosensitive', 'Flashing can cause seizures', 'photosensitive epilepsy', [
    { key: 'flashLimitPerSecond', value: 3, combine: 'min', sources: ['wcag-2.3.1', 'wcag-2.3.2'] },
  ]),
  published('colourVision', 'Some colours are hard to tell apart', 'colour blindness', [
    { key: 'colourNotAlone', value: true, combine: 'or', sources: ['wcag-1.4.1'] },
  ]),
  // Reduced motion is on ITS OWN box, not the epilepsy one. The published source for reduced
  // motion (2.3.3) is written for vestibular disorders; the epilepsy source (2.3.1) is about
  // flashes. Putting reduced motion under epilepsy would be a clinical claim nobody sourced.
  published('motion', 'Movement on screen makes me unwell', 'motion sensitivity, vestibular', [
    { key: 'reduceMotion', value: true, combine: 'or', sources: ['wcag-2.3.3', 'mq5-reduced-motion'] },
  ]),
  published('lowVision', 'Small or faint things are hard to see', 'low vision', [
    { key: 'theme', value: 'contrast', combine: 'first', sources: ['wcag-1.4.6'] },
  ]),
  published('tremor', 'Hands shake or are hard to aim', 'tremor, limited dexterity', [
    { key: 'minTargetPx', value: 44, combine: 'max', sources: ['wcag-2.5.5'] },
  ]),
  published('hearing', 'Speech is hard to hear', 'hard of hearing, deaf', [
    { key: 'subtitlesOn', value: true, combine: 'or', sources: ['wcag-1.2.4'] },
  ]),
  // TO BE FILLED - Mike's named list and its "etc.". Ticking one records it; it sets nothing.
  // Deliberately NOT inferred from the published boxes (e.g. Parkinson's does not tick "hands
  // shake"): that inference is exactly the unsourced clinical claim this file refuses to make.
  toBeFilled('stroke', 'Stroke', 'stroke'),
  toBeFilled('tbi', 'Brain injury', 'TBI, traumatic brain injury'),
  toBeFilled('parkinsons', 'Parkinson\'s', 'Parkinson\'s disease'),
  toBeFilled('autism', 'Autism', 'autism'),
  toBeFilled('dementia', 'Memory loss', 'dementia'),
  toBeFilled('aphasia', 'Finding or understanding words is hard', 'aphasia'),
  toBeFilled('dyslexia', 'Reading is hard', 'dyslexia'),
]);
const CONDITION_BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------------------
// AGE. A BAND, not a number: it is less identifying, and a band is a choice a switch can cycle
// where a typed number needs a keyboard. ALL BANDS SET NOTHING YET - no published per-age
// defaults for a screen like this were found. The edges (13, 18, 65) are placeholders that
// change nothing today; they are on Mike's list to confirm before any band sets anything.
// ---------------------------------------------------------------------------------------
export const AGE_BANDS = Object.freeze([
  { value: '', label: 'Not saying', sets: [] },
  { value: 'child', label: 'Under 13', sets: [] },
  { value: 'teen', label: '13 to 17', sets: [] },
  { value: 'adult', label: '18 to 64', sets: [] },
  { value: 'older', label: '65 and over', sets: [] },
]);

// ---------------------------------------------------------------------------------------
// PLAIN WORDS for every key a box or the level can set - the preview is written from these.
// ---------------------------------------------------------------------------------------
const COMPLEXITY_WORDS = { essential: 'Just the essentials', standard: 'The usual', advanced: 'Everything' };
// theme.js's own labels for the themes a box can pick. Kept here (not imported) so this pure
// file does not pull theme.js's scene code in; the suite checks it still matches theme.js.
const THEME_WORDS = { contrast: 'High contrast' };

export const SETTING_WORDS = Object.freeze({
  complexity: { label: 'How much the menu shows', say: (v) => COMPLEXITY_WORDS[v] || String(v) },
  theme: { label: 'Colours', say: (v) => THEME_WORDS[v] || String(v) },
  flashLimitPerSecond: { label: 'Flashing', say: (v) => `no more than ${v} flashes a second` },
  colourNotAlone: { label: 'Colour', say: (v) => (v ? 'never colour alone - a shape or a word as well' : 'colour may be used alone') },
  reduceMotion: { label: 'Movement', say: (v) => (v ? 'keep movement to a minimum' : 'normal movement') },
  minTargetPx: { label: 'Buttons', say: (v) => `at least ${v} pixels across` },
  subtitlesOn: { label: 'Subtitles', say: (v) => (v ? 'on - write what is said on the screen' : 'off') },
});
const sayValue = (key, v) => (v === undefined ? 'the usual' : (SETTING_WORDS[key]?.say(v) ?? String(v)));
const labelOf = (key) => SETTING_WORDS[key]?.label || key;

// ---------------------------------------------------------------------------------------
// PURE
// ---------------------------------------------------------------------------------------
const LEVEL_VALUES = new Set(LEVEL_OPTIONS.map((o) => o.value));
const AGE_VALUES = new Set(AGE_BANDS.map((b) => b.value));

/** Answers in, clean answers out. Unknown values read as "not given"; unknown boxes are dropped. */
export function normalizeAnswers(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const level = LEVEL_VALUES.has(r.level) ? r.level : '';
  const age = AGE_VALUES.has(r.age) ? r.age : '';
  const conditions = [];
  for (const id of Array.isArray(r.conditions) ? r.conditions : []) {
    if (typeof id === 'string' && CONDITION_BY_ID.has(id) && !conditions.includes(id)) conditions.push(id);
  }
  return { level, conditions, age };
}

/** How two boxes that set the same key agree. The stricter one wins; `first` keeps the first. */
export function combineValues(how, a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (how === 'min') return Math.min(a, b);
  if (how === 'max') return Math.max(a, b);
  if (how === 'or') return !!(a || b);
  return a;
}

const sourceRef = (id) => ({ id, ...SOURCES[id] });

/**
 * defaultsFor({ level, conditions, age }) -> { answers, entries, layer, unfilled }
 *   entries  - [{ key, value, from: [box ids], sources: [{ id, name, says, provenance }] }]
 *   layer    - { key: value } - the default values, to sit UNDER the settings
 *   unfilled - the boxes (and age band) that were asked but have nothing to set yet
 */
export function defaultsFor(raw) {
  const answers = normalizeAnswers(raw);
  const byKey = new Map();
  const add = (key, value, from, sourceIds, combine) => {
    const had = byKey.get(key);
    if (!had) { byKey.set(key, { key, value, from: [from], sourceIds: [...sourceIds], combine }); return; }
    had.value = combineValues(had.combine, had.value, value);
    had.from.push(from);
    for (const s of sourceIds) if (!had.sourceIds.includes(s)) had.sourceIds.push(s);
  };
  if (answers.level) add('complexity', answers.level, 'level', ['mike-2.48'], 'first');
  const unfilled = [];
  for (const id of answers.conditions) {
    const c = CONDITION_BY_ID.get(id);
    if (c.status !== 'published') { unfilled.push({ id: c.id, label: c.label, aka: c.aka }); continue; }
    for (const s of c.sets) add(s.key, s.value, c.id, s.sources, s.combine);
  }
  if (answers.age) {
    const band = AGE_BANDS.find((b) => b.value === answers.age);
    if (!band.sets.length) unfilled.push({ id: `age:${band.value}`, label: `Age ${band.label}`, aka: 'age band' });
  }
  const entries = [...byKey.values()].map(({ key, value, from, sourceIds }) => ({
    key, value, from, sources: sourceIds.map(sourceRef),
  }));
  const layer = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  return { answers, entries, layer, unfilled };
}

/** Present = chosen. An own key whose value is not undefined/null; '' counts (somebody cleared it). */
export function isChosen(values, key) {
  return !!values && typeof values === 'object'
    && Object.prototype.hasOwnProperty.call(values, key)
    && values[key] !== undefined && values[key] !== null;
}

/** Settings as the host should READ them: its own values, with the layer filling only the gaps. */
export function withStartingDefaults(values, layer) {
  const out = { ...(values && typeof values === 'object' ? values : {}) };
  for (const [k, v] of Object.entries(layer || {})) if (!isChosen(values, k)) out[k] = v;
  return out;
}

/**
 * What applying `next` (a defaultsFor result) would do, against the host's CURRENT settings and
 * the layer already on this device. Nothing is changed by calling this.
 *   changes   - [{ key, before, after, entry }]  (after === undefined: back to the usual)
 *   kept      - [{ key, current, would }]        a value somebody chose; left alone
 *   unchanged - keys the new answers leave exactly as they are
 */
export function planChanges({ current = {}, oldLayer = {}, next } = {}) {
  const n = next || defaultsFor({});
  const keys = [...new Set([...Object.keys(n.layer), ...Object.keys(oldLayer || {})])];
  const changes = []; const kept = []; const unchanged = [];
  for (const key of keys) {
    const after = n.layer[key];
    if (isChosen(current, key)) { if (after !== undefined) kept.push({ key, current: current[key], would: after }); continue; }
    const before = (oldLayer || {})[key];
    if (before === after) { unchanged.push(key); continue; }
    changes.push({ key, before, after, entry: n.entries.find((e) => e.key === key) || null });
  }
  return { changes, kept, unchanged, unfilled: n.unfilled, answers: n.answers };
}

const boxName = (id) => (id === 'level' ? 'the level you picked' : (CONDITION_BY_ID.get(id)?.label || id));

/** The plan as plain sentences, for the preview. */
export function describePlan(plan) {
  const lines = [];
  for (const c of plan.changes) {
    if (c.after === undefined) {
      lines.push(`${labelOf(c.key)}: back to the usual (no box asks for "${sayValue(c.key, c.before)}" any more).`);
      continue;
    }
    const why = c.entry ? c.entry.from.map(boxName).join(', ') : '';
    const src = c.entry ? c.entry.sources.map((s) => s.name).join('; ') : '';
    lines.push(`${labelOf(c.key)}: ${sayValue(c.key, c.after)}${why ? ` - because: ${why}` : ''}${src ? ` (source: ${src})` : ''}.`);
  }
  for (const k of plan.kept) {
    lines.push(`${labelOf(k.key)}: you already chose "${sayValue(k.key, k.current)}", so it is left alone.`);
  }
  for (const u of plan.unfilled || []) {
    lines.push(`${u.label}: noted, but its starting settings are not filled in yet - nothing changes for it.`);
  }
  if (!plan.changes.length && !plan.kept.length) lines.unshift('Nothing would change.');
  return lines;
}

// ---------------------------------------------------------------------------------------
// ON THE DEVICE - the default home for all of this.
// ---------------------------------------------------------------------------------------
export const DEVICE_KEY = 'nimrod.startingDefaults';
export const DEVICE_NOTE = 'Kept on this device only. It will not follow this person to another screen, '
  + 'and clearing this browser\'s data erases it.';
export const ONLINE_WARNING = 'This puts it online, in the account. We don\'t intend to use it, '
  + 'but no one can guarantee the security of anything.';

const emptyRecord = () => ({ v: 1, where: 'device', answers: normalizeAnswers({}), layer: {}, why: {}, appliedAt: 0, previous: [] });

function normalizeRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const layer = r.layer && typeof r.layer === 'object' ? { ...r.layer } : {};
  return {
    v: 1,
    where: 'device',
    answers: normalizeAnswers(r.answers),
    layer,
    why: r.why && typeof r.why === 'object' ? r.why : {},
    appliedAt: Number(r.appliedAt) || 0,
    // What each apply replaced, newest last, so "put back" can step back through them.
    previous: Array.isArray(r.previous) ? r.previous.filter((p) => p && typeof p === 'object').slice(-10) : [],
    ...(r.savedOnlineAt ? { savedOnlineAt: Number(r.savedOnlineAt) || 0 } : {}),
  };
}

// How many "put back" steps a device keeps. A default, not a law: ten applies back is far more
// than anyone will walk, and bounding it keeps a storage record from growing forever.
const MAX_PUT_BACK = 10;

/**
 * The device-local record: { answers, layer, why, previous }. `storage` is the localStorage
 * shape; a browser that refuses storage still works for this page and reports `persisted: false`.
 */
export function createDeviceStore({
  storage = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })(),
  key = DEVICE_KEY,
} = {}) {
  let persisted = !!storage;
  let record = emptyRecord();
  try {
    const raw = storage ? storage.getItem(key) : null;
    if (raw) record = normalizeRecord(JSON.parse(raw));
  } catch { if (storage) { try { storage.getItem(key); } catch { persisted = false; } } }

  function write() {
    if (!storage) { persisted = false; return false; }
    try { storage.setItem(key, JSON.stringify(record)); persisted = true; return true; } catch { persisted = false; return false; }
  }

  const api = {
    get persisted() { return persisted; },
    get: () => normalizeRecord(record),
    layer: () => ({ ...record.layer }),
    canPutBack: () => record.previous.length > 0,
    /** Put a defaultsFor() result on this device. Nothing leaves the device. */
    apply(result) {
      const why = {};
      for (const e of result.entries || []) why[e.key] = { from: e.from.slice(), sources: e.sources.map((s) => s.id) };
      record = {
        ...record,
        previous: [...record.previous, { answers: record.answers, layer: record.layer, why: record.why }].slice(-MAX_PUT_BACK),
        answers: normalizeAnswers(result.answers),
        layer: { ...(result.layer || {}) },
        why,
        appliedAt: Date.now(),
      };
      write();
      return api.get();
    },
    /** Undo the last apply. False when there is nothing to undo. */
    putBack() {
      if (!record.previous.length) return false;
      const prev = record.previous[record.previous.length - 1];
      record = { ...record, previous: record.previous.slice(0, -1),
        answers: normalizeAnswers(prev.answers), layer: { ...(prev.layer || {}) }, why: prev.why || {}, appliedAt: Date.now() };
      write();
      return true;
    },
    /** Clear what was ticked from this device; the settings stay. */
    forgetAnswers() {
      record = { ...record, answers: normalizeAnswers({}),
        previous: record.previous.map((p) => ({ ...p, answers: normalizeAnswers({}) })) };
      write();
    },
    markSavedOnline(at = Date.now()) { record = { ...record, savedOnlineAt: at }; write(); },
    clear() {
      record = emptyRecord();
      try { storage?.removeItem(key); } catch { persisted = false; }
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------
// ONLINE - only by explicit choice, only after the warning.
//
// The destination is the person's presets library (presets.js, register #255): a preset of its own
// type holding the layer. That is per-person account state, which is exactly the "it follows the
// person to other screens" that device-only does not give.
// ---------------------------------------------------------------------------------------
export const STARTING_DEFAULTS_PRESET_TYPE = 'startingDefaults';

/** What goes online. The settings by default; the ticked boxes only when that is chosen too. */
export function onlinePayload(record, { includeAnswers = false } = {}) {
  const r = normalizeRecord(record);
  return includeAnswers ? { layer: r.layer, answers: r.answers } : { layer: r.layer };
}

/**
 * Save to the account. REFUSES unless `acknowledged === true` - the host shows ONLINE_WARNING
 * and only passes true once somebody has said yes to it. Updates the one existing
 * startingDefaults preset rather than piling up copies.
 */
export async function saveOnline({ record, library, acknowledged = false, includeAnswers = false,
  name = 'Starting settings' } = {}) {
  if (acknowledged !== true) throw new Error('saveOnline: the online warning has not been acknowledged');
  if (!library || typeof library.savePreset !== 'function') throw new Error('saveOnline: nowhere online to save');
  const existing = (library.listPresets?.(STARTING_DEFAULTS_PRESET_TYPE) || [])[0];
  return library.savePreset({
    id: existing ? existing.id : null,
    type: STARTING_DEFAULTS_PRESET_TYPE,
    name,
    settings: onlinePayload(record, { includeAnswers }),
  });
}

/** A saved-online preset back into { answers, layer } another device can apply. */
export function recordFromOnline(preset) {
  const s = preset?.settings || {};
  return { answers: normalizeAnswers(s.answers), layer: s.layer && typeof s.layer === 'object' ? { ...s.layer } : {} };
}
