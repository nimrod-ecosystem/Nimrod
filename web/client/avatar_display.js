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

//   4. A DRAWING SOMEBODY BROUGHT IN CAN MOVE (Mike, 2026-10-01: "What's the risk? Seems like it should
//      be okay."). A `picture` that is an .svg file is read once, made safe by `svg_sanitize.js` (an
//      allow-list: no script, no handler, no link out, no fetch, styles kept inside the drawing), and
//      drawn INLINE so its `eyes` group can blink. A file that cannot be made safe, or cannot be read,
//      shows as the still <img> it always was.
//
//   5. WHETHER A FACE MOVES FOLLOWS THE PERSON — inside what the viewer's health and the screen allow
//      (Mike, 2026-10-01: "unless it conflicts with the screen's capabilities or someone's settings for
//      medical things"). `avatarMotion` is the one place that decides; its table is below.
//
//   6. WHETHER OTHER PEOPLE'S OWN FACES SHOW, AND MOVE, IS A SETTING ON THE SCREEN AND ON THE PERSON
//      (Mike, 2026-10-02), on by default. OTHERS_AVATAR_FIELDS, below.

import { readAvatar, renderAvatar, AVATAR_KEY } from './avatar.js';
import { createMediaSourcesClient, resolveItemUrl, sourceById } from './media_sources.js';
import { sanitizeSvg, svgMarkup, newSvgUid, looksLikeSvgPath, minAnimationMs, SVG_LIMITS } from './svg_sanitize.js';
import { flashLimitFrom, normalizeFlashLimit, FLASH_LIMIT_DEFAULT } from './flash_limit.js';
import { isChosen } from './starting_defaults.js';

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
//                 caller showing a BIG face (a call tile, the room's window) passes `animate: true`.
//                 This is only the DEFAULT for a person who chose nothing: `avatarMotion` (below)
//                 puts health settings, the screen and the person's own choice above it.
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

// ---------------------------------------------------------------------------------------
// *** WHETHER A FACE MOVES: THE PRECEDENCE (Mike, 2026-10-01). ***
//
// Only TWO things can make a face move: the person's own choice, and (when they made none) the size
// it is shown at. Everything above them can only make it STILL. In order, the first that applies wins:
//
//   1. medical   the device asks for reduced motion (prefers-reduced-motion), or the viewer's or the
//                screen's `reduceMotion` setting is on (the "movement makes me unwell" box in
//                starting_defaults.js, filling only what nobody chose)              -> still
//   2. screen    the screen's `avatarMotion` is 'still', or the host says it is a
//                low-power screen                                                  -> still
//                the screen's `avatarMotion` is 'big' and this face is small       -> still
//                somebody else's face, and `othersAvatarsMove` is off (the screen's
//                row, else the viewer's - OTHERS_AVATAR_FIELDS, 2026-10-02)         -> still
//   3. person    the person chose still                                            -> still
//                the person chose "always moves"                                   -> moves
//   4. default   a large face (a call, the room's window) moves; a small chip stays still
//
// THE FLASH LIMIT IS A CEILING ON SPEED, NOT AN ON/OFF, ARGUED. It is applied to every face that moves:
// the blink is one flash in 9 s (far under the photosensitivity box's 3 a second, or even 1), and a
// brought-in drawing's own animations are stretched to it (`svg_sanitize.js`). Only a limit so low that
// the 9 s blink itself would break it (under about one flash in 4.5 s; nothing offers that, but nothing
// clamps a stored value either — flash_limit.js) stills the face, as step 1. FOR stilling every face
// when the box is ticked: a person is protected twice. AGAINST, and it wins: the box sets only the
// flash limit (starting_defaults.js refuses to infer reduced motion from it — an unsourced clinical
// claim), and a gentle blink is not a flash. "Nothing moves" is `reduceMotion`.
//
// THE PERSON'S "ALWAYS MOVES" BEATS THE SMALL-CHIP DEFAULT, ARGUED. FOR: Mike's ruling is that movement
// follows the person, and a person who asked for it should get it. AGAINST: a row of chips blinking out
// of step pulls the eye from what is being read. It wins anyway because the viewer keeps two ways to
// say no — `reduceMotion`, and this screen's own `avatarMotion: 'big'` — and nobody who has not chosen
// is changed: a person with no choice still gets a still chip. [On Mike's list.]
//
// LOW POWER IS NOT GUESSED, ARGUED. FOR detecting it (navigator.hardwareConcurrency/deviceMemory): a
// slow screen would get still faces with nobody setting anything. AGAINST, and it wins: a Pi 400 reports
// 4 cores and 4 GB, the same as many laptops, deviceMemory exists only in Chromium, and a guess that is
// wrong in both directions silently changes what people see. A CSS transform on a few small drawings is
// cheap. The screen's own setting ('still') is the switch; a host that KNOWS passes `lowPower: true`.
// ---------------------------------------------------------------------------------------

