// beta.js — LIVE AND BETA, AS PEOPLE SEE IT (Mike, 2026-10-14).
//
// Mike: *"I would like to have something polished and professional as far as this is what's ready now on the site, but
// I don't think there will ever be a point where everything is polished and professional. ... There just needs to be a
// delineation between this is what we're pretty confident in now vs. these are the new things we're still tweaking."*
// Both are public.
//
// WHICH THINGS ARE WHICH is data: `stage` on every catalog entry, and PAGE_STAGES for pages (modules_catalog.js). This
// file is only how the difference is SHOWN, so every list says it the same way:
//   * a list of modules puts live ones first and beta ones after, in their own section ("Beta: still being tweaked"),
//     each with a small Beta badge, a one-line explanation and the way to send feedback (`splitStages`, BETA_WORDS);
//   * a person can hide the beta section (`BETA_FIELD`, below);
//   * a beta module already on a dashboard keeps working, and says "Beta" only in edit mode and in its own settings;
//   * a beta page carries a small banner along its top (`mountBetaBanner`).
//
// *** THE DEFAULTS, ARGUED (Rule 1; on Mike's list in the proposal). ***
//   showBeta 'section'  Beta things show, after everything else, in their own section.
//       FOR hiding them by default: a newcomer judging whether to trust this with somebody's care sees only the
//       finished part, which is the polish Mike asked for.
//       AGAINST, and it wins: Mike said beta stays public, and a section nobody can see is a section nobody tries -
//       which is how a beta thing earns its way to live. The section, the badge and live-first already give the
//       newcomer the line between the two; hiding is one choice away for anybody who wants only the finished part.
//   WHO it follows: THE PERSON (their own row, beside "How you choose things"), else the screen's row when the screen
//       has no person, else this browser (signed out). FOR the account instead: one choice for everybody on it. AGAINST,
//       and it wins: an account holds several people - a therapist who wants only the finished games and a grandson
//       who wants everything new - and the person's row is where the menu already keeps how somebody uses things.
//   The banner on a beta page can be put away (×), remembered in this browser per page: it is a line of words, not a
//       gate, and somebody who has read it once does not need it every visit. Nothing waits on it either way.
//   The feedback link is the project's public issue list - the "Report a problem or ask for something" link the
//       landing page already has. ON A SCREEN it is left out: a link there can only open over the dashboard, and the
//       library's rule for addresses on a screen (page_links.js) is that a screen never opens one.
//
// Site copy here never names anybody and never says "her screen".

import { pageStageOf } from './modules_catalog.js';

export const BETA_KEY = 'showBeta';
export const BETA_SHOW = Object.freeze(['section', 'hide']);
export const DEFAULT_BETA_SHOW = 'section';
// Two options, so it is a quick row (one press flips it). `standard`: not one of the essentials (legibility and the ways
// out), and not hidden behind "Everything" either - it decides what every list of modules shows.
export const BETA_FIELD = Object.freeze({
  key: BETA_KEY, label: 'Beta things (still being tweaked)', kind: 'choice', level: 'standard',
  default: DEFAULT_BETA_SHOW,
  options: Object.freeze([
    Object.freeze({ value: 'section', label: 'Show them, after the rest, in their own section' }),
    Object.freeze({ value: 'hide', label: 'Hide them' }),
  ]),
  note: 'Beta modules on a dashboard keep working either way. This only changes the lists you choose from.',
});
/** A stored value as one of BETA_SHOW; anything else is the default. Pure. */
export function betaShowOf(v) {
  return BETA_SHOW.includes(v) ? v : DEFAULT_BETA_SHOW;
}

// The words, in one place, so the library, Home's lists and the pages say the same thing.
export const BETA_WORDS = Object.freeze({
  badge: 'Beta',
  heading: 'Beta: still being tweaked',
  line: 'These work, and are still changing. They may look or work differently next week.',
  detail: 'Beta: still being tweaked. It works, and it may still change.',
  panel: 'Beta: still being tweaked',
  panelHint: 'it works, and it may still change',
  page: 'Beta: this page is still being tweaked. It works, and it may still change.',
  feedback: 'Tell us what you think',
  hide: 'Hide these',
  show: 'Show them',
  hiddenOne: '1 more is in Beta (still being tweaked), hidden.',
  hiddenMany: '{n} more are in Beta (still being tweaked), hidden.',
});
export const FEEDBACK_HREF = 'https://github.com/nimrod-ecosystem/Nimrod/issues';
export const hiddenWords = (n) => (n === 1 ? BETA_WORDS.hiddenOne : BETA_WORDS.hiddenMany.replace('{n}', String(n)));

