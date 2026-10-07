// quiz_test_rig.js — the harness the row 2.45 game suites share (spelling, simple_math, name_that,
// karaoke, quiz_flow). The same rig `word_games_test.html` builds inline: a fake voice that records
// what was said, a fake clock the test flushes by hand, an in-memory state and points log, and a
// real bus, so what is checked is what the module really publishes.

import { createBus } from '../bus.js';
import { mountModule } from '../module.js';

export function harness() {
  const out = document.getElementById('results');
  let passed = 0;
  let failed = 0;
  function check(name, cond, detail = '') {
    const ok = !!cond; ok ? passed++ : failed++;
    const d = document.createElement('div');
    d.className = ok ? 'pass' : 'fail';
    d.textContent = `${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '   ' + detail : ''}`;
    out.append(d);
  }
  function section(t) { const h = document.createElement('h2'); h.textContent = t; out.append(h); }
  function finish(err) {
    if (err) check(`unexpected error: ${err && err.message}`, false, String(err && err.stack));
    document.getElementById('summary').textContent = failed
      ? `${passed} passed, ${failed} failed` : `ALL PASS — ${passed} checks`;
  }
  return { check, section, finish, counts: () => ({ passed, failed }) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fakeTimers() {
  let tid = 0;
  const pending = new Map();
  return {
    set: (fn, ms) => { tid += 1; pending.set(tid, { fn, ms }); return tid; },
    clear: (id) => { pending.delete(id); },
    count: () => pending.size,
    flush: () => { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } },
  };
}

/**
 * Mount one module into `#host` with everything injectable. `extra` is merged into ctx last, so a
 * suite can hand in `sources`, `listItems`, `playClip`, `playerFactory`, `audio`, ...
 */
export function rig(type, { saved = {}, reducedMotion = false, rand = () => 0, store = {}, bus = null,
  output, extra = {}, hostId = 'host' } = {}) {
  const host = document.getElementById(hostId);
  host.innerHTML = '';
  bus = bus || createBus();
  const said = [];
  const cancelled = [];
  const out = output === null ? null : {
    say: (t) => { said.push(t); return `u${said.length}`; },
    cancel: (id) => { cancelled.push(id); },
  };
  const timers = fakeTimers();
  const chimes = [];
  const grammars = [];
  const scores = [];
  bus.subscribe('speech/grammar', (g) => grammars.push(g));
  bus.subscribe('score/update', (p) => scores.push(p));
  let stored = { ...saved };
  const subs = new Set();
  let nextId = 0;
  const state = {
    get: () => stored,
    set: (p) => { stored = { ...stored, ...p }; for (const fn of [...subs]) fn(stored); },
    flush: () => {}, load: async () => {}, startPolling() {},
    destroy() { state.destroyed = true; state.destroyCount += 1; },
    subscribe: (fn) => { subs.add(fn); fn(stored); return () => subs.delete(fn); },
    destroyed: false, destroyCount: 0,
  };
  const events = {
    append: async () => {}, load: async () => {}, flush: async () => {}, get: () => ({ events: [] }),
    subscribe: () => () => {}, startPolling() {}, destroy() {},
  };
  const inst = mountModule(type, {
    mount: host, bus, rand, output: out, reducedMotion, instanceId: `${type}-1`, personId: null,
    chime: (lv) => chimes.push(lv), setTimer: timers.set, clearTimer: timers.clear,
    state, events, user: 'suite',
    makeEvents: (name) => ({ name,
      append: async (k, d) => { (store[name] ||= []).push({ id: ++nextId, kind: k, data: d }); },
      load: async () => {}, flush: async () => {}, get: () => ({ events: store[name] || [] }),
      subscribe: () => () => {}, startPolling() {}, destroy() {} }),
    ...extra,
  });
  inst.init();
  const probe = () => inst.impl.__probe?.();
  return {
    type, inst, host, bus, said, cancelled, timers, chimes, store, probe, grammars, scores, state,
    eng: inst.impl.__engine, board: inst.impl.__board,
    last: () => said[said.length - 1] || '',
    points: () => (store.points || []),
    setCfg: (p) => state.set(p),
    stored: () => stored,
    phase: () => probe()?.phase,
    lastGrammar: () => grammars[grammars.length - 1] || null,
    publish: (topic, payload) => bus.publish(topic, payload),
  };
}

// ---------------------------------------------------------------------------------------------------
// THE LEVEL FOLLOWS THE PERSON (adaptive_play.js openPersonLadder, 2026-10-06): the same checks for every
// game on the ladder, so each game's suite proves its own wiring.
// ---------------------------------------------------------------------------------------------------
/** A state handle that behaves like state.js's: subscribers hear every change, its own included. */
export function liveRow(init = {}) {
  let d = JSON.parse(JSON.stringify(init));
  let writes = 0;
  const subs = new Set();
  const h = {
    get: () => d,
    set: (p) => { writes += 1; d = { ...d, ...p }; for (const f of [...subs]) f(d); },
    load: async () => d, flush: async () => {}, startPolling() { h.polling = true; }, destroy() { h.destroyed = true; },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); }, writes: () => writes, peek: () => d,
  };
  return h;
}
/** One person row per (person, key), shared by every mount given the same `people`: one person, many screens. */
export function peopleRows(seed = {}) {
  const rows = {};
  const asked = [];
  const make = (pid, key, opts) => { asked.push({ pid, key, opts }); return (rows[`${pid}:${key}`] ||= liveRow(seed[`${pid}:${key}`] || {})); };
  return { make, rows, asked, row: (pid, key = 'ratings') => rows[`${pid}:${key}`] || null };
}

