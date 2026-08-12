// Photos — the highest-priority default module (slice 3c-3).
//
// A slideshow over a user's OWN media, pulled straight from their media agent:
//   config {sourceId, album}  ->  registry lookup  ->  resolver (/list)  ->  items
//   advance  ->  shared weighted picker (rng.js)  ->  show  ->  append a play event
//
// It ties together the three prior pieces without re-implementing any of them:
//   * media_sources.js resolves {sourceId, album} to renderable URLs — the bytes
//     come from the agent, never the platform server.
//   * rng.js picks the next item (freshness × recency × duration × album-diversity),
//     with an in-memory `recent` list giving an immediate "don't repeat" guarantee.
//   * play history is APPEND-ONLY events; the picker's long-run stats DERIVE from
//     them (statsFromEvents), so nothing is a mutable store of record.
//
// Inputs are interchangeable via the bus: the module opens sinks on `photos/next`
// and `photos/prev`, fed by its own buttons AND by an auto-advance timer AND by any
// other source (switch, scan, voice) that a binding points at those topics — with
// zero change here.
//
// SOURCE WIRING (slice 3c-3 is module-only, dev-seeded): the real source-picker UI
// is the future Media/Sources tab. For now the source comes from saved config, or,
// as a dev convenience, from `?photoSource=<base_url>&photoAlbum=<album>` which the
// module registers once and remembers.

import { registerModule } from '../module.js';
import { createMediaSourcesClient, resolveListing } from '../media_sources.js';
import { pick, statsFromEvents } from '../rng.js';

const DEFAULTS = { sourceId: '', album: '', intervalSec: 8, fit: 'cover' };
const RECENT_CAP = 12;          // in-memory anti-repeat window (picker also hard-excludes)
const albumOf = (path) => { const i = String(path).lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); };

