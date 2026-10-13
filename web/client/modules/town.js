// modules/town.js — THE TOWN: the current theme's eight places, opened full size, rearranged, and kept per person.
//
// Mike, 2026-10-12 (public DECISIONS.md, newest section): build all of Design's ideas, starting with the Town and Story
// time. Claude Design's characters handoff (town.js, shipped as it is) gives every theme eight places: the four court
// characters' homes (the King's hall, the Queen's parlour, Jack's workshop, Pip's caravan, each a different place in
// every world) and a place in town for each suit (the Bakery, the Shop, the Park, the Library). This panel shows them.
//
//   THE TOWN       the eight places as pictures, in the theme on screen (or a theme chosen in the settings).
//   A PLACE        opened full size, with its character standing at home, its one-line description, and the cards
//                  that are drawn from it. "Talk to King Bram" (see below), "Rearrange", "Put it back".
//   REARRANGE      the smallest room editor that does the job: pick a thing in the room (Next thing), move it, make it
//                  bigger or smaller, flip it, take it out, add a piece from the world's kit, undo. Every change is kept
//                  at once (town_edits.js: the person's own row, per theme and per place, as a room recipe), so leaving
//                  by any route loses nothing. WHY NOT THE ROOM PANEL'S RENDERER: room_scene.js draws and runs a room
//                  but has no editing path (it never had one; library.js says "putting one piece into a room of your own
//                  is not built yet"), and the cards draw places with town.js's FLAT drawing. Editing on that same flat
//                  drawing means what the person sees while rearranging is exactly what the cards will show.
//                  The Park is a scene-builder recipe (outdoor): opened full size, not rearranged here yet.
//   THE CARDS      card_deck.js `cardArt(..., { town })` draws the person's edits: an edited King's hall is behind the
//                  King on every card game this person plays (solitaire and card sort read town_edits.js too).
//
// *** EVERY WAY IN. ***
//   * ONE SWITCH: the buttons light up one after another by themselves (`lightMoves: 'auto'`, every `scanMs`, never
//     faster than the screen's flashing limit); a press does the lit one. The light rests after IDLE_MS with no press,
//     and the next press only wakes it (Sort the bricks' rule: a press is never spent on a choice nobody was watching).
//   * TWO SWITCHES: next / previous move the light, select does it. Back goes back a level.
//   * TOUCH: any place or button, directly.
//   * VOICE: "go to the bakery", "King Bram", "the Ice Hall", "back to the town" - said without the wake phrase while
//     the town is listening (`listenForPlaces`, for `townListenMs` after it is shown or pressed), through the speech
//     layer's answer seam (input_speech.js `speech/grammar` / `speech/answer`, the voice games' own). With the wake
//     phrase, "next place", "go in" and "go back" are the module's own phrases (manifest `voice`).
//
// *** NOTHING WAITS ON ANYBODY. *** Left alone the town is a picture. An open place, the editor and the piece list all go
// back to the town by themselves after `townReturnMs` (default 2 minutes, "Never" is the person's own choice), and the
// light stops after IDLE_MS. Nothing here asks a question.
//
// *** "TALK TO <CHARACTER>": A SEAM, NOT A CONVERSATION. *** town_talk.js. The button publishes `town/talk` and hands
// the request to whatever registered (`registerTownTalk`: the AI storyteller, built separately). Shown by default only
// once something has registered, so a scan never stops on a button that does nothing.

import { registerModule } from '../module.js';
import { PLACES, TOWN_DRESS, placeSvg, placeInfo } from '../town.js';
import { cardArt, cardOptions, stableIds, watchTheme, deckFor } from '../card_deck.js';
import { cardSvg } from '../playing_cards.js';
import {
  openTownEdits, personOf, EDITABLE_PLACES, PLACE_IDS, TOWN_THEMES, recipeFor, itemName, moveItem, scaleItem, flipItem,
  removeItem, addPiece, piecesFor, pieceName, isWallPiece, RECIPE_MAX_ITEMS,
} from '../town_edits.js';
import { sceneSvg } from '../town_scene.js';
import { talkTo, townTalkReady, onTownTalkChange } from '../town_talk.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
import { SPEECH_GRAMMAR_TOPIC, SPEECH_ANSWER_TOPIC, UNKNOWN_WORD, normalize } from '../input_speech.js';

export const TYPE = 'town';
export const TITLE = 'Town';

// A town nobody is pressing comes to rest: the light stops. 45 s, Sort the bricks' number and reason (longer than a
// person thinking takes, three laps of the town's eight places at the default step is 96 s, short enough that an empty
// room does not watch a light go round for long). Not a setting.
export const IDLE_MS = 45000;
// How far one press of "Move left" moves a thing: 4% of the room (about a chair's width at the back, a third of one at
// the front). Fine enough to place a lamp beside a chair; coarse enough that crossing the room is ~20 presses, not 100.
export const MOVE_STEP = 4;

