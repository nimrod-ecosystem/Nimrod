// theme_gallery.js — WHAT A THEME LOOKS LIKE BEFORE YOU PICK IT, AND HOW TO FIND THE ONE YOU WANT.
//
// Mike, 2026-10-06, looking at the theme list (tiles of four colour chips and a name): *"Colours should change to
// theme and show a still of what each one looks like. Probably sort and filter options... You should also be able
// to choose any of the seasonal ones at any time."*
//
// This file is the theme half of the picker; choice_picker.js draws the list and drives it, sort_filter.js is the
// search / order / filters every long list shares. Here:
//   * WHAT KIND each theme is (everyday, a season, a holiday), light or dark, moving or still, easy to read;
//   * THE FILTERS AND ORDERS for a list of themes, in sort_filter.js's shape;
//   * A STILL of each theme: its live scene drawn once and held still, with a panel in its colours over it, or for a
//     theme with no scene a small page in its palette (background, a panel, its words, its accent);
//   * the few themes this device picked last ("Recently used").
//
// *** THE STILLS ARE DRAWN HERE, AT RUNTIME, NOT SHIPPED AS PICTURES. Argued, both ways: ***
//   PICTURES (a PNG per theme): the cheapest thing to show, and the same on every device. AGAINST, and it decides it:
//   twenty-six pictures to redraw whenever Design re-tunes a scene or a palette, and a picture that has drifted from
//   its theme is exactly the "preview that lies" this exists to stop. A still drawn from the scene and the palette
//   cannot drift: it IS the scene and the palette.
//   RUNTIME: each still is the real scene (livescene.js mountScene) with `motion: 'still'` - every animation paused
//   where it stands, no clock, nothing moving, so a still costs its drawing once and nothing after. Drawn only when
//   its tile scrolls into view (an IntersectionObserver), kept while the list is open, and re-used when a search
//   or a filter redraws the tiles (moved, not drawn again). Measured in theme_gallery's suite (`themes_test`): the
//   numbers are in its notes and in this session's report. On a Pi, the cost is the first look at each tile, once
//   per opening; the scenes themselves were measured on the bench Pi 400 (design note 34) and none needed a
//   lighter build.

import { THEMES, isFollowTheme, paintedTheme, luminance, worstContrast, onColor } from './theme.js';
import { mountScene } from './livescene.js';
import { HOLIDAYS, holidayWindow } from './seasons.js';
import { byText } from './sort_filter.js';

// *** THE DEFAULTS, EACH AN OPTION (Rule 1). ***
//   stills  'lazy'   draw a tile's still when it scrolls into view. 'eager' draws every one at once (a suite, a
//                    fast machine); 'off' shows the colour strip only (a device that should not draw scenes at all).
//   sort    'usual'  everyday themes, then the four seasons in the year's order, then the holidays in the
//                    calendar's - the order somebody scanning for "something for Halloween" expects. "By name" is a
//                    choice beside it, and is what the Modules library opens on; a theme list opens on the usual
//                    order because an alphabet scatters the holidays and the seasons through the everyday themes.
//   recent  8        how many themes "Recently used" remembers on this device.
//   easyAt  7        "Easy to read": every colour of the theme's words - its muted words included - reaches 7:1 on
//                    every surface it has, with normal vision and with deuteranopia simulated (theme.js
//                    worstContrast; `themeTextContrast` below). 7:1 is WCAG's enhanced (AAA) level for body text;
//                    every theme already clears the 4.5:1 floor, so a filter at 4.5 would show them all.
export const THEME_GALLERY_DEFAULTS = Object.freeze({ stills: 'lazy', sort: 'usual', recent: 8, easyAt: 7 });

// The stage a still is drawn on before it is scaled to its tile: a panel's proportions (16:10) at a size where
// every scene's own pixel sizes (a lamp, a line of text) look as Design drew them, so a small tile shows the scene
// shrunk, not re-composed.
export const STILL_STAGE = Object.freeze({ width: 400, height: 250 });

