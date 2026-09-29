// aac_sets.js — CLAUDE DESIGN'S AAC SYMBOL SETS, and which one a board draws.
//
// Delivered 2026-09-28 (credited in ATTRIBUTIONS.md): the board's 55 words in ten styles. One of
// the ten is the board's own drawings exactly (`aac_symbols.js` — checked word for word on the way
// in), so it is not a new set; it is "the board's own", and it stays the default. The other nine
// are here. The files are in `design-assets/aac/<set>/<word>.svg`; which words each set drew and
// the colours each drawing uses are in `aac_sets_data.js`, generated from the files by
// `tools/build_aac_sets.py` and re-checked against them by `dev/aac_sets_test.html`.
//
// Mike, 2026-09-29: *"Offered as a choice. They should change when you change themes and there
// should be an option to lock them to a single set instead of changing with themes."* So a board
// has ONE setting, `symbols`: its own drawings, one of these sets that follows the theme, or one
// set pinned. This file is the part that answers "which drawing goes on this card".
//
// ---------------------------------------------------------------------------------------
// A SET IS DRAWN FOR A CARD, NOT FOR A THEME — AND THE CARD IS NOT ALWAYS THE THEME'S
// ---------------------------------------------------------------------------------------
//
// Each set is drawn in one colour family for one kind of card: the seven live-theme sets in
// light ink for a dark card, `cozy` in dark ink for a white one, `mono` in black for white.
// Measured against every card this board can draw (see the report of 2026-09-29):
//
//   * the six light-ink sets (fall, steampunk, cyberpunk, winter, ocean, night) clear 3:1
//     on EVERY dark card, the board's own pinned card included (worst 5.18, fall on fall);
//   * cozy and mono clear it on every light card (worst 5.30, cozy on warm);
//   * and every one of them FAILS on the other kind of card (1.07 to 1.66);
//   * `color` clears it on NEITHER. Its lines are the default theme's accent and link and its
//     highlights are the board's own light accents, so on a dark card the 13 words drawn in the
//     link colour (#105666) sit at 1.91, and on a white card the 12 drawn in the light accents sit
//     at 1.91 to 2.71. Seven of those twelve (cold, help, hot, no, pain, stop, yes) fail the same
//     way in the board's own drawings on a white card today; five (bedpan, change, suction,
//     tired, wait) are words the board draws in its ink and Design drew in the amber accent.
//
// The board's card only follows the theme when `followTheme` is on. By default it is pinned dark,
// whatever the theme — so a board that follows the theme's SYMBOLS on a light theme would be
// putting dark drawings on a dark card. Nobody chose that combination; it falls out of two
// settings. So when a set was picked AUTOMATICALLY (following the theme), a drawing that would
// read worse than the board's own drawing of that word on the card it is actually sitting on
// gives way to the board's own, word by word. See `pickSymbol`.
//
// A set somebody PINNED is not second-guessed. That is the same rule the sign's word colour
// follows (`modules/button.js`: a chosen colour wins) and the same one `followTheme` states for
// the board's own colours: the contrast figures stop being guaranteed, and that is the chooser's
// call. The word under every drawing is untouched either way — it carries the meaning; the
// drawing supports it.

import { SET_WORDS } from './aac_sets_data.js';
import { SYMBOLS } from './aac_symbols.js';
import { THEMES, contrast } from './theme.js';

// The same absolute-path convention as the signs and frames (`modules/button.js`), so a page at
// any depth reaches them.
export const AAC_ASSETS = '/design-assets/aac';

// *** 3:1, AND IT IS A FLOOR, NOT A TASTE. *** WCAG 1.4.11's minimum for a graphic that carries
// meaning (the word under it carries the same meaning at 4.5 or better, which is why this is not
// 4.5). It only ever decides an AUTOMATIC fallback — the symbols a board follows the theme into —
// and it is the same number the board's own card edges are held to (modules.css, `.aboard`).
// Not a setting, argued here per Porting Rule 1: nobody benefits from a board automatically
// choosing a drawing they cannot see, and a person who wants a set regardless pins it, which this
// never touches.
export const SYMBOL_MIN_CONTRAST = 3;

// In the order a person choosing one would want to read them: the two general-purpose sets, then
// the live themes in theme.js's own order. `card` says which kind of card the set was drawn for,
// and is shown in the choice so nobody pins a dark-card set onto a light board by accident.
export const SYMBOL_SETS = Object.freeze([
  { id: 'color',     label: 'Colour',     card: 'mixed' },
  { id: 'mono',      label: 'Black line', card: 'light' },
  { id: 'fall',      label: 'Fall',       card: 'dark' },
  { id: 'steampunk', label: 'Steampunk',  card: 'dark' },
  { id: 'cyberpunk', label: 'Cyberpunk',  card: 'dark' },
  { id: 'cozy',      label: 'Cozy',       card: 'light' },
  { id: 'winter',    label: 'Winter',     card: 'dark' },
  { id: 'ocean',     label: 'Aquarium',   card: 'dark' },
  { id: 'night',     label: 'Night',      card: 'dark' },
].filter((s) => SET_WORDS[s.id]));

const BY_ID = Object.fromEntries(SYMBOL_SETS.map((s) => [s.id, s]));

export function symbolSet(id) { return BY_ID[id] || null; }

