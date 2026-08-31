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
// server never sees them. The first clips on the bedside screen are recorded messages from
// one family member, read from a folder like `…/Voice messages/personal`.
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
import { createHeldSignal } from '../held.js';

// `stallMs` matches youtube's for the same reason: long enough that a big clip loading off
// a media agent over facility wifi is not cut off, short enough that nobody sits in front
// of a frozen frame for long. 0 disables it.
// `heldNotifyMs` was `heldPauseMs`, and it now means the opposite thing — how long a held
// pause runs before somebody is told, rather than how long before it starts itself again.
// The key is renamed for the reason AGENTS.md renames a key whose unit changed: a changed
// MEANING under an unchanged key silently reinterprets a choice somebody already made. Six
// hours, and it is not resumed — Mike, 2026-08-30. Full reasoning in `youtube.js`.
const DEFAULTS = { sourceId: '', album: '', subjectName: '', autoAdvance: true, autoplay: true,
                   directed: false, fit: 'contain', stallMs: 20000, heldNotifyMs: 21600000 };
const RECENT_CAP = 12;

// How often a playing clip reports progress on the bus. `timeupdate` fires several times a
// second, which is the right rate for the module's own clock and far too fast for a bus
// topic, so the local beat is every event and the published one is windowed to this.
const PROGRESS_MS = 5000;

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

