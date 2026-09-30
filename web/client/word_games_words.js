// word_games_words.js — THE WORDS BEHIND THE VOICE WORD GAMES (row 2.31), and the one rule
// that makes a rhyme game honest: `rhymes(a, b)`.
//
// Three small, hand-curated lists (Opposites, Rhyming, Yes/No) and a pronunciation table. No
// downloads, nothing fetched: everything a round needs is in this file, so a game works on a
// screen with no network at all.
//
// ---------------------------------------------------------------------------------------
// WHY A PRONUNCIATION TABLE AND NOT A LIST OF RIGHT ANSWERS
// ---------------------------------------------------------------------------------------
//
// Rhyming has many right answers. A fixed "rhymes with GO: no, so, snow" list marks "toe" wrong
// the day somebody thinks of it, and telling a person a right answer is wrong is the worst
// thing this game can do. So a rhyme is DECIDED, not listed: two words rhyme when their sounds
// match from the last stressed vowel to the end (g-OH, n-OH), and are not the same sound
// altogether (here / hear is the same word to the ear, not a rhyme).
//
// The table is ARPAbet with stress digits — the notation of the CMU Pronouncing Dictionary —
// written by hand for the words these games use (about 200). *** THE UPGRADE IS THE CMU
// PRONOUNCING DICTIONARY ITSELF *** (~134,000 words, the same notation, so `rhymes` does not
// change). Its licence has NOT been checked here [training knowledge: a permissive BSD-style
// licence]; check it before shipping the file.
//
// A word NOT in the table is not judged. `rhymes` returns null for it, and the game says it does
// not know that word rather than calling it wrong (see `unknownWordLine` in the module).
//
// ---------------------------------------------------------------------------------------
// PICTURES
// ---------------------------------------------------------------------------------------
//
// A word gets a picture where the AAC board already draws it (`aac_symbols.js`, 55 words); any
// other word is shown as the word alone. `hasPicture` is the one test for that, so the lists
// below never promise a picture that is not there.

import { SYMBOLS } from './aac_symbols.js';

export const hasPicture = (word) => !!(word && Object.prototype.hasOwnProperty.call(SYMBOLS, word));

