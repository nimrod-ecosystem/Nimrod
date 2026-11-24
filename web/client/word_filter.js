// word_filter.js - WHICH WORDS A SCREEN'S WORD GAMES MAY USE (2026-11-23). Data and pure functions, no DOM.
//
// Mike, 2026-11-23, on the word builder's first block list (which kept out coma, dementia and stroke): "Medical terms
// should not be blocked. I would just say block any racial slurs and the like. Have age settings for people that want
// things like swear words blocked." And: "The words we use will be used for multiple things."
//
// So there is ONE list of words that may be held back, in four kinds, read by every word game (today the word builder;
// Spelling and the others as they move to the shared words), and one screen setting that says which kinds are held back:
//
//   slur     ALWAYS held back, at every setting. Racial and ethnic slurs, and slurs about who somebody loves, their
//            gender or a disability. The accept list is built without them (web/tools/word_builder_lists.py reads this
//            block), so they are not even in the site's files as words to play.
//   swear    swearing and insults.                          held back at "everyone" (the default) and "children"
//   sexual   sexual words, and words for sexual violence.    held back at "everyone" (the default) and "children"
//   adult    drugs, weapons, killing and other violence.     held back at "children" only
//
// NOT ON ANY LIST, ON PURPOSE (Mike's ruling): illness, medicine and the body (coma, stroke, dementia, cancer, penis,
// vagina), death and dying (dead, funeral, grave), and ordinary words that have a rude second sense (grave, hang,
// screw, crack). A game cannot tell which sense was meant, and these are everyday words somebody may need.
// A WORD WITH TWO SENSES IS LISTED only when its rude sense is the one most people hear said aloud (pussy, cock, tit,
// rape): the game speaks a bonus word back, and a listener hears the word, not the sense. For the same reason nigg*
// also takes niggle and niggard: said by a synthetic voice, many listeners hear the slur. Spastic stays (a medical word).
//
// HOW A LIST IS READ: a word is on it when it IS one of the words, or STARTS with one marked '*'. A '*' is only used
// where nothing ordinary starts the same way (arse* would take arsenal and arsenic; psycho* would take psychology), and
// each one was checked against the accept list (web/tools/test_word_builder_lists.py).
//
// THE SETTING lives on the screen's own settings (the same document as "Lesson topics", lessons.js
// PROFILE_SETTINGS_KEY), on the This screen tab, because a word a game says aloud is heard by whoever is in the room,
// not only by whoever's profile is on the screen.

export const WORD_LEVEL_KEY = 'wordLevel';
export const WORD_LEVELS = Object.freeze(['adults', 'everyone', 'children']);
// THE DEFAULT: "adults" (every word but slurs). Mike, 2026-11-24: "Adults by default". Code had guessed "everyone" (a
// bonus word is said aloud to the room) and put it to him; his own words from the start were "for people that want
// things like swear words blocked", which is a choice somebody makes, not the default. A screen in a room with
// children picks "No swearing or sexual words" or "children" on This screen.
export const DEFAULT_WORD_LEVEL = 'adults';

const HELD = Object.freeze({
  adults: Object.freeze(['slur']),
  everyone: Object.freeze(['slur', 'swear', 'sexual']),
  children: Object.freeze(['slur', 'swear', 'sexual', 'adult']),
});

// The lists. web/tools/word_builder_lists.py reads the `slur` block from this file by its name, so keep the shape:
// a name, a colon, a template string of words separated by spaces.
const LISTS = {
  slur: `
beaner* chink chinks coolie* coon coons cripple cripples dago dagoes dagos darkie* darky dyke dykes fag fags faggot*
gook* gyp gyps gypped gypping homo homos honkie* honky jap japs jigaboo* kike* kraut* lesbo* midget* mongoloid*
negro negroes negroid nigg* paki pakis pickaninn* poof* polack* raghead* redskin* retard retards retarded sambo* spaz*
spic spics squaw squaws towelhead* trannie* tranny* wetback* wog wogs wop wops yid yids
`,
  swear: `
arse arses arsehole* ass asses asshole* bastard* bitch* bollock* bugger* bullshit* crap craps crapped crappy cunt*
damn damned damning damns dammit dick dicks dickhead* douche* dumbass* feck fecking fuck* goddam* hell hells
idiot* imbecil* jackass* moron* piss* psycho psychos scumbag* shit* skank* tosser* turd* twat* wank* whore* slut*
bimbo*
`,
  sexual: `
boner* boob boobs booby boobies clit clits cock cocks cum dildo* erotic* horny hooker* incest* lust lusts lusted
lustful lusty molest* orgasm* orgies orgy paedo* pecker* pedo pedos pedophil* porn* pube pubes pussy* rape raped
rapes raping rapist* schlong* seduc* sex sexed sexier sexiest sexing sexual* sexy smut* tit tits titties titty
`,
  adult: `
assassin* behead* bomb bombs bombed bombing bomber bombers bullet bullets cannabis cocaine corpse* decapitat* drug drugs
drugged genocide* grenade* gun guns gunfire gunman gunmen gunshot* heroin hitler* homicide* hostage* junkie junkies kill kills killed killer killers killing killings
marijuana massacre* meth murder* nazi* noose* opium pistol* rifle rifles shoot shooter* shooting shootings shoots
shotgun* slaughter* stab stabbed stabbing stabs strangl* suicide* terroris* tortur* weapon*
`,
};

