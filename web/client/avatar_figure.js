// avatar_figure.js — A FULL-BODY CHARACTER AS A PERSON'S AVATAR: a small record in, Design's figure out.
//
// Claude Design's characters handoff (2026-10-12, `character_kit.js`, shipped as it is) draws a full-body
// character from a LOOK ({ tone, hair, hairColor, beard, glasses }) and what they WEAR ({ outfit, pose }).
// Design's own maker (avatar_maker.html, not shipped) has Body, Outfits, Role and Pose tabs. This file is
// the site's side of it for the avatar maker (`modules/avatar.js`), the same shape as `avatar.js` is for the
// drawn face: a record of ids and checked colours, never markup.
//
// WHY A RECORD AND NOT A PICTURE (the same reason as the face): it is tiny to keep on the person, it redraws
// at any size, and when Design adds poses or outfits every saved character can wear them with nobody making
// theirs again. NOTHING TYPED OR STORED REACHES THE SVG BUT AN ID FROM A LIST BELOW OR A `#rrggbb`:
// `character_kit.js` puts the look's colours straight into `fill="..."` attributes, so `normalizeFigure` is
// the gate, and every draw goes through it.
//
// WHAT IS LEFT OUT, ON PURPOSE:
//   * ROLE (crown, tiara, feathered cap, jester hat). Design: "Anyone can take a role for a game or a story."
//     It is a costume for a game, not part of who somebody is, so it is not kept on the avatar. The games
//     that cast people (story time, who's who: on Mike's list) pass a role when they draw.
//   * Design's maker's two named presets for real people. Site copy names nobody; the four court characters
//     (`DEFAULT_CHARACTERS`) are offered instead, as "Start from".
//
// THE SMALL FACE. A person's avatar is shown in a circle beside their name almost everywhere
// (avatar_display.js, 1.6em). A 200x320 body in a 1.6em circle is a speck, so `crop: 'head'` draws the
// head and shoulders (viewBox 16 0 168 168: the widest hat, the elf's, ends at x 176; the crowns start at
// y 0). [Code's choice, on Mike's list: the alternative is the whole body, tiny.]

import { normalizeHex } from './color_picker.js';
import { mulberry32 } from './rng.js';
import {
  figureSvg, SKIN_TONES, HAIR_COLOURS, HAIR_STYLES, POSES, OUTFITS, OUTFIT_THEMES, DEFAULT_CHARACTERS, COURT_PICK,
} from './character_kit.js';

export const FIGURE_VERSION = 1;

const freeze = (list) => Object.freeze(list.map((x) => Object.freeze({ ...x })));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Names for Design's lists. The colours are Design's; the words are Code's, named by lightness for skin
// (as avatar.js does: no food, no places, no peoples).
const SKIN_NAMES = ['Lightest', 'Very light', 'Light', 'Light medium', 'Medium', 'Medium deep', 'Deep', 'Very deep', 'Deepest'];
const HAIR_COLOUR_NAMES = ['Black', 'Dark brown', 'Brown', 'Auburn', 'Ginger', 'Blonde', 'Pale blonde', 'Gray', 'Rose', 'Blue'];
const HAIR_STYLE_NAMES = { short: 'Short', long: 'Long', curly: 'Curly', bun: 'Bun', ponytail: 'Ponytail', bald: 'Bald' };
const POSE_NAMES = { stand: 'Standing', wave: 'Waving' };
export const WORLD_NAMES = Object.freeze({ nimrod: 'Nimrod', fall: 'Fall', winter: 'Winter', halloween: 'Halloween',
  christmas: 'Christmas', steampunk: 'Steampunk', any: 'Any theme' });
const YES_NO = freeze([{ id: 'no', name: 'No' }, { id: 'yes', name: 'Yes' }]);

// Outfits in Design's order: each theme's, then the Royal robe every other theme falls back to.
const OUTFIT_IDS = [...OUTFIT_THEMES.flatMap((t) => Object.keys(OUTFITS).filter((id) => OUTFITS[id].theme === t)),
  ...Object.keys(OUTFITS).filter((id) => !OUTFIT_THEMES.includes(OUTFITS[id].theme))];

// THE PARTS, in walk order, the same shape as avatar.js PARTS so the maker walks either the same way.
export const FIGURE_PARTS = Object.freeze([
  { key: 'tone', label: 'Skin', color: true,
    options: freeze(SKIN_TONES.map((hex, i) => ({ id: hex, name: SKIN_NAMES[i] || `Tone ${i + 1}`, hex }))) },
  { key: 'hair', label: 'Hair', options: freeze(HAIR_STYLES.map((id) => ({ id, name: HAIR_STYLE_NAMES[id] || id }))) },
  { key: 'hairColor', label: 'Hair color', color: true,
    options: freeze(HAIR_COLOURS.map((hex, i) => ({ id: hex, name: HAIR_COLOUR_NAMES[i] || `Color ${i + 1}`, hex }))) },
  { key: 'beard', label: 'Beard', options: YES_NO },
  { key: 'glasses', label: 'Glasses', options: YES_NO },
  { key: 'outfit', label: 'Outfit',
    options: freeze(OUTFIT_IDS.map((id) => ({ id, name: `${WORLD_NAMES[OUTFITS[id].theme] || OUTFITS[id].theme}: ${OUTFITS[id].label}` }))) },
  { key: 'pose', label: 'Pose', options: freeze(POSES.map((id) => ({ id, name: POSE_NAMES[id] || id }))) },
].map((p) => Object.freeze(p)));
export const FIGURE_PART_KEYS = Object.freeze(FIGURE_PARTS.map((p) => p.key));
export const figurePartOf = (key) => FIGURE_PARTS.find((p) => p.key === key) || null;

