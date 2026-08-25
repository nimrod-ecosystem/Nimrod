// remote.js — the REMOTE panel: drive somebody's screen from this machine.
//
// The other end of drive.js. A clinician sits with a laptop, the person sits at their own
// screen, and the two are working on the same thing — which is what Mike asked for: *"as if
// they were two screens for the same device."*
//
// TWO WAYS TO DRIVE, and both matter for different reasons.
//
//   THE BUTTONS are for a clinician who wants to demonstrate: press Next here, watch what
//   happens over there, decide whether the binding is right. Obvious, discoverable, no
//   setup, works on a touchscreen.
//
//   MY KEYBOARD/SWITCH is the one that proves something. It forwards THIS machine's verbs
//   over the wire, so an OT can pick up the actual switch, press it, and see it drive the
//   real screen in the other room. That is the difference between "the binding looks right"
//   and "the binding works" — and this project's whole rule is that those are not the same.
//
// FORWARDING IS OFF BY DEFAULT AND SAYS SO WHEN IT IS ON. The binder deliberately runs on a
// PRIVATE bus so that pressing a switch while configuring cannot reach a screen somebody is
// watching in another room. This panel is the explicit exception to that rule, so it has to
// be an explicit act: a toggle, off every time the panel mounts, never remembered. A
// "helpful" remembered setting here means somebody's photos change while a clinician is
// typing notes and neither of them knows why.
//
// NOTHING IS DRIVEN WHEN NOTHING IS LISTENING. If no screen is in the room, the panel says
// so rather than swallowing presses — a control that silently does nothing is the failure
// mode this whole project keeps trying to design out.

import { connectDrive, DRIVE_VERBS } from './drive.js';
import { VERBS, FOCUS_VERBS, verbTopic } from './actions.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LABELS = Object.fromEntries([...VERBS, ...FOCUS_VERBS].map((v) => [v.id, v.label]));

// The order a person reads them in, not the order they happen to be declared in.
export const PANEL_ORDER = [
  'select', 'back', 'next', 'prev', 'focus-next', 'focus-prev',
  'up', 'down', 'left', 'right', 'menu',
];

export function statusLine({ state, presence }) {
  if (state === 'connecting') return { text: 'Connecting…', tone: 'wait' };
  if (state !== 'connected') return { text: 'Not connected', tone: 'bad' };
  if (!presence.screens) {
    // The distinction that matters: WE are connected, THEY are not. Saying "connected"
    // here would be true and useless.
    return { text: 'Connected — but none of their screens is open', tone: 'bad' };
  }
  const n = presence.screens;
  return { text: `Driving ${n} screen${n === 1 ? '' : 's'}`, tone: 'good' };
}

export function mountRemote(root, {
  personId = '',
  personName = '',
  user = null,
  bus = null,                 // this machine's verb bus, for the forwarding half
  connect = connectDrive,
} = {}) {
  let link = null;
  let state = 'offline';
  let presence = { screens: 0, drivers: 0 };
  let forwarding = false;     // ALWAYS false on mount. See the header.
  let busOffs = [];

  const listeners = new AbortController();

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Remote</h1>
        <p>Drive ${personName ? `<b>${esc(personName)}</b>’s` : 'their'} screen from here, while
          they are sitting at it. Useful for showing someone what a control does, and for
          checking a binding actually works on the screen they really use.</p>
      </div>
      <div class="r-status" data-status></div>
      <div class="r-pad" data-pad></div>
      <label class="r-fwd">
        <input type="checkbox" data-forward>
        <span>Send what <b>I</b> press — my keyboard and switches drive their screen</span>
      </label>
      <p class="h-hint" data-fwd-note></p>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  function renderStatus() {
    const { text, tone } = statusLine({ state, presence });
    el('[data-status]').innerHTML = `<span class="r-dot ${tone}"></span>${esc(text)}`;
    const live = state === 'connected' && presence.screens > 0;
    for (const b of root.querySelectorAll('[data-verb]')) b.disabled = !live;
  }

  function renderPad() {
    el('[data-pad]').innerHTML = PANEL_ORDER
      .filter((v) => DRIVE_VERBS.includes(v))
      .map((v) => `<button class="r-key" data-verb="${esc(v)}">${esc(LABELS[v] || v)}</button>`)
      .join('');
  }

  function renderForward() {
    el('[data-forward]').checked = forwarding;
    el('[data-fwd-note]').textContent = forwarding
      ? 'On. Every control bound on THIS machine is now also pressing their screen.'
      : 'Off. Nothing you press here reaches their screen unless you use the buttons above.';
  }

  function stopForwarding() {
    busOffs.forEach((off) => { try { off(); } catch { /* gone */ } });
    busOffs = [];
  }

  function startForwarding() {
    stopForwarding();
    if (!bus) return;
    // Only the verbs the wire accepts. Subscribing to everything and filtering at send time
    // would work too, and would make it much easier to accidentally widen later.
    busOffs = DRIVE_VERBS.map((v) => bus.subscribe(verbTopic(v), () => link?.send(v)));
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-verb]');
    if (!b || b.disabled) return;
    link?.send(b.dataset.verb);
    // A press that went nowhere must not look like a press that landed.
    b.classList.add('sent');
    setTimeout(() => b.classList.remove('sent'), 180);
  }, { signal: listeners.signal });

  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-forward]')) return;
    forwarding = e.target.checked;
    if (forwarding) startForwarding(); else stopForwarding();
    renderForward();
  }, { signal: listeners.signal });

  renderPad();
  renderForward();
  renderStatus();

  if (personId) {
    link = connect({
      personId, user, role: 'driver',
      onState: (s) => { state = s; renderStatus(); },
      onPresence: (p) => { presence = p; renderStatus(); },
    });
  }

  return {
    state: () => state,
    presence: () => ({ ...presence }),
    forwarding: () => forwarding,
    press: (verb) => link?.send(verb),
    setForwarding(on) {
      forwarding = !!on;
      if (forwarding) startForwarding(); else stopForwarding();
      renderForward();
    },
    refresh: async () => {},
    destroy() {
      stopForwarding();
      listeners.abort();
      try { link?.close(); } catch { /* already gone */ }
      link = null;
      root.innerHTML = '';
    },
  };
}