/**
 * Live first, beta after, each in the order it came (a stable split). `stageOf(item)` -> 'live' | 'beta'; by default
 * the item's own `stage`. Anything that is not 'beta' counts as live. Pure.
 */
export function splitStages(items, stageOf = (it) => it && it.stage) {
  const live = [];
  const beta = [];
  for (const it of Array.isArray(items) ? items : []) {
    let s = 'live';
    try { s = stageOf(it); } catch { s = 'live'; }
    (s === 'beta' ? beta : live).push(it);
  }
  return { live, beta };
}

// ---- where the choice is kept off a screen ----------------------------------------------------------------------
// Signed in: the person's own row (the caller hands a state handle for it). Signed out: this browser.
const LOCAL_KEY = 'nimrod.showBeta';
function localGet() { try { return globalThis.localStorage?.getItem(LOCAL_KEY) ?? null; } catch { return null; } }
function localSet(v) { try { globalThis.localStorage?.setItem(LOCAL_KEY, v); } catch { /* private window */ } }

/**
 * The choice for a page: `{ load(), get(), set(v), destroy() }`. `state` is a state handle on the person's row (or
 * null: this browser). `get()` is always one of BETA_SHOW; a row that cannot be read leaves the default.
 */
export function createBetaChoice({ state = null } = {}) {
  let value = betaShowOf(state ? null : localGet());
  return {
    async load() {
      if (!state) { value = betaShowOf(localGet()); return value; }
      try { await state.load?.(); value = betaShowOf((state.get?.() || {})[BETA_KEY]); } catch { /* the default stands */ }
      return value;
    },
    get: () => value,
    set(v) {
      value = betaShowOf(v);
      // Written at once (flushed), not on the row's next debounce: a page somebody leaves right after choosing keeps it.
      if (state) {
        // (A flush cut short by leaving the page is not an error worth a message: the row keeps the value and saves it
        // on its own next write.)
        try { state.set?.({ [BETA_KEY]: value }); Promise.resolve(state.flush?.()).catch(() => {}); }
        catch (err) { console.error('beta: save', err); }
      }
      else localSet(value);
      return value;
    },
    destroy() { try { state?.destroy?.(); } catch { /* gone */ } },
  };
}

// ---- the banner on a beta page --------------------------------------------------------------------------------
const BANNER_CSS_ID = 'beta-banner-css';
const BANNER_CSS = `.beta-banner{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;
  padding:8px 16px;font-size:.9rem;line-height:1.35;color:var(--text,#1d1d1b);background:var(--surface-alt,#f4f1e4);
  border-bottom:1px solid var(--border,#c9c4ad)}
.beta-banner b{font-weight:800}
.beta-banner a{color:var(--link,inherit)}
.beta-banner button{margin-left:auto;min-width:44px;min-height:44px;border:1px solid var(--border,#c9c4ad);border-radius:10px;
  background:transparent;color:inherit;font:inherit;cursor:pointer}`;
const hiddenKey = (page) => `nimrod.betaBannerHidden.${page}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A small banner along the top of a beta page, or nothing (a live page, or put away in this browser). `page` is the
 * page's path ('checkin.html'). Returns the element, or null. It asks nothing and blocks nothing.
 */
export function mountBetaBanner({ page, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
  if (!doc || !doc.body || pageStageOf(page) !== 'beta') return null;
  try { if (globalThis.localStorage?.getItem(hiddenKey(page)) === '1') return null; } catch { /* show it */ }
  if (!doc.getElementById(BANNER_CSS_ID)) {
    const st = doc.createElement('style');
    st.id = BANNER_CSS_ID;
    st.textContent = BANNER_CSS;
    (doc.head || doc.documentElement).append(st);
  }
  const el = doc.createElement('div');
  el.className = 'beta-banner';
  el.setAttribute('role', 'note');
  el.dataset.betaBanner = page;
  const [lead, ...rest] = BETA_WORDS.page.split(': ');
  el.innerHTML = `<span><b>${esc(lead)}:</b> ${esc(rest.join(': '))}</span>
    <a href="${esc(FEEDBACK_HREF)}" target="_blank" rel="noopener">${esc(BETA_WORDS.feedback)}</a>
    <button type="button" aria-label="Put this note away" title="put this note away (it stays away in this browser)">×</button>`;
  el.querySelector('button').addEventListener('click', () => {
    try { globalThis.localStorage?.setItem(hiddenKey(page), '1'); } catch { /* this visit only */ }
    el.remove();
  });
  doc.body.prepend(el);
  return el;
}
