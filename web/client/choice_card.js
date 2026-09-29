// choice_card.js — A SMALL CARD THAT OFFERS A CHOICE AT THE MOMENT IT BECOMES RELEVANT.
//
// Mike, 2026-09-29, about the AAC board's symbol sets: *"Maybe for things like this where the
// option would be hidden in settings there should be a popup that shows you the choice with always
// use this option and don't show again checkboxes."* A setting nobody knows exists is a setting
// nobody uses. So when somebody does the thing that makes a setting matter — changes the theme on
// a screen with a board on it — this card says what just happened and offers the choice, there,
// once. It is one shared component so the next feature with a hidden option uses the same card
// instead of growing its own.
//
// ---------------------------------------------------------------------------------------
// *** WHAT HAPPENS IF NOBODY ANSWERS? NOTHING. *** (CLAUDE.md, "Design absolutes")
// ---------------------------------------------------------------------------------------
//
// The project's safety invariant: a screen must never enter a state that only an input can leave,
// when the person in front of it cannot give that input. This card is built so it cannot:
//
//   * NON-MODAL. Nothing underneath it stops working: no backdrop, no focus trap, it does not
//     take focus when it appears, and it covers only its own small rectangle. A press on a board
//     card beside it still says the word.
//   * IT CLOSES THREE WAYS: an obvious Close button, Escape, and ON ITS OWN after a delay (the
//     caller's setting; `CHOICE_TIMEOUT_MS` by default). The delay is paused while a pointer is on
//     the card or focus is inside it — somebody reading it or reaching for a checkbox is not
//     somebody who has walked away — and starts again when they leave it.
//   * CLOSING IS INACTION. Close, Escape and the timeout all leave everything exactly as it was:
//     `onChoose` is only ever called for a press on an option (or a remembered answer, below).
//     The one thing a close keeps is a ticked "Don't show again", because ticking it WAS an answer.
//   * IT NEVER APPEARS BY ITSELF. This file has no timer that opens anything and no idea what a
//     theme is; a caller shows it in response to something a person just did ON THIS DEVICE. That
//     rule is the caller's to keep (see `modules/board.js`, which only offers it after a theme
//     picked in this screen's own menu), and each caller's suite proves it.
//
// ---------------------------------------------------------------------------------------
// THE TWO CHECKBOXES, which Mike named, and what each one means
// ---------------------------------------------------------------------------------------
//
//   Always use this option  — remember the option pressed, and next time the same question comes
//                             up, apply it without showing the card. Only meaningful WITH an
//                             option: ticked and then closed, it remembers nothing.
//   Don't show again        — never show this question again, and apply nothing: whatever the
//                             setting already says stands. Honoured on any close, since ticking
//                             it is itself the answer.
//
// Remembered answers live in a store the caller hands in — per PROFILE in practice
// (`ctx.makeState('choices')`, the same shared per-profile row shape `bank` uses), so a caregiver's
// "don't ask me again" follows the screen, not the browser. Keyed by the question's `id`, which is
// why option values must be stable words ('follow', 'keep') rather than whatever the current
// situation happens to be: a remembered answer that is not among today's options is ignored and
// the card is shown instead.

export const CHOICE_TIMEOUT_MS = 30000;
// A card that vanishes before it can be read is a card nobody can answer. Callers may lengthen the
// delay freely; they may not shorten it below this, and they may not remove it (0 or less becomes
// the default) — "never closes by itself" is the one value that would break the rule above.
export const CHOICE_TIMEOUT_MIN_MS = 8000;

const open = new Map();           // question id -> the card showing it, so one question, one card
let seq = 0;

/**
 * A place to remember answers. `store` is a state handle (`get()` / `set(patch)`, merge
 * semantics, as `state.js`); with none, answers last as long as the page.
 */
export function createChoiceMemory(store = null, { now = () => Date.now() } = {}) {
  let local = {};
  const row = () => (store ? (store.get?.() || {}) : local);
  const write = (patch) => {
    if (store) { try { store.set?.(patch); } catch (err) { console.error('choice card: remember', err); } }
    else local = { ...local, ...patch };
  };
  return {
    /** The remembered option for this question, or undefined. */
    answer(id) {
      const r = row()[id];
      return r && r.answer !== undefined && r.answer !== null ? r.answer : undefined;
    },
    /** Asked never to show this question again. */
    muted(id) { const r = row()[id]; return !!(r && r.dontShow); },
    remember(id, { answer, dontShow } = {}) {
      const has = answer !== undefined && answer !== null;
      if (!has && !dontShow) return;
      write({ [id]: { ...(has ? { answer } : {}), ...(dontShow ? { dontShow: true } : {}), at: now() } });
    },
    /** The way back from either checkbox. */
    forget(id) { write({ [id]: null }); },
  };
}

