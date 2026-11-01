// caller_face.js — WHO IS ON THE OTHER END, BY THEIR PICTURE (row 2.167), for any notice that names somebody the
// SERVER named.
//
// The server stamps a call's, an intercom's and a silent check-in's offer with the caller's card on the screen owner's
// people list (`byPerson`) and that card's name as the screen's person knows them (`byName`; app.py
// `_caller_on_screen`). drive.py stamp_signal removes both from anything a page sends, so they are the server's word.
// This file is the screen's half of the picture, once, for the three notices that show it: the incoming-call notice
// (call_notice.js), the intercom's (intercom.js) and the check-in's (checkin.js).
//
// No picture (no card, no avatar, the cache not built, somebody else's avatar on a screen that hides them): the slot is
// hidden and the notice is exactly the words it always was.

import { avatarHtml, DISPLAY_DEFAULTS } from './avatar_display.js';

// A card id as the server writes them (drive.py's id rule); anything else is not one, and draws nothing.
const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The server's word on who sent a stamped signal: `{ name, personId }` - `name` '' and `personId` null when it named
 * nobody (an older server, or a caller with no card). Pure. Never reads anything a page could have written.
 */
export function serverCaller(sig) {
  const name = sig && typeof sig.byName === 'string' ? sig.byName.trim().slice(0, 60) : '';
  const personId = sig && typeof sig.byPerson === 'string' && CARD_ID.test(sig.byPerson) ? sig.byPerson : null;
  return { name, personId };
}

/**
 * One face slot. `avatars`: the screen's avatar cache (avatar_display.js createAvatarCache), or a function returning it -
 * asked for only when something names a person, so a screen reads no faces until a notice needs one. `size`/`animate`:
 * avatarHtml's, the avatar display's own defaults unless a notice argues otherwise. `tag`/`style`: the slot element.
 * Returns { el, show(personId|null), html() -> string|null, destroy() }.
 */
export function createCallerFace({
  doc = (typeof document !== 'undefined' ? document : null),
  avatars = null,
  size = DISPLAY_DEFAULTS.size,
  animate = DISPLAY_DEFAULTS.animate,
  tag = 'span',
  style = '',
} = {}) {
  if (!doc) throw new Error('createCallerFace: a document is required');
  const el = doc.createElement(tag);
  el.dataset.callerFace = '';
  el.setAttribute('aria-hidden', 'true');
  const shownStyle = style;
  let pid = '';
  let faces = null;
  let off = null;

  function cache() {
    if (faces) return faces;
    try { faces = typeof avatars === 'function' ? avatars() : avatars; } catch { faces = null; }
    if (!faces || typeof faces.get !== 'function') { faces = null; return null; }
    // A picture that arrives after the notice went up (the first read of that card) is painted in.
    try { off = faces.subscribe?.((p) => { if (p && p === pid) paint(); }) || null; } catch { off = null; }
    return faces;
  }
  function paint() {
    let html = '';
    const c = pid ? cache() : null;
    if (c) {
      try { html = avatarHtml(c.get(pid), { size, animate, personId: pid }) || ''; }
      catch (err) { console.error('caller face', err); html = ''; }
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = !html;
    // An inline display would beat `hidden`, so the slot's own style is only on while it shows a face.
    el.style.cssText = html ? shownStyle : 'display:none';
  }
  paint();

  return {
    el,
    /** Show this card's face ('' / null / not a card id: none). */
    show(personId) {
      const next = typeof personId === 'string' && CARD_ID.test(personId) ? personId : '';
      if (next === pid && (next === '' || !el.hidden)) return;
      pid = next;
      paint();
    },
    /** The face as drawn, or null when there is none (for the suites). */
    html: () => (el.hidden ? null : el.innerHTML),
    destroy() { try { off?.(); } catch { /* gone */ } off = null; faces = null; },
  };
}
