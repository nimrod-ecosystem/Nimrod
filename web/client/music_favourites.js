// music_favourites.js — THE FAVOURITES LIST: a spoken name, and where the music for it lives.
//
// Row 2.32, Mike 2026-09-30: *"I don't suppose we could make it play certain music or something like
// you would with alexa."* Chat's proposed order, followed here: (1) YouTube favourites, (2) music files
// on the family's own machine, (3) Spotify as an optional connector for households that have Premium.
//
// *** ONE LIST, MANY WAYS IN. *** Mike's rule: "several ways in, but they should all really just be the
// same thing." So the list is DATA, kept per PERSON (it follows them to any screen, like presets do),
// and every way of starting music ends in the same verb, `music/play { name }`:
//   * a spoken "computer please play <name>"  (a route per favourite - `musicSpeechRoutes` below)
//   * a button on the music panel             (modules/music.js)
//   * anything else that can publish a topic  (an AAC button, a switch binding, a future AI)
// The panel is only a face on the list and a place to hear it; the list does not belong to a panel.
//
// WHY A CLOSED LIST, NOT "PLAY ANYTHING": the recogniser on the bedside unit is small and local, and it
// can only be relied on for phrases it has been told about. "Play anything" needs open dictation and a
// search, and that belongs to the upgrade question (register 274), not to this row.
//
// EACH ENTRY:
//   { id, name, aliases: [..], source }
//   source is one of
//     { kind: 'youtube', videoId }            | { kind: 'youtube', playlistId }
//     { kind: 'file',    sourceId, path }     one file on a connected media source
//     { kind: 'folder',  sourceId, album }    every music file in one folder of it
//     { kind: 'spotify', uri, device? }       a Spotify track/album/playlist/artist/episode/show
//
// PURE except `watchFavourites`, which only wraps a state handle it is given.

import { normalize, nearMiss, spokenTable, routeAction, phraseControl, SPEECH_DEVICE } from './input_speech.js';
import { parseVideoId, parsePlaylistId } from './modules/youtube.js';
import { spotifyRef } from './recommend.js';

export const FAVOURITES_KEY = 'music-favourites';
export const SOURCE_KINDS = Object.freeze(['youtube', 'file', 'folder', 'spotify']);
export const MUSIC_PLAY_TOPIC = 'music/play';
export const MUSIC_STOP_TOPIC = 'music/stop';

// How a spoken favourite starts. "play" is what Mike said; "put on" is the other thing people say to a
// speaker. A CONSTANT, NOT A SETTING, argued (Rule 1): it is phrase vocabulary, the same class as
// input_speech.js's PHRASES table, which is also a reviewed constant - and a per-panel setting could not
// reach the screen's speech wiring anyway, so it would be a row that changes nothing. Listed for Mike.
// Every word is one the small recogniser model knows [unverified on the bench for "put"].
export const DEFAULT_STARTERS = Object.freeze(['play', 'put on']);

// The fixed "stop" route. NOT bare "stop": that is already the `pause` verb, and it means "whatever is
// in front of you". These name the music, so they reach it even when a different panel is focused.
export const STOP_PHRASES = Object.freeze(['stop the music', 'music off', 'turn the music off',
  'turn off the music']);
export const STOP_ROUTE_ID = 'music-stop';

// ---------------------------------------------------------------------------------------------
// SOURCES
// ---------------------------------------------------------------------------------------------

/**
 * A Spotify link or URI as a canonical `spotify:<type>:<id>`, or '' when it is not one. Accepts
 * `spotify:track:...`, `https://open.spotify.com/(intl-xx/)track/...?si=...` and Spotify's embed address
 * `https://open.spotify.com/embed/playlist/...` (row 2.55: the Favourites form used to refuse that one).
 * The reading itself is recommend.js's `spotifyRef`, the one Spotify-link reader on the site.
 */
export function parseSpotifyUri(input) {
  const r = spotifyRef(input);
  return r ? `spotify:${r.type}:${r.id}` : '';
}

/**
 * What somebody pasted, as a source - or null. A YouTube VIDEO wins over its playlist when a watch URL
 * carries both, because the person pasted the page of one video. Local sources are not pasted: the
 * panel builds them from a picker, so they arrive already structured and go through `normalizeSource`.
 */
export function parseSource(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const sp = parseSpotifyUri(s);
  if (sp) return { kind: 'spotify', uri: sp };
  const vid = parseVideoId(s);
  if (vid) return { kind: 'youtube', videoId: vid };
  const list = parsePlaylistId(s);
  if (list) return { kind: 'youtube', playlistId: list };
  return null;
}

