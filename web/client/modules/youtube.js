// YouTube — the last of the four default modules (slice 3d).
//
// A weighted-shuffle player over a user's OWN playlist of PUBLIC video refs:
//   config.playlist [{id, channel, title, durationSec}]  ->  ids/channels/durations
//   advance  ->  shared weighted picker (rng.js)  ->  load in the player  ->  play event
//
// It is photos' twin, and deliberately shares its spine:
//   * the SAME shared picker (rng.js) — freshness × recency × duration × channel-
//     diversity — so long runs of one channel are broken up and shorter videos come
//     round more often. `channel` is the diversity axis; `durationSec` feeds duration.
//   * play history is APPEND-ONLY events; the picker's stats DERIVE from them
//     (statsFromEvents) — no mutable store of record.
//   * inputs are interchangeable via the bus: sinks on `youtube/next` / `youtube/prev`
//     fed by its own buttons AND by the video ending AND by any other source.
//
// WHY NO MEDIA AGENT (unlike photos): a YouTube video is a PUBLIC ref, not the
// user's private bytes — safe to keep in overwrite state and to embed straight from
// youtube-nocookie. So there is no BYO-storage half here; the playlist IS the source.
//
// THE PLAYER IS A SEAM. The module core (playlist → picker → advance → log) never
// touches YouTube directly; it drives a small player adapter
// { load(id), stop(), destroy() } created by `ctx.playerFactory` (default: the
// youtube-nocookie IFrame adapter below). Tests inject a stub adapter, so the real
// module is validated deterministically offline — the same way photos separated
// rendering. It also leaves room for other back-ends (local video, Vimeo) later.

import { registerModule } from '../module.js';
import { MUSIC_GROUP, VIDEO_PRIORITY } from '../audio_bus.js';
import { createWatchdog } from '../watchdog.js';
import { pageActivity, RECENT_MS } from '../activity.js';
import { pick, statsFromEvents } from '../rng.js';
import { createHeldSignal } from '../held.js';
import { createPresetLibrary } from '../presets.js';
import { flashLimit, failureBackoffMs } from '../flash_limit.js';

// `stallMs` is the STOPPED-VIDEO WATCHDOG (see the header). 20s is long enough that a
// slow-but-working load on facility wifi isn't cut off, short enough that nobody sits in
// front of a frozen screen for long.
//
// ONE NUMBER COVERS BOTH LOADING FAILURES — a load that never starts and a video that stops
// without anybody touching it. It is also the interval the progress heartbeat has to beat
// inside. `heldNotifyMs` is the separate, and very different, question below.
const DEFAULTS = {
  playlist: [],            // explicit video refs {id, channel, title, durationSec}
  playlistId: '',          // a YouTube playlist to draw from instead of / as well as the above
  schedule: [],            // [{name, start, playlistId}] — time-of-day playlists
  // *** PRESETS (register #255). *** Empty means "this instance's own playlist/schedule/
  // shuffle, exactly as before" — see presets.js's header for the full argument on why this
  // is a per-PERSON library rather than per-profile or per-account, and the `effective*`
  // helpers below for how a set presetId overrides the three fields it names, and ONLY them.
  presetId: '',
  graceMin: 10,            // a nearly-finished video may run this long past a daypart boundary
  shuffle: true,           // weighted-random pick (the default); off = straight playlist order
  autoAdvance: true,
  directed: false,
  stallMs: 20000,
  // *** SOMEBODY PRESSED PAUSE. DO WE EVER RESTART IT BY OURSELVES? ***
  //
  // No. It stays paused — Mike's call, 2026-08-30. This number is how long the hold runs
  // before the people around this person are told about it. 0 = hold silently, no clock.
  // See the SETTINGS declaration below, and the note on `onRetry`.
  //
  // *** THE KEY WAS RENAMED FROM `heldPauseMs`, AND THE RENAME IS THE POINT. ***
  // That key meant "start it again after N". This one means "tell somebody after N" — the
  // same number with the opposite consequence. Reusing the key would have silently turned
  // one family's "resume after 15 minutes" into "tell people after 15 minutes." The repo
  // rule for a changed unit (AGENTS.md) applies just as well to a changed meaning: rename
  // the key, so an un-migrated value reads as ABSENT and picks up the new default.
  heldNotifyMs: 21600000,        // six hours
  // *** THE VIDEO'S OWN VOLUME, IN PERCENT (row 2.28). *** 100 is exactly what every screen did
  // before this existed: the player at full, with the speaker arbiter's duck on top. See the
  // VOLUME note in SETTINGS for why it is this panel's and not a screen-wide master.
  volume: 100,
  volumeStep: 20,
};

// The quietest a "quieter" can make it. See the VOLUME note below for why it is not zero.
export const VOLUME_MIN = 10;
const RECENT_CAP = 12;          // in-memory anti-repeat window (picker also hard-excludes)

// How often a playing video is asked where it has got to. NOT a setting: nobody is served by
// tuning it, and the only requirement is that it sits comfortably inside `stallMs` so a
// healthy video always beats before the clock runs out. Overridable from ctx for tests.
const PROGRESS_MS = 5000;

// *** A PAUSE STAYS A PAUSE. THE ONLY QUESTION IS WHEN SOMEBODY IS TOLD. ***
//
// The history matters here, because this setting has now been wrong in two opposite
// directions and both were instructive.
//
// It started at four hours of "then start it again", and Mike called it: *"This seems like
// something that could cause more problems than it solves."* The reason is in `activity.js` —
// THE SOFTWARE CANNOT TELL WHETHER ANYBODY IS IN THE ROOM. A click inside the YouTube player
// is invisible to this page, so an auto-resume is a GUESS, and a guess that fires during a
// visit interrupts the family it was written to protect. So it was defaulted to 0, meaning
// never resume.
//
// *** AND 0 ALSO MEANT NEVER TELL ANYBODY, WHICH IS THE HALF THAT WAS WRONG. ***
// The design had a hold with a clock on it. The default disabled the clock, so a screen that
// somebody paused and forgot sat dark until the next visit, and nothing anywhere knew.
//
// Mike's decision, 2026-08-30: **six hours, and it is not resumed.** Long enough that
// somebody visiting for an afternoon is never interrupted; short enough that a screen paused
// and forgotten does not stay dark overnight.
//
// *** HOW THIS SITS WITH THE SAFETY INVARIANT, because it looks like a violation and is not.
// AGENTS.md: a screen must never enter a state that only an input can leave, when the person
// in front of it cannot give that input. A held pause IS such a state. What that file names
// as the ways out are "a countdown that expires, a watchdog that moves on, SOMEBODY ELSE IN
// THE ROOM" — and this is the third one. The escape from a held pause is a person, and the
// notification is what fetches them. The screen also says PAUSED throughout, so an aide
// walking in can tell it from a crash without asking anybody.
//
// *** THE PART THAT IS NOT BUILT, AND MUST NOT BE READ AS BUILT. *** `output.notify` hands
// the message to the person's own routing. From the kiosk today that reaches a tone, and
// nothing else: no remote channel is wired there and there is no cross-person route at all
// (there is no guardian concept — see web/server/links.py). So the durable half is the
// append-only event this also writes. Recorded in docs/for_chat/ as an open decision.
//
// Declared as data so the shell can render it and a one-button cursor can reach it — see
// settings_fields.js for why markup would not do. A CHOICE, NOT A NUMBER, for the reason
// photos' interval is: with one switch you travel one way, one press at a time, so the number
// of stops IS the cost.
export const SETTINGS = [
  // ADVANCED, which is exactly where Mike said to put things that would otherwise clutter. It
  // is also the honest level for it: a Google Cloud API key is not something a caregiver has
  // lying around, and search is the only thing that uses it — everything else in this module
  // works without one.
  { key: 'apiKey', label: 'YouTube API key (for searching)', kind: 'text', default: '',
    level: 'advanced', secret: true,
    note: 'Only needed to search from this panel. Get one from Google Cloud, and restrict it '
      + 'to this site. Searching sends what you type to Google; nothing else here does.' },
  { key: 'heldNotifyMs', label: 'If someone pauses it, let people know after', kind: 'choice',
    default: 21600000, level: 'standard',
    options: [
      { value: 0, label: 'never — just leave it paused' },
      { value: 3600000, label: 'after 1 hour' },
      { value: 21600000, label: 'after 6 hours' },
      { value: 43200000, label: 'after 12 hours' },
    ] },
  // `presetId` is a LIVE choice, the same pattern `photos.js`'s `sourceId` already uses: the
  // options are this PERSON's saved YouTube presets, which are data and cannot be written into
  // a manifest — see `settingsChoices` below. Reachable and cycleable through the exact same
  // one-button/input-bus menu `sourceId` already is, so "switching preset is a verb" (register
  // #255) needs no new bus wiring here: this menu is already switch- and input-bus-operable.
  { key: 'presetId', label: 'Use a saved preset', kind: 'choice', default: '', level: 'standard',
    emptyLabel: 'No preset — this instance’s own playlist, schedule and shuffle' },
  // *** VOLUME (row 2.28: "volume up, volume down ... mostly for Youtube right now"). ***
  //
  // *** THIS IS THE VIDEO'S OWN LEVEL, AND IT IS NO LONGER WHAT "LOUDER" MOVES. *** The first
  // cut (0024a29) pointed the spoken "louder"/"quieter" here, because the audio bus had no
  // master. Mike ruled 2026-09-30 (row 2.28 call 4) that they move the bus's MASTER instead, and
  // `audio_bus.js` now has one (read by the speech channel too, so the voice follows it). So
  // this setting is a per-source level - "this video a bit quieter than everything else" - the
  // way `pressgame`'s "How loud the music is" is for its music, and the `youtube/volume` topic
  // still steps it for anything that publishes it directly. Row 2.35's mixer is where per-channel
  // faders go; this stays until then.
  //
  // IT MULTIPLIES WITH THE ARBITER, never replaces it: the level the bus hands this panel
  // already includes the master and any duck, so a ducked video stays ducked and nothing here
  // can un-silence a video the arbiter silenced for a call.
  //
  // *** THE FLOOR IS 10%, NOT SILENCE. *** A "quieter" that can reach zero leaves a video
  // playing with no sound, which to the next person in the room looks exactly like broken
  // audio. Making it silent is a different act with its own control (Hush on the bar, pause
  // here). The person who wants the opposite - true mute by voice - is served by "pause" today.
  // A NUMBER, not a choice, so a step of 25 landing on 35% is a value the row can show; bounded,
  // so a switch can walk it.
  { key: 'volume', label: 'How loud the video is', kind: 'number', default: 100,
    min: VOLUME_MIN, max: 100, step: 10, unit: '%', level: 'standard' },
  // *** HOW FAR ONE STEP OF THIS VIDEO'S OWN VOLUME GOES (a `youtube/volume` publish). The spoken
  // "louder" now steps the master, whose step is the screen's `masterStep` (master_volume.js),
  // same default for the same reason: *** A setting rather than a buried number (Rule 1). Default a
  // fifth of the range, because every spoken step costs a whole sentence ("computer please,
  // louder"): a step small enough that nobody can hear it is a command that seems not to work,
  // and five steps from quietest to full is few enough to say. A tenth is there for somebody who
  // wants finer control; a quarter for somebody who wants it in four.
  { key: 'volumeStep', label: 'How much one step changes this video’s volume', kind: 'choice',
    default: 20, level: 'advanced',
    options: [
      { value: 10, label: 'a little' },
      { value: 20, label: 'a step you can hear' },
      { value: 25, label: 'a big step' },
    ] },
];

