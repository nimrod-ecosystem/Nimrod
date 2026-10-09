// call_page.js — the page a family member opens to CALL a person's screen (call.html). 2026-10-02.
//
// Until this page, nothing on the site placed a family call: the screen's Call panel (modules/call.js)
// only answers, and the only caller was `createCallTransport({ role: 'driver' }).call()` in the tests.
// This is that caller, for a phone or a computer, signed in to the caller's own account.
//
// WHO CAN CALL: exactly whoever may use that person's screens today - the owner, or an account holding a
// live DRIVE GRANT (grants.py `may_drive`, checked by the server when the page asks for a socket ticket and
// again when the socket opens). That is the same gate the intercom page passes through to reach the
// socket. There is no separate "may call" check, and this page does not invent one or widen this one:
// links.py names `call_audio` / `call_video` as link permissions, but nothing on the site can create a
// link or switch a permission on yet, so a check on them would refuse every family member. When they
// become settable, they are the server's to check (on a `purpose: 'call'` offer) - see the report on
// Mike's list. The page asks for a ticket BEFORE it opens anything, so an account without the grant is
// told so in plain words and no camera, microphone or socket is ever opened for it.
//
// WHAT IT DOES: the person presses Video call or Audio call. Only then, and only once the site says a
// screen of that person is connected, does the browser ask for the camera / microphone. The call goes out
// through call_transport.js's DRIVER role, tagged `purpose: 'call'` with a session (fd3f880), so every
// screen of the person rings and ONE answers ("Handled on another screen" is the screens' business; the
// caller sees one call). The page shows ringing, answered, the screen's "no" in words ("on another
// call", "declined", "no answer"), and ended. Controls: mute, camera off, switch camera (only when the
// device has more than one), hang up. The camera and microphone are released on hang-up, on every end,
// and when the page is hidden for good (`pagehide`: the tab closed or navigated away).

import { connectDrive } from './drive.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createCallTransport } from './call_transport.js';
import { createWakeHold } from './phone_mic_show.js';
import { createSpeechChannel } from './output_channels.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PERSON_KEY = 'nimrod:call:person';

export const CALL_MODES = Object.freeze(['video', 'audio']);

// How long the caller waits for ANY reply before giving up and saying "no answer". The SCREEN decides how
// long it rings (the Call panel's "Ring for": 20 / 45 / 120 s, or a 10-20 s countdown that answers by
// itself) and says "unanswered" when it gives up - so this only ever fires when nothing replies at all: a
// screen whose page has no Call panel, an older page, a socket that died. 135 s, ARGUED rather than made a
// setting: it must outlast the panel's longest ring (120 s) plus a claim (3 s, CALL_CLAIM_MS) and the
// answer's gathering (3 s), or a caller would hang up on a screen that is still ringing; the suite checks
// that ratio against the panel's own options. The caller can hang up sooner at any moment, so a longer
// wait costs nothing but a ring nobody hears.
export const CALLER_GIVE_UP_MS = 135000;

// How long to wait for the site's socket to open before saying it cannot be reached. Two round trips (a
// ticket, then the socket); 15 s covers a slow mobile network and is short enough that a person standing
// with a phone is told something before they give up on it.
export const CONNECT_MS = 15000;

// How long to wait for the site to say how many of the person's screens are connected. The server says
// it in the same turn as it accepts the socket, so this only fires on a server too old to say - and then
// the call is placed anyway (it reaches whoever is there; the give-up time still ends it).
export const PRESENCE_MS = 2000;

// What a screen's "no" means to the caller (the `bye` reason the screen sends: modules/call.js `end`,
// call_transport.js busy). Anything else is just "the call ended".
export const CALLER_END_TEXT = Object.freeze({
  declined: 'The call was declined.',
  busy: 'On another call right now. Try again in a little while.',
  unanswered: 'No answer.',
  'no-answer': 'No answer.',
  failed: 'The call could not connect.',
  'connection-lost': 'The connection was lost.',
  hangup: 'The call ended.',
  ended: 'The call ended.',
});