/** A source object checked and trimmed to the fields its kind uses, or null. */
export function normalizeSource(raw) {
  if (!raw || typeof raw !== 'object') return typeof raw === 'string' ? parseSource(raw) : null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  switch (raw.kind) {
    case 'youtube': {
      const videoId = parseVideoId(str(raw.videoId));
      if (videoId) return { kind: 'youtube', videoId };
      const playlistId = parsePlaylistId(str(raw.playlistId));
      return playlistId ? { kind: 'youtube', playlistId } : null;
    }
    case 'file': {
      const sourceId = str(raw.sourceId), path = str(raw.path).replace(/^\/+/, '');
      return sourceId && path ? { kind: 'file', sourceId, path } : null;
    }
    case 'folder': {
      const sourceId = str(raw.sourceId);
      return sourceId ? { kind: 'folder', sourceId, album: str(raw.album).replace(/^\/+|\/+$/g, '') } : null;
    }
    case 'spotify': {
      const uri = parseSpotifyUri(str(raw.uri));
      if (!uri) return null;
      const device = str(raw.device);
      return device ? { kind: 'spotify', uri, device } : { kind: 'spotify', uri };
    }
    default: return null;
  }
}

/** A few words on where an entry's music comes from, for the list on the panel. */
export function describeSource(src, sourceLabel = null) {
  if (!src) return 'nowhere';
  if (src.kind === 'youtube') return src.videoId ? 'a YouTube video' : 'a YouTube playlist';
  if (src.kind === 'spotify') return `Spotify ${src.uri.split(':')[1] || ''}`.trim() + (src.device ? ` on ${src.device}` : '');
  const where = sourceLabel ? ` in ${sourceLabel}` : '';
  if (src.kind === 'file') return `a music file${where}`;
  if (src.kind === 'folder') return `a music folder${where}`;
  return 'nowhere';
}

// ---------------------------------------------------------------------------------------------
// ENTRIES
// ---------------------------------------------------------------------------------------------

export const MAX_NAME = 60;

// An id that is safe inside an action id (`speech/music-<id>`, actions.js's ID_RE) and short.
export function newFavouriteId(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36) % 36];
  return `f${s}`;
}
const cleanId = (v) => (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v) ? v : '');

/** One entry, checked. Null when it has no usable name or no usable source. */
export function normalizeFavourite(raw, { rand = Math.random } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!normalize(name)) return null;
  const source = normalizeSource(raw.source);
  if (!source) return null;
  const aliases = (Array.isArray(raw.aliases) ? raw.aliases : [])
    .map((a) => String(a || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME))
    .filter((a) => normalize(a) && normalize(a) !== normalize(name));
  return { id: cleanId(raw.id) || newFavouriteId(rand), name, aliases: [...new Set(aliases)], source };
}

