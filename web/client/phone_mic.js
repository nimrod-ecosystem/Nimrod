// phone_mic.js — A PHONE AS A MICROPHONE: a one-way call from a phone to the screen.
//
// Row 2.42. Mike, 2026-09-30: *"This could actually be really good if I could just leave her old
// phone there and it turns into a microphone she could hold or you could put on the pillow next to
// her."* And row 2.44: normally the phone sits in a stand by the monitor; the pillow is for when
// somebody is there.
//
// It is a CALL WITH ONE DIRECTION. The phone opens `phone_mic.html`, which sends its microphone and
// nothing else; the screen answers with nothing at all. So:
//
//   * AUDIO ONLY. The phone never asks for a camera. The screen REFUSES an offer that carries video
//     (`offerIsAudioOnly`) rather than trusting the page that sent it.
//   * NOTHING COMES BACK. The screen adds no tracks, and the phone plays nothing it receives - there
//     is no audio or video element on the phone page at all.
//   * IT SHOWS, AT BOTH ENDS, THAT THE MICROPHONE IS LIVE. The phone page turns into one large
//     "Microphone on" state; the screen shows a "Microphone on: <phone>" pill for as long as any
//     phone is connected or connecting (`mountMicLiveIndicator`). There is no setting that hides
//     the screen's pill: it is the same kind of promise as the "someone is driving this screen"
//     notice, which Mike confirmed as a consent invariant (2026-08-26) - whether this one is the
//     same invariant is on Mike's list, not assumed.
//   * ONLY APPROVED PEOPLE CAN JOIN. It rides the SAME drive socket the call uses (`drive.js`), and
//     that socket only admits somebody who owns the person or holds a live drive grant for them
//     (`_may_drive` on the server, checked when the ticket is bought AND when it is redeemed). No
//     new permission was invented. What is missing, said plainly: (1) the server does not stamp
//     WHO sent a signal - `from` is what the phone page says about itself, so the name on the pill
//     is self-reported by somebody already allowed in; (2) a drive grant covers this - there is no
//     separate "may use a phone as a microphone" switch, nor does `call_audio` gate it (the call
//     does not check it either). Both are server work (for Mike's list).
//
// ---------------------------------------------------------------------------------------
// HOW IT SHARES THE WIRE WITH A CALL
// ---------------------------------------------------------------------------------------
//
// Every phone-microphone signal carries `purpose: 'phone-mic'` and a `session` id; the call
// transport ignores anything with a purpose that is not a call (call_transport.js), so a phone
// joining can never ring the Call panel, and a phone leaving can never hang up a call. The server
// relays a signal whole (drive.py `parse_message`), so no server change was needed for this.
//
// KNOWN LIMIT: the server fans a driver's signal out to EVERY screen of that person. With two of
// their screens open at once (the bench unit switched on beside the live one), both answer; the
// phone takes the first answer and the other screen gives up after the stall window - showing
// "Microphone connecting" meanwhile, which errs toward telling the room. Addressing one screen
// needs a screen id on the wire (for Mike's list).
//
// ---------------------------------------------------------------------------------------
// WHERE THE AUDIO GOES ON THE SCREEN
// ---------------------------------------------------------------------------------------
//
// Nowhere by itself. The receiver holds the stream; `amplify.js` plays it when its source is set
// to 'phone', and a recogniser that takes a MediaStream can transcribe it (`streams()`). The
// browser's own recogniser CANNOT: Web Speech listens to the default microphone only and takes no
// stream. Feeding the phone to recognition needs a local recogniser that reads a stream (Vosk in
// an AudioWorklet, or a server on the Pi) - the same engine speaker identification needs.
//
// Extending this to an INTERCOM (row 2.44, not built): the same session with the screen adding
// its own microphone track (two-way), or the phone adding a receive direction (screen -> phone).
// The protocol already carries `purpose`, so an intercom is a second purpose with its own rules,
// and the pill on the screen becomes "Intercom open" - it should stay limited to approved people
// and shown at both ends, exactly as here.

import { iceServers, gatheringDone, STALL_MS } from './call_transport.js';

export const PHONE_MIC_PURPOSE = 'phone-mic';
// Published on the screen's bus whenever the set of phones changes: { phones: [...] }.
export const PHONE_MIC_TOPIC = 'phone-mic/state';

// Raw audio: a recogniser wants it untouched, and a microphone on a pillow is far from any speaker,
// so echo cancellation has nothing to cancel (mic_owner.js explains raw-by-default).
export const PHONE_MIC_CONSTRAINTS = Object.freeze({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
});

