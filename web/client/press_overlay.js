// press_overlay.js — WHAT WAS JUST PRESSED, on the screen.
//
// Mike: *"Maybe when being remote controlled there should be an overlay showing which input is
// pressed? That would be annoying in games though. Probably another option. Could be useful
// when teaching someone how to do something. That would actually be good for your own screen
// for screen records too."*
//
// THREE USES, AND THEY WANT DIFFERENT THINGS, which is why almost everything here is a
// setting rather than a decision:
//
//   CONSENT    while somebody is driving from another screen. The screen already says out
//              loud that it is being driven — that is a confirmed safety invariant — and
//              showing WHAT they pressed is the stronger version of the same promise. A
//              person who can see the thing moving but not why has been made a passenger
//              twice over.
//   TEACHING   a clinician showing somebody what a switch does. Here the VERB matters
//              ("Next"), not the control.
//   RECORDING  a screencast, where the control matters ("Space") because the viewer cannot
//              see the hand.
//
// SO IT SHOWS BOTH, and can be told to show either. "Space → Next" answers the debugging
// question and the teaching question in one line.
//
// IT COSTS ALMOST NOTHING, and that is not an accident: every press already lands on
// ACTIVATION_TOPIC with the control, the verb, whether it was accepted and why not — the
// activity log has been reading exactly that since the diagnostics shipped. This is a
// subscriber to a topic that already carries everything it needs.
//
// AND IT CAN NAME WHO. Verbs carry a sender now, so "her switch" and "somebody driving from
// another house" are distinguishable — which is the version Mike asked for first and was not
// expressible before senders existed.
//
// REFUSED PRESSES SHOW TOO, AND DIFFERENTLY. A press that the gate refused is the single most
// confusing thing that can happen at a bedside, because from the room it is indistinguishable
// from a dead switch. Showing it — struck through, with the reason — turns the worst failure
// in the product into a sentence anybody can read.

import { ACTIVATION_TOPIC } from './input.js';
import { controlLabel } from './controls_view.js';
import { VERBS, FOCUS_VERBS } from './actions.js';

const VERB_LABEL = Object.fromEntries([...VERBS, ...FOCUS_VERBS].map((v) => [v.id, v.label]));

export const SHOW_MODES = ['both', 'verb', 'control'];

// SHIPPED DEFAULT IS OFF. An overlay nobody asked for, on a screen somebody sits at around
// the clock, is visual noise at best — and Mike named the case it actively hurts: a game.
export const OVERLAY_DEFAULTS = {
  on: false,
  show: 'both',
  // How long a press stays up. Long enough to read at a glance, short enough that two quick
  // presses do not queue up behind each other.
  holdMs: 1400,
  corner: 'bl',
  // Show presses the gate REFUSED. On by default WHEN the overlay is on at all, because a
  // refused press is the thing worth seeing and hiding it would leave the overlay looking
  // like the switch is dead — which is the exact confusion it exists to end.
  refusals: true,
  // Show remote presses even when the overlay is otherwise off. See CONSENT above.
  alwaysWhenDriven: true,
};

