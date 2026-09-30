// intercom.js — A FAMILY MEMBER'S PHONE AND THE ROOM, TALKING BOTH WAYS (row 2.44).
//
// Mike, 2026-09-30, on the phone as a microphone: *"That means it could also work as an intercom."*
// Chat's note on the row, which is the design constraint: *an intercom that can open a microphone into
// her room is a listening device. It should be limited to people she (or her guardian) approved, and
// her screen shows when it is open.*
//
// So, four rules, each held by code rather than by a sentence:
//
//   1. ONLY APPROVED PEOPLE. The room keeps an APPROVED LIST on the person's row (`intercomAllowed`,
//      edited by whoever owns the person - `intercom_approvals.js`). EMPTY BY DEFAULT: nobody can open
//      the intercom until somebody adds them. The check is against WHO THE SERVER SAYS SENT THE OFFER
//      (`sig.by`, stamped by the server on every relayed signal - drive.py `stamp_signal`), never
//      against a name the phone typed. An offer with no stamp (an older server) is REFUSED: the check
//      fails closed. Getting onto the drive socket at all still needs a drive grant (unchanged), so an
//      intercom caller is somebody with a grant AND on the list.
//   2. THE ROOM IS TOLD FIRST. Before any microphone opens, the room hears a chime and (by default) the
//      caller's name is said, and the screen shows "Intercom opening: <name>" for `warnMs`. Only
//      then is the room's microphone opened. The name shown is the one on the APPROVED LIST, not one the
//      phone chose.
//   3. IT SHOWS FOR THE WHOLE TIME. "Intercom open: <name>" stays on the screen while it is open, in the
//      screen's notice column (live_notices.js). NO SETTING HIDES IT.
//   4. THE ROOM CAN END IT WITH ONE PRESS. The notice carries an End button, and `intercom/end` is an
//      ordinary action a switch or a spoken phrase can be bound to. Nobody-answers test: if nobody in
//      the room does anything, it stays open until the phone hangs up, the connection drops, or
//      `maxMs` passes - a forgotten open microphone into a room ends by itself.
//
// ---------------------------------------------------------------------------------------
// WHY THIS IS NOT `createCallTransport`, AND NOT A FLAG ON phone_mic.js - argued
// ---------------------------------------------------------------------------------------
//
// REUSED: the wire (the same drive socket and its signalling, so no new server path and no new
// permission), `iceServers` / `gatheringDone` / `STALL_MS` from call_transport.js (the connectivity
// half that was validated phone <-> Pi), `offerIsAudioOnly` / `newSession` from phone_mic.js, and the
// `purpose` field that already keeps a phone-microphone signal from ringing a call.
//
// NOT REUSED, and why:
//   * createCallTransport is ONE call per screen, owned by the Call module, which takes the WHOLE
//     STAGE with a countdown - on a screen where photos outrank everything, an intercom must not take
//     the picture away. Its `pendingOffer`/`live` are single slots; an intercom sharing them would let
//     an intercom hang up a call, or a call eat an intercom's offer. A signal with purpose 'intercom'
//     is ignored by it (call_transport.js), so the two cannot collide.
//   * phone_mic's receiver is listen-only, admits anybody with a drive grant, plays nothing, and
//     re-offers for days on its own (a phone in a stand). An intercom admits only the list, warns
//     first, sends the room's microphone back, plays the caller, and does NOT retry by itself (it is
//     a deliberate press each time). Folding those in as flags would put every one of them on a path
//     that is already working for its own job. [For Mike: if a third purpose ever appears, the shared
//     session plumbing (~60 lines) is the thing to lift out into one file.]
//
// THE CALL TIER ON THE AUDIO BUS: while open, the caller's voice is registered as `call` tier (like a
// call), so music and videos pause under it rather than talking over the person on the intercom.