export const isPhoneMicSignal = (sig) => !!sig && typeof sig === 'object' && sig.purpose === PHONE_MIC_PURPOSE;

/** The screen's check on an offer: audio, and no video. Pure. */
export function offerIsAudioOnly(sdp) {
  const s = String(sdp || '');
  if (/^m=video/m.test(s)) return { ok: false, why: 'video-refused' };
  if (!/^m=audio/m.test(s)) return { ok: false, why: 'no-audio' };
  return { ok: true, why: null };
}

export function newSession(rand = () => Math.random()) {
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `pm-${s}`;
}

const nameOf = (from) => {
  const n = from && typeof from.name === 'string' ? from.name.trim() : '';
  return n || 'A phone';
};

// =========================================================================================
// THE PHONE'S HALF
// =========================================================================================

export const SENDER_STATES = ['idle', 'opening', 'waiting', 'live', 'reconnecting', 'ended', 'no-mic'];

export function createPhoneMicSender({
  link,
  session = newSession(),
  from = {},                           // { name, near } — what the screen shows, self-reported
  config = {},                         // { mode, stun, turn }, as for a call
  getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c),
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // How long to wait for the screen to answer before offering again. The phone lives in a stand for
  // days; a screen that was off or restarting should be found again without anybody touching it.
  retryMs = 15000,
  onState = null,
} = {}) {
  if (!link) throw new Error('createPhoneMicSender: a drive link is required');
  let state = 'idle';
  let why = null;
  let stream = null;
  let pc = null;
  let answered = false;
  let retry = null;
  let seq = 0;

  const set = (s, reason = null) => {
    if (s === state && reason === why) return;
    state = s; why = reason;
    try { onState?.(state, why); } catch (err) { console.error('phone mic onState', err); }
  };
  const clearRetry = () => { if (retry != null) { try { clearTimer(retry); } catch { /* gone */ } retry = null; } };
  const armRetry = (next) => {
    clearRetry();
    retry = setTimer(() => { retry = null; if (state === 'waiting' || state === 'reconnecting') offer(next); }, retryMs);
  };
  function closePc() { if (pc) { try { pc.close(); } catch { /* closed */ } pc = null; } }

  function release() {
    clearRetry();
    closePc();
    if (stream) { for (const t of stream.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } stream = null; }
  }

  async function offer(reason = 'waiting') {
    if (!stream || state === 'ended') return false;
    const my = ++seq;
    closePc();
    answered = false;
    pc = new PeerConnection({ iceServers: iceServers(config) });
    const tracks = (stream.getAudioTracks ? stream.getAudioTracks() : (stream.getTracks?.() || []))
      .filter((t) => !t.kind || t.kind === 'audio');
    for (const t of tracks) {
      // SEND ONLY. With addTransceiver the direction is said outright; an older engine gets
      // addTrack, and the screen adds nothing, so the answer is receive-only either way.
      try {
        if (typeof pc.addTransceiver === 'function') pc.addTransceiver(t, { direction: 'sendonly', streams: [stream] });
        else pc.addTrack(t, stream);
      } catch (err) { console.error('phone mic: add track', err); }
    }
    pc.ontrack = () => { /* nothing comes back, and nothing here is ever played */ };
    const mine = pc;
    pc.onconnectionstatechange = () => {
      if (pc !== mine) return;
      const st = pc.connectionState;
      if (st === 'connected') { clearRetry(); set('live'); }
      else if (st === 'failed' || st === 'disconnected') { set('reconnecting', st); armRetry('reconnecting'); }
    };
    try {
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      await gatheringDone(pc, { setTimer });
    } catch (err) {
      console.error('phone mic: offer', err);
      if (my === seq) { set('reconnecting', 'offer-failed'); armRetry('reconnecting'); }
      return false;
    }
    if (my !== seq || state === 'ended' || !pc) return false;
    link.sendSignal({ kind: 'offer', purpose: PHONE_MIC_PURPOSE, session,
                      sdp: pc.localDescription?.sdp, from: { ...from } });
    // The screen may already have said no (busy, video) by the time the send returns; a refusal
    // must not be painted over with "waiting", or the phone would offer again.
    if (my !== seq || state === 'ended') return false;
    set(reason === 'reconnecting' ? 'reconnecting' : 'waiting', reason === 'reconnecting' ? why : null);
    armRetry(reason);
    return true;
  }

  function onSignal(sig) {
    if (!isPhoneMicSignal(sig) || sig.session !== session) return;
    if (sig.kind === 'answer') {
      if (!pc || answered) return;               // the first screen to answer is the one
      answered = true;
      pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp })
        .catch((err) => console.error('phone mic: answer', err));
      return;
    }
    if (sig.kind === 'bye') {
      // The screen said no (busy, video) or turned it off. Respect it: nothing re-offers.
      release();
      set('ended', sig.reason || 'screen');
    }
  }
  const off = link.onSignal ? link.onSignal(onSignal) : null;

  return {
    session,
    async start() {
      if (state !== 'idle' && state !== 'ended' && state !== 'no-mic') return false;
      set('opening');
      try { stream = await getUserMedia(PHONE_MIC_CONSTRAINTS); }
      catch (err) { console.error('phone mic: no microphone', err); stream = null; set('no-mic', err?.name || 'denied'); return false; }
      if (state !== 'opening') { release(); return false; }        // stopped while asking
      // A browser that handed back video anyway gets it stopped here: this page sends audio only.
      for (const t of stream.getVideoTracks?.() || []) { try { t.stop(); stream.removeTrack?.(t); } catch { /* gone */ } }
      return offer('waiting');
    },
    /** The socket came back: offer again on the same session (the screen treats it as a reconnect). */
    reconnect() { if (stream && state !== 'ended') { set('reconnecting', 'socket'); return offer('reconnecting'); } return Promise.resolve(false); },
    stop(reason = 'stopped') {
      if (state !== 'idle' && state !== 'ended') {
        try { link.sendSignal({ kind: 'bye', purpose: PHONE_MIC_PURPOSE, session, reason }); } catch { /* socket gone */ }
      }
      release();
      set('ended', reason);
    },
    state: () => state,
    reason: () => why,
    micOpen: () => !!stream,
    destroy() { this.stop('destroyed'); try { off?.(); } catch { /* gone */ } },
  };
}

