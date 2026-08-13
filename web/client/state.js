// Per-(user, profile, instance) OVERWRITE state handle — config/layout/settings.
//
// Server is the source of truth (architecture.md); this holds an in-memory mirror
// only — NO localStorage/IndexedDB store of record.
//
// Write policy is last-write-wins WITH optimistic concurrency (DECISIONS.md):
//   - every value carries a `version`;
//   - a PUT sends the version it read as `base_version`;
//   - the server rejects a stale write with 409 + the current truth;
//   - we rebase our still-pending keys onto that truth and retry.
// `pending` tracks exactly the keys we've changed since the last successful flush,
// so a rebase preserves a concurrent writer's other keys — no lost update.

import { cacheGet, cacheSet } from './cache.js';

// `cacheKey` (optional) opts this handle into OFFLINE RESILIENCE: every successful
// load caches {data,version} in localStorage, and a load whose network fetch FAILS
// falls back to that last-known-good instead of throwing. The server stays the
// source of truth (the cache is only read on failure). Handles without a cacheKey
// behave exactly as before. Used by the kiosk so a server blip doesn't blank the
// screen; the dev harness leaves it off.
export function createState({ url, user, pollMs = 1500, debounceMs = 250, maxRetries = 5, cacheKey = null }) {
  let data = {};
  let version = 0;
  let loaded = false;
  let dirty = false;
  let pending = {};        // keys changed since last successful flush
  let putTimer = null;
  let pollTimer = null;
  const subscribers = new Set();

  const authHeaders = () => (user ? { 'X-Dev-User': user } : {});
  const snapshot = () => structuredClone(data);

  function notify() {
    const snap = snapshot();
    for (const fn of [...subscribers]) {
      try { fn(snap); } catch (err) { console.error('state subscriber error', err); }
    }
  }

  async function load() {
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const body = await res.json();
      data = body.data || {};
      version = body.version || 0;
      loaded = true;
      if (cacheKey) cacheSet(`state:${cacheKey}`, { data, version });   // last-known-good
      notify();
      return snapshot();
    } catch (err) {
      // server unreachable: fall back to the last cached config so the screen keeps
      // its layout/settings (the local media agent keeps serving the bytes).
      if (cacheKey) {
        const c = cacheGet(`state:${cacheKey}`);
        if (c) { data = c.data || {}; version = c.version || 0; loaded = true; notify(); return snapshot(); }
      }
      throw err;
    }
  }

  function set(patch) {
    data = { ...data, ...patch };
    Object.assign(pending, patch);
    dirty = true;
    notify();
    clearTimeout(putTimer);
    putTimer = setTimeout(() => { flush().catch((e) => console.error(e)); }, debounceMs);
  }

  async function flush(retries = maxRetries) {
    clearTimeout(putTimer);
    if (!Object.keys(pending).length) { dirty = false; return; }

    const sending = { ...pending };   // the keys this attempt is responsible for
    pending = {};
    dirty = false;

    let res;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, base_version: version }),
      });
    } catch (err) {
      pending = { ...sending, ...pending }; dirty = true; throw err;
    }

    if (res.ok) {
      const body = await res.json();
      version = body.version;
      return;
    }

    if (res.status === 409) {
      const body = await res.json();               // { data, version } — server truth
      pending = { ...sending, ...pending };        // keep our keys to retry
      data = { ...(body.data || {}), ...pending };  // rebase onto truth
      version = body.version || 0;
      notify();
      if (retries > 0) return flush(retries - 1);
      console.error('state: gave up after repeated version conflicts');
      return;
    }

    pending = { ...sending, ...pending }; dirty = true;
    throw new Error(`PUT ${url} -> ${res.status}`);
  }

  // Interim cross-device convergence until server push (SSE) lands. Never
  // overwrites a dirty mirror; adopts the server's data+version otherwise.
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      if (dirty) return;
      try {
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) return;
        const body = await res.json();
        if ((body.version || 0) !== version &&
            JSON.stringify(body.data || {}) !== JSON.stringify(data)) {
          data = body.data || {};
          version = body.version || 0;
          notify();
        }
      } catch { /* transient */ }
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

  return { load, get: snapshot, set, subscribe, flush, startPolling, destroy, getVersion: () => version };
}
