// modules/solitaire.js — KLONDIKE SOLITAIRE, PLAYABLE ON ONE SWITCH.
//
// Row 2.37 ("Solitaire and other card games", docs/for_chat/MIKE_CHANGE_LIST.md, private repo) and
// Design's room-add-ons spec §10: *"Cards: Klondike first ... Cards are 110px+ wide on the kiosk.
// The suits use four colours AND their symbols. A move is pick a card → pick where, with the legal
// places listed. One switch can play."* The rules are `../klondike.js`; this file is the table.
//
// A MOVE IS TWO CHOICES, AND EACH IS A SHORT LIST. First the cards that can go somewhere (plus
// "Draw", "Undo", "New game"); then, for the card picked, the places it can legally go (plus "Put it
// back"). `next`/`prev` walk the list and wrap; `select` takes the lit one. Nothing needs a drag and
// nothing needs a pointer: a pointer can click a card and then a place, which is the same two choices.
// Dragging is not built — it would be a third way to do the same thing, and the spec asks for none.
//
// NO FAIL SCREEN, NO TIMER, NO LIVES. When it looks as though no move helps, the bar says so and
// points at Undo and New game — beside the cards, never over them; the table stays playable. Undo
// has no limit (the game is saved as its seed plus the moves made, so undo survives a reload too).
// Moves and time are hidden unless somebody turns them on.
//
// THE SCORE is "cards home" (0 to 52), published on the score contract (`../score_source.js`) so a
// Scoreboard can follow it; drawn here only when no scoreboard shows it (`ownScore`, default auto).
//
// DEFAULTS CHOSEN HERE — each is a setting, each is on Mike's list with the argument:
//   * Draw one card (not three). Draw three is the harder, classic game and is one setting away.
//   * Auto-move: SAFE cards only. On one switch every move is at least two presses, and putting an
//     ace home is never a decision. "Safe" is the rule that never takes a card a player might still
//     want in a column. "Off" and "every card that can go" are the other two.
//   * Only cards that can move are offered. Offering every face-up card is a setting; the default
//     keeps a switch walk short, at the cost of acting as a hint — said here rather than hidden.
//   * A win pays NOTHING by default. See `winPoints` below for the argument.
//   * Nothing is read aloud by default; "Say what is lit" is a setting for someone who scans by ear.
//   * THE CARDS ARE DESIGN'S (2026-10-10, `../playing_cards.js` through `../card_deck.js`): the theme's own deck,
//     back and face, redrawn when the theme changes. Since Design's characters handoff (2026-10-12) the court
//     cards are characters at home and each card can show its place in the theme's town; the defaults (suit
//     marks, four colours, scenery where it measured readable) and the other choices are card_deck.js's
//     (`cardSettingsFields`).
//   * COURT SOLITAIRE (Design's idea, characters handoff README; Mike, 2026-10-12): FINISHING A SUIT BRINGS ITS KING
//     OUT TO CHEER. See "the court cheers", below, for what it does and the argument for each default.

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import {
  SUITS, suitOf, cardName, cardShort, deal, applyMove, settle, finishMoves, destinations,
  sources, pickable, cardsAt, canDraw, isWon, isStuck, allRevealed, homeCount, drawCount,
  encodeTurn, replay, AUTO_MODES,
} from '../klondike.js';
import { createPlayWatch } from '../game_start.js';
import { createGameMusic } from '../game_music.js';
import { createGameMusicHost, gameMusicFields } from '../game_music_host.js';
import { followPanelSpeaker } from '../speakers.js';
import { CARD_DEFAULTS, cardSettingsFields, cardArt, watchTheme, cardOptions, deckFor } from '../card_deck.js';
// court solitaire (2026-10-12): the King who cheers is Design's character, in the theme's outfit.
import { courtLook } from '../playing_cards.js';
import { figureSvg } from '../character_kit.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
// town (2026-10-12): the person's rearranged town places (modules/town.js) behind the cards; null = Design's own town.
import { watchTownEdits } from '../town_edits.js';

export const GAME = 'solitaire';
export const SCORE_LABEL = 'Solitaire: cards home';

