/* playingCards.js: a themed deck for every live theme, as SVG strings.
 *
 * Plain JavaScript with no React and no imports, so web/client can ship this file as it is and the
 * design system's PlayingCard component wraps it.
 *
 *   cardSvg({ rank: 'Q', suit: 'hearts' }, 'fall')            → '<svg …>' (a face)
 *   cardSvg({ faceDown: true }, 'halloween')                     → the theme's back
 *   cardSvg({ rank: 'joker' }, 'night', { layout: 'classic' })
 *
 * BUILT FOR SOMEBODY WHO MAY SEE POORLY OR READ SLOWLY:
 * - RED AND BLACK BY DEFAULT, AND THE SUIT SHAPE EVERYWHERE. Every index carries the suit shape, so a
 *   suit never depends on colour alone. `fourColour: true` is a setting for low vision: hearts red,
 *   diamonds blue, clubs green, spades ink.
 * - THE COURT CARDS ARE CHARACTERS (King, Queen, Jack, Joker) from courtCharacters.js, dressed in the
 *   theme and the suit. courtCharacterSvg() draws one on its own, for use anywhere else.
 * - A BIG CORNER INDEX. In solitaire most cards are seen as a strip, so the corner is the card. It's
 *   about a fifth of the card's width: 20px tall on a 110px kiosk card.
 * - Number cards show THAT MANY of the suit in the middle, as on a real card: the 3 of hearts has
 *   three hearts. `layout: 'big'` swaps the pips for one huge rank and suit, a setting for reading a
 *   card from across a room.
 * - Faces stay light stock in every theme except cyberpunk, so the ink keeps its contrast. The
 *   theme lives in the BACK, the edge, the court frames and the suit hues.
 */

import { SUIT_PATH, figureBody, figureSvg, DEFAULT_CHARACTERS, courtOutfit } from './character_kit.js';
import { placeSvg, placeForCard } from './town.js';

