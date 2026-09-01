// statemachine.js — a tiny declarative state machine that runs over the bus.
//
// This is the reusable ENGINE Mike asked for: "shouldn't the scheduler be a state
// machine module that can do other things?" It is not a scheduler — it is a
// generic runtime that TWO different configs (and more later) drive:
//
//   * the content DIRECTOR — one state per segment provider (youtube, personal
//     videos, educational, word game, trivia, sing-along…); on `segment/done`
//     (from a video ENDING, a big-button SKIP, or a TIMEOUT — all the same to the
//     director) it WEIGHTED-picks the next provider, gated by the current daypart,
//     and hands it the stage. Morning & sleepytime enable YouTube only.
//
//   * the TODAY CARD — states clock → weather → calendar, cycled on a timer.
//
// Same runtime, two small JSON configs. That is the proof it is not over-built:
// a weighted rotation is ONE state with a self-transition; a card cycler is three
// states on a timer. This engine is also the runtime the future visual
// node-editor tab (DECISIONS.md) will author — states/transitions/guards ARE the
// node graph; today they are JSON.
//
// PURE-ISH + INJECTABLE: `now`, `rand`, and the timer functions are all injected,
// so a machine's behavior is deterministic and testable without a wall clock or
// real setTimeout. It talks to the world ONLY through the bus (subscribe to
// trigger topics, publish enter/transition actions) — never the DOM. The MODULE
// wrapper that drops it into a window and mounts child providers into its own
// region is a separate, thin layer on top (next slice).
//
// ── CONFIG SHAPE ────────────────────────────────────────────────────────────
//   {
//     initial: '<stateId>',
//     daypart?: { dayparts?, enabled? { <daypart>: [<stateId>...] } },
//     on?: { '<topic>': [ <transition>... ] },        // GLOBAL, any state
//     states: {
//       '<stateId>': {
//         enter?: { publish: '<topic>', payload? },     // fired on entering
//         on?:    { '<topic>': [ <transition>... ] },   // state-local
//         after?: { ms, ...<transition> },              // timer transition
//       }, ...
//     },
//   }
//   <transition> = { when?: '<guardName>', do?: {publish,payload},
//                    to: '<stateId>' | '$back'  |  pick: { from:[<stateId>...], gate? } }
//
// `to: '$back'` returns to whatever state was interrupted — which is what an INCOMING CALL
// needs and what a fixed target cannot express, because the config cannot know at authoring
// time what it will be interrupting. Global `on` transitions already fire from any state, and
// state-local ones are tried FIRST, so "any state → call, then back" is config rather than
// engine work, and a state that must not be interrupted can override it.
//
// Transitions are an ORDERED list — first one whose guard passes and whose target
// resolves wins. `to` is a fixed target; `pick` weighted-draws one target from
// `from` (rng.js), after filtering by `gate` (default: the daypart gate when a
// daypart.enabled map exists; 'none' to disable; or a named guard). The weighted
// draw uses in-memory recency so it won't re-pick the just-played provider.

import { daypartAt, DEFAULT_DAYPARTS } from './daypart.js';
import { pick } from './rng.js';

// The one reserved target name. A state may not be called this.
export const BACK = '$back';

