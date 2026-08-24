// input_keyboard.js - the keyboard as a device on the input bus.
//
// The first device adapter, and the one that makes "bindable" honest. Everything in this
// feature is meant to be bindable to whatever hardware someone has, but BINDABLE MUST
// NEVER MEAN ARRIVES UNCONFIGURED - a screen that does nothing until a caregiver maps it
// is useless at a bedside. So the shipped defaults live on the keyboard, and the
// gamepad/HID adapters that follow are additions, not prerequisites.
//
// An adapter's whole job is to turn a platform event into `down(device, control)` and
// `up(device, control)`. It makes no decisions - no edges, no timing, no roles. Those
// belong to input.js so that every device gets them identically.
//
// CONTROL NAMES are canonical and stable, because bindings persist against them:
// modifiers in a fixed order, then the key, lowercased - "key:ctrl+shift+e", "key:arrowright".
//
// THREE THINGS THAT LOOK LIKE DETAIL AND ARE NOT:
//   * `e.repeat` is ignored. A held key auto-repeats at the OS level; forwarding that
//     would fake a machine-gun of presses the person never made and poison the
//     false-activation numbers with the platform's own behaviour.
//   * `blur` releases everything. Hold a key, alt-tab, let go - the keyup lands in
//     another window and never arrives here. That is a stuck key by any other name, and
//     the max-hold watchdog would eventually paper over it 12 seconds later.
//   * Default is only prevented when something is actually bound. An unbound keystroke
//     has to keep working, or the adapter breaks typing everywhere on the page.
//
// TYPING IS NOT INPUT. Keystrokes inside a text field belong to the field. The adapter
// stands down whenever the focus is somewhere a person is writing.

import { ROLE_CYCLE_ACTION, verbTopic } from './actions.js';

export const KEYBOARD_DEVICE = 'keyboard';

// Fixed order so the same chord always produces the same string.
export function keyControl(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (e.metaKey) mods.push('meta');
  const key = String(e.key || '').toLowerCase();
  if (['control', 'alt', 'shift', 'meta'].includes(key)) return null;  // a bare modifier is not a control
  return `key:${[...mods, key].join('+')}`;
}

const EDITABLE = ['input', 'textarea', 'select'];
function isTyping(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return EDITABLE.includes(tag) || target.isContentEditable === true;
}

// THE SHIPPED DEFAULTS. Arrows, Enter, and left/right to change panel - a TV remote,
// because that is the interaction model a scanning or single-switch user already lives
// in, and because it means a screen (and the binder itself) can be DRIVEN before anyone
// has configured anything.
//
// The gate toggle is Ctrl+Shift+E, not the F1 the original spec asked for: F1 is
// browser-reserved (Help), and this project's rule is that the dashboard behaves the same
// in desktop dev as in the Pi kiosk - a key the browser eats fails that on one side only.
// It follows the Ctrl+Shift+L precedent Cici set for its edit toggle.
//
// ESCAPE IS DELIBERATELY LEFT FREE for the universal settings menu.
//
// All of these are ordinary bindings: rebind them, or move them onto a switch, and the
// keyboard simply stops being the only way in.
const kb = (id, control, actionId, label) => ({
  id, actionId, device: KEYBOARD_DEVICE, control,
  edge: 'press', role: 'universal', holdMs: 0, debounceMs: 0, lockoutMs: 0, label,
});

export const DEFAULT_BINDINGS = [
  kb('default/role-cycle', 'key:ctrl+shift+e', ROLE_CYCLE_ACTION, 'Cycle who may act'),
  kb('default/next', 'key:arrowdown', verbTopic('next'), 'Next'),
  kb('default/prev', 'key:arrowup', verbTopic('prev'), 'Previous'),
  kb('default/select', 'key:enter', verbTopic('select'), 'Primary select'),
  kb('default/focus-next', 'key:arrowright', verbTopic('focus-next'), 'Next panel'),
  kb('default/focus-prev', 'key:arrowleft', verbTopic('focus-prev'), 'Previous panel'),
];

export function attachKeyboard(input, { target = window, device = KEYBOARD_DEVICE } = {}) {
  if (!input) throw new Error('attachKeyboard: an input bus is required');

  const onDown = (e) => {
    if (e.repeat || isTyping(e.target)) return;
    const control = keyControl(e);
    if (!control) return;
    // WHILE CAPTURING, FORWARD EVERYTHING. The "only bound keys" rule below is what makes
    // an unbound keystroke keep working normally — but during a capture the whole point is
    // that the control is NOT bound yet, so that rule silently ate every key and "press a
    // control" did nothing at all. Capture has to see keys the bus has never heard of.
    if (!input.isCapturing() && !input.hasBinding(device, control)) return;
    e.preventDefault();
    input.down(device, control);
  };

  // Released with modifiers already lifted ("ctrl+shift+e" down, shift up, e up) would
  // compute a DIFFERENT control name and orphan the press. So a keyup releases every
  // held control whose base key matches, regardless of the modifiers still down.
  const baseKey = (control) => control.replace(/^key:/, '').split('+').pop();

  const onUp = (e) => {
    const key = String(e.key || '').toLowerCase();
    for (const [dev, control] of input.heldControls()) {
      if (dev !== device) continue;
      if (baseKey(control) === key) input.up(dev, control);
    }
  };

  // Alt-tabbing away is not letting go, so this releases as `auto` - same class as the
  // max-hold watchdog. A release-edge binding must not fire because someone switched
  // windows; that is a false activation, and it gets logged as one.
  const onBlur = () => {
    for (const [dev, control] of input.heldControls()) {
      if (dev === device) input.up(dev, control, { auto: true });
    }
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);

  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}
