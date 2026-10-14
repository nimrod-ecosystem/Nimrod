// checkin.js — THE SILENT CHECK-IN, "LIKE BABY MONITOR MODE" (Mike, 2026-10-13; DECISIONS.md "Also to build").
//
// Mike: a silent check-in, *"like baby monitor mode"*, where by default the screen still shows who is checking in; it
// lets someone check whether a person is asleep before making any noise.
//
// WHAT IT IS: a ONE-WAY look and/or listen into the room. The person checking in sees and/or hears the room; the room
// hears NOTHING from them - no ring, no chime, no spoken name, no voice - and the screen keeps showing what it shows,
// with one small notice in the corner: "<name> is checking in". Each rule below is held by code, not by a sentence:
//
//   1. NOTHING FROM THE CHECKER IS EVER PLAYED IN THE ROOM. Three locks, any one of which is enough:
//      (a) the checker's page never opens its own microphone or camera at all (createCheckInSender asks for
//          receive-only transceivers and calls no getUserMedia);
//      (b) the room REFUSES an offer that would send anything (`checkInOfferCheck`: every audio/video section must be
//          recvonly, and nothing else - no data channel - may ride along), and answers `sendonly`;
//      (c) the room's half has no audio element, no speaker, no audio-bus registration and no `output` at all - its
//          `ontrack` drops whatever arrives. There is no code path from the checker to the room's speaker.
//   2. NOTHING IS HEARD IN THE ROOM WHEN IT STARTS. No chime, no "Check-in from <name>", no tone. That is the feature.
//   3. THE SCREEN SAYS WHO IS CHECKING IN, FOR THE WHOLE TIME, BEFORE ANY MICROPHONE OR CAMERA OPENS. "<name> is
//      checking in (sound and picture)", in the screen's notice column (live_notices.js) - the "something is
//      listening" column the intercom and the phone microphone use - with an End button. The name is the SERVER's
//      (the people list's name, else their display name), never one the checker's page typed. Small, quiet, in the
//      corner; it never covers the photos more than that one pill. NO SETTING HIDES IT here - see HIDING below.
//   4. IT ALWAYS ENDS BY ITSELF. When the checker stops; after `checkInMaxMs` (a setting, 10 minutes by default); when
//      somebody in the room presses anything (a setting, on by default); with one press of End, a switch or a phrase
//      bound to "Check-in: end it"; when a call is answered or the intercom opens; when the connection is lost. Never a
//      state only an input can leave: nobody in the room doing anything still ends it (the time limit, the checker
//      leaving, the connection dropping).
//   5. ONLY PEOPLE ALLOWED. "May check in quietly" is its own permission (screen_access.may_check_in, screen_permissions
//      permsFor().checkIn): the owner and the guardian set by default, nobody else until ticked. The SERVER refuses
//      anybody else's offer before it reaches a screen (app.py); the room checks the server's stamp (`by`) too, and an
//      offer with no stamp is refused - it fails closed.
//   6. ONE SCREEN. Like the intercom, the screen asks the server first (`claim`, drive.py Answerers) and only the screen
//      the server names opens anything; every other screen of the person does nothing at all.
//   7. NOTHING IS RECORDED OR STORED. WebRTC between the two devices, like a call; the site relays the setup and keeps
//      nothing (storage_line.py). The room's microphone and camera are released the moment it ends.
//
// ---------------------------------------------------------------------------------------
// THE CHOICES, ARGUED (each a setting on the person's row with a default; on Mike's list)
// ---------------------------------------------------------------------------------------
//
// WHAT IT CARRIES (`checkInMedia`): 'both' (DEFAULT), 'sound', 'picture'. The room's setting is a CEILING; the checker
//   asks for what they want within it. FOR 'both' by default: the thing Mike named - "check whether a person is asleep" -
//   is mostly answered by a picture (eyes closed, lying down); a quiet room is ambiguous on sound alone. The people who
//   have it by default (the owner, the guardian set) can already drop in on a VIDEO call that answers by itself. FOR
//   'sound' by default: a baby monitor in its oldest form is sound only, and a microphone is a smaller step into a room
//   than a camera. 'picture' is for a household that wants to look without listening in on a conversation. The checker's
//   page defaults to the most the room allows; asking for something the room does not allow is refused in words, never
//   quietly widened.
// HOW LONG (`checkInMaxMs`): 2, 10 (DEFAULT), 30 or 60 minutes, or "only when somebody ends it". 10 minutes, argued: a
//   look before calling is seconds, and a few minutes covers watching someone settle; a page left open in a pocket
//   cannot watch a room all evening. The baby-monitor use (listening while doing something else) wants longer: an hour,
//   or no limit, which is somebody's deliberate choice. The checker's page also ends when it is closed or hidden for good.
// A PRESS IN THE ROOM ENDS IT (`checkInEndOnPress`): ON by default. FOR: a press means somebody is awake and at the
//   screen - which answers the checker's question - and that person gets their room back without being looked at; it is
//   also the easiest way for anybody there to end it without finding the button. The checker is told why ("Someone at
//   the screen pressed something"). AGAINST: a person who fidgets with a switch in their sleep, or a carer adjusting
//   something, ends a look the family wanted. Off is for that household. A press from ANOTHER device (somebody driving
//   the screen remotely) does not count: only a physical press in the room (input.js EDGE_TOPIC, phase 'down').
// A CALL OR THE INTERCOM WHILE CHECKING IN: the check-in gives way. A call that is ANSWERED, or an intercom that opens,
//   ends it (the room is awake and talking; a silent watcher on top of a conversation is not what anybody asked for).
//   A call only RINGING leaves it alone. A check-in offered while a call is live or the intercom is open is refused as
//   'in-a-call' - the person is plainly awake, and the checker can call instead.
//
// HIDING THE NOTICE - NOT BUILT, A QUESTION FOR MIKE. Mike's words were "by default the screen still shows who is
// checking in", which leaves room for a non-default. But every ruling on record goes the other way: "Someone is helping"
// is a consent invariant no setting hides (2026-08-26); "Sharing your screen with ..." shows for a guardian too
// (2026-10-12); the intercom and the phone microphone say "no setting hides it". A hidden check-in is a hidden camera,
// and the person in front of the screen is the one person who could not turn it back on. The case for it: a parent of a
// baby, or a guardian whose relative is distressed by any notice. That is real, and it is Mike's call - so it is on his
// list, not in a menu.