function ensureStyles(doc) {
  if (!doc || doc.querySelector('link[data-choice-card-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./choice_card.css', import.meta.url).href;
    link.setAttribute('data-choice-card-css', '');
    doc.head.append(link);
  } catch { /* a page without a head still gets a working, unstyled card */ }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Offer a choice.
 *
 *   host       the element the card is drawn inside (positioned; the card sits at its foot)
 *   id         a stable name for the QUESTION, e.g. 'board.symbols.follow'
 *   title, text   what just happened and what the choice is, in plain words
 *   options    [{ value, label }] — stable values; the card never picks one on its own
 *   memory     from `createChoiceMemory`, or null to remember nothing
 *   timeoutMs  how long before it goes by itself (clamped, see CHOICE_TIMEOUT_MIN_MS)
 *   onChoose(value, { always, dontShow, remembered })
 *   onClose({ reason: 'chosen' | 'close' | 'escape' | 'timeout' | 'replaced', dontShow })
 *
 * Returns `{ shown: false, reason: 'remembered', answer }` when a remembered answer was applied,
 * `{ shown: false, reason: 'muted' }` when asked never to show it, or the open card's handle
 * `{ shown: true, el, close(reason), probe() }`.
 */
export function showChoiceCard(host, {
  id, title = '', text = '', options = [], memory = null,
  timeoutMs = CHOICE_TIMEOUT_MS,
  onChoose = () => {}, onClose = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  if (!host || !id || !Array.isArray(options) || !options.length) return { shown: false, reason: 'nothing' };

  // A REMEMBERED ANSWER, APPLIED WITHOUT ASKING — but only if it is still one of the options.
  const remembered = memory?.answer?.(id);
  if (remembered !== undefined && options.some((o) => o.value === remembered)) {
    try { onChoose(remembered, { always: true, dontShow: false, remembered: true }); }
    catch (err) { console.error('choice card: remembered answer', err); }
    return { shown: false, reason: 'remembered', answer: remembered };
  }
  if (memory?.muted?.(id)) return { shown: false, reason: 'muted' };

  // One question, one card. A second ask while the first is still up replaces it, so the card on
  // screen always describes the latest change rather than an earlier one.
  open.get(id)?.close('replaced');

  const doc = host.ownerDocument || document;
  ensureStyles(doc);
  const n = ++seq;
  const wait = Number(timeoutMs) > 0
    ? Math.max(CHOICE_TIMEOUT_MIN_MS, Number(timeoutMs)) : CHOICE_TIMEOUT_MS;

  const el = doc.createElement('div');
  el.className = 'choice-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', `cc-t-${n}`);
  el.setAttribute('aria-describedby', `cc-d-${n}`);
  el.dataset.choiceCard = id;
  el.innerHTML = `
    <div class="cc-head">
      <strong class="cc-title" id="cc-t-${n}">${esc(title)}</strong>
      <button type="button" class="cc-x" data-cc-close aria-label="Close">×</button>
    </div>
    <p class="cc-text" id="cc-d-${n}">${esc(text)}</p>
    <div class="cc-opts">${options.map((o, i) => `<button type="button" class="cc-opt" `
      + `data-cc-opt="${i}">${esc(o.label)}</button>`).join('')}</div>
    <label class="cc-check"><input type="checkbox" data-cc-always>`
      + `<span>Always use this option</span></label>
    <label class="cc-check"><input type="checkbox" data-cc-mute>`
      + `<span>Don’t show again</span></label>
    <p class="cc-foot">This goes away by itself. Nothing changes unless you choose.</p>`;

  const always = () => !!el.querySelector('[data-cc-always]')?.checked;
  const mute = () => !!el.querySelector('[data-cc-mute]')?.checked;

  let timer = null;
  let closed = false;
  let held = false;                  // a pointer is on it, or focus is in it
  // Focus is ALSO checked when the delay runs out, not only through focus events: a browser does
  // not send those to a window that is not in front, and a keyboard or switch user sitting on the
  // card's checkbox must hold it open either way.
  const busy = () => held || el.contains(doc.activeElement);
  const arm = () => {
    if (timer != null) clearTimer(timer);
    timer = held || closed ? null : setTimer(expire, wait);
  };
  function expire() {
    timer = null;
    if (closed) return;
    if (busy()) { arm(); return; }
    close('timeout');
  }
  const hold = (on) => { held = on; arm(); };

  function close(reason = 'close', { remember = true } = {}) {
    if (closed) return;
    closed = true;
    if (timer != null) { clearTimer(timer); timer = null; }
    doc.removeEventListener('keydown', onDocKey);
    el.remove();
    if (open.get(id) === handle) open.delete(id);
    const dontShow = mute();
    if (remember && dontShow) memory?.remember?.(id, { dontShow: true });
    try { onClose({ reason, dontShow }); } catch (err) { console.error('choice card: close', err); }
  }

  // Escape closes it from anywhere, WITHOUT swallowing the key: whatever else Escape closes (a
  // settings menu the change was made in) still closes. Only a key pressed inside the card stops.
  function onDocKey(e) { if (e.key === 'Escape') close('escape'); }
  doc.addEventListener('keydown', onDocKey);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close('escape'); }
  });

  // A press on the card is a press on the CARD. Stopped here for the same reason a board card
  // stops its own: a screen-wide pointer binding must not also read it as a switch press.
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-cc-close]')) { close('close'); return; }
    const b = e.target.closest('[data-cc-opt]');
    if (!b) return;
    const opt = options[Number(b.dataset.ccOpt)];
    if (!opt) return;
    const info = { always: always(), dontShow: mute(), remembered: false };
    memory?.remember?.(id, { answer: info.always ? opt.value : undefined, dontShow: info.dontShow });
    close('chosen', { remember: false });
    try { onChoose(opt.value, info); } catch (err) { console.error('choice card: choose', err); }
  });
  el.addEventListener('pointerenter', () => hold(true));
  el.addEventListener('pointerleave', () => hold(el.contains(doc.activeElement)));
  el.addEventListener('focusin', () => hold(true));
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) hold(el.matches(':hover')); });

  const handle = {
    shown: true, el, close: (reason) => close(reason || 'close'),
    probe: () => ({ open: !closed, held, waitMs: wait, always: always(), dontShow: mute(),
                    options: options.map((o) => o.value) }),
  };
  open.set(id, handle);
  host.append(el);
  arm();
  return handle;
}

/** The card open for a question, if any. For a caller's probe and its suite. */
export function openChoiceCard(id) { return open.get(id) || null; }
