// dashboards.js — THE READY-MADE DASHBOARDS (row 2.34), AS DATA; how one is made the first time a
// person picks it; and a person's dashboards as spoken routes ("computer please go to my room").
//
// Mike, 2026-09-30: *"We should just have multiple prebuilt dashboards. The room being one. Another
// being just a very basic like the original Nimrod theme. Another being like what we currently have
// before rooms. The 2d with options for transparency and live backgrounds. Maybe have a dashboard
// select part in the transport bar where you can jump between them."*
//
// *** OFFERED, NOT FORCED (Code's recommendation on row 2.34, question 2; no answer came, so it is the
// default). *** Nobody is given three dashboards they did not ask for. The picker (dashboard_picker.js,
// opened from the bar's Home button) offers each ready-made one that this person has not made yet
// ("+ Room"); picking it -- by a press, a switch or by voice -- makes it, once, and goes there.
//   FOR made-at-first-sign-in: everything is one press away from the first minute, with nothing to
//     wait for. AGAINST, and it wins: three screens appear in somebody's Dashboards list that they did
//     not make, each with panels that start (a YouTube schedule, a word game) on a screen they never
//     opened -- and "who made these?" is a question the product should never make anybody ask.
//
// *** A PLAIN COPY, NOT A PREFAB (the prefab question stays open, §setting-scope-prefabs). *** Making
// one copies the record below into an ordinary screen: its own modules, its own settings doc, its own
// layout. Changing this file later changes the ready-made one OFFERED, never one somebody already made.
//
// *** EACH CARRIES ITS OWN THEME (row 2.34 chat note (a); step 6 R3). *** On the dashboard path (Stage
// 4) the theme -- and since this change the panel backgrounds -- follow the dashboard that is showing.
// On today's path a swap keeps the boot screen's (kiosk.js `showScreen`: "only the arrangement is
// documented as belonging to the incoming screen"); see the report on Mike's list.
//
// WHAT IS STAMPED. A made dashboard's settings doc carries `prebuilt: '<key>'` (written FIRST, right
// after the screen is created), `prebuiltRefs` (each module's id as it is made) and `prebuiltDone: true`
// (written LAST, with the layout and the theme). So the maker is re-entrant the way game/game.js is: a
// page closed half-way leaves a stamped, unfinished dashboard that the next pick FINISHES rather than
// making a second one; and a screen somebody happened to NAME "My room" has no stamp and is never adopted.

import { normalizeLayout } from './layout.js';
import { THEMES, DEFAULT_THEME } from './theme.js';
import { ROOM_PRESETS, DEFAULT_PRESET as ROOM_DEFAULT_PRESET } from './room_presets.js';
import { STARTER_MODULES } from './modules_catalog.js';
import { STARTER_SCHEDULE } from './local_store.js';
import { profileSetup } from './game/game.js';
import { PHRASES, ROUTES, spokenTable, normalize, routeAction, phraseControl, SPEECH_DEVICE } from './input_speech.js';
import { SYSTEM_TOPICS } from './actions.js';
import { DASHBOARD_GO_TOPIC as NEST_GO_TOPIC, SCREEN_BACK_TOPIC, SCREEN_HOME_TOPIC } from './dashboard_nest.js';

export const PANEL_SURFACES = Object.freeze(['solid', 'veil', 'clear']);

// The settings-doc keys the maker writes. Exported so a suite, a diagnostic page and Home can read them.
export const PREBUILT_KEY = 'prebuilt';
export const PREBUILT_REFS_KEY = 'prebuiltRefs';
export const PREBUILT_DONE_KEY = 'prebuiltDone';

