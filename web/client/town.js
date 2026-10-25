/* town.js: each theme's town, a set of places for the cards, games and stories.
 *
 * Plain JavaScript with no React, so web/client can ship it as it is.
 *
 *   EIGHT PLACES PER THEME. The four characters each have a home: the King's Great Hall, the
 *   Queen's Rose Parlour, Jack's Workshop and Robin's Caravan. Each suit has a place in town:
 *   hearts the Bakery, diamonds the Shop, clubs the Park and spades the Library.
 *
 *   EVERY INDOOR PLACE IS A ROOM RECIPE, the same format the room builder edits. So a place can be
 *   opened, rearranged and saved like anyone's room, the way houses and shops work in Animal
 *   Crossing. The card art is drawn FROM the recipe, so editing the King's hall changes the King's
 *   card.
 *
 *   EVERY WORLD BUILDS ITS OWN HOMES (HOMES): the Halloween King lives in the Haunted Hall, the
 *   steampunk King in the Engine Hall, each furnished from that world's kit (themeKits.js). The
 *   town places are dressed by the theme (walls, floor, light, view, furniture colours). The Park is
 *   a scene-builder recipe per theme (PARK_SCENES). The person's own edits are kept per theme.
 */

import { KIT } from './theme_kits.js';

/* ---------- theme dressing ---------- */
export const TOWN_DRESS = {
  medieval: {label: 'Medieval', wall: {finish: 'brick', color: '#a89c88', wainscot: '#6b4a32'}, floor: {finish: 'slate', color: '#6e6a60'}, light: 'evening', view: 'fall', palette: ['#b03a2e', '#2f5a9a', '#e8b84a', '#5d7d44', '#8a5f3c'], sky: ['#a8d4ec', '#e6f2f0'], grass: '#9cbf6a', far: '#b8cfa0', leaf: ['#7fa35a', '#5d7d44', '#8fb366'], trunk: '#6b4a32', path: '#d8c8a4', night: false},
  nimrod: { label: 'Nimrod', wall: { finish: 'sprig', color: '#e6dcc4', wainscot: '#8f9c7a' }, floor: { finish: 'boards', color: '#9a6a42' }, light: 'day', view: 'cozy', palette: ['#839958', '#105666', '#9e5449', '#6b4a32', '#e2b45a'], sky: ['#cfe6ef', '#eef3e4'], grass: '#8fae63', far: '#a9c7b0', leaf: ['#5b8a4a', '#6f9a56', '#4d7a3a'], trunk: '#6b5335', path: '#d9cdb0', night: false },
  fall: { label: 'Fall', wall: { finish: 'boards', color: '#a8794e' }, floor: { finish: 'boards', color: '#7a5234' }, light: 'evening', view: 'fall', palette: ['#c96a21', '#8a3e1a', '#d99a3f', '#6b4a32', '#4d6730'], sky: ['#f0b46a', '#f6dcb0'], grass: '#b07a3a', far: '#c98a4a', leaf: ['#c96a21', '#d99a3f', '#a8471c'], trunk: '#5a3a24', path: '#d8b88a', night: false },
  winter: { label: 'Winter', wall: { finish: 'limewash', color: '#cfd8cf' }, floor: { finish: 'carpet', color: '#8c7b68' }, light: 'day', view: 'winter', palette: ['#2f6d96', '#f4f1e8', '#9e5449', '#4f5d52', '#7f9bb0'], sky: ['#9fbcd2', '#e6eef4'], grass: '#eef3f6', far: '#c8d6e2', leaf: ['#3e5a52', '#4a6a5e', '#34504a'], trunk: '#4a3a30', path: '#cfd9e2', night: false, snow: true },
  halloween: { label: 'Halloween', wall: { finish: 'stripes', color: '#5a4a6c' }, floor: { finish: 'boards', color: '#4a3430' }, light: 'night', view: 'halloween', palette: ['#e8833a', '#6a4a8a', '#2a2d33', '#7a5a8a', '#c9a24a'], sky: ['#151028', '#3a2a4e'], grass: '#2a2240', far: '#221a36', leaf: [], trunk: '#1c1428', path: '#3a3050', night: true, bare: true },
  christmas: { label: 'Christmas', wall: { finish: 'paint', color: '#e8dcc8', wainscot: '#2f6a40' }, floor: { finish: 'boards', color: '#7a5234' }, light: 'evening', view: 'christmas', palette: ['#c9483b', '#2f6a40', '#e2b45a', '#f4f1e8', '#6b4a32'], sky: ['#1c2a52', '#8fa9bd'], grass: '#eef3f6', far: '#a8bccb', leaf: ['#2f6a40', '#28603a', '#225634'], trunk: '#4a3222', path: '#d8e2ea', night: true, snow: true, pines: true },
  steampunk: { label: 'Steampunk', wall: { finish: 'brick', color: '#7a4a34' }, floor: { finish: 'slate', color: '#4f4e4a' }, light: 'evening', view: 'steampunk', palette: ['#a8854d', '#5a3c24', '#3a2e22', '#b87333', '#4f5d52'], sky: ['#3a2c1a', '#a07a4a'], grass: '#4a3a24', far: '#5a4630', leaf: ['#5a6a3a', '#4a5a30', '#6a7a44'], trunk: '#3a2614', path: '#7a6a52', night: false, stacks: true },
  cozy: {label: 'Cozy', wall: {finish: 'sprig', color: '#efe2c8', wainscot: '#a8794e'}, floor: {finish: 'carpet', color: '#9c8a74'}, light: 'evening', view: 'cozy', palette: ['#9e5449','#8a6a9a','#c9a24a','#6b4a32','#5b7c45'], sky: ['#f2dcc0','#f4ead8'], grass: '#9cb07a', far: '#b8c4a8', leaf: ['#6f8a4a','#8a9a5a','#5a7a42'], trunk: '#6b5335', path: '#e2d4b8', night: false},
  spring: {label: 'Spring', wall: {finish: 'paint', color: '#f2ecdc', wainscot: '#a8d0a0'}, floor: {finish: 'boards', color: '#b08458'}, light: 'day', view: 'spring', palette: ['#e86a8a','#6c9e5c','#f2b13c','#5a7aa0','#b98ad8'], sky: ['#cfe6ef','#eef3e4'], grass: '#8fc47a', far: '#a9c7b0', leaf: ['#f4c6d2','#9cc485','#7fb06c'], trunk: '#6b5a48', path: '#e2d8c0', night: false},
  summer: {label: 'Summer', wall: {finish: 'limewash', color: '#f2f0e4'}, floor: {finish: 'tile', color: '#e8e2d2'}, light: 'day', view: 'summer', palette: ['#2aa8a8','#f2a03c','#f2c230','#1f4a7a','#e8833a'], sky: ['#5fb0e0','#c4e4f0'], grass: '#7fb05a', far: '#88b29a', leaf: ['#3f7a3a','#4f8f44','#64a852'], trunk: '#5e4a36', path: '#e8dcb8', night: false},
  night: {label: 'Night', wall: {finish: 'stripes', color: '#2a3456'}, floor: {finish: 'carpet', color: '#2a2f48'}, light: 'night', view: 'night', palette: ['#f2d24a','#26305a','#8a6a9a','#c9d4e8','#3a4a7a'], sky: ['#0e1430','#1c2a52'], grass: '#2a3a3a', far: '#1e2a3a', leaf: ['#1e3a32','#24423a','#183028'], trunk: '#2a2420', path: '#3a4256', night: true},
  ocean: {label: 'Ocean', wall: {finish: 'boards', color: '#e8eef0', wainscot: '#2f6d96'}, floor: {finish: 'boards', color: '#c8b08a'}, light: 'day', view: 'ocean', palette: ['#1f4a7a','#2aa8a8','#f2c230','#e8833a','#f4f6f8'], sky: ['#9fd0e8','#dff0f4'], grass: '#d8c89a', far: '#7fb6c8', leaf: ['#3f8a6a','#4f9a7a','#2f7a5a'], trunk: '#8a6a4a', path: '#efe4c4', night: false},
  cyberpunk: {label: 'Cyberpunk', wall: {finish: 'paint', color: '#1e1a3a'}, floor: {finish: 'tile', color: '#2a2448'}, light: 'night', view: 'cyberpunk', palette: ['#ff2e88','#2de2e6','#8a5af0','#14121f','#f2e27a'], sky: ['#05060f','#12081f'], grass: '#1a1a2e', far: '#1e1a3a', leaf: ['#2de2e6','#ff2e88','#8a5af0'], trunk: '#2a2448', path: '#2a2448', night: true},
  newYear: {label: "New Year's", wall: {finish: 'stripes', color: '#1a1a2a'}, floor: {finish: 'tile', color: '#d9d2b6'}, light: 'night', view: 'newYear', palette: ['#d9b34a','#16161e','#7fe0d8','#ff8ab0','#f4f4f8'], sky: ['#05060f','#1a1a3a'], grass: '#2a2a3a', far: '#1e2236', leaf: ['#2a3a3a','#24323a','#1e2a30'], trunk: '#2a2420', path: '#3a3a48', night: true},
  lunarNewYear: {label: 'Lunar New Year', wall: {finish: 'paint', color: '#7a1e1e', wainscot: '#2a1218'}, floor: {finish: 'boards', color: '#4a2418'}, light: 'evening', view: 'lunarNewYear', palette: ['#c9302b','#f2c46a','#f2a8c0','#1a0e14','#e8502b'], sky: ['#2a1222','#3a1a24'], grass: '#3a2a24', far: '#4a2a34', leaf: ['#f2a8c0','#fbe2e8','#c97a8a'], trunk: '#3a1e18', path: '#5a3a2a', night: true},
  valentines: {label: "Valentine's Day", wall: {finish: 'sprig', color: '#f8e4ea', wainscot: '#c9849a'}, floor: {finish: 'carpet', color: '#b06e86'}, light: 'evening', view: 'valentines', palette: ['#e0587a','#b0303e','#fbe2e8','#9c3357','#f2c6d2'], sky: ['#f8dde2','#f2c4cf'], grass: '#c9849a', far: '#d896aa', leaf: ['#f4c6d2','#eeb3c4','#fbe2e8'], trunk: '#8a5a6a', path: '#f2dce2', night: false},
  stPatricks: {label: "St Patrick's Day", wall: {finish: 'paint', color: '#e8f0e2', wainscot: '#2c6e49'}, floor: {finish: 'boards', color: '#7a5234'}, light: 'day', view: 'stPatricks', palette: ['#2c6e49','#f2c230','#3c8f46','#f4f1e8','#6aa85a'], sky: ['#a8d4ec','#d2e8f0'], grass: '#4f9046', far: '#6aa85a', leaf: ['#3f8a3a','#4f9a44','#2f7030'], trunk: '#5a4030', path: '#d8d0b0', night: false},
  easter: {label: 'Easter', wall: {finish: 'stripes', color: '#f2eef8'}, floor: {finish: 'carpet', color: '#c8e6b8'}, light: 'day', view: 'easter', palette: ['#c8b8f0','#f6c8d8','#f2e08a','#b8d8f0','#c8e6b8'], sky: ['#d8eaf4','#eef2e8'], grass: '#9cc485', far: '#a9c7b0', leaf: ['#f4c6d2','#d9e6c4','#7fb06c'], trunk: '#7a6a58', path: '#f2ead0', night: false},
  july4: {label: 'Fourth of July', wall: {finish: 'boards', color: '#e8e2d6', wainscot: '#2a3a6a'}, floor: {finish: 'boards', color: '#9a6a42'}, light: 'evening', view: 'july4', palette: ['#b0303e','#2a3a6a','#f4f1e8','#f2c230','#5a7aa0'], sky: ['#1e2450','#c86a4a'], grass: '#3a5a3a', far: '#3a2a50', leaf: ['#2f5a3a','#3a6a44','#24482e'], trunk: '#4a3a2a', path: '#c8b898', night: true},
  diwali: {label: 'Diwali', wall: {finish: 'paint', color: '#4a2a50', wainscot: '#b0521e'}, floor: {finish: 'tile', color: '#e8c8a0'}, light: 'night', view: 'diwali', palette: ['#e8833a','#b02a7a','#ffc457','#5ab0c8','#e8502b'], sky: ['#24123a','#3a1a3a'], grass: '#3a2430', far: '#3a2240', leaf: ['#5a8a4a','#6a9a5a','#4a7a3a'], trunk: '#4a2e1a', path: '#5a3a4a', night: true},
  harvest: {label: 'Harvest', wall: {finish: 'boards', color: '#b8864e'}, floor: {finish: 'boards', color: '#7a5234'}, light: 'evening', view: 'harvest', palette: ['#c96a21','#d0a030','#8a3e1a','#6b4a32','#a83a26'], sky: ['#f0b46a','#e8a868'], grass: '#c8964a', far: '#d89a5a', leaf: ['#c46a2a','#a8481c','#d99a3f'], trunk: '#5e4430', path: '#e2c48a', night: false},
  hanukkah: {label: 'Hanukkah', wall: {finish: 'limewash', color: '#dfe6f0', wainscot: '#2a5aa8'}, floor: {finish: 'boards', color: '#8a6a4a'}, light: 'night', view: 'hanukkah', palette: ['#2a5aa8','#c9cfd8','#ffd36e','#1e3a6a','#f4f6f8'], sky: ['#1b2440','#232e50'], grass: '#c8d4e0', far: '#8a9ab8', leaf: ['#2f5a4a','#3a6a54','#24483a'], trunk: '#4a3a2a', path: '#e6eef4', night: true},
};
const dressFor = (theme) => TOWN_DRESS[theme] || TOWN_DRESS.nimrod;

