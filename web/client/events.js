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

  async function append(kind, data = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, data }),
    });
    if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
    await refresh();        // pull the authoritative list back
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

  return { load: refresh, append, get: () => cache, subscribe, startPolling, destroy };
}