// ---------------------------------------------------------------------------------------
// THE PRONUNCIATION TABLE
// ---------------------------------------------------------------------------------------
// One `word: PHONEMES` per entry, grouped roughly by the sound they end in so a gap is easy to
// see. Homophones (here/hear, no/know, i/eye, wait/weight) are in on purpose: they are what
// proves the "same sound is not a rhyme" rule works.
const TABLE_TEXT = `
go:G OW1|no:N OW1|know:N OW1|so:S OW1|toe:T OW1|snow:S N OW1|show:SH OW1|slow:S L OW1|grow:G R OW1|row:R OW1|low:L OW1
hot:HH AA1 T|not:N AA1 T|pot:P AA1 T|dot:D AA1 T|lot:L AA1 T|spot:S P AA1 T|got:G AA1 T
what:W AH1 T|but:B AH1 T|cut:K AH1 T|nut:N AH1 T
cold:K OW1 L D|old:OW1 L D|gold:G OW1 L D|told:T OW1 L D|hold:HH OW1 L D|fold:F OW1 L D
stop:S T AA1 P|top:T AA1 P|hop:HH AA1 P|mop:M AA1 P|shop:SH AA1 P|drop:D R AA1 P
wait:W EY1 T|weight:W EY1 T|late:L EY1 T|gate:G EY1 T|eight:EY1 T|plate:P L EY1 T|great:G R EY1 T
pain:P EY1 N|rain:R EY1 N|train:T R EY1 N|chain:CH EY1 N|plane:P L EY1 N
more:M AO1 R|door:D AO1 R|four:F AO1 R|floor:F L AO1 R|store:S T AO1 R
up:AH1 P|cup:K AH1 P|pup:P AH1 P
down:D AW1 N|town:T AW1 N|brown:B R AW1 N|clown:K L AW1 N|crown:K R AW1 N
in:IH1 N|pin:P IH1 N|win:W IH1 N|tin:T IH1 N|chin:CH IH1 N|fin:F IH1 N
out:AW1 T|shout:SH AW1 T|about:AH0 B AW1 T|scout:S K AW1 T
here:HH IH1 R|hear:HH IH1 R|near:N IH1 R|ear:IH1 R|dear:D IH1 R|fear:F IH1 R
there:DH EH1 R|where:W EH1 R|chair:CH EH1 R|hair:HH EH1 R|bear:B EH1 R|pear:P EH1 R
look:L UH1 K|book:B UH1 K|cook:K UH1 K|hook:HH UH1 K
like:L AY1 K|bike:B AY1 K|hike:HH AY1 K
get:G EH1 T|wet:W EH1 T|net:N EH1 T|pet:P EH1 T|jet:JH EH1 T
do:D UW1|you:Y UW1|two:T UW1|blue:B L UW1|shoe:SH UW1|zoo:Z UW1|who:HH UW1|new:N UW1
make:M EY1 K|cake:K EY1 K|lake:L EY1 K|bake:B EY1 K|snake:S N EY1 K|take:T EY1 K|awake:AH0 W EY1 K
hi:HH AY1|my:M AY1|i:AY1|eye:AY1|pie:P AY1|sky:S K AY1|fly:F L AY1|dry:D R AY1|bye:B AY1
put:P UH1 T|foot:F UH1 T
turn:T ER1 N|burn:B ER1 N|learn:L ER1 N
some:S AH1 M|come:K AH1 M|drum:D R AH1 M|thumb:TH AH1 M
love:L AH1 V|glove:G L AH1 V|above:AH0 B AH1 V
dad:D AE1 D|sad:S AE1 D|bad:B AE1 D|glad:G L AE1 D|mad:M AE1 D
good:G UH1 D|wood:W UH1 D|could:K UH1 D|should:SH UH1 D
it:IH1 T|sit:S IH1 T|hit:HH IH1 T|bit:B IH1 T|fit:F IH1 T
that:DH AE1 T|cat:K AE1 T|hat:HH AE1 T|bat:B AE1 T|mat:M AE1 T
when:W EH1 N|then:DH EH1 N|ten:T EH1 N|pen:P EH1 N|hen:HH EH1 N
okay:OW2 K EY1|day:D EY1|say:S EY1|play:P L EY1|way:W EY1
thanks:TH AE1 NG K S|banks:B AE1 NG K S
on:AA1 N|off:AO1 F|yes:Y EH1 S|big:B IH1 G|little:L IH1 T AH0 L
small:S M AO1 L|tall:T AO1 L|ball:B AO1 L|all:AO1 L
open:OW1 P AH0 N|close:K L OW1 Z|nose:N OW1 Z|rose:R OW1 Z
fast:F AE1 S T|last:L AE1 S T|happy:HH AE1 P IY0
night:N AY1 T|light:L AY1 T|white:W AY1 T|right:R AY1 T|kite:K AY1 T
full:F UH1 L|pull:P UH1 L|empty:EH1 M P T IY0|dark:D AA1 R K|park:P AA1 R K
loud:L AW1 D|cloud:K L AW1 D|proud:P R AW1 D|quiet:K W AY1 AH0 T
help:HH EH1 L P|yelp:Y EH1 L P
`;

export const PRONUNCIATIONS = Object.freeze(Object.fromEntries(
  TABLE_TEXT.split(/[|\n]/).map((s) => s.trim()).filter(Boolean).map((row) => {
    const i = row.indexOf(':');
    return [row.slice(0, i).trim().toLowerCase(), row.slice(i + 1).trim().split(/\s+/)];
  }),
));

const isVowel = (p) => /\d$/.test(p);
const bare = (p) => p.replace(/\d$/, '');

/** The phonemes from the last STRESSED vowel to the end, stress marks removed. Primary stress
 *  first; a word with none falls back to secondary, then to its last vowel at all. Null for a
 *  word not in the table. */
export function rhymePart(word, table = PRONUNCIATIONS) {
  const ph = table[String(word || '').toLowerCase()];
  if (!ph) return null;
  let at = -1;
  for (const mark of ['1', '2']) {
    for (let i = ph.length - 1; i >= 0; i--) if (ph[i].endsWith(mark)) { at = i; break; }
    if (at >= 0) break;
  }
  if (at < 0) for (let i = ph.length - 1; i >= 0; i--) if (isVowel(ph[i])) { at = i; break; }
  if (at < 0) return null;
  return ph.slice(at).map(bare).join(' ');
}

/**
 * Do these two words rhyme? true / false, or NULL WHEN EITHER WORD IS NOT IN THE TABLE — "I do
 * not know" is a different answer from "no", and the game must not turn one into the other.
 *
 * Not a rhyme: the same word, or two words that sound identical (here / hear).
 */
export function rhymes(a, b, table = PRONUNCIATIONS) {
  const x = String(a || '').toLowerCase().trim();
  const y = String(b || '').toLowerCase().trim();
  if (!table[x] || !table[y]) return null;
  if (x === y) return false;
  if (table[x].map(bare).join(' ') === table[y].map(bare).join(' ')) return false;
  return rhymePart(x, table) === rhymePart(y, table);
}

/** Every word in the table that rhymes with `word`, in table order. */
export function rhymesFor(word, table = PRONUNCIATIONS) {
  return Object.keys(table).filter((w) => rhymes(word, w, table) === true);
}

