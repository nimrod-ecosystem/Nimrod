// explore_cams.js — EXPLORE.ORG'S LIVE NATURE CAMS: WHAT THEY ARE, AND HOW A LIST OF THEM IS KEPT. Row 2.69.
//
// The curated list (docs/from_chat/embed_candidates.md, Tier 2) called Explore.org "probably the single best candidate":
// live animal cams, ambient, endless, needing nothing from anybody. This file is the data half; modules/livecams.js is
// the panel.
//
// *** WHAT WAS CHECKED BEFORE BUILDING (2026-10-10). ***
//   * Explore.org's own cam pages play a YouTube frame: the page for Brooks Falls carries
//     `large_feed_html: https://www.youtube.com/embed/J7ZrIDvqlic…` and `video_id: J7ZrIDvqlic`, and every cam read the
//     same way. So the cams ARE YouTube live streams, on Explore's own YouTube channels (explore.org/youtube-channels).
//   * Explore's terms (explore.org/terms-of-service, "Use of Site and Content"): "you may 'embed' or use analogous
//     technology to include our content in your content", and "when enabled", "embed our explore-branded player on your
//     website". Copies are for "personal, non-commercial use only"; notices must be kept. We embed their YouTube player
//     and copy nothing, and the panel names explore.org on every cam.
//   * Explore.org's pages send no Access-Control-Allow-Origin, so this page cannot read them (and has no server to ask:
//     nothing here goes to this site's server). YouTube's oEmbed (youtube.com/oembed) does answer a browser, so a pasted
//     YouTube address is looked up there for its name, and to check it exists.
// SO THE CAMS PLAY THROUGH THE YOUTUBE PLAYER THE SITE ALREADY HAS (youtube.js `createYtPlayer`), not a new one.
//
// *** THE ADDRESSES GO STALE, AND THAT IS HANDLED, NOT HIDDEN. *** A YouTube live stream's address is stable while the
// stream runs; Explore restarts some streams with new addresses. A cam whose address stops working is skipped by the
// panel with a plain line saying so, and the list is the person's to fix (paste the new address). The ids below were
// read from explore.org's own pages and checked against YouTube's oEmbed on 2026-10-10.

import { parseVideoId } from './modules/youtube.js';

export const CAMS_MAX = 30;
export const LOOKUP_TIMEOUT_MS = 8000;

// The cams the panel can offer by name, so a cam can be added with one press and no typing (a switch cannot type).
// `season`: when the animals are there, said beside the name. `slug`: the end of its explore.org address, so a pasted
// explore.org link to one of these is understood.
export const SUGGESTED_CAMS = Object.freeze([
  { id: '0P_LBKqVbfs', name: 'Elephants, South Africa', slug: 'tembe-elephant-park' },
  { id: 'YQN2Z9Y0Qos', name: 'Birds at a feeder, Panama', slug: 'panama-fruit-feeder' },
  { id: 'Qeq2Kax0v64', name: 'Puppies, Maryland', slug: 'service-puppy-cam-full-house' },
  { id: '-m_nQT62B4Y', name: 'Kittens, Los Angeles', slug: 'kitten-rescue-cam' },
  { id: 'YT7lH6U68S4', name: 'Sharks, an aquarium in California', slug: 'shark-lagoon-cam' },
  { id: 'nmjlQlYygB4', name: 'Coral reef, Honduras', slug: 'utopia-village-multi-cams' },
  { id: 'J7ZrIDvqlic', name: 'Brown bears, Alaska', slug: 'brown-bear-salmon-cam-brooks-falls', season: 'summer to early autumn' },
  { id: 'muO2i8ShZrY', name: 'Polar bears, Canada', slug: 'polar-bear-lodge-cam', season: 'October and November' },
  { id: 'a0i1Kg6fROg', name: 'Northern lights', slug: 'northern-lights-cam', season: 'at night' },
  { id: 'JE2CGFclrRg', name: 'Hummingbirds, Panama', slug: 'panama-hummingbird-feeder' },
  { id: 'YaDkA5CkFXk', name: 'Gorillas, Congo', slug: 'gorilla-forest-corridor' },
  { id: '5e4lsEe4Vew', name: 'Wolves, Minnesota', slug: 'wolf-cam-1' },
  { id: 'h8h8tFnpLj4', name: 'Bison, Saskatchewan', slug: 'plains-bison-grasslands-national-park-cam-1' },
  { id: 'GSxpCbXsvtI', name: 'Penguins, an aquarium in California', slug: 'live-penguin-cam-2' },
  { id: 'EqVCjIa5brY', name: 'Puffins, Maine', slug: 'puffin-boulder-berm-cam', season: 'spring and summer' },
  { id: 'dBzbfKXQDjI', name: 'Inside a bee hive, Germany', slug: 'honey-bee-hive-cam' },
]);

