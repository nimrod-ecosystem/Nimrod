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
