// play_as.js — "PLAY <GAME> AS <PERSON>": WHO A GAME STARTED BY VOICE PLAYS AS (row 2.80).
//
// Mike, 2026-10-12 (DECISIONS "Play as by voice, and who plays when nobody is named"; notes BR item 2, BS item 5, BT
// item 1): *"Play <game> as <person>"*, *"play a <n> player game of <game> with <names>"*. When nobody is named the
// game plays as the profile the screen is on; a guest is a choice. The "with help" mark is PARKED, not built.
//
// input_speech.js HEARS it (`playAsFor`: which game, which names, from the vocabulary this file hands it) and publishes
// SPEECH_PLAY_AS_TOPIC. THIS FILE DECIDES: who that makes the players, whether the game can seat them, what is said
// back, and which panel starts. Three pieces:
//
//   1. THE VOCABULARY (`vocabulary()`): the games' own titles plus a few short names (GAME_SPOKEN), the named games of
//      the spoken routes ("name that animal", "odd one out"), the people this screen knows (as the person this screen
//      is for calls them, first names too where nobody else shares one), "a guest", and any spoken names somebody set
//      ("Other names it listens for", below).
//   2. THE PLAYERS, FOR THE ONE PANEL THAT WAS ASKED (`wrap`). A game reads its players through `ctx.screenPlayers`
//      (adaptive_play.js `resolvePlayers`); the kiosk hands each panel a wrapped copy whose `override()` is the seats a
//      voice start chose for THAT panel. It wins over the game's own "Players" row and the screen's, because somebody
//      just named who is playing. It ends when that panel's sitting comes to rest (game_start.js: the sitting ended, or
//      nobody pressed for GAME_IDLE_MS), when a newer voice start replaces it, or when the screen reloads. Nothing is
//      written: the game's own row and the Players tab are exactly as they were.
//   3. STARTING IT: the panel's own named game (a route's topic and payload, `<type>/play`), else its `play` verb
//      (the Start button's press), else nothing to press (a game that is always going, such as Trivia) - in every case
//      AFTER the players are set, so the first turn is already the right person's.
//
// *** RESULTS GO TO THE RIGHT PERSON BECAUSE THE SEATS ARE THE PICKER'S (player_picker.js). *** A person named plays AS
// THEMSELVES: `person:<id>` in adaptive_play.js, their own level and rows. The screen's profile is a `self` seat. A guest
// is a guest seat, exactly what "A guest (no name)" on the picker makes: nothing is kept for any person (its level is
// kept under the guest's name on the screen's row, as guest play already does).
//
// *** WHAT IS NOT DONE, ARGUED. ***
//   * A GAME NOT ON THE SCREEN IS NOT OPENED. Opening it means replacing a panel, and the only panel to replace is
//     whichever is picked - on a screen whose photos are the point of it. It says "<game> is not on this screen."
//     FOR opening it: one sentence would do everything. AGAINST, and it wins for the default: a spoken command that
//     can remove the photos is the wrong kind of surprise; "switch module" then a press is still there. [Mike's list.]
//   * POINTS ARE NOT MOVED. A game's "Right answers earn points for: The first player only" still pays the first seat's
//     right answers into this screen's points, whoever sits there (adaptive_play.js argues that row). [Mike's list.]
//
// *** EVERY DEFAULT, ARGUED (Rule 1). Each is a setting on the Players tab of the screen's menu (PLAY_AS_FIELDS). ***
//   nobody 'self'      Mike's ruling (BT item 1). 'guest' is his "guest is a choice". 'setting' (the game's own
//                      "Players" row, as before this existed) is added for the household that set two players there and
//                      wants "play trivia" to keep them; it is a third choice, never the default.
//   tooMany 'fit'      MORE PEOPLE NAMED THAN THE GAME CAN SEAT (the ladder games take 4; the brick games keep no
//                      players at all - their score is this screen's). FOR 'stop' (say so, start nothing): everybody
//                      named expected to play, and the game going without them puts the turns somewhere they did not
//                      ask. AGAINST, and it wins: the screen SAYS who is playing before it starts ("Trivia takes up to 4
//                      players. Starting with ..."), so nobody is surprised, and not starting means saying the whole
//                      sentence again in a shape the game takes. 'stop' is one choice away.
//   readBack on        Mike asked for it ("Read back what was understood before starting"). Off: the confirmation tone
//                      only, for a room where the screen talking is a cost.
//   spoken ''          no extra names until somebody adds one.
// The constants below the settings, argued where they stand: PEOPLE_REFRESH_MS, SAY_TTL_MS.

