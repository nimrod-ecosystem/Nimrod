// game_together.js — PLAYING TOGETHER, THE LAYER EVERY TURN GAME SHARES (2026-10-12).
//
// Quiz mix grew "Play together" first (2026-10-06): a game room (game_room.js; every rule argued in
// web/server/game_rooms.py) that more than one screen joins, offered with another screen or on a call, and since
// 9a70277 ASKED FOR FROM THE CALL with one press on the caller's page. Word Builder is the second game to play that
// way (Mike, 2026-10-12). This file is the part the two share, moved here out of quiz_mix.js rather than copied:
//   * the room's life: open one (with another screen, or on this call), join one by code, leave, and the ending said
//     in plain words in the corner for NOTE_MS;
//   * ASKED FROM THE CALL: take the ask, end a game of this screen's own first, open a call room, start by itself
//     when the asker joins, close calmly when nobody comes (CALL_ASK_JOIN_MS) or the call ends, end the game with
//     the asker leaving;
//   * the corner bar, the sheet over the panel (the choice, the lobby with its code and square, the waiting views)
//     and a switch stepping through the sheet's buttons;
//   * the seats as players: each seat on this screen is this screen's own player, each elsewhere a name and where.
// What stays in each game: what a TURN is (a Quiz mix question in the round's category; a Word Builder word from the
// player's own letters), dealing and judging it, the turn order, rounds and table, and the host's remote-turn clock.
//
// EXTRACT OR COPY, argued. COPY: no risk to Quiz mix, which works and has its suites. EXTRACT: one lobby, one call-ask
// flow, one set of words and clocks; a fix lands once; the third game costs a hook list, not 350 lines. Mike: "do it
// right once - do not patch the same thing many ways." Extracted, with Quiz mix moved onto it in the same change and
// its suites (quiz_together, quiz_mix, quiz_flow, call_loadouts) proving nothing moved under it. The markup keeps its
// `data-qm*` names and `qm-` classes, so every check written against Quiz mix's lobby reads the same for both games.
//
// NO STATE ONLY AN INPUT CAN LEAVE (CLAUDE.md): every wait here has a clock - a lobby (LOBBY_MS), an asked room
// nobody joins (CALL_ASK_JOIN_MS), the corner's note (NOTE_MS) - and game_room.js's own backstops end a room whose
// server cannot be heard. None of it is a modal: the rest of the screen carries on, and every view has its way out.

import { connectGameRoom, createRoomClient, codeWords, normalizeCode, endWords, CODE_LEN } from './game_room.js';
import { elsewhereQR, themeQrColours, pageAddress } from './page_links.js';

// THE PLAYING-TOGETHER NUMBERS, each argued (moved from quiz_mix.js, unchanged):
//   LOBBY_MS 10 min        a room opened and never started closes: long enough to fetch a phone and type a code,
//                          short enough that a forgotten lobby does not sit on a screen all afternoon.
//   REMOTE_TURN_MS 165 s   the host's own backstop for a turn on another screen: the server skips it at 150 s
//                          (game_rooms.py TURN_MAX_S); this only fires when the server cannot be heard.
//   NOTE_MS 20 s           how long "the game together has ended" stays in the corner: read, then gone by itself.
//   CALL_ASK_JOIN_MS 60 s  a room opened because somebody on the call ASKED closes if they have not joined in this
//                          long. Their call page joins by itself the moment the room's code reaches it - a few seconds
//                          (a ticket, a socket, the game's page) - so 60 s covers a slow phone several times over. The
//                          10-minute lobby above is for somebody fetching a phone and typing a code, which an ask is
//                          not; and nobody here may be able to close a lobby, so it should not stand for ten minutes.
export const LOBBY_MS = 10 * 60 * 1000;
export const REMOTE_TURN_MS = 165000;
export const NOTE_MS = 20000;
export const CALL_ASK_JOIN_MS = 60000;

