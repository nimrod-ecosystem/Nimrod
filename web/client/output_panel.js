// output_panel.js - the OUTPUT tab: how this person wants to be told things.
//
// The twin of the Inputs tab. That one asks "what can you press"; this one asks "how
// should we answer". Both are per-USER and both follow the person to every screen they
// own, because both describe a body and a preference rather than a machine.
//
// THE WHOLE UI IS ONE GRID, deliberately. Verbs down the side, channels across the top,
// a checkbox at each crossing. Every alternative I considered - a card per verb, a
// wizard, disclosure panels - hides the one thing a caregiver actually needs to see,
// which is the SHAPE: is anything routed nowhere, is everything piled onto speech, does
// an alert have a way through if the room is noisy. A grid answers all three at a glance
// and fits on a phone.
//
// ONE DELIBERATE ASYMMETRY WITH THE INPUT BINDER. The binder runs on a private bus so
// that testing a switch can never drive a live screen. This panel does the opposite: the
// test buttons REALLY SPEAK and REALLY BEEP, because the thing being configured IS what
// it sounds like. You cannot pick a notification style by reading a checkbox. The
// isolation is still there - the channels render on THIS device, into THIS panel - but
// the point is that you hear it.
//
// WHAT IS NOT HERE YET, and why it is not stubbed: quiet hours. `daypart.js` already
// knows morning/daytime/primetime/sleepytime, so "no sound after 9pm" is a small step
// from the mute toggles below. It is left out because a half-built schedule that
// silences someone's alerts at the wrong hour is worse than no schedule at all.

import { createOutputBus, VERBS, CHANNELS, DEFAULT_ROUTING, DELIVERY_TOPIC } from './output.js';
import { defaultChannels } from './output_channels.js';
import { createBus } from './bus.js';
import { createRemoteReceiver, REMOTE_STREAM } from './output_remote.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const OUTPUT_KEY = 'output-routing';
export const RECORD_VERSION = 1;

// Most urgent first. The declared order in output.js is ascending priority because the
// index IS the priority; for a person reading a page, the thing that matters most goes
// at the top.
export const VERB_ROWS = ['alert', 'notify', 'say', 'status'];

const VERB_LABEL = {
  alert:  { name: 'Urgent',   hint: 'something needs attention now' },
  notify: { name: 'Worth knowing', hint: 'not urgent, but do not miss it' },
  say:    { name: 'Read aloud', hint: 'content being spoken — a message, a caption' },
  status: { name: 'Ambient',  hint: 'the current state of something; stays put, never interrupts' },
};

const CHANNEL_LABEL = {
  screen: 'On screen',
  speech: 'Spoken',
  sound: 'A sound',
  light: 'Indicator',
  remote: 'Another device',
};

const SAMPLE = {
  alert: 'Your chair needs service.',
  notify: 'Your data is ready to send.',
  say: 'Good morning. It is Tuesday.',
  status: 'Up to date',
};

