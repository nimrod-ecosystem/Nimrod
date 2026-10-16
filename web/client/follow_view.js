// follow_view.js — WATCH ALONG: play what somebody's screen is playing, here, at the same moment.
//
// The follower's page for the mirroring plan's first step (row 2.79, play_sync.js has the whole argument). It sits
// on the Remote page under the person picked there (remote.js), because the people who may follow a screen are the
// people who may drive it, and that page is where they already pick whose screen.
//
// WHAT IT DOES: opens its OWN drive socket marked "follow" (so the screen counts it as watching, not helping, and the
// server lets it do nothing but watch), hears the screen's `play` messages, and steers a YouTube player of its own
// to the same video and second. THE SOUND (the hear half, 2026-10-12): it used to start MUTED (the plan: two speakers
// in one room a fraction of a second apart sound like an echo). Now "Sound here" on this page decides, remembered on
// this computer: by default ON, but OFF while this computer is on a call with that screen, because the call already
// carries the screen's sound and two copies are an echo (follow_sound.js argues both). The Sound button still turns
// it on or off for this visit.
//
// THE PERSON AT THE SCREEN IS TOLD. The screen shows "Sharing your screen with <name>" for as long as this is open
// (kiosk.js, play_sync.js noticeWords). So following is an explicit act here: a button, never started by opening the
// page, never remembered.
//
// WHO MAY (Mike, 2026-10-12; server/screen_access.py): only people on the screen's "Who may see this screen" list,
// and by default the screen ASKS first. The server says which (`follow-state`): seeing, asking (the page says so and
// waits), or refused - not on the list, "Not now" on the screen, nobody answered, or a permission lent on a call
// ended. A refusal stops following here and closes the socket, so nothing is left connected to their screen.
//
// WHEN THE SCREEN GOES QUIET this never goes blank: the player carries on with what it had, the page says the screen
// stopped sending, and after "Stop following by itself after" (a choice on this page, a minute by default,
// play_sync.js argues it) it stops following, which also takes the notice off their screen.
//
// PHOTOS IN STEP (2026-10-12): the same page follows a screen's Photos panel too. The screen sends an opaque id; this
// page finds the picture in ITS OWN picture sources (photo_follow.js: listed quietly, never a local-network prompt) and
// shows it in a box of its own, or says plainly that it isn't here and keeps following. One player stands in for both
// (`composite`): it shows the video or the picture, whichever the screen is sharing, and creates the YouTube player
// only when a video first arrives - a page following pictures never loads YouTube at all.

import { connectDrive } from './drive.js';
import {
  createClock, createFollower, STOP_AFTER_CHOICES, STOP_AFTER_KEY, stopAfterOf,
} from './play_sync.js';
import { createPhotoIndex, createPhotoStage, PHOTO_LINES } from './photo_follow.js';
import {
  FOLLOW_SOUND_CHOICES, FOLLOW_SOUND_KEY, soundModeOf, followMuted, watchLocalCalls,
} from './follow_sound.js';

