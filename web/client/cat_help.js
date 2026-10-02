// cat_help.js — NIMROD AS CONTEXT HELP. Press the cat and he explains whatever is picked.
//
// Mike, 2026-09-30 (room_as_home §7.1.2): *"It tells you about whatever you selected when you click
// on him."* Claude Design, room-add-ons §2: he explains the SELECTED thing — a panel's module, a
// settings row, an object in a room, an edit-window field — and with nothing selected, the screen
// he is on. He moves to the far side of the target and points at it with his paw (`placeGuide`,
// Design's `GuideCat.jsx`, ported below value for value), so his body never covers it. The words
// show in a speech bubble and go to the output bus as `say` (read aloud only where the person's own
// output routing makes `say` speech — the same arrangement as the walk, `cat_guide.js`).
//
//   const help = mountCatHelp(host, { output });
//   help.explain();                 // what is selected on the page, read off the DOM
//   help.explain(scene.describe(id)) // or a selection the host already knows (the room does this)
//
// ---------------------------------------------------------------------------------------
// WHERE THE WORDS COME FROM — nothing here is written twice
// ---------------------------------------------------------------------------------------
//   a module          `modules_catalog.js` — its `lead`, then its `why` (how much of it: the cat's own
//                     chattiness setting, the same one the walk uses); a module the catalog does not
//                     describe falls back to its manifest's `description`.
//   an object         its role in the room (`room_scene.js` `describe()`): a display "holds" a module,
//                     a button says what pressing it does, a label says there is nothing to press.
//   a setting row     the field's own `help`, else its `note` (settings_fields.js), after its name and
//                     what it is set to; the shell's own rows (Full screen, Close) have lines here.
//   anything else     `data-help="…"` on whatever is selected. How an edit window's Transform field,
//                     or any new surface, explains itself without this file learning about it.
//
// ---------------------------------------------------------------------------------------
// THE RULES THE WALK ALREADY KEEPS, KEPT AGAIN (and tested: dev/cat_help_test.html)
// ---------------------------------------------------------------------------------------
//   * HE NEVER APPEARS UNINVITED. Mounting draws nothing; only `explain()` — a press — shows him.
//     *** THE SCAN LANDING ON HIM IS NOT A PRESS. *** Design wrote "press the cat, or scan to him";
//     read literally, an AUTO-scan (the cursor that walks by itself) would summon him on every lap,
//     which is the Clippy failure on a timer. Scanning to him and pressing select is the press.
//   * HE IS ALWAYS DISMISSIBLE: Close, Escape, and by himself after `helpCloseSec`.
//   * HE IS NEVER A GATE (CLAUDE.md: a screen must never enter a state that only an input can
//     leave, when the person in front of it cannot give that input). No scrim, no `aria-modal`, no
//     focus trap: the layer is `pointer-events:none` except the bubble, so everything underneath
//     keeps working while he talks, and nothing waits for him. "Stays until closed" is allowed for
//     that reason — a bubble somebody chose to keep blocks nothing.

import { readCatPrefs, writeCatPrefs, CAT_SOURCE, CHATTINESS, WHERE, HELP_CLOSE_CHOICES, catImageURL,
  catAssetBase, poseToward, CAT_SIZE_PX } from './cat_guide.js';
import { CATALOG, USE } from './modules_catalog.js';
import { getManifest } from './module.js';

export { WHERE, HELP_CLOSE_CHOICES };

// ---------------------------------------------------------------------------------------------
// THE MATHS. Pure, exported, unit-tested.
// ---------------------------------------------------------------------------------------------

/* Where the paw tip sits, as a fraction of the square box (viewBox -4 -4 208 208). Design's. */
export const PAW_TIP = Object.freeze({
  'point-right': [201 / 208, 113 / 208], 'point-left': [7 / 208, 113 / 208],
  'point-up': [166 / 208, 25 / 208], 'point-down': [112 / 208, 201 / 208],
});

const norm = (r) => {
  if (!r) return null;
  const left = Number(r.left) || 0, top = Number(r.top) || 0;
  const width = Number.isFinite(r.width) ? r.width : (Number(r.right) || 0) - left;
  const height = Number.isFinite(r.height) ? r.height : (Number(r.bottom) || 0) - top;
  return { left, top, width, height, right: left + width, bottom: top + height };
};
const clamp = (v, a, b) => (b < a ? a : Math.max(a, Math.min(b, v)));
const box = (left, top, w, h = w) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h });