import { iceServers, gatheringDone, STALL_MS } from './call_transport.js';
import { newSession as newPhoneSession } from './phone_mic.js';
import { permsFor } from './screen_permissions.js';
import { PROFILES as MIC_PROFILES } from './mic_owner.js';
import { noticeStack } from './live_notices.js';
import { MEDIA_CHOICES, CHECKIN_DEFAULTS, CHECKIN_FIELDS, checkInOptionsFrom, allowedKinds } from './checkin_options.js';

export { MEDIA_CHOICES, CHECKIN_DEFAULTS, CHECKIN_FIELDS, checkInOptionsFrom, allowedKinds };

export const CHECKIN_PURPOSE = 'checkin';
export const CHECKIN_TOPIC = 'checkin/state';
export const CHECKIN_END_TOPIC = 'checkin/end';
export const CHECKIN_ACTIONS = [
  { id: 'checkin/end', label: 'Check-in: end it', topic: CHECKIN_END_TOPIC, group: 'Spoken' },
];

/**
 * The room's check on a check-in offer. Pure. Every audio/video section must ask to RECEIVE only (recvonly), or be
 * switched off (inactive); a section that would send anything into the room (sendrecv, sendonly, or no direction at all,
 * which SDP reads as sendrecv), or any other kind of section (a data channel), refuses the whole offer: 'sends'.
 * Returns { ok, why, audio, video } - which kinds the checker asked to receive.
 */
export function checkInOfferCheck(sdp) {
  const s = String(sdp || '');
  const parts = s.split(/\r?\n(?=m=)/);
  const head = parts[0] && !/^m=/.test(parts[0]) ? parts[0] : '';
  const sections = parts.filter((p) => /^m=/.test(p));
  if (!sections.length) return { ok: false, why: 'nothing-asked', audio: false, video: false };
  const dirOf = (txt) => ((txt.match(/^a=(sendrecv|sendonly|recvonly|inactive)\s*$/m) || [])[1] || null);
  const sessionDir = dirOf(head) || 'sendrecv';
  let audio = false;
  let video = false;
  for (const sec of sections) {
    const kind = (sec.match(/^m=(\w+)/) || [])[1];
    const dir = dirOf(sec) || sessionDir;
    if (kind !== 'audio' && kind !== 'video') return { ok: false, why: 'sends', audio: false, video: false };
    if (dir === 'sendrecv' || dir === 'sendonly') return { ok: false, why: 'sends', audio: false, video: false };
    if (dir === 'inactive') continue;
    if (kind === 'audio') audio = true; else video = true;
  }
  if (!audio && !video) return { ok: false, why: 'nothing-asked', audio, video };
  return { ok: true, why: null, audio, video };
}