// THE STARTING LIST: six that run all year, by day somewhere, with something moving most of the time. A DEFAULT, not
// a rule: the person's own list replaces it the moment they change it (and an emptied list stays empty). The bears are
// offered, not started with: they are there June to October, and a starting list mostly "off right now" teaches nobody
// anything. (Mike's list: which six.)
export const STARTER_IDS = Object.freeze(['0P_LBKqVbfs', 'YQN2Z9Y0Qos', 'Qeq2Kax0v64', '-m_nQT62B4Y', 'YT7lH6U68S4', 'nmjlQlYygB4']);
export const STARTER_CAMS = Object.freeze(STARTER_IDS.map((id) => {
  const s = SUGGESTED_CAMS.find((c) => c.id === id);
  return Object.freeze({ id, name: s.name });
}));

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** The short address kept in the list for a cam: youtu.be/<id>. */
export const camAddress = (id) => `youtu.be/${id}`;
/** A cam's explore.org page, when it is one of ours; else its YouTube page. For the credit line. */
export function camHome(id) {
  const s = SUGGESTED_CAMS.find((c) => c.id === id);
  return s ? 'explore.org' : `youtube.com/watch?v=${id}`;
}

/**
 * What a pasted address or typed id is:
 *   { id }                       a YouTube video (any of its address shapes, with or without https://)
 *   { id, name }                 an explore.org cam address this file knows (its slug)
 *   { explore: true }            an explore.org address this file does not know (its pages cannot be read from here)
 *   null                         neither
 */
