// game_agent.js — SOMETHING THAT PLAYS A GAME: STATE IN, ACTION OUT (2026-10-02).
//
// Mike, 2026-10-02: "It would be cool for games like that to have the computer playing them when
// they're open but not in use. Like classic video games. Maybe even have your AI play them as an option."
//
// The demo (game_start.js "attract mode") needs a player. Rather than write each game's demo as a script
// inside that game, a player is an AGENT with one function, and the game asks it what to do:
//
//     decide(observation, env) -> action | null
//
//   observation  { game, kind, t, state, actions }
//     game       the module type ('brickbreaker', 'rhythm', 'brain_games', ...)
//     kind       what shape of game it is: 'paddle' | 'beat' | 'quiz' | 'cards' - so one agent can play
//                every game of a kind
//     t          ms since the demo started (the game's own clock - an agent never reads a real clock)
//     state      a PLAIN-DATA COPY of what the game shows (never the game's own objects: an agent cannot
//                change the game except through its answer). Each game documents its own fields below.
//     actions    the act names this game takes right now. An answer naming anything else is dropped.
//   env          { rand, memory } - `rand` the game's own random source (so a suite is repeatable);
//                `memory` an object the agent may keep notes in, kept for one demo and thrown away after
//   action       { act, ...args } - one of `actions`, or null for "nothing this time"
//
// THE GAMES' OBSERVATIONS (each game builds its own; these are the contracts):
//   paddle (brickbreaker)  state { phase, ball: {x,y,vx,vy}, paddle: {x,w}, landingX, fieldW, fieldH, readyMs }
//                          actions ['aim', 'launch']    aim: { act:'aim', x: 0..1 across the field }
//   beat (rhythm)          state { phase: 'count'|'play'|'rest', beat, msFromBeat, interval, pressed, tiles, lit }
//                          actions ['press']            press: { act:'press', tile? }
//   quiz (quiz_view)       state { phase, question, choices, highlight, answer? }
//                          actions ['next', 'select', 'pick']   pick: { act:'pick', value }
//   `answer` is in a quiz observation ONLY for an agent that declares `wantsAnswer: true` (the built-in
//   demo, which is a demonstration of play, not a contest). An agent that plays for real is not told it.
//
// *** THE HOOK FOR SOMEBODY'S OWN AI (not wired: no model is called from here). *** `registerGameAgent`
// adds a player; the demo uses the most recently registered one that plays this game and is `enabled()`,
// and the built-in computer otherwise. An AI player is an agent whose `decide` asks the person's AI
// (ai.js, the one OpenAI-compatible adapter) and answers with one action - the same `[[act ...]]` line
// convention nimrod_ai.js already reads. Two rules carry over from nimrod_ai.js, and the runner below
// enforces them rather than trusting the agent:
//   * ONLY LISTED ACTIONS. Anything not in `observation.actions` is dropped, and a throw is a null.
//   * A SLOW AGENT DOES NOT STALL THE GAME. `decide` may return a Promise; the game keeps going with no
//     action until it resolves, and a late answer for a moment that has passed is dropped (`answerFor`).
// What a demo can never do, whoever plays it: score, earn points, write to a ladder or a record. That is
// the game's rule (it does not count a demo), not the agent's promise.

const agents = [];   // most recent last

/**
 * Add a player. `{ id, label, games: [...types] | '*', kinds?: [...], decide(obs, env), enabled?() }`.
 * Returns an unregister function.
 */
export function registerGameAgent(spec) {
  if (!spec || typeof spec.decide !== 'function' || !/^[a-z][a-z0-9_-]{0,40}$/.test(String(spec.id || ''))) {
    throw new Error('registerGameAgent: { id, decide } are required');
  }
  if (spec.id === COMPUTER) throw new Error('registerGameAgent: "computer" is the built-in player');
  const a = Object.freeze({ label: spec.id, games: '*', ...spec });
  agents.push(a);
  return () => { const i = agents.indexOf(a); if (i >= 0) agents.splice(i, 1); };
}

const plays = (a, game, kind) => {
  const g = a.games === '*' || (Array.isArray(a.games) && a.games.includes(game));
  const k = !Array.isArray(a.kinds) || a.kinds.includes(kind);
  let on = true;
  try { on = typeof a.enabled === 'function' ? a.enabled() !== false : true; } catch { on = false; }
  return g && k && on;
};

/** Every player for this game: registered ones (newest first), then the built-in computer. */
export function listGameAgents(game, kind = null) {
  const own = agents.filter((a) => plays(a, game, kind)).reverse();
  const builtIn = COMPUTER_AGENTS[kind];
  return builtIn ? [...own, builtIn] : own;
}