const W = 250, H = 350;
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const NAMES = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/* each theme's emblem in a 100×100 box. `c` is the emblem colour. */
const EMBLEM = {
  nimrod: (c) => `<path d="M30 76V26l40 50V26" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`,
  fall: (c) => `<path d="M50 6C76 24 88 50 74 74C66 86 56 90 50 94C44 90 34 86 26 74C12 50 24 24 50 6Z" fill="${c}"/><path d="M50 20V92M50 46L34 34M50 46L66 34M50 64L32 54M50 64L68 54" stroke="rgba(0,0,0,.35)" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  steampunk: (c) => `<g fill="${c}">${Array.from({ length: 10 }, (_, i) => `<rect x="44" y="4" width="12" height="18" rx="2" transform="rotate(${i * 36} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="32"/></g><circle cx="50" cy="50" r="12" fill="rgba(0,0,0,.45)"/>`,
  cyberpunk: (c) => `<rect x="28" y="28" width="44" height="44" rx="4" fill="none" stroke="${c}" stroke-width="6"/><rect x="40" y="40" width="20" height="20" fill="${c}"/><path d="M36 28V10M50 28V6M64 28V10M36 72V90M50 72V94M64 72V90M28 36H10M28 50H6M28 64H10M72 36H90M72 50H94M72 64H90" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
  winter: (c) => `<g stroke="${c}" stroke-width="6" stroke-linecap="round" fill="none">${[0, 60, 120].map((a) => `<g transform="rotate(${a} 50 50)"><path d="M50 6V94"/><path d="M50 20L40 12M50 20L60 12M50 80L40 88M50 80L60 88"/></g>`).join('')}</g>`,
  ocean: (c) => `<path d="M14 50C30 26 62 26 78 50C62 74 30 74 14 50Z" fill="${c}"/><path d="M76 50L96 32V68Z" fill="${c}"/><circle cx="30" cy="46" r="5" fill="rgba(0,0,0,.5)"/><path d="M8 84q10-8 21 0t21 0t21 0t21 0" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  night: (c) => `<path d="M58 8A42 42 0 1 0 92 66A34 34 0 1 1 58 8Z" fill="${c}"/><path d="M76 16l3 8 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" fill="${c}"/>`,
  cozy: (c) => `<path d="M50 26C38 18 22 16 8 20V80C22 76 38 78 50 86C62 78 78 76 92 80V20C78 16 62 18 50 26Z" fill="${c}"/><path d="M50 26V86" stroke="rgba(0,0,0,.35)" stroke-width="4"/><path d="M18 34c10-2 18-1 24 2M18 46c10-2 18-1 24 2M58 36c6-3 14-4 24-2M58 48c6-3 14-4 24-2" stroke="rgba(0,0,0,.25)" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  spring: (c) => `<g fill="${c}">${Array.from({ length: 5 }, (_, i) => `<ellipse cx="50" cy="26" rx="16" ry="22" transform="rotate(${i * 72} 50 50)"/>`).join('')}</g><circle cx="50" cy="50" r="11" fill="#f2d24a"/>`,
  summer: (c) => `<circle cx="50" cy="50" r="22" fill="${c}"/><g stroke="${c}" stroke-width="7" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => `<path d="M50 6V18" transform="rotate(${i * 45} 50 50)"/>`).join('')}</g>`,
  halloween: (c) => `<path d="M48 18q-2-10 6-12" stroke="#5a6b2c" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="34" cy="58" rx="22" ry="34" fill="${c}"/><ellipse cx="66" cy="58" rx="22" ry="34" fill="${c}"/><ellipse cx="50" cy="58" rx="22" ry="36" fill="${c}"/><path d="M32 48l8-10 8 10zM52 48l8-10 8 10zM34 66q16 14 32 0q-16 6-32 0z" fill="rgba(0,0,0,.55)"/>`,
  harvest: (c) => `<path d="M50 96V30" stroke="${c}" stroke-width="5" stroke-linecap="round"/><g fill="${c}">${[0, 1, 2, 3].map((i) => `<ellipse cx="40" cy="${30 + i * 15}" rx="7" ry="12" transform="rotate(-30 40 ${30 + i * 15})"/><ellipse cx="60" cy="${30 + i * 15}" rx="7" ry="12" transform="rotate(30 60 ${30 + i * 15})"/>`).join('')}<ellipse cx="50" cy="16" rx="7" ry="13"/></g>`,
  christmas: (c) => `<path d="M50 14L80 52H64L86 82H14L36 52H20Z" fill="${c}"/><rect x="44" y="82" width="12" height="12" fill="${c}"/><path d="M50 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#f2d24a"/>`,
  hanukkah: (c) => `<g fill="${c}"><rect x="10" y="64" width="80" height="6" rx="3"/><rect x="47" y="64" width="6" height="26"/><rect x="34" y="88" width="32" height="6" rx="3"/>${[12, 21, 30, 39, 50, 61, 70, 79, 88].map((x, i) => `<rect x="${x - 3}" y="${i === 4 ? 32 : 42}" width="6" height="${i === 4 ? 32 : 22}"/><ellipse cx="${x}" cy="${i === 4 ? 26 : 36}" rx="3.4" ry="5.5"/>`).join('')}</g>`,
  newYear: (c) => `<g stroke="${c}" stroke-width="6" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => `<path d="M50 8V28" transform="rotate(${i * 30} 50 50)"/>`).join('')}</g><circle cx="50" cy="50" r="8" fill="${c}"/>`,
  valentines: (c) => `<path d="M50 90C20 68 4 50 4 31C4 15 16 5 30 5C40 5 47 11 50 19C53 11 60 5 70 5C84 5 96 15 96 31C96 50 80 68 50 90Z" fill="${c}"/>`,
  stPatricks: (c) => `<g fill="${c}"><circle cx="50" cy="28" r="20"/><circle cx="29" cy="54" r="20"/><circle cx="71" cy="54" r="20"/></g><path d="M50 58Q54 80 66 94" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  easter: (c) => `<path d="M50 6C74 6 88 44 88 62C88 84 72 96 50 96C28 96 12 84 12 62C12 44 26 6 50 6Z" fill="${c}"/><path d="M14 54l12 8 12-8 12 8 12-8 12 8 12-8" stroke="rgba(255,255,255,.85)" stroke-width="6" fill="none" stroke-linejoin="round"/><circle cx="38" cy="78" r="5" fill="rgba(255,255,255,.85)"/><circle cx="62" cy="78" r="5" fill="rgba(255,255,255,.85)"/>`,
  july4: (c) => `<path d="M50 4l12 32h34l-27 21 10 34-29-20-29 20 10-34L4 36h34z" fill="${c}"/>`,
  lunarNewYear: (c) => `<path d="M50 2V14" stroke="${c}" stroke-width="4"/><rect x="36" y="12" width="28" height="8" rx="2" fill="${c}"/><ellipse cx="50" cy="50" rx="34" ry="32" fill="${c}"/><path d="M38 22q-10 28 0 56M62 22q10 28 0 56M50 18V82" stroke="rgba(0,0,0,.3)" stroke-width="4" fill="none"/><rect x="36" y="80" width="28" height="8" rx="2" fill="${c}"/><path d="M50 88V98" stroke="${c}" stroke-width="4"/>`,
  diwali: (c) => `<path d="M50 10C40 28 40 40 50 48C60 40 60 28 50 10Z" fill="#f2c46a"/><path d="M8 56H92C88 80 70 92 50 92C30 92 12 80 8 56Z" fill="${c}"/><path d="M20 66h60" stroke="rgba(0,0,0,.3)" stroke-width="4"/>`,
};

