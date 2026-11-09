// music_player.js — THE ONE PLACE `music/play { name }` IS ANSWERED. Row 2.32.
//
// A favourite's name comes in (spoken, pressed, or published by anything); the entry is found in the
// favourites list; the source is handed to the player that owns that kind of music:
//
//   youtube   -> the YouTube PANEL on this screen, if there is one (`youtube/who` -> `youtube/load#id`),
//                else this panel's own YouTube player, else it says there is nowhere to play it
//   file      -> music_local.js, through the audio bus
//   folder    -> music_local.js, through the audio bus
//   spotify   -> music_spotify.js, on a Spotify device that is already on (only when turned on); the
//                music panel hands over a player that picks a playlist's songs with the site's own weighted
//                picker (createSpotifyPlayer, row 2.55), and a bare connector still works here
//   spotify, "Play on: this screen" (play on, rows 2.61/2.68)
//             -> spotify_embed.js: Spotify's own player in the panel, the way YouTube plays; no app needed
//   archive   -> (row 2.69) the item's sound files, read from archive.org's public metadata (archive_org.js), played by
//                music_local.js like a folder: the audio bus, the chosen speaker, the panel's order and volume
//
// *** PLAYING SOMEWHERE ELSE IS ASKED ABOUT, NOT TAKEN OVER (note BK item 4). *** A Spotify player that finds the
// account already playing on another device answers 'playing-elsewhere'; the router asks "Spotify is already
// playing on <device>. Play this instead?" the way it asks a near miss, and `music/confirm` plays it anyway.
//
// Starting one kind stops whatever kind was playing before, so "play jazz" after "play the Beatles"
// never leaves two things going. (Two things of the SAME kind replace each other in their own player.)
//
// *** ONE ANSWER PER SCREEN. *** Two music panels on one screen both hear `music/play` (the bus is
// broadcast). Only the first router created for a bus answers; the others stand by, and the next one
// takes over when it goes. Without this, "play jazz" would start it twice.
//
// *** A NEAR MISS ASKS BY DEFAULT. *** input_speech.js's rule (Mike, note AO): a name that is close to
// exactly one favourite does not play; it asks "Did you mean ...?" and plays on `music/confirm`. The
// panel's setting can make it play straight away instead, or ignore it - see NEAR_MATCH_MODES.
//
// TOPICS
//   in   music/play { name } | "name" | { id }    music/stop    music/pause    music/resume
//        music/confirm (yes to the last "did you mean")
//   out  music/now { playing, name, kind, reason, message }   - whenever what is playing changes
//        music/did-you-mean { name, heard }

import { findFavourite, MUSIC_PLAY_TOPIC, MUSIC_STOP_TOPIC } from './music_favourites.js';
import { LOCAL_MESSAGES } from './music_local.js';
import { SPOTIFY_MESSAGES } from './music_spotify.js';
import { EMBED_WORDS } from './spotify_embed.js';   // play on
import { ARCHIVE_MESSAGES, archiveAudioTracks } from './archive_org.js';   // internet archive (row 2.69)