// =====================================================================================================
// THE THREE, AS DATA. Every value below is a starting point (Rule 1), argued, and on Mike's list:
//
// ROOM ("+ Room")
//   scene     the room the room module calls its default (room_presets.js DEFAULT_PRESET, 'theRoom':
//             Design's room-is-the-screen room, whose furniture carries the controls). Design's four
//             other rooms are the same `scene.preset`, one value away.
//   modules   the profile game's own picture and name sign (game/game.js `profileSetup`: an empty
//             classic frame with no words, and Design's name plate with the person's name). Reused, not
//             copied, so the room and the profile cannot start different.
//   where     both hang on the BACK wall, the picture left of the window and the sign high on the right
//             -- x/y are the centre in % of the room, w/h in %. Code's guess: clear of the window
//             (x 50, y 26) and of the furniture below y 55.
//   theme     the default (cream and green). FOR: the room IS the backdrop, and a live theme would draw a
//             second moving world behind it that nobody sees but the Pi pays for (Design's Pi budget:
//             "one live scene"). AGAINST: the bar and the menu are drawn in the theme's colours, and
//             somebody may want them warmer in a room -- the menu's Colours row changes it.
//   panels    'clear': what hangs in the room should read as a thing ON the wall, not a card in front of it.
// BASIC ("+ Basic")
//   Mike: "a very basic like the original Nimrod theme". The default theme (cream and green), solid panels,
//   no live background; photos and a clock side by side (Design's own Basic: "Photos" and "Clock").
// CLASSIC 2D ("+ Classic 2D")
//   Mike: "what we currently have before rooms. The 2d with options for transparency and live
//   backgrounds." Today's starter screen, exactly (modules_catalog.js STARTER_MODULES in the same four-up
//   order local_store.js seeds, with the same YouTube schedule), see-through panels ('veil') over a live
//   background. WHICH live background: 'fall', the one Design's prototype draws behind its Classic 2D and
//   the first in Mike's own list ("fall, winter, castle..."). Guess.
// =====================================================================================================

export const ROOM_SPOTS = Object.freeze({
  picture: Object.freeze({ x: 28, y: 30, w: 16, h: 24 }),
  sign: Object.freeze({ x: 74, y: 12, w: 22, h: 10 }),
});
export const CLASSIC_THEME = 'fall';

export const PREBUILT_DASHBOARDS = Object.freeze({
  room: Object.freeze({
    key: 'room', label: 'Room', name: 'My room',
    blurb: 'A room to furnish. Your picture and your name sign hang on its wall.',
    modules: [
      { ref: 'picture', type: 'button', start: 'picture' },
      { ref: 'sign', type: 'button', start: 'sign' },
    ],
    layout: {
      preset: 'full', slots: [null],
      scene: { kind: 'room', preset: ROOM_DEFAULT_PRESET },
      placed: [
        { ref: 'picture', place: 'scene', surface: 'back', ...ROOM_SPOTS.picture },
        { ref: 'sign', place: 'scene', surface: 'back', ...ROOM_SPOTS.sign },
      ],
    },
    settings: { theme: DEFAULT_THEME, panelSurface: 'clear' },
  }),
  basic: Object.freeze({
    key: 'basic', label: 'Basic', name: 'Basic',
    blurb: 'The original Nimrod look: cream and green, solid panels, photos and a clock.',
    modules: [
      { ref: 'photos', type: 'photos' },
      { ref: 'clock', type: 'clock' },
    ],
    layout: { preset: 'side', slots: ['photos', 'clock'] },
    settings: { theme: DEFAULT_THEME, panelSurface: 'solid' },
  }),
  classic: Object.freeze({
    key: 'classic', label: 'Classic 2D', name: 'Classic 2D',
    blurb: 'See-through panels over a moving background: photos, videos, a word game and a clock.',
    // STARTER_MODULES is [photos, youtube, wordforge, clock] -- the quad's TL, TR, BL, BR, as seeded.
    modules: STARTER_MODULES.map((type) => (type === 'youtube'
      ? { ref: type, type, state: { schedule: STARTER_SCHEDULE.map((d) => ({ ...d })) } }
      : { ref: type, type })),
    layout: { preset: 'quad', slots: [...STARTER_MODULES] },
    settings: { theme: CLASSIC_THEME, panelSurface: 'veil' },
  }),
});

// The order the picker offers them in: the room first (row 2.34 names it first; it is the new thing).
export const PREBUILT_ORDER = Object.freeze(['room', 'basic', 'classic']);

const clone = (v) => JSON.parse(JSON.stringify(v));

/** One ready-made dashboard as a concrete record (a deep copy, so nothing edits the table): the picture
 *  and the sign get the profile game's starting settings, the sign with `personName` on it. */