export const DEFAULTS = Object.freeze({
  draw: 'one',
  autoMove: 'safe',
  offer: 'movable',
  straightThere: false,
  showStats: false,
  sayAloud: false,
  // *** A WIN PAYS NOTHING BY DEFAULT. *** Both sides, as Mike asked for (porting Rule 2):
  //   FOR paying: comet, pond and the press games pay Play points, and a won game is a real result.
  //   AGAINST: points.js's rule is that games pay for correct answers, not for time spent, and
  //   Klondike with unlimited undo is exactly a game anybody finishes by spending time — about four
  //   deals in five can be won by a patient enough player. Paying PER CARD home would be worse
  //   still: undo makes it farmable (put a card home, undo, put it home again).
  //   SO: off by default, and a setting pays a set number of Play points per game WON — once per
  //   deal, whatever undo does afterwards (`paid` in the saved game). A family that wants solitaire
  //   in the economy turns it on; nobody else finds it changing their balance.
  winPoints: 0,
  // How the cards look (card_deck.js, which argues each): suit marks, four suit colours, the town behind the
  // cards where it measured readable.
  cardLayout: CARD_DEFAULTS.cardLayout,
  suitColours: CARD_DEFAULTS.suitColours,
  cardScenery: CARD_DEFAULTS.cardScenery,
  // THE COURT CHEERS (below). 'on' | 'quiet' | 'off', and how many seconds the King stays.
  courtCheer: 'on',
  cheerSeconds: 4,
  // *** MUSIC (row 2.107, 2026-10-31). *** Mike: "What happened to adding music to the games?" The same rows as every
  // game with music (game_music_host.js), played only while somebody is playing (the play watch below: from a press
  // until a win, the panel hiding, or nobody pressing for the idle time). DEFAULT 'mine' (your Music folder, else a
  // quiet hum), argued (Rule 1): FOR 'off': a card game is thinking, and some people think better in quiet. AGAINST,
  // and it decides it: solitaire says nothing aloud by default (`sayAloud` off) and listens for nothing, so a bed costs
  // no word anybody needs - the case for the action, card and building games' default; one row turns it off.
  music: 'mine', musicSourceId: '', musicAlbum: '', musicFavourite: '', musicVolume: 0.3,
});

// ---------------------------------------------------------------------------------------
// *** THE COURT CHEERS (court solitaire: Design's characters handoff README; Mike, 2026-10-12). ***
// When a turn puts a suit's King home (all thirteen of that suit), that suit's King comes out beside the home piles,
// waving: Design's character (character_kit.js `figureSvg`), dressed as the theme's deck dresses him
// (playing_cards.js `courtLook`, COURT_PICK; the Royal robe in the deck's colours where a theme has no outfit yet),
// in the 'wave' pose. A short line ("The King of Hearts cheers!") goes to the output bus as a `say`, so it is heard
// only where this screen speaks at all (the person's routing and the speech channel decide; a screen whose voice
// is off hears nothing). Then he goes, by himself.
//   * WHERE: the empty cell between the drawn cards and the four home piles. Nothing is dealt there, so he covers
//     no card anybody needs. In draw-three the drawn fan reaches into that cell, so he stands in the part it does
//     not reach (solitaire.css). The suite checks he overlaps no card and no button, in both.
//   * NEVER A GATE. Nothing waits for him: every verb, click and the bar work while he is out, and a timer takes
//     him away. A press is never needed to dismiss him (CLAUDE.md: a screen must never enter a state only an input
//     can leave).
//   * MOTION: one appearance and one fade; in full motion he grows a little, up from his feet, inside his own cell
//     (a slide up from below crossed the column under it). With reduced motion (the device's, `ctx.reducedMotion`,
//     or the person's "movement" setting through `ctx.avatarContext`) nothing moves: he fades in and out where he
//     stands.
//   * FLASHING: he comes once and goes once; nothing on him repeats, blinks or changes colour. Under a flash limit
//     (the photosensitivity box, flash_limit.js) he stays at least two of its periods, so appearing and going are
//     never closer together than the limit allows. Suits finished while he is out join him (one appearance, not
//     a second one); each suit cheers once per deal (undo and redo does not bring him back, a new deal does).
//   * DEFAULTS, both sides (on Mike's list):
//       courtCheer 'on'. FOR: it is the reward Design drew for exactly this moment, it costs nothing to the game
//         (no gate, no cover, no wait), and finishing a suit is a real result on a table that otherwise only says
//         "cards home". AGAINST: solitaire says nothing aloud by default (`sayAloud` off), and a line spoken
//         unasked could startle somebody who plays in quiet; a calmer table is a fair thing to want. So: 'quiet'
//         (seen, never said) and 'off' are one setting away, and 'on' only speaks where the screen's own voice is on.
//       cheerSeconds 4. Long enough to see who it is at a glance from across a room, short enough not to linger;
//         2 to 10 in the setting, and never under the flash limit's floor.
export const CHEER_MODES = Object.freeze(['on', 'quiet', 'off']);

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
/** What the court says when these suits ('H', 'S' ...) are finished: "The King of Hearts cheers!" */
export function cheerLine(suitIds = []) {
  const names = suitIds.map((id) => cap(suitOf(id)?.name || '')).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `The King of ${names[0]} cheers!`;
  if (names.length >= 4) return 'All four Kings cheer!';
  return `The Kings of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} cheer!`;
}
/** The suits a turn finished: all thirteen home after it, not before. */
export function suitsFinished(before, after) {
  if (!before || !after) return [];
  return SUITS.filter((s) => (after.foundations[s.id] || []).length === 13 && (before.foundations[s.id] || []).length < 13)
    .map((s) => s.id);
}

