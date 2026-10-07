// algebra.js — the algebra game, with a CALCULATOR for an input.
//
// Mike's rule, and it's the right one: "No job would ever expect you to do math like this
// without one." So the answer box is not a bare text field with a number in it — it is a
// working four-function calculator, and a separate **Submit answer** button below it. You
// work the problem out on the calculator, then submit what you got. The thing being
// measured is whether you know what to DO, not whether you can grind arithmetic by hand.
//
// Because of that split, the calculator's `=` and the game's Submit are deliberately
// different buttons. Pressing `=` finishes a calculation; pressing Submit answers the
// question. Merging them would make every stray `=` an accidental wrong answer.
//
// Everything else follows the shape wordforge established:
//   * points.js    -> the ECONOMY, and each point is also a minute of MATH credit
//   * telemetry.js -> the MEASUREMENT, concept = the problem type ("two-step equation")
//   * a wrong answer EXPLAINS itself and still pays, banked on "Got it"
//   * "I don't know — show me" is a first-class answer, recorded as a MISS not a wrong one
//   * topics can be gated behind lessons (the algebra skill tree levels up)
//
// Problems are GENERATED, not a fixed list, so the pool never runs out and nothing can be
// memorised by position. Every generator also returns `how` — the worked solution — which
// is what gets shown when the answer is missed. A generator without a `how` would be a
// quiz; with it, it's a lesson.

import { registerModule, extendCtx } from '../module.js';
import { beginnerMath, beginnerSettings, DEFAULTS as BEGINNER_DEFAULTS } from '../math_beginner.js';
import { createPointsLedger } from '../points.js';
import { createTelemetry } from '../telemetry.js';
import { createLessons, gate, lockedTopics, LESSON_TOPIC,
         createQuestMode, ALL_UNLOCKED } from '../lessons.js';
import { CALC_KEYS, calcInit, calcPress, calcValue } from '../calc.js';
import { createPorts } from '../ports.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPlayWatch } from '../game_start.js';

export const GAME = 'algebra';

export const DEFAULTS = {
  tryPoints: 1,          // a miss, once the working is acknowledged
  streakEvery: 5,
  streakBonus: 3,
  roundLength: 10,
  subject: 'Math',
  pool: 'mixed',
};

// ---------- problem generators ----------
// Each returns { kind, concept, prompt, answer, points, how, lesson? }
//   concept  the skill being exercised — what `progress` ranks
//   points   difficulty, and the base award: 1 easy / 2 medium / 3 hard. At roughly one
//            problem a minute that lands at 1-3 points/minute, in line with the rest of
//            the economy (see docs/points-balance and the Task Menu anchor).
//   lesson   optional lesson id that must be watched first (the skill tree)

const ri = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));
const oneOf = (rand, xs) => xs[ri(rand, 0, xs.length - 1)];

