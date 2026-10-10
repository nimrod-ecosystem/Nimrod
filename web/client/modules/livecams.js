// modules/livecams.js — LIVE NATURE CAMS (explore.org), AS A PANEL. Row 2.69.
//
// After the Internet Archive, chat: "Explore.org next (the list's own top pick)". docs/from_chat/embed_candidates.md,
// Tier 2: "Live animal cams ... Ambient, endless, needs no interaction and rewards any it gets." What Explore allows
// and what was measured before building is in explore_cams.js's header. The short of it: Explore's cams ARE YouTube
// live streams, its terms allow embedding, and its own pages cannot be read from a browser. SO THIS PANEL PLAYS THEM
// THROUGH THE YOUTUBE PLAYER THE SITE ALREADY HAS (youtube.js `createYtPlayer`), and is its own small panel rather than
// a mode of the YouTube panel: that one is a shuffled playlist of videos that END (its picker weighs lengths, its
// watchdog moves on at the end), and a live cam never ends, needs a name, and can be "off" - none of which that panel
// has a place for. Two panels, one player.
//
// WHAT IT DOES: a short list of cams, in order, each with a plain name ("Elephants, South Africa"). It shows one, moves
// to the next every so often (a setting), and the list is the person's: add (one press from the suggestions, or paste
// an address), remove, move up and down. A starting list is there before anybody changes anything (explore_cams.js
// STARTER_CAMS) - a default, replaced the moment the list is changed.
//
// *** A CAM THAT IS OFF IS SKIPPED, IN WORDS, NEVER LEFT AS A BLACK BOX. *** Night, out of season, a stream that
// stopped, an address that moved: YouTube's player says none of these in a way a page can read reliably, so the panel
// gives each cam `startWaitMs` (20 s) to start playing. While it waits the panel SAYS whom it is looking in on. If it
// does not start - or it stops (ended, or buffering for that long) - the cam is skipped with a sentence ("Brown bears,
// Alaska is not on right now. It may be night there, or out of season."), left alone for `restMs` (an hour), and the
// next cam is tried. All of them off: the panel says so, with Try again, and tries again by itself when the first
// cam's rest is over. No state here needs an input to leave it (CLAUDE.md):
//   * a cam that will not start      -> the next one, after startWaitMs;
//   * every cam off                  -> tried again by itself (the earliest rest; a minute if YouTube is unreachable);
//   * somebody pressed Pause         -> by default it STAYS paused, as a YouTube video does (Code, 2026-10-10: Mike's
//     ruling is the recorded one, so it is the default; the helper's case for carrying on is below and on his list).
//     `pausedResumeMs` offers 15 minutes, 1 hour or 6 hours for anyone who wants it to carry on by itself.
//     The helper's recommendation was an hour:
//     AGAINST: Mike ruled that a paused YouTube VIDEO stays paused (youtube.js, 2026-08-30: an auto-resume during a visit
//     interrupts the family). For a cam the cost is smaller - nothing is lost by carrying on, it is live, and with the
//     sound off by default it carries on silently - and a frozen picture all night is the thing the rule is about. A
//     choice for Mike either way (his list);
//   * somebody clicked into the video (the YouTube frame took the keyboard) -> the keys come back by themselves after
//     `keysBackMs` (a minute), as the Archive panel's do, so a switch is not left typing into YouTube.
//
// *** THE SOUND IS OFF UNTIL SOMEBODY TURNS IT ON. *** embed_candidates.md: "No autoplay-with-sound surprise." A river,
// a kennel of puppies, a shark tank's pumps: the "The cams' own sound" row turns it on. Off, a browser always lets a
// video start by itself, and the panel stays OFF the audio bus (it makes no sound, so it never takes the music slot).
// On, it joins the bus like a YouTube video (music group, VIDEO priority, media tier): a spoken prompt ducks it, a call
// silences it, and it carries on. A browser that will not start a video WITH sound until somebody presses: the cam is
// tried once more silently before it is called off, and the panel says "Playing without sound... Press Play for sound."
//
// *** WHAT IS KEPT: THE LIST, AND NOTHING ELSE. *** `cams`: each cam's name and its YouTube address, as text. Not which
// cam is showing, not what was watched, not the titles YouTube gives. The video comes straight from YouTube (its
// youtube-nocookie player, as the YouTube panel's). A name is looked up from YouTube's public oEmbed only when somebody
// pastes an address and leaves the name blank: one request with that address, no cookies, no referrer.
//
// DEFAULTS CHOSEN HERE, each a setting (Rule 1), each listed for Mike with its argument:
//   * the six-cam starting list (explore_cams.js);
//   * it starts by itself (autostart, as every media panel);
//   * the next cam every 30 minutes (`rotateMs`): long enough to settle into, short enough that a cam gone dark at
//     night does not stay all evening; "never" keeps one cam;
//   * 20 seconds to start (`startWaitMs`, the YouTube panel's own stallMs and its argument: facility wifi);
//   * a cam found off is left for an hour (`restMs`) before it is tried again;
//   * sound off; a pause stays paused (carrying on later is a choice); the keyboard back after a minute (above).
// NOT BUILT, said rather than implied: reading explore.org's list of what is live right now (its pages cannot be read
// from a browser and nothing goes to this site's server); telling a live picture from a recording; "best time to watch"
// per cam; trying it on the bench Pi.
// MEASURED 2026-10-10 in real Chrome against real YouTube: the elephants played (muted, through createYtPlayer); a video
// id that does not exist gave error 150 in about 2 s; and Brooks Falls, which explore.org marks OFFLINE out of season,
// PLAYED - Explore keeps the stream running and fills it with highlights (explore.org labels it "Highlights"). So a
// seasonal Explore cam is usually not "off" to this panel; it shows the highlights as if live. Only a stream that really
// stops, errors or never starts is skipped. Telling the two apart needs explore.org's own list, which cannot be read here.