const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Cards home, out of 52. A Scoreboard on the same screen can show it instead.' }),
  { key: 'draw', label: 'Draw', kind: 'choice', default: 'one', level: 'essential',
    options: [{ value: 'one', label: 'One card at a time' }, { value: 'three', label: 'Three cards at a time (harder)' }],
    note: 'Starts with the next new game.' },
  { key: 'autoMove', label: 'Put cards home by themselves', kind: 'choice', default: 'safe', level: 'standard',
    options: [
      { value: 'safe', label: 'Only when no column could still want them' },
      { value: 'all', label: 'Every card that can go' },
      { value: 'off', label: 'Never: I will move every card' },
    ] },
  { key: 'offer', label: 'Cards to pick from', kind: 'choice', default: 'movable', level: 'standard',
    options: [{ value: 'movable', label: 'Only cards that can move' }, { value: 'all', label: 'Every face-up card' }],
    note: 'Offering only cards that can move means fewer steps with a switch. It also works a little like a hint.' },
  { key: 'straightThere', label: 'A card with only one place', default: false, level: 'standard',
    onLabel: 'Goes there as soon as it is picked', offLabel: 'Still asks where' },
  { key: 'sayAloud', label: 'Say what is lit, and each move', default: false, level: 'standard',
    onLabel: 'Yes', offLabel: 'No' },
  { key: 'showStats', label: 'Moves and time', default: false, level: 'advanced',
    onLabel: 'Shown', offLabel: 'Hidden' },
  { key: 'winPoints', label: 'Play points for a game won', kind: 'number', default: 0, min: 0, max: 20, step: 1,
    level: 'advanced', note: 'Once per game won. 0 means cards pay nothing.' },
  { key: 'courtCheer', label: 'A King cheers when a suit is finished', kind: 'choice', default: 'on', level: 'standard',
    options: [
      { value: 'on', label: 'Yes, and he says so out loud where this screen speaks' },
      { value: 'quiet', label: 'Yes, without a word' },
      { value: 'off', label: 'No' },
    ],
    note: 'He waves for a few seconds beside the home piles and goes by himself. He never covers a card and never waits for a press.' },
  ...gameMusicFields(),   // row 2.107: the same music rows every game has
  { key: 'cheerSeconds', label: 'How long the King stays', kind: 'number', default: 4, min: 2, max: 10, step: 1,
    level: 'advanced', note: 'Seconds. Never quicker than the screen\'s flashing limit allows.',
    appliesWhen: (v) => !v || v.courtCheer !== 'off' },
  ...cardSettingsFields(),
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------
// WORDS — exported so the suite reads them without a DOM
// ---------------------------------------------------------------------------------------

/** A stable key for a place: 'w', 'fH', 't3' or 't3.4'. */
export function whereKey(w) {
  if (!w) return '';
  if (w.pile === 'waste') return 'w';
  if (w.pile === 'foundation') return `f${w.suit}`;
  return w.idx == null ? `t${w.col}` : `t${w.col}.${w.idx}`;
}

/** What a place is called on screen ("Onto 8♠ (column 3)") and aloud ("onto the 8 of spades"). */
export function placeWords(g, to) {
  if (to.pile === 'foundation') {
    const s = suitOf(to.suit);
    return { label: `Home: ${s.symbol} ${s.name}`, speech: `home to ${s.name}` };
  }
  const pile = g.tableau[to.col];
  const t = pile[pile.length - 1];
  if (!t) return { label: `Empty column ${to.col + 1}`, speech: `to empty column ${to.col + 1}` };
  return { label: `Onto ${cardShort(t)} (column ${to.col + 1})`, speech: `onto the ${cardName(t)}` };
}

