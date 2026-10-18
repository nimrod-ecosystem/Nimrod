// modules/archive.js — THE INTERNET ARCHIVE, AS A PANEL. Row 2.69.
//
// Mike, 2026-10-08: *"I think we already discussed adding Internet Archive. That would be a good one."* The curated list
// (docs/from_chat/embed_candidates.md, Tier 2): old television, old radio, music, books, and the Archive's arcade - *"I
// could definitely see me playing some classic games at her bedside while she sleeps"* - so this panel serves the person
// in front of the screen by day AND whoever sits with them at night.
//
// WHAT IT IS: a short list of Internet Archive items (an address pasted, or an item's name typed), and a place to see
// and hear them. What the Archive allows and what was measured before building is in archive_org.js's header.
//
// *** PLAIN SOUND AND VIDEO PLAY IN THIS PAGE'S OWN PLAYER, NOT THE ARCHIVE'S FRAME. *** An item's .mp3 and .mp4 files
// are ordinary files, so they play in an <audio> or <video> element here, and so they follow everything the screen
// already does for its own sound:
//   * the audio bus (music group, VIDEO priority, media tier, the "Videos and music" fader): a spoken prompt ducks it, a
//     call pauses it, and it carries on afterwards - the same as a YouTube video;
//   * PLAY ON (row 2.68): any speaker the browser can send to (setSinkId), which a YouTube or Spotify frame cannot do;
//   * the screen's Play / Pause / Next (actions.js `archive`), a switch, and "pause" said aloud.
// THE ARCHIVE'S OWN PLAYER (the embed frame) SHOWS ONLY WHAT ONLY IT CAN SHOW: a book (its page-turning reader),
// pictures, and - when the "The Archive's own player" row says so - games and programs (its emulator). Its sound is in
// another site's frame: the screen cannot turn it down, pause it or send it to another speaker, and the panel says so.
//
// *** THE KEYBOARD COMES BACK BY ITSELF. *** Somebody who clicks into the Archive's player (to play a game, or turn a
// page) gives it the keyboard - and a switch that types a key would then be typing into the game, not moving round the
// screen. A screen must never get stuck in a state only an input can leave when the person in front of it cannot give
// it (CLAUDE.md), so: the panel notices (the page loses focus to the frame), says "The Archive's player has the
// keyboard", offers "Give the keys back", and gives them back by itself after the "Give the keyboard back after" row
// (10 minutes by default; "never" is a choice). AGAINST: somebody playing a game longer than that clicks once to carry
// on. It cannot tell a game being played from one left alone - nothing inside another site's frame is visible here.
// [Not measured on the bench Pi: that Chromium moves focus back out of the frame when asked. Desktop Chrome does.]
//
// *** WHAT IS KEPT: THE ITEM NAMES, AND WHICH FILE IS PLAYING. *** `items` (the identifiers, as text), `nowItem` and
// `nowFile` (so a reload carries on where it was). Titles and file lists are read from archive.org each time and kept
// in this page's memory only. Nothing is copied to this site's server.
//
// DEFAULTS CHOSEN HERE, each a setting (Rule 1), each listed for Mike with its argument:
//   * it starts by itself when it opens (autostart, as every media panel: game_start.js argues it);
//   * one file ends -> the next plays; files play IN ORDER (an item is usually a series: episodes, an album's tracks);
//   * the end of an item -> the next item, and round again (a screen nobody is minding keeps playing);
//   * the Archive's own player is used for books (and anything else with nothing to play), NOT games (archive_org.js);
//   * video plays the Archive's own smaller web copy (smooth on a Pi; archive_org.js `score`);
//   * at most 500 files listed from one item (archive_org.js FILES_MAX_DEFAULT);
//   * the keyboard comes back after 10 minutes (above).
// NOT BUILT, said rather than implied: searching the Archive from the panel (their search API exists: "everything from
// 1962" - a later step); choosing one file of an item as its own entry; the Archive's arcade checked on the bench Pi.

import { registerModule } from '../module.js';
import { MUSIC_GROUP, VIDEO_PRIORITY } from '../audio_bus.js';
import { autostartFields, shouldAutostart, panelAlone, createPlayReporter } from '../game_start.js';
import { parsePlayOn, playOnWords, playOnChoices, sinkIdFor, refreshOutputs, watchOutputs, PLAY_ON_HERE } from '../speakers.js';
import { DOWN_AFTER_FAILURES, SOURCE_RECHECK_MS } from '../media_sources.js';
import { stallFields, createStallReporter } from '../playback_stall.js';
import {
  parseArchiveId, parseItemList, itemListText, fetchItem, playableFiles, itemView, whatItHolds, itemType,
  embedUrl, tileUrl, itemAddress, ARCHIVE_MESSAGES, FILES_MAX_DEFAULT, FRAME_FOR, ITEMS_MAX, searchArchive, searchKindWords,
} from '../archive_org.js';

export const TYPE = 'archive';
export const VOLUME_MIN = 10;
// The keyboard comes back after this long in the Archive's own player (see the header). 10 minutes, argued: long enough
// for a page or a level, short enough that a screen left with the keys in a game is not stuck for the night.
export const KEYS_BACK_MS = 10 * 60 * 1000;

export const DEFAULTS = Object.freeze({
  items: '',
  autostart: true,
  autostartAlone: 'same',
  autoNext: true,
  order: 'inorder',
  atEnd: 'next-item',
  frameFor: 'books',
  keysBackMs: KEYS_BACK_MS,
  videoQuality: 'small',
  maxFiles: FILES_MAX_DEFAULT,
  volume: 100,
  playOn: '',
});

