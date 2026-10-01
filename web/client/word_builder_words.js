// word_builder_words.js — THE WORDS AND THE LETTER SETS for the word builder (row 2.45). Data, no DOM.
//
// SOURCE AND LICENCE. Hand-written for this project, 2026-10-01: everyday English words of three to
// five letters, sorted by hand into three tiers of how common they are. Nothing is taken from any
// game's puzzles or any published word list; single words are not anybody's text. The file is MIT,
// like the rest of the repository. The tiers are a JUDGEMENT, not a frequency count: a word's tier
// only decides which letter sets are easy and which words a set ASKS for, and every answer anybody
// gives moves the set's own rating (`rating.js`), so a wrong guess here corrects itself in play.
//
//   tier 1  the commonest words: things in a house, the body, food, animals, small everyday verbs
//   tier 2  common, but a beat slower to find (hut, oar, lend, alarm)
//   tier 3  known, less used (tsar, teal, pleat)
//
// LEFT OUT ON PURPOSE: rude words, slurs, words about violence or death, and MOST plurals made by
// adding "s" (there are hundreds, and a set that asks for "cat" and "cats" is asking twice). The few
// here (rats, arts, pots, owls ...) are an anagram of another listed word, which is what makes a
// set worth searching. A word that is not on the list is never called wrong: the game says it is
// not on this list (see `word_builder.js`), because the list is small and English is not.

const T1 = `
act ant ape arm art ask ate bad bag bat bed bee big bit box boy bus but buy can cap car cat cow cry cup cut
dad day did dig dog dot dry ear eat egg end eye fan far fat few fit fix fly for fox fun get got gum had has
hat hen hit hop hot how hug ice ink jam jar jet job joy key kid kit lap leg let lid lip lit log lot low mad
man map mat may men met mix mom mop mud mug nap net new nod not now nut oak odd off oil old one out owl own
pan pat pay pea pen pet pie pig pin pit pot put ran rat raw red rub rug run sad sat saw say sea see set sew
sip sit six sky son sun tag tan tap tea ten tie tin tip toe top toy try tub two use van was way web wet who
why win wig won yes yet zoo and any are its tub
baby back bake ball band bank bath bear beat bell best bike bird blue boat body bone book boot bowl cake
call calm came camp card care cart coat cold come cook cool corn cost dark date dear deep desk dish door
down draw drop drum duck each east easy edge face fact fall farm fast feel feet find fine fire fish five
flag food foot fork four free frog from full game gate gift girl give glad goat gold good grow hair half
hall hand hard have head hear heat help here hill home hope horn hour into iron jump just keep kind king
kite knee know lake lamp land last late leaf left less life like line lion list live long look lost love
made mail make many meal meat meet milk mind moon more most move much name near neck need nest news next
nice nine nose note once only open over page pain pair park part past path pear pink plan play pond pool
poor post pull push race rain read real rest rice rich ride ring road rock roof room rope rose rule safe
sail salt same sand save seat seed sell send ship shoe shop show sing sink size skin slow snow soap sock
sofa soft song soon soup star stay stop sure swim tail take talk tall team tell tent test that them then
this time tiny told tone took tree trip true turn very wait wake walk wall want warm wash wave wear week
well went west what when wide wild wind wing wish with wolf wood word work yard year zero
team meat mate time item mile lime tops spot pots stop owns town tide diet lead deal read dear rate
tear lane lean tale mean name lose slow owls howl flow bowl blow rose sore lots slot salt last arts rats
apple bread chair clock dance dream drink earth eight field first floor fruit glass grape grass green
happy heart horse house juice laugh light lemon melon money mouse music night ocean paint paper party
peach phone piano plant plate queen quiet river sheep shirt sleep smile snake sound spoon stone storm
sugar table teeth tiger toast towel tower train truck water wheel white world write notes thing shore
`;

const T2 = `
ace add ago aid aim air apt arc bar bay bet bin bow bud bug bun cab cod cot cub dam den dew dim dip doe
due dug dye eel elf elk emu era ewe fed fee fig fin fir fog fur gap gas gem hay hem hid hog hub hut ivy
jaw jog jug lab lad law lay led lie mow nor oar oat ode opt orb ore owe pad pal paw peg pod pop pub pun
pup rag ram rap ray rib rid rim rip rob rod rot row rye sap sly sob sow soy spa spy sum tab tar tow tug
urn vet vow wax wit yak yam zip ton nip
alarm alert least steal stale tales slate petal leapt limes miles slime later alter canoe tones
stare tears rates eats teas loop edit tied reap ripe pier peel keen lend lens bend dent tend pest
step pets nets sent tens ties site tile isle lies stem mist omit loan lone toes dose does sour ours
rust tour lure mare ramp tram mart arms slam palm clam mace lace male lame seam rare rear dare loud
clod scold stole poles slope plots spoil taste state saint stain satin arise raise snore tenor
`;

