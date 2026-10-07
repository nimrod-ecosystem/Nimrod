// name_that.js — NAME THAT STATE, ANIMAL OR PERSON (row 2.45).
//
// Mike, 2026-09-30: *"Name that state, animal, person. Person could actually be really good. Get
// everyone to record video messages for it where they say how they know her etc. Maybe even do
// multiple clips or audio with a picture."*
//
// One module with a `game` setting, the way word games holds opposites, rhyming and yes/no: the
// three are the same kind of question ("which one is it?"), answered the same way — said aloud, a
// name tapped, or three names stepped through on a switch ("Is it a cow?", one at a time, is the
// `answerBy` option) — on the shared engine (`quiz_flow.js`).
//
//   STATE   a text clue: its nickname ("the Sunshine State"), hints its region then its capital.
//           No map is downloaded and none is drawn here: fifty outlines are Design's work, and a
//           wrong-looking outline is worse than a good sentence. On Mike's list.
//   ANIMAL  a spoken question ("Which animal says moo?"), hint a fact, then the first letter. The
//           board's drawings have no animals yet, so there are no pictures — on Mike's list too.
//   PERSON  built from the family's OWN recorded messages. A clip plays — a person saying how they
//           know the one watching — and then: "Who is this?" Chat's note (c) on row 2.45: the
//           recording IS the hint and the answer, so this is the messages module with a question
//           on top, and it reads its clips the way `personal.js` does (a media source, the
//           person's own machine, nothing uploaded).
//
// *** PERSON'S MISS FLOW IS GENTLE BY DEFAULT, AND A SETTING. *** Missing a loved one's name can
// hit harder than missing an opposite. Chat asked Mike; until he answers, the best guess is the
// default: a miss says "That was Annie's message. Let's listen again?" — never "incorrect" — and
// Mike's standard flow is one setting away (`personMiss`). The other two games use Mike's flow.
//
// *** NOTHING TALKS OVER THE PERSON ON SCREEN. *** While a clip plays the question is held back
// (and the recogniser is not listening — it would hear the clip), and said when the clip ends.
// A clip that will not play, or stops moving, lets the question through rather than stranding it.
//
// WHERE THE MESSAGES COME FROM, and why this shape:
//   * one video per message, NAMED FOR THE PERSON: "Annie - how we met.mp4", "Annie 2.mp4";
//   * or, on a media agent, one folder per person: "Annie/…", "Uncle Bob/…".
// File names work on every kind of source. Folders-per-person are read only from a media AGENT:
// listing a browser-connected FOLDER's sub-folders means building a listing that releases the
// previous one's files, which would blank a photo or a message already on screen from the same
// folder (see `folder_source.js` on `listFolderNames`). On Mike's list.
// Needs at least two people: a choice of one is not a question. Said plainly when it is not met.
//
// LEVELS, AND EACH PLAYER AT THEIR OWN (row 2.63, Mike 2026-10-07: "Games like Name That, Opposites,
// Rhyming, etc. should have harder levels as well."). Every question has a difficulty in the words
// question packs use (very easy, easy, medium, hard: packs.js DIFFICULTY_LEVELS), and the three games
// are on the shared ladder exactly as Thinking games are (adaptive_play.js: each player's own level,
// kept with the person, "Start this game at", turns). What "harder" is, per game (chat's ideas on the
// row, and what this build can do without pictures it does not have):
//   ANIMAL  very easy: the sound it makes. easy: what it looks like or does (a trunk, a pouch).
//           medium: animals less often met (a bat, a beaver, a chameleon). hard: less common animals and
//           facts (the fastest runner, a mammal that lays eggs), offered beside animals that are easy
//           to mix them up with (`decoys`). Chat's photo, close-up and outline levels wait for pictures.
//   STATE   very easy / easy / medium: how well known the nickname is (the Sunshine State is very easy,
//           the Old Line State is not). hard: named from its CAPITAL instead ("Which state has
//           Montpelier as its capital?"), offered beside states from the same region. Chat's outline
//           and blank-map levels wait for Design's maps.
//   PERSON  two levels, from what the messages already are: seeing them (a video, or a voice with its
//           picture), then hearing them only (the same message with nothing on screen). Chat's older
//           picture and "by relation" levels need data the messages do not carry yet.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import {
  createMediaSourcesClient, resolveListing, listItemNames, resolveItemUrl,
} from '../media_sources.js';
import { flowSettings, answerByField, fill, esc, normalize, shuffle } from '../quiz_flow.js';
import { quizModule, up } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openPersonLadder } from '../adaptive_play.js';
import { difficultyLevel } from '../packs.js';

export const GAME = 'name_that';
export const GAMES = ['animal', 'state', 'person'];
/** Each game's name on the ladder (the `ratings` row): its own, so it never shares a level with another game. */
export const ladderGame = (g) => `name_${g}`;

export const LINES = Object.freeze({
  offerLine: 'Is it {candidate}?',
  hintFirst: 'it starts with {letter}',
  askState: 'Which state is known as {nickname}?',
  hintRegion: 'it is in {region}',
  hintCapital: 'its capital is {capital}',
  explainState: '{state} is {nickname}. Its capital is {capital}.',
  askCapital: 'Which state has {capital} as its capital?',
  explainCapital: '{capital} is the capital of {state}.',
  askPerson: 'Who is this?',
  explainPerson: 'That was {name}.',
  gentleLine: "That was {name}'s message. Let's listen again?",
});
const LINE_LABELS = {
  offerLine: 'Offering one answer', hintFirst: 'Hint: the first letter', askState: 'State: the question',
  hintRegion: 'State: first hint', hintCapital: 'State: second hint', explainState: 'State: the answer',
  askCapital: 'State, from its capital: the question', explainCapital: 'State, from its capital: the answer',
  askPerson: 'Person: the question', explainPerson: 'Person: the answer',
  gentleLine: 'Person: a miss, the gentle way',
};

