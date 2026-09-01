// input_marker.js — A BRIGHTLY COLORED MARKER, WATCHED BY THE CAMERA, as a device on the aim.
//
// The sibling of `input_pointer.js`: that file is a mouse or a head pointer, this one is a
// colored object somebody can move. Both end at the same place — `aim.js` — and nothing
// downstream can tell them apart, which is the entire point of that seam.
//
// ---------------------------------------------------------------------------------------
// WHY A SOCK BEATS A SKELETON, and this is not a shortcut — it is the finding
// ---------------------------------------------------------------------------------------
//
// The obvious way to do this is a pose or hand model: MediaPipe, landmarks, a skeleton. That
// was tried on the bedside build first (`Cici/dashboard_web/modules/cici_color.js` records
// it) and it failed in the room, for three reasons that are all specific to the person it is
// for and none of which are obvious from a desk:
//
//   * DROP FOOT gives atypical geometry, and a pose model is looking for a typical foot.
//   * BlazePose's foot landmarks are its least reliable ones to begin with.
//   * A pale foot against a white hospital sheet has almost no contrast for anything to find.
//
// Mike's fix was not a better model. It was: **have her wear a brightly colored sock.** Put a
// marker on the person and the problem stops being recognition and becomes arithmetic — find
// the saturated green pixels, take their centroid. And the consequences are large:
//
//   * IT IS ~5x FASTER. A per-pixel threshold on a downscaled frame runs about 30 fps on a
//     Pi 400 against roughly 6 fps for hand landmarks. For a cursor somebody is trying to
//     steer that is not a tuning detail, it is the difference between control and lag — and
//     it compounds, because smoothing at 6 fps feels far worse than the same smoothing at 30.
//   * IT NEEDS NO MODEL FILE. Nothing to vendor, nothing to download, nothing to point at a
//     folder. About 30 MB of MediaPipe and its `.task` files buy worse results here.
//   * IT IS MARKER-GENERAL. The sock can be on a foot, a hand, a wrist, a glove — wherever
//     that particular person has movement they can control. A hand model can only find hands.
//
// So this is the tracker to ship first, and a landmark model is the LATER, heavier option for
// somebody who cannot wear a marker.
//
// ---------------------------------------------------------------------------------------
// CALIBRATION IS SAMPLED, NOT PRESET
// ---------------------------------------------------------------------------------------
//
// There is no built-in "green". A caregiver points the camera, clicks the sock in a live
// preview, and that pixel's hue becomes the target — which self-calibrates to the actual sock
// and the actual lighting in that actual room, with nothing to configure and no repositioning.
// `sampleAt()` is that click. Until it has been called, this device reports nothing at all:
// guessing a hue would mean the cursor chasing whatever happened to be orange in the room.
//
// Bright and SATURATED works; green and hot pink work best. Red is close to skin and white,
// gray and pastels have no hue to lock onto — which is what `satMin` is rejecting.
//
// ---------------------------------------------------------------------------------------
// OFF BY DEFAULT, AND STORED PER PERSON
// ---------------------------------------------------------------------------------------
//
// The bedside build stores these per DEVICE, in localStorage, and its reasoning is good: gain,
// rest point and color sample are properties of one room and one chair rather than of an
// account. This project stores them PER PERSON anyway, next to their input bindings, and the
// deciding fact is local — the two Pis get physically swapped, so per-device storage would lose
// the calibration on every swap and somebody would redo the sock in the room with her waiting.
// The trade is written up in `marker_panel.js`. Nothing here depends on the choice: this file
// only reads a `settings` getter and never learns where it came from.

import { viewportAim } from './aim.js';

export const MARKER_DEVICE = 'marker:color';

// Detection runs on a DOWNSCALED frame. 160x120 is 19,200 pixels a tick instead of 307,200 at
// 640x480 — sixteen times less work for a centroid that is just as accurate, because a sock is
// enormous at this scale and its middle does not move when you blur it.
export const DET_W = 160;
export const DET_H = 120;

export const MARKER_DEFAULTS = {
  // Every number below is the value the bedside build was tuned to in the room, not a guess.
  gain: 3.0,        // how far the cursor travels for a given marker movement
  smooth: 0.25,     // EMA per processed frame. Lives HERE, not in aim.js — a noisy detector
                    // needs it and a mouse would only be made laggy by it.
  hueTol: 20,       // +/- degrees of hue that count as a match
  satMin: 0.35,     // reject washed-out pixels: skin, a white sheet, a pale wall
  valMin: 0.25,     // reject near-black, which has an unstable hue
  minPx: 18,        // matched pixels needed before we believe it. Below this it is noise, and
                    // reporting noise as an aim would make the cursor twitch across the room.
  color: null,     // the sampled target {h, s, v}. null = not calibrated; report nothing.
  center: null,     // the calibrated REST point in frame coords; null = the middle of the frame
};

