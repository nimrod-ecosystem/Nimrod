// shared_settings.js — A MODULE'S SETTINGS ARE THE MODULE'S, NOT ONE DASHBOARD'S (row 2.189; Mike, 2026-11-26).
//
// Mike: "When editing something, it shouldn't be dashboard specific. That could be an option. You should be editing the
// module." Before this, every panel kept its settings on its own row, one per dashboard, so a Trivia set up on the
// kitchen dashboard started from scratch on the bedroom one. Now a module's declared settings are kept ONCE PER PERSON
// (the person the screen is for), one row per module type (`module-<type>`, makePersonState), and every panel of that
// type on that person's screens reads them. "Just this panel" (OWN_FLAG on the panel's own row) is the option.
//
// HOW (a layer over the panel's handle, so no module changes; it reads `ctx.state.get()` as it always has):
//   get()   the shared row, then the panel's own row over it (a value the panel set itself still wins, so nothing anybody
//           sees changes the day this lands: no silent migration, row 2.189 point 3).
//   set()   a SHARED key goes to the shared row, and is cleared from the panel's own row so the panel follows it from
//           then on; every other key (what it is showing now, where it is, a key kept with the panel) to the panel's
//           own row. With "Just this panel" on, everything goes to the panel's own row, as before.
//
// WHAT IS NEVER SHARED (argued in proposal_shared_settings_20261102.md, Goldfish-checked):
//   * a module whose manifest says `shareSettings: false` (the AAC board: its access settings describe the body and
//     the switch at THAT screen, so a tablet with no switch must not inherit scanning);
//   * a key a manifest lists in `keepWithPanel`, or a declaration with `keepWithPanel: true`;
//   * a secret (`secret: true`), which is kept somewhere else anyway;
//   * a key that names something on ONE device (DEVICE_KEY_RE below: a camera, a microphone, a speaker, a folder, a
//     device), unless its declaration says `shared: true`. Argued as a pattern, not a list per module: FOR, a new
//     module's "Camera" row is kept with the panel without anybody remembering to mark it; AGAINST, a pattern can
//     catch a key that should be shared ("speakerVolume"), which `shared: true` answers. The suite lists what it keeps.
// A screen with nobody's name on it has no shared row: its panels keep their own, as before (the account level is not
// stored yet; plan_edit_the_module_20261126.md).

export const OWN_FLAG = '__ownSettings';
export const sharedRowKey = (type) => `module-${type}`;
export const DEVICE_KEY_RE = /(device|camera|microphone|^mic[A-Z_]|folder|speaker|playOn|path$)/i;

const isSet = (v) => v !== undefined && v !== null;

/** The declared settings keys of a manifest that are shared (see above). PURE. */
export function shareableKeys(manifest) {
  if (!manifest || manifest.shareSettings === false) return new Set();
  let decls = manifest.settings;
  if (typeof decls === 'function') { try { decls = decls(); } catch { decls = []; } }
  const keep = new Set(Array.isArray(manifest.keepWithPanel) ? manifest.keepWithPanel : []);
  const out = new Set();
  for (const d of Array.isArray(decls) ? decls : []) {
    if (!d || typeof d.key !== 'string' || !d.key || d.key === OWN_FLAG) continue;
    if (keep.has(d.key) || d.keepWithPanel === true || d.secret === true) continue;
    if (DEVICE_KEY_RE.test(d.key) && d.shared !== true) continue;
    out.add(d.key);
  }
  return out;
}

/**
 * `base` (the panel's handle) with the person's shared row `shared` under it. `keys`: the shared keys (shareableKeys).
 * `shared` may be null (no person): then this is `base` with `own()` / `setOwn()` / `sharedState()` added.
 */
// `dashboard()`: the dashboard's own "every <module> panel" values (kiosk.js typeDefaults), which sit ABOVE the shared row
// (the dashboard-specific option is the more specific one). A key the dashboard sets is written to the panel's own row,
// never the shared one: a shared write there would be hidden under the dashboard's value and look like a press that did
// nothing (screen_controls_test found it).
export function withSharedLayer(base, shared, { keys = new Set(), dashboard = () => null } = {}) {
  if (!base || typeof base.get !== 'function') return base;
  const ownRow = () => (typeof base.own === 'function' ? base.own() : base.get()) || {};
  const justThis = () => ownRow()[OWN_FLAG] === true;
  const active = () => !!shared && keys.size > 0 && !justThis();
  const dashSets = (k) => { try { const d = dashboard(); return !!d && isSet(d[k]); } catch { return false; } };
  const goesShared = (k) => keys.has(k) && !dashSets(k);
  const merged = () => {
    const mine = base.get() || {};
    if (!active()) return mine;
    const s = shared.get() || {};
    const out = { ...mine };
    for (const k of keys) if (!isSet(mine[k]) && isSet(s[k])) out[k] = s[k];
    return out;
  };
  const offs = new Set();
  return Object.assign({}, base, {
    get: merged,
    own: ownRow,
    /** Where a write of `key` lands now: 'shared' or 'panel'. */
    landsOn: (key) => (active() && goesShared(key) ? 'shared' : 'panel'),
    shared: () => (shared ? shared.get() || {} : null),
    hasShared: () => !!shared && keys.size > 0,
    justThisPanel: justThis,
    set(patch = {}) {
      if (!patch || typeof patch !== 'object') return base.set?.(patch);
      // Turning "Just this panel" on keeps what the panel shows: the shared values it was following become its own.
      if (patch[OWN_FLAG] === true && active()) {
        const s = shared.get() || {}, mine = ownRow();
        const copy = {};
        for (const k of keys) if (!isSet(mine[k]) && isSet(s[k])) copy[k] = s[k];
        return base.set?.({ ...copy, ...patch });
      }
      if (!active()) return base.set?.(patch);
      const sp = {}, op = {};
      const mine = ownRow();
      for (const [k, v] of Object.entries(patch)) {
        if (goesShared(k)) { sp[k] = v; if (isSet(mine[k])) op[k] = null; }   // the panel follows the shared value now
        else op[k] = v;
      }
      if (Object.keys(sp).length) shared.set(sp);
      return Object.keys(op).length ? base.set?.(op) : undefined;
    },
    /** Write the panel's own row, whatever the shared row says ("Just this panel", and the host's own keys). */
    setOwn: (patch) => base.set?.(patch),
    // Told on a change of either row, with the merged row (the panel's handle calls a new subscriber at once, and so
    // this does, through it).
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      const call = () => { try { fn(merged()); } catch (err) { console.error('shared settings: a subscriber', err); } };
      const a = base.subscribe?.(() => call());
      const b = shared?.subscribe?.(() => { if (active()) call(); });
      const off = () => { try { a?.(); } catch { /* gone */ } try { b?.(); } catch { /* gone */ } offs.delete(off); };
      offs.add(off);
      return off;
    },
    load: () => Promise.all([base.load?.() ?? null, shared?.load?.()?.catch?.(() => {}) ?? null]).then(() => undefined),
    flush: () => Promise.all([base.flush?.() ?? null, shared?.flush?.() ?? null]).then(() => undefined),
    destroy() {
      for (const off of [...offs]) off();
      try { shared?.destroy?.(); } catch { /* gone */ }
      return base.destroy?.();
    },
  });
}
