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
//   core          'legacy' | 'new' - which core this module runs on, added 2026-09-17 for the
//                 rebuild's coexistence period (DECISIONS.md, "Rebuild the foundation, port the
//                 modules, keep the substrate"). Absent means 'legacy' - the same pessimistic
//                 default `dependsOn` already uses, and for the same reason: a module only
//                 becomes 'new' by saying so the moment its port actually lands, never by
//                 omission. See `NEW_CORE_SPEC.md` §9 and `modules_catalog.js`'s `coreReport`.
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
//
// *** `core: 'new'` GUARANTEES TWO MORE ctx FIELDS, AND `mountModule` ENFORCES IT. ***
// `NEW_CORE_SPEC.md` §1's own finding: every REAL mounting path (kiosk.js's `childCtx`) already
// supplies `ctx.personId` and `ctx.instanceId`, but `module.js`'s documented contract never named
// them, so a module that depended on them was trusting one caller's convention, not a promise.
// A module that opts into the new core is making a claim about what it needs; `mountModule` below
// checks the claim rather than trusting it, per this repo's own standing rule that a decision
// nothing checks is a suggestion. A `core: 'legacy'` (or undeclared) module is UNCHANGED -
// nothing new is required of it, and nothing new is checked.
//
//   ctx.personId    REQUIRED (the key must exist, even if its live value is still null while a
//                   lookup resolves - see kiosk.js's own `get personId()` getter for why a getter,
//                   not a plain value)
//   ctx.instanceId  REQUIRED and must be a real, non-empty value - every module is an instance of
//                   something, and per-instance state/events keying depends on this existing

import { readWithLegacy } from './settings_fields.js';

const registry = new Map(); // type -> { manifest, factory }

export function registerModule(manifest, factory) {
  const { type } = manifest;
  if (!type) throw new Error('registerModule: manifest.type is required');
  if (registry.has(type)) console.warn(`module "${type}" re-registered`);
  registry.set(type, { manifest, factory });
}

export function getManifest(type) { return registry.get(type)?.manifest; }
export function listManifests() { return [...registry.values()].map((e) => e.manifest); }

// ---------------------------------------------------------------------------------------
// *** A NEW PANEL STARTS FROM A SIBLING, FOR THE KEYS ITS MODULE NAMES. ***
//
// Mike, 2026-09-29, on the photos interval: *"keep it per panel, copy from existing."* The
// setting stays PER PANEL - two photos panels on one screen may still run at different speeds -
// but a NEW photos panel on a screen that already has one starts at that one's interval rather
// than at the module default, because the value somebody already chose on this screen is a
// better guess than the value nobody chose.
//
//   manifest.copyFromSibling   [key, ...]   the keys a NEW instance copies, once, at creation,
//                                           from an existing instance of the SAME TYPE on the
//                                           SAME SCREEN (the lowest-positioned one that has a
//                                           stored value). Absent = nothing is copied, which is
//                                           every module but photos today.
//
// WHY A DECLARED LIST AND NOT A PHOTOS SPECIAL CASE: YouTube (and anything else with a pace or a
// look) will want the same, and the answer should be one line in its own manifest, not another
// branch in whoever creates panels. WHY ONLY THE SAME SCREEN: "which of this account's other
// screens is the one to copy" has no good answer (the bedside screen and a grandchild's tablet
// are both "existing"), and Mike wants the per-panel vs account-wide question settled with the
// prefab/instance design, not decided here by accident. WHY ONLY AT CREATION: it is a starting
// value, not a link - change either panel afterwards and the other does not follow.
//
// Only a STORED value is copied. A sibling still on the default has nothing to hand on, and the
// new panel gets the (same) default by the ordinary route. An old key the declared setting
// migrated from (`legacy: { key, scale }`) is read through `readWithLegacy`, the one reader of
// it, so a sibling that still holds `intervalSec` hands on the right number of milliseconds.
//
// `makeState(key)` returns a state handle (`load`/`get`/`set`/`flush`/`destroy`) for one
// instance on this screen - `state.js` signed in, `local_store.js` signed out. Called by both
// profile clients' `addModule`, which is the one door every new panel comes through on either
// backend. NEVER THROWS: a copy that fails leaves the new panel on its default, and a panel
// that exists is worth more than a panel that failed to be created over a starting value.
// ---------------------------------------------------------------------------------------
export async function seedFromSibling({ type, newId, siblings = [], makeState }) {
  try {
    const manifest = getManifest(type);
    const keys = Array.isArray(manifest?.copyFromSibling) ? manifest.copyFromSibling : [];
    if (!keys.length || typeof makeState !== 'function' || !newId) return null;
    let decls = manifest.settings;
    if (typeof decls === 'function') { try { decls = decls(); } catch { decls = []; } }
    const legacyOf = (key) => {
      const lg = (Array.isArray(decls) ? decls : []).find((d) => d && d.key === key)?.legacy;
      return lg && typeof lg.key === 'string' ? { key: lg.key, scale: Number(lg.scale) || 1 } : null;
    };
    const read = (values, key) => readWithLegacy(values, key, legacyOf(key));
    const others = (siblings || []).filter((m) => m && m.type === type && m.id !== newId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const sib of others) {
      let values = {};
      const h = makeState(sib.id);
      try { await h.load(); values = h.get() || {}; } catch { values = {}; } finally { h.destroy?.(); }
      const patch = {};
      for (const key of keys) { const v = read(values, key); if (v !== undefined) patch[key] = v; }
      if (!Object.keys(patch).length) continue;
      const mine = makeState(newId);
      try {
        await mine.load().catch(() => {});
        mine.set(patch);
        await mine.flush?.();
      } finally { mine.destroy?.(); }
      return { from: sib.id, patch };
    }
  } catch (err) {
    console.error(`seedFromSibling(${type})`, err);
  }
  return null;
}

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

