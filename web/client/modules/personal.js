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
//
// ---------------------------------------------------------------------------------------
// *** A CLIP THAT NEVER STARTS, AND WHY THIS MODULE NEEDED A WATCHDOG MOST OF ALL ***
// (added 2026-08-27, after the same hole was found in youtube.js)
//
// THE INVARIANT: nothing may require an input in order to keep doing what it is already
// doing. Starting can need a press; continuing must not. Christine cannot press anything.
//
// This module used to listen for exactly one event — `ended` — and to call `play()` like
// this:
//
//     if (el.autoplay) el.play?.().catch(() => {});   // may need a gesture in some browsers
//
// The comment named the failure and the `catch` swallowed it. When a browser's AUTOPLAY
// POLICY refuses a video with sound, that promise rejects, the clip sits on its first
// frame, `ended` never fires, no `segment/done` ever reaches the director, and the screen
// is dead until somebody walks in. The documented kiosk launch line carries no
// `--autoplay-policy=no-user-gesture-required`, so this was not theoretical.
//
// It is the worst place in the product for it to happen: these are the recorded messages
// from her family, and this is her window to her people.
//
// SO: the shared watchdog (../watchdog.js), armed when a clip is asked for and satisfied
// when it actually plays, plus the four events that mean "stopped": `pause`, `error`,
// `stalled` and `waiting`.
//
// *** AND ONE RUNG THAT IS SPECIFIC TO THIS MODULE: THE RETRY IS MUTED. ***
// Retrying a blocked autoplay unmuted fails identically — the policy has not changed in
// twenty seconds — so an unmuted retry is a wasted rung and then a lost clip. A muted clip
// is a real loss (a voice message with no voice), and it is still enormously better than a
// frozen frame: she sees their faces, and it moves. It is NOT done silently — the screen
// says the sound is off — and the NEXT clip tries unmuted again, because one successful
// play usually unblocks the page for the rest of the session.
// ---------------------------------------------------------------------------------------

import { registerModule } from '../module.js';
import { createMediaSourcesClient, resolveListing } from '../media_sources.js';
import { createWatchdog } from '../watchdog.js';
import { pageActivity, RECENT_MS } from '../activity.js';
import { pick, statsFromEvents } from '../rng.js';

// `stallMs` matches youtube's for the same reason: long enough that a big clip loading off
// a media agent over facility wifi is not cut off, short enough that nobody sits in front
// of a frozen frame for long. 0 disables it.
const DEFAULTS = { sourceId: '', album: '', subjectName: '', autoAdvance: true, autoplay: true,
                   directed: false, fit: 'contain', stallMs: 20000, heldPauseMs: 0 };
const RECENT_CAP = 12;

// *** THIS MODULE RENDERS <video> WITH NO CONTROLS. ***
//
// There is no pause button on screen and nothing focusable. A person standing in the room
// HAS NO WAY to pause a personal video — so unlike youtube.js, where the real player chrome
// is right there to be clicked, a `pause` event here is the system: an OS audio-focus
// change, a screen lock, a policy. It gets the SHORT clock by default.
//
// Input on the page still upgrades it, which covers somebody driving a pause through a
// switch or a remote. See activity.js — and note what that file CANNOT see.
const PAUSE_IS_REACHABLE = false;

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
// The same five stops as youtube's, deliberately: this is one question about one room, and a
// family who sets it in one place and finds a different answer in the other has been given a
// puzzle rather than a setting.
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

