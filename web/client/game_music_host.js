// game_music_host.js — A GAME'S MUSIC, ONE WAY FOR EVERY GAME: the settings rows, where the music comes from, and the
// player (game_music.js), lifted out of Wait and Go so Brick drop, Brick breaker and Stack line have the same. Row 2.107.
//
// Mike, 2026-10-18: *"None of the games have music. I have some sample music made in Suno, I could put into a folder
// wherever. It would be nice to also be able to use your own game music or just have youtube or Spotify running headless
// for music as you play."* The games did have music: a synthesised bed, very quiet by design ("a BED. Loud ambient is not
// ambient", game_music.js), which is why it read as none. And only Wait and Go could play a folder.
//
// WHAT A GAME'S "Music" ROW OFFERS NOW:
//   'mine'     YOUR MUSIC (the new default): the Music folder of this device's Nimrod folder (user_folders.js; row 2.49's
//              tree), connected as a folder source with no prompt when it reads now (folder_source.js connectFolderFor,
//              the same way Photos takes Pictures), and played shuffled. Nothing there (no Nimrod folder, an empty Music
//              folder, one needing "Allow it again"): the quiet hum, and the panel says why (game_music.js `note`).
//              So: put the Suno files in Nimrod/Music, and every game plays them.
//   'folder'   FROM A FOLDER OF MUSIC: any connected source and one of its folders ("Music from", "Music folder"), for
//              music kept anywhere else ("a folder wherever").
//   'ambient'  A QUIET HUM: the synthesised bed, as before.
//   'off'      No music.
// DEFAULT 'mine', argued. FOR 'ambient' (as it was): needs nothing, never fails. AGAINST, and it decides it: Mike's
// complaint IS that the default is not music, and 'mine' falls back to exactly the hum when there is no music to play,
// so nobody is worse off. A saved choice stays what it was. [Guess, on Mike's list.]
//   'favourite' A MUSIC FAVOURITE (step 2, 2026-10-18): one of the favourites of the screen's Music panel - a Spotify
//              playlist, a YouTube video, a folder, an Internet Archive item - played by that panel (music_player.js, over
//              the bus: music/play by name, then music/pause and music/resume with the game, music/stop at the end), so
//              Spotify and YouTube play while somebody plays, with nothing of the game's own on top. Mike, on Code's
//              "use the screen's Music panel": "Doesn't the music panel have Spotify?" It does; that is why. No Music
//              panel on the screen (it answers music/who), or no favourite chosen: your music, as 'mine' does.

import { createGameMusic } from './game_music.js';
import { createMediaSourcesClient, albumField, createAlbumChooser, topFoldersLister } from './media_sources.js';
import { personSources } from './person_known.js';

export const GAME_MUSIC_MODES = Object.freeze(['mine', 'folder', 'favourite', 'ambient', 'off']);
export const MUSIC_WHO = 'music/who';
export const MUSIC_HERE = 'music/here';
/** The screen's Music panel, if one answers now: { names } (its favourites' names), else null. Synchronous: the
 *  answer comes back on the same bus during the publish (music_player.js). */
export function musicPanelHere(bus) {
  if (!bus || typeof bus.publish !== 'function' || typeof bus.subscribe !== 'function') return null;
  let got = null;
  const off = bus.subscribe(MUSIC_HERE, (p) => { if (!got) got = { names: Array.isArray(p?.names) ? p.names.slice() : [] }; });
  try { bus.publish(MUSIC_WHO); } catch { /* nobody */ } finally { try { off?.(); } catch { /* gone */ } }
  return got;
}
export const GAME_MUSIC_DEFAULT = 'mine';