const T3 = `
tsar tars sate tare pare peal teal opts wont dale lope pole lest tine stoat pleat hater rote tore
leer reel lees seer tern rent ions lino loin tarn rant arcs scar cars ares ears sear eras seal sale
ales sole silo soil oils toil lilt emit mite rite tier tire leant tonal talon spate paste tapes
toner stern terns odes ruts rout ream rams alms acme mesa
ample maple lemur baste beast caste cleat cider cried diner dowel elate flair frail heron inlet
irate glare regal lager spear spare parse crate trace react cater sonar arson snare earns lapse
leaps peals sepal brine blare
`;

// Words kept off the list whatever a tier says (a test checks it). Not a list of
// everything rude in English: the guard that matters is that the tiers above are hand-checked.
export const LEFT_OUT = Object.freeze(['ass', 'tit', 'sex', 'fag', 'cum', 'piss', 'damn', 'hell', 'dick', 'cock',
  'slut', 'whore', 'crap', 'porn', 'rape', 'kill', 'dead', 'die', 'dies', 'died', 'nazi', 'shit', 'fart', 'butt']);

function parseTier(text) {
  return text.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase())
    .filter((w) => /^[a-z]{3,5}$/.test(w) && !LEFT_OUT.includes(w));
}

/** word -> tier (1 commonest). A word listed in two tiers keeps the commoner one. */
export const TIER = Object.freeze((() => {
  const out = {};
  [[1, T1], [2, T2], [3, T3]].forEach(([tier, text]) => {
    for (const w of parseTier(text)) if (!(w in out)) out[w] = tier;
  });
  return out;
})());
export const WORDS = Object.freeze(Object.keys(TIER).sort());

const counts = (w) => { const m = {}; for (const ch of w) m[ch] = (m[ch] || 0) + 1; return m; };

/** Can `word` be made from `letters` (each letter used at most as often as it is there)? */
export function canMake(word, letters) {
  const have = counts(Array.isArray(letters) ? letters.join('') : String(letters));
  const need = counts(String(word));
  return Object.entries(need).every(([ch, n]) => (have[ch] || 0) >= n);
}

/** Every listed word of `minWord`+ letters that `letters` makes. */
export function wordsFrom(letters, { minWord = 3, words = WORDS } = {}) {
  return words.filter((w) => w.length >= minWord && canMake(w, letters));
}

/** A stable, mixed order for the letters, never spelling the root word left to right. */
export function mixedLetters(id, root) {
  const letters = root.split('');
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = letters.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.join('') === root && out.length > 1) out.push(out.shift());
  return out;
}

// ---------------------------------------------------------------------------------------
// THE LETTER SETS. Every listed word of three to five letters is a possible set (its letters), and a
// set is kept when it makes at least TWO words at or below its own tier: one word is a spelling test,
// not a search. Sets with the same letters are one set (stone, notes, tones), named by the commonest.
//
// THE LEVEL, ARGUED: (letters - 2) + (tier - 1), from 1 to 5. Each extra letter is one level (more to
// hold in mind, many more words hiding); each tier rarer is one level (the words take longer to come).
//   3 letters, tier 1  -> 1   (cat: cat, act)
//   4 letters, tier 1  -> 2   (boat: boat, bat)
//   5 letters, tier 1  -> 3   (stone: stone, notes, one, ten ...)
//   5 letters, tier 2  -> 4
//   5 letters, tier 3  -> 5
// The starting guess only: every set's rating moves with play.
// ---------------------------------------------------------------------------------------
export function buildPuzzles({ minWord = 3 } = {}) {
  const bySet = new Map();
  for (const root of WORDS) {
    const key = root.split('').sort().join('');
    const tier = TIER[root];
    const was = bySet.get(key);
    if (!was || tier < was.tier) bySet.set(key, { key, root, tier });
  }
  const out = [];
  for (const { key, root, tier } of bySet.values()) {
    const all = wordsFrom(root, { minWord });
    const pool = all.filter((w) => TIER[w] <= tier);
    if (pool.length < 2) continue;
    const id = `wb-${key}`;
    const level = Math.max(1, Math.min(5, (root.length - 2) + (tier - 1)));
    out.push(Object.freeze({
      id, kind: 'letters', level, root, tier,
      letters: Object.freeze(mixedLetters(id, root)),
      // The words it ASKS for come from `pool`, longest (the whole set) first, then the commonest and
      // shortest; everything else it makes is a bonus (found, counted, never asked for).
      pool: Object.freeze(pool.slice().sort((a, b) => (b.length === root.length) - (a.length === root.length)
        || TIER[a] - TIER[b] || a.length - b.length || a.localeCompare(b))),
      all: Object.freeze(all),
    }));
  }
  return out.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
}

export const PUZZLES = Object.freeze(buildPuzzles());
