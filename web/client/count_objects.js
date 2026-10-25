/* countObjects.js: a library of small pictures to count, for lessons, board cards, games and buttons.
 *
 * Plain JavaScript that returns SVG strings, so web/client ships it as it is.
 *
 *   objectSvg(name, { theme, size, color })       → '<svg …>'   one picture
 *   countSvg(name, n, { theme, size, perRow })      → { svg, warnings }   n of them, in rows of five
 *   frameSvg('fiveFrame'|'tenFrame', n, { item, theme, size }) → { svg, warnings }
 *   OBJECTS[name] = { label, set: 'adult'|'child'|'both', themed, parts }
 *
 * ONE LOOK FOR EVERY THEME: a "sticker". Each picture is flat colour with a dark ink outline, and a
 * cream keyline round the outside. The keyline separates it from any background, light or dark, so
 * the pictures work on all 21 themes without a version each. Only the THEMED ones (dot, star, ball,
 * balloon, the frames) take the theme's palette; the rest keep their real colours, because a duck
 * should be yellow and an apple red in every theme.
 *
 * GROWN-UP vs CHILD. The grown-up set (cup, key, coin, apple, star, dot, frames) has true proportions,
 * muted colour, a thinner outline and no faces. The child set (duck, ball, balloon) is rounder and
 * brighter, with a thicker outline and, for animals, an eye. A lesson picks the set, so an adult's
 * maths never shows a smiling duck unless someone chooses it.
 *
 * READING AS A NUMBER. countSvg lays pictures out in rows of five with a gap after each five, the
 * way a ten-frame does, so 7 reads as "five and two" at a glance. Pictures are sized and spaced so
 * five in a row stay separate even at 20px each.
 *
 * Contrast is a warning, never a block (Mike's ruling). */

const INK = '#1b1d22', KEY = '#fbf8ee';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* A part is [element start, fill] or [element start, null, lineWidth, lineColour] for a stroke-only
   line. The renderer adds fill and stroke, and draws every part twice: first wide in the keyline
   colour, then for real. */
const F = (el, fill) => ({ el, fill });
const LN = (el, w, color = INK) => ({ el, line: w, color });