export const GENERATORS = {
  evaluate: (r) => { const a = ri(r, 2, 9), b = ri(r, 2, 6), c = ri(r, 1, 9);
    return { concept: 'evaluate an expression', prompt: `If x = ${a}, what is ${b}x + ${c}?`,
      answer: b * a + c, points: 1, how: `Put ${a} in for x: ${b}×${a} + ${c} = ${b * a + c}.` }; },

  addEq: (r) => { const x = ri(r, 1, 15), c = ri(r, 1, 12);
    return { concept: 'one-step equation', prompt: `x + ${c} = ${x + c}`, answer: x, points: 1,
      how: `Subtract ${c} from both sides: x = ${x + c} − ${c} = ${x}.` }; },

  subEq: (r) => { const x = ri(r, 3, 18), c = ri(r, 1, 10);
    return { concept: 'one-step equation', prompt: `x − ${c} = ${x - c}`, answer: x, points: 1,
      how: `Add ${c} to both sides: x = ${x - c} + ${c} = ${x}.` }; },

  mulEq: (r) => { const x = ri(r, 2, 12), b = ri(r, 2, 7);
    return { concept: 'one-step equation', prompt: `${b}x = ${b * x}`, answer: x, points: 1,
      how: `Divide both sides by ${b}: x = ${b * x} ÷ ${b} = ${x}.` }; },

  twoStep: (r) => { const x = ri(r, 2, 12), b = ri(r, 2, 6), c = ri(r, 1, 9);
    return { concept: 'two-step equation', prompt: `${b}x + ${c} = ${b * x + c}`, answer: x, points: 2,
      how: `Subtract ${c}, then divide by ${b}: x = (${b * x + c} − ${c}) ÷ ${b} = ${x}.` }; },

  twoStepSub: (r) => { const x = ri(r, 3, 12), b = ri(r, 2, 6), c = ri(r, 1, 9);
    return { concept: 'two-step equation', prompt: `${b}x − ${c} = ${b * x - c}`, answer: x, points: 2,
      how: `Add ${c}, then divide by ${b}: x = (${b * x - c} + ${c}) ÷ ${b} = ${x}.` }; },

  likeTerms: (r) => { const a = ri(r, 2, 8), b = ri(r, 2, 5), d = ri(r, 2, 5), c = ri(r, 1, 9);
    return { concept: 'combine like terms', prompt: `If x = ${a}, what is ${b}x + ${d}x + ${c}?`,
      answer: (b + d) * a + c, points: 2,
      how: `${b}x + ${d}x = ${b + d}x. Then ${b + d}×${a} + ${c} = ${(b + d) * a + c}.` }; },

  divEq: (r) => { const q = ri(r, 2, 9), b = oneOf(r, [2, 3, 4, 5]);
    return { concept: 'one-step (division)', prompt: `x ÷ ${b} = ${q}`, answer: q * b, points: 2,
      how: `Multiply both sides by ${b}: x = ${q} × ${b} = ${q * b}.` }; },

  distribute: (r) => { const x = ri(r, 2, 9), b = ri(r, 2, 5), c = ri(r, 1, 6);
    return { concept: 'distributive property', prompt: `${b}(x + ${c}) = ${b * (x + c)}`, answer: x, points: 3,
      how: `Divide both sides by ${b}: x + ${c} = ${x + c}. So x = ${x + c} − ${c} = ${x}.`,
      lesson: 'distributing' }; },

  varsBothSides: (r) => { const b = ri(r, 3, 7), e = ri(r, 1, b - 1), x = ri(r, 2, 9), c = ri(r, 1, 6);
    const d = (b - e) * x + c;
    return { concept: 'variables on both sides', prompt: `${b}x + ${c} = ${e}x + ${d}`, answer: x, points: 3,
      how: `Move the x's together: ${b}x − ${e}x = ${d} − ${c}, so ${b - e}x = ${d - c}. x = ${x}.`,
      lesson: 'both-sides' }; },

  distSolve: (r) => { const x = ri(r, 2, 7), b = ri(r, 2, 4), c = ri(r, 1, 5), extra = ri(r, 1, 8);
    return { concept: 'distribute & solve', prompt: `${b}(x + ${c}) + ${extra} = ${b * (x + c) + extra}`,
      answer: x, points: 3,
      how: `Subtract ${extra}: ${b}(x + ${c}) = ${b * (x + c)}. Divide by ${b}: x + ${c} = ${x + c}. x = ${x}.`,
      lesson: 'distributing' }; },
};

export const POOLS = {
  warm:  ['evaluate', 'addEq', 'subEq', 'mulEq'],
  mixed: ['evaluate', 'addEq', 'subEq', 'mulEq', 'twoStep', 'twoStepSub', 'likeTerms', 'divEq',
          'distribute', 'varsBothSides'],
  boss:  ['distribute', 'varsBothSides', 'distSolve'],
};

// The difficulty band a problem sits in — what `progress` groups by, alongside concept.
export function bandOf(points) {
  return points >= 3 ? 'hard (3 pt)' : points === 2 ? 'medium (2 pt)' : 'easy (1 pt)';
}

// A zero rand makes every generated problem identical, which is useless for play and
// exactly right for asking "what lesson does this generator need?" — generators are cheap,
// so ask one directly rather than duplicating the mapping.
const zeroRand = () => 0;