/** Do two rects share any area? Touching edges do not count. */
export function rectsOverlap(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  return A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom;
}
const within = (r, B) => r.left >= B.left - 0.5 && r.top >= B.top - 0.5 && r.right <= B.right + 0.5 && r.bottom <= B.bottom + 0.5;

/**
 * Design's placeGuide, ported as is. Position a pointing cat of `size` px so its paw tip lands
 * `gap` px off `rect`, on its middle. `direction` is the way he POINTS: 'left' puts him to the
 * right of the target. Returns { left, top, pose }.
 */
export function placeGuide(rect, direction, size = 96, gap = 6) {
  const r = norm(rect);
  const pose = 'point-' + direction;
  const [tx, ty] = PAW_TIP[pose];
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (direction === 'right') return { pose, left: r.left - gap - size * tx, top: cy - size * ty };
  if (direction === 'left') return { pose, left: r.right + gap - size * tx, top: cy - size * ty };
  if (direction === 'up') return { pose, left: cx - size * tx, top: r.bottom + gap - size * ty };
  return { pose, left: cx - size * tx, top: r.top - gap - size * ty };
}

// *** ONE CHANGE FROM DESIGN'S NUMBERS, AND WHY. *** Pointing UP, the paw tip is 25/208 of the box
// below its top edge, so with a 6px gap the box's empty top margin reaches ~5px into the target. The
// drawing does not (the paw is the highest thing in it), but "his body never covers it" should be
// provable from the box, not from knowing the art — so the gap grows until the whole box clears.
function clearGap(direction, size, gap) {
  const [tx, ty] = PAW_TIP['point-' + direction];
  const edge = { left: tx, right: 1 - tx, up: ty, down: 1 - ty }[direction] * size;
  return Math.max(gap, edge + 1);
}

/**
 * Where he sits for a target, inside `bounds`. `where`: 'beside' (point at it from its far side,
 * whichever side has the most room and fits him) or 'corner' (the corner farthest from it, paw
 * turned toward it). No target: a corner, talking. Returns
 * { left, top, size, pose, direction|null, corner, covers } — `covers` is true only when no place
 * on the screen avoids the target (a target that IS the screen), which nothing can fix.
 */
export function placeCat(target, bounds, { size = CAT_SIZE_PX, gap = 6, where = 'beside' } = {}) {
  const B = norm(bounds);
  const T = norm(target);
  const valid = T && T.width > 0 && T.height > 0 ? T : null;
  if (valid && where !== 'corner') {
    // The side he SITS on, by the way he then points: pointing left = sitting to its right.
    const room = { left: B.right - valid.right, right: valid.left - B.left, up: B.bottom - valid.bottom, down: valid.top - B.top };
    const dirs = ['left', 'right', 'up', 'down'].sort((a, b) => room[b] - room[a]);
    for (const d of dirs) {
      const p = placeGuide(valid, d, size, clearGap(d, size, gap));
      let { left, top } = p;
      // Slide along the target's edge to stay on screen; never toward it.
      if (d === 'left' || d === 'right') top = clamp(top, B.top, B.bottom - size);
      else left = clamp(left, B.left, B.right - size);
      const r = box(left, top, size);
      if (within(r, B) && !rectsOverlap(r, valid)) return { left, top, size, pose: p.pose, direction: d, corner: false, covers: false };
    }
  }
  return corner(valid, B, size, gap);
}

function corner(T, B, size, gap) {
  const xs = [clamp(B.right - size - gap, B.left, B.right - size), clamp(B.left + gap, B.left, B.right - size)];
  const ys = [clamp(B.bottom - size - gap, B.top, B.bottom - size), clamp(B.top + gap, B.top, B.bottom - size)];
  // Bottom right first: where a helper conventionally sits, and where he sits when nothing is picked.
  const spots = [[xs[0], ys[0]], [xs[1], ys[0]], [xs[0], ys[1]], [xs[1], ys[1]]].map(([left, top]) => box(left, top, size));
  if (!T) return { left: spots[0].left, top: spots[0].top, size, pose: 'talking', direction: null, corner: true, covers: false };
  const cx = T.left + T.width / 2, cy = T.top + T.height / 2;
  const far = (r) => Math.hypot(r.left + size / 2 - cx, r.top + size / 2 - cy);
  const ranked = spots.slice().sort((a, b) => far(b) - far(a));
  const pick = ranked.find((r) => !rectsOverlap(r, T)) || ranked[0];
  return { left: pick.left, top: pick.top, size, pose: poseToward(pick, T), direction: null, corner: true, covers: rectsOverlap(pick, T) };
}