import { iceServers, gatheringDone, STALL_MS } from './call_transport.js';
import { offerIsAudioOnly, newSession as newPhoneSession } from './phone_mic.js';
import { PROFILES as MIC_PROFILES } from './mic_owner.js';
import { noticeStack } from './live_notices.js';

export const INTERCOM_PURPOSE = 'intercom';
export const INTERCOM_TOPIC = 'intercom/state';
export const INTERCOM_END_TOPIC = 'intercom/end';
export const INTERCOM_ACTIONS = [
  { id: 'intercom/end', label: 'Intercom: end it', topic: INTERCOM_END_TOPIC, group: 'Spoken' },
];

// Two-way sound on a phone and a screen: echo cancellation ON, or the room hears itself back from the
// phone's speaker (mic_owner.js: "a call wants all three ON").
export const INTERCOM_CONSTRAINTS = Object.freeze({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
});

export const INTERCOM_DEFAULTS = Object.freeze({
  // NOBODY until somebody is added. The person, or whoever owns the person (their guardian), adds them.
  allowed: [],
  // Between the chime and the room's microphone opening. 3 s, argued: FOR - the room hears the
  //   chime and the name before anything can hear it, and somebody mid-care can press End; AGAINST -
  //   a family member wanting a quick word waits three seconds every time. 0 opens straight after the
  //   chime; 10 s is for a room where somebody may need longer to reach the button.
  warnMs: 3000,
  // The chime before it opens. ON: the people in the room are not the person who pressed Open, and
  //   the chime is what tells them. Off is for a room where the spoken name is enough.
  chime: true,
  // Say "Intercom from <name>" through the output bus (the person's own routing decides how).
  announce: true,
  // A forgotten open microphone into a room ends by itself after this. 30 minutes, argued: FOR - a
  //   phone left on a table cannot listen to a room all night; AGAINST - a long conversation is cut
  //   (the phone opens it again with one press). 0 = no limit, a choice somebody makes.
  maxMs: 30 * 60000,
});

const WARN_CHOICES = [0, 3000, 10000];
const MAX_CHOICES = [0, 10 * 60000, 30 * 60000, 60 * 60000];

export const INTERCOM_FIELDS = [
  { key: 'intercomWarnMs', label: 'Intercom: warning before it opens', kind: 'choice',
    default: INTERCOM_DEFAULTS.warnMs, level: 'standard',
    options: [
      { value: 0, label: 'Open straight after the chime' },
      { value: 3000, label: 'Three seconds' },
      { value: 10000, label: 'Ten seconds' },
    ],
    note: 'The screen says who it is, and anybody in the room can end it before the microphone opens.' },
  { key: 'intercomChime', label: 'Intercom: chime before it opens', kind: 'toggle',
    default: INTERCOM_DEFAULTS.chime, level: 'standard' },
  { key: 'intercomAnnounce', label: 'Intercom: say who it is', kind: 'toggle',
    default: INTERCOM_DEFAULTS.announce, level: 'standard' },
  { key: 'intercomMaxMs', label: 'Intercom: end by itself after', kind: 'choice',
    default: INTERCOM_DEFAULTS.maxMs, level: 'advanced',
    options: [
      { value: 10 * 60000, label: 'Ten minutes' },
      { value: 30 * 60000, label: 'Half an hour' },
      { value: 60 * 60000, label: 'An hour' },
      { value: 0, label: 'Never - only when somebody ends it' },
    ] },
];

/** The approved list, cleaned: [{ account, name }], one per account. Pure. */
export function normalizeAllowed(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const account = e && typeof e.account === 'string' ? e.account.trim() : '';
    if (!account || out.some((x) => x.account === account)) continue;
    const name = e && typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 60) : account.split('@')[0];
    out.push({ account, name });
  }
  return out;
}

