// modules/home_controls.js - HOME CONTROLS: the lights, the fan, the TV, through Home Assistant (row 2.125, step 3 of
// docs/home-assistant-plan.md).
//
// Mike, 2026-10-25: "Home Assistant control - This is something we should really do." This panel shows the things
// ticked for this screen (set up on its computer: nimrod-ha-bridge.py --tick), each with its state in words and big
// buttons for what it can do: a light "On or off", "Brighter", "Dimmer"; a TV "Louder", "Pause or play"; a scene "Turn
// on". The buttons are ordinary buttons, so a switch reaches them the way it reaches any panel's (the router walks
// them), and a pointer or touch presses them. A press is one action on one thing; the panel says what it did.
//
// *** WHERE IT GOES. *** The page asks the bridge on its own computer (home_assistant.js); the bridge asks Home
// Assistant. On a screen whose launcher did not name the bridge (no Chromium local-network policy, or no bridge), the
// panel sends NOTHING and says, in words, that home controls are not set up on this screen - never a box asking
// permission, never a button that does nothing.
//
// It switches things; nothing in it reaches a person. (No boundary paragraph on the site: Mike, 2026-10-25, row 2.130.)
//
// HOW OFTEN IT LOOKS (`every`, a setting): the states are asked of the bridge every few seconds while the panel is up,
// so a lamp turned on by hand shows as on. The default, 5 seconds, is a loopback request to this computer's own bridge
// (and one to Home Assistant on the home network): cheap enough to be current, slow enough that a Pi does not notice.
// Home Assistant's live WebSocket replaces this later.

import { registerModule } from '../module.js';
import { haBridgeFrom, createHaClient, buttonsFor, stateWords, thingName } from '../home_assistant.js';

export const TYPE = 'home_controls';
export const TITLE = 'Home controls';
export const SETTINGS = [
  { key: 'every', label: 'Look for changes every', kind: 'choice', default: 5, level: 'advanced',
    options: [{ value: 3, label: '3 seconds' }, { value: 5, label: '5 seconds' }, { value: 10, label: '10 seconds' }, { value: 30, label: '30 seconds' }],
    note: 'how soon a light switched on by hand shows here' },
];
export const NOT_SET_UP = 'Home controls are not set up on this screen. They need Home Assistant, and the Nimrod bridge to '
  + 'it on this screen\'s computer.';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureStyle(doc) {
  if (!doc || doc.getElementById('home-controls-css')) return;
  const s = doc.createElement('style');
  s.id = 'home-controls-css';
  s.textContent = `
.hc-root{height:100%;overflow:auto;padding:12px;box-sizing:border-box;display:grid;gap:10px;align-content:start;color:var(--text,#222)}
.hc-thing{display:grid;gap:8px;padding:10px 12px;border-radius:12px;background:var(--surface,#fff);border:1px solid var(--border,rgba(0,0,0,.15))}
.hc-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:1.15rem}
.hc-name{font-weight:700}.hc-state{opacity:.85}
.hc-btns{display:flex;flex-wrap:wrap;gap:8px}
.hc-btn{min-height:48px;min-width:96px;padding:8px 14px;border-radius:10px;border:2px solid var(--accent,#2b6cb0);background:var(--surface,#fff);
  color:var(--text,#222);font:inherit;font-weight:600;cursor:pointer}
.hc-btn:focus-visible,.hc-btn[data-focused]{outline:4px solid var(--focus,var(--accent,#2b6cb0));outline-offset:2px}
.hc-said{margin:0;min-height:1.4em;font-size:1rem}
.hc-note{margin:0;opacity:.85}`;
  (doc.head || doc.documentElement).append(s);
}

registerModule(
  { type: TYPE, title: TITLE, core: 'new',
    description: 'The lights, the fan, the TV: the things ticked for this screen in Home Assistant, with big buttons.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const client = ctx.haClient || createHaClient({ base: haBridgeFrom() });
    let cfg = {};
    let dead = false, timer = null, things = [], reason = '', said = '', busy = false;

    function render() {
      if (dead) return;
      ensureStyle(mount.ownerDocument);
      if (!client.usable) {
        mount.innerHTML = `<div class="hc-root mod-box" data-hc="unset"><p class="hc-note">${esc(NOT_SET_UP)}</p></div>`;
        return;
      }
      const list = things.map((t) => `<div class="hc-thing" data-hc-thing="${esc(t.entity_id)}">`
        + `<div class="hc-head"><span class="hc-name">${esc(thingName(t))}</span><span class="hc-state" data-hc-state>${esc(stateWords(t))}</span></div>`
        + `<div class="hc-btns">${buttonsFor(t).map((b) => `<button type="button" class="hc-btn" data-hc-act="${esc(b.action)}" data-hc-for="${esc(t.entity_id)}">${esc(b.label)}</button>`).join('')}</div></div>`).join('');
      const empty = !things.length ? `<p class="hc-note">${esc(reason ? `Home controls: ${reason}.` : 'Nothing is ticked for this screen yet.')}</p>` : '';
      mount.innerHTML = `<div class="hc-root mod-box" data-hc="on">${list}${empty}<p class="hc-said" data-hc-said aria-live="polite">${esc(said)}</p></div>`;
    }
    async function refresh() {
      if (dead || !client.usable) return;
      const r = await client.states();
      if (dead) return;
      if (r.ok) { things = Array.isArray(r.states) ? r.states : []; reason = ''; }
      else { reason = r.reason || 'no answer'; if (!things.length) things = []; }
      render();
    }
    function arm() {
      if (timer != null) clearT(timer);
      timer = null;
      if (dead || !client.usable) return;
      const every = [3, 5, 10, 30].includes(Number(cfg.every)) ? Number(cfg.every) : 5;
      timer = setT(() => { timer = null; refresh().finally(arm); }, every * 1000);
    }
    async function press(entityId, action) {
      if (busy || dead) return;
      const t = things.find((x) => x.entity_id === entityId);
      const label = buttonsFor(t || {}).find((b) => b.action === action)?.label || action;
      busy = true;
      const r = await client.call(entityId, action);
      busy = false;
      said = r.ok ? `${thingName(t)}: ${label.toLowerCase()}.` : `${thingName(t)}: ${r.reason || 'that did not work'}.`;
      await refresh();
    }
    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-hc-act]') : null;
      if (!b || !mount.contains(b)) return;
      press(b.getAttribute('data-hc-for'), b.getAttribute('data-hc-act'));
    }
    return {
      __probe: () => ({ usable: client.usable, things: things.map((t) => t.entity_id), said, reason }),
      __press: press,
      init() {
        cfg = { ...(state?.get?.() || {}) };
        state?.subscribe?.((s) => { if (dead) return; cfg = { ...(s || {}) }; arm(); });
        mount.addEventListener('click', onClick);
        render();
        refresh().finally(arm);
      },
      onShow() { refresh(); },
      onResize() {},
      destroy() {
        dead = true;
        if (timer != null) clearT(timer);
        timer = null;
        mount.removeEventListener('click', onClick);
        mount.innerHTML = '';
      },
    };
  },
);