/* tile patterns for the backs, 20×20 tiles */
const PATTERN = {
  lattice: (a, b) => `<rect width="20" height="20" fill="${a}"/><path d="M0 0L20 20M20 0L0 20" stroke="${b}" stroke-width="3"/>`,
  dots: (a, b) => `<rect width="20" height="20" fill="${a}"/><circle cx="5" cy="5" r="2.6" fill="${b}"/><circle cx="15" cy="15" r="2.6" fill="${b}"/>`,
  stripes: (a, b) => `<rect width="20" height="20" fill="${a}"/><path d="M-5 5L5 -5M0 20L20 0M15 25L25 15" stroke="${b}" stroke-width="5"/>`,
  chevron: (a, b) => `<rect width="20" height="20" fill="${a}"/><path d="M0 8L10 2L20 8M0 18L10 12L20 18" stroke="${b}" stroke-width="3" fill="none"/>`,
  scales: (a, b) => `<rect width="20" height="20" fill="${a}"/><path d="M0 10A10 10 0 0 1 20 10M-10 20A10 10 0 0 1 10 20M10 20A10 10 0 0 1 30 20" stroke="${b}" stroke-width="2.4" fill="none"/>`,
  grid: (a, b) => `<rect width="20" height="20" fill="${a}"/><path d="M0 .5H20M.5 0V20" stroke="${b}" stroke-width="1.4"/><rect x="8" y="8" width="4" height="4" fill="${b}"/>`,
  stars: (a, b) => `<rect width="20" height="20" fill="${a}"/><path d="M5 2l1 3h3l-2.5 2 1 3L5 8.2 2.5 10l1-3L1 5h3z" fill="${b}"/><circle cx="15" cy="14" r="1.4" fill="${b}"/>`,
  hearts: (a, b) => `<rect width="20" height="20" fill="${a}"/><path transform="translate(2 2) scale(.07)" d="${SUIT_PATH.hearts}" fill="${b}"/><path transform="translate(12 11) scale(.07)" d="${SUIT_PATH.hearts}" fill="${b}"/>`,
  clovers: (a, b) => `<rect width="20" height="20" fill="${a}"/><g fill="${b}"><circle cx="5" cy="3.4" r="2"/><circle cx="3.2" cy="6" r="2"/><circle cx="6.8" cy="6" r="2"/><circle cx="15" cy="13.4" r="2"/><circle cx="13.2" cy="16" r="2"/><circle cx="16.8" cy="16" r="2"/></g>`,
};