export function createMachine(config, io = {}) {
  const bus       = io.bus;                                   // { subscribe, publish }
  const now       = io.now       || (() => Date.now());
  const rand      = io.rand      || Math.random;
  const setTimer  = io.setTimer  || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = io.clearTimer || ((id) => clearTimeout(id));
  const guards    = { ...(io.guards || {}) };                 // name -> (ctx) => bool
  const dayparts  = config.daypart?.dayparts || DEFAULT_DAYPARTS;

  let current = null;      // current state id
  // WHERE TO GO BACK TO. An interrupt - an incoming call, a caregiver switching to something
  // for a minute - has to be able to hand the screen back to whatever was on it, and a fixed
  // `to` cannot express that: the machine does not know at authoring time what it will be
  // interrupting.
  //
  // *** ONE LEVEL, DELIBERATELY. *** A stack would let A -> B -> A -> B grow without bound and
  // would make "back" mean something nobody can predict from reading the config. One level
  // answers the case this exists for - go there, come back - and anything deeper is a
  // different feature that should be asked for on its own.
  let previous = null;
  let timer = null;        // armed `after` timer handle
  let started = false, stopped = false;
  const offs = [];         // bus unsubscribes, released on stop()
  const recent = [];       // recently entered states — feeds the picker's anti-repeat
  const stats = {};        // in-memory {n,last} per state, so the weighted pick spreads

  const curDaypart = () => daypartAt(now(), dayparts);

  // The built-in gate: a candidate state is allowed if the current daypart's
  // enabled list contains it (no list for a daypart → allow all). This is what
  // makes "morning & sleepytime = youtube only" a data edit, not code.
  function daypartAllows(stateId) {
    const en = config.daypart?.enabled;
    if (!en) return true;
    const list = en[curDaypart()];
    return !list || list.includes(stateId);
  }

  function guardOk(name) {
    if (!name) return true;
    const g = guards[name];
    if (!g) return true;                 // unknown guard name → don't block
    return !!g({ daypart: curDaypart(), now: now(), state: current });
  }

  // Resolve a transition's target to a concrete state id, or null if none applies.
  function resolveTarget(tr) {
    if (tr.pick) {
      let cands = (tr.pick.from || []).slice();
      const gate = tr.pick.gate;
      if (gate === 'none') {
        /* no gating */
      } else if (gate && guards[gate]) {
        cands = cands.filter((id) => !!guards[gate]({ candidate: id, daypart: curDaypart(), now: now() }));
      } else if (gate === 'daypart' || (!gate && config.daypart?.enabled)) {
        cands = cands.filter(daypartAllows);   // default gate when an enabled map exists
      }
      if (!cands.length) return null;
      return pick(cands, stats, { now: now(), rand, recent });
    }
    // `$back` — return to whatever we interrupted. Falls back to `initial` rather than to
    // null, because an interrupt that arrives before the first transition still has to end
    // somewhere, and a machine stuck in a call state is worse than one that starts over.
    if (tr.to === BACK) {
      const target = previous ?? config.initial;
      return (target != null && config.states[target]) ? target : null;
    }
    return tr.to != null ? tr.to : null;
  }

  // Candidate transitions for a topic in the current state: state-local first,
  // then global — so a state can override the global rule (local wins).
  function candidates(topic) {
    const st = config.states[current] || {};
    const local = (st.on && st.on[topic]) || [];
    const global = (config.on && config.on[topic]) || [];
    return [...local, ...global];
  }

  function fire(topic, payload) {
    if (stopped || current == null) return;
    for (const tr of candidates(topic)) {
      if (!guardOk(tr.when)) continue;
      const target = resolveTarget(tr);
      if (target == null) continue;                    // e.g. pick gated to empty → next
      if (tr.do) bus.publish(tr.do.publish, tr.do.payload);
      enter(target);
      return;                                          // first applicable transition wins
    }
  }

  function enter(stateId) {
    if (timer != null) { clearTimer(timer); timer = null; }
    // Recorded BEFORE the move, and never onto itself - a self-transition (which is how the
    // weighted rotation works) must not make "back" mean "here", or a call would return to
    // the call.
    if (current != null && current !== stateId) previous = current;
    current = stateId;
    recent.push(stateId);
    if (recent.length > 24) recent.shift();
    const st = stats[stateId] || { n: 0, last: 0 };
    stats[stateId] = { n: st.n + 1, last: now() };

    const def = config.states[stateId] || {};
    if (def.enter) bus.publish(def.enter.publish, def.enter.payload);

    if (def.after && def.after.ms != null) {
      timer = setTimer(() => {
        timer = null;
        if (stopped) return;
        const target = resolveTarget(def.after);       // `after` is itself a transition
        if (target != null) enter(target);
      }, def.after.ms);
    }
  }

  function start() {
    if (started) return; started = true;
    // subscribe once to every topic named by any transition (state-local + global)
    const topics = new Set();
    for (const s of Object.values(config.states || {})) {
      for (const t of Object.keys(s.on || {})) topics.add(t);
    }
    for (const t of Object.keys(config.on || {})) topics.add(t);
    for (const t of topics) offs.push(bus.subscribe(t, (payload) => fire(t, payload)));
    if (config.initial != null) enter(config.initial);
  }

  function stop() {
    stopped = true;
    if (timer != null) { clearTimer(timer); timer = null; }
    while (offs.length) offs.pop()();
  }

  return {
    start,
    stop,
    fire,                                   // exposed for tests / manual drive
    get state() { return current; },
    get previous() { return previous; },
    daypart: curDaypart,
    statsOf: () => JSON.parse(JSON.stringify(stats)),
  };
}
