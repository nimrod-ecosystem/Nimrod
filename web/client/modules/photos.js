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
//   * play history (which photo was shown when) is kept ON THIS DEVICE (plays.js `panelPlays`, row 2.58);
//     the picker's long-run stats derive from those plays.
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
  LISTING_WAIT_MS, SOURCE_RECHECK_MS, DOWN_AFTER_FAILURES, mediaLoads,
  backupChoice, backupPanelField, backupPanelChoices, BACKUP_KEY, BACKUP_ANY,   // backup source
  mediaUrl,   // pulled pictures: the pull's last-pull.json, served by the agent like any file
  quietResolve, quietReach, tryFromHere, ELSEWHERE_LINE, TRY_HERE_LABEL,   // desktop prompt (2026-10-10)
  // every folder inside (2026-10-10, row 2.78; media_sources.js "EVERY FOLDER INSIDE" argues the two settings)
  subfoldersField, listOptions, withListOptions, leaveOutRows, truncatedWords, SUBFOLDERS_KEY, LEAVE_OUT_KEY,
  // choosing the album (2026-10-10; media_sources.js "CHOOSING THE ALBUM" argues the row)
  albumField, createAlbumChooser, topFoldersLister,
} from '../media_sources.js';
// hide picture (2026-10-09): which pictures this slideshow leaves out (hidden_pictures.js), and the screen actions
// "hide this picture" / "bring it back" press (actions.js PHOTO_ACTIONS; input_speech.js ROUTES).
import { deviceHiddenPictures, pictureKey, HIDE_SCOPES, DEFAULT_HIDE_SCOPE } from '../hidden_pictures.js';
import { PHOTOS_HIDE_TOPIC, PHOTOS_UNHIDE_TOPIC, PHOTOS_REMOVE_TOPIC } from '../actions.js';
// remove this picture (2026-10-10): the removal list (removed_pictures.js), and each source's own choice of whether a
// removed picture is moved off it (media_sources.js ON_REMOVE).
import { deviceRemovedPictures, followUpPlan } from '../removed_pictures.js';
import { removeOnSource, restoreOnSource, onRemoveOf, ON_REMOVE_MOVE } from '../media_sources.js';
import { senderOf } from '../sender.js';
import { personSources, personOf } from '../person_known.js';
import { addDevicePictures, setDevicePhotosOn } from '../device_pictures.js';   // photo sources first
import { cacheGet, cacheSet } from '../cache.js';
import { createWatchdog } from '../watchdog.js';
import { pick } from '../rng.js';
// photos in step (2026-10-12, play_sync.js): what this slideshow shows, said on the screen's own bus (never a socket).
import { PLAY_NOW_TOPIC } from '../play_sync.js';
import { panelPlays } from '../plays.js';
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
// folder art (2026-10-07): the longest `data:` URL kept among the last pictures seen. 8 000 characters, argued: a small
// drawing or icon fits, and fifty at most is 400 KB of the browser's few-MB cache; a folder's full SVG drawing (often
// 20-300 KB) does not, and showing it again needs the folder anyway. Against: a big drawing is not in the fallback
// when its folder cannot be read - it was not before today either (a folder's pictures were blob: URLs).
const KEEP_DATA_URL_MAX = 8000;
const keepableUrl = (u) => !/^blob:/.test(u) && !(/^data:/.test(u) && u.length > KEEP_DATA_URL_MAX);

// *** HIDE THIS PICTURE (2026-10-09; hidden_pictures.js has the record and where it lives). *** Said ("hide this
// picture" / "bring it back"), held (a long press or a right click on the picture opens two buttons), or chosen in this
// panel's settings, where every hidden picture can be brought back. The words, shown and (see `hideSay`) said:
export const HIDE_LINES = Object.freeze({
  hiddenVoice: 'Hidden. Say “bring it back” to undo.',
  hidden: 'Hidden. “Bring it back” is in this panel’s settings.',
  back: 'Brought back.',
  nothingOn: 'There is no picture on screen to hide.',
  nothingHidden: 'No hidden or removed picture to bring back.',
  allHidden: 'Every picture here is hidden or removed. Bring them back in this panel’s settings.',
  // remove this picture (2026-10-10): said back the way Hide is (Mike's shape: "Removed. Say bring it back to undo.").
  removedVoice: 'Removed. Say “bring it back” to undo.',
  removed: 'Removed. “Bring it back” is in this panel’s settings.',
  nothingOnRemove: 'There is no picture on screen to remove.',
});
// HARD-CODED, each argued (Rule 1; none is a setting because nobody is served by tuning it):
//   NOTICE_MS 8 s        how long "Hidden. Say ... to undo." stays: long enough to read twice and say the undo, short
//                        enough not to sit on the next picture. It never blocks anything.
//   LONG_PRESS_MS 600    a touch held this long opens the two buttons: past a tap (~150 ms) and the browsers' own
//                        long-press (~500 ms), short of feeling stuck. A right click opens them at once.
//   PHOTO_MENU_MS 10 s   the two buttons close by themselves (a screen never waits on an answer); the slideshow
//                        carries on underneath them meanwhile.
//   HIDDEN_LIST_MAX 12   hidden pictures listed one per row in the settings menu, newest first; past that the menu is
//                        a scroll nobody with one switch should walk, and "Bring back all" covers the rest.
const NOTICE_MS = 8000;
const LONG_PRESS_MS = 600;
const PHOTO_MENU_MS = 10000;
const HIDDEN_LIST_MAX = 12;

// *** WHICH SLIDESHOW ANSWERS "HIDE THIS PICTURE". *** The words press a SCREEN action (actions.js PHOTO_ACTIONS), not
// a verb, so they work wherever focus is - but a screen may have two slideshows, and only one should hide a picture.
// Every panel that hears it in the same moment puts in a claim; the one that answers is the one showing (not hidden),
// then the one a person pressed on last, then the oldest. A claim arriving alone (a screen's own verb map pointing at
// one panel) is simply that panel. Module scope on purpose: it is a fact about the page (charts.js does the same).
const slideshows = [];
let claims = null;
/** The claim that answers, from `[{ entry: { visible, touchedAt, order } }]`. Pure. */
export function pickAnswerer(list) {
  const xs = (Array.isArray(list) ? list : []).filter((c) => c && c.entry);
  if (!xs.length) return null;
  return [...xs].sort((a, b) => (Number(!!b.entry.visible) - Number(!!a.entry.visible))
    || ((b.entry.touchedAt || 0) - (a.entry.touchedAt || 0)) || ((a.entry.order || 0) - (b.entry.order || 0)))[0];
}
function claim(entry, run) {
  if (!claims) {
    claims = [];
    queueMicrotask(() => {
      const list = claims;
      claims = null;
      const win = pickAnswerer(list);
      try { win?.run(); } catch (e) { console.error('photos: hide', e); }
    });
  }
  claims.push({ entry, run });
}
let slideshowOrder = 0;
// Did a person say it? A spoken press arrives from the speech device (input.js senderMeta: "speech:<control>").
const byVoice = (meta) => /^speech:/.test(senderOf(meta).id || '');