export const VOICE = Object.freeze({
  'next place': 'next', 'previous place': 'prev', 'go in': 'select', 'open it': 'select', 'go back': 'back',
  'back to the town': 'back',
});

// Who lives where, for the resident standing at home and "Talk to".
export const RESIDENT = Object.freeze({ kingHall: 'king', queenParlour: 'queen', jackWorkshop: 'jack', jokerCaravan: 'joker' });
export const RESIDENT_NAME = Object.freeze({ king: 'King Bram', queen: 'Queen Rosa', jack: 'Jack Theo', joker: 'Pip the Joker' });
// The card drawn from each place (klondike's { s, r }): the court card for a home, the Ace for a suit's place.
const PLACE_CARD = { kingHall: { s: 'H', r: 13 }, queenParlour: { s: 'H', r: 12 }, jackWorkshop: { s: 'H', r: 11 },
  bakery: { s: 'H', r: 1 }, shop: { s: 'D', r: 1 }, park: { s: 'C', r: 1 }, library: { s: 'S', r: 1 } };

export const DEFAULTS = Object.freeze({
  townTheme: 'screen',
  lightMoves: 'auto',
  scanMs: 4000,
  sayChoice: true,
  sayPlaces: true,
  townReturnMs: 120000,
  listenForPlaces: true,
  townListenMs: 60000,
  talk: 'ready',
});

// *** THE DEFAULTS, ARGUED (each on Mike's list). ***
//   townTheme 'screen'   the town in the theme on screen: change the theme and the town changes with it, as the cards
//                        do. A fixed theme is for rearranging the Halloween hall in June.
//   lightMoves 'auto', scanMs 4 s, sayChoice on   Sort the bricks' rows, the same keys and words (the settings audit
//                        holds shared keys to one meaning). 4 s a stop is a lap of the eight places in 32 s.
//   sayPlaces on         opening a place says its name and one line about it, where the screen's voice is on: the
//                        town is a picture book for somebody who may not read the sign. Off for a quiet room.
//   townReturnMs 2 min   the room panel's close-up number and reason: long enough to look properly, short enough that
//                        a place opened by a stray press does not stay all afternoon. "Never" is a choice.
//   listenForPlaces on, townListenMs 1 min   FOR: Mike's "go to the bakery" works said plainly, right after the town
//                        appears or is pressed. AGAINST: while it listens, words said WITHOUT the wake phrase go to the
//                        town, and the speech layer silences videos and music beside it as it does for any voice game
//                        ("Silence videos and music while a voice game waits for an answer", on by default). A minute
//                        bounds that; "As long as the town shows" and off are each one setting away. Only with the
//                        microphone on, and never during the editor (rearranging is buttons).
//   talk 'ready'         the "Talk to" button shows once the AI storyteller is set up: until then it would be a stop in
//                        every one-switch lap that does nothing. 'always' shows it now (and says it is not set up).
const THEME_OPTIONS = [{ value: 'screen', label: 'The theme on the screen' },
  ...TOWN_THEMES.map((k) => ({ value: k, label: TOWN_DRESS[k].label }))];
