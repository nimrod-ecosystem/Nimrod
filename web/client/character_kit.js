/* characterKit.js: ONE CHARACTER KIT for avatars and for the court cards.
 *
 * Plain JavaScript, no imports, so web/client can ship it as it is.
 *
 *   figureSvg(look, opts) → '<svg …>'     full body, 200×320
 *   look = { tone, hair, hairColor, beard, glasses }            what a PERSON looks like
 *   opts = { outfit, role, suit, suitColor, pose, emblem, royal } what they WEAR and hold
 *
 * The look belongs to the character. The outfit is a separate choice from the wardrobe: any
 * character can wear any outfit. A ROLE (king, queen, jack, joker) only adds its signature piece:
 * a crown, a tiara, a feathered cap or a jester hat, in the outfit's metal and colours. So the King
 * of the Halloween deck is the same King, dressed for Halloween, and he still wears his crown.
 *
 * Same build as Nimrod and the animals: flat fills, no outlines, big eyes with one catchlight. Proportions
 * are friendly and big-headed, so a face stays readable at card size.
 */

export const SUIT_PATH = {
  hearts: 'M50 90C20 68 4 50 4 31C4 15 16 5 30 5C40 5 47 11 50 19C53 11 60 5 70 5C84 5 96 15 96 31C96 50 80 68 50 90Z',
  diamonds: 'M50 2L88 50L50 98L12 50Z',
  spades: 'M50 4C30 26 6 40 6 60C6 76 20 84 32 84C40 84 45 81 48 76C46 86 42 92 33 97H67C58 92 54 86 52 76C55 81 60 84 68 84C80 84 94 76 94 60C94 40 70 26 50 4Z',
  clubs: 'M50 8A20 20 0 0 0 36 42A20 20 0 1 0 46 70C45 82 41 90 33 97H67C59 90 55 82 54 70A20 20 0 1 0 64 42A20 20 0 0 0 50 8Z',
};
export const SKIN_TONES = ['#fbe0cc', '#f3c9a6', '#e8b48a', '#d9a07a', '#c98a5a', '#a8714a', '#8a5a3a', '#6f4a32', '#4e3424'];
export const HAIR_COLOURS = ['#1b1410', '#3a2414', '#5a3a24', '#8a4a24', '#c96a21', '#d9b46a', '#e8dcc0', '#d8d4cc', '#9e5449', '#4a6ab0'];
export const HAIR_STYLES = ['short', 'long', 'curly', 'bun', 'ponytail', 'bald'];
export const POSES = ['stand', 'wave', 'talk', 'think', 'happy', 'sleep', 'point', 'listen', 'puzzled'];

export function shade(hex, k) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.min(255, Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1)))).toString(16).padStart(2, '0')).join('');
}
const shape = (suit, x, y, size, fill) => `<path transform="translate(${x - size / 2} ${y - size / 2}) scale(${size / 100})" d="${SUIT_PATH[suit]}" fill="${fill}"/>`;
let UID = 0;

/* ---------- THE WARDROBE ----------
   Each outfit: theme, label, and pieces (top, bottom, shoes, hat, neck, hands, back) with colours.
   Every one of the 21 themes has at least two. The Royal robe is the fallback for any new theme. */