export const AVATAR_MOTION_KEY = 'avatarMotion';
export const AVATAR_MOTION_VALUES = Object.freeze(['follow', 'big', 'still']);
/** The screen's row a host's menu shows (beside the flash limit). `follow` changes nobody's screen. */
export const AVATAR_MOTION_FIELD = Object.freeze({
  key: AVATAR_MOTION_KEY,
  label: 'Faces moving',
  kind: 'choice',
  default: 'follow',
  level: 'standard',
  options: Object.freeze([
    Object.freeze({ value: 'follow', label: 'As each person chose' }),
    Object.freeze({ value: 'big', label: 'Only large faces' }),
    Object.freeze({ value: 'still', label: 'Never on this screen' }),
  ]),
  note: 'People\'s faces blink and breathe gently. Movement turned off for health reasons always wins.',
  automatable: false,
});
const screenMotion = (v) => (AVATAR_MOTION_VALUES.includes(v) ? v : 'follow');

// ---------------------------------------------------------------------------------------
// *** OTHER PEOPLE'S OWN AVATARS, PER SCREEN AND PER PERSON (Mike, 2026-10-02). ***
// "There should be a setting for screens/users/etc. that allows other users to have personal and or
// animated avatars. I'd leave it on by default unless medical blocks it."
//
//   othersAvatars       Show other people's own avatars      on   off: their name only (rule 1's display)
//   othersAvatarsMove   ...and let them move                 on   off: their faces are still
//
// "OTHER PEOPLE" is everybody but the person this screen is for (`viewerId` in the context). A screen
// that is for nobody (a room screen) counts every face as somebody else's. The viewer's own face
// follows only the rules above - these two rows are about what OTHER people bring onto this screen.
//
// THE PRECEDENCE, the one faces moving already has: medical > screen > person > default.
//   medical  MOVEMENT: the device's reduced motion and `reduceMotion` (avatarMotion step 1) still every
//            face, and "on" here never turns one back on - "on" ALLOWS movement, it does not force it.
//            SHOWING: no medical setting hides a face, argued. FOR one doing so: some people are upset
//            by faces they do not recognise. AGAINST, and it wins: none of the published boxes
//            (starting_defaults.js: flashing, colour, movement, low vision, tremor, hearing) is about
//            seeing a face; a still picture cannot flash, and a moving one is already under reduced
//            motion and the flash limit; tying it to "Memory loss" or "Brain injury" (both
//            to-be-filled, setting nothing) would be the unsourced clinical claim that file refuses
//            to make. So only movement has a medical override. [On Mike's list.]
//   screen   the screen's row, where it CHOSE (true or false), wins - a screen in a room is the place's.
//   person   the viewer's row, where the screen chose nothing.
//   default  on, both.
// "Off" for movement sits ABOVE the other person's own "always moves": what moves on a screen is the
// viewer's to say, and that person's face still moves on their own screen.
// A value that is not true or false is not a choice (garbage never decides), as in flash_limit.js.
// ---------------------------------------------------------------------------------------
export const OTHERS_AVATARS_KEY = 'othersAvatars';
export const OTHERS_AVATARS_MOVE_KEY = 'othersAvatarsMove';
/** The two rows, for the screen's menu AND the person's (the same keys on both rows). */
export const OTHERS_AVATAR_FIELDS = Object.freeze([
  Object.freeze({ key: OTHERS_AVATARS_KEY, label: 'Show other people\'s own avatars', default: true,
    level: 'standard', onLabel: 'Yes - their own drawing or picture', offLabel: 'No - just their name',
    note: 'Your own avatar is not affected. A screen\'s choice here wins over a person\'s.' }),
  Object.freeze({ key: OTHERS_AVATARS_MOVE_KEY, label: 'Let other people\'s avatars move', default: true,
    level: 'standard', onLabel: 'Yes, as each person chose', offLabel: 'No - keep them still',
    note: 'Movement turned off for health reasons always wins.', automatable: false }),
]);
function othersChoice(screen, viewer, key) {
  for (const r of [screen, viewer]) if (r && typeof r === 'object' && typeof r[key] === 'boolean') return r[key];
  return true;
}
// The drawn blink's cycle and its keyframe stops (avatar.js MOTION_CSS: navBlink, 9 s, five stops), the
// slowest-to-honour movement a face has, so the one the flash limit is checked against.
const BLINK_CYCLE_MS = 9000;
const BLINK_STOPS = 5;