import { registerModule } from '../module.js';
import { MUSIC_GROUP, VIDEO_PRIORITY } from '../audio_bus.js';
import { createYtPlayer } from './youtube.js';
import { autostartFields, shouldAutostart, panelAlone, createPlayReporter } from '../game_start.js';
import { SOURCE_RECHECK_MS } from '../media_sources.js';
import {
  parseCamRef, parseCamList, camListText, lookupCam, camWords, SUGGESTED_CAMS, STARTER_TEXT, CAMS_MAX,
} from '../explore_cams.js';

export const TYPE = 'livecams';
export const VOLUME_MIN = 10;
const MIN = 60 * 1000;
export const ROTATE_MS = 30 * MIN;
export const START_WAIT_MS = 20 * 1000;
export const REST_MS = 60 * MIN;
export const PAUSED_RESUME_MS = 0;   // 0 = it stays paused (Mike's YouTube ruling, 2026-08-30); see the header
export const KEYS_BACK_MS = 60 * 1000;

export const DEFAULTS = Object.freeze({
  cams: STARTER_TEXT,
  autostart: true,
  autostartAlone: 'same',
  rotateMs: ROTATE_MS,
  sound: false,
  volume: 100,
  startWaitMs: START_WAIT_MS,
  restMs: REST_MS,
  pausedResumeMs: PAUSED_RESUME_MS,
  keysBackMs: KEYS_BACK_MS,
});

