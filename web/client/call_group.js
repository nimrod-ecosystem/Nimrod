// call_group.js — GROUP CALLS: a small call between several people, every device connected straight to every other.
// 2026-10-09.
//
// Mike, 2026-10-09: "So for the group calls they'd need their own VPN or something? Seems like something maybe we
// make a hookup for as an option." No VPN. A small call is a MESH: each person holds ONE CONNECTION PER OTHER PERSON,
// the same kind of connection a two-person call already is (call_transport.js), set up through the same socket
// (drive.js) and the same server (drive.py CallGroups), which carries only the setting-up. No media touches the
// server. A BIGGER call would need a media relay the household points its account at - an option, not built
// (server/call_relay.py has the plan).
//
// A GROUP IS A CALL THAT MORE PEOPLE JOINED. It is built ON the two-person call, not beside it:
//   * the caller page tags its call `group: <id>` (call_transport.js `call({ group })`); the server makes the group,
//     and the screen that answers joins it - that first connection IS the call that rang, and stays exactly as it
//     always was (ringing, the countdown, decline, one screen answering, reconnects);
//   * a caller in the call can ring ANOTHER person's screen into it - another ordinary call, tagged with the group;
//   * another caller of the same person KNOCKS, and a caller already in the call lets them in;
//   * then everybody who is not already connected by a call that rang connects to everybody else HERE: one
//     RTCPeerConnection per other member. THE MEMBER WHO WAS THERE FIRST OFFERS; the one who just joined answers.
//     One rule, so two people never both offer to each other at once.
//
// WHAT CROSSES EACH MESH CONNECTION is what crosses a two-person call: this device's camera and microphone (the very
// same tracks - one camera, sent to each person), and the `nimrod-words` data channel (WORDS_LABEL), so a word chosen
// on a screen's talk board reaches EVERY other person in the call, and a board clip mixed into the call's sound
// (call_mix.js) is swapped onto every connection's audio at once (`swap`).
//
// THE CAP (MESH_MAX_OTHERS, below) is the server's too (drive.py; test_call_groups.py checks the two agree).

import { iceServers, gatheringDone, WORDS_LABEL, WORDS_QUEUE_MAX, parseWords, cleanWords, STALL_MS } from './call_transport.js';

// HOW MANY OTHER PEOPLE ONE DEVICE IS IN A MESH CALL WITH. A default, argued in drive.py MESH_MAX_OTHERS:
//   video 3 others (4 people) - a Raspberry Pi 400 drawing the screen can decode two or three small videos
//   [training knowledge, NOT measured on the bench Pi yet]; a phone sends one copy of itself per other person.
//   audio only 5 others (6 people) - sound is cheap; the limit is how many voices a room can follow.
// The case for more: a laptop on fibre could do 5 or 6 on video. For fewer: a Pi on facility wifi may struggle at 3.
// The first real 3-way call on the bench Pi settles it. Not a person's setting: nobody can judge decode load from a menu.
export const MESH_MAX_OTHERS = Object.freeze({ video: 3, audio: 5 });

// What a refusal from the server means, in words (drive.py CallGroups `refused` reasons).
export const GROUP_REFUSED_TEXT = Object.freeze({
  'no-call': 'There is no call there to join right now.',
  full: 'That call is full.',
  declined: 'They said not now.',
  unanswered: 'Nobody in the call answered.',
  ended: 'That call has ended.',
  'not-in-call': 'Only somebody in the call can add people to it.',
  busy: 'Too many people are asking at once. Try again in a moment.',
  'not-allowed': 'This device cannot do that.',
  // 2026-10-13: bringing other people into a call is a permission, checked by the server for every other screen in the
  // call (drive.py CallGroups `_bring_ok`). Said plainly, with where it is given.
  'no-bring': 'You don’t have permission to bring others into this call. Whoever looks after the screens on the call '
    + 'can allow it on the Remote page (“May bring others into a call”).',
});

// A mesh connection that FAILS is offered again once by whoever offered it (the same once-per-drop rule a caller
// follows, call_transport.js `trouble`); if it fails again it is given up after STALL_MS and its tile says so.
// 1, argued: one retry rides out a blip; more would keep a device that cannot reach another trying for ever.
export const MESH_RETRIES = 1;

