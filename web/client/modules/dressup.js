// modules/dressup.js — DRESS-UP: "Put Jack in something warm." Pick from the wardrobe.
//
// Mike, 2026-10-12 (public DECISIONS.md, "Build all of Design's ideas"): Design's other game ideas, after Town and Story
// time. Claude Design's note (characters handoff README, "Ideas for games and story time"): "Dress-up: 'Put Jack in
// something warm.' Pick from the wardrobe."
//
// THE WARDROBE is Design's (character_kit.js OUTFITS: fourteen outfits across six themes, any character can wear any of
// them), and so are the people (DEFAULT_CHARACTERS, dressed as town_scene.js `courtParts` dresses them, in the deck's
// colours). Each outfit is drawn ON the character, so a choice is seen as it would look. The signature pieces (crown,
// cap, jester's hat) come off for dressing up: in Design's kit a role's piece takes the place of the outfit's own hat,
// and the beanie, the witch's hat or the top hat is half of what makes an outfit warm or for Halloween.
//
// *** A GENTLE GAME, BY DEFAULT. *** The prompt names a quality ("something warm", "something for Halloween"); ANY outfit
// that fits it is right (`QUALITIES`, each with the outfits it fits). Something else is never "wrong": they try it on
// anyway and it says, plainly, what that one is for ("The witch costume is for Halloween. Something warm?"). Nothing is
// counted against anybody. After `showAfter` tries the ones that fit say so on their tiles.
// FREE PLAY (`dressMode: 'free'`): no prompt at all; anything chosen goes on, "Other clothes" brings more and "Next
// person" moves on to the next character.
//
// *** CHOOSING: EVERY WAY THE OTHER CHOICE GAMES HAVE (Sort the bricks' shape). ***
//   * ONE SWITCH: the light moves over the clothes by itself (`lightMoves: 'auto'`, every `scanMs`, never faster than the
//     screen's flashing limit), saying each ("Parka?"); a press puts the lit one on.
//   * TWO SWITCHES: Next / Previous move the light (and start its clock again), Select puts it on.
//   * TOUCH or click an outfit. Keys: Left / Right move the light, Enter or Down chooses, 1-9 choose outright.
//   * VOICE: the outfit's name ("the parka", "the witch costume", "the cardigan"), where it is ("the first one"),
//     "this one", "other clothes", "next person", through the voice games' answer seam (`speech/grammar`), open only
//     while there is something to choose.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. *** (Sort the bricks' rules, kept)
//   * It waits for Start, with the computer dressing them calmly meanwhile (`attract`); reduced motion shows a still Start.
//   * A good choice rests `dressedMs`, then the next person and the next prompt come by themselves. A press skips the rest.
//   * A GAME NOBODY IS PLAYING COMES TO REST: IDLE_MS with no press and the light stops and the listening closes; the
//     demo comes back after `attractAfterMs`. The next press picks it up.
//
// THE SCORE is outfits chosen that fitted, on the score contract. NO POINTS, argued: with nothing ever wrong, points would
// pay for presses, not for anything done. [Mike's list.]

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { SHELL_STATE } from '../shell_verbs.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
import {
  autostartFields, attractFields, shouldAutostart, panelAlone, createPlayWatch, demoLimitMs, demoReturnMs,
  ATTRACT_DEFAULTS, START_VOICE, START_LINES, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';
import { SPEECH_GRAMMAR_TOPIC, SPEECH_ANSWER_TOPIC, UNKNOWN_WORD, normalize } from '../input_speech.js';
import { watchTheme, deckFor } from '../card_deck.js';
import { figureBody, OUTFITS, DEFAULT_CHARACTERS, courtOutfit } from '../character_kit.js';
import { courtParts } from '../town_scene.js';

export const GAME = 'dressup';
export const TITLE = 'Dress-up';
export const SCORE_LABEL = 'Dress-up: outfits chosen';

// A game nobody is pressing comes to rest after this long. 45 s, Sort the bricks' number and reason: longer than a person
// deciding takes (three laps of three outfits at the default light is 36 s), short enough that an empty room does not
// watch a light go round for long. Not a setting.
export const IDLE_MS = 45000;
// The demo takes a step this often: it lights an outfit that fits, then puts it on. Calm enough to follow.
export const DEMO_STEP_MS = 2000;
export const VOICE = Object.freeze({ 'put it on': 'select', 'this one': 'select', pause: 'pause', resume: 'play', ...START_VOICE });

export const PEOPLE = Object.freeze(['king', 'queen', 'jack', 'joker']);
/** How each is called in a prompt: "Put Jack in something warm" (Design's own wording), "Put the King in ...". */
export const WHO_NAME = Object.freeze({ king: 'the King', queen: 'the Queen', jack: 'Jack', joker: 'Robin' });

/**
 * WHAT A PROMPT ASKS FOR, and which outfits fit it. `ask` finishes "Put Jack in ..."; `is` finishes "The parka is ...".
 * Judgements, written once here, each outfit in at least one (so every outfit can say what it is for). [Mike's list.]
 */
export const QUALITIES = Object.freeze([
  { id: 'warm', ask: 'something warm', is: 'warm',
    fits: ['winterParka', 'winterSki', 'fallSweater', 'fallFlannel', 'steampunkAviator', 'christmasJumper'] },
  { id: 'snow', ask: 'something for the snow', is: 'for the snow', fits: ['winterParka', 'winterSki'] },
  { id: 'halloween', ask: 'something for Halloween', is: 'for Halloween', fits: ['halloweenVampire', 'halloweenWitch', 'halloweenPumpkin'] },
  { id: 'christmas', ask: 'something for Christmas', is: 'for Christmas', fits: ['christmasJumper', 'christmasElf'] },
  { id: 'costume', ask: 'something for a costume party', is: 'for a costume party',
    fits: ['halloweenVampire', 'halloweenWitch', 'halloweenPumpkin', 'christmasElf'] },
  { id: 'grand', ask: 'something for a grand dinner', is: 'for a grand dinner', fits: ['royal', 'steampunkWaistcoat'] },
  { id: 'garden', ask: 'something for working in the garden', is: 'for working in the garden', fits: ['nimrodTunic', 'fallFlannel'] },
  { id: 'home', ask: 'something comfortable for a day at home', is: 'comfortable for a day at home', fits: ['nimrodCardigan', 'fallSweater'] },
  { id: 'autumn', ask: 'something for an autumn walk', is: 'for an autumn walk', fits: ['fallSweater', 'fallFlannel'] },
  { id: 'airship', ask: 'something for a ride in an airship', is: 'for a ride in an airship', fits: ['steampunkAviator'] },
  // (2026-10-16) Design's lessons handoff gave every theme outfits of its own (character_kit.js): each fits at least
  // one prompt below, so every outfit can say what it is for. [Code's judgements, as the ones above are Mike's list.]
  { id: 'cozy', ask: 'something cozy', is: 'cozy',
    fits: ['cozyKnit', 'cozyCardigan', 'hanukkahJumper', 'hanukkahCardigan', 'valentineJumper', 'harvestCardigan', 'nightPyjamas'] },
  { id: 'party', ask: 'something for a party', is: 'for a party',
    fits: ['newYearTux', 'newYearParty', 'valentineDress', 'lunarDress', 'diwaliDress', 'stPatTophat'] },
  { id: 'festival', ask: 'something for a festival', is: 'for a festival',
    fits: ['lunarJacket', 'lunarDress', 'diwaliKurta', 'diwaliDress', 'julyShirt', 'julyDress', 'stPatJumper', 'easterBunny'] },
  { id: 'beach', ask: 'something for the beach', is: 'for the beach', fits: ['summerShirt', 'summerDress', 'oceanSailor'] },
  { id: 'rain', ask: 'something for the rain', is: 'for the rain', fits: ['oceanSlicker'] },
  { id: 'bed', ask: 'something for bedtime', is: 'for bedtime', fits: ['nightPyjamas'] },
  { id: 'stars', ask: 'something for looking at the stars', is: 'for looking at the stars', fits: ['nightStargazer'] },
  { id: 'spring', ask: 'something for a spring day', is: 'for a spring day', fits: ['springDress', 'springCardigan', 'easterDress', 'easterBunny'] },
  { id: 'baking', ask: 'something for baking', is: 'for baking', fits: ['harvestApron'] },
  { id: 'neon', ask: 'something that glows', is: 'something that glows', fits: ['cyberJacket', 'cyberHoodie'] },
].map((q) => Object.freeze({ ...q, fits: Object.freeze(q.fits) })));
export const qualityOf = (id) => QUALITIES.find((q) => q.id === id) || null;
export const fits = (outfit, quality) => !!(qualityOf(quality)?.fits.includes(outfit));

/** Each outfit's spoken names, the first being what it is called aloud ("Parka?"). */
export const SPOKEN = Object.freeze({
  royal: ['royal robe', 'robe'],
  nimrodTunic: ['garden tunic', 'tunic'],
  nimrodCardigan: ['teal cardigan', 'cardigan'],
  fallSweater: ['chunky sweater', 'sweater'],
  fallFlannel: ['flannel and beanie', 'flannel', 'flannel shirt', 'beanie'],
  winterParka: ['parka', 'fur hood', 'coat with the fur hood'],
  winterSki: ['ski jumper', 'ski sweater'],
  halloweenVampire: ['vampire cape', 'vampire', 'cape'],
  halloweenWitch: ['witch costume', 'witch', 'witch hat'],
  halloweenPumpkin: ['pumpkin suit', 'pumpkin'],
  christmasJumper: ['festive jumper', 'christmas jumper', 'christmas sweater'],
  christmasElf: ['elf costume', 'elf'],
  steampunkWaistcoat: ['waistcoat and top hat', 'waistcoat', 'top hat'],
  steampunkAviator: ['aviator coat', 'aviator', 'goggles'],
  // (2026-10-16) the new outfits, named as Design labelled them; a shorter word after where one is natural.
  cozyKnit: ['oatmeal knit', 'knit'],
  cozyCardigan: ['reading cardigan'],
  cyberJacket: ['neon jacket', 'neon'],
  cyberHoodie: ['glow jumper'],
  oceanSailor: ['sailor top', 'sailor'],
  oceanSlicker: ['rain slicker', 'slicker', 'raincoat'],
  nightPyjamas: ['star pyjamas', 'pyjamas', 'pajamas'],
  nightStargazer: ['stargazer coat'],
  springDress: ['garden dress'],
  springCardigan: ['light cardigan'],
  summerShirt: ['beach shirt'],
  summerDress: ['sun dress', 'sundress'],
  newYearTux: ['party tuxedo', 'tuxedo'],
  newYearParty: ['sparkle dress'],
  lunarJacket: ['silk jacket'],
  lunarDress: ['red qipao', 'qipao'],
  valentineJumper: ['heart jumper'],
  valentineDress: ['rose dress'],
  stPatTophat: ['green top hat'],
  stPatJumper: ['clover jumper'],
  easterBunny: ['bunny ears', 'bunny'],
  easterDress: ['lilac dress'],
  julyShirt: ['stars and stripes'],
  julyDress: ['picnic dress'],
  diwaliKurta: ['saffron kurta', 'kurta'],
  diwaliDress: ['festival dress'],
  harvestCardigan: ['mustard cardigan'],
  harvestApron: ['bakers apron', 'apron'],
  hanukkahJumper: ['blue and white jumper'],
  hanukkahCardigan: ['silver cardigan'],
});
export const WARDROBE = Object.freeze(Object.keys(OUTFITS).filter((id) => SPOKEN[id]));
export const outfitName = (id) => (SPOKEN[id] ? SPOKEN[id][0] : String(OUTFITS[id]?.label || id).toLowerCase());
/** What an outfit is for, in words: the first quality it fits ("for Halloween", "warm"). */
export function forWords(outfit) { return QUALITIES.find((q) => q.fits.includes(outfit))?.is || ''; }

/**
 * The clothes offered: `n` outfits, never the one being worn; for a prompt, at least one that fits it. Shuffled.
 * `avoid`: outfits just offered ("Other clothes" brings different ones while there are enough).
 */
export function rackFor({ quality = null, wearing = null, n = 3, rand = Math.random, avoid = [] } = {}) {
  const k = Math.max(2, Math.min(6, Math.floor(Number(n)) || 3));
  const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)) % (i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const pool = WARDROBE.filter((id) => id !== wearing);
  const q = qualityOf(quality);
  const out = [];
  if (q) {
    const fit = shuffled(q.fits.filter((id) => id !== wearing));
    if (fit.length) out.push(fit[0]);
  }
  const fresh = shuffled(pool.filter((id) => !out.includes(id) && !avoid.includes(id)));
  const again = shuffled(pool.filter((id) => !out.includes(id) && avoid.includes(id)));
  for (const id of [...fresh, ...again]) { if (out.length >= k) break; out.push(id); }
  return shuffled(out);
}

