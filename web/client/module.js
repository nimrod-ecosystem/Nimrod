// Module runtime — the registry, the manifest, and the loop that mounts one
// instance of a module inside a profile.
//
// A module registers a manifest plus a factory:
//   registerModule(manifest, (ctx) => ({ init, onResize, onHide, destroy }))
//
// The manifest grew, and every field on it exists so the host can reason about a module
// WITHOUT MOUNTING IT - which is what a modules browser, the recovery ladder and the
// reachability audit all need. Full contract: docs/module-input-spec.md
//
//   type          stable, machine-safe, never changes. Bindings and saved screens key off it.
//   title         human. Shown in menus.
//   description   human.
//   settings      declared as DATA, so the shell can render them and a cursor can walk them.
//   dependsOn     none | local | server | network - how exposed it is, for picking a fallback.
//                 Assumed `server` if absent, which is the pessimistic answer on purpose.
//   importance    critical | normal | optional - how loudly the audit complains about it.
//
//   ctx.mount     the DOM element this instance owns
//   ctx.bus       a SCOPED bus (sinks/bindings/sources auto-released on destroy)
//   ctx.state     per-(user,profile,instance) OVERWRITE state handle (versioned)
//   ctx.events    per-(user,profile,instance) APPEND-ONLY events handle
//   ctx.user      current user id
//   ctx.profileId the active profile
//
// A module talks to the world ONLY through ctx. It never names its inputs, never
// reaches storage directly, and never touches the DOM outside ctx.mount.

const registry = new Map(); // type -> { manifest, factory }

export function registerModule(manifest, factory) {
  const { type } = manifest;
  if (!type) throw new Error('registerModule: manifest.type is required');
  if (registry.has(type)) console.warn(`module "${type}" re-registered`);
  registry.set(type, { manifest, factory });
}

export function getManifest(type) { return registry.get(type)?.manifest; }
export function listManifests() { return [...registry.values()].map((e) => e.manifest); }

// Mount one instance. `state` and `events` are the instance's own handles; the
// runtime disposes them (and the bus scope) on destroy, so nothing leaks.
export function mountModule(type, ctx) {
  const entry = registry.get(type);
  if (!entry) throw new Error(`no module registered: "${type}"`);

  const scoped = ctx.bus.scope();
  const instance = entry.factory({ ...ctx, bus: scoped });

  return {
    type,
    manifest: entry.manifest,
    // The raw factory result. The lifecycle above is the CONTRACT and a host should use
    // nothing else; this is the escape hatch for a test that has to look at a module with
    // no DOM to assert against - a canvas module has no markup to inspect, so without this
    // its behaviour can only be eyeballed, which is not a test.
    impl:     instance,
    init:     () => instance.init?.(),
    onResize: () => instance.onResize?.(),
    onHide:   () => instance.onHide?.(),
    destroy:  () => {
      try { instance.destroy?.(); }
      finally { scoped.dispose(); ctx.state?.destroy?.(); ctx.events?.destroy?.(); }
    },
  };
}
