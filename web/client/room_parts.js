// room_parts.js — THE PIECES OF A BUILD-YOUR-OWN ROOM, ported from Claude Design.
//
// Source of truth: Design's `roomParts.jsx` (the room-is-the-screen copy, 2026-09-30, which adds the
// door and the speaker to the guide-and-rooms one), plus `NameSign.jsx`, `PictureFrame.jsx` and the
// clock and calendar inside `RoomScene.jsx`. Those are React; this client is vanilla ES modules, so
// this file PORTS them to DOM builders. It does not redesign them.
//
// *** EVERY NUMBER AND COLOUR BELOW IS DESIGN'S, COPIED, NOT CHOSEN HERE. *** The box sizes, the
// percentages inside each part, the colour-mix amounts, the veils, the glows and the shell polygons
// are Design's exact values. The ONE mechanical change: Design's stylesheet made every part child
// `position:absolute` (`.rm>*`); here that is set inline by the builder, so a part draws correctly
// before (or without) `room_scene.css` arriving. The stylesheet only adds motion.
//
// WHY THE ROOM ART'S COLOURS LIVE HERE AND NOT IN theme.js: they are the ART (a green sofa, a brick
// wall, a brass knob), not the interface. A theme changes the panels and the words; it does not
// repaint the furniture, the same way it does not repaint a photograph. A recipe CAN recolour any
// part (`color` on an item, the wall and floor colours), which is where a person's own choice goes.
// The interface pieces this file draws that DO carry words (the clock face, the calendar) are
// Design's fixed faces; `dev/room_scene_test.html` measures their contrast.
//
// A room is layers, each swappable on its own (Design's words):
//   SHELL      the geometry: which walls you see, where the floor meets them.
//   WALL       a finish (paint, stripes, sprig paper, boards, brick, limewash) in any colour,
//              plus an optional wainscot below the dado rail.
//   FLOOR      a finish (boards, carpet, tile, slate), foreshortened in real perspective.
//   LIGHT      day / evening / night, or `auto` from the real clock.
//   FURNITURE  drawn pieces that stand on the floor or hang on the wall.
//   MOUNTS     the things that carry CONTENT: picture frames, name signs, a live clock, a live
//              calendar, module slots, and Nimrod. See room_scene.js.
//
// Everything moving is decoration and sits inside prefers-reduced-motion: no-preference (in
// room_scene.css): the fire, lamp glow, curtains, the plant, the steam off a mug. None of it
// flashes: a fire that flickers fast is a strobe, so these flames breathe instead.

export const STAGE = Object.freeze({ w: 960, h: 540 });

export const mix = (c, other, pct) => `color-mix(in oklab, ${c} ${pct}%, ${other})`;
const svgUri = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

/* ---------- SHELLS. Stage is 960×540; all numbers are percent of it. ---------- */
export const ROOM_SHELLS = {
  room: {
    label: 'Room (three walls)',
    back: { l: 16, r: 84, t: 0, b: 66 },
    left: 'polygon(0 0,16% 0,16% 66%,0 100%)',
    right: 'polygon(84% 0,100% 0,100% 100%,84% 66%)',
    floor: 'polygon(16% 66%,84% 66%,100% 100%,0 100%)',
  },
  corner: {
    label: 'Corner (two walls)',
    back: { l: 24, r: 100, t: 0, b: 66 },
    left: 'polygon(0 0,24% 0,24% 66%,0 100%)',
    floor: 'polygon(24% 66%,100% 66%,100% 100%,0 100%)',
  },
  flat: {
    label: 'Straight on (one wall)',
    back: { l: 0, r: 100, t: 0, b: 70 },
    floor: 'polygon(0 70%,100% 70%,100% 100%,0 100%)',
  },
  attic: {
    label: 'Attic (sloped ceiling)',
    back: { l: 16, r: 84, t: 0, b: 66 },
    left: 'polygon(0 0,16% 0,16% 66%,0 100%)',
    right: 'polygon(84% 0,100% 0,100% 100%,84% 66%)',
    floor: 'polygon(16% 66%,84% 66%,100% 100%,0 100%)',
    ceiling: ['polygon(0 0,34% 0,16% 22%,0 36%)', 'polygon(66% 0,100% 0,100% 36%,84% 22%)'],
  },
};

/* ---------- WALL FINISHES. css(colour) → a CSS background. ---------- */
export const WALL_FINISHES = {
  paint: { label: 'Paint', color: '#d9d2b6', css: (c) => c },
  stripes: { label: 'Striped paper', color: '#c9d6d3', css: (c) => `repeating-linear-gradient(90deg,${c} 0 26px,${mix(c, '#000', 90)} 26px 30px,${c} 30px 34px,${mix(c, '#000', 94)} 34px 60px)` },
  sprig: {
    label: 'Sprig paper', color: '#e6dcc4',
    css: (c) => `${svgUri(56, 56, `<g fill='%23000' fill-opacity='.13'><path d='M14 10c4 2 5 6 3 10-3-2-5-6-3-10zM14 20c-4-1-7 1-8 4 4 1 7-1 8-4z'/><path d='M42 38c4 2 5 6 3 10-3-2-5-6-3-10zM42 48c-4-1-7 1-8 4 4 1 7-1 8-4z'/></g>`).replace(/%2523/g, '%23')},${c}`,
  },
  boards: { label: 'Wood boards', color: '#a8794e', css: (c) => `repeating-linear-gradient(90deg,rgba(0,0,0,.22) 0 2px,transparent 2px 46px),repeating-linear-gradient(90deg,transparent 0 13px,rgba(255,255,255,.05) 13px 15px,transparent 15px 46px),linear-gradient(180deg,${c},${mix(c, '#000', 86)})` },
  brick: {
    label: 'Brick', color: '#9b5a44',
    css: (c) => `${svgUri(48, 44, `<path d='M0 21h48M0 43h48M24 0v21M0 22v21M48 22v21' stroke='%23e8dccb' stroke-opacity='.55' stroke-width='2.2'/>`).replace(/%2523/g, '%23')},radial-gradient(120% 80% at 30% 20%,${mix(c, '#fff', 88)},${mix(c, '#000', 88)})`,
  },
  limewash: { label: 'Limewash', color: '#cfd8cf', css: (c) => `radial-gradient(40% 30% at 22% 30%,${mix(c, '#fff', 88)},transparent 70%),radial-gradient(50% 40% at 74% 64%,${mix(c, '#000', 93)},transparent 70%),radial-gradient(30% 25% at 60% 18%,${mix(c, '#fff', 90)},transparent 70%),${c}` },
};

