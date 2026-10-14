// voice_open.js — A MODULE ASKED FOR BY VOICE OPENS: FULL SCREEN FOR NOW, OR WHERE IT WAS PUT (Mike, 2026-10-12).
//
// Mike (public DECISIONS, 40c5889, reversing 7f589ea's choice): *"When I ask the computer to play trivia, it says
// Trivia is not on this screen. I would like it to just pull up a full screen dashboard of whatever module I ask for,
// unless you specify something else like 'trivia bottom right corner' or whatever."*
//
// input_speech.js HEARS "open / show / pull up <module> [place]", "<module> <place>" (SPEECH_OPEN_TOPIC), and play_as.js
// hears "play <game> [as ...] [place]". THIS FILE DECIDES what opens, where, and when it goes again:
//
//   1. WHICH MODULES (`moduleEntries`): the Modules library's own list - the catalog's titles (modules_catalog.js) - plus
//      play_as.js's short names (GAME_SPOKEN), a few of its own (MODULE_SPOKEN), and "Other names it listens for" on the
//      Players tab. A module the library does not offer (NOT_FOR_CAREGIVERS: test panels, the keyboard device...) is
//      KNOWN, so it can be said plainly - "<name> does not open by voice." - and never opened.
//   2. A GAME goes through play_as.js (`play`), so "open trivia" and "play trivia" are one thing: the same players, the
//      same read-back. It calls `open()` here when the game is not on the screen, or a place was named.
//   3. ON THE SCREEN ALREADY, NO PLACE NAMED: today's behaviour. A game starts where it is (play_as.js); anything else is
//      chosen (the switch moves to it) and the screen says it is there. A place named always opens it there.
//   4. OPENING (`open`): checked first (`allowed`: the Nimrod Game's locks, a call in progress), SAID ("Opening Trivia."),
//      then mounted in a box over the dashboard - the whole screen, or a quarter, half or the middle (`placeBox`). The
//      dashboard underneath is never changed: nothing is added to it, nothing replaced, nothing saved. Full screen, its
//      panels are hidden (`onHide`, as for any hidden panel - a video pauses or mutes as its own setting says) and shown
//      again after. The box is the only stop in the switch lap while it shows (`ring`).
//   5. GOING BACK (`close`). *** A SCREEN MUST NEVER ENTER A STATE THAT ONLY AN INPUT CAN LEAVE, WHEN THE PERSON IN FRONT
//      OF IT CANNOT GIVE THAT INPUT (CLAUDE.md, signed off 2026-08-28). *** So every way back below, and the first two need
//      nobody:
//        (a) said: "go back", "close it", "back to the pictures", and the rest of VOICE_BACK_PHRASES, while it shows;
//        (b) BY ITSELF when it goes quiet (the quiet rule below);
//        (c) the bar's Smaller (and Escape, and "make it smaller"), which already mean "one level back down" - kiosk.js
//            counts this box as a level up;
//        (d) a press of a switch's Back on a module that has nothing for Back (kiosk.js backUnhandled).
//      And it never survives a reload or a restart: nothing was saved, so restart.js opens the chosen dashboard.
//
// *** THE QUIET RULE (b), ARGUED. ***
//   * A GAME says when it is being played (game_start.js createPlayWatch: PLAY_STATE_TOPIC). While it says "playing" the
//     box stays. When it comes to REST (nobody pressed for GAME_IDLE_MS, 5 minutes, or the sitting ended) the box goes
//     REST_LINGER_MS later - long enough to read a last score, the same 20 s the call view's game keeps.
//   * A VIDEO OR A SLIDESHOW says "playing" too (photos.js, youtube.js report it), and stays while it plays. ARGUED: a
//     film somebody asked for is not cut off because nobody pressed anything, and a running slideshow is content, not a
//     gate; it goes when it stops playing. AGAINST: a playlist that never ends covers the dashboard until somebody says
//     "go back" - but so would a YouTube panel the person put on their own dashboard. [On Mike's list.]
//   * ANYTHING ELSE, and a game nobody started: it goes after `voiceOpenQuietMs` with nothing pressed (a key, a switch,
//     a tap or a click in the box, an answer said aloud). Default 2 minutes, a setting:
//       FOR shorter (30 s, 1 min): the dashboard is what this screen is FOR - often somebody's photos - and every minute
//       a clock asked for in passing covers them is a minute they are not there.
//       FOR longer (5, 10, 30 min): somebody reading a long note, or thinking over a calculator, gets it taken away; they
//       can say it again, but a screen that keeps undoing what was asked for is tiring.
//       2 minutes: the same as the screen's own "somebody pressed" hold (game_start.js names it: 2 minutes), and short
//       enough that a module opened and forgotten is gone before anybody wonders where the dashboard went.
//     There is no "never": that is the state only an input can leave.
//
// *** EVERY DEFAULT, ARGUED (Rule 1). Each is a row on the ⚙ menu's This screen tab, under "Asked for by voice". ***
//   where 'full'     Mike's ruling. 'corner' for a household that wants the dashboard to stay in view; 'off' is the old
//                    behaviour ("<name> is not on this screen") for one that wants nothing opened by voice at all.
//   corner 'br'      "In the corner" means bottom right: Mike's own example, and the corner nothing else sits in by
//                    default (the camera's mirror is top right, the small clock bottom left - arrangement.js KDEF).
//   quietMs 2 min    above.
//   sayBack on       Mike asked for it ("Opening Trivia."). Off: the confirmation tone only, as play_as's read-back.
// The constants, argued where they stand: REST_LINGER_MS; the region sizes (`placeBox`).
//
// *** "KEEP IT" IS NOT BUILT, ARGUED. *** Mike's "unless they say so, e.g. keep it". FOR: one sentence to make a corner
// Trivia part of the dashboard for good. AGAINST, and it wins for now: (1) "keep it" is two words said in passing far
// more often than to a screen ("keep it down", "keep it going" are near it), and here it would WRITE the person's
// dashboard - add a module, save a layout - which a near miss must never do; (2) the dashboard's own "Over the dashboard"
// (the Modules library, kiosk.js overlayHere) already does it by a press, with the dashboard's own undo; (3) a full-screen
// one has no dashboard shape to keep - it would be a new dashboard, named by nobody. [On Mike's list: if wanted, "keep
// it" would call overlayHere for a placed one, and only after a "did you mean" question.]
//
// Site copy here never names anybody: "the screen", "the dashboard", "this screen".