export function lessonOf(key, gens = GENERATORS) {
  const g = gens[key];
  if (!g) return null;
  try { return g(zeroRand).lesson || null; } catch { return null; }
}

// The gate, expressed over generator keys.
export function availablePool(pool, unlocked, gens = GENERATORS) {
  const keys = (POOLS[pool] || POOLS.mixed).filter((k) => gens[k]);
  const items = keys.map((k) => ({ key: k, topic: lessonOf(k, gens) }));
  const { open, locked } = gate(items, unlocked);
  return { open: open.map((i) => i.key), lockedItems: locked };
}

export function scoreFor({ correct, points = 1, streak = 0, cfg = DEFAULTS }) {
  if (!correct) return { base: cfg.tryPoints, bonus: 0, total: cfg.tryPoints };
  const bonus = (cfg.streakEvery > 0 && streak > 0 && streak % cfg.streakEvery === 0) ? cfg.streakBonus : 0;
  return { base: points, bonus, total: points + bonus };
}

// ---------- the calculator ----------
// The four-function machine itself now lives in `../calc.js` (2026-09-28: the calculator became its
// own module, and the two share this one place that decides what "7 + 3 =" means). This file keeps
// its own inline calculator exactly as it was - it still imports the same functions, and RE-EXPORTS
// them so `algebra_test.html` and any other importer are untouched.
export { CALC_KEYS, calcInit, calcPress, calcValue };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- the module ----------

// LABEL "Math", IDENTIFIER `algebra`. Mike, 2026-09-02: the game is called Math. The `type`
// deliberately does NOT change with it — `algebra` is written into every telemetry row and
// into the points ledger's `source`, so renaming the identifier orphans the history already
// recorded under it. A label is what a person reads; a type is what the data is keyed by,
// and they are allowed to differ.