// How often the follower looks at its player and the screen's last message. Half a second: well inside the 2 s
// seek line, cheap (no network - it reads the player and does arithmetic). Not a person's setting.
export const TICK_MS = 500;
// Pings when following starts (the clock difference needs a few to find a quick round trip), then one every
// PING_EVERY_MS. Five, 250 ms apart: the first picture is not waiting long on them.
export const FIRST_PINGS = 5;
export const PING_EVERY_MS = 30000;
// *** IF THE BROWSER WILL NOT PLAY WITH SOUND, FALL BACK TO MUTED AFTER 8 SECONDS AND SAY SO. *** A press on Follow lets
// this page play sound, but the YouTube player is made a moment later inside its own frame, and a browser may still
// refuse to start it with sound - and then it would sit there, not playing, which is the stuck screen the follow page
// must never be. So: with sound on, if the screen is playing and this player has not started for this long, it turns
// the sound off (a muted video always may play), carries on, and says "press Sound on" (a press, which the browser
// then allows). 8 s, argued: a YouTube load here starts in 1-2 s and the first one also loads the player's own code;
// buffering counts as playing, so a slow line does not trip it. Shorter would mute people on a slow first load. Not a
// person's setting; a seam for the suites.
export const SOUND_BLOCKED_MS = 8000;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
.fv{margin-top:18px}
.fv-stage{position:relative;width:100%;max-width:640px;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;margin:8px 0}
.fv-stage iframe,.fv-stage>div{position:absolute;inset:0;width:100%;height:100%;border:0}
.fv-line{font-weight:700;margin:6px 0 2px}
.fv-status{margin:0 0 6px;color:var(--text-soft,#3c5346)}
.fv-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
.fv-row .h-btn,.fv button{min-height:44px}
.fv-screens{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}
.fv-screens button[aria-pressed="true"]{font-weight:700}
.fv label{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.fv select{min-height:44px}
.fv button:focus-visible,.fv select:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:2px}
.fv [hidden]{display:none}
`;

function ensureStyle(doc) {
  if (!doc || doc.getElementById('follow-view-style')) return;
  const s = doc.createElement('style');
  s.id = 'follow-view-style';
  s.textContent = CSS;
  doc.head.append(s);
}

function readStopAfter(storage) {
  try { return stopAfterOf(storage?.getItem(STOP_AFTER_KEY)); } catch { return stopAfterOf(null); }
}
function readSoundMode(storage) {
  try { return soundModeOf(storage?.getItem(FOLLOW_SOUND_KEY)); } catch { return soundModeOf(null); }
}

// The default player: the same YouTube player the panels use, muted or not as this page's sound says when it is made
// (the hear half: made with sound, rather than made muted and unmuted later, which a browser may treat as sound that
// started by itself). Imported when first needed so the Remote page does not load the YouTube module until somebody
// follows.
async function defaultPlayer(stageEl, { muted = true } = {}) {
  const { createYtPlayer } = await import('./modules/youtube.js');
  return createYtPlayer(stageEl, {}, { muted: muted !== false });
}

// photos in step: the pictures this page may look in - this computer's own sources (its registry, the followed
// person's own sources and the account-wide ones), listed quietly with every folder inside, less this computer's hidden
// and removed pictures. Imported when the first picture arrives, so a page following videos loads none of it.
// HIDDEN_WAIT_MS 1.5 s: photos.js's own wait for the hidden list before a first picture (a store that never answers must
// not hold the picture back for good).
const HIDDEN_WAIT_MS = 1500;
async function defaultPhotoIndex({ user, personId }) {
  const ms = await import('./media_sources.js');
  const { deviceHiddenPictures } = await import('./hidden_pictures.js');
  const { deviceRemovedPictures } = await import('./removed_pictures.js');
  const client = ms.createMediaSourcesClient({ user, cache: true });
  const lister = ms.quietResolve((s, album) => ms.resolveListing(s, album, { deep: true }));
  const hides = deviceHiddenPictures();
  const removals = deviceRemovedPictures();
  await new Promise((resolve) => {
    Promise.all([hides.ready, removals.ready]).then(resolve, resolve);
    setTimeout(resolve, HIDDEN_WAIT_MS);
  });
  const index = createPhotoIndex({
    listSources: async () => ((await client.list()) || []).filter((s) => ms.mayShowSource(s, personId || null)),
    resolve: (s) => lister(s, ''),
    hidden: () => {
      const out = new Set();
      try { for (const p of hides.paths(personId || '')) out.add(p); } catch { /* none */ }
      try { for (const p of removals.paths('')) out.add(p); } catch { /* none */ }
      return out;
    },
  });
  const onHiddenChange = (fn) => {
    const a = hides.subscribe(fn);
    const b = removals.subscribe(fn);
    return () => { try { a?.(); } catch { /* gone */ } try { b?.(); } catch { /* gone */ } };
  };
  return { index, onHiddenChange };
}

export function mountFollowView(root, {
  personId = '',
  personName = '',
  user = null,
  connect = connectDrive,
  makePlayer = defaultPlayer,          // (stageEl, { muted }) => player | Promise<player>: load/seek/play/pause/item/currentTime/playing/setMuted/destroy
  // photos in step: ({ user, personId }) => { index, onHiddenChange } | Promise<...> (photo_follow.js createPhotoIndex)
  makePhotoIndex = defaultPhotoIndex,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  storage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })(),
  // the hear half: whether this computer is on a call with that screen (follow_sound.js watchLocalCalls). A seam.
  callWatch = null,
  soundBlockedMs = SOUND_BLOCKED_MS,
} = {}) {
  ensureStyle(root.ownerDocument || document);
  const ownCalls = !callWatch;
  const calls = callWatch || (() => { try { return watchLocalCalls(); } catch { return null; } })();
  let link = null, player = null, follower = null, clock = null;
  let composite = null;                 // photos in step: the one player for a video or a picture (`makeComposite`)
  let tickTimer = null, pingTimer = null;
  let phase = 'idle';                   // idle | on | stopped
  let connState = 'offline';
  let muted = true;
  // the hear half (follow_sound.js): "Sound here", the Sound button's choice this visit (null: none - the setting
  // decides), whether the browser refused sound (SOUND_BLOCKED_MS), and the call state last seen.
  let soundMode = readSoundMode(storage);
  let override = null;
  let soundBlocked = false;
  let notPlayingSince = null;
  let lastInCall = false;
  let stopAfterMs = readStopAfter(storage);
  let stoppedWhy = '';
  let access = '';                      // the server's word on this follow (2026-10-12): '' | on | asking
  let askSeconds = null;
  let torn = false;
  let gen = 0;                          // a Stop / Start pair must not let an old player's promise land in the new one

  const who = personName ? `${personName}’s screen` : 'their screen';

  root.innerHTML = `
    <section class="fv r-grants" data-follow-view aria-labelledby="fv-h">
      <h2 class="r-h2" id="fv-h">Watch along</h2>
      <p class="h-hint">Play what ${esc(who)} is playing, here, at the same moment. It works for YouTube, and for
        pictures and personal videos that are in your own folders here too (a shared Google Drive folder, say): they
        are shown from your copy. You need to be on “Who may see this screen” for their screens. Usually the screen asks first, and it
        starts only if somebody there says yes. Their screen shows “Sharing your screen with” your name while you
        follow.</p>
      <div class="fv-row" data-fv-idle>
        <button type="button" class="h-btn h-primary" data-fv-start>Follow what ${esc(who)} is playing</button>
      </div>
      <div data-fv-on hidden>
        <p class="fv-line" data-fv-line></p>
        <p class="fv-status" data-fv-status role="status" aria-live="polite"></p>
        <div class="fv-screens" data-fv-screens></div>
        <div class="fv-stage" data-fv-stage></div>
        <div data-fv-photo hidden></div>
        <div class="fv-row">
          <button type="button" class="h-btn" data-fv-sound>Sound on</button>
          <button type="button" class="h-btn h-danger" data-fv-stop>Stop</button>
        </div>
        <p class="fv-status" data-fv-soundnote hidden></p>
      </div>
      <label>Sound here
        <select data-fv-soundmode>${FOLLOW_SOUND_CHOICES.map((c) => `<option value="${c.value}"${c.value === soundMode ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      </label>
      <label>Stop following by itself if their screen goes quiet for
        <select data-fv-stopafter>${STOP_AFTER_CHOICES.map((c) => `<option value="${c.ms}"${c.ms === stopAfterMs ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      </label>
    </section>`;
  const el = (sel) => root.querySelector(sel);

  function statusWords() {
    if (phase === 'stopped') return stoppedWhy;
    if (connState !== 'connected') return connState === 'connecting' ? 'Connecting…' : 'Not connected. Trying again…';
    if (access === 'asking') {
      return `Asking ${who} first. Somebody there has ${askSeconds || 30} seconds to say yes. If nobody does, it does `
        + 'not start.';
    }
    const st = follower ? follower.status() : 'waiting';
    if (st === 'waiting') {
      return 'Waiting for their screen. It shares what it plays only if that is turned on in its settings, and only '
        + 'while it is on.';
    }
    const L = follower.leader();
    const photo = L && L.kind === 'photo';
    const found = L && (L.kind === 'photo' || L.kind === 'personal');   // found here by its id (row 2.79: personal too)
    if (st === 'lost') {
      return photo ? 'Their screen has stopped sending. The last picture stays here.'
        : 'Their screen has stopped sending. The video carries on here by itself.';
    }
    if (!L || L.item === null) return photo ? PHOTO_LINES.nothing : 'Their screen is not playing a video right now.';
    // photos in step: a picture is "the same picture" or the plain words about why it isn't shown (never a blank).
    if (found && composite && !composite.photoShownIsClip()) {
      const words = composite.photoWords();
      if (words) return words;
      return L.playing ? 'Showing the same picture.' : 'Paused on the same picture.';
    }
    const gap = follower.gap();
    const where = L.playing ? 'Playing' : 'Paused';
    return gap === null ? `${where}. Catching up…` : `${where}. ${Math.abs(gap) < 0.05 ? 'In step' : `About ${Math.abs(gap).toFixed(1)} s apart`}.`;
  }

  function lineWords() {
    const L = follower?.leader();
    const name = L && L.screen ? ` (${L.screen})` : '';
    return `Following ${who}${name}`;
  }

  function renderScreens() {
    const host = el('[data-fv-screens]');
    const list = follower ? follower.screens() : [];
    if (list.length < 2) { host.innerHTML = ''; return; }
    const pinned = follower.pinned();
    host.innerHTML = list.map((s, i) => `<button type="button" class="h-btn p-small" data-fv-pick="${esc(s.from)}"
      aria-pressed="${s.from === pinned}">Screen ${i + 1}${s.screen ? ` (${esc(s.screen)})` : ''}</button>`).join('');
  }

  function render() {
    el('[data-fv-idle]').hidden = phase === 'on';
    el('[data-fv-on]').hidden = phase === 'idle';
    el('[data-fv-start]').textContent = phase === 'stopped' ? 'Follow again' : `Follow what ${who} is playing`;
    el('[data-fv-line]').textContent = phase === 'stopped' ? `Not following ${who}` : lineWords();
    el('[data-fv-status]').textContent = statusWords();
    el('[data-fv-sound]').textContent = muted ? 'Sound on' : 'Sound off';
    // Sound is a video's: a picture has none, and a clip in a slideshow plays muted on the screen too.
    const video = !!(composite && ((composite.hasVideo() && composite.shownKind() === 'youtube') || composite.personalShown()));
    el('[data-fv-sound]').hidden = !video;
    const note = soundNote();
    el('[data-fv-soundnote]').textContent = note;
    el('[data-fv-soundnote]').hidden = !(video && note);
    renderScreens();
  }

  // ---- the hear half (follow_sound.js) ----------------------------------------------------------------------------
  const inCall = () => { try { return !!calls?.inCallWith?.(personId); } catch { return false; } };
  // Why the sound is as it is, when that is not obvious from the button: the browser refused it, or a call carries it.
  function soundNote() {
    if (soundBlocked && muted) return 'The browser kept the sound off here. Press Sound on to hear it.';
    if (muted && override === null && soundModeOf(soundMode) === 'auto' && inCall()) {
      return `Sound is off here while you are on a call with ${who}: you hear it through the call, with the voices.`;
    }
    return '';
  }
  // Enact whatever the setting, the call and the button now say. Safe to call often.
  function applySound() {
    const m = followMuted({ mode: soundMode, inCall: inCall(), override });
    if (m === muted) return false;
    muted = m;
    try { player?.setMuted?.(muted); } catch { /* not ready */ }
    return true;
  }
  // A call with that screen starting or ending puts the setting back in charge (a Sound press from before the call
  // does not carry into it: the safe answer for a call is the setting's, and the button is one press away).
  function checkCall() {
    const now = inCall();
    if (now === lastInCall) return false;
    lastInCall = now;
    override = null;
    soundBlocked = false;
    return applySound() || true;
  }
  // SOUND_BLOCKED_MS: the screen is playing, sound is on here, and this player has not started.
  function checkBlocked() {
    const L = follower?.leader?.();
    const stuck = !muted && phase === 'on' && !!(composite && composite.hasVideo() && composite.shownKind() === 'youtube')
      && !!(L && L.playing && follower.status() === 'following') && !(() => { try { return !!player?.playing?.(); } catch { return false; } })();
    if (!stuck) { notPlayingSince = null; return; }
    const t = now();
    if (notPlayingSince === null) { notPlayingSince = t; return; }
    if (t - notPlayingSince < soundBlockedMs) return;
    notPlayingSince = null;
    soundBlocked = true;
    override = true;
    applySound();
  }
  const offCalls = (() => { try { return calls?.onChange?.(() => { if (!torn && checkCall()) render(); }) || null; } catch { return null; } })();

  function dropLink() {
    if (tickTimer != null) { clearTimer(tickTimer); tickTimer = null; }
    if (pingTimer != null) { clearTimer(pingTimer); pingTimer = null; }
    try { link?.close(); } catch { /* already gone */ }
    link = null;
    connState = 'offline';
  }

  function dropPlayer() {
    try { player?.destroy?.(); } catch { /* already gone */ }
    player = null;
    composite = null;
    const stage = el('[data-fv-stage]');
    if (stage) stage.innerHTML = '';
    const ph = el('[data-fv-photo]');
    if (ph) { ph.innerHTML = ''; ph.hidden = true; }
  }

  // *** ONE PLAYER FOR A VIDEO OR A PICTURE (photos in step). *** createFollower drives `load` with the kind; this shows
  // the YouTube player for a video and the photo box for a picture, and hides the other. The YouTube player is made on
  // the first video (makePlayer may be synchronous - the suites' - or a promise: a load asked for meanwhile is kept and
  // applied when it is ready); the photo box and its index on the first picture.
  function makeComposite() {
    let yt = null, ytWant = null, ytMaking = false;
    let ph = null, idx = null;
    let shown = null;                 // 'youtube' | 'photo' | null
    let dead = false;                 // destroyed (Stop): a player still being made is thrown away when it lands
    const ytStage = () => el('[data-fv-stage]');
    const phStage = () => el('[data-fv-photo]');
    function show(kind) {
      shown = kind;
      const a = ytStage(), b = phStage();
      if (a) a.hidden = kind === 'photo';
      if (b) b.hidden = kind !== 'photo';
    }
    function haveYt(p) {
      yt = p || null;
      ytMaking = false;
      if (!yt) return;
      try { yt.setMuted?.(muted); } catch { /* not ready */ }
      if (ytWant && shown === 'youtube') { const w = ytWant; ytWant = null; try { yt.load(w.id, w.to, w.play); } catch (err) { console.error('follow: load', err); } }
      render();
    }
    function ensureYt() {
      if (yt || ytMaking) return;
      ytMaking = true;
      let r;
      try { r = makePlayer(ytStage(), { muted }); } catch (err) { console.error('follow: player', err); ytMaking = false; return; }
      if (r && typeof r.then === 'function') {
        r.then((p) => { if (torn || dead) { try { p?.destroy?.(); } catch { /* gone */ } return; } haveYt(p); })
          .catch((err) => { console.error('follow: player', err); ytMaking = false; });
      } else haveYt(r);
    }
    function ensurePhoto() {
      if (ph) return;
      const made = (async () => {
        try { return await makePhotoIndex({ user, personId }); } catch (err) { console.error('follow: pictures', err); return null; }
      })();
      idx = { find: async (id, salt) => { const m = await made; return m && m.index ? m.index.find(id, salt) : { status: 'none' }; } };
      let off = null;
      const onHiddenChange = (fn) => { made.then((m) => { if (m && typeof m.onHiddenChange === 'function' && !torn) off = m.onHiddenChange(fn); }); return () => { try { off?.(); } catch { /* gone */ } }; };
      ph = createPhotoStage(phStage(), { index: idx, onHiddenChange, onChange: () => { if (!torn) render(); }, mutedNow: () => muted });
    }
    const cur = () => (shown === 'youtube' ? yt : shown === 'photo' ? ph : null);
    return {
      load(id, to, play, kind = 'youtube', leader = null) {
        // A picture, or (row 2.79) a Personal videos clip: both are found in this page's own sources, by their id.
        if (kind === 'photo' || kind === 'personal') {
          if (shown === 'youtube') { try { yt?.pause?.(); } catch { /* not ready */ } }
          ensurePhoto();
          show('photo');
          ph.load(id, to, play, kind, leader);
          return;
        }
        if (shown === 'photo') { try { ph?.pause(); } catch { /* gone */ } }
        show('youtube');
        if (yt) { yt.load(id, to, play); return; }
        ytWant = { id, to, play };
        ensureYt();
      },
      seek(to, play) { cur()?.seek?.(to, play); },
      // The YouTube player has no play(); resume() is its "carry on" (this page used to call play() on it, which threw
      // inside the follower's try and did nothing - found while adding pictures, 2026-10-12).
      play() { const p = cur(); if (!p) return; if (typeof p.play === 'function') p.play(); else p.resume?.(); },
      pause() { cur()?.pause?.(); },
      item() {
        if (shown === 'youtube') return yt ? yt.item() : (ytWant ? ytWant.id : null);
        if (shown === 'photo') return ph ? ph.item() : null;
        return null;
      },
      currentTime() { const p = cur(); return p ? p.currentTime() : null; },
      playing() { const p = cur(); return p ? !!p.playing() : false; },
      setMuted(m) { try { yt?.setMuted?.(m); } catch { /* not ready */ } try { ph?.setMuted?.(m); } catch { /* gone */ } },
      // (row 2.79) a Personal videos clip is on the stage: it has sound, so the Sound button applies.
      personalShown: () => !!(ph && shown === 'photo' && ph.kind() === 'personal' && ph.status() === 'found'),
      hasVideo: () => !!yt,
      shownKind: () => shown,
      photoWords: () => (ph ? ph.words() : ''),
      photoShownIsClip: () => !!(ph && ph.status() === 'found' && ph.shown() && ph.shown().kind === 'video'),
      photoStatus: () => (ph ? ph.status() : 'idle'),
      destroy() {
        dead = true;
        try { yt?.destroy?.(); } catch { /* gone */ }
        try { ph?.destroy(); } catch { /* gone */ }
        yt = null; ph = null; ytWant = null;
      },
    };
  }

  function pingSoon(n) {
    if (!link || torn) return;
    Promise.resolve(link.ping?.()).then((s) => { if (s && clock) clock.sample(s); }).catch(() => {});
    pingTimer = setTimer(() => { pingTimer = null; pingSoon(n > 1 ? n - 1 : 0); }, n > 1 ? 250 : PING_EVERY_MS);
  }

  function tick() {
    tickTimer = null;
    if (torn || phase !== 'on') return;
    try { follower?.tick(); } catch (err) { console.error('follow: tick', err); }
    // the hear half: a call tab gone quiet counts as ended (follow_sound.js CALL_STALE_MS), and a player the browser
    // would not start with sound falls back to muted (SOUND_BLOCKED_MS).
    try { checkCall(); checkBlocked(); } catch (err) { console.error('follow: sound', err); }
    // STOPS BY ITSELF when the screen has been quiet past the page's setting (0 = keep waiting). The player is left
    // as it is - never blank - and the socket closes, which takes "watching along" off their screen.
    if (stopAfterMs > 0 && follower && follower.leader() && follower.quietMs() > stopAfterMs) {
      const choice = STOP_AFTER_CHOICES.find((c) => c.ms === stopAfterMs);
      stoppedWhy = `Stopped following: ${who} sent nothing for ${choice ? choice.label : 'a while'}.`;
      phase = 'stopped';
      dropLink();
      render();
      return;
    }
    render();
    tickTimer = setTimer(tick, TICK_MS);
  }

  async function start() {
    if (torn || phase === 'on' || !personId) return;
    const my = ++gen;
    dropLink();
    phase = 'on';
    stoppedWhy = '';
    clock = createClock();
    if (!player) {
      // A new follow starts from "Sound here" (and whether a call with that screen is on): a press on Follow is what
      // lets the browser play sound, so the sound may start with it. A Sound press from an earlier follow is forgotten.
      override = null;
      soundBlocked = false;
      notPlayingSince = null;
      lastInCall = inCall();
      muted = followMuted({ mode: soundMode, inCall: lastInCall, override });
      composite = makeComposite();
      player = composite;
    }
    if (torn || my !== gen) return;
    follower = createFollower({ player, clock, now });
    link = connect({
      personId, user, role: 'driver', follow: true,
      onState: (s) => { connState = s; if (s === 'connected') pingSoon(FIRST_PINGS); render(); },
      onPresence: () => {},
    });
    // A message from the followed screen is acted on AT ONCE, not at the next half-second look (photos in step,
    // 2026-10-12: measured, two headless windows on this desktop, a new picture reached the follower a median 223 ms
    // after the screen showed it, almost all of it waiting for the next look; acting on arrival takes that out).
    link.onPlay?.((m) => {
      if (!follower?.onPlay(m) || phase !== 'on') return;
      try { follower.tick(); } catch (err) { console.error('follow: tick', err); }
      render();
    });
    access = '';
    askSeconds = null;
    link.onFollowState?.((st) => { if (my === gen) onAccess(st); });
    render();
    tickTimer = setTimer(tick, TICK_MS);
  }

  // The server's answer (who may see, 2026-10-12). A refusal stops following and closes the socket; the player is
  // left as it is (never blank) and "Follow again" asks afresh.
  const REFUSED = {
    'not-allowed': () => `You are not on “Who may see this screen” for ${who}. Whoever looks after their screen can add you on its Remote page.`,
    declined: () => `${who[0].toUpperCase()}${who.slice(1)} said not now.`,
    unanswered: () => `Nobody answered on ${who}, so it did not start.`,
    ended: () => `Your permission to see ${who} has ended.`,
  };
  function onAccess(st) {
    if (!st || phase !== 'on') return;
    if (st.state === 'asking') { access = 'asking'; askSeconds = st.seconds || null; render(); return; }
    if (st.state === 'on') { access = 'on'; render(); return; }
    if (st.state === 'refused') {
      stoppedWhy = (REFUSED[st.reason] || (() => `${who[0].toUpperCase()}${who.slice(1)} is not shared with you right now.`))();
      phase = 'stopped';
      access = '';
      dropLink();
      render();
    }
  }

  function stop() {
    gen += 1;
    dropLink();
    dropPlayer();
    follower = null;
    phase = 'idle';
    render();
  }

  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-fv-start]')) { start(); return; }
    if (t.closest('[data-fv-stop]')) { stop(); return; }
    if (t.closest('[data-fv-sound]')) {
      // This visit's choice, over the setting, until a call with that screen starts or ends (checkCall).
      override = !muted;
      soundBlocked = false;
      notPlayingSince = null;
      applySound();
      render();
      return;
    }
    const pick = t.closest('[data-fv-pick]');
    if (pick && follower) { follower.pick(pick.dataset.fvPick); render(); }
  });
  root.addEventListener('change', (e) => {
    if (e.target instanceof Element && e.target.matches('[data-fv-soundmode]')) {
      soundMode = soundModeOf(e.target.value);
      try { storage?.setItem(FOLLOW_SOUND_KEY, soundMode); } catch { /* a private window: this visit only */ }
      override = null;
      soundBlocked = false;
      applySound();
      render();
      return;
    }
    if (!(e.target instanceof Element) || !e.target.matches('[data-fv-stopafter]')) return;
    stopAfterMs = stopAfterOf(e.target.value);
    try { storage?.setItem(STOP_AFTER_KEY, String(stopAfterMs)); } catch { /* a private window: this visit only */ }
  });

  render();

  return {
    start, stop,
    phase: () => phase,
    access: () => access,
    status: () => statusWords(),
    line: () => el('[data-fv-line]').textContent,
    follower: () => follower,
    player: () => player,
    link: () => link,
    muted: () => muted,
    stopAfterMs: () => stopAfterMs,
    // the hear half, for the suites: "Sound here", the note beside the button, and whether a call with that screen is on.
    soundMode: () => soundMode,
    soundNote: () => soundNote(),
    inCall: () => inCall(),
    destroy() {
      torn = true;
      gen += 1;
      dropLink();
      dropPlayer();
      try { offCalls?.(); } catch { /* gone */ }
      if (ownCalls) { try { calls?.destroy?.(); } catch { /* gone */ } }
      root.innerHTML = '';
    },
  };
}