// =========================================================================================
// THE SCREEN'S HALF
// =========================================================================================

export function createPhoneMicReceiver({
  link,
  config = {},
  PeerConnection = (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null),
  Stream = (typeof MediaStream !== 'undefined' ? MediaStream : null),
  // One phone at a time by default: Mike has one old phone for this. A second phone is refused
  // ('busy') rather than silently replacing the first. A setting, not a law.
  maxPhones = 1,
  stallMs = STALL_MS,
  bus = null,
  onChange = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!link) throw new Error('createPhoneMicReceiver: a drive link is required');
  const sessions = new Map();          // session -> { session, from, pc, stream, phase, since, stall }
  let destroyed = false;

  const list = () => [...sessions.values()].map((s) => ({
    session: s.session, name: nameOf(s.from), near: (s.from && s.from.near) || null,
    phase: s.phase, since: s.since,
  }));
  function changed() {
    const phones = list();
    try { onChange?.(phones); } catch (err) { console.error('phone mic onChange', err); }
    try { bus?.publish?.(PHONE_MIC_TOPIC, { phones }); } catch (err) { console.error('phone mic publish', err); }
  }
  const send = (session, kind, extra = {}) => {
    try { return link.sendSignal({ kind, purpose: PHONE_MIC_PURPOSE, session, ...extra }); } catch { return false; }
  };
  function clearStall(s) { if (s.stall != null) { try { clearTimer(s.stall); } catch { /* gone */ } s.stall = null; } }

  function end(session, reason) {
    const s = sessions.get(session);
    if (!s) return false;
    clearStall(s);
    try { s.pc?.close(); } catch { /* closed */ }
    sessions.delete(session);
    changed();
    return reason;
  }

  async function answer(s, sdp) {
    try { s.pc?.close(); } catch { /* closed */ }
    const pc = new PeerConnection({ iceServers: iceServers(config) });
    s.pc = pc;
    // NOTHING IS ADDED. No track, no transceiver: the screen sends nothing to the phone.
    pc.ontrack = (e) => {
      if (s.pc !== pc) return;
      if (!s.stream) s.stream = (e.streams && e.streams[0]) || (Stream ? new Stream() : null);
      if (e.track && s.stream && s.stream.getTracks && !s.stream.getTracks().includes(e.track)) {
        try { s.stream.addTrack(e.track); } catch { /* already there */ }
      }
      changed();
    };
    pc.onconnectionstatechange = () => {
      if (s.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') { clearStall(s); if (s.phase !== 'live') { s.phase = 'live'; changed(); } }
      else if (st === 'failed' || st === 'disconnected') {
        // Not the end: the phone re-offers on its own. But a phone gone for good must release the
        // screen, or the pill says a microphone is on when none is.
        clearStall(s);
        s.stall = setTimer(() => { s.stall = null; end(s.session, 'stalled'); }, stallMs);
      }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    await gatheringDone(pc, { setTimer });
    if (destroyed || s.pc !== pc || !sessions.has(s.session)) return false;
    send(s.session, 'answer', { sdp: pc.localDescription?.sdp });
    return true;
  }

  function onSignal(sig) {
    if (destroyed || !isPhoneMicSignal(sig)) return;
    const session = typeof sig.session === 'string' ? sig.session : '';
    if (!session) return;
    if (sig.kind === 'bye') { end(session, 'phone'); return; }
    if (sig.kind !== 'offer') return;
    const check = offerIsAudioOnly(sig.sdp);
    if (!check.ok) { send(session, 'bye', { reason: check.why }); return; }
    let s = sessions.get(session);
    if (!s) {
      if (sessions.size >= Math.max(1, Number(maxPhones) || 1)) { send(session, 'bye', { reason: 'busy' }); return; }
      s = { session, from: sig.from || {}, pc: null, stream: null, phase: 'connecting', since: now(), stall: null };
      sessions.set(session, s);
      changed();
    } else {
      // The same phone again: a reconnect. Keep its place and its pill; rebuild the connection.
      clearStall(s);
      s.stream = null;
    }
    answer(s, sig.sdp).catch((err) => { console.error('phone mic: answer failed', err); end(session, 'failed'); });
  }
  const off = link.onSignal ? link.onSignal(onSignal) : null;

  return {
    phones: list,
    live: () => list().filter((p) => p.phase === 'live'),
    /** The live phones' audio, for amplify or a recogniser that takes a stream. */
    streams: () => [...sessions.values()].filter((s) => s.phase === 'live' && s.stream).map((s) => s.stream),
    stream: () => [...sessions.values()].find((s) => s.phase === 'live' && s.stream)?.stream || null,
    fromOf: (session) => ({ ...(sessions.get(session)?.from || {}) }),
    /** Turn a phone off from the screen. The phone is told, and does not re-offer. */
    stop(session) { if (!sessions.has(session)) return false; send(session, 'bye', { reason: 'stopped' }); return !!end(session, 'screen'); },
    stopAll() { for (const k of [...sessions.keys()]) this.stop(k); },
    destroy() {
      this.stopAll();
      destroyed = true;
      try { off?.(); } catch { /* gone */ }
    },
  };
}

// =========================================================================================
// THE SCREEN'S NOTICE
// =========================================================================================

function ensureStyles(doc) {
  if (!doc || doc.querySelector('link[data-phone-mic-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./phone_mic.css', import.meta.url).href;
    link.setAttribute('data-phone-mic-css', '');
    doc.head.append(link);
  } catch { /* unstyled, still says it */ }
}

/** The words on the pill, from the phone list. Pure. '' when no phone is joined. */
export function micLiveText(phones = []) {
  const on = phones.filter((p) => p.phase === 'live');
  const wait = phones.filter((p) => p.phase !== 'live');
  const names = (ps) => ps.map((p) => p.name || 'A phone').join(', ');
  if (on.length) return `${on.length > 1 ? 'Microphones' : 'Microphone'} on: ${names(on)}`;
  if (wait.length) return `Microphone connecting: ${names(wait)}`;
  return '';
}

/**
 * "Microphone on: <phone>", shown while any phone is joined or joining. Non-modal: no focus,
 * no presses. NO SETTING HIDES IT (see the header).
 */
export function mountMicLiveIndicator(host, {
  receiver = null,
  bus = null,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!host || !doc) throw new Error('mountMicLiveIndicator: a host element is required');
  ensureStyles(doc);
  const el = doc.createElement('div');
  el.className = 'mic-live';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const dot = doc.createElement('span');
  dot.className = 'ml-dot';
  dot.setAttribute('aria-hidden', 'true');
  const word = doc.createElement('span');
  word.className = 'ml-word';
  el.append(dot, word);
  host.append(el);

  function show(phones) {
    const text = micLiveText(phones || []);
    word.textContent = text;
    el.hidden = !text;
    el.dataset.phase = (phones || []).some((p) => p.phase === 'live') ? 'live' : 'connecting';
  }
  show(receiver ? receiver.phones() : []);
  const offBus = bus && typeof bus.subscribe === 'function'
    ? bus.subscribe(PHONE_MIC_TOPIC, (p) => show((p && p.phones) || []))
    : () => {};
  return {
    shown: () => !el.hidden,
    text: () => word.textContent,
    refresh() { show(receiver ? receiver.phones() : []); },
    destroy() { try { offBus(); } catch { /* gone */ } el.remove(); },
  };
}
