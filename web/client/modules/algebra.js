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

import { registerModule } from '../module.js';
import { createPointsLedger } from '../points.js';
import { createTelemetry } from '../telemetry.js';
import { createLessons, gate, lockedTopics, LESSON_TOPIC } from '../lessons.js';

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
// A tiny four-function machine. Pure, so its behavior is testable without the DOM — and
// so the one place that decides what "7 + 3 =" means can't drift from what's on screen.
export const CALC_KEYS = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '±', '+'];

export function calcInit() { return { entry: '0', acc: null, op: null, fresh: true }; }

function applyOp(acc, op, val) {
  switch (op) {
    case '+': return acc + val;
    case '-': return acc - val;
    case '*': return acc * val;
    case '/': return val === 0 ? null : acc / val;   // null = undefined result, shown as an error
    default: return val;
  }
}

// Returns the NEXT state. `key` is a calculator key, 'C' (clear), '<' (backspace) or '='.
export function calcPress(state, key) {
  const s = { ...state };
  const num = () => Number(s.entry);

  if (key === 'C') return calcInit();
  if (key === '<') {
    if (s.fresh) return s;
    s.entry = s.entry.length > 1 ? s.entry.slice(0, -1) : '0';
    if (s.entry === '-' || s.entry === '') s.entry = '0';
    return s;
  }
  if (key === '±') { s.entry = s.entry.startsWith('-') ? s.entry.slice(1) : (s.entry === '0' ? '0' : '-' + s.entry); return s; }
  if (/^[0-9]$/.test(key)) {
    s.entry = (s.fresh || s.entry === '0') ? key : s.entry + key;
    s.fresh = false;
    return s;
  }
  if (key === '.') {
    if (s.fresh) { s.entry = '0.'; s.fresh = false; return s; }
    if (!s.entry.includes('.')) s.entry += '.';
    return s;
  }
  if (key === '=') {
    if (s.op == null) { s.fresh = true; return s; }
    const out = applyOp(s.acc, s.op, num());
    s.entry = out == null ? 'error' : String(Number(out.toFixed(10)));
    s.acc = null; s.op = null; s.fresh = true;
    return s;
  }
  if ('+-*/'.includes(key)) {
    if (s.entry === 'error') return s;
    // Chaining: "2 + 3 + " folds the pending operation first, like a real calculator.
    s.acc = (s.op != null && !s.fresh) ? applyOp(s.acc, s.op, num()) : num();
    if (s.acc == null) { s.entry = 'error'; s.op = null; return s; }
    s.op = key; s.fresh = true;
    return s;
  }
  return s;
}

export function calcValue(state) {
  const n = Number(state.entry);
  return Number.isFinite(n) ? n : null;
}

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
const SETTINGS = [
  { key: 'pool', label: 'Which problems', kind: 'choice', default: 'mixed', level: 'standard',
    options: [
      { value: 'warm', label: 'Warm up — one step' },
      { value: 'mixed', label: 'Mixed' },
      { value: 'boss', label: 'Hardest only' },
    ] },
  { key: 'roundLength', label: 'Problems in a round', kind: 'choice', default: 10,
    level: 'standard',
    options: [{ value: 5, label: '5' }, { value: 10, label: '10' },
              { value: 15, label: '15' }, { value: 20, label: '20' }] },
  { key: 'tryPoints', label: 'Points for a miss, once the working is read', kind: 'number',
    default: 1, level: 'advanced', min: 0, max: 10, step: 1 },
  { key: 'streakEvery', label: 'Streak bonus every', kind: 'choice', default: 5,
    level: 'advanced',
    options: [{ value: 0, label: 'No streak bonus' }, { value: 3, label: '3 in a row' },
              { value: 5, label: '5 in a row' }, { value: 10, label: '10 in a row' }] },
  { key: 'streakBonus', label: 'Streak bonus points', kind: 'number', default: 3,
    level: 'advanced', min: 0, max: 20, step: 1 },
  // TEXT, and therefore not cycleable - it says so rather than pretending, the same way
  // `photos.js` handles `album`. Nobody types a subject name with one switch.
  { key: 'subject', label: 'Credit counts toward', kind: 'text', default: 'Math',
    level: 'advanced', note: 'which subject a point of credit discharges' },
];

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
  { type: 'algebra', title: 'Math', description: 'Solve for x, with a calculator on screen — the point is the method, not the arithmetic',
    dependsOn: 'local', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;

    let ledger = null, tel = null, lessons = null, session = null;
    let cfg = { ...DEFAULTS };
    let calc = calcInit();
    let problem = null;
    let answered = null;      // {correct, declared, award}
    let streak = 0, earned = 0, solved = 0;
    let askedAt = 0;
    let held = [];

    const el = (sel) => mount.querySelector(sel);

    function nextProblem() {
      const unlocked = lessons ? lessons.unlocked() : new Set();
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

    function render() {
      const host = el('[data-body]');
      if (!host || !problem) return;
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
        session = tel.session({ game: GAME, mode: cfg.pool });
        ledger.load().catch(() => {});
        tel.load().catch(() => {});

        // A keypad, a switch, or a companion can drive it without touching this module.
        bus.subscribe('algebra/key', (k) => press(String(k)));
        bus.subscribe('algebra/submit', () => submit(false));
        bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });

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
          };
        });

        // Like wordforge: wait for the unlock log before dealing, and deal anyway if the
        // server is unreachable, so a blip never leaves a blank game.
        lessons.load()
          .then(() => lessons.startPolling())
          .catch(() => {})
          .then(() => { if (!problem) nextProblem(); });
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() {
        if (ledger) { ledger.destroy(); ledger = null; }
        if (tel) { tel.destroy(); tel = null; }
        if (lessons) { lessons.destroy(); lessons = null; }
      },
    };
  },
);