// *** A PAUSE STAYS A PAUSE; THE ONLY QUESTION IS WHEN SOMEBODY IS TOLD. ***
// Mike, 2026-08-30. The long version, including how this sits with the safety invariant and
// what is NOT built about the notification, is in `youtube.js` beside the same setting.
//
// Note that on THIS module a `pause` event is rarely a person at all — there is no pause
// button on screen (see PAUSE_IS_REACHABLE above), so a pause here is usually the system and
// takes the short clock and the ordinary recovery. This setting only governs the case where
// input on the page says somebody is here.
//
// The same stops as youtube's, deliberately: this is one question about one room, and a
// family who sets it in one place and finds a different answer in the other has been given a
// puzzle rather than a setting.
export const SETTINGS = [
  { key: 'heldNotifyMs', label: 'If someone pauses it, let people know after', kind: 'choice',
    default: 21600000, level: 'standard',
    options: [
      { value: 0, label: 'never — just leave it paused' },
      { value: 3600000, label: 'after 1 hour' },
      { value: 21600000, label: 'after 6 hours' },
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
    // 'loading' | 'playing' | 'blocked' | 'paused' | 'held'.
    //   playing — alive, and the heartbeat below keeps restarting the clock.
    //   held    — somebody stopped it and somebody is here. Long clock, and it is not resumed.
    let stallReason = 'loading';
    let beatWindow = true;          // a progress publish is due (see heartbeat)
    let pollTimer = null;
    let destroyed = false;
    const activity = ctx.activity || pageActivity();
    const holdNotifyMs = () => Math.max(0, Number(cfg.heldNotifyMs) || 0);
    // THE HELD SIGNAL — the same one youtube publishes, so a container reacts to a hold
    // without knowing which provider is on the stage. See `held.js`.
    const heldSignal = createHeldSignal(bus, 'personal');
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
    const onBeat = () => heartbeat();

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
      // ...and on the bus. `clearStall()` calls this on every ordinary path, which is exactly
      // why `held.js` refuses to publish an end for a hold that never began.
      if (on) heldSignal.begin({ id: currentId, afterMs: holdNotifyMs() });
      else heldSignal.end();
    }

    // ------------------------------------------------------------------------------------
    // *** THE HEARTBEAT (added 2026-08-30), and why `ok()` was the wrong verb here. ***
    //
    // `onPlaying` used to call `stall.ok()`, which STOPS the clock. That is right for a load
    // that finished and wrong for a clip that is still running, and it cost two things:
    //
    //   1. A CLIP THAT FROZE AFTER STARTING WAS WATCHED BY NOTHING. From then on this module
    //      depended entirely on the element firing `pause`, `stalled` or `waiting`. A picture
    //      that simply stops advancing fires none of them.
    //   2. THE DIRECTOR CUT HEALTHY CLIPS OFF AT THREE MINUTES, because `segment/progress`
    //      was published in the same place — once per clip — so a long message looked exactly
    //      like a frozen one to the container's backstop.
    //
    // `photos.js` already had the answer and said so at length: beat on a repeating signal,
    // never satisfy on first play. `timeupdate` is that signal, and it is why a three-hour
    // video in the slideshow is never interrupted while a frozen one is caught in `stallMs`.
    //
    // ONE HEARTBEAT, ONE MEANING: the same evidence feeds this module's clock and the
    // container's. The local beat runs on every `timeupdate`; the BUS publish is windowed by
    // `progressTick`, because four messages a second is not a heartbeat, it is a leak.
    // ------------------------------------------------------------------------------------
    const progressMs = Number(ctx.progressMs) > 0 ? Number(ctx.progressMs) : PROGRESS_MS;

    function watchAgain() {
      if (!stall || !currentId) return;
      if (stall.key() === null) stall.arm(currentId); else stall.beat();
    }

    function heartbeat() {
      if (!active || !currentId) return;
      watchAgain();
      if (!beatWindow) return;
      beatWindow = false;
      bus.publish('segment/progress', { provider: 'personal', id: currentId });
    }

    function progressTick() {
      beatWindow = true;
      pollTimer = destroyed ? null : setTimer(progressTick, progressMs);
    }

    // The hold ran out and it is still paused. Tell somebody — see `youtube.js` for what
    // that reaches today, which is less than it sounds.
    function notifyHeld() {
      try { ctx.output?.notify?.('The screen has been paused for a while.', { source: 'personal' }); }
      catch (e) { console.error('personal: notify', e); }
      events.append('held', { at: Date.now(), id: currentId, afterMs: holdNotifyMs() })
        .catch((e) => console.error('personal: held log', e));
    }

    // It is playing. Keep the clock running rather than standing it down, and tell any
    // container that this segment is alive.
    function onPlaying() {
      stallReason = 'playing';
      setHeld(false);
      heartbeat();
      if (!mutedFallback) setStatus(null);
    }

    // It stopped and nobody here can press play. A pause of a second or two is forgiven
    // silently (the next `timeupdate` beats again); one that persists goes up the ladder.
    function onIdle(reason) {
      if (!active || !currentId) return;
      // Already counting a STOP for this clip. A heartbeat is not a stop, so an armed clock
      // whose reason is 'playing' must not block this — that test is what the heartbeat made
      // necessary, since the watchdog is now armed for the whole of a healthy clip.
      if (stallReason !== 'playing' && stall?.armed()) return;

      // Only a PAUSE can be a person's doing. A stalled or waiting clip is the network.
      if (reason !== 'paused') { armStall(currentId, reason); return; }

      const held = PAUSE_IS_REACHABLE || activity.recent(RECENT_MS);
      if (!held) { armStall(currentId, 'paused'); return; }

      // 'never' — no clock at all. Disarmed rather than simply left, or the heartbeat's own
      // clock would run out and resume a clip somebody deliberately stopped.
      if (!holdNotifyMs()) { stallReason = 'held'; stall?.disarm(); setHeld(true); return; }
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
      // *** THE HEARTBEAT. *** `timeupdate` fires several times a second while a clip is
      // genuinely advancing, and stops the instant the picture does — including for a freeze
      // that fires no other event at all. It is the difference between a long message and a
      // dead one, and nothing else on this element can tell them apart.
      el.addEventListener('timeupdate', onBeat);
      el.addEventListener('pause', () => onIdle('paused'));
      el.addEventListener('stalled', () => onIdle('loading'));
      el.addEventListener('waiting', () => onIdle('loading'));
      // A source that 404s or a codec the Pi cannot decode: an explicit failure, so end the
      // segment straight away rather than waiting out the watchdog.
      el.addEventListener('error', onClipError);
      videoEndOff = () => {
        el.removeEventListener('ended', onClipEnded);
        el.removeEventListener('playing', onPlaying);
        el.removeEventListener('timeupdate', onBeat);
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
      beatWindow = true;            // a new clip announces itself on its first beat
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
          // Two clocks, one instance: hours when a person stopped it, seconds otherwise.
          stallMs: () => (stallReason === 'held' ? holdNotifyMs() : cfg.stallMs),
          onRetry: (id) => {
            // *** THE HOLD RAN OUT, AND IT IS NOT RESUMED. Mike, 2026-08-30. ***
            // Somebody stopped it; a screen that restarts under them is the interruption the
            // hold exists to prevent. Tell somebody once — `disarm` bumps the epoch so `fire`
            // does not re-arm behind this — and leave the clip where it was left, marked.
            // Checked before `byId`, because a message worth sending does not depend on the
            // clip still being in the listing.
            if (stallReason === 'held') {
              notifyHeld();
              stall?.disarm();
              setHeld(true);
              return;
            }
            const item = byId[id];
            if (!item) return;
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
        // actually on screen. `heartbeat` returns on `!active` for the same reason — a
        // hidden provider quieting the backstop for the visible one is the same bug wearing
        // the opposite sign.
        bus.subscribe('personal/deactivate', () => { active = false; clearStall(); });

        // The window that rate-limits the published heartbeat, on the injected clock.
        pollTimer = setTimer(progressTick, progressMs);

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
      destroy() {
        destroyed = true;
        clearTimer(pollTimer); pollTimer = null;
        active = false; clearStall(); clearVideoEnd(); currentVideo = null;
        // Destroyed while held: publish the end on the way out — `held.js` rule 3.
        heldSignal.release();
      },
    };
  },
);