export const OBJECTS = {
  loaf: { label: 'Loaf', set: 'adult', parts: [
    F('<path d="M10 70q0-34 40-36 40 2 40 36v8q0 6-6 6H16q-6 0-6-6z"', '#c8873a'),
    LN('<path d="M34 46l-6 14M52 42l-4 16M70 46l-4 14"', 4, '#8a5420'),
    F('<path d="M16 72h68v8H16z"', '#a86a28'),
  ] },
  egg: { label: 'Egg', set: 'adult', parts: [
    F('<path d="M50 12q24 0 30 40 4 36-30 38-34-2-30-38 6-40 30-40z"', '#f2e6cc'),
    LN('<path d="M50 12q24 0 30 40 4 36-30 38-34-2-30-38 6-40 30-40z"', 3, '#b8a888'),
  ] },
  candle: { label: 'Candle', set: 'adult', parts: [
    F('<rect x="38" y="36" width="24" height="52" rx="3"', '#f4ecd8'),
    LN('<rect x="38" y="36" width="24" height="52" rx="3"', 3, '#b8a888'),
    F('<path d="M50 32q-8-10 0-22 8 12 0 22z"', '#f2a83a'),
    F('<rect x="30" y="86" width="40" height="8" rx="3"', '#c9a24a'),
  ] },
  sack: { label: 'Sack', set: 'adult', parts: [
    F('<path d="M32 26q-6 8 0 12-18 14-18 34 0 18 36 18t36-18q0-20-18-34 6-4 0-12z"', '#c8b48a'),
    LN('<path d="M34 34q16 6 32 0"', 4, '#8a6a3a'),
    LN('<path d="M44 58h12M50 52v12"', 3, '#8a6a3a'),
  ] },
  cup: { label: 'Cup', set: 'adult', parts: [
    LN('<path d="M70 42h7q11 0 11 12t-11 12h-7"', 7),
    F('<path d="M20 30h52v36q0 16-16 16H36q-16 0-16-16z"', '#c9d8e4'),
    F('<ellipse cx="46" cy="30" rx="26" ry="6"', '#8aa2b6'),
    F('<rect x="20" y="44" width="52" height="8"', '#2f6d96'),
  ] },
  key: { label: 'Key', set: 'adult', parts: [
    F('<path d="M44 45H88V55H84V66H76V55H70V63H62V55H44z"', '#d8b04a'),
    F('<circle cx="28" cy="50" r="19"', '#d8b04a'),
    F('<circle cx="24" cy="50" r="6"', KEY),
  ] },
  coin: { label: 'Coin', set: 'adult', parts: [
    F('<circle cx="50" cy="50" r="40"', '#d9a93a'),
    LN('<circle cx="50" cy="50" r="31"', 3, '#a87a1e'),
    F('<path d="M50 32l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z"', '#f2cf6a'),
  ] },
  duck: { label: 'Duck', set: 'child', parts: [
    F('<path d="M14 58q0-14 18-14h22q8-18 24-14 12 4 8 18-2 6-8 8 14 6 10 18-4 14-22 14H34Q14 88 14 70z"', '#f6d23e'),
    F('<path d="M84 40q10 0 12 4-2 6-12 6z"', '#f08a2c'),
    F('<circle cx="74" cy="38" r="4"', INK),
    LN('<path d="M34 62q12 10 26 2"', 4, '#c9a21e'),
  ] },
  apple: { label: 'Apple', set: 'adult', parts: [
    F('<path d="M50 30q-10-8-22-4-16 6-14 28 2 22 16 32 10 6 20 0 10 6 20 0 14-10 16-32 2-22-14-28-12-4-22 4z"', '#c8392f'),
    LN('<path d="M50 30q0-12 6-18"', 5, '#5a3a20'),
    F('<path d="M56 20q10-10 22-6-4 12-22 6z"', '#5b8c3a'),
    F('<ellipse cx="34" cy="46" rx="5" ry="9"', '#e8776c'),
  ] },
  ball: { label: 'Ball', set: 'child', themed: true, parts: [
    F('<circle cx="50" cy="50" r="40"', '$1'),
    F('<path d="M12 40q38 14 76 0 4 10 0 20Q50 74 12 60q-4-10 0-20z"', '$2'),
    F('<circle cx="36" cy="34" r="6"', '#ffffff'),
  ] },
  balloon: { label: 'Balloon', set: 'child', themed: true, parts: [
    LN('<path d="M50 74q-8 10 0 18t0 8"', 3, INK),
    F('<ellipse cx="50" cy="40" rx="30" ry="34"', '$1'),
    F('<path d="M44 74h12l-6 7z"', '$1'),
    F('<ellipse cx="38" cy="28" rx="6" ry="9"', '#ffffff'),
  ] },
  star: { label: 'Star', set: 'both', themed: true, parts: [
    F('<path d="M50 8l12 26 28 3-21 19 6 28-25-14-25 14 6-28-21-19 28-3z"', '$1'),
  ] },
  dot: { label: 'Dot', set: 'both', themed: true, parts: [F('<circle cx="50" cy="50" r="34"', '$1')] },
};
export const COUNT_FRAMES = { fiveFrame: { label: 'Five-frame', cols: 5, rows: 1 }, tenFrame: { label: 'Ten-frame', cols: 5, rows: 2 } };
export const OBJECT_NAMES = [...Object.keys(OBJECTS), ...Object.keys(COUNT_FRAMES)];

