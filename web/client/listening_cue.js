// listening_cue.js — WHAT HAPPENS WHEN THE SCREEN HEARS ITS WAKE PHRASE.
//
// Rows 2.28 and 2.36. Mike, 2026-09-30, on the "I'm listening" cue: *"This needs to be a setting.
// What do most things do for this? Is there a tone by default. I could see like a visual que on
// the screen also."* And on the video (AJ1): YouTube plays through a DIFFERENT speaker from the
// speakerphone, so the speakerphone's echo cancelling cannot remove it - duck the video while
// listening.
//
// `input_speech.js` announces the listening window on `speech/listening` and draws nothing. This
// file is three subscribers to that one event, each on its own and each a setting:
//
//   * THE CUE     a small "Listening" pill at the top of the screen. Non-modal: it takes no
//                 focus and `pointer-events:none`, so it can never block a press.
//   * THE TONE    one short earcon when the window opens.
//   * THE DUCK    the audio bus drops media while the window is open, so the microphone can hear
//                 the person over the video; it comes back the moment the window closes.
//
// *** EVERY ONE HAS ITS OWN WATCHDOG. *** The window's closing event is the normal way out; if it
// never arrives (a bus hiccup, a recogniser that died mid-window), each subscriber gives up on its
// own a little after the window's own length, and never later than `maxMs`. A cue stuck on screen
// is a small lie; a video stuck ducked is the audio bus's cardinal failure - quiet for no reason
// anybody in the room can see - and the bus's rule is that a failure never silences.
//
// *** ALL THREE ON BY DEFAULT, AND THE TONE IS THE ONE TO WATCH. *** What most do [verified
// 2026-09-30, How-To Geek, via row 2.36]: an Echo plays no sound by default and lights its ring.
// So the visual cue ON matches what people know. The tone ON departs from it, on purpose: in a
// house people glance at the light, but somebody lying in bed may not be looking at the screen,
// and the tone tells them to go on speaking. Row 2.36 asks Mike whether ON is right for everyone
// or only for her; it ships ON and is one setting either way. The duck ON because without it the
// video the command is ABOUT is the loudest thing the microphone hears.

import { LISTENING_TOPIC } from './input_speech.js';
import { DUCK_TO } from './audio_bus.js';
import { createSoundChannel } from './output_channels.js';

export const LISTENING_DEFAULTS = Object.freeze({
  visual: true,
  // OFF by default -- Mike, 2026-09-30 (row 2.39): "I feel like the tone would more likely confuse
  // her or throw her off." The visual cue carries "I heard you"; the tone stays one setting away.
  tone: false,
  duck: true,
  // How far the video drops while listening: the bus's own duck depth (Mike chose 0.5 on Cici for
  // a voice over a music bed). Whether that is enough for a Pi's recogniser to hear somebody over
  // a video is a BENCH measurement (row 2.28 test order), not something to guess here - so it is
  // a setting, and the bench number replaces this one.
  duckTo: DUCK_TO,
  // A subscriber that hears the window open and never hears it close gives up this long after the
  // window's own length...
  graceMs: 2000,
  // ...and never later than this, whatever the event claimed. Thirty seconds: well past any
  // window anybody would set, short enough that a stuck duck is a blip and not an afternoon.
  maxMs: 30000,
  label: 'Listening',
});

// *** THE SETTINGS, declared for the host's menu (the PERSON level: they are about how this
// person wants to be answered, and follow them). ***
export const LISTENING_FIELDS = [
  { key: 'listenVisual', label: 'Show “Listening” when the wake phrase is heard', kind: 'toggle',
    default: LISTENING_DEFAULTS.visual, level: 'standard' },
  { key: 'listenTone', label: 'Play a tone when the wake phrase is heard', kind: 'toggle',
    default: LISTENING_DEFAULTS.tone, level: 'standard' },
  { key: 'listenDuck', label: 'Turn videos down while listening', kind: 'toggle',
    default: LISTENING_DEFAULTS.duck, level: 'advanced' },
];

const clampLimit = (ms, graceMs, maxMs) => {
  const n = Number(ms);
  return Math.min(maxMs, Number.isFinite(n) && n >= 0 ? n + graceMs : maxMs);
};

// A small watchdog shared by all three: `arm(ms)` (re)starts it, `disarm()` stops it.
function watchdog({ onExpire, setTimer, clearTimer, graceMs, maxMs }) {
  let id = null;
  const disarm = () => { if (id !== null) { try { clearTimer(id); } catch { /* gone */ } id = null; } };
  return {
    arm(ms) {
      disarm();
      try { id = setTimer(() => { id = null; onExpire(); }, clampLimit(ms, graceMs, maxMs)); } catch { id = null; }
    },
    disarm,
  };
}

const subscribe = (bus, fn) => (bus && typeof bus.subscribe === 'function'
  ? bus.subscribe(LISTENING_TOPIC, (p) => { try { fn(p || {}); } catch (err) { console.error('listening cue', err); } })
  : () => {});

