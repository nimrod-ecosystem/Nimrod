// page_sections.js — "EDIT MY PAGE": YOUR PEOPLE AS A LIST OF SECTIONS YOU CAN ADD TO, REMOVE AND MOVE, as data and
// pure rules. modules/people.js draws it.
//
// Mike, 2026-10-04 (DECISIONS.md, "The landing is a very simple profile page", item 8): *"I'm picturing what we're
// doing now as more of a 'webpage module' where people could have different modules etc. in a familiar webpage
// format instead of a dashboard. So basically like myspace or something."* This is the first version of that: the
// page is a single column of sections, top to bottom, and "Edit my page" adds one from a short library, removes one,
// or moves one up or down.
//
// *** STORED AS MEANING, PER PERSON. *** The page is the signed-in person's own record, `PAGE_KEY` in their
// per-person state (the same path their picture and their Home settings use): `{ sections: [{ kind, id, options }] }`.
// A person who never edits has NO `sections` there, and gets `DEFAULT_SECTIONS` -- exactly the page as it was before
// this file existed -- so nothing changes for anybody until they press something, and a later change to the default
// reaches everybody who never chose otherwise.
//
// *** TWO DEVICES EDITING AT ONCE (`mergePageDoc`). *** The list is merged as what it is, a set of sections each named
// by its `id`, plus an order: a section added on one device and another moved on the other both survive (doc_merge.js
// `merge3` for what is inside each section; the order taken from whichever side changed it). Both sides reordering
// differently is the one true clash, settled the way every other settings doc here settles one (doc_merge.js: the
// other device's stands, and the caller is told so it can say so).
//
// *** A KIND THIS VERSION DOES NOT KNOW (a newer site wrote it) IS KEPT, UNTOUCHED. *** Every edit here changes the
// stored list by `id` and writes the rest of it back as it was read, so an unknown section's `options` survive a save
// from an older page; the page shows it as one quiet line (`EDIT_WORDS.newer`) rather than breaking.
//
// *** PLAIN WORDS (`pageWordProblems`). *** The page's banned words (people_page.js `BANNED_WORDS`) plus "widget",
// "account" and "token", over everything this page shows in view mode AND in edit mode. people_page.js's list is not
// widened itself: the same check also reads the bar Home draws around the page, which is not this file's to reword.

import { plainWordProblems } from './people_page.js';
import { merge3 } from './doc_merge.js';
import { parseLink } from './recommend.js';

export const PAGE_KEY = 'page';

// The extra words this page may not say, beyond people_page.js's four.
export const PAGE_EXTRA_BANNED = Object.freeze(['widget', 'account', 'token']);
/** Every banned word in `text`, lower case, each once (people_page.js's four, then these). PURE. */
export function pageWordProblems(text) {
  const out = plainWordProblems(text);
  const s = String(text == null ? '' : text);
  for (const w of PAGE_EXTRA_BANNED) if (new RegExp(`\\b${w}s?\\b`, 'i').test(s)) out.push(w);
  return out;
}

// The parts of today's page, as sections, in today's order. `self` (you, at the top) is FIXED: it holds "Edit my
// page", so the page is never left with no way back to editing. ARGUED: FOR letting it go too (it is their page),
// somebody may want a page that opens on their people. AGAINST, and it decides it: the way into editing would have to
// live somewhere else that is just as findable, and a phone has no other obvious place; "it is always at the top" is
// a promise a person can rely on. If somebody asks, a slimmer You (no picture) is the next step, not removing it.
export const FIXED_KIND = 'self';
export const BUILT_IN_KINDS = Object.freeze(['self', 'messages', 'recommended', 'people', 'connect', 'nimrod']);
export const DEFAULT_SECTIONS = Object.freeze(BUILT_IN_KINDS.map((k) => Object.freeze({ kind: k, id: k, options: Object.freeze({}) })));

// The sizes a box on the page may be (a clock, pictures, a video). In rem, so the person's text size
// carries them. A SETTING per section (Rule 1), default medium: tall enough for a photo to read on a phone held
// upright, short enough that the people below it are a thumb-scroll away.
export const BOX_SIZES = Object.freeze({ small: '12rem', medium: '18rem', large: '26rem' });
export const BOX_SIZE_LABELS = Object.freeze({ small: 'Small', medium: 'Medium', large: 'Large' });
export const DEFAULT_BOX_SIZE = 'medium';
export const boxHeight = (options) => BOX_SIZES[options?.size] || BOX_SIZES[DEFAULT_BOX_SIZE];

