// card_deck.js — THE SITE'S SIDE OF DESIGN'S PLAYING CARDS: which deck a theme wears, the two settings, and
// the theme watched so the cards change when it does.
//
// `playing_cards.js` is Claude Design's file (2026-10-10 handoff, cards-and-theme-checklist) and ships AS IT IS:
// `cardSvg(card, theme, options)` draws any card in any of Design's 21 decks. This file is everything the site
// adds around it, kept out of Design's file so the next handoff can replace it without a merge:
//
//   * WHICH DECK. A site theme id (theme.js THEMES) -> the Design deck id. Design calls the default theme
//     'nimrod'; the site calls it 'default'. The four still themes Design has not drawn (dusk, contrast, warm,
//     forge) wear the Nimrod deck, which is Design's own fallback in `cardSvg`. That borrowing is named in
//     dev/theme_surfaces_test.html's known gaps, not hidden here.
//   * THE TWO SETTINGS, each a row any card game declares (`cardSettingsFields`), with Design's defaults:
//       cardLayout   'big' (one huge rank and suit, readable across a room) | 'classic' (the usual pips)
//       suitColours  'four' (hearts red, diamonds blue, clubs green, spades ink) | 'two' (red and black)
//   * KLONDIKE'S CARDS ({ s: 'H', r: 12, up }) turned into Design's ({ rank: 'Q', suit: 'hearts' }).
//   * THE ART MADE SAFE TO REPEAT ON A PAGE:
//       - aria-hidden: the card game's own element carries the name a screen reader reads ("queen of
//         hearts", klondike.js `cardName`, which is also what is said aloud). Leaving Design's role="img" and
//         label on the drawing inside it would read every card twice.
//       - the back's pattern id made unique per mount. Design uses `nc-<theme>` for every back of a theme so
//         many backs on one page share one pattern, and that holds inside one panel. Across panels it does
//         not: Chrome draws nothing for `url(#id)` when the FIRST element with that id sits inside a
//         `display:none` subtree (a hidden kiosk page with the same game on it), so every later back would
//         go blank. One suffix per mount keeps sharing inside a panel and none across.
//   * WHICH THEME IS ON SCREEN, read back from the CSS variables `applyTheme` wrote (aac_sets.js
//     `themeIdFromRoot`, the board's reader, not a second copy), on the nearest element up from the panel
//     that carries them: a panel wearing its own theme gets its own deck. Watched with a MutationObserver on
//     that chain's `style` attributes, because `applyTheme` writes there whoever picked the theme and on
//     whatever device.

import { cardSvg, cardThemes } from './playing_cards.js';
import { themeIdFromRoot } from './aac_sets.js';
import { SUITS, RANK_LABEL } from './klondike.js';

export const CARD_DEFAULTS = Object.freeze({ cardLayout: 'big', suitColours: 'four' });
export const CARD_LAYOUTS = Object.freeze(['big', 'classic']);
export const SUIT_COLOURS = Object.freeze(['four', 'two']);

/** The settings rows a card game declares. Both 'standard': how the cards look, not whether the game works. */
export function cardSettingsFields({ level = 'standard' } = {}) {
  return [
    { key: 'cardLayout', label: 'Card faces', kind: 'choice', default: CARD_DEFAULTS.cardLayout, level,
      options: [
        { value: 'big', label: 'Big: one large number and suit, easy to read from across a room' },
        { value: 'classic', label: 'Classic: the usual rows of suit marks' },
      ],
      note: 'Picture cards and the corner of every card look the same either way.' },
    { key: 'suitColours', label: 'Suit colours', kind: 'choice', default: CARD_DEFAULTS.suitColours, level,
      options: [
        { value: 'four', label: 'Four colours: red hearts, blue diamonds, green clubs' },
        { value: 'two', label: 'Two colours: red and black, as on most decks' },
      ],
      note: 'Every card also shows its suit as a shape, so colour is never the only way to tell.' },
  ];
}

/** The `cardSvg` options a module's settings mean. Anything unknown is the default. */
export function cardOptions(cfg = {}) {
  return {
    layout: CARD_LAYOUTS.includes(cfg.cardLayout) ? cfg.cardLayout : CARD_DEFAULTS.cardLayout,
    fourColour: (SUIT_COLOURS.includes(cfg.suitColours) ? cfg.suitColours : CARD_DEFAULTS.suitColours) === 'four',
  };
}

// The site's id for a theme where it is not Design's. Every other live theme has the same id on both sides.
const DESIGN_ID = Object.freeze({ default: 'nimrod' });
const own = (id) => Object.prototype.hasOwnProperty.call(cardThemes, id) && id !== 'empty';

