// input_gamepad.js - the Gamepad API as a device on the input bus.
//
// THIS IS THE ONE THAT MATTERS, and not because anyone here is playing games. The Xbox
// Adaptive Controller turned the 3.5mm switch jack into a de facto standard: nineteen
// jacks on the back, and whatever assistive switch someone already owns plugs into one.
// To the browser the whole assembly is an ordinary standard-mapping gamepad. So this one
// adapter - no permission prompt, no chooser dialog, no driver - is how a person's
// existing switches reach every action in the catalog.
//
// It is also the adapter with the fewest ways to fail at a bedside, which is why it comes
// before WebHID and WebSerial: those need a user gesture and a device-picker dialog EVERY
// time the page reloads, and nobody is standing in the room after a power cut.
//
// FOUR THINGS THE GAMEPAD API MAKES YOU DEAL WITH:
//
// 1. IT IS POLLED, NOT EVENTED. There is no "buttondown". You read a snapshot and diff it
//    against the last one. `poll()` is public so tests drive it a frame at a time instead
//    of racing an animation loop.
//
// 2. THE INDEX IS NOT AN IDENTITY. `navigator.getGamepads()[0]` is whichever pad landed
//    in slot 0 this session. Bindings are SAVED against the device name, so keying off
//    the index would silently re-point a caregiver's whole profile after a reboot or a
//    replug. The device name is derived from the USB vendor and product instead
//    ("gamepad:045e0b0a"), which survives both. Two IDENTICAL controllers cannot be told
//    apart - the API exposes no serial - so the second gets a "#2" suffix by connection
//    order, and that is a real limitation rather than a solved problem.
//
// 3. A GAMEPAD IS INVISIBLE UNTIL IT IS USED. For privacy reasons browsers hide gamepads
//    until the first input arrives from one. So after every reboot the FIRST press is
//    also the press that reveals the device. We let that press through: the pad appears
//    with its button already down, we have no previous state, and a rising edge fires.
//    The alternative - snapshotting a newly seen pad as the baseline - would eat that
//    press and make someone press twice after every restart, which for a person using
//    one switch is not a rough edge, it is the difference between working and not.
//
// 4. ANALOG DRIFT. A worn stick sits at 0.06 forever and a plain threshold turns that
//    into a machine gun. Axes cross into "pressed" at `enterAt` and only fall out below
//    `exitAt` - hysteresis, not a single line.
//
// A DISCONNECT RELEASES AS `auto`. The controller being unplugged is not someone letting
// go, so a release-edge binding must not fire; it is logged as the false activation it
// would have been. Same reasoning as the max-hold watchdog and the window blur.
//
// THE POLL ONLY RUNS WHILE A PAD IS CONNECTED (2026-10-02). It used to be a
// requestAnimationFrame loop that started on every page and never stopped, pad or no pad -
// 60 callbacks a second on a screen with nothing plugged in. A pending rAF callback is not
// free: it makes the browser run a rendering pass every frame, and on the Pi that pass
// restyled every running animation and re-laid-out the cat's SVG each frame (the 2D-room
// speed-up measured 0.2-0.55 of a core going to it). So now:
//   - `start()` only LISTENS. It checks `getGamepads()` once (a pad already revealed this
//     session would never fire `gamepadconnected` again) and otherwise waits for the event.
//   - `gamepadconnected` polls AT ONCE - Chrome fires it on the very press that reveals the
//     pad, and that press must not wait for a tick (point 3 above) - then starts the loop.
//   - `gamepaddisconnected` polls once (so the yanked pad is released as `auto`, as before)
//     and stops the loop when no pad is left.
//   - The loop never stops ITSELF on an empty poll: if a browser fired the connect event a
//     beat before `getGamepads()` showed the pad, that would strand the person's switch until
//     a replug. A missed disconnect event costs a loop that keeps running - the old behaviour,
//     not a lost press.
// AND IT IS A TIMER, NOT rAF. Same latency - `pollMs` 16 is one 60 Hz frame, and on a Pi
// compositing at 30 Hz rAF would be 33 ms - without forcing a rendering pass per tick; a
// press that changes the page schedules its own frame. A timer also runs in a hidden document,
// where rAF never fires, so the suites test the real loop. The one thing rAF gave for free,
// pausing in a background tab, the browser does to timers too (throttled), and Chrome only
// exposes gamepad input to a visible, focused page anyway. `pollMs` is a parameter with a
// default, not a constant: the XAC user is exactly the one who has a pad in all day, so this
// is the rate that costs them CPU, and it is theirs to trade against latency.