/** The whole list, checked: bad rows dropped, and a repeated name keeps its FIRST entry. */
export function normalizeFavourites(list, opts) {
  const out = [];
  const names = new Set();
  const ids = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const f = normalizeFavourite(raw, opts);
    if (!f) continue;
    const k = normalize(f.name);
    if (names.has(k)) continue;
    if (ids.has(f.id)) f.id = newFavouriteId(opts?.rand);
    names.add(k); ids.add(f.id);
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// FINDING ONE BY NAME — exact first, a near miss only when it is near exactly one
// ---------------------------------------------------------------------------------------------

// "the beatles" and "beatles" are the same request; so are "some jazz" and "jazz". Stripped from BOTH
// sides, and only as a leading word, so a name that IS one of these words is still itself.
const LEADING = /^(the|some|my|a) /;
const bare = (s) => { const n = normalize(s); const b = n.replace(LEADING, ''); return b || n; };
const namesOf = (f) => [f.name, ...(f.aliases || [])];

/**
 * `{ status: 'exact', entry }` | `{ status: 'near', entry, heard }` | `{ status: 'none' }`.
 *
 * *** A NEAR MISS IS NEVER PLAYED HERE. *** It is reported, and the caller decides - the router asks
 * by default, the same rule input_speech.js follows for spoken commands (Mike, note AO: a near miss
 * asks, it never acts). "Near" is input_speech's own `nearMiss`, so a favourite is near in exactly the
 * way a command is: one word added, dropped, or sounding alike - and near ONE entry, never two.
 */
export function findFavourite(favourites, name) {
  const list = Array.isArray(favourites) ? favourites : [];
  const said = normalize(name);
  if (!said) return { status: 'none' };
  for (const f of list) if (namesOf(f).some((n) => normalize(n) === said)) return { status: 'exact', entry: f };
  const b = bare(said);
  for (const f of list) if (namesOf(f).some((n) => bare(n) === b)) return { status: 'exact', entry: f };
  const table = {};
  for (const f of list) table[f.id] = namesOf(f).flatMap((n) => [normalize(n), bare(n)]).filter(Boolean);
  const nm = nearMiss(said, table) || (b !== said ? nearMiss(b, table) : null);
  if (!nm) return { status: 'none' };
  const entry = list.find((f) => f.id === nm.id);
  return entry ? { status: 'near', entry, heard: said } : { status: 'none' };
}

// ---------------------------------------------------------------------------------------------
// SPEECH — the favourites as spoken routes, in exactly input_speech.js's ROUTES shape
// ---------------------------------------------------------------------------------------------

/** Starters from the panel's setting: "play | put on". Blank or broken is the default. */
export function startersFrom(text) {
  const list = String(text == null ? '' : text).split('|').map((s) => normalize(s)).filter(Boolean);
  return list.length ? [...new Set(list)] : [...DEFAULT_STARTERS];
}

/**
 * THE FAVOURITES AS SPOKEN ROUTES. Returns `{ routes, skipped }`:
 *   routes   { 'music-<id>': { topic: 'music/play', payload: { name, id }, label, phrases } , ...,
 *              'music-stop': { topic: 'music/stop', ... } }  - drop straight into attachSpeech's
 *              `routes` next to input_speech's own ROUTES.
 *   skipped  [{ name, phrase, why }] - every phrase that was NOT made, and why, so the panel can say so:
 *              'taken'   it is already a command or another route ("play it" is the play verb)
 *              'twice'   two favourites would make the same phrase; the first keeps it
 *              'digits'  the name has digits, which the recogniser writes as words - say "top forty"
 *              'short'   the name is under three letters (input_speech's own floor for a phrase)
 *
 * `taken` defaults to input_speech's whole spoken table (verbs + its routes), so nothing made here can
 * collide with a command - `duplicatePhrases` over the combined table stays empty.
 */
export function musicSpeechRoutes(favourites, { starters = DEFAULT_STARTERS, taken = spokenTable(),
                                                stop = true, speakers = null } = {}) {
  const used = new Map();   // normalized phrase -> owner id
  for (const [id, phrases] of Object.entries(taken || {})) {
    for (const p of Array.isArray(phrases) ? phrases : []) { const k = normalize(p); if (k) used.set(k, `taken:${id}`); }
  }
  const routes = {};
  const skipped = [];
  const starts = (Array.isArray(starters) ? starters : startersFrom(starters)).map(normalize).filter(Boolean);
  for (const f of Array.isArray(favourites) ? favourites : []) {
    const phrases = [];
    for (const n of namesOf(f)) {
      if (/\d/.test(n)) { skipped.push({ name: n, phrase: null, why: 'digits' }); continue; }
      const nn = normalize(n);
      if (nn.replace(/ /g, '').length < 3) { skipped.push({ name: n, phrase: null, why: 'short' }); continue; }
      for (const st of starts) {
        const p = `${st} ${nn}`;
        const owner = used.get(p);
        if (owner === f.id) continue;
        if (owner) { skipped.push({ name: n, phrase: p, why: owner.startsWith('taken:') ? 'taken' : 'twice' }); continue; }
        used.set(p, f.id);
        phrases.push(p);
      }
    }
    if (phrases.length) {
      routes[`music-${f.id}`] = { topic: MUSIC_PLAY_TOPIC, payload: { name: f.name, id: f.id },
        label: `Play ${f.name}`, phrases };
    }
  }
  if (stop) {
    const phrases = STOP_PHRASES.filter((p) => !used.has(normalize(p)));
    if (phrases.length) routes[STOP_ROUTE_ID] = { topic: MUSIC_STOP_TOPIC, payload: {}, label: 'Stop the music', phrases };
  }
  // *** PLAY ON BY VOICE (rows 2.61, 2.68; note BI: "One press, remembered per panel, and by voice"). *** Only when the
  // host passes `speakers` (kiosk.js does, from the favourites record): "play on this screen", and "play on <name>" for
  // each Spotify speaker a Music panel has found. The same collision rules as the favourites: a phrase that is already
  // a command or a favourite is skipped and said.
  if (Array.isArray(speakers)) {
    const here = PLAY_ON_HERE_PHRASES.filter((p) => !used.has(normalize(p)));
    for (const p of here) used.set(normalize(p), PLAY_ON_HERE_ROUTE_ID);
    if (here.length) routes[PLAY_ON_HERE_ROUTE_ID] = { topic: MUSIC_PLAY_ON_TOPIC, payload: { where: 'here' }, label: 'Play music on this screen', phrases: here };
    for (const name of speakerNames(speakers)) {
      const nn = normalize(name);
      if (/\d/.test(name)) { skipped.push({ name, phrase: null, why: 'digits' }); continue; }
      if (nn.replace(/ /g, '').length < 3) { skipped.push({ name, phrase: null, why: 'short' }); continue; }
      const p = `play on ${nn}`;
      const owner = used.get(p);
      if (owner) { skipped.push({ name, phrase: p, why: owner.startsWith('taken:') ? 'taken' : 'twice' }); continue; }
      const id = `music-on-${nn.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      used.set(p, id);
      routes[id] = { topic: MUSIC_PLAY_ON_TOPIC, payload: { name }, label: `Play on ${name}`, phrases: [p] };
    }
  }
  return { routes, skipped };
}

// play on: the topic, the fixed "this screen" phrases, and a clean list of speaker names (at most 20, no repeats).
export const MUSIC_PLAY_ON_TOPIC = 'music/play-on';
export const PLAY_ON_HERE_ROUTE_ID = 'music-on-here';
export const PLAY_ON_HERE_PHRASES = Object.freeze(['play on this screen', 'play music here']);
export function speakerNames(list) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const n = String(s == null ? '' : s).trim().slice(0, MAX_NAME);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
    if (out.length >= 20) break;
  }
  return out;
}

/** The routes as actions, the same shape as input_speech's SPEECH_ACTIONS, for `registry.registerAll`. */
export function musicSpeechActions(routes) {
  return Object.entries(routes || {}).map(([id, r]) => ({
    id: routeAction(id), label: r.label, topic: r.topic, payload: r.payload, group: 'Spoken',
  }));
}

/** The routes' bindings, the same shape as input_speech's ROUTE_BINDINGS. */
export function musicSpeechBindings(routes) {
  return Object.entries(routes || {}).map(([id, r]) => ({
    id: `default/speech-${id}`,
    actionId: routeAction(id),
    device: SPEECH_DEVICE,
    control: phraseControl(id),
    edge: 'press',
    role: 'universal',
    holdMs: 0, debounceMs: 0, lockoutMs: 0,
    label: `Say “${r.phrases[0]}”`,
  }));
}

/** A stable signature of what the favourites make speakable, so a host re-attaches speech only on change. */
export function favouritesSignature(favourites, starters = DEFAULT_STARTERS) {
  return JSON.stringify([(Array.isArray(starters) ? starters : [starters]),
    (Array.isArray(favourites) ? favourites : []).map((f) => [f.id, f.name, f.aliases || []])]);
}

// ---------------------------------------------------------------------------------------------
// WHERE THE LIST LIVES
// ---------------------------------------------------------------------------------------------

/**
 * The list for one PERSON, kept current. `makePersonState` is the host's `(personId, key, opts)` seam
 * (kiosk.js's childCtx, home.js). Returns `{ list(), set(list), subscribe(fn), ready, destroy() }`, or
 * null when there is no person to keep it for (a signed-out demo) - the panel then keeps its own.
 *
 * Stored as `{ favourites: [...] }` rather than a bare array, so a later field (a default device, an
 * order) can sit beside it without a migration.
 */
export function watchFavourites({ makePersonState, personId, onChange = null } = {}) {
  if (typeof makePersonState !== 'function' || !personId) return null;
  let handle = null;
  try { handle = makePersonState(personId, FAVOURITES_KEY); } catch { handle = null; }
  if (!handle) return null;
  let list = [];
  let speakers = [];
  const subs = new Set(onChange ? [onChange] : []);
  // play on: the record's `speakers` (Spotify speaker names, for "play on <name>") ride along as a second argument.
  const take = (s) => {
    list = normalizeFavourites(s && s.favourites);
    speakers = speakerNames(s && s.speakers);
    for (const fn of subs) { try { fn(list, { speakers }); } catch (err) { console.error('music favourites', err); } }
  };
  const ready = Promise.resolve(handle.load?.()).catch(() => {}).then(() => { take(handle.get?.()); });
  const off = handle.subscribe?.((s) => take(s));
  handle.startPolling?.();
  return {
    ready,
    list: () => list,
    set(next) {
      list = normalizeFavourites(next);
      handle.set?.({ favourites: list });
      for (const fn of subs) { try { fn(list, { speakers }); } catch (err) { console.error('music favourites', err); } }
      return list;
    },
    /** play on: the Spotify speaker names "play on <name>" knows, kept beside the favourites (names only). */
    speakers: () => [...speakers],
    setSpeakers(names) {
      const next = speakerNames(names);
      if (JSON.stringify(next) === JSON.stringify(speakers)) return speakers;
      speakers = next;
      handle.set?.({ speakers: next });
      for (const fn of subs) { try { fn(list, { speakers }); } catch (err) { console.error('music favourites', err); } }
      return speakers;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    destroy() {
      subs.clear();
      try { typeof off === 'function' && off(); } catch { /* gone */ }
      // A change made just before the panel closed still reaches the server; then the handle stops.
      try { Promise.resolve(handle.flush?.()).catch(() => {}); } catch { /* gone */ }
      try { handle.destroy?.(); } catch { /* gone */ }
    },
  };
}
