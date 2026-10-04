// page_links.js — PAGES THAT ARE SET UP SOMEWHERE ELSE, AND HOW EACH PLACE POINTS AT THEM.
//
// Mike, 2026-10-04, about the Claude settings page: *"On your own phone or computer (not a screen), open
// /claude.html ... How do I go there?"* Nothing linked to /claude.html (1e38a4b) or to /reviews.html
// (6466574): both were reachable only by typing the address. They are linked now from the ⚙ menu (Devices:
// "Claude on this account…"; This screen: "Review questions…"), from a Trivia panel's "Include unreviewed
// questions" row ("See reviews…"), from the guide (the connect step's Claude choice, and "Check trivia
// questions"), and from the account links in My dashboards. This file is the one place that says where each
// page is and what a SCREEN shows instead of opening it.
//
// *** ON A SCREEN, NOTHING NAVIGATES. IT SHOWS THE ADDRESS (AND A CODE TO SCAN). *** Argued, both ways:
//   FOR opening the page with a Close button (bricks.html's answer): one press and you are there, and a
//   screen with a mouse and keyboard (somebody's laptop running kiosk.html) could use it.
//   AGAINST, and it decides it: CLAUDE.md's invariant is that a screen must never enter a state only an input
//   can leave when the person in front of it cannot give that input. A page opened on a screen covers the
//   dashboard until somebody presses Close; if whoever pressed it walks away, the person left in front of the
//   screen has a settings form where their pictures were, all night. bricks.html can afford its Close because
//   nothing on a screen opens it by itself and it is a page to look at; these two are forms (a secret key, a
//   list of flagged questions) that are no use at a screen anyway — a key is typed on a keyboard, and the
//   review list is read at a desk. So on a screen the row and the guide say "open it on your phone or
//   computer: <this site>/claude.html", with a QR code to scan, and the dashboard keeps showing what it was
//   showing. Nothing to dismiss: the menu page has its own Back, and the guide's box is just words.
//   Off a screen (Home, the modules page, an ordinary tab) the same rows open the page in a NEW tab: the page
//   the person was on stays where it was.
// WHAT COUNTS AS A SCREEN: the kiosk's own word (`ctx.isScreen`, kiosk.js: true on a real screen, false when
// the kiosk is embedded in another page). The address comes from where this page is actually served
// (screen_pair.js `siteHost`), never a hostname written down here.

import { siteHost } from './screen_pair.js';
import { qrSVG } from './qr.js';
import { contrast, TEXT_MIN } from './theme.js';

export const CLAUDE_PAGE = '/claude.html';     // = nimrod_ai.js CLAUDE_SETTINGS_PAGE (the suite checks they agree)
export const REVIEWS_PAGE = '/reviews.html';
export const SEARCH_KEYS_PAGE = '/search_keys.html';   // recommend.js's "Add a key" opens the same page

// The pages, by key: what a row is called, the menu page's title on a screen, and the hint off one.
export const ELSEWHERE_PAGES = Object.freeze({
  claude: Object.freeze({ path: CLAUDE_PAGE, label: 'Claude on this account…', title: 'Claude on this account',
    offHint: 'opens in a new tab: the account’s key, the model, today’s spending' }),
  reviews: Object.freeze({ path: REVIEWS_PAGE, label: 'Review questions…', title: 'Questions waiting for review',
    offHint: 'opens in a new tab: the packs waiting, how far each has got, every question marked wrong' }),
  search: Object.freeze({ path: SEARCH_KEYS_PAGE, label: 'Search songs and videos by name\u2026',
    title: 'Search songs and videos by name',
    offHint: 'opens in a new tab: your own YouTube and Spotify keys, for finding something to recommend' }),
});
// The menu page a screen's row opens instead (settings.js `page`): `elsewhere:<key>`.
export const ELSEWHERE_PAGE_PREFIX = 'elsewhere:';

const here = () => (typeof location !== 'undefined' ? location : null);

