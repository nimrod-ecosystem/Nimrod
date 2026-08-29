// Per-(user, profile, instance) APPEND-ONLY events handle — event/log/progress/
// clinical data. The counterpart to state.js and deliberately a DIFFERENT shape:
// you can append and read, but there is NO set/update/delete. Immutability is
// enforced server-side (DB triggers); this handle simply offers no way to mutate.
//
// Server assigns the id and timestamp on append — the client clock is never
// trusted for the record.

import { authHeaders } from './auth.js';

// `limit` (optional) caps how many of the most-recent events the server returns
// (the API's own ?limit param; server default 50). A per-instance log is happy with
// the default; a SHARED ledger stream (see points.js) wants a bigger window so its
// derived totals cover more history.
export function createEvents({ url, user, pollMs = 1500, limit = null }) {
  const listURL = limit ? `${url}${url.includes('?') ? '&' : '?'}limit=${limit}` : url;
  let cache = { events: [], total: 0 };
  let loaded = false;
  let pollTimer = null;
  const subscribers = new Set();

  function notify() {
    for (const fn of [...subscribers]) {
      try { fn(cache); } catch (err) { console.error('events subscriber error', err); }
    }
  }

  async function refresh() {
    const res = await fetch(listURL, { headers: authHeaders(user) });
    if (!res.ok) return cache;
    cache = await res.json();
    loaded = true;
    notify();
    return cache;
  }

  // `meta` carries the provenance COLUMNS - `session_id` (which sitting) and
  // `producer_version` (which build wrote it). They are a third argument rather than keys in
  // `data` for the same reason the bus keeps meta out of the payload: `data` belongs to
  // whoever declared the kind, and these are the platform's. Omit it and nothing changes -
  // the columns take null, which honestly says "not captured".
  async function append(kind, data = {}, meta = null) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        data,
        ...(meta?.sessionId ? { session_id: meta.sessionId } : {}),
        ...(meta?.producerVersion ? { producer_version: meta.producerVersion } : {}),
      }),
    });
    if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
    await refresh();        // pull the authoritative list back
  }

  // Vouch for one row. NOTE THERE IS NO "who" PARAMETER: the attester is whoever is signed
  // in, decided by the server from the session and never sent from here. That is what stops
  // an attestation being a claim anybody can type. It appends a new event citing the
  // original, which is untouched - the log has no update.
  async function attest(eventId, { note = '' } = {}) {
    const res = await fetch(`${url}/${encodeURIComponent(eventId)}/attest`, {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) throw new Error(`attest ${eventId} -> ${res.status}`);
    await refresh();
    return true;
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => { refresh().catch(() => {}); }, pollMs);
  }

  function subscribe(fn) {
    subscribers.add(fn);
    if (loaded) { try { fn(cache); } catch (err) { console.error(err); } }
    return () => subscribers.delete(fn);
  }

  function destroy() {
    clearInterval(pollTimer); pollTimer = null;
  }

  return { load: refresh, append, attest, get: () => cache, subscribe, startPolling, destroy };
}
