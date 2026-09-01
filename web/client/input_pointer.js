// input_pointer.js - a mouse, trackball or head-pointer as a device on the input bus.
//
// The adapter that looks least like assistive tech and is used by more people than any
// other. A great many switch interfaces present themselves to the computer as a MOUSE
// CLICK - it is the cheapest thing a switch box can emulate, so a $30 button from a
// hobby shop and a $300 clinical switch often arrive at the browser identically. Anyone
// who can operate a trackball, a head pointer or one oversized button is on this path,
// and none of them own a game controller.
//
// It also means the binder can be tried out by someone with nothing plugged in at all,
// which matters more than it sounds: a person evaluating this product on a laptop should
// not have to buy hardware to find out whether it works.
//
// POSITION IS NOT AN ACTION HERE, AND STILL IS NOT. Only buttons are bound. A bus that turned
// mouse movement into actions would fight the page for control of the cursor, and nothing
// below does that.
//
// *** WHAT CHANGED, 2026-08-30. *** This note used to read "POSITION IS NOT AN INPUT HERE",
// and it was too strong by one word. A position is not an ACTION, but it is plainly an input —
// two modules had already invented it privately (`comet.js`, and `pond.js`, which named its
// local copy `aim()`) because there was nowhere to get it from. `aim.js` now owns the concept,
// as a SIBLING of the input bus rather than a part of it, and this adapter is its first
// producer: the mouse reports WHERE as well as WHICH BUTTON, so a hand tracker added later is
// not on a separate path from a mouse. Read `aim.js` before adding a second producer — why it
// carries no binding, no debounce and no smoothing is all written down there.
//
// Reporting is OPT-IN at the call site (`attachPointer(input, { aim })`) and absent otherwise,
// so anything constructing this adapter without one behaves exactly as it did.
//
// THE SAME RULE AS THE KEYBOARD, for the same reason: a click is only intercepted when
// something is bound to it, or while a capture is running. Otherwise the adapter would
// break every button on the page it is mounted in - including the one that started the
// capture.

export const POINTER_DEVICE = 'pointer:mouse';

// Named rather than numbered: "button 3" means nothing to a person, and a switch box
// wired to the middle button should read as something they can recognize.
export const BUTTON_LABELS = ['Left click', 'Middle click', 'Right click', 'Back', 'Forward'];

export function pointerControl(button) {
  return `button:${Number(button) || 0}`;
}

export function pointerLabel(control) {
  const m = String(control).match(/^button:(\d+)$/);
  if (!m) return control;
  return BUTTON_LABELS[Number(m[1])] || `Button ${m[1]}`;
}

export function attachPointer(input, { target = window, device = POINTER_DEVICE, aim = null } = {}) {
  if (!input) throw new Error('attachPointer: an input bus is required');

  const wanted = (control) => input.isCapturing() || input.hasBinding(device, control);

  // WHERE, as well as which button. Passive and never preventDefault'd: unlike a bound click,
  // a mouse moving is not something this adapter has any business intercepting — the page
  // still gets every move, hover still works, and text still selects.
  //
  // `mousemove` rather than `pointermove` to match the button listeners below, so a device
  // that reports as a mouse reports its position through the same door as its clicks.
  const onMove = aim ? (e) => { aim.reportEvent(device, e); } : null;

  const onDown = (e) => {
    const control = pointerControl(e.button);
    if (!wanted(control)) return;
    e.preventDefault();
    input.down(device, control);
  };

  const onUp = (e) => {
    const control = pointerControl(e.button);
    input.up(device, control);
  };

  // A right-click that is bound must not also open the browser's menu over the top of
  // whatever it just did.
  const onMenu = (e) => { if (wanted('button:2')) e.preventDefault(); };

  // The pointer leaving the window mid-press means the mouseup lands somewhere else and
  // never arrives. Same class as the keyboard's blur, and released the same way: `auto`,
  // because drifting off the edge is not a decision to let go.
  const onLeave = () => {
    for (const [dev, control] of input.heldControls()) {
      if (dev === device) input.up(dev, control, { auto: true });
    }
  };

  target.addEventListener('mousedown', onDown);
  target.addEventListener('mouseup', onUp);
  target.addEventListener('contextmenu', onMenu);
  target.addEventListener('mouseleave', onLeave);
  target.addEventListener('blur', onLeave);
  if (onMove) target.addEventListener('mousemove', onMove, { passive: true });

  return () => {
    target.removeEventListener('mousedown', onDown);
    target.removeEventListener('mouseup', onUp);
    target.removeEventListener('contextmenu', onMenu);
    target.removeEventListener('mouseleave', onLeave);
    target.removeEventListener('blur', onLeave);
    if (onMove) target.removeEventListener('mousemove', onMove);
  };
}
