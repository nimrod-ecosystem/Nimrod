// think_banks.js — THE SEED QUESTIONS for the thinking games (row 2.45), hand-written, at five levels.
//
// Mike, 2026-10-01: a speech therapist's exercises, our own versions: (1) name the smallest of three
// numbers, or the biggest of three things; (2) name the group three things belong to (fruit, animals,
// buildings); (3) finish a simple sentence, with no example given ("I wash my ___").
//
// THESE ARE STARTING GUESSES, NOT THE TRUTH. A question's `level` is where its rating STARTS
// (`rating.js` `levelRating`); every answer anybody gives moves it, so a "level 2" question everybody
// misses becomes a level 3 one by itself. Nothing here is copied from a published test or workbook:
// the words are everyday words, the sentences are everyday sentences, and the few sayings in level 5
// are traditional proverbs, not anybody's text. No lyrics.
//
// LEVELS, as written:
//   1  the commonest words, the widest differences, the most automatic sentences
//   2  common words, closer differences
//   3  everyday but needs a moment ("a giraffe, a horse, a cow")
//   4  less common, or knowledge more than looking (sun, moon, earth)
//   5  fine differences, abstract groups, old sayings
//
// Every question has a stable `id`: a rating is keyed by it, so an id must never be reused for a
// different question. Change a question's words, change its id.

// ---------------------------------------------------------------------------------------
// NUMBERS — generated once, the same every time (a fixed seed), so each triple is a real question
// with a stable id and its own rating.
// ---------------------------------------------------------------------------------------
const NUMBER_LEVELS = [
  // level, lo, hi, minimum gap between any two, how many
  { level: 1, lo: 1, hi: 9, gap: 3, n: 12 },        // 2, 6, 9
  { level: 2, lo: 1, hi: 9, gap: 1, n: 12 },        // 4, 5, 7
  { level: 3, lo: 10, hi: 99, gap: 10, n: 12 },     // 23, 61, 48 (different tens)
  { level: 4, lo: 10, hi: 99, gap: 1, sameTens: true, n: 12 },   // 42, 47, 45
  { level: 5, lo: 100, hi: 999, gap: 1, sameHundreds: true, n: 12 }, // 315, 351, 335
];