// The page a phone opens to join (the square on the lobby, and the call page's game beside the video), and the games
// it can open. Quiz mix's address is as it always was (no `game`), so a square printed before keeps working.
export const PLAY_PAGE = '/play.html';
export const PLAY_GAMES = Object.freeze(['quiz_mix', 'word_builder']);
export const DEFAULT_PLAY_GAME = 'quiz_mix';
export const playPath = (code, game = DEFAULT_PLAY_GAME) => `${PLAY_PAGE}?room=${encodeURIComponent(code)}`
  + (game && game !== DEFAULT_PLAY_GAME && PLAY_GAMES.includes(game) ? `&game=${encodeURIComponent(game)}` : '');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Ann 7, Bob 5" (a player with no name: "You"). Playing together, the points are kept by seat (`p.seat`). */
export function scoreWords(players, points) {
  return (players || []).map((p) => `${p.name || 'You'} ${points?.[p.seat || p.id] || 0}`).join(', ');
}

// The look: the corner bar, the sheet, the lobby, the table and the round chip - only the theme's own variables.
const STYLE_ID = 'game-together-style';
const CSS = `
.qm-round{font-weight:700}
.qm-table{margin:0 auto 1.5cqmin;padding:0;list-style:none;display:grid;gap:.6cqmin;font-size:clamp(14px,4.5cqmin,52px)}
.qm-table li{display:flex;gap:1em;justify-content:space-between;min-width:12em}
.qm-table li[data-top] b{text-decoration:underline}
.qm-bar{position:absolute;top:calc(clamp(4px,1.2cqmin,14px) + var(--k-dodge-tr, 0px));right:clamp(4px,1.2cqmin,14px);z-index:5;display:flex;gap:.5em;
  align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:72%;font-size:clamp(12px,2.6cqmin,28px)}
.qm-bar .wg-btn{font-size:inherit;min-height:max(36px,7cqmin)}
.qm-chip{background:var(--surface);color:var(--text);border:max(1px,.3cqmin) solid var(--border);border-radius:1em;padding:.2em .7em}
.qm-sheet{position:absolute;inset:0;z-index:6;overflow:auto;background:var(--bg);color:var(--text);box-sizing:border-box;
  padding:clamp(10px,3cqmin,36px);display:flex;flex-direction:column;gap:clamp(6px,1.6cqmin,20px);font-size:clamp(13px,3.4cqmin,36px)}
.qm-sheet h3{margin:0;font-size:1.3em}
.qm-sheet p{margin:0}
.qm-sheet .wg-btns{display:flex;flex-wrap:wrap;gap:.5em}
.qm-sheet .wg-btn[data-on="1"]{outline:max(3px,.8cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(2px,.4cqmin)}
.qm-code{font:800 clamp(28px,12cqmin,140px)/1 var(--font);letter-spacing:.12em}
.qm-lobby{display:flex;flex-wrap:wrap;gap:clamp(8px,2.5cqmin,30px);align-items:flex-start}
.qm-qr{width:clamp(90px,26cqmin,260px)}
.qm-qr svg{width:100%;height:auto;display:block}
.qm-seats{margin:0;padding:0;list-style:none;display:grid;gap:.3em}
.qm-seats li[data-away] {color:var(--text-soft)}
.qm-sheet input{font:inherit;padding:.3em .5em;border-radius:.4em;border:max(2px,.4cqmin) solid var(--border);background:var(--surface);
  color:var(--text);letter-spacing:.15em;text-transform:uppercase;width:8em;max-width:100%}
.qm-soft{color:var(--text-soft)}
`;
export function ensureTogetherStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

/**
 * ONE PANEL'S "PLAY TOGETHER".
 *   ctx      the module's ctx (gameLink / gameRooms / user / gameBase, roomTimers, personId, callTransport,
 *            screenPlayers / playerName, onGameAsk, onTogetherEnd, mount)
 *   hooks    the game's half:
 *     game, title            the game's type (the room's `game`, the ask's `game`) and its name in words
 *     getApi()               the quiz view's api (begun, start, engine, render)
 *     phase()                the engine's phase now
 *     localPlayers()         this screen's players: [{ id, name, index }]
 *     onTurn(t)              a guest: a turn for one of this screen's seats
 *     onAnswer(a)            the host: a result from another screen (also the server's skips)
 *     remoteNow()            the host: { seat, serial, name } while a turn is out at another screen, else null
 *     skipRemote(why)        the host: pass that turn on (nothing earned)
 *     publish()              the host: send the game's state to every screen in the room
 *     tableLine()            html: the table, under a waiting line ('' for none)
 *     onGuestDone()          a guest: the host's game is over - stop waiting for turns
 *     beforeEnd({ why, wasGuest })   the room is ending (still readable): keep its table, stop the host's clock
 *     afterEnd({ why, wasGuest, finish })   after it ended, before the engine is told
 */
