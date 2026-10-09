// panel_corners.js -- WHEN A PANEL'S CORNER BUTTONS SHOW ("corner on hover", Mike 2026-10-09).
//
// Mike: "The edit and promote buttons at the bottom right of every module should only show when you have
// the cursor in the area."
//
// THE CORNER is the group of buttons at the bottom right of a panel: ⤢ / ⤡ (make it bigger / smaller,
// arrangement.js `.k-promote`) and ✎ (edit this panel in place, edit_mode.js `.k-editc`; a room has a ✎ of
// its own). A box that holds a corner is a `.k-cell` (a slot), a `.k-pcell` (a placed panel), a `.k-stage`
// (one module at a time) or a `.k-room` -- and the buttons are its direct children.
//
// WHAT WAS WRONG (before this file). The corners showed on hover, but also:
//   * on EVERY panel at once, for 3 s, after ANY click anywhere (kiosk.js `data-corners="up"`, added so a
//     touch screen could reach them at all). With a mouse that is a row of buttons on every module each time
//     anything is clicked -- the "every module" Mike saw.
//   * for as long as focus stayed inside a panel (`:focus-within`), which a MOUSE click on any button in it
//     also gives. Click the calculator's 7 and its corner stayed up after the mouse had gone.
//   * always, on a panel made bigger (the ⤡). On a screen with no mouse that is a button left on the photos
//     for as long as they are big.
//
// THE RULE NOW, by how somebody is pointing:
//   MOUSE     shown while the pointer is over the panel, and for CORNER_GRACE_MS after it leaves (so a
//             hand that overshoots the corner by a few pixels, or crosses a gap, does not lose it). Only
//             that panel's corner: the one under the cursor.
//   TOUCH/PEN a tap anywhere in a panel shows THAT panel's corner for the bar's own time (the same tap
//             brings the bar up; both go together), so a finger can always reach edit and bigger. A tap
//             on another panel moves it there. Set AFTER the click, never on pointerdown: a corner
//             appearing under a press already under way would take its release (see kiosk.js).
//   KEYBOARD  shown while keyboard focus is inside the panel (`:has(:focus-visible)` in the CSS below),
//             not while a mouse click left focus there.
//   SWITCH    not shown. A scan reaches the same two presses as menu rows ("Edit this panel", "Make ...
//             bigger / smaller", kiosk.js; they are scan stops, kiosk_test) and the bar's Bigger /
//             Smaller -- a corner a scan never lands on is only clutter on the screen it is scanning.
//   NO MOUSE  (a bedside kiosk nobody points at) never shown: nothing hovers, nothing taps.
// Edit mode keeps its ✎ shown on the panel being edited (`[data-editing]`, edit_mode.js): it is a mode
// somebody chose, the ✎ reads "Stop editing" there, and it ends by itself (`editIdleMs`).
//
// THE NUMBERS (Rule 1; both are options of `watchCorners`, not settings anybody has asked for):
//   CORNER_GRACE_MS 600   FOR: long enough to cover overshooting the 44px corner or crossing the gap between
//                         panels and coming back (menus that wait for a moving mouse use 300-500 ms; this is a
//                         little more because the target is at the panel's very edge). AGAINST longer: the
//                         corner of the panel you just left is still up while you are on the next one -- at 600
//                         ms that is a fade, not two corners to choose between.
//   tapMs = BAR_HIDE_MS   (3 s, dashboard_nest.js) FOR: one tap, one time -- the bar and the corner come and go
//                         together, and the next tap renews both. AGAINST: 3 s is not long for somebody slow to
//                         find a 44px button; they tap again. A separate setting is the way if that bites.
//
// Pure DOM, no imports: the CSS rule both corner files use (`cornerShowCss`) and the watcher kiosk.js runs.

export const CORNER_BOXES = Object.freeze(['.k-cell', '.k-pcell', '.k-stage', '.k-room']);
export const CORNER_BUTTONS = '.k-promote, .k-editc';
export const CORNER_GRACE_MS = 600;
export const CORNER_TAP_MS = 3000;          // the bar's own time (dashboard_nest.js BAR_HIDE_MS); kiosk.js passes that
// The mark on a BOX whose corner is up: 'near' (a mouse is over it, or just left) or 'tap' (a finger tapped it).
export const CORNER_ATTR = 'data-corner-show';
const BOX_SEL = CORNER_BOXES.join(', ');

/** The CSS that SHOWS one corner button class (`.k-promote` or `.k-editc`). Two rules: a browser with no
 *  `:has()` drops only the keyboard one, never the whole show rule. */
export function cornerShowCss(btn) {
  const hover = CORNER_BOXES.map((b) => `:root:not([data-press="touch"]) ${b}:hover>${btn}`).join(',');
  const keys = CORNER_BOXES.map((b) => `${b}:has(:focus-visible)>${btn}`).join(',');
  return `${hover},[${CORNER_ATTR}]>${btn},${btn}:focus-visible{opacity:1;pointer-events:auto}\n${keys}{opacity:1;pointer-events:auto}`;
}