export const OUTFITS = {
  royal: { theme: 'any', label: 'Royal robe', top: 'robe', bottom: 'trousers', shoes: 'shoes', c: {} },
  nimrodTunic: { theme: 'nimrod', label: 'Garden tunic', top: 'tunic', bottom: 'trousers', shoes: 'shoes', c: { top: '#839958', top2: '#0A3323', bottom: '#5d7064', shoes: '#0A3323', metal: '#e2b45a' } },
  nimrodCardigan: { theme: 'nimrod', label: 'Teal cardigan', top: 'cardigan', bottom: 'trousers', shoes: 'shoes', c: { top: '#105666', top2: '#0e4a58', shirt: '#F7F4D5', bottom: '#5d7064', shoes: '#3a2614', metal: '#e2b45a' } },
  fallSweater: { theme: 'fall', label: 'Chunky sweater', top: 'sweater', bottom: 'jeans', shoes: 'boots', neck: 'scarf', c: { top: '#c96a21', top2: '#8a3e14', bottom: '#3e5f8a', shoes: '#6b4a32', scarf: '#9e5449', metal: '#d99a3f' } },
  fallFlannel: { theme: 'fall', label: 'Flannel and beanie', top: 'flannel', bottom: 'jeans', shoes: 'boots', hat: 'beanie', c: { top: '#a8401e', top2: '#2a1a10', bottom: '#2f4a6a', shoes: '#4a2e1a', hat: '#d99a3f', hat2: '#f4e2c4', metal: '#d99a3f' } },
  winterParka: { theme: 'winter', label: 'Parka with a fur hood', back: 'hood', top: 'parka', bottom: 'trousers', shoes: 'boots', hands: 'mittens', c: { top: '#2f6d96', fur: '#f2efe6', bottom: '#3b4a68', shoes: '#5a3a24', mitt: '#9e5449', metal: '#d8dde8' } },
  winterSki: { theme: 'winter', label: 'Ski jumper', top: 'jumper', bottom: 'trousers', shoes: 'boots', hat: 'beanie', neck: 'scarf', c: { top: '#e8eef4', top2: '#2a5aa8', band: '#b0303e', bottom: '#23263a', shoes: '#3b4a68', hat: '#b0303e', hat2: '#f4f6f8', scarf: '#2a5aa8', metal: '#d8dde8' } },
  halloweenVampire: { theme: 'halloween', label: 'Vampire cape', back: 'cape', top: 'vest', bottom: 'trousers', shoes: 'shoes', c: { top: '#9e1e2e', shirt: '#f4f1e8', cape: '#16121f', lining: '#b02a3a', bottom: '#16121f', shoes: '#16121f', metal: '#c9a24a' } },
  halloweenWitch: { theme: 'halloween', label: 'Witch', top: 'dress', bottom: 'tights', shoes: 'boots', hat: 'witch', c: { top: '#5a3a9a', top2: '#f2a03c', bottom: '#2a1f3a', tights: true, shoes: '#16121f', hat: '#2a1f3a', hat2: '#f2a03c', metal: '#f2a03c' } },
  halloweenPumpkin: { theme: 'halloween', label: 'Pumpkin suit', top: 'pumpkin', bottom: 'tights', shoes: 'shoes', hat: 'stem', c: { top: '#e8833a', top2: '#4d7a3a', bottom: '#3e6a2a', shoes: '#2a1a10', hat: '#4d7a3a', metal: '#f2c46a' } },
  christmasJumper: { theme: 'christmas', label: 'Festive jumper', top: 'xmas', bottom: 'trousers', shoes: 'boots', hat: 'santa', c: { top: '#c9302b', top2: '#f4f1e8', bottom: '#225634', shoes: '#2a1a10', hat: '#c9302b', hat2: '#f4f1e8', metal: '#e8d48a' } },
  christmasElf: { theme: 'christmas', label: 'Elf', top: 'tunic', bottom: 'tights', shoes: 'curly', hat: 'elf', c: { top: '#2f7a3a', top2: '#c9302b', bottom: '#c9302b', stripe: '#f4f1e8', shoes: '#2f7a3a', hat: '#2f7a3a', hat2: '#e8d48a', metal: '#e8d48a' } },
  steampunkWaistcoat: { theme: 'steampunk', label: 'Waistcoat and top hat', top: 'waistcoat', bottom: 'trousers', shoes: 'boots', hat: 'tophat', c: { top: '#f4ead2', top2: '#7a4a24', accent: '#9e3a2a', bottom: '#4a3420', shoes: '#2a1c10', hat: '#2a1c10', hat2: '#9e3a2a', metal: '#c9a24a', goggles: true } },
  steampunkAviator: { theme: 'steampunk', label: 'Aviator coat', top: 'coat', bottom: 'trousers', shoes: 'boots', hat: 'aviator', neck: 'scarf', c: { top: '#6b4a32', top2: '#4a3220', shirt: '#e8dcc0', bottom: '#3a2a18', shoes: '#2a1c10', hat: '#5a3c24', scarf: '#e8dcc0', metal: '#c9a24a', goggles: true } },
  cozyKnit: {"theme":"cozy","label":"Oatmeal knit","top":"sweater","bottom":"trousers","shoes":"shoes","neck":"scarf","c":{"top":"#d8c8a8","top2":"#9a7a52","bottom":"#6b5a48","shoes":"#4a3428","scarf":"#9e5449","metal":"#c9a24a"}},
  cozyCardigan: {"theme":"cozy","label":"Reading cardigan","top":"cardigan","bottom":"trousers","shoes":"shoes","c":{"top":"#8a6a9a","top2":"#5a4468","shirt":"#f4ede0","bottom":"#4a4a58","shoes":"#3a2a20","metal":"#c9a24a"}},
  cyberJacket: {"theme":"cyberpunk","label":"Neon jacket","top":"coat","bottom":"trousers","shoes":"boots","hat":"headband","c":{"top":"#1e1a3a","top2":"#ff2e88","shirt":"#2de2e6","bottom":"#14121f","shoes":"#ff2e88","hat":"#14121f","hat2":"#2de2e6","metal":"#2de2e6"}},
  cyberHoodie: {"theme":"cyberpunk","label":"Glow jumper","top":"jumper","bottom":"trousers","shoes":"boots","c":{"top":"#2a1f4a","top2":"#2de2e6","band":"#ff2e88","bottom":"#14121f","shoes":"#2de2e6","metal":"#2de2e6"}},
  oceanSailor: {"theme":"ocean","label":"Sailor top","top":"tunic","bottom":"trousers","shoes":"shoes","hat":"cap","c":{"top":"#f4f6f8","top2":"#1f4a7a","bottom":"#1f4a7a","shoes":"#2a2a33","hat":"#f4f6f8","hat2":"#1f4a7a","metal":"#e2b45a"}},
  oceanSlicker: {"theme":"ocean","label":"Rain slicker","top":"parka","bottom":"trousers","shoes":"boots","hat":"sunhat","c":{"top":"#f2c230","bottom":"#2f5a7a","shoes":"#f2c230","hat":"#f2c230","hat2":"#d8a820","metal":"#e8eef4"}},
  nightPyjamas: {"theme":"night","label":"Star pyjamas","top":"jumper","bottom":"trousers","shoes":"shoes","hat":"beanie","c":{"top":"#26305a","top2":"#f2d24a","band":"#f2d24a","bottom":"#26305a","shoes":"#8a6a9a","hat":"#26305a","hat2":"#f2d24a","metal":"#f2d24a"}},
  nightStargazer: {"theme":"night","label":"Stargazer coat","top":"coat","bottom":"trousers","shoes":"boots","neck":"scarf","c":{"top":"#1b2a4a","top2":"#0e1a32","shirt":"#c9d4e8","bottom":"#14182a","shoes":"#3a2a20","scarf":"#f2d24a","metal":"#d8dde8"}},
  springDress: {"theme":"spring","label":"Garden dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"sunhat","c":{"top":"#f4c6d2","top2":"#6c9e5c","bottom":"#f4ede0","shoes":"#6c9e5c","hat":"#f2e6c4","hat2":"#e86a8a","metal":"#e2b45a"}},
  springCardigan: {"theme":"spring","label":"Light cardigan","top":"cardigan","bottom":"jeans","shoes":"shoes","c":{"top":"#a8d0a0","top2":"#6c9e5c","shirt":"#fbf6ea","bottom":"#5a7aa0","shoes":"#f4ede0","metal":"#e2b45a"}},
  summerShirt: {"theme":"summer","label":"Beach shirt","top":"tunic","bottom":"trousers","shoes":"shoes","hat":"sunhat","c":{"top":"#2aa8a8","top2":"#f2c230","bottom":"#e8dcc0","shoes":"#8a5a32","hat":"#e8d6a0","hat2":"#2aa8a8","metal":"#f2c230"}},
  summerDress: {"theme":"summer","label":"Sun dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"cap","c":{"top":"#f2a03c","top2":"#fbf6ea","bottom":"#f3c9a6","shoes":"#c96a21","hat":"#fbf6ea","hat2":"#f2a03c","metal":"#f2c230"}},
  newYearTux: {"theme":"newYear","label":"Party tuxedo","top":"waistcoat","bottom":"trousers","shoes":"shoes","hat":"tophat","c":{"top":"#f4f4f8","top2":"#16161e","accent":"#d9b34a","bottom":"#16161e","shoes":"#16161e","hat":"#16161e","hat2":"#d9b34a","metal":"#d9b34a"}},
  newYearParty: {"theme":"newYear","label":"Sparkle dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"party","c":{"top":"#d9b34a","top2":"#16161e","bottom":"#16161e","shoes":"#d9b34a","hat":"#7fe0d8","hat2":"#ffd36e","metal":"#d9b34a"}},
  lunarJacket: {"theme":"lunarNewYear","label":"Silk jacket","top":"vest","bottom":"trousers","shoes":"shoes","c":{"top":"#c9302b","shirt":"#f2c46a","bottom":"#1a0e14","shoes":"#1a0e14","metal":"#f2c46a"}},
  lunarDress: {"theme":"lunarNewYear","label":"Red qipao","top":"dress","bottom":"tights","shoes":"shoes","hat":"garland","c":{"top":"#c9302b","top2":"#f2c46a","bottom":"#c9302b","shoes":"#1a0e14","hat":"#f2a8c0","hat2":"#fbe2e8","accent":"#f2c46a","metal":"#f2c46a"}},
  valentineJumper: {"theme":"valentines","label":"Heart jumper","top":"sweater","bottom":"jeans","shoes":"shoes","neck":"scarf","c":{"top":"#e0587a","top2":"#9c3357","bottom":"#4a5a7a","shoes":"#9c3357","scarf":"#fbe2e8","metal":"#e8b4c4"}},
  valentineDress: {"theme":"valentines","label":"Rose dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"garland","c":{"top":"#b0303e","top2":"#fbe2e8","bottom":"#fbe2e8","shoes":"#b0303e","hat":"#e0587a","hat2":"#fbe2e8","accent":"#b0303e","metal":"#e8b4c4"}},
  stPatTophat: {"theme":"stPatricks","label":"Green top hat","top":"waistcoat","bottom":"trousers","shoes":"shoes","hat":"tophat","c":{"top":"#f4f1e8","top2":"#2c6e49","accent":"#f2c230","bottom":"#2c6e49","shoes":"#2a1a10","hat":"#2c6e49","hat2":"#f2c230","metal":"#f2c230"}},
  stPatJumper: {"theme":"stPatricks","label":"Clover jumper","top":"jumper","bottom":"jeans","shoes":"boots","hat":"cap","c":{"top":"#3c8f46","top2":"#f4f1e8","band":"#f2c230","bottom":"#3e5f8a","shoes":"#4a2e1a","hat":"#2c6e49","hat2":"#f4f1e8","metal":"#f2c230"}},
  easterBunny: {"theme":"easter","label":"Bunny ears","top":"jumper","bottom":"trousers","shoes":"shoes","hat":"ears","c":{"top":"#c8e6b8","top2":"#f6c8d8","band":"#b8a8e8","bottom":"#8a8aa8","shoes":"#f4ede0","hat":"#f4f1e8","hat2":"#f6c8d8","metal":"#f2e08a"}},
  easterDress: {"theme":"easter","label":"Lilac dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"sunhat","c":{"top":"#c8b8f0","top2":"#f2e08a","bottom":"#fbf6ea","shoes":"#8a6ac0","hat":"#f2e6c4","hat2":"#b8d8f0","metal":"#f2e08a"}},
  julyShirt: {"theme":"july4","label":"Stars and stripes","top":"tunic","bottom":"jeans","shoes":"shoes","hat":"cap","c":{"top":"#b0303e","top2":"#f4f1e8","bottom":"#2a3a6a","shoes":"#f4f1e8","hat":"#2a3a6a","hat2":"#b0303e","metal":"#f4f1e8"}},
  julyDress: {"theme":"july4","label":"Picnic dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"sunhat","c":{"top":"#2a3a6a","top2":"#b0303e","bottom":"#f4f1e8","shoes":"#b0303e","hat":"#f2e6c4","hat2":"#b0303e","metal":"#f4f1e8"}},
  diwaliKurta: {"theme":"diwali","label":"Saffron kurta","top":"coat","bottom":"trousers","shoes":"shoes","c":{"top":"#e8833a","top2":"#b0521e","shirt":"#f2c46a","bottom":"#f4ede0","shoes":"#8a3e14","metal":"#ffc457"}},
  diwaliDress: {"theme":"diwali","label":"Festival dress","top":"dress","bottom":"tights","shoes":"shoes","hat":"garland","c":{"top":"#b02a7a","top2":"#ffc457","bottom":"#b02a7a","shoes":"#ffc457","hat":"#ffc457","hat2":"#e8502b","accent":"#f4ede0","metal":"#ffc457"}},
  harvestCardigan: {"theme":"harvest","label":"Mustard cardigan","top":"cardigan","bottom":"trousers","shoes":"boots","c":{"top":"#d0a030","top2":"#8a5a12","shirt":"#f4ede0","bottom":"#6b4a32","shoes":"#4a2e1a","metal":"#d99a3f"}},
  harvestApron: {"theme":"harvest","label":"Baker’s apron","top":"waistcoat","bottom":"jeans","shoes":"boots","neck":"scarf","c":{"top":"#f4ede0","top2":"#8a3e1a","accent":"#c96a21","bottom":"#3e5f8a","shoes":"#4a2e1a","scarf":"#c96a21","metal":"#d99a3f"}},
  hanukkahJumper: {"theme":"hanukkah","label":"Blue and white jumper","top":"jumper","bottom":"trousers","shoes":"shoes","hat":"beanie","c":{"top":"#2a5aa8","top2":"#f4f6f8","band":"#c9cfd8","bottom":"#1e263c","shoes":"#3a2a20","hat":"#2a5aa8","hat2":"#f4f6f8","metal":"#c9cfd8"}},
  hanukkahCardigan: {"theme":"hanukkah","label":"Silver cardigan","top":"cardigan","bottom":"trousers","shoes":"shoes","neck":"scarf","c":{"top":"#1e3a6a","top2":"#c9cfd8","shirt":"#f4f6f8","bottom":"#2a2f3a","shoes":"#1e1e26","scarf":"#c9cfd8","metal":"#c9cfd8"}},
  wizardRobe: { theme: 'village', label: 'Wizard robe', top: 'wizard', bottom: 'trousers', shoes: 'shoes', hat: 'wizard', c: { top: '#3f3a8a', top2: '#f2d24a', bottom: '#2a2650', shoes: '#4a2e1a', hat: '#3f3a8a', hat2: '#f2d24a', metal: '#c9a24a' } },
  knightBlue: { theme: 'village', label: 'Knight, blue tabard', top: 'armour', bottom: 'trousers', shoes: 'boots', hat: 'helmet', c: { top: '#b8c0c8', top2: '#2f5a9a', bottom: '#5a6068', shoes: '#3a3f46', hat: '#c9cfd6', hat2: '#2f5a9a', metal: '#e2b45a' } },
  knightRed: { theme: 'village', label: 'Knight, red tabard', top: 'armour', bottom: 'trousers', shoes: 'boots', hat: 'helmet', c: { top: '#b8c0c8', top2: '#a8362e', bottom: '#5a6068', shoes: '#3a3f46', hat: '#c9cfd6', hat2: '#f2c230', metal: '#f4f1e8' } },
  princessDress: { theme: 'village', label: 'Princess dress', top: 'dress', bottom: 'tights', shoes: 'shoes', hat: 'tiara', c: { top: '#e88aa8', top2: '#f2d24a', bottom: '#f4ede0', shoes: '#b0306a', hat: '#f2c230', hat2: '#5ab0c8', metal: '#f2c230' } },
  princeTunic: { theme: 'village', label: 'Prince tunic', top: 'tunic', bottom: 'trousers', shoes: 'boots', hat: 'circlet', c: { top: '#3a6ab0', top2: '#f2c230', bottom: '#5a4a3a', shoes: '#4a2e1a', hat: '#f2c230', hat2: '#b03a2e', metal: '#f2c230' } },
  medievalTunic: {"theme":"medieval","label":"Belted tunic","top":"tunic","bottom":"tights","shoes":"boots","hat":"hood","c":{"top":"#5d7d44","top2":"#3e5a2a","bottom":"#6b4a32","shoes":"#4a2e1a","hat":"#8a6a4a","hat2":"#5a3a24","metal":"#c9a24a"}},
  medievalKirtle: {"theme":"medieval","label":"Kirtle","top":"dress","bottom":"tights","shoes":"shoes","hat":"coif","c":{"top":"#2f5a9a","top2":"#e8d6a0","bottom":"#2f5a9a","shoes":"#4a2e1a","hat":"#f4f1e8","hat2":"#d8cfb8","metal":"#c9a24a"}},
  bakerWhites: {"theme":"medieval","label":"Baker’s whites","top":"waistcoat","bottom":"trousers","shoes":"shoes","hat":"bakerHat","c":{"top":"#f4f1e8","top2":"#d8cfb8","accent":"#c8964a","bottom":"#8a7a64","shoes":"#4a2e1a","hat":"#fbf9ef","hat2":"#e8e2d2","metal":"#c8964a"}},
  shopkeeperVest: {"theme":"medieval","label":"Shopkeeper’s vest","top":"vest","bottom":"trousers","shoes":"shoes","c":{"top":"#9e5449","shirt":"#efe2c8","bottom":"#4a4038","shoes":"#2a1a10","metal":"#e8b84a"}},
  blacksmithApron: {"theme":"medieval","label":"Leather apron","top":"waistcoat","bottom":"trousers","shoes":"boots","c":{"top":"#6b4a32","top2":"#3a2614","accent":"#8a8f96","bottom":"#3a3530","shoes":"#2a1a10","metal":"#8a8f96"}},
  farmerSmock: {"theme":"medieval","label":"Farmer’s smock","top":"tunic","bottom":"trousers","shoes":"boots","hat":"sunhat","c":{"top":"#c8b48a","top2":"#8a7450","bottom":"#5a6a3a","shoes":"#4a2e1a","hat":"#e2c46a","hat2":"#8a5a32","metal":"#a8794e"}},
  librarianRobe: {"theme":"medieval","label":"Scholar’s robe","top":"coat","bottom":"trousers","shoes":"shoes","hat":"coif","c":{"top":"#4a3a6a","top2":"#2f2448","shirt":"#efe2c8","bottom":"#2f2448","shoes":"#2a1a10","hat":"#4a3a6a","hat2":"#c9a24a","metal":"#c9a24a"}},
};
export const OUTFIT_THEMES = ['medieval', 'nimrod', 'cozy', 'spring', 'summer', 'fall', 'winter', 'night', 'ocean', 'steampunk', 'cyberpunk', 'newYear', 'lunarNewYear', 'valentines', 'stPatricks', 'easter', 'july4', 'halloween', 'diwali', 'harvest', 'hanukkah', 'christmas'];

/* ---------- pieces ---------- */
const TORSO = 'M60 130Q60 120 74 118L126 118Q140 120 140 130L144 232L56 232Z';
function top(kind, c, r) {
  const T = (fill, d = TORSO) => `<path d="${d}" fill="${fill}"/>`;
  switch (kind) {
    case 'tunic': return T(c.top) + `<path d="M90 119L100 136L110 119Z" fill="${c.top2}"/><rect x="57" y="192" width="86" height="10" fill="${c.top2}"/><rect x="94" y="190" width="12" height="14" rx="2" fill="${c.metal}"/>`;
    case 'cardigan': return T(c.top) + `<rect x="90" y="119" width="20" height="113" fill="${c.shirt}"/><path d="M90 119V232M110 119V232" stroke="${c.top2}" stroke-width="3"/>${[150, 175, 200].map((y) => `<circle cx="113" cy="${y}" r="3" fill="${c.shirt}"/>`).join('')}<rect x="64" y="196" width="18" height="16" rx="3" fill="${c.top2}"/>`;
    case 'sweater': return T(c.top) + `<path d="M80 128q6 10 0 20t0 20t0 20t0 20t0 20M120 128q-6 10 0 20t0 20t0 20t0 20t0 20" stroke="${c.top2}" stroke-width="4" fill="none" opacity=".45"/><rect x="56" y="220" width="88" height="12" fill="${c.top2}"/><path d="M80 118Q100 132 120 118" stroke="${c.top2}" stroke-width="7" fill="none"/>`;
    case 'flannel': { const id = 'ck' + ++UID; return `<clipPath id="${id}"><path d="${TORSO}"/></clipPath>` + T(c.top) + `<g clip-path="url(#${id})" fill="${c.top2}" opacity=".42">${[60, 80, 100, 120].map((x) => `<rect x="${x}" y="110" width="7" height="130"/>`).join('')}${[134, 158, 182, 206].map((y) => `<rect x="50" y="${y}" width="100" height="7"/>`).join('')}</g><path d="M100 120V232" stroke="${c.top2}" stroke-width="2"/><path d="M84 118L100 132L116 118" fill="none" stroke="${shade(c.top, 0.7)}" stroke-width="6"/>`; }
    case 'parka': return T(c.top, 'M52 134Q54 116 74 114L126 114Q146 116 148 134L154 242L46 242Z') + `<path d="M100 118V240" stroke="${shade(c.top, 0.7)}" stroke-width="3"/><rect x="62" y="186" width="24" height="22" rx="4" fill="${shade(c.top, 0.82)}"/><rect x="114" y="186" width="24" height="22" rx="4" fill="${shade(c.top, 0.82)}"/><rect x="45" y="232" width="110" height="12" rx="6" fill="${c.fur}"/>`;
    case 'jumper': return T(c.top) + `<rect x="57" y="140" width="86" height="16" fill="${c.top2}"/><path d="M57 148${Array.from({ length: 11 }, (_, i) => `L${61 + i * 8} ${i % 2 ? 142 : 154}`).join('')}" stroke="${c.band}" stroke-width="3" fill="none"/><rect x="56" y="220" width="88" height="12" fill="${c.top2}"/>`;
    case 'xmas': return T(c.top) + `<path d="M57 140${Array.from({ length: 11 }, (_, i) => `L${61 + i * 8} ${i % 2 ? 134 : 146}`).join('')}" stroke="${c.top2}" stroke-width="4" fill="none"/><path d="M100 156L118 186H108L122 206H78L92 186H82Z" fill="#2f6a40"/><circle cx="100" cy="154" r="4" fill="${c.metal}"/><rect x="56" y="220" width="88" height="12" fill="${c.top2}"/>`;
    case 'vest': return T(c.shirt) + `<path d="M74 118L96 138V232H58L60 130Q60 120 74 118Z" fill="${c.top}"/><path d="M126 118L104 138V232H142L140 130Q140 120 126 118Z" fill="${c.top}"/><path d="M92 120L100 134L108 120Z" fill="${c.shirt}"/><circle cx="100" cy="146" r="6" fill="${c.metal}"/>`;
    case 'dress': return T(c.top, 'M60 130Q60 120 74 118L126 118Q140 120 140 130L158 264L42 264Z') + `<rect x="62" y="186" width="76" height="9" fill="${c.top2}"/><path d="M42 264L158 264L154 254L46 254Z" fill="${shade(c.top, 0.72)}"/>`;
    case 'pumpkin': return `<ellipse cx="100" cy="182" rx="60" ry="62" fill="${c.top}"/><path d="M76 124q-14 58 0 116M124 124q14 58 0 116M100 120V244" stroke="${shade(c.top, 0.72)}" stroke-width="4" fill="none"/><path d="M78 122Q100 140 122 122L110 116H90Z" fill="${c.top2}"/>`;
    case 'waistcoat': return T(c.top) + `<path d="M74 118L96 140V218L60 210L60 130Q60 120 74 118Z" fill="${c.top2}"/><path d="M126 118L104 140V218L140 210L140 130Q140 120 126 118Z" fill="${c.top2}"/>${[156, 176, 196].map((y) => `<circle cx="100" cy="${y}" r="3" fill="${c.metal}"/>`).join('')}<path d="M104 180q16 8 28 -4" stroke="${c.metal}" stroke-width="2.4" fill="none"/><circle cx="133" cy="175" r="5" fill="${c.metal}"/><path d="M90 120L100 140L110 120Z" fill="${c.accent}"/>`;
    case 'coat': return T(c.top, 'M58 130Q58 118 74 116L126 116Q142 118 142 130L150 282L50 282Z') + `<path d="M92 118L100 150L108 118V282H92Z" fill="${c.shirt}"/><path d="M74 116L92 150L88 118Z" fill="${c.top2}"/><path d="M126 116L108 150L112 118Z" fill="${c.top2}"/><rect x="50" y="200" width="100" height="8" fill="${c.top2}"/><rect x="94" y="198" width="12" height="12" rx="2" fill="${c.metal}"/>`;
    case 'wizard': return T(c.top, 'M58 130Q58 118 74 116L126 116Q142 118 142 130L158 296L42 296Z') + `<path d="M100 118L92 296M100 118L108 296" stroke="${shade(c.top, 0.8)}" stroke-width="2" opacity=".6"/>${[[72, 170], [128, 200], [80, 250], [122, 268], [100, 222]].map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0 -8L2.4 -2.4L8 0L2.4 2.4L0 8L-2.4 2.4L-8 0L-2.4 -2.4Z" fill="${c.top2}"/>`).join('')}<path d="M60 196Q100 206 140 196" stroke="${c.metal}" stroke-width="5" fill="none"/><path d="M120 200l6 26M126 200l-2 22" stroke="${c.metal}" stroke-width="4"/>`;
    case 'armour': return T(c.top) + `<path d="M60 150H140M58 176H142M58 202H142" stroke="${shade(c.top, 0.72)}" stroke-width="3"/><path d="M80 120H120L116 238H84Z" fill="${c.top2}"/><path d="M100 142C92 142 88 148 88 156C88 168 100 176 100 176C100 176 112 168 112 156C112 148 108 142 100 142Z" fill="${c.metal}"/><ellipse cx="62" cy="128" rx="16" ry="11" fill="${shade(c.top, 1.12)}"/><ellipse cx="138" cy="128" rx="16" ry="11" fill="${shade(c.top, 1.12)}"/><rect x="58" y="214" width="84" height="10" fill="${shade(c.top, 0.6)}"/>`;
    case 'robe': default: {
      const m = r.main || '#b03a2e', tr = r.trim || '#e2b45a';
      return T(m, 'M58 130Q58 118 74 116L126 116Q142 118 142 130L152 292L48 292Z') + `<rect x="91" y="132" width="18" height="160" fill="${tr}"/><path d="M52 130C66 112 86 110 100 118C114 110 134 112 148 130C134 142 116 142 100 133C84 142 66 142 52 130Z" fill="#f4f1e8"/>${[[66, 131], [84, 136], [116, 136], [134, 131]].map(([x, y]) => `<path d="M${x} ${y - 4}l2.6 6h-5.2z" fill="#1b1d22"/>`).join('')}`;
    }
  }
}
const sleeveOf = (o, r) => (o.top === 'robe' ? r.main || '#b03a2e' : o.top === 'pumpkin' ? o.c.top2 : o.top === 'vest' ? o.c.shirt : o.top === 'waistcoat' ? o.c.top : o.c.top);
function back(kind, c) {
  if (kind === 'hood') return `<circle cx="100" cy="84" r="58" fill="${c.top}"/><circle cx="100" cy="84" r="56" fill="none" stroke="${c.fur}" stroke-width="12"/>`;
  if (kind === 'cape') return `<path d="M58 120L24 304L176 304L142 120Z" fill="${c.cape}"/><path d="M66 126L42 300L158 300L134 126Z" fill="${c.lining}"/><path d="M62 124L44 62L88 112Z" fill="${c.cape}"/><path d="M138 124L156 62L112 112Z" fill="${c.cape}"/><path d="M66 120L52 74L86 112Z" fill="${c.lining}"/><path d="M134 120L148 74L114 112Z" fill="${c.lining}"/>`;
  return '';
}
function bottom(o) {
  const c = o.c, fill = c.bottom || '#3a3a3a';
  let s = `<rect x="72" y="224" width="25" height="78" rx="10" fill="${fill}"/><rect x="103" y="224" width="25" height="78" rx="10" fill="${fill}"/>`;
  if (o.bottom === 'jeans') s += `<path d="M84 232V298M116 232V298" stroke="${shade(fill, 1.35)}" stroke-width="2" stroke-dasharray="4 4"/>`;
  if (c.stripe) s += [244, 262, 280].map((y) => `<rect x="72" y="${y}" width="56" height="6" fill="${c.stripe}"/>`).join('').replace(/<rect x="72" y="(\d+)" width="56"/g, '<rect x="72" y="$1" width="25"/><rect x="103" y="$1" width="25"');
  return s;
}
function shoes(o) {
  const f = o.c.shoes || '#2a1a10';
  if (o.shoes === 'boots') return `<rect x="70" y="272" width="29" height="32" rx="6" fill="${f}"/><rect x="101" y="272" width="29" height="32" rx="6" fill="${f}"/><ellipse cx="82" cy="304" rx="19" ry="8" fill="${f}"/><ellipse cx="118" cy="304" rx="19" ry="8" fill="${f}"/>`;
  if (o.shoes === 'curly') return `<path d="M64 300Q62 288 72 294L98 296V308H70Q60 308 64 300Z" fill="${f}"/><path d="M136 300Q138 288 128 294L102 296V308H130Q140 308 136 300Z" fill="${f}"/><circle cx="64" cy="292" r="4" fill="${o.c.hat2 || '#e8d48a'}"/><circle cx="136" cy="292" r="4" fill="${o.c.hat2 || '#e8d48a'}"/>`;
  return `<ellipse cx="82" cy="304" rx="18" ry="9" fill="${f}"/><ellipse cx="118" cy="304" rx="18" ry="9" fill="${f}"/>`;
}
function neck(o) {
  if (o.neck !== 'scarf') return '';
  const f = o.c.scarf;
  return `<rect x="78" y="114" width="44" height="18" rx="9" fill="${f}"/><rect x="104" y="126" width="16" height="54" rx="4" fill="${f}" transform="rotate(-8 112 126)"/><path d="M106 180l2 8M112 180l1 8M118 179l-1 8" stroke="${f}" stroke-width="3"/>`;
}

/* ---------- hair ---------- */
function hairBack(style, col) {
  if (style === 'long') return `<path d="M52 84C44 126 44 166 56 190H144C156 166 156 126 148 84C142 44 58 44 52 84Z" fill="${col}"/>`;
  if (style === 'curly') return `<circle cx="56" cy="96" r="14" fill="${col}"/><circle cx="144" cy="96" r="14" fill="${col}"/>`;
  if (style === 'ponytail') return `<path d="M138 66C162 74 166 112 152 150C148 130 146 108 132 86Z" fill="${col}"/>`;
  return '';
}
function hairFront(style, col) {
  switch (style) {
    case 'long': return `<path d="M56 90C56 54 76 40 100 40C124 40 144 54 144 90C138 70 122 60 100 60C78 60 62 70 56 90Z" fill="${col}"/>`;
    case 'curly': return [[60, 72, 15], [72, 54, 15], [90, 44, 15], [110, 44, 15], [128, 54, 15], [140, 72, 15], [100, 50, 14]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>`).join('');
    case 'bun': return `<circle cx="100" cy="36" r="17" fill="${col}"/><path d="M56 84C56 54 76 42 100 42C124 42 144 54 144 84C136 66 122 60 100 60C78 60 64 66 56 84Z" fill="${col}"/>`;
    case 'bald': return `<path d="M57 92q-2-10 4-16M143 92q2-10-4-16" stroke="${col}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case 'ponytail':
    case 'short': default: return `<path d="M56 84C54 52 76 38 100 38C126 38 146 54 144 84C136 66 122 60 108 64C102 56 92 56 86 64C74 60 62 66 56 84Z" fill="${col}"/>`;
  }
}

/* ---------- hats: theme hats, and the four ROLE signatures ---------- */
function hat(kind, c) {
  switch (kind) {
    case 'beanie': return `<path d="M54 70C54 32 78 24 100 24C122 24 146 32 146 70Z" fill="${c.hat}"/><rect x="52" y="60" width="96" height="14" rx="7" fill="${c.hat2}"/><circle cx="100" cy="22" r="11" fill="${c.hat2}"/>`;
    case 'santa': return `<path d="M54 68C58 30 90 18 120 26C138 32 150 52 160 78L142 62C138 52 132 46 126 44Z" fill="${c.hat}"/><rect x="50" y="58" width="100" height="16" rx="8" fill="${c.hat2}"/><circle cx="160" cy="80" r="11" fill="${c.hat2}"/>`;
    case 'elf': return `<path d="M56 66L104 10Q130 20 152 50L170 56L162 62Q140 64 144 66Z" fill="${c.hat}"/><rect x="52" y="58" width="96" height="12" rx="6" fill="${c.hat2}"/><circle cx="170" cy="58" r="6" fill="${c.hat2}"/>`;
    case 'witch': return `<ellipse cx="100" cy="62" rx="66" ry="11" fill="${c.hat}"/><path d="M68 62L96 4Q100 0 104 6L118 30L132 26L124 40L134 62Z" fill="${c.hat}"/><rect x="70" y="50" width="62" height="9" fill="${c.hat2}"/>`;
    case 'stem': return `<path d="M58 66C58 40 78 32 100 32C122 32 142 40 142 66Z" fill="${c.hat}"/><path d="M98 32Q94 14 106 8" stroke="#5a4a2a" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M104 22C118 10 132 16 134 24C124 30 112 28 104 22Z" fill="${c.hat}"/>`;
    case 'sunhat': return `<ellipse cx="100" cy="62" rx="72" ry="13" fill="${c.hat}"/><path d="M64 62C64 30 82 22 100 22C118 22 136 30 136 62Z" fill="${c.hat}"/><rect x="64" y="50" width="72" height="9" fill="${c.hat2}"/>`;
    case 'cap': return `<path d="M56 70C56 36 78 28 100 28C122 28 144 36 144 70Z" fill="${c.hat}"/><path d="M122 64L172 68Q176 76 166 77L122 74Z" fill="${c.hat2}"/><circle cx="100" cy="28" r="5" fill="${c.hat2}"/>`;
    case 'party': return `<path d="M70 66L100 -4L130 66Z" fill="${c.hat}"/><path d="M80 44L120 44M88 26L112 26" stroke="${c.hat2}" stroke-width="6"/><circle cx="100" cy="-4" r="9" fill="${c.hat2}"/><path d="M68 66H132" stroke="#00000033" stroke-width="3"/>`;
    case 'ears': return `<path d="M60 70C60 48 80 40 100 40C120 40 140 48 140 70" stroke="${c.hat}" stroke-width="7" fill="none"/><ellipse cx="80" cy="16" rx="11" ry="30" fill="${c.hat}" transform="rotate(-10 80 16)"/><ellipse cx="120" cy="16" rx="11" ry="30" fill="${c.hat}" transform="rotate(10 120 16)"/><ellipse cx="80" cy="18" rx="5" ry="20" fill="${c.hat2}" transform="rotate(-10 80 18)"/><ellipse cx="120" cy="18" rx="5" ry="20" fill="${c.hat2}" transform="rotate(10 120 18)"/>`;
    case 'garland': return [[58, 66], [68, 52], [84, 44], [100, 41], [116, 44], [132, 52], [142, 66]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="9" fill="${[c.hat, c.hat2, c.accent || c.hat][i % 3]}"/><circle cx="${x}" cy="${y}" r="3" fill="#fff4c8"/>`).join('');
    case 'headband': return `<path d="M56 66C58 42 78 34 100 34C122 34 142 42 144 66" stroke="${c.hat}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M60 62C64 44 80 38 100 38C120 38 136 44 140 62" stroke="${c.hat2}" stroke-width="3" fill="none"/>`;
    case 'wizard': return `<ellipse cx="100" cy="60" rx="58" ry="11" fill="${shade(c.hat, 0.8)}"/><path d="M60 60Q76 36 88 6Q96 -14 116 -22Q104 -4 110 18Q118 40 140 60Z" fill="${c.hat}"/>${[[96, 30], [112, 46], [104, 6]].map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0 -6L1.8 -1.8L6 0L1.8 1.8L0 6L-1.8 1.8L-6 0L-1.8 -1.8Z" fill="${c.hat2}"/>`).join('')}`;
    case 'helmet': return `<path d="M54 76C54 42 76 30 100 30C124 30 146 42 146 76Z" fill="${c.hat}"/><path d="M58 64C62 46 78 38 100 38" stroke="#fff" stroke-width="4" fill="none" opacity=".35"/><rect x="52" y="70" width="96" height="9" rx="4" fill="${shade(c.hat, 0.7)}"/><path d="M100 30Q94 2 120 -10Q108 12 106 30Z" fill="${c.hat2}"/>`;
    case 'tiara': return `<path d="M70 56L78 38L88 52L100 30L112 52L122 38L130 56Z" fill="${c.hat}"/><circle cx="100" cy="44" r="4.5" fill="${c.hat2}"/><circle cx="78" cy="46" r="3" fill="${c.hat2}"/><circle cx="122" cy="46" r="3" fill="${c.hat2}"/>`;
    case 'circlet': return `<path d="M60 62Q100 50 140 62" stroke="${c.hat}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M92 54L100 40L108 54Z" fill="${c.hat}"/><circle cx="100" cy="52" r="4" fill="${c.hat2}"/>`;
    case 'bakerHat': return `<path d="M66 64V44Q50 40 54 24Q60 8 78 14Q86 0 100 2Q114 0 122 14Q140 8 146 24Q150 40 134 44V64Z" fill="${c.hat}"/><rect x="66" y="52" width="68" height="12" fill="${c.hat2}"/>`;
    case 'hood': return `<path d="M52 92C48 46 70 26 100 26C130 26 152 46 148 92C140 70 124 58 100 58C76 58 60 70 52 92Z" fill="${c.hat}"/><path d="M62 70C70 60 84 54 100 54C116 54 130 60 138 70" stroke="${c.hat2}" stroke-width="4" fill="none"/>`;
    case 'coif': return `<path d="M58 80C56 44 76 30 100 30C124 30 144 44 142 80C134 66 120 60 100 60C80 60 66 66 58 80Z" fill="${c.hat}"/>`;
    case 'tophat': return `<rect x="70" y="2" width="60" height="56" rx="4" fill="${c.hat}"/><ellipse cx="100" cy="58" rx="52" ry="9" fill="${c.hat}"/><rect x="70" y="40" width="60" height="9" fill="${c.hat2}"/>` + (c.goggles ? goggles(c, 44) : '');
    case 'aviator': return `<path d="M56 78C54 40 78 30 100 30C122 30 146 40 144 78L146 102Q136 104 134 92L134 74Q100 62 66 74L66 92Q64 104 54 102Z" fill="${c.hat}"/>` + (c.goggles ? goggles(c, 54) : '');
    default: return '';
  }
}
const goggles = (c, y) => `<rect x="70" y="${y - 2}" width="60" height="5" fill="#4a3220"/><circle cx="86" cy="${y}" r="10" fill="#7fa6b0" stroke="${c.metal || '#c9a24a'}" stroke-width="4"/><circle cx="114" cy="${y}" r="10" fill="#7fa6b0" stroke="${c.metal || '#c9a24a'}" stroke-width="4"/><circle cx="83" cy="${y - 3}" r="2.6" fill="#fff" opacity=".7"/><circle cx="111" cy="${y - 3}" r="2.6" fill="#fff" opacity=".7"/>`;
function signature(role, c, suitColor, suit) {
  const gold = c.metal || '#e2b45a', goldD = shade(gold, 0.78);
  if (role === 'king') return `<path d="M64 52L62 16L78 32L90 8L100 28L110 8L122 32L138 16L136 52Z" fill="${gold}"/><rect x="62" y="46" width="76" height="13" rx="3" fill="${goldD}"/>${[[62, 16], [90, 8], [110, 8], [138, 16]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${gold}"/>`).join('')}${[76, 100, 124].map((x) => `<circle cx="${x}" cy="52" r="4" fill="${suitColor}"/>`).join('')}`;
  if (role === 'queen') return `<path d="M68 56C68 36 76 30 82 38C86 22 96 18 100 28C104 18 114 22 118 38C124 30 132 36 132 56Z" fill="${gold}"/><rect x="66" y="50" width="68" height="9" rx="3" fill="${goldD}"/>${shape(suit || 'hearts', 100, 40, 15, suitColor)}`;
  if (role === 'jack') return `<path d="M52 66C52 34 80 26 104 28C132 30 148 44 146 66Z" fill="${shade(c.top || '#105666', 0.8)}"/><rect x="50" y="58" width="98" height="11" rx="5" fill="${gold}"/><path d="M130 58C144 32 162 18 180 14C170 30 152 48 134 62Z" fill="${c.scarf || c.top2 || gold}"/>`;
  if (role === 'joker') return `<path d="M64 62C54 40 36 42 22 80C40 66 54 62 74 56Z" fill="${c.top || '#5a3a9a'}"/><path d="M74 56C80 24 92 6 100 0C108 6 120 24 126 56Z" fill="${c.top2 || c.hat2 || '#f2a03c'}"/><path d="M136 62C146 40 164 42 178 80C160 66 146 62 126 56Z" fill="${c.top || '#5a3a9a'}"/><rect x="60" y="54" width="80" height="12" rx="6" fill="${gold}"/>${[[22, 80], [100, 4], [178, 80]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${gold}"/>`).join('')}`;
  return '';
}
function held(role, suit, suitColor, metal, emblem, tone) {
  const gold = metal || '#e2b45a', hand = `<circle cx="153" cy="206" r="10" fill="${tone}"/>`;
  if (role === 'joker') return `<rect x="150" y="128" width="6" height="88" rx="3" fill="${gold}"/><circle cx="153" cy="118" r="17" fill="${shade(gold, 0.6)}" stroke="${gold}" stroke-width="3"/>${emblem ? `<g transform="translate(141 106) scale(.24)">${emblem}</g>` : ''}${hand}`;
  if (!suit) return '';
  if (suit === 'diamonds') return `${hand}${shape('diamonds', 153, 172, 40, suitColor)}<path d="M145 168l8-12 6 8z" fill="#fff" opacity=".4"/>`;
  if (suit === 'spades') return `<path d="M149 208V112L153 96L157 112V208Z" fill="#d8dde4"/><rect x="137" y="192" width="32" height="7" rx="3" fill="${gold}"/>${shape('spades', 153, 195, 10, suitColor)}${hand}<circle cx="153" cy="226" r="5" fill="${gold}"/>`;
  return `<rect x="150" y="128" width="6" height="88" rx="3" fill="${gold}"/>${shape(suit, 153, 116, 32, suitColor)}${hand}`;
}

/* ---------- the figure ---------- */
/* Children (Princess Jess, Prince Vince): the same drawing, with a smaller body and a bigger head,
   so they read as small children rather than small adults. */
let KID = 0;
function childBody(look, opts) {
  const b = figureBody(look, { ...opts, child: false }), id = 'kid' + ++KID;
  return `<defs><clipPath id="${id}h"><rect x="-80" y="-90" width="360" height="210"/></clipPath><clipPath id="${id}b"><rect x="-80" y="116" width="360" height="260"/></clipPath></defs><g transform="translate(100 320) scale(.62) translate(-100 -320)"><g clip-path="url(#${id}b)">${b}</g></g><g transform="translate(100 196) scale(.86) translate(-100 -118)"><g clip-path="url(#${id}h)">${b}</g></g>`;
}
export function figureBody(look = {}, opts = {}) {
  if (opts.child) return childBody(look, opts);
  const L = { tone: '#e8b48a', hair: 'short', hairColor: '#3a2414', ...look };
  const o = OUTFITS[opts.outfit] || OUTFITS.royal, r = opts.royal || {};
  const c = { ...o.c, metal: o.c.metal || r.metal || '#e2b45a', top: o.c.top || r.main, top2: o.c.top2 || r.trim };
  const tone = L.tone, toneD = shade(tone, 0.86), role = opts.role, pose = opts.pose || 'stand', wave = pose === 'wave' || pose === 'happy';
  const sleeve = sleeveOf(o, r), handFill = o.hands === 'mittens' ? c.mitt : tone;
  const covered = role || o.hat;
  const s = [];
  s.push(back(o.back, c));
  s.push(hairBack(covered && L.hair === 'curly' ? 'short' : L.hair, L.hairColor));
  s.push(bottom(o), shoes(o));
  s.push(`<rect x="90" y="110" width="20" height="16" rx="5" fill="${toneD}"/>`);
  s.push(top(o.top, c, r));
  /* arms: the left always hangs; the right hangs, or waves */
  if (pose === 'happy') s.push(`<rect x="44" y="124" width="22" height="80" rx="11" fill="${sleeve}" transform="rotate(158 55 128)"/><circle cx="28" cy="52" r="10" fill="${handFill}"/>`);
  else s.push(`<rect x="44" y="122" width="22" height="80" rx="11" fill="${sleeve}" transform="rotate(10 55 124)"/><circle cx="45" cy="206" r="10" fill="${handFill}"/>`);
  if (wave) s.push(`<rect x="134" y="124" width="22" height="80" rx="11" fill="${sleeve}" transform="rotate(-158 145 128)"/><circle cx="172" cy="52" r="10" fill="${handFill}"/>`);
  else if (pose === 'point') s.push(`<rect x="134" y="128" width="22" height="40" rx="11" fill="${sleeve}" transform="rotate(-90 145 128)"/><circle cx="184" cy="128" r="10" fill="${handFill}"/><rect x="186" y="124" width="13" height="7" rx="3.5" fill="${handFill}"/>`);
  else if (pose === 'puzzled') s.push(`<rect x="140" y="124" width="22" height="62" rx="11" fill="${sleeve}" transform="rotate(168 151 126)"/>`);
  else if (pose === 'listen') s.push(`<rect x="140" y="124" width="22" height="40" rx="11" fill="${sleeve}" transform="rotate(196 151 126)"/>`);
  else if (pose === 'think') s.push(`<rect x="134" y="128" width="22" height="30" rx="11" fill="${sleeve}" transform="rotate(105 145 128)"/>`);
  else s.push(`<rect x="134" y="122" width="22" height="80" rx="11" fill="${sleeve}" transform="rotate(-10 145 124)"/>${role ? '' : `<circle cx="155" cy="206" r="10" fill="${handFill}"/>`}`);
  if (opts.suit && role && role !== 'joker' && o.top !== 'robe') s.push(shape(opts.suit, 72, 150, 14, opts.suitColor));
  s.push(neck(o));
  /* head */
  s.push(`<circle cx="58" cy="88" r="8" fill="${toneD}"/><circle cx="142" cy="88" r="8" fill="${toneD}"/><circle cx="100" cy="82" r="44" fill="${tone}"/>`);
  s.push(`<path d="M76 72q8-5 15 0M109 72q8-5 15 0" stroke="${shade(L.hairColor, 0.8)}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  if (pose === 'sleep') s.push(`<path d="M77 87q7 6 14 0M109 87q7 6 14 0" stroke="#1b1d22" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  else if (pose === 'happy') s.push(`<path d="M77 89q7-9 14 0M109 89q7-9 14 0" stroke="#1b1d22" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  else s.push(`<ellipse cx="84" cy="86" rx="6" ry="7.5" fill="#1b1d22"/><circle cx="${pose === 'think' ? 86 : 82}" cy="${pose === 'think' ? 82 : 83}" r="2.1" fill="#fff" opacity=".92"/><ellipse cx="116" cy="86" rx="6" ry="7.5" fill="#1b1d22"/><circle cx="${pose === 'think' ? 118 : 114}" cy="${pose === 'think' ? 82 : 83}" r="2.1" fill="#fff" opacity=".92"/>`);
  s.push(`<circle cx="72" cy="100" r="6.5" fill="#e88a8a" opacity=".3"/><circle cx="128" cy="100" r="6.5" fill="#e88a8a" opacity=".3"/><path d="M100 90q-4 8 0 10" stroke="${shade(tone, 0.72)}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  if (L.beard) s.push(`<path d="M58 90C58 126 78 138 100 138C122 138 142 126 142 90C134 106 120 112 100 112C80 112 66 106 58 90Z" fill="${L.hairColor}"/><path d="M84 104q16-8 32 0q-8 6-16 2q-8 4-16-2Z" fill="${L.hairColor}"/><path d="M93 116q7 4 14 0" stroke="#7a2e2a" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  else if (role === 'joker') s.push(`<path d="M83 102q17 18 34 0Z" fill="#7a2e2a"/><path d="M87 103h26" stroke="#fff" stroke-width="3"/>${shape('diamonds', 84, 102, 8, opts.suitColor || '#b03a2e')}${shape('diamonds', 116, 102, 8, opts.suitColor || '#b03a2e')}`);
  else if (pose === 'talk') s.push(`<ellipse cx="100" cy="108" rx="9" ry="7" fill="#7a2e2a"/><ellipse cx="100" cy="111" rx="5" ry="3" fill="#e07a8a"/>`);
  else if (pose === 'happy') s.push(`<path d="M86 104q14 16 28 0Z" fill="#7a2e2a"/><path d="M90 105h20" stroke="#fff" stroke-width="2.5"/>`);
  else if (pose === 'sleep') s.push(`<ellipse cx="100" cy="108" rx="4" ry="3" fill="#7a2e2a"/>`);
  else if (pose === 'puzzled') s.push(`<rect x="140" y="124" width="22" height="62" rx="11" fill="${sleeve}" transform="rotate(168 151 126)"/>`);
  else if (pose === 'listen') s.push(`<rect x="140" y="124" width="22" height="40" rx="11" fill="${sleeve}" transform="rotate(196 151 126)"/>`);
  else if (pose === 'puzzled') s.push(`<path d="M88 108q4-4 8 0t8 0t8 0" stroke="#7a2e2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  else if (pose === 'think') s.push(`<path d="M92 108q8-3 16 1" stroke="#7a2e2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  else s.push(`<path d="M90 106q10 8 20 0" stroke="#7a2e2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  if (L.glasses) s.push(`<circle cx="84" cy="86" r="12" fill="none" stroke="#2a2d33" stroke-width="3"/><circle cx="116" cy="86" r="12" fill="none" stroke="#2a2d33" stroke-width="3"/><path d="M96 86h8" stroke="#2a2d33" stroke-width="3"/>`);
  s.push(hairFront(covered && (L.hair === 'curly' || L.hair === 'bun') ? 'short' : L.hair, L.hairColor));
  if (o.back === 'hood') s.push(`<path d="M50 78Q100 30 150 78" stroke="${c.fur}" stroke-width="10" fill="none" stroke-linecap="round"/>`);
  s.push(role ? signature(role, c, opts.suitColor || '#b03a2e', opts.suit) + (c.goggles ? goggles(c, 58) : '') : hat(o.hat, c));
  if (role && pose === 'stand') s.push(held(role, opts.suit, opts.suitColor, c.metal, opts.emblem, handFill));
  /* the thinking hand sits on the chin, over the beard */
  if (pose === 'think') s.push(`<circle cx="116" cy="124" r="10" fill="${handFill}"/><circle cx="160" cy="40" r="5" fill="#c9cfd8"/><circle cx="172" cy="24" r="7" fill="#c9cfd8"/><circle cx="186" cy="6" r="9" fill="#c9cfd8"/>`);
  /* listening: a hand cupped at the ear, and three soft arcs coming in toward it */
  /* puzzled: hand scratching the head, one eyebrow up, a question mark */
  if (pose === 'puzzled') s.push(`<circle cx="146" cy="62" r="10" fill="${handFill}"/><path d="M74 70q10-6 20-2M108 64q10-2 18 4" stroke="#1b1d22" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M168 18q0-14 14-14t14 14q0 10-14 14v10" stroke="#839958" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="182" cy="56" r="4.5" fill="#839958"/>`);
  if (pose === 'listen') s.push(`<circle cx="158" cy="94" r="10" fill="${handFill}"/><path d="M176 78q8 16 0 32M186 70q12 24 0 48M196 62q16 32 0 64" stroke="#839958" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>`);
  if (pose === 'sleep') s.push(`<path d="M154 40h14l-14 14h14M172 14h10l-10 10h10" stroke="#839958" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  return s.join('');
}
export function figureSvg(look, opts = {}, label = 'Character') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 320" role="img" aria-label="${label}"><title>${label}</title>${figureBody(look, opts)}</svg>`;
}

/* ---------- the four default characters ----------
   Four people, one per role. Their look is theirs, not their suit's, and the avatar maker can
   change any of it. */
export const DEFAULT_CHARACTERS = {
  king: { name: 'King Kenny', look: { tone: '#c98a5a', hair: 'short', hairColor: '#d8d4cc', beard: true } },
  queen: { name: 'Queen Rose', look: { tone: '#f3c9a6', hair: 'bun', hairColor: '#8a4a24' } },
  jack: { name: 'Jack', look: { tone: '#8a5a3a', hair: 'curly', hairColor: '#1b1410' } },
  joker: { name: 'Robin the Joker', look: { tone: '#f6dcc4', hair: 'short', hairColor: '#c96a21' } },
};
/* What each court character wears in each theme. Themes without outfits yet wear the Royal robe. */
export const COURT_PICK = {
  medieval: { king: 'royal', queen: 'medievalKirtle', jack: 'medievalTunic', joker: 'medievalTunic' },
  nimrod: { king: 'royal', queen: 'nimrodCardigan', jack: 'nimrodTunic', joker: 'nimrodTunic' },
  fall: { king: 'fallSweater', queen: 'fallSweater', jack: 'fallFlannel', joker: 'fallFlannel' },
  winter: { king: 'winterParka', queen: 'winterSki', jack: 'winterSki', joker: 'winterParka' },
  halloween: { king: 'halloweenVampire', queen: 'halloweenWitch', jack: 'halloweenPumpkin', joker: 'halloweenWitch' },
  christmas: { king: 'christmasJumper', queen: 'christmasJumper', jack: 'christmasElf', joker: 'christmasElf' },
  steampunk: { king: 'steampunkWaistcoat', queen: 'steampunkAviator', jack: 'steampunkAviator', joker: 'steampunkWaistcoat' },
  cozy: { king: 'cozyKnit', queen: 'cozyCardigan', jack: 'cozyCardigan', joker: 'cozyKnit' },
  cyberpunk: { king: 'cyberJacket', queen: 'cyberHoodie', jack: 'cyberHoodie', joker: 'cyberJacket' },
  ocean: { king: 'oceanSailor', queen: 'oceanSlicker', jack: 'oceanSlicker', joker: 'oceanSailor' },
  night: { king: 'nightStargazer', queen: 'nightPyjamas', jack: 'nightPyjamas', joker: 'nightStargazer' },
  spring: { king: 'springCardigan', queen: 'springDress', jack: 'springDress', joker: 'springCardigan' },
  summer: { king: 'summerShirt', queen: 'summerDress', jack: 'summerDress', joker: 'summerShirt' },
  newYear: { king: 'newYearTux', queen: 'newYearParty', jack: 'newYearParty', joker: 'newYearTux' },
  lunarNewYear: { king: 'lunarJacket', queen: 'lunarDress', jack: 'lunarDress', joker: 'lunarJacket' },
  valentines: { king: 'valentineJumper', queen: 'valentineDress', jack: 'valentineDress', joker: 'valentineJumper' },
  stPatricks: { king: 'stPatTophat', queen: 'stPatJumper', jack: 'stPatJumper', joker: 'stPatTophat' },
  easter: { king: 'easterBunny', queen: 'easterDress', jack: 'easterDress', joker: 'easterBunny' },
  july4: { king: 'julyShirt', queen: 'julyDress', jack: 'julyDress', joker: 'julyShirt' },
  diwali: { king: 'diwaliKurta', queen: 'diwaliDress', jack: 'diwaliDress', joker: 'diwaliKurta' },
  harvest: { king: 'harvestApron', queen: 'harvestCardigan', jack: 'harvestCardigan', joker: 'harvestApron' },
  hanukkah: { king: 'hanukkahCardigan', queen: 'hanukkahJumper', jack: 'hanukkahJumper', joker: 'hanukkahCardigan' },
};
export const courtOutfit = (role, theme) => (COURT_PICK[theme] && COURT_PICK[theme][role]) || 'royal';