function parse(text) {
  const exact = new Set();
  const starts = [];
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (w.endsWith('*')) starts.push(w.slice(0, -1)); else exact.add(w);
  }
  return Object.freeze({ exact, starts: Object.freeze(starts) });
}
const PARSED = Object.freeze(Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [k, parse(v)])));
export const KINDS = Object.freeze(Object.keys(LISTS));

/** Which kind a word is ('slur', 'swear', 'sexual', 'adult'), or null for an ordinary word. PURE. */
export function kindOf(word) {
  const w = String(word == null ? '' : word).toLowerCase();
  if (!w) return null;
  for (const k of KINDS) {
    const p = PARSED[k];
    if (p.exact.has(w) || p.starts.some((s) => w.startsWith(s))) return k;
  }
  return null;
}

/** A stored value as one of WORD_LEVELS; anything else (absent, old, hand-edited) is the default. PURE. */
export function wordLevelFrom(values) {
  const raw = values && values[WORD_LEVEL_KEY];
  return WORD_LEVELS.includes(raw) ? raw : DEFAULT_WORD_LEVEL;
}

/** true when a game on a screen at `level` must not use `word` (ask for it, accept it, or say it). PURE. */
export function heldBack(word, level = DEFAULT_WORD_LEVEL) {
  const k = kindOf(word);
  if (!k) return false;
  const held = HELD[WORD_LEVELS.includes(level) ? level : DEFAULT_WORD_LEVEL];
  return held.includes(k);
}

/** The words a game at `level` may use, in their order. PURE. */
export function allowedWords(words, level = DEFAULT_WORD_LEVEL) {
  return (words || []).filter((w) => !heldBack(w, level));
}

/** The screen's settings row, written to the same document as "Lesson topics" (This screen tab). */
export const WORD_LEVEL_FIELD = Object.freeze({
  key: WORD_LEVEL_KEY, label: 'Words the games may use', kind: 'choice', default: DEFAULT_WORD_LEVEL, level: 'standard',
  options: [
    { value: 'adults', label: 'Every word but slurs (adults)' },
    { value: 'everyone', label: 'No swearing or sexual words' },
    { value: 'children', label: 'Also none about drugs, weapons or violence (children)' },
  ],
  note: 'Slurs are never used. Words about illness, the body and death are ordinary words and always count. '
    + 'The word games read this, starting with Word builder.',
});

/**
 * The live handle a game holds: `{ load, get, subscribe, destroy }`, over the screen's settings document (the shape
 * lessons.js `createQuestMode` has). Without `makeState` (a page with no screen behind it) it is the default, fixed.
 */
export function createWordLevel({ makeState, key = 'settings' } = {}) {
  let state = null;
  try { state = typeof makeState === 'function' ? makeState(key) : null; } catch { state = null; }
  return {
    // Loaded once, then kept current the way Lesson topics is (lessons.js createQuestMode's startPolling), so a change in
    // the menu reaches a game already open at its next set.
    load: async () => {
      try { await state?.load?.(); } catch { /* the default stands */ }
      try { state?.startPolling?.(); } catch { /* read once is still right */ }
    },
    get: () => { try { return wordLevelFrom(state?.get?.() || {}); } catch { return DEFAULT_WORD_LEVEL; } },
    subscribe: (fn) => { try { return state?.subscribe?.(fn) || (() => {}); } catch { return () => {}; } },
    destroy: () => { try { state?.destroy?.(); } catch { /* gone */ } },
  };
}