// WHAT THE SETTINGS MENU SHOWS.
//
// Added 2026-09-05. This module read six config keys and declared NONE of them, so every one was
// live config that no UI could write - the same defect F4 turned out to be. It matters more than
// it did last week: the transport bar now makes the settings menu reachable on a grid kiosk, so
// an undeclared panel is one somebody can select and then find nothing to change.
//
// KIND follows the rule `photos.js` states: with one switch you walk a control one press at a
// time and can only travel one way, so THE NUMBER OF STOPS IS THE COST. Short lists of
// known-good values are choices; genuine ranges where any value means something are numbers.
//
// LEVEL: only what somebody actually changes is `standard`. Everything that prices the economy
// is `advanced`, so the common case is a short menu rather than a long one.
// *** THE BEGINNER LEVEL (row 2.45, Mike 2026-10-01: "the math module should have some questions for
// absolute beginners"). *** "Which problems" gains `beginner`: counting dots, then small sums, asked
// one at a time ("Is it 7?") with the shared miss flow, aloud or on one switch — the game that used to
// be the separate "Simple math" panel (`simple_math.js`, which still holds it). A calculator on screen
// is the right tool for solving for x and the wrong one for "how many dots", so at this level the
// panel shows the beginner game instead of the calculator; the other three levels are unchanged.
// THE DEFAULT STAYS `mixed`: every Math panel that never chose a level reads the default, so making
// beginner the default would turn every existing Math panel into a counting game overnight.
// Each row below says which level it belongs to (`appliesWhen`), so the menu only shows the rows
// that do something at the level chosen.
export const BEGINNER = 'beginner';
const atBeginner = (v) => (v || {}).pool === BEGINNER;
const notBeginner = (v) => !atBeginner(v);
const SETTINGS = [
  { key: 'pool', label: 'Which problems', kind: 'choice', default: 'mixed', level: 'standard',
    options: [
      { value: BEGINNER, label: 'Beginner — counting and small sums' },
      { value: 'warm', label: 'Warm up — one step' },
      { value: 'mixed', label: 'Mixed' },
      { value: 'boss', label: 'Hardest only' },
    ] },
  { key: 'roundLength', label: 'Problems in a round', kind: 'choice', default: 10,
    level: 'standard', appliesWhen: notBeginner,
    options: [{ value: 5, label: '5' }, { value: 10, label: '10' },
              { value: 15, label: '15' }, { value: 20, label: '20' }] },
  { key: 'tryPoints', label: 'Points for a miss, once the working is read', kind: 'number',
    default: 1, level: 'advanced', min: 0, max: 10, step: 1, appliesWhen: notBeginner },
  { key: 'streakEvery', label: 'Streak bonus every', kind: 'choice', default: 5,
    level: 'advanced', appliesWhen: notBeginner,
    options: [{ value: 0, label: 'No streak bonus' }, { value: 3, label: '3 in a row' },
              { value: 5, label: '5 in a row' }, { value: 10, label: '10 in a row' }] },
  { key: 'streakBonus', label: 'Streak bonus points', kind: 'number', default: 3,
    level: 'advanced', min: 0, max: 20, step: 1, appliesWhen: notBeginner },
  // TEXT, and therefore not cycleable - it says so rather than pretending, the same way
  // `photos.js` handles `album`. Nobody types a subject name with one switch.
  { key: 'subject', label: 'Credit counts toward', kind: 'text', default: 'Math',
    level: 'advanced', note: 'which subject a point of credit discharges', appliesWhen: notBeginner },
  // Row 2.40 (Mike, 2026-09-30: "we probably have a bunch of modules drawing their own
  // scoreboards. We shouldn't have that."). The points-solved-streak line is PUBLISHED on the score
  // contract (`../score_source.js`); this row decides whether the panel draws it too. `auto` by
  // default — shown until a Scoreboard on the same screen shows it — for the reason trivia and
  // comet give: Mike ruled 2026-09-22 that games show a score by default.
  ownScoreField({ level: 'standard',
    note: 'Points this sitting, problems solved, and the streak. A Scoreboard on the same screen can show it instead.' }),
  // The beginner level's own rows, shown only at that level. `mathLevel` defaults to ADAPTIVE here
  // (a new beginner climbs by themselves); an old Simple math panel keeps 'fixed'.
  ...beginnerSettings({ when: atBeginner, levelDefault: 'adaptive', withScore: false }),
];

// The beginner game as Math mounts it: bus prefix and score source `algebra`, so the switch verbs,
// the score contract and the points ledger all keep the identifier this panel already has. `select`
// also answers on `algebra/submit`, the one verb actions.js gives Math today.
export const BEGINNER_DEFAULTS_FOR_MATH = Object.freeze({ ...BEGINNER_DEFAULTS, mathLevel: 'adaptive', pool: BEGINNER });
const beginnerGame = beginnerMath({ type: GAME, title: 'Math', scoreLabel: 'Math: right answers',
  defaults: BEGINNER_DEFAULTS_FOR_MATH, extraTopics: { select: ['algebra/submit'] } });

// THE ONE PORT THIS MODULE DECLARES, and it is a SINK (2026-09-28: the calculator became its own
// module, and this is the second half of the first data link between two real modules). A number
// arriving on `answer` is put in the calculator's entry exactly as if it had been typed, and that is
// ALL it does: it fills the answer box, it does not press Submit. The `=` / Submit separation this
// file's header describes is the reason - a link that submitted for you would turn every result the
// other calculator ever produced into a graded answer. Nothing else changed: the inline keypad
// above is still here, still the way this game works on its own, and a screen with no link to this
// port behaves exactly as it did.
export const ALGEBRA_PORTS = [
  { id: 'answer', direction: 'in', class: 'event', type: 'number', label: 'Answer' },
];

// ---------- the calculator game (every level but Beginner) — unchanged ----------
function calculatorGame(ctx) {
  return calculatorFactory(ctx);
}

