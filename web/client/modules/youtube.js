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
import { pick, statsFromEvents } from '../rng.js';

const DEFAULTS = { playlist: [], autoAdvance: true, directed: false };
const RECENT_CAP = 12;          // in-memory anti-repeat window (picker also hard-excludes)

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

function createYtPlayer(mountEl, { onEnded, onError }) {
  let player = null, ready = false, pending = null, destroyed = false;
  const host = document.createElement('div');
  mountEl.append(host);

  loadIframeApi().then((YT) => {
    if (destroyed) return;
    player = new YT.Player(host, {
      host: 'https://www.youtube-nocookie.com',
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: () => { ready = true; if (pending) { player.loadVideoById(pending); pending = null; } },
        onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED) onEnded?.(); },
        onError: (e) => onError?.(e?.data),
      },
    });
  }).catch((err) => onError?.(err));

  return {
    load(id) { if (destroyed) return; if (ready && player) player.loadVideoById(id); else pending = id; },
    stop() { pending = null; try { player?.stopVideo?.(); } catch { /* not ready */ } },
    destroy() { destroyed = true; pending = null; try { player?.destroy?.(); } catch { /* noop */ } host.remove(); },
  };
}

registerModule(
  { type: 'youtube', title: 'YouTube', description: 'weighted-shuffle player over your own playlist (public videos)' },
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
      const list = Array.isArray(cfg.playlist) ? cfg.playlist : [];
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
      player.load(id);
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

    function applyConfig() {
      indexPlaylist();
      renderPlaylist();
      const sync = mount.querySelector('[data-opt="autoAdvance"]');
      if (sync) sync.checked = !!cfg.autoAdvance;
      if (!ids.length) { setStatus('No videos yet. Add one in settings.'); currentId = null; updateLabel(); return; }
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
            <div class="status" data-status hidden></div>
            <div class="nav">
              <button class="ybtn" data-prev aria-label="previous video">‹</button>
              <span class="yt-label" data-label></span>
              <button class="ybtn" data-next aria-label="next video">›</button>
            </div>
            <button class="gear" data-gear aria-label="youtube settings">⚙</button>
            <div class="settings" data-settings hidden>
              <label class="chk"><input type="checkbox" data-opt="autoAdvance"> auto-advance when a video ends</label>
              <div class="addrow">
                <input type="text" data-add-url placeholder="YouTube link or id">
                <input type="text" data-add-channel placeholder="channel (optional)">
                <button data-add>Add</button>
              </div>
              <div class="list" data-list></div>
            </div>
          </div>`;

        // the player adapter owns the stage; the video ending is just another source.
        // A video ending is ALSO a `segment/done` on the bus — the uniform seam the
        // content director listens on (ended | skipped | timeout are equivalent to it).
        // Harmless when standalone (no director subscribed); when a director drives this
        // instance it seeds autoAdvance=false, so only segment/done fires — the director
        // advances, not youtube itself.
        player = makePlayer(stage(), {
          onEnded: () => { bus.publish('segment/done', { provider: 'youtube', reason: 'ended' }); if (cfg.autoAdvance) bus.publish('youtube/next'); },
          onError: () => { bus.publish('segment/done', { provider: 'youtube', reason: 'error' }); if (cfg.autoAdvance && ids.length > 1) bus.publish('youtube/next'); },
        });

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
        mount.querySelector('[data-add]').addEventListener('click', () => addFromInput());
        mount.querySelector('[data-add-url]').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput(); });
        mount.querySelector('[data-opt="autoAdvance"]').addEventListener('change', (e) => {
          state.set({ autoAdvance: e.target.checked });
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
      onHide() { state.flush(); },
      destroy() { try { player?.destroy(); } catch { /* noop */ } player = null; },
    };
  },
);
