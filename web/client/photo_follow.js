// photo_follow.js — PHOTOS IN STEP, the follow page's half: find the screen's picture in MY OWN pictures, and show it.
//
// Mike, 2026-10-12: "we both see and hear the same thing at the same time... the same pictures and videos on a call or
// even just to know I'm looking at the same things when it's not a call." play_sync.js argues the whole shape (the
// opaque id, the per-session salt); this is what the follow page does with an id:
//
//   * THE INDEX: every picture source this page may show (the follower's own registry, the followed person's own
//     sources and the account-wide ones - media_sources.js mayShowSource), listed QUIETLY (quietResolve: a source on
//     another computer is never fetched, so the browser's local-network box can never come up by itself), every folder
//     inside, each picture's path hashed with the session's salt exactly as the screen hashed its own. Built once per
//     salt (once per sharing session); listed again on a miss, at most once a minute (MISS_RELIST_MS).
//   * THE STAGE: a player for play_sync.js createFollower - the picture (or the clip) when it is found, and when it is
//     not, the plain words in the box: "This picture isn't in your pictures here." It keeps following either way; it
//     never shows an empty box.
//   * HIDDEN AND REMOVED PICTURES: a picture hidden or removed on the SCREEN is never sent (photos.js reports only what
//     its slideshow may show, and moves on at once when the picture on screen is hidden). This page's OWN hidden and
//     removed lists also apply: a picture hidden here is not shown here, even when the screen shows it - the words say so.
//
// PURE where it can be: sources, listings, the hidden lists and the clock are injected (dev/photo_follow_test.html).

import { photoPlayId, isPhotoId, isSalt, photoKey } from './play_sync.js';

// The words, in the box and on the status line. Site copy: plain, no names.
export const PHOTO_LINES = Object.freeze({
  looking: 'Looking for this picture in your pictures here…',
  missing: 'This picture isn’t in your pictures here.',
  hidden: 'This picture is hidden on this computer, so it isn’t shown here.',
  none: 'There are no pictures here to show it from. Pictures on another computer aren’t looked at from here.',
  nothing: 'Their screen isn’t showing a picture right now.',
});

// *** LIST AGAIN ON A MISS, AT MOST ONCE A MINUTE. *** A picture the screen shows that this page has not got may simply
// be new (the Drive copy here has not pulled yet), so a miss lists the sources again - but a screen whose pictures are
// mostly not here would otherwise list every source every fifteen seconds. Sixty seconds, argued: a picture copied in
// shows up within a minute of arriving; a source is listed at most once a minute, which is what a Photos panel's own
// recheck costs (media_sources.js SOURCE_RECHECK_MS). Not a setting: nobody can judge it from a menu.
export const MISS_RELIST_MS = 60 * 1000;
// What the slideshow shows (photos.js SLIDESHOW_KINDS): pictures and clips, never a song in the same folder.
const SHOWN_KINDS = new Set(['image', 'video']);

/**
 * THE INDEX: id -> the picture here. `listSources()` -> rows; `resolve(source)` -> a listing (`{ items }`), quietly;
 * `hidden()` -> a Set of picture paths not to show here (hidden or removed on this computer).
 * find(id, salt) -> Promise<{ status: 'found', item } | { status: 'hidden', item } | { status: 'missing' } | { status: 'none' }>
 */
export function createPhotoIndex({
  listSources = async () => [],
  resolve = async () => ({ items: [] }),
  hidden = () => new Set(),
  now = () => Date.now(),
  missRelistMs = MISS_RELIST_MS,
} = {}) {
  let items = null;                   // every picture here, listed: [{ key, item }]
  let listedAt = -Infinity;
  let listing = null;                 // the listing in flight
  let reachable = 0;                  // how many sources answered
  const bySalt = new Map();           // salt -> Map(id -> { key, item }) - only the current session's is kept

  async function listAll() {
    let rows = [];
    try { rows = (await listSources()) || []; } catch { rows = []; }
    const out = [];
    const seen = new Set();
    let ok = 0;
    for (const s of rows) {
      let l = null;
      try { l = await resolve(s); } catch { l = null; }
      if (!l) continue;
      ok += 1;
      for (const it of (Array.isArray(l.items) ? l.items : [])) {
        if (!it || !SHOWN_KINDS.has(it.kind)) continue;
        const key = photoKey(it.path || it.id);
        if (!key || seen.has(key)) continue;          // the same path in two sources: the first source wins
        seen.add(key);
        out.push({ key, raw: String(it.path || it.id || '').trim().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, ''), item: it });
      }
    }
    reachable = ok;
    return out;
  }

  function relist() {
    if (!listing) {
      listing = listAll().then((list) => { items = list; listedAt = now(); bySalt.clear(); return list; })
        .finally(() => { listing = null; });
    }
    return listing;
  }

  function mapFor(salt) {
    let m = bySalt.get(salt);
    if (m) return m;
    m = new Map();
    for (const e of items || []) {
      const id = photoPlayId(salt, e.key);
      if (id) m.set(id, e);
    }
    bySalt.clear();                   // one session at a time: an old salt's ids are never looked at again
    bySalt.set(salt, m);
    return m;
  }

  async function find(id, salt) {
    if (!isPhotoId(id) || !isSalt(salt)) return { status: 'missing' };
    if (items === null) await relist();
    let hit = mapFor(salt).get(id);
    if (!hit && now() - listedAt >= missRelistMs) { await relist(); hit = mapFor(salt).get(id); }
    if (!hit) return { status: reachable ? 'missing' : 'none' };
    let h;
    try { h = hidden(); } catch { h = new Set(); }
    if (h && (h.has(hit.key) || h.has(hit.raw))) return { status: 'hidden', item: hit.item };
    return { status: 'found', item: hit.item };
  }

  return {
    find,
    relist,
    /** How many pictures are listed here (0 before the first listing). */
    size: () => (items ? items.length : 0),
    reachable: () => reachable,
  };
}