export const GAMEPAD_PREFIX = 'gamepad';
export const GAMEPAD_POLL_MS = 16;

// The W3C standard mapping, in index order. Only meaningful when `mapping === 'standard'`,
// which the XAC reports. Used for labels in the binder - "press A" beats "press button 0".
export const STANDARD_BUTTONS = [
  'A', 'B', 'X', 'Y', 'Left bumper', 'Right bumper', 'Left trigger', 'Right trigger',
  'Back', 'Start', 'Left stick', 'Right stick',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Guide',
];
export const STANDARD_AXES = ['Left stick X', 'Left stick Y', 'Right stick X', 'Right stick Y'];

// Chrome: "... (STANDARD GAMEPAD Vendor: 045e Product: 0b0a)"
// Firefox: "045e-0b0a-Xbox Adaptive Controller"
export function gamepadKey(id) {
  const s = String(id || '');
  const chrome = s.match(/vendor:\s*([0-9a-f]{4})\s+product:\s*([0-9a-f]{4})/i);
  if (chrome) return `${GAMEPAD_PREFIX}:${chrome[1].toLowerCase()}${chrome[2].toLowerCase()}`;
  const firefox = s.match(/^([0-9a-f]{4})-([0-9a-f]{4})/i);
  if (firefox) return `${GAMEPAD_PREFIX}:${firefox[1].toLowerCase()}${firefox[2].toLowerCase()}`;
  // No vendor/product anywhere: fall back to a slug of the name. Still stable across
  // reconnects, which is the property that actually matters.
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return `${GAMEPAD_PREFIX}:${slug || 'unknown'}`;
}

// What the binder shows next to a captured control.
export function controlLabel(control, { mapping = 'standard' } = {}) {
  const btn = String(control).match(/^button:(\d+)$/);
  if (btn) {
    const name = mapping === 'standard' ? STANDARD_BUTTONS[Number(btn[1])] : null;
    return name || `Button ${btn[1]}`;
  }
  const ax = String(control).match(/^axis:(\d+)([+-])$/);
  if (ax) {
    const name = (mapping === 'standard' ? STANDARD_AXES[Number(ax[1])] : null) || `Axis ${ax[1]}`;
    return `${name} ${ax[2]}`;
  }
  return control;
}

