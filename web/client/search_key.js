// search_key.js — ONE YOUTUBE (OR SPOTIFY) KEY, ENTERED ONCE, USED EVERYWHERE (row 2.57).
//
// Mike, 2026-10-07: "We should only have to enter the API once. Either through Youtube settings or in the media
// module/tab. Entering it in either place should set it as the default everywhere for that account or user. It
// should be something that you can change at any level user, device, module, etc."
//
// Before this there were two copies of the same YouTube key: a YouTube panel's own "YouTube API key (for
// searching)" setting, kept in the panel's settings and sent to Google FROM THE BROWSER in the search address,
// and the account's search key on /search_keys.html, kept encrypted on the server for "Recommend a song or
// video". Now there is one: the server's (web/server/recommend_search.py). A key typed in either place is saved
// there, encrypted, and never comes back to any page - only "ending …4f2a".
//
// *** WHY THE PANEL'S SEARCH NOW GOES THROUGH THE SERVER (argued). *** FOR asking Google from the browser: one hop
// fewer, and it worked. AGAINST, and it decides it: a key in the browser is in the panel's settings for anyone at
// that screen to read back, and in the address of every search, where a proxy or a history list keeps it. Through
// the server the key never leaves the sealed store, and the searches count against the same key either way.
//
// WHERE A KEY MAY SIT, nearest first: this panel, this device, this person, then the account (the default). A
// level with nothing saved uses the next one up, which is what "use the default" means. The server resolves it;
// this file only says where "here" is (`context`), so every search names its panel, device and person.
//
//   createSearchKeyClient({ user, fetchImpl, context })   status / save / clear / adopt / searchYouTube
//   keyInForceWords(status, provider)                    "the account's key, ending …4f2a" | null
//   KEY_LEVEL_WORDS                                      the levels as a row says them

import { authHeaders } from './auth.js';
import { deviceId } from './output_remote.js';

export const KEYS_URL = '/api/recommend/keys';
export const SEARCH_URL = '/api/recommend/search';
// Saved for, as the server names them. "account" is the default every other level falls back to.
export const KEY_LEVELS = Object.freeze(['account', 'person', 'device', 'panel']);
export const KEY_LEVEL_WORDS = Object.freeze({
  account: 'the whole account (every screen and search)',
  person: 'this person only',
  device: 'this device only',
  panel: 'this panel only',
});
// Whose key it is, in a sentence ("the account's key, ending …4f2a").
const OWNER_WORDS = Object.freeze({
  account: 'the account’s key', person: 'this person’s own key', device: 'this device’s own key', panel: 'this panel’s own key',
});

/** The places a request is made from, the empty ones left out. PURE. */
export function keyContext({ panel = '', person = '', device = '' } = {}) {
  const out = {};
  for (const [k, v] of Object.entries({ panel, person, device })) {
    const s = String(v == null ? '' : v).trim();
    if (s) out[k] = s;
  }
  return out;
}

/** The key a search here would use, in words, or null when there is none. PURE. */
export function keyInForceWords(status, provider = 'youtube') {
  const f = status && status[provider] && status[provider].in_force;
  if (!f || !f.level) return null;
  return `${OWNER_WORDS[f.level] || 'a saved key'}, ending …${f.last4 || ''}`;
}

/** What is saved at one level (for the "saved for" choices), in a few words. PURE. */
export function keyAtLevelWords(status, provider, level, ctx = {}) {
  const p = status && status[provider];
  if (!p) return '';
  if (level === 'account') return p.set ? `ending …${p.last4 || ''}` : 'none saved';
  const ref = ctx[level];
  const hit = ref ? (p.overrides || []).find((o) => o.level === level && o.ref === ref) : null;
  return hit ? `ending …${hit.last4 || ''}` : 'none saved';
}

/**
 * The page's half of the keys. `context()` is read at each call: { panel, person, device } (device defaults to this
 * browser's own id, output_remote.js). Never holds a key: `save` sends one and forgets it.
 */