/**
 * Where the speech bubble goes: beside him on the side away from the target, else above or below
 * him, else a band at the top or bottom of the screen — the first place that stays on screen and
 * covers neither the target nor him (then: not the target). Returns { left, top }.
 */
export function placeBubble(cat, target, bounds, { w = 300, h = 110, gap = 8 } = {}) {
  const B = norm(bounds);
  const T = norm(target);
  const C = box(cat.left, cat.top, cat.size || CAT_SIZE_PX);
  const ccx = C.left + C.width / 2, ccy = C.top + C.height / 2;
  const away = T ? (ccx >= T.left + T.width / 2 ? 1 : -1) : -1;
  const side = (s) => [s > 0 ? C.right + gap : C.left - gap - w, ccy - h / 2];
  const cands = [
    side(away),
    [ccx - w / 2, C.top - gap - h],
    [ccx - w / 2, C.bottom + gap],
    side(-away),
    [B.left + (B.width - w) / 2, B.top + gap],
    [B.left + (B.width - w) / 2, B.bottom - h - gap],
    [B.left + gap, B.top + gap], [B.right - w - gap, B.top + gap],
    [B.left + gap, B.bottom - h - gap], [B.right - w - gap, B.bottom - h - gap],
  ].map(([l, t]) => box(clamp(l, B.left, B.right - w), clamp(t, B.top, B.bottom - h), w, h));
  const hitsT = (r) => !!T && rectsOverlap(r, T);
  const pick = cands.find((r) => !hitsT(r) && !rectsOverlap(r, C)) || cands.find((r) => !hitsT(r)) || cands[0];
  return { left: pick.left, top: pick.top };
}

// ---------------------------------------------------------------------------------------------
// THE WORDS
// ---------------------------------------------------------------------------------------------

const sentences = (text, n) => {
  const s = String(text || '').trim();
  const parts = s.match(/[^.!?]+[.!?]+(?=\s|$)/g);
  if (!parts) return s;
  return parts.slice(0, n).join(' ').replace(/\s+/g, ' ').trim();
};
const chatOf = (c) => (CHATTINESS.some((x) => x.value === c) ? c : 'some');
const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
// "Transport bar" -> "transport bar"; "Word Forge", "AAC board", "YouTube" keep their capitals.
const lowerName = (s) => (/^[A-Z][^A-Z]*$/.test(String(s || '')) ? String(s).toLowerCase() : String(s || ''));

function safeManifest(type) { try { return getManifest(type) || null; } catch { return null; } }

/** A module, from the catalog (or its manifest). { title, text } */
export function explainModule(type, { chat = 'some', catalog = CATALOG, manifest } = {}) {
  const c = chatOf(chat);
  const entry = (catalog || []).find((e) => e && e.type === type) || null;
  const m = manifest === undefined ? safeManifest(type) : manifest;
  const title = entry?.title || m?.title || titleCase(type) || 'This panel';
  if (entry) {
    if (c === 'few') return { title, text: entry.lead };
    if (c === 'some') return { title, text: [entry.lead, sentences(entry.why, 1)].filter(Boolean).join(' ') };
    return { title, text: [entry.lead, entry.why, entry.needs ? `It needs: ${entry.needs}` : '', USE[entry.use]?.hint]
      .filter(Boolean).join(' ') };
  }
  if (m?.description) return { title, text: c === 'few' ? sentences(m.description, 1) : m.description };
  return { title, text: `This is the ${title} panel.` };
}

const ACTION_DOES = {
  'settings.open': 'opens Settings',
  'fullscreen.toggle': 'turns full screen on or off',
  'modules.open': 'opens Modules',
  'dashboards.open': 'opens Dashboards',
};