/* stock = the face's card stock · edge = border · suits h/d/c/s · back: a/b pattern, frame, medallion, emblem colour */
const T = (stock, edge, h, d, c, s, back, pattern, court) => ({ stock, edge, suits: { hearts: h, diamonds: d, clubs: c, spades: s }, back, pattern, court });
const B = (a, b, frame, med, emb) => ({ a, b, frame, med, emb });
export const cardThemes = {
  nimrod: T('#fbf9ef', '#0A3323', '#b03a2e', '#1f5fa8', '#2c6e49', '#12181c', B('#105666', '#0e4a58', '#F7F4D5', '#0A3323', '#F7F4D5'), 'lattice', '#F7F4D5'),
  fall: T('#fbf3e2', '#6b4a32', '#a8401e', '#2f5f8a', '#4d6730', '#2a1a10', B('#7a3a1e', '#8f4a24', '#e2b45a', '#4a2814', '#f2c46a'), 'chevron', '#f4e2c4'),
  steampunk: T('#f4ead2', '#5a3c24', '#9e3a2a', '#2a5a7a', '#3e5a2a', '#241810', B('#3a2a18', '#4e3820', '#c9a24a', '#2a1c10', '#e0b53c'), 'scales', '#ecdcb4'),
  cyberpunk: T('#12142b', '#2de2e6', '#ff5c93', '#57c7ff', '#7dff9a', '#e8eef8', B('#0b0a1c', '#1d1748', '#ff2e88', '#05060f', '#2de2e6'), 'grid', '#1c1f40'),
  winter: T('#f6f9fb', '#3b4a68', '#b0303e', '#2a5aa8', '#2f6e5a', '#1b2130', B('#3b4a68', '#4a5c80', '#e8eef4', '#23263a', '#e8eef4'), 'dots', '#e4ecf4'),
  ocean: T('#f2f8f8', '#0e3a52', '#c0392b', '#1e6fa8', '#1f7a5a', '#07202f', B('#12536b', '#1a6a86', '#9fd4e0', '#07202f', '#9fe0e8'), 'scales', '#dcEEF2'),
  night: T('#f4f4f8', '#1b2a4a', '#b0304a', '#3050b0', '#2a7058', '#0d1424', B('#111a33', '#22345c', '#c9d4f0', '#080a14', '#f4f1dc'), 'stars', '#e4e8f4'),
  cozy: T('#fffdf6', '#8a7a62', '#9e5449', '#3e6a8a', '#4d6a4a', '#2f3a33', B('#6f8676', '#7f9686', '#f2e6c9', '#4f6456', '#f2e6c9'), 'lattice', '#f2ecdc'),
  spring: T('#fdfbf4', '#6c9e5c', '#c2445a', '#3a6ab0', '#3f7a3a', '#24392b', B('#f4c6d2', '#fbe2e8', '#6c9e5c', '#ffffff', '#c2445a'), 'dots', '#eef4e4'),
  summer: T('#fbfdfe', '#14636A', '#c4402a', '#1f6ab0', '#2a7a40', '#17323d', B('#3d86a8', '#5aa6c8', '#fffbe6', '#14636A', '#f2d24a'), 'stripes', '#e2f0f5'),
  halloween: T('#fbf3e6', '#2a1f3a', '#c4501c', '#5a3a9a', '#3e6a2a', '#16121f', B('#251a44', '#352660', '#f2a03c', '#16121f', '#f2a03c'), 'stars', '#f2e4d0'),
  harvest: T('#fbf3e6', '#8a5a26', '#a8401e', '#2f5a8a', '#5a6a2a', '#3a2414', B('#a8561e', '#b8682a', '#f2c46a', '#5a2a10', '#f2c46a'), 'chevron', '#f4e6cf'),
  christmas: T('#fdfbf6', '#225634', '#c9302b', '#1f5a9a', '#2f6a40', '#141a2c', B('#8a1e1e', '#a02626', '#e8d48a', '#225634', '#f4f1e8'), 'lattice', '#f2ecdc'),
  hanukkah: T('#f6f8fc', '#26304c', '#b0304a', '#2a5ab0', '#2a6a58', '#141b30', B('#2a4a90', '#3a5eb0', '#e6eaf4', '#141b30', '#ffd36e'), 'lattice', '#e6ecf8'),
  newYear: T('#faf8f2', '#1e2338', '#b8303a', '#2a5aa8', '#2a6a50', '#0c0e1c', B('#0c0e1c', '#262c4c', '#d9b34a', '#0c0e1c', '#d9b34a'), 'stars', '#efeadc'),
  valentines: T('#fffafb', '#9c3357', '#c9284e', '#3a5aa8', '#3a7050', '#3a1e28', B('#c93a62', '#de6a8a', '#fbe2e8', '#8a2a4a', '#fbe2e8'), 'hearts', '#f8e4ea'),
  stPatricks: T('#f8fcf6', '#2c6e49', '#b8402e', '#2a5aa0', '#1f7a3a', '#173a24', B('#2c6e49', '#3f8a5c', '#f2d24a', '#173a24', '#a8e890'), 'clovers', '#e2f0e4'),
  easter: T('#fffdf6', '#6a5aa8', '#c2445a', '#3a62b0', '#3f7a3a', '#2a3424', B('#d8c8f0', '#ebe0fa', '#6a5aa8', '#ffffff', '#6a5aa8'), 'dots', '#eee8f8'),
  july4: T('#fbfbfd', '#10142a', '#c9302b', '#1f4fa8', '#2a6a50', '#10142a', B('#1f2f6a', '#2f4290', '#f4f1e8', '#c9302b', '#f4f1e8'), 'stars', '#eceef6'),
  lunarNewYear: T('#fbf3e8', '#8a1e1e', '#c9302b', '#2a5a9a', '#2f6a40', '#1a0e14', B('#b02020', '#c83030', '#ffc457', '#6a0e0e', '#ffc457'), 'lattice', '#f6e4d0'),
  diwali: T('#fff8ee', '#8a2a5a', '#c4401e', '#3a4ab0', '#2f7a40', '#1a0e22', B('#5a1a6a', '#73288a', '#ffc457', '#24123a', '#ffc457'), 'scales', '#f6e6ee'),
};
cardThemes.empty = cardThemes.nimrod;
const TRADITIONAL = { hearts: 'h', diamonds: 'h', clubs: 's', spades: 's' };