function lcg(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function numberTriples() {
  const out = [];
  for (const L of NUMBER_LEVELS) {
    const r = lcg(1000 + L.level);
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const seen = new Set();
    let guard = 0;
    while (out.filter((q) => q.level === L.level).length < L.n && guard++ < 5000) {
      let nums;
      if (L.sameTens) { const t = int(1, 9) * 10; nums = [int(0, 9), int(0, 9), int(0, 9)].map((d) => t + d); }
      else if (L.sameHundreds) { const h = int(1, 9) * 100; nums = [int(0, 99), int(0, 99), int(0, 99)].map((d) => h + d); }
      else nums = [int(L.lo, L.hi), int(L.lo, L.hi), int(L.lo, L.hi)];
      const s = [...nums].sort((a, b) => a - b);
      if (s[1] - s[0] < L.gap || s[2] - s[1] < L.gap) continue;
      if (L.level === 3 && new Set(nums.map((x) => Math.floor(x / 10))).size < 3) continue;
      const key = s.join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(Object.freeze({ id: `num-${key}`, kind: 'numbers', level: L.level, nums: Object.freeze(nums) }));
    }
  }
  return out;
}
export const NUMBERS = Object.freeze(numberTriples());

// ---------------------------------------------------------------------------------------
// THINGS — three things, SMALLEST FIRST. Every triple has a clear order both ways, so the same one
// serves "the biggest" and "the smallest". Shown in a mixed order (see `thingsShown`).
// ---------------------------------------------------------------------------------------
const THING_ROWS = {
  1: [['ant', 'dog', 'house'], ['spoon', 'chair', 'car'], ['button', 'apple', 'elephant'], ['bee', 'cat', 'cow'],
    ['pea', 'shoe', 'bus'], ['coin', 'book', 'tree'], ['fly', 'rabbit', 'whale'], ['ring', 'plate', 'mountain'],
    ['key', 'pillow', 'bed'], ['grape', 'melon', 'boat']],
  2: [['hamster', 'cat', 'horse'], ['grape', 'orange', 'watermelon'], ['skateboard', 'bicycle', 'car'],
    ['mouse', 'cat', 'dog'], ['sock', 'pillow', 'bed'], ['cherry', 'lemon', 'pumpkin'], ['bicycle', 'car', 'truck'],
    ['duck', 'sheep', 'cow'], ['cup', 'bucket', 'bathtub'], ['pencil', 'umbrella', 'door']],
  3: [['horse', 'elephant', 'whale'], ['car', 'van', 'bus'], ['goat', 'cow', 'giraffe'], ['plum', 'apple', 'melon'],
    ['violin', 'guitar', 'piano'], ['kitten', 'cat', 'lion'], ['puddle', 'pond', 'lake'], ['rock', 'hill', 'mountain'],
    ['village', 'town', 'city'], ['canoe', 'sailboat', 'ship']],
  4: [['moon', 'earth', 'sun'], ['river', 'sea', 'ocean'], ['sparrow', 'eagle', 'ostrich'], ['teaspoon', 'cup', 'jug'],
    ['inch', 'foot', 'yard'], ['city', 'country', 'continent'], ['mouse', 'fox', 'wolf'], ['seed', 'bush', 'tree'],
    ['raindrop', 'puddle', 'flood'], ['shed', 'house', 'castle']],
  5: [['pebble', 'boulder', 'cliff'], ['cottage', 'mansion', 'palace'], ['stream', 'river', 'ocean'],
    ['hamster', 'beaver', 'bear'], ['wasp', 'crow', 'goose'], ['dinghy', 'yacht', 'ocean liner'],
    ['tablespoon', 'ladle', 'saucepan'], ['wren', 'pigeon', 'swan'], ['hornet', 'hummingbird', 'owl'],
    ['raspberry', 'plum', 'mango']],
};
const thingId = (t) => `things-${t.join('-').replace(/\s+/g, '_')}`;
export const THINGS = Object.freeze(Object.entries(THING_ROWS).flatMap(([level, rows]) => rows.map((t) =>
  Object.freeze({ id: thingId(t), kind: 'things', level: Number(level), things: Object.freeze(t.slice()) }))));

// ---------------------------------------------------------------------------------------
// GROUPS — three things and the group they belong to. `accept`: every word that names the group
// (a bird is also an animal, so "animals" is right for birds). `cue`: a hint that MEANS the group
// without saying it — the first hint, before the first letter (a meaning cue before a sound cue,
// the usual order for helping somebody find a word [training knowledge]).
// ---------------------------------------------------------------------------------------
const G = (level, things, group, accept, cue) => ({ level, things, group, accept: [group, ...accept], cue });
const GROUP_ROWS = [
  G(1, ['apple', 'banana', 'orange'], 'fruit', ['fruits'], 'they are sweet and grow on trees and plants'),
  G(1, ['dog', 'cat', 'cow'], 'animals', ['animal', 'pets'], 'they are alive and have four legs'),
  G(1, ['red', 'blue', 'green'], 'colours', ['colors', 'colour', 'color'], 'you see them in a rainbow'),
  G(1, ['shirt', 'socks', 'hat'], 'clothes', ['clothing'], 'you wear them'),
  G(1, ['milk', 'juice', 'water'], 'drinks', ['drink', 'drinks'], 'you pour them into a glass'),
  G(1, ['one', 'two', 'three'], 'numbers', ['number'], 'you count with them'),
  G(1, ['house', 'school', 'church'], 'buildings', ['building'], 'they have walls, a roof and a door'),
  G(1, ['eye', 'nose', 'mouth'], 'parts of the face', ['face', 'body parts', 'body', 'parts of the body'], 'they are on your head'),
  G(2, ['carrot', 'potato', 'peas'], 'vegetables', ['vegetable', 'veggies'], 'they grow in a garden and go with dinner'),
  G(2, ['chair', 'table', 'sofa'], 'furniture', [], 'they are in the living room'),
  G(2, ['car', 'bus', 'train'], 'vehicles', ['vehicle', 'transport', 'transportation'], 'they take you from place to place'),
  G(2, ['rain', 'snow', 'wind'], 'weather', [], 'they come from the sky'),
  G(2, ['mother', 'brother', 'aunt'], 'family', ['relatives', 'relations'], 'they are related to you'),
  G(2, ['robin', 'eagle', 'duck'], 'birds', ['bird', 'animals'], 'they have feathers'),
  G(2, ['bread', 'cheese', 'eggs'], 'food', ['foods'], 'you eat them'),
  G(2, ['hand', 'foot', 'knee'], 'body parts', ['body', 'parts of the body'], 'they are part of you'),
  G(3, ['hammer', 'saw', 'screwdriver'], 'tools', ['tool'], 'you fix and build things with them'),
  G(3, ['piano', 'drum', 'guitar'], 'instruments', ['musical instruments', 'instrument', 'music'], 'people play songs on them'),
  G(3, ['pot', 'pan', 'kettle'], 'kitchen things', ['kitchen', 'cookware', 'pots and pans'], 'you cook with them'),
  G(3, ['doctor', 'teacher', 'farmer'], 'jobs', ['job', 'work', 'occupations', 'careers'], 'people are paid to do them'),
  G(3, ['circle', 'square', 'triangle'], 'shapes', ['shape'], 'you can draw them with lines'),
  G(3, ['spring', 'summer', 'winter'], 'seasons', ['season'], 'each one is a time of the year'),
  G(3, ['ant', 'bee', 'beetle'], 'insects', ['insect', 'bugs', 'bug'], 'they are small and have six legs'),
  G(3, ['rose', 'daisy', 'tulip'], 'flowers', ['flower', 'plants'], 'they grow in a garden and smell nice'),
  G(4, ['oak', 'maple', 'pine'], 'trees', ['tree'], 'they are tall and have leaves or needles'),
  G(4, ['happy', 'sad', 'angry'], 'feelings', ['feeling', 'emotions', 'moods'], 'they are how you feel inside'),
  G(4, ['gold', 'silver', 'iron'], 'metals', ['metal'], 'they are hard and shiny and come from the ground'),
  G(4, ['mars', 'venus', 'jupiter'], 'planets', ['planet', 'space'], 'they go around the sun'),
  G(4, ['soccer', 'tennis', 'golf'], 'sports', ['sport', 'games'], 'people play them with a ball'),
  G(4, ['monday', 'friday', 'sunday'], 'days', ['days of the week', 'day'], 'there are seven of them in a week'),
  G(4, ['march', 'july', 'october'], 'months', ['month', 'months of the year'], 'there are twelve of them in a year'),
  G(4, ['france', 'japan', 'brazil'], 'countries', ['country', 'places'], 'each one has its own flag'),
  G(5, ['knife', 'fork', 'spoon'], 'cutlery', ['silverware', 'utensils', 'flatware'], 'you set the table with them'),
  G(5, ['ring', 'necklace', 'bracelet'], 'jewellery', ['jewelry'], 'people wear them to look nice'),
  G(5, ['basil', 'mint', 'parsley'], 'herbs', ['herb', 'spices'], 'they are green leaves that flavour food'),
  G(5, ['poodle', 'beagle', 'collie'], 'dogs', ['dog', 'dog breeds', 'breeds', 'animals'], 'they bark'),
  G(5, ['cake', 'pie', 'pudding'], 'desserts', ['dessert', 'sweets', 'puddings'], 'you eat them after dinner'),
  G(5, ['box', 'jar', 'basket'], 'containers', ['container'], 'you keep things in them'),
  G(5, ['canoe', 'yacht', 'ferry'], 'boats', ['boat', 'ships'], 'they float on water'),
  G(5, ['inch', 'mile', 'metre'], 'measurements', ['units', 'lengths', 'distances', 'meter'], 'you measure how long things are with them'),
];
export const GROUPS = Object.freeze(GROUP_ROWS.map((g) => Object.freeze({
  id: `groups-${g.things.join('-')}`, kind: 'groups', level: g.level, things: Object.freeze(g.things),
  group: g.group, accept: Object.freeze([...new Set(g.accept)]), cue: g.cue,
})));
/** Every group name the bank knows, for the switch path's other offers and a recogniser's grammar. */
export const GROUP_NAMES = Object.freeze([...new Set(GROUPS.map((g) => g.group))]);

// ---------------------------------------------------------------------------------------
// FINISH THE SENTENCE — the start, every ending that fits (`accept`), two that clearly do not
// (`wrong`, for the switch path's offers), and a meaning hint. NO EXAMPLE IS GIVEN (the ruling): the
// sentence is said and shown with its last word missing, nothing more. An ending that is in neither
// list is NOT marked wrong ("I wash my dog" is a fine sentence): the game says it is not sure.
// ---------------------------------------------------------------------------------------
const F = (level, stem, accept, wrong, cue) => ({ level, stem, accept, wrong, cue });
const FINISH_ROWS = [
  F(1, 'I brush my', ['teeth', 'hair'], ['cloud', 'soup'], 'you do it in the bathroom'),
  F(1, 'I wash my', ['hands', 'face', 'hair', 'feet', 'clothes', 'dishes', 'car', 'body'], ['sky', 'song'], 'you use soap and water'),
  F(1, 'I drink a cup of', ['tea', 'coffee', 'water', 'milk', 'juice', 'cocoa', 'hot chocolate', 'soup'], ['shoes', 'rocks'], 'it is hot or cold and you drink it'),
  F(1, 'I sleep in a', ['bed', 'tent', 'hammock', 'sleeping bag', 'crib'], ['sandwich', 'puddle'], 'it is soft and has a pillow'),
  F(1, 'I eat with a', ['fork', 'spoon', 'knife', 'friend'], ['pillow', 'sock'], 'it is on the table at dinner'),
  F(1, 'Salt and', ['pepper'], ['rain', 'door'], 'it goes on food too'),
  F(1, 'Bread and', ['butter', 'jam', 'cheese', 'water'], ['shoes', 'clock'], 'you spread it on'),
  F(1, 'Ready, set,', ['go'], ['sleep', 'banana'], 'it means start'),
  F(2, 'I read a', ['book', 'newspaper', 'magazine', 'story', 'letter', 'paper', 'poem', 'menu'], ['spoon', 'cloud'], 'it has pages'),
  F(2, 'I write with a', ['pen', 'pencil', 'marker', 'crayon'], ['pillow', 'banana'], 'it makes marks on paper'),
  F(2, 'I open the', ['door', 'window', 'box', 'lid', 'jar', 'curtains', 'letter', 'present', 'gate', 'fridge'], ['sky', 'song'], 'it opens and closes'),
  F(2, 'The grass is', ['green', 'wet', 'long', 'tall', 'short', 'soft', 'cut'], ['purple', 'loud'], 'think of its colour'),
  F(2, 'The sky is', ['blue', 'grey', 'gray', 'cloudy', 'clear', 'dark', 'big', 'bright'], ['square', 'salty'], 'look up'),
  F(2, 'I sit on a', ['chair', 'sofa', 'couch', 'bench', 'stool', 'bed', 'seat'], ['cloud', 'spoon'], 'it has legs and you rest on it'),
  F(2, 'Cats say', ['meow', 'miaow', 'purr'], ['woof', 'moo'], 'it is the sound a cat makes'),
  F(2, 'I wear a hat on my', ['head'], ['foot', 'elbow'], 'it is at the top of you'),
  F(3, 'I put on my', ['coat', 'shoes', 'socks', 'hat', 'glasses', 'shirt', 'jacket', 'gloves', 'boots', 'clothes', 'sweater', 'pants'], ['soup', 'car'], 'you wear it'),
  F(3, 'In the morning I eat', ['breakfast', 'cereal', 'toast', 'eggs', 'oatmeal', 'porridge', 'fruit', 'pancakes'], ['rocks', 'pillows'], 'it is the first meal of the day'),
  F(3, 'When it rains I take an', ['umbrella'], ['onion', 'oven'], 'it keeps you dry'),
  F(3, 'I turn on the', ['light', 'lights', 'tv', 'television', 'radio', 'oven', 'kettle', 'fan', 'heater', 'computer', 'tap', 'lamp'], ['apple', 'cloud'], 'it has a switch'),
  F(3, 'I call my friend on the', ['phone', 'telephone'], ['toaster', 'bed'], 'it rings'),
  F(3, 'A bird can', ['fly', 'sing', 'chirp', 'tweet'], ['drive', 'read'], 'it uses its wings'),
  F(3, 'I keep the milk in the', ['fridge', 'refrigerator'], ['oven', 'drawer'], 'it keeps food cold'),
  F(3, 'At night we see the', ['moon', 'stars'], ['sun', 'rainbow'], 'it is up in the dark sky'),
  F(4, 'I mail a letter at the', ['post office', 'mailbox'], ['bakery', 'beach'], 'it has stamps'),
  F(4, 'We buy bread at the', ['bakery', 'store', 'shop', 'supermarket', 'grocery store', 'market'], ['library', 'dentist'], 'you pay for food there'),
  F(4, 'A doctor works in a', ['hospital', 'clinic', 'office', 'surgery'], ['garage', 'barn'], 'sick people go there'),
  F(4, 'Fish live in', ['water', 'the sea', 'rivers', 'the ocean', 'lakes', 'ponds', 'a tank', 'the water'], ['trees', 'the sky'], 'they swim'),
  F(4, 'To see in the dark I need a', ['light', 'flashlight', 'torch', 'lamp', 'candle'], ['spoon', 'ladder'], 'it shines'),
  F(4, 'I pay at the store with', ['money', 'cash', 'a card', 'coins', 'my card', 'dollars'], ['leaves', 'soup'], 'it is in your wallet'),
  F(4, 'I water the', ['plants', 'flowers', 'garden', 'grass', 'lawn'], ['radio', 'chair'], 'they grow'),
  F(4, 'I wrap a', ['present', 'gift', 'parcel', 'package', 'sandwich'], ['cloud', 'song'], 'it is for a birthday'),
  F(5, 'Better late than', ['never'], ['lunch', 'tuesday'], 'it means not at all'),
  F(5, 'Every cloud has a silver', ['lining'], ['spoon', 'door'], 'it is on the inside of a coat'),
  F(5, 'Actions speak louder than', ['words'], ['shoes', 'trees'], 'it is what you say'),
  F(5, 'The early bird catches the', ['worm'], ['bus', 'ball'], 'it lives in the ground'),
  F(5, 'Don’t count your chickens before they', ['hatch'], ['sing', 'drive'], 'it is how they come out of the egg'),
  F(5, 'Two heads are better than', ['one'], ['ten', 'hats'], 'it is a number'),
  F(5, 'Practice makes', ['perfect'], ['soup', 'noise'], 'it means without a mistake'),
  F(5, 'Where there is a will there is a', ['way'], ['wall', 'dog'], 'it is a road or a path'),
];
const finishId = (stem) => `finish-${stem.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
export const FINISH = Object.freeze(FINISH_ROWS.map((f) => Object.freeze({
  id: finishId(f.stem), kind: 'finish', level: f.level, stem: f.stem,
  accept: Object.freeze(f.accept), wrong: Object.freeze(f.wrong), cue: f.cue,
})));

export const BANKS = Object.freeze({ numbers: NUMBERS, things: THINGS, groups: GROUPS, finish: FINISH });

/** The order a triple is SHOWN in: mixed, and the same every time this question comes up. */
export function shownOrder(id, list) {
  const n = list.length;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const perms = [[0, 1, 2], [2, 0, 1], [1, 2, 0], [2, 1, 0], [0, 2, 1], [1, 0, 2]];
  const p = perms[h % perms.length];
  return n === 3 ? p.map((i) => list[i]) : list.slice();
}
