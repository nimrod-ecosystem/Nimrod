// weather_icons.js — small weather pictures, drawn as inline SVG, coloured only by the theme.
//
// Used by `modules/weather.js`. Kept in its own file so anything else that wants a weather picture
// (the room's window, later) can draw the same one without mounting the module.
//
// COLOUR. No colour is written here. Every fill and stroke is a custom property (`--wx-sun`,
// `--wx-cloud`, `--wx-rain`, `--wx-snow`, `--wx-bolt`, `--wx-fog`), and weather.css points each of
// those at a theme token. The inline fallback is `currentColor`, so an icon drawn somewhere that
// has not loaded weather.css still shows its shape in the text colour rather than in black.
//
// A PICTURE IS NEVER THE ONLY WAY THE WEATHER IS SAID. Every icon carries a label (role="img" +
// aria-label), and weather.js always puts the words next to it.
//
// NO MOVEMENT. Nothing here animates: a static bolt for a storm, no flashes, nothing to switch off
// for somebody who asked for reduced motion.

export const ICON_KINDS = Object.freeze([
  'sun', 'moon', 'partly-day', 'partly-night', 'cloud', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'storm', 'unknown',
]);

const paint = (token, how = 'fill') => `style="${how}:var(--wx-${token}, currentColor)"`;
const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// A cloud in a 64-unit box, moved and scaled. Overlapping filled shapes, no outline, so the joins
// never show.
function cloud(tx = 0, ty = 0, s = 1) {
  return `<g transform="translate(${tx} ${ty}) scale(${s})" ${paint('cloud')}>`
    + '<circle cx="23" cy="36" r="10"/><circle cx="35" cy="29" r="13"/><circle cx="46" cy="37" r="9"/>'
    + '<rect x="13" y="36" width="42" height="10" rx="5"/></g>';
}
function sun(cx = 32, cy = 32, r = 11) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 10), y2 = cy + Math.sin(a) * (r + 10);
    rays.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${paint('sun')}/>`
    + `<g ${paint('sun', 'stroke')} stroke-width="3.5" stroke-linecap="round">${rays.join('')}</g>`;
}
function moon(cx = 32, cy = 32, r = 16) {
  // A crescent: the moon's circle with a bite of the same size, centred on its right edge, taken
  // out. Both circles pass through the two tips, so the path is two arcs and closes cleanly.
  const tx = (cx + r * 0.5).toFixed(1), ty1 = (cy - r * 0.866).toFixed(1), ty2 = (cy + r * 0.866).toFixed(1);
  return `<path ${paint('moon')} d="M${tx} ${ty1} A${r} ${r} 0 1 0 ${tx} ${ty2} A${r} ${r} 0 0 1 ${tx} ${ty1} Z"/>`;
}
const lines = (token, segs, width = 3.5) => `<g ${paint(token, 'stroke')} stroke-width="${width}" stroke-linecap="round">`
  + segs.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('') + '</g>';
const dots = (token, pts, r = 2.4) => `<g ${paint(token)}>${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
function flake(x, y, s = 4) {
  return lines('snow', [[x - s, y, x + s, y], [x - s * 0.5, y - s * 0.87, x + s * 0.5, y + s * 0.87], [x - s * 0.5, y + s * 0.87, x + s * 0.5, y - s * 0.87]], 2.2);
}

const DRAW = {
  sun: () => sun(),
  moon: () => moon(),
  'partly-day': () => sun(22, 22, 8) + cloud(6, 6, 0.92),
  'partly-night': () => moon(22, 22, 11) + cloud(6, 6, 0.92),
  cloud: () => cloud(0, 0, 1.05),
  fog: () => cloud(0, -8, 0.95) + lines('fog', [[12, 46, 52, 46], [16, 53, 48, 53], [12, 60, 44, 60]]),
  drizzle: () => cloud(0, -8, 1) + dots('rain', [[22, 50], [34, 54], [46, 50], [28, 60], [40, 60]]),
  rain: () => cloud(0, -8, 1) + lines('rain', [[22, 46, 18, 58], [34, 46, 30, 58], [46, 46, 42, 58]]),
  sleet: () => cloud(0, -8, 1) + lines('rain', [[22, 46, 18, 58], [42, 46, 38, 58]]) + flake(31, 53),
  snow: () => cloud(0, -8, 1) + flake(21, 50) + flake(33, 57) + flake(45, 50),
  storm: () => cloud(0, -8, 1) + `<path ${paint('bolt')} d="M34 40 L24 54 H31 L27 64 L41 48 H34 L38 40 Z"/>`,
  unknown: () => cloud(0, -4, 1) + `<text x="32" y="42" text-anchor="middle" font-size="18" font-weight="700" ${paint('text')}>?</text>`,
};

/**
 * The SVG for one kind, as a string. `label` is what a screen reader hears; always pass the words.
 *
 *   iconSvg('rain', { label: 'Light rain' })
 */
export function iconSvg(kind, { label = '', cls = 'wx-icon' } = {}) {
  const k = DRAW[kind] ? kind : 'unknown';
  return `<svg class="${escAttr(cls)}" data-icon="${k}" viewBox="0 0 64 64" role="img" aria-label="${escAttr(label || k)}" `
    + `focusable="false">${DRAW[k]()}</svg>`;
}
