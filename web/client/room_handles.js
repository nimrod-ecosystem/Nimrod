// room_handles.js - HANDLES ON THE CHOSEN PIECE OF A ROOM: drag it, scale it, turn it (row 2.110, chat's note CO).
//
// Mike, 2026-10-25: "I was hoping for transform controls like position, rotation, scale for objects. I feel like he built
// something specifically for switch users. It would be nice to have that setup as an option, but not the default. You
// should be able to click on things to select them and maybe have handles to drag something selected." So, on the piece
// edit mode has chosen in a dashboard's room (arrangement.js): its body drags it; the corner square scales it; the round
// knob above it turns it. The rows (room_edits.js: Left or right, Nearer or further, Size, Rotation, Facing) stay in the
// card beside it as its numbers, and are what a switch walks: the handles add to them, they replace nothing.
//
// *** IN-REPO, NOT A LIBRARY (argued; chat suggested Moveable by Daybrush, MIT). *** FOR Moveable: proven, with the edge
// cases (snapping, groups, scaling a turned box) done. AGAINST, and it decides it: its build is 245 KB (checked
// 2026-10-25, v0.53.0, on a React-compatible layer), thirty times the one outside file this site ships, for every screen
// that edits a room, Pi 400s included; and the room's truth is its RECIPE (x and y in percent, a size, a turn), redrawn
// on each save, while Moveable writes transforms onto the element, which would be converted back to the recipe anyway.
// What is needed is one piece at a time: drag, scale, turn. ATTRIBUTIONS.md stays as short as it is.
//
// HOW: while a handle is held, the piece is PREVIEWED (its left/top and an extra scale/rotate on its own transform, so
// it moves under the finger with nothing saved); on release ONE change is handed to `onCommit` - one save, one Undo step.
// THE DATA IS DESIGN'S VILLAGE FORMAT (README 2026-10-25: "editing the same four fields on the same data (x, y, scale,
// rot, plus flip)"): x and y are the FOOT, so scaling keeps the foot where it is; `rot` turns about the CENTRE of the
// piece's box, as village_kit.js draws it. A thing on a side wall is drawn
// through the wall's slant and is not moved or turned here (room_edits.js), only scaled. PURE helpers are exported for
// the suite; `attachHandles` needs a document.

export const HANDLES_CLASS = 'em-handles';     // edit_mode.js lets presses on this through (it is the editor's own)
const STYLE_ID = 'room-handles-css';
// A drag shorter than this many pixels is a press, not a move (a tap on the piece must not nudge it).
export const DRAG_SLOP_PX = 3;

const round1 = (v) => Math.round(v * 10) / 10;
/** Degrees in -180..180. PURE. */
export const normDeg = (d) => { let x = ((Number(d) || 0) % 360 + 360) % 360; if (x > 180) x -= 360; return Math.round(x); };
/** The percent a pointer moved, across and down, in a box `rect` (its width and height in pixels). PURE. */
export function movedPercent(dxPx, dyPx, rect) {
  const w = Math.max(1, Number(rect?.width) || 1), h = Math.max(1, Number(rect?.height) || 1);
  return { dx: round1((dxPx / w) * 100), dy: round1((dyPx / h) * 100) };
}
/** How much bigger: the pointer's distance from the anchor now, over at the start. PURE. */
export function scaleFactor(anchor, start, now) {
  const d0 = Math.hypot(start.x - anchor.x, start.y - anchor.y);
  const d1 = Math.hypot(now.x - anchor.x, now.y - anchor.y);
  return d0 > 1 ? d1 / d0 : 1;
}
/** How far it turned, in degrees, around the anchor, from `start` to `now` (clockwise is positive, as on screen). PURE. */
export function turnDegrees(anchor, start, now) {
  const a0 = Math.atan2(start.y - anchor.y, start.x - anchor.x);
  const a1 = Math.atan2(now.y - anchor.y, now.x - anchor.x);
  return normDeg(((a1 - a0) * 180) / Math.PI);
}

