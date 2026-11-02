/* stageFit.js: how a 16:9 backdrop fills a screen of another shape (Mike, 2026-11-02, note 57.3).
 *
 * Mike: crop by default, letterbox as the setting, and "have the themes be built extended beyond what
 * normal screens would use for odd sizes". So every backdrop is drawn past its 1600×900 stage by a
 * BLEED on each side; a wider or taller screen shows some of the bleed before anything is cropped or
 * boxed. Nothing important goes in the bleed or near the stage edge.
 *
 *   STAGE_FIT_DEFAULTS = { fit, bleed, bleedArt, barColour }      all settings
 *     bleedArt  'mirror' (default): the stage's own edges mirrored outward, seamless at the edge;
 *               'none': the stage alone (if mirroring costs too much on the Pi 400; Code to measure)
 *   fitStageSvg(svg, { aspect, fit, bleed, bleedArt, barColour }) → the same SVG, fitted to a screen
 *   fitBox(aspect, { fit, bleed }) → { x, y, w, h, viewBox, par }  the part of the drawing to show
 *
 * The default bleed covers screens from about 5:4 (a tall 1600×1300) to about 22:9 (a wide 2240×900)
 * with no cropping and no bars. Past that:
 *   crop       fill the screen, trimming the drawing's far edges (top and bottom on very wide screens)
 *   letterbox  show the whole bled drawing, with bars in the backdrop's own edge colour
 */
export const STAGE = [1600, 900];
export const STAGE_FIT_DEFAULTS = { fit: 'crop', bleed: [320, 200], bleedArt: 'mirror', barColour: '#000000' };
let UID = 0;

export function fitBox(aspect, { fit = STAGE_FIT_DEFAULTS.fit, bleed = STAGE_FIT_DEFAULTS.bleed } = {}) {
  const [W, H] = STAGE, a = aspect > 0 ? aspect : W / H, [bx, by] = bleed;
  let w, h;
  if (a >= W / H) {
    h = H; w = H * a;
    const max = W + 2 * bx;
    if (w > max) { w = max; if (fit === 'crop') h = max / a; }
  } else {
    w = W; h = W / a;
    const max = H + 2 * by;
    if (h > max) { h = max; if (fit === 'crop') w = max * a; }
  }
  const x = (W - w) / 2, y = (H - h) / 2, r = (n) => Math.round(n * 100) / 100;
  return { x: r(x), y: r(y), w: r(w), h: r(h), viewBox: `${r(x)} ${r(y)} ${r(w)} ${r(h)}`, par: fit === 'crop' ? 'xMidYMid slice' : 'xMidYMid meet' };
}

/* Bleed made by mirroring the stage's own edges, for scenes whose pieces are not drawn wide (the
   village). Seamless at the stage edge by construction. `id` is the group holding the stage. */
export function mirrorBleed(id, bleed = STAGE_FIT_DEFAULTS.bleed, { bottom } = {}) {
  /* Draws the stage held in <defs> as #id, plus its edges mirrored outward. Sides first; then the
     widened stage is mirrored upward and drawn out downward, which fills the corners too. Seamless at every edge. */
  const [W, H] = STAGE, [bx, by] = bleed, c = id + 'mb';
  const clip = (n, x, y, w, h) => `<clipPath id="${c}${n}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`;
  const wide = `<g id="${c}w"><use href="#${id}"/>`
    + clip('l', -bx, 0, bx, H) + `<g clip-path="url(#${c}l)"><use href="#${id}" transform="scale(-1 1)"/></g>`
    + clip('r', W, 0, bx, H) + `<g clip-path="url(#${c}r)"><use href="#${id}" transform="translate(${2 * W} 0) scale(-1 1)"/></g></g>`;
  return wide
    + clip('t', -bx, -by, W + 2 * bx, by) + `<g clip-path="url(#${c}t)"><use href="#${c}w" transform="scale(1 -1)"/></g>`
    /* the bottom is not mirrored (people and rugs would stand on their heads): its last few rows are
       drawn out downward instead, so the ground simply carries on; or a scene names its own ground
       colour (`bleedBottom`) when something sits on its bottom edge, like Diwali's rangoli */
    + (bottom ? `<rect x="${-bx}" y="${H - 0.5}" width="${W + 2 * bx}" height="${by + 0.5}" fill="${bottom}"/>`
      : clip('b', -bx, H, W + 2 * bx, by) + `<g clip-path="url(#${c}b)"><use href="#${c}w" transform="translate(0 ${H}) scale(1 ${by / 6}) translate(0 ${-(H - 6)})"/></g>`);
}

/* Fit any finished 1600×900 stage SVG (a village scene, a backdrop) to a screen's shape. */
export function fitStageSvg(svg, { aspect, fit = STAGE_FIT_DEFAULTS.fit, bleed = STAGE_FIT_DEFAULTS.bleed, bleedArt = STAGE_FIT_DEFAULTS.bleedArt, barColour = STAGE_FIT_DEFAULTS.barColour, bleedBottom } = {}) {
  if (!aspect) return svg;
  const m = svg.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
  if (!m) return svg;
  const box = fitBox(aspect, { fit, bleed }), id = 'sf' + ++UID;
  let attrs = m[1].replace(/\sviewBox="[^"]*"/, '').replace(/\spreserveAspectRatio="[^"]*"/, '').replace(/\sstyle="[^"]*"/, '');
  const style = ` style="display:block;width:100%;height:100%;overflow:hidden;${fit === 'letterbox' || bleedArt !== 'mirror' ? `background:${barColour};` : ''}"`;
  /* keep <style> blocks at the top level so animations still apply inside <use> copies */
  const styles = (m[2].match(/<style>[\s\S]*?<\/style>/g) || []).join(''), inner = m[2].replace(/<style>[\s\S]*?<\/style>/g, '');
  const body = bleedArt === 'mirror' ? `<defs><g id="${id}">${inner}</g></defs>` + mirrorBleed(id, bleed, { bottom: bleedBottom }) : inner;
  return `<svg${attrs} viewBox="${box.viewBox}" preserveAspectRatio="${box.par}"${style}>${styles}${body}</svg>`;
}
