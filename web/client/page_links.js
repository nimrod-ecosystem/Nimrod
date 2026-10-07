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
//
// *** "OPEN IT HERE" ON A SCREEN PAGE THAT IS REALLY SOMEBODY'S COMPUTER (row 2.57, Mike 2026-10-07). *** On his
// own computer, showing a screen page, the Devices row gave Mike only a code to scan: "it wants me to use my
// phone". So the menu page also offers "Open it here" (a new tab, the screen page left as it was) when BOTH hold:
//   1. THIS BROWSER IS SIGNED IN with the screen's own account (/api/me `signed_in`, server identity.signed_in_here).
//      A care-room screen runs on the screen's key and nobody signs in on it; somebody signed in typed their way
//      in, at a keyboard. It is also what the keys page needs to save anything from here.
//   2. THE BROWSER HAS ITS OWN WINDOW AROUND THE PAGE - tabs and an address bar (`(display-mode: browser)`), so a
//      new tab can be closed and the screen page is one tab away. A full-screen kiosk browser [training knowledge,
//      to be checked on the bench: Chromium's --kiosk reports `display-mode: fullscreen`] has no tab strip, and a
//      tab opened there covers the screen until somebody who knows the keys closes it - the CLAUDE.md invariant.
// ARGUED, the alternatives: "it has a mouse or keyboard" (`pointer: fine`) - the bench and care-room Pis are Pi 400s,
// a keyboard with a computer inside, and have a mouse; it cannot tell them from Mike's desk. "Never on a screen"
// (before) - safe, and what sent Mike to his phone. The two checks together keep the care-room case exactly as it
// was (address and code only) unless somebody has both signed in there AND left it in an ordinary window.
// The address and the code stay on the page either way: they always work.

import { siteHost } from './screen_pair.js';
import { qrSVG } from './qr.js';
import { contrast, TEXT_MIN } from './theme.js';
import { authHeaders } from './auth.js';

export const CLAUDE_PAGE = '/claude.html';     // = nimrod_ai.js CLAUDE_SETTINGS_PAGE (the suite checks they agree)
export const REVIEWS_PAGE = '/reviews.html';
export const SEARCH_KEYS_PAGE = '/search_keys.html';   // recommend.js's "Add a key" opens the same page
export const HELPER_PAGE = '/helper.html';             // = nimrod_helper.js HELPER_PAGE (the suite checks they agree)

