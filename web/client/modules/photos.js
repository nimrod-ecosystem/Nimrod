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
import { createWatchdog } from '../watchdog.js';
import { pick, statsFromEvents } from '../rng.js';

// `fit: contain` — SHOW THE WHOLE PHOTO. It defaulted to `cover`, which crops to fill:
// a 1200x800 photo in a 775x423 panel lost 18% of its height, off the top and bottom,
// which is exactly where faces are. For a module whose entire reason for existing is
// somebody seeing their people, cropping their heads off is not a rendering preference.
// The letterboxing `contain` would otherwise leave is filled by a blurred copy of the
// same image (see `render`), so nothing is cropped AND nothing is a black bar.
const DEFAULTS = { sourceId: '', album: '', intervalMs: 8000, fit: 'contain' };
// How long a video may go without reporting progress before the slideshow moves on. It is
// NOT `intervalMs` — that is how long a still photo is shown, and a video is allowed to be
// much longer than that. Fifteen seconds of a video that is supposedly playing saying
// nothing at all is a stall by any reading.
const VIDEO_STALL_MS = 15000;
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

// *** WHAT A FAILED LISTING SHOULD SAY, AS A PURE FUNCTION. ***
//
// Exported and separated from the panel because THE WORDS ARE THE PRODUCT here. This module
// reported *"Source X unreachable"* for every failure, including a folder on this very device
// whose permission had lapsed — which describes a dead network agent and sends whoever reads it
// to check their wifi for a problem that is one click away. That was recorded in §E-fail as
// "the wrong words", and it sat there because the branch was buried in a catch block inside a
// DOM callback, where nothing could reach it to check.
//
// `action` is a button beyond Retry. It exists for the permission case, where "Retry" is
// actively wrong: retrying cannot work, because the browser will not re-grant access without a
// user gesture aimed at asking for it.
export function listingFailure(err, source = {}, album = '') {
  const code = err && err.code;
  if (code === 'permission') {
    return { text: 'These photos need permission again.', retry: false, action: 'Allow' };
  }
  if (code === 'missing') {
    return {
      text: 'This device no longer has that folder. Reconnect it in Media / Sources.',
      retry: false, action: null,
    };
  }
  if (code === 'album') {
    return { text: `No album “${album}” in that folder.`, retry: true, action: null };
  }
  // Anything else genuinely is "we could not reach it" — a real agent that stopped answering,
  // a server that 500ed. The original sentence, now only where it is true.
  return { text: `Source “${source.label}” unreachable`, retry: true, action: null };
}