/* ---------- the places ---------- */
const F = (part, x, y, c, more) => ({ kind: 'furniture', part, x, y, ...(c != null ? { c } : null), ...more });
export const PLACES = {
  kingHall: {
    label: 'The Great Hall', who: 'king', card: 'K', blurb: "King Kenny's home. A fire, a big chair and the family portraits.",
    recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('fireplace', 50, 70), F('armchair', 27, 93, 2), F('bookshelf', 80, 73), F('floorLamp', 90, 94),
      { kind: 'frame', x: 30, y: 30, frame: 'ornate', width: 96 }, { kind: 'frame', x: 70, y: 30, frame: 'classic', width: 84 }, { kind: 'sign', x: 50, y: 8, name: 'King Kenny', variant: 'wood', size: 'sm' }] },
  },
  queenParlour: {
    label: 'The Rose Parlour', who: 'queen', card: 'Q', blurb: "Queen Rose's sitting room, with the window and her plants.",
    recipe: { shell: 'corner', items: [F('window', 66, 30), F('rug', 56, 96, 2), F('sofa', 54, 88, 1), F('sideTable', 28, 90), F('tableLamp', 28, 77.5, null, { ground: 90 }), F('plant', 90, 96, 0),
      { kind: 'frame', x: 40, y: 28, frame: 'classic', width: 80 }, { kind: 'clock', x: 86, y: 20, size: 60 }, { kind: 'sign', x: 42, y: 8, name: 'Queen Rose', variant: 'banner', size: 'sm' }] },
  },
  jackWorkshop: {
    label: 'The Workshop', who: 'jack', card: 'J', blurb: "Jack's workshop. Tools on the shelf and a desk by the lamp.",
    recipe: { shell: 'flat', items: [F('bookshelf', 13, 84), F('desk', 47, 89, 3), F('floorLamp', 71, 91), F('cabinet', 88, 93, 4), F('wallShelf', 47, 36),
      { kind: 'clock', x: 74, y: 24, size: 64 }, { kind: 'frame', x: 28, y: 30, frame: 'monitor', aspect: '4:3', width: 90 }, { kind: 'sign', x: 47, y: 8, name: 'Jack', variant: 'plate', size: 'sm' }] },
  },
  jokerCaravan: {
    label: "Robin's Caravan", who: 'joker', card: 'joker', blurb: 'A cosy caravan under a sloped roof, full of cushions and odd things.',
    recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('armchair', 34, 93, 1), F('plant', 74, 95, 4), F('floorLamp', 86, 90),
      { kind: 'frame', x: 38, y: 34, frame: 'instant', width: 64 }, { kind: 'sign', x: 26, y: 30, name: 'Robin', variant: 'chalkboard', size: 'sm' }] },
  },
  bakery: {
    label: 'The Bakery', suit: 'hearts', blurb: 'Warm bread, a counter and a window onto the street.',
    recipe: { shell: 'flat', items: [F('window', 50, 30, null, { scale: 0.8 }), F('wallShelf', 20, 34), F('wallShelf', 80, 34), F('cabinet', 50, 90, 2), F('sideTable', 16, 93), F('plant', 86, 95, 0),
      { kind: 'sign', x: 50, y: 7, name: 'Bakery', variant: 'banner', size: 'sm' }] },
  },
  shop: {
    label: 'The Shop', suit: 'diamonds', blurb: 'Shelves of everything, and a counter to pay at.',
    recipe: { shell: 'room', items: [F('bookshelf', 30, 75), F('bookshelf', 70, 75), F('rug', 50, 96, 1), F('cabinet', 50, 91, 0), F('plant', 89, 97, 4),
      { kind: 'clock', x: 50, y: 26, size: 60 }, { kind: 'sign', x: 50, y: 8, name: 'Shop', variant: 'plate', size: 'sm' }] },
  },
  park: {
    label: 'The Park', suit: 'clubs', outdoor: true, blurb: 'Trees, a bench and a path, dressed for the season.',
  },
  library: {
    label: 'The Library', suit: 'spades', blurb: 'Tall shelves, a reading chair and a lamp on the desk.',
    recipe: { shell: 'room', items: [F('bookshelf', 22, 77), F('bookshelf', 50, 71), F('bookshelf', 78, 77), F('desk', 50, 93, 3), F('tableLamp', 42, 81, null, { ground: 93 }), F('armchair', 86, 97, 1),
      { kind: 'clock', x: 22, y: 24, size: 56 }, { kind: 'sign', x: 50, y: 7, name: 'Library', variant: 'plate', size: 'sm' }] },
  },
};

/* ---------- the characters' homes: a different place in every world ----------
   Each theme builds its own home for each of the four characters, from that world's kit. The Nimrod
   versions are PLACES above. `dress` overrides the theme's walls, floor, light or view for that one
   place. Every home is still a plain room recipe, so the room builder edits it. */