/* ---------- colour ---------- */
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); const n = parseInt(h.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (h) => { const c = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* A theme here is just { bg, palette }. Pass lessonTheme(theme) from lesson_kit.js, or your own. */
const NIMROD = { bg: '#F7F4D5', palette: ['#839958', '#105666', '#D3968C', '#c9a24a', '#9e5449'] };
function themed(theme, color) {
  const p = (theme && theme.palette) || NIMROD.palette;
  const one = color || p[0], two = p.find((c) => c !== one && contrast(c, one) > 1.6) || '#fbf8ee';
  return { $1: one, $2: two };
}

function parts(name, theme, color) {
  const o = OBJECTS[name]; if (!o) return '';
  const sub = o.themed ? themed(theme, color) : {};
  const fillOf = (f) => (f && f[0] === '$' ? sub[f] : f);
  const ink = o.set === 'child' ? 5 : 3.5, key = ink + 7;
  const draw = (p, halo) => {
    if (p.line) return `${p.el} fill="none" stroke="${halo ? KEY : p.color}" stroke-width="${halo ? p.line + 7 : p.line}" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `${p.el} fill="${halo ? KEY : fillOf(p.fill)}" stroke="${halo ? KEY : INK}" stroke-width="${halo ? key : ink}" stroke-linejoin="round"/>`;
  };
  return o.parts.map((p) => draw(p, true)).join('') + o.parts.map((p) => draw(p, false)).join('');
}

export function objectSvg(name, { theme, size = 48, color, label } = {}) {
  const o = OBJECTS[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 108 108" width="${size}" height="${size}" role="img" aria-label="${esc(label ?? (o ? o.label : name))}">${parts(name, theme, color)}</svg>`;
}

function warn(name, theme) {
  const o = OBJECTS[name]; if (!o) return [];
  const bg = (theme && theme.bg) || NIMROD.bg;
  const main = o.themed ? themed(theme).$1 : o.parts.find((p) => p.fill && p.fill[0] !== '$').fill;
  const r = contrast(main, bg);
  return r < 3 ? [{ what: `${o.label} colour on the background`, fg: main, bg, ratio: +r.toFixed(2), min: 3, note: 'The outline and keyline still separate it.' }] : [];
}

/* n pictures in rows of five, with a wider gap after each five across a row. */
export function countSvg(name, n, { theme, size = 40, perRow = 10, label } = {}) {
  if (COUNT_FRAMES[name]) return frameSvg(name, n, { theme, size });
  const gap = size * 0.18, group = size * 0.5, cols = Math.min(n, perRow), rows = Math.ceil(n / perRow);
  const groupsAcross = Math.ceil(cols / 5);
  const W = cols * size + (cols - 1) * gap + (groupsAcross - 1) * group, H = rows * size + (rows - 1) * gap;
  const one = parts(name, theme), out = [];
  for (let i = 0; i < n; i += 1) {
    const c = i % perRow, r = Math.floor(i / perRow), x = c * (size + gap) + Math.floor(c / 5) * group, y = r * (size + gap);
    out.push(`<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="-4 -4 108 108">${one}</svg>`);
  }
  const o = OBJECTS[name];
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label ?? `${n} ${o ? (n === 1 ? o.label : o.label + 's').toLowerCase() : name}`)}">${out.join('')}</svg>`, warnings: warn(name, theme) };
}

/* Five-frame and ten-frame. `item` is any picture name (default: dot). Filled cells go left to
   right along the top row first, the way frames are taught. */
export function frameSvg(kind = 'tenFrame', n = 0, { item = 'dot', theme, size = 44 } = {}) {
  const f = COUNT_FRAMES[kind] || COUNT_FRAMES.tenFrame, pad = size * 0.12, line = Math.max(2, size * 0.07);
  const W = f.cols * size + line, H = f.rows * size + line;
  const bg = (theme && theme.bg) || NIMROD.bg, cell = contrast('#ffffff', bg) < 1.3 ? '#f2efe2' : '#ffffff';
  const out = [`<rect x="${line / 2}" y="${line / 2}" width="${W - line}" height="${H - line}" rx="${size * 0.1}" fill="${cell}" stroke="${INK}" stroke-width="${line}"/>`];
  for (let c = 1; c < f.cols; c += 1) out.push(`<rect x="${c * size + line / 2 - line / 2}" y="${line / 2}" width="${line}" height="${H - line}" fill="${INK}"/>`);
  for (let r = 1; r < f.rows; r += 1) out.push(`<rect x="${line / 2}" y="${r * size + line / 2 - line / 2}" width="${W - line}" height="${line}" fill="${INK}"/>`);
  const one = parts(item, theme), filled = Math.min(n, f.cols * f.rows);
  for (let i = 0; i < filled; i += 1) {
    const c = i % f.cols, r = Math.floor(i / f.cols);
    out.push(`<svg x="${c * size + line / 2 + pad}" y="${r * size + line / 2 + pad}" width="${size - pad * 2}" height="${size - pad * 2}" viewBox="-4 -4 108 108">${one}</svg>`);
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${f.label} with ${filled} of ${f.cols * f.rows} filled`)}">${out.join('')}</svg>`, warnings: warn(item, theme) };
}