/**
 * MAY THIS SENDER CHECK IN? Pure. `sig` is the server-stamped offer: `by` (the account), `byOwner`, `byName`.
 * Returns { account, name } or null. Fails closed: no stamp, no check-in.
 */
export function admitFor(row, sig) {
  const by = sig && typeof sig.by === 'string' && sig.by ? sig.by : null;
  if (!by) return null;
  const ok = permsFor(row || {}, by, sig.byOwner === true ? by : null).checkIn === true;
  if (!ok) return null;
  const ent = (Array.isArray(row?.screenPeople) ? row.screenPeople : []).find((e) => e && e.account === by);
  const name = (ent && typeof ent.name === 'string' && ent.name.trim())
    || (typeof sig.byName === 'string' && sig.byName.trim())
    || (sig.byOwner === true ? 'Someone on this account' : 'Someone');
  return { account: by, name: String(name).slice(0, 60) };
}

export const isCheckInSignal = (sig) => !!sig && typeof sig === 'object' && sig.purpose === CHECKIN_PURPOSE;
export const newSession = (rand) => newPhoneSession(rand).replace(/^pm-/, 'ck-');

/** The words for what a check-in carries. Pure. */
export function mediaWords({ audio, video } = {}) {
  if (audio && video) return 'sound and picture';
  if (video) return 'picture only';
  if (audio) return 'sound only';
  return '';
}

// What the checker is told when it ends, and what the checker's page says. Kept here so both ends agree on the words.
export const END_REASONS = Object.freeze({
  'not-allowed': 'This account may not check in on that screen. Whoever looks after it can allow it on the Remote page (“May check in quietly”).',
  busy: 'Someone else is checking in on that screen right now.',
  'in-a-call': 'That screen is on a call or the intercom right now. Try calling instead.',
  'room-ended': 'Someone at the screen ended the check-in.',
  'room-pressed': 'Someone at the screen pressed something, so the check-in ended. They may be awake.',
  'time-limit': 'The check-in ended itself after its time limit.',
  call: 'The screen answered a call, so the check-in ended.',
  intercom: 'The intercom opened on that screen, so the check-in ended.',
  'not-offered': 'That screen’s check-in settings don’t allow what you asked for. Try sound only, or picture only.',
  sends: 'A check-in sends nothing into the room.',
  'nothing-asked': 'Choose sound, picture or both.',
  'no-device': 'The screen could not open its microphone or camera.',
  stalled: 'The connection was lost.',
  failed: 'The check-in could not connect.',
  'no-answer': 'The screen did not answer. It may be switched off.',
  stopped: 'The check-in has ended.',
});

// =========================================================================================
// THE CHECKER'S HALF - opens NOTHING of its own
// =========================================================================================

export const SENDER_STATES = ['idle', 'asking', 'open', 'reconnecting', 'ended'];

