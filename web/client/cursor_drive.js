// cursor_drive.js — THE CURSOR, MOVED AND CLICKED BY COMMAND: a voice, or a switch.
//
// Mike, 2026-10-02: *"the cursor should have voice commands kind of like I just described for the brick
// breaker. Other general things like scroll up or down."* So: "cursor left" (a bit), "cursor left a lot",
// "click", "scroll down" - spoken (input_speech.js ROUTES) or bound to a switch (actions.js
// CURSOR_ACTIONS, offered in the binder under "The cursor"). Both arrive here as the same three topics:
//
//   cursor/move    { dir: 'left' | 'right' | 'up' | 'down', size: 'small' | 'large' }
//   cursor/click   (no payload)  press whatever is under the cursor
//   cursor/scroll  { dir: 'up' | 'down' }  scroll whatever is under the cursor (or the page)
//
// IT MOVES THE AIM, NOT A PICTURE. `aim.js` is "where somebody is pointing, whatever is doing the
// pointing"; this is one more producer of it, as the device CURSOR_DEVICE. So the big cursor
// (`cursor.js`) draws it - its default 'tracking' mode draws any aim that is not the mouse, which this
// is - and anything that follows the aim follows it (brick breaker's paddle over its field, the comet).
// It starts from wherever the aim last was (the mouse, a tracker), or the middle of the screen.
//
// *** A CLICK IS DISPATCHED, AND IT SAYS SO. *** cursor.js deliberately never clicks: "whatever is
// producing the aim produces its presses through the input bus like every other device". That holds
// here - the command itself is a press on the input bus (`cursor/click`, bound, gated, logged) - and
// what it DOES is press the element under the aim, because nothing else could: there is no mouse
// button to press. The events carry `nimrodCursor: true`, and `input_pointer.js` skips them, so a
// person whose mouse button is bound to Select does not get a second action out of one "click".
//
// Scrolling finds the nearest thing under the cursor that can scroll (a list, a menu's page), and
// scrolls the page if nothing can. A shell-level piece like cursor.js, for cursor.js's reason: it acts
// on whatever is on screen, which no module may reach.

import { CURSOR_TOPICS } from './actions.js';

export const CURSOR_DEVICE = 'command';

// How far each command goes. PERCENT OF THE SCREEN'S SHORTER SIDE, so "a bit" up is as far as "a bit"
// left on a wide screen. Each argued, and each a setting (CURSOR_DRIVE_FIELDS):
//   stepSmall 4    about one large button at kiosk size: small enough to land on a thing, few enough
//                  steps (about twelve) to cross half the screen by voice.
//   stepLarge 20   a fifth of the screen: three or four commands corner to corner.
//   scrollPercent 60  most of a screen, keeping some of what was just read in view.
export const CURSOR_DRIVE_DEFAULTS = Object.freeze({ stepSmall: 4, stepLarge: 20, scrollPercent: 60 });
export const CURSOR_DRIVE_FIELDS = [
  { key: 'stepSmall', label: 'How far "cursor left" (a bit) moves it', kind: 'number', default: 4,
    level: 'advanced', min: 1, max: 15, step: 1, unit: '% of the screen' },
  { key: 'stepLarge', label: 'How far "cursor left a lot" moves it', kind: 'number', default: 20,
    level: 'advanced', min: 5, max: 50, step: 5, unit: '% of the screen' },
  { key: 'scrollPercent', label: 'How far "scroll down" goes', kind: 'number', default: 60,
    level: 'advanced', min: 10, max: 100, step: 10, unit: '% of what scrolls' },
];

const DIRS = Object.freeze({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : dflt);

/** The nearest element at or above `el` that can scroll vertically, else the page's scroller. */
export function scrollableFrom(el, doc = (typeof document !== 'undefined' ? document : null), view = (typeof window !== 'undefined' ? window : null)) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n === doc?.documentElement || n === doc?.body) break;
    const oy = view?.getComputedStyle ? view.getComputedStyle(n).overflowY : '';
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return doc?.scrollingElement || doc?.documentElement || null;
}