/* ---------- FLOOR FINISHES. Drawn flat, then tilted by the scene so they foreshorten. ---------- */
export const FLOOR_FINISHES = {
  boards: { label: 'Floorboards', color: '#9a6a42', css: (c) => `repeating-linear-gradient(90deg,rgba(0,0,0,.24) 0 2px,transparent 2px 58px),repeating-linear-gradient(0deg,transparent 0 170px,rgba(0,0,0,.14) 170px 172px),repeating-linear-gradient(90deg,${c} 0 58px,${mix(c, '#000', 92)} 58px 116px,${mix(c, '#fff', 94)} 116px 174px)` },
  carpet: { label: 'Carpet', color: '#8c7b68', css: (c) => `radial-gradient(circle at 30% 40%,rgba(255,255,255,.05) 0 1px,transparent 1.5px) 0 0/7px 7px,radial-gradient(circle at 70% 60%,rgba(0,0,0,.06) 0 1px,transparent 1.5px) 0 0/9px 9px,${c}` },
  tile: { label: 'Checker tile', color: '#e8e2d2', css: (c) => `conic-gradient(${c} 25%,${mix(c, '#233', 52)} 0 50%,${c} 0 75%,${mix(c, '#233', 52)} 0) 0 0/96px 96px` },
  slate: { label: 'Slate', color: '#5d6468', css: (c) => `repeating-linear-gradient(0deg,rgba(255,255,255,.12) 0 2px,transparent 2px 90px),repeating-linear-gradient(90deg,rgba(255,255,255,.12) 0 2px,transparent 2px 90px),radial-gradient(60% 40% at 30% 30%,${mix(c, '#fff', 90)},${c})` },
};

/* ---------- FURNITURE. box = [w, h] in stage px at scale 1; render(colour) draws inside it.
   `on` says where it lives. `glow` is a light the part gives off, drawn ABOVE the room's lighting
   so a lamp still lights a dark room. A part is a list of `{ k, s, c, kids }`: a key (kept as
   `data-part`, so a reaction can find the door's leaf), a style, a class, and nested parts. ---------- */
const P = (k, s, c, kids) => ({ k, s, c, kids });
const legs = (xs, c, h = '10%') => xs.map((x) => P('l' + x, { left: x + '%', bottom: 0, width: '4%', height: h, background: c, borderRadius: 2 }));