export function prebuiltRecord(key, { personName = '' } = {}) {
  const base = PREBUILT_DASHBOARDS[key];
  if (!base) return null;
  const rec = clone(base);
  const setup = profileSetup(personName);
  for (const m of rec.modules) {
    if (m.start === 'picture') m.state = { ...setup.picture };
    else if (m.start === 'sign') m.state = { ...setup.sign };
    delete m.start;
  }
  return rec;
}

/** The record's layout with module REFS turned into instance ids (`refs`: ref -> id), normalised the way
 *  every saved layout is -- so what is saved is exactly what layout.js would keep. */
export function layoutFor(rec, refs = {}) {
  const L = rec.layout || {};
  const raw = {
    preset: L.preset,
    slots: (L.slots || []).map((r) => (r ? refs[r] || null : null)),
    ...(L.scene ? { scene: clone(L.scene) } : {}),
    ...(Array.isArray(L.placed) ? {
      placed: L.placed.map(({ ref, ...e }) => ({ ...e, id: refs[ref] })).filter((e) => e.id),
    } : {}),
  };
  return normalizeLayout(raw, Object.values(refs));
}

/**
 * WHAT IS WRONG WITH A RECORD, as sentences (empty = valid). The suite runs it over all three, so a
 * record that names a module nobody registered, a theme that is gone, a room that is not a room, or a
 * layout that would silently drop one of its own modules fails a check rather than a person's screen.
 * `knownTypes` (optional): the registered module types.
 */
export function recordProblems(rec, { knownTypes = null } = {}) {
  const out = [];
  if (!rec || typeof rec !== 'object') return ['not a record'];
  if (!rec.key || !PREBUILT_DASHBOARDS[rec.key]) out.push(`unknown key ${rec.key}`);
  for (const k of ['label', 'name', 'blurb']) if (typeof rec[k] !== 'string' || !rec[k].trim()) out.push(`no ${k}`);
  const refs = {};
  const mods = Array.isArray(rec.modules) ? rec.modules : [];
  if (!mods.length) out.push('no modules');
  for (const m of mods) {
    if (!m || !m.ref || !m.type) { out.push('a module without a ref or a type'); continue; }
    if (refs[m.ref]) out.push(`ref ${m.ref} twice`);
    if (knownTypes && !knownTypes.has(m.type)) out.push(`${m.type} is not a registered module`);
    refs[m.ref] = `id-${m.ref}`;
  }
  const L = rec.layout || {};
  const usedRefs = [...(L.slots || []).filter(Boolean), ...(L.placed || []).map((p) => p.ref)];
  for (const r of usedRefs) if (!refs[r]) out.push(`the layout names ${r}, which is not one of its modules`);
  const lay = layoutFor(rec, refs);
  const kept = [...lay.slots.filter(Boolean), ...(lay.placed || []).map((p) => p.id)];
  if (kept.length !== usedRefs.length) out.push(`the layout keeps ${kept.length} of its ${usedRefs.length} modules`);
  if (L.scene) {
    if (L.scene.kind !== 'room') out.push(`scene ${L.scene.kind} is not a room`);
    else if (!ROOM_PRESETS[L.scene.preset]) out.push(`room ${L.scene.preset} does not exist`);
    if (!lay.scene) out.push('the scene does not survive normalizeLayout');
  }
  const s = rec.settings || {};
  if (!s.theme || !THEMES[s.theme]) out.push(`theme ${s.theme} does not exist`);
  if (!PANEL_SURFACES.includes(s.panelSurface)) out.push(`panel backgrounds ${s.panelSurface} is not one of ${PANEL_SURFACES.join('/')}`);
  return out;
}

/**
 * MAKING ONE, THE FIRST TIME IT IS PICKED. Over the four factories every page shares (the same ones
 * game/game.js takes), so signed in and signed out run this identical code:
 *   profiles                  the screens client: list, get, create, addModule
 *   makeSettings(pid)         a screen's settings doc
 *   makeInstanceState(pid, id) one module instance's state
 *   personId(), personName()  whose they are (read when used; a kiosk learns them after it boots)
 * Returns { made(list), offered(list), ensure(key), stampOf(pid) }.
 */
