// camera_owner.js — the camera ARBITER. Single owner, many consumers.
//
// Ported from Cici's `CiciCamera`, which has been running at the bedside since July, and
// built for the same reason the audio bus was: ***THERE IS ONE DEVICE AND SEVERAL THINGS
// THAT WANT IT.*** Unlike the speaker, though, the failure here is not "everything plays at
// once" — on Linux/V4L2 a SECOND `getUserMedia` on the same webcam FAILS outright ("Could not
// start video source") or steals the device from whoever had it.
//
// *** SO THIS IS A STRICT SINGLE OWNER, NOT A DUCKING ARBITER. *** The audio bus lets several
// sources sound at different levels because a mixer can sum them. A camera cannot be summed.
// Exactly one place opens the device; everybody else ACQUIRES the already-open stream and
// RELEASES it when done, and the device stops only when the LAST consumer lets go.
//
// ---------------------------------------------------------------------------------------
// *** THE TWO CONSUMERS ARE A SCREEN AND A NETWORK, NOT TWO PANELS. ***
// ---------------------------------------------------------------------------------------
// An earlier version of this comment said the point was stopping a call from darkening her
// mirror, as though a call would put a SECOND view of her camera on the screen. Mike, 2026-08-29:
// *"there's only need to have one web camera showing on the screen at any time … there's no need
// to have that same camera on two windows in the call kiosk."* He is right, and the real shape is
// simpler: DURING A CALL THE MIRROR **IS** THE SELF-VIEW. The kiosk already has the layout for
// it - `k-stage` for the caller, `k-mirror` as a picture-in-picture, top-right by default - so a
// call swaps the stage and leaves her camera exactly where it already was.
//
// So the two things wanting one capture are:
//   * the LOCAL <video> — the mirror PiP, the one picture of her on the screen;
//   * the OUTGOING TRACK — what the caller sees, which is not on this screen at all.
//
// `acquireTrack` still earns its place, and now for the honest reason: the peer connection needs
// a track it can stop at hangup WITHOUT stopping the capture the PiP is still showing. A clone
// shares the source and dies on its own.
//
// It also covers the HANDOFF. A panel showing the camera is unmounted while another mounts, and
// without a ref count and a grace window that is a stop racing an open - which on V4L2 is
// "could not start video source", i.e. a black rectangle at the exact moment a call connects.
//
// A GRACE PERIOD BEFORE THE DEVICE ACTUALLY STOPS, because a panel being destroyed and
// immediately re-created is ordinary (a hidden tab's DOM gets detached), and without it every
// remount is a visible getUserMedia flash on a screen somebody is watching.
//
// A FAILED OPEN MUST NOT LEAK ITS REF. Otherwise the count never reaches zero and the device,
// once a working consumer opens it, can never be released — the camera stays lit forever on a
// machine that is on 24/7.
//
// Injectable `open` and timers, so all of this is testable with no camera and no clock.

export const GRACE_MS = 1500;

export function createCameraOwner({
  // The actual getUserMedia. Injected so this file knows nothing about constraints, and so a
  // test can hand it a fake device.
  open = (opts) => navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: opts.width }, height: { ideal: opts.height },
      frameRate: { ideal: opts.fps },
      ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
    },
    audio: false,
  }),
  graceMs = GRACE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let stream = null;        // the ONE underlying MediaStream
  let opening = null;       // in-flight open, so concurrent acquires dedupe onto one call
  let closeTimer = null;
  const refs = new Set();   // consumer ids
  let opts = { width: 640, height: 480, fps: 30, deviceId: null };

  const refCount = () => refs.size;

  function live() {
    if (!stream) return false;
    const vt = stream.getVideoTracks?.()[0];
    return !!(vt && vt.readyState === 'live');
  }

  function stopDevice() {
    if (!stream) return;
    try { stream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    stream = null;
  }

  function cancelClose() {
    if (closeTimer != null) { clearTimer(closeTimer); closeTimer = null; }
  }

  function reallyClose() {
    closeTimer = null;
    if (refCount()) return;          // somebody re-acquired inside the grace window
    stopDevice();
  }

  function ensure() {
    cancelClose();
    if (live()) return Promise.resolve(stream);
    if (opening) return opening;
    opening = Promise.resolve(open({ ...opts })).then((s) => {
      opening = null;
      // Everyone let go while we were opening. Do not leak the device.
      if (refCount() === 0) {
        try { s.getTracks().forEach((t) => t.stop()); } catch { /* fine */ }
        throw new Error('camera released during open');
      }
      stream = s;
      return s;
    }, (err) => { opening = null; throw err; });
    return opening;
  }

  const api = {
    // Capture options. Only bite on the NEXT open — while the device is live the first
    // acquirer's configuration wins, because re-negotiating a running camera under somebody
    // watching it is worse than a slightly wrong frame rate.
    configure(o) { if (o) for (const [k, v] of Object.entries(o)) if (v != null) opts[k] = v; },

    /** The SHARED stream, ref-counted. Several <video> elements may point at it — that is the
     *  entire point. Returns a Promise<MediaStream>. */
    acquire(id, seed) {
      if (!id) return Promise.reject(new Error('camera acquire needs a consumer id'));
      if (seed && !live() && !opening) api.configure(seed);
      refs.add(id);
      cancelClose();
      return ensure().catch((err) => {
        // Drop the ref before re-throwing — see the header. A leaked ref pins the camera on.
        api.release(id, true);
        throw err;
      });
    },

    /** An independent CLONE of the video track, for an RTCPeerConnection — i.e. for the
     *  OUTGOING half of a call, which is not on this screen at all.
     *  Same source, no second getUserMedia, and stopping the clone at hangup leaves the
     *  capture running for the picture-in-picture that is still showing it. */
    acquireTrack(id, seed) {
      return api.acquire(id, seed).then((s) => {
        const vt = s.getVideoTracks?.()[0];
        return vt ? vt.clone() : null;
      });
    },

    /** Release a consumer. The device stops only when the LAST one lets go, after the grace
     *  period. A consumer that stopped a cloned track MUST still release — the clone and the
     *  ref count are separate things. */
    release(id, immediate = false) {
      refs.delete(id);
      if (refCount()) return;
      cancelClose();
      if (immediate) reallyClose();
      else closeTimer = setTimer(reallyClose, graceMs);
    },

    isLive: live,
    consumers: () => [...refs],
    // For a diagnostic surface: "her mirror and a call are both using it" is a sentence
    // somebody can act on; "the camera is busy" is not.
    state: () => ({ live: live(), opening: !!opening, consumers: [...refs],
                    closing: closeTimer != null }),
    destroy() { cancelClose(); refs.clear(); stopDevice(); },
  };
  return api;
}