/* ---------- court characters: the four default characters from characterKit.js, dressed for the theme ---------- */
const ROLE_OF = { K: 'king', Q: 'queen', J: 'jack', joker: 'joker' };
export function courtLook(role, suit, theme = 'nimrod', { fourColour = false, look } = {}) {
  const t = cardThemes[theme] || cardThemes.nimrod;
  const joker = role === 'joker', red = suit === 'hearts' || suit === 'diamonds';
  return {
    look: { ...DEFAULT_CHARACTERS[role].look, ...look },
    opts: {
      outfit: courtOutfit(role, theme), role, suit: joker ? null : suit,
      suitColor: joker ? t.suits.hearts : fourColour ? t.suits[suit] : t.suits[red ? 'hearts' : 'spades'],
      royal: { main: joker ? t.back.a : red ? t.suits.hearts : t.back.a, trim: t.back.frame, metal: '#e2b45a' },
      emblem: (EMBLEM[theme] || EMBLEM.nimrod)('#f2e2a8'),
    },
  };
}
export function courtCharacterSvg(role, suit, theme = 'nimrod', o = {}) {
  const { look, opts } = courtLook(role, role === 'joker' ? null : suit, theme, o);
  return figureSvg(look, opts, DEFAULT_CHARACTERS[role].name + (role === 'joker' ? '' : ', ' + role + ' of ' + suit));
}