export function createCheckInSender({
  link,
  session = newSession(),
  want = 'both',                       // 'both' | 'sound' | 'picture' - what this checker asks to receive
  config = {},
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  Stream = (typeof MediaStream !== 'undefined' ? MediaStream : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // How long to wait for the room to answer: one claim and a connection, no warning. 30 s, like the intercom's.
  answerMs = 30000,
  onState = null,
  onRemote = null,                     // (MediaStream|null) - the room's sound and/or picture
} = {}) {
  if (!link) throw new Error('createCheckInSender: a drive link is required');
  const kinds = allowedKinds(want);
  let state = 'idle';
  let why = null;
  let pc = null;
  let remote = null;
  let answered = false;
  let wait = null;
  let seq = 0;

  const set = (s, reason = null) => {
    if (s === state && reason === why) return;
    state = s; why = reason;
    try { onState?.(state, why); } catch (err) { console.error('checkin onState', err); }
  };
  const clearWait = () => { if (wait != null) { try { clearTimer(wait); } catch { /* gone */ } wait = null; } };
  function closePc() { if (pc) { try { pc.close(); } catch { /* closed */ } pc = null; } }
  function end(reason) {
    clearWait();
    closePc();
    if (remote) { remote = null; try { onRemote?.(null); } catch { /* gone */ } }
    set('ended', reason);
  }

  async function offer(kind = 'asking') {
    if (state === 'ended') return false;
    const my = ++seq;
    closePc();
    answered = false;
    pc = new PeerConnection({ iceServers: iceServers(config) });
    // RECEIVE ONLY. No getUserMedia anywhere in this half: there is nothing of the checker's to send.
    if (kinds.audio) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (kinds.video) pc.addTransceiver('video', { direction: 'recvonly' });
    const mine = pc;
    pc.ontrack = (e) => {
      if (pc !== mine || !e.track) return;
      if (!remote) remote = (e.streams && e.streams[0]) || (Stream ? new Stream() : null);
      if (remote && remote.getTracks && !remote.getTracks().includes(e.track)) { try { remote.addTrack(e.track); } catch { /* there */ } }
      try { onRemote?.(remote); } catch (err) { console.error('checkin onRemote', err); }
    };
    pc.onconnectionstatechange = () => {
      if (pc !== mine) return;
      const st = pc.connectionState;
      if (st === 'connected') { clearWait(); set('open'); }
      else if (st === 'failed') set('reconnecting', st);
    };
    try {
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      await gatheringDone(pc, { setTimer });
    } catch (err) {
      console.error('checkin: offer', err);
      if (my === seq) end('failed');
      return false;
    }
    if (my !== seq || state === 'ended' || !pc) return false;
    link.sendSignal({ kind: 'offer', purpose: CHECKIN_PURPOSE, session, sdp: pc.localDescription?.sdp });
    if (my !== seq || state === 'ended') return false;
    set(kind, kind === 'reconnecting' ? why : null);
    clearWait();
    wait = setTimer(() => { wait = null; if (state === 'asking' || state === 'reconnecting') stop('no-answer'); }, answerMs);
    return true;
  }

  function onSignal(sig) {
    if (!isCheckInSignal(sig) || sig.session !== session) return;
    if (sig.kind === 'answer') {
      if (!pc || answered) return;
      answered = true;
      pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp }).catch((err) => console.error('checkin: answer', err));
      return;
    }
    if (sig.kind === 'bye') end(sig.reason || 'room-ended');
  }
  const off = link.onSignal ? link.onSignal(onSignal) : null;

  function stop(reason = 'stopped') {
    if (state !== 'idle' && state !== 'ended') {
      try { link.sendSignal({ kind: 'bye', purpose: CHECKIN_PURPOSE, session, reason }); } catch { /* socket gone */ }
    }
    end(reason);
  }

  return {
    session,
    want: () => ({ ...kinds }),
    start() { if (state !== 'idle' && state !== 'ended') return Promise.resolve(false); state = 'idle'; return offer('asking'); },
    /** The socket came back mid-check-in: offer again on the SAME session (the room treats it as a reconnect). */
    reconnect() { if (state !== 'ended' && state !== 'idle') { set('reconnecting', 'socket'); return offer('reconnecting'); } return Promise.resolve(false); },
    stop,
    state: () => state,
    reason: () => why,
    /** Always false: the checker never opens a microphone. For the suites and the page's own words. */
    micOpen: () => false,
    remote: () => remote,
    destroy() { stop('stopped'); try { off?.(); } catch { /* gone */ } },
  };
}

// =========================================================================================
// THE ROOM'S HALF
// =========================================================================================

const MIC_ID = 'checkin';
const CAM_ID = 'checkin';
export const CLAIM_MS = 5000;          // the intercom's, argued there (intercom.js CLAIM_MS): fail closed, quietly