function ensureCss(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.${HANDLES_CLASS}{position:absolute;z-index:40;pointer-events:none;box-sizing:border-box}
.${HANDLES_CLASS} *{box-sizing:border-box}
.${HANDLES_CLASS} .emh-box{position:absolute;inset:0;border:2px dashed var(--focus,var(--accent,#2b6cb0));border-radius:6px;pointer-events:auto;cursor:move;touch-action:none}
.${HANDLES_CLASS} .emh-box[data-fixed]{cursor:default}
.${HANDLES_CLASS} .emh-scale{position:absolute;right:-12px;bottom:-12px;width:24px;height:24px;border-radius:4px;background:var(--surface,#fff);border:3px solid var(--focus,var(--accent,#2b6cb0));pointer-events:auto;cursor:nwse-resize;touch-action:none}
.${HANDLES_CLASS} .emh-rot{position:absolute;left:50%;top:-40px;width:24px;height:24px;margin-left:-12px;border-radius:50%;background:var(--surface,#fff);border:3px solid var(--focus,var(--accent,#2b6cb0));pointer-events:auto;cursor:grab;touch-action:none}
.${HANDLES_CLASS} .emh-stem{position:absolute;left:50%;top:-16px;width:2px;height:16px;margin-left:-1px;background:var(--focus,var(--accent,#2b6cb0))}`;
  (doc.head || doc.documentElement).append(s);
}

// ---- GEOMETRY: how a drag in pixels becomes the piece's own numbers, and how it is previewed ----
// ONE EDITOR, TWO KINDS OF DRAWING (chat's note CP, "one editor, not two"). A room piece is an HTML element placed by
// left/top in percent; a village piece (village_kit.js) is an SVG group on a 1600x900 stage, in the stage's own units.
// The handles, the gestures and the one commit per gesture are the same; only these three answers differ.
//   start()          measured once when a handle is pressed
//   delta(dx, dy, s) the move, in the piece's own units
//   preview(d, piece) / reset()   the piece under the finger, nothing saved / put back as it was

/** A room piece: an HTML element with style left/top in percent of its parent (room_scene.js). */
export function htmlGeometry({ el, host, floor = true }) {
  const baseTransform = el.style.transform || '';
  const baseLeft = el.style.left, baseTop = el.style.top;
  return {
    start: () => ({ rect: (el.offsetParent || el.parentElement || host).getBoundingClientRect() }),
    delta: (dx, dy, s) => movedPercent(dx, dy, s.rect),
    preview(d, piece) {
      const x0 = Number(piece.x) || 0, y0 = Number(piece.y) || 0;
      if (d.kind === 'move') { el.style.left = `${x0 + d.dx}%`; el.style.top = `${y0 + d.dy}%`; }
      const turn = (deg) => (floor ? ` translateY(-50%) rotate(${deg}deg) translateY(50%)` : ` rotate(${deg}deg)`);
      const extra = d.kind === 'scale' ? ` scale(${d.k})` : d.kind === 'rotate' ? turn(piece.flip ? -d.deg : d.deg) : '';
      el.style.transform = `${baseTransform}${extra}`;
    },
    reset() { el.style.left = baseLeft; el.style.top = baseTop; el.style.transform = baseTransform; },
  };
}

/**
 * A village piece: an SVG element on a stage drawn through a viewBox (village_kit.js sceneSvg), moved in the stage's
 * units. `el` is the group that carries the piece's turn (sceneSvg's outer `<g transform="rotate(...)">`): the preview is
 * put IN FRONT of that transform, so it scales about the foot and turns about the centre of the piece's own box (the
 * group's getBBox, before its turn), as village_kit.js draws them. Its flip is inside the turn, so a turn is not mirrored.
 */
export function svgGeometry({ el }) {
  const base = el.getAttribute('transform') || '';
  const box = () => { try { const b = el.getBBox(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, fy: b.y + b.height }; } catch { return null; } };
  const put = (extra) => { const t = `${extra} ${base}`.trim(); if (t) el.setAttribute('transform', t); else el.removeAttribute('transform'); };
  return {
    start() {
      let m = null;
      try { m = el.ownerSVGElement?.getScreenCTM?.() || null; } catch { m = null; }
      return { ux: Math.abs(m?.a) || 1, uy: Math.abs(m?.d) || 1, box: box() };
    },
    delta: (dx, dy, s) => ({ dx: round1(dx / s.ux), dy: round1(dy / s.uy) }),
    preview(d, piece, s) {
      const b = s?.box || { cx: Number(piece.x) || 0, cy: Number(piece.y) || 0, fy: Number(piece.y) || 0 };
      if (d.kind === 'move') put(`translate(${d.dx} ${d.dy})`);
      else if (d.kind === 'scale') put(`translate(${b.cx} ${b.fy}) scale(${d.k}) translate(${-b.cx} ${-b.fy})`);
      else if (d.kind === 'rotate') put(`rotate(${d.deg} ${b.cx} ${b.cy})`);
    },
    reset() { put(''); },
  };
}

/**
 * Handles over `el`, drawn in `host`. `piece`: its recipe values now, `{ x, y, size, rotate, flip }`; `floor`: anchored
 * at its foot (else its middle); `movable`: may be dragged and turned (false: a side-wall thing, scaled only).
 * `geometry`: htmlGeometry (the default, a room piece placed by left/top in percent) or svgGeometry (a village piece, in
 * its stage's units). `onCommit({ x?, y?, size?, rotate? })` once per gesture. Returns `{ el: the overlay, place(), destroy() }`.
 */
export function attachHandles({ el, host, piece = {}, floor = true, movable = true, geometry = htmlGeometry, onCommit = () => {} } = {}) {
  if (!el || !host) return { el: null, place() {}, destroy() {} };
  const doc = host.ownerDocument || document;
  ensureCss(doc);
  const ov = doc.createElement('div');
  ov.className = HANDLES_CLASS;
  ov.dataset.roomHandles = '';
  ov.innerHTML = `<div class="emh-box"${movable ? '' : ' data-fixed'} data-emh="move" role="presentation"></div>`
    + `<div class="emh-scale" data-emh="scale" title="Drag to make it bigger or smaller"></div>`
    + (movable ? '<div class="emh-stem"></div><div class="emh-rot" data-emh="rotate" title="Drag to turn it"></div>' : '');
  host.append(ov);
  const geo = geometry({ el, host, floor });
  let drag = null;
  let torn = false;

  function place() {
    if (torn) return;
    // Placed inside the host's border (absolute positions start there), and with its scroll.
    const h = host.getBoundingClientRect(), r = el.getBoundingClientRect();
    ov.style.left = `${r.left - h.left - (host.clientLeft || 0) + (host.scrollLeft || 0)}px`;
    ov.style.top = `${r.top - h.top - (host.clientTop || 0) + (host.scrollTop || 0)}px`;
    ov.style.width = `${r.width}px`; ov.style.height = `${r.height}px`;
  }
  // Scaling keeps the foot where it is (x, y ARE the foot); turning is about the centre (Design's format, room_scene.js).
  function anchor(kind) {
    const r = el.getBoundingClientRect();
    const mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return kind === 'rotate' || !floor ? mid : { x: mid.x, y: r.bottom };
  }
  function preview(d) {
    geo.preview(d, piece, drag?.geo);
    place();
  }
  function onDown(e) {
    const kind = e.target instanceof Element ? e.target.closest('[data-emh]')?.dataset.emh : null;
    if (!kind || (kind !== 'scale' && !movable)) return;
    e.preventDefault(); e.stopPropagation();
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    drag = { kind, start: { x: e.clientX, y: e.clientY }, anchor: anchor(kind), geo: geo.start(), moved: false, d: { kind } };
  }
  function onMove(e) {
    if (!drag) return;
    const now = { x: e.clientX, y: e.clientY };
    if (!drag.moved && Math.hypot(now.x - drag.start.x, now.y - drag.start.y) < DRAG_SLOP_PX) return;
    drag.moved = true;
    e.preventDefault();
    if (drag.kind === 'move') drag.d = { kind: 'move', ...geo.delta(now.x - drag.start.x, now.y - drag.start.y, drag.geo) };
    else if (drag.kind === 'scale') drag.d = { kind: 'scale', k: scaleFactor(drag.anchor, drag.start, now) };
    else drag.d = { kind: 'rotate', deg: turnDegrees(drag.anchor, drag.start, now) };
    preview(drag.d);
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag.d, moved = drag.moved;
    drag = null;
    e.preventDefault(); e.stopPropagation();
    if (!moved) return;
    let patch = null;
    if (d.kind === 'move') patch = { x: round1((Number(piece.x) || 0) + d.dx), y: round1((Number(piece.y) || 0) + d.dy) };
    if (d.kind === 'scale') patch = { size: round1((Number(piece.size) || 1) * d.k) };
    if (d.kind === 'rotate') patch = { rotate: normDeg((Number(piece.rotate) || 0) + d.deg) };
    try { onCommit(patch); } catch (err) { console.error('room handles: commit', err); }
  }
  const stopClick = (e) => { e.stopPropagation(); };
  ov.addEventListener('pointerdown', onDown);
  ov.addEventListener('pointermove', onMove);
  ov.addEventListener('pointerup', onUp);
  ov.addEventListener('pointercancel', () => { if (drag) { drag = null; geo.reset(); place(); } });
  ov.addEventListener('click', stopClick);
  place();
  return {
    el: ov,
    place,
    destroy() { torn = true; try { ov.remove(); } catch { /* gone */ } },
  };
}
