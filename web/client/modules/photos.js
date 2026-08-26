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
import { normalizeField, fieldValue } from '../settings_fields.js';
import { createMediaSourcesClient, resolveListing } from '../media_sources.js';
import { pick, statsFromEvents } from '../rng.js';

// `fit: contain` — SHOW THE WHOLE PHOTO. It defaulted to `cover`, which crops to fill:
// a 1200x800 photo in a 775x423 panel lost 18% of its height, off the top and bottom,
// which is exactly where faces are. For a module whose entire reason for existing is
// Christine seeing her people, cropping their heads off is not a rendering preference.
// The letterboxing `contain` would otherwise leave is filled by a blurred copy of the
// same image (see `render`), so nothing is cropped AND nothing is a black bar.
const DEFAULTS = { sourceId: '', album: '', intervalMs: 8000, fit: 'contain' };
const RECENT_CAP = 12;          // in-memory anti-repeat window (picker also hard-excludes)
const albumOf = (path) => { const i = String(path).lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); };

// WHAT THE SETTINGS MENU SHOWS.
//
// `intervalMs` IS STORED IN MILLISECONDS and shown in seconds - the house rule for every
// duration in the product (see settings_fields.js). It used to be `intervalSec`, and the KEY
// changed rather than the meaning of the old one: an un-migrated `8` under a key that now
// means milliseconds would advance the slideshow a hundred and twenty five times a second.
// `legacy` below is the whole migration - old values are read, scaled and shown correctly,
// and the next thing written is the new key.
//
// `intervalMs` IS A CHOICE, NOT A NUMBER, and the reason is presses. With one switch you
// walk a control one press at a time and can only travel one way, so the number of stops IS
// the cost of using it: the legal range 2-60 in ones is fifty-eight presses to get back
// where you started, and even a sensible 4-40 in fours is ten. The five values anybody
// actually wants are five presses. A number is the right kind for a real range - pond`s
// ambientMs is one - and the wrong kind for a short list of known-good values.
//
// `sourceId` is a LIVE choice: the options are this account's media sources, which are data
// and cannot be written into a manifest. See `settingsChoices` below.
//
// `album` is TEXT and therefore not cycleable, and it says so rather than pretending. Nobody
// picks one of four hundred albums one press at a time, and a fake affordance is worse than
// an absent one.
const SETTINGS = [
  { key: 'intervalMs', label: 'Change photo every', kind: 'choice', default: 8000,
    level: 'essential',
    legacy: { key: 'intervalSec', scale: 1000 },
    options: [
      { value: 4000, label: '4 seconds' },
      { value: 8000, label: '8 seconds' },
      { value: 15000, label: '15 seconds' },
      { value: 30000, label: '30 seconds' },
      { value: 60000, label: '60 seconds' },
    ] },
  { key: 'fit', label: 'How photos fit', kind: 'choice', default: 'contain', level: 'essential',
    options: [
      { value: 'contain', label: 'Show the whole photo' },
      { value: 'cover', label: 'Fill the panel' },
    ] },
  { key: 'sourceId', label: 'Photos from', kind: 'choice', default: '', level: 'standard',
    emptyLabel: 'No source connected' },
  { key: 'album', label: 'Album', kind: 'text', default: '', level: 'standard',
    placeholder: 'Everything', note: 'set in Media / Sources' },
];

// THE DECLARATION IS THE TYPE, and this is the one place that decides it. `intervalSec` is
// a number; `fit` is a string; a checkbox is a boolean. A DOM control cannot know that - a
// <select> hands back `"15"` whatever it was given - so anything this module writes goes
// through the same canonicaliser the settings menu uses, and the two surfaces cannot disagree
// about what a value IS.
const FIELDS = Object.fromEntries(
  SETTINGS.map(normalizeField).filter(Boolean).map((f) => [f.key, f]),
);
const canonical = (key, raw) => (FIELDS[key] ? fieldValue(FIELDS[key], { [key]: raw }) : raw);