import { normalize, SPEECH_OPEN_TOPIC, SPEECH_ANSWER_TOPIC } from './input_speech.js';
import { GAME_SPOKEN, spokenNamesFrom, isGame, SAY_TTL_MS } from './play_as.js';
import { PLAY_STATE_TOPIC } from './game_start.js';
import { VERBS, FOCUS_VERBS, MEDIA_VERBS, ACTION_VERBS, verbTopic } from './actions.js';
import { CATALOG, NOT_FOR_CAREGIVERS, titleFor, stageOf } from './modules_catalog.js';
import { splitStages } from './beta.js';

export const VOICE_OPEN_WHERE = Object.freeze(['full', 'corner', 'off']);
export const VOICE_OPEN_CORNERS = Object.freeze(['tl', 'tr', 'bl', 'br']);
export const VOICE_OPEN_QUIET_MS = Object.freeze([30000, 60000, 120000, 300000, 600000, 1800000]);
export const VOICE_OPEN_DEFAULTS = Object.freeze({ where: 'full', corner: 'br', quietMs: 120000, sayBack: true });
// After a game comes to rest, how long its last screen stays before the dashboard comes back. ARGUED as a constant: the
// same 20 s the call view keeps a finished game (kiosk.js CALL_GAME_LINGER_MS, = quiz_mix.js NOTE_MS): read, then gone.
// Nobody in a room can judge it, and the quiet setting above is the one that matters.
export const REST_LINGER_MS = 20000;
// What the box and its own settings row are called. The row is one per module type, so a Trivia opened by voice comes
// back the way it was left last time (its own settings, "every Trivia panel" under them), and never a dashboard panel's.
export const VOICE_OPEN_ID_PREFIX = 'voice:';
export const VOICE_OPEN_ROW_PREFIX = 'voice-open-';
// Told whenever it opens or closes ({ open, id?, type?, place?, why? }), for the suites and anything that wants to know.
export const VOICE_OPEN_TOPIC = 'shell/voice-open';

