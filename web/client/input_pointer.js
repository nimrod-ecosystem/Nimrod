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

// *** TOUCH IS ITS OWN FIRST-CLASS DEVICE, NOT "MOUSE." *** Added 2026-09-12 — Mike's own
// example of a device that should be first-class was "keyboard, mouse, pointer, iPad." A
// touchscreen is not a mouse wearing a costume: it is a genuinely distinguishable input
// source, because `PointerEvent.pointerType` says which is which ('mouse' | 'touch' | 'pen') —
// unlike two USB keyboards, which the browser truly cannot tell apart (see input.js's own
// notes on that). So this is a REAL first-class device, buildable today with no agent and no
// WebHID: a tap on an iPad's screen and a click of a mouse plugged into the same machine are
// now two different, independently bindable devices on the bus.
export const TOUCH_DEVICE = 'pointer:touch';

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

// `pen` reads as a precision pointer for this product's purposes — nothing here treats
// handwriting or pressure specially — so it shares the mouse device rather than getting a
// third row nobody asked for. Only `touch` is genuinely a different device.
const deviceFor = (pointerType) => (pointerType === 'touch' ? TOUCH_DEVICE : POINTER_DEVICE);

export function attachPointer(input, { target = window, device = null, aim = null, ignore = null } = {}) {
  if (!input) throw new Error('attachPointer: an input bus is required');

  // `device` stays acceptable as a fixed override (a test, or a caller with no real
  // PointerEvent to read from) — when not given, the device is decided PER EVENT from
  // `pointerType`, which is the whole point of this file existing in its 2026-09-12 shape.
  const wanted = (dev, control) => input.isCapturing() || input.hasBinding(dev, control);

  // WHERE, as well as which button. Passive and never preventDefault'd: unlike a bound click,
  // a pointer moving is not something this adapter has any business intercepting — the page
  // still gets every move, hover still works, and text still selects.
  //
  // `pointermove`/`pointerdown`/`pointerup` rather than the mouse-only events: they are the
  // superset that also fires for touch and pen, WITH `pointerType` on every event — which is
  // the one thing a plain `mousedown` can never tell you, touch-synthesized or not.
  const onMove = aim ? (e) => { aim.reportEvent(device || deviceFor(e.pointerType), e); } : null;

  // `ignore(e)` — OPT-IN, absent everywhere except the binder page (`inputs.js`). Found
  // 2026-09-20: a switch that presents as a mouse click (this file's own header — "a $30
  // button from a hobby shop... arrives identically" to a real mouse) cannot be told apart
  // from an ordinary click ANYWHERE this adapter is attached. On the kiosk that is correct —
  // a module's own on-screen button IS the thing a switch should be able to press. On the
  // Devices/Inputs SETTINGS PAGE it is not: that page attaches this adapter to its whole
  // root so a real bound switch can be seen driving the binder live, but the same root also
  // holds the page's OWN controls (device chips, dropdowns, the add-a-binding button) — so
  // anyone whose switch is already bound to anything found every ordinary click on that page
  // ALSO fired as a real press, which the binder correctly acted on: it moved the scan
  // highlight and scrolled to it, mid-click, out from under whatever button they meant to
  // press. Not a click-handler bug (`inputs.js`'s own device-chip handler runs correctly
  // whenever this adapter lets a click through unmolested) — the fix belongs here, at the
  // one place that actually knows which element a press landed on.
  const onDown = (e) => {
    if (ignore?.(e)) return;
    const dev = device || deviceFor(e.pointerType);
    const control = pointerControl(e.button);
    if (!wanted(dev, control)) return;
    e.preventDefault();
    input.down(dev, control);
  };

  const onUp = (e) => {
    const dev = device || deviceFor(e.pointerType);
    const control = pointerControl(e.button);
    input.up(dev, control);
  };

  // A right-click that is bound must not also open the browser's menu over the top of
  // whatever it just did. Checked against both devices — a right-click binding may exist on
  // either, and this fires before pointerType is known to be relevant here.
  const onMenu = (e) => {
    if (wanted(POINTER_DEVICE, 'button:2') || wanted(TOUCH_DEVICE, 'button:2')) e.preventDefault();
  };

  // The pointer leaving the window mid-press means the pointerup lands somewhere else and
  // never arrives. Same class as the keyboard's blur, and released the same way: `auto`,
  // because drifting off the edge is not a decision to let go. Both devices, since either
  // could be mid-press when focus leaves.
  const onLeave = () => {
    for (const [dev, control] of input.heldControls()) {
      if (dev === POINTER_DEVICE || dev === TOUCH_DEVICE) input.up(dev, control, { auto: true });
    }
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('contextmenu', onMenu);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('blur', onLeave);
  if (onMove) target.addEventListener('pointermove', onMove, { passive: true });

  return () => {
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('contextmenu', onMenu);
    target.removeEventListener('pointerleave', onLeave);
    target.removeEventListener('blur', onLeave);
    if (onMove) target.removeEventListener('pointermove', onMove);
  };
}
