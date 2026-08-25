// drive.js — the client half of REMOTE DRIVE: press it there, it happens here.
//
// The settings half of "two screens for one device" already worked and needed no transport
// at all: bindings are per-person, they live on the server, and the kiosk's input runtime
// re-reads them when they change. This is the other half — a clinician pressing something
// on a laptop and the patient's screen answering NOW, not in a poll.
//
// WHY THIS SITS ON TOP OF THE INPUT BUS RATHER THAN BESIDE IT. A driver sends a VERB. The
// receiving screen publishes that verb onto its own bus, and from there everything already
// built takes over: the router points it at the focused panel, the settings menu takes it
// if the menu is open, the modules answer exactly as they do for a switch in the room. So
// remote drive is not a second way to control a screen — it is the SAME way, with a longer
// wire. That is only possible because the input bus reached the kiosk first.
//
// WHAT CROSSES THE WIRE IS A NAME FROM A FIXED LIST, never a bus topic. If it were a topic,
// anybody holding a socket could publish anything at all onto a bedside screen. The server
// enforces the same list; this end does too, because a client that sends rubbish should
// find out at the client.
//
// THE TICKET. A browser cannot put headers on a WebSocket handshake, so the device key an
// unattended kiosk authenticates with cannot be sent that way, and putting it in the query
// string would leak a long-lived secret into access logs. Instead: an authenticated POST
// buys a single-use, thirty-second ticket, and the ticket goes in the URL. A token in a URL
// is a different thing from a secret in a URL.
//
// RECONNECTION IS NOT OPTIONAL. This runs on a Pi on facility wifi. The socket WILL drop,
// and a remote-drive feature that silently stops working is worse than one that visibly
// says "not connected" — so state changes are reported and reconnection backs off rather
// than hammering.

import { authHeaders } from './auth.js';
import { verbTopic } from './actions.js';

// Mirrored from actions.js, and mirrored again on the server. Duplicated on purpose: this
// is a boundary, and a boundary that widens because another file grew an entry is not one.
export const DRIVE_VERBS = [
  'select', 'back', 'next', 'prev', 'up', 'down', 'left', 'right', 'menu',
  'focus-next', 'focus-prev',
];

export const STATES = ['offline', 'connecting', 'connected'];

const wsURL = (base, personId, ticket, role) => {
  const origin = base
    || (typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : '');
  const scheme = origin.startsWith('https') ? 'wss' : 'ws';
  const host = origin.replace(/^https?:\/\//, '');
  return `${scheme}://${host}/api/drive/${encodeURIComponent(personId)}`
    + `?t=${encodeURIComponent(ticket)}&role=${encodeURIComponent(role)}`;
};

export function connectDrive({
  personId,
  role = 'driver',
  user = null,
  base = '',
  onVerb = null,          // screens: a verb arrived
  onPresence = null,      // both: how many screens / drivers are in the room
  onState = null,         // both: offline | connecting | connected
  // Seams, so the test needs no server and no real socket.
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
  SocketImpl = (typeof WebSocket !== 'undefined' ? WebSocket : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // 1s, 2s, 4s, 8s, capped. Long enough not to hammer a server that is down, short enough
  // that somebody standing at the screen does not give up on it.
  backoff = [1000, 2000, 4000, 8000],
} = {}) {
  if (!personId) throw new Error('connectDrive: personId is required');
  if (!['screen', 'driver'].includes(role)) throw new Error(`connectDrive: bad role "${role}"`);

  let sock = null;
  let state = 'offline';
  let closed = false;
  let attempt = 0;
  let timer = null;
  let presence = { screens: 0, drivers: 0 };

  const setState = (s) => { if (s !== state) { state = s; onState?.(s); } };

  async function ticketFor() {
    const res = await fetchImpl(`${base}/api/drive/ticket/${encodeURIComponent(personId)}`, {
      method: 'POST', headers: authHeaders(user),
    });
    if (!res.ok) throw new Error(`ticket -> ${res.status}`);
    return (await res.json()).ticket;
  }

  function retry() {
    if (closed) return;
    const wait = backoff[Math.min(attempt, backoff.length - 1)];
    attempt += 1;
    clearTimer(timer);
    timer = setTimer(() => open(), wait);
  }

  async function open() {
    if (closed) return;
    setState('connecting');
    let ticket;
    try {
      ticket = await ticketFor();
    } catch {
      // No ticket means no auth or no server. Both are "try again shortly", not "throw at
      // whoever mounted this" — a bedside screen must not die because a fetch failed.
      setState('offline');
      retry();
      return;
    }
    if (closed) return;

    try {
      sock = new SocketImpl(wsURL(base, personId, ticket, role));
    } catch {
      setState('offline');
      retry();
      return;
    }

    sock.onopen = () => { attempt = 0; setState('connected'); };
    sock.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'presence') {
        presence = { screens: msg.screens | 0, drivers: msg.drivers | 0 };
        onPresence?.({ ...presence });
        return;
      }
      // A screen accepts verbs. A driver ignores them, so two drivers on one room cannot
      // drive each other.
      if (msg.type === 'verb' && role === 'screen' && DRIVE_VERBS.includes(msg.verb)) {
        onVerb?.(msg.verb);
      }
    };
    sock.onclose = () => {
      sock = null;
      presence = { screens: 0, drivers: 0 };
      onPresence?.({ ...presence });
      setState('offline');
      retry();
    };
    sock.onerror = () => { /* onclose always follows; nothing useful to add here */ };
  }

  function send(verb) {
    if (role !== 'driver') return false;
    if (!DRIVE_VERBS.includes(verb)) return false;
    if (!sock || state !== 'connected') return false;
    try { sock.send(JSON.stringify({ type: 'verb', verb })); return true; } catch { return false; }
  }

  open();

  return {
    send,
    state: () => state,
    presence: () => ({ ...presence }),
    close() {
      closed = true;
      clearTimer(timer);
      try { sock?.close(); } catch { /* already gone */ }
      sock = null;
      setState('offline');
    },
  };
}

// The receiving end, in one call: verbs arriving on the wire become verbs on this screen's
// bus, which is the whole trick — everything downstream already knows what to do with them.
export function attachDriveToBus(bus, opts = {}) {
  return connectDrive({
    ...opts,
    role: 'screen',
    onVerb: (verb) => {
      bus.publish(verbTopic(verb));
      opts.onVerb?.(verb);
    },
  });
}
