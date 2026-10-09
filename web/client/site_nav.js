// site_nav.js — THE SITE'S SIDEBAR, drawn by one function for every page that has it (settings sidebar, 2026-10-08).
//
// Mike, 2026-10-08: "Every tab should have the sidebar like the devices and Dashboards tab. You might have to make
// some changes to the modules tab to fit everything correctly." The sidebar was My dashboards' own (home.js), so its
// tabs -- Dashboards, Media, Devices, Notifications, Remote, Records, Rules -- had it, and the site's other two tabs,
// Home (/home) and Modules (/modules), had a strip of links along the top instead. Now this file draws the one
// sidebar, and all three pages call it:
//   My dashboards (home.html)    its tabs are BUTTONS that change the panel in place (home.js; unchanged behaviour)
//   Home (/home), Modules        the same list as LINKS, each opening My dashboards on that tab (/home.html?tab=<id>)
// So there is one list of tabs (SITE_TABS, which home.js re-exports as TABS) and one look (site_nav.css).
//
// WHEN HOME AND MODULES SHOW IT: signed in. Argued:
//   FOR signed out too: My dashboards already shows it signed out (it runs on this browser's storage then), so a
//   visitor sees two kinds of navigation on two pages.
//   AGAINST, and it wins as the default: signed out, Home hands over to the Modules page and the Modules page's top
//   bar carries what a visitor needs -- What Nimrod is, a theme, Sign in -- none of which the sidebar has; a sidebar
//   of seven tabs about dashboards they have not made is a wall of places for somebody deciding whether to sign in.
//   Changing it is one condition in each page (`paintNav` on /modules, `signedIn` on /home).
// WHILE A DASHBOARD FILLS THE WINDOW (Home's landing, `body.is-land`) it is not drawn: Mike, 2026-10-02 -- "the
// dashboard should be the whole screen" -- and a sidebar beside it would make it a dashboard on a webpage again.
//
// HARD-CODED, argued (Rule 1):
//   212px wide        the width My dashboards has had since it was built; the widest label ("Make your profile ↗")
//                     fits in it at the site's font. Not a setting: it is the page's own frame.
//   720px             where it turns into a strip along the top -- My dashboards' existing line, kept so the three
//                     pages turn into their phone shapes at the same width.

import { CLAUDE_PAGE, REVIEWS_PAGE } from './page_links.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The tabs in the sidebar (moved here from home.js, 2026-10-08, with their history). Adding one means adding a
// `mount` in home.js -- the shell doesn't need to know anything else about it. (An "Audio hub" tab belongs here when
// it exists; an empty tab is worse than no tab, so it isn't stubbed.)
// `hidden: true` takes a tab out of the sidebar WITHOUT removing it. It stays in SITE_TABS, it stays mountable, and
// `show('<id>')` still reaches it — so a bookmark, a saved tab, or somebody who was using it is never met with a dead
// end.
//
// *** ADULTING IS GONE (hidden 2026-08-27, removed 2026-09-02, Mike). *** It was a personal points board for a carer,
// connected to nothing else on this page — not to a screen, not to a person, not to the patient — so every
// first-time visitor paid to read a tab about THEIR OWN chores while working out what the product is. A carer who
// wants their own board makes a screen and puts a quest board on it.
export const SITE_TABS = [
  // *** THE LABEL IS "Dashboards". THE ID STAYS `screens`. *** (PRIORITY.md #4.)
  //
  // Same rule the `inputs`/Devices row below already follows: a tab id is a stable identifier -- it is in URLs, in
  // saved state and in tests -- and renaming it is a migration, not a label change. Only the word a person reads
  // moves. Not to be confused with the transport bar's button, which Mike separately decided is "Home".
  { id: 'screens',  label: 'Dashboards', hint: 'make and fill your dashboards' },
  { id: 'media',    label: 'Media',    hint: 'connect the folders your photos live in' },
  // The ID STAYS `inputs` (it is in URLs, in tests and in `INPUTS_KEY` on the server). Only the word moved to Devices.
  { id: 'inputs',   label: 'Devices',  hint: 'the switches, controllers and keys you use — and what each one does' },
  // "Output" is engineering's word for it. What the tab configures is how the screen TELLS somebody something --
  // spoken, on screen, a sound -- which is a notification in everybody else's vocabulary. Id unchanged.
  { id: 'output',   label: 'Notifications',
    hint: 'how this dashboard answers — spoken, on screen, a sound' },
  { id: 'remote',   label: 'Remote',   hint: 'drive their screen from here, while they are at it' },
  // ON HOME, NOT ON THE KIOSK. Reviewing what a module recorded is a different job in a different room, and a table
  // of somebody's performance has no business on the screen they cannot walk away from.
  { id: 'records',  label: 'Records',  hint: 'what a module wrote down, and vouching for it' },
  // The state machine, in sentences. The engine has always been authorable; what was missing was that nobody could
  // READ the config. See rules.js.
  { id: 'rules',    label: 'Rules',    hint: 'what each screen does on its own, and when' },
];

// What the sidebar actually draws.
export const VISIBLE_SITE_TABS = SITE_TABS.filter((t) => !t.hidden);

