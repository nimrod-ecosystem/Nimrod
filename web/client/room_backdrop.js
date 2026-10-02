// room_backdrop.js — A 2D ROOM'S BACKDROP DRAWN FROM DATA, AND THE ONE PIECE OF MATHS A FLATTENED ROOM NEEDS.
//
// Two things, both used by room_scene.js (the 2D room) and room_flat.js (which makes a 2D room from a 3D one),
// kept in this small file so the 2D room does not have to load the 3D room to draw a flattened one.
//
// *** 1. THE BACKDROP: `recipe.backdrop`, a picture the room draws INSTEAD of its own walls and floor. ***
//   { kind: 'plan', shapes: [...] }   polygons and lines in stage px (960 x 540), each painted with a NAMED
//                                     paint from PAINTS below -- never a colour. This is what "flatten to 2D"
//                                     makes (room_flat.js argues why a plan and not a picture).
//   { kind: 'image', src }            a picture (a same-site path or a data: image). For a later bake of a
//                                     scene that has no plan to give (a WebGL one); nothing makes one today.
//   Anything else -> no backdrop, and the room draws its own shell as it always has.
//
//   A shape: { pts: [[x, y], ...], fill?: paint, grad?: { a: [x, y], b: [x, y], stops: [[0..1, paint], ...] },
//              stroke?: paint, sw?: px }. A paint is a NAME, looked up here; a record cannot carry CSS.
//
// *** THE PAINTS ARE THE 3D ROOM'S OWN THEME TOKENS. *** FLAT_TOKENS repeats room3d.css's five declarations
// (`--r3-wall` ... `--r3-line`) word for word -- dev/room_flat_test.html reads room3d.css and fails if they
// drift -- so a flattened room is drawn in the screen's theme exactly as the 3D room was, and a dark theme
// still makes a dark room. No literal colour is in this file: every fallback is a CSS system colour.
//
// *** 2. quadMatrix: an element of w x h drawn onto any four corners (a projected wall, a TV's screen). ***
// A flat picture of a 3D wall is a QUAD, not a rectangle; a module on that wall has to be drawn onto the quad
// to sit where it sat in 3D. The map from a rectangle to four points is a 2D projective transform (a
// homography), and CSS `matrix3d` carries one exactly. Pure; dev/room_flat_test.html checks the corners.

export const STAGE_W = 960;
export const STAGE_H = 540;

// room3d.css `.r3`'s five, verbatim (the test compares them).
export const FLAT_TOKENS = Object.freeze({
  wall: 'var(--surface-alt, var(--surface, Canvas))',
  floor: 'color-mix(in srgb, var(--text-soft, var(--text, CanvasText)) 26%, var(--surface-alt, var(--surface, Canvas)))',
  wood: 'color-mix(in srgb, var(--accent, CanvasText) 62%, var(--surface, Canvas))',
  shade: 'var(--text, CanvasText)',
  line: 'var(--border, CanvasText)',
});
const T = FLAT_TOKENS;
const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
// The named paints: room3d.css's face backgrounds, one name each.
export const PAINTS = Object.freeze({
  bg: mix(T.wall, 80, T.shade),                     // .r3 (behind every face)
  wall: T.wall,                                     // .r3-back, and under the side walls' shading
  base: mix(T.line, 30, 'transparent'),             // the 6px skirting line at the foot of each wall
  ceiling: mix(T.wall, 84, T.shade),                // .r3-ceiling
  floor: T.floor,                                   // .r3-floor
  board: mix(T.shade, 12, 'transparent'),           // .r3-floor's board lines
  wood: T.wood,                                     // .r3-bf-front
  edge: mix(T.shade, 22, 'transparent'),            // .r3-bf-front's inset line
  woodTop: mix(T.wood, 86, 'var(--surface, Canvas)'), // .r3-bf-top
  woodSide: mix(T.wood, 78, T.shade),               // .r3-bf-left / .r3-bf-right
});
/** A paint name -> its CSS, or null. `shade:N` (N 0..100) is the theme's text colour at N% over clear. */
export function paintCss(name) {
  if (typeof name !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(PAINTS, name)) return PAINTS[name];
  const m = /^shade:(\d{1,3})$/.exec(name);
  if (m && Number(m[1]) <= 100) return mix(T.shade, Number(m[1]), 'transparent');
  return null;
}

const MAX_SHAPES = 400;      // a plan is a few dozen shapes; this is a guard against a record gone wrong
const MAX_PTS = 16;          // a face is four points, a clipped one a few more
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e5;
const pt = (p) => (Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) ? [p[0], p[1]] : null);

/** A backdrop with every field checked (unknown paints and bad points dropped), or null for none. */
export function normalizeBackdrop(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.kind === 'image') {
    const src = typeof b.src === 'string' ? b.src.trim() : '';
    return /^(\/(?!\/)|\.\.?\/|data:image\/(png|jpeg|webp);)/i.test(src) ? { kind: 'image', src } : null;
  }
  if (b.kind !== 'plan' || !Array.isArray(b.shapes)) return null;
  const shapes = [];
  for (const s of b.shapes.slice(0, MAX_SHAPES)) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.pts)) continue;
    const pts = s.pts.slice(0, MAX_PTS).map(pt);
    if (pts.length < 2 || pts.some((p) => !p)) continue;
    const out = { pts };
    if (paintCss(s.fill)) out.fill = s.fill;
    if (paintCss(s.stroke)) { out.stroke = s.stroke; out.sw = finite(s.sw) && s.sw > 0 && s.sw <= 40 ? s.sw : 1; }
    const g = s.grad;
    if (g && pt(g.a) && pt(g.b) && Array.isArray(g.stops)) {
      const stops = g.stops.slice(0, 8).filter((st) => Array.isArray(st) && finite(st[0]) && paintCss(st[1]))
        .map(([o, p]) => [Math.max(0, Math.min(1, o)), p]);
      if (stops.length >= 2) out.grad = { a: pt(g.a), b: pt(g.b), stops };
    }
    if (out.fill || out.stroke || out.grad) shapes.push(out);
  }
  return shapes.length ? { kind: 'plan', shapes } : null;
}