/** What a picked card is called: "7♥", or "7♥ and 2 more" for a run. */
export function cardWords(g, from) {
  const run = cardsAt(g, from);
  if (!run.length) return { label: '', speech: '' };
  const more = run.length > 1 ? ` and ${run.length - 1} more` : '';
  return { label: `${cardShort(run[0])}${more}`, speech: `the ${cardName(run[0])}${more}` };
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------

registerModule(
  { type: GAME, title: 'Solitaire', core: 'new', routesSound: true,   // its music (row 2.107) follows the panel's speaker
    description: 'Klondike, with big cards in four suit colors: pick a card, then pick where it goes. '
      + 'One switch can play; nothing needs a drag.',
    // `local`: the deck and the rules are in this build; nothing is fetched.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    const rand = ctx.rand || Math.random;
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      // court solitaire (2026-10-12): the person's "movement makes me unwell" setting too, which the host hands
      // over in the avatars' context (kiosk.js avatarContextNow), not only the device's own preference.
      try {
        const a = typeof ctx.avatarContext === 'function' ? ctx.avatarContext() : null;
        if (a && (a.reduceMotion || a.deviceReduced)) return true;
      } catch { /* no host context */ }
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };

    let cfg = { ...DEFAULTS };
    let rec = null;            // { seed, draw, turns: [string], startedAt, won, paid }
    let snaps = [];            // the game after each turn; snaps[0] is the deal
    let stats = { won: 0 };
    let picked = null;         // the `from` being placed, or null while picking
    let lit = -1;              // index into the walk; -1 = hidden until the first verb
    let confirmNew = false;
    let note = '';             // one line for the bar ("nowhere to go" ...)
    let touched = false;       // has this mount made a move or dealt? (a late state load must not overwrite it)
    let score = null;
    let ledger = null;
    let lastSpeech = null;
    let ticker = null;
    let dead = false;
    let rootEl = null;
    let stuckFor = null;       // the position `stuckVal` was worked out for (checked once per position)
    let stuckVal = false;
    // BEING PLAYED (2026-10-07, game_start.js createPlayWatch): no Start button, so from a press on it (a switch's
    // next / prev / select / back / undo, a click on the table) until nobody has pressed for GAME_IDLE_MS, or the deal
    // is won. Never merely for being open: a table left out must not keep the bar away, or hold a new version, for ever.
    let plays = null;
    let musicHost = null;      // row 2.107: the music, on exactly while `plays` says being played
    let unSpeaker = null;
    // THE THEME ON SCREEN (card_deck.js watchTheme): the deck the cards wear, redrawn when it changes.
    let themeWatch = null;
    let townWatch = null;   // town (2026-10-12): the person's edited places, per theme (town_edits.js)
    const artId = String(ctx.instanceId || `s${Math.floor(rand() * 1e9)}`).replace(/[^A-Za-z0-9_-]/g, '');
    // THE COURT CHEERS (above): who is out now, and which suits have cheered this deal.
    let cheer = null;          // { suits: ['H', ...], started, until } while a King is out
    let cheerTimer = null;
    let cheerSpeech = null;
    let cheered = new Set();

    const game = () => snaps[snaps.length - 1];
    function stuckNow(g) {
      if (stuckFor !== g) { stuckFor = g; stuckVal = isStuck(g); }
      return stuckVal;
    }

    // ---- speech --------------------------------------------------------------------------
    function say(text) {
      if (!cfg.sayAloud || !text || !ctx.output?.say) return;
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: GAME });
      } catch (err) { console.error('solitaire: say', err); }
    }

    // ---- the court cheers ----------------------------------------------------------------------
    function cheerMs() {
      const s = Number(cfg.cheerSeconds);
      const base = (Number.isFinite(s) && s > 0 ? s : DEFAULTS.cheerSeconds) * 1000;
      let period = 0;
      try { period = minFlashPeriodMs(flashLimit(ctx)); } catch { period = 0; }
      // Appearing and going are two changes: never closer together than the flash limit's period allows.
      return Math.max(base, 2 * (Number.isFinite(period) ? period : 0));
    }
    function endCheer() {
      if (cheerTimer != null) { clearTimeout(cheerTimer); cheerTimer = null; }
      cheer = null;
    }
    function resetCheers(g = null) {
      endCheer();
      cheered = new Set(g ? SUITS.filter((s) => (g.foundations[s.id] || []).length === 13).map((s) => s.id) : []);
    }
    /** After a turn: did it finish a suit? Then its King comes out (once per suit per deal). */
    function noticeFinished(before, after) {
      if (cfg.courtCheer === 'off' || !CHEER_MODES.includes(cfg.courtCheer)) return;
      const done = suitsFinished(before, after).filter((id) => !cheered.has(id));
      if (!done.length) return;
      done.forEach((id) => cheered.add(id));
      const t = now();
      const ms = cheerMs();
      // A King already out: the new ones join him (one appearance, not a second), and they all stay the full time.
      cheer = cheer && t < cheer.until
        ? { suits: [...cheer.suits, ...done], started: cheer.started, until: Math.max(cheer.until, t + ms) }
        : { suits: done, started: t, until: t + ms };
      if (cheerTimer != null) clearTimeout(cheerTimer);
      // He goes by himself: a timer, never a press.
      cheerTimer = setTimeout(() => { cheerTimer = null; cheer = null; if (!dead) render(); }, Math.max(0, cheer.until - t));
      if (cfg.courtCheer === 'on' && ctx.output?.say) {
        try { cheerSpeech = ctx.output.say(cheerLine(done), { source: GAME }); }
        catch (err) { console.error('solitaire: cheer', err); }
      }
    }
    function cheerHtml() {
      if (cheer && now() >= cheer.until) cheer = null;
      if (!cheer) return '';
      const deck = deckFor(themeWatch ? themeWatch.id() : 'default');
      const fourColour = cardOptions(cfg).fourColour;
      const kings = cheer.suits.map((id) => {
        const name = suitOf(id)?.name || 'spades';
        const { look, opts } = courtLook('king', name, deck, { fourColour });
        // Design's figure, waving; hidden from a screen reader (the element around them carries the line).
        const svg = figureSvg(look, { ...opts, pose: 'wave' }, 'King')
          .replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMax meet"')
          .replace(/<title>[^<]*<\/title>/, '');
        return `<span class="sol-king" data-king="${id}">${svg}</span>`;
      }).join('');
      const dur = Math.max(1, cheer.until - cheer.started);
      const elapsed = Math.max(0, Math.min(dur, now() - cheer.started));
      // The animation carries on across re-draws: the table is redrawn on every move, so each drawing starts the
      // same single fade where the last one had got to (a negative delay), rather than from the beginning.
      return `<div class="sol-cheer" data-cheer data-draw="${game().draw}" role="img" aria-label="${esc(cheerLine(cheer.suits))}"`
        + ` style="--sol-cheer-ms:${Math.round(dur)}ms;animation-delay:-${Math.round(elapsed)}ms">${kings}</div>`;
    }

    // ---- saving --------------------------------------------------------------------------
    function save() {
      try { state?.set?.({ game: rec, stats }); } catch (err) { console.error('solitaire: save', err); }
    }
    function adopt(saved) {
      if (!saved || !Number.isFinite(saved.seed)) return false;
      const r = replay(saved.seed, drawCount(saved.draw), saved.turns || []);
      rec = { seed: r.game.seed, draw: r.game.draw, turns: r.turns, startedAt: Number(saved.startedAt) || now(),
        won: !!saved.won, paid: !!saved.paid };
      snaps = r.snapshots;
      resetCheers(game());   // a reloaded game's finished suits have had their cheer
      return true;
    }
    function newGame(seed = null, draw = null, { persist = true } = {}) {
      const s = Number.isFinite(seed) ? seed >>> 0 : Math.floor(rand() * 2147483647) + 1;
      const d = drawCount(draw ?? cfg.draw);
      const first = deal(s, { draw: d });
      rec = { seed: s, draw: d, turns: [], startedAt: now(), won: false, paid: false };
      snaps = [first];
      resetCheers();   // a new deal: every suit can cheer again
      // Aces (and twos) dealt face up go home at once under auto-move. Recorded as a turn so the
      // saved game replays exactly, and so Undo can put them back for somebody who wants to.
      const st = settle(first, cfg.autoMove);
      if (st.moves.length) { rec.turns.push(encodeTurn(st.moves)); snaps.push(st.game); }
      picked = null; confirmNew = false; note = ''; lit = lit < 0 ? -1 : 0;
      stuckFor = null;
      // The first deal on a fresh mount is NOT saved: the saved game may still be loading, and a
      // write now would overwrite it. It is saved with the first move instead.
      if (persist) { touched = true; save(); }
      render();
    }

    // ---- one turn: the player's move, then whatever goes home by itself ---------------------
    function doTurn(move, speech = '') {
      const g0 = game();
      let g = applyMove(g0, move);
      if (!g) return false;
      const moves = [move];
      const st = settle(g, cfg.autoMove);
      g = st.game; moves.push(...st.moves);
      rec.turns.push(encodeTurn(moves));
      snaps.push(g);
      picked = null; confirmNew = false; note = ''; touched = true;
      if (lit >= 0) lit = 0;
      if (isWon(g) && !rec.won) {
        rec.won = true;
        stats = { ...stats, won: (Number(stats.won) || 0) + 1 };
        pay();
      }
      noticeFinished(g0, g);   // court solitaire: a finished suit brings its King out
      save();
      render();
      if (isWon(g)) say('You won. All fifty-two cards are home.');
      else if (speech) say(speech + (st.moves.length ? `, and ${st.moves.length} went home` : ''));
      return true;
    }
    function pay() {
      const n = Math.round(Number(cfg.winPoints) || 0);
      if (!(n > 0) || rec.paid || !ledger) return;
      rec.paid = true;
      Promise.resolve(ledger.award({ amount: n, source: GAME, type: 'Play', tags: [GAME, 'klondike'],
        note: 'Klondike: a game won' })).catch((err) => console.error('solitaire: points', err));
    }
    function undo() {
      if (rec.turns.length === 0) return;
      rec.turns.pop(); snaps.pop();
      picked = null; confirmNew = false; note = ''; touched = true;
      if (lit >= 0) lit = 0;
      save(); render();
      say('Undone.');
    }
    function finish() {
      const moves = finishMoves(game());
      if (!moves.length) return;
      const g0 = game();
      let g = g0;
      for (const m of moves) g = applyMove(g, m);
      rec.turns.push(encodeTurn(moves));
      snaps.push(g);
      picked = null; confirmNew = false; touched = true;
      if (!rec.won && isWon(g)) { rec.won = true; stats = { ...stats, won: (Number(stats.won) || 0) + 1 }; pay(); }
      noticeFinished(g0, g);   // court solitaire
      save(); render();
      say('You won. All fifty-two cards are home.');
    }

    // ---- the walk: what one switch can reach right now ---------------------------------------
    function walk() {
      const g = game();
      const items = [];
      if (picked) {
        for (const to of destinations(g, picked)) {
          const w = placeWords(g, to);
          items.push({ key: `dst:${whereKey(to)}`, label: w.label, speech: w.speech, to });
        }
        items.push({ key: 'cancel', label: 'Put it back', speech: 'put it back' });
        return items;
      }
      if (canDraw(g)) {
        const label = g.stock.length ? (g.draw === 3 ? 'Draw three' : 'Draw a card') : 'Turn the pile over';
        items.push({ key: 'draw', label, speech: label.toLowerCase() });
      }
      if (!isWon(g)) {
        for (const from of (cfg.offer === 'all' ? pickable(g) : sources(g))) {
          const w = cardWords(g, from);
          items.push({ key: `src:${whereKey(from)}`, label: `Pick ${w.label}`, speech: w.speech, from });
        }
      }
      if (allRevealed(g) && !isWon(g)) items.push({ key: 'finish', label: 'Put them all home', speech: 'put them all home' });
      if (rec.turns.length) items.push({ key: 'undo', label: 'Undo', speech: 'undo' });
      items.push({ key: 'new', label: confirmNew ? 'Press again for a new game' : 'New game',
        speech: confirmNew ? 'press again for a new game' : 'new game' });
      return items;
    }

    function activate(item) {
      if (!item || dead) return;
      const g = game();
      if (item.key !== 'new') confirmNew = false;
      if (item.key === 'draw') { doTurn({ kind: 'draw' }, g.stock.length ? 'drew' : 'turned the pile over'); return; }
      if (item.key === 'undo') { undo(); return; }
      if (item.key === 'finish') { finish(); return; }
      if (item.key === 'cancel') { picked = null; note = ''; if (lit >= 0) lit = 0; render(); return; }
      if (item.key === 'new') {
        const inProgress = rec.turns.length > 0 && !rec.won;
        if (inProgress && !confirmNew) { confirmNew = true; render(); say('press again for a new game'); return; }
        newGame();
        return;
      }
      if (item.key.startsWith('src:')) { pick(item.from); return; }
      if (item.key.startsWith('dst:')) {
        const from = picked;
        const w = cardWords(g, from);
        doTurn({ kind: 'move', from, to: item.to }, `${w.speech} ${item.speech}`);
      }
    }

    function pick(from) {
      const g = game();
      const dests = destinations(g, from);
      const w = cardWords(g, from);
      if (!dests.length) {
        note = `${w.label} has nowhere to go right now.`;
        picked = null;
        render();
        say(`${w.speech} has nowhere to go right now`);
        return;
      }
      if (cfg.straightThere && dests.length === 1) {
        doTurn({ kind: 'move', from, to: dests[0] }, `${w.speech} ${placeWords(g, dests[0]).speech}`);
        return;
      }
      picked = from; note = '';
      if (lit >= 0) lit = 0;
      render();
      say(`where should ${w.speech} go?`);
    }

    function moveLit(d) {
      const items = walk();
      if (!items.length) return;
      lit = lit < 0 ? (d > 0 ? 0 : items.length - 1) : ((lit + d) % items.length + items.length) % items.length;
      render();
      say(items[lit]?.speech);
    }
    function selectLit() {
      const items = walk();
      if (!items.length) return;
      if (lit < 0) { lit = 0; render(); say(items[0].speech); return; }   // reveal first
      activate(items[Math.min(lit, items.length - 1)]);
    }
    function back() {
      if (picked) activate({ key: 'cancel' });
    }

    // ---- drawing ------------------------------------------------------------------------------
    // The card's drawing is Design's (card_deck.js cardArt), in the theme's deck and this table's settings; the
    // element around it carries the name a screen reader reads, and the rings, the lift and the marker.
    // town (2026-10-12): with the person's rearranged town places, so an edited King's hall is behind the King.
    const art = (c) => {
      const theme = themeWatch ? themeWatch.id() : 'default';
      return cardArt(c, theme, cfg, { idSuffix: artId, town: townWatch ? townWatch.forTheme(theme) : null });
    };
    function cardHtml(c, { key = null, style = '', picked: isPicked = false, on = false } = {}) {
      if (!c.up) return `<div class="sol-card" data-up="0" style="${style}" role="img" aria-label="face down">${art(c)}</div>`;
      const tag = key ? 'button' : 'div';
      const attrs = key ? ` type="button" data-key="${esc(key)}"` : ' role="img"';
      return `<${tag} class="sol-card" data-up="1" data-suit="${c.s}" data-card="${c.s}${c.r}"${attrs}`
        + `${isPicked ? ' data-picked="1"' : ''}${on ? ' data-on="1"' : ''} style="${style}" aria-label="${esc(cardName(c))}">`
        + `${art(c)}</${tag}>`;
    }

    function render() {
      if (dead || !rootEl) return;
      const g = game();
      const items = walk();
      if (lit >= items.length) lit = items.length - 1;
      const litItem = lit >= 0 ? items[lit] : null;
      const keysNow = new Set(items.map((i) => i.key));
      const onKey = litItem ? litItem.key : null;
      const srcKey = (from) => {
        const k = `src:${whereKey(from)}`;
        return !picked && keysNow.has(k) ? k : null;
      };
      const pickedKey = picked ? whereKey(picked) : null;
      const targets = new Set(picked ? items.filter((i) => i.to).map((i) => whereKey(i.to)) : []);
      const tgt = (k) => (targets.has(k) ? ` data-target="dst:${k}"` : '');
      const tgtOn = (k) => (onKey === `dst:${k}` ? ' data-on="1"' : '');

      // top row: stock, waste, gap, four foundations
      const stockInner = g.stock.length
        ? `${cardHtml({ s: 'S', r: 1, up: false })}<span class="sol-count">${g.stock.length}</span>`
        : `<span class="sol-empty" aria-hidden="true">${g.waste.length ? '↻' : ''}</span>`;
      const stockLabel = g.stock.length ? `Draw: ${g.stock.length} cards left to draw` : (g.waste.length ? 'Turn the pile over' : 'Nothing left to draw');
      const stock = `<div class="sol-slot"><button type="button" class="sol-stock" ${canDraw(g) ? 'data-key="draw"' : 'disabled'}`
        + `${onKey === 'draw' ? ' data-on="1"' : ''} aria-label="${esc(stockLabel)}">${stockInner}</button></div>`;
      const shown = g.waste.slice(g.draw === 3 ? -3 : -1);
      const waste = `<div class="sol-waste" data-pile="w" aria-label="the drawn cards">${shown.length ? shown.map((c, i) => {
        const isTop = i === shown.length - 1;
        const k = isTop ? srcKey({ pile: 'waste' }) : null;
        return cardHtml(c, { key: k, style: `--sol-k:${i}`, picked: isTop && pickedKey === 'w', on: !!k && onKey === k });
      }).join('') : '<div class="sol-empty" aria-hidden="true"></div>'}</div>`;
      const founds = SUITS.map((s) => {
        const f = g.foundations[s.id];
        const k = `f${s.id}`;
        const t = f[f.length - 1];
        const inner = t
          ? cardHtml(t, { key: srcKey({ pile: 'foundation', suit: s.id }), picked: pickedKey === k,
            on: onKey === `src:${k}` })
          : `<div class="sol-empty" data-suit="${s.id}"><span>${s.symbol}<small>${s.name}</small></span></div>`;
        return `<div class="sol-slot" data-pile="${k}" aria-label="${esc(s.name)} home: ${f.length} of 13"${tgt(k)}${tgtOn(k)}>${inner}</div>`;
      }).join('');

      const cols = g.tableau.map((p, col) => {
        let y = 0;
        const ys = p.map((c, i) => { const here = y; if (i < p.length - 1) y += c.up ? 1 : 0.45; return here; });
        const span = y;
        const tk = `t${col}`;
        const cards = p.map((c, idx) => {
          const from = { pile: 'tableau', col, idx };
          const k = c.up ? srcKey(from) : null;
          const isPicked = !!picked && picked.pile === 'tableau' && picked.col === col && idx >= picked.idx;
          return cardHtml(c, { key: k, style: `--sol-y:${ys[idx]}`, picked: isPicked, on: !!k && onKey === k });
        }).join('');
        const empty = p.length ? '' : '<div class="sol-empty" aria-hidden="true"><span>K<small>kings</small></span></div>';
        return `<div class="sol-col" data-pile="${tk}" style="--sol-span:${span}" aria-label="column ${col + 1}"${tgt(tk)}${tgtOn(tk)}>${empty}${cards}</div>`;
      }).join('');

      // the bar
      const won = isWon(g);
      if (won) plays?.rest();      // the deal is won: nobody is playing it now, until a new game
      const stuck = !won && !picked && stuckNow(g);
      let line;
      if (won) line = `<span class="sol-won" data-won>You won! All 52 cards are home.</span>`;
      else if (picked) line = `Where should ${esc(cardWords(g, picked).label)} go?`;
      else if (note) line = esc(note);
      else if (stuck) line = '<span data-stuck>It looks like no move helps from here. You can undo, or start a new game.</span>';
      else line = rec.turns.length ? 'Pick a card, or draw.' : 'Pick a card, or draw. Any card that can move is offered.';
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const scoreLine = own ? `<p class="sol-stats" data-score>${homeCount(g)} of 52 cards home</p>` : '';
      const statsLine = cfg.showStats
        ? `<p class="sol-stats" data-stats>Moves: ${g.moves} · Time: ${fmtTime(now() - (rec.startedAt || now()))}</p>` : '';
      // The empty cell between the drawn cards and the home piles: where a King comes out to cheer (court solitaire).
      const cheering = cheerHtml();
      const cheerCell = cheering ? `<div class="sol-cheer-slot" data-cheer-slot>${cheering}</div>`
        : '<div class="sol-cheer-slot" data-cheer-slot aria-hidden="true"></div>';
      const barBtns = items.filter((i) => !i.key.startsWith('src:') && i.key !== 'draw')
        .map((i) => `<button type="button" class="sol-btn" data-key="${esc(i.key)}"${i.key === onKey ? ' data-on="1"' : ''}>${esc(i.label)}</button>`)
        .join('');

      rootEl.innerHTML = `
        <div class="sol" data-sol data-motion="${reducedMotion() ? 'reduce' : 'full'}" data-phase="${picked ? 'place' : 'pick'}"${won ? ' data-won' : ''}>
          <div class="sol-top">${stock}${waste}${cheerCell}${founds}</div>
          <div class="sol-cols">${cols}</div>
          <div class="sol-bar">
            <p class="sol-say" role="status" aria-live="polite">${line}</p>
            ${scoreLine}${statsLine}
            <div class="sol-btns">${barBtns}</div>
          </div>
        </div>`;

      try {
        score?.set(homeCount(g), { target: 52, detail: `Games won: ${Number(stats.won) || 0}` });
      } catch (err) { console.error('solitaire: score', err); }
    }

    // ---- pointer: click a card, then a place ----------------------------------------------------
    function onClick(e) {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || !mount.contains(el)) return;
      const items = walk();
      const byKey = (k) => items.find((i) => i.key === k) || null;
      const target = el.closest('[data-target]');
      if (picked && target) { activate(byKey(target.dataset.target)); return; }
      const keyed = el.closest('[data-key]');
      if (keyed) { activate(byKey(keyed.dataset.key)); return; }
      // A click on the picked card (it is not a button while placing) or on the felt puts it back.
      if (picked) activate({ key: 'cancel' });
    }

    return {
      __probe: () => {
        const items = walk();
        return { game: game(), rec: { ...rec, turns: [...rec.turns] }, picked, lit, confirmNew,
          items: items.map((i) => i.key), litKey: lit >= 0 ? items[lit]?.key : null, stats: { ...stats }, cfg: { ...cfg },
          theme: themeWatch ? themeWatch.id() : null,
          cheer: cheer ? { suits: [...cheer.suits], started: cheer.started, until: cheer.until } : null,
          cheered: [...cheered] };
      },
      init() {
        let cssHref = '';
        try { cssHref = new URL('../solitaire.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-sol-css href="${esc(cssHref)}">` : ''}<div class="sol-wrap" data-sol-root></div>`;
        rootEl = mount.querySelector('[data-sol-root]');
        mount.addEventListener('click', onClick);
        themeWatch = watchTheme(mount, () => render());
        townWatch = watchTownEdits(ctx, () => render());   // town (2026-10-12)

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('solitaire: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null,
          onShownChange: () => render() });
        // Row 2.107: the music, on the speaker arbiter (media tier, music group), as every game's.
        musicHost = createGameMusicHost(ctx, { audio: ctx.audio || null, audioId: `${GAME}-music:${ctx.instanceId || 'sol'}`,
          cfg: () => cfg,
          make: (o) => createGameMusic({ ...o, ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) }) });
        unSpeaker = followPanelSpeaker(state, () => [musicHost?.music]);

        const applyCfg = (snap) => {
          const s = snap || {};
          const was = cfg;
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          if (!AUTO_MODES.includes(next.autoMove)) next.autoMove = DEFAULTS.autoMove;
          if (!CHEER_MODES.includes(next.courtCheer)) next.courtCheer = DEFAULTS.courtCheer;
          if (next.courtCheer === 'off') endCheer();   // turned off while a King is out: he goes now
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
          try { musicHost?.apply(next, was); } catch { /* quiet */ }
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          // A saved game arriving after mount (state loads in the background) is adopted only if
          // nobody has played here yet — a late load must never undo what somebody just did.
          if (!touched && s.game && (!rec || s.game.seed !== rec.seed || (s.game.turns || []).length !== rec.turns.length)) adopt(s.game);
        };
        applyCfg(state?.get?.());
        if (!rec) newGame(null, null, { persist: false });
        state?.subscribe?.((s) => { applyCfg(s); render(); });

        bus.subscribe(`${GAME}/next`, () => moveLit(1));
        bus.subscribe(`${GAME}/prev`, () => moveLit(-1));
        bus.subscribe(`${GAME}/select`, () => selectLit());
        bus.subscribe(`${GAME}/back`, () => back());
        bus.subscribe(`${GAME}/undo`, () => undo());
        // A new deal, optionally a particular one ({ seed, draw }): used by the suite, and by anything
        // that wants to hand somebody the same deal again.
        bus.subscribe(`${GAME}/deal`, (p) => newGame(Number.isFinite(p?.seed) ? p.seed : null, p?.draw ?? null));
        // Being played: its presses, watched after its own handlers, so the press that wins is seen won and the
        // "New game" press after a win counts. Not `deal`: that is a program handing it a deal, not somebody playing.
        plays = createPlayWatch(bus, ctx, { onChange: (s) => { musicHost?.follow(s === 'play' && !dead); } });
        plays.watch({ topics: [`${GAME}/next`, `${GAME}/prev`, `${GAME}/select`, `${GAME}/back`, `${GAME}/undo`],
          mount, when: () => !dead && !isWon(game()) });

        render();
        // Only the stats line changes each second, so only its text is touched: re-drawing the table
        // every second would pull a card out from under a pointer mid-click.
        ticker = setInterval(() => {
          if (!cfg.showStats || dead || isWon(game())) return;
          const el = mount.querySelector('[data-stats]');
          if (el) el.textContent = `Moves: ${game().moves} · Time: ${fmtTime(now() - (rec.startedAt || now()))}`;
        }, 1000);
      },
      onResize() {},
      onHide() { plays?.rest(); musicHost?.follow(false); try { state?.flush?.(); } catch { /* nothing to do */ } },
      // Row 2.107: the live "Music from", "Music folder" and "Which favorite" choices (game_music_host.js).
      settingsChoices: () => musicHost?.settingsChoices?.() || {},
      destroy() {
        dead = true;
        if (plays) { plays.destroy(); plays = null; }
        try { unSpeaker?.(); } catch { /* gone */ } unSpeaker = null;
        try { musicHost?.destroy(); } catch { /* gone */ } musicHost = null;
        themeWatch?.stop();
        townWatch?.stop();   // town (2026-10-12)
        townWatch = null;
        mount.removeEventListener('click', onClick);
        if (ticker != null) { clearInterval(ticker); ticker = null; }
        endCheer();
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
        try { if (cheerSpeech && ctx.output?.cancel) ctx.output.cancel(cheerSpeech); } catch { /* gone */ }
        try { score?.destroy(); } catch { /* gone */ }
        score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  },
);
