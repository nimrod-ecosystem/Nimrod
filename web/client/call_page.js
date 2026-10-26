// call_page.js — the page a family member opens to CALL a person's screen (call.html). 2026-10-02.
//
// Until this page, nothing on the site placed a family call: the screen's Call panel (modules/call.js)
// only answers, and the only caller was `createCallTransport({ role: 'driver' }).call()` in the tests.
// This is that caller, for a phone or a computer, signed in to the caller's own account.
//
// WHO CAN CALL (2026-10-14, "a call is only a call"): the owner, or an account holding a live grant on that person -
// a drive grant, or a CALL-ONLY one (grants.py `may_reach`, checked when the page asks for a socket ticket and again
// when the socket opens) - whose "May call" is not switched off on the person's own list (screen_access.py
// `may_call`, checked by the SERVER on every call offer: a refused ring comes back as a `bye` with reason
// 'not-allowed', and nothing rings). Calling grants no drive and no see; those are lent by the screen during a call.
// The page asks for a ticket BEFORE it opens anything, so an account without a grant is told so in plain words and
// no camera, microphone or socket is ever opened for it.
//
// WHAT IT DOES: the person presses Video call or Audio call. Only then, and only once the site says a
// screen of that person is connected, does the browser ask for the camera / microphone. The call goes out
// through call_transport.js's DRIVER role, tagged `purpose: 'call'` with a session (fd3f880), so every
// screen of the person rings and ONE answers ("Handled on another screen" is the screens' business; the
// caller sees one call). The page shows ringing, answered, the screen's "no" in words ("on another
// call", "declined", "no answer"), and ended. Controls: mute, camera off, switch camera (only when the
// device has more than one), hang up. The camera and microphone are released on hang-up, on every end,
// and when the page is hidden for good (`pagehide`: the tab closed or navigated away).

//
// GROUP CALLS (2026-10-09; call_group.js). With a site that knows them, every call this page places is tagged as a
// group, so during it the person can ADD SOMEONE - ring another of their people's screens into the call (another
// call, on that person's socket, tagged with the group) - and LET IN another caller who knocks. A caller whose call
// is refused because the screen is already on a call is offered "Ask to join that call" (a knock). Each other person
// is a tile beside the first (up to 3 others on video, 5 with sound only - call_group.js MESH_MAX_OTHERS). When the
// first screen leaves and others stay, the call carries on. With an older site (no group messages on the socket),
// nothing here changes: the page places one call, exactly as before.
import { connectDrive } from './drive.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createCallTransport, newCallSession } from './call_transport.js';
import { createCallGroup, MESH_MAX_OTHERS, GROUP_REFUSED_TEXT } from './call_group.js';
import { createWakeHold } from './phone_mic_show.js';
import { createSpeechChannel } from './output_channels.js';
import { createCallAnnouncer } from './follow_sound.js';   // the hear half: a follow page in this browser hears of the call
import { playPath } from './game_together.js';   // the join page's address for a game's room (Quiz mix's as it always was)

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
  // A call is only a call (2026-10-14): "May call" is its own permission, and the SERVER refuses the ring (app.py) with
  // this reason when it is switched off for this account. Nothing rang.
  'not-allowed': 'This account may not call that screen. Whoever looks after it can allow it on the Remote page (“May call”).',
  // Ring one screen (2026-10-25): the screen chosen under "Ring" is not connected now; the server rang nothing.
  'not-here': 'That screen is not on right now, so nothing rang. Choose “Every screen” or another one.',
});

// "PLAY THIS GAME TOGETHER" (2026-10-12; game_rooms.py CallAsks). During a call, one press here asks the screen to open
// Quiz mix on the call; the screen opens a room and the site hands this page its code, and the game opens beside the
// video with no second press. GAME_ASK_WAIT_MS is how long this page waits for that code before saying the game did
// not open: the screen opens the room the moment it hears the ask and the code comes back in the same breath, so
// 20 s, argued, covers a screen whose connection is reconnecting (its backoff tops out at 8 s) plus a ticket and a
// socket. The server lets one socket ask once per 10 s, so a second press inside the wait would be dropped anyway.
// GAME_NOTE_MS: how long the "did not open" words stay before the button comes back by itself.
export const GAME_ASK_WAIT_MS = 20000;
export const GAME_NOTE_MS = 20000;
// THE GAMES THIS PAGE OFFERS (Word Builder since 2026-10-12): one button each, "Play Quiz mix together" and "Play Word
// builder together". ONE BUTTON PER GAME OR ONE BUTTON WITH A CHOICE, argued:
//   ONE WITH A CHOICE ("Play a game together", then which): a single button however many games there are, and the
//     screen beside the video stays quiet. AGAINST: two presses where the whole point of 9a70277 was one, and a
//     choice that opens and has to be closed again is one more thing on a phone held up for a video call.
//   ONE EACH: one press, the game's own name on it, nothing to open or dismiss; with two games, two buttons in a row.
//     AGAINST: it grows with every game - past three or four it is a wall of buttons beside the video.
// One each, for now: the press stays one press, and there are two games. When a fourth game joins this list, it
// should become "Play a game together" with the games under it - written here so that is the trigger, not a feeling.
// [On Mike's list.] Each title is the module's own (the name on the screen's panel), so both ends say the same word.
export const CALL_GAMES = Object.freeze([
  Object.freeze({ game: 'quiz_mix', title: 'Quiz mix' }),
  Object.freeze({ game: 'word_builder', title: 'Word builder' }),
]);
// The first game, asked for when nothing names one (`askGame()` with no game; kept for what read it before).
export const GAME_ASK_GAME = CALL_GAMES[0].game;
const gameTitle = (g) => CALL_GAMES.find((x) => x.game === g)?.title || 'the game';