/**
 * *** A ctx WITH SOME KEYS ADDED OR REPLACED -- AND EVERY GETTER STILL A GETTER. ***
 *
 * The host's ctx carries GETTERS for things that arrive after a module mounts (kiosk.js's
 * `childCtx`: `personId`, `output`, `callTransport`, `aim`). An object spread (`{ ...ctx, bus }`)
 * READS each getter once and stores the value, so a module mounted before the value arrived kept
 * null for good -- the call panel's transport among them (found 2026-09-30, module_test and
 * kiosk_test "live getters"). This copies property DESCRIPTORS instead, so a getter stays a getter
 * through any number of hosts. Chosen over a prototype chain (`Object.create(ctx)`) because a
 * container that spreads its ctx for a child (view.js, director.js) would silently drop every
 * inherited key; an own accessor survives that spread as a value, exactly as before, and survives
 * THIS function as an accessor. A module that destructures ctx at mount gets plain values, unchanged.
 * `extra` is copied the same way, and wins.
 */
export function extendCtx(ctx = {}, extra = {}) {
  const out = {};
  for (const src of [ctx, extra]) {
    const d = Object.getOwnPropertyDescriptors(src || {});
    for (const k of Object.keys(d)) d[k].configurable = true;   // so `extra` may replace any of them
    Object.defineProperties(out, d);
  }
  return out;
}

/**
 * The audio bus as one module instance sees it: the same bus, except every `register` carries
 * `owner: instanceId` unless the caller named an owner itself. A prototype over the real bus, so
 * every other method (and `play`, which calls `this.register`) is the bus's own. Anything that is
 * not a bus with a `register` is handed back untouched.
 */
export function ownedAudio(audio, instanceId) {
  if (!audio || typeof audio.register !== 'function' || !instanceId) return audio;
  const owned = Object.create(audio);
  owned.register = (id, spec = {}) => audio.register(id, { ...(spec || {}), owner: spec?.owner ?? instanceId });
  return owned;
}