registerModule(
  { type: 'photos', title: 'Photos', description: 'slideshow over your own media (BYO storage)' },
  (ctx) => {
    const { mount, bus, state, events, user } = ctx;
    const client = createMediaSourcesClient({ user });

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {}, channels = {};
    let stats = {};                 // derived from play events
    let recent = [];                // ids recently shown (in-memory, immediate)
    let history = [], histPos = -1; // for prev()
    let currentId = null;
    let advanceTimer = null;
    let videoEndOff = null;
    let lastSourceRef = null;       // to reload only when sourceId/album change
    let loadSeq = 0;                // guards against overlapping reloads (races)

    const stage = () => mount.querySelector('[data-stage]');

    function setStatus(text, showRetry = false) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      if (text) {
        s.innerHTML = `<span>${text}</span>` + (showRetry ? ` <button data-retry>Retry</button>` : '');
        s.querySelector('[data-retry]')?.addEventListener('click', () => reload());
      }
    }

    function clearAdvance() {
      if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
      if (videoEndOff) { videoEndOff(); videoEndOff = null; }
    }

    function scheduleAdvance(item) {
      clearAdvance();
      if (item.kind === 'video') return;   // videos advance on 'ended' (bound in render)
      const secs = Math.max(2, Number(cfg.intervalSec) || DEFAULTS.intervalSec);
      advanceTimer = setTimeout(() => bus.publish('photos/next'), secs * 1000);
    }

    function render(item) {
      const st = stage();
      if (!st) return;
      st.innerHTML = '';
      let el;
      if (item.kind === 'video') {
        el = document.createElement('video');
        el.src = item.url; el.muted = true; el.autoplay = true; el.playsInline = true;
        el.play?.().catch(() => {});
        const onEnded = () => bus.publish('photos/next');
        el.addEventListener('ended', onEnded);
        videoEndOff = () => el.removeEventListener('ended', onEnded);
      } else {
        el = document.createElement('img');
        el.src = item.url; el.alt = item.name || '';
      }
      el.style.objectFit = cfg.fit;
      st.append(el);
    }

    // Show an item by id. `record` distinguishes a forward play (counts, logs a play
    // event, extends history) from a prev()/replay (neither).
    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      currentId = id;
      render(item);
      scheduleAdvance(item);
      if (record) {
        recent.push(id);
        if (recent.length > RECENT_CAP) recent.shift();
        // truncate any forward history (we branched) and append
        history = history.slice(0, histPos + 1);
        history.push(id); histPos = history.length - 1;
        // durable, append-only play record; picker stats derive from these
        events.append('play', { id, at: Date.now() }).catch((e) => console.error('photos: play log', e));
      }
    }

    function advance() {
      if (!ids.length) return;
      const id = pick(ids, stats, { now: Date.now(), rand: Math.random, recent, channels });
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

    async function ensureSource() {
      const sources = await client.list();
      if (cfg.sourceId) {
        const found = sources.find((s) => s.id === cfg.sourceId);
        if (found) return found;
      }
      // dev seed via query param: register once, then remember in config
      const qp = new URLSearchParams(location.search);
      const ps = qp.get('photoSource');
      if (ps) {
        const base = ps.replace(/\/+$/, '');
        const existing = sources.find((s) => s.base_url === base);
        const src = existing || await client.add({ label: 'dev photos', base_url: base, kind: 'agent' });
        state.set({ sourceId: src.id, album: qp.get('photoAlbum') || cfg.album });
        return src;
      }
      if (sources.length === 1) { state.set({ sourceId: sources[0].id }); return sources[0]; }
      return null;
    }

    async function reload() {
      const seq = ++loadSeq;
      clearAdvance();
      setStatus('Loading photos…');
      let source;
      try {
        source = await ensureSource();
      } catch (e) {
        if (seq === loadSeq) setStatus('Could not reach the platform', true);
        return;
      }
      if (seq !== loadSeq) return;   // a newer reload superseded us
      if (!source) {
        setStatus('No photo source connected. Add one in Media / Sources.');
        items = ids = []; byId = channels = {};
        return;
      }
      let listing;
      try {
        listing = await resolveListing(source, cfg.album);
      } catch (e) {
        if (seq === loadSeq) setStatus(`Source “${source.label}” unreachable`, true);
        return;
      }
      if (seq !== loadSeq) return;
      items = listing.items;
      byId = Object.fromEntries(items.map((it) => [it.id, it]));
      ids = items.map((it) => it.id);
      channels = Object.fromEntries(items.map((it) => [it.id, albumOf(it.path)]));
      recent = []; history = []; histPos = -1;
      mount.querySelector('[data-source-label]').textContent =
        `${source.label}${cfg.album ? ' · ' + cfg.album : ''} — ${items.length} item${items.length === 1 ? '' : 's'}`;
      if (!items.length) { setStatus('No photos in this source/album.'); return; }
      setStatus(null);
      advance();
    }

    function syncControls() {
      mount.querySelectorAll('[data-opt]').forEach((el) => {
        const key = el.dataset.opt;
        if (el.type === 'checkbox') el.checked = !!cfg[key];
        else el.value = cfg[key];
      });
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="photos">
            <div class="stage" data-stage></div>
            <div class="status" data-status hidden></div>
            <div class="nav">
              <button class="pbtn" data-prev aria-label="previous photo">‹</button>
              <span class="source-label" data-source-label></span>
              <button class="pbtn" data-next aria-label="next photo">›</button>
            </div>
            <button class="gear" data-gear aria-label="photo settings">⚙</button>
            <div class="settings" data-settings hidden>
              <label>every
                <select data-opt="intervalSec">
                  <option value="4">4s</option><option value="8">8s</option>
                  <option value="15">15s</option><option value="30">30s</option>
                </select>
              </label>
              <label>fit
                <select data-opt="fit"><option value="cover">cover</option><option value="contain">contain</option></select>
              </label>
            </div>
          </div>`;

        // the module's two sinks — any source pointed at these topics drives it
        bus.subscribe('photos/next', () => advance());
        bus.subscribe('photos/prev', () => prev());

        // its own buttons are just another source
        const nav = bus.createSource('photos-nav');
        bus.addBinding({ source: 'photos-nav', signal: 'next', topic: 'photos/next' });
        bus.addBinding({ source: 'photos-nav', signal: 'prev', topic: 'photos/prev' });
        mount.querySelector('[data-next]').addEventListener('click', () => nav.emit('next'));
        mount.querySelector('[data-prev]').addEventListener('click', () => nav.emit('prev'));

        mount.querySelector('[data-gear]').addEventListener('click', () => {
          const s = mount.querySelector('[data-settings]');
          s.hidden = !s.hidden;
        });
        mount.querySelectorAll('[data-opt]').forEach((el) => {
          el.addEventListener('change', () => {
            const key = el.dataset.opt;
            state.set({ [key]: el.type === 'checkbox' ? el.checked : el.value });
          });
        });

        // play history -> picker stats
        events.subscribe((cache) => { stats = deriveStats(cache); });

        // config: adopt saved settings; reload the listing only when the source ref
        // (sourceId/album) changes — interval/fit are applied without a reload.
        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          syncControls();
          const ref = `${cfg.sourceId}|${cfg.album}`;
          if (ref !== lastSourceRef) { lastSourceRef = ref; reload(); }
          else if (currentId) { const el = stage()?.firstChild; if (el) el.style.objectFit = cfg.fit; }
        });
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() { clearAdvance(); },
    };
  },
);
