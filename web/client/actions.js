// actions.js — the ACTION CATALOG: the list of things an input can be bound TO.
//
// bus.js already makes inputs interchangeable: any source can feed any topic through a
// binding, with zero change downstream. What it does NOT have is a way to ASK what is
// bindable. Today a module's inputs exist only as string literals inside its own file
// ("photos/next", "youtube/prev", "sprint/control"), which is fine for code and useless
// for a person: an Overwatch-style binder needs a list of actions with human labels
// before it can say "press the thing you want to use for THIS".
//
// So this is the catalog. A declaration is:
//
//   { id, label, topic, payload?, group? }
//     id       stable, machine-safe, and the thing BINDINGS PERSIST AGAINST.
//     label    what a caregiver reads in the binder ("Next photo").
//     topic    where an activation is published — an existing bus topic, unchanged.
//     payload  what to publish (some topics carry a value: sprint/control takes a verb).
//     group    how the binder groups the list ("Photos", "System").
//
// WHY BINDINGS KEY OFF `id` AND NOT `topic`: a saved profile has to survive a module
// renaming its internal topics. The id is the contract with a caregiver's saved setup;
// the topic is an implementation detail behind it. Point an id at a different topic and
// every saved binding follows automatically.
//
// WHAT A PERSON ACTUALLY BINDS is not one of these directly — it is a VERB, see below.
// The catalog machinery stays because a verb IS an action ("Primary select" published
// on `verb/select`); the verb layer just means the list a person reads is nine items
// long instead of one entry per module feature.

const ID_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/;

// The gate control is itself an action, so a caregiver can put it on a physical switch
// instead of a keyboard — that was the point of the spec. input.js treats this id
// specially in one respect only: see ROLE_CYCLE_ACTION there.
export const ROLE_CYCLE_ACTION = 'system/role-cycle';
export const ROLE_CYCLE_TOPIC  = 'system/role-cycle';

export const SYSTEM_ACTIONS = [
  {
    id: ROLE_CYCLE_ACTION,
    label: 'Cycle who may act (moderator / participant / both)',
    topic: ROLE_CYCLE_TOPIC,
    group: 'System',
  },
];

// ---------------------------------------------------------------------------------
// THE VERB VOCABULARY - the thing a person binds to.
//
// Unity's model, and Mike is right that it is the correct one here. You do not bind a
// key to "fire the rifle in the player's right hand"; you bind it to PRIMARY FIRE, and
// whatever you are holding decides what that means. Here you bind your switch to
// PRIMARY SELECT once, and whatever is in front of you decides what that means.
//
// I ARGUED AGAINST THIS IN SLICE 1 AND I WAS WRONG, so the reasoning is worth recording
// rather than quietly reversing. My objection was that nine modules can be on screen at
// once, so a global "next" is ambiguous and would need a focus concept that did not
// exist. Both halves were true and the conclusion was still wrong: I was picturing
// someone with a mouse, who can simply click the panel they mean. A person with ONE
// SWITCH cannot. They cannot have nine switches either. So a small global vocabulary
// plus a way to move focus is not a complication to avoid - it is the only shape that
// works for the person this is for, and it is how a TV remote and every AAC scanner
// already behave. The focus concept had to be invented; that is `input_router.js`.
//
// WHAT THIS BUYS, beyond tone:
//   * The binder lists NINE things, not twenty grouped into nine collapsible headings.
//   * A binding stops referring to a screen's contents, so it can be PER USER: set your
//     switch up once, ever, and it follows you to any screen on any machine.
//   * A module written by someone else works with everybody's existing switches on the
//     day it ships, without anyone rebinding anything.
export const VERBS = [
  { id: 'select', label: 'Primary select', hint: 'the main "do it" — the one everybody needs' },
  { id: 'back',   label: 'Back or cancel', hint: '' },
  { id: 'next',   label: 'Next',           hint: 'forward through whatever is in front of you' },
  { id: 'prev',   label: 'Previous',       hint: '' },
  { id: 'up',     label: 'Up',             hint: '' },
  { id: 'down',   label: 'Down',           hint: '' },
  { id: 'left',   label: 'Left',           hint: '' },
  { id: 'right',  label: 'Right',          hint: '' },
  { id: 'menu',   label: 'Menu',           hint: '' },
];

// Moving the focus is itself bindable, because with one switch it has to be. These are
// the scanning controls, and they are the reason a single switch can reach a whole screen.
export const FOCUS_VERBS = [
  { id: 'focus-next', label: 'Move to the next panel', hint: 'with one switch, this is how you get anywhere' },
  { id: 'focus-prev', label: 'Move to the previous panel', hint: '' },
];

export const verbTopic = (id) => `verb/${id}`;

