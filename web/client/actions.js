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
// NOT A SECOND VOCABULARY. This deliberately does NOT introduce global press/select/
// next/prev actions (the Cici model). Cici had one screen and one focus, so a global
// "next" was unambiguous; here nine modules can be on screen at once and a global "next"
// would need a focus concept that does not exist and should not be invented. Bindings
// name the exact action they drive.

const ID_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/;

// The gate control is itself an action, so a caregiver can put it on a physical switch
// instead of a keyboard — that was the point of the spec. input.js treats this id
// specially in one respect only: see ROLE_CYCLE_ACTION there.
export const ROLE_CYCLE_ACTION = 'system/role-cycle';
export const ROLE_CYCLE_TOPIC  = 'system/role-cycle';

export const SYSTEM_ACTIONS = [
  {
    id: ROLE_CYCLE_ACTION,
    label: 'Cycle who may act (moderator / patient / both)',
    topic: ROLE_CYCLE_TOPIC,
    group: 'System',
  },
];

// ---------------------------------------------------------------------------------
// The built-in catalogue.
//
// Every entry here is a topic a shipped module ALREADY subscribes to - none of this is
// new plumbing, it is a readable name put in front of wiring that existed. That is the
// whole trick: the binder became possible without touching a single module.
//
// STAGING, on purpose. Eventually a module declares its own actions when it registers,
// so a module written by someone else shows up in the binder for free. Until then this
// list is maintained by hand, and the risk is honest: rename a topic inside a module and
// this file silently points at nothing. The binder shows that as `unknown-action`
// against the saved binding rather than failing quietly, which is the reason input.js
// logs that case instead of ignoring it.
//
// WHAT IS DELIBERATELY ABSENT: topics whose payload is content rather than a command --
// `wordforge/answer` takes a word, `algebra/key` takes a digit. A person with one switch
// is not typing, and filling the binder with sixteen key actions buries the four that
// matter. Director internals (`segment/*`, `quests/log`) are absent for the same reason:
// they are not things a person does.
export const BUILTIN_ACTIONS = [
  { id: 'photos/next',      label: 'Next photo',           topic: 'photos/next',      group: 'Photos' },
  { id: 'photos/prev',      label: 'Previous photo',       topic: 'photos/prev',      group: 'Photos' },

  { id: 'personal/next',    label: 'Next video',           topic: 'personal/next',    group: 'Personal videos' },
  { id: 'personal/prev',    label: 'Previous video',       topic: 'personal/prev',    group: 'Personal videos' },

  { id: 'educational/next', label: 'Next',                 topic: 'educational/next', group: 'Educational' },
  { id: 'educational/prev', label: 'Previous',             topic: 'educational/prev', group: 'Educational' },
  { id: 'educational/skip', label: 'Skip this one',        topic: 'educational/skip', group: 'Educational' },

  { id: 'youtube/next',     label: 'Next video',           topic: 'youtube/next',     group: 'YouTube' },
  { id: 'youtube/prev',     label: 'Previous video',       topic: 'youtube/prev',     group: 'YouTube' },

  { id: 'interstitial/next', label: 'Next',                topic: 'interstitial/next', group: 'Between videos' },
  { id: 'interstitial/prev', label: 'Previous',            topic: 'interstitial/prev', group: 'Between videos' },
  { id: 'interstitial/skip', label: 'Skip',                topic: 'interstitial/skip', group: 'Between videos' },

  { id: 'wordforge/next',   label: 'New word',             topic: 'wordforge/next',   group: 'Wordforge' },

  { id: 'sprint/start',     label: 'Start the timer',      topic: 'sprint/control', payload: 'start',  group: 'Sprint' },
  { id: 'sprint/pause',     label: 'Pause the timer',      topic: 'sprint/control', payload: 'pause',  group: 'Sprint' },
  { id: 'sprint/toggle',    label: 'Start or pause',       topic: 'sprint/control', payload: 'toggle', group: 'Sprint' },

  { id: 'counter/up',       label: 'Count up',             topic: 'counter/delta', payload: 1,  group: 'Counter' },
  { id: 'counter/down',     label: 'Count down',           topic: 'counter/delta', payload: -1, group: 'Counter' },

  { id: 'algebra/submit',   label: 'Submit the answer',    topic: 'algebra/submit',   group: 'Algebra' },
];

// Everything a fresh screen can bind, in one call.
export function createDefaultRegistry() {
  const reg = createActionRegistry();
  reg.registerAll(BUILTIN_ACTIONS);
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
