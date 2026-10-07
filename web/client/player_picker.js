// player_picker.js — WHO IS PLAYING: ONE WAY TO PICK THE PLAYERS, FOR EVERY GAME THAT HAS THEM.
//
// Mike, 2026-10-06 (DECISIONS.md "One way to pick players"): *"Picking the players will need to be a universal
// thing. Multiple modules will use it. ... Be able to select the number of players and then sort/filter by things
// like account/friends account/guest. So you can use someone's actual account for everything. That will be
// important for having the right user settings and difficulty levels. Players should be its own tab in settings."*
//
// WHAT IT REPLACES. The Cici dashboard (private repo, Cici/dashboard_web/modules) grew a chooser per module: the word
// game's "Player" buttons (a fixed three names plus "Add a player", kept in that browser's localStorage), the press
// game's own roster (the same idea, its own key), and the vision probe's "Who (subject)" text box. This site then
// grew one more: every question game's free-text "Players, in turn order" row (adaptive_play.js). All of them are a
// list of NAMES, so nobody picked in them was anybody: no level of their own, no settings of their own. This is the
// one picker that replaces the site's row; the Cici dashboard's three stay as they are (it runs on the live screen)
// and are a later port. (The site's moderator / participant "who may act" gate, sender.js, is a different thing:
// it says whose PRESSES count, not who is playing, and is not touched.)
//
// THE SEATS. A list of players in turn order, each one of:
//   { kind: 'self' }                      the person this screen is for, whoever that is (never a stored id, so a
//                                         screen handed to somebody else needs no change here)
//   { kind: 'person', id, name }          a person on this login: one of its own, or one held through a
//                                         connection (a friend's own profile). `name` is what this login called
//                                         them when they were picked, for a host with no people list to hand.
//   { kind: 'guest', name }               a name and nothing else: nobody's account (what "Players" always was)
// A picked person plays AS THEMSELVES: adaptive_play.js keys them `person:<id>`, so their level, their own starts and
// their usual start are read from and written to their own rows. A guest keeps the old `name:<x>` key, so a guest
// typed in before this existed keeps their level.
//
// *** A CONNECTED PERSON'S LEVEL IS KEPT ON THIS LOGIN'S COPY OF THEM (the safe default, argued). ***
// Somebody held through a connection has a row on this login (claims.py: every login that holds a profile keeps
// its own row) and their real one at their home. Their game level could live in either:
//   FOR THE HOME (read and written there): "So you can use someone's actual account for everything" - Oscar's level
//     at Mike's screen would be the one he has on his own login, and his playing here would move it there too.
//   AGAINST, and it decides the default: it is a WRITE into another login's records by a screen that login does not
//     run. claims.state_target is a security invariant - only the account holding a row reaches anything through it,
//     and only the home writes the profile - and nothing in it lets a holder write anything at the home today. Game
//     levels are not the profile (that is the picture and the page), but they are the other login's own data, and
//     a friend's screen quietly changing your child's level is the surprise the people rules exist to prevent.
//     A read-only version leaks the same data the other way (your level, read by every login that holds you).
// So a connected person's level here is this login's own (person state on this login's row for them, which the
// server already allows and already scopes): right settings and difficulty on THIS login, starting from "very easy"
// or their start here, and never touching their own. Reading or writing the home's levels is a later opt-in the
// HOME grants (a connection permission, "their levels follow them here"), on Mike's list - not a default.
//
// TWO HALVES, as sort_filter.js: THE RULES (pure: the seats, their words, the people as the picker lists them) and
// THE PICKER (mountPlayerPicker: the list, driven by the settings menu's four moves like choice_picker.js, and
// openPlayersDialog for a host that draws its rows itself).

import { sortFilter, searchBoxHTML, selectHTML, chipsHTML, ensureSortFilterCss, byText } from './sort_filter.js';

