// Module runtime — the registry, the manifest, and the loop that mounts one
// instance of a module inside a profile.
//
// A module registers a manifest plus a factory:
//   registerModule({ type, title, description }, (ctx) => ({ init, onResize, onHide, destroy }))
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
    init:     () => instance.init?.(),
    onResize: () => instance.onResize?.(),
    onHide:   () => instance.onHide?.(),
    destroy:  () => {
      try { instance.destroy?.(); }
      finally { scoped.dispose(); ctx.state?.destroy?.(); ctx.events?.destroy?.(); }
    },
  };
}
