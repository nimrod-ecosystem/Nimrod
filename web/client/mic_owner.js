// mic_owner.js — THE MICROPHONE ARBITER. One microphone, ref-counted, one owner.
//
// The twin of `camera_owner.js`, and it exists for the same technical reason — a second
// `getUserMedia` on the same device fails outright on Linux — plus one the camera does not have:
//
//   *** TWO CONSUMERS OF A LIVE MICROPHONE IS A PRIVACY EVENT, NOT A RESOURCE CONFLICT. ***
//
// A single owner is also the only thing in the system that can honestly answer *"is anything
// listening right now?"* — and on a screen that sits in somebody's room, that question deserves
// an answer that is computed rather than assumed. `listening()` is that answer.
//
// ---------------------------------------------------------------------------------------
// A MICROPHONE IS A DEVICE LIKE ANY OTHER DEVICE (Mike, 2026-08-30)
// ---------------------------------------------------------------------------------------
//
// An earlier draft of this design leant on one person's situation — a spare phone by the bed,
// because a phone hears better than a webcam across a room. Mike's correction:
//
//   *"It should be a device like any other device… they should be able to use whatever
//    microphone they want and whatever input. She's just kind of an edge case."*
//
// He is right, and it is the same mistake this project has made before: taking the case of the
// person it was built for and promoting it to the shape of the product. **The general feature is
// "choose your microphone."** A webcam's built-in mic, a USB mic on the desk, a headset, and
// later a paired phone are all just entries in a list, and none of them is the centre.
//
// So: this file enumerates whatever the machine has, remembers which one was chosen, and knows
// nothing at all about phones.
//
// ---------------------------------------------------------------------------------------
// *** THE HARD PART, AND IT IS NOT THE PART THAT LOOKS HARD ***
// ---------------------------------------------------------------------------------------
//
// This is NOT the camera arbiter with `audio: true`. A camera has one sensible configuration.
// A microphone has three processing switches — echo cancellation, noise suppression, automatic
// gain control — and **the settings that make a CALL sound good are the wrong ones for
// RECOGNITION**:
//
//   * A call wants all three ON. That is what stops a room echoing and a fan roaring.
//   * A recogniser wants them OFF, and noise suppression especially. Suppression is tuned to
//     keep confident, typical speech and discard the rest — which is a fair description of
//     exactly the quiet, effortful, atypical articulation a recogniser most needs to hear.
//
// One `MediaStream` has one set of constraints, so these cannot both be satisfied from a single
// open. Three options, and the choice is deliberate:
//
//   1. First acquirer wins, silently — what the camera does. Fine for a frame rate. Not fine
//      here: the loser gets a stream that will quietly make it fail, with nothing to say why.
//   2. Re-open with new constraints when a second consumer arrives. Drops the first consumer's
//      audio mid-call. No.
//   3. **Open RAW by default, and TELL a consumer when the live stream is not what it asked
//      for.** This is what is implemented.
//
// Raw is the right default because the damage is one-directional: a call can apply its own
// echo cancellation downstream (WebRTC does), and a bit of room noise on a call is survivable —
// whereas a recogniser cannot recover articulation that noise suppression has already removed.
// **You can always degrade a clean signal; you cannot restore a processed one.**
//
// And when a consumer's needs are not met, `acquire` still returns the stream but reports the
// mismatch, so the caller can say so out loud instead of behaving strangely. Silence is the one
// answer that is never right here.

import { describePick, watchDevices } from './device_pick.js';

export const GRACE_MS = 1500;

// The three processing switches, named once so nothing has to remember the browser's spelling.
export const PROCESSING = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];

