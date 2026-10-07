// choice_picker.js — CHOOSING ONE OF MANY. A LIST YOU CAN SEE, NOT A ROW YOU PRESS ROUND.
//
// Mike, 2026-10-02: *"Things like modules, pictures, themes where there are a lot of options shouldn't
// be set up to have to click through them all as default. That could be an option for switch users,
// but would be very frustrating for most people. We're making a site that should be accessible to
// switch users, but that doesn't need to be the default for everyone."*
//
// Until today every `choice` row in the settings menu answered a press by stepping to the NEXT option
// (settings_fields.js `stepValue`), so choosing the eighth theme was seven presses, each one applying a
// theme nobody wanted. For somebody with one switch that walk is the only way there is; for everybody
// else it is the slowest way there is. So a choice row with more than a few options now OPENS this:
// every option at once, with a preview where one means something (a theme's colours, a font's letters,
// a picture), search when the list is long, one click to choose, Cancel / Escape to leave it as it was.
//
// WHEN IT OPENS is not decided here: `settings_fields.js` `opensPicker` (the threshold, the field's own
// say, and the person's "How you choose things"). This file only draws the list and drives it.
//
// A SWITCH STILL REACHES EVERYTHING IN IT, by rows — the picture picker's scan (`picture_picker.js`),
// on purpose the same so nobody learns two: `next`/`prev` light a ROW, `select` goes INTO it and
// `next`/`prev` walk its options, `select` takes one, `back` comes out of the row and `back` from the
// rows is Cancel. A row with one thing in it is taken by the `select` that would have entered it. The
// first row is "Keep <what it is now>", so a stray press changes nothing. The search box is for a
// keyboard and is not a stop. (A person whose "How you choose things" is "step through" never sees this
// at all: their press steps the row, as it always did.)
//
// WHAT IT HANDS BACK is the option's VALUE, exactly as declared. It writes nothing: the caller commits
// it through the row's own `commit()` — the one write path every other row uses.

import { THEMES, isFollowTheme, paintedTheme } from './theme.js';
import { normalizeHex } from './color_picker.js';
import { gridRows, filterByName } from './picture_picker.js';
// (themes, 2026-10-06) A LIST OF THEMES IS A GALLERY. Mike: "Colours should change to theme and show a still of
// what each one looks like. Probably sort and filter options... use the setup that the modules module has as the
// global." So a theme list (the same test as its colour preview, below) draws each tile with a STILL of the theme
// over its colour strip (theme_gallery.js), and above the tiles the Modules library's own search, Order and
// Filters (sort_filter.js), plus one row of chips a switch can reach: Everything / Everyday / Seasons / Holidays.
// Every other list is exactly what it was. `gallery: false` turns it off for a theme list that should stay plain.
import { sortFilter, searchBoxHTML, selectHTML, chipsHTML, filtersButtonHTML, ensureSortFilterCss } from './sort_filter.js';
import { THEME_GALLERY_DEFAULTS, THEME_FACETS, THEME_FACET_ANY, THEME_SORTS, themeOptionText, isPinnedOption,
  createStills, recentThemes, rememberThemePick } from './theme_gallery.js';