// The places input_speech.js hears, and the box each is. A quarter (a corner), a half, the middle quarter, or the whole
// screen. ARGUED, one size rule for all: every named place is half a side or the whole of it - the same boxes a 2x2 and a
// side-by-side dashboard already have, so a module made for a panel reads in it, and nothing needs a size setting.
// AGAINST: a smaller corner (a third) would cover less of the photos; but a game in a ninth of a screen is unplayable
// from a bed, which is where a corner game is most likely asked for. [On Mike's list.]
export const PLACE_BOXES = Object.freeze({
  full: Object.freeze({ left: 0, top: 0, width: 100, height: 100 }),
  tl: Object.freeze({ left: 0, top: 0, width: 50, height: 50 }),
  tr: Object.freeze({ left: 50, top: 0, width: 50, height: 50 }),
  bl: Object.freeze({ left: 0, top: 50, width: 50, height: 50 }),
  br: Object.freeze({ left: 50, top: 50, width: 50, height: 50 }),
  left: Object.freeze({ left: 0, top: 0, width: 50, height: 100 }),
  right: Object.freeze({ left: 50, top: 0, width: 50, height: 100 }),
  top: Object.freeze({ left: 0, top: 0, width: 100, height: 50 }),
  bottom: Object.freeze({ left: 0, top: 50, width: 100, height: 50 }),
  middle: Object.freeze({ left: 25, top: 25, width: 50, height: 50 }),
});
export const PLACE_WORDS = Object.freeze({
  full: 'full screen', tl: 'in the top left corner', tr: 'in the top right corner', bl: 'in the bottom left corner',
  br: 'in the bottom right corner', left: 'on the left', right: 'on the right', top: 'at the top', bottom: 'at the bottom',
  middle: 'in the middle',
});

// Said "go back" (and the rest) while a module opened by voice shows: it goes. They are handed to the speech layer as
// the focused module's own phrases (kiosk.js), each pressing `close` - which no module answers, so it reaches the shell -
// and ONLY while the box shows: "go back" said anywhere else is the back verb it always was. ARGUED, against "go back"
// meaning the game's own back (skip this question) while it shows: Mike named it as a way back, and a switch's Back still
// skips (it is the module's own). Vocabulary [unverified on the bench]: common words.
export const VOICE_BACK_PHRASES = Object.freeze(['go back', 'close it', 'close that', 'back to the pictures',
  'back to the photos', 'back to the dashboard', 'back to my dashboard', 'put it away', 'all done', 'that is enough']);
/** `{ phrase: 'close' }` for the speech layer's scoped table. */
export function voiceBackTable() {
  const out = {};
  for (const p of VOICE_BACK_PHRASES) out[normalize(p)] = 'close';
  return out;
}

// A few short names of its own (a game's are play_as.js GAME_SPOKEN). Small on purpose; a name two modules answer to
// is dropped from both (input_speech.js playVocabulary). "you tube": what the small Vosk model writes.
export const MODULE_SPOKEN = Object.freeze({
  photos: Object.freeze(['pictures', 'photographs']),
  youtube: Object.freeze(['you tube']),
});

export const VOICE_OPEN_LINES = Object.freeze({
  open: 'Opening {name}.',
  openAt: 'Opening {name} {where}.',
  here: '{name} is on the screen.',
  unknown: 'I do not know a module called {heard}.',
  hidden: '{name} does not open by voice.',
  locked: '{name} is locked. It can be unlocked in the Modules library.',
  call: '{name} can open after the call.',
  notHere: '{name} is not on this screen.',
  failed: '{name} could not start. Nothing on the screen changed.',
});