/** Does this site theme have a deck drawn for it (rather than borrowing the Nimrod one)? */
export function hasOwnDeck(themeId) {
  return own(DESIGN_ID[themeId] || themeId);
}
/** The Design deck a site theme wears: its own, else 'nimrod'. Null or unknown is the default theme's. */
export function deckFor(themeId) {
  const id = DESIGN_ID[themeId || 'default'] || themeId;
  return own(id) ? id : 'nimrod';
}

const SUIT_NAME = Object.fromEntries(SUITS.map((s) => [s.id, s.name]));
/** A klondike card ({ s, r, up }) as Design's ({ rank, suit } or { faceDown }). */
export function designCard(c) {
  if (!c || c.up === false) return { faceDown: true };
  return { rank: RANK_LABEL[c.r], suit: SUIT_NAME[c.s] || 'spades' };
}

const ART_ATTRS = ' aria-hidden="true" focusable="false" data-card-art=""';
/**
 * The drawing for a klondike card under a site theme and a module's settings: Design's SVG, hidden from a
 * screen reader (the element around it carries the name) and with its back pattern's id made unique by
 * `idSuffix` (see the header). Face down when `c.up === false`.
 */
export function cardArt(c, themeId, cfg = {}, { idSuffix = '' } = {}) {
  const deck = deckFor(themeId);
  let svg = cardSvg(designCard(c), deck, cardOptions(cfg));
  svg = svg.replace(/ role="img" aria-label="[^"]*"/, ART_ATTRS);
  if (idSuffix) {
    const id = `nc-${deck}`;
    svg = svg.split(`id="${id}"`).join(`id="${id}-${idSuffix}"`).split(`url(#${id})`).join(`url(#${id}-${idSuffix})`);
  }
  return svg;
}

/**
 * The deck's colours as the CSS variables the card games' own sheets already read (`--card-face`,
 * `--card-edge`, `--suit-hearts` ... in solitaire.css / card_sort.css), for anything drawn beside a card in
 * the same colours: card sort's suit buttons. Two colours: hearts and diamonds take the hearts ink, clubs and
 * spades the spades ink, exactly as `cardSvg` draws them.
 */
export function cardVars(themeId, cfg = {}) {
  const t = cardThemes[deckFor(themeId)];
  const four = cardOptions(cfg).fourColour;
  const ink = (suit) => (four ? t.suits[suit] : t.suits[suit === 'hearts' || suit === 'diamonds' ? 'hearts' : 'spades']);
  return {
    '--card-face': t.stock,
    '--card-edge': t.edge,
    '--suit-hearts': ink('hearts'),
    '--suit-diamonds': ink('diamonds'),
    '--suit-clubs': ink('clubs'),
    '--suit-spades': ink('spades'),
  };
}

// ---------------------------------------------------------------------------------------------------
// WHICH THEME IS ON SCREEN, AND WHEN IT CHANGES
// ---------------------------------------------------------------------------------------------------

/** The site theme id painted on `el`: the nearest element up from it that carries a theme's variables. */
export function themeIdAt(el) {
  for (let n = el || null; n; n = n.parentElement) {
    if (n.style && n.style.getPropertyValue('--bg')) {
      const id = themeIdFromRoot(n);
      if (id) return id;
    }
  }
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  return themeIdFromRoot(root) || 'default';
}

/**
 * Follow the theme painted on `el`. `onChange(themeId)` is called when it changes (not on start). Returns
 * `{ id(), stop() }`. Watches the `style` attribute of every element above `el`, up to <html>: that is
 * where `applyTheme` writes, for the whole page or for one panel wearing its own theme.
 */
export function watchTheme(el, onChange) {
  let current = themeIdAt(el);
  let obs = null;
  const recheck = () => {
    const next = themeIdAt(el);
    if (next === current) return;
    current = next;
    try { onChange?.(next); } catch (err) { console.error('card_deck: theme change', err); }
  };
  try {
    if (typeof MutationObserver === 'function' && el) {
      obs = new MutationObserver(recheck);
      for (let n = el.parentElement; n; n = n.parentElement) obs.observe(n, { attributes: true, attributeFilter: ['style'] });
      // <html> always, even when `el` is not in the page yet: the whole-page theme must reach it either way.
      if (typeof document !== 'undefined') obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    }
  } catch { obs = null; }
  return {
    id: () => current,
    recheck,
    stop() { try { obs?.disconnect(); } catch { /* gone */ } obs = null; },
  };
}
