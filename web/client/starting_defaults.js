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
//
// FILLED FROM THE ACCESSIBILITY RESEARCH (2026-10-01; its Table 2, private repo
// `docs/from_chat/accessibility_research_20261001.md`). Only a shift that names an existing setting AND
// carries a value is applied: a number from a number source, or on/off from a rule. A "direction only"
// row (TBI brightness, Parkinson's hold time, autism colours...) has no value to set, so its box stays
// "to be filled" and the row is kept in `awaiting` for the day a setting and a number exist. Every
// source a default rests on was re-read at its published URL on 2026-10-01 before it became one (the
// research's own fetcher was unreliable); `provenance` says so per source.
//   * SPOT-CHECK THAT CHANGED A DEFAULT: the research cites W3C COGA for "content does not move unless
//     the user causes it" with a TBI example, which would have ticked `reduceMotion` for brain injury.
//     The published pattern (COGA 4.5.1) says controls and content do not move UNEXPECTEDLY while in
//     use - layout stability, which this product already keeps by construction - not "minimise
//     decorative motion". So the brain-injury box does NOT set reduceMotion; it is in `awaiting`.
//
// THE NUMBERS HERE (3 flashes a second, 44 px) ARE THE STANDARDS' OWN NUMBERS, used as DEFAULTS.
// Each one is an ordinary setting anybody can change. Rule 1 (Mike, 2026-09-11) - listed for him.
//
// ---------------------------------------------------------------------------------------
// *** TWO BOXES THAT WANT DIFFERENT VALUES FOR ONE SETTING: ASK, THEN LOG THE ANSWER. ***
// Mike, 2026-10-01 (note AR): "Preset conflicts: ask the person ticking the boxes, then log the answer."
// `defaultsFor` reports each such setting in `conflicts`, with every box's value and a SUGGESTED one
// (the stricter, by the box's own `combine`). The panel asks; the answer goes in `answers.resolved`
// (so reopening the picker shows it) and into the device record's `log` when it is applied.
//   WHAT HAPPENS IF NOBODY ANSWERS? Nothing is applied - "Use these" waits until every conflict has an
//   answer. Inaction, not a blocked screen: the picker is a caregiver's tool, the screen it sets keeps
//   running exactly as it was, and everything else on the picker still works.
//   WHERE THE LOG LIVES, argued: on the DEVICE, in the same record as the boxes. FOR the account
//   instead: a family would see who chose what. AGAINST, and it wins for the default: the answer names
//   the boxes, which are health data (the same reason the boxes stay on the device), and it goes online
//   with them when somebody ticks "also save which boxes were ticked". Bounded to the last 50.
// No pair of today's boxes conflicts (each setting has one box, or boxes that agree); the mechanism is
// built and tested now so the first conflicting row added to the table asks instead of guessing.

// ---------------------------------------------------------------------------------------
// SOURCES
// ---------------------------------------------------------------------------------------
const TK = '[training knowledge] - not verified against the published text from inside this repo';
const CHECKED = (url) => `checked against the published text at ${url} on 2026-10-01`;
const WCAG22 = 'https://www.w3.org/TR/WCAG22/';
const RESEARCH = 'accessibility research 2026-10-01 (private repo), not re-checked';