/** The settings rows (the screen's own row, on the ⚙ menu's This screen tab). */
export const VOICE_OPEN_FIELDS = Object.freeze([
  Object.freeze({ key: 'voiceOpenWhere', label: 'A module asked for by voice that is not on the dashboard opens',
    kind: 'choice', default: VOICE_OPEN_DEFAULTS.where, level: 'standard',
    options: [
      { value: 'full', label: 'Full screen, for now' },
      { value: 'corner', label: 'In the corner, for now' },
      { value: 'off', label: 'Not at all (it says it is not on this screen)' },
    ],
    note: 'Say where to put it: “trivia in the corner”, “on the left”, “top half”, “in the middle”. Nothing is saved, '
      + 'and the dashboard comes back when you say “go back”, by itself when it goes quiet, or with the bar’s Smaller.' }),
  Object.freeze({ key: 'voiceOpenCorner', label: '“In the corner” means', kind: 'choice',
    default: VOICE_OPEN_DEFAULTS.corner, level: 'advanced',
    options: [
      { value: 'tl', label: 'Top left' }, { value: 'tr', label: 'Top right' },
      { value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' },
    ] }),
  Object.freeze({ key: 'voiceOpenQuietMs', label: 'It goes back by itself after nothing is pressed or played for',
    kind: 'choice', default: VOICE_OPEN_DEFAULTS.quietMs, level: 'standard',
    options: [
      { value: 30000, label: '30 seconds' }, { value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' },
      { value: 300000, label: '5 minutes' }, { value: 600000, label: '10 minutes' }, { value: 1800000, label: '30 minutes' },
    ],
    note: 'A game being played, or a video playing, stays until it stops.' }),
  Object.freeze({ key: 'voiceOpenSayBack', label: 'Say what is opening', kind: 'toggle',
    default: VOICE_OPEN_DEFAULTS.sayBack, level: 'advanced', onLabel: 'Yes', offLabel: 'No, just the tone' }),
]);

/** `{ where, corner, quietMs, sayBack }` from a settings row; anything unset or broken is its default. Pure. */
export function voiceOpenOptionsFrom(values = {}) {
  const v = values || {};
  const q = Number(v.voiceOpenQuietMs);
  return {
    where: VOICE_OPEN_WHERE.includes(v.voiceOpenWhere) ? v.voiceOpenWhere : VOICE_OPEN_DEFAULTS.where,
    corner: VOICE_OPEN_CORNERS.includes(v.voiceOpenCorner) ? v.voiceOpenCorner : VOICE_OPEN_DEFAULTS.corner,
    quietMs: VOICE_OPEN_QUIET_MS.includes(q) ? q : VOICE_OPEN_DEFAULTS.quietMs,
    sayBack: typeof v.voiceOpenSayBack === 'boolean' ? v.voiceOpenSayBack : VOICE_OPEN_DEFAULTS.sayBack,
  };
}

/** Where a request goes: a place id of PLACE_BOXES, or null (the setting is 'off' and nothing was named). Pure. */
export function placeFor(asked, opts = VOICE_OPEN_DEFAULTS) {
  const o = { ...VOICE_OPEN_DEFAULTS, ...(opts || {}) };
  if (asked === 'corner') return o.corner;
  if (asked && PLACE_BOXES[asked]) return asked;
  if (o.where === 'full') return 'full';
  if (o.where === 'corner') return o.corner;
  return null;
}

/** The box for a place, as CSS percentages of the screen. Unknown: the whole screen. Pure. */
export function placeBox(place) {
  return { ...(PLACE_BOXES[place] || PLACE_BOXES.full) };
}

const fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));

/**
 * The modules as the speech layer is given them: [{ id, type, name, names, here, hidden? }]. Every catalog module that
 * is registered here (`manifests`), named by its title and its short names; `hidden` for one the library leaves out.
 * `here`: a panel of that type is on the screen now. Pure.
 */