// *** TWO NUMBERS, EACH A DEFAULT AND EACH AN OPTION (Rule 1). ***
//   columns    3   options per row, and so the cost of a row/column scan: rows + columns presses. Three
//                  keeps a label like "Cyberpunk — a street at night" readable at settings-menu width;
//                  twelve themes are four rows, so the worst scan is 4 + 3, not 12.
//   searchOver 12  the box appears only past a dozen. Up to twelve fit on one screen in three columns,
//                  where looking is faster than typing; past that, typing part of a name is faster.
export const CHOICE_PICKER_DEFAULTS = Object.freeze({ columns: 3, searchOver: 12 });

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------------------------------------------------------------------------------------------
// PREVIEWS. Pure: what a tile shows besides its name, or null for nothing.
//
//   option.swatch  a colour or a list of colours (hex), drawn as chips
//   option.font    a CSS font-family, drawn as "Aa" in it
//   option.thumb   a picture URL, drawn as a thumbnail
//   a THEME        when the field says `preview: 'theme'`, or its key is a theme key and the value is a
//                  theme this build has: the theme's own ground, surface, accent and text, read from
//                  theme.js at the moment of drawing (so a theme Design re-colours previews as it is).
// The colours come from DATA (an option, a theme), never from this file.
// ---------------------------------------------------------------------------------------------
const THEME_KEY = /theme$/i;
const THEME_ROLES = ['--bg', '--surface', '--accent', '--text'];
export function previewOf(option, { preview = null, key = '' } = {}) {
  if (!option || typeof option !== 'object') return null;
  if (option.thumb) return { kind: 'thumb', url: String(option.thumb) };
  if (option.swatch) {
    const colors = (Array.isArray(option.swatch) ? option.swatch : [option.swatch]).map(normalizeHex).filter(Boolean);
    if (colors.length) return { kind: 'swatch', colors };
  }
  if (option.font) return { kind: 'font', family: String(option.font) };
  const themeish = preview === 'theme' || (preview == null && THEME_KEY.test(String(key || '')));
  // "With the seasons" (seasons.js) is not in THEMES: its tile wears the colours it paints today.
  const t = themeish ? (THEMES[option.value] || (isFollowTheme(option.value) ? paintedTheme(option.value) : null)) : null;
  if (t && t.vars) {
    const colors = THEME_ROLES.map((r) => normalizeHex(t.vars[r])).filter(Boolean);
    if (colors.length) return { kind: 'swatch', colors };
  }
  return null;
}

function previewHTML(p) {
  if (!p) return '';
  if (p.kind === 'thumb') return `<span class="chp-thumb"><img alt="" loading="lazy" decoding="async" src="${esc(p.url)}"></span>`;
  if (p.kind === 'swatch') {
    return `<span class="chp-swatches" aria-hidden="true">${p.colors.map((c) => `<span class="chp-chip" style="--sw:${esc(c)}"></span>`).join('')}</span>`;
  }
  // The family is set from script after the markup lands (see `fonts()`), never written into a style
  // attribute: a font name is data and has no business being parsed as CSS.
  if (p.kind === 'font') return '<span class="chp-font" aria-hidden="true" data-chp-font>Aa</span>';
  return '';
}

let cssAdded = false;
// The look lives in settings.css (`.chp-*`), which every page with a settings menu already loads. A page
// that opens the picker as a dialog without one (none today) gets it linked once.
function ensureCss() {
  if (cssAdded || typeof document === 'undefined') return;
  cssAdded = true;
  try {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /(^|\/)settings\.css(\?|$)/.test(l.getAttribute('href') || ''))) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.chpCss = '';
    link.href = new URL('./settings.css', import.meta.url).href;
    document.head.append(link);
  } catch { /* unstyled still works */ }
}

/**
 * Mount the picker into `root`. `options` are `{ value, label, hint?, swatch?, font?, thumb? }`.
 * Returns `{ next, prev, select, back, destroy, refresh, __probe }` — the four verbs for whoever
 * routes a switch to it. `back()` returns true when it only came out of a row; otherwise it cancels
 * (when `cancel` is on) and returns false, so a host can treat false as "leave".
 */
