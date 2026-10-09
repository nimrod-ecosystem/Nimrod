// baseplate_art.js — A PICTURE OF ANY NIMROD BASEPLATE, DRAWN FROM ITS SIZE. NO MODEL, NO DOWNLOAD.
//
// Mike, 2026-10-09 (row 2.76): "make some more baseplate type bricks: One group with a 5mm height and another
// with 10mm. Then every combination of multiples of 40 for the other dimensions." That is 72 parts (W <= D,
// 40..320 mm, at 5 and 10 mm), modelled in the private repo (build123d/nimrod_bricks.py `baseplate()`, batch +
// checks in build123d/modl_baseplate_v1.py). Publishing 72 GLBs and 144 baked pictures for what is, every
// time, a flat slab with a 10 mm socket at the centre of each 40 mm square would be megabytes of near-copies.
//
// *** SO THE SITE DRAWS A BASEPLATE FROM ITS NUMBERS. *** `baseplateSvg(w, d, h)` is an isometric picture of
// the plate -- top, two sides, one socket per 40 mm cell -- in GREYS, the same convention as the baked brick
// pictures (design-assets/bricks/renders): `tintedPicture` (brick_builds.js) multiplies a theme colour into it,
// masked to its shape, so a baseplate follows the theme exactly as a brick picture does. Pass
// `baseplateDataUrl(...)` where a picture URL goes. Any size the CAD accepts draws; nothing is fetched.
//
// The ids are the CAD's own (`modl_<WWW>x<D>x<H>_sockets_v1`, W zero-padded to three, W <= D), so a picture,
// a print file and a row in the private fit table all name the same part.

export const CELL_MM = 40;
export const SOCKET_MM = 10;
/** The two groups Mike asked for. Not a limit: baseplateSvg draws any thickness over 1 mm. */
export const BASEPLATE_HEIGHTS = Object.freeze([5, 10]);
/** 40, 80, ... 320: the catalogued sides (the CAD takes any multiple of 40). */
export const BASEPLATE_SIDES = Object.freeze(Array.from({ length: 8 }, (_, i) => CELL_MM * (i + 1)));

const isSide = (v) => Number.isInteger(v) && v > 0 && v % CELL_MM === 0;
const isHeight = (v) => Number.isFinite(v) && v > 1;

/** The CAD id for a W x D x H baseplate (W, D turned so W <= D), or null if it is not one. */
export function baseplateId(w, d, h) {
  if (!isSide(w) || !isSide(d) || !isHeight(h) || !Number.isInteger(h)) return null;
  const [a, b] = w <= d ? [w, d] : [d, w];
  return `modl_${String(a).padStart(3, '0')}x${b}x${h}_sockets_v1`;
}

/** { w, d, h } from a baseplate id, or null. */
export function parseBaseplateId(id) {
  const m = typeof id === 'string' ? /^modl_(\d{3,})x(\d+)x(\d+)_sockets_v1$/.exec(id) : null;
  if (!m) return null;
  const [w, d, h] = m.slice(1).map(Number);
  return isSide(w) && isSide(d) && isHeight(h) ? { w, d, h } : null;
}

/** Every catalogued baseplate id: W <= D over BASEPLATE_SIDES, at each height (72). */
export function baseplateIds(sides = BASEPLATE_SIDES, heights = BASEPLATE_HEIGHTS) {
  const out = [];
  for (const h of heights) for (let i = 0; i < sides.length; i++) for (let j = i; j < sides.length; j++) out.push(baseplateId(sides[i], sides[j], h));
  return out;
}

// Isometric: x runs down-right, y down-left, z up. A circle of radius r on the top face becomes an ellipse
// r*sqrt(2)*cos30 wide and r*sqrt(2)*sin30 tall, axis-aligned on screen.
const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
const iso = (x, y, z) => [(x - y) * C30, (x + y) * S30 - z];
const pt = ([a, b]) => `${+a.toFixed(2)},${+b.toFixed(2)}`;

// Greys (multiplied by the theme colour when tinted): top lightest, the two sides darker, sockets darkest.
const SHADE = Object.freeze({ top: '#e6e6e6', right: '#a8a8a8', left: '#c4c4c4', hole: '#5c5c5c', wall: '#8a8a8a', edge: '#7a7a7a' });

