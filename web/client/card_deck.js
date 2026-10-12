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
//   * THE SETTINGS, each a row any card game declares (`cardSettingsFields`; three since 2026-10-12, below):
//       cardLayout   'pips' (the usual suit marks) | 'big' (one huge rank and suit, readable across a room)
//       suitColours  'four' (hearts red, diamonds blue, clubs green, spades ink) | 'two' (red and black)
//       cardScenery  'auto' | 'on' | 'off' (the town behind the cards)
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

//
// *** 2026-10-12: DESIGN'S CHARACTERS HANDOFF (Nimrod Design System16, handoff/characters). ***
// `playing_cards.js` was replaced with Design's new file, again as it is. It now imports `character_kit.js` and
// `town.js` (both Design's, both shipped as they are): face cards are the four court characters standing in
// their homes, and every card has its suit's place in the theme's town behind it. What changed here:
//   * THE LAYOUT VALUES ARE DESIGN'S NEW ONES. 'pips' (that many suit marks, as on a real card; Design's new
//     default) | 'big' (one huge rank, for reading across a room). A stored 'classic' (the old name for the
//     pips) still means the pips.
//   * A THIRD SETTING, `cardScenery`: the town places behind the cards, 'auto' | 'on' | 'off' (Design:
//     "`scenery: false` turns the scenes off, for plainer cards or the low-vision setting"). 'auto' is on except
//     in the decks where it MEASURED under 3:1 (SCENERY_DEFAULT_OFF, below).
//   * THE TOWN SEAM: `cardOptions(cfg, { town })` passes a person's edited places ({ placeId: recipe }, per
//     theme) to `cardSvg` ONLY when there are some. No such edits exist yet (the town editor is not built),
//     so today nothing passes one and every card draws Design's default town.
//   * IDS MADE STABLE. Design's town and character drawings number their pattern, gradient and clip ids from a
//     counter, so the same card drawn twice was two different strings. `cardArt` renames every id in a face
//     to one derived from the drawing itself plus the table's suffix: the same card is the same string (a
//     redraw that changed nothing changes nothing), and two tables never share an id (the back's reason, below).

import { cardSvg, cardThemes } from './playing_cards.js';
import { themeIdFromRoot } from './aac_sets.js';
import { SUITS, RANK_LABEL } from './klondike.js';

export const CARD_LAYOUTS = Object.freeze(['pips', 'big']);
export const SUIT_COLOURS = Object.freeze(['four', 'two']);
export const CARD_SCENERY = Object.freeze(['auto', 'on', 'off']);

// *** THE DEFAULTS, EACH ARGUED. ***
//   cardLayout 'pips'  Design's new default ("Number cards show that many of the suit"). FOR: it is what a card
//                      looks like, and counting the marks is part of the game. AGAINST: 'big' (the default until
//                      today) reads from across a room. It is one setting away, and the corner index on every
//                      card is a fifth of its width either way.
//   suitColours 'four' Kept as it was (631a9aa), NOT Design's file's own default (red and black). FOR four: a
//                      diamond and a heart, a club and a spade, differ at a glance for somebody who sees poorly,
//                      and the suit shape is on every index anyway. AGAINST: two colours is what most people
//                      expect. On Mike's list.
//   cardScenery 'auto' ON, EXCEPT IN THE DECKS WHERE IT MEASURED UNDER 3:1 (SCENERY_DEFAULT_OFF, below), which is
//                      what Mike's brief asked for (2026-10-12). FOR on (Design's file's own default): the town
//                      behind the cards is the whole point of this handoff, and every pip and index carries a
//                      card-stock outline. AGAINST: Design suggests it off for low vision, a plain card is calmer,
//                      and at the kiosk's smallest card the outline is about 1.3px, too thin to hold the scene off
//                      in 13 of the 21 decks (the Nimrod deck among them: so the default theme's cards start PLAIN).
//                      'on' and 'off' are each one setting away and apply to every deck. On Mike's list: whether
//                      a mixed default (pictures in some themes, not others) is what he wants, or one answer for all.
export const CARD_DEFAULTS = Object.freeze({ cardLayout: 'pips', suitColours: 'four', cardScenery: 'auto' });