export function createTogether(ctx, hooks) {
  const game = hooks.game;
  const title = hooks.title || game;
  const api = () => { try { return hooks.getApi?.() || null; } catch { return null; } };
  const phase = () => { try { return hooks.phase?.() || 'idle'; } catch { return 'idle'; } };
  let dead = false;

  // ---- the room this screen is in, if any (game_room.js) ----
  let link = null;              // the game socket: opened only when somebody chooses to play together
  let room = null;              // createRoomClient
  const inRoom = () => !!room && room.phase() === 'in';
  const isHost = () => inRoom() && room.role() === 'host';
  const isGuest = () => inRoom() && room.role() === 'guest';
  const roomBusy = () => !!room && ['opening', 'joining', 'asking', 'in'].includes(room.phase());

  // The room's clocks run on their own timer seam (`ctx.roomTimers`), not the panel's: a suite flushing the game's
  // timers must not also fire a ten-minute lobby clock.
  const roomSet = (fn, ms) => (typeof ctx.roomTimers?.set === 'function' ? ctx.roomTimers.set(fn, ms) : setTimeout(fn, ms));
  const roomClear = (id) => (typeof ctx.roomTimers?.clear === 'function' ? ctx.roomTimers.clear(id) : clearTimeout(id));

  let sheet = null;             // null | 'choose' | 'join': the "Play together" layer when no room is open
  let sheetLit = 0;             // the lit button, for a switch
  let showLobby = false;        // the host looking at the room again during a game
  let joinError = '';
  let note = '';                // why the last game together ended, in the corner for NOTE_MS
  let noteTimer = null;
  let lobbyTimer = null;
  // ASKED FROM THE CALL: who asked, and whether their screen has joined. `endAfter`: when this room ends, end this
  // screen's game too (the asker left, or the call ended).
  let asked = null;             // null | { name, joined }
  let endAfter = false;
  let offLive = null;
  let offAsk = null;
  const redraw = () => { try { api()?.render(); } catch { /* gone */ } };
  const begun = () => { try { return !!api()?.begun?.(); } catch { return false; } };
  const canTogether = () => ctx.gameRooms !== false
    && (typeof ctx.gameLink === 'function' || (typeof WebSocket !== 'undefined' && typeof fetch !== 'undefined'));
  const callLive = () => { try { return !!ctx.personId && !!ctx.callTransport?.isLive?.(); } catch { return false; } };
  function setNote(text) {
    note = text || '';
    if (noteTimer != null) { try { roomClear(noteTimer); } catch { /* gone */ } }
    noteTimer = note ? roomSet(() => { noteTimer = null; note = ''; redraw(); }, NOTE_MS) : null;
  }
  function clearLobby() { if (lobbyTimer != null) { try { roomClear(lobbyTimer); } catch { /* gone */ } } lobbyTimer = null; }
  const localPlayers = () => { try { return hooks.localPlayers?.() || []; } catch { return []; } };
  // This screen's players, as the room shows them: a name for each (the screen's person by their own name).
  function seatNames() {
    let self = '';
    try { self = String(ctx.screenPlayers?.self?.()?.name || ctx.playerName || ''); } catch { self = ''; }
    const ps = localPlayers();
    return (ps.length ? ps : [{ name: '' }]).map((p, i) => p.name || (i === 0 && self) || `Player ${i + 1}`);
  }

  /**
   * Playing together, the turn order is the ROOM's seats, wherever they sit. A seat on this screen is this screen's
   * own player (their ladder id, their name) at the same place in this screen's list; a seat elsewhere is a name and
   * where it is. `seat` is the room's id for it, and what the table is kept by. Not in a room: `local` as it is.
   */
  function players(local = localPlayers()) {
    if (!inRoom()) return local;
    const me = room.you();
    const seats = room.seats();
    const mine = seats.filter((s) => s.device === me);
    return seats.map((s, i) => {
      if (s.device === me) {
        const k = mine.findIndex((m) => m.id === s.id);
        const p = local[k] || { id: `seat:${s.id}`, name: s.name };
        return { ...p, name: p.name || s.name, seat: s.id, index: i, localIndex: k, here: true };
      }
      return { id: `seat:${s.id}`, seat: s.id, name: s.name, index: i, remote: s.device, away: !!s.away };
    });
  }

  function ensureRoom() {
    if (room) { try { room.destroy(); } catch { /* gone */ } }
    if (link) { try { link.close(); } catch { /* gone */ } }
    link = typeof ctx.gameLink === 'function' ? ctx.gameLink() : connectGameRoom({ user: ctx.user || null, base: ctx.gameBase || '' });
    room = createRoomClient({
      link,
      setTimer: roomSet, clearTimer: roomClear,
      onChange: () => onRoomChange(),
      onTurn: (t) => { try { hooks.onTurn?.(t); } catch (err) { console.error(`${game}: together turn`, err); } },
      onAnswer: (a) => { try { hooks.onAnswer?.(a); } catch (err) { console.error(`${game}: together answer`, err); } },
      onEnd: (why) => onRoomEnd(why),
    });
  }
  function startRoom({ call = false } = {}) {
    if (roomBusy() || dead) return false;
    ensureRoom();
    sheet = null; sheetLit = 0; joinError = ''; setNote('');
    room.open({ game, seats: seatNames(), admit: 'ask', person: call ? ctx.personId || null : null });
    clearLobby();
    lobbyTimer = roomSet(() => { lobbyTimer = null; if (isHost() && !begun()) stopTogether('unstarted'); }, LOBBY_MS);
    redraw();
    return true;
  }
  function joinRoom(code) {
    if (roomBusy() || dead) return false;
    const c = normalizeCode(code);
    if (!c) { joinError = `That is not a game code. A code is ${CODE_LEN} letters and numbers, like KX4 9PM.`; sheet = 'join'; redraw(); return false; }
    ensureRoom();
    sheet = null; sheetLit = 0; joinError = ''; setNote('');
    room.join(c, seatNames());
    redraw();
    return true;
  }
  function stopTogether(why = 'stopped') {
    if (!room) return;
    room.leave(why);              // ends here at once (onRoomEnd), and tells the room
  }
  /**
   * Somebody on the call asked to play (the kiosk hands it on: ctx.onGameAsk, or `askTogether` on a game it opened
   * for the call). true: this panel took it; false: not for this panel now (another game, no call live here, a game
   * together already open, no way to reach the site) - the kiosk then offers it to the next one.
   */
  function onAsk(a) {
    const A = api();
    if (dead || !a || a.game !== game || !A) return false;
    if (!canTogether() || !callLive() || roomBusy()) return false;
    const name = String(a.name || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40);
    // A game of its own going here ends first: the done view stays calm while the asker joins. (The caller's ask
    // stands for "stop, and play together" - both presses they could make anyway, being allowed to drive this screen.)
    if (A.begun() && phase() !== 'done') { try { A.engine.end(); } catch (err) { console.error(`${game}: end for the call`, err); } }
    if (!startRoom({ call: true })) return false;
    asked = { name, joined: false };
    endAfter = false;
    showLobby = true;
    clearLobby();
    lobbyTimer = roomSet(() => { lobbyTimer = null; if (asked && !asked.joined) stopTogether('nobody-came'); }, CALL_ASK_JOIN_MS);
    // The call ends here: the game together ends with it.
    try { offLive?.(); } catch { /* gone */ }
    offLive = null;
    try {
      offLive = ctx.callTransport?.onLive?.((on) => {
        if (on || !asked || !roomBusy()) return;
        endAfter = !!asked.joined;
        stopTogether(asked.joined ? 'call-left' : 'nobody-came');
      }) || null;
    } catch { offLive = null; }
    redraw();
    return true;
  }
  /** The asker's screen joined: the game starts by itself - a new game, for both ends. */
  function startAsked() {
    showLobby = false; sheetLit = 0;
    const A = api();
    if (!A) return;
    if (!A.begun()) { A.start(); hooks.publish?.(); return; }
    if (phase() !== 'done') { try { A.engine.end(); } catch { /* gone */ } }
    try { A.engine.press('restart'); } catch (err) { console.error(`${game}: start for the call`, err); }
    hooks.publish?.();
  }
  function onRoomChange() {
    if (dead || !room) return;
    if (asked && isHost()) {
      const others = room.seats().some((s) => s.device !== room.you());
      if (others && !asked.joined) { asked.joined = true; clearLobby(); startAsked(); }
      else if (!others && asked.joined) {
        // The asker's screen left the room (they closed the game, or hung up): the game together is over.
        endAfter = true;
        stopTogether('call-left');
        return;
      }
    }
    const A = api();
    if (isGuest()) {
      const st = room.state();
      // The host pressed Start: this screen's game starts with it (it waits for its turns from here on).
      if (st.phase === 'playing' && A && !A.begun()) A.start();
      if (st.phase === 'done' && A?.begun?.() && phase() !== 'done') { try { hooks.onGuestDone?.(); } catch { /* gone */ } A.engine.end(); }
    }
    const r = isHost() ? hooks.remoteNow?.() : null;
    if (r && !room.seats().some((s) => s.id === r.seat)) {
      // The screen holding this turn's seat is gone from the room: the turn passes on.
      try { hooks.skipRemote?.('left'); } catch (err) { console.error(`${game}: skip`, err); }
    }
    redraw();
  }
  function onRoomEnd(why) {
    const wasGuest = room?.role() === 'guest';
    try { hooks.beforeEnd?.({ why, wasGuest }); } catch (err) { console.error(`${game}: together end`, err); }
    clearLobby();
    showLobby = false;
    setNote(why === 'stopped' || why === 'left' ? '' : endWords(why));
    const r = room;
    const l = link;
    room = null; link = null;
    // Asked from the call: that is over too. `finish`: this screen's game ends with it.
    const finish = endAfter;
    asked = null; endAfter = false;
    try { offLive?.(); } catch { /* gone */ }
    offLive = null;
    queueMicrotask(() => {
      try { r?.destroy(); } catch { /* gone */ }
      try { l?.close(); } catch { /* gone */ }
      const A = api();
      if (dead || !A) return;
      try { hooks.afterEnd?.({ why, wasGuest, finish }); } catch (err) { console.error(`${game}: together end`, err); }
      if (wasGuest) {
        if (A.begun() && phase() !== 'done') A.engine.end();     // back to this screen's own game: Play again
      } else if (finish) {
        if (A.begun() && phase() !== 'done') A.engine.end();     // the game was for the call: it ends with it
      } else if (A.begun() && phase() === 'loading') {
        A.engine.refresh();          // the host carries on with its own players
      }
      // A host that opened this panel only for the call (the kiosk's call view) closes it once the room is over.
      try { ctx.onTogetherEnd?.(why); } catch (err) { console.error(`${game}: together end`, err); }
      redraw();
    });
    redraw();
  }

  // ---- the words ----
  const firstSeatOf = (device) => room?.seats().find((s) => s.device === device) || null;
  const hostName = () => firstSeatOf('d0')?.name || 'the other screen';
  function whereOf(p) {
    if (!p || p.here) return 'this screen';
    const first = firstSeatOf(p.remote);
    return first ? `${first.name}'s screen` : 'another screen';
  }
  const tableLine = () => { try { return String(hooks.tableLine?.() || ''); } catch { return ''; } };
  function waitingHtml() {
    if (!inRoom()) return '';
    const r = isHost() ? hooks.remoteNow?.() : null;
    if (r) {
      const p = players().find((x) => x.seat === r.seat) || { name: r.name, remote: null };
      const away = room.seats().find((s) => s.id === r.seat)?.away;
      return `<p class="wg-say" data-remote-turn="${esc(r.seat)}">${esc(`${p.name}'s turn, on ${whereOf(p)}.`)}</p>`
        + (away ? '<p class="wg-say wg-soft" data-away>That screen has stopped answering. If it does not come back soon, the turn passes on by itself.</p>' : '')
        + `<div class="wg-btns"><button type="button" class="wg-btn" data-qm="skip">Skip their turn</button></div>${tableLine()}`;
    }
    if (isGuest()) {
      const st = room.state();
      if (room.hostAway()) return `<p class="wg-say" data-host-away>${esc(`Waiting for ${hostName()}'s screen to come back…`)}</p>${tableLine()}`;
      if (st.phase === 'lobby') return `<p class="wg-say" data-lobby>${esc(`Waiting for ${hostName()} to start the game.`)}</p>`;
      const p = players().find((x) => x.seat === st.turn);
      const line = p && !p.here ? `${p.name}'s turn, on ${whereOf(p)}.` : 'Waiting for the next turn.';
      return `<p class="wg-say" data-remote-turn="${esc(p?.seat || '')}">${esc(line)}</p>${tableLine()}`;
    }
    return '';
  }

  // ---- the layer: the corner bar, and the sheet over the panel ----
  // The sheet's buttons, in order, so a switch can step through them (`onMove`) as a finger taps them.
  function sheetButtons() {
    if (dead) return [];
    const b = [];
    if (room && ['opening', 'joining', 'asking'].includes(room.phase())) {
      b.push({ act: 'stop', label: room.phase() === 'opening' ? 'Never mind' : 'Stop asking' });
      return b;
    }
    if (isHost() && (!begun() || showLobby)) {
      for (const w of room.waiting()) {
        b.push({ act: 'admit', arg: w.id, label: `Let ${w.names.join(' and ')} in` });
        b.push({ act: 'deny', arg: w.id, label: 'Not now' });
      }
      b.push(begun() ? { act: 'hide', label: 'Back to the game' } : { act: 'start', label: 'Start the game' });
      b.push({ act: 'admitmode', label: room.admit() === 'connected' ? 'Ask me before each one joins' : 'Let anyone connected to this login join without asking' });
      b.push({ act: 'stop', label: 'Stop playing together' });
      return b;
    }
    if (isGuest() && room.state().phase === 'lobby') { b.push({ act: 'stop', label: 'Leave the game' }); return b; }
    if (inRoom()) return b;
    if (sheet === 'choose') {
      b.push({ act: 'local', label: 'On this screen' });
      b.push({ act: 'host', label: 'With another screen' });
      b.push({ act: 'joinform', label: 'Join a game' });
      if (callLive()) b.push({ act: 'call', label: 'On this call' });
      b.push({ act: 'close', label: 'Back' });
    } else if (sheet === 'join') {
      b.push({ act: 'join', label: 'Join' });
      b.push({ act: 'close', label: 'Back' });
    }
    return b;
  }
  const btnHtml = (list) => `<div class="wg-btns">${list.map((x, i) => `<button type="button" class="wg-btn" data-qm="${esc(x.act)}"`
    + `${x.arg ? ` data-qm-arg="${esc(x.arg)}"` : ''}${i === sheetLit ? ' data-on="1"' : ''}>${esc(x.label)}</button>`).join('')}</div>`;
  const seatList = () => `<ul class="qm-seats" data-seats>${room.seats().map((st) => {
    const p = { here: st.device === room.you(), remote: st.device };
    return `<li data-seat="${esc(st.id)}"${st.away ? ' data-away' : ''}><b>${esc(st.name)}</b> <span class="qm-soft">on ${esc(whereOf(p))}${st.away ? ' (stopped answering)' : ''}</span></li>`;
  }).join('')}</ul>`;
  function barHtml(s) {
    if (inRoom() && !(isHost() && (!begun() || showLobby)) && !(isGuest() && room.state().phase === 'lobby')) {
      const label = isHost() ? 'Stop playing together' : 'Leave the game';
      return `<div class="qm-bar" data-qm-bar><span class="qm-chip" data-qm-code="${esc(room.code())}">Playing together · ${esc(codeWords(room.code()))}</span>`
        + (isHost() ? '<button type="button" class="wg-btn" data-qm="lobby">Who is playing</button>' : '')
        + `<button type="button" class="wg-btn" data-qm="stop">${esc(label)}</button></div>`;
    }
    if (roomBusy() || sheet) return '';
    const offer = canTogether() && (!begun() || s?.phase === 'done');
    if (!offer && !note) return '';
    return `<div class="qm-bar" data-qm-bar>${note ? `<span class="qm-chip" data-qm-note role="status">${esc(note)}</span>` : ''}`
      + (offer ? '<button type="button" class="wg-btn" data-qm="open">Play together</button>' : '') + '</div>';
  }
  function sheetBody() {
    const btns = sheetButtons();
    if (sheetLit >= btns.length) sheetLit = 0;
    const wrap = (kind, inner) => `<div class="qm-sheet" data-qm-sheet="${kind}" role="dialog" aria-label="Play together">${inner}${btnHtml(btns)}</div>`;
    if (room && ['opening', 'joining', 'asking'].includes(room.phase())) {
      const ph = room.phase();
      const line = ph === 'opening' ? 'Opening a game for other screens to join…'
        : ph === 'joining' ? 'Asking to join…' : 'Asked to join. Somebody at that screen needs to let you in.';
      return wrap(ph, `<h3>Play together</h3><p data-qm-status>${esc(line)}</p>`);
    }
    if (isHost() && (!begun() || showLobby)) {
      const code = room.code();
      const path = playPath(code, game);
      let qr = '';
      try { qr = elsewhereQR(path, { colours: themeQrColours(ctx.mount || null) }); } catch { qr = ''; }
      const waiting = room.waiting().map((w) => `<li data-waiting="${esc(w.id)}"><b>${esc(w.names.join(', '))}</b>`
        + `${w.from ? ` <span class="qm-soft">(${esc(w.from)})</span>` : ''} would like to join.</li>`).join('');
      const how = asked
        ? `<p data-qm-asked>${esc(asked.name ? `${asked.name} asked to play on this call.` : 'Somebody on the call asked to play.')} The game starts when they join.</p>`
        : room.call() ? '<p data-qm-call>Offered to the call: they can join from their call page, beside the video.</p>' : '';
      return wrap('lobby', `<h3>Play together</h3><div class="qm-lobby"><div><p>The game's code</p>
        <p class="qm-code" data-qm-code="${esc(code)}" aria-label="${esc([...code].join(' '))}">${esc(codeWords(code))}</p>
        <p class="qm-soft">${esc(`On another screen with ${title}: Play together, then Join a game, and enter this code.`)}</p>
        <p class="qm-soft">On a phone: scan the square, or open ${esc(pageAddress(path))}</p>${how}</div>
        ${qr ? `<div class="qm-qr" data-qm-qr>${qr}</div>` : ''}</div>
        <p><b>Playing</b></p>${seatList()}
        ${waiting ? `<ul class="qm-seats" data-qm-waiting>${waiting}</ul>` : ''}`);
    }
    if (isGuest() && room.state().phase === 'lobby') {
      return wrap('joined', `<h3>Play together</h3><p data-qm-status>${esc(`You are in ${hostName()}'s game. It starts when they press Start the game.`)}</p>${seatList()}`);
    }
    if (inRoom()) return '';
    if (sheet === 'choose') {
      return wrap('choose', `<h3>Play together</h3><p class="qm-soft">Take turns on this screen, play with somebody on their own screen, or join a game somebody else started.</p>`);
    }
    if (sheet === 'join') {
      return wrap('join', `<h3>Join a game</h3><p>The code on the other screen:</p>
        <input type="text" data-qm-input inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" aria-label="Game code" value="">
        ${joinError ? `<p class="wg-say" data-qm-error role="alert">${esc(joinError)}</p>` : ''}`);
    }
    return '';
  }
  const sheetHtml = (s) => barHtml(s) + sheetBody();

  function act(a, arg = '') {
    switch (a) {
      case 'open': sheet = 'choose'; sheetLit = 0; setNote(''); break;
      case 'close': case 'local': sheet = null; joinError = ''; break;
      case 'host': startRoom({ call: false }); return;
      case 'call': startRoom({ call: true }); return;
      case 'joinform': sheet = 'join'; sheetLit = 0; joinError = ''; break;
      case 'join': {
        const el = ctx.mount?.querySelector?.('[data-qm-input]');
        joinRoom(el ? el.value : '');
        return;
      }
      case 'admit': room?.admitOne(arg, true); break;
      case 'deny': room?.admitOne(arg, false); break;
      case 'admitmode': room?.setAdmit(room.admit() === 'connected' ? 'ask' : 'connected'); break;
      case 'start': clearLobby(); showLobby = false; sheetLit = 0; api()?.start(); hooks.publish?.(); break;
      case 'hide': showLobby = false; break;
      case 'lobby': showLobby = true; sheetLit = 0; break;
      case 'stop': stopTogether(isHost() || !inRoom() ? 'stopped' : 'left'); break;
      case 'skip':
        if (isHost() && hooks.remoteNow?.()) { try { hooks.skipRemote?.('skipped'); } catch (err) { console.error(`${game}: skip`, err); } }
        return;
      default: return;
    }
    redraw();
  }
  function onClick(e) {
    const t = e?.target;
    if (t?.closest?.('[data-qm-input]')) return true;        // typing the code is not Start
    const b = t?.closest?.('[data-qm]');
    if (b) { act(b.dataset.qm, b.dataset.qmArg || ''); return true; }
    // A tap on the sheet itself (not a button) does nothing underneath it.
    return !!t?.closest?.('[data-qm-sheet]');
  }
  function onMove(m) {
    const btns = sheetButtons();
    const sheetUp = !!ctx.mount?.querySelector?.('[data-qm-sheet]') && btns.length > 0;
    if (!sheetUp) {
      // Waiting on another screen: the switch's "skip" passes their turn on, as the button does.
      if (m === 'skip' && isHost() && hooks.remoteNow?.()) { act('skip'); return true; }
      return false;
    }
    if (m === 'next') sheetLit = (sheetLit + 1) % btns.length;
    else if (m === 'prev') sheetLit = (sheetLit - 1 + btns.length) % btns.length;
    else if (m === 'select') { const x = btns[sheetLit]; if (x) act(x.act, x.arg || ''); return true; }
    else return true;
    redraw();
    return true;
  }

  return {
    inRoom, isHost, isGuest, roomBusy, canTogether, callLive,
    room: () => room,
    players,
    roomSet, roomClear,
    startRoom, joinRoom, stop: stopTogether, onAsk,
    waitingHtml, sheetHtml, onClick, onMove, act,
    whereOf, hostName,
    note: () => note, sheet: () => sheet, showLobby: () => showLobby, asked: () => (asked ? { ...asked } : null),
    /** At the view's init: the join page's room (ctx.autoJoin), and the kiosk's asks (ctx.onGameAsk). */
    init() {
      ensureTogetherStyle(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null));
      if (ctx.autoJoin) { try { joinRoom(ctx.autoJoin); } catch (err) { console.error(`${game}: join`, err); } }
      // Asked from the call: the kiosk offers each ask to its game panels, first taker wins.
      if (typeof ctx.onGameAsk === 'function') {
        try { offAsk = ctx.onGameAsk((x) => onAsk(x)) || null; } catch (err) { console.error(`${game}: asks`, err); }
      }
    },
    destroy() {
      dead = true;
      try { offAsk?.(); } catch { /* gone */ }
      try { offLive?.(); } catch { /* gone */ }
      offAsk = null; offLive = null;
      clearLobby();
      if (noteTimer != null) { try { roomClear(noteTimer); } catch { /* gone */ } noteTimer = null; }
      try { room?.destroy(); } catch { /* gone */ }
      try { link?.close(); } catch { /* gone */ }
      room = null; link = null;
    },
  };
}
