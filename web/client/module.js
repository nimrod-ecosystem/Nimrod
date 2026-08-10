// Module runtime — the contract every module implements, and the loop that
// mounts one.
//
// A module is a factory:  registerModule(id, (ctx) => ({ init, onResize, onHide, destroy }))
//
//   ctx.mount   the DOM element the module owns
//   ctx.bus     a SCOPED bus (sinks/bindings/sources it opens are auto-released
//               on destroy — modules can't leak listeners)
//   ctx.state   the per-user state handle (server-backed)
//   ctx.user    the current user id (informational)
//
// Modules interact with the outside world ONLY through ctx.bus and ctx.state.
// They never reach for the DOM outside ctx.mount, never touch storage directly,
// and never name their input devices.

const registry = new Map();

export function registerModule(id, factory) {
  if (registry.has(id)) console.warn(`module "${id}" re-registered`);
  registry.set(id, factory);
}

export function hasModule(id) { return registry.has(id); }
export function listModules() { return [...registry.keys()]; }

// Instantiate a registered module against a live context. Returns a lifecycle
// handle; every method is optional on the module and safe to call here.
export function mountModule(id, { mount, bus, state, user }) {
  const factory = registry.get(id);
  if (!factory) throw new Error(`no module registered: "${id}"`);

  const scoped = bus.scope();
  const instance = factory({ mount, bus: scoped, state, user });

  return {
    init:     () => instance.init?.(),
    onResize: () => instance.onResize?.(),
    onHide:   () => instance.onHide?.(),
    destroy:  () => {
      try { instance.destroy?.(); }
      finally { scoped.dispose(); }   // release every sink/binding/source it opened
    },
  };
}
