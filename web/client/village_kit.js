import { objectSvg } from './count_objects.js';
/* villageKit.js: the castle and village, as movable pieces (item 45, and item 42's "backdrops as
 * editable data").
 *
 * Plain JavaScript that returns SVG strings, so web/client can ship it as it is.
 *
 *   sceneSvg(recipe, { assetBase, selected, editable }) → '<svg …>'
 *   PIECES[id]       → { label, group, vb: [w, h], sky?, draw(P, t) }
 *   VILLAGE_SCENES   → { village, castle, empty }   starting recipes
 *   LOOKS            → { crafted, toon }             the two art styles, with Pi 400 notes
 *
 * A RECIPE IS PLAIN DATA. Nothing is drawn in a fixed position:
 *   { look: 'crafted' | 'toon', time: 'day' | 'evening' | 'night', frame: true,
 *     pieces: [ { piece: 'tower', x: 960, y: 470, scale: 0.8, flip: false },
 *               { cast: 'merlin', x: 330, y: 830, pose: 'wave' }, … ] }
 * x and y are the piece's FOOT (bottom centre) on a 1600×900 stage. Sky pieces (sun, clouds, birds)
 * draw first, then ground pieces (hills, meadow, river, paths), then everything standing on the
 * ground. Within each band, things lower on the screen draw in front.
 *
 * THE TWO LOOKS (the same shapes, two ways of drawing them):
 *   crafted  paper and felt, layered like a diorama. Each shape is a soft offset shadow, the fill,
 *            a paper grain and, on felt pieces, a stitched edge. No SVG filters.
 *   toon     flat colour with a bold ink line and one darker cel shade on the side away from the sun.
 *
 * Every moving part is decoration and sits inside prefers-reduced-motion: no-preference: windmill
 * sails, flags, chimney smoke, water shimmer. Nothing flashes. */