export const MUSIC_TOPICS = Object.freeze({
  play: MUSIC_PLAY_TOPIC, stop: MUSIC_STOP_TOPIC, pause: 'music/pause', resume: 'music/resume',
  confirm: 'music/confirm', now: 'music/now', didYouMean: 'music/did-you-mean',
  shuffle: 'music/shuffle',      // (note FT 3) shuffle every favourite, a bounded run
  rewind: 'music/rewind', forward: 'music/forward',   // (2026-11-08) a jump back or on, in the song playing

  // (row 2.107, 2026-10-18) "is there a Music panel on this screen, and what can it play?" - asked by a game that plays
  // a favourite while somebody plays (game_music_host.js); answered by the leader with the favourites' names.
  who: 'music/who', here: 'music/here',
});
// *** SHUFFLE ALL MY FAVOURITES (row 2.247, note FT 3; gated GO WITH CHANGES: "plays a BOUNDED run by default, never
// forever"). *** One Play that walks the whole list: the shared weighted picker (music_pick.js, the YouTube panel's
// weights) chooses the next favourite, its own player plays it, and when it ends the next is chosen. A favourite that
// will not play is passed over quietly and the next tried; when none will, the run stops and says so once.
// HOW LONG: an HOUR by default, then it stops by itself. FOR a longer default or none: a person who wants music all
// evening has to start it again. AGAINST, and it decides: the person in front of the screen may not be able to reach
// Stop, and sound that goes on with nobody able to end it is the risk the gate named; an hour is a dinner or an
// afternoon's sitting. It is a setting (the panel's "Shuffle all plays for" row): 30 minutes, 1, 2 or 4 hours, or
// until Stop is pressed. At the hour it stops at once, not at the end of the favourite: a favourite can be a whole
// album or playlist, and "at the end of it" would not be a bound.
// A YOUTUBE FAVOURITE IN A RUN PLAYS IN THIS PANEL, not the screen's YouTube panel: only this panel's own player says
// when it has ended, and a run handed to the YouTube panel would stop there.
// Starting anything else (a favourite by name, Stop) ends the run.
export const SHUFFLE_MINUTES_DEFAULT = 60;
export const SHUFFLE_MINUTES = Object.freeze([30, 60, 120, 240, 0]);
// *** REWIND AND FAST FORWARD (Mike, 2026-11-08: "There should be play/pause, stop, fast forward, and rewind buttons on the
// transport bar when the music module is selected. There should also be those buttons on the module."). *** A press jumps
// within the song, 15 seconds by default (the panel's "Rewind and fast forward jump" row). FOR longer: an hour-long radio
// show. AGAINST, and it sets 15: most of what plays here is songs of about three minutes, and a switch user can press again.
// Which players can: music files, the Internet Archive, this panel's own YouTube player and Spotify's own player here. NOT a
// favourite handed to the screen's YouTube panel (it has no seek verb yet) or the Spotify app route on another speaker: for
// those the two buttons are dimmed and say why. Dimmed, never hidden, so they do not move under a switch.
export const SEEK_SECONDS = Object.freeze([5, 10, 15, 30, 60]);
export const SEEK_SECONDS_DEFAULT = 15;
const SEEKS = Object.freeze(['local', 'youtube-here', 'spotify-here']);
export const NEAR_MATCH_MODES = Object.freeze(['ask', 'play', 'off']);
export const YOUTUBE_WHERE = Object.freeze(['panel', 'here']);

export const MESSAGES = Object.freeze({
  ...LOCAL_MESSAGES,
  ...SPOTIFY_MESSAGES,
  ...EMBED_WORDS,
  ...ARCHIVE_MESSAGES,
  'not-found': 'There is no favorite called “{name}”.',
  'did-you-mean': 'Did you mean “{name}”?',
  'no-youtube': 'There is no YouTube panel on this screen to play it in.',
  // (row 2.55, Mike hit this with no way forward) Says where the switch is. The panel shows a "Turn Spotify on"
  // button beside it too.
  'spotify-off': 'Spotify is turned off for this panel. Turn it on in this panel’s settings (the “Spotify” row), '
    + 'or press “Turn Spotify on” here.',
  'bad-source': 'That favorite does not say where its music is.',
  'shuffle-none': 'None of the favorites would play.',
  'shuffle-empty': 'There are no favorites to shuffle yet.',
});
export const messageFor = (reason, name = '', device = '') =>
  String(MESSAGES[reason] || MESSAGES.failed || '').replace(/\{name\}/g, name).replace(/\{device\}/g, device || 'another device');

const routersByBus = new WeakMap();

