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
import { ACTIVATION_TOPIC } from './input.js';
import { gatePermits, senderMeta, DEFAULT_REMOTE_ROLE } from './sender.js';

// Mirrored from actions.js, and mirrored again on the server. Duplicated on purpose: this
// is a boundary, and a boundary that widens because another file grew an entry is not one.
export const DRIVE_VERBS = [
  'select', 'back', 'next', 'prev', 'up', 'down', 'left', 'right', 'menu',
  'focus-next', 'focus-prev',
];

export const STATES = ['offline', 'connecting', 'connected'];

// Mirrored from drive.py, same reason as the verbs. A signal is how the two ends of a call
// swap an offer and an answer before any media can flow — the one part of a call that
// cannot be peer-to-peer, because the peers cannot reach each other yet.
//
// *** A SIGNAL IS NEVER PUBLISHED ONTO THE BUS. *** A verb arrives and becomes a press,
// which is the whole design; a signal arrives and goes to the call transport and nowhere
// else. If a signal could reach the bus, this socket would be a way to publish arbitrary
// payloads onto a bedside screen, which is exactly what the verb allowlist exists to stop.
export const SIGNAL_KINDS = ['offer', 'answer', 'bye', 'ice'];

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
  onSignal = null,        // both: a call signal arrived — goes to the transport, never the bus
                          //   (a convenience; `link.onSignal(cb)` is the general form)
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

  // SIGNALS ARE SUBSCRIBED TO, NOT HANDED IN ONCE. The kiosk opens this socket at boot and
  // the call transport is built later (and rebuilt, if the panel is torn down and remounted),
  // so a single constructor callback would either be null when the socket opens or stale
  // afterwards. Verbs do not have this problem — the host that mounts the screen owns them
  // for the whole session — which is why only this one is a set.
  const signalSubs = new Set();
  if (onSignal) signalSubs.add(onSignal);
  const fanSignal = (sig) => {
    for (const fn of [...signalSubs]) {
      try { fn(sig); } catch (err) { console.error('drive: signal subscriber', err); }
    }
  };

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
      // BOTH roles accept signals — a call is a conversation and the answer has to get
      // home. Handed to the caller's callback and never to the bus; see SIGNAL_KINDS.
      if (msg.type === 'signal' && msg.signal && SIGNAL_KINDS.includes(msg.signal.kind)) {
        fanSignal(msg.signal);
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

  // A signal, from either role. Deliberately NOT `send`: a caller that muddled the two
  // would be sending an SDP where a press was meant, and the two have completely different
  // rules about who may originate them.
  function sendSignal(signal) {
    if (!signal || !SIGNAL_KINDS.includes(signal.kind)) return false;
    if (!sock || state !== 'connected') return false;
    try { sock.send(JSON.stringify({ type: 'signal', signal })); return true; } catch { return false; }
  }

  open();

  return {
    send,
    sendSignal,
    /** Listen for call signals. Returns an unsubscribe, like every other listener here. */
    onSignal(cb) {
      if (typeof cb !== 'function') return () => {};
      signalSubs.add(cb);
      return () => signalSubs.delete(cb);
    },
    state: () => state,
    presence: () => ({ ...presence }),
    close() {
      closed = true;
      signalSubs.clear();
      clearTimer(timer);
      try { sock?.close(); } catch { /* already gone */ }
      sock = null;
      setState('offline');
    },
  };
}

// The receiving end, in one call: verbs arriving on the wire become verbs on this screen's
// bus, which is the whole trick — everything downstream already knows what to do with them.
//
// AND THE GATE NOW SEES THEM. Mike's ruling: *"I would expect the driver's input device to
// act the same as the user's input device. The only restrictions are what's set in the
// person's section."* Before this, a remote verb was published straight onto the bus, which
// is DOWNSTREAM of `input.js` — so `GATES = both | moderator | participant` governed every
// switch in the room and had no opinion at all about somebody driving from another house.
// Two rule-sets, one of them invisible. Now there is one, and it is the person's.
//
// WHERE THE CHECK HAS TO GO, and why it is not simply "reuse input.js". The local path is
// `control -> binding -> gate -> verb -> bus`; a driver sends a VERB, so it arrives HALFWAY
// ALONG, with no control and no binding to judge. The gate rule therefore has to be a
// function of `(gate, role)` rather than a function of a binding — which is exactly what
// pulling `gatePermits` out into sender.js bought.
//
// A REFUSED REMOTE PRESS IS REPORTED THE SAME WAY A REFUSED LOCAL ONE IS. It goes onto
// `ACTIVATION_TOPIC` with `reason: 'role-gated'`, so "why nothing happened" explains a
// clinician being held off by the gate in the same sentence, in the same list, as a switch
// being held off — because from the room they look identical, and a driver whose presses
// silently vanish will conclude the network is broken and start debugging the wrong thing.
//
// `gate` and `role` are FUNCTIONS, not values. The gate can be flipped mid-session (that is
// the whole "take the cursor" gesture), and a value captured at connect time would be the
// gate as it was when somebody plugged in.
export function attachDriveToBus(bus, opts = {}) {
  const {
    // Defaults to "open", so a host that has not wired a gate behaves exactly as before.
    gate = () => 'both',
    // MIKE'S DEFAULT: a grant confers `moderator` unless the person's own settings say
    // otherwise. When the grant grows a role column this is where it arrives; until then a
    // driver is the moderator, which matches both cases Mike named - him driving from home,
    // and family showing her a video.
    role = () => DEFAULT_REMOTE_ROLE,
    driverId = '',
    driverLabel = '',
    ...rest
  } = opts;

  return connectDrive({
    ...rest,
    role: 'screen',
    onVerb: (verb) => {
      const asRole = role() || DEFAULT_REMOTE_ROLE;
      const now = gate() || 'both';
      const from = { kind: 'remote', id: driverId, label: driverLabel || driverId, role: asRole };
      if (!gatePermits(now, asRole)) {
        bus.publish(ACTIVATION_TOPIC, {
          at: Date.now(),
          device: 'remote',
          deviceClass: 'remote',
          control: driverLabel || driverId || 'another screen',
          actionId: verbTopic(verb),
          bindingId: null,
          edge: null,
          role: asRole,
          gate: now,
          accepted: false,
          reason: 'role-gated',
          heldMs: null,
          latencyMs: null,
        });
        opts.onRefused?.({ verb, reason: 'role-gated', gate: now, role: asRole });
        return;
      }
      bus.publish(verbTopic(verb), undefined, senderMeta(from));
      opts.onVerb?.(verb, from);
    },
  });
}
