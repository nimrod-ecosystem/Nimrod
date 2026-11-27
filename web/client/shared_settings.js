// shared_settings.js — A MODULE'S SETTINGS ARE THE MODULE'S, NOT ONE DASHBOARD'S (row 2.189; Mike, 2026-11-26).
//
// Mike: "When editing something, it shouldn't be dashboard specific. That could be an option. You should be editing the
// module." Before this, every panel kept its settings on its own row, one per dashboard, so a Trivia set up on the
// kitchen dashboard started from scratch on the bedroom one. Now a module's declared settings are kept ONCE PER PERSON
// (the person the screen is for), one row per module type (`module-<type>`, makePersonState), and every panel of that
// type on that person's screens reads them. "Just this panel" (OWN_FLAG on the panel's own row) is the option.
// (Mike, 2026-11-26, both guesses confirmed: per person, not per account; the AAC board shares nothing.)
//
// HOW (a layer over the panel's handle, so no module changes; it reads `ctx.state.get()` as it always has):
//   get()   the shared row, then the panel's own row over it (a value the panel set itself still wins, so nothing anybody
//           sees changes the day this lands: no silent migration, row 2.189 point 3).
//   set()   a SHARED key goes to the shared row, and is cleared from the panel's own row so the panel follows it from
//           then on; every other key (what it is showing now, where it is, a key kept with the panel) to the panel's
//           own row. With "Just this panel" on, everything goes to the panel's own row, as before.
//
// *** SETUPS: "SAVE AS" (Mike, 2026-11-26: "When editing modules, there should be a save as option, so people can have
// different setups if they want.") *** Beside the main set, a person may keep NAMED setups of a module ("Bedtime",
// "Big and slow"), each its own row (`module-<type>~<id>`, setupRowKey), listed on the main row (SETUPS_KEY). A panel
// follows the main setup, one named setup (SETUP_KEY on its own row), or just itself. "Save as a new setup" copies what
// the panel shows now into a new setup and the panel follows it from then on, so nothing it shows changes at the press.
// Argued both ways: FOR a named setup over "Just this panel", two panels (the bedroom's and the kitchen's evening clock)
// can share a second setup without either being the main one; AGAINST, it is one more thing to explain, so it is a
// choice on the same row that already says where a panel's settings are kept, not a new place. A key a setup has not
// set reads the main setup's (a setting a module gains later is not blank in an old setup). Taking a setup off the list
// leaves its row on the server (nothing is deleted); a panel that followed it follows the main setup again.
// Hosts write VIRTUAL keys and the layer does the rest, so the ⚙ menu, the editor and edit mode need no code of their own:
//   SETUP_FROM_KEY   'main' | <setup id> | 'panel'   (read and written)    SETUP_NAME_KEY  the followed setup's name
//   SAVE_AS_KEY      a name, or '' for "Setup 2"...  (written only)        FORGET_SETUP_KEY a setup id to take off the list
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
// stored yet; plan_edit_the_module_20261126.md). Setups need the shared row too, so it has none.

export const OWN_FLAG = '__ownSettings';
export const SETUP_KEY = '__setup';
export const SETUPS_KEY = '__setups';
export const SETUP_FROM_KEY = '__settingsFrom';
export const SETUP_NAME_KEY = '__setupName';
export const SAVE_AS_KEY = '__saveAs';
export const FORGET_SETUP_KEY = '__forgetSetup';
const VIRTUAL = [SETUP_FROM_KEY, SETUP_NAME_KEY, SAVE_AS_KEY, FORGET_SETUP_KEY];
export const sharedRowKey = (type) => `module-${type}`;
export const setupRowKey = (type, id) => `module-${type}~${id}`;
export const DEVICE_KEY_RE = /(device|camera|microphone|^mic[A-Z_]|folder|speaker|playOn|path$)/i;
/** A setup's name: words, trimmed, at most this long (a name is a label on a row, not a note). */
export const SETUP_NAME_MAX = 40;

const isSet = (v) => v !== undefined && v !== null;
const cleanName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, SETUP_NAME_MAX);

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

/** The setups listed on a main row: [{ id, name }], well-formed ones only. PURE. */
export function setupsOf(row) {
  const l = row && row[SETUPS_KEY];
  if (!Array.isArray(l)) return [];
  const seen = new Set();
  const out = [];
  for (const e of l) {
    if (!e || typeof e.id !== 'string' || !e.id || seen.has(e.id) || e.id === 'main' || e.id === 'panel') continue;
    seen.add(e.id);
    out.push({ id: e.id, name: cleanName(e.name) || 'A setup' });
  }
  return out;
}