export function createMusicRouter({
  bus,
  busKey = null,                 // what identifies "this screen" (the root bus); defaults to `bus`
  favourites = () => [],
  local = null,                  // createLocalMusic()
  spotify = null,                // createSpotify(), or null when turned off
  spotifyDevice = () => '',      // the speaker a Spotify favourite plays on when it names none
  // play on (rows 2.61, 2.68): WHERE a Spotify favourite plays. null (the default, and every older caller) is the app
  // route as before; { kind: 'here' } is Spotify's embed on this screen (`spotifyHere`, spotify_embed.js);
  // { kind: 'spotify', device } is the app route on that Spotify speaker ('' = whichever is on).
  spotifyWhere = () => null,
  spotifyHere = () => null,
  ownYoutube = null,             // { play(source), stop(), pause(), resume() } - the panel's own player
  // internet archive (row 2.69): `{ tracks(id) }` -> { ok, tracks } | { ok:false, reason }. null: archive.org itself.
  archive = null,
  youtubeWhere = () => 'panel',
  nearMatch = () => 'ask',
  instanceTopic = (id, topic) => (id ? `${topic}#${id}` : topic),
  onChange = null,
  say = null,                    // (text) => void - to speak a problem out loud; null = silent
  // (row 2.247, note FT 3) "Shuffle all my favourites": `picker` is the shared weighted picker (music_pick.js) over the
  // favourites; `shuffleMinutes()` how long a run lasts (0: until Stop). Timers are the suites' seams.
  picker = null,
  shuffleMinutes = () => SHUFFLE_MINUTES_DEFAULT,
  seekSeconds = () => SEEK_SECONDS_DEFAULT,   // (2026-11-08) how far rewind and fast forward jump
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
} = {}) {
  if (!bus) throw new Error('createMusicRouter: a bus is required');
  const key = busKey || bus;
  const list = routersByBus.get(key) || [];
  routersByBus.set(key, list);
  const me = {};
  list.push(me);
  const leader = () => list[0] === me;

  let current = null;            // { kind: 'youtube-panel'|'youtube-here'|'local'|'spotify', name, instanceId? }
  let lastReason = null;
  let pending = null;            // the "did you mean" entry
  let pendingDevice = null;      // play on: the device a "playing elsewhere" question names (a yes plays anyway)
  let dead = false;
  let seq = 0;
  let run = null;                // (note FT 3) { endsAt|null, timer } while every favourite is being shuffled
  let quiet = false;             // a run is trying a favourite: a failure is passed over, not said
  let pausedNow = false;         // (2026-11-08) somebody paused what is playing: the buttons say Play

  const read = (f, dflt) => { try { const v = typeof f === 'function' ? f() : f; return v ?? dflt; } catch { return dflt; } };

  function status() {
    return { playing: !!current, name: current?.name || null, kind: current?.kind || null,
             reason: lastReason, message: lastReason ? messageFor(lastReason, pending?.name || '', pendingDevice || '') : '',
             asking: pending ? pending.name : null,
             askingWhy: pending ? (pendingDevice != null ? 'elsewhere' : 'near') : null, device: pendingDevice,
             shuffle: run ? { endsAt: run.endsAt } : null,
             paused: !!current && pausedNow, canSeek: !!current && SEEKS.includes(current.kind) };
  }
  function changed() {
    const s = status();
    try { onChange?.(s); } catch (err) { console.error('music: onChange', err); }
    if (leader()) { try { bus.publish(MUSIC_TOPICS.now, s); } catch { /* fine */ } }
  }
  function fail(reason, name = '', { speak = true } = {}) {
    lastReason = reason;
    if (quiet) return { ok: false, reason };   // a run passing over a favourite: said once, by the run, if none play
    changed();
    if (speak && say) { try { say(messageFor(reason, name)); } catch { /* fine */ } }
    return { ok: false, reason };
  }

  async function stopCurrent(except = null) {
    const c = current;
    current = null;
    if (!c || c.kind === except) return;
    try {
      if (c.kind === 'youtube-panel') bus.publish(instanceTopic(c.instanceId, 'youtube/pause'));
      else if (c.kind === 'youtube-here') ownYoutube?.stop?.();
      else if (c.kind === 'local') local?.stop?.();
      else if (c.kind === 'spotify-here') await read(spotifyHere, null)?.stop?.();
      else if (c.kind === 'spotify') {
        // A player that steers its own order (music_spotify.js createSpotifyPlayer) is told it is finished
        // with, not just paused; a bare connector only has pause.
        const sp = read(spotify, null);
        await (typeof sp?.stop === 'function' ? sp.stop() : sp?.pause?.());
      }
    } catch (err) { console.error('music: stop', err); }
  }

  function findYoutubePanel() {
    const here = [];
    const off = bus.subscribe('youtube/here', (p) => { here.push(p && p.instanceId ? p.instanceId : null); });
    try { bus.publish('youtube/who'); } finally { try { off?.(); } catch { /* fine */ } }
    return here.length ? { instanceId: here[0] } : null;
  }

  let lastEntry = null;          // desktop prompt: what `again()` plays
  async function dispatch(entry, { force = false } = {}) {
    const src = entry && entry.source;
    lastEntry = entry || null;
    const my = ++seq;
    pausedNow = false;
    pending = null;
    pendingDevice = null;
    lastReason = null;
    if (!src) return fail('bad-source', entry?.name);
    const sp = read(spotify, null);
    if (src.kind === 'youtube') {
      const payload = src.videoId ? { videoId: src.videoId } : { playlistId: src.playlistId };
      const where = run && ownYoutube ? 'here' : read(youtubeWhere, 'panel');   // a run hears this panel's own player end
      const panel = where === 'panel' ? findYoutubePanel() : null;
      await stopCurrent();
      if (panel) {
        bus.publish(instanceTopic(panel.instanceId, 'youtube/load'), payload);
        current = { kind: 'youtube-panel', instanceId: panel.instanceId, name: entry.name };
      } else if (ownYoutube) {
        ownYoutube.play(src);
        current = { kind: 'youtube-here', name: entry.name };
      } else return fail('no-youtube', entry.name);
      changed();
      return { ok: true, kind: current.kind };
    }
    if (src.kind === 'file' || src.kind === 'folder') {
      if (!local) return fail('no-sources', entry.name);
      await stopCurrent('local');
      const r = src.kind === 'file'
        ? await local.playFile({ sourceId: src.sourceId, path: src.path })
        : await local.playFolder({ sourceId: src.sourceId, album: src.album });
      if (my !== seq || dead) return { ok: false, reason: 'superseded' };
      if (!r.ok) return r.reason === 'superseded' ? r : fail(r.reason, entry.name);
      current = { kind: 'local', name: entry.name };
      changed();
      return { ok: true, kind: 'local' };
    }
    if (src.kind === 'archive') {
      // internet archive (row 2.69): the item's sound files, by address, through the same player as a folder.
      if (!local || typeof local.playTracks !== 'function') return fail('archive-no-audio', entry.name);
      await stopCurrent('local');
      try { local.stop?.(); } catch { /* fine */ }   // as playFolder does: the old song stops while the item is read
      const finder = read(archive, null);
      let found = null;
      try { found = await (finder && typeof finder.tracks === 'function' ? finder.tracks(src.id, src) : archiveAudioTracks(src.id)); }
      catch { found = null; }
      if (my !== seq || dead) return { ok: false, reason: 'superseded' };
      if (!found || !found.ok) return fail((found && found.reason) || 'archive-unreachable', entry.name);
      const r = await local.playTracks({ tracks: found.tracks, what: { kind: 'archive', sourceId: `archive:${src.id}` } });
      if (my !== seq || dead) return { ok: false, reason: 'superseded' };
      if (!r.ok) return r.reason === 'superseded' ? r : fail(r.reason === 'no-audio' ? 'archive-no-audio' : r.reason, entry.name);
      current = { kind: 'local', name: entry.name };
      changed();
      return { ok: true, kind: 'local', from: 'archive' };
    }
    if (src.kind === 'spotify') {
      const where = read(spotifyWhere, null);
      const here = where && where.kind === 'here' ? read(spotifyHere, null) : null;
      if (here) {
        // play on: Spotify's own player in this panel, the way YouTube plays (spotify_embed.js).
        await stopCurrent('spotify-here');
        const r = await here.play({ uri: src.uri, force });
        if (my !== seq || dead) return { ok: false, reason: 'superseded' };
        if (!r.ok) return r.reason === 'playing-elsewhere' ? askElsewhere(entry, r.device) : fail(r.reason, entry.name);
        current = { kind: 'spotify-here', name: entry.name };
        changed();
        return { ok: true, kind: 'spotify-here', order: r.order, note: r.note || '' };
      }
      if (!sp) return fail('spotify-off', entry.name);
      if (!sp.available()) return fail('no-client-id', entry.name);
      await stopCurrent('spotify');
      const dev = String(src.device || (where && where.kind === 'spotify' ? (where.device || '') : (read(spotifyDevice, '') || ''))).trim();
      const r = await sp.play({ uri: src.uri, device: dev, ...(force ? { force: true } : {}) });
      if (my !== seq || dead) return { ok: false, reason: 'superseded' };
      if (!r.ok) return r.reason === 'playing-elsewhere' ? askElsewhere(entry, r.device) : fail(r.reason, entry.name);
      current = { kind: 'spotify', name: entry.name };
      changed();
      return { ok: true, kind: 'spotify', device: r.device, ...(r.order ? { order: r.order, note: r.note || '' } : {}) };
    }
    return fail('bad-source', entry.name);
  }

  // play on (note BK item 4): "Spotify is already playing on <device>. Play this instead?" - asked like a near miss,
  // answered by `music/confirm` ("yes", or the panel's button). Nobody answering leaves both alone: nothing starts.
  function askElsewhere(entry, device) {
    pending = entry;
    pendingDevice = String(device || '');
    lastReason = 'playing-elsewhere';
    changed();
    if (say) { try { say(messageFor('playing-elsewhere', entry.name, pendingDevice)); } catch { /* fine */ } }
    return { ok: false, reason: 'playing-elsewhere', device: pendingDevice };
  }

  // ---- shuffle all my favourites (note FT 3; SHUFFLE_MINUTES_DEFAULT says why it is bounded) ----------------------
  function endRun() {
    if (!run) return;
    if (run.timer != null) { try { clearTimer(run.timer); } catch { /* gone */ } }
    run = null;
  }
  async function shuffleAll() {
    if (dead) return { ok: false, reason: 'gone' };
    endRun();
    const favs = read(favourites, []) || [];
    if (!favs.length) return fail('shuffle-empty');
    const mins = Number(read(shuffleMinutes, SHUFFLE_MINUTES_DEFAULT));
    const ms = Number.isFinite(mins) && mins > 0 ? mins * 60000 : 0;
    const mine = { endsAt: ms ? now() + ms : null, timer: null };
    run = mine;
    if (ms) mine.timer = setTimer(() => { if (run === mine) { run = null; stop(); } }, ms);
    return nextInRun(mine);
  }
  // The next favourite of the run, by the weighted picker; one that will not play is left out and another tried.
  async function nextInRun(mine) {
    const favs = (read(favourites, []) || []).filter((f) => f && f.id);
    const tried = new Set();
    while (run === mine && !dead) {
      const pool = favs.filter((f) => !tried.has(f.id));
      if (!pool.length) break;
      const id = (picker && picker.next(pool.map((f) => ({ id: f.id })))) || pool[Math.floor(Math.random() * pool.length)].id;
      const entry = pool.find((f) => f.id === id) || pool[0];
      tried.add(entry.id);
      quiet = true;
      let r;
      try { r = await dispatch(entry); } finally { quiet = false; }
      if (run !== mine || dead) return r || { ok: false, reason: 'superseded' };
      if (r && r.ok) { try { picker?.played(entry.id); } catch { /* counted in memory */ } return r; }
      if (r && (r.reason === 'playing-elsewhere' || r.reason === 'superseded')) return r;   // asked, or replaced: wait
    }
    if (run !== mine) return { ok: false, reason: 'superseded' };
    endRun();
    return fail('shuffle-none');
  }

  async function play(payload) {
    if (dead) return { ok: false, reason: 'gone' };
    endRun();
    const favs = read(favourites, []) || [];
    const byId = payload && typeof payload === 'object' && payload.id ? favs.find((f) => f.id === payload.id) : null;
    const name = typeof payload === 'string' ? payload : (payload && payload.name) || '';
    if (byId && (!name || byId.name === name)) return dispatch(byId);
    const hit = findFavourite(favs, name);
    if (hit.status === 'exact') return dispatch(hit.entry);
    if (hit.status === 'near') {
      const mode = read(nearMatch, 'ask');
      if (mode === 'play') return dispatch(hit.entry);
      if (mode === 'ask') {
        pending = hit.entry;
        pendingDevice = null;
        lastReason = 'did-you-mean';
        changed();
        if (leader()) { try { bus.publish(MUSIC_TOPICS.didYouMean, { name: hit.entry.name, heard: hit.heard }); } catch { /* fine */ } }
        if (say) { try { say(messageFor('did-you-mean', hit.entry.name)); } catch { /* fine */ } }
        return { ok: false, reason: 'did-you-mean', suggestion: hit.entry.name };
      }
    }
    pending = null;
    pendingDevice = null;
    return fail('not-found', name);
  }

  async function stop() { endRun(); pending = null; pendingDevice = null; lastReason = null; pausedNow = false; ++seq; await stopCurrent(); changed(); return { ok: true }; }
  // Rewind or fast forward: `dir` -1 or 1, by the panel's jump. Refused, with nothing moved, by a player that cannot.
  async function seek(dir) {
    const c = current;
    if (!c || !SEEKS.includes(c.kind)) return { ok: false, reason: 'cannot-seek' };
    const n = Number(read(seekSeconds, SEEK_SECONDS_DEFAULT));
    const sec = (Number.isFinite(n) && n > 0 ? n : SEEK_SECONDS_DEFAULT) * (dir < 0 ? -1 : 1);
    let ok = false;
    try {
      if (c.kind === 'local') ok = local?.seekBy?.(sec);
      else if (c.kind === 'youtube-here') ok = ownYoutube?.seekBy?.(sec);
      else if (c.kind === 'spotify-here') ok = read(spotifyHere, null)?.seekBy?.(sec);
    } catch (err) { console.error('music: seek', err); ok = false; }
    return { ok: !!ok, ...(ok ? { sec } : { reason: 'cannot-seek' }) };
  }
  async function pause() {
    const c = current;
    if (!c) return { ok: false };
    pausedNow = true;
    changed();
    if (c.kind === 'youtube-panel') bus.publish(instanceTopic(c.instanceId, 'youtube/pause'));
    else if (c.kind === 'youtube-here') ownYoutube?.pause?.();
    else if (c.kind === 'local') local?.pause?.();
    else if (c.kind === 'spotify-here') await read(spotifyHere, null)?.pause?.();
    else if (c.kind === 'spotify') await read(spotify, null)?.pause?.();
    return { ok: true };
  }
  async function resume() {
    const c = current;
    // (2026-11-08) Play with nothing playing starts something: what played last, else the first favourite. It used to do
    // nothing, and a Play button that does nothing is the failure this module's buttons exist to prevent.
    if (!c) {
      const first = lastEntry || (read(favourites, []) || [])[0];
      return first ? dispatch(first) : { ok: false, reason: 'nothing-to-play' };
    }
    pausedNow = false;
    changed();
    if (c.kind === 'youtube-panel') bus.publish(instanceTopic(c.instanceId, 'youtube/play'));
    else if (c.kind === 'youtube-here') ownYoutube?.resume?.();
    else if (c.kind === 'local') local?.resume?.();
    else if (c.kind === 'spotify-here') await read(spotifyHere, null)?.resume?.();
    else if (c.kind === 'spotify') await read(spotify, null)?.resume?.();
    return { ok: true };
  }
  async function confirm() {
    if (!pending) return { ok: false, reason: 'nothing-asked' };
    const e = pending;
    const force = pendingDevice != null;   // a yes to "playing elsewhere" plays anyway
    pending = null;
    pendingDevice = null;
    return dispatch(e, { force });
  }

  // The bus half: only the leader acts on a broadcast, so two panels never both start the song.
  const guard = (fn) => (p) => { if (leader() && !dead) Promise.resolve(fn(p)).catch((err) => console.error('music', err)); };
  const offs = [
    bus.subscribe(MUSIC_TOPICS.play, guard(play)),
    bus.subscribe(MUSIC_TOPICS.stop, guard(stop)),
    bus.subscribe(MUSIC_TOPICS.pause, guard(pause)),
    bus.subscribe(MUSIC_TOPICS.resume, guard(resume)),
    bus.subscribe(MUSIC_TOPICS.confirm, guard(confirm)),
    bus.subscribe(MUSIC_TOPICS.shuffle, guard(shuffleAll)),
    bus.subscribe(MUSIC_TOPICS.rewind, guard(() => seek(-1))),
    bus.subscribe(MUSIC_TOPICS.forward, guard(() => seek(1))),
    bus.subscribe(MUSIC_TOPICS.who, () => {
      if (!leader() || dead) return;
      let names = [];
      try { names = (favourites() || []).map((f) => f && f.name).filter(Boolean); } catch { names = []; }
      try { bus.publish(MUSIC_TOPICS.here, { names }); } catch { /* fine */ }
    }),
  ];

  return {
    play, stop, pause, resume, confirm, status, shuffleAll, seek,
    isLeader: leader,
    // desktop prompt (2026-10-10): the favourite last asked for, again - after "Try on this computer" reached its folder.
    again() { return lastEntry ? dispatch(lastEntry) : Promise.resolve({ ok: false, reason: 'nothing-asked' }); },
    // Something outside told us the thing we started has finished (the panel's own player ended).
    // In a run, the next favourite is chosen (note FT 3).
    ended(kind) {
      if (!current || current.kind !== kind) return;
      current = null;
      pausedNow = false;
      if (run) { nextInRun(run).catch((err) => console.error('music: shuffle', err)); return; }
      changed();
    },
    destroy() {
      endRun();
      dead = true;
      for (const off of offs) { try { off?.(); } catch { /* gone */ } }
      const i = list.indexOf(me);
      if (i >= 0) list.splice(i, 1);
      pending = null;
      current = null;
    },
  };
}
