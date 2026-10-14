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
import { mountIntercomApprovals } from './intercom_approvals.js';
import { mountNoteVisit, mountNoteWriters } from './note_visit.js';
import { mountFollowView } from './follow_view.js';   // watch along (row 2.79): play what their screen plays, in step
import { mountScreenPermissions } from './screen_permissions.js';   // who may see, drop in, the guardian set (2026-10-12)
import { INPUTS_KEY } from './input_runtime.js';
import { authHeaders } from './auth.js';

// Who is signed in, as the SERVER names them (`/api/me`'s `user`): the same name it stamps on every
// relayed signal (`by`, drive.py), which is what the intercom's approved list is checked against.
async function whoamiFromServer(user) {
  try {
    const r = await fetch('/api/me', { headers: authHeaders(user), credentials: 'same-origin' });
    if (!r.ok) return null;
    return (await r.json())?.user || null;
  } catch { return null; }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LABELS = Object.fromEntries([...VERBS, ...FOCUS_VERBS].map((v) => [v.id, v.label]));

// The order a person reads them in, not the order they happen to be declared in.
export const PANEL_ORDER = [
  'select', 'back', 'next', 'prev', 'focus-next', 'focus-prev',
  'up', 'down', 'left', 'right', 'menu',
];

export function statusLine({ state, presence, driving = true }) {
  if (state === 'connecting') return { text: 'Connecting…', tone: 'wait' };
  if (state !== 'connected') return { text: 'Not connected', tone: 'bad' };
  if (!presence.screens) {
    // The distinction that matters: WE are connected, THEY are not. Saying "connected"
    // here would be true and useless.
    return { text: 'Connected — but none of their screens is open', tone: 'bad' };
  }
  const n = presence.screens;
  // Row 2.83: open but not pressing is not "controlling" - and their screen does not say anybody is helping.
  if (!driving) return { text: `Connected to ${n} screen${n === 1 ? '' : 's'}. Not controlling ${n === 1 ? 'it' : 'them'} now`, tone: 'good' };
  return { text: `Controlling ${n} screen${n === 1 ? '' : 's'}`, tone: 'good' };
}

// CONNECTED, NOT PRESSING (row 2.83, Mike at the bench 2026-10-14: "Someone is helping from another screen" stayed after
// "Send what I press" was unticked). This page now tells the server whether it is driving: on while "Send what I press"
// is ticked, and for a while after a press of one of the buttons above, so their screen's notice is up while somebody
// is pressing it and goes when they stop. HOW LONG AFTER A BUTTON PRESS, argued: a person showing somebody what a button
// does presses in bursts, and a notice that came and went between presses would flicker; a minute is short enough that
// the screen stops saying "helping" soon after the last press. A default here (`padHoldMs`), for Mike to rule on.
export const PAD_HOLD_MS = 60 * 1000;

export const DAY_CHOICES = [
  // 'a day', not 'today' (site-text row tac53d29f): the server gives 24 hours from the moment it is allowed, not until
  // midnight. How long something lent DURING a call lasts is a separate choice, made on the screen (screen_permissions.js).
  { days: 1, label: 'a day' },
  { days: 7, label: 'a week' },
  { days: 30, label: 'a month' },
  { days: 0, label: 'as long as I allow it' },
];

export function mountRemote(root, {
  personId = '',
  personName = '',
  user = null,
  bus = null,                 // this machine's verb bus, for the forwarding half
  profiles = null,            // for the grant halves; absent -> driving only
  connect = connectDrive,
  // THE INTERCOM'S APPROVED LIST (row 2.44), for a person this account owns: the person's own row
  // (`makePersonState(personId, key)`, the one their bindings and voice settings live in), and who is
  // signed in. Absent `makePersonState` -> no approvals block (a local backend has nowhere to keep it).
  makePersonState = null,
  whoami = () => whoamiFromServer(user),
  // THE NOTE (note_visit.js): leave one for whoever is picked, from this account. Only on a
  // server-backed panel (`profiles` given). `noteVisit: null` turns it off; a test hands in its own.
  noteVisit = mountNoteVisit,
  // WATCH ALONG (row 2.79, follow_view.js): follow what the picked person's screen is playing, in step, on this
  // computer. Its own socket, opened only when somebody presses its button. `followView: null` turns it off.
  followView = mountFollowView,
  // Row 2.83: how long after a press of one of the buttons this page keeps driving (see PAD_HOLD_MS).
  padHoldMs = PAD_HOLD_MS,
} = {}) {
  let link = null;
  let padTimer = null;        // row 2.83: the hold after a button press
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
        <p>Control ${personName ? `<b>${esc(personName)}</b>’s` : 'their'} screen from here, while
          they are sitting at it. It is useful for showing someone what a button or key does. It
          also lets you check that a binding actually works on the screen they really use.</p>
      </div>
      <div class="r-who" data-shared></div>
      <div class="r-status" data-status></div>
      <div class="r-pad" data-pad></div>
      <label class="r-fwd">
        <input type="checkbox" data-forward>
        <span>Send what <b>I</b> press — my keyboard and switches control their screen</span>
      </label>
      <p class="h-hint" data-fwd-note></p>
      <div data-follow></div>
      <div class="r-grants" data-note-visit></div>
      <div class="r-grants" data-grants></div>
      <div class="r-grants" data-screen-people></div>
      <div class="r-grants" data-intercom-approvals></div>
      <div class="r-grants" data-note-writers></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  // WHOSE SCREEN. Only rendered when somebody has actually shared one - an account with
  // no grants should never meet the concept.
  function renderShared() {
    const host = el('[data-shared]');
    if (!shared.length) { host.innerHTML = ''; return; }
    const all = [{ id: personId, name: personName || 'my person', mine: true }, ...shared];
    host.innerHTML = `<span class="r-lead">Whose screen</span>
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
    // A3 of the site-text questions (2026-10-12, Mike's ruling 2.81), changed 2026-10-14 ("a call is only a call"):
    // adding somebody here lets them control the screens; they may also call unless "May call" is unticked below
    // (continuity - every drive grant could call before), and a call-only permission is added below instead. Copy
    // (2026-10-13): "control this site on your device" in the sentence; the heading keeps "Who may drive".
    host.innerHTML = `
      <h2 class="r-h2">Who may drive ${personName ? `${esc(personName)}’s screens` : 'these screens'}</h2>
      <p class="h-hint">Anyone you add here can control this site on your device, from their own device, without you
        being there. They may also call these screens, unless you untick “May call” for them below. To let someone
        call without controlling anything, add them under “Who may call” below instead. A call waits for somebody at
        the screen to answer, unless you let them drop in. Whoever is at the screen sees when someone is controlling
        it.</p>
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
          <span class="h-hint"> ${g.expires_at ? `until ${esc(String(g.expires_at).slice(0, 10))}` : 'until you take it back'}</span>
          ${String(g.role || '') === 'caller' ? '<span class="h-hint"> — may call only, not control</span>' : ''}
          <button class="h-btn h-danger p-small" data-revoke="${esc(g.id)}">Take it back</button>
        </li>`).join('')}</ul>`
        : '<p class="h-hint">Nobody yet. Only you can control these screens.</p>'}`;
  }

  // WHO MAY OPEN THE INTERCOM (row 2.44). Owner-only, for the owner's own person, exactly like the
  // grants above - the list lives on the PERSON's row, which only their owner can write. Its candidates
  // are the owner and the grants just listed, so it is redrawn whenever they change. Nobody is on it
  // until somebody is ticked here (intercom_approvals.js).
  let approvals = null;
  let approvalsState = null;
  let approvalsSeq = 0;
  let me = null;
  let torn = false;
  const whoamiOnce = async () => { if (me == null) { try { me = await whoami(); } catch { me = null; } } return me; };
  let noteWriters = null;       // who may leave a note: same person's row, same owner-only rule
  // who may see these screens, who may drop in, the guardian set (2026-10-12; screen_permissions.js): the same row too.
  let screenPeople = null;
  function dropApprovals({ state: dropState = false } = {}) {
    try { approvals?.destroy(); } catch { /* already gone */ }
    approvals = null;
    try { noteWriters?.destroy(); } catch { /* already gone */ }
    noteWriters = null;
    try { screenPeople?.destroy(); } catch { /* already gone */ }
    screenPeople = null;
    if (dropState && approvalsState) { try { approvalsState.destroy?.(); } catch { /* already gone */ } approvalsState = null; }
  }
  async function renderApprovals() {
    const my = ++approvalsSeq;
    const host = el('[data-intercom-approvals]');
    const want = !!(profiles && personId && target.mine && typeof makePersonState === 'function');
    if (!want) {
      dropApprovals({ state: true });
      if (host) host.innerHTML = '';
      const sp = el('[data-screen-people]');
      if (sp) sp.innerHTML = '';
      return;
    }
    if (!approvalsState) {
      let st = null;
      try { st = makePersonState(personId, INPUTS_KEY) || null; } catch (err) { console.error('remote: intercom approvals', err); st = null; }
      if (!st) { dropApprovals(); if (host) host.innerHTML = ''; return; }
      approvalsState = st;
      try { await st.load?.(); } catch { /* offline: it shows the list as last known, empty by default */ }
    }
    if (torn || my !== approvalsSeq || !host) return;
    dropApprovals();
    approvals = mountIntercomApprovals(host, {
      personName, state: approvalsState, loadGrants: async () => grants, whoami: whoamiOnce,
    });
    const nwHost = el('[data-note-writers]');
    if (nwHost) noteWriters = mountNoteWriters(nwHost, { personName, state: approvalsState, loadGrants: async () => grants });
    const spHost = el('[data-screen-people]');
    if (spHost) {
      screenPeople = mountScreenPermissions(spHost, {
        personName, state: approvalsState, loadGrants: async () => grants, whoami: whoamiOnce,
        // The guardian set's drive: a grant "as long as I allow it", made only when they have no live one.
        grantDrive: async (account) => {
          await profiles.grantDrive(personId, account, { label: 'guardian', days: 0 });
          try { grants = await profiles.driveGrants(personId); } catch { /* the list shows it on the next load */ }
          renderGrants();
        },
        // A call is only a call (2026-10-14): "Add someone who may call, but not control these screens".
        grantCall: async (account, { days = 0 } = {}) => {
          await profiles.grantDrive(personId, account, { label: '', days, role: 'caller' });
          try { grants = await profiles.driveGrants(personId); } catch { /* the list shows it on the next load */ }
          renderGrants();
        },
      });
    }
  }

  // A NOTE FOR WHOEVER IS PICKED, from this account (note_visit.js). Follows the chip row: switching
  // person drops the old note, the same rule as the drive socket.
  let noteView = null;
  function renderNoteVisit() {
    try { noteView?.destroy(); } catch { /* already gone */ }
    noteView = null;
    const host = el('[data-note-visit]');
    if (!host) return;
    host.innerHTML = '';
    if (!profiles || typeof noteVisit !== 'function' || !target.id) return;
    try { noteView = noteVisit(host, { personId: target.id, personName: target.name || '', user }); }
    catch (err) { console.error('remote: note', err); noteView = null; }
  }

  // WATCH ALONG FOR WHOEVER IS PICKED (follow_view.js). Follows the chip row like the note above: switching person
  // drops the old one (and its socket), so a follow meant for one screen never plays another's.
  let followCtl = null;
  function renderFollow() {
    try { followCtl?.destroy(); } catch { /* already gone */ }
    followCtl = null;
    const host = el('[data-follow]');
    if (!host) return;
    host.innerHTML = '';
    if (typeof followView !== 'function' || !target.id) return;
    try { followCtl = followView(host, { personId: target.id, personName: target.name || '', user, connect }); }
    catch (err) { console.error('remote: watch along', err); followCtl = null; }
  }

  // Row 2.83: driving = "Send what I press" is ticked, or a button above was pressed within `padHoldMs`.
  const drivingNow = () => forwarding || padTimer !== null;
  function syncDriving() {
    try { link?.setDriving?.(drivingNow()); } catch { /* an older link: it drives whenever it is open */ }
    renderStatus();
  }
  function clearPadHold() { if (padTimer !== null) { clearTimeout(padTimer); padTimer = null; } }

  function renderStatus() {
    const { text, tone } = statusLine({ state, presence, driving: drivingNow() });
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
      ? 'On. Every key, switch or other control bound on THIS device is now also pressing their screen.'
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
    // Driving for a while (row 2.83): their screen says so BEFORE the press reaches it (the server announces first).
    clearPadHold();
    padTimer = setTimeout(() => { padTimer = null; syncDriving(); }, padHoldMs);
    syncDriving();
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
    syncDriving();      // row 2.83: unticked -> their screen stops saying somebody is helping
  }, { signal: listeners.signal });

  async function loadGrants() {
    if (!profiles || !personId) return;
    try { grants = await profiles.driveGrants(personId); } catch { grants = []; }
    renderGrants();
    await renderApprovals();
  }

  function openLink(id) {
    try { link?.close(); } catch { /* already gone */ }
    link = null;
    state = 'offline'; presence = { screens: 0, drivers: 0 };
    renderStatus();
    if (!id) return;
    link = connect({
      personId: id, user, role: 'driver',
      // Row 2.83: open but not pressing until "Send what I press" is ticked or a button is pressed.
      idle: !drivingNow(),
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
    // Forwarding does not survive a change of subject either (nor the hold after a button press, row 2.83).
    if (forwarding) { forwarding = false; stopForwarding(); renderForward(); }
    clearPadHold();
    renderShared();
    renderGrants();
    renderApprovals().catch((err) => console.error('remote: intercom approvals', err));
    renderNoteVisit();
    renderFollow();
    openLink(target.id);
  }

  renderPad();
  renderForward();
  renderStatus();
  openLink(personId);
  renderNoteVisit();
  renderFollow();

  async function refresh() {
    if (profiles) {
      try {
        // The server names it `person_id` (it is a row about a grant, not about a person);
        // everything in this panel keys on `id`. Mapping here rather than at each use is
        // what stops the chip row silently rendering nothing, which is what it did.
        shared = (await profiles.sharedWithMe())
          // A call-only permission (2026-10-14) is not one to drive with: those screens are for the Call page.
          .filter((p) => p && p.drive !== false)
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
      syncDriving();
    },
    /** Row 2.83: whether this page is driving (ticked, or a button pressed within `padHoldMs`). */
    driving: () => drivingNow(),
    refresh,
    grants: () => grants.map((g) => ({ ...g })),
    shared: () => shared.map((p) => ({ ...p })),
    target: () => ({ ...target }),
    retarget,
    // The intercom approvals block (null unless shown), for a test.
    approvals: () => approvals,
    // The note blocks (null unless shown), for a test.
    noteWriters: () => noteWriters,
    // Who may see / drop in / the guardian set (null unless shown), for a test.
    screenPeople: () => screenPeople,
    noteView: () => noteView,
    // The watch-along block (null when off), for a test.
    follow: () => followCtl,
    destroy() {
      torn = true;
      try { noteView?.destroy(); } catch { /* already gone */ }
      noteView = null;
      try { followCtl?.destroy(); } catch { /* already gone */ }
      followCtl = null;
      dropApprovals({ state: true });
      stopForwarding();
      clearPadHold();
      listeners.abort();
      try { link?.close(); } catch { /* already gone */ }
      link = null;
      root.innerHTML = '';
    },
  };
}
