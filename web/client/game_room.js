// game_room.js — the client half of PLAYING TOGETHER: a game room that more than one screen joins.
//
// Mike, 2026-10-06: "There should be multiplayer that you can play local, online or over calls." The server half,
// and the argument for every rule, is web/server/game_rooms.py; read its header first. In one breath:
//   * a ROOM has a code, a HOST screen (the one that opened it), and SEATS, each belonging to one screen;
//   * ONLY THE HOST changes the game; another screen asks to join, answers the turns given to ITS OWN seats, and
//     leaves;
//   * each screen deals and judges its own seats' questions off its own login's ladders, and sends back only
//     { seat, category, right, points } - no person's levels cross logins.
//
// WHY ITS OWN SOCKET (not drive.js's): the drive socket's door is "may press this screen's buttons" (a drive grant).
// A friend you play a quiz with should not need that. So this socket's door is "signed in", and who may join which
// room is the server's decision, per room (the same login; a connected one, let in by the host; one on the room's
// call). And a game message has no path to a verb or a bus topic at either end: nothing here publishes anything.
//
// Two pieces, both with seams so the suites need no server:
//   connectGameRoom()   the socket: a ticket over ordinary sign-in, then the socket; reconnects with backoff, like
//                       drive.js. Sends only the kinds below, only under the size cap.
//   createRoomClient()  one screen's view of one room: open or join, what the room looks like now, the turns and
//                       answers, coming back after a dropped socket (its key), and THE CLOCKS THAT END A WAIT when
//                       the server can no longer be heard (see the constants).

import { authHeaders, httpError } from './auth.js';

// Mirrored from game_rooms.py, and deliberately duplicated: a boundary that widens because another file grew an entry
// is not a boundary.
export const GAME_KINDS = Object.freeze(['room', 'join', 'admit', 'turn', 'answer', 'leave', 'ping']);
export const MAX_GAME_BYTES = 4096;
export const MAX_SEATS = 4;
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
export const STATES = Object.freeze(['offline', 'connecting', 'connected']);

// THE CLIENT'S OWN BACKSTOPS - for a server this screen can no longer hear. The server's clocks are the real ones
// (game_rooms.py); these only make sure a screen whose socket is gone does not wait for ever. Each is the server's
// number plus a margin, so the server always speaks first when it can.
//   ASK_BACKSTOP_MS   asking to join (the server says "nobody answered" at 120 s)
//   LOST_MS           no socket at all, while in a room: 45 s, longer than the server's 30 s for a host and 20 s for
//                     a seat, so a blip that the server forgives is forgiven here too
//   REPLY_MS          opening or joining with no reply at all (signed out, no site, an older server): 20 s, two
//                     ticket-and-socket round trips on a slow network with room to spare
export const ASK_BACKSTOP_MS = 135000;
export const LOST_MS = 45000;
export const REPLY_MS = 20000;

// What each ending means, in plain words (shown on the screen that was in the room).
export const END_WORDS = Object.freeze({
  'no-room': 'There is no game with that code that you can join. Check the code, and that you are connected with them.',
  full: 'That game is full.',
  declined: 'They did not let you in this time.',
  'no-answer': 'Nobody let you in. Try again when somebody is at that screen.',
  'host-left': 'The game together has ended.',
  'host-gone': 'The other screen stopped answering, so the game together has ended.',
  removed: 'This screen was taken out of the game.',
  idle: 'The game together ended: nobody played for a while.',
  lost: 'Lost touch with the site, so the game together has ended.',
  busy: 'Too many games are open right now. Try again in a little while.',
  'not-allowed': 'This screen cannot offer a game on that call.',
  closed: 'That game has ended.',
  gone: 'This screen was away too long, so it left the game.',
  left: 'You left the game.',
  stopped: 'You stopped playing together.',
  unstarted: 'The game together ended: nobody started it.',
  'no-site': 'Could not reach the site to play together. Check the connection, and that this screen is signed in.',
});
export const endWords = (why) => END_WORDS[why] || END_WORDS.closed;