// The site's PAGES, above the tabs. 2026-10-07 (Mike: "What you have as the modules page now should be the
// homepage/profiles. I still want the old Modules tab"): Home is Your people and the editor; Modules is the library
// with one to try, its settings beside it and its bar under it. "Make your profile" because the game had no way in
// (Mike, 2026-09-29: "I don't see Nimrod anywhere").
export const SITE_PAGES = Object.freeze([
  { id: 'home', href: '/home', label: 'Home', title: 'your people, and your Home to make your own' },
  { id: 'modules', href: '/modules', label: 'Modules', title: 'everything you can put on a screen, and one to try with its settings' },
  { id: 'profile', href: '/game/', label: 'Make your profile', title: 'make your own profile screen, with Nimrod the cat to show you how' },
]);

/** A dev server's `?user=` rides along on every link, as home.js's `navigate` does. Pure given `search`. */
export function withDevUser(href, search = (typeof location !== 'undefined' ? location.search : '')) {
  let u = null;
  try { u = new URLSearchParams(search || '').get('user'); } catch { u = null; }
  if (!u || /^https?:/.test(href)) return href;
  const [path, hash = ''] = String(href).split('#');
  return `${path}${path.includes('?') ? '&' : '?'}user=${encodeURIComponent(u)}${hash ? `#${hash}` : ''}`;
}

/** Where a tab of My dashboards opens from another page. */
export const tabHref = (id) => `/home.html?tab=${encodeURIComponent(id)}`;

/**
 * The sidebar's markup (the `<nav class="s-side">` element itself).
 *   here        'dashboards' (My dashboards: tabs are buttons), or a SITE_PAGES id ('home', 'modules')
 *   active      the tab showing, on My dashboards (home.js marks it again on every change)
 *   signedIn, email   the foot: who is signed in and the ways out, or Sign in
 *   signInHref  where Sign in goes (a page may want to come back to itself)
 *   footExtra   markup a page adds to the foot, before "Try as a guest" (home.js: Try it as someone new)
 *   search      for the dev `?user=` (a suite's seam)
 */
export function siteSideHTML({ here = 'dashboards', active = null, signedIn = false, email = '',
  signInHref = '/auth/login', footExtra = '', search = undefined } = {}) {
  const link = (h) => esc(withDevUser(h, search));
  const shell = here === 'dashboards';
  // The pages: on My dashboards each one LEAVES the shell (↗, as it always has). On a page, the one you are on is
  // marked (aria-current, and the same "on" look as a tab) and has no ↗ -- it goes nowhere.
  const pages = SITE_PAGES.map((p) => {
    const cur = p.id === here;
    return `<li><a class="s-navb s-link${cur ? ' on' : ''}" href="${link(p.href)}" data-nav="${p.id}" title="${esc(p.title)}"${
      cur ? ' aria-current="page"' : ''}>${esc(p.label)}${cur ? '' : ' ↗'}</a></li>`;
  }).join('');
  const tabs = VISIBLE_SITE_TABS.map((t) => (shell
    ? `<li><button class="s-navb${t.id === active ? ' on' : ''}" data-tab="${t.id}" title="${esc(t.hint)}">${esc(t.label)}</button></li>`
    : `<li><a class="s-navb" href="${link(tabHref(t.id))}" data-side-tab="${t.id}" title="${esc(t.hint)}">${esc(t.label)}</a></li>`)).join('');
  const foot = signedIn
    ? (email ? `<div class="s-email">${esc(email)}</div>` : '')
      + '<a class="s-signout" href="/auth/logout">Sign out</a>'
      // SWITCH ACCOUNT: /auth/logout clears our session and not Google's, so signing back in silently picks the same
      // account up again. ?switch=1 asks Google to show the chooser. (PRIORITY.md #6.)
      + '<a class="s-signout" href="/auth/login?switch=1">Switch account</a>'
      // THE ACCOUNT'S OWN PAGES (2026-10-04, page_links.js): here because this is where the account's things live.
      + `<a class="s-signout s-acct" data-acct="claude" href="${esc(CLAUDE_PAGE)}">Claude on this account</a>`
      + `<a class="s-signout s-acct" data-acct="reviews" href="${esc(REVIEWS_PAGE)}">Review questions</a>`
      + footExtra
      // TRY AS A GUEST: ?demo=1 boots the kiosk on a local throwaway backend that touches no account.
      + '<a class="s-signout" href="/kiosk.html?demo=1">Try as a guest</a>'
    : `<a class="s-signout" href="${esc(signInHref)}">Sign in</a>`
      + footExtra
      + '<a class="s-signout" href="/kiosk.html?demo=1">Try as a guest</a>';
  // The brand: on a page it is a link to Home, as the old top bar's was (Mike, 2026-09-08: the brand going to the
  // landing page looked like being signed out). On My dashboards it stays the plain word it always was.
  const brand = shell
    ? '<div class="s-brand">Nimrod<span>.</span></div>'
    : `<a class="s-brand" href="${link('/home')}">Nimrod<span>.</span></a>`;
  return `<nav class="s-side" aria-label="Pages">
        ${brand}
        <ul class="s-nav s-out">${pages}</ul>
        <ul class="s-nav">${tabs}</ul>
        <div class="s-foot">${foot}</div>
      </nav>`;
}

/**
 * Draw the sidebar into a page's slot (`el`, an empty `<div data-site-side hidden>` at the start of `.shell`; it is
 * `display:contents`, so the nav itself is the shell's first column) and mark the page so its own CSS can make room
 * (`body.has-side`). Returns the nav element. Idempotent: a second call redraws.
 */
export function mountSiteSide(el, opts = {}) {
  if (!el) return null;
  el.innerHTML = siteSideHTML(opts);
  el.hidden = false;
  try { el.ownerDocument.body.classList.add('has-side'); } catch { /* no document */ }
  return el.querySelector('.s-side');
}
