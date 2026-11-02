/* catKit.js: Nimrod the cat as separate parts (notes 58 and 60), so motions from motionKit.js play on him.
 *
 *   catSvg({ motion, animated = true, face, label }) → '<svg …>' 200×320, standing on the bottom edge,
 *   the same box and placement as castSvg's cat image, so it drops in where the image was.
 *
 * The shapes are taken from assets/nimrod-cat/idle.svg (the outline pass, the fill pass, the legs and
 * the face), split into a body, a tail and a head. Nothing is redrawn except the "happy" eyes, which
 * are new (2026-11-02). Joints: root (his feet), neck (where the head meets the body), tail (its root).
 */
import { MOTIONS, motionCss, stillAttrs } from './motion_kit.js';

/* in the cat's own 208-unit drawing, then placed into 200×320 like the old image */
export const CAT_PIVOTS_LOCAL = { root: [100, 196], neck: [100, 114], tail: [142, 180] };
const PLACE = { x: 20, y: 150, k: 170 / 208, o: 4 };
const toBox = ([x, y]) => [Math.round((PLACE.x + (x + PLACE.o) * PLACE.k) * 100) / 100, Math.round((PLACE.y + (y + PLACE.o) * PLACE.k) * 100) / 100];
export const CAT_PIVOTS = Object.fromEntries(Object.entries(CAT_PIVOTS_LOCAL).map(([k, v]) => [k, toBox(v)]));

const GREY = '#6f7884', BLACK = '#17181c';
const BODY = 'M58 194 C50 158 64 118 100 112 C136 118 150 158 142 194 Z';
const TAIL = 'M138 186 C168 190 186 172 180 146 C177 132 164 130 163 140 C169 154 166 172 142 174 Z';
const LEGS = ['M78 138 H96 V188 Q96 196 87 196 Q78 196 78 188 Z', 'M74 192 A13 7 0 1 0 100 192 A13 7 0 1 0 74 192 Z', 'M104 138 H122 V188 Q122 196 113 196 Q104 196 104 188 Z', 'M100 192 A13 7 0 1 0 126 192 A13 7 0 1 0 100 192 Z'];
const HEAD = 'M100 36 C133 36 147 58 147 80 C147 104 127 118 100 118 C73 118 53 104 53 80 C53 58 67 36 100 36 Z';
const EARS = ['M58 72 Q58 44 62 20 Q80 30 94 42 Z', 'M142 72 Q142 44 138 20 Q120 30 106 42 Z'];
const two = (ds) => `<g fill="${GREY}" stroke="${GREY}" stroke-width="7" stroke-linejoin="round">${ds.map((d) => `<path d="${d}"/>`).join('')}</g><g fill="${BLACK}">${ds.map((d) => `<path d="${d}"/>`).join('')}</g>`;

function eyes(face, id) {
  if (face === 'happy') return `<path d="M69 80q11-11 22 0M109 80q11-11 22 0" stroke="#F2CD62" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
  return [80, 120].map((x) => `<ellipse cx="${x}" cy="78" rx="12" ry="10.5" fill="url(#${id}iris)" stroke="#8f8a3a" stroke-width="1.4"/><ellipse cx="${x}" cy="79" rx="3.8" ry="7.4" fill="#0b0b0d"/><circle cx="${x - 3.4}" cy="75" r="2.3" fill="#fff" opacity=".92"/>`).join('');
}
let N = 0;
const g = (j, st, inner) => `<g class="m-${j}"${st[j] ? ` transform="${st[j]}"` : ''}>${inner}</g>`;

export function catBody({ face = 'neutral', still = {}, id = 'cat' + ++N } = {}) {
  const local = Object.fromEntries(Object.entries(still).filter(([k]) => k !== 'face' && k !== 'rootOpacity'));
  const st = { ...local, face: still.face };
  const tail = g('tail', st, two([TAIL]));
  const body = two([BODY]) + `<g fill="${BLACK}" stroke="#25272c" stroke-width="1.5" stroke-linejoin="round">${LEGS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const legsOutline = `<g fill="${GREY}" stroke="${GREY}" stroke-width="7" stroke-linejoin="round">${LEGS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const faceArt = `<g class="m-face"${st.face ? ` transform="${st.face}"` : ''}>${eyes(face, id)}<path d="M94.5 91 H105.5 L100 97.5 Z" fill="#3b3238" stroke="#5b4f57" stroke-width=".8" stroke-linejoin="round"/>${face === 'happy' ? `<path d="M100 97.5 Q100 104 93 105 M100 97.5 Q100 104 107 105" fill="none" stroke="#6a5e68" stroke-width="2" stroke-linecap="round"/>` : `<path d="M100 97.5 Q100 103 94 104.5 M100 97.5 Q100 103 106 104.5" fill="none" stroke="#6a5e68" stroke-width="1.8" stroke-linecap="round"/>`}<path d="M86 98 L44 90 M114 98 L156 90 M86 98 L42 99 M114 98 L158 99 M86 98 L46 108 M114 98 L154 108" stroke="#aab2bb" stroke-width="1.15" stroke-linecap="round" opacity=".85"/></g>`;
  const head = g('neck', st, two([HEAD, ...EARS]) + `<ellipse cx="100" cy="52" rx="26" ry="10" fill="#2b2e35" opacity=".75"/><path d="M66 60 L67 33 L87 46 Z" fill="#4d3a3f"/><path d="M134 60 L133 33 L113 46 Z" fill="#4d3a3f"/>` + faceArt);
  return `<defs><radialGradient id="${id}iris" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#F2CD62"/><stop offset="1" stop-color="#C99536"/></radialGradient></defs>`
    + g('root', st, tail + legsOutline + body + head);
}

export function catSvg({ motion, animated = true, face, label = 'Nimrod the cat' } = {}) {
  const m = typeof motion === 'string' ? MOTIONS[motion] : motion;
  const id = 'nc' + ++N;
  const still = m ? stillAttrs(m, CAT_PIVOTS_LOCAL) : {};
  const css = m && animated ? motionCss(id, m, CAT_PIVOTS_LOCAL) : '';
  const f = face || (m && (m.face === 'happy' ? 'happy' : 'neutral')) || 'neutral';
  const name = m ? `${label}, ${m.name}` : label;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 320" role="img" aria-label="${name}" id="${id}"><title>${name}</title>${css}<g transform="translate(${PLACE.x} ${PLACE.y}) scale(${PLACE.k}) translate(${PLACE.o} ${PLACE.o})">${catBody({ face: f, still, id })}</g></svg>`;
}