export const SOURCES = Object.freeze({
  'wcag-2.3.1': { kind: 'published', provenance: CHECKED(WCAG22),
    name: 'WCAG 2.2 success criterion 2.3.1, Three Flashes or Below Threshold (Level A)',
    says: 'Nothing flashes more than three times in any one second, unless the flash is below the general and red flash thresholds.' },
  'wcag-2.3.2': { kind: 'published', provenance: CHECKED(WCAG22),
    name: 'WCAG 2.2 success criterion 2.3.2, Three Flashes (Level AAA)',
    says: 'Nothing flashes more than three times in any one second - no threshold exception.' },
  'wcag-1.4.1': { kind: 'published', provenance: CHECKED(WCAG22),
    name: 'WCAG 2.2 success criterion 1.4.1, Use of Color (Level A)',
    says: 'Colour is not the only visual means of conveying information.' },
  'wcag-1.2.2': { kind: 'published', provenance: CHECKED(WCAG22),
    name: 'WCAG 2.2 success criterion 1.2.2, Captions (Prerecorded) (Level A)',
    says: 'Recorded audio in a video has captions.' },
  'gov-uk-2016': { kind: 'published', provenance: CHECKED('https://accessibility.blog.gov.uk/2016/09/02/dos-and-donts-on-designing-for-accessibility/'),
    name: 'GOV.UK accessibility posters, "Dos and don\'ts on designing for accessibility" (2016)',
    says: 'Deaf or hard of hearing: use subtitles or transcripts for video. Low vision: use a combination of colour, shapes and text.' },
  'webkit-motion-2017': { kind: 'published', provenance: CHECKED('https://webkit.org/blog/7551/responsive-design-for-motion/'),
    name: 'WebKit, "Responsive Design for Motion" (2017)',
    says: 'Scaling, spinning, parallax, plane-shifting and peripheral motion are common vestibular triggers; reduced motion should remove or simplify them.' },
  'coga-4.5.1': { kind: 'published', provenance: CHECKED('https://www.w3.org/TR/coga-usable/'),
    name: 'W3C COGA, "Making Content Usable" (Working Group Note, 2021), pattern 4.5.1',
    says: 'Controls and content do not move unexpectedly as the user is using them (a TBI persona is linked).' },
  'efa-2005': { kind: 'published', provenance: RESEARCH,
    name: 'Epilepsy Foundation of America consensus (Harding et al., Epilepsia 2005)',
    says: 'Avoid transitions to or from saturated red; limit high-contrast stripe patterns.' },
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
  'wcag-1.2.4': { kind: 'published', provenance: CHECKED(WCAG22),
    name: 'WCAG 2.2 success criterion 1.2.4, Captions (Live) (Level AA)',
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
// `awaiting`: what the research found published support for, but that no setting carries yet (or
// that is a direction with no value). Recorded, never applied - a list for whoever adds the setting.
const published = (id, label, aka, sets, awaiting = []) => ({ id, label, aka, status: 'published', sets, awaiting });
const toBeFilled = (id, label, aka, awaiting = []) => ({ id, label, aka, status: 'to-be-filled', sets: [], awaiting });
const RESEARCH_T2 = 'accessibility research 2026-10-01, Table 2';

export const CONDITIONS = Object.freeze([
  // 3 a second AT ANY SIZE - WCAG 2.3.2's form, the research decision's default (note AR: "the default
  // is 2.3.2"). The looser published form, 2.3.1, and "no limit" are one setting away (flash_limit.js).
  published('photosensitive', 'Flashing can cause seizures', 'photosensitive epilepsy', [
    { key: 'flashLimitPerSecond', value: 3, combine: 'min', sources: ['wcag-2.3.2'] },
  ], [
    { what: 'No transitions to or from saturated red', sources: ['wcag-2.3.1', 'efa-2005'], from: RESEARCH_T2 },
    { what: 'No high-contrast stripe patterns (at most 5 light-dark pairs moving, 8 still)', sources: ['efa-2005'], from: RESEARCH_T2 },
  ]),
  published('colourVision', 'Some colours are hard to tell apart', 'colour blindness', [
    { key: 'colourNotAlone', value: true, combine: 'or', sources: ['wcag-1.4.1', 'gov-uk-2016'] },
  ], [
    { what: 'A colour-blind-tested palette (no published palette found)', sources: [], from: RESEARCH_T2 },
  ]),
  // Reduced motion is on ITS OWN box, not the epilepsy one. The published sources for reduced
  // motion are written for vestibular disorders; the epilepsy sources are about flashes. Putting
  // reduced motion under epilepsy would be a clinical claim nobody sourced.
  published('motion', 'Movement on screen makes me unwell', 'motion sensitivity, vestibular', [
    { key: 'reduceMotion', value: true, combine: 'or', sources: ['wcag-2.3.3', 'mq5-reduced-motion', 'webkit-motion-2017'] },
  ]),
  published('lowVision', 'Small or faint things are hard to see', 'low vision', [
    { key: 'theme', value: 'contrast', combine: 'first', sources: ['wcag-1.4.6'] },
  ]),
  published('tremor', 'Hands shake or are hard to aim', 'tremor, limited dexterity', [
    { key: 'minTargetPx', value: 44, combine: 'max', sources: ['wcag-2.5.5'] },
  ]),
  published('hearing', 'Speech is hard to hear', 'hard of hearing, deaf', [
    { key: 'subtitlesOn', value: true, combine: 'or', sources: ['wcag-1.2.2', 'wcag-1.2.4', 'gov-uk-2016'] },
  ], [
    { what: 'A visual alert alongside every sound alert', sources: ['gov-uk-2016'], from: RESEARCH_T2 },
  ]),
  // TO BE FILLED - Mike's named list and its "etc.". Ticking one records it; it sets nothing.
  // Deliberately NOT inferred from the published boxes (e.g. Parkinson's does not tick "hands
  // shake"): that inference is exactly the unsourced clinical claim this file refuses to make.
  toBeFilled('stroke', 'Stroke', 'stroke', [
    { what: 'Layout for a visual field loss or neglect (no published value; a case report only)', sources: [], from: RESEARCH_T2 },
  ]),
  toBeFilled('tbi', 'Brain injury', 'TBI, traumatic brain injury', [
    { what: 'A dimmer or dark theme available (light sensitivity is common; no published value)', sources: [], from: RESEARCH_T2 },
    { what: 'Controls and content do not move unexpectedly while in use (kept by construction)', sources: ['coga-4.5.1'], from: RESEARCH_T2 },
  ]),
  toBeFilled('parkinsons', 'Parkinson\'s', 'Parkinson\'s disease', [
    { what: 'Hold-to-press and ignore repeated presses (direction only, no number published)', sources: [], from: RESEARCH_T2 },
    { what: 'Large targets, no short timeouts (direction only)', sources: ['gov-uk-2016'], from: RESEARCH_T2 },
  ]),
  toBeFilled('autism', 'Autism', 'autism', [
    { what: 'Simple colours (direction only; conflicts with the low-vision advice for bright contrast)', sources: ['gov-uk-2016'], from: RESEARCH_T2 },
  ]),
  toBeFilled('dementia', 'Memory loss', 'dementia'),
  toBeFilled('aphasia', 'Finding or understanding words is hard', 'aphasia', [
    { what: 'Symbols alongside words, plain language (direction only)', sources: [], from: RESEARCH_T2 },
  ]),
  toBeFilled('dyslexia', 'Reading is hard', 'dyslexia', [
    { what: 'NO "dyslexia font" by default - the studies found no benefit', sources: [], from: RESEARCH_T2 },
    { what: 'Extra letter spacing with extra word spacing (direction only)', sources: [], from: RESEARCH_T2 },
  ]),
]);
const byId = (list) => new Map(list.map((c) => [c.id, c]));
const CONDITION_BY_ID = byId(CONDITIONS);
const conditionMap = (list) => (list === CONDITIONS || !Array.isArray(list) ? CONDITION_BY_ID : byId(list));

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
  theme: { label: 'Theme', say: (v) => THEME_WORDS[v] || String(v) },   // (themes, 2026-10-06: was "Colours")
  // flash_limit.js's stored forms: a number, 'none', or 'wcag-2.3.1'. (Spelt here, not imported:
  // flash_limit.js imports this file, and a pure table should not need a cycle.)
  flashLimitPerSecond: { label: 'Flashing', say: (v) => {
    if (v === 'none' || v === Infinity) return 'no limit';
    if (v === 'wcag-2.3.1') return 'no more than 3 flashes a second, except small or faint ones';
    return Number(v) === 3 ? 'no more than 3 flashes a second, at any size' : `no more than ${v} flashes a second`;
  } },
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

const isPlain = (v) => ['string', 'number', 'boolean'].includes(typeof v);

/**
 * Answers in, clean answers out. Unknown values read as "not given"; unknown boxes are dropped.
 * `resolved` is { key: value } - the answer to each conflict the person was asked about.
 * `conditions` (option) is the box list to check against; the suites pass their own.
 */
export function normalizeAnswers(raw, { conditions: list = CONDITIONS } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const known = conditionMap(list);
  const level = LEVEL_VALUES.has(r.level) ? r.level : '';
  const age = AGE_VALUES.has(r.age) ? r.age : '';
  const conditions = [];
  for (const id of Array.isArray(r.conditions) ? r.conditions : []) {
    if (typeof id === 'string' && known.has(id) && !conditions.includes(id)) conditions.push(id);
  }
  const resolved = {};
  if (r.resolved && typeof r.resolved === 'object') {
    for (const [k, v] of Object.entries(r.resolved)) if (isPlain(v)) resolved[k] = v;
  }
  return { level, conditions, age, resolved };
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
 * defaultsFor({ level, conditions, age, resolved }) -> { answers, entries, layer, unfilled, conflicts }
 *   entries   - [{ key, value, from: [box ids], sources: [{ id, name, says, provenance }] }]
 *   layer     - { key: value } - the default values, to sit UNDER the settings
 *   unfilled  - the boxes (and age band) that were asked but have nothing to set yet
 *   conflicts - [{ key, wants: [{ from, value }], suggested, answer }] - two or more boxes asking
 *               DIFFERENT values for one setting. `answer` is the person's (from `resolved`), or
 *               undefined while unasked; the layer carries the answer, or the suggestion meanwhile.
 *               Nothing may be applied while any conflict has no answer (`unanswered`).
 */
export function defaultsFor(raw, { conditions: list = CONDITIONS } = {}) {
  const answers = normalizeAnswers(raw, { conditions: list });
  const known = conditionMap(list);
  const byKey = new Map();
  const add = (key, value, from, sourceIds, combine) => {
    const had = byKey.get(key);
    if (!had) { byKey.set(key, { key, value, from: [from], wants: [{ from, value }], sourceIds: [...sourceIds], combine }); return; }
    had.value = combineValues(had.combine, had.value, value);
    had.from.push(from);
    had.wants.push({ from, value });
    for (const s of sourceIds) if (!had.sourceIds.includes(s)) had.sourceIds.push(s);
  };
  if (answers.level) add('complexity', answers.level, 'level', ['mike-2.48'], 'first');
  const unfilled = [];
  for (const id of answers.conditions) {
    const c = known.get(id);
    if (c.status !== 'published') { unfilled.push({ id: c.id, label: c.label, aka: c.aka }); continue; }
    for (const s of c.sets) add(s.key, s.value, c.id, s.sources, s.combine);
  }
  if (answers.age) {
    const band = AGE_BANDS.find((b) => b.value === answers.age);
    if (!band.sets.length) unfilled.push({ id: `age:${band.value}`, label: `Age ${band.label}`, aka: 'age band' });
  }
  const conflicts = [];
  for (const e of byKey.values()) {
    const distinct = [...new Set(e.wants.map((w) => w.value))];
    if (distinct.length < 2) continue;
    // An answer counts only while it is still one of the values on offer: change the boxes so that
    // value is no longer asked for, and the question is asked again rather than answered stale.
    const has = Object.prototype.hasOwnProperty.call(answers.resolved, e.key);
    const answer = has && distinct.includes(answers.resolved[e.key]) ? answers.resolved[e.key] : undefined;
    const wants = e.wants.map((w) => ({ ...w,
      label: w.from === 'level' ? 'the level you picked' : (known.get(w.from)?.label || w.from) }));
    conflicts.push({ key: e.key, wants, suggested: e.value, answer });
    if (answer !== undefined) e.value = answer;
  }
  const entries = [...byKey.values()].map(({ key, value, from, sourceIds }) => ({
    key, value, from, sources: sourceIds.map(sourceRef),
  }));
  const layer = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  return { answers, entries, layer, unfilled, conflicts, unanswered: conflicts.filter((c) => c.answer === undefined) };
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
  return { changes, kept, unchanged, unfilled: n.unfilled, answers: n.answers, conflicts: n.conflicts || [] };
}

/** One conflict as a question, in plain words: { key, question, choices: [{ value, label, suggested }] }. */
export function conflictQuestion(c) {
  const byValue = new Map();
  for (const w of c.wants) {
    const k = JSON.stringify(w.value);
    if (!byValue.has(k)) byValue.set(k, { value: w.value, boxes: [] });
    byValue.get(k).boxes.push(w.label || w.from);
  }
  return {
    key: c.key,
    question: `${labelOf(c.key)}: the boxes you ticked ask for different things. Which should it be?`,
    choices: [...byValue.values()].map((o) => ({
      value: o.value,
      label: `${sayValue(c.key, o.value)} (${o.boxes.join(', ')})${o.value === c.suggested ? ' - the stricter one' : ''}`,
      suggested: o.value === c.suggested,
      chosen: c.answer !== undefined && o.value === c.answer,
    })),
  };
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
  for (const c of plan.conflicts || []) {
    if (c.answer === undefined) lines.push(`${labelOf(c.key)}: the boxes ask for different things - please choose below before using these.`);
    else lines.push(`${labelOf(c.key)}: the boxes asked for different things; you chose "${sayValue(c.key, c.answer)}".`);
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

// How many conflict answers the log keeps (newest last). Bounded so a storage record cannot grow forever.
export const MAX_CONFLICT_LOG = 50;

const emptyRecord = (opts) => ({ v: 1, where: 'device', answers: normalizeAnswers({}, opts), layer: {}, why: {}, appliedAt: 0, previous: [], log: [] });

const normalizeLogEntry = (e) => (e && typeof e === 'object' && typeof e.key === 'string' && isPlain(e.chose)
  ? { at: Number(e.at) || 0, key: e.key, chose: e.chose,
    wants: Array.isArray(e.wants) ? e.wants.filter((w) => w && typeof w === 'object' && isPlain(w.value))
      .map((w) => ({ from: String(w.from), value: w.value })) : [] }
  : null);

function normalizeRecord(raw, opts) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const layer = r.layer && typeof r.layer === 'object' ? { ...r.layer } : {};
  return {
    v: 1,
    where: 'device',
    answers: normalizeAnswers(r.answers, opts),
    layer,
    why: r.why && typeof r.why === 'object' ? r.why : {},
    appliedAt: Number(r.appliedAt) || 0,
    // What each apply replaced, newest last, so "put back" can step back through them.
    previous: Array.isArray(r.previous) ? r.previous.filter((p) => p && typeof p === 'object').slice(-10) : [],
    // Every conflict answer that was applied: { at, key, wants: [{ from, value }], chose }.
    log: Array.isArray(r.log) ? r.log.map(normalizeLogEntry).filter(Boolean).slice(-MAX_CONFLICT_LOG) : [],
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
  conditions = CONDITIONS,
  now = () => Date.now(),
} = {}) {
  const opts = { conditions };
  let persisted = !!storage;
  let record = emptyRecord(opts);
  try {
    const raw = storage ? storage.getItem(key) : null;
    if (raw) record = normalizeRecord(JSON.parse(raw), opts);
  } catch { if (storage) { try { storage.getItem(key); } catch { persisted = false; } } }

  function write() {
    if (!storage) { persisted = false; return false; }
    try { storage.setItem(key, JSON.stringify(record)); persisted = true; return true; } catch { persisted = false; return false; }
  }

  const api = {
    get persisted() { return persisted; },
    get: () => normalizeRecord(record, opts),
    layer: () => ({ ...record.layer }),
    log: () => record.log.map((e) => ({ ...e, wants: e.wants.map((w) => ({ ...w })) })),
    canPutBack: () => record.previous.length > 0,
    /**
     * Put a defaultsFor() result on this device. Nothing leaves the device. REFUSES (throws) while a
     * conflict has no answer - the panel asks first. Each answered conflict is appended to the log.
     */
    apply(result) {
      if ((result.unanswered || []).length) {
        throw new Error(`starting defaults: answer the conflict on ${result.unanswered.map((c) => c.key).join(', ')} first`);
      }
      const why = {};
      for (const e of result.entries || []) why[e.key] = { from: e.from.slice(), sources: e.sources.map((s) => s.id) };
      const at = now();
      const logged = (result.conflicts || []).filter((c) => c.answer !== undefined)
        .map((c) => normalizeLogEntry({ at, key: c.key, wants: c.wants, chose: c.answer })).filter(Boolean);
      record = {
        ...record,
        previous: [...record.previous, { answers: record.answers, layer: record.layer, why: record.why }].slice(-MAX_PUT_BACK),
        answers: normalizeAnswers(result.answers, opts),
        layer: { ...(result.layer || {}) },
        why,
        appliedAt: at,
        log: [...record.log, ...logged].slice(-MAX_CONFLICT_LOG),
      };
      write();
      return api.get();
    },
    /** Undo the last apply. False when there is nothing to undo. The log keeps what was answered. */
    putBack() {
      if (!record.previous.length) return false;
      const prev = record.previous[record.previous.length - 1];
      record = { ...record, previous: record.previous.slice(0, -1),
        answers: normalizeAnswers(prev.answers, opts), layer: { ...(prev.layer || {}) }, why: prev.why || {}, appliedAt: now() };
      write();
      return true;
    },
    /** Clear what was ticked from this device - and the conflict log, which names the boxes. The settings stay. */
    forgetAnswers() {
      record = { ...record, answers: normalizeAnswers({}, opts), log: [],
        previous: record.previous.map((p) => ({ ...p, answers: normalizeAnswers({}, opts) })) };
      write();
    },
    markSavedOnline(at = now()) { record = { ...record, savedOnlineAt: at }; write(); },
    clear() {
      record = emptyRecord(opts);
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

/**
 * What goes online. The settings by default; the ticked boxes - and the conflict log, which names
 * them - only when that is chosen too.
 */
export function onlinePayload(record, { includeAnswers = false } = {}) {
  const r = normalizeRecord(record);
  return includeAnswers ? { layer: r.layer, answers: r.answers, log: r.log } : { layer: r.layer };
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
