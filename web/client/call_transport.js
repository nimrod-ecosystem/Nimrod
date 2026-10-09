// call_transport.js — the WebRTC half of a call, on any network.
//
// `modules/call.js` has always taken its transport from `ctx.callTransport` and shipped
// without one, so the Call panel mounted, rendered its idle state, and could never ring.
// This is the transport. The media half is ported from the validated private `call.js`
// (phone ↔ Pi, July 2026); the connectivity half is new, and it is the whole point of this
// file.
//
// ---------------------------------------------------------------------------------------
// *** WHAT WAS ACTUALLY VPN-ONLY, AND IT WAS ONE LINE ***
// ---------------------------------------------------------------------------------------
//
// The validated call reads:
//
//     pc = new RTCPeerConnection({ iceServers: [] });   // Tailscale-only, no STUN/TURN
//
// An empty ICE server list means the browser offers only the addresses it can see on its
// own interfaces. On a Tailscale mesh both ends have a routable address for each other, so
// that works and needs no infrastructure at all — which is exactly why it was written that
// way to prove the media path. It is not a design decision, and `DECISIONS.md` (2026-08-09)
// already says the opposite: **any-network by default, Tailscale optional, never required.**
//
// Filling that array is most of the fix.
//
// ---------------------------------------------------------------------------------------
// THE THREE PIECES, AND ONLY ONE OF THEM COSTS ANYTHING
// ---------------------------------------------------------------------------------------
//
//   SIGNALLING  Somebody has to carry the offer and the answer before any media can flow —
//               the one part of a call that cannot be peer-to-peer, because the peers
//               cannot reach each other yet. This rides the EXISTING drive socket
//               (`drive.js`, `drive.py`), which already authenticates, already knows which
//               two devices belong to one person, and already reconnects. A few kilobytes
//               at the start of a call, then nothing.
//
//   STUN        "What does my address look like from outside?" One packet each way,
//               stateless, free. This is what fills the empty array, and for most
//               home-to-home pairs it is all that is needed.
//
//   TURN        A relay for when no direct path exists. This is the only piece that costs
//               money, because it carries the actual video. NOT CONFIGURED HERE and that is
//               deliberate — see below.
//
// ---------------------------------------------------------------------------------------
// TURN IS A SETTING, NOT A DEFAULT, AND HERE IS THE HONEST REASON
// ---------------------------------------------------------------------------------------
//
// A relayed call pushes roughly a gigabyte an hour through whoever's server it lands on. A
// public default would mean this project quietly paying for every stranger's video, which
// is the same trap as paying for everyone's AI tokens.
//
// So `turn` is empty and somebody has to fill it in: their own `coturn` on a cheap box,
// managed credentials from a provider, or nothing at all. **Nothing at all is a legitimate
// choice** — it means calls work whenever a direct path exists and fail honestly when it
// does not, which is a much better product than a call that silently costs somebody money.
//
// *** AND THE NETWORK THAT NEEDS TURN IS THE ONE THAT MATTERS MOST. *** Institutional guest
// wifi — a care facility — is where a direct connection fails: symmetric NAT, sometimes
// client isolation, often UDP blocked so a relay has to run on TCP/443 to get out at all.
// So the deployment this project exists for is the most likely to need the one piece that
// is not free. That is a testing problem before it is a budget one, and it is written down
// here so nobody discovers it at a bedside.
//
// ---------------------------------------------------------------------------------------
// NON-TRICKLE, BECAUSE IT IS WHAT WAS PROVEN
// ---------------------------------------------------------------------------------------
//
// Candidates are gathered first and ONE description is sent, rather than trickling each
// candidate as it appears. Trickle connects faster and this does not do it, deliberately:
// the private build is non-trickle, it is the thing that has actually worked between a
// phone and a Pi, and changing the connection strategy in the same change that adds STUN
// would mean a failure could be either. There is a gather timeout so a network that never
// reports `complete` cannot hang the call — that number came from the private build too.
//
// Trickle is a later optimisation, and it is a real one: gathering can take a second or
// two, and with a TURN server in the list it can take longer.

import { SIGNAL_KINDS } from './drive.js';

// Free, public, stateless. Two of them because one being down should not mean no calls, and
// they are from different operators for the same reason.
export const DEFAULT_STUN = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

// How long to wait for ICE gathering before sending anyway. From the private build.
export const GATHER_TIMEOUT_MS = 3000;

// A call that dropped without a `bye` waits this long for the caller to re-offer before it
// gives up. Also from the private build, and the reason is hers: a screen must never be
// stuck showing a dead call, because she cannot dismiss it.
export const STALL_MS = 30000;

