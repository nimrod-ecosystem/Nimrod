/* themeKits.js: each theme's own furniture and decorations, drawn once and used everywhere.
 *
 * Plain JavaScript with no React and no imports, so web/client can ship it as it is.
 * Every piece is an SVG string in a 0–100 box, stretched to the piece's `box` (w, h in stage px at
 * scale 1), the same way town.js draws silhouettes. The same drawing appears in three places:
 *   - the ROOM BUILDER (roomParts.jsx wraps it as furniture),
 *   - the SCENE BUILDER (SceneBuilder.jsx wraps it as a part, for outdoor places),
 *   - the flat TOWN drawings and the playing cards (town.js).
 *
 * `theme` is the world the piece comes from: 'any' pieces belong to every world. The editors group
 * pieces by world, and any piece can go in any room: a cauldron in the Christmas kitchen is
 * allowed. `glow` marks a light source (drawn above the room's lighting, like a lamp).
 * `c` is the main colour, and the person can change it.
 */

const dk = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join(''); };

export const KIT = {
  /* ---------- any world ---------- */
  throne: { label: 'Throne', theme: 'any', on: 'floor', box: [150, 210], color: '#9e3a2e',
    svg: (c) => `<path d="M14 100V18Q14 4 30 4H70Q86 4 86 18V100Z" fill="#c9a24a"/><path d="M24 70V22Q24 12 36 12H64Q76 12 76 22V70Z" fill="${c}"/><path d="M50 18l5 9 10 1-7 7 2 10-10-5-10 5 2-10-7-7 10-1z" fill="#e2c270"/><rect x="6" y="62" width="88" height="16" rx="5" fill="${dk(c, 0.82)}"/><rect x="2" y="56" width="16" height="30" rx="6" fill="#c9a24a"/><rect x="82" y="56" width="16" height="30" rx="6" fill="#c9a24a"/><rect x="18" y="86" width="10" height="14" fill="#8a6a2a"/><rect x="72" y="86" width="10" height="14" fill="#8a6a2a"/>` },
  wallBanner: { label: 'Banner', theme: 'any', on: 'wall', box: [70, 150], color: '#9e3a2e',
    svg: (c) => `<rect x="0" y="0" width="100" height="5" rx="2" fill="#6b4a32"/><path d="M8 4H92V96L50 80L8 96Z" fill="${c}"/><path d="M8 4H92V14H8Z" fill="${dk(c, 0.78)}"/><circle cx="50" cy="44" r="16" fill="#e2c270"/><path d="M42 40l8-10 8 10-8 14z" fill="${dk(c, 0.7)}"/>` },
  candelabra: { label: 'Candelabra', theme: 'any', on: 'floor', box: [70, 160], color: '#c9a24a', glow: { x: 50, y: 10, r: 120, c: 'rgba(255,200,120,.5)' },
    svg: (c) => `<rect x="44" y="30" width="12" height="62" fill="${c}"/><path d="M14 30Q14 48 50 48Q86 48 86 30" fill="none" stroke="${c}" stroke-width="7"/><rect x="28" y="88" width="44" height="12" rx="4" fill="${dk(c, 0.8)}"/>${[14, 50, 86].map((x) => `<rect x="${x - 5}" y="12" width="10" height="20" fill="#f4efe0"/><path d="M${x} 1Q${x + 6} 7 ${x} 12Q${x - 6} 7 ${x} 1z" fill="#ffc457"/>`).join('')}` },
  chest: { label: 'Treasure chest', theme: 'any', on: 'floor', box: [120, 84], color: '#7a4a24',
    svg: (c) => `<path d="M4 40Q4 4 50 4Q96 4 96 40Z" fill="${dk(c, 1.12)}"/><rect x="4" y="38" width="92" height="60" rx="4" fill="${c}"/><rect x="4" y="36" width="92" height="8" fill="#c9a24a"/><rect x="18" y="4" width="8" height="94" fill="#c9a24a"/><rect x="74" y="4" width="8" height="94" fill="#c9a24a"/><rect x="42" y="44" width="16" height="18" rx="3" fill="#e2c270"/>` },
  bench: { label: 'Park bench', theme: 'any', on: 'floor', box: [200, 90], color: '#8a5f3c',
    svg: (c) => `<rect x="4" y="8" width="92" height="12" rx="3" fill="${c}"/><rect x="4" y="26" width="92" height="12" rx="3" fill="${c}"/><rect x="0" y="50" width="100" height="14" rx="3" fill="${dk(c, 1.1)}"/><path d="M10 20V100M90 20V100" stroke="#2a2d33" stroke-width="6"/><path d="M14 64L6 100M86 64L94 100" stroke="#2a2d33" stroke-width="5"/>` },

  /* ---------- Nimrod: the garden ---------- */
  pottingBench: { label: 'Potting bench', theme: 'nimrod', on: 'floor', box: [220, 140], color: '#8a5f3c',
    svg: (c) => `<rect x="2" y="44" width="96" height="10" rx="2" fill="${c}"/><rect x="6" y="54" width="6" height="46" fill="${dk(c, 0.8)}"/><rect x="88" y="54" width="6" height="46" fill="${dk(c, 0.8)}"/><rect x="6" y="80" width="88" height="6" fill="${dk(c, 0.8)}"/>${[[14, '#5b7c45'], [34, '#6f8656'], [58, '#4d6730'], [78, '#839958']].map(([x, g], i) => `<path d="M${x} 44l2-14h12l2 14z" fill="#b8704a"/><path d="M${x + 9} 30Q${x + 1} ${12 - i * 2} ${x + 6} 4Q${x + 13} ${14 - i} ${x + 9} 30Q${x + 17} 14 ${x + 21} 10Q${x + 18} 24 ${x + 9} 30z" fill="${g}"/>`).join('')}<path d="M64 70h20l4 10H60z" fill="#839958"/><rect x="20" y="66" width="22" height="14" rx="3" fill="#b8704a"/>` },
  hangingPlant: { label: 'Hanging plant', theme: 'nimrod', on: 'wall', box: [80, 130], color: '#5b7c45',
    svg: (c) => `<path d="M50 0V30M50 30L22 52M50 30L78 52" stroke="#6b4a32" stroke-width="3" fill="none"/><path d="M22 50h56l-6 20H28z" fill="#b8704a"/><path d="M26 66Q14 84 18 100M38 68Q34 88 40 96M62 68Q68 86 60 98M74 66Q88 82 82 100" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="52" rx="30" ry="9" fill="${dk(c, 1.15)}"/>` },
  wateringCan: { label: 'Watering can', theme: 'nimrod', on: 'floor', box: [80, 60], color: '#5a8ad8',
    svg: (c) => `<path d="M24 30h44v66H24z" fill="${c}"/><path d="M68 44L96 18" stroke="${c}" stroke-width="9" stroke-linecap="round"/><path d="M24 30Q6 30 8 52" stroke="${dk(c, 0.8)}" stroke-width="7" fill="none"/><path d="M30 30Q46 0 62 30" stroke="${dk(c, 0.8)}" stroke-width="7" fill="none"/>` },

  /* ---------- Fall: the harvest ---------- */
  hayBale: { label: 'Hay bale', theme: 'fall', on: 'floor', box: [150, 90], color: '#d8b468',
    svg: (c) => `<rect x="2" y="10" width="96" height="88" rx="10" fill="${c}"/><path d="M8 30h84M8 54h84M8 78h84" stroke="${dk(c, 0.82)}" stroke-width="3"/><path d="M28 10v88M72 10v88" stroke="#8a5f3c" stroke-width="5"/><path d="M12 12l6-10M30 10l2-9M64 10l4-9M86 12l6-10" stroke="${c}" stroke-width="3"/>` },
  pumpkinPile: { label: 'Pumpkins', theme: 'fall', on: 'floor', box: [150, 86], color: '#e8833a',
    svg: (c) => `${[[30, 62, 28], [70, 64, 26], [50, 34, 22]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.82}" fill="${c}"/><path d="M${x} ${y - r * 0.8}Q${x - r * 0.5} ${y} ${x} ${y + r * 0.8}M${x} ${y - r * 0.8}Q${x + r * 0.5} ${y} ${x} ${y + r * 0.8}" stroke="${dk(c, 0.75)}" stroke-width="3" fill="none"/><rect x="${x - 3}" y="${y - r * 0.82 - 8}" width="6" height="10" rx="2" fill="#5a6b2c"/>`).join('')}` },
  appleBasket: { label: 'Apple basket', theme: 'fall', on: 'floor', box: [100, 80], color: '#c0392b',
    svg: (c) => `${[[30, 30], [50, 24], [70, 30], [40, 40], [60, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="${c}"/><path d="M${x} ${y - 13}v-6" stroke="#5a3a1a" stroke-width="3"/>`).join('')}<path d="M8 44h84l-10 54H18z" fill="#b8864a"/><path d="M12 58h76M14 74h72M16 88h68" stroke="#8a5f2c" stroke-width="3"/>` },
  leafWreath: { label: 'Leaf wreath', theme: 'fall', on: 'wall', box: [100, 100], color: '#c96a21',
    svg: (c) => `${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, x = 50 + Math.cos(a) * 34, y = 50 + Math.sin(a) * 34; return `<ellipse cx="${x}" cy="${y}" rx="13" ry="7" transform="rotate(${(a * 180) / Math.PI + 90} ${x} ${y})" fill="${['#c96a21', '#a8471c', '#d99a3f'][i % 3] === '#c96a21' ? c : ['#c96a21', '#a8471c', '#d99a3f'][i % 3]}"/>`; }).join('')}<path d="M40 80l10 8 10-8" fill="#9e5449"/>` },
  scarecrow: { label: 'Scarecrow', theme: 'fall', on: 'floor', box: [110, 190], color: '#4d6a8a',
    svg: (c) => `<rect x="47" y="30" width="6" height="70" fill="#6b4a32"/><rect x="6" y="40" width="88" height="6" fill="#6b4a32"/><circle cx="50" cy="22" r="13" fill="#e8d6a8"/><path d="M30 14h40l-6-12H36z" fill="#8a5f3c"/><rect x="26" y="12" width="48" height="4" fill="#8a5f3c"/><path d="M28 36h44l6 34H22z" fill="${c}"/><path d="M8 40l-6 10M92 40l6 10M40 70l-4 10M60 70l4 10" stroke="#d8b468" stroke-width="4"/>` },

  /* ---------- Winter: the lodge ---------- */
  woodStove: { label: 'Wood stove', theme: 'winter', on: 'floor', box: [120, 200], color: '#2a2d33', glow: { x: 50, y: 74, r: 160, c: 'rgba(255,150,60,.45)' },
    svg: (c) => `<rect x="40" y="0" width="20" height="44" fill="${c}"/><rect x="10" y="44" width="80" height="48" rx="8" fill="${c}"/><rect x="24" y="54" width="52" height="30" rx="6" fill="#1b1410"/><path d="M34 84Q38 64 46 72Q50 58 56 72Q62 64 66 84Z" fill="#f6a13a"/><path d="M42 84Q46 72 50 78Q54 72 58 84Z" fill="#ffd36e"/><rect x="16" y="92" width="8" height="8" fill="${c}"/><rect x="76" y="92" width="8" height="8" fill="${c}"/>` },
  skiRack: { label: 'Skis on the wall', theme: 'winter', on: 'wall', box: [120, 150], color: '#c9483b',
    svg: (c) => `<rect x="0" y="40" width="100" height="6" fill="#6b4a32"/><rect x="0" y="70" width="100" height="6" fill="#6b4a32"/>${[[18, c], [38, '#2f6d96'], [62, '#f2d24a'], [82, c]].map(([x, k]) => `<path d="M${x - 4} 98V10Q${x} 0 ${x + 4} 10V98z" fill="${k}"/>`).join('')}` },
  sled: { label: 'Sled', theme: 'winter', on: 'floor', box: [160, 60], color: '#9e3a2e',
    svg: (c) => `<rect x="10" y="18" width="80" height="18" rx="4" fill="${c}"/><path d="M10 36V60M30 36V60M70 36V60M90 36V60" stroke="#6b4a32" stroke-width="5"/><path d="M2 70H88Q100 70 98 52" stroke="#2a2d33" stroke-width="6" fill="none" stroke-linecap="round"/>` },
  snowman: { label: 'Snowman', theme: 'winter', on: 'floor', box: [100, 170], color: '#c9483b',
    svg: (c) => `<circle cx="50" cy="76" r="26" fill="#f4f8fa"/><circle cx="50" cy="40" r="18" fill="#f4f8fa"/><circle cx="50" cy="16" r="12" fill="#f4f8fa"/><path d="M34 8h32M40 8V-6h20V8" fill="#2a2d33" stroke="#2a2d33" stroke-width="4"/><circle cx="46" cy="14" r="2" fill="#2a2d33"/><circle cx="54" cy="14" r="2" fill="#2a2d33"/><path d="M50 18l12 3-12 2z" fill="#e8833a"/><path d="M34 28Q50 36 66 28l2 8Q50 42 32 36z" fill="${c}"/><path d="M66 32l6 14" stroke="${c}" stroke-width="7"/><circle cx="50" cy="44" r="2.5" fill="#2a2d33"/><circle cx="50" cy="54" r="2.5" fill="#2a2d33"/>` },

  /* ---------- Halloween: friendly spooky ---------- */
  cauldron: { label: 'Cauldron', theme: 'halloween', on: 'floor', box: [130, 120], color: '#7fd06a', glow: { x: 50, y: 20, r: 120, c: 'rgba(127,208,106,.45)' },
    svg: (c) => `<path d="M8 34Q8 96 50 96Q92 96 92 34Z" fill="#1e1a24"/><ellipse cx="50" cy="34" rx="44" ry="10" fill="#2a2632"/><ellipse cx="50" cy="34" rx="38" ry="7" fill="${c}"/><circle cx="36" cy="22" r="6" fill="${c}" opacity=".8"/><circle cx="58" cy="14" r="4" fill="${c}" opacity=".7"/><circle cx="66" cy="26" r="5" fill="${c}" opacity=".8"/><path d="M22 92l-6 8M78 92l6 8" stroke="#1e1a24" stroke-width="6"/>` },
  potionShelf: { label: 'Potion shelf', theme: 'halloween', on: 'wall', box: [170, 90], color: '#6b4a32',
    svg: (c) => `<rect x="0" y="88" width="100" height="12" fill="${c}"/>${[[10, '#9a6ad0', 50], [26, '#7fd06a', 64], [42, '#e8833a', 44], [60, '#f28ab0', 58], [78, '#5ab0c8', 50]].map(([x, k, h]) => `<rect x="${x + 3}" y="${88 - h - 10}" width="4" height="12" fill="#c9a24a"/><path d="M${x} ${88 - h}h10v${h * 0.3}l4 ${h * 0.2}v${h * 0.5}h-18v-${h * 0.5}l4 -${h * 0.2}z" fill="${k}" opacity=".9"/>`).join('')}` },
  jackLantern: { label: 'Jack-o’-lantern', theme: 'halloween', on: 'floor', box: [80, 70], color: '#e8833a', glow: { x: 50, y: 50, r: 90, c: 'rgba(255,160,60,.55)' },
    svg: (c) => `<ellipse cx="50" cy="56" rx="46" ry="40" fill="${c}"/><path d="M50 16Q30 56 50 96M50 16Q70 56 50 96" stroke="${dk(c, 0.75)}" stroke-width="3" fill="none"/><rect x="46" y="4" width="8" height="14" rx="2" fill="#5a6b2c"/><path d="M24 48l8-12 8 12zM60 48l8-12 8 12z" fill="#ffe08a"/><path d="M26 64Q50 88 74 64Q62 72 50 70Q38 72 26 64z" fill="#ffe08a"/>` },
  cobweb: { label: 'Cobweb', theme: 'halloween', on: 'wall', box: [110, 110], color: '#e6e2f0',
    svg: (c) => `<g stroke="${c}" stroke-width="1.6" fill="none" opacity=".75"><path d="M0 0L100 100M0 0L100 40M0 0L40 100M0 0L100 0M0 0L0 100"/><path d="M0 24Q14 14 24 0M0 48Q30 30 48 0M0 72Q44 46 72 0M0 96Q60 60 96 0"/></g><path d="M60 54v14" stroke="${c}" stroke-width="1.2"/><circle cx="60" cy="72" r="5" fill="#1e1a24"/><circle cx="58" cy="71" r="1.2" fill="#fff"/><circle cx="62" cy="71" r="1.2" fill="#fff"/>` },

  /* ---------- Christmas ---------- */
  xmasTree: { label: 'Christmas tree', theme: 'christmas', on: 'floor', box: [150, 230], color: '#2f6a40', glow: { x: 50, y: 6, r: 110, c: 'rgba(255,220,120,.5)' },
    svg: (c) => `<path d="M50 6L74 38H62L84 66H70L96 92H4L30 66H16L38 38H26Z" fill="${c}"/><rect x="42" y="92" width="16" height="8" fill="#6b4a32"/>${[[44, 30, '#ff6b5a'], [58, 46, '#ffd36e'], [36, 56, '#7fc6ff'], [62, 70, '#ff6b5a'], [30, 80, '#ffd36e'], [72, 84, '#7fe0a0'], [48, 76, '#7fc6ff']].map(([x, y, k]) => `<circle cx="${x}" cy="${y}" r="3.4" fill="${k}"/>`).join('')}<path d="M50 0l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#ffd36e"/>` },
  stocking: { label: 'Stocking', theme: 'christmas', on: 'wall', box: [50, 90], color: '#c9483b',
    svg: (c) => `<rect x="20" y="0" width="44" height="18" rx="4" fill="#f4f1e8"/><path d="M24 18H60V64Q60 74 52 80L26 98Q10 100 8 88Q8 78 24 70Z" fill="${c}"/><path d="M30 40h24M30 54h24" stroke="#f4f1e8" stroke-width="4"/>` },
  presents: { label: 'Presents', theme: 'christmas', on: 'floor', box: [150, 80], color: '#c9483b',
    svg: (c) => `${[[2, 30, 40, 68, c], [38, 10, 34, 88, '#2f6d96'], [68, 40, 30, 58, '#e2b45a']].map(([x, y, w, h, k]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${k}"/><rect x="${x + w / 2 - 3}" y="${y}" width="6" height="${h}" fill="#f4f1e8"/><rect x="${x}" y="${y + h * 0.3}" width="${w}" height="6" fill="#f4f1e8"/><path d="M${x + w / 2} ${y}q-10-10-12 0q2 6 12 0q10 6 12 0q-2-10-12 0" fill="#f4f1e8"/>`).join('')}` },
  wreath: { label: 'Wreath', theme: 'christmas', on: 'wall', box: [100, 100], color: '#2f6a40',
    svg: (c) => `<circle cx="50" cy="50" r="36" fill="none" stroke="${c}" stroke-width="18"/><circle cx="50" cy="50" r="36" fill="none" stroke="${dk(c, 1.25)}" stroke-width="6" stroke-dasharray="4 10"/>${[[24, 30], [74, 34], [30, 74], [72, 70], [50, 16]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#c9302b"/>`).join('')}<path d="M40 84l10-8 10 8-6 14-4-8-4 8z" fill="#c9302b"/>` },

  /* ---------- Steampunk ---------- */
  boiler: { label: 'Boiler', theme: 'steampunk', on: 'floor', box: [140, 210], color: '#a8854d', glow: { x: 50, y: 72, r: 130, c: 'rgba(255,150,60,.45)' },
    svg: (c) => `<rect x="62" y="0" width="12" height="30" fill="#5a3c24"/><rect x="14" y="22" width="72" height="66" rx="30" fill="${c}"/><path d="M14 40h72M14 70h72" stroke="${dk(c, 0.72)}" stroke-width="4"/>${[22, 36, 50, 64, 78].map((x) => `<circle cx="${x}" cy="40" r="2" fill="${dk(c, 0.6)}"/><circle cx="${x}" cy="70" r="2" fill="${dk(c, 0.6)}"/>`).join('')}<circle cx="50" cy="55" r="11" fill="#f4efe0" stroke="#5a3c24" stroke-width="3"/><path d="M50 55l6-5" stroke="#9e3a2e" stroke-width="2.4"/><rect x="34" y="74" width="32" height="12" rx="3" fill="#1b1410"/><rect x="38" y="77" width="24" height="6" fill="#f6a13a"/><rect x="20" y="88" width="10" height="12" fill="#5a3c24"/><rect x="70" y="88" width="10" height="12" fill="#5a3c24"/>` },
  gearWall: { label: 'Gears on the wall', theme: 'steampunk', on: 'wall', box: [150, 120], color: '#a8854d',
    svg: (c) => `${[[34, 44, 30, c], [72, 66, 22, dk(c, 0.8)], [80, 22, 14, dk(c, 1.12)]].map(([x, y, r, k]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${k}" stroke-width="${r * 0.36}" stroke-dasharray="${r * 0.38} ${r * 0.26}"/><circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="${k}"/><circle cx="${x}" cy="${y}" r="${r * 0.22}" fill="#3a2a1a"/>`).join('')}` },
  telescope: { label: 'Telescope', theme: 'steampunk', on: 'floor', box: [140, 170], color: '#c9a24a',
    svg: (c) => `<path d="M14 52L86 14" stroke="${c}" stroke-width="16" stroke-linecap="round"/><path d="M12 54L40 40" stroke="${dk(c, 0.75)}" stroke-width="20" stroke-linecap="round"/><circle cx="50" cy="34" r="6" fill="#5a3c24"/><path d="M50 36L26 100M50 36L74 100M50 36V100" stroke="#5a3c24" stroke-width="5"/>` },
  workbench: { label: 'Workbench', theme: 'steampunk', on: 'floor', box: [230, 130], color: '#6b4a32',
    svg: (c) => `<rect x="0" y="42" width="100" height="12" fill="${c}"/><rect x="4" y="54" width="6" height="46" fill="${dk(c, 0.8)}"/><rect x="90" y="54" width="6" height="46" fill="${dk(c, 0.8)}"/><rect x="4" y="80" width="92" height="6" fill="${dk(c, 0.8)}"/><circle cx="24" cy="30" r="10" fill="none" stroke="#a8854d" stroke-width="5" stroke-dasharray="4 3"/><path d="M44 42V20h10v22M60 42l8-26 4 2-6 24" fill="#8a8f96"/><rect x="74" y="28" width="20" height="14" rx="2" fill="#a8854d"/><circle cx="84" cy="35" r="4" fill="#f4efe0"/>` },
  /* ---------- the newer worlds ---------- */
  teaTray: { label: "Tea tray", theme: 'cozy', on: 'floor', box: [120, 70], color: '#f4ede0',
    svg: (c) => `<rect x="4" y="62" width="92" height="10" rx="4" fill="#8a5f3c"/><path d="M20 62Q20 30 42 30Q64 30 64 62Z" fill="${c}"/><path d="M64 42Q80 40 78 52" stroke="${c}" stroke-width="6" fill="none"/><path d="M20 46Q8 42 10 30" stroke="${c}" stroke-width="5" fill="none"/><rect x="38" y="22" width="8" height="10" rx="3" fill="${dk(c, 0.7)}"/><rect x="70" y="50" width="18" height="12" rx="3" fill="${c}"/>` },
  quiltStack: { label: "Quilt stack", theme: 'cozy', on: 'floor', box: [110, 90], color: '#9e5449',
    svg: (c) => `${[0, 1, 2, 3].map((i) => `<rect x="${4 + i * 2}" y="${70 - i * 20}" width="${92 - i * 4}" height="20" rx="6" fill="${[c, "#e2b45a", "#5b7c45", "#8a6a9a"][i]}"/><path d="M${10 + i * 2} ${80 - i * 20}h${80 - i * 4}" stroke="#fff" stroke-width="2" stroke-dasharray="5 4" opacity=".6"/>`).join("")}` },
  tulipPot: { label: "Tulip pot", theme: 'spring', on: 'floor', box: [70, 110], color: '#e86a6a',
    svg: (c) => `<path d="M24 70h52l-6 30H30z" fill="#b8704a"/>${[30, 50, 70].map((x, i) => `<path d="M${x} 70V${30 + i * 4}" stroke="#4d7a3a" stroke-width="4"/><path d="M${x - 9} ${30 + i * 4}Q${x - 9} ${14 + i * 4} ${x} ${18 + i * 4}Q${x + 9} ${14 + i * 4} ${x + 9} ${30 + i * 4}Q${x} ${38 + i * 4} ${x - 9} ${30 + i * 4}Z" fill="${i === 1 ? "#f2b13c" : c}"/>`).join("")}` },
  birdhouse: { label: "Birdhouse", theme: 'spring', on: 'wall', box: [70, 100], color: '#a8d0a0',
    svg: (c) => `<path d="M50 4L96 40H4Z" fill="#9e5449"/><rect x="14" y="38" width="72" height="56" fill="${c}"/><circle cx="50" cy="60" r="11" fill="#2a1a10"/><rect x="40" y="76" width="20" height="4" fill="#6b4a32"/><rect x="47" y="92" width="6" height="8" fill="#6b4a32"/>` },
  beachUmbrella: { label: "Beach umbrella", theme: 'summer', on: 'floor', box: [160, 180], color: '#2aa8a8',
    svg: (c) => `<path d="M4 40Q50 -14 96 40Z" fill="${c}"/><path d="M27 40Q36 6 50 2Q64 6 73 40" fill="#fbf6ea"/><path d="M50 40V100" stroke="#6b4a32" stroke-width="4"/>` },
  sandcastle: { label: "Sandcastle", theme: 'summer', on: 'floor', box: [120, 90], color: '#e8d6a0',
    svg: (c) => `<rect x="10" y="50" width="80" height="50" fill="${c}"/><rect x="18" y="28" width="22" height="24" fill="${c}"/><rect x="60" y="28" width="22" height="24" fill="${c}"/><rect x="42" y="72" width="16" height="28" rx="8" fill="${dk(c, 0.7)}"/><path d="M71 28V8l14 6-14 6" fill="#e86a6a"/>` },
  moonLamp: { label: "Moon lamp", theme: 'night', on: 'floor', box: [70, 90], color: '#f2e6b0', glow: { x: 50, y: 40, r: 140, c: 'rgba(242,230,176,.5)' },
    svg: (c) => `<circle cx="50" cy="38" r="34" fill="${c}"/><circle cx="38" cy="30" r="6" fill="${dk(c, 0.88)}"/><circle cx="60" cy="48" r="8" fill="${dk(c, 0.88)}"/><rect x="34" y="78" width="32" height="20" rx="4" fill="#3a4256"/>` },
  starChart: { label: "Star chart", theme: 'night', on: 'wall', box: [130, 100], color: '#1b2a4a',
    svg: (c) => `<rect x="2" y="2" width="96" height="96" rx="4" fill="${c}" stroke="#c9a24a" stroke-width="4"/><path d="M20 70L36 40L58 52L78 24" stroke="#c9d4e8" stroke-width="2"/>${[[20, 70], [36, 40], [58, 52], [78, 24], [70, 76], [30, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#f2d24a"/>`).join("")}` },
  shipWheel: { label: "Ship wheel", theme: 'ocean', on: 'wall', box: [110, 110], color: '#8a5a32',
    svg: (c) => `${[0, 45, 90, 135].map((a) => `<rect x="47" y="0" width="6" height="100" rx="3" fill="${c}" transform="rotate(${a} 50 50)"/>`).join("")}<circle cx="50" cy="50" r="30" fill="none" stroke="${c}" stroke-width="8"/><circle cx="50" cy="50" r="10" fill="${dk(c, 0.7)}"/>` },
  lifebuoy: { label: "Lifebuoy", theme: 'ocean', on: 'wall', box: [90, 90], color: '#e85a4a',
    svg: (c) => `<circle cx="50" cy="50" r="38" fill="none" stroke="#f4f6f8" stroke-width="20"/><circle cx="50" cy="50" r="38" fill="none" stroke="${c}" stroke-width="20" stroke-dasharray="30 30"/>` },
  anchor: { label: "Anchor", theme: 'ocean', on: 'floor', box: [80, 110], color: '#3a4a5a',
    svg: (c) => `<circle cx="50" cy="12" r="9" fill="none" stroke="${c}" stroke-width="6"/><path d="M50 20V92M30 34H70M12 64Q14 92 50 92Q86 92 88 64" stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round"/>` },
  arcadeCabinet: { label: "Arcade cabinet", theme: 'cyberpunk', on: 'floor', box: [100, 200], color: '#2a1f4a', glow: { x: 50, y: 20, r: 120, c: 'rgba(45,226,230,.45)' },
    svg: (c) => `<path d="M14 100V10Q14 2 22 2H78Q86 2 86 10V100Z" fill="${c}"/><rect x="22" y="12" width="56" height="34" rx="3" fill="#2de2e6"/><path d="M30 36l8-12 8 8 8-14 10 18" stroke="#ff2e88" stroke-width="3" fill="none"/><rect x="18" y="52" width="64" height="10" fill="#ff2e88"/><circle cx="36" cy="57" r="4" fill="#f2e27a"/><circle cx="62" cy="57" r="4" fill="#2de2e6"/>` },
  neonSign: { label: "Neon sign", theme: 'cyberpunk', on: 'wall', box: [150, 70], color: '#ff2e88', glow: { x: 50, y: 50, r: 120, c: 'rgba(255,46,136,.45)' },
    svg: (c) => `<rect x="2" y="2" width="96" height="96" rx="14" fill="#14121f"/><path d="M18 70V30L40 70V30M52 30h22M63 30v40M84 30v40" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` },
  balloonBunch: { label: "Balloons", theme: 'newYear', on: 'floor', box: [80, 170], color: '#d9b34a',
    svg: (c) => `${[[30, 22, c], [56, 14, "#7fe0d8"], [70, 34, "#ff8ab0"], [40, 40, "#f4f4f8"]].map(([x, y, col]) => `<path d="M${x} ${y + 14}Q${x + 6} 70 50 100" stroke="#8a8a9a" stroke-width="1.5" fill="none"/><ellipse cx="${x}" cy="${y}" rx="13" ry="16" fill="${col}"/>`).join("")}` },
  countdownClock: { label: "Countdown clock", theme: 'newYear', on: 'wall', box: [110, 110], color: '#16161e',
    svg: (c) => `<circle cx="50" cy="50" r="46" fill="#f4f4f8" stroke="${c}" stroke-width="7"/><path d="M50 50V12M50 50L54 14" stroke="${c}" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="50" r="5" fill="#d9b34a"/>` },
  redLantern: { label: "Red lantern", theme: 'lunarNewYear', on: 'wall', box: [70, 120], color: '#c9302b', glow: { x: 50, y: 48, r: 100, c: 'rgba(255,120,80,.4)' },
    svg: (c) => `<path d="M50 0V12" stroke="#3a1a10" stroke-width="3"/><rect x="30" y="10" width="40" height="8" fill="#e2b45a"/><ellipse cx="50" cy="48" rx="40" ry="32" fill="${c}"/><path d="M30 20Q22 48 30 76M50 16V80M70 20Q78 48 70 76" stroke="${dk(c, 0.7)}" stroke-width="3" fill="none"/><rect x="30" y="78" width="40" height="8" fill="#e2b45a"/><path d="M50 86V100" stroke="#e2b45a" stroke-width="4"/>` },
  teaSet: { label: "Tea set", theme: 'lunarNewYear', on: 'floor', box: [120, 70], color: '#f4f1e8',
    svg: (c) => `<rect x="4" y="62" width="92" height="10" rx="4" fill="#6b2418"/><path d="M28 62Q22 34 44 34Q66 34 60 62Z" fill="${c}"/><path d="M30 46h28" stroke="#2f6d96" stroke-width="3"/><circle cx="44" cy="30" r="5" fill="${c}"/><path d="M72 62Q70 50 78 50Q86 50 84 62Z" fill="${c}"/>` },
  heartGarland: { label: "Heart garland", theme: 'valentines', on: 'wall', box: [200, 60], color: '#e0587a',
    svg: (c) => `<path d="M0 10Q50 50 100 10" stroke="#9c6a7a" stroke-width="2" fill="none"/>${[10, 30, 50, 70, 90].map((x, i) => `<path transform="translate(${x - 8} ${12 + 20 * (1 - Math.pow(2 * x / 100 - 1, 2))})" d="M8 14C2 9 0 6 0 4a4 4 0 0 1 8-1.5A4 4 0 0 1 16 4c0 2-2 5-8 10z" fill="${i % 2 ? "#fbe2e8" : c}"/>`).join("")}` },
  roseVase: { label: "Vase of roses", theme: 'valentines', on: 'floor', box: [60, 110], color: '#b0303e',
    svg: (c) => `<path d="M34 60h32l-4 40H38z" fill="#c9d4e8"/>${[[36, 26], [50, 18], [64, 28], [44, 40], [58, 42]].map(([x, y]) => `<path d="M${x} ${y + 6}L50 62" stroke="#3e6a2a" stroke-width="3"/><circle cx="${x}" cy="${y}" r="9" fill="${c}"/><circle cx="${x}" cy="${y}" r="4" fill="${dk(c, 0.7)}"/>`).join("")}` },
  potOfGold: { label: "Pot of gold", theme: 'stPatricks', on: 'floor', box: [90, 80], color: '#2a2d33',
    svg: (c) => `<ellipse cx="50" cy="30" rx="44" ry="10" fill="#f2c230"/>${[[30, 26], [46, 22], [62, 26], [38, 18], [56, 16]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#ffe08a" stroke="#c9a020" stroke-width="2"/>`).join("")}<path d="M8 32Q8 92 50 96Q92 92 92 32Z" fill="${c}"/><rect x="4" y="30" width="92" height="8" rx="4" fill="#4a4d55"/>` },
  cloverPlanter: { label: "Clover planter", theme: 'stPatricks', on: 'floor', box: [100, 70], color: '#3c8f46',
    svg: (c) => `<rect x="4" y="50" width="92" height="44" rx="4" fill="#8a5f3c"/>${[16, 36, 56, 76].map((x, i) => `<g transform="translate(${x} ${30 - (i % 2) * 6})" fill="${c}"><circle cx="0" cy="-6" r="7"/><circle cx="-6" cy="2" r="7"/><circle cx="6" cy="2" r="7"/><path d="M0 4v18" stroke="#2f5a2a" stroke-width="3"/></g>`).join("")}` },
  eggBasket: { label: "Egg basket", theme: 'easter', on: 'floor', box: [110, 90], color: '#c8964a',
    svg: (c) => `${[[26, "#b8d8f0"], [42, "#f6c8d8"], [58, "#f2e08a"], [74, "#c8e6b8"]].map(([x, col]) => `<ellipse cx="${x}" cy="44" rx="11" ry="14" fill="${col}"/>`).join("")}<path d="M10 50H90L82 96H18Z" fill="${c}"/><path d="M10 50Q50 -10 90 50" stroke="${c}" stroke-width="6" fill="none"/><path d="M16 64H84M18 80H82" stroke="${dk(c, 0.75)}" stroke-width="3"/>` },
  bunnyStatue: { label: "Garden bunny", theme: 'easter', on: 'floor', box: [70, 110], color: '#f4f1e8',
    svg: (c) => `<ellipse cx="38" cy="18" rx="8" ry="20" fill="${c}"/><ellipse cx="60" cy="18" rx="8" ry="20" fill="${c}"/><circle cx="50" cy="44" r="18" fill="${c}"/><ellipse cx="50" cy="80" rx="28" ry="22" fill="${c}"/><circle cx="44" cy="42" r="2.5" fill="#2a2d33"/><circle cx="56" cy="42" r="2.5" fill="#2a2d33"/><circle cx="50" cy="50" r="3" fill="#e88a8c"/>` },
  bunting: { label: "Bunting", theme: 'july4', on: 'wall', box: [200, 50], color: '#b0303e',
    svg: (c) => `<path d="M0 8Q50 30 100 8" stroke="#6b4a32" stroke-width="2" fill="none"/>${[6, 22, 38, 54, 70, 86].map((x, i) => `<path d="M${x} ${12 + Math.sin((x / 100) * Math.PI) * 10}h12l-6 30z" fill="${[c, "#f4f1e8", "#2a3a6a"][i % 3]}"/>`).join("")}` },
  grill: { label: "Barbecue grill", theme: 'july4', on: 'floor', box: [100, 110], color: '#2a2d33',
    svg: (c) => `<path d="M10 34H90Q90 70 50 70Q10 70 10 34Z" fill="${c}"/><rect x="8" y="28" width="84" height="8" rx="3" fill="#8a8f96"/><path d="M30 70L20 100M70 70L80 100M50 70V100" stroke="${c}" stroke-width="5"/><path d="M34 20q4-8 0-14M50 20q4-8 0-14M66 20q4-8 0-14" stroke="#c9cfd8" stroke-width="3" fill="none" opacity=".7"/>` },
  diyaRow: { label: "Row of diyas", theme: 'diwali', on: 'floor', box: [160, 50], color: '#b0602a', glow: { x: 50, y: 50, r: 120, c: 'rgba(255,190,90,.55)' },
    svg: (c) => `${[10, 30, 50, 70, 90].map((x) => `<path d="M${x - 9} 70Q${x} 96 ${x + 9} 70Z" fill="${c}"/><path d="M${x} 66Q${x - 5} 52 ${x} 36Q${x + 5} 52 ${x} 66Z" fill="#ffc457"/>`).join("")}` },
  rangoliMat: { label: "Rangoli", theme: 'diwali', on: 'floor', box: [200, 60], color: '#e8502b',
    svg: (c) => `<ellipse cx="50" cy="50" rx="48" ry="46" fill="${c}"/><ellipse cx="50" cy="50" rx="38" ry="36" fill="#ffc457"/><ellipse cx="50" cy="50" rx="28" ry="26" fill="#b02a7a"/><ellipse cx="50" cy="50" rx="16" ry="15" fill="#5ab0c8"/><ellipse cx="50" cy="50" rx="6" ry="6" fill="#fff4c8"/>` },
  cornucopia: { label: "Cornucopia", theme: 'harvest', on: 'floor', box: [140, 90], color: '#c8964a',
    svg: (c) => `<path d="M96 30Q60 0 30 30Q8 52 4 90Q30 70 60 72Q90 70 96 30Z" fill="${c}"/><path d="M80 24Q60 10 40 30" stroke="${dk(c, 0.7)}" stroke-width="3" fill="none"/><circle cx="18" cy="76" r="10" fill="#c96a21"/><circle cx="34" cy="84" r="9" fill="#a8401e"/><ellipse cx="10" cy="60" rx="7" ry="10" fill="#d0a030"/>` },
  pieTable: { label: "Pie on a table", theme: 'harvest', on: 'floor', box: [110, 90], color: '#8a5f3c',
    svg: (c) => `<rect x="4" y="44" width="92" height="8" fill="${c}"/><path d="M14 52V100M86 52V100" stroke="${dk(c, 0.8)}" stroke-width="6"/><ellipse cx="50" cy="40" rx="30" ry="9" fill="#d99a3f"/><path d="M26 38h48M32 34h36" stroke="#a8641e" stroke-width="2"/>` },
  menorah: { label: "Menorah", theme: 'hanukkah', on: 'floor', box: [150, 120], color: '#c9cfd8', glow: { x: 50, y: 10, r: 140, c: 'rgba(255,214,140,.5)' },
    svg: (c) => `${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => { const x = 6 + i * 11, top = i === 4 ? 22 : 34; return `<rect x="${x - 2}" y="${top}" width="5" height="${54 - top}" fill="${c}"/><path d="M${x + 0.5} ${top - 2}Q${x - 3} ${top - 10} ${x + 0.5} ${top - 16}Q${x + 4} ${top - 10} ${x + 0.5} ${top - 2}Z" fill="#ffc457"/>`; }).join("")}<rect x="4" y="52" width="92" height="6" rx="3" fill="${c}"/><rect x="47" y="58" width="6" height="32" fill="${c}"/><rect x="32" y="90" width="36" height="8" rx="3" fill="${c}"/>` },
  dreidel: { label: "Dreidel", theme: 'hanukkah', on: 'floor', box: [60, 80], color: '#2a5aa8',
    svg: (c) => `<rect x="46" y="0" width="8" height="18" rx="3" fill="#8a5f3c"/><path d="M14 18H86V60L50 100L14 60Z" fill="${c}"/><path d="M14 18H50V60L14 60Z" fill="${dk(c, 0.8)}"/><path d="M58 34v18M58 34h12v18" stroke="#f4f6f8" stroke-width="4" fill="none"/>` },
};

/* The worlds, in the order the editors list them. */
export const KIT_WORLDS = [['any', 'Every world'], ['nimrod', 'Nimrod'], ['fall', 'Fall'], ['winter', 'Winter'], ['halloween', 'Halloween'], ['christmas', 'Christmas'], ['steampunk', 'Steampunk'], ['cozy', 'Cozy'], ['spring', 'Spring'], ['summer', 'Summer'], ['night', 'Night'], ['ocean', 'Ocean'], ['cyberpunk', 'Cyberpunk'], ['newYear', "New Year's"], ['lunarNewYear', 'Lunar New Year'], ['valentines', "Valentine's Day"], ['stPatricks', "St Patrick's Day"], ['easter', 'Easter'], ['july4', 'Fourth of July'], ['diwali', 'Diwali'], ['harvest', 'Harvest'], ['hanukkah', 'Hanukkah']];
export const kitByWorld = (w) => Object.keys(KIT).filter((k) => KIT[k].theme === w);
export const KIT_API = { KIT, KIT_WORLDS, kitByWorld };
