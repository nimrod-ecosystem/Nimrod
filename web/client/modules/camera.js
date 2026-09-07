// Camera — local self-view / rearview mirror (slice 3b).
//
// The original bedside use case: a webcam as a rearview mirror so a patient whose
// head is turned can see the room and who's coming and going.
//
// HARD INVARIANT — the camera stays on the patient's device. This module is
// `getUserMedia -> <video>` and NOTHING else: it opens NO RTCPeerConnection, makes
// NO network request with frames, and never becomes a source for another device.
// (The later video-call slice may *view* a remote camera, but must never repurpose
// this local one.) The only thing that leaves this module is its config, via the
// per-profile state handle.
//
// Config is portable across devices: the preferred camera is stored by LABEL (a
// concrete deviceId differs per screen), with graceful fallback to the default.

import { registerModule } from '../module.js';

const DEFAULTS = { cameraLabel: '', mirror: true, rotation: 0, fit: 'cover' };

// ---------------------------------------------------------------------------------------
// *** FOUR LIVE SETTINGS AND NO ROW IN THE MENU -- the same shape the clock had. ***
// ---------------------------------------------------------------------------------------
//
// This module read all four, honoured all four, drew its own gear to write them, and declared
// none. `photos.js` records why that is not good enough: on a GRID kiosk the settings menu shows
// no panel settings at all, so a mirror stuck upside down could not be turned back by anybody.
//
// Found by `dev/unread_settings.py`, which lists exactly this shape.
//
// `rotation` IS DECLARED AS A NUMBER, and that is the interesting one. The gear writes it from a
// `<select>`, so it stored the STRING "90" while `DEFAULTS.rotation` is the number `0` -- the
// same type drift `photos.js` had with `intervalSec`, and it says what it costs: *"a setting that
// cannot be compared cannot be applied to a GROUP of panels at once."* `applyTransform` coerces
// with `Number()`, so nothing looked broken; the record was simply wrong about its own type.
const SETTINGS = [
  // ESSENTIAL: whether the picture is the right way up is not decoration on a mirror somebody
  // uses to see who has walked into their room.
  { key: 'mirror', label: 'Mirror the picture', default: true, level: 'essential',
    onLabel: 'Yes \u2014 like a mirror', offLabel: 'No \u2014 as the camera sees it',
    note: 'A mirror is what somebody expects when looking at themselves. Turn it off when the '
      + 'camera is pointed at the room rather than the bed.' },
  { key: 'rotation', label: 'Rotate the picture', kind: 'choice', default: 0, level: 'essential',
    options: [
      { value: 0, label: 'Not at all' },
      { value: 90, label: 'A quarter turn' },
      { value: 180, label: 'Upside down' },
      { value: 270, label: 'Three quarters' },
    ],
    note: 'For a camera that is physically mounted on its side.' },
  { key: 'fit', label: 'How the picture fills the panel', kind: 'choice', default: 'cover',
    level: 'standard',
    options: [
      { value: 'cover', label: 'Fill the panel (edges may be cropped)' },
      { value: 'contain', label: 'Show the whole picture' },
    ] },
  // The live options come from the device, so the row is declared and `settingsChoices` fills it.
  { key: 'cameraLabel', label: 'Which camera', kind: 'choice', default: '', level: 'standard',
    options: [{ value: '', label: 'Default' }] },
];