import { normalize, ROUTES, SPEECH_PLAY_AS_TOPIC, PLAY_GUEST_ID, PLAY_SELF_ID } from './input_speech.js';
import { MAX_SEATS, nextGuestName, seatKey } from './player_picker.js';
import { PLAY_STATE_TOPIC } from './game_start.js';
import { MODULE_VERBS, verbTarget } from './actions.js';
import { senderOf, senderMeta } from './sender.js';

export const PLAY_AS_NOBODY = Object.freeze(['self', 'guest', 'setting']);
export const PLAY_AS_TOO_MANY = Object.freeze(['fit', 'stop']);
export const PLAY_AS_DEFAULTS = Object.freeze({ nobody: 'self', tooMany: 'fit', readBack: true, spoken: '' });

// The people list is read again after this long (a person added or renamed is heard within minutes). ARGUED as a
// constant, not a setting: nobody in a room can judge it, and a list that changes a few times a year needs no faster.
export const PEOPLE_REFRESH_MS = 10 * 60 * 1000;
// A line said back more than this late describes a game already under way, so it expires rather than queueing behind
// the game's own first question on the output bus. Longer than the speech layer's confirmTtlMs (3 s): it is a sentence.
export const SAY_TTL_MS = 6000;

// *** SHORT NAMES, a phrase table like PHRASES (many phrasings, one game). *** A game's title is always one; these are
// the other things people call a game whose title is not what they would say. Small on purpose: a name here that two
// games could answer to is dropped from both (input_speech.js `playVocabulary`). Vocabulary [unverified on the bench].
export const GAME_SPOKEN = Object.freeze({
  rhythm: Object.freeze(['rhythm', 'the rhythm game']),
  stackline: Object.freeze(['stack the line']),
  sortbricks: Object.freeze(['sort bricks']),
  algebra: Object.freeze(['maths']),
  brickmosaic: Object.freeze(['mosaic']),
});

// What is said back. Lines, not numbers: kept here so a suite can read them and a host can pass its own (`lines`).
// Never "her screen" and never a name of anybody in particular.
export const PLAY_AS_LINES = Object.freeze({
  start: 'Starting {game} as {players}.',
  startPlain: 'Starting {game}.',
  notHere: '{game} is not on this screen.',
  unknownGame: 'I do not know a game called {heard}.',
  unknownPerson: 'I do not know who {names} is.',
  unknownPeople: 'I do not know who {names} are.',
  fewer: '{game} takes up to {max} players. Starting with {players}.',
  fewerStop: '{game} takes up to {max} players, so it was not started.',
  noSeats: '{game} keeps its score for this screen only. Starting it.',
  noSeatsStop: '{game} keeps its score for this screen only, so it was not started.',
  countOff: 'That is {named} names for a {count} player game, so it was not started.',
});

/** The settings rows, for the Players tab (the screen's own row: who plays on THIS screen). */
export const PLAY_AS_FIELDS = Object.freeze([
  Object.freeze({ key: 'playAsNobody', label: 'When a game is started by voice and nobody is named, it plays as',
    kind: 'choice', default: PLAY_AS_DEFAULTS.nobody, level: 'standard',
    options: [
      { value: 'self', label: 'This screen’s profile' },
      { value: 'guest', label: 'A guest (nothing is kept for anybody)' },
      { value: 'setting', label: 'Whoever the game’s own Players row says' },
    ],
    note: 'Say “play <game> as <name>” to name somebody. Say “play a two player game of <game> with <names>” for more.' }),
  Object.freeze({ key: 'playAsTooMany', label: 'When more people are named than the game can seat', kind: 'choice',
    default: PLAY_AS_DEFAULTS.tooMany, level: 'advanced',
    options: [
      { value: 'fit', label: 'Start it with the first names that fit, and say so' },
      { value: 'stop', label: 'Say so, and do not start it' },
    ] }),
  Object.freeze({ key: 'playAsReadBack', label: 'Say who is playing when a game starts by voice', kind: 'toggle',
    default: PLAY_AS_DEFAULTS.readBack, level: 'advanced', onLabel: 'Yes', offLabel: 'No, just the tone' }),
  Object.freeze({ key: 'playAsSpoken', label: 'Other names it listens for', kind: 'text', default: PLAY_AS_DEFAULTS.spoken,
    level: 'advanced',
    note: 'For a name the speech program cannot write down. A name, an equals sign, then what is said, separated by '
      + 'semicolons. For example: Siobhan = shiv; Brick Drop = bricks. Works for people and games.' }),
]);

