// recommend.js — RECOMMEND A SONG OR VIDEO TO ONE OF YOUR PEOPLE, and what they see.
//
// Mike, 2026-10-04, about Your people's dimmed "Share a song / video": *"I was picturing more like recommending a
// youtube or spotify song/video."* (DECISIONS.md 2026-10-04, item 7.) A recommendation is a POINTER: YouTube or
// Spotify, a kind (video, playlist, song, album), the provider's id, its title and picture, an optional message,
// and who sent it. The rules and their arguments are in server/recommend.py; this is the page's half:
//
//   parseLink ...         the server's link rule, mirrored so the dialog can say "that is not a link we take"
//                         before anything is sent. THE SERVER IS THE CHECK; this is only quicker words. The suite
//                         holds the two to the same cases.
//   mountRecommend        the window opened from a person's card: search by name (with a key) or paste a link, see
//                         what it is (title and picture, from the server's preview), add a message if you like, Send.
//   recLine, recThumbHTML, recElsewhereHTML, playPlan
//                         what "Recommended for you" on the recipient's Your people draws, and what Play does.
//   mountRecommendedVideo the site's own YouTube player (modules/youtube.js) mounted to play ONE recommendation.
//
// *** SEARCH BY NAME, ON THE ACCOUNT'S OWN KEYS (2026-10-04). *** Mike: "I have a Youtube API and Spotify account."
// Bring your own key, because Mike cannot pay for everybody's searches (CLAUDE.md): a YouTube key and/or a Spotify
// Client ID + secret, pasted once on /search_keys.html (search_keys.js), kept encrypted by the server
// (server/recommend_search.py) and never sent back. WITH a key, a search box sits above the paste box; picking a
// result puts that result's link in the paste box and runs the paste path's own preview, so everything after the
// pick is exactly what pasting that link does. WITHOUT one, the search box is there DIMMED, with one line saying a
// key turns it on and linking to the page - dimmed, never hidden, and the paste box works exactly as before.
// SEARCH RUNS ON A PRESS (Search, or Enter), NEVER PER KEYSTROKE: a YouTube search spends 100 of the key's 10,000
// free daily units, so search-as-you-type would use up somebody's day in an afternoon.
//
// *** SPOTIFY ON A SCREEN: THE ADDRESS AND A CODE, NOT AN EMBED. *** Argued: FOR an embed, one press and it plays,
// and Spotify offers an iframe player. AGAINST, and it decides it: a screen is not signed in to Spotify, and the
// embed then plays a 30-SECOND PREVIEW and stops — somebody is sent a song and hears a third of a chorus; its
// buttons open Spotify's own pages and sign-up in a new window, on a screen nobody may be able to close one on
// (CLAUDE.md's invariant, page_links.js's argument). So a screen shows "open it in Spotify on your phone or
// computer" with the address and a code to scan (page_links.js's pattern), and nothing opens there. Off a screen,
// "Open in Spotify" opens it in a new tab — which on a phone hands it to the Spotify app.
//
// *** YOUTUBE PLAYS IN THE SITE'S OWN PLAYER, FROM ONE PRESS, EVERYWHERE. *** `mountRecommendedVideo` mounts
// modules/youtube.js over the page with its own private bus and asks it for this one video (`youtube/load`, the
// same message the music favourites use): the same nocookie player, watchdog and speaker arbiter as every YouTube
// panel. ON A SCREEN it goes back to the people by itself when the video ends, or when nothing has played for the
// page's "close after" (a paused video nobody is pressing), never mid-song: the player's own `segment/progress`
// beat keeps it open while it plays.

import { authHeaders } from './auth.js';
import { mountModule, getManifest, extendCtx } from './module.js';
import { createBus } from './bus.js';
import { qrSVG } from './qr.js';