// *** HARD-CODED, EACH ARGUED (Rule 1); every one is also an option on the picker. ***
//   MAX_SEATS 4      adaptive_play.js MAX_PLAYERS' reason: a longer turn order is a long wait between one person's
//                    turns, and four is as many distinct player colours as the theme has. A game may ask for fewer
//                    (`max`), never more.
//   GUEST_NAME_MAX 40  a name, not a paragraph; long enough for "Grandma Rosalind from next door".
//   GUEST_WORD 'Guest' what "A guest (no name)" is called, numbered after the first ("Guest 2"), so somebody with
//                    only a switch can add a guest without typing.
export const MAX_SEATS = 4;
export const GUEST_NAME_MAX = 40;
export const GUEST_WORD = 'Guest';
// The screen's players, on the screen's own settings row (the ⚙ menu's Players tab writes it).
export const SCREEN_PLAYERS_KEY = 'screenPlayers';
export const SEAT_KINDS = Object.freeze(['self', 'person', 'guest']);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, GUEST_NAME_MAX);
const guestKey = (name) => clip(name).toLowerCase();

// ---------------------------------------------------------------------------------------------------
// THE RULES (pure)
// ---------------------------------------------------------------------------------------------------

/** One seat, cleaned, or null. A person whose id is `selfId` IS the screen's person: a self seat. */
export function normalizeSeat(raw, { selfId = null } = {}) {
  if (typeof raw === 'string') { const n = clip(raw); return n ? { kind: 'guest', name: n } : null; }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'self') return { kind: 'self' };
  if (raw.kind === 'person') {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) return null;
    if (selfId && id === selfId) return { kind: 'self' };
    return { kind: 'person', id, name: clip(raw.name) };
  }
  if (raw.kind === 'guest') { const n = clip(raw.name); return n ? { kind: 'guest', name: n } : null; }
  return null;
}

/**
 * The seats a stored value holds, in turn order, each once, at most `max`. A STRING is the old free-text "Players"
 * row ("Ann, Bob": names split on commas, semicolons and new lines), read as guests - the migration, done when it is
 * read, so nothing stored is rewritten until somebody picks again.
 */
