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

export const MODES = ['auto', 'direct'];

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
} = {}) {
  if (!link) throw new Error('createCallTransport: a drive link is required');

  let pc = null;
  let remoteStream = null;
  let pendingOffer = null;            // an offer that arrived before anybody answered
  let incomingCb = null;
  let endedCb = null;
  let stallTimer = null;
  let destroyed = false;
  let attached = null;                // the <video> the module handed us
  let live = false;

  const log = (...a) => { try { onLog?.(...a); } catch { /* a logger must not break a call */ } };
  const ice = () => iceServers(config);

  function clearStall() { if (stallTimer != null) { clearTimer(stallTimer); stallTimer = null; } }
  function armStall() {
    clearStall();
    // A caller that vanished without a `bye` must not leave her looking at a dead call.
    stallTimer = setTimer(() => { stallTimer = null; if (live) finish('stalled'); }, STALL_MS);
  }

  function closePc() {
    if (!pc) return;
    try { pc.close(); } catch { /* already closed */ }
    pc = null;
  }

  function finish(reason) {
    clearStall();
    closePc();
    remoteStream = null;
    if (attached) { try { attached.srcObject = null; } catch { /* gone */ } attached = null; }
    const was = live;
    live = false;
    pendingOffer = null;
    if (was) { try { endedCb?.(reason); } catch (e) { log('onEnded threw', e); } }
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
    pc.onconnectionstatechange = () => {
      const st = pc?.connectionState;
      log('conn', st);
      if (st === 'connected') clearStall();
      // A drop is NOT the end. The caller re-offers on its own, so the panel stays up and
      // waits — with a stall timer, so a caller gone for good still releases the screen.
      else if (st === 'failed') armStall();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc?.iceConnectionState === 'failed') armStall();
    };
    return pc;
  }

  async function sendDescription(kind) {
    await gatheringDone(pc, { setTimer });
    if (destroyed || !pc) return false;
    return link.sendSignal({ kind, sdp: pc.localDescription?.sdp });
  }

  // ---- inbound -------------------------------------------------------------------------
  function onSignal(sig) {
    if (destroyed || !sig || !SIGNAL_KINDS.includes(sig.kind)) return;
    if (sig.kind === 'bye') { log('peer hung up'); finish('remote'); return; }
    if (role === 'screen' && sig.kind === 'offer') {
      clearStall();
      // An offer while a call is LIVE is a reconnect: the caller rebuilt and re-offered.
      // Answer it with the media we already hold rather than treating it as a new call,
      // or a blip would ring at her a second time.
      if (live) { answerWith(sig.sdp, currentTracks()).catch((e) => log('re-answer failed', e)); return; }
      pendingOffer = sig.sdp;
      try { incomingCb?.(sig.from || null); } catch (e) { log('onIncoming threw', e); }
      return;
    }
    if (role === 'driver' && sig.kind === 'answer') {
      pc?.setRemoteDescription({ type: 'answer', sdp: sig.sdp })
        .catch((e) => log('setRemoteDescription(answer) failed', e));
    }
  }

  function currentTracks() {
    if (!pc) return [];
    return pc.getSenders?.().map((s) => s.track).filter(Boolean) || [];
  }

  async function answerWith(sdp, tracks) {
    makePc(tracks);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    await sendDescription('answer');
    live = true;
    log('answer sent');
  }

  const off = link.onSignal ? link.onSignal(onSignal) : null;

  return {
    // What `modules/call.js` calls, and nothing else is part of the contract.
    onIncoming(cb) { incomingCb = cb; },
    onEnded(cb) { endedCb = cb; },

    /**
     * Answer the offer that is waiting. `outgoing` is the camera track the module already
     * acquired — the transport never touches the camera itself, because `camera_owner.js`
     * arbitrates that and a second opener is how two panels fight over one device.
     */
    async answer({ from = null, outgoing = null, remoteVideo = null, audio = null } = {}) {
      if (destroyed) return false;
      if (!pendingOffer) { log('answer with no offer waiting'); return false; }
      attached = remoteVideo || null;
      const tracks = [outgoing, ...(audio ? [audio] : [])].filter(Boolean);
      const sdp = pendingOffer;
      pendingOffer = null;
      try { await answerWith(sdp, tracks); return true; }
      catch (e) { log('answer failed', e); finish('failed'); return false; }
    },

    /** Place a call. Not used by the bedside module — a screen never calls anybody. */
    async call({ tracks = [], from = null } = {}) {
      if (destroyed || role !== 'driver') return false;
      makePc(tracks);
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      live = true;
      await gatheringDone(pc, { setTimer });
      if (destroyed || !pc) return false;
      return link.sendSignal({ kind: 'offer', sdp: pc.localDescription?.sdp, from });
    },

    hangup(reason = 'hangup') {
      // Tell the other end BEFORE tearing down, or they sit watching a frozen frame until
      // their own stall timer fires — thirty seconds of looking at somebody who has gone.
      try { link.sendSignal({ kind: 'bye', reason }); } catch { /* socket already gone */ }
      finish(reason);
    },

    // For the panel and for tests. `live` is the honest one: a peer connection can exist
    // and be connecting, which is not the same as a call.
    __probe: () => ({ live, hasPc: !!pc, pendingOffer: !!pendingOffer,
                      ice: ice(), relay: hasRelay(config), stalling: stallTimer != null }),

    destroy() {
      destroyed = true;
      try { off?.(); } catch { /* already gone */ }
      finish('destroyed');
    },
  };
}