/* ---------- colour ---------- */
const hx = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHx = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const dk = (h, k = 0.8) => (/^#[0-9a-f]{6}$/i.test(h) ? toHx(hx(h).map((v) => v * k)) : h);
const lt = (h, k = 0.35) => (/^#[0-9a-f]{6}$/i.test(h) ? toHx(hx(h).map((v) => v + (255 - v) * k)) : h);

const BASE = {
  crafted: { stone: '#c9bfae', stoneDk: '#a89c88', roof: '#b0574a', roofB: '#5f6f9a', wood: '#8a5f3c', thatch: '#d9b46a', plaster: '#f1e6cf', leaf: '#7fa35a', leafDk: '#5d7d44', grass: '#9cbf6a', grassDk: '#7fa35a', hillFar: '#b8cfa0', hill: '#8fb366', water: '#7fb8d0', banner: '#b03a2e', banner2: '#2f5a9a', gold: '#e8b84a', path: '#d8c8a4', magic: '#6a5aa8', cloud: '#fbf7ee', flower: ['#e86a8a', '#f2c230', '#f4f1e8', '#8a6ac0'], ink: '#3a2a1e', card: '#d9c6a2' },
  toon: { stone: '#d6d0c4', stoneDk: '#aaa294', roof: '#d8503c', roofB: '#3f6ad0', wood: '#9a6436', thatch: '#f0c44a', plaster: '#fff4dc', leaf: '#5fbf4a', leafDk: '#3e9a3a', grass: '#7fd05a', grassDk: '#58b244', hillFar: '#a6dc8a', hill: '#6cc44e', water: '#5ac0ee', banner: '#e23c32', banner2: '#2f6ae0', gold: '#ffcc33', path: '#f0dcae', magic: '#7a4ae0', cloud: '#ffffff', flower: ['#ff5a8a', '#ffd23a', '#ffffff', '#a070f0'], ink: '#2b1d16', card: '#d9c6a2' },
};
const TIME = {
  day: { sky: ['#a8d4ec', '#e6f2f0'], window: '#9fc3d6', veil: null, night: false },
  evening: { sky: ['#e89a6a', '#f6d6a8'], window: '#ffcf7a', veil: 'rgba(255,140,70,.16)', night: false },
  night: { sky: ['#141c3a', '#2a3a64'], window: '#ffd36e', veil: 'rgba(14,22,52,.5)', night: true },
};

/* ---------- path helpers ---------- */
const R = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}Z`;
const E = (cx, cy, rx, ry = rx) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
const PL = (...p) => 'M' + p.map((v, i) => v + (i % 2 ? (i < p.length - 1 ? 'L' : '') : ' ')).join('') + 'Z';
/* crenellated top edge across [x0, x1] at height y, teeth `t` wide and `h` tall */
const cren = (x0, x1, y, t = 16, h = 14) => { let d = ''; for (let x = x0; x < x1; x += t * 2) d += `M${x} ${y}h${Math.min(t, x1 - x)}v${-h}h${-Math.min(t, x1 - x)}Z`; return d; };

/* A shape: [d, colour, options]. options: side (a shade path), stitch (felt edge), hi (highlight
   path), noShadow, evenodd, cls (an animation class), raw (extra SVG after it). */
function draw(shapes, look) {
  const out = [];
  for (const s of shapes) {
    if (typeof s === 'string') { out.push(s); continue; }
    const [d, col, o = {}] = s;
    const fr = o.evenodd ? ' fill-rule="evenodd"' : '';
    const g = [];
    if (look === 'crafted') {
      if (!o.noShadow) g.push(`<path d="${d}"${fr} fill="#2a1e12" opacity=".2" transform="translate(3 4)"/>`);
      g.push(`<path d="${d}"${fr} fill="${col}"/>`);
      if (o.side) g.push(`<path d="${o.side}" fill="${dk(col, 0.86)}"/>`);
      if (!o.noGrain) g.push(`<path d="${d}"${fr} fill="url(#vg-grain)"/>`);
      if (o.stitch) g.push(`<path d="${d}"${fr} fill="none" stroke="${lt(col, 0.55)}" stroke-width="2" stroke-dasharray="5 4" opacity=".85"/>`);
      if (o.hi) g.push(`<path d="${o.hi}" fill="#fff" opacity=".18"/>`);
    } else {
      g.push(`<path d="${d}"${fr} fill="${col}"/>`);
      if (o.side) g.push(`<path d="${o.side}" fill="${dk(col, 0.76)}"/>`);
      if (o.hi) g.push(`<path d="${o.hi}" fill="#fff" opacity=".4"/>`);
      g.push(`<path d="${d}"${fr} fill="none" stroke="${o.line || '#2b1d16'}" stroke-width="${o.thin ? 2 : 3.5}" stroke-linejoin="round"/>`);
    }
    out.push(o.cls ? `<g class="${o.cls}">${g.join('')}</g>` : g.join(''));
    if (o.raw) out.push(o.raw);
  }
  return out.join('');
}
const win = (x, y, w, h, t, P, arch = true) => [arch ? `M${x} ${y + h}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}Z` : R(x, y, w, h), t.window, { noShadow: true, thin: true, raw: t.night ? `<path d="${arch ? `M${x} ${y + h}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}Z` : R(x, y, w, h)}" fill="${t.window}" opacity=".5" transform="translate(${x + w / 2} ${y + h / 2}) scale(1.9) translate(${-(x + w / 2)} ${-(y + h / 2)})" style="mix-blend-mode:screen"/>` : '' }];
const door = (x, y, w, h, P) => [`M${x} ${y + h}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}Z`, P.wood, { side: R(x + w * 0.5, y + w / 2, w * 0.5, h - w / 2), raw: `<circle cx="${x + w * 0.78}" cy="${y + h * 0.62}" r="3" fill="${P.gold}"/>` }];
const flag = (x, y, col, P) => [`M${x} ${y}h4v60h-4Z`, P.wood, { noShadow: true, raw: `<g class="vk-flag" style="transform-origin:${x + 4}px ${y + 4}px"><path d="M${x + 4} ${y + 2}h44l-10 14l10 14h-44Z" fill="${col}"/></g>` }];

/* ---------- the pieces ----------
   Each draws inside its own viewBox (vb), with its foot at the bottom centre. */
export const PIECES = {
  sun: { label: 'Sun or moon', group: 'Sky', sky: true, vb: [160, 160], draw: (P, t) => (t.night
    ? [[`M80 24a56 56 0 1 0 50 82a46 46 0 1 1 -50 -82Z`, '#f4ecc8', { stitch: true }]]
    : [...Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); return [PL(80 + c * 56, 80 + s * 56, 80 + Math.cos(a + 0.16) * 74, 80 + Math.sin(a + 0.16) * 74, 80 + Math.cos(a + 0.32) * 56, 80 + Math.sin(a + 0.32) * 56), P.gold, { noShadow: true }]; }), [E(80, 80, 48), P.gold, { stitch: true, hi: E(66, 66, 18) }]]) },
  cloud: { label: 'Cloud', group: 'Sky', sky: true, vb: [240, 110], draw: (P) => [[`M30 96a30 30 0 0 1 10-56a40 40 0 0 1 72-18a34 34 0 0 1 62 10a30 30 0 0 1 36 64Z`, P.cloud, { stitch: true, side: 'M30 96h180v-10h-180Z' }]] },
  birds: { label: 'Birds', group: 'Sky', sky: true, vb: [120, 50], draw: () => [`<path d="M8 30q10-12 20 0q10-12 20 0M58 18q8-10 16 0q8-10 16 0M88 40q6-8 12 0q6-8 12 0" stroke="#3a2a1e" stroke-width="3.5" fill="none" stroke-linecap="round"/>`] },
  farHills: { ground: true, label: 'Far hills', group: 'Land', vb: [1600, 300], draw: (P) => [[`M0 300V140Q160 40 340 110Q520 30 720 100Q920 20 1120 96Q1320 40 1600 120V300Z`, P.hillFar, { noShadow: true }]] },
  hill: { ground: true, label: 'Hill', group: 'Land', vb: [900, 320], draw: (P) => [[`M0 320Q140 40 450 30Q760 40 900 320Z`, P.hill, { side: 'M450 30Q760 40 900 320H450Z', stitch: true }]] },
  meadow: { ground: true, label: 'Meadow (ground)', group: 'Land', vb: [1600, 260], draw: (P) => [[`M0 260V40Q400 0 800 24Q1200 -4 1600 36V260Z`, P.grass, { noShadow: true }], ...Array.from({ length: 30 }, (_, i) => `<path d="M${20 + i * 53} ${80 + (i * 37) % 150}l4-12l4 12" stroke="${P.grassDk}" stroke-width="3" fill="none"/>`)] },
  river: { ground: true, label: 'River', group: 'Land', vb: [1600, 200], draw: (P) => [[`M0 150Q300 60 620 110Q940 170 1240 90Q1420 50 1600 80V140Q1420 120 1240 160Q940 240 620 180Q300 130 0 200Z`, P.water, { noShadow: true, raw: `<g class="vk-shimmer"><path d="M120 150q30-8 60 0M520 140q30-8 60 0M900 170q30-8 60 0M1300 120q30-8 60 0" stroke="#fff" stroke-width="4" fill="none" opacity=".6" stroke-linecap="round"/></g>` }]] },
  pond: { ground: true, label: 'Pond', group: 'Land', vb: [300, 90], draw: (P) => [[E(150, 50, 140, 36), P.water, { noShadow: true }], [E(90, 46, 18, 9), P.leaf, { noShadow: true, thin: true }], [E(200, 58, 14, 7), P.leaf, { noShadow: true, thin: true }], `<circle cx="96" cy="42" r="5" fill="${P.flower[0]}"/>`] },
  path: { ground: true, label: 'Stepping stones', group: 'Land', vb: [400, 120], draw: (P) => [[60, 96], [140, 70], [210, 92], [290, 62], [350, 86]].map(([x, y], i) => [E(x, y, 34 - i * 2, 14), P.path, { thin: true }]) },
  rocks: { label: 'Rocks', group: 'Land', vb: [160, 80], draw: (P) => [[`M10 80Q14 40 50 34Q80 28 96 52Q104 80 10 80Z`, P.stoneDk, { side: 'M60 30Q88 34 96 52Q104 80 60 80Z' }], [`M90 80Q96 50 124 50Q150 52 152 80Z`, P.stone, { side: 'M124 50Q150 52 152 80H124Z' }]] },
  bridge: { label: 'Stone bridge', group: 'Land', vb: [300, 140], draw: (P) => [[`M0 140V60Q150 10 300 60V140H230Q230 70 150 70Q70 70 70 140Z`, P.stone, { side: 'M150 20Q260 30 300 60V140H230Q230 70 150 70Z', raw: `<path d="M0 60Q150 10 300 60" stroke="${P.stoneDk}" stroke-width="6" fill="none"/>${[40, 100, 160, 220, 270].map((x) => `<path d="M${x} ${50 - Math.sin(x / 300 * Math.PI) * 20}v-14" stroke="${P.stoneDk}" stroke-width="6"/>`).join('')}` }]] },
  castleKeep: { label: 'Castle keep', group: 'Castle', vb: [360, 420], draw: (P, t) => [[R(40, 90, 280, 330), P.stone, { side: R(230, 90, 90, 330) }], [cren(40, 320, 90, 20, 22), P.stone, { side: cren(230, 320, 90, 20, 22) }], door(140, 290, 80, 130, P), win(80, 150, 36, 60, t, P), win(244, 150, 36, 60, t, P), win(162, 150, 36, 60, t, P), flag(176, 10, P.banner, P)] },
  tower: { label: 'Round tower', group: 'Castle', vb: [160, 480], draw: (P, t) => [[`M30 480V150Q80 140 130 150V480Z`, P.stone, { side: 'M90 145Q112 146 130 150V480H90Z' }], [`M18 156L80 30L142 156Q80 168 18 156Z`, P.roofB, { stitch: true, side: 'M80 30L142 156Q112 164 80 164Z' }], win(66, 220, 28, 50, t, P), win(66, 330, 28, 50, t, P), flag(78, -24, P.banner, P)] },
  wall: { label: 'Castle wall', group: 'Castle', vb: [420, 200], draw: (P) => [[R(0, 50, 420, 150), P.stone, { side: R(0, 170, 420, 30) }], [cren(0, 420, 50, 22, 20), P.stone], ...[[30, 80], [120, 110], [230, 90], [330, 120], [80, 140], [290, 150]].map(([x, y]) => `<path d="M${x} ${y}h40" stroke="${P.stoneDk}" stroke-width="3" opacity=".7"/>`)] },
  gatehouse: { label: 'Gatehouse', group: 'Castle', vb: [300, 320], draw: (P, t) => [[R(0, 60, 90, 260), P.stone, { side: R(60, 60, 30, 260) }], [R(210, 60, 90, 260), P.stone, { side: R(270, 60, 30, 260) }], [cren(0, 90, 60, 15, 18) + cren(210, 300, 60, 15, 18), P.stone], [R(80, 110, 140, 210), P.stoneDk, { side: R(190, 110, 30, 210) }], [`M100 320V200a50 50 0 0 1 100 0V320Z`, '#3a2a1e', { noShadow: true, raw: `<path d="M110 196V320M130 168V320M150 160V320M170 168V320M190 196V320M100 230H200M100 270H200M100 300H200" stroke="${P.wood}" stroke-width="5"/>` }], win(30, 120, 30, 46, t, P), win(240, 120, 30, 46, t, P)] },
  banner: { label: 'Banner pole', group: 'Castle', vb: [80, 220], draw: (P) => [[R(36, 10, 8, 210), P.wood, { noShadow: true }], [E(40, 10, 8), P.gold, { noShadow: true }], `<g class="vk-flag" style="transform-origin:44px 26px"><path d="M44 24h32v80l-16-12l-16 12Z" fill="${P.banner2}"/><path d="M60 40l6 12h12l-10 8l4 12l-12-8l-12 8l4-12l-10-8h12Z" fill="${P.gold}" transform="translate(-6 0) scale(.9)"/></g>`] },
  tent: { label: 'Knight tent', group: 'Castle', vb: [240, 200], draw: (P) => [[`M10 200L120 40L230 200Z`, P.plaster, { stitch: true, side: 'M120 40L230 200H120Z', raw: [40, 80, 160, 200].map((x) => `<path d="M120 40L${x} 200" stroke="${P.banner}" stroke-width="12" opacity=".85"/>`).join('') }], [`M96 200L120 120L144 200Z`, '#3a2a1e', { noShadow: true }], flag(118, -10, P.banner2, P)] },
  dummy: { label: 'Training dummy', group: 'Castle', vb: [90, 180], draw: (P) => [[R(41, 60, 8, 120), P.wood, { noShadow: true }], [R(10, 80, 70, 8), P.wood], [E(45, 44, 20), P.thatch, { stitch: true }], [`M24 96h42v40q-21 22-42 0Z`, P.banner, { stitch: true, raw: `<path d="M45 104v28M32 116h26" stroke="${P.gold}" stroke-width="5"/>` }]] },
  cottage: { label: 'Thatched cottage', group: 'Village', vb: [260, 240], draw: (P, t) => [[R(190, 20, 26, 70), P.stoneDk, { raw: `<g class="vk-smoke"><circle cx="203" cy="8" r="10" fill="#fff" opacity=".55"/><circle cx="214" cy="-12" r="13" fill="#fff" opacity=".4"/></g>` }], [R(30, 110, 200, 130), P.plaster, { side: R(160, 110, 70, 130), raw: `<path d="M30 110h200M30 240h200" stroke="${P.wood}" stroke-width="8"/>` }], [`M8 124Q20 36 130 30Q240 36 252 124Q130 112 8 124Z`, P.thatch, { stitch: true, side: 'M130 30Q240 36 252 124Q190 116 130 116Z' }], door(108, 160, 44, 80, P), win(50, 150, 36, 36, t, P, false), win(180, 150, 32, 36, t, P, false)] },
  timberHouse: { label: 'Timber house', group: 'Village', vb: [240, 300], draw: (P, t) => [[R(30, 120, 180, 180), P.plaster, { side: R(150, 120, 60, 180), raw: `<path d="M30 120h180M30 210h180M30 300h180M30 120v180M120 120v180M210 120v180M30 120l90 90M210 120l-90 90" stroke="${P.wood}" stroke-width="7"/>` }], [`M10 130L120 10L230 130Z`, P.roof, { stitch: true, side: 'M120 10L230 130H120Z', raw: [40, 70, 100].map((y) => `<path d="M${120 - (y + 20) * 0.9} ${y + 20}h${(y + 20) * 1.8}" stroke="${dk(P.roof, 0.78)}" stroke-width="3" opacity=".7"/>`).join('') }], door(96, 230, 48, 70, P), win(50, 140, 30, 40, t, P, false), win(160, 140, 30, 40, t, P, false), win(104, 40, 32, 36, t, P)] },
  wizardTower: { label: "Merlin's tower", group: 'Village', vb: [190, 520], draw: (P, t) => [[`M50 520L58 200Q60 180 96 178Q130 180 134 206L146 520Z`, P.stone, { side: 'M106 178Q130 180 134 206L146 520H110Z' }], [`M30 214Q60 110 112 6Q100 70 164 214Q96 230 30 214Z`, P.magic, { stitch: true, side: 'M112 6Q100 70 164 214Q130 222 104 222Z', raw: [[80, 140], [110, 100], [120, 180], [70, 196]].map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0 -7L2 -2L7 0L2 2L0 7L-2 2L-7 0L-2 -2Z" fill="${P.gold}"/>`).join('') }], win(80, 260, 30, 46, t, P), win(86, 360, 26, 40, t, P), door(74, 450, 44, 70, P), [E(148, 300, 12), P.gold, { raw: `<path d="M136 300h-24" stroke="${P.wood}" stroke-width="4"/>` }]] },
  windmill: { label: 'Windmill', group: 'Village', vb: [240, 380], draw: (P, t) => [[`M70 380L86 140H154L170 380Z`, P.plaster, { side: 'M120 140H154L170 380H120Z' }], [`M78 146Q120 70 162 146Z`, P.roof, { stitch: true }], door(102, 320, 36, 60, P), win(108, 220, 24, 34, t, P), `<g class="vk-spin" style="transform-origin:120px 128px">${[0, 90, 180, 270].map((a) => `<g transform="rotate(${a} 120 128)"><path d="M116 128V18h8v110Z" fill="${P.wood}"/><path d="M124 24h30v86h-30Z" fill="${P.cloud}" stroke="${P.wood}" stroke-width="3"/></g>`).join('')}<circle cx="120" cy="128" r="10" fill="${P.wood}"/></g>`] },
  marketStall: { label: 'Market stall', group: 'Village', vb: [260, 220], draw: (P) => [[R(30, 80, 8, 140), P.wood, { noShadow: true }], [R(222, 80, 8, 140), P.wood, { noShadow: true }], [R(20, 140, 220, 80), P.wood, { side: R(20, 200, 220, 20) }], [`M10 90L30 40H230L250 90Z`, P.plaster, { stitch: true, raw: [0, 1, 2, 3, 4].map((i) => `<path d="M${30 + i * 40} 40h20l${4 + i * 1} 50h-24Z" fill="${P.banner}" opacity=".9"/>`).join('') + `<path d="M10 90${Array.from({ length: 12 }, (_, i) => `q10 14 20 0`).join('')}" fill="${P.plaster}"/>` }], ...[[60, P.banner], [86, P.gold], [112, P.leaf], [150, P.banner], [176, P.flower[3]], [202, P.gold]].map(([x, c]) => [E(x, 132, 12), c, { noShadow: true, thin: true }])] },
  well: { label: 'Well', group: 'Village', vb: [160, 180], draw: (P) => [[R(30, 40, 8, 90), P.wood, { noShadow: true }], [R(122, 40, 8, 90), P.wood, { noShadow: true }], [`M14 52L80 6L146 52Z`, P.roof, { stitch: true }], [`M24 180V120Q80 104 136 120V180Z`, P.stone, { side: 'M100 112Q120 114 136 120V180H100Z', raw: `<path d="M24 140h112M24 160h112" stroke="${P.stoneDk}" stroke-width="3" opacity=".6"/>` }], [R(70, 70, 20, 22), P.wood, { raw: `<path d="M80 40v30" stroke="#5a4a3a" stroke-width="2"/>` }]] },
  cart: { label: 'Cart', group: 'Village', vb: [220, 140], draw: (P) => [[R(20, 50, 160, 50), P.wood, { side: R(20, 86, 160, 14) }], [`M180 80L218 64`, P.wood, { raw: `<path d="M180 80L218 64" stroke="${P.wood}" stroke-width="7" stroke-linecap="round"/>` }], [E(60, 110, 28), dk(P.wood, 0.8), { raw: `<path d="M60 82v56M32 110h56M40 90l40 40M80 90l-40 40" stroke="${P.thatch}" stroke-width="3"/>` }], [E(150, 110, 28), dk(P.wood, 0.8), { raw: `<path d="M150 82v56M122 110h56M130 90l40 40M170 90l-40 40" stroke="${P.thatch}" stroke-width="3"/>` }], ...[[50, P.thatch], [90, P.banner], [130, P.gold]].map(([x, c]) => [E(x, 44, 20, 14), c, { noShadow: true, thin: true }])] },
  haystack: { label: 'Haystack', group: 'Village', vb: [160, 120], draw: (P) => [[`M10 120Q16 20 80 14Q144 20 150 120Z`, P.thatch, { stitch: true, side: 'M80 14Q144 20 150 120H80Z', raw: `<path d="M40 60q20-8 40 0t40 0M30 90q25-8 50 0t50 0" stroke="${dk(P.thatch, 0.78)}" stroke-width="3" fill="none"/>` }]] },
  fence: { label: 'Fence', group: 'Village', vb: [260, 90], draw: (P) => [[R(0, 36, 260, 10) + R(0, 62, 260, 10), P.wood, { noShadow: true }], ...[10, 70, 130, 190, 240].map((x) => [`M${x} 90V20l8-12l8 12V90Z`, P.wood, { thin: true }])] },
  signpost: { label: 'Signpost', group: 'Village', vb: [140, 170], draw: (P) => [[R(66, 30, 8, 140), P.wood, { noShadow: true }], [`M70 40h56l12 12l-12 12h-56Z`, P.plaster, { thin: true, raw: `<text x="98" y="58" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="15" fill="${P.ink}">Castle</text>` }], [`M70 84h-56l-12 12l12 12h56Z`, P.plaster, { thin: true, raw: `<text x="40" y="102" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="15" fill="${P.ink}">Market</text>` }]] },
  lantern: { label: 'Lantern post', group: 'Village', vb: [70, 200], draw: (P, t) => [t.night ? `<circle cx="35" cy="34" r="60" fill="${t.window}" opacity=".28"/>` : '', [R(31, 50, 8, 150), '#3a3f46', { noShadow: true }], [`M20 50h30l-4-32h-22Z`, t.window, { thin: true }], [`M16 18h38l-6-10h-26Z`, '#3a3f46', { noShadow: true }]] },
  tree: { label: 'Round tree', group: 'Nature', vb: [200, 280], draw: (P) => [[`M86 280L92 150H108L114 280Z`, P.wood, { side: 'M100 150H108L114 280H100Z' }], [E(64, 130, 52), P.leafDk, { stitch: true }], [E(136, 130, 52), P.leafDk, { stitch: true }], [E(100, 86, 66), P.leaf, { stitch: true, side: 'M100 20a66 66 0 0 1 0 132Z', hi: E(76, 62, 20, 14) }]] },
  pine: { label: 'Pine', group: 'Nature', vb: [130, 260], draw: (P) => [[R(58, 200, 14, 60), P.wood, { noShadow: true }], [`M10 210L65 110L120 210Z`, P.leafDk, { stitch: true, side: 'M65 110L120 210H65Z' }], [`M20 150L65 60L110 150Z`, P.leafDk, { stitch: true, side: 'M65 60L110 150H65Z' }], [`M32 92L65 10L98 92Z`, P.leafDk, { stitch: true, side: 'M65 10L98 92H65Z' }]] },
  bush: { label: 'Bush', group: 'Nature', vb: [160, 90], draw: (P) => [[`M10 90a34 34 0 0 1 30-52a40 40 0 0 1 74-6a32 32 0 0 1 36 58Z`, P.leaf, { stitch: true, side: 'M80 18a40 40 0 0 1 34 14a32 32 0 0 1 36 58H80Z' }]] },
  flowers: { label: 'Flowers', group: 'Nature', vb: [160, 70], draw: (P) => [...[14, 40, 66, 92, 118, 144].map((x, i) => `<path d="M${x} 70V${30 + (i % 3) * 8}" stroke="${P.leafDk}" stroke-width="3"/>`), ...[14, 40, 66, 92, 118, 144].map((x, i) => [E(x, 28 + (i % 3) * 8, 9), P.flower[i % 4], { noShadow: true, thin: true, raw: `<circle cx="${x}" cy="${28 + (i % 3) * 8}" r="3" fill="${P.gold}"/>` }])] },
  /* ---------- for lessons: places, and things to count and spell with ----------
     These take settings on the scene item, so one piece covers many lessons:
       countTable  { object: 'loaf', count: 5, holder: 'table' | 'basket' | 'crate' }
       letterSign  { text: 'CAT' }      wallBuild { rows: 0–6 }      candleStand { count: 1–7 }
       marketScale { tilt: -1 | 0 | 1 } */
  marketSquare: { ground: true, label: 'Market square', group: 'Lessons', vb: [900, 220], draw: (P) => [[E(450, 120, 440, 96), P.path, { noShadow: true, side: E(450, 140, 440, 76) }], `<g opacity=".35">${Array.from({ length: 44 }, (_, i) => { const a = (i * 2.39996) % (Math.PI * 2), r = Math.sqrt((i + 0.5) / 44); return `<ellipse cx="${450 + Math.cos(a) * r * 400}" cy="${120 + Math.sin(a) * r * 80}" rx="22" ry="9" fill="none" stroke="${P.stoneDk}" stroke-width="3"/>`; }).join('')}</g>`] },
  countTable: { label: 'Counting table (or basket, crate)', group: 'Lessons', vb: [320, 180], draw: (P, t, it = {}) => {
    const n = Math.max(0, Math.min(10, it.count ?? 5)), obj = it.object || 'loaf', holder = it.holder || 'table';
    const cols = Math.min(5, n || 1), size = holder === 'table' ? 50 : 42, gap = 6, w = cols * size + (cols - 1) * gap, x0 = 160 - w / 2;
    const rows = Math.ceil(n / 5), top = holder === 'table' ? 96 - rows * (size - 8) : 108 - rows * (size - 12);
    const things = Array.from({ length: n }, (_, i) => `<g transform="translate(${x0 + (i % 5) * (size + gap)} ${top + Math.floor(i / 5) * (size - 10)})">${objectSvg(obj, { size })}</g>`).join('');
    if (holder === 'basket') return [things, [`M40 112H280L256 178H64Z`, P.thatch, { side: 'M160 112H280L256 178H160Z', raw: '<path d="M48 132H272M56 154H264" stroke="#000" stroke-opacity=".18" stroke-width="4"/>' }]];
    if (holder === 'crate') return [things, [R(40, 112, 240, 66), P.wood, { side: R(200, 112, 80, 66), raw: '<path d="M40 134H280M40 156H280" stroke="#000" stroke-opacity=".22" stroke-width="4"/>' }]];
    return [[R(30, 104, 260, 14), P.wood, { side: R(30, 112, 260, 6) }], [R(48, 118, 12, 62), P.wood, { noShadow: true }], [R(260, 118, 12, 62), P.wood, { noShadow: true }], things];
  } },
  letterSign: { label: 'Signboard with letter tiles', group: 'Lessons', vb: [340, 260], draw: (P, t, it = {}) => {
    const txt = String(it.text ?? 'CAT').toUpperCase().slice(0, 8), n = Math.max(1, txt.length), tw = Math.min(64, 280 / n - 8), x0 = 170 - (n * (tw + 8) - 8) / 2;
    const tiles = [...txt].map((ch, i) => `<rect x="${x0 + i * (tw + 8)}" y="${88 - tw / 2}" width="${tw}" height="${tw}" rx="8" fill="#f4ecd8" stroke="#6b4a32" stroke-width="3"/><text x="${x0 + i * (tw + 8) + tw / 2}" y="${88 + tw * 0.3}" text-anchor="middle" font-family="Georgia,serif" font-weight="800" font-size="${tw * 0.8}" fill="#2a1a10">${ch === '_' ? '' : ch}</text>`).join('');
    return [[R(60, 140, 14, 120), P.wood, { noShadow: true }], [R(266, 140, 14, 120), P.wood, { noShadow: true }], [R(14, 26, 312, 124), P.wood, { side: R(14, 132, 312, 18) }], [R(26, 38, 288, 100), P.thatch, { noShadow: true, thin: true }], tiles];
  } },
  sacks: { label: 'Sacks of grain', group: 'Lessons', vb: [220, 130], draw: (P) => [[30, 80], [110, 70], [180, 84]].map(([x, h], i) => [`M${x - 34} 130q-6-${h - 40} 16-${h}q-6-8 2-14h32q8 6 2 14 22 ${h - 40} 16 ${h}z`, ['#c8b48a', '#b8a078', '#d4c098'][i], { stitch: true, raw: `<path d="M${x - 18} ${130 - h + 6}q18 6 36 0" stroke="#8a6a3a" stroke-width="4" fill="none"/>` }]) },
  marketScale: { label: 'Market scale', group: 'Lessons', vb: [220, 220], draw: (P, t, it = {}) => {
    const k = Math.max(-1, Math.min(1, it.tilt ?? 0)) * 14, L = 110 - 80, Rr = 110 + 80;
    return [[R(104, 40, 12, 170), P.wood, { side: R(110, 40, 6, 170) }], [R(70, 200, 80, 20), P.wood], [`M${L} ${60 + k}L${Rr} ${60 - k}`, '#000', { raw: `<path d="M${L} ${60 + k}L${Rr} ${60 - k}" stroke="${P.gold}" stroke-width="7" stroke-linecap="round"/>`, noShadow: true }],
      ...[[L, 60 + k], [Rr, 60 - k]].flatMap(([x, y]) => [[`M${x} ${y}L${x - 30} ${y + 60}M${x} ${y}L${x + 30} ${y + 60}`, '#000', { raw: `<path d="M${x} ${y}L${x - 30} ${y + 60}M${x} ${y}L${x + 30} ${y + 60}" stroke="#6b5a48" stroke-width="2.5"/>`, noShadow: true }], [`M${x - 36} ${y + 60}h72q-6 18-36 18t-36-18z`, P.gold, {}]]), [E(110, 40, 10), P.gold, { noShadow: true }]];
  } },
  candleStand: { label: 'Candles', group: 'Lessons', vb: [200, 200], draw: (P, t, it = {}) => {
    const n = Math.max(1, Math.min(7, it.count ?? 3)), xs = Array.from({ length: n }, (_, i) => 100 + (i - (n - 1) / 2) * 26);
    return [[R(20, 184, 160, 14), P.wood], ...xs.map((x, i) => { const h = 70 + ((i * 37) % 3) * 16; return [R(x - 9, 184 - h, 18, h), '#f4ecd8', { side: R(x, 184 - h, 9, h), raw: `<path d="M${x} ${180 - h}q-8-12 0-26 8 14 0 26z" fill="#f2a83a"/>` + (t.night ? `<circle cx="${x}" cy="${170 - h}" r="22" fill="#ffd36e" opacity=".25"/>` : '') }]; })];
  } },
  wallBuild: { label: 'Castle wall being built', group: 'Lessons', vb: [460, 340], draw: (P, t, it = {}) => {
    const rows = Math.max(0, Math.min(6, it.rows ?? 3)), out = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < 6; c += 1) { const x = 60 + c * 56 + (r % 2 ? 28 : 0) - (r % 2 && c === 5 ? 28 : 0), w = r % 2 && (c === 5) ? 28 : 54; out.push([R(x, 316 - (r + 1) * 40, w, 38), r % 2 ? P.stone : P.stoneDk, { side: R(x + w - 10, 316 - (r + 1) * 40, 10, 38) }]); }
    return [[R(40, 20, 10, 300), P.wood, { noShadow: true }], [R(410, 20, 10, 300), P.wood, { noShadow: true }], ...[90, 170, 250].map((y) => [R(30, y, 400, 8), P.wood, { noShadow: true }]), ...out,
      [`M0 340Q20 300 60 304Q90 300 100 340Z`, P.stoneDk, { raw: '<path d="M14 330l20-14M44 326l18-16" stroke="#000" stroke-opacity=".2" stroke-width="3"/>' }],
      [R(430, 40, 8, 300), P.wood, { noShadow: true, raw: Array.from({ length: 8 }, (_, i) => `<rect x="430" y="${60 + i * 36}" width="28" height="5" fill="${P.wood}"/>`).join('') + `<rect x="452" y="40" width="8" height="300" fill="${P.wood}"/>` }]];
  } },
};
export const PIECE_GROUPS = ['Sky', 'Land', 'Castle', 'Village', 'Nature', 'Lessons'];