// DECKS WHOSE SCENERY STARTS OFF: the corner index or the pips measured under 3:1 at their edge over the scene, on
// the deck's worst card, at the kiosk's smallest card (110px; dev/playing_cards_test.html says how, and holds this
// list to the measurement). Measured 2026-10-12, index / pips, both visions; each reported to Design:
//   halloween 1.94 / 1.27   steampunk 2.37 / 2.40   cyberpunk 2.89 / 2.43   christmas 3.45 / 2.50
//   fall 2.89 / 2.81        lunarNewYear 3.66 / 2.86   spring 3.55 / 2.89   easter 3.58 / 2.91
//   diwali 3.58 / 2.91      nimrod 2.93 / 3.42     summer 3.70 / 2.95     july4 3.77 / 2.98   ocean 3.75 / 3.00
// (The eight that pass: winter, night, cozy, harvest, hanukkah, newYear, valentines, stPatricks.)
// `cardScenery: 'on'` chosen by a person turns the pictures on in these decks too.
export const SCENERY_DEFAULT_OFF = Object.freeze(['nimrod', 'fall', 'steampunk', 'cyberpunk', 'ocean', 'spring', 'summer',
  'halloween', 'christmas', 'easter', 'july4', 'lunarNewYear', 'diwali']);

const LEGACY_LAYOUT = Object.freeze({ classic: 'pips' });

/** The settings rows a card game declares. All 'standard': how the cards look, not whether the game works. */
export function cardSettingsFields({ level = 'standard' } = {}) {
  return [
    { key: 'cardLayout', label: 'Card faces', kind: 'choice', default: CARD_DEFAULTS.cardLayout, level,
      options: [
        { value: 'pips', label: 'Suit marks: a 3 has three hearts, as on most decks' },
        { value: 'big', label: 'Big: one large number and suit, easy to read from across a room' },
      ],
      note: 'Picture cards and the corner of every card look the same either way.' },
    { key: 'suitColours', label: 'Suit colours', kind: 'choice', default: CARD_DEFAULTS.suitColours, level,
      options: [
        { value: 'four', label: 'Four colours: red hearts, blue diamonds, green clubs' },
        { value: 'two', label: 'Two colours: red and black, as on most decks' },
      ],
      note: 'Every card also shows its suit as a shape, so colour is never the only way to tell.' },
    { key: 'cardScenery', label: 'Pictures behind the cards', kind: 'choice', default: CARD_DEFAULTS.cardScenery, level,
      options: [
        { value: 'auto', label: 'Where they are easy to read: on in some themes, off where the pictures make the numbers harder to see' },
        { value: 'on', label: 'On: each card shows a place in the theme\'s town, and the picture cards stand at home' },
        { value: 'off', label: 'Off: plain cards, the easiest to read' },
      ],
      note: 'Over a picture, the numbers and suit marks keep a thin outline in the card\'s own colour.' },
  ];
}

/**
 * The `cardSvg` options a module's settings mean. Anything unknown is the default.
 *   deck   the Design deck being drawn (for SCENERY_DEFAULT_OFF); omitted, the deck's own default is not asked
 *   town   a person's edited town places for this theme ({ placeId: recipe }). Passed on ONLY when it has at
 *          least one place in it: no edits, no `town` option, and Design's default places draw.
 */
export function cardOptions(cfg = {}, { deck = null, town = null } = {}) {
  const layout = LEGACY_LAYOUT[cfg.cardLayout] || cfg.cardLayout;
  const choice = CARD_SCENERY.includes(cfg.cardScenery) ? cfg.cardScenery : CARD_DEFAULTS.cardScenery;
  const scenery = choice === 'auto' ? !(deck && SCENERY_DEFAULT_OFF.includes(deck)) : choice === 'on';
  const out = {
    layout: CARD_LAYOUTS.includes(layout) ? layout : CARD_DEFAULTS.cardLayout,
    fourColour: (SUIT_COLOURS.includes(cfg.suitColours) ? cfg.suitColours : CARD_DEFAULTS.suitColours) === 'four',
    scenery,
  };
  if (scenery && town && typeof town === 'object' && Object.keys(town).length) {
    const clean = cleanTown(town);
    if (Object.keys(clean).length) out.town = clean;
  }
  return out;
}

/**
 * A person's edited town places, made safe to draw. town.js puts a recipe's colours straight into `fill="..."`
 * attributes (its own built-in recipes are trusted; a SAVED one is data somebody typed or a file brought in), so
 * every `color` / `wainscot` must be a plain `#rrggbb` or it is dropped (the piece's or the theme's own colour
 * draws instead), numbers must be finite, and no string keeps `<`, `&` or `"`. Unknown place ids are kept: town.js
 * only looks them up. Returns a new object; the input is not touched.
 */