/**
 * What a host knows about the viewer and the screen, read once into one object for `avatarHtml`.
 *   screen  the screen's settings row     viewer  the settings row of the person the screen is for
 *   layer   the starting-defaults layer on this device (fills only what neither row chose)
 *   lowPower  true when the host KNOWS this is a slow screen (never guessed, argued above)
 *   flashLimit  a number or a getter, when the host already has one (else read from the rows)
 *   viewerId  the id of the person this screen is for (null: nobody - every face is somebody else's)
 * `reduceMotion`, like the flash limit (flash_limit.js `flashLimitFrom`): where either row CHOSE, the
 * stricter (on) wins; where neither did, the layer's. `othersShow` / `othersMove`: OTHERS_AVATAR_FIELDS.
 */
export function avatarMotionContext({ screen = {}, viewer = {}, layer = {}, lowPower = false,
  flashLimit = null, win = globalThis, deviceReduced = null, viewerId = null } = {}) {
  const rows = [screen, viewer].filter((r) => r && typeof r === 'object');
  const chosen = rows.filter((r) => isChosen(r, 'reduceMotion')).map((r) => r.reduceMotion === true);
  const reduceMotion = chosen.length ? chosen.some(Boolean) : (layer || {}).reduceMotion === true;
  let fl;
  try { fl = typeof flashLimit === 'function' ? flashLimit() : flashLimit; } catch { fl = null; }
  if (fl === null || fl === undefined) { try { fl = flashLimitFrom(rows, layer || {}); } catch { fl = FLASH_LIMIT_DEFAULT; } }
  return {
    deviceReduced: deviceReduced === null ? systemReduced(win) : !!deviceReduced,
    reduceMotion,
    screen: screenMotion((screen || {})[AVATAR_MOTION_KEY]),
    lowPower: !!lowPower,
    flashLimit: normalizeFlashLimit(fl),
    viewerId: viewerId == null || viewerId === '' ? null : String(viewerId),
    othersShow: othersChoice(screen, viewer, OTHERS_AVATARS_KEY),
    othersMove: othersChoice(screen, viewer, OTHERS_AVATARS_MOVE_KEY),
  };
}

/** Is `personId`'s face somebody else's on this screen? Everybody is, on a screen for nobody. */
export function isOtherPerson(context = {}, personId = '') {
  const v = context && context.viewerId;
  return !v || String(personId || '') !== String(v);
}

/**
 * THE DECISION. `context` from `avatarMotionContext` (or any part of it), `person` the person's own
 * choice (true / false / null for none), `big` whether this face is shown large, `other` whether it is
 * somebody other than the person this screen is for (OTHERS_AVATAR_FIELDS; default true).
 * Returns { animate, because, flashLimit }.  PURE.
 */