// ---------------------------------------------------------------------------------------
// CUSTOM VERBS — Mike: *"a verb is just a variable. You bind something to verb X and then
// verb X performs this action in your module."*
//
// THAT IS EXACTLY WHAT IT IS, and nothing in the machinery ever assumed otherwise. `VERBS` is
// a list, `verbTopic` is string concatenation, and `verbTarget` is a lookup in a plain table.
// The nine shipped verbs are a curated DEFAULT, not a closed set - so this adds a registry
// rather than a mechanism.
//
// WHAT IT UNLOCKS, and Mike named both:
//   * HOME ASSISTANT. A bridge module that answers `verb/lights-dim` turns her switch into a
//     light switch with NO new input plumbing - same bus, same bindings, same gate, same
//     diagnostics. Remote drive proved the pattern: it is the same control path with a longer
//     wire, and so is this.
//   * THE STATE MACHINE / DIRECTOR. A screen can declare its own vocabulary instead of
//     borrowing `next` and hoping.
//
// AND THE REFRAME THAT MATTERS MOST: for somebody who cannot speak, A CUSTOM VERB IS A
// SENTENCE SHE CAN SAY WITH A SWITCH. `i-want-music` is not a control, it is an utterance -
// which puts this much closer to the AAC board than to a keybinding screen.
//
// *** THE ONE BOUNDARY IT MUST NOT CROSS, and it is the reason this is a registry and not
// just a spread operator: THE REMOTE-DRIVE WIRE ALLOWLIST STAYS FROZEN. ***
// `drive.js` and `drive.py` each hold their own copy of the eleven names deliberately, so
// that a boundary cannot widen because another file grew an entry. A custom verb is LOCAL BY
// DEFAULT and does not become remotely drivable by existing - if it ever should, that is an
// explicit decision on both sides of the wire, not a side effect of somebody adding a row.
// There is a test.
//
// TWO COSTS, both real:
//   * The binder lists nine things on purpose. Twenty custom verbs would undo that, so they
//     are grouped separately and belong behind the `advanced` complexity level.
//   * A custom verb means nothing on a module that has no mapping for it, exactly like a
//     built-in one. `respondsToVerbs` already handles that and the router already skips
//     panels with nothing to say.

// A custom id may not shadow a built-in. `select` meaning something else on one screen is the
// single worst thing this feature could do: every binding a person owns is keyed to that name.
const BUILT_IN_IDS = new Set([...VERBS, ...FOCUS_VERBS].map((v) => v.id));

export function normalizeVerb(raw) {
  const id = String(raw?.id || '').trim();
  if (!ID_RE.test(id)) return null;
  if (BUILT_IN_IDS.has(id)) return null;      // never shadow a shipped verb
  return {
    id,
    label: String(raw.label || id),
    hint: String(raw.hint || ''),
    group: String(raw.group || 'Custom'),
    custom: true,
  };
}

