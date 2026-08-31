// cursor.js — THE CURSOR: the one thing on screen that shows where the aim is.
//
// `aim.js` says WHERE somebody is pointing. This draws it. They are separate files because
// they fail separately: a screen with no cursor still routes the aim to a module that wants
// one, and a cursor with no aim is simply not shown.
//
// ---------------------------------------------------------------------------------------
// WHY THE SYSTEM CURSOR IS NOT ENOUGH, which is the obvious first objection
// ---------------------------------------------------------------------------------------
//
// A mouse pointer is about 12 px of thin grey arrow, drawn by the operating system, and:
//
//   * it is TOO SMALL for somebody with a brain injury looking at a screen across a room.
//     Every AAC and low-vision product on the market ships a large high-contrast pointer for
//     exactly this reason, and the OS setting for it is buried three menus deep on every
//     platform and does not travel with the person to the next machine.
//   * it CANNOT BE STYLED past a handful of stock shapes, so it cannot follow the person's
//     theme, and it cannot be made to read against both a bright photo and a dark video.
//   * IT DOES NOT EXIST FOR A TRACKER. A hand in front of a camera moves nothing the OS knows
//     about. The bedside build this ports from solved that by synthesising `mousemove` events
//     so the OS-adjacent cursor followed — a real trick that worked, and one that hides the
//     input from everything that wants to reason about it. Drawing our own is both simpler
//     and more honest.
//
// So the cursor is ours, it is a setting, and it is the same cursor whatever is driving it.
//
// ---------------------------------------------------------------------------------------
// IT IS SHELL-LEVEL, NOT A MODULE, and that is a deliberate exception worth defending
// ---------------------------------------------------------------------------------------
//
// Almost everything in this product is a module. This is not, for the same reason
// `press_overlay.js` is not: it has to draw ON TOP of whichever module is under it, and a
// module that could draw outside its own `ctx.mount` would break the one rule that lets two
// copies of anything share a screen. The shell owns the layer; modules stay honest.
//
// It follows press_overlay's shape exactly — mount into a root, read a settings getter, one
// bus subscription, `destroy()` puts everything back — so there is one pattern for "a thing
// the shell draws over everything", not two.
//
// ---------------------------------------------------------------------------------------
// WHAT IT DOES NOT DO
// ---------------------------------------------------------------------------------------
//
// * NO CLICKING. It is `pointer-events: none` and it never dispatches anything. Whatever is
//   producing the aim produces its presses through the input bus like every other device, so
//   a click has a binding, a role, timing and a log entry — none of which a synthetic event
//   would have had.
// * NO SMOOTHING, for the reason `aim.js` gives: it belongs to the producer, and adding it
//   here would make a mouse laggy to help a tracker that should be smoothing itself.
// * NO HIDING THE SYSTEM CURSOR BY DEFAULT. On a desktop, where somebody is using a real
//   mouse, taking their pointer away is rude and confusing. On a kiosk it is exactly right.
//   So it is a setting, and the kiosk is where it gets turned on.

export const CURSOR_DEFAULTS = {
  // *** THE DEFAULT IS "tracking", AND IT IS THE ANSWER TO THE TWO-CURSORS PROBLEM. ***
  //
  // A mouse already draws a pointer. Drawing a second one on top of it by default would give
  // every desktop visitor two cursors, one of them lagging the other by a frame — which looks
  // exactly like a bug and would be the first thing anybody noticed about this feature.
  //
  // But a hand tracker moves NOTHING the operating system knows about, so on that screen there
  // is no pointer at all unless we draw one. Those are the two real cases and they want
  // opposite answers, so the default distinguishes them by WHO IS AIMING rather than picking
  // one and being wrong half the time.
  //
  //   'tracking'  draw it only when something other than a mouse is aiming   (default)
  //   'always'    draw it whatever is aiming — for somebody who wants a big pointer with a
  //               mouse too, which is a real want and the reason this is not a boolean
  //   'never'     off
  show: 'tracking',
  size: 44,             // px across. Big, because the person this is for is looking from a bed.
  style: 'ring',        // 'ring' | 'dot' | 'crosshair'
  colour: '#F7C948',    // amber, the bedside build's colour, and readable on photos and video
  hideSystem: false,    // take the OS pointer away as well (kiosk: reasonable; desktop: rude)
  // A cursor that stays on screen forever after somebody stopped pointing is clutter, and on
  // a 24/7 panel it is also a static bright shape sitting in one spot. 0 = never fade.
  idleMs: 0,
};

