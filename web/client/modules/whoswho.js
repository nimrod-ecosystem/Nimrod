// modules/whoswho.js — WHO'S WHO: "Which one is the Queen?" Pick from three of Design's court characters.
//
// Mike, 2026-10-12 (public DECISIONS.md, "Build all of Design's ideas"): after Town and Story time, Design's other game
// ideas. Claude Design's note (characters handoff README, "Ideas for games and story time"): "Who's who: 'Which one is
// the Queen?' Pick from three characters. It's answerable with yes/no switches."
//
// THE CHARACTERS are Design's four (character_kit.js DEFAULT_CHARACTERS: King Kenny, Queen Rose, Jack and Robin the
// Joker), dressed for the theme exactly as the cards and the town dress them (town_scene.js `courtParts`: the theme's
// outfits from COURT_PICK, the royal robe in the deck's colours elsewhere). Nothing is redrawn here.
//
// *** IT IS A QUIZ GAME, ON THE SHARED ENGINE (quiz_flow.js / quiz_view.js). *** So it gets everything the others have,
// written once: Mike's miss flow, the after-answer screen with its Next question button (row 2.66), Start and the demo
// (game_start.js), Pause, the points, the score, saying "stop", and the ladder (adaptive_play.js: players, each at their
// own level, "Start this game at", play as). The choices are the characters themselves, drawn as tiles that answer when
// touched (`data-pick`), lit by the switch.
//
// *** THE WAYS TO ANSWER. ***
//   * TOUCH or click a character.
//   * SAY IT: the character's name or role ("Rose", "the Queen"), or where they stand ("the one on the left", "the
//     middle one", "number three"). Saying back the very word the question used ("Which one is the Queen?" - "the
//     Queen") points at nobody, so it is never judged: it asks which one, by place or by name (`whichOneLine`).
//   * ONE SWITCH: the light moves over the characters by itself (`lightMoves: 'auto'`, every `scanMs`, never faster
//     than the screen's flashing limit), saying each place ("The one on the left"); a press answers the lit one. It
//     stops after LIGHT_LAPS laps with no press (an empty room does not hear "the one in the middle" for ever); any
//     press starts it again.
//   * TWO SWITCHES: Next moves the light (and starts its clock again), Select answers.
//   * YES / NO (Design's note): `answerBy: 'yesno'` offers one at a time, "Is it the one on the left?", with that
//     character ringed (`data-offered`); Yes / No by switch, voice, a nod and a shake. Two switches set as "Select is
//     Yes, Next is No" get this shape whatever Answering says (quiz_flow.js).
//
// *** THE LEVELS (the ladder moves each player; `LEVELS`). *** Easy first: the role's own signature piece (Design's: a
// tall crown, a crown with a heart, a feathered cap, a jester's hat) makes it plain. Harder: the same people by name, then
// by where they live (town.js `placeInfo`, the theme's own name for each home), and at the top with the signature pieces
// off, so the person is known by name and by look alone.
//   1  "Which one is the Queen?"            signature pieces on
//   2  "Which one is Rose?"                 pieces on (knowing Rose is the Queen finds her)
//   3  "Who lives in the Potion Parlour?"   pieces on (knowing whose home it is)
//   4  "Which one is Rose?"                 pieces OFF: by look (auburn hair in a bun)
//   5  "Who lives in the Potion Parlour?"   pieces OFF
// Each answer says who it was and why ("Rose is the Queen, with auburn hair in a bun, and lives in the Potion
// Parlour."), so the later levels are learned by playing the earlier ones.
// *** NOBODY IS ASKED TO TELL APART TWO PEOPLE WHO LOOK THE SAME. *** With the pieces off, two characters can share a
// theme's outfit and a hat that hides the hair (the Halloween Queen and Robin are both witches); `lookAlike` keeps such a
// pair out of the same question.
//
// *** NOTHING WAITS ON ANYBODY THAT CANNOT GIVE IT. *** It waits for Start, with the computer playing meanwhile (the demo
// rests after "The demo plays for"; reduced motion shows a still Start). A question waits for its answer (a game waiting
// for its input is the game, CLAUDE.md "games are settled"); the light stops after its laps; the next question comes by
// itself after an answer.
//
// PLAYING TOGETHER FROM A CALL (game_together.js) is not wired here, argued: it needs the server's rooms to allow the game
// and a third button on the call page (game_rooms.py, call_page.js, play_page.js), which is its own change, and the call
// page's own note says a fourth game is the trigger to group those buttons. [Mike's list.] Taking turns on ONE screen
// (the Players row) and "play who's who as Sam" (play_as.js, from the players row) work now.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, answerByField, fill, esc, normalize, shuffle } from '../quiz_flow.js';
import { quizModule } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openPersonLadder } from '../adaptive_play.js';
import { autostartFields, attractFields, ATTRACT_DEFAULTS, START_VOICE } from '../game_start.js';
import { watchTheme, deckFor } from '../card_deck.js';
import { figureBody, DEFAULT_CHARACTERS, OUTFITS, HAIR_COLOURS, courtOutfit } from '../character_kit.js';
import { courtParts } from '../town_scene.js';
import { PLACES, placeInfo } from '../town.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';

