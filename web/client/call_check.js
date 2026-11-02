// call_check.js - "CHECK IT WORKS": a test connection to one screen, before anybody needs a call (row 2.167; Mike,
// 2026-11-02, on the call setup proposal: (a) to (e) "yes"; docs/for_chat/proposal_call_setup_20261031.md, "Check it
// works, the design").
//
// A call that cannot connect says so only when somebody is trying to call. This says it at setup time: press "Check the
// connection" and the page makes a connection to the screen with NOTHING in it - no camera, no microphone, a data channel
// only - and says how it got there:
//   'direct'    "Connects directly"                         (the two found each other, home Wi-Fi or the internet)
//   'private'   "Connects through your private network"    (the pair's addresses are a private network's: Tailscale's
//                                                             100.64.0.0/10, or its fd7a:115c:a1e0::/48)
//   'relay'     "Connects through a relay"                  (somebody's own relay, the one way a relay is ever used)
//   'failed'    "Can't reach the screen", with "what each end offered" under it (call_page.js iceWords)
//   'not-on'    "The screen isn't on" (the server found no such screen online)
//   'refused'   "This screen did not allow a check from this account"
//   'no-answer' "The screen did not answer" (an older screen that does not know this check)
//
// THE SCREEN ANSWERS BY ITSELF, AND SHOWS NOTHING - ARGUED. A check opens no camera and no microphone and plays nothing:
// there is nothing in it for the room to see or hear, so a notice would announce nothing and teach the room to ignore
// notices. What it DOES reveal is the screen's network addresses (what any connection reveals), without anybody in the
// room answering - which a ringing call never does. So it is NOT open to everybody who may call: only to somebody who may
// already drive the screen (the owner, the guardian set, a "may drive" grant) - the people who could open far more than
// this. The server refuses anybody else's check before it reaches a screen (app.py), and the screen checks the
// server's stamp again. Rule 1 of checkin.js holds here too, by code: the screen refuses an offer with any audio or video
// in it (`checkOfferOk`), and its half has no ontrack, no camera, no microphone.
//
// IT ALWAYS ENDS BY ITSELF: the page stops once it has its answer; the screen closes its half after CHECK_HOLD_MS
// whatever happens; the page gives up after CHECK_WAIT_MS.

import { iceServers, gatheringDone, newCallSession, summarizeIce } from './call_transport.js';

export const CHECK_PURPOSE = 'check';
// How long the page waits for the screen to answer and connect. 20 s, argued: an answer is one message each way plus
// ICE (a few seconds at most on a working network); a network that has not connected in 20 s will not connect, and a
// person is watching the page meanwhile. Not a setting: nobody can judge it in advance, and it only decides how soon
// "can't reach" is said.
export const CHECK_WAIT_MS = 20000;
// How long the screen keeps its half open, at most. The page's wait and a little more, so the screen never closes
// before the page could have its answer; never longer, so nothing lingers.
export const CHECK_HOLD_MS = CHECK_WAIT_MS + 5000;
// How many checks a screen answers at once. Two, argued: a person checking from a phone and a computer together is
// real; more than that at once is not somebody setting up calls.
export const CHECK_MAX_AT_ONCE = 2;

export const CHECK_WORDS = Object.freeze({
  checking: 'Checking the connection…',
  direct: 'Connects directly. Calls to this screen should work from here.',
  private: 'Connects through your private network. Calls to this screen should work from here.',
  relay: 'Connects through a relay. Calls to this screen should work from here.',
  failed: 'Can’t reach the screen from here. A private network between your devices fixes this.',
  'not-on': 'The screen isn’t on, or isn’t connected, so it could not be checked.',
  refused: 'This screen does not allow a check from this account (only people who may control it can).',
  'no-answer': 'The screen did not answer. It may need updating: restart it and try again.',
});

/** The screen's check on a check offer. PURE. Only data-channel ("application") sections, at least one: anything with
 *  audio or video in it is refused, so a check can never become a way to open the room's camera or microphone. */