export const STYLES = ['ring', 'dot', 'crosshair'];
export const SHOW_MODES = ['tracking', 'always', 'never'];

// Devices the operating system already draws a pointer for. A device NOT in this list — a hand
// tracker, a coloured marker, a head pointer reporting through the aim rather than as a mouse —
// has nothing on screen unless this file draws it.
export const SYSTEM_DRAWN = ['pointer:mouse'];

// Declared as DATA so the shell renders it and a one-button cursor can walk it — the same
// rule every module setting follows, and the reason markup would not do. Sizes are named
// rather than numeric for the reason photos' interval is: with one switch you travel one way,
// one press at a time, so the NUMBER OF STOPS is the cost.
export const SETTINGS = [
  { key: 'show', label: 'Show a big cursor', kind: 'choice', default: 'tracking', level: 'standard',
    options: [
      { value: 'tracking', label: 'when hand or marker tracking is driving it' },
      { value: 'always', label: 'always, including with a mouse' },
      { value: 'never', label: 'never' },
    ] },
  { key: 'size', label: 'Cursor size', kind: 'choice', default: 44, level: 'standard',
    options: [
      { value: 28, label: 'small' },
      { value: 44, label: 'medium' },
      { value: 72, label: 'large' },
      { value: 110, label: 'very large' },
    ] },
  { key: 'style', label: 'Cursor shape', kind: 'choice', default: 'ring', level: 'standard',
    options: [
      { value: 'ring', label: 'ring' },
      { value: 'dot', label: 'dot' },
      { value: 'crosshair', label: 'crosshair' },
    ] },
  { key: 'colour', label: 'Cursor colour', kind: 'choice', default: '#F7C948', level: 'standard',
    options: [
      { value: '#F7C948', label: 'amber' },
      { value: '#4CC9F0', label: 'blue' },
      { value: '#B5E48C', label: 'green' },
      { value: '#FFFFFF', label: 'white' },
      { value: '#111111', label: 'black' },
    ] },
];

// A ring is drawn as a ring rather than a filled circle on purpose: it does not hide what it is
// pointing at, which matters when the thing under it is a photograph of somebody's family.
// Every style carries a dark outline as well as its colour, so it reads against a white sheet
// and a night sky without the person having to change it — the "do not use colour alone" rule
// in module-input-spec, applied to contrast rather than meaning.
function paint(el, cfg) {
  const size = Math.max(8, Number(cfg.size) || CURSOR_DEFAULTS.size);
  const colour = String(cfg.colour || CURSOR_DEFAULTS.colour);
  const style = STYLES.includes(cfg.style) ? cfg.style : 'ring';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.marginLeft = `${-size / 2}px`;
  el.style.marginTop = `${-size / 2}px`;
  el.dataset.style = style;
  el.style.setProperty('--cur-colour', colour);
  el.style.setProperty('--cur-ring', `${Math.max(2, Math.round(size / 11))}px`);
}