let gradSeq = 0;
const SVG = 'http://www.w3.org/2000/svg';
const ptsAttr = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
/** The backdrop as one element filling the stage (an <svg>, or an <img>), or null. Built from checked data
 *  with createElementNS and CSSOM only: nothing in a record is ever parsed as markup. */
export function renderBackdrop(doc, backdrop) {
  const b = normalizeBackdrop(backdrop);
  if (!b) return null;
  if (b.kind === 'image') {
    const img = doc.createElement('img');
    img.className = 'rs-backdrop';
    img.alt = '';
    img.src = b.src;
    return img;
  }
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'rs-backdrop');
  svg.setAttribute('viewBox', `0 0 ${STAGE_W} ${STAGE_H}`);
  svg.setAttribute('width', String(STAGE_W));
  svg.setAttribute('height', String(STAGE_H));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const defs = doc.createElementNS(SVG, 'defs');
  svg.append(defs);
  for (const s of b.shapes) {
    const closed = s.pts.length > 2;
    const mk = () => {
      const e = doc.createElementNS(SVG, closed ? 'polygon' : 'polyline');
      e.setAttribute('points', ptsAttr(s.pts));
      e.style.setProperty('fill', 'none');
      return e;
    };
    if (s.fill && closed) { const e = mk(); e.style.setProperty('fill', paintCss(s.fill)); e.dataset.paint = s.fill; svg.append(e); }
    if (s.grad && closed) {
      const id = `rsbk${++gradSeq}`;
      const lg = doc.createElementNS(SVG, 'linearGradient');
      lg.setAttribute('id', id);
      lg.setAttribute('gradientUnits', 'userSpaceOnUse');
      lg.setAttribute('x1', String(s.grad.a[0])); lg.setAttribute('y1', String(s.grad.a[1]));
      lg.setAttribute('x2', String(s.grad.b[0])); lg.setAttribute('y2', String(s.grad.b[1]));
      for (const [o, p] of s.grad.stops) {
        const st = doc.createElementNS(SVG, 'stop');
        st.setAttribute('offset', String(o));
        st.style.setProperty('stop-color', paintCss(p));
        lg.append(st);
      }
      defs.append(lg);
      const e = mk();
      e.style.setProperty('fill', `url(#${id})`);
      e.dataset.paint = 'gradient';
      svg.append(e);
    }
    if (s.stroke) {
      const e = mk();
      e.style.setProperty('stroke', paintCss(s.stroke));
      e.style.setProperty('stroke-width', String(s.sw || 1));
      e.style.setProperty('stroke-linejoin', 'round');
      e.dataset.paint = s.stroke;
      svg.append(e);
    }
  }
  return svg;
}

// ---------------------------------------------------------------------------------------------
// THE HOMOGRAPHY
// ---------------------------------------------------------------------------------------------
/**
 * The 3x3 projective map taking the rectangle (0,0)-(w,h) onto the corners `q` = [TL, TR, BR, BL] (stage px):
 * `[a, b, c, d, e, f, g, h]` with  x' = (a u + b v + c) / (g u + h v + 1),  y' = (d u + e v + f) / (g u + h v + 1).
 * Heckbert's square-to-quad, then scaled from the unit square to w x h. Null for a degenerate quad.
 */
export function quadHomography(w, h, q) {
  if (!(w > 0 && h > 0) || !Array.isArray(q) || q.length !== 4 || q.some((p) => !pt(p))) return null;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  // A quad with no area (all one point, or all on one line) has no picture to map onto.
  const area = ((x0 * y1 - x1 * y0) + (x1 * y2 - x2 * y1) + (x2 * y3 - x3 * y2) + (x3 * y0 - x0 * y3)) / 2;
  if (Math.abs(area) < 1e-6) return null;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g, hh;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; g = 0; hh = 0;     // a parallelogram: affine
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3;
  }
  return [a / w, b / h, x0, d / w, e / h, y0, g / w, hh / h];
}
/** Where (u, v) of the rectangle lands under a homography: [x, y]. */
export function applyHomography(m, u, v) {
  const [a, b, c, d, e, f, g, h] = m;
  const z = g * u + h * v + 1;
  return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
}
/** The CSS for it (with `transform-origin: 0 0`), or '' for a degenerate quad. */
export function quadMatrix(w, h, q) {
  const m = quadHomography(w, h, q);
  if (!m) return '';
  const [a, b, c, d, e, f, g, hh] = m;
  const n = (v) => (Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(10)));
  // matrix3d is column-major: (u, v, 0, 1) -> x = m11 u + m21 v + m41, y = m12 u + m22 v + m42, w = m14 u + m24 v + m44.
  return `matrix3d(${[a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1].map(n).join(', ')})`;
}