// ---------------------------------------------------------------------------------------
// OPPOSITES
// ---------------------------------------------------------------------------------------
// `accept` is every word counted right (the answer first — it is the one shown and spoken).
// `wrong` are the candidates the switch path offers besides the answer ("Is it WARM?"). Each is
// a plausible near-miss, never an absurd or degrading one (PRINCIPLES §2, the rule trivia states
// for its own distractors). `hint` is spoken after a miss, and never names the answer.
export const OPPOSITES = Object.freeze([
  { word: 'hot', accept: ['cold'], wrong: ['warm', 'wet'], hint: "it's how ice feels" },
  { word: 'cold', accept: ['hot'], wrong: ['cool', 'dark'], hint: "it's how the sun feels" },
  { word: 'up', accept: ['down'], wrong: ['over', 'in'], hint: "it's the way things fall" },
  { word: 'down', accept: ['up'], wrong: ['under', 'out'], hint: "it's where the sky is" },
  { word: 'in', accept: ['out'], wrong: ['on', 'up'], hint: "it's where you go when you leave a room" },
  { word: 'out', accept: ['in'], wrong: ['off', 'down'], hint: "it's where you go when you come home" },
  { word: 'on', accept: ['off'], wrong: ['in', 'up'], hint: "it's what a light is at bedtime" },
  { word: 'off', accept: ['on'], wrong: ['out', 'down'], hint: "it's what a light is when you can see" },
  { word: 'yes', accept: ['no'], wrong: ['okay', 'maybe'], hint: "it's what you say when you don't want something" },
  { word: 'no', accept: ['yes'], wrong: ['not', 'never'], hint: "it's what you say when you agree" },
  { word: 'go', accept: ['stop'], wrong: ['walk', 'run'], hint: "it's what a red light means" },
  { word: 'stop', accept: ['go'], wrong: ['wait', 'slow'], hint: "it's what a green light means" },
  { word: 'here', accept: ['there'], wrong: ['near', 'in'], hint: "it means over in that place" },
  { word: 'there', accept: ['here'], wrong: ['near', 'where'], hint: "it means in this place" },
  { word: 'big', accept: ['little', 'small', 'tiny'], wrong: ['tall', 'wide'], hint: "it's the size of a mouse" },
  { word: 'little', accept: ['big', 'large', 'huge'], wrong: ['short', 'thin'], hint: "it's the size of an elephant" },
  { word: 'open', accept: ['close', 'closed', 'shut'], wrong: ['lock', 'push'], hint: "it's what you do to a door behind you" },
  { word: 'good', accept: ['bad'], wrong: ['nice', 'fine'], hint: "it's how a rotten apple tastes" },
  { word: 'happy', accept: ['sad'], wrong: ['glad', 'tired'], hint: "it's how somebody feels when they cry" },
  { word: 'fast', accept: ['slow'], wrong: ['quick', 'late'], hint: "it's how a snail moves" },
  { word: 'day', accept: ['night'], wrong: ['morning', 'sun'], hint: "it's when the stars come out" },
  { word: 'wet', accept: ['dry'], wrong: ['cold', 'clean'], hint: "it's how a towel leaves you" },
  { word: 'full', accept: ['empty'], wrong: ['heavy', 'big'], hint: "it's a glass with nothing in it" },
  { word: 'loud', accept: ['quiet', 'soft'], wrong: ['noisy', 'fast'], hint: "it's how a library should be" },
  { word: 'light', accept: ['dark'], wrong: ['bright', 'white'], hint: "it's a room with the lamps off" },
]);

// ---------------------------------------------------------------------------------------
// RHYMING
// ---------------------------------------------------------------------------------------
// Only the PROMPT is listed: which words count is `rhymes()`'s call. `example` is the rhyme
// shown and spoken when somebody asks to hear the answer (a pictured one where there is one);
// `sound` is the hint's "it ends with the same sound: g-OH". It never names the example; the
// ending sound on its own is sometimes a word too (c-OLD, h-EAR, h-I), which is the hint doing
// its job rather than giving the answer away — Design's own "g-OH, n-OH" goes further.
export const RHYMING = Object.freeze([
  { word: 'go', example: 'no', sound: 'g-OH' },
  { word: 'hot', example: 'pot', sound: 'h-OT' },
  { word: 'cold', example: 'gold', sound: 'c-OLD' },
  { word: 'stop', example: 'top', sound: 'st-OP' },
  { word: 'wait', example: 'late', sound: 'w-AIT' },
  { word: 'pain', example: 'rain', sound: 'p-AIN' },
  { word: 'more', example: 'door', sound: 'm-ORE' },
  { word: 'up', example: 'cup', sound: 'UP' },
  { word: 'down', example: 'town', sound: 'd-OWN' },
  { word: 'in', example: 'win', sound: 'IN' },
  { word: 'out', example: 'shout', sound: 'OUT' },
  { word: 'here', example: 'near', sound: 'h-EAR' },
  { word: 'there', example: 'where', sound: 'th-AIR' },
  { word: 'look', example: 'book', sound: 'l-OOK' },
  { word: 'like', example: 'bike', sound: 'l-IKE' },
  { word: 'get', example: 'wet', sound: 'g-ET' },
  { word: 'do', example: 'you', sound: 'd-OO' },
  { word: 'make', example: 'cake', sound: 'm-AKE' },
  { word: 'hi', example: 'my', sound: 'h-I' },
  { word: 'love', example: 'glove', sound: 'l-OVE' },
  { word: 'dad', example: 'sad', sound: 'd-AD' },
  { word: 'good', example: 'wood', sound: 'g-OOD' },
  { word: 'that', example: 'cat', sound: 'th-AT' },
  { word: 'when', example: 'ten', sound: 'wh-EN' },
]);