// How long "About me" may be. ARGUED, not a setting: it is the size of a page's "about" box anywhere (a few short
// paragraphs), it bounds what one press of Save sends, and a person who wants more is writing something that belongs
// in a note. 2000 characters.
export const ABOUT_MAX = 2000;

/**
 * THE LIBRARY: what "Add something" offers. Each has a plain name and one line saying what it is.
 *   builtIn   one of today's parts (each at most once; offered again only once removed)
 *   module    the site's own thing mounted in a box of fixed height, the normal way (modules/<module>.js)
 *   fields    which of that thing's own settings the page offers while editing (its manifest's, by key): the few a
 *             person setting up a page box needs, not its whole menu
 *   relabel   { key: { value: 'words' } } -- an option of one of those settings named in this page's words where the
 *             thing's own words would break the page's plain-word rule (photos' "Fill the panel")
 *   repeat    may be on the page more than once
 * WHY THESE: the site's things that make sense in a box on a page and work with nothing else set up -- a clock, your
 * own pictures, a video (one link, pasted). LEFT OUT, each for a reason: the weather (its own messages -- no place
 * yet, a place not found -- tell you to open "this panel's settings", words this page may not show, and a page box
 * has no such settings; it comes in once weather.js can be told it is in a page box), music (it needs a list of
 * favourites set up first, which is a whole window of its own), a YouTube playlist (the same), a note (it is a
 * message left on a screen, which "Messages for you" already shows), games (a page is for looking at, and a game in
 * a box on a phone is too small to play). There is no calendar on the site yet.
 */
export const SECTION_LIBRARY = Object.freeze([
  { kind: 'self', name: 'You', line: 'Your picture and your name, at the top.', builtIn: true },
  { kind: 'messages', name: 'Messages for you', line: 'The newest messages left for you.', builtIn: true },
  { kind: 'recommended', name: 'Recommended for you', line: 'Songs and videos your people sent you.', builtIn: true },
  { kind: 'people', name: 'Your people', line: 'A card for each of your people, to call them or send a message.', builtIn: true },
  { kind: 'connect', name: 'Connect with someone', line: 'How to invite someone to use this with you.', builtIn: true },
  { kind: 'nimrod', name: 'Ask Nimrod', line: 'Nimrod, who shows you around, and More for your settings.', builtIn: true },
  { kind: 'about', name: 'About me', line: 'A few words about you, in your own words.', repeat: true },
  { kind: 'clock', name: 'Clock', line: 'The time, the day and the date.', module: 'clock', fields: ['hour12', 'showDate', 'size'], repeat: true },
  { kind: 'photos', name: 'Pictures', line: 'Your own photos, one after another.', module: 'photos', fields: ['intervalMs', 'fit'],
    relabel: { fit: { cover: 'Fill the box' } }, repeat: true },
  { kind: 'video', name: 'A video', line: 'A YouTube video you choose, to play from your page.', module: 'youtube', repeat: true },
].map((e) => Object.freeze({ builtIn: false, module: null, fields: [], relabel: {}, repeat: false, ...e })));

const LIB = new Map(SECTION_LIBRARY.map((e) => [e.kind, e]));
/** The library entry for a kind, or null for a kind this version does not know. PURE. */
export const libraryEntry = (kind) => LIB.get(kind) || null;
export const isKnownKind = (kind) => LIB.has(kind);
/** What "Add something" lists: everything but You (it is always there). PURE. */
export const addableEntries = () => SECTION_LIBRARY.filter((e) => e.kind !== FIXED_KIND);

