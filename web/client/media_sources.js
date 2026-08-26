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
// `personId` SCOPES THE REGISTRY TO ONE PERSON'S SCREENS: their own sources plus the
// account-wide ones. Absent, the client sees everything the account owns, which is the
// management view - and which is what every existing caller gets, unchanged.
//
// WHY IT MATTERS ON A SCREEN RATHER THAN IN AN ADMIN PANEL: an account with one person never
// notices this exists. An account with several - a family, a facility, a clinician with a
// caseload - needs Christine's albums to be HERS, not on the resident next door's screen and
// not browsable by their family. A person's screen is also their private life.
export function createMediaSourcesClient({ user, base = '', cache = false, personId = null } = {}) {
  const scope = personId ? `?person_id=${encodeURIComponent(personId)}` : '';
  async function fetchList() {
    const res = await fetch(`${base}/api/media-sources${scope}`, { headers: authHeaders(user) });
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
        // THE CACHE KEY CARRIES THE PERSON. Without it, two people's screens on one machine
        // would share one offline mirror, and whichever loaded first would decide what the
        // other saw the next time the server was unreachable - which is the privacy bug this
        // whole column exists to prevent, arriving through the back door.
        ? await cachedFetch(`media-sources:${user || 'anon'}:${personId || 'all'}`, fetchList)
        : await fetchList()) || [];
    } catch (err) {
      console.warn('media-sources: registry unavailable, using device-local folders only', err);
    }
    const local = await listFolderSources();
    return [...remote, ...local];
  }
  // Adding from a person's screen files the source under that person by default, which is
  // what somebody standing at a bedside means. Pass `person_id: null` explicitly to make one
  // account-wide from such a screen.
  async function add({ label, base_url, kind = 'agent', person_id = personId }) {
    const res = await fetch(`${base}/api/media-sources`, {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, base_url, kind, person_id: person_id || null }),
    });
    if (!res.ok) throw new Error(`POST /api/media-sources -> ${res.status}`);
    return res.json();
  }

  // Move a source between "the account's" and "one person's". BOTH DIRECTIONS: narrowing is
  // the privacy fix, widening is the commoner mistake - a family folder set up on one screen
  // that everybody then wants, and which without this is stuck there.
  async function moveTo(id, person_id) {
    const res = await fetch(`${base}/api/media-sources/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: person_id || null }),
    });
    if (!res.ok) throw new Error(`PATCH /api/media-sources/${id} -> ${res.status}`);
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
  return { list, add, remove, moveTo, personId: () => personId || null };
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

// ---------------------------------------------------------------------- pairing
// SIX CHARACTERS INSTEAD OF AN IP ADDRESS.
//
// Connecting a device used to mean reading its address off one machine and typing it into
// a browser on another. That is an administrator's task, and it is why the media agent was
// unusable by the people it exists for.
//
// THE HALF THAT LIVES HERE IS THE INTERESTING HALF. The agent cannot know which of its
// addresses this browser can reach - `localhost` only works when they are the same
// machine, a LAN address only from the same network - so it offers CANDIDATES and we find
// out, by asking each one. That is why claiming a code does not create a source on the
// server: the server would have to guess, and it would be wrong at a bedside.

export const PAIR_CODE_LEN = 6;

// Case and punctuation are how people write a code down off a screen. Nothing is
// substituted: the alphabet contains no ambiguous glyph (no 0/O, 1/I/L, U), so a typed O
// is a genuine misreading with no correct character to map it to, and quietly changing it
// would pair the wrong device. Mirrors normalize_code() on the server.
export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 32);
}

// Ask an agent who it is. Short timeout because this runs against several addresses in a
// row and most of them are expected to fail — an unreachable LAN address would otherwise
// hang the whole thing on one browser's connect timeout.
async function probeAgent(baseURL, { fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${baseURL}/health`, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The first candidate that answers AND is the agent we just paired with, in order.
//
// THE IDENTITY CHECK IS NOT DECORATION. Candidates include LAN addresses, and a machine
// that took the same DHCP lease — or any other agent someone runs on 8770 — would answer
// happily. Without matching the id, "it responded" is enough to make a stranger's folder
// somebody's photo source. When the agent reports no id at all (an older build), reaching
// it is all we can check, and that is stated rather than pretended.
export async function findReachable(baseURLs, agentId, opts = {}) {
  for (const url of baseURLs || []) {
    const health = await probeAgent(url, opts);
    if (!health || health.ok !== true) continue;
    if (agentId && health.agent_id && health.agent_id !== agentId) continue;
    return { base_url: url, agent_id: health.agent_id || '', verified: !!(agentId && health.agent_id) };
  }
  return null;
}