/** A person's row -> this file's options. Pure; every unset or broken key is its default. */
export function intercomOptionsFrom(values = {}) {
  const v = values || {};
  const pick = (k, choices, d) => {
    const n = Number(v[k]);
    return v[k] !== null && v[k] !== '' && typeof v[k] !== 'boolean' && Number.isFinite(n) && choices.includes(n) ? n : d;
  };
  return {
    allowed: normalizeAllowed(v.intercomAllowed),
    warnMs: pick('intercomWarnMs', WARN_CHOICES, INTERCOM_DEFAULTS.warnMs),
    chime: typeof v.intercomChime === 'boolean' ? v.intercomChime : INTERCOM_DEFAULTS.chime,
    announce: typeof v.intercomAnnounce === 'boolean' ? v.intercomAnnounce : INTERCOM_DEFAULTS.announce,
    maxMs: pick('intercomMaxMs', MAX_CHOICES, INTERCOM_DEFAULTS.maxMs),
  };
}

/**
 * Is the sender on the list? `by` is the account the SERVER stamped on the signal. Pure.
 * No stamp, no entry: refused. That is the fail-closed line.
 */
export function admits(allowed, by) {
  if (typeof by !== 'string' || !by) return null;
  return normalizeAllowed(allowed).find((e) => e.account === by) || null;
}

export const isIntercomSignal = (sig) => !!sig && typeof sig === 'object' && sig.purpose === INTERCOM_PURPOSE;
export const newSession = (rand) => newPhoneSession(rand).replace(/^pm-/, 'ic-');

// What the phone is told when the room says no, and what the phone page says. Kept here so both ends
// agree on the words.
export const END_REASONS = Object.freeze({
  'not-approved': 'This room has not added you to its intercom. Whoever looks after the screen can add you.',
  busy: 'The intercom is already open with somebody else.',
  'room-ended': 'The room ended the intercom.',
  'time-limit': 'The intercom ended itself after its time limit.',
  'video-refused': 'The intercom only carries sound.',
  'no-audio': 'The intercom needs this phone’s microphone.',
  stopped: 'The intercom is closed.',
  'no-answer': 'The screen did not answer. It may be switched off.',
});

// =========================================================================================
// THE PHONE'S HALF
// =========================================================================================

export const SENDER_STATES = ['idle', 'opening', 'asking', 'open', 'reconnecting', 'ended', 'no-mic'];

