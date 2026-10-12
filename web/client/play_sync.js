// play_sync.js — WATCHING ALONG: a screen says what it is playing, a follower plays the same thing in step.
//
// The mirroring plan's first step (row 2.79, docs/for_chat/mirroring_plan_20261010.md): a screen plays a YouTube
// video and a signed-in page somewhere else plays THE SAME VIDEO FROM ITS OWN COPY, in step. Nothing travels but a
// tiny message — "this video, at this second, playing" — so the picture stays at full quality on both, it works on
// weak facility wifi, and the screen's computer never encodes video. The old bedside build did this in July 2026
// (a state message every 2 s, a re-seek past 4 s of drift) but never sent a time, so it could not allow for the
// network's delay. This one does: the drive socket's pong now carries the server's clock, both ends measure how far
// their own clock is from it, and a message's `at` is the server's — the same moment everywhere.
//
// WHAT IS IN HERE, all pure (clocks, timers and the socket are injected; dev/play_sync_test.html drives every branch):
//   * buildPlay / checkPlay — the `play` message, its fields and its 1 KB cap (mirrors web/server/play_relay.py).
//   * createClock — the clock difference from ping round trips (the lowest-delay sample of the last few wins).
//   * targetPos / decide — where the screen is NOW, and what a follower does about it (load, seek, play, pause).
//   * createPlaySender — the screen's half: panels report on the bus, this sends on a change and every few seconds,
//     and only while the screen's owner has turned sharing on AND somebody is following.
//   * createFollower — the follower's half: messages in, player commands out.
//   * the screen's two settings, and the words for the notice the screen shows.
//
// THE PATH (and the safety rule it keeps): a screen's `play` goes over the drive socket to the server, which passes
// it to that person's drivers who said they are FOLLOWING, and to nobody else — the direction call signals already
// travel, so "screens never talk to screens" is unchanged. The server stamps `at` and `from` and keeps nothing.
//
// PHOTOS IN STEP (2026-10-12): the same path for a Photos panel's pictures, by an opaque id (see PHOTOS IN STEP below,
// and photo_follow.js for the follow page's half). A screen showing a video AND a slideshow shares the one this
// screen's "When more than one thing plays, people following see" setting picks (FOLLOW_MAIN_FIELD, argued there).

import { sha256Hex } from './sha256.js';

// *** THE TOPIC A PANEL REPORTS ON. *** A panel never touches the socket: it publishes what it is playing on the
// screen's own bus, and the screen's sender decides whether anything leaves the room. So a panel cannot share by
// accident, and a screen with sharing off sends nothing at all.
export const PLAY_NOW_TOPIC = 'play/now';

// Mirrored from play_relay.py (the server enforces the same; this end checks so a bad message fails HERE).
// 'photo' (2026-10-12, photos in step): a picture (or a clip) in a Photos panel, by an OPAQUE id - see PHOTOS IN STEP.
export const PLAY_KINDS = Object.freeze(['youtube', 'photo']);
export const MAX_PLAY_BYTES = 1024;
export const MAX_POS_S = 7 * 24 * 3600;
export const MAX_SCREEN_NAME = 40;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const FROM_ID = /^[0-9a-f]{8}$/;