const SETTINGS = [
  { key: 'townTheme', label: 'Which town', kind: 'choice', default: DEFAULTS.townTheme, level: 'essential', options: THEME_OPTIONS,
    note: 'Each theme has its own town. A place rearranged in one theme keeps its own look in the others.' },
  { key: 'lightMoves', label: 'The light on the places', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Moves by itself. A press opens the lit place. One switch can use it' },
      { value: 'off', label: 'Moves only when told: Next moves it, Select opens it' }],
    note: 'A place touched always opens.' },
  { key: 'scanMs', label: 'How long each choice stays lit', kind: 'choice', default: 4000, level: 'standard',
    options: [2000, 3000, 4000, 6000, 10000, 15000].map((v) => ({ value: v, label: `${v / 1000} seconds` })),
    note: 'Never faster than the screen\'s flashing limit.', appliesWhen: (v) => !v || v.lightMoves !== 'off' },
  { key: 'sayChoice', label: 'Say each place as it lights', default: true, level: 'standard',
    onLabel: 'Yes ("The Bakery?")', offLabel: 'No', note: 'Somebody using a switch needs it.' },
  { key: 'sayPlaces', label: 'Say a place\'s name and what it is when it opens', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No' },
  { key: 'townReturnMs', label: 'Go back to the whole town after', kind: 'choice', default: DEFAULTS.townReturnMs, level: 'standard',
    options: [{ value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' }, { value: 300000, label: '5 minutes' },
      { value: 0, label: 'Never (press Back yourself)' }],
    note: 'An open place, and rearranging one, go back by themselves when nobody has pressed anything for this long. '
      + 'Every change is already kept.' },
  { key: 'listenForPlaces', label: 'Go to a place by saying its name', default: true, level: 'standard',
    onLabel: 'Yes ("go to the bakery")', offLabel: 'No',
    note: 'Only with the microphone on. While it listens, words said without the wake phrase go to the town, '
      + 'and videos and music beside it go quiet, as for any game that listens.' },
  { key: 'townListenMs', label: 'Listen for place names for', kind: 'choice', default: DEFAULTS.townListenMs, level: 'standard',
    options: [{ value: 30000, label: '30 seconds after the town shows or is pressed' },
      { value: 60000, label: '1 minute after the town shows or is pressed' },
      { value: 300000, label: '5 minutes after the town shows or is pressed' },
      { value: 0, label: 'As long as the town shows' }],
    appliesWhen: (v) => !v || v.listenForPlaces !== false },
  { key: 'talk', label: '"Talk to" buttons in the characters\' homes', kind: 'choice', default: DEFAULTS.talk, level: 'standard',
    options: [{ value: 'ready', label: 'Once the AI storyteller is set up' }, { value: 'always', label: 'Always' },
      { value: 'never', label: 'Never' }] },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripThe = (s) => String(s || '').replace(/^the /, '');

// ---- voice: the words the town listens for, and what they mean --------------------------------------------
/** Every way of naming each place in a deck: { phrase (normalized, no leading "the"): placeId }, plus 'town'. */
export function placeNames(deck = 'nimrod') {
  const out = {};
  const add = (name, id) => { const n = stripThe(normalize(name)); if (n && !(n in out)) out[n] = id; };
  for (const id of PLACE_IDS) {
    const p = placeInfo(id, deck);
    add(p.label, id);
    add(PLACES[id].label, id);   // the Nimrod name works in every world ("the Great Hall" is still the King's)
    const who = RESIDENT[id];
    if (who) {
      add(RESIDENT_NAME[who], id);
      add({ king: 'King Bram', queen: 'Queen Rosa', jack: 'Jack Theo', joker: 'Pip' }[who], id);
      add(`${{ king: 'the king', queen: 'the queen', jack: 'jack', joker: 'pip' }[who]}s home`, id);
    }
  }
  add('town', 'town');
  add('the whole town', 'town');
  return out;
}
const PREFIX = /^(please )?(go to|go into|take me to|lets go to|let s go to|let us go to|visit|show me|show|open)\s+/;
/** What was said, as a place id (or 'town'), or null. */
export function placeFromSpeech(text, deck = 'nimrod') {
  let s = normalize(text);
  if (/^(go )?back( to the town)?$/.test(s)) return 'town';
  s = stripThe(s.replace(PREFIX, ''));
  return placeNames(deck)[s] || null;
}
/** The grammar: every name, with and without "go to (the)", plus the ways back. */
export function placeWords(deck = 'nimrod') {
  const words = new Set(['back', 'go back', 'back to the town']);
  for (const n of Object.keys(placeNames(deck))) {
    words.add(n); words.add(`the ${n}`); words.add(`go to ${n}`); words.add(`go to the ${n}`);
  }
  return [...words, UNKNOWN_WORD];
}

// ---- the look ----------------------------------------------------------------------------------------------
const STYLE_ID = 'town-style';
const CSS = `
.tw-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;container-type:size;font-family:var(--font)}
.tw-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px}
.tw-wrap *{box-sizing:border-box}
.tw{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:.35rem;padding:.45rem}
.tw [hidden]{display:none !important}
.tw-head{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin:0;font:800 clamp(14px,4.4cqh,26px)/1.15 var(--font);color:var(--text-strong, var(--text))}
.tw-head small{font-weight:600;font-size:.7em;color:var(--text)}
.tw-body{min-height:0;display:grid}
.tw-map{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);gap:1.4cqh 1.2cqw;min-height:0}
@container (max-aspect-ratio: 1/1){.tw-map{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tw-btn,.tw-tile{font:inherit;color:var(--text-strong, var(--text));background:var(--surface);border:2px solid var(--border, #c9c3ad);
  border-radius:12px;cursor:pointer;touch-action:manipulation}
.tw-tile{display:grid;grid-template-rows:minmax(0,1fr) auto;gap:2px;padding:0;overflow:hidden;min-height:0;text-align:left}
.tw-tile svg{display:block;width:100%;height:100%;min-height:0}
.tw-tile b{display:block;padding:2px 8px 0;font-size:clamp(11px,2.6cqh,18px)}
.tw-tile small{display:block;padding:0 8px 6px;font-size:clamp(10px,2.1cqh,14px);color:var(--text)}
.tw-btn{min-height:44px;padding:.35em .9em;font-weight:700;font-size:clamp(13px,3cqh,20px)}
.tw-btn[disabled]{opacity:.5;cursor:default}
.tw-tile[data-lit="1"],.tw-btn[data-lit="1"]{outline:5px solid var(--scan-ring, var(--focus, currentColor));outline-offset:3px}
.tw-place{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:1.2cqw;min-height:0}
@container (max-aspect-ratio: 5/4){.tw-place{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.6fr) minmax(0,1fr)}}
.tw-pic{min-height:0;display:flex;align-items:center;justify-content:center;border-radius:12px;overflow:hidden}
.tw-pic svg{display:block;width:100%;height:100%;max-height:100%}
.tw-pic[data-edit]{color:var(--scan-ring, var(--focus, currentColor))}
.tw-side{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:.45rem}
.tw-side p{margin:0;font-size:clamp(13px,3cqh,20px)}
.tw-btns{display:flex;flex-wrap:wrap;gap:.4rem}
.tw-cards{display:flex;gap:.4rem;flex-wrap:wrap}
.tw-card{width:clamp(48px,14cqh,92px);aspect-ratio:250/350}
.tw-card svg{display:block;width:100%;height:100%}
.tw-say{margin:0;min-height:1.3em;font-size:clamp(13px,2.9cqh,20px);font-weight:600;color:var(--text-strong, var(--text))}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

registerModule(
  { type: TYPE, title: TITLE, core: 'new',
    description: 'The theme\'s town: the four characters\' homes and a place for each suit. Open a place to see it full '
      + 'size, or rearrange it, and the playing cards drawn from it change too. One switch, touch or voice ("go to the bakery").',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const clear = (h) => { if (h != null) { try { clearT(h); } catch { /* gone */ } } return null; };
    const artId = `tw${String(ctx.instanceId || 'x').replace(/[^\w-]/g, '')}`;

    let cfg = { ...DEFAULTS };
    let dead = false, hidden = false;
    let rootEl = null, headEl = null, bodyEl = null, sayEl = null;
    let themeWatch = null, store = null, offStore = null, offTalk = null;
    let view = 'map';            // 'map' | 'place' | 'edit' | 'add'
    let place = null;            // the place open (a place id)
    let draft = null;            // the recipe being rearranged
    let sel = 0;                 // the thing chosen in it
    let undo = [];
    let addGroup = -1;           // in the piece list: -1 the groups, else which group
    let lit = -1;
    let idle = true;
    let news = '';
    let lightTimer = null, idleTimer = null, returnTimer = null, listenTimer = null;
    let listening = false;
    let litSaid = null;
    let lastBody = '';
    const said = [];             // what was said, for a suite
    const talks = [];            // talk requests made, for a suite

    const deckNow = () => (cfg.townTheme && cfg.townTheme !== 'screen' && TOWN_THEMES.includes(cfg.townTheme)
      ? cfg.townTheme : deckFor(themeWatch ? themeWatch.id() : 'default'));
    const themeLabel = () => (TOWN_DRESS[deckNow()] || TOWN_DRESS.nimrod).label;
    const edits = () => (store ? store.forDeck(deckNow()) : {});
    const lightStepMs = () => Math.max(Number(cfg.scanMs) || DEFAULTS.scanMs, minFlashPeriodMs(flashLimit(ctx)));
    const talkShown = () => cfg.talk === 'always' || (cfg.talk !== 'never' && townTalkReady());

    // ---- speech ----------------------------------------------------------------------------------------------
    function speak(text, { cancelLast = false } = {}) {
      if (!text || dead || hidden || !ctx.output?.say) return null;
      try {
        if (cancelLast && litSaid && ctx.output.cancel) ctx.output.cancel(litSaid);
        const id = ctx.output.say(text, { source: TYPE });
        said.push(text);
        if (said.length > 60) said.shift();
        return id;
      } catch (err) { console.error('town: say', err); return null; }
    }

    // ---- the stops (what the light walks) -----------------------------------------------------------------------
    // A button that cannot do anything now (Undo with nothing to undo) is not a stop: the light skips it.
    const stops = () => (bodyEl ? [...mount.querySelectorAll('[data-stop]:not([disabled])')] : []);
    function paintLit() {
      const list = stops();
      list.forEach((el, i) => { if (i === lit && !idle) el.setAttribute('data-lit', '1'); else el.removeAttribute('data-lit'); });
    }
    function sayLit() {
      if (!cfg.sayChoice || idle) return;
      const el = stops()[lit];
      const words = el?.getAttribute('data-say') || el?.textContent || '';
      const id = speak(`${words.trim()}?`, { cancelLast: true });
      if (id) litSaid = id;
    }
    const lightWanted = () => !dead && !hidden && !idle && cfg.lightMoves !== 'off' && stops().length > 1;
    function armLight() {
      lightTimer = clear(lightTimer);
      if (!lightWanted()) return;
      lightTimer = setT(() => { lightTimer = null; if (lightWanted()) moveLight(1); }, lightStepMs());
    }
    function moveLight(dir) {
      const n = stops().length;
      if (!n) return;
      lit = lit < 0 ? (dir > 0 ? 0 : n - 1) : ((lit + dir) % n + n) % n;
      paintLit(); sayLit(); armLight();
    }

    // ---- being pressed, resting, and going back by itself -------------------------------------------------------
    function markInput() {
      const was = idle;
      idle = false;
      idleTimer = clear(idleTimer);
      idleTimer = setT(goIdle, IDLE_MS);
      armReturn();
      openListening();
      return was;
    }
    function goIdle() {
      idleTimer = null;
      if (dead || idle) return;
      idle = true; lit = -1;
      lightTimer = clear(lightTimer);
      paintLit();
    }
    function armReturn() {
      returnTimer = clear(returnTimer);
      const ms = Number(cfg.townReturnMs) || 0;
      if (dead || hidden || view === 'map' || !(ms > 0)) return;
      returnTimer = setT(() => { returnTimer = null; if (!dead && view !== 'map') toMap(); }, ms);
    }

    // ---- voice: listening for place names ----------------------------------------------------------------------
    function announce(open) {
      try {
        bus.publish(SPEECH_GRAMMAR_TOPIC, { source: TYPE, instanceId: ctx.instanceId || null, phase: view,
          open: !!open, words: open ? placeWords(deckNow()) : [] });
      } catch { /* nobody listening */ }
    }
    const listenWanted = () => !dead && !hidden && cfg.listenForPlaces !== false && (view === 'map' || view === 'place');
    function openListening() {
      listenTimer = clear(listenTimer);
      if (!listenWanted()) { if (listening) { listening = false; announce(false); } return; }
      listening = true;
      announce(true);
      const ms = Number(cfg.townListenMs);
      if (ms > 0) listenTimer = setT(() => { listenTimer = null; if (listening) { listening = false; announce(false); } }, ms);
    }
    function heard(r) {
      if (dead || !listening) return;
      const text = r && typeof r === 'object' ? r.text : r;
      const id = placeFromSpeech(text, deckNow());
      if (!id) return;
      markInput();
      if (id === 'town') toMap();
      else openPlace(id);
    }

    // ---- the views ------------------------------------------------------------------------------------------------
    function toMap() {
      view = 'map'; draft = null; undo = []; addGroup = -1;
      lit = idle ? -1 : Math.max(0, PLACE_IDS.indexOf(place));
      news = '';
      render();
      openListening();
      returnTimer = clear(returnTimer);
    }
    function openPlace(id) {
      if (!PLACES[id]) return;
      view = 'place'; place = id; draft = null; undo = []; addGroup = -1; lit = idle ? -1 : 0; news = '';
      render();
      armReturn();
      if (cfg.sayPlaces) { const p = placeInfo(id, deckNow()); speak(`${p.label}. ${p.blurb}`); }
    }
    function startEdit() {
      if (!EDITABLE_PLACES.includes(place)) return;
      draft = recipeFor(place, deckNow(), edits());
      sel = draft.items.length ? 0 : -1; undo = []; addGroup = -1;
      view = 'edit'; lit = idle ? -1 : 0; news = '';
      listenTimer = clear(listenTimer);
      if (listening) { listening = false; announce(false); }
      render(); armReturn();
    }
    function keep(next, words) {
      undo.push(draft);
      if (undo.length > 30) undo.shift();
      draft = next;
      const ok = store ? store.save(deckNow(), place, draft) : false;
      news = ok ? words : 'That could not be kept.';
      render();
    }
    const selName = () => (draft && draft.items[sel] ? itemName(draft.items[sel]) : 'nothing');
    const EDIT_ACTS = {
      next: () => { if (!draft.items.length) return; sel = (sel + 1) % draft.items.length; news = `Chosen: ${selName()}.`; speak(selName()); render(); },
      left: () => sel >= 0 && keep(moveItem(draft, sel, -MOVE_STEP, 0), `Moved left: ${selName()}.`),
      right: () => sel >= 0 && keep(moveItem(draft, sel, MOVE_STEP, 0), `Moved right: ${selName()}.`),
      up: () => sel >= 0 && keep(moveItem(draft, sel, 0, -MOVE_STEP), `Moved back: ${selName()}.`),
      down: () => sel >= 0 && keep(moveItem(draft, sel, 0, MOVE_STEP), `Moved forward: ${selName()}.`),
      bigger: () => sel >= 0 && keep(scaleItem(draft, sel, 1), `Bigger: ${selName()}.`),
      smaller: () => sel >= 0 && keep(scaleItem(draft, sel, -1), `Smaller: ${selName()}.`),
      flip: () => sel >= 0 && keep(flipItem(draft, sel), `Turned round: ${selName()}.`),
      remove: () => {
        if (sel < 0) return;
        const name = selName();
        keep(removeItem(draft, sel), `Taken out: ${name}.`);
        sel = draft.items.length ? Math.min(sel, draft.items.length - 1) : -1;
        render();
      },
      add: () => { view = 'add'; addGroup = -1; lit = idle ? -1 : 0; news = ''; render(); },
      undo: () => {
        if (!undo.length) return;
        draft = undo.pop();
        if (store) store.save(deckNow(), place, draft);
        sel = draft.items.length ? Math.min(Math.max(sel, 0), draft.items.length - 1) : -1;
        news = 'Undone.'; render();
      },
      done: () => { view = 'place'; draft = null; undo = []; lit = idle ? -1 : 0; news = 'Kept.'; render(); openListening(); },
    };
    function choosePiece(part) {
      const { recipe, index } = addPiece(draft, part);
      if (index < 0) { news = `This room is full (${RECIPE_MAX_ITEMS} things).`; view = 'edit'; render(); return; }
      view = 'edit'; addGroup = -1; lit = idle ? -1 : 0;
      keep(recipe, `Added: ${pieceName(part)}. Move it where you want it.`);
      sel = index; render();
    }
    async function talk() {
      const who = RESIDENT[place];
      if (!who) return;
      const p = placeInfo(place, deckNow());
      const req = { character: who, name: RESIDENT_NAME[who], place, placeLabel: p.label, blurb: p.blurb, theme: deckNow(),
        instanceId: ctx.instanceId || null, personId: personOf(ctx) };
      talks.push(req);
      const taken = await talkTo(req, { bus });
      if (dead) return;
      if (!taken) { news = `Talking to ${RESIDENT_NAME[who]} is not set up on this screen yet.`; render(); }
    }

    function addBack() { if (addGroup >= 0) addGroup = -1; else view = 'edit'; lit = idle ? -1 : 0; render(); }
    // A stop pressed (by the light, a touch or a key).
    function activate(el) {
      if (!el) return;
      const act = el.getAttribute('data-act');
      if (act === 'open') { openPlace(el.getAttribute('data-place')); return; }
      if (act === 'town') { toMap(); return; }
      if (act === 'edit') { startEdit(); return; }
      if (act === 'talk') { talk(); return; }
      if (act === 'reset') {
        if (store) store.reset(deckNow(), place);
        news = `Put back to the ${themeLabel()} version.`; lit = idle ? -1 : 0; render(); return;
      }
      if (act === 'group') { addGroup = Number(el.getAttribute('data-group')); lit = idle ? -1 : 0; render(); return; }
      if (act === 'piece') { choosePiece(el.getAttribute('data-piece')); return; }
      if (act === 'addback') { addBack(); return; }
      if (EDIT_ACTS[act] && draft) { EDIT_ACTS[act](); }
    }
    function press() {
      if (dead) return;
      const wasIdle = markInput();
      const list = stops();
      if (!list.length) return;
      // A press that wakes a town at rest only wakes it: the light starts on the first stop.
      if (wasIdle || lit < 0) { lit = 0; paintLit(); sayLit(); armLight(); return; }
      activate(list[Math.min(lit, list.length - 1)]);
      if (lit >= stops().length) lit = 0;
      paintLit(); armLight();
    }
    function move(dir) {
      if (dead) return;
      const wasIdle = markInput();
      if (wasIdle) { lit = 0; paintLit(); sayLit(); armLight(); return; }
      moveLight(dir);
    }
    function back() {
      if (dead) return;
      markInput();
      if (view === 'add') addBack();
      else if (view === 'edit') EDIT_ACTS.done();
      else if (view === 'place') toMap();
      paintLit(); armLight();
    }

    function onClick(e) {
      if (dead || !(e.target instanceof Element)) return;
      const el = e.target.closest('[data-stop]');
      if (!el || !mount.contains(el) || el.hasAttribute('disabled')) return;
      markInput();
      lit = stops().indexOf(el);
      activate(el);
      if (lit >= stops().length) lit = 0;
      paintLit(); armLight();
    }
    function onKey(e) {
      if (dead || e.repeat) return;
      let act = null;
      if (e.key === 'Enter' || e.key === ' ') act = () => press();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') act = () => move(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') act = () => move(-1);
      else if (e.key === 'Escape' || e.key === 'Backspace') act = () => back();
      if (act) { e.preventDefault(); e.stopPropagation(); act(); }
    }

    // ---- drawing --------------------------------------------------------------------------------------------------
    const btn = (act, label, extra = '', say = '') => `<button type="button" class="tw-btn" data-stop data-act="${act}"${extra}`
      + `${say ? ` data-say="${esc(say)}"` : ''}>${esc(label)}</button>`;
    function cardsHtml(id) {
      const town = edits();
      const deck = deckNow();
      const one = (svg, name) => `<span class="tw-card" role="img" aria-label="${esc(name)}">${svg}</span>`;
      if (id === 'jokerCaravan') {
        let svg = cardSvg({ rank: 'joker' }, deck, cardOptions({ cardScenery: 'on' }, { deck, town }));
        svg = stableIds(svg.replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true" focusable="false"'), artId);
        return one(svg, 'the joker');
      }
      const c = PLACE_CARD[id];
      if (!c) return '';
      const name = { 13: 'king', 12: 'queen', 11: 'jack', 1: 'ace' }[c.r] + ' of ' + { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' }[c.s];
      return one(cardArt({ ...c, up: true }, themeWatch ? themeWatch.id() : 'default', { cardScenery: 'on' },
        { idSuffix: artId, town: Object.keys(town).length ? town : null }), name);
    }
    function mapHtml() {
      const deck = deckNow(), town = edits();
      return `<div class="tw-map">${PLACE_IDS.map((id) => {
        const p = placeInfo(id, deck);
        const who = RESIDENT[id];
        const sub = who ? `${RESIDENT_NAME[who]}'s home` : `${PLACES[id].suit[0].toUpperCase()}${PLACES[id].suit.slice(1)}, in town`;
        return `<button type="button" class="tw-tile" data-stop data-act="open" data-place="${id}" data-say="${esc(p.label)}"`
          + ` aria-label="${esc(`${p.label}, ${sub}${town[id] ? ', rearranged' : ''}`)}">`
          + `${placeSvg(id, deck, town[id] ? { edited: town[id] } : {})}<b>${esc(p.label)}</b><small>${esc(sub)}${town[id] ? ' · rearranged' : ''}</small></button>`;
      }).join('')}</div>`;
    }
    function placeHtml() {
      const deck = deckNow(), town = edits(), p = placeInfo(place, deck), who = RESIDENT[place];
      const scene = sceneSvg({ place, deck, edited: town[place] || null, cast: who ? [{ role: who, pose: 'wave' }] : [],
        title: who ? `${p.label}, with ${RESIDENT_NAME[who]} at home` : p.label });
      const btns = [btn('town', 'Back to the town')];
      if (EDITABLE_PLACES.includes(place)) btns.push(btn('edit', 'Rearrange'));
      if (who && talkShown()) btns.push(btn('talk', `Talk to ${RESIDENT_NAME[who]}`));
      if (town[place]) btns.push(btn('reset', `Put it back to the ${themeLabel()} version`));
      const outdoor = !EDITABLE_PLACES.includes(place)
        ? '<p>The park changes with the season. It cannot be rearranged here yet.</p>' : '';
      return `<div class="tw-place"><div class="tw-pic" data-pic>${scene}</div><div class="tw-side">`
        + `<p>${esc(p.blurb)}</p>${outdoor}<div class="tw-btns">${btns.join('')}</div>`
        + `<div><p>The cards drawn from it:</p><div class="tw-cards">${cardsHtml(place)}</div></div></div></div>`;
    }
    function editHtml() {
      const deck = deckNow(), p = placeInfo(place, deck);
      let scene = sceneSvg({ place, deck, edited: draft, title: `${p.label}, being rearranged` });
      const it = draft.items[sel];
      if (it) {
        const cx = it.x * 9.6, cy = it.kind === 'furniture' && !isWallPiece(it.part) ? it.y * 5.4 - 50 : it.y * 5.4;
        scene = scene.replace(/<\/svg>$/, `<circle cx="${cx}" cy="${cy}" r="58" fill="none" stroke="currentColor" stroke-width="7" stroke-dasharray="14 9" data-chosen/></svg>`);
      }
      const has = sel >= 0;
      const dis = has ? '' : ' disabled';
      const btns = [btn('done', 'Done'), btn('next', `Next thing (now: ${selName()})`, draft.items.length > 1 ? '' : ' disabled', 'Next thing'),
        btn('left', 'Move left', dis), btn('right', 'Move right', dis), btn('up', 'Move back', dis), btn('down', 'Move forward', dis),
        btn('bigger', 'Bigger', dis), btn('smaller', 'Smaller', dis), btn('flip', 'Turn round', dis), btn('remove', 'Take it out', dis),
        btn('add', 'Add a piece'), btn('undo', 'Undo', undo.length ? '' : ' disabled')];
      return `<div class="tw-place"><div class="tw-pic" data-pic data-edit>${scene}</div><div class="tw-side">`
        + `<p>Chosen: <b data-chosen-name>${esc(selName())}</b></p><div class="tw-btns">${btns.join('')}</div></div></div>`;
    }
    function addHtml() {
      const groups = piecesFor(deckNow());
      const btns = [btn('addback', addGroup >= 0 ? 'Back to the groups' : 'Back to rearranging')];
      if (addGroup < 0) groups.forEach(([label], i) => btns.push(btn('group', label, ` data-group="${i}"`)));
      else (groups[addGroup] ? groups[addGroup][1] : []).forEach((part) => btns.push(btn('piece', pieceName(part), ` data-piece="${part}"`)));
      return `<div class="tw-side"><p>${addGroup >= 0 ? esc(groups[addGroup][0]) : 'Add a piece: choose a group'}</p>`
        + `<div class="tw-btns">${btns.join('')}</div></div>`;
    }
    function headHtml() {
      if (view === 'map') return `The town <small>${esc(themeLabel())}</small>`;
      const p = placeInfo(place, deckNow());
      return `${esc(p.label)} <small>${view === 'map' ? '' : view === 'place' ? esc(themeLabel()) : 'Rearranging'}</small>`;
    }
    function statusLine() {
      if (news) return news;
      if (view === 'map') return idle && cfg.lightMoves !== 'off' ? 'Choose a place. Press to start the light.' : 'Choose a place.';
      if (view === 'edit') return `Choose a thing with "Next thing", then move it. Every change is kept.`;
      if (view === 'add') return 'Choose a piece to add.';
      return '';
    }
    function render() {
      if (dead || !rootEl) return;
      if (view !== 'map' && !PLACES[place]) view = 'map';
      if ((view === 'edit' || view === 'add') && !draft) view = 'place';
      rootEl.dataset.view = view;
      headEl.innerHTML = headHtml();
      const body = view === 'map' ? mapHtml() : view === 'place' ? placeHtml() : view === 'edit' ? editHtml() : addHtml();
      if (body !== lastBody) { bodyEl.innerHTML = body; lastBody = body; }
      sayEl.textContent = statusLine();
      const n = stops().length;
      if (lit >= n) lit = n ? 0 : -1;
      paintLit();
    }

    return {
      __probe: () => ({ view, place, deck: deckNow(), sel, draft, undo: undo.length, lit, idle, listening, news,
        said: said.slice(), talks: talks.slice(), edits: edits(), stops: stops().map((el) => el.getAttribute('data-act')),
        lightRunning: lightTimer != null, lightStepMs: lightStepMs(), person: store ? store.isPerson() : false,
        timers: [lightTimer, idleTimer, returnTimer, listenTimer].filter((h) => h != null).length }),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStyle(doc);
        mount.innerHTML = `<div class="tw-wrap" data-tw-root tabindex="0" aria-label="${esc(TITLE)}"><div class="tw">`
          + '<h2 class="tw-head" data-head></h2><div class="tw-body" data-body></div>'
          + '<p class="tw-say" role="status" aria-live="polite"></p></div></div>';
        rootEl = mount.querySelector('[data-tw-root]');
        headEl = mount.querySelector('[data-head]');
        bodyEl = mount.querySelector('[data-body]');
        sayEl = mount.querySelector('.tw-say');
        mount.addEventListener('click', onClick);
        mount.addEventListener('keydown', onKey);

        const applyCfg = (snap) => {
          const s = snap || {};
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined && s[k] !== null) next[k] = s[k];
          cfg = next;
        };
        applyCfg(state?.get?.());
        store = openTownEdits({ makePersonState: typeof ctx.makePersonState === 'function' ? ctx.makePersonState : null,
          personId: () => personOf(ctx), fallback: state || null });
        offStore = store.subscribe(() => { if (view !== 'edit') render(); });
        offTalk = onTownTalkChange(() => render());
        themeWatch = watchTheme(mount, () => {
          // A new theme is a new town: an edit in progress belonged to the old one (and is already kept).
          if (view === 'edit' || view === 'add') { view = 'place'; draft = null; undo = []; }
          lastBody = ''; render(); if (listening) announce(true);
        });
        state?.subscribe?.((s) => {
          const was = cfg.townTheme;
          applyCfg(s);
          if (was !== cfg.townTheme && (view === 'edit' || view === 'add')) { view = 'place'; draft = null; undo = []; }
          render(); armLight(); armReturn();
          if (listenWanted() !== listening) openListening();
        });

        bus.subscribe(`${TYPE}/select`, () => press());
        bus.subscribe(`${TYPE}/next`, () => move(1));
        bus.subscribe(`${TYPE}/prev`, () => move(-1));
        bus.subscribe(`${TYPE}/back`, () => back());
        bus.subscribe(`${TYPE}/open`, (p) => { markInput(); openPlace(typeof p === 'object' && p ? p.place : p); });
        bus.subscribe(SPEECH_ANSWER_TOPIC, (r) => heard(r));
        render();
        openListening();
      },
      onResize() { /* the layout is CSS; nothing to measure */ },
      onHide() {
        hidden = true;
        lightTimer = clear(lightTimer); returnTimer = clear(returnTimer); listenTimer = clear(listenTimer);
        if (listening) { listening = false; announce(false); }
      },
      onShow() { hidden = false; render(); armLight(); armReturn(); openListening(); },
      destroy() {
        dead = true;
        lightTimer = clear(lightTimer); idleTimer = clear(idleTimer); returnTimer = clear(returnTimer); listenTimer = clear(listenTimer);
        if (listening) { listening = false; try { bus.publish(SPEECH_GRAMMAR_TOPIC, { source: TYPE, instanceId: ctx.instanceId || null, open: false, words: [] }); } catch { /* gone */ } }
        mount.removeEventListener('click', onClick);
        mount.removeEventListener('keydown', onKey);
        try { offStore?.(); } catch { /* gone */ }
        try { offTalk?.(); } catch { /* gone */ }
        try { themeWatch?.stop(); } catch { /* gone */ }
        try { store?.destroy(); } catch { /* gone */ }
        store = null; themeWatch = null;
      },
    };
  },
);
