// dashboard_copy.js — "SAVE AS A NEW DASHBOARD": a copy of a dashboard as it shows now. Row 2.109.
//
// Mike, 2026-10-18: *"There should be an option to save/update the dashboard, as well as save as."* "Save this dashboard"
// writes the switches made since it was saved (arrangement.js); this makes a NEW dashboard of what is showing, so the one
// it came from stays as it was saved. What is copied:
//   * every panel, AS IT SHOWS NOW: a panel switched to another module (saved or not) is that module in the copy, with
//     the settings it has there (its `<id>--<type>` row, arrangement.js `stateKey`); a panel not switched, its own row;
//   * the dashboard's own settings (its layout, look, theme, ...), with every panel id in them changed to the copy's;
//   * NOT its remembered switches (the copy's panels already are what they showed), and NOT a ready-made dashboard's
//     stamp (dashboards.js PREBUILT_*): the copy is the person's own, and "finish setting it up" must not rebuild it.
// A step that fails leaves what was already made (a half copy can be deleted on the Dashboards page) and says so.

const DROP_KEYS = ['panelSwitches', 'prebuilt', 'prebuiltRefs', 'prebuiltDone'];

async function withDoc(handle, fn) {
  await Promise.resolve(handle?.load?.()).catch(() => {});
  try {
    const out = await fn(handle);
    await Promise.resolve(handle?.flush?.()).catch(() => {});
    return out;
  } finally { try { handle?.destroy?.(); } catch { /* gone */ } }
}

/** A copy of `doc` with every whole-string occurrence of an old id replaced by its new one (keys and values). PURE. */
export function remapIds(doc, idMap) {
  const walk = (v) => {
    if (typeof v === 'string') return Object.prototype.hasOwnProperty.call(idMap, v) ? idMap[v] : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[Object.prototype.hasOwnProperty.call(idMap, k) ? idMap[k] : k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(doc);
}

/** The name a copy gets: "<name> copy", or "copy 2", "copy 3" when that is taken. No brackets: a screen's name is letters,
 *  digits, spaces and . , ' - (the server's NAME_RE), at most 64 long. PURE. */
export function copyName(name, taken = []) {
  const base = (String(name || 'Dashboard').replace(/[^\w .,'\u2019-]/g, ' ').replace(/\s+copy(?: \d+)?$/i, '').replace(/\s+/g, ' ').trim() || 'Dashboard').slice(0, 52);
  const used = new Set((taken || []).map((n) => String(n || '').toLowerCase()));
  let n = `${base} copy`;
  for (let i = 2; used.has(n.toLowerCase()) && i < 100; i++) n = `${base} copy ${i}`;
  return n;
}

/**
 * Make the copy. `modules`: the panels as they show now ([{ id, type, stateKey? }], arrangement.js `profile().modules`).
 * `makeSettings(pid)`, `makeInstanceState(pid, key)`: state handles. Returns { ok, id, name } or { ok:false, reason }.
 */
export async function copyDashboard({ profiles, makeSettings, makeInstanceState, fromId, modules, name = '', personId = null } = {}) {
  if (!profiles || typeof profiles.create !== 'function' || typeof profiles.addModule !== 'function') return { ok: false, reason: 'no-profiles' };
  if (typeof makeSettings !== 'function' || typeof makeInstanceState !== 'function' || !fromId) return { ok: false, reason: 'no-state' };
  let taken = [];
  try { taken = ((await profiles.list?.()) || []).map((p) => p && p.name); } catch { taken = []; }
  const finalName = String(name || '').trim() || copyName((await profiles.get?.(fromId).catch?.(() => null))?.name, taken);
  let dest;
  try { dest = await profiles.create(finalName, personId || undefined); } catch (err) { return { ok: false, reason: String(err?.message || err) }; }
  const idMap = {};
  for (const m of Array.isArray(modules) ? modules : []) {
    if (!m || !m.id || !m.type) continue;
    try {
      const mod = await profiles.addModule(dest.id, m.type);
      idMap[m.id] = mod.id;
      const from = m.stateKey || m.id;
      const row = await withDoc(makeInstanceState(fromId, from), (h) => ({ ...(h?.get?.() || {}) }));
      if (Object.keys(row).length) await withDoc(makeInstanceState(dest.id, mod.id), (h) => { h.set(row); });
    } catch (err) { console.error('dashboard copy: a panel', err); }
  }
  try {
    const doc = await withDoc(makeSettings(fromId), (h) => ({ ...(h?.get?.() || {}) }));
    for (const k of DROP_KEYS) delete doc[k];
    const next = remapIds(doc, idMap);
    await withDoc(makeSettings(dest.id), (h) => { h.set(next); });
  } catch (err) { return { ok: false, reason: `the copy was made but its settings were not: ${String(err?.message || err)}`, id: dest.id, name: finalName }; }
  return { ok: true, id: dest.id, name: finalName };
}