// The settings the shell renders. Declared here rather than in a host so the overlay travels
// with its own controls, the same way a module does.
export const OVERLAY_SETTINGS = [
  { key: 'on', label: 'Show what was pressed', default: false, level: 'standard',
    onLabel: 'Yes', offLabel: 'No' },
  { key: 'alwaysWhenDriven', label: 'Always show it while somebody is driving', default: true,
    level: 'standard', onLabel: 'Yes', offLabel: 'Only if the overlay is on' },
  { key: 'show', label: 'Show', kind: 'choice', default: 'both', level: 'standard',
    options: [
      { value: 'both', label: 'the button and what it does' },
      { value: 'verb', label: 'only what it does' },
      { value: 'control', label: 'only the button' },
    ] },
  { key: 'refusals', label: 'Show presses that were refused', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No' },
  { key: 'holdMs', label: 'Keep it on screen for', kind: 'choice', default: 1400,
    level: 'advanced',
    options: [
      { value: 700, label: 'under a second' },
      { value: 1400, label: 'about a second and a half' },
      { value: 3000, label: '3 seconds' },
      { value: 6000, label: '6 seconds' },
    ] },
  { key: 'corner', label: 'Corner', kind: 'choice', default: 'bl', level: 'advanced',
    options: [
      { value: 'bl', label: 'bottom left' }, { value: 'br', label: 'bottom right' },
      { value: 'tl', label: 'top left' }, { value: 'tr', label: 'top right' },
    ] },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------
// pressLine — PURE. The words, given one activation record.
//
// Separated because the WORDING is the feature here, exactly as it is in controls_view: a
// line that reads wrong at a bedside is worse than no line, and it has to be assertable
// without rendering anything.
// ---------------------------------------------------------------------------------------
export function pressLine(rec = {}, { show = 'both' } = {}) {
  if (!rec || typeof rec !== 'object') return null;
  const remote = rec.device === 'remote';
  const who = controlLabel(rec.device, rec.control);
  const verbId = String(rec.actionId || '').replace(/^verb\//, '');
  const verb = VERB_LABEL[verbId] || verbId || '';

  let text;
  if (show === 'verb') text = verb || who;
  else if (show === 'control') text = who;
  else text = verb ? `${who} → ${verb}` : who;

  return {
    text,
    remote,
    accepted: !!rec.accepted,
    // NOT a bare code. "role-gated" means nothing to somebody standing at a screen; the gate
    // and the role together are the repair.
    reason: rec.accepted ? '' : (rec.reason === 'role-gated'
      ? `refused — this screen is set to “${rec.gate || 'a limited mode'}”`
      : `refused — ${rec.reason || 'no reason recorded'}`),
  };
}

// ---------------------------------------------------------------------------------------
// mountPressOverlay — the DOM half.
//
// `settings()` is read at every press rather than captured, so a change in the menu takes
// effect on the next press instead of on the next reload.
// `driven()` answers "is somebody driving right now", which is what `alwaysWhenDriven` needs.
// ---------------------------------------------------------------------------------------
export function mountPressOverlay(root, {
  bus,
  settings = () => ({}),
  driven = () => false,
  documentRef = (typeof document !== 'undefined' ? document : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!root) throw new Error('mountPressOverlay: a root element is required');
  if (!bus) throw new Error('mountPressOverlay: a bus is required');
  const doc = documentRef;

  root.innerHTML = '<div class="po-wrap" data-po hidden aria-live="polite"></div>';
  const el = root.querySelector('[data-po]');
  let timer = null;
  let shown = null;

  const cfg = () => ({ ...OVERLAY_DEFAULTS, ...(settings() || {}) });

  function visibleFor(line) {
    const c = cfg();
    if (line.remote && c.alwaysWhenDriven) return true;   // consent beats the on/off switch
    if (!c.on) return false;
    if (!line.accepted && !c.refusals) return false;
    return true;
  }

  function hide() {
    el.hidden = true;
    el.innerHTML = '';
    shown = null;
  }

  function render(rec) {
    const c = cfg();
    const line = pressLine(rec, { show: c.show });
    if (!line || !line.text) return null;
    if (!visibleFor(line)) return null;

    shown = line;
    el.dataset.corner = ['bl', 'br', 'tl', 'tr'].includes(c.corner) ? c.corner : 'bl';
    el.className = `po-wrap${line.accepted ? '' : ' po-refused'}${line.remote ? ' po-remote' : ''}`;
    el.innerHTML = `<span class="po-what">${esc(line.text)}</span>`
      // WHO, not just what. A press from another screen is a different event from a press in
      // the room, and merging them is the thing the consent invariant is about.
      + (line.remote ? '<span class="po-who">from another screen</span>' : '')
      + (line.reason ? `<span class="po-why">${esc(line.reason)}</span>` : '');
    el.hidden = false;

    clearTimer(timer);
    timer = setTimer(hide, Math.max(300, Number(c.holdMs) || OVERLAY_DEFAULTS.holdMs));
    return line;
  }

  const off = bus.subscribe(ACTIVATION_TOPIC, (rec) => { try { render(rec); } catch { /* an
    overlay must never be able to break the screen it is drawn on */ } });

  return {
    // Exposed for the test and for a host that wants to preview a setting change without
    // waiting for somebody to press something.
    show: render,
    hide,
    current: () => (shown ? { ...shown } : null),
    isVisible: () => !el.hidden,
    destroy() {
      clearTimer(timer);
      try { off(); } catch { /* already gone */ }
      root.innerHTML = '';
    },
  };
}