// *** SHOULD THE CAMERA BE ON? *** Extracted from the kiosk and exported, because the answer
// decides whether a webcam lights up in somebody's room and that is not a rule to leave buried
// in a shell where nothing can test it.
//
// TWO conditions, and the second is the one that is easy to forget: `enabled` alone is not
// enough, because an ENABLED BUT UNCALIBRATED tracker can never report anything — it has no
// color to look for — so starting it would open the camera to do nothing at all, forever. That
// is the worst combination available: all of the intrusion, none of the function.
export function shouldTrack(saved) {
  const s = saved || {};
  return !!s.enabled && !!s.color;
}

// ---------------------------------------------------------------------------------------
// Pure color maths. Exported because they are the part worth testing directly, and because
// the settings panel needs the same conversion to draw a swatch of what was sampled.
// ---------------------------------------------------------------------------------------

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

// Hue is a circle, so 350° and 10° are twenty degrees apart, not three hundred and forty.
// Getting this wrong makes red the one color that never matches itself.
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Find the marker in one frame. `frame` is anything shaped like ImageData — {data, width,
// height} — so a test can hand it an array it built by hand and no camera is involved.
//
// Returns { count, x, y } with x and y NORMALIZED to the frame (0..1), or { count: 0 } when
// there is nothing convincing. The caller decides what "convincing" means via `minPx`; this
// reports the count either way, because "I can see 3 pixels of it" and "I can see none" are
// different sentences for whoever is trying to get the camera pointed right.
export function findMarker(frame, target, {
  hueTol = MARKER_DEFAULTS.hueTol,
  satMin = MARKER_DEFAULTS.satMin,
  valMin = MARKER_DEFAULTS.valMin,
  onPixel = null,          // called for each matched pixel index — the preview's highlight
} = {}) {
  if (!frame || !frame.data || !target) return { count: 0 };
  const { data, width, height } = frame;
  if (!width || !height) return { count: 0 };
  let sx = 0, sy = 0, count = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (hsv.s >= satMin && hsv.v >= valMin && hueDistance(hsv.h, target.h) <= hueTol) {
      sx += p % width;
      sy += (p / width) | 0;
      count++;
      if (onPixel) onPixel(i);
    }
  }
  if (!count) return { count: 0 };
  return { count, x: (sx / count) / width, y: (sy / count) / height };
}

// Where the marker is in the frame -> where the aim is on screen.
//
// *** X IS MIRRORED AND Y IS NOT, AND THAT IS NOT A BUG. *** A camera pointed at somebody is a
// mirror: she moves her foot to HER left and it travels right across the frame. Un-mirroring x
// is what makes the cursor go the way she pushed. Up is up in both, so y is left alone.
//
// Movement is measured from a REST POINT rather than from the frame's middle, so the useful
// range is centerd on wherever she actually holds still — which for somebody with limited
// range is the difference between reaching the whole screen and reaching a corner of it.
export function markerAim(found, {
  center = null,
  gain = MARKER_DEFAULTS.gain,
} = {}) {
  if (!found || !found.count) return null;
  const c = center || { x: 0.5, y: 0.5 };
  return {
    x: Math.min(1, Math.max(0, 0.5 + (c.x - found.x) * gain)),
    y: Math.min(1, Math.max(0, 0.5 + (found.y - c.y) * gain)),
  };
}

