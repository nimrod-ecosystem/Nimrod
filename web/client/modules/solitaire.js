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

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import {
  SUITS, suitOf, cardName, cardShort, RANK_LABEL, deal, applyMove, settle, finishMoves, destinations,
  sources, pickable, cardsAt, canDraw, isWon, isStuck, allRevealed, homeCount, drawCount,
  encodeTurn, replay, AUTO_MODES,
} from '../klondike.js';

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
});

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
    note: 'Only cards that can move keeps a switch walk short, and works a little like a hint.' },
  { key: 'straightThere', label: 'A card with only one place', default: false, level: 'standard',
    onLabel: 'Goes there as soon as it is picked', offLabel: 'Still asks where' },
  { key: 'sayAloud', label: 'Say what is lit, and each move', default: false, level: 'standard',
    onLabel: 'Yes', offLabel: 'No' },
  { key: 'showStats', label: 'Moves and time', default: false, level: 'advanced',
    onLabel: 'Shown', offLabel: 'Hidden' },
  { key: 'winPoints', label: 'Play points for a game won', kind: 'number', default: 0, min: 0, max: 20, step: 1,
    level: 'advanced', note: 'Once per game won. 0 means cards pay nothing.' },
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
  { type: GAME, title: 'Solitaire', core: 'new',
    description: 'Klondike, with big cards in four suit colours: pick a card, then pick where it goes. '
      + 'One switch can play; nothing needs a drag.',
    // `local`: the deck and the rules are in this build; nothing is fetched.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    const rand = ctx.rand || Math.random;
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
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
      return true;
    }
    function newGame(seed = null, draw = null, { persist = true } = {}) {
      const s = Number.isFinite(seed) ? seed >>> 0 : Math.floor(rand() * 2147483647) + 1;
      const d = drawCount(draw ?? cfg.draw);
      const first = deal(s, { draw: d });
      rec = { seed: s, draw: d, turns: [], startedAt: now(), won: false, paid: false };
      snaps = [first];
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
      let g = game();
      for (const m of moves) g = applyMove(g, m);
      rec.turns.push(encodeTurn(moves));
      snaps.push(g);
      picked = null; confirmNew = false; touched = true;
      if (!rec.won && isWon(g)) { rec.won = true; stats = { ...stats, won: (Number(stats.won) || 0) + 1 }; pay(); }
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
    function cardHtml(c, { key = null, style = '', picked: isPicked = false, on = false } = {}) {
      if (!c.up) return `<div class="sol-card" data-up="0" style="${style}" role="img" aria-label="face down"></div>`;
      const s = suitOf(c.s);
      const tag = key ? 'button' : 'div';
      const attrs = key ? ` type="button" data-key="${esc(key)}"` : ' role="img"';
      return `<${tag} class="sol-card" data-up="1" data-suit="${c.s}" data-card="${c.s}${c.r}"${attrs}`
        + `${isPicked ? ' data-picked="1"' : ''}${on ? ' data-on="1"' : ''} style="${style}" aria-label="${esc(cardName(c))}">`
        + `<span class="sol-idx" aria-hidden="true">${RANK_LABEL[c.r]}${s.symbol}</span>`
        + `<span class="sol-pip" aria-hidden="true">${s.symbol}</span></${tag}>`;
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
      const barBtns = items.filter((i) => !i.key.startsWith('src:') && i.key !== 'draw')
        .map((i) => `<button type="button" class="sol-btn" data-key="${esc(i.key)}"${i.key === onKey ? ' data-on="1"' : ''}>${esc(i.label)}</button>`)
        .join('');

      rootEl.innerHTML = `
        <div class="sol" data-sol data-motion="${reducedMotion() ? 'reduce' : 'full'}" data-phase="${picked ? 'place' : 'pick'}"${won ? ' data-won' : ''}>
          <div class="sol-top">${stock}${waste}<div aria-hidden="true"></div>${founds}</div>
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
          items: items.map((i) => i.key), litKey: lit >= 0 ? items[lit]?.key : null, stats: { ...stats }, cfg: { ...cfg } };
      },
      init() {
        let cssHref = '';
        try { cssHref = new URL('../solitaire.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-sol-css href="${esc(cssHref)}">` : ''}<div class="sol-wrap" data-sol-root></div>`;
        rootEl = mount.querySelector('[data-sol-root]');
        mount.addEventListener('click', onClick);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('solitaire: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null,
          onShownChange: () => render() });

        const applyCfg = (snap) => {
          const s = snap || {};
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          if (!AUTO_MODES.includes(next.autoMove)) next.autoMove = DEFAULTS.autoMove;
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
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
      onHide() { try { state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        mount.removeEventListener('click', onClick);
        if (ticker != null) { clearInterval(ticker); ticker = null; }
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
        try { score?.destroy(); } catch { /* gone */ }
        score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  },
);
