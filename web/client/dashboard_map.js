// dashboard_map.js — THE MAP OF A PERSON'S DASHBOARDS (row 2.38): every dashboard a node, every door
// (`opens`) and every frame (`shows`) an arrow, cycles included.
//
// Mike, 2026-09-30: *"We'll need some sort of map editor in general I guess, to map out your dashboards
// and anything else ... A map would just be another sort of customizable dashboard where the scene
// objects open different dashboards."*
//
// This file is the DATA and the DRAWING, no DOM: `edit_windows.js` `mountMapWindow` puts it in a window
// (in the edit view, and on its own from `system/map`). What is here:
//
//   dashboardLinks(...)   one dashboard's outgoing arrows, read from what is saved: its placed modules'
//                         `opens`, its room objects' `opens` (room_doors.js), its dashboard panels' `shows`
//   buildMapGraph(list)   nodes + edges; a target that is not in the list becomes a node marked `missing`
//   mapListForm(graph)    THE SAME GRAPH AS A LIST, one entry per dashboard with a sentence saying what it
//                         opens, what it shows and what reaches it -- what a screen reader reads, and what
//                         a switch walks (the drawing is a picture of this list, never the only copy)
//   mapLayout(graph)      where each node sits: a circle, in list order (home first)
//   mapSvg(graph, ...)    the picture, as an SVG string -- theme tokens only, solid vs dashed (not colour
//                         alone) for opens vs shows, a loop for a dashboard that opens itself
//   loadMapData(...)      reads all of the above from the server, through whatever handles the host has
//
// *** KEPT SIMPLE ON PURPOSE, FOR A PI 400 (Design's budget: "one live scene"). *** A static SVG drawn
// once per open: no force layout, no animation, no live re-layout. A circle reads every cycle as a
// cycle (A -> B -> A is two arrows bowing opposite ways), which a tree layout cannot do, and costs a few
// hundred nodes of DOM for ten dashboards. Past `MAP_DRAW_MAX` dashboards the picture would be unreadable
// at 1920x1080, so the window shows the list alone and says so.

import { recipeItemIds, sceneRecipe } from './room_doors.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const OPENS = 'opens';
export const SHOWS = 'shows';
/** Module types that draw another dashboard inside themselves (modules/view.js: `dashboard`, alias `view`). */
export const SHOWING_TYPES = Object.freeze(['dashboard', 'view']);

// =====================================================================================================
// SETTING-SHAPED NUMBERS. Each is a default (Rule 1), argued:
//   MAP_DRAW_MAX 16: at 1920x1080 a circle of 16 boxes 180 units wide is the most that keeps each name on
//     one readable line; beyond it the list (always there) is the map. FOR more: a family with 20 rooms
//     still gets a picture. AGAINST: a picture of overlapping boxes is worse than none. Per call.
//   MAP_NAME_CHARS 18: the most characters a node box holds at the drawing's size; the list has the rest.
// =====================================================================================================
export const MAP_DEFAULTS = Object.freeze({ drawMax: 16, nameChars: 18, width: 1000, height: 640, boxW: 190, boxH: 60 });

const target = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A room object's name from its recipe item (the light rule; room_scene.js `objectName` is the full one). */
export function itemName(it) {
  if (!it) return 'Object';
  if (typeof it.label === 'string' && it.label.trim()) return it.label.trim();
  const raw = String(it.part || it.kind || it.id || 'object');
  const words = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Object';
}

/**
 * One dashboard's arrows, from what is saved:
 *   record   the screen record `{ id, name, modules: [{ id, type }] }`
 *   layout   its `settings.kiosk.layout` (placed entries carry `opens`; `scene` a room whose objects may)
 *   shows    `{ moduleId: dashboardId }` for its dashboard panels
 *   recipe   the room's recipe when the layout names only a preset (optional; room_doors.js `sceneRecipe`)
 *   title    `(type) => name` for a module (optional)
 * Returns `[{ kind, to, via: { kind: 'module' | 'object', id, name } }]`.
 */
