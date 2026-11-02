// calc.js — the four-function calculator, as a pure state machine.
//
// EXTRACTED, NOT REWRITTEN (2026-09-28, port-order step 5: the calculator is the first real module
// port, and "the one that has to come apart"). This is `calcInit`/`calcPress`/`calcValue`/`CALC_KEYS`
// and `applyOp` exactly as they stood in `modules/algebra.js`, moved verbatim so that two things can
// share the one place that decides what "7 + 3 =" means: the math game's own inline calculator
// (which still has one, and still imports it from here) and the standalone `calculator` module.
// `dev/calc_test.html` was written and run against the OLD location first; it passes unchanged
// against this one, which is the proof nothing drifted. `modules/algebra.js` re-exports all four
// names, so `algebra_test.html` and any other importer are unaffected.
//
// Pure, so its behavior is testable without the DOM — and so the one place that decides what
// "7 + 3 =" means can't drift from what's on screen.
//
// A NOTE ON WHAT IS LEFT ALONE, because a verbatim move is a promise not to fix things in the same
// breath, and `calc_test.html` names each one "KNOWN QUIRK" rather than blessing it:
//   * `'+-*/'.includes(key)` is a substring test, so an EMPTY key or a run like '+-' is read as an
//     operator. Nothing on a keypad can send either; a `key` port can carry any text, so
//     `modules/calculator.js` checks a token against `CALC_KEYS` first instead of trusting this.
//   * A divide-by-zero found by CHAINING ("5 / 0 +") does not mark the entry fresh, so the next digit
//     is appended to the word 'error'. `C` clears it. The one-line fix is `s.fresh = true` in that
//     branch; it is not made here because this file's job is to be the same code in a new place.
//   * After "2 + 3 +" the entry still reads 3 while the running total (5) sits in `acc`.

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
    // `fresh` too, the way the '=' branch leaves an error: without it the next digit was APPENDED to
    // the word ("error3") and the display stayed unreadable until C. (Fixed 2026-09-28; it was moved
    // here verbatim from algebra.js first, so the move itself could be proven to change nothing.)
    if (s.acc == null) { s.entry = 'error'; s.op = null; s.fresh = true; return s; }
    s.op = key; s.fresh = true;
    return s;
  }
  return s;
}

export function calcValue(state) {
  const n = Number(state.entry);
  return Number.isFinite(n) ? n : null;
}

// *** THE SCIENTIFIC KEYS (row 2.190, Mike 2026-11-02: "different types of calculators like scientific that you can
// swap between the same way you can swap between AAC boards"). *** `sciPress` is a SUPERSET of `calcPress`, not a
// second calculator: every basic key does exactly what `calcPress` does (digits, point, ±, ⌫ and C are handed to it;
// the operators and = are the same lines with one more operator, the power), and `calc_test.html` holds it to that
// with random basic sequences through both. So the calculator module uses this one on every face, and switching
// faces in the middle of a sum keeps the sum: the face decides which keys are DRAWN, not what a key means.
//
// Immediate-execution, like a pocket scientific calculator: a function key (sin, √, x², ...) works on the number
// showing at once, and its answer counts as typed, so "2 + 9 √ =" is 5. No brackets: they need an expression,
// not a running total, and that is a different calculator, argued for when somebody asks.
//
// `angle` is 'deg' (the default, the unit most people learned) or 'rad'; the module's setting chooses.

export const SCI_KEYS = ['sin', 'cos', 'tan', 'sqrt', 'sq', 'pow', 'inv', 'pi', 'ln', 'log', 'e', 'fact'];

const toRad = (x, angle) => (angle === 'rad' ? x : (x * Math.PI) / 180);
const UNARY = {
  sin: (x, a) => Math.sin(toRad(x, a)),
  cos: (x, a) => Math.cos(toRad(x, a)),
  // tan of 90° is undefined, not 16331239353195370: in degrees an odd multiple of 90 is an error.
  tan: (x, a) => (a !== 'rad' && ((x % 180) + 180) % 180 === 90 ? null : Math.tan(toRad(x, a))),
  sqrt: (x) => (x < 0 ? null : Math.sqrt(x)),
  sq: (x) => x * x,
  inv: (x) => (x === 0 ? null : 1 / x),
  ln: (x) => (x <= 0 ? null : Math.log(x)),
  log: (x) => (x <= 0 ? null : Math.log10(x)),
  // Whole numbers 0 to 170 (171! is past the largest number a browser can hold).
  fact: (x) => { if (!Number.isInteger(x) || x < 0 || x > 170) return null; let r = 1; for (let i = 2; i <= x; i++) r *= i; return r; },
};
const CONSTANT = { pi: Math.PI, e: Math.E };
const shown = (r) => (r == null || !Number.isFinite(r) ? 'error' : String(Number(r.toFixed(10))));

// `applyOp` with the power. The four basic operators are left to it, unchanged.
function applySci(acc, op, val) {
  if (op !== '^') return applyOp(acc, op, val);
  const r = Math.pow(acc, val);
  return Number.isFinite(r) ? r : null;
}

export function sciPress(state, key, { angle = 'deg' } = {}) {
  const s = { ...state };
  if (key in UNARY || key in CONSTANT) {
    if (key in UNARY && s.entry === 'error') return s;
    s.entry = shown(key in CONSTANT ? CONSTANT[key] : UNARY[key](Number(s.entry), angle));
    // Fresh, so a digit starts a new number; `done`, so an operator or = takes this answer as typed.
    s.fresh = true; s.done = s.entry !== 'error';
    return s;
  }
  const entered = !s.fresh || !!s.done;
  if (key === '=') {
    if (s.op == null) { s.fresh = true; s.done = false; return s; }
    const out = applySci(s.acc, s.op, Number(s.entry));
    s.entry = out == null ? 'error' : String(Number(out.toFixed(10)));
    s.acc = null; s.op = null; s.fresh = true; s.done = false;
    return s;
  }
  if (key === 'pow' || (key.length === 1 && '+-*/'.includes(key))) {
    if (s.entry === 'error') return s;
    s.acc = (s.op != null && entered) ? applySci(s.acc, s.op, Number(s.entry)) : Number(s.entry);
    if (s.acc == null) { s.entry = 'error'; s.op = null; s.fresh = true; s.done = false; return s; }
    s.op = key === 'pow' ? '^' : key; s.fresh = true; s.done = false;
    return s;
  }
  return { ...calcPress(s, key), done: key === '±' ? s.done : false };
}
