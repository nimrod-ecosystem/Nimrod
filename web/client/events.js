// Per-(user, profile, instance) APPEND-ONLY events handle — event/log/progress/
// clinical data. The counterpart to state.js and deliberately a DIFFERENT shape:
// you can append and read, but there is NO set/update/delete. Immutability is
// enforced server-side (DB triggers); this handle simply offers no way to mutate.
//
// Server assigns the id and timestamp on append — the client clock is never
// trusted for the record.

export function createEvents({ url, user, pollMs = 1500 }) {
  let cache = { events: [], total: 0 };
  let loaded = false;
  let pollTimer = null;
  const subscribers = new Set();

  const authHeaders = () => (user ? { 'X-Dev-User': user } : {});

  function notify() {
    for (const fn of [...subscribers]) {
      try { fn(cache); } catch (err) { console.error('events subscriber error', err); }
    }
  }

  async function refresh() {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return cache;
    cache = await res.json();
    loaded = true;
    notify();
    return cache;
  }

  async function append(kind, data = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
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