const STAGE_CSS = `
.fv-photo{position:relative;width:100%;max-width:640px;aspect-ratio:16/9;background:var(--surface,#0c1a14);border-radius:10px;overflow:hidden;margin:8px 0;display:flex;align-items:center;justify-content:center}
.fv-photo img,.fv-photo video{width:100%;height:100%;object-fit:contain;display:block}
.fv-photo-msg{margin:0;padding:16px;text-align:center;color:var(--text,#F7F4D5);font-weight:600;max-width:46ch}
`;
function ensureStageStyle(doc) {
  if (!doc || doc.getElementById('photo-follow-style')) return;
  const s = doc.createElement('style');
  s.id = 'photo-follow-style';
  s.textContent = STAGE_CSS;
  doc.head.append(s);
}

/**
 * THE STAGE: a player for createFollower that shows pictures. `el` is the box; `index` is createPhotoIndex's.
 * `onHiddenChange(fn)` -> unsubscribe: told when this computer's hidden or removed lists change, so a picture hidden here
 * while it is up goes at once (and one brought back comes back).
 */
export function createPhotoStage(el, { index, onHiddenChange = null, onChange = () => {} } = {}) {
  const doc = el.ownerDocument || document;
  ensureStageStyle(doc);
  el.classList.add('fv-photo');
  let want = null;                    // { id, salt, pos, play }
  let status = 'idle';                // idle | looking | found | missing | hidden | none
  let shownItem = null;
  let media = null;                   // the <img> or <video> on the stage
  let playing = false;
  let seq = 0;
  let destroyed = false;

  function say(text) {
    media = null;
    el.innerHTML = '';
    const p = doc.createElement('p');
    p.className = 'fv-photo-msg';
    p.setAttribute('data-fv-photo-msg', '');
    p.textContent = text;
    el.append(p);
  }
  function showItem(item, pos, play) {
    el.innerHTML = '';
    if (item.kind === 'video') {
      const v = doc.createElement('video');
      v.src = item.url; v.muted = true; v.playsInline = true; v.autoplay = !!play;
      try { if (Number(pos) > 0) v.currentTime = Number(pos); } catch { /* not seekable yet */ }
      v.addEventListener('loadedmetadata', () => { try { if (Number(want?.pos) > 0 && v.currentTime < 0.1) v.currentTime = Number(want.pos); } catch { /* fine */ } }, { once: true });
      if (play) v.play?.()?.catch?.(() => {});
      media = v;
    } else {
      const img = doc.createElement('img');
      img.src = item.url; img.alt = 'Picture';
      media = img;
    }
    media.setAttribute('data-fv-photo-shown', '');
    el.append(media);
  }

  async function look() {
    const my = ++seq;
    const w = want;
    if (!w) return;
    if (w.id === null) { status = 'idle'; shownItem = null; say(PHOTO_LINES.nothing); onChange(); return; }
    let r;
    try { r = await index.find(w.id, w.salt); } catch { r = { status: 'missing' }; }
    if (destroyed || my !== seq) return;
    status = r.status;
    shownItem = r.status === 'found' ? r.item : null;
    if (r.status === 'found') showItem(r.item, w.pos, playing);
    else say(PHOTO_LINES[r.status] || PHOTO_LINES.missing);
    onChange();
  }

  const offHidden = typeof onHiddenChange === 'function' ? onHiddenChange(() => { if (want && want.id) look(); }) : null;

  return {
    load(id, pos = 0, play = true, kind = 'photo', leader = null) {
      if (destroyed) return;
      const salt = leader && typeof leader.salt === 'string' ? leader.salt : (want ? want.salt : null);
      want = { id: id || null, salt, pos: Number(pos) || 0 };
      playing = !!play;
      status = id ? 'looking' : 'idle';
      shownItem = null;
      // Never an empty box: the words while it looks (the last picture is not left up - it is not what they see now).
      say(id ? PHOTO_LINES.looking : PHOTO_LINES.nothing);
      onChange();
      look();
    },
    seek(pos, play) {
      if (media && media.tagName === 'VIDEO') { try { media.currentTime = Math.max(0, Number(pos) || 0); } catch { /* fine */ } }
      if (play === true) this.play(); else if (play === false) this.pause();
    },
    play() { playing = true; if (media && media.tagName === 'VIDEO') media.play?.()?.catch?.(() => {}); },
    pause() { playing = false; if (media && media.tagName === 'VIDEO') { try { media.pause(); } catch { /* fine */ } } },
    item: () => (want ? want.id : null),
    // A still picture has no position (createFollower then never seeks it); a clip has its own.
    currentTime() {
      if (media && media.tagName === 'VIDEO') { const t = Number(media.currentTime); return Number.isFinite(t) ? t : null; }
      return null;
    },
    playing: () => playing,
    status: () => status,
    shown: () => shownItem,
    words: () => (status === 'found' ? '' : status === 'idle' ? (want && want.id === null ? PHOTO_LINES.nothing : '') : (PHOTO_LINES[status] || '')),
    destroy() {
      destroyed = true;
      seq += 1;
      try { offHidden?.(); } catch { /* gone */ }
      try { if (media && media.tagName === 'VIDEO') media.pause(); } catch { /* gone */ }
      media = null;
      el.innerHTML = '';
    },
  };
}
