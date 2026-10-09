// music_local.js — MUSIC FILES FROM THE FAMILY'S OWN MACHINE, played through the speaker arbiter.
//
// Row 2.32, step 2: "local music files (no account, private)". The platform never holds the bytes: a
// favourite names a CONNECTED MEDIA SOURCE (a folder picked on this device, or a media agent - see
// media.js) and a path on it, and the file is read straight from there, exactly the way photos are.
//
// *** IT REGISTERS WITH THE AUDIO BUS, AND THAT IS NOT OPTIONAL. *** audio_bus.js: anything making
// continuous sound must, or it plays over everything. This source:
//   * sits in the `music` group at VIDEO priority. Somebody ASKED for this song, which is the same kind
//     of choice as putting a video on - so neither outranks the other and the newest one wins the
//     speaker (ties break to the most recent). A game's music bed (GAME priority) always yields to it.
//   * is on the `media` tier, so a spoken prompt ducks it and a call pauses it, like a video.
//   * is on the `media` mixer channel ("Videos and music") by default - see MUSIC_CHANNEL below.
//   * PAUSES at level 0 rather than stopping, and carries on when the speaker comes back: a song is not
//     a bed, and losing your place in it because somebody said "computer please" is a small insult.
//
// A missing arbiter means it plays at full volume - never that it will not play (audio_bus.js's rule).
//
// *** FOLDERS OF MUSIC LIST NOW (fixed 2026-09-30). *** A FOLDER favourite asks the media source for a
// listing, and until that day neither lister returned audio - `folder_source.js`'s `kindOf` and the media
// agent's `kind_of` knew only images and videos, so an .mp3 never reached this file. Both now list
// mp3/m4a/aac/ogg/oga/opus/wav/flac as `kind: 'audio'` (one table, `dev/media_kinds.json`, checked on
// both sides), and photos.js keeps them out of the slideshow (`slideshowItems`). Tracks are still picked
// here by extension (`isAudioPath`), which is a superset of the listers' audio kind and also takes .webm.

import { resolveListing, resolveItemUrl } from './media_sources.js';
import { isAudioPath } from './game_music.js';
import { MUSIC_GROUP, VIDEO_PRIORITY } from './audio_bus.js';
// backup source (2026-10-08)
import { backupSources, listingWithin, createSourceRecheck, BACKUP_NONE, LISTING_WAIT_MS, SOURCE_RECHECK_MS } from './media_sources.js';

// *** BACKUP SOURCE (2026-10-08; media_sources.js argues the rows and defaults). *** A file or folder favourite whose
// source can't be reached - not connected on this screen, a listing that fails, or not one of its files will play -
// plays from the backup in force (`backup()`: the Music panel's "If this can't be reached, use", else the screen's
// "Backup folder for this screen"; NOTHING unless somebody chose one, which is what music did before). On the backup:
//   1. the SAME file (by name) in the same folder there, or the same folder - a copy of the same music is the usual
//      backup, and then the right song plays;
//   2. else the backup's own top folder, shuffled or in order as the panel says. AGAINST: "the Beatles" asked for and
//      something else playing. FOR: somebody who cannot ask again hears music rather than nothing, the panel says it is
//      the backup, and only somebody who CHOSE a backup gets this at all.
// BACK TO THE MAIN SOURCE AT THE NEXT SONG, NEVER MID-SONG: the main one is asked after every SOURCE_RECHECK_MS; when it
// answers, the current song finishes and the favourite starts again from the main source. AGAINST: up to one song
// longer on the backup. Cutting a song off half-way, unasked, is the worse of the two.
const dirOf = (p) => { const s = String(p || ''); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); };
const baseOf = (p) => String(p || '').split('/').pop().toLowerCase();
const audioTracksOf = (l) => ((l && l.items) || []).filter((it) => it && it.url && isAudioPath(it.path || it.name || it.url))
  .map((it) => ({ url: it.url, path: it.path }));

// The mixer channel this sits on. 'media' is the one labelled "Videos and music"; a separate "Music"
// fader would be one row in audio_bus.js's CHANNELS, and is listed for Mike rather than added here.
export const MUSIC_CHANNEL = 'media';
export const FOLDER_ORDERS = Object.freeze(['shuffle', 'inorder']);

// What a caller is told when it cannot play. Sentences a person can act on, never a status code.
export const LOCAL_MESSAGES = Object.freeze({
  'no-sources': 'No music folders are connected on this screen.',
  'not-connected': 'That music folder is not connected on this screen.',
  unreachable: 'That music folder could not be reached.',
  'no-audio': 'There is no music in that folder that this screen can find.',
  unplayable: 'That music file would not play.',
  blocked: 'The browser is waiting for a press before it will play sound.',
});

