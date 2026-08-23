// inputs.js - the INPUTS panel: what someone presses, and what it does.
//
// Slices 1 and 2 built a bus that can bind anything to anything and log every decision.
// None of it was reachable by a person. This is the surface, and it is the point at
// which the feature stops being infrastructure: an OT sits down with someone, plugs in
// whatever switch they already own, presses it, picks what it should do, and watches a
// live readout tell them whether the presses are landing.
//
// WHY IT RUNS ON ITS OWN PRIVATE BUS. The panel builds a real input bus from the saved
// bindings, so pressing a switch here exercises the same code the screen will - but on a
// bus with nothing mounted on it. Testing a control in the binder must never drive a
// live screen. A caregiver checking whether a headrest switch is registering should not
// be skipping photos on the screen someone is currently watching.
//
// NO SAVE BUTTON. Same rule the composer arrived at the hard way: edits autosave, and
// both exits flush a pending write. Someone tuning a hold threshold is watching the
// person, not the screen, and "I adjusted it and it didn't take" is the failure that
// makes people stop trusting a tool.
//
// BINDINGS ARE PER SCREEN, and that is a known compromise rather than a conclusion. What
// a control DOES depends on the screen, because the actions come from the modules on it.
// What a control NEEDS - hold time, debounce, lockout, which edge - depends on the
// PERSON and is identical everywhere. Today both live together per screen, so tuning is
// re-entered per screen. Lifting the tuning half into a per-user record is the right next
// move; it needs a server endpoint (state is scoped per screen), which is why it is not
// in this slice. Anyone doing it: the saved shape is versioned for exactly that reason.
//
// EVERY NUMBER HERE IS IN MILLISECONDS, which nobody thinks in. So capture measures the
// real hold and offers it back as a suggestion - "you held that 340ms, use 250?" - and
// the live strip names WHY a press was refused. Between them, a person can tune the
// timings by watching, without ever forming an opinion about a millisecond.

import { createBus } from './bus.js';
import { createDefaultRegistry } from './actions.js';
import { createInputBus, normalizeBinding, ACTIVATION_TOPIC, GATES, ROLES, EDGES } from './input.js';
import { attachKeyboard, DEFAULT_BINDINGS, KEYBOARD_DEVICE } from './input_keyboard.js';
import { createGamepads, controlLabel } from './input_gamepad.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Namespaced so it can never collide with a module instance id (those are 32-hex).
export const INPUTS_KEY = 'input-bindings';
export const RECORD_VERSION = 1;

const GATE_LABEL = { both: 'Everyone', moderator: 'Caregiver only', patient: 'Them only' };
const ROLE_LABEL = { universal: 'Anyone', moderator: 'Caregiver', patient: 'Them' };
const EDGE_LABEL = { press: 'on press', release: 'on release' };

// A measured hold turned into a threshold worth suggesting: comfortably under what they
// managed, rounded to something a person would type, and never so low it is meaningless.
export function suggestHold(heldMs) {
  const target = Math.floor((heldMs * 0.7) / 50) * 50;
  return target >= 100 ? target : 0;
}