export const REC_ACT = 'recommend';
export const MAX_MESSAGE = 280;            // = server recommend.MAX_MESSAGE = the note's own limit (one limit to learn)
export const PREVIEW_URL = '/api/recommend/preview';
export const recommendationsURL = (personId) => `/api/people/${encodeURIComponent(personId)}/recommendations`;
export const markURL = (personId, id, mark) => `${recommendationsURL(personId)}/${encodeURIComponent(id)}/${encodeURIComponent(mark)}`;
// How long the dialog waits after the last keystroke before asking what a link is. ARGUED, not a setting: a paste
// arrives in one event, so this only matters to somebody typing a link out, and asking per keystroke would spend
// the server's preview limit on half-typed addresses. 400 ms is under the time it takes to look up from the keys.
export const PREVIEW_DEBOUNCE_MS = 400;
// Search by name (server/recommend_search.py). The keys' page is its own page, like /claude.html.
export const SEARCH_KEYS_URL = '/api/recommend/keys';
export const SEARCH_URL = '/api/recommend/search';
export const SEARCH_KEYS_PAGE = '/search_keys.html';
export const SEARCH_MIN = 2;               // = server recommend_search.MIN_QUERY

const PROVIDER_NAME = Object.freeze({ youtube: 'YouTube', spotify: 'Spotify' });
const KIND_WORD = Object.freeze({ video: 'video', playlist: 'playlist', song: 'song', album: 'album' });

// ---------------------------------------------------------------------------------------------------------------
// THE LINK RULE (server/recommend.py parse_link, mirrored)
// ---------------------------------------------------------------------------------------------------------------
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{8,62}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_KIND = Object.freeze({ track: 'song', album: 'album', playlist: 'playlist' });
const SPOTIFY_PATH = Object.freeze({ song: 'track', album: 'album', playlist: 'playlist' });
export const THUMB_HOSTS = Object.freeze(['ytimg.com', 'scdn.co', 'spotifycdn.com']);

function urlOf(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 2000 || /\s/.test(s)) return null;
  if (!s.includes('://')) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // No user name, password or port: `youtube.com@evil.example` is evil.example. (URL() would parse it as such;
  // refusing outright is the server's rule and says so plainly.)
  const authority = s.split('://')[1].split(/[/?#]/)[0];
  if (u.username || u.password || u.port || authority.includes('@')) return null;
  return u;
}

/** A pasted link -> { provider, kind, id } or null. PURE. The same answers as the server's parse_link. */
export function parseLink(raw) {
  const u = urlOf(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const path = u.pathname || '/';
  if (host === 'youtu.be') {
    const id = path.replace(/^\/+/, '').split('/')[0];
    return VIDEO_ID.test(id) ? { provider: 'youtube', kind: 'video', id } : null;
  }
  if (YT_HOSTS.has(host)) {
    const v = u.searchParams.get('v') || '';
    const bare = path.replace(/\/+$/, '');
    if (bare === '/watch' && VIDEO_ID.test(v)) return { provider: 'youtube', kind: 'video', id: v };
    const m = path.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})\/?$/);
    if (m) return { provider: 'youtube', kind: 'video', id: m[1] };
    const list = u.searchParams.get('list') || '';
    if ((bare === '/playlist' || bare === '/watch') && PLAYLIST_ID.test(list)) return { provider: 'youtube', kind: 'playlist', id: list };
    return null;
  }
  if (host === 'open.spotify.com') {
    const sp = spotifyRef(u.href);
    return sp && SPOTIFY_KIND[sp.type] ? { provider: 'spotify', kind: SPOTIFY_KIND[sp.type], id: sp.id } : null;
  }
  return null;
}

// Every kind of thing a Spotify address can name. A recommendation takes three of them (SPOTIFY_KIND); a music
// favourite takes all six.
export const SPOTIFY_TYPES = Object.freeze(['track', 'album', 'playlist', 'artist', 'episode', 'show']);

/**
 * THE ONE SPOTIFY-LINK READER (row 2.55, 2026-10-07): parseLink above and music_favourites.js both use it, so
 * a link one accepts the other accepts too. Any Spotify address or URI -> { type, id }, or null. PURE.
 * Takes `spotify:<type>:<id>` and open.spotify.com/(intl-xx/)(embed/)<type>/<id>, with or without https:// and
 * whatever follows the `?` (Share adds `?si=`). The `embed/` form is what Spotify's "Embed playlist" gives.
 */