export const GAME = 'whoswho';
/** One game; listed so a spoken route's `{ game }` can be checked against it like the others. */
export const GAMES = Object.freeze([GAME]);
export const TITLE = "Who's who";

export const ROLES = Object.freeze(['king', 'queen', 'jack', 'joker']);
export const ROLE_WORD = Object.freeze({ king: 'King', queen: 'Queen', jack: 'Jack', joker: 'Joker' });
/** "King Kenny" -> "Kenny", "Robin the Joker" -> "Robin": the person's own name, without the role. */
export const firstName = (role) => String(DEFAULT_CHARACTERS[role]?.name || '')
  .replace(/^(King|Queen|Jack)\s+/, '').replace(/\s+the Joker$/, '').trim();
/** Each character's home: the town place whose `who` they are (town.js PLACES). */
export const HOME_OF = Object.freeze(Object.fromEntries(ROLES.map((r) => [r, Object.keys(PLACES).find((id) => PLACES[id].who === r)])));
/** Each role's signature piece, in words (character_kit.js `signature`). */
export const PIECE = Object.freeze({ king: 'the tall crown', queen: 'the crown with a heart on it',
  jack: 'the cap with the long feather', joker: "the jester's hat" });

// The hair colours by name, in character_kit.js HAIR_COLOURS order.
const HAIR_NAMES = ['black', 'dark brown', 'brown', 'auburn', 'ginger', 'fair', 'blonde', 'gray', 'red-brown', 'blue'];   // shown words only (site text second pass 2026-10-13: American spelling)
export function hairName(hex) {
  const i = HAIR_COLOURS.findIndex((h) => h.toLowerCase() === String(hex || '').toLowerCase());
  return i >= 0 ? HAIR_NAMES[i] || '' : '';
}
/** What a character looks like, in words, read off their look (so it stays true if Design changes a look). */
export function lookWords(look = {}) {
  const col = hairName(look.hairColor);
  const c = col ? `${col} ` : '';
  const hair = { short: `short ${c}hair`, long: `long ${c}hair`, curly: `curly ${c}hair`, bun: `${c}hair in a bun`,
    ponytail: `${c}hair in a ponytail`, bald: '' }[look.hair || 'short'] ?? `${c}hair`;
  const parts = [hair, look.beard ? 'a beard' : '', look.glasses ? 'glasses' : ''].filter(Boolean);
  if (!parts.length) return 'no hair on top';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
export const lookOf = (role) => lookWords(DEFAULT_CHARACTERS[role]?.look || {});

/**
 * Do two characters look the same with their signature pieces off, in this deck? The same outfit, the same beard and
 * glasses, and the same hair once a hat has covered it (character_kit.js: a hat turns curls and a bun into short hair).
 * Hair colour is left out on purpose: auburn beside ginger at a quarter of a screen is not a fair question.
 */
export function lookAlike(a, b, deck = 'nimrod') {
  const oa = courtOutfit(a, deck);
  if (oa !== courtOutfit(b, deck)) return false;
  const la = DEFAULT_CHARACTERS[a]?.look || {}, lb = DEFAULT_CHARACTERS[b]?.look || {};
  const hat = !!OUTFITS[oa]?.hat;
  const shown = (l) => (hat && (l.hair === 'curly' || l.hair === 'bun') ? 'short' : l.hair || 'short');
  return !!la.beard === !!lb.beard && !!la.glasses === !!lb.glasses && shown(la) === shown(lb);
}

// ---- the levels ------------------------------------------------------------------------------------------------
export const LEVELS = Object.freeze({
  1: Object.freeze({ ask: 'role', pieces: true }),
  2: Object.freeze({ ask: 'name', pieces: true }),
  3: Object.freeze({ ask: 'home', pieces: true }),
  4: Object.freeze({ ask: 'name', pieces: false }),
  5: Object.freeze({ ask: 'home', pieces: false }),
});
export const MAX_LEVEL = 5;
/** The ladder's questions: each character at each level, so every one has a rating of its own to learn. */
export const BANK = Object.freeze(Object.keys(LEVELS).map(Number).flatMap((level) => ROLES.map((role) => Object.freeze({
  id: `ww-l${level}-${role}`, level, role, ask: LEVELS[level].ask, pieces: LEVELS[level].pieces }))));

// ---- where they stand ------------------------------------------------------------------------------------------
export const POSITIONS = Object.freeze({ 2: Object.freeze(['on the left', 'on the right']),
  3: Object.freeze(['on the left', 'in the middle', 'on the right']) });
/** "the one on the left", for place `i` of `n`. */
export const positionWords = (i, n) => `the one ${(POSITIONS[n] || POSITIONS[3])[i] || ''}`.trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Where somebody said, as a place 0..n-1, or null. "the one on the left", "the middle one", "number three", "last". */
export function positionFrom(text, n = 3) {
  const t = ` ${normalize(text)} `;
  if (!t.trim()) return null;
  if (/ (middle|centre|center) /.test(t)) return n === 3 ? 1 : null;
  if (/ (third|three) /.test(t)) return n >= 3 ? 2 : null;
  if (/ (right|last) /.test(t)) return n - 1;
  if (/ (second|two) /.test(t)) return 1;
  if (/ (left|first) /.test(t)) return 0;
  if (/^ (one|number one) $/.test(t)) return 0;
  return null;
}
/** A character named or called by role: { role, by: 'name' | 'role' }, or null (nobody, or two people). */
export function nameFrom(text) {
  const t = ` ${normalize(text)} `;
  const byName = ROLES.filter((r) => t.includes(` ${normalize(firstName(r))} `));
  const byRole = ROLES.filter((r) => t.includes(` ${r} `));
  const set = new Set([...byName, ...byRole]);
  if (set.size !== 1) return null;
  const role = [...set][0];
  return { role, by: byName.includes(role) ? 'name' : 'role' };
}

/** A home's name in a sentence. `inQuestion`: "Robin's Caravan" is asked as "the Caravan" (its name would say who). */
export function placeWords(role, deck = 'nimrod', { inQuestion = false } = {}) {
  let label = String(placeInfo(HOME_OF[role], deck).label || '');
  if (inQuestion) {
    label = label.replace(/^[A-Z][\w-]*'s\s+/, 'the ');
    // ...and a character's own name inside it (2026-10-25: the Queen became Rose, and her home is the Rose Parlour) is
    // left out too: "the Rose Parlour" is asked as "the Parlour".
    for (const r of ROLES) {
      const n = firstName(r);
      if (n && n.toLowerCase() !== r) label = label.replace(new RegExp(`\\b${n}\\b\\s*`, 'gi'), '');
    }
    label = label.replace(/\s{2,}/g, ' ').trim();
  }
  return label.replace(/^The /, 'the ');
}

/** The characters offered: the answer and n-1 others (never one that looks the same with the pieces off), shuffled. */
export function pickChoices(role, n = 3, { deck = 'nimrod', pieces = true, rand = Math.random } = {}) {
  const k = Math.max(2, Math.min(ROLES.length, Math.floor(Number(n)) || 3));
  const others = ROLES.filter((r) => r !== role && (pieces || !lookAlike(r, role, deck)));
  return shuffle([role, ...shuffle(others, rand).slice(0, k - 1)], rand);
}

// ---- the drawing: Design's character, dressed for the deck, with or without the signature piece ---------------
const FIGURES = new Map();
export function figureMarkup(role, deck = 'nimrod', pieces = true) {
  const key = `${role}|${deck}|${pieces ? 1 : 0}`;
  if (FIGURES.has(key)) return FIGURES.get(key);
  const { look, opts } = courtParts(role, deck);
  const o = pieces ? opts : { outfit: opts.outfit, royal: opts.royal, pose: 'stand' };
  const svg = `<svg class="ww-fig" viewBox="0 0 200 320" aria-hidden="true" focusable="false" data-figure="${esc(role)}">${figureBody(look, o)}</svg>`;
  if (FIGURES.size > 400) FIGURES.clear();
  FIGURES.set(key, svg);
  return svg;
}

// ---- what is said ----------------------------------------------------------------------------------------------
export const LINES = Object.freeze({
  askRole: 'Which one is the {role}?',
  askName: 'Which one is {name}?',
  askHome: 'Who lives in {place}?',
  offerLine: 'Is it {candidate}?',
  hintPiece: 'the {role} wears {piece}',
  hintWho: '{name} is the {role}',
  hintHome: "{place} is the {role}'s home",
  hintHomeName: "{place} is {name}'s home",
  hintLook: '{name} has {look}',
  hintNot: 'it is not {position}',
  explainLine: '{name} is the {role}, with {look}, and lives in {place}.',
  whichOneLine: 'Which one? Say {positions}, or a name.',
});
const LINE_LABELS = {
  askRole: 'Question: by role', askName: 'Question: by name', askHome: 'Question: by home', offerLine: 'Offering one',
  hintPiece: 'Hint: the signature piece', hintWho: 'Hint: whose role it is', hintHome: 'Hint: whose home it is',
  hintHomeName: 'Hint: whose home it is, by name', hintLook: 'Hint: what they look like', hintNot: 'Hint: one taken away',
  explainLine: 'The answer', whichOneLine: 'Said a name the question already used',
};

// The light stops after this many laps with no press: three laps of three at the default step is about a minute, longer
// than somebody deciding takes, short enough that an empty room is not read the places for long. Not a setting, argued
// as Sort the bricks' IDLE_MS is.
export const LIGHT_LAPS = 3;

export const DEFAULTS = Object.freeze({
  game: GAME,
  // SAY IT, TAP IT, OR STEP THROUGH THE CHARACTERS, BY DEFAULT, argued. FOR yes / no: Design's own note ("answerable
  // with yes/no switches"). AGAINST, and it wins: Mike's ruling for every game with choices to walk (2026-10-02 late,
  // "Brain games shouldn't be yes/no by default ... Yes/no should be an option"). Yes / no is one row away, and two
  // switches set as Yes and No get it whatever this says. [Mike's list.]
  answerBy: 'choices',
  // THREE TO CHOOSE FROM: Design's "pick from three". Two for somebody for whom three is a lot. [Mike's list.]
  whoChoices: 3,
  // THE LIGHT MOVES BY ITSELF, so one switch can play (Sort the bricks', Town's and Adventure's default). FOR "only when
  // told": somebody answering aloud or by touch hears the places said as the light moves. AGAINST, and it wins: without
  // it a person with one switch can only ever answer the first character. It stops after LIGHT_LAPS laps.
  lightMoves: 'auto',
  // 6 SECONDS A CHARACTER, argued as Adventure's 6 s is: the light says each place aloud (about a second and a half), and
  // a press can take seconds more. Sort the bricks' 4 s says one word. 10 and 15 s are in the list.
  scanMs: 6000,
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

const SETTINGS = [
  ...autostartFields({ on: false }),
  ...attractFields({ on: true }),
  answerByField({ on: 'choices', example: 'Is it the one on the left?' }),
  ownScoreField({ level: 'essential', note: 'How many are right (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  { key: 'whoChoices', label: 'Characters to choose from', kind: 'choice', default: 3, level: 'standard',
    options: [{ value: 2, label: '2' }, { value: 3, label: '3' }], note: 'Starts with the next question.' },
  { key: 'lightMoves', label: 'The light on the characters', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Moves by itself. A press answers the lit one. One switch can play' },
      { value: 'off', label: 'Moves only when told: Next moves it, Select answers' }],
    note: 'A character touched always answers. It rests after three laps with no press.' },
  { key: 'scanMs', label: 'How long each choice stays lit', kind: 'choice', default: 6000, level: 'standard',
    options: [3000, 4000, 6000, 10000, 15000].map((v) => ({ value: v, label: `${v / 1000} seconds` })),
    note: 'Never faster than the screen\'s flashing limit.', appliesWhen: (v) => !v || v.lightMoves !== 'off' },
  ...adaptiveSettings({ ai: false, startLevels: MAX_LEVEL }),
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

// ---- the look ---------------------------------------------------------------------------------------------------
// Theme roles only; the characters are Design's drawings. The ring is the theme's measured --scan-ring, as quiz_view's.
const STYLE_ID = 'whoswho-style';
const CSS = `
.ww-picks{display:flex;gap:2.5cqmin;justify-content:center;align-items:stretch;flex-wrap:nowrap;max-width:100%}
.ww-pick{display:grid;justify-items:center;align-content:end;gap:.6cqmin;padding:1.2cqmin 1.6cqmin;min-width:0;
  border-radius:2.5cqmin;border:max(2px,.6cqmin) solid var(--border);background:var(--surface);color:var(--text);
  font:800 clamp(13px,3.4cqmin,40px)/1 var(--font);cursor:pointer;touch-action:manipulation}
.ww-fig{display:block;height:clamp(90px,46cqmin,460px);width:auto;max-width:100%}
.ww-pick[data-on="1"],.ww-pick[data-offered="1"]{outline:max(3px,1cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(2px,.5cqmin)}
.ww-pick[data-offered="1"] .ww-pos::before{content:"\\25B8\\00a0"}
.ww-pos{color:var(--text-strong, var(--text))}
.ww-pair{display:grid;justify-items:center;gap:.8cqmin;font-size:clamp(16px,5cqmin,60px)}
.ww-pair .ww-fig{height:clamp(80px,34cqmin,360px)}
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
    description: 'Which one is the Queen? Pick from three of the court characters, dressed for the theme. It starts with '
      + 'their crowns and hats to go by, then names, then where they live, then their looks alone. Each player at their own '
      + 'level. Say it, touch it, step through with one switch, or answer yes or no.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS, voice: START_VOICE },
  (ctx) => {
    const rand = ctx.rand || Math.random;
    let cfgNow = { ...DEFAULTS };
    let api = null;
    let themeWatch = null;
    let hidden = false, dead = false;
    let leftHtml = null;
    let lightTimer = null, lightKey = '', steps = 0;
    // The characters each question offered, in the order they stand (for "the one on the left" and the hints).
    const offered = new WeakMap();
    const deckNow = () => deckFor(themeWatch ? themeWatch.id() : 'default');
    const choicesOf = (it) => offered.get(it) || [it.role];

    const ladderRows = openPersonLadder(ctx, { gameKey: GAME, onChange: () => api?.render() });
    const session = createAdaptiveSession({
      cfg: () => cfgNow,
      bankFor: () => BANK,
      store: ladderRows.store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      startFor: ladderRows.startFor, startMark: ladderRows.startMark,
      playersHost: ladderRows.playersHost,
      onChange: () => api?.render(),
    });
    ladderRows.attach(session);

    function deal() {
      const q = session.deal(GAME);
      if (!q) return [];
      const L = LEVELS[Math.max(1, Math.min(MAX_LEVEL, Number(q.level) || 1))];
      // A fresh object each deal: what this deal offered is kept against it.
      return [Object.freeze({ id: q.id, level: q.level, role: q.role, ask: L.ask, pieces: L.pieces })];
    }

    function hintsFor(it, c) {
      const deck = deckNow();
      const role = ROLE_WORD[it.role], name = firstName(it.role), look = lookOf(it.role);
      const cands = choicesOf(it);
      const wrong = cands.findIndex((r) => r !== it.role);
      const not = wrong >= 0 ? fill(c.hintNot, { position: positionWords(wrong, cands.length) }) : '';
      const piece = fill(c.hintPiece, { role, piece: PIECE[it.role] });
      const looks = fill(c.hintLook, { name, look });
      const place = placeWords(it.role, deck, { inQuestion: true });
      if (it.ask === 'role') return it.pieces ? [piece, not] : [looks, not];
      if (it.ask === 'name') return it.pieces ? [fill(c.hintWho, { name, role }), piece] : [looks, not];
      return it.pieces ? [fill(c.hintHome, { place, role }), piece] : [fill(c.hintHomeName, { place, name }), looks];
    }
    const whichOne = (it, c) => {
      const n = choicesOf(it).length;
      const ps = Array.from({ length: n }, (_, i) => positionWords(i, n));
      return fill(c.whichOneLine, { positions: `${ps.slice(0, -1).join(', ')} or ${ps[ps.length - 1]}` });
    };

    const adapter = {
      items: () => deal(),
      empty: () => 'There are no characters to ask about.',
      ask(it, c) {
        const pre = it.demo ? '' : session.askPrefix();
        if (it.ask === 'name') return pre + fill(c.askName, { name: firstName(it.role) });
        if (it.ask === 'home') return pre + fill(c.askHome, { place: placeWords(it.role, deckNow(), { inQuestion: true }) });
        return pre + fill(c.askRole, { role: ROLE_WORD[it.role] });
      },
      candidates(it, c, r = rand) {
        const list = pickChoices(it.role, Number(c.whoChoices) || DEFAULTS.whoChoices, { deck: deckNow(), pieces: it.pieces, rand: r });
        offered.set(it, list);
        return list;
      },
      choiceLabel(it, v) {
        const cands = choicesOf(it);
        const i = cands.indexOf(v);
        return cap(positionWords(i >= 0 ? i : 0, cands.length));
      },
      offer(it, cand, c) {
        const cands = choicesOf(it);
        return fill(c.offerLine, { candidate: positionWords(Math.max(0, cands.indexOf(cand)), cands.length) });
      },
      judge(it, v) {
        if (v == null || v === '') return null;
        const s = String(v);
        if (ROLES.includes(s)) return s === it.role;
        const cands = choicesOf(it);
        const p = positionFrom(s, cands.length);
        if (p != null && cands[p]) return cands[p] === it.role;
        const nm = nameFrom(s);
        return nm ? nm.role === it.role : null;
      },
      hint: (it, n, c) => hintsFor(it, c)[n - 1] || '',
      answer: (it) => it.role,
      explain: (it, answer, c) => fill(c.explainLine, { name: firstName(it.role), role: ROLE_WORD[it.role],
        look: lookOf(it.role), place: placeWords(it.role, deckNow()) }),
      vocab(it) {
        const n = choicesOf(it).length;
        const words = ['the one on the left', 'left', 'the first one', 'first', 'the one on the right', 'right',
          'the last one', 'last', 'number one', 'number two', 'second', 'the second one'];
        if (n >= 3) words.push('the one in the middle', 'the middle one', 'middle', 'number three', 'the third one', 'third');
        for (const r of ROLES) words.push(normalize(firstName(r)), r, `the ${r}`, normalize(DEFAULT_CHARACTERS[r].name));
        return words;
      },
      // Where they stand first; then a name or a role, unless it is the word the question itself used (it points at
      // nobody: asked which one, never judged).
      fromVoice(it, { text, raw }, c = cfgNow) {
        const said = raw || text;
        const cands = choicesOf(it);
        const p = positionFrom(said, cands.length);
        if (p != null && cands[p]) return { value: cands[p] };
        const nm = nameFrom(said);
        if (nm) {
          if ((it.ask === 'role' && nm.by === 'role') || (it.ask === 'name' && nm.by === 'name')) return { note: whichOne(it, c) };
          return { value: nm.role };
        }
        return text ? { value: text } : null;
      },
      heardText: (v) => (ROLES.includes(v) ? firstName(v) : String(v)),
      unknownLine: (value, c) => (api ? whichOneFor(c) : c.notCaughtLine),
      // The computer's demo: an easy question straight from the characters, never through the ladder.
      demo(r = rand) {
        const role = ROLES[Math.floor(r() * ROLES.length) % ROLES.length];
        const level = 1 + (Math.floor(r() * 2) % 2);
        return { id: `ww-demo-${role}`, level, role, ask: LEVELS[level].ask, pieces: true, demo: true };
      },
    };
    function whichOneFor(c) {
      const it = api?.engine?.snapshot()?.item;
      return it ? whichOne(it, c) : c.notCaughtLine;
    }

    // ---- the light (one switch) ----------------------------------------------------------------------------------
    const stepMs = () => Math.max(Number(cfgNow.scanMs) || DEFAULTS.scanMs, minFlashPeriodMs(flashLimit(ctx)));
    const QUESTION = ['asking', 'unsure', 'twoMiss'];
    const lightWanted = () => !!api && !dead && !hidden && api.begun() && !api.paused() && cfgNow.lightMoves !== 'off'
      && cfgNow.twoSwitch !== 'yesno' && QUESTION.includes(api.engine.snapshot().phase) && api.engine.stops().length > 1;
    function clearLight() { if (lightTimer != null) { try { api?.clearTimer(lightTimer); } catch { /* gone */ } lightTimer = null; } }
    function armLight() {
      clearLight();
      if (!lightWanted()) return;
      if (steps >= LIGHT_LAPS * api.engine.stops().length) return;
      lightTimer = api.setTimer(() => {
        lightTimer = null;
        if (!lightWanted()) return;
        steps += 1;
        api.engine.next();
        armLight();
      }, stepMs());
    }
    // A new question, a new phase, a miss, Pause or Go on: the light starts again from the top of its laps.
    function lightBook(s) {
      if (!api || !api.begun()) return;
      const key = `${s.serial}:${s.phase}:${s.misses}:${api.paused() ? 1 : 0}:${hidden ? 1 : 0}:${cfgNow.lightMoves}:${cfgNow.scanMs}:${cfgNow.twoSwitch}`;
      if (key === lightKey) return;
      lightKey = key;
      steps = 0;
      armLight();
    }
    // A press of any kind: the laps start again, and so does the clock (a jump is never cut short).
    const pressed = () => { steps = 0; armLight(); };

    // ---- the view ------------------------------------------------------------------------------------------------
    function tilesHtml(s) {
      const it = s.item;
      const deck = deckNow();
      const cands = (s.candidates && s.candidates.length ? s.candidates : choicesOf(it)).map(String);
      const n = cands.length;
      const tiles = cands.map((role, i) => {
        const offer = s.offers === 'yesno' && s.phase === 'asking' && String(s.candidate) === role;
        return `<button type="button" class="ww-pick" data-pick="${esc(role)}" data-pos="${i + 1}"${offer ? ' data-offered="1"' : ''} `
          + `aria-label="${esc(cap(positionWords(i, n)))}">${figureMarkup(role, deck, it.pieces)}`
          + `<span class="ww-pos" aria-hidden="true">${i + 1}</span></button>`;
      }).join('');
      return `<div class="ww-picks" data-ww data-level="${esc(it.level)}" data-deck="${esc(deck)}">${tiles}</div>`;
    }

    const view = {
      leftEl(el, s) {
        lightBook(s);
        const q = s.item && QUESTION.includes(s.phase);
        const html = q ? tilesHtml(s) : '';
        if (html !== leftHtml) { el.innerHTML = html; leftHtml = html; }
        return !!html;
      },
      pairHtml(s) {
        const it = s.item;
        return `<div class="wg-pair ww-pair" data-pair>${figureMarkup(it.role, deckNow(), it.pieces)}`
          + `<span>${esc(firstName(it.role))}, the ${esc(ROLE_WORD[it.role])}</span></div>`;
      },
      turnHtml: (s) => session.turnHtml(s, GAME),
      onResult: (r) => { session.record(r); },
      allowAward: () => session.allowAward(),
      scoreDetail: (s) => session.scoreDetail() || (s.asked ? `${s.rightCount} of ${s.asked}` : ''),
      pointNote: (game, item) => `who's who: by ${item.ask}`,
      onConfig: (c) => { cfgNow = c; ladderRows.onConfig(c); },
      onMove: () => { pressed(); return false; },
      onClick: () => { pressed(); return false; },
      onHide: () => { hidden = true; clearLight(); },
      onShow: () => { hidden = false; steps = 0; armLight(); },
      init(a) {
        api = a;
        ensureStyle(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null));
        themeWatch = watchTheme(ctx.mount, () => { leftHtml = null; api?.render(); });
      },
      destroy: () => { dead = true; clearLight(); themeWatch?.stop(); themeWatch = null; session.destroy(); ladderRows.destroy(); },
    };

    const inner = quizModule({ type: GAME, title: TITLE, scoreLabel: "Who's who: right answers",
      games: { [GAME]: adapter }, defaults: DEFAULTS, gameKey: 'game', view, startGate: true,
      autostart: DEFAULTS.autostart })(ctx);
    inner.__session = session;
    inner.__state = () => ({ deck: deckNow(), light: { running: lightTimer != null, steps, stepMs: stepMs() } });
    return inner;
  },
);