/**
 * The rows a host shows for where a panel's settings are kept (raw settings_fields declarations, for normalizeField):
 * the choice (main setup, each named setup, just this panel) and, while a named setup is followed, its name.
 * [] where there is no shared set. "The usual" level (standard): chosen once, by whoever sets the screen up.
 */
export function setupFields(state, title = 'This module') {
  try {
    if (!state?.hasShared?.()) return [];
    const list = state.setups?.() || [];
    const cur = state.currentSetup?.() || null;
    const fields = [{ key: SETUP_FROM_KEY, label: `${title} settings`, kind: 'choice', level: 'standard', default: 'main',
      options: [{ value: 'main', label: `Main setup, shared with every ${title} panel` },
        ...list.map((s) => ({ value: s.id, label: `Setup: ${s.name}` })),
        { value: 'panel', label: 'Just this panel' }],
      note: 'A setup is shared by every panel that uses it, on every screen of this person’s. Just this panel: only this one.' }];
    if (cur) fields.push({ key: SETUP_NAME_KEY, label: 'This setup’s name', kind: 'text', level: 'standard', default: '',
      maxLength: SETUP_NAME_MAX });
    return fields;
  } catch { return []; }
}

/**
 * `base` (the panel's handle) with the person's shared row `shared` under it. `keys`: the shared keys (shareableKeys).
 * `shared` may be null (no person): then this is `base` with `own()` / `setOwn()` / `sharedState()` added.
 * `openSetup(id)`: a handle on a named setup's row (counted by the host, like `shared`), or null; without it there are
 * no named setups (Save as does nothing).
 */