const STATE_TEXT = {
  checking: 'Checking…',
  connecting: 'Connecting…',
  media: 'Asking for the camera and microphone…',
  ringing: 'Ringing…',
  answered: 'Answered — connecting…',
  'in-call': 'In a call',
  reconnecting: 'Reconnecting…',
};

/** The words for an end: the transport's reason and the far end's own `why`. Pure. */
export function endText(reason, why, { answered = false, connected = false } = {}) {
  if (reason === 'remote') {
    if (why && CALLER_END_TEXT[why]) return CALLER_END_TEXT[why];
    return answered ? 'The call ended.' : 'The call ended before it was answered.';
  }
  // Answered, and the connection never came up within the transport's connect clock (call_transport.js
  // ANSWER_CONNECT_MS) - the screen's own `bye` never came either (its socket died). 2026-10-04.
  if (reason === 'unconnected') return CALLER_END_TEXT.failed;
  if (reason === 'stalled') {
    return connected ? 'The connection was lost.'
      : 'The call could not connect. The two networks may not be able to reach each other directly.';
  }
  return CALLER_END_TEXT[reason] || 'The call ended.';
}

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true };

// ---- WORDS FROM THE SCREEN'S AAC BOARD ("board into call", 2026-10-08) -----------------------------
// A word chosen on the screen's board during the call arrives as text (call_transport.js `onWords`).
// This page shows it big, with whose board it came from, and - unless this device chose "only show" -
// reads it out in this device's own voice.
//
// WHAT THIS DEVICE DOES WITH THEM: 'speak' (show and read aloud) or 'show' (only show). Remembered on
// this device. Default 'speak', argued: a caller in a call is listening, not reading, and a word only
// shown is easy to miss while looking at the picture. The case for 'show': a caller somewhere a voice
// out of the phone is unwelcome, or one who finds the second voice confusing - one press away, on the
// setup screen and beside the words themselves.
export const WORDS_KEY = 'nimrod:call:words';
export const WORDS_MODES = Object.freeze(['speak', 'show']);
// How many earlier words stay on show under the newest. 6, argued: enough to follow a sentence built a
// word at a time, few enough to read at a glance on a phone. Not a setting: nobody can judge it in advance.
export const WORDS_SHOWN = 6;
// *** THIS DEVICE'S MICROPHONE IS HELD WHILE IT READS A WORD OUT. *** The browser's voice is not part of
// what echo cancellation removes (it removes the call's own sound, not the browser's speech), so on a
// computer with speakers the word read out here would go back into the call and the room would hear its
// own word again, a moment late. So the microphone stops sending while the word is read, and comes back
// when it ends - or after WORDS_HOLD_MAX_MS whatever happens, so a voice that never says it finished can
// never leave this device muted. 8 s, argued: the longest card is a short sentence, read in 2-4 s; a
// voice engine that never reports its end (row 2.27) then costs the caller at most 8 s of being heard.
// The case against holding: on a phone, the system's own echo cancellation usually removes it anyway, and
// the caller cannot be heard for a second or two. Not yet measured either way [training knowledge].
export const WORDS_HOLD_MAX_MS = 8000;