/** A quality for the next prompt: not the last one, and one with something to choose that is not already being worn. */
export function pickQuality({ last = null, wearing = null, rand = Math.random } = {}) {
  const ok = QUALITIES.filter((q) => q.id !== last && q.fits.some((id) => id !== wearing));
  const list = ok.length ? ok : QUALITIES;
  return list[Math.floor(rand() * list.length) % list.length].id;
}

/** An outfit somebody said, among the ones on offer: the longest name heard wins; a name two of them share is nobody. */
export function outfitFrom(text, rack = WARDROBE) {
  const t = ` ${normalize(text)} `;
  if (!t.trim()) return null;
  let best = null, bestLen = 0, tie = false;
  for (const id of rack) {
    for (const name of SPOKEN[id] || []) {
      const n = normalize(name);
      if (!n || !t.includes(` ${n} `)) continue;
      if (n.length > bestLen) { best = id; bestLen = n.length; tie = false; } else if (n.length === bestLen && best !== id) tie = true;
    }
  }
  return tie ? null : best;
}
/** "the first one", "the second", "number three", "the last one" -> 0..n-1, or null. */
export function placeFrom(text, n) {
  const t = ` ${normalize(text)} `;
  const words = [['first', 'one'], ['second', 'two'], ['third', 'three'], ['fourth', 'four'], ['fifth', 'five'], ['sixth', 'six']];
  if (/ last /.test(t)) return n - 1;
  for (let i = 0; i < Math.min(n, words.length); i++) {
    if (t.includes(` ${words[i][0]} `) || t.includes(` number ${words[i][1]} `) || t.trim() === words[i][1]) return i;
  }
  return null;
}

