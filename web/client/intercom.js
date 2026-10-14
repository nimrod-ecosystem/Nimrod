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
//      fails closed. Getting onto the drive socket at all still needs a grant (since 2026-10-14 a call-only
//      one does too), so an intercom caller is somebody with a grant AND allowed the intercom. (2026-10-13/14:
//      "the list" is now "May use the intercom" - see HANDLED LIKE A CALL below.)
//   2. THE ROOM IS TOLD FIRST. Before any microphone opens, the room hears a chime and (by default) the
//      caller's name is said, and the screen shows "Intercom opening: <name>" for `warnMs`. Only
//      then is the room's microphone opened. The name shown is the one on the APPROVED LIST, not one the
//      phone chose. And ONLY ON ONE SCREEN: the server picks which of the person's screens answers,
//      before anything chimes (CLAIM_MS, drive.py Answerers); the others do nothing.
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
//
// ---------------------------------------------------------------------------------------
// HANDLED LIKE A CALL (Mike, 2026-10-13): "Intercom is handled like a call, with its own permission separate from
// calls; auto answer on by default; sound only by default, video as an option; so any device in someone's household
// can announce something." What that changed, argued:
//   * ITS OWN PERMISSION, CHECKED BY THE SERVER. "May use the intercom" (screen_permissions.js permsFor, the same rule
//     as server/screen_access.may_intercom): the owner's own devices and the guardian set by default, anybody else when
//     ticked (this file's older list `intercomAllowed` still counts). The server now refuses an intercom offer from
//     anybody else before it reaches a screen (app.py); the screen still checks too, by the server's stamp (rule 1).
//     Being able to call gives no intercom, and the intercom gives no call.
//   * AUTO ANSWER ON BY DEFAULT (`intercomAutoAnswer`) - what it always did: an intercom ANNOUNCES. Off makes it ring
//     like a call instead: "Intercom from <name>" with Answer and Not now, gone by itself after `answerWaitMs` (20 s,
//     inside the phone's own 30 s wait) - nobody answering means it never opened, never a state only a press can leave.
//   * SOUND ONLY BY DEFAULT, VIDEO AS AN OPTION (`intercomVideo`): 'off' (default) - a phone that offers video is
//     answered with sound only, and the room's camera never opens; 'theirs' - the room shows the caller's picture in the
//     notice, its own camera stays off; 'both' - two-way, like a call. Argued: 'theirs' exists because "show me who is
//     announcing" is the common want, and opening a ROOM's camera on an intercom that answers by itself is a bigger
//     step than seeing a face - it is a separate choice, never the default.
//   * THE SCREEN SHOWS WHO IS ANNOUNCING the whole time (rule 3), its picture too when video is on.