export function avatarMotion({ context = {}, person = null, big = false, other = true } = {}) {
  const c = context || {};
  const flashLimit = normalizeFlashLimit(c.flashLimit);
  const still = (because) => ({ animate: false, because, flashLimit });
  if (c.deviceReduced) return still('device-reduced-motion');
  if (c.reduceMotion) return still('reduce-motion-setting');
  if (minAnimationMs(BLINK_STOPS, flashLimit) > BLINK_CYCLE_MS) return still('flash-limit');
  if (c.screen === 'still') return still('screen-still');
  if (c.lowPower) return still('low-power-screen');
  if (c.screen === 'big' && !big) return still('screen-large-only');
  // Other people's faces, kept still by the screen's or the viewer's row (screen first; resolved in
  // avatarMotionContext). Above the other person's own "always moves".
  if (other && c.othersMove === false) return still('others-still');
  if (person === false) return still('person-still');
  if (person === true) return { animate: true, because: 'person-moves', flashLimit };
  return big ? { animate: true, because: 'default-large', flashLimit } : still('default-small');
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
  // The person's own movement choice: false (still), true (always moves), or none.
  const still = row.animate === false;
  const moves = row.animate === true;
  if (a.use === 'drawn' && a.drawn) return { show: 'drawn', drawn: a.drawn, still, moves };
  if (a.use === 'picture' && a.picture) {
    // `svg`: the file made safe to draw inline (rule 4), when it is one and it could be.
    if (picture && picture.status === 'ok' && picture.url) {
      return { show: 'picture', url: picture.url, svg: picture.svg && picture.svg.ok ? picture.svg : null, drawn: a.drawn, still, moves };
    }
    // Missing or broken: the drawn one if there is one. Still resolving: nothing yet (today's display),
    // so a picture does not flash a drawing it is about to replace.
    // (A second try at a picture that failed keeps showing the fallback while it runs.)
    if (picture && (picture.status === 'failed' || picture.retry) && a.drawn) return { show: 'drawn', drawn: a.drawn, still, moves, fallback: true };
    return { show: 'none', pending: !picture || picture.status === 'pending' };
  }
  return { show: 'none' };
}

/**
 * The small face, as markup, or '' when there is nothing to show (rule 1). Decorative: the name beside
 * it already says who, so it is hidden from a screen reader rather than read out a second time.
 *   size     a CSS length in px/em/rem (DISPLAY_DEFAULTS.size)
 *   animate  whether this is a LARGE face, which moves by default (DISPLAY_DEFAULTS.animate: false,
 *            a small chip); the decision is `avatarMotion`'s, so health settings, the screen and the
 *            person's own choice all come first
 *   round    circle (true) or square
 *   personId marks a picture so `bindErrors` knows whose failed
 *   reducedMotion  true/false to decide the device's reduced motion here; omitted, the device is asked
 *   context  `avatarMotionContext(...)`; omitted, the one the cache put on the view (`view.context`)
 */
export function avatarHtml(view, { size = DISPLAY_DEFAULTS.size, animate = DISPLAY_DEFAULTS.animate,
  round = DISPLAY_DEFAULTS.round, personId = '', reducedMotion = null, win = globalThis, context = null } = {}) {
  if (!view || (view.show !== 'drawn' && view.show !== 'picture')) return '';
  const ctx = { ...(context || view.context || {}) };
  const other = isOtherPerson(ctx, personId);
  // Somebody else's own avatar, on a screen (or for a viewer) that chose not to show them: their name
  // only - exactly the display of a person with no avatar (rule 1).
  if (other && ctx.othersShow === false) return '';
  const s = cssSize(size);
  const style = `display:inline-block;width:${s};height:${s};vertical-align:middle;overflow:hidden;`
    + `flex:none;line-height:0;margin-inline-end:.4em;border-radius:${round ? '50%' : '.2em'}`;
  if (reducedMotion != null) ctx.deviceReduced = !!reducedMotion;
  else if (ctx.deviceReduced == null) ctx.deviceReduced = systemReduced(win);
  const person = view.still ? false : view.moves ? true : null;
  const m = avatarMotion({ context: ctx, person, big: !!animate, other });
  if (view.show === 'picture') {
    if (view.svg) {
      // Drawn inline, from the sanitized description only — never from the file's own text.
      const markup = svgMarkup(view.svg, { uid: newSvgUid(), animate: m.animate, flashLimit: m.flashLimit,
        delay: (hashOf(personId) % 90) / 10 });
      if (markup) {
        return `<span class="nav-av" data-avatar-shown="picture" data-avatar-kind="svg" data-motion-why="${m.because}" aria-hidden="true" style="${style}">`
          + `${markup}</span>`;
      }
    }
    return `<span class="nav-av" data-avatar-shown="picture" aria-hidden="true" style="${style}">`
      + `<img src="${esc(view.url)}" alt="" data-avatar-person="${esc(personId)}" `
      + 'style="display:block;width:100%;height:100%;object-fit:cover"></span>';
  }
  return `<span class="nav-av" data-avatar-shown="drawn" data-motion-why="${m.because}" aria-hidden="true" style="${style}">`
    + renderAvatar(view.drawn, { size: '100%', animate: m.animate, title: '' }) + '</span>';
}