function ensureStyles(doc) {
  if (!doc || doc.querySelector('link[data-listening-cue-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./listening_cue.css', import.meta.url).href;
    link.setAttribute('data-listening-cue-css', '');
    doc.head.append(link);
  } catch { /* a page without a head still gets a working, unstyled cue */ }
}

/**
 * THE ON-SCREEN CUE. Mounted once into `host` (the kiosk's root, so it wears the screen's theme);
 * shown while the window is open.
 */
export function mountListeningCue(host, {
  bus,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  label = LISTENING_DEFAULTS.label,
  reducedMotion = false,
  graceMs = LISTENING_DEFAULTS.graceMs,
  maxMs = LISTENING_DEFAULTS.maxMs,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!host || !doc) throw new Error('mountListeningCue: a host element is required');
  ensureStyles(doc);
  const el = doc.createElement('div');
  el.className = 'listen-cue';
  el.hidden = true;
  // `status`, polite: a screen reader mentions it when it can, and never interrupts for it.
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const dot = doc.createElement('span');
  dot.className = 'lc-dot';
  dot.setAttribute('aria-hidden', 'true');
  const word = doc.createElement('span');
  word.className = 'lc-word';
  word.textContent = String(label || LISTENING_DEFAULTS.label);
  el.append(dot, word);
  el.classList.toggle('lc-still', !!reducedMotion);
  host.append(el);

  const hide = () => { el.hidden = true; };
  const dog = watchdog({ onExpire: hide, setTimer, clearTimer, graceMs, maxMs });
  const off = subscribe(bus, (p) => {
    if (p.on) { el.hidden = false; dog.arm(p.ms); } else { dog.disarm(); hide(); }
  });

  return {
    shown: () => !el.hidden,
    setReducedMotion(v) { el.classList.toggle('lc-still', !!v); },
    destroy() { try { off(); } catch { /* gone */ } dog.disarm(); el.remove(); },
  };
}

// The default tone: the output layer's `say` earcon, a step above the `status` one the command
// confirmation uses, so "I'm listening" and "got it" are two different sounds.
let sharedSound = null;
function defaultPlay() {
  sharedSound = sharedSound || createSoundChannel();
  if (!sharedSound.available()) return;
  sharedSound.present({ verb: 'say' }, { done() {} });
}

/** THE TONE: one short earcon each time the window opens. None when it closes. */
export function attachListeningTone({ bus, play = defaultPlay } = {}) {
  const off = subscribe(bus, (p) => {
    if (!p.on) return;
    try { play(); } catch (err) { console.error('listening tone', err); }
  });
  return { destroy() { try { off(); } catch { /* gone */ } } };
}

/**
 * THE DUCK: a `talk`-tier source on the audio bus, active while the window is open, so every
 * media source ducks under it exactly the way it does under a spoken cue - and comes back the
 * moment it is not, or when its own watchdog gives up on a closing event that never came.
 */
export function attachListeningDuck({
  bus,
  audio,
  id = 'speech-listening',
  duckTo = LISTENING_DEFAULTS.duckTo,
  graceMs = LISTENING_DEFAULTS.graceMs,
  maxMs = LISTENING_DEFAULTS.maxMs,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id2) => clearTimeout(id2),
} = {}) {
  try { audio?.register?.(id, { tier: 'talk', duck: duckTo }); } catch (err) { console.error('listening duck', err); }
  const release = () => { try { audio?.setActive?.(id, false); } catch (err) { console.error('listening duck', err); } };
  const dog = watchdog({ onExpire: release, setTimer, clearTimer, graceMs, maxMs });
  const off = subscribe(bus, (p) => {
    if (p.on) {
      dog.arm(p.ms);
      try { audio?.setActive?.(id, true); } catch (err) { console.error('listening duck', err); }
    } else {
      dog.disarm();
      release();
    }
  });
  return {
    destroy() {
      try { off(); } catch { /* gone */ }
      dog.disarm();
      release();
      try { audio?.unregister?.(id); } catch { /* gone */ }
    },
  };
}

/**
 * All three at once, each following its setting (LISTENING_FIELDS; unset = the default, ON).
 * The one call the kiosk makes.
 */
export function attachListening({ bus, audio = null, host = null, settings = {}, play,
                                  reducedMotion = false, duckTo } = {}) {
  const s = settings || {};
  const want = (key, dflt) => (typeof s[key] === 'boolean' ? s[key] : dflt);
  const parts = [];
  if (want('listenVisual', LISTENING_DEFAULTS.visual) && host) {
    try { parts.push(mountListeningCue(host, { bus, reducedMotion })); } catch (err) { console.error('listening cue', err); }
  }
  if (want('listenTone', LISTENING_DEFAULTS.tone)) {
    parts.push(attachListeningTone(play ? { bus, play } : { bus }));
  }
  if (want('listenDuck', LISTENING_DEFAULTS.duck) && audio) {
    parts.push(attachListeningDuck(duckTo !== undefined ? { bus, audio, duckTo } : { bus, audio }));
  }
  return { destroy() { parts.forEach((p) => { try { p.destroy(); } catch { /* gone */ } }); parts.length = 0; } };
}
