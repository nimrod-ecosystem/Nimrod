// color_picker.js — CHOOSING A COLOUR, as one reusable piece.
//
// Mike, 2026-09-28: *"There should also be settings for font, style, and color. We probably want
// some sort of separate color picker module. Selecting colors will come up more. In this case, the
// color picker should be in the settings menu."*
//
// So this file is the piece, and the settings menu is its FIRST user rather than its owner. It is
// three things and nothing else:
//
//   1. A DEFAULT PALETTE, AS DATA. Named colours, because the person choosing may be hearing the
//      choices rather than seeing them: a screen reader or an AAC voice has to say "blue", and
//      "#2f6fe0" said aloud is noise. A name is not decoration on a colour here, it is the colour.
//   2. PURE HELPERS: normalise a hex, find the nearest NAMED colour for any hex, contrast (reused
//      from theme.js, not rewritten — one WCAG implementation in the repo).
//   3. ONE SMALL RENDERER: a row of swatches plus the browser's own `<input type="color">` for a
//      fine choice. As an HTML string (`swatchesHTML`) for surfaces that paint with innerHTML, like
//      the settings menu, and wired (`mountColorPicker`) for anything that just wants a picker.
//
// WHAT IT IS NOT: the switch-operable control. Stepping through colours with one button is the
// settings field's job (`settings_fields.js`, kind `color`), because the one-button contract —
// wrap, never strand — lives there for every kind at once. The swatches here are for a POINTER;
// they are deliberately not cursor stops, so a switch user pays one press for a colour row, not
// twelve.

import { contrast } from './theme.js';

// Re-exported so a caller that is choosing colours has the ratio beside the choices, without
// learning that it lives in the theme file. The SAME function object — asserted by the suite.
export { contrast };

// ---------------------------------------------------------------------------------------
// THE DEFAULT PALETTE. *** A DEFAULT, NOT A RULE (Rule 1). ***
//
// Hard-coding a palette is a taste decision, and the project's rule is that taste is not baked in
// without saying so. So, said: these twelve are a starting point. A field can bring its own
// (`options` on a `color` field), and the day Design supplies a palette it REPLACES THIS DATA —
// nothing else in the repo holds these values.
//
// HOW THEY WERE PICKED, so the next person can re-pick them against the same test rather than by
// eye: every chromatic colour reads at 3:1 or better on the ground of EVERY shipped static theme —
// default (#F7F4D5), contrast (#ffffff), warm (#fbf1e4), forge (#f2f6f6) AND dusk (#12181c) — at
// the same time. That means a relative luminance roughly between 0.13 and 0.30: saturated
// mid-tones. It is why there is no "dark blue" (fails on dusk, 2.67:1) and no bright yellow (fails
// on every light ground); "Gold" is the yellow that survives. 3:1 is WCAG's floor for graphics and
// large text (a swatch, a fill, a name sign) — NOT the 4.5 body-text floor, and it is stated as 3
// so nobody reads it as a promise about small text.
//
// Black and white are NEUTRALS: each reads on the ground it is for and not the other, which is
// what you want from a fill or a text colour you will put on the opposite.
//
// Order is the walk order for a switch: warm to cool round the wheel, then the earth and neutral
// tones, so "next" moves somewhere a person can predict.
// ---------------------------------------------------------------------------------------
const freeze = (list) => Object.freeze(list.map((c) => Object.freeze({ ...c })));

export const DEFAULT_PALETTE = freeze([
  { id: 'red',    name: 'Red',    hex: '#d32f2f' },
  { id: 'orange', name: 'Orange', hex: '#d9660b' },
  { id: 'gold',   name: 'Gold',   hex: '#a87a00' },
  { id: 'green',  name: 'Green',  hex: '#2e7d32' },
  { id: 'teal',   name: 'Teal',   hex: '#00897b' },
  { id: 'blue',   name: 'Blue',   hex: '#2f6fe0' },
  { id: 'purple', name: 'Purple', hex: '#9b4dbf' },
  { id: 'pink',   name: 'Pink',   hex: '#d81b60' },
  { id: 'brown',  name: 'Brown',  hex: '#8d6e63' },
  { id: 'grey',   name: 'Grey',   hex: '#757575' },
  { id: 'black',  name: 'Black',  hex: '#000000' },
  { id: 'white',  name: 'White',  hex: '#ffffff' },
]);

// ---------------------------------------------------------------------------------------
// normalizeHex — every way a colour arrives, one way it is stored: `#rrggbb`, lower case.
//
// Case is folded because "#1D4ED8" and "#1d4ed8" are one colour and must compare equal, or a
// stored value from one surface looks "off the list" to another. ALPHA IS REFUSED, not dropped:
// a half-transparent swatch is a different colour on every background, which is exactly the
// thing a named palette exists to rule out. Anything else is null — never a guess.
// ---------------------------------------------------------------------------------------
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let h = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return `#${h.toLowerCase()}`;
}