// The words, in one place (the suite holds every one to `pageWordProblems`).
export const EDIT_WORDS = Object.freeze({
  edit: 'Edit my page',
  editShort: 'Add, remove or move parts',
  done: 'Done',
  doneShort: 'Stop editing',
  editing: 'Editing your page',
  intro: 'Add something, take a part away, or move one up or down. Everything is saved as you go. Press Done when you are finished.',
  add: 'Add something',
  addShort: 'Choose from a short list',
  addTitle: 'Add something to your page',
  addOne: 'Add',
  already: 'Already on your page',
  moveUp: 'Move up',
  moveDown: 'Move down',
  atTop: 'Already at the top',
  atBottom: 'Already at the bottom',
  topWhy: 'This is as high as it goes: You stays at the top of your page.',
  bottomWhy: 'This is already the last part of your page.',
  remove: 'Remove',
  removeShort: 'Take it off your page',
  putBack: (name) => `Put back ${name}`,
  putBackShort: 'Undo the last remove',
  showPeople: 'Show your people again',
  showPeopleShort: 'Put Your people back on your page',
  stays: 'You: always at the top, with Edit my page.',
  screenWhy: 'Change your page from a phone or computer.',
  screenShort: 'From a phone',
  signInWhy: 'Sign in to have a page of your own to change.',
  signInShort: 'Sign in first',
  added: (name) => `Added ${name} at the bottom of your page.`,
  removed: (name) => `Took ${name} off your page.`,
  lost: 'A change made here was not kept: your page was just changed on another device.',
  failed: 'Could not save that just now. Try again in a little while.',
  newer: 'This part of your page needs a newer version of the site to show.',
  aboutEmpty: 'Nothing here yet. Press Edit my page to write something about you.',
  aboutLabel: 'About me (people who see your page will read this)',
  aboutCount: (n) => `${n} of ${ABOUT_MAX} letters`,
  size: 'How tall it is',
  latest: 'Latest message',
  more: 'More',
  moreShort: 'Your settings, your devices and more',
  videoLink: 'A YouTube link',
  videoHow: 'In YouTube, press Share, then Copy link, and paste it here.',
  videoSave: 'Use this video',
  videoNone: 'No video chosen yet. Press Edit my page to paste a YouTube link.',
  videoBad: 'That is not a link to one YouTube video. Paste a link from youtube.com or youtu.be.',
  play: 'Play',
  playShort: 'Plays here, on your page',
  stop: 'Stop',
  cannotShow: 'This could not be shown here just now.',
});

// ---- who can see your page, and which parts (DECISIONS.md 2026-10-04 night, items 7 and 8) --------------------------
// The SERVER decides what a visitor is sent (web/server/page_visits.py, test_page_visits.py) -- these are the same
// names and lists, for drawing the choices, and test_page_visits.py fails if the two sides drift apart. Stored in
// this same page record, so two devices merge it with the rest (mergePageDoc):
//   { visitors: 'me' | 'connections' | 'picked', picked: [<id of one of your people>], sections: [...options.seenBy] }
// "WHO CAN SEE MY PAGE", default the people you are connected with (Mike's item 7). FOR "Only me" by default: nothing
// is shown to anybody until you choose. AGAINST, and it decides it: with item 8's default (your card, and no more) a
// connection opening your page sees only what their own page already shows them -- your picture and your name -- so
// the default opens nothing new, and "See their page" works the day two people connect.
// "PEOPLE I PICK" is offered too: it costs one list of the people you are connected with, and it is the case "my
// family may, my old workmates may not" that the other two cannot say.
export const WHO_KEY = 'visitors';
export const PICKED_KEY = 'picked';
export const WHO_CHOICES = Object.freeze(['me', 'connections', 'picked']);
export const DEFAULT_WHO = 'connections';
// Each part's "Who sees this": default Only me (item 8: you open more parts yourself).
export const SEEN_KEY = 'seenBy';
export const DEFAULT_SEEN = 'me';
// The parts that may be opened to whoever can see your page, and the ones that never are (page_visits.py argues each).
export const OPENABLE_KINDS = Object.freeze(['about', 'clock', 'photos', 'video']);
export const PRIVATE_KINDS = Object.freeze(['messages', 'recommended', 'people', 'connect', 'nimrod']);