// What each kind of consumer wants. Exported as DATA so a diagnostic can explain a mismatch in
// words rather than in constraint objects.
export const PROFILES = {
  // Untouched audio. Anything that is going to ANALYSE speech wants this.
  raw: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  // Cleaned up for a human ear at the other end of a call.
  call: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

// Does the live stream give this consumer what it needs? Pure, so the rule is testable and so
// the wording of a warning has one home.
export function mismatch(wanted, live) {
  if (!wanted || !live) return [];
  return PROCESSING.filter((k) => wanted[k] != null && live[k] != null && !!wanted[k] !== !!live[k]);
}

export function createMicOwner({
  // The real `getUserMedia`, injected so this file knows nothing about constraints and a test
  // needs no hardware.
  open = (opts) => navigator.mediaDevices.getUserMedia({
    audio: {
      ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
      echoCancellation: !!opts.echoCancellation,
      noiseSuppression: !!opts.noiseSuppression,
      autoGainControl: !!opts.autoGainControl,
    },
    video: false,
  }),
  // Enumerating is separate from opening because on every browser it returns EMPTY LABELS until
  // permission has been granted at least once. A chooser that shows "Microphone 1, Microphone 2,
  // Microphone 3" is not a chooser, so a caller needs to know to ask for permission first —
  // `labelled()` below is how it finds out, rather than by guessing.
  enumerate = () => navigator.mediaDevices.enumerateDevices(),
  graceMs = GRACE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = null,               // called whenever anything starts or stops listening
  // *** THE FALLBACK LADDER (Mike, 2026-08-30). *** An ORDERED list of device ids, best first,
  // rather than one id — because the best microphone is often the one that is only there
  // sometimes. A phone a visitor brings into the room hears far better than a webcam across it,
  // and it leaves when they do; neither of those should require anybody to change a setting.
  //
  // For most software a microphone disappearing is a degraded experience. For somebody whose
  // only route to being understood runs through it, it is being cut off — which is why this
  // resolves automatically and, when it lands anywhere but the top of the list, SAYS SO.
  preferred = () => [],
  // Told what happened, in words. The caller decides the verb and the routing; this file does
  // not own an output bus. `null` from `describePick` means there is no news, and no news is
  // said out loud — a fallback that chatters every time the hardware twitches gets ignored,
  // and then the one that mattered gets ignored with it.
  onFallback = null,
  // Passed through to the device watcher. A GETTER, because `navigator.mediaDevices` does not
  // exist on an insecure origin and reading it eagerly throws — the same trap this file already
  // fell into once with `enumerate`.
  target = () => (typeof navigator !== 'undefined' ? navigator.mediaDevices : null),
} = {}) {
  let stream = null;
  let opening = null;
  let closeTimer = null;
  let liveOpts = null;            // the constraints the live stream was actually opened with
  const refs = new Map();         // consumer id -> what that consumer asked for
  let opts = { deviceId: null, ...PROFILES.raw };

  const live = () => !!stream;
  const announce = () => { try { onChange?.(api.status()); } catch (err) { console.error('mic onChange', err); } };

  function cancelClose() { if (closeTimer != null) { clearTimer(closeTimer); closeTimer = null; } }

  function closeNow() {
    closeTimer = null;
    if (refs.size) return;                       // somebody re-acquired inside the grace window
    if (stream) {
      for (const t of stream.getTracks()) { try { t.stop(); } catch { /* already stopped */ } }
    }
    stream = null; liveOpts = null;
    announce();
  }

  function ensure() {
    if (stream) return Promise.resolve(stream);
    if (opening) return opening;
    const asked = { ...opts };
    opening = Promise.resolve(open(asked)).then((s) => {
      opening = null;
      if (!refs.size) {                          // released while it was opening
        for (const t of s.getTracks()) { try { t.stop(); } catch { /* noop */ } }
        throw new Error('microphone released during open');
      }
      stream = s; liveOpts = asked;
      announce();
      return s;
    }).catch((err) => { opening = null; throw err; });
    return opening;
  }

  let watcher = null;
  function ensureWatcher() {
    if (!watcher) {
      watcher = watchDevices({
        list: () => api.list(),
        preferred,
        target,
        // Re-choosing on a hardware change is the "know when to go to the fallback" half. It
        // fires when the good microphone LEAVES and when it comes back, because somebody
        // walking into the room should restore the better device without touching anything.
        // APPLY ALWAYS, SPEAK ON CHANGE. Two rates, one callback — see the note on `onPick`
        // in device_pick.js for why they are not the same thing.
        onPick: (res, before, changed) => {
          if (res.id) api.configure({ deviceId: res.id });
          if (!onFallback || !changed) return;
          const said = describePick(res, { kind: 'microphone' });
          if (said) { try { onFallback(said, res); } catch (err) { console.error('mic onFallback', err); } }
        },
      });
    }
    return watcher;
  }

  const api = {
    // Re-read what is plugged in and choose from the person's ordered list. Called on `start`,
    // and again whenever the hardware changes.
    //
    // *** IT ONLY CHANGES THE DEVICE FOR THE **NEXT** OPEN. *** Swapping the microphone out
    // from under a call in progress to "improve" it would cut somebody off mid-sentence, which
    // is the exact harm this ladder exists to prevent. A better device that appears during a
    // call is used by the next one.
    // *** ONE ANNOUNCEMENT POINT, AND ONLY ONE. ***
    // The first version reported the change here AND in the watcher's `onPick`, so every
    // fallback was announced twice — the same "two things reporting one event" mistake the
    // heartbeat work ran into, in a different costume. Two announcers can also disagree, which
    // is worse than saying it twice. `onPick` below is the only place that speaks; this just
    // asks for a re-pick and hands back the answer.
    async choose() { return ensureWatcher().repick(); },

    /** Which device the ladder settled on, and why — for a panel that has to explain itself. */
    chosen: () => watcher?.current?.() || null,

    // Only bites on the NEXT open. Re-negotiating a live microphone under a call in progress is
    // worse than a slightly wrong gain — the same rule the camera arbiter states, for the same
    // reason.
    configure(o) { if (o) for (const [k, v] of Object.entries(o)) if (v != null) opts[k] = v; },

    /** The shared stream, ref-counted.
     *
     *  `want` is a PROFILES entry (or any subset of the switches). The stream comes back either
     *  way; `api.status().mismatch` says whether it is the audio this consumer asked for, so a
     *  recogniser handed a noise-suppressed stream can SAY SO rather than quietly doing badly.
     */
    acquire(id, want = null) {
      if (!id) return Promise.reject(new Error('mic acquire needs a consumer id'));
      if (want && !live() && !opening) api.configure(want);
      refs.set(id, want ? { ...want } : null);
      cancelClose();
      announce();
      return ensure().catch((err) => {
        // Drop the ref before re-throwing. A leaked ref pins the microphone on, which on this
        // device is not merely wasteful.
        refs.delete(id);
        announce();
        throw err;
      });
    },

    release(id, immediate = false) {
      if (!refs.delete(id)) return;
      announce();
      if (refs.size) return;
      cancelClose();
      // A grace window, so swapping one consumer for another does not blink the device — and,
      // more importantly here, does not flash the browser's recording indicator off and on in
      // a way that makes it impossible to tell what is happening.
      if (immediate || !graceMs) closeNow();
      else closeTimer = setTimer(closeNow, graceMs);
    },

    /** *** THE QUESTION A ROOM DESERVES AN ANSWER TO. *** Computed, never assumed. */
    listening: () => live(),

    status() {
      const consumers = [...refs.keys()];
      const worst = [];
      for (const [id, want] of refs) {
        const bad = mismatch(want, liveOpts);
        if (bad.length) worst.push({ id, wanted: want, missing: bad });
      }
      return {
        listening: live(),
        consumers,
        opened: liveOpts ? { ...liveOpts } : null,
        mismatch: worst,
      };
    },

    /** Every microphone this machine has.
     *
     *  BOTH FAILURE SHAPES ARE CAUGHT, and the synchronous one is not hypothetical: on an
     *  INSECURE ORIGIN there is no `navigator.mediaDevices` at all, so `enumerate()` throws a
     *  TypeError before it ever returns a promise. That is precisely the case somebody hits
     *  running this over plain http on a LAN — which, for a device you point a phone or a Pi
     *  at, is the normal way to try it. A `.catch()` on the promise would not have seen it. */
    async list() {
      let all = [];
      try { all = await Promise.resolve(enumerate()); } catch { all = []; }
      return (all || [])
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ id: d.deviceId, label: d.label || '' }));
    },

    /** Whether the labels are real yet. Empty labels mean permission has never been granted,
     *  and a chooser showing "Microphone 1, Microphone 2" is worse than no chooser at all. */
    async labelled() {
      const list = await api.list();
      return list.length > 0 && list.every((d) => !!d.label);
    },

    destroy() { cancelClose(); refs.clear(); closeNow(); watcher?.stop?.(); watcher = null; },
  };

  return api;
}
