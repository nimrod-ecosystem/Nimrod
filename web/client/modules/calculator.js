// calculator.js — a four-function calculator as a module of its own.
//
// Mike, 2026-09-28: "The calculator should be a separate module than the math game." (A5 in
// MIKE_CHANGE_LIST.md.) It is also step 5 of the ruled port order — the first REAL module port onto
// the new core, and the one that "has to come apart": a keypad, a display, an expression, links
// between them, verbs in. The arithmetic is `calc.js`, extracted unchanged from `algebra.js` and
// shared with it. This file is everything around that: the keypad you press, the display you read,
// the ports that let something else press it or read it, and the verbs that let a switch drive it.
//
// *** THREE WAYS IN, ONE FUNCTION. *** A click on a key, a message on the `key` port, and the
// `select` verb on a lit key all end in `press(token)`. There is no second path that could drift:
// `calculator_test.html` runs 300 random key sequences through the pad, the port and the pure
// `calcPress` and requires the same display and the same result events from all three.
//
// PORTS (declared on the manifest, used through `ports.js`):
//   IN  key      event, text        one key token: '0'-'9', '.', '±', '+', '-', '*', '/', 'C', '<', '='.
//                                   Anything else is ignored — see the note on `press` for why that
//                                   check is here and not left to `calcPress`.
//   OUT result   event, number      sent on `=`, when the calculator is showing a number. NOT sent
//                                   for 'error'. An EVENT port because a result has no honest range:
//                                   `normalizePort` drops a continuous number port with no `range`,
//                                   and any real number (or the word error) is not a range. It is
//                                   also truer to the design the math game already states — `=`
//                                   finishes a calculation, and something else decides what to DO
//                                   with it. Merging the two would make every stray `=` an answer.
//   OUT display  continuous, text   what the display shows, sent whenever it changes (and once when
//                                   the module starts, so a sink has a value to begin from).
//
// DEFAULTS CHOSEN HERE, each revisable — none is an absolute:
//   * `=` sends the number on screen even when nothing was pending ("7 =" sends 7). The alternative
//     is to send only after a real calculation, which makes the calculator useless as a way to type
//     a number and send it. Sending is harmless: the receiving end decides what a number means.
//     One event per press of `=`, including repeats.
//   * The highlight is HIDDEN until the first verb arrives, and the first `select` only reveals it.
//     A mouse or touch user never sees a ring on '7', and a stray `select` never enters a digit
//     nobody saw lit. The cost: a switch user's very first press does not do anything but show them
//     where they are.
//   * The highlight keeps its place after a `select` instead of jumping back to the start. Working
//     out "7 + 3 =" is a walk across the pad, and returning to '7' after every key would make it
//     longer, not shorter. (A row/column scan would be shorter still; see the reading-order note.)
//   * Keys are '*' and '/' on the port, as they are in `CALC_KEYS`, though the pad draws × and ÷.
//
// READING ORDER IS THE ORDER THE KEYS ARE DRAWN IN: the sixteen `CALC_KEYS`, then C, ⌫ and =. It is
// honest and screen-reader friendly, and it is LONG for one switch — reaching `=` from '7' is
// eighteen presses. Nothing in the verb vocabulary says "next row", so a shorter scan is a design
// question (a row/column scan, or answering `up`/`down`), not something to invent here.
//
// NOTHING IS STORED and nothing is asked of the platform: no settings, no state, no events, no
// timers. `dependsOn: 'local'` was checked by mounting it with every handle rejecting
// (`calculator_test.html`), not guessed.

import { registerModule } from '../module.js';
import { CALC_KEYS, calcInit, calcPress, calcValue } from '../calc.js';
import { createPorts } from '../ports.js';

// The order the keys are drawn in, and therefore the order `next`/`prev` walk them.
export const READING_ORDER = [...CALC_KEYS, 'C', '<', '='];
const KEY_SET = new Set(READING_ORDER);

// What is printed on a key, and what a screen reader says for it. Digits are their own name.
const FACE = { '/': '÷', '*': '×', '<': '⌫', '-': '−' };
const SPOKEN = {
  '/': 'divided by', '*': 'times', '-': 'minus', '+': 'plus', '.': 'point', '±': 'plus or minus',
  'C': 'clear', '<': 'delete last digit', '=': 'equals',
};
const kindOf = (k) => (k === '=' ? 'is-eq' : k === 'C' || k === '<' ? 'is-fn' : '+-*/'.includes(k) ? 'is-op' : '');