// Mount one instance. `state` and `events` are the instance's own handles; the
// runtime disposes them (and the bus scope) on destroy, so nothing leaks.
export function mountModule(type, ctx) {
  const entry = registry.get(type);
  if (!entry) throw new Error(`no module registered: "${type}"`);

  // THE `core: 'new'` CONTRACT, ENFORCED, NOT JUST DOCUMENTED. See this file's own header for
  // why these two fields specifically. Checked before anything else runs, so a module written
  // against the new contract fails LOUDLY at its own mount rather than quietly reading
  // `undefined` three calls deep into its own logic.
  if (entry.manifest.core === 'new') {
    if (!('personId' in ctx)) {
      throw new Error(`mountModule("${type}"): core:'new' requires ctx.personId (the key must `
        + 'exist even if its value is still null while a lookup resolves)');
    }
    if (!ctx.instanceId) {
      throw new Error(`mountModule("${type}"): core:'new' requires a real ctx.instanceId`);
    }
  }

  // INSTANCE ADDRESSING: `ctx.instanceId` already reaches here from every real mounting path
  // (kiosk.js's `childCtx`, module_try.js's demo and live hosts) — it was threaded through for
  // per-instance state/events and simply never used for the bus. Passing it to `scope` gives
  // every subscription this module makes a second, instance-scoped alias for free, with no
  // change to this module's own topic strings. See bus.js `scope`/`instanceTopic`.
  const scoped = ctx.bus.scope(ctx.instanceId || null);
  // NOT `{ ...ctx, bus: scoped }`: that turned every getter the host supplied into the value it
  // had at this instant. See `extendCtx`.
  const extra = { bus: scoped };
  // THE SPEAKER, TAGGED WITH WHOSE IT IS (hide_sound.js). Every source this module registers on the
  // audio bus carries `owner: ctx.instanceId`, so "mute this panel while it is hidden" can find all of
  // its sounds without the module naming them. A getter, so a host getter stays live (see extendCtx).
  if ('audio' in (ctx || {}) && ctx.instanceId) {
    const id = ctx.instanceId;
    let seen = null, owned = null;
    Object.defineProperty(extra, 'audio', {
      enumerable: true, configurable: true,
      get() { const a = ctx.audio; if (a !== seen) { seen = a; owned = ownedAudio(a, id); } return owned; },
    });
  }
  const instance = entry.factory(extendCtx(ctx, extra));
  // What the host's hide policy is told about this instance (hide_sound.js). Read at the moment of
  // the hide, never captured: `ctx.hidePolicy` may be a host getter, and absent means "do nothing",
  // which is exactly what every page did before it existed.
  const tell = (verb, info) => {
    try {
      ctx.hidePolicy?.[verb]?.({ instanceId: ctx.instanceId || null, type, manifest: entry.manifest,
        audio: ctx.audio || null, impl: instance, state: ctx.state || null, by: info?.by || 'auto' });
    } catch (err) { console.error(`[${type}] hide policy ${verb}`, err); }
  };

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
    // `info.by`: 'person' when somebody hid it by their own action, anything else is automatic.
    // The module's own onHide runs FIRST, then the host's hide policy (mute / pause, hide_sound.js).
    onHide:   (info) => { const r = instance.onHide?.(); tell('hidden', info); return r; },
    // The counterpart `onHide` never had. A host that hides a child and later shows it again
    // had no way to say so through the contract, so the only route back was `impl`, which is
    // documented above as the TEST escape hatch. Added when `director.js` needed to park a
    // wallpaper's clock while it was covered up; optional like the rest of the lifecycle, so
    // every existing module is unaffected.
    // The policy is undone BEFORE the module's own onShow, so a module that restarts its sound
    // there is heard.
    onShow:   (info) => { tell('shown', info); return instance.onShow?.(); },
    destroy:  () => {
      // First, and outside the try: an observer left running holds the mount element and the
      // module's closure alive, which is the exact shape the soak meter caught three of.
      box.stop?.();
      // A remount under the same id (recovery's `remountPanel`) must not start out muted.
      tell('gone');
      try { instance.destroy?.(); }
      finally { scoped.dispose(); ctx.state?.destroy?.(); ctx.events?.destroy?.(); }
    },
  };
}