// ---------- WHICH GAME THE PANEL SHOWS, by level ----------
//
// One panel, two games: Beginner mounts `../math_beginner.js`'s one-at-a-time game, every other level
// mounts the calculator game above, exactly as before. The level is a setting, so it can change while
// the panel is on screen; the panel then takes the old game down and puts the other up.
//
// Each game is given a WRAPPED state and bus, so taking one down takes down everything it listened
// to: its state subscription (the calculator game never kept the unsubscribe) and every bus topic
// it subscribed. Without that, a calculator game taken down would still hear every settings change
// and draw into a panel that now belongs to the beginner game.
export function mathModule(ctx) {
  const { state, bus, mount } = ctx;
  let inner = null;
  let mode = null;
  let last;
  let have = false;
  let started = false;
  let hidden = false;
  let dead = false;
  let subs = new Set();
  let offs = [];
  const modeOf = (snap) => ((snap || {}).pool === BEGINNER ? 'beginner' : 'calculator');

  const subState = {
    get: () => state?.get?.(),
    set: (p) => state?.set?.(p),
    flush: () => state?.flush?.(),
    load: () => state?.load?.(),
    startPolling: () => state?.startPolling?.(),
    subscribe(fn) {
      subs.add(fn);
      if (have) { try { fn(last); } catch (err) { console.error('math: state', err); } }
      return () => subs.delete(fn);
    },
    destroy() { /* the panel's own handle; mountModule destroys it */ },
  };
  const track = (off) => { offs.push(off); return off; };
  const subBus = {
    subscribe: (topic, handler) => track(bus.subscribe(topic, handler)),
    addBinding: (b) => track(bus.addBinding(b)),
    publish: (...a) => bus.publish(...a),
    createSource: (...a) => bus.createSource(...a),
    instanceId: bus.instanceId,
  };

  function mountMode(m) {
    if (inner) { try { inner.destroy?.(); } catch (err) { console.error('math: destroy', err); } }
    while (offs.length) { try { offs.pop()(); } catch { /* already gone */ } }
    subs = new Set();
    mount.innerHTML = '';
    mode = m;
    inner = (m === 'beginner' ? beginnerGame : calculatorGame)(extendCtx(ctx, { state: subState, bus: subBus }));
    try { inner.init?.(); } catch (err) { console.error('math: init', err); }
    if (hidden) { try { inner.onHide?.(); } catch { /* noop */ } }
  }

  return {
    // Test escape hatches: the game on screen right now, and (at Beginner) its engine.
    __mode: () => mode,
    __inner: () => inner,
    get __engine() { return inner?.__engine; },
    get __board() { return inner?.__board; },
    get __session() { return inner?.__session; },
    __probe: () => inner?.__probe?.(),
    hear: (r) => inner?.hear?.(r),
    init() {
      state?.subscribe?.((snap) => {
        if (dead) return;
        last = snap;
        have = true;
        if (!started) return;
        const m = modeOf(snap);
        if (!inner || m !== mode) { mountMode(m); return; }
        for (const fn of [...subs]) { try { fn(snap); } catch (err) { console.error('math: state', err); } }
      });
      started = true;
      if (!inner) mountMode(modeOf(have ? last : state?.get?.()));
    },
    onResize() { inner?.onResize?.(); },
    onHide() { hidden = true; inner?.onHide?.(); },
    onShow() { hidden = false; inner?.onShow?.(); },
    settingsChoices: () => inner?.settingsChoices?.() || {},
    destroy() {
      dead = true;
      try { inner?.destroy?.(); } finally {
        inner = null;
        while (offs.length) { try { offs.pop()(); } catch { /* already gone */ } }
        subs = new Set();
      }
    },
  };
}

registerModule(
    // `local`, MEASURED RATHER THAN GUESSED (2026-09-05). Mounted with every handle rejecting -
    // a dead platform, with the factories still present the way a real kiosk supplies them -
    // this module still renders a playable problem. It runs; it just stops being evidence.
    //
    // That is exactly `pressgame`'s stated precedent, and the reason this matters is the
    // RECOVERY LADDER: `dependsOn` feeds its fallback ranking, and an ABSENT value is read as
    // the pessimistic `server`. So leaving it off made a screen that lost the platform swap
    // AWAY from a game that would have kept working - which is the opposite of what a fallback
    // is for.
  { type: 'algebra', title: 'Math', // Describes rather than justifies (PRIORITY.md #4): "the point is the method, not the
    // arithmetic" is the reasoning, and it is kept in the catalog's `why`.
    description: 'Counting and small sums for beginners, then solve for x, one step at a time, with a calculator on screen',
    dependsOn: 'local', settings: SETTINGS, ports: ALGEBRA_PORTS },
  mathModule,
);