export function spotifyRef(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const m = s.match(/^spotify:([a-z]+):([A-Za-z0-9]+)$/);
  if (m) return SPOTIFY_TYPES.includes(m[1]) && SPOTIFY_ID.test(m[2]) ? { type: m[1], id: m[2] } : null;
  const u = urlOf(s);
  if (!u || u.hostname.toLowerCase().replace(/\.$/, '') !== 'open.spotify.com') return null;
  let segs = u.pathname.split('/').filter(Boolean);
  if (segs.length && /^intl-[a-z]{2}(-[a-z]{2})?$/i.test(segs[0])) segs = segs.slice(1);
  if (segs[0] === 'embed') segs = segs.slice(1);
  return segs.length === 2 && SPOTIFY_TYPES.includes(segs[0]) && SPOTIFY_ID.test(segs[1])
    ? { type: segs[0], id: segs[1] } : null;
}

/** Is { provider, kind, id } a shape this rule produces? PURE. A row read back is checked again, not trusted. */
export function validRef(r) {
  if (!r) return false;
  const id = String(r.item_id ?? r.id ?? '');
  if (r.provider === 'youtube') return r.kind === 'video' ? VIDEO_ID.test(id) : r.kind === 'playlist' && PLAYLIST_ID.test(id);
  if (r.provider === 'spotify') return !!SPOTIFY_PATH[r.kind] && SPOTIFY_ID.test(id);
  return false;
}

/** The address, rebuilt from provider + kind + id (never a stored or pasted address). '' if not a valid ref. */
export function canonicalURL(r) {
  if (!validRef(r)) return '';
  const id = String(r.item_id ?? r.id);
  if (r.provider === 'youtube') return r.kind === 'video' ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/playlist?list=${id}`;
  return `https://open.spotify.com/${SPOTIFY_PATH[r.kind]}/${id}`;
}

/** https, on YouTube's or Spotify's own image hosts. PURE. */
export function thumbOk(url) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
  const u = urlOf(url);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return THUMB_HOSTS.some((t) => h === t || h.endsWith(`.${t}`));
}

/** "a song on Spotify", "a YouTube video", "a YouTube playlist". PURE. */
export function kindWords(r) {
  const k = KIND_WORD[r?.kind] || 'thing';
  const p = PROVIDER_NAME[r?.provider] || '';
  return r?.provider === 'spotify' ? `${/^[aeiou]/.test(k) ? 'an' : 'a'} ${k} on ${p}` : `a ${p} ${k}`;
}
/** The title, or what it is when the provider gave none. PURE. */
export const titleOf = (r) => String(r?.title || '').trim() || kindWords(r);

/** "<name> recommends: <title>". PURE. */
export function recLine(r) {
  return `${String(r?.from_name || '').trim() || 'Someone'} recommends: ${titleOf(r)}`;
}

/**
 * What Play does for one recommendation. PURE.
 *   youtube                   -> { how: 'youtube', videoId | playlistId, label: 'Play' }
 *   spotify, off a screen     -> { how: 'tab', url, label: 'Open in Spotify' }
 *   spotify, on a screen      -> { how: 'elsewhere', url }   (no button: the address and a code are shown)
 */
export function playPlan(r, { isScreen = false } = {}) {
  if (!validRef(r)) return { how: 'none' };
  const id = String(r.item_id ?? r.id);
  if (r.provider === 'youtube') return { how: 'youtube', label: 'Play', ...(r.kind === 'video' ? { videoId: id } : { playlistId: id }) };
  return isScreen ? { how: 'elsewhere', url: canonicalURL(r) } : { how: 'tab', url: canonicalURL(r), label: 'Open in Spotify' };
}