/**
 *   mount({ saved, store, extra })  mounts the game, started, with `store` as the screen's `ratings` row and
 *                                   `extra` merged into ctx last; returns a rig (quiz_test_rig `rig`)
 *   game       the ladder's name for the game checked
 *   saved      settings every mount needs (Math: its adaptive level)
 */
export async function personLadderChecks({ check, mount, name, game, saved = {} }) {
  const at = (people, pid) => people.row(pid)?.get()?.ladder?.players?.[`person:${pid}`]?.games?.[game];
  const row = (rating, floor, n) => ({ rating, n, floor, recent: [], review: {} });
  const sessionOf = (r) => r.inst.impl.__session;
  const play = (r, k) => {
    const s = sessionOf(r);
    for (let i = 0; i < k; i++) { const q = s.deal(game); if (!q) return; s.record({ item: q, right: true }); }
  };
  const open = (opts = {}) => mount({ saved: { ...saved, ...(opts.saved || {}) }, store: opts.screen || liveRow(),
    extra: { ...(opts.person ? { personId: opts.person } : {}), ...(opts.people ? { makePersonState: opts.people.make } : {}),
      ...(opts.extra || {}) } });
  const topOf = (r) => Math.max(1, ...sessionOf(r).allQuestions(game).map((q) => Math.floor(Number(q.level) || 1)));
  // The module's own name: the key of its own start on the person's row (adaptive_play.js openPersonLadder `gameKey`).
  const startKey = (() => { const t = open(); const k = t.type; t.inst.destroy(); return k; })();

  // 1. TWO DASHBOARDS, ONE PERSON.
  {
    const people = peopleRows();
    const screenA = liveRow();
    const a = open({ person: 'pat', people, screen: screenA });
    await sleep(30);
    check(`${name}: the person's own row is opened ("ratings", in their scope), merging when a save is refused`,
      people.asked.some((x) => x.pid === 'pat' && x.key === 'ratings' && typeof x.opts?.merge === 'function'),
      JSON.stringify(people.asked.map((x) => x.key)));
    play(a, 10);
    await sleep(10);
    const mine = at(people, 'pat');
    check(`*** ${name}: ten answers: the level is kept WITH THE PERSON (their own row) ***`, mine?.n === 10, JSON.stringify(mine));
    check(`*** ${name}: ...and not on the screen's row, which keeps the questions' ratings ***`,
      !screenA.get().ladder?.players?.['person:pat'] && Object.keys(screenA.get().ladder?.questions || {}).length >= 1,
      JSON.stringify(screenA.get().ladder?.players));
    a.inst.destroy();
    const b = open({ person: 'pat', people, screen: liveRow() });
    await sleep(30);
    const there = sessionOf(b).playerRow('person:pat', game);
    check(`*** ${name}: the same person on ANOTHER dashboard picks up where they left off, not over ***`,
      there.n === 10 && there.floor === mine?.floor && there.rating === mine?.rating, JSON.stringify([there, mine]));
    b.inst.destroy();
  }
  // 2. MOVED ONCE, the one with more answers staying; typed-in players stay on the screen.
  {
    const people = peopleRows();
    const screen = liveRow({ ladder: { v: 1, players: { 'person:mo': { name: '', games: { [game]: row(1500, 3, 80) } },
      'name:bob': { name: 'Bob', games: { [game]: row(1100, 1, 4) } } }, questions: {}, extra: {} } });
    const r = open({ person: 'mo', people, screen });
    await sleep(30);
    check(`*** ${name}: an existing screen row of theirs is moved to their own row ***`,
      at(people, 'mo')?.n === 80 && at(people, 'mo').floor === 3, JSON.stringify(at(people, 'mo')));
    check(`${name}: ...and taken off the screen's row (so it is not moved again); a typed-in player stays there`,
      !screen.get().ladder.players['person:mo'] && screen.get().ladder.players['name:bob']?.games?.[game]?.n === 4,
      JSON.stringify(screen.get().ladder.players));
    r.inst.destroy();
    const people2 = peopleRows({ 'cy:ratings': { ladder: { v: 1, players: { 'person:cy': { name: '', games: { [game]: row(1300, 3, 40) } } }, questions: {}, extra: {} } } });
    const screen2 = liveRow({ ladder: { v: 1, players: { 'person:cy': { name: '', games: { [game]: row(1000, 1, 5) } } }, questions: {}, extra: {} } });
    const r2 = open({ person: 'cy', people: people2, screen: screen2 });
    await sleep(30);
    check(`${name}: both have a row: the one with more answers (40) stays, not the screen's 5`,
      at(people2, 'cy')?.n === 40 && !screen2.get().ladder.players['person:cy'], JSON.stringify(at(people2, 'cy')));
    r2.inst.destroy();
  }
  // 3. PLAYERS TYPED IN BY NAME stay on the screen's row.
  {
    const people = peopleRows();
    const screen = liveRow();
    const t = open({ person: 'pat', people, screen, saved: { players: 'Ann, Bob' } });
    await sleep(30);
    play(t, 2);
    await sleep(10);
    const pl = screen.get().ladder?.players || {};
    check(`*** ${name}: players typed in by name stay on the screen's row; nothing is written to the person ***`,
      pl['name:ann']?.games?.[game]?.n === 1 && pl['name:bob']?.games?.[game]?.n === 1 && !at(people, 'pat'),
      JSON.stringify([pl, people.row('pat')?.get()]));
    t.inst.destroy();
  }
  // 4. WHERE THIS GAME STARTS (2026-10-06): its own start for the person, else their usual one, kept with them.
  {
    const people = peopleRows({ 'pat:ratings': { start: 'hard' } });
    const r = open({ person: 'pat', people, screen: liveRow() });
    await sleep(30);
    const top = topOf(r);
    check(`*** ${name}: a person whose usual start is "hard" starts at the hardest level (${top}), on any screen ***`,
      sessionOf(r).playerRow('person:pat', game).floor === top && sessionOf(r).windowFor('person:pat', game).floor === top,
      JSON.stringify(sessionOf(r).playerRow('person:pat', game)));
    check(`${name}: ...and the usual start is NOT copied into this game's own row (the menu still says their usual)`,
      (r.stored().gameStart ?? 'usual') === 'usual' && !people.row('pat').get().gameStarts, JSON.stringify(r.stored()));
    r.inst.destroy();
    const pm = peopleRows({ 'pat:ratings': { start: 'medium' } });
    const m = open({ person: 'pat', people: pm, screen: liveRow() });
    await sleep(30);
    const mid = Math.max(1, Math.round((1 + topOf(m)) / 2));
    check(`${name}: "medium" is the middle level (${mid})`, sessionOf(m).playerRow('person:pat', game).floor === mid,
      JSON.stringify(sessionOf(m).playerRow('person:pat', game)));
    m.inst.destroy();
    const po = peopleRows({ 'pat:ratings': { start: 'hard', gameStarts: { [startKey]: { start: 'very easy', mark: 'own1' } } } });
    const o = open({ person: 'pat', people: po, screen: liveRow() });
    await sleep(30);
    check(`*** ${name}: this game's own start for them (very easy) wins over their usual one (hard) ***`,
      sessionOf(o).playerRow('person:pat', game).floor === 1, JSON.stringify(sessionOf(o).playerRow('person:pat', game)));
    check(`${name}: ...and the menu shows it (the panel's copy is brought in line with the person's row)`,
      o.stored().gameStart === 'very easy', JSON.stringify(o.stored().gameStart));
    o.inst.destroy();
  }
  // 5. CHANGING IT IN THIS GAME'S MENU starts them again there, in this game only.
  {
    const people = peopleRows({ 'pat:ratings': { start: 'easy', startMark: 'u1', ladder: { v: 1, players: { 'person:pat': { name: '',
      games: { zz_other: row(1000, 1, 7) } } }, questions: {}, extra: {} } } });
    const r = open({ person: 'pat', people, screen: liveRow() });
    await sleep(30);
    play(r, 3);
    await sleep(10);
    const top = topOf(r);
    r.setCfg({ gameStart: 'hard' });
    await sleep(20);
    const doc = people.row('pat').get();
    const now = sessionOf(r).playerRow('person:pat', game);
    check(`*** ${name}: "Start this game at: hard" is written to the person for THIS game and starts them again there ***`,
      doc.gameStarts?.[startKey]?.start === 'hard' && !!doc.gameStarts[startKey].mark && now.floor === top && now.n === 3
      && now.recent.length === 0, JSON.stringify([doc.gameStarts, now]));
    check(`*** ${name}: ...their usual start, and another game of theirs, are left alone ***`,
      doc.start === 'easy' && doc.startMark === 'u1' && Object.keys(doc.gameStarts).join() === startKey
      && JSON.stringify(doc.ladder.players['person:pat'].games.zz_other) === JSON.stringify(row(1000, 1, 7)),
      JSON.stringify({ start: doc.start, mark: doc.startMark, other: doc.ladder.players['person:pat'].games.zz_other }));
    play(r, 1);
    await sleep(10);
    check(`${name}: ...and once they answer, the row keeps the mark, so it happens once per change`,
      at(people, 'pat')?.mark === doc.gameStarts[startKey].mark && at(people, 'pat')?.n === 4, JSON.stringify(at(people, 'pat')));
    const marks = people.row('pat').get().gameStarts[startKey].mark;
    r.setCfg({ gameStart: 'hard' });
    await sleep(10);
    check(`${name}: the same value again is not a second change`, people.row('pat').get().gameStarts[startKey].mark === marks);
    // Their usual start changed elsewhere (the People tab): this game has its own, so it stays.
    const before = JSON.stringify(sessionOf(r).playerRow('person:pat', game));
    people.row('pat').set({ start: 'medium', startMark: 'u2' });
    await sleep(10);
    check(`*** ${name}: their usual start changed: this game, with its own, is not moved ***`,
      JSON.stringify(sessionOf(r).playerRow('person:pat', game)) === before, `${before} -> ${JSON.stringify(sessionOf(r).playerRow('person:pat', game))}`);
    r.setCfg({ gameStart: 'usual' });
    await sleep(20);
    const mid = Math.max(1, Math.round((1 + top) / 2));
    check(`*** ${name}: set back to "Their usual starting level": it starts again at the usual one (medium, ${mid}) ***`,
      sessionOf(r).playerRow('person:pat', game).floor === mid && people.row('pat').get().gameStarts[startKey].start == null,
      JSON.stringify([sessionOf(r).playerRow('person:pat', game), people.row('pat').get().gameStarts]));
    r.inst.destroy();
  }
  // 6. A SCREEN WITH NO PERSON: the panel's row, for its one player.
  {
    const r = open({ saved: { gameStart: 'hard' }, screen: liveRow() });
    await sleep(30);
    check(`${name}: a screen with no person: the panel's "Start this game at" starts its one player there`,
      sessionOf(r).playerRow('player', game).floor === topOf(r), JSON.stringify(sessionOf(r).playerRow('player', game)));
    play(r, 2);
    r.setCfg({ gameStart: 'easy' });
    await sleep(10);
    check(`${name}: ...and changing it starts that player again there`,
      sessionOf(r).playerRow('player', game).floor === 1 && sessionOf(r).playerRow('player', game).n === 2,
      JSON.stringify(sessionOf(r).playerRow('player', game)));
    r.inst.destroy();
  }
  // 7. players (2026-10-06, player_picker.js): SOMEBODY ELSE PICKED FROM THIS LOGIN plays as themselves - their own
  // row, their own usual start - and a guest stays a name on the screen's row.
  {
    const people = peopleRows({ 'sam:ratings': { start: 'hard' } });
    const screen = liveRow();
    const r = open({ person: 'pat', people, screen,
      saved: { players: [{ kind: 'self' }, { kind: 'person', id: 'sam', name: 'Sam' }, { kind: 'guest', name: 'Ann' }] } });
    await sleep(30);
    const ids = sessionOf(r).players().map((p) => p.id).join();
    check(`*** ${name}: picked players: the screen's person, Sam as himself, and a guest, in turn order ***`,
      ids === 'person:pat,person:sam,name:ann', ids);
    const top = topOf(r);
    check(`*** ${name}: Sam starts where HIS usual start says (hard: ${top}), not at a new player's level ***`,
      sessionOf(r).playerRow('person:sam', game).floor === top, JSON.stringify(sessionOf(r).playerRow('person:sam', game)));
    play(r, 3);
    await sleep(10);
    check(`*** ${name}: one answer each: Pat's and Sam's are kept with them, the guest's on the screen's row ***`,
      at(people, 'pat')?.n === 1 && at(people, 'sam')?.n === 1 && screen.get().ladder?.players?.['name:ann']?.games?.[game]?.n === 1
      && !screen.get().ladder.players['person:sam'] && !screen.get().ladder.players['person:pat'],
      JSON.stringify([at(people, 'pat'), at(people, 'sam'), screen.get().ladder?.players]));
    r.inst.destroy();
  }
  // 8. "THIS SCREEN'S PLAYERS": a game whose own row is left empty plays whoever the screen's Players tab says, and
  // follows it when it changes; with nobody set there it is the screen's person alone, exactly as before.
  {
    let seats = [{ kind: 'self' }, { kind: 'person', id: 'sam', name: 'Sam' }];
    const subs = new Set();
    const host = { seats: () => seats, self: () => ({ id: 'pat', name: 'Pat' }), subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); } };
    const people = peopleRows();
    const r = open({ person: 'pat', people, screen: liveRow(), extra: { screenPlayers: host } });
    await sleep(30);
    const names = sessionOf(r).players().map((p) => `${p.id}=${p.name}`).join();
    check(`*** ${name}: "This screen's players": the screen's two, named ***`, names === 'person:pat=Pat,person:sam=Sam', names);
    seats = [];
    for (const f of [...subs]) f();
    await sleep(10);
    const solo = sessionOf(r).players();
    check(`${name}: the screen's players emptied: the screen's person alone, unnamed (nothing drawn about turns)`,
      solo.length === 1 && solo[0].id === 'person:pat' && solo[0].name === '', JSON.stringify(solo));
    r.inst.destroy();
  }
}

