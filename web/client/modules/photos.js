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
import {
  createMediaSourcesClient, resolveListing, listOrFallback, listingWithin, degradedLine, mayShowSource,
  LISTING_WAIT_MS, SOURCE_RECHECK_MS,
} from '../media_sources.js';
import { personSources, personOf } from '../person_known.js';
import { cacheGet, cacheSet } from '../cache.js';
import { createWatchdog } from '../watchdog.js';
import { pick, statsFromEvents } from '../rng.js';
import { flashLimit, failureFloorMs, failureBackoffMs } from '../flash_limit.js';
import { applyGrade } from '../lut.js';
import {
  autostartFields, shouldAutostart, panelAlone, createPlayReporter, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';

// `fit: contain` — SHOW THE WHOLE PHOTO. It defaulted to `cover`, which crops to fill:
// a 1200x800 photo in a 775x423 panel lost 18% of its height, off the top and bottom,
// which is exactly where faces are. For a module whose entire reason for existing is
// somebody seeing their people, cropping their heads off is not a rendering preference.
// The letterboxing `contain` would otherwise leave is now the theme's own `--surface`
// (see modules.css) — not a black bar, not the photo blurred into its own backdrop.
// CHANGED 2026-09-21, Mike: "I think we should lose the blurry background on the photos
// and just have it show the theme." Was a blurred, darkened copy of the same photo
// filling the gap (the common photo-frame convention); dropped now that themes are a
// real, live per-account choice this session built out — a plain themed fill sits behind
// every photo consistently, instead of each one growing its own soft-focus background.
// `intervalMs` 15 s BY DEFAULT, not 8 (Mike, 2026-09-29: "8 seconds is too short for the
// default though. Make it 15."). A default only: a panel with a stored choice keeps it, and 8
// is still one of the options for anybody who wants it.
const DEFAULTS = { sourceId: '', album: '', intervalMs: 15000, fit: 'contain' };
// How long a video may go without reporting progress before the slideshow moves on. It is
// NOT `intervalMs` — that is how long a still photo is shown, and a video is allowed to be
// much longer than that. Fifteen seconds of a video that is supposedly playing saying
// nothing at all is a stall by any reading.
const VIDEO_STALL_MS = 15000;
const RECENT_CAP = 12;          // in-memory anti-repeat window (picker also hard-excludes)
const HOLD_PULSE_MS = 15 * 60 * 1000;   // a held slideshow's "still here" (see `pulseHold`)
// *** THE LAST PICTURES SEEN (§3e: "If none can, show something rather than nothing"). *** When no source
// at all can be listed, the panel keeps showing pictures that already appeared on it -- they may well
// still be in the browser's cache -- rather than freezing or going blank. Remembered per PANEL and per
// PERSON (so one resident's pictures never come back on another's screen), on this device only.
//   KEEP_LAST 50: about twelve minutes of pictures at the default 15 s before one repeats, and ~10 KB
//     of addresses in local storage. More buys variety nobody in a fallback needs; fewer starts to loop.
//   KEEP_WRITE_MS 60 s: how often the list may be written to storage. A slideshow over a big folder
//     shows a new picture every few seconds and the list does not need to be on disk that fast; the
//     last unwritten minute is written when the panel hides or closes.
// Not settings: nobody choosing a slideshow's interval is served by tuning a cache.
const KEEP_LAST = 50;
const KEEP_WRITE_MS = 60 * 1000;
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
//
// `readOnly` SINCE 2026-09-28, and it changes nothing you can see: that day the settings menu
// learned to give a text field a real text box, so a text field is editable UNLESS it says
// otherwise. This one says otherwise because the album is a pick over LIVE data owned in Media /
// Sources - typing a name here that the source does not have would be a way to break the panel.
const SETTINGS = [
  { key: 'intervalMs', label: 'Change photo every', kind: 'choice', default: DEFAULTS.intervalMs,
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
    placeholder: 'Everything', readOnly: true, note: 'set in Media / Sources' },
  // *** WHEN IT OPENS (Mike, 2026-10-02: autostart "on for youtube/picture slideshow"). *** game_start.js's
  // two rows, ON by default -- exactly what this panel did before the row existed. Off: the first picture
  // shows and stays, with a Start button, until Play (the bar's button, Space, a switch) or a press on it.
  ...autostartFields({ on: true }),
  // *** A PAUSED SLIDESHOW CARRIES ON BY ITSELF (2026-10-02). *** CLAUDE.md's signed-off invariant: a screen
  // must never enter a state that only an input can leave, when the person in front of it cannot give that
  // input. One stray press of Space or a switch would otherwise freeze the pictures until somebody came by.
  // 30 minutes: long enough for a deliberate pause during a visit or a call, short enough that a stray one
  // doesn't hold the pictures for a night. "Never" is there for anybody who wants a pause to mean pause.
  // Only a PAUSE times out -- a slideshow waiting for Start because autostart was set off waits as it was set.
  // Level 'advanced': a safety default nobody needs to pass on every lap of the panel's menu (a switch user
  // walks every 'standard' row of it).
  { key: 'resumeAfterMs', label: 'After a pause, carry on by itself', kind: 'choice', default: 30 * 60 * 1000, level: 'advanced',
    options: [
      { value: 10 * 60 * 1000, label: 'after 10 minutes' },
      { value: 30 * 60 * 1000, label: 'after 30 minutes' },
      { value: 2 * 60 * 60 * 1000, label: 'after 2 hours' },
      { value: 0, label: 'never: stay paused until Play' },
    ] },
];
// The words over a slideshow that is waiting, or that somebody paused. Site copy: no names.
export const PHOTOS_START_LINES = Object.freeze({
  waiting: 'Press Start for the slideshow.',
  paused: 'Paused. Press Start to carry on.',
});

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

// *** WHAT THE SLIDESHOW MAY SHOW: IMAGES AND VIDEOS, AND NOTHING ELSE. ***
//
// `render` draws a <video> for a video and an <img> for ANYTHING else. That was safe while the
// listers only ever returned those two kinds; on 2026-09-30 they learned `audio` (so a music
// folder is not empty), and without this filter every song in a mixed folder would have become a
// broken image on the screen that outranks everything. So it is a list of what IS shown, not of
// what is not: a kind added to the listers later, or an item with no kind at all, is left out
// rather than drawn as a broken box. Exported so the rule is checked without a browser.
export const SLIDESHOW_KINDS = Object.freeze(['image', 'video']);
export function slideshowItems(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && SLIDESHOW_KINDS.includes(it.kind));
}

