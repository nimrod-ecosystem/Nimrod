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
