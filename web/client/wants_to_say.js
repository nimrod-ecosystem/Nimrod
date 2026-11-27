// wants_to_say.js — "I HAVE SOMETHING TO SAY": ONE PRESS TELLS THE ROOM TO WAIT (row 2.290, chat's note GT, 2026-11-27;
// proposal_reaction_strip_20261127.md step 2).
//
// Composing on a board by switch takes a while, and the conversation moves on before the sentence is ready. One card
// (`act: 'signal'`, the Quick reactions strip's last) says "wait, I have something to say" before composing starts. The
// board publishes `person/wants-to-say { on, reason? }`; this file draws what the room sees, and the Room module's objects
// react to the same event (room_scene.js DEFAULT_NOTIFY_RULES 'wants-to-say': a lamp lights, the cat's ears perk).
//
// *** IT ENDS ON ITS OWN. *** She may not be able to cancel it (accessibility_research_20261001.md row 5: something that
// starts on its own should end on its own). It ends when she starts composing (any other card pressed, on any board), on a
// second press of the signal, or after the time-out; on the time-out this file says so on the bus, so every board knows.
//
// *** THE NUMBERS (Rule 1, argued; settings). ***
//   visual ON      the pill, drawn like the listening cue (non-modal: no focus, takes no press, `role=status`).
//   chime OFF      Mike's ruling for the listening tone (row 2.39): the visual cue carries it; a chime is one setting away.
//   timeout 2 min  FOR: composing by switch takes a slow scanner a minute or more for a short sentence, and the signal must
//                  outlast the wait it asks for. AGAINST: two minutes of "wants to say something" after she gave up is a
//                  small lie in the room. 30 s, 1, 2 and 5 minutes offered.

import { createSoundChannel } from './output_channels.js';

export const WANTS_TO_SAY_TOPIC = 'person/wants-to-say';
export const WANTS_DEFAULTS = Object.freeze({ visual: true, chime: false, timeoutMs: 120000, label: 'Wants to say something' });
export const WANTS_TIMEOUTS = Object.freeze([30000, 60000, 120000, 300000]);
// The PERSON's, beside the listening cue's (how this person is waited for follows them). At Everything: the defaults are
// right for nearly everybody, and every row at the usual level is one more stop on a switch walk.
export const WANTS_FIELDS = [
  { key: 'wantsVisual', label: 'Show “Wants to say something” when the signal is pressed', kind: 'toggle',
    default: WANTS_DEFAULTS.visual, level: 'advanced' },
  { key: 'wantsChime', label: 'Play a chime when the signal is pressed', kind: 'toggle', default: WANTS_DEFAULTS.chime, level: 'advanced' },
  { key: 'wantsTimeoutMs', label: '“Wants to say something” ends by itself after', kind: 'choice', default: WANTS_DEFAULTS.timeoutMs,
    level: 'advanced', options: WANTS_TIMEOUTS.map((v) => ({ value: v, label: v < 60000 ? `${v / 1000} seconds` : `${v / 60000} minute${v === 60000 ? '' : 's'}` })) },
];
/** The signal's settings from a row, read safely. PURE. */
export function wantsSettingsFrom(row = {}) {
  const r = row || {};
  const t = Number(r.wantsTimeoutMs);
  return {
    visual: r.wantsVisual !== false,
    chime: r.wantsChime === true,
    timeoutMs: WANTS_TIMEOUTS.includes(t) ? t : WANTS_DEFAULTS.timeoutMs,
  };
}

function ensureStyles(doc) {
  if (!doc || doc.querySelector('link[data-wants-cue-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./wants_to_say.css', import.meta.url).href;
    link.setAttribute('data-wants-cue-css', '');
    doc.head.append(link);
  } catch { /* a page without a head still gets a working, unstyled pill */ }
}

let sharedSound = null;
function defaultChime() {
  sharedSound = sharedSound || createSoundChannel();
  if (!sharedSound.available()) return;
  sharedSound.present({ verb: 'say' }, { done() {} });
}

/**
 * Mounted once into `host` (the kiosk's root). `settings()`: the row the WANTS_FIELDS are read from, at each press.
 * Returns { shown(), destroy() }.
 */
export function mountWantsToSay(host, {
  bus,
  settings = () => ({}),
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  play = defaultChime,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!host || !doc) throw new Error('mountWantsToSay: a host element is required');
  ensureStyles(doc);
  const el = doc.createElement('div');
  el.className = 'wants-cue';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.dataset.wantsToSay = '';
  const dot = doc.createElement('span');
  dot.className = 'wc-dot';
  dot.setAttribute('aria-hidden', 'true');
  const word = doc.createElement('span');
  word.className = 'wc-word';
  word.textContent = WANTS_DEFAULTS.label;
  el.append(dot, word);
  host.append(el);
  let timer = null;
  let on = false;
  const stopTimer = () => { if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; } };
  const read = () => { try { return wantsSettingsFrom(settings() || {}); } catch { return wantsSettingsFrom({}); } };
  const off = bus && typeof bus.subscribe === 'function' ? bus.subscribe(WANTS_TO_SAY_TOPIC, (p) => {
    const s = read();
    if (p && p.on) {
      const fresh = !on;
      on = true;
      el.hidden = !s.visual;
      if (fresh && s.chime) { try { play(); } catch (err) { console.error('wants to say: chime', err); } }
      stopTimer();
      timer = setTimer(() => {
        timer = null;
        if (!on) return;
        try { bus.publish(WANTS_TO_SAY_TOPIC, { on: false, reason: 'timeout' }); } catch (err) { console.error('wants to say', err); }
      }, s.timeoutMs);
    } else {
      on = false;
      stopTimer();
      el.hidden = true;
    }
  }) : () => {};
  return {
    shown: () => !el.hidden,
    on: () => on,
    destroy() { try { off(); } catch { /* gone */ } stopTimer(); el.remove(); },
  };
}