export function createDashboardMaker({ profiles, makeSettings, makeInstanceState,
                                       personId = () => '', personName = () => '' } = {}) {
  if (!profiles || typeof makeSettings !== 'function' || typeof makeInstanceState !== 'function') {
    throw new Error('createDashboardMaker: profiles, makeSettings and makeInstanceState are required');
  }
  const read = (v) => { try { return (typeof v === 'function' ? v() : v) || ''; } catch { return ''; } };
  const stamps = new Map();          // pid -> { key, refs, done } | null   (read once per screen)
  const inflight = new Map();        // key -> Promise: a second pick while the first is making it waits

  async function withDoc(handle, fn) {
    await Promise.resolve(handle?.load?.()).catch(() => {});
    try {
      const out = await fn(handle);
      await Promise.resolve(handle?.flush?.()).catch(() => {});
      return out;
    } finally { try { handle?.destroy?.(); } catch { /* gone */ } }
  }
  const readDoc = (pid) => withDoc(makeSettings(pid), (h) => ({ ...(h?.get?.() || {}) }));
  const patchDoc = (pid, fn) => withDoc(makeSettings(pid), (h) => { h.set(fn(h.get?.() || {})); });

  async function stampOf(pid) {
    if (stamps.has(pid)) return stamps.get(pid);
    let s = {};
    try { s = await readDoc(pid); } catch { s = {}; }
    const st = typeof s[PREBUILT_KEY] === 'string' && PREBUILT_DASHBOARDS[s[PREBUILT_KEY]]
      ? { key: s[PREBUILT_KEY], refs: { ...(s[PREBUILT_REFS_KEY] || {}) }, done: s[PREBUILT_DONE_KEY] === true }
      : null;
    stamps.set(pid, st);
    return st;
  }
  // This person's screens only: a room made for somebody else on the account is not this person's room.
  const mine = (s) => !read(personId) || !s.person_id || s.person_id === read(personId);

  /** key -> { id, name, done } for each ready-made one this person already has (the first, if two). */
  async function made(list) {
    const out = {};
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || !s.id || !mine(s)) continue;
      const st = await stampOf(s.id);
      if (st && !out[st.key]) out[st.key] = { id: s.id, name: s.name, done: st.done };
    }
    return out;
  }
  /** The keys still to offer, in PREBUILT_ORDER. Reads; never makes anything. */
  async function offered(list) {
    const m = await made(list);
    return PREBUILT_ORDER.filter((k) => !m[k]);
  }

  async function build(key) {
    let list = [];
    try { list = (await profiles.list()) || []; } catch { list = []; }
    const have = (await made(list))[key];
    if (have && have.done) return { id: have.id, created: false };
    const rec = prebuiltRecord(key, { personName: read(personName) });
    let pid = have ? have.id : null;
    let created = false;
    if (!pid) {
      const s = await profiles.create(rec.name, read(personId));
      pid = s.id; created = true;
      // STAMP FIRST: from here on, a page that dies half-way leaves a screen the next pick finishes.
      await patchDoc(pid, () => ({ [PREBUILT_KEY]: key, [PREBUILT_REFS_KEY]: {} }));
      stamps.set(pid, { key, refs: {}, done: false });
    }
    const screen = await profiles.get(pid);
    const ids = new Set(((screen && screen.modules) || []).map((m) => m.id));
    const doc = await readDoc(pid);
    const refs = { ...(doc[PREBUILT_REFS_KEY] || {}) };
    for (const m of rec.modules) {
      if (refs[m.ref] && ids.has(refs[m.ref])) continue;
      const mod = await profiles.addModule(pid, m.type);
      // Its starting settings go in BEFORE anything can mount it (game/game.js's order).
      if (m.state) await withDoc(makeInstanceState(pid, mod.id), (h) => { h.set({ ...m.state }); });
      refs[m.ref] = mod.id;
      await patchDoc(pid, () => ({ [PREBUILT_REFS_KEY]: { ...refs } }));
    }
    const layout = layoutFor(rec, refs);
    // DONE LAST, with the arrangement and the look, in one write.
    await patchDoc(pid, (cur) => ({
      ...rec.settings,
      kiosk: { ...(cur.kiosk || {}), layout },
      [PREBUILT_KEY]: key, [PREBUILT_REFS_KEY]: { ...refs }, [PREBUILT_DONE_KEY]: true,
    }));
    stamps.set(pid, { key, refs: { ...refs }, done: true });
    return { id: pid, created };
  }

  /** The ready-made dashboard `key` for this person: found if they have it, made (once) if not.
   *  Resolves { id, created }. Two picks at once make ONE (the second waits on the first). */
  function ensure(key) {
    if (!PREBUILT_DASHBOARDS[key]) return Promise.reject(new Error(`no ready-made dashboard called "${key}"`));
    if (inflight.has(key)) return inflight.get(key);
    const p = build(key).finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  return { made, offered, ensure, stampOf, forget: (pid) => stamps.delete(pid) };
}