// The pages, by key: what a row is called, the menu page's title on a screen, and the hint off one.
export const ELSEWHERE_PAGES = Object.freeze({
  claude: Object.freeze({ path: CLAUDE_PAGE, label: 'Claude on this account…', title: 'Claude on this account',
    offHint: 'opens in a new tab: the account’s key, the model, today’s spending' }),
  reviews: Object.freeze({ path: REVIEWS_PAGE, label: 'Review questions…', title: 'Questions waiting for review',
    offHint: 'opens in a new tab: the packs waiting, how far each has got, every question marked wrong' }),
  search: Object.freeze({ path: SEARCH_KEYS_PAGE, label: 'Search songs and videos by name\u2026',
    title: 'Search songs and videos by name',
    offHint: 'opens in a new tab: your own YouTube and Spotify keys, entered once, for every search by name' }),
  // The one install package (DECISIONS 2026-10-07 item 3): shown in the Voice section when no speech program
  // answers on this computer. A download is installed at a desk, never at a screen, so a screen shows the address.
  helper: Object.freeze({ path: HELPER_PAGE, label: 'Get the Nimrod helper for this computer…',
    title: 'Get the Nimrod helper for this computer',
    offHint: 'opens in a new tab: what it installs, that what it hears stays on the computer, how to remove it' }),
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
export function elsewhereHTML(path, { loc = here(), colours = null, cls = 'pl-elsewhere', openHere = false } = {}) {
  const qr = elsewhereQR(path, { loc, colours });
  // (row 2.57) With "Open it here" (see the header): the button first, then the address and code as before.
  const open = openHere
    ? `<p><button type="button" class="pl-open-here" data-elsewhere-open style="min-height:44px;padding:8px 14px;font:inherit">${esc(OPEN_HERE_WORDS.button)}</button></p>`
    : '';
  return `<div class="${esc(cls)}" data-elsewhere="${esc(path)}">
    ${open}<p>${openHere ? 'Or, on your phone or another computer' : 'On your phone or computer'}, open <b data-elsewhere-address>${esc(pageAddress(path, loc))}</b></p>
    ${qr ? `<div data-elsewhere-qr style="width:min(180px,60%);margin:8px 0">${qr}</div>` : ''}
    <p data-elsewhere-note>${openHere ? esc(OPEN_HERE_WORDS.note) : 'Nothing opens on this screen: it keeps showing what it was showing.'}</p></div>`;
}

export const OPEN_HERE_WORDS = Object.freeze({
  button: 'Open it here',
  note: 'Open it here opens a new tab; this page stays as it was, one tab away.',
});

/** Does this browser have its own window around the page (tabs, an address bar)? False when it cannot tell. */
export function hasBrowserWindow(win = (typeof window !== 'undefined' ? window : null)) {
  try { return !!(win && win.matchMedia && win.matchMedia('(display-mode: browser)').matches); } catch { return false; }
}

/** Is this browser signed in with the screen's own account (/api/me `signed_in`)? False on any doubt. */
export async function signedInHere({ fetchImpl = (...a) => fetch(...a), headers = () => authHeaders() } = {}) {
  try {
    const r = await fetchImpl('/api/me', { headers: headers(), credentials: 'same-origin' });
    if (!r || !r.ok) return false;
    const j = await r.json();
    return !!(j && j.signed_in === true);
  } catch { return false; }
}

/** "Open it here" is offered on a screen page only when both hold (see the header). PURE. */
export function canOpenHere({ signedIn = false, browserWindow = false } = {}) {
  return signedIn === true && browserWindow === true;
}

/**
 * May an ordinary link on this page (a question's source, say) open in a new tab? (Mike, 2026-10-07: "The
 * source wiki links should be something I can click on that opens it in a new window.") Off a screen: yes.
 * On a screen page: only by the "Open it here" rule above — signed in here AND an ordinary browser window —
 * so a care-room kiosk still shows the words and the address. Resolves false on any doubt. Asks /api/me only
 * on a screen that has a browser window around it, so a full-screen kiosk asks nothing.
 */
export async function linksOpenHere({ isScreen = false, signedIn = signedInHere, browserWindow = hasBrowserWindow } = {}) {
  if (isScreen !== true) return true;
  let win = false;
  try { win = browserWindow() === true; } catch { win = false; }
  if (!win) return false;
  try { return canOpenHere({ signedIn: (await signedIn()) === true, browserWindow: win }); } catch { return false; }
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

/**
 * The menu page a screen's row opens: settings.js's `{ title, render(el) }`. The address and code are drawn at
 * once; "Open it here" joins them when this browser turns out to be signed in and in an ordinary window (row 2.57,
 * the header). `signedIn` and `browserWindow` are injectable for a suite.
 */
export function elsewhereMenuPage(key, {
  loc = here(), open = openPageTab, signedIn = signedInHere, browserWindow = hasBrowserWindow,
} = {}) {
  const p = ELSEWHERE_PAGES[key];
  if (!p) return undefined;
  return {
    title: p.title,
    render(el) {
      const draw = (openHere) => {
        el.innerHTML = elsewhereHTML(p.path, { loc, colours: themeQrColours(el), cls: 'st-hint pl-elsewhere', openHere });
        el.querySelector('[data-elsewhere-open]')?.addEventListener('click', () => { open(p.path); });
      };
      draw(false);
      let win = false;
      try { win = browserWindow() === true; } catch { win = false; }
      if (!win) return;
      Promise.resolve(signedIn()).then((yes) => {
        if (canOpenHere({ signedIn: yes === true, browserWindow: win }) && el.isConnected !== false
            && el.querySelector(`[data-elsewhere="${p.path}"]`)) draw(true);
      }).catch(() => { /* stays as drawn: the address and the code */ });
    },
  };
}