// Parse a YouTube video id from a URL or a bare id. Accepts youtu.be/<id>,
// watch?v=<id>, /embed/<id>, /shorts/<id>, or an 11-char id on its own.
export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

// --- default player adapter: youtube-nocookie via the IFrame Player API --------
// Lazily loads the IFrame API once per page, then wraps one YT.Player. Advances
// via the ENDED state; a load before "ready" is queued. Kept tiny + isolated so
// the network/DOM dependency lives here and nowhere in the module core.
let _apiPromise = null;
// The "list=" value of a playlist URL, or a bare id. Playlist ids are not video ids and
// the two get pasted into the same box constantly, so this is deliberately strict about the
// PL/UU/LL/FL/RD prefixes rather than accepting anything that looks id-shaped.
export function parsePlaylistId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const m = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
  const id = m ? m[1] : raw;
  return /^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

// Which daypart covers `date`? The schedule is a set of start HOURS; each runs until the
// next one begins, and the last WRAPS PAST MIDNIGHT into the first. That wrap is the whole
// reason this is a separate, exported function: "before the first start belongs to the last
// daypart" is the case that gets written wrong and is invisible until 2am.
/**
 * *** A SCHEDULE ENTRY MAY NOW SAY WHEN IT ENDS, NOT ONLY WHEN IT STARTS. ***
 *
 * Mike: *"a scheduler that can say play this from this time to that time, that from then to
 * then."* What existed was start-only — each entry ran until the NEXT one began, and the last
 * wrapped past midnight. That covers a day carved into adjacent slices and cannot express the
 * thing he asked for, because **it has no way to say "and the rest of the day, nothing"**.
 * There was always a scheduled playlist; a gap was unrepresentable.
 *
 * So `end` is optional, and the two kinds coexist deliberately:
 *
 *   * **An entry WITH `end`** is a range: active while the clock is inside [start, end).
 *     `end` less than `start` wraps past midnight (22 → 6 is the night). Ranges are checked
 *     first and the first match wins.
 *   * **An entry WITHOUT `end`** behaves exactly as it always did — it runs until the next
 *     start-only entry begins, wrapping at the end of the list.
 *   * **Nothing matching returns null**, and that is the new capability rather than a failure:
 *     the caller falls back to the ordinary playlist, which is what "and the rest of the day,
 *     nothing scheduled" means.
 *
 * BACKWARD COMPATIBILITY IS NOT AN ACCIDENT HERE. Every schedule saved before this has no
 * `end` on any entry, so every entry falls into the second bucket and the function returns
 * exactly what it returned before — including the guarantee that something always matches.
 * A saved schedule cannot change behaviour by being read by newer code.
 */
export function pickDaypart(schedule, date = new Date()) {
  const all = (Array.isArray(schedule) ? schedule : [])
    .filter((d) => d && d.playlistId && Number.isFinite(Number(d.start)))
    .map((d) => ({ ...d, start: Number(d.start),
                   end: Number.isFinite(Number(d.end)) ? Number(d.end) : null }))
    .sort((a, b) => a.start - b.start);
  if (!all.length) return null;
  const h = date.getHours() + date.getMinutes() / 60;

  // Ranges first: they are the specific statement, and somebody who wrote one meant it.
  for (const d of all) {
    if (d.end == null) continue;
    // A range that ends where it starts is a whole day, not an empty one — the alternative
    // reading makes a plausible typo silently mean "never", which is the worse failure.
    if (d.end === d.start) return d;
    const inside = d.end > d.start
      ? (h >= d.start && h < d.end)
      : (h >= d.start || h < d.end);          // wraps past midnight
    if (inside) return d;
  }

  // Then the old start-only chain, over the start-only entries ONLY. Mixing a range into this
  // would make the range govern the hours AFTER it too, which is the opposite of saying when
  // it ends.
  const open = all.filter((d) => d.end == null);
  if (!open.length) return null;              // ranges only, and none of them is on right now
  let cur = open[open.length - 1];            // the wrap: earlier than the first start
  for (const d of open) if (h >= d.start) cur = d;
  return cur;
}

/**
 * Text into a row built with `innerHTML`.
 *
 * Added because `renderPlaylist` interpolated `v.title` and `v.channel` straight into markup,
 * and BOTH come from a free-text field somebody types into this panel. It is only ever your own
 * screen, so this is self-inflicted rather than an attack anybody else can mount — but a channel
 * name with an apostrophe and a `<` in it should render, not disappear, and the fix for "renders
 * wrong" and the fix for "executes" are the same three lines.
 */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * *** SEARCH YOUTUBE FOR A VIDEO, WITH THE USER'S OWN KEY. ***
 *
 * Mike asked for per-video search, and for the principle behind it: *"do not withhold
 * capability the YouTube API already offers"* because a simpler panel was easier.
 *
 * THE PART THAT DECIDES THE SHAPE: search is the Data API, and the Data API needs a key with a
 * quota attached to somebody's Google account. `CLAUDE.md` is explicit that the default must
 * cost Mike nothing — *"I can't be paying for everyone's tokens"* — and the answer the project
 * already settled on for the AI adapter is the answer here: **bring your own key.** Nothing
 * happens without one, nothing is billed to anybody but the person who typed it, and the panel
 * says so rather than failing silently.
 *
 * IT IS A REAL THIRD-PARTY REQUEST AND THE PANEL SAYS SO. Embedding a video already talks to
 * Google, but a search sends WHAT SOMEBODY TYPED, which is different in kind on a site whose
 * pitch is that your media never leaves your machine. That sentence is in the UI, not only here.
 *
 * `fetchFn` is injected the same way `playerFactory` and `nowDate` are, so the suite drives this
 * with no network and no key of anybody's.
 */