export function createSearchKeyClient({
  user = null, fetchImpl = (...a) => fetch(...a), context = () => ({}), label = () => '',
} = {}) {
  let last = null;
  const ctx = () => {
    let c = {};
    try { c = context() || {}; } catch { c = {}; }
    return keyContext({ device: deviceId(), ...c });
  };
  async function call(method, url, body) {
    const init = { method, credentials: 'same-origin',
      headers: { ...authHeaders(user), ...(body ? { 'Content-Type': 'application/json' } : {}) } };
    if (body) init.body = JSON.stringify(body);
    let res;
    try { res = await fetchImpl(url, init); } catch { return { ok: false, status: 0, body: null }; }
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: j };
  }
  const detail = (r, fallback) => (r && r.body && typeof r.body.detail === 'string' && r.body.detail) || fallback;
  const keep = (r) => { if (r.ok && r.body && typeof r.body === 'object' && r.body.youtube) last = r.body; return r; };
  // (row 2.61) A Spotify Client ID may be saved with no secret (`save('spotify', { client_id })`): the Music panel's
  // Connect needs nothing else, and search then says it needs the secret too.

  const api = {
    context: ctx,
    last: () => last,
    async status() {
      const q = new URLSearchParams(ctx()).toString();
      const r = keep(await call('GET', q ? `${KEYS_URL}?${q}` : KEYS_URL));
      return r.ok ? r.body : null;
    },
    /** Save a typed key at `level` (account | person | device | panel). { ok, message }. The key is not kept. */
    async save(provider, key, level = 'account') {
      const c = ctx();
      if (level !== 'account' && !c[level]) {
        return { ok: false, message: level === 'person' ? 'This screen is not set up for a person yet, so a key cannot be saved for one.' : 'Could not tell which one to save it for.' };
      }
      const body = provider === 'spotify' ? { ...key } : { key };
      const r = keep(await call('PUT', `${KEYS_URL}/${provider}`, { ...body, level, ref: level === 'account' ? '' : c[level], label: label(level) || '' }));
      if (r.ok) { await api.status(); return { ok: true, message: 'Saved. It is kept encrypted and will not be shown again.' }; }
      return { ok: false, status: r.status, message: detail(r, r.status === 0 ? 'Could not reach this website’s server.' : 'The key was not saved.') };
    },
    /** Remove the key at `level`, so that level uses the next one up. */
    async clear(provider, level = 'account', ref = null) {
      const c = ctx();
      const q = new URLSearchParams(level === 'account' ? {} : { level, ref: ref || c[level] || '' }).toString();
      const r = keep(await call('DELETE', `${KEYS_URL}/${provider}${q ? `?${q}` : ''}`));
      if (r.ok) await api.status();
      return { ok: r.ok, message: r.ok ? '' : detail(r, 'Could not remove it just now.') };
    },
    /** A panel's OLD key (from its own settings, before row 2.57), handed over once. { ok, where }. */
    async adopt(key) {
      const c = ctx();
      if (!c.panel) return { ok: false, where: null };
      const r = await call('POST', `${KEYS_URL}/youtube/adopt`, { key, panel: c.panel, label: label('panel') || '' });
      if (r.ok) { last = r.body; await api.status(); }
      return { ok: r.ok, where: r.ok ? r.body.where : null, message: r.ok ? '' : detail(r, '') };
    },
    /**
     * (row 2.61) The Spotify Client ID in force from here, for the Music panel's Connect - the one value of these
     * rows the server hands back (a Client ID is public by design in PKCE; recommend_search.py argues it). Never the
     * secret. { clientId, level, search, canStore, canChange, signedIn, screenLevels } or null when the server could
     * not be asked.
     */
    async spotifyClientId() {
      const q = new URLSearchParams(ctx()).toString();
      const r = await call('GET', `${KEYS_URL}/spotify/client_id${q ? `?${q}` : ''}`);
      if (!r.ok || !r.body || typeof r.body !== 'object') return null;
      const b = r.body;
      return { clientId: typeof b.client_id === 'string' ? b.client_id : '', level: b.level || null,
        search: b.search === true, canStore: b.can_store !== false, canChange: b.can_change !== false,
        signedIn: b.signed_in === true, screenLevels: Array.isArray(b.screen_levels) ? b.screen_levels : [] };
    },
    /** (row 2.61) A Music panel's OLD Client ID (from its own settings), handed over once. { ok, where }. */
    async adoptSpotify(clientId) {
      const c = ctx();
      if (!c.panel) return { ok: false, where: null };
      const r = await call('POST', `${KEYS_URL}/spotify/adopt`, { client_id: clientId, panel: c.panel, label: label('panel') || '' });
      return { ok: r.ok, where: r.ok ? r.body.where : null, message: r.ok ? '' : detail(r, '') };
    },
    /**
     * Search YouTube through the server, with the nearest key saved for here.
     * { items: [{ id, title, channel }], error: null | 'no-key' | 'key-refused' | 'busy' | 'failed', message }
     */
    async searchYouTube(query) {
      const q = String(query || '').trim();
      if (!q) return { items: [], error: null, message: '' };
      const r = await call('POST', SEARCH_URL, { q, provider: 'youtube', ...ctx() });
      if (r.status === 404) return { items: [], error: 'no-key', message: detail(r, '') };
      if (r.status === 429) return { items: [], error: 'busy', message: detail(r, '') };
      if (!r.ok || !r.body) return { items: [], error: 'failed', message: r.status === 400 ? detail(r, '') : '' };
      const problem = r.body.problems && r.body.problems.youtube;
      const items = (Array.isArray(r.body.results) ? r.body.results : [])
        .filter((h) => h && h.provider === 'youtube' && h.kind === 'video' && h.id)
        .map((h) => ({ id: h.id, title: h.title || '', channel: h.by || '' }));
      if (problem && !items.length) return { items: [], error: 'key-refused', message: problem };
      return { items, error: null, message: '' };
    },
  };
  return api;
}
