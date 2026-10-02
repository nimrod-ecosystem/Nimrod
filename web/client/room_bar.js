// room_bar.js — THE TRANSPORT BAR ON THE ROOM'S LOW CABINET (2026-10-02). Light on purpose (no imports):
// modules/view.js reads it, and must not pull the room renderer in to do so.
//
// Mike: *"The low cabinet as a transport bar meant that the buttons from the transport bar are supposed to
// be on the cabinet instead."* The plan sent to Design: Design draws a button strip on the cabinet per
// theme; the LIVE bar renders into it. Built now: the placement, with a plain strip. Design's art drops
// in later through the hook below, with no change here.
//
// HOW IT IS PLACED. A room object that holds the transport bar says so in its recipe - `role: 'display',
// module: 'transport'` (room_presets.js `theRoom`'s low cabinet; any object can) - and room_scene.js hands
// the host its slot (`slots()`). When the dashboard's setting says "on the cabinet", the dashboard moves
// its ONE placed transport bar (the same module, the same buttons, the same chips; modules/view.js
// `placeChromeBar`) into that slot. Pressing the cabinet lifts it flat, as Design's room always did, so
// the strip is big enough to press when somebody wants it bigger.
//
// OFF BY DEFAULT (the bar stays along the bottom), argued:
//   * FOR the cabinet by default on a room: it is what Design drew, and it gives the room's screen back.
//   * AGAINST, and it wins for now: on a Pi-sized screen the cabinet strip is small (about a fifth of the
//     screen's width), every bar button is in it, and Design's art for it does not exist yet - a plain
//     strip that small is harder to hit than the bar. One row in the menu turns it on.
// Only a dashboard whose scene is a room with such an object offers the row; anywhere else the setting
// has nothing to move the bar to, and the bar stays where it is whatever it says.
//
// THE HOOK FOR DESIGN'S ART: the bar's host carries `data-on-cabinet` and paints its background from
// `--cabinet-bar-art` (a theme sets it - an image, a gradient), falling back to the theme's surface. A
// theme with no art gets the plain strip; nothing else changes when art arrives.

export const BAR_PLACE_KEY = 'barPlace';
export const BAR_PLACES = Object.freeze(['bottom', 'cabinet']);
export const BAR_PLACE_FIELD = Object.freeze({
  key: BAR_PLACE_KEY, label: 'Where the transport bar is', kind: 'choice', level: 'standard', default: 'bottom',
  options: Object.freeze([
    { value: 'bottom', label: 'Along the bottom' },
    { value: 'cabinet', label: 'On the low cabinet' },
  ]),
});

/** 'bottom' | 'cabinet' from a dashboard's settings row (anything else is 'bottom'). */
export function barPlaceFrom(row) {
  const v = row && row[BAR_PLACE_KEY];
  return BAR_PLACES.includes(v) ? v : 'bottom';
}

/** The room slot that holds the transport bar (a Map from room_scene.js `slots()`), or null. */
export function cabinetSlot(slots) {
  if (!slots || typeof slots.values !== 'function') return null;
  for (const s of slots.values()) if (s && s.module === 'transport' && s.el) return s;
  return null;
}

/** The plain strip's look, inline (a placed bar needs nothing from a stylesheet). Tokens only. */
export const CABINET_STRIP_STYLE = 'position:absolute;inset:0;display:block;overflow:hidden;'
  + 'pointer-events:auto;border-radius:6px;'
  + 'background:var(--cabinet-bar-art, var(--surface, Canvas));color:var(--text, CanvasText);'
  + 'box-shadow:inset 0 0 0 1px var(--border, currentColor)';

// THE SMALLEST THE BAR IS DRAWN ON THE CABINET, as a fraction of its own size. Below this it is not a
// control anybody can read or hit, so it stops shrinking and the strip clips instead - and pressing the
// cabinet still lifts it flat, bigger. Argued, not a setting: it is a legibility floor, not a taste.
export const CABINET_MIN_SCALE = 0.35;

/**
 * FIT THE BAR INTO THE CABINET'S STRIP: the whole bar, scaled down just enough, wrapping onto as many
 * rows as gives it the largest size that still fits (found by halving, a handful of layouts). Every
 * button stays where the bar puts it relative to the others - only the size changes - so nothing moves
 * under somebody's finger between two presses of the same strip. `undo` puts the bar back as it was.
 */
export function fitBarInto(bar, box) {
  if (!bar || !box) return 1;
  const bw = box.clientWidth, bh = box.clientHeight;
  if (!(bw > 0 && bh > 0)) return 1;
  bar.style.transformOrigin = '0 0';
  bar.style.position = 'absolute';
  bar.style.left = '0'; bar.style.top = '0';
  const fits = (s) => { bar.style.width = `${Math.floor(bw / s)}px`; return bar.offsetHeight * s <= bh + 0.5; };
  let lo = CABINET_MIN_SCALE, hi = 1, best = CABINET_MIN_SCALE;
  if (fits(1)) best = 1;
  else {
    for (let i = 0; i < 8; i += 1) { const mid = (lo + hi) / 2; if (fits(mid)) { best = mid; lo = mid; } else hi = mid; }
  }
  fits(best);
  bar.style.transform = `scale(${best.toFixed(3)})`;
  return best;
}
export function unfitBar(bar) {
  if (!bar) return;
  for (const k of ['transformOrigin', 'position', 'left', 'top', 'width', 'transform']) bar.style[k] = '';
}