export const SETTINGS = [
  { key: 'items', label: 'Items from the Internet Archive', kind: 'text', default: '', level: 'standard',
    placeholder: 'archive.org/details/…',
    note: 'Paste an address from archive.org, or type an item’s name (the part after /details/). Put a comma between '
      + 'several. “Change the list” on the panel does the same.' },
  ...autostartFields({ on: true }),
  // (2026-10-17) SEARCHING FROM THE ONE MENU, as YouTube's is: what is typed is searched (`settingsWrite`, never saved),
  // what is found is listed under it with Add (`menuItems`).
  { key: 'findItem', label: 'Search the Internet Archive', kind: 'text', default: '', level: 'standard',
    note: 'What is found is listed below, each with Add. Only the words you type are sent to archive.org.' },
  { key: 'autoNext', label: 'When one file ends', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Play the next one', offLabel: 'Stop' },
  { key: 'order', label: 'The files in an item play', kind: 'choice', default: 'inorder', level: 'standard',
    options: [
      { value: 'inorder', label: 'In order' },
      { value: 'shuffle', label: 'Shuffled' },
    ] },
  { key: 'atEnd', label: 'At the end of an item', kind: 'choice', default: 'next-item', level: 'standard',
    options: [
      { value: 'next-item', label: 'Go on to the next item (and round again)' },
      { value: 'again', label: 'Play this item again' },
      { value: 'stop', label: 'Stop' },
    ] },
  { key: 'frameFor', label: 'The Archive’s own player', kind: 'choice', default: 'books', level: 'standard',
    options: [
      { value: 'books', label: 'For books and pictures (not games)' },
      { value: 'books-games', label: 'For books, pictures, and games and programs' },
      { value: 'never', label: 'Never' },
    ],
    note: 'Sound and video always play in this screen’s own player. The Archive’s player shows books and games. Its '
      + 'sound uses this computer’s own speaker, and Pause on this screen does not reach it.' },
  { key: 'keysBackMs', label: 'Give the keyboard back after', kind: 'choice', default: KEYS_BACK_MS, level: 'advanced',
    options: [
      { value: 2 * 60 * 1000, label: '2 minutes' },
      { value: 5 * 60 * 1000, label: '5 minutes' },
      { value: 10 * 60 * 1000, label: '10 minutes' },
      { value: 30 * 60 * 1000, label: '30 minutes' },
      { value: 0, label: 'Never (press “Give the keys back”)' },
    ],
    note: 'Pressing inside the Archive’s player (a game, a book) gives it the keyboard. A switch then types into it, not '
      + 'into this screen. This is how long until the screen takes the keyboard back by itself.' },
  { key: 'videoQuality', label: 'Video plays', kind: 'choice', default: 'small', level: 'advanced',
    options: [
      { value: 'small', label: 'The Archive’s smaller copy (smoother)' },
      { value: 'best', label: 'The best copy this screen can play' },
    ] },
  { key: 'maxFiles', label: 'Most files listed from one item', kind: 'number', default: FILES_MAX_DEFAULT,
    min: 50, max: 2000, step: 50, level: 'advanced' },
  // ESSENTIAL (the one row on a patient screen): how loud it is is the one thing somebody at the bedside may need to change.
  { key: 'volume', label: 'How loud this part is', kind: 'number', default: 100,
    min: VOLUME_MIN, max: 100, step: 10, unit: '%', level: 'essential' },
  { key: 'playOn', label: 'Play on', kind: 'choice', default: '', level: 'standard',
    options: [{ value: '', label: 'As Devices → Speakers says' }, { value: PLAY_ON_HERE, label: 'This screen' }],
    note: 'Sound and video from the Archive can go to any speaker listed. Books and games in the Archive’s own player '
      + 'use this computer’s own speaker.' },
  // STALLED PLAYBACK (Mike, 2026-10-13; playback_stall.js argues the defaults): when the Archive cannot be reached, or
  // its files stop loading, show something else after a while and come back by itself. Only the switch and what is
  // said about it: this panel already skips a file that will not play and tries again by itself, in its own words.
  ...stallFields({ parts: ['notify', 'switch'], pause: false }),
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE_ID = 'archive-style';
const CSS = `
.ia{position:absolute;inset:0;display:grid;grid-template-rows:auto 1fr auto;background:var(--bg);color:var(--text);
  font-family:var(--font);overflow:hidden}
.ia-head{padding:.45em .8em .2em}
.ia-title{display:block;font-size:1.2em;font-weight:700;line-height:1.2}
.ia-sub{font-size:.85em;color:var(--text-soft)}
.ia-stage{position:relative;min-height:0;display:flex;align-items:center;justify-content:center;gap:.8em;padding:0 .6em}
.ia-stage video{width:100%;height:100%;object-fit:contain;background:#000}
.ia-stage audio{width:min(100%,32em)}
.ia-stage .ia-tile{max-height:70%;max-width:40%;object-fit:contain;border-radius:.3em}
.ia-stage .ia-audio{display:flex;flex-direction:column;align-items:center;gap:.5em;width:100%;height:100%;justify-content:center}
.ia-frame{width:100%;height:100%;border:0;background:#fff}
.ia-body{padding:.3em .8em .5em}
.ia-now{margin:.1em 0 .3em;font-size:1em}
.ia-btns{display:flex;flex-wrap:wrap;gap:.4em;margin:.3em 0}
.ia-btn{font:inherit;padding:.35em .9em;border-radius:.5em;border:2px solid var(--border);background:var(--surface,var(--bg));
  color:var(--text);cursor:pointer}
.ia-btn:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:2px}
.ia-msg{margin:.3em 0;font-size:.92em}
.ia-hint{margin:.2em 0;font-size:.85em;color:var(--text-soft)}
.ia-edit input{font:inherit;padding:.3em .5em;min-width:min(26em,100%);border:2px solid var(--border);border-radius:.4em}
.ia-list{list-style:none;margin:.4em 0;padding:0;max-height:12em;overflow:auto}
.ia-list li{display:flex;flex-wrap:wrap;align-items:center;gap:.5em;padding:.2em 0}
.ia-empty{margin:auto;padding:1em;text-align:center;color:var(--text-soft);max-width:34em}
`;

registerModule(
  { type: TYPE, title: 'Internet Archive', core: 'new',
    description: 'Old films, radio, music and books from the Internet Archive (archive.org). Paste an address; '
      + 'sound and video play here, through the speaker you choose.',
    // Everything comes from archive.org: without the network there is nothing to play.
    dependsOn: 'network', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const instanceId = ctx.instanceId || TYPE;
    const AUDIO_ID = `archive:${instanceId}`;
    // Seams for the suites: no network, no real media element.
    const fetchOpts = typeof ctx.archiveFetch === 'function' ? { fetchImpl: ctx.archiveFetch } : {};
    const makeMedia = typeof ctx.makeMedia === 'function' ? ctx.makeMedia
      : (kind) => (mount.ownerDocument || document).createElement(kind);
    const setT = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearT = ctx.clearTimer || ((id) => clearTimeout(id));
    const rand = typeof ctx.rand === 'function' ? ctx.rand : Math.random;
    const audio = () => ctx.audio || null;
    const reportPlay = createPlayReporter(bus, ctx, { kind: 'video' });

    let cfg = { ...DEFAULTS };
    // STALLED PLAYBACK (playback_stall.js): stuck while the Archive cannot be reached or its files stop loading; a file
    // that plays ends it.
    let rawRow = {};
    const stallReport = createStallReporter({ bus, panel: instanceId, type: TYPE, title: 'Internet Archive',
      row: () => rawRow, now: ctx.now || (() => Date.now()) });
    let ids = [];
    let listNote = { bad: 0, over: 0 };
    let at = 0;                    // which item of the list
    let item = null;               // the item read (archive_org.js summarizeItem), or { id, title } when it failed
    let files = null;              // playableFiles' answer for it
    let view = null;               // itemView's answer
    let reason = null;             // a key of ARCHIVE_MESSAGES (or 'blocked'), said under the buttons
    let loading = false;
    let fileAt = -1;
    let played = new Set();        // shuffle: the files of this item already played
    let history = [];              // for "previous"
    let el = null;                 // the <audio> or <video>
    let elKind = '';
    let frame = null;
    let wanted = false;            // somebody (or autostart) wants it playing
    let busPaused = false;         // the audio bus said silent; it carries on when the bus says so
    let gain = 1;
    let registered = false;
    let failRun = 0;
    let loadGen = 0;
    let retryTimer = null;
    let keysTimer = null;
    let keysAway = false;
    let editing = false;
    let editMsg = '';
    let draft = '';
    let waiting = false;           // autostart off: a Start button until Play
    const titles = {};             // id -> title, this page's memory only
    let viewSig = '';
    let dead = false;
    let found = null;              // the menu's search: { q, busy, items, words }, memory only
    let searchSeq = 0;
    const menuChanged = () => { try { ctx.menuChanged?.(); } catch (e) { console.error('archive: menu repaint', e); } };
    let stageEl = null;
    let headEl = null;
    let bodyEl = null;
    let offOutputs = null;
    const win = (mount.ownerDocument && mount.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);

    const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const volume = () => num(cfg.volume, 100, VOLUME_MIN, 100) / 100;
    const maxFiles = () => num(cfg.maxFiles, FILES_MAX_DEFAULT, 50, 2000);
    const frameFor = () => (FRAME_FOR.includes(cfg.frameFor) ? cfg.frameFor : 'books');
    const currentId = () => ids[at] || null;
    const words = (key) => (key === 'blocked' ? 'The browser is waiting for a press before it will play sound. Press Play.'
      : ARCHIVE_MESSAGES[key] || '');

    // ---- the speaker --------------------------------------------------------------------------------------------
    function ensureBus() {
      const a = audio();
      if (registered || !a || typeof a.register !== 'function') return;
      try {
        a.register(AUDIO_ID, { tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY, channel: 'media', onGain });
        registered = true;
      } catch (err) { console.error('archive: audio bus', err); }   // a broken bus never silences it
    }
    const active = (on) => { try { audio()?.setActive?.(AUDIO_ID, on); } catch { /* advice only */ } };
    function applyVolume() { if (el) { try { el.volume = volume() * gain; } catch { /* not ready */ } } }
    function onGain(level) {
      gain = Math.max(0, Math.min(1, Number(level) || 0));
      applyVolume();
      if (!el) return;
      if (gain === 0) {
        if (wanted && !el.paused) { busPaused = true; try { el.pause(); } catch { /* fine */ } }
        return;
      }
      if (busPaused) { busPaused = false; if (wanted) start(); }
    }
    // PLAY ON: this panel's row, else the screen's Devices -> Speakers "Music plays on" (`ctx.speakerRoute`), else the
    // computer's default. A Spotify speaker cannot play these files; it means this screen, and the panel says so.
    const screenRoute = () => { try { return String(ctx.speakerRoute?.('music') || ''); } catch { return ''; } };
    const playOnValue = () => String(cfg.playOn || '') || screenRoute() || PLAY_ON_HERE;
    function applySink() {
      if (!el || typeof el.setSinkId !== 'function') return;
      const p = parsePlayOn(playOnValue());
      const id = p.kind === 'out' ? sinkIdFor(p.name) : '';
      try { Promise.resolve(el.setSinkId(id)).catch(() => {}); } catch { /* the default speaker */ }
    }

    // ---- the media element --------------------------------------------------------------------------------------
    function dropMedia() {
      if (!el) return;
      const e = el;
      el = null; elKind = '';
      try { e.pause?.(); } catch { /* fine */ }
      try { e.removeAttribute?.('src'); e.load?.(); } catch { /* a fake */ }
      try { e.remove?.(); } catch { /* fine */ }
    }
    function dropFrame() {
      if (!frame) return;
      try { frame.remove(); } catch { /* fine */ }
      frame = null;
      keysBack(false);
    }
    function clearStage() { dropMedia(); dropFrame(); if (stageEl) stageEl.innerHTML = ''; }

    function makeEl(kind) {
      dropMedia();
      if (stageEl) stageEl.innerHTML = '';
      const m = makeMedia(kind);
      if (!m) return null;
      try { m.setAttribute?.('controls', ''); m.setAttribute?.('preload', 'metadata'); m.setAttribute?.('playsinline', ''); } catch { /* a fake */ }
      const isNode = typeof Node !== 'undefined' && m instanceof Node;
      if (isNode && stageEl) {
        if (kind === 'audio') {
          const box = (doc || document).createElement('div');
          box.className = 'ia-audio';
          box.innerHTML = `<img class="ia-tile" data-ia-tile alt="" src="${esc(tileUrl(currentId() || ''))}" referrerpolicy="no-referrer">`;
          box.append(m);
          stageEl.append(box);
        } else stageEl.append(m);
      }
      const mine = m;
      m.addEventListener?.('playing', () => {
        if (el !== mine) return;
        failRun = 0;
        if (reason === 'blocked' || reason === 'archive-files-failed') reason = null;
        reportPlay(true);
        stallReport.ok();          // playback_stall.js: a file that plays ends a stretch of being stuck
        active(true);
        render();
      });
      m.addEventListener?.('pause', () => {
        // A pause that arrives after play() was asked again (a new file's src, a resume) is old news.
        if (el !== mine || mine.paused === false) return;
        // The player's own pause button is somebody asking; the bus's pause is not, and carries on by itself.
        if (!busPaused) { wanted = false; active(false); }
        reportPlay(false);
        render();
      });
      m.addEventListener?.('ended', () => { if (el === mine) onEnded(); });
      m.addEventListener?.('error', () => { if (el === mine) onFileError(); });
      el = m; elKind = kind;
      applyVolume();
      applySink();
      return m;
    }

    function start() {
      if (!el) return;
      if (audio() && gain === 0) { busPaused = true; return; }   // the bus says silent: it starts the file when it can
      try {
        const p = el.play?.();
        if (p && typeof p.catch === 'function') p.catch(() => { if (!dead && wanted) { reason = 'blocked'; render(); } });
      } catch { reason = 'blocked'; render(); }
    }

    function remember(file) {
      const id = currentId();
      if (!id || !file) return;
      const snap = state?.get?.() || {};
      if (snap.nowItem === id && snap.nowFile === file.name) return;
      try { state?.set?.({ nowItem: id, nowFile: file.name }); } catch { /* not saved: only where it carries on */ }
    }

    function playFile(i, { push = true, play = true } = {}) {
      const list = files && files.files;
      if (!list || !list.length) return;
      const n = list.length;
      const idx = ((i % n) + n) % n;
      if (push && fileAt >= 0 && fileAt !== idx) history.push(fileAt);
      if (history.length > n) history = history.slice(-n);
      fileAt = idx;
      played.add(idx);
      const f = list[idx];
      ensureBus();
      if (!el || elKind !== f.kind) makeEl(f.kind);
      if (!el) return;
      try { el.src = f.url; } catch { /* a fake */ }
      applyVolume();
      applySink();
      remember(f);
      waiting = !play;
      wanted = !!play;
      busPaused = false;
      if (play) start();
      render();
    }

    // The next file: in order, or a shuffled one not yet played. null at the end of the item.
    function nextIndex() {
      const n = files && files.files ? files.files.length : 0;
      if (!n) return null;
      if (cfg.order === 'shuffle') {
        const left = [];
        for (let i = 0; i < n; i += 1) if (!played.has(i)) left.push(i);
        if (!left.length) return null;
        return left[Math.min(left.length - 1, Math.floor(rand() * left.length))];
      }
      return fileAt + 1 < n ? fileAt + 1 : null;
    }

    function atItemEnd({ manual = false } = {}) {
      const how = cfg.atEnd;
      if (how === 'next-item' && ids.length > 1) { loadItem(at + 1, { autoplay: true }); return; }
      if (how === 'stop' && !manual) { stopPlaying(); return; }
      // 'again', a one-item list going "round again", or a press on Next at the end: from the top.
      played = new Set();
      history = [];
      playFile(cfg.order === 'shuffle' ? Math.floor(rand() * files.files.length) : 0, { push: false });
    }

    function onEnded() {
      if (!cfg.autoNext) { stopPlaying(); return; }
      const i = nextIndex();
      if (i == null) atItemEnd(); else playFile(i);
    }

    // A file that will not play is skipped; DOWN_AFTER_FAILURES in a row (media_sources.js argues the 3) is the Archive
    // not serving, not a bad file: the panel stops, says so, and tries again at the next item after SOURCE_RECHECK_MS.
    function onFileError() {
      failRun += 1;
      if (failRun >= DOWN_AFTER_FAILURES) {
        failRun = 0;
        stopPlaying();
        reason = 'archive-files-failed';
        stallReport.stuck(reason);   // playback_stall.js
        render();
        armRetry(() => loadItem(ids.length > 1 ? at + 1 : at, { autoplay: true }));
        return;
      }
      const i = nextIndex();
      if (i == null) atItemEnd(); else playFile(i);
    }

    function stopPlaying() {
      wanted = false; busPaused = false; waiting = false;
      try { el?.pause?.(); } catch { /* fine */ }
      active(false);
      reportPlay(false);
      render();
    }

    function armRetry(fn) {
      if (retryTimer != null) { try { clearT(retryTimer); } catch { /* gone */ } }
      const ms = Number.isFinite(Number(ctx.sourceRecheckMs)) && ctx.sourceRecheckMs != null ? Number(ctx.sourceRecheckMs) : SOURCE_RECHECK_MS;
      if (!(ms > 0)) { retryTimer = null; return; }
      retryTimer = setT(() => { retryTimer = null; if (!dead) fn(); }, ms);
    }

    // ---- the Archive's own player, and the keyboard -------------------------------------------------------------
    function showFrame() {
      dropMedia();
      if (!stageEl) return;
      stageEl.innerHTML = '';
      const f = (doc || document).createElement('iframe');
      f.className = 'ia-frame';
      f.setAttribute('data-ia-frame', '');
      f.setAttribute('title', `${item?.title || 'Internet Archive'}, in the Internet Archive’s own player`);
      f.setAttribute('allow', 'fullscreen');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.src = typeof ctx.archiveEmbedUrl === 'function' ? ctx.archiveEmbedUrl(item.id) : embedUrl(item.id);   // suites: no network
      stageEl.append(f);
      frame = f;
    }
    function onWinBlur() {
      // The page lost the keyboard; to the Archive's frame? (activeElement is the frame once the blur has settled.)
      setT(() => {
        if (dead || !frame || !doc) return;
        if (doc.activeElement === frame) keysAwayNow();
      }, 0);
    }
    function onWinFocus() { if (keysAway) keysBack(false); }
    function keysAwayNow() {
      keysAway = true;
      if (keysTimer != null) { try { clearT(keysTimer); } catch { /* gone */ } keysTimer = null; }
      const ms = Number(cfg.keysBackMs);
      if (Number.isFinite(ms) && ms > 0) keysTimer = setT(() => { keysTimer = null; keysBack(true); }, ms);
      render();
    }
    // Take the keyboard back from the frame: focus a button of this panel (the frame loses it), then say so.
    function keysBack(take) {
      if (keysTimer != null) { try { clearT(keysTimer); } catch { /* gone */ } keysTimer = null; }
      const was = keysAway;
      keysAway = false;
      // Drawn first: drawing replaces the buttons, and a focused button that is replaced leaves the keyboard nowhere.
      if (was && !dead) render();
      if (take) {
        try {
          const b = mount.querySelector('[data-act="play"],[data-act="next-item"],[data-act="edit"]');
          if (b && typeof b.focus === 'function') b.focus({ preventScroll: true });
          if (doc && frame && doc.activeElement === frame) frame.blur?.();
        } catch { /* the keyboard stays where it is; the button is still there */ }
      }
    }

    // ---- loading an item ----------------------------------------------------------------------------------------
    async function loadItem(index, { autoplay = true, startFile = null } = {}) {
      const g = ++loadGen;
      if (retryTimer != null) { try { clearT(retryTimer); } catch { /* gone */ } retryTimer = null; }
      wanted = false; busPaused = false; waiting = false;
      active(false);
      reportPlay(false);
      clearStage();
      // `failRun` is NOT reset here: files failing across items (the Archive's file servers down) still add up to three,
      // or a list of short items would go round failing for ever. A file that plays resets it.
      fileAt = -1; played = new Set(); history = [];
      if (!ids.length) { at = 0; item = null; files = null; view = null; reason = null; loading = false; render(); return; }
      at = ((index % ids.length) + ids.length) % ids.length;
      const id = ids[at];
      item = { id, title: titles[id] || id, files: [] };
      files = null; view = null; reason = null; loading = true;
      render();
      const r = await fetchItem(id, fetchOpts);
      if (g !== loadGen || dead) return;
      loading = false;
      if (!r.ok) {
        reason = r.reason;
        render();
        // Not reachable: asked again after SOURCE_RECHECK_MS (a screen that came up before the network did). Not found:
        // the address is wrong, and asking again changes nothing.
        if (r.reason === 'archive-unreachable') {
          stallReport.stuck(r.reason);   // playback_stall.js: the screen may show something else meanwhile
          armRetry(() => loadItem(at, { autoplay, startFile }));
        }
        return;
      }
      item = r.item;
      titles[id] = item.title;
      files = playableFiles(item, { want: 'any', quality: cfg.videoQuality === 'best' ? 'best' : 'small', max: maxFiles() });
      view = itemView(item, files, { frameFor: frameFor() });
      reason = view.reason;
      viewSig = sigNow();
      render();
      if (view.mode === 'frame') { showFrame(); render(); return; }
      if (view.mode !== 'media') return;
      let i = startFile ? files.files.findIndex((f) => f.name === startFile) : -1;
      if (i < 0) i = cfg.order === 'shuffle' ? Math.min(files.files.length - 1, Math.floor(rand() * files.files.length)) : 0;
      playFile(i, { push: false, play: !!autoplay });
    }
    const sigNow = () => JSON.stringify([cfg.videoQuality, maxFiles(), frameFor()]);

    // ---- the settings, as they change ---------------------------------------------------------------------------
    let started = false;
    function readCfg(snap) {
      const was = cfg;
      rawRow = snap && typeof snap === 'object' ? snap : {};
      cfg = { ...DEFAULTS, ...(snap || {}) };
      stallReport.refresh();
      const list = parseItemList(cfg.items);
      listNote = { bad: list.bad, over: list.over };
      const next = [...list];
      const changed = next.join('|') !== ids.join('|');
      const nowId = currentId();
      ids = next;
      if (!started) return;
      if (changed) {
        const keep = nowId ? ids.indexOf(nowId) : -1;
        if (keep >= 0) at = keep;
        else { loadItem(0, { autoplay: wanted || shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) }) }); return; }
      }
      if (was.volume !== cfg.volume) applyVolume();
      if (was.playOn !== cfg.playOn) applySink();
      if (item && files && sigNow() !== viewSig) {
        const cur = files.files[fileAt];
        loadItem(at, { autoplay: wanted, startFile: cur ? cur.name : null });
        return;
      }
      render();
    }

    // ---- the view -----------------------------------------------------------------------------------------------
    const btn = (act, label, extra = '') => `<button type="button" class="ia-btn" data-act="${act}"${extra}>${esc(label)}</button>`;
    function headHtml() {
      if (!item) return '';
      const sub = [];
      if (files || view) sub.push(whatItHolds(item, files));
      if (item.creator) sub.push(item.creator);
      if (item.date) sub.push(item.date.slice(0, 10));
      return `<span class="ia-title" data-ia-title>${esc(item.title)}</span>
        <span class="ia-sub" data-ia-holds>${esc(sub.join(' · '))}</span>
        <span class="ia-sub" data-ia-credit> · From the Internet Archive: ${esc(itemAddress(item.id))}</span>`;
    }
    function nowLine() {
      if (loading) return 'Reading the item from the Internet Archive…';
      if (!files || !files.files.length || fileAt < 0) return '';
      const f = files.files[fileAt];
      const of = `${fileAt + 1} of ${files.files.length}${files.truncated ? ` (the first ${files.files.length} of ${files.total})` : ''}`;
      const st = wanted && !busPaused ? 'Playing' : busPaused ? 'Waiting for quiet' : 'Paused';
      return `${st} ${of}: ${f.title}`;
    }
    function mainHtml() {
      if (!ids.length) {
        return `<p class="ia-empty" data-ia-empty>No items yet. Press “Change the list” and paste an address from
          archive.org, like archive.org/details/… An old film, a radio show, an album or a book.</p>
          <div class="ia-btns">${btn('edit', 'Change the list')}</div>`;
      }
      const media = view && view.mode === 'media';
      const playing = wanted && !busPaused;
      const p = parsePlayOn(playOnValue());
      const lines = [];
      if (reason) lines.push(`<p class="ia-msg" data-ia-msg role="status">${esc(words(reason))}</p>`);
      if (view && view.mode === 'frame') {
        lines.push('<p class="ia-hint" data-ia-frame-note>This plays in the Internet Archive’s own player. Its sound uses this '
          + 'computer’s own speaker, and Pause on this screen does not reach it.</p>');
      }
      if (keysAway) {
        lines.push(`<p class="ia-msg" data-ia-keys role="status">The Archive’s player has the keyboard.${Number(cfg.keysBackMs) > 0
          ? ' It comes back by itself in a few minutes.' : ''}</p>`);
      }
      if (media && p.kind === 'spotify') lines.push('<p class="ia-hint">A Spotify speaker can’t play these files. They play on this screen.</p>');
      if (listNote.bad || listNote.over) {
        lines.push(`<p class="ia-hint">${listNote.bad ? `${listNote.bad} of the items typed in are not Internet Archive addresses. ` : ''}`
          + `${listNote.over ? `${listNote.over} more than ${ITEMS_MAX} are left off.` : ''}</p>`);
      }
      const now = nowLine();
      return `${now ? `<p class="ia-now" data-ia-now>${esc(now)}</p>` : ''}
        ${waiting && media ? `<div class="ia-btns">${btn('play', 'Start', ' data-ia-start')}</div>` : ''}
        <div class="ia-btns">
          ${media ? btn('prev', 'Previous') + btn(playing ? 'pause' : 'play', playing ? 'Pause' : 'Play') + btn('next', 'Next') : ''}
          ${ids.length > 1 ? btn('next-item', `Next item (${at + 1} of ${ids.length})`) : ''}
          ${keysAway ? btn('keys', 'Give the keys back') : ''}
          ${reason === 'archive-unreachable' || reason === 'archive-files-failed' ? btn('retry', 'Try again') : ''}
          ${btn('edit', 'Change the list')}
        </div>
        ${media ? `<p class="ia-hint" data-ia-play-on>Plays on: ${esc(playOnWords(playOnValue()))}</p>` : ''}
        ${lines.join('')}`;
    }
    function editHtml() {
      const rows = ids.map((id, i) => `<li><span><b>${esc(titles[id] || id)}</b> · <span class="ia-hint">${esc(itemAddress(id))}</span></span>
          ${btn('show', 'Show it', ` data-index="${i}"`)}${btn('remove', 'Remove', ` data-id="${esc(id)}"`)}</li>`).join('');
      return `<div class="ia-edit" data-ia-edit>
          <p class="ia-hint">Paste an address from archive.org, or type an item’s name. Typing needs a keyboard.</p>
          <div class="ia-btns"><input type="text" data-ia-add aria-label="Internet Archive address or item name"
            placeholder="archive.org/details/…" value="${esc(draft)}">${btn('add', 'Add')}</div>
          ${editMsg ? `<p class="ia-msg" data-ia-edit-msg role="status">${esc(editMsg)}</p>` : ''}
          <ul class="ia-list" data-ia-list>${rows || '<li class="ia-hint">No items yet.</li>'}</ul>
          <p class="ia-hint">Only the item names are saved. The films, sound and books come straight from the Internet Archive.</p>
          <div class="ia-btns">${btn('close', 'Done')}</div>
        </div>`;
    }
    function render() {
      if (dead || !bodyEl) return;
      const had = doc && doc.activeElement;
      const typing = had && mount.contains(had) && had.matches?.('[data-ia-add]');
      if (headEl) headEl.innerHTML = headHtml();
      bodyEl.innerHTML = editing ? editHtml() : mainHtml();
      if (typing) { const box = mount.querySelector('[data-ia-add]'); box?.focus?.({ preventScroll: true }); }
    }

    // ---- actions ------------------------------------------------------------------------------------------------
    function saveIds(next) {
      ids = next;
      try { state?.set?.({ items: itemListText(next) }); } catch { /* not saved */ }
    }
    async function addFromDraft() {
      const id = parseArchiveId(draft);
      if (!id) { editMsg = ARCHIVE_MESSAGES['archive-bad-id']; render(); return; }
      if (ids.includes(id)) { editMsg = 'That item is already in the list.'; render(); return; }
      if (ids.length >= ITEMS_MAX) { editMsg = `The list holds ${ITEMS_MAX} items. Remove one first.`; render(); return; }
      editMsg = 'Looking it up…'; render();
      const r = await fetchItem(id, fetchOpts);
      if (dead) return;
      if (!r.ok && r.reason !== 'archive-unreachable') { editMsg = words(r.reason); render(); return; }
      if (r.ok) titles[id] = r.item.title;
      const wasEmpty = !ids.length;
      draft = '';
      editMsg = r.ok ? `Added “${r.item.title}”: ${whatItHolds(r.item, playableFiles(r.item, { max: maxFiles() }))}.`
        : 'Added. The Internet Archive could not be reached to check it; it is tried again when it plays.';
      saveIds([...ids, id]);
      if (wasEmpty) loadItem(0, { autoplay: shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) }) });
      else render();
    }
    function removeId(id) {
      const was = currentId();
      const next = ids.filter((x) => x !== id);
      saveIds(next);
      editMsg = `Removed “${titles[id] || id}”.`;
      if (was === id) loadItem(Math.min(at, Math.max(0, next.length - 1)), { autoplay: wanted });
      else { at = Math.max(0, next.indexOf(was)); render(); }
    }

    const api = {
      next() {
        if (!files || !files.files.length) { if (ids.length > 1) loadItem(at + 1, { autoplay: true }); return; }
        const i = nextIndex();
        if (i == null) atItemEnd({ manual: true }); else playFile(i);
      },
      prev() {
        if (!files || !files.files.length) { if (ids.length > 1) loadItem(at - 1, { autoplay: true }); return; }
        const i = history.length ? history.pop() : fileAt - 1;
        playFile(i, { push: false });
      },
      play() {
        if (view && view.mode === 'media' && fileAt >= 0) {
          if (!el || waiting) { playFile(fileAt, { push: false }); return; }
          wanted = true; busPaused = false; reason = reason === 'blocked' ? null : reason; start(); render();
          return;
        }
        if (!item && ids.length) loadItem(at, { autoplay: true });
      },
      pause() {
        if (!el) return;
        wanted = false; busPaused = false; waiting = false;
        try { el.pause(); } catch { /* fine */ }
        active(false);
        reportPlay(false);
        render();
      },
      select() { if (wanted && !busPaused) api.pause(); else api.play(); },
      nextItem() { if (ids.length) loadItem(at + 1, { autoplay: true }); },
    };

    function act(b) {
      const a = b?.dataset?.act;
      if (!a) return;
      if (a === 'play') api.play();
      else if (a === 'pause') api.pause();
      else if (a === 'next') api.next();
      else if (a === 'prev') api.prev();
      else if (a === 'next-item') api.nextItem();
      else if (a === 'retry') loadItem(at, { autoplay: true });
      else if (a === 'keys') keysBack(true);
      else if (a === 'edit') { editing = true; editMsg = ''; render(); mount.querySelector('[data-ia-add]')?.focus?.({ preventScroll: true }); }
      else if (a === 'close') { editing = false; editMsg = ''; render(); }
      else if (a === 'add') addFromDraft();
      else if (a === 'remove') removeId(b.dataset.id);
      else if (a === 'show') { editing = false; loadItem(Number(b.dataset.index) || 0, { autoplay: true }); }
    }

    return {
      init() {
        if (doc && !doc.getElementById(STYLE_ID)) {
          const st = doc.createElement('style');
          st.id = STYLE_ID;
          st.textContent = CSS;
          (doc.head || doc.documentElement).append(st);
        }
        mount.innerHTML = `<div class="ia" data-archive>
            <div class="ia-head" data-ia-head></div>
            <div class="ia-stage" data-ia-stage></div>
            <div class="ia-body" data-ia-body></div>
          </div>`;
        headEl = mount.querySelector('[data-ia-head]');
        stageEl = mount.querySelector('[data-ia-stage]');
        bodyEl = mount.querySelector('[data-ia-body]');
        mount.addEventListener('click', (e) => { const b = e.target.closest?.('[data-act]'); if (b && mount.contains(b)) act(b); });
        mount.addEventListener('input', (e) => { if (e.target.matches?.('[data-ia-add]')) draft = e.target.value; });
        mount.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target.matches?.('[data-ia-add]')) { e.preventDefault(); addFromDraft(); }
        });
        win?.addEventListener?.('blur', onWinBlur);
        win?.addEventListener?.('focus', onWinFocus);
        // The speakers' names, for the Play on row (speakers.js; names need the microphone permission).
        // `ctx.speakersOffline`: the suites' seam, as music.js's (the browser's own list would replace theirs).
        try {
          offOutputs = watchOutputs(() => { if (!dead) applySink(); });
          if (!ctx.speakersOffline) Promise.resolve(refreshOutputs()).catch(() => {});
        } catch { /* the default speaker */ }

        readCfg(state?.get?.());
        state?.subscribe?.((snap) => { if (!dead) readCfg(snap); });
        started = true;
        const snap = state?.get?.() || {};
        const startAt = snap.nowItem ? Math.max(0, ids.indexOf(snap.nowItem)) : 0;
        const auto = shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) });
        if (ids.length) loadItem(startAt, { autoplay: auto, startFile: snap.nowItem === ids[startAt] ? snap.nowFile : null });
        else render();

        bus.subscribe(`${TYPE}/next`, () => api.next());
        bus.subscribe(`${TYPE}/prev`, () => api.prev());
        bus.subscribe(`${TYPE}/play`, () => api.play());
        bus.subscribe(`${TYPE}/pause`, () => api.pause());
        bus.subscribe(`${TYPE}/select`, () => api.select());
        bus.subscribe(`${TYPE}/item`, () => api.nextItem());
      },
      onResize() {},
      onHide() { stallReport.gone(); state?.flush?.(); },
      destroy() {
        stallReport.gone();
        dead = true;
        loadGen += 1;
        if (retryTimer != null) { try { clearT(retryTimer); } catch { /* gone */ } }
        if (keysTimer != null) { try { clearT(keysTimer); } catch { /* gone */ } }
        try { win?.removeEventListener?.('blur', onWinBlur); win?.removeEventListener?.('focus', onWinFocus); } catch { /* gone */ }
        try { offOutputs?.(); } catch { /* gone */ }
        dropMedia();
        dropFrame();
        reportPlay(false);
        try { if (registered) { audio()?.setActive?.(AUDIO_ID, false); audio()?.unregister?.(AUDIO_ID); } } catch { /* gone */ }
        registered = false;
      },
      // (2026-10-17) "Search the Internet Archive": the typed words searched, never saved (a search is somebody's
      // passing words); an empty box clears what was found. A newer search wins over a slower older one.
      settingsWrite(key, value) {
        if (key !== 'findItem') return false;
        const q = String(value == null ? '' : value).trim();
        const mine = ++searchSeq;
        if (!q) { found = null; return true; }
        found = { q, busy: true, items: [], words: '' };
        menuChanged();
        Promise.resolve(searchArchive(q, fetchOpts)).then((r) => {
          if (mine !== searchSeq || dead) return;
          found = r && r.ok
            ? { q, items: r.items, words: r.items.length ? '' : 'Nothing found.' }
            : { q, items: [], words: ARCHIVE_MESSAGES[r?.reason] || ARCHIVE_MESSAGES['archive-unreachable'] };
          menuChanged();
        });
        return true;
      },
      // What the last search found, each with Add (onto the end of this part's items).
      menuItems() {
        if (!found) return [];
        const out = [{ kind: 'heading', id: 'ia-found', label: found.busy ? `Searching the Internet Archive for \u201c${found.q}\u201d\u2026` : `Found on the Internet Archive for \u201c${found.q}\u201d` }];
        if (found.words) out.push({ kind: 'item', id: 'ia-found:words', label: found.words, disabled: true });
        const have = parseItemList(cfg.items);
        for (const it of found.items) {
          const added = have.includes(it.id);
          out.push({ kind: 'item', id: `ia-found:${it.id}`, label: added ? `Added: ${it.title}` : `Add ${it.title}`, disabled: added,
            hint: [searchKindWords(it.kind), it.creator].filter(Boolean).join(', '),
            run: () => {
              const now = parseItemList(cfg.items);
              if (now.includes(it.id) || now.length >= ITEMS_MAX) return;
              titles[it.id] = titles[it.id] || it.title;
              try { state?.set?.({ items: itemListText([...now, it.id]) }); } catch { /* not saved */ }
            } });
        }
        if (!found.busy) out.push({ kind: 'item', id: 'ia-found:clear', label: 'Clear the search results', run: () => { found = null; } });
        return out;
      },
      // The Play on row's live choices (speakers.js): this screen and each attached speaker. No Spotify speakers - these
      // files are played here. And the items row's live line: what each name is, from this page's memory.
      settingsChoices() {
        const out = {
          playOn: playOnChoices({ inherit: `As Devices → Speakers says (${playOnWords(screenRoute() || PLAY_ON_HERE)})`, spotifyOn: false }),
        };
        if (ids.length) {
          const named = ids.map((id) => titles[id] || id);
          out.items = { status: `${ids.length} item${ids.length === 1 ? '' : 's'}: ${named.slice(0, 3).join('; ')}${ids.length > 3 ? '; …' : ''}` };
        }
        return out;
      },
      __probe: () => ({
        ids: ids.slice(), at, id: currentId(), title: item ? item.title : null, mode: view ? view.mode : null, reason,
        fileAt, files: files ? files.files.map((f) => f.name) : [], kind: files ? files.kind : null, wanted, busPaused,
        waiting, elKind, src: el ? String(el.src || '') : '', frameSrc: frame ? frame.src : '', keysAway, registered,
        loading, type: item ? itemType(item) : null,
      }),
      __api: api,
    };
  },
);
