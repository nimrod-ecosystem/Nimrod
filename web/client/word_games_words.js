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
import { difficultyLevel } from './packs.js';

export const hasPicture = (word) => !!(word && Object.prototype.hasOwnProperty.call(SYMBOLS, word));

// ---------------------------------------------------------------------------------------
// HOW HARD EACH ONE IS (row 2.63, Mike 2026-10-07: "Games like Name That, Opposites, Rhyming, etc.
// should have harder levels as well.")
// ---------------------------------------------------------------------------------------
// Every item carries a `difficulty`, in the words question packs use ('very easy', 'easy', 'medium',
// 'hard'; packs.js DIFFICULTY_LEVELS turns them into ladder levels 1 to 4). It is where the item STARTS
// on the ladder (adaptive_play.js); play moves its rating from there. Everything written before
// 2026-10-07 is 'very easy': short, everyday, pictured where it can be. What makes each list harder is
// argued at the top of that list.
const tier = (difficulty, list) => list.map((x) => Object.freeze({ ...x, difficulty }));
/** An item's ladder level (1 to 4); an item with no difficulty is the easiest. */
export const itemLevel = (it) => difficultyLevel(it && it.difficulty) || 1;

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
home:HH OW1 M|comb:K OW1 M|dome:D OW1 M|roam:R OW1 M
food:F UW1 D|mood:M UW1 D|rude:R UW1 D
pour:P AO1 R|hour:AW1 ER0|tour:T UH1 R
move:M UW1 V|stove:S T OW1 V
heat:HH IY1 T|meat:M IY1 T|seat:S IY1 T
said:S EH1 D|red:R EH1 D|bed:B EH1 D|head:HH EH1 D|bread:B R EH1 D|paid:P EY1 D|bead:B IY1 D
word:W ER1 D|bird:B ER1 D|heard:HH ER1 D|cord:K AO1 R D|lord:L AO1 R D
funny:F AH1 N IY0|money:M AH1 N IY0|honey:HH AH1 N IY0|sunny:S AH1 N IY0|bunny:B AH1 N IY0|pony:P OW1 N IY0
rocket:R AA1 K AH0 T|pocket:P AA1 K AH0 T|locket:L AA1 K AH0 T|racket:R AE1 K AH0 T|ticket:T IH1 K AH0 T
table:T EY1 B AH0 L|label:L EY1 B AH0 L|cable:K EY1 B AH0 L|pebble:P EH1 B AH0 L|bubble:B AH1 B AH0 L
kitten:K IH1 T AH0 N|mitten:M IH1 T AH0 N|written:R IH1 T AH0 N|button:B AH1 T AH0 N|kitchen:K IH1 CH AH0 N
summer:S AH1 M ER0|drummer:D R AH1 M ER0|plumber:P L AH1 M ER0|hammer:HH AE1 M ER0|simmer:S IH1 M ER0
mountain:M AW1 N T AH0 N|fountain:F AW1 N T AH0 N|captain:K AE1 P T AH0 N|curtain:K ER1 T AH0 N
jelly:JH EH1 L IY0|belly:B EH1 L IY0|smelly:S M EH1 L IY0|jolly:JH AA1 L IY0|silly:S IH1 L IY0
flower:F L AW1 ER0|tower:T AW1 ER0|shower:SH AW1 ER0|flavor:F L EY1 V ER0|lower:L OW1 ER0
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
//
// HARDER, argued (chat's ideas on row 2.63: less common words, more than one right answer, then saying it
// with no choices shown):
//   very easy  the first words anybody learns as pairs (hot / cold, up / down), most of them pictured.
//   easy       everyday words a step further from the first ones (early / late, buy / sell), still one
//              obvious answer.
//   medium     less common words, and more than one answer counts (arrive: leave, depart or go), with
//              near-miss offers that are the same kind of word (brave: strong or proud are wrong).
//   hard       long, less common words (temporary / permanent, transparent / opaque).
// NOT a level: "no choices shown". The choices are how somebody on a switch answers at all, so hiding them
// at a level would shut that person out of it. Whether choices are offered is how the game is answered
// (`answerBy`), and stays the person's own setting at every level.
export const OPPOSITES = Object.freeze([
  ...tier('very easy', [
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
  ]),
  ...tier('easy', [
    { word: 'early', accept: ['late'], wrong: ['soon', 'first'], hint: "it's when you get there after everybody else" },
    { word: 'push', accept: ['pull'], wrong: ['press', 'lift'], hint: "it's what you do to bring a door toward you" },
    { word: 'buy', accept: ['sell'], wrong: ['pay', 'spend'], hint: "it's what a shop does with its things" },
    { word: 'win', accept: ['lose'], wrong: ['play', 'beat'], hint: "it's what the other team does when you get the cup" },
    { word: 'first', accept: ['last'], wrong: ['next', 'second'], hint: "it's the one at the very end of the line" },
    { word: 'heavy', accept: ['light'], wrong: ['thin', 'soft'], hint: "it's how a feather feels in your hand" },
    { word: 'young', accept: ['old'], wrong: ['new', 'small'], hint: "it's how a great-grandparent is" },
    { word: 'clean', accept: ['dirty', 'messy'], wrong: ['wet', 'tidy'], hint: "it's how your hands are after playing in mud" },
    { word: 'hard', accept: ['soft', 'easy'], wrong: ['strong', 'heavy'], hint: "it's how a pillow feels" },
    { word: 'tall', accept: ['short'], wrong: ['small', 'thin'], hint: "it's the size of a child next to a grown-up" },
    { word: 'rich', accept: ['poor'], wrong: ['sad', 'cheap'], hint: "it's somebody with no money at all" },
    { word: 'thick', accept: ['thin'], wrong: ['short', 'light'], hint: "it's how a sheet of paper is" },
    { word: 'awake', accept: ['asleep'], wrong: ['tired', 'lying'], hint: "it's how you are in bed at night with your eyes shut" },
    { word: 'laugh', accept: ['cry'], wrong: ['smile', 'sing'], hint: "it's what tears come with" },
    { word: 'start', accept: ['finish', 'end', 'stop'], wrong: ['begin', 'go'], hint: "it's the last part of a race" },
  ]),
  ...tier('medium', [
    { word: 'arrive', accept: ['leave', 'depart', 'go'], wrong: ['come', 'stay'], hint: "it's what a train does when it pulls out of the station" },
    { word: 'ancient', accept: ['modern', 'new'], wrong: ['old', 'famous'], hint: "it's how this year's phones are" },
    { word: 'brave', accept: ['scared', 'afraid', 'cowardly'], wrong: ['strong', 'proud'], hint: "it's how somebody feels hiding from a storm" },
    { word: 'shallow', accept: ['deep'], wrong: ['wide', 'wet'], hint: "it's the far end of a swimming pool" },
    { word: 'smooth', accept: ['rough', 'bumpy'], wrong: ['soft', 'flat'], hint: "it's how tree bark feels" },
    { word: 'generous', accept: ['selfish', 'mean', 'stingy'], wrong: ['kind', 'rich'], hint: "it's somebody who never shares" },
    { word: 'accept', accept: ['refuse', 'reject', 'decline'], wrong: ['allow', 'take'], hint: "it's saying no to a gift" },
    { word: 'friend', accept: ['enemy', 'foe'], wrong: ['neighbour', 'cousin'], hint: "it's who you are fighting against" },
    { word: 'whisper', accept: ['shout', 'yell', 'scream'], wrong: ['talk', 'sing'], hint: "it's what you do to call somebody far away" },
    { word: 'victory', accept: ['defeat', 'loss'], wrong: ['game', 'prize'], hint: "it's what the losing team has" },
    { word: 'question', accept: ['answer', 'reply'], wrong: ['quiz', 'problem'], hint: "it's what you give when somebody asks you something" },
    { word: 'sharp', accept: ['blunt', 'dull'], wrong: ['pointed', 'thin'], hint: "it's a knife that will not cut" },
  ]),
  ...tier('hard', [
    { word: 'expand', accept: ['contract', 'shrink'], wrong: ['explode', 'grow'], hint: "it's what a balloon does as the air comes out" },
    { word: 'scarce', accept: ['plentiful', 'abundant', 'common'], wrong: ['rare', 'tiny'], hint: "it's when there is more than enough" },
    { word: 'temporary', accept: ['permanent', 'lasting'], wrong: ['short', 'quick'], hint: "it's something that is meant to last for ever" },
    { word: 'optimistic', accept: ['pessimistic', 'gloomy'], wrong: ['realistic', 'hopeful'], hint: "it's somebody who expects the worst" },
    { word: 'transparent', accept: ['opaque'], wrong: ['clear', 'shiny'], hint: "it's a wall you cannot see through" },
    { word: 'voluntary', accept: ['compulsory', 'mandatory', 'required', 'forced'], wrong: ['free', 'helpful'], hint: "it's something you have to do whether you like it or not" },
    { word: 'ascend', accept: ['descend'], wrong: ['climb', 'rise'], hint: "it's going down the stairs" },
    { word: 'maximum', accept: ['minimum'], wrong: ['average', 'total'], hint: "it's the very least something can be" },
    { word: 'innocent', accept: ['guilty'], wrong: ['honest', 'free'], hint: "it's what a judge says somebody is who did the crime" },
    { word: 'artificial', accept: ['natural', 'real'], wrong: ['fake', 'plastic'], hint: "it's how a flower that grew in the garden is" },
    { word: 'cautious', accept: ['reckless', 'careless'], wrong: ['careful', 'slow'], hint: "it's somebody who takes silly risks" },
    { word: 'vertical', accept: ['horizontal', 'flat'], wrong: ['upright', 'tall'], hint: "it's the way a bed lies on the floor" },
  ]),
]);