import { iceServers, gatheringDone, STALL_MS } from './call_transport.js';
import { newSession as newPhoneSession } from './phone_mic.js';
import { permsFor } from './screen_permissions.js';
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
  // A CALL THAT ARRIVES WHILE AN INTERCOM IS OPEN. (The other direction is settled: a live call makes
  // the intercom busy.) Argued, 2026-09-30:
  //   'ring' (DEFAULT) - the call rings exactly as it would otherwise: named out loud, the usual
  //     countdown, declinable by anybody in the room. If it is ANSWERED, the intercom ends and the
  //     phone is told "the room answered a call"; if it is declined, the intercom carries on.
  //     FOR: an intercom is short, sound-only and easy to reopen with one press; a call is the thing
  //     the screen exists for, and it is the caller who cannot see that the room is busy. A phone
  //     left open on a table (up to the 30-minute limit, or forever at "Never") would otherwise turn
  //     away every family call for that whole time, silently, and the room would never know anybody
  //     rang. AGAINST: somebody mid-sentence on the intercom is cut off when the countdown runs out
  //     and nobody in the room declines.
  //   'busy' - the caller is told the room is busy and nothing rings; the intercom is untouched.
  //     FOR: symmetric with call -> intercom, and nobody is ever cut off. AGAINST: the forgotten-
  //     intercom case above. Right for a household that uses the intercom for long conversations
  //     and would rather the caller try again.
  callDuringIntercom: 'ring',
  // AUTO ANSWER (2026-10-13, Mike: "auto answer on by default"): an intercom announces. Off = it rings like a call.
  autoAnswer: true,
  // With auto answer off: how long "Intercom from <name>" waits for Answer before it goes by itself. 20 s, argued:
  //   the phone gives up at 30 s (createIntercomSender `answerMs`), so the room's question must end first, with time
  //   for the phone to hear why; long enough to reach a button across a room. Not a person's setting: it is bounded
  //   by the phone's own wait, and a menu choice longer than that would be a lie.
  answerWaitMs: 20000,
  // VIDEO (2026-10-13, "sound only by default, video as an option"): 'off' | 'theirs' | 'both' - see the header.
  video: 'off',
});
const CALL_DURING = ['ring', 'busy'];
export const VIDEO_CHOICES = Object.freeze(['off', 'theirs', 'both']);

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
  { key: 'callDuringIntercom', label: 'A call while the intercom is open', kind: 'choice',
    default: INTERCOM_DEFAULTS.callDuringIntercom, level: 'advanced',
    options: [
      { value: 'ring', label: 'Ring as usual - answering it ends the intercom' },
      { value: 'busy', label: 'Tell the caller the room is busy' },
    ],
    note: 'Ringing means a phone left open on the intercom never turns a call away. Busy means nobody on the intercom is cut off.' },
  { key: 'intercomAutoAnswer', label: 'Intercom: answer by itself', kind: 'toggle',
    default: INTERCOM_DEFAULTS.autoAnswer, level: 'standard',
    note: 'On, the intercom announces: the room hears a chime and who it is, then it opens. Off, it waits for Answer, like a call, and goes by itself if nobody answers.' },
  { key: 'intercomVideo', label: 'Intercom: video', kind: 'choice',
    default: INTERCOM_DEFAULTS.video, level: 'standard',
    options: [
      { value: 'off', label: 'Sound only' },
      { value: 'theirs', label: 'Show the caller’s video; this room’s camera stays off' },
      { value: 'both', label: 'Video both ways, like a call' },
    ],
    note: 'Sound only by default. The screen always shows who is on the intercom.' },
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
    callDuringIntercom: CALL_DURING.includes(v.callDuringIntercom) ? v.callDuringIntercom : INTERCOM_DEFAULTS.callDuringIntercom,
    autoAnswer: typeof v.intercomAutoAnswer === 'boolean' ? v.intercomAutoAnswer : INTERCOM_DEFAULTS.autoAnswer,
    video: VIDEO_CHOICES.includes(v.intercomVideo) ? v.intercomVideo : INTERCOM_DEFAULTS.video,
    answerWaitMs: INTERCOM_DEFAULTS.answerWaitMs,
    // The whole row, for "May use the intercom" (screen_permissions.js permsFor): the owner, the guardian set, ticks.
    row: v,
  };
}

/**
 * MAY THIS SENDER USE THE INTERCOM (2026-10-13/14)? Pure. `sig` is the server-stamped offer: `by` (the account),
 * `byOwner` (the server's word that it owns these screens), `byName` (the name the server would show). Returns
 * { account, name } or null. Fails closed: no stamp, no entry. With no row in the options (an older caller of this
 * file), only the older list counts - exactly as before.
 */
