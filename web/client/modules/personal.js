// Personal videos — the recorded personal-message provider (interstitials' recorded
// track, re-homed as its own module). The real voice + face ARE the content
// (content-as-meaning: recorded track), so it plays media, it does not render/speak
// generated content.
//
// It is photos' twin for VIDEO, and shares the same spine:
//   config {sourceId, album, subjectName}  ->  media_sources resolver (/list)  ->
//   VIDEO items  ->  shared weighted picker (rng.js)  ->  play one clip  ->  a play
//   event (append-only) ; the picker's stats DERIVE from those.
//
// The bytes come straight from the user's media agent (BYO storage) — the platform
// server never sees them. Christine's first clips are Oscar's messages in
// `…/Voice messages/Oscar`.
//
// DIRECTOR-READY (like youtube): a clip ENDING is a `segment/done` on the bus — the
// uniform seam the content director advances on. Standalone it also auto-advances to
// the next clip (autoAdvance, default on); when a director drives this instance it
// seeds autoAdvance=false, so only segment/done fires and the DIRECTOR decides what
// plays next. Inputs are interchangeable via `personal/next` · `personal/prev` sinks.
//
// SOURCE WIRING is dev-seeded for now (the real picker is the future Media/Sources
// tab): saved config, or `?personalSource=<base_url>&personalAlbum=&personalSubject=`.

import { registerModule } from '../module.js';
import { createMediaSourcesClient, resolveListing } from '../media_sources.js';
import { pick, statsFromEvents } from '../rng.js';

const DEFAULTS = { sourceId: '', album: '', subjectName: '', autoAdvance: true, autoplay: true, directed: false, fit: 'contain' };
const RECENT_CAP = 12;

