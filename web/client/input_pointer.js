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
// POSITION IS NOT AN INPUT HERE. Only buttons. Pointer position belongs to whatever the
// person is pointing AT, and a bus that turned mouse movement into actions would fight
// the page for control of the cursor. `axis`-style pointer movement is a separate feature
// (head-pointer dwell selection) and deliberately not this one.
//
// THE SAME RULE AS THE KEYBOARD, for the same reason: a click is only intercepted when
// something is bound to it, or while a capture is running. Otherwise the adapter would
// break every button on the page it is mounted in - including the one that started the
// capture.

export const POINTER_DEVICE = 'pointer:mouse';

// Named rather than numbered: "button 3" means nothing to a person, and a switch box
// wired to the middle button should read as something they can recognise.
export const BUTTON_LABELS = ['Left click', 'Middle click', 'Right click', 'Back', 'Forward'];

export function pointerControl(button) {
  return `button:${Number(button) || 0}`;
}

export function pointerLabel(control) {
  const m = String(control).match(/^button:(\d+)$/);
  if (!m) return control;
  return BUTTON_LABELS[Number(m[1])] || `Button ${m[1]}`;
}

export function attachPointer(input, { target = window, device = POINTER_DEVICE } = {}) {
  if (!input) throw new Error('attachPointer: an input bus is required');

  const wanted = (control) => input.isCapturing() || input.hasBinding(device, control);

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

  return () => {
    target.removeEventListener('mousedown', onDown);
    target.removeEventListener('mouseup', onUp);
    target.removeEventListener('contextmenu', onMenu);
    target.removeEventListener('mouseleave', onLeave);
    target.removeEventListener('blur', onLeave);
  };
}