/** 'kx4-9pm' -> 'KX49PM'; '' when it cannot be a code. */
export function normalizeCode(s) {
  const c = String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== CODE_LEN || [...c].some((ch) => !CODE_ALPHABET.includes(ch))) return '';
  return c;
}
/** 'KX49PM' -> 'KX4 9PM': how a code is shown and read out. */
export const codeWords = (code) => (String(code || '').length === CODE_LEN ? `${code.slice(0, 3)} ${code.slice(3)}` : String(code || ''));

const wsURL = (base, ticket) => {
  const origin = base || (typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : '');
  const scheme = origin.startsWith('https') ? 'wss' : 'ws';
  const host = origin.replace(/^https?:\/\//, '');
  return `${scheme}://${host}/api/game?t=${encodeURIComponent(ticket)}`;
};

/** Is this a message this screen may send? (The server checks every field again; this catches a muddled caller.) */
export function sendable(msg) {
  if (!msg || typeof msg !== 'object' || !GAME_KINDS.includes(msg.kind)) return null;
  let text = '';
  try { text = JSON.stringify(msg); } catch { return null; }
  if (new TextEncoder().encode(text).length > MAX_GAME_BYTES) return null;
  return text;
}

export function connectGameRoom({
  user = null,
  base = '',
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  SocketImpl = (typeof WebSocket !== 'undefined' ? WebSocket : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  backoff = [1000, 2000, 4000, 8000],
} = {}) {
  let sock = null;
  let state = 'offline';
  let closed = false;
  let attempt = 0;
  let timer = null;
  let authFailed = false;
  const msgSubs = new Set();
  const stateSubs = new Set();
  const fan = (set, v) => { for (const fn of [...set]) { try { fn(v); } catch (err) { console.error('game room: listener', err); } } };
  const setState = (s) => { if (s !== state) { state = s; fan(stateSubs, s); } };

  async function ticketFor() {
    const res = await fetchImpl(`${base}/api/game/ticket`, { method: 'POST', headers: authHeaders(user), credentials: 'same-origin' });
    if (!res.ok) throw httpError(res, `game ticket -> ${res.status}`);
    return (await res.json()).ticket;
  }
  function retry() {
    if (closed) return;
    const wait = backoff[Math.min(attempt, backoff.length - 1)];
    attempt += 1;
    clearTimer(timer);
    timer = setTimer(() => open(), wait);
  }
  async function open() {
    if (closed) return;
    setState('connecting');
    let ticket;
    try { ticket = await ticketFor(); authFailed = false; }
    catch (err) { authFailed = err?.status === 401 || err?.status === 403; setState('offline'); retry(); return; }
    if (closed) return;
    try { sock = new SocketImpl(wsURL(base, ticket)); }
    catch { setState('offline'); retry(); return; }
    const mine = sock;
    sock.onopen = () => { if (sock !== mine) return; attempt = 0; setState('connected'); };
    sock.onmessage = (ev) => {
      if (sock !== mine) return;
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg && typeof msg === 'object' && typeof msg.kind === 'string') fan(msgSubs, msg);
    };
    sock.onclose = () => { if (sock !== mine) return; sock = null; setState('offline'); retry(); };
    sock.onerror = () => { /* onclose follows */ };
  }
  function send(msg) {
    const text = sendable(msg);
    if (!text || !sock || state !== 'connected') return false;
    try { sock.send(text); return true; } catch { return false; }
  }
  open();
  return {
    send,
    state: () => state,
    authFailed: () => authFailed,
    onMessage(cb) { if (typeof cb !== 'function') return () => {}; msgSubs.add(cb); return () => msgSubs.delete(cb); },
    onState(cb) { if (typeof cb !== 'function') return () => {}; stateSubs.add(cb); return () => stateSubs.delete(cb); },
    close() {
      closed = true;
      clearTimer(timer);
      msgSubs.clear();
      try { sock?.close(); } catch { /* gone */ }
      sock = null;
      setState('offline');
      stateSubs.clear();
    },
  };
}

/**
 * ONE SCREEN'S VIEW OF ONE ROOM.
 *   link     a connectGameRoom() handle (or a suite's fake: send, state, onMessage, onState, close)
 *   onChange called whenever anything shown changes
 *   onTurn({ seat, serial, round, category })            a turn for one of THIS screen's seats
 *   onAnswer({ seat, serial, category, right, points, skipped?, why? })   the host: a result from another screen
 *   onEnd(why)                                           the room is over for this screen (END_WORDS)
 * Phases: 'idle' -> 'opening' | 'joining' -> ('asking') -> 'in' -> 'ended'.
 */
export function createRoomClient({
  link,
  onChange = () => {}, onTurn = () => {}, onAnswer = () => {}, onEnd = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  askBackstopMs = ASK_BACKSTOP_MS,
  lostMs = LOST_MS,
  replyMs = REPLY_MS,
} = {}) {
  if (!link) throw new Error('createRoomClient: a link is required');
  let phase = 'idle';
  let role = null;            // 'host' | 'guest'
  let code = '';
  let key = '';
  let you = '';
  let waiterId = '';
  let seats = [];             // [{ id, name, device, away }]
  let state = { phase: 'lobby', round: 0, rounds: 0, category: null, turn: null, totals: {} };
  let waiting = [];           // the host's: [{ id, names, how, from }]
  let admit = 'ask';
  let call = false;
  let hostAway = false;
  let ended = '';
  let pendingOpen = null;     // what to send once the socket is up
  let joinSeats = null;
  let askTimer = null;
  let lostTimer = null;
  let dead = false;
  const changed = () => { if (!dead) { try { onChange(); } catch (err) { console.error('game room: change', err); } } };
  const stop = (t) => { if (t != null) { try { clearTimer(t); } catch { /* gone */ } } return null; };

  function end(why) {
    if (phase === 'ended' || phase === 'idle') { phase = 'ended'; ended = why; changed(); return; }
    phase = 'ended';
    ended = why;
    askTimer = stop(askTimer);
    lostTimer = stop(lostTimer);
    try { onEnd(why); } catch (err) { console.error('game room: end', err); }
    changed();
  }

  function sendNow(msg) { return link.send(msg); }
  function flushPending() {
    if (link.state() !== 'connected') return;
    if (phase === 'opening' && pendingOpen) { if (sendNow(pendingOpen)) pendingOpen = null; return; }
    if (phase === 'joining' && pendingOpen) { if (sendNow(pendingOpen)) pendingOpen = null; return; }
    // BACK AFTER A DROPPED SOCKET: the same seats, by the key this screen was given.
    if (phase === 'in' && key) {
      if (role === 'host') sendNow({ kind: 'room', resume: { code, key } });
      else sendNow({ kind: 'join', code, key, seats: (joinSeats || seats.filter((s) => s.device === you).map((s) => s.name)).map((name) => ({ name })) });
    }
  }

  const offMsg = link.onMessage((m) => {
    if (dead || !m) return;
    switch (m.kind) {
      case 'opened':
        if (phase !== 'opening' && phase !== 'in') return;
        role = 'host'; code = m.code; key = m.key; you = m.you; phase = 'in'; changed(); return;
      case 'joined':
        if (phase !== 'joining' && phase !== 'asking' && phase !== 'in') return;
        askTimer = stop(askTimer);
        role = 'guest'; code = m.code; key = m.key; you = m.you; phase = 'in'; changed(); return;
      case 'waiting':
        if (phase !== 'joining') return;
        phase = 'asking'; waiterId = m.id || '';
        // Now it is up to somebody at the host's screen: the longer clock (the server's own speaks first).
        askTimer = stop(askTimer);
        askTimer = setTimer(() => { askTimer = null; if (phase === 'asking') end('no-answer'); }, askBackstopMs);
        changed();
        return;
      case 'refused':
        if (phase === 'opening' || phase === 'joining' || phase === 'asking') end(m.why || 'closed');
        else if (phase === 'in') end('lost');           // a resume the server no longer knows
        return;
      case 'closed':
        if (phase === 'in' || phase === 'asking') end(m.why || 'closed');
        return;
      case 'room':
        if (phase !== 'in' || m.code !== code) return;
        seats = Array.isArray(m.seats) ? m.seats.map((s) => ({ id: String(s.id), name: String(s.name || ''), device: String(s.device), away: !!s.away })) : [];
        state = m.state && typeof m.state === 'object' ? { ...m.state, totals: { ...(m.state.totals || {}) } } : state;
        waiting = Array.isArray(m.waiting) ? m.waiting : [];
        admit = m.admit === 'connected' ? 'connected' : 'ask';
        call = !!m.call;
        hostAway = !!m.hostAway;
        changed();
        return;
      case 'turn':
        if (phase === 'in' && role === 'guest') { try { onTurn({ seat: m.seat, serial: m.serial, round: m.round, category: m.category }); } catch (err) { console.error('game room: turn', err); } }
        return;
      case 'answer':
        if (phase === 'in' && role === 'host') { try { onAnswer({ ...m }); } catch (err) { console.error('game room: answer', err); } }
        return;
      default:
    }
  });
  const offState = link.onState((s) => {
    if (dead) return;
    if (s === 'connected') { lostTimer = stop(lostTimer); flushPending(); changed(); return; }
    if ((phase === 'in' || phase === 'asking') && lostTimer == null) {
      lostTimer = setTimer(() => { lostTimer = null; if (link.state() !== 'connected') end('lost'); }, lostMs);
    }
    changed();
  });

  function begin(next, msg) {
    if (phase !== 'idle' && phase !== 'ended') return false;
    phase = next;
    ended = '';
    pendingOpen = msg;
    flushPending();
    // No reply at all (signed out, no site, a server that does not know rooms): the wait ends by itself.
    askTimer = stop(askTimer);
    askTimer = setTimer(() => { askTimer = null; if (phase === next) end('no-site'); }, replyMs);
    changed();
    return true;
  }

  return {
    /** Host: open a room. `seats`: this screen's players' names; `person`: a call room's person. */
    open({ game = 'quiz_mix', seats: names = [], admit: a = 'ask', person = null } = {}) {
      const s = (names.length ? names : ['Player 1']).slice(0, MAX_SEATS).map((name) => ({ name: String(name || '') }));
      const o = { game, seats: s, admit: a === 'connected' ? 'connected' : 'ask' };
      if (person) o.person = person;
      return begin('opening', { kind: 'room', open: o });
    },
    /** Guest: ask to join a room by code. */
    join(c, names = []) {
      const nc = normalizeCode(c);
      if (!nc) return false;
      joinSeats = (names.length ? names : ['Player']).slice(0, MAX_SEATS).map((n) => String(n || ''));
      return begin('joining', { kind: 'join', code: nc, seats: joinSeats.map((name) => ({ name })) });
    },
    admitOne: (id, yes) => (role === 'host' ? sendNow({ kind: 'admit', id, yes: !!yes }) : false),
    setAdmit: (mode) => (role === 'host' ? sendNow({ kind: 'room', admit: mode === 'connected' ? 'connected' : 'ask' }) : false),
    update: (st) => (role === 'host' && phase === 'in' ? sendNow({ kind: 'room', state: st }) : false),
    turn: (t) => (role === 'host' && phase === 'in' ? sendNow({ kind: 'turn', ...t }) : false),
    answer: (a) => (role === 'guest' && phase === 'in' ? sendNow({ kind: 'answer', ...a }) : false),
    remove: (id) => (role === 'host' ? sendNow({ kind: 'leave', id }) : false),
    /** Leave (a guest), stop asking, or end the room for everybody (the host). Ends here at once either way. */
    leave(why = 'stopped') {
      if (phase === 'idle' || phase === 'ended') return;
      try { link.send({ kind: 'leave' }); } catch { /* gone */ }
      end(why);
    },
    phase: () => phase, role: () => role, code: () => code, you: () => you, waiterId: () => waiterId,
    seats: () => seats.map((s) => ({ ...s })), state: () => ({ ...state, totals: { ...(state.totals || {}) } }),
    waiting: () => waiting.slice(), admit: () => admit, call: () => call, hostAway: () => hostAway, ended: () => ended,
    connected: () => link.state() === 'connected',
    destroy() {
      if (phase === 'in' || phase === 'asking' || phase === 'joining' || phase === 'opening') { try { link.send({ kind: 'leave' }); } catch { /* gone */ } }
      dead = true;
      askTimer = stop(askTimer);
      lostTimer = stop(lostTimer);
      try { offMsg?.(); offState?.(); } catch { /* gone */ }
    },
  };
}