// *** WHICH SET GOES WITH WHICH THEME. ***
//
// Design drew a set for each of the seven live themes, plus `color` (in the default theme's own
// accent #839958 and link #105666, so it is the default theme's set) and `mono`. Four site themes
// have no set of their own, and each gets the nearest one that READS on that theme's card:
//
//   dusk     -> night  dark and calm, the same family; 8.57 on dusk's card
//   contrast -> mono   black on white, which is what the contrast theme is; 21:1
//   warm     -> cozy   the one light set in warm tones; 5.30 on warm's card
//   forge    -> cozy   light, and cozy's teal is forge's own accent (#14636A); 5.50
//
// A theme added later without a line here follows to NOTHING (the board's own drawings), and
// `dev/aac_sets_test.html` fails until somebody decides — a silent fallback would be the
// board changing under somebody for a reason nobody wrote down.
export const THEME_SETS = Object.freeze({
  default: 'color',
  dusk: 'night',
  contrast: 'mono',
  warm: 'cozy',
  forge: 'cozy',
  fall: 'fall',
  steampunk: 'steampunk',
  cyberpunk: 'cyberpunk',
  cozy: 'cozy',
  winter: 'winter',
  ocean: 'ocean',
  night: 'night',
});

export function setForTheme(themeId) {
  const id = THEME_SETS[themeId || 'default'];
  return id && BY_ID[id] ? id : null;
}

/** Did this set draw this word? A board somebody built can use any symbol name. */
export function setHas(setId, name) {
  return !!(name && SET_WORDS[setId] && Object.prototype.hasOwnProperty.call(SET_WORDS[setId], name));
}

export function symbolUrl(setId, name) {
  return `${AAC_ASSETS}/${encodeURIComponent(setId)}/${encodeURIComponent(name)}.svg`;
}

/** The colours a drawing uses. `currentColor` is returned as-is; the caller knows the ink. */
export function setColours(setId, name) {
  return setHas(setId, name) ? SET_WORDS[setId][name].slice() : [];
}

const OWN_COLOUR = /(?:stroke|fill)\s*=\s*"(#[0-9a-fA-F]{3,8}|currentColor)"/g;
export function ownColours(name) {
  const svg = (name && SYMBOLS[name]) || '';
  const out = [];
  for (const m of svg.matchAll(OWN_COLOUR)) {
    const c = m[1].toLowerCase() === 'currentcolor' ? 'currentColor' : m[1].toLowerCase();
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** The weakest contrast of any colour in a drawing against `bg`, with `currentColor` as `ink`.
 *  A drawing with no colours at all (nothing to see) scores 0. */
export function drawingContrast(colours, bg, ink) {
  if (!bg || !colours.length) return 0;
  let worst = Infinity;
  for (const c of colours) {
    const hex = c === 'currentColor' ? ink : c;
    if (!hex) return 0;
    worst = Math.min(worst, contrast(hex, bg));
  }
  return worst;
}

/**
 * Which drawing goes on a card.
 *
 *   name     the card's symbol name (`cell.symbol`)
 *   setId    the set in force, or null for the board's own
 *   guard    true when the set was chosen AUTOMATICALLY (following the theme) — see the header
 *   bg, ink  the card's fill and ink as #rrggbb, or null when they cannot be measured
 *
 * Returns `{ from: 'set' | 'own' | 'none', setId, contrast }`.
 *
 * PER WORD, and in this order: a word the set did not draw uses the board's own drawing of it;
 * with the guard on, a drawing that reads worse than the board's own on THIS card, and below the
 * floor, uses the board's own; and a card that cannot be measured at all keeps the board's own
 * rather than guessing — unmeasured means "what it was", never "whatever was asked for".
 */
export function pickSymbol({ name, setId = null, guard = false, bg = null, ink = null } = {}) {
  const own = { from: SYMBOLS[name] ? 'own' : 'none', setId: null,
                contrast: drawingContrast(ownColours(name), bg, ink) };
  if (!setId || !setHas(setId, name)) return own;
  const mine = drawingContrast(setColours(setId, name), bg, ink);
  if (guard) {
    if (!bg) return own;
    if (mine < SYMBOL_MIN_CONTRAST && (own.from === 'own' ? mine < own.contrast : false)) return own;
  }
  return { from: 'set', setId, contrast: mine };
}

// ---------------------------------------------------------------------------------------
// WHICH THEME IS ON THE SCREEN
// ---------------------------------------------------------------------------------------
//
// `theme.js`'s `applyTheme` writes a theme as CSS variables on the root and records its id
// nowhere. Rather than change every page that applies a theme, the board reads the theme back
// from the variables it wrote: every theme's `--bg` is different (checked by the suite), and
// `--text` is compared too so a page that sets `--bg` for its own reasons does not read as a
// theme. Nothing applied (a test page, an embed on a page with no theme) reads as null.
export function themeIdFromRoot(root) {
  if (!root || !root.style) return null;
  const bg = root.style.getPropertyValue('--bg').trim().toLowerCase();
  const text = root.style.getPropertyValue('--text').trim().toLowerCase();
  if (!bg) return null;
  for (const [id, t] of Object.entries(THEMES)) {
    if (String(t.vars['--bg']).toLowerCase() === bg
        && String(t.vars['--text']).toLowerCase() === text) return id;
  }
  return null;
}

/** A CSS colour string ("#abc", "rgb(…)", "rgba(…)") as `{ hex, alpha }`, or null. */
export function parseColour(str) {
  const s = String(str || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { hex: '#000000', alpha: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: `#${h.slice(0, 6)}`, alpha };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const to2 = (v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0');
    let alpha = 1;
    if (m[4] != null) alpha = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return { hex: `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`, alpha };
  }
  return null;
}