export function mountChoicePicker(root, {
  options = [],
  value = undefined,
  title = 'Choose one',
  key = '',
  preview = null,
  onPick = () => {},
  onCancel = () => {},
  // The "Keep …" stop. Off for a picker that IS a page's whole content and whose host has its own way
  // back (a host passing false must give one: a list with no way out is a list somebody is stuck in).
  cancel = true,
  cancelLabel = null,
  columns = CHOICE_PICKER_DEFAULTS.columns,
  searchOver = CHOICE_PICKER_DEFAULTS.searchOver,
  // Handle arrows, Enter and Escape itself. OFF where a host routes its keys here as verbs (the
  // settings menu), or every arrow moves twice. Escape is always handled (it is "leave", everywhere).
  keys = false,
  // ---- (themes, 2026-10-06) THE GALLERY, for a list of themes (see the imports). ----
  // `gallery`: undefined = on for a theme list, off otherwise; false = never; true = always (a theme list whose
  // key does not say so). `stills`, `sort`: theme_gallery.js THEME_GALLERY_DEFAULTS argues both. `storage`: where
  // "Recently used" is kept (this browser's, by default). `now`: the moment the stills are drawn for (a suite).
  gallery = undefined,
  stills = THEME_GALLERY_DEFAULTS.stills,
  sort = THEME_GALLERY_DEFAULTS.sort,
  storage = undefined,
  now = undefined,
} = {}) {
  if (!root) throw new Error('mountChoicePicker: a root element is required');
  ensureCss();
  const opts = (Array.isArray(options) ? options : []).filter((o) => o && o.value !== undefined && o.value !== null)
    .map((o) => ({ ...o, label: String(o.label ?? o.value) }));
  const cols = Math.max(1, Math.floor(Number(columns)) || CHOICE_PICKER_DEFAULTS.columns);
  const searchAt = Number.isFinite(Number(searchOver)) ? Number(searchOver) : CHOICE_PICKER_DEFAULTS.searchOver;
  const same = (a, b) => a === b || String(a) === String(b);
  let current = opts.find((o) => same(o.value, value)) || null;
  let keepText = cancelLabel || (current ? `Keep ${current.label}` : 'Cancel');
  let query = '';
  let lit = { g: -1, i: -1 };
  let dead = false;
  // THE GALLERY: a list of themes, the test the colour preview uses, and at least one real theme in it.
  const themeish = preview === 'theme' || (preview == null && THEME_KEY.test(String(key || '')));
  const isGallery = gallery === true || (gallery !== false && themeish && opts.some((o) => THEMES[o.value]));
  const picked = { ...THEME_FACET_ANY };
  let sortId = THEME_SORTS.some((s) => s.id === sort) ? sort : THEME_GALLERY_DEFAULTS.sort;
  let showMore = false;
  const stillsOf = isGallery ? createStills({ mode: stills, now: now ?? Date.now(), win: root.ownerDocument?.defaultView || null }) : null;
  if (isGallery) ensureSortFilterCss(root.ownerDocument);

  function shown() {
    if (isGallery) {
      return sortFilter(opts, { query, text: themeOptionText, facets: THEME_FACETS, picked, pin: isPinnedOption,
        sort: sortId, sorts: THEME_SORTS, ctx: { recent: recentThemes(storage) } });
    }
    // `filterByName` matches every word typed, any order, against a name and a path: the label is the
    // name, and the hint rides as the path so "dark" finds "Dusk (dark, calm)".
    const named = opts.map((o, n) => ({ n, name: o.label, path: o.hint || '' }));
    return filterByName(named, query).map((x) => opts[x.n]);
  }

  function tile(o) {
    const on = same(o.value, value);
    const p = previewOf(o, { preview, key });
    // A gallery tile: the still on top (drawn when it scrolls into view, `stillsOf`), the name, then the colours as a
    // thin strip - kept for whoever chooses by contrast, which a picture of a scene does not show at a glance. An
    // option that is not a theme ("Follow …") has neither, and says so by being a plain tile.
    if (isGallery) {
      const real = THEMES[o.value] || isFollowTheme(o.value);
      return `<button type="button" class="chp-tile${real ? ' chp-gal' : ' chp-plain'}" data-chp-stop data-chp-pick="${esc(String(o.value))}"
        aria-pressed="${on ? 'true' : 'false'}" title="${esc(o.label)}">${real && stills !== 'off'
        ? `<span class="chp-still" data-chp-still="${esc(String(o.value))}" aria-hidden="true"></span>` : ''}<span class="chp-name">${esc(o.label)}</span>${
        o.hint ? `<span class="chp-hint">${esc(o.hint)}</span>` : ''}${p && p.kind === 'swatch' ? previewHTML(p).replace('chp-swatches', 'chp-swatches chp-strip') : ''}</button>`;
    }
    return `<button type="button" class="chp-tile${p ? '' : ' chp-plain'}" data-chp-stop data-chp-pick="${esc(String(o.value))}"
      aria-pressed="${on ? 'true' : 'false'}" title="${esc(o.label)}">${previewHTML(p)}<span class="chp-name">${esc(o.label)}</span>${
      o.hint ? `<span class="chp-hint">${esc(o.hint)}</span>` : ''}</button>`;
  }

  function resultsHTML() {
    const list = shown();
    const none = `<p class="chp-note" data-chp-none>${query ? `Nothing here matches “${esc(query)}”.` : 'No theme matches these filters.'}${
      isGallery ? ' <button type="button" class="sf-btn" data-chp-clear>Show everything</button>' : ''}</p>`;
    if (!list.length) return none;
    const rows = gridRows(list, cols).map((r) => `<div class="chp-row chp-tiles" data-chp-group="grid" style="--chp-cols:${cols}">${
      r.map(tile).join('')}</div>`).join('');
    // (themes) Only the pinned choices left ("With the seasons", "Follow …"): they stay, and the note says no THEME
    // matched, with the way back.
    return isGallery && list.every(isPinnedOption) && opts.some((o) => !isPinnedOption(o)) ? rows + none : rows;
  }

  // THE GALLERY'S TOOLS: the library's search box, Order and Filters… (sort_filter.js), then the one row of chips a
  // switch reaches ("Show": a stop, like the library's categories). The box, the list and the button are for a
  // keyboard and a pointer and are not stops, as in the library.
  function toolsHTML() {
    const kind = THEME_FACETS.find((f) => f.id === 'kind');
    const more = THEME_FACETS.filter((f) => f.id !== 'kind');
    return `<div class="sf-tools chp-tools">${searchBoxHTML({ attr: 'data-chp-search', label: 'Search the themes', placeholder: 'Search',
      value: query, extra: 'autocomplete="off" spellcheck="false"' })}${selectHTML({ attr: 'data-chp-sort', label: 'Order', options: THEME_SORTS, value: sortId })}${
      filtersButtonHTML({ attr: 'data-chp-more', open: showMore })}</div>
      <div class="sf-more" data-chp-morebox ${showMore ? '' : 'hidden'}>${more.map((f) => `<label class="sf-small">${
        selectHTML({ attr: `data-chp-facet="${esc(f.id)}"`, label: f.label, options: f.options, value: picked[f.id] })}</label>`).join('')}</div>
      <div class="chp-row sf-row" data-chp-group="filters" role="toolbar" aria-label="${esc(kind.label)}">${chipsHTML({ options: kind.options,
        value: picked.kind, attrOf: (o) => `data-chp-stop data-chp-filter="kind" data-chp-val="${esc(o.id)}"` })}</div>`;
  }

  function attachStills() {
    if (!stillsOf) return;
    stillsOf.clearBoxes();
    for (const box of root.querySelectorAll('[data-chp-still]')) stillsOf.attach(box, box.dataset.chpStill);
  }

  function fonts() {
    for (const el of root.querySelectorAll('[data-chp-font]')) {
      const btn = el.closest('[data-chp-pick]');
      const o = btn ? opts.find((x) => String(x.value) === btn.dataset.chpPick) : null;
      try { if (o && o.font) el.style.fontFamily = String(o.font); } catch { /* a bad family is just the default face */ }
    }
  }

  function render() {
    if (dead) return;
    const box = root.querySelector('[data-chp-search]');
    const hadFocus = !!box && typeof document !== 'undefined' && document.activeElement === box;
    const caret = hadFocus ? [box.selectionStart, box.selectionEnd] : null;
    root.innerHTML = `<div class="chp${isGallery ? ' chp-gallery' : ''}" data-choice-picker>
      ${title ? `<p class="chp-head">${esc(title)}</p>` : ''}
      ${cancel ? `<div class="chp-row chp-acts" data-chp-group="actions">
        <button type="button" class="chp-btn" data-chp-stop data-chp-act="cancel">${esc(keepText)}</button></div>` : ''}
      ${isGallery ? toolsHTML() : (opts.length > searchAt ? `<label class="chp-search">Search <input type="search" data-chp-search value="${esc(query)}"
        autocomplete="off" spellcheck="false" placeholder="Type part of a name"></label>` : '')}
      <div class="chp-grid" data-chp-results>${resultsHTML()}</div>
    </div>`;
    if (hadFocus) {
      const el = root.querySelector('[data-chp-search]');
      el?.focus?.();
      if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text box */ } }
    }
    fonts();
    attachStills();
    paintLit();
  }
  function renderResults() {
    const el = root.querySelector('[data-chp-results]');
    if (!el) { render(); return; }
    el.innerHTML = resultsHTML();
    // The "Show" chips say which is chosen (they are not redrawn: the switch's light may be on one).
    for (const c of root.querySelectorAll('[data-chp-filter]')) {
      c.setAttribute('aria-pressed', String(String(picked[c.dataset.chpFilter]) === c.dataset.chpVal));
    }
    fonts();
    attachStills();
    paintLit();
  }
  // A filter or an order changed: the results again, from the top of the list.
  function refilter() {
    renderResults();
    try { root.querySelector('[data-chp-results]')?.scrollTo?.(0, 0); } catch { /* no layout */ }
  }

  // ------------------------------------------------------------------ actions
  function pick(raw) {
    const o = opts.find((x) => String(x.value) === String(raw));
    if (!o) return;
    // (themes) A theme picked in a gallery is remembered on this device, for "Recently used".
    if (isGallery && THEMES[o.value]) rememberThemePick(o.value, storage);
    try { onPick(o.value, o); } catch (err) { console.error('choice picker: onPick', err); }
  }
  function doCancel() { try { onCancel(); } catch (err) { console.error('choice picker: onCancel', err); } }
  function activate(el) {
    if (!el || dead) return;
    if (el.dataset.chpAct === 'cancel') { doCancel(); return; }
    // (themes) A "Show" chip narrows the tiles; the light stays on the chip, so the next press can try another.
    if (el.dataset.chpFilter) { picked[el.dataset.chpFilter] = el.dataset.chpVal; refilter(); return; }
    if ('chpPick' in el.dataset) pick(el.dataset.chpPick);
  }
  // (themes) Every filter back to "everything" and the search box emptied: the way out of "Nothing matches".
  function clearAll() {
    Object.assign(picked, THEME_FACET_ANY);
    query = '';
    render();
  }

  // ------------------------------------------------------------------ the scan (picture_picker.js's)
  const stopsIn = (g) => [...g.querySelectorAll('[data-chp-stop]')].filter((b) => !b.disabled);
  const groups = () => [...root.querySelectorAll('[data-chp-group]')].filter((g) => stopsIn(g).length);
  function paintLit() {
    for (const el of root.querySelectorAll('[data-on]')) { delete el.dataset.on; el.removeAttribute('aria-current'); }
    const gs = groups();
    if (lit.g >= gs.length) lit = { g: gs.length ? gs.length - 1 : -1, i: -1 };
    if (lit.g < 0) return;
    const st = stopsIn(gs[lit.g]);
    if (lit.i >= st.length) lit.i = st.length - 1;
    const on = lit.i >= 0 ? st[lit.i] : gs[lit.g];
    on.dataset.on = '1';
    on.setAttribute('aria-current', 'true');
    try { on.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* no layout */ }
  }
  function move(d) {
    const gs = groups();
    if (!gs.length) return;
    if (lit.g >= 0 && lit.i >= 0) {
      const n = stopsIn(gs[lit.g]).length;
      lit.i = ((lit.i + d) % n + n) % n;
    } else {
      lit = { g: lit.g < 0 ? (d > 0 ? 0 : gs.length - 1) : ((lit.g + d) % gs.length + gs.length) % gs.length, i: -1 };
    }
    paintLit();
  }
  function select() {
    const gs = groups();
    if (!gs.length) return;
    // The first press only lights the first row (the calculator's rule, and the picture picker's).
    if (lit.g < 0) { lit = { g: 0, i: -1 }; paintLit(); return; }
    const st = stopsIn(gs[lit.g]);
    if (lit.i < 0) {
      if (st.length === 1) { activate(st[0]); return; }
      lit.i = 0; paintLit(); return;
    }
    activate(st[lit.i]);
  }
  function back() {
    if (lit.g >= 0 && lit.i >= 0) { lit.i = -1; paintLit(); return true; }
    if (cancel) doCancel();
    return false;
  }

  // ------------------------------------------------------------------ wiring
  const gone = new AbortController();
  const on = (type, fn) => root.addEventListener(type, fn, { signal: gone.signal });
  on('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    // (themes) Filters… shows or hides the less used filters; "Show everything" clears them. Neither is a stop.
    if (t?.closest('[data-chp-more]')) {
      showMore = !showMore;
      root.querySelector('[data-chp-morebox]')?.toggleAttribute('hidden', !showMore);
      root.querySelector('[data-chp-more]')?.setAttribute('aria-expanded', String(showMore));
      return;
    }
    if (t?.closest('[data-chp-clear]')) { clearAll(); return; }
    const el = t?.closest('[data-chp-stop]');
    if (!el || !root.contains(el) || el.disabled) return;
    activate(el);
  });
  on('input', (e) => {
    if (!e.target?.matches?.('[data-chp-search]')) return;
    query = e.target.value || '';
    renderResults();
  });
  // (themes) The Order list and the filters behind "Filters…".
  on('change', (e) => {
    const t = e.target;
    if (t?.matches?.('[data-chp-sort]')) { sortId = t.value; refilter(); return; }
    if (t?.matches?.('[data-chp-facet]')) { picked[t.dataset.chpFacet] = t.value; refilter(); }
  });
  on('keydown', (e) => {
    const typing = e.target?.matches?.('input,textarea,select');
    // Escape is LEAVE, and stopped here so the settings menu around it does not ALSO close (its own
    // panel listener closes the whole menu on Escape). In the search box it leaves the box first.
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (typing) { e.target.blur?.(); return; }
      if (lit.g >= 0 && lit.i >= 0) { back(); return; }
      if (cancel) doCancel(); else back();
      return;
    }
    if (!keys || typing) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); move(1); }
    else if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(-1); }
    else if (k === 'Enter' && lit.g >= 0) { e.preventDefault(); e.stopPropagation(); select(); }
  });

  render();

  return {
    next: () => move(1),
    prev: () => move(-1),
    select,
    back,
    refresh: () => render(),
    /** (themes, 2026-10-06) Mark `v` as the one in force without drawing the list again (a host that keeps the
     *  list open after a choice: the Themes panel). The scroll, the search and the switch's light all stay. */
    setValue(v) {
      if (dead) return;
      value = v;
      current = opts.find((o) => same(o.value, v)) || null;
      if (!cancelLabel) keepText = current ? `Keep ${current.label}` : 'Cancel';
      for (const t of root.querySelectorAll('[data-chp-pick]')) t.setAttribute('aria-pressed', String(same(t.dataset.chpPick, v)));
      const keep = root.querySelector('[data-chp-act="cancel"]');
      if (keep) keep.textContent = keepText;
    },
    destroy() {
      if (dead) return;
      dead = true;
      gone.abort();
      try { stillsOf?.destroy(); } catch { /* gone */ }
      root.innerHTML = '';
    },
    __probe: () => {
      const gs = groups();
      const g = lit.g >= 0 ? gs[lit.g] : null;
      const st = g ? stopsIn(g) : [];
      const litEl = g ? (lit.i >= 0 ? st[lit.i] : g) : null;
      return {
        options: opts.length,
        tiles: root.querySelectorAll('[data-chp-pick]').length,
        shown: shown().map((o) => o.value),
        rows: gs.map((x) => x.dataset.chpGroup),
        lit: { ...lit },
        litGroup: g ? g.dataset.chpGroup : null,
        litText: litEl ? litEl.textContent.trim().replace(/\s+/g, ' ') : null,
        search: !!root.querySelector('[data-chp-search]'),
        query,
        // (themes) the gallery: whether it is one, its order and filters, and how many stills are drawn.
        gallery: isGallery,
        ...(isGallery ? { sort: sortId, filters: { ...picked }, stills: stillsOf.count(), stillIds: stillsOf.ids(),
          stillMode: stillsOf.mode(), stillNodes: stillsOf.nodes() } : {}),
      };
    },
  };
}