export function dashboardLinks({ record = null, layout = null, shows = {}, recipe = null, title = (t) => t } = {}) {
  const out = [];
  const mods = new Map(((record && record.modules) || []).filter((m) => m && m.id).map((m) => [m.id, m]));
  const modName = (id) => { const m = mods.get(id); return m ? String(title(m.type) || m.type || 'Module') : 'Module'; };
  for (const e of (layout && Array.isArray(layout.placed) ? layout.placed : [])) {
    const to = target(e && e.opens);
    if (to && e.id) out.push({ kind: OPENS, to, via: { kind: 'module', id: e.id, name: modName(e.id) } });
  }
  const r = recipe || (layout && layout.scene && layout.scene.kind === 'room' && layout.scene.recipe) || null;
  if (r && Array.isArray(r.items)) {
    const ids = recipeItemIds(r);
    r.items.forEach((it, i) => {
      if (!it || it.kind === 'module') return;
      const to = target(it.opens);
      if (to) out.push({ kind: OPENS, to, via: { kind: 'object', id: ids[i], name: itemName(it) } });
    });
  }
  for (const [mid, sid] of Object.entries(shows || {})) {
    const to = target(sid);
    if (to && mods.has(mid)) out.push({ kind: SHOWS, to, via: { kind: 'module', id: mid, name: modName(mid) } });
  }
  return out;
}

/**
 * The graph. `list`: `[{ id, name, links }]` (links from `dashboardLinks`), in the order to draw them.
 * Returns `{ nodes: [{ id, name, missing }], edges: [{ from, to, kind, via }] }`. Every link is an edge,
 * a dashboard's link to itself included (a hall of mirrors), and a target not in the list is a node of its
 * own, `missing: true` -- a door to a dashboard that was removed is drawn, not hidden.
 */
export function buildMapGraph(list = []) {
  const nodes = [];
  const seen = new Map();
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || !d.id || seen.has(d.id)) continue;
    const n = { id: d.id, name: target(d.name) || 'Dashboard', missing: false };
    seen.set(d.id, n); nodes.push(n);
  }
  const edges = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || !d.id) continue;
    for (const l of Array.isArray(d.links) ? d.links : []) {
      if (!l || !target(l.to) || (l.kind !== OPENS && l.kind !== SHOWS)) continue;
      if (!seen.has(l.to)) {
        const n = { id: l.to, name: 'A dashboard that is gone', missing: true };
        seen.set(l.to, n); nodes.push(n);
      }
      edges.push({ from: d.id, to: l.to, kind: l.kind, via: l.via ? { ...l.via } : null });
    }
  }
  return { nodes, edges };
}

/** Is there a way round from `id` back to itself? (For the list's wording, and a suite.) */
export function inCycle(graph, id) {
  const out = new Map();
  for (const e of graph.edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); }
  const stack = [...(out.get(id) || [])];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (n === id) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) || []));
  }
  return false;
}

const joinWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * THE LIST FORM: one entry per node, in node order, each with a plain sentence. What a screen reader
 * reads and what the switch walks; the picture is drawn FROM this, so the two cannot disagree.
 *   { id, name, missing, here, opens: [...], shows: [...], from: [...], sentence }
 */
export function mapListForm(graph, { current = null } = {}) {
  const name = new Map(graph.nodes.map((n) => [n.id, n.name]));
  return graph.nodes.map((n) => {
    const out = graph.edges.filter((e) => e.from === n.id);
    const into = graph.edges.filter((e) => e.to === n.id && e.from !== n.id);
    const say = (e) => {
      const to = e.to === n.id ? 'itself' : name.get(e.to);
      const via = e.via && e.via.name ? ` (${e.kind === SHOWS ? 'in' : 'by'} its ${e.via.name.toLowerCase()})` : '';
      return `${to}${via}`;
    };
    const opens = out.filter((e) => e.kind === OPENS);
    const shows = out.filter((e) => e.kind === SHOWS);
    const parts = [];
    if (n.missing) parts.push('Removed: a door still points here, and pressing it does nothing.');
    if (opens.length) parts.push(`Opens ${joinWords(opens.map(say))}.`);
    if (shows.length) parts.push(`Shows ${joinWords(shows.map(say))}.`);
    const fromNames = [...new Set(into.map((e) => name.get(e.from)))];
    if (fromNames.length) parts.push(`Reached from ${joinWords(fromNames)}.`);
    if (!opens.length && !shows.length && !fromNames.length && !n.missing) parts.push('Nothing opens it, and it opens nothing.');
    return {
      id: n.id, name: n.name, missing: n.missing, here: n.id === current,
      opens: opens.map((e) => ({ to: e.to, name: name.get(e.to), via: e.via })),
      shows: shows.map((e) => ({ to: e.to, name: name.get(e.to), via: e.via })),
      from: into.map((e) => ({ from: e.from, name: name.get(e.from), kind: e.kind })),
      sentence: parts.join(' '),
    };
  });
}