export const SETTINGS = [
  { key: 'cams', label: 'The cams, in order', kind: 'text', default: STARTER_TEXT, level: 'standard',
    placeholder: 'Name | youtu.be/…',
    note: 'Each cam is a name, a bar ( | ), and its YouTube address. Put a semicolon ( ; ) between cams. “Change the '
      + 'list” on the panel does the same with buttons, and has more cams to add with one press.' },
  ...autostartFields({ on: true }),
  { key: 'rotateMs', label: 'Change to the next cam every', kind: 'choice', default: ROTATE_MS, level: 'standard',
    options: [
      { value: 10 * MIN, label: '10 minutes' },
      { value: 30 * MIN, label: '30 minutes' },
      { value: 60 * MIN, label: 'hour' },
      { value: 120 * MIN, label: '2 hours' },
      { value: 0, label: 'Never (stay on one cam)' },
    ] },
  { key: 'sound', label: 'The cams’ own sound', kind: 'toggle', default: false, level: 'standard',
    onLabel: 'On', offLabel: 'Off (pictures only)',
    note: 'Off, nothing is heard and the cams never interrupt music. On, they are turned down for a spoken prompt and '
      + 'stopped for a call, like a video.' },
  // ESSENTIAL (the one row on a patient screen): how loud it is is the one thing somebody at the bedside may need to change.
  { key: 'volume', label: 'How loud the cams are (when the sound is on)', kind: 'number', default: 100,
    min: VOLUME_MIN, max: 100, step: 10, unit: '%', level: 'essential' },
  { key: 'pausedResumeMs', label: 'If someone pauses it, carry on after', kind: 'choice', default: PAUSED_RESUME_MS,
    level: 'standard',
    options: [
      { value: 15 * MIN, label: '15 minutes' },
      { value: 60 * MIN, label: '1 hour' },
      { value: 6 * 60 * MIN, label: '6 hours' },
      { value: 0, label: 'Never (it stays paused)' },
    ] },
  { key: 'startWaitMs', label: 'If a cam doesn’t start, try the next one after', kind: 'choice', default: START_WAIT_MS,
    level: 'advanced',
    options: [
      { value: 10 * 1000, label: '10 seconds' },
      { value: 20 * 1000, label: '20 seconds' },
      { value: 30 * 1000, label: '30 seconds' },
      { value: 60 * 1000, label: '1 minute' },
    ],
    note: 'A cam is off at night, out of season, or when its stream stops. Slow internet needs longer.' },
  { key: 'restMs', label: 'A cam that was off is tried again after', kind: 'choice', default: REST_MS, level: 'advanced',
    options: [
      { value: 15 * MIN, label: '15 minutes' },
      { value: 60 * MIN, label: '1 hour' },
      { value: 3 * 60 * MIN, label: '3 hours' },
    ] },
  { key: 'keysBackMs', label: 'Give the keyboard back after', kind: 'choice', default: KEYS_BACK_MS, level: 'advanced',
    options: [
      { value: 30 * 1000, label: '30 seconds' },
      { value: 60 * 1000, label: '1 minute' },
      { value: 5 * MIN, label: '5 minutes' },
      { value: 0, label: 'Never (press “Give the keys back”)' },
    ],
    note: 'Pressing on the video gives YouTube the keyboard. A switch then types into it, not into this screen. This is '
      + 'how long until the screen takes the keyboard back by itself.' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE_ID = 'livecams-style';
const CSS = `
.lc{position:absolute;inset:0;display:grid;grid-template-rows:auto 1fr auto;background:var(--bg);color:var(--text);
  font-family:var(--font);overflow:hidden}
.lc-head{padding:.45em .8em .2em}
.lc-name{display:block;font-size:1.3em;font-weight:700;line-height:1.2}
.lc-sub{font-size:.85em;color:var(--text-soft)}
.lc-stage{position:relative;min-height:0;background:#000}
.lc-stage > div, .lc-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.lc-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6em;
  padding:1em;text-align:center;background:var(--bg);color:var(--text);font-size:1.15em;z-index:2}
.lc-over[hidden]{display:none}
.lc-over .lc-skip{font-size:.85em;color:var(--text-soft);max-width:34em}
.lc-body{padding:.3em .8em .5em}
.lc-btns{display:flex;flex-wrap:wrap;gap:.4em;margin:.3em 0}
.lc-btn{font:inherit;padding:.35em .9em;border-radius:.5em;border:2px solid var(--border);background:var(--surface,var(--bg));
  color:var(--text);cursor:pointer}
.lc-btn:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:2px}
.lc-msg{margin:.3em 0;font-size:.92em}
.lc-hint{margin:.2em 0;font-size:.85em;color:var(--text-soft)}
.lc-edit{position:absolute;inset:0;overflow:auto;background:var(--bg);color:var(--text);padding:.6em .8em;z-index:3}
.lc-edit[hidden]{display:none}
.lc-edit h3{font-size:1em;margin:.6em 0 .2em}
.lc-edit input{font:inherit;padding:.3em .5em;min-width:min(16em,100%);border:2px solid var(--border);border-radius:.4em;
  background:var(--surface,var(--bg));color:var(--text)}
.lc-edit input:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:2px}
.lc-list{list-style:none;margin:.3em 0;padding:0}
.lc-list li{display:flex;flex-wrap:wrap;align-items:center;gap:.4em;padding:.2em 0}
.lc-list li b{min-width:12em}
`;

registerModule(
  { type: TYPE, title: 'Live nature cams', core: 'new',
    description: 'Live animal cams from explore.org: elephants, birds, puppies, kittens, an aquarium. One at a time, '
      + 'with a plain name; a cam that is off is skipped.',
    // Everything comes from YouTube: without the network there is nothing to show, so it is never a fallback.
    dependsOn: 'network', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const instanceId = ctx.instanceId || TYPE;
    const AUDIO_ID = `livecams:${instanceId}`;
    // Seams for the suites: no network, no real player, no real clock.
    const makePlayer = typeof ctx.playerFactory === 'function' ? ctx.playerFactory : createYtPlayer;
    const lookupOpts = typeof ctx.camFetch === 'function' ? { fetchImpl: ctx.camFetch } : {};
    const setT = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearT = ctx.clearTimer || ((id) => clearTimeout(id));
    const now = typeof ctx.nowMs === 'function' ? ctx.nowMs : () => Date.now();
    const audio = () => ctx.audio || null;
    // 'slideshow', not 'video' (game_start.js `kind`): the screen's version watch waits for the END of a video before a
    // reload, and a live cam never ends - it would hold every update for good. A reload costs a live picture nothing,
    // so it may come in the slideshow's two minutes.
    const reportPlay = createPlayReporter(bus, ctx, { kind: 'slideshow' });
    const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    let cfg = { ...DEFAULTS };
    let cams = [];
    let listNote = { bad: 0, over: 0 };
    let at = 0;
    // 'empty' | 'waiting' (autostart off) | 'trying' | 'playing' | 'held' (paused) | 'alloff' | 'unreachable'
    let phase = 'empty';
    let lastSkip = null;           // { name, reason }: the last cam skipped, said until another is
    const resting = new Map();     // id -> { until, reason }: cams found off, left alone until `until`
    let player = null;
    let mutedNow = true;           // what the player was last told
    let triedMuted = false;        // sound on, would not start: tried once more silently
    let soundBlocked = false;      // ...and that worked: the browser wants a press before sound
    let busPaused = false;
    let gain = 1;
    let registered = false;
    let startTimer = null, rotateTimer = null, resumeTimer = null, retryTimer = null, keysTimer = null;
    let keysAway = false;
    let editing = false, editMsg = '', draftName = '', draftAddr = '';
    let started = false, dead = false;
    let headEl = null, stageEl = null, overEl = null, bodyEl = null, editEl = null;

    const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const ms = (key, d) => { const n = Number(cfg[key]); return Number.isFinite(n) && n >= 0 ? n : d; };
    const volume = () => num(cfg.volume, 100, VOLUME_MIN, 100) / 100;
    const soundOn = () => cfg.sound === true;
    const startWaitMs = () => Math.max(1000, ms('startWaitMs', START_WAIT_MS));
    const restMs = () => ms('restMs', REST_MS);
    const cur = () => cams[at] || null;
    const isResting = (c) => { const r = c && resting.get(c.id); return !!(r && r.until > now()); };
    const stopTimer = (t) => { if (t != null) { try { clearT(t); } catch { /* gone */ } } return null; };
    function clearCamTimers() {
      startTimer = stopTimer(startTimer);
      rotateTimer = stopTimer(rotateTimer);
      resumeTimer = stopTimer(resumeTimer);
      retryTimer = stopTimer(retryTimer);
    }

    // ---- the speaker (only while the sound is on) ---------------------------------------------------------------
    function ensureBus() {
      const a = audio();
      if (registered || !a || typeof a.register !== 'function') return;
      try {
        a.register(AUDIO_ID, { tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY, channel: 'media', onGain });
        registered = true;
      } catch (err) { console.error('livecams: audio bus', err); }   // a broken bus never stops the picture
    }
    const active = (on) => { if (!registered) return; try { audio()?.setActive?.(AUDIO_ID, on); } catch { /* advice only */ } };
    function applyVolume() { if (player && soundOn()) { try { player.setGain?.(volume() * gain); } catch { /* not ready */ } } }
    function onGain(level) {
      gain = Math.max(0, Math.min(1, Number(level) || 0));
      applyVolume();
      if (!soundOn() || !player) return;   // silent: the bus has nothing to say to it
      if (gain === 0) {
        if (phase === 'playing' && !busPaused) { busPaused = true; try { player.pause?.(); } catch { /* fine */ } render(); }
        return;
      }
      if (busPaused) { busPaused = false; try { player.resume?.(); } catch { /* fine */ } render(); }
    }
    function applyMute() {
      const want = !soundOn() || (triedMuted && soundBlocked) || (triedMuted && phase === 'trying');
      mutedNow = want;
      try { player?.setMuted?.(want); } catch { /* not ready */ }
      applyVolume();
    }

    // ---- the player ---------------------------------------------------------------------------------------------
    function ensurePlayer() {
      if (player || !stageEl) return player;
      const host = (doc || document).createElement('div');
      host.setAttribute('data-lc-player', '');
      stageEl.prepend(host);
      try {
        player = makePlayer(host, { onPlaying, onIdle, onEnded, onError }, { muted: !soundOn() });
      } catch (err) {
        console.error('livecams: player', err);
        player = null;
      }
      mutedNow = !soundOn();
      return player;
    }

    function onPlaying() {
      if (dead) return;
      startTimer = stopTimer(startTimer);
      resumeTimer = stopTimer(resumeTimer);
      const c = cur();
      if (c) resting.delete(c.id);
      if (triedMuted && soundOn()) soundBlocked = true;
      phase = 'playing';
      busPaused = false;
      reportPlay(true);
      if (soundOn() && !mutedNow) { ensureBus(); active(true); }
      if (rotateTimer == null) armRotate();
      render();
    }
    function onIdle(why) {
      if (dead) return;
      if (why === 'paused') {
        if (busPaused || phase !== 'playing') return;   // the bus's pause, or a cam not yet started
        hold();
        return;
      }
      // BUFFERING after it had started: a stream that drops looks like this. It has startWaitMs to come back.
      if (why === 'buffering' && phase === 'playing' && startTimer == null) {
        startTimer = setT(() => { startTimer = null; if (phase === 'playing') { offNow('cam-off'); goNext(); } }, startWaitMs());
      }
    }
    // A live stream that ENDS has stopped for now (the night, the season): skipped, rested.
    function onEnded() { if (dead || !cur()) return; offNow('cam-off'); goNext(); }
    function onError(code) {
      if (dead) return;
      if (typeof code !== 'number') {
        // YouTube's player itself did not load: no cam is to blame. Said, and tried again in a minute.
        clearCamTimers();
        phase = 'unreachable';
        reportPlay(false); active(false);
        try { player?.destroy?.(); } catch { /* gone */ }
        player = null;
        mount.querySelector('[data-lc-player]')?.remove?.();
        const again = ctx.sourceRecheckMs != null && Number.isFinite(Number(ctx.sourceRecheckMs)) ? Number(ctx.sourceRecheckMs) : SOURCE_RECHECK_MS;
        retryTimer = setT(() => { retryTimer = null; if (!dead) loadCam(at); }, again);
        render();
        return;
      }
      if (!cur()) return;
      offNow(code === 100 || code === 2 ? 'cam-not-found' : code === 101 || code === 150 ? 'cam-no-embed' : 'cam-wont-play');
      goNext();
    }

    function offNow(reason) {
      const c = cur();
      if (!c) return;
      resting.set(c.id, { until: now() + restMs(), reason });
      lastSkip = { name: c.name, reason };
    }

    function armStart() {
      startTimer = stopTimer(startTimer);
      startTimer = setT(() => {
        startTimer = null;
        if (dead || phase !== 'trying') return;
        // Sound on and nothing yet: a browser that will not start a video WITH sound by itself looks just like a cam
        // that is off. Once more without sound before it is called off.
        if (soundOn() && !triedMuted) {
          triedMuted = true;
          applyMute();
          try { player?.load?.(cur().id); } catch { /* not ready */ }
          armStart();
          return;
        }
        offNow('cam-off');
        goNext();
      }, startWaitMs());
    }
    function armRotate() {
      rotateTimer = stopTimer(rotateTimer);
      const r = ms('rotateMs', ROTATE_MS);
      if (!(r > 0) || cams.length < 2) return;
      rotateTimer = setT(() => { rotateTimer = null; if (!dead && phase === 'playing') goNext(); }, r);
    }

    function loadCam(index, { play = true } = {}) {
      clearCamTimers();
      busPaused = false; triedMuted = false; soundBlocked = false;
      if (!cams.length) { at = 0; phase = 'empty'; try { player?.stop?.(); } catch { /* fine */ } reportPlay(false); active(false); render(); return; }
      at = ((index % cams.length) + cams.length) % cams.length;
      const c = cams[at];
      ensurePlayer();
      applyMute();
      reportPlay(false);
      active(false);
      if (play) {
        phase = 'trying';
        try { player?.load?.(c.id); } catch (err) { console.error('livecams: load', err); }
        armStart();
      } else {
        phase = 'waiting';
        try { player?.cue?.(c.id); } catch (err) { console.error('livecams: cue', err); }
      }
      render();
    }

    // The next cam that is not resting; `dir` -1 for the one before. Every cam resting: a press tries the next anyway
    // (somebody asked); by itself, the panel says none is on and waits for the first rest to end.
    function goNext({ dir = 1, manual = false } = {}) {
      const n = cams.length;
      if (!n) { loadCam(0); return; }
      for (let k = 1; k <= n; k += 1) {
        const i = (((at + dir * k) % n) + n) % n;
        if (!isResting(cams[i])) { loadCam(i); return; }
      }
      if (manual) { loadCam(at + dir); return; }
      allOff();
    }
    function allOff() {
      clearCamTimers();
      phase = 'alloff';
      try { player?.stop?.(); } catch { /* fine */ }
      reportPlay(false); active(false);
      let soonest = Infinity;
      for (const c of cams) { const r = resting.get(c.id); if (r) soonest = Math.min(soonest, r.until); }
      const wait = Number.isFinite(soonest) ? Math.max(1000, soonest - now()) : SOURCE_RECHECK_MS;
      retryTimer = setT(() => {
        retryTimer = null;
        if (dead) return;
        const i = cams.findIndex((c) => !isResting(c));
        if (i >= 0) loadCam(i); else allOff();
      }, wait);
      render();
    }

    function hold() {
      clearCamTimers();
      phase = 'held';
      reportPlay(false); active(false);
      const r = ms('pausedResumeMs', PAUSED_RESUME_MS);
      if (r > 0) resumeTimer = setT(() => { resumeTimer = null; if (!dead && phase === 'held') carryOn(); }, r);
      render();
    }
    function carryOn() {
      phase = 'trying';
      if (soundBlocked) { soundBlocked = false; triedMuted = false; applyMute(); }
      try { player?.resume?.(); } catch { /* fine */ }
      armStart();
      render();
    }

    // ---- the keyboard: a press on the video gives it to YouTube; it comes back ----------------------------------
    const frameEl = () => (stageEl ? stageEl.querySelector('iframe') : null);
    function onWinBlur() {
      setT(() => {
        if (dead || !doc) return;
        const f = frameEl();
        if (f && doc.activeElement === f) keysAwayNow();
      }, 0);
    }
    function onWinFocus() { if (keysAway) keysBack(false); }
    function keysAwayNow() {
      keysAway = true;
      keysTimer = stopTimer(keysTimer);
      const k = Number(cfg.keysBackMs);
      if (Number.isFinite(k) && k > 0) keysTimer = setT(() => { keysTimer = null; keysBack(true); }, k);
      render();
    }
    function keysBack(take) {
      keysTimer = stopTimer(keysTimer);
      const was = keysAway;
      keysAway = false;
      if (was && !dead) render();   // drawn first: a focused button that is replaced leaves the keyboard nowhere
      if (take) {
        try {
          const b = mount.querySelector('[data-act="pause"],[data-act="play"],[data-act="next"],[data-act="edit"]');
          if (b && typeof b.focus === 'function') b.focus({ preventScroll: true });
          const f = frameEl();
          if (doc && f && doc.activeElement === f) f.blur?.();
        } catch { /* the keyboard stays where it is; the button is still there */ }
      }
    }

    // ---- the settings, as they change ---------------------------------------------------------------------------
    function readCfg(snap) {
      const was = cfg;
      cfg = { ...DEFAULTS, ...(snap || {}) };
      const list = parseCamList(cfg.cams);
      listNote = { bad: list.bad, over: list.over };
      const next = [...list];
      const changed = J(next) !== J(cams);
      const nowId = cur()?.id || null;
      cams = next;
      if (!started) return;
      if (changed) {
        const keep = nowId ? cams.findIndex((c) => c.id === nowId) : -1;
        if (keep >= 0) { at = keep; if (rotateTimer != null) armRotate(); }
        else if (phase === 'waiting' || phase === 'empty') {
          loadCam(0, { play: phase === 'empty' ? shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) }) : false });
          return;
        } else { loadCam(Math.min(at, Math.max(0, cams.length - 1))); return; }
      }
      if (was.sound !== cfg.sound) {
        soundBlocked = false; triedMuted = false;
        applyMute();
        if (soundOn() && phase === 'playing') { ensureBus(); active(true); }
        if (!soundOn()) { active(false); if (busPaused) { busPaused = false; try { player?.resume?.(); } catch { /* fine */ } } }
      }
      if (was.volume !== cfg.volume) applyVolume();
      if (was.rotateMs !== cfg.rotateMs && phase === 'playing') armRotate();
      render();
    }
    const J = (v) => JSON.stringify(v);

    // ---- the view -----------------------------------------------------------------------------------------------
    const btn = (act, label, extra = '') => `<button type="button" class="lc-btn" data-act="${act}"${extra}>${esc(label)}</button>`;
    function headHtml() {
      const c = cur();
      if (!c) return '<span class="lc-name">Live nature cams</span>';
      const status = phase === 'playing' ? (mutedNow ? 'Live, sound off' : 'Live')
        : phase === 'held' ? 'Paused' : phase === 'trying' ? 'Starting…' : phase === 'waiting' ? 'Waiting for Start' : '';
      const known = SUGGESTED_CAMS.some((s) => s.id === c.id);
      const parts = [status, cams.length > 1 ? `${at + 1} of ${cams.length}` : '',
        known ? 'From explore.org, on YouTube' : 'On YouTube'].filter(Boolean);
      return `<span class="lc-name" data-lc-name>${esc(c.name)}</span>
        <span class="lc-sub" data-lc-status>${esc(parts.join(' · '))}</span>`;
    }
    function skipLine(cls = 'lc-skip') {
      return lastSkip ? `<p class="${cls}" data-lc-skip role="status">${esc(camWords(lastSkip.reason, lastSkip.name))}</p>` : '';
    }
    function overHtml() {
      const c = cur();
      if (phase === 'empty') {
        return `<p data-lc-empty>No cams yet. Press “Change the list” to choose some.</p>`;
      }
      if (phase === 'trying' && c) return `<p data-lc-trying>Looking in on ${esc(c.name)}…</p>${skipLine()}`;
      if (phase === 'alloff') {
        return `<p data-lc-alloff role="status">None of the cams is on right now. They are tried again by themselves.</p>${skipLine()}`;
      }
      if (phase === 'unreachable') return `<p data-lc-unreachable role="status">${esc(camWords('cam-unreachable'))}</p>`;
      return '';
    }
    function bodyHtml() {
      const lines = [];
      const playing = phase === 'playing' && !busPaused;
      if (phase === 'playing' && lastSkip) lines.push(skipLine('lc-hint'));
      if (phase === 'held') {
        const r = ms('pausedResumeMs', PAUSED_RESUME_MS);
        lines.push(`<p class="lc-msg" data-lc-held role="status">Paused. Press Play to carry on.${r > 0 ? ' It carries on by itself later.' : ''}</p>`);
      }
      if (busPaused) lines.push('<p class="lc-hint">Quiet for a moment. It carries on by itself.</p>');
      if (soundBlocked) {
        lines.push('<p class="lc-msg" data-lc-sound-blocked role="status">Playing without sound. This browser wants a press on '
          + 'the screen before it plays sound. Press Play for sound.</p>');
      }
      if (keysAway) {
        lines.push(`<p class="lc-msg" data-lc-keys role="status">YouTube has the keyboard.${Number(cfg.keysBackMs) > 0
          ? ' It comes back by itself soon.' : ''}</p>`);
      }
      if (listNote.bad || listNote.over) {
        lines.push(`<p class="lc-hint">${listNote.bad ? `${listNote.bad} of the cams typed in have no YouTube address. ` : ''}`
          + `${listNote.over ? `${listNote.over} more than ${CAMS_MAX} are left off.` : ''}</p>`);
      }
      const hasCams = cams.length > 0;
      const main = phase === 'waiting' ? btn('play', 'Start', ' data-lc-start')
        : phase === 'alloff' || phase === 'unreachable' ? btn('retry', 'Try again')
        : hasCams ? btn(playing ? 'pause' : 'play', playing ? 'Pause' : 'Play') : '';
      return `<div class="lc-btns">
          ${cams.length > 1 ? btn('prev', 'Previous cam') : ''}${main}${cams.length > 1 ? btn('next', 'Next cam') : ''}
          ${keysAway ? btn('keys', 'Give the keys back') : ''}
          ${btn('edit', 'Change the list')}
        </div>${lines.join('')}`;
    }
    function editHtml() {
      const rows = cams.map((c, i) => `<li><b>${esc(c.name)}</b>
          ${btn('show', 'Show it', ` data-index="${i}"`)}${i > 0 ? btn('up', 'Up', ` data-index="${i}"`) : ''}${i < cams.length - 1
          ? btn('down', 'Down', ` data-index="${i}"`) : ''}${btn('remove', 'Remove', ` data-index="${i}"`)}</li>`).join('');
      const more = SUGGESTED_CAMS.filter((s) => !cams.some((c) => c.id === s.id))
        .map((s) => `<li><b>${esc(s.name)}</b>${s.season ? `<span class="lc-hint">${esc(s.season)}</span>` : ''}
          ${btn('suggest', 'Add', ` data-id="${esc(s.id)}"`)}</li>`).join('');
      return `<h3>The cams, in order</h3>
        <ul class="lc-list" data-lc-list>${rows || '<li class="lc-hint">No cams yet.</li>'}</ul>
        ${editMsg ? `<p class="lc-msg" data-lc-edit-msg role="status">${esc(editMsg)}</p>` : ''}
        <h3>More cams from explore.org</h3>
        <ul class="lc-list" data-lc-more>${more || '<li class="lc-hint">All of them are in the list.</li>'}</ul>
        <h3>Another cam</h3>
        <p class="lc-hint">Paste the address of a live cam on YouTube. A name is optional. Typing needs a keyboard.</p>
        <div class="lc-btns">
          <input type="text" data-lc-add-name aria-label="The cam’s name" placeholder="Name, like Owls, Oregon" value="${esc(draftName)}">
          <input type="text" data-lc-add-addr aria-label="The cam’s YouTube address" placeholder="youtube.com/watch?v=…" value="${esc(draftAddr)}">
          ${btn('add', 'Add')}
        </div>
        <p class="lc-hint">Only the list is saved: each cam’s name and address. The pictures come straight from YouTube.</p>
        <div class="lc-btns">${btn('close', 'Done')}</div>`;
    }
    function render() {
      if (dead || !bodyEl) return;
      const had = doc && doc.activeElement;
      const typing = had && mount.contains(had) && had.matches?.('[data-lc-add-name],[data-lc-add-addr]')
        ? (had.matches('[data-lc-add-name]') ? '[data-lc-add-name]' : '[data-lc-add-addr]') : '';
      if (headEl) headEl.innerHTML = headHtml();
      const o = overHtml();
      if (overEl) { overEl.innerHTML = o; overEl.hidden = !o; }
      bodyEl.innerHTML = bodyHtml();
      if (editEl) { editEl.hidden = !editing; editEl.innerHTML = editing ? editHtml() : ''; }
      if (typing) mount.querySelector(typing)?.focus?.({ preventScroll: true });
    }

    // ---- the list -----------------------------------------------------------------------------------------------
    // Kept as text, and read back the way the text reads (names tidied), so the settings' own echo is no change.
    function saveCams(next) {
      const text = camListText(next);
      cams = [...parseCamList(text)];
      try { state?.set?.({ cams: text }); } catch { /* not saved */ }
    }
    function afterListChange(prevId) {
      if (!cams.length) { loadCam(0); return; }
      const keep = prevId ? cams.findIndex((c) => c.id === prevId) : -1;
      if (keep >= 0) { at = keep; render(); return; }
      if (phase === 'empty') { loadCam(0, { play: shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) }) }); return; }
      loadCam(Math.min(at, cams.length - 1), { play: phase !== 'waiting' });
    }
    function moveCam(i, by) {
      const j = i + by;
      if (i < 0 || j < 0 || i >= cams.length || j >= cams.length) return;
      const prevId = cur()?.id || null;
      const next = cams.slice();
      [next[i], next[j]] = [next[j], next[i]];
      saveCams(next);
      editMsg = `Moved “${next[j].name}” ${by < 0 ? 'up' : 'down'}.`;
      afterListChange(prevId);
    }
    function removeCam(i) {
      const c = cams[i];
      if (!c) return;
      const prevId = cur()?.id || null;
      saveCams(cams.filter((_, k) => k !== i));
      editMsg = `Removed “${c.name}”.`;
      afterListChange(prevId === c.id ? null : prevId);
    }
    function addCam(cam) {
      const prevId = cur()?.id || null;
      saveCams([...cams, cam]);
      afterListChange(prevId);
    }
    function addSuggested(id) {
      const s = SUGGESTED_CAMS.find((x) => x.id === id);
      if (!s || cams.some((c) => c.id === id)) return;
      if (cams.length >= CAMS_MAX) { editMsg = `The list holds ${CAMS_MAX} cams. Remove one first.`; render(); return; }
      editMsg = `Added “${s.name}”.`;
      addCam({ id: s.id, name: s.name });
    }
    async function addFromForm() {
      const ref = parseCamRef(draftAddr);
      if (ref && ref.explore) { editMsg = camWords('cam-explore-page'); render(); return; }
      if (!ref || !ref.id) { editMsg = camWords('cam-bad-address'); render(); return; }
      if (cams.some((c) => c.id === ref.id)) { editMsg = 'That cam is already in the list.'; render(); return; }
      if (cams.length >= CAMS_MAX) { editMsg = `The list holds ${CAMS_MAX} cams. Remove one first.`; render(); return; }
      const known = SUGGESTED_CAMS.find((s) => s.id === ref.id);
      let name = String(draftName || '').trim() || ref.name || (known && known.name) || '';
      if (!name) {
        editMsg = 'Looking it up…'; render();
        const r = await lookupCam(ref.id, lookupOpts);
        if (dead) return;
        if (!r.ok && r.reason !== 'cam-unreachable') { editMsg = camWords(r.reason, 'That video'); render(); return; }
        name = (r.ok && r.title) || `Cam ${cams.length + 1}`;
      }
      draftName = ''; draftAddr = '';
      editMsg = `Added “${name}”.`;
      addCam({ id: ref.id, name });
    }

    // ---- the verbs ----------------------------------------------------------------------------------------------
    const api = {
      next() { if (cams.length) goNext({ manual: true }); },
      prev() { if (cams.length) goNext({ dir: -1, manual: true }); },
      play() {
        if (phase === 'waiting') { loadCam(at); return; }
        if (phase === 'held') { carryOn(); return; }
        if (phase === 'playing' && soundBlocked) { soundBlocked = false; triedMuted = false; applyMute(); render(); return; }
        if (phase === 'alloff' || phase === 'unreachable' || phase === 'empty') { resting.clear(); lastSkip = null; loadCam(at); }
      },
      pause() {
        if (phase !== 'playing' && phase !== 'trying') return;
        try { player?.pause?.(); } catch { /* fine */ }
        hold();
      },
      select() { if (phase === 'playing' || phase === 'trying') api.pause(); else api.play(); },
    };

    function act(b) {
      const a = b?.dataset?.act;
      if (!a) return;
      const i = Number(b.dataset.index);
      if (a === 'play') api.play();
      else if (a === 'pause') api.pause();
      else if (a === 'next') api.next();
      else if (a === 'prev') api.prev();
      else if (a === 'retry') { resting.clear(); lastSkip = null; loadCam(at); }
      else if (a === 'keys') keysBack(true);
      else if (a === 'edit') { editing = true; editMsg = ''; render(); editEl?.querySelector('button')?.focus?.({ preventScroll: true }); }
      else if (a === 'close') { editing = false; editMsg = ''; render(); mount.querySelector('[data-act="edit"]')?.focus?.({ preventScroll: true }); }
      else if (a === 'show') { editing = false; resting.delete(cams[i]?.id); loadCam(i); }
      else if (a === 'up') moveCam(i, -1);
      else if (a === 'down') moveCam(i, 1);
      else if (a === 'remove') removeCam(i);
      else if (a === 'suggest') addSuggested(b.dataset.id);
      else if (a === 'add') addFromForm();
    }

    return {
      init() {
        if (doc && !doc.getElementById(STYLE_ID)) {
          const st = doc.createElement('style');
          st.id = STYLE_ID;
          st.textContent = CSS;
          (doc.head || doc.documentElement).append(st);
        }
        mount.innerHTML = `<div class="lc" data-livecams>
            <div class="lc-head" data-lc-head></div>
            <div class="lc-stage" data-lc-stage><div class="lc-over" data-lc-over hidden></div></div>
            <div class="lc-body" data-lc-body></div>
            <div class="lc-edit" data-lc-edit hidden></div>
          </div>`;
        headEl = mount.querySelector('[data-lc-head]');
        stageEl = mount.querySelector('[data-lc-stage]');
        overEl = mount.querySelector('[data-lc-over]');
        bodyEl = mount.querySelector('[data-lc-body]');
        editEl = mount.querySelector('[data-lc-edit]');
        mount.addEventListener('click', (e) => { const b = e.target.closest?.('[data-act]'); if (b && mount.contains(b)) act(b); });
        mount.addEventListener('input', (e) => {
          if (e.target.matches?.('[data-lc-add-name]')) draftName = e.target.value;
          else if (e.target.matches?.('[data-lc-add-addr]')) draftAddr = e.target.value;
        });
        mount.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target.matches?.('[data-lc-add-name],[data-lc-add-addr]')) { e.preventDefault(); addFromForm(); }
          // Escape leaves the list, on this panel only (never the window: two panels must not close each other).
          if (e.key === 'Escape' && editing) { e.preventDefault(); e.stopPropagation(); editing = false; editMsg = ''; render(); }
        });
        win?.addEventListener?.('blur', onWinBlur);
        win?.addEventListener?.('focus', onWinFocus);

        readCfg(state?.get?.());
        state?.subscribe?.((snap) => { if (!dead) readCfg(snap); });
        started = true;
        const auto = shouldAutostart(cfg, { fallback: true, alone: panelAlone(ctx) });
        if (cams.length) loadCam(0, { play: auto }); else render();

        bus.subscribe(`${TYPE}/next`, () => api.next());
        bus.subscribe(`${TYPE}/prev`, () => api.prev());
        bus.subscribe(`${TYPE}/play`, () => api.play());
        bus.subscribe(`${TYPE}/pause`, () => api.pause());
        bus.subscribe(`${TYPE}/select`, () => api.select());
      },
      onResize() {},
      onHide() { state?.flush?.(); },
      destroy() {
        dead = true;
        clearCamTimers();
        keysTimer = stopTimer(keysTimer);
        try { win?.removeEventListener?.('blur', onWinBlur); win?.removeEventListener?.('focus', onWinFocus); } catch { /* gone */ }
        try { player?.destroy?.(); } catch { /* gone */ }
        player = null;
        reportPlay(false);
        try { if (registered) { audio()?.setActive?.(AUDIO_ID, false); audio()?.unregister?.(AUDIO_ID); } } catch { /* gone */ }
        registered = false;
      },
      // The list row's live line: how many cams, and the first few by name.
      settingsChoices() {
        if (!cams.length) return {};
        const names = cams.map((c) => c.name);
        return { cams: { status: `${cams.length} cam${cams.length === 1 ? '' : 's'}: ${names.slice(0, 3).join('; ')}${cams.length > 3 ? '; …' : ''}` } };
      },
      __probe: () => ({
        ids: cams.map((c) => c.id), names: cams.map((c) => c.name), at, id: cur()?.id || null, name: cur()?.name || null,
        phase, lastSkip, resting: [...resting.keys()].filter((id) => isResting({ id })), mutedNow, triedMuted, soundBlocked,
        busPaused, registered, keysAway, editing,
        timers: { start: startTimer != null, rotate: rotateTimer != null, resume: resumeTimer != null, retry: retryTimer != null },
      }),
      __api: api,
    };
  },
);
