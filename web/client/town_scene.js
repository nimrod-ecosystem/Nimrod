// town_scene.js — A PLACE IN THE TOWN WITH PEOPLE IN IT, as one SVG: the town module's open place (the character at
// home) and every page of Story time (the hero and the cast).
//
// Design's pieces, put together and nothing redrawn: the place is town.js `placeSvg` (with the person's edits), the
// court characters are playing_cards.js `courtLook` (Design's four, dressed for the theme's deck exactly as on the
// cards), and the hero is the person's own full-body character (avatar_figure.js `figureParts`) or, without one, a
// default character. One SVG with one viewBox, so the people stay standing on the floor whatever size it is drawn at.
//
// THE HERO'S CLOTHES. `heroOutfit: 'own'` keeps whatever the person dressed their character in; 'theme' dresses them
// for the theme like the cast. (The default is the module's to argue; story.js does.) A theme with no outfits of its
// own yet wears the Royal robe in its card colours, as Design's kit does for the court.

import { placeSvg, PLACES } from './town.js';
import { figureBody, OUTFITS } from './character_kit.js';
import { courtLook, cardThemes } from './playing_cards.js';
import { DEFAULT_FIGURE, figureParts, normalizeFigure } from './avatar_figure.js';

export const STAGE_W = 960;
export const STAGE_H = 540;
// A standing figure is 56% of the picture's height (feet at 97%): about the height of the furniture's tallest pieces
// (a bookshelf, a throne), so a person looks like they are in the room rather than in front of it.
export const FIGURE_H = 302;
export const FEET_Y = 524;
// Where each figure stands, by how many there are; the hero is always first, on the left.
export const SPOTS = Object.freeze({ 1: [520], 2: [330, 640], 3: [230, 480, 730] });

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The first outfit Design made for a deck, else the Royal robe. */
export function themeOutfit(deck) {
  return Object.keys(OUTFITS).find((id) => OUTFITS[id].theme === deck) || 'royal';
}
const royalOf = (deck) => {
  const t = cardThemes[deck] || cardThemes.nimrod;
  return { main: t.back.a, trim: t.back.frame, metal: '#e2b45a' };
};

/** The hero: a saved figure record (or null for the default character), drawn for a deck. */
export function heroParts(record, deck = 'nimrod', { outfit = 'own' } = {}) {
  const rec = record ? normalizeFigure(record) : { ...DEFAULT_FIGURE, outfit: themeOutfit(deck) };
  const { look, opts } = figureParts(rec);
  if (outfit === 'theme') opts.outfit = themeOutfit(deck);
  return { look, opts: { ...opts, royal: royalOf(deck) } };
}

// The suit each court character holds in a story or at home: the cards' own pairing (the King's hall is behind the
// King of every suit, so this is only which emblem he carries). Hearts for the King and Queen, clubs for Jack.
const COURT_SUIT = { king: 'hearts', queen: 'hearts', jack: 'clubs', joker: null };

/** A court character dressed for a deck (`pose`: 'stand' | 'wave'). */
export function courtParts(role, deck = 'nimrod', { pose = 'stand' } = {}) {
  const { look, opts } = courtLook(role, COURT_SUIT[role] || 'hearts', deck);
  return { look, opts: { ...opts, pose } };
}

/**
 * The scene, as an SVG string.
 *   place   a town.js place id        deck   the Design deck id          edited  the person's recipe for this place
 *   cast    [{ role: 'hero' | 'king' | 'queen' | 'jack' | 'joker', pose? }]   (at most three; the hero first)
 *   hero    the person's figure record, or null     heroOutfit 'own' | 'theme'
 *   title   the accessible name ('' for a decorative one)
 */
export function sceneSvg({ place, deck = 'nimrod', edited = null, cast = [], hero = null, heroOutfit = 'own', title = '' } = {}) {
  const id = PLACES[place] ? place : 'kingHall';
  const inner = placeSvg(id, deck, edited ? { edited } : {})
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[^<]*<\/title>/, '');
  const people = (Array.isArray(cast) ? cast : []).slice(0, 3);
  const xs = SPOTS[people.length] || [];
  const w = (FIGURE_H * 200) / 320;
  const figs = people.map((c, i) => {
    const role = typeof c === 'string' ? c : c && c.role;
    const pose = (c && c.pose) || 'stand';
    const parts = role === 'hero' ? heroParts(hero, deck, { outfit: heroOutfit }) : courtParts(role, deck, { pose });
    if (role === 'hero' && pose === 'wave') parts.opts.pose = 'wave';
    return `<svg x="${xs[i] - w / 2}" y="${FEET_Y - FIGURE_H}" width="${w}" height="${FIGURE_H}" viewBox="0 0 200 320" data-who="${esc(role)}">${figureBody(parts.look, parts.opts)}</svg>`;
  }).join('');
  const label = title ? ` role="img" aria-label="${esc(title)}"` : ' aria-hidden="true" focusable="false"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${STAGE_W} ${STAGE_H}" preserveAspectRatio="xMidYMid meet"${label} data-scene="${id}">`
    + (title ? `<title>${esc(title)}</title>` : '')
    + `<svg x="0" y="0" width="${STAGE_W}" height="${STAGE_H}" viewBox="0 0 ${STAGE_W} ${STAGE_H}">${inner}</svg>${figs}</svg>`;
}
