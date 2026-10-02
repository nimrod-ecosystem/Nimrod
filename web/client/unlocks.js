// unlocks.js — THE NIMROD GAME: game / learning / sandbox mode, what is locked in it, and how a thing is
// unlocked (points, a free single unlock, or sandbox). Nimrod's node A (nimrod_guide_data.js `mode`) is
// where somebody meets it; Home's Add and Switch trays (modules.html) are where it gates; the settings
// page drawn here ("Nimrod Game") is where it is changed.
//
// Mike, 2026-10-02: *"Start using the site in game or learning mode (being game mode with separate
// education points) ... It would add a scoreboard somewhere and you would start getting points for doing
// things in the tutorial, and as a default everything you can build with is not unlocked, but mention that
// is just for the game's sake and they can switch to sandbox mode as far as unlocks go. When introducing
// points say that they have no real world value and we do not sell any form of coins or other
// microtransactions. Individual items should also be available for unlocks, if you don't want to use the
// points, but don't want to go to sandbox mode. Items can also be bought with the credit system we were
// going to have for points. It would also open up the Nimrod Game settings menu in the settings menu
// window ... If it's closed suggest opening it again or going to the tutorial dashboard."*
//
// =====================================================================================================
// THE DECISIONS, each argued, each a default (Rule 1) and on Mike's list:
//
// 1. THE MODE IS A CHOICE ON THE PROFILE'S `settings` DOCUMENT (`gameMode`), DEFAULT SANDBOX.
//    WHERE: the same reserved per-profile document theme and the lesson Quest/Sandbox switch already live
//    in (lessons.js PROFILE_SETTINGS_KEY argues that seam). The points ledger and the unlock log below are
//    per-profile streams too, so the mode, the points it pays into and what it has unlocked can never
//    disagree. COST, stated: a person with several dashboards has a mode per dashboard (the same scope the
//    points ledger already has); a person-wide mode is the "person level" the settings chain names, later.
//    DEFAULT SANDBOX: FOR game mode by default — Mike framed it as the tutorial's game. AGAINST, and it
//    wins: (a) register 257.2, "Sandbox is default for new profiles", is Mike's own ruling for the lesson
//    gate, and two modes with opposite defaults would be a trap; (b) a default of game mode would lock
//    things on every screen that already exists the day this ships, including screens set up for somebody
//    who cannot press "unlock"; (c) Mike: "start using the site in game or learning mode" — something you
//    start, i.e. opt in. So it is opted into from Nimrod's node A or the Nimrod Game page.
//
// 2. THE UNIT OF UNLOCK IS A MODULE TYPE ("module:<type>"), first. "Things you can build with" are modules,
//    scenes/rooms and bricks; modules first because: (a) they are the one thing with ONE add path (Home's
//    Add tray, and the Switch tray that adds in place) and a catalog to explain them from; (b) scenes are
//    also what a person picks for comfort and for less motion (a still scene, reduced motion), and locking
//    the calm option behind a game is the wrong trade; (c) bricks are published open models — printable
//    parts the site gives away — and a game lock on something given away is a lie about what it costs.
//    The key carries its kind so scenes ("scene:<id>") can join later as data, not a new mechanism.
//
// 3. UNLOCKS GATE ADDING, NEVER REMOVING. Nothing here can take a module off a screen, hide one, or stop
//    one running: a thing already on somebody's screen stays, whatever the mode. Only `check()` exists,
//    and only the Add tray and the add-in-place half of a switch ask it. Switching modes writes the mode
//    and nothing else (the suite holds it to that).
//
// 4. THE STARTER SET (never locked): see STARTER_ITEMS, each line with its reason. Communication is in it
//    because row 2.21 says the lesson gate "never gates communication", and this gate keeps the same rule.
//
// 5. COSTS. One number for every item (`unlockCost`, default 5), and the tour pays `tourStepPoints`
//    (default 1) per step, once each. A point is the ledger's atom, "~ one small win" (points.js); a tour
//    page read is a small win. The tour is ~30 steps, so a whole tour buys about six things — a real
//    handful, not everything (about thirty are locked). A price per item is a design pass, and Mike has
//    said games may get their own currencies; one number is the honest starting point.
//
// 6. "THE CREDIT SYSTEM WE WERE GOING TO HAVE FOR POINTS" IS points.js's CURRENCIES. There is no separate
//    credit store: points.js already has two currencies (School, Play), a spend that records which one
//    paid, and an append-only log. So buying an unlock is `ledger.spend()` — the same record the reward
//    store (quests.js) writes. It is a point SINK, which Mike asked for ("We need some kind of point sink").
//    Game mode spends and earns PLAY; learning mode spends and earns SCHOOL ("separate education points").
//    Row 2.20: nothing shrinks earned School points without the person choosing it — so a purchase is two
//    presses (the UI's "press again"), and if nobody presses again nothing happens.
//
// 7. THE TOUR PAYS ONLY IN GAME OR LEARNING MODE. Sandbox is the default for everybody who never chose; a
//    tour that wrote points into the ledger of somebody who never opted in would be a record nobody asked
//    for. Games keep paying as they always have, in every mode — this file does not touch them. Each step
//    pays ONCE EVER (not once per mode): otherwise switching modes would farm the tour.
// =====================================================================================================

