// cache.js — a tiny localStorage JSON cache for OFFLINE RESILIENCE.
//
// The coordination server stays the SOURCE OF TRUTH. This is only a last-known-good
// MIRROR so a brief server outage (or a boot before the network is up) doesn't blank
// the screen — especially a bedside kiosk, where the photos and videos
// come from the LOCAL media agent and should keep playing even if the cloud server
// is unreachable. It is explicitly NOT a store of record (DECISIONS.md): it is
// written on every SUCCESSFUL read and only READ when the network read fails.

const PREFIX = 'nimrod:cache:';

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }   // private mode / disabled storage / bad JSON
}

export function cacheSet(key, val) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); }
  catch { /* private mode / quota — resilience is best-effort, never fatal */ }
}

// Fetch through the cache: return + store fresh on success; fall back to the last
// cached value when the fetch fails; only throw if there's nothing cached.
export async function cachedFetch(key, fetchFn) {
  try {
    const v = await fetchFn();
    cacheSet(key, v);
    return v;
  } catch (err) {
    const c = cacheGet(key);
    if (c != null) return c;
    throw err;
  }
}