registerModule(
  { type: 'personal', title: 'Personal videos', description: 'recorded messages from your people (BYO storage)' },
  (ctx) => {
    const { mount, bus, state, events, user } = ctx;
    const client = createMediaSourcesClient({ user });

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {};
    let stats = {};
    let recent = [];
    let history = [], histPos = -1;
    let currentId = null;
    let videoEndOff = null;
    let lastSourceRef = null;
    let loadSeq = 0;
    let sourceLabel = '';

    const stage = () => mount.querySelector('[data-stage]');
    const subjectName = () => (cfg.subjectName || sourceLabel || cfg.album || 'Someone');

    function setStatus(text, showRetry = false) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      if (text) {
        s.innerHTML = `<span>${text}</span>` + (showRetry ? ` <button data-retry>Retry</button>` : '');
        s.querySelector('[data-retry]')?.addEventListener('click', () => reload());
      }
    }
    function setName() {
      const el = mount.querySelector('[data-name]');
      if (el) el.textContent = currentId ? `From ${subjectName()}` : '';
    }

    function clearVideoEnd() { if (videoEndOff) { videoEndOff(); videoEndOff = null; } }

    // A clip finishing is BOTH a segment/done (the director's seam) AND, when
    // standalone, a self-advance to the next clip. When a director drives us it seeds
    // autoAdvance=false, so only segment/done fires.
    function onClipEnded() {
      bus.publish('segment/done', { provider: 'personal', reason: 'ended' });
      if (cfg.autoAdvance) bus.publish('personal/next');
    }

    function render(item) {
      const st = stage();
      if (!st) return;
      clearVideoEnd();
      st.innerHTML = '';
      const el = document.createElement('video');
      el.src = item.url;
      el.controls = false;
      el.playsInline = true;
      el.autoplay = cfg.autoplay !== false;
      el.preload = el.autoplay ? 'auto' : 'none';   // don't buffer big clips when autoplay is off (tests)
      el.style.objectFit = cfg.fit;
      el.addEventListener('ended', onClipEnded);
      videoEndOff = () => el.removeEventListener('ended', onClipEnded);
      st.append(el);
      if (el.autoplay) el.play?.().catch(() => {});   // autoplay-with-sound may need a gesture in some browsers
    }

    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      currentId = id;
      render(item);
      setName();
      if (record) {
        recent.push(id);
        if (recent.length > RECENT_CAP) recent.shift();
        history = history.slice(0, histPos + 1);
        history.push(id); histPos = history.length - 1;
        events.append('play', { id, at: Date.now() }).catch((e) => console.error('personal: play log', e));
      }
    }

    function advance() {
      if (!ids.length) {
        // nothing to show — hand back to the director rather than freeze the stage.
        bus.publish('segment/done', { provider: 'personal', reason: 'empty' });
        return;
      }
      const id = pick(ids, stats, { now: Date.now(), rand: Math.random, recent });
      if (id) show(id, true);
    }

    function prev() { if (histPos > 0) { histPos -= 1; show(history[histPos], false); } }

    function deriveStats(cache) {
      const plays = (cache.events || [])
        .filter((e) => e.kind === 'play')
        .map((e) => ({ id: e.data?.id, at: e.data?.at || Date.parse(e.created_at) || 0 }));
      return statsFromEvents(plays, { idKey: 'id', atKey: 'at' });
    }

    async function ensureSource() {
      const sources = await client.list();
      if (cfg.sourceId) {
        const found = sources.find((s) => s.id === cfg.sourceId);
        if (found) return found;
      }
      const qp = new URLSearchParams(location.search);
      const ps = qp.get('personalSource');
      if (ps) {
        const base = ps.replace(/\/+$/, '');
        const existing = sources.find((s) => s.base_url === base);
        const src = existing || await client.add({ label: 'dev personal', base_url: base, kind: 'agent' });
        state.set({ sourceId: src.id, album: qp.get('personalAlbum') || cfg.album, subjectName: qp.get('personalSubject') || cfg.subjectName });
        return src;
      }
      if (sources.length === 1) { state.set({ sourceId: sources[0].id }); return sources[0]; }
      return null;
    }

    async function reload() {
      const seq = ++loadSeq;
      clearVideoEnd();
      setStatus('Loading messages…');
      let source;
      try { source = await ensureSource(); }
      catch (e) { if (seq === loadSeq) setStatus('Could not reach the platform', true); return; }
      if (seq !== loadSeq) return;
      if (!source) { setStatus('No personal-video source connected. Add one in Media / Sources.'); items = ids = []; byId = {}; return; }
      let listing;
      try { listing = await resolveListing(source, cfg.album); }
      catch (e) { if (seq === loadSeq) setStatus(`Source “${source.label}” unreachable`, true); return; }
      if (seq !== loadSeq) return;
      sourceLabel = source.label;
      // recorded PERSONAL videos: keep only video clips (audio-only messages are a later add)
      items = listing.items.filter((it) => it.kind === 'video');
      byId = Object.fromEntries(items.map((it) => [it.id, it]));
      ids = items.map((it) => it.id);
      recent = []; history = []; histPos = -1;
      const lbl = mount.querySelector('[data-source-label]');
      if (lbl) lbl.textContent = `${subjectName()} — ${items.length} clip${items.length === 1 ? '' : 's'}`;
      if (!items.length) { setStatus('No videos in this source/album.'); return; }
      setStatus(null);
      // A `directed` instance waits for the content director to advance it (so a
      // hidden, freshly-loaded provider never emits a spurious segment/done). Standalone
      // it autostarts the first clip.
      if (!cfg.directed) advance();
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="personal">
            <div class="stage" data-stage></div>
            <div class="caption" data-name></div>
            <div class="status" data-status hidden></div>
            <div class="nav">
              <button class="pbtn" data-prev aria-label="previous message">‹</button>
              <span class="source-label" data-source-label></span>
              <button class="pbtn" data-next aria-label="next message">›</button>
            </div>
          </div>`;

        bus.subscribe('personal/next', () => advance());
        bus.subscribe('personal/prev', () => prev());

        const nav = bus.createSource('personal-nav');
        bus.addBinding({ source: 'personal-nav', signal: 'next', topic: 'personal/next' });
        bus.addBinding({ source: 'personal-nav', signal: 'prev', topic: 'personal/prev' });
        mount.querySelector('[data-next]').addEventListener('click', () => nav.emit('next'));
        mount.querySelector('[data-prev]').addEventListener('click', () => nav.emit('prev'));

        events.subscribe((cache) => { stats = deriveStats(cache); });

        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          const ref = `${cfg.sourceId}|${cfg.album}`;
          if (ref !== lastSourceRef) { lastSourceRef = ref; reload(); }
          else { setName(); const lbl = mount.querySelector('[data-source-label]'); if (lbl && ids.length) lbl.textContent = `${subjectName()} — ${ids.length} clip${ids.length === 1 ? '' : 's'}`; }
        });
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() { clearVideoEnd(); },
    };
  },
);