/** The boxes, from `el` outwards to `stop` (exclusive), that hold a corner of their own. */
export function cornerBoxesAt(el, stop = null) {
  const out = [];
  for (let n = el instanceof Element ? el : null; n && n !== stop; n = n.parentElement) {
    if (n.matches(BOX_SEL) && n.querySelector(`:scope > .k-promote, :scope > .k-editc`)) out.push(n);
  }
  return out;
}

/**
 * Watch `rootEl` and mark the box whose corner should be up. Returns { stop, shown, hideAll }.
 *   graceMs  how long a mouse's corner stays after the pointer leaves the panel
 *   tapMs    how long a tap's corner stays (a function is read at each tap)
 *   onChange called after a corner comes up or goes (kiosk.js lifts corners clear of the bar)
 */
export function watchCorners(rootEl, { graceMs = CORNER_GRACE_MS, tapMs = CORNER_TAP_MS, onChange = () => {} } = {}) {
  if (!rootEl || typeof rootEl.addEventListener !== 'function') return { stop() {}, shown: () => [], hideAll() {} };
  const timers = new Map();                 // box -> its hide timer
  let near = new Set();                     // the boxes under the mouse now
  let lastKind = 'mouse';  let stopped = false;
  const changed = () => { try { onChange(); } catch { /* not load-bearing */ } };

  function show(box, why) {
    clearTimeout(timers.get(box)); timers.delete(box);
    if (box.getAttribute(CORNER_ATTR) !== why) { box.setAttribute(CORNER_ATTR, why); changed(); }
  }
  function hide(box) {
    clearTimeout(timers.get(box)); timers.delete(box);
    if (box.hasAttribute(CORNER_ATTR)) { box.removeAttribute(CORNER_ATTR); changed(); }
  }
  function hideLater(box, ms) {
    clearTimeout(timers.get(box));
    timers.set(box, setTimeout(() => { timers.delete(box); if (!stopped) hide(box); }, Math.max(0, ms)));
  }
  const marked = () => [...rootEl.querySelectorAll(`[${CORNER_ATTR}]`)];

  const onOver = (e) => {
    if (e.pointerType !== 'mouse') return;
    const now = new Set(cornerBoxesAt(e.target, rootEl));
    for (const b of near) if (!now.has(b)) hideLater(b, graceMs);
    for (const b of now) show(b, 'near');
    near = now;
  };
  const onOut = (e) => {
    if (e.pointerType !== 'mouse') return;
    const to = e.relatedTarget;
    if (to instanceof Node && rootEl.contains(to)) return;      // the pointerover that follows sorts it out
    for (const b of near) hideLater(b, graceMs);
    near = new Set();
  };
  const onDown = (e) => {
    lastKind = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse';
    // A finger now: what the mouse left up stands down, as the hover rule does (`data-press`).
    if (lastKind === 'touch') { for (const b of near) hide(b); near = new Set(); }
  };
  const onClick = (e) => {
    // A pointer's click only (`detail` > 0): a key or a switch activating a button clicks with detail 0.
    if (!e || !(e.detail > 0) || lastKind !== 'touch') return;
    // Which panel NOW, in the capture phase, before the press is handled: a module that redraws on a press
    // (a calculator's keys, a trivia answer) takes the pressed element out of the page, and a detached
    // element has no panel to find afterwards.
    let boxes = cornerBoxesAt(e.target, rootEl);
    if (!boxes.length) return;
    setTimeout(() => {
      if (stopped) return;
      boxes = boxes.filter((b) => b.isConnected);
      if (!boxes.length) return;
      for (const b of marked()) if (!boxes.includes(b)) hide(b);    // one panel at a time
      let ms = CORNER_TAP_MS;
      try { ms = typeof tapMs === 'function' ? tapMs() : tapMs; } catch { ms = CORNER_TAP_MS; }
      for (const b of boxes) { show(b, 'tap'); hideLater(b, ms); }
    }, 0);
  };
  rootEl.addEventListener('pointerover', onOver, { capture: true, passive: true });
  rootEl.addEventListener('pointerout', onOut, { capture: true, passive: true });
  rootEl.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  rootEl.addEventListener('click', onClick, { capture: true, passive: true });
  return {
    shown: marked,
    hideAll() { for (const b of marked()) hide(b); near = new Set(); },
    stop() {
      stopped = true;
      rootEl.removeEventListener('pointerover', onOver, true);
      rootEl.removeEventListener('pointerout', onOut, true);
      rootEl.removeEventListener('pointerdown', onDown, true);
      rootEl.removeEventListener('click', onClick, true);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const b of marked()) b.removeAttribute(CORNER_ATTR);
    },
  };
}