export async function mountCallPage(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  connect = connectDrive,
  makeTransport = (o) => createCallTransport(o),
  getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c),
  enumerateDevices = () => (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices
    ? navigator.mediaDevices.enumerateDevices() : Promise.resolve([])),
  // Plays a stream in an element. A seam so the suites can hand in fake streams a real <video> refuses.
  attach = (el, stream) => { try { if (el) { el.srcObject = stream || null; if (stream) el.play?.()?.catch?.(() => {}); } } catch { /* gone */ } },
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  win = (typeof window !== 'undefined' ? window : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  user = null,                         // the dev/test account override (auth.js); null on the real site
  // Reads a word out in this device's voice: `speakWords(text, done)` calls `done` when the voice has
  // finished, and returns something truthy when it started (nothing: there is no voice here). By default
  // the site's own speech channel (output_channels.js), not voice.js directly, so its end-of-speech
  // watching (row 2.27) applies here too. A seam for the suites.
  speakWords = null,
  base = '',
  giveUpMs = CALLER_GIVE_UP_MS,
  connectMs = CONNECT_MS,
  presenceMs = PRESENCE_MS,
} = {}) {
  if (!root) throw new Error('mountCallPage: a root element is required');
  const get = (k, d = '') => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };

  let people = [];
  let myName = '';
  let phase = 'idle';
  let mode = 'video';
  let target = null;
  let link = null;
  let transport = null;
  let local = null;                    // the camera/microphone stream this page opened
  let ended = null;
  let note = null;                     // said during the call (the camera could not be opened...)
  let answered = false;
  let connected = false;
  let micOn = true;
  let camOn = true;
  let cams = [];                       // videoinput device ids, for switching
  let said = [];                       // words from the screen's board this call, newest last (WORDS_SHOWN)
  let heldForWords = false;            // the microphone is held while a word is read out (WORDS_HOLD_MAX_MS)
  let readTok = 0;
  let run = 0;
  const timers = new Set();
  const offs = [];
  const opened = { media: 0, sockets: 0 };   // counted for the suites: nothing opens before a press
  const ac = new AbortController();
  const on = (el, type, fn) => el?.addEventListener?.(type, fn, { signal: ac.signal });
  const wake = createWakeHold({ nav, doc });

  root.innerHTML = '<main class="cp" data-body><p class="cp-note">Loading…</p></main>';
  const body = () => root.querySelector('[data-body]');
  const q = (sel) => root.querySelector(sel);

  const later = (fn, ms) => { const id = setTimer(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const clearAll = () => { for (const id of timers) { try { clearTimer(id); } catch { /* gone */ } } timers.clear(); };

  async function getJSON(path) {
    const res = await fetchImpl(`${base}${path}`, { headers: authHeaders(user), credentials: 'same-origin' });
    if (!res.ok) throw httpError(res, `${path} -> ${res.status}`);
    return res.json();
  }
  async function loadPeople() {
    const mine = await getJSON('/api/people');
    let shared = { people: [] };
    try { shared = await getJSON('/api/drive/shared'); } catch { /* none shared is fine */ }
    const out = [];
    for (const p of mine.people || []) if (p && p.id) out.push({ id: p.id, name: p.name || 'My screen' });
    for (const p of shared.people || []) {
      if (p && p.person_id && !out.some((x) => x.id === p.person_id)) out.push({ id: p.person_id, name: p.name || 'A shared screen' });
    }
    return out;
  }

  // ---- the setup view ----------------------------------------------------------------------------
  function renderSignIn() {
    root.dataset.live = '0'; root.dataset.view = 'setup';
    body().innerHTML = `<h1>Call</h1>
      <p>Sign in first, with an account that may use the screen you want to call.</p>
      <p><a class="cp-btn cp-primary" href="/auth/login?next=${encodeURIComponent('/call.html')}">Sign in</a></p>`;
  }

  function renderSetup() {
    root.dataset.live = '0'; root.dataset.view = 'setup';
    const want = new URLSearchParams(search || '').get('person') || get(PERSON_KEY, '');
    const pick = people.find((p) => p.id === want) || (people.length === 1 ? people[0] : null);
    const shownAs = myName || 'Someone';
    body().innerHTML = `
      <h1>Call</h1>
      <p class="cp-lead">A video or audio call to a screen. Every screen of that person rings, and whoever
        is there can answer or decline. The camera and microphone open only when you press a call button.</p>
      ${ended ? `<p class="cp-ended" role="status" data-ended>${esc(ended)}</p>` : ''}
      ${people.length ? `
      <label class="cp-field"><span>Who to call</span>
        <select data-person>${people.map((p) => `<option value="${esc(p.id)}"${pick && pick.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
      <button type="button" class="cp-btn cp-primary cp-big" data-start="video">Video call</button>
      <button type="button" class="cp-btn cp-big" data-start="audio">Audio call <span class="cp-sub">(sound only, no camera)</span></button>
      <p class="cp-note" data-shown-as>The screen shows the call as from “${esc(shownAs)}”${myName ? '' : ' (the name your notes are signed with, which is not set)'}.</p>
      <label class="cp-field"><span>Words chosen on the screen’s AAC board during the call</span>
        <select data-words-mode>
          <option value="speak"${wordsMode() === 'speak' ? ' selected' : ''}>Show them and read them out here</option>
          <option value="show"${wordsMode() === 'show' ? ' selected' : ''}>Only show them</option>
        </select>
      </label>
      <p class="cp-note">To talk without video and hear the room, <a data-intercom-link href="./intercom.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">open the intercom</a> instead.</p>`
      : '<p>This account has no screens it may use. The screen’s owner can share one from the Remote tab.</p>'}`;
  }

  // ---- the live view -----------------------------------------------------------------------------
  function buildLive() {
    root.dataset.view = 'live';
    body().innerHTML = `
      <div class="cp-call" data-call>
        <div class="cp-status" role="status" aria-live="polite">
          <b class="cp-word" data-word></b><span class="cp-who" data-who></span>
        </div>
        <section class="cp-words" data-words hidden aria-label="Words from the AAC board">
          <p class="cp-words-from" data-words-from></p>
          <p class="cp-words-now" data-words-now aria-live="assertive"></p>
          <p class="cp-words-before" data-words-before></p>
          <button type="button" class="cp-btn cp-ctl cp-words-aloud" data-words-aloud aria-pressed="true">Read out loud</button>
        </section>
        <div class="cp-stage">
          <video class="cp-remote" data-remote autoplay playsinline></video>
          <div class="cp-card" data-card><div class="cp-initial" aria-hidden="true" data-initial></div><div class="cp-card-name" data-card-name></div></div>
          <video class="cp-self" data-self autoplay playsinline muted hidden></video>
        </div>
        <p class="cp-callnote" data-note hidden></p>
        <section class="cp-game" data-game hidden aria-label="A game together"></section>
        <div class="cp-controls" role="group" aria-label="Call controls">
          <button type="button" class="cp-btn cp-ctl" data-mute aria-pressed="false">Mute</button>
          <button type="button" class="cp-btn cp-ctl" data-cam aria-pressed="false" hidden>Camera off</button>
          <button type="button" class="cp-btn cp-ctl" data-flip hidden>Switch camera</button>
          <button type="button" class="cp-btn cp-hang" data-hangup>Hang up</button>
        </div>
      </div>`;
  }

  function paintLive() {
    if (root.dataset.view !== 'live') return;
    root.dataset.live = phase === 'in-call' ? '1' : '0';
    root.dataset.phase = phase;
    const name = target ? target.name : '';
    const set = (sel, text) => { const el = q(sel); if (el) el.textContent = text; };
    set('[data-word]', STATE_TEXT[phase] || '');
    set('[data-who]', name);
    set('[data-card-name]', name);
    set('[data-initial]', (name.trim()[0] || '?').toUpperCase());
    const video = mode === 'video';
    const remote = q('[data-remote]');
    // The room's picture fills the stage in a video call once it is answered; otherwise their name card.
    if (remote) remote.hidden = !(video && (phase === 'in-call' || phase === 'answered' || phase === 'reconnecting'));
    const card = q('[data-card]');
    if (card) card.hidden = !!(remote && !remote.hidden);
    const self = q('[data-self]');
    if (self) self.hidden = !(video && local && hasKind('video'));
    const mute = q('[data-mute]');
    if (mute) { mute.textContent = micOn ? 'Mute' : 'Unmute'; mute.setAttribute('aria-pressed', String(!micOn)); mute.disabled = !local; }
    const cam = q('[data-cam]');
    if (cam) {
      cam.hidden = !(video && hasKind('video'));
      cam.textContent = camOn ? 'Camera off' : 'Camera on';
      cam.setAttribute('aria-pressed', String(!camOn));
    }
    const flip = q('[data-flip]');
    if (flip) flip.hidden = !(video && hasKind('video') && cams.length > 1);
    const n = q('[data-note]');
    if (n) { n.textContent = note || ''; n.hidden = !note; }
  }

  // ---- words from the screen's AAC board (WORDS_KEY above) -------------------------------------------
  function wordsMode() { const m = get(WORDS_KEY, 'speak'); return WORDS_MODES.includes(m) ? m : 'speak'; }
  function paintWords() {
    const box = q('[data-words]');
    if (!box) return;
    box.hidden = said.length === 0;
    const set = (sel, t) => { const el = q(sel); if (el) el.textContent = t; };
    const name = target ? target.name : '';
    set('[data-words-from]', name ? `From ${name}’s AAC board` : 'From the AAC board');
    set('[data-words-now]', said.length ? said[said.length - 1] : '');
    set('[data-words-before]', said.slice(0, -1).join(' · '));
    const aloud = q('[data-words-aloud]');
    if (aloud) {
      const on = wordsMode() === 'speak';
      aloud.setAttribute('aria-pressed', String(on));
    }
  }
  function heard(w) {
    if (!w || typeof w.text !== 'string' || !w.text) return;
    said = [...said, w.text].slice(-WORDS_SHOWN);
    paintWords();
    if (wordsMode() === 'speak') readAloud(w.text);
  }
  // The default voice: the site's speech channel, made on the first word (never at load), with its
  // watchdog at the hold's own ceiling. `source: 'board'` - these are a person's board words.
  let speech = null;
  if (typeof speakWords !== 'function') {
    speakWords = (text, done) => {
      if (!speech) speech = createSpeechChannel({ maxMs: WORDS_HOLD_MAX_MS, setTimer, clearTimer });
      if (!speech.available()) return null;
      return speech.present({ verb: 'say', text, source: 'board' }, { done }) || null;
    };
  }
  // The microphone sends only when the caller has not muted it AND no word is being read out.
  function applyMic() { for (const t of tracksOf('audio')) { try { t.enabled = micOn && !heldForWords; } catch { /* stopped */ } } }
  function readAloud(text) {
    const tok = ++readTok;
    const release = () => { if (tok !== readTok) return; heldForWords = false; applyMic(); };
    heldForWords = true;
    applyMic();
    later(release, WORDS_HOLD_MAX_MS);
    // `done` releases when the voice finishes. A newer word interrupts this one: its end then belongs to
    // the newer word's token and changes nothing.
    let started = null;
    try { started = speakWords(text, release); } catch (err) { console.error('call: read a word out', err); started = null; }
    if (!started) release();
  }
  function setWordsMode(m) {
    if (!WORDS_MODES.includes(m)) return;
    put(WORDS_KEY, m);
    if (m === 'show' && heldForWords) { readTok++; heldForWords = false; applyMic(); }
    paintWords();
  }

  const tracksOf = (kind) => { try { return (kind === 'audio' ? local?.getAudioTracks?.() : local?.getVideoTracks?.()) || []; } catch { return []; } };
  const hasKind = (kind) => tracksOf(kind).length > 0;

  function setPhase(p) { phase = p; paintLive(); }

  // ---- asking first: the same ticket the socket needs ----------------------------------------------
  async function allowed(personId) {
    try {
      const res = await fetchImpl(`${base}/api/drive/ticket/${encodeURIComponent(personId)}`,
        { method: 'POST', headers: authHeaders(user), credentials: 'same-origin' });
      if (res.status === 401 || res.status === 403) return false;
      return true;
    } catch { return true; }     // a network blip here: the socket's own ticket is the real check
  }

  function waitFor(test, ms) {
    return new Promise((resolve) => {
      if (test()) { resolve(true); return; }
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const check = () => { if (test()) fin(true); };
      waiters.add(check);
      later(() => { waiters.delete(check); fin(test()); }, ms);
    });
  }
  const waiters = new Set();
  const poke = () => { for (const w of [...waiters]) { try { w(); } catch { /* ignore */ } } };

  async function openMedia(want) {
    if (want === 'video') {
      try { opened.media++; return { stream: await getUserMedia({ audio: AUDIO_CONSTRAINTS, video: { facingMode: 'user' } }), mode: 'video' }; }
      catch (err) {
        console.error('call: camera', err);
        try { opened.media++; return { stream: await getUserMedia({ audio: AUDIO_CONSTRAINTS }), mode: 'audio', fellBack: true }; }
        catch (err2) { console.error('call: microphone', err2); return null; }
      }
    }
    try { opened.media++; return { stream: await getUserMedia({ audio: AUDIO_CONSTRAINTS }), mode: 'audio' }; }
    catch (err) { console.error('call: microphone', err); return null; }
  }

  async function listCams() {
    try {
      const all = await enumerateDevices();
      cams = (all || []).filter((d) => d && d.kind === 'videoinput' && d.deviceId).map((d) => d.deviceId);
    } catch { cams = []; }
  }

  async function start(want) {
    if (phase !== 'idle') return;
    const personId = q('[data-person]')?.value;
    target = people.find((p) => p.id === personId) || null;
    if (!target) return;
    mode = CALL_MODES.includes(want) ? want : 'video';
    put(PERSON_KEY, target.id);
    ended = null; note = null; answered = false; connected = false; micOn = true; camOn = true;
    said = []; heldForWords = false;
    const my = ++run;
    phase = 'checking';
    buildLive(); paintLive();
    // 1. MAY THIS ACCOUNT CALL THIS SCREEN? Nothing is opened until the site says yes.
    if (!(await allowed(target.id))) {
      if (my === run) finish('This account is not allowed to call that screen. Its owner can share it from the Remote tab.');
      return;
    }
    if (my !== run) return;
    // 2. THE SOCKET, and how many of the person's screens are on.
    setPhase('connecting');
    let presence = null;
    let wasDown = false;
    opened.sockets++;
    link = connect({
      personId: target.id, role: 'driver', user, base,
      onPresence: (p) => { presence = p; poke(); },
      onState: (s) => {
        poke();
        if (s !== 'connected') { if (transport) wasDown = true; return; }
        // The socket came back mid-call. The media path is separate and usually survived; only a call
        // whose connection is failing is offered again (call_transport.js re-offers once per drop).
        if (wasDown && transport && (transport.__probe?.().stalling)) transport.reconnect?.();
        wasDown = false;
      },
    });
    // A GAME OFFERED TO THIS CALL (2026-10-06): the screen chose Quiz mix's "On this call". The server tells the
    // callers (never a screen) with a code; this page shows it beside the video, and joins only when "Play" is pressed.
    offs.push(link.onGameInvite?.((inv) => { if (my === run) showGame(inv); }) || (() => {}));
    const up = await waitFor(() => link && link.state?.() === 'connected', connectMs);
    if (my !== run) return;
    if (!up) { finish('Could not reach the site. Check the connection and try again.'); return; }
    await waitFor(() => presence != null, presenceMs);
    if (my !== run) return;
    if (presence && presence.screens === 0) {
      finish(`None of ${target.name}’s screens are connected right now, so nothing would ring. Try again once one is on.`);
      return;
    }
    // 3. ONLY NOW the camera / microphone.
    setPhase('media');
    const got = await openMedia(mode);
    if (my !== run) { stopTracks(got?.stream); return; }
    if (!got) { finish('This device did not allow its microphone, so it cannot call. Check the browser’s permission for this site.'); return; }
    local = got.stream;
    if (got.fellBack) { mode = 'audio'; note = 'The camera could not be opened, so this is an audio call.'; }
    if (mode === 'video') await listCams();
    if (my !== run) return;
    attach(q('[data-self]'), mode === 'video' ? local : null);
    wake.hold();
    // 4. THE CALL, through the driver role (tagged: every screen rings, one answers).
    transport = makeTransport({ link, role: 'driver' });
    offs.push(transport.onEnded((reason, info) => { if (my === run) finish(endText(reason, info?.why, { answered, connected })); }));
    // board into call: a word chosen on the screen's AAC board during this call.
    offs.push(transport.onWords?.((w) => { if (my === run) heard(w); }) || (() => {}));
    offs.push(transport.onAnswered?.(() => { if (my !== run) return; answered = true; if (phase === 'ringing') setPhase('answered'); }));
    offs.push(transport.onConnection?.((st) => {
      if (my !== run) return;
      if (st === 'connected') { connected = true; answered = true; setPhase('in-call'); }
      else if ((st === 'disconnected' || st === 'failed') && connected) setPhase('reconnecting');
    }));
    setPhase('ringing');
    const tracks = [...tracksOf('audio'), ...tracksOf('video')];
    let sent = false;
    try {
      sent = await transport.call({ tracks, from: { name: myName || 'Someone', video: mode === 'video' }, remoteVideo: q('[data-remote]') });
    } catch (err) { console.error('call: place', err); sent = false; }
    if (my !== run) return;
    if (!sent) { finish('The call could not be placed. Check the connection and try again.'); return; }
    // Nothing replied at all (see CALLER_GIVE_UP_MS): say so, and tell the screens to stop.
    later(() => { if (my === run && !answered) { try { transport?.hangup('unanswered'); } catch { /* gone */ } finish(CALLER_END_TEXT.unanswered); } }, giveUpMs);
  }

  // ---- a game beside the video (game_rooms.py; the game itself is play.html, on this login's own levels) ----
  let game = null;                     // { code, game, name, playing }
  function paintGame() {
    const el = q('[data-game]');
    if (!el) return;
    if (!game) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const who = game.name ? `${game.name}'s screen` : 'The screen';
    if (!game.playing) {
      el.innerHTML = `<p class="cp-game-line" data-game-offer="${esc(game.code)}">${esc(who)} would like to play Quiz mix with you.</p>
        <div class="cp-game-btns"><button type="button" class="cp-btn cp-primary" data-game-join>Play</button>
        <button type="button" class="cp-btn" data-game-close>Not now</button></div>`;
      return;
    }
    if (el.querySelector('[data-game-frame]')) return;     // already playing: never reload the game under them
    el.innerHTML = `<iframe class="cp-game-frame" data-game-frame title="Quiz mix" src="${esc(`/play.html?room=${encodeURIComponent(game.code)}`)}"></iframe>
      <div class="cp-game-btns"><button type="button" class="cp-btn" data-game-close>Close the game</button></div>`;
  }
  function showGame(inv) {
    if (!inv || !inv.code) return;
    if (game && game.playing && game.code === inv.code) return;
    game = { code: inv.code, game: inv.game, name: inv.name || '', playing: false };
    paintGame();
  }
  function closeGame() { game = null; paintGame(); }

  function stopTracks(stream) {
    for (const t of stream?.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } }
  }

  function finish(message = null) {
    run++;
    game = null;
    clearAll();
    waiters.clear();
    wake.release();
    for (const off of offs.splice(0)) { try { off?.(); } catch { /* gone */ } }
    const t = transport; transport = null;
    const l = link; link = null;
    try { if (t && t.__probe?.().live) t.hangup('hangup'); } catch { /* gone */ }
    try { t?.destroy?.(); } catch { /* gone */ }
    try { l?.close?.(); } catch { /* gone */ }
    attach(q('[data-remote]'), null);
    attach(q('[data-self]'), null);
    stopTracks(local);
    local = null;
    cams = [];
    said = []; heldForWords = false; readTok++;
    phase = 'idle';
    ended = message;
    renderSetup();
  }

  function toggleMic() {
    if (!local) return;
    micOn = !micOn;
    applyMic();
    paintLive();
  }
  function toggleCam() {
    if (!local) return;
    camOn = !camOn;
    for (const t of tracksOf('video')) { try { t.enabled = camOn; } catch { /* stopped */ } }
    paintLive();
  }
  async function flip() {
    if (!local || cams.length < 2 || !transport) return;
    const old = tracksOf('video')[0];
    let curId = '';
    try { curId = old?.getSettings?.().deviceId || ''; } catch { curId = ''; }
    const next = cams[(Math.max(0, cams.indexOf(curId)) + 1) % cams.length];
    const my = run;
    let s = null;
    try { opened.media++; s = await getUserMedia({ video: { deviceId: { exact: next } } }); }
    catch (err) { console.error('call: switch camera', err); return; }
    const track = s?.getVideoTracks?.()[0];
    if (my !== run || !track || !local) { stopTracks(s); return; }
    track.enabled = camOn;
    if (!(await transport?.replaceTrack?.('video', track))) { stopTracks(s); return; }
    try { old?.stop?.(); local.removeTrack?.(old); local.addTrack?.(track); } catch { /* gone */ }
    const self = q('[data-self]');
    let facing = '';
    try { facing = track.getSettings?.().facingMode || ''; } catch { facing = ''; }
    if (self) self.dataset.rear = facing === 'environment' ? '1' : '0';
    attach(self, local);
    paintLive();
  }

  on(root, 'click', (e) => {
    const s = e.target.closest?.('[data-start]');
    if (s) { start(s.dataset.start); return; }
    if (e.target.closest?.('[data-hangup]')) { finish('The call ended.'); return; }
    if (e.target.closest?.('[data-mute]')) { toggleMic(); return; }
    if (e.target.closest?.('[data-cam]')) { toggleCam(); return; }
    if (e.target.closest?.('[data-flip]')) { flip(); return; }
    if (e.target.closest?.('[data-words-aloud]')) { setWordsMode(wordsMode() === 'speak' ? 'show' : 'speak'); return; }
    if (e.target.closest?.('[data-game-join]')) { if (game) { game.playing = true; paintGame(); } return; }
    if (e.target.closest?.('[data-game-close]')) closeGame();
  });
  on(root, 'change', (e) => {
    if (e.target.closest?.('[data-words-mode]')) { setWordsMode(e.target.value); return; }
    if (!e.target.closest?.('[data-person]')) return;
    const a = q('[data-intercom-link]');
    if (a) a.setAttribute('href', `./intercom.html?person=${encodeURIComponent(e.target.value)}`);
  });
  // THE PAGE GOING AWAY (closed, navigated, put in the back-forward cache) hangs up and lets go of the
  // camera and microphone. A tab merely in the background keeps the call: switching apps to check a
  // message must not end it (the browser itself may pause the camera meanwhile).
  on(win, 'pagehide', () => { if (phase !== 'idle') finish(null); });

  try {
    people = await loadPeople();
    try { const me = await getJSON('/api/me'); myName = (me && typeof me.display_name === 'string') ? me.display_name.trim() : ''; } catch { myName = ''; }
    renderSetup();
  } catch (err) {
    if (isAuthError(err)) renderSignIn();
    else body().innerHTML = '<h1>Call</h1><p>Could not reach the site. Check the connection and reload.</p>';
  }

  return {
    state: () => phase,
    mode: () => mode,
    ended: () => ended,
    media: () => !!local,
    opened: () => ({ ...opened }),
    people: () => people.map((p) => ({ ...p })),
    transport: () => transport,
    game: () => (game ? { ...game } : null),
    words: () => [...said],
    wordsMode: () => wordsMode(),
    micHeld: () => heldForWords,
    call: (want = 'video') => start(want),
    hangup: () => finish('The call ended.'),
    destroy() { finish(null); wake.destroy(); ac.abort(); },
  };
}