/** An object in a room (`room_scene.js` describe()). { title, text } */
export function explainObject(d = {}, { chat = 'some', catalog = CATALOG } = {}) {
  const c = chatOf(chat);
  const words = String(d.partLabel || d.label || 'thing').trim().split(/\s+/);
  const thing = (words[words.length - 1] || 'thing').toLowerCase();
  const title = d.label || d.partLabel || 'This';
  const name = lowerName(d.moduleLabel || d.label || d.module || 'panel');
  let lines;
  switch (d.role) {
    case 'display':
      lines = [`This ${thing} holds the ${name}.`, 'Press it to lift it out, flat and full size.'];
      break;
    case 'button': {
      const does = (d.action === 'module.open' && d.module ? `opens the ${lowerName(d.moduleLabel || d.module)}` : ACTION_DOES[d.action])
        || `does “${d.actionLabel || d.label || d.action || 'its job'}”`;
      lines = [`Press this ${thing} and it ${does}.`, 'It is a button, like the ones on the bar.'];
      break;
    }
    case 'keys':
      lines = [`This is a key: ${d.key ?? d.label}.`, `Press it to send ${d.key ?? d.label}.`];
      break;
    case 'pet':
      lines = [`This is ${d.label || 'an animal'}.`, 'Stroke it, or hold the switch on it, to pet it.'];
      break;
    case 'library':
      lines = [`This ${thing} is a library: each book is a module.`, 'Press a book to open it, or press the shelf for the list.'];
      break;
    case 'closeup':
      lines = [`Press the ${thing} to look closer.`, 'Back returns to the whole room, and it goes back by itself after a while.'];
      break;
    default:
      lines = [`This is the ${thing}.`, 'It is here to look at; pressing it does nothing.'];
  }
  if (c === 'few') lines = lines.slice(0, 1);
  if (c === 'lots' && d.module) {
    const entry = (catalog || []).find((e) => e && e.type === d.module);
    if (entry) lines.push(`${entry.title || titleCase(entry.type)}: ${entry.lead}`);
  }
  return { title, text: lines.join(' ') };
}

// The rows the settings menu itself owns (settings.js), which no module field describes.
export const SETTING_ROW_HELP = Object.freeze({
  fullscreen: 'Full screen fills the whole display with this screen, and goes back again.',
  close: 'This closes the menu. Nothing you changed is lost.',
  home: 'This goes back to Home, where screens are chosen.',
  who: 'Who is using this screen right now.',
  'panel-settings': 'The settings of the panel that is picked.',
});

/** A settings row: { label, value, field?, id? }. { title, text } */
export function explainSetting(d = {}, { chat = 'some' } = {}) {
  const c = chatOf(chat);
  const label = d.field?.label || d.label || 'This setting';
  const value = d.value ? String(d.value).trim() : '';
  const first = value ? `${label}: ${value}.` : `${label}.`;
  if (c === 'few') return { title: label, text: first };
  const help = d.field?.help || d.field?.note || SETTING_ROW_HELP[d.id] || '';
  const lines = [first, help, d.disabled ? '' : 'Press it to change it.'];
  if (c === 'lots' && d.field?.why && d.field.why !== help) lines.push(`(${d.field.why})`);
  return { title: label, text: lines.filter(Boolean).join(' ') };
}

// What he says with nothing picked. Site copy: never "her screen" (CLAUDE.md, 2026-09-11).
export const SCREEN_HELP = Object.freeze({
  kiosk: 'This is the screen. Each panel on it is a module. Pick a panel, then press me, and I will tell you what it does.',
  room: 'This is a room, and its furniture can hold the screen’s controls. Rest the pointer on a thing, or scan to it, then press me and I will tell you what it is.',
  settings: 'This is the settings menu. Each row is one setting, and pressing a row changes it. Move to a row, then press me to hear what it does.',
  page: 'Pick something on this page, then press me, and I will tell you what it is.',
});
const SCREEN_TITLE = { kiosk: 'This screen', room: 'This room', settings: 'Settings', page: 'This page' };

export function explainScreen(key = 'page', { chat = 'some' } = {}) {
  const k = SCREEN_HELP[key] ? key : 'page';
  const text = chatOf(chat) === 'few' ? sentences(SCREEN_HELP[k], 1) : SCREEN_HELP[k];
  return { title: SCREEN_TITLE[k], text };
}

/** Anything selected -> { title, text }. An explicit `help` on the selection wins. */
export function explain(sel, opts = {}) {
  if (!sel) return explainScreen(opts.screen || 'page', opts);
  if (sel.help) return { title: sel.title || sel.label || 'Nimrod', text: String(sel.help) };
  switch (sel.kind) {
    case 'module': return explainModule(sel.type, { ...opts, manifest: sel.manifest });
    case 'object': return explainObject(sel, opts);
    case 'setting': return explainSetting(sel, opts);
    case 'screen': return explainScreen(sel.screen, opts);
    default: return explainScreen(opts.screen || 'page', opts);
  }
}

// ---------------------------------------------------------------------------------------------
// WHAT IS SELECTED — read off the page the way the page already marks it. Nothing guessed.
// ---------------------------------------------------------------------------------------------