// ---------------------------------------------------------------------------------------------------
// WHAT KIND A THEME IS (pure)
// ---------------------------------------------------------------------------------------------------
const SEASON_ORDER = Object.freeze(['spring', 'summer', 'fall', 'winter']);
const KIND_RANK = Object.freeze({ follow: 0, everyday: 1, season: 2, holiday: 3 });
const KIND_WORDS = Object.freeze({ follow: 'follows the date', everyday: 'everyday', season: 'season', holiday: 'holiday' });
const THEME_ORDER = () => Object.keys(THEMES);
// The holiday each holiday theme is for (Thanksgiving's theme is Harvest), so a still can be drawn on its day.
const holidayOf = (id) => {
  const scene = THEMES[id]?.scene;
  const hit = Object.entries(HOLIDAYS).find(([, h]) => h && (h.scene === id || (scene && h.scene === scene)));
  return hit ? hit[0] : null;
};

/** 'everyday' | 'season' | 'holiday' | 'follow' ("With the seasons") | null (not a theme). */
export function themeKind(id) {
  if (isFollowTheme(id)) return 'follow';
  const t = THEMES[id];
  if (!t) return null;
  if (t.group === 'holiday') return 'holiday';
  if (t.group === 'season' || SEASON_ORDER.includes(id)) return 'season';
  return 'everyday';
}

const varsOf = (id) => (isFollowTheme(id) ? paintedTheme(id).vars : THEMES[id]?.vars) || null;

/** The luminance of a theme's page (0 black .. 1 white). Measured from its colours, not read off a flag. */
export function themeLightness(id) {
  const v = varsOf(id);
  return v ? luminance(v['--bg']) : 0;
}
/** Dark: a page darker than a fifth of white. Every theme marked `dark` today is under .05; every light one over .6. */
export const isDarkTheme = (id) => themeLightness(id) < 0.2;
/** Moving: the theme has a living picture behind everything (a scene). "With the seasons": today's. */
export function isMovingTheme(id) {
  const t = isFollowTheme(id) ? paintedTheme(id) : THEMES[id];
  return !!(t && t.scene);
}
/**
 * The worst contrast any of the theme's WORDS make on its own surfaces, both visions (theme.js worstContrast): its
 * main text, its softer text and its muted text (hints, second lines), whichever is weakest. The muted words are
 * the ones a theme makes hardest to read, so they are what "easy to read" has to be about - measured on the main
 * text alone, every theme here clears 7:1 and the filter would show them all.
 */
export const TEXT_ROLES = Object.freeze(['--text', '--text-soft', '--text-muted']);
export function themeTextContrast(id) {
  const v = varsOf(id);
  if (!v) return 0;
  return Math.min(...TEXT_ROLES.filter((k) => v[k]).map((k) => worstContrast(v[k], v)));
}
export const isEasyToRead = (id, at = THEME_GALLERY_DEFAULTS.easyAt) => themeTextContrast(id) >= at;