// What is said aloud. Plain, never a person's own name from the screen, never "wrong".
export const LINES = Object.freeze({
  ask: 'Put {who} in {what}.',
  fits: 'Good choice: the {outfit} is {is}.',
  notFit: 'The {outfit} is {is}. {What}?',
  free: '{Who} in the {outfit}.',
  freeAsk: 'Dress {who} in anything you like.',
});

export const DEFAULTS = Object.freeze({
  // A PROMPT BY DEFAULT: Design's game is "Put Jack in something warm". Free play is one row away.
  dressMode: 'prompt',
  // EACH OF THE FOUR IN TURN: it keeps the four in view, which is half of Who's who's work done gently.
  dressWho: 'all',
  // THREE TO CHOOSE FROM, as Who's who and Design's "pick from three". 2 for fewer; 4 for more.
  rackSize: 3,
  // THEY TRY IT ON ANYWAY (the gentle default): choosing is never refused, and it says what that one is for. FOR
  // "keep what they have on": the picture then only ever shows a fitting outfit. AGAINST, and it wins: the brief is "no
  // wrong-answer pressure", and an outfit that does not go on is a refusal. [Mike's list.]
  tryOn: 'wear',
  // SHOW WHICH FIT AFTER 2 TRIES, Sort the bricks' number: one try is a choice, two is a sign it would help.
  showAfter: 2,
  // 5 SECONDS AFTER A GOOD CHOICE: about 2.5 s to say "Good choice: the parka is warm", and a moment to look. 3 to 12 s.
  dressedMs: 5000,
  lightMoves: 'auto',
  // 4 SECONDS AN OUTFIT, Sort the bricks' number and reason (each is said in a word or two). 10 and 15 s are offered.
  scanMs: 4000,
  speak: true,
  sayChoice: true,
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
});