/** A track's name from its path: the file name, without its folder or its extension. Pure. */
export function trackTitle(path) {
  const tail = String(path || '').split(/[\\/]/).pop() || '';
  return tail.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
}

export function createLocalMusic({
  audio = null,
  audioId = 'music:local',
  sources = null,                  // a media-sources client ({ list() })
  resolve = resolveListing,
  resolveItem = resolveItemUrl,
  makeAudio = (src) => (typeof Audio === 'function' ? new Audio(src) : null),
  volume = 1,
  order = 'shuffle',
  rand = Math.random,
  channel = MUSIC_CHANNEL,
  // Told once per track that ACTUALLY STARTS (its element's first `playing`), with { sourceId, path, title }: the
  // folder's plays, for the charts (row 2.62 step 2; music.js files them as source `folder`). A file that will not
  // play is never counted. `title` is the file's name without its folder or extension; no tags are read yet.
  onTrack = null,
  // backup source: `backup()` the choice in force (media_sources.js backupChoice), `personId()` whose screen (never
  // another resident's source), `onBackup(state|null)` told when a backup starts or stops playing. Timers are seams.
  backup = null,
  personId = null,
  onBackup = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  listingWaitMs = LISTING_WAIT_MS,
  recheckMs = SOURCE_RECHECK_MS,
} = {}) {
  let vol = clamp01(volume);
  let gain = 1;                    // what the arbiter last said; 1 until it says otherwise
  let queue = [];                  // [{ url, release, path }]
  let at = -1;
  let el = null;
  let wanted = false;              // somebody asked for this to be playing
  let paused = false;              // somebody asked for it to wait
  let blocked = false;
  let gen = 0;                     // bumped by every play/stop, so a slow listing cannot start late
  let now = null;                  // { kind, sourceId, path|album }
  let dead = false;

  function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1; }

  // *** PLAY ON (rows 2.61, 2.68): WHICH SPEAKER THIS SCREEN'S MUSIC FILES COME OUT OF. *** '' is the computer's own
  // default, which needs nothing set up. A chosen one is an `audiooutput` device id (speakers.js finds it by name);
  // HTMLMediaElement.setSinkId is in Chromium [measured 2026-10-08, dev/spotify_embed_frame_test.html]. A browser
  // without it, or a speaker that has gone, keeps the default: a wrong speaker must never mean no sound.
  let sinkId = '';
  function applySink(target) {
    if (!target || typeof target.setSinkId !== 'function') return;
    try { Promise.resolve(target.setSinkId(sinkId)).catch(() => {}); } catch { /* the default speaker */ }
  }

  if (audio) {
    try {
      audio.register(audioId, {
        tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY, channel,
        onGain: (level) => {
          gain = Math.max(0, Math.min(1, Number(level) || 0));
          enact();
        },
      });
    } catch (err) { console.error('music: audio bus', err); }
  }
  const active = (on) => { try { audio?.setActive?.(audioId, on); } catch { /* advice only */ } };

  // Volume onto the element, and pause/carry on with the speaker. Never throws.
  function enact() {
    if (!el) return;
    try { el.volume = vol * gain; } catch { /* not ready */ }
    if (gain === 0) { try { el.pause?.(); } catch { /* fine */ } return; }
    if (wanted && !paused && el.paused !== false) startEl();
  }

  function startEl() {
    try {
      const p = el.play?.();
      if (p && typeof p.catch === 'function') p.catch(() => { blocked = true; });
    } catch { blocked = true; }
  }

  function releaseAll() {
    for (const t of queue) { try { t.release?.(); } catch { /* gone */ } }
    queue = []; at = -1;
  }

  function dropEl() {
    if (!el) return;
    const e = el;
    el = null;
    try { e.pause?.(); } catch { /* fine */ }
    try { e.removeAttribute?.('src'); e.load?.(); } catch { /* a fake, or already gone */ }
  }

  function playAt(i, g) {
    if (g !== gen || dead) return;
    dropEl();
    if (!queue.length) { finish(); return; }
    at = ((i % queue.length) + queue.length) % queue.length;
    const track = queue[at];
    el = makeAudio(track.url);
    if (!el) { finish(); return; }
    const mine = el;
    applySink(mine);   // play on (row 2.68): the speaker chosen for music, before it makes a sound
    if (typeof onTrack === 'function') {
      let told = false;
      mine.addEventListener?.('playing', () => {
        if (told || el !== mine || g !== gen) return;
        told = true;
        try { onTrack({ sourceId: now?.sourceId || null, path: track.path || '', title: trackTitle(track.path) }); }
        catch (err) { console.error('music: play log', err); }
      });
    }
    mine.addEventListener?.('playing', () => { if (el === mine && g === gen) playedOne = true; });   // backup source
    mine.addEventListener?.('ended', () => {
      if (el !== mine || g !== gen) return;
      // backup source: the main source answered while the backup played - back to it now the song is over.
      if (mainBack && onBackupNow) { backToMain(); return; }
      if (queue.length > 1 && at < queue.length - 1) playAt(at + 1, g);
      else finish();
    });
    // One unplayable file is dropped and the next one tried; when none will play, it stops and says so.
    mine.addEventListener?.('error', () => {
      if (el !== mine || g !== gen) return;
      try { queue[at]?.release?.(); } catch { /* gone */ }
      queue.splice(at, 1);
      if (!queue.length) {
        // backup source: NOT ONE of the favourite's files would play (an agent that has stopped serving: its addresses
        // are made without asking it) - the backup, if one is chosen. Not when the backup itself fails, and not after
        // something has played: that is a bad file at the end of a folder, not a source that is down.
        const req = lastReq;
        const fromMain = !onBackupNow && !playedOne;
        finish('unplayable');
        if (fromMain && req) { const g2 = ++gen; viaBackup(req, 'unplayable', g2).catch(() => {}); }
        return;
      }
      playAt(at, g);
    });
    try { el.volume = vol * gain; } catch { /* fine */ }
    if (gain > 0 && !paused) startEl();
  }

  let lastReason = null;
  function finish(reason = null) {
    lastReason = reason;
    wanted = false; paused = false;
    dropEl();
    releaseAll();
    now = null;
    active(false);
    setBackup(null);   // backup source
  }

  // ---- backup source (see the note at the top) ------------------------------------------------------------------
  let lastReq = null;              // { kind: 'file'|'folder', sourceId, path|album } - the favourite asked for
  let playedOne = false;           // a track of the current request really started
  let onBackupNow = null;          // { label, chosenLabel, why, req } while the backup plays
  let mainBack = false;            // the main source answered: back to it at the end of this song
  const recheck = createSourceRecheck({ ms: () => recheckMs, setTimer, clearTimer,
    isBack: () => mainAnswers(), onBack: () => { mainBack = true; } });
  const read = (v) => { try { return typeof v === 'function' ? v() : v; } catch { return null; } };
  function setBackup(next) {
    const was = onBackupNow;
    onBackupNow = next;
    mainBack = false;
    if (next) recheck.arm(); else recheck.stop();
    if ((was || next) && typeof onBackup === 'function') {
      try { onBackup(next ? { label: next.label, chosenLabel: next.chosenLabel, why: next.why } : null); }
      catch (err) { console.error('music: backup', err); }
    }
  }
  async function mainAnswers() {
    const req = onBackupNow && onBackupNow.req;
    if (!req) return false;
    const { source, error } = await sourceById(req.sourceId);
    if (error) return false;
    const r = await listingWithin(resolve, source, req.kind === 'file' ? dirOf(req.path) : (req.album || ''),
      { accept: audioTracksOf, waitMs: listingWaitMs, setTimer, clearTimer });
    return r.ok && (req.kind !== 'file' || r.items.some((t) => baseOf(t.path) === baseOf(req.path)));
  }
  function backToMain() {
    const req = onBackupNow && onBackupNow.req;
    if (!req) return;
    const again = req.kind === 'file' ? api.playFile({ sourceId: req.sourceId, path: req.path })
      : api.playFolder({ sourceId: req.sourceId, album: req.album });
    Promise.resolve(again).catch((err) => console.error('music: back to the main source', err));
  }
  function inOrder(tracks) {
    const t = tracks.slice();
    if (order !== 'inorder') {
      for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    }
    return t;
  }
  // The favourite's source could not be played from (`why`: 'not-connected' | 'unreachable' | 'unplayable'). Resolves
  // what playFile/playFolder return - `{ ok, tracks, backup }`, or `{ ok:false, reason:'superseded' }` - or null when
  // there is no backup to play (none chosen, or nothing on it).
  async function viaBackup(req, why, g) {
    const choice = read(backup);
    if (!choice || choice === BACKUP_NONE || !sources || typeof sources.list !== 'function') return null;
    let all = [];
    try { all = (await sources.list()) || []; } catch { return null; }
    if (g !== gen || dead) return { ok: false, reason: 'superseded' };
    const tries = backupSources(all, { choice, chosenId: req.sourceId, personId: read(personId) || null });
    const main = all.find((s) => s && s.id === req.sourceId);
    const chosenLabel = main ? (main.label || main.base_url || main.id) : null;
    const here = req.kind === 'file' ? dirOf(req.path) : (req.album || '');
    for (const s of tries) {
      for (const album of (here ? [here, ''] : [''])) {
        const r = await listingWithin(resolve, s, album, { accept: audioTracksOf, waitMs: listingWaitMs, setTimer, clearTimer });
        if (g !== gen || dead) return { ok: false, reason: 'superseded' };
        if (!r.ok || !r.items.length) continue;
        const same = req.kind === 'file' ? r.items.find((t) => baseOf(t.path) === baseOf(req.path)) : null;
        const tracks = same ? [same] : inOrder(r.items);
        const label = s.label || s.base_url || s.id;
        playedOne = false;
        const res = begin(tracks, { kind: req.kind, sourceId: s.id, album, backup: true }, g);
        setBackup({ label, chosenLabel, why, req: { ...req } });
        return { ...res, backup: label };
      }
    }
    return null;
  }

  async function sourceById(sourceId) {
    if (!sources || typeof sources.list !== 'function') return { error: 'no-sources' };
    let all = [];
    try { all = (await sources.list()) || []; } catch { return { error: 'unreachable' }; }
    const s = all.find((x) => x && x.id === sourceId);
    return s ? { source: s } : { error: 'not-connected' };
  }

  function begin(tracks, what, g) {
    queue = tracks;
    now = what;
    wanted = true; paused = false; blocked = false; lastReason = null;
    playedOne = false;   // backup source
    active(true);
    playAt(0, g);
    return { ok: true, tracks: tracks.length };
  }

  const api = {
    /** One file on a connected source. */
    async playFile({ sourceId, path } = {}) {
      this.stop();
      const g = ++gen;
      lastReq = { kind: 'file', sourceId, path };   // backup source
      const { source, error } = await sourceById(sourceId);
      if (g !== gen || dead) return { ok: false, reason: 'superseded' };
      // backup source: not connected here, or no sources list at all: the backup, if one is chosen.
      if (error) return (error !== 'no-sources' && await viaBackup(lastReq, error, g)) || { ok: false, reason: error };
      let item = null;
      try { item = await resolveItem(source, path); } catch { item = null; }
      if (g !== gen || dead) { try { item?.release?.(); } catch { /* gone */ } return { ok: false, reason: 'superseded' }; }
      if (!item || !item.url) return (await viaBackup(lastReq, 'unreachable', g)) || { ok: false, reason: 'unreachable' };
      return begin([{ url: item.url, release: item.release, path }], { kind: 'file', sourceId, path }, g);
    },

    /** Every music file in one folder of a connected source, shuffled or in name order. */
    async playFolder({ sourceId, album = '' } = {}) {
      this.stop();
      const g = ++gen;
      lastReq = { kind: 'folder', sourceId, album };   // backup source
      const { source, error } = await sourceById(sourceId);
      if (g !== gen || dead) return { ok: false, reason: 'superseded' };
      if (error) return (error !== 'no-sources' && await viaBackup(lastReq, error, g)) || { ok: false, reason: error };
      let listing = null;
      try { listing = await resolve(source, album); } catch { listing = null; }
      if (g !== gen || dead) return { ok: false, reason: 'superseded' };
      if (!listing) return (await viaBackup(lastReq, 'unreachable', g)) || { ok: false, reason: 'unreachable' };
      const tracks = (listing.items || []).filter((it) => it && it.url && isAudioPath(it.path || it.name || it.url))
        .map((it) => ({ url: it.url, path: it.path }));
      if (!tracks.length) return { ok: false, reason: 'no-audio' };
      if (order !== 'inorder') {
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
      }
      return begin(tracks, { kind: 'folder', sourceId, album }, g);
    },

    stop() { gen++; finish(); },
    pause() {
      if (!wanted) return false;
      paused = true;
      try { el?.pause?.(); } catch { /* fine */ }
      active(false);                 // not making sound: hand the speaker back
      return true;
    },
    resume() {
      if (!wanted) return false;
      paused = false; blocked = false;
      active(true);
      if (el && gain > 0) startEl();
      return true;
    },
    next() { if (!wanted || queue.length < 2) return false; playAt(at + 1, gen); return true; },
    setVolume(v) { vol = clamp01(v); enact(); return vol; },
    setOrder(o) { order = FOLDER_ORDERS.includes(o) ? o : 'shuffle'; return order; },
    /** play on: the speaker for this music ('' = the computer's default), applied now and to every next song. */
    setSink(id) { sinkId = id ? String(id) : ''; applySink(el); return sinkId; },
    sink: () => sinkId,

    state: () => ({ playing: wanted && !paused, wanted, paused, blocked, tracks: queue.length, at,
                    now: now ? { ...now } : null, volume: vol, gain, reason: lastReason,
                    hasElement: !!el,
                    // backup source: what is playing instead, and whether the main one has answered since
                    backup: onBackupNow ? { label: onBackupNow.label, chosenLabel: onBackupNow.chosenLabel,
                      why: onBackupNow.why, mainBack, checking: recheck.armed() } : null }),

    destroy() {
      dead = true;
      gen++;
      finish();
      recheck.stop();   // backup source
      try { audio?.unregister?.(audioId); } catch { /* gone */ }
    },
  };
  return api;
}