/** "nimrodecosystem.com/claude.html": this site, as somebody would type it, and the page. */
export function pageAddress(path, loc = here()) {
  return `${siteHost(loc)}${path}`;
}
/** The absolute address, for a code a phone scans (a relative path means nothing inside a QR code). */
export function pageURL(path, loc = here()) {
  const origin = loc && loc.origin && loc.origin !== 'null' ? loc.origin : '';
  return origin ? origin + path : path;
}
/** What a screen says instead of opening the page. */
export function elsewhereLine(path, loc = here()) {
  return `open it on your phone or computer: ${pageAddress(path, loc)}`;
}
/** Off a screen: the page in a new tab, the page somebody is on left where it was. False if blocked. */
export function openPageTab(path, win = (typeof window !== 'undefined' ? window : null)) {
  try { win.open(path, '_blank', 'noopener'); return true; } catch { return false; }
}

const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || '').trim());
/**
 * The code's two colours, FROM THE THEME: the darker of the two as the dark squares, the lighter as the
 * paper. A phone reads dark-on-light; a dark theme's light text on a dark background would draw an inverted
 * code that some cameras do not read. Null when either is not a plain colour or they are too close to read
 * (then no code is drawn: the address is the thing that always works, the square the convenience).
 */
export function qrColours(a, b) {
  if (!isHex(a) || !isHex(b)) return null;
  const x = a.trim(), y = b.trim();
  if (contrast(x, y) < TEXT_MIN) return null;
  // contrast() sorts by luminance; ask which one is darker the same way.
  const darkFirst = contrast(x, '#000') < contrast(y, '#000');
  return darkFirst ? { dark: x, light: y } : { dark: y, light: x };
}
/** The theme's text and background as `el` sees them, as qrColours wants them. */
export function themeQrColours(el) {
  try {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return qrColours(cs.getPropertyValue('--text'), cs.getPropertyValue('--bg'))
      || qrColours(cs.getPropertyValue('--text'), cs.getPropertyValue('--surface'));
  } catch { return null; }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The QR code for a page as SVG, or '' (no colours, or an encoder failure: never takes the address down). */
export function elsewhereQR(path, { loc = here(), colours = null } = {}) {
  if (!colours) return '';
  try {
    return qrSVG(pageURL(path, loc), { level: 'M', quiet: 4, dark: colours.dark, light: colours.light,
      title: `Scan to open ${pageAddress(path, loc)}` });
  } catch (err) { console.error('page_links: qr', err); return ''; }
}

/**
 * What a screen shows for a page: the address in words, the code beside it when it can be drawn, and what
 * did NOT happen ("nothing opens on this screen"). `data-elsewhere` carries the path for a suite.
 */
export function elsewhereHTML(path, { loc = here(), colours = null, cls = 'pl-elsewhere' } = {}) {
  const qr = elsewhereQR(path, { loc, colours });
  return `<div class="${esc(cls)}" data-elsewhere="${esc(path)}">
    <p>On your phone or computer, open <b data-elsewhere-address>${esc(pageAddress(path, loc))}</b></p>
    ${qr ? `<div data-elsewhere-qr style="width:min(180px,60%);margin:8px 0">${qr}</div>` : ''}
    <p data-elsewhere-note>Nothing opens on this screen: it keeps showing what it was showing.</p></div>`;
}

/**
 * A ⚙ menu row for a page. Off a screen: `run` opens it in a new tab. On a screen: `page` opens the
 * address-and-code page in the menu (`elsewhereMenuPage`), whose Back is the menu's own.
 * `over` overrides any field (id, label, hint, tab...).
 */
export function pageRow(key, { isScreen = false, loc = here(), open = openPageTab, over = {} } = {}) {
  const p = ELSEWHERE_PAGES[key];
  if (!p) return null;
  const base = { kind: 'item', id: `${key}-page`, label: p.label };
  if (isScreen) return { ...base, page: `${ELSEWHERE_PAGE_PREFIX}${key}`, hint: elsewhereLine(p.path, loc), ...over };
  return { ...base, hint: p.offHint, run: () => { open(p.path); }, ...over };
}

/** The menu page a screen's row opens: settings.js's `{ title, render(el) }`. */
export function elsewhereMenuPage(key, { loc = here() } = {}) {
  const p = ELSEWHERE_PAGES[key];
  if (!p) return undefined;
  return {
    title: p.title,
    render(el) { el.innerHTML = elsewhereHTML(p.path, { loc, colours: themeQrColours(el), cls: 'st-hint pl-elsewhere' }); },
  };
}