function defaultFieldLookup(type, key) {
  const m = safeManifest(type);
  let decls = m?.settings;
  if (typeof decls === 'function') { try { decls = decls(); } catch { decls = null; } }
  return Array.isArray(decls) ? decls.find((d) => d && d.key === key) || null : null;
}

const shownEl = (el) => !!el && !el.closest('[hidden]');
const SELECTED = '[aria-current="true"], [aria-selected="true"], [data-focused], .is-scan';

/**
 * What is selected on the page, in this order:
 *   1. the cursor row of an OPEN settings menu (`.st-item.on`) — the overlay menu, or a settings
 *      panel that is itself the focused panel; its field is looked up on the focused panel's module;
 *   2. anything selected that carries `data-help` (an edit-window field, a book on a shelf…);
 *   3. the focused panel (`.k-cell[data-focused]`, arrangement.js) — its module;
 *   4. nothing: the screen.
 */
export function selectionFrom(doc = (typeof document !== 'undefined' ? document : null), {
  scope = null, fieldLookup = defaultFieldLookup,
} = {}) {
  const root = scope || doc;
  if (!root?.querySelectorAll) return null;
  const focusedCell = [...root.querySelectorAll('.k-cell[data-focused]')].find(shownEl) || null;
  const panelType = focusedCell?.getAttribute('data-kind') || null;

  const row = [...root.querySelectorAll('.st-item.on, .st-item[aria-current="true"]')]
    .find((r) => shownEl(r) && (!r.closest('.k-cell') || r.closest('.k-cell') === focusedCell));
  if (row) {
    const id = row.getAttribute('data-id') || null;
    const key = id && id.startsWith('set:') ? id.slice(4) : null;
    let field = null;
    if (key && panelType) { try { field = fieldLookup?.(panelType, key) || null; } catch { field = null; } }
    return {
      kind: 'setting', id, key, field, el: row,
      label: row.querySelector('.st-label')?.textContent.trim() || row.textContent.trim(),
      value: row.querySelector('.st-hint')?.textContent.trim() || '',
      disabled: row.disabled === true,
      help: row.getAttribute('data-help') || null,
    };
  }

  const active = doc?.activeElement || null;
  const helped = [...root.querySelectorAll('[data-help]')].find((el) => shownEl(el)
    && (el.matches(SELECTED) || (active && active !== doc.body && el.contains(active))));
  if (helped) return { kind: 'help', help: helped.getAttribute('data-help'), el: helped, title: helped.getAttribute('aria-label') || null };

  if (focusedCell && panelType) return { kind: 'module', type: panelType, el: focusedCell };

  const kiosk = root.closest?.('.kiosk') || root.querySelector('.kiosk');
  const room = root.closest?.('[data-room]') || root.querySelector('[data-room]');
  return { kind: 'screen', screen: kiosk ? 'kiosk' : room ? 'room' : 'page' };
}