export const DEFAULTS = Object.freeze({
  // Animal first: it works the moment it is added, with nothing to set up.
  game: 'animal',
  // SAY THE NAME, NOT "IS IT A COW?", BY DEFAULT (Mike's brain-games ruling, 2026-10-02 late, carried
  // here). FOR: naming is the whole game - "Is it Annie?" answers "who is this?" for the person. Every
  // name is in the open vocabulary (all the animals, all fifty states, everybody with a message), and the
  // three names to tap or step through are on screen. AGAINST: somebody who can only nod or shake; one
  // row away, and two Yes / No switches get it whatever this says.
  answerBy: 'choices',
  personMiss: 'gentle',
  sourceId: '',
  album: '',
  // The ladder's own defaults (adaptive_play.js argues each).
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

const SETTINGS = [
  { key: 'game', label: 'Which game', kind: 'choice', default: 'animal', level: 'essential',
    options: [{ value: 'animal', label: 'Name that animal' }, { value: 'state', label: 'Name that state' },
              { value: 'person', label: 'Name that person' }] },
  answerByField({ on: 'choices', example: 'Is it a cow?' }),
  ownScoreField({ level: 'essential', note: 'How many are right (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  { key: 'personMiss', label: 'Name that person: when a name is missed', kind: 'choice', default: 'gentle',
    level: 'standard',
    options: [{ value: 'gentle', label: 'Say whose message it was, and offer to listen again' },
              { value: 'standard', label: 'The usual: "That is incorrect", a hint, and again' }],
    note: 'Missing somebody’s name can feel worse than missing a word, so the default is gentle.' },
  { key: 'sourceId', label: 'Name that person: messages from', kind: 'choice', default: '', level: 'standard',
    emptyLabel: 'No source connected' },
  { key: 'album', label: 'Name that person: folder', kind: 'text', default: '', level: 'standard',
    placeholder: 'The top folder',
    note: 'Name each video after the person in it ("Annie - how we met.mp4"), or on a media agent, give each person a folder.' },
  // Players, "Start this game at", and how the level moves: the same rows every ladder game has.
  ...adaptiveSettings({ ai: false, startLevels: 4 }),
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

const tier = (difficulty, list) => list.map((x) => ({ ...x, difficulty }));
const levelOfWord = (d) => difficultyLevel(d) || 1;
const slug = (s) => normalize(s).replace(/\s+/g, '-');

// ---------------------------------------------------------------------------------------
// THE STATES — nickname, capital, Census region. Text only (see the header).
// ---------------------------------------------------------------------------------------
const NE = 'the Northeast'; const MW = 'the Midwest'; const SO = 'the South'; const WE = 'the West';
const STATE_ROWS = [
  ['Alabama', 'Montgomery', 'the Yellowhammer State', SO], ['Alaska', 'Juneau', 'the Last Frontier', WE],
  ['Arizona', 'Phoenix', 'the Grand Canyon State', WE], ['Arkansas', 'Little Rock', 'the Natural State', SO],
  ['California', 'Sacramento', 'the Golden State', WE], ['Colorado', 'Denver', 'the Centennial State', WE],
  ['Connecticut', 'Hartford', 'the Constitution State', NE], ['Delaware', 'Dover', 'the First State', SO],
  ['Florida', 'Tallahassee', 'the Sunshine State', SO], ['Georgia', 'Atlanta', 'the Peach State', SO],
  ['Hawaii', 'Honolulu', 'the Aloha State', WE], ['Idaho', 'Boise', 'the Gem State', WE],
  ['Illinois', 'Springfield', 'the Prairie State', MW], ['Indiana', 'Indianapolis', 'the Hoosier State', MW],
  ['Iowa', 'Des Moines', 'the Hawkeye State', MW], ['Kansas', 'Topeka', 'the Sunflower State', MW],
  ['Kentucky', 'Frankfort', 'the Bluegrass State', SO], ['Louisiana', 'Baton Rouge', 'the Pelican State', SO],
  ['Maine', 'Augusta', 'the Pine Tree State', NE], ['Maryland', 'Annapolis', 'the Old Line State', SO],
  ['Massachusetts', 'Boston', 'the Bay State', NE], ['Michigan', 'Lansing', 'the Great Lakes State', MW],
  ['Minnesota', 'Saint Paul', 'the North Star State', MW], ['Mississippi', 'Jackson', 'the Magnolia State', SO],
  ['Missouri', 'Jefferson City', 'the Show-Me State', MW], ['Montana', 'Helena', 'the Treasure State', WE],
  ['Nebraska', 'Lincoln', 'the Cornhusker State', MW], ['Nevada', 'Carson City', 'the Silver State', WE],
  ['New Hampshire', 'Concord', 'the Granite State', NE], ['New Jersey', 'Trenton', 'the Garden State', NE],
  ['New Mexico', 'Santa Fe', 'the Land of Enchantment', WE], ['New York', 'Albany', 'the Empire State', NE],
  ['North Carolina', 'Raleigh', 'the Tar Heel State', SO], ['North Dakota', 'Bismarck', 'the Peace Garden State', MW],
  ['Ohio', 'Columbus', 'the Buckeye State', MW], ['Oklahoma', 'Oklahoma City', 'the Sooner State', SO],
  ['Oregon', 'Salem', 'the Beaver State', WE], ['Pennsylvania', 'Harrisburg', 'the Keystone State', NE],
  ['Rhode Island', 'Providence', 'the Ocean State', NE], ['South Carolina', 'Columbia', 'the Palmetto State', SO],
  ['South Dakota', 'Pierre', 'the Mount Rushmore State', MW], ['Tennessee', 'Nashville', 'the Volunteer State', SO],
  ['Texas', 'Austin', 'the Lone Star State', SO], ['Utah', 'Salt Lake City', 'the Beehive State', WE],
  ['Vermont', 'Montpelier', 'the Green Mountain State', NE], ['Virginia', 'Richmond', 'the Old Dominion', SO],
  ['Washington', 'Olympia', 'the Evergreen State', WE], ['West Virginia', 'Charleston', 'the Mountain State', SO],
  ['Wisconsin', 'Madison', 'the Badger State', MW], ['Wyoming', 'Cheyenne', 'the Equality State', WE],
];
// HOW WELL KNOWN EACH NICKNAME IS — a judgement, and only where a state STARTS: the ratings find the real
// order by play. Very easy: nicknames most people have heard, or that name a landmark (Grand Canyon, Mount
// Rushmore, the Great Lakes). Easy: nicknames often heard (on licence plates, in songs). Medium: every other
// state (team nicknames like the Hoosiers are known to sports fans, and nobody else).
const STATE_DIFFICULTY = {
  'very easy': ['Florida', 'Texas', 'California', 'New York', 'Hawaii', 'Arizona', 'Georgia', 'Alaska',
    'South Dakota', 'Michigan'],
  easy: ['New Jersey', 'Washington', 'Kentucky', 'Missouri', 'Pennsylvania', 'Delaware', 'Massachusetts', 'Kansas',
    'Rhode Island', 'Vermont', 'Minnesota', 'Utah', 'New Mexico', 'West Virginia', 'Louisiana', 'Tennessee', 'Ohio',
    'Wisconsin', 'Colorado'],
};
const stateDifficulty = (s) => Object.keys(STATE_DIFFICULTY).find((d) => STATE_DIFFICULTY[d].includes(s)) || 'medium';
// A capital that contains its state's name (Oklahoma City, Indianapolis) would BE the answer, so
// that state's second hint is its first letter instead, and it is never asked from its capital.
const capitalNames = (state, capital) => capital.toLowerCase().includes(state.toLowerCase());
const capitalHint = (state, capital, c) => (capitalNames(state, capital)
  ? fill(c.hintFirst, { letter: state[0] }) : fill(c.hintCapital, { capital }));
export const STATES = Object.freeze(STATE_ROWS.map(([answer, capital, nickname, region]) => Object.freeze({
  id: `state:${slug(answer)}`, kind: 'nickname', answer, capital, nickname, region,
  difficulty: stateDifficulty(answer), level: levelOfWord(stateDifficulty(answer)),
  hints: Object.freeze([fill(LINES.hintRegion, { region }), capitalHint(answer, capital, LINES)]),
})));
// THE HARD LEVEL: the state from its capital (the header).
export const STATE_CAPITALS = Object.freeze(STATE_ROWS.filter(([answer, capital]) => !capitalNames(answer, capital))
  .map(([answer, capital, nickname, region]) => Object.freeze({
    id: `capital:${slug(answer)}`, kind: 'capital', answer, capital, nickname, region,
    difficulty: 'hard', level: levelOfWord('hard'),
    hints: Object.freeze([fill(LINES.hintRegion, { region }), fill(LINES.hintFirst, { letter: answer[0] })]),
  })));
export const STATE_BANK = Object.freeze([...STATES, ...STATE_CAPITALS]);

// ---------------------------------------------------------------------------------------
// THE ANIMALS — a question, a fact for the hint, and the sentence the answer is said in. `decoys`
// (optional): the two other animals offered beside it, chosen to be easy to mix up with it; without
// them, two at random.
// ---------------------------------------------------------------------------------------
export const ANIMALS = Object.freeze([
  ...tier('very easy', [
    { answer: 'cow', a: 'a cow', ask: 'Which animal says moo?', hint: 'it gives us milk', explain: 'A cow says moo.' },
    { answer: 'dog', a: 'a dog', ask: 'Which animal says woof?', hint: 'it wags its tail', explain: 'A dog says woof.' },
    { answer: 'cat', a: 'a cat', ask: 'Which animal says meow?', hint: 'it purrs when it is happy', explain: 'A cat says meow.' },
    { answer: 'duck', a: 'a duck', ask: 'Which animal says quack?', hint: 'it swims on ponds', explain: 'A duck says quack.' },
    { answer: 'pig', a: 'a pig', ask: 'Which animal says oink?', hint: 'it rolls in the mud', explain: 'A pig says oink.' },
    { answer: 'sheep', a: 'a sheep', ask: 'Which animal says baa?', hint: 'its wool keeps us warm', explain: 'A sheep says baa.' },
    { answer: 'horse', a: 'a horse', ask: 'Which animal says neigh?', hint: 'people ride it', explain: 'A horse says neigh.' },
    { answer: 'rooster', a: 'a rooster', ask: 'Which animal says cock-a-doodle-doo?', hint: 'it wakes the farm up in the morning', explain: 'A rooster says cock-a-doodle-doo.' },
    { answer: 'owl', a: 'an owl', ask: 'Which animal says hoot?', hint: 'it is awake all night', explain: 'An owl says hoot.' },
    { answer: 'lion', a: 'a lion', ask: 'Which animal roars?', hint: 'it has a big mane', explain: 'A lion roars.' },
    { answer: 'frog', a: 'a frog', ask: 'Which animal says ribbit?', hint: 'it hops and lives near water', explain: 'A frog says ribbit.' },
    { answer: 'bee', a: 'a bee', ask: 'Which animal buzzes?', hint: 'it makes honey', explain: 'A bee buzzes.' },
    { answer: 'snake', a: 'a snake', ask: 'Which animal hisses?', hint: 'it has no legs', explain: 'A snake hisses.' },
    { answer: 'donkey', a: 'a donkey', ask: 'Which animal says hee-haw?', hint: 'it has long ears', explain: 'A donkey says hee-haw.' },
    { answer: 'mouse', a: 'a mouse', ask: 'Which animal squeaks?', hint: 'it is small and likes cheese', explain: 'A mouse squeaks.' },
  ]),
  ...tier('easy', [
    { answer: 'elephant', a: 'an elephant', ask: 'Which animal has a long trunk?', hint: 'it is the biggest animal on land', explain: 'An elephant has a long trunk.' },
    { answer: 'giraffe', a: 'a giraffe', ask: 'Which animal has a very long neck?', hint: 'it eats leaves from the tops of trees', explain: 'A giraffe has a very long neck.' },
    { answer: 'zebra', a: 'a zebra', ask: 'Which animal has black and white stripes?', hint: 'it looks like a horse', explain: 'A zebra has black and white stripes.' },
    { answer: 'kangaroo', a: 'a kangaroo', ask: 'Which animal hops and carries its baby in a pouch?', hint: 'it lives in Australia', explain: 'A kangaroo carries its baby in a pouch.' },
    { answer: 'turtle', a: 'a turtle', ask: 'Which animal carries its home on its back?', hint: 'it is very slow', explain: 'A turtle carries its shell on its back.' },
    { answer: 'penguin', a: 'a penguin', ask: 'Which bird cannot fly but swims very well?', hint: 'it lives where it is very cold', explain: 'A penguin swims but cannot fly.' },
    { answer: 'monkey', a: 'a monkey', ask: 'Which animal swings from trees and loves bananas?', hint: 'it has a long tail', explain: 'A monkey swings from trees.' },
    { answer: 'rabbit', a: 'a rabbit', ask: 'Which animal has long ears, a fluffy tail and loves carrots?', hint: 'it lives in a burrow', explain: 'A rabbit has long ears and a fluffy tail.' },
    { answer: 'camel', a: 'a camel', ask: 'Which animal has a hump and lives in the desert?', hint: 'it can go a long time without water', explain: 'A camel has a hump.' },
  ]),
  ...tier('medium', [
    { answer: 'bat', a: 'a bat', ask: 'Which animal sleeps hanging upside down?', hint: 'it flies at night', explain: 'A bat sleeps hanging upside down.', decoys: ['owl', 'monkey'] },
    { answer: 'panda', a: 'a panda', ask: 'Which black and white bear eats bamboo?', hint: 'it comes from China', explain: 'A panda eats bamboo.', decoys: ['zebra', 'penguin'] },
    { answer: 'octopus', a: 'an octopus', ask: 'Which sea animal has eight arms?', hint: 'it can squirt ink', explain: 'An octopus has eight arms.', decoys: ['turtle', 'penguin'] },
    { answer: 'chameleon', a: 'a chameleon', ask: 'Which lizard can change its colour?', hint: 'its eyes can look two ways at once', explain: 'A chameleon can change colour.', decoys: ['snake', 'frog'] },
    { answer: 'beaver', a: 'a beaver', ask: 'Which animal builds dams across rivers?', hint: 'it has big front teeth and a flat tail', explain: 'A beaver builds dams.', decoys: ['rabbit', 'squirrel'] },
    { answer: 'squirrel', a: 'a squirrel', ask: 'Which animal has a bushy tail and buries nuts?', hint: 'it climbs the trees in the park', explain: 'A squirrel buries nuts.', decoys: ['rabbit', 'mouse'] },
    { answer: 'hedgehog', a: 'a hedgehog', ask: 'Which small animal is covered in spines?', hint: 'it rolls into a ball', explain: 'A hedgehog is covered in spines.', decoys: ['mouse', 'turtle'] },
    { answer: 'eagle', a: 'an eagle', ask: 'Which big bird with a white head is a symbol of the United States?', hint: 'it catches fish with its sharp claws', explain: 'The bald eagle is a symbol of the United States.', decoys: ['owl', 'rooster'] },
  ]),
  ...tier('hard', [
    { answer: 'cheetah', a: 'a cheetah', ask: 'Which animal is the fastest runner on land?', hint: 'it is a big spotted cat', explain: 'A cheetah is the fastest animal on land.', decoys: ['lion', 'horse'] },
    { answer: 'platypus', a: 'a platypus', ask: 'Which furry animal has a bill like a bird and lays eggs?', hint: 'it swims in rivers in Australia', explain: 'A platypus has a bill and lays eggs.', decoys: ['beaver', 'duck'] },
    { answer: 'whale', a: 'a whale', ask: 'Which animal is the biggest that has ever lived?', hint: 'it lives in the sea and breathes air', explain: 'The blue whale is the biggest animal ever known.', decoys: ['elephant', 'octopus'] },
    { answer: 'sloth', a: 'a sloth', ask: 'Which very slow animal hangs from the trees of the rainforest?', hint: 'it comes down to the ground about once a week', explain: 'A sloth moves very slowly.', decoys: ['monkey', 'koala'] },
    { answer: 'flamingo', a: 'a flamingo', ask: 'Which pink bird often stands on one leg?', hint: 'its colour comes from what it eats', explain: 'A flamingo is pink and stands on one leg.', decoys: ['ostrich', 'penguin'] },
    { answer: 'koala', a: 'a koala', ask: 'Which animal from Australia lives on eucalyptus leaves?', hint: 'it sleeps most of the day in a tree', explain: 'A koala eats eucalyptus leaves.', decoys: ['kangaroo', 'sloth'] },
    { answer: 'ostrich', a: 'an ostrich', ask: 'Which is the biggest bird, and cannot fly?', hint: 'it runs very fast on two long legs', explain: 'An ostrich is the biggest bird, and it cannot fly.', decoys: ['penguin', 'flamingo'] },
    { answer: 'hummingbird', a: 'a hummingbird', ask: 'Which tiny bird can fly backwards?', hint: 'it drinks nectar from flowers', explain: 'A hummingbird can fly backwards.', decoys: ['bee', 'bat'] },
  ]),
].map((a) => Object.freeze({ ...a, id: `animal:${slug(a.answer)}`, level: levelOfWord(a.difficulty) })));
const ANIMAL_A = Object.fromEntries(ANIMALS.map((a) => [a.answer, a.a]));
export const ANIMAL_BANK = ANIMALS;

// ---------------------------------------------------------------------------------------
// NAMES — matching what was heard to one of them
// ---------------------------------------------------------------------------------------

/** "Annie - how we met.mp4" -> "Annie"; "Uncle Bob 2.mp4" -> "Uncle Bob"; "carol_smith.webm" -> "carol smith". */
export function personFromFileName(name) {
  const base = String(name || '').split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const dash = base.split(/\s+-\s+/)[0];
  return dash.replace(/[\s-]*\d+$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * The one name in `names` that `text` means, or null. The whole name said anywhere in the sentence
 * wins (longest first, so "New York" beats "York"); otherwise a PART of exactly one name ("Annie"
 * for "Aunt Annie") — a part that fits two people means nobody in particular.
 */
export function matchName(text, names) {
  const t = ` ${normalize(text)} `;
  if (!t.trim()) return null;
  const byLen = [...names].sort((a, b) => normalize(b).length - normalize(a).length);
  const whole = byLen.find((n) => normalize(n) && t.includes(` ${normalize(n)} `));
  if (whole) return whole;
  const part = names.filter((n) => ` ${normalize(n)} `.includes(t));
  return part.length === 1 ? part[0] : null;
}

function pickOthers(answer, pool, rand, n = 2) {
  return shuffle(pool.filter((x) => normalize(x) !== normalize(answer)), rand).slice(0, n);
}

// Everything but `items` (the host deals: this module off its ladder, Quiz mix off each player's).
function nameGame({ names, ask, hint, explain, offerName = (x) => x, others = null }) {
  return {
    ask,
    candidates: (it, c, rand) => shuffle([it.answer, ...(others ? others(it, rand) : pickOthers(it.answer, names(), rand))], rand),
    offer: (it, cand, c) => fill(c.offerLine, { candidate: offerName(cand) }),
    judge(it, v) {
      const s = normalize(v);
      if (!s) return null;
      if (s === normalize(it.answer)) return true;
      const m = matchName(v, names());
      return m ? normalize(m) === normalize(it.answer) : false;
    },
    hint,
    answer: (it) => it.answer,
    explain,
    vocab: () => names().map((n) => normalize(n)),
    fromVoice: (it, { text }) => (text ? { value: matchName(text, names()) || text } : null),
  };
}

const firstLetter = (it, c) => fill(c.hintFirst, { letter: up(it.answer[0]) });
const ANIMAL_NAMES = ANIMALS.map((a) => a.answer);
const STATE_NAMES = STATES.map((s) => s.answer);

export const ANIMAL_ADAPTER = Object.freeze(nameGame({
  names: () => ANIMAL_NAMES,
  ask: (it) => it.ask,
  hint: (it, n, c) => (n === 1 ? it.hint : n === 2 ? firstLetter(it, c) : ''),
  explain: (it) => it.explain,
  offerName: (x) => ANIMAL_A[x] || x,
  // The item's own decoys when it has two that are real animals here; else two at random.
  others(it, rand) {
    const d = (it.decoys || []).filter((x) => ANIMAL_NAMES.includes(x) && x !== it.answer);
    return d.length >= 2 ? shuffle(d, rand).slice(0, 2) : pickOthers(it.answer, ANIMAL_NAMES, rand);
  },
}));

export const STATE_ADAPTER = Object.freeze(nameGame({
  names: () => STATE_NAMES,
  ask: (it, c) => (it.kind === 'capital' ? fill(c.askCapital, { capital: it.capital }) : fill(c.askState, { nickname: it.nickname })),
  hint: (it, n, c) => {
    if (n === 1) return fill(c.hintRegion, { region: it.region });
    if (n !== 2) return '';
    return it.kind === 'capital' ? firstLetter(it, c) : capitalHint(it.answer, it.capital, c);
  },
  explain: (it, answer, c) => (it.kind === 'capital' ? fill(c.explainCapital, { state: it.answer, capital: it.capital })
    : fill(c.explainState, { state: it.answer, nickname: it.nickname, capital: it.capital })),
  // From its capital (the hard level): the other two from the same region, which is what makes it hard.
  others(it, rand) {
    const near = it.kind === 'capital' ? STATES.filter((s) => s.region === it.region).map((s) => s.answer) : [];
    return near.length > 2 ? pickOthers(it.answer, near, rand) : pickOthers(it.answer, STATE_NAMES, rand);
  },
}));
/** The clue card: the nickname, or (asked from its capital) the capital. */
export const stateCardHtml = (it) => `<p class="qz-card" data-clue>${esc(it.kind === 'capital' ? it.capital : it.nickname)}</p>`;

// ---------------------------------------------------------------------------------------
// NAME THAT PERSON — the messages, the clip, and the question, for any host (this module, and Quiz
// mix, which deals each player their own people). One per set of people.
// ---------------------------------------------------------------------------------------

// What the screen says when person has nothing to ask. For whoever sets the screen up — shown,
// never spoken to the room.
const NO_SOURCE = 'Name that person plays recorded messages from a media source, and none is connected yet. '
  + 'Connect one in Media / Sources.';
const MANY_SOURCES = 'Choose which media source holds the messages, in this game’s settings.';
const TOO_FEW = 'Name that person needs recorded messages from at least two people. Name each video after '
  + 'the person in it ("Annie - how we met.mp4"), or on a media agent, give each person a folder.';
const UNREADABLE = 'Could not read the messages from that media source. It may be switched off or disconnected.';

// A clip that has not moved for this long is treated as finished, so the question is never
// stranded behind a frozen frame. The same number `personal.js` uses, for the same reason.
const STALL_MS = 20000;

// THE PERSON LEVELS (the header): 1 sees them, 2 hears them only.
export const PERSON_SEEN = 1;
export const PERSON_VOICE = 2;

/**
 * A short fixed code for a name (FNV-1a), for the question ids on the ladder. *** NOT THE NAME ITSELF: ***
 * the ladder's rows are saved off this screen, and the people in somebody's messages are theirs, not the
 * ladder's. Two names with the same code would share a question's rating, which is harmless.
 */
export function nameCode(name) {
  let h = 0x811c9dc5;
  for (const ch of normalize(name)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

function defaultPlayClip(host, clip, h) {
  const doc = host.ownerDocument || document;
  host.innerHTML = '';
  // VOICE ONLY (the harder level): the same message as sound, nothing on screen but the sound mark.
  // A video file plays as sound in an <audio> element too.
  const tag = clip.kind === 'audio' || clip.voiceOnly ? 'audio' : 'video';
  if (tag === 'audio') {
    if (clip.pictureUrl && !clip.voiceOnly) {
      const img = doc.createElement('img');
      img.src = clip.pictureUrl;
      img.alt = '';
      host.append(img);
    } else {
      const s = doc.createElement('span');
      s.className = 'qz-sound';
      s.textContent = '♪';
      host.append(s);
    }
  }
  const el = doc.createElement(tag);
  el.src = clip.url;
  el.controls = false;
  el.playsInline = true;
  el.autoplay = true;
  el.preload = 'auto';
  if (tag === 'audio') el.hidden = true;
  let done = false;
  const finish = (fn) => () => { if (done) return; done = true; fn?.(); };
  el.addEventListener('ended', finish(h.onEnded));
  el.addEventListener('error', finish(() => h.onError?.(new Error('clip error'))));
  el.addEventListener('timeupdate', () => h.onProgress?.());
  host.append(el);
  // A blocked autoplay: try again muted, and say so — the same rung `personal.js` uses. A message
  // with no voice is a loss; a frozen first frame is a worse one.
  el.play?.().catch((err) => {
    const blocked = err && (err.name === 'NotAllowedError' || /gesture|user activation/i.test(String(err.message || '')));
    if (!blocked || done) return;
    el.muted = true;
    h.onMuted?.();
    el.play?.().catch(() => finish(() => h.onError?.(err))());
  });
  return {
    stop() {
      done = true;
      try { el.pause(); } catch { /* gone */ }
      el.removeAttribute('src');
      try { el.load?.(); } catch { /* gone */ }
      host.innerHTML = '';
    },
  };
}

function playable(files) {
  const media = files.filter((f) => f && (f.kind === 'video' || f.kind === 'audio'));
  const images = files.filter((f) => f && f.kind === 'image');
  const base = (p) => String(p || '').replace(/\.[^.]+$/, '').toLowerCase();
  return media.map((f) => ({
    path: f.path, kind: f.kind, name: f.name || String(f.path || '').split('/').pop(),
    picturePath: f.kind === 'audio' ? (images.find((i) => base(i.path) === base(f.path))?.path || null) : null,
  }));
}

/**
 * ONE SET OF PEOPLE: whose messages, the clip on screen, and the person question.
 *   ctx         the panel's ctx (`sources`, `listItemNames`, `resolveListing`, `resolveItemUrl`, `playClip`,
 *               `setTimer` / `clearTimer` may be injected; `mount` for the document)
 *   personId    whose media sources (null: the screen's, as `createMediaSourcesClient` reads it)
 *   getApi()    quiz_view.js's api (release / reannounce / render / dropHeld), or null
 *   onPeople()  the people changed (loading, loaded, none)
 */
export function createPersonGame(ctx, { personId = ctx?.personId || null, getApi = () => null, onPeople = () => {} } = {}) {
  let people = null;          // null: not loaded; [] and up: loaded
  let bank = [];
  let emptyText = '';
  let knownSources = [];
  let source = null;
  let loadSeq = 0;
  let loadedRef = null;
  let clip = null;            // the clip chosen for the current question
  let player = null;
  let playing = false;
  let muted = false;
  let stallTimer = null;
  let urls = [];
  let mediaHost = null;
  let dead = false;

  const client = () => (ctx.sources && (personId || null) === (ctx.personId || null) ? ctx.sources
    : createMediaSourcesClient({ user: ctx.user, cache: true, personId: personId || null }));
  const listNames = ctx.listItemNames || listItemNames;
  const listAlbums = ctx.resolveListing || resolveListing;
  const itemUrl = ctx.resolveItemUrl || resolveItemUrl;
  const playClip = ctx.playClip || defaultPlayClip;
  const tell = () => { try { onPeople(); } catch (err) { console.error('name_that: people', err); } };

  async function discover(src, album) {
    const byKey = new Map();
    const add = (name, clips) => {
      const key = normalize(name);
      if (!key || !clips.length) return;
      if (!byKey.has(key)) byKey.set(key, { name: String(name).trim(), clips: [] });
      byKey.get(key).clips.push(...clips);
    };
    const flat = await listNames(src, album);
    for (const c of playable(flat)) add(personFromFileName(c.name), [c]);
    let albums = [];
    if (src.kind !== 'folder') {
      try { albums = (await listAlbums(src, album)).albums || []; } catch { albums = []; }
    }
    for (const a of albums) {
      const sub = await listNames(src, album ? `${album}/${a}` : a);
      add(String(a).split('/').pop(), playable(sub));
    }
    return [...byKey.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  // THE LADDER'S QUESTIONS from the people: each person seen (a video, or a voice with its picture), and each
  // person heard only (any of their messages, as sound). A person whose messages are all sound with no picture
  // has only the second.
  const faced = (c) => c.kind === 'video' || (c.kind === 'audio' && !!c.picturePath);
  function buildBank() {
    bank = Object.freeze((people || []).flatMap((p) => {
      const code = nameCode(p.name);
      const seen = p.clips.filter(faced);
      const out = [];
      if (seen.length) out.push(Object.freeze({ id: `person:${code}:${PERSON_SEEN}`, level: PERSON_SEEN, answer: p.name, clips: seen, voiceOnly: false }));
      out.push(Object.freeze({ id: `person:${code}:${PERSON_VOICE}`, level: PERSON_VOICE, answer: p.name, clips: p.clips, voiceOnly: true }));
      return out;
    }));
  }

  async function loadPeople(cfg) {
    const seq = ++loadSeq;
    people = null;
    buildBank();
    tell();
    let found = [];
    try {
      const sources = await client().list();
      if (seq !== loadSeq || dead) return;
      knownSources = sources || [];
      source = cfg.sourceId ? knownSources.find((s) => s.id === cfg.sourceId) || null
        : (knownSources.length === 1 ? knownSources[0] : null);
      if (!source) { emptyText = knownSources.length > 1 ? MANY_SOURCES : NO_SOURCE; people = []; buildBank(); tell(); return; }
      found = await discover(source, cfg.album || '');
    } catch (err) {
      if (seq !== loadSeq || dead) return;
      console.error('name_that: messages', err);
      emptyText = UNREADABLE; people = []; buildBank(); tell(); return;
    }
    if (seq !== loadSeq || dead) return;
    people = found;
    emptyText = found.length < 2 ? TOO_FEW : '';
    buildBank();
    tell();
  }
  const names = () => (people || []).map((p) => p.name);

  // ---- the clip ----
  function clearStall() {
    if (stallTimer == null) return;
    const clr = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (id) => clearTimeout(id);
    try { clr(stallTimer); } catch { /* gone */ }
    stallTimer = null;
  }
  // Stopped without finishing (hidden, or another game dealt): whatever was waiting to be said
  // after the clip is dropped, not said later to a panel nobody is looking at.
  function abandonClip() { if (!playing) return; playing = false; stopClip(); getApi()?.dropHeld(); }
  function armStall() {
    clearStall();
    const set = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    stallTimer = set(() => { stallTimer = null; finishClip(); }, STALL_MS);
  }
  function releaseUrls() { for (const u of urls) { try { u.release?.(); } catch { /* gone */ } } urls = []; }
  function stopClip() {
    clearStall();
    try { player?.stop?.(); } catch { /* gone */ }
    player = null;
    releaseUrls();
  }
  function finishClip() {
    if (!playing) return;
    playing = false;
    stopClip();
    getApi()?.release();
  }
  function host() {
    if (!mediaHost) {
      mediaHost = (ctx.mount?.ownerDocument || document).createElement('div');
      mediaHost.className = 'qz-media';
      mediaHost.dataset.media = '';
    }
    return mediaHost;
  }
  async function startClip(c) {
    stopClip();
    if (!c || !source) { if (playing) finishClip(); return; }
    playing = true;
    muted = false;
    getApi()?.reannounce();
    getApi()?.render();
    const mine = c;
    try {
      const main = await itemUrl(source, c.path);
      if (main) urls.push(main);
      const pic = c.picturePath && !c.voiceOnly ? await itemUrl(source, c.picturePath) : null;
      if (pic) urls.push(pic);
      if (dead || clip !== mine || !playing) { releaseUrls(); return; }
      armStall();
      player = playClip(host(), { ...c, url: main?.url, pictureUrl: pic?.url || null }, {
        onEnded: () => { if (clip === mine) finishClip(); },
        onError: () => { if (clip === mine) finishClip(); },
        onProgress: () => { if (clip === mine && playing) armStall(); },
        onMuted: () => { muted = true; getApi()?.render(); },
      });
    } catch (err) {
      console.error('name_that: clip', err);
      if (clip === mine) finishClip();
    }
  }

  // The person question, everything but `items` (the host deals off the ladder's `bank`).
  const adapter = {
    ...nameGame({
      names,
      ask: (it, c) => c.askPerson,
      hint: (it, n, c) => (n === 1 ? firstLetter(it, c) : ''),
      explain: (it, answer, c) => fill(c.explainPerson, { name: it.answer }),
    }),
    empty: () => emptyText,
    canReplay: true,
    missStyle: (c) => (c.personMiss === 'standard' ? 'standard' : 'gentle'),
    gentle: (it, c) => fill(c.gentleLine, { name: it.answer }),
  };

  return {
    adapter,
    /** The ladder's questions from these people (see buildBank). */
    bank: () => bank,
    /** null while loading; else the people found (each { name, clips }). */
    people: () => people,
    loading: () => people == null,
    /** At least two people: a choice of one is not a question. */
    enough: () => Array.isArray(people) && people.length >= 2,
    emptyText: () => emptyText,
    /** Read the people from `cfg.sourceId` / `cfg.album` ('' / '': the one connected source, its top folder). */
    load(cfg = {}) {
      const ref = `${cfg.sourceId || ''}|${cfg.album || ''}`;
      if (ref === loadedRef) return;
      loadedRef = ref;
      loadPeople({ sourceId: cfg.sourceId || '', album: cfg.album || '' });
    },
    /** A question was dealt: its clip plays, the question held back until it ends. Not a person question: stop. */
    onDeal(item, rand = Math.random) {
      if (!item || !Array.isArray(item.clips)) { abandonClip(); return; }
      const list = item.clips;
      const picked = list.length ? list[Math.floor(rand() * list.length) % list.length] : null;
      clip = picked ? { ...picked, voiceOnly: !!item.voiceOnly } : null;
      startClip(clip);
    },
    replay() { if (clip) startClip(clip); },
    speechGate: () => playing,
    away: () => abandonClip(),
    /** The left of the panel while a person question is up: the clip (never rebuilt, or it would restart). */
    leftEl(el, s) {
      if (el.dataset.kind !== 'person') { el.innerHTML = ''; el.dataset.kind = 'person'; }
      const h = host();
      if (h.parentNode !== el) el.append(h);
      let note = el.querySelector('[data-muted]');
      if (muted && !note) {
        note = (el.ownerDocument || document).createElement('p');
        note.className = 'qz-note';
        note.dataset.muted = '';
        note.textContent = 'Sound is off for this message — this screen blocked it.';
        el.append(note);
      } else if (!muted && note) note.remove();
      const q = s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss';
      return !!s.item && (q || playing);
    },
    // Shown again mid-question: it plays again from the start, and the question follows it as before.
    onShow(api) {
      const s = api.engine.snapshot();
      if (s.phase === 'asking' && clip && !playing && Array.isArray(s.item?.clips)) {
        api.dropHeld();
        startClip(clip);                // sets `playing` at once, so the question below is held
        api.engine.press('repeat');
      }
    },
    settingsChoices: () => ({
      sourceId: knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
    }),
    destroy() { dead = true; playing = false; stopClip(); },
  };
}

/** Each game's questions for the ladder; `persons` is a createPersonGame (or null: no people). */
export function nameBank(game, persons = null) {
  if (game === ladderGame('animal')) return ANIMAL_BANK;
  if (game === ladderGame('state')) return STATE_BANK;
  if (game === ladderGame('person')) return persons ? persons.bank() : [];
  return [];
}

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------
function factory(ctx) {
  const rand = ctx.rand || Math.random;
  let cfgNow = { ...DEFAULTS };
  let api = null;
  let leftHtml = null;
  const persons = createPersonGame(ctx, { getApi: () => api, onPeople: () => api?.engine.refresh() });

  // THE LADDER, opened exactly as Thinking games opens it (adaptive_play.js openPersonLadder): the screen's
  // person's level kept with them, their own start in this game, else their usual one.
  const ladderRows = openPersonLadder(ctx, { gameKey: GAME, onChange: () => api?.render() });
  const session = createAdaptiveSession({
    cfg: () => cfgNow,
    bankFor: (g) => nameBank(g, persons),
    store: ladderRows.store,
    rand,
    now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
    personId: () => ctx.personId || null,
    startFor: ladderRows.startFor, startMark: ladderRows.startMark,
    playersHost: ladderRows.playersHost,
    onChange: () => api?.render(),
  });
  ladderRows.attach(session);

  const deal = (g) => { const q = session.deal(ladderGame(g)); return q ? [q] : []; };
  // "Ann, your turn. " in front of the question when there are two or more players.
  const withTurn = (A) => ({ ...A, ask: (it, c) => session.askPrefix() + A.ask(it, c) });
  const games = {
    animal: { ...withTurn(ANIMAL_ADAPTER), items: () => deal('animal') },
    state: { ...withTurn(STATE_ADAPTER), items: () => deal('state') },
    person: {
      ...withTurn(persons.adapter),
      items: () => {
        if (persons.loading()) return null;
        if (!persons.enough()) return [];
        return deal('person');
      },
    },
  };

  const view = {
    init(a) { api = a; },
    onConfig(cfg) {
      cfgNow = cfg;
      ladderRows.onConfig(cfg);
      if (cfg.game === 'person') persons.load(cfg);
    },
    onDeal(item, a) {
      if (a.engine.game() !== 'person') { persons.away(); return; }
      persons.onDeal(item, a.rand);
    },
    onReplay() { persons.replay(); },
    speechGate: () => persons.speechGate(),
    leftEl(el, s, cfg) {
      if (s.game === 'person') { leftHtml = null; return persons.leftEl(el, s); }
      if (el.dataset.kind === 'person') { el.innerHTML = ''; delete el.dataset.kind; }
      const q = s.item && (s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss');
      const html = q && s.game === 'state' ? stateCardHtml(s.item) : '';
      if (html !== leftHtml) { el.innerHTML = html; leftHtml = html; }
      return !!html;
    },
    turnHtml: (s) => session.turnHtml(s, s.game ? ladderGame(s.game) : null),
    onResult: (r) => { session.record(r); },
    allowAward: () => session.allowAward(),
    scoreDetail: (s) => session.scoreDetail() || (s.asked ? `${s.rightCount} of ${s.asked}` : ''),
    scoreLine: (s) => session.scoreDetail() || `${s.rightCount} right so far.`,
    pointNote: (game, item, answer) => (game === 'person' ? 'name that person: right' : `name that ${game}: ${answer}`),
    settingsChoices: () => persons.settingsChoices(),
    destroy() { persons.destroy(); session.destroy(); ladderRows.destroy(); },
    // Hidden: the clip stops (a message nobody is watching is a message missed). Shown again
    // mid-question: it plays again from the start, and the question follows it as before.
    onHide() { persons.away(); },
    onShow(a) { if (a.engine.snapshot().game === 'person') persons.onShow(a); },
  };

  const inner = quizModule({ type: GAME, title: 'Name that', scoreLabel: 'Name that: right answers',
    games, defaults: DEFAULTS, gameKey: 'game', view })(ctx);
  // The test escape hatch: the ladder, the same object the module plays with.
  inner.__session = session;
  return inner;
}

registerModule(
  { type: GAME, title: 'Name that', core: 'new',
    description: 'Name that animal, state, or person. Person plays the family’s own recorded '
      + 'messages and asks who it is. Each player gets questions at their own level. Answer with a '
      + 'switch, the screen, or aloud.',
    // `local`: the animals and states are built in; the person game's clips come from a media
    // source on the person's own machine, exactly like Personal videos.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  factory,
);