/**
 * THE FIVE `answerBy` CHECKS, the same for every quiz game (Mike, 2026-10-02 late: "Brain games shouldn't
 * be yes/no by default. You should be able to say the answer. Yes/no should be an option though."): the
 * default, saying the answer, tapping it, one switch walking the answers, and yes / no as the option.
 *   mount(saved)  mounts the game STARTED with exactly `saved` (no answerBy pinned); returns a rig
 *   type          its bus prefix (`<type>/next`, `<type>/select`)
 *   saved         what picks the kind of question checked ({ game: 'numbers' })
 *   right(r)      the right answer, as the tiles and the switch carry it
 *   say(r)        what somebody says for it (default: right(r))
 *   defaults, manifest, expect   the module's DEFAULTS and manifest, and the default argued for it
 */
export function answerByChecks({ check, mount, type, name = type, saved = {}, right, say = right,
  defaults, manifest, expect = 'choices' }) {
  const norm = (t) => String(t == null ? '' : t).toLowerCase().trim();
  const row = (manifest.settings || []).find((s) => s.key === 'answerBy');
  check(`${name}: the default is "${expect}" (DEFAULTS and the Answering row)`, defaults.answerBy === expect && row?.default === expect,
    JSON.stringify({ d: defaults.answerBy, row: row?.default }));
  check(`${name}: yes / no is the other option`, (row?.options || []).map((o) => o.value).join() === 'choices,yesno');

  // 1. AS SHIPPED: asked, and nothing offered after it.
  const d = mount({ ...saved });
  check(`${name}: *** as shipped, the question is asked with NOTHING offered after it ***`, d.probe().offers === expect
    && d.probe().candLine === '' && !d.host.querySelector('[data-act="yes"]'), `${d.probe().offers} | ${d.last()}`);
  const g = d.lastGrammar?.();
  check(`${name}: the open vocabulary carries the answer`, !g || (g.open && g.words.map(norm).includes(norm(say(d)))), JSON.stringify(g?.words?.slice(0, 12)));
  // 2. SAYING IT.
  d.inst.impl.hear({ text: say(d), confidence: 0.95 });
  check(`${name}: *** saying the answer is answering: right ***`, d.phase() === 'celebrate', `${d.phase()} ${d.last()}`);
  d.inst.destroy();

  // 3. TAPPING IT (a wrong one first: a miss in the switch line, never "It sounded like you said").
  const t = mount({ ...saved });
  const want = String(right(t));
  const wrong = t.probe().candidates.map(String).find((c) => c !== want);
  t.host.querySelector(`[data-pick="${CSS.escape(wrong)}"]`)?.click();
  check(`${name}: tapping a wrong one: a miss, in the switch line`, t.probe().misses === 1 && !/sounded like/i.test(t.last()), t.last());
  t.host.querySelector(`[data-pick="${CSS.escape(want)}"]`)?.click();
  check(`${name}: *** tapping the right one: right ***`, t.phase() === 'celebrate', t.phase());
  t.inst.destroy();

  // 4. ONE SWITCH WALKS THE ANSWERS: next lights one (and says it), select answers it.
  const s = mount({ ...saved });
  const cands = s.probe().candidates.map(String);
  const picks = s.eng.stops().filter((x) => x.act === 'pick');
  check(`${name}: the switch's stops ARE the answers`, picks.map((x) => String(x.value)).join() === cands.join(), picks.map((x) => x.value).join());
  check(`${name}: the first is lit, on screen too`, String(s.probe().lit) === cands[0]
    && s.host.querySelector(`[data-pick="${CSS.escape(cands[0])}"]`)?.dataset.on === '1');
  const sw = String(right(s));
  let guard = 0;
  while (String(s.probe().lit) !== sw && guard++ < 6) s.publish(`${type}/next`);
  const label = s.eng.stops().find((x) => x.act === 'pick' && String(x.value) === sw)?.label;
  check(`${name}: next walks to the right one, and says it as it gets there`, String(s.probe().lit) === sw
    && (guard === 0 || norm(s.last()) === norm(label)), `${s.probe().lit} | ${s.last()}`);
  s.publish(`${type}/select`);
  check(`${name}: *** select answers it: right, no miss ***`, s.phase() === 'celebrate' && s.probe().misses === 0, s.phase());
  s.inst.destroy();

  // 5. YES / NO IS THE OPTION: "Is it ...?", Yes / No, and a spoken yes or no answers the offer.
  const y = mount({ ...saved, answerBy: 'yesno' });
  const yw = String(right(y));
  check(`${name}: *** yes / no: one answer offered, and said ***`, y.probe().offers === 'yesno' && !!y.probe().candLine
    && y.said.join(' ').includes(y.probe().candLine) && y.eng.stops().slice(0, 2).map((x) => x.act).join() === 'yes,no', y.last());
  guard = 0;
  while (String(y.probe().candidate) !== yw && guard++ < 6) {
    const before = y.probe().candidate;
    y.inst.impl.hear({ text: 'no', confidence: 0.95 });
    if (guard === 1) check(`${name}: "no" said to a wrong offer: the next one, not a miss`, y.probe().misses === 0 && y.probe().candidate !== before, y.last());
  }
  y.inst.impl.hear({ text: 'yes', confidence: 0.95 });
  check(`${name}: *** "yes" said to the right offer: right ***`, y.phase() === 'celebrate', `${y.phase()} ${y.last()}`);
  y.inst.destroy();
  const two = mount({ ...saved, twoSwitch: 'yesno' });
  check(`${name}: two switches that ARE yes and no mean the yes / no shape whatever Answering says`, two.probe().offers === 'yesno');
  two.inst.destroy();
}