// ---------------------------------------------------------------------------------------------
// *** WHAT IS UNDER THE POINTER (or the scan cursor) — "Hover over anything and Nimrod tells you what
// it does" (Mike, 2026-10-02; Kontakt's info pane). *** `selectionFrom` above answers "what is SELECTED
// on this page"; this answers "what is THIS element", from the element up, with the same words
// (`explain`) — so the bubble, the guide's info pane and the page's status line can never describe one
// thing two ways. In this order, nearest first:
//   1. `data-help` on it or an ancestor (an edit-window field, a guide choice, anything that says itself);
//   2. a settings row (`.st-item`): the field, looked up on the menu's subject (the focused panel's type);
//   3. a room object (`.rs-obj-wrap` / `.rs-obj`, room_scene.js): its role and its label;
//   4. a control that names itself (a bar button's `title`, an `aria-label` longer than its text);
//   5. a panel (`.k-cell[data-kind]`): its module, from the catalog;
//   6. a starting-point card on Home (`.ex-card`): its title and blurb;
//   7. a bare button or link: its own words.
// Null for anything that is none of these (empty space, the page's own prose): the caller keeps what it
// last said rather than saying "this is a div".
// ---------------------------------------------------------------------------------------------
const textOf = (el) => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
export function selectionAt(target, { fieldLookup = defaultFieldLookup } = {}) {
  let el = target || null;
  if (el && el.nodeType !== 1) el = el.parentElement || null;
  if (!el?.closest || el.closest('[data-hover-ignore]')) return null;

  const helped = el.closest('[data-help]');
  const row = el.closest('.st-item');
  // A row inside something that explains itself more closely wins; otherwise the nearer of the two.
  if (helped && (!row || row.contains(helped))) {
    return { kind: 'help', help: helped.getAttribute('data-help'), el: helped,
      title: helped.getAttribute('data-help-title') || helped.getAttribute('aria-label') || textOf(helped).slice(0, 60) || null };
  }
  if (row) {
    const id = row.getAttribute('data-id') || null;
    const key = id && id.startsWith('set:') ? id.slice(4) : null;
    const scope = row.closest('.kiosk') || row.ownerDocument;
    const focused = scope?.querySelector?.('.k-cell[data-focused]') || null;
    const panelType = row.closest('.k-cell[data-kind]')?.getAttribute('data-kind') || focused?.getAttribute('data-kind') || null;
    let field = null;
    if (key && panelType) { try { field = fieldLookup?.(panelType, key) || null; } catch { field = null; } }
    return {
      kind: 'setting', id, key, field, el: row,
      label: row.querySelector('.st-label')?.textContent.trim() || textOf(row),
      value: row.querySelector('.st-hint')?.textContent.trim() || '',
      disabled: row.disabled === true,
      help: row.getAttribute('data-help') || null,
    };
  }
  const obj = el.closest('.rs-obj-wrap, .rs-obj');
  if (obj) {
    const wrap = obj.closest('.rs-obj-wrap') || obj;
    const btn = wrap.querySelector?.('.rs-obj') || obj;
    const label = btn.getAttribute?.('aria-label') || wrap.getAttribute?.('aria-label') || '';
    return { kind: 'object', id: wrap.dataset?.id || null, role: wrap.dataset?.role || null,
      label: label.split(':')[0].trim() || 'thing', el: wrap };
  }
  const control = el.closest('button, a[href], [role="button"], [role="tab"], select, input');
  if (control) {
    const name = textOf(control) || control.getAttribute('aria-label') || control.getAttribute('value') || '';
    const says = control.getAttribute('title') || '';
    const aria = control.getAttribute('aria-label') || '';
    if (says || (aria && aria !== name)) {
      return { kind: 'help', el: control, title: name || aria || 'This button', help: says || aria };
    }
  }
  const cell = el.closest('.k-cell[data-kind]');
  if (cell) return { kind: 'module', type: cell.getAttribute('data-kind'), el: cell };
  const card = el.closest('.ex-card');
  if (card) {
    return { kind: 'help', el: card, title: card.querySelector('h3')?.textContent.trim() || 'A starting point',
      help: [card.querySelector('.ex-kind')?.textContent.trim(), card.querySelector('p')?.textContent.trim()].filter(Boolean).join(': ') };
  }
  if (control) {
    const name = textOf(control) || control.getAttribute('value') || '';
    if (name) return { kind: 'help', el: control, title: name, help: `A button: “${name}”. Press it to do that.` };
  }
  return null;
}

/** The words for whatever `el` is ({ title, text, sel }), or null when it is nothing describable. */
export function explainAt(el, { chat = 'some', fieldLookup = defaultFieldLookup } = {}) {
  const sel = selectionAt(el, { fieldLookup });
  if (!sel) return null;
  return { ...explain(sel, { chat, screen: 'page' }), sel };
}

// ---------------------------------------------------------------------------------------------
// HIM
// ---------------------------------------------------------------------------------------------

const hasStorage = () => typeof localStorage !== 'undefined';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * Mount him on `root` (the panel or page he may stand in). Draws NOTHING until `explain()`.
 *   output        the page's output bus; his words go to its `say` (as `CAT_SOURCE`)
 *   screen        what "nothing selected" means here: 'kiosk' | 'room' | 'settings' | 'page', or a
 *                 function returning one; default: worked out from the page
 *   getSelection  () -> a selection, when the host knows better than the DOM (the room does)
 *   onShow / onClose(reason)   the room hides its own cat while he is out
 */