// The effective vocabulary: the shipped nine, plus whatever this screen or person adds.
// Built-ins always come first and always win, so a saved binding can never be re-pointed by
// somebody adding a verb.
export function mergeVerbs(custom = [], base = VERBS) {
  const out = [...base];
  const seen = new Set(out.map((v) => v.id));
  for (const c of Array.isArray(custom) ? custom : []) {
    const v = normalizeVerb(c);
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

// The effective verb table. A per-type overlay merges OVER the shipped defaults, which is
// what lets a screen say "here, Primary select means Skip" - the thing MODULE_VERBS was
// always documented as allowing and had no way to express.
export function mergeVerbMaps(overlay = {}, base = MODULE_VERBS) {
  const out = {};
  for (const [type, map] of Object.entries(base)) out[type] = { ...map };
  for (const [type, map] of Object.entries(overlay || {})) {
    if (!map || typeof map !== 'object') continue;
    out[type] = { ...(out[type] || {}), ...map };
  }
  return out;
}

// The DEFAULT meaning of each verb, per module type. Defaults, not rules: the intent is
// that a module's own settings can re-point them ("on this screen, Primary select should
// mean Skip"), which is why this is a plain data table and not logic.
//
// A verb absent from a type means that module has nothing to say to it - Photos does not
// answer "select", the clock answers nothing at all. That is not an error, and the router
// uses it to decide which panels are worth stopping on while scanning.
//
// Every topic here is one a shipped module ALREADY subscribes to. Nothing was rewired.
export const MODULE_VERBS = {
  photos:        { next: 'photos/next', prev: 'photos/prev' },
  personal:      { next: 'personal/next', prev: 'personal/prev' },
  educational:   { next: 'educational/next', prev: 'educational/prev', back: 'educational/skip' },
  youtube:       { next: 'youtube/next', prev: 'youtube/prev' },
  // THE DIRECTOR WAS MISSING, and it is on a real bedside screen — the starter
  // "Bedside" profile is photos + camera + clock + director. Absent from this table it is
  // never focusable and answers no verb, so a switch could not skip a segment on the one
  // screen that ships by default. Its "next" is the SEGMENT skip: the director advances by
  // being told the segment ended, and `reason` is what separates "she skipped it" from
  // "it finished" downstream.
  director:      { next: { topic: 'segment/done', payload: { reason: 'skipped' } },
                   select: { topic: 'segment/done', payload: { reason: 'skipped' } } },
  interstitials: { next: 'interstitial/next', prev: 'interstitial/prev', back: 'interstitial/skip' },
  wordforge:     { next: 'wordforge/next', select: 'wordforge/next' },
  // TRIVIA IS ANSWERABLE WITH ONE BUTTON, which is the whole reason it is shaped as four
  // choices with a walking highlight rather than as free recall. `next` moves the highlight and
  // wraps; `select` takes whatever it is on. `back` skips a question somebody does not want.
  trivia:        { next: 'trivia/next', prev: 'trivia/prev', select: 'trivia/select',
                   back: 'trivia/skip' },
  algebra:       { select: 'algebra/submit' },
  sprint:        { select: { topic: 'sprint/control', payload: 'toggle' },
                   next:   { topic: 'sprint/control', payload: 'start' },
                   back:   { topic: 'sprint/control', payload: 'pause' } },
  // The pond answers a switch, which is the whole reason it was worth porting: cursor and
  // click meant somebody who cannot reach could only ever watch it.
  pond:          { select: 'pond/splash', next: 'pond/stir' },
  // THE COMET'S VERBS ARE THE REASON IT WAS WORTH PORTING AT ALL. Cici's version moved only
  // with a pointer, so a switch user watched hearts drift past and could never touch one.
  // `next` steers the comet to the nearest heart; `select` blooms where it already is.
  comet:         { select: 'comet/spark', next: 'comet/seek' },
  // ONE VERB, AND THAT IS THE WHOLE GAME. Press. Everything clinical about this module
  // - latency, commissions, perseveration - is WHEN that one verb arrives relative to
  // the invite, so a second verb would be a second thing to get wrong for no gain.
  pressgame:     { select: 'pressgame/press' },
  // ANSWER and HANG UP, and nothing else. A call is not a thing to browse: `next` on a
  // call has no meaning, and a verb that does nothing is a press somebody spent effort on
  // for no result.
  call:          { select: 'call/answer', back: 'call/hangup' },
  counter:       { select: { topic: 'counter/delta', payload: 1 },
                   up:     { topic: 'counter/delta', payload: 1 },
                   down:   { topic: 'counter/delta', payload: -1 } },
};

// What a verb does on a given module type, normalized to {topic, payload}.
export function verbTarget(type, verb, maps = MODULE_VERBS) {
  const hit = maps[type]?.[verb];
  if (!hit) return null;
  return typeof hit === 'string' ? { topic: hit, payload: undefined } : { ...hit };
}

export const verbsFor = (type, maps = MODULE_VERBS) => Object.keys(maps[type] || {});
export const respondsToVerbs = (type, maps = MODULE_VERBS) => verbsFor(type, maps).length > 0;

// Everything a person can bind, in one call. VERBS and FOCUS_VERBS are the whole list -
// deliberately flat and short, because the binder is read by someone holding a stopwatch
// and a participant, not browsing a menu.
export function createDefaultRegistry() {
  const reg = createActionRegistry();
  reg.registerAll(VERBS.map((v) => ({
    id: verbTopic(v.id), label: v.label, topic: verbTopic(v.id), group: 'Controls',
  })));
  reg.registerAll(FOCUS_VERBS.map((v) => ({
    id: verbTopic(v.id), label: v.label, topic: verbTopic(v.id), group: 'Controls',
  })));
  reg.registerAll(SYSTEM_ACTIONS);
  return reg;
}

export function createActionRegistry() {
  const actions = new Map();   // id -> frozen declaration

  function register(decl) {
    const { id, label, topic, payload, group = 'Other' } = decl || {};
    if (!ID_RE.test(String(id || ''))) {
      throw new Error(`registerAction: bad id ${JSON.stringify(id)} — must match ${ID_RE}`);
    }
    if (!topic || typeof topic !== 'string') {
      throw new Error(`registerAction "${id}": topic is required`);
    }
    if (!label || typeof label !== 'string') {
      throw new Error(`registerAction "${id}": label is required — the binder shows it to a person`);
    }
    if (actions.has(id)) console.warn(`action "${id}" re-registered`);

    const entry = Object.freeze({ id, label, topic, payload, group: String(group) });
    actions.set(id, entry);
    // Unregister only if OUR entry is still the one installed — a re-registration
    // (module remount) must not be undone by the old instance's cleanup.
    return () => { if (actions.get(id) === entry) actions.delete(id); };
  }

  function registerAll(list) {
    const offs = (list || []).map(register);
    return () => offs.forEach((off) => off());
  }

  // Sorted for display: by group, then label. The binder renders this directly.
  function list() {
    return [...actions.values()].sort(
      (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label),
    );
  }

  function groups() {
    const out = new Map();
    for (const a of list()) {
      if (!out.has(a.group)) out.set(a.group, []);
      out.get(a.group).push(a);
    }
    return out;
  }

  return {
    register,
    registerAll,
    get: (id) => actions.get(id) || null,
    has: (id) => actions.has(id),
    list,
    groups,
    size: () => actions.size,
  };
}
