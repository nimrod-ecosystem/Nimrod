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
//
// *** LOCAL-FIRST, NOT LOCAL-AS-FALLBACK (2026-09-10). ***
//
// `load()` used to ask the server and read the cache only when that request FAILED — so a
// SLOW server read exactly like a dead one: a bedside screen with a warm cache waited on the
// same round trip as one starting cold, because the cache never got a chance to answer first.
// Now, when a last-known-good copy exists, it renders IMMEDIATELY from that copy and corrects
// against the server in the background. The server is still the truth — nothing here keeps a
// stale value once the network answers — it just no longer gets to decide how long the first
// paint takes. See `stale()`/`staleSinceMs()` below for the other half: silently serving an old
// copy is the dangerous failure (it looks current and isn't), so this also tracks how long it's
// been since the server last actually answered, for a caller that wants to say so.

import { cacheGet, cacheSet } from './cache.js';
import { authHeaders, httpError } from './auth.js';
import { nextPollDelay } from './poll_backoff.js';

// `cacheKey` (optional) opts this handle into OFFLINE RESILIENCE: every successful
// load caches {data,version} in localStorage, and a load renders that last-known-good
// copy immediately rather than waiting on the network at all. The server stays the
// source of truth — a background read corrects it the moment the network answers.
// Handles without a cacheKey behave exactly as before (no cache, no `stale()`). Used
// by the kiosk so a server blip — or just a slow one — doesn't blank or stall the
// screen; the dev harness leaves it off.
//
// `staleAfterMs` (default 3 minutes) is how long the server can go unconfirmed before
// `stale()` says so. Long enough that an ordinary blip or a slow response doesn't flap
// it, short enough that a screen that's genuinely been offline the whole visit says so
// well before anyone watching would otherwise wonder. A setting with a sensible
// default, not a claim that this number is the only right one.
export function createState({ url, user, pollMs = 1500, debounceMs = 250, maxRetries = 5,
                               cacheKey = null, staleAfterMs = 3 * 60 * 1000,
                               // A ceiling on how slow polling is allowed to get during a
                               // sustained failure (a real outage, not a single dropped
                               // packet) — see poll_backoff.js. One minute is a floor-to-
                               // ceiling default, not a claim it's the only right number:
                               // slow enough that an hours-long outage stops costing
                               // meaningful bandwidth, fast enough that recovery is noticed
                               // within a minute of the server actually coming back (the
                               // very next success resets to `pollMs` immediately anyway).
                               pollBackoffMaxMs = 60 * 1000,
                               // Optional push.js handle (see push.js and events.js's
                               // identical option). When given and connected, this handle
                               // subscribes to its OWN `url` for an instant refetch the
                               // moment a PUT anywhere tells the server this changed, and the
                               // timer-based poll below backs off to `pollBackoffMaxMs`
                               // instead of `pollMs` — never off, since push has no delivery
                               // guarantee. Omit it and this behaves exactly as it always has.
                               push = null,
                               // *** OPTIONAL: A FINER REBASE FOR A REFUSED WRITE (2026-10-04). *** The
                               // default rebase (`flush`, the 409 leg) keeps this handle's changed TOP-LEVEL
                               // keys wholesale, which is right for a row of independent settings and wrong
                               // for one whose whole arrangement sits under one key (a screen's `kiosk`).
                               // `merge(base, mine, theirs) -> { data, lost }` replaces it: `base` is the
                               // doc as the server last confirmed it to this handle, `mine` this handle's
                               // copy, `theirs` the server's truth from the refusal (doc_merge.js
                               // `mergeSettingsDoc`). `onLost(lost)` hears any part of a local change that
                               // could not be kept, so the caller can say so. Omit both and the rebase is
                               // exactly what it always was.
                               merge = null, onLost = null }) {
  let data = {};
  // The doc as the server last CONFIRMED it to this handle (a read, an accepted write, a refusal's truth):
  // the common ancestor a `merge` needs. Kept for every handle; read only when `merge` is given.
  let serverData = {};
  let version = 0;
  let loaded = false;
  let dirty = false;
  let pending = {};        // keys changed since last successful flush
  // PUTs in flight (2026-10-04). While one is, a read can answer with the doc from BEFORE it; adopting
  // that replaced the mirror with a copy missing the write, and once the write's new version landed the
  // poll saw "same version" and never corrected it. A read is skipped while a write is out, as while dirty.
  let writing = 0;
  let putTimer = null;
  let pollTimer = null;
  let unsubscribePush = null;
  // 0 = the server has never once answered this handle. Set on every confirmed response —
  // a 200 with unchanged data is still proof it answered, not just a changed one.
  let lastServerOkAt = 0;
  const createdAt = Date.now();
  const subscribers = new Set();

  const snapshot = () => structuredClone(data);

  function notify() {
    const snap = snapshot();
    for (const fn of [...subscribers]) {
      try { fn(snap); } catch (err) { console.error('state subscriber error', err); }
    }
  }

  async function fetchServer() {
    const res = await fetch(url, { headers: authHeaders(user) });
    if (!res.ok) throw httpError(res, `GET ${url} -> ${res.status}`);
    const body = await res.json();
    return { data: body.data || {}, version: body.version || 0 };
  }

  // Applies a confirmed server read. `forceNotify` covers the cold-load case, where there
  // was nothing on screen yet to compare against.
  function applyServer(server, { forceNotify = false } = {}) {
    lastServerOkAt = Date.now();
    const changed = server.version !== version || JSON.stringify(server.data) !== JSON.stringify(data);
    data = server.data;
    serverData = server.data;
    version = server.version;
    loaded = true;
    if (cacheKey) cacheSet(`state:${cacheKey}`, { data, version });
    if (changed || forceNotify) notify();
  }

  async function load() {
    if (cacheKey) {
      const c = cacheGet(`state:${cacheKey}`);
      if (c) {
        data = c.data || {};
        serverData = data;
        version = c.version || 0;
        loaded = true;
        notify();                    // instant render from the last-known-good copy
        // Correct against the real server in the background. Never blocks the caller
        // that is already showing something, and never throws past this point — a
        // failure here just means `stale()` starts counting, not an exception nobody
        // is awaiting.
        // (2026-10-04: NOT over a local change made since -- that used to replace the mirror the
        // change was in, so the next write sent the server's copy without it. The handle keeps
        // the cache's version, so that write is refused and rebased like any other stale one.)
        fetchServer().then((s) => { if (dirty || writing) lastServerOkAt = Date.now(); else applyServer(s); })
          .catch(() => { /* stays on the cache */ });
        return snapshot();
      }
    }
    // No cache to render from — nothing to show early, so this leg behaves as it
    // always did: wait for the network, and fall back only if it fails outright.
    try {
      const server = await fetchServer();
      applyServer(server, { forceNotify: true });
      return snapshot();
    } catch (err) {
      if (cacheKey) {
        const c = cacheGet(`state:${cacheKey}`);
        if (c) { data = c.data || {}; serverData = data; version = c.version || 0; loaded = true; notify(); return snapshot(); }
      }
      throw err;
    }
  }

  // Is this handle currently showing a copy it hasn't been able to confirm with the
  // server recently? Only meaningful for a handle with a cache to fall back on — one
  // without has no persisted copy to silently go stale on in the first place.
  function stale(now = Date.now()) {
    if (!cacheKey) return false;
    if (!lastServerOkAt) return loaded && now - createdAt >= staleAfterMs;
    return now - lastServerOkAt >= staleAfterMs;
  }

  // How long it's actually been, for a label that wants to say more than "stale" — null
  // when it isn't (so a caller doesn't have to re-check `stale()` to know whether the
  // number means anything).
  function staleSinceMs(now = Date.now()) {
    if (!stale(now)) return null;
    return lastServerOkAt ? now - lastServerOkAt : now - createdAt;
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
    const sent = data;                // the doc this attempt sends (`data` is replaced, never mutated)
    pending = {};
    dirty = false;

    let res;
    writing++;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: sent, base_version: version }),
      });
    } catch (err) {
      writing--;
      pending = { ...sending, ...pending }; dirty = true; throw err;
    }

    try {
      if (res.ok) {
        const body = await res.json();
        version = body.version;
        serverData = sent;
        lastServerOkAt = Date.now();          // a write the server accepted is proof it's there
        if (cacheKey) cacheSet(`state:${cacheKey}`, { data, version });
        return;
      }

      if (res.status === 409) {
        const body = await res.json();               // { data, version } — server truth
        const theirs = body.data || {};
        lastServerOkAt = Date.now();          // a 409 still means the server answered
        if (typeof merge === 'function') {
          // The finer rebase (see the option): base = what the server last confirmed to us.
          let r = null;
          try { r = merge(serverData, data, theirs); } catch (err) { console.error('state: merge', err); r = null; }
          if (r && r.data && typeof r.data === 'object') {
            serverData = theirs;
            version = body.version || 0;
            data = r.data;
            if (Array.isArray(r.lost) && r.lost.length && typeof onLost === 'function') {
              try { onLost(r.lost); } catch (err) { console.error('state: onLost', err); }
            }
            // Nothing of ours left to send (every local change gave way): adopt the truth, done.
            if (JSON.stringify(data) === JSON.stringify(theirs) && !Object.keys(pending).length) {
              dirty = false;
              if (cacheKey) cacheSet(`state:${cacheKey}`, { data, version });
              notify();
              return;
            }
            pending = { ...sending, ...pending };
            notify();
            if (retries > 0) return flush(retries - 1);
            console.error('state: gave up after repeated version conflicts');
            return;
          }
          // A merge that failed falls through to the ordinary rebase rather than losing the write.
        }
        pending = { ...sending, ...pending };        // keep our keys to retry
        data = { ...theirs, ...pending };            // rebase onto truth
        serverData = theirs;
        version = body.version || 0;
        notify();
        if (retries > 0) return flush(retries - 1);
        console.error('state: gave up after repeated version conflicts');
        return;
      }

      pending = { ...sending, ...pending }; dirty = true;
      throw httpError(res, `PUT ${url} -> ${res.status}`);
    } finally {
      writing--;
    }
  }

  // Cross-device convergence. Never overwrites a dirty mirror; adopts the server's
  // data+version otherwise. Server push (SSE) — the `push` option above — makes this fast
  // when a caller has a shared connection to give it; without one (or while it's down) this
  // is still the whole mechanism, polling on its own.
  //
  // *** BACKS OFF ON FAILURE, RESETS ON SUCCESS. *** Found 2026-09-15: this used to be a
  // bare `setInterval` that never stopped or slowed down, success or failure alike. During
  // a real database outage every open kiosk kept polling every `pollMs` (default 1.5s)
  // regardless — for HOURS, since a kiosk is designed to run unattended for as long as the
  // screen is on. Every one of those requests still costs real network transfer even when
  // it fails, and none of them could possibly have succeeded while the database was down.
  // A `setInterval` can't vary its own delay, so this is a self-rescheduling `setTimeout`
  // chain instead — see poll_backoff.js for the actual math and why it resets immediately
  // rather than ramping back up slowly.
  let pollFailures = 0;
  // *** SEPARATE FROM `pollTimer`, ON PURPOSE. *** A tick already in flight (awaiting
  // `fetch`) holds no live timer at all — `pollTimer` still names the handle that fired TO
  // START this tick, which is now meaningless to cancel. Without its own flag, calling
  // `destroy()` while a tick is mid-fetch does nothing: `clearTimeout` cancels a timer that
  // already fired, the in-flight tick finishes anyway, and it reschedules ITSELF right back
  // — a "destroyed" handle quietly still polling. Caught by state_events_backoff_test.html
  // testing several handles back to back, not by reasoning about it in advance.
  let pollStopped = false;

  // Shared by the timer tick AND a push notification — a push saying "this changed" does
  // exactly what a poll tick would have done anyway: ask, and skip asking at all while a
  // local edit is still pending (the same `dirty` guard as before push existed).
  async function pollOnce() {
    if (dirty || writing) return;
    try {
      const res = await fetch(url, { headers: authHeaders(user) });
      if (!res.ok) {
        pollFailures++;
      } else {
        pollFailures = 0;
        const body = await res.json();
        lastServerOkAt = Date.now();          // answered, whether or not anything changed
        // (2026-10-04: asked again AFTER the read -- a local change or a write made while it was out
        // must not be replaced by a copy from before it. The next tick asks again.)
        if (dirty || writing) return;
        if ((body.version || 0) !== version &&
            JSON.stringify(body.data || {}) !== JSON.stringify(data)) {
          data = body.data || {};
          serverData = data;
          version = body.version || 0;
          if (cacheKey) cacheSet(`state:${cacheKey}`, { data, version });
          notify();
        }
      }
    } catch { pollFailures++; }
  }

  function startPolling() {
    if (pollTimer) return;
    pollStopped = false;
    const tick = async () => {
      await pollOnce();
      if (pollStopped) return;
      // Push connected: this fetch is a slow safety net, not the primary signal (see
      // events.js's identical comment) — idles at `pollBackoffMaxMs` regardless of
      // `pollFailures`, since a push failure mode is exactly the sustained-failure case
      // that ceiling already covers.
      const delay = (push && push.isConnected())
        ? pollBackoffMaxMs
        : nextPollDelay(pollMs, pollFailures, pollBackoffMaxMs);
      pollTimer = setTimeout(tick, delay);
    };
    pollTimer = setTimeout(tick, pollMs);
    if (push) unsubscribePush = push.subscribe(url, pollOnce);
  }

  function subscribe(fn) {
    subscribers.add(fn);
    if (loaded) { try { fn(snapshot()); } catch (err) { console.error(err); } }
    return () => subscribers.delete(fn);
  }

  function destroy() {
    pollStopped = true;                          // stops a tick already in flight from rescheduling
    clearTimeout(pollTimer); pollTimer = null;   // a setTimeout chain now, not an interval
    clearTimeout(putTimer);
    unsubscribePush?.(); unsubscribePush = null;
  }

  return { load, get: snapshot, set, subscribe, flush, startPolling, destroy,
           getVersion: () => version, stale, staleSinceMs };
}