export function normalizeSeats(raw, { selfId = null, max = MAX_SEATS } = {}) {
  const list = typeof raw === 'string' ? raw.split(/[,\n;]+/) : (Array.isArray(raw) ? raw : []);
  const cap = Math.max(1, Math.min(MAX_SEATS, Math.floor(Number(max)) || MAX_SEATS));
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const s = normalizeSeat(r, { selfId });
    if (!s) continue;
    const k = seatKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** What makes two seats the same player. */
export function seatKey(s) {
  if (!s) return '';
  if (s.kind === 'self') return 'self';
  if (s.kind === 'person') return `person:${s.id}`;
  return `guest:${guestKey(s.name)}`;
}

/**
 * A GAME'S value that hands the choice to the screen ("This screen's players"): absent, empty, or an empty list.
 * Anything else is the game's own pick (a list of seats, or an old typed list of names).
 */
export function followsScreen(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return !normalizeSeats(value).length;
  return true;
}

/** Just the screen's person, and nobody else? */
export const isJustSelf = (seats) => Array.isArray(seats) && seats.length === 1 && seats[0]?.kind === 'self';

/** A seat's name, in words. `selfName`: the screen's person's name, when the host knows it. */
export function seatName(s, { selfName = '', people = null } = {}) {
  if (!s) return '';
  if (s.kind === 'self') return selfName || 'The person this screen is for';
  if (s.kind === 'person') {
    const row = Array.isArray(people) ? people.find((p) => p && p.id === s.id) : null;
    return (row && row.name) || s.name || 'Someone on this login';
  }
  return `${s.name} (guest)`;
}

/** "Robin, Sam (guest)" - the seats in words, in turn order. */
export function seatsLabel(seats, opts = {}) {
  const list = normalizeSeats(seats);
  return list.length ? list.map((s) => seatName(s, opts)).join(', ') : seatName({ kind: 'self' }, opts);
}

// The words for a game's three ways (the "Use" row, and the settings row's value).
export const FOLLOW_WORDS = Object.freeze({
  screen: 'This screen’s players',
  self: 'Just the person this screen is for',
  game: 'Picked for this game',
});

/** The settings row's words for a value. `follow`: a game's row, which can hand the choice to the screen. */
export function playersValueLabel(value, { follow = true, selfName = '', people = null } = {}) {
  if (follow && followsScreen(value)) return FOLLOW_WORDS.screen;
  const seats = normalizeSeats(value);
  if (!seats.length || isJustSelf(seats)) return selfName ? `Just ${selfName}` : FOLLOW_WORDS.self;
  return seatsLabel(seats, { selfName, people });
}

/**
 * WHERE A PERSON COMES FROM, for the "Show" filter: 'login' (this login's own people - you, the people it looks
 * after, and anybody who took one of them over with their own login, whose screens are still here) or 'connected'
 * (somebody this login is connected with, or whose profile another login shared). claims.row_kind's words.
 */
export function peopleKind(row) {
  const k = row && row.kind;
  return k === 'connected' || k === 'shared' ? 'connected' : 'login';
}

export const KIND_WORDS = Object.freeze({ all: 'Everyone', login: 'On this login', connected: 'Connected', guest: 'Guests' });

/** The "Show" filter (sort_filter.js's facet shape). */
export const PLAYER_FACETS = Object.freeze([{
  id: 'kind', label: 'Show', any: 'all',
  options: ['all', 'login', 'connected', 'guest'].map((id) => ({ id, label: KIND_WORDS[id] })),
  test: (it, v) => it.kind === v,
}]);

// THE ORDER: as the login lists its people (you first, then the people it looks after, then connections; the order
// the People page shows), or by name. "As on your people page" first: it is the order a caregiver already knows.
export const PLAYER_SORTS = Object.freeze([
  { id: 'listed', label: 'As on your people page', compare: (a, b) => a.order - b.order },
  { id: 'name', label: 'Name, A to Z', compare: byText((x) => x.name) },
]);

/** The next "Guest", "Guest 2"... not already sitting. */
export function nextGuestName(seats = [], word = GUEST_WORD) {
  const taken = new Set(normalizeSeats(seats).filter((s) => s.kind === 'guest').map((s) => guestKey(s.name)));
  if (!taken.has(guestKey(word))) return word;
  for (let n = 2; n < 100; n += 1) if (!taken.has(guestKey(`${word} ${n}`))) return `${word} ${n}`;
  return `${word} ${Date.now() % 1000}`;
}

/**
 * The things the picker lists: every person (with where they come from) and every guest name it knows of,
 * plus "A guest (no name)". `people`: rows as /api/people sends them. `selfId`: the screen's person.
 */
export function pickerItems({ people = [], guests = [], seats = [], selfId = null } = {}) {
  const out = [];
  (Array.isArray(people) ? people : []).forEach((p, i) => {
    if (!p || !p.id) return;
    const self = !!selfId && p.id === selfId;
    out.push({ type: 'person', id: p.id, name: String(p.name || p.profile_name || ''), kind: peopleKind(p), order: i,
      self, hint: self ? 'this screen is theirs' : (peopleKind(p) === 'connected' ? (p.from ? `connected, through ${p.from}` : 'connected') : '') });
  });
  const names = new Map();
  for (const g of [...normalizeSeats(seats).filter((s) => s.kind === 'guest').map((s) => s.name), ...(Array.isArray(guests) ? guests : [])]) {
    const n = clip(g);
    if (n && !names.has(guestKey(n))) names.set(guestKey(n), n);
  }
  let i = out.length;
  for (const n of names.values()) out.push({ type: 'guest', id: `guest:${guestKey(n)}`, name: n, kind: 'guest', order: (i += 1), hint: 'a guest' });
  out.push({ type: 'newguest', id: 'newguest', name: 'A guest (no name)', kind: 'guest', order: 1e6, hint: 'numbered: Guest, Guest 2…' });
  return out;
}

/** The seat a listed thing becomes. */
export function seatFromItem(it, { selfId = null, seats = [] } = {}) {
  if (!it) return null;
  if (it.type === 'person') return normalizeSeat({ kind: 'person', id: it.id, name: it.name }, { selfId });
  if (it.type === 'guest') return { kind: 'guest', name: it.name };
  if (it.type === 'newguest') return { kind: 'guest', name: nextGuestName(seats) };
  return null;
}

/**
 * Put `seat` at `at` (a seat number from 0). Somebody already sitting elsewhere MOVES there, and whoever was at `at`
 * takes their old place (a swap), so nobody is ever in two seats. Pure: a new array.
 */
export function placeSeat(seats, at, seat) {
  const list = Array.isArray(seats) ? [...seats] : [];
  if (!seat || at < 0) return list;
  const k = seatKey(seat);
  const was = list.findIndex((s) => s && seatKey(s) === k);
  const there = list[at] || null;
  if (was >= 0 && was !== at) list[was] = there;
  list[at] = seat;
  return list;
}

// ---------------------------------------------------------------------------------------------------
// THE PICKER
// ---------------------------------------------------------------------------------------------------
//
// WHAT IS ON IT, top to bottom, each row a stop on a switch scan (choice_picker.js's scan: `next`/`prev` light a
// row, `select` goes in, `select` takes one, `back` comes out; a row with one thing in it is taken by the `select`
// that would have entered it):
//   Done / Keep it as it was      Done is dimmed, with why, while no seat is filled.
//   Use (a game's own row only)   This screen's players / Just <them> / Picked for this game. The first two are
//                                 chosen at once; the third shows the seats.
//   How many players              1 to the game's most.
//   The seats                     "1: Robin". A seat pressed is the one the next pick fills.
//   Show                          Everyone / On this login / Connected / Guests (sort_filter.js chips).
//   The people and guests         a pick fills the seat being filled, then moves on to the next empty one.
// For a keyboard and a pointer, and not stops: the search box, the order, and a box to type a guest's name.
// WHAT IT HANDS BACK: '' for "This screen's players" (a game's row only), else the seats. It writes nothing.

export const PLAYER_PICKER_DEFAULTS = Object.freeze({ columns: 3 });

const PICKER_CSS_ID = 'player-picker-css';
const PICKER_CSS = `
.plp-seat{display:flex;flex-direction:column;align-items:flex-start;text-align:left}
.plp-seat[data-active="1"]{border-color:var(--focus,var(--accent,Highlight));border-width:3px}
.plp-seat .chp-hint{font-weight:400}
.plp-guest{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.plp-guest input{flex:1 1 9em;min-width:7em;min-height:40px;padding:6px 10px;border:2px solid var(--border,ButtonBorder);border-radius:10px;
  background:var(--surface,Field);color:var(--text,FieldText);font:inherit}
.plp-why{font-size:.85em;color:var(--text-muted,GrayText)}
`;
function ensurePickerCss(doc) {
  ensureSortFilterCss(doc);
  if (!doc || doc.getElementById(PICKER_CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = PICKER_CSS_ID;
  st.textContent = PICKER_CSS;
  (doc.head || doc.documentElement).append(st);
}

/**
 * Mount the picker into `root`. Returns `{ next, prev, select, back, destroy, refresh, __probe }`.
 *   value        '' (follow the screen) or seats (a list, or an old typed string)
 *   follow       true for a game's own row: "Use: This screen's players / Just them / Picked for this game"
 *   max          most players (1..MAX_SEATS)
 *   self         { id, name } the screen's person, when known
 *   people       a list, or a function returning one (or a promise of one): rows as /api/people sends them
 *   screenSeats  the screen's own players (what "Picked for this game" starts from)
 *   guests       guest names to offer (names already typed on this screen)
 *   onPick(v)    Done, or one of the "Use" choices: '' or seats
 *   onCancel()   Keep it as it was
 */
export function mountPlayerPicker(root, {
  value = '',
  follow = true,
  max = MAX_SEATS,
  title = 'Who is playing',
  self = null,
  people = null,
  screenSeats = [],
  guests = [],
  onPick = () => {},
  onCancel = () => {},
  cancel = true,
  keys = false,
  columns = PLAYER_PICKER_DEFAULTS.columns,
} = {}) {
  if (!root) throw new Error('mountPlayerPicker: a root element is required');
  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  ensurePickerCss(doc);
  const cap = Math.max(1, Math.min(MAX_SEATS, Math.floor(Number(max)) || MAX_SEATS));
  const cols = Math.max(1, Math.floor(Number(columns)) || PLAYER_PICKER_DEFAULTS.columns);
  const selfId = self && self.id ? String(self.id) : null;
  const selfName = self && self.name ? String(self.name) : '';
  const startFollow = follow && followsScreen(value);
  const fromValue = normalizeSeats(value, { selfId, max: cap });
  const fromScreen = normalizeSeats(screenSeats, { selfId, max: cap });
  // The seats being edited (null: an empty seat). A game following the screen starts from the screen's players.
  let seats = (fromValue.length ? fromValue : (fromScreen.length ? fromScreen : [{ kind: 'self' }])).slice(0, cap);
  let mode = startFollow ? 'screen' : (isJustSelf(fromValue) && follow ? 'self' : 'game');
  // The seat the next pick fills: the first one, until somebody asks for more seats or presses another.
  let active = 0;
  let list = [];                       // the people, once loaded
  let loadState = 'none';              // none | loading | ready | failed
  let loadWhy = '';
  let query = '';
  let sortId = PLAYER_SORTS[0].id;
  const picked = { kind: 'all' };
  let lit = { g: -1, i: -1 };
  let dead = false;

  function filled() { return seats.filter(Boolean); }
  const nameOf = (s) => seatName(s, { selfName, people: list });
  function firstEmpty() { for (let i = 0; i < seats.length; i += 1) if (!seats[i]) return i; return -1; }

  function items() {
    return pickerItems({ people: list, guests, seats: filled(), selfId });
  }
  function shown() {
    return sortFilter(items(), { query, text: (it) => `${it.name} ${it.hint || ''}`, facets: PLAYER_FACETS, picked,
      sort: sortId, sorts: PLAYER_SORTS });
  }
  const sitting = (it) => {
    const s = seatFromItem(it, { selfId, seats: filled() });
    if (!s || it.type === 'newguest') return -1;
    return seats.findIndex((x) => x && seatKey(x) === seatKey(s));
  };

  // ------------------------------------------------------------------ drawing
  function actsHTML() {
    const n = filled().length;
    const why = n ? '' : 'nobody is in a seat yet';
    return `<div class="chp-row chp-acts" data-plp-group="actions">
      <button type="button" class="chp-btn" data-plp-stop data-plp-act="done"${n ? '' : ' disabled'}>Done</button>
      ${cancel ? '<button type="button" class="chp-btn" data-plp-stop data-plp-act="cancel">Keep it as it was</button>' : ''}
      ${why ? `<span class="plp-why" data-plp-why>${esc(why)}</span>` : ''}</div>`;
  }
  function modeHTML() {
    if (!follow) return '';
    const opts = [
      { id: 'screen', label: FOLLOW_WORDS.screen },
      { id: 'self', label: selfName ? `Just ${selfName}` : FOLLOW_WORDS.self },
      { id: 'game', label: FOLLOW_WORDS.game },
    ];
    return `<p class="chp-note">Use</p><div class="chp-row sf-row" data-plp-group="mode" role="toolbar" aria-label="Use">${
      chipsHTML({ options: opts, value: mode, attrOf: (o) => `data-plp-stop data-plp-mode="${esc(o.id)}"` })}</div>`;
  }
  function countHTML() {
    const opts = Array.from({ length: cap }, (_, i) => ({ id: String(i + 1), label: i === 0 ? '1 player' : `${i + 1} players` }));
    return `<p class="chp-note">How many players${cap < MAX_SEATS ? ` (this game takes up to ${cap})` : ''}</p>
      <div class="chp-row sf-row" data-plp-group="count" role="toolbar" aria-label="How many players">${
      chipsHTML({ options: opts, value: String(seats.length), attrOf: (o) => `data-plp-stop data-plp-count="${esc(o.id)}"` })}</div>`;
  }
  function seatsHTML() {
    return `<p class="chp-note">Turn order. Press a seat to fill it; the next pick goes there.</p>
      <div class="chp-row chp-tiles" data-plp-group="seats" style="--chp-cols:${Math.min(cap, 4)}">${seats.map((s, i) => `
        <button type="button" class="chp-tile plp-seat" data-plp-stop data-plp-seat="${i}"${i === active ? ' data-active="1"' : ''}
          ><span class="chp-hint">Seat ${i + 1}${i === active ? ' · filling' : ''}</span>
          <span class="chp-name">${esc(s ? nameOf(s) : 'Empty')}</span></button>`).join('')}</div>`;
  }
  function toolsHTML() {
    const kind = PLAYER_FACETS[0];
    return `<div class="sf-tools">${searchBoxHTML({ attr: 'data-plp-search', label: 'Search the people', placeholder: 'Search',
      value: query, extra: 'autocomplete="off" spellcheck="false"' })}${
      selectHTML({ attr: 'data-plp-sort', label: 'Order', options: PLAYER_SORTS, value: sortId })}</div>
      <div class="chp-row sf-row" data-plp-group="filters" role="toolbar" aria-label="${esc(kind.label)}">${chipsHTML({ options: kind.options,
        value: picked.kind, attrOf: (o) => `data-plp-stop data-plp-filter="kind" data-plp-val="${esc(o.id)}"` })}</div>`;
  }
  function loadNote() {
    // DIMMED WITH WHY: say what is missing and what still works, never an empty list with no reason.
    if (loadState === 'loading') return '<p class="chp-note" data-plp-load>Loading the people on this login…</p>';
    if (loadState === 'failed') return `<p class="chp-note" data-plp-load>The people on this login could not be loaded${loadWhy ? ` (${esc(loadWhy)})` : ''}. Guests still work.</p>`;
    if (loadState === 'none') return '<p class="chp-note" data-plp-load>People on this login show here on a screen that is signed in. Guests work anywhere.</p>';
    return '';
  }
  function resultsHTML() {
    const all = shown();
    if (!all.length) return `<p class="chp-note" data-plp-none>${query ? `Nobody here matches “${esc(query)}”.` : 'Nobody here yet.'}</p>`;
    const rows = [];
    for (let i = 0; i < all.length; i += cols) rows.push(all.slice(i, i + cols));
    return rows.map((r) => `<div class="chp-row chp-tiles" data-plp-group="people" style="--chp-cols:${cols}">${r.map((it) => {
      const at = sitting(it);
      const hint = [at >= 0 ? `seat ${at + 1}` : '', it.hint].filter(Boolean).join(' · ');
      return `<button type="button" class="chp-tile chp-plain" data-plp-stop data-plp-pick="${esc(it.id)}" aria-pressed="${at >= 0 ? 'true' : 'false'}"
        title="${esc(it.name)}"><span class="chp-name">${esc(it.name)}</span>${hint ? `<span class="chp-hint">${esc(hint)}</span>` : ''}</button>`;
    }).join('')}</div>`).join('');
  }
  function guestBoxHTML() {
    return `<form class="plp-guest" data-plp-guestform><input type="text" data-plp-guestname maxlength="${GUEST_NAME_MAX}"
      placeholder="Type a guest’s name" aria-label="A guest’s name" autocomplete="off" spellcheck="false">
      <button type="submit" class="sf-btn">Add guest</button></form>`;
  }
  function render() {
    if (dead) return;
    const box = root.querySelector('[data-plp-search],[data-plp-guestname]');
    const focused = box && doc && doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement : null;
    const which = focused?.matches?.('[data-plp-search]') ? 'search' : focused?.matches?.('[data-plp-guestname]') ? 'guest' : null;
    const draft = root.querySelector('[data-plp-guestname]')?.value || '';
    const picking = !follow || mode === 'game';
    root.innerHTML = `<div class="chp plp" data-player-picker>
      ${title ? `<p class="chp-head">${esc(title)}</p>` : ''}
      ${actsHTML()}
      ${modeHTML()}
      ${picking ? `${countHTML()}${seatsHTML()}${toolsHTML()}${loadNote()}
        <div class="chp-grid" data-plp-results>${resultsHTML()}</div>${guestBoxHTML()}` : ''}
    </div>`;
    const g = root.querySelector('[data-plp-guestname]');
    if (g) g.value = draft;
    if (which) {
      const el = root.querySelector(which === 'search' ? '[data-plp-search]' : '[data-plp-guestname]');
      try { el?.focus?.(); } catch { /* not focusable */ }
    }
    paintLit();
  }

  // ------------------------------------------------------------------ actions
  function finish(v) { try { onPick(v); } catch (err) { console.error('player picker: onPick', err); } }
  function done() {
    if (!filled().length) return;
    finish(normalizeSeats(filled(), { selfId, max: cap }));
  }
  function setCount(n) {
    const want = Math.max(1, Math.min(cap, Math.floor(Number(n)) || 1));
    if (want > seats.length) seats = [...seats, ...Array(want - seats.length).fill(null)];
    else seats = seats.slice(0, want);
    const e = firstEmpty();
    active = e >= 0 ? e : Math.min(active, seats.length - 1);
    render();
  }
  function pickItem(id) {
    const it = items().find((x) => x.id === id);
    const seat = seatFromItem(it, { selfId, seats: filled() });
    if (!seat) return;
    if (active < 0 || active >= seats.length) active = 0;
    seats = placeSeat(seats, active, seat);
    const e = firstEmpty();
    if (e >= 0) active = e;
    render();
  }
  function addGuest(name) {
    const n = clip(name);
    if (!n) return;
    if (active < 0 || active >= seats.length) active = 0;
    seats = placeSeat(seats, active, { kind: 'guest', name: n });
    const e = firstEmpty();
    if (e >= 0) active = e;
    const box = root.querySelector('[data-plp-guestname]');
    if (box) box.value = '';
    render();
  }
  function setMode(m) {
    if (m === 'screen') { finish(''); return; }
    if (m === 'self') { finish([{ kind: 'self' }]); return; }
    mode = 'game';
    render();
  }
  function doCancel() { try { onCancel(); } catch (err) { console.error('player picker: onCancel', err); } }
  function activate(el) {
    if (!el || dead || el.disabled) return;
    if (el.dataset.plpAct === 'done') { done(); return; }
    if (el.dataset.plpAct === 'cancel') { doCancel(); return; }
    if (el.dataset.plpMode) { setMode(el.dataset.plpMode); return; }
    if (el.dataset.plpCount) { setCount(el.dataset.plpCount); return; }
    if (el.dataset.plpSeat !== undefined) { active = Number(el.dataset.plpSeat) || 0; render(); return; }
    if (el.dataset.plpFilter) { picked[el.dataset.plpFilter] = el.dataset.plpVal; render(); return; }
    if (el.dataset.plpPick) pickItem(el.dataset.plpPick);
  }

  // ------------------------------------------------------------------ the scan (choice_picker.js's)
  const stopsIn = (g) => [...g.querySelectorAll('[data-plp-stop]')].filter((b) => !b.disabled);
  const groups = () => [...root.querySelectorAll('[data-plp-group]')].filter((g) => stopsIn(g).length);
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
  // After a press inside a row, the light stays in that row where it can (the group is found again by name, since
  // the picker redraws); a row that went away puts it back on the rows.
  function relight(groupName, idx) {
    const gs = groups();
    const g = gs.findIndex((x) => x.dataset.plpGroup === groupName);
    lit = g >= 0 ? { g, i: Math.min(idx, stopsIn(gs[g]).length - 1) } : { g: Math.min(lit.g, gs.length - 1), i: -1 };
    paintLit();
  }
  function select() {
    const gs = groups();
    if (!gs.length) return;
    if (lit.g < 0) { lit = { g: 0, i: -1 }; paintLit(); return; }
    const st = stopsIn(gs[lit.g]);
    if (lit.i < 0) {
      if (st.length === 1) { activate(st[0]); return; }
      lit.i = 0; paintLit(); return;
    }
    const name = gs[lit.g].dataset.plpGroup;
    const idx = lit.i;
    activate(st[lit.i]);
    if (!dead) relight(name, idx);
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
    const el = t?.closest('[data-plp-stop]');
    if (!el || !root.contains(el) || el.disabled) return;
    activate(el);
  });
  on('submit', (e) => {
    if (!e.target?.matches?.('[data-plp-guestform]')) return;
    e.preventDefault();
    addGuest(root.querySelector('[data-plp-guestname]')?.value || '');
  });
  on('input', (e) => {
    if (!e.target?.matches?.('[data-plp-search]')) return;
    query = e.target.value || '';
    const el = root.querySelector('[data-plp-results]');
    if (el) { el.innerHTML = resultsHTML(); paintLit(); }
  });
  on('change', (e) => {
    if (e.target?.matches?.('[data-plp-sort]')) { sortId = e.target.value; render(); }
  });
  on('keydown', (e) => {
    const typing = e.target?.matches?.('input,textarea,select');
    // Escape is LEAVE, stopped here so the settings menu around it does not also close (choice_picker.js's rule).
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

  function load() {
    let got;
    try { got = typeof people === 'function' ? people() : people; } catch (err) { got = Promise.reject(err); }
    if (got == null) { loadState = 'none'; return; }
    if (Array.isArray(got)) { list = got.filter((p) => p && p.id); loadState = 'ready'; return; }
    loadState = 'loading';
    Promise.resolve(got).then((rows) => {
      if (dead) return;
      list = (Array.isArray(rows) ? rows : []).filter((p) => p && p.id);
      loadState = 'ready';
      render();
    }).catch((err) => {
      if (dead) return;
      loadState = 'failed';
      loadWhy = String((err && err.message) || err || '').slice(0, 80);
      render();
    });
  }
  load();
  render();

  return {
    next: () => move(1),
    prev: () => move(-1),
    select,
    back,
    refresh: () => render(),
    destroy() {
      if (dead) return;
      dead = true;
      gone.abort();
      root.innerHTML = '';
    },
    __probe: () => {
      const gs = groups();
      const g = lit.g >= 0 ? gs[lit.g] : null;
      const st = g ? stopsIn(g) : [];
      const litEl = g ? (lit.i >= 0 ? st[lit.i] : g) : null;
      return {
        mode, active, loadState,
        seats: seats.map((s) => (s ? { ...s } : null)),
        shown: shown().map((it) => it.id),
        rows: gs.map((x) => x.dataset.plpGroup),
        lit: { ...lit },
        litGroup: g ? g.dataset.plpGroup : null,
        litText: litEl ? litEl.textContent.trim().replace(/\s+/g, ' ') : null,
        filter: picked.kind, sort: sortId, query,
      };
    },
  };
}

/** The picker over the page, for a host that draws its rows itself. Closes itself on a choice or a cancel. */
export function openPlayersDialog(opts = {}) {
  if (typeof document === 'undefined') return null;
  const wrap = document.createElement('div');
  wrap.className = 'chp-dialog';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', opts.title || 'Who is playing');
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
  api = mountPlayerPicker(box, {
    ...opts, keys: true, cancel: true,
    onPick: (v) => { close(); opts.onPick?.(v); },
    onCancel: () => { close(); opts.onCancel?.(); },
  });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) { close(); opts.onCancel?.(); } });
  box.focus?.();
  return { ...api, close, element: wrap };
}