/* ---------- the two looks ---------- */
export const LOOKS = {
  crafted: {
    label: 'Crafted (paper and felt)',
    note: 'Each shape draws up to five layers: a soft offset shadow, the fill, a darker paper layer on the shade side, a paper grain and a stitched edge. A cardboard frame makes the scene read as a diorama.',
    pi400: 'Heavier: about 4 times the shapes of the toon look, and the paper grain is a pattern fill on every shape. No SVG filters are used. Fine as a still image. If the scene is panned, zoomed or redrawn often, render it once to a bitmap and move the bitmap, with only the moving pieces (sails, flags, smoke) drawn live on top.',
  },
  toon: {
    label: 'Toon (ink line and cel shade)',
    note: 'Flat bright colour, a bold ink line, and one darker cel shade on the side away from the sun. Same shapes as crafted.',
    pi400: 'Light: two or three paths per shape and no pattern fills. Safe to redraw live. A real 3D toon shader (WebGL) would also run on the Pi 400 at a low resolution, but it costs far more than this and is not recommended as the default.',
  },
};

/* ---------- starting scenes ---------- */
const p = (piece, x, y, scale, o = {}) => ({ piece, x, y, ...(scale && scale !== 1 ? { scale } : {}), ...o });
const c = (cast, x, y, o = {}) => ({ cast, x, y, scale: 0.62, ...o });
export const VILLAGE_SCENES = {
  market: {
    label: 'Market day (counting and spelling)',
    recipe: { look: 'crafted', time: 'day', frame: true, pieces: [
      { piece: 'sun', x: 1340, y: 230, scale: 0.7 }, { piece: 'cloud', x: 300, y: 170, scale: 0.8 }, { piece: 'cloud', x: 980, y: 140, scale: 0.6 },
      { piece: 'farHills', x: 800, y: 560 }, { piece: 'castleKeep', x: 1280, y: 520, scale: 0.42 }, { piece: 'wallBuild', x: 1460, y: 600, scale: 0.42, rows: 3 },
      { piece: 'meadow', x: 800, y: 900 }, { piece: 'marketSquare', x: 800, y: 870, scale: 1.4 },
      { piece: 'timberHouse', x: 160, y: 640, scale: 0.75 }, { piece: 'cottage', x: 1460, y: 700, scale: 0.7 },
      { piece: 'marketStall', x: 520, y: 700, scale: 0.9 }, { piece: 'well', x: 1040, y: 700, scale: 0.7 },
      { piece: 'letterSign', x: 800, y: 660, scale: 0.6, text: 'BREAD' },
      { piece: 'countTable', x: 360, y: 820, scale: 0.9, object: 'loaf', count: 5 },
      { piece: 'countTable', x: 1200, y: 830, scale: 0.85, object: 'apple', count: 7, holder: 'basket' },
      { piece: 'marketScale', x: 700, y: 840, scale: 0.6, tilt: -1 }, { piece: 'sacks', x: 1380, y: 860, scale: 0.7 },
      { cast: 'baker', x: 240, y: 860, scale: 0.6, pose: 'point' }, { cast: 'shopkeeper', x: 620, y: 860, scale: 0.6, pose: 'talk' },
      { cast: 'jess', x: 930, y: 880, scale: 0.6, pose: 'puzzled' }, { cast: 'vince', x: 1020, y: 880, scale: 0.6, pose: 'happy' },
      { cast: 'player', x: 860, y: 890, scale: 0.62, pose: 'wave' }, { cast: 'farmer', x: 1300, y: 880, scale: 0.6, pose: 'stand' },
    ] },
  },
  village: {
    label: 'The village',
    recipe: { look: 'crafted', time: 'day', frame: true, pieces: [
      p('sun', 1380, 250), p('cloud', 300, 200), p('cloud', 920, 150, 0.8), p('birds', 640, 230),
      p('farHills', 800, 600), p('hill', 1130, 640),
      p('tower', 950, 470, 0.62), p('tower', 1310, 470, 0.62), p('castleKeep', 1130, 445, 0.72), p('wall', 1130, 480, 0.9), p('gatehouse', 1130, 492, 0.56),
      p('wizardTower', 210, 650, 0.9), p('meadow', 800, 900), p('pine', 330, 690, 0.8), p('pine', 1560, 660, 0.7), p('windmill', 450, 690, 0.78),
      p('timberHouse', 820, 700, 0.8), p('cottage', 650, 712, 0.86), p('river', 800, 820), p('bridge', 520, 792, 0.9),
      p('cottage', 1400, 748, 0.9, { flip: true }), p('haystack', 1520, 790, 0.8), p('marketStall', 1010, 772, 0.9), p('well', 870, 800, 0.8),
      p('path', 700, 868), p('fence', 1250, 858), p('lantern', 600, 868), p('signpost', 1130, 872, 0.8),
      p('tree', 110, 880), p('tree', 1500, 892, 1, { flip: true }), p('bush', 770, 890), p('flowers', 980, 892),
      c('merlin', 330, 846, { pose: 'wave' }), c('robin', 1110, 838, { pose: 'happy' }), c('jess', 920, 868, { pose: 'talk' }), c('vince', 980, 872), c('nimrod', 1050, 892, { scale: 0.5 }),
    ] },
  },
  castle: {
    label: 'The castle',
    recipe: { look: 'crafted', time: 'day', frame: true, pieces: [
      p('sun', 260, 240), p('cloud', 1200, 180), p('cloud', 640, 120, 0.7),
      p('farHills', 800, 560), p('castleKeep', 800, 470, 1.15),
      p('tower', 120, 580, 1.05), p('tower', 1480, 580, 1.05, { flip: true }), p('wall', 390, 570, 1.4), p('wall', 1210, 570, 1.4), p('gatehouse', 800, 606, 1.45),
      p('meadow', 800, 900), p('path', 800, 890, 1.6), p('tent', 270, 790), p('dummy', 510, 806), p('banner', 1060, 800), p('banner', 1170, 812), p('well', 1370, 830),
      p('cart', 1250, 890), p('bush', 90, 890), p('flowers', 680, 892), p('flowers', 960, 894),
      c('kenny', 730, 870), c('rose', 870, 872), c('jack', 1080, 880, { pose: 'wave' }), c('michael', 410, 860), c('gladys', 600, 866, { pose: 'point' }), c('jess', 980, 890, { pose: 'happy' }), c('vince', 660, 892, { pose: 'wave' }), c('nimrod', 1330, 896, { scale: 0.5 }),
    ] },
  },
  empty: { label: 'Empty', recipe: { look: 'crafted', time: 'day', frame: true, pieces: [p('meadow', 800, 900)] } },
};