// ---------------------------------------------------------------------------------------
// RHYMING
// ---------------------------------------------------------------------------------------
// Only the PROMPT is listed: which words count is `rhymes()`'s call. `example` is the rhyme
// shown and spoken when somebody asks to hear the answer (a pictured one where there is one);
// `sound` is the hint's "it ends with the same sound: g-OH". It never names the example; the
// ending sound on its own is sometimes a word too (c-OLD, h-EAR, h-I), which is the hint doing
// its job rather than giving the answer away — Design's own "g-OH, n-OH" goes further.
//
// HARDER, argued (chat's ideas on row 2.63: longer words, near rhymes, "which one does not rhyme", then a
// rhyme of your own):
//   very easy  one short everyday word, the rhyme usually spelled the same way (go / no, hot / pot).
//   easy       one syllable, but the rhyme is spelled DIFFERENTLY (night / kite, blue / shoe, four / door):
//              it has to be heard, not seen.
//   medium     NEAR MISSES: the wrong answers offered (`decoys`) are spelled like a rhyme and are not one
//              (home: come and some; glove: move and stove). The hint is written as it SOUNDS ("b-AIR"),
//              because the spelling is the trap.
//   hard       two syllables, where the rhyme runs from the stressed syllable to the end (funny / money,
//              rocket / pocket), against near rhymes that share only part of it (pony, racket).
// NOT levels here, and why: "which one does not rhyme" turns the question round, which needs its own
// wording on every line of the miss flow; "a rhyme of your own" is what this game already accepts at every
// level (any word in the table that rhymes is right, not only the example). Both are open on Mike's list.
// `decoys` (optional): the two wrong answers offered. Each is in the table and does NOT rhyme (the suite
// checks); without it two non-rhymes are picked as before.
export const RHYMING = Object.freeze([
  ...tier('very easy', [
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
  ]),
  ...tier('easy', [
    { word: 'night', example: 'kite', sound: 'n-IGHT' },
    { word: 'blue', example: 'shoe', sound: 'bl-UE' },
    { word: 'eight', example: 'gate', sound: 'AIT' },
    { word: 'four', example: 'door', sound: 'f-OUR' },
    { word: 'chair', example: 'bear', sound: 'ch-AIR' },
    { word: 'pie', example: 'sky', sound: 'p-IE' },
    { word: 'floor', example: 'more', sound: 'fl-OOR' },
    { word: 'weight', example: 'plate', sound: 'w-EIGHT' },
    { word: 'eye', example: 'fly', sound: 'EYE' },
    { word: 'two', example: 'zoo', sound: 't-OO' },
    { word: 'who', example: 'blue', sound: 'wh-OO' },
    { word: 'fear', example: 'here', sound: 'f-EAR' },
  ]),
  ...tier('medium', [
    { word: 'home', example: 'comb', sound: 'h-OHM', decoys: ['come', 'some'] },
    { word: 'food', example: 'mood', sound: 'f-OOD', decoys: ['good', 'wood'] },
    { word: 'pour', example: 'door', sound: 'p-ORE', decoys: ['hour', 'tour'] },
    { word: 'glove', example: 'love', sound: 'gl-UV', decoys: ['move', 'stove'] },
    { word: 'bear', example: 'chair', sound: 'b-AIR', decoys: ['near', 'fear'] },
    { word: 'great', example: 'plate', sound: 'gr-AIT', decoys: ['heat', 'meat'] },
    { word: 'said', example: 'bed', sound: 's-ED', decoys: ['paid', 'bead'] },
    { word: 'word', example: 'bird', sound: 'w-URD', decoys: ['cord', 'lord'] },
  ]),
  ...tier('hard', [
    { word: 'funny', example: 'money', sound: 'f-UNNY', decoys: ['pony', 'happy'] },
    { word: 'rocket', example: 'pocket', sound: 'r-OCKET', decoys: ['racket', 'ticket'] },
    { word: 'table', example: 'label', sound: 't-ABLE', decoys: ['pebble', 'bubble'] },
    { word: 'kitten', example: 'mitten', sound: 'k-ITTEN', decoys: ['button', 'kitchen'] },
    { word: 'summer', example: 'drummer', sound: 's-UMMER', decoys: ['hammer', 'simmer'] },
    { word: 'mountain', example: 'fountain', sound: 'm-OUNTAIN', decoys: ['captain', 'curtain'] },
    { word: 'jelly', example: 'belly', sound: 'j-ELLY', decoys: ['jolly', 'silly'] },
    { word: 'flower', example: 'tower', sound: 'fl-OWER', decoys: ['flavor', 'lower'] },
  ]),
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
//
// HARDER, argued (chat's idea on row 2.63: harder statements):
//   very easy  something you can see or feel (is ice cold? do fish swim?).
//   easy       everyday knowledge one step away (the days of the week, which is the bigger number).
//   medium     a fact that catches people (is a whale a fish? is a spider an insect?).
//   hard       two steps, or a turned-round question (if today is Friday, is tomorrow Sunday? is it false
//              that fire is hot?). Nothing anybody could reasonably argue either way.
export const YES_NO = Object.freeze([
  ...tier('very easy', [
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
  ]),
  ...tier('easy', [
    { q: 'Does a week have seven days?', answer: 'yes', hint: 'count from Monday to Sunday', explain: 'A week has seven days.' },
    { q: 'Is Tuesday after Monday?', answer: 'yes', hint: 'say the days in order', explain: 'Tuesday comes after Monday.' },
    { q: 'Do cows give milk?', answer: 'yes', hint: 'think of a farm', explain: 'Cows give milk.' },
    { q: 'Is a carrot a fruit?', answer: 'no', hint: 'a carrot grows in the ground', explain: 'A carrot is a vegetable.' },
    { q: 'Do fish have legs?', answer: 'no', hint: 'think of how a fish moves', explain: 'Fish have fins, not legs.' },
    { q: 'Is ten more than five?', answer: 'yes', hint: 'count up from five', explain: 'Ten is more than five.' },
    { q: 'Is winter warmer than summer?', answer: 'no', hint: 'think of snow', explain: 'Summer is warmer than winter.' },
    { q: 'Does a hat go on your head?', answer: 'yes', hint: 'think of a sunny day outside', explain: 'A hat goes on your head.' },
    { q: 'Do people eat soup with a fork?', answer: 'no', hint: 'soup is runny', explain: 'Soup is eaten with a spoon.' },
    { q: 'Does it get dark at night?', answer: 'yes', hint: 'think of bedtime', explain: 'It gets dark at night.' },
  ]),
  ...tier('medium', [
    { q: 'Is a whale a fish?', answer: 'no', hint: 'a whale breathes air', explain: 'A whale is a mammal, not a fish.' },
    { q: 'Is a spider an insect?', answer: 'no', hint: 'count its legs', explain: 'A spider has eight legs, so it is not an insect.' },
    { q: 'Is twelve more than twenty?', answer: 'no', hint: 'count up from twelve', explain: 'Twenty is more than twelve.' },
    { q: 'Does ice float on water?', answer: 'yes', hint: 'think of ice in a drink', explain: 'Ice floats on water.' },
    { q: 'Is a year longer than a month?', answer: 'yes', hint: 'think of the calendar on the wall', explain: 'A year has twelve months.' },
    { q: 'Do penguins live at the North Pole?', answer: 'no', hint: 'they live in the far south', explain: 'Penguins live in the south, not at the North Pole.' },
    { q: 'Is a bat a bird?', answer: 'no', hint: 'a bat has fur', explain: 'A bat is a mammal, not a bird.' },
    { q: 'Is half of ten five?', answer: 'yes', hint: 'split ten into two equal parts', explain: 'Half of ten is five.' },
    { q: 'Does the sun rise in the east?', answer: 'yes', hint: 'think of where the morning sun is', explain: 'The sun rises in the east.' },
    { q: 'Does a triangle have four sides?', answer: 'no', hint: 'think of a slice of pizza', explain: 'A triangle has three sides.' },
  ]),
  ...tier('hard', [
    { q: 'If today is Friday, is tomorrow Sunday?', answer: 'no', hint: 'say the days in order', explain: 'If today is Friday, tomorrow is Saturday.' },
    { q: 'Is it true that a square has five sides?', answer: 'no', hint: 'count the sides of a window pane', explain: 'A square has four sides.' },
    { q: 'Is a dozen more than ten?', answer: 'yes', hint: 'think of a box of eggs', explain: 'A dozen is twelve, which is more than ten.' },
    { q: 'Is it false that fire is hot?', answer: 'no', hint: 'listen for the word false', explain: 'Fire is hot, so that is not false.' },
    { q: 'Does the moon make its own light?', answer: 'no', hint: 'it shines with light from somewhere else', explain: 'The moon shines with light from the sun.' },
    { q: 'Is the Pacific the biggest ocean?', answer: 'yes', hint: 'it lies between Asia and the Americas', explain: 'The Pacific is the biggest ocean.' },
    { q: 'Do plants need light to grow?', answer: 'yes', hint: 'think of a plant on a sunny windowsill', explain: 'Plants need light to make their food.' },
    { q: 'Is a kilometre longer than a mile?', answer: 'no', hint: 'a mile is about one and a half kilometres', explain: 'A mile is longer than a kilometre.' },
    { q: 'Is half an hour forty minutes?', answer: 'no', hint: 'an hour is sixty minutes', explain: 'Half an hour is thirty minutes.' },
    { q: 'Can a dolphin breathe under water?', answer: 'no', hint: 'a dolphin comes up to the surface', explain: 'A dolphin breathes air, so it comes up to breathe.' },
  ]),
]);

// The spoken words that count as a yes or a no. Kept short: each is a word a small grammar
// can carry, and none sounds like one on the other list. NOT here, on purpose: "right" and
// "not" — both are answers in the rhyming game (light / right, hot / not), and a word cannot
// mean "yes" and also be an answer without one of them being misread.
export const YES_WORDS = Object.freeze(['yes', 'yeah', 'yep', 'yup', 'sure']);
export const NO_WORDS = Object.freeze(['no', 'nope', 'nah']);