export function moduleEntries({ manifests = [], catalog = CATALOG, notFor = NOT_FOR_CAREGIVERS, here = new Set(),
  spoken = [] } = {}) {
  const reg = new Map((manifests || []).filter((m) => m && m.type).map((m) => [m.type, m]));
  const out = [];
  const seen = new Set();
  const add = (type, title, hidden) => {
    if (seen.has(type) || !reg.has(type)) return;
    seen.add(type);
    const m = reg.get(type);
    const names = [title, m.title, ...(GAME_SPOKEN[type] || []), ...(MODULE_SPOKEN[type] || [])]
      .map((n) => normalize(n)).filter(Boolean);
    out.push({ id: type, type, name: String(title || m.title || type), names: [...new Set(names)], here: here.has(type),
               stage: stageOf(type, catalog), ...(hidden ? { hidden: true } : {}) });
  };
  // LIVE AND BETA (2026-10-14): live modules first, like every other list of them, and each entry says its stage. A
  // beta module still opens by voice when its name is said: hiding beta things is about the lists you choose from, and
  // a name said out loud is a choice already made.
  const offered = (catalog || []).filter((c) => c && c.type && !(notFor || {})[c.type]);
  const { live, beta } = splitStages(offered, (c) => stageOf(c.type, catalog));
  for (const c of [...live, ...beta]) add(c.type, titleFor(c, manifests || []), false);
  for (const type of Object.keys(notFor || {})) add(type, reg.get(type)?.title || type, true);
  for (const { name, said } of spoken || []) {
    for (const e of out) if (e.names.includes(name) || normalize(e.name) === name) e.names = [...e.names, said];
  }
  return out.filter((e) => e.names.length);
}

// The style a box is drawn with, once per page.
const CSS_ID = 'k-voice-open-css';
function ensureCss(doc) {
  if (!doc || doc.getElementById(CSS_ID)) return;
  const s = doc.createElement('style');
  s.id = CSS_ID;
  // Full screen, the corner clock and the mirror step aside (as a panel made bigger to the screen has them do).
  s.textContent = `.kiosk[data-voice-open="full"] .k-mirror,.kiosk[data-voice-open="full"] .k-clock{visibility:hidden}
.k-voiceview>.k-mod{position:absolute;inset:0}`;
  doc.head.append(s);
}

/**
 * The host. Everything it is handed is read when it is needed (the shell builds most of it later).
 *   bus             the screen's bus: SPEECH_OPEN_TOPIC in; PLAY_STATE_TOPIC and the verbs read for the quiet rule
 *   parent()        the element the box goes in (the kiosk); `before()` the child it goes before (the mirror), or null
 *   zIndex          the box's depth (the shell's LAYERS.floating: above the panels, below the bar and the menus)
 *   manifests()     every registered module's manifest
 *   panels()        the dashboard's panels now: [{ id, type, title, instance }]
 *   values()        the screen's settings row (VOICE_OPEN_FIELDS, and play_as's "Other names it listens for")
 *   say(text, o)    the output bus's say
 *   allowed(type)   -> { ok, why? } or a promise of it: may this open here now ('locked', 'call')
 *   mount(mod, el)  -> a promise of the mounted record ({ id, type, instance, ... }): the shell's own mountInstance
 *   unmount(rec)    the shell's destroyRec
 *   hideUnder(on)   full screen: hide the dashboard's panels (true), show them again (false)
 *   focus           { get() -> the focused id, set(id) }: the switch's focus
 *   play(type, place)  a game, handed to play_as.js (`handle({ game: type, place })`)
 *   onChange()      told after it opens or closes (the bar redraws)
 */
