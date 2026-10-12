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
};

/* The worlds, in the order the editors list them. */
export const KIT_WORLDS = [['any', 'Every world'], ['nimrod', 'Nimrod'], ['fall', 'Fall'], ['winter', 'Winter'], ['halloween', 'Halloween'], ['christmas', 'Christmas'], ['steampunk', 'Steampunk']];
export const kitByWorld = (w) => Object.keys(KIT).filter((k) => KIT[k].theme === w);
export const KIT_API = { KIT, KIT_WORLDS, kitByWorld };
