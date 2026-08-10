// Per-user state handle — the client half of the server-side state boundary.
//
// Non-negotiable (architecture.md): the SERVER is the source of truth. This
// handle keeps only an in-memory mirror. There is deliberately NO localStorage /
// IndexedDB store of record anywhere — that is what makes devices interchangeable
// and kills the "swap" problem by construction.
//
// Lifecycle:
//   load()          GET the server's copy on open (server wins)
//   get()           read the in-memory mirror
//   set(patch)      merge, notify subscribers, debounced-PUT to the server
//   subscribe(fn)   observe changes (own writes, first load, or another device)
//   startPolling()  interim live-sync until the server can push (see note below)
//   flush()         force a pending PUT (call on hide/unload)
//
// The identity is carried as the `X-Dev-User` header so one browser can act as a
// chosen user in dev. When real auth lands this becomes a cookie/token and this
// file does not otherwise change.

export function createState({ module, user, baseURL = '', pollMs = 1500, debounceMs = 250 }) {
  let data = {};
  let loaded = false;
  let dirty = false;          // unsaved local edits — guards the poller from clobbering
  let putTimer = null;
  let pollTimer = null;
  const subscribers = new Set();

  const url = `${baseURL}/api/state/${encodeURIComponent(module)}`;
  const authHeaders = () => (user ? { 'X-Dev-User': user } : {});

  function snapshot() { return structuredClone(data); }

  function notify() {
    const snap = snapshot();
    for (const fn of [...subscribers]) {
      try { fn(snap); } catch (err) { console.error('state subscriber error', err); }
    }
  }

  async function load() {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const body = await res.json();
    data = body.data || {};
    loaded = true;
    notify();
    return snapshot();
  }

  function set(patch) {
    data = { ...data, ...patch };
    dirty = true;
    notify();               // optimistic: subscribers see it immediately
    scheduleFlush();        // ...and it round-trips to the server
  }

  function scheduleFlush() {
    clearTimeout(putTimer);
    putTimer = setTimeout(flush, debounceMs);
  }

  async function flush() {
    clearTimeout(putTimer);
    if (!dirty) return;
    const body = JSON.stringify({ data });
    dirty = false;          // cleared before await; a racing set() re-dirties it
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) { dirty = true; throw new Error(`PUT ${url} -> ${res.status}`); }
  }

  // Interim convergence across devices. A dirty mirror is never overwritten, so
  // in-flight local edits are safe. This is a stopgap for real server push
  // (SSE/WebSocket) in a later slice — see architecture.md "Open questions".
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      if (dirty) return;
      try {
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) return;
        const body = await res.json();
        const incoming = body.data || {};
        if (JSON.stringify(incoming) !== JSON.stringify(data)) {
          data = incoming;
          notify();
        }
      } catch { /* transient; try again next tick */ }
    }, pollMs);
  }

  function subscribe(fn) {
    subscribers.add(fn);
    if (loaded) { try { fn(snapshot()); } catch (err) { console.error(err); } }
    return () => subscribers.delete(fn);
  }

  function destroy() {
    clearInterval(pollTimer); pollTimer = null;
    clearTimeout(putTimer);
  }

  return { load, get: snapshot, set, subscribe, flush, startPolling, destroy };
}