export async function searchVideos(query, { apiKey, fetchFn = fetch, max = 10 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { items: [], error: null };
  if (!apiKey) return { items: [], error: 'no-key' };
  const url = 'https://www.googleapis.com/youtube/v3/search'
    + `?part=snippet&type=video&maxResults=${Math.max(1, Math.min(25, max))}`
    + `&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchFn(url);
    if (!res || !res.ok) {
      // 403 is overwhelmingly "quota exhausted" or "key not enabled for this API", and both are
      // things the person can fix — so they are named rather than reported as a number.
      return { items: [], error: res && res.status === 403 ? 'key-refused' : 'failed' };
    }
    const body = await res.json();
    const items = (body && Array.isArray(body.items) ? body.items : [])
      .map((it) => ({
        id: it && it.id && it.id.videoId,
        title: (it && it.snippet && it.snippet.title) || '',
        channel: (it && it.snippet && it.snippet.channelTitle) || '',
      }))
      .filter((it) => it.id);
    return { items, error: null };
  } catch {
    // Offline, blocked, or a CSP that does not allow googleapis. Not distinguishable from here
    // and not worth pretending otherwise.
    return { items: [], error: 'failed' };
  }
}

function loadIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (_apiPromise) return _apiPromise;
  _apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('failed to load YouTube IFrame API'));
    document.head.append(s);
    setTimeout(() => { if (!(window.YT && window.YT.Player)) reject(new Error('YouTube IFrame API timeout')); }, 12000);
  });
  return _apiPromise;
}

// The player reports FOUR things upward, and the last two are the ones that were missing.
//
// `onPlaying`. Without it there is no way to tell "loading" from "loaded and stuck", and a
// video that never starts fires neither onEnded nor onError — a hung network request is not
// a player error. That silence is what left a bedside screen frozen on a loading spinner
// with the director politely waiting for a `segment/done` that was never coming.
//
// `onIdle` — PAUSED and BUFFERING — is the SAME failure arriving through a different door,
// and it was open until 2026-08-27. The state handler covered ENDED, PLAYING and CUED; a
// video that paused fired nothing at all, and PLAYING had already disarmed the watchdog. So
// the screen sat on a paused video with no `segment/done` ever reaching the director, and
// the one person in front of it cannot press play. That violates the invariant this whole
// product is built around: NOTHING MAY REQUIRE AN INPUT IN ORDER TO KEEP DOING WHAT IT IS
// ALREADY DOING. Starting can need a press; continuing must not.
//
// BUFFERING is included deliberately. It is the honest version of the same hang — a video
// that buffers forever after having played once is indistinguishable, from the chair, from
// one that paused. Both mean "stopped, and not coming back on its own".
// Exported for the music panel (row 2.32), which plays a YouTube favourite in its own panel when no
// YouTube panel is on the screen - the same player, not a second copy of it.
export function createYtPlayer(mountEl, { onEnded, onError, onPlaying, onIdle, onPlaylist }) {
  let player = null, ready = false, pending = null, pendingList = null, destroyed = false;
  const host = document.createElement('div');
  mountEl.append(host);

  loadIframeApi().then((YT) => {
    if (destroyed) return;
    player = new YT.Player(host, {
      host: 'https://www.youtube-nocookie.com',
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: () => {
          ready = true;
          if (pendingList) { player.cuePlaylist({ list: pendingList, listType: 'playlist' }); pendingList = null; }
          else if (pending) { player.loadVideoById(pending); pending = null; }
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) onEnded?.();
          else if (e.data === YT.PlayerState.PLAYING) onPlaying?.();   // disarms the watchdog
          // PAUSED / BUFFERING: stopped, and nothing in the product can press play. Hand it
          // up so the module can re-arm the watchdog it disarmed when this started playing.
          else if (e.data === YT.PlayerState.PAUSED) onIdle?.('paused');
          else if (e.data === YT.PlayerState.BUFFERING) onIdle?.('buffering');
          // CUED is how a cued PLAYLIST announces itself: getPlaylist() is empty until now.
          // We only ever want the ids — the weighted picker chooses what actually plays, so
          // the playlist is a SOURCE of videos, not the running order.
          else if (e.data === YT.PlayerState.CUED) {
            try { const l = player.getPlaylist?.(); if (l && l.length) onPlaylist?.(l); } catch { /* not a list */ }
          }
        },
        onError: (e) => onError?.(e?.data),
      },
    });
  }).catch((err) => onError?.(err));

  return {
    load(id) { if (destroyed) return; if (ready && player) player.loadVideoById(id); else { pending = id; pendingList = null; } },
    cueList(listId) {
      if (destroyed) return;
      if (ready && player) player.cuePlaylist({ list: listId, listType: 'playlist' });
      else { pendingList = listId; pending = null; }
    },
    // The cheap first move when a video has stopped on its own: ask it to carry on from
    // where it is, rather than reloading and losing the place. `load` remains the fallback.
    resume() { if (destroyed) return; try { player?.playVideo?.(); } catch { /* not ready */ } },
    // A spoken or switched "pause" (row 2.28). The player then reports PAUSED, which lands in
    // `onIdle` exactly like somebody pressing the player's own pause button - and is HELD, the
    // same way, because it was.
    pause() { if (destroyed) return; try { player?.pauseVideo?.(); } catch { /* not ready */ } },
    // *** WHERE THE VIDEO HAS GOT TO, IN SECONDS — or null if it cannot say. ***
    //
    // The IFrame API has no `timeupdate`. It has STATES, and a state is not progress: a
    // player whose picture has frozen can sit in PLAYING indefinitely and report it happily.
    // A MOVING CLOCK is the only thing here that tells a video that is playing from a video
    // that says it is playing, so this is what the module's heartbeat is built on.
    currentTime() {
      if (destroyed) return null;
      try { const t = Number(player?.getCurrentTime?.()); return Number.isFinite(t) ? t : null; }
      catch { return null; }        // not ready yet — absent, not zero
    },
    // 0..1, for the speaker arbiter. The iframe API takes 0-100. Never throws: a duck that
    // fails is a video that stays loud, which is the right failure for a coordinator.
    setGain(level) {
      if (destroyed) return;
      try { player?.setVolume?.(Math.round(Math.max(0, Math.min(1, level)) * 100)); }
      catch { /* not ready */ }
    },
    stop() { pending = null; try { player?.stopVideo?.(); } catch { /* not ready */ } },
    destroy() { destroyed = true; pending = null; try { player?.destroy?.(); } catch { /* noop */ } host.remove(); },
  };
}

registerModule(
  // FALLBACK EXPOSURE: the whole point of this module is off-device, so it is never offered
  // as a fallback for anything. A fallback chain that ends in something network-dependent has
  // not terminated.
  { dependsOn: 'network',
    type: 'youtube', title: 'YouTube', description: 'Your own YouTube playlist, shuffled so it does not repeat itself',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events, user, audio = null } = ctx;
    // THE SPEAKER ARBITER. A video is the loudest thing on the screen, so it joins the music
    // group at VIDEO priority - it wins the slot over any game's music (Mike, 2026-07-26) -
    // on the `media` tier, so a spoken cue still ducks it. Optional, as everywhere: no bus
    // means a video that plays at full volume, never a video that will not play.
    const AUDIO_ID = `youtube:${ctx.instanceId || 'yt'}`;
    const makePlayer = ctx.playerFactory || createYtPlayer;
    // THE HELD SIGNAL. Until this existed a hold was invisible outside the module, which is
    // the whole reason a held screen could only ever show a frozen frame — see `held.js`.
    const heldSignal = createHeldSignal(bus, 'youtube');

    // *** PRESETS (register #255) — see presets.js's header for the scope argument. ***
    // `ctx.makePersonState` is the SAME per-person seam `modules/keyboard.js`'s bindings and
    // `kiosk.js`'s marker/device preferences already use — curried onto this screen's own
    // person the same way `home.js`'s `makeUserState` curries it for the panels there. Absent
    // on any host that hasn't wired `ctx.personId`/`ctx.makePersonState` (the dev harness, this
    // suite, a signed-out demo): `presetsLib` is then null, `activePreset()` always answers
    // null, and every `effective*` helper below falls straight through to the instance's own
    // cfg — i.e. exactly today's behavior, unchanged.
    const presetsLib = (ctx.personId && ctx.makePersonState)
      ? createPresetLibrary({ makeState: (key, opts) => ctx.makePersonState(ctx.personId, key, opts) })
      : null;
    // The settings menu PAINTS SYNCHRONOUSLY (see `settingsChoices` below, and photos.js's
    // identical `knownSources`), so this is refreshed from `presetsLib`'s own live subscription
    // rather than fetched fresh on every menu open.
    let knownPresets = [];

    let cfg = { ...DEFAULTS };
    let ids = [], byId = {}, channels = {}, durations = {};
    let stats = {};                 // derived from play events
    let recent = [];                // ids recently shown (in-memory, immediate)
    let history = [], histPos = -1; // for prev()
    let currentId = null;
    let player = null;

    // ---- time-of-day playlists ------------------------------------------
    // `fromList` holds the video ids a cued playlist reported. It is kept separate from
    // cfg.playlist so the two can coexist: a screen can have a curated playlist for the
    // hour AND a handful of pinned videos, and editing one never clobbers the other.
    let fromList = [];
    let activeList = null;       // the playlistId currently loaded
    let activePart = null;       // the daypart it came from, if any
    let pendingPart = null;      // a boundary crossed mid-video, waiting for it to finish
    let graceTimer = null;
    let tickTimer = null;
    const nowDate = ctx.nowDate || (() => new Date());
    const scheduleTickMs = ctx.scheduleTickMs || 60000;

    // ---- the stuck-loading watchdog (shared primitive, see ../watchdog.js) ----
    // Armed when a video is asked for, satisfied the moment it actually plays. A stall
    // reloads the same video once — most are a blip — and a second stall ends the segment
    // so whatever is driving this can move on.
    //
    // It lives in the MODULE rather than the player adapter because the module is what
    // knows about the bus and `autoAdvance`; and because an injected test player then
    // exercises the real recovery path instead of bypassing it.
    // Injected so the suite can search with no network and nobody's key -- the same seam
    // `playerFactory` and `nowDate` use.
    const search = ctx.searchVideos || searchVideos;
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    // Only the failure backoff reads this clock.
    const now = ctx.now || (() => Date.now());
    let failStreak = 0, failTimer = null, shownAt = 0;
    let stall = null;

    // WHY the reason is tracked: the recovery for "never started loading" and the recovery
    // for "stopped after playing" are not the same move. A load that hung wants reloading;
    // a video that paused wants RESUMING, because reloading throws away the place she was
    // at. Same watchdog, same ladder, different first rung.
    // 'loading' | 'playing' | 'buffering' | 'paused' | 'held'.
    //   playing — it is alive and the heartbeat below keeps restarting the clock.
    //   paused  — it stopped and nobody appears to be here. Short clock, normal ladder.
    //   held    — it stopped and somebody IS here. Long clock, and it is NOT restarted.
    let stallReason = 'loading';
    let lastTime = -1;              // the last position the player reported; -1 = never asked
    let pollTimer = null;
    let destroyed = false;
    const activity = ctx.activity || pageActivity();
    // Whether this instance is the one on screen. A director leaves every provider mounted
    // and hides all but one, and a hidden player is ALLOWED to sit paused — re-arming for it
    // would end the segment that is actually playing.
    let active = true;

    function clearStall() { stall?.disarm(); setHeld(false); }
    function armStall(id, reason = 'loading') { stallReason = reason; stall?.arm(id); }

    // ------------------------------------------------------------------------------------
    // *** THE HEARTBEAT (added 2026-08-30). ***
    //
    // `onPlaying` used to call `stall.ok()`, and `ok()` STOPS the clock — which is right for
    // a load that has finished and wrong for a segment that is still running. Two things
    // followed from it, and both were bedside bugs:
    //
    //   1. A VIDEO THAT FROZE AFTER PLAYING WAS INVISIBLE. Nothing was watching any more, so
    //      the module depended entirely on the player noticing and saying PAUSED or
    //      BUFFERING. A picture that stops with the state still PLAYING says neither.
    //   2. THE CONTAINER'S BACKSTOP CUT HEALTHY VIDEOS OFF AT THREE MINUTES. `segment/progress`
    //      was published in the same place — once, at the start of a clip — so a 40-minute
    //      video looked identical to a frozen one to the director. Measured on 2026-08-30
    //      through the real director: 133 timeouts and 59 reloads in 40 minutes of a video
    //      that was playing perfectly.
    //
    // So: `beat()`, not `ok()`, on a repeating signal — the pattern `photos.js` already used
    // with `timeupdate`. The IFrame API has no such event, so the signal is a poll.
    //
    // ONE HEARTBEAT, ONE MEANING. The same evidence feeds the module's own clock AND the
    // container's, always together. Two heartbeats that can disagree is how a screen ends up
    // being watched by something that has been told it is fine.
    // ------------------------------------------------------------------------------------
    const basePollMs = Number(ctx.progressMs) > 0 ? Number(ctx.progressMs) : PROGRESS_MS;
    const pollMs = () => {
      const s = Math.max(0, Number(cfg.stallMs) || 0);
      // Comfortably inside the stall window. Half is the most a single poll can guarantee,
      // and the floor stops a tiny `stallMs` turning this into a busy loop.
      return s > 0 ? Math.max(1000, Math.min(basePollMs, Math.floor(s / 2))) : basePollMs;
    };

    function readTime() {
      try { const t = Number(player?.currentTime?.()); return Number.isFinite(t) ? t : null; }
      catch { return null; }
    }

    // Restart the clock on the current video, arming it first if nothing is being watched
    // (a `playing` can arrive after a give-up disarmed everything).
    function watchAgain() {
      if (!stall || !currentId) return;
      if (stall.key() === null) stall.arm(currentId); else stall.beat();
    }

    function heartbeat() {
      // HIDDEN MEANS SILENT, and this guard is not only about tidiness. A container leaves
      // every provider mounted and shows one; a hidden player can still report PLAYING (a
      // buffer that completes after it was hidden). Without this it would re-arm its own
      // watchdog after `deactivate` disarmed it, AND quiet the container's backstop on behalf
      // of the provider that is actually on screen — the cross-talk bug wearing the opposite
      // sign from the one `youtube/deactivate` was written to prevent.
      if (!active || !currentId) return;
      watchAgain();
      bus.publish('segment/progress', { provider: 'youtube', id: currentId });
    }

    function reportProgress() {
      if (!active || !currentId) return;
      // The player has already told us it stopped. Do not paper over that: the clock that is
      // running belongs to that stop and it should be allowed to run out.
      if (stallReason !== 'playing') return;
      const t = readTime();
      if (t === null) {
        // *** THE WEAKER CLAIM, AND IT IS DELIBERATE. *** An adapter that cannot report a
        // position leaves exactly what this module knew before the heartbeat existed: the
        // player said PLAYING and has not said otherwise. That is real evidence, just
        // thinner — it cannot see a video frozen with its state still PLAYING. The bundled
        // adapter does report a position, so this path is for hand-written and future ones,
        // and it is better than the alternative of cutting them off every three minutes.
        heartbeat();
        return;
      }
      if (t > lastTime + 0.05) { lastTime = t; heartbeat(); return; }
      // The position has not moved while the player still claims to be playing. Say nothing.
      // The clock armed at the last beat runs out and the ordinary ladder takes over.
    }

    function progressTick() {
      pollTimer = null;
      try { reportProgress(); } catch (e) { console.error('youtube: progress', e); }
      if (!destroyed) pollTimer = setTimer(progressTick, pollMs());
    }

    // The hold ran out and it is still paused. Tell somebody — see the SETTINGS note above
    // for what that does and does not reach today.
    function notifyHeld() {
      try { ctx.output?.notify?.('The screen has been paused for a while.', { source: 'youtube' }); }
      catch (e) { console.error('youtube: notify', e); }
      // The durable half, independent of whether anything was delivered.
      events.append('held', { at: Date.now(), id: currentId, afterMs: holdNotifyMs() })
        .catch((e) => console.error('youtube: held log', e));
    }

    // A HELD PAUSE HAS TO BE VISIBLE. An aide walking into the room needs to tell "paused"
    // from "broken" without asking anybody, and a silent hold looks exactly like a crash.
    function setHeld(on) {
      const el = mount.querySelector('[data-held]');
      if (el) el.hidden = !on;
      // ...and say so on the bus, so a container can put a wallpaper up instead of leaving a
      // frozen frame. Idempotent in `held.js`, which matters because this is called from four
      // places and only one of them is a state CHANGE.
      if (on) heldSignal.begin({ id: currentId, afterMs: holdNotifyMs() });
      else heldSignal.end();
    }

    // The video stopped. Re-arm the clock that PLAYING disarmed — but WHICH clock depends
    // entirely on whether anybody is here, which is the whole argument in presence.js.
    function onIdle(reason = 'paused') {
      // Not making sound any more, whatever the reason - so release the slot and let a
      // game's music come back up. BUFFERING counts: a stalled video is silence.
      audio?.setActive?.(AUDIO_ID, false);
      if (!active || !currentId) return;
      // Already counting a STOP for this video — don't restart the clock, or a player that
      // flaps between BUFFERING and PAUSED could hold it open forever.
      //
      // The `playing` test is what the heartbeat made necessary: the watchdog is now armed
      // for the whole of a healthy video, so "armed" on its own no longer means "already
      // handling a stop". A heartbeat is not a stop and must not block this branch.
      if (stallReason !== 'playing' && stall?.armed()) return;

      // *** BUFFERING IS NEVER A PERSON. *** It is the network, whoever is in the room, so it
      // takes the short clock unconditionally. Only a PAUSE can be somebody's doing.
      if (reason !== 'paused') { armStall(currentId, reason); return; }

      // *** THIS MODULE EMBEDS THE REAL YOUTUBE PLAYER, WITH ITS CHROME, AND THAT FACT IS
      // WHAT DOES THE WORK HERE — not any attempt to detect a person. ***
      //
      // Somebody standing in the room can reach in and press pause; that is Mike's
      // parents-visiting case. The click lands inside a cross-origin iframe, so this page
      // CANNOT SEE IT (see activity.js). Trying to measure it would fail silently, so the
      // decision is made from what the module puts on screen instead: this one has a pause
      // button, therefore a PAUSE here is somebody's doing, and it is held.
      //
      // `activity.recent()` can only ever say yes on top of that. It never has to.
      const held = pauseIsReachable || activity.recent(RECENT_MS);
      if (!held) { armStall(currentId, 'paused'); return; }

      // 'never' — no clock at all. `disarm` rather than a bare return, because the heartbeat
      // may well have one running: without this the poll's clock would expire and the
      // ordinary ladder would resume a video somebody deliberately paused.
      if (!holdNotifyMs()) { stallReason = 'held'; stall?.disarm(); setHeld(true); return; }
      armStall(currentId, 'held');
      setHeld(true);
    }

    // The player's own controls are on screen, so a visitor has a pause button to press.
    // A per-module default (see `personal.js`, where the opposite is true and for a stated
    // reason), not a claim about kiosks in general.
    const pauseIsReachable = true;
    const holdNotifyMs = () => Math.max(0, Number(cfg.heldNotifyMs) || 0);

    // ---- volume (row 2.28) — see the VOLUME note on SETTINGS ----------------------------
    // `arbiterGain` is what the speaker arbiter last asked for (1 when there is no arbiter);
    // the player gets that TIMES this panel's own volume, so neither can override the other.
    let arbiterGain = 1;
    let pushedGain = null;          // null = this module has never set the player's volume
    const clampNum = (v, lo, hi, dflt) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    };
    const volumePct = () => clampNum(cfg.volume, VOLUME_MIN, 100, DEFAULTS.volume);
    const volumeStep = () => clampNum(cfg.volumeStep, 1, 100, DEFAULTS.volumeStep);
    // `force` is the arbiter's path, which always enacted its level and still does. Otherwise a
    // screen nobody has made louder or quieter is LEFT ALONE - the player keeps whatever it had,
    // exactly as before this existed.
    function pushGain(force = false) {
      const g = arbiterGain * (volumePct() / 100);
      if (!force && pushedGain === null && g === 1) return;
      pushedGain = g;
      try { player?.setGain?.(g); } catch { /* not ready */ }
    }
    function stepVolume(dir) {
      // A DIRECTION, NEVER AN AMOUNT: the size of a step is this panel's setting, not whatever
      // a sender put in the payload.
      const d = Number(dir) < 0 ? -1 : 1;
      const next = clampNum(volumePct() + d * volumeStep(), VOLUME_MIN, 100, DEFAULTS.volume);
      // Local first, so three quick "louder"s compound before the saved row echoes back.
      cfg = { ...cfg, volume: next };
      state.set({ volume: next });
      pushGain(true);
    }

    function onPlaying() {
      failStreak = 0;                // a video that plays ends a failure run (FAILURE BACKOFF)
      audio?.setActive?.(AUDIO_ID, true);
      stallReason = 'playing';
      setHeld(false);
      setStatus('');
      // A volume set before the player was ready was swallowed by it; say it again now. A no-op
      // on a screen that has never been made louder or quieter.
      pushGain();
      lastTime = readTime() ?? -1;
      // beat(), NOT ok(). `ok()` stops the clock for good and a video that freezes afterwards
      // is then watched by nothing — see the heartbeat note above and watchdog.js.
      heartbeat();
    }

    const stage = () => mount.querySelector('[data-stage]');

    function setStatus(text) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      if (text) s.textContent = text;
    }

    // ---- presets: which playlist/schedule/shuffle is actually IN FORCE -----------------
    //
    // Resolved fresh on every call rather than cached, so a preset renamed, edited or deleted
    // on another screen is never stale here for longer than the next `presetsLib` notification
    // (a poll tick or a push). `type` is checked because `cfg.presetId` is only ever validated
    // against KNOWN presets by the settings menu at pick time — a preset later re-typed to a
    // different module elsewhere, or simply deleted, must fall back to "no preset" rather than
    // apply a stranger's settings shaped for something else.
    function activePreset() {
      if (!cfg.presetId || !presetsLib) return null;
      const p = presetsLib.getPreset(cfg.presetId);
      return (p && p.type === 'youtube') ? p : null;
    }
    function effectivePlaylist() {
      const p = activePreset();
      return p ? (Array.isArray(p.settings?.playlist) ? p.settings.playlist : [])
                : (Array.isArray(cfg.playlist) ? cfg.playlist : []);
    }
    function effectiveSchedule() {
      const p = activePreset();
      return p ? (Array.isArray(p.settings?.schedule) ? p.settings.schedule : [])
                : (Array.isArray(cfg.schedule) ? cfg.schedule : []);
    }
    // Same "absent/null/undefined means on" convention `cfg.shuffle` itself already uses.
    function effectiveShuffle() {
      const p = activePreset();
      return p ? p.settings?.shuffle !== false : cfg.shuffle !== false;
    }
    function effectivePlaylistId() {
      const p = activePreset();
      return String((p ? p.settings?.playlistId : cfg.playlistId) || '');
    }

    // Rebuild the id/channel/duration maps from the playlist config. Channel
    // defaults to the video id (so a video with no channel still counts as its own
    // channel — diversity degrades gracefully, never divides by an empty axis).
    function indexPlaylist() {
      const pinned = effectivePlaylist();
      // Ids from a cued playlist carry no title/channel/duration — YouTube does not hand
      // them over without the Data API. They degrade the same way a video added with no
      // channel does: their own id becomes their channel, duration 0 means the
      // duration weighting simply does not apply to them.
      const list = pinned.concat(fromList.map((id) => ({ id })));
      const seen = new Set();
      const clean = [];
      for (const v of list) {
        const id = v && v.id;
        if (!id || seen.has(id)) continue;   // drop blanks + dupes
        seen.add(id);
        clean.push(v);
      }
      ids = clean.map((v) => v.id);
      byId = Object.fromEntries(clean.map((v) => [v.id, v]));
      channels = Object.fromEntries(clean.map((v) => [v.id, v.channel || v.id]));
      durations = Object.fromEntries(clean.map((v) => [v.id, Number(v.durationSec) || 0]));
    }

    // Show a video by id. `record` distinguishes a forward play (counts, logs a play
    // event, extends history) from a prev()/replay (neither) — identical to photos.
    // *** FAILURE BACKOFF (photosensitivity audit, 2026-09-30). *** A player error handed back and
    // advanced AT ONCE, so a pool where every video is unavailable (removed, region-blocked, embeds
    // off) replaced one with the next as fast as the API could refuse them. The n-th failure in a
    // row now reacts `failureBackoffMs(n, limit)` after the video was asked for (one flash period,
    // then 2 s doubling to 30 s; flash_limit.js). The streak resets the moment a video plays, so a
    // video that plays is handled exactly as before; a person's own next/prev cancels the wait.
    function afterFailure(fn) {
      failStreak += 1;
      clearFailWait();
      const wait = Math.max(0, failureBackoffMs(failStreak, flashLimit(ctx)) - (now() - shownAt));
      if (!wait) { fn(); return; }
      failTimer = setTimer(() => { failTimer = null; if (!destroyed) fn(); }, wait);
    }
    function clearFailWait() { if (failTimer != null) { clearTimer(failTimer); failTimer = null; } }

    function show(id, record = true) {
      if (!byId[id] || !player) return;
      clearFailWait();               // whatever asked for this video, a held failure is superseded
      shownAt = now();
      currentId = id;
      active = true;                 // something asked for a video: this instance is on screen
      player.load(id);
      lastTime = -1;                 // a new video starts its own clock; never compare across two
      armStall(id, 'loading');
      updateLabel();
      if (record) {
        recent.push(id);
        if (recent.length > RECENT_CAP) recent.shift();
        history = history.slice(0, histPos + 1);
        history.push(id); histPos = history.length - 1;
        events.append('play', { id, at: Date.now() }).catch((e) => console.error('youtube: play log', e));
      }
    }

    function advance() {
      if (!ids.length) return;
      // Shuffle is the default and is the whole reason a playlist is treated as a POOL:
      // the weighted picker spreads plays across channels, backs off things played
      // recently, and stops one long video from dominating. Straight playlist order is
      // opt-out, for the case where the order is the point — a lesson series, a story.
      if (!effectiveShuffle()) {
        const at = ids.indexOf(currentId);
        const next = ids[(at + 1) % ids.length];
        if (next) show(next, true);
        return;
      }
      const id = pick(ids, stats, { now: Date.now(), rand: Math.random, recent, channels, durations });
      if (id) show(id, true);
    }

    function prev() {
      if (histPos > 0) { histPos -= 1; show(history[histPos], false); }
    }

    function deriveStats(cache) {
      const plays = (cache.events || [])
        .filter((e) => e.kind === 'play')
        .map((e) => ({ id: e.data?.id, at: e.data?.at || Date.parse(e.created_at) || 0 }));
      return statsFromEvents(plays, { idKey: 'id', atKey: 'at' });
    }

    /** `7` -> `07:00`, `17.5` -> `17:30`. Hours are stored as a number so the maths stays
     *  simple; a person reads a clock. */
    function hhmm(h) {
      const n = Math.max(0, Math.min(24, Number(h) || 0));
      const hh = Math.floor(n);
      const mm = Math.round((n - hh) * 60);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    function renderSchedule() {
      const el = mount.querySelector('[data-sched]');
      if (!el) return;
      const preset = activePreset();
      const schedule = effectiveSchedule();
      const parts = schedule.filter((d) => d && d.playlistId);
      const on = pickDaypart(schedule, nowDate());
      el.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'yt-schhead';
      head.textContent = parts.length
        ? (on ? `Playing the ${on.name} playlist now` : 'Nothing scheduled right now')
        : 'No playlists by time of day yet.';
      el.append(head);
      for (const d of parts) {
        const row = document.createElement('div');
        row.className = 'ytrow';
        // The RANGE is shown when there is one, and "until the next" when there is not, so a
        // schedule mixing the two says which each entry is rather than looking inconsistent.
        const when = Number.isFinite(Number(d.end))
          ? `${hhmm(d.start)}–${hhmm(d.end)}`
          : `from ${hhmm(d.start)}`;
        row.innerHTML = `<span>${esc(d.name || 'unnamed')} · ${esc(when)}`
          + `${on && on === d ? ' · <b>now</b>' : ''}</span>`;
        // A PRESET'S SCHEDULE IS READ-ONLY FROM HERE. Removing a row would have to write it
        // back to the PRESET (touching every other screen using it, silently — exactly the
        // "used on N dashboards" case this pass deliberately does not build a warning for, see
        // presets.js/this feature's report) or to this instance's own (currently inert)
        // `cfg.schedule`, which would remove nothing the person can see and look broken. A
        // fake affordance is worse than an absent one (settings_fields.js's own rule).
        if (!preset) {
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.textContent = 'Remove';
          rm.addEventListener('click', () => {
            state.set({ schedule: (cfg.schedule || []).filter((x) => x !== d) });
          });
          row.append(rm);
        }
        el.append(row);
      }
    }

    function updateLabel() {
      const el = mount.querySelector('[data-label]');
      if (!el) return;
      const v = currentId ? byId[currentId] : null;
      el.textContent = v ? (v.title || v.id) : `${ids.length} video${ids.length === 1 ? '' : 's'}`;
    }

    // Reflect the current playlist in the settings list (with per-row remove) — or, while a
    // preset is active, the PRESET's playlist, read-only (see renderSchedule's identical note
    // on why a remove button would either silently edit a shared preset or silently do
    // nothing against this instance's own, now-inert, `cfg.playlist`).
    function renderPlaylist() {
      const box = mount.querySelector('[data-list]');
      if (!box) return;
      const preset = activePreset();
      box.innerHTML = '';
      for (const v of effectivePlaylist()) {
        const row = document.createElement('div');
        row.className = 'ytrow';
        row.innerHTML = `<span>${esc(v.title || v.id)}${v.channel ? ' · ' + esc(v.channel) : ''}</span>`;
        if (!preset) {
          const rm = document.createElement('button');
          rm.textContent = '✕'; rm.title = 'remove';
          rm.addEventListener('click', () => {
            state.set({ playlist: (cfg.playlist || []).filter((x) => x.id !== v.id) });
          });
          row.append(rm);
        }
        box.append(row);
      }
    }

    // What the panel says when a search cannot happen. Each one names the thing the person can
    // actually do about it, because "search failed" is the message that wastes somebody's
    // evening.
    const SEARCH_MSG = {
      'no-key': 'Searching needs a YouTube API key. Add one in this panel’s advanced settings, '
        + 'or paste a video link above.',
      'key-refused': 'Google refused that key — usually the daily quota, or the key not having '
        + 'the YouTube Data API enabled.',
      failed: 'Could not reach YouTube. You can still paste a video link above.',
    };

    async function runSearch() {
      const box = mount.querySelector('[data-results]');
      const q = mount.querySelector('[data-find]')?.value || '';
      if (!box) return;
      if (!String(q).trim()) { box.textContent = ''; return; }
      box.textContent = 'Searching…';
      const { items, error } = await search(q, { apiKey: (cfg.apiKey || '').trim() });
      box.innerHTML = '';
      if (error) { box.textContent = SEARCH_MSG[error] || SEARCH_MSG.failed; return; }
      if (!items.length) { box.textContent = 'Nothing found.'; return; }
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'ytrow';
        row.innerHTML = `<span>${esc(it.title)}${it.channel ? ' · ' + esc(it.channel) : ''}</span>`;
        const add = document.createElement('button');
        add.type = 'button';
        add.textContent = byId[it.id] ? 'Added' : 'Add';
        add.disabled = !!byId[it.id];
        add.addEventListener('click', () => {
          // The SAME entry shape `addFromInput` writes, so a video added from a search and one
          // pasted in by hand are indistinguishable afterwards -- and the title is the real one
          // from YouTube rather than the id, which is the actual gain over pasting a link.
          state.set({ playlist: [...(cfg.playlist || []),
                                 { id: it.id, title: it.title || it.id,
                                   channel: it.channel || undefined }] });
          add.textContent = 'Added';
          add.disabled = true;
        });
        row.append(add);
        box.append(row);
      }
    }

    /** `"07:30"` -> `7.5`. Returns null for an empty or unparseable value. */
    function hoursFromTime(v) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
      if (!m) return null;
      const h = Number(m[1]), mi = Number(m[2]);
      if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
      return h + mi / 60;
    }

    function addSchedule() {
      const name = (mount.querySelector('[data-sch-name]')?.value || '').trim();
      const from = hoursFromTime(mount.querySelector('[data-sch-from]')?.value);
      const toRaw = mount.querySelector('[data-sch-to]')?.value;
      const to = hoursFromTime(toRaw);
      const listId = parsePlaylistId(mount.querySelector('[data-sch-list]')?.value);
      if (from == null) { setStatus('Give the time it starts.'); return; }
      if (!listId) { setStatus('That is not a playlist link or id.'); return; }
      // `end` is OMITTED rather than set to null when the field is blank. `pickDaypart` decides
      // which kind of entry this is by whether the key holds a finite number, and a stored
      // `end: null` reads the same as absent — but omitting it keeps the saved row identical in
      // shape to every row saved before today, which is what makes them impossible to tell
      // apart later.
      const entry = { name: name || `from ${hhmm(from)}`, start: from, playlistId: listId };
      if (to != null) entry.end = to;
      state.set({ schedule: [...(cfg.schedule || []), entry] });
      for (const sel of ['[data-sch-name]', '[data-sch-from]', '[data-sch-to]', '[data-sch-list]']) {
        const n = mount.querySelector(sel);
        if (n) n.value = '';
      }
      setStatus('');
    }

    function addFromInput() {
      const inp = mount.querySelector('[data-add-url]');
      const chan = mount.querySelector('[data-add-channel]');
      const id = parseVideoId(inp?.value);
      if (!id) { setStatus('Not a YouTube link or id.'); return; }
      if (byId[id]) { if (inp) inp.value = ''; return; }   // already present
      const entry = { id, channel: (chan?.value || '').trim() || undefined, title: id };
      state.set({ playlist: [...(cfg.playlist || []), entry] });
      if (inp) inp.value = '';
      if (chan) chan.value = '';
    }

    // Dev seed via query param, mirroring photos' ?photoSource: register once, then
    // remember in config. Format: ?ytVideos=ID1:channelA,ID2:channelB,ID3
    function seedFromQuery() {
      if ((cfg.playlist || []).length) return false;
      const raw = new URLSearchParams(location.search).get('ytVideos');
      if (!raw) return false;
      const list = [];
      for (const tok of raw.split(',')) {
        const [rawId, channel] = tok.split(':');
        const id = parseVideoId(rawId);
        if (id && !list.some((x) => x.id === id)) list.push({ id, channel: channel || undefined, title: id });
      }
      if (!list.length) return false;
      state.set({ playlist: list });
      return true;
    }

    // One phrasing for "waiting on a playlist", used by both the cue and the empty-pool
    // branch below — they fire in that order, so two different strings meant the specific
    // one was immediately overwritten by the generic one.
    function loadingMessage() {
      const part = pickDaypart(effectiveSchedule(), nowDate());
      return part ? `Loading ${part.name}…` : 'Loading playlist…';
    }

    // Load whichever playlist the clock says, if any. Re-cueing the SAME list is skipped —
    // it would restart the pool and interrupt whatever is playing for no reason.
    function syncPlaylistSource() {
      const part = pickDaypart(effectiveSchedule(), nowDate());
      const wanted = (part && part.playlistId) || effectivePlaylistId() || '';
      if (!wanted) { activeList = null; activePart = null; return; }
      if (wanted === activeList) { activePart = part; return; }
      activeList = wanted;
      activePart = part;
      fromList = [];
      if (player && player.cueList) {
        setStatus(loadingMessage());
        player.cueList(wanted);
      }
    }

    // A daypart boundary should not cut a video off mid-sentence. Wait for it to end —
    // but only up to graceMin, so a very long video cannot hold the screen in the wrong
    // daypart all evening.
    function checkSchedule() {
      const part = pickDaypart(effectiveSchedule(), nowDate());
      if (!part || !activePart || part.name === activePart.name) return;
      if (!currentId) { syncPlaylistSource(); return; }
      if (pendingPart && pendingPart.name === part.name) return;
      pendingPart = part;
      clearTimer(graceTimer);
      graceTimer = setTimer(() => { pendingPart = null; syncPlaylistSource(); },
                            Math.max(0, Number(cfg.graceMin) || 0) * 60000);
    }

    function applyPendingPart() {
      if (!pendingPart) return false;
      pendingPart = null;
      clearTimer(graceTimer); graceTimer = null;
      syncPlaylistSource();
      return true;
    }

    // Watch the clock for a daypart boundary — but ONLY when there is a schedule to watch.
    // Self-rescheduling rather than an interval so it uses the same injected timer seam the
    // watchdog does. A minute is plenty: boundaries land on the hour.
    function syncScheduleWatch() {
      const wanted = !!pickDaypart(effectiveSchedule(), nowDate());
      if (wanted && !tickTimer) {
        const tick = () => {
          try { checkSchedule(); } catch (e) { console.error('youtube: schedule', e); }
          tickTimer = setTimer(tick, scheduleTickMs);
        };
        tickTimer = setTimer(tick, scheduleTickMs);
      } else if (!wanted && tickTimer) {
        clearTimer(tickTimer); tickTimer = null;
      }
    }

    function applyConfig() {
      // The volume from the settings menu (or a saved row) takes effect straight away.
      pushGain();
      syncPlaylistSource();
      syncScheduleWatch();
      indexPlaylist();
      renderPlaylist();
      renderSchedule();
      const preset = activePreset();
      const note = mount.querySelector('[data-preset-note]');
      if (note) {
        note.hidden = !preset;
        if (preset) {
          note.textContent = `Using preset "${preset.name}" for the playlist, schedule and `
            + 'shuffle above. Adding a video or schedule entry, or changing shuffle, below '
            + 'edits this instance’s OWN settings — they take effect once the preset above '
            + 'is cleared.';
        }
      }
      const sync = mount.querySelector('[data-opt="autoAdvance"]');
      if (sync) sync.checked = !!cfg.autoAdvance;
      const shuf = mount.querySelector('[data-opt="shuffle"]');
      if (shuf) { shuf.checked = effectiveShuffle(); shuf.disabled = !!preset; }
      if (!ids.length) {
        setStatus(activeList ? loadingMessage() : 'No videos yet. Add one in settings.');
        currentId = null; updateLabel(); return;
      }
      setStatus(null);
      // start playing only if nothing is up yet (config re-fires on every settings edit).
      // A `directed` instance (driven by the content director) does NOT autostart — the
      // director advances it on activation, so it never double-advances.
      if (!cfg.directed && (!currentId || !byId[currentId])) advance();
      else updateLabel();
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="youtube">
            <div class="stage" data-stage></div>
            <div class="held" data-held hidden>Paused</div>
            <div class="status" data-status hidden></div>
            <div class="nav">
              <button class="ybtn" data-prev aria-label="previous video">‹</button>
              <span class="yt-label" data-label></span>
              <button class="ybtn" data-next aria-label="next video">›</button>
            </div>
            <button class="gear" data-gear aria-label="youtube settings">⚙</button>
            <div class="settings" data-settings hidden>
              <!-- *** A PANEL YOU CANNOT LEAVE IS THE WORST THING ON A BEDSIDE SCREEN. ***
                   Mike opened this, added a playlist, and could not get out: Escape did
                   nothing, there was no close, and the panel is inset on all four sides so it
                   covered the gear that opened it. He escaped by navigating to Photos and back.
                   Three ways out now, because one is not enough for a control somebody
                   may be using with a switch: this button, the Escape key, and the gear,
                   which is lifted above the panel so the thing that opened it still
                   closes it. -->
              <button type="button" class="yt-close" data-close aria-label="close settings">Close ✕</button>
              <!-- Set from the universal settings menu (this module's own SETTINGS declares
                   presetId, with live options from settingsChoices below) — this is just the
                   explanation for what changed once one is picked. See presets.js/register #255.
                   NO BACKTICKS IN THIS COMMENT — see the identical warning above this panel's
                   schedule editor; it lives inside the same template literal. -->
              <div class="yt-schhead" data-preset-note hidden></div>
              <label class="chk"><input type="checkbox" data-opt="autoAdvance"> auto-advance when a video ends</label>
              <label class="chk"><input type="checkbox" data-opt="shuffle"> shuffle (off = play the playlist in order)</label>
              <div class="addrow">
                <input type="text" data-add-url placeholder="YouTube link or id">
                <input type="text" data-add-channel placeholder="channel (optional)">
                <button data-add>Add</button>
              </div>
              <div class="addrow">
                <input type="text" data-find placeholder="search YouTube for a video">
                <button type="button" data-find-go>Search</button>
              </div>
              <div class="yt-results" data-results></div>
              <div class="addrow">
                <input type="text" data-list-url placeholder="playlist link or id (PL…)">
                <button data-set-list>Use playlist</button>
              </div>
              <!-- *** THE SCHEDULE HAD NO EDITOR AT ALL. ***
                   cfg.schedule has been read since this module was written and nothing could
                   write it - the panel printed a one-line summary of a setting no UI could set.
                   That is A14's shape, and it is why Mike's "play this from this time to that
                   time" read as a missing feature when half of it was already there.
                   The "to" field is optional: leave it empty and the entry runs until the next
                   one starts, which is what every schedule saved before today does.
                   NO BACKTICKS IN THIS COMMENT. It lives inside a template literal, and the
                   first version used them to quote a field name - which closed the string and
                   turned the rest of the module into a syntax error. imports_test named the
                   file in seconds; without it this would have been a blank panel to debug. -->
              <div class="yt-schedadd">
                <input type="text" data-sch-name placeholder="name (Morning)">
                <input type="time" data-sch-from title="from">
                <input type="time" data-sch-to title="to (optional)">
                <input type="text" data-sch-list placeholder="playlist link or id (PL…)">
                <button type="button" data-sch-add>Add</button>
              </div>
              <div class="yt-sched" data-sched></div>
              <div class="list" data-list></div>
            </div>
          </div>`;

        // the player adapter owns the stage; the video ending is just another source.
        // A video ending is ALSO a `segment/done` on the bus — the uniform seam the
        // content director listens on (ended | skipped | timeout are equivalent to it).
        // Harmless when standalone (no director subscribed); when a director drives this
        // instance it seeds autoAdvance=false, so only segment/done fires — the director
        // advances, not youtube itself.
        stall = createWatchdog({
          // A GETTER, not a snapshot, for two reasons now: cfg arrives with the state
          // subscription, and the interval itself DEPENDS ON WHY we are waiting. A held
          // pause runs on `heldNotifyMs` (hours); everything else runs on `stallMs` (seconds).
          // One watchdog instance, two clocks, because only one thing is ever being waited on.
          setTimer, clearTimer, retries: 1,
          stallMs: () => (stallReason === 'held' ? holdNotifyMs() : cfg.stallMs),
          onRetry: (id) => {
            // *** THE HOLD RAN OUT, AND IT IS NOT RESUMED. Mike's call, 2026-08-30. ***
            //
            // An earlier version carried on by itself at this point. That is the one move
            // this had to stop making: somebody paused it, and a screen that restarts under
            // the person who paused it is precisely the interruption the hold exists to
            // prevent — and the page cannot see a click inside the YouTube iframe, so it
            // cannot tell an empty room from a busy one.
            //
            // What happens instead is that somebody is told, once, and the screen stays
            // where it was left. `disarm` is what makes it once: it bumps the watchdog's
            // epoch, so `fire` does not re-arm behind this callback, and there is no second
            // notification six hours later and no give-up that advances the segment.
            if (stallReason === 'held') {
              notifyHeld();
              stall?.disarm();
              setHeld(true);
              return;
            }
            // A paused/buffering video is already loaded — ask it to carry on before
            // resorting to a reload, which would restart it from the beginning.
            if (stallReason !== 'loading' && player?.resume) {
              setStatus('');
              player.resume();
              return;
            }
            setStatus('Still loading — trying again…');
            player?.load(id);
          },
          onGiveUp: (id) => {
            setHeld(false);
            setStatus(stallReason === 'loading'
              ? 'That video wouldn’t load. Moving on.'
              : 'That video stopped. Moving on.');
            // `timeout` is the director's existing vocabulary for "this segment is over",
            // alongside ended | skipped.
            bus.publish('segment/done', { provider: 'youtube', reason: 'timeout', id });
            if (cfg.autoAdvance && ids.length > 1) bus.publish('youtube/next');
          },
        });

        // HIDDEN MEANS DISARMED. A container shows one provider at a time and leaves the
        // rest mounted; without this, a hidden player's stall would fire `segment/done`
        // and cut short whatever is actually on screen. The poll keeps ticking but
        // `reportProgress` returns on `!active`, so a hidden provider cannot beat the
        // backstop on behalf of the one that is actually on screen.
        bus.subscribe('youtube/deactivate', () => { active = false; clearStall(); });

        // The heartbeat's own clock. Started here rather than on first play so that it is
        // running before anything can need it, and self-rescheduling so it uses the same
        // injected timer seam everything else in this module does.
        pollTimer = setTimer(progressTick, pollMs());

        player = makePlayer(stage(), {
          // A cued playlist hands over its ids here. They join the pool and the weighted
          // picker takes over — the playlist decides WHAT is available, never the order.
          onPlaylist: (list) => {
            fromList = Array.from(new Set(list || []));
            indexPlaylist();
            renderPlaylist();
            if (!ids.length) return;
            setStatus(null);
            if (!cfg.directed) advance(); else updateLabel();
          },
          onEnded: () => {
            clearStall();
            // A video that ENDED played (YouTube reports a broken one through onError, never
            // ENDED), so this is never held: it ends a failure run and moves on at once.
            failStreak = 0;
            // A daypart boundary crossed while this was playing: now is the moment to
            // change over, not mid-video.
            const switched = applyPendingPart();
            bus.publish('segment/done', { provider: 'youtube', reason: 'ended' });
            if (!switched && cfg.autoAdvance) bus.publish('youtube/next');
          },
          // An explicit player/API error already ends the segment; just stop the watchdog
          // so it can't fire a second `segment/done` for the same video. A RUN of errors backs
          // off (afterFailure) rather than spinning through the pool.
          onError: () => {
            clearStall();
            afterFailure(() => {
              bus.publish('segment/done', { provider: 'youtube', reason: 'error' });
              if (cfg.autoAdvance && ids.length > 1) bus.publish('youtube/next');
            });
          },
          onPlaying,
          onIdle,
        });

        // Join the music group once the player exists to enact a level on. VIDEO PRIORITY, so
        // it takes the slot from a game's music; `media` tier, so a spoken cue still ducks it.
        audio?.register?.(AUDIO_ID, {
          tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY,
          onGain: (level) => {
            arbiterGain = Math.max(0, Math.min(1, Number(level) || 0));
            pushGain(true);
          },
        });

        // ANY SIGN OF A PERSON RESTARTS THE HOLD. This is what makes four hours the right
        // number rather than an absurd one: it is six hours of COMPLETE STILLNESS, not six
        // hours from the moment somebody pressed pause. A visit of any length keeps
        // re-arming it, and the clock only runs down once the room has actually emptied.
        // Extends a hold that is already running. *** THIS IS A BONUS, NOT THE MECHANISM. ***
        // It fires for input on THIS page — the module's own buttons, a switch, a keypress —
        // and is blind to a click inside the YouTube iframe, which is the most likely thing
        // a visitor actually touches. So a very long visit can still produce one message at
        // the `heldNotifyMs` mark. That costs much less than it used to, because what happens
        // at the end of a hold is now a notification somebody can ignore rather than a video
        // restarting under them — and the answer is still a longer setting, not a cleverer
        // guess about who is in the room.
        const heldBeat = () => {
          activity.note();
          if (stallReason === 'held' && stall?.armed()) stall.beat();
        };
        for (const topic of ['input/device', 'youtube/next', 'youtube/prev',
                             'youtube/play', 'youtube/pause', 'youtube/volume', 'youtube/load']) {
          bus.subscribe(topic, heldBeat);
        }
        mount.addEventListener('pointerdown', heldBeat, { passive: true });

        // the module's sinks — any source pointed at these topics drives it
        bus.subscribe('youtube/next', () => advance());
        bus.subscribe('youtube/prev', () => prev());
        // PLAY, PAUSE, LOUDER, QUIETER (row 2.28). Play carries on from where it stopped rather
        // than reloading; with nothing loaded yet it starts one, which is what "play" means to
        // somebody looking at an empty panel.
        bus.subscribe('youtube/play', () => {
          if (!currentId) { advance(); return; }
          try { player?.resume?.(); } catch (e) { console.error('youtube: play', e); }
        });
        bus.subscribe('youtube/pause', () => {
          try { player?.pause?.(); } catch (e) { console.error('youtube: pause', e); }
        });
        bus.subscribe('youtube/volume', (dir) => stepVolume(dir));
        // *** "PLAY THIS ONE" (row 2.32, the music favourites). *** `youtube/who` is answered at
        // once with `youtube/here { instanceId }`, so the music router can find ONE panel and address
        // it (`youtube/load#<instanceId>`) rather than start the song on every YouTube panel at once.
        // `youtube/load { videoId }` plays that video now; it joins this panel's pool for the session,
        // so what plays after it is this panel's own playlist as usual. `{ playlistId }` cues that
        // playlist, and the picker draws from it (plus any pinned videos) until this panel's own
        // settings or schedule next change it back.
        bus.subscribe('youtube/who', () => bus.publish('youtube/here', { instanceId: ctx.instanceId || null }));
        bus.subscribe('youtube/load', (p) => {
          const vid = parseVideoId((p && p.videoId) || '');
          const list = vid ? '' : parsePlaylistId((p && p.playlistId) || '');
          if (vid) {
            if (!byId[vid]) { fromList = [...fromList, vid]; indexPlaylist(); }
            show(vid, true);
          } else if (list && player?.cueList) {
            activeList = list; activePart = null; fromList = [];
            setStatus('Loading playlist…');
            player.cueList(list);
          }
        });

        // its own buttons are just another source
        const nav = bus.createSource('youtube-nav');
        bus.addBinding({ source: 'youtube-nav', signal: 'next', topic: 'youtube/next' });
        bus.addBinding({ source: 'youtube-nav', signal: 'prev', topic: 'youtube/prev' });
        mount.querySelector('[data-next]').addEventListener('click', () => nav.emit('next'));
        mount.querySelector('[data-prev]').addEventListener('click', () => nav.emit('prev'));

        mount.querySelector('[data-gear]').addEventListener('click', () => {
          const s = mount.querySelector('[data-settings]');
          s.hidden = !s.hidden;
        });
        mount.querySelector('[data-set-list]').addEventListener('click', () => {
          const el = mount.querySelector('[data-list-url]');
          const id = parsePlaylistId(el.value);
          if (!id) { setStatus('That is not a playlist link — a playlist URL has "list=PL…" in it.'); return; }
          el.value = '';
          state.set({ playlistId: id });
        });
        // THE WAY OUT. `closePanel` rather than a toggle, because Escape and Close both mean
        // "leave", never "come back".
        const panelEl = () => mount.querySelector('[data-settings]');
        const closePanel = () => { const el = panelEl(); if (el) el.hidden = true; };
        mount.querySelector('[data-close]').addEventListener('click', closePanel);
        // On the MODULE ROOT, not the document: two of these on one screen must not close each
        // other, and a keydown listener on `window` from a panel is how that happens.
        mount.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') return;
          const el = panelEl();
          if (!el || el.hidden) return;
          e.preventDefault();
          e.stopPropagation();
          closePanel();
        });
        mount.querySelector('[data-sch-add]').addEventListener('click', () => addSchedule());
        mount.querySelector('[data-find-go]').addEventListener('click', () => runSearch());
        mount.querySelector('[data-find]').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') runSearch();
        });
        mount.querySelector('[data-add]').addEventListener('click', () => addFromInput());
        mount.querySelector('[data-add-url]').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput(); });
        mount.querySelector('[data-opt="autoAdvance"]').addEventListener('change', (e) => {
          state.set({ autoAdvance: e.target.checked });
        });
        mount.querySelector('[data-opt="shuffle"]').addEventListener('change', (e) => {
          state.set({ shuffle: e.target.checked });
        });

        // play history -> picker stats
        events.subscribe((cache) => { stats = deriveStats(cache); });

        // config: adopt saved settings; seed from the query param once for a fresh
        // instance; (re)index + (re)render on every change.
        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          if (seedFromQuery()) return;   // set() re-enters this subscriber with the seeded list
          applyConfig();
        });

        // Presets (register #255): load this person's library once, then keep `knownPresets`
        // (for the synchronous `settingsChoices` menu) and whatever is actually playing
        // (`applyConfig`, via `effective*`) current as presets are added, edited, renamed or
        // deleted anywhere — this screen included. Absent host (no `ctx.personId`/
        // `ctx.makePersonState`): `presetsLib` is null and none of this runs, same as today.
        if (presetsLib) {
          presetsLib.load()
            .then(() => { knownPresets = presetsLib.listPresets(); if (!destroyed) applyConfig(); })
            .catch((e) => console.error('youtube: presets load', e));
          presetsLib.subscribe(() => {
            knownPresets = presetsLib.listPresets();
            if (!destroyed) applyConfig();
          });
          presetsLib.startPolling?.();
        }

      },
      onResize() {},
      onHide() { active = false; clearStall(); state.flush(); },
      destroy() {
        destroyed = true;
        clearTimer(pollTimer); pollTimer = null;
        clearTimer(tickTimer); tickTimer = null;
        clearTimer(graceTimer); graceTimer = null;
        clearFailWait();
        clearStall();
        try { audio?.unregister?.(AUDIO_ID); } catch { /* already gone */ }
        // A module torn down while held must publish its end, or whatever reacted to the hold
        // is stuck in a state only the destroyed module could have left. See `held.js` rule 3.
        heldSignal.release();
        try { presetsLib?.destroy(); } catch { /* already gone */ }
        try { player?.destroy(); } catch { /* noop */ } player = null; },

      // LIVE OPTIONS for the declared `presetId` field — this person's saved YouTube presets,
      // which are data and cannot be written into the manifest. Same pattern as photos.js's
      // `sourceId` / board.js's `boardId`.
      settingsChoices: () => ({
        presetId: knownPresets
          .filter((p) => p && p.type === 'youtube')
          .map((p) => ({ value: p.id, label: p.name })),
      }),
    };
  },
);