/** The words a theme is found by, besides its name: "holiday dark moving", "everyday light still easy to read". */
export function themeWords(id) {
  const k = themeKind(id);
  if (!k) return '';
  return [KIND_WORDS[k], k === 'season' ? 'seasons' : '', k === 'holiday' ? 'holidays' : '',
    isDarkTheme(id) ? 'dark' : 'light', isMovingTheme(id) ? 'moving scene' : 'still plain',
    isEasyToRead(id) ? 'easy to read high contrast' : ''].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------------------------------
// FILTERS AND ORDERS, in sort_filter.js's shape. The items are a picker's OPTIONS ({ value, label, hint }).
// An option that is not a theme ("Follow this device" on a level's row, "With the seasons") is PINNED: no filter
// takes it away and every order puts it first, so the way to follow is never filtered out of sight.
// ---------------------------------------------------------------------------------------------------
export const isPinnedOption = (o) => !o || !THEMES[o.value];

export const THEME_KINDS = Object.freeze([
  Object.freeze({ id: 'all', label: 'Everything' }),
  Object.freeze({ id: 'everyday', label: 'Everyday' }),
  Object.freeze({ id: 'season', label: 'Seasons' }),
  Object.freeze({ id: 'holiday', label: 'Holidays' }),
]);
export const THEME_FACETS = Object.freeze([
  // "Show": the one a switch reaches (the picker's chip row, a stop). The rest are behind "Filters…", as the
  // library's are.
  Object.freeze({ id: 'kind', label: 'Show', any: 'all', options: THEME_KINDS, test: (o, v) => themeKind(o.value) === v }),
  Object.freeze({ id: 'look', label: 'Light or dark', any: 'any',
    options: Object.freeze([{ id: 'any', label: 'Light or dark' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]),
    test: (o, v) => (isDarkTheme(o.value) ? 'dark' : 'light') === v }),
  Object.freeze({ id: 'motion', label: 'Moving or still', any: 'any',
    options: Object.freeze([{ id: 'any', label: 'Moving or still' }, { id: 'moving', label: 'Moving' }, { id: 'still', label: 'Still' }]),
    test: (o, v) => (isMovingTheme(o.value) ? 'moving' : 'still') === v }),
  Object.freeze({ id: 'read', label: 'Easy to read', any: 'any',
    options: Object.freeze([{ id: 'any', label: 'Any contrast' }, { id: 'easy', label: 'Easy to read' }]),
    test: (o, v) => v === 'easy' && isEasyToRead(o.value) }),
]);
export const THEME_FACET_ANY = Object.freeze(Object.fromEntries(THEME_FACETS.map((f) => [f.id, f.any])));

function usualRank(id) {
  const k = themeKind(id);
  const order = THEME_ORDER();
  let within = order.indexOf(id);
  if (k === 'season') within = SEASON_ORDER.indexOf(id);
  if (k === 'holiday') { const h = holidayOf(id); within = h ? Object.keys(HOLIDAYS).indexOf(h) : 99; }
  return [KIND_RANK[k] ?? 9, within < 0 ? 99 : within];
}
const pinFirst = (cmp) => (a, b, ctx) => (Number(isPinnedOption(a)) ? 0 : 1) - (Number(isPinnedOption(b)) ? 0 : 1) || (isPinnedOption(a) && isPinnedOption(b) ? 0 : cmp(a, b, ctx));
const usualCompare = (a, b) => { const x = usualRank(a.value); const y = usualRank(b.value); return (x[0] - y[0]) || (x[1] - y[1]); };
const nameCompare = byText((o) => o.label);
export const THEME_SORTS = Object.freeze([
  Object.freeze({ id: 'usual', label: 'The usual order', compare: pinFirst(usualCompare) }),
  Object.freeze({ id: 'name', label: 'By name', compare: pinFirst(nameCompare) }),
  Object.freeze({ id: 'light', label: 'Light to dark', compare: pinFirst((a, b) => (themeLightness(b.value) - themeLightness(a.value)) || usualCompare(a, b)) }),
  Object.freeze({ id: 'recent', label: 'Recently used', compare: pinFirst((a, b, ctx) => {
    const recent = Array.isArray(ctx?.recent) ? ctx.recent : [];
    const r = (o) => { const i = recent.indexOf(o.value); return i < 0 ? Infinity : i; };
    return (r(a) - r(b)) || usualCompare(a, b);
  }) }),
]);
/** What a theme option is searched by: its name, its hint, and its kind and look in words. */
export const themeOptionText = (o) => `${o?.label || ''} ${o?.hint || ''} ${isPinnedOption(o) ? '' : themeWords(o.value)}`;

// ---------------------------------------------------------------------------------------------------
// RECENTLY USED, on this device (a per-device convenience, like the library's own recent row): the themes picked
// in a gallery here, newest first. Never the record of what a screen wears - that is the settings, as always.
// ---------------------------------------------------------------------------------------------------
const RECENT_KEY = 'nimrod:themes-recent';
const store = (s) => (s !== undefined ? s : (typeof localStorage !== 'undefined' ? localStorage : null));
export function recentThemes(storage) {
  try {
    const v = JSON.parse(store(storage)?.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((id) => typeof id === 'string' && THEMES[id]) : [];
  } catch { return []; }
}
export function rememberThemePick(id, storage, max = THEME_GALLERY_DEFAULTS.recent) {
  if (!THEMES[id]) return recentThemes(storage);
  const next = [id, ...recentThemes(storage).filter((x) => x !== id)].slice(0, Math.max(1, max));
  try { store(storage)?.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode: nothing to remember */ }
  return next;
}

// ---------------------------------------------------------------------------------------------------
// THE STILL OF ONE THEME
// ---------------------------------------------------------------------------------------------------

/**
 * The day a holiday theme's still is drawn on: the middle of its next window (theme_schedule.js's dates, through
 * seasons.js holidayWindow), at noon - so Hanukkah shows candles lit and the fireworks are the holiday's. Any
 * other theme: `now`.
 */
export function stillDate(id, now = Date.now()) {
  const at = new Date(now);
  const h = THEMES[id]?.group === 'holiday' ? holidayOf(id) : null;
  if (!h) return at;
  let w = null;
  try { w = holidayWindow(h, at); } catch { w = null; }
  if (!w) return at;
  const mid = new Date((w.from.valueOf() + w.to.valueOf()) / 2);
  return new Date(mid.getFullYear(), mid.getMonth(), mid.getDate(), 12);
}

// A panel in the theme's colours, over its scene or on its page: the surface, a heading in --text-strong, two lines
// of words (--text, --text-muted), and a button in --accent with the text the theme derives for it. Every colour is
// the theme's own (data), none is this file's.
function mockHTML(v, overScene) {
  const c = (k) => String(v[k] || '').replace(/[^#\w(),.%\s-]/g, '');
  const line = (w, col, h = 9) => `<span style="display:block;height:${h}px;width:${w}%;border-radius:5px;background:${col};margin:0 0 9px"></span>`;
  const card = overScene
    ? 'left:6%;bottom:9%;width:46%;padding:16px 16px 10px'
    : 'left:7%;top:13%;width:58%;padding:20px 20px 12px';
  return `<span class="tg-card" style="position:absolute;${card};box-sizing:border-box;border-radius:16px;background:${c('--surface')};
    border:2px solid ${c('--border')};box-shadow:0 4px 14px rgba(0,0,0,.18)">
    ${line(70, c('--text-strong') || c('--text'), 14)}${line(92, c('--text'))}${line(60, c('--text-muted'))}
    <span style="display:inline-block;margin-top:2px;padding:6px 16px;border-radius:999px;background:${c('--accent')};color:${onColor(v['--accent'])};
      font:700 15px/1.2 system-ui,sans-serif">Aa</span></span>${overScene ? '' : `<span class="tg-card" style="position:absolute;right:7%;top:24%;width:22%;
    height:44%;border-radius:14px;background:${c('--surface-alt') || c('--surface')};border:2px solid ${c('--border')}">
    <span style="position:absolute;left:18%;right:18%;top:22%;height:18%;border-radius:999px;background:${c('--link')}"></span>
    <span style="position:absolute;left:18%;right:38%;top:56%;height:14%;border-radius:999px;background:${c('--accent-warm')}"></span></span>`}`;
}

/**
 * Draw the still of theme `id` into `box` (a positioned element the picker sizes). Returns { destroy, stage, scene }.
 * The stage is STILL_STAGE in size, scaled to the box's width (re-scaled if the box is resized).
 */
export function mountThemeStill(box, id, { now = Date.now() } = {}) {
  if (!box) return null;
  const doc = box.ownerDocument || document;
  const t = isFollowTheme(id) ? paintedTheme(id, { now }) : THEMES[id];
  if (!t || !t.vars) return null;
  const v = t.vars;
  const stage = doc.createElement('span');
  stage.className = 'tg-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.dataset.theme = String(id);
  stage.style.cssText = `position:absolute;left:0;top:0;display:block;width:${STILL_STAGE.width}px;height:${STILL_STAGE.height}px;`
    + `transform-origin:0 0;overflow:hidden;background:${String(v['--bg'] || '')};pointer-events:none`;
  let scene = null;
  if (t.scene) {
    try {
      scene = mountScene(stage, { scene: t.scene, overlays: t.overlays || [], motion: 'still',
        date: stillDate(isFollowTheme(id) ? t.id : id, now) });
    } catch (err) { console.error('theme gallery: a still', err); scene = null; }
  }
  stage.insertAdjacentHTML('beforeend', mockHTML(v, !!t.scene));
  box.append(stage);
  fitStill(box, stage);
  return { stage, scene: t.scene || null, handle: scene, destroy() { try { scene?.destroy(); } catch { /* gone */ } stage.remove(); } };
}

/** Scale a still's stage to the width of the box it sits in. A box with no width yet (not laid out) is left as is. */
export function fitStill(box, stage) {
  const w = box?.clientWidth || 0;
  if (w > 0 && stage) stage.style.transform = `scale(${w / STILL_STAGE.width})`;
}

/**
 * The stills of one list: drawn when a tile's box comes into view (`mode: 'lazy'`), all at once ('eager'), or never
 * ('off'). A still once drawn is KEPT for the life of the list and moved into the new box when the tiles are drawn
 * again (a search, a filter), so typing never draws a scene twice. `destroy()` lets every one go.
 *   attach(box, id)   the box a tile has for theme `id`'s still
 */
export function createStills({ mode = THEME_GALLERY_DEFAULTS.stills, now = Date.now(), win = (typeof window !== 'undefined' ? window : null) } = {}) {
  const drawn = new Map();       // id -> { stage, destroy }
  const waiting = new Map();     // box -> id
  let io = null;
  let ro = null;
  let dead = false;
  const off = mode === 'off';
  const canWatch = !!(win && typeof win.IntersectionObserver === 'function');
  const boxes = new Set();
  function place(box, id) {
    if (dead || !box || !box.isConnected) return;
    let d = drawn.get(id);
    if (!d) {
      d = mountThemeStill(box, id, { now });
      if (!d) return;
      drawn.set(id, d);
    } else if (d.stage.parentNode !== box) {
      box.append(d.stage);
    }
    box.dataset.still = 'drawn';
    boxes.add(box);
    fitStill(box, d.stage);
    try { ro?.observe(box); } catch { /* no layout */ }
  }
  if (!off && win && typeof win.ResizeObserver === 'function') {
    ro = new win.ResizeObserver((entries) => {
      for (const e of entries) { const s = e.target.querySelector('.tg-stage'); if (s) fitStill(e.target, s); }
    });
  }
  if (!off && mode === 'lazy' && canWatch) {
    io = new win.IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = waiting.get(e.target);
        waiting.delete(e.target);
        io.unobserve(e.target);
        if (id != null) place(e.target, id);
      }
    }, { rootMargin: '120px' });
  }
  return {
    attach(box, id) {
      if (dead || off || !box || id == null) return;
      if (drawn.has(id) || mode === 'eager' || !io) { place(box, id); return; }
      waiting.set(box, id);
      io.observe(box);
    },
    /** Forget the boxes of tiles that were drawn over (their stills stay, ready for the next box). */
    clearBoxes() {
      for (const b of [...waiting.keys()]) { try { io?.unobserve(b); } catch { /* gone */ } }
      waiting.clear();
      for (const b of boxes) { try { ro?.unobserve(b); } catch { /* gone */ } }
      boxes.clear();
    },
    count: () => drawn.size,
    ids: () => [...drawn.keys()],
    nodes: () => [...drawn.values()].reduce((n, d) => n + d.stage.querySelectorAll('*').length, 0),
    mode: () => (off ? 'off' : (mode === 'lazy' && !io ? 'eager' : mode)),
    destroy() {
      if (dead) return;
      dead = true;
      try { io?.disconnect(); } catch { /* gone */ }
      try { ro?.disconnect(); } catch { /* gone */ }
      for (const d of drawn.values()) d.destroy();
      drawn.clear(); waiting.clear(); boxes.clear();
    },
  };
}