export function parseCamRef(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (ID_RE.test(s)) return { id: s };
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`;
  let u = null;
  try { u = new URL(withScheme); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'explore.org' || host.endsWith('.explore.org')) {
    const slug = u.pathname.split('/').filter(Boolean).pop() || '';
    const known = SUGGESTED_CAMS.find((c) => c.slug === slug);
    return known ? { id: known.id, name: known.name } : { explore: true };
  }
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com'
    || host.endsWith('.youtube-nocookie.com')) {
    const live = u.pathname.match(/^\/live\/([A-Za-z0-9_-]{11})/);   // youtube.com/live/<id>, a live stream's share link
    if (live) return { id: live[1] };
    const id = parseVideoId(u.href);
    return id ? { id } : null;
  }
  return null;
}

const cleanName = (s) => String(s ?? '').replace(/[|;\n\r]+/g, ',').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * The list as kept: "Name | youtu.be/<id>; Name | youtu.be/<id>". Entries are split on ";" or a new line, a name from its
 * address on "|". A bare address is fine (its name is then the suggested one, or "Cam 3"). Repeats are kept once; at
 * most CAMS_MAX. Returns an array with `.bad` (entries that were not a YouTube address) and `.over` (left off).
 */
export function parseCamList(text) {
  const out = [];
  out.bad = 0; out.over = 0;
  for (const raw of String(text ?? '').split(/[;\n\r]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const bar = part.lastIndexOf('|');
    const name = bar >= 0 ? cleanName(part.slice(0, bar)) : '';
    const ref = parseCamRef(bar >= 0 ? part.slice(bar + 1) : part);
    if (!ref || !ref.id) { out.bad += 1; continue; }
    if (out.some((c) => c.id === ref.id)) continue;
    if (out.length >= CAMS_MAX) { out.over += 1; continue; }
    const known = SUGGESTED_CAMS.find((c) => c.id === ref.id);
    out.push({ id: ref.id, name: name || ref.name || (known && known.name) || `Cam ${out.length + 1}` });
  }
  return out;
}

/** The text kept for a list of { id, name }. */
export function camListText(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && ID_RE.test(String(c.id || '')))
    .slice(0, CAMS_MAX)
    .map((c) => `${cleanName(c.name) || 'Cam'} | ${camAddress(c.id)}`)
    .join('; ');
}

export const STARTER_TEXT = camListText(STARTER_CAMS);

/** A YouTube title made plain: "LIVE Elephant Cam: Tembe … | explore.org" -> "Elephant Cam: Tembe …". */
export function plainTitle(title) {
  return cleanName(String(title ?? '')
    .replace(/\s*[|–-]\s*explore\.org\s*$/i, '')
    .replace(/\s*powered by explore\.org\s*$/i, '')
    .replace(/^\s*(?:🔴\s*)?live[:!]?\s+/i, '')
    .replace(/\s+\d{4}\s*$/, ''));
}

export const oembedUrl = (id) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;

/**
 * Ask YouTube what a video is called, and whether it exists. One public request carrying only the video's address: no
 * cookies, no referrer, no header of ours. `{ ok, title }`, or `{ ok: false, reason }` where reason is 'cam-not-found'
 * (YouTube has nothing there), 'cam-no-embed' (it may not be shown on other sites), 'cam-unreachable'.
 */
export async function lookupCam(id, { fetchImpl = null, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  if (!ID_RE.test(String(id || ''))) return { ok: false, reason: 'cam-bad-address' };
  const f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!f) return { ok: false, reason: 'cam-unreachable' };
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    const res = await Promise.race([f(oembedUrl(id), { credentials: 'omit', referrerPolicy: 'no-referrer' }), late]);
    if (!res) return { ok: false, reason: 'cam-unreachable' };
    if (res.status === 404 || res.status === 400) return { ok: false, reason: 'cam-not-found' };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'cam-no-embed' };
    if (!res.ok) return { ok: false, reason: 'cam-unreachable' };
    const j = await res.json();
    return { ok: true, title: plainTitle(j && j.title) || '' };
  } catch {
    return { ok: false, reason: 'cam-unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// What the panel says, each a plain sentence. `{name}` is the cam's name.
export const CAM_MESSAGES = Object.freeze({
  'cam-off': '{name} is not on right now. It may be night there, or out of season.',
  'cam-not-found': '{name}: YouTube has no video at that address any more. The cam may have moved, so its address needs changing.',
  // YouTube's player gives the same error (150) for a video that may not be shown on other sites AND for one that is
  // gone (measured 2026-10-10 with an id that does not exist), so the sentence says both.
  'cam-no-embed': '{name} can’t be shown here. YouTube may not allow it on other sites, or the video may be gone.',
  'cam-wont-play': '{name} would not play here.',
  'cam-unreachable': 'YouTube could not be reached. It is tried again in a minute.',
  'cam-bad-address': 'That is not a YouTube address. Paste the address of the cam’s video on YouTube.',
  'cam-explore-page': 'explore.org’s own pages can’t be read from here. Choose the cam from the list below, or open it on '
    + 'explore.org, press the YouTube logo on the video, and paste that address.',
});

export function camWords(key, name = '') {
  return String(CAM_MESSAGES[key] || '').replace('{name}', name || 'This cam');
}