// ---------------------------------------------------------------------------------------
// *** AN ANSWER THAT NEVER CONNECTS ENDS *** (2026-10-04)
// ---------------------------------------------------------------------------------------
//
// The stall clock above only starts when the connection reports 'failed'. A connection that sits
// at 'new' or 'connecting' never reports that - a caller whose page closed between offer and
// answer, a network whose packets go nowhere - so an answered call stayed "live" for ever, the
// camera and the microphone open, the screen showing a call with nobody in it. The intercom
// already had this clock (intercom.js, "AN ANSWER THAT NEVER CONNECTS ENDS"); a call did not.
//
// So from the moment the screen starts answering, a CONNECT CLOCK runs until the connection
// reports 'connected'. Run out, and the call ends here: the caller is told (`bye`, reason
// 'failed', which the caller page shows as "The call could not connect."), the connection closes,
// and the panel releases the camera and the microphone and says so. A call that HAD connected and
// is being re-answered after a drop says 'connection-lost' instead, because that is what happened.
//
// RECONNECTS: a re-offer re-arms the clock (the re-answer is a new connection that has to connect
// too - before, a re-answer that never connected had no clock at all). A call that WAS connected
// and drops goes to the stall clock above, exactly as before; this one is not running then. While
// this clock runs, a 'failed' does not also start the stall clock: this one already bounds it.
//
// 30 s, ARGUED, and deliberately the same as STALL_MS:
//   * it is the intercom's number for the very same backstop, so the two ways into a room behave
//     alike;
//   * the gathering is already done when the answer leaves (non-trickle, GATHER_TIMEOUT_MS), so
//     this is connectivity checks only - a second or two on a good path, longer through a relay on
//     TCP/443 on institutional wifi, which is exactly the network this project cares most about;
//     a short clock would hang up on the slow-but-working call that matters most;
//   * the cost of waiting is bounded and visible: the screen shows the call, as it already did for
//     up to 30 s after a drop.
// The caller page's CONNECT_MS (15 s) is a different clock - how long to wait for the SITE'S socket
// - not this one.
//
// THE CALLER RUNS IT TOO (2026-10-04), from the moment the screen's answer is APPLIED until
// 'connected', with the same length - so neither end can outlast the other on a call that never
// came up. Normally the screen's `bye` ends the caller first; this is for a screen whose socket died
// and whose `bye` never arrives, which left the caller page at "Answered - connecting..." with its
// camera open. A re-offer's answer re-arms it. A caller's dropped call keeps its own stall clock
// (armed once per drop, not pushed back), which still bounds the re-offers.
// Not a person's setting: nobody can judge it from a menu, and a wrong value either strands the
// room on a dead call or hangs up working ones. The constructor takes `connectMs` for the suites.
export const ANSWER_CONNECT_MS = STALL_MS;

export const MODES = ['auto', 'direct'];

// ---------------------------------------------------------------------------------------
// *** ONE SCREEN ANSWERS A FAMILY CALL *** (2026-10-02; the intercom got the same in f087bfb)
// ---------------------------------------------------------------------------------------
//
// A caller's offer reaches EVERY screen of the person. Two open screens both rang and BOTH ANSWERED:
// the caller kept the first answer, and the other screen sat "in a call" with its camera and
// microphone open, talking to nobody.
//
// Now a caller tags its offer `purpose: 'call'` and a `session`, and the server picks ONE answering
// screen (drive.py `Answerers`):
//   * EVERY SCREEN STILL RINGS. Unlike the intercom - which opens by itself, so it claims before it even
//     chimes - a call is something a person picks up, wherever they happen to be. Ringing only the
//     screen the server picked would mean picking before anybody has said where they are. So the claim
//     is made at ANSWER, not at ring. Argued the other way: two rooms hear a ring for one call. That is
//     what a house with two phones does, and it is what people expect of one.
//   * THE SCREEN THAT ANSWERS ASKS FIRST (`claim()`), before the Call panel opens the camera or the
//     microphone. That includes the panel's own countdown answering by itself (call.js
//     `declineSeconds`, 10 s by default) - which ends at the same moment on both screens, so both
//     ask at once and the server takes the first to arrive.
//   * THE OTHERS ARE TOLD NO AND STOP RINGING AT ONCE (`onEnded('elsewhere')`), and say nothing to the
//     caller. So are they when the first response is a refusal (a decline, a busy): the caller has
//     already been told no, and a ring left going on another screen would answer into nothing.
//   * A SCREEN TOLD NO WHILE IN THE CALL (its socket dropped, the server forgot it, and the re-offer
//     went elsewhere) ends it in the same task - the connection closes before the handler returns.
//
// FALLBACKS - an older page must still work:
//   * an OLDER CALLER (no purpose, no session): nothing to claim; it rings and answers as it always did,
//     and the server does not arbitrate it either;
//   * an OLDER SCREEN PAGE answering a tagged call without claiming: the server counts its answer as
//     the claim (drive.py), and only an untagged answer gets past that - see "Known gap" below;
//   * a link with no `claim` (an older drive.js): answers as before;
//   * NO REPLY to a claim within CALL_CLAIM_MS: answers anyway. *** THE INTERCOM FAILS CLOSED HERE AND A
//     CALL FAILS OPEN, ON PURPOSE. *** The intercom opens a room's microphone that nobody in the room
//     chose; a family call is a person deciding to pick up (or the countdown the person's own settings
//     chose), and call.js's header records Mike's ruling that a missed call from family costs more than
//     an unwanted one. Failing open is exactly what calls did before this change, so the worst case is
//     the old behaviour, never a call that cannot be answered. It also covers deploying the client
//     before the server: a server that does not know a call can be claimed drops the claim, and the
//     call still connects, CALL_CLAIM_MS late.
//
// Known gap: an older SCREEN page answers WITHOUT a session, which the server cannot tie to the call,
// so during a mixed deploy an old page and a new page could both answer. It ends when the old page
// reloads. Not worth server heuristics for a window that closes on the next page load.
export const CALL_PURPOSE = 'call';

// How long to wait for the server's reply to a claim before answering anyway. 3 s, argued: the reply
// is one round trip (well under 1 s on a live socket - the intercom's live suite measures it), so this
// only ever fires on a socket that is effectively gone or a server too old to know a call can be
// claimed. It is time the caller spends waiting, so shorter than the intercom's 5 s (which fails
// closed, where waiting longer costs nothing). Not a person's setting: nobody can judge it.
export const CALL_CLAIM_MS = 3000;

// The calls this screen was told belong to another screen, so a re-offer of one (the caller
// reconnecting to whoever has it) does not ring here again. Bounded; oldest go first.
const LOST_KEEP = 32;

