// media_sources.js — the per-user media-source registry client + the resolver.
//
// TWO halves, both deliberately thin:
//
//  1. REGISTRY client — talks to the platform (/api/media-sources): list / add /
//     remove the folders a user has connected. This is tiny per-user text (a label
//     + a base_url + a kind); it is ALL the platform ever stores about media.
//
//  2. RESOLVER — given a source and an album, fetches the agent's /list and turns
//     each item into a renderable absolute URL. The listing and the bytes come
//     STRAIGHT from the user's media agent at `base_url`; the platform server is
//     never in that path. This is the client half of "the server never sees the
//     bytes" (see ../../DECISIONS.md, web/media_agent/README.md).
//
// A photos module holds a reference {sourceId, album}; it looks the source up in
// the registry, calls resolveListing(), and feeds the item ids to the shared
// picker (rng.js). The item `id` == its path, stable across sessions, so the
// picker's play-stats key on it correctly.

import { cachedFetch } from './cache.js';
import { authHeaders } from './auth.js';
import { listFolderSources, removeFolderSource, resolveFolderListing } from './folder_source.js';

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

// Build the absolute media URL for an item on a source: base_url + /files/<path>,
// with each path SEGMENT encoded but the slashes preserved (so "trip 2019/a b.jpg"
// works). The agent serves relative paths precisely so this stays client-side —
// base_url is the user's runtime config, never in the repo.
export function mediaUrl(baseUrl, path) {
  const enc = String(path).split('/').map(encodeURIComponent).join('/');
  return `${trimSlash(baseUrl)}/files/${enc}`;
}

// --- Registry client (platform API) ----------------------------------------
export function createMediaSourcesClient({ user, base = '', cache = false } = {}) {
  async function fetchList() {
    const res = await fetch(`${base}/api/media-sources`, { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`GET /api/media-sources -> ${res.status}`);
    return (await res.json()).sources;
  }
  // `cache:true` opts into offline resilience: the registry (which folder → which
  // base_url) survives a coordination-server outage, so photos/personal can still
  // resolve media from the LOCAL agent. The agent's own /list is already local.
  // Two kinds of source, merged here so no consumer has to know the difference:
  //   * `agent`  — registered on the platform, shared across this user's devices.
  //   * `folder` — a browser folder handle, stored in IndexedDB on THIS DEVICE only
  //                (folder_source.js explains why it cannot be sent to the server).
  // The merge happens AFTER the cached fetch on purpose — folding device-local rows into
  // the cached server payload would write them into the offline mirror as if the server
  // had sent them, and they would then appear on devices that never had the folder.
  async function list() {
    // A failing registry call must NOT hide device-local folders. Two cases where it
    // otherwise would: the coordination server is unreachable (the offline-resilience
    // case this project cares about), and the demo page, where nobody is signed in and
    // /api/media-sources is a 401 by design. Folders live on the device and are still
    // perfectly usable in both.
    let remote = [];
    try {
      remote = (cache
        ? await cachedFetch(`media-sources:${user || 'anon'}`, fetchList)
        : await fetchList()) || [];
    } catch (err) {
      console.warn('media-sources: registry unavailable, using device-local folders only', err);
    }
    const local = await listFolderSources();
    return [...remote, ...local];
  }
  async function add({ label, base_url, kind = 'agent' }) {
    const res = await fetch(`${base}/api/media-sources`, {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, base_url, kind }),
    });
    if (!res.ok) throw new Error(`POST /api/media-sources -> ${res.status}`);
    return res.json();
  }
  // A folder source only exists on this device, so it is removed from IndexedDB — asking
  // the platform to delete an id it has never seen would just 404.
  async function remove(id) {
    const local = await listFolderSources();
    if (local.some((s) => s.id === id)) return removeFolderSource(id);
    const res = await fetch(`${base}/api/media-sources/${id}`, {
      method: 'DELETE', headers: authHeaders(user),
    });
    if (!res.ok) throw new Error(`DELETE /api/media-sources/${id} -> ${res.status}`);
    return res.json();
  }
  return { list, add, remove };
}

// --- Resolver (talks to the user's media agent, NOT the platform) ----------
// Fetch a source's listing for `album` and attach an absolute `url` + `sourceId`
// to each item. `fetchImpl` is injectable for tests. Throws on a dead/erroring
// agent so the caller can show "source unreachable" rather than a blank wall.
export async function resolveListing(source, album = '', { fetchImpl = fetch } = {}) {
  // A folder source has no base_url to fetch — the browser reads the files directly.
  // Same return shape, so photos.js and personal.js are unchanged.
  if (source && source.kind === 'folder') return resolveFolderListing(source, album);
  const base = trimSlash(source.base_url);
  const q = album ? `?album=${encodeURIComponent(album)}` : '';
  const res = await fetchImpl(`${base}/list${q}`);
  if (!res.ok) throw new Error(`media source "${source.label}": /list -> ${res.status}`);
  const body = await res.json();
  const items = (body.items || []).map((it) => ({
    ...it,
    sourceId: source.id,
    url: mediaUrl(base, it.path),
  }));
  return { album: body.album || album, albums: body.albums || [], items, count: items.length };
}

// Liveness probe for a source — used by a Sources UI to show connected/unreachable.
// Never throws; returns {ok:false,...} on any failure.
export async function sourceHealth(source, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${trimSlash(source.base_url)}/health`);
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: !!body.ok, ...body };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
