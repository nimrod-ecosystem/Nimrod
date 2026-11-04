/* catKit.js: Nimrod the cat as separate parts (notes 58 and 60), so motions from motionKit.js play on him.
 *
 *   catSvg({ motion, animated = true, face, label, outfit, theme }) → '<svg …>' 200×320, standing on the bottom edge,
 *   outfit: a CAT_OUTFITS id ('none' to start); theme: dresses him in CAT_PICK[theme] when no outfit is given.
 *   the same box and placement as castSvg's cat image, so it drops in where the image was.
 *
 * The shapes are taken from assets/nimrod-cat/idle.svg (the outline pass, the fill pass, the legs and
 * the face), split into a body, a tail and a head. Nothing is redrawn except the "happy" eyes, which
 * are new (2026-11-02). Joints: root (his feet), neck (where the head meets the body), tail (its root).
 */
import { MOTIONS, motionCss, stillAttrs } from './motion_kit.js';

/* in the cat's own 208-unit drawing, then placed into 200×320 like the old image */
export const CAT_PIVOTS_LOCAL = { root: [100, 196], neck: [100, 114], tail: [142, 180] };
const PLACE = { x: 20, y: 150, k: 170 / 208, o: 4 };
const toBox = ([x, y]) => [Math.round((PLACE.x + (x + PLACE.o) * PLACE.k) * 100) / 100, Math.round((PLACE.y + (y + PLACE.o) * PLACE.k) * 100) / 100];
export const CAT_PIVOTS = Object.fromEntries(Object.entries(CAT_PIVOTS_LOCAL).map(([k, v]) => [k, toBox(v)]));

const GREY = '#6f7884', BLACK = '#17181c';
const BODY = 'M58 194 C50 158 64 118 100 112 C136 118 150 158 142 194 Z';
const TAIL = 'M138 186 C168 190 186 172 180 146 C177 132 164 130 163 140 C169 154 166 172 142 174 Z';
const LEGS = ['M78 138 H96 V188 Q96 196 87 196 Q78 196 78 188 Z', 'M74 192 A13 7 0 1 0 100 192 A13 7 0 1 0 74 192 Z', 'M104 138 H122 V188 Q122 196 113 196 Q104 196 104 188 Z', 'M100 192 A13 7 0 1 0 126 192 A13 7 0 1 0 100 192 Z'];
const HEAD = 'M100 36 C133 36 147 58 147 80 C147 104 127 118 100 118 C73 118 53 104 53 80 C53 58 67 36 100 36 Z';
const EARS = ['M58 72 Q58 44 62 20 Q80 30 94 42 Z', 'M142 72 Q142 44 138 20 Q120 30 106 42 Z'];
const two = (ds) => `<g fill="${GREY}" stroke="${GREY}" stroke-width="7" stroke-linejoin="round">${ds.map((d) => `<path d="${d}"/>`).join('')}</g><g fill="${BLACK}">${ds.map((d) => `<path d="${d}"/>`).join('')}</g>`;