registerModule(
  // CRITICAL, and it is not a compliment - it is the audit's threshold. CLAUDE.md: *"PHOTOS
  // outrank every game/feature."* Christine is at this screen around the clock and it is her
  // main window to her people, so a setting on this panel that is expensive to reach is a
  // real problem at half the presses it would take to be one anywhere else.
  // FALLBACK EXPOSURE: `local`. The bytes come from the media agent rather than the platform,
  // so photos survive the platform being down - which is most of why this is the fallback of
  // choice - but not the drive being unmounted.
  { type: 'photos', title: 'Photos', description: 'slideshow over your own media (BYO storage)',
    importance: 'critical', dependsOn: 'local', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events, user } = ctx;
    // `ctx.sources` is injectable so a page can supply its own registry — signed out, the
    // kiosk hands in one holding the bundled sample images, which is how a stranger sees a
    // working screen without being asked for their own photos before they trust the site.
    // Everywhere else this is the real registry, cached so it survives a server blip.
    // `ctx.personId` SCOPES THE REGISTRY TO WHOSE SCREEN THIS IS: her own sources plus the
    // account-wide ones, and never another resident's. Undefined on any host that has not
    // wired it - the dev harness, a signed-out demo - which keeps the account-wide view
    // those surfaces already had.
    const client = ctx.sources
      || createMediaSourcesClient({ user, cache: true, personId: ctx.personId || null });

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {}, channels = {};
    let stats = {};                 // derived from play events
    let recent = [];                // ids recently shown (in-memory, immediate)
    let history = [], histPos = -1; // for prev()
    let currentId = null;
    let advanceTimer = null;
    let videoEndOff = null;
    let lastSourceRef = null;       // to reload only when sourceId/album change
    // The account's sources, cached from the listing call `reload` already makes. THE MENU
    // PAINTS SYNCHRONOUSLY, so `settingsChoices` cannot go to the network: a row that waits
    // on a facility connection to draw is a row that looks broken.
    let knownSources = [];
    let loadSeq = 0;                // guards against overlapping reloads (races)

    const stage = () => mount.querySelector('[data-stage]');

    // A STATUS MESSAGE MUST NOT BLACK OUT A PHOTO THAT IS ALREADY THERE. It used to be a
    // full-bleed 72%-opaque scrim in every case, so "Loading photos…" — which fires on
    // every reload, including the periodic one — dropped a dark green sheet over the
    // picture Christine was looking at. Over an EMPTY stage a full panel is right; there
    // is nothing to obscure and something has to explain the emptiness. Over a photo it
    // becomes a small corner chip.
    function setStatus(text, showRetry = false) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      s.classList.toggle('chip', !!stage()?.dataset.showing);
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
      // A FLOOR, not a clamp to the declared options: a value from before the migration, or
      // from a group-apply that has not been validated yet, must not turn the slideshow into
      // a strobe in front of somebody with a brain injury.
      const ms = Math.max(2000, Number(cfg.intervalMs) || DEFAULTS.intervalMs);
      advanceTimer = setTimeout(() => bus.publish('photos/next'), ms);
    }

    function render(item) {
      const st = stage();
      if (!st) return;
      st.innerHTML = '';
      // The blurred backdrop that makes `contain` bearable on a wide panel: the same
      // image, scaled to COVER and blurred out, sitting behind the real one. Every photo
      // frame worth using does this. Skipped for `cover` (nothing to fill) and for video
      // (a second decoding video to blur is not worth the battery on a Pi).
      if (cfg.fit === 'contain' && item.kind !== 'video') {
        const back = document.createElement('div');
        back.className = 'fill';
        back.style.backgroundImage = `url("${String(item.url).replace(/"/g, '%22')}")`;
        st.append(back);
      }
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
      el.className = 'shot';
      st.append(el);
      // Whether the panel has something to look at decides how a status message is drawn
      // — a corner chip over a photo, a full panel over nothing. See setStatus.
      st.dataset.showing = '1';
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
      knownSources = sources;
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
        // Nothing to show from here on, so a later message is a full panel again.
        if (stage()) stage().dataset.showing = '';
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
                <!-- THE SAME FIVE VALUES THE SETTINGS MENU OFFERS. Two surfaces offering
                     different options for one setting is the drift the declared-settings
                     slice exists to remove, and it shows up as a gear dropdown that goes
                     blank whenever somebody picks 60 in the menu. -->
                <select data-opt="intervalMs">
                  <option value="4000">4s</option><option value="8000">8s</option>
                  <option value="15000">15s</option><option value="30000">30s</option>
                  <option value="60000">60s</option>
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
            // WRITE THE DECLARED TYPE, NOT THE DOM'S. This control wrote `intervalSec` as the
            // string "15" for as long as photos has existed, which meant storage held one type
            // and the declaration another - and a setting that cannot be compared cannot be
            // applied to a GROUP of panels at once, which is where this was heading.
            state.set({ [key]: canonical(key, el.type === 'checkbox' ? el.checked : el.value) });
          });
        });

        // play history -> picker stats
        events.subscribe((cache) => { stats = deriveStats(cache); });

        // config: adopt saved settings; reload the listing only when the source ref
        // (sourceId/album) changes — interval/fit are applied without a reload.
        state.subscribe((s) => {
          // READ EVERY DECLARED FIELD THROUGH ITS DECLARATION. That is what applies the
          // seconds-to-milliseconds migration, the type coercion and the option matching in
          // one line - and it is what guarantees the module and the settings menu are looking
          // at the same number rather than two readings of the same storage.
          cfg = { ...DEFAULTS, ...s };
          for (const f of Object.values(FIELDS)) cfg[f.key] = fieldValue(f, s || {});
          syncControls();
          const ref = `${cfg.sourceId}|${cfg.album}`;
          if (ref !== lastSourceRef) { lastSourceRef = ref; reload(); }
          else if (currentId) { const el = stage()?.firstChild; if (el) el.style.objectFit = cfg.fit; }
        });
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() { clearAdvance(); },

      // LIVE OPTIONS for a declared field. The manifest stays static - it is the contract, and
      // a modules tab will want to read it off a module that is not even running - while the
      // options that are genuinely DATA come from the mounted instance.
      //
      // One source means nothing to choose, and the shell renders that row disabled with the
      // reason instead of offering a cycle that lands back where it started. That is not a
      // degraded case; it is the common one, and saying it out loud is how somebody learns
      // why the picker will not move.
      settingsChoices: () => ({
        sourceId: knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
      }),
    };
  },
);
