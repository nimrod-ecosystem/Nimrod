// marker_panel.js — SETTING UP THE MARKER TRACKER: point the camera, click the sock.
//
// The detector in `input_marker.js` is calibrated by SAMPLING rather than by presets, which
// means it does nothing at all until somebody has clicked the marker once. So until this panel
// exists, that whole input method is unreachable — the code could be perfect and no caregiver
// could switch it on. That is why this is the next thing built rather than a nicety.
//
// It lives on HOME, under Devices, with the other input hardware. Not on the kiosk: the kiosk
// may sit unattended in a care facility for days and is deliberately not also a management UI,
// and a camera preview of somebody in a bed is the last thing that should be one keypress away
// on the screen they cannot walk away from.
//
// ---------------------------------------------------------------------------------------
// *** THE PREVIEW RUNS THE CAMERA WITHOUT DRIVING THE CURSOR, AND THAT IS THE WHOLE DESIGN ***
// ---------------------------------------------------------------------------------------
//
// Setting this up is a two-person job: one person moves, the other watches the picture and
// clicks the sock. If opening the panel also seized the cursor, every one of those movements
// would be flinging the pointer around the screen the person is trying to use, and the
// caregiver would be calibrating and fighting at the same time.
//
// So the camera runs, the detection runs, the readouts are live — and `aim.setEnabled(device,
// false)` stops the result reaching the screen. That control exists in `aim.js` for precisely
// this, and it is the reason it exists rather than a role gate.
//
// ---------------------------------------------------------------------------------------
// WHERE THE CALIBRATION IS STORED, and this one is a real decision
// ---------------------------------------------------------------------------------------
//
// The bedside build stores it per DEVICE, in localStorage, and the reasoning is good: gain and
// rest point are properties of one room and one chair, not of a person.
//
// This stores it PER PERSON, on the server, in the same place their input bindings live — and
// the deciding fact is specific to this project: **the two Pis get physically swapped.** Mike
// carries one in and takes the other away. Per-device storage means every swap silently loses
// the calibration and somebody sets the sock up again, in the room, with the person waiting.
// Per person, it arrives with them, on any screen, the same promise the bindings already make:
// set your input up once, ever, and it follows you.
//
// The cost is real and worth writing down: move the camera to a different angle and the numbers
// are wrong, with nothing to tell you that except the cursor behaving oddly. If that turns out
// to bite, the answer is a named calibration per setup rather than moving the storage.

import { MARKER_DEVICE, MARKER_DEFAULTS, DET_W, DET_H } from './input_marker.js';

export const MARKER_KEY = 'marker-tracking';