export const WHO_WORDS = Object.freeze({
  label: 'Who can see my page',
  choice: Object.freeze({ me: 'Only me', connections: 'People I’m connected with', picked: 'Only the people I pick' }),
  line: Object.freeze({
    me: 'Nobody else can open your page. Your picture and name still show on the pages of the people you are connected with.',
    connections: 'Everyone you are connected with can open your page. They see your picture and name, and the parts you show them.',
    picked: 'Only the people you pick below can open your page. They see your picture and name, and the parts you show them.',
  }),
  pickLead: 'Who may open your page:',
  pickNone: 'You are not connected with anybody yet. Connect with someone first.',
  pickOn: 'Can see your page',
  pickOff: 'Can’t see your page',
  seen: 'Who sees this',
  seenChoice: Object.freeze({ me: 'Only me', visitors: 'People who can see my page' }),
  privateBtn: 'Only you see this',
  keptShort: 'Kept to you',
  privateWhy: Object.freeze({
    messages: 'Messages left for you are only ever shown to you.',
    recommended: 'What your people sent you is only ever shown to you.',
    people: 'Your people’s pictures and names are theirs to share, so this part is only shown to you.',
    connect: 'This part is for you to use, so only you see it.',
    nimrod: 'This part opens your own settings, so only you see it.',
    newer: 'This part needs a newer version of the site, so only you see it.',
  }),
  selfLine: 'Your picture and name are shown to whoever can see your page.',
});

const isObj0 = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** "Who can see my page" as stored, or the default; a value this version does not know reads as Only me. PURE. */
export function whoOf(doc) {
  const v = isObj0(doc) ? doc[WHO_KEY] : undefined;
  if (v === undefined || v === null || v === '') return DEFAULT_WHO;
  return WHO_CHOICES.includes(v) ? v : 'me';
}
/** The people picked (ids of the owner's own people). PURE. */
export const pickedOf = (doc) => (isObj0(doc) && Array.isArray(doc[PICKED_KEY]) ? doc[PICKED_KEY].filter((x) => typeof x === 'string' && x) : []);
/** The picked list with `id` added or taken away. PURE. */
export function togglePicked(doc, id) {
  const now = pickedOf(doc);
  return now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
}
/** May this kind of part be opened to visitors? PURE. */
export const canOpen = (kind) => OPENABLE_KINDS.includes(kind);
/** Who sees one part: 'visitors' | 'me'. You always 'visitors'; a private or unknown part always 'me'. PURE. */
export function seenByOf(s) {
  if (!isObj0(s)) return 'me';
  if (s.kind === FIXED_KIND) return 'visitors';
  if (!canOpen(s.kind)) return 'me';
  return s.options?.[SEEN_KEY] === 'visitors' ? 'visitors' : DEFAULT_SEEN;
}

// ---- the page's own colours, and whether it offers older messages (Mike, 2026-10-05) ---------------------------------
// Both are keys of this same page record, beside "Who can see my page", so two devices merge them with the rest:
//   { theme: '<a theme id>' | '' , olderMessages: true | false, ... }
//
// "COLOURS FOR MY PAGE" (*"you can set the theme on your profile page"*). One of the site's own themes (theme.js
// listThemes -- the same list the settings menu's Colours row offers), or '' for none: the page wears whatever
// colours are around it, as it always has. WHO SEES THEM -- `pageColours` below decides, ARGUED:
//   FOR visitors keeping their own colours: a visitor's colours are a setting THEY chose, sometimes to be able to
//       read at all, and a page that overrode them would be a page some visitors cannot use.
//   FOR visitors seeing yours (a MySpace page): choosing how your page looks is half the point of having one, and
//       a page that looks the same for everybody is what makes it "yours".
//   DECIDED: visitors see your page in your colours -- EXCEPT a visitor whose own colours are for READING rather
//       than taste (ACCESS_THEMES: High contrast), or whose browser asks for more contrast or forced colours: theirs
//       win. A taste beats a taste; a need beats a taste. The same rule holds for you on your own page, so your
//       page does not turn your own High contrast off, and the edit card says so when it is happening.
//   THE MOVING SCENE of a live theme is not drawn inside a page (today): a page wears its colours only. So a visitor's
//       photosensitivity limit has nothing on the page to hold back (a scene is a whole-screen thing, and stays the
//       visitor's own); if a page ever draws one, it has to pass the visitor's flash limit first.
//   ON A SCREEN IN A ROOM the screen's own Colours stand: that row is a legibility control for whoever is in front
//       of the screen ("essential" in its menu), and a page's look must not undo it. A GUESS (Mike's list).
export const THEME_KEY = 'theme';
// The themes that are for reading, not taste: whoever chose one keeps it over a page's colours. A list rather than
// one id so a second one (a large-text or a low-glare theme) is a line here. Only High contrast today.
export const ACCESS_THEMES = Object.freeze(['contrast']);
/** The page's own colours as stored ('' for none). PURE. Not checked against the list: `pageColours` does that. */
export function themeOf(doc) {
  const v = isObj0(doc) ? doc[THEME_KEY] : '';
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '';
}
/**
 * Which theme the page is drawn in, for whoever is looking. PURE. -> a theme id, or '' (keep the colours around it).
 *   pageTheme    themeOf(the page record)
 *   known        the theme ids this site has (theme.js listThemes) -- an id it does not have is ''
 *   isScreen     a screen in a room: '' (its own Colours stand; see above)
 *   viewerTheme  the theme the viewer's own colours are (an id, or '' if not known)
 *   moreContrast the viewer's browser asks for more contrast or forced colours
 */