export function mountCatHelp(root, {
  doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  storage = (hasStorage() ? localStorage : null),
  output = null,
  screen = null,
  getSelection = null,
  fieldLookup = defaultFieldLookup,
  size = CAT_SIZE_PX,
  gap = 6,
  assetBase = catAssetBase(),
  reducedMotion = null,
  onShow = null,
  onClose = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!root || !doc) return null;
  let prefs = readCatPrefs(storage);
  let layer = null, figure = null, bubble = null;
  let current = null;           // { sel, words }
  let pose = null;
  let placement = null;
  let timer = null;
  let lastSaid = null;
  let destroyed = false;
  void reducedMotion;           // his still drawings are used throughout: nothing here moves

  const fixed = root === doc.body || root === doc.documentElement;

  function hush() {
    if (lastSaid != null) { try { output?.cancel?.(lastSaid); } catch { /* already said */ } }
    lastSaid = null;
  }
  function speak(text) {
    hush();
    if (!prefs.speak || !text || typeof output?.say !== 'function') return;
    try { lastSaid = output.say(text, { source: CAT_SOURCE }); } catch (err) { console.error('cat help: say', err); }
  }
  function arm() {
    if (timer != null) { clearTimer(timer); timer = null; }
    if (!layer || !(prefs.helpCloseSec > 0)) return;
    timer = setTimer(() => { timer = null; close('rested'); }, prefs.helpCloseSec * 1000);
  }
  const onKey = (e) => {
    if (!layer || e.key !== 'Escape') return;
    // Topmost first: Escape closes him, not also the menu under him.
    e.stopPropagation();
    e.preventDefault();
    close('escape');
  };

  function teardown() {
    if (timer != null) { clearTimer(timer); timer = null; }
    hush();
    doc.removeEventListener('keydown', onKey, true);
    layer?.remove();
    layer = figure = bubble = null;
    placement = null;
    pose = null;
  }

  function close(reason = 'close') {
    if (!layer) return false;
    teardown();
    current = null;
    try { onClose?.(reason); } catch (err) { console.error('cat help: onClose', err); }
    return true;
  }

  function screenKey() {
    try { return (typeof screen === 'function' ? screen() : screen) || null; } catch { return null; }
  }

  function targetRect(sel) {
    let r = sel?.rect || null;
    if (!r && sel?.el?.getBoundingClientRect) { try { r = sel.el.getBoundingClientRect(); } catch { r = null; } }
    r = norm(r);
    return r && r.width > 0 && r.height > 0 ? r : null;
  }

  function setPose(p) {
    pose = p;
    if (!figure) return;
    figure.dataset.pose = p;
    const img = doc.createElement('img');
    img.src = catImageURL(p, false, assetBase);
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;display:block';
    figure.replaceChildren(img);
  }

  function render(sel, words, actions = []) {
    teardown();
    layer = doc.createElement('div');
    layer.setAttribute('data-cat-help', '');
    layer.style.cssText = `position:${fixed ? 'fixed' : 'absolute'};inset:0;pointer-events:none;z-index:9000;overflow:hidden`;
    figure = doc.createElement('div');
    figure.setAttribute('data-cat-help-figure', '');
    figure.setAttribute('aria-hidden', 'true');   // decoration: the words are the content
    figure.className = 'nimrod-cat';
    figure.style.cssText = `position:absolute;width:${size}px;height:${size}px;pointer-events:none`;
    bubble = doc.createElement('div');
    bubble.setAttribute('data-cat-help-bubble', '');
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-live', 'polite');
    bubble.setAttribute('aria-label', 'Nimrod explains');
    bubble.style.cssText = [
      'position:absolute', 'box-sizing:border-box', 'width:min(42ch, calc(100% - 16px))', 'pointer-events:auto',
      'background:rgba(10,51,35,.96)', 'color:#e8f0ea', 'border:1px solid rgba(255,255,255,.22)',
      'border-radius:14px', 'padding:12px 14px', 'box-shadow:0 10px 40px rgba(0,0,0,.45)', 'font:inherit',
    ].join(';');
    const btn = 'flex:0 0 auto;background:transparent;color:#cfe0d6;border:1px solid rgba(255,255,255,.28);'
      + 'border-radius:9px;padding:8px 12px;font:inherit;cursor:pointer;min-height:44px';
    const primary = 'flex:0 0 auto;background:#F7C948;color:#0A3323;border:0;border-radius:9px;'
      + 'padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;min-height:44px';
    const lvl = CHATTINESS.find((c) => c.value === prefs.chat) || CHATTINESS[1];
    const wh = WHERE.find((w) => w.value === prefs.where) || WHERE[0];
    // THE WAY OUT FIRST, in the DOM and so in any scan: Close.
    bubble.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <button type="button" data-cat-help-close data-scan style="${primary}">Close</button>
        <button type="button" data-cat-help-chat data-scan style="${btn}" title="How much Nimrod says. Press to change.">Words: ${esc(lvl.label)}</button>
        <button type="button" data-cat-help-where data-scan style="${btn}" title="Where Nimrod sits. Press to change.">Sits: ${esc(wh.label)}</button>
      </div>
      <b data-cat-help-title style="display:block">${esc(words.title)}</b>
      <p data-cat-help-say style="margin:4px 0 0">${esc(words.text)}</p>`;
    bubble.querySelector('[data-cat-help-close]').addEventListener('click', () => close('close'));
    // A host's own actions, after Close (the way out stays first). The room offers "Pet Nimrod" here, so
    // a ONE-switch user can pet him too: press him (help), then this — no hold binding needed. The
    // bubble closes first, so the room's own cat is back before he is petted.
    const row = bubble.firstElementChild;
    for (const a of actions) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.setAttribute('data-cat-help-action', a.id);
      b.setAttribute('data-scan', '');
      b.style.cssText = btn;
      b.textContent = a.label;
      b.addEventListener('click', () => { close('action'); try { a.run(); } catch (err) { console.error('cat help: action', err); } });
      row.insertBefore(b, row.children[1] || null);
    }
    bubble.querySelector('[data-cat-help-chat]').addEventListener('click', () => {
      const i = CHATTINESS.findIndex((c) => c.value === prefs.chat);
      setPrefs({ chat: CHATTINESS[(i + 1) % CHATTINESS.length].value });
    });
    bubble.querySelector('[data-cat-help-where]').addEventListener('click', () => {
      const i = WHERE.findIndex((w) => w.value === prefs.where);
      setPrefs({ where: WHERE[(i + 1) % WHERE.length].value });
    });
    bubble.addEventListener('pointerdown', () => arm());
    layer.append(figure, bubble);
    root.append(layer);
    doc.addEventListener('keydown', onKey, true);

    // Placement, in the layer's own coordinates (so a host that is not positioned still works).
    const L = norm(layer.getBoundingClientRect());
    const bounds = box(0, 0, L.width, L.height);
    const t = targetRect(sel);
    const T = t ? box(t.left - L.left, t.top - L.top, t.width, t.height) : null;
    const cat = placeCat(T, bounds, { size, gap, where: prefs.where });
    figure.style.left = `${cat.left}px`;
    figure.style.top = `${cat.top}px`;
    setPose(cat.pose);
    const bw = bubble.getBoundingClientRect();
    const b = placeBubble(cat, T, bounds, { w: bw.width || 300, h: bw.height || 110, gap: 8 });
    bubble.style.left = `${b.left}px`;
    bubble.style.top = `${b.top}px`;
    placement = { cat, bubble: b, target: T };
    speak(words.text);
    arm();
    try { onShow?.({ sel, words }); } catch (err) { console.error('cat help: onShow', err); }
  }

  /** Explain the selection (or what is selected on the page). Null when cat help is off.
      `actions`: [{ id, label, run }] — extra buttons in the bubble, after Close. */
  function explainNow(sel = null, { actions = [] } = {}) {
    if (destroyed) return null;
    prefs = readCatPrefs(storage);
    if (!prefs.help) return null;
    let s = sel;
    if (!s && typeof getSelection === 'function') { try { s = getSelection() || null; } catch { s = null; } }
    if (!s) s = selectionFrom(doc, { scope: root === doc.body ? doc : root, fieldLookup });
    const sk = screenKey();
    const words = explain(s, { chat: prefs.chat, screen: sk || (s?.kind === 'screen' ? s.screen : 'page') });
    const acts = (Array.isArray(actions) ? actions : []).filter((a) => a && a.id && a.label && typeof a.run === 'function');
    render(s, words, acts);    // a second press replaces the first: one cat at a time
    current = { sel: s, words, actions: acts };
    return { ...words, sel: s };
  }

  function setPrefs(patch = {}) {
    prefs = writeCatPrefs(storage, patch);
    if (layer && current && ('chat' in patch || 'where' in patch)) {
      const words = explain(current.sel, { chat: prefs.chat, screen: screenKey() || 'page' });
      current = { ...current, sel: current.sel, words };
      render(current.sel, words, current.actions || []);
    } else if (layer) arm();
    return { ...prefs };
  }

  return {
    explain: explainNow,
    close: () => close('close'),
    shown: () => !!layer,
    el: () => layer,
    pose: () => pose,
    placement: () => placement,
    words: () => (current ? { ...current.words } : null),
    prefs: () => ({ ...prefs }),
    setPrefs,
    lastSaid: () => lastSaid,
    destroy() {
      if (destroyed) return;
      const was = !!layer;
      teardown();
      destroyed = true;
      current = null;
      if (was) { try { onClose?.('destroy'); } catch { /* host gone */ } }
    },
  };
}
