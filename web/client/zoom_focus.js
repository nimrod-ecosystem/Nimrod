// zoom_focus.js — ZOOM ON FOCUS, FOR A WHOLE SCREEN: the panel the cursor is on grows a little.
//
// Row 2.37 item 6 (Mike, 2026-09-30, room_as_home §7.2.3): "Things like this can grow on screen when
// hovered over or selected." Chat: make it a general setting, which also helps a switch user see what
// the scan is on. Claude Design (room-add-ons §1): off by default, settable 1.1× to 1.5×, an instant step
// under reduced motion and 150 ms otherwise, never covering the cursor ring (the ring is drawn on top).
//
// The ROOM already has its own ("Grow what the cursor is on", modules/room.js, for objects in it). This
// is the same idea for the screen's PANELS — a `.k-cell` in the grid, or a module placed freely
// (`[data-placed]`, arrangement.js Stage R) — marked `data-focused` by arrangement.js `paintFocus`.
//
//   applyZoomFocus(kioskEl, settings.zoomFocus)   // 'off' | '1.05' | '1.1' | '1.2'
//
// *** DEFAULT: OFF, argued (Rule 1; on Mike's list). *** FOR on: a switch user sees the focused panel
// at a glance, beyond the ring. AGAINST, and it wins as the default: on a full grid a grown panel covers
// the edges of its neighbours, and a screen that moves under somebody who did not ask for movement is
// the thing reduced-motion exists to prevent. Its steps are SMALLER than the room's (1.05 to 1.2, not
// 1.1 to 1.5): a panel is far bigger than a lamp, and 1.5× of a panel covers half the screen.
//
// NO COLOUR, NO LAYOUT: only `scale`, on top of whatever the panel already is, so turning it off leaves
// nothing behind. The stylesheet is injected once per document (no .css file for three rules).

export const ZOOM_FOCUS_KEY = 'zoomFocus';
export const ZOOM_FOCUS_OPTIONS = Object.freeze([
  { value: 'off', label: 'Off' },
  { value: '1.05', label: 'A little (1.05×)' },
  { value: '1.1', label: 'Some (1.1×)' },
  { value: '1.2', label: 'A lot (1.2×)' },
]);
export const ZOOM_FOCUS_DEFAULT = 'off';

/** The settings row, as data (settings_fields.js `choice`), for the screen's own settings. */
export const ZOOM_FOCUS_FIELD = Object.freeze({
  key: ZOOM_FOCUS_KEY, label: 'Grow the panel the cursor is on', kind: 'choice', default: ZOOM_FOCUS_DEFAULT,
  level: 'standard', options: ZOOM_FOCUS_OPTIONS,
  help: 'The panel the cursor or the scan is on grows a little. It does not move when movement is turned off.',
});

/** A stored value as a scale, or null for off / anything unknown. */
export function zoomFocusScale(value) {
  const v = ZOOM_FOCUS_OPTIONS.find((o) => o.value === String(value ?? ''));
  if (!v || v.value === 'off') return null;
  return Number(v.value);
}

const STYLE_ID = 'zoom-focus-style';
export const ZOOM_FOCUS_CSS = `
[data-zoom-focus] .k-cell[data-focused], [data-zoom-focus] [data-placed][data-focused]{
  scale: var(--zoom-focus, 1); z-index: 3; }
@media (prefers-reduced-motion: no-preference){
  [data-zoom-focus] .k-cell, [data-zoom-focus] [data-placed]{ transition: scale .15s ease-out; }
}
[data-zoom-focus][data-motion="still"] .k-cell, [data-zoom-focus][data-motion="still"] [data-placed]{ transition: none; }
`;

function ensureStyle(doc) {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = ZOOM_FOCUS_CSS;
  doc.head.append(s);
}

/** Turn it on or off for everything under `root`. Returns the scale in force, or null. */
export function applyZoomFocus(root, value) {
  if (!root) return null;
  const k = zoomFocusScale(value);
  if (k == null) {
    delete root.dataset.zoomFocus;
    root.style.removeProperty('--zoom-focus');
    return null;
  }
  ensureStyle(root.ownerDocument);
  root.dataset.zoomFocus = String(k);
  root.style.setProperty('--zoom-focus', String(k));
  return k;
}