export function checkOfferOk(sdp) {
  const sections = String(sdp || '').split(/\r?\n(?=m=)/).filter((p) => /^m=/.test(p));
  if (!sections.length) return false;
  return sections.every((sec) => /^m=application\b/.test(sec));
}

// Tailscale's address ranges (its IPv4 CGNAT block and its IPv6 ULA): a pair on them went through the private network.
const inTailnet4 = (ip) => {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  return !!m && Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
};
const inTailnet6 = (ip) => /^fd7a:115c:a1e0:/i.test(ip);

/**
 * HOW THE CONNECTION WAS MADE, from the peer connection's stats. PURE. The pair the transport chose (its
 * `selectedCandidatePairId`), else the nominated succeeded pair, and that pair's two candidates. Null when no pair worked.
 */
export function pairKind(stats) {
  const all = [...(stats || [])].filter((s) => s && typeof s === 'object');
  const byId = new Map(all.map((s) => [s.id, s]));
  const transport = all.find((s) => s.type === 'transport' && s.selectedCandidatePairId);
  let pair = transport ? byId.get(transport.selectedCandidatePairId) : null;
  if (!pair) pair = all.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated)
    || all.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded') || null;
  if (!pair) return null;
  const local = byId.get(pair.localCandidateId) || {};
  const remote = byId.get(pair.remoteCandidateId) || {};
  const addr = (c) => String(c.address || c.ip || '');
  if (local.candidateType === 'relay' || remote.candidateType === 'relay') return 'relay';
  if ([addr(local), addr(remote)].some((a) => inTailnet4(a) || inTailnet6(a))) return 'private';
  return 'direct';
}

// =========================================================================================
// THE PAGE'S HALF
// =========================================================================================

/**
 * One check, to one screen (`toScreen`, its device id; the server routes the offer to that device alone).
 * `run()` resolves { outcome, offered } - `offered` is summarizeIce's, for the words under "Can't reach".
 */
export function createConnectionCheck({
  link,
  toScreen,
  config = {},
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  waitMs = CHECK_WAIT_MS,
  session = newCallSession(),
} = {}) {
  if (!link) throw new Error('createConnectionCheck: a drive link is required');
  let pc = null;
  let off = null;
  let timer = null;
  let finish = null;
  let answered = false;
  const done = new Promise((r) => { finish = r; });
  let settled = false;

  async function offeredNow() {
    try { return summarizeIce(pc ? [...(await pc.getStats()).values()] : []); } catch { return null; }
  }
  async function settle(outcome, { offered = null, tell = true } = {}) {
    if (settled) return;
    settled = true;
    if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; }
    if (tell) { try { link.sendSignal({ kind: 'bye', purpose: CHECK_PURPOSE, session, reason: 'checked' }); } catch { /* gone */ } }
    try { off?.(); } catch { /* gone */ }
    try { pc?.close(); } catch { /* closed */ }
    pc = null;
    finish({ outcome, offered });
  }

  async function run() {
    if (!PeerConnection) { settle('failed', { tell: false }); return done; }
    pc = new PeerConnection({ iceServers: iceServers(config) });
    const mine = pc;
    // A DATA CHANNEL AND NOTHING ELSE: no getUserMedia anywhere in this file.
    const dc = pc.createDataChannel('check');
    dc.onopen = async () => {
      if (pc !== mine) return;
      let kind = null;
      try { kind = pairKind([...(await pc.getStats()).values()]); } catch { kind = null; }
      settle(kind || 'direct');
    };
    pc.onconnectionstatechange = async () => {
      if (pc !== mine || pc.connectionState !== 'failed') return;
      settle('failed', { offered: await offeredNow() });
    };
    off = link.onSignal ? link.onSignal((sig) => {
      if (!sig || sig.purpose !== CHECK_PURPOSE || sig.session !== session) return;
      if (sig.kind === 'answer' && !answered && pc === mine) {
        answered = true;
        pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp }).catch(() => settle('failed'));
      } else if (sig.kind === 'bye') {
        const r = sig.reason;
        settle(r === 'not-here' ? 'not-on' : r === 'not-allowed' ? 'refused' : 'failed', { tell: false });
      }
    }) : null;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gatheringDone(pc, { setTimer });
    } catch { settle('failed', { tell: false }); return done; }
    if (settled) return done;
    // A socket that is not open refuses the signal (drive.js returns false): said at once, not after the wait.
    let sent = false;
    try {
      sent = link.sendSignal({ kind: 'offer', purpose: CHECK_PURPOSE, session, sdp: pc.localDescription?.sdp,
        ...(toScreen ? { toScreen } : {}) }) !== false;
    } catch { sent = false; }
    if (!sent) { settle('failed', { tell: false }); return done; }
    timer = setTimer(async () => {
      timer = null;
      settle(answered ? 'failed' : 'no-answer', { offered: answered ? await offeredNow() : null });
    }, waitMs);
    return done;
  }

  return { session, run, stop: () => settle('failed', { tell: true }), result: () => done };
}

