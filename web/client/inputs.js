// inputs.js - the INPUTS panel: what someone presses, and what it does.
//
// Slices 1 and 2 built a bus that can bind anything to anything and log every decision.
// This is the surface, and it is where the feature stops being infrastructure: an OT sits
// down with someone, plugs in whatever switch they already own, presses it, picks what it
// should do, and watches a live readout say whether the presses are landing.
//
// WHAT YOU BIND IS A VERB, NOT A FEATURE. Nine things - Primary select, Next, Previous,
// and so on - not one entry per module capability. See actions.js for why that turned out
// to be the right model and why my first attempt was not. The consequence here is that
// this panel got shorter and much less clever: a flat list of nine, no grouping, nothing
// to browse.
//
// BINDINGS ARE PER USER, NOT PER SCREEN. Which switch someone uses and how long they can
// hold it is a fact about the PERSON. It does not change between their bedside screen and
// their living-room screen, and making them re-enter it on each one is precisely the
// per-device toil this project exists to avoid. Set it up once, ever. This only became
// possible with verbs: a binding that said "photos/next" was inherently about a screen's
// contents; one that says "next" is not. (Server side: /api/user-state.)
//
// THE SCREEN PICKER IS STILL HERE and means something different now - it chooses which
// screen you are TESTING against, because focus moves among that screen's panels. The
// bindings do not change when you switch screens; what they resolve to does.
//
// WHY IT RUNS ON ITS OWN PRIVATE BUS. Pressing a switch here exercises the same code the
// screen will, on a bus with nothing mounted on it. A caregiver checking whether a
// headrest switch registers must not be skipping photos on a screen someone is watching.
//
// NO SAVE BUTTON. Edits autosave; both exits flush. The composer already learned this.
//
// EVERY NUMBER HERE IS IN MILLISECONDS, which nobody thinks in. So capture measures the
// real hold and offers it back - "held 340ms, require 200?" - and the live strip names
// WHY a press was refused in plain words. A person tunes by watching.

import { createBus } from './bus.js';
import { createDefaultRegistry, VERBS, FOCUS_VERBS, verbTopic } from './actions.js';
import { createInputBus, normalizeBinding, GATES, ROLES, EDGES } from './input.js';
import { createVerbRouter } from './input_router.js';
import { attachKeyboard, DEFAULT_BINDINGS, KEYBOARD_DEVICE } from './input_keyboard.js';
import { attachPointer, pointerLabel, POINTER_DEVICE } from './input_pointer.js';
import { createGamepads, controlLabel } from './input_gamepad.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const INPUTS_KEY = 'input-bindings';
export const RECORD_VERSION = 2;      // 1 was per-screen, bound to module-specific actions

// Mike's wording, and he is right that it carries weight: these words get said out loud
// in front of the person they describe. "Them only" and "patient" both put someone in
// the third person in their own room.
const GATE_LABEL = { both: 'Everyone', moderator: 'Moderator only', participant: 'Participant only' };
const ROLE_LABEL = { universal: 'Anyone', moderator: 'Moderator', participant: 'Participant' };
const EDGE_LABEL = { press: 'on press', release: 'on release' };

const VERB_LABEL = Object.fromEntries([...VERBS, ...FOCUS_VERBS].map((v) => [v.id, v.label]));
const isFocusVerb = (verb) => FOCUS_VERBS.some((v) => v.id === verb);

// A measured hold turned into a threshold worth suggesting: comfortably under what they
// managed, rounded to something a person would type, never so low it is meaningless.
export function suggestHold(heldMs) {
  const target = Math.floor((heldMs * 0.7) / 50) * 50;
  return target >= 100 ? target : 0;
}