// ---------------------------------------------------------------------------------------
// *** WORDS INTO THE CALL *** (2026-10-08, "board into call")
// ---------------------------------------------------------------------------------------
//
// Mike, 2026-10-08: "A talk-board word doesn't go into a live call through the software." The board
// spoke through the screen's speaker and the call sent only the microphone, so the far end heard a
// board word only if the room's microphone happened to pick it up - through echo cancellation, which
// is built to remove exactly the sound the screen itself is playing.
//
// THE ROUTE: the word goes as TEXT, on a data channel on the call's OWN connection (`sendWords` /
// `onWords`), and the far end shows it and speaks it with its own voice (call_page.js).
//   * Why not mix the spoken word into the outgoing audio: the board speaks with the browser's voice
//     (speechSynthesis, voice.js), and the browser gives no way to capture that as audio - no stream,
//     no buffer. Mixing needs a voice that makes audio we hold (Piper, voice.js's target, not built).
//     When it is, mixing can go beside this; the text stays, because it also shows the word when the
//     sound is bad.
//   * Why a data channel and not the drive socket: the words never touch the server at all - they go
//     the same way the call's sound goes, end to end (row 2.58, "I don't want anything from users on
//     my server"); the server needs no change and keeps no new kind of signal; and "the channel is
//     open" is the same fact as "the call is connected", so nothing can be sent to anybody who is not
//     in the call.
//   * The CALLER makes the channel (before its offer, so the offer carries it); the screen takes it
//     when the connection brings it (`ondatachannel`). An older caller page makes none, and a word on
//     the screen then simply stays in the room, as it did before.
// ONLY IN A CALL: `sendWords` refuses (returns false, sends and keeps nothing) unless a call is live.
// A word said while the call is live but the channel is not open yet (the first second of a call, a
// reconnect) waits in a short queue and goes when it opens; the queue is emptied when the call ends.
export const WORDS_LABEL = 'nimrod-words';
// The longest text one message carries. 500 characters, argued: a board card's text is a word or a
// short sentence (the longest built-in card is under 60), and a sentence somebody builds on a strip is
// still a few hundred at most. Longer is cut, not refused, so the start of it still arrives. Not a
// person's setting: nobody can judge it from a menu.
export const WORDS_MAX_CHARS = 500;
// How many words may wait for the channel to open. 20, argued: a person choosing a word a second during
// a 30 s reconnect (STALL_MS) would say more, but the oldest of those are stale by then, and the queue
// is there for the first second of a call and a short drop. Oldest go first. Not a person's setting.
export const WORDS_QUEUE_MAX = 20;

/** Clean a word for sending or showing: a string, spaces collapsed, at most WORDS_MAX_CHARS. Pure. */
export function cleanWords(text) {
  if (typeof text !== 'string' && typeof text !== 'number') return '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, WORDS_MAX_CHARS);
}

/** A message from the channel, as `{ text, source }`, or null when it is not one. Pure. */
export function parseWords(data) {
  if (typeof data !== 'string' || data.length > WORDS_MAX_CHARS * 8) return null;
  let m = null;
  try { m = JSON.parse(data); } catch { return null; }
  if (!m || typeof m !== 'object' || m.type !== 'say') return null;
  const text = cleanWords(m.text);
  if (!text) return null;
  const source = typeof m.source === 'string' ? m.source.slice(0, 32) : null;
  return { text, source };
}

/** A fresh call id: "call-" + 16 hex, inside drive.py's session rules. */
export function newCallSession(rand = null) {
  let s = '';
  if (!rand) {
    try {
      const b = new Uint8Array(8);
      globalThis.crypto.getRandomValues(b);
      for (const x of b) s += x.toString(16).padStart(2, '0');
      return `call-${s}`;
    } catch { s = ''; }
  }
  const r = rand || Math.random;
  for (let i = 0; i < 4; i++) s += Math.floor(r() * 0x10000).toString(16).padStart(4, '0');
  return `call-${s}`;
}

const okSession = (s) => typeof s === 'string' && s.length > 0;
// What a signal for this call carries: the purpose and the session when the call has one; nothing
// extra for an older caller's untagged call, so it looks exactly as it always did.
const tagged = (session) => (session ? { purpose: CALL_PURPOSE, session } : {});

/**
 * The ICE server list a call should use.
 *
 * `direct` is the zero-cloud mode: no STUN, no TURN, host candidates only — which is what
 * the Tailscale path has always been. It is a supported option rather than a fallback, and
 * `DECISIONS.md` names it as "max privacy": nothing about the call, not even a STUN lookup,
 * touches anybody else's server.
 */
export function iceServers({ mode = 'auto', stun = DEFAULT_STUN, turn = [] } = {}) {
  if (mode === 'direct') return [];
  return [...(stun || []), ...(turn || [])];
}

/** Whether a relay is available at all — the thing to check before promising a call works. */
export const hasRelay = (cfg = {}) => (cfg.turn || []).length > 0;

/**
 * Wait for ICE gathering, or for the timeout, whichever comes first.
 *
 * Exported because "we sent the description before we had the candidates" and "the network
 * never finished gathering" are different failures and a test should be able to tell them
 * apart without a real network.
 */
export function gatheringDone(pc, { timeoutMs = GATHER_TIMEOUT_MS, setTimer = setTimeout } = {}) {
  return new Promise((resolve) => {
    if (!pc || pc.iceGatheringState === 'complete') { resolve('complete'); return; }
    let done = false;
    const fin = (why) => { if (!done) { done = true; resolve(why); } }
    pc.addEventListener?.('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') fin('complete');
    });
    setTimer(() => fin('timeout'), timeoutMs);
  });
}

/**
 * *** PUBLISHED BY THE SCREEN WHEN A TRANSPORT CAN EXIST. *** (2026-09-30.) The kiosk builds its one
 * transport lazily from the drive socket, and the socket only opens once the background person
 * lookup finishes -- usually AFTER the panels have mounted. A call panel that looked once, at mount,
 * found nothing and never looked again: it could not ring. The kiosk publishes this the moment the
 * socket is attached, and `modules/call.js` binds to `ctx.callTransport` when it hears it.
 */