import { GAME_MODES as GUIDE_GAME_MODES, POINTS_DISCLAIMER } from './nimrod_guide_data.js';
import { createPointsLedger, pointsEvents, pointsValue, currencyOf, fmtPoints,
         DEFAULT_CURRENCIES, REWARD_TYPE, EXCHANGE_TYPE } from './points.js';
import { PROFILE_SETTINGS_KEY } from './lessons.js';
import { CATALOG } from './modules_catalog.js';
import { createScoreSource } from './score_source.js';

export { POINTS_DISCLAIMER };

// ---------- the mode ----------
export const GAME_MODE_KEY = 'gameMode';
export const GAME_MODES = GUIDE_GAME_MODES;           // ['game', 'learning', 'sandbox'] — the guide's list
export const DEFAULT_GAME_MODE = 'sandbox';           // decision 1
export function gameModeFrom(values) {
  const raw = values && values[GAME_MODE_KEY];
  return GAME_MODES.includes(raw) ? raw : DEFAULT_GAME_MODE;
}
/** Has this profile ever chosen? (Presence is what counts, settings_fields.js's convention.) */
export const modeChosen = (values) => !!values && GAME_MODES.includes(values[GAME_MODE_KEY]);

// The two pools (decision 6). `type` is the points.js earning type that feeds the currency, so an award
// lands in the right pool with no change to points.js: Play feeds 'play'; Bonus feeds 'school'. Bonus, not
// School, for the tour: points.js's School type is focused school time and carries subject minutes; a tour
// step is not a minute of a subject.
export const POOLS = Object.freeze({
  game: Object.freeze({ currency: 'play', type: 'Play' }),
  learning: Object.freeze({ currency: 'school', type: 'Bonus' }),
});
export const poolFor = (mode) => POOLS[mode] || null;
/** "Play points" / "School points": the currency's own name (points.js), so a rename there renames here. */
export function poolLabel(mode, currencies = DEFAULT_CURRENCIES) {
  const p = poolFor(mode);
  if (!p) return 'points';
  const c = (currencies || []).find((x) => x.id === p.currency);
  return `${c ? c.name : p.currency} points`;
}

// ---------- the settings (Rule 1: each a person's choice) ----------
export const GAME_SETTINGS_KEY = 'nimrodGame';
export const GAME_DEFAULTS = Object.freeze({
  tourStepPoints: 1,        // decision 5
  unlockCost: 5,            // decision 5
  freeUnlocks: true,        // Mike: "Individual items should also be available for unlocks, if you don't want to use the points"
});
export const TOUR_STEP_CHOICES = Object.freeze([0, 1, 2, 5]);
export const UNLOCK_COST_CHOICES = Object.freeze([1, 2, 5, 10, 20, 50]);
export function gameSettingsFrom(values) {
  const raw = (values && values[GAME_SETTINGS_KEY]) || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    tourStepPoints: n(raw.tourStepPoints, GAME_DEFAULTS.tourStepPoints),
    unlockCost: Math.max(1, n(raw.unlockCost, GAME_DEFAULTS.unlockCost)),
    freeUnlocks: typeof raw.freeUnlocks === 'boolean' ? raw.freeUnlocks : GAME_DEFAULTS.freeUnlocks,
  };
}

