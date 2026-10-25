// home_assistant.js - THE PAGE'S SIDE OF HOME ASSISTANT CONTROL (row 2.125; docs/home-assistant-plan.md, step 2).
//
// The page never talks to Home Assistant. It talks to the bridge on its own computer
// (web/kiosk_installer/deploy/nimrod-ha-bridge.py, 127.0.0.1:8766), which holds the address and the token and asks
// Home Assistant on the home network. This file is the client for that bridge, plus the words for its actions.
//
// *** IT NEVER CALLS THE BRIDGE UNLESS TOLD WHERE IT IS. *** Without Chromium's local-network policy, the first call to
// this computer from the site puts "wants to access other apps and services on this device - Block / Allow" on the
// screen until somebody answers it: on a screen nobody may be able to answer, exactly the state the project forbids.
// So the address comes only from the launcher, which passes `haBridge=<address>` only when that policy is there
// (kiosk-launch.sh, the same rule as `lockHelper` and `localVoice`), or `haBridge=off`, which forgets one learned
// earlier. Loopback addresses only. No address: every call answers "not set up here", and nothing is sent.

import { isLoopbackUrl } from './screen_lock.js';

export const HA_BRIDGE_PARAM = 'haBridge';
export const HA_BRIDGE_KEY = 'nimrod:ha-bridge';

// What a person sees on each action's button, in plain words. The actions are the bridge's (ACTIONS / DOORS there).
export const ACTION_WORDS = Object.freeze({
  on: 'Turn on', off: 'Turn off', toggle: 'On or off', brighter: 'Brighter', dimmer: 'Dimmer',
  louder: 'Louder', quieter: 'Quieter', pause: 'Pause or play', lock: 'Lock', unlock: 'Unlock',
  open: 'Open', close: 'Close', stop: 'Stop',
});
// Which buttons a thing shows, in this order (a light does not need "Turn on" and "Turn off" beside "On or off").
export const BUTTONS = Object.freeze({
  light: ['toggle', 'brighter', 'dimmer'], fan: ['toggle'], switch: ['toggle'],
  media_player: ['on', 'off', 'louder', 'quieter', 'pause'], scene: ['on'], lock: ['lock', 'unlock'], cover: ['open', 'close'],
});

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** The bridge's address for this page: the launcher's `haBridge`, kept; `off` forgets it; loopback only. PURE but for storage. */
export function haBridgeFrom({ search = (typeof location !== 'undefined' ? location.search : ''), storage = defaultStorage() } = {}) {
  let asked = null;
  try { asked = new URLSearchParams(search || '').get(HA_BRIDGE_PARAM); } catch { asked = null; }
  if (asked === 'off') { try { storage?.removeItem?.(HA_BRIDGE_KEY); } catch { /* none */ } return null; }
  if (asked && isLoopbackUrl(asked)) { try { storage?.setItem?.(HA_BRIDGE_KEY, asked); } catch { /* none */ } return asked.replace(/\/+$/, ''); }
  let kept = null;
  try { kept = storage?.getItem?.(HA_BRIDGE_KEY) || null; } catch { kept = null; }
  return kept && isLoopbackUrl(kept) ? kept.replace(/\/+$/, '') : null;
}

/** The buttons a thing shows: its domain's, among the actions the bridge says it has. PURE. */
export function buttonsFor(thing = {}) {
  const have = new Set(thing.actions || []);
  return (BUTTONS[thing.domain] || []).filter((a) => have.has(a)).map((a) => ({ action: a, label: ACTION_WORDS[a] || a }));
}

/** A thing's state in words: "On", "Off", "Locked", "Not answering". PURE. */
export function stateWords(thing = {}) {
  const s = String(thing.state ?? '');
  if (s === 'unavailable' || s === 'unknown' || !s) return 'Not answering';
  if (thing.domain === 'scene') return '';
  if (thing.domain === 'light' && s === 'on' && Number.isFinite(thing.brightness)) return `On, ${Math.round((thing.brightness / 255) * 100)}%`;
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

/** What a person calls a thing: the name they gave it, else Home Assistant's. PURE. */
export const thingName = (thing = {}) => thing.label || thing.name || thing.entity_id || 'A thing';

/**
 * The client. `base`: the bridge's address (haBridgeFrom), or null - then every call answers { ok: false, reason:
 * 'not set up here' } and nothing is sent. Every answer is { ok, ... } or { ok: false, reason } in words; it never throws.
 */
export function createHaClient({ base = null, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const usable = !!base && isLoopbackUrl(base);
  async function ask(method, path, body) {
    if (!usable) return { ok: false, reason: 'not set up here' };
    try {
      const r = await fetchImpl(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: 'no-store' });
      let j = null;
      try { j = await r.json(); } catch { j = null; }
      if (j && typeof j === 'object') return { ...j, ok: !!j.ok && r.ok };
      return { ok: false, reason: `the bridge answered ${r.status}` };
    } catch { return { ok: false, reason: 'the bridge on this computer is not answering' }; }
  }
  return {
    usable,
    status: () => ask('GET', '/ha/status'),
    states: () => ask('GET', '/ha/states'),
    call: (entityId, action) => ask('POST', '/ha/call', { entity_id: entityId, action }),
  };
}