// group calls: how long a knock waits before this page gives up on it. The server's own limit is 90 s (drive.py
// KNOCK_WAIT_S) and it says "unanswered" itself; this is the backstop for a server that never replies, a little longer.
export const KNOCK_GIVE_UP_MS = 95000;

const STATE_TEXT = {
  knocking: 'Asking to join…',
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
      : 'The call could not connect. The two internet connections may not be able to reach each other directly.';
  }
  return CALLER_END_TEXT[reason] || 'The call ended.';
}

/**
 * WHY A CALL COULD NOT CONNECT, in plain words, from what each end offered (call_transport.js summarizeIce; 2026-10-26,
 * chat's note CT). Shown under "The call could not connect", so the next failure says whether this device was on the
 * same network as the screen. Null when there is nothing to say. PURE.
 */
export function iceWords(r) {
  if (!r || !r.local || !r.remote) return null;
  const kinds = (s) => [s.host ? 'a home-network address' : '', s.mdns ? 'a hidden home-network address' : '',
    s.srflx ? 'an internet address' : '', s.relay ? 'a relay' : ''].filter(Boolean);
  const list = (a) => (a.length ? a.join(', ') : 'nothing usable');
  const lHome = r.local.host + r.local.mdns > 0, rHome = r.remote.host + r.remote.mdns > 0;
  let hint = '';
  if (!lHome && r.local.srflx) hint = 'This device offered only an internet address, so it is probably not on the same Wi-Fi as the screen (mobile data, or a guest network).';
  else if (lHome && rHome && !r.succeeded) hint = 'Both offered home-network addresses but could not reach each other: check both are on the same Wi-Fi, not a guest network.';
  else if (!r.local.relay && !r.remote.relay) hint = 'Calls between different networks may need a relay server, and none is set up yet.';
  return `What each end offered: this device ${list(kinds(r.local))}; the screen ${list(kinds(r.remote))}. ${hint}`.trim();
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
  // group calls: what makes this page's part in a group call (call_group.js). Returns null on a link with no group
  // messages (an older site, a suite's fake link), and then nothing about the call changes.
  makeGroup = (o) => createCallGroup(o),
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
  // the hear half (follow_sound.js createCallAnnouncer): tells this browser's follow page which screens this call is
  // with. A seam for the suites; null makes the real one.
  announceCall = null,
} = {}) {
  if (!root) throw new Error('mountCallPage: a root element is required');
  const callNews = announceCall || (() => { try { return createCallAnnouncer({ setTimer, clearTimer }); } catch { return null; } })();
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
  // group calls (see the header): this page's group, the other screens it rang into the call (call id -> leg), the
  // first screen gone while others stay, a call joined by knocking (no first screen of its own), the knock offered
  // after a "busy", and whether the Add someone box is open.
  let group = null;
  const legs = new Map();
  let primaryGone = false;
  let joinedByKnock = false;
  let knockOffer = null;
  let adding = false;
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
      <p class="cp-lead">A video or audio call to a screen. Every screen of that person rings (or only the one you
        choose under Ring) and waits for whoever is there to answer or decline. If whoever looks after those screens lets you drop in, it answers
        by itself after a short countdown. The camera and microphone open only when you press a call button.</p>
      <p class="cp-note" data-not-nurse-call>Nimrod is not a nurse call or an emergency system.</p>
      ${ended ? `<p class="cp-ended" role="status" data-ended>${esc(ended)}</p>` : ''}
      ${knockOffer ? `<button type="button" class="cp-btn cp-primary cp-big" data-knock>Ask to join that call
        <span class="cp-sub">(somebody already in it lets you in)</span></button>` : ''}
      ${people.length ? `
      <label class="cp-field"><span>Who to call</span>
        <select data-person>${people.map((p) => `<option value="${esc(p.id)}"${pick && pick.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
      <div data-ring-box hidden></div>
      <button type="button" class="cp-btn cp-primary cp-big" data-start="video">Video call</button>
      <button type="button" class="cp-btn cp-big" data-start="audio">Audio call <span class="cp-sub">(sound only, no camera)</span></button>
      <a class="cp-btn cp-big" data-checkin-link hidden href="./checkin.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">Check in quietly
        <span class="cp-sub">(see if they are asleep first; the room hears nothing, and the screen shows you are checking in)</span></a>
      <p class="cp-note" data-shown-as>The screen shows the call as from “${esc(shownAs)}”${myName ? '' : ' (you have not set the name your notes are signed with)'}.</p>
      <label class="cp-field"><span>Words chosen on the screen’s AAC board during the call</span>
        <select data-words-mode>
          <option value="speak"${wordsMode() === 'speak' ? ' selected' : ''}>Show them and read them out here</option>
          <option value="show"${wordsMode() === 'show' ? ' selected' : ''}>Only show them</option>
        </select>
      </label>
      <p class="cp-note">To talk without video and hear the room, <a data-intercom-link href="./intercom.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">open the intercom</a> instead.</p>
      <p class="cp-note">During a call you can add more people: up to ${MESH_MAX_OTHERS.video} others on a video call,
        ${MESH_MAX_OTHERS.audio} on an audio call. Everybody connects straight to everybody else.</p>
      ${relaySection()}`
      : '<p>This account has no screens it may use. The screen’s owner can share one from the Remote tab.</p>'}`;
    if (pick) { showCheckIn(pick.id); loadRing(pick.id); }
  }

  // RING ONE SCREEN (2026-10-25, Mike: "I would be calling a different device on my account"). The account that owns
  // the person is told which of its screens are on now (GET /api/drive/screens, by the name each device was given);
  // "Ring" then offers every screen (the default, exactly as before) or only one. Anybody else hears an empty list and
  // sees no choice. A plain request: nothing is opened on this page until a call button is pressed.
  const ringLists = new Map();       // person id -> [{ id, name }]
  let ringPick = '';                 // '' = every screen
  async function loadRing(personId) {
    if (!ringLists.has(personId)) {
      let list = [];
      try {
        const r = await getJSON(`/api/drive/screens/${encodeURIComponent(personId)}`);
        list = (Array.isArray(r?.screens) ? r.screens : []).filter((s) => s && typeof s.id === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(s.id))
          .map((s) => ({ id: s.id, name: String(s.name || 'A screen').slice(0, 40) }));
      } catch { list = []; }
      ringLists.set(personId, list);
    }
    const box = q('[data-ring-box]');
    if (!box || q('[data-person]')?.value !== personId) return;
    const list = ringLists.get(personId) || [];
    if (!list.some((s) => s.id === ringPick)) ringPick = '';
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<label class="cp-field"><span>Ring</span><select data-ring>`
      + `<option value="">Every screen</option>${list.map((s) => `<option value="${esc(s.id)}"${s.id === ringPick ? ' selected' : ''}>Only ${esc(s.name)}</option>`).join('')}`
      + '</select></label>' : '';
  }

  // "CHECK IN QUIETLY" (2026-10-14, checkin.js), next to the call buttons - shown ONLY for somebody who may ("May check
  // in quietly": the owner and the guardian set by default). The site is asked once per person on this page; anything
  // but a plain yes (no answer, an older site, a refusal) leaves it hidden. A convenience: the server checks the look.
  const mayCheckIn = new Map();      // person id -> true | false
  async function showCheckIn(personId) {
    const paint = () => {
      const a = q('[data-checkin-link]');
      if (!a || q('[data-person]')?.value !== personId) return;
      a.setAttribute('href', `./checkin.html?person=${encodeURIComponent(personId)}`);
      a.hidden = mayCheckIn.get(personId) !== true;
    };
    if (!mayCheckIn.has(personId)) {
      let ok = false;
      try { const r = await getJSON(`/api/drive/may/${encodeURIComponent(personId)}`); ok = !!r && r.checkIn === true; }
      catch { ok = false; }
      mayCheckIn.set(personId, ok);
    }
    paint();
  }

  // ---- group calls: "a relay server for bigger calls" - the account's setting (server/call_relay.py) -------------
  // A SKELETON: it saves where the household's relay is and where its tokens come from, and says plainly that nothing
  // uses it yet. Read from the site only when it is opened, so a page that never opens it asks for nothing.
  let relay = null;
  let relayMsg = '';
  function relaySection() {
    const r = relay || {};
    return `<details class="cp-relay" data-relay${relay ? ' open' : ''}>
      <summary>Bigger calls: a relay server (advanced)</summary>
      <p class="cp-note">Calls connect every device straight to every other one, so a call is kept to
        ${MESH_MAX_OTHERS.video + 1} people on video (${MESH_MAX_OTHERS.audio + 1} with sound only). A relay server
        that you run or rent could carry bigger calls, with every call encrypted so the relay cannot see or hear it.
        <b>This is not built yet:</b> whatever is set here, calls stay direct.</p>
      ${relay ? `
      <label class="cp-check"><input type="checkbox" data-relay-on${r.enabled ? ' checked' : ''}> Use a relay server for bigger calls</label>
      <label class="cp-field"><span>Relay address (starts with wss://)</span>
        <input type="url" data-relay-url value="${esc(r.url || '')}" placeholder="wss://relay.example.org" autocomplete="off"></label>
      <label class="cp-field"><span>Where its tokens come from</span>
        <select data-relay-from>
          <option value="own-server"${r.token_from !== 'this-site' ? ' selected' : ''}>Our own token server (this site never holds the relay’s secret)</option>
          <option value="this-site" disabled>This site, holding the secret encrypted (not built)</option>
        </select></label>
      <label class="cp-field"><span>Token address (starts with https://)</span>
        <input type="url" data-relay-token value="${esc(r.token_url || '')}" placeholder="https://relay.example.org/token" autocomplete="off"></label>
      <button type="button" class="cp-btn" data-relay-save>Save</button>` : '<p class="cp-note">Loading…</p>'}
      ${relayMsg ? `<p class="cp-note" role="status" data-relay-msg>${esc(relayMsg)}</p>` : ''}
    </details>`;
  }
  async function loadRelay() {
    try { relay = await getJSON('/api/me/call-relay'); relayMsg = ''; }
    catch { relay = null; relayMsg = 'Could not read this setting from the site.'; }
    if (phase === 'idle') renderSetup();
  }
  async function saveRelay() {
    const body = {
      enabled: !!q('[data-relay-on]')?.checked,
      url: q('[data-relay-url]')?.value || '',
      token_from: q('[data-relay-from]')?.value || 'own-server',
      token_url: q('[data-relay-token]')?.value || '',
    };
    try {
      const res = await fetchImpl(`${base}/api/me/call-relay`, { method: 'PUT', credentials: 'same-origin',
        headers: { ...authHeaders(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { relayMsg = (data && typeof data.detail === 'string') ? data.detail : 'That was not saved.'; }
      else { relay = data; relayMsg = 'Saved. Calls still connect directly until relay calls are built.'; }
    } catch { relayMsg = 'Could not reach the site. Nothing was saved.'; }
    if (phase === 'idle') renderSetup();
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
        <section class="cp-knocks" data-knocks hidden aria-label="Asking to join" aria-live="polite"></section>
        <section class="cp-add" data-add-box hidden aria-label="Add someone to the call"></section>
        <section class="cp-game" data-game hidden aria-label="A game together"></section>
        <div class="cp-controls" role="group" aria-label="Call controls">
          <button type="button" class="cp-btn cp-ctl" data-mute aria-pressed="false">Mute</button>
          <button type="button" class="cp-btn cp-ctl" data-cam aria-pressed="false" hidden>Camera off</button>
          <button type="button" class="cp-btn cp-ctl" data-flip hidden>Switch camera</button>
          <button type="button" class="cp-btn cp-ctl" data-add hidden>Add someone</button>
          <button type="button" class="cp-btn cp-hang" data-hangup>Hang up</button>
        </div>
      </div>`;
  }

  // ---- GROUP CALLS: tiles, knocks, adding someone (see the header) ---------------------------------------------
  const streamHasVideo = (s) => { try { return (s?.getVideoTracks?.() || []).length > 0; } catch { return false; } };
  const primaryShown = () => !primaryGone && !joinedByKnock;
  // Everybody besides the first screen: the screens this page rang in (their own calls), then the people connected
  // through the group.
  function tileList() {
    const out = [];
    for (const [session, l] of legs) {
      out.push({ key: `leg-${session}`, name: l.person.name, stream: l.stream, video: streamHasVideo(l.stream),
        state: l.answered ? (l.state === 'connected' ? 'connected' : 'connecting') : 'ringing' });
    }
    let mesh = [];
    try { mesh = group?.tiles?.() || []; } catch { mesh = []; }
    for (const t of mesh) out.push({ key: `peer-${t.peer}`, name: t.name, stream: t.stream, video: t.video, state: t.state });
    return out;
  }
  function othersInCall() {
    let mesh = 0;
    try { mesh = (group?.tiles?.() || []).length; } catch { mesh = 0; }
    return legs.size + mesh + (primaryShown() ? 1 : 0);
  }
  function groupKind() { try { return group?.kind?.() === 'audio' ? 'audio' : 'video'; } catch { return 'video'; } }
  function roomForMore() { return othersInCall() < MESH_MAX_OTHERS[groupKind()]; }
  function addable() {
    const taken = new Set([...legs.values()].map((l) => l.person.id));
    if (primaryShown() && target) taken.add(target.id);
    return people.filter((p) => !taken.has(p.id));
  }
  function paintTiles() {
    const stage = q('.cp-stage');
    if (!stage) return;
    const showing = ['in-call', 'answered', 'reconnecting', 'ringing'].includes(phase);
    const list = showing ? tileList() : [];
    stage.classList.toggle('cp-grid', list.length > 0 || !primaryShown());
    stage.dataset.n = String(list.length + (primaryShown() ? 1 : 0));
    const keep = new Set(list.map((t) => t.key));
    for (const box of [...stage.querySelectorAll('.cp-tile')]) {
      if (keep.has(box.dataset.tile)) continue;
      attach(box.querySelector('video'), null);
      box.remove();
    }
    for (const t of list) {
      let box = [...stage.querySelectorAll('.cp-tile')].find((b) => b.dataset.tile === t.key);
      if (!box) {
        box = doc.createElement('div');
        box.className = 'cp-tile';
        box.dataset.tile = t.key;
        box.innerHTML = '<video autoplay playsinline></video><div class="cp-tile-initial" aria-hidden="true"></div><div class="cp-tile-name"></div>';
        const self = stage.querySelector('[data-self]');
        stage.insertBefore(box, self || null);
      }
      const v = box.querySelector('video');
      if (box.__stream !== (t.stream || null)) { box.__stream = t.stream || null; attach(v, t.stream || null); }
      // A sound-only call shows the initial; the element still plays their sound.
      box.classList.toggle('cp-tile-audio', !t.video || mode !== 'video');
      box.dataset.state = t.state || '';
      const how = t.state === 'connected' ? '' : t.state === 'ringing' ? ' — ringing…'
        : (t.state === 'failed' || t.state === 'lost' || t.state === 'disconnected') ? ' — connection lost' : ' — connecting…';
      box.querySelector('.cp-tile-initial').textContent = ((t.name || '').trim()[0] || '?').toUpperCase();
      box.querySelector('.cp-tile-name').textContent = (t.name || 'Someone') + how;
    }
  }
  function paintKnocks() {
    const box = q('[data-knocks]');
    if (!box) return;
    let ks = [];
    try { ks = group?.state?.().knocks || []; } catch { ks = []; }
    box.hidden = ks.length === 0;
    box.innerHTML = ks.map((k) => `<div class="cp-knock" data-knock-row="${esc(k.knock)}">
        <p class="cp-knock-line">${esc(k.name)} would like to join the call.</p>
        <div class="cp-game-btns"><button type="button" class="cp-btn cp-primary" data-knock-yes="${esc(k.knock)}">Let in</button>
        <button type="button" class="cp-btn" data-knock-no="${esc(k.knock)}">Not now</button></div></div>`).join('');
  }
  function paintAdd() {
    const btn = q('[data-add]');
    const can = phase === 'in-call' && !!group?.id?.() && roomForMore() && addable().length > 0;
    if (btn) btn.hidden = !can;
    const box = q('[data-add-box]');
    if (!box) return;
    if (!adding || !can) { adding = adding && can; box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (box.querySelector('[data-add-person]')) return;      // already open: keep what was picked
    box.innerHTML = `<label class="cp-field"><span>Who to add</span>
        <select data-add-person>${addable().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <div class="cp-game-btns"><button type="button" class="cp-btn cp-primary" data-add-ring>Ring them</button>
      <button type="button" class="cp-btn" data-add-cancel>Cancel</button></div>`;
  }
  function paintGroup() { paintTiles(); paintKnocks(); paintAdd(); }

  // Nobody else is left (the first screen gone, or never there, and every other person gone): the call is over.
  function checkAlone() {
    if (!(primaryGone || joinedByKnock) || phase !== 'in-call') return;
    if (legs.size === 0 && tileList().length === 0) finish('Everyone else has left the call.');
  }

  function wireGroup(my) {
    if (!group) return;
    offs.push(group.onChange(() => { if (my !== run) return; paintGroup(); checkAlone(); }));
    // Words from any screen's AAC board in the call, with whose board it was.
    offs.push(group.onWords((w) => { if (my === run) heard(w); }));
    offs.push(group.onJoined(() => {
      if (my !== run) return;
      if (phase === 'knocking') { connected = true; answered = true; setPhase('in-call'); }
      paintGroup();
    }));
    offs.push(group.onRefused((r) => {
      if (my !== run) return;
      if (phase === 'knocking') { finish(r.text); return; }
      note = r.text;
      paintLive();
    }));
  }

  // The first screen ended its part (hung up, or its connection is gone) while others are still here: carry on.
  function primaryLeft(text) {
    primaryGone = true;
    note = text;
    const t = transport;
    transport = null;
    try { t?.destroy?.(); } catch { /* gone */ }
    attach(q('[data-remote]'), null);
    paintLive();
    checkAlone();
  }

  // Ring another of this account's people's screens into the call: another call, on THAT person's socket, tagged with
  // this group (the server lets it through only for a caller already in the call, and only into a call with room).
  async function addLeg(personId) {
    const person = people.find((p) => p.id === personId);
    const gid = group?.id?.();
    if (!person || !gid || phase !== 'in-call' || !roomForMore()) return;
    adding = false;
    const my = run;
    const session = newCallSession();
    const leg = { person, link: null, transport: null, stream: null, state: 'connecting', answered: false, offs: [] };
    legs.set(session, leg);
    paintGroup();
    if (!(await allowed(person.id))) { if (my === run) endLeg(session, `This account is not allowed to call ${person.name}.`); return; }
    if (my !== run || legs.get(session) !== leg) return;
    let pres = null;
    opened.sockets++;
    leg.link = connect({ personId: person.id, role: 'driver', user, base, idle: true,
      onPresence: (p) => { pres = p; poke(); }, onState: () => poke() });
    // The site refusing this ring (the call is full, or this login is not in it) is said on THIS socket.
    leg.offs.push(leg.link.onGroup?.((m) => {
      if (my === run && m && m.op === 'refused' && legs.get(session) === leg) {
        endLeg(session, `${person.name}: ${GROUP_REFUSED_TEXT[m.reason] || 'could not be added.'}`);
      }
    }) || (() => {}));
    const up = await waitFor(() => leg.link && leg.link.state?.() === 'connected', connectMs);
    if (my !== run || legs.get(session) !== leg) return;
    if (!up) { endLeg(session, `Could not reach ${person.name}’s screen.`); return; }
    await waitFor(() => pres != null, presenceMs);
    if (my !== run || legs.get(session) !== leg) return;
    if (pres && pres.screens === 0) { endLeg(session, `None of ${person.name}’s screens are connected right now.`); return; }
    const t = makeTransport({ link: leg.link, role: 'driver' });
    leg.transport = t;
    leg.state = 'ringing';
    leg.offs.push(t.onEnded((reason, info) => {
      if (my !== run || legs.get(session) !== leg) return;
      const why = info?.why;
      const text = leg.answered ? `${person.name} left the call.`
        : why === 'busy' ? `${person.name} is on another call.`
          : why === 'declined' ? `${person.name} declined.` : `${person.name} did not answer.`;
      endLeg(session, text);
    }));
    leg.offs.push(t.onAnswered?.(() => { if (my === run) { leg.answered = true; paintGroup(); tellCall(); } }) || (() => {}));
    leg.offs.push(t.onConnection?.((st) => {
      if (my !== run) return;
      if (st === 'connected') leg.answered = true;
      leg.state = st;
      paintGroup();
      tellCall();
    }) || (() => {}));
    leg.offs.push(t.onRemote?.((s) => { if (my === run && s) { leg.stream = s; paintGroup(); } }) || (() => {}));
    // Words from that screen's AAC board, with whose board it was.
    leg.offs.push(t.onWords?.((w) => { if (my === run && w) heard({ ...w, name: person.name }); }) || (() => {}));
    paintGroup();
    let sent = false;
    try {
      sent = await t.call({ tracks: [...tracksOf('audio'), ...tracksOf('video')], session, group: gid,
        from: { name: myName || 'Someone', video: mode === 'video' } });
    } catch (err) { console.error('call: add someone', err); sent = false; }
    if (my !== run || legs.get(session) !== leg) return;
    if (!sent) { endLeg(session, `${person.name} could not be rung.`); return; }
    later(() => {
      if (my === run && legs.get(session) === leg && !leg.answered) {
        try { t.hangup('unanswered'); } catch { /* gone */ }
        endLeg(session, `${person.name} did not answer.`);
      }
    }, giveUpMs);
  }
  function endLeg(session, text) {
    const leg = legs.get(session);
    if (!leg) return;
    legs.delete(session);
    for (const off of leg.offs.splice(0)) { try { off?.(); } catch { /* gone */ } }
    try { if (leg.transport?.__probe?.().live) leg.transport.hangup('hangup'); } catch { /* gone */ }
    try { leg.transport?.destroy?.(); } catch { /* gone */ }
    try { leg.link?.close?.(); } catch { /* gone */ }
    if (text && phase !== 'idle') note = text;
    paintGroup();
    paintLive();
    tellCall();
    checkAlone();
  }

  // ---- asking to join a call that is already going (a knock) ---------------------------------------------------
  async function knockStart() {
    if (phase !== 'idle' || !knockOffer) return;
    const want = knockOffer;
    knockOffer = null;
    target = people.find((p) => p.id === want.personId) || null;
    if (!target) { renderSetup(); return; }
    mode = CALL_MODES.includes(want.mode) ? want.mode : 'video';
    ended = null; note = null; answered = false; connected = false; micOn = true; camOn = true;
    said = []; heldForWords = false; joinedByKnock = true; primaryGone = false;
    const my = ++run;
    phase = 'checking';
    buildLive(); paintLive();
    if (!(await allowed(target.id))) { if (my === run) finish('This account is not allowed to call that screen.'); return; }
    if (my !== run) return;
    setPhase('connecting');
    opened.sockets++;
    link = connect({ personId: target.id, role: 'driver', user, base, idle: true, onState: () => poke() });
    const up = await waitFor(() => link && link.state?.() === 'connected', connectMs);
    if (my !== run) return;
    if (!up) { finish('Could not reach the site. Check the connection and try again.'); return; }
    setPhase('media');
    const got = await openMedia(mode);
    if (my !== run) { stopTracks(got?.stream); return; }
    if (!got) { finish('This device did not allow its microphone, so it cannot join. Check the browser’s permission for this site.'); return; }
    local = got.stream;
    if (got.fellBack) { mode = 'audio'; note = 'The camera could not be opened, so you are joining with sound only.'; }
    if (mode === 'video') await listCams();
    if (my !== run) return;
    attach(q('[data-self]'), mode === 'video' ? local : null);
    wake.hold();
    group = makeGroup({ link, role: 'driver', getTracks: () => [...tracksOf('audio'), ...tracksOf('video')], setTimer, clearTimer });
    if (!group) { finish('This site cannot join a call that is already going.'); return; }
    wireGroup(my);
    setPhase('knocking');
    group.knock();
    later(() => { if (my === run && phase === 'knocking') { try { group?.cancel(); } catch { /* gone */ } finish(GROUP_REFUSED_TEXT.unanswered); } }, KNOCK_GIVE_UP_MS);
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
    // group calls: the first screen gone (others stayed), or a call joined by knocking: no first-screen place.
    if (!primaryShown()) { if (remote) remote.hidden = true; if (card) card.hidden = phase !== 'knocking'; }
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
    if (group || legs.size) paintGroup();       // group calls: tiles, knocks, Add someone
    paintGame();                                // "Play Quiz mix together" once the call is going
  }

  // ---- words from the screen's AAC board (WORDS_KEY above) -------------------------------------------
  function wordsMode() { const m = get(WORDS_KEY, 'speak'); return WORDS_MODES.includes(m) ? m : 'speak'; }
  function paintWords() {
    const box = q('[data-words]');
    if (!box) return;
    box.hidden = said.length === 0;
    const set = (sel, t) => { const el = q(sel); if (el) el.textContent = t; };
    // group calls: a word from another screen in the call says whose board it came from.
    const name = saidFrom || (target ? target.name : '');
    set('[data-words-from]', name ? `From ${name}’s AAC board` : 'From the AAC board');
    set('[data-words-now]', said.length ? said[said.length - 1] : '');
    set('[data-words-before]', said.slice(0, -1).join(' · '));
    const aloud = q('[data-words-aloud]');
    if (aloud) {
      const on = wordsMode() === 'speak';
      aloud.setAttribute('aria-pressed', String(on));
    }
  }
  let saidFrom = '';
  function heard(w) {
    if (!w || typeof w.text !== 'string' || !w.text) return;
    saidFrom = typeof w.name === 'string' ? w.name : '';      // group calls: set when it came through the group
    said = [...said, w.text].slice(-WORDS_SHOWN);
    paintWords();
    // call loadouts (2026-10-09): a word whose recorded clip is already IN the call's sound (`audio: true`,
    // call_mix.js) is heard through the call; reading it out here as well would say it twice. Shown either way.
    if (wordsMode() === 'speak' && w.audio !== true) readAloud(w.text);
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

  function setPhase(p) { phase = p; paintLive(); tellCall(); }

  // ---- THE HEAR HALF (2026-10-12, follow_sound.js): tell this browser's follow page which screens this call is with ----
  // A follow page following a screen this page is on a call with turns its own sound off by default: the call already
  // carries that screen's sound, and two copies a call's delay apart are an echo, both ways. Same-browser only (a
  // BroadcastChannel); nothing new goes to the server. Answered, in the call or reconnecting counts; ringing does not
  // (nothing is heard through a call that has not been answered).
  function tellCall() {
    const live = phase === 'in-call' || phase === 'answered' || phase === 'reconnecting';
    const ids = !live ? [] : [
      ...(target && !primaryGone ? [target.id] : []),
      ...[...legs.values()].filter((l) => l.answered && l.person).map((l) => l.person.id),
    ];
    try { callNews?.set(ids); } catch { /* no channel: the follow page's Sound button still works */ }
  }

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
    knockOffer = null; primaryGone = false; joinedByKnock = false;     // group calls
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
    // `idle` (row 2.83; 2026-10-14 "a call is only a call"): a call socket is CONNECTED, NOT PRESSING, so a call
    // alone never makes the screen say "Someone is helping from another screen" (drive.js `idle`, app.py
    // `_idle_drivers`). It never sends a press; if it ever did, the server would mark it driving first.
    link = connect({
      personId: target.id, role: 'driver', user, base, idle: true,
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
    // group calls: this page's part in a group (null on a link without group messages - then nothing below changes).
    group = makeGroup({ link, role: 'driver', getTracks: () => [...tracksOf('audio'), ...tracksOf('video')], setTimer, clearTimer });
    wireGroup(my);
    const primaryT = transport;
    offs.push(transport.onEnded((reason, info) => {
      if (my !== run || transport !== primaryT) return;
      const text = endText(reason, info?.why, { answered, connected });
      // group calls: the first screen left, and somebody else is still in the call - it carries on without it.
      if (answered && (legs.size > 0 || tileList().length > 0)) { primaryLeft(`${target?.name || 'They'} left the call.`); return; }
      // ...and a screen already on a call: offer to ask to join that call instead (a knock), on a site that can.
      const knockable = info?.why === 'busy' && !!group;
      const want = { personId: target?.id, mode };
      finish(text);
      // Could not connect: what each end offered, in words, once the transport has read it (it reads while closing).
      if (reason === 'unconnected' || reason === 'stalled') {
        setTimer(() => {
          const w = iceWords(primaryT.iceReport?.());
          if (w && phase === 'idle' && ended === text) { ended = `${text} ${w}`; renderSetup(); }
        }, 400);
      }
      if (knockable && want.personId) { knockOffer = want; renderSetup(); }
    }));
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
      // group calls: tagged as a group (its id is this call's own), so more people can be added to it.
      const s = group ? newCallSession() : null;
      const toScreen = ringPick && (ringLists.get(target.id) || []).some((x) => x.id === ringPick) ? ringPick : null;
      sent = await transport.call({ tracks, from: { name: myName || 'Someone', video: mode === 'video' }, remoteVideo: q('[data-remote]'),
        ...(s ? { session: s, group: s } : {}), ...(toScreen ? { toScreen } : {}) });
    } catch (err) { console.error('call: place', err); sent = false; }
    if (my !== run) return;
    if (!sent) { finish('The call could not be placed. Check the connection and try again.'); return; }
    // Nothing replied at all (see CALLER_GIVE_UP_MS): say so, and tell the screens to stop.
    later(() => { if (my === run && !answered) { try { transport?.hangup('unanswered'); } catch { /* gone */ } finish(CALLER_END_TEXT.unanswered); } }, giveUpMs);
  }

  // ---- a game beside the video (game_rooms.py; the game itself is play.html, on this login's own levels) ----
  // `game`: null (nothing: during a call, a "Play ... together" button for each of CALL_GAMES), { asking: <game> } (this
  // page asked the screen to open it, GAME_ASK_WAIT_MS above), { note } (it did not open, said for GAME_NOTE_MS), or an
  // offer / a game playing ({ code, game, name, playing }).
  let game = null;
  let gameSeq = 0;
  const canAsk = () => phase === 'in-call' && primaryShown() && !!target && typeof link?.askGame === 'function';
  function paintGame() {
    const el = q('[data-game]');
    if (!el) return;
    const set = (shape, html) => { if (el.dataset.shape !== shape) { el.dataset.shape = shape; el.innerHTML = html; } el.hidden = false; };
    if (!game) {
      if (!canAsk()) { el.hidden = true; el.innerHTML = ''; el.dataset.shape = ''; return; }
      set('ask', `<div class="cp-game-btns">${CALL_GAMES.map((g) => `<button type="button" class="cp-btn" data-game-ask="${esc(g.game)}">${esc(`Play ${g.title} together`)}</button>`).join('')}</div>`);
      return;
    }
    const who = game.name ? `${game.name}'s screen` : 'The screen';
    if (game.asking) {
      set(`asking:${game.asking}`, `<p class="cp-game-line" data-game-asking="${esc(game.asking)}" role="status">${esc(`Asking ${target ? `${target.name}’s screen` : 'the screen'} to start ${gameTitle(game.asking)}…`)}</p>
        <div class="cp-game-btns"><button type="button" class="cp-btn" data-game-close>Never mind</button></div>`);
      return;
    }
    if (game.note) {
      set(`note:${game.note}`, `<p class="cp-game-line" data-game-note role="status">${esc(game.note)}</p>
        <div class="cp-game-btns"><button type="button" class="cp-btn" data-game-close>OK</button></div>`);
      return;
    }
    const title = gameTitle(game.game);
    if (!game.playing) {
      set(`offer:${game.code}`, `<p class="cp-game-line" data-game-offer="${esc(game.code)}">${esc(`${who} would like to play ${title} with you.`)}</p>
        <div class="cp-game-btns"><button type="button" class="cp-btn cp-primary" data-game-join>Play</button>
        <button type="button" class="cp-btn" data-game-close>Not now</button></div>`);
      return;
    }
    if (el.querySelector('[data-game-frame]')) return;     // already playing: never reload the game under them
    set(`play:${game.code}`, `<iframe class="cp-game-frame" data-game-frame title="${esc(title)}" src="${esc(playPath(game.code, game.game))}"></iframe>
      <div class="cp-game-btns"><button type="button" class="cp-btn" data-game-close>Close the game</button></div>`);
  }
  function showGame(inv) {
    if (!inv || !inv.code) return;
    if (game && game.playing && game.code === inv.code) return;
    // This page asked for THIS game: straight into it, no second press (the press that asked was the yes). An
    // invitation to another game meanwhile (the screen offered it by itself) is only offered.
    const mine = !!game?.asking && game.asking === inv.game;
    gameSeq++;
    game = { code: inv.code, game: inv.game, name: inv.name || '', playing: mine };
    paintGame();
  }
  function closeGame() { gameSeq++; game = null; paintGame(); }
  /** One press: ask the screen to open `which` (one of CALL_GAMES) on this call (game_rooms.py CallAsks). */
  function askForGame(which = GAME_ASK_GAME) {
    if (game || !canAsk() || !CALL_GAMES.some((g) => g.game === which)) return false;
    if (!link.askGame(which)) {
      game = { note: 'Could not reach the site to ask. Check the connection and try again.' };
    } else {
      game = { asking: which };
    }
    const my = ++gameSeq;
    const name = target?.name || 'the other';
    if (game.asking) {
      later(() => {
        if (my !== gameSeq || !game?.asking) return;
        game = { note: `The game did not open on ${name}’s screen. It opens on a screen showing ${gameTitle(which)}, or showing the call by itself.` };
        const mine = ++gameSeq;
        paintGame();
        later(() => { if (mine === gameSeq && game?.note) closeGame(); }, GAME_NOTE_MS);
      }, GAME_ASK_WAIT_MS);
    } else {
      later(() => { if (my === gameSeq && game?.note) closeGame(); }, GAME_NOTE_MS);
    }
    paintGame();
    return true;
  }

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
    // group calls: every screen this page rang in is hung up, and this page leaves the group. (The flags first, so
    // ending a leg here cannot decide the call is "alone" and finish it a second time.)
    primaryGone = false; joinedByKnock = false; adding = false; saidFrom = '';
    const g = group; group = null;
    for (const session of [...legs.keys()]) endLeg(session, null);
    try { g?.destroy?.(); } catch { /* gone */ }
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
    tellCall();
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
    if (!local || cams.length < 2 || (!transport && !group && !legs.size)) return;
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
    // group calls: the new camera goes to everybody - the first screen, every screen rung in, every group connection.
    let swapped = !!(await transport?.replaceTrack?.('video', track));
    for (const l of legs.values()) { try { swapped = !!(await l.transport?.replaceTrack?.('video', track)) || swapped; } catch { /* gone */ } }
    try { if (group) swapped = (await group.swap('video', track)) > 0 || swapped; } catch { /* gone */ }
    if (my !== run) { stopTracks(s); return; }
    if (!swapped) { stopTracks(s); return; }
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
    if (e.target.closest?.('[data-game-ask]')) { askForGame(e.target.closest('[data-game-ask]').dataset.gameAsk || GAME_ASK_GAME); return; }
    if (e.target.closest?.('[data-game-close]')) { closeGame(); return; }
    // group calls: a knock, Add someone, letting a knock in, the relay setting.
    if (e.target.closest?.('[data-knock]')) { knockStart(); return; }
    if (e.target.closest?.('[data-add-ring]')) { const v = q('[data-add-person]')?.value; if (v) addLeg(v); return; }
    if (e.target.closest?.('[data-add-cancel]')) { adding = false; paintAdd(); return; }
    if (e.target.closest?.('[data-add]')) { adding = !adding; paintAdd(); return; }
    const yes = e.target.closest?.('[data-knock-yes]');
    if (yes) { group?.admit?.(yes.dataset.knockYes); return; }
    const no = e.target.closest?.('[data-knock-no]');
    if (no) { group?.deny?.(no.dataset.knockNo); return; }
    if (e.target.closest?.('[data-relay-save]')) { saveRelay(); return; }
  });
  // `toggle` does not bubble, so it is heard on the way down.
  root.addEventListener?.('toggle', (e) => {
    if (e.target?.matches?.('[data-relay]') && e.target.open && !relay) loadRelay();
  }, { capture: true, signal: ac.signal });
  on(root, 'change', (e) => {
    if (e.target.closest?.('[data-words-mode]')) { setWordsMode(e.target.value); return; }
    if (e.target.closest?.('[data-ring]')) { ringPick = e.target.value || ''; return; }
    if (!e.target.closest?.('[data-person]')) return;
    ringPick = '';
    loadRing(e.target.value);
    const a = q('[data-intercom-link]');
    if (a) a.setAttribute('href', `./intercom.html?person=${encodeURIComponent(e.target.value)}`);
    const ck = q('[data-checkin-link]');
    if (ck) ck.hidden = true;            // until the site says this person's screens may be checked in on
    showCheckIn(e.target.value);
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
    askGame: (which) => askForGame(which || GAME_ASK_GAME),
    words: () => [...said],
    wordsMode: () => wordsMode(),
    micHeld: () => heldForWords,
    call: (want = 'video') => start(want),
    hangup: () => finish('The call ended.'),
    // group calls, for the suites: the group, the screens rung in, add one, ask to join, how many others.
    group: () => group,
    legs: () => [...legs.entries()].map(([session, l]) => ({ session, person: l.person.id, answered: l.answered, transport: l.transport })),
    addSomeone: (personId) => addLeg(personId),
    knock: () => knockStart(),
    knockOffered: () => !!knockOffer,
    others: () => othersInCall(),
    tiles: () => tileList().map(({ stream, ...t }) => ({ ...t, hasStream: !!stream })),
    // the hear half: which people this page tells the follow page it is on a call with (follow_sound.js).
    callingWith: () => (callNews?.people?.() || []),
    destroy() { finish(null); wake.destroy(); ac.abort(); try { callNews?.destroy?.(); } catch { /* gone */ } },
  };
}