export function pageColours({ pageTheme = '', known = [], isScreen = false, viewerTheme = '', moreContrast = false } = {}) {
  if (!pageTheme || isScreen || !known.includes(pageTheme)) return '';
  if (moreContrast || ACCESS_THEMES.includes(viewerTheme)) return '';
  return pageTheme;
}
// "LET THIS PAGE SHOW OLDER MESSAGES" (*"'See older messages' becomes a setting"*): default ON -- Mike, *"he'd likely
// leave it on"*, and it is how the page worked before the setting existed. Off: "See older messages" is shown
// dimmed with why, on this page wherever it is drawn (your phone and every screen of yours). Each screen has its own
// row too (people_page.js PEOPLE_SETTINGS `olderHere`), for a screen in a room other people use: shown only when
// both are on. It decides what the page OFFERS; who may read the messages is the server's rule and is unchanged
// (only the person's own login, notes/history).
export const OLDER_KEY = 'olderMessages';
export const DEFAULT_OLDER = true;
/** Does the page offer "See older messages"? PURE. Only an explicit false turns it off. */
export const olderOf = (doc) => !(isObj0(doc) && doc[OLDER_KEY] === false);

// (themes, 2026-10-06: "Theme", not "Colours", wherever a person reads it - Mike: "Colours should change to theme".
// The keys stay `colours*`: they are code, and what is stored is the theme id, as it always was.)
export const PAGE_LOOK_WORDS = Object.freeze({
  colours: 'Theme for my page',
  coloursNone: 'The usual theme',
  coloursLine: 'People who can see your page see it in this theme, unless they use a theme for easier reading, like High contrast.',
  coloursOwn: 'You use High contrast, so you see your page in your own theme. People who can see your page see the theme you pick.',
  older: 'Let this page show older messages',
  olderOn: 'On',
  olderOff: 'Off',
  olderLine: 'Off: “See older messages” is not offered on your page. A screen can also turn it off just for itself, in its settings.',
  olderOffPage: 'Older messages are turned off for this page. Turn them on in Edit my page.',
  olderOffHere: 'Older messages are turned off here, in this screen’s settings.',
  olderOffShort: 'Turned off',
});

// ---- the list -----------------------------------------------------------------------------------------------------
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const J = (v) => JSON.stringify(v === undefined ? null : v);
const idOf = (s) => (isObj(s) && typeof s.id === 'string' && s.id ? s.id : null);

/** Has this person ever saved a page of their own? PURE. */
export const hasOwnPage = (doc) => isObj(doc) && Array.isArray(doc.sections);
/** The stored list, exactly as stored (unknown kinds and all), or a copy of the default. PURE. */
export function sectionsOf(doc) {
  return hasOwnPage(doc) ? doc.sections.slice() : DEFAULT_SECTIONS.map((s) => ({ ...s, options: {} }));
}

/**
 * What the page draws, top to bottom. PURE. Entries that are not sections at all (no kind, no id, a repeated id) are
 * left out of the drawing -- never out of the stored list. You comes first whatever the list says (and is put there
 * when a list left it out). On a screen, Connect with someone is not drawn (a screen invites nobody; today's screen
 * page has no such card).
 * -> [{ kind, id, options, known, entry }]
 */