export function createIntercomSender({
  link,
  session = newSession(),
  from = {},                           // { name } - the phone's own label; the room shows the list's name
  config = {},
  getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c),
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  Stream = (typeof MediaStream !== 'undefined' ? MediaStream : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // How long to wait for the room to answer: its warning (up to 10 s) plus the connection. 30 s, then
  // it says the screen did not answer. NOT retried by itself: an intercom is a press each time.
  answerMs = 30000,
  onState = null,
  onRemote = null,                     // (MediaStream|null) - the room's sound, for the page to play
} = {}) {
  if (!link) throw new Error('createIntercomSender: a drive link is required');
  let state = 'idle';
  let why = null;
  let stream = null;
  let pc = null;
  let remote = null;
  let answered = false;
  let wait = null;
  let seq = 0;

  const set = (s, reason = null) => {
    if (s === state && reason === why) return;
    state = s; why = reason;
    try { onState?.(state, why); } catch (err) { console.error('intercom onState', err); }
  };
  const clearWait = () => { if (wait != null) { try { clearTimer(wait); } catch { /* gone */ } wait = null; } };
  function closePc() { if (pc) { try { pc.close(); } catch { /* closed */ } pc = null; } }
  function release() {
    clearWait();
    closePc();
    if (remote) { remote = null; try { onRemote?.(null); } catch { /* gone */ } }
    if (stream) { for (const t of stream.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } stream = null; }
  }
  function end(reason) {
    release();
    set('ended', reason);
  }

  async function offer(kind = 'asking') {
    if (!stream || state === 'ended') return false;
    const my = ++seq;
    closePc();
    answered = false;
    pc = new PeerConnection({ iceServers: iceServers(config) });
    const out = Stream ? new Stream() : null;
    for (const t of (stream.getAudioTracks ? stream.getAudioTracks() : (stream.getTracks?.() || [])).filter((x) => !x.kind || x.kind === 'audio')) {
      try {
        if (out) out.addTrack?.(t);
        if (typeof pc.addTransceiver === 'function') pc.addTransceiver(t, { direction: 'sendrecv', streams: out ? [out] : [] });
        else pc.addTrack(t, ...(out ? [out] : []));
      } catch (err) { console.error('intercom: add track', err); }
    }
    const mine = pc;
    pc.ontrack = (e) => {
      if (pc !== mine || !e.track || (e.track.kind && e.track.kind !== 'audio')) return;   // sound only
      if (!remote) remote = (e.streams && e.streams[0]) || (Stream ? new Stream() : null);
      if (remote && remote.getTracks && !remote.getTracks().includes(e.track)) { try { remote.addTrack(e.track); } catch { /* there */ } }
      try { onRemote?.(remote); } catch (err) { console.error('intercom onRemote', err); }
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
      console.error('intercom: offer', err);
      if (my === seq) end('offer-failed');
      return false;
    }
    if (my !== seq || state === 'ended' || !pc) return false;
    link.sendSignal({ kind: 'offer', purpose: INTERCOM_PURPOSE, session, sdp: pc.localDescription?.sdp, from: { ...from } });
    if (my !== seq || state === 'ended') return false;
    set(kind, kind === 'reconnecting' ? why : null);
    clearWait();
    wait = setTimer(() => { wait = null; if (state === 'asking' || state === 'reconnecting') stop('no-answer'); }, answerMs);
    return true;
  }

  function onSignal(sig) {
    if (!isIntercomSignal(sig) || sig.session !== session) return;
    if (sig.kind === 'answer') {
      if (!pc || answered) return;
      answered = true;
      pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp }).catch((err) => console.error('intercom: answer', err));
      return;
    }
    if (sig.kind === 'bye') end(sig.reason || 'room-ended');
  }
  const off = link.onSignal ? link.onSignal(onSignal) : null;

  function stop(reason = 'stopped') {
    if (state !== 'idle' && state !== 'ended') {
      try { link.sendSignal({ kind: 'bye', purpose: INTERCOM_PURPOSE, session, reason }); } catch { /* socket gone */ }
    }
    end(reason);
  }

  return {
    session,
    async start() {
      if (state !== 'idle' && state !== 'ended' && state !== 'no-mic') return false;
      set('opening');
      try { stream = await getUserMedia(INTERCOM_CONSTRAINTS); }
      catch (err) { console.error('intercom: no microphone', err); stream = null; set('no-mic', err?.name || 'denied'); return false; }
      if (state !== 'opening') { release(); return false; }
      for (const t of stream.getVideoTracks?.() || []) { try { t.stop(); stream.removeTrack?.(t); } catch { /* gone */ } }
      return offer('asking');
    },
    /** The socket came back mid-intercom: offer again on the SAME session (the room treats it as a reconnect). */
    reconnect() { if (stream && state !== 'ended') { set('reconnecting', 'socket'); return offer('reconnecting'); } return Promise.resolve(false); },
    stop,
    state: () => state,
    reason: () => why,
    micOpen: () => !!stream,
    remote: () => remote,
    destroy() { stop('destroyed'); try { off?.(); } catch { /* gone */ } },
  };
}

// =========================================================================================
// THE ROOM'S HALF
// =========================================================================================

const MIC_ID = 'intercom';
const AUDIO_ID = 'intercom';