export function mountInputs(root, {
  profiles, user = null, makeState = null, initialProfileId = null,
  // Seams: the test drives the whole panel with no hardware and no server.
  makeInput = null, makeGamepads = null, attachKeys = attachKeyboard,
  saveDebounceMs = 350,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let list = [];
  let current = null;
  let state = null;
  let input = null;
  let pads = null;
  let detachKeys = null;
  let offActivation = null;
  let saveTimer = null;
  let record = { v: RECORD_VERSION, gate: 'both', bindings: [] };

  const localBus = createBus();
  const actions = createDefaultRegistry();
  // home.js remounts a panel onto the SAME element (`main.innerHTML = ''` then mount), so
  // listeners hung on `root` survive the panel that added them. Without this, every visit
  // to the tab leaves another handler behind, still holding a destroyed panel's bus.
  const listeners = new AbortController();
  const on = (type, fn) => root.addEventListener(type, fn, { signal: listeners.signal });

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Inputs</h1>
        <p>Bind anything to anything. A switch, a button on a game controller, a key —
          whatever someone can already work. Press it here and see straight away whether
          it landed, and if it didn't, why not.</p>
      </div>
      <div class="h-who" data-who></div>
      <div data-body><p class="h-loading">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  // ---- persistence ------------------------------------------------------------

  function save() {
    if (!state) return;
    clearTimer(saveTimer);
    saveTimer = setTimer(() => {
      saveTimer = null;
      state.set({ [INPUTS_KEY]: { ...record, v: RECORD_VERSION } });
    }, saveDebounceMs);
  }

  // Both exits flush, so a change made a quarter-second before leaving is not lost.
  function flush() {
    if (saveTimer == null || !state) return;
    clearTimer(saveTimer);
    saveTimer = null;
    state.set({ [INPUTS_KEY]: { ...record, v: RECORD_VERSION } });
  }

  function push() {
    if (!input) return;
    input.setBindings(record.bindings);
    input.setGate(record.gate);
  }

  // ---- rendering --------------------------------------------------------------

  function renderWho() {
    el('[data-who]').innerHTML = list.length
      ? list.map((p) =>
        `<button class="h-chip${current && p.id === current.id ? ' on' : ''}" data-who-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')
      : '<span class="h-none">No screens yet — make one on the Screens tab.</span>';
  }

  function actionOptions(selected) {
    const groups = actions.groups();
    return [...groups.entries()].map(([group, items]) =>
      `<optgroup label="${esc(group)}">${items.map((a) =>
        `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</optgroup>`).join('');
  }

  function deviceName(device) {
    if (device === KEYBOARD_DEVICE) return 'Keyboard';
    const pad = (pads?.list() || []).find((s) => s.device === device);
    return pad ? (pad.id.split('(')[0].trim() || pad.device) : device;
  }

  function controlName(device, control) {
    if (device === KEYBOARD_DEVICE) return control.replace(/^key:/, '').toUpperCase();
    const pad = (pads?.list() || []).find((s) => s.device === device);
    return controlLabel(control, { mapping: pad?.mapping || '' });
  }

  function renderDevices() {
    const host = el('[data-devices]');
    if (!host) return;
    const rows = [
      `<li><b>Keyboard</b> <span class="h-hint">always available</span></li>`,
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
      host.innerHTML = '<p class="h-none">Nothing bound yet. Pick an action below and press your control.</p>';
      return;
    }
    host.innerHTML = `
      <table class="i-tab">
        <thead><tr>
          <th>Does what</th><th>Control</th><th>When</th>
          <th title="How long it must be held before it counts">Hold</th>
          <th title="Ignore a second press this soon after the last one">Debounce</th>
          <th title="After it fires, refuse a repeat for this long">Lockout</th>
          <th>Who</th><th></th>
        </tr></thead>
        <tbody>${record.bindings.map((b) => {
          const known = actions.has(b.actionId);
          return `<tr data-bid="${esc(b.id)}"${known ? '' : ' class="i-stale"'}>
            <td>${known
              ? `<select data-f="actionId">${actionOptions(b.actionId)}</select>`
              : `<span class="i-warn">${esc(b.actionId)} — no longer exists</span>`}</td>
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
          </tr>`;
        }).join('')}</tbody>
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
        <p class="h-hint">Lock the other person's controls while you set things up, then hand
          them back. This is itself bindable — put it on a switch and you never need the keyboard.
          Default: <code>Ctrl+Shift+E</code>.</p>
        <div class="i-gate" data-gate></div>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Connected</h2></div>
        <ul class="i-devs" data-devices></ul>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Bindings</h2></div>
        <div data-bindings></div>
        <div class="i-add">
          <select data-new-action>${actionOptions(null)}</select>
          <button class="h-btn h-primary" data-add>Press a control…</button>
          <span class="h-hint" data-addmsg></span>
        </div>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Try it</h2></div>
        <p class="h-hint">Every press, including the ones that were refused and why. Nothing here
          touches a live screen.</p>
        <div class="i-log" data-log><span class="h-none">Press something.</span></div>
      </div>`;
    renderGate();
    renderDevices();
    renderBindings();
  }

  // ---- the live strip ---------------------------------------------------------

  const lines = [];
  function onActivation(rec) {
    const host = el('[data-log]');
    if (!host) return;
    const label = rec.actionId ? (actions.get(rec.actionId)?.label || rec.actionId) : '—';
    const why = rec.accepted ? 'went through' : REASON_TEXT[rec.reason] || rec.reason;
    lines.unshift(`<div class="${rec.accepted ? 'i-ok' : 'i-no'}">
      <b>${esc(deviceName(rec.device))}: ${esc(controlName(rec.device, rec.control))}</b>
      → ${esc(label)} · ${esc(why)}${rec.heldMs ? ` · held ${rec.heldMs}ms` : ''}</div>`);
    lines.length = Math.min(lines.length, 40);
    host.innerHTML = lines.join('');
  }

  // Plain language, because the person reading this is watching a patient, not debugging.
  const REASON_TEXT = {
    unbound: 'nothing is bound to that control',
    'role-gated': 'blocked — not their turn right now',
    'unknown-action': 'bound to something that no longer exists',
    debounce: 'too soon after the last press (debounce)',
    lockout: 'too soon to repeat (lockout)',
    'too-short': 'let go too early for the hold time',
    'auto-release': 'never released — released automatically',
  };

  // ---- capture ----------------------------------------------------------------

  function capture(onPicked) {
    const msg = el('[data-addmsg]');
    const say = (t) => { if (msg) msg.textContent = t; };
    say('press the control now…');
    input.beginCapture({
      onCandidate: ({ device, control }) => say(`${deviceName(device)}: ${controlName(device, control)} — now let go`),
      onDone: ({ device, control, heldMs }) => {
        say('');
        onPicked({ device, control, heldMs });
      },
      onTimeout: () => say('nothing pressed — try again'),
    });
  }

  function offerHold(bid, heldMs) {
    const suggested = suggestHold(heldMs);
    const msg = el('[data-addmsg]');
    if (!msg || !suggested) return;
    msg.innerHTML = `Held ${heldMs}ms. <button class="h-btn" data-usehold="${bid}" data-ms="${suggested}">Require ${suggested}ms</button>`;
  }

  // ---- wiring -----------------------------------------------------------------

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

    const gate = e.target.closest('[data-gate]');
    if (gate && gate.dataset.gate) {
      record.gate = gate.dataset.gate;
      push(); save(); renderGate();
      return;
    }

    const del = e.target.closest('[data-del]');
    if (del) {
      const bid = del.closest('[data-bid]').dataset.bid;
      record.bindings = record.bindings.filter((b) => b.id !== bid);
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
        const id = `b-${record.bindings.length + 1}-${device}-${control}`.replace(/\s+/g, '_');
        record.bindings.push({
          id, actionId, device, control,
          edge: 'press', role: 'universal', holdMs: 0, debounceMs: 0, lockoutMs: 0,
        });
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
    // Deliberately NOT re-rendering. The control already shows its own new value, and
    // rebuilding the table under someone mid-edit throws away their focus and their
    // place in it — which is how you lose the second of two changes they were making.
    if (field.type === 'number') field.value = String(value);   // show the clamp
  });

  // ---- lifecycle --------------------------------------------------------------

  function teardown() {
    flush();
    if (offActivation) { offActivation(); offActivation = null; }
    if (detachKeys) { detachKeys(); detachKeys = null; }
    if (pads) { pads.destroy(); pads = null; }
    if (input) { input.destroy(); input = null; }
    if (state) { state.destroy(); state = null; }
    lines.length = 0;
  }

  async function select(pid) {
    const p = list.find((x) => x.id === pid);
    if (!p) return;
    current = p;
    renderWho();
    teardown();

    state = makeState(`${INPUTS_KEY}:${p.id}`);
    await state.load().catch(() => {});
    const saved = (state.get() || {})[INPUTS_KEY];
    // Normalized on the way IN, so the table never renders `undefined` into a number
    // field and an edit never patches onto a half-built object. A binding that will not
    // normalize (hand-edited, or from a future version) is dropped rather than crashing
    // the panel and taking every OTHER binding on the screen down with it.
    const source = saved && Array.isArray(saved.bindings)
      ? saved.bindings
      // A screen nobody has configured still has to DO something, so the shipped default
      // comes with it. Bindable never means arrives unconfigured.
      : DEFAULT_BINDINGS;
    record = {
      v: RECORD_VERSION,
      gate: GATES.includes(saved?.gate) ? saved.gate : 'both',
      bindings: source.map((b, i) => {
        try { return normalizeBinding(b, `b${i + 1}`); } catch (err) { console.error('dropped a binding', b, err); return null; }
      }).filter(Boolean),
    };

    input = (makeInput || createInputBus)({ bus: localBus, actions, onActivation });
    offActivation = localBus.subscribe(ACTIVATION_TOPIC, () => {});   // keeps the topic alive for diagnostics
    push();

    pads = (makeGamepads || createGamepads)({
      input,
      onConnect: () => { renderDevices(); },
      onDisconnect: () => { renderDevices(); },
    });
    pads.start();
    detachKeys = attachKeys(input, {});

    body();
  }

  async function refresh() {
    list = await profiles.list();
    renderWho();
    const target = (current && list.find((p) => p.id === current.id))
      || list.find((p) => p.id === initialProfileId) || list[0];
    if (target) await select(target.id);
    else el('[data-body]').innerHTML = '<p class="h-empty">Make a screen first, then its inputs appear here.</p>';
  }

  return {
    refresh, select,
    current: () => current,
    bindings: () => record.bindings.map((b) => ({ ...b })),
    gate: () => record.gate,
    input: () => input,
    flush,
    destroy() { teardown(); listeners.abort(); },
  };
}
