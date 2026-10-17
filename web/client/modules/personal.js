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
// doing. Starting can need a press; continuing must not. Some people cannot press anything.
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
import {
  createMediaSourcesClient, resolveListing, listOrFallback, listingWithin, degradedLine, mayShowSource,
  LISTING_WAIT_MS, SOURCE_RECHECK_MS, DOWN_AFTER_FAILURES, mediaLoads,
  backupChoice, backupPanelField, backupPanelChoices, BACKUP_KEY, BACKUP_ANY,   // backup source
  quietResolve, quietReach, tryFromHere, ELSEWHERE_LINE, TRY_HERE_LABEL,   // desktop prompt (2026-10-10)
  // every folder inside (2026-10-10, row 2.78; media_sources.js "EVERY FOLDER INSIDE" argues the two settings)
  subfoldersField, listOptions, withListOptions, leaveOutRows, truncatedWords, SUBFOLDERS_KEY, LEAVE_OUT_KEY,
  // choosing the album (2026-10-10; media_sources.js "CHOOSING THE ALBUM" argues the row)
  albumField, createAlbumChooser, topFoldersLister,
} from '../media_sources.js';
import { personSources, personOf } from '../person_known.js';
import { createWatchdog } from '../watchdog.js';
import { pageActivity, RECENT_MS } from '../activity.js';
import { pick } from '../rng.js';
import { panelPlays } from '../plays.js';
import { createHeldSignal } from '../held.js';
import { flashLimit, failureFloorMs, failureBackoffMs } from '../flash_limit.js';
import { stallFields, stallSettings, pauseNoticeMs, createStallReporter } from '../playback_stall.js';
import { routeToSpeaker, PANEL_SPEAKER_KEY } from '../speakers.js';   // row 2.97: the panel's own speaker
import { PLAY_NOW_TOPIC } from '../play_sync.js';   // row 2.79: watching along

// `stallMs` matches youtube's for the same reason: long enough that a big clip loading off
// a media agent over facility wifi is not cut off, short enough that nobody sits in front
// of a frozen frame for long. 0 disables it.
// `heldNotifyMs` was `heldPauseMs`, and it now means the opposite thing — how long a held
// pause runs before somebody is told, rather than how long before it starts itself again.
// The key is renamed for the reason AGENTS.md renames a key whose unit changed: a changed
// MEANING under an unchanged key silently reinterprets a choice somebody already made. Six
// hours, and it is not resumed — Mike, 2026-08-30. Full reasoning in `youtube.js`.
// *** 2026-10-13 (stalled playback, playback_stall.js): it is no longer in these defaults, and there is a notice
// only when "Say when it gets stuck" sends one - read from the panel's own row (`pauseNoticeMs(rawRow)`), so a row
// that chose a time under the old "let people know after" keeps its notice. See youtube.js's DEFAULTS.
const DEFAULTS = { sourceId: '', album: '', subjectName: '', autoAdvance: true, autoplay: true,
                   directed: false, fit: 'contain', stallMs: 20000 };
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
  // STALLED PLAYBACK (Mike, 2026-10-13; playback_stall.js argues every default) - the same rows as YouTube's, for
  // the same reason the old pause row matched it: one question about one room. Replaces "If someone pauses it, let
  // people know after".
  ...stallFields(),
  // backup source (2026-10-08; media_sources.js argues it): "If this can't be reached, use". Its own default is the
  // stand-in this panel already had (any other source this screen may show); the screen's row applies unless this is set.
  backupPanelField({ panelDefault: BACKUP_ANY }),
  // choosing the album (2026-10-10): this panel has always played from an album (`cfg.album`, and the name over the
  // clips falls back to it), but nothing outside a dev address could set one. The same row as Photos, 'standard' for
  // the same reason: it decides which messages play. AGAINST: one more stop on a switch user's walk of this menu, only
  // once the source has folders.
  albumField({ level: 'standard' }),
  // every folder inside (2026-10-10, row 2.78): ON, as Photos - a person's messages kept in folders by year still play.
  // Which folders are left out are this panel's own rows (`menuItems`).
  subfoldersField({ on: true, what: 'videos' }),
];