// The calculator game, as it always was (the body below is unchanged; it moved out of the
// `registerModule` call when Math gained its Beginner level).
function calculatorFactory(ctx) {
  {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;

    let ledger = null, tel = null, lessons = null, session = null;
    // Quest (gating enforced, today's behavior) vs sandbox (everything open) — a per-PROFILE
    // choice read the same way `lessons` itself is, see ../lessons.js's own "mode" section.
    let mode = null;
    let cfg = { ...DEFAULTS };
    let calc = calcInit();
    let problem = null;
    let answered = null;      // {correct, declared, award}
    let streak = 0, earned = 0, solved = 0;
    let askedAt = 0;
    let held = [];
    let ports = null;
    let score = null;          // the score contract (row 2.40), made in init()
    // BEING PLAYED (2026-10-07, game_start.js createPlayWatch): no Start button, so from a press on it (a calculator
    // key, Submit, "I don't know", Next, a switch's verb) until nobody has pressed for GAME_IDLE_MS. Never merely for
    // being open. (The Beginner level is quiz_view.js's game and reports there.)
    let plays = null;
    let dead = false;

    const el = (sel) => mount.querySelector(sel);

    function nextProblem() {
      // SANDBOX hands availablePool()'s gate() a stand-in that says everything is unlocked,
      // rather than reading the real unlock log at all — the log is never touched by being in
      // sandbox mode (see ../lessons.js). No `mode` handle (an older harness with no
      // ctx.makeState) falls back to quest — the same "absent mechanism means today's
      // behavior" rule the line below already follows for a missing `lessons` handle.
      const sandbox = mode ? mode.isSandbox() : false;
      const unlocked = sandbox ? ALL_UNLOCKED : (lessons ? lessons.unlocked() : new Set());
      const { open, lockedItems } = availablePool(cfg.pool, unlocked);
      held = lockedTopics(lockedItems, unlocked, cfg.topics || []);
      const keys = open.length ? open : POOLS.warm;
      problem = GENERATORS[oneOf(rand, keys)](rand);
      answered = null;
      calc = calcInit();
      askedAt = Date.now();
      render();
    }

    async function submit(declared = false) {
      if (answered || !problem) return;
      const given = declared ? null : calcValue(calc);
      const correct = !declared && given === problem.answer;
      if (correct) { streak += 1; solved += 1; } else streak = 0;
      const award = scoreFor({ correct, points: problem.points, streak, cfg });
      answered = { correct, declared, award, given };
      render();

      tel.log({
        game: GAME, session: session.id, mode: cfg.pool,
        concept: problem.concept,
        band: bandOf(problem.points),
        responded: !declared,           // "I don't know" is a MISS, not a wrong answer
        correct,
        latencyMs: Date.now() - askedAt,
        prompt: problem.prompt,
      }).catch((e) => console.error('algebra: telemetry', e));

      if (correct) await bank(award);
    }

    async function bank(award) {
      earned += award.total;
      try {
        await ledger.award({
          amount: award.total, mult: 1,
          type: 'School', minutes: award.total, subject: cfg.subject,
          source: GAME, tags: ['algebra', problem.concept],
          note: problem.prompt,
        });
      } catch (e) { console.error('algebra: award', e); }
      render();
    }

    async function advance() {
      if (!answered) return;
      if (!answered.correct && !answered.banked) {
        answered.banked = true;
        await bank(answered.award);
      }
      nextProblem();
    }

    function press(key) {
      if (answered) return;
      calc = calcPress(calc, key);
      const d = el('[data-display]');
      if (d) d.textContent = calc.entry;
    }

    // A value arriving on the `answer` port. "As if typed" is literal: it is the same state a finished
    // `=` leaves (`fresh`), so a following digit starts a new number and an operator carries this one.
    // Ignored, like a typed key, while a problem's feedback is on screen or before one has been dealt
    // (`nextProblem` starts every problem from a cleared calculator anyway).
    function fillAnswer(value) {
      if (answered || !problem) return;
      calc = { entry: String(value), acc: null, op: null, fresh: true };
      const d = el('[data-display]');
      if (d) d.textContent = calc.entry;
    }

    function render() {
      const host = el('[data-body]');
      if (!host || !problem) return;
      // Row 2.40: the score goes out on the contract first; the panel's own line only when asked.
      score?.set?.(earned, { detail: [solved ? `${solved} solved` : '', streak >= 2 ? `${streak} in a row` : '']
        .filter(Boolean).join(' · ') });
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      // Inline `display`, and '' to hand it back: '' lets modules.css's own cramped-cell rule keep
      // hiding the line in a tiny panel (panel_fit_test), where `hidden` would be overridden by it.
      el('.al-top').style.display = own ? '' : 'none';
      el('[data-earned]').textContent = `${earned} pts`;
      el('[data-solved]').textContent = solved ? `${solved} solved` : '';
      el('[data-streak]').textContent = streak >= 2 ? `${streak} in a row` : '';
      const heldEl = el('[data-held]');
      if (heldEl) {
        heldEl.textContent = held.length
          ? `more problem types waiting behind: ${held.map((h) => h.label).join(', ')}`
          : '';
      }

      let feedback = '';
      if (answered) {
        feedback = answered.correct
          ? `<div class="al-fb is-right"><b>Correct.</b> +${answered.award.total}
               ${answered.award.bonus ? `<span class="al-bonus">includes a +${answered.award.bonus} streak bonus</span>` : ''}
             </div><button class="al-btn al-primary" data-next>Next problem</button>`
          : `<div class="al-fb is-wrong">
               <b>${answered.declared ? 'Here’s how it works.' : `Not quite — x = ${problem.answer}.`}</b>
               <span class="al-how">${esc(problem.how)}</span>
               <span class="al-try">+${answered.award.total} for ${answered.declared ? 'asking' : 'the try'} — press “Got it” to bank it.</span>
             </div><button class="al-btn al-primary" data-next>Got it</button>`;
      }

      host.innerHTML = `
        <p class="al-kind">${esc(problem.concept)} · ${problem.points} pt</p>
        <p class="al-prompt">${esc(problem.prompt)}</p>
        <div class="al-calc">
          <div class="al-display" data-display>${esc(calc.entry)}</div>
          <div class="al-pad">
            ${CALC_KEYS.map((k) => `<button class="al-key${'+-*/'.includes(k) ? ' is-op' : ''}" data-key="${esc(k)}">${esc(k === '*' ? '×' : k === '/' ? '÷' : k)}</button>`).join('')}
            <button class="al-key is-fn" data-key="C">C</button>
            <button class="al-key is-fn" data-key="<">⌫</button>
            <button class="al-key is-eq" data-key="=">=</button>
          </div>
        </div>
        <button class="al-btn al-primary al-submit" data-submit ${answered ? 'disabled' : ''}>Submit answer</button>
        ${answered ? '' : '<button class="al-btn al-idk" data-idk>I don’t know — show me</button>'}
        ${feedback}`;

      for (const b of host.querySelectorAll('[data-key]')) {
        b.addEventListener('click', () => press(b.dataset.key));
      }
      const sub = host.querySelector('[data-submit]');
      if (sub) sub.addEventListener('click', () => submit(false));
      const idk = host.querySelector('[data-idk]');
      if (idk) idk.addEventListener('click', () => submit(true));
      const nx = host.querySelector('[data-next]');
      if (nx) nx.addEventListener('click', advance);
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="algebra">
            <div class="al-top">
              <span class="al-earned" data-earned>0 pts</span>
              <span data-solved></span>
              <span class="al-streak" data-streak></span>
            </div>
            <div class="al-body" data-body></div>
            <div class="al-held" data-held></div>
          </div>`;

        ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus });
        tel = createTelemetry({ makeEvents: ctx.makeEvents, bus });
        lessons = createLessons({ makeEvents: ctx.makeEvents, bus });
        mode = ctx.makeState ? createQuestMode({ makeState: ctx.makeState }) : null;
        session = tel.session({ game: GAME, mode: cfg.pool });
        ledger.load().catch(() => {});
        tel.load().catch(() => {});

        // `ctx.rootBus` / `ctx.instanceId` are supplied by the kiosk and by both `module_try.js` hosts;
        // a host that supplies neither (algebra_test.html mounts it bare) gets an inert `ports`, not an
        // error, and the game runs exactly as before.
        ports = createPorts({ rootBus: ctx.rootBus, instanceId: ctx.instanceId, manifest: { ports: ALGEBRA_PORTS } });
        ports.on('answer', fillAnswer);

        // Before the first problem renders, so the first render already knows whether a Scoreboard
        // on this screen is showing Math.
        score = createScoreSource(bus, { source: GAME, label: 'Math: points this sitting',
          instance: ctx.instanceId || null, onShownChange: () => render() });

        // A keypad, a switch, or a companion can drive it without touching this module.
        bus.subscribe('algebra/key', (k) => press(String(k)));
        bus.subscribe('algebra/submit', () => submit(false));
        bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });
        // Being played: its keys and Submit, the switch verbs actions.js gives Math (`next` / `prev` / `skip` have no
        // handler at this level, but a switch pressed at this panel is somebody at it), and a press on the panel. Not
        // the `answer` port: a number arriving from a linked calculator was pressed THERE, and that panel reports it.
        plays = createPlayWatch(bus, ctx);
        plays.watch({ topics: ['algebra/key', 'algebra/submit', 'algebra/next', 'algebra/prev', 'algebra/skip'],
          mount, when: () => !dead });

        state.subscribe((s) => {
          const snap = s || {};
          cfg = {
            tryPoints: Number(snap.tryPoints) >= 0 ? Number(snap.tryPoints) : DEFAULTS.tryPoints,
            streakEvery: Number(snap.streakEvery) >= 0 ? Number(snap.streakEvery) : DEFAULTS.streakEvery,
            streakBonus: Number(snap.streakBonus) >= 0 ? Number(snap.streakBonus) : DEFAULTS.streakBonus,
            roundLength: Number(snap.roundLength) > 0 ? Number(snap.roundLength) : DEFAULTS.roundLength,
            subject: typeof snap.subject === 'string' && snap.subject ? snap.subject : DEFAULTS.subject,
            pool: POOLS[snap.pool] ? snap.pool : DEFAULTS.pool,
            topics: Array.isArray(snap.topics) ? snap.topics : [],
            ownScore: snap.ownScore,
          };
          render();   // the score row is live, not only on the next answer
        });

        // Like wordforge: wait for the unlock log (AND the mode — see trivia.js's identical
        // comment on why `mode`'s default, sandbox, is the opposite risk from `lessons`'s)
        // before dealing, and deal anyway if the server is unreachable, so a blip never leaves
        // a blank game.
        Promise.all([
          lessons.load().then(() => lessons.startPolling()).catch(() => {}),
          mode ? mode.load().then(() => mode.startPolling()).catch(() => {}) : Promise.resolve(),
        ]).then(() => { if (!problem) nextProblem(); });
      },
      onResize() {},
      onHide() { plays?.rest(); state.flush(); },
      destroy() {
        dead = true;
        if (plays) { plays.destroy(); plays = null; }
        if (score) { score.destroy(); score = null; }
        if (ports) { ports.dispose(); ports = null; }
        if (ledger) { ledger.destroy(); ledger = null; }
        if (tel) { tel.destroy(); tel = null; }
        if (lessons) { lessons.destroy(); lessons = null; }
        if (mode) { mode.destroy(); mode = null; }
      },
    };
  }
}