export function attachCursorDrive({
  bus,
  aim,
  settings = () => ({}),
  documentRef = (typeof document !== 'undefined' ? document : null),
  view = (typeof window !== 'undefined' ? window : null),
} = {}) {
  if (!bus) throw new Error('attachCursorDrive: a bus is required');
  if (!aim || typeof aim.report !== 'function') throw new Error('attachCursorDrive: an aim is required');

  const cfg = () => ({ ...CURSOR_DRIVE_DEFAULTS, ...(settings() || {}) });
  const size = () => ({ w: Number(view?.innerWidth) || 0, h: Number(view?.innerHeight) || 0 });
  // Where the cursor is now: the last aim from anything, or the middle of the screen.
  function here() {
    const a = aim.latest?.();
    return a ? { x: a.x, y: a.y } : { x: 0.5, y: 0.5 };
  }

  function move(p) {
    const d = DIRS[p?.dir];
    const { w, h } = size();
    if (!d || !w || !h) return null;
    const c = cfg();
    const pct = p?.size === 'large' ? num(c.stepLarge, CURSOR_DRIVE_DEFAULTS.stepLarge) : num(c.stepSmall, CURSOR_DRIVE_DEFAULTS.stepSmall);
    const px = Math.min(w, h) * clamp(pct, 0.5, 100) / 100;
    const at = here();
    return aim.report(CURSOR_DEVICE, clamp(at.x + (d[0] * px) / w, 0, 1), clamp(at.y + (d[1] * px) / h, 0, 1));
  }

  function underCursor() {
    const { w, h } = size();
    if (!w || !h || !documentRef?.elementFromPoint) return null;
    const at = here();
    const px = at.x * w;
    const py = at.y * h;
    const el = documentRef.elementFromPoint(px, py);
    return el ? { el, px, py } : null;
  }

  function click() {
    const t = underCursor();
    if (!t) return null;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: t.px, clientY: t.py, button: 0, view };
    const fire = (type, pointer) => {
      let ev;
      try {
        ev = pointer && typeof PointerEvent === 'function'
          ? new PointerEvent(type, { ...base, pointerType: 'mouse', isPrimary: true, buttons: type.endsWith('down') ? 1 : 0 })
          : new MouseEvent(type, { ...base, buttons: type.endsWith('down') ? 1 : 0 });
      } catch { ev = new MouseEvent(type, base); }
      ev.nimrodCursor = true;   // input_pointer.js skips it: see the header
      t.el.dispatchEvent(ev);
    };
    fire('pointerdown', true);
    fire('mousedown', false);
    // Something that takes typing or a key (a text box, a button) gets keyboard focus, as a real click gives it.
    const focusable = t.el.closest?.('input, textarea, select, button, a[href], [tabindex]');
    try { focusable?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
    fire('pointerup', true);
    fire('mouseup', false);
    fire('click', false);
    return t.el;
  }

  function scroll(p) {
    const dir = p?.dir === 'up' ? -1 : p?.dir === 'down' ? 1 : 0;
    if (!dir) return null;
    const t = underCursor();
    const s = scrollableFrom(t?.el || null, documentRef, view);
    if (!s) return null;
    const page = s === documentRef?.scrollingElement || s === documentRef?.documentElement;
    const span = page ? (Number(view?.innerHeight) || 0) : s.clientHeight;
    const by = dir * Math.round(span * clamp(num(cfg().scrollPercent, CURSOR_DRIVE_DEFAULTS.scrollPercent), 1, 100) / 100);
    try { s.scrollBy ? s.scrollBy({ top: by, behavior: 'auto' }) : (s.scrollTop += by); }
    catch { s.scrollTop += by; }
    return s;
  }

  // A command must never break the screen it is acting on (cursor.js's rule for the same layer).
  const safe = (fn) => (p) => { try { return fn(p); } catch (err) { console.error('cursor drive', err); return null; } };
  const offs = [
    bus.subscribe(CURSOR_TOPICS.move, safe(move)),
    bus.subscribe(CURSOR_TOPICS.click, safe(click)),
    bus.subscribe(CURSOR_TOPICS.scroll, safe(scroll)),
  ];

  return {
    move, click, scroll, here,
    destroy() { for (const off of offs) { try { off(); } catch { /* gone */ } } offs.length = 0; },
  };
}