// Only REPAIRS a stored record (a new one starts from `surpriseFigure(<the person's id>)`, as the face does).
// Design's own starting look (character_kit.js figureBody: tone #e8b48a, short, #3a2414) in the Nimrod
// cardigan, standing.
export const DEFAULT_FIGURE = Object.freeze({
  v: FIGURE_VERSION, tone: '#e8b48a', hair: 'short', hairColor: '#3a2414', beard: 'no', glasses: 'no',
  outfit: 'nimrodCardigan', pose: 'stand',
});

/** A stored or typed record, repaired: every key present, every value an id on its list or (colours) a hex. */
export function normalizeFigure(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { v: FIGURE_VERSION };
  for (const p of FIGURE_PARTS) {
    let v = r[p.key];
    if (v === true) v = 'yes';            // a look written the kit's way ({ beard: true })
    if (v === false) v = 'no';
    if (p.color && typeof v === 'string' && normalizeHex(v)) v = normalizeHex(v);
    if (typeof v === 'string' && p.options.some((o) => o.id === v)) out[p.key] = v;
    else if (p.color && normalizeHex(v)) out[p.key] = normalizeHex(v);
    else out[p.key] = DEFAULT_FIGURE[p.key];
  }
  return out;
}

/** The option a record holds for a part, or a made-up one for a free colour. */
export function figureOptionFor(record, key) {
  const p = figurePartOf(key);
  if (!p) return null;
  const v = normalizeFigure(record)[key];
  return p.options.find((o) => o.id === v) || { id: v, name: `Color ${v}`, hex: v };
}

/** The record as character_kit's two arguments: the look (who) and what they wear. */
export function figureParts(record, { role = null, suit = null, suitColor } = {}) {
  const f = normalizeFigure(record);
  const look = { tone: f.tone, hair: f.hair, hairColor: f.hairColor, beard: f.beard === 'yes', glasses: f.glasses === 'yes' };
  const opts = { outfit: f.outfit, pose: f.pose };
  if (role && ['king', 'queen', 'jack', 'joker'].includes(role)) {
    opts.role = role;
    if (suit && ['hearts', 'diamonds', 'clubs', 'spades'].includes(suit)) opts.suit = suit;
    if (normalizeHex(suitColor)) opts.suitColor = normalizeHex(suitColor);
  }
  return { look, opts };
}

/** In words, for the preview and a screen reader. */
export function describeFigure(record) {
  const f = normalizeFigure(record);
  const name = (k) => String(figureOptionFor(f, k).name || '').toLowerCase();
  const bits = [`${name('tone')} skin`, f.hair === 'bald' ? 'bald' : `${name('hair')} ${name('hairColor')} hair`];
  if (f.beard === 'yes') bits.push('a beard');
  if (f.glasses === 'yes') bits.push('glasses');
  return `A full-body character: ${bits.join(', ')}, wearing the ${OUTFITS[f.outfit].label.toLowerCase()}, ${name('pose')}.`;
}

/**
 * The drawing, as an SVG string. Every value has been through `normalizeFigure`; the title is escaped
 * (character_kit's `figureSvg` puts its label into the markup as it is).
 *   crop   'full' (200x320, the whole body) | 'head' (head and shoulders, square: the small face)
 *   size   width/height in px, or '100%'; null leaves them off
 *   title  the accessible name; defaults to `describeFigure`; '' for a decorative one
 *   role, suit, suitColor   a costume for a game or a story (not kept on the avatar)
 */
export function renderFigure(record, { crop = 'full', size = null, title = null, role = null, suit = null, suitColor } = {}) {
  const { look, opts } = figureParts(record, { role, suit, suitColor });
  const name = title == null ? describeFigure(record) : String(title);
  let svg = figureSvg(look, opts, esc(name));
  if (crop === 'head') svg = svg.replace('viewBox="0 0 200 320"', 'viewBox="16 0 168 168"');
  const dim = size === '100%' ? '100%' : String(Number(size) || 0);
  const attrs = ` data-avatar-figure="${crop === 'head' ? 'head' : 'full'}"${size ? ` width="${dim}" height="${dim}"` : ''}`;
  svg = svg.replace('<svg ', `<svg${attrs} `);
  if (!name) svg = svg.replace(/ role="img" aria-label=""/, ' aria-hidden="true" focusable="false"').replace('<title></title>', '');
  return svg;
}

// A stable number from any string (FNV-1a), so a seed reads the same on every device.
function hashOf(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A whole character dealt from a seed: a new avatar starts here (the person's id), never from one fixed look. */
export function surpriseFigure(seed) {
  const rand = mulberry32(hashOf(seed));
  const pick = (key) => { const o = figurePartOf(key).options; return o[Math.floor(rand() * o.length)].id; };
  return normalizeFigure({
    tone: pick('tone'), hair: pick('hair'), hairColor: pick('hairColor'),
    beard: rand() < 0.25 ? 'yes' : 'no', glasses: rand() < 0.3 ? 'yes' : 'no',
    outfit: pick('outfit'), pose: 'stand',
  });
}

/** Design's four court characters as starting records ("Start from"), in the Nimrod outfits Design gave them. */
export function courtFigure(role) {
  const c = DEFAULT_CHARACTERS[role];
  if (!c) return null;
  return normalizeFigure({ ...c.look, outfit: (COURT_PICK.nimrod || {})[role] || 'royal', pose: 'stand' });
}
export const COURT_ROLES = Object.freeze(Object.keys(DEFAULT_CHARACTERS));