export function mountCursor(root, {
  bus,
  aimTopic = 'input/aim',
  settings = () => ({}),
  // The aim handle, if there is one. Used ONLY to place the cursor at the last known aim on
  // mount — a person whose movement is slow and effortful should not have to move again just
  // because a panel was swapped underneath them.
  aim = null,
  systemDrawn = SYSTEM_DRAWN,
  documentRef = (typeof document !== 'undefined' ? document : null),
  view = (typeof window !== 'undefined' ? window : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!root) throw new Error('mountCursor: a root element is required');
  if (!bus) throw new Error('mountCursor: a bus is required');

  root.innerHTML = '<div class="cur" data-cur hidden aria-hidden="true"></div>';
  const el = root.querySelector('[data-cur]');

  // *** STRUCTURE INLINE, APPEARANCE IN CSS — and the split is a safety one. ***
  //
  // Everything about how the cursor LOOKS lives in modules.css, which is right: it is design,
  // it wants to be themeable, and it is easy to read there. But three properties are not
  // decoration, and a page that mounts this without that stylesheet would be actively broken
  // rather than merely plain:
  //
  //   pointer-events:none — WITHOUT THIS THE CURSOR EATS EVERY CLICK on the screen it is
  //                         pointing at. It is a big element that follows the pointer, so it
  //                         sits under the mouse by definition. Caught by a test whose page
  //                         did not load the stylesheet, which is exactly the situation this
  //                         guards against.
  //   position:fixed      — otherwise it is in normal flow and shoves the page around.
  //   z-index             — otherwise it is drawn under the thing it is pointing at.
  //
  // So those three are set here where they cannot go missing, and the stylesheet may restate
  // them harmlessly.
  el.style.position = 'fixed';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '60';
  let idleTimer = null;
  let at = null;                 // last aim actually drawn
  let systemHidden = false;

  const cfg = () => ({ ...CURSOR_DEFAULTS, ...(settings() || {}) });

  // The system pointer is hidden on the DOCUMENT rather than on our root, because our root is
  // `pointer-events:none` and the pointer is never over it — styling ourselves would do
  // nothing at all. Restored on destroy, and only ever touched when the setting asks.
  function syncSystem(want) {
    const body = documentRef?.body;
    if (!body) return;
    if (want && !systemHidden) { body.dataset.hideSystemCursor = '1'; systemHidden = true; }
    else if (!want && systemHidden) { delete body.dataset.hideSystemCursor; systemHidden = false; }
  }

  function hide() { el.hidden = true; }

  // Should this aim be drawn? An unknown `show` value draws it rather than not — a cursor that
  // silently vanished because a setting was mistyped is much harder to diagnose than one that
  // is unexpectedly present.
  function wanted(a, c) {
    if (c.show === 'never') return false;
    if (c.show === 'tracking') return !!a && !systemDrawn.includes(a.device);
    return true;
  }

  function place(a) {
    const c = cfg();
    const want = wanted(a, c);
    syncSystem(!!c.hideSystem && want);
    if (!want || !a) { hide(); return null; }
    const w = Number(view?.innerWidth) || 0;
    const h = Number(view?.innerHeight) || 0;
    if (!w || !h) { hide(); return null; }
    paint(el, c);
    el.style.left = `${a.x * w}px`;
    el.style.top = `${a.y * h}px`;
    el.hidden = false;
    at = { ...a };

    clearTimer(idleTimer); idleTimer = null;
    const idle = Math.max(0, Number(c.idleMs) || 0);
    if (idle > 0) idleTimer = setTimer(hide, idle);
    return at;
  }

  // An overlay must never be able to break the screen it is drawn on — the same catch
  // press_overlay uses, and for the same reason.
  const off = bus.subscribe(aimTopic, (a) => { try { place(a); } catch { /* never fatal */ } });

  // Pick up an aim that already happened, so a freshly mounted shell is not blank.
  const seed = aim?.latest?.();
  if (seed) { try { place(seed); } catch { /* never fatal */ } }

  return {
    place,                                   // exposed so a settings preview can move it
    hide,
    at: () => (at ? { ...at } : null),
    isVisible: () => !el.hidden,
    // Re-read the settings without waiting for the next movement, so changing the size in a
    // panel shows the new size immediately rather than the next time somebody moves.
    refresh: () => place(at),
    destroy() {
      clearTimer(idleTimer);
      try { off(); } catch { /* already gone */ }
      syncSystem(false);
      root.innerHTML = '';
    },
  };
}