export const FURNITURE = {
  sofa: {
    label: 'Sofa', on: 'floor', box: [270, 118], color: '#6f8656',
    render: (c) => [
      P('back', { left: '6%', right: '6%', top: 0, height: '58%', background: mix(c, '#000', 86), borderRadius: '16px 16px 6px 6px' }),
      P('c1', { left: '12%', width: '37%', top: '8%', height: '46%', background: c, borderRadius: 12, boxShadow: 'inset 0 -6px 0 rgba(0,0,0,.12)' }),
      P('c2', { right: '12%', width: '37%', top: '8%', height: '46%', background: c, borderRadius: 12, boxShadow: 'inset 0 -6px 0 rgba(0,0,0,.12)' }),
      P('seat', { left: '6%', right: '6%', top: '50%', height: '32%', background: mix(c, '#fff', 92), borderRadius: 10 }),
      P('al', { left: 0, width: '12%', top: '30%', height: '56%', background: mix(c, '#000', 80), borderRadius: 14 }),
      P('ar', { right: 0, width: '12%', top: '30%', height: '56%', background: mix(c, '#000', 80), borderRadius: 14 }),
      ...legs([6, 90], '#3a2614', '14%'),
    ],
  },
  armchair: {
    label: 'Armchair', on: 'floor', box: [140, 124], color: '#9e5449',
    render: (c) => [
      P('back', { left: '12%', right: '12%', top: 0, height: '62%', background: mix(c, '#000', 86), borderRadius: '40% 40% 10% 10%' }),
      P('seat', { left: '10%', right: '10%', top: '52%', height: '30%', background: c, borderRadius: 10 }),
      P('al', { left: 0, width: '20%', top: '34%', height: '52%', background: mix(c, '#000', 78), borderRadius: 16 }),
      P('ar', { right: 0, width: '20%', top: '34%', height: '52%', background: mix(c, '#000', 78), borderRadius: 16 }),
      ...legs([10, 86], '#3a2614', '14%'),
    ],
  },
  bed: {
    label: 'Bed', on: 'floor', box: [300, 150], color: '#7f9bb0',
    render: (c) => [
      P('head', { left: 0, right: 0, top: 0, height: '64%', background: '#6b4a32', borderRadius: '14px 14px 0 0' }),
      P('p1', { left: '10%', width: '36%', top: '30%', height: '20%', background: '#f4f1e8', borderRadius: 12 }),
      P('p2', { right: '10%', width: '36%', top: '30%', height: '20%', background: '#f4f1e8', borderRadius: 12 }),
      P('duvet', { left: '-2%', right: '-2%', top: '46%', height: '42%', background: `linear-gradient(180deg,${mix(c, '#fff', 86)},${c})`, borderRadius: '8px 8px 14px 14px' }),
      P('fold', { left: '-2%', right: '-2%', top: '46%', height: '8%', background: '#f4f1e8', borderRadius: 8 }),
      ...legs([2, 94], '#4a3222', '12%'),
    ],
  },
  bookshelf: {
    label: 'Bookshelf', on: 'floor', box: [130, 210], color: '#6b4a32',
    render: (c) => [
      P('case', { inset: 0, background: c, borderRadius: 3 }),
      P('in', { left: '7%', right: '7%', top: '4%', bottom: '4%', background: mix(c, '#000', 70) }),
      ...[0, 1, 2, 3].flatMap((row) => Array.from({ length: 7 }, (_, i) => P('b' + row + i, {
        left: 10 + i * 11.4 + '%', width: '9.4%', bottom: 5 + row * 23.5 + '%', height: 14 + ((i * 7 + row * 3) % 6) + '%',
        background: ['#9e5449', '#4d6730', '#14636A', '#c9a24a', '#7a5a8a', '#b07a4a', '#3f5a72'][(i + row * 2) % 7],
        transform: (i + row) % 5 === 4 ? 'rotate(8deg)' : undefined, transformOrigin: 'bottom left',
      }))),
      ...[0, 1, 2, 3].map((row) => P('s' + row, { left: '7%', right: '7%', bottom: 3 + row * 23.5 + '%', height: '2.4%', background: c })),
    ],
  },
  desk: {
    label: 'Desk', on: 'floor', box: [210, 112], color: '#8a5f3c',
    render: (c) => [
      P('top', { left: 0, right: 0, top: 0, height: '12%', background: mix(c, '#fff', 90), borderRadius: 3 }),
      P('ped', { right: '4%', width: '34%', top: '12%', bottom: 0, background: c }),
      P('d1', { right: '8%', width: '26%', top: '22%', height: '22%', border: '2px solid rgba(0,0,0,.22)', boxSizing: 'border-box', borderRadius: 2 }),
      P('d2', { right: '8%', width: '26%', top: '52%', height: '22%', border: '2px solid rgba(0,0,0,.22)', boxSizing: 'border-box', borderRadius: 2 }),
      P('leg', { left: '4%', width: '5%', top: '12%', bottom: 0, background: c }),
    ],
  },
  sideTable: {
    label: 'Side table', on: 'floor', box: [76, 74], color: '#8a5f3c',
    render: (c) => [
      P('top', { left: 0, right: 0, top: 0, height: '14%', background: mix(c, '#fff', 90), borderRadius: 6 }),
      P('body', { left: '14%', right: '14%', top: '14%', height: '46%', background: c }),
      P('knob', { left: '46%', width: '8%', top: '32%', height: '8%', borderRadius: '50%', background: '#e2c270' }),
      ...legs([14, 82], c, '42%'),
    ],
  },
  cabinet: {
    label: 'Low cabinet', on: 'floor', box: [230, 76], color: '#4f5d52',
    render: (c) => [
      P('body', { left: 0, right: 0, top: 0, bottom: '12%', background: c, borderRadius: 4 }),
      ...[0, 1, 2].map((i) => P('d' + i, { left: 3 + i * 32.5 + '%', width: '29%', top: '10%', bottom: '22%', border: '2px solid rgba(255,255,255,.12)', boxSizing: 'border-box', borderRadius: 3 })),
      ...legs([4, 92], '#2a2d33', '12%'),
    ],
  },
  tableLamp: {
    label: 'Table lamp', on: 'floor', box: [54, 86], color: '#f0dca0', glow: { x: 50, y: 22, r: 130, c: 'rgba(255,214,140,.55)' },
    render: (c) => [
      P('shade', { left: '8%', right: '8%', top: 0, height: '42%', background: c, clipPath: 'polygon(22% 0,78% 0,100% 100%,0 100%)' }),
      P('stem', { left: '46%', width: '8%', top: '42%', bottom: '8%', background: '#6b4a32' }),
      P('foot', { left: '24%', right: '24%', bottom: 0, height: '9%', borderRadius: 4, background: '#6b4a32' }),
    ],
  },
  floorLamp: {
    label: 'Floor lamp', on: 'floor', box: [70, 220], color: '#efe3c2', glow: { x: 50, y: 10, r: 190, c: 'rgba(255,214,140,.5)' },
    render: (c) => [
      P('shade', { left: '4%', right: '4%', top: 0, height: '18%', background: c, clipPath: 'polygon(20% 0,80% 0,100% 100%,0 100%)' }),
      P('pole', { left: '47%', width: '6%', top: '18%', bottom: '4%', background: '#2a2d33' }),
      P('foot', { left: '20%', right: '20%', bottom: 0, height: '4%', borderRadius: 6, background: '#2a2d33' }),
    ],
  },
  plant: {
    label: 'Plant', on: 'floor', box: [88, 140], color: '#5b7c45',
    render: (c) => [
      ...[[-30, 58, 'rm-leaf'], [-8, 70, 'rm-leaf b'], [14, 64, 'rm-leaf'], [34, 52, 'rm-leaf b'], [0, 50, 'rm-leaf']].map(([deg, h, cl], i) => P('lf' + i,
        { left: '43%', width: '14%', bottom: '32%', height: h + '%', transformOrigin: '50% 100%' }, cl,
        [P('leaf', { inset: 0, borderRadius: '50% 50% 45% 45%', background: [c, mix(c, '#000', 82), mix(c, '#fff', 88)][i % 3], transform: `rotate(${deg}deg)`, transformOrigin: '50% 100%' })])),
      P('pot', { left: '22%', right: '22%', bottom: 0, height: '34%', background: '#b8704a', clipPath: 'polygon(0 0,100% 0,84% 100%,16% 100%)' }),
      P('rim', { left: '18%', right: '18%', bottom: '30%', height: '6%', background: '#a3603e', borderRadius: 3 }),
    ],
  },
  rug: {
    label: 'Rug', on: 'floor', flat: true, box: [340, 64], color: '#b07a4a',
    render: (c) => [
      P('r', { inset: 0, borderRadius: '50%', background: `repeating-radial-gradient(ellipse at center,${c} 0 14px,${mix(c, '#000', 84)} 14px 18px,${mix(c, '#fff', 90)} 18px 30px)` }),
    ],
  },
  fireplace: {
    label: 'Fireplace', on: 'floor', box: [230, 196], color: '#b9aa94', glow: { x: 50, y: 74, r: 220, c: 'rgba(255,150,60,.5)' },
    render: (c) => [
      P('surround', { inset: 0, top: '12%', background: c, borderRadius: '4px 4px 0 0' }),
      P('mantel', { left: '-5%', right: '-5%', top: '8%', height: '8%', background: mix(c, '#000', 80), borderRadius: 3 }),
      P('hole', { left: '20%', right: '20%', top: '38%', bottom: 0, background: '#1b1410', borderRadius: '50% 50% 0 0 / 30% 30% 0 0' }),
      P('logs', { left: '28%', right: '28%', bottom: '6%', height: '8%', background: '#4a2e1a', borderRadius: 8 }),
      P('f1', { left: '33%', width: '16%', bottom: '11%', height: '32%', background: 'radial-gradient(60% 80% at 50% 100%,#ffd36e,#f08a2c 60%,transparent 72%)', borderRadius: '50% 50% 40% 40%' }, 'rm-flame'),
      P('f2', { left: '44%', width: '14%', bottom: '11%', height: '40%', background: 'radial-gradient(60% 80% at 50% 100%,#fff0b0,#f6a13a 55%,transparent 72%)', borderRadius: '50% 50% 40% 40%' }, 'rm-flame b'),
      P('f3', { left: '54%', width: '14%', bottom: '11%', height: '28%', background: 'radial-gradient(60% 80% at 50% 100%,#ffd36e,#e8702a 60%,transparent 72%)', borderRadius: '50% 50% 40% 40%' }, 'rm-flame c'),
      P('hearth', { left: '-8%', right: '-8%', bottom: 0, height: '5%', background: mix(c, '#000', 70) }),
    ],
  },
  window: {
    label: 'Window', on: 'wall', box: [210, 190], color: '#f2efe6', view: true,
    render: (c) => [
      P('frame', { inset: 0, border: `8px solid ${c}`, boxSizing: 'border-box', borderRadius: 3, zIndex: 1 }),
      P('mv', { left: '48.5%', width: '3%', top: 0, bottom: 0, background: c, zIndex: 1 }),
      P('mh', { top: '47%', height: '3%', left: 0, right: 0, background: c, zIndex: 1 }),
      P('sill', { left: '-7%', right: '-7%', bottom: '-6%', height: '7%', background: c, borderRadius: 3, zIndex: 1 }),
      P('cl', { left: '-14%', width: '22%', top: '-8%', bottom: '-10%', background: 'repeating-linear-gradient(90deg,#9e5449 0 8px,#8a463c 8px 14px)', borderRadius: '0 0 40% 20%', zIndex: 2 }, 'rm-curtain'),
      P('cr', { right: '-14%', width: '22%', top: '-8%', bottom: '-10%', background: 'repeating-linear-gradient(90deg,#9e5449 0 8px,#8a463c 8px 14px)', borderRadius: '0 0 20% 40%', zIndex: 2 }, 'rm-curtain b'),
      P('rod', { left: '-18%', right: '-18%', top: '-10%', height: '3%', background: '#3a2614', borderRadius: 3, zIndex: 3 }),
    ],
  },
  wallShelf: {
    label: 'Wall shelf', on: 'wall', box: [190, 64], color: '#8a5f3c',
    render: (c) => [
      P('board', { left: 0, right: 0, bottom: 0, height: '14%', background: c, borderRadius: 2 }),
      ...[[8, 60, '#14636A'], [16, 72, '#c9a24a'], [23, 54, '#9e5449']].map(([l, h, bg], i) => P('bk' + i, { left: l + '%', width: '6%', bottom: '14%', height: h + '%', background: bg })),
      P('pot', { left: '44%', width: '14%', bottom: '14%', height: '34%', background: '#b8704a', clipPath: 'polygon(0 0,100% 0,84% 100%,16% 100%)' }),
      P('lf', { left: '46%', width: '10%', bottom: '44%', height: '46%', borderRadius: '50%', background: '#5b7c45' }, 'rm-leaf'),
      P('mug', { left: '74%', width: '12%', bottom: '14%', height: '34%', background: '#f2efe6', borderRadius: '0 0 6px 6px' }),
      P('st1', { left: '76%', width: '8%', bottom: '50%', height: '26%', borderRadius: '50%', background: 'rgba(255,255,255,.5)', filter: 'blur(3px)' }, 'rm-steam'),
      P('st2', { left: '78%', width: '7%', bottom: '50%', height: '22%', borderRadius: '50%', background: 'rgba(255,255,255,.45)', filter: 'blur(3px)' }, 'rm-steam b'),
    ],
  },
  door: {
    label: 'Door', on: 'wall', box: [120, 240], color: '#7a5234',
    render: (c) => [
      P('frame', { inset: 0, background: mix(c, '#000', 72), borderRadius: '5px 5px 0 0' }),
      P('leaf', { left: '8%', right: '8%', top: '5%', bottom: 0, background: `linear-gradient(90deg,${mix(c, '#000', 88)},${c} 30%,${mix(c, '#fff', 92)})` }, 'rm-door-leaf'),
      ...[[14, 10, 34], [54, 10, 34], [14, 50, 42], [54, 50, 42]].map(([l, t, h], i) => P('p' + i, { left: l + '%', width: '32%', top: t + '%', height: h + '%', border: '2px solid rgba(0,0,0,.2)', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.12)', boxSizing: 'border-box', borderRadius: 2 }, 'rm-door-panel')),
      P('knob', { right: '14%', top: '50%', width: '9%', height: '4.5%', borderRadius: '50%', background: '#e2c270', boxShadow: '0 1px 2px rgba(0,0,0,.4)' }, 'rm-door-panel'),
    ],
  },
  speaker: {
    label: 'Speaker', on: 'floor', box: [54, 84], color: '#2a2d33',
    render: (c) => [
      P('body', { inset: 0, background: `linear-gradient(90deg,${c},${mix(c, '#fff', 88)})`, borderRadius: 7 }),
      P('tw', { left: '34%', width: '32%', top: '10%', height: '20%', borderRadius: '50%', background: 'radial-gradient(circle,#555b66 20%,#15171b 70%)' }),
      P('cone', { left: '14%', width: '72%', top: '40%', height: '46%', borderRadius: '50%', background: 'radial-gradient(circle,#6a707a 12%,#1b1d22 30%,#2c3038 62%,#15171b 72%)' }),
    ],
  },
};
export const FURNITURE_GROUPS = [
  ['Seating', ['sofa', 'armchair', 'bed']],
  ['Storage & tables', ['bookshelf', 'desk', 'sideTable', 'cabinet', 'wallShelf']],
  ['Light & warmth', ['window', 'tableLamp', 'floorLamp', 'fireplace']],
  ['Soft things', ['plant', 'rug']],
  ['Doors & sound', ['door', 'speaker']],
];

/* ---------- LIGHT. `auto` follows the real clock. ---------- */
export const ROOM_LIGHTS = {
  day: { label: 'Day', veil: null },
  evening: { label: 'Evening', veil: 'linear-gradient(180deg,rgba(255,150,70,.14),rgba(110,50,30,.26))' },
  night: { label: 'Night', veil: 'linear-gradient(180deg,rgba(8,14,34,.56),rgba(8,12,26,.64))' },
};
/** Design's rule: day 7–17, evening 17–20, night otherwise. A fixed mode passes through. */
export function lightFor(mode, date = new Date()) {
  if (mode !== 'auto') return ROOM_LIGHTS[mode] ? mode : 'day';
  const h = date.getHours();
  return h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'evening' : 'night';
}

/* ---------- MOUNTS. What each content kind is, and where it lives. ---------- */
export const MOUNT_KINDS = {
  frame: { label: 'Picture frame', on: 'wall' },
  sign: { label: 'Name sign', on: 'wall' },
  clock: { label: 'Clock', on: 'wall' },
  calendar: { label: 'Calendar', on: 'wall' },
  module: { label: 'Module slot', on: 'wall' },
  cat: { label: 'Nimrod', on: 'floor' },
};
export const MODULE_LABELS = { photos: 'Photos', clock: 'Clock', board: 'AAC board', call: 'Call', youtube: 'YouTube', wordforge: 'Word Forge', camera: 'Camera', pond: 'Pond' };

// ---------------------------------------------------------------------------------------------
// DOM BUILDERS
// ---------------------------------------------------------------------------------------------

// React's rule, which Design's numbers were written against: a bare number is pixels, except for
// the properties that have no unit.
const UNITLESS = new Set(['zIndex', 'opacity', 'flex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink']);
export function applyStyle(el, st = {}) {
  for (const [k, v] of Object.entries(st)) {
    if (v === undefined || v === null) continue;
    el.style[k] = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v);
  }
  return el;
}

function buildPartList(doc, parent, list) {
  for (const p of list) {
    const el = doc.createElement('span');
    el.dataset.part = p.k;
    if (p.c) el.className = p.c;
    el.style.position = 'absolute';
    applyStyle(el, p.s);
    if (p.kids) buildPartList(doc, el, p.kids);
    parent.append(el);
  }
}

/** A furniture part drawn into a new element that fills its box (the caller sizes the box). */
export function buildFurniture(doc, part, color) {
  const def = FURNITURE[part];
  const el = doc.createElement('span');
  el.className = 'rm';
  el.dataset.furniture = part;
  el.style.cssText = 'position:absolute;inset:0;display:block';
  if (def) buildPartList(doc, el, def.render(color || def.color));
  return el;
}

/* ---------- PICTURE FRAME (PictureFrame.jsx). The frame art has a transparent window, and the
   photo is seated EXACTLY in that window using these rects, so the frame never covers any of the
   picture. Crop centres on 50% 38% because faces sit above the middle. The same numbers
   `modules/button.js` measured out of the SVGs themselves; the suite cross-checks the two. ---------- */
export const FRAME_SPECS = {"classic":{"1:1":{"w":204,"h":204,"win":{"x":22,"y":22,"w":160,"h":160,"r":0}},"4:3":{"w":244,"h":194,"win":{"x":22,"y":22,"w":200,"h":150,"r":0}}},"ornate":{"1:1":{"w":216,"h":216,"win":{"x":28,"y":28,"w":160,"h":160,"r":0}},"4:3":{"w":256,"h":206,"win":{"x":28,"y":28,"w":200,"h":150,"r":0}}},"instant":{"1:1":{"w":184,"h":224,"win":{"x":12,"y":12,"w":160,"h":160,"r":0}},"4:3":{"w":224,"h":214,"win":{"x":12,"y":12,"w":200,"h":150,"r":0}}},"retroTv":{"1:1":{"w":240,"h":236,"win":{"x":14,"y":48,"w":160,"h":160,"r":19}},"4:3":{"w":280,"h":226,"win":{"x":14,"y":48,"w":200,"h":150,"r":18}}},"flatTv":{"1:1":{"w":176,"h":202,"win":{"x":8,"y":8,"w":160,"h":160,"r":0}},"4:3":{"w":216,"h":192,"win":{"x":8,"y":8,"w":200,"h":150,"r":0}}},"monitor":{"1:1":{"w":184,"h":232,"win":{"x":12,"y":12,"w":160,"h":160,"r":0}},"4:3":{"w":224,"h":222,"win":{"x":12,"y":12,"w":200,"h":150,"r":0}}},"tablet":{"1:1":{"w":188,"h":188,"win":{"x":14,"y":14,"w":160,"h":160,"r":4}},"4:3":{"w":228,"h":178,"win":{"x":14,"y":14,"w":200,"h":150,"r":4}}}};
export const frameSpec = (frame, aspect) => (FRAME_SPECS[frame] || FRAME_SPECS.classic)[aspect === '4:3' ? '4:3' : '1:1'];
/** Design's letterbox colour for a picture that does not fill its window (the photos module's). */
export const FRAME_MAT = '#0c1a14';

/** A frame at `width` px, the picture (if any) seated in its window. Returns { el, window }. */
export function buildPictureFrame(doc, { src = '', alt = '', frame = 'classic', aspect = '1:1', width = 200, focus = '50% 38%', fit = 'cover', base = '' } = {}) {
  const spec = frameSpec(frame, aspect);
  const k = width / spec.w;
  const { x, y, w, h, r } = spec.win;
  const name = FRAME_SPECS[frame] ? frame : 'classic';
  const file = `${base}${name}-${aspect === '4:3' ? '4x3' : 'square'}.svg`;
  const el = doc.createElement('span');
  el.className = 'rs-frame';
  el.style.cssText = `position:relative;display:inline-block;flex:none;width:${width}px;height:${spec.h * k}px`;
  const win = doc.createElement('span');
  win.className = 'rs-frame-window';
  applyStyle(win, { position: 'absolute', left: x * k, top: y * k, width: w * k, height: h * k, borderRadius: r * k, overflow: 'hidden', background: FRAME_MAT });
  if (src) {
    if (fit === 'contain') {
      const blur = doc.createElement('img');
      blur.src = src; blur.alt = ''; blur.setAttribute('aria-hidden', 'true');
      blur.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(14px) brightness(.55);transform:scale(1.1)';
      win.append(blur);
    }
    const img = doc.createElement('img');
    img.src = src; img.alt = alt;
    img.style.cssText = `position:relative;width:100%;height:100%;object-fit:${fit};object-position:${focus};display:block`;
    win.append(img);
  }
  const art = doc.createElement('img');
  art.src = file; art.alt = ''; art.setAttribute('aria-hidden', 'true'); art.draggable = false;
  art.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  el.append(win, art);
  return { el, window: win };
}

/* ---------- NAME SIGN (NameSign.jsx). The TEXT is the person's: any length, any font, any colour.
   So the sign is built around the text: it grows with the name, a long name steps the size down
   (never below 55%) and then wraps to two lines, and the decoration sits in the padding. The neon
   one glows and NEVER flickers: a flicker is a flash. ---------- */
export const SIGN_SIZES = { sm: 18, md: 26, lg: 36 };
export const SIGN_LOOKS = {
  wood: {
    box: { background: 'repeating-linear-gradient(176deg,rgba(0,0,0,.08) 0 2px,transparent 2px 9px),linear-gradient(180deg,#a06a3e,#7a4c2a)', border: '3px solid #5a3a20', borderRadius: 10, padding: '.5em 1.2em' },
    text: { color: '#fbf1e0', textShadow: '0 1px 0 #3a2614, 0 0 2px #3a2614' }, nails: '#3a2614', ground: ['#a06a3e', '#7a4c2a'],
  },
  chalkboard: {
    box: { background: 'radial-gradient(60% 50% at 30% 30%,rgba(255,255,255,.06),transparent),#2f3b35', border: '8px solid #9a6a3e', borderRadius: 6, padding: '.45em 1.1em', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.3)' },
    text: { color: '#f4f2ea', letterSpacing: '.02em' }, ground: ['#2f3b35'],
  },
  plate: {
    box: { background: 'linear-gradient(180deg,#ecd28a,#c49a44 55%,#e2c270)', border: '2px solid #7a5a1e', borderRadius: 6, padding: '.4em 1.6em', boxShadow: 'inset 0 0 0 5px rgba(255,255,255,.12), inset 0 0 0 6px rgba(122,90,30,.5)' },
    text: { color: '#3a2a0e', textShadow: '0 1px 0 rgba(255,244,200,.7)' }, screws: true, ground: ['#ecd28a', '#c49a44', '#e2c270'],
  },
  street: {
    box: { background: '#1f6b45', borderRadius: 12, padding: '.4em 1.1em', boxShadow: 'inset 0 0 0 5px #1f6b45, inset 0 0 0 8px #fff' },
    text: { color: '#fff' }, ground: ['#1f6b45'],
  },
  banner: {
    box: { background: '#9e5449', padding: '.45em 1.1em', margin: '0 1.4em' },
    text: { color: '#fff' }, tails: '#7e3f36', ground: ['#9e5449'],
  },
  neon: {
    box: { background: '#12181c', borderRadius: 16, padding: '.45em 1.1em', border: '2px solid #8ff0e6', boxShadow: '0 0 8px rgba(143,240,230,.55), inset 0 0 8px rgba(143,240,230,.35)' },
    text: { color: '#dffcf8', textShadow: '0 0 4px #8ff0e6, 0 0 12px rgba(143,240,230,.7)' }, ground: ['#12181c'],
  },
};

export function buildNameSign(doc, { name = '', variant = 'wood', size = 'md', color, font, minWidth = '4em', maxWidth = '14em' } = {}) {
  const v = SIGN_LOOKS[variant] || SIGN_LOOKS.wood;
  const n = String(name).trim() || ' ';
  const base = SIGN_SIZES[size] || SIGN_SIZES.md;
  const k = Math.max(0.55, Math.min(1, Math.sqrt(9 / Math.max(9, n.length))));
  const el = doc.createElement('span');
  el.className = 'rs-sign';
  el.dataset.variant = SIGN_LOOKS[variant] ? variant : 'wood';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', n);
  applyStyle(el, { position: 'relative', isolation: 'isolate', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', minWidth, maxWidth, fontSize: base, ...v.box });
  if (v.tails) {
    for (const side of ['left', 'right']) {
      const t = doc.createElement('span');
      t.setAttribute('aria-hidden', 'true');
      applyStyle(t, { position: 'absolute', top: '.35em', bottom: '-.35em', width: '1.6em', [side]: '-1.4em', zIndex: -1,
        background: v.tails, clipPath: side === 'left' ? 'polygon(0 0,100% 0,100% 100%,0 100%,40% 50%)' : 'polygon(0 0,100% 0,60% 50%,100% 100%,0 100%)' });
      el.append(t);
    }
  }
  if (v.nails || v.screws) {
    for (const [x, y] of [['left', 'top'], ['right', 'top'], ['left', 'bottom'], ['right', 'bottom']]) {
      const d = doc.createElement('span');
      d.setAttribute('aria-hidden', 'true');
      applyStyle(d, { position: 'absolute', [x]: '.45em', [y]: '.45em', width: '.32em', height: '.32em', borderRadius: '50%',
        background: v.nails || 'radial-gradient(circle at 35% 35%,#f0d890,#8a6420)', boxShadow: v.screws ? 'inset 0 0 0 1px #6a4c16' : undefined });
      el.append(d);
    }
  }
  const t = doc.createElement('span');
  t.className = 'rs-sign-text';
  t.textContent = n;
  applyStyle(t, { fontFamily: font || 'var(--font)', fontWeight: 800, fontSize: k + 'em', lineHeight: 1.1,
    textAlign: 'center', overflowWrap: 'anywhere', textWrap: 'balance',
    display: '-webkit-box', webkitLineClamp: 2, webkitBoxOrient: 'vertical', overflow: 'hidden',
    ...v.text, ...(color ? { color } : null) });
  el.append(t);
  return el;
}

/* ---------- WALL CLOCK (RoomScene.jsx). The second hand steps once a second and is hidden under
   reduced motion; the hour and minute hands are information, so they always move. ---------- */
export const CLOCK_FACE = Object.freeze({ face: '#fbf9ef', rim: '#3a2614', ink: '#1b1d22', tick: '#2a2d33', second: '#9e5449' });
export function buildWallClock(doc, { size = 92 } = {}) {
  const el = doc.createElement('span');
  el.className = 'rs-clock';
  el.setAttribute('role', 'img');
  applyStyle(el, { position: 'relative', display: 'block', width: size, height: size, borderRadius: '50%', background: CLOCK_FACE.face,
    border: `${Math.round(size / 13)}px solid ${CLOCK_FACE.rim}`, boxSizing: 'border-box', boxShadow: '0 3px 8px rgba(0,0,0,.25)' });
  for (let i = 0; i < 12; i++) {
    const m = doc.createElement('span');
    applyStyle(m, { position: 'absolute', left: '50%', top: '4%', width: i % 3 ? 2 : 4, height: i % 3 ? '7%' : '11%', marginLeft: i % 3 ? -1 : -2,
      background: CLOCK_FACE.tick, transformOrigin: `50% ${size * 0.42}px`, transform: `rotate(${i * 30}deg)` });
    el.append(m);
  }
  const hand = (len, w, c, cls) => {
    const s = doc.createElement('span');
    if (cls) s.className = cls;
    applyStyle(s, { position: 'absolute', left: '50%', bottom: '50%', width: w, height: len + '%', marginLeft: -w / 2, background: c, borderRadius: w, transformOrigin: '50% 100%' });
    el.append(s);
    return s;
  };
  const hh = hand(26, 5, CLOCK_FACE.ink, 'rs-hour');
  const mm = hand(36, 3.5, CLOCK_FACE.ink, 'rs-min');
  const ss = hand(40, 1.6, CLOCK_FACE.second, 'rs-sec');
  const pin = doc.createElement('span');
  applyStyle(pin, { position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, margin: -4, borderRadius: '50%', background: CLOCK_FACE.ink });
  el.append(pin);
  function update(d = new Date()) {
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    hh.style.transform = `rotate(${h * 30}deg)`;
    mm.style.transform = `rotate(${m * 6}deg)`;
    ss.style.transform = `rotate(${s * 6}deg)`;
    el.setAttribute('aria-label', `Clock: ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  }
  return { el, update, hands: { hour: hh, minute: mm, second: ss } };
}

/* ---------- WALL CALENDAR (RoomScene.jsx). Today's month, date and weekday, in words. ---------- */
export const CALENDAR_FACE = Object.freeze({ page: '#fbf9ef', band: '#9e5449', bandInk: '#fff', date: '#1b1d22', day: '#3c4a44' });
export function buildWallCalendar(doc, { width = 84 } = {}) {
  const el = doc.createElement('span');
  el.className = 'rs-calendar';
  el.setAttribute('role', 'img');
  applyStyle(el, { display: 'grid', width, background: CALENDAR_FACE.page, borderRadius: 6, overflow: 'hidden', boxShadow: '0 3px 8px rgba(0,0,0,.25)', textAlign: 'center', fontFamily: 'var(--font)' });
  const month = doc.createElement('span');
  applyStyle(month, { background: CALENDAR_FACE.band, color: CALENDAR_FACE.bandInk, fontWeight: 800, fontSize: width * 0.15, padding: '4px 2px', letterSpacing: '.02em' });
  const date = doc.createElement('span');
  applyStyle(date, { color: CALENDAR_FACE.date, fontWeight: 800, fontSize: width * 0.46, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', paddingTop: 2 });
  const day = doc.createElement('span');
  applyStyle(day, { color: CALENDAR_FACE.day, fontWeight: 600, fontSize: width * 0.13, paddingBottom: 6 });
  month.dataset.cal = 'month'; date.dataset.cal = 'date'; day.dataset.cal = 'day';
  el.append(month, date, day);
  function update(d = new Date()) {
    const m = d.toLocaleDateString([], { month: 'long' });
    const w = d.toLocaleDateString([], { weekday: 'long' });
    month.textContent = m; date.textContent = String(d.getDate()); day.textContent = w;
    el.setAttribute('aria-label', `Calendar: ${w}, ${m} ${d.getDate()}`);
  }
  return { el, update };
}

/* ---------- NIMROD (GuideCat.jsx). The still drawing first, always, so he is never blank; the
   animated file is fetched and inlined only when motion is allowed, because a page's CSS cannot
   reach inside an <img>. The inlined copy is sanitised the same way cat_guide.js does it. ---------- */
export const CAT_POSE_LABELS = {
  idle: 'Nimrod the cat', talking: 'Nimrod, talking', thinking: 'Nimrod, thinking', happy: 'Nimrod, happy',
  wave: 'Nimrod, waving hello', sleeping: 'Nimrod, asleep', 'point-left': 'Nimrod pointing left',
  'point-right': 'Nimrod pointing right', 'point-up': 'Nimrod pointing up', 'point-down': 'Nimrod pointing down',
};
const svgCache = new Map();
function loadSvgText(url) {
  if (!svgCache.has(url)) {
    svgCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
  }
  return svgCache.get(url);
}
function inlineSvg(doc, text) {
  if (!text || !doc?.defaultView?.DOMParser) return null;
  const parsed = new doc.defaultView.DOMParser().parseFromString(text.replace(/<metadata>[\s\S]*?<\/metadata>/, ''), 'image/svg+xml');
  const svg = parsed.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
  svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const a of [...node.attributes]) {
      const nm = a.name.toLowerCase();
      if (nm.startsWith('on')) node.removeAttribute(a.name);
      else if ((nm === 'href' || nm === 'xlink:href') && !a.value.startsWith('#')) node.removeAttribute(a.name);
    }
  }
  return doc.importNode(svg, true);
}
function linkCatMotion(doc, base) {
  if (!doc.head || doc.head.querySelector('link[data-cat-motion]')) return;
  const l = doc.createElement('link');
  l.rel = 'stylesheet'; l.href = `${base}motion.css`;
  l.setAttribute('data-cat-motion', '');
  doc.head.append(l);
}

/** Returns { el, setPose(pose), pose }. `animated()` is asked each time, so motion can change. */
export function buildCat(doc, { pose = 'sleeping', size = 110, base = '', animated = () => false } = {}) {
  const el = doc.createElement('span');
  el.className = 'nimrod-cat rs-cat';
  applyStyle(el, { width: size, height: size, display: 'block', flex: 'none' });
  let cur = null;
  let ticket = 0;
  function setPose(p) {
    const want = CAT_POSE_LABELS[p] ? p : 'idle';
    if (want === cur) return;
    cur = want;
    el.dataset.pose = want;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', CAT_POSE_LABELS[want]);
    const img = doc.createElement('img');
    img.src = `${base}${want}.svg`; img.alt = ''; img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;display:block';
    el.replaceChildren(img);
    el.dataset.motion = 'still';
    if (!animated()) return;
    linkCatMotion(doc, base);
    const mine = ++ticket;
    loadSvgText(`${base}${want}-animated.svg`).then((text) => {
      if (mine !== ticket || cur !== want || !animated()) return;
      const svg = inlineSvg(doc, text);
      if (!svg) return;
      svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
      svg.setAttribute('aria-hidden', 'true'); svg.removeAttribute('role');
      el.replaceChildren(svg);
      el.dataset.motion = 'animated';
    });
  }
  setPose(pose);
  return { el, setPose, get pose() { return cur; }, refresh() { const p = cur; cur = null; setPose(p); } };
}