const SG = (name, variant, y = 7) => ({ kind: 'sign', x: 50, y, name, variant, size: 'sm' });
const FR = (x, y, frame = 'classic', width = 80) => ({ kind: 'frame', x, y, frame, width });
export const HOMES = {
  medieval: {
    kingHall: { label: 'The Great Hall', blurb: 'King Kenny\'s hall, with the long feast table and the banners of every knight.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('wallBanner', 30, 30, 0), F('wallBanner', 70, 30, 1), F('throne', 50, 84, 0), F('candelabra', 26, 90), F('candelabra', 74, 90), F('fireplace', 86, 72), SG('King Kenny', 'wood', 8)] } },
    queenParlour: { label: 'The Solar', blurb: 'Queen Rose\'s sunny room above the hall, where she teaches Jess and Vince their letters.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('armchair', 30, 92, 0), F('desk', 62, 90), F('candelabra', 52, 77, null, { ground: 90 }), F('chest', 86, 94), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Smithy', blurb: 'Jack\'s corner of the blacksmith\'s forge, all anvils and horseshoes.', recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('woodStove', 16, 86), F('chest', 82, 94), F('wallShelf', 50, 30), SG('Jack', 'chalkboard')] } },
    jokerCaravan: { label: 'The Jester\'s Wagon', blurb: 'Robin\'s painted wagon, with a box of juggling balls and a lute.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('chest', 30, 96), F('armchair', 66, 94, 1), SG('Robin', 'banner', 30)] } },
  },
  nimrod: {
    kingHall: { label: 'The Garden Hall', blurb: 'King Kenny sits among his plants, under the green banners.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('wallBanner', 33, 30, 0), F('wallBanner', 67, 30, 0), F('hangingPlant', 22, 20), F('hangingPlant', 78, 20), F('throne', 50, 84, 0), F('candelabra', 34, 90), F('candelabra', 66, 90), F('plant', 20, 96, 0), F('plant', 82, 96, 0), SG('King Kenny', 'wood')] } },
    jackWorkshop: { label: 'The Potting Shed', blurb: "Jack's shed: seedlings, a watering can and the bench where things grow.", dress: { wall: { finish: 'boards', color: '#a8794e' } }, recipe: { shell: 'flat', items: [F('window', 50, 30, null, { scale: 0.8 }), F('hangingPlant', 20, 24), F('hangingPlant', 80, 24), F('pottingBench', 48, 90), F('wateringCan', 80, 95), F('plant', 14, 94, 0), F('plant', 90, 96, 0), SG('Jack', 'plate')] } },
  },
  fall: {
    kingHall: { label: 'The Harvest Hall', blurb: 'A long hall full of the harvest, with the fire lit.', recipe: { shell: 'room', items: [F('rug', 50, 96, 0), F('fireplace', 50, 70), F('leafWreath', 50, 20), F('wallBanner', 26, 30, 1), F('wallBanner', 74, 30, 1), F('throne', 26, 93, 1), F('hayBale', 80, 94), F('pumpkinPile', 66, 98), SG('King Kenny', 'wood', 6)] } },
    queenParlour: { label: 'The Orchard Kitchen', blurb: "Queen Rose's kitchen, with apples from the orchard outside.", dress: { wall: { finish: 'paint', color: '#e8d6b0', wainscot: '#8a5f3c' } }, recipe: { shell: 'flat', items: [F('window', 50, 30), F('leafWreath', 20, 28), FR(80, 28), F('cabinet', 50, 91, 1), F('appleBasket', 44, 78, null, { ground: 91 }), F('appleBasket', 58, 78, null, { ground: 91 }), F('pumpkinPile', 16, 96), F('plant', 88, 96, 2), SG('Queen Rose', 'banner')] } },
    jackWorkshop: { label: 'The Barn Loft', blurb: 'Up in the barn, between the hay bales, with the scarecrow keeping watch.', dress: { wall: { finish: 'boards', color: '#a8794e' } }, recipe: { shell: 'attic', items: [F('window', 50, 32, null, { scale: 0.7 }), F('hayBale', 24, 92), F('hayBale', 76, 94), F('scarecrow', 52, 90), F('appleBasket', 38, 97), SG('Jack', 'chalkboard', 44)] } },
    jokerCaravan: { label: 'The Pumpkin Wagon', blurb: "Robin's wagon, parked in the pumpkin patch.", recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('leafWreath', 36, 40, null, { scale: 0.7 }), F('armchair', 66, 94, 0), F('pumpkinPile', 30, 96), F('appleBasket', 84, 97), SG('Robin', 'chalkboard', 30)] } },
  },
  winter: {
    kingHall: { label: 'The Ice Hall', blurb: 'A pale blue hall, warm by the stove.', dress: { wall: { finish: 'limewash', color: '#cfe0e8' }, floor: { finish: 'slate', color: '#8a98a6' } }, recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('wallBanner', 33, 30, 0), F('wallBanner', 67, 30, 0), F('throne', 50, 84, 0), F('woodStove', 20, 92), F('candelabra', 80, 92), SG('King Kenny', 'plate')] } },
    queenParlour: { label: 'The Ski Lodge', blurb: "Queen Rose's lodge, with the skis on the wall and the stove going.", dress: { wall: { finish: 'boards', color: '#a8794e' } }, recipe: { shell: 'corner', items: [F('window', 68, 30), F('skiRack', 40, 30), F('rug', 56, 96, 2), F('sofa', 54, 90, 2), F('woodStove', 90, 93), SG('Queen Rose', 'wood', 8)] } },
    jackWorkshop: { label: 'The Sled Shed', blurb: 'Where Jack mends the sleds.', dress: { wall: { finish: 'boards', color: '#7a5234' } }, recipe: { shell: 'flat', items: [F('skiRack', 70, 30), F('window', 30, 30, null, { scale: 0.7 }), F('workbench', 62, 90), F('sled', 26, 95), F('floorLamp', 92, 93), SG('Jack', 'plate')] } },
    jokerCaravan: { label: 'The Snow Cabin', blurb: 'A tiny cabin under the snow, with a stove and a sled by the door.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('woodStove', 28, 91), F('armchair', 62, 94, 2), F('sled', 84, 98), SG('Robin', 'chalkboard', 30)] } },
  },
  halloween: {
    kingHall: { label: 'The Haunted Hall', blurb: 'A friendly haunted hall: candles, portraits and a few cobwebs.', recipe: { shell: 'room', items: [F('rug', 50, 95, 1), F('cobweb', 22, 12), F('cobweb', 78, 12, null, { flip: true }), FR(32, 32, 'ornate', 86), FR(68, 32, 'ornate', 86), F('throne', 50, 84, 1), F('candelabra', 32, 90), F('candelabra', 68, 90), F('jackLantern', 20, 97), F('jackLantern', 80, 97), SG('King Kenny', 'wood', 7)] } },
    queenParlour: { label: 'The Potion Parlour', blurb: 'Queen Rose stirs something nice in the cauldron.', recipe: { shell: 'corner', items: [F('window', 74, 30), F('potionShelf', 44, 30), F('cobweb', 92, 12, null, { flip: true }), F('armchair', 26, 93, 1), F('cauldron', 52, 93), F('jackLantern', 82, 97), SG('Queen Rose', 'banner', 8)] } },
    jackWorkshop: { label: 'The Lantern Workshop', blurb: 'Jack carves the lanterns for the whole town.', recipe: { shell: 'flat', items: [F('potionShelf', 78, 30), F('cobweb', 8, 12), F('desk', 50, 90, 3), F('jackLantern', 42, 78, null, { ground: 90 }), F('jackLantern', 58, 78, null, { ground: 90 }), F('pumpkinPile', 16, 96), F('floorLamp', 88, 93), SG('Jack', 'plate')] } },
    jokerCaravan: { label: 'The Fun-House Caravan', blurb: "Robin's caravan, full of pumpkins and something bubbling.", recipe: { shell: 'attic', items: [F('rug', 50, 96, 1), F('window', 60, 36, null, { scale: 0.7 }), F('cobweb', 24, 42, null, { scale: 0.8 }), F('pumpkinPile', 28, 96), F('cauldron', 70, 95), F('jackLantern', 48, 98), SG('Robin', 'chalkboard', 30)] } },
  },
  christmas: {
    kingHall: { label: 'The Feast Hall', blurb: 'The tree is up and the fire is lit for the feast.', recipe: { shell: 'room', items: [F('rug', 50, 96, 0), F('fireplace', 50, 70), F('wreath', 50, 20), F('throne', 24, 93, 0), F('xmasTree', 80, 91), F('presents', 68, 98), SG('King Kenny', 'wood', 6)] } },
    queenParlour: { label: 'The Wreath Parlour', blurb: "Queen Rose's parlour, with presents under the tree.", recipe: { shell: 'corner', items: [F('window', 68, 30), F('wreath', 42, 28), F('rug', 56, 96, 1), F('sofa', 54, 90, 0), F('xmasTree', 90, 93), F('presents', 30, 97), SG('Queen Rose', 'banner', 8)] } },
    jackWorkshop: { label: 'The Toy Workshop', blurb: 'Jack wraps the presents for the whole town.', recipe: { shell: 'flat', items: [F('wallShelf', 50, 32), F('wreath', 84, 30), F('stocking', 18, 34), F('workbench', 50, 90), F('presents', 18, 96), F('presents', 84, 97), SG('Jack', 'plate')] } },
    jokerCaravan: { label: 'The Gingerbread Caravan', blurb: "Robin's caravan, decorated top to bottom.", recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('stocking', 44, 44), F('xmasTree', 30, 93, null, { scale: 0.8 }), F('armchair', 68, 94, 0), F('presents', 48, 98), SG('Robin', 'chalkboard', 30)] } },
  },
  steampunk: {
    kingHall: { label: 'The Engine Hall', blurb: 'King Kenny rules from among the boilers and the great gears.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('gearWall', 50, 24), F('boiler', 22, 91), F('boiler', 78, 91, null, { flip: true }), F('throne', 50, 85, 0), SG('King Kenny', 'plate', 6)] } },
    queenParlour: { label: 'The Observatory', blurb: 'Queen Rose watches the airships from her telescope.', recipe: { shell: 'corner', items: [F('window', 68, 30), F('gearWall', 40, 28), F('telescope', 66, 93), F('armchair', 32, 93, 1), F('bookshelf', 92, 82), SG('Queen Rose', 'plate', 8)] } },
    jackWorkshop: { label: 'The Clockworks', blurb: 'Jack keeps the town clocks running.', recipe: { shell: 'flat', items: [F('gearWall', 26, 28), F('gearWall', 74, 30, null, { flip: true }), { kind: 'clock', x: 50, y: 24, size: 70 }, F('workbench', 46, 90), F('boiler', 88, 91), SG('Jack', 'plate')] } },
    jokerCaravan: { label: 'The Airship Cabin', blurb: "Robin's cabin, high up in an airship.", recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 56, 36, null, { scale: 0.7 }), F('gearWall', 30, 44, null, { scale: 0.7 }), F('chest', 30, 97), F('telescope', 72, 95), SG('Robin', 'chalkboard', 30)] } },
  },
  cozy: {
    kingHall: { label: 'The Fireside Hall', blurb: 'King Kenny reads by the big fire, under a blanket.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('fireplace', 50, 70), F('armchair', 26, 92, 0), F('floorLamp', 80, 90), F('bookshelf', 86, 76), FR(30, 30, 'classic', 80), F('candelabra', 40, 62), F('teaTray', 40, 94), SG('King Kenny', 'wood')] } },
    queenParlour: { label: 'The Window Seat', blurb: 'Queen Rose\'s corner, with a stack of books and a pot of tea.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('sofa', 62, 90, 0), F('sideTable', 30, 90), F('tableLamp', 30, 77, null, { ground: 90 }), F('plant', 90, 96, 0), F('bookshelf', 14, 76), F('quiltStack', 88, 94), SG('Queen Rose', 'plate')] } },
    jackWorkshop: { label: 'The Book Nook', blurb: 'Jack\'s little room, all shelves and cushions.', recipe: { shell: 'attic', items: [F('bookshelf', 24, 80), F('bookshelf', 76, 80), F('armchair', 50, 92, 1), F('floorLamp', 64, 88), F('rug', 50, 96, 0), F('teaTray', 30, 77, null, { ground: 90 }), SG('Jack', 'chalkboard', 30)] } },
    jokerCaravan: { label: 'The Quilt Caravan', blurb: 'Robin\'s caravan, every seat covered in a different quilt.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('bed', 50, 92, 2), F('tableLamp', 20, 92), F('plant', 84, 96, 0), F('quiltStack', 80, 96), SG('Robin', 'banner', 30)] } },
  },
  spring: {
    kingHall: { label: 'The Blossom Hall', blurb: 'King Kenny holds court under the cherry blossom.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('throne', 50, 84, 0), F('hangingPlant', 22, 20), F('hangingPlant', 78, 20), F('plant', 18, 96, 0), F('plant', 84, 96, 0), F('window', 50, 30, null, { scale: 0.8 }), F('tulipPot', 34, 94), SG('King Kenny', 'wood')] } },
    queenParlour: { label: 'The Conservatory', blurb: 'Queen Rose\'s glass room, full of seedlings.', recipe: { shell: 'corner', items: [F('window', 50, 28), F('window', 82, 28), F('pottingBench', 56, 90), F('wateringCan', 80, 95), F('plant', 30, 94, 0), F('hangingPlant', 34, 18), F('birdhouse', 80, 32), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Seed Shed', blurb: 'Jack\'s shed: trays of seeds and a new watering can.', dress: { wall: { finish: 'boards', color: '#b8946a' } }, recipe: { shell: 'flat', items: [F('pottingBench', 48, 90), F('wateringCan', 78, 95), F('plant', 14, 94, 0), F('plant', 90, 96, 0), F('wallShelf', 50, 30), F('tulipPot', 30, 96), SG('Jack', 'chalkboard')] } },
    jokerCaravan: { label: 'The Flower Cart', blurb: 'Robin\'s caravan, with flowers in every window box.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('plant', 30, 94, 0), F('plant', 70, 94, 0), F('hangingPlant', 50, 30), F('armchair', 50, 94, 1), F('birdhouse', 30, 40), SG('Robin', 'banner', 30)] } },
  },
  summer: {
    kingHall: { label: 'The Lake House', blurb: 'King Kenny watches the boats from his big chair.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('window', 36, 30), F('window', 64, 30), F('armchair', 50, 90, 0), F('plant', 18, 96, 0), F('plant', 84, 96, 0), F('sideTable', 70, 92), F('sandcastle', 30, 96), SG('King Kenny', 'wood', 6)] } },
    queenParlour: { label: 'The Sun Porch', blurb: 'Queen Rose\'s porch, with the doors open to the garden.', recipe: { shell: 'corner', items: [F('window', 60, 30), F('sofa', 60, 90, 0), F('plant', 30, 94, 0), F('hangingPlant', 84, 20), F('sideTable', 86, 92), F('beachUmbrella', 30, 92), SG('Queen Rose', 'plate')] } },
    jackWorkshop: { label: 'The Boathouse', blurb: 'Jack mends oars and paddles here.', dress: { wall: { finish: 'boards', color: '#c8b08a' } }, recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('window', 50, 30, null, { scale: 0.8 }), F('wallShelf', 18, 30), F('chest', 82, 94), F('anchor', 22, 94), SG('Jack', 'street')] } },
    jokerCaravan: { label: 'The Beach Hut', blurb: 'Robin\'s striped hut, right on the sand.', dress: { wall: { finish: 'stripes', color: '#bfe0ee' } }, recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('armchair', 40, 94, 0), F('plant', 80, 96, 0), F('chest', 22, 96), F('beachUmbrella', 74, 94), SG('Robin', 'banner', 30)] } },
  },
  night: {
    kingHall: { label: 'The Moon Hall', blurb: 'King Kenny stays up under the moonlit windows.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('window', 34, 30), F('window', 66, 30), F('throne', 50, 84, 0), F('candelabra', 30, 90), F('candelabra', 70, 90), F('starChart', 50, 26), SG('King Kenny', 'neon', 6)] } },
    queenParlour: { label: 'The Star Tower', blurb: 'Queen Rose watches the stars from her telescope.', recipe: { shell: 'corner', items: [F('window', 68, 30), F('telescope', 56, 92), F('armchair', 30, 92, 0), F('floorLamp', 86, 90), F('moonLamp', 50, 96), SG('Queen Rose', 'neon', 52)] } },
    jackWorkshop: { label: 'The Night Workshop', blurb: 'Jack works late by lamplight.', recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('tableLamp', 48, 77, null, { ground: 90 }), F('wallShelf', 20, 30), F('window', 76, 30, null, { scale: 0.7 }), F('starChart', 24, 30), SG('Jack', 'neon')] } },
    jokerCaravan: { label: 'The Lantern Caravan', blurb: 'Robin\'s caravan, lit up in the dark field.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('bed', 50, 92, 2), F('tableLamp', 20, 92), F('tableLamp', 82, 92), F('moonLamp', 70, 94), SG('Robin', 'neon', 30)] } },
  },
  ocean: {
    kingHall: { label: 'The Lighthouse', blurb: 'King Kenny keeps the light at the top of the tower.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('window', 50, 30), F('throne', 50, 86, 0), F('chest', 22, 94), F('floorLamp', 80, 90), F('shipWheel', 74, 30), SG('King Kenny', 'wood', 6)] } },
    queenParlour: { label: 'The Shell Parlour', blurb: 'Queen Rose\'s room, with shells on every shelf.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('sofa', 60, 90, 0), F('wallShelf', 34, 30), F('plant', 90, 96, 0), F('sideTable', 26, 92), F('lifebuoy', 18, 30), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Boat Yard', blurb: 'Jack builds little boats here.', dress: { wall: { finish: 'boards', color: '#9fbcd0' } }, recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('chest', 80, 94), F('wallShelf', 20, 30), F('window', 74, 30, null, { scale: 0.7 }), F('anchor', 26, 94), SG('Jack', 'street')] } },
    jokerCaravan: { label: 'The Houseboat', blurb: 'Robin\'s floating caravan, rocking gently.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('bed', 50, 92, 2), F('chest', 20, 96), F('lifebuoy', 80, 36), SG('Robin', 'banner', 30)] } },
  },
  cyberpunk: {
    kingHall: { label: 'The Neon Hall', blurb: 'King Kenny on a glowing throne above the city.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('window', 34, 30), F('window', 66, 30), F('throne', 50, 84, 0), F('floorLamp', 20, 90), F('floorLamp', 80, 90), F('neonSign', 50, 22), SG('King Kenny', 'neon', 6)] } },
    queenParlour: { label: 'The Sky Loft', blurb: 'Queen Rose\'s loft, high over the rooftops.', recipe: { shell: 'corner', items: [F('window', 60, 30), F('window', 88, 30), F('sofa', 60, 90, 0), F('floorLamp', 28, 90), F('arcadeCabinet', 86, 88), SG('Queen Rose', 'neon', 52)] } },
    jackWorkshop: { label: 'The Repair Shop', blurb: 'Jack fixes robots and radios.', dress: { wall: { finish: 'brick', color: '#3a2a4a' } }, recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('gearWall', 50, 26), F('wallShelf', 18, 30), F('cabinet', 82, 92), F('neonSign', 50, 26), SG('Jack', 'neon', 50)] } },
    jokerCaravan: { label: 'The Arcade Van', blurb: 'Robin\'s van, every wall a glowing game.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('armchair', 50, 94, 1), F('floorLamp', 22, 90), F('arcadeCabinet', 80, 92), SG('Robin', 'neon', 30)] } },
  },
  newYear: {
    kingHall: { label: 'The Ballroom', blurb: 'King Kenny counts down to midnight in the ballroom.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('window', 34, 30), F('window', 66, 30), F('throne', 50, 84, 0), F('candelabra', 26, 90), F('candelabra', 74, 90), { kind: 'clock', x: 50, y: 14, size: 60 }, F('balloonBunch', 14, 92), SG('King Kenny', 'plate', 30)] } },
    queenParlour: { label: 'The Rooftop Terrace', blurb: 'Queen Rose\'s view of the fireworks.', recipe: { shell: 'corner', items: [F('window', 64, 30), F('sofa', 60, 90, 0), F('floorLamp', 28, 90), F('plant', 90, 96, 0), F('balloonBunch', 86, 94), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Fireworks Shed', blurb: 'Jack packs the fireworks (safely).', recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('chest', 80, 94), F('chest', 20, 94), F('wallShelf', 50, 30), F('balloonBunch', 30, 94), SG('Jack', 'chalkboard')] } },
    jokerCaravan: { label: 'The Party Bus', blurb: 'Robin\'s caravan, with streamers everywhere.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('armchair', 50, 94, 1), F('floorLamp', 22, 90), F('countdownClock', 30, 34), SG('Robin', 'banner', 30)] } },
  },
  lunarNewYear: {
    kingHall: { label: 'The Lantern Hall', blurb: 'King Kenny under a ceiling of red lanterns.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('wallBanner', 33, 30, 0), F('wallBanner', 67, 30, 0), F('throne', 50, 84, 0), F('candelabra', 32, 90), F('candelabra', 68, 90), F('redLantern', 20, 24), SG('King Kenny', 'banner')] } },
    queenParlour: { label: 'The Tea House', blurb: 'Queen Rose pours tea for visitors.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('sideTable', 50, 92), F('armchair', 30, 92, 0), F('plant', 88, 96, 0), F('cabinet', 70, 92), F('teaSet', 50, 80, null, { ground: 92 }), SG('Queen Rose', 'banner', 52)] } },
    jackWorkshop: { label: 'The Paper Workshop', blurb: 'Jack folds lanterns and paper dragons.', recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('wallShelf', 20, 30), F('wallShelf', 80, 30), F('chest', 82, 94), F('redLantern', 50, 26), SG('Jack', 'banner')] } },
    jokerCaravan: { label: 'The Dragon Cart', blurb: 'Robin\'s caravan, painted like a dragon.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('armchair', 50, 94, 1), F('chest', 20, 96), F('redLantern', 80, 36), SG('Robin', 'banner', 30)] } },
  },
  valentines: {
    kingHall: { label: 'The Rose Hall', blurb: 'King Kenny among the roses he grows for the Queen.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('throne', 50, 84, 0), F('plant', 20, 96, 0), F('plant', 82, 96, 0), F('candelabra', 34, 90), F('candelabra', 66, 90), FR(50, 30, 'ornate', 90), F('roseVase', 76, 96), SG('King Kenny', 'wood', 8)] } },
    queenParlour: { label: 'The Love Letter Room', blurb: 'Queen Rose writes cards at her desk.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('desk', 56, 90), F('tableLamp', 46, 77, null, { ground: 90 }), F('plant', 88, 96, 0), F('roseVase', 26, 96), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Card Shop', blurb: 'Jack prints the valentines.', recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('wallShelf', 20, 30), F('wallShelf', 80, 30), F('cabinet', 82, 92), F('heartGarland', 50, 22), SG('Jack', 'plate')] } },
    jokerCaravan: { label: 'The Sweetheart Caravan', blurb: 'Robin\'s caravan, with hearts painted on the door.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('sofa', 50, 92, 2), F('heartGarland', 50, 30), SG('Robin', 'banner', 30)] } },
  },
  stPatricks: {
    kingHall: { label: 'The Green Hall', blurb: 'King Kenny under green banners, a pot of gold by the throne.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('wallBanner', 33, 30, 0), F('wallBanner', 67, 30, 0), F('throne', 50, 84, 0), F('chest', 70, 94), F('plant', 20, 96, 0), F('potOfGold', 30, 96), SG('King Kenny', 'wood')] } },
    queenParlour: { label: 'The Cottage Kitchen', blurb: 'Queen Rose bakes soda bread by the fire.', recipe: { shell: 'corner', items: [F('fireplace', 50, 70), F('sideTable', 30, 92), F('plant', 88, 96, 0), F('window', 80, 30, null, { scale: 0.7 }), F('cloverPlanter', 70, 96), SG('Queen Rose', 'chalkboard', 52)] } },
    jackWorkshop: { label: 'The Clover Shed', blurb: 'Jack looks for the four-leaf clover.', dress: { wall: { finish: 'boards', color: '#9cb07a' } }, recipe: { shell: 'flat', items: [F('pottingBench', 48, 90), F('wateringCan', 78, 95), F('plant', 14, 94, 0), F('plant', 88, 96, 0), F('cloverPlanter', 50, 96), SG('Jack', 'chalkboard')] } },
    jokerCaravan: { label: 'The Rainbow Wagon', blurb: 'Robin\'s caravan, parked at the end of the rainbow.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('chest', 30, 96), F('armchair', 66, 94, 0), F('potOfGold', 50, 97), SG('Robin', 'banner', 30)] } },
  },
  easter: {
    kingHall: { label: 'The Egg Hall', blurb: 'King Kenny with the biggest painted egg in the land.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('throne', 50, 84, 0), F('plant', 20, 96, 0), F('plant', 82, 96, 0), F('hangingPlant', 22, 20), F('hangingPlant', 78, 20), F('eggBasket', 30, 96), SG('King Kenny', 'wood')] } },
    queenParlour: { label: 'The Garden Room', blurb: 'Queen Rose paints eggs at the window.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('desk', 56, 90), F('plant', 88, 96, 0), F('hangingPlant', 34, 20), F('eggBasket', 30, 97), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Bunny Hutch Workshop', blurb: 'Jack builds homes for the rabbits.', dress: { wall: { finish: 'boards', color: '#c8b896' } }, recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('hayBale', 18, 94), F('wateringCan', 80, 95), F('plant', 90, 96, 0), F('bunnyStatue', 34, 96), SG('Jack', 'chalkboard')] } },
    jokerCaravan: { label: 'The Basket Caravan', blurb: 'Robin\'s caravan, full of baskets for the egg hunt.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('appleBasket', 30, 97), F('appleBasket', 70, 97), F('armchair', 50, 94, 1), F('bunnyStatue', 80, 96), SG('Robin', 'banner', 30)] } },
  },
  july4: {
    kingHall: { label: 'The Flag Hall', blurb: 'King Kenny under red, white and blue banners.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('wallBanner', 33, 30, 0), F('wallBanner', 67, 30, 0), F('throne', 50, 84, 0), F('floorLamp', 20, 90), F('plant', 84, 96, 0), F('bunting', 50, 14), SG('King Kenny', 'wood')] } },
    queenParlour: { label: 'The Porch', blurb: 'Queen Rose\'s front porch, set for the cookout.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('sofa', 60, 90, 0), F('sideTable', 28, 92), F('plant', 88, 96, 0), F('grill', 80, 94), SG('Queen Rose', 'plate', 52)] } },
    jackWorkshop: { label: 'The Garage', blurb: 'Jack gets the parade float ready.', dress: { wall: { finish: 'brick', color: '#8a4a3a' } }, recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('chest', 80, 94), F('wallShelf', 20, 30), F('cabinet', 22, 92), F('bunting', 50, 20), SG('Jack', 'street')] } },
    jokerCaravan: { label: 'The Camper', blurb: 'Robin\'s camper, parked by the lake for the fireworks.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('bed', 50, 92, 2), F('tableLamp', 20, 92), F('bunting', 50, 30), SG('Robin', 'banner', 30)] } },
  },
  diwali: {
    kingHall: { label: 'The Hall of Lamps', blurb: 'King Kenny among a hundred little lamps.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('throne', 50, 84, 0), F('candelabra', 24, 90), F('candelabra', 40, 90), F('candelabra', 60, 90), F('candelabra', 76, 90), F('rangoliMat', 50, 96), SG('King Kenny', 'plate')] } },
    queenParlour: { label: 'The Rangoli Courtyard', blurb: 'Queen Rose draws a rangoli on the floor.', recipe: { shell: 'corner', items: [F('rug', 56, 94, 0), F('window', 70, 30), F('plant', 30, 94, 0), F('plant', 88, 96, 0), F('candelabra', 50, 88), F('diyaRow', 50, 72), SG('Queen Rose', 'banner', 52)] } },
    jackWorkshop: { label: 'The Sweet Shop', blurb: 'Jack makes sweets for the festival.', recipe: { shell: 'flat', items: [F('cabinet', 48, 92), F('wallShelf', 20, 30), F('wallShelf', 80, 30), F('tableLamp', 48, 80, null, { ground: 92 }), F('diyaRow', 50, 94), SG('Jack', 'banner')] } },
    jokerCaravan: { label: 'The Light Caravan', blurb: 'Robin\'s caravan, strung with lights.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('armchair', 50, 94, 1), F('candelabra', 22, 94), F('candelabra', 80, 94), F('rangoliMat', 50, 96), SG('Robin', 'banner', 30)] } },
  },
  harvest: {
    kingHall: { label: 'The Feast Barn', blurb: 'King Kenny at the head of the long harvest table.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('throne', 50, 84, 0), F('hayBale', 20, 94), F('pumpkinPile', 80, 96), F('appleBasket', 36, 97), F('leafWreath', 50, 30), F('cornucopia', 74, 96), SG('King Kenny', 'wood', 6)] } },
    queenParlour: { label: 'The Pie Kitchen', blurb: 'Queen Rose\'s kitchen, with pies cooling at the window.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('fireplace', 40, 70), F('sideTable', 80, 92), F('appleBasket', 26, 97), F('pieTable', 60, 94), SG('Queen Rose', 'chalkboard', 52)] } },
    jackWorkshop: { label: 'The Grain Mill', blurb: 'Jack grinds the flour.', dress: { wall: { finish: 'boards', color: '#a8794e' } }, recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('hayBale', 18, 94), F('hayBale', 82, 94), F('gearWall', 50, 26), F('cornucopia', 50, 97), SG('Jack', 'chalkboard', 50)] } },
    jokerCaravan: { label: 'The Hay Wagon', blurb: 'Robin\'s wagon, stacked high with hay.', recipe: { shell: 'attic', items: [F('hayBale', 30, 94), F('hayBale', 70, 94), F('pumpkinPile', 50, 97), F('window', 60, 36, null, { scale: 0.7 }), F('pieTable', 30, 94), SG('Robin', 'chalkboard', 30)] } },
  },
  hanukkah: {
    kingHall: { label: 'The Silver Hall', blurb: 'King Kenny lights the menorah in the window.', recipe: { shell: 'room', items: [F('rug', 50, 95, 0), F('window', 50, 30), F('throne', 50, 86, 0), F('candelabra', 50, 64), F('bookshelf', 16, 76), F('bookshelf', 86, 76), F('menorah', 50, 30, null, { scale: 0.6 }), SG('King Kenny', 'plate', 6)] } },
    queenParlour: { label: 'The Latke Kitchen', blurb: 'Queen Rose fries latkes for everyone.', recipe: { shell: 'corner', items: [F('window', 66, 30), F('woodStove', 40, 86), F('sideTable', 80, 92), F('plant', 90, 96, 0), F('menorah', 70, 24, null, { scale: 0.5 }), SG('Queen Rose', 'chalkboard', 52)] } },
    jackWorkshop: { label: 'The Dreidel Workshop', blurb: 'Jack carves wooden dreidels.', recipe: { shell: 'flat', items: [F('workbench', 48, 90), F('wallShelf', 20, 30), F('chest', 80, 94), F('tableLamp', 48, 77, null, { ground: 90 }), F('dreidel', 30, 96), SG('Jack', 'plate')] } },
    jokerCaravan: { label: 'The Blue Caravan', blurb: 'Robin\'s caravan, warm inside on a snowy night.', recipe: { shell: 'attic', items: [F('rug', 50, 96, 0), F('window', 60, 36, null, { scale: 0.7 }), F('bed', 50, 92, 2), F('candelabra', 22, 94), F('dreidel', 76, 96), SG('Robin', 'banner', 30)] } },
  },
};
/* A place's name and description in a theme. */
export function placeInfo(id, theme = 'nimrod') {
  const p = PLACES[id] || PLACES.kingHall, h = HOMES[theme] && HOMES[theme][id];
  return { ...p, label: (h && h.label) || p.label, blurb: (h && h.blurb) || p.blurb };
}
/* The Park, per theme, as a SCENE BUILDER recipe (parts placed on a sky). Edit it in the scene
   builder like any outdoor scene. */
const SP = (part, x, y, depth = 1, more) => ({ part, x, y, depth, ...more });
const parkBase = [SP('hill', 30, 66, 0), SP('hill', 76, 68, 0, { flip: true }), SP('bench', 50, 86)];
export const PARK_SCENES = {
  medieval: { sky: 'fall', overlays: ['leaves'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 86, 90, 1, { flip: true }), SP('hayBale', 30, 92), SP('scarecrow', 70, 88), SP('wallBanner', 50, 80)] },
  nimrod: { sky: 'cozy', overlays: ['butterfly'], parts: [...parkBase, SP('tree', 16, 88), SP('tree', 86, 90, 1, { flip: true }), SP('bush', 32, 92, 2), SP('pottingBench', 70, 92), SP('wateringCan', 80, 95, 2)] },
  fall: { sky: 'fall', overlays: ['leaves'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 84, 90, 1, { flip: true }), SP('scarecrow', 30, 88), SP('hayBale', 70, 92), SP('pumpkinPile', 80, 97, 2)] },
  winter: { sky: 'winter', overlays: ['snow'], parts: [...parkBase, SP('pine', 14, 88), SP('pine', 86, 90), SP('snowman', 30, 92), SP('sled', 72, 95, 2), SP('bareTree', 62, 70, 0)] },
  halloween: { sky: 'halloween', overlays: ['bats'], parts: [...parkBase, SP('bareTree', 14, 90), SP('bareTree', 86, 90, 1, { flip: true }), SP('pumpkinPile', 30, 96, 2), SP('jackLantern', 66, 95, 2), SP('jackLantern', 74, 97, 2), SP('streetLamp', 40, 86)] },
  christmas: { sky: 'christmas', overlays: ['snow'], parts: [...parkBase, SP('pine', 12, 88), SP('xmasTree', 80, 92), SP('presents', 68, 97, 2), SP('snowman', 28, 94), SP('streetLamp', 40, 86)] },
  steampunk: { sky: 'steampunk', overlays: ['steam'], parts: [...parkBase, SP('gearLarge', 16, 80), SP('bareTree', 86, 90, 1, { flip: true }), SP('streetLamp', 36, 86), SP('pipe', 70, 96, 2), SP('telescope', 72, 90)] },
  cozy: { sky: 'cozy', overlays: ['fireflies'], parts: [...parkBase, SP('tree', 16, 88), SP('tree', 86, 90, 1, { flip: true }), SP('bush', 32, 92, 2), SP('streetLamp', 70, 86)] },
  spring: { sky: 'spring', overlays: ['butterfly'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 86, 90, 1, { flip: true }), SP('bush', 30, 92, 2), SP('bush', 72, 94, 2), SP('pottingBench', 62, 92)] },
  summer: { sky: 'summer', overlays: ['boat'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 86, 90, 1, { flip: true }), SP('rock', 70, 94, 2), SP('bush', 30, 94, 2)] },
  night: { sky: 'night', overlays: ['shootingStar','fireflies'], parts: [...parkBase, SP('pine', 14, 88), SP('pine', 86, 90), SP('streetLamp', 36, 86), SP('telescope', 70, 92)] },
  ocean: { sky: 'ocean', overlays: ['boat'], parts: [...parkBase, SP('rock', 18, 92), SP('rock', 82, 94, 2), SP('reef', 50, 98, 2), SP('kelp', 30, 96, 2), SP('chest', 66, 96, 2)] },
  cyberpunk: { sky: 'cyberpunk', overlays: [], parts: [...parkBase, SP('building', 12, 90, 0), SP('building', 88, 92, 0), SP('streetLamp', 30, 88), SP('streetLamp', 70, 88), SP('pipe', 50, 97, 2)] },
  newYear: { sky: 'newYear', overlays: [], parts: [...parkBase, SP('building', 14, 88, 0), SP('building', 86, 90, 0), SP('streetLamp', 32, 88), SP('streetLamp', 68, 88)] },
  lunarNewYear: { sky: 'lunarNewYear', overlays: [], parts: [...parkBase, SP('tree', 14, 88), SP('building', 86, 90, 0), SP('streetLamp', 34, 88), SP('wallBanner', 70, 80)] },
  valentines: { sky: 'valentines', overlays: ['butterfly'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 86, 90, 1, { flip: true }), SP('bush', 30, 94, 2), SP('bush', 72, 94, 2)] },
  stPatricks: { sky: 'stPatricks', overlays: [], parts: [...parkBase, SP('tree', 14, 88), SP('rock', 76, 94, 2), SP('bush', 30, 94, 2), SP('chest', 68, 96, 2)] },
  easter: { sky: 'easter', overlays: ['butterfly'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 86, 90, 1, { flip: true }), SP('bush', 30, 94, 2), SP('appleBasket', 66, 97, 2)] },
  july4: { sky: 'july4', overlays: ['fireflies'], parts: [...parkBase, SP('tree', 14, 88), SP('tree', 86, 90, 1, { flip: true }), SP('streetLamp', 34, 86), SP('wallBanner', 70, 80)] },
  diwali: { sky: 'diwali', overlays: [], parts: [...parkBase, SP('tree', 14, 88), SP('building', 86, 90, 0), SP('candelabra', 34, 94, 2), SP('candelabra', 66, 94, 2)] },
  harvest: { sky: 'harvest', overlays: ['leaves'], parts: [...parkBase, SP('tree', 14, 88), SP('scarecrow', 30, 88), SP('hayBale', 70, 92), SP('pumpkinPile', 82, 97, 2)] },
  hanukkah: { sky: 'hanukkah', overlays: ['snow'], parts: [...parkBase, SP('pine', 14, 88), SP('pine', 86, 90), SP('snowman', 30, 92), SP('streetLamp', 66, 86)] },
};
export const parkScene = (theme) => JSON.parse(JSON.stringify(PARK_SCENES[theme] || PARK_SCENES.nimrod));

export const PLACE_FOR = { K: 'kingHall', Q: 'queenParlour', J: 'jackWorkshop', joker: 'jokerCaravan', hearts: 'bakery', diamonds: 'shop', clubs: 'park', spades: 'library' };
export const placeForCard = (card) => (card.rank === 'joker' ? 'jokerCaravan' : PLACE_FOR[card.rank] || PLACE_FOR[card.suit]);

/* A place's recipe, dressed for a theme. `edited` is the person's saved version for this theme, if
   any; it wins whole. Furniture with a colour slot `c` takes that slot of the theme's palette. */
export function placeRecipe(id, theme = 'nimrod', edited) {
  if (edited) return edited;
  const p = PLACES[id], h = HOMES[theme] && HOMES[theme][id], d = { ...dressFor(theme), ...(h && h.dress) };
  if (!p || p.outdoor) return null;
  const src = (h && h.recipe) || p.recipe;
  return {
    shell: src.shell, wall: { ...d.wall }, floor: { ...d.floor }, light: d.light, view: d.view, panels: 'seeThrough',
    items: src.items.map(({ c, ...it }) => (c != null ? { ...it, color: d.palette[c % d.palette.length] } : { ...it })),
  };
}

/* ---------- drawing a place as a flat SVG (for cards, thumbnails and story pages) ---------- */
const W = 960, H = 540;
const SHELLS = {
  room: { l: 16, r: 84, b: 66, left: 'M0 0H153.6V356.4L0 540Z', right: 'M806.4 0H960V540L806.4 356.4Z', floor: 'M153.6 356.4H806.4L960 540H0Z' },
  corner: { l: 24, r: 100, b: 66, left: 'M0 0H230.4V356.4L0 540Z', floor: 'M230.4 356.4H960V540H0Z' },
  flat: { l: 0, r: 100, b: 70, floor: 'M0 378H960V540H0Z' },
  attic: { l: 16, r: 84, b: 66, left: 'M0 0H153.6V356.4L0 540Z', right: 'M806.4 0H960V540L806.4 356.4Z', floor: 'M153.6 356.4H806.4L960 540H0Z', ceil: ['M0 0H326.4L153.6 118.8L0 194.4Z', 'M633.6 0H960V194.4L806.4 118.8Z'] },
};
const BOX = { sofa: [270, 118], armchair: [140, 124], bed: [300, 150], bookshelf: [130, 210], desk: [210, 112], sideTable: [76, 74], cabinet: [230, 76], tableLamp: [54, 86], floorLamp: [70, 220], plant: [88, 140], rug: [340, 64], fireplace: [230, 196], window: [210, 190], wallShelf: [190, 64] };
const ON_WALL = { window: 1, wallShelf: 1 };
const DEF_COL = { sofa: '#6f8656', armchair: '#9e5449', bed: '#7f9bb0', bookshelf: '#6b4a32', desk: '#8a5f3c', sideTable: '#8a5f3c', cabinet: '#4f5d52', tableLamp: '#f0dca0', floorLamp: '#efe3c2', plant: '#5b8a4a', rug: '#b07a4a', fireplace: '#b9aa94', window: '#f2efe6', wallShelf: '#8a5f3c' };
const depthK = (y) => 0.72 + ((Math.max(55, Math.min(106, y)) - 66) / 34) * 0.5;
const BOOKS = ['#9e5449', '#4d6730', '#14636A', '#c9a24a', '#7a5a8a', '#b07a4a', '#3f5a72'];
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join(''); };

/* each part drawn in a 0–100 box */
const SIL = {
  sofa: (c) => `<rect x="6" y="0" width="88" height="58" rx="14" fill="${shade(c, 0.82)}"/><rect x="6" y="48" width="88" height="34" rx="10" fill="${c}"/><rect x="0" y="30" width="13" height="56" rx="7" fill="${shade(c, 0.72)}"/><rect x="87" y="30" width="13" height="56" rx="7" fill="${shade(c, 0.72)}"/><rect x="8" y="86" width="5" height="14" fill="#3a2614"/><rect x="87" y="86" width="5" height="14" fill="#3a2614"/>`,
  armchair: (c) => `<rect x="12" y="0" width="76" height="64" rx="22" fill="${shade(c, 0.82)}"/><rect x="10" y="52" width="80" height="32" rx="10" fill="${c}"/><rect x="0" y="34" width="20" height="54" rx="10" fill="${shade(c, 0.72)}"/><rect x="80" y="34" width="20" height="54" rx="10" fill="${shade(c, 0.72)}"/><rect x="12" y="86" width="6" height="14" fill="#3a2614"/><rect x="82" y="86" width="6" height="14" fill="#3a2614"/>`,
  bed: (c) => `<rect x="0" y="0" width="100" height="64" rx="10" fill="#6b4a32"/><rect x="-2" y="46" width="104" height="42" rx="10" fill="${c}"/><rect x="10" y="30" width="34" height="20" rx="8" fill="#f4f1e8"/><rect x="56" y="30" width="34" height="20" rx="8" fill="#f4f1e8"/>`,
  bookshelf: (c) => `<rect width="100" height="100" rx="3" fill="${c}"/><rect x="7" y="4" width="86" height="92" fill="${shade(c, 0.6)}"/>${[0, 1, 2, 3].map((r) => Array.from({ length: 7 }, (_, i) => `<rect x="${10 + i * 11.4}" y="${100 - (5 + r * 23.5) - (14 + ((i * 7 + r * 3) % 6))}" width="9.4" height="${14 + ((i * 7 + r * 3) % 6)}" fill="${BOOKS[(i + r * 2) % 7]}"/>`).join('') + `<rect x="7" y="${100 - (3 + r * 23.5) - 2.4}" width="86" height="2.4" fill="${c}"/>`).join('')}`,
  desk: (c) => `<rect x="0" y="0" width="100" height="12" rx="3" fill="${shade(c, 1.12)}"/><rect x="62" y="12" width="34" height="88" fill="${c}"/><rect x="66" y="24" width="26" height="22" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/><rect x="66" y="54" width="26" height="22" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/><rect x="4" y="12" width="5" height="88" fill="${c}"/>`,
  sideTable: (c) => `<rect width="100" height="14" rx="6" fill="${shade(c, 1.12)}"/><rect x="14" y="14" width="72" height="46" fill="${c}"/><circle cx="50" cy="36" r="4" fill="#e2c270"/><rect x="14" y="58" width="5" height="42" fill="${c}"/><rect x="81" y="58" width="5" height="42" fill="${c}"/>`,
  cabinet: (c) => `<rect width="100" height="88" rx="4" fill="${c}"/>${[0, 1, 2].map((i) => `<rect x="${4 + i * 32}" y="10" width="28" height="66" rx="3" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="2"/>`).join('')}<rect x="4" y="88" width="4" height="12" fill="#2a2d33"/><rect x="92" y="88" width="4" height="12" fill="#2a2d33"/>`,
  tableLamp: (c) => `<path d="M30 0H70L92 42H8Z" fill="${c}"/><rect x="46" y="42" width="8" height="50" fill="#6b4a32"/><rect x="24" y="91" width="52" height="9" rx="4" fill="#6b4a32"/>`,
  floorLamp: (c) => `<path d="M24 0H76L96 18H4Z" fill="${c}"/><rect x="47" y="18" width="6" height="78" fill="#2a2d33"/><rect x="20" y="96" width="60" height="4" rx="2" fill="#2a2d33"/>`,
  plant: (c) => `<ellipse cx="34" cy="34" rx="16" ry="30" fill="${c}" transform="rotate(-24 34 64)"/><ellipse cx="66" cy="34" rx="16" ry="30" fill="${shade(c, 0.82)}" transform="rotate(24 66 64)"/><ellipse cx="50" cy="28" rx="14" ry="30" fill="${shade(c, 1.12)}"/><path d="M22 66H78L72 100H28Z" fill="#b8704a"/><rect x="18" y="62" width="64" height="7" rx="3" fill="#a3603e"/>`,
  rug: (c) => `<ellipse cx="50" cy="50" rx="50" ry="50" fill="${c}"/><ellipse cx="50" cy="50" rx="38" ry="34" fill="${shade(c, 0.84)}"/><ellipse cx="50" cy="50" rx="26" ry="20" fill="${shade(c, 1.1)}"/>`,
  fireplace: (c) => `<rect x="0" y="12" width="100" height="88" rx="3" fill="${c}"/><rect x="-5" y="8" width="110" height="8" rx="3" fill="${shade(c, 0.8)}"/><path d="M20 100V52Q50 30 80 52V100Z" fill="#1b1410"/><rect x="28" y="88" width="44" height="8" rx="4" fill="#4a2e1a"/><path d="M34 90Q38 64 46 60Q44 74 52 80Q56 62 66 56Q64 78 62 90Z" fill="#f6a13a"/><path d="M42 90Q46 74 52 72Q52 82 58 90Z" fill="#ffe08a"/>`,
  window: (c, d) => `<defs><linearGradient id="WSKY" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.sky[0]}"/><stop offset="1" stop-color="${d.sky[1]}"/></linearGradient></defs><rect x="4" y="4" width="92" height="92" fill="url(#WSKY)"/>${d.night ? `<circle cx="70" cy="26" r="9" fill="#f7e2a0"/>` : `<circle cx="70" cy="28" r="10" fill="#fff6d8" opacity=".9"/>`}<path d="M4 72Q30 58 52 68T96 62V96H4Z" fill="${d.far}"/><rect x="0" y="0" width="100" height="100" fill="none" stroke="${c}" stroke-width="8"/><rect x="48" y="0" width="4" height="100" fill="${c}"/><rect x="0" y="47" width="100" height="4" fill="${c}"/><path d="M-14 -8H8V108H-14Q-6 60-14-8Z" fill="#9e5449"/><path d="M114 -8H92V108H114Q106 60 114-8Z" fill="#9e5449"/>`,
  wallShelf: (c) => `<rect x="0" y="86" width="100" height="14" rx="2" fill="${c}"/><rect x="8" y="26" width="6" height="60" fill="#14636A"/><rect x="16" y="14" width="6" height="72" fill="#c9a24a"/><rect x="23" y="32" width="6" height="54" fill="#9e5449"/><path d="M44 52H58L56 86H46Z" fill="#b8704a"/><ellipse cx="51" cy="40" rx="6" ry="14" fill="#5b8a4a"/><rect x="72" y="58" width="14" height="28" rx="3" fill="#f2efe6"/>`,
};
const FINISH = {
  stripes: (c) => `<pattern id="P" width="60" height="10" patternUnits="userSpaceOnUse"><rect width="60" height="10" fill="${c}"/><rect x="26" width="4" height="10" fill="${shade(c, 0.88)}"/><rect x="34" width="26" height="10" fill="${shade(c, 0.94)}"/></pattern>`,
  sprig: (c) => `<pattern id="P" width="56" height="56" patternUnits="userSpaceOnUse"><rect width="56" height="56" fill="${c}"/><g fill="#000" opacity=".12"><path d="M14 10c4 2 5 6 3 10-3-2-5-6-3-10zM14 20c-4-1-7 1-8 4 4 1 7-1 8-4z"/><path d="M42 38c4 2 5 6 3 10-3-2-5-6-3-10zM42 48c-4-1-7 1-8 4 4 1 7-1 8-4z"/></g></pattern>`,
  boards: (c) => `<pattern id="P" width="46" height="10" patternUnits="userSpaceOnUse"><rect width="46" height="10" fill="${c}"/><rect width="2" height="10" fill="rgba(0,0,0,.22)"/></pattern>`,
  brick: (c) => `<pattern id="P" width="48" height="44" patternUnits="userSpaceOnUse"><rect width="48" height="44" fill="${c}"/><path d="M0 21h48M0 43h48M24 0v21M0 22v21" stroke="#e8dccb" stroke-opacity=".45" stroke-width="2.2"/></pattern>`,
};
let uid = 0;
function mountSvg(it, d) {
  const x = (it.x / 100) * W, y = (it.y / 100) * H, k = it.scale ?? 1;
  if (it.kind === 'frame') {
    const w = (it.width || 96) * k, h = w * (it.aspect === '4:3' ? 0.78 : 1), fr = it.frame === 'ornate' ? '#c9a24a' : it.frame === 'monitor' ? '#2a2d33' : it.frame === 'instant' ? '#fbf9ef' : '#6b4a32';
    return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="${fr}"/><rect x="${x - w / 2 + w * 0.1}" y="${y - h / 2 + h * 0.1}" width="${w * 0.8}" height="${h * (it.frame === 'instant' ? 0.66 : 0.8)}" fill="${d.palette[1]}"/><circle cx="${x - w * 0.08}" cy="${y - h * 0.06}" r="${w * 0.12}" fill="${shade(d.palette[0], 1.2)}"/><path d="M${x - w * 0.36} ${y + h * 0.3}Q${x} ${y - h * 0.05} ${x + w * 0.36} ${y + h * 0.3}Z" fill="${shade(d.palette[0], 0.9)}"/>`;
  }
  if (it.kind === 'clock') { const r = ((it.size || 80) * k) / 2; return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fbf9ef" stroke="#3a2614" stroke-width="${r / 7}"/><path d="M${x} ${y}V${y - r * 0.55}M${x} ${y}L${x + r * 0.4} ${y + r * 0.1}" stroke="#1b1d22" stroke-width="${r / 10}" stroke-linecap="round"/>`; }
  if (it.kind === 'calendar') { const w = (it.width || 70) * k; return `<rect x="${x - w / 2}" y="${y - w * 0.6}" width="${w}" height="${w * 1.2}" rx="5" fill="#fbf9ef"/><rect x="${x - w / 2}" y="${y - w * 0.6}" width="${w}" height="${w * 0.3}" rx="5" fill="#9e5449"/>`; }
  if (it.kind === 'sign') {
    const name = it.name || '', fs = 30 * k, w = Math.max(120, name.length * fs * 0.62 + 40), h = fs * 1.7;
    const bg = { wood: '#8a5a32', chalkboard: '#2a3a32', plate: '#c9a24a', banner: d.palette[0], street: '#2f6d4a', neon: '#14111c' }[it.variant] || '#8a5a32';
    const ink = it.variant === 'plate' ? '#2a1a10' : '#fbf6ea';
    return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${it.variant === 'banner' ? 4 : 10}" fill="${bg}" stroke="rgba(0,0,0,.25)" stroke-width="3"/><text x="${x}" y="${y + fs * 0.35}" text-anchor="middle" font-family="-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="800" font-size="${fs}" fill="${ink}">${name.replace(/[<&]/g, '')}</text>`;
  }
  return '';
}

for (const [k, p] of Object.entries(KIT)) { BOX[k] = p.box; DEF_COL[k] = p.color; if (p.on === 'wall') ON_WALL[k] = 1; SIL[k] = (c) => p.svg(c); }

export function placeSvg(id, theme = 'nimrod', { edited, label } = {}) {
  const d = dressFor(theme), p = placeInfo(id, theme);
  const title = (label || p.label) + ', ' + d.label;
  if (p.outdoor) return parkSvg(d, title);
  const r = placeRecipe(id, theme, edited);
  const sh = SHELLS[r.shell] || SHELLS.room, n = ++uid;
  const wc = (r.wall && r.wall.color) || '#d9d2b6', fc = (r.floor && r.floor.color) || '#9a6a42';
  const fin = (FINISH[r.wall && r.wall.finish] || ((c) => `<pattern id="P" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${c}"/></pattern>`))(wc).replace(/id="P"/, `id="P${n}"`);
  const bx = (sh.l / 100) * W, bw = ((sh.r - sh.l) / 100) * W, bb = (sh.b / 100) * H;
  const vpX = W / 2, vpY = bb * 0.45;
  const fl = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => { const fx = bx + (bw * i) / 8; const tx = vpX + (fx - vpX) * ((H - vpY) / (bb - vpY)); return `<path d="M${fx} ${bb}L${tx} ${H}" stroke="rgba(0,0,0,.16)" stroke-width="2"/>`; }).join('') + [0.22, 0.5, 0.82].map((f) => `<path d="M0 ${bb + (H - bb) * f}H${W}" stroke="rgba(0,0,0,.1)" stroke-width="2"/>`).join('');
  const items = r.items || [];
  const isFloor = (it) => it.kind === 'furniture' && !ON_WALL[it.part];
  const drawF = (it) => {
    const b = BOX[it.part]; if (!b) return '';
    const fk = (it.scale ?? 1) * (isFloor(it) ? depthK(it.ground ?? it.y) : 1);
    const w = b[0] * fk, h = b[1] * fk, x = (it.x / 100) * W - w / 2, y = (it.y / 100) * H - (isFloor(it) ? h : h / 2);
    const body = SIL[it.part](it.color || DEF_COL[it.part], d).replace(/WSKY/g, 'WSKY' + n + '_' + it.x);
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible"${it.flip ? ` transform="translate(${2 * x + w} 0) scale(-1 1)"` : ''}>${body}</svg>`;
  };
  const wallF = items.filter((it) => it.kind === 'furniture' && ON_WALL[it.part]);
  const floorF = items.filter(isFloor).sort((a, b) => (b.part === 'rug') - (a.part === 'rug') || (a.ground ?? a.y) - (b.ground ?? b.y));
  const mounts = items.filter((it) => it.kind !== 'furniture' && it.kind !== 'cat');
  const veil = r.light === 'night' ? 'rgba(8,14,34,.42)' : r.light === 'evening' ? 'rgba(170,80,30,.16)' : null;
  const glows = r.light !== 'day' ? items.filter((it) => ['tableLamp', 'floorLamp', 'fireplace'].includes(it.part) || (KIT[it.part] && KIT[it.part].glow)).map((it) => { const g = KIT[it.part] && KIT[it.part].glow, b = BOX[it.part], fk = (it.scale ?? 1) * depthK(it.ground ?? it.y), cx = (it.x / 100) * W, cy = (it.y / 100) * H - b[1] * fk * (g ? 1 - g.y / 100 : it.part === 'fireplace' ? 0.3 : 0.85), rr = (g ? g.r * 1.2 : it.part === 'floorLamp' ? 200 : 150) * fk; return `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="url(#G${n})"/>`; }).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title><defs>${fin}<radialGradient id="G${n}"><stop offset="0" stop-color="rgba(255,206,130,.55)"/><stop offset="1" stop-color="rgba(255,206,130,0)"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="${shade(wc, 0.8)}"/><rect x="${bx}" y="0" width="${bw}" height="${bb}" fill="url(#P${n})"/>`
    + (sh.left ? `<path d="${sh.left}" fill="url(#P${n})"/><path d="${sh.left}" fill="rgba(0,0,0,.16)"/>` : '') + (sh.right ? `<path d="${sh.right}" fill="url(#P${n})"/><path d="${sh.right}" fill="rgba(0,0,0,.2)"/>` : '')
    + (r.wall && r.wall.wainscot ? `<rect x="${bx}" y="${bb - H * 0.22}" width="${bw}" height="${H * 0.22}" fill="${r.wall.wainscot}"/><rect x="${bx}" y="${bb - H * 0.22}" width="${bw}" height="5" fill="${shade(r.wall.wainscot, 1.2)}"/>` : '')
    + (sh.ceil ? sh.ceil.map((c) => `<path d="${c}" fill="${shade(wc, 0.62)}"/>`).join('') : '')
    + `<path d="${sh.floor}" fill="${fc}"/><g clip-path="none">${fl}</g><path d="${sh.floor}" fill="url(#F${n})" opacity="0"/><rect x="${bx}" y="${bb - 10}" width="${bw}" height="10" fill="#efe9da"/>`
    + wallF.map(drawF).join('') + floorF.map(drawF).join('')
    + (veil ? `<rect width="${W}" height="${H}" fill="${veil}"/>` : '') + glows
    + mounts.map((it) => mountSvg(it, d)).join('') + `</svg>`;
}

function parkSvg(d, title) {
  const n = ++uid, gx = d.grass, sky = d.sky;
  const tree = (x, base, s) => {
    const tw = 18 * s, th = 120 * s;
    if (d.pines) return `<rect x="${x - tw / 2}" y="${base - th * 0.3}" width="${tw}" height="${th * 0.3}" fill="${d.trunk}"/>${[0, 1, 2].map((i) => `<path d="M${x} ${base - th * (1.15 - i * 0.28)}L${x + th * (0.28 + i * 0.1)} ${base - th * (0.6 - i * 0.24)}H${x - th * (0.28 + i * 0.1)}Z" fill="${d.leaf[i % d.leaf.length]}"/>`).join('')}${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${x + Math.sin(i * 2.2) * th * 0.3 * (i / 6 + 0.3)}" cy="${base - th * (0.95 - i * 0.12)}" r="${5 * s}" fill="${['#ff6b5a', '#ffd36e', '#7fe0a0', '#7fc6ff'][i % 4]}"/>`).join('')}${d.snow ? `<path d="M${x} ${base - th * 1.15}L${x + th * 0.14} ${base - th * 0.92}H${x - th * 0.14}Z" fill="#f4f8fa"/>` : ''}`;
    if (d.bare) return `<path d="M${x - tw / 2} ${base}L${x - tw * 0.3} ${base - th}L${x + tw * 0.3} ${base - th}L${x + tw / 2} ${base}Z" fill="${d.trunk}"/><path d="M${x} ${base - th * 0.7}L${x - th * 0.36} ${base - th * 1.05}M${x} ${base - th * 0.85}L${x + th * 0.34} ${base - th * 1.12}M${x - th * 0.18} ${base - th * 0.88}L${x - th * 0.28} ${base - th * 1.2}M${x + th * 0.16} ${base - th * 0.98}L${x + th * 0.12} ${base - th * 1.28}" stroke="${d.trunk}" stroke-width="${7 * s}" stroke-linecap="round"/>`;
    return `<rect x="${x - tw / 2}" y="${base - th * 0.62}" width="${tw}" height="${th * 0.62}" fill="${d.trunk}"/>${[[-0.26, -0.78, 0.36], [0.24, -0.82, 0.34], [0, -1.02, 0.4], [-0.08, -0.7, 0.3]].map(([dx, dy, rr], i) => `<circle cx="${x + dx * th}" cy="${base + dy * th}" r="${rr * th}" fill="${d.leaf[i % d.leaf.length]}"/>`).join('')}${d.snow ? `<path d="M${x - th * 0.36} ${base - th * 1.12}Q${x} ${base - th * 1.5} ${x + th * 0.36} ${base - th * 1.12}Q${x} ${base - th * 1.26} ${x - th * 0.36} ${base - th * 1.12}Z" fill="#f4f8fa"/>` : ''}`;
  };
  const extras = d.bare ? [[300, 470, 1], [380, 492, 0.7], [640, 480, 0.9]].map(([x, y, s]) => `<ellipse cx="${x}" cy="${y}" rx="${34 * s}" ry="${27 * s}" fill="#e07a2a"/><path d="M${x - 14 * s} ${y - 6 * s}l7 -10 7 10zM${x + 6 * s} ${y - 6 * s}l7 -10 7 10z" fill="#ffd36e"/><path d="M${x - 16 * s} ${y + 8 * s}Q${x} ${y + 20 * s} ${x + 16 * s} ${y + 8 * s}" stroke="#ffd36e" stroke-width="${5 * s}" fill="none"/>`).join('')
    : d.snow && !d.pines ? `<circle cx="660" cy="470" r="38" fill="#f4f8fa"/><circle cx="660" cy="414" r="26" fill="#f4f8fa"/><circle cx="652" cy="408" r="3" fill="#2a2d33"/><circle cx="668" cy="408" r="3" fill="#2a2d33"/><path d="M660 416l16 4-16 3z" fill="#e8833a"/><rect x="640" y="430" width="40" height="7" fill="#9e5449"/>`
    : d.pines ? `<rect x="640" y="452" width="46" height="38" fill="#c9483b"/><rect x="660" y="452" width="7" height="38" fill="#f4f1e8"/><rect x="694" y="466" width="34" height="26" fill="#2f6d96"/><rect x="708" y="466" width="6" height="26" fill="#f4f1e8"/>`
    : d.stacks ? `<rect x="70" y="150" width="34" height="200" fill="#2a2016"/><rect x="130" y="190" width="28" height="160" fill="#2a2016"/><circle cx="87" cy="130" r="22" fill="rgba(220,210,190,.35)"/><circle cx="104" cy="96" r="28" fill="rgba(220,210,190,.25)"/><g transform="translate(820 150)"><circle r="56" fill="none" stroke="#a8854d" stroke-width="16" stroke-dasharray="14 10"/><circle r="40" fill="#5a3c24"/><circle r="12" fill="#a8854d"/></g>`
    : Array.from({ length: 10 }, (_, i) => `<circle cx="${80 + i * 88}" cy="${452 + (i % 3) * 22}" r="7" fill="${['#e86a6a', '#f2d24a', '#f4ede0', '#b98ad8'][i % 4]}"/>`).join('');
  const leaves = d.label === 'Fall' ? Array.from({ length: 14 }, (_, i) => `<ellipse cx="${(i * 71) % 940 + 10}" cy="${400 + (i * 37) % 130}" rx="9" ry="5" fill="${d.leaf[i % 3]}" transform="rotate(${i * 40} ${(i * 71) % 940 + 10} ${400 + (i * 37) % 130})"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title><defs><linearGradient id="S${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#S${n})"/>`
    + (d.night ? `<circle cx="760" cy="90" r="40" fill="#f7e2a0"/>${Array.from({ length: 20 }, (_, i) => `<circle cx="${(i * 89) % 940 + 10}" cy="${(i * 53) % 200 + 10}" r="2" fill="#f4f1dc"/>`).join('')}` : `<circle cx="760" cy="96" r="46" fill="#fff6d8" opacity=".9"/>`)
    + `<path d="M0 300Q160 230 330 280T680 260T960 270V540H0Z" fill="${d.far}"/>`
    + tree(200, 330, 0.8) + tree(560, 320, 0.7) + tree(800, 335, 0.85)
    + `<path d="M0 340Q240 300 480 330T960 320V540H0Z" fill="${gx}"/>`
    + `<path d="M420 540L470 340H500L620 540Z" fill="${d.path}"/>`
    + tree(110, 480, 1.4) + tree(860, 500, 1.5)
    + `<g><rect x="250" y="404" width="130" height="12" rx="3" fill="#6b4a32"/><rect x="250" y="380" width="130" height="10" rx="3" fill="#6b4a32"/><rect x="262" y="416" width="8" height="34" fill="#3a2614"/><rect x="360" y="416" width="8" height="34" fill="#3a2614"/></g>`
    + `<g><rect x="702" y="290" width="7" height="170" fill="#1b2028"/><rect x="692" y="280" width="27" height="18" rx="4" fill="#e8dca8"/>${d.night ? '<circle cx="705" cy="290" r="70" fill="rgba(255,214,140,.22)"/>' : ''}</g>`
    + extras + leaves + `</svg>`;
}

/* One object, so the design-system bundle exposes it (only capitalised exports reach the
   namespace). In web/client, import the functions. */
export const TOWN = { TOWN_DRESS, PLACES, HOMES, PARK_SCENES, PLACE_FOR, placeForCard, placeRecipe, placeSvg, placeInfo, parkScene };
