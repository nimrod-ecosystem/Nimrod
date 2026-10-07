// modules/music.js — MUSIC BY NAME: the favourites list, and a place to hear it. Row 2.32.
//
// Mike, 2026-09-30: *"I don't suppose we could make it play certain music or something like you would
// with alexa. I have Alexa, Spotify, Youtube (already a module), probably some others."*
//
// WHAT THIS PANEL IS, AND IS NOT. The favourites are DATA, kept for the person (music_favourites.js),
// and `music/play { name }` is the one verb every way in ends at (music_player.js). This panel is:
//   * the place the family writes the list: a spoken name, and a YouTube link, a Spotify link, or a
//     music file or folder on a connected media source;
//   * a button per favourite, so a switch or a touch starts the same thing a voice does;
//   * where a YouTube favourite plays when there is no YouTube panel on the screen;
//   * the router that answers `music/play` while it is on the screen.
// The spoken half ("computer please play <name>") needs the host to add this list's phrases to the
// speech routes - `musicSpeechRoutes` in music_favourites.js; the kiosk wiring is listed for Mike.
//
// WHERE THE LIST LIVES: per PERSON when the host can say whose screen this is (it then follows them to
// any screen, and a second music panel shows the same list), otherwise in this panel. A music FILE or
// FOLDER favourite only plays on a screen that has that media source connected - a folder picked in
// the browser is kept on that device only (media.js says the same about photos).
//
// A SWITCH REACHES EVERYTHING: next / prev walk every button in reading order and wrap, select presses
// the lit one (the first select only shows the highlight), back closes the list editor. Typing a name
// or a link needs a keyboard, and the editor says so.
//
// DEFAULTS CHOSEN HERE - each a setting, each on Mike's list with its argument:
//   * a near miss ASKS ("Did you mean ...?") rather than playing - input_speech.js's rule;
//   * a YouTube favourite goes to the YouTube panel when there is one, else plays here;
//   * a folder plays shuffled;
//   * a problem is SAID out loud (it answers a spoken request, and silence reads as "broken");
//   * Spotify is OFF, and needs the household's own client ID;
//   * (row 2.55) a Spotify playlist or album is SHUFFLED BY THE SITE'S OWN WEIGHTED PICKER (music_pick.js,
//     YouTube's rng.js weights) - Mike: "I like ours better for it's weights" - and off plays Spotify's order;
//   * (row 2.55) the song-info card (name, artist, cover) is OFF: Mike asked for it as an OPTION ("have
//     options for a song info overlay"), and it does not yet carry the Spotify logo and link back that
//     Spotify's design guidelines ask for (see `songCardHtml`). AGAINST off: once Spotify is steered by the
//     site, the look that feeds it is already being made, so it costs nothing, and a person watching the screen
//     is better off knowing what is playing. Off wins for now on his word and the open attribution question.
//
// SPOTIFY'S SWITCH IS AT THE STANDARD DETAIL LEVEL (row 2.55, moved from advanced 2026-10-07). Mike added a
// Spotify favourite, was told "Spotify is turned off for this panel", and could not find the switch: it sat at
// the highest level, and the form had taken the link without a word. settings_fields.js says what each level is
// for - standard is "what an average user expects", advanced is "sequences, precedence and raw timings" - and a
// switch that says whether a service is used is the first kind, not the second. The client ID moved with it,
// because the switch alone does nothing and every Spotify message points at that row; AGAINST: it is a
// developer's value an average user will not have, and it lengthens the standard menu. It loses because a
// message pointing at a row the menu is not showing is the same dead end again, and the length is answered by
// showing the Spotify rows only while the switch is on (`spotifyIsOn`). The speaker name stays advanced (blank
// already works). The form now says when Spotify is off and has a "Turn Spotify on" button, as
// does the panel next to that message.

import { registerModule } from '../module.js';
import { MUSIC_GROUP, VIDEO_PRIORITY } from '../audio_bus.js';
import { createYtPlayer } from './youtube.js';
import { createMediaSourcesClient } from '../media_sources.js';
import { followPerson, personSources } from '../person_known.js';
import {
  watchFavourites, normalizeFavourites, parseSource, normalizeSource, describeSource, newFavouriteId,
  musicSpeechRoutes, DEFAULT_STARTERS, MAX_NAME,
} from '../music_favourites.js';
import { createLocalMusic, FOLDER_ORDERS } from '../music_local.js';
import { createSpotify, createSpotifyPlayer, SPOTIFY_MESSAGES, callbackUrl } from '../music_spotify.js';
import { createMusicPicker } from '../music_pick.js';
import { spotifyRef, thumbOk, PREVIEW_URL } from '../recommend.js';
import { authHeaders } from '../auth.js';
import { createMusicRouter, NEAR_MATCH_MODES, YOUTUBE_WHERE, messageFor } from '../music_player.js';