// `dashboard()`: the dashboard's own "every <module> panel" values (kiosk.js typeDefaults), which sit ABOVE the shared row
// (the dashboard-specific option is the more specific one). A key the dashboard sets is written to the panel's own row,
// never the shared one: a shared write there would be hidden under the dashboard's value and look like a press that did
// nothing (screen_controls_test found it).
export function withSharedLayer(base, shared, { keys = new Set(), dashboard = () => null, openSetup = null } = {}) {
  if (!base || typeof base.get !== 'function') return base;
  const ownRow = () => (typeof base.own === 'function' ? base.own() : base.get()) || {};
  const justThis = () => ownRow()[OWN_FLAG] === true;
  const hasShared = () => !!shared && keys.size > 0;
  const active = () => hasShared() && !justThis();
  const dashSets = (k) => { try { const d = dashboard(); return !!d && isSet(d[k]); } catch { return false; } };
  const goesShared = (k) => keys.has(k) && !dashSets(k);
  const list = () => (shared ? setupsOf(shared.get() || {}) : []);
  const wantedId = () => {
    if (!hasShared() || typeof openSetup !== 'function') return null;
    const id = ownRow()[SETUP_KEY];
    return typeof id === 'string' && list().some((s) => s.id === id) ? id : null;
  };

  // The named setup this panel follows, open while it follows it (rebound when its choice or the list changes).
  const subs = new Set();
  let quiet = 0;   // a count: an at-once call from a handle being subscribed is not passed on (nested in a rebind too)
  let cur = { id: null, h: null, off: null };
  const fire = () => {
    if (quiet > 0) return;
    let row;
    try { row = merged(); } catch { return; }
    for (const fn of [...subs]) { try { fn(row); } catch (err) { console.error('shared settings: a subscriber', err); } }
  };
  const close = () => {
    try { cur.off?.(); } catch { /* gone */ }
    try { cur.h?.destroy?.(); } catch { /* gone */ }
    cur = { id: null, h: null, off: null };
  };
  function rebind() {
    const id = wantedId();
    if (id === cur.id) return;
    close();
    if (!id) return;
    let h = null;
    try { h = openSetup(id); } catch (err) { console.error('shared settings: a setup row', err); h = null; }
    if (!h) return;
    cur = { id, h, off: null };
    quiet += 1;
    try { cur.off = h.subscribe?.(() => { if (active()) fire(); }) || null; } finally { quiet -= 1; }
    try { h.load?.()?.catch?.(() => {}); } catch { /* it reads what it has */ }
  }
  // Wired once, on the first subscriber: the panel's row (its choice can change the setup followed) and the main row (its
  // list can). Their own at-once calls are not passed on: `subscribe` calls the new subscriber itself.
  let wired = null;
  function wire() {
    if (wired) return;
    quiet += 1;
    let a = null, b = null;
    try {
      a = base.subscribe?.(() => { rebind(); fire(); }) || null;
      b = shared?.subscribe?.(() => { rebind(); fire(); }) || null;
    } finally { quiet -= 1; }
    wired = () => { try { a?.(); } catch { /* gone */ } try { b?.(); } catch { /* gone */ } };
  }
  const setupRow = () => { rebind(); return cur.h ? cur.h.get() || {} : null; };
  /** Where a shared write goes now: the followed setup's row, else the main one. */
  const target = () => { rebind(); return cur.h || shared; };

  function merged() {
    const mine = base.get() || {};
    if (!hasShared()) return mine;
    const out = { ...mine };
    if (active()) {
      const s = shared.get() || {};
      const u = setupRow();
      for (const k of keys) {
        if (isSet(mine[k])) continue;
        if (u && isSet(u[k])) out[k] = u[k];
        else if (isSet(s[k])) out[k] = s[k];
      }
    }
    const id = justThis() ? null : (rebind(), cur.id);
    out[SETUP_FROM_KEY] = justThis() ? 'panel' : (id || 'main');
    out[SETUP_NAME_KEY] = id ? (list().find((s) => s.id === id)?.name || '') : '';
    return out;
  }

  // The shared values this panel shows now, as a patch (what "Just this panel" and "Save as" keep).
  const showing = () => {
    const m = merged(), mine = ownRow(), out = {};
    for (const k of keys) if (goesShared(k) && isSet(m[k])) out[k] = m[k];
    return { all: out, mine };
  };
  // The panel's own values of the keys it will follow from now on, cleared (choosing a setup is choosing to follow it).
  const followPatch = () => {
    const mine = ownRow(), out = {};
    for (const k of keys) if (goesShared(k) && isSet(mine[k])) out[k] = null;
    return out;
  };

  function useFrom(v) {
    if (!hasShared()) return undefined;
    if (v === 'panel') {
      if (justThis()) return undefined;
      const { all, mine } = showing();
      const copy = {};
      for (const [k, val] of Object.entries(all)) if (!isSet(mine[k])) copy[k] = val;
      return base.set?.({ ...copy, [OWN_FLAG]: true, [SETUP_KEY]: null });
    }
    const id = v === 'main' || v == null || v === '' ? null : String(v);
    if (id && !list().some((s) => s.id === id)) return undefined;
    return base.set?.({ ...followPatch(), [OWN_FLAG]: null, [SETUP_KEY]: id });
  }

  function saveAs(name) {
    if (!hasShared() || typeof openSetup !== 'function') return null;
    const l = list();
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const nm = cleanName(name) || `Setup ${l.length + 2}`;
    const { all } = showing();
    let h = null;
    try { h = openSetup(id); } catch (err) { console.error('shared settings: a new setup row', err); h = null; }
    if (!h) return null;
    try { h.set?.(all); } catch (err) { console.error('shared settings: a new setup', err); }
    shared.set({ [SETUPS_KEY]: [...(Array.isArray(shared.get()?.[SETUPS_KEY]) ? shared.get()[SETUPS_KEY] : []), { id, name: nm }] });
    base.set?.({ ...followPatch(), [OWN_FLAG]: null, [SETUP_KEY]: id });
    rebind();
    try { h.destroy?.(); } catch { /* the panel's own handle on it stays open */ }
    return id;
  }

  function renameCurrent(name) {
    const id = justThis() ? null : (rebind(), cur.id);
    const nm = cleanName(name);
    if (!id || !nm) return;
    const raw = Array.isArray(shared.get()?.[SETUPS_KEY]) ? shared.get()[SETUPS_KEY] : [];
    shared.set({ [SETUPS_KEY]: raw.map((e) => (e && e.id === id ? { ...e, name: nm } : e)) });
  }

  function forget(id) {
    if (!hasShared() || typeof id !== 'string' || !id) return;
    const raw = Array.isArray(shared.get()?.[SETUPS_KEY]) ? shared.get()[SETUPS_KEY] : [];
    shared.set({ [SETUPS_KEY]: raw.filter((e) => !(e && e.id === id)) });
    // This panel followed it: it follows the main setup again (the list no longer names it), its own row says so.
    if (ownRow()[SETUP_KEY] === id) base.set?.({ [SETUP_KEY]: null });
    rebind();
  }

  return Object.assign({}, base, {
    get: merged,
    own: ownRow,
    /** Where a write of `key` lands now: 'shared' (the main or the followed setup's row) or 'panel'. */
    landsOn: (key) => (active() && goesShared(key) ? 'shared' : 'panel'),
    shared: () => (shared ? shared.get() || {} : null),
    hasShared,
    justThisPanel: justThis,
    /** The named setups of this module for this person: [{ id, name }]. */
    setups: list,
    /** The named setup this panel follows: { id, name }, or null (the main setup, or just this panel). */
    currentSetup: () => {
      if (justThis()) return null;
      rebind();
      return cur.id ? list().find((s) => s.id === cur.id) || null : null;
    },
    saveAs,
    // (plan A5, 2026-11-26) NO SILENT MIGRATION, SAID: the shared keys this panel still has values of its own for, while it
    // follows a shared set (a value set before settings were shared, or by a host that wrote its row). Those win over the
    // shared set, so a change made elsewhere does not show here; the editor says so, with one press to follow instead.
    ownDiffers: () => {
      if (!active()) return [];
      const mine = ownRow();
      return [...keys].filter((k) => goesShared(k) && isSet(mine[k]));
    },
    /** Follow the shared set for every key this panel kept its own value of (ownDiffers). True when something changed. */
    followShared: () => {
      if (!active()) return false;
      const p = followPatch();
      if (!Object.keys(p).length) return false;
      base.set?.(p);
      return true;
    },
    set(patch = {}) {
      if (!patch || typeof patch !== 'object') return base.set?.(patch);
      patch = { ...patch };
      // The virtual keys first (see SETUPS above); a patch of nothing else is done here.
      const v = {};
      for (const k of VIRTUAL) if (k in patch) { v[k] = patch[k]; delete patch[k]; }
      let res;
      if (SAVE_AS_KEY in v) saveAs(v[SAVE_AS_KEY]);
      if (FORGET_SETUP_KEY in v) forget(v[FORGET_SETUP_KEY]);
      if (SETUP_FROM_KEY in v) res = useFrom(v[SETUP_FROM_KEY]);
      if (SETUP_NAME_KEY in v) renameCurrent(v[SETUP_NAME_KEY]);
      if (!Object.keys(patch).length) return Object.keys(v).length ? Promise.resolve(res) : base.set?.(patch);
      // Turning "Just this panel" on keeps what the panel shows: the shared values it was following become its own.
      if (patch[OWN_FLAG] === true && active()) {
        const { all, mine } = showing();
        const copy = {};
        for (const [k, val] of Object.entries(all)) if (!isSet(mine[k])) copy[k] = val;
        return base.set?.({ ...copy, ...patch, [SETUP_KEY]: null });
      }
      // ...and turning it off is choosing to follow again: its own values of the shared keys go, so it does (the old
      // toggle left them, and they kept winning, so "Share with every <module> panel" changed nothing on screen).
      if (patch[OWN_FLAG] === false && hasShared() && justThis()) {
        return base.set?.({ ...followPatch(), ...patch });
      }
      if (!active()) return base.set?.(patch);
      const sp = {}, op = {};
      const mine = ownRow();
      for (const [k, val] of Object.entries(patch)) {
        if (goesShared(k)) { sp[k] = val; if (isSet(mine[k])) op[k] = null; }   // the panel follows the shared value now
        else op[k] = val;
      }
      if (Object.keys(sp).length) target().set(sp);
      return Object.keys(op).length ? base.set?.(op) : undefined;
    },
    /** Write the panel's own row, whatever the shared row says ("Just this panel", and the host's own keys). */
    setOwn: (patch) => base.set?.(patch),
    // Told on a change of the panel's row, the main row or the followed setup's row, with the merged row (called at once
    // too, as the panel's handle calls a new subscriber).
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      wire();
      try { fn(merged()); } catch (err) { console.error('shared settings: a subscriber', err); }
      return () => { subs.delete(fn); };
    },
    load: () => Promise.all([base.load?.() ?? null, shared?.load?.()?.catch?.(() => {}) ?? null]).then(() => { rebind(); }),
    flush: () => Promise.all([base.flush?.() ?? null, shared?.flush?.() ?? null, cur.h?.flush?.() ?? null]).then(() => undefined),
    destroy() {
      try { wired?.(); } catch { /* gone */ }
      wired = null;
      subs.clear();
      close();
      try { shared?.destroy?.(); } catch { /* gone */ }
      return base.destroy?.();
    },
  });

}
