// push.js — one shared connection this account's tabs use to hear "that changed,"
// instead of every open state/events handle asking on its own timer forever.
//
// Companion to input.js's device bus and to drive.js's WebSocket, and deliberately unlike
// both: this carries no verbs, no signaling, nothing bidirectional — one account-scoped
// EventSource, server to client only, naming a URL that has new data. A handle that hears
// its own URL does exactly what a successful poll would have done anyway: refetch it
// through the same authenticated endpoint it already calls. See web/server/push.py and
// docs/architecture.md's 2026-08-10 decision ("server push = SSE, not WebSocket").
//
// ONE CONNECTION, MANY SUBSCRIBERS. A kiosk with several open modules used to run 5-8
// independent polling timers; this opens exactly one EventSource per page, and lets each
// state.js/events.js handle subscribe to just the url it cares about.
//
// THE TICKET DANCE, NOT THE REAL CREDENTIAL. EventSource sends no custom headers at all —
// a kiosk's X-Device-Key has no way onto the connection directly. So this trades an
// already-authenticated POST for a short-lived, single-use ticket first (identical shape
// to drive.js's own connectDrive()), and only THAT goes in the EventSource URL.
//
// FAILS QUIET, NEVER FATAL. If EventSource is unsupported, the ticket fetch fails, a proxy
// blocks the connection, or it drops mid-session, subscribers simply never hear anything
// from this. Every one of them already polls on its own with backoff (poll_backoff.js) as
// the ground-truth fallback — this is only ever an accelerant, never the only path to a
// correct screen.
import { authHeaders } from './auth.js';

export function createPush({ user, ticketUrl = '/api/stream/ticket', streamUrl = '/api/stream',
                              EventSourceImpl = (typeof EventSource !== 'undefined' ? EventSource : null),
                              fetchImpl = fetch, reconnectDelayMs = 3000,
                              setTimer = (fn, ms) => setTimeout(fn, ms),
                              clearTimer = (id) => clearTimeout(id) } = {}) {
  const subscribers = new Map();   // url -> Set<callback>
  let connected = false;
  let es = null;
  let destroyed = false;
  let reconnectTimer = null;

  function notify(changedUrl) {
    const cbs = subscribers.get(changedUrl);
    if (!cbs) return;
    for (const cb of [...cbs]) {
      try { cb(); } catch (err) { console.error('push subscriber', err); }
    }
  }

  // The ticket is fetched, and the connection opened, asynchronously — nothing here
  // blocks construction, and a caller that starts subscribing immediately just has its
  // subscriptions sitting ready for whenever (if ever) the connection comes up.
  async function connect() {
    if (!EventSourceImpl) return;   // no EventSource in this environment — quietly inert
    try {
      const res = await fetchImpl(ticketUrl, { method: 'POST', headers: authHeaders(user) });
      if (!res.ok || destroyed) return;
      const { ticket } = await res.json();
      if (!ticket || destroyed) return;
      es = new EventSourceImpl(`${streamUrl}?t=${encodeURIComponent(ticket)}`);
      es.onopen = () => { connected = true; };
      es.onmessage = (e) => { notify(e.data); };
      // EventSource retries the connection ON ITS OWN after an error (that is the whole
      // point of the API) — but our ticket is single-use and 30s-lived, so a retry with
      // the SAME stale URL would just fail again forever. Getting a fresh ticket and
      // reconnecting from scratch is this file's job, not the browser's.
      es.onerror = () => {
        connected = false;
        if (destroyed) return;
        es?.close();
        es = null;
        reconnectTimer = setTimer(connect, reconnectDelayMs);
      };
    } catch (err) {
      if (!destroyed) reconnectTimer = setTimer(connect, reconnectDelayMs);
    }
  }
  connect();

  return {
    isConnected: () => connected,
    // Returns an unsubscribe function, the same convention bus.js's own subscribe uses.
    subscribe(changedUrl, cb) {
      if (!subscribers.has(changedUrl)) subscribers.set(changedUrl, new Set());
      subscribers.get(changedUrl).add(cb);
      return () => {
        const set = subscribers.get(changedUrl);
        if (!set) return;
        set.delete(cb);
        if (!set.size) subscribers.delete(changedUrl);
      };
    },
    destroy() {
      destroyed = true;
      clearTimer(reconnectTimer); reconnectTimer = null;
      es?.close();
      es = null;
      subscribers.clear();
    },
  };
}
