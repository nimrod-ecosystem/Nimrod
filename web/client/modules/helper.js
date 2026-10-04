// modules/helper.js — NIMROD AT THE BOTTOM, type 'helper': a small "Ask Nimrod" over a page (Mike, 2026-10-04: "probably
// keep a Nimrod at the bottom as a helper overlaid on the screen"). It is put OVER the dashboard (layout.js
// `place: 'overlay'`, 9a7d972), so it can be moved, made bigger or taken off like any overlay; the people page
// (dashboards.js `people`) starts with it in the bottom right-hand corner.
//
// *** WHY A SMALL BUTTON AND NOT NIMROD HIMSELF IN THE CORNER. *** Nimrod's panel (modules/nimrod.js) is a talk box, a
// map and a row of choices; in an overlay's box (a quarter of a phone's width) it would be a word per line. So the
// corner holds his face and two words, and a press opens him properly, over the page beside it: it asks
// (people_page.js HELPER_OPEN_TOPIC) and the page that can show him (modules/people.js) answers. Over a page that
// cannot, the helper says where he is instead -- one line, nothing to dismiss.
//
// NOTHING HAPPENS WITHOUT A PRESS: no speech, no movement on its own (the cat's still picture).

import { registerModule } from '../module.js';
import { catImageURL } from '../cat_guide.js';
import { HELPER_TYPE, HELPER_OPEN_TOPIC, HELPER_VERB_TOPICS } from '../people_page.js';

export const HELPER_LABEL = 'Ask Nimrod';
export const HELPER_ELSEWHERE = 'Nimrod opens beside your people. Here, he is in the ⚙ menu: Nimrod’s tutorial.';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every colour a theme token. The whole box is the button: the target is the overlay, never smaller than 44px.
const STYLE = `
.hp-root{box-sizing:border-box;height:100%;width:100%;display:flex}
.hp-btn{flex:1 1 auto;min-height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 10px;
  border:2px solid var(--accent);border-radius:14px;background:var(--surface);color:var(--text-strong);font:inherit;font-weight:700;
  font-size:1.05rem;cursor:pointer;text-align:left;overflow:hidden}
.hp-btn img{flex:0 0 auto;width:min(2.6rem,40%);height:auto;max-height:100%;display:block}
.hp-btn span{overflow-wrap:normal;line-height:1.15}
.hp-btn.is-scan,.hp-btn:focus-visible{outline:4px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.hp-note{margin:0;padding:6px;color:var(--text);font-size:.9rem}
`;

registerModule(
  { type: HELPER_TYPE, title: 'Nimrod, the helper', core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'Nimrod’s face and “Ask Nimrod”, small, over a page: a press opens him', settings: [] },
  (ctx) => {
    const { mount } = ctx;
    let root = null;
    let said = '';
    const offs = [];

    function render() {
      if (!root) return;
      root.innerHTML = said
        ? `<p class="hp-note" data-hp-note role="status">${esc(said)}</p>`
        : `<button type="button" class="hp-btn" data-hp-open aria-label="${esc(HELPER_LABEL)}"><img src="${esc(catImageURL('wave'))}" alt=""><span>${esc(HELPER_LABEL)}</span></button>`;
    }
    function open() {
      let claimed = false;
      try { ctx.bus?.publish?.(HELPER_OPEN_TOPIC, { source: HELPER_TYPE, instanceId: ctx.instanceId || null, claim: () => { claimed = true; } }); }
      catch (err) { console.error('helper: open', err); }
      if (!claimed) {
        said = HELPER_ELSEWHERE;
        render();
        // The line goes back to the button by itself: it is words, not a state anybody has to leave.
        setTimeout(() => { said = ''; render(); }, 8000);
      }
    }
    const onClick = (e) => { if (e.target instanceof Element && e.target.closest('[data-hp-open]')) open(); };

    return {
      init() {
        const doc = mount.ownerDocument;
        root = doc.createElement('div');
        root.className = 'hp-root';
        root.setAttribute('data-helper', '');
        const style = doc.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        root.addEventListener('click', onClick);
        render();
        try { const off = ctx.bus?.subscribe?.(HELPER_VERB_TOPICS.select, () => open()); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ }
      },
      onResize() {},
      onHide() {},
      destroy() {
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        root?.removeEventListener('click', onClick);
        mount.innerHTML = '';
        root = null;
      },
      __probe: () => ({ said }),
    };
  },
);