/** The game's music rows. `level` for the Music row; the others follow it. `volumes`: the loudness choices. */
export function gameMusicFields({ level = 'standard', volumes = null, defaultVolume = 0.3 } = {}) {
  return [
    { key: 'music', label: 'Music', kind: 'choice', default: GAME_MUSIC_DEFAULT, level,
      options: [
        { value: 'mine', label: 'Your music (the Music folder in your Nimrod folder)' },
        { value: 'folder', label: 'From a folder of music you choose' },
        { value: 'favourite', label: 'A Music favorite (Spotify, YouTube, ...), played by this screen’s Music panel' },
        { value: 'ambient', label: 'A quiet hum: needs nothing' },
        { value: 'off', label: 'No music' },
      ],
      note: 'Your music: put music files in the Music folder of your Nimrod folder. With none there, a quiet hum plays.' },
    // "Music from": this account's media sources, live (`settingsChoices`).
    { key: 'musicSourceId', label: 'Music from', kind: 'choice', default: '', level: 'standard',
      emptyLabel: 'No source connected', appliesWhen: (v) => (v?.music || GAME_MUSIC_DEFAULT) === 'folder' },
    { ...albumField({ key: 'musicAlbum', label: 'Music folder', level: 'standard' }),
      appliesWhen: (v) => (v?.music || GAME_MUSIC_DEFAULT) === 'folder' },
    // The favourites of the screen's Music panel, live (`settingsChoices`): its names, as it answers music/who.
    { key: 'musicFavourite', label: 'Which favorite', kind: 'choice', default: '', level: 'standard',
      emptyLabel: 'No Music panel on this screen', appliesWhen: (v) => (v?.music || GAME_MUSIC_DEFAULT) === 'favourite',
      note: 'Played by this screen’s Music panel while the game is played. With no Music panel, your music plays instead.' },
    { key: 'musicVolume', label: 'How loud the music is', kind: 'choice', default: defaultVolume, level: 'standard',
      appliesWhen: (v) => (v?.music || GAME_MUSIC_DEFAULT) !== 'off',
      options: volumes || [{ value: 0.15, label: 'Very quiet' }, { value: 0.3, label: 'Quiet' }, { value: 0.55, label: 'Louder' }] },
  ];
}

/** The Music folder of this device's Nimrod folder, as a folder source id, or '' (none, or not readable now). Never prompts. */
export async function nimrodMusicSource({ uf = null, fs = null } = {}) {
  try {
    const u = uf || await import('./user_folders.js');
    const k = await u.kindFolder('music');
    if (!k || !k.dir) return '';
    const f = fs || await import('./folder_source.js');
    const have = await f.findFolderSource(k.dir);
    const src = have || await f.addFolderSource(k.dir, k.dir.name || 'Music');
    return src && src.id ? String(src.id) : '';
  } catch { return ''; }
}

/**
 * One game's music. `cfg()` the game's settings now. Returns:
 *   music               the game_music.js player (start, stop, setSink, ...), for the game's play/pause code
 *   apply(cfg, was)     the settings changed: volume at once; where it comes from when that changed
 *   settingsChoices()   the live "Music from" and "Music folder" choices
 *   destroy()
 * `ctx`: the panel's (sources, user, resolveListing, checkFromHere are read). Seams: `make`, `findMine`.
 */