/** Node centres on a circle, in node order, the first at the top. `{ id: { x, y } }`. */
export function mapLayout(graph, opts = {}) {
  const c = { ...MAP_DEFAULTS, ...opts };
  const n = graph.nodes.length;
  const out = {};
  const cx = c.width / 2, cy = c.height / 2;
  if (n === 1) { out[graph.nodes[0].id] = { x: cx, y: cy }; return out; }
  // Room above the top box and below the bottom one for a dashboard's loop to itself (mapSvg).
  const rx = c.width / 2 - c.boxW / 2 - 20, ry = c.height / 2 - c.boxH / 2 - 100;
  graph.nodes.forEach((node, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out[node.id] = { x: Math.round(cx + rx * Math.cos(a)), y: Math.round(cy + ry * Math.sin(a)) };
  });
  return out;
}

// Where the segment from a box's centre toward (tx, ty) leaves the box.
function exitPoint(cx, cy, tx, ty, hw, hh) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}
const r1 = (v) => Math.round(v * 10) / 10;
const clip = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/**
 * The picture, as an SVG string (`aria-hidden`: the list is what is read). Opens = a solid arrow, shows =
 * a dashed one, each pair of dashboards' arrows bowing to opposite sides so A -> B and B -> A are both
 * seen; a dashboard that opens or shows itself gets a loop above it. `current` is marked by a thicker
 * edge AND the words "You are here"; a removed one by a dashed box AND "(removed)". Theme tokens only
 * (dashboard_map.css), never a literal colour.
 */
export function mapSvg(graph, { current = null, ...opts } = {}) {
  const c = { ...MAP_DEFAULTS, ...opts };
  const pos = mapLayout(graph, c);
  const hw = c.boxW / 2, hh = c.boxH / 2;
  const groups = new Map();
  for (const e of graph.edges) {
    const k = `${e.from}\u0000${e.to}\u0000${e.kind}`;
    if (!groups.has(k)) groups.set(k, { ...e, count: 0 });
    groups.get(k).count++;
  }
  const paths = [];
  for (const g of groups.values()) {
    const a = pos[g.from], b = pos[g.to];
    if (!a || !b) continue;
    const cls = `dm-edge dm-${g.kind}`;
    const mark = `url(#dm-arrow)`;
    if (g.from === g.to) {
      // The loop goes on the OUTSIDE of the circle (above a node in the top half, below one in the
      // bottom half), where no arrow from another dashboard arrives.
      const down = a.y > c.height / 2 ? 1 : -1;
      const lift = g.kind === SHOWS ? 26 : 0;
      const sx = a.x - 24, ex = a.x + 24, sy = a.y + down * hh, top = a.y + down * (hh + 70 + lift);
      paths.push(`<path class="${cls}" d="M${sx} ${sy} C${sx - 40} ${top} ${ex + 40} ${top} ${ex} ${sy}" marker-end="${mark}"><title>${esc(g.kind)} ${g.count}</title></path>`);
      continue;
    }
    // Bow to the LEFT of the direction of travel, so the return arrow (the other direction) bows the
    // other way; a `shows` arrow bows further, so opens and shows between the same two never overlap.
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bow = g.kind === SHOWS ? 70 : 38;
    const qx = mx + (-dy / len) * bow, qy = my + (dx / len) * bow;
    const s = exitPoint(a.x, a.y, qx, qy, hw, hh);
    const t = exitPoint(b.x, b.y, qx, qy, hw + 6, hh + 6);
    paths.push(`<path class="${cls}" d="M${r1(s.x)} ${r1(s.y)} Q${r1(qx)} ${r1(qy)} ${r1(t.x)} ${r1(t.y)}" marker-end="${mark}"><title>${esc(g.kind)} ${g.count}</title></path>`);
  }
  const boxes = graph.nodes.map((n) => {
    const p = pos[n.id];
    const here = n.id === current;
    const cls = `dm-node${here ? ' is-here' : ''}${n.missing ? ' is-missing' : ''}`;
    const sub = here ? 'You are here' : n.missing ? '(removed)' : '';
    return `<g class="${cls}" data-map-node="${esc(n.id)}" transform="translate(${p.x} ${p.y})">`
      + `<rect x="${-hw}" y="${-hh}" width="${c.boxW}" height="${c.boxH}" rx="12"/>`
      + `<text class="dm-name" y="${sub ? -4 : 6}" text-anchor="middle">${esc(clip(n.name, c.nameChars))}</text>`
      + (sub ? `<text class="dm-sub" y="18" text-anchor="middle">${esc(sub)}</text>` : '')
      + '</g>';
  }).join('');
  return `<svg class="dm-svg" viewBox="0 0 ${c.width} ${c.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">`
    + '<defs><marker id="dm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">'
    + '<path class="dm-head" d="M0 0 L10 5 L0 10 z"/></marker></defs>'
    + `<g class="dm-edges">${paths.join('')}</g><g class="dm-nodes">${boxes}</g></svg>`;
}