export function admitFor(o, sig) {
  const by = sig && typeof sig.by === 'string' && sig.by ? sig.by : null;
  if (!by) return null;
  const listed = admits((o || {}).allowed, by);
  const row = o && o.row;
  if (!row || typeof row !== 'object') return listed;
  const ok = permsFor(row, by, sig.byOwner === true ? by : null).intercom === true;
  if (!ok) return null;
  if (listed) return listed;
  const ent = (Array.isArray(row.screenPeople) ? row.screenPeople : []).find((e) => e && e.account === by);
  const name = (ent && typeof ent.name === 'string' && ent.name.trim())
    || (typeof sig.byName === 'string' && sig.byName.trim()) || (sig.byOwner === true ? 'Your other device' : 'Someone');
  return { account: by, name: String(name).slice(0, 60) };
}

/** An intercom offer must carry sound; video may ride along (the room's `video` setting decides what is shown). */
export function intercomOfferCheck(sdp) {
  const s = String(sdp || '');
  if (!/^m=audio/m.test(s)) return { ok: false, why: 'no-audio' };
  return { ok: true, why: null, video: /^m=video/m.test(s) };
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
  // The server's own refusal of a call offer on an intercom-only socket (2026-10-14), for completeness.
  'not-allowed': 'This account may not do that on this screen.',
  busy: 'The intercom is already open with somebody else.',
  'in-a-call': 'The room is on a call right now. Try the intercom again once the call is over.',
  'room-ended': 'The room ended the intercom.',
  'time-limit': 'The intercom ended itself after its time limit.',
  call: 'The room answered a call, so the intercom ended. Open it again once the call is over.',
  'video-refused': 'The intercom only carries sound.',
  declined: 'The room said not now.',
  unanswered: 'Nobody in the room answered.',
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
  // SEND THIS PHONE'S VIDEO TOO (2026-10-13, "video as an option"). Off by default. The room's own `intercomVideo`
  // decides whether it is shown; a room set to sound only answers with sound only and its camera never opens.
  video = false,
  onState = null,
  onRemote = null,                     // (MediaStream|null) - the room's sound (and picture, if it sends one)
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
    const sendable = (stream.getAudioTracks ? stream.getAudioTracks() : (stream.getTracks?.() || [])).filter((x) => !x.kind || x.kind === 'audio');
    if (video) sendable.push(...(stream.getVideoTracks?.() || []));
    for (const t of sendable) {
      try {
        if (out) out.addTrack?.(t);
        if (typeof pc.addTransceiver === 'function') pc.addTransceiver(t, { direction: 'sendrecv', streams: out ? [out] : [] });
        else pc.addTrack(t, ...(out ? [out] : []));
      } catch (err) { console.error('intercom: add track', err); }
    }
    const mine = pc;
    pc.ontrack = (e) => {
      // Sound only, unless this phone asked for video (then the room's picture, if it sends one, is shown too).
      if (pc !== mine || !e.track || (e.track.kind && e.track.kind !== 'audio' && !(video && e.track.kind === 'video'))) return;
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
      stream = null;
      if (video) {
        // Video asked for: try the camera with the microphone; without a camera, it is sound only (never no intercom).
        try { stream = await getUserMedia({ ...INTERCOM_CONSTRAINTS, video: true }); } catch { stream = null; }
      }
      if (!stream) {
        try { stream = await getUserMedia(INTERCOM_CONSTRAINTS); }
        catch (err) { console.error('intercom: no microphone', err); stream = null; set('no-mic', err?.name || 'denied'); return false; }
      }
      if (state !== 'opening') { release(); return false; }
      if (!video) for (const t of stream.getVideoTracks?.() || []) { try { t.stop(); stream.removeTrack?.(t); } catch { /* gone */ } }
      return offer('asking');
    },
    /** The socket came back mid-intercom: offer again on the SAME session (the room treats it as a reconnect). */
    reconnect() { if (stream && state !== 'ended') { set('reconnecting', 'socket'); return offer('reconnecting'); } return Promise.resolve(false); },
    stop,
    state: () => state,
    reason: () => why,
    micOpen: () => !!stream,
    /** This phone's own picture, when it sends video (for a small self view). */
    local: () => (video && stream && (stream.getVideoTracks?.() || []).length ? stream : null),
    remote: () => remote,
    destroy() { stop('destroyed'); try { off?.(); } catch { /* gone */ } },
  };
}

