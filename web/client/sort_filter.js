// sort_filter.js — SEARCH, SORT AND FILTER, ONCE, FOR EVERY LONG LIST THAT NEEDS THEM.
//
// Mike, 2026-10-06, looking at the theme picker: *"Probably sort and filter options. We could maybe use the setup
// that the modules module has as the global for things we want to sort and filter. Don't want to keep rebuilding
// that. Also, it's easier for the users if everything is consistent."*
//
// So this is the Modules library's search box, its "Order" list, its "Filters…" button and its chips, taken out of
// library.js and made the one way a long list is searched, ordered and narrowed. Two lists use it today: the
// Modules library (library.js) and the theme picker (choice_picker.js with theme_gallery.js). Both draw the same
// controls with the same look, and both answer the same rule: every word typed must appear somewhere in a thing's
// words, in any order, in any case.
//
// TWO HALVES, so a host keeps its own markup and its own switch scan:
//   THE RULES (pure):   queryWords, matchesQuery, filterWith, sortWith, sortFilter.
//   THE CONTROLS (HTML): searchBoxHTML, selectHTML, chipsHTML, filtersButtonHTML, and the one stylesheet they
//                        share (`ensureSortFilterCss`, class names `sf-*`). Each builder takes the data attribute
//                        its host listens for, so the library's `data-lib-q` stays `data-lib-q` and nothing that
//                        reads the library had to change.
// What a host does with a change (save it, redraw everything, redraw only the results) stays the host's: the
// library redraws everything and remembers the choice; the picker redraws its results and remembers nothing.
//
// A FACET is one way to narrow: `{ id, label, any, options: [{ id, label }], test(item, value) }`. `any` is the
// option that narrows nothing ("Everything", "Anything"); a value of `any`, '' or null is no filter at all.
// A SORT is `{ id, label, compare(a, b, ctx) }`. Ties keep the order the items came in (Array sort is stable),
// so a host's own order is the last tie-break.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------------------------------
// THE RULES (pure)
// ---------------------------------------------------------------------------------------------------

