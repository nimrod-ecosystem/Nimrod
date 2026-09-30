// avatar_display.js — SHOWING A PERSON'S AVATAR where their name is shown: one cache per page, one
// small face per name.
//
// Row 2.37 item 5 (private repo, docs/for_chat/MIKE_CHANGE_LIST.md). The maker (`modules/avatar.js`)
// keeps the avatar on the PERSON (`makePersonState(personId, 'avatar')`); until this file nothing drew
// it anywhere else. This is the one place that reads it for display, so every surface that names a
// person (the people bar first) asks the same question the same way.
//
// THE THREE RULES THIS FILE EXISTS TO KEEP:
//
//   1. NO AVATAR = EXACTLY TODAY. A person with `use: 'none'`, or no row at all, or a row that has not
//      arrived yet, gets the empty string from `avatarHtml` — not an empty frame, not a placeholder
//      initial. A surface that adds a face therefore renders byte-for-byte what it did before for
//      everybody who has not made one (`people_test.html` holds the pre-avatar markup to prove it).
//
//   2. ONE READ PER PERSON, NOT PER CHIP PER RENDER. The cache opens ONE state handle per person the
//      first time anybody asks, and every later `get` is a lookup in memory. It refreshes on a change,
//      not on a render: a save from the maker on this page (the `AVATAR_CHANGED_EVENT` it sends —
//      no request at all), the page coming back into view (one read per person), and, only if a host
//      asks for it (`poll: true`), the state handle's own polling.
//
//   3. A PICTURE NEVER SHOWS BROKEN. A `picture` avatar resolves through the person's own Media
//      sources exactly as the maker's preview does (`resolveItemUrl`), ONCE per picture, and the URL is
//      reused by every chip. Until it resolves the face is simply absent (rule 1's display); if the
//      folder is not connected on this device, the file will not resolve, or the image fails to decode
//      (`bindErrors`), it falls back to the drawn avatar when there is one, else to no avatar.

import { readAvatar, renderAvatar, AVATAR_KEY } from './avatar.js';
import { createMediaSourcesClient, resolveItemUrl } from './media_sources.js';

// The maker announces a save on the page with this, so a display on the same page redraws without a
// request. `detail: { personId, row }`.
export const AVATAR_CHANGED_EVENT = 'nimrod:avatar-changed';

// *** DEFAULTS, EACH ARGUED; EACH A PARAMETER OF `avatarHtml`, NOT A LITERAL IN A CALLER. ***
//
//   size '1.6em'  In `em`, so the face scales with the words beside it (a chip, a menu row, a sentence)
//                 and a larger text setting enlarges it too. 1.6 of the text's size is a little taller
//                 than a line of text: big enough that a face reads as a face, small enough that a chip
//                 grows by a few pixels, not a row. [Guess, on Mike's list.]
//   animate false AT SMALL SIZES. The maker's "Gentle movement" is for the avatar you look AT. In a row of
//                 chips it is peripheral motion: several faces blinking out of step beside a list is
//                 the kind of movement that pulls the eye away from the thing being read, and at 1.6em
//                 a blink is two pixels of lid, too small to be the "animated person" that was asked
//                 for. AGAINST: "animated avatars" was the ask, and a still chip is less alive. So a
//                 caller showing a BIG face (a call tile, the room's window) passes `animate: true`,
//                 and reduced motion and a person's own `animate: false` still win over it.
//   round true    A circle is how a person's picture is shown in a list almost everywhere, so it reads
//                 as "this is who" rather than as a thumbnail of content. The drawn avatar is made
//                 inside a square with its shoulders at the bottom, which a circle crops only at the
//                 corners. `round: false` gives the square.
export const DISPLAY_DEFAULTS = Object.freeze({ size: '1.6em', animate: false, round: true });

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A CSS length, and nothing else: whatever is passed goes into a style attribute.
const SIZE_RE = /^\d{1,3}(\.\d{1,3})?(px|em|rem)$/;
const cssSize = (s) => (typeof s === 'string' && SIZE_RE.test(s) ? s : DISPLAY_DEFAULTS.size);