/**
 * READ IT ALL. The host hands in its own handles, so this works signed in, signed out and in a suite:
 *   list()            -> [{ id, name }]          the person's dashboards (profiles.list)
 *   get(id)           -> { id, name, modules }   one screen record (profiles.get)
 *   readRow(id, key)  -> {}                      one state row: 'settings', or a module's own
 *   title(type)       -> string                  optional, a module's name
 * Resolves `{ graph, list }`. A dashboard that will not load is still a node (with no arrows): the map
 * says where things are even when one of them is not answering.
 */
/**
 * A `load()` for the Map window from the handles every host has: the screens client and a maker of state
 * handles for ANY dashboard (`makeRow(pid, key)` -> a state handle; opened, read once, closed).
 */
export function mapLoader({ profiles, makeRow, title } = {}) {
  const readRow = async (pid, key) => {
    const h = makeRow(pid, key);
    try { await h?.load?.(); return { ...((h?.get?.()) || {}) }; }
    finally { try { h?.destroy?.(); } catch { /* gone */ } }
  };
  return () => loadMapData({
    list: async () => (typeof profiles?.list === 'function' ? (await profiles.list()) || [] : []),
    get: (id) => profiles.get(id), readRow, title,
  });
}

export async function loadMapData({ list, get, readRow, title } = {}) {
  let rows = [];
  try { rows = (await list()) || []; } catch { rows = []; }
  const out = await Promise.all(rows.filter((d) => d && d.id).map(async (d) => {
    let rec = null, settings = {};
    try { rec = await get(d.id); } catch { rec = null; }
    try { settings = (await readRow(d.id, 'settings')) || {}; } catch { settings = {}; }
    const layout = (settings.kiosk && settings.kiosk.layout) || null;
    const shows = {};
    const showing = ((rec && rec.modules) || []).filter((m) => m && SHOWING_TYPES.includes(m.type));
    await Promise.all(showing.map(async (m) => {
      try { const row = (await readRow(d.id, m.id)) || {}; if (target(row.shows)) shows[m.id] = target(row.shows); } catch { /* no arrow */ }
    }));
    const recipe = layout && layout.scene ? sceneRecipe(layout.scene) : null;
    return { id: d.id, name: d.name || rec?.name, links: dashboardLinks({ record: rec, layout, shows, recipe, title }) };
  }));
  return { graph: buildMapGraph(out), list: rows };
}