/* ---------- rendering ---------- */
const STYLE = `<style>.vk-sel{outline:none}@media (prefers-reduced-motion: no-preference){.vk-spin{animation:vkSpin 16s linear infinite}.vk-flag{animation:vkFlag 3.6s ease-in-out infinite alternate}.vk-smoke{animation:vkSmoke 6s ease-out infinite}.vk-shimmer{animation:vkShim 4s ease-in-out infinite alternate}}@keyframes vkSpin{to{transform:rotate(360deg)}}@keyframes vkFlag{from{transform:skewY(-4deg)}to{transform:skewY(5deg)}}@keyframes vkSmoke{0%{opacity:0;transform:translateY(8px)}30%{opacity:1}100%{opacity:0;transform:translateY(-26px)}}@keyframes vkShim{from{opacity:.35}to{opacity:1}}</style>`;

export function pieceSvg(item, P, t, look, { assetBase, castSvg } = {}) {
  if (item.cast) return castSvg ? castSvg(item.cast, { pose: item.pose || 'stand', assetBase, look: item.look, outfit: item.outfit }).replace(/<title>[^<]*<\/title>/, '') : '';
  const def = PIECES[item.piece];
  if (!def) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${look === 'toon' ? '-4 -4' : '-2 -2'} ${def.vb[0] + 8} ${def.vb[1] + 8}" overflow="visible">${draw(def.draw(P, t, item), look)}</svg>`;
}