export function createGamepads({
  input,
  nav = typeof navigator !== 'undefined' ? navigator : null,
  enterAt = 0.5,          // an axis counts as pressed past this...
  exitAt = 0.35,          // ...and stays pressed until it falls below this
  pollMs = GAMEPAD_POLL_MS,
  schedule = (fn) => setTimeout(fn, pollMs),
  unschedule = (id) => clearTimeout(id),
  // Where `gamepadconnected` / `gamepaddisconnected` arrive. A test hands in its own target.
  events = typeof window !== 'undefined' ? window : null,
  onConnect = null,
  onDisconnect = null,
} = {}) {
  if (!input) throw new Error('createGamepads: an input bus is required');

  const slots = new Map();   // gamepad index -> {device, id, mapping}
  const state = new Map();   // "device control" -> boolean
  let loop = null;
  let listening = false;

  const supported = () => !!(nav && typeof nav.getGamepads === 'function');

  function anyConnected() {
    if (!supported()) return false;
    for (const gp of nav.getGamepads() || []) if (gp && gp.connected !== false) return true;
    return false;
  }

  function claim(index, gp) {
    const existing = slots.get(index);
    if (existing && existing.id === gp.id) return existing;
    if (existing) drop(index);

    // Disambiguate identical twins by connection order. Unavoidable: no serial exposed.
    const base = gamepadKey(gp.id);
    let device = base;
    for (let n = 2; [...slots.values()].some((s) => s.device === device); n++) device = `${base}#${n}`;

    const slot = { device, id: gp.id, mapping: gp.mapping || '', index };
    slots.set(index, slot);
    onConnect?.({ ...slot });
    return slot;
  }

  function drop(index) {
    const slot = slots.get(index);
    if (!slot) return;
    // Unplugged is not let go. Release everything it held, as `auto`, so a release-edge
    // binding does not fire on a yanked cable.
    for (const [key, on] of [...state.entries()]) {
      if (!on || !key.startsWith(`${slot.device} `)) continue;
      state.set(key, false);
      input.up(slot.device, key.slice(slot.device.length + 1), { auto: true });
    }
    slots.delete(index);
    onDisconnect?.({ ...slot });
  }

  function edge(device, control, pressed) {
    const key = `${device} ${control}`;
    if (!!state.get(key) === pressed) return;
    state.set(key, pressed);
    pressed ? input.down(device, control) : input.up(device, control);
  }

  // Hysteresis: crossing in and falling out use different thresholds, so a stick resting
  // near the line does not chatter.
  function axisEdge(device, control, magnitude) {
    const key = `${device} ${control}`;
    const was = !!state.get(key);
    edge(device, control, was ? magnitude >= exitAt : magnitude >= enterAt);
  }

  function poll() {
    if (!supported()) return;
    const pads = nav.getGamepads() || [];
    const seen = new Set();

    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp || gp.connected === false) continue;
      seen.add(i);
      const { device } = claim(i, gp);

      const buttons = gp.buttons || [];
      for (let b = 0; b < buttons.length; b++) {
        edge(device, `button:${b}`, !!(buttons[b] && buttons[b].pressed));
      }
      const axes = gp.axes || [];
      for (let a = 0; a < axes.length; a++) {
        const v = Number(axes[a]) || 0;
        axisEdge(device, `axis:${a}+`, v);
        axisEdge(device, `axis:${a}-`, -v);
      }
    }

    for (const index of [...slots.keys()]) if (!seen.has(index)) drop(index);
  }

  function tick() {
    loop = null;
    poll();
    if (listening && loop == null) loop = schedule(tick);
  }
  function wake() { if (listening && loop == null) loop = schedule(tick); }
  function halt() { if (loop != null) { unschedule(loop); loop = null; } }

  function onConnected() {
    if (!listening) return;
    poll();          // the press that revealed the pad lands now, not one tick later
    wake();
  }
  function onDisconnected() {
    if (!listening) return;
    poll();          // drops the slot and releases what it held, as `auto`
    if (!anyConnected()) halt();
  }

  function start() {
    if (!supported()) return false;
    if (!listening) {
      listening = true;
      events?.addEventListener?.('gamepadconnected', onConnected);
      events?.addEventListener?.('gamepaddisconnected', onDisconnected);
    }
    if (anyConnected()) wake();
    return true;
  }
  function stop() {
    if (listening) {
      listening = false;
      events?.removeEventListener?.('gamepadconnected', onConnected);
      events?.removeEventListener?.('gamepaddisconnected', onDisconnected);
    }
    halt();
  }

  return {
    start, stop, poll, supported,
    // For the binder: what is plugged in right now, with enough to render a control list.
    list: () => [...slots.values()].map((s) => ({ ...s })),
    // `running` = the poll loop is scheduled (a pad is connected); `listening` = started and
    // waiting for one.
    running: () => loop != null,
    listening: () => listening,
    destroy() { stop(); for (const i of [...slots.keys()]) drop(i); state.clear(); },
  };
}