export function cleanTown(town) {
  const HEX = /^#[0-9a-f]{6}$/i;
  const walk = (v, key) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (key === 'color' || key === 'wainscot') return HEX.test(v) ? v : undefined;
      return v.replace(/[<&"]/g, '').slice(0, 200);
    }
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => walk(x, '')).filter((x) => x !== undefined);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (!/^[A-Za-z][\w-]{0,40}$/.test(k)) continue;
        const w = walk(x, k);
        if (w !== undefined) o[k] = w;
      }
      return o;
    }
    return undefined;
  };
  const out = {};
  for (const [id, recipe] of Object.entries(town || {})) {
    if (!/^[A-Za-z][\w-]{0,40}$/.test(id) || !recipe || typeof recipe !== 'object' || Array.isArray(recipe)) continue;
    out[id] = walk(recipe, '');
  }
  return out;
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

// FNV-1a, as a short base-36 tag: the same drawing gives the same tag on every device.
function tagOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Every id in a drawing (except a back's `nc-<deck>`, which has its own rule) renamed from Design's counters to
 * `k<tag>-<n>[-<suffix>]`, where the tag comes from the drawing with its ids blanked: deterministic, and the same
 * card under the same settings is the same string. References follow (`url(#..)`, `href="#.."`).
 */
export function stableIds(svg, suffix = '') {
  // The ids, AND anything referenced by `url(#..)` / `href="#.."` that has no element (town.js points its floor's
  // invisible overlay at a gradient it never defines): a dangling counter would make the string differ too.
  const ids = [];
  for (const m of svg.matchAll(/\sid="([^"]+)"|url\(#([^)]+)\)|href="#([^"]+)"/g)) {
    const id = m[1] || m[2] || m[3];
    if (!id.startsWith('nc-') && !ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return svg;
  const blank = svg.replace(/\sid="[^"]+"/g, ' id=""').replace(/url\(#[^)]*\)/g, 'url(#)');
  const tag = tagOf(blank);
  let out = svg;
  ids.forEach((id, i) => {
    const to = `k${tag}-${i}${suffix ? `-${suffix}` : ''}`;
    const e = escRe(id);
    out = out.replace(new RegExp(`(\\sid=")${e}(")`, 'g'), `$1${to}$2`)
      .replace(new RegExp(`url\\(#${e}\\)`, 'g'), `url(#${to})`)
      .replace(new RegExp(`(href=")#${e}(")`, 'g'), `$1#${to}$2`);
  });
  return out;
}

// THE SAME CARD, DRAWN ONCE. A face with its town behind it is a few kilobytes of SVG built from scratch, and a
// solitaire table redraws every card on every move. Keyed on everything the drawing depends on; cleared when it
// grows past ART_CACHE_MAX (a whole table in every deck and setting is well under that).
const ART_CACHE_MAX = 600;
const artCache = new Map();

/**
 * The drawing for a klondike card under a site theme and a module's settings: Design's SVG, hidden from a
 * screen reader (the element around it carries the name), with its ids made stable and, given `idSuffix`,
 * unique to this table (see the header). Face down when `c.up === false`.
 *   town   a person's edited town places for this theme; see `cardOptions`
 */
export function cardArt(c, themeId, cfg = {}, { idSuffix = '', town = null } = {}) {
  const deck = deckFor(themeId);
  const card = designCard(c);
  const opts = cardOptions(cfg, { deck, town });
  const key = JSON.stringify([deck, card, opts.layout, opts.fourColour, opts.scenery, idSuffix, opts.town ? tagOf(JSON.stringify(opts.town)) : 0]);
  const hit = artCache.get(key);
  if (hit) return hit;
  let svg = cardSvg(card, deck, opts);
  svg = svg.replace(/ role="img" aria-label="[^"]*"/, ART_ATTRS);
  if (idSuffix) {
    const id = `nc-${deck}`;
    svg = svg.split(`id="${id}"`).join(`id="${id}-${idSuffix}"`).split(`url(#${id})`).join(`url(#${id}-${idSuffix})`);
  }
  svg = stableIds(svg, idSuffix);
  if (artCache.size >= ART_CACHE_MAX) artCache.clear();
  artCache.set(key, svg);
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