/**
 * An isometric picture of a W x D x H mm baseplate, as an SVG string (greys, transparent around it).
 * `span`: draw at the scale of a span x span plate (so a row of different sizes compares by size); default
 * fits this plate. `title`: accessible name (default "Baseplate W x D x H mm"). Returns '' for a size that is
 * not a baseplate.
 */
export function baseplateSvg(w, d, h, { span = null, title = null, pad = 6 } = {}) {
  if (!isSide(w) || !isSide(d) || !isHeight(h)) return '';
  const fitW = span && isSide(span) ? Math.max(span, w) : w;
  const fitD = span && isSide(span) ? Math.max(span, d) : d;
  const fitH = span && isSide(span) ? Math.max(10, h) : h;
  // The frame is the projected box of the plate (or of the span plate) plus padding; the plate itself sits
  // centred left-to-right and on the bottom of it (a smaller plate in a span frame stands where a bigger one would).
  const box = (W, D, H) => {
    const c = [];
    for (const x of [0, W]) for (const y of [0, D]) for (const z of [0, H]) c.push(iso(x, y, z));
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const f = box(fitW, fitD, fitH), o = box(w, d, h);
  const vw = f.x1 - f.x0 + 2 * pad, vh = f.y1 - f.y0 + 2 * pad;
  const sx = pad + ((f.x1 - f.x0) - (o.x1 - o.x0)) / 2 - o.x0;
  const sy = pad + (f.y1 - f.y0) - (o.y1 - o.y0) - o.y0;
  const P = (x, y, z) => { const [a, b] = iso(x, y, z); return [a + sx, b + sy]; };

  const top = [P(0, 0, h), P(w, 0, h), P(w, d, h), P(0, d, h)];
  const right = [P(w, 0, h), P(w, d, h), P(w, d, 0), P(w, 0, 0)];   // the x = W face
  const left = [P(0, d, h), P(w, d, h), P(w, d, 0), P(0, d, 0)];    // the y = D face
  const poly = (pts, fill) => `<polygon points="${pts.map(pt).join(' ')}" fill="${fill}" stroke="${SHADE.edge}" stroke-width="0.6" stroke-linejoin="round"/>`;

  const rx = (SOCKET_MM / 2) * Math.SQRT2 * C30;
  const ry = (SOCKET_MM / 2) * Math.SQRT2 * S30;
  // Looking down a through-bore: the rim is an ellipse; its far inner wall shows; the opening at the bottom
  // face is the same ellipse dropped by the thickness, and the dark part is where the two overlap (empty once
  // the plate is thicker than the ellipse is tall -- then only wall shows, as on a real 10 mm plate).
  const n = (v) => +v.toFixed(2);
  const holes = [];
  for (let i = 0; i < w / CELL_MM; i++) {
    for (let j = 0; j < d / CELL_MM; j++) {
      const [cx, cy] = P(CELL_MM / 2 + i * CELL_MM, CELL_MM / 2 + j * CELL_MM, h);
      let g = `<g data-socket="${i},${j}"><ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${SHADE.wall}"/>`;
      if (h < 2 * ry) {
        const yi = cy + h / 2;
        const xi = rx * Math.sqrt(1 - (h / 2 / ry) ** 2);
        g += `<path data-through="1" d="M${n(cx - xi)},${n(yi)} A${n(rx)},${n(ry)} 0 0 1 ${n(cx + xi)},${n(yi)} A${n(rx)},${n(ry)} 0 0 1 ${n(cx - xi)},${n(yi)} Z" fill="${SHADE.hole}"/>`;
      }
      holes.push(`${g}</g>`);
    }
  }
  const name = title || `Baseplate ${w} × ${d} × ${h} mm`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${+vw.toFixed(2)} ${+vh.toFixed(2)}" role="img" aria-label="${esc(name)}" data-baseplate="${esc(baseplateId(w, d, h) || '')}"><title>${esc(name)}</title>`
    + poly(left, SHADE.left) + poly(right, SHADE.right) + poly(top, SHADE.top) + holes.join('') + '</svg>';
}

/** The same picture as a data: URL, for anywhere a picture URL goes (an <img>, tintedPicture's mask). */
export function baseplateDataUrl(w, d, h, opts = {}) {
  const svg = baseplateSvg(w, d, h, opts);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