/* SELECTION HANDLES, drawn above everything so they're always reachable: four corner squares
   scale about the centre, the round handle above turns it, and the body drags. data-h names the
   handle; Moveable can replace this in the app, but the data it edits is the same (x, y, scale, rot). */
function handleSvg(i, x, y, w, h, rot) {
  const sq = (cx, cy) => `<rect data-i="${i}" data-h="scale" x="${cx - 13}" y="${cy - 13}" width="26" height="26" rx="5" fill="#fff" stroke="#105666" stroke-width="5" style="cursor:nwse-resize"/>`;
  const cx = x + w / 2;
  return `<g${rot}><rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="8" fill="none" stroke="#105666" stroke-width="4" stroke-dasharray="14 8" pointer-events="none"/><path d="M${cx} ${y - 6}V${y - 58}" stroke="#105666" stroke-width="4" pointer-events="none"/><circle data-i="${i}" data-h="rot" cx="${cx}" cy="${y - 70}" r="16" fill="#fff" stroke="#105666" stroke-width="5" style="cursor:grab"/><path d="M${cx - 7} ${y - 74}a8 8 0 1 1 2 10" stroke="#105666" stroke-width="3" fill="none" pointer-events="none"/>${sq(x - 6, y - 6)}${sq(x + w + 6, y - 6)}${sq(x - 6, y + h + 6)}${sq(x + w + 6, y + h + 6)}</g>`;
}