function systemReduced(win) {
  try { return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}

/**
 * The avatar to show for a person, from the row kept on them and the state of its picture.
 *   { show: 'none' | 'drawn' | 'picture', drawn, url, still, fallback }
 * `still` is the person's own `animate: false` on the row, when there is one: nothing moves it then.
 * PURE — the cache calls it; a test can too.
 */
export function avatarView(row, { picture = null } = {}) {
  if (!row || typeof row !== 'object') return { show: 'none' };
  const a = readAvatar(row);
  const still = row.animate === false;
  if (a.use === 'drawn' && a.drawn) return { show: 'drawn', drawn: a.drawn, still };
  if (a.use === 'picture' && a.picture) {
    if (picture && picture.status === 'ok' && picture.url) return { show: 'picture', url: picture.url, drawn: a.drawn, still };
    // Missing or broken: the drawn one if there is one. Still resolving: nothing yet (today's display),
    // so a picture does not flash a drawing it is about to replace.
    // (A second try at a picture that failed keeps showing the fallback while it runs.)
    if (picture && (picture.status === 'failed' || picture.retry) && a.drawn) return { show: 'drawn', drawn: a.drawn, still, fallback: true };
    return { show: 'none', pending: !picture || picture.status === 'pending' };
  }
  return { show: 'none' };
}

/**
 * The small face, as markup, or '' when there is nothing to show (rule 1). Decorative: the name beside
 * it already says who, so it is hidden from a screen reader rather than read out a second time.
 *   size     a CSS length in px/em/rem (DISPLAY_DEFAULTS.size)
 *   animate  whether a drawn avatar may move (DISPLAY_DEFAULTS.animate); reduced motion and the
 *            person's own `still` override it
 *   round    circle (true) or square
 *   personId marks a picture so `bindErrors` knows whose failed
 *   reducedMotion  true/false to decide it here; omitted, the device's own setting is asked
 */
export function avatarHtml(view, { size = DISPLAY_DEFAULTS.size, animate = DISPLAY_DEFAULTS.animate,
  round = DISPLAY_DEFAULTS.round, personId = '', reducedMotion = null, win = globalThis } = {}) {
  if (!view || (view.show !== 'drawn' && view.show !== 'picture')) return '';
  const s = cssSize(size);
  const style = `display:inline-block;width:${s};height:${s};vertical-align:middle;overflow:hidden;`
    + `flex:none;line-height:0;margin-inline-end:.4em;border-radius:${round ? '50%' : '.2em'}`;
  if (view.show === 'picture') {
    return `<span class="nav-av" data-avatar-shown="picture" aria-hidden="true" style="${style}">`
      + `<img src="${esc(view.url)}" alt="" data-avatar-person="${esc(personId)}" `
      + 'style="display:block;width:100%;height:100%;object-fit:cover"></span>';
  }
  const reduced = reducedMotion == null ? systemReduced(win) : !!reducedMotion;
  const moving = !!animate && !view.still && !reduced;
  return `<span class="nav-av" data-avatar-shown="drawn" aria-hidden="true" style="${style}">`
    + renderAvatar(view.drawn, { size: '100%', animate: moving, title: '' }) + '</span>';
}

/**
 * ONE PER PAGE: every person's avatar, read once and kept current.
 *   makePersonState(personId, key)  the host's per-person state seam; without it every person is 'none'
 *   sourcesFor(personId)            a Media sources client ({ list() }) for that person's pictures;
 *                                   defaults to the real registry for `user`
 *   poll                            false: no polling (argued above, rule 2). true: the handle polls
 *   refreshOnVisible                re-read each person once when the page is shown again, which is how
 *                                   a change made in another tab or on another device arrives
 * Returns { get(personId) -> view, subscribe(fn(personId)) -> off, markBroken(personId),
 *           bindErrors(el) -> off, refresh(personId?), forget(personId), destroy() }.
 */
export function createAvatarCache({ makePersonState = null, sourcesFor = null, user = null,
  resolveUrl = resolveItemUrl, poll = false, refreshOnVisible = true, win = globalThis } = {}) {
  const entries = new Map();
  const subs = new Set();
  const sourceLists = new Map();          // personId -> Promise<sources[]>, listed once
  let dead = false;

  const notify = (pid) => {
    for (const fn of [...subs]) { try { fn(pid); } catch (e) { console.error('avatar display', e); } }
  };

  function releasePicture(e) {
    try { e.pic?.release?.(); } catch { /* gone */ }
    e.pic = null;
  }

  // A row arrived (a load, a subscription, the maker's event). Only a real change redraws anything.
  function take(pid, row) {
    const e = entries.get(pid);
    if (!e || dead) return;
    const r = row && typeof row === 'object' ? row : {};
    const a = readAvatar(r);
    const key = JSON.stringify([a, r.animate === false]);
    if (e.loaded && key === e.key) return;
    e.loaded = true; e.key = key; e.row = r;
    const picKey = a.use === 'picture' && a.picture ? `${a.picture.sourceId}\n${a.picture.path}` : null;
    if (e.pic && e.pic.key !== picKey) releasePicture(e);
    notify(pid);
  }

  function listSources(pid) {
    if (!sourceLists.has(pid)) {
      const client = sourcesFor ? sourcesFor(pid) : createMediaSourcesClient({ user, cache: true, personId: pid || null });
      sourceLists.set(pid, Promise.resolve().then(() => client?.list?.()).then((l) => (Array.isArray(l) ? l : [])).catch(() => []));
    }
    return sourceLists.get(pid);
  }

  function ensurePicture(pid, e, ref) {
    const key = `${ref.sourceId}\n${ref.path}`;
    if (e.pic && e.pic.key === key) return e.pic;
    releasePicture(e);
    const pic = { key, status: 'pending', url: null, release: null };
    e.pic = pic;
    (async () => {
      let got = null;
      try {
        const list = await listSources(pid);
        const src = list.find((x) => x && x.id === ref.sourceId);
        if (src) got = await resolveUrl(src, ref.path);
      } catch (err) { console.warn('avatar: could not resolve a picture', err); got = null; }
      if (dead || e.pic !== pic) { try { got?.release?.(); } catch { /* gone */ } return; }
      if (got && got.url) { pic.status = 'ok'; pic.url = got.url; pic.release = got.release || null; }
      else pic.status = 'failed';
      notify(pid);
    })();
    return pic;
  }

  function load(pid, e) {
    if (!e.handle) return;
    Promise.resolve().then(() => e.handle.load?.()).then(() => take(pid, e.handle.get?.()))
      // No row, no permission (a person on another account), no server: no avatar. Never an error on screen.
      .catch(() => take(pid, {}));
  }

  function ensure(pid) {
    if (!pid || dead) return null;
    let e = entries.get(pid);
    if (e) return e;
    e = { handle: null, off: null, loaded: false, key: '', row: null, pic: null };
    entries.set(pid, e);
    if (typeof makePersonState !== 'function') return e;
    try { e.handle = makePersonState(pid, AVATAR_KEY) || null; } catch (err) { console.warn('avatar: person state', err); e.handle = null; }
    if (!e.handle) return e;
    try { e.off = e.handle.subscribe?.((row) => take(pid, row)) || null; } catch { e.off = null; }
    if (poll) { try { e.handle.startPolling?.(); } catch { /* the handle polls or it does not */ } }
    load(pid, e);
    return e;
  }

  function get(pid) {
    const e = ensure(pid);
    if (!e || !e.loaded) return { show: 'none', pending: !!e };
    const a = readAvatar(e.row);
    const pic = a.use === 'picture' && a.picture ? ensurePicture(pid, e, a.picture) : null;
    return avatarView(e.row, { picture: pic });
  }

  function markBroken(pid) {
    const e = entries.get(pid);
    if (!e || !e.pic || e.pic.status === 'failed') return;
    try { e.pic.release?.(); } catch { /* gone */ }
    e.pic.status = 'failed'; e.pic.url = null; e.pic.release = null;
    notify(pid);
  }

  // The maker on this same page saved: take its row as it is, no request.
  const onChanged = (ev) => {
    const d = ev && ev.detail;
    if (d && d.personId && entries.has(d.personId)) take(d.personId, d.row);
  };
  // A deliberate re-read also gives a picture that failed another go: the folder may have been
  // connected since (a media agent that was off, a drive plugged back in).
  function reread(pid, e) {
    // Tried in the background; what shows now stays until it answers, so nothing flickers.
    if (e.pic && e.pic.status === 'failed' && e.loaded) {
      const a = readAvatar(e.row);
      releasePicture(e); sourceLists.delete(pid);
      if (a.use === 'picture' && a.picture) {
        const pic = ensurePicture(pid, e, a.picture);
        pic.retry = true;
      }
    }
    load(pid, e);
  }
  const onVisible = () => {
    if (win?.document?.visibilityState && win.document.visibilityState !== 'visible') return;
    for (const [pid, e] of entries) reread(pid, e);
  };
  try { win?.addEventListener?.(AVATAR_CHANGED_EVENT, onChanged); } catch { /* no window */ }
  if (refreshOnVisible) { try { win?.document?.addEventListener?.('visibilitychange', onVisible); } catch { /* no document */ } }

  return {
    get,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    markBroken,
    /** An <img> that fails to decode (error events do not bubble, so this listens in the capture phase). */
    bindErrors(el) {
      if (!el?.addEventListener) return () => {};
      const fn = (ev) => {
        const t = ev.target;
        if (t && t.tagName === 'IMG' && t.dataset && 'avatarPerson' in t.dataset) markBroken(t.dataset.avatarPerson);
      };
      el.addEventListener('error', fn, true);
      return () => el.removeEventListener('error', fn, true);
    },
    refresh(pid = null) {
      if (pid) { const e = entries.get(pid); if (e) reread(pid, e); return; }
      for (const [id, e] of entries) reread(id, e);
    },
    forget(pid) {
      const e = entries.get(pid);
      if (!e) return;
      entries.delete(pid);
      try { e.off?.(); } catch { /* gone */ }
      try { e.handle?.destroy?.(); } catch { /* gone */ }
      releasePicture(e);
    },
    /** How many people have a handle open: the proof of rule 2. */
    size: () => entries.size,
    destroy() {
      dead = true;
      subs.clear();
      try { win?.removeEventListener?.(AVATAR_CHANGED_EVENT, onChanged); } catch { /* gone */ }
      try { win?.document?.removeEventListener?.('visibilitychange', onVisible); } catch { /* gone */ }
      for (const e of entries.values()) {
        try { e.off?.(); } catch { /* gone */ }
        try { e.handle?.destroy?.(); } catch { /* gone */ }
        releasePicture(e);
      }
      entries.clear();
      sourceLists.clear();
    },
  };
}
