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

/**
 * *** A MODULE MUST FIT THE BOX IT IS GIVEN, AND RE-FIT WHEN THAT BOX CHANGES. ***
 *
 * `onResize` has been in the contract since the beginning and almost nothing called it.
 * `app.js` called it on a WINDOW resize; `kiosk.js` called it for the camera and nothing else.
 * A panel going full screen, a sibling collapsing, a grid re-laying out — none of those resize
 * the window, so none of them reached a module.
 *
 * What that looked like from outside, reported by Mike off the live site on 2026-09-06:
 * *"Comet keeps its mount-time field size when a panel goes full screen"* — a canvas drawing at
 * 260px in a box that is now 900, because `resize()` reads `mount.getBoundingClientRect()` and
 * nobody ever asked it to look again.
 *
 * Two modules had already noticed and fixed it privately: `board.js` and `pond.js` each carried
 * their own `ResizeObserver`, with `pond`'s watching exactly this element for exactly this
 * reason. That is the tell — when two modules independently wall off the same corner, the wall
 * belongs in the host. `mountModule` is the one door every module comes through, on every page,
 * so the rule is enforced here and no future module has to remember it.
 *
 * THE THREE GUARDS, each of which is a way this could have made things worse:
 *
 *   1. **Nothing fires before `init()`.** `mountModule` returns before the caller inits, and
 *      `ResizeObserver` fires once as soon as it observes. Calling `onResize` on a module that
 *      has not built its DOM yet is a crash on mount, which is worse than the bug being fixed.
 *   2. **Nothing fires for a size that has not changed.** The initial observation, and any
 *      layout pass that reports the same box, are dropped. A module that redraws on every RO
 *      callback would otherwise repaint continuously.
 *   3. **A module that resizes ITSELF in `onResize` cannot loop.** The notified size is recorded
 *      BEFORE `onResize` runs, so a re-entrant observation of the same box is dropped by (2).
 */
function observeBox(el, notify) {
  if (!el || typeof ResizeObserver === 'undefined') return () => {};
  let w = -1, h = -1;
  let armed = false;                       // set by the record's `init`, below
  let frame = 0;
  const ro = new ResizeObserver(() => {
    if (!armed) return;
    // Coalesce: a grid re-layout can report several boxes in one frame, and the module only
    // cares about the one it ends up with.
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!armed) return;
      const r = el.getBoundingClientRect();
      const nw = Math.round(r.width), nh = Math.round(r.height);
      if (nw === w && nh === h) return;    // same box: nothing to tell anybody
      w = nw; h = nh;                      // recorded BEFORE, so a self-resize cannot loop
      notify();
    });
  });
  ro.observe(el);
  return {
    // Called from the record's `init`, so the first thing a module hears about its box is
    // never earlier than the moment it was told to build itself.
    arm() {
      const r = el.getBoundingClientRect();
      w = Math.round(r.width); h = Math.round(r.height);
      armed = true;
    },
    stop() {
      armed = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      try { ro.disconnect(); } catch { /* already gone */ }
    },
  };
}

// Mount one instance. `state` and `events` are the instance's own handles; the
// runtime disposes them (and the bus scope) on destroy, so nothing leaks.
export function mountModule(type, ctx) {
  const entry = registry.get(type);
  if (!entry) throw new Error(`no module registered: "${type}"`);

  // INSTANCE ADDRESSING: `ctx.instanceId` already reaches here from every real mounting path
  // (kiosk.js's `childCtx`, module_try.js's demo and live hosts) — it was threaded through for
  // per-instance state/events and simply never used for the bus. Passing it to `scope` gives
  // every subscription this module makes a second, instance-scoped alias for free, with no
  // change to this module's own topic strings. See bus.js `scope`/`instanceTopic`.
  const scoped = ctx.bus.scope(ctx.instanceId || null);
  const instance = entry.factory({ ...ctx, bus: scoped });

  // The fitting contract, applied by the host rather than asked of the module. `mod-host` is
  // what makes the mount a positioned, scrolling box (see modules.css) — so a full-bleed
  // module resolves `inset:0` against its own panel instead of the whole stage, and a module
  // taller than its panel is REACHABLE rather than clipped. Set here because every module on
  // every page comes through this function, and a rule a page has to remember is a rule that
  // gets forgotten: it was forgotten on `modules.html`, which is where Mike found it.
  ctx.mount?.classList?.add('mod-host');

  const box = observeBox(ctx.mount, () => {
    try { instance.onResize?.(); } catch (err) { console.error(`[${type}] onResize`, err); }
  });

  return {
    type,
    manifest: entry.manifest,
    // The raw factory result. The lifecycle above is the CONTRACT and a host should use
    // nothing else; this is the escape hatch for a test that has to look at a module with
    // no DOM to assert against - a canvas module has no markup to inspect, so without this
    // its behavior can only be eyeballed, which is not a test.
    impl:     instance,
    init:     () => { const r = instance.init?.(); box.arm?.(); return r; },
    onResize: () => instance.onResize?.(),
    onHide:   () => instance.onHide?.(),
    // The counterpart `onHide` never had. A host that hides a child and later shows it again
    // had no way to say so through the contract, so the only route back was `impl`, which is
    // documented above as the TEST escape hatch. Added when `director.js` needed to park a
    // wallpaper's clock while it was covered up; optional like the rest of the lifecycle, so
    // every existing module is unaffected.
    onShow:   () => instance.onShow?.(),
    destroy:  () => {
      // First, and outside the try: an observer left running holds the mount element and the
      // module's closure alive, which is the exact shape the soak meter caught three of.
      box.stop?.();
      try { instance.destroy?.(); }
      finally { scoped.dispose(); ctx.state?.destroy?.(); ctx.events?.destroy?.(); }
    },
  };
}