// ---------- items ----------
export const ITEM_KINDS = Object.freeze(['module', 'piece']);     // 'scene' is decision 2's later kind
export const moduleItem = (type) => `module:${type}`;
export const itemKind = (item) => String(item || '').split(':')[0];
export const itemId = (item) => String(item || '').split(':').slice(1).join(':');
/** The Add tray's key ('photos', 'piece:picture') as an item. */
export const itemForAddKey = (key) => (String(key || '').startsWith('piece:') ? String(key) : moduleItem(key));

// Decision 4. Never locked, whatever the mode — with the reason for each.
export const STARTER_ITEMS = Object.freeze({
  // The landing Home's four (dashboards.js `start`): locking what the site lands on would lock somebody
  // out of rebuilding their own first screen.
  'module:photos': 'the landing Home, and a person’s own people',
  'module:settings': 'the landing Home',
  'module:nimrod': 'the landing Home; the guide who explains all this',
  'module:devices': 'the landing Home',
  // A person's own people and voice (row 2.21: never gates communication).
  'module:personal': 'a person’s own people',
  'module:note': 'a person’s own people',
  'module:call': 'communication',
  'module:board': 'communication (the AAC board)',
  'module:music': 'a person’s own music',
  // The starter screen (modules_catalog.js STARTER_MODULES) — what a new screen already has.
  'module:youtube': 'the starter screen',
  'module:wordforge': 'the starter screen',
  'module:clock': 'the starter screen; a clock is not a reward',
  // The game's own tools.
  'module:scoreboard': 'where the game’s points are shown',
  'module:whats_new': 'what changed on the site',
  // The profile's old pieces (home_profile.js ADD_PIECES): a person's picture and their name.
  'piece:picture': 'a person’s own picture',
  'piece:sign': 'a person’s own name',
});
export const isStarter = (item) => Object.prototype.hasOwnProperty.call(STARTER_ITEMS, item);
/** Everything the game can lock: every catalog module that is not a starter. */
export function lockableItems(catalog = CATALOG) {
  return catalog.map((c) => moduleItem(c.type)).filter((it) => !isStarter(it));
}

// ---------- the unlock log (append-only, like lessons.js's: an unlock is earned and cannot be lost) ----------
export const UNLOCKS_STREAM = 'unlocks';
export const UNLOCK_KIND = 'unlocked';
export const UNLOCK_SOURCE = 'unlocks';          // `source` on a purchase in the points ledger
export const UNLOCK_TOPIC = 'game/unlocked';     // bus nudge (the record is the stream)
export const MODE_TOPIC = 'game/mode';           // bus nudge when the mode changes
export function unlockedFrom(events) {
  const out = new Set();
  for (const e of events || []) if (e && e.kind === UNLOCK_KIND && e.data && e.data.item) out.add(String(e.data.item));
  return out;
}

// ---------- the tour ----------
export const TOUR_SOURCE = 'nimrod-tour';
export const stepTag = (nodeId) => `step:${nodeId}`;
/** Has this tour step ever paid (in any mode)? Read from the ledger — the record is the only truth. */
export function tourStepPaid(events, nodeId) {
  const tag = stepTag(nodeId);
  return pointsEvents(events).some((e) => e.data && e.data.source === TOUR_SOURCE
    && Array.isArray(e.data.tags) && e.data.tags.includes(tag));
}

/** Points EARNED into one currency (spends and exchanges left out): the scoreboard's rule — "spending a
 *  reward is not something to see a number drop for" (modules/scoreboard.js). */
export function earnedIn(events, currency, currencies = DEFAULT_CURRENCIES) {
  return pointsEvents(events).filter((e) => {
    const t = e.data && e.data.type;
    return t !== REWARD_TYPE && t !== EXCHANGE_TYPE && currencyOf(e, currencies) === currency;
  }).reduce((n, e) => n + pointsValue(e), 0);
}