registerModule(
  // CRITICAL, and it is not a compliment - it is the audit's threshold. CLAUDE.md: *"PHOTOS
  // outrank every game/feature."* Somebody may be at this screen around the clock and it is their
  // main window to her people, so a setting on this panel that is expensive to reach is a
  // real problem at half the presses it would take to be one anywhere else.
  // FALLBACK EXPOSURE: `local`. The bytes come from the media agent rather than the platform,
  // so photos survive the platform being down - which is most of why this is the fallback of
  // choice - but not the drive being unmounted.
  { type: 'photos', title: 'Photos', description: 'Their own photos, on a loop. For most people this is the whole reason to set a screen up.',
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
    let currentVideo = null;

    // Injected by the tests (and available to any host that wants control), exactly as
    // youtube.js does it. Without this, asserting that a stalled video is skipped means
    // waiting fifteen real seconds, and a test nobody wants to run is a test nobody runs.
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    const videoStallMs = () => Number(ctx.videoStallMs ?? VIDEO_STALL_MS);
    let lastSourceRef = null;       // to reload only when sourceId/album change
    // The account's sources, cached from the listing call `reload` already makes. THE MENU
    // PAINTS SYNCHRONOUSLY, so `settingsChoices` cannot go to the network: a row that waits
    // on a facility connection to draw is a row that looks broken.
    let knownSources = [];
    // The sources found when there was more than one and none chosen — so the message can
    // NAME them instead of saying nothing is connected when several things are.
    let multiSource = null;
    let loadSeq = 0;                // guards against overlapping reloads (races)

    const stage = () => mount.querySelector('[data-stage]');

    // A STATUS MESSAGE MUST NOT BLACK OUT A PHOTO THAT IS ALREADY THERE. It used to be a
    // full-bleed 72%-opaque scrim in every case, so "Loading photos…" — which fires on
    // every reload, including the periodic one — dropped a dark green sheet over the
    // picture somebody was looking at. Over an EMPTY stage a full panel is right; there
    // is nothing to obscure and something has to explain the emptiness. Over a photo it
    // becomes a small corner chip.
    // `action` adds ONE button beyond Retry: `{ label, run }`. It exists for the folder
    // permission case, where "Retry" is exactly the wrong word — retrying does nothing, because
    // the browser will not re-grant access without a gesture aimed at asking for it.
    function setStatus(text, showRetry = false, action = null) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      s.classList.toggle('chip', !!stage()?.dataset.showing);
      if (text) {
        s.innerHTML = `<span>${text}</span>`
          + (action ? ` <button data-action>${escapeHtml(action.label)}</button>` : '')
          + (showRetry ? ` <button data-retry>Retry</button>` : '');
        s.querySelector('[data-retry]')?.addEventListener('click', () => reload());
        // The click IS the user gesture the permission prompt requires. That is the whole
        // reason this is a button on the panel rather than something the module retries on a
        // timer: no amount of retrying can produce a gesture.
        s.querySelector('[data-action]')?.addEventListener('click', () => action.run());
      }
    }

    function escapeHtml(t) {
      return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ------------------------------------------------------------------------------
    // *** THE VIDEO SAFETY NET (added 2026-08-27) ***
    //
    // `scheduleAdvance` deliberately does NOT set a timer for a video, because a video
    // should run to its own length rather than being cut off after eight seconds. That is
    // right, and it left the slideshow with exactly ONE way out of a video: the `ended`
    // event.
    //
    // A video that stalls, errors, or is paused by the browser never fires `ended`. So the
    // slideshow stopped on that frame FOREVER — no timer, no fallback, and nobody in the
    // room able to press anything. On the module that runs 24/7 and outranks every other
    // feature, that is the worst version of the bug.
    //
    // The fix is the shared watchdog used as a HEARTBEAT rather than a load timer:
    // `timeupdate` fires several times a second while a video is genuinely playing, and
    // `beat()` restarts the clock on each one. So a three-hour video is never interrupted,
    // and a video that goes quiet for `stallMs` is retried once and then skipped.
    //
    // beat(), NOT ok(). ok() would silence the watchdog after the first heartbeat and it
    // would never fire again — see the note in watchdog.js. This distinction is the whole
    // reason those are two functions.
    const videoStall = createWatchdog({
      setTimer, clearTimer,
      stallMs: videoStallMs,
      retries: 1,
      onRetry: () => { try { currentVideo?.play?.().catch(() => {}); } catch { /* gone */ } },
      onGiveUp: () => { bus.publish('photos/next'); },
    });

    function clearAdvance() {
      if (advanceTimer) { clearTimer(advanceTimer); advanceTimer = null; }
      if (videoEndOff) { videoEndOff(); videoEndOff = null; }
      videoStall.disarm();
      currentVideo = null;
    }

    function scheduleAdvance(item) {
      clearAdvance();
      if (item.kind === 'video') return;   // videos advance on 'ended' + the watchdog above
      // A FLOOR, not a clamp to the declared options: a value from before the migration, or
      // from a group-apply that has not been validated yet, must not turn the slideshow into
      // a strobe in front of somebody with a brain injury.
      const ms = Math.max(2000, Number(cfg.intervalMs) || DEFAULTS.intervalMs);
      advanceTimer = setTimer(() => bus.publish('photos/next'), ms);
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
        // MUTED, so the browser's autoplay policy cannot refuse it. A clip in the photo
        // rotation is wallpaper; `modules/personal.js` is where a voice is the point.
        el.src = item.url; el.muted = true; el.autoplay = true; el.playsInline = true;
        currentVideo = el;
        const onEnded = () => { videoStall.disarm(); bus.publish('photos/next'); };
        // An explicit failure needs no waiting out: move on now.
        const onError = () => { videoStall.disarm(); bus.publish('photos/next'); };
        const onBeat = () => videoStall.beat();
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        el.addEventListener('timeupdate', onBeat);
        el.addEventListener('playing', onBeat);
        videoEndOff = () => {
          el.removeEventListener('ended', onEnded);
          el.removeEventListener('error', onError);
          el.removeEventListener('timeupdate', onBeat);
          el.removeEventListener('playing', onBeat);
        };
        // Armed BEFORE play() is asked for, so a clip that never starts at all is covered
        // by the same clock as one that stops halfway.
        videoStall.arm(item.id);
        el.play?.().catch(() => {});
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

      // *** A PHOTO IS ON SCREEN, SO "Loading photos…" IS NO LONGER TRUE. ***
      //
      // Reported off the live site 2026-09-05: photos drawing UNDERNEATH a persistent
      // "Loading photos…" sheet that dimmed them — the feature working and looking broken,
      // which is worse than either.
      //
      // Every path through `reload()` was supposed to clear it and one of them does not: a
      // reload that is superseded (`seq !== loadSeq`) returns early WITHOUT clearing, and the
      // module adopting a source writes to state, which triggers a fresh reload, which is
      // exactly how two of them end up racing on a first load.
      //
      // Chasing which path leaks is the wrong fix. **The status is a claim about what the
      // panel is doing, and here is where that claim stops being true** — so this is where it
      // is withdrawn, whatever route got here. A loading message cannot outlive the load if
      // the thing that finishes loading is what clears it.
      const st2 = mount.querySelector('[data-status]');
      if (st2 && !st2.hidden && /^Loading/.test(st2.textContent || '')) setStatus(null);
    }

    // Show an item by id. `record` distinguishes a forward play (counts, logs a play
    // event, extends history) from a prev()/replay (neither).
    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      currentId = id;
      // ORDER IS LOAD-BEARING. `scheduleAdvance` begins by clearing the PREVIOUS item's
      // timers and listeners, and `render` arms the video watchdog for the new one. Run
      // the other way round it tears down what it just set up, and the video safety net
      // is silently gone.
      scheduleAdvance(item);
      render(item);
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
      // *** MORE THAN ONE SOURCE USED TO BE A DEAD END, AND IT WAS A LOUD ONE. ***
      //
      // This returned null the moment a second source existed, and the panel then said
      // "No photo source connected. Add one in Media / Sources." — telling somebody to do the
      // thing they had just done, twice. Recorded in §E-fail and never fixed.
      //
      // ADOPTING THE FIRST WOULD BE WORSE, not better: on a bedside screen that is a coin
      // flip about whose photographs appear, and the person in front of it cannot say "not
      // those". So the panel still declines to guess — but it now says what is actually true
      // and names the sources, so the next step is obvious instead of circular.
      //
      // `sourceId` is a declared setting ("Photos from"), which is the real way out. On a
      // GRID kiosk that menu currently shows no panel settings at all (see §F19-audit), so
      // the message points at the composer, which is somewhere the reader can actually get to.
      if (sources.length > 1) {
        multiSource = sources;
        return null;
      }
      multiSource = null;
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
        if (multiSource) {
          const names = multiSource.map((x) => x.label || x.base_url || x.id).join(', ');
          setStatus(`More than one photo source is connected (${names}). `
            + 'Pick one for this panel in Screens — this panel’s “Photos from” setting.');
        } else {
          setStatus('No photo source connected. Add one in Media / Sources.');
        }
        items = ids = []; byId = channels = {};
        return;
      }
      let listing;
      try {
        listing = await resolveListing(source, cfg.album);
      } catch (e) {
        if (seq !== loadSeq) return;
        // The words come from `listingFailure` so they can be checked without a browser; this
        // half is only the wiring. See §E-fail for what they used to be.
        const f = listingFailure(e, source, cfg.album);
        if (f.action === 'Allow') {
          setStatus(f.text, false, {
            label: 'Allow',
            run: async () => {
              setStatus('Asking…');
              try {
                const { requestFolderAccess } = await import('../folder_source.js');
                // The click IS the user gesture the prompt requires — which is the whole
                // reason this is a button and not a retry on a timer.
                const res = await requestFolderAccess(source.id);
                if (res === 'granted') { reload(); return; }
                // Refused or dismissed. Leave the button there: somebody who clicked the wrong
                // thing must be able to try again without going to find a menu.
                setStatus('Permission was not given.', false,
                  { label: 'Allow', run: () => reload() });
              } catch (err2) {
                console.error('photos: requesting folder access', err2);
                setStatus('That folder could not be opened.', true);
              }
            },
          });
        } else {
          setStatus(f.text, f.retry);
        }
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
          // FIT CHANGES RE-RENDER THE CURRENT PHOTO, they do not poke a style. This used to
          // write `objectFit` onto `stage().firstChild`, and in `contain` mode the first child
          // is the BLURRED BACKDROP, not the photo - so switching contain -> cover set the
          // property on a div that has no object-fit and did nothing at all. The other
          // direction "worked" and still looked wrong: it set the image but could not CREATE
          // the backdrop, leaving bare letterbox bars until the next photo happened to load.
          // Re-rendering is the only thing that gets both the fit and the backdrop right,
          // and it is cheap - the bytes are already in cache.
          else if (currentId && byId[currentId]) render(byId[currentId]);
        });
      },
      onResize() {},
      onHide() { videoStall.disarm(); state.flush(); },
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