export function mountInputs(root, {
  profiles, user = null, makeUserState = null, initialProfileId = null,
  // Seams: the test drives the whole panel with no hardware and no server.
  makeInput = null, makeGamepads = null, makeRouter = null,
  attachKeys = attachKeyboard, attachPtr = attachPointer,
  saveDebounceMs = 350,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let list = [];
  let current = null;
  let screenModules = [];
  let state = null;
  let input = null;
  let router = null;
  let pads = null;
  let detach = [];
  let saveTimer = null;
  let record = { v: RECORD_VERSION, gate: 'both', bindings: [] };

  const localBus = createBus();
  const actions = createDefaultRegistry();
  // home.js remounts a panel onto the SAME element, so listeners hung on `root` outlive
  // the panel that added them - one dead handler per visit to the tab.
  const listeners = new AbortController();
  const on = (type, fn) => root.addEventListener(type, fn, { signal: listeners.signal });

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Inputs</h1>
        <p>Bind a switch, a controller button, a key or a click to what someone needs to do.
          You bind the <em>verb</em> — Primary select, Next — and whichever panel they are on
          decides what that means. Set it up once; it follows you to every screen.</p>
      </div>
      <div data-body><p class="h-loading">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  // ---- persistence (per USER) --------------------------------------------------

  const payload = () => ({ ...record, v: RECORD_VERSION });

  function save() {
    if (!state) return;
    clearTimer(saveTimer);
    saveTimer = setTimer(() => { saveTimer = null; state.set({ [INPUTS_KEY]: payload() }); }, saveDebounceMs);
  }

  function flush() {
    if (saveTimer == null || !state) return;
    clearTimer(saveTimer);
    saveTimer = null;
    state.set({ [INPUTS_KEY]: payload() });
  }

  function push() {
    if (!input) return;
    input.setBindings(record.bindings);
    input.setGate(record.gate);
  }

  // ---- naming ------------------------------------------------------------------

  function deviceName(device) {
    if (device === KEYBOARD_DEVICE) return 'Keyboard';
    if (device === POINTER_DEVICE) return 'Mouse';
    const pad = (pads?.list() || []).find((s) => s.device === device);
    return pad ? (pad.id.split('(')[0].trim() || pad.device) : device;
  }

  function controlName(device, control) {
    if (device === KEYBOARD_DEVICE) return control.replace(/^key:/, '').toUpperCase();
    if (device === POINTER_DEVICE) return pointerLabel(control);
    const pad = (pads?.list() || []).find((s) => s.device === device);
    return controlLabel(control, { mapping: pad?.mapping || '' });
  }

  const verbOf = (actionId) => (String(actionId).startsWith('verb/') ? String(actionId).slice(5) : null);

  // ---- rendering ---------------------------------------------------------------

  function verbOptions(selected) {
    const one = (v) => `<option value="${verbTopic(v.id)}"${verbTopic(v.id) === selected ? ' selected' : ''}>${esc(v.label)}</option>`;
    return `${VERBS.map(one).join('')}${FOCUS_VERBS.map(one).join('')}` +
      `<option value="system/role-cycle"${selected === 'system/role-cycle' ? ' selected' : ''}>Cycle who may act</option>`;
  }

  function renderScreens() {
    const host = el('[data-who]');
    if (!host) return;
    host.innerHTML = list.length
      ? list.map((p) =>
        `<button class="h-chip${current && p.id === current.id ? ' on' : ''}" data-who-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')
      : '<span class="h-none">No screens yet — make one on the Screens tab.</span>';
  }

  function renderFocus() {
    const host = el('[data-focus]');
    if (!host) return;
    const m = router?.focused();
    const reach = router?.reachable() || [];
    if (!m) {
      host.innerHTML = `<p class="h-none">Nothing on this screen answers to a control yet.
        A clock has nothing to press. Add photos, a video panel or a game on the Screens tab.</p>`;
      return;
    }
    const targets = router.targets();
    const answers = VERBS.filter((v) => targets[v.id]);
    const silent = VERBS.filter((v) => !targets[v.id]);
    host.innerHTML = `
      <div class="i-focus">${reach.map((x) =>
        `<button class="h-chip${x.id === m.id ? ' on' : ''}" data-focus-id="${esc(x.id)}">${esc(x.type)}</button>`).join('')}</div>
      <p class="h-hint"><b>${esc(m.type)}</b> answers:
        ${answers.map((v) => `<code>${esc(v.label)}</code>`).join(' ') || '<i>nothing</i>'}
        ${silent.length ? `<br>Does nothing here: ${silent.map((v) => esc(v.label)).join(', ')}.` : ''}</p>`;
  }

  function renderDevices() {
    const host = el('[data-devices]');
    if (!host) return;
    const rows = [
      '<li><b>Keyboard</b> <span class="h-hint">always available</span></li>',
      '<li><b>Mouse</b> <span class="h-hint">a great many switches arrive as a mouse click</span></li>',
      ...(pads?.list() || []).map((s) =>
        `<li><b>${esc(s.id.split('(')[0].trim() || s.device)}</b>
          <span class="h-hint">${esc(s.mapping || 'non-standard')} · saved as <code>${esc(s.device)}</code></span></li>`),
    ];
    if (!(pads?.list() || []).length) {
      rows.push(`<li class="h-hint">No controller seen yet — plug one in and press a button on it.
        Browsers hide a controller until it is used.</li>`);
    }
    host.innerHTML = rows.join('');
  }

  function renderBindings() {
    const host = el('[data-bindings]');
    if (!host) return;
    if (!record.bindings.length) {
      host.innerHTML = '<p class="h-none">Nothing bound yet. Pick a control below and press it.</p>';
      return;
    }
    host.innerHTML = `
      <table class="i-tab">
        <thead><tr>
          <th>Does what</th><th>Control</th><th>When</th>
          <th title="How long it must be held before it counts">Hold</th>
          <th title="Ignore a second press this soon after the last">Debounce</th>
          <th title="After it fires, refuse a repeat for this long">Lockout</th>
          <th>Who</th><th></th>
        </tr></thead>
        <tbody>${record.bindings.map((b) => `
          <tr data-bid="${esc(b.id)}">
            <td><select data-f="actionId">${verbOptions(b.actionId)}</select></td>
            <td><button class="h-btn i-ctl" data-repress title="Press a different control">
                  ${esc(deviceName(b.device))}: ${esc(controlName(b.device, b.control))}</button></td>
            <td><select data-f="edge">${EDGES.map((e) =>
              `<option value="${e}"${e === b.edge ? ' selected' : ''}>${EDGE_LABEL[e]}</option>`).join('')}</select></td>
            <td><input type="number" data-f="holdMs" min="0" step="50" value="${b.holdMs}"></td>
            <td><input type="number" data-f="debounceMs" min="0" step="50" value="${b.debounceMs}"></td>
            <td><input type="number" data-f="lockoutMs" min="0" step="50" value="${b.lockoutMs}"></td>
            <td><select data-f="role">${ROLES.map((r) =>
              `<option value="${r}"${r === b.role ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></td>
            <td><button class="h-x" data-del title="Remove">×</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function renderGate() {
    const host = el('[data-gate]');
    if (!host) return;
    host.innerHTML = GATES.map((g) =>
      `<button class="h-btn${g === record.gate ? ' h-primary' : ''}" data-gate="${g}">${GATE_LABEL[g]}</button>`).join('');
  }

  function body() {
    el('[data-body]').innerHTML = `
      <div class="h-card">
        <div class="h-card-head"><h2>Who may act right now</h2></div>
        <p class="h-hint">Lock the other person's controls while you set things up, then hand them
          back. This is itself bindable — put it on a switch and you never need the keyboard.
          Default: <code>Ctrl+Shift+E</code>.</p>
        <div class="i-gate" data-gate></div>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Connected</h2></div>
        <ul class="i-devs" data-devices></ul>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Bindings</h2><span class="h-hint">shared by every screen</span></div>
        <div data-bindings></div>
        <div class="i-add">
          <select data-new-action>${verbOptions(verbTopic('select'))}</select>
          <button class="h-btn h-primary" data-add>Press a control…</button>
          <span class="h-hint" data-addmsg></span>
        </div>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Try it on a screen</h2></div>
        <p class="h-hint">A verb goes to whichever panel has focus. Pick the screen, then move
          focus the way they will — with a switch, not a mouse.</p>
        <div class="h-who" data-who></div>
        <div data-focus></div>
        <div class="i-log" data-log><span class="h-none">Press something.</span></div>
      </div>`;
    renderGate();
    renderDevices();
    renderBindings();
    renderScreens();
    renderFocus();
  }

  // ---- the live strip ----------------------------------------------------------

  const REASON_TEXT = {
    unbound: 'nothing is bound to that control',
    'role-gated': 'blocked — not their turn right now',
    'unknown-action': 'bound to something that no longer exists',
    debounce: 'too soon after the last press (debounce)',
    lockout: 'too soon to repeat (lockout)',
    'too-short': 'let go too early for the hold time',
    'auto-release': 'never released — released automatically',
  };

  const lines = [];
  function onActivation(rec) {
    const host = el('[data-log]');
    if (!host) return;
    const verb = verbOf(rec.actionId);
    const label = verb ? (VERB_LABEL[verb] || verb) : (actions.get(rec.actionId)?.label || rec.actionId || '—');

    let what;
    if (!rec.accepted) {
      what = REASON_TEXT[rec.reason] || rec.reason;
    } else if (verb && isFocusVerb(verb)) {
      what = `focus moved to ${router?.focused()?.type || 'nothing'}`;
    } else if (verb) {
      const target = router?.targets()[verb];
      const panel = router?.focused()?.type;
      // Accepted by the bus, but the focused panel has no meaning for it. This is the
      // most confusing outcome in the whole feature — the switch worked and nothing
      // happened — so it is said out loud instead of looking like silence.
      what = target ? `→ ${panel} (${target.topic})` : `${panel || 'no panel'} has nothing for that`;
    } else {
      what = 'went through';
    }

    lines.unshift(`<div class="${rec.accepted ? 'i-ok' : 'i-no'}">
      <b>${esc(deviceName(rec.device))}: ${esc(controlName(rec.device, rec.control))}</b>
      → ${esc(label)} · ${esc(what)}${rec.heldMs ? ` · held ${rec.heldMs}ms` : ''}</div>`);
    lines.length = Math.min(lines.length, 40);
    host.innerHTML = lines.join('');
    if (verb && isFocusVerb(verb)) renderFocus();
  }

  // ---- capture -----------------------------------------------------------------

  function capture(onPicked) {
    const msg = el('[data-addmsg]');
    const say = (t) => { if (msg) msg.textContent = t; };
    say('press the control now…');
    input.beginCapture({
      onCandidate: ({ device, control }) => say(`${deviceName(device)}: ${controlName(device, control)} — now let go`),
      onDone: ({ device, control, heldMs }) => { say(''); onPicked({ device, control, heldMs }); },
      onTimeout: () => say('nothing pressed — try again'),
    });
  }

  function offerHold(bid, heldMs) {
    const suggested = suggestHold(heldMs);
    const msg = el('[data-addmsg]');
    if (!msg || !suggested) return;
    msg.innerHTML = `Held ${heldMs}ms. <button class="h-btn" data-usehold="${esc(bid)}" data-ms="${suggested}">Require ${suggested}ms</button>`;
  }

  // ---- wiring ------------------------------------------------------------------

  function edit(bid, patch) {
    const b = record.bindings.find((x) => x.id === bid);
    if (!b) return;
    Object.assign(b, patch);
    push();
    save();
  }

  on('click', (e) => {
    const who = e.target.closest('[data-who-id]');
    if (who) { select(who.dataset.whoId); return; }

    const foc = e.target.closest('[data-focus-id]');
    if (foc) { router?.setFocus(foc.dataset.focusId); renderFocus(); return; }

    const gate = e.target.closest('[data-gate]');
    if (gate && gate.dataset.gate) {
      record.gate = gate.dataset.gate;
      push(); save(); renderGate();
      return;
    }

    const del = e.target.closest('[data-del]');
    if (del) {
      record.bindings = record.bindings.filter((b) => b.id !== del.closest('[data-bid]').dataset.bid);
      push(); save(); renderBindings();
      return;
    }

    const repress = e.target.closest('[data-repress]');
    if (repress) {
      const bid = repress.closest('[data-bid]').dataset.bid;
      capture(({ device, control, heldMs }) => {
        edit(bid, { device, control });
        renderBindings();
        offerHold(bid, heldMs);
      });
      return;
    }

    const useHold = e.target.closest('[data-usehold]');
    if (useHold) {
      edit(useHold.dataset.usehold, { holdMs: Number(useHold.dataset.ms) });
      renderBindings();
      el('[data-addmsg]').textContent = '';
      return;
    }

    if (e.target.closest('[data-add]')) {
      const actionId = el('[data-new-action]').value;
      capture(({ device, control, heldMs }) => {
        const id = `b${record.bindings.length + 1}-${device}-${control}`.replace(/[^a-zA-Z0-9:#+_-]/g, '_');
        record.bindings.push(normalizeBinding({ id, actionId, device, control }));
        push(); save(); renderBindings();
        offerHold(id, heldMs);
      });
    }
  });

  on('change', (e) => {
    const field = e.target.closest('[data-f]');
    if (!field) return;
    const bid = field.closest('[data-bid]').dataset.bid;
    const key = field.dataset.f;
    const value = field.type === 'number' ? Math.max(0, Number(field.value) || 0) : field.value;
    edit(bid, { [key]: value });
    // Deliberately NOT re-rendering: the control already shows its own new value, and
    // rebuilding the table under someone mid-edit throws away their focus and their place.
    if (field.type === 'number') field.value = String(value);
  });

  // ---- lifecycle ---------------------------------------------------------------

  function teardown() {
    flush();
    detach.forEach((off) => off());
    detach = [];
    if (router) { router.destroy(); router = null; }
    if (pads) { pads.destroy(); pads = null; }
    if (input) { input.destroy(); input = null; }
    if (state) { state.destroy(); state = null; }
    lines.length = 0;
  }

  // Choosing a screen changes only what the verbs RESOLVE to. The bindings are the
  // person's and do not move.
  async function select(pid) {
    const p = list.find((x) => x.id === pid);
    if (!p) return;
    current = p;
    try {
      const full = await profiles.get(pid);
      screenModules = [...(full.modules || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    } catch (err) {
      console.error('could not read the screen', err);
      screenModules = [];
    }
    renderScreens();
    renderFocus();
  }

  async function refresh() {
    state = makeUserState(INPUTS_KEY);
    await state.load().catch(() => {});
    const saved = (state.get() || {})[INPUTS_KEY];

    // Normalized on the way IN, so the table never renders `undefined` into a number
    // field. A binding that will not normalize is dropped rather than taking every other
    // binding on the person's account down with it.
    const source = saved && Array.isArray(saved.bindings) && saved.v === RECORD_VERSION
      ? saved.bindings
      // Nobody has set this up yet, so the shipped default comes with it. Bindable never
      // means arrives unconfigured. A v1 record (per-screen, module-specific actions) is
      // deliberately NOT migrated: those bindings named actions that no longer exist, and
      // silently reinterpreting someone's switch setup is worse than asking them again.
      : DEFAULT_BINDINGS;
    record = {
      v: RECORD_VERSION,
      gate: GATES.includes(saved?.gate) ? saved.gate : 'both',
      bindings: source.map((b, i) => {
        try { return normalizeBinding(b, `b${i + 1}`); } catch (err) { console.error('dropped a binding', b, err); return null; }
      }).filter(Boolean),
    };

    input = (makeInput || createInputBus)({ bus: localBus, actions, onActivation });
    push();
    router = (makeRouter || createVerbRouter)({
      bus: localBus,
      modules: () => screenModules,
      onChange: () => renderFocus(),
    });
    pads = (makeGamepads || createGamepads)({
      input, onConnect: renderDevices, onDisconnect: renderDevices,
    });
    pads.start();
    detach = [attachKeys(input, {}), attachPtr(input, { target: root })];

    body();

    list = await profiles.list();
    renderScreens();
    const target = list.find((p) => p.id === initialProfileId) || list[0];
    if (target) await select(target.id);
  }

  return {
    refresh, select,
    current: () => current,
    bindings: () => record.bindings.map((b) => ({ ...b })),
    gate: () => record.gate,
    input: () => input,
    router: () => router,
    flush,
    destroy() { teardown(); listeners.abort(); },
  };
}