// ---------- THE ONE QUESTION: may this be ADDED now, and if not, why and how? (pure) ----------
//   { item, locked, reason, cost, currency, have, short, canBuy, canFree }
//   reason: 'sandbox' | 'starter' | 'unlocked' | 'kind' (a kind this game does not gate) | 'locked'
export function lockState(item, { mode = DEFAULT_GAME_MODE, unlocked = new Set(), prefs = GAME_DEFAULTS,
  balances = {} } = {}) {
  const key = String(item || '');
  const pool = poolFor(mode);
  const open = (reason) => ({ item: key, locked: false, reason, cost: 0, currency: pool ? pool.currency : null,
    have: 0, short: 0, canBuy: false, canFree: false });
  if (!pool) return open('sandbox');
  if (isStarter(key)) return open('starter');
  if (itemKind(key) !== 'module') return open('kind');
  if (unlocked && unlocked.has(key)) return open('unlocked');
  const p = { ...GAME_DEFAULTS, ...(prefs || {}) };
  const cost = Math.max(1, Number(p.unlockCost) || GAME_DEFAULTS.unlockCost);
  const have = Number(balances && balances[pool.currency]) || 0;
  return { item: key, locked: true, reason: 'locked', cost, currency: pool.currency, have,
    short: Math.max(0, cost - have), canBuy: have >= cost, canFree: p.freeUnlocks !== false };
}

/** What a locked thing says: why it is locked, and every way to open it. Site copy: no names, no "her". */
export function lockWords(state, label = 'This', mode = 'game') {
  if (!state || !state.locked) return { why: '', how: '' };
  const pts = poolLabel(mode);
  const ways = [`use ${state.cost} ${pts} (you have ${fmtPoints(state.have)})`];
  if (state.canFree) ways.push('unlock it free');
  ways.push('switch to sandbox, which unlocks everything');
  return {
    why: `${label} is locked in ${mode === 'learning' ? 'learning' : 'game'} mode. That is only for the game’s sake.`,
    how: `To add it: ${ways.join(', or ')}.`,
  };
}

