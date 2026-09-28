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