// =====================================================================================================
// SPOKEN: "computer please go to my room" -- input_speech.js's ROUTES shape, added at runtime the way the
// music favourites are (kiosk.js `applyDashboards`), never written into anybody's bindings.
// =====================================================================================================

/** Payload `{ id }` (a dashboard) or `{ prebuilt: '<key>' }` (a ready-made one: found, or made once).
 *  Defined in dashboard_nest.js since row 2.38 (the room, the arrangement and the dashboard module publish
 *  it too, and that file imports nothing); re-exported here, where it has always been imported from. */
export const DASHBOARD_GO_TOPIC = NEST_GO_TOPIC;
// "go to" / "open" + the dashboard's name. A setting would be the next step (music's are); argued: two
// starters cover what people say, and a third ("show") collides with "show the menu"-shaped commands.
export const DEFAULT_GO_STARTERS = Object.freeze(['go to', 'open']);

// The ready-made ones, by phrase, whether or not they exist yet ("go to my room" makes it the first time:
// that IS picking it). Four words at most, plain lowercase (speech_test's rule for every route).
// [unverified on the bench: "dashboards" and "classic" in the small Vosk model.]
export const PREBUILT_ROUTES = Object.freeze({
  'dashboard-room': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'room' }, label: 'Go to the room',
    phrases: ['go to my room', 'go to the room', 'show me my room', 'open my room'] },
  'dashboard-basic': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'basic' }, label: 'Go to the basic dashboard',
    phrases: ['go to basic', 'basic dashboard', 'open basic'] },
  'dashboard-classic': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'classic' }, label: 'Go to the classic dashboard',
    phrases: ['go to classic', 'classic dashboard', 'open classic'] },
  // The picker itself: the same `system/dashboards` a switch or a room's object sends.
  'dashboard-picker': { topic: SYSTEM_TOPICS.dashboards, payload: {}, label: 'Choose a dashboard',
    phrases: ['my dashboards', 'show my dashboards', 'choose a dashboard', 'change dashboard'] },
});

// *** ROW 2.38: THE WAY BACK, SPOKEN. *** Once an object can open another dashboard a person can be several
// dashboards deep, and "the way back is always there" (chat's §7.3.4) has to include the voice.
//   "go back" ALREADY EXISTS -- it is the `back` verb (input_speech.js PHRASES), and it is reused: kiosk.js
//     sends an UNANSWERED `back` (the panel in front of you has nothing to cancel) back along the trail. So
//     these are only the phrases that cannot mean anything else: "previous dashboard", "go home".
//   "go home" is new: nothing else said it. Home = the dashboard this screen started on.
// [unverified on the bench: "dashboard" in the small Vosk model, as for the routes above.]
export const NAV_ROUTES = Object.freeze({
  'dashboard-back': { topic: SCREEN_BACK_TOPIC, payload: {}, label: 'Back to the previous dashboard',
    phrases: ['previous dashboard', 'last dashboard', 'back a dashboard', 'go back a dashboard'] },
  'dashboard-home': { topic: SCREEN_HOME_TOPIC, payload: {}, label: 'Home: the dashboard this screen started on',
    phrases: ['go home', 'go to home', 'take me home', 'home dashboard'] },
});

const ACTION_SAFE = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 36);

