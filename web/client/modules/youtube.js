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
import { createWatchdog } from '../watchdog.js';
import { pageActivity, RECENT_MS } from '../activity.js';
import { pick, statsFromEvents } from '../rng.js';

// `stallMs` is the STOPPED-VIDEO WATCHDOG (see the header). 20s is long enough that a
// slow-but-working load on facility wifi isn't cut off, short enough that nobody sits in
// front of a frozen screen for long.
//
// ONE NUMBER COVERS BOTH LOADING FAILURES — a load that never starts and a video that stops
// without anybody touching it. `heldPauseMs` is the separate, and very different, question
// below.
const DEFAULTS = {
  playlist: [],            // explicit video refs {id, channel, title, durationSec}
  playlistId: '',          // a YouTube playlist to draw from instead of / as well as the above
  schedule: [],            // [{name, start, playlistId}] — time-of-day playlists
  graceMin: 10,            // a nearly-finished video may run this long past a daypart boundary
  shuffle: true,           // weighted-random pick (the default); off = straight playlist order
  autoAdvance: true,
  directed: false,
  stallMs: 20000,
  // *** SOMEBODY PRESSED PAUSE. DO WE EVER RESTART IT BY OURSELVES? ***
  //
  // 0 = NO, and that is the default. See the SETTINGS declaration below for why.
  heldPauseMs: 0,
};
const RECENT_CAP = 12;          // in-memory anti-repeat window (picker also hard-excludes)