/* Everything in a scene that isn't a piece, and why. These stay as single layers by design. */
export const LAYERS = [
  { id: 'sky', what: 'The sky gradient', why: 'It fills the whole stage behind everything and has no position. It changes with the time of day.' },
  { id: 'stars', what: 'Stars at night', why: 'They come with the night sky rather than being placed. If someone wants to place a star, that is a sky piece.' },
  { id: 'grain', what: 'Paper grain (crafted look only)', why: 'A texture over the whole stage that belongs to the look, not to anything in the scene.' },
  { id: 'veil', what: 'Evening and night tint', why: 'The light, over the whole scene. Lit windows and lanterns are part of each piece.' },
  { id: 'frame', what: 'The cardboard diorama frame', why: 'Part of the crafted look, around the edge of the stage. It can be switched off.' },
];

export function sceneSvg(recipe = {}, { assetBase = '../../assets/', selected = -1, editable = false, castSvg } = {}) {
  const look = recipe.look === 'toon' ? 'toon' : 'crafted', t = TIME[recipe.time] || TIME.day, P = BASE[look];
  const items = (recipe.pieces || []).map((it, i) => ({ it, i }));
  /* draw order: sky, then the ground (hills, meadow, river, paths) back to front, then everything
     standing on it back to front */
  const band = (it) => { const d = it.piece && PIECES[it.piece]; return d && d.sky ? 0 : d && d.ground ? 1 : 2; };
  items.sort((a, b) => (band(a.it) - band(b.it)) || (a.it.y - b.it.y));
  const out = [];
  let handles = '';
  out.push(`<defs><linearGradient id="vg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.sky[0]}"/><stop offset="1" stop-color="${t.sky[1]}"/></linearGradient><pattern id="vg-grain" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".8" fill="#fff" opacity=".22"/><circle cx="5" cy="4.5" r=".7" fill="#000" opacity=".1"/></pattern></defs>`);
  out.push(`<rect width="1600" height="900" fill="url(#vg-sky)"${editable ? ' data-bg="1"' : ''}/>`);
  if (t.night) out.push(Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 397) % 1600}" cy="${(i * 211) % 420}" r="${1 + (i % 3) * 0.6}" fill="#fff" opacity=".8"/>`).join(''));
  if (look === 'crafted') out.push(`<rect width="1600" height="900" fill="url(#vg-grain)" opacity=".6"/>`);
  for (const { it, i } of items) {
    const def = it.piece ? PIECES[it.piece] : { vb: [200, 320] };
    if (!def) continue;
    const k = it.scale ?? 1, w = (def.vb[0] + 8) * k, h = (def.vb[1] + 8) * k;
    const x = it.x - w / 2, y = it.y - h;
    const inner = pieceSvg(it, P, t, look, { assetBase, castSvg }).replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);
    const flipT = it.flip ? ` transform="translate(${2 * it.x} 0) scale(-1 1)"` : '';
    /* rotation turns the piece about its centre */
    const rot = it.rot ? ` transform="rotate(${it.rot} ${it.x} ${it.y - h / 2})"` : '';
    out.push(`<g${rot}><g${editable ? ` data-i="${i}" style="cursor:grab"` : ''}${flipT}>${inner}</g></g>`);
    if (editable && i === selected) handles = handleSvg(i, x, y, w, h, rot);
  }
  if (t.veil) out.push(`<rect width="1600" height="900" fill="${t.veil}" pointer-events="none"/>`);
  if (look === 'crafted' && recipe.frame !== false) out.push(`<path d="M0 0H1600V900H0Z M28 28V872H1572V28Z" fill-rule="evenodd" fill="${P.card}" pointer-events="none"/><path d="M28 28V872H1572V28Z" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="10" pointer-events="none"/><path d="M0 0H1600V900H0Z M28 28V872H1572V28Z" fill-rule="evenodd" fill="url(#vg-grain)" pointer-events="none"/>`);
  out.push(handles);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-label="${(recipe.label || 'Village scene').replace(/"/g, '')}">${STYLE}${out.join('')}</svg>`;
}