/**
 * THE PERSON'S DASHBOARDS AS SPOKEN ROUTES, plus the ready-made ones. Returns `{ routes, skipped }`
 * (music_favourites.js's shape). `list` is what the picker lists ([{ id, name }]).
 *
 * *** A DASHBOARD'S OWN NAME WINS OVER A READY-MADE PHRASE. *** The person's dashboards are made first;
 * a ready-made phrase already taken by one of them is dropped from the ready-made route. So somebody
 * who has their own screen called "My room" goes to THEIRS on "go to my room", never to a new room made
 * behind their back. (A made room is itself called "My room", so the two then agree.)
 * `taken`: every phrase already spoken for (default: input_speech's verbs and routes). Nothing made here
 * can duplicate one -- `duplicatePhrases` over the combined table stays empty.
 */
export function dashboardSpeechRoutes(list, { starters = DEFAULT_GO_STARTERS, taken = spokenTable(PHRASES, ROUTES),
                                              prebuilt = true, nav = true } = {}) {
  const used = new Map();
  for (const [id, phrases] of Object.entries(taken || {})) {
    for (const p of Array.isArray(phrases) ? phrases : []) { const k = normalize(p); if (k) used.set(k, `taken:${id}`); }
  }
  const routes = {};
  const skipped = [];
  const starts = (Array.isArray(starters) ? starters : [starters]).map(normalize).filter(Boolean);
  const seenIds = new Set();
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || !d.id) continue;
    let rid = `dashboard-go-${ACTION_SAFE(d.id)}`;
    if (seenIds.has(rid)) continue;
    seenIds.add(rid);
    const n = String(d.name || '').trim();
    if (!n) continue;
    if (/\d/.test(n)) { skipped.push({ name: n, phrase: null, why: 'digits' }); continue; }
    const nn = normalize(n);
    if (nn.replace(/ /g, '').length < 3) { skipped.push({ name: n, phrase: null, why: 'short' }); continue; }
    const phrases = [];
    for (const st of starts) {
      const p = `${st} ${nn}`;
      const owner = used.get(p);
      if (owner === rid) continue;
      if (owner) { skipped.push({ name: n, phrase: p, why: owner.startsWith('taken:') ? 'taken' : 'twice' }); continue; }
      used.set(p, rid);
      phrases.push(p);
    }
    if (phrases.length) routes[rid] = { topic: DASHBOARD_GO_TOPIC, payload: { id: d.id, name: n }, label: `Go to ${n}`, phrases };
  }
  const tables = [...(prebuilt ? [PREBUILT_ROUTES] : []), ...(nav ? [NAV_ROUTES] : [])];
  for (const table of tables) {
    for (const [rid, r] of Object.entries(table)) {
      const phrases = r.phrases.filter((p) => { const k = normalize(p); if (used.has(k)) return false; used.set(k, rid); return true; });
      if (phrases.length) routes[rid] = { ...r, payload: { ...r.payload }, phrases };
    }
  }
  return { routes, skipped };
}

/** The routes as actions (input_speech's SPEECH_ACTIONS shape), for `registry.registerAll`. */
export function dashboardSpeechActions(routes) {
  return Object.entries(routes || {}).map(([id, r]) => ({
    id: routeAction(id), label: r.label, topic: r.topic, payload: r.payload, group: 'Spoken',
  }));
}

/** The routes' bindings (input_speech's ROUTE_BINDINGS shape): runtime extras, never saved. */
export function dashboardSpeechBindings(routes) {
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

/** What the routes make speakable, so a host re-attaches speech only when it changed. */
export function dashboardsSignature(routes) {
  return JSON.stringify(Object.entries(routes || {}).map(([id, r]) => [id, r.phrases]).sort());
}

// =====================================================================================================
// THE ONE SETTING (Rule 1): whether the picker offers the ready-made ones at all. ON by default -- they
// are how anybody finds them; OFF for a screen whose person scans by switch and does not want three more
// stops in the tray (each made one is still in the list, as any dashboard is).
// =====================================================================================================
export const DASHBOARD_OFFERS_KEY = 'dashboardOffers';
export const DASHBOARD_OFFERS_FIELD = Object.freeze({
  key: DASHBOARD_OFFERS_KEY, label: 'Offer the ready-made dashboards (Room, Basic, Classic 2D) under Home',
  kind: 'toggle', level: 'advanced', default: true, onLabel: 'Yes', offLabel: 'No',
});
export const offersOn = (row) => !(row && row[DASHBOARD_OFFERS_KEY] === false);