// =========================================================================================
// THE ROOM'S HALF
// =========================================================================================

const MIC_ID = 'intercom';
const AUDIO_ID = 'intercom';

// ONE SCREEN ANSWERS (Mike's list 2026-09-30 item 7). The phone's offer reaches EVERY screen of the
// person. Before this, two open screens both answered, and the one the phone did not keep sat "open"
// with its room's microphone on for up to 30 s. Now a screen ASKS THE SERVER FIRST (`link.claim`,
// drive.py Answerers): only the screen the server names (`answerer`, you: true) chimes, warns and
// opens its microphone; every other screen does nothing at all - no chime, no notice, no microphone.
//
// WHY BEFORE THE CHIME, not just before the microphone: a loser that chimed "Intercom from Mike" and
// then went quiet would tell a room somebody was coming who never does. The cost is one round trip to
// the server before the chime (tens to a few hundred ms on facility wifi) - inside the 3 s warning it
// changes nothing anybody hears, and at "open straight after the chime" it is smaller than the
// connection setup that follows it anyway.
//
// A SCREEN TOLD `you: false` WHILE IT HOLDS THE SESSION closes it IN THE SAME TASK: the microphone is
// released before the handler returns. That can only happen to a screen that had won and then lost its
// place (its socket dropped, so the server forgot it, and the phone's re-offer went to another screen) -
// see the bound argued in intercom_test.html.
//
// How long to wait for the server's reply before giving up QUIETLY (no chime, nothing opened, the phone
// is not told: it gives up by itself at its 30 s `answerMs`). 5 s, argued: the reply is one round trip
// (well under 1 s on a live socket), so 5 s only ever fires on a socket that is effectively gone - or a
// server too old to know `claim` - and failing closed there is the privacy-safe side. Shorter would turn
// away an intercom on a bad-wifi moment; longer only delays the same "no".
export const CLAIM_MS = 5000;

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
  claimMs = CLAIM_MS,
  // THE ROOM'S CAMERA, only for `intercomVideo: 'both'` (2026-10-13): () => Promise<MediaStreamTrack|null> (the kiosk
  // hands in a clone from its camera owner) and its release. Absent: 'both' behaves as 'theirs' - no camera opens.
  getCamera = null,
  releaseCamera = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = null,
} = {}) {
  if (!link) throw new Error('createIntercomReceiver: a drive link is required');
  // The one session: { session, by, name, phase: 'claiming'|'asking'|'warning'|'open', since, pc, mic, el, timers }.
  // 'claiming' = asking the server whether this screen is the one; nothing has happened in the room,
  // so it is not shown, not listed, and holds nothing. 'asking' (auto answer off, 2026-10-13) = "Intercom from <name>"
  // with Answer / Not now; nothing is open, and it goes by itself after `answerWaitMs`.
  let s = null;
  let destroyed = false;
  const offs = [];
  const claims = new Map();   // session -> a claim waiting for the server's answer

  const list = () => (s && s.phase !== 'claiming'
    ? [{ session: s.session, name: s.name, phase: s.phase, since: s.since, video: !!s.videoStream }] : []);
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
    for (const k of ['warn', 'stall', 'limit', 'ask']) clearT(k);
    // The microphone FIRST: whatever else fails below, the room stops being heard.
    if (was.micHeld) { try { micOwner?.release?.(MIC_ID); } catch { /* gone */ } }
    else if (was.mic) { for (const t of was.mic.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } }
    was.mic = null; was.micHeld = false;
    // ...and the room's camera, if 'both' opened it.
    if (was.cam) { try { was.cam.stop?.(); } catch { /* stopped */ } was.cam = null; try { releaseCamera?.(); } catch { /* gone */ } }
    was.videoStream = null;
    try { was.pc?.close(); } catch { /* closed */ }
    if (was.el) { try { was.el.pause?.(); was.el.srcObject = null; } catch { /* gone */ } }
    try { audio?.setActive?.(AUDIO_ID, false); } catch { /* gone */ }
    s = null;
    // Still only asking the server: nothing was promised to anybody, nothing showed. Say nothing -
    // a "no" from here would reach the phone as THE answer while another screen may be taking it.
    if (was.phase === 'claiming') return true;
    if (tell) send(was.session, 'bye', { reason });
    changed();
    return true;
  }

  // Ask the server whether this screen is the one that answers `session`. Resolves true only on the
  // server's `you: true`; false on its "no", on no reply within `claimMs`, or with no way to ask (a
  // link without `claim`) - IT FAILS CLOSED. One question in flight per session.
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
    try { asked = typeof link.claim === 'function' && link.claim({ purpose: INTERCOM_PURPOSE, session }) === true; }
    catch { asked = false; }
    if (!asked) entry.settle(false);
    return entry.promise;
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
    // VIDEO (2026-10-13): 'off' never shows or sends a picture; 'theirs' shows the caller's; 'both' sends the room's
    // camera too - and only when the phone offered video at all.
    const vopt = sess.wantVideo ? ((options() || {}).video || 'off') : 'off';
    if (vopt === 'both' && !sess.cam && typeof getCamera === 'function') {
      try { sess.cam = await getCamera(); } catch (err) { console.error('intercom: camera', err); sess.cam = null; }
      if (s !== sess) { try { sess.cam?.stop?.(); } catch { /* gone */ } if (sess.cam) { try { releaseCamera?.(); } catch { /* gone */ } } sess.cam = null; return false; }
    }
    pc.ontrack = (e) => {
      if (sess.pc !== pc || !e.track) return;
      if (e.track.kind === 'video') {
        if (vopt === 'off') return;
        sess.videoStream = (e.streams && e.streams[0]) || null;
        changed();
        return;
      }
      if (e.track.kind && e.track.kind !== 'audio') return;
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
    // The offer's video, set by the room's choice. A browser without transceivers (or a test's fake) has none to set.
    for (const t of (typeof pc.getTransceivers === 'function' ? pc.getTransceivers() : []) || []) {
      const kind = t?.receiver?.track?.kind;
      if (kind !== 'video') continue;
      try {
        if (vopt === 'both' && sess.cam) { await t.sender?.replaceTrack?.(sess.cam); t.direction = 'sendrecv'; }
        else if (vopt === 'theirs' || vopt === 'both') t.direction = 'recvonly';
        else t.direction = 'inactive';
      } catch (err) { console.error('intercom: video direction', err); try { t.direction = 'inactive'; } catch { /* fixed */ } }
    }
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    await gatheringDone(pc, { setTimer });
    if (destroyed || s !== sess || sess.pc !== pc) return false;
    send(sess.session, 'answer', { sdp: pc.localDescription?.sdp });
    // AN ANSWER THAT NEVER CONNECTS ENDS. Two screens no longer both answer (the server picks one,
    // CLAIM_MS above), so this is the backstop for the rest: a phone that vanished between offer and
    // answer, a network that never connects. Until 'connected', the stall clock runs - and the notice
    // says "open" the whole time, which errs toward telling the room.
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
    if (sig.kind === 'answerer') {
      // THE SERVER'S PICK. A "no" for the session this screen holds closes it NOW, in this task -
      // the microphone is released before this returns - and tells the phone nothing (it has its
      // answerer). A "yes" or "no" for a claim in flight settles it.
      if (sig.you !== true && s && s.session === session) end('answered-elsewhere', { tell: false });
      claims.get(session)?.settle(sig.you === true);
      return;
    }
    if (sig.kind === 'bye') { if (s && s.session === session) end('phone', { tell: false }); return; }
    if (sig.kind !== 'offer') return;
    const check = intercomOfferCheck(sig.sdp);
    if (!check.ok) { send(session, 'bye', { reason: check.why }); return; }
    const o = options() || intercomOptionsFrom({});
    // "MAY USE THE INTERCOM", BY THE SERVER'S STAMP (admitFor: the owner, the guardian set, the list). Read at every
    // offer, so a person taken off the list cannot reconnect either.
    const entry = admitFor(o, sig);
    if (!entry) {
      if (s && s.session === session) end('not-approved');       // taken off the list mid-intercom
      else send(session, 'bye', { reason: 'not-approved' });
      return;
    }
    if (s && s.session === session) {
      if (s.by !== sig.by) { send(session, 'bye', { reason: 'not-approved' }); return; }
      // A reconnect: the same person, the same session. The room was already told; no second chime.
      // An OPEN one asks the server again before re-answering: if this screen's socket dropped, the
      // server forgot it, and the phone's re-offer may already belong to another screen.
      clearT('stall');
      if (s.phase === 'open') {
        const sess = s;
        const sdp = sig.sdp;
        askServer(session).then((won) => {
          if (destroyed || s !== sess) return null;
          if (!won) { end('answered-elsewhere', { tell: false }); return null; }
          return answer(sess, sdp);
        }).catch((err) => { console.error('intercom: re-answer', err); if (s === sess) end('failed'); });
      } else s.sdp = sig.sdp;            // still asking or still warning: the newest offer is the one used
      return;
    }
    // Two different "no"s, so the phone says the true one: another intercom is open, or the room is on a call.
    if (s) { send(session, 'bye', { reason: 'busy' }); return; }
    if (busy()) { send(session, 'bye', { reason: 'in-a-call' }); return; }
    const sess = { session, by: sig.by, byOwner: sig.byOwner === true, name: entry.name, phase: 'claiming', since: now(), sdp: sig.sdp,
                   wantVideo: !!check.video, videoStream: null, cam: null,
                   pc: null, mic: null, micHeld: false, el: null, warn: null, stall: null, limit: null, ask: null };
    s = sess;
    // NOTHING happens in the room until the server says this screen is the one (CLAIM_MS above).
    askServer(session).then((won) => {
      if (destroyed || s !== sess) return;
      if (!won) { end('answered-elsewhere', { tell: false }); return; }
      if (o.autoAnswer === false) {
        // AUTO ANSWER OFF (2026-10-13): it rings like a call. Nothing opens until Answer; nobody answering ends it by
        // itself after `answerWaitMs` and the phone is told - never a state only a press can leave.
        sess.phase = 'asking';
        sess.since = now();
        changed();
        playChime(o);
        if (o.announce) { try { output?.alert?.(`Intercom from ${entry.name}`, { source: 'intercom' }); } catch { /* optional */ } }
        sess.ask = setTimer(() => { if (s === sess && sess.phase === 'asking') { sess.ask = null; end('unanswered'); } },
          o.answerWaitMs || INTERCOM_DEFAULTS.answerWaitMs);
        return;
      }
      openAfterWarning(sess, o, entry);
    }).catch((err) => { console.error('intercom: claim', err); if (s === sess) end('failed', { tell: false }); });
  }

  function openAfterWarning(sess, o, entry) {
    sess.phase = 'warning';
    sess.since = now();
    changed();
    if (!sess.answeredByHand) {
      playChime(o);
      if (o.announce) { try { output?.alert?.(`Intercom from ${entry.name}`, { source: 'intercom' }); } catch { /* optional */ } }
    }
    const go = () => {
      if (s !== sess) return;
      sess.warn = null;
      answer(sess, sess.sdp).catch((err) => { console.error('intercom: answer', err); if (s === sess) end('failed'); });
    };
    // Somebody pressed Answer: they ARE the room being told, so there is no further wait.
    if (o.warnMs > 0 && !sess.answeredByHand) sess.warn = setTimer(go, o.warnMs);
    else go();
  }

  /** Auto answer off: Answer pressed in the room. */
  function accept() {
    if (!s || s.phase !== 'asking') return false;
    clearT('ask');
    s.answeredByHand = true;
    openAfterWarning(s, options() || intercomOptionsFrom({}), { name: s.name });
    return true;
  }
  offs.push(link.onSignal ? link.onSignal(onSignal) : null);
  if (bus && typeof bus.subscribe === 'function') {
    offs.push(bus.subscribe(INTERCOM_END_TOPIC, (p) => { try { p?.claim?.(); } catch { /* ok */ } end('room-ended'); }));
  }

  return {
    sessions: list,
    open: () => !!s && s.phase === 'open',
    /** Auto answer off (2026-10-13): Answer and Not now on "Intercom from <name>". */
    accept,
    decline() { return !!s && s.phase === 'asking' ? end('declined') : false; },
    /** The caller's picture, when the room's `intercomVideo` shows it (null otherwise). */
    videoStream: () => (s && s.videoStream) || null,
    /** The room ends it: ONE press, from the notice, a switch or a spoken phrase. */
    endAll(reason = 'room-ended') { return end(reason); },
    /** The person's row changed: somebody taken off the list while talking is cut off now, not later. */
    recheck() {
      if (s && !admitFor(options() || {}, { by: s.by, byOwner: !!s.byOwner })) return end('not-approved');
      return false;
    },
    destroy() {
      end('room-ended');
      destroyed = true;
      for (const c of [...claims.values()]) c.settle(false);
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
  if (x.phase === 'asking') return `Intercom from ${x.name}`;
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
  // Auto answer off (2026-10-13): Answer and Not now while it asks. Not now ends it; nobody pressing ends it by itself.
  const yes = doc.createElement('button');
  yes.type = 'button';
  yes.className = 'ic-end ic-answer';
  yes.textContent = 'Answer';
  yes.dataset.icAnswer = '';
  yes.hidden = true;
  const no = doc.createElement('button');
  no.type = 'button';
  no.className = 'ic-end ic-decline';
  no.textContent = 'Not now';
  no.dataset.icDecline = '';
  no.hidden = true;
  // The caller's picture, when the room's intercom video setting shows it (2026-10-13). Muted: the sound plays elsewhere.
  const vid = doc.createElement('video');
  vid.className = 'ic-video';
  vid.muted = true;
  vid.autoplay = true;
  vid.playsInline = true;
  vid.setAttribute('aria-hidden', 'true');
  vid.hidden = true;
  vid.style.cssText = 'display:block;width:12em;max-width:40vw;border-radius:.4em;margin-top:.3em';
  el.append(dot, word, yes, no, btn, vid);
  noticeStack(host, doc).append(el);
  btn.addEventListener('click', () => {
    if (receiver) receiver.endAll('room-ended');
    else bus?.publish?.(INTERCOM_END_TOPIC, {});
  });
  yes.addEventListener('click', () => { receiver?.accept?.(); });
  no.addEventListener('click', () => { receiver?.decline?.(); });
  function show(sessions) {
    const t = intercomText(sessions || []);
    word.textContent = t;
    el.hidden = !t;
    const asking = (sessions || []).some((x) => x.phase === 'asking');
    el.dataset.phase = (sessions || []).some((x) => x.phase === 'open') ? 'open' : asking ? 'asking' : 'warning';
    yes.hidden = !asking || !receiver;
    no.hidden = !asking || !receiver;
    btn.hidden = asking && !!receiver;
    const st = receiver?.videoStream?.() || null;
    if (vid.srcObject !== st) { try { vid.srcObject = st; vid.play?.()?.catch?.(() => {}); } catch { /* no video here */ } }
    vid.hidden = !st || !t;
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