registerModule(
  // FALLBACK EXPOSURE: a camera device has to be present AND permitted, and a denied
  // permission looks exactly like a broken camera from the room.
  { dependsOn: 'local',
    type: 'camera', title: 'Camera', description: 'A rearview mirror, so they can see who is behind them. The picture never leaves the device.',
    settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    // THE CAMERA ARBITER, when the surface has one. Optional, exactly like `output` and
    // `audio`: a surface without one still gets a working self-view, it just opens the
    // device itself. WITH one, an incoming call can share this capture as a track clone
    // instead of opening its own - which is what stops a call darkening her mirror.
    const cameraOwner = ctx.cameraOwner || null;
    const CAM_ID = `camera:${ctx.instanceId || 'mirror'}`;
    let cfg = { ...DEFAULTS };
    let stream = null;
    let activeSelection;   // the cameraLabel we last started with ('' = default)
    let starting = false;

    const video = () => mount.querySelector('[data-video]');

    // Same rule as photos: a notice over a LIVE picture is a corner chip, not a sheet
    // across the whole mirror. Over a dead camera it stays a full panel, because there is
    // nothing behind it and the message is the only thing to see.
    function setStatus(text, showRetry = false) {
      const st = mount.querySelector('.stage');
      const live = !!(st && st.dataset.showing);
      const chip = mount.querySelector('[data-status]');
      if (chip) chip.classList.toggle('chip', live);
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      if (text) {
        s.innerHTML = `<span>${text}</span>` + (showRetry ? ` <button data-retry>Retry</button>` : '');
        const retry = s.querySelector('[data-retry]');
        if (retry) retry.addEventListener('click', () => start());
      }
    }

    function stopStream() {

      const st = mount.querySelector('.stage');

      if (st) st.dataset.showing = '';
      // RELEASE rather than stop when the arbiter owns the device: stopping it directly
      // would kill the capture out from under any other consumer - a call, a tracker - that
      // is legitimately sharing it.
      if (stream) {
        if (cameraOwner) cameraOwner.release(CAM_ID);
        else stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      const v = video();
      if (v) v.srcObject = null;
    }

    function applyTransform() {
      const v = video();
      if (!v) return;
      const parts = [];
      if (cfg.mirror) parts.push('scaleX(-1)');
      const rot = Number(cfg.rotation) || 0;
      if (rot) parts.push(`rotate(${rot}deg)`);
      v.style.transform = parts.join(' ');
      v.style.objectFit = cfg.fit;
    }

    async function resolveDeviceId(label) {
      if (!label) return null;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const m = devs.find((d) => d.kind === 'videoinput' && d.label === label);
        return m ? m.deviceId : null;
      } catch { return null; }
    }

    async function populateCameras() {
      const sel = mount.querySelector('[data-opt="cameraLabel"]');
      if (!sel) return;
      let devs = [];
      try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
      const cams = devs.filter((d) => d.kind === 'videoinput');
      const activeLabel = stream?.getVideoTracks()[0]?.label || '';
      sel.innerHTML = `<option value="">Default</option>` +
        cams.map((c) => `<option value="${c.label}">${c.label || 'Camera'}</option>`).join('');
      sel.value = cfg.cameraLabel || (cams.some((c) => c.label === activeLabel) ? '' : '');
    }

    async function start() {
      if (starting) return;
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('Camera not supported here'); return; }
      starting = true;
      setStatus('Starting camera…');
      stopStream();
      try {
        const wantedId = await resolveDeviceId(cfg.cameraLabel);
        const constraints = wantedId
          ? { video: { deviceId: { exact: wantedId } }, audio: false }
          : { video: true, audio: false };
        // Through the arbiter if there is one, so this is a REFERENCE on a shared device
        // rather than an exclusive open. On Linux a second open of the same webcam fails
        // outright, so "who opened it first" is the difference between a picture and a
        // black rectangle.
        let s = cameraOwner
          ? await cameraOwner.acquire(CAM_ID, wantedId ? { deviceId: wantedId } : undefined)
          : await navigator.mediaDevices.getUserMedia(constraints);

        // If we only just got permission, labels were empty before; a preferred
        // label may now resolve to a different device — re-acquire once.
        if (!wantedId && cfg.cameraLabel) {
          const id2 = await resolveDeviceId(cfg.cameraLabel);
          const activeId = s.getVideoTracks()[0]?.getSettings?.().deviceId;
          if (id2 && id2 !== activeId) {
            if (cameraOwner) {
              // Let go, re-configure, take it again - the arbiter reopens with the new device
              // once the last reference drops.
              cameraOwner.release(CAM_ID, true);
              s = await cameraOwner.acquire(CAM_ID, { deviceId: id2 });
            } else {
              s.getTracks().forEach((t) => t.stop());
              s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id2 } }, audio: false });
            }
          }
        }

        stream = s;
        const v = video();
        v.muted = true; v.autoplay = true; v.playsInline = true;
        v.srcObject = stream;
        await v.play().catch(() => {});
        activeSelection = cfg.cameraLabel;
        // There is now a picture behind any later message, so it draws as a chip.
        const st = mount.querySelector('.stage');
        if (st) st.dataset.showing = '1';
        setStatus(null);
        applyTransform();
        await populateCameras();
      } catch (err) {
        stopStream();
        const name = err?.name;
        // No picture: the message IS the panel now.
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('Camera permission needed', true);
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('No camera found');
        else setStatus('Camera unavailable', true);
      } finally {
        starting = false;
      }
    }

    function syncControls() {
      mount.querySelectorAll('[data-opt]').forEach((el) => {
        const key = el.dataset.opt;
        if (el.type === 'checkbox') el.checked = !!cfg[key];
        else if (key !== 'cameraLabel') el.value = cfg[key];
      });
      const camSel = mount.querySelector('[data-opt="cameraLabel"]');
      if (camSel) camSel.value = cfg.cameraLabel;
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="camera">
            <div class="stage">
              <video data-video></video>
              <div class="status" data-status hidden></div>
            </div>
            <button class="gear" data-gear aria-label="camera settings">⚙</button>
            <div class="settings" data-settings hidden>
              <label>camera
                <select data-opt="cameraLabel"><option value="">Default</option></select>
              </label>
              <label><input type="checkbox" data-opt="mirror"> mirror</label>
              <label>rotate
                <select data-opt="rotation">
                  <option value="0">0°</option><option value="90">90°</option>
                  <option value="180">180°</option><option value="270">270°</option>
                </select>
              </label>
              <label>fit
                <select data-opt="fit"><option value="cover">cover</option><option value="contain">contain</option></select>
              </label>
            </div>
          </div>`;

        mount.querySelector('[data-gear]').addEventListener('click', () => {
          const s = mount.querySelector('[data-settings]');
          s.hidden = !s.hidden;
        });

        mount.querySelectorAll('[data-opt]').forEach((el) => {
          el.addEventListener('change', () => {
            const key = el.dataset.opt;
            let value = el.type === 'checkbox' ? el.checked : el.value;
            // *** WRITE THE DECLARED TYPE, NOT THE DOM'S. ***
            // A `<select>` hands back a string, so this stored `rotation` as "90" while the
            // declaration and DEFAULTS both say number. `photos.js` hit the same thing with
            // `intervalSec` and records the cost: a setting that cannot be compared cannot be
            // applied to a group of panels at once. Nothing LOOKED wrong, because
            // `applyTransform` coerces with `Number()` -- the record was just lying about itself.
            if (key === 'rotation') value = Number(value) || 0;
            state.set({ [key]: value });
          });
        });

        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          applyTransform();
          syncControls();
          // Restart the stream only when the chosen camera changes (mirror/rotation
          // /fit are pure CSS). '' means default.
          if (!stream || cfg.cameraLabel !== activeSelection) start();
        });

        start();
      },
      onResize() {},
      onHide() {},
      destroy() { stopStream(); },   // release the camera — light goes out
    };
  },
);