/**
 * The picker on its own, over the page — for a host that draws its rows itself and has nowhere to put
 * a list (the Settings module's page of another panel's settings). Keys on: nothing else routes them.
 * Closes itself on a choice or a cancel; `onPick(value)` / `onCancel()` say which.
 */
export function openChoiceDialog(opts = {}) {
  if (typeof document === 'undefined') return null;
  ensureCss();
  const wrap = document.createElement('div');
  wrap.className = 'chp-dialog';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', opts.title || 'Choose one');
  wrap.innerHTML = '<div class="chp-dialog-box" tabindex="-1"></div>';
  document.body.append(wrap);
  const box = wrap.querySelector('.chp-dialog-box');
  const had = document.activeElement || null;
  let api = null;
  const close = () => {
    api?.destroy();
    wrap.remove();
    try { if (had && had.isConnected) had.focus?.(); } catch { /* gone */ }
  };
  api = mountChoicePicker(box, {
    ...opts,
    keys: true,
    cancel: true,
    onPick: (v, o) => { close(); opts.onPick?.(v, o); },
    onCancel: () => { close(); opts.onCancel?.(); },
  });
  // A click on the dim area outside the box is a Cancel: a dialog nobody can click away reads as a crash.
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) { close(); opts.onCancel?.(); } });
  box.focus?.();
  return { ...api, close, element: wrap };
}