// *** OFF BY DEFAULT (Mike, 2026-08-27). ***
//
// This started at four hours and he called it: *"This seems like something that could cause
// more problems than it solves."* He is right, and the reason is the one directly above it in
// `activity.js` — THE SOFTWARE CANNOT TELL WHETHER ANYBODY IS IN THE ROOM. A click inside the
// YouTube player is invisible to this page, so an auto-resume is a GUESS, and a guess that
// fires during a visit interrupts the family it was written to protect.
//
// So the default is now: **a pause stays a pause.** Somebody paused it; it waits for them.
// The screen says PAUSED so nobody mistakes it for a crash, and that marker is what makes
// this safe to default to — the state is visible rather than a mystery.
//
// *** THE COST, AND IT IS REAL: *** a pause that nobody meant — a phone call grabbing audio
// focus on a shared tablet, an OS media interruption — now sits until a person comes back.
// That is the failure the watchdog was originally written for, and turning this off gives up
// covering it. Mike's call, made knowing that, because the interruption he described happens
// to real visitors and this one is rare.
//
// Anyone who wants the old behaviour turns it on and picks a duration.
//
// Declared as data so the shell can render it and a one-button cursor can reach it — see
// settings_fields.js for why markup would not do. A CHOICE, NOT A NUMBER, for the reason
// photos' interval is: with one switch you travel one way, one press at a time, so the number
// of stops IS the cost.
export const SETTINGS = [
  { key: 'heldPauseMs', label: 'If someone pauses it, start it again', kind: 'choice',
    default: 0, level: 'standard',
    options: [
      { value: 0, label: 'never — leave it paused' },
      { value: 900000, label: 'after 15 minutes' },
      { value: 3600000, label: 'after 1 hour' },
      { value: 14400000, label: 'after 4 hours' },
      { value: 43200000, label: 'after 12 hours' },
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
export function pickDaypart(schedule, date = new Date()) {
  const parts = (Array.isArray(schedule) ? schedule : [])
    .filter((d) => d && d.playlistId && Number.isFinite(Number(d.start)))
    .map((d) => ({ ...d, start: Number(d.start) }))
    .sort((a, b) => a.start - b.start);
  if (!parts.length) return null;
  const h = date.getHours() + date.getMinutes() / 60;
  let cur = parts[parts.length - 1];           // the wrap: earlier than the first start
  for (const d of parts) if (h >= d.start) cur = d;
  return cur;
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
// a player error. That silence is what left Christine's screen frozen on a loading spinner
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
function createYtPlayer(mountEl, { onEnded, onError, onPlaying, onIdle, onPlaylist }) {
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
    const { mount, bus, state, events, user } = ctx;
    const makePlayer = ctx.playerFactory || createYtPlayer;

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
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    let stall = null;

    // WHY the reason is tracked: the recovery for "never started loading" and the recovery
    // for "stopped after playing" are not the same move. A load that hung wants reloading;
    // a video that paused wants RESUMING, because reloading throws away the place she was
    // at. Same watchdog, same ladder, different first rung.
    // 'loading' | 'buffering' | 'paused' | 'held'.
    //   paused  — it stopped and nobody appears to be here. Short clock, normal ladder.
    //   held    — it stopped and somebody IS here. Long clock, reset by any further activity.
    let stallReason = 'loading';
    const activity = ctx.activity || pageActivity();
    // Whether this instance is the one on screen. A director leaves every provider mounted
    // and hides all but one, and a hidden player is ALLOWED to sit paused — re-arming for it
    // would end the segment that is actually playing.
    let active = true;

    function clearStall() { stall?.disarm(); setHeld(false); }
    function armStall(id, reason = 'loading') { stallReason = reason; stall?.arm(id); }

    // A HELD PAUSE HAS TO BE VISIBLE. An aide walking into the room needs to tell "paused"
    // from "broken" without asking anybody, and a silent hold looks exactly like a crash.
    function setHeld(on) {
      const el = mount.querySelector('[data-held]');
      if (el) el.hidden = !on;
    }

    // The video stopped. Re-arm the clock that PLAYING disarmed — but WHICH clock depends
    // entirely on whether anybody is here, which is the whole argument in presence.js.
    function onIdle(reason = 'paused') {
      if (!active || !currentId) return;
      // Already counting for this video — don't restart the clock, or a player that flaps
      // between BUFFERING and PAUSED could hold it open forever.
      if (stall?.armed()) return;

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

      if (!heldMs()) { setHeld(true); return; }   // 'never' — no clock at all
      armStall(currentId, 'held');
      setHeld(true);
    }

    // The player's own controls are on screen, so a visitor has a pause button to press.
    const pauseIsReachable = true;
    const heldMs = () => Math.max(0, Number(cfg.heldPauseMs) || 0);

    function onPlaying() {
      stall?.ok();
      stallReason = 'loading';
      setHeld(false);
      setStatus('');
      // Heartbeat for a container's slower backstop: this segment is alive. A provider
      // that never sends one is exactly what the backstop is there to catch.
      bus.publish('segment/progress', { provider: 'youtube', id: currentId });
    }

    const stage = () => mount.querySelector('[data-stage]');

    function setStatus(text) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      if (text) s.textContent = text;
    }

    // Rebuild the id/channel/duration maps from the playlist config. Channel
    // defaults to the video id (so a video with no channel still counts as its own
    // channel — diversity degrades gracefully, never divides by an empty axis).
    function indexPlaylist() {
      const pinned = Array.isArray(cfg.playlist) ? cfg.playlist : [];
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
    function show(id, record = true) {
      if (!byId[id] || !player) return;
      currentId = id;
      active = true;                 // something asked for a video: this instance is on screen
      player.load(id);
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
      if (cfg.shuffle === false) {
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

    function renderSchedule() {
      const el = mount.querySelector('[data-sched]');
      if (!el) return;
      const parts = Array.isArray(cfg.schedule) ? cfg.schedule.filter((d) => d && d.playlistId) : [];
      if (!parts.length) { el.textContent = ''; return; }
      const on = pickDaypart(cfg.schedule, nowDate());
      el.textContent = `Playlists by time of day: ${parts.map((d) => d.name).join(' · ')}`
        + (on ? ` — playing ${on.name} now` : '');
    }

    function updateLabel() {
      const el = mount.querySelector('[data-label]');
      if (!el) return;
      const v = currentId ? byId[currentId] : null;
      el.textContent = v ? (v.title || v.id) : `${ids.length} video${ids.length === 1 ? '' : 's'}`;
    }

    // Reflect the current playlist in the settings list (with per-row remove).
    function renderPlaylist() {
      const box = mount.querySelector('[data-list]');
      if (!box) return;
      box.innerHTML = '';
      for (const v of (cfg.playlist || [])) {
        const row = document.createElement('div');
        row.className = 'ytrow';
        row.innerHTML = `<span>${v.title || v.id}${v.channel ? ' · ' + v.channel : ''}</span>`;
        const rm = document.createElement('button');
        rm.textContent = '✕'; rm.title = 'remove';
        rm.addEventListener('click', () => {
          state.set({ playlist: (cfg.playlist || []).filter((x) => x.id !== v.id) });
        });
        row.append(rm);
        box.append(row);
      }
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
      const part = pickDaypart(cfg.schedule, nowDate());
      return part ? `Loading ${part.name}…` : 'Loading playlist…';
    }

    // Load whichever playlist the clock says, if any. Re-cueing the SAME list is skipped —
    // it would restart the pool and interrupt whatever is playing for no reason.
    function syncPlaylistSource() {
      const part = pickDaypart(cfg.schedule, nowDate());
      const wanted = (part && part.playlistId) || cfg.playlistId || '';
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
      const part = pickDaypart(cfg.schedule, nowDate());
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
      const wanted = !!pickDaypart(cfg.schedule, nowDate());
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
      syncPlaylistSource();
      syncScheduleWatch();
      indexPlaylist();
      renderPlaylist();
      renderSchedule();
      const sync = mount.querySelector('[data-opt="autoAdvance"]');
      if (sync) sync.checked = !!cfg.autoAdvance;
      const shuf = mount.querySelector('[data-opt="shuffle"]');
      if (shuf) shuf.checked = cfg.shuffle !== false;
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
              <label class="chk"><input type="checkbox" data-opt="autoAdvance"> auto-advance when a video ends</label>
              <label class="chk"><input type="checkbox" data-opt="shuffle"> shuffle (off = play the playlist in order)</label>
              <div class="addrow">
                <input type="text" data-add-url placeholder="YouTube link or id">
                <input type="text" data-add-channel placeholder="channel (optional)">
                <button data-add>Add</button>
              </div>
              <div class="addrow">
                <input type="text" data-list-url placeholder="playlist link or id (PL…)">
                <button data-set-list>Use playlist</button>
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
          // pause runs on `heldPauseMs` (hours); everything else runs on `stallMs` (seconds).
          // One watchdog instance, two clocks, because only one thing is ever being waited on.
          setTimer, clearTimer, retries: 1,
          stallMs: () => (stallReason === 'held' ? heldMs() : cfg.stallMs),
          onRetry: (id) => {
            // THE HOLD EXPIRED: four hours of complete stillness, so the room is empty and
            // she is the one left in front of a stopped screen. Drop to the ordinary ladder —
            // resume now, and if that does not take, `onGiveUp` moves on at the SHORT
            // interval rather than after another four hours.
            if (stallReason === 'held') {
              stallReason = 'paused';
              setHeld(false);
              player?.resume?.();
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
        // and cut short whatever is actually on screen.
        bus.subscribe('youtube/deactivate', () => { active = false; clearStall(); });

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
            // A daypart boundary crossed while this was playing: now is the moment to
            // change over, not mid-video.
            const switched = applyPendingPart();
            bus.publish('segment/done', { provider: 'youtube', reason: 'ended' });
            if (!switched && cfg.autoAdvance) bus.publish('youtube/next');
          },
          // An explicit player/API error already ends the segment; just stop the watchdog
          // so it can't fire a second `segment/done` for the same video.
          onError: () => { clearStall(); bus.publish('segment/done', { provider: 'youtube', reason: 'error' }); if (cfg.autoAdvance && ids.length > 1) bus.publish('youtube/next'); },
          onPlaying,
          onIdle,
        });

        // ANY SIGN OF A PERSON RESTARTS THE HOLD. This is what makes four hours the right
        // number rather than an absurd one: it is four hours of COMPLETE STILLNESS, not four
        // hours from the moment somebody pressed pause. A visit of any length keeps
        // re-arming it, and the clock only runs down once the room has actually emptied.
        // Extends a hold that is already running. *** THIS IS A BONUS, NOT THE MECHANISM. ***
        // It fires for input on THIS page — the module's own buttons, a switch, a keypress —
        // and is blind to a click inside the YouTube iframe, which is the most likely thing
        // a visitor actually touches. So a very long visit can still see one resume at the
        // `heldPauseMs` mark. The answer to that is a longer setting, not a cleverer guess.
        const heldBeat = () => {
          activity.note();
          if (stallReason === 'held' && stall?.armed()) stall.beat();
        };
        for (const topic of ['input/device', 'youtube/next', 'youtube/prev']) {
          bus.subscribe(topic, heldBeat);
        }
        mount.addEventListener('pointerdown', heldBeat, { passive: true });

        // the module's two sinks — any source pointed at these topics drives it
        bus.subscribe('youtube/next', () => advance());
        bus.subscribe('youtube/prev', () => prev());

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

      },
      onResize() {},
      onHide() { active = false; clearStall(); state.flush(); },
      destroy() {
        clearTimer(tickTimer); tickTimer = null;
        clearTimer(graceTimer); graceTimer = null;
        clearStall(); try { player?.destroy(); } catch { /* noop */ } player = null; },
    };
  },
);