export const CALL_TRANSPORT_READY = 'call/transport-ready';

/**
 * The transport.
 *
 * Implements exactly what `modules/call.js` asks for — `onIncoming`, `answer`, `hangup`,
 * `onEnded`, `destroy` — plus `call()` for the other end, which the module does not use
 * because a bedside screen never places a call.
 *
 * `link` is a connected drive socket (`connectDrive`); this file does not open one, because
 * the kiosk already has one and a second socket for the same pair of devices would be a
 * second thing to authenticate, reconnect and debug.
 */
export function createCallTransport({
  link,
  role = 'screen',                    // 'screen' answers; 'driver' places
  config = {},                        // { mode, stun, turn }
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  Stream = (typeof MediaStream !== 'undefined' ? MediaStream : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onLog = null,
  // A NEW call is refused as busy while this says so (the screen's choice: an intercom is open and the
  // person's row says "a call during an intercom: busy" - see kiosk.js). The caller gets a `bye` with
  // reason 'busy' rather than ringing into nothing. A reconnect of a LIVE call is never refused, and a
  // check that throws is NOT busy - failing toward a family call ringing, not toward it vanishing.
  busy = () => false,
  claimMs = CALL_CLAIM_MS,
  connectMs = ANSWER_CONNECT_MS,
} = {}) {
  if (!link) throw new Error('createCallTransport: a drive link is required');

  let pc = null;
  let remoteStream = null;
  let pendingOffer = null;            // an offer that arrived before anybody answered
  let pendingSession = null;          // ...and which call it is (null: an older caller's, untagged)
  let currentSession = null;          // the call being answered or in progress (a caller: the one it placed)
  let answering = false;              // between "this screen won" and the answer going out
  let wonSession = null;              // the server named THIS screen for it
  const claims = new Map();           // session -> a claim waiting for the server's reply
  const lost = [];                    // sessions the server gave to another screen (LOST_KEEP)
  let incomingCb = null;
  let endedCb = null;
  let stallTimer = null;
  let connectTimer = null;            // ANSWER_CONNECT_MS: answered until 'connected' (screen: from its answer; caller: from applying it)
  let everConnected = false;          // this call reached 'connected' at least once
  let destroyed = false;
  let attached = null;                // the <video> the module handed us
  let live = false;
  // THE CALLER'S HALF (2026-10-02, the caller page `call_page.js`). What a driver re-offers with when its
  // connection drops (the same tracks and name, the same session), and who hears its call being answered
  // and its connection changing. Sets, like `liveCbs`: the page and a test may both listen.
  let placed = null;                  // { tracks, from } of the call this driver placed
  let answeredOnce = false;           // this driver's call has been answered at least once
  const answeredCbs = new Set();
  const connCbs = new Set();
  const emit = (set, ...a) => { for (const cb of [...set]) { try { cb(...a); } catch (e) { log('listener threw', e); } } };
  // Who hears `live` change (the screen: voice recording holds for a call, an open intercom ends when
  // one goes live). A SET, unlike onIncoming/onEnded: those belong to the one call panel; these belong
  // to the screen, and more than one part of it listens.
  const liveCbs = new Set();
  // *** WHO HEARS A RING THAT NO CALL PANEL HEARS (2026-10-02, call_notice.js). *** `onIncoming` / `onEnded`
  // are ONE slot each, and belong to the Call panel. A screen with no Call panel on it heard nothing at all:
  // the offer sat here and the caller got "No answer" after 135 s. These are a Set, like `liveCbs`, and
  // they belong to the screen: `{ type: 'ring', from, session, panel }` when a new call starts ringing
  // (`panel`: a Call panel is listening and rings for it, so the screen must not ring twice), and
  // `{ type: 'end', reason, why, local }` when a ring, an answer or a live call ends, for any reason.
  const ringCbs = new Set();
  // Words into the call (WORDS_LABEL above): the channel, what waits for it to open, who hears a word.
  let words = null;
  const wordsQueue = [];
  const wordsCbs = new Set();

  const log = (...a) => { try { onLog?.(...a); } catch { /* a logger must not break a call */ } };

  // The words channel: one per connection. A replaced connection's channel says nothing more.
  function wireWords(ch) {
    if (!ch || ch.label !== WORDS_LABEL) return;
    if (words && words !== ch) { try { words.close(); } catch { /* gone */ } }
    words = ch;
    ch.onopen = () => { if (words === ch) flushWords(); };
    ch.onmessage = (e) => {
      if (words !== ch || destroyed) return;
      const w = parseWords(e?.data);
      if (w) emit(wordsCbs, w);
    };
    ch.onclose = () => { if (words === ch) words = null; };
    if (ch.readyState === 'open') flushWords();
  }
  function flushWords() {
    const ch = words;
    if (!ch || ch.readyState !== 'open') return;
    while (wordsQueue.length) {
      try { ch.send(JSON.stringify(wordsQueue[0])); } catch (e) { log('words: send failed', e); return; }
      wordsQueue.shift();
    }
  }
  function closeWords() {
    const ch = words;
    words = null;
    if (ch) { try { ch.close(); } catch { /* gone */ } }
  }
  function setLive(on) {
    if (live === on) return;
    live = on;
    for (const cb of [...liveCbs]) { try { cb(on); } catch (e) { log('onLive threw', e); } }
  }
  const ice = () => iceServers(config);

  function clearStall() { if (stallTimer != null) { clearTimer(stallTimer); stallTimer = null; } }
  function armStall() {
    clearStall();
    // A caller that vanished without a `bye` must not leave her looking at a dead call.
    stallTimer = setTimer(() => { stallTimer = null; if (live) finish('stalled'); }, STALL_MS);
  }

  // The connect clock (ANSWER_CONNECT_MS). Armed when the screen starts answering, and again by a
  // re-offer; on a caller, when an answer is applied. Cleared by 'connected' and by any ending.
  function clearConnect() { if (connectTimer != null) { clearTimer(connectTimer); connectTimer = null; } }
  function armConnect() {
    clearConnect();
    connectTimer = setTimer(() => { connectTimer = null; if (live || answering) noConnect(); }, connectMs);
  }
  function noConnect() {
    const had = everConnected;
    log(had ? 'the re-answer never connected' : 'the answer never connected');
    // The caller FIRST, then the teardown: `finish` forgets which call this was.
    try { link.sendSignal({ kind: 'bye', reason: had ? 'connection-lost' : 'failed', ...tagged(currentSession) }); }
    catch { /* socket gone */ }
    // 'unconnected': never connected (the panel says "could not connect"); 'stalled': it had, and the
    // reconnect did not (the panel says "the connection was lost", as for any other drop).
    finish(had ? 'stalled' : 'unconnected');
  }

  function closePc() {
    closeWords();
    if (!pc) return;
    try { pc.close(); } catch { /* already closed */ }
    pc = null;
  }

  // `local`: this end chose it (hangup). The panel already knows, so only a LIVE call is reported, as
  // before. Otherwise a RING or an ANSWER IN PROGRESS that ends is reported too (2026-10-02): the caller
  // giving up, another screen taking the call, an answer that failed. Before, only a live call was, so a
  // panel kept counting down a ring whose caller had gone, and "answered" it.
  //
  // `why` (2026-10-02): the far end's own reason when it hung up - a `bye`'s `reason` ('declined', 'busy',
  // 'unanswered', 'hangup'...). Handed to `onEnded` as a second argument, `{ why }`, so a CALLER can say
  // "on another call" rather than just "ended". The Call panel reads only the first argument, as before.
  function finish(reason, { local = false, why = null } = {}) {
    clearStall();
    clearConnect();
    everConnected = false;
    closePc();
    remoteStream = null;
    if (attached) { try { attached.srcObject = null; } catch { /* gone */ } attached = null; }
    const was = live;
    const wasRinging = pendingOffer != null;
    const wasAnswering = answering;
    setLive(false);
    pendingOffer = null;
    pendingSession = null;
    currentSession = null;
    answering = false;
    wonSession = null;
    placed = null;
    answeredOnce = false;
    wordsQueue.length = 0;              // words said for this call go with it
    if (was || (!local && (wasRinging || wasAnswering))) {
      try { endedCb?.(reason, { why }); } catch (e) { log('onEnded threw', e); }
    }
    // The screen's watchers hear EVERY ending of something that was here, this end's own included: a
    // notice that rang for it needs to know it is over however it ended.
    if (was || wasRinging || wasAnswering) emit(ringCbs, { type: 'end', reason, why, local });
  }

  const isLost = (session) => !!session && lost.includes(session);
  function rememberLost(session) {
    if (!session || lost.includes(session)) return;
    lost.push(session);
    while (lost.length > LOST_KEEP) lost.shift();
  }

  // Ask the server whether THIS screen answers `session` (drive.py Answerers). Resolves true on its
  // "yes"; false on its "no". FAILS OPEN - true - when there is nothing to ask (an older caller's untagged
  // call, a link with no `claim`, a socket that cannot send) or no reply comes within `claimMs`: see
  // CALL_CLAIM_MS for why a call, unlike the intercom, answers anyway. One question in flight per call.
  function ask(session) {
    if (!session) return Promise.resolve(true);
    if (wonSession === session) return Promise.resolve(true);
    if (isLost(session)) return Promise.resolve(false);
    const have = claims.get(session);
    if (have) return have.promise;
    if (typeof link.claim !== 'function') return Promise.resolve(true);
    let done;
    const entry = { promise: new Promise((r) => { done = r; }), timer: null };
    entry.settle = (won) => {
      if (claims.get(session) !== entry) return;
      claims.delete(session);
      if (entry.timer != null) { try { clearTimer(entry.timer); } catch { /* gone */ } entry.timer = null; }
      if (won === true) wonSession = session;
      done(won === true);
    };
    claims.set(session, entry);
    entry.timer = setTimer(() => { entry.timer = null; log('no reply to the claim: answering anyway'); entry.settle(true); }, claimMs);
    let asked = false;
    try { asked = link.claim({ purpose: CALL_PURPOSE, session }) === true; } catch { asked = false; }
    if (!asked) entry.settle(true);
    return entry.promise;
  }

  // THE SERVER'S PICK (drive.js hands it on as a signal of kind 'answerer'; only a screen hears it).
  function onAnswerer(sig) {
    if (role !== 'screen' || sig.purpose !== CALL_PURPOSE || !okSession(sig.session)) return;
    const session = sig.session;
    if (sig.you === true) { claims.get(session)?.settle(true); return; }
    rememberLost(session);
    // In the call, answering it, or ringing for it: it stops NOW, in this task, and the caller is told
    // nothing - another screen has it (or has already refused it).
    if (currentSession === session || (pendingOffer != null && pendingSession === session)) finish('elsewhere');
    claims.get(session)?.settle(false);
  }

  function makePc(tracks) {
    closePc();                                   // never leak a prior connection
    pc = new PeerConnection({ iceServers: ice() });
    // *** TRACKS GO UNDER A MediaStream, AND THAT IS NOT COSMETIC. *** A bare
    // `addTrack(t)` sends with no stream association (an empty a=msid), so a peer that
    // renders `e.streams[0]` gets `undefined` and shows BLACK while frames arrive
    // perfectly. The private build hit this and says so; it is the kind of bug that looks
    // like a camera problem for an hour.
    const out = Stream ? new Stream() : null;
    for (const t of tracks || []) {
      try { if (out) { out.addTrack(t); pc.addTrack(t, out); } else pc.addTrack(t); }
      catch (e) { log('addTrack failed', e); }
    }
    pc.ontrack = (e) => {
      // Accept peers that send WITH a stream and peers that send bare tracks.
      if (!remoteStream) remoteStream = (e.streams && e.streams[0]) || (Stream ? new Stream() : null);
      if (e.track && remoteStream && !remoteStream.getTracks().includes(e.track)) {
        try { remoteStream.addTrack(e.track); } catch { /* already there */ }
      }
      if (attached && remoteStream) { try { attached.srcObject = remoteStream; } catch { /* gone */ } }
      log('remote track', e.track && e.track.kind);
    };
    const mine = pc;
    // WORDS INTO THE CALL (WORDS_LABEL): the caller makes the channel before its offer, so the offer
    // carries it; the screen takes it when it arrives. A connection without data channels (a test's
    // fake, a browser without them) simply has none, and a word stays in the room.
    if (role === 'driver' && typeof pc.createDataChannel === 'function') {
      try { wireWords(pc.createDataChannel(WORDS_LABEL, { ordered: true })); } catch (e) { log('words: no channel', e); }
    }
    pc.ondatachannel = (e) => { if (pc === mine) wireWords(e?.channel); };
    pc.onconnectionstatechange = () => {
      if (pc !== mine) return;                   // a replaced connection says nothing
      const st = pc?.connectionState;
      log('conn', st);
      emit(connCbs, st);
      if (st === 'connected') { clearStall(); clearConnect(); everConnected = true; }
      // A drop is NOT the end. The caller re-offers on its own, so the panel stays up and
      // waits — with a stall timer, so a caller gone for good still releases the screen.
      else if (st === 'failed') trouble();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc === mine && pc?.iceConnectionState === 'failed') trouble();
    };
    return pc;
  }

  // A connection that failed. The SCREEN waits for the caller's re-offer (the stall clock, as before).
  // THE CALLER is the one that re-offers (2026-10-02): once per drop, on the same session, with the same
  // tracks - and the stall clock is armed ONCE for that drop and not pushed back by a re-offer that fails
  // too, or a caller on a network that cannot connect would retry for ever. A call that was never answered
  // has nothing to re-offer to: the caller page's own give-up time covers that.
  function trouble() {
    // A screen still on its connect clock is already bounded by it (ANSWER_CONNECT_MS).
    if (role !== 'driver') { if (connectTimer == null) armStall(); return; }
    if (stallTimer != null) return;
    armStall();
    if (answeredOnce) reoffer().catch((e) => log('re-offer failed', e));
  }

  // Offer the SAME call again (same session, same tracks, same name): the screen in it re-answers.
  async function reoffer() {
    if (destroyed || role !== 'driver' || !live || !currentSession || !placed) return false;
    remoteStream = null;
    return place({ ...placed, session: currentSession, again: true });
  }

  async function place({ tracks = [], from = null, session = null, remoteVideo, again = false } = {}) {
    const s = okSession(session) ? session : newCallSession();
    if (remoteVideo !== undefined) attached = remoteVideo || null;
    const mine = makePc(tracks);
    currentSession = s;
    placed = { tracks: [...(tracks || [])], from };
    if (!again) answeredOnce = false;
    const o = await mine.createOffer();
    await mine.setLocalDescription(o);
    setLive(true);
    await gatheringDone(mine, { setTimer });
    if (destroyed || pc !== mine) return false;
    return link.sendSignal({ kind: 'offer', sdp: mine.localDescription?.sdp, from, ...tagged(s) });
  }

  // ---- inbound -------------------------------------------------------------------------
  function onSignal(sig) {
    if (destroyed || !sig) return;
    if (sig.kind === 'answerer') { onAnswerer(sig); return; }
    if (!SIGNAL_KINDS.includes(sig.kind)) return;
    // *** A SIGNAL WITH ANOTHER PURPOSE IS NOT A CALL. *** (Row 2.42.) The same socket now also
    // carries a phone joining as a microphone (`phone_mic.js`, `purpose: 'phone-mic'`). Its offer
    // must never RING this screen, and its `bye` must never hang up a call that is running. A
    // signal with no purpose is a call, exactly as before; a named purpose other than 'call' is
    // somebody else's.
    if (sig.purpose != null && sig.purpose !== CALL_PURPOSE) return;
    const session = okSession(sig.session) ? sig.session : null;
    if (sig.kind === 'bye') {
      // A hang-up that names ANOTHER call is not this one's (the server relays a screen's signals to
      // every caller of the person - a busy refusal for a second caller must not end the first call).
      // An untagged one ends whatever is here, as it always did.
      if (session && session !== currentSession && session !== pendingSession) return;
      log('peer hung up');
      finish('remote', { why: typeof sig.reason === 'string' ? sig.reason : null });
      return;
    }
    if (role === 'screen' && sig.kind === 'offer') {
      // A call the server already gave to another screen (the caller reconnecting to it): not ours.
      if (isLost(session)) { log('a re-offer of a call another screen has'); return; }
      if (live) {
        if (!session || session === currentSession) {
          // The stall clock gives way to the connect clock: the re-answer is a new connection that has
          // to connect too, and is bounded from the moment the re-offer arrives (the claim included).
          clearStall();
          armConnect();
          // An offer while a call is LIVE is a reconnect: the caller rebuilt and re-offered.
          // Answer it with the media we already hold rather than treating it as a new call,
          // or a blip would ring at her a second time.
          const tracks = currentTracks();
          if (!session) { answerWith(sig.sdp, tracks, null).catch((e) => log('re-answer failed', e)); return; }
          // A tagged one asks the server again first: if this screen's socket dropped, the server
          // forgot it answered, and the re-offer may already belong to another screen.
          wonSession = null;
          const sdp = sig.sdp;
          ask(session).then((won) => {
            if (destroyed || !live || currentSession !== session) return null;
            if (!won) { finish('elsewhere'); return null; }
            return answerWith(sdp, tracks, session);
          }).catch((e) => log('re-answer failed', e));
          return;
        }
        // A DIFFERENT call while one is live is not a reconnect - taking it as one would swap the
        // person mid-call to whoever rang second. It is refused as busy, naming the call it refuses.
        log('busy: a second call while one is live');
        try { link.sendSignal({ kind: 'bye', reason: 'busy', ...tagged(session) }); } catch { /* socket gone */ }
        return;
      }
      clearStall();
      let refuse = false;
      try { refuse = !!busy(); } catch (e) { log('busy check threw', e); refuse = false; }
      if (refuse) {
        log('busy: refused a new call');
        pendingOffer = null;
        pendingSession = null;
        try { link.sendSignal({ kind: 'bye', reason: 'busy', ...tagged(session) }); } catch { /* socket gone */ }
        return;
      }
      pendingOffer = sig.sdp;
      pendingSession = session;
      // Read BEFORE the panel is told: whether a Call panel rings for this one (see `ringCbs`).
      const panel = typeof incomingCb === 'function';
      try { incomingCb?.(sig.from || null); } catch (e) { log('onIncoming threw', e); }
      emit(ringCbs, { type: 'ring', from: sig.from || null, session, panel });
      return;
    }
    if (role === 'driver' && sig.kind === 'answer') {
      // An answer for ANOTHER caller's call is not this one's.
      if (session && session !== currentSession) return;
      const mine = pc;
      if (!mine) return;
      // ANSWERED is reported once the answer is applied - not before, so a caller never says "answered"
      // for an answer its connection refused. A re-answer (after a re-offer) reports again; harmless.
      mine.setRemoteDescription({ type: 'answer', sdp: sig.sdp })
        .then(() => {
          if (destroyed || pc !== mine) return;
          answeredOnce = true;
          // THE CALLER'S CONNECT CLOCK (2026-10-04): answered, and now it has to connect. If the screen's
          // socket died and its own bye never comes, this is what ends the call (ANSWER_CONNECT_MS).
          if (mine.connectionState !== 'connected') armConnect();
          emit(answeredCbs, { session: currentSession, by: typeof sig.by === 'string' ? sig.by : null });
        })
        .catch((e) => log('setRemoteDescription(answer) failed', e));
    }
  }

  function currentTracks() {
    if (!pc) return [];
    return pc.getSenders?.().map((s) => s.track).filter(Boolean) || [];
  }

  async function answerWith(sdp, tracks, session) {
    const mine = makePc(tracks);
    // THE CONNECT CLOCK STARTS AT THE ANSWER (ANSWER_CONNECT_MS) and runs until 'connected' - through
    // the gathering, so an answer that hangs half-made is bounded too.
    armConnect();
    // Anything that replaces or closes this connection while the answer is being made (the call ended,
    // another screen was named) stops it here: nothing is sent and nothing goes live for a dead one.
    const still = () => { if (destroyed || pc !== mine) throw new Error('call: superseded while answering'); };
    await mine.setRemoteDescription({ type: 'offer', sdp });
    still();
    const a = await mine.createAnswer();
    still();
    await mine.setLocalDescription(a);
    await gatheringDone(mine, { setTimer });
    still();
    link.sendSignal({ kind: 'answer', sdp: mine.localDescription?.sdp, ...tagged(session) });
    currentSession = session;
    setLive(true);
    log('answer sent');
  }

  const off = link.onSignal ? link.onSignal(onSignal) : null;

  return {
    // What `modules/call.js` calls, and nothing else is part of the contract.
    // Each returns a way to let go that only lets go of ITS OWN callback. The transport belongs to
    // the screen and outlives any one call panel; a panel that leaves must not deafen the one that
    // replaced it (a swap may mount the new screen before destroying the old). 2026-09-30.
    onIncoming(cb) { incomingCb = cb; return () => { if (incomingCb === cb) incomingCb = null; }; },
    onEnded(cb) { endedCb = cb; return () => { if (endedCb === cb) endedCb = null; }; },

    /**
     * Answer the offer that is waiting. `outgoing` is the camera track the module already
     * acquired — the transport never touches the camera itself, because `camera_owner.js`
     * arbitrates that and a second opener is how two panels fight over one device.
     */
    /**
     * Ask the server whether THIS screen answers the call that is ringing (see CALL_PURPOSE above).
     * The Call panel calls it BEFORE it opens the camera or the microphone. Resolves true when this
     * screen is the one - or there is nothing to ask, or no reply came (it fails open, argued at
     * CALL_CLAIM_MS); false when another screen has the call, or the ring went away meanwhile. On a
     * false the ring has already been ended here (`onEnded('elsewhere')`) and the caller told nothing.
     */
    claim() {
      if (destroyed || role !== 'screen' || pendingOffer == null) return Promise.resolve(false);
      const sdp = pendingOffer, session = pendingSession;
      return ask(session).then((won) => {
        const same = pendingOffer === sdp && pendingSession === session;
        if (!won && same) finish('elsewhere');
        return won && same;
      });
    },

    async answer({ from = null, outgoing = null, remoteVideo = null, audio = null } = {}) {
      if (destroyed) return false;
      if (!pendingOffer) { log('answer with no offer waiting'); return false; }
      const sdp = pendingOffer, session = pendingSession;
      // ONE SCREEN ANSWERS. Nothing has been built yet; if the panel already claimed, this is instant.
      const won = await ask(session);
      if (destroyed || pendingOffer !== sdp || pendingSession !== session) return false;   // withdrawn meanwhile
      if (!won) { finish('elsewhere'); return false; }
      attached = remoteVideo || null;
      const tracks = [outgoing, ...(audio ? [audio] : [])].filter(Boolean);
      pendingOffer = null;
      pendingSession = null;
      currentSession = session;
      answering = true;
      try { await answerWith(sdp, tracks, session); answering = false; return true; }
      catch (e) { log('answer failed', e); finish('failed'); return false; }
    },

    /**
     * Place a call. Used by the caller page (`call.html`, `call_page.js`), never by the bedside module —
     * a screen never calls anybody. It is TAGGED
     * (`purpose: 'call'`, a session) so the server can pick one answering screen; `session` reuses an
     * id (a caller re-offering the same call), otherwise a fresh one is made.
     */
    async call({ tracks = [], from = null, session = null, remoteVideo } = {}) {
      if (destroyed || role !== 'driver') return false;
      // `remoteVideo`: the element the far end plays into (the caller page's <video>). Optional.
      return place({ tracks, from, session, remoteVideo });
    },

    // ---- the caller's half (2026-10-02; `call_page.js`) ------------------------------------------------
    /** `cb({ session, by })` when THIS driver's call is answered (the answer applied). Returns an unsubscribe. */
    onAnswered(cb) { if (typeof cb !== 'function') return () => {}; answeredCbs.add(cb); return () => { answeredCbs.delete(cb); }; },
    /** `cb(state)` on the peer connection's own state: 'connecting' | 'connected' | 'disconnected' | 'failed'... */
    onConnection(cb) { if (typeof cb !== 'function') return () => {}; connCbs.add(cb); return () => { connCbs.delete(cb); }; },
    /** A caller offers its call again (same session); also done by itself once per dropped connection. */
    reconnect: () => reoffer(),
    /**
     * Swap the track being SENT of one kind (a phone switching between its cameras), without a new offer:
     * the far end keeps the same picture slot. Resolves true when it was swapped.
     */
    async replaceTrack(kind, track) {
      if (destroyed || !pc || !track) return false;
      const sender = (pc.getSenders?.() || []).find((s) => s.track && s.track.kind === kind);
      if (!sender || typeof sender.replaceTrack !== 'function') return false;
      try { await sender.replaceTrack(track); } catch (e) { log('replaceTrack failed', e); return false; }
      if (placed) placed.tracks = placed.tracks.map((t) => (t && t.kind === kind ? track : t));
      return true;
    },

    hangup(reason = 'hangup') {
      // Tell the other end BEFORE tearing down, or they sit watching a frozen frame until
      // their own stall timer fires — thirty seconds of looking at somebody who has gone.
      // ONLY WHEN THERE IS A CALL HERE TO END (2026-10-02): a screen whose ring was taken by another
      // screen, or whose caller already hung up, has nothing to say - and a bye from it would reach the
      // caller as a refusal of a call another screen is in.
      const has = live || answering || pendingOffer != null || !!pc;
      const session = currentSession || pendingSession;
      if (has) { try { link.sendSignal({ kind: 'bye', reason, ...tagged(session) }); } catch { /* socket already gone */ } }
      finish(reason, { local: true });
    },

    // Is a call ANSWERED and running? What the room's intercom asks before it opens (intercom.js
    // `busy`): a live call is never talked over. A call only RINGING is not counted - an offer
    // whose caller gave up without a `bye` is never cleared, and would block the intercom for good.
    isLive: () => live,
    /** `cb(true)` when a call goes live, `cb(false)` when it ends (not on ringing, not on a reconnect). */
    onLive(cb) { if (typeof cb !== 'function') return () => {}; liveCbs.add(cb); return () => { liveCbs.delete(cb); }; },
    /** The screen's own view of its rings (see `ringCbs`): `cb({ type: 'ring' | 'end', ... })`. Returns an unsubscribe. */
    onRing(cb) { if (typeof cb !== 'function') return () => {}; ringCbs.add(cb); return () => { ringCbs.delete(cb); }; },

    /**
     * WORDS INTO THE CALL (WORDS_LABEL, "board into call"). Send `text` to the other end of the call
     * that is live now. Returns false - and sends and keeps nothing - when no call is live; true when
     * it was sent, or waits for the channel to open (the first second of a call, a reconnect).
     */
    sendWords(text, { source = null } = {}) {
      if (destroyed || !live) return false;
      const t = cleanWords(text);
      if (!t) return false;
      wordsQueue.push({ type: 'say', text: t, ...(typeof source === 'string' && source ? { source: source.slice(0, 32) } : {}) });
      while (wordsQueue.length > WORDS_QUEUE_MAX) wordsQueue.shift();
      flushWords();
      return true;
    },
    /** `cb({ text, source })` for each word the other end of the call sent. Returns an unsubscribe. */
    onWords(cb) { if (typeof cb !== 'function') return () => {}; wordsCbs.add(cb); return () => { wordsCbs.delete(cb); }; },

    // For the panel and for tests. `live` is the honest one: a peer connection can exist
    // and be connecting, which is not the same as a call.
    __probe: () => ({ live, hasPc: !!pc, pendingOffer: !!pendingOffer,
                      ice: ice(), relay: hasRelay(config), stalling: stallTimer != null,
                      connecting: connectTimer != null,
                      session: currentSession || pendingSession, claiming: claims.size > 0,
                      answered: answeredOnce,
                      words: words ? (words.readyState || 'unknown') : null, wordsWaiting: wordsQueue.length }),

    destroy() {
      destroyed = true;
      try { off?.(); } catch { /* already gone */ }
      for (const c of [...claims.values()]) c.settle(false);
      finish('destroyed');
    },
  };
}
