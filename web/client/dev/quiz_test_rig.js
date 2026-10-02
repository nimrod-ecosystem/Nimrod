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
    inst, host, bus, said, cancelled, timers, chimes, store, probe, grammars, scores, state,
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