export function viewSections(doc, { isScreen = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const s of sectionsOf(doc)) {
    const id = idOf(s);
    if (!id || typeof s.kind !== 'string' || !s.kind || seen.has(id)) continue;
    seen.add(id);
    const entry = libraryEntry(s.kind);
    out.push({ kind: s.kind, id, options: isObj(s.options) ? s.options : {}, known: !!entry, entry });
  }
  const at = out.findIndex((s) => s.kind === FIXED_KIND);
  const self = at >= 0 ? out.splice(at, 1)[0] : { kind: FIXED_KIND, id: FIXED_KIND, options: {}, known: true, entry: libraryEntry(FIXED_KIND) };
  out.unshift(self);
  return isScreen ? out.filter((s) => s.kind !== 'connect') : out;
}

/** Is a section of this kind on the page? PURE. */
export const hasKind = (doc, kind) => sectionsOf(doc).some((s) => isObj(s) && s.kind === kind);

/** A fresh id for a new section of `kind`. PURE given `rand`. Short: it is a key in a person's own small list. */
export function newSectionId(kind, existing = [], rand = Math.random) {
  const taken = new Set(existing.map(idOf).filter(Boolean));
  for (let i = 0; i < 50; i++) {
    const id = `${kind}-${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!taken.has(id)) return id;
  }
  return `${kind}-${Date.now().toString(36)}`;
}

/**
 * The list with a section of `kind` added. PURE. -> { sections, id } or { sections: same, id: null, why } when it
 * cannot be (an unknown kind, You, or a part of today's page that is already there).
 * Where: a new thing goes at the BOTTOM (the end of the list, where "Add" is pressed from a list at the end of a
 * scroll); a part of today's page put back goes where it was by default -- just before the first section that came
 * after it in today's order -- so "Show your people again" brings them back where they were.
 */
export function addSection(doc, kind, { id = null, options = {}, rand = Math.random } = {}) {
  const list = sectionsOf(doc);
  const entry = libraryEntry(kind);
  if (!entry || kind === FIXED_KIND) return { sections: list, id: null, why: 'unknown' };
  if (!entry.repeat && list.some((s) => isObj(s) && s.kind === kind)) return { sections: list, id: null, why: 'already' };
  const sid = entry.builtIn ? kind : (id || newSectionId(kind, list, rand));
  const sec = { kind, id: sid, options: { ...options } };
  if (entry.builtIn) {
    const later = BUILT_IN_KINDS.slice(BUILT_IN_KINDS.indexOf(kind) + 1);
    const at = list.findIndex((s) => isObj(s) && later.includes(s.kind));
    if (at >= 0) { list.splice(at, 0, sec); return { sections: list, id: sid }; }
  }
  list.push(sec);
  return { sections: list, id: sid };
}

/** The list without section `id`. PURE. You cannot be removed. -> { sections, removed: { section, index } | null } */
export function removeSection(doc, id) {
  const list = sectionsOf(doc);
  const at = list.findIndex((s) => idOf(s) === id);
  if (at < 0 || list[at].kind === FIXED_KIND) return { sections: list, removed: null };
  const [section] = list.splice(at, 1);
  return { sections: list, removed: { section, index: at } };
}

/** A removed section put back where it was (or at the end, if the list has shrunk since). PURE. */
export function restoreSection(doc, removed) {
  const list = sectionsOf(doc);
  if (!removed || !idOf(removed.section) || list.some((s) => idOf(s) === removed.section.id)) return list;
  list.splice(Math.min(Math.max(1, removed.index | 0), list.length), 0, removed.section);
  return list;
}

/**
 * Where section `id` may move: { up, down } booleans. PURE. Moves are among the DRAWN sections (an entry that is not a
 * section is passed over), and nothing moves above You.
 */
export function canMove(doc, id) {
  const shown = viewSections(doc).map((s) => s.id);
  const at = shown.indexOf(id);
  if (at <= 0) return { up: false, down: false };
  return { up: at > 1, down: at < shown.length - 1 };
}

/** The list with section `id` swapped with the drawn section above (dir -1) or below (+1) it. PURE. */
export function moveSection(doc, id, dir) {
  const list = sectionsOf(doc);
  const shown = viewSections(doc).map((s) => s.id);
  const at = shown.indexOf(id);
  const to = at + (dir < 0 ? -1 : 1);
  if (at <= 0 || to <= 0 || to >= shown.length) return list;
  const i = list.findIndex((s) => idOf(s) === id);
  const j = list.findIndex((s) => idOf(s) === shown[to]);
  if (i < 0 || j < 0) {
    // You was not in the stored list (it is drawn first anyway): nothing to swap with in storage.
    return list;
  }
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/** The list with `patch` merged into section `id`'s options (`settings` merged one level deeper). PURE. */
export function updateSection(doc, id, patch = {}) {
  return sectionsOf(doc).map((s) => {
    if (idOf(s) !== id) return s;
    const options = isObj(s.options) ? s.options : {};
    const next = { ...options, ...patch };
    if (isObj(patch.settings)) next.settings = { ...(isObj(options.settings) ? options.settings : {}), ...patch.settings };
    return { ...s, options: next };
  });
}

/** The YouTube video a video section plays: { provider, kind: 'video', id } or null. PURE. */
export function videoOf(options) {
  const r = parseLink(options?.link);
  return r && r.provider === 'youtube' && r.kind === 'video' ? r : null;
}

/** About me's text, as stored, trimmed to the limit. PURE. (Drawn escaped, never as HTML.) */
export const aboutText = (options) => String(options?.text ?? '').slice(0, ABOUT_MAX);

// ---- two devices --------------------------------------------------------------------------------------------------
/** The order of the merged set, from the three sides' orders (see the header). PURE. */
function mergeOrder(bo, mo, to, ids, lost) {
  const S = new Set(ids);
  const common = bo.filter((id) => S.has(id) && mo.includes(id) && to.includes(id));
  const rel = (L) => L.filter((id) => common.includes(id));
  const [rb, rm, rt] = [rel(bo), rel(mo), rel(to)];
  let primary, other;
  if (J(rm) === J(rb)) { primary = to; other = mo; }                         // only they reordered (or nobody)
  else if (J(rt) === J(rb) || J(rm) === J(rt)) { primary = mo; other = to; } // only we did, or both the same way
  else { lost.push(['sections', 'order']); primary = to; other = mo; }       // both, differently: theirs stands
  const out = primary.filter((id) => S.has(id));
  // A section only the other side has (added there) goes in after the one before it on that side.
  other.forEach((id, i) => {
    if (!S.has(id) || out.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(other[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, id);
  });
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * The page doc merged after the server refused a write as stale (state.js `merge`). PURE.
 * `base`: the doc as the server last confirmed it; `mine`: this device's copy; `theirs`: the server's truth.
 * -> { data, lost } (doc_merge.js's shape; `lost` names what of this device's change gave way).
 * A side that never saved a page counts as the default list, so two devices each making their first edit merge
 * against the page they both started from. A list whose entries do not all carry a distinct id (not one this file
 * ever writes) is one value, merged as doc_merge.js merges any value.
 */
export function mergePageDoc(base, mine, theirs) {
  const b = isObj(base) ? base : {}, m = isObj(mine) ? mine : {}, t = isObj(theirs) ? theirs : {};
  if (!hasOwnPage(m) && !hasOwnPage(t)) {
    const r = merge3(b, m, t);
    return { data: isObj(r.value) ? r.value : {}, lost: r.lost };
  }
  const sides = [b, m, t].map(sectionsOf);
  const keyed = sides.every((L) => { const ids = L.map(idOf); return ids.every(Boolean) && new Set(ids).size === ids.length; });
  if (!keyed) {
    const r = merge3({ ...b, sections: sides[0] }, { ...m, sections: sides[1] }, { ...t, sections: sides[2] });
    return { data: isObj(r.value) ? r.value : {}, lost: r.lost };
  }
  const asSet = (L) => Object.fromEntries(L.map((s) => [s.id, s]));
  const rest = (d) => { const { sections, ...r } = d; return r; };
  const r = merge3({ ...rest(b), sections: asSet(sides[0]) }, { ...rest(m), sections: asSet(sides[1]) },
    { ...rest(t), sections: asSet(sides[2]) });
  const value = isObj(r.value) ? r.value : {};
  const set = isObj(value.sections) ? value.sections : {};
  const lost = r.lost.slice();
  const order = mergeOrder(sides[0].map(idOf), sides[1].map(idOf), sides[2].map(idOf), Object.keys(set), lost);
  return { data: { ...value, sections: order.map((id) => set[id]) }, lost };
}