/* standard pip positions: [column 0|.5|1, row 0..1] */
const PIPS = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};
const pip = (suit, cx, cy, size, color, flip) => `<path transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})${flip ? ` rotate(180 50 50)` : ''}" d="${SUIT_PATH[suit]}" fill="${color}"/>`;
const crown = (rank, color) => {
  if (rank === 'K') return `<path d="M88 112L96 74L112 96L125 66L138 96L154 74L162 112Z" fill="${color}"/><rect x="88" y="112" width="74" height="10" rx="3" fill="${color}"/>`;
  if (rank === 'Q') return `<path d="M90 114Q125 64 160 114Z" fill="${color}"/><circle cx="125" cy="76" r="7" fill="${color}"/><circle cx="102" cy="92" r="5" fill="${color}"/><circle cx="148" cy="92" r="5" fill="${color}"/><rect x="88" y="112" width="74" height="10" rx="3" fill="${color}"/>`;
  return `<path d="M92 118C92 92 108 80 128 80C146 80 156 92 158 104L136 108L158 118Z" fill="${color}"/><path d="M146 82Q170 64 168 92" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
};

/* A place from the theme's town, drawn into the card's middle window. Court cards stand in their
   character's home; number cards and Aces show their suit's place in town. */
const sceneIn = (card, theme, x, y, w, h, town, n, noSign) => {
  const id = placeForCard(card);
  let art = placeSvg(id, theme, { edited: town && town[id] }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<title>[^<]*<\/title>/, '');
  /* on a face card the room's own name sign would sit under the corner index, so the name moves to a ribbon at the foot */
  if (noSign) art = art.replace(/<rect[^>]*stroke="rgba\(0,0,0,\.25\)" stroke-width="3"\/><text[^>]*>[^<]*<\/text>/g, '');
  return `<defs><clipPath id="cw${n}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/></clipPath></defs><g clip-path="url(#cw${n})"><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice">${art}</svg></g>`;
};
let cardN = 0;

/* options: layout 'big' | 'classic', fourColour true | false, scenery true | false (the town places),
   town: the person's edited places for this theme, { placeId: recipe } */
export function cardSvg(card = {}, theme = 'nimrod', { layout = 'pips', fourColour = false, scenery = true, town } = {}) {
  const t = cardThemes[theme] || cardThemes.nimrod;
  const frame = `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="16"`;
  if (card.faceDown) {
    const id = 'nc-' + theme;
    const p = PATTERN[t.pattern] || PATTERN.lattice;
    const em = (EMBLEM[theme] || EMBLEM.nimrod)(t.back.emb);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Card, face down"><defs><pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse">${p(t.back.a, t.back.b)}</pattern></defs>${frame} fill="url(#${id})" stroke="${t.edge}" stroke-width="4"/><rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="10" fill="none" stroke="${t.back.frame}" stroke-width="5"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="7" fill="none" stroke="${t.back.frame}" stroke-width="1.5" opacity=".7"/><circle cx="125" cy="175" r="62" fill="${t.back.med}" stroke="${t.back.frame}" stroke-width="5"/><g transform="translate(87 137) scale(.76)">${em}</g></svg>`;
  }
  const joker = card.rank === 'joker';
  const suit = card.suit || 'spades';
  const ink = joker ? t.suits.spades : fourColour ? t.suits[suit] : t.suits[TRADITIONAL[suit] === 'h' ? 'hearts' : 'spades'];
  const label = joker ? 'Joker' : `${NAMES[card.rank] || card.rank} of ${suit}`;
  const r = card.rank;
  const idx = (flip) => {
    const g = flip ? ` transform="rotate(180 ${W / 2} ${H / 2})"` : '';
    if (joker) return `<g${g}><text x="26" y="44" font-family="${FONT}" font-weight="800" font-size="24" fill="${ink}" letter-spacing="1">JOKER</text></g>`;
    return `<g${g}><text x="${r === '10' ? 14 : 20}" y="56" font-family="${FONT}" font-weight="800" font-size="${r === '10' ? 44 : 52}" fill="${ink}" letter-spacing="${r === '10' ? -3 : 0}">${r}</text>${pip(suit, 39, 86, 36, ink)}</g>`;
  };
  let middle = '';
  if (joker || ['J', 'Q', 'K'].includes(r)) {
    const role = ROLE_OF[joker ? 'joker' : r];
    const { look, opts } = courtLook(role, joker ? null : suit, theme, { fourColour });
    /* the home fills the whole card too, and the character stands in it, feet near the bottom,
       clear of the corner indexes */
    /* the Joker's long corner word fills the foot, and the card already says JOKER, so no ribbon there */
    const who = joker ? '' : (DEFAULT_CHARACTERS[role] || {}).name || '';
    const ribbon = who ? `<rect x="58" y="300" width="134" height="26" rx="6" fill="${t.stock}" stroke="${ink}" stroke-width="2"/><text x="125" y="318.5" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="15" font-weight="800" fill="${ink}">${who}</text>` : '';
    const bg = scenery ? `${sceneIn(card, theme, 4, 4, W - 8, H - 8, town, ++cardN, true)}<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="13" fill="${t.stock}" opacity=".12"/>` : `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="13" fill="${t.court}"/>`;
    middle = `${bg}<svg x="44" y="52" width="162" height="244" viewBox="0 0 200 320" preserveAspectRatio="xMidYMax meet">${figureBody(look, opts)}</svg>${ribbon}`;
  } else {
    /* Number cards and Aces: the suit's place in town, behind a card-stock veil so the rank and
       pips stay readable. Every pip and number also gets a stock-coloured outline. */
    const halo = `stroke="${t.stock}" stroke-width="7" paint-order="stroke" stroke-linejoin="round"`;
    /* the place fills the whole card, edge to edge, under a light veil */
    const back = scenery ? `${sceneIn(card, theme, 4, 4, W - 8, H - 8, town, ++cardN)}<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="13" fill="${t.stock}" opacity="${r === 'A' ? 0.16 : 0.38}"/>` : '';
    const hp = (s) => (scenery ? s.replace('<path ', `<path ${halo} `) : s);
    if (layout === 'big' || r === 'A') {
      middle = back + (r === 'A' ? hp(pip(suit, 125, 176, layout === 'big' ? 96 : 120, ink)) : `<text x="125" y="196" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${r === '10' ? 112 : 132}" letter-spacing="${r === '10' ? -8 : 0}" fill="${ink}" ${scenery ? halo : ''}>${r}</text>${hp(pip(suit, 125, 250, 64, ink))}`);
    } else {
      const n = +r, x0 = 86, x1 = 164, y0 = 94, y1 = 260;
      const size = n <= 3 ? 60 : n <= 6 ? 50 : 42;
      middle = back + PIPS[n].map(([cx, cy]) => hp(pip(suit, x0 + cx * (x1 - x0), y0 + cy * (y1 - y0), size, ink, cy > 0.5))).join('');
    }
  }
  /* the corner index sits on the scene too, so it gets the same stock-coloured outline */
  const onScene = scenery || ['J', 'Q', 'K', 'joker'].includes(card.rank);
  const ix = (s) => (onScene ? s.replace(/<(text|path) /g, `<$1 stroke="${t.stock}" stroke-width="6" paint-order="stroke" stroke-linejoin="round" `) : s);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${frame} fill="${t.stock}" stroke="${t.edge}" stroke-width="4"/>${middle}${ix(idx(false))}${ix(idx(true))}</svg>`;
}