// The words the dialog and the section can put on the page (the suite holds them to people_page.js's plain-word rule).
export const REC_WORDS = Object.freeze({
  title: (name) => `Recommend a song or video to ${name || 'them'}`,
  intro: (name) => `Paste a link from YouTube or Spotify. It shows on ${name || 'their'}${name ? '’s' : ''} page with your name, and they can play it from there.`,
  howTo: 'To get a link: in YouTube or Spotify, press Share, then Copy link, and paste it here.',
  searchLabel: 'Search by name',
  searchPlaceholder: 'A song, a singer, a video…',
  searchGo: 'Search',
  searchWhere: 'Search',
  searchBoth: 'Both',
  searching: 'Searching…',
  searchShort: `Type at least ${SEARCH_MIN} letters, then press Search.`,
  searchNone: 'Nothing found. Try other words, or paste a link below.',
  searchFailed: 'Could not search just now. You can still paste a link below.',
  searchPicked: (title) => `Picked “${title}”. Add a message if you like, then Send.`,
  noKeys: 'Add a YouTube or Spotify key to search by name.',
  noKeysLink: 'Add a key',
  linkLabel: 'Link',
  linkLabelOr: 'Or paste a link',
  messageLabel: 'A message (optional)',
  send: 'Send',
  notALink: 'That is not a YouTube or Spotify link. Paste a link from youtube.com, youtu.be or open.spotify.com.',
  looking: 'Looking it up…',
  sending: 'Sending…',
  sent: (name, title) => `Sent. ${name || 'They'} will see “${title}” on their page.`,
  refused: (name) => `You can’t send ${name || 'them'} recommendations yet. Whoever looks after their screen can allow it.`,
  failed: 'Could not send that just now. Try again in a little while.',
  heading: 'Recommended for you',
  none: 'Nothing yet. When someone recommends you a song or video, it shows here.',
  isNew: 'New',
  remove: 'Remove',
  removeWhy: 'Takes it off your page.',
  spotifyScreen: 'Open it in Spotify on your phone or computer:',
});

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The picture, if it is from the provider's own image host; '' otherwise. No referrer is sent with it. */
export function recThumbHTML(r, { size = '4.5rem' } = {}) {
  if (!thumbOk(r?.thumb)) return '';
  return `<img class="rc-thumb" data-rc-thumb src="${esc(r.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"
    style="width:calc(${size} * 16 / 9);height:${size};object-fit:cover;border-radius:10px;flex:0 0 auto">`;
}