function eyes(face, id) {
  if (face === 'happy') return `<path d="M69 80q11-11 22 0M109 80q11-11 22 0" stroke="#F2CD62" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
  return [80, 120].map((x) => `<ellipse cx="${x}" cy="78" rx="12" ry="10.5" fill="url(#${id}iris)" stroke="#8f8a3a" stroke-width="1.4"/><ellipse cx="${x}" cy="79" rx="3.8" ry="7.4" fill="#0b0b0d"/><circle cx="${x - 3.4}" cy="75" r="2.3" fill="#fff" opacity=".92"/>`).join('');
}

/* ---------- Nimrod's wardrobe (Mike, 2026-11-02: "It would be nice if Nimrod had outfits too"; 2026-11-03: two for every theme): 44 outfits plus none ----------
   Separate pieces, like the people's wardrobe: a HAT rides on his head (it nods and turns with him), a NECK piece
   and a BODY piece ride on his body. Any outfit can be worn in any theme; CAT_PICK is only what each theme starts
   with, and 'none' is always there. Drawn in the cat's own 208-unit space: head top about y 36, ears up to y 20,
   chin about y 118, body 58..142 wide down to y 194. Nothing covers his eyes or mouth, so his face still reads. */
const CAT_HATS = {
  witch: (c) => `<ellipse cx="100" cy="40" rx="50" ry="9" fill="${c.a}"/><path d="M72 40L95 -22Q100 -30 105 -21L128 40Z" fill="${c.a}"/><rect x="74" y="28" width="52" height="8" fill="${c.b}"/>`,
  santa: (c) => `<path d="M64 46Q72 6 108 2Q140 2 152 42L138 36Q130 20 112 20Q88 22 84 46Z" fill="${c.a}"/><rect x="60" y="38" width="82" height="13" rx="6.5" fill="${c.b}"/><circle cx="152" cy="46" r="9" fill="${c.b}"/>`,
  beanie: (c) => `<path d="M66 48C66 16 82 6 100 6C118 6 134 16 134 48Z" fill="${c.a}"/><rect x="62" y="38" width="76" height="12" rx="6" fill="${c.b}"/><circle cx="100" cy="4" r="9" fill="${c.b}"/>`,
  topHat: (c) => `<rect x="78" y="-8" width="44" height="46" rx="3" fill="${c.a}"/><ellipse cx="100" cy="40" rx="38" ry="7" fill="${c.a}"/><rect x="78" y="24" width="44" height="7" fill="${c.b}"/>`,
  crown: (c) => `<path d="M74 44L72 16L86 30L100 8L114 30L128 16L126 44Z" fill="${c.a}"/><rect x="73" y="38" width="54" height="8" rx="2" fill="${c.c || c.a}"/>${[86, 100, 114].map((x) => `<circle cx="${x}" cy="42" r="2.8" fill="${c.b}"/>`).join('')}`,
  party: (c) => `<path d="M82 44L100 -10L118 44Z" fill="${c.a}"/><path d="M88 26L112 26M93 12L107 12" stroke="${c.b}" stroke-width="5"/><circle cx="100" cy="-10" r="7" fill="${c.b}"/>`,
  nightcap: (c) => `<path d="M68 46Q78 8 118 12Q150 18 162 62L150 58Q140 32 120 28Q96 30 92 46Z" fill="${c.a}"/><rect x="64" y="38" width="72" height="11" rx="5.5" fill="${c.b}"/><circle cx="160" cy="64" r="8" fill="${c.b}"/>`,
  sailor: (c) => `<rect x="70" y="30" width="60" height="14" rx="7" fill="${c.a}"/><ellipse cx="100" cy="30" rx="34" ry="8" fill="${c.a}"/><rect x="70" y="36" width="60" height="6" fill="${c.b}"/>`,
  sunhat: (c) => `<ellipse cx="100" cy="40" rx="58" ry="10" fill="${c.a}"/><path d="M74 40Q76 14 100 14Q124 14 126 40Z" fill="${c.a}"/><rect x="75" y="30" width="50" height="7" fill="${c.b}"/>`,
  flowers: (c) => [[64, 46], [74, 36], [88, 31], [100, 30], [112, 31], [126, 36], [136, 46]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${[c.a, c.b, c.c || c.a][i % 3]}"/><circle cx="${x}" cy="${y}" r="2.6" fill="#fff4c8"/>`).join(''),
  bunnyEars: (c) => `<path d="M62 52Q100 26 138 52" stroke="${c.a}" stroke-width="6" fill="none"/><ellipse cx="86" cy="0" rx="9" ry="26" fill="${c.a}" transform="rotate(-12 86 0)"/><ellipse cx="114" cy="0" rx="9" ry="26" fill="${c.a}" transform="rotate(12 114 0)"/><ellipse cx="86" cy="2" rx="4" ry="17" fill="${c.b}" transform="rotate(-12 86 2)"/><ellipse cx="114" cy="2" rx="4" ry="17" fill="${c.b}" transform="rotate(12 114 2)"/>`,
  headband: (c) => `<path d="M58 58Q100 34 142 58" stroke="${c.a}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M62 55Q100 33 138 55" stroke="${c.b}" stroke-width="2.5" fill="none"/>`,
  bow: (c) => `<path d="M112 34L100 24V44Z M112 34L124 24V44Z" fill="${c.a}"/><circle cx="112" cy="34" r="4" fill="${c.b}"/>`,
  /* sunglasses pushed up on his forehead, so they never cover his eyes */
  shades: (c) => `<path d="M64 50H136" stroke="${c.b}" stroke-width="3"/><rect x="68" y="42" width="26" height="14" rx="6" fill="${c.a}" stroke="${c.b}" stroke-width="3"/><rect x="106" y="42" width="26" height="14" rx="6" fill="${c.a}" stroke="${c.b}" stroke-width="3"/><path d="M73 46h7M111 46h7" stroke="#fff" stroke-width="2" opacity=".7"/>`,
  earmuffs: (c) => `<path d="M62 60Q60 22 100 20Q140 22 138 60" stroke="${c.b}" stroke-width="6" fill="none"/><circle cx="62" cy="60" r="13" fill="${c.a}"/><circle cx="138" cy="60" r="13" fill="${c.a}"/>`,
  elf: (c) => `<path d="M64 46Q76 10 104 4Q134 -4 168 30L160 40Q136 18 112 22Q88 26 86 46Z" fill="${c.a}"/><rect x="60" y="38" width="80" height="11" rx="5.5" fill="${c.b}"/><circle cx="166" cy="36" r="6" fill="${c.b}"/>`,
  goggles: (c) => `<rect x="64" y="45" width="72" height="5" fill="#4a3220"/><circle cx="85" cy="47" r="9" fill="#7fa6b0" stroke="${c.b}" stroke-width="3.5"/><circle cx="115" cy="47" r="9" fill="#7fa6b0" stroke="${c.b}" stroke-width="3.5"/>`,
};
const CAT_NECK = {
  collar: (c) => `<ellipse cx="100" cy="122" rx="30" ry="6" fill="${c.a}"/><circle cx="100" cy="130" r="5.5" fill="${c.b}"/>`,
  bell: (c) => `<ellipse cx="100" cy="122" rx="30" ry="6" fill="${c.a}"/><path d="M93 136Q93 126 100 126Q107 126 107 136Z" fill="${c.b}"/><circle cx="100" cy="137" r="2" fill="${c.b}"/>`,
  bowTie: (c) => `<path d="M100 124L84 115V133Z M100 124L116 115V133Z" fill="${c.a}"/><circle cx="100" cy="124" r="4.5" fill="${c.b}"/>`,
  scarf: (c) => `<ellipse cx="100" cy="122" rx="34" ry="9" fill="${c.a}"/><rect x="108" y="122" width="15" height="40" rx="4" fill="${c.a}" transform="rotate(-10 115 122)"/><path d="M110 160l1 7M116 159l1 7M121 158l1 7" stroke="${c.a}" stroke-width="3"/><path d="M70 120Q100 128 130 120" stroke="${c.b}" stroke-width="3" fill="none"/>`,
  bandana: (c) => `<path d="M70 118L130 118L100 152Z" fill="${c.a}"/>${[[92, 126], [108, 126], [100, 138]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="${c.b}"/>`).join('')}`,
  marigolds: (c) => [[74, 118], [84, 124], [94, 127], [106, 127], [116, 124], [126, 118]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${i % 2 ? c.a : c.b}"/>`).join(''),
};
const CAT_BODY = {
  cape: (c) => `<path d="M66 116L22 198H178L134 116Z" fill="${c.a}"/><path d="M70 122L34 196H166L130 122Z" fill="${c.b}"/><path d="M66 116L58 96L84 112Z M134 116L142 96L116 112Z" fill="${c.a}"/>`,
  /* a short jumper: it stops above his front legs, which stay in front of it */
  sweater: (c) => `<path d="M64 154C62 136 74 120 100 116C126 120 138 136 136 154Q100 162 64 154Z" fill="${c.a}"/><path d="M66 146Q100 154 134 146" stroke="${c.b}" stroke-width="5" fill="none" opacity=".85"/><path d="M84 120Q100 128 116 120" stroke="${c.b}" stroke-width="5" fill="none"/>`,
};
/* Each outfit: theme, label, and up to three pieces with their colours (a main, b trim, c extra). */
export const CAT_OUTFITS = {
  none: { theme: 'any', label: 'Just Nimrod' },
  nimrodCollar: { theme: 'nimrod', label: 'Green collar', neck: ['collar', { a: '#839958', b: '#e2b45a' }] },
  medievalCrown: { theme: 'medieval', label: 'Little crown', hat: ['crown', { a: '#e2b45a', b: '#b03a2e', c: '#c9963a' }], neck: ['collar', { a: '#b03a2e', b: '#e2b45a' }] },
  cozyScarf: { theme: 'cozy', label: 'Knitted scarf', neck: ['scarf', { a: '#9e5449', b: '#d8c8a8' }] },
  cozySweater: { theme: 'cozy', label: 'Oatmeal jumper', body: ['sweater', { a: '#d8c8a8', b: '#9a7a52' }] },
  springFlowers: { theme: 'spring', label: 'Flower crown', hat: ['flowers', { a: '#f4c6d2', b: '#f2e08a', c: '#b8d8f0' }] },
  summerHat: { theme: 'summer', label: 'Sun hat and bandana', hat: ['sunhat', { a: '#e8d6a0', b: '#2aa8a8' }], neck: ['bandana', { a: '#2aa8a8', b: '#fbf6ea' }] },
  fallBeanie: { theme: 'fall', label: 'Beanie and scarf', hat: ['beanie', { a: '#c96a21', b: '#f4e2c4' }], neck: ['scarf', { a: '#9e5449', b: '#f4e2c4' }] },
  winterBeanie: { theme: 'winter', label: 'Bobble hat and scarf', hat: ['beanie', { a: '#b0303e', b: '#f4f6f8' }], neck: ['scarf', { a: '#2a5aa8', b: '#f4f6f8' }] },
  nightCap: { theme: 'night', label: 'Nightcap', hat: ['nightcap', { a: '#26305a', b: '#f2d24a' }] },
  oceanSailor: { theme: 'ocean', label: 'Sailor cap', hat: ['sailor', { a: '#f4f6f8', b: '#1f4a7a' }], neck: ['bandana', { a: '#1f4a7a', b: '#f4f6f8' }] },
  steampunkTopHat: { theme: 'steampunk', label: 'Top hat and goggles', hat: ['topHat', { a: '#2a1c10', b: '#9e3a2a' }], neck: ['bowTie', { a: '#9e3a2a', b: '#c9a24a' }] },
  steampunkGoggles: { theme: 'steampunk', label: 'Goggles', hat: ['goggles', { a: '#4a3220', b: '#c9a24a' }] },
  cyberBand: { theme: 'cyberpunk', label: 'Neon headband', hat: ['headband', { a: '#14121f', b: '#2de2e6' }], neck: ['collar', { a: '#ff2e88', b: '#2de2e6' }] },
  newYearParty: { theme: 'newYear', label: 'Party hat and bow tie', hat: ['party', { a: '#d9b34a', b: '#7fe0d8' }], neck: ['bowTie', { a: '#16121f', b: '#d9b34a' }] },
  lunarBow: { theme: 'lunarNewYear', label: 'Red bow and gold collar', hat: ['bow', { a: '#c9302b', b: '#f2c46a' }], neck: ['collar', { a: '#f2c46a', b: '#c9302b' }] },
  valentineBow: { theme: 'valentines', label: 'Heart bow', hat: ['bow', { a: '#e0587a', b: '#fbe2e8' }], neck: ['collar', { a: '#e0587a', b: '#fbe2e8' }] },
  stPatHat: { theme: 'stPatricks', label: 'Green top hat', hat: ['topHat', { a: '#2c6e49', b: '#f2c230' }] },
  easterEars: { theme: 'easter', label: 'Bunny ears', hat: ['bunnyEars', { a: '#f4f1e8', b: '#f6c8d8' }] },
  julyBandana: { theme: 'july4', label: 'Star bandana', neck: ['bandana', { a: '#2a3a6a', b: '#f4f1e8' }], hat: ['bow', { a: '#b0303e', b: '#f4f1e8' }] },
  halloweenWitch: { theme: 'halloween', label: 'Witch hat and cape', hat: ['witch', { a: '#2a1f3a', b: '#f2a03c' }], body: ['cape', { a: '#16121f', b: '#5a3a9a' }] },
  diwaliGarland: { theme: 'diwali', label: 'Marigold garland', neck: ['marigolds', { a: '#ffc457', b: '#e8833a' }] },
  harvestStraw: { theme: 'harvest', label: 'Straw hat and scarf', hat: ['sunhat', { a: '#e2c46a', b: '#8a5a32' }], neck: ['scarf', { a: '#c96a21', b: '#f4ede0' }] },
  hanukkahBeanie: { theme: 'hanukkah', label: 'Blue bobble hat', hat: ['beanie', { a: '#2a5aa8', b: '#f4f6f8' }], neck: ['scarf', { a: '#c9cfd8', b: '#2a5aa8' }] },
  christmasSanta: { theme: 'christmas', label: 'Santa hat and bell', hat: ['santa', { a: '#c9302b', b: '#f4f1e8' }], neck: ['bell', { a: '#225634', b: '#e8d48a' }] },
  /* second outfits (Mike, 2026-11-03: "Can Nimrod have outfits for each theme, please?"), so every theme has two, as the people do */
  nimrodBandana: { theme: 'nimrod', label: 'Garden bandana', neck: ['bandana', { a: '#839958', b: '#F7F4D5' }] },
  medievalCape: { theme: 'medieval', label: 'Royal cape', body: ['cape', { a: '#b03a2e', b: '#e2b45a' }], neck: ['collar', { a: '#e2b45a', b: '#b03a2e' }] },
  springBow: { theme: 'spring', label: 'Bow and bandana', hat: ['bow', { a: '#f4c6d2', b: '#f2e08a' }], neck: ['bandana', { a: '#a8d0a0', b: '#fbf6ea' }] },
  summerShades: { theme: 'summer', label: 'Sunglasses', hat: ['shades', { a: '#2a8a9e', b: '#f2c230' }], neck: ['collar', { a: '#f2a03c', b: '#f2c230' }] },
  fallLeaves: { theme: 'fall', label: 'Leaf crown', hat: ['flowers', { a: '#c96a21', b: '#9e5449', c: '#d99a3f' }] },
  winterEarmuffs: { theme: 'winter', label: 'Earmuffs and jumper', hat: ['earmuffs', { a: '#f2efe6', b: '#2f6d96' }], body: ['sweater', { a: '#e8eef4', b: '#2a5aa8' }] },
  nightMoonBow: { theme: 'night', label: 'Moon bow and collar', hat: ['bow', { a: '#f2d24a', b: '#26305a' }], neck: ['collar', { a: '#26305a', b: '#f2d24a' }] },
  oceanRainHat: { theme: 'ocean', label: 'Rain hat', hat: ['sunhat', { a: '#f2c230', b: '#d8a820' }], neck: ['collar', { a: '#2f5a7a', b: '#f2c230' }] },
  cyberGoggles: { theme: 'cyberpunk', label: 'Glow goggles', hat: ['goggles', { a: '#14121f', b: '#ff2e88' }], neck: ['collar', { a: '#2de2e6', b: '#ff2e88' }] },
  newYearTopHat: { theme: 'newYear', label: 'Top hat and bow tie', hat: ['topHat', { a: '#16161e', b: '#d9b34a' }], neck: ['bowTie', { a: '#d9b34a', b: '#16161e' }] },
  lunarScarf: { theme: 'lunarNewYear', label: 'Red and gold scarf', neck: ['scarf', { a: '#c9302b', b: '#f2c46a' }] },
  valentineRoses: { theme: 'valentines', label: 'Rose crown', hat: ['flowers', { a: '#b0303e', b: '#e0587a', c: '#fbe2e8' }] },
  stPatBeanie: { theme: 'stPatricks', label: 'Green bobble hat and bow tie', hat: ['beanie', { a: '#3c8f46', b: '#f4f1e8' }], neck: ['bowTie', { a: '#2c6e49', b: '#f2c230' }] },
  easterFlowers: { theme: 'easter', label: 'Spring flower crown', hat: ['flowers', { a: '#c8b8f0', b: '#f2e08a', c: '#f6c8d8' }], neck: ['collar', { a: '#b8d8f0', b: '#f2e08a' }] },
  julyTopHat: { theme: 'july4', label: 'Star top hat', hat: ['topHat', { a: '#f4f1e8', b: '#b0303e' }], neck: ['bowTie', { a: '#2a3a6a', b: '#f4f1e8' }] },
  halloweenPumpkin: { theme: 'halloween', label: 'Pumpkin hat', hat: ['beanie', { a: '#e8833a', b: '#4d7a3a' }], neck: ['bandana', { a: '#5a3a9a', b: '#f2a03c' }] },
  diwaliCrown: { theme: 'diwali', label: 'Festival crown and scarf', hat: ['crown', { a: '#ffc457', b: '#e8502b', c: '#e8a83a' }], neck: ['scarf', { a: '#b02a7a', b: '#ffc457' }] },
  harvestBandana: { theme: 'harvest', label: 'Red bandana', neck: ['bandana', { a: '#a8401e', b: '#f4e2c4' }], hat: ['bow', { a: '#d0a030', b: '#8a5a12' }] },
  hanukkahCollar: { theme: 'hanukkah', label: 'Silver collar and bow', hat: ['bow', { a: '#2a5aa8', b: '#c9cfd8' }], neck: ['collar', { a: '#c9cfd8', b: '#2a5aa8' }] },
  christmasElf: { theme: 'christmas', label: 'Elf hat', hat: ['elf', { a: '#2f7a3a', b: '#e8d48a' }], neck: ['bell', { a: '#c9302b', b: '#e8d48a' }] },
};
/* What he wears in each theme to start with. A person can pick any outfit, or none. */
export const CAT_PICK = Object.fromEntries(Object.entries(CAT_OUTFITS).filter(([, o]) => o.theme !== 'any').reverse().map(([k, o]) => [o.theme, k]));
export const catOutfitFor = (theme) => CAT_PICK[theme] || 'none';
const piece = (table, p) => (p && table[p[0]] ? table[p[0]](p[1]) : '');