const isPrompt = (v) => !v || v.dressMode !== 'free';
const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Outfits chosen that fitted. A Scoreboard on the same screen can show it instead.' }),
  { key: 'dressMode', label: 'How to play', kind: 'choice', default: 'prompt', level: 'essential',
    options: [{ value: 'prompt', label: 'Asked for something ("Put Jack in something warm")' },
      { value: 'free', label: 'Free play: dress them in anything' }] },
  { key: 'dressWho', label: 'Who gets dressed', kind: 'choice', default: 'all', level: 'standard',
    options: [{ value: 'all', label: 'Each of them in turn' },
      ...PEOPLE.map((r) => ({ value: r, label: DEFAULT_CHARACTERS[r].name }))] },
  ...autostartFields({ on: false }),
  ...attractFields({ on: true }),
  { key: 'rackSize', label: 'Clothes to choose from', kind: 'choice', default: 3, level: 'standard',
    options: [2, 3, 4].map((v) => ({ value: v, label: String(v) })), note: 'Starts with the next person.' },
  { key: 'tryOn', label: 'Choosing something that is not what was asked for', kind: 'choice', default: 'wear', level: 'standard',
    options: [{ value: 'wear', label: 'They try it on anyway, and it says what that one is for' },
      { value: 'keep', label: 'It says what that one is for, and they keep what they have on' }],
    note: 'Nothing is ever marked wrong.', appliesWhen: isPrompt },
  { key: 'showAfter', label: 'Show which ones fit', kind: 'choice', default: 2, level: 'standard',
    options: [{ value: 1, label: 'After 1 try' }, { value: 2, label: 'After 2 tries' }, { value: 3, label: 'After 3 tries' },
      { value: 0, label: 'Never' }], appliesWhen: isPrompt },
  { key: 'dressedMs', label: 'After a good choice, the next one comes in', kind: 'choice', default: 5000, level: 'standard',
    options: [3000, 5000, 8000, 12000].map((v) => ({ value: v, label: `${v / 1000} seconds` })), appliesWhen: isPrompt },
  { key: 'lightMoves', label: 'The light on the clothes', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Moves by itself. A press puts the lit one on. One switch can play' },
      { value: 'off', label: 'Moves only when told: Next moves it, Select puts it on' }],
    note: 'An outfit touched always goes on.' },
  { key: 'scanMs', label: 'How long each choice stays lit', kind: 'choice', default: 4000, level: 'standard',
    options: [2000, 3000, 4000, 6000, 10000, 15000].map((v) => ({ value: v, label: `${v / 1000} seconds` })),
    note: 'Never faster than the screen\'s flashing limit.', appliesWhen: (v) => !v || v.lightMoves !== 'off' },
  { key: 'speak', label: 'Say what to put on aloud', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'sayChoice', label: 'Say each outfit as it lights', default: true, level: 'standard',
    onLabel: 'Yes ("Parka?")', offLabel: 'No', note: 'Somebody using a switch needs it.' },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fill = (t, v = {}) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => {
  const low = k[0].toLowerCase() + k.slice(1);
  const val = v[k] != null ? v[k] : v[low];
  if (val == null) return '';
  return k[0] !== low[0] ? cap(String(val)) : String(val);
}).replace(/\s{2,}/g, ' ').trim();

// ---- the drawing: Design's character in an outfit, in the deck's colours, signature piece off -------------------
const FIGURES = new Map();
export function dressedMarkup(who, outfit, deck = 'nimrod', { pose = 'stand', cls = 'du-fig' } = {}) {
  const key = `${who}|${outfit}|${deck}|${pose}|${cls}`;
  if (FIGURES.has(key)) return FIGURES.get(key);
  const { look, opts } = courtParts(who, deck);
  const svg = `<svg class="${cls}" viewBox="0 0 200 320" aria-hidden="true" focusable="false" data-figure="${esc(outfit)}">`
    + `${figureBody(look, { outfit, royal: opts.royal, pose })}</svg>`;
  if (FIGURES.size > 600) FIGURES.clear();
  FIGURES.set(key, svg);
  return svg;
}