// A stable small number from a person's id, so two brought-in faces side by side do not blink in step.
function hashOf(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Read a picture's text for `svg_sanitize.js`: once, with a size cap before it is read as text. */
async function fetchSvgText(url, { maxChars = SVG_LIMITS.maxChars } = {}) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const b = await r.blob();
  // Characters are at most 4 bytes; a file over this many bytes cannot be under the cap.
  if (b.size > maxChars * 4) return null;
  return b.text();
}

/**
 * ONE PER PAGE: every person's avatar, read once and kept current.
 *   makePersonState(personId, key)  the host's per-person state seam; without it every person is 'none'
 *   sourcesFor(personId)            a Media sources client ({ list() }) for that person's pictures;
 *                                   defaults to the real registry for `user`
 *   poll                            false: no polling (argued above, rule 2). true: the handle polls
 *   refreshOnVisible                re-read each person once when the page is shown again, which is how
 *                                   a change made in another tab or on another device arrives
 *   context()                       the host's `avatarMotionContext(...)`, asked on every `get` (cheap),
 *                                   so a face follows a changed health or screen setting at its next draw
 *   fetchText(url)                  reads an .svg picture's text (rule 4); once per picture
 *   svgLimits                       overrides for svg_sanitize.js's caps
 * Returns { get(personId) -> view, subscribe(fn(personId)) -> off, markBroken(personId),
 *           bindErrors(el) -> off, refresh(personId?), forget(personId), destroy() }.
 */
export function createAvatarCache({ makePersonState = null, sourcesFor = null, user = null,
  resolveUrl = resolveItemUrl, poll = false, refreshOnVisible = true, win = globalThis,
  context = null, fetchText = fetchSvgText, svgLimits = {} } = {}) {
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
    const key = JSON.stringify([a, r.animate === false ? 0 : r.animate === true ? 1 : null]);
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
        // `sourceById`: a picture added from this device has a source not in the registry list.
        const src = sourceById(list, ref.sourceId);
        if (src) got = await resolveUrl(src, ref.path);
      } catch (err) { console.warn('avatar: could not resolve a picture', err); got = null; }
      // An .svg is read ONCE and made safe here, so every chip after this draws from the description,
      // never re-reading or re-parsing the file. Any failure leaves `svg` empty: the still <img>.
      let svg = null;
      if (got && got.url && looksLikeSvgPath(ref.path) && typeof fetchText === 'function') {
        try {
          const text = await fetchText(got.url);
          svg = typeof text === 'string' ? sanitizeSvg(text, svgLimits) : null;
        } catch (err) { console.warn('avatar: could not read a drawing; showing it still', err); svg = null; }
      }
      if (dead || e.pic !== pic) { try { got?.release?.(); } catch { /* gone */ } return; }
      if (got && got.url) { pic.status = 'ok'; pic.url = got.url; pic.release = got.release || null; pic.svg = svg; }
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
    const view = avatarView(e.row, { picture: pic });
    if (typeof context === 'function') {
      try { view.context = context() || null; } catch (err) { console.warn('avatar: motion context', err); view.context = null; }
    }
    return view;
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