export function createVoiceOpen({
  bus = null,
  parent = () => null,
  before = () => null,
  zIndex = 400,
  doc = (typeof document !== 'undefined' ? document : null),
  manifests = () => [],
  panels = () => [],
  values = () => ({}),
  say = null,
  allowed = () => ({ ok: true }),
  mount = null,
  unmount = null,
  hideUnder = null,
  focus = null,
  play = null,
  onChange = null,
  lines = VOICE_OPEN_LINES,
  restLingerMs = REST_LINGER_MS,
  // A suite's seam: the quiet time in ms instead of the setting's (the shortest choice is 30 s). null = the setting.
  quietMs = null,
  // A line said back this late describes something already on the screen: play_as.js SAY_TTL_MS, argued there.
  sayTtlMs = SAY_TTL_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const L = { ...VOICE_OPEN_LINES, ...(lines || {}) };
  const ask = (fn, d) => { try { const v = fn(); return v == null ? d : v; } catch { return d; } };
  const opts = () => voiceOpenOptionsFrom(ask(values, {}));
  // The quiet time: the setting's, unless a suite handed its own (`quietMs`, milliseconds).
  const quietNow = () => (Number.isFinite(quietMs) && quietMs > 0 ? quietMs : opts().quietMs);
  let view = null;          // { id, type, name, place, box, rec, prevFocus, timer, playing, offs }
  let seq = 0;              // the newest open asked for; an older one still checking or mounting gives way to it
  let last = null;
  let torn = false;
  const offs = [];

  function speak(text) {
    if (!text || typeof say !== 'function') return;
    try { say(text, { source: 'voice-open', ttlMs: sayTtlMs }); } catch (err) { console.error('voice open: say', err); }
  }
  const tell = (payload) => { try { bus?.publish?.(VOICE_OPEN_TOPIC, payload); } catch { /* no bus */ } };
  const changed = () => { try { onChange?.(); } catch (err) { console.error('voice open: change', err); } };
  const panelList = () => (ask(panels, []) || []).filter((r) => r && r.id && r.type);

  function modules() {
    const here = new Set(panelList().map((r) => r.type));
    if (view) here.add(view.type);
    let spoken = [];
    try { spoken = spokenNamesFrom(ask(values, {}).playAsSpoken); } catch { spoken = []; }
    return moduleEntries({ manifests: ask(manifests, []) || [], here, spoken });
  }
  const nameOf = (type) => modules().find((e) => e.type === type)?.name
    || (ask(manifests, []) || []).find((m) => m && m.type === type)?.title || type;

  // ---- the quiet rule -------------------------------------------------------------------------------------------------
  function disarm(v) { if (v && v.timer != null) { try { clearTimer(v.timer); } catch { /* gone */ } v.timer = null; } }
  function arm(v, ms, why) {
    disarm(v);
    v.timer = setTimer(() => { v.timer = null; if (view === v) close(why); }, Math.max(0, ms));
  }
  /** Somebody pressed something while it shows: the quiet time starts again (not while it says it is playing). */
  function poke() {
    const v = view;
    if (!v || !v.rec || v.playing) return;
    arm(v, quietNow(), 'quiet');
  }

  /** What a SPEECH_OPEN_TOPIC request does. Returns what happened, for a suite. */
  function handle(req) {
    const r = req && typeof req === 'object' ? req : {};
    const done = (result, line = null) => { if (line) speak(line); last = { ...result, line }; return last; };
    const list = modules();
    const entry = r.module ? list.find((e) => e.id === r.module) : null;
    if (!entry) return done({ opened: false, why: 'unknown' }, fill(L.unknown, { heard: r.moduleHeard || 'that' }));
    if (entry.hidden) return done({ opened: false, why: 'hidden', type: entry.type }, fill(L.hidden, { name: entry.name }));
    const place = typeof r.place === 'string' && r.place ? r.place : null;
    // A GAME: play_as.js decides who plays, and opens it here (or starts it where it is).
    let m = null;
    try { m = (ask(manifests, []) || []).find((x) => x && x.type === entry.type) || null; } catch { m = null; }
    if (isGame(m) && typeof play === 'function') {
      let res = null;
      try { res = play(entry.type, place); } catch (err) { console.error('voice open: play', err); res = null; }
      // null: play_as.js has no entry for it (every name of it is a fixed route's) - it is opened plainly below.
      if (res) { last = { opened: !!res.started, via: 'play', type: entry.type, place, line: res.line ?? null }; return last; }
    }
    if (!place) {
      if (view && view.type === entry.type) { last = { opened: true, why: 'open', type: entry.type, id: view.id, line: null }; return last; }
      const recs = panelList().filter((x) => x.type === entry.type);
      if (recs.length) {
        // On the dashboard already: shown and chosen. A box over it goes first ("show the pictures" is the way back).
        if (view) close('asked');
        try { focus?.set?.(recs[0].id); } catch (err) { console.error('voice open: focus', err); }
        return done({ opened: false, why: 'here', type: entry.type, id: recs[0].id }, fill(L.here, { name: entry.name }));
      }
    }
    const res = open(entry.type, { place, name: entry.name });
    last = { opened: !!res.ok, why: res.why || null, type: entry.type, place, opening: !!res.ok, line: null };
    return last;
  }

  /**
   * Open `type` over the dashboard. `place`: a PLACE_BOXES id or 'corner', or null (the setting's default). `line`: a
   * line to say instead of "Opening <name>." (play_as's read-back, when players were named); `quiet`: say nothing.
   * Returns { ok, why?, ready } at once: `ready` resolves to the mounted record, or null when it did not open (said why).
   */
  function open(type, { place = null, name = null, line = null, quiet = false } = {}) {
    if (torn) return { ok: false, why: 'gone', ready: Promise.resolve(null) };
    const o = opts();
    const nm = name || nameOf(type);
    const where = placeFor(place, o);
    if (!where) { speak(fill(L.notHere, { name: nm })); return { ok: false, why: 'off', ready: Promise.resolve(null) }; }
    if (typeof mount !== 'function' || !doc || !ask(parent, null)) {
      speak(fill(L.failed, { name: nm }));
      return { ok: false, why: 'no-host', ready: Promise.resolve(null) };
    }
    const mine = ++seq;
    const ready = (async () => {
      let a = { ok: true };
      // A check that cannot be made does not stop it: the locks' own reading offline is "nothing locked" (unlocks.js).
      try { a = (await allowed(type)) || { ok: true }; } catch (err) { console.error('voice open: allowed', err); a = { ok: true }; }
      if (mine !== seq || torn) return null;
      if (!a.ok) {
        const t = a.why === 'locked' ? L.locked : a.why === 'call' ? L.call : a.why === 'hidden' ? L.hidden : L.failed;
        speak(fill(t, { name: nm }));
        last = { ...(last || {}), opened: false, why: a.why || 'refused', type };
        return null;
      }
      // SAID BEFORE IT OPENS (Mike: "Opening Trivia."), with where, when that is not the whole screen.
      if (!quiet && o.sayBack) {
        const w = where === 'full' ? '' : PLACE_WORDS[where];
        speak(line ? (w ? `${String(line).replace(/[.!]\s*$/, '')} ${w}.` : line)
          : w ? fill(L.openAt, { name: nm, where: w }) : fill(L.open, { name: nm }));
      }
      if (view) close('replaced');
      return mountView(type, nm, where);
    })();
    return { ok: true, ready };
  }

  async function mountView(type, nm, where) {
    ensureCss(doc);
    const id = `${VOICE_OPEN_ID_PREFIX}${type}`;
    const b = placeBox(where);
    const box = doc.createElement('div');
    box.className = 'k-voiceview mod-box';
    box.dataset.voiceView = where;
    box.dataset.kind = type;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', `${nm}, opened by voice`);
    const full = where === 'full';
    box.style.cssText = `position:absolute;left:${b.left}%;top:${b.top}%;width:${b.width}%;height:${b.height}%;`
      + `z-index:${zIndex};pointer-events:auto;overflow:hidden;background:var(--bg);box-sizing:border-box;`
      + (full ? '' : 'border:2px solid var(--border);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);');
    const host = doc.createElement('div');
    host.className = 'k-mod';
    box.append(host);
    const p = ask(parent, null);
    const bf = ask(before, null);
    if (bf && bf.parentNode === p) p.insertBefore(box, bf); else p.append(box);
    try { p.dataset.voiceOpen = full ? 'full' : 'region'; } catch { /* not an element */ }
    const v = { id, type, name: nm, place: where, box, rec: null, prevFocus: null, timer: null, playing: false, offs: [] };
    try { v.prevFocus = focus?.get?.() || null; } catch { v.prevFocus = null; }
    view = v;
    if (full) { try { hideUnder?.(true); } catch (err) { console.error('voice open: hide the dashboard', err); } }
    // Anything pressed in the box counts as somebody being there (capture: before the module acts, harmless either way).
    const onPress = () => poke();
    for (const ev of ['pointerdown', 'keydown']) { box.addEventListener(ev, onPress, true); v.offs.push(() => box.removeEventListener(ev, onPress, true)); }
    let rec = null;
    try {
      rec = await mount({ id, type, stateKey: `${VOICE_OPEN_ROW_PREFIX}${type}` }, host);
    } catch (err) {
      console.error('voice open: the module would not start', err);
      rec = null;
    }
    if (view !== v) { if (rec) { try { unmount?.(rec); } catch { /* gone */ } } return null; }
    if (!rec) { speak(fill(L.failed, { name: nm })); close('failed'); return null; }
    v.rec = rec;
    try { focus?.set?.(id); } catch (err) { console.error('voice open: focus', err); }
    arm(v, quietNow(), 'quiet');
    tell({ open: true, id, type, place: where });
    changed();
    return rec;
  }

  /** It goes, and the screen is as it was. `why` for a suite: 'said', 'quiet', 'rest', 'bar', 'replaced', ... */
  function close(why = 'closed') {
    const v = view;
    if (!v) return false;
    view = null;
    disarm(v);
    for (const f of v.offs.splice(0)) { try { f(); } catch { /* gone */ } }
    if (v.rec) { try { unmount?.(v.rec); } catch (err) { console.error('voice open: closing', err); } }
    try { v.box.remove(); } catch { /* gone */ }
    const p = ask(parent, null);
    try { if (p && p.dataset) delete p.dataset.voiceOpen; } catch { /* gone */ }
    if (v.place === 'full') { try { hideUnder?.(false); } catch (err) { console.error('voice open: show the dashboard', err); } }
    if (v.prevFocus && !torn) { try { focus?.set?.(v.prevFocus); } catch { /* the panel went meanwhile */ } }
    last = { ...(last || {}), closed: why };
    tell({ open: false, id: v.id, type: v.type, why });
    if (!torn) changed();
    return true;
  }

  // ---- listening ----------------------------------------------------------------------------------------------------
  const sub = (topic, fn) => { try { const off = bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
  sub(SPEECH_OPEN_TOPIC, (p) => { handle(p); });
  // A game (or a video, a slideshow) says whether it is playing: the quiet rule above.
  sub(PLAY_STATE_TOPIC, (p) => {
    const v = view;
    if (!v || !p || p.id !== v.id) return;
    if (p.playing) { v.playing = true; disarm(v); return; }
    v.playing = false;
    if (p.rest) arm(v, restLingerMs, 'rest');
    else arm(v, quietNow(), 'quiet');
  });
  // A press of anything - a switch, a key, a verb said - or an answer said aloud, while it shows.
  for (const vb of [...VERBS, ...FOCUS_VERBS, ...MEDIA_VERBS, ...ACTION_VERBS]) {
    if (vb && vb.id && vb.id !== 'close') sub(verbTopic(vb.id), () => poke());
  }
  sub(SPEECH_ANSWER_TOPIC, () => poke());

  return {
    handle,
    open,
    close,
    poke,
    modules,
    isOpen: () => !!view,
    /** What is open ({ id, type, place, name }), or null. */
    current: () => (view ? { id: view.id, type: view.type, place: view.place, name: view.name, mounted: !!view.rec } : null),
    /** The mounted record, shaped like a dashboard panel's, or null. */
    rec: () => (view && view.rec ? view.rec : null),
    /** The switch lap: while it shows, it is the only stop; else the dashboard's own. */
    ring: (list) => (view ? [{ id: view.id, type: view.type }] : list),
    /** The speech layer's "go back" phrases, only while it shows. */
    backTable: () => (view ? voiceBackTable() : null),
    last: () => (last ? { ...last } : null),
    destroy() {
      torn = true;
      seq += 1;
      close('gone');
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
    },
  };
}