let N = 0;
const g = (j, st, inner) => `<g class="m-${j}"${st[j] ? ` transform="${st[j]}"` : ''}>${inner}</g>`;

export function catBody({ face = 'neutral', still = {}, id = 'cat' + ++N, outfit = 'none' } = {}) {
  const o = CAT_OUTFITS[outfit] || CAT_OUTFITS.none;
  const local = Object.fromEntries(Object.entries(still).filter(([k]) => k !== 'face' && k !== 'rootOpacity'));
  const st = { ...local, face: still.face };
  const tail = g('tail', st, two([TAIL]));
  const body = two([BODY]) + `<g fill="${BLACK}" stroke="#25272c" stroke-width="1.5" stroke-linejoin="round">${LEGS.map((d) => `<path d="${d}"/>`).join('')}</g>` + piece(CAT_BODY, o.body && o.body[0] === 'sweater' ? o.body : null);
  const legsOutline = `<g fill="${GREY}" stroke="${GREY}" stroke-width="7" stroke-linejoin="round">${LEGS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const faceArt = `<g class="m-face"${st.face ? ` transform="${st.face}"` : ''}>${eyes(face, id)}<path d="M94.5 91 H105.5 L100 97.5 Z" fill="#3b3238" stroke="#5b4f57" stroke-width=".8" stroke-linejoin="round"/>${face === 'happy' ? `<path d="M100 97.5 Q100 104 93 105 M100 97.5 Q100 104 107 105" fill="none" stroke="#6a5e68" stroke-width="2" stroke-linecap="round"/>` : `<path d="M100 97.5 Q100 103 94 104.5 M100 97.5 Q100 103 106 104.5" fill="none" stroke="#6a5e68" stroke-width="1.8" stroke-linecap="round"/>`}<path d="M86 98 L44 90 M114 98 L156 90 M86 98 L42 99 M114 98 L158 99 M86 98 L46 108 M114 98 L154 108" stroke="#aab2bb" stroke-width="1.15" stroke-linecap="round" opacity=".85"/></g>`;
  const head = g('neck', st, two([HEAD, ...EARS]) + `<ellipse cx="100" cy="52" rx="26" ry="10" fill="#2b2e35" opacity=".75"/><path d="M66 60 L67 33 L87 46 Z" fill="#4d3a3f"/><path d="M134 60 L133 33 L113 46 Z" fill="#4d3a3f"/>` + faceArt + piece(CAT_HATS, o.hat));
  return `<defs><radialGradient id="${id}iris" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#F2CD62"/><stop offset="1" stop-color="#C99536"/></radialGradient></defs>`
    + g('root', st, piece(CAT_BODY, o.body && o.body[0] === 'cape' ? o.body : null) + tail + legsOutline + body + head + piece(CAT_NECK, o.neck));
}

export function catSvg({ motion, animated = true, face, label = 'Nimrod the cat', outfit = 'none', theme } = {}) {
  const wear = theme && outfit === 'none' ? catOutfitFor(theme) : outfit;
  const m = typeof motion === 'string' ? MOTIONS[motion] : motion;
  const id = 'nc' + ++N;
  const still = m ? stillAttrs(m, CAT_PIVOTS_LOCAL) : {};
  const css = m && animated ? motionCss(id, m, CAT_PIVOTS_LOCAL) : '';
  const f = face || (m && (m.face === 'happy' ? 'happy' : 'neutral')) || 'neutral';
  const name = m ? `${label}, ${m.name}` : label;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 320" role="img" aria-label="${name}" id="${id}"><title>${name}</title>${css}<g transform="translate(${PLACE.x} ${PLACE.y}) scale(${PLACE.k}) translate(${PLACE.o} ${PLACE.o})">${catBody({ face: f, still, id, outfit: wear })}</g></svg>`;
}
