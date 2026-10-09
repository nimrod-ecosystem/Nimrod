// modules/bricks.js — "BRICKS", ONE MODULE FOR EVERY NIMROD PART (type 'bricks', row 2.76).
//
// Mike, 2026-10-09: "In the modules module, there shouldn't be a separate module for each brick. Just a bricks
// module. Also, there should be brick colors to match each theme."
//
// The parts, the settings, the matching, the migration and the drawing are ../brick_parts.js (argued there); this
// file is the module around them: it reads its row, picks the published picture or the drawing, and redraws when a
// setting changes. The theme's brick colours are CSS variables (--brick-1 .. --brick-5, brick_colours.js via
// theme.js), so a theme change recolours it with no code here.

import { registerModule } from '../module.js';
import { tintedPicture } from '../brick_builds.js';
import {
  BRICKS_TYPE, BRICKS_TITLE, BRICKS_SETTINGS, bricksOptions, colourCss, partSpec, pictureFor, drawPart, loadParts,
} from '../brick_parts.js';

export * from '../brick_parts.js';

const CSS = `.bk{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;align-items:stretch;gap:6px;
  padding:8px;color:var(--text);min-height:0}
.bk-art{position:relative;flex:1 1 auto;min-height:0}
.bk-art>svg{position:absolute;inset:0;width:100%;height:100%}
.bk-words{margin:0;text-align:center;font-size:1rem;line-height:1.25}`;

registerModule(
  { type: BRICKS_TYPE, title: BRICKS_TITLE, core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'one Nimrod part - a brick, a baseplate, a bracket or a joiner plate - in any size on the 40 mm grid, '
      + 'in one of the theme’s brick colours or your own',
    settings: BRICKS_SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let o = bricksOptions({});
    let doc = ctx.bricksDoc && typeof ctx.bricksDoc === 'object' ? ctx.bricksDoc : null;
    let root = null;
    let dead = false;
    let shown = { how: null, id: null, sig: '' };
    let offState = null;

    function render() {
      if (dead || !root) return;
      const spec = partSpec(o);
      const colour = colourCss(o);
      const pic0 = o.look === 'picture' ? pictureFor(spec, doc) : null;
      const sig = JSON.stringify([spec, colour, pic0 && pic0.id, pic0 && pic0.mirror, o.words]);
      if (sig === shown.sig) return;
      const art = root.querySelector('[data-art]');
      const words = root.querySelector('[data-words]');
      art.innerHTML = '';
      art.dataset.part = spec.part;
      art.setAttribute('aria-label', spec.title);
      const drawn = () => { if (dead) return; art.innerHTML = drawPart(spec, colour); shown = { ...shown, how: 'drawn', id: null, mirror: false }; };
      if (pic0) {
        const pic = tintedPicture(mount.ownerDocument, pic0.url, colour, {
          position: 'center', cls: 'bk-pic', onFail: () => drawn(),
        });
        pic.dataset.part = pic0.id;
        pic.dataset.from = pic0.from;
        if (pic0.mirror) { pic.style.transform = 'scaleX(-1)'; pic.dataset.mirror = ''; }
        art.append(pic);
        shown = { how: 'picture', id: pic0.id, sig, mirror: pic0.mirror, from: pic0.from };
      } else {
        drawn();
        shown.sig = sig;
      }
      words.textContent = spec.title;
      words.hidden = !o.words;
    }

    return {
      async init() {
        mount.innerHTML = `<style data-bricks-css>${CSS}</style><div class="bk" data-bricks>`
          + '<div class="bk-art" data-art role="img"></div><p class="bk-words" data-words></p></div>';
        root = mount.querySelector('[data-bricks]');
        try { await ctx.state?.load?.(); } catch { /* the defaults stand */ }
        if (dead) return;
        o = bricksOptions(state?.get?.() || {});
        try { offState = state?.subscribe?.((v) => { if (dead) return; o = bricksOptions(v || {}); render(); }) || null; } catch { offState = null; }
        render();
        if (!doc) {
          const got = await loadParts();
          if (dead) return;
          doc = got;
          shown.sig = '';
          render();
        }
      },
      onResize() {},
      onHide() {},
      destroy() {
        dead = true;
        try { offState?.(); } catch { /* gone */ }
        mount.innerHTML = '';
      },
      __probe: () => ({ options: { ...o }, spec: partSpec(o), colour: colourCss(o), how: shown.how, published: shown.id,
        mirror: shown.how === 'picture' && !!shown.mirror, from: shown.how === 'picture' ? shown.from : null }),
    };
  },
);
