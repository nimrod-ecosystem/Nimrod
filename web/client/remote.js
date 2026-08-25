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
//
// TWO AUDIENCES, ONE PANEL, and they are not the same person:
//
//   THE OWNER decides WHO MAY DRIVE. Remote drive shipped able to do one thing — let an
//   account drive its own people's screens — which is the demo, not the feature. An OT on
//   their own login could not reach a resident's screen at all. So the owner hands out
//   grants here, sees every one that exists, and can take any of them back.
//
//   THE GRANTEE picks WHOSE SCREEN to drive, from the list of people shared with them.
//   Without that list the feature is unusable by exactly the person it was built for: they
//   would have to be told a person id out of band.
//
// AN EXPIRY IS OFFERED BEFORE IT IS ASKED FOR. A permission given for one therapy block and
// never revoked is how every access-control system decays into everyone-can-do-everything.
// "Forever" is a real case — family — so it is a choice, not a default.

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

export const DAY_CHOICES = [
  { days: 1, label: 'today' },
  { days: 7, label: 'a week' },
  { days: 30, label: 'a month' },
  { days: 0, label: 'until I revoke it' },
];

export function mountRemote(root, {
  personId = '',
  personName = '',
  user = null,
  bus = null,                 // this machine's verb bus, for the forwarding half
  profiles = null,            // for the grant halves; absent -> driving only
  connect = connectDrive,
} = {}) {
  let link = null;
  let grants = [];
  let shared = [];
  let target = { id: personId, name: personName, mine: true };
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
      <div class="r-who" data-shared></div>
      <div class="r-status" data-status></div>
      <div class="r-pad" data-pad></div>
      <label class="r-fwd">
        <input type="checkbox" data-forward>
        <span>Send what <b>I</b> press — my keyboard and switches drive their screen</span>
      </label>
      <p class="h-hint" data-fwd-note></p>
      <div class="r-grants" data-grants></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  // WHOSE SCREEN. Only rendered when somebody has actually shared one - an account with
  // no grants should never meet the concept.
  function renderShared() {
    const host = el('[data-shared]');
    if (!shared.length) { host.innerHTML = ''; return; }
    const all = [{ id: personId, name: personName || 'my person', mine: true }, ...shared];
    host.innerHTML = `<span class="r-lead">Driving for</span>
      <div class="r-chips">${all.map((p) => `
        <button class="r-chip${p.id === target.id ? ' on' : ''}" data-target="${esc(p.id)}"
                aria-pressed="${p.id === target.id}">${esc(p.name)}${p.mine ? '' : ' ·'}</button>`).join('')}
      </div>`;
  }

  // WHO MAY DRIVE. Owner-only, and only for a person this account actually owns - you
  // cannot hand out access to somebody else's screens just because you were given some.
  function renderGrants() {
    const host = el('[data-grants]');
    if (!profiles || !personId || !target.mine) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <h2 class="r-h2">Who may drive ${esc(personName || 'these screens')}</h2>
      <p class="h-hint">Anyone you add here can drive from their own sign-in, without you
        being present. They will see it happen; so will whoever is at the screen.</p>
      <form class="h-new" data-grant-form>
        <input type="email" data-subject placeholder="their sign-in email" aria-label="who" required>
        <input type="text" data-label placeholder="what for (optional)" aria-label="note" maxlength="120">
        <select data-days aria-label="for how long">
          ${DAY_CHOICES.map((c) => `<option value="${c.days}"${c.days === 30 ? ' selected' : ''}>for ${c.label}</option>`).join('')}
        </select>
        <button type="submit" class="h-btn h-primary">Allow</button>
      </form>
      <p class="r-msg" data-grant-msg></p>
      ${grants.length ? `<ul class="r-list">${grants.map((g) => `
        <li>
          <b>${esc(g.subject_id)}</b>
          ${g.label ? `<span class="h-hint"> — ${esc(g.label)}</span>` : ''}
          <span class="h-hint"> ${g.expires_at ? `until ${esc(String(g.expires_at).slice(0, 10))}` : 'until revoked'}</span>
          <button class="h-btn h-danger p-small" data-revoke="${esc(g.id)}">Revoke</button>
        </li>`).join('')}</ul>`
        : '<p class="h-hint">Nobody yet. Only you can drive these screens.</p>'}`;
  }

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

  root.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-target]');
    if (chip) { await retarget(chip.dataset.target); return; }
    const rev = e.target.closest('[data-revoke]');
    if (rev) {
      try { await profiles.revokeDrive(personId, rev.dataset.revoke); await loadGrants(); }
      catch (err) { const m = el('[data-grant-msg]'); if (m) m.textContent = String(err.message || err); }
      return;
    }
    const b = e.target.closest('[data-verb]');
    if (!b || b.disabled) return;
    link?.send(b.dataset.verb);
    // A press that went nowhere must not look like a press that landed.
    b.classList.add('sent');
    setTimeout(() => b.classList.remove('sent'), 180);
  }, { signal: listeners.signal });

  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-grant-form]')) return;
    e.preventDefault();
    const subject = el('[data-subject]').value.trim();
    const label = el('[data-label]').value.trim();
    const days = Number(el('[data-days]').value);
    try {
      await profiles.grantDrive(personId, subject, { label, days });
      await loadGrants();
    } catch (err) {
      // Named, not swallowed. "You already own these screens" is the common one and it is
      // a real answer, not a failure.
      const msg = el('[data-grant-msg]');
      if (msg) msg.textContent = String(err.message || err);
    }
  }, { signal: listeners.signal });

  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-forward]')) return;
    forwarding = e.target.checked;
    if (forwarding) startForwarding(); else stopForwarding();
    renderForward();
  }, { signal: listeners.signal });

  async function loadGrants() {
    if (!profiles || !personId) return;
    try { grants = await profiles.driveGrants(personId); } catch { grants = []; }
    renderGrants();
  }

  function openLink(id) {
    try { link?.close(); } catch { /* already gone */ }
    link = null;
    state = 'offline'; presence = { screens: 0, drivers: 0 };
    renderStatus();
    if (!id) return;
    link = connect({
      personId: id, user, role: 'driver',
      onState: (s) => { state = s; renderStatus(); },
      onPresence: (p) => { presence = p; renderStatus(); },
    });
  }

  // Switching who you are driving must drop the old socket, or a press meant for one
  // person lands on another's screen. That is the worst bug this panel could have.
  async function retarget(id) {
    const hit = id === personId
      ? { id: personId, name: personName, mine: true }
      : shared.find((p) => p.id === id);
    if (!hit) return;
    target = { ...hit, mine: hit.mine !== false && hit.id === personId };
    // Forwarding does not survive a change of subject either.
    if (forwarding) { forwarding = false; stopForwarding(); renderForward(); }
    renderShared();
    renderGrants();
    openLink(target.id);
  }

  renderPad();
  renderForward();
  renderStatus();
  openLink(personId);

  async function refresh() {
    if (profiles) {
      try {
        // The server names it `person_id` (it is a row about a grant, not about a person);
        // everything in this panel keys on `id`. Mapping here rather than at each use is
        // what stops the chip row silently rendering nothing, which is what it did.
        shared = (await profiles.sharedWithMe())
          .map((p) => ({ ...p, id: p.person_id, mine: false }));
      } catch { shared = []; }
      renderShared();
      await loadGrants();
    }
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
    refresh,
    grants: () => grants.map((g) => ({ ...g })),
    shared: () => shared.map((p) => ({ ...p })),
    target: () => ({ ...target }),
    retarget,
    destroy() {
      stopForwarding();
      listeners.abort();
      try { link?.close(); } catch { /* already gone */ }
      link = null;
      root.innerHTML = '';
    },
  };
}