export function createGameMusicHost(ctx = {}, { audio = null, audioId = 'game-music', cfg = () => ({}), make = createGameMusic,
  findMine = nimrodMusicSource } = {}) {
  let dead = false;
  let knownSources = [];
  let mineId = '';
  const offs = [];
  const albumChooser = createAlbumChooser({ listTop: topFoldersLister({ resolve: ctx.resolveListing || null, check: ctx.checkFromHere || null }) });
  // WHOSE MUSIC FOLDERS: whoever the screen is for, once it knows (person_known.js), as Wait and Go has done since 2026-10-02.
  const scoped = (!ctx.sources && ctx.user) ? personSources(ctx, (pid) => createMediaSourcesClient({ user: ctx.user, personId: pid }),
    { onChange: () => { refreshSources(); const c = cfg(); if (c.music === 'folder' || c.music === 'mine' || !c.music) place(c); } }) : null;
  if (scoped) offs.push(() => scoped.dispose());
  const sources = ctx.sources || scoped;
  function refreshSources() {
    if (!sources || typeof sources.list !== 'function') return;
    Promise.resolve().then(() => sources.list())
      .then((all) => { if (!dead) knownSources = Array.isArray(all) ? all.filter((s) => s && s.id) : []; }, () => {});
  }
  refreshSources();
  const music = make({
    sources,
    ...(ctx.resolveListing ? { resolve: ctx.resolveListing } : {}),
    onListing: (source, album, listing, err) => {
      if (listing) albumChooser.heard(source, album, listing);
      else if (err && err.code === 'album') albumChooser.heard(source, album, null);
    },
    volume: Number(cfg().musicVolume) || 0.3,
    audio,
    audioId,
  });
  const modeOf = (c) => (GAME_MUSIC_MODES.includes(c?.music) ? c.music : GAME_MUSIC_DEFAULT);
  let placing = 0;
  let played = false;          // the music has been asked to play at least once (a game somebody is playing)
  let borrowed = false;        // 'favourite': the screen's Music panel is playing for this game now
  const bus = ctx.bus || null;
  const publish = (topic, p) => { try { bus?.publish?.(topic, p); } catch (err) { console.error('game music: the Music panel', err); } };
  function giveBack() { if (borrowed) { borrowed = false; publish('music/stop', {}); } }
  async function place(c) {
    const mode = modeOf(c);
    const mine = ++placing;
    if (mode !== 'favourite') giveBack();
    if (mode === 'off') { music.off?.(); return; }
    if (mode === 'ambient') { music.useAmbient?.(); return; }
    if (mode === 'folder') { music.useFolder?.(c.musicSourceId, c.musicAlbum)?.catch?.(() => {}); return; }
    // 'favourite': nothing of the game's own while the Music panel plays; until then (and without one), 'mine'.
    // 'mine': the hum at once, the Nimrod folder's Music when it is found (a game never waits on a folder). The folder is
    // looked for only once the music is first asked to play: a game panel nobody plays never touches the folder (and a
    // page that comes and goes - a suite's frame, a dashboard switched past - never starts a lookup it then abandons).
    if (!mineId) {
      music.useAmbient?.();
      if (!played) return;
      mineId = await findMine();
    }
    if (dead || mine !== placing) return;
    if (mineId) { music.useFolder?.(mineId, '')?.catch?.(() => {}); refreshSources(); }
    else music.useAmbient?.();
  }
  // 'favourite' asks the screen's Music panel to play; anything else (or no panel, or no favourite): the game's own player.
  const wantFavourite = () => { const c = cfg(); return modeOf(c) === 'favourite' && c.musicFavourite ? String(c.musicFavourite) : ''; };
  const rawPlay = typeof music.play === 'function' ? music.play.bind(music) : null;
  const rawPause = typeof music.pause === 'function' ? music.pause.bind(music) : null;
  if (rawPlay) {
    music.play = (...a) => {
      const first = !played;
      played = true;
      const name = wantFavourite();
      if (name) {
        if (borrowed) { publish('music/resume', {}); return undefined; }
        const here = musicPanelHere(bus);
        if (here && here.names.includes(name)) { rawPause?.(); borrowed = true; publish('music/play', { name }); return undefined; }
      }
      const r = rawPlay(...a);
      if (first && (modeOf(cfg()) === 'mine' || modeOf(cfg()) === 'favourite') && !mineId) place({ ...cfg(), music: 'mine' });
      return r;
    };
  }
  if (rawPause) {
    music.pause = (...a) => { if (borrowed) publish('music/pause', {}); return rawPause(...a); };
  }
  place(cfg());
  return {
    music,
    apply(c, was = {}) {
      music.setVolume?.(Number(c.musicVolume) || 0.3);
      if (modeOf(c) !== modeOf(was) || c.musicSourceId !== was.musicSourceId || c.musicAlbum !== was.musicAlbum) place(c);
      // Another favourite chosen while the Music panel plays this game's: that one, at once.
      else if (borrowed && c.musicFavourite && c.musicFavourite !== was.musicFavourite) publish('music/play', { name: String(c.musicFavourite) });
    },
    settingsChoices() {
      const c = cfg();
      const here = musicPanelHere(bus);
      const favs = here ? here.names.map((n) => ({ value: n, label: n })) : [];
      if (c.musicFavourite && !favs.some((o) => o.value === c.musicFavourite)) favs.push({ value: c.musicFavourite, label: `${c.musicFavourite} (not on this screen’s Music panel)` });
      const opts = knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id }));
      const want = c.musicSourceId;
      // A chosen source that is not here stays on the list, last (photos.js, same reason: one press repairs it).
      if (want && !opts.some((o) => o.value === want)) opts.push({ value: want, label: 'A source — not connected here' });
      const folder = want ? albumChooser.row(want, c.musicAlbum)
        : { options: [{ value: '', label: 'The whole source' }], note: 'choose where the music is from first' };
      return { musicSourceId: opts, musicAlbum: folder, musicFavourite: favs };
    },
    state: () => ({ mode: modeOf(cfg()), mineId, borrowed }),
    /** The sources "Music from" lists, as last read. */
    sources: () => knownSources.slice(),
    destroy() { giveBack(); dead = true; for (const f of offs) { try { f(); } catch { /* gone */ } } try { music.destroy?.(); } catch { /* gone */ } },
  };
}