registerModule(
  { type: 'personal', title: 'Personal videos',
    description: 'Recorded messages from their people. Plays from your machine — nothing is uploaded.',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events, user } = ctx;
    // Scoped to whose screen this is; see photos.js. Registry survives a server blip.
    const client = createMediaSourcesClient({ user, cache: true, personId: ctx.personId || null });

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {};
    let stats = {};
    let recent = [];
    let history = [], histPos = -1;
    let currentId = null;
    let videoEndOff = null;
    let currentVideo = null;
    // 'loading' | 'blocked' | 'paused' | 'held' — see presence.js for what 'held' means.
    let stallReason = 'loading';
    const activity = ctx.activity || pageActivity();
    const heldMs = () => Math.max(0, Number(cfg.heldPauseMs) || 0);
    let mutedFallback = false;      // this clip is playing without sound, and says so
    let active = true;              // false while a director has another provider on screen
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

    // Injectable so the tests drive this against a fake clock, exactly as youtube's does.
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    let stall = null;

    function clearStall() { stall?.disarm(); setHeld(false); }
    function armStall(id, reason) { stallReason = reason; stall?.arm(id); }

    // A held pause has to be VISIBLE, or it looks exactly like a crash to whoever walks in.
    function setHeld(on) {
      const el = mount.querySelector('[data-held]');
      if (el) el.hidden = !on;
    }

    // It is playing. Stand the clock down and tell any container that this segment is
    // alive — a provider that never sends a heartbeat is exactly what the director's
    // slower backstop exists to catch.
    function onPlaying() {
      stall?.ok();
      setHeld(false);
      bus.publish('segment/progress', { provider: 'personal', id: currentId });
      if (!mutedFallback) setStatus(null);
    }

    // It stopped and nobody here can press play. A pause of a second or two is forgiven
    // silently (the next `playing` calls ok()); one that persists goes up the ladder.
    function onIdle(reason) {
      if (!active || !currentId) return;
      if (stall?.armed()) return;      // already counting for this clip

      // Only a PAUSE can be a person's doing. A stalled or waiting clip is the network.
      if (reason !== 'paused') { armStall(currentId, reason); return; }

      const held = PAUSE_IS_REACHABLE || activity.recent(RECENT_MS);
      if (!held) { armStall(currentId, 'paused'); return; }

      if (!heldMs()) { setHeld(true); return; }     // 'never' — no clock at all
      armStall(currentId, 'held');
      setHeld(true);
    }

    // A clip finishing is BOTH a segment/done (the director's seam) AND, when
    // standalone, a self-advance to the next clip. When a director drives us it seeds
    // autoAdvance=false, so only segment/done fires.
    function onClipEnded() {
      clearStall();
      bus.publish('segment/done', { provider: 'personal', reason: 'ended' });
      if (cfg.autoAdvance) bus.publish('personal/next');
    }

    function render(item, { muted = false } = {}) {
      const st = stage();
      if (!st) return;
      clearVideoEnd();
      st.innerHTML = '';
      const el = document.createElement('video');
      el.src = item.url;
      el.controls = false;
      el.playsInline = true;
      el.muted = !!muted;
      el.autoplay = cfg.autoplay !== false;
      el.preload = el.autoplay ? 'auto' : 'none';   // don't buffer big clips when autoplay is off (tests)
      el.style.objectFit = cfg.fit;

      // EVERY WAY A VIDEO CAN STOP, not just the happy one. `ended` was the only listener
      // here; the other four are the ways a clip stops WITHOUT ending, and each of them
      // used to leave the screen frozen.
      el.addEventListener('ended', onClipEnded);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('pause', () => onIdle('paused'));
      el.addEventListener('stalled', () => onIdle('loading'));
      el.addEventListener('waiting', () => onIdle('loading'));
      // A source that 404s or a codec the Pi cannot decode: an explicit failure, so end the
      // segment straight away rather than waiting out the watchdog.
      el.addEventListener('error', onClipError);
      videoEndOff = () => {
        el.removeEventListener('ended', onClipEnded);
        el.removeEventListener('playing', onPlaying);
        el.removeEventListener('error', onClipError);
        try { el.pause(); } catch { /* already gone */ }
        el.removeAttribute('src');
        el.load?.();                  // stop a big clip downloading in the background
      };
      currentVideo = el;
      st.append(el);

      if (el.autoplay) {
        armStall(item.id, 'loading');
        // THE REJECTION IS THE SIGNAL, and it used to be thrown away. A blocked autoplay
        // rejects immediately; there is no reason to wait out the full stall for something
        // the browser has already refused.
        el.play?.().catch((err) => {
          const blocked = err && (err.name === 'NotAllowedError' || /gesture|user activation/i.test(String(err.message || '')));
          if (blocked && !muted) { playMuted(item); return; }
          armStall(item.id, blocked ? 'blocked' : 'loading');
        });
      }
    }

    // The muted rung. Loud about it on screen — a personal message playing without its
    // voice is a real loss, and a silent degradation would be worse than the bug.
    function playMuted(item) {
      mutedFallback = true;
      setStatus('Sound is off for this message — this screen blocked it.');
      render(item, { muted: true });
    }

    function onClipError() {
      clearStall();
      bus.publish('segment/done', { provider: 'personal', reason: 'error' });
      if (cfg.autoAdvance && ids.length > 1) bus.publish('personal/next');
    }

    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      currentId = id;
      active = true;                // something asked for a clip: this instance is on screen
      mutedFallback = false;        // every new clip gets a fair try WITH its sound
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
            <div class="held" data-held hidden>Paused</div>
            <div class="caption" data-name></div>
            <div class="status" data-status hidden></div>
            <div class="nav">
              <button class="pbtn" data-prev aria-label="previous message">‹</button>
              <span class="source-label" data-source-label></span>
              <button class="pbtn" data-next aria-label="next message">›</button>
            </div>
          </div>`;

        stall = createWatchdog({
          // A GETTER, not a snapshot: cfg arrives with the state subscription, which may
          // not have landed when this is built.
          setTimer, clearTimer, retries: 1,
          // Two clocks, one instance: hours when a person paused it, seconds otherwise.
          stallMs: () => (stallReason === 'held' ? heldMs() : cfg.stallMs),
          onRetry: (id) => {
            const item = byId[id];
            if (!item) return;
            // The hold expired — the room has been still for hours, so carry on, and fall
            // back to the SHORT clock so a failure from here does not cost another four.
            if (stallReason === 'held') {
              stallReason = 'paused';
              setHeld(false);
              currentVideo?.play?.().catch(() => {});
              return;
            }
            // A blocked autoplay will be blocked again in twenty seconds' time, so the
            // retry that has any chance of working is the muted one.
            if (stallReason === 'blocked') { playMuted(item); return; }
            // Otherwise ask it to carry on where it is, and only reload if there is no
            // element left to ask.
            if (currentVideo && currentVideo.play) {
              currentVideo.play().catch(() => { render(item, { muted: mutedFallback }); });
              return;
            }
            render(item, { muted: mutedFallback });
          },
          onGiveUp: () => {
            setHeld(false);
            setStatus('That message wouldn\u2019t play. Moving on.');
            bus.publish('segment/done', { provider: 'personal', reason: 'timeout' });
            if (cfg.autoAdvance && ids.length > 1) bus.publish('personal/next');
          },
        });

        // HIDDEN MEANS DISARMED. A director shows one provider at a time and leaves the
        // rest mounted; without this a hidden clip's stall would end the segment that is
        // actually on screen.
        bus.subscribe('personal/deactivate', () => { active = false; clearStall(); });

        // Any sign of a person restarts the hold, so four hours means four hours of
        // stillness rather than four hours from the press.
        const heldBeat = () => {
          activity.note();
          if (stallReason === 'held' && stall?.armed()) stall.beat();
        };
        for (const topic of ['input/device', 'personal/next', 'personal/prev']) {
          bus.subscribe(topic, heldBeat);
        }
        mount.addEventListener('pointerdown', heldBeat, { passive: true });

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
      onHide() { active = false; clearStall(); state.flush(); },
      destroy() { active = false; clearStall(); clearVideoEnd(); currentVideo = null; },
    };
  },
);