/** On a screen, for Spotify: the address in words and a code to scan. Nothing opens. */
export function recElsewhereHTML(r, { colours = null } = {}) {
  const url = canonicalURL(r);
  if (!url) return '';
  let qr = '';
  if (colours) {
    try { qr = qrSVG(url, { level: 'M', quiet: 4, dark: colours.dark, light: colours.light, title: `Scan to open ${url.replace(/^https:\/\//, '')}` }); }
    catch (err) { console.error('recommend: qr', err); qr = ''; }
  }
  return `<div class="rc-elsewhere" data-rc-elsewhere="${esc(url)}"><p class="pp-note">${esc(REC_WORDS.spotifyScreen)}
    <b data-rc-address>${esc(url.replace(/^https:\/\//, ''))}</b></p>${qr ? `<div data-rc-qr style="width:min(150px,45%)">${qr}</div>` : ''}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// THE DIALOG
// ---------------------------------------------------------------------------------------------------------------
// Every colour a theme token; every target at least 48px tall.
const STYLE = `
.rc{display:flex;flex-direction:column;gap:10px;max-width:40rem;color:var(--text)}
.rc label{display:flex;flex-direction:column;gap:4px;font-weight:600;color:var(--text-strong)}
.rc input,.rc textarea{box-sizing:border-box;width:100%;min-height:48px;padding:10px 12px;border-radius:12px;border:2px solid var(--border);
  background:var(--surface);color:var(--text);font:inherit;font-weight:400}
.rc-preview{display:flex;gap:12px;align-items:center;min-height:0}
.rc-preview:empty{display:none}
.rc-preview b{color:var(--text-strong)}
.rc-send{box-sizing:border-box;min-height:48px;padding:10px 18px;border-radius:12px;border:2px solid var(--accent);background:var(--surface);
  color:var(--text-strong);font:inherit;font-weight:700;cursor:pointer;align-self:flex-start}
.rc-send[aria-disabled="true"]{opacity:.55;cursor:default;border-color:var(--border)}
.rc-msg{margin:0;min-height:1.4em}
.rc-hint{margin:0;color:var(--text-muted)}
.rc-search{display:flex;flex-direction:column;gap:8px}
.rc-search:empty{display:none}
.rc-srow{display:flex;gap:8px;align-items:stretch}
.rc-srow input{flex:1 1 auto;min-width:0}
.rc-go{box-sizing:border-box;min-height:48px;padding:10px 16px;border-radius:12px;border:2px solid var(--accent);background:var(--surface);
  color:var(--text-strong);font:inherit;font-weight:700;cursor:pointer;flex:0 0 auto}
.rc-go[aria-disabled="true"]{opacity:.55;cursor:default;border-color:var(--border)}
.rc-where{display:flex;flex-wrap:wrap;gap:8px;border:0;margin:0;padding:0}
.rc-where legend{padding:0;margin-bottom:4px;font-weight:600;color:var(--text-strong)}
.rc-where label{flex-direction:row;align-items:center;gap:6px;min-height:48px;padding:0 12px;border-radius:12px;border:2px solid var(--border);
  font-weight:400;color:var(--text);cursor:pointer}
.rc-where input{width:auto;min-height:0;margin:0}
.rc-off{opacity:.55}
.rc-off a{color:var(--link)}
.rc-hits{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.rc-hits:empty{display:none}
.rc-pick{box-sizing:border-box;display:flex;gap:12px;align-items:center;width:100%;min-height:64px;padding:8px 10px;border-radius:12px;
  border:2px solid var(--border);background:var(--surface);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.rc-pick[aria-pressed="true"]{border-color:var(--accent)}
.rc-pick b{color:var(--text-strong);overflow-wrap:anywhere}
.rc-pick small{color:var(--text-muted)}
.rc-go:focus-visible,.rc-pick:focus-visible,.rc-send:focus-visible,.rc input:focus-visible,.rc textarea:focus-visible{outline:3px solid var(--focus, var(--accent));outline-offset:2px}
`;

/**
 * The window opened from a person's card.
 *   personId, personName   who it is for
 *   fromPersonId           the sender's own person (their name signs it, if they gave one; the server checks it)
 *   user                   the dev-user header off a real sign-in (authHeaders)
 *   fetchImpl, debounceMs  a test hands in its own
 */
export function mountRecommend(root, {
  personId = '', personName = '', fromPersonId = '', user = null,
  fetchImpl = (...a) => fetch(...a), debounceMs = PREVIEW_DEBOUNCE_MS, onSent = null,
} = {}) {
  if (!root) throw new Error('mountRecommend: a root element is required');
  let torn = false;
  let status = 'idle';          // 'idle' | 'looking' | 'ready' | 'bad' | 'sending' | 'sent' | 'refused' | 'error'
  let preview = null;           // the server's preview, or the parsed ref when it could not say
  let timer = null;
  let seq = 0;
  const who = personName || '';

  // Search by name: 'loading' until the server says which keys are saved, then 'off' (no key: dimmed, with the
  // line) or 'idle' | 'searching' | 'done' | 'error'.
  let sstate = 'loading';
  let keys = null;              // { youtube: {set}, spotify: {set} } from the server; never a key
  let hits = [];
  let picked = -1;
  let sseq = 0;

  root.innerHTML = `<style>${STYLE}</style><div class="rc" data-rc>
    <h2 class="pp-h">${esc(REC_WORDS.title(who))}</h2>
    <p class="rc-hint">${esc(REC_WORDS.intro(who))}</p>
    <div class="rc-search" data-rc-search></div>
    <label><span data-rc-link-label>${esc(REC_WORDS.linkLabel)}</span><input type="url" inputmode="url" autocomplete="off" data-rc-link
      placeholder="https://youtu.be/…  or  https://open.spotify.com/track/…" aria-describedby="rc-how"></label>
    <p class="rc-hint" id="rc-how" data-rc-how>${esc(REC_WORDS.howTo)}</p>
    <div class="rc-preview" data-rc-preview role="status"></div>
    <label>${esc(REC_WORDS.messageLabel)}<textarea data-rc-message rows="3" maxlength="${MAX_MESSAGE}"></textarea></label>
    <button type="button" class="rc-send" data-rc-send aria-disabled="true">${esc(REC_WORDS.send)}</button>
    <p class="rc-msg" data-rc-msg role="status"></p>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const say = (t) => { const m = $('[data-rc-msg]'); if (m) m.textContent = t || ''; };

  function paint() {
    if (torn) return;
    const box = $('[data-rc-preview]');
    if (preview && (status === 'ready' || status === 'sending')) {
      box.innerHTML = `${recThumbHTML(preview, { size: '3.5rem' })}<div><b data-rc-title>${esc(titleOf(preview))}</b>
        <br><small class="rc-hint">${esc(kindWords(preview))}</small></div>`;
    } else box.innerHTML = '';
    $('[data-rc-send]').setAttribute('aria-disabled', status === 'ready' ? 'false' : 'true');
  }

  async function post(url, body) {
    const r = await fetchImpl(url, { method: 'POST', credentials: 'same-origin',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return { status: r.status, body: j };
  }

  // ------------------------------------------------------------------ search by name
  const haveYT = () => !!keys?.youtube?.set;
  const haveSP = () => !!keys?.spotify?.set;
  const sayS = (t) => { const m = $('[data-rc-smsg]'); if (m) m.textContent = t || ''; };

  function hitHTML(h, i) {
    const what = h.provider === 'youtube' ? 'YouTube video' : 'Spotify song';
    const by = String(h.by || '').trim();
    return `<li><button type="button" class="rc-pick" data-rc-pick="${i}" aria-pressed="${i === picked ? 'true' : 'false'}">
      ${recThumbHTML({ thumb: h.thumbnail }, { size: '3rem' })}<span><b data-rc-hit-title>${esc(h.title || kindWords(h))}</b><br>
      <small>${by ? `${esc(by)} · ` : ''}${esc(what)}</small></span></button></li>`;
  }

  function paintSearch() {
    if (torn) return;
    const box = $('[data-rc-search]');
    if (!box || sstate === 'loading') return;
    const lbl = $('[data-rc-link-label]');
    if (sstate === 'off') {
      // DIMMED, NEVER HIDDEN: the box is there, it says why it does not work, and where the key goes.
      box.innerHTML = `<div class="rc-off" data-rc-search-off>
        <label>${esc(REC_WORDS.searchLabel)}<input type="search" disabled placeholder="${esc(REC_WORDS.searchPlaceholder)}" aria-describedby="rc-nokeys"></label></div>
        <p class="rc-hint" id="rc-nokeys" data-rc-nokeys>${esc(REC_WORDS.noKeys)}
        <a href="${SEARCH_KEYS_PAGE}" target="_blank" rel="noopener" data-rc-keys-link>${esc(REC_WORDS.noKeysLink)}</a></p>`;
      if (lbl) lbl.textContent = REC_WORDS.linkLabel;
      return;
    }
    if (lbl) lbl.textContent = REC_WORDS.linkLabelOr;
    if (!box.querySelector('[data-rc-q]')) {
      const both = haveYT() && haveSP();
      box.innerHTML = `<label for="rc-q">${esc(REC_WORDS.searchLabel)}</label>
        <div class="rc-srow"><input id="rc-q" type="search" enterkeyhint="search" autocomplete="off" data-rc-q
          placeholder="${esc(REC_WORDS.searchPlaceholder)}" maxlength="100">
          <button type="button" class="rc-go" data-rc-go>${esc(REC_WORDS.searchGo)}</button></div>
        ${both ? `<fieldset class="rc-where" data-rc-where><legend>${esc(REC_WORDS.searchWhere)}</legend>
          ${[['both', REC_WORDS.searchBoth], ['youtube', 'YouTube'], ['spotify', 'Spotify']].map(([v, t]) =>
            `<label><input type="radio" name="rc-where" value="${v}" ${v === 'both' ? 'checked' : ''}>${esc(t)}</label>`).join('')}</fieldset>` : ''}
        <p class="rc-msg" data-rc-smsg role="status"></p>
        <ul class="rc-hits" data-rc-hits></ul>`;
    }
    $('[data-rc-go]').setAttribute('aria-disabled', sstate === 'searching' ? 'true' : 'false');
    $('[data-rc-hits]').innerHTML = hits.map(hitHTML).join('');
  }

  async function loadKeys() {
    try {
      const r = await fetchImpl(SEARCH_KEYS_URL, { credentials: 'same-origin', headers: { ...authHeaders(user) } });
      const j = r.status === 200 ? await r.json().catch(() => null) : null;
      if (torn) return;
      keys = j && typeof j === 'object' ? j : null;
    } catch { keys = null; }
    if (torn) return;
    sstate = haveYT() || haveSP() ? 'idle' : 'off';
    paintSearch();
  }

  async function search(q, provider) {
    if (sstate === 'off' || sstate === 'loading' || sstate === 'searching') return [];
    const query = String(q ?? $('[data-rc-q]')?.value ?? '').trim();
    if (query.length < SEARCH_MIN) { sayS(REC_WORDS.searchShort); return []; }
    const where = provider || root.querySelector('input[name="rc-where"]:checked')?.value || 'both';
    const my = ++sseq;
    sstate = 'searching'; hits = []; picked = -1; sayS(REC_WORDS.searching); paintSearch();
    try {
      const r = await post(SEARCH_URL, { q: query, provider: where });
      if (torn || my !== sseq) return [];
      if (r.status === 200 && r.body) {
        // Each row is checked again here: only a shape the paste rule accepts is ever drawn or picked.
        hits = (Array.isArray(r.body.results) ? r.body.results : []).filter((h) => h && validRef(h) && parseLink(h.link));
        const problems = Object.values(r.body.problems || {}).filter((s) => typeof s === 'string' && s);
        sstate = 'done';
        sayS([hits.length ? '' : REC_WORDS.searchNone, ...problems].filter(Boolean).join(' '));
      } else {
        sstate = 'error';
        sayS((r.status === 400 || r.status === 404 || r.status === 429) && r.body?.detail ? r.body.detail : REC_WORDS.searchFailed);
      }
    } catch { if (!torn && my === sseq) { sstate = 'error'; sayS(REC_WORDS.searchFailed); } }
    paintSearch();
    return hits.map((h) => ({ ...h }));
  }

  async function pick(i) {
    const h = hits[i];
    if (!h) return;
    picked = i;
    paintSearch();
    $('[data-rc-link]').value = h.link;
    clearTimeout(timer); timer = null;
    await look();
    if (!torn && status === 'ready') say(REC_WORDS.searchPicked(titleOf(preview && preview.title ? preview : h)));
  }

  async function look() {
    const raw = $('[data-rc-link]').value;
    const my = ++seq;
    if (!String(raw).trim()) { status = 'idle'; preview = null; say(''); paint(); return; }
    const ref = parseLink(raw);
    if (!ref) { status = 'bad'; preview = null; say(REC_WORDS.notALink); paint(); return; }
    status = 'looking'; preview = { provider: ref.provider, kind: ref.kind, id: ref.id }; say(REC_WORDS.looking); paint();
    try {
      const r = await post(PREVIEW_URL, { link: raw });
      if (torn || my !== seq) return;
      if (r.status === 200 && r.body) { preview = r.body; status = 'ready'; say(''); }
      else if (r.status === 400) { preview = null; status = 'bad'; say((r.body && r.body.detail) || REC_WORDS.notALink); }
      // Any other answer (offline, a busy minute): it is a good link; Send still works, untitled until the server asks.
      else { status = 'ready'; say(''); }
    } catch { if (!torn && my === seq) { status = 'ready'; say(''); } }
    paint();
  }

  async function send() {
    if (status !== 'ready') return null;
    status = 'sending'; say(REC_WORDS.sending); paint();
    const link = $('[data-rc-link]').value;
    const message = $('[data-rc-message]').value;
    try {
      const r = await post(recommendationsURL(personId), { link, message, from_person: fromPersonId || null });
      if (torn) return null;
      if (r.status === 200 && r.body) {
        status = 'sent'; preview = null;
        $('[data-rc-link]').value = ''; $('[data-rc-message]').value = '';
        say(REC_WORDS.sent(who, titleOf(r.body)));
        try { onSent?.(r.body); } catch (err) { console.error('recommend: onSent', err); }
        paint();
        return r.body;
      }
      status = r.status === 403 || r.status === 404 ? 'refused' : r.status === 400 ? 'bad' : 'error';
      say(status === 'refused' ? REC_WORDS.refused(who) : status === 'bad' ? ((r.body && r.body.detail) || REC_WORDS.notALink)
        : (r.status === 429 && r.body?.detail) || REC_WORDS.failed);
    } catch { status = 'error'; say(REC_WORDS.failed); }
    // A refusal for the LINK leaves the link there to fix; anything else, the same link can be sent again.
    if (status === 'error') status = 'ready';
    paint();
    return null;
  }

  const ac = new AbortController();
  root.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-rc-link]')) return;
    if (picked >= 0) { picked = -1; paintSearch(); }   // typed over a picked result: it is not that one any more
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; look(); }, Math.max(0, debounceMs));
  }, { signal: ac.signal });
  root.addEventListener('click', (e) => {
    const go = e.target.closest?.('[data-rc-go]');
    if (go) { e.preventDefault(); if (go.getAttribute('aria-disabled') !== 'true') search(); return; }
    const hit = e.target.closest?.('[data-rc-pick]');
    if (hit) { e.preventDefault(); pick(Number(hit.dataset.rcPick)); return; }
    const b = e.target.closest?.('[data-rc-send]');
    if (!b) return;
    e.preventDefault();
    if (b.getAttribute('aria-disabled') === 'true') {
      if (status === 'idle') say(REC_WORDS.howTo);
      return;
    }
    send();
  }, { signal: ac.signal });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('[data-rc-link]')) { e.preventDefault(); clearTimeout(timer); timer = null; look(); }
    if (e.key === 'Enter' && e.target.matches?.('[data-rc-q]')) { e.preventDefault(); search(); }
  }, { signal: ac.signal });
  paint();
  try { $('[data-rc-link]').focus({ preventScroll: true }); } catch { /* not focusable */ }
  const ready = loadKeys().then(() => {
    // The search box takes the focus when it appears, unless somebody has already started in the link box.
    const link = $('[data-rc-link]');
    const q = $('[data-rc-q]');
    if (!torn && q && link && !link.value && document.activeElement === link) { try { q.focus({ preventScroll: true }); } catch { /* not focusable */ } }
  });

  return {
    /** Resolves once the window knows whether search is on (which keys are saved). */
    ready,
    status: () => status,
    preview: () => (preview ? { ...preview } : null),
    /** Paste-and-look, for a test or a caller with the link already in hand. */
    async setLink(v) { $('[data-rc-link]').value = v; clearTimeout(timer); timer = null; await look(); },
    /** Search by name: 'off' (no key) | 'loading' | 'idle' | 'searching' | 'done' | 'error'. */
    searchState: () => sstate,
    search,
    results: () => hits.map((h) => ({ ...h })),
    pick,
    send,
    destroy() { torn = true; clearTimeout(timer); ac.abort(); root.innerHTML = ''; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// PLAYING A YOUTUBE RECOMMENDATION, IN THE SITE'S OWN PLAYER
// ---------------------------------------------------------------------------------------------------------------
function memState(initial = {}) {
  let v = { ...initial };
  const subs = new Set();
  return { get: () => v, set(p) { v = { ...v, ...p }; subs.forEach((f) => { try { f(v); } catch { /* gone */ } }); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); }, load: async () => v, flush: async () => {}, destroy() { subs.clear(); } };
}
// A recommendation played once is not this person's play history: the player's log goes nowhere.
function noEvents() {
  return { append: async () => ({}), subscribe: () => () => {}, load: async () => {}, get: () => ({ events: [] }), flush: async () => {}, destroy() {} };
}

/**
 * Mount modules/youtube.js in `host` and play one recommendation in it.
 *   baseCtx   the hosting page's ctx (its speaker arbiter, its person, a test's playerFactory come through)
 *   onBeat    the player says it is still playing (segment/progress)
 *   onDone    the video ended, would not load, or stopped for good (segment/done { reason })
 * -> { instance, bus, destroy() }
 */
export async function mountRecommendedVideo(host, { rec, baseCtx = {}, instanceId = 'rec-video', onBeat = null, onDone = null } = {}) {
  const plan = playPlan(rec);
  if (plan.how !== 'youtube') throw new Error('mountRecommendedVideo: not a YouTube recommendation');
  if (!getManifest('youtube')) await import('./modules/youtube.js');
  // ITS OWN BUS: what this player says (ended, progress) is about this video only, never another YouTube panel's,
  // and nothing else on the screen can drive it by accident.
  const bus = createBus();
  const offs = [
    bus.subscribe('segment/progress', () => { try { onBeat?.(); } catch (err) { console.error('recommend: beat', err); } }),
    bus.subscribe('segment/done', (p) => { try { onDone?.(p || {}); } catch (err) { console.error('recommend: done', err); } }),
  ];
  const instance = mountModule('youtube', extendCtx(baseCtx, {
    mount: host, bus, instanceId, events: noEvents(),
    // One video, played once: no shuffle, nothing after it.
    state: memState({ playlist: [], playlistId: '', schedule: [], shuffle: false, autoAdvance: false }),
  }));
  await instance.init();
  bus.publish('youtube/load', plan.videoId ? { videoId: plan.videoId } : { playlistId: plan.playlistId });
  return {
    instance, bus,
    destroy() { for (const off of offs.splice(0)) { try { off?.(); } catch { /* gone */ } } try { instance.destroy(); } catch (err) { console.error('recommend: video', err); } },
  };
}