const hasVideo = (s) => { try { return (s?.getVideoTracks?.() || []).length > 0; } catch { return false; } };

/**
 * One device's part in group calls. `link` is a connected drive socket (drive.js `connectDrive`) - the same one
 * the two-person call rides; an older link with no `onGroup` gets `null` back (no group calls; nothing changes).
 *
 * `getTracks()` - what this device sends (a screen: what its call is sending, call_transport.js `sending`; a caller
 * page: its camera and microphone). `ready` false: an offer that arrives before this device has its tracks (a
 * screen still opening its camera) waits for `setReady(true)`.
 */
export function createCallGroup({
  link,
  role = 'driver',
  getTracks = () => [],
  config = {},
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  Stream = (typeof MediaStream !== 'undefined' ? MediaStream : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onLog = null,
  ready = true,
  stallMs = STALL_MS,
} = {}) {
  if (!link || typeof link.onGroup !== 'function' || typeof link.sendGroup !== 'function') return null;

  let gid = null;                     // the group this device is in
  let me = null;                      // this device's peer id in it (the server's)
  let kind = 'video';
  let max = MESH_MAX_OTHERS.video + 1;
  let myLeg = null;                   // the member whose call brought this screen in (connected by that call)
  let knocking = null;                // null | 'asking' | 'waiting' - this device asking to join a call
  let isReady = !!ready;
  let destroyed = false;
  const members = new Map();          // peer -> member
  const deferred = new Map();         // peer -> an offer waiting for setReady(true)
  const toOffer = new Set();          // peers this device must offer to, once it is ready (it has no tracks yet)
  const knocks = new Map();           // knock id -> { knock, name } (callers: somebody asking to join)
  const changeCbs = new Set();
  const wordsCbs = new Set();
  const refusedCbs = new Set();
  const joinedCbs = new Set();
  const log = (...a) => { try { onLog?.(...a); } catch { /* a logger must not break a call */ } };
  const emit = (set, ...a) => { for (const cb of [...set]) { try { cb(...a); } catch (e) { log('group listener threw', e); } } };
  const changed = () => emit(changeCbs, view());

  // Reached by a call that rang (the screen that call rang, or the caller whose call rang this screen): that call is
  // the connection, so no mesh connection is made to it.
  const viaCall = (m) => !!m && (m.leg === me || m.peer === myLeg);
  const send = (msg) => { try { return link.sendGroup(msg) === true; } catch { return false; } };

  function tracksFor() {
    let t = [];
    try { t = (getTracks() || []).filter(Boolean); } catch (e) { log('group: tracks', e); t = []; }
    // An audio-only call sends sound only, whatever this device has open (the cap assumes nobody is decoding video).
    return kind === 'audio' ? t.filter((x) => x.kind === 'audio') : t;
  }

  function view() {
    return {
      group: gid, me, kind, max, leg: myLeg, knocking, ready: isReady,
      members: [...members.values()].map((m) => ({ peer: m.peer, name: m.name, role: m.role, leg: m.leg,
        session: m.session || null, viaCall: viaCall(m), state: m.state })),
      knocks: [...knocks.values()].map((k) => ({ ...k })),
    };
  }

  // ---- one mesh connection ---------------------------------------------------------------------------------------
  function closePeer(m, state = 'closed') {
    if (m.stall != null) { try { clearTimer(m.stall); } catch { /* gone */ } m.stall = null; }
    const ch = m.words; m.words = null;
    if (ch) { try { ch.close(); } catch { /* gone */ } }
    const pc = m.pc; m.pc = null;
    if (pc) { try { pc.close(); } catch { /* gone */ } }
    m.stream = null;
    m.queue.length = 0;
    m.state = state;
  }

  function wireWords(m, ch) {
    if (!ch || ch.label !== WORDS_LABEL) return;
    if (m.words && m.words !== ch) { try { m.words.close(); } catch { /* gone */ } }
    m.words = ch;
    ch.onopen = () => { if (m.words === ch) flush(m); };
    ch.onmessage = (e) => {
      if (m.words !== ch || destroyed) return;
      const w = parseWords(e?.data);
      if (w) emit(wordsCbs, { ...w, peer: m.peer, name: m.name });
    };
    ch.onclose = () => { if (m.words === ch) m.words = null; };
    if (ch.readyState === 'open') flush(m);
  }
  function flush(m) {
    const ch = m.words;
    if (!ch || ch.readyState !== 'open') return;
    while (m.queue.length) {
      try { ch.send(JSON.stringify(m.queue[0])); } catch (e) { log('group words: send failed', e); return; }
      m.queue.shift();
    }
  }

  function makePc(m) {
    if (m.pc) { const old = m.pc; m.pc = null; try { old.close(); } catch { /* gone */ } }
    if (m.stall != null) { try { clearTimer(m.stall); } catch { /* gone */ } m.stall = null; }
    const pc = new PeerConnection({ iceServers: iceServers(config) });
    m.pc = pc;
    m.stream = null;
    m.state = 'connecting';
    // Under one MediaStream, for the same reason as call_transport.js `makePc` (a bare track shows black).
    const out = Stream ? new Stream() : null;
    for (const t of tracksFor()) {
      try { if (out) { out.addTrack(t); pc.addTrack(t, out); } else pc.addTrack(t); } catch (e) { log('group addTrack', e); }
    }
    pc.ontrack = (e) => {
      if (m.pc !== pc) return;
      if (!m.stream) m.stream = (e.streams && e.streams[0]) || (Stream ? new Stream() : null);
      if (e.track && m.stream && !m.stream.getTracks().includes(e.track)) { try { m.stream.addTrack(e.track); } catch { /* there */ } }
      changed();
    };
    pc.ondatachannel = (e) => { if (m.pc === pc) wireWords(m, e?.channel); };
    pc.onconnectionstatechange = () => {
      if (m.pc !== pc) return;
      const st = pc.connectionState;
      m.state = st;
      if (st === 'connected') {
        m.tries = 0;
        if (m.stall != null) { try { clearTimer(m.stall); } catch { /* gone */ } m.stall = null; }
      } else if (st === 'failed') trouble(m);
      changed();
    };
    return pc;
  }

  function trouble(m) {
    if (m.offerer && m.tries < MESH_RETRIES) {
      m.tries += 1;
      offerTo(m).catch((e) => log('group re-offer', e));
      return;
    }
    if (m.stall != null) return;
    m.stall = setTimer(() => {
      m.stall = null;
      if (members.get(m.peer) === m && m.state !== 'connected') { closePeer(m, 'lost'); changed(); }
    }, stallMs);
  }

  async function offerTo(m) {
    if (destroyed || !gid || !PeerConnection) return false;
    const pc = makePc(m);
    m.offerer = true;
    // The words channel: made by whoever offers, before the offer, so the offer carries it (call_transport.js).
    if (typeof pc.createDataChannel === 'function') {
      try { wireWords(m, pc.createDataChannel(WORDS_LABEL, { ordered: true })); } catch (e) { log('group: no words channel', e); }
    }
    const o = await pc.createOffer();
    if (m.pc !== pc) return false;
    await pc.setLocalDescription(o);
    await gatheringDone(pc, { setTimer });
    if (destroyed || m.pc !== pc || !gid) return false;
    return send({ op: 'signal', group: gid, to: m.peer, signal: { kind: 'offer', sdp: pc.localDescription?.sdp } });
  }

  async function answerFrom(m, sdp) {
    if (destroyed || !gid || !PeerConnection) return false;
    const pc = makePc(m);
    m.offerer = false;
    await pc.setRemoteDescription({ type: 'offer', sdp });
    if (m.pc !== pc) return false;
    const a = await pc.createAnswer();
    if (m.pc !== pc) return false;
    await pc.setLocalDescription(a);
    await gatheringDone(pc, { setTimer });
    if (destroyed || m.pc !== pc || !gid) return false;
    return send({ op: 'signal', group: gid, to: m.peer, signal: { kind: 'answer', sdp: pc.localDescription?.sdp } });
  }

  function addMember(v) {
    if (!v || typeof v.peer !== 'string' || v.peer === me) return null;
    const old = members.get(v.peer);
    if (old) closePeer(old);
    const m = { peer: v.peer, name: typeof v.name === 'string' ? v.name : 'Someone', role: v.role === 'screen' ? 'screen' : 'driver',
      leg: typeof v.leg === 'string' ? v.leg : null, session: typeof v.session === 'string' ? v.session : null,
      pc: null, words: null, queue: [], stream: null, state: 'new', offerer: false, tries: 0, stall: null };
    members.set(m.peer, m);
    return m;
  }

  function reset() {
    for (const m of members.values()) closePeer(m);
    members.clear();
    deferred.clear();
    toOffer.clear();
    knocks.clear();
    gid = null; me = null; myLeg = null; kind = 'video'; max = MESH_MAX_OTHERS.video + 1;
  }

  // ---- what the server says (drive.py CallGroups) ------------------------------------------------------------------
  function onGroup(msg) {
    if (destroyed || !msg || typeof msg.op !== 'string') return;
    switch (msg.op) {
      case 'joined': {
        if (typeof msg.group !== 'string' || typeof msg.you !== 'string') return;
        if (gid && gid !== msg.group) reset();
        gid = msg.group; me = msg.you;
        kind = msg.kind === 'audio' ? 'audio' : 'video';
        max = Number.isFinite(msg.max) ? msg.max : MESH_MAX_OTHERS[kind] + 1;
        myLeg = typeof msg.leg === 'string' ? msg.leg : null;
        knocking = null;
        for (const v of msg.members || []) addMember(v);
        // THE JOINER ANSWERS; those already there offer (see the header). So nothing is offered from here.
        emit(joinedCbs, view());
        changed();
        return;
      }
      case 'peer-joined': {
        if (msg.group !== gid) return;
        const m = addMember(msg.peer);
        if (!m) return;
        // Not ready (a screen still opening its camera for the call that brought it in): the offer waits, or it
        // would go out with nothing in it.
        if (!viaCall(m)) {
          if (!isReady) toOffer.add(m.peer);
          else offerTo(m).catch((e) => { log('group offer failed', e); });
        }
        changed();
        return;
      }
      case 'peer-left': {
        if (msg.group !== gid) return;
        const m = members.get(msg.peer);
        if (!m) return;
        closePeer(m, 'left');
        members.delete(msg.peer);
        deferred.delete(msg.peer);
        toOffer.delete(msg.peer);
        changed();
        return;
      }
      case 'signal': {
        if (msg.group !== gid) return;
        const m = members.get(msg.from);
        const sig = msg.signal;
        if (!m || viaCall(m) || !sig || typeof sig !== 'object') return;
        if (sig.kind === 'offer' && typeof sig.sdp === 'string') {
          if (!isReady) { deferred.set(m.peer, sig.sdp); return; }
          answerFrom(m, sig.sdp).catch((e) => log('group answer failed', e));
        } else if (sig.kind === 'answer' && typeof sig.sdp === 'string') {
          const pc = m.pc;
          if (pc && m.offerer) pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp }).catch((e) => log('group: their answer', e));
        } else if (sig.kind === 'bye') {
          closePeer(m, 'left');
          changed();
        }
        return;
      }
      case 'knock':
        if (msg.group !== gid || typeof msg.knock !== 'string') return;
        knocks.set(msg.knock, { knock: msg.knock, name: typeof msg.name === 'string' ? msg.name : 'Someone' });
        changed();
        return;
      case 'knock-ended':
        if (knocks.delete(msg.knock)) changed();
        return;
      case 'knocking':
        knocking = 'waiting';
        changed();
        return;
      case 'refused': {
        const reason = typeof msg.reason === 'string' ? msg.reason : 'ended';
        const was = knocking;
        knocking = null;
        emit(refusedCbs, { reason, text: GROUP_REFUSED_TEXT[reason] || 'That did not work.', knock: !!was });
        changed();
        return;
      }
      default:
    }
  }
  const off = link.onGroup(onGroup);

  function setReady(on) {
    isReady = !!on;
    if (!isReady) return;
    for (const [peer, sdp] of [...deferred]) {
      deferred.delete(peer);
      const m = members.get(peer);
      if (m && !viaCall(m)) answerFrom(m, sdp).catch((e) => log('group answer failed', e));
    }
    for (const peer of [...toOffer]) {
      toOffer.delete(peer);
      const m = members.get(peer);
      if (m && !viaCall(m) && !m.pc) offerTo(m).catch((e) => log('group offer failed', e));
    }
  }

  function leave() {
    const had = gid;
    if (had) send({ op: 'leave', group: had });
    if (knocking) send({ op: 'cancel' });
    knocking = null;
    reset();
    if (had) changed();
  }

  return {
    /** The group's id, or null when this device is in none. */
    id: () => gid,
    me: () => me,
    kind: () => kind,
    max: () => max,
    leg: () => myLeg,
    /** Everybody else in the call (those reached by a call that rang included). */
    others: () => members.size,
    /** Everybody else EXCEPT the member whose call rang this screen - "is anybody still here if they leave?" */
    othersBesidesLeg: () => [...members.values()].filter((m) => m.peer !== myLeg).length,
    /** Room for one more, by the cap. */
    hasRoom: () => !!gid && members.size + 1 < max,
    state: () => view(),
    /** The mesh members' tiles: `{ peer, name, role, stream, video, state }` (not those reached by a call that rang). */
    tiles: () => [...members.values()].filter((m) => !viaCall(m)).map((m) => ({
      peer: m.peer, name: m.name, role: m.role, stream: m.stream, video: hasVideo(m.stream), state: m.state })),
    /** The member a call that rang reached (`session` = that call's id), for naming a tile drawn from that call. */
    memberBySession: (session) => { for (const m of members.values()) if (m.session && m.session === session) return { peer: m.peer, name: m.name }; return null; },

    /** Words into every mesh connection (a word from this device's talk board). `msg`: a `{ type:'say' }` or text. */
    say(msg) {
      if (destroyed || !gid) return 0;
      const m0 = typeof msg === 'string' ? { type: 'say', text: cleanWords(msg) } : msg;
      if (!m0 || m0.type !== 'say' || !m0.text) return 0;
      let n = 0;
      for (const m of members.values()) {
        if (viaCall(m) || !m.pc) continue;
        m.queue.push(m0);
        while (m.queue.length > WORDS_QUEUE_MAX) m.queue.shift();
        flush(m);
        n += 1;
      }
      return n;
    },
    /** Swap the track being sent of one kind on every mesh connection (a board clip mixed in, a camera switched). */
    async swap(kindOf, track) {
      if (!track) return 0;
      let n = 0;
      for (const m of members.values()) {
        for (const s of m.pc?.getSenders?.() || []) {
          if (s.track && s.track.kind === kindOf && typeof s.replaceTrack === 'function') {
            try { await s.replaceTrack(track); n += 1; } catch (e) { log('group replaceTrack', e); }
          }
        }
      }
      return n;
    },
    setReady,
    /** Ask to join the call the person this socket is for is in (drive.py CallGroups.knock). Callers only. */
    knock() { if (destroyed || role !== 'driver') return false; knocking = 'asking'; changed(); return send({ op: 'knock' }); },
    cancel() { if (!knocking) return false; knocking = null; changed(); return send({ op: 'cancel' }); },
    admit: (knock) => (!!gid && knocks.has(knock) && send({ op: 'admit', group: gid, knock })),
    deny: (knock) => (!!gid && knocks.has(knock) && send({ op: 'deny', group: gid, knock })),
    leave,
    onChange(cb) { if (typeof cb !== 'function') return () => {}; changeCbs.add(cb); return () => { changeCbs.delete(cb); }; },
    onWords(cb) { if (typeof cb !== 'function') return () => {}; wordsCbs.add(cb); return () => { wordsCbs.delete(cb); }; },
    onRefused(cb) { if (typeof cb !== 'function') return () => {}; refusedCbs.add(cb); return () => { refusedCbs.delete(cb); }; },
    onJoined(cb) { if (typeof cb !== 'function') return () => {}; joinedCbs.add(cb); return () => { joinedCbs.delete(cb); }; },
    __probe: () => ({ ...view(), pcs: [...members.values()].filter((m) => m.pc).length, deferred: deferred.size, toOffer: toOffer.size }),
    destroy() {
      if (destroyed) return;
      leave();
      destroyed = true;
      try { off?.(); } catch { /* gone */ }
      changeCbs.clear(); wordsCbs.clear(); refusedCbs.clear(); joinedCbs.clear();
    },
  };
}