// ---------------------------------------------------------------------------------------
// The runtime.
// ---------------------------------------------------------------------------------------
//
// EVERYTHING IS INJECTED, so the whole thing runs against hand-built frames with no camera,
// no canvas and no clock. That is not only for tests: it is also what lets the settings panel
// feed it a still image, and what will let a landmark-based detector reuse the mapping and the
// smoothing by handing in a different `detect`.
export function createMarkerTracker({
  aim,
  // The camera arbiter, NOT `getUserMedia`. A second open of the same webcam fails outright on
  // Linux, and her mirror going dark because a tracker started is precisely the failure that
  // arbiter exists to prevent. See camera_owner.js.
  cameraOwner = null,
  device = MARKER_DEVICE,
  // A getter, so a caregiver changing the gain takes effect on the next frame rather than on
  // the next remount.
  settings = () => ({}),
  // Hand in frames yourself (tests, a still image) instead of running a camera.
  frames = null,
  // Called every tick with the frame and what was found in it. This is what the calibration
  // panel draws — and it is a callback rather than the panel scanning for itself so there is
  // exactly ONE detection per frame. Two would be wasteful and, worse, could disagree: a
  // preview showing a match while the tracker reports none is a caregiver debugging a lie.
  onFrame = null,
  documentRef = (typeof document !== 'undefined' ? document : null),
  requestFrame = (fn) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
  cancelFrame = (id) => (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame(id) : clearTimeout(id)),
} = {}) {
  if (!aim) throw new Error('createMarkerTracker: an aim is required');

  const cfg = () => ({ ...MARKER_DEFAULTS, ...(settings() || {}) });

  let running = false;
  let rafId = 0;
  let video = null, canvas = null, c2d = null;
  let smoothed = null;              // the EMA state, in aim space
  let lastFound = { count: 0 };
  let destroyed = false;

  // One tick. Exported through the returned object so a test can step it deliberately rather
  // than racing a frame loop.
  function step(frame) {
    const c = cfg();
    if (!c.color) {
      lastFound = { count: 0 };
      // The preview still runs with no color sampled — that is the state a caregiver is in
      // BEFORE they have clicked the sock, and it is the moment they most need to see the
      // picture in order to point the camera at all.
      if (onFrame) { try { onFrame(frame, lastFound, null); } catch { /* never fatal */ } }
      return null;
    }
    const mask = onFrame ? new Uint8ClampedArray(frame.data.length) : null;
    const found = findMarker(frame, c.color, {
      hueTol: c.hueTol, satMin: c.satMin, valMin: c.valMin,
      onPixel: mask ? (i) => { mask[i] = 57; mask[i + 1] = 211; mask[i + 2] = 83; mask[i + 3] = 200; } : null,
    });
    lastFound = found;
    if (onFrame) { try { onFrame(frame, found, mask); } catch { /* never fatal */ } }
    if (found.count < c.minPx) return null;      // seen, but not convincingly. Say nothing.

    const target = markerAim(found, { center: c.center, gain: c.gain });
    if (!target) return null;

    // SMOOTHING LIVES HERE. `aim.js` deliberately has none, because a mouse does not want any
    // — see the note in that file. A camera does: the centroid of a threshold jitters by a
    // pixel or two every frame even when nothing has moved, and unsmoothed that is a cursor
    // that shivers, which is horrible to look at and impossible to dwell with.
    const a = Math.min(1, Math.max(0.01, Number(c.smooth) || MARKER_DEFAULTS.smooth));
    smoothed = smoothed
      ? { x: smoothed.x + (target.x - smoothed.x) * a, y: smoothed.y + (target.y - smoothed.y) * a }
      : target;                                   // the first sighting snaps; there is nothing to smooth from

    aim.report(device, smoothed.x, smoothed.y);
    return { ...smoothed };
  }

  // Sample the color under a point, given as 0..1 of the frame. This is the caregiver
  // clicking the sock. Averaged over a small patch rather than one pixel, because one pixel of
  // a compressed webcam frame is a lie — JPEG artefacts alone can move a hue by ten degrees.
  function sampleAt(frame, nx, ny, { radius = 3 } = {}) {
    if (!frame?.data || !frame.width) return null;
    const { data, width, height } = frame;
    const cx = Math.round(nx * (width - 1));
    const cy = Math.round(ny * (height - 1));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
        const i = (y * width + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    if (!n) return null;
    return rgbToHsv(r / n, g / n, b / n);
  }

  function grabFromVideo() {
    if (!video || !c2d || !video.videoWidth) return null;
    c2d.drawImage(video, 0, 0, DET_W, DET_H);
    return c2d.getImageData(0, 0, DET_W, DET_H);
  }

  function loop() {
    if (!running || destroyed) return;
    try {
      const frame = frames ? frames() : grabFromVideo();
      if (frame) step(frame);
    } catch (err) {
      // A tracker that throws must not take the screen with it, and must not stop trying:
      // a camera glitch at boot taking a nonverbal person's only input away for the day is
      // worse than a noisy console.
      console.error('marker tracker: frame', err);
    }
    rafId = requestFrame(loop);
  }

  async function start() {
    if (running || destroyed) return false;
    if (!frames) {
      if (!cameraOwner) throw new Error('createMarkerTracker: needs a cameraOwner or a frames source');
      const stream = await cameraOwner.acquire(`tracker:${device}`);
      video = documentRef.createElement('video');
      video.muted = true; video.playsInline = true; video.autoplay = true;
      video.srcObject = stream;
      // Off-screen but REAL: a video that is `display:none` is allowed to stop decoding in
      // some browsers, and a detector reading a frozen frame reports a marker that is not
      // there any more.
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:240px';
      documentRef.body.append(video);
      await video.play().catch(() => {});
      canvas = documentRef.createElement('canvas');
      canvas.width = DET_W; canvas.height = DET_H;
      c2d = canvas.getContext('2d', { willReadFrequently: true });
    }
    running = true;
    smoothed = null;
    rafId = requestFrame(loop);
    return true;
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId) { cancelFrame(rafId); rafId = 0; }
    smoothed = null;
    if (video) {
      try { video.pause(); } catch { /* already gone */ }
      video.srcObject = null;
      video.remove();
      video = null;
    }
    canvas = null; c2d = null;
    try { cameraOwner?.release(`tracker:${device}`); } catch { /* already released */ }
  }

  return {
    start, stop, step, sampleAt,
    isRunning: () => running,
    // WHAT IT CAN SEE RIGHT NOW, for the calibration panel. `count` is the honest number even
    // when it is below `minPx`, because "I can see a bit of it" and "I can see none of it" want
    // completely different advice: move the camera, versus sample the color again.
    found: () => ({ ...lastFound }),
    at: () => (smoothed ? { ...smoothed } : null),
    destroy() { destroyed = true; stop(); },
  };
}

// Convenience for a producer that already has viewport pixels rather than a frame — a head
// pointer reported by something else, a remote driver. Re-exported so callers do not have to
// import from two files to write one producer.
export { viewportAim };