registerModule(
  // CRITICAL, and it is not a compliment - it is the audit's threshold. CLAUDE.md: *"PHOTOS
  // outrank every game/feature."* Somebody may be at this screen around the clock and it is their
  // main window to her people, so a setting on this panel that is expensive to reach is a
  // real problem at half the presses it would take to be one anywhere else.
  // FALLBACK EXPOSURE: `local`. The bytes come from the media agent rather than the platform,
  // so photos survive the platform being down - which is most of why this is the fallback of
  // choice - but not the drive being unmounted.
  { type: 'photos', title: 'Photos', // DESCRIBES, DOES NOT JUSTIFY (PRIORITY.md #4). The second sentence used to read "For most
    // people this is the whole reason to set a screen up" - true, and an argument rather than a
    // description. This string is what the Add-module picker shows somebody CHOOSING, where the
    // question is what the thing does. The argument still exists where it belongs, in the
    // catalog's `why` on the parts page.
    description: 'Their own photos, on a loop. Reads them straight off your machine.',
    importance: 'critical', dependsOn: 'local', settings: SETTINGS,
    // A new photos panel starts at the interval of one already on the same screen (Mike,
    // 2026-09-29: "keep it per panel, copy from existing"). Only the interval, and only once,
    // at creation - see module.js `seedFromSibling`.
    copyFromSibling: ['intervalMs'] },
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
    //
    // *** AND WHOSE SCREEN IT IS MAY NOT BE KNOWN YET (person_known.js, 2026-10-02). *** Read once here,
    // a panel mounted before the screen's person lookup landed listed EVERY resident's sources for
    // good. `personSources` lists for whoever the screen is for -- it waits for that answer (bounded:
    // the screen carries on without it after PERSON_WAIT_MS) while the panel draws and says
    // "Loading photos…", and re-lists (`reload`) if the answer changes after a list was made.
    const scoped = ctx.sources ? null : personSources(ctx,
      (pid) => createMediaSourcesClient({ user, cache: true, personId: pid }),
      { onChange: () => reload() });
    const client = ctx.sources || scoped;

    // *** A SEAM BESIDE `ctx.sources`, AND IT EARNED ITS PLACE. ***
    //
    // The "Allow" button below -- the one that brings her photos back after a folder loses
    // permission, which happens on an ordinary browser restart -- was one of the 18 controls
    // `unpressed_controls.py` reports as never pressed by any test. It only appears when the
    // listing fails in ONE specific way, and with `resolveListing` reached straight through the
    // module import there was no way to make that happen from outside.
    //
    // Production is untouched: with nothing injected this is the same function it always called.
    const resolveList = ctx.resolveListing || resolveListing;

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
    // Only the failure backoff reads this clock; the slideshow's own timing does not.
    const now = ctx.now || (() => Date.now());
    let failStreak = 0;             // items in a row that failed (FAILURE BACKOFF)
    let lastShownAt = 0;            // when the item on screen appeared

    // *** WAITING FOR START, AND PAUSED (2026-10-02). *** `waiting`: autostart is off (game_start.js) and
    // nobody has pressed Start yet -- decided once, as the first picture shows. `paused`: somebody pressed
    // Pause (the bar's button, Space, a switch: `photos/pause`). Either way the picture on screen STAYS (no
    // timer, a clip held at its first frame), and Next / Previous still move by hand. Play, Start, or a press
    // on the picture carries on. The shell's Pause / Play follows (`PLAY_STATE_TOPIC`), so its next press is
    // the right one. NOT A GATE: nothing that was running stops for it -- it is a slideshow that has not been
    // started, or that somebody stopped on purpose.
    let startDecided = false;
    let waiting = false;
    let paused = false;
    let resumeTimer = null;   // a pause carries on by itself (`resumeAfterMs`)
    const holding = () => waiting || paused;
    const reportPlay = createPlayReporter(bus, ctx);

    // *** WHICH SLIDESHOW A "NEXT" CAME FROM. *** (Mike, 2026-09-29: "Setting photos to 30
    // seconds doesn't seem to work now.")
    //
    // Every module on a screen is handed a SCOPE of the screen's one bus, and a scope's
    // `publish` is the root bus's own - so the bare `photos/next` this module publishes when
    // ITS timer runs out reaches EVERY photos panel on the screen, and each of them obeyed it.
    // Measured on the real kiosk, two photos panels on one grid: the panel set to 30 seconds
    // changed every 8 seconds, on the other panel's clock. The setting was stored and read
    // correctly the whole time; something else was pressing "next" for it. The arrow under a
    // photo did the same, twice over: both panels bound the same source name, so one press
    // fanned out through both bindings and advanced every photos panel twice.
    //
    // So what this module publishes FOR ITSELF - its timer, the end of a video, the stall
    // watchdog, its own arrows - carries this tag in `meta`, and a tagged message from another
    // slideshow is not this one's to act on. The topic stays bare on purpose: `health.js`
    // counts it as the heartbeat. An UNTAGGED next - a switch, a voice command, a test, the
    // verb router's instance-addressed alias - still reaches whoever it always reached.
    const ownTag = `photos:${ctx.instanceId || Math.random().toString(36).slice(2)}`;
    const OWN = { slideshow: ownTag };
    const isMine = (meta) => !meta || !meta.slideshow || meta.slideshow === ownTag;
    let lastSourceRef = null;       // to reload only when sourceId/album change
    // The account's sources, cached from the listing call `reload` already makes. THE MENU
    // PAINTS SYNCHRONOUSLY, so `settingsChoices` cannot go to the network: a row that waits
    // on a facility connection to draw is a row that looks broken.
    let knownSources = [];
    // The sources found when there was more than one and none chosen — so the message can
    // NAME them instead of saying nothing is connected when several things are.
    let multiSource = null;
    let loadSeq = 0;                // guards against overlapping reloads (races)

    // *** A SOURCE SHOULD DEGRADE, NOT STOP (MIKE_CHANGE_LIST §3e, 2026-10-02). ***
    // `degraded` is set while the panel shows something other than its chosen source -- a stand-in
    // (media_sources.js `listOrFallback`: the person's own other sources, then the account's, never
    // another resident's) or the last pictures seen. It says so in a corner chip, asks after the chosen
    // source every SOURCE_RECHECK_MS, and goes back to it when it answers. NOTHING HERE IS SAVED: the
    // chosen source stays the chosen source.
    let degraded = null;            // { chosenId, chosenLabel, err, chosenSource, shownLabel }
    let keptMode = false;           // showing the last pictures seen, because no source could be listed
    let recheckTimer = null;
    let lastFailure = null;         // { source, err, sources } -- the words to fall back on
    const labels = {};              // every source's label seen, so a vanished chosen one can be named
    let seen = [];                  // the last pictures that really appeared here (KEEP_LAST)
    let seenDirty = false, seenWrittenAt = 0;
    const listingWaitMs = () => Number(ctx.listingWaitMs ?? LISTING_WAIT_MS);
    const recheckMs = () => Number(ctx.sourceRecheckMs ?? SOURCE_RECHECK_MS);

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
      onGiveUp: () => { bus.publish('photos/next', undefined, OWN); },
    });

    function clearAdvance() {
      if (advanceTimer) { clearTimer(advanceTimer); advanceTimer = null; }
      if (videoEndOff) { videoEndOff(); videoEndOff = null; }
      videoStall.disarm();
      currentVideo = null;
    }

    function scheduleAdvance(item) {
      clearAdvance();
      if (holding()) return;               // waiting for Start, or paused: the picture stays
      if (item.kind === 'video') return;   // videos advance on 'ended' + the watchdog above
      // A FLOOR, not a clamp to the declared options: a value from before the migration, or
      // from a group-apply that has not been validated yet, must not turn the slideshow into
      // a strobe in front of somebody with a brain injury.
      const ms = Math.max(2000, Number(cfg.intervalMs) || DEFAULTS.intervalMs);
      advanceTimer = setTimer(() => bus.publish('photos/next', undefined, OWN), ms);
    }

    // *** FAILURE BACKOFF (photosensitivity audit, 2026-09-30). *** A failed item used to move on
    // at once, so a folder where EVERY clip is broken replaced one with the next as fast as the
    // browser could fail them. Now the n-th failure in a row stays up `failureBackoffMs(n, limit)`
    // from when it appeared (one flash period, then 2 s doubling to 30 s). Held on `advanceTimer`,
    // so a person's own next (the arrow, a switch) still moves on at once and cancels the wait.
    // PHOTOS AND WORKING CLIPS ARE UNTOUCHED: the photo timer is not involved, and the streak resets
    // the moment a photo is shown or a clip plays through.
    function failedItem() {
      failStreak += 1;
      const wait = Math.max(0, failureBackoffMs(failStreak, flashLimit(ctx)) - (now() - lastShownAt));
      if (!wait) { bus.publish('photos/next', undefined, OWN); return; }
      if (advanceTimer) clearTimer(advanceTimer);
      advanceTimer = setTimer(() => { advanceTimer = null; bus.publish('photos/next', undefined, OWN); }, wait);
    }

    function render(item) {
      lastShownAt = now();
      if (item.kind !== 'video') failStreak = 0;   // a photo is shown for its interval: the run is over
      const st = stage();
      if (!st) return;
      st.innerHTML = '';
      let el;
      if (item.kind === 'video') {
        el = document.createElement('video');
        // MUTED, so the browser's autoplay policy cannot refuse it. A clip in the photo
        // rotation is wallpaper; `modules/personal.js` is where a voice is the point.
        el.src = item.url; el.muted = true; el.autoplay = true; el.playsInline = true;
        currentVideo = el;
        const shownAt = now();
        // A clip that plays through to its end moves on at once, exactly as it always did. One
        // that ENDS inside one flash period of appearing (a zero-length or truncated file) is
        // treated like an error - see failedItem. A one-second Live Photo still plays normally.
        const onEnded = () => {
          videoStall.disarm();
          if (now() - shownAt >= failureFloorMs(flashLimit(ctx))) { failStreak = 0; bus.publish('photos/next', undefined, OWN); }
          else failedItem();
        };
        // An explicit failure moves on after one flash period; a RUN of them backs off
        // (flash_limit.js failureBackoffMs), so a folder of broken clips cannot spin.
        const onError = () => { videoStall.disarm(); failedItem(); };
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
        // Waiting for Start, or paused: the clip shows its first frame and waits (`carryOn` plays it).
        if (holding()) el.autoplay = false;
        else {
          // Armed BEFORE play() is asked for, so a clip that never starts at all is covered
          // by the same clock as one that stops halfway.
          videoStall.arm(item.id);
          el.play?.().catch(() => {});
        }
      } else {
        el = document.createElement('img');
        // 'Photo' rather than '' when a source supplies no caption, and rather than the
        // filename. The demo listing deliberately sends no captions now (Mike: do not turn
        // `20260313_003702.jpg` into a caption), and "20260313 003702" read aloud by a screen
        // reader is noise. A plain category word is the honest thing to say about a picture
        // nobody has described.
        el.src = item.url; el.alt = item.name || 'Photo';
        // A picture that really appeared is one the panel can fall back on (KEEP_LAST); one of those
        // that no longer loads is dropped from the fallback and the slideshow moves on.
        el.addEventListener('load', () => rememberSeen(item), { once: true });
        el.addEventListener('error', () => keptFailed(item.id), { once: true });
      }
      el.style.objectFit = cfg.fit;
      el.className = 'shot';
      // Row 2.49: this device's colour grade (lut.js), OFF by default. With none chosen it does not
      // touch the element at all, so a photo shows exactly as it always has.
      applyGrade(el, item.kind === 'video' ? 'video' : 'photos');
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
        // durable, append-only play record; picker stats derive from these. A picture shown while the
        // slideshow WAITS for Start is logged when it starts (`carryOn`), not before: it has not played.
        if (!waiting) logPlay(id);
      }
    }
    function logPlay(id) {
      events.append('play', { id, at: Date.now() }).catch((e) => console.error('photos: play log', e));
    }

    function advance() {
      if (!ids.length) return;
      decideStart();
      const id = pick(ids, stats, { now: Date.now(), rand: Math.random, recent, channels });
      if (id) show(id, true);
    }

    // ---- waiting for Start, and Pause / Play (see `waiting` above) --------------------------------
    // Decided ONCE, as the first picture is about to show: a setting changed later applies to the next
    // time the panel opens, never by stopping a slideshow somebody is watching.
    function decideStart() {
      if (startDecided) return;
      startDecided = true;
      waiting = !shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) });
      // Only a slideshow that WAITS says so: one that starts by itself is what every panel always was.
      if (waiting) syncHold();
    }
    function syncHold() {
      const host = mount.querySelector('[data-start-host]');
      if (host) {
        if (holding()) {
          host.innerHTML = startOverlayHtml({ label: 'Start', text: waiting ? PHOTOS_START_LINES.waiting : PHOTOS_START_LINES.paused });
          host.hidden = false;
        } else { host.innerHTML = ''; host.hidden = true; }
      }
      const root = mount.querySelector('.photos');
      if (root) { if (waiting) root.dataset.waiting = '1'; else delete root.dataset.waiting; if (paused) root.dataset.paused = '1'; else delete root.dataset.paused; }
      reportPlay(!holding());
      pulseHold();
    }
    // *** A HELD SLIDESHOW SAYS IT IS HERE. *** health.js judges a photos panel silent after an hour with
    // no `photos/next`, and a slideshow waiting for Start (or paused overnight) publishes none -- so the
    // recovery ladder would remount it, which STARTS a paused one. So while it is held it says `photos/state`
    // (a heartbeat health.js already counts, tagged as this panel's own) as it holds and every HOLD_PULSE_MS.
    // 15 minutes: a quarter of health's photos bound, so two can be missed before it matters; not a setting,
    // because nobody is served by tuning it (the reason youtube.js gives for PROGRESS_MS).
    let holdTimer = null;
    function pulseHold() {
      if (holdTimer != null) { clearTimer(holdTimer); holdTimer = null; }
      if (!holding()) return;
      try { bus.publish('photos/state', { holding: true, waiting, paused }, OWN); } catch { /* not load-bearing */ }
      holdTimer = setTimer(() => { holdTimer = null; pulseHold(); }, HOLD_PULSE_MS);
    }
    /** Start, or carry on after a pause: the picture on screen gets its full interval from now; a clip plays. */
    function carryOn() {
      if (!holding()) return false;
      const wasWaiting = waiting;
      waiting = false; paused = false;
      clearResume();
      syncHold();
      const item = currentId ? byId[currentId] : null;
      if (wasWaiting && item) logPlay(item.id);
      if (!item) { if (!currentId && ids.length) advance(); return true; }
      if (item.kind === 'video') {
        if (currentVideo) { videoStall.arm(item.id); currentVideo.play?.()?.catch?.(() => {}); }
        else render(item);
      } else scheduleAdvance(item);
      return true;
    }
    function pauseShow() {
      if (paused) return false;
      paused = true;
      if (advanceTimer) { clearTimer(advanceTimer); advanceTimer = null; }
      videoStall.disarm();
      try { currentVideo?.pause?.(); } catch { /* gone */ }
      syncHold();
      // See `resumeAfterMs` in the fields: a pause carries on by itself unless the setting says never.
      clearResume();
      const after = Number(cfg.resumeAfterMs ?? 30 * 60 * 1000);
      if (after > 0) resumeTimer = setTimer(() => { resumeTimer = null; if (paused) carryOn(); }, after);
      return true;
    }
    function clearResume() { if (resumeTimer != null) { clearTimer(resumeTimer); resumeTimer = null; } }

    function prev() {
      if (histPos > 0) { histPos -= 1; show(history[histPos], false); }
    }

    function deriveStats(cache) {
      const plays = (cache.events || [])
        .filter((e) => e.kind === 'play')
        .map((e) => ({ id: e.data?.id, at: e.data?.at || Date.parse(e.created_at) || 0 }));
      return statsFromEvents(plays, { idKey: 'id', atKey: 'at' });
    }

    // WHICH SOURCE THIS PANEL MEANS: `{ source, chosenId, sources }`. `source` is the row to list (the
    // chosen one, or the account's only one); `chosenId` is set when a choice is stored, EVEN WHEN THAT
    // SOURCE IS NO LONGER IN THE LIST -- `reload` then shows a stand-in without replacing the choice.
    async function ensureSource() {
      const sources = await client.list();
      knownSources = sources;
      multiSource = null;
      for (const s of sources) if (s && s.id) labels[s.id] = s.label || s.base_url || s.id;
      if (cfg.sourceId) {
        const found = sources.find((s) => s.id === cfg.sourceId);
        if (found) return { source: found, chosenId: cfg.sourceId, sources };
      }
      // dev seed via query param: register once, then remember in config
      const qp = new URLSearchParams(location.search);
      const ps = qp.get('photoSource');
      if (ps) {
        const base = ps.replace(/\/+$/, '');
        const existing = sources.find((s) => s.base_url === base);
        const src = existing || await client.add({ label: 'dev photos', base_url: base, kind: 'agent' });
        state.set({ sourceId: src.id, album: qp.get('photoAlbum') || cfg.album });
        return { source: src, chosenId: src.id, sources };
      }
      // *** A CHOSEN SOURCE MISSING FROM THE LIST IS NOT REPLACED (§3e). *** This used to fall through to
      // "the only source there, so save it", which overwrote somebody's choice the first time their
      // source was missing for a moment (an agent re-paired, a source moved between people). Now the
      // panel shows a stand-in and keeps the choice, and goes back when it reappears.
      if (cfg.sourceId) return { source: null, chosenId: cfg.sourceId, sources };
      // Saved only when the screen KNOWS whose it is: a list made after the person lookup timed out is
      // shown, never saved from (person_known.js `trusted`) -- a late person re-lists and saves then.
      if (sources.length === 1) {
        if (client.trusted?.() !== false) state.set({ sourceId: sources[0].id });
        return { source: sources[0], chosenId: null, sources };
      }
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
      if (sources.length > 1) multiSource = sources;
      return { source: null, chosenId: null, sources };
    }

    // ---- degrade, don't stop (§3e) -------------------------------------------------------------
    const keptKey = () => (ctx.instanceId
      ? `photos-last:${user || 'anon'}:${personOf(ctx) || 'none'}:${ctx.instanceId}` : null);

    // Only pictures (a clip is rarely in the cache whole), only ones that really appeared, and never a
    // folder's object URL (`blob:`), which dies with the page.
    function rememberSeen(item) {
      if (keptMode || !item || item.kind !== 'image' || !item.url || /^blob:/.test(item.url)) return;
      const sid = item.sourceId || '';
      if (seen.some((s) => s.id === item.id && s.sourceId === sid)) return;
      seen.unshift({ id: item.id, url: item.url, name: item.name || '', path: item.path || item.id, sourceId: sid });
      if (seen.length > KEEP_LAST) seen.length = KEEP_LAST;
      seenDirty = true;
      if (Date.now() - seenWrittenAt >= KEEP_WRITE_MS) writeSeen();
    }
    function writeSeen() {
      const k = keptKey();
      if (!k || !seenDirty) return;
      seenDirty = false;
      seenWrittenAt = Date.now();
      cacheSet(k, seen);
    }
    // The pictures to fall back on: this session's, then the ones stored for this panel and person.
    // A picture whose source is in the list and may NOT be shown here (another resident's) is left out.
    function keptPictures(sources) {
      const pid = personOf(ctx);
      const rows = Array.isArray(sources) ? sources : [];
      const k = keptKey();
      const stored = k ? cacheGet(k) : null;
      const out = [];
      const ids = new Set();
      for (const it of [...seen, ...(Array.isArray(stored) ? stored : [])]) {
        if (!it || !it.id || !it.url || /^blob:/.test(it.url) || ids.has(it.id)) continue;
        const src = rows.find((s) => s && s.id === it.sourceId);
        if (src && !mayShowSource(src, pid)) continue;
        ids.add(it.id);
        out.push({ id: it.id, url: it.url, name: it.name || '', path: it.path || it.id, kind: 'image', sourceId: it.sourceId });
        if (out.length >= KEEP_LAST) break;
      }
      return out;
    }
    function useItems(list) {
      items = list;
      byId = Object.fromEntries(items.map((it) => [it.id, it]));
      ids = items.map((it) => it.id);
      channels = Object.fromEntries(items.map((it) => [it.id, albumOf(it.path)]));
      recent = []; history = []; histPos = -1;
    }
    function setLabel(text) {
      const el = mount.querySelector('[data-source-label]');
      if (el) el.textContent = text;
    }
    // The Allow button for a folder whose permission lapsed. The click IS the user gesture the prompt
    // requires -- which is the whole reason this is a button and not a retry on a timer.
    function allowAction(source) {
      return {
        label: 'Allow',
        run: async () => {
          setStatus('Asking…');
          try {
            const { requestFolderAccess } = await import('../folder_source.js');
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
      };
    }
    // The quiet line while a stand-in or the last pictures are showing. A chip, because a picture is.
    function sayDegraded() {
      if (!degraded) return;
      const d = degraded;
      const text = escapeHtml(degradedLine({ shownLabel: keptMode ? null : d.shownLabel, chosenLabel: d.chosenLabel, err: d.err }));
      const perm = d.err && d.err.code === 'permission' && d.chosenSource;
      setStatus(text, keptMode && !perm, perm ? allowAction(d.chosenSource) : null);
    }
    function clearRecheck() { if (recheckTimer != null) { clearTimer(recheckTimer); recheckTimer = null; } }
    function armRecheck() {
      clearRecheck();
      if (!degraded || !degraded.chosenId || !(recheckMs() > 0)) return;
      recheckTimer = setTimer(() => { recheckTimer = null; recheck(); }, recheckMs());
    }
    // Is the chosen source back? One quiet listing; if it answers, reload -- which takes it back.
    async function recheck() {
      if (!degraded) return;
      const seq = loadSeq;
      const want = degraded.chosenId;
      let back = false;
      try {
        const rows = (await client.list()) || [];
        const chosen = rows.find((s) => s && s.id === want);
        if (chosen) {
          const r = await listingWithin(resolveList, chosen, cfg.album,
            { accept: (l) => slideshowItems(l && l.items), waitMs: recheckMs(), setTimer, clearTimer });
          back = r.ok;
        }
      } catch { back = false; }
      if (seq !== loadSeq || !degraded || degraded.chosenId !== want) return;   // something else moved on
      if (back) reload(); else armRecheck();
    }
    function applyListing(source, listing, album, fb = null) {
      keptMode = false;
      useItems(slideshowItems(listing.items)   // songs in the same folder are not photos
        .map((it) => (it.sourceId ? it : { ...it, sourceId: source.id })));
      setLabel(`${source.label}${album ? ' · ' + album : ''} — ${items.length} item${items.length === 1 ? '' : 's'}`);
      degraded = fb ? { ...fb, shownLabel: source.label || source.base_url || source.id } : null;
      if (degraded) armRecheck(); else clearRecheck();
      if (!items.length) { setStatus('No photos in this source/album.'); return; }
      setStatus(null);
      advance();
      sayDegraded();   // after the first picture, so it is a chip over it rather than a sheet
    }
    function showKept(sources) {
      const kept = keptPictures(sources);
      if (!kept.length) return false;
      keptMode = true;
      useItems(kept);
      setLabel(`The last pictures seen — ${kept.length} item${kept.length === 1 ? '' : 's'}`);
      setStatus(null);
      advance();
      sayDegraded();
      return true;
    }
    // A kept picture that no longer loads (not in the cache after all): out of the fallback, and on.
    function keptFailed(id) {
      if (!keptMode || !byId[id]) return;
      items = items.filter((it) => it.id !== id);
      delete byId[id];
      ids = ids.filter((x) => x !== id);
      seen = seen.filter((s) => s.id !== id);
      seenDirty = true;
      if (!ids.length) {
        keptMode = false;
        clearAdvance();
        currentId = null;
        const st = stage();
        if (st) { st.innerHTML = ''; st.dataset.showing = ''; }
        if (lastFailure) sayFailure(lastFailure);
        return;
      }
      if (id === currentId) failedItem();
    }

    // NOTHING COULD BE SHOWN FROM ANY SOURCE: the words this panel has always used for it.
    async function sayFailure({ source, err, sources }) {
      if (!source) {
        // The chosen source is no longer in the list and nothing else could stand in for it.
        // Named only from the sources this screen may show: never another resident's.
        const mine = (sources || []).filter((x) => mayShowSource(x, personOf(ctx)));
        if (mine.length) {
          const names = mine.map((x) => x.label || x.base_url || x.id).join(', ');
          setStatus(`The chosen photo source is gone (${escapeHtml(names)} connected). `
            + 'Pick one for this panel in Screens — this panel’s “Photos from” setting.', true);
          return;
        }
        return showNoSource();
      }
      // The words come from `listingFailure` so they can be checked without a browser; this
      // half is only the wiring. See §E-fail for what they used to be.
      const f = listingFailure(err, source, cfg.album);
      if (f.action === 'Allow') setStatus(f.text, false, allowAction(source));
      else setStatus(f.text, f.retry);
    }

    async function showNoSource() {
      // Nothing to show from here on, so a later message is a full panel again.
      if (stage()) stage().dataset.showing = '';
      {
        if (multiSource) {
          const names = multiSource.map((x) => x.label || x.base_url || x.id).join(', ');
          setStatus(`More than one photo source is connected (${names}). `
            + 'Pick one for this panel in Screens — this panel’s “Photos from” setting.');
        } else {
          // *** CONNECT FROM HERE, NOT ONLY FROM MEDIA / SOURCES. *** Added 2026-09-08 —
          // Mike's "sources structural rule": a module that consumes a source should let you
          // connect one from inside the module itself, not dead-end to a separate tab. This is
          // exactly `media.js`'s own `pick: pickFolder` wiring, called from here instead —
          // same function, same IndexedDB-backed folder handle, same one-user-gesture rule.
          // Browsers that cannot show a directory picker at all (`isFolderPickerSupported()`
          // false — iOS Safari, Firefox) still get the words with no dead button.
          const { isFolderPickerSupported: canPick } = await import('../folder_source.js');
          setStatus('No photo source connected.', false, canPick() ? {
            label: 'Connect a folder',
            run: async () => {
              setStatus('Choosing…');
              try {
                const { pickFolder } = await import('../folder_source.js');
                await pickFolder();
                reload();
              } catch (err2) {
                // A cancelled picker throws too -- not an error worth alarming over, just
                // back to the same offer.
                setStatus('No photo source connected.', false,
                  { label: 'Connect a folder', run: () => reload() });
              }
            },
          } : null);
        }
        items = ids = []; byId = channels = {};
        return;
      }
    }

    async function reload() {
      const seq = ++loadSeq;
      clearAdvance();
      clearRecheck();
      setStatus('Loading photos…');
      let found;
      try {
        found = await ensureSource();
      } catch (e) {
        if (seq !== loadSeq) return;
        // The registry itself failed (rare: it has an offline mirror). The last pictures, if any.
        degraded = cfg.sourceId ? { chosenId: cfg.sourceId, chosenLabel: labels[cfg.sourceId] || null, err: e, chosenSource: null } : null;
        if (degraded && showKept([])) { armRecheck(); return; }
        degraded = null;
        setStatus('Could not reach the platform', true);
        return;
      }
      if (seq !== loadSeq) return;   // a newer reload superseded us
      const { source, chosenId, sources } = found;
      if (!source && !chosenId) { degraded = null; keptMode = false; await showNoSource(); return; }
      // The chosen source -- or, when it cannot be listed, the best stand-in (§3e, media_sources.js).
      const got = await listOrFallback({
        sources, chosen: source, chosenId, album: cfg.album, personId: personOf(ctx),
        resolve: resolveList, accept: (l) => slideshowItems(l && l.items),
        waitMs: listingWaitMs(), setTimer, clearTimer,
      });
      if (seq !== loadSeq) return;
      const cid = (source && source.id) || chosenId;
      const chosenRef = { chosenId: cid, chosenLabel: (source && source.label) || labels[cid] || null,
        err: got.failure, chosenSource: source };
      if (got.source) { applyListing(got.source, got.listing, got.album, got.fellBack ? chosenRef : null); return; }
      // NOTHING FROM ANY SOURCE. Keep asking after the chosen one, show the last pictures if there are
      // any, and otherwise say what is wrong -- over the picture already there, which is left up.
      lastFailure = { source, err: got.failure, sources };
      degraded = chosenRef;
      armRecheck();
      if (showKept(sources)) return;
      keptMode = false;
      await sayFailure(lastFailure);
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
            <div class="photos-start" data-start-host hidden></div>
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
        // ...but not a next another slideshow sent itself (see `ownTag` above).
        bus.subscribe('photos/next', (_p, _t, meta) => { if (isMine(meta)) advance(); });
        bus.subscribe('photos/prev', (_p, _t, meta) => { if (isMine(meta)) prev(); });
        // PLAY AND PAUSE (2026-10-02, actions.js MODULE_VERBS.photos): the bar's one button, Space, a
        // switch, "pause" said aloud. Play also starts a slideshow that is waiting for Start.
        bus.subscribe('photos/play', () => { carryOn(); });
        bus.subscribe('photos/pause', () => { pauseShow(); });
        ensureStartStyle(mount.ownerDocument || document);
        // The Start button, and a press on the picture itself, start (or carry on) a held slideshow.
        mount.querySelector('[data-start-host]').addEventListener('click', (e) => {
          if (e.target instanceof Element && e.target.closest('[data-start]')) carryOn();
        });
        mount.querySelector('[data-stage]').addEventListener('click', () => { if (holding()) carryOn(); });

        // its own buttons are just another source - ONE PER PANEL. Bindings live on the
        // screen's shared bus, so a source name two panels both bind fans a single press out
        // through both bindings.
        const navName = `photos-nav:${ownTag}`;
        const nav = bus.createSource(navName);
        bus.addBinding({ source: navName, signal: 'next', topic: 'photos/next' });
        bus.addBinding({ source: navName, signal: 'prev', topic: 'photos/prev' });
        mount.querySelector('[data-next]').addEventListener('click', () => nav.emit('next', undefined, OWN));
        mount.querySelector('[data-prev]').addEventListener('click', () => nav.emit('prev', undefined, OWN));

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
          const wasInterval = cfg.intervalMs;
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
          else if (currentId && byId[currentId]) {
            const item = byId[currentId];
            // A NEW INTERVAL APPLIES TO THE PHOTO ON SCREEN, not only from the next one. The
            // timer already running was armed with the old value, so picking 30 seconds while
            // a photo had 60 to go left that photo up for the full minute - the choice looked
            // ignored for exactly as long as somebody was watching to see if it worked. The
            // photo on screen now gets the new interval, counted from the change. Videos keep
            // running to their own end, as they always have.
            if (cfg.intervalMs !== wasInterval && advanceTimer && item.kind !== 'video') {
              scheduleAdvance(item);
            }
            render(item);
          }
        });
      },
      onResize() {},
      onHide() { videoStall.disarm(); writeSeen(); state.flush(); },
      // `loadSeq` moves on so a listing still in flight lands on nothing: without it a panel
      // destroyed mid-load (a remount, a screen swapped in place) went on to show a photo and
      // arm a timer after it was gone.
      destroy() {
        loadSeq += 1; clearAdvance(); clearResume(); clearRecheck(); writeSeen(); degraded = null;
        scoped?.dispose(); if (holdTimer != null) { clearTimer(holdTimer); holdTimer = null; }
      },

      // EDIT MODE (edit_mode.js, 2026-10-02). The picture on screen, and the line naming where the photos come
      // from, each with the rows about it -- this panel's own declared settings, nothing new. A picture has no
      // caption of its own here and the slideshow has no "leave this one out" yet, so neither is offered (a
      // row that does nothing is a lie). The source line first: it is the smaller, inside the bar.
      editTargets: () => {
        const label = mount.querySelector('[data-source-label]');
        const st = stage();
        const out = [];
        if (label) out.push({ id: 'source', label: 'Where the photos come from', el: label, keys: ['sourceId', 'album'] });
        if (st) out.push({ id: 'picture', label: 'The picture', el: st, keys: ['fit', 'intervalMs', 'autostart', 'autostartAlone', 'resumeAfterMs'],
          help: 'The picture on screen: how it fits the panel, how long each one stays, and whether the slideshow starts by itself.' });
        return out;
      },
      __probe: () => ({ waiting, paused, currentId, degraded: !!degraded, keptMode, seen: seen.length, ids: ids.slice() }),

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