/** The player for a demo: `prefer` (an id) when it plays this game, else the newest, else the computer. */
export function gameAgentFor(game, kind, { prefer = null } = {}) {
  const list = listGameAgents(game, kind);
  return (prefer && list.find((a) => a.id === prefer)) || list[0] || null;
}

/**
 * Ask an agent, safely. Returns the action (only one of `obs.actions`), or null. A Promise answer is
 * handed to `onLate(action)` when it arrives - the caller decides whether it still applies.
 */
export function askAgent(agent, obs, env = {}, { onLate = null } = {}) {
  if (!agent || typeof agent.decide !== 'function' || !obs) return null;
  const view = agent.wantsAnswer ? obs : stripAnswer(obs);
  let out = null;
  try { out = agent.decide(view, env); } catch (err) { console.error(`game agent ${agent.id}`, err); return null; }
  if (out && typeof out.then === 'function') {
    out.then((a) => { const v = validAction(a, obs); if (v && onLate) onLate(v); })
      .catch((err) => console.error(`game agent ${agent.id}`, err));
    return null;
  }
  return validAction(out, obs);
}

function stripAnswer(obs) {
  if (!obs?.state || !('answer' in obs.state)) return obs;
  const { answer, ...rest } = obs.state;
  return { ...obs, state: rest };
}

export function validAction(a, obs) {
  if (!a || typeof a !== 'object' || typeof a.act !== 'string') return null;
  if (!Array.isArray(obs?.actions) || !obs.actions.includes(a.act)) return null;
  return { ...a };
}

// ---------------------------------------------------------------------------------------------------
// THE BUILT-IN COMPUTER: one per kind. Plays well, not perfectly - a demo that never misses looks like a
// machine, and one that always misses looks like a broken game. Every number is argued beside it.
// ---------------------------------------------------------------------------------------------------
export const COMPUTER = 'computer';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const paddleComputer = Object.freeze({
  id: COMPUTER, label: 'The computer', kinds: ['paddle'],
  // Launch after a short look (1.2 s: long enough to see the ball sitting there, short enough not to
  // look stuck). Then chase where the ball will land, off by a random amount picked once per fall: up to
  // 60% of the paddle's half-width, so most balls come back off-centre (an angle, like a person) and
  // about one in eight goes past the end. The game moves the paddle no faster than its own glide.
  decide(obs, { rand = Math.random, memory = {} } = {}) {
    const s = obs?.state;
    if (!s) return null;
    if (s.phase === 'ready') return s.readyMs >= 1200 ? { act: 'launch' } : null;
    if (s.phase !== 'play') return null;
    const falling = s.ball.vy > 0;
    if (falling && !memory.falling) {
      const half = s.paddle.w / 2;
      memory.err = (rand() * 2 - 1) * half * (rand() < 0.125 ? 1.6 : 0.6);
    }
    memory.falling = falling;
    const want = falling && s.landingX != null ? s.landingX + (memory.err || 0) : s.ball.x;
    return { act: 'aim', x: clamp(want / s.fieldW, 0, 1) };
  },
});

const beatComputer = Object.freeze({
  id: COMPUTER, label: 'The computer', kinds: ['beat'],
  // Press near every beat, a little off: an offset picked once per beat between 60 ms early and 90 ms late
  // (a person's spread, roughly), and one beat in ten left alone, so the demo shows a miss is nothing.
  decide(obs, { rand = Math.random, memory = {} } = {}) {
    const s = obs?.state;
    if (!s || s.phase !== 'play' || s.pressed) return null;
    if (memory.beat !== s.beat) {
      memory.beat = s.beat;
      memory.skip = rand() < 0.1;
      memory.at = -60 + rand() * 150;
    }
    if (memory.skip) return null;
    return s.msFromBeat >= memory.at ? { act: 'press', tile: s.lit } : null;
  },
});

const quizComputer = Object.freeze({
  id: COMPUTER, label: 'The computer', kinds: ['quiz'], wantsAnswer: true,
  // Walks the highlight to the answer one step a turn, then selects it: the switch path, shown. (The game
  // decides how often it asks; the quiz demo asks every couple of seconds.)
  decide(obs) {
    const s = obs?.state;
    if (!s || s.phase !== 'asking' || !Array.isArray(s.choices) || !s.choices.length) return null;
    const want = s.choices.findIndex((c) => String(c) === String(s.answer));
    if (want < 0) return { act: 'next' };
    return s.highlight === want ? { act: 'select' } : { act: 'next' };
  },
});

export const COMPUTER_AGENTS = Object.freeze({ paddle: paddleComputer, beat: beatComputer, quiz: quizComputer });
