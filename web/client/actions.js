// actions.js — the ACTION CATALOGUE: the list of things an input can be bound TO.
//
// bus.js already makes inputs interchangeable: any source can feed any topic through a
// binding, with zero change downstream. What it does NOT have is a way to ASK what is
// bindable. Today a module's inputs exist only as string literals inside its own file
// ("photos/next", "youtube/prev", "sprint/control"), which is fine for code and useless
// for a person: an Overwatch-style binder needs a list of actions with human labels
// before it can say "press the thing you want to use for THIS".
//
// So this is the catalogue. A declaration is:
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
// The catalogue machinery stays because a verb IS an action ("Primary select" published
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
  // THE DIRECTOR WAS MISSING, and it is on Christine's actual screen — the starter
  // "Bedside" profile is photos + camera + clock + director. Absent from this table it is
  // never focusable and answers no verb, so a switch could not skip a segment on the one
  // screen that ships by default. Its "next" is the SEGMENT skip: the director advances by
  // being told the segment ended, and `reason` is what separates "she skipped it" from
  // "it finished" downstream.
  director:      { next: { topic: 'segment/done', payload: { reason: 'skipped' } },
                   select: { topic: 'segment/done', payload: { reason: 'skipped' } } },
  interstitials: { next: 'interstitial/next', prev: 'interstitial/prev', back: 'interstitial/skip' },
  wordforge:     { next: 'wordforge/next', select: 'wordforge/next' },
  algebra:       { select: 'algebra/submit' },
  sprint:        { select: { topic: 'sprint/control', payload: 'toggle' },
                   next:   { topic: 'sprint/control', payload: 'start' },
                   back:   { topic: 'sprint/control', payload: 'pause' } },
  counter:       { select: { topic: 'counter/delta', payload: 1 },
                   up:     { topic: 'counter/delta', payload: 1 },
                   down:   { topic: 'counter/delta', payload: -1 } },
};

// What a verb does on a given module type, normalised to {topic, payload}.
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