function rgb(hex) {
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// "Redmean" weighted distance: plain RGB distance with the channel weights the eye roughly has.
// Good enough to say "that is close to Blue"; this is naming, not colour science.
function distance(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// ---------------------------------------------------------------------------------------
// normalizePalette — a field's own colours, in whatever shape the author wrote.
//
// Accepts `{ id, name, hex }` (this file's shape), `{ value, label }` (the settings-field
// option shape) or a bare hex. A bare hex is NAMED from the default palette, because an
// unnamed swatch is unusable by ear. Garbage is dropped; a duplicate hex keeps the first — a
// duplicate would make the one-switch walk appear to stick, the same reason choice options
// dedupe.
// ---------------------------------------------------------------------------------------
export function normalizePalette(raw) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (c === null || c === undefined) continue;
    const obj = typeof c === 'object';
    const hex = normalizeHex(obj ? (c.hex ?? c.value) : c);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    const given = obj ? (c.name ?? c.label) : null;
    const name = given ? String(given) : (describeColor(hex, DEFAULT_PALETTE) || hex);
    out.push({ id: String((obj && c.id) || hex), name, hex });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// nearestColor — the named entry closest to `hex`, or null.
// ---------------------------------------------------------------------------------------
export function nearestColor(hex, palette = DEFAULT_PALETTE) {
  const h = normalizeHex(hex);
  if (!h) return null;
  let best = null;
  let bestD = Infinity;
  for (const c of palette || []) {
    const ch = normalizeHex(c && c.hex);
    if (!ch) continue;
    if (ch === h) return c;
    const d = distance(h, ch);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------
// describeColor — the words for a colour. On the list: its name. Off it: its nearest name PLUS
// the hex, which is honest that it is not exactly that colour ("Close to Blue (#2f6fe1)").
// Garbage: '' rather than "Close to undefined".
// ---------------------------------------------------------------------------------------
export function describeColor(hex, palette = DEFAULT_PALETTE) {
  const h = normalizeHex(hex);
  if (!h) return '';
  const near = nearestColor(h, palette);
  if (!near) return h;
  return normalizeHex(near.hex) === h ? near.name : `Close to ${near.name} (${h})`;
}

// ---------------------------------------------------------------------------------------
// THE RENDERER.
//
// Swatches carry their colour as a CUSTOM PROPERTY (`--sw`), not as a `background:` literal, so
// the stylesheet stays token-only and a theme can still draw the border and the pressed ring.
// ---------------------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function swatchesHTML({ palette = DEFAULT_PALETTE, value = null, label = 'Colour', attrs = '' } = {}) {
  const cur = normalizeHex(value);
  const list = normalizePalette(palette);
  const buttons = list.map((c) => {
    const on = c.hex === cur;
    return `<button type="button" class="cp-swatch" data-swatch="${esc(c.hex)}" ${attrs}
      style="--sw:${esc(c.hex)}" aria-label="${esc(c.name)}" title="${esc(c.name)}"
      aria-pressed="${on ? 'true' : 'false'}"></button>`;
  }).join('');
  // The native picker holds the exact value when there is one; with none, the first swatch, so
  // it never opens on the browser's arbitrary black.
  const fineValue = cur || list[0]?.hex || '#000000';
  return `<div class="cp-swatches" role="group" aria-label="${esc(label)}">${buttons}
    <label class="cp-fine"><span class="cp-fine-label">Other colour</span>
      <input type="color" data-fine ${attrs} value="${esc(fineValue)}" aria-label="${esc(label)}: any colour"></label>
  </div>`;
}

// ---------------------------------------------------------------------------------------
// mountColorPicker — the same, with the clicks wired, for a surface that just wants a picker.
//
// `onPick(hex, entry)` — `entry` is the palette entry for a swatch, undefined for a fine pick
// (it is not on the list). Reports on `change`, not `input`: the native picker fires `input`
// continuously while somebody drags, and every one of those would be a write.
// ---------------------------------------------------------------------------------------
export function mountColorPicker(el, { palette = DEFAULT_PALETTE, value = null, label = 'Colour', onPick = null } = {}) {
  if (!el) throw new Error('mountColorPicker: an element is required');
  const list = normalizePalette(palette);
  let cur = normalizeHex(value);
  const paint = () => { el.innerHTML = swatchesHTML({ palette: list, value: cur, label }); };
  const ac = new AbortController();
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-swatch]');
    if (!b || !el.contains(b)) return;
    cur = b.dataset.swatch;
    paint();
    onPick?.(cur, list.find((c) => c.hex === cur));
  }, { signal: ac.signal });
  el.addEventListener('change', (e) => {
    if (!e.target.matches?.('[data-fine]')) return;
    const hex = normalizeHex(e.target.value);
    if (!hex) return;
    cur = hex;
    paint();
    onPick?.(hex, undefined);
  }, { signal: ac.signal });
  paint();
  return {
    value: () => cur,
    set(v) { cur = normalizeHex(v); paint(); },
    destroy() { ac.abort(); el.innerHTML = ''; },
  };
}