// =========================================================================================
// THE SCREEN'S HALF
// =========================================================================================

/**
 * Answers checks, silently. Only somebody who may DRIVE this screen is answered (see the header); the server's stamp
 * (`by`, `byDrive`) decides, never the page's.
 */
export function createCheckAnswerer({
  link,
  config = {},
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  holdMs = CHECK_HOLD_MS,
} = {}) {
  if (!link) throw new Error('createCheckAnswerer: a drive link is required');
  const open = new Map();   // session -> { pc, timer }
  let destroyed = false;
  const send = (session, kind, extra = {}) => { try { link.sendSignal({ kind, purpose: CHECK_PURPOSE, session, ...extra }); } catch { /* gone */ } };
  function close(session) {
    const s = open.get(session);
    if (!s) return;
    open.delete(session);
    if (s.timer != null) { try { clearTimer(s.timer); } catch { /* gone */ } }
    try { s.pc?.close(); } catch { /* closed */ }
  }
  // "May drive" is a grant the SERVER holds (drive grants), not a field on this screen's row: the server refuses
  // anybody else's check and stamps `byDrive` on the ones it lets through (drive.py SERVER_STAMPS: a page cannot write
  // it). No stamp, no answer - it fails closed, so an older server that never stamps it gets no check answered.
  const allowed = (sig) => typeof sig.by === 'string' && !!sig.by && sig.byDrive === true;

  async function answer(sig) {
    const { session } = sig;
    if (!allowed(sig)) { send(session, 'bye', { reason: 'not-allowed' }); return; }
    if (!checkOfferOk(sig.sdp)) { send(session, 'bye', { reason: 'not-a-check' }); return; }
    if (open.size >= CHECK_MAX_AT_ONCE || !PeerConnection) { send(session, 'bye', { reason: 'busy' }); return; }
    const pc = new PeerConnection({ iceServers: iceServers(config) });
    const s = { pc, timer: null };
    open.set(session, s);
    // NOTHING ARRIVES THAT IS PLAYED: no ontrack at all, and the data channel is only held open, never read into anything.
    pc.ondatachannel = () => {};
    s.timer = setTimer(() => { s.timer = null; close(session); }, holdMs);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gatheringDone(pc, { setTimer });
    } catch { close(session); send(session, 'bye', { reason: 'failed' }); return; }
    if (open.get(session) !== s || destroyed) return;
    send(session, 'answer', { sdp: pc.localDescription?.sdp });
  }

  const off = link.onSignal ? link.onSignal((sig) => {
    if (destroyed || !sig || sig.purpose !== CHECK_PURPOSE || typeof sig.session !== 'string') return;
    if (sig.kind === 'offer') { answer(sig).catch(() => close(sig.session)); return; }
    if (sig.kind === 'bye') close(sig.session);
  }) : null;

  return {
    open: () => open.size,
    destroy() { destroyed = true; for (const k of [...open.keys()]) close(k); try { off?.(); } catch { /* gone */ } },
  };
}