// ---- PHOTOS IN STEP (2026-10-12) ----------------------------------------------------------------------------------
// Mike, 2026-10-12: "we both see and hear the same thing at the same time... the same pictures and videos on a call or
// even just to know I'm looking at the same things when it's not a call."
//
// *** THE FOLLOWER SHOWS ITS OWN COPY, FOUND BY AN OPAQUE ID. *** A screen's photo program is usually on that screen's
// own computer (localhost), which a follower at home cannot reach - and must not try (media_sources.js quietReach: no
// local-network box). The household's shared copy is usually a Google Drive folder every screen pulls, so the same
// picture exists on both sides under the same path INSIDE its source's folder. So the screen sends a hash of that
// path, and the follow page hashes its own listing the same way and looks the id up (photo_follow.js). The path, the
// file name and the address never leave the screen; the server relays the id in memory and stores nothing.
//
// *** THE SALT: A NEW ONE FOR EACH SHARING SESSION, CHOSEN BY THE SCREEN, CARRIED IN THE MESSAGE. *** Argued (Mike's
// list, 2026-10-12):
//   * NO SALT: one picture is the same id in every household, so a table of common camera names (IMG_0001.jpg ...)
//     made once reads everybody's. Rejected.
//   * PER PERSON (say, from the person's id): the follow page could keep its index for good. But a picture is then the
//     same id forever, so anybody holding two logs can tell "the same picture was on screen Monday and Friday" without
//     knowing which - and the server knows the person's id anyway, so it hides nothing from the server either.
//   * PER SHARING SESSION (CHOSEN): a fresh random salt each time somebody starts following after nobody was. No
//     table made in advance works, ids from two sessions cannot be matched, and a guess has to be redone each session.
//     Cost: the follow page hashes its listing once per session (measured in dev/photo_follow_test.html).
//   * HONESTLY: the salt travels with the id, so the server sees both. Nothing that passes through the server can stop
//     a server that sets out to GUESS names (camera names are guessable: a date and a time). What stops the server
//     learning anything is rule 2 of play_relay.py - it holds the message in memory, passes it on, and keeps nothing.
//     A salt the server never sees needs a key the two ends share some other way (a small key file in the shared
//     Drive folder each side reads from its own copy, or a key exchange between the screen and the follow page).
//     Not built: on Mike's list as the next step if he wants it.
// The id is the first PHOTO_ID_HEX hex characters (128 bits) of SHA-256 over a fixed label, the salt and the path:
// 128 bits is far past any household's pictures (a collision among a million is about 1 in 10^27), and fixed-length
// hex is what lets both ends refuse anything else.
export const PHOTO_ID_HEX = 32;
export const SALT_HEX = 16;
const PHOTO_ID = /^[0-9a-f]{32}$/;
const SALT_RE = /^[0-9a-f]{16}$/;
const PHOTO_LABEL = 'nimrod-photo-v1';
// *** A FILE NAME DRESSED AS HEX IS STILL REFUSED. *** "Mom hospital 24" is fifteen bytes - thirty hex characters -
// so the format alone would let a page smuggle a short name across as an "id". A real hash's bytes are random: the
// chance that all sixteen are printable text is (95/256)^16, about 1 in 8 million, so an id whose bytes are ALL
// printable is refused (play_relay.py does the same). The same for the salt's eight bytes (1 in 2,800 by chance; the
// screen simply draws again).
export function hexIsText(hex) {
  if (typeof hex !== 'string' || !hex.length || hex.length % 2) return false;
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if (!(b >= 0x20 && b <= 0x7e)) return false;
  }
  return true;
}
export function isPhotoId(s) { return typeof s === 'string' && PHOTO_ID.test(s) && !hexIsText(s); }
export function isSalt(s) { return typeof s === 'string' && SALT_RE.test(s) && !hexIsText(s); }
// The path both ends hash: the picture's place inside its source's folder (hidden_pictures.js pictureKey's rule:
// '/' separators, no leading './' or '/'), in Unicode NFC - a Mac and a Pi can spell "é" in two byte sequences, and
// the same picture must give the same id on both.
export function photoKey(path) {
  const raw = String(path == null ? '' : path).trim().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
  try { return raw.normalize('NFC'); } catch { return raw; }
}
/** The opaque id of a picture for one sharing session. '' for no path or a bad salt. PURE. */
export function photoPlayId(salt, path) {
  const key = photoKey(path);
  if (!key || !isSalt(salt)) return '';
  return sha256Hex(`${PHOTO_LABEL}\n${salt}\n${key}`).slice(0, PHOTO_ID_HEX);
}
/** A fresh salt (SALT_HEX hex). `rand` is the seam: () => an integer 0-255. */
export function newSalt(rand = defaultByte) {
  for (let tries = 0; tries < 64; tries++) {
    let s = '';
    for (let i = 0; i < SALT_HEX / 2; i++) s += (rand() & 255).toString(16).padStart(2, '0');
    if (isSalt(s)) return s;
  }
  return 'ff'.repeat(SALT_HEX / 2);                    // never reached with a real source of randomness
}
function defaultByte() {
  try { const a = new Uint8Array(1); globalThis.crypto.getRandomValues(a); return a[0]; }
  catch { return Math.floor(Math.random() * 256); }
}