export function mountOutput(root, {
  user = null, makeUserState = null, makeUserEvents = null,
  // Seams: the test drives the whole panel with no speaking and no server.
  makeOutput = null, channels = null,
  saveDebounceMs = 350,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let state = null;
  let output = null;
  let mailbox = null;
  let receiver = null;
  let saveTimer = null;
  let record = { v: RECORD_VERSION, routing: { ...DEFAULT_ROUTING }, muted: [] };

  const localBus = createBus();
  const listeners = new AbortController();
  const on = (type, fn) => root.addEventListener(type, fn, { signal: listeners.signal });

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Output</h1>
        <p>How this screen answers. You choose what kind of message reaches which way —
          spoken, on screen, a sound — and it follows you to every screen you own.
          The buttons below really speak, because that is the only way to pick.</p>
      </div>
      <div data-body><p class="h-loading">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);
  const available = () => (output ? output.channels() : []);

  // ---- persistence (per USER) --------------------------------------------------

  const payload = () => ({ v: RECORD_VERSION, routing: record.routing, muted: record.muted });

  function save() {
    if (!state) return;
    clearTimer(saveTimer);
    saveTimer = setTimer(() => { saveTimer = null; state.set({ [OUTPUT_KEY]: payload() }); }, saveDebounceMs);
  }
  function flush() {
    if (saveTimer == null || !state) return;
    clearTimer(saveTimer);
    saveTimer = null;
    state.set({ [OUTPUT_KEY]: payload() });
  }
  function push() {
    if (!output) return;
    output.setRouting(record.routing);
    for (const c of CHANNELS) output.setMuted(c, record.muted.includes(c));
  }

  // ---- rendering ---------------------------------------------------------------

  function renderGrid() {
    const host = el('[data-grid]');
    if (!host) return;
    const have = available();
    host.innerHTML = `
      <table class="o-tab">
        <thead><tr><th></th>${CHANNELS.map((c) => {
          const on = have.includes(c);
          return `<th class="${on ? '' : 'o-off'}" title="${on ? '' : 'not available on this device'}">
            ${esc(CHANNEL_LABEL[c])}${on ? '' : '<br><span class="h-hint">not here</span>'}</th>`;
        }).join('')}</tr></thead>
        <tbody>${VERB_ROWS.map((v) => {
          const routed = record.routing[v] || [];
          const nowhere = routed.filter((c) => have.includes(c)).length === 0;
          return `<tr${nowhere ? ' class="o-nowhere"' : ''}>
            <th scope="row"><b>${esc(VERB_LABEL[v].name)}</b>
              <span class="h-hint">${esc(VERB_LABEL[v].hint)}</span>
              ${nowhere ? '<span class="o-warn">goes nowhere</span>' : ''}</th>
            ${CHANNELS.map((c) => `<td><label class="o-cell">
              <input type="checkbox" data-verb="${v}" data-chan="${c}"
                ${routed.includes(c) ? 'checked' : ''}${have.includes(c) ? '' : ' disabled'}>
              <span class="sr-only">${esc(VERB_LABEL[v].name)} — ${esc(CHANNEL_LABEL[c])}</span>
            </label></td>`).join('')}
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  function renderChannels() {
    const host = el('[data-channels]');
    if (!host) return;
    const have = available();
    host.innerHTML = CHANNELS.map((c) => {
      const on = have.includes(c);
      const isMuted = record.muted.includes(c);
      if (!on) return `<li class="o-off"><b>${esc(CHANNEL_LABEL[c])}</b>
        <span class="h-hint">not available on this device</span></li>`;
      return `<li><b>${esc(CHANNEL_LABEL[c])}</b>
        <button class="h-btn${isMuted ? '' : ' h-primary'}" data-mute="${c}">
          ${isMuted ? 'Muted' : 'On'}</button></li>`;
    }).join('');
  }

  function body() {
    el('[data-body]').innerHTML = `
      <div class="h-card">
        <div class="h-card-head"><h2>How you are told</h2>
          <span class="h-hint">shared by every screen</span></div>
        <p class="h-hint">A kind of message can go several ways at once, and an urgent one
          usually should — if the room is noisy, the screen still says it.</p>
        <div data-grid></div>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Ways this device can reach you</h2></div>
        <ul class="o-chans" data-channels></ul>
        <p class="h-hint">Muting is for right now — headphones out, someone asleep in the
          room. It does not change the choices above.</p>
      </div>

      <div class="h-card">
        <div class="h-card-head"><h2>Hear it</h2>
          <button class="h-btn" data-silence>Stop everything</button></div>
        <p class="h-hint">These really speak and really sound. Press two at once to hear
          what happens when both want your attention.</p>
        <div class="i-add">${VERB_ROWS.map((v) =>
          `<button class="h-btn" data-try="${v}">${esc(VERB_LABEL[v].name)}</button>`).join('')}</div>
        <div class="o-stage" data-stage></div>
        <div class="i-log" data-log><span class="h-none">Nothing yet.</span></div>
      </div>`;
    renderGrid();
    renderChannels();
  }

  // ---- the live strip ----------------------------------------------------------

  const REASON_TEXT = {
    'no-channel': 'goes nowhere — nothing is ticked for it',
    'no-adapter': 'this device cannot do that',
    muted: 'that way is muted right now',
    expired: 'waited too long to still be worth saying',
    preempted: 'interrupted by something more urgent',
    'queue-full': 'too much at once — this was the least urgent',
    failed: 'that way failed',
  };

  const lines = [];
  function onDelivery(rec) {
    const host = el('[data-log]');
    if (!host) return;
    const where = rec.channel ? CHANNEL_LABEL[rec.channel] || rec.channel : '—';
    const what = rec.delivered ? 'arrived' : (REASON_TEXT[rec.reason] || rec.reason);
    lines.unshift(`<div class="${rec.delivered ? 'i-ok' : 'i-no'}">
      <b>${esc(VERB_LABEL[rec.verb]?.name || rec.verb)}</b> → ${esc(where)} · ${esc(what)}${
      rec.waitedMs > 50 ? ` · waited ${rec.waitedMs}ms` : ''}</div>`);
    lines.length = Math.min(lines.length, 40);
    host.innerHTML = lines.join('');
  }

  // ---- wiring ------------------------------------------------------------------

  on('change', (e) => {
    const box = e.target.closest('[data-verb][data-chan]');
    if (!box) return;
    const { verb, chan } = box.dataset;
    const set = new Set(record.routing[verb] || []);
    box.checked ? set.add(chan) : set.delete(chan);
    record.routing[verb] = CHANNELS.filter((c) => set.has(c));   // keep a stable order
    push(); save();
    // Only the row's own warning can change, but re-rendering the grid would take the
    // checkbox out from under the pointer mid-click. Update the flag in place instead.
    const row = box.closest('tr');
    const nowhere = record.routing[verb].filter((c) => available().includes(c)).length === 0;
    row.classList.toggle('o-nowhere', nowhere);
    const warn = row.querySelector('.o-warn');
    if (nowhere && !warn) row.querySelector('th').insertAdjacentHTML('beforeend', '<span class="o-warn">goes nowhere</span>');
    if (!nowhere && warn) warn.remove();
  });

  on('click', (e) => {
    const mute = e.target.closest('[data-mute]');
    if (mute) {
      const c = mute.dataset.mute;
      record.muted = record.muted.includes(c)
        ? record.muted.filter((x) => x !== c)
        : [...record.muted, c];
      push(); save(); renderChannels();
      return;
    }
    const t = e.target.closest('[data-try]');
    if (t) { output.emit({ verb: t.dataset.try, text: SAMPLE[t.dataset.try], source: 'output-panel' }); return; }
    if (e.target.closest('[data-silence]')) output.silence();
  });

  // ---- lifecycle ---------------------------------------------------------------

  function teardown() {
    flush();
    if (receiver) { receiver.destroy(); receiver = null; }
    mailbox = null;
    if (output) { output.destroy(); output = null; }
    if (state) { state.destroy(); state = null; }
    lines.length = 0;
  }

  async function refresh() {
    state = makeUserState(OUTPUT_KEY);
    await state.load().catch(() => {});
    const saved = (state.get() || {})[OUTPUT_KEY];

    // Validated on the way in. An unknown verb or channel in a stored record is dropped
    // rather than handed to the bus, and a record from a future version is ignored
    // wholesale — a half-understood routing table could silence someone's alerts.
    const routing = {};
    for (const v of VERBS) {
      const from = (saved?.v === RECORD_VERSION && Array.isArray(saved.routing?.[v]))
        ? saved.routing[v] : DEFAULT_ROUTING[v];
      routing[v] = (from || []).filter((c) => CHANNELS.includes(c));
    }
    record = {
      v: RECORD_VERSION,
      routing,
      muted: (saved?.v === RECORD_VERSION && Array.isArray(saved.muted) ? saved.muted : [])
        .filter((c) => CHANNELS.includes(c)),
    };

    body();     // the stage has to exist before the screen channel can mount into it

    // Signed out there is no account and so no other devices; the mailbox is absent and
    // the remote channel simply is not offered.
    mailbox = makeUserEvents ? makeUserEvents(REMOTE_STREAM) : null;
    output = (makeOutput || createOutputBus)({
      bus: localBus,
      channels: channels || defaultChannels({ mount: el('[data-stage]'), events: mailbox }),
      routing: record.routing,
      onDelivery,
    });
    // Listening as well as sending, so this tab is itself one of "your other devices" —
    // which is also the only way to see the round trip while setting it up.
    if (mailbox) {
      receiver = createRemoteReceiver({ events: mailbox, output });
      receiver.start().catch((err) => console.error('remote receiver', err));
    }
    push();
    localBus.subscribe(DELIVERY_TOPIC, () => {});   // keep the topic live for diagnostics

    renderGrid();      // now that we know which channels this device actually has
    renderChannels();
  }

  return {
    refresh,
    routing: () => ({ ...record.routing }),
    muted: () => [...record.muted],
    output: () => output,
    flush,
    destroy() { teardown(); listeners.abort(); },
  };
}