// *** "3 NEW PICTURES TODAY" (2026-10-09, the Drive pull; web/kiosk_installer/deploy/nimrod-photo-pull.sh). *** The
// pull writes `.nimrod-pull/last-pull.json` inside the folder it fills. When the panel's source is a media agent, the
// panel reads it (the agent serves it like any file; its listing leaves dot-folders out) to say one quiet line on
// the "Photos from" row, and to LIST AGAIN when a pull brought new pictures - without that, pictures copied in
// overnight would not appear until the panel happened to be reopened.
//   PULL_CHECK_MS 1 hour: the pull runs daily by default and hourly at most, so an hour notices any pull within an
//   hour; one small file read an hour costs nothing. Not a setting: nobody is served by tuning it.
export const PULL_STATUS_PATH = '.nimrod-pull/last-pull.json';
const PULL_CHECK_MS = 60 * 60 * 1000;
/** The pull's file, read: `{ at, today, newToday, new, ok, why }` or null when it is not one. Pure. */
export function readPullStatus(j) {
  if (!j || typeof j !== 'object' || typeof j.at !== 'string' || !Number.isFinite(Date.parse(j.at))) return null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  return { at: j.at, today: typeof j.today === 'string' ? j.today : j.at.slice(0, 10), newToday: n(j.new_today),
    new: n(j.new), ok: j.ok !== false, why: typeof j.why === 'string' ? j.why.slice(0, 120) : '' };
}
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The line for the "Photos from" row. Pure; `nowMs` is the clock. */
export function pullNewsLine(news, nowMs = Date.now()) {
  if (!news) return '';
  if (!news.ok) return `The last check for new pictures did not finish${news.why ? ` (${news.why})` : ''}.`;
  if (news.today === localDay(nowMs)) {
    const k = news.newToday;
    return k ? `${k} new picture${k === 1 ? '' : 's'} today` : 'Checked for new pictures today: none';
  }
  const days = Math.max(1, Math.round((nowMs - Date.parse(news.at)) / 86400000));
  return `Last checked for new pictures ${days === 1 ? 'yesterday' : `${days} days ago`}`;
}
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
// `album` IS A LIVE CHOICE SINCE 2026-10-10 (media_sources.js "CHOOSING THE ALBUM"): "The whole
// source", then the source's own folders, from listings this panel already makes. It was TEXT,
// read-only, saying "set in Media / Sources" - and Media / Sources never had an album chooser, so
// only a dev address could set one. A choice offers only folders the source has (so it cannot
// break the panel, the reason it was read-only), a long list opens as a list, and a switch steps
// it like any choice. LEVEL 'standard', where the row always was: it decides what the panel shows,
// as "Photos from" does. AGAINST: once the source has folders it is one more stop on a switch
// user's lap of this menu (kiosk_test's 14 counts it only then); 'advanced' would keep the lap and
// hide the one place the album can be chosen from everybody who has not changed the level.
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
  albumField({ level: 'standard' }),   // choosing the album: live options from `settingsChoices`
  // every folder inside (2026-10-10, row 2.78): the source's (or the album's) folders too - ON, Mike's Pictures folder
  // of 57 dated folders being the case. Which folders are left out are this panel's own rows (`menuItems`, at every
  // level: the everyday control). LEVEL 'advanced', argued as `resumeAfterMs` is: a switch user walks every 'standard'
  // row of this panel's menu, and kiosk_test holds that lap to 14 stops on purpose; ON is what nearly everybody wants, so
  // the row exists for turning it off, which is rare. AGAINST: at 'standard' (and in edit mode) the switch is not seen;
  // the "Folders inside" row is, and leaving out every folder is the same as off.
  subfoldersField({ on: true, what: 'pictures', level: 'advanced' }),
  // backup source (2026-10-08, media_sources.js argues the rows and defaults): "If this can't be reached, use". Its own
  // default is the stand-in this panel has had since §3e (any other source this screen may show), so nothing changes
  // until somebody chooses; the screen's "Backup folder for this screen" applies unless this row is set.
  backupPanelField({ panelDefault: BACKUP_ANY }),
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
  // hide picture (2026-10-09). WHO A HIDE IS FOR: everybody by default (Mike: "Let's make the default for everyone"),
  // one person as the option. Level 'advanced', for `resumeAfterMs`'s reason: a switch user walks every 'standard' row.
  { key: 'hideFor', label: 'Hiding a picture hides it', kind: 'choice', default: DEFAULT_HIDE_SCOPE, level: 'advanced',
    options: [
      { value: 'everyone', label: 'for everybody, on every screen that shows these pictures here' },
      { value: 'person', label: 'only on this person’s screens' },
    ] },
  // WHETHER "HIDDEN" IS SAID ALOUD as well as shown. Default: when it was asked for aloud (whoever spoke is listening
  // for an answer; whoever pressed is looking). 'always' for somebody who cannot read the screen, 'never' for a room
  // where the screen must stay quiet.
  { key: 'hideSay', label: 'When a picture is hidden or brought back', kind: 'choice', default: 'voice', level: 'advanced',
    options: [
      { value: 'voice', label: 'show it, and say it when it was asked for aloud' },
      { value: 'always', label: 'show it and always say it' },
      { value: 'never', label: 'only show it' },
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
  return { text: `Could not reach the source “${source.label}”`, retry: true, action: null };
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
    description: 'Their own photos, on a loop. Reads them straight from your own computer.',
    importance: 'critical', dependsOn: 'local', settings: SETTINGS,
    // A new photos panel starts at the interval of one already on the same screen (Mike,
    // 2026-09-29: "keep it per panel, copy from existing"). Only the interval, and only once,
    // at creation - see module.js `seedFromSibling`.
    // every folder inside: the two folder settings too (the leave-out list is kept per source, so a new panel on
    // another source simply finds nothing of its own in it).
    copyFromSibling: ['intervalMs', SUBFOLDERS_KEY, LEAVE_OUT_KEY] },
  (ctx) => {
    const { mount, bus, state, user } = ctx;
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
    // every folder inside (row 2.78): every listing this panel makes - its source, a stand-in, a backup, the recheck,
    // "Try on this computer" - carries the panel's two folder settings for that source (`listOptions`).
    const resolveList = withListOptions(ctx.resolveListing || resolveListing, (s) => listOptions(cfg, s && s.id));
    let lastListing = null;         // { sourceId, album, listing } from the chosen source: the "Leave out" rows
    let foldersOpen = false;        // whether the menu's folder rows are showing (not saved)
    // desktop prompt (2026-10-10, media_sources.js quietReach): every automatic listing - this panel's source, the
    // stand-ins and backups, the recheck - goes through `quietList`, which never asks a source on another computer (an
    // account-wide localhost seen from a desktop), so Chrome's local-network box cannot come up by itself. Only the
    // "Try on this computer" press (`tryAction`) fetches one on purpose. `ctx.checkFromHere` is the suites' seam.
    const reachCheck = ctx.checkFromHere || null;
    const quietList = quietResolve(resolveList, { check: reachCheck });
    // choosing the album: the "Album" row's folders, from this panel's listings of its chosen source (and, while an
    // album is chosen, one quiet listing of the source's top).
    const albumChooser = createAlbumChooser({ listTop: topFoldersLister({ resolve: ctx.resolveListing || null, check: reachCheck }) });

    // hide picture: the page's one log of hidden pictures (`ctx.hiddenPictures` in the suites), copied to the person's
    // Nimrod folder through the screen's history host when it has one. `allItems` is the listing as it came; `items`
    // is what the slideshow may show (the listing less what is hidden for whoever this screen is for).
    const hides = ctx.hiddenPictures || deviceHiddenPictures({ history: ctx.history || null });
    // remove this picture (2026-10-10): the page's one removal list (`ctx.removedPictures` in the suites). A removed
    // picture leaves every slideshow, as a hidden one does; the sources set to "remove it here too" also move it.
    const removals = ctx.removedPictures || deviceRemovedPictures({ history: ctx.history || null });
    const removedNow = () => { try { return removals.paths(''); } catch { return new Set(); } };
    // The moves, through media_sources.js (`ctx.removeOnSource` / `ctx.restoreOnSource` are the suites' seams).
    const moveOn = ctx.removeOnSource || ((s, p) => removeOnSource(s, p, { check: ctx.checkFromHere || null }));
    const moveBack = ctx.restoreOnSource || ((s, p) => restoreOnSource(s, p, { check: ctx.checkFromHere || null }));
    const followed = new Set();     // the follow-up: `${kind}|${source}|${path}` asked already on this page
    const viewer = () => personOf(ctx) || '';
    const hiddenNow = () => {
      let out;
      try { out = hides.paths(viewer()); } catch { out = new Set(); }
      for (const p of removedNow()) out.add(p);       // remove this picture: removed is left out too
      return out;
    };
    let allItems = [];
    let offHides = null, offRemovals = null;
    let noticeTimer = null, menuTimer = null, pressTimer = null, longPressed = false;
    const me = { tag: null, touchedAt: 0, visible: true, order: (slideshowOrder += 1) };
    const touch = () => { me.touchedAt = Date.now(); };
    // pulled pictures: what the pull last wrote, and the timer that reads it again.
    let pullNews = null, pullFrom = null, pullTimer = null;
    const fetchImpl = ctx.fetchImpl || ((...a) => fetch(...a));

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {}, channels = {};
    let stats = {};                 // derived from this panel's plays on this device
    // Where the plays go (row 2.58): this device, never the server. The panel's old server rows come down once.
    const playLog = panelPlays(ctx, 'photos');
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

    // *** PHOTOS IN STEP (2026-10-12; play_sync.js argues it): SAY WHAT IS ON SCREEN, ON THIS SCREEN'S OWN BUS. *** On
    // each new picture, Pause and Play, a clip starting, and when the panel is hidden, emptied or closed. The panel
    // never touches a socket: the screen's sender decides whether anything leaves the room (only with "Let people
    // follow" on, somebody following, and only as an opaque id - the path below is hashed there and never sent).
    // `key` is the picture's path inside its source's folder (hidden_pictures.js pictureKey), which is what lets a
    // follow page find its own copy of the same picture.
    // *** A HIDDEN OR REMOVED PICTURE IS NEVER SAID. *** The slideshow never shows one (`setVisible`), and this checks
    // again on the way out, so even a picture hidden in the same moment it came up is reported as nothing.
    // A HIDDEN PANEL (another dashboard on screen) says nothing, the way a destroyed one does: a follower is never left
    // on a picture nobody in the room can see.
    let saidKey = null;
    function sayPhoto() {
      const item = currentId && byId[currentId] ? byId[currentId] : null;
      let key = item ? pictureKey(item) : '';
      if (key && hiddenNow().has(key)) key = '';
      if (!me.visible) key = '';
      if (!key && saidKey === null) return;
      saidKey = key || null;
      let pos = 0;
      if (key && item.kind === 'video' && currentVideo) { const t = Number(currentVideo.currentTime); pos = Number.isFinite(t) ? t : 0; }
      else if (key) pos = Math.max(0, (now() - lastShownAt) / 1000);
      try {
        bus.publish(PLAY_NOW_TOPIC, { kind: 'photo', panel: ctx.instanceId || ownTag, key: key || null, pos, playing: !!key && !holding() });
      } catch { /* not load-bearing */ }
    }
    // 'slideshow': a screen picking up a new version waits for the next photo, not for this to stop (version_watch.js).
    const reportPlay = createPlayReporter(bus, ctx, { kind: 'slideshow' });

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
    let lastBackupRef = null;       // backup source: the panel's row, as last seen
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
    // backup source: this panel's row, else the screen's (`ctx.screenBackup`, kiosk.js), else the stand-in it always had.
    const screenBackup = () => { try { return String(ctx.screenBackup?.() || ''); } catch { return ''; } };
    const backupNow = () => backupChoice({ panel: cfg[BACKUP_KEY], screen: screenBackup(), panelDefault: BACKUP_ANY });

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
          + (showRetry ? ` <button data-retry>Try again</button>` : '');
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
      onGiveUp: () => { if (countFailure()) return; bus.publish('photos/next', undefined, OWN); },
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
      advanceTimer = setTimer(() => { advanceTimer = null; if (stalled()) return; bus.publish('photos/next', undefined, OWN); }, ms);
    }

    // ---- a source that dies MID-SLIDESHOW (2026-10-02, the coordinator's follow-up to §3e) -------
    // The listing in hand still names files, and every one of them fails: before this, the panel
    // cycled broken images (or blank frames) for as long as nobody came by. Now:
    //   * WHILE A PICTURE LOADS OR FAILS, THE LAST ONE THAT APPEARED STAYS UP over the gap (`render`),
    //     so a broken picture is never what is on screen -- it is skipped, quietly, after one flash
    //     period (failedItem).
    //   * DOWN_AFTER_FAILURES (3) in a row -- pictures or clips erroring, or a picture still not there
    //     when its turn is over and nothing has appeared for LISTING_WAIT_MS -- means the source is
    //     down: it is set aside (`loadFailed`) and the panel lists again without it, which is exactly
    //     what a source failing at load does: a stand-in, the last pictures kept, or the words.
    //   * The 60 s recheck takes the chosen source back only when one of its pictures REALLY loads.
    let loadFails = 0;
    const loadFailed = new Set();   // sources whose files stopped loading; cleared by any ordinary reload
    let shownSourceId = null;       // the source the pictures on screen came from (null: the last pictures)
    let currentEl = null;           // the element for `currentId`
    let lastGoodAt = Date.now();    // when a picture last really appeared
    const downAfter = () => Number(ctx.downAfterFailures ?? DOWN_AFTER_FAILURES);

    /** One more failure in a row. True when that makes the source down (and the panel has acted on it). */
    function countFailure() {
      loadFails += 1;
      const n = downAfter();
      if (!(n > 0) || loadFails < n) return false;
      sourceDown();
      return true;
    }
    function sourceDown() {
      loadFails = 0;
      clearAdvance();
      if (shownSourceId) loadFailed.add(shownSourceId);
      reload({ keepFailed: true });
    }
    // The picture whose turn just ended never arrived. Only counted once nothing at all has appeared for
    // LISTING_WAIT_MS -- a slow picture over facility wifi is slow, not broken -- and then it is the
    // same verdict as three errors: the source is not serving. (No timer of its own: the slideshow's
    // own turn is the clock, so the held picture stays up meanwhile.)
    function stalled() {
      const el = currentEl;
      if (!el || el.tagName !== 'IMG' || el.dataset.load !== 'loading') return false;
      const wait = listingWaitMs();
      if (!(wait > 0) || Date.now() - lastGoodAt < wait) return false;
      if (keptMode) { keptFailed(currentId); return true; }
      if (!(downAfter() > 0)) return false;
      sourceDown();
      return true;
    }
    function pictureAppeared(el, item) {
      if (el !== currentEl) return;
      el.dataset.load = 'good';
      loadFails = 0; failStreak = 0;
      lastGoodAt = Date.now();
      dropHeld();
      rememberSeen(item);
    }
    function pictureFailed(el, item) {
      if (el !== currentEl) return;
      el.dataset.load = 'bad';
      if (keptMode) { keptFailed(item.id); return; }
      if (countFailure()) return;
      failedItem();
    }
    function dropHeld() { stage()?.querySelectorAll('[data-held]').forEach((n) => n.remove()); }
    // The last picture that really appeared, to hold over the gap while the next one loads.
    function goodPicture(st) {
      return [...st.children].find((c) => c.tagName === 'IMG' && c.dataset.load === 'good') || null;
    }
    // Nothing more to show: keep a good picture that is up (frozen beats blank), drop anything else.
    function keepOnlyGood() {
      const st = stage();
      if (!st) return;
      clearAdvance();
      const good = goodPicture(st);
      st.innerHTML = '';
      if (good) {
        delete good.dataset.held; good.style.position = ''; good.style.inset = '';
        st.append(good);
        currentEl = good;
      } else {
        st.dataset.showing = '';
        currentEl = null; currentId = null;
      }
      sayPhoto();   // photos in step
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
      // (A photo ends a failure run when it LOADS -- `pictureAppeared` -- not when it is asked for.)
      const st = stage();
      if (!st) return;
      // THE LAST GOOD PICTURE STAYS UP WHILE THE NEXT ONE LOADS (see `stalled`): it is put back as the
      // LATER child, laid over the stage, until a new picture appears (`dropHeld`). A picture that fails
      // is therefore never what is on screen. The new element is still the stage's first child.
      const held = item.kind === 'video' ? null : goodPicture(st);
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
          if (now() - shownAt >= failureFloorMs(flashLimit(ctx))) { failStreak = 0; loadFails = 0; bus.publish('photos/next', undefined, OWN); }
          else if (!countFailure()) failedItem();
        };
        // An explicit failure moves on after one flash period; a RUN of them backs off
        // (flash_limit.js failureBackoffMs), so a folder of broken clips cannot spin -- and
        // DOWN_AFTER_FAILURES of them in a row is a source that has stopped serving (`countFailure`).
        const onError = () => { videoStall.disarm(); if (!countFailure()) failedItem(); };
        const onBeat = () => videoStall.beat();
        const onPlaying = () => { videoStall.beat(); loadFails = 0; lastGoodAt = Date.now(); if (el === currentVideo) sayPhoto(); };
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        el.addEventListener('timeupdate', onBeat);
        el.addEventListener('playing', onPlaying);
        videoEndOff = () => {
          el.removeEventListener('ended', onEnded);
          el.removeEventListener('error', onError);
          el.removeEventListener('timeupdate', onBeat);
          el.removeEventListener('playing', onPlaying);
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
        // A picture that really appeared ends a failure run and is one the panel can fall back on
        // (KEEP_LAST); one that fails is skipped quietly, and DOWN_AFTER_FAILURES in a row take the
        // source down (`pictureFailed`).
        el.dataset.load = 'loading';
        const pic = el;
        el.addEventListener('load', () => pictureAppeared(pic, item), { once: true });
        el.addEventListener('error', () => pictureFailed(pic, item), { once: true });
      }
      el.style.objectFit = cfg.fit;
      el.className = 'shot';
      // Row 2.49: this device's colour grade (lut.js), OFF by default. With none chosen it does not
      // touch the element at all, so a photo shows exactly as it always has.
      applyGrade(el, item.kind === 'video' ? 'video' : 'photos');
      currentEl = el;
      st.append(el);
      if (held && held !== el) {
        held.dataset.held = '1';
        held.style.position = 'absolute'; held.style.inset = '0';
        st.append(held);
      }
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
      sayPhoto();   // photos in step
      if (record) {
        recent.push(id);
        if (recent.length > RECENT_CAP) recent.shift();
        // truncate any forward history (we branched) and append
        history = history.slice(0, histPos + 1);
        history.push(id); histPos = history.length - 1;
        // the play record (this device); picker stats derive from these. A picture shown while the
        // slideshow WAITS for Start is logged when it starts (`carryOn`), not before: it has not played.
        if (!waiting) logPlay(id);
      }
    }
    function logPlay(id) {
      playLog.played(id);
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
      sayPhoto();   // photos in step: paused or playing again
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
        // desktop prompt: the only source, on another computer (a Pi's localhost seen from a desktop), is neither
        // adopted nor saved from here - the panel says so, with the press that tries it (`elsewhere`).
        if (!(await quietReach(sources[0], { check: reachCheck })).quiet) return { source: null, chosenId: null, sources, elsewhere: sources[0] };
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
    // folder's object URL (`blob:`), which dies with the page. folder art (2026-10-07): nor a big `data:` URL - a folder's
    // SVG is a whole drawing in one (folder_source.js), and fifty of them would fill this device's small cache.
    function rememberSeen(item) {
      if (keptMode || !item || item.kind !== 'image' || !item.url || !keepableUrl(item.url)) return;
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
        if (!it || !it.id || !it.url || !keepableUrl(it.url) || ids.has(it.id)) continue;
        const src = rows.find((s) => s && s.id === it.sourceId);
        if (src && !mayShowSource(src, pid)) continue;
        ids.add(it.id);
        out.push({ id: it.id, url: it.url, name: it.name || '', path: it.path || it.id, kind: 'image', sourceId: it.sourceId });
        if (out.length >= KEEP_LAST) break;
      }
      return out;
    }
    function useItems(list) {
      allItems = list;
      setVisible();
      recent = []; history = []; histPos = -1;
    }
    // hide picture: what may be shown is the listing less what is hidden here.
    function setVisible() {
      const hidden = hiddenNow();
      items = hidden.size ? allItems.filter((it) => !hidden.has(pictureKey(it))) : allItems;
      byId = Object.fromEntries(items.map((it) => [it.id, it]));
      ids = items.map((it) => it.id);
      channels = Object.fromEntries(items.map((it) => [it.id, albumOf(it.path)]));
    }
    // hide picture: the log changed (a hide or a bring-back here, on another panel, or merged from the Nimrod folder).
    // The picture on screen moves on if it is now hidden; a panel with every picture hidden says so, and starts again
    // when one comes back.
    function refilter() {
      const was = items;
      setVisible();
      if (items.length === was.length && items.every((it, i) => it === was[i])) return;
      history = history.filter((id) => byId[id]); histPos = history.length - 1;
      recent = recent.filter((id) => byId[id]);
      if (currentId && !byId[currentId]) {
        if (ids.length) { advance(); return; }
        clearStage();
        setStatus(HIDE_LINES.allHidden);
        return;
      }
      if (!currentId && !was.length && ids.length && allItems.length) { setStatus(null); advance(); }
      sayPhoto();   // photos in step: a picture hidden or removed elsewhere is never left reported
    }
    // Nothing on the stage at all (every picture here is hidden): not even the last good one, which may be the hidden one.
    function clearStage() {
      clearAdvance();
      const st = stage();
      if (st) { st.innerHTML = ''; st.dataset.showing = ''; }
      currentEl = null; currentId = null;
      sayPhoto();   // photos in step: nothing to follow now
    }
    function setLabel(text) {
      const el = mount.querySelector('[data-source-label]');
      if (el) el.textContent = text;
    }
    // every folder inside: "Leave out" rows for the chosen source, from its last listing (media_sources.js leaveOutRows).
    function folderRows() {
      const ll = lastListing;
      if (!ll || ll.sourceId !== cfg.sourceId) return [];
      return leaveOutRows({ idPrefix: 'photos-leave', listing: ll.listing, album: cfg.album, sourceId: ll.sourceId, cfg,
        open: foldersOpen, onOpen: (v) => { foldersOpen = !!v; }, onSet: (map) => { touch(); state.set({ [LEAVE_OUT_KEY]: map }); },
        what: 'pictures' });
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
      const text = escapeHtml(degradedLine({ shownLabel: keptMode ? null : d.shownLabel, chosenLabel: d.chosenLabel, err: d.err,
        backup: !keptMode && !!d.backup }));   // backup source: "Showing the backup: ..." for a chosen one
      const perm = d.err && d.err.code === 'permission' && d.chosenSource;
      const away = d.err && d.err.code === 'elsewhere' && d.chosenSource;   // desktop prompt: the press, not Retry
      setStatus(text, keptMode && !perm && !away, perm ? allowAction(d.chosenSource) : away ? tryAction(d.chosenSource) : null);
    }
    // desktop prompt (2026-10-10): "Try on this computer" - the one fetch of a source on another computer made on
    // purpose (Chrome may ask now; that is the person's to answer). An answer is remembered and the panel lists again.
    function tryAction(source) {
      return {
        label: TRY_HERE_LABEL,
        run: async () => {
          setStatus('Trying…');
          const r = await tryFromHere(source, { resolve: resolveList, album: cfg.album });
          if (r.ok) { reload(); return; }
          setStatus('It didn’t answer on this computer.', false, tryAction(source));
        },
      };
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
          const r = await listingWithin(quietList, chosen, cfg.album,   // desktop prompt: never asks by itself
            { accept: (l) => slideshowItems(l && l.items), waitMs: recheckMs(), setTimer, clearTimer });
          back = r.ok;
          // A source whose FILES stopped loading is back only when one of them loads: its listing
          // answering is what it was doing all along.
          if (back && loadFailed.has(chosen.id)) {
            const one = r.items.find((it) => it.kind === 'image') || r.items[0];
            back = !!one && await (ctx.mediaLoads || mediaLoads)(one, { waitMs: recheckMs(), setTimer, clearTimer });
          }
        }
      } catch { back = false; }
      if (seq !== loadSeq || !degraded || degraded.chosenId !== want) return;   // something else moved on
      if (back) reload(); else armRecheck();
    }
    function applyListing(source, listing, album, fb = null) {
      keptMode = false;
      shownSourceId = source.id;
      loadFails = 0;
      lastGoodAt = Date.now();
      useItems(slideshowItems(listing.items)   // songs in the same folder are not photos
        .map((it) => (it.sourceId ? it : { ...it, sourceId: source.id })));
      // every folder inside: the chosen source's folders, for the "Leave out" rows (a stand-in's are not this panel's).
      if (!fb) { lastListing = { sourceId: source.id, album, listing }; albumChooser.heard(source, album, listing); }   // + the album row
      setLabel(`${source.label}${album ? ' · ' + album : ''} — ${items.length} item${items.length === 1 ? '' : 's'}${truncatedWords(listing)}`);
      degraded = fb ? { ...fb, shownLabel: source.label || source.base_url || source.id } : null;
      if (degraded) armRecheck(); else clearRecheck();
      checkPull(source, album);   // pulled pictures: "3 new pictures today", and a new listing after a pull
      followUp(source, listing);  // remove this picture: a removed picture still in a "remove it here too" source
      // hide picture: a folder whose every picture is hidden says that, not "no photos".
      if (!items.length && allItems.length) { clearStage(); setStatus(HIDE_LINES.allHidden); return; }
      if (!items.length) { setStatus('No photos in this source or album.'); return; }
      setStatus(null);
      advance();
      sayDegraded();   // after the first picture, so it is a chip over it rather than a sheet
    }
    function showKept(sources) {
      const hidden = hiddenNow();   // hide picture: a hidden picture is not fallen back on either
      const kept = keptPictures(sources).filter((it) => !hidden.has(pictureKey(it)));
      if (!kept.length) return false;
      keptMode = true;
      shownSourceId = null;
      loadFails = 0;
      lastGoodAt = Date.now();
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
      allItems = allItems.filter((it) => it.id !== id);   // hide picture: the listing as it came, too
      delete byId[id];
      ids = ids.filter((x) => x !== id);
      seen = seen.filter((s) => s.id !== id);
      seenDirty = true;
      if (!ids.length) {
        keptMode = false;
        keepOnlyGood();
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
      // desktop prompt: the chosen source is on another computer - never fetched by itself; the quiet line and the press.
      if (err && err.code === 'elsewhere') { setStatus(ELSEWHERE_LINE, false, tryAction(source)); return; }
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
          const { isFolderPickerSupported } = await import('../folder_source.js');
          const canPick = typeof ctx.canPickFolder === 'function' ? ctx.canPickFolder : isFolderPickerSupported;
          // photo sources first (2026-10-09): a browser with no folder picker (Firefox, Safari, a phone) is offered
          // pictures from this device instead of no button at all - the file input opens from this press.
          if (!canPick()) {
            setStatus('No photo source connected.', false, {
              label: 'Add pictures from this device',
              run: () => pickDevicePictures(),
            });
            items = ids = []; byId = channels = {};
            return;
          }
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

    // photo sources first (2026-10-09): pictures chosen here are kept in this browser (device_pictures.js) and the
    // device's pictures become a photo source on this device, then the panel lists again. SYNCHRONOUS up to the
    // click: the file input only opens inside the press.
    function pickDevicePictures() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', async () => {
        try {
          const { added } = await addDevicePictures(input.files);
          if (!added.length) { setStatus('Those weren’t pictures. No photo source connected.', false,
            { label: 'Add pictures from this device', run: () => pickDevicePictures() }); return; }
          setDevicePhotosOn(true);
          reload();
        } catch (err) {
          console.error('photos: could not keep those pictures', err);
          setStatus('Those pictures couldn’t be kept in this browser.', true);
        }
      });
      input.click();
    }

    // ---- hide picture (2026-10-09) ---------------------------------------------------------------
    // Shown at once in a corner of its own (it never covers the status line about the source), said aloud per `hideSay`.
    function notice(text, voice = false) {
      const el = mount.querySelector('[data-notice]');
      if (el) { el.textContent = text; el.hidden = false; }
      if (noticeTimer != null) clearTimer(noticeTimer);
      noticeTimer = setTimer(() => { noticeTimer = null; const n = mount.querySelector('[data-notice]'); if (n) n.hidden = true; }, NOTICE_MS);
      const say = cfg.hideSay === 'always' || (cfg.hideSay !== 'never' && voice);
      if (say && ctx.output && typeof ctx.output.say === 'function') {
        try { ctx.output.say(text, { source: 'photos' }); } catch (e) { console.error('photos: say', e); }
      }
    }
    /** Hide the picture on screen. Resolves the row kept, or null (nothing on screen). */
    function hideCurrent({ voice = false } = {}) {
      touch();
      closePhotoMenu();
      const item = currentId && byId[currentId] ? byId[currentId] : null;
      const path = item ? pictureKey(item) : '';
      if (!path) { notice(HIDE_LINES.nothingOn, voice); return Promise.resolve(null); }
      const scope = HIDE_SCOPES.includes(cfg.hideFor) ? cfg.hideFor : DEFAULT_HIDE_SCOPE;
      // In force at once (the log tells every slideshow on the page, this one included, before this returns), so the
      // next picture is already up when the words appear.
      const row = hides.hide({ path, name: item.name || '', scope, person: viewer(), screen: ctx.profileId || '',
        panel: ctx.instanceId || '' });
      notice(voice ? HIDE_LINES.hiddenVoice : HIDE_LINES.hidden, voice);
      return row;
    }
    /** "Bring it back": the newest picture still hidden OR REMOVED here comes back (whichever came last), and onto the
     *  screen when it is in this panel's pictures. Said again, the one before it. */
    function unhideLast({ voice = false } = {}) {
      touch();
      closePhotoMenu();
      let e = null, r = null;
      try { e = hides.entries(viewer())[0] || null; } catch { e = null; }
      try { r = removals.entries('')[0] || null; } catch { r = null; }   // remove this picture
      if (r && (!e || (r.t || 0) >= (e.t || 0))) return restoreRemoved(r, { voice });
      if (!e) { notice(HIDE_LINES.nothingHidden, voice); return Promise.resolve(null); }
      const row = hides.unhide(e);
      const back = items.find((it) => pictureKey(it) === e.path);
      if (back) show(back.id, true);
      notice(HIDE_LINES.back, voice);
      return row;
    }

    // ---- remove this picture (2026-10-10; removed_pictures.js has the list, media_sources.js the per-source choice) ----
    // The sources a removal is moved on: every source this panel knows that is set to "remove it here too" and that this
    // screen may show (never another person's). A source not set so is never asked (ON_REMOVE 'keep', the default).
    const removeSources = () => knownSources.filter((s) => s && onRemoveOf(s) === ON_REMOVE_MOVE && mayShowSource(s, personOf(ctx)));
    /** Remove the picture on screen: off every slideshow at once (the list), then moved on each source set to "remove it
     *  here too". Resolves `{ row, moved: [{ id, done }] }`, or null (nothing on screen). Never deletes anything. */
    function removeCurrent({ voice = false } = {}) {
      touch();
      closePhotoMenu();
      const item = currentId && byId[currentId] ? byId[currentId] : null;
      const path = item ? pictureKey(item) : '';
      if (!path) { notice(HIDE_LINES.nothingOnRemove, voice); return Promise.resolve(null); }
      // In force at once (the list tells every slideshow on the page), so the next picture is up before the words.
      const row = removals.remove({ path, name: item.name || '', screen: ctx.profileId || '', panel: ctx.instanceId || '' });
      notice(voice ? HIDE_LINES.removedVoice : HIDE_LINES.removed, voice);
      const moved = Promise.all(removeSources().map(async (s) => {
        followed.add(`remove|${s.id}|${path}`);
        const res = await moveOn(s, path).catch(() => ({ done: 'failed' }));
        // Not done now (the agent away, on another computer, a folder with no permission): the follow-up tries again.
        if (!res || !['moved', 'not-here'].includes(res.done)) followed.delete(`remove|${s.id}|${path}`);
        return { id: s.id, done: (res && res.done) || 'failed' };
      }));
      return Promise.all([row, moved]).then(([r, m]) => ({ row: r, moved: m }));
    }
    /** "Bring it back" for a removal: off the list, then moved back on each source set to "remove it here too". */
    function restoreRemoved(entry, { voice = false } = {}) {
      const row = removals.restore(entry);
      notice(HIDE_LINES.back, voice);
      const path = entry.path;
      return Promise.all(removeSources().map(async (s) => {
        followed.add(`restore|${s.id}|${path}`);
        const res = await moveBack(s, path).catch(() => ({ done: 'failed' }));
        if (!res || !['back', 'already', 'emptied', 'not-removed'].includes(res.done)) followed.delete(`restore|${s.id}|${path}`);
        return { id: s.id, done: (res && res.done) || 'failed' };
      })).then((moved) => {
        // On screen when it is in this panel's pictures; a source that had moved it lists again first, so its file is back.
        if (moved.some((m) => m.done === 'back')) { reload(); return { row, moved }; }
        const back = items.find((it) => pictureKey(it) === path);
        if (back) show(back.id, true);
        return Promise.resolve(row).then((r) => ({ row: r, moved }));
      });
    }
    /** THE FOLLOW-UP (removed_pictures.js): a listing of a source set to "remove it here too" moves what is on the
     *  removal list and still here, and brings back what was brought back and is not here. Bounded; never throws. */
    function followUp(source, listing) {
      if (!source || onRemoveOf(source) !== ON_REMOVE_MOVE || !mayShowSource(source, personOf(ctx))) return Promise.resolve(null);
      let restored = new Set();
      try { restored = new Set(removals.restored().map((e) => e.path)); } catch { restored = new Set(); }
      const plan = followUpPlan({ sourceId: source.id, items: (listing && listing.items) || [], removed: removedNow(),
        restored, done: followed });
      if (!plan.remove.length && !plan.restore.length) return Promise.resolve(plan);
      const jobs = [
        ...plan.remove.map((p) => { followed.add(`remove|${source.id}|${p}`); return moveOn(source, p).catch(() => null); }),
        ...plan.restore.map((p) => { followed.add(`restore|${source.id}|${p}`); return moveBack(source, p).catch(() => null); }),
      ];
      return Promise.all(jobs).then((res) => {
        if (plan.restore.length && res.slice(plan.remove.length).some((x) => x && x.done === 'back')) reload();
        return plan;
      });
    }
    function unhideAll() {
      touch();
      let list = [];
      try { list = hides.entries(viewer()); } catch { list = []; }
      return Promise.all(list.map((e) => hides.unhide(e)));
    }
    // The two buttons a long press (or a right click) on the picture opens. They close by themselves.
    function openPhotoMenu() {
      const m = mount.querySelector('[data-photo-menu]');
      if (!m) return;
      touch();
      let any = false;
      try { any = hides.entries(viewer()).length > 0 || removals.entries('').length > 0; } catch { any = false; }
      const hideBtn = m.querySelector('[data-photo-hide]');
      const backBtn = m.querySelector('[data-photo-unhide]');
      const removeBtn = m.querySelector('[data-photo-remove]');   // remove this picture
      if (hideBtn) hideBtn.disabled = !(currentId && byId[currentId]);
      if (removeBtn) removeBtn.disabled = !(currentId && byId[currentId]);
      if (backBtn) backBtn.disabled = !any;
      m.hidden = false;
      if (menuTimer != null) clearTimer(menuTimer);
      menuTimer = setTimer(() => { menuTimer = null; closePhotoMenu(); }, PHOTO_MENU_MS);
    }
    function closePhotoMenu() {
      const m = mount.querySelector('[data-photo-menu]');
      if (m) m.hidden = true;
      if (menuTimer != null) { clearTimer(menuTimer); menuTimer = null; }
    }
    const clearPress = () => { if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; } };

    // ---- pulled pictures: the pull's last-pull.json (see PULL_STATUS_PATH) ---------------------------
    // Only a media agent's folder (a browser folder or this device's pictures has no pull). The album's own file first,
    // then the source's top. Never throws; a missing file is simply no line.
    async function readPull(source, album) {
      if (!source || source.kind === 'folder' || !/^https?:\/\//i.test(String(source.base_url || ''))) return null;
      const rels = [album ? `${album}/${PULL_STATUS_PATH}` : null, PULL_STATUS_PATH].filter(Boolean);
      for (const rel of rels) {
        try {
          const res = await fetchImpl(mediaUrl(source.base_url, rel), { cache: 'no-store' });
          if (!res || !res.ok) continue;
          const got = readPullStatus(await res.json());
          if (got) return got;
        } catch { /* not there, or not reachable: no line */ }
      }
      return null;
    }
    function checkPull(source, album) {
      const from = source ? `${source.id}|${album || ''}` : null;
      if (from !== pullFrom) { pullFrom = from; pullNews = null; }
      // The page's own clock, not `ctx.setTimer`: that seam is the slideshow's timing, which the suites drive by hand.
      if (pullTimer != null) { clearTimeout(pullTimer); pullTimer = null; }
      if (!source) return Promise.resolve(null);
      const seq = loadSeq;
      return readPull(source, album).then((news) => {
        if (seq !== loadSeq || pullFrom !== from) return;
        const before = pullNews;
        pullNews = news;
        // A pull since the last look that brought pictures: list again, so they join the slideshow.
        if (before && news && news.at !== before.at && news.new > 0) { reload(); return; }
        pullTimer = setTimeout(() => { pullTimer = null; if (pullFrom === from) checkPull(source, album); }, PULL_CHECK_MS);
      });
    }

    // `keepFailed`: a reload BECAUSE a source's files stopped loading keeps it set aside. Any other
    // reload -- a Retry, a changed source or album, a person arriving, the recheck -- tries everything.
    async function reload({ keepFailed = false } = {}) {
      const seq = ++loadSeq;
      if (!keepFailed) loadFailed.clear();
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
        setStatus('Could not reach the site', true);
        return;
      }
      if (seq !== loadSeq) return;   // a newer reload superseded us
      // hide picture: the hidden list is read before the first picture, so a hidden one never flashes up. Bounded
      // (1.5 s, the real clock: a store that never answers must not hold the pictures back), then it goes on.
      await new Promise((resolve) => { Promise.resolve(hides.ready).then(resolve, resolve); setTimeout(resolve, 1500); });
      if (seq !== loadSeq) return;
      const { source, chosenId, sources } = found;
      if (!source && !chosenId && found.elsewhere) {   // desktop prompt: the only source is on another computer
        degraded = null; keptMode = false;
        if (stage()) stage().dataset.showing = '';
        items = ids = []; byId = channels = {};
        setStatus(ELSEWHERE_LINE, false, tryAction(found.elsewhere));
        return;
      }
      if (!source && !chosenId) { degraded = null; keptMode = false; await showNoSource(); return; }
      // The chosen source -- or, when it cannot be listed, the best stand-in (§3e, media_sources.js).
      const got = await listOrFallback({
        sources, chosen: source, chosenId, album: cfg.album, personId: personOf(ctx),
        resolve: quietList, accept: (l) => slideshowItems(l && l.items),   // desktop prompt: never asks by itself
        waitMs: listingWaitMs(), setTimer, clearTimer, skip: loadFailed,
        backup: backupNow(),   // backup source
      });
      if (seq !== loadSeq) return;
      const cid = (source && source.id) || chosenId;
      const chosenRef = { chosenId: cid, chosenLabel: (source && source.label) || labels[cid] || null,
        err: got.failure, chosenSource: source, backup: !!got.byChoice };
      // choosing the album: an album the chosen source does not have - the row lists its folders to choose from.
      if (source && got.failure && got.failure.code === 'album') albumChooser.heard(source, cfg.album, null);
      if (got.source) { applyListing(got.source, got.listing, got.album, got.fellBack ? chosenRef : null); return; }
      // NOTHING FROM ANY SOURCE. Keep asking after the chosen one, show the last pictures if there are
      // any, and otherwise say what is wrong -- over the picture already there, which is left up.
      lastFailure = { source, err: got.failure, sources };
      degraded = chosenRef;
      armRecheck();
      if (showKept(sources)) return;
      keptMode = false;
      shownSourceId = null;
      useItems([]);     // the failed source's files are not offered again by a "next"
      keepOnlyGood();   // a picture that failed or never arrived does not stay up under the words
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
            <div class="status chip photos-notice" data-notice role="status" hidden></div>
            <div class="photo-menu" data-photo-menu hidden>
              <button type="button" data-photo-hide>Hide this picture</button>
              <button type="button" data-photo-remove>Remove this picture</button>
              <button type="button" data-photo-unhide>Bring it back</button>
              <button type="button" data-photo-menu-close>Close</button>
            </div>
            <div class="nav">
              <button class="pbtn" data-prev aria-label="previous photo">‹</button>
              <span class="source-label" data-source-label></span>
              <button class="pbtn" data-next aria-label="next photo">›</button>
            </div>
            <button class="gear" data-gear aria-label="photo settings">⚙</button>
            <div class="settings" data-settings hidden>
              <label>change photo every
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
              <label>how photos fit
                <select data-opt="fit"><option value="cover">fill the space</option><option value="contain">show the whole photo</option></select>
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
        mount.querySelector('[data-stage]').addEventListener('click', () => {
          if (longPressed) { longPressed = false; return; }   // hide picture: the release of a long press is not a press
          touch();
          if (holding()) carryOn();
        });

        // hide picture: "hide this picture" / "bring it back" (screen actions; the answering slideshow is picked from
        // every one that heard it, see `claim`), the log changing, and the two buttons on a long press.
        me.tag = ownTag;
        slideshows.push(me);
        // `ctx.answersOnlyWhenShown` (2026-10-14, the Lineup's Pictures turn, director.js): a slideshow that is only
        // sometimes on screen takes no "hide / bring back / remove this picture" while it is not showing, even when it
        // is the only slideshow - the picture somebody means is not one they can see. Off for every other panel: as before.
        const mayAnswer = () => !(ctx.answersOnlyWhenShown && !me.visible);
        bus.subscribe(PHOTOS_HIDE_TOPIC, (_p, _t, meta) => { if (mayAnswer()) claim(me, () => hideCurrent({ voice: byVoice(meta) })); });
        bus.subscribe(PHOTOS_UNHIDE_TOPIC, (_p, _t, meta) => { if (mayAnswer()) claim(me, () => unhideLast({ voice: byVoice(meta) })); });
        bus.subscribe(PHOTOS_REMOVE_TOPIC, (_p, _t, meta) => { if (mayAnswer()) claim(me, () => removeCurrent({ voice: byVoice(meta) })); });   // remove this picture
        offHides = hides.subscribe(() => refilter());
        offRemovals = removals.subscribe(() => refilter());
        const stg = mount.querySelector('[data-stage]');
        let pressAt = null;
        stg.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          clearPress();
          longPressed = false;
          pressAt = { x: e.clientX, y: e.clientY };
          pressTimer = setTimeout(() => { pressTimer = null; longPressed = true; openPhotoMenu(); }, LONG_PRESS_MS);
        });
        stg.addEventListener('pointermove', (e) => {
          if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) clearPress();
        });
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) stg.addEventListener(ev, () => { clearPress(); pressAt = null; });
        stg.addEventListener('contextmenu', (e) => { e.preventDefault(); clearPress(); openPhotoMenu(); });
        const pm = mount.querySelector('[data-photo-menu]');
        pm.querySelector('[data-photo-hide]').addEventListener('click', () => { hideCurrent(); });
        pm.querySelector('[data-photo-unhide]').addEventListener('click', () => { unhideLast(); });
        pm.querySelector('[data-photo-remove]').addEventListener('click', () => { removeCurrent(); });
        pm.querySelector('[data-photo-menu-close]').addEventListener('click', () => { closePhotoMenu(); });

        // its own buttons are just another source - ONE PER PANEL. Bindings live on the
        // screen's shared bus, so a source name two panels both bind fans a single press out
        // through both bindings.
        const navName = `photos-nav:${ownTag}`;
        const nav = bus.createSource(navName);
        bus.addBinding({ source: navName, signal: 'next', topic: 'photos/next' });
        bus.addBinding({ source: navName, signal: 'prev', topic: 'photos/prev' });
        mount.querySelector('[data-next]').addEventListener('click', () => { touch(); nav.emit('next', undefined, OWN); });
        mount.querySelector('[data-prev]').addEventListener('click', () => { touch(); nav.emit('prev', undefined, OWN); });

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

        // play history (this device) -> picker stats
        playLog.subscribe((s) => { stats = s; });

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
          // every folder inside: the two folder settings are part of what is listed, so a change lists again.
          const lo = listOptions(cfg, cfg.sourceId);
          const ref = `${cfg.sourceId}|${cfg.album}|${lo.deep}|${lo.leaveOut.join('\n')}`;
          // backup source: a changed backup matters only while one is (or should be) showing; a panel showing its main
          // source is left alone rather than reloaded under somebody watching it.
          const bref = String(cfg[BACKUP_KEY] || '');
          const backupMoved = bref !== lastBackupRef;
          lastBackupRef = bref;
          if (ref !== lastSourceRef) { lastSourceRef = ref; reload(); }
          else if (backupMoved && degraded) reload();
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
      onHide() { videoStall.disarm(); writeSeen(); state.flush(); me.visible = false; closePhotoMenu(); sayPhoto(); },
      onShow() { me.visible = true; sayPhoto(); },   // hide picture: a slideshow on screen answers before one that is not
      // `loadSeq` moves on so a listing still in flight lands on nothing: without it a panel
      // destroyed mid-load (a remount, a screen swapped in place) went on to show a photo and
      // arm a timer after it was gone.
      destroy() {
        playLog.destroy();
        // photos in step: "nothing here" (item null), so a follower is never left on a picture nobody sees.
        me.visible = false; sayPhoto();
        loadSeq += 1; clearAdvance(); clearResume(); clearRecheck(); writeSeen(); degraded = null;
        scoped?.dispose(); if (holdTimer != null) { clearTimer(holdTimer); holdTimer = null; }
        // hide picture / pulled pictures
        try { offHides?.(); } catch { /* gone */ }
        try { offRemovals?.(); } catch { /* gone */ }   // remove this picture
        const at = slideshows.indexOf(me); if (at >= 0) slideshows.splice(at, 1);
        if (noticeTimer != null) { clearTimer(noticeTimer); noticeTimer = null; }
        closePhotoMenu(); clearPress();
        if (pullTimer != null) { clearTimeout(pullTimer); pullTimer = null; }
      },

      // *** HIDE PICTURE: THIS PANEL'S OWN ROWS IN THE SETTINGS MENU (kiosk.js `menuItems`, 2026-10-09). *** "Hide this
      // picture", then every picture hidden here, each with its own "Bring back" - so undoing never depends on a voice.
      // Text rows (the menu draws no pictures): the file's name, and when it was hidden.
      menuItems: () => {
        const out = [];
        const item = currentId && byId[currentId] ? byId[currentId] : null;
        out.push({ kind: 'item', id: 'photos-hide', label: 'Hide this picture',
          hint: item ? `${item.name || 'the picture on screen'}; it can be brought back from this list` : 'no picture on screen now',
          disabled: !item, run: () => { hideCurrent(); } });
        // remove this picture (2026-10-10): beside Hide. What happens on each drive is that source's own choice (Media).
        const movers = removeSources();
        out.push({ kind: 'item', id: 'photos-remove', label: 'Remove this picture',
          hint: item ? `${item.name || 'the picture on screen'}; ${movers.length
            ? `moved to the Removed folder of ${movers.map((s) => s.label || s.id).join(', ')}; it can be brought back from this list`
            : 'every source here keeps it, so it only leaves the slideshows; it can be brought back from this list'}`
            : 'no picture on screen now',
          disabled: !item, run: () => { removeCurrent(); } });
        // every folder inside (row 2.78): the chosen source's folders, each one press to leave out or put back.
        out.push(...folderRows());
        // remove this picture: every picture removed, each with its own "Bring back" (undo never depends on a voice).
        let gone = [];
        try { gone = removals.entries(''); } catch { gone = []; }
        if (gone.length) {
          out.push({ kind: 'heading', id: 'photos-removed-head', label: `Removed pictures (${gone.length})` });
          for (const e of gone.slice(0, HIDDEN_LIST_MAX)) {
            const when = (() => { const t = Date.parse(e.at); return Number.isFinite(t) ? new Date(t).toLocaleDateString() : ''; })();
            out.push({ kind: 'item', id: `photos-restore:${e.key}`, label: `Bring back ${e.name || e.path}`,
              hint: `removed${when ? ` ${when}` : ''}, for everybody`, run: () => { touch(); restoreRemoved(e); } });
          }
        }
        let list = [];
        try { list = hides.entries(viewer()); } catch { list = []; }
        if (!list.length) return out;
        out.push({ kind: 'heading', id: 'photos-hidden-head', label: `Hidden pictures (${list.length})` });
        for (const e of list.slice(0, HIDDEN_LIST_MAX)) {
          const when = (() => { const t = Date.parse(e.at); return Number.isFinite(t) ? new Date(t).toLocaleDateString() : ''; })();
          out.push({ kind: 'item', id: `photos-unhide:${e.key}`, label: `Bring back ${e.name || e.path}`,
            hint: `hidden${when ? ` ${when}` : ''}${e.scope === 'person' ? ', on this person’s screens only' : ', for everybody'}`,
            run: () => { touch(); hides.unhide(e); } });
        }
        if (list.length > 1) {
          out.push({ kind: 'item', id: 'photos-unhide-all', label: `Bring back all ${list.length}`,
            hint: list.length > HIDDEN_LIST_MAX ? `${list.length - HIDDEN_LIST_MAX} more are not listed above` : 'every picture hidden here',
            run: () => { unhideAll(); } });
        }
        return out;
      },

      // EDIT MODE (edit_mode.js, 2026-10-02). The picture on screen, and the line naming where the photos come
      // from, each with the rows about it -- this panel's own declared settings, nothing new. A picture has no
      // caption of its own here, so none is offered (a row that does nothing is a lie). ("Leave this one out" exists
      // since 2026-10-09: "Hide this picture", in this panel's menu rows and on a long press.) The source line first:
      // it is the smaller, inside the bar.
      editTargets: () => {
        const label = mount.querySelector('[data-source-label]');
        const st = stage();
        const out = [];
        if (label) out.push({ id: 'source', label: 'Where the photos come from', el: label, keys: ['sourceId', 'album', SUBFOLDERS_KEY, BACKUP_KEY] });   // backup source; every folder inside
        if (st) out.push({ id: 'picture', label: 'The picture', el: st, keys: ['fit', 'intervalMs', 'autostart', 'autostartAlone', 'resumeAfterMs'],
          help: 'How the picture fits its panel, how long each one stays, and whether the slideshow starts by itself.' });
        return out;
      },
      __probe: () => ({ waiting, paused, currentId, degraded: !!degraded, keptMode, seen: seen.length, ids: ids.slice(),
        loadFails, setAside: [...loadFailed], shownSourceId,
        all: allItems.length, pullNews, hideCurrent, unhideLast,   // hide picture / pulled pictures
        removeCurrent, followUp: (s, l) => followUp(s, l),           // remove this picture
        folders: lastListing?.listing?.folders || null, foldersOpen,   // every folder inside
        // pulled pictures: look at the pull's file now (the hourly look, on demand), for the suite.
        checkPull: () => checkPull(knownSources.find((s) => s && s.id === shownSourceId) || null, cfg.album) }),

      // LIVE OPTIONS for a declared field. The manifest stays static - it is the contract, and
      // a modules tab will want to read it off a module that is not even running - while the
      // options that are genuinely DATA come from the mounted instance.
      //
      // One source means nothing to choose, and the shell renders that row disabled with the
      // reason instead of offering a cycle that lands back where it started. That is not a
      // degraded case; it is the common one, and saying it out loud is how somebody learns
      // why the picker will not move.
      // photo source (2026-10-08, the bench's Pictures screen): A CHOICE THAT IS NOT HERE STAYS IN THE LIST, LAST.
      // The panel was set (from another browser) to a folder that browser had connected; this screen had ONE source
      // of its own, so the row had one option, was disabled ("only one to choose from"), and the press that repairs a
      // dead choice (settings_fields.js stepValue: a value not in the list -> the first option) could never happen.
      // Listing the chosen-but-absent one makes it two options: the row is live, and one press picks a real source.
      // It drops out by itself once the choice is one that is here. Nothing is saved unless somebody presses.
      settingsChoices: () => {
        const opts = knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id }));
        const want = cfg.sourceId;
        if (want && !opts.some((o) => o.value === want)) {
          opts.push({ value: want, label: `${labels[want] ? `“${labels[want]}”` : 'A source'} — not connected here` });
        }
        // backup source: every source this screen may show but the main one, and a line while the backup is on screen.
        // pulled pictures: "3 new pictures today" after the value, when the source's folder is filled by a pull.
        const pulled = pullNewsLine(pullNews);
        return { sourceId: pulled ? { options: opts, status: pulled } : opts,
          album: albumChooser.row(cfg.sourceId || shownSourceId, cfg.album),   // choosing the album
          [BACKUP_KEY]: backupPanelChoices({ sources: knownSources, mainId: cfg.sourceId || null, current: cfg[BACKUP_KEY],
            screen: screenBackup(), panelDefault: BACKUP_ANY, personId: personOf(ctx),
            showing: degraded && degraded.backup && !keptMode ? degraded.shownLabel : null }) };
      },
    };
  },
);