// ---- the look: theme roles only; the people and their clothes are Design's drawings ---------------------------
const STYLE_ID = 'dressup-style';
const CSS = `
.du-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;font-family:var(--font)}
.du-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px}
.du-wrap *{box-sizing:border-box}
.du{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:.4rem;padding:.5rem;position:relative}
.du [hidden]{display:none !important}
.du-ask{margin:0;text-align:center;font:800 clamp(16px,3.4vmin,40px)/1.2 var(--font);color:var(--text-strong, var(--text))}
.du-stage{min-height:0;container-type:size;display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,2fr);gap:3cqw;align-items:center}
.du-who{display:grid;justify-items:center;align-content:center;gap:1cqh;min-height:0}
.du-who .du-big{height:min(78cqh,60cqw);width:auto;max-width:100%}
.du-name{margin:0;font:700 clamp(13px,4.5cqh,30px)/1.1 var(--font)}
/* The rail is a grid of --du-cols x --du-rows (set from how many choices there are), sized to the stage, so six
   choices in two rows fit as well as three in one. */
.du-rack{display:grid;grid-template-columns:repeat(var(--du-cols,3),minmax(0,1fr));grid-auto-rows:minmax(0,auto);
  gap:2.5cqh 1.5cqw;align-content:center;justify-items:center;min-height:0;max-height:100%}
.du-item{display:grid;justify-items:center;align-content:end;gap:.8cqh;padding:1cqh 1cqw;min-width:0;width:100%;
  border-radius:14px;border:3px solid var(--border);background:var(--surface);color:var(--text-strong, var(--text));
  font:800 clamp(12px,calc(4.4cqh / var(--du-rows,1)),28px)/1.1 var(--font);cursor:pointer;touch-action:manipulation}
.du-item .du-fig{height:calc(74cqh / var(--du-rows,1) - 11cqh);width:auto;max-width:100%}
.du-item[data-cmd]{align-content:center;align-self:stretch;padding:2cqh 1cqw}
.du-item[data-lit="1"]{outline:5px solid var(--scan-ring, var(--focus, currentColor));outline-offset:4px}
.du-item[data-fits="1"]{border-style:dashed;border-width:5px;border-color:var(--text-strong, var(--text))}
.du-fits{display:block;font-size:.75em;font-weight:700}
.du-bar{display:flex;flex-wrap:wrap;gap:.2rem 1.2rem;align-items:baseline;justify-content:center;min-height:2.2em}
.du-say{margin:0;font-size:clamp(15px,2.4vmin,28px);font-weight:600;color:var(--text-strong, var(--text))}
.du-score{margin:0;font-size:clamp(14px,2.1vmin,24px);color:var(--text)}
.du-paused{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font-weight:800;font-size:clamp(18px,8vmin,64px);color:var(--text-strong, var(--text))}
.du-paused span{padding:.05em .4em;border-radius:.3em;background:var(--surface)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

registerModule(
  { type: GAME, title: TITLE, core: 'new',
    description: 'Put Jack in something warm: choose from the wardrobe. Anything that fits is right, and nothing is ever '
      + 'marked wrong. Or just dress the King, the Queen, Jack and Robin in anything. Touch it, say it, or use one switch.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const clear = (h) => { if (h != null) { try { clearT(h); } catch { /* gone */ } } return null; };

    let cfg = { ...DEFAULTS };
    // The game: who is being dressed, what they wear, what is asked for, what is offered, and the light.
    let g = null;
    let started = true, demo = false, demoMs = 0, demoRested = false;
    let idle = true, listening = false;
    let dead = false, hidden = false;
    let lightTimer = null, restTimer = null, idleTimer = null, demoTimer = null, attractTimer = null;
    let rootEl = null, askEl = null, whoEl = null, rackEl = null, sayEl = null, scoreEl = null, overlayEl = null, duEl = null, pausedEl = null;
    let lastAsk = '', lastWho = '', lastRack = '', lastSay = '', lastScore = '', lastOverlay = null;
    let score = null, themeWatch = null;
    let litKey = '', lastSaid = null, litSaid = null;
    const said = [];
    const plays = createPlayWatch(bus, ctx);

    const deckNow = () => deckFor(themeWatch ? themeWatch.id() : 'default');
    const free = () => cfg.dressMode === 'free';
    const lightStepMs = () => Math.max(Number(cfg.scanMs) || DEFAULTS.scanMs, minFlashPeriodMs(flashLimit(ctx)));
    const rackSize = () => Math.max(2, Math.min(4, Number(cfg.rackSize) || DEFAULTS.rackSize));
    /** The stops the light walks: the clothes, then (free play) "Other clothes" and "Next person". */
    const stops = () => (g ? [...g.rack.map((id) => ({ kind: 'outfit', id })),
      ...(g.mode === 'free' ? [{ kind: 'more' }, { kind: 'person' }] : [])] : []);

    // ---- speech ------------------------------------------------------------------------------------------------
    const canSpeak = () => !!cfg.speak && started && !dead && !hidden && g && g.phase !== 'paused' && !!ctx.output?.say;
    // `cancelLit`: a lit outfit's name still waiting to be said is stale once the light has moved or a choice is made.
    // The prompt is never cancelled by it.
    function speak(text, { cancelLit = false } = {}) {
      if (!text || !canSpeak()) return null;
      try {
        if (cancelLit && litSaid && ctx.output.cancel) ctx.output.cancel(litSaid);
        const id = ctx.output.say(text, { source: GAME });
        lastSaid = id;
        said.push(text);
        if (said.length > 60) said.shift();
        return id;
      } catch (err) { console.error('dressup: say', err); return null; }
    }
    const askLine = () => {
      if (!g) return '';
      if (g.mode === 'free') return fill(LINES.freeAsk, { who: WHO_NAME[g.who] });
      return fill(LINES.ask, { who: WHO_NAME[g.who], what: qualityOf(g.quality)?.ask || '' });
    };
    function sayLit() {
      if (!cfg.sayChoice || !g || g.phase !== 'dress' || idle || !started) return;
      const key = `${g.serial}:${g.lit}`;
      if (key === litKey) return;
      litKey = key;
      const s = stops()[g.lit];
      if (!s) return;
      const word = s.kind === 'outfit' ? cap(outfitName(s.id)) : s.kind === 'more' ? 'Other clothes' : 'Next person';
      const id = speak(`${word}?`, { cancelLit: true });
      if (id) litSaid = id;
    }

    // ---- listening (the voice games' answer seam), open only while there is something to choose -----------------
    function grammarWords() {
      const words = new Set(['this one', 'the first one', 'the second one', 'the last one', 'number one', 'number two', 'number three']);
      for (const id of g.rack) for (const n of SPOKEN[id] || []) { words.add(n); words.add(`the ${n}`); }
      if (g.mode === 'free') ['other clothes', 'more clothes', 'next person', 'someone else'].forEach((w) => words.add(w));
      return [...words, UNKNOWN_WORD];
    }
    function announce() {
      const want = !dead && !hidden && started && !idle && !!g && g.phase === 'dress';
      if (!want && !listening) return;
      listening = want;
      try {
        bus.publish(SPEECH_GRAMMAR_TOPIC, { source: GAME, instanceId: ctx.instanceId || null, phase: g ? g.phase : 'idle',
          open: want, words: want ? grammarWords() : [] });
      } catch { /* nobody listening */ }
    }
    function heard(r) {
      if (dead || !listening || !g || g.phase !== 'dress') return;
      const text = r && typeof r === 'object' ? r.text : r;
      const t = normalize(text);
      if (!t || t === normalize(UNKNOWN_WORD) || t === 'unk') return;
      markInput();
      if (/\b(other|more) clothes\b/.test(t) && g.mode === 'free') { choose({ kind: 'more' }); return; }
      if (/\b(next person|someone else|somebody else)\b/.test(t) && g.mode === 'free') { choose({ kind: 'person' }); return; }
      const id = outfitFrom(t, g.rack);
      if (id) { g.lit = g.rack.indexOf(id); choose({ kind: 'outfit', id }); return; }
      const p = placeFrom(t, g.rack.length);
      if (p != null) { g.lit = p; choose({ kind: 'outfit', id: g.rack[p] }); return; }
      if (/\bthis one\b/.test(t)) press();
    }

    // ---- the light --------------------------------------------------------------------------------------------
    const lightWanted = () => !dead && !hidden && g && g.phase === 'dress' && stops().length > 1 && cfg.lightMoves !== 'off'
      && (started ? !idle : false);
    function armLight() {
      lightTimer = clear(lightTimer);
      if (!lightWanted()) return;
      lightTimer = setT(() => { lightTimer = null; if (!lightWanted()) return; moveLight(1); }, lightStepMs());
    }
    function moveLight(dir) {
      const n = stops().length;
      if (n < 1) return;
      g.lit = ((g.lit + dir) % n + n) % n;
      sayLit();
      render();
      armLight();
    }

    // ---- the game ------------------------------------------------------------------------------------------------
    let serial = 0;
    function nextPerson(prev) {
      const only = PEOPLE.includes(cfg.dressWho) ? cfg.dressWho : null;
      if (only) return only;
      const i = PEOPLE.indexOf(prev);
      return PEOPLE[(i + 1) % PEOPLE.length];
    }
    function newRound({ who = null, keepWearing = false } = {}) {
      const deck = deckNow();
      const person = who || nextPerson(g ? g.who : 'joker');
      const wearing = keepWearing && g ? g.wearing : courtOutfit(person, deck);
      const mode = free() ? 'free' : 'prompt';
      const quality = mode === 'prompt' ? pickQuality({ last: g ? g.quality : null, wearing, rand }) : null;
      g = { mode, who: person, wearing, quality, rack: rackFor({ quality, wearing, n: rackSize(), rand }), lit: 0, tries: 0,
        shown: false, phase: 'dress', news: '', dressed: g ? g.dressed : 0, tried: g ? g.tried : 0, serial: ++serial, was: null };
      litKey = '';
    }
    function shownNow() {
      const after = Number(cfg.showAfter);
      return g.mode === 'prompt' && after > 0 && g.tries >= after;
    }
    // A choice: an outfit, "Other clothes" or "Next person".
    function choose(stop) {
      if (!g || g.phase !== 'dress' || !stop) return;
      if (stop.kind === 'more') {
        g.rack = rackFor({ wearing: g.wearing, n: rackSize(), rand, avoid: g.rack });
        g.lit = 0; g.serial = ++serial; litKey = ''; g.news = '';
        render(); announce(); sayLit(); armLight();
        return;
      }
      if (stop.kind === 'person') {
        newRound();
        render(); announce(); speak(askLine()); sayLit(); armLight();
        return;
      }
      const id = stop.id;
      if (!OUTFITS[id]) return;
      if (g.mode === 'free') {
        g.wearing = id;
        if (started) g.tried += 1;
        g.news = fill(LINES.free, { who: WHO_NAME[g.who], outfit: outfitName(id) });
        g.rack = rackFor({ wearing: id, n: rackSize(), rand, avoid: g.rack });
        g.lit = 0; g.serial = ++serial; litKey = '';
        speak(g.news);
        render(); announce(); armLight();
        return;
      }
      const q = qualityOf(g.quality);
      if (fits(id, g.quality)) {
        g.wearing = id;
        g.phase = 'dressed';
        g.news = fill(LINES.fits, { outfit: outfitName(id), is: q.is });
        if (started) { g.dressed += 1; save(); }
        lightTimer = clear(lightTimer);
        speak(g.news, { cancelLit: true });
        render(); announce();
        restTimer = clear(restTimer);
        const restMs = Math.max(1000, Number(cfg.dressedMs) || DEFAULTS.dressedMs);
        // The demo's time counts its rests too ("The demo plays for" is time on the clock, not steps).
        restTimer = setT(() => { restTimer = null; if (!started) demoMs += restMs; nextAfterRest(); }, restMs);
        return;
      }
      // NOT WHAT WAS ASKED FOR: never wrong. They try it on (or keep theirs), and it says what that one is for.
      g.tries += 1;
      if (cfg.tryOn !== 'keep') g.wearing = id;
      g.news = fill(LINES.notFit, { outfit: outfitName(id), is: forWords(id), what: q.ask });
      // Something new on: its place on the rail takes another outfit, so what is worn is never offered. The others stay
      // where they were (the one that fits among them: it was not the one tried).
      if (cfg.tryOn !== 'keep') {
        const spare = WARDROBE.filter((x) => x !== g.wearing && !g.rack.includes(x));
        const other = spare.length ? spare[Math.floor(rand() * spare.length) % spare.length] : null;
        g.rack = g.rack.map((x) => (x === g.wearing && other ? other : x)).filter((x) => x !== g.wearing);
      }
      g.serial = ++serial; litKey = '';
      speak(g.news, { cancelLit: true });
      render(); announce(); armLight();
    }
    function nextAfterRest() {
      if (dead || !g || g.phase !== 'dressed') return;
      newRound();
      render(); announce();
      if (started && !idle) { speak(askLine()); sayLit(); }
      armLight();
      demoAfter();
    }
    function save() { try { state?.set?.({ stats: { dressed: g.dressed } }); } catch (err) { console.error('dressup: save', err); } }

    // ---- presses ------------------------------------------------------------------------------------------------
    function markInput() {
      idle = false;
      attractTimer = clear(attractTimer);
      idleTimer = clear(idleTimer);
      if (started) idleTimer = setT(goIdle, IDLE_MS);
      plays.active();
    }
    function goIdle() {
      idleTimer = null;
      if (dead || !started || idle || g?.phase === 'paused') return;
      idle = true;
      lightTimer = clear(lightTimer);
      plays.rest();
      announce(); render();
      const ms = demoReturnMs(cfg.attractAfterMs);
      if (ms > 0) attractTimer = setT(() => { attractTimer = null; if (!dead && started && idle && g?.phase !== 'paused') toStartScreen(); }, ms);
    }
    const demoWanted = () => cfg.attract !== false && !reducedMotion();
    function stopTimers() { lightTimer = clear(lightTimer); restTimer = clear(restTimer); demoTimer = clear(demoTimer); }
    function toStartScreen() {
      if (dead) return;
      stopTimers(); idleTimer = clear(idleTimer); attractTimer = clear(attractTimer);
      started = false; idle = true;
      g = null; newRound({ who: PEOPLE.includes(cfg.dressWho) ? cfg.dressWho : 'jack' });
      g.dressed = 0; g.tried = 0;
      demo = demoWanted(); demoMs = 0; demoRested = false;
      plays.pause();
      announce(); render();
      if (demo && !hidden) demoTimer = setT(demoTick, DEMO_STEP_MS);
    }
    function startGame() {
      if (dead || started) return false;
      stopTimers();
      started = true; demo = false;
      g = null; newRound({ who: PEOPLE.includes(cfg.dressWho) ? cfg.dressWho : 'jack' });
      g.dressed = 0; g.tried = 0;
      markInput();
      render(); announce();
      speak(askLine()); sayLit(); armLight();
      return true;
    }
    // Every press goes through here first: Start, then going on from a pause, then waking a game at rest.
    function common() {
      if (!g) return true;
      if (startGame()) return true;
      const wasIdle = idle;
      markInput();
      if (g.phase === 'paused') { resumeGame(); return true; }
      if (g.phase === 'dressed') { restTimer = clear(restTimer); nextAfterRest(); return true; }
      // A press that wakes a game at rest only wakes it: the light had stopped, and choosing where it stopped would spend
      // the press on a choice nobody was watching.
      if (wasIdle) { g.lit = 0; litKey = ''; render(); announce(); sayLit(); armLight(); return true; }
      return false;
    }
    function press() { if (common()) return; choose(stops()[g.lit]); }
    function move(dir) { if (common()) return; moveLight(dir); }
    function pick(i) {
      if (!g) return;
      if (startGame()) return;
      markInput();
      if (g.phase === 'paused') { resumeGame(); return; }
      if (g.phase !== 'dress') { common(); return; }
      const s = stops()[Math.round(Number(i))];
      if (!s) return;
      g.lit = Math.round(Number(i));
      choose(s);
    }
    function pauseGame() {
      if (dead || !g || !started || g.phase === 'paused') return;
      g.was = g.phase === 'dressed' ? 'dressed' : 'dress';
      g.phase = 'paused';
      stopTimers();
      try { if (lastSaid && ctx.output?.cancel) ctx.output.cancel(lastSaid); } catch { /* gone */ }
      plays.pause();
      announce(); render();
    }
    function resumeGame() {
      if (dead || !g) return;
      if (startGame()) return;
      if (g.phase !== 'paused') return;
      g.phase = g.was === 'dressed' ? 'dressed' : 'dress';
      markInput();
      render(); announce();
      if (g.phase === 'dressed') { nextAfterRest(); return; }
      speak(askLine()); armLight();
    }

    // ---- the demo: the computer dresses them calmly -----------------------------------------------------------
    function demoTick() {
      demoTimer = null;
      if (dead || started || !demo || demoRested || hidden || !g) return;
      demoMs += DEMO_STEP_MS;
      if (demoMs >= demoLimitMs(cfg.attractForMs)) { demoRested = true; render(); return; }
      if (g.phase === 'dress') {
        const want = g.mode === 'free' ? 0 : Math.max(0, g.rack.findIndex((id) => fits(id, g.quality)));
        if (g.lit !== want) { g.lit = want; render(); } else choose({ kind: 'outfit', id: g.rack[want] });
      }
      if (g.phase === 'dress') demoTimer = setT(demoTick, DEMO_STEP_MS);
    }
    function demoAfter() {
      if (started || dead || !demo || demoRested || hidden) return;
      demoTimer = clear(demoTimer);
      demoTimer = setT(demoTick, DEMO_STEP_MS);
    }

    // ---- pointer and keys -------------------------------------------------------------------------------------
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
      const stop = e.target.closest('[data-stop]');
      e.preventDefault();
      if (stop && started && g && g.phase === 'dress') { pick(Number(stop.dataset.stop)); return; }
      press();
    }
    function onKey(e) {
      if (dead || !g || e.repeat) return;
      let act = null;
      if (e.key === 'Enter' || e.key === 'ArrowDown') act = () => press();
      else if (e.key === 'ArrowRight') act = () => move(1);
      else if (e.key === 'ArrowLeft') act = () => move(-1);
      else if (e.key === 'Escape') { if (!started) return; act = () => (g.phase === 'paused' ? resumeGame() : pauseGame()); }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= stops().length) act = () => (started ? pick(Number(e.key) - 1) : press());
      if (act) { e.preventDefault(); e.stopPropagation(); act(); }
    }

    // ---- drawing ----------------------------------------------------------------------------------------------
    function rackHtml() {
      const deck = deckNow();
      const showLit = g.phase === 'dress' && (started ? !idle : demo && !demoRested) && stops().length > 1;
      const shown = shownNow();
      return stops().map((s, i) => {
        const lit = showLit && i === g.lit ? ' data-lit="1"' : '';
        if (s.kind !== 'outfit') {
          const label = s.kind === 'more' ? 'Other clothes' : 'Next person';
          return `<button type="button" class="du-item" data-stop="${i}" data-cmd="${s.kind}"${lit}>${label}</button>`;
        }
        const fit = shown && fits(s.id, g.quality);
        return `<button type="button" class="du-item" data-stop="${i}" data-outfit="${esc(s.id)}"${lit}${fit ? ' data-fits="1"' : ''} `
          + `aria-label="${esc(cap(outfitName(s.id)))}">${dressedMarkup(g.who, s.id, deck)}<span>${esc(cap(outfitName(s.id)))}</span>`
          + `${fit ? `<span class="du-fits">${esc(cap(qualityOf(g.quality).is))}</span>` : ''}</button>`;
      }).join('');
    }
    function statusLine() {
      if (!started) return demo && !demoRested ? START_LINES.demo : START_LINES.still;
      if (g.phase === 'paused') return 'Paused. Press to go on.';
      if (idle) return 'Press to play.';
      return g.news || (g.mode === 'free' ? 'Choose anything. Other clothes brings more.' : '');
    }
    function render() {
      if (dead || !rootEl || !g) return;
      const deck = deckNow();
      duEl.dataset.phase = g.phase;
      duEl.dataset.mode = g.mode;
      duEl.dataset.started = started ? '1' : '0';
      duEl.dataset.demo = !started && demo && !demoRested ? '1' : '0';
      duEl.dataset.who = g.who;
      duEl.dataset.wearing = g.wearing;
      duEl.dataset.deck = deck;
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ demo: demo && !demoRested, note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      const ask = started || demo ? askLine() : '';
      if (ask !== lastAsk) { askEl.textContent = ask; lastAsk = ask; }
      const pose = g.phase === 'dressed' ? 'wave' : 'stand';
      const who = `${dressedMarkup(g.who, g.wearing, deck, { pose, cls: 'du-big' })}<p class="du-name">${esc(DEFAULT_CHARACTERS[g.who].name)}</p>`;
      if (who !== lastWho) {
        whoEl.innerHTML = who; lastWho = who;
        whoEl.setAttribute('aria-label', `${DEFAULT_CHARACTERS[g.who].name}, in the ${outfitName(g.wearing)}`);
      }
      const rack = g.phase === 'dress' ? rackHtml() : '';
      if (rack !== lastRack) {
        rackEl.innerHTML = rack; lastRack = rack;
        const n = stops().length, rows = n > 4 ? 2 : 1;
        rackEl.style.setProperty('--du-cols', String(Math.max(1, Math.ceil(n / rows))));
        rackEl.style.setProperty('--du-rows', String(rows));
      }
      pausedEl.hidden = g.phase !== 'paused';
      const line = statusLine();
      if (line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      if (!started) { if (lastScore !== '') { scoreEl.textContent = ''; scoreEl.hidden = true; lastScore = ''; } return; }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const txt = own && g.mode === 'prompt' ? `Outfits chosen: ${g.dressed}` : '';
      if (txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      try { score?.set(g.dressed, { detail: g.mode === 'free' ? 'Free play' : '' }); } catch (err) { console.error('dressup: score', err); }
    }

    return {
      __probe: () => ({ game: g ? { ...g, rack: g.rack.slice() } : null, cfg: { ...cfg }, started, demo, demoRested, demoMs, idle,
        listening, said: said.slice(), stops: stops(), lightRunning: lightTimer != null, lightStepMs: lightStepMs(),
        restPending: restTimer != null, attractPending: attractTimer != null, playing: plays.playing(), deck: deckNow(),
        timers: [lightTimer, restTimer, idleTimer, demoTimer, attractTimer].filter((h) => h != null).length }),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStartStyle(doc);
        ensureStyle(doc);
        mount.innerHTML = `<div class="du-wrap gs-host" data-du-root tabindex="0" aria-label="${esc(TITLE)}"><div class="du" data-du>`
          + '<p class="du-ask" data-ask aria-live="polite"></p>'
          + '<div class="du-stage"><div class="du-who" data-who role="img"></div><div class="du-rack" data-rack></div></div>'
          + '<div class="du-bar"><p class="du-say" role="status" aria-live="polite"></p><p class="du-score" data-score hidden></p></div>'
          + '<div class="du-paused" data-paused hidden><span>Paused</span></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-du-root]');
        duEl = mount.querySelector('[data-du]');
        askEl = mount.querySelector('[data-ask]');
        whoEl = mount.querySelector('[data-who]');
        rackEl = mount.querySelector('[data-rack]');
        sayEl = mount.querySelector('.du-say');
        scoreEl = mount.querySelector('[data-score]');
        pausedEl = mount.querySelector('[data-paused]');
        overlayEl = mount.querySelector('[data-start-host]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null, onShownChange: () => render() });
        themeWatch = watchTheme(mount, () => { lastWho = ''; lastRack = ''; render(); });

        const applyCfg = (snap) => {
          const s = snap || {};
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined && s[k] !== null) next[k] = s[k];
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
        };
        applyCfg(state?.get?.());
        state?.subscribe?.((s) => {
          const was = { ...cfg };
          applyCfg(s);
          const shape = ['dressMode', 'dressWho'].some((k) => was[k] !== cfg[k]);
          if (!started && (demoWanted() !== demo || shape)) { toStartScreen(); return; }
          if (started && shape && g && g.phase !== 'paused') {
            restTimer = clear(restTimer);
            newRound({ who: PEOPLE.includes(cfg.dressWho) ? cfg.dressWho : null, keepWearing: was.dressWho === cfg.dressWho });
            render(); announce(); if (!idle) speak(askLine()); armLight();
            return;
          }
          if (was.lightMoves !== cfg.lightMoves || was.scanMs !== cfg.scanMs) armLight();
          render();
        });

        bus.subscribe(`${GAME}/select`, () => press());
        bus.subscribe(`${GAME}/next`, () => move(1));
        bus.subscribe(`${GAME}/prev`, () => move(-1));
        bus.subscribe(`${GAME}/pick`, (p) => pick(typeof p === 'object' && p ? p.index : p));
        bus.subscribe(`${GAME}/more`, () => { if (!common() && g.mode === 'free') choose({ kind: 'more' }); });
        bus.subscribe(`${GAME}/person`, () => { if (!common()) choose({ kind: 'person' }); });
        bus.subscribe(`${GAME}/back`, () => { if (!started || !g) return; markInput(); if (g.phase === 'paused') resumeGame(); else pauseGame(); });
        bus.subscribe(`${GAME}/pause`, () => pauseGame());
        bus.subscribe(`${GAME}/resume`, () => resumeGame());
        bus.subscribe(SHELL_STATE, (p) => { if (p && p.menuOpen === true && started && g && g.phase !== 'paused') pauseGame(); });
        bus.subscribe(SPEECH_ANSWER_TOPIC, (r) => heard(r));

        if (shouldAutostart(state?.get?.() || {}, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) {
          started = false; newRound({ who: PEOPLE.includes(cfg.dressWho) ? cfg.dressWho : 'jack' }); startGame();
        } else toStartScreen();
      },
      onResize() { render(); },
      onHide() {
        hidden = true;
        if (started && g && g.phase !== 'paused') pauseGame();
        stopTimers(); announce(); render();
        try { state?.flush?.(); } catch { /* nothing to do */ }
      },
      onShow() {
        hidden = false; render(); announce();
        if (!started && demo && !demoRested && demoTimer == null) demoTimer = setT(demoTick, DEMO_STEP_MS);
      },
      destroy() {
        dead = true;
        stopTimers(); idleTimer = clear(idleTimer); attractTimer = clear(attractTimer);
        if (listening) { listening = false; try { bus.publish(SPEECH_GRAMMAR_TOPIC, { source: GAME, instanceId: ctx.instanceId || null, open: false, words: [] }); } catch { /* gone */ } }
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('keydown', onKey);
        try { plays.destroy(); } catch { /* gone */ }
        try { themeWatch?.stop(); } catch { /* gone */ }
        try { score?.destroy(); } catch { /* gone */ } score = null;
      },
    };
  },
);