export function createIntercomReceiver({
  link,
  config = {},
  options = () => intercomOptionsFrom({}),   // the person's row, read at each offer (the list can change)
  micOwner = null,
  getUserMedia = null,                       // only when there is no mic owner
  audio = null,                              // the audio bus: the caller's voice on the call tier
  output = null,                             // "Intercom from <name>", by the person's own routing
  chime = null,                              // () => void; default: a short two-note chime
  busy = () => false,                        // e.g. a call is live: refuse rather than talk over it
  bus = null,
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  makeAudio = () => (typeof Audio !== 'undefined' ? new Audio() : null),
  stallMs = STALL_MS,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = null,
} = {}) {
  if (!link) throw new Error('createIntercomReceiver: a drive link is required');
  let s = null;             // the one session: { session, by, name, phase: 'warning'|'open', since, pc, mic, el, timers }
  let destroyed = false;
  const offs = [];

  const list = () => (s ? [{ session: s.session, name: s.name, phase: s.phase, since: s.since }] : []);
  function changed() {
    const sessions = list();
    try { onChange?.(sessions); } catch (err) { console.error('intercom onChange', err); }
    try { bus?.publish?.(INTERCOM_TOPIC, { sessions }); } catch (err) { console.error('intercom publish', err); }
  }
  const send = (session, kind, extra = {}) => {
    try { return link.sendSignal({ kind, purpose: INTERCOM_PURPOSE, session, ...extra }); } catch { return false; }
  };
  const clearT = (k) => { if (s && s[k] != null) { try { clearTimer(s[k]); } catch { /* gone */ } s[k] = null; } };

  function end(reason, { tell = true } = {}) {
    if (!s) return false;
    const was = s;
    for (const k of ['warn', 'stall', 'limit']) clearT(k);
    try { was.pc?.close(); } catch { /* closed */ }
    if (was.el) { try { was.el.pause?.(); was.el.srcObject = null; } catch { /* gone */ } }
    if (was.micHeld) { try { micOwner?.release?.(MIC_ID); } catch { /* gone */ } }
    else if (was.mic) { for (const t of was.mic.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } }
    try { audio?.setActive?.(AUDIO_ID, false); } catch { /* gone */ }
    s = null;
    if (tell) send(was.session, 'bye', { reason });
    changed();
    return true;
  }

  function playChime(o) {
    if (!o.chime) return;
    try { (chime || defaultChime)(); } catch (err) { console.error('intercom chime', err); }
  }

  async function openMic() {
    if (micOwner && typeof micOwner.acquire === 'function') {
      const m = await micOwner.acquire(MIC_ID, MIC_PROFILES.call);
      return { stream: m, held: true };
    }
    const gum = getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c));
    return { stream: await gum(INTERCOM_CONSTRAINTS), held: false };
  }

  async function answer(sess, sdp) {
    // The room's microphone, opened only now - after the warning.
    if (!sess.mic) {
      try {
        const m = await openMic();
        if (s !== sess) { if (m.held) { try { micOwner?.release?.(MIC_ID); } catch { /* gone */ } } else for (const t of m.stream?.getTracks?.() || []) t.stop(); return false; }
        sess.mic = m.stream; sess.micHeld = m.held;
      } catch (err) {
        // No microphone: the caller can still talk INTO the room. Said on the screen's output.
        console.error('intercom: no microphone in the room', err);
        sess.mic = null;
        try { output?.alert?.('The intercom has no microphone here: they can talk, but will not hear the room.', { source: 'intercom' }); } catch { /* optional */ }
      }
    }
    try { sess.pc?.close(); } catch { /* closed */ }
    const pc = new PeerConnection({ iceServers: iceServers(config) });
    sess.pc = pc;
    for (const t of sess.mic?.getAudioTracks?.() || []) { try { pc.addTrack(t, sess.mic); } catch (err) { console.error('intercom: add track', err); } }
    pc.ontrack = (e) => {
      if (sess.pc !== pc || !e.track || (e.track.kind && e.track.kind !== 'audio')) return;
      const st = (e.streams && e.streams[0]) || null;
      if (!sess.el) sess.el = makeAudio();
      if (sess.el && st) { try { sess.el.srcObject = st; sess.el.play?.()?.catch?.(() => {}); } catch { /* gone */ } }
    };
    pc.onconnectionstatechange = () => {
      if (sess.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') clearT('stall');
      else if (st === 'failed' || st === 'disconnected') {
        // The phone offers again after a blip; a phone gone for good must not leave "Intercom open".
        clearT('stall');
        sess.stall = setTimer(() => { if (s === sess) { sess.stall = null; end('stalled'); } }, stallMs);
      }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    await gatheringDone(pc, { setTimer });
    if (destroyed || s !== sess || sess.pc !== pc) return false;
    send(sess.session, 'answer', { sdp: pc.localDescription?.sdp });
    // AN ANSWER THAT NEVER CONNECTS ENDS. The server fans an offer out to EVERY screen of the person
    // (phone_mic.js's known limit): with two open, both answer, the phone keeps the first, and the
    // other would sit "open" with its microphone on and nobody there. So until 'connected', the stall
    // clock runs - and the notice says "open" the whole time, which errs toward telling the room.
    if (pc.connectionState !== 'connected') {
      clearT('stall');
      sess.stall = setTimer(() => { if (s === sess && sess.pc === pc) { sess.stall = null; end('stalled'); } }, stallMs);
    }
    if (sess.phase !== 'open') {
      sess.phase = 'open';
      try {
        audio?.register?.(AUDIO_ID, { tier: 'call', onGain: (lv) => {
          const n = Number(lv); if (sess.el && Number.isFinite(n)) { try { sess.el.volume = Math.max(0, Math.min(1, n)); } catch { /* fixed */ } }
        } });
        audio?.setActive?.(AUDIO_ID, true);
      } catch (err) { console.error('intercom: audio bus', err); }
      const max = (options() || {}).maxMs;
      if (max > 0) sess.limit = setTimer(() => { if (s === sess) { sess.limit = null; end('time-limit'); } }, max);
      changed();
    }
    return true;
  }

  function onSignal(sig) {
    if (destroyed || !isIntercomSignal(sig)) return;
    const session = typeof sig.session === 'string' ? sig.session : '';
    if (!session) return;
    if (sig.kind === 'bye') { if (s && s.session === session) end('phone', { tell: false }); return; }
    if (sig.kind !== 'offer') return;
    const check = offerIsAudioOnly(sig.sdp);
    if (!check.ok) { send(session, 'bye', { reason: check.why }); return; }
    const o = options() || intercomOptionsFrom({});
    // THE LIST, BY THE SERVER'S STAMP. Read at every offer, so a person taken off the list cannot
    // reconnect either.
    const entry = admits(o.allowed, sig.by);
    if (!entry) {
      if (s && s.session === session) end('not-approved');       // taken off the list mid-intercom
      else send(session, 'bye', { reason: 'not-approved' });
      return;
    }
    if (s && s.session === session) {
      if (s.by !== sig.by) { send(session, 'bye', { reason: 'not-approved' }); return; }
      // A reconnect: the same person, the same session. The room was already told; no second chime.
      clearT('stall');
      if (s.phase === 'open') answer(s, sig.sdp).catch((err) => { console.error('intercom: re-answer', err); end('failed'); });
      else s.sdp = sig.sdp;
      return;
    }
    if (s || busy()) { send(session, 'bye', { reason: 'busy' }); return; }
    const sess = { session, by: sig.by, name: entry.name, phase: 'warning', since: now(), sdp: sig.sdp,
                   pc: null, mic: null, micHeld: false, el: null, warn: null, stall: null, limit: null };
    s = sess;
    changed();
    playChime(o);
    if (o.announce) { try { output?.alert?.(`Intercom from ${entry.name}`, { source: 'intercom' }); } catch { /* optional */ } }
    const go = () => {
      if (s !== sess) return;
      sess.warn = null;
      answer(sess, sess.sdp).catch((err) => { console.error('intercom: answer', err); if (s === sess) end('failed'); });
    };
    if (o.warnMs > 0) sess.warn = setTimer(go, o.warnMs);
    else go();
  }
  offs.push(link.onSignal ? link.onSignal(onSignal) : null);
  if (bus && typeof bus.subscribe === 'function') {
    offs.push(bus.subscribe(INTERCOM_END_TOPIC, (p) => { try { p?.claim?.(); } catch { /* ok */ } end('room-ended'); }));
  }

  return {
    sessions: list,
    open: () => !!s && s.phase === 'open',
    /** The room ends it: ONE press, from the notice, a switch or a spoken phrase. */
    endAll(reason = 'room-ended') { return end(reason); },
    /** The person's row changed: somebody taken off the list while talking is cut off now, not later. */
    recheck() {
      if (s && !admits((options() || {}).allowed, s.by)) return end('not-approved');
      return false;
    },
    destroy() {
      end('room-ended');
      destroyed = true;
      for (const off of offs) { try { off?.(); } catch { /* gone */ } }
      try { audio?.unregister?.(AUDIO_ID); } catch { /* gone */ }
    },
  };
}

// A short two-note chime (room_notify.js's bright chime), synthesised: nothing continuous, so nothing
// to register with the speaker arbiter.
let actx = null;
function defaultChime() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  actx = actx || new AC();
  if (actx.state === 'suspended') actx.resume?.()?.catch?.(() => {});
  for (const [freq, at, len] of [[880, 0, 0.45], [1318.5, 0.14, 0.5]]) {
    const o = actx.createOscillator();
    const v = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    const t = actx.currentTime + at;
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(0.12, t + 0.02);
    v.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(v).connect(actx.destination);
    o.start(t); o.stop(t + len + 0.02);
  }
}