/** The words typed, lower case, empty ones dropped. */
export function queryWords(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Does `text` hold every word of `query` (a string, or words from queryWords)? Any order, any case. */
export function matchesQuery(text, query) {
  const words = Array.isArray(query) ? query : queryWords(query);
  if (!words.length) return true;
  const h = String(text || '').toLowerCase();
  return words.every((w) => h.includes(w));
}

const narrows = (f, v) => !(v === undefined || v === null || v === '' || v === f.any);

/**
 * The items that pass every chosen facet and the search.
 *   query   what was typed
 *   text    item -> the words it is found by (its name, its description...)
 *   facets  [{ id, any, test }], picked { facetId: value }
 *   pin     item -> true for an item no facet narrows away (a "Keep" or a "Follow" choice); the search still does
 */
export function filterWith(items, { query = '', text = (it) => String(it?.title ?? it?.label ?? ''), facets = [], picked = {}, pin = null } = {}) {
  const words = queryWords(query);
  const active = (facets || []).filter((f) => f && narrows(f, picked?.[f.id]));
  return (items || []).filter((it) => {
    if (!(pin && pin(it))) {
      for (const f of active) {
        let ok = false;
        try { ok = !!f.test(it, picked[f.id]); } catch { ok = false; }
        if (!ok) return false;
      }
    }
    if (!words.length) return true;
    return matchesQuery(text(it), words);
  });
}

/** A new array in sort `sortId` (the first sort when it is unknown). `ctx` is handed to compare (usage...). */
export function sortWith(items, sortId, sorts = [], ctx = undefined) {
  const list = [...(items || [])];
  const s = (sorts || []).find((x) => x && x.id === sortId) || (sorts || [])[0];
  if (!s || typeof s.compare !== 'function') return list;
  return list.sort((a, b) => s.compare(a, b, ctx));
}

/** filterWith, then sortWith: `{ ...filterWith's, sort, sorts, ctx }`. */
export function sortFilter(items, opts = {}) {
  return sortWith(filterWith(items, opts), opts.sort, opts.sorts, opts.ctx);
}

/** A name comparison for a sort's tie-break: case and accents ignored, as the library always did. */
export const byText = (get) => (a, b) => String(get(a) ?? '').localeCompare(String(get(b) ?? ''), undefined, { sensitivity: 'base' });

// ---------------------------------------------------------------------------------------------------
// THE CONTROLS (HTML). Every builder returns a string; `attr` is the host's own data attribute (written as is,
// e.g. 'data-lib-q'), `cls` any class of the host's own to add beside the shared `sf-*` one.
// ---------------------------------------------------------------------------------------------------

/** The search box. A box for a keyboard: never a stop on a switch scan (both hosts leave it out of theirs). */
export function searchBoxHTML({ attr = 'data-sf-q', label = 'Search', placeholder = 'Search', value = '', cls = '', extra = '' } = {}) {
  return `<input type="search" class="sf-search${cls ? ` ${cls}` : ''}" ${attr} placeholder="${esc(placeholder)}" aria-label="${esc(label)}"${
    value ? ` value="${esc(value)}"` : ''}${extra ? ` ${extra}` : ''}>`;
}

/** A dropdown: the "Order" list, or a facet kept behind "Filters…". `options` [{ id, label }]. */
export function selectHTML({ attr = 'data-sf-sel', label = '', options = [], value = undefined, cls = '', disabled = false } = {}) {
  return `<select class="sf-select${cls ? ` ${cls}` : ''}" ${attr}${label ? ` aria-label="${esc(label)}"` : ''}${disabled ? ' disabled' : ''}>${
    (options || []).map((o) => `<option value="${esc(o.id)}"${value !== undefined && String(value) === String(o.id) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}

/** A labelled dropdown in the small print of "Filters…" (the library's "Asks of them"). */
export function labelledSelectHTML({ text = '', cls = '', ...rest } = {}) {
  return `<label class="sf-small${cls ? ` ${cls}` : ''}">${esc(text)} ${selectHTML({ label: rest.label || text, ...rest })}</label>`;
}

/** The "Filters…" button: shows or hides the less used filters. */
export function filtersButtonHTML({ attr = 'data-sf-more', open = false, label = 'Filters…', cls = '' } = {}) {
  return `<button type="button" class="sf-btn${cls ? ` ${cls}` : ''}" ${attr} aria-expanded="${open ? 'true' : 'false'}">${esc(label)}</button>`;
}

/**
 * A row of chips, one per option, the chosen one pressed. `attrOf(option)` -> the data attribute(s) a chip
 * carries (the host's way to know which was pressed). A chip is a stop on a switch scan where the host makes
 * it one (the library's categories row; the picker's "Show" row).
 */
export function chipsHTML({ options = [], value = undefined, attrOf = (o) => `data-sf-chip="${esc(o.id)}"`, cls = '' } = {}) {
  return (options || []).map((o) => `<button type="button" class="sf-chip${cls ? ` ${cls}` : ''}" ${attrOf(o)} aria-pressed="${
    value !== undefined && String(value) === String(o.id) ? 'true' : 'false'}">${esc(o.label)}</button>`).join('');
}

// ---------------------------------------------------------------------------------------------------
// THE LOOK, one stylesheet for every host (it was library.js's, moved here unchanged). CHOSEN (a pressed chip) is
// a 2px edge INSIDE, in the theme's --focus -- its accent, made to clear 3:1 on every surface (theme.js); the raw
// --accent measured 2.83:1 at worst, in default (2026-10-04). A switch cursor is the host's own ring OUTSIDE, so
// inside-edge vs. outside-ring is what tells "chosen" from "lit".
// ---------------------------------------------------------------------------------------------------
export const SORT_FILTER_CSS_ID = 'sort-filter-css';
export const SORT_FILTER_CSS = `
.sf-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.sf-search{flex:1 1 9em;min-width:7em;padding:7px 10px;border-radius:10px;border:1px solid var(--border);
  background:var(--bg,var(--surface));font:inherit;color:var(--text)}
.sf-select{padding:7px 8px;border-radius:10px;border:1px solid var(--border);background:var(--bg,var(--surface));max-width:100%;
  font:inherit;color:var(--text)}
.sf-btn{border:1px solid var(--border);background:var(--surface-alt,var(--surface));border-radius:10px;padding:6px 12px;
  cursor:pointer;min-height:40px;font:inherit;color:var(--text)}
.sf-more{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sf-more[hidden]{display:none}
.sf-small{font-size:.85rem;color:var(--text-muted)}
.sf-row{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;flex:0 0 auto;padding:2px 2px 4px;scrollbar-width:thin}
.sf-row[hidden]{display:none}
.sf-chip{flex:0 0 auto;border:1px solid var(--border);background:var(--surface-alt,var(--surface));border-radius:999px;
  padding:5px 12px;cursor:pointer;min-height:36px;min-width:44px;white-space:nowrap;font:inherit;color:var(--text)}
.sf-chip[aria-pressed=true]{border-color:var(--focus, var(--accent));font-weight:600;box-shadow:inset 0 0 0 1px var(--focus, var(--accent))}
/* AT A PHONE'S WIDTH THE CHIP ROWS WRAP (2026-10-06). One sideways row cut the last chips off at the panel's side
   (dev/home_phone_test.html: the picker's "Seasons" and "Holidays" in the Theme tab at 375 wide; the library's
   "Learning" onward the same), with nothing on a phone to say there were more. Behind the same width as
   modules.html's phone layout (620px), so a desktop panel keeps its one row exactly as it was. */
@media (max-width:620px){.sf-row{flex-wrap:wrap}}
`;
export function ensureSortFilterCss(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || doc.getElementById(SORT_FILTER_CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = SORT_FILTER_CSS_ID;
  st.textContent = SORT_FILTER_CSS;
  (doc.head || doc.documentElement).append(st);
}