// *** AN ITEM IS A PUBLIC ID OR AN OPAQUE ONE, NEVER A NAME. *** A YouTube video id is public already. A picture is a
// hash (above): fixed length, hex, and never printable text. A file name ("Mom hospital 2024.jpg") is neither.
export function isPlayItem(kind, item) {
  if (kind === 'youtube') return typeof item === 'string' && YT_ID.test(item);
  if (kind === 'photo') return isPhotoId(item);
  return false;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const bytes = (o) => { try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch { return Infinity; } };

/** The message a screen sends. Null when anything is wrong — and then nothing is sent. */
// `salt` (photos only): the sharing session's salt the id was made with; required with a photo id, refused otherwise.
export function buildPlay({ kind = 'youtube', item = null, pos = 0, playing = false, rate = 1, every = null, screen = '', salt = null } = {}) {
  if (!PLAY_KINDS.includes(kind)) return null;
  if (item !== null && !isPlayItem(kind, item)) return null;
  if (kind === 'photo' ? (item !== null && !isSalt(salt)) || (salt !== null && !isSalt(salt)) : salt !== null) return null;
  const p = finite(pos) ? Math.max(0, Math.min(MAX_POS_S, pos)) : 0;
  const r = finite(rate) && rate >= 0.25 && rate <= 2 ? rate : 1;
  const msg = { type: 'play', kind, item, pos: Math.round(p * 1000) / 1000, playing: item !== null && playing === true, rate: r };
  if (kind === 'photo' && salt !== null) msg.salt = salt;
  if (finite(every) && every >= 1 && every <= 60) msg.every = every;
  const name = String(screen || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_SCREEN_NAME);
  if (name) msg.screen = name;
  return bytes(msg) <= MAX_PLAY_BYTES ? msg : null;
}

/** A message a follower received. A clean copy, or null. It must carry the server's `at` and `from`. */
export function checkPlay(m) {
  if (!m || typeof m !== 'object' || m.type !== 'play') return null;
  if (bytes(m) > MAX_PLAY_BYTES + 128) return null;     // the server's stamp adds ~40 bytes to a capped message
  if (!PLAY_KINDS.includes(m.kind)) return null;
  if (m.item !== null && !isPlayItem(m.kind, m.item)) return null;
  if (m.kind === 'photo' && m.item !== null && !isSalt(m.salt)) return null;
  if (!finite(m.pos) || m.pos < 0 || m.pos > MAX_POS_S || typeof m.playing !== 'boolean') return null;
  if (!finite(m.at) || typeof m.from !== 'string' || !FROM_ID.test(m.from)) return null;
  const rate = finite(m.rate) && m.rate >= 0.25 && m.rate <= 2 ? m.rate : 1;
  const out = { kind: m.kind, item: m.item, pos: m.pos, playing: m.item !== null && m.playing, rate, at: m.at, from: m.from };
  if (m.kind === 'photo' && isSalt(m.salt)) out.salt = m.salt;
  if (finite(m.every)) out.every = m.every;
  if (typeof m.screen === 'string' && m.screen.trim()) out.screen = m.screen.trim().slice(0, MAX_SCREEN_NAME);
  return out;
}

// ---- the clock difference ----------------------------------------------------------------------------------------
// *** NTP'S OLDEST TRICK, AND WHY THE LOWEST-DELAY SAMPLE WINS. *** A ping leaves at `sent` (our clock), the server
// stamps `t` (its clock), the pong lands at `recv`. If the two halves of the trip took equally long, the server's
// clock read `t` at our `(sent + recv) / 2`, so offset = t - (sent + recv) / 2. The error is at most half the round
// trip, and a slow trip is usually slow on one side — so of the last WINDOW samples the one with the SHORTEST round
// trip is trusted. Eight, argued: at one ping every 30 s that is four minutes of history, long enough to ride out a
// burst of wifi trouble, short enough that a clock that steps (NTP correcting the Pi's) is followed within minutes.
export const CLOCK_WINDOW = 8;

export function createClock({ window = CLOCK_WINDOW } = {}) {
  let samples = [];
  let best = null;
  return {
    /** One round trip: `{ sent, t, recv }` (ms: ours, the server's, ours). Nonsense is ignored. */
    sample(s) {
      if (!s || !finite(s.sent) || !finite(s.t) || !finite(s.recv) || s.recv < s.sent) return false;
      const rtt = s.recv - s.sent;
      if (rtt > 30000) return false;                     // a pong half a minute late says nothing about clocks
      samples = [...samples, { rtt, offset: s.t - (s.sent + s.recv) / 2 }].slice(-Math.max(1, window));
      best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      return true;
    },
    ready: () => !!best,
    /** server clock minus ours, in ms (0 until a sample arrives: our own clock is the best guess there is). */
    offset: () => (best ? best.offset : 0),
    /** the best round trip seen, in ms (0 until a sample arrives). */
    rtt: () => (best ? best.rtt : 0),
    /** the server's clock now, from ours. */
    serverNow: (local) => local + (best ? best.offset : 0),
    samples: () => samples.length,
  };
}

// ---- where the screen is now, and what a follower does about it -------------------------------------------------
/** The screen's position NOW, in seconds: where it said it was, plus the time since, if it is playing. */
export function targetPos(leader, serverNowMs) {
  if (!leader) return null;
  if (!leader.playing) return leader.pos;
  const since = Math.max(0, (serverNowMs - leader.at) / 1000);
  return leader.pos + since * (finite(leader.rate) ? leader.rate : 1);
}

// *** CORRECT BY SEEKING, NOT BY NUDGING THE SPEED — FOR YOUTUBE. *** Argued:
//   * a speed nudge (play at 0.97-1.03 until caught up) is invisible and never jumps, and it is what the plan wants
//     for our OWN players (Archive, music files), which take any speed;
//   * YouTube's player offers speeds only in steps (0.25, 0.5, ..., 1, 1.25 ... 2 — getAvailablePlaybackRates), so
//     the smallest nudge is 25%: a voice audibly a quarter faster. That is worse than one jump;
//   * so for YouTube: seek, and seek rarely. A seek makes YouTube stall while it buffers, which is why the line is
//     not small. So `decide` has no speed branch at all; one is added with the first player that can take it.
//
// *** SEEK WHEN MORE THAN 2 SECONDS OUT. *** The plan's number. For it: a seek costs a buffering stall of about a
// second, so a smaller line seeks more often than it helps; 2 s apart is the gap two people hear as "a moment" and
// rarely as "a sentence". For less (1 s): in a call, two seconds is enough to react to something the other has not
// seen yet. For more (the old build's 4 s): fewer stalls on facility wifi. Not a menu setting: nobody can judge it
// from a menu (the plan's argument, and call_group.js's for its cap). A seam (`seekOverS`) for a test and a bench.
export const SEEK_OVER_S = 2;
// After a load or a seek, leave the player alone this long so it can buffer and start; a follower that judges a
// player mid-buffer seeks again, and again. 3 s: a YouTube load on a decent line starts in 1-2 s [measured on this
// desktop by dev/play_sync_test.html's timing]. It DOUBLES after each seek that did not land (a slow line), up to
// SETTLE_MAX_MS, so a struggling follower seeks every 30 s at worst instead of stalling itself for good.
export const SETTLE_MS = 3000;
export const SETTLE_MAX_MS = 30000;
// Where a seek aims ahead of the target, to cover the seek's own stall. 0: unmeasured on the bench Pi, and guessing
// wrong overshoots every time. A seam; the bench measurement is what would set it.
export const SEEK_LEAD_S = 0;
// *** ONE TIGHTENING SEEK AFTER A LOAD. *** Measured 2026-10-10, two headless Chrome windows on the desktop: a follower
// that LOADS a video part-way through lands about 0.53 s behind (the time the load takes to start), and with only the
// 2 s line it stayed 0.53 s behind for good; a SEEK inside a video that is already playing lands within about 0.09 s.
// So once, when a load has settled, the follower tightens to this line with one seek. 0.25 s, argued: under what two
// people hear as "together" when they laugh at the same moment, and well above the ~0.1 s a seek lands within, so the
// one seek is enough. Only once per load, so it can never turn into the stall loop the 2 s line exists to prevent.
export const FINE_AFTER_LOAD_S = 0.25;

/**
 * What a follower does now. PURE.
 *   leader: checkPlay's copy (or null: nothing heard yet)
 *   mine:   { item, pos (seconds or null when it cannot say), playing (true while playing or buffering) }
 *   serverNow: the server's clock now (createClock().serverNow)
 *   settling: true inside the settle window after a load or seek
 * Returns { do: 'none' | 'load' | 'seek' | 'play' | 'pause', to?, play? }.
 */
export function decide({ leader, mine, serverNow, settling = false, seekOverS = SEEK_OVER_S, seekLeadS = SEEK_LEAD_S,
  tighten = false, fineS = FINE_AFTER_LOAD_S } = {}) {
  if (!leader) return { do: 'none' };
  const m = mine || {};
  // photos in step: a SLIDESHOW showing nothing (its picture hidden or removed there, the panel closed or hidden) clears
  // the follower's picture too - a picture the screen took down must not stay up here. A video showing nothing is
  // paused instead, never blanked, exactly as before (the follower carries on with what it had).
  if (leader.item === null && leader.kind === 'photo') return m.item !== null && m.item !== undefined ? { do: 'load', to: 0, play: false } : { do: 'none' };
  if (leader.item === null) return m.playing ? { do: 'pause' } : { do: 'none' };
  const target = targetPos(leader, serverNow);
  const lead = leader.playing ? seekLeadS : 0;
  if (m.item !== leader.item) return { do: 'load', to: Math.max(0, target + lead), play: leader.playing };
  if (settling) return { do: 'none' };
  const gap = finite(m.pos) ? m.pos - target : null;
  // `tighten`: the one finer seek right after a load has settled (FINE_AFTER_LOAD_S), while both are playing.
  const line = tighten && leader.playing && m.playing ? Math.min(fineS, seekOverS) : seekOverS;
  const far = gap !== null && Math.abs(gap) > line;
  if (leader.playing && !m.playing) return far ? { do: 'seek', to: Math.max(0, target + lead), play: true } : { do: 'play' };
  if (!leader.playing && m.playing) return far ? { do: 'seek', to: Math.max(0, target), play: false } : { do: 'pause' };
  if (far) return { do: 'seek', to: Math.max(0, target + lead), play: leader.playing };
  return { do: 'none' };
}

// ---- the screen's settings (kiosk.js puts them on the screen's row) ---------------------------------------------
// *** MIKE RULED (2026-10-12): SEEING A SCREEN HAS ITS OWN LIST, "WHO MAY SEE THIS SCREEN", EMPTY TO START, AND THE
// SCREEN ASKS FIRST BY DEFAULT (server/screen_access.py). *** Until then this switch WAS the gate, off by default. Now
// the list is the gate - the server lets nobody follow who is not on it, and asks the screen first - so this switch is
// only a per-screen "never share from THIS screen", and it is ON by default. Argued: left off by default it would be a
// second gate the guardian set does not open - a family given the set would still see nothing until somebody also
// found this switch, which is exactly the screen where nobody can (the guardian set exists for the screen where nobody
// can answer "ask first"). Who wants it off? One screen of a person in a shared room (a day room) while their bedside
// screen shares: they turn it off on that screen. A screen where somebody already chose (true or false) keeps it.
export const FOLLOW_KEY = 'letFollow';
export const FOLLOW_DEFAULT = true;
export const FOLLOW_FIELD = Object.freeze({
  key: FOLLOW_KEY,
  label: 'Let people follow what this screen is playing',
  kind: 'toggle',
  // `standard`: set once by whoever sets the screen up, like "Pick up new versions by itself" beside it.
  level: 'standard',
  default: FOLLOW_DEFAULT,
  onLabel: 'Yes, people on “Who may see this screen”',
  offLabel: 'No, never from this screen',
  // photos in step (2026-10-12): the note says pictures too, and how a picture is named on the way (a code, never its name).
  note: 'People on “Who may see this screen” (on the Remote page) can play the same YouTube video, or see the same '
    + 'picture from their own copy of the pictures, on their own computer at the same moment. By default the screen '
    + 'asks first each time. Only which video or picture (a picture as a code, never its name) and where it has got '
    + 'to is sent, never the picture or the sound, and nothing is kept. While anyone sees it, the screen says '
    + '“Sharing your screen with” their name.',
});

// *** WHEN MORE THAN ONE THING PLAYS, WHICH ONE PEOPLE FOLLOWING SEE (photos in step, 2026-10-12). *** A screen with a
// video panel AND a Photos panel. The sender shares ONE panel at a time (as before), and this picks it. Two shapes were
// possible, argued:
//   * THE SCREEN MARKS ONE AS MAIN (chosen): one stream leaves the screen, so a follow page needs no extra control and
//     the traffic stays one small message every couple of seconds. AGAINST: somebody following a video who would rather
//     see the pictures cannot choose that from their own end.
//   * THE FOLLOW PAGE CHOOSES: the screen sends every panel and the follower picks. AGAINST: more of the screen leaves
//     the room than anybody is looking at, each panel's heartbeat doubles the traffic, and a follow page gains a choice
//     that has to be explained. Not built; it is one row on Mike's list if he wants it.
// The default: 'video' - A VIDEO WHILE ONE IS PLAYING (OR PAUSED FOR LESS THAN PAUSED_HOLD_MS), OTHERWISE THE PICTURES.
//   FOR: a video is chosen on purpose and has sound - when one is on, it is what the room is watching; the slideshow runs
//   all day behind everything, so 'photos' as the default would make following a video impossible on any screen that
//   also has a slideshow, and the pictures are still what a follower sees for most of the day. AGAINST: pictures are
//   what matters most on a bedside screen, and somebody who wants them followed even while a video plays sets 'photos'.
// 'latest' is the rule this had before pictures existed: whichever started playing most recently, kept until it stops.
// `advanced` (shown at "Everything"): set once, rarely, by whoever sets the screen up.
export const FOLLOW_MAIN_KEY = 'followMain';
export const FOLLOW_MAIN_DEFAULT = 'video';
export const FOLLOW_MAIN_FIELD = Object.freeze({
  key: FOLLOW_MAIN_KEY,
  label: 'When more than one thing plays, people following see',
  kind: 'choice',
  level: 'advanced',
  default: FOLLOW_MAIN_DEFAULT,
  options: [
    { value: 'video', label: 'the video while one is on, otherwise the pictures' },
    { value: 'photos', label: 'the pictures while a slideshow is on' },
    { value: 'latest', label: 'whatever started playing last' },
  ],
});
export function mainOf(row) {
  const v = row && row[FOLLOW_MAIN_KEY];
  return FOLLOW_MAIN_FIELD.options.some((o) => o.value === v) ? v : FOLLOW_MAIN_DEFAULT;
}
// *** A PAUSED VIDEO STAYS "THE VIDEO" FOR 5 MINUTES. *** Under 'video', a pause to talk about something should not flip
// everybody following over to the pictures and back on Play. Five minutes, argued: a pause to talk, answer the door or
// find a moment again is minutes; a video left paused (or ended) for longer is no longer what anybody is watching, and
// the slideshow is. Not a menu setting: nobody can judge it from a menu. A seam (`pausedHoldMs`) for the suite.
export const PAUSED_HOLD_MS = 5 * 60 * 1000;
export function followOf(row) {
  const v = row && row[FOLLOW_KEY];
  return typeof v === 'boolean' ? v : FOLLOW_DEFAULT;
}

// *** HOW OFTEN THE SCREEN SAYS WHERE IT IS: EVERY 2 SECONDS (plus at once on every change). *** The plan's number,
// proven on the old bedside build. For it: somebody who starts following waits at most this long for a picture (in
// practice not at all — the screen sends the moment a follower arrives), and it is what tells a follower the screen
// is still there. For 5 or 10: less traffic on a metered line, though at ~150 bytes a message 2 s is under 300 KB an
// hour. A setting because the line is the household's; `advanced` because almost nobody should need it.
export const FOLLOW_BEAT_KEY = 'followBeatS';
export const FOLLOW_BEAT_DEFAULT = 2;
export const FOLLOW_BEAT_FIELD = Object.freeze({
  key: FOLLOW_BEAT_KEY,
  label: 'While somebody follows, say where the video is every',
  kind: 'choice',
  level: 'advanced',
  default: FOLLOW_BEAT_DEFAULT,
  options: [
    { value: 2, label: '2 seconds' },
    { value: 5, label: '5 seconds' },
    { value: 10, label: '10 seconds' },
  ],
});
export function beatOf(row) {
  const v = Number(row && row[FOLLOW_BEAT_KEY]);
  return FOLLOW_BEAT_FIELD.options.some((o) => o.value === v) ? v : FOLLOW_BEAT_DEFAULT;
}

// ---- the screen's notice ------------------------------------------------------------------------------------------
// *** THE SCREEN SAYS SO, AND SAYS WHAT IS HAPPENING. *** Mike's 2026-08-26 consent rule (kiosk.js): somebody driving
// this screen from elsewhere is shown to whoever is in front of it — not a setting, not hideable. Watching along is
// the same kind of thing, so it is shown the same way, by the same notice. But the plan's point stands: "Someone is
// helping" is the wrong sentence for somebody who is only watching, and wrong words on a consent notice are a broken
// promise of their own. So the words follow the counts. Best guess at the wording, for Mike (plan question 7).
// A following socket can ONLY watch (the server drops its presses), so "watching" can never hide "helping".
// Never a state that needs an input to leave: it is a line of text, not a dialog, and it goes when they do.
//
// *** THE WORDS ARE MIKE'S (2026-10-12): "Sharing your screen with ...", NAMING THE PERSON WHERE IT IS KNOWN. *** The
// names come from the server (`watchers` on presence): the name the owner gave them on "Who may see this screen", or
// their own display name. A follower with neither is "someone". Shown for a guardian too - the guardian set skips the
// question, never the notice.
export const HELPING_WORDS = 'Someone is helping from another screen';
export const SHARING_PREFIX = 'Sharing your screen with ';
export const WATCHING_WORDS = 'Sharing your screen with someone on another screen';
export const BOTH_WORDS = 'Sharing your screen with someone on another screen. Someone is also helping from another screen';
const MAX_NAMED = 3;
/** "Mike", "Mike and Ann", "Mike, Ann and Jo", "Mike and 2 others", "someone on another screen". Pure. */
export function sharingWords(names = [], count = 0) {
  const known = [...new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()))];
  const n = Math.max(count | 0, known.length);
  if (!n) return '';
  if (!known.length) return n === 1 ? WATCHING_WORDS : `${SHARING_PREFIX}${n} people on other screens`;
  const shown = known.slice(0, MAX_NAMED);
  const rest = n - shown.length;
  let who;
  if (rest > 0) who = `${shown.join(', ')} and ${rest === 1 ? '1 other' : `${rest} others`}`;
  else if (shown.length === 1) who = shown[0];
  else who = `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `${SHARING_PREFIX}${who}`;
}
/** The notice's words for a presence count (and the names, when the server sent them), or '' for no notice. */
export function noticeWords({ drivers = 0, followers = 0, watchers = [] } = {}) {
  const f = Math.max(0, followers | 0);
  const helping = Math.max(0, (drivers | 0) - f);
  const sharing = f ? sharingWords(watchers, f) : '';
  if (helping && sharing) return `${sharing}. Someone is also helping from another screen`;
  if (helping) return HELPING_WORDS;
  return sharing;
}

// ---- the screen's half: the sender -------------------------------------------------------------------------------
// Changes go at once, but never closer together than this: a person scrubbing through a video makes a burst of
// BUFFERING/PLAYING reports, and the last one is the one that matters. 250 ms keeps a burst to four a second, inside
// the server's limit (play_relay.py: two a second, bursts of ten).
export const MIN_GAP_MS = 250;
// A panel's progress report that lands this far from where the sender expected is a SEEK (somebody dragged the
// player's own bar, which the YouTube player reports as no event at all). 1.5 s: a progress poll runs every 5 s and
// a healthy video drifts from the wall clock by far less than that; a deliberate drag is many seconds.
export const SEEK_DETECT_S = 1.5;
// How often the sender re-measures its round trip while somebody follows (for `pos`, which is sent as of the moment
// the server receives it: half a round trip ahead). Thirty seconds: the trip barely changes, and a ping is ~50 bytes.
export const PING_EVERY_MS = 30000;

export function createPlaySender({
  send,                               // (msg) => bool — the drive socket's sendPlay
  enabled = () => false,              // the screen's "Let people follow" switch
  watchers = () => 0,                 // how many are following (the server's presence count)
  beatS = () => FOLLOW_BEAT_DEFAULT,
  screenName = () => '',
  main = () => FOLLOW_MAIN_DEFAULT,   // photos in step: which panel when more than one plays (FOLLOW_MAIN_FIELD)
  ping = null,                        // () => Promise<{sent, t, recv} | null> — the drive socket's ping
  clock = createClock(),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  minGapMs = MIN_GAP_MS,
  pausedHoldMs = PAUSED_HOLD_MS,
  makeSalt = () => newSalt(),         // photos in step: a fresh salt for each sharing session (the suites pin it)
} = {}) {
  // EVERY PANEL'S LAST REPORT, kept in this screen's memory only: panel -> { kind, ident, pos, playing, rate, t, since }.
  // `ident` is what the panel is on: a YouTube id, or (photos in step) a picture's PATH - which never leaves this
  // screen: it is hashed with the session's salt as the message is built (`sendNow`), and only the hash goes.
  const panels = new Map();
  let lead = null;                    // the panel being shared (one at a time)
  let base = null;                    // panels.get(lead)
  let lastKind = 'youtube';           // the kind of the last thing shared, for a "nothing playing" message
  let salt = null;                    // photos in step: this sharing session's salt (made when it goes live)
  let beatTimer = null, gapTimer = null, pingTimer = null;
  let lastSent = -Infinity;
  let sentCount = 0;
  let live = false;
  let destroyed = false;

  const active = () => !destroyed && !!enabled() && (watchers() | 0) > 0;

  function posOf(b) {
    if (!b) return 0;
    const since = Math.max(0, (now() - b.t) / 1000);
    return b.playing ? b.pos + since * (b.rate || 1) : b.pos;
  }
  const posNow = () => posOf(base);

  // *** WHICH PANEL IS SHARED. *** First the screen's FOLLOW_MAIN_FIELD narrows the panels with something on to the
  // kind it prefers (when any is on); then, among those, the one already shared stays shared unless it has stopped and
  // another is playing - the rule this had from the start, so two video panels behave exactly as before.
  function chooseLead(prev) {
    const on = [...panels.entries()].filter(([, b]) => b.ident !== null);
    if (!on.length) return prev !== null && panels.has(prev) ? prev : null;
    let pool = on;
    const mode = (() => { try { return main(); } catch { return FOLLOW_MAIN_DEFAULT; } })();
    if (mode === 'video') {
      const vids = on.filter(([, b]) => b.kind === 'youtube' && (b.playing || now() - b.since < pausedHoldMs));
      const pics = on.filter(([, b]) => b.kind === 'photo');
      if (vids.length) pool = vids; else if (pics.length) pool = pics;
    } else if (mode === 'photos') {
      const pics = on.filter(([, b]) => b.kind === 'photo');
      if (pics.length) pool = pics;
    }
    const playing = pool.filter(([, b]) => b.playing);
    const kept = pool.find(([p]) => p === prev);
    if (kept && (kept[1].playing || !playing.length)) return prev;
    const from = playing.length ? playing : pool;
    return from.reduce((a, b) => (b[1].since > a[1].since ? b : a))[0];
  }

  // Re-decide the shared panel; true when it changed.
  function relead() {
    const prev = lead;
    lead = chooseLead(prev);
    base = lead !== null ? panels.get(lead) || null : null;
    if (base) lastKind = base.kind;
    return lead !== prev;
  }

  function sendNow() {
    if (gapTimer != null) { clearTimer(gapTimer); gapTimer = null; }
    if (!active()) return false;
    relead();                         // a paused video's hold (PAUSED_HOLD_MS) runs out on a heartbeat, not a report
    // `pos` as of the moment the server stamps it: half the round trip ahead, if it is playing.
    const ahead = base && base.playing ? clock.rtt() / 2000 : 0;
    const kind = base ? base.kind : lastKind;
    let item = base ? base.ident : null;
    let s = null;
    if (kind === 'photo') {
      // photos in step: the path becomes the session's opaque id HERE, and only here. No salt, or a path that will not
      // hash, is "nothing to follow" - never the path.
      if (!isSalt(salt)) salt = makeSalt();
      s = isSalt(salt) ? salt : null;
      item = item !== null && s ? (photoPlayId(s, item) || null) : null;
      if (item === null) s = null;
    }
    const msg = buildPlay({
      kind, item, pos: posNow() + ahead, salt: s,
      playing: !!(base && base.playing) && item !== null, rate: (base && base.rate) || 1, every: beatS(), screen: screenName(),
    });
    if (!msg) return false;
    let ok = false;
    try { ok = !!send?.(msg); } catch { ok = false; }
    lastSent = now();
    if (ok) sentCount += 1;
    return ok;
  }

  function sendSoon() {
    if (!active()) return;
    const wait = lastSent + minGapMs - now();
    if (wait <= 0) { sendNow(); restartBeat(); return; }
    if (gapTimer == null) gapTimer = setTimer(() => { gapTimer = null; sendNow(); restartBeat(); }, wait);
  }

  function restartBeat() {
    if (beatTimer != null) { clearTimer(beatTimer); beatTimer = null; }
    if (!active()) return;
    beatTimer = setTimer(() => { beatTimer = null; sendNow(); restartBeat(); }, Math.max(1, beatS()) * 1000);
  }

  function pingOnce() {
    if (!ping || !active()) return;
    Promise.resolve().then(() => ping()).then((s) => { if (s) clock.sample(s); }).catch(() => {});
  }
  function restartPing() {
    if (pingTimer != null) { clearTimer(pingTimer); pingTimer = null; }
    if (!ping || !active()) return;
    pingTimer = setTimer(() => { pingTimer = null; pingOnce(); restartPing(); }, PING_EVERY_MS);
  }

  // What a panel's report names. YouTube: a public id, or nothing. Photos (photos in step): `key`, the picture's path
  // inside its source's folder - kept here, hashed only on the way out. Anything else is "nothing".
  function identOf(kind, r) {
    if (kind === 'photo') {
      const k = typeof r.key === 'string' ? photoKey(r.key) : '';
      return k && k.length <= 500 ? k : null;
    }
    return isPlayItem(kind, r.item) ? r.item : null;
  }

  /** A panel's report (PLAY_NOW_TOPIC): `{ kind: 'youtube', panel, item, pos, playing, rate }`, or for a Photos panel
   *  `{ kind: 'photo', panel, key, pos, playing }` (`key` the picture's path inside its source; null for nothing). */
  function report(r) {
    if (destroyed || !r || typeof r !== 'object') return;
    const kind = PLAY_KINDS.includes(r.kind) ? r.kind : null;
    if (!kind) return;
    const ident = identOf(kind, r);
    const panel = String(r.panel || kind);
    const playing = ident !== null && r.playing === true;
    const was = panels.get(panel) || null;
    const expected = posOf(was);
    const same = !!was && was.kind === kind && was.ident === ident;
    const pos = finite(r.pos) ? Math.max(0, r.pos) : (same ? expected : 0);
    const t = now();
    const since = same && was.playing === playing ? was.since : t;
    panels.set(panel, { kind, ident, pos, playing, rate: finite(r.rate) ? r.rate : 1, t, since });
    const moved = relead();
    const changed = moved || (lead === panel && (!same || was.playing !== playing || Math.abs(pos - expected) > SEEK_DETECT_S));
    if (changed) sendSoon();
  }

  /** Something about whether to share changed: the switch, or how many are following. Safe to call often: the
   *  kiosk calls it on every presence message and every settings notice, and a heartbeat restarted on each of
   *  those would never get to beat (measured: the first two-tab run sent two messages in two minutes). */
  let beatWas = null;
  let mainWas = null;
  function refresh() {
    const on = active();
    if (on && !live) {
      // A NEW SHARING SESSION: a new salt (photos in step - ids from two sessions cannot be matched).
      live = true; salt = makeSalt(); beatWas = beatS(); mainWas = safeMain();
      pingOnce(); restartPing(); sendNow(); restartBeat(); return;
    }
    if (!on && live) {
      live = false;
      for (const t of [beatTimer, gapTimer, pingTimer]) if (t != null) clearTimer(t);
      beatTimer = gapTimer = pingTimer = null;
      return;
    }
    if (on && beatS() !== beatWas) { beatWas = beatS(); restartBeat(); }   // only when the setting itself changed
    if (on && safeMain() !== mainWas) { mainWas = safeMain(); if (relead()) sendSoon(); }
  }
  function safeMain() { try { return main(); } catch { return FOLLOW_MAIN_DEFAULT; } }

  /** A panel went away: it is no longer shared; another panel with something on may be. */
  function forget(panel) {
    const p = String(panel);
    if (!panels.has(p)) return;
    panels.delete(p);
    if (lead !== p) return;
    lead = null; base = null;
    relead();
    sendSoon();
  }

  return {
    report, refresh, forget,
    sendNow,
    active,
    state: () => ({ lead, base: base ? { ...base, item: base.ident } : null, sent: sentCount, live, salt,
      panels: panels.size }),
    clock: () => clock,
    destroy() {
      destroyed = true;
      for (const t of [beatTimer, gapTimer, pingTimer]) if (t != null) clearTimer(t);
      beatTimer = gapTimer = pingTimer = null;
    },
  };
}

// ---- the follower's half -------------------------------------------------------------------------------------------
// *** A FOLLOWER NEVER GOES BLANK BECAUSE THE SCREEN WENT QUIET. *** The plan's risk, and the "what if nobody answers"
// test: when messages stop, the follower stops CORRECTING and its own player carries on with what it had. The page
// says so after LOST_MIN_MS (or three of the screen's heartbeats, whichever is longer) and stops following by itself
// after the page's "Stop following after" setting (follow_view.js). Ten seconds, the plan's number: five missed
// heartbeats at the default, so one dropped packet on facility wifi never flaps it.
export const LOST_MIN_MS = 10000;

export function createFollower({
  player,                             // { load(id, pos, play, kind, leader), seek(pos, play), play(), pause(), item(), currentTime(), playing() }
  clock = createClock(),
  now = () => Date.now(),
  seekOverS = SEEK_OVER_S,
  seekLeadS = SEEK_LEAD_S,
  settleMs = SETTLE_MS,
  settleMaxMs = SETTLE_MAX_MS,
  lostMinMs = LOST_MIN_MS,
  fineS = FINE_AFTER_LOAD_S,
} = {}) {
  let leader = null;
  let tightenPending = false;         // a load happened: one finer seek is allowed once it settles
  let pinned = null;                  // which screen (`from`) is followed; null = the first that speaks
  const screens = new Map();          // from -> { screen, heard }
  let heard = -Infinity;
  let settleUntil = -Infinity;
  let misses = 0;                     // seeks in a row that did not land: the settle window doubles each time
  let last = { do: 'none' };
  let seeks = 0, loads = 0;

  function mine() {
    let pos = null, item = null, playing = false;
    try { item = player?.item?.() ?? null; } catch { item = null; }
    // null means "cannot say" (a still picture; a player not ready yet) - Number(null) is 0, which read as "at the very
    // start" and made the follower seek a still picture on every look (found adding photos in step, 2026-10-12).
    try { const raw = player?.currentTime?.(); const t = raw == null ? NaN : Number(raw); pos = Number.isFinite(t) ? t : null; } catch { pos = null; }
    try { playing = !!player?.playing?.(); } catch { playing = false; }
    return { item, pos, playing };
  }

  function lostMs() {
    const every = leader && finite(leader.every) ? leader.every * 1000 * 3 : 0;
    return Math.max(lostMinMs, every);
  }

  return {
    /** A message from the socket. Returns true when it is the screen being followed. */
    onPlay(raw) {
      const m = checkPlay(raw);
      if (!m) return false;
      screens.set(m.from, { screen: m.screen || '', heard: now() });
      if (pinned === null) pinned = m.from;
      if (m.from !== pinned) return false;
      leader = m;
      heard = now();
      return true;
    },
    /** Follow a different screen of the same person (or null: the next to speak). */
    pick(from) { pinned = from || null; leader = null; heard = -Infinity; misses = 0; settleUntil = -Infinity; },
    /** One step: look at the player and the screen, and act. Returns what it did. */
    tick() {
      const t = now();
      if (!leader || t - heard > lostMs()) { last = { do: 'none' }; return last; }
      const me = mine();
      const settling = t < settleUntil;
      const tight = tightenPending && !settling && me.item === leader.item;
      const d = decide({ leader, mine: me, serverNow: clock.serverNow(t), settling, seekOverS, seekLeadS, tighten: tight, fineS });
      if (tight) tightenPending = false;                  // the one chance, taken or not needed
      try {
        if (d.do === 'load') {
          // photos in step: the kind and the message go too, so one player can show a video or a picture (follow_view.js);
          // a player that knows only videos ignores them.
          player.load(leader.item, d.to, d.play, leader.kind, leader); loads += 1; settleUntil = t + settleMs; misses = 0; tightenPending = true;
        } else if (d.do === 'seek') {
          player.seek(d.to, d.play); seeks += 1;
          if (tight) settleUntil = t + settleMs;          // the tightening seek is not a miss
          else { settleUntil = t + Math.min(settleMaxMs, settleMs * (2 ** misses)); misses += 1; }
        } else if (d.do === 'play') {
          // A RESUME LANDS LATE TOO, like a load (measured 2026-10-12, two headless windows: a YouTube follower carrying
          // on in place after the screen's Play sat ~0.29 s behind for good). So a resume earns the same one finer seek
          // once it has settled. (Before 2026-10-12 this call threw - the YouTube player has no play() - and the
          // follower only caught up through a seek once it was 2 s behind; follow_view.js now resumes it.)
          player.play(); settleUntil = t + settleMs; tightenPending = true;
        }
        else if (d.do === 'pause') player.pause();
        else if (t >= settleUntil) misses = 0;           // in step: a later seek starts from the short wait again
      } catch (err) { console.error('play_sync: follower', err); }
      last = d;
      return d;
    },
    /** 'waiting' (nothing heard yet) | 'following' | 'lost' (the screen went quiet). */
    status() {
      if (!leader) return 'waiting';
      return now() - heard > lostMs() ? 'lost' : 'following';
    },
    /** How long since the followed screen last spoke, in ms (Infinity before it ever has). */
    quietMs: () => now() - heard,
    /** The gap right now, in seconds (mine minus the screen's), or null. */
    gap() {
      if (!leader) return null;
      const me = mine();
      if (me.item !== leader.item || !finite(me.pos)) return null;
      return me.pos - targetPos(leader, clock.serverNow(now()));
    },
    leader: () => (leader ? { ...leader } : null),
    pinned: () => pinned,
    screens: () => [...screens.entries()].map(([from, v]) => ({ from, ...v })),
    last: () => ({ ...last }),
    counts: () => ({ seeks, loads }),
    clock: () => clock,
  };
}

// ---- the follow page's own setting ---------------------------------------------------------------------------------
// *** HOW LONG A FOLLOW PAGE WAITS FOR A SCREEN THAT WENT QUIET BEFORE IT STOPS FOLLOWING BY ITSELF. *** One minute
// by default. Argued: the screen sends every 2 s, so a minute of silence is the screen switched off, asleep, its
// sharing turned off, or the network gone — not a blip. Stopping then means the screen's "watching along" notice
// goes too, rather than saying somebody is watching a screen that is no longer showing them anything. For longer:
// somebody whose facility wifi drops for minutes at a time. For shorter: the notice clears sooner. A choice on the
// page, remembered on that computer only.
export const STOP_AFTER_KEY = 'nimrod:follow-stop-after';
export const STOP_AFTER_DEFAULT_MS = 60000;
export const STOP_AFTER_CHOICES = Object.freeze([
  { ms: 30000, label: '30 seconds' },
  { ms: 60000, label: 'a minute' },
  { ms: 300000, label: '5 minutes' },
  { ms: 0, label: 'never (keep waiting)' },
]);
export function stopAfterOf(v) {
  // Nothing stored is the default, not 0 ("never"): Number(null) and Number('') are both 0.
  if (v == null || (typeof v === 'string' && !v.trim())) return STOP_AFTER_DEFAULT_MS;
  const n = Number(v);
  return STOP_AFTER_CHOICES.some((c) => c.ms === n) ? n : STOP_AFTER_DEFAULT_MS;
}
