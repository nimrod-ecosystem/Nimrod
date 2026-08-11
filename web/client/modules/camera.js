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

registerModule(
  { type: 'camera', title: 'Camera', description: 'local self-view / rearview mirror (never leaves the device)' },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = { ...DEFAULTS };
    let stream = null;
    let activeSelection;   // the cameraLabel we last started with ('' = default)
    let starting = false;

    const video = () => mount.querySelector('[data-video]');

    function setStatus(text, showRetry = false) {
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
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
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
        let s = await navigator.mediaDevices.getUserMedia(constraints);

        // If we only just got permission, labels were empty before; a preferred
        // label may now resolve to a different device — re-acquire once.
        if (!wantedId && cfg.cameraLabel) {
          const id2 = await resolveDeviceId(cfg.cameraLabel);
          const activeId = s.getVideoTracks()[0]?.getSettings?.().deviceId;
          if (id2 && id2 !== activeId) {
            s.getTracks().forEach((t) => t.stop());
            s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id2 } }, audio: false });
          }
        }

        stream = s;
        const v = video();
        v.muted = true; v.autoplay = true; v.playsInline = true;
        v.srcObject = stream;
        await v.play().catch(() => {});
        activeSelection = cfg.cameraLabel;
        setStatus(null);
        applyTransform();
        await populateCameras();
      } catch (err) {
        stopStream();
        const name = err?.name;
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
            const value = el.type === 'checkbox' ? el.checked : el.value;
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
