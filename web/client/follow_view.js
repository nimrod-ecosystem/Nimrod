// follow_view.js — WATCH ALONG: play what somebody's screen is playing, here, at the same moment.
//
// The follower's page for the mirroring plan's first step (row 2.79, play_sync.js has the whole argument). It sits
// on the Remote page under the person picked there (remote.js), because the people who may follow a screen are the
// people who may drive it, and that page is where they already pick whose screen.
//
// WHAT IT DOES: opens its OWN drive socket marked "follow" (so the screen counts it as watching, not helping, and the
// server lets it do nothing but watch), hears the screen's `play` messages, and steers a YouTube player of its own
// to the same video and second. MUTED TO START (the plan: two speakers in one room a fraction of a second apart
// sound like an echo, and a page that starts making sound by itself is rude anywhere) with a Sound button.
//
// THE PERSON AT THE SCREEN IS TOLD. The screen shows "Someone is watching along from another screen" for as long as
// this is open (kiosk.js, play_sync.js noticeWords). So following is an explicit act here: a button, never started
// by opening the page, never remembered.
//
// WHEN THE SCREEN GOES QUIET this never goes blank: the player carries on with what it had, the page says the screen
// stopped sending, and after "Stop following by itself after" (a choice on this page, a minute by default,
// play_sync.js argues it) it stops following, which also takes the notice off their screen.

import { connectDrive } from './drive.js';
import {
  createClock, createFollower, STOP_AFTER_CHOICES, STOP_AFTER_KEY, stopAfterOf,
} from './play_sync.js';

// How often the follower looks at its player and the screen's last message. Half a second: well inside the 2 s
// seek line, cheap (no network - it reads the player and does arithmetic). Not a person's setting.
export const TICK_MS = 500;
// Pings when following starts (the clock difference needs a few to find a quick round trip), then one every
// PING_EVERY_MS. Five, 250 ms apart: the first picture is not waiting long on them.
export const FIRST_PINGS = 5;
export const PING_EVERY_MS = 30000;

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

// The default player: the same YouTube player the panels use, muted. Imported when first needed so the Remote page
// does not load the YouTube module until somebody follows.
async function defaultPlayer(stageEl) {
  const { createYtPlayer } = await import('./modules/youtube.js');
  return createYtPlayer(stageEl, {}, { muted: true });
}

export function mountFollowView(root, {
  personId = '',
  personName = '',
  user = null,
  connect = connectDrive,
  makePlayer = defaultPlayer,          // (stageEl) => player | Promise<player>: load/seek/play/pause/item/currentTime/playing/setMuted/destroy
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  storage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })(),
} = {}) {
  ensureStyle(root.ownerDocument || document);
  let link = null, player = null, follower = null, clock = null;
  let tickTimer = null, pingTimer = null;
  let phase = 'idle';                   // idle | on | stopped
  let connState = 'offline';
  let muted = true;
  let stopAfterMs = readStopAfter(storage);
  let stoppedWhy = '';
  let torn = false;
  let gen = 0;                          // a Stop / Start pair must not let an old player's promise land in the new one

  const who = personName ? `${personName}’s screen` : 'their screen';

  root.innerHTML = `
    <section class="fv r-grants" data-follow-view aria-labelledby="fv-h">
      <h2 class="r-h2" id="fv-h">Watch along</h2>
      <p class="h-hint">Play what ${esc(who)} is playing, here, at the same moment. It works for YouTube. Their screen
        shares this only if whoever set it up turned on “Let people follow what this screen is playing”, and it shows
        that someone is watching along while you do.</p>
      <div class="fv-row" data-fv-idle>
        <button type="button" class="h-btn h-primary" data-fv-start>Follow what ${esc(who)} is playing</button>
      </div>
      <div data-fv-on hidden>
        <p class="fv-line" data-fv-line></p>
        <p class="fv-status" data-fv-status role="status" aria-live="polite"></p>
        <div class="fv-screens" data-fv-screens></div>
        <div class="fv-stage" data-fv-stage></div>
        <div class="fv-row">
          <button type="button" class="h-btn" data-fv-sound>Sound on</button>
          <button type="button" class="h-btn h-danger" data-fv-stop>Stop</button>
        </div>
      </div>
      <label>Stop following by itself if their screen goes quiet for
        <select data-fv-stopafter>${STOP_AFTER_CHOICES.map((c) => `<option value="${c.ms}"${c.ms === stopAfterMs ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      </label>
    </section>`;
  const el = (sel) => root.querySelector(sel);

  function statusWords() {
    if (phase === 'stopped') return stoppedWhy;
    if (connState !== 'connected') return connState === 'connecting' ? 'Connecting…' : 'Not connected. Trying again…';
    const st = follower ? follower.status() : 'waiting';
    if (st === 'waiting') {
      return 'Waiting for their screen. It shares what it plays only if that is turned on in its settings, and only '
        + 'while it is on.';
    }
    if (st === 'lost') return 'Their screen has stopped sending. The video carries on here by itself.';
    const L = follower.leader();
    if (!L || L.item === null) return 'Their screen is not playing a video right now.';
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
    el('[data-fv-sound]').hidden = !player;
    renderScreens();
  }

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
    const stage = el('[data-fv-stage]');
    if (stage) stage.innerHTML = '';
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
      muted = true;
      try { player = await makePlayer(el('[data-fv-stage]')); } catch (err) { console.error('follow: player', err); player = null; }
      if (torn || my !== gen) { if (my !== gen) { /* a Stop came first */ } return; }
    }
    follower = createFollower({ player: player || {}, clock, now });
    link = connect({
      personId, user, role: 'driver', follow: true,
      onState: (s) => { connState = s; if (s === 'connected') pingSoon(FIRST_PINGS); render(); },
      onPresence: () => {},
    });
    link.onPlay?.((m) => { follower?.onPlay(m); });
    render();
    tickTimer = setTimer(tick, TICK_MS);
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
      muted = !muted;
      try { player?.setMuted?.(muted); } catch { /* not ready */ }
      render();
      return;
    }
    const pick = t.closest('[data-fv-pick]');
    if (pick && follower) { follower.pick(pick.dataset.fvPick); render(); }
  });
  root.addEventListener('change', (e) => {
    if (!(e.target instanceof Element) || !e.target.matches('[data-fv-stopafter]')) return;
    stopAfterMs = stopAfterOf(e.target.value);
    try { storage?.setItem(STOP_AFTER_KEY, String(stopAfterMs)); } catch { /* a private window: this visit only */ }
  });

  render();

  return {
    start, stop,
    phase: () => phase,
    status: () => statusWords(),
    line: () => el('[data-fv-line]').textContent,
    follower: () => follower,
    player: () => player,
    link: () => link,
    muted: () => muted,
    stopAfterMs: () => stopAfterMs,
    destroy() {
      torn = true;
      gen += 1;
      dropLink();
      dropPlayer();
      root.innerHTML = '';
    },
  };
}
