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

export const MUSIC_TOPICS = Object.freeze({
  play: MUSIC_PLAY_TOPIC, stop: MUSIC_STOP_TOPIC, pause: 'music/pause', resume: 'music/resume',
  confirm: 'music/confirm', now: 'music/now', didYouMean: 'music/did-you-mean',
});
export const NEAR_MATCH_MODES = Object.freeze(['ask', 'play', 'off']);
export const YOUTUBE_WHERE = Object.freeze(['panel', 'here']);

export const MESSAGES = Object.freeze({
  ...LOCAL_MESSAGES,
  ...SPOTIFY_MESSAGES,
  ...EMBED_WORDS,
  'not-found': 'There is no favourite called “{name}”.',
  'did-you-mean': 'Did you mean “{name}”?',
  'no-youtube': 'There is no YouTube panel on this screen to play it in.',
  // (row 2.55, Mike hit this with no way forward) Says where the switch is. The panel shows a "Turn Spotify on"
  // button beside it too.
  'spotify-off': 'Spotify is turned off for this panel. Switch it on in this panel’s settings (the “Spotify” row), '
    + 'or press “Turn Spotify on” here.',
  'bad-source': 'That favourite does not say where its music is.',
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
  youtubeWhere = () => 'panel',
  nearMatch = () => 'ask',
  instanceTopic = (id, topic) => (id ? `${topic}#${id}` : topic),
  onChange = null,
  say = null,                    // (text) => void - to speak a problem out loud; null = silent
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

  const read = (f, dflt) => { try { const v = typeof f === 'function' ? f() : f; return v ?? dflt; } catch { return dflt; } };

  function status() {
    return { playing: !!current, name: current?.name || null, kind: current?.kind || null,
             reason: lastReason, message: lastReason ? messageFor(lastReason, pending?.name || '', pendingDevice || '') : '',
             asking: pending ? pending.name : null,
             askingWhy: pending ? (pendingDevice != null ? 'elsewhere' : 'near') : null, device: pendingDevice };
  }
  function changed() {
    const s = status();
    try { onChange?.(s); } catch (err) { console.error('music: onChange', err); }
    if (leader()) { try { bus.publish(MUSIC_TOPICS.now, s); } catch { /* fine */ } }
  }
  function fail(reason, name = '', { speak = true } = {}) {
    lastReason = reason;
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

  async function dispatch(entry, { force = false } = {}) {
    const src = entry && entry.source;
    const my = ++seq;
    pending = null;
    pendingDevice = null;
    lastReason = null;
    if (!src) return fail('bad-source', entry?.name);
    const sp = read(spotify, null);
    if (src.kind === 'youtube') {
      const payload = src.videoId ? { videoId: src.videoId } : { playlistId: src.playlistId };
      const where = read(youtubeWhere, 'panel');
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

  async function play(payload) {
    if (dead) return { ok: false, reason: 'gone' };
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

  async function stop() { pending = null; pendingDevice = null; lastReason = null; ++seq; await stopCurrent(); changed(); return { ok: true }; }
  async function pause() {
    const c = current;
    if (!c) return { ok: false };
    if (c.kind === 'youtube-panel') bus.publish(instanceTopic(c.instanceId, 'youtube/pause'));
    else if (c.kind === 'youtube-here') ownYoutube?.pause?.();
    else if (c.kind === 'local') local?.pause?.();
    else if (c.kind === 'spotify-here') await read(spotifyHere, null)?.pause?.();
    else if (c.kind === 'spotify') await read(spotify, null)?.pause?.();
    return { ok: true };
  }
  async function resume() {
    const c = current;
    if (!c) return { ok: false };
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
  ];

  return {
    play, stop, pause, resume, confirm, status,
    isLeader: leader,
    // Something outside told us the thing we started has finished (the panel's own player ended).
    ended(kind) { if (current && current.kind === kind) { current = null; changed(); } },
    destroy() {
      dead = true;
      for (const off of offs) { try { off?.(); } catch { /* gone */ } }
      const i = list.indexOf(me);
      if (i >= 0) list.splice(i, 1);
      pending = null;
      current = null;
    },
  };
}