// =========================================================================================
// THE ROOM'S NOTICE
// =========================================================================================

/** The words. Pure. '' when there is no intercom. */
export function intercomText(sessions = []) {
  const x = sessions[0];
  if (!x) return '';
  return x.phase === 'open' ? `Intercom open: ${x.name}` : `Intercom opening: ${x.name}`;
}

/**
 * "Intercom opening / open: <name>", with an End button - the one thing in the notice column that
 * takes a press. It does not block anything else on the screen. NO SETTING HIDES IT.
 */
export function mountIntercomNotice(host, {
  receiver = null,
  bus = null,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!host || !doc) throw new Error('mountIntercomNotice: a host element is required');
  const el = doc.createElement('div');
  el.className = 'live-note ic-live';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'assertive');
  const dot = doc.createElement('span');
  dot.className = 'ml-dot';
  dot.setAttribute('aria-hidden', 'true');
  const word = doc.createElement('span');
  word.className = 'ml-word';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'ic-end';
  btn.textContent = 'End';
  btn.setAttribute('aria-label', 'End the intercom');
  el.append(dot, word, btn);
  noticeStack(host, doc).append(el);
  btn.addEventListener('click', () => {
    if (receiver) receiver.endAll('room-ended');
    else bus?.publish?.(INTERCOM_END_TOPIC, {});
  });
  function show(sessions) {
    const t = intercomText(sessions || []);
    word.textContent = t;
    el.hidden = !t;
    el.dataset.phase = (sessions || []).some((x) => x.phase === 'open') ? 'open' : 'warning';
  }
  show(receiver ? receiver.sessions() : []);
  const offBus = bus && typeof bus.subscribe === 'function' ? bus.subscribe(INTERCOM_TOPIC, (p) => show((p && p.sessions) || [])) : () => {};
  return {
    shown: () => !el.hidden,
    text: () => word.textContent,
    button: () => btn,
    refresh() { show(receiver ? receiver.sessions() : []); },
    destroy() { try { offBus(); } catch { /* gone */ } el.remove(); },
  };
}