// ---------- THE HANDLE ----------
// `makeState(key)` and `makeEvents(key, opts)` are a module's ctx.makeState / ctx.makeEvents (profile-
// scoped), or Home's equivalents for its own dashboard. Never throws into a caller: a write that fails
// rejects its own promise, and everything else reads what it has.
export function createUnlockGate({ makeState, makeEvents, bus = null, pollMs = 4000 } = {}) {
  if (typeof makeState !== 'function' || typeof makeEvents !== 'function') {
    throw new Error('createUnlockGate: makeState and makeEvents are required');
  }
  const settings = makeState(PROFILE_SETTINGS_KEY);
  const log = makeEvents(UNLOCKS_STREAM, { limit: 1000, pollMs });
  const ledger = createPointsLedger({ makeEvents, bus, pollMs });
  const subs = new Set();
  const paidHere = new Set();      // steps paid by THIS handle, before the append is back in the window
  const offs = [];
  let torn = false;

  const values = () => { try { return settings.get() || {}; } catch { return {}; } };
  const logEvents = () => { try { return (log.get() || {}).events || []; } catch { return []; } };
  const mode = () => gameModeFrom(values());
  const prefs = () => gameSettingsFrom(values());
  const unlocked = () => unlockedFrom(logEvents());
  const balances = () => { try { return ledger.balances(); } catch { return {}; } };
  const snapshot = () => ({ mode: mode(), chosen: modeChosen(values()), prefs: prefs(), unlocked: unlocked(), balances: balances() });
  const notify = () => { if (torn) return; const s = snapshot(); for (const f of [...subs]) { try { f(s); } catch (err) { console.error('unlocks: subscriber', err); } } };
  for (const h of [settings, log, ledger]) {
    try { const off = h.subscribe?.(notify); if (typeof off === 'function') offs.push(off); } catch { /* no subscribe */ }
  }
  const publish = (topic, payload) => { try { bus?.publish?.(topic, payload); } catch (err) { console.error('unlocks: publish', err); } };
  const check = (item) => lockState(item, { mode: mode(), unlocked: unlocked(), prefs: prefs(), balances: balances() });

  async function writeSettings(patch) {
    settings.set(patch);
    await settings.flush?.();
    notify();
  }

  return {
    async load() {
      await Promise.allSettled([settings.load(), log.load(), ledger.load()]);
      notify();
      return snapshot();
    },
    mode, prefs, unlocked, balances, check, snapshot,
    chosen: () => modeChosen(values()),
    ledger: () => ledger,
    events: () => ledger.events(),
    /** Set the mode. Writes `gameMode` and NOTHING ELSE (decision 3). Unknown mode: null, nothing written. */
    async setMode(m) {
      if (!GAME_MODES.includes(m)) return null;
      await writeSettings({ [GAME_MODE_KEY]: m });
      publish(MODE_TOPIC, { mode: m });
      return m;
    },
    async setPrefs(patch = {}) {
      const next = gameSettingsFrom({ [GAME_SETTINGS_KEY]: { ...prefs(), ...patch } });
      await writeSettings({ [GAME_SETTINGS_KEY]: next });
      return next;
    },
    /** A free single unlock. { ok, reason }: 'already' when it was never locked, 'free-off' when the
     *  setting is off. */
    async unlockFree(item) {
      const c = check(item);
      if (!c.locked) return { ok: true, reason: 'already' };
      if (!c.canFree) return { ok: false, reason: 'free-off' };
      const data = { item: c.item, how: 'free' };
      await log.append(UNLOCK_KIND, data);
      publish(UNLOCK_TOPIC, data);
      notify();
      return { ok: true, reason: null };
    },
    /** Buy with points: { ok, reason } — 'short' when the pool cannot pay. THE UNLOCK IS WRITTEN FIRST,
     *  then the spend: if the spend's append fails, the person has the thing for free, never the points
     *  gone with nothing to show (the same direction points.js's one-event Exchange argues). */
    async buy(item, { label = '' } = {}) {
      const c = check(item);
      if (!c.locked) return { ok: true, reason: 'already' };
      if (!c.canBuy) return { ok: false, reason: 'short', short: c.short };
      const data = { item: c.item, how: 'points', cost: c.cost, currency: c.currency };
      await log.append(UNLOCK_KIND, data);
      publish(UNLOCK_TOPIC, data);
      try {
        await ledger.spend({ amount: c.cost, currency: c.currency, source: UNLOCK_SOURCE,
          note: `Unlocked ${label || itemId(c.item)}`, tags: ['unlock', c.item] });
      } catch (err) { console.error('unlocks: the spend did not record (the unlock stands)', err); }
      notify();
      return { ok: true, reason: null, cost: c.cost, currency: c.currency };
    },
    /** One tour step: pays `tourStepPoints` once ever, in game or learning mode only (decision 7). */
    async payTourStep(nodeId) {
      if (!nodeId) return null;
      const pool = poolFor(mode());
      const amount = prefs().tourStepPoints;
      if (!pool || !(amount > 0)) return null;
      if (paidHere.has(nodeId) || tourStepPaid(ledger.events(), nodeId)) return null;
      paidHere.add(nodeId);
      try {
        return await ledger.award({ amount, type: pool.type, source: TOUR_SOURCE,
          tags: ['tour', stepTag(nodeId)], note: `Nimrod tour: ${nodeId}` });
      } catch (err) { paidHere.delete(nodeId); console.error('unlocks: tour step', err); return null; }
    },
    /** The pool's numbers for the scoreboard: earned (what the card shows) and the balance (to spend). */
    score() {
      const m = mode();
      const pool = poolFor(m);
      if (!pool) return null;
      return { label: poolLabel(m), earned: earnedIn(ledger.events(), pool.currency), balance: balances()[pool.currency] || 0 };
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    startPolling() { try { settings.startPolling?.(); log.startPolling?.(); ledger.startPolling(); } catch { /* offline */ } },
    destroy() {
      torn = true;
      subs.clear();
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      for (const h of [settings, log, ledger]) { try { h.destroy?.(); } catch { /* gone */ } }
    },
  };
}

// ---------- the scoreboard card ----------
// "It would add a scoreboard somewhere." The scoreboard is ONE module (row 2.40: "we probably have a bunch
// of modules drawing their own scoreboards. We shouldn't have that"), so the game does not draw its own: it
// PUBLISHES its score on the score contract (score_source.js) and, when a mode is turned on, puts a card
// following that score on the profile's shared scoreboard row — so every Scoreboard panel on the dashboard
// shows it. The card's shape is modules/scoreboard.js `newCounter` for a followed source (the suite checks
// the two still agree; importing the module here would register it as a side effect of loading Nimrod).
export const GAME_SCORE_SOURCE = 'nimrod-game';
export const GAME_SCORE_CARD_LABEL = 'Nimrod Game';
export const SCOREBOARD_ROW = 'scoreboard';      // modules/scoreboard.js SCOREBOARD_STATE
export function withGameCard(counters = []) {
  const list = Array.isArray(counters) ? counters.filter((c) => c && c.id) : [];
  if (list.some((c) => c.source === GAME_SCORE_SOURCE)) return null;     // already there: nothing to write
  const ids = new Set(list.map((c) => c.id));
  let i = list.length + 1;
  while (ids.has(`c${i}`)) i += 1;
  return [...list, { id: `c${i}`, label: GAME_SCORE_CARD_LABEL, value: 0, target: null, period: 'none',
    periodKey: null, last: null, source: GAME_SCORE_SOURCE }];
}
export async function ensureGameCard(makeState) {
  if (typeof makeState !== 'function') return false;
  let row = null;
  try {
    row = makeState(SCOREBOARD_ROW);
    await row.load();
    const next = withGameCard((row.get() || {}).counters);
    if (!next) return false;
    row.set({ counters: next });
    await row.flush?.();
    return true;
  } catch (err) { console.error('unlocks: scoreboard card', err); return false; }
  finally { try { row?.destroy?.(); } catch { /* gone */ } }
}

// ---------- NIMROD'S NODE-A HOOK ----------
// What modules/nimrod.js calls (four lines there): `arrive(node)` on every FORWARD arrival (pays the tour
// step; on a node that shows the game page, checks the settings panel answered) and `act(a)` for a
// `game-mode` act (sets the mode). Returns null when the host gives no makeState/makeEvents (a preview).
//
// THE MENU-OPEN CHECK (Mike: "make sure the settings menu is still open ... If it's closed suggest opening
// it again or going to the tutorial dashboard"). The settings panel answers SETTINGS_SHOWN_TOPIC when it is
// asked to show a page (one line in modules/settings.js); no answer within PANEL_ANSWER_MS = no panel on
// this dashboard, and Nimrod suggests the settings menu or the tutorial. 400 ms, argued: the bus is in-page
// and synchronous, so a panel that is there answers at once; the wait only covers a panel still mounting.
// It is a mechanism's timeout, not a person's preference, so it is not a setting.
export const SETTINGS_SHOWN_TOPIC = 'settings-module/shown';
export const GAME_SETTINGS_PAGE = 'sc-game';
export const PANEL_ANSWER_MS = 400;
export const PANEL_CLOSED_NOTE = 'The settings panel is not on this dashboard, so the game’s settings cannot open '
  + 'beside me. Open the settings menu (the gear on the bar, This screen tab, “Nimrod Game”), or go to the '
  + 'tutorial dashboard, where the settings always are. Both are buttons below.';
export const MODE_NOTES = Object.freeze({
  game: 'Game mode is on. This tour and the things you do earn Play points, and some things to build with are '
    + 'locked until you unlock them. A “Nimrod Game” card on the scoreboard keeps the score.',
  learning: 'Learning mode is on. This tour and your lessons earn School points, kept apart from the game’s Play '
    + 'points. Things to build with unlock the same way as in game mode.',
  sandbox: 'Sandbox mode is on: everything you can build with is unlocked. Nothing you unlocked is lost if you '
    + 'switch back.',
});
export const MODE_HELP = Object.freeze({
  game: 'Turns game mode on: Play points for what you do, and things to build with unlock as you go.',
  learning: 'Turns learning mode on: School points, kept apart from the game’s, and the same unlocks.',
  sandbox: 'Turns sandbox mode on: everything unlocked.',
});

export function createGuideGameHook(ctx, { onNote = () => {}, waitMs = PANEL_ANSWER_MS } = {}) {
  if (!ctx || typeof ctx.makeState !== 'function' || typeof ctx.makeEvents !== 'function') return null;
  let gate;
  try { gate = createUnlockGate({ makeState: ctx.makeState, makeEvents: ctx.makeEvents, bus: ctx.bus || null }); }
  catch (err) { console.error('unlocks: no game for the guide', err); return null; }
  let torn = false;
  let answers = 0;
  const offs = [];
  // `onNote(text, nodeId)`: nodeId is the step a note is about (null for a mode change), so the guide can
  // drop a note that arrives after the person has already moved on.
  const note = (t, nodeId = null) => { if (!torn && t) { try { onNote(t, nodeId); } catch (err) { console.error('unlocks: note', err); } } };
  try {
    const off = ctx.bus?.subscribe?.(SETTINGS_SHOWN_TOPIC, () => { answers += 1; });
    if (typeof off === 'function') offs.push(off);
  } catch { /* no bus */ }
  const score = createScoreSource(ctx.bus, { source: GAME_SCORE_SOURCE, label: GAME_SCORE_CARD_LABEL, instance: ctx.instanceId || null });
  const publishScore = () => {
    const s = gate.score();
    if (!s) return;
    score.set(s.earned, { label: `${GAME_SCORE_CARD_LABEL}: ${s.label}`, detail: `${fmtPoints(s.balance)} to spend` });
  };
  offs.push(gate.subscribe(publishScore));
  const ready = gate.load().catch(() => null);

  return {
    gate,
    ready: () => ready,
    /** Call BEFORE the node's auto acts run, so the panel's answer to them is counted. */
    async arrive(node) {
      if (!node || torn) return;
      const before = answers;
      const wantsPanel = (node.acts || []).some((a) => a && a.kind === 'settings-page' && a.auto && a.page === GAME_SETTINGS_PAGE);
      await ready;
      if (torn) return;
      const paid = await gate.payTourStep(node.id);
      if (wantsPanel) {
        await new Promise((r) => { setTimeout(r, Math.max(0, waitMs)); });
        if (torn) return;
        if (answers === before) { note(PANEL_CLOSED_NOTE, node.id); return; }
      }
      if (paid) {
        const s = gate.score();
        note(`+${fmtPoints(paid.value)} ${s ? s.label : 'points'} for a new step of the tour.`, node.id);
      }
    },
    /** A `game-mode` act. Returns true when it was one. */
    async act(a) {
      if (!a || a.kind !== 'game-mode' || torn) return false;
      await ready;
      if (torn) return true;
      try {
        const m = await gate.setMode(a.mode);
        if (!m) return true;
        if (poolFor(m)) await ensureGameCard(ctx.makeState);
        publishScore();
        note(MODE_NOTES[m]);
      } catch (err) { console.error('unlocks: set mode', err); note('That did not save. Press it again to retry.'); }
      return true;
    },
    destroy() {
      torn = true;
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      try { score.destroy(); } catch { /* gone */ }
      gate.destroy();
    },
  };
}

// ---------- THE "NIMROD GAME" SETTINGS PAGE ----------
// One page, drawn here, used in two places by a few lines each (the settings PANEL's `sc-game` page and the
// settings MENU's "Nimrod Game" row): the mode, the disclaimer, the two numbers and the free-unlock switch,
// the pool's points, and every locked thing with its two ways to unlock. A purchase is two presses.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SELECT_STYLE = 'width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);margin:4px 0 10px';
export const MODE_OPTIONS = Object.freeze([
  ['sandbox', 'Sandbox — everything unlocked'],
  ['game', 'Game — Play points, things unlock as you go'],
  ['learning', 'Learning — School points, things unlock as you go'],
]);
const titleOfType = (type, catalog = CATALOG) => {
  const c = catalog.find((x) => x.type === type);
  if (c && c.title) return c.title;
  return String(type).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
};
export function gameSettingsHTML(snap, { armed = null, catalog = CATALOG } = {}) {
  const s = snap || { mode: DEFAULT_GAME_MODE, prefs: GAME_DEFAULTS, unlocked: new Set(), balances: {} };
  const pool = poolFor(s.mode);
  const opt = (pairs, cur) => pairs.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const locked = lockableItems(catalog).map((it) => lockState(it, s)).filter((st) => st.locked);
  const pts = poolLabel(s.mode);
  const rows = !pool ? '<p class="st-hint" style="display:block">Sandbox: nothing is locked.</p>'
    : !locked.length ? '<p class="st-hint" style="display:block">Everything is unlocked.</p>'
      : locked.map((st) => {
        const t = titleOfType(itemId(st.item), catalog);
        const buy = armed === st.item ? `Press again: use ${st.cost} ${pts}` : `Use ${st.cost} ${pts}`;
        return `<div class="st-item" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center" data-locked-row="${esc(st.item)}">
          <span class="st-label" style="flex:1 1 100%">${esc(t)} <span class="st-hint">locked</span></span>
          <button type="button" class="st-item" data-game-buy="${esc(st.item)}" ${st.canBuy ? '' : 'disabled'}
            title="${esc(st.canBuy ? 'Two presses: the second one spends them' : `You have ${fmtPoints(st.have)}`)}">${esc(buy)}</button>
          ${st.canFree ? `<button type="button" class="st-item" data-game-free="${esc(st.item)}">Unlock it free</button>` : ''}
        </div>`;
      }).join('');
  return `
    <p class="st-hint" style="display:block;margin:0 0 8px" data-game-disclaimer>${esc(POINTS_DISCLAIMER)}</p>
    <label class="st-label" for="ng-mode">Mode</label>
    <select id="ng-mode" data-game-mode style="${SELECT_STYLE}">${opt(MODE_OPTIONS, s.mode)}</select>
    <p class="st-hint" style="display:block;margin:0 0 10px">Locking is only for the game’s sake. Sandbox unlocks
      everything; nothing you unlocked is lost by switching, and nothing already on a screen is ever taken off it.</p>
    ${pool ? `<p class="st-label" data-game-balance>${esc(pts)}: ${esc(fmtPoints(s.balances[pool.currency] || 0))} to spend</p>` : ''}
    <label class="st-label" for="ng-step">Points for each new step of Nimrod’s tour</label>
    <select id="ng-step" data-game-pref="tourStepPoints" style="${SELECT_STYLE}">${opt(TOUR_STEP_CHOICES.map((n) => [n, n === 0 ? 'None' : String(n)]), s.prefs.tourStepPoints)}</select>
    <label class="st-label" for="ng-cost">What one unlock costs</label>
    <select id="ng-cost" data-game-pref="unlockCost" style="${SELECT_STYLE}">${opt(UNLOCK_COST_CHOICES.map((n) => [n, `${n} points`]), s.prefs.unlockCost)}</select>
    <label class="st-label" for="ng-free">Unlock single things free</label>
    <select id="ng-free" data-game-pref="freeUnlocks" style="${SELECT_STYLE}">${opt([['true', 'Yes'], ['false', 'No — points or sandbox only']], String(s.prefs.freeUnlocks))}</select>
    <p class="st-label" style="margin-top:6px">Locked things to build with</p>
    <div data-game-locked>${rows}</div>`;
}

/** Draw the page into `el` against a gate (createUnlockGate), and keep it current. Returns { destroy }. */
export function mountGameSettings(el, gate, { catalog = CATALOG } = {}) {
  let armed = null;
  let torn = false;
  const draw = () => {
    if (torn || !el.isConnected) return;
    el.innerHTML = gameSettingsHTML(gate.snapshot(), { armed, catalog });
  };
  const onChange = async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    try {
      if (t.matches('[data-game-mode]')) await gate.setMode(t.value);
      else if (t.matches('[data-game-pref]')) {
        const k = t.dataset.gamePref;
        await gate.setPrefs({ [k]: k === 'freeUnlocks' ? t.value === 'true' : Number(t.value) });
      }
    } catch (err) { console.error('unlocks: settings', err); }
    draw();
  };
  const onClick = async (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-game-buy],[data-game-free]') : null;
    if (!b || b.disabled) return;
    try {
      if (b.dataset.gameFree) { armed = null; await gate.unlockFree(b.dataset.gameFree); }
      else if (armed !== b.dataset.gameBuy) { armed = b.dataset.gameBuy; }      // first press: arm
      else { const it = armed; armed = null; await gate.buy(it, { label: titleOfType(itemId(it), catalog) }); }
    } catch (err) { console.error('unlocks: unlock', err); }
    draw();
  };
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  const off = gate.subscribe(draw);
  el.innerHTML = '<p class="st-hint">Loading…</p>';
  Promise.resolve(gate.load()).then(draw, draw);
  return {
    destroy() {
      torn = true; off();
      el.removeEventListener('change', onChange); el.removeEventListener('click', onClick);
    },
  };
}

/** A settings page def ({ title, render }) for a host that has the profile makers. */
export function gameSettingsPage({ makeState, makeEvents, bus = null } = {}) {
  return {
    title: 'Nimrod Game',
    render(el) {
      let gate = null;
      try { gate = createUnlockGate({ makeState, makeEvents, bus }); }
      catch { el.innerHTML = '<p class="st-hint">The Nimrod Game needs this screen to be signed in.</p>'; return; }
      const m = mountGameSettings(el, gate);
      // Let go when the page is gone: the next change after the menu closes finds it detached.
      const off = gate.subscribe(() => { if (!el.isConnected) { off(); m.destroy(); gate.destroy(); } });
    },
  };
}