// The words the switch path may offer as a NON-rhyme ("Does UP rhyme with GO?" — No). Pictured
// words first, so the candidate card usually has a picture; every one is in the table, so the
// answer to "does it rhyme" is always known.
export const RHYME_OFFER_POOL = Object.freeze(
  Object.keys(PRONUNCIATIONS).filter((w) => hasPicture(w))
    .concat(Object.keys(PRONUNCIATIONS).filter((w) => !hasPicture(w))),
);

// ---------------------------------------------------------------------------------------
// YES / NO QUIZ (room-add-ons §10: "Is a lemon sweet?")
// ---------------------------------------------------------------------------------------
// `picture` names an AAC symbol where one fits the question; `explain` is said after a right
// answer or when somebody asks to hear it. Nothing here is about the person playing — the
// questions are about the world, so a wrong answer is ordinary.
export const YES_NO = Object.freeze([
  { q: 'Is a lemon sweet?', answer: 'no', hint: 'a lemon makes your mouth pucker', explain: 'A lemon is sour, not sweet.' },
  { q: 'Is ice cold?', answer: 'yes', picture: 'cold', hint: 'think of a drink with ice in it', explain: 'Ice is cold.' },
  { q: 'Is the sun hot?', answer: 'yes', picture: 'hot', hint: 'think of a summer day', explain: 'The sun is very hot.' },
  { q: 'Can a dog fly?', answer: 'no', hint: 'a dog has four legs and no wings', explain: 'Dogs cannot fly.' },
  { q: 'Do fish swim?', answer: 'yes', hint: 'fish live in water', explain: 'Fish swim.' },
  { q: 'Is snow hot?', answer: 'no', picture: 'hot', hint: 'snow is made of ice', explain: 'Snow is cold.' },
  { q: 'Is up the opposite of down?', answer: 'yes', picture: 'up', hint: 'think of a lift going both ways', explain: 'Up is the opposite of down.' },
  { q: 'Is the sky green?', answer: 'no', hint: 'look up on a sunny day', explain: 'The sky is blue.' },
  { q: 'Does a cat say moo?', answer: 'no', hint: 'a cow says moo', explain: 'A cat says meow.' },
  { q: 'Is water wet?', answer: 'yes', hint: 'think of a bath', explain: 'Water is wet.' },
  { q: 'Do birds have wings?', answer: 'yes', hint: 'birds can fly', explain: 'Birds have wings.' },
  { q: 'Is a mouse bigger than an elephant?', answer: 'no', picture: 'little', hint: 'an elephant is huge', explain: 'A mouse is much smaller than an elephant.' },
  { q: 'Does GO rhyme with NO?', answer: 'yes', picture: 'go', hint: 'say them both out loud', explain: 'GO rhymes with NO.' },
  { q: 'Is a ripe banana yellow?', answer: 'yes', hint: 'think of the peel', explain: 'A ripe banana is yellow.' },
  { q: 'Do shoes go on your hands?', answer: 'no', hint: 'gloves go on hands', explain: 'Shoes go on feet.' },
  { q: 'Is stop the opposite of go?', answer: 'yes', picture: 'stop', hint: 'think of a traffic light', explain: 'Stop is the opposite of go.' },
]);

// The spoken words that count as a yes or a no. Kept short: each is a word a small grammar
// can carry, and none sounds like one on the other list. NOT here, on purpose: "right" and
// "not" — both are answers in the rhyming game (light / right, hot / not), and a word cannot
// mean "yes" and also be an answer without one of them being misread.
export const YES_WORDS = Object.freeze(['yes', 'yeah', 'yep', 'yup', 'sure']);
export const NO_WORDS = Object.freeze(['no', 'nope', 'nah']);