const CALC_PORTS = [
  { id: 'key', direction: 'in', class: 'event', type: 'text', label: 'Key' },
  { id: 'result', direction: 'out', class: 'event', type: 'number', label: 'Result' },
  { id: 'display', direction: 'out', class: 'continuous', type: 'text', label: 'Display' },
];

// The manifest is written inline in the call, not hoisted into a const: `dev/module_anatomy.py` reads
// the manifest literal in the register call to build its table, and a hoisted manifest made this module look
// as though it declared no `dependsOn`.
registerModule(
  { type: 'calculator', title: 'Calculator', core: 'new',
    // `local`, MEASURED: it renders and works with every platform handle rejecting.
    dependsOn: 'local',
    description: 'A four-function calculator: press the keys, or send it keys and read its answer from another module',
    ports: CALC_PORTS },
  (ctx) => {
  const { mount } = ctx;
  let calc = calcInit();
  let lit = -1;                    // index into READING_ORDER, or -1 = nothing lit (yet)
  let lastDisplay = null;
  let torn = false;
  let ports = null;
  let displayEl = null;
  let keyEls = [];

  function paint() {
    if (!displayEl) return;
    displayEl.textContent = calc.entry;
    keyEls.forEach((b, i) => {
      if (i === lit) { b.dataset.on = '1'; b.setAttribute('aria-current', 'true'); }
      else { delete b.dataset.on; b.removeAttribute('aria-current'); }
    });
  }

  // THE ONE PLACE A KEY IS PRESSED. The token is checked against the pad's own key set FIRST, and
  // that is not decoration: `calcPress` tests operators with `'+-*/'.includes(key)`, a substring
  // test, so an empty string or '+-' reads as an operator (calc_test.html, KNOWN QUIRK). Nothing on
  // the pad can produce either, but a `key` port carries whatever text somebody links to it.
  function press(token) {
    if (torn || typeof token !== 'string' || !KEY_SET.has(token)) return false;
    calc = calcPress(calc, token);
    paint();
    // The display first, then the result: the state changed before the calculation was announced.
    if (calc.entry !== lastDisplay) {
      lastDisplay = calc.entry;
      ports?.emit('display', lastDisplay);
    }
    if (token === '=') {
      const n = calcValue(calc);
      if (n !== null) ports?.emit('result', n);      // 'error' reads back as null: nothing is sent
    }
    return true;
  }

  // The verbs. Arriving through `ctx.bus` they answer on the bare topic AND this instance's own
  // scoped alias (bus.js `scope`), which is the one the router publishes to.
  function moveLit(delta) {
    if (torn) return;
    const n = READING_ORDER.length;
    if (lit < 0) lit = delta > 0 ? 0 : n - 1;
    else lit = ((lit + delta) % n + n) % n;
    paint();
  }
  function selectLit() {
    if (torn) return;
    if (lit < 0) { lit = 0; paint(); return; }      // reveal first; never press a key nobody saw lit
    press(READING_ORDER[lit]);
  }

  return {
    init() {
      mount.innerHTML = `
        <div class="calc" data-calc role="group" aria-label="Calculator">
          <div class="calc-display" data-display role="status" aria-live="polite" aria-atomic="true">0</div>
          <div class="calc-pad" role="group" aria-label="Calculator keys">
            ${READING_ORDER.map((k) => `<button type="button" class="calc-key ${kindOf(k)}" data-key="${k}"
              aria-label="${SPOKEN[k] || k}">${FACE[k] || k}</button>`).join('')}
          </div>
        </div>`;
      displayEl = mount.querySelector('[data-display]');
      keyEls = [...mount.querySelectorAll('[data-key]')];
      mount.querySelector('.calc-pad').addEventListener('click', (e) => {
        const b = e.target instanceof Element ? e.target.closest('[data-key]') : null;
        if (b) press(b.dataset.key);
      });

      ports = createPorts({ rootBus: ctx.rootBus, instanceId: ctx.instanceId, manifest: { ports: CALC_PORTS } });
      ports.on('key', (token) => press(token));
      ctx.bus.subscribe('calculator/next', () => moveLit(1));
      ctx.bus.subscribe('calculator/prev', () => moveLit(-1));
      ctx.bus.subscribe('calculator/select', () => selectLit());

      paint();
      // Say what is showing, so a sink linked to `display` starts from a real value.
      lastDisplay = calc.entry;
      ports.emit('display', lastDisplay);
    },
    onResize() {},
    onHide() {},
    destroy() {
      torn = true;
      ports?.dispose();      // the scoped bus releases the verb subscriptions itself (module.js)
      ports = null;
    },
  };
  },
);