export function createCheckInReceiver({
  link,
  config = {},
  options = () => checkInOptionsFrom({}),   // the person's row, read at each offer (permissions can change)
  micOwner = null,
  getUserMedia = null,                       // only when there is no mic owner
  // THE ROOM'S CAMERA: () => Promise<MediaStreamTrack|null> (the kiosk hands in a clone from its camera owner) and its
  // release. Absent: a check-in carries sound only, whatever was asked.
  getCamera = null,
  releaseCamera = null,
  busy = () => false,                        // a call is live, or the intercom is open: refuse
  // A physical press in the room: (fn) => off. The kiosk hands in input.js EDGE_TOPIC, phase 'down'.
  onPress = null,
  bus = null,
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  stallMs = STALL_MS,
  claimMs = CLAIM_MS,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = null,
} = {}) {
  if (!link) throw new Error('createCheckInReceiver: a drive link is required');
  // The one session: { session, by, byOwner, name, phase: 'claiming'|'open', since, grant, pc, mic, micHeld, cam, timers }.
  let s = null;
  let destroyed = false;
  const offs = [];
  const claims = new Map();

  const list = () => (s && s.phase !== 'claiming'
    ? [{ session: s.session, name: s.name, phase: s.phase, since: s.since, audio: !!s.grant.audio, video: !!s.grant.video }] : []);
  function changed() {
    const sessions = list();
    try { onChange?.(sessions); } catch (err) { console.error('checkin onChange', err); }
    try { bus?.publish?.(CHECKIN_TOPIC, { sessions }); } catch (err) { console.error('checkin publish', err); }
  }
  const send = (session, kind, extra = {}) => {
    try { return link.sendSignal({ kind, purpose: CHECKIN_PURPOSE, session, ...extra }); } catch { return false; }
  };
  const clearT = (k) => { if (s && s[k] != null) { try { clearTimer(s[k]); } catch { /* gone */ } s[k] = null; } };

  function releaseDevices(was) {
    // The microphone and the camera FIRST: whatever else fails below, the room stops being heard and seen.
    if (was.micHeld) { try { micOwner?.release?.(MIC_ID); } catch { /* gone */ } }
    else if (was.mic) { for (const t of was.mic.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } }
    was.mic = null; was.micHeld = false;
    if (was.cam) { try { was.cam.stop?.(); } catch { /* stopped */ } was.cam = null; try { releaseCamera?.(); } catch { /* gone */ } }
  }

  function end(reason, { tell = true } = {}) {
    if (!s) return false;
    const was = s;
    for (const k of ['stall', 'limit']) clearT(k);
    releaseDevices(was);
    try { was.pc?.close(); } catch { /* closed */ }
    s = null;
    if (was.phase === 'claiming') return true;         // nothing showed, nothing opened, nothing promised
    if (tell) send(was.session, 'bye', { reason });
    changed();
    return true;
  }

  function askServer(session) {
    const have = claims.get(session);
    if (have) return have.promise;
    let done;
    const entry = { promise: new Promise((r) => { done = r; }), timer: null };
    entry.settle = (won) => {
      if (claims.get(session) !== entry) return;
      claims.delete(session);
      if (entry.timer != null) { try { clearTimer(entry.timer); } catch { /* gone */ } entry.timer = null; }
      done(won === true);
    };
    claims.set(session, entry);
    entry.timer = setTimer(() => { entry.timer = null; entry.settle(false); }, claimMs);
    let asked = false;
    try { asked = typeof link.claim === 'function' && link.claim({ purpose: CHECKIN_PURPOSE, session }) === true; }
    catch { asked = false; }
    if (!asked) entry.settle(false);
    return entry.promise;
  }

  async function openMic() {
    if (micOwner && typeof micOwner.acquire === 'function') {
      const m = await micOwner.acquire(MIC_ID, MIC_PROFILES.call);
      return { stream: m, held: true };
    }
    const gum = getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c));
    return { stream: await gum({ audio: { ...MIC_PROFILES.call }, video: false }), held: false };
  }

  async function answer(sess, sdp) {
    // The room's devices, opened only now - after the notice is up (rule 3).
    if (sess.grant.audio && !sess.mic) {
      try {
        const m = await openMic();
        if (s !== sess) { if (m.held) { try { micOwner?.release?.(MIC_ID); } catch { /* gone */ } } else for (const t of m.stream?.getTracks?.() || []) t.stop(); return false; }
        sess.mic = m.stream; sess.micHeld = m.held;
      } catch (err) { console.error('checkin: no microphone', err); sess.mic = null; }
    }
    if (sess.grant.video && !sess.cam && typeof getCamera === 'function') {
      try { sess.cam = await getCamera(); } catch (err) { console.error('checkin: camera', err); sess.cam = null; }
      if (s !== sess) { try { sess.cam?.stop?.(); } catch { /* gone */ } if (sess.cam) { try { releaseCamera?.(); } catch { /* gone */ } } sess.cam = null; return false; }
    }
    const micTrack = (sess.mic?.getAudioTracks?.() || [])[0] || null;
    if (!micTrack && !sess.cam) { end('no-device'); return false; }
    try { sess.pc?.close(); } catch { /* closed */ }
    const pc = new PeerConnection({ iceServers: iceServers(config) });
    sess.pc = pc;
    // RULE 1(c): NOTHING THAT ARRIVES IS PLAYED. No element, no speaker, no audio bus - dropped here.
    pc.ontrack = () => {};
    pc.onconnectionstatechange = () => {
      if (sess.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') clearT('stall');
      else if (st === 'failed' || st === 'disconnected') {
        clearT('stall');
        sess.stall = setTimer(() => { if (s === sess) { sess.stall = null; end('stalled'); } }, stallMs);
      }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const trs = typeof pc.getTransceivers === 'function' ? (pc.getTransceivers() || []) : null;
    if (trs) {
      // SEND ONLY: the room's microphone and camera go out; nothing comes back in.
      for (const t of trs) {
        const kind = t?.receiver?.track?.kind;
        try {
          if (kind === 'audio' && micTrack) { await t.sender?.replaceTrack?.(micTrack); t.direction = 'sendonly'; }
          else if (kind === 'video' && sess.cam) { await t.sender?.replaceTrack?.(sess.cam); t.direction = 'sendonly'; }
          else t.direction = 'inactive';
        } catch (err) { console.error('checkin: direction', err); try { t.direction = 'inactive'; } catch { /* fixed */ } }
      }
    } else {
      // A peer connection without transceivers (an older browser, a suite's fake): add what is sent.
      if (micTrack) { try { pc.addTrack(micTrack, sess.mic); } catch (err) { console.error('checkin: add track', err); } }
      if (sess.cam) { try { pc.addTrack(sess.cam); } catch (err) { console.error('checkin: add track', err); } }
    }
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    await gatheringDone(pc, { setTimer });
    if (destroyed || s !== sess || sess.pc !== pc) return false;
    send(sess.session, 'answer', { sdp: pc.localDescription?.sdp });
    if (pc.connectionState !== 'connected') {
      clearT('stall');
      sess.stall = setTimer(() => { if (s === sess && sess.pc === pc) { sess.stall = null; end('stalled'); } }, stallMs);
    }
    return true;
  }

  function onSignal(sig) {
    if (destroyed || !isCheckInSignal(sig)) return;
    const session = typeof sig.session === 'string' ? sig.session : '';
    if (!session) return;
    if (sig.kind === 'answerer') {
      if (sig.you !== true && s && s.session === session) end('answered-elsewhere', { tell: false });
      claims.get(session)?.settle(sig.you === true);
      return;
    }
    if (sig.kind === 'bye') { if (s && s.session === session) end('checker', { tell: false }); return; }
    if (sig.kind !== 'offer') return;
    const check = checkInOfferCheck(sig.sdp);
    if (!check.ok) { if (s && s.session === session) end(check.why); else send(session, 'bye', { reason: check.why }); return; }
    const o = options() || checkInOptionsFrom({});
    const entry = admitFor(o.row || {}, sig);
    if (!entry) {
      if (s && s.session === session) end('not-allowed');
      else send(session, 'bye', { reason: 'not-allowed' });
      return;
    }
    if (s && s.session === session) {
      if (s.by !== sig.by) { send(session, 'bye', { reason: 'not-allowed' }); return; }
      // A reconnect: the same person, the same session. Ask the server again (this screen's socket may have dropped).
      clearT('stall');
      const sess = s;
      askServer(session).then((won) => {
        if (destroyed || s !== sess) return null;
        if (!won) { end('answered-elsewhere', { tell: false }); return null; }
        return answer(sess, sig.sdp);
      }).catch((err) => { console.error('checkin: re-answer', err); if (s === sess) end('failed'); });
      return;
    }
    if (s) { send(session, 'bye', { reason: 'busy' }); return; }
    if (busy()) { send(session, 'bye', { reason: 'in-a-call' }); return; }
    const allow = allowedKinds(o.media);
    const grant = { audio: check.audio && allow.audio, video: check.video && allow.video && typeof getCamera === 'function' };
    if (!grant.audio && !grant.video) { send(session, 'bye', { reason: 'not-offered' }); return; }
    const sess = { session, by: sig.by, byOwner: sig.byOwner === true, name: entry.name, phase: 'claiming', since: now(),
                   grant, pc: null, mic: null, micHeld: false, cam: null, stall: null, limit: null };
    s = sess;
    askServer(session).then((won) => {
      if (destroyed || s !== sess) return;
      if (!won) { end('answered-elsewhere', { tell: false }); return; }
      // THE NOTICE FIRST (rule 3), then the devices. No sound of any kind (rule 2).
      sess.phase = 'open';
      sess.since = now();
      if (o.maxMs > 0) sess.limit = setTimer(() => { if (s === sess) { sess.limit = null; end('time-limit'); } }, o.maxMs);
      changed();
      answer(sess, sig.sdp).catch((err) => { console.error('checkin: answer', err); if (s === sess) end('failed'); });
    }).catch((err) => { console.error('checkin: claim', err); if (s === sess) end('failed', { tell: false }); });
  }

  offs.push(link.onSignal ? link.onSignal(onSignal) : null);
  if (bus && typeof bus.subscribe === 'function') {
    offs.push(bus.subscribe(CHECKIN_END_TOPIC, (p) => { try { p?.claim?.(); } catch { /* ok */ } end('room-ended'); }));
  }
  if (typeof onPress === 'function') {
    offs.push(onPress(() => {
      if (!s || s.phase !== 'open') return;
      const o = options() || checkInOptionsFrom({});
      if (o.endOnPress !== false) end('room-pressed');
    }));
  }

  return {
    sessions: list,
    open: () => !!s && s.phase === 'open',
    /** The room ends it: ONE press, from the notice, a switch or a spoken phrase. Also a call answered, the intercom. */
    endAll(reason = 'room-ended') { return end(reason); },
    /** The person's row changed: somebody unticked while looking is cut off now, not later. */
    recheck() {
      if (s && !admitFor((options() || {}).row || {}, { by: s.by, byOwner: !!s.byOwner })) return end('not-allowed');
      return false;
    },
    /** For the suites: what this screen is sending right now (never anything it receives). */
    sending: () => (s ? { audio: !!(s.mic?.getAudioTracks?.() || []).length, video: !!s.cam } : { audio: false, video: false }),
    destroy() {
      end('room-ended');
      destroyed = true;
      for (const c of [...claims.values()]) c.settle(false);
      for (const off of offs) { try { off?.(); } catch { /* gone */ } }
    },
  };
}

// =========================================================================================
// THE ROOM'S NOTICE
// =========================================================================================

/** The words. Pure. '' when nobody is checking in. */
export function checkInText(sessions = []) {
  const x = sessions[0];
  if (!x || x.phase !== 'open') return '';
  const what = mediaWords(x);
  return `${x.name} is checking in${what ? ` (${what})` : ''}`;
}

/**
 * "<name> is checking in (sound and picture)", with End. In the notice column, small, never a sound: `role="status"`
 * (polite), so a screen reader at the screen says it in its own time and nothing else speaks. NO SETTING HIDES IT.
 */
export function mountCheckInNotice(host, {
  receiver = null,
  bus = null,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!host || !doc) throw new Error('mountCheckInNotice: a host element is required');
  const el = doc.createElement('div');
  el.className = 'live-note ic-live ci-live';
  el.dataset.phase = 'open';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const dot = doc.createElement('span');
  dot.className = 'ml-dot';
  dot.setAttribute('aria-hidden', 'true');
  const word = doc.createElement('span');
  word.className = 'ml-word';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'ic-end ci-end';
  btn.textContent = 'End';
  btn.setAttribute('aria-label', 'End the check-in');
  el.append(dot, word, btn);
  noticeStack(host, doc).append(el);
  btn.addEventListener('click', () => {
    if (receiver) receiver.endAll('room-ended');
    else bus?.publish?.(CHECKIN_END_TOPIC, {});
  });
  function show(sessions) {
    const t = checkInText(sessions || []);
    word.textContent = t;
    el.hidden = !t;
  }
  show(receiver ? receiver.sessions() : []);
  const offBus = bus && typeof bus.subscribe === 'function' ? bus.subscribe(CHECKIN_TOPIC, (p) => show((p && p.sessions) || [])) : () => {};
  return {
    shown: () => !el.hidden,
    text: () => word.textContent,
    button: () => btn,
    refresh() { show(receiver ? receiver.sessions() : []); },
    destroy() { try { offBus(); } catch { /* gone */ } el.remove(); },
  };
}