/** `{ nobody, tooMany, readBack, spoken }` from a settings row; anything unset or broken is its default. Pure. */
export function playAsOptionsFrom(values = {}) {
  const v = values || {};
  return {
    nobody: PLAY_AS_NOBODY.includes(v.playAsNobody) ? v.playAsNobody : PLAY_AS_DEFAULTS.nobody,
    tooMany: PLAY_AS_TOO_MANY.includes(v.playAsTooMany) ? v.playAsTooMany : PLAY_AS_DEFAULTS.tooMany,
    readBack: typeof v.playAsReadBack === 'boolean' ? v.playAsReadBack : PLAY_AS_DEFAULTS.readBack,
    spoken: typeof v.playAsSpoken === 'string' ? v.playAsSpoken : PLAY_AS_DEFAULTS.spoken,
  };
}

/** "Siobhan = shiv; Brick Drop = bricks" -> [{ name: 'siobhan', said: 'shiv' }, ...]. Lines without "=" are ignored. */
export function spokenNamesFrom(text) {
  const out = [];
  for (const part of String(text == null ? '' : text).split(/[;\n]+/)) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = normalize(part.slice(0, at));
    const said = normalize(part.slice(at + 1));
    if (name && said) out.push({ name, said });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// WHICH MODULES ARE GAMES, AND HOW MANY THEY SEAT. Read off each manifest, a declared fact (no list kept here):
//   * a `players` row in its settings (adaptive_play.js adaptiveSettings): seats up to that row's `max` (MAX_SEATS);
//   * or a Start button said aloud (its `voice` has "start": 'play', game_start.js START_VOICE): a game that keeps no
//     players - seats 0, it plays as this screen.
// A module with neither (the comet, the press game, Word Forge) is not something "play <name>" starts: it has no Start
// to press and no players to set. [On Mike's list: whether any of them should be.]
// ---------------------------------------------------------------------------------------------------
const settingsOf = (m) => { try { const s = typeof m?.settings === 'function' ? m.settings() : m?.settings; return Array.isArray(s) ? s : []; } catch { return []; } };
export function seatsOf(manifest) {
  const row = settingsOf(manifest).find((f) => f && f.kind === 'players');
  if (row) return Math.max(1, Math.min(MAX_SEATS, Math.floor(Number(row.max)) || MAX_SEATS));
  return 0;
}
export function isGame(manifest) {
  if (!manifest || !manifest.type) return false;
  if (settingsOf(manifest).some((f) => f && f.kind === 'players')) return true;
  const v = manifest.voice;
  return !!v && typeof v === 'object' && v.start === 'play';
}

/**
 * The games as the speech layer is given them: [{ id, type, name, names, here, topic?, payload? }]. A spoken route that
 * names a game ("play name that animal": `name_that/play { game: 'animal' }`) is its own entry, so "play name that animal
 * as Robin" starts THAT game; its names are its phrases without "play". A title a route of the same game already says
 * is left to the route. `here`: a panel of that type is on the screen now. Pure.
 */
export function gameEntries({ manifests = [], routes = ROUTES, here = new Set(), spoken = [] } = {}) {
  const games = new Map();
  for (const m of manifests || []) if (isGame(m)) games.set(m.type, m);
  const out = [];
  const claimed = new Map();   // type -> Set(name) already said by one of its routes
  for (const [rid, r] of Object.entries(routes || {})) {
    const hit = typeof r?.topic === 'string' ? /^([a-z0-9_]+)\/play$/.exec(r.topic) : null;
    if (!hit || !games.has(hit[1]) || !Array.isArray(r.phrases)) continue;
    const type = hit[1];
    const names = r.phrases.map((p) => normalize(p)).map((p) => (p.startsWith('play ') ? p.slice(5) : p)).filter(Boolean);
    if (!claimed.has(type)) claimed.set(type, new Set());
    for (const n of names) claimed.get(type).add(n);
    out.push({ id: `route:${rid}`, type, name: String(r.label || '').replace(/^Play /, '') || type, names,
               here: here.has(type), topic: r.topic, payload: r.payload });
  }
  for (const [type, m] of games) {
    const title = String(m.title || type);
    const names = [title, ...(GAME_SPOKEN[type] || [])].map(normalize).filter((n) => n && !claimed.get(type)?.has(n));
    out.push({ id: type, type, name: title, names, here: here.has(type) });
  }
  for (const { name, said } of spoken || []) {
    for (const e of out) if (e.names.includes(name) || normalize(e.name) === name) e.names = [...e.names, said];
  }
  return out.filter((e) => e.names.length);
}

/**
 * The people as the speech layer is given them: [{ id, name, names }]. `id` is 'self' for the person this screen is
 * for (so it becomes a self seat whoever that is), else their person id. A first name is a name too, when nobody else
 * on the list has the same one (input_speech.js drops a shared one anyway). Pure.
 */
export function peopleEntries({ people = [], self = null, spoken = [] } = {}) {
  const selfId = self && self.id ? String(self.id) : null;
  const rows = [];
  for (const p of Array.isArray(people) ? people : []) {
    if (!p || !p.id) continue;
    const name = String(p.name || p.profile_name || '').trim();
    if (!name) continue;
    rows.push({ id: selfId && p.id === selfId ? PLAY_SELF_ID : String(p.id), name });
  }
  if (selfId === null || !rows.some((r) => r.id === PLAY_SELF_ID)) {
    const n = self && self.name ? String(self.name).trim() : '';
    if (n) rows.push({ id: PLAY_SELF_ID, name: n });
  }
  const firsts = new Map();
  for (const r of rows) { const f = normalize(r.name).split(' ')[0]; firsts.set(f, (firsts.get(f) || 0) + 1); }
  const out = rows.map((r) => {
    const full = normalize(r.name);
    const first = full.split(' ')[0];
    return { id: r.id, name: r.name, names: [full, ...(full !== first && firsts.get(first) === 1 ? [first] : [])] };
  });
  for (const { name, said } of spoken || []) {
    for (const e of out) if (e.names.includes(name)) e.names = [...e.names, said];
  }
  return out;
}

const fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "Robin", "Robin and Sam", "Robin, Sam and a guest", "two guests". */
export function listWords(words) {
  const a = (words || []).filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}
/** The seats in words, for the line said back. Guests are counted, not named ("Guest 2" is not what anybody said). */
export function seatWords(seats, { selfName = '' } = {}) {
  const words = [];
  let guests = 0;
  for (const s of seats || []) {
    if (!s) continue;
    if (s.kind === 'guest') { guests += 1; continue; }
    words.push(s.kind === 'self' ? (selfName || 'this screen’s profile') : (s.name || 'somebody'));
  }
  if (guests) words.push(guests === 1 ? 'a guest' : `${NUMBER_WORDS[guests] || guests} guests`);
  return listWords(words);
}

/**
 * THE SEATS A REQUEST MAKES. Pure, so a suite can read every rule:
 *   'as'      exactly the names said
 *   'with'    the default player ("nobody named", below), then the names: "play trivia with Robin" is two players
 *   count     n names said for n players: the names; n-1: the default player and the names; fewer: the default player,
 *             the names, then guests to make n; MORE names than n: an error ('count-off'), nothing starts
 *   bare      the default player, or null (no change) when the setting is "the game's own Players row"
 * The default player is the screen's profile (a self seat) or a guest, as the setting says ('setting' acts as 'self'
 * inside "with" and a count: somebody has to sit in the first seat, and it is the screen's).
 * Returns { seats | null, error? }. A seat named twice sits once.
 */
export function seatsFor(req, { nobody = PLAY_AS_DEFAULTS.nobody, people = [] } = {}) {
  const r = req || {};
  const named = [];
  const add = (list, seat) => { if (seat && seat.kind === 'guest') seat = { kind: 'guest', name: nextGuestName(list) }; if (seat && !list.some((s) => seatKey(s) === seatKey(seat))) list.push(seat); return list; };
  for (const id of Array.isArray(r.people) ? r.people : []) {
    if (id === PLAY_SELF_ID) add(named, { kind: 'self' });
    else if (id === PLAY_GUEST_ID) add(named, { kind: 'guest' });
    else {
      const row = (people || []).find((p) => p && String(p.id) === String(id));
      add(named, { kind: 'person', id: String(id), name: String(row?.name || '') });
    }
  }
  const dflt = () => (nobody === 'guest' ? { kind: 'guest' } : { kind: 'self' });
  // The default player first, then the names (a guest named is numbered after a default guest: "Guest 2").
  const withDefault = () => {
    const seats = add([], dflt());
    for (const s of named) add(seats, s.kind === 'guest' ? { kind: 'guest' } : s);
    return seats;
  };
  const count = r.count != null && Number.isFinite(Number(r.count)) ? Math.max(1, Math.floor(Number(r.count))) : null;
  if (count != null) {
    if (named.length > count) return { seats: null, error: 'count-off', named: named.length, count };
    const seats = named.length === count ? named : withDefault();
    while (seats.length < count) { const before = seats.length; add(seats, { kind: 'guest' }); if (seats.length === before) break; }
    return { seats };
  }
  if (r.join === 'as') return { seats: named };
  if (r.join === 'with') return { seats: withDefault() };
  return { seats: nobody === 'setting' ? null : add([], dflt()) };
}

/**
 * The host: `vocabulary()` for the speech layer, `wrap(base, instanceId)` for each panel's `ctx.screenPlayers`, and the
 * handling of SPEECH_PLAY_AS_TOPIC on `bus`.
 *   manifests()   every registered module's manifest (module.js listManifests)
 *   panels()      the panels on the showing dashboard: [{ id, type, title }]
 *   focusedId()   the focused panel's id, preferred when two panels are the same game
 *   people        an array, or a function returning one or a promise of one (/api/people's rows); read again after
 *                 PEOPLE_REFRESH_MS. Null: only the screen's own person (from `self`) is known by name.
 *   self()        { id, name } the person this screen is for
 *   values()      the screen's settings row (PLAY_AS_FIELDS)
 *   say(text, o)  the output bus's say, for the line said back
 */
export function createPlayAs({
  bus = null,
  manifests = () => [],
  panels = () => [],
  focusedId = () => null,
  people = null,
  self = () => ({ id: null, name: '' }),
  values = () => ({}),
  say = null,
  routes = ROUTES,
  verbs = MODULE_VERBS,
  lines = PLAY_AS_LINES,
  now = () => Date.now(),
  peopleRefreshMs = PEOPLE_REFRESH_MS,
  sayTtlMs = SAY_TTL_MS,
} = {}) {
  const L = { ...PLAY_AS_LINES, ...(lines || {}) };
  const overrides = new Map();   // instanceId -> seats
  const listeners = new Map();   // instanceId -> Set(fn)
  let peopleList = Array.isArray(people) ? people : null;
  let peopleAt = Array.isArray(people) ? now() : -Infinity;
  let loading = false;
  let last = null;
  const offs = [];
  const ask = (fn, d) => { try { const v = fn(); return v == null ? d : v; } catch { return d; } };

  function loadPeople() {
    if (typeof people !== 'function' || loading || now() - peopleAt < peopleRefreshMs) return;
    loading = true;
    peopleAt = now();
    let got;
    try { got = people(); } catch (err) { got = Promise.reject(err); }
    Promise.resolve(got).then((rows) => { if (Array.isArray(rows)) peopleList = rows.filter((p) => p && p.id); })
      .catch((err) => console.error('play as: people', err))
      .finally(() => { loading = false; });
  }
  const opts = () => playAsOptionsFrom(ask(values, {}));
  const panelList = () => (ask(panels, []) || []).filter((r) => r && r.id && r.type);
  const manifestList = () => (ask(manifests, []) || []).filter(Boolean);

  function games() {
    const here = new Set(panelList().map((r) => r.type));
    return gameEntries({ manifests: manifestList(), routes, here, spoken: spokenNamesFrom(opts().spoken) });
  }
  function folks() {
    loadPeople();
    return peopleEntries({ people: peopleList || [], self: ask(self, null), spoken: spokenNamesFrom(opts().spoken) });
  }
  function vocabulary() { return { games: games(), people: folks() }; }

  function notify(id) {
    for (const fn of [...(listeners.get(id) || [])]) { try { fn(); } catch (err) { console.error('play as: players', err); } }
  }
  function setOverride(id, seats) {
    const had = overrides.has(id);
    if (Array.isArray(seats) && seats.length) overrides.set(id, seats.map((s) => ({ ...s })));
    else overrides.delete(id);
    if (had || overrides.has(id)) notify(id);
  }

  function speak(text) {
    if (!text || typeof say !== 'function') return;
    try { say(text, { source: 'play-as', ttlMs: sayTtlMs }); } catch (err) { console.error('play as: say', err); }
  }
  const topicFor = (id, topic) => (bus && typeof bus.instanceTopic === 'function' ? bus.instanceTopic(id, topic) : `${topic}#${id}`);
  const META = senderMeta({ kind: 'local', id: 'play-as', role: 'universal' });
  function startPanel(rec, entry) {
    try {
      if (entry.topic) { bus?.publish?.(topicFor(rec.id, entry.topic), entry.payload, META); return 'named'; }
      const t = verbTarget(rec.type, 'play', verbs);
      if (t) { bus?.publish?.(topicFor(rec.id, t.topic), t.payload, META); return 'play'; }
    } catch (err) { console.error('play as: start', err); }
    return 'going';
  }

  /** Handle one request (SPEECH_PLAY_AS_TOPIC's payload). Returns what happened, for a suite. */
  function handle(req) {
    const r = req && typeof req === 'object' ? req : {};
    const o = opts();
    // Why nothing started is ALWAYS said, whatever "Say who is playing" says: that row is about the read-back, and a
    // command heard (the tone played) that then does nothing, silently, is the one outcome nobody can diagnose.
    const done = (result, line = null) => { if (line) speak(line); last = { ...result, line }; return last; };
    const list = games();
    const entry = r.game ? list.find((g) => g.id === r.game) : null;
    if (!entry) return done({ started: false, why: 'unknown-game' }, fill(L.unknownGame, { heard: r.gameHeard || 'that' }));
    const unknown = (Array.isArray(r.unknown) ? r.unknown : []).filter(Boolean);
    if (unknown.length) {
      return done({ started: false, why: 'unknown-person', unknown },
        fill(unknown.length > 1 ? L.unknownPeople : L.unknownPerson, { names: listWords(unknown) }));
    }
    const recs = panelList().filter((x) => x.type === entry.type);
    if (!recs.length) return done({ started: false, why: 'not-here', game: entry.id }, fill(L.notHere, { game: entry.name }));
    const fid = ask(focusedId, null);
    const rec = recs.find((x) => x.id === fid) || recs[0];
    const m = manifestList().find((x) => x.type === entry.type);
    const max = seatsOf(m);
    const selfName = String(ask(self, {})?.name || '');
    const made = seatsFor(r, { nobody: o.nobody, people: peopleList || [] });
    if (made.error === 'count-off') {
      return done({ started: false, why: 'count-off', game: entry.id }, fill(L.countOff, { count: made.count, named: made.named }));
    }
    let seats = made.seats;
    let line;
    const justSelf = !seats || (seats.length === 1 && seats[0].kind === 'self');
    if (max === 0) {
      // A game that keeps no players: it plays as this screen. Named somebody else, it says so (and, set to, stops).
      if (!justSelf && o.tooMany === 'stop') {
        return done({ started: false, why: 'no-seats', game: entry.id }, fill(L.noSeatsStop, { game: entry.name }));
      }
      line = justSelf ? fill(L.startPlain, { game: entry.name }) : fill(L.noSeats, { game: entry.name });
      seats = null;
    } else if (seats && seats.length > max) {
      if (o.tooMany === 'stop') {
        return done({ started: false, why: 'too-many', game: entry.id }, fill(L.fewerStop, { game: entry.name, max }));
      }
      seats = seats.slice(0, max);
      line = fill(L.fewer, { game: entry.name, max, players: seatWords(seats, { selfName }) });
    } else if (!seats || (!r.join && r.count == null && justSelf)) {
      line = fill(L.startPlain, { game: entry.name });
    } else {
      line = fill(L.start, { game: entry.name, players: seatWords(seats, { selfName }) });
    }
    // The players first, then the start: the first turn is already theirs.
    setOverride(rec.id, seats);
    if (o.readBack !== false) speak(line);
    const how = startPanel(rec, entry);
    last = { started: true, instanceId: rec.id, game: entry.id, seats: seats ? seats.map((s) => ({ ...s })) : null, how, line };
    return last;
  }

  // ---- listening ----------------------------------------------------------------------------------------------------
  const sub = (topic, fn) => { try { const off = bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
  sub(SPEECH_PLAY_AS_TOPIC, (p) => { handle(p); });
  // A panel's sitting coming to rest ends what a voice start chose for it (game_start.js createPlayWatch `rest`).
  sub(PLAY_STATE_TOPIC, (p) => { if (p && p.rest === true && p.id && overrides.has(p.id)) setOverride(p.id, null); });
  // *** THE ROUTES THAT ALREADY START A GAME BY NAME ("play opposites", "play card sort") are commands that win before
  // this file hears anything, so "nobody named" is applied when one of them is SAID: its topic published by the speech
  // device (meta.from `speech:...`, as photos.js reads it). Subscribed here before any panel mounts, so the players
  // are set before the game hears the same publish. Nothing is said back for these: the route's own tone already was.
  const routeTopics = new Map();
  for (const r of Object.values(routes || {})) {
    const hit = typeof r?.topic === 'string' ? /^([a-z0-9_]+)\/play$/.exec(r.topic) : null;
    if (hit) routeTopics.set(r.topic, hit[1]);
  }
  for (const [topic, type] of routeTopics) {
    sub(topic, (_p, _t, meta) => {
      if (!/^speech:/.test(senderOf(meta).id || '')) return;
      const o = opts();
      const made = seatsFor({}, { nobody: o.nobody });
      for (const rec of panelList()) if (rec.type === type) setOverride(rec.id, made.seats);
    });
  }

  return {
    vocabulary,
    handle,
    /** The seats a voice start chose for this panel, or null. */
    override: (id) => (overrides.has(id) ? overrides.get(id).map((s) => ({ ...s })) : null),
    /** What the last request did ({ started, why?, instanceId?, seats?, line }), for a suite. */
    last: () => (last ? { ...last } : null),
    /**
     * A panel's `ctx.screenPlayers`: the screen's players (`base`) as before, plus `override()` - the seats a voice start
     * chose for THIS panel - and `subscribe` told when either changes.
     */
    wrap(base, instanceId) {
      const b = base || {};
      return {
        seats: () => (typeof b.seats === 'function' ? b.seats() : []),
        self: () => (typeof b.self === 'function' ? b.self() : { id: null, name: '' }),
        override: () => (overrides.has(instanceId) ? overrides.get(instanceId).map((s) => ({ ...s })) : null),
        subscribe(fn) {
          let offBase = null;
          try { offBase = typeof b.subscribe === 'function' ? b.subscribe(fn) : null; } catch { offBase = null; }
          if (!listeners.has(instanceId)) listeners.set(instanceId, new Set());
          listeners.get(instanceId).add(fn);
          return () => {
            try { offBase?.(); } catch { /* gone */ }
            listeners.get(instanceId)?.delete(fn);
          };
        },
      };
    },
    destroy() {
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      overrides.clear();
      listeners.clear();
    },
  };
}