registerModule(
    // `local`, the same as `photos` and for the same reason: the bytes come from a media source
    // on the person's own machine, never from the platform. MEASURED 2026-09-05 with every
    // handle rejecting - it renders "Paused" and its controls, so it survives the platform
    // being down and does not survive the drive being unmounted.
  { type: 'personal', title: 'Personal videos',
    dependsOn: 'local',
    routesSound: true,           // row 2.97: the Sound tab offers "Its sound comes out of" (speakers.js)
    description: 'Recorded messages from their people. Plays from your machine — nothing is uploaded.',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events, user } = ctx;
    // Scoped to whose screen this is; see photos.js. Registry survives a server blip.
    // `ctx.sources` is injectable, exactly as in `photos.js`, and for the same two reasons:
    // a signed-out page can hand in its own registry, and a test can drive the failure paths
    // without a server. This module built its own client unconditionally, so a host supplying
    // a registry was ignored and the panel reported "No personal-video source connected" while
    // holding a perfectly good source - which is also why its Retry button had never been
    // pressed by any test.
    // WHOSE SCREEN may not be known yet at mount: `personSources` lists for whoever it is once the
    // screen knows (bounded wait), and re-lists if that changes. See photos.js / person_known.js.
    const scoped = ctx.sources ? null : personSources(ctx,
      (pid) => createMediaSourcesClient({ user, cache: true, personId: pid }),
      { onChange: () => { if (!destroyed) reload(); } });
    const client = ctx.sources || scoped;

    let cfg = { ...DEFAULTS };
    // STALLED PLAYBACK (playback_stall.js; youtube.js has the same three lines and says why the row is kept raw).
    let rawRow = {};
    const stallNow = () => stallSettings(rawRow);
    const stallReport = createStallReporter({
      bus, panel: ctx.instanceId || 'personal', type: 'personal', title: 'Personal videos',
      row: () => rawRow, directed: () => !!cfg.directed, now: ctx.now || (() => Date.now()),
    });
    let items = [], ids = [], byId = {};
    let stats = {};
    // Where the plays go (row 2.58): this device, never the server. The panel's old server rows come down once.
    const playLog = panelPlays(ctx, 'personal');
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
    // 0 unless "Say when it gets stuck" sends notices (playback_stall.js); then the hold has no clock at all.
    const holdNotifyMs = () => pauseNoticeMs(rawRow);
    // THE HELD SIGNAL — the same one youtube publishes, so a container reacts to a hold
    // without knowing which provider is on the stage. See `held.js`.
    const heldSignal = createHeldSignal(bus, 'personal');
    let mutedFallback = false;      // this clip is playing without sound, and says so
    let active = true;              // false while a director has another provider on screen
    let lastSourceRef = null;
    let loadSeq = 0;
    let sourceLabel = '';
    // *** A SOURCE SHOULD DEGRADE, NOT STOP (MIKE_CHANGE_LIST §3e) -- photos.js's twin, without the
    // "last pictures": a clip is rarely in the browser's cache whole, so there is nothing honest to keep.
    // While a stand-in plays, `degraded` holds the chosen source, the panel says so, asks after the
    // chosen one every SOURCE_RECHECK_MS and goes back when it answers. Nothing is saved.
    let degraded = null;            // { chosenId, chosenLabel, err, shownLabel }
    let recheckTimer = null;
    let clipFails = 0;               // clips in a row that failed (DOWN_AFTER_FAILURES; `countFailure`)
    const loadFailed = new Set();    // sources whose clips stopped loading; cleared by any ordinary reload
    let shownSourceId = null;
    const labels = {};
    const listingWaitMs = () => Number(ctx.listingWaitMs ?? LISTING_WAIT_MS);
    const recheckMs = () => Number(ctx.sourceRecheckMs ?? SOURCE_RECHECK_MS);
    // backup source: this panel's row, else the screen's (`ctx.screenBackup`), else the stand-in it always had.
    const screenBackup = () => { try { return String(ctx.screenBackup?.() || ''); } catch { return ''; } };
    const backupNow = () => backupChoice({ panel: cfg[BACKUP_KEY], screen: screenBackup(), panelDefault: BACKUP_ANY });
    // desktop prompt (2026-10-10, as photos.js): every automatic listing goes through `quietList`, which never asks a
    // source on another computer; only "Try on this computer" fetches one on purpose. `ctx.checkFromHere`: the seam.
    // every folder inside (row 2.78): every listing carries the panel's two folder settings for that source.
    const resolveList = withListOptions(ctx.resolveListing || resolveListing, (s) => listOptions(cfg, s && s.id));
    let lastListing = null;         // { sourceId, album, listing } from the chosen source: the "Leave out" rows
    let foldersOpen = false;        // whether the menu's folder rows are showing (not saved)
    const reachCheck = ctx.checkFromHere || null;
    const quietList = quietResolve(resolveList, { check: reachCheck });
    // choosing the album: the "Album" row's folders (photos.js, media_sources.js createAlbumChooser).
    const albumChooser = createAlbumChooser({ listTop: topFoldersLister({ resolve: ctx.resolveListing || null, check: reachCheck }) });
    let knownSources = [];          // backup source: what the last listing held, for the row's choices
    let lastBackupRef = null;
    const videosOf = (listing) => ((listing && listing.items) || []).filter((it) => it.kind === 'video');

    const stage = () => mount.querySelector('[data-stage]');
    // While a stand-in plays, its messages are NOT from whoever the panel's subject is: the caption
    // names the source actually playing rather than putting the wrong name on somebody's face.
    // The words go in the CAPTION under the clip, not the status sheet: that sheet covers the video,
    // and a stand-in that is playing is exactly what should be seen.
    const standIn = () => !!(degraded && degraded.shownLabel);
    const subjectName = () => (standIn() ? (sourceLabel || 'Someone') : (cfg.subjectName || sourceLabel || cfg.album || 'Someone'));

    // `action`, added 2026-09-08, matches `photos.js`'s own setStatus exactly — same shape,
    // same reason: a source-picker prompt needs the click that triggers it to BE a user
    // gesture, so the button lives in the status line rather than something a timer retries.
    function setStatus(text, showRetry = false, action = null) {
      const s = mount.querySelector('[data-status]');
      if (!s) return;
      s.hidden = !text;
      if (text) {
        s.innerHTML = `<span>${text}</span>`
          + (action ? ` <button data-action>${escapeHtml(action.label)}</button>` : '')
          + (showRetry ? ` <button data-retry>Try again</button>` : '');
        s.querySelector('[data-retry]')?.addEventListener('click', () => reload());
        s.querySelector('[data-action]')?.addEventListener('click', () => action.run());
      }
    }
    // desktop prompt (2026-10-10): "Try on this computer" - the one fetch of a source on another computer made on purpose
    // (Chrome may ask now; the person answers). An answer is remembered and the panel lists again. As photos.js.
    function tryAction(source) {
      return {
        label: TRY_HERE_LABEL,
        run: async () => {
          setStatus('Trying…');
          const r = await tryFromHere(source, { resolve: resolveList, album: cfg.album });
          if (destroyed) return;
          if (r.ok) { reload(); return; }
          setStatus('It didn’t answer on this computer.', false, tryAction(source));
        },
      };
    }
    function escapeHtml(t) {
      return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function setName() {
      const el = mount.querySelector('[data-name]');
      if (!el) return;
      if (standIn() && currentId) el.textContent = degradedLine({ shownLabel: degraded.shownLabel, chosenLabel: degraded.chosenLabel, err: degraded.err, backup: !!degraded.backup });
      else el.textContent = currentId ? `From ${subjectName()}` : '';
    }

    function clearVideoEnd() { if (videoEndOff) { videoEndOff(); videoEndOff = null; } }
    // `timeupdate` is the moving clock, so it is also what ends a stretch of being stuck (playback_stall.js).
    const onBeat = () => { heartbeat(); if (active && currentId) stallReport.ok(); };

    // Injectable so the tests drive this against a fake clock, exactly as youtube's does.
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    // Only the failure backoff reads this clock.
    const now = ctx.now || (() => Date.now());
    let failStreak = 0, failTimer = null, shownAt = 0;
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

    // *** WATCHING ALONG (row 2.79, Mike 2026-10-12: "the same pictures and videos ... we both see and hear the same
    // thing at the same time"; play_sync.js argues the shape). *** Say what is playing on this screen's own bus, as
    // youtube.js and photos.js do: the clip's path inside its source (`key`), where it is, and whether it plays. The
    // path never leaves the screen - the screen's sender hashes it with the sharing session's salt - and nothing leaves
    // at all unless "Let people follow" is on and somebody is following. Said on a start, a pause, a seek, the end, and
    // with each progress tick; a hidden or destroyed panel says "nothing".
    let currentKey = null;
    let saidKey = null;
    function sayPlay() {
      const v = currentVideo;
      if (!currentKey && saidKey === null) return;
      saidKey = currentKey;
      let pos = null;
      try { const n = Number(v?.currentTime); pos = Number.isFinite(n) ? n : null; } catch { pos = null; }
      const playing = !!(v && currentKey && active && !v.paused && !v.ended);
      try { bus.publish(PLAY_NOW_TOPIC, { kind: 'personal', panel: ctx.instanceId || 'personal', key: currentKey, pos, playing }); }
      catch { /* not load-bearing */ }
    }
    function sayNone() {
      if (saidKey === null) return;
      saidKey = null;
      try { bus.publish(PLAY_NOW_TOPIC, { kind: 'personal', panel: ctx.instanceId || 'personal', key: null, pos: 0, playing: false }); }
      catch { /* not load-bearing */ }
    }

    function progressTick() {
      if (active && currentKey) sayPlay();
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
      failStreak = 0;               // a clip that plays ends a failure run (FAILURE BACKOFF)
      clipFails = 0;                // ...and the "source is down" count
      stallReason = 'playing';
      setHeld(false);
      // While a stretch of being stuck is open (playback_stall.js), `playing` restarts the clock WITHOUT refilling the
      // tries - a frozen clip says `playing` after every "carry on" (youtube.js onPlaying has the long version). The
      // first real `timeupdate` refills them and ends the stretch.
      if (stallReport.stuckSince() != null && active && currentId && stall) stall.arm(currentId);
      else heartbeat();
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
      stallReport.ok();             // a clip that ended played
      const finish = () => {
        bus.publish('segment/done', { provider: 'personal', reason: 'ended' });
        if (cfg.autoAdvance) bus.publish('personal/next');
      };
      // A clip that ENDS inside one flash period of appearing (zero-length, truncated) is a
      // failure, not a message: it takes the FAILURE BACKOFF. One that played is handled at once.
      if (now() - shownAt < failureFloorMs(flashLimit(ctx))) { if (!countFailure()) afterFailure(finish); return; }
      failStreak = 0;
      clipFails = 0;
      finish();
    }

    // *** A SOURCE THAT DIES MID-RUN (2026-10-02, follow-up to §3e; photos.js has the long version). ***
    // DOWN_AFTER_FAILURES clips in a row that error, stall out or end the instant they start means the
    // source has stopped serving: it is set aside and the panel lists again without it -- a stand-in,
    // or the words -- rather than handing the director broken clip after broken clip. A single broken
    // clip is still skipped quietly. The recheck takes the chosen source back once a clip of it loads.
    function countFailure() {
      clipFails += 1;
      const n = Number(ctx.downAfterFailures ?? DOWN_AFTER_FAILURES);
      if (!(n > 0) || clipFails < n) return false;
      clipFails = 0;
      clearStall(); clearFailWait(); clearVideoEnd();
      if (shownSourceId) loadFailed.add(shownSourceId);
      // The director is told this segment is over, as any failed clip tells it; what plays next is its call.
      bus.publish('segment/done', { provider: 'personal', reason: 'error' });
      reload({ keepFailed: true });
      return true;
    }

    // *** FAILURE BACKOFF (photosensitivity audit, 2026-09-30). *** An error handed back and
    // advanced AT ONCE, so a folder where every clip is broken (or a director that keeps choosing
    // this provider) replaced clip after clip as fast as the browser could fail them. The n-th
    // failure in a row now reacts `failureBackoffMs(n, limit)` after the clip appeared (one flash
    // period, then 2 s doubling to 30 s; flash_limit.js). The streak resets the moment a clip
    // plays, so a working message is handled exactly as before. A person's own next/prev cancels
    // the wait (show() clears it).
    function afterFailure(fn) {
      failStreak += 1;
      clearFailWait();
      const wait = Math.max(0, failureBackoffMs(failStreak, flashLimit(ctx)) - (now() - shownAt));
      if (!wait) { fn(); return; }
      failTimer = setTimer(() => { failTimer = null; if (!destroyed) fn(); }, wait);
    }
    function clearFailWait() { if (failTimer != null) { clearTimer(failTimer); failTimer = null; } }

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
      // (row 2.97) the panel's "Its sound comes out of" row; nothing chosen is the computer's own speaker.
      routeToSpeaker(el, cfg[PANEL_SPEAKER_KEY]);

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
      // (row 2.79) what a follower is told: the clip's place inside its source, as photos.js names a picture.
      currentKey = String(item.path || item.id || '') || null;
      el.addEventListener('playing', sayPlay);
      el.addEventListener('pause', sayPlay);
      el.addEventListener('seeked', sayPlay);
      el.addEventListener('ended', sayPlay);
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
      setStatus('Sound is off for this message. This screen blocked it.');
      render(item, { muted: true });
    }

    function onClipError() {
      clearStall();
      if (active) stallReport.stuck('error');   // playback_stall.js: a clip that plays next ends the stretch
      if (countFailure()) return;
      afterFailure(() => {
        bus.publish('segment/done', { provider: 'personal', reason: 'error' });
        if (cfg.autoAdvance && ids.length > 1) bus.publish('personal/next');
      });
    }

    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      clearFailWait();              // whatever asked for this clip, a held failure is superseded
      shownAt = now();
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
        playLog.played(id);
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

    // `{ source, chosenId, sources }`, as in photos.js: a stored choice missing from the list is kept
    // (`chosenId`) and a stand-in shown, never replaced by "the only source there" (§3e).
    async function ensureSource() {
      // photo sources first (2026-10-09): pictures added on this device are pictures, never videos - not offered here,
      // so a screen whose only source is those pictures still says "no source" instead of adopting them.
      const sources = ((await client.list()) || []).filter((s) => !(s && s.kind === 'device'));
      knownSources = sources;   // backup source
      for (const s of sources) if (s && s.id) labels[s.id] = s.label || s.base_url || s.id;
      if (cfg.sourceId) {
        const found = sources.find((s) => s.id === cfg.sourceId);
        if (found) return { source: found, chosenId: cfg.sourceId, sources };
      }
      const qp = new URLSearchParams(location.search);
      const ps = qp.get('personalSource');
      if (ps) {
        const base = ps.replace(/\/+$/, '');
        const existing = sources.find((s) => s.base_url === base);
        const src = existing || await client.add({ label: 'dev personal', base_url: base, kind: 'agent' });
        state.set({ sourceId: src.id, album: qp.get('personalAlbum') || cfg.album, subjectName: qp.get('personalSubject') || cfg.subjectName });
        return { source: src, chosenId: src.id, sources };
      }
      if (cfg.sourceId) return { source: null, chosenId: cfg.sourceId, sources };
      // Not saved from a list made after the person lookup timed out (person_known.js `trusted`; photos.js).
      if (sources.length === 1) {
        // desktop prompt: the only source, on another computer, is neither adopted nor saved from here (photos.js).
        if (!(await quietReach(sources[0], { check: reachCheck })).quiet) return { source: null, chosenId: null, sources, elsewhere: sources[0] };
        if (client.trusted?.() !== false) state.set({ sourceId: sources[0].id });
        return { source: sources[0], chosenId: null, sources };
      }
      return { source: null, chosenId: null, sources };
    }

    function clearRecheck() { if (recheckTimer != null) { clearTimer(recheckTimer); recheckTimer = null; } }
    function armRecheck() {
      clearRecheck();
      if (destroyed || !degraded || !degraded.chosenId || !(recheckMs() > 0)) return;
      recheckTimer = setTimer(() => { recheckTimer = null; recheck(); }, recheckMs());
    }
    // Is the chosen source back? One quiet listing; if it answers, reload, which takes it back.
    async function recheck() {
      if (!degraded || destroyed) return;
      const seq = loadSeq;
      const want = degraded.chosenId;
      let back = false;
      try {
        const rows = (await client.list()) || [];
        const chosen = rows.find((s) => s && s.id === want);
        if (chosen) {
          const r = await listingWithin(quietList, chosen, cfg.album,   // desktop prompt: never asks by itself
            { accept: videosOf, waitMs: recheckMs(), setTimer, clearTimer });
          back = r.ok;
          // Set aside because its CLIPS stopped loading: back only when one of them loads for real.
          if (back && loadFailed.has(chosen.id)) {
            back = !!r.items[0] && await (ctx.mediaLoads || mediaLoads)(r.items[0], { waitMs: recheckMs(), setTimer, clearTimer });
          }
        }
      } catch { back = false; }
      if (destroyed || seq !== loadSeq || !degraded || degraded.chosenId !== want) return;
      if (back) reload(); else armRecheck();
    }

    // `keepFailed`: only the reload a dead source triggers keeps it set aside (see photos.js).
    async function reload({ keepFailed = false } = {}) {
      const seq = ++loadSeq;
      if (!keepFailed) loadFailed.clear();
      clearVideoEnd();
      clearRecheck();
      setStatus('Loading messages…');
      let found;
      try { found = await ensureSource(); }
      catch (e) { if (seq === loadSeq) setStatus('Could not reach the site', true); return; }
      if (seq !== loadSeq) return;
      const { source: chosenSource, chosenId, sources } = found;
      let source = chosenSource;
      let listing = null;
      if (!source && !chosenId && found.elsewhere) {   // desktop prompt: the only source is on another computer
        degraded = null;
        items = ids = []; byId = {}; currentId = null; shownSourceId = null;
        if (stage()) stage().innerHTML = '';
        setName();
        setStatus(ELSEWHERE_LINE, false, tryAction(found.elsewhere));
        return;
      }
      if (source || chosenId) {
        // The chosen source -- or, when it cannot be listed, the best stand-in (media_sources.js).
        const got = await listOrFallback({
          sources, chosen: chosenSource, chosenId, album: cfg.album, personId: personOf(ctx),
          resolve: quietList, accept: videosOf,   // desktop prompt: never asks by itself
          waitMs: listingWaitMs(), setTimer, clearTimer, skip: loadFailed,
          backup: backupNow(),   // backup source
        });
        if (seq !== loadSeq) return;
        const cid = (chosenSource && chosenSource.id) || chosenId;
        // choosing the album: an album the chosen source does not have - the row lists its folders to choose from.
        if (chosenSource && got.failure && got.failure.code === 'album') albumChooser.heard(chosenSource, cfg.album, null);
        if (got.source) {
          source = got.source; listing = got.listing;
          degraded = got.fellBack
            ? { chosenId: cid, chosenLabel: (chosenSource && chosenSource.label) || labels[cid] || null, err: got.failure,
              shownLabel: got.source.label || got.source.base_url || got.source.id, backup: !!got.byChoice }
            : null;
        } else {
          // Nothing from any source: keep asking after the chosen one, and say what is wrong.
          // (`shownLabel` null: nothing is standing in, so the caption claims nothing.)
          degraded = { chosenId: cid, chosenLabel: (chosenSource && chosenSource.label) || labels[cid] || null, err: got.failure, shownLabel: null };
          armRecheck();
          // The failed source's clips are not offered again (a director's next gets "empty"), and
          // no dead clip is left on the stage under the words.
          items = ids = []; byId = {}; currentId = null; shownSourceId = null;
          if (stage()) stage().innerHTML = '';
          setName();
          // desktop prompt: the chosen source is on another computer - the quiet line and the press, not "unreachable".
          if (chosenSource && got.failure && got.failure.code === 'elsewhere') { setStatus(ELSEWHERE_LINE, false, tryAction(chosenSource)); return; }
          if (chosenSource) { setStatus(`Could not reach the source “${escapeHtml(chosenSource.label)}”`, true); return; }
          const mine = (sources || []).filter((x) => mayShowSource(x, personOf(ctx)));
          if (mine.length) {
            setStatus(`The chosen video source is gone (${escapeHtml(mine.map((x) => x.label || x.base_url || x.id).join(', '))} connected). `
              + 'Pick one for this panel in Screens.', true);
            return;
          }
          source = null;
        }
      } else {
        degraded = null;
      }
      if (!source) {
        // *** CONNECT FROM HERE, NOT ONLY FROM MEDIA / SOURCES. *** Added 2026-09-08, same fix
        // and same reasoning as `photos.js`'s own — Mike's "sources structural rule."
        const { isFolderPickerSupported: canPick } = await import('../folder_source.js');
        setStatus('No video source connected.', false, canPick() ? {
          label: 'Connect a folder',
          run: async () => {
            setStatus('Choosing…');
            try {
              // (row 2.49) the Nimrod folder's Videos when this device has one (no picker); else the picker, there.
              const { connectFolderFor } = await import('../folder_source.js');
              await connectFolderFor('videos');
              reload();
            } catch (err2) {
              setStatus('No video source connected.', false,
                { label: 'Connect a folder', run: () => reload() });
            }
          },
        } : null);
        items = ids = []; byId = {}; return;
      }
      if (degraded) armRecheck(); else clearRecheck();
      shownSourceId = source.id;
      clipFails = 0;
      sourceLabel = source.label;
      // recorded PERSONAL videos: keep only video clips (audio-only messages are a later add)
      items = videosOf(listing);
      lastListing = degraded ? null : { sourceId: source.id, album: cfg.album, listing };   // every folder inside
      if (!degraded) albumChooser.heard(source, cfg.album, listing);   // choosing the album
      byId = Object.fromEntries(items.map((it) => [it.id, it]));
      ids = items.map((it) => it.id);
      recent = []; history = []; histPos = -1;
      const lbl = mount.querySelector('[data-source-label]');
      if (lbl) lbl.textContent = `${subjectName()} — ${items.length} clip${items.length === 1 ? '' : 's'}${truncatedWords(listing)}`;
      if (!items.length) { setStatus('No videos in this source or album.'); return; }
      setStatus(null);
      // A `directed` instance waits for the content director to advance it (so a
      // hidden, freshly-loaded provider never emits a spurious segment/done). Standalone
      // it autostarts the first clip.
      if (!cfg.directed) advance();
      setName();   // the caption says a stand-in is playing even when the clip is the same one
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
          // THE TRIES (playback_stall.js): "Tries before the next one", none for "Leave it as it is"; a held
          // pause's one "retry" is only ever its notice.
          setTimer, clearTimer,
          retries: () => (stallReason === 'held' ? 1 : (stallNow().fix ? stallNow().tries : 0)),
          // Two clocks, one instance: hours when a person stopped it, seconds otherwise.
          stallMs: () => (stallReason === 'held' ? holdNotifyMs() : stallNow().stallMs),
          onRetry: (id, n) => {
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
            stallReport.stuck(stallReason);   // playback_stall.js: said once per stretch
            const item = byId[id];
            if (!item) return;
            // A blocked autoplay will be blocked again in twenty seconds' time, so the
            // retry that has any chance of working is the muted one.
            if (stallReason === 'blocked') { playMuted(item); return; }
            // Otherwise ask it to carry on where it is (the first try), and only reload if there is no
            // element left to ask - or, from the second try (2026-10-13), because carrying on did not work.
            if (n === 1 && currentVideo && currentVideo.play) {
              currentVideo.play().catch(() => { render(item, { muted: mutedFallback }); });
              return;
            }
            render(item, { muted: mutedFallback });
          },
          onGiveUp: () => {
            setHeld(false);
            stallReport.stuck(stallReason);   // "Leave it as it is" gives up on the first stall
            if (!stallNow().fix) {
              // Nothing is fixed: no next message, no setting the source aside. The director (a container) is
              // still told the segment is over, as it always was; what it does is its own choice.
              if (stallNow().notify !== 'off') setStatus('This message has stopped.');
              bus.publish('segment/done', { provider: 'personal', reason: 'timeout' });
              return;
            }
            if (countFailure()) return;   // the third clip in a row: the source is down, not the clip
            if (stallNow().notify !== 'off') setStatus('That message wouldn\u2019t play. Moving on.');
            bus.publish('segment/done', { provider: 'personal', reason: 'timeout' });
            if (cfg.autoAdvance && ids.length > 1) bus.publish('personal/next');
          },
        });

        // HIDDEN MEANS DISARMED. A director shows one provider at a time and leaves the
        // rest mounted; without this a hidden clip's stall would end the segment that is
        // actually on screen. `heartbeat` returns on `!active` for the same reason — a
        // hidden provider quieting the backstop for the visible one is the same bug wearing
        // the opposite sign.
        bus.subscribe('personal/deactivate', () => {
      active = false; clearStall(); stallReport.gone();
      // Hidden in a Lineup means silent (2026-10-14; youtube.js has the same, and why only a directed one).
      if (cfg.directed) { try { currentVideo?.pause?.(); } catch (e) { console.error('personal: pause when hidden', e); } }
    });

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

        playLog.subscribe((s) => { stats = s; });   // play history (this device) -> picker stats

        state.subscribe((s) => {
          rawRow = s && typeof s === 'object' ? s : {};
          const wasSpeaker = cfg[PANEL_SPEAKER_KEY];
          cfg = { ...DEFAULTS, ...s };
          // (row 2.97) a different speaker chosen: the clip playing now moves to it, without starting again.
          if (cfg[PANEL_SPEAKER_KEY] !== wasSpeaker && currentVideo) routeToSpeaker(currentVideo, cfg[PANEL_SPEAKER_KEY]);
          stallReport.refresh();        // playback_stall.js: an open stretch is re-said with the settings as they are
          // every folder inside: the two folder settings are part of what is listed, so a change lists again.
          const lo = listOptions(cfg, cfg.sourceId);
          const ref = `${cfg.sourceId}|${cfg.album}|${lo.deep}|${lo.leaveOut.join('\n')}`;
          // backup source: a changed backup reloads only while a stand-in is (or should be) playing.
          const bref = String(cfg[BACKUP_KEY] || '');
          const backupMoved = bref !== lastBackupRef;
          lastBackupRef = bref;
          if (ref !== lastSourceRef) { lastSourceRef = ref; reload(); }
          else if (backupMoved && degraded) reload();
          else { setName(); const lbl = mount.querySelector('[data-source-label]'); if (lbl && ids.length) lbl.textContent = `${subjectName()} — ${ids.length} clip${ids.length === 1 ? '' : 's'}`; }
        });
      },
      // backup source: the "If this can't be reached, use" row's live choices (media_sources.js backupPanelChoices).
      settingsChoices: () => ({
        [BACKUP_KEY]: backupPanelChoices({ sources: knownSources, mainId: cfg.sourceId || null, current: cfg[BACKUP_KEY],
          screen: screenBackup(), panelDefault: BACKUP_ANY, personId: personOf(ctx),
          showing: degraded && degraded.backup ? degraded.shownLabel : null }),
        album: albumChooser.row(cfg.sourceId || shownSourceId, cfg.album),   // choosing the album
      }),
      // every folder inside (row 2.78): the chosen source's folders in the settings menu, each one press to leave out or
      // put back (media_sources.js leaveOutRows; kiosk.js `menuItems`).
      menuItems: () => {
        const ll = lastListing;
        if (!ll || ll.sourceId !== cfg.sourceId) return [];
        return leaveOutRows({ idPrefix: 'personal-leave', listing: ll.listing, album: cfg.album, sourceId: ll.sourceId, cfg,
          open: foldersOpen, onOpen: (v) => { foldersOpen = !!v; }, onSet: (map) => state.set({ [LEAVE_OUT_KEY]: map }),
          what: 'videos' });
      },
      __probe: () => ({ folders: lastListing?.listing?.folders || null, ids: ids.slice(), label: mount.querySelector('[data-source-label]')?.textContent || '' }),
      onResize() {},
      onHide() { active = false; clearStall(); stallReport.gone(); sayNone(); state.flush(); },
      destroy() {
        destroyed = true;
        stallReport.gone();
        playLog.destroy();
        clearRecheck();
        scoped?.dispose();
        clearTimer(pollTimer); pollTimer = null;
        clearFailWait();
        active = false; clearStall(); clearVideoEnd(); currentVideo = null;
        currentKey = null; sayNone();                  // watching along: a follower is told nothing plays here now
        // Destroyed while held: publish the end on the way out — `held.js` rule 3.
        heldSignal.release();
      },
    };
  },
);