// Declared as data, like every other setting, so the shell can render it and a cursor driven by
// one switch can reach it. The panel below draws its own controls because calibration is
// inherently visual — you cannot click a sock in a list — but the VALUES live here so nothing
// else has to guess at them.
export const SETTINGS = [
  { key: 'enabled', label: 'Track a colored marker', kind: 'toggle', default: false, level: 'standard' },
  { key: 'gain', label: 'How far a small movement goes', kind: 'choice', default: 3.0, level: 'standard',
    options: [
      { value: 1.5, label: 'a long way to travel' },
      { value: 3.0, label: 'normal' },
      { value: 4.5, label: 'a small movement crosses the screen' },
      { value: 6.0, label: 'the smallest movement possible' },
    ] },
  { key: 'smooth', label: 'Steadiness', kind: 'choice', default: 0.25, level: 'standard',
    options: [
      { value: 0.12, label: 'very steady, slower to respond' },
      { value: 0.25, label: 'normal' },
      { value: 0.5, label: 'quick, less steady' },
    ] },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// An approximate swatch of a sampled color, so somebody can see WHAT they clicked rather than
// only that they clicked. `v * 50%` because HSV value and HSL lightness are not the same thing
// and this only has to be recognizable, not correct.
export function swatchCss(c) {
  if (!c) return 'transparent';
  return `hsl(${Math.round(c.h)}, ${Math.round(c.s * 100)}%, ${Math.round(c.v * 50)}%)`;
}

// WHAT TO TELL THE PERSON SETTING IT UP. Separated from the DOM so the advice can be tested,
// because this text is the entire user interface for a thing with no other feedback: get it
// wrong and a caregiver is staring at a picture with no idea why nothing is happening.
//
// The order matters. Each line answers the FIRST question that is still unanswered.
export function adviceFor({ color = null, count = 0, minPx = MARKER_DEFAULTS.minPx } = {}) {
  if (!color) {
    return { state: 'unsampled',
             text: 'Click the marker in the picture to tell it what color to look for.' };
  }
  if (count === 0) {
    return { state: 'lost',
             text: 'Cannot see that color at all. Move the camera, improve the light, or click the marker again.' };
  }
  if (count < minPx) {
    // THE MOST IMPORTANT LINE HERE. "A bit of it" and "none of it" want opposite advice, and a
    // panel that showed both as "not found" would send somebody re-sampling a color that was
    // already right when the real problem is that the marker is too far away.
    return { state: 'faint',
             text: `Only just visible (${count} of ${minPx} needed). Move the camera closer, or use a bigger marker.` };
  }
  return { state: 'seen', text: `Tracking it (${count} pixels).` };
}

export function mountMarkerPanel(root, {
  // The tracker. Injected rather than constructed here so this panel can be driven against
  // hand-built frames with no camera at all — the same seam the detector already uses.
  tracker,
  aim = null,
  device = MARKER_DEVICE,
  settings = () => ({}),
  // Persist a change. Async and may fail; the panel keeps working either way, because a
  // caregiver mid-calibration losing the picture because a save failed is the wrong trade.
  save = async () => {},
  documentRef = (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!root) throw new Error('mountMarkerPanel: a root element is required');
  if (!tracker) throw new Error('mountMarkerPanel: a tracker is required');
  const doc = documentRef;

  const cfg = () => ({ ...MARKER_DEFAULTS, enabled: false, ...(settings() || {}) });
  let lastFrame = null;                 // the most recent frame, for sampling a click against
  let destroyed = false;

  root.innerHTML = `
    <div class="mk">
      <h3>A colored marker</h3>
      <p class="mk-lede">A brightly colored sock, wristband or glove, anywhere they can move it.
        The camera finds the color — it is not trying to recognize a hand or a foot, which is
        why it works with an unusual posture and in poor light.</p>

      <div class="mk-live">
        <canvas class="mk-view" data-view width="${DET_W}" height="${DET_H}"
                aria-label="camera preview — click the marker"></canvas>
        <div class="mk-side">
          <p class="mk-advice" data-advice role="status" aria-live="polite"></p>
          <p class="mk-swatch-row">Looking for
            <span class="mk-swatch" data-swatch></span>
            <button type="button" data-clear>Forget it</button>
          </p>
          <button type="button" data-rest>Set this as the resting position</button>
          <p class="mk-note" data-restnote></p>
        </div>
      </div>

      <label class="mk-chk">
        <input type="checkbox" data-opt="enabled">
        <span>Let this move the cursor</span>
      </label>
      <p class="mk-note">Leave this off while you are setting up. The picture above stays live
        either way — so one person can move while the other watches, without the cursor being
        dragged around the screen they are using.</p>

      <div class="mk-rows" data-rows></div>
      <p class="mk-note mk-hint">Green and hot pink work best. Avoid red (too close to skin) and
        anything white, gray or pale — there is no color there to lock onto.</p>
    </div>`;

  const el = (sel) => root.querySelector(sel);
  const view = el('[data-view]');
  const v2d = view.getContext('2d');

  // The three tuning rows, built from the DATA above rather than written out as markup, so the
  // declaration stays the single source of truth for what is adjustable.
  el('[data-rows]').innerHTML = SETTINGS
    .filter((f) => f.kind === 'choice')
    .map((f) => `<label class="mk-row"><span>${esc(f.label)}</span>
        <select data-opt="${esc(f.key)}">${f.options
          .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>
      </label>`).join('');

  function render() {
    if (destroyed) return;
    const c = cfg();
    const found = tracker.found();
    const advice = adviceFor({ color: c.color, count: found.count, minPx: c.minPx });
    const a = el('[data-advice]');
    a.textContent = advice.text;
    a.dataset.state = advice.state;
    el('[data-swatch]').style.background = swatchCss(c.color);
    el('[data-clear]').hidden = !c.color;
    el('[data-restnote]').textContent = c.center
      ? 'Movement is measured from the position you set.'
      : 'Not set — movement is measured from the middle of the picture.';
    const chk = el('[data-opt="enabled"]');
    if (chk) chk.checked = !!c.enabled;
    for (const f of SETTINGS) {
      if (f.kind !== 'choice') continue;
      const sel = el(`[data-opt="${f.key}"]`);
      if (sel) sel.value = String(c[f.key] ?? f.default);
    }
  }

  // Draw one frame plus the matched pixels on top of it. The MASK IS THE POINT: a picture with
  // no overlay tells a caregiver nothing about whether the tolerance is right, and tolerance is
  // the setting most likely to need moving in a real room.
  function draw(frame, found, mask) {
    if (destroyed || !frame) return;
    lastFrame = frame;
    try {
      // Mirrored, because a preview of a person that is not mirrored is disorienting to the
      // person watching — they move left and the picture moves right. The click handler
      // un-mirrors, which is the one place this has to be undone.
      v2d.save();
      v2d.setTransform(-1, 0, 0, 1, view.width, 0);
      v2d.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
      v2d.restore();
      if (mask) {
        v2d.save();
        v2d.setTransform(-1, 0, 0, 1, view.width, 0);
        v2d.globalCompositeOperation = 'source-over';
        v2d.putImageData(new ImageData(mask, frame.width, frame.height), 0, 0);
        v2d.restore();
      }
      if (found && found.count) {
        v2d.beginPath();
        v2d.arc((1 - found.x) * view.width, found.y * view.height, 8, 0, Math.PI * 2);
        v2d.strokeStyle = '#F7C948'; v2d.lineWidth = 2; v2d.stroke();
      }
    } catch { /* a preview must never break the panel */ }
    render();
  }

  // *** APPLIED ON MOUNT, NOT ONLY WHEN THE TOGGLE CHANGES. ***
  //
  // The first version only called this from the change handler, so opening the panel with
  // tracking off left the aim ENABLED — nobody had told it otherwise — and the preview drove
  // the cursor after all. That is the exact failure this panel is designed to prevent, and it
  // was live until a test asserted the thing the design was for rather than the thing the code
  // did. The lesson is the general one: a control that is only applied on CHANGE is not applied.
  //
  // Note what this does and does not cover. It governs the aim while the PANEL is mounted. On a
  // surface with no panel — the kiosk — `enabled` decides whether the tracker is started at all,
  // and a tracker that is not running reports nothing by construction. The panel needs the
  // opposite: a camera that runs while the cursor does not move.
  function syncEnabled() {
    aim?.setEnabled?.(device, !!cfg().enabled);
  }

  async function set(key, value) {
    const next = { ...cfg(), [key]: value };
    try { await save({ [key]: value }, next); } catch (err) { console.error('marker: save', err); }
    // The aim is switched at the source rather than by not starting the camera, so the preview
    // keeps running while the cursor does not move. See the note at the top.
    if (key === 'enabled') syncEnabled();
    render();
  }

  // CLICK THE MARKER. The preview is mirrored, so x is un-mirrored here — getting this wrong
  // samples the wrong side of the picture and is invisible until nothing ever matches.
  view.addEventListener('click', (e) => {
    if (!lastFrame) return;
    const r = view.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const nx = 1 - (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const sampled = tracker.sampleAt(lastFrame, nx, ny);
    if (sampled) set('color', sampled);
  });

  el('[data-clear]').addEventListener('click', () => set('color', null));

  // THE RESTING POSITION. Movement is measured from wherever they naturally hold still, which
  // is what lets a small range of movement reach a whole screen. Taken from where the marker
  // IS right now rather than typed in, because nobody knows their own rest point as a number.
  el('[data-rest]').addEventListener('click', () => {
    const found = tracker.found();
    if (found && found.count) set('center', { x: found.x, y: found.y });
  });

  el('[data-opt="enabled"]').addEventListener('change', (e) => set('enabled', e.target.checked));
  for (const f of SETTINGS) {
    if (f.kind !== 'choice') continue;
    const sel = el(`[data-opt="${f.key}"]`);
    sel?.addEventListener('change', (e) => set(f.key, Number(e.target.value)));
  }

  syncEnabled();
  render();

  return {
    // The tracker calls this every tick.
    draw,
    render,
    advice: () => adviceFor({ color: cfg().color, count: tracker.found().count, minPx: cfg().minPx }),
    async refresh() { syncEnabled(); render(); return this; },
    destroy() {
      destroyed = true;
      lastFrame = null;
      // LEAVE THE AIM AS THE SETTING SAYS. Closing the panel must not switch a working tracker
      // off, and must not switch a disabled one on — so this reapplies the setting rather than
      // restoring whatever the aim happened to be before.
      try { syncEnabled(); } catch { /* already gone */ }
      root.innerHTML = '';
    },
  };
}