export const MUSIC_VOLUME_MIN = 10;

const DEFAULTS = {
  nearMatch: 'ask',
  youtubeWhere: 'panel',
  volume: 100,
  folderOrder: 'shuffle',
  sayProblems: true,
  spotifyOn: false,
  spotifyClientId: '',
  spotifyDevice: '',
  spotifyShuffle: true,
  songInfo: false,
};

// The Spotify rows other than the switch show only while it is on (settings_fields.js `appliesWhen`), so the
// standard menu is one row longer with Spotify off, not five. Their values are kept either way.
const spotifyIsOn = (v) => v?.spotifyOn === true;

export const SETTINGS = [
  { key: 'nearMatch', label: 'When a name is close but not exact', kind: 'choice', default: 'ask',
    level: 'standard',
    options: [
      { value: 'ask', label: 'ask “Did you mean …?”' },
      { value: 'play', label: 'play the close one' },
      { value: 'off', label: 'do nothing' },
    ] },
  { key: 'youtubeWhere', label: 'Where YouTube favourites play', kind: 'choice', default: 'panel',
    level: 'standard',
    options: [
      { value: 'panel', label: 'the YouTube panel, if there is one' },
      { value: 'here', label: 'always in this panel' },
    ] },
  { key: 'volume', label: 'How loud music from this panel is', kind: 'number', default: 100,
    min: MUSIC_VOLUME_MIN, max: 100, step: 10, unit: '%', level: 'standard' },
  { key: 'folderOrder', label: 'A folder of music plays', kind: 'choice', default: 'shuffle',
    level: 'standard',
    options: [
      { value: 'shuffle', label: 'shuffled' },
      { value: 'inorder', label: 'in name order' },
    ] },
  { key: 'sayProblems', label: 'When it cannot play something', kind: 'toggle', default: true,
    level: 'standard', onLabel: 'Say why, out loud', offLabel: 'Show it on the panel only' },
  { key: 'spotifyOn', label: 'Spotify', kind: 'toggle', default: false, level: 'standard',
    onLabel: 'On (needs Spotify Premium)', offLabel: 'Off' },
  { key: 'spotifyClientId', label: 'Your household’s Spotify client ID', kind: 'text', default: '',
    level: 'standard', appliesWhen: spotifyIsOn,
    note: 'Make an app at developer.spotify.com with the account that has Premium, add this site’s '
      + 'Spotify callback address as a redirect URI, and paste the app’s client ID here.' },
  { key: 'spotifyShuffle', label: 'Spotify playlists and albums play', kind: 'toggle', default: true,
    level: 'standard', appliesWhen: spotifyIsOn,
    onLabel: 'Shuffled the way YouTube is (fewer repeats)', offLabel: 'In Spotify’s own order',
    note: 'Shuffling needs Spotify to list the songs, which it does only for playlists you made or share. '
      + 'Others play in Spotify’s own order.' },
  { key: 'songInfo', label: 'While Spotify plays, show', kind: 'toggle', default: false, level: 'standard',
    appliesWhen: spotifyIsOn,
    onLabel: 'The song’s name, artist and picture', offLabel: 'The favourite’s name only' },
  { key: 'spotifyDevice', label: 'Spotify speaker to play on (blank: whichever is on)', kind: 'text',
    default: '', level: 'advanced', appliesWhen: spotifyIsOn },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WHY_SKIPPED = {
  taken: 'is already a command',
  twice: 'is already another favourite',
  digits: 'has numbers in it; write them as words (“top forty”)',
  short: 'is too short to say reliably',
};

registerModule(
  { dependsOn: 'network',
    type: 'music', title: 'Music', description: 'Play a favourite by name: YouTube, your own music files, or Spotify',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, audio = null } = ctx;
    const instanceId = ctx.instanceId || 'music';
    const makePlayer = ctx.playerFactory || createYtPlayer;

    let cfg = { ...DEFAULTS };
    let favs = [];
    let personList = null;         // watchFavourites handle, when the list is kept for the person
    let personFor = null;          // whose list `personList` is
    let offPerson = null;
    let view = 'main';
    let lit = -1;
    let status = { playing: false, name: null, kind: null, reason: null, message: '', asking: null };
    let draft = { name: '', link: '', sourceId: '', kind: 'file', path: '' };
    let editMsg = '';
    let sourcesList = [];
    let spotifyDevices = null;
    let spotifyNote = '';
    let dead = false;
    let rootEl = null;
    let stageEl = null;

    const volume = () => {
      const n = Number(cfg.volume);
      return Number.isFinite(n) ? Math.max(MUSIC_VOLUME_MIN, Math.min(100, n)) / 100 : 1;
    };

    // ---- the list ------------------------------------------------------------------------------
    function adoptList(list) { favs = normalizeFavourites(list); if (!dead) render(); }
    function saveList(next) {
      const clean = normalizeFavourites(next);
      if (personList) personList.set(clean); else { favs = clean; state?.set?.({ favourites: clean }); }
      favs = clean;
      render();
    }
    // WHOSE LIST: the screen's person, followed (person_known.js `followPerson`, 2026-10-02). The person
    // may not be known when this mounts (kiosk.js resolves it in the background); this panel used to look
    // again ten times, 1.5 s apart, and gave up for good after fifteen seconds. Now it draws with the
    // panel's own list, and the screen's one answer -- however late, or never (it then carries on as
    // nobody, after person_known's bounded wait) -- moves it to the person's.
    function usePerson(pid) {
      if (dead) return;
      const want = pid && typeof ctx.makePersonState === 'function' ? pid : null;
      if (want === personFor && (personList || !want)) return;
      try { personList?.destroy(); } catch { /* gone */ }
      personList = null;
      personFor = want;
      if (want) {
        const pl = watchFavourites({ makePersonState: ctx.makePersonState, personId: want, onChange: adoptList });
        if (pl) {
          personList = pl;
          // What was kept in the panel before the person was known moves across once, if theirs is empty.
          const mine = normalizeFavourites(state?.get?.()?.favourites);
          pl.ready.then(() => {
            if (!dead && pl === personList && mine.length && !pl.list().length) pl.set(mine);
          });
          return;
        }
        personFor = null;
      }
      // Nobody's screen (or a host with no per-person state): the panel keeps its own list.
      favs = normalizeFavourites(state?.get?.()?.favourites);
      render();
    }

    // ---- players -------------------------------------------------------------------------------
    // The media sources a music file or folder plays from: WHOEVER THE SCREEN IS FOR, not whoever it was at
    // mount (person_known.js `personSources`: its list waits, bounded, for the answer, and the editor's
    // folder list is re-read if the answer changes after it was made).
    const scopedSources = ctx.sources ? null : (ctx.user !== undefined
      ? personSources(ctx, (pid) => createMediaSourcesClient({ user: ctx.user, personId: pid, cache: true }),
        { onChange: () => { if (!dead && view === 'edit') loadSources(); } })
      : null);
    const sources = ctx.sources || scopedSources;
    const local = createLocalMusic({
      audio, audioId: `music:${instanceId}:local`, sources,
      ...(ctx.makeAudio ? { makeAudio: ctx.makeAudio } : {}),
      ...(ctx.resolveListing ? { resolve: ctx.resolveListing } : {}),
      ...(ctx.resolveItem ? { resolveItem: ctx.resolveItem } : {}),
      volume: volume(), order: 'shuffle',
    });

    let spotify = null;
    let spotifyPlayer = null;
    let spotifySig = '';
    let songNow = null;            // { name, artists, image } while the song-info card has something to show
    // The site's own weighted picker for Spotify (row 2.55): one per panel, its play history in this panel's
    // events, as the YouTube panel keeps its own.
    const picker = createMusicPicker({ events: ctx.events || null });
    const setT = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearT = ctx.clearTimer || ((id) => clearTimeout(id));
    function spotifyFor() {
      if (!cfg.spotifyOn) {
        try { spotifyPlayer?.destroy(); } catch { /* gone */ }
        spotify = null; spotifyPlayer = null; spotifySig = ''; return null;
      }
      const sig = String(cfg.spotifyClientId || '').trim();
      if (!spotify || sig !== spotifySig) {
        spotifySig = sig;
        try { spotifyPlayer?.destroy(); } catch { /* gone */ }
        spotify = (ctx.spotifyFactory || createSpotify)({ clientId: sig, redirectUri: callbackUrl() });
        spotifyPlayer = createSpotifyPlayer({
          spotify, picker, setTimer: setT, clearTimer: clearT,
          shuffle: () => cfg.spotifyShuffle !== false,
          songInfo: () => cfg.songInfo === true,
          onNow: (info) => {
            if (info) songNow = { name: info.name, artists: info.artists || [], image: info.image || '' };
            else if (!status.playing || status.kind !== 'spotify') songNow = null;
            render();
          },
          onEnded: () => { songNow = null; router?.ended('spotify'); },
        });
      }
      return spotify;
    }
    const spotifyPlayerFor = () => (spotifyFor() ? spotifyPlayer : null);

    // THE FIRST MOMENT OF THE SONG-INFO CARD: before Spotify has said which song is playing, the favourite's own
    // name and picture, from Spotify's public oEmbed - asked through this site's server, the recommend preview
    // (server/recommend.py `describe`), which needs no Spotify app or sign-in. Only playlists, albums and songs:
    // the preview takes nothing else. A failure leaves the card on the favourite's name.
    const describeLink = ctx.describeLink || (async (link) => {
      try {
        const res = await fetch(PREVIEW_URL, { method: 'POST', credentials: 'same-origin',
          headers: { ...authHeaders(ctx.user), 'Content-Type': 'application/json' }, body: JSON.stringify({ link }) });
        if (!res.ok) return null;
        const b = await res.json();
        return b && (b.title || b.thumb) ? { title: String(b.title || ''), thumb: String(b.thumb || '') } : null;
      } catch { return null; }
    });
    async function cardFromLink(fav) {
      const ref = spotifyRef(fav?.source?.uri);
      if (!cfg.songInfo || !ref || !['playlist', 'album', 'track'].includes(ref.type)) return;
      const about = await describeLink(`https://open.spotify.com/${ref.type}/${ref.id}`);
      if (dead || !about || songNow || status.kind !== 'spotify' || status.name !== fav.name) return;
      songNow = { name: about.title, artists: [], image: about.thumb, from: 'link' };
      render();
    }

    // The panel's own YouTube player: made the first time a YouTube favourite plays here, and on the
    // audio bus like every other video (music group, video priority, media tier).
    const YT_AUDIO = `music:${instanceId}:youtube`;
    let yt = null;
    let ytList = [];
    let ytAt = -1;
    let ytGain = 1;
    const ytActive = (on) => { try { audio?.setActive?.(YT_AUDIO, on); } catch { /* advice */ } };
    function ytPush() { try { yt?.setGain?.(ytGain * volume()); } catch { /* not ready */ } }
    function ytEnsure() {
      if (yt || !stageEl) return yt;
      yt = makePlayer(stageEl, {
        onPlaylist: (ids) => { ytList = Array.from(new Set(ids || [])); ytAt = 0; if (ytList.length) yt?.load(ytList[0]); },
        onPlaying: () => { ytActive(true); ytPush(); },
        onIdle: () => ytActive(false),
        onEnded: () => ytNext(),
        onError: () => ytNext(),
      });
      try {
        audio?.register?.(YT_AUDIO, { tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY,
          onGain: (l) => { ytGain = Math.max(0, Math.min(1, Number(l) || 0)); ytPush(); } });
      } catch (err) { console.error('music: audio bus', err); }
      return yt;
    }
    function ytNext() {
      if (ytList.length && ytAt < ytList.length - 1) { ytAt += 1; yt?.load(ytList[ytAt]); return; }
      ownYoutube.stop();
      router?.ended('youtube-here');
    }
    const ownYoutube = {
      play(src) {
        if (!ytEnsure()) return;
        stageEl.hidden = false;
        ytList = []; ytAt = -1;
        if (src.videoId) yt.load(src.videoId);
        else if (src.playlistId) yt.cueList?.(src.playlistId);
      },
      stop() { try { yt?.stop?.(); } catch { /* fine */ } ytList = []; ytAt = -1; ytActive(false); if (stageEl) stageEl.hidden = true; },
      pause() { try { yt?.pause?.(); } catch { /* fine */ } ytActive(false); },
      resume() { try { yt?.resume?.(); } catch { /* fine */ } },
    };

    const say = (text) => {
      if (!cfg.sayProblems || !text) return;
      try { ctx.output?.say?.(text, { source: 'music' }); } catch { /* the panel still shows it */ }
    };

    const router = createMusicRouter({
      bus,
      busKey: ctx.rootBus || null,
      favourites: () => favs,
      local,
      spotify: () => spotifyPlayerFor(),
      spotifyDevice: () => cfg.spotifyDevice,
      ownYoutube,
      youtubeWhere: () => (YOUTUBE_WHERE.includes(cfg.youtubeWhere) ? cfg.youtubeWhere : 'panel'),
      nearMatch: () => (NEAR_MATCH_MODES.includes(cfg.nearMatch) ? cfg.nearMatch : 'ask'),
      instanceTopic: (id, topic) => (typeof ctx.rootBus?.instanceTopic === 'function'
        ? ctx.rootBus.instanceTopic(id, topic) : (id ? `${topic}#${id}` : topic)),
      onChange: (s) => {
        const was = status;
        status = s;
        if (!s.playing || s.kind !== 'spotify') songNow = null;
        else if (was.kind !== 'spotify' || was.name !== s.name || !was.playing) {
          songNow = null;
          cardFromLink(favs.find((f) => f.name === s.name));
        }
        render();
      },
      say,
    });

    // ---- the view ------------------------------------------------------------------------------
    const btn = (act, label, extra = '') => `<button type="button" class="mu-btn" data-act="${act}" data-walk${extra}>${esc(label)}</button>`;

    // THE SONG-INFO CARD (row 2.55, the "song info overlay"): the song's name, its artists and its cover, while a
    // Spotify favourite plays and the panel's "While Spotify plays, show" row says so. It is drawn IN this panel,
    // so a music panel put "Over the dashboard" (the Add tray's choice, layout.js) is the overlay - one way to
    // float a panel, not a second one. The picture is drawn only from Spotify's own image hosts (thumbOk), whole
    // and unchanged. NOT YET MET, and part of why the card is off by default: Spotify's design guidelines
    // [developer.spotify.com/documentation/design, read 2026-10-07] ask that its metadata be attributed with
    // Spotify's LOGO and LINK BACK to Spotify. The card says "from Spotify" in words, and has no link (a link that
    // leaves the page is what a locked screen takes away; page_links.js's address-and-code is the likely answer).
    // On Mike's list.
    function songCardHtml() {
      if (!cfg.songInfo || !songNow || !status.playing || status.kind !== 'spotify') return '';
      const img = songNow.image && thumbOk(songNow.image)
        ? `<img class="mu-cover" data-song-cover src="${esc(songNow.image)}" alt="" width="96" height="96">` : '';
      const who = (songNow.artists || []).join(', ');
      return `<div class="mu-song" data-song>${img}<div><p class="mu-song-name" data-song-name>${esc(songNow.name || status.name)}</p>
          ${who ? `<p class="mu-song-who" data-song-who>${esc(who)}</p>` : ''}<p class="mu-hint">from Spotify</p></div></div>`;
    }

    function mainHtml() {
      const now = status.playing ? `Playing: ${status.name}` : 'Nothing playing';
      const msg = status.reason && status.reason !== 'did-you-mean' ? status.message : '';
      const why = status.playing && status.kind === 'spotify' ? (spotifyPlayer?.state().note || '') : '';
      return `
        <p class="mu-now" data-now>${esc(now)}</p>
        ${songCardHtml()}
        ${why ? `<p class="mu-hint" data-order-note role="status">${esc(why)}</p>` : ''}
        ${msg ? `<p class="mu-msg" data-msg role="status">${esc(msg)}</p>` : ''}
        ${status.reason === 'spotify-off' ? `<div class="mu-btns">${btn('spotify-on', 'Turn Spotify on')}</div>` : ''}
        ${status.asking ? `<div class="mu-ask" data-ask><p>${esc(messageFor('did-you-mean', status.asking))}</p>
            <div class="mu-btns">${btn('confirm', 'Yes, play it')}${btn('decline', 'No')}</div></div>` : ''}
        <div class="mu-list" data-list>${favs.length
          ? favs.map((f) => btn('play', f.name, ` data-id="${esc(f.id)}"`)).join('')
          : '<p class="mu-empty">No favourites yet. Add some with “Change the list”.</p>'}</div>
        <div class="mu-btns">${btn('stop', 'Stop')}${btn('edit', 'Change the list')}</div>`;
    }

    const hasSpotifyFav = () => favs.some((f) => f.source?.kind === 'spotify');
    function spotifyHtml() {
      if (!cfg.spotifyOn) {
        // (row 2.55) A Spotify favourite on the list with Spotify off is a favourite that cannot play: say so
        // where the list is changed, with the way to turn it on.
        return hasSpotifyFav() ? `<div class="mu-spot" data-spotify data-spotify-off>
            <p class="mu-head">Spotify</p>
            <p class="mu-hint">Spotify is turned off for this panel, so the Spotify favourites will not play. Turn it on
              here, or with the “Spotify” row in this panel’s settings.</p>
            <div class="mu-btns">${btn('spotify-on', 'Turn Spotify on')}</div></div>` : '';
      }
      const sp = spotifyFor();
      const state = !sp || !sp.available() ? SPOTIFY_MESSAGES['no-client-id']
        : sp.connected() ? 'Spotify is connected on this device.' : 'Spotify is not connected on this device yet.';
      const devices = Array.isArray(spotifyDevices)
        ? (spotifyDevices.length ? `<ul class="mu-devs">${spotifyDevices.map((d) => `<li>${esc(d.name)}${d.active ? ' (playing now)' : ''}</li>`).join('')}</ul>`
          : '<p class="mu-hint">No Spotify speakers are switched on.</p>') : '';
      return `<div class="mu-spot" data-spotify>
          <p class="mu-head">Spotify</p>
          <p class="mu-hint">${esc(state)}</p>
          ${sp && sp.available() ? `<div class="mu-btns">${sp.connected()
            ? btn('spotify-devices', 'Find speakers') + btn('spotify-disconnect', 'Disconnect Spotify')
            : btn('spotify-connect', 'Connect Spotify')}</div>` : ''}
          ${spotifyNote ? `<p class="mu-hint" role="status">${esc(spotifyNote)}</p>` : ''}
          ${devices}
        </div>`;
    }

    function editHtml() {
      const labelOf = (id) => sourcesList.find((s) => s.id === id)?.label || null;
      // The same starters the screen's speech uses (DEFAULT_STARTERS), so the hint is what works.
      const { skipped } = musicSpeechRoutes(favs);
      const firstStarter = DEFAULT_STARTERS[0];
      const rows = favs.map((f) => {
        const bad = skipped.filter((s) => s.name === f.name);
        return `<li><span class="mu-fav"><b>${esc(f.name)}</b> · ${esc(describeSource(f.source, labelOf(f.source.sourceId)))}</span>
          <span class="mu-hint">Say “${esc(firstStarter)} ${esc(f.name.toLowerCase())}” after the wake phrase.${bad.length
            ? ' ' + esc(bad.map((s) => `“${s.phrase || s.name}” ${WHY_SKIPPED[s.why] || ''}`).join('; ')) + '.' : ''}</span>
          ${btn('remove', 'Remove', ` data-id="${esc(f.id)}"`)}</li>`;
      }).join('');
      const opts = sourcesList.map((s) => `<option value="${esc(s.id)}"${s.id === draft.sourceId ? ' selected' : ''}>${esc(s.label || s.id)}</option>`).join('');
      return `
        <p class="mu-head">Favourites</p>
        <p class="mu-hint">Typing needs a keyboard. Each favourite is a name to say and where its music is.</p>
        <label class="mu-field">Name to say <input type="text" data-fav-name maxlength="${MAX_NAME}" value="${esc(draft.name)}" placeholder="the Beatles"></label>
        <label class="mu-field">A YouTube or Spotify link <input type="text" data-fav-link value="${esc(draft.link)}" placeholder="https://…"></label>
        <p class="mu-hint">Or music on a connected folder (set up in Media):</p>
        <div class="mu-row">
          <select data-fav-source aria-label="music folder"><option value="">no folder</option>${opts}</select>
          <select data-fav-kind aria-label="one file or a whole folder">
            <option value="file"${draft.kind === 'file' ? ' selected' : ''}>one file</option>
            <option value="folder"${draft.kind === 'folder' ? ' selected' : ''}>a whole folder</option>
          </select>
          <input type="text" data-fav-path value="${esc(draft.path)}" placeholder="Songs/song.mp3 or Songs" aria-label="file or folder name">
        </div>
        <div class="mu-btns">${btn('add', 'Add this favourite')}</div>
        ${editMsg ? `<p class="mu-msg" role="status">${esc(editMsg)}</p>` : ''}
        <ul class="mu-favs" data-favs>${rows}</ul>
        ${spotifyHtml()}
        <div class="mu-btns">${btn('close', 'Done')}</div>`;
    }

    function render() {
      if (dead || !rootEl) return;
      const had = mount.ownerDocument?.activeElement;
      const focusSel = had && mount.contains(had) && had.matches?.('[data-fav-name],[data-fav-link],[data-fav-path]')
        ? ['[data-fav-name]', '[data-fav-link]', '[data-fav-path]'].find((s) => had.matches(s)) : null;
      rootEl.innerHTML = `<div class="mu" data-music data-view="${view}">${view === 'edit' ? editHtml() : mainHtml()}</div>`;
      if (focusSel) { const el = mount.querySelector(focusSel); el?.focus?.({ preventScroll: true }); }
      paintLit();
    }

    const walk = () => [...mount.querySelectorAll('[data-walk]')].filter((b) => !b.disabled && !b.closest('[hidden]'));
    function paintLit() {
      const list = walk();
      if (lit >= list.length) lit = list.length ? list.length - 1 : -1;
      list.forEach((b, i) => { if (i === lit) { b.dataset.on = '1'; b.setAttribute('aria-current', 'true'); } else { delete b.dataset.on; b.removeAttribute('aria-current'); } });
    }
    function moveLit(d) { const n = walk().length; if (!n) return; lit = lit < 0 ? (d > 0 ? 0 : n - 1) : ((lit + d) % n + n) % n; paintLit(); }
    function selectLit() { const list = walk(); if (!list.length) return; if (lit < 0) { lit = 0; paintLit(); return; } act(list[lit]); }

    // ---- actions -------------------------------------------------------------------------------
    async function loadSources() {
      if (!sources || typeof sources.list !== 'function') { sourcesList = []; return; }
      try { sourcesList = (await sources.list()) || []; } catch { sourcesList = []; }
      if (!dead && view === 'edit') render();
    }

    function addFromDraft() {
      const name = String(draft.name || '').trim();
      if (!name) { editMsg = 'Give it a name to say.'; render(); return; }
      let source = null;
      if (String(draft.link || '').trim()) {
        source = parseSource(draft.link);
        if (!source) { editMsg = 'That is not a YouTube or Spotify link.'; render(); return; }
      } else if (draft.sourceId) {
        source = normalizeSource(draft.kind === 'folder'
          ? { kind: 'folder', sourceId: draft.sourceId, album: draft.path }
          : { kind: 'file', sourceId: draft.sourceId, path: draft.path });
        if (!source) { editMsg = 'Give the name of the music file.'; render(); return; }
      } else { editMsg = 'Paste a link, or pick a music folder.'; render(); return; }
      const before = favs.length;
      const next = normalizeFavourites([...favs, { id: newFavouriteId(), name, source }]);
      if (next.length === before) { editMsg = `There is already a favourite called “${name}”.`; render(); return; }
      draft = { name: '', link: '', sourceId: draft.sourceId, kind: draft.kind, path: '' };
      editMsg = source.kind === 'spotify' && !cfg.spotifyOn
        ? `Added “${name}”. Spotify is turned off for this panel, so it will not play until Spotify is on (below).`
        : `Added “${name}”.`;
      saveList(next);
    }

    async function spotifyAct(what) {
      const sp = spotifyFor();
      if (!sp) return;
      if (what === 'connect') {
        const here = typeof location !== 'undefined' ? `${location.pathname}${location.search}` : '/';
        const r = await sp.beginLogin({ returnTo: here });
        if (!r.ok) { spotifyNote = SPOTIFY_MESSAGES[r.reason] || SPOTIFY_MESSAGES.failed; render(); }
      } else if (what === 'disconnect') {
        sp.disconnect(); spotifyDevices = null; spotifyNote = 'Spotify is disconnected on this device.'; render();
      } else if (what === 'devices') {
        spotifyNote = 'Looking…'; render();
        const r = await sp.devices();
        if (dead) return;
        spotifyDevices = r.ok ? r.devices : null;
        spotifyNote = r.ok ? '' : (SPOTIFY_MESSAGES[r.reason] || SPOTIFY_MESSAGES.failed);
        render();
      }
    }

    function act(b) {
      const a = b?.dataset?.act;
      if (!a) return;
      if (a === 'play') { router.play({ id: b.dataset.id, name: favs.find((f) => f.id === b.dataset.id)?.name }); return; }
      if (a === 'stop') { router.stop(); return; }
      if (a === 'confirm') { router.confirm(); return; }
      if (a === 'decline') { router.stop(); return; }
      if (a === 'edit') { view = 'edit'; lit = -1; editMsg = ''; render(); loadSources(); return; }
      if (a === 'close') { view = 'main'; lit = -1; render(); return; }
      if (a === 'add') { addFromDraft(); return; }
      if (a === 'remove') { saveList(favs.filter((f) => f.id !== b.dataset.id)); return; }
      if (a === 'spotify-on') {
        // The same value the settings menu's "Spotify" row writes. Then the panel says what is still missing
        // (the household's client ID) where the switch was.
        state?.set?.({ spotifyOn: true });
        cfg = { ...cfg, spotifyOn: true };
        if (status.reason === 'spotify-off') status = { ...status, reason: null, message: '' };
        if (view === 'main') { view = 'edit'; lit = -1; loadSources(); }
        editMsg = '';
        render();
        return;
      }
      if (a.startsWith('spotify-')) { spotifyAct(a.slice(8)); }
    }

    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      if (b && mount.contains(b)) act(b);
    }
    function onInput(e) {
      const t = e.target;
      if (t.matches?.('[data-fav-name]')) draft.name = t.value;
      else if (t.matches?.('[data-fav-link]')) draft.link = t.value;
      else if (t.matches?.('[data-fav-path]')) draft.path = t.value;
      else if (t.matches?.('[data-fav-source]')) draft.sourceId = t.value;
      else if (t.matches?.('[data-fav-kind]')) draft.kind = t.value === 'folder' ? 'folder' : 'file';
    }
    function onKey(e) {
      if (view !== 'edit') return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); view = 'main'; render(); return; }
      if (e.key === 'Enter' && e.target.matches?.('[data-fav-name],[data-fav-link],[data-fav-path]')) { e.preventDefault(); addFromDraft(); }
    }

    function applyCfg(s) {
      const snap = s || {};
      const next = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (snap[k] !== undefined) next[k] = snap[k];
      cfg = next;
      local.setVolume(volume());
      local.setOrder(FOLDER_ORDERS.includes(cfg.folderOrder) ? cfg.folderOrder : 'shuffle');
      ytPush();
      if (!personList) favs = normalizeFavourites(snap.favourites);
    }

    return {
      __probe: () => ({ view, lit, favs: favs.map((f) => ({ ...f })), status: { ...status }, cfg: { ...cfg },
        local: local.state(), leader: router.isLeader(), personList: !!personList,
        litAct: lit >= 0 ? walk()[lit]?.dataset.act : null, hasYt: !!yt }),
      router,
      init() {
        let cssHref = '';
        try { cssHref = new URL('../music.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-music-css href="${esc(cssHref)}">` : ''}`
          + '<div class="mu-wrap"><div class="mu-stage" data-stage hidden></div><div class="mu-root" data-music-root></div></div>';
        // One delegated listener per event, on the mount: every button carries `data-act`.
        mount.addEventListener('click', onClick);
        mount.addEventListener('input', onInput);
        mount.addEventListener('change', onInput);
        mount.addEventListener('keydown', onKey);
        stageEl = mount.querySelector('[data-stage]');
        rootEl = mount.querySelector('[data-music-root]');
        applyCfg(state?.get?.());
        state?.subscribe?.((s) => { applyCfg(s); render(); });
        bus.subscribe('music/next', () => moveLit(1));
        bus.subscribe('music/prev', () => moveLit(-1));
        bus.subscribe('music/select', () => selectLit());
        bus.subscribe('music/back', () => { if (view !== 'main') { view = 'main'; lit = -1; render(); } });
        offPerson = followPerson(ctx, usePerson);
        render();
      },
      onResize() {},
      onHide() { try { state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        try { offPerson?.(); } catch { /* gone */ }
        offPerson = null;
        try { scopedSources?.dispose(); } catch { /* gone */ }
        mount.removeEventListener('click', onClick);
        mount.removeEventListener('input', onInput);
        mount.removeEventListener('change', onInput);
        mount.removeEventListener('keydown', onKey);
        try { router.destroy(); } catch { /* gone */ }
        try { spotifyPlayer?.destroy(); } catch { /* gone */ }
        try { picker.destroy(); } catch { /* gone */ }
        try { local.destroy(); } catch { /* gone */ }
        try { ytActive(false); audio?.unregister?.(YT_AUDIO); } catch { /* gone */ }
        try { yt?.destroy?.(); } catch { /* gone */ }
        yt = null;
        try { personList?.destroy(); } catch { /* gone */ }
        personList = null;
      },
    };
  },
);
