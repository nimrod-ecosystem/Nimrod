// modules/profile.js — A PROFILE AS A MODULE, type 'profile': a person on this account, or an AI character
// (ai_characters.js), shown as a card — the face, the name, one short line — with what can be done with
// them. Add it to any dashboard like any other module; a character's own room has one with the character
// in it ("your AI pulled into the dashboard as an avatar or a profile module", Mike, 2026-10-02).
//
// WHAT THE CARD OFFERS
//   an AI character   Talk (a conversation through nimrod_ai.js with that character's name and persona),
//                     Visit <room> (its room, made into a dashboard on that press, once, then opened),
//                     Copy (a ready-made one: "copy it, and change the copy") or Change / Copy / Remove (one
//                     of the person's own), and Who… (choose somebody else).
//   a person          Call (below), Visit their Home (home_dashboard.js `homeId` on their record), and Who….
//                     Only the people on THIS account: linking accounts is not built, so a friend's profile
//                     cannot be shown, and the picker says so rather than pretending.
//   Dimmed, never hidden (Design's rule, home_profile.js): a button that cannot act says why.
//
// *** CALL: A SCREEN NEVER PLACES A CALL; A PERSON'S OWN BROWSER CAN. *** (kiosk.js: "a bedside screen answers;
// it never places a call".) Calls are placed from call.html (call_page.js, 2d87fe7) on a phone or computer,
// signed in to the caller's own account. So:
//   - on a SCREEN (this panel inside the real kiosk, `onScreen` below) Call stays DIMMED and says where calls
//     are placed. It does not open call.html there: that would turn the screen into a caller, and a page
//     somebody cannot leave on their own.
//   - anywhere else (Home on somebody's phone, the modules page) Call is a LINK to /call.html?person=<id>,
//     but only for a person this account may call: the same list call_page.js offers (`mayCall`) - the
//     account's own people, plus the people shared with it by a live drive grant (/api/drive/shared). The
//     server's drive ticket is still the real check, on call.html, before anything opens; this only keeps
//     the card from offering a call the page would refuse.
//
// *** NOTHING IS SENT ANYWHERE WITHOUT A PRESS. *** Mounting reads records (who, which face); it never asks
// the AI anything (ai.js's rule), never makes a dashboard and never speaks. The AI is first asked on Talk
// (is anything answering?) and then on Send. A room is made only by Visit.
//
// *** NO AI CONNECTED: Talk says how to connect one *** (the same three ways Nimrod's own panel gives), and
// offers the same address / model / key fields. The AI connection is THIS DEVICE's (ai.js), shared with
// Nimrod's panel: connect it in either and both answer.
//
// THE DEFAULT SUBJECT IS WHOEVER IS LOOKING (Mike, 2026-10-02 evening: the landing dashboard's top left is
// "Profile", and a profile there is the person's own). A panel with no stored subject shows the person this
// screen or page is for (`ctx.personId`), and Nimrod only when there is nobody to show (signed out, a preview
// with no person). FOR: the panel on the landing is "your profile", and one stored record (dashboards.js
// `start`) then serves every person without naming one. AGAINST: a panel added to show somebody else opens
// on yourself first -- Who… is one press, and the choice is then stored and kept. It was Nimrod for everyone
// before ("start with Nimrod", an earlier phrase of Mike's); a character's own room still names its
// character explicitly (ai_characters.js `self`), so that case is unchanged. [On Mike's list.]

import { registerModule } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { createAI, DEFAULT_BASE_URL } from '../ai.js';
import { createGuideChat, AI_SOURCE, isLocalAddress } from '../nimrod_ai.js';
import { avatarHtml, createAvatarCache } from '../avatar_display.js';
import { surprise, AVATAR_KEY } from '../avatar.js';
import { catImageURL } from '../cat_guide.js';
import { DASHBOARD_GO_TOPIC } from '../dashboard_nest.js';
import { HOME_STATE_KEY, readHomeSettings } from '../home_dashboard.js';
import {
  PROFILE_TYPE, SEED_CHARACTERS, ROOM_TEMPLATES, ROOM_TEMPLATE_ORDER, VOICE_CHOICES, DEFAULT_VOICE, PORTRAITS,
  AI_STATE_KEY, NAME_MAX, PERSONA_MAX, GOOD_AT_MAX, voiceChoice, voiceData, allCharacters, readCharacterRow,
  withCharacter, withoutCharacter, createCharacter, editCharacter, copyCharacter, profileEntries, readSubject,
  openCharacterStore, ownDrawing, createRoomMaker, characterSystemPrompt,
} from '../ai_characters.js';

export const SUBJECT_KEY = 'subject';
export const DEFAULT_SUBJECT = Object.freeze({ kind: 'ai', id: 'nimrod' });
/** Who a panel with no stored subject shows (see the header): the viewer, else Nimrod. PURE. */
export function defaultSubject(viewerId = null) {
  return typeof viewerId === 'string' && viewerId ? { kind: 'person', id: viewerId } : { ...DEFAULT_SUBJECT };
}
export const PROFILE_VERB_TOPICS = Object.freeze({
  next: 'profile/next', prev: 'profile/prev', select: 'profile/select', back: 'profile/back',
});
// The card's face. In rem so the person's text size carries it; the panel's own "make it bigger" (the
// transport bar) enlarges the whole card. Not a setting, argued: one more row for a size that the two
// existing ways already change. 6rem is a face you read across a room on a 1080p screen, and still leaves
// a quarter panel room for the name and the buttons. [Guess, on Mike's list.]
export const FACE_SIZE = '6rem';
export const CHAT_FACE_SIZE = '2.4rem';
export const LOG_SHOWN = 20;            // the last turns drawn; the chat keeps nimrod_ai.js's KEEP_TURNS
// A remove is two presses; the first one waits this long for the second (then it is forgotten: inaction
// removes nothing).
export const REMOVE_ARM_MS = 6000;

// The Call button's reasons, in words (Design's rule: dimmed, never hidden, says why).
export const CALL_ON_SCREEN = 'Calls are placed from a phone or a computer, at /call.html. A screen answers calls; it does not place them.';
export const CALL_NOT_ALLOWED = 'This account may not call them. Whoever looks after their screens can share them with you, on their Remote tab.';
export const CALL_CHECKING = 'Checking whether this account may call them…';
export const CALL_HELP = 'A video or audio call to their screens, from this phone or computer.';
export const callURL = (personId) => `/call.html?person=${encodeURIComponent(personId)}`;

/** May this account call `personId`? PURE. The same people call_page.js offers: the account's own (`own`, from
 *  /api/people) and those shared with it by a live drive grant (`shared`, /api/drive/shared rows). true / false,
 *  or null while it cannot be told yet (a list still loading). */
export function mayCall(personId, { own = null, shared = null } = {}) {
  if (!personId) return false;
  if (Array.isArray(own) && own.some((p) => p && p.id === personId)) return true;
  if (Array.isArray(shared) && shared.some((p) => p && p.person_id === personId)) return true;
  return own === null || shared === null ? null : false;
}

/** Is this panel on a SCREEN (the real kiosk), where a call is never placed? PURE over the DOM it is handed.
 *  The kiosk draws its panels inside `.kiosk`; when it is only embedded in another page (Home, the modules
 *  page: module_try.js `mountEmbeddedKiosk`) that element also carries `.k-embed` and is not a screen.
 *  A panel not on a page yet, or on kiosk.html itself, counts as a screen: it offers nothing it cannot keep. */
export function onScreen(mount, pathname = (typeof location !== 'undefined' ? location.pathname : '')) {
  if (mount?.closest?.('.k-embed')) return false;
  if (mount?.closest?.('.kiosk')) return true;
  if (/\/kiosk\.html$/.test(String(pathname || ''))) return true;
  return !mount?.isConnected;
}
export const NO_LINKS_NOTE = 'Friends on other accounts will show here once accounts can be linked.';

export const PROFILE_SETTINGS = Object.freeze([
  { key: 'speak', label: 'Read the AI’s replies aloud', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No — words only',
    help: 'The reply goes to the screen’s voice, in the character’s voice choice, if this screen speaks.' },
]);
const FIELDS = PROFILE_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);
export function profilePrefs(values = {}) {
  const out = {};
  for (const f of FIELDS) out[f.key] = fieldValue(f, values || {});
  return out;
}

/** What to tell somebody with no AI connected: the three ways, in plain words. */
export function connectHelpFor(name) {
  return `To talk to ${name}, connect an AI to this device (Connect an AI…, below, or “About” in Nimrod’s panel):`
    + ` free on this computer with Ollama (ollama.com: download a model such as qwen2.5:3b, and let this website use it`
    + ` with Ollama’s OLLAMA_ORIGINS setting; the address is ${DEFAULT_BASE_URL});`
    + ' or any online service that speaks the OpenAI API, free or with your own key (its address, a model name and the key;'
    + ' the key stays in this browser and goes only to that address). Nothing is sent anywhere until you talk.';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every colour is a theme token; sizes in rem.
const STYLE = `
.pf-root{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;color:var(--text);font:inherit}
.pf-card{display:flex;align-items:center;gap:14px}
.pf-face{flex:0 0 auto;display:flex;align-items:center;justify-content:center}
.pf-face img{display:block;object-fit:contain}
.pf-initial{display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--surface-alt);
  color:var(--text-strong);font-weight:700;font-size:2.4rem}
.pf-name{font-size:1.3rem;color:var(--text-strong)}
.pf-line{margin:2px 0 0;color:var(--text)}
.pf-kind{color:var(--text-muted);font-size:.9rem}
.pf-btns{display:flex;flex-wrap:wrap;gap:8px}
.pf-btn{min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer;text-align:left}
.pf-btn[disabled]{opacity:.5;cursor:default}
a.pf-btn{display:inline-flex;align-items:center;box-sizing:border-box;text-decoration:none}
.pf-btn.is-warn{border:2px solid var(--scan-ring, var(--highlight))}
.pf-btn.is-scan,.pf-btn:focus-visible{outline:3px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.pf-btn[aria-pressed="true"]{background:var(--surface-alt);font-weight:700}
.pf-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.pf-list .pf-btn{width:100%;display:flex;align-items:center;gap:10px}
.pf-list small{color:var(--text-muted)}
.pf-h{margin:6px 0 0;font-size:1rem;color:var(--text-strong)}
.pf-note,.pf-status{margin:0;color:var(--text-muted)}
.pf-help,.pf-box{padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface)}
.pf-box label{display:block;margin:6px 0 2px;color:var(--text-muted)}
.pf-box input,.pf-box textarea,.pf-row input{box-sizing:border-box;width:100%;min-height:44px;padding:8px 10px;border-radius:10px;
  border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit}
.pf-box textarea{min-height:6em}
.pf-row{display:flex;gap:8px;align-items:stretch}
.pf-log{display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto}
.pf-msg{margin:0;padding:6px 10px;border-radius:10px;line-height:1.4;background:var(--surface)}
.pf-msg.is-user{align-self:flex-end;background:var(--surface-alt)}
.pf-msg.is-failed{opacity:.6}
.pf-msg b{margin-right:4px}
`;

registerModule(
  { type: PROFILE_TYPE, title: 'Profile', core: 'new', dependsOn: 'none', importance: 'normal',
    description: 'A person or an AI character as a card: their face, their name, and what you can do with them — talk to an AI, visit its room',
    settings: PROFILE_SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    let root = null;
    let torn = false;
    let prefs = profilePrefs({});
    let subject = { ...DEFAULT_SUBJECT };
    let view = 'card';            // 'card' | 'pick' | 'edit' | 'talk'
    let cursor = 0;
    let notice = '';
    let store = null;             // ai_characters.js openCharacterStore
    let row = {};                 // the person's characters row, as last read
    let aiRow = null;             // nimrod_ai.js's record: "your AI"'s name and persona, for the Nimrod card
    let people = null;            // [{ id, name }] once asked; null = not asked / not available
    let peopleAsked = false;      // loadPeople has answered (people may still be null: none to be had)
    let peopleNote = '';
    let shared = null;            // /api/drive/shared rows, for Call (mayCall); null = not asked yet
    let sharedAsking = false;
    let homes = new Map();        // person id -> homeId | null (read once each)
    let avatars = null;           // avatar_display.js cache, for people's faces (made on first need)
    let draft = null;             // the edit form: { mode, id?, name, persona, goodAt, drawn, faceN, voice, room }
    let ownFace = null;           // the viewer's own drawn avatar, for "Use my own avatar's face"
    let removeArmed = null, removeTimer = null;
    let visiting = null;          // the room id being made right now
    const offs = [];
    let offState = null;

    // ---- the AI (only woken by a press) --------------------------------------------------------------
    let aiClient = null;
    const ai = () => aiClient || (aiClient = ctx.ai || createAI());
    let status = { state: 'unchecked', model: '', reason: '' };
    let chat = null, chatFor = null;
    let thinking = false, inflight = null, sendChain = Promise.resolve();
    let saidId = null;
    let setupOpen = false;

    const stateGet = () => { try { return ctx.state?.get?.() || {}; } catch { return {}; } };
    const stateSet = (patch) => { try { ctx.state?.set?.(patch); } catch { /* a preview with no state */ } };
    const viewerId = () => { try { return ctx.personId || null; } catch { return null; } };
    function publish(topic, payload) { try { ctx.bus?.publish?.(topic, payload); } catch (err) { console.error('profile: publish', err); } }

    const characters = () => allCharacters(row, { aiRow });
    const currentChar = () => (subject.kind === 'ai' ? characters().find((c) => c.id === subject.id) || null : null);
    const currentPerson = () => (subject.kind === 'person' ? (people || []).find((p) => p.id === subject.id) || { id: subject.id, name: '' } : null);

    async function ensureStore() {
      if (store) return store;
      store = await openCharacterStore(ctx);
      if (torn) { store.destroy(); return store; }
      row = store.get() || {};
      return store;
    }
    async function readAIRow() {
      const pid = viewerId();
      if (!pid || typeof ctx.makePersonState !== 'function') return;
      let h = null;
      try { h = ctx.makePersonState(pid, AI_STATE_KEY); } catch { h = null; }
      if (!h) return;
      try { await h.load?.(); aiRow = h.get?.() || null; } catch { aiRow = null; } finally { try { h.destroy?.(); } catch { /* gone */ } }
    }
    async function loadPeople() {
      if (typeof ctx.profiles?.people !== 'function') { people = null; peopleNote = ''; peopleAsked = true; return; }
      try { people = (await ctx.profiles.people()) || []; peopleNote = ''; }
      catch { people = null; peopleNote = 'The people on this account could not be read just now.'; }
      peopleAsked = true;
    }
    // Who else's screens this account may use (a drive grant), for Call. Asked once, and only off a screen
    // for a person who is not one of the account's own (whom it may always call). No list = nobody shared.
    function loadShared() {
      if (shared !== null || sharedAsking) return;
      if (typeof ctx.profiles?.sharedWithMe !== 'function') { shared = []; return; }
      sharedAsking = true;
      Promise.resolve().then(() => ctx.profiles.sharedWithMe())
        .then((r) => { shared = Array.isArray(r) ? r : []; }, () => { shared = []; })
        .then(() => { sharedAsking = false; if (!torn) render(); });
    }
    let peopleAsking = false;
    function askPeople() {
      if (peopleAsking) return;
      peopleAsking = true;
      loadPeople().finally(() => { peopleAsking = false; if (!torn) render(); });
    }
    const callable = (pid) => mayCall(pid, { own: Array.isArray(people) ? people : (peopleAsked ? [] : null), shared });
    const callButton = (p) => {
      // The kiosk says so when it can (ctx.isScreen); otherwise the page is read (`onScreen`).
      if (typeof ctx?.isScreen === 'boolean' ? ctx.isScreen : onScreen(mount)) return btn('call', 'Call', { disabled: true, help: CALL_ON_SCREEN });
      const may = callable(p.id);
      if (may === null) { if (peopleAsked) loadShared(); else askPeople(); return btn('call', 'Call', { disabled: true, help: CALL_CHECKING }); }
      if (!may) return btn('call', 'Call', { disabled: true, help: CALL_NOT_ALLOWED });
      return `<a class="pf-btn" data-pf-stop data-pf-do="call" data-pf-id="${esc(p.id)}" href="${esc(callURL(p.id))}"
        title="${esc(CALL_HELP)}" data-help="${esc(CALL_HELP)}">Call</a>`;
    };
    async function homeOf(pid) {
      if (homes.has(pid)) return homes.get(pid);
      homes.set(pid, undefined);
      let id = null;
      if (typeof ctx.makePersonState === 'function') {
        let h = null;
        try { h = ctx.makePersonState(pid, HOME_STATE_KEY); } catch { h = null; }
        if (h) { try { await h.load?.(); id = readHomeSettings(h.get?.() || {}).homeId; } catch { id = null; } finally { try { h.destroy?.(); } catch { /* gone */ } } }
      }
      homes.set(pid, id);
      return id;
    }
    function avatarCache() {
      if (avatars || typeof ctx.makePersonState !== 'function') return avatars;
      avatars = createAvatarCache({ makePersonState: ctx.makePersonState, user: ctx.user || null,
        context: () => { try { return ctx.avatarContext?.() || null; } catch { return null; } } });
      offs.push(avatars.subscribe(() => render()));
      return avatars;
    }

    // ---- faces ----------------------------------------------------------------------------------------
    function faceOf(entry, size = FACE_SIZE) {
      const px = `width:${size};height:${size}`;
      if (entry.kind === 'ai') {
        const c = characters().find((x) => x.id === entry.id);
        if (!c) return '';
        if (c.portrait && PORTRAITS[c.portrait]) {
          return `<img src="${esc(catImageURL(PORTRAITS[c.portrait].pose))}" alt="" style="${px}" data-pf-portrait="${esc(c.portrait)}">`;
        }
        // A character's face is not somebody else's own avatar, so "show other people's avatars" does not
        // hide it; whether it MOVES still follows every rule a person's face does (avatarMotion).
        let context = null;
        try { context = ctx.avatarContext?.() || null; } catch { context = null; }
        return avatarHtml({ show: 'drawn', drawn: c.avatar.drawn }, { size, animate: true, personId: `ai:${c.id}`,
          context: { ...(context || {}), othersShow: true } });
      }
      const cache = avatarCache();
      const html = cache ? avatarHtml(cache.get(entry.id), { size, animate: size === FACE_SIZE, personId: entry.id }) : '';
      if (html) return html;
      const n = (entry.name || '?').trim().charAt(0).toUpperCase() || '?';
      return `<span class="pf-initial" aria-hidden="true" style="${px}">${esc(n)}</span>`;
    }

    // ---- views ----------------------------------------------------------------------------------------
    const btn = (doWhat, label, { help = '', id = null, disabled = false, extra = '', warn = false } = {}) =>
      `<button type="button" class="pf-btn${warn ? ' is-warn' : ''}" data-pf-stop data-pf-do="${doWhat}"${id != null ? ` data-pf-id="${esc(id)}"` : ''}
        ${disabled ? 'disabled' : ''} ${help ? `title="${esc(help)}" data-help="${esc(help)}"` : ''} ${extra}>${label}</button>`;

    function roomsMakeable() {
      const p = ctx.profiles;
      return !!(p && typeof p.create === 'function' && typeof p.addModule === 'function' && typeof ctx.nestMakeState === 'function');
    }

    function cardHTML() {
      if (subject.kind === 'ai') {
        const c = currentChar();
        if (!c) {
          return `<p class="pf-note">This character is not on this screen any more (it may have been removed).</p>
            <div class="pf-btns">${btn('pick', 'Who…', { help: 'Choose who this panel shows.' })}</div>`;
        }
        const rooms = c.rooms.map((r) => btn('visit', visiting === r.id ? `Opening ${esc(r.name)}…` : `Visit ${esc(r.name)}`, {
          id: r.id, disabled: !roomsMakeable() || !!visiting,
          help: roomsMakeable() ? `${c.name}’s ${r.name.toLowerCase()}, as a dashboard: made the first time, then opened.`
            : 'Rooms open on a screen of your own (sign in): there is nowhere to make one here.' })).join('');
        const mine = !c.seed;
        const armed = removeArmed === c.id;
        return `
          <div class="pf-card">
            <div class="pf-face">${faceOf({ kind: 'ai', id: c.id })}</div>
            <div><b class="pf-name" data-pf-name>${esc(c.name)}</b><p class="pf-line" data-pf-line>${esc(c.goodAt)}</p>
              <div class="pf-kind">${mine ? 'Your AI character' : 'AI character'}</div></div></div>
          <div class="pf-btns">
            ${btn('talk', `Talk to ${esc(c.name)}`, { help: `A conversation with ${c.name}, through the AI connected to this device.` })}
            ${rooms}
          </div>
          <div class="pf-btns">
            ${mine ? btn('edit', 'Change', { help: `Change ${c.name}’s name, way of talking, face, voice or room.` }) : ''}
            ${btn('copy', mine ? 'Copy' : 'Copy to make your own', { help: mine ? 'Make another one from this one.' : 'A copy of your own, to change however you like. This one stays as it is.' })}
            ${mine ? btn('remove', armed ? `Press again to remove ${esc(c.name)}` : 'Remove', { warn: armed, help: 'Two presses. A dashboard already made for its room stays.' }) : ''}
            ${btn('pick', 'Who…', { help: 'Choose who this panel shows.' })}
          </div>`;
      }
      const p = currentPerson();
      const you = viewerId() && p.id === viewerId();
      const home = homes.get(p.id);
      return `
        <div class="pf-card">
          <div class="pf-face">${faceOf({ kind: 'person', id: p.id, name: p.name })}</div>
          <div><b class="pf-name" data-pf-name>${esc(p.name || 'Somebody')}</b><p class="pf-line" data-pf-line>${you ? 'You' : 'On this account'}</p>
            <div class="pf-kind">Person</div></div></div>
        <div class="pf-btns">
          ${callButton(p)}
          ${btn('visit-home', home === undefined ? 'Their Home…' : you ? 'Visit your Home' : 'Visit their Home', {
            disabled: !home, help: home ? 'Open the Home they made.' : home === null ? 'No Home made yet.' : 'Looking for their Home…' })}
          ${btn('pick', 'Who…', { help: 'Choose who this panel shows.' })}
        </div>`;
    }

    function pickHTML() {
      const entries = profileEntries({ people: people || [], characters: characters(), viewerId: viewerId() });
      const row1 = (e) => `<li><button type="button" class="pf-btn" data-pf-stop data-pf-do="choose" data-pf-id="${esc(`${e.kind}:${e.id}`)}"
          aria-pressed="${subject.kind === e.kind && subject.id === e.id}">
          <span class="pf-face">${faceOf(e, CHAT_FACE_SIZE)}</span><span><b>${esc(e.name)}</b><br><small>${esc(e.line || '')}</small></span></button></li>`;
      const persons = entries.filter((e) => e.kind === 'person');
      const ais = entries.filter((e) => e.kind === 'ai');
      return `
        <div class="pf-btns">${btn('close', '‹ Back', { help: 'Back to the card.' })}</div>
        <h3 class="pf-h">People on this account</h3>
        ${persons.length ? `<ul class="pf-list">${persons.map(row1).join('')}</ul>`
          : `<p class="pf-note">${esc(peopleNote || (people === null ? 'Sign in to see the people on your account.' : 'Nobody yet.'))}</p>`}
        <p class="pf-note">${esc(NO_LINKS_NOTE)}</p>
        <h3 class="pf-h">AI characters</h3>
        <ul class="pf-list">${ais.map(row1).join('')}</ul>
        <div class="pf-btns">${btn('new', 'Make a new character', { help: 'Your own: a name, how it talks, a face, a voice and a room.' })}</div>`;
    }

    function editHTML() {
      const d = draft;
      const tpl = ROOM_TEMPLATES[d.room] || ROOM_TEMPLATES.plain;
      return `
        <div class="pf-btns">${btn('cancel-edit', '‹ Cancel', { help: 'Leave without saving.' })}</div>
        <div class="pf-card"><div class="pf-face">${avatarHtml({ show: 'drawn', drawn: d.drawn }, { size: FACE_SIZE, animate: false, context: { othersShow: true } })}</div>
          <div class="pf-btns" style="flex-direction:column">
            ${btn('face', 'Another face', { help: 'A different drawn face. Your own avatar maker draws people; this picks one at random.' })}
            ${ownFace ? btn('myface', 'Use my own avatar’s face', { help: 'The face you drew for yourself, for a character that is you.' }) : ''}
          </div></div>
        <div class="pf-box">
          <label for="pf-f-name">Name</label><input id="pf-f-name" data-pf-field="name" maxlength="${NAME_MAX}" value="${esc(d.name)}">
          <label for="pf-f-persona">How it talks (its persona, in your words)</label>
          <textarea id="pf-f-persona" data-pf-field="persona" maxlength="${PERSONA_MAX}">${esc(d.persona)}</textarea>
          <label for="pf-f-good">What it is good at (one line)</label><input id="pf-f-good" data-pf-field="goodAt" maxlength="${GOOD_AT_MAX}" value="${esc(d.goodAt)}">
        </div>
        <div class="pf-btns">
          ${btn('voice', `Voice: ${esc(voiceChoice(d.voice).label)}`, { help: 'How its replies sound, when this screen speaks. A voice trained on recordings is not built.' })}
          ${btn('room', `Room: ${esc(tpl.name)}`, { help: 'What is in its room: press to step through them.' })}
          ${btn('save-edit', 'Save', { help: 'Keep it. It is yours, on your profile.' })}
        </div>`;
    }

    function hostOf(url) { try { return new URL(url).host; } catch { return String(url || ''); } }
    function statusText(name) {
      switch (status.state) {
        case 'checking': return `Looking for the AI that answers for ${name}…`;
        case 'ok': { let s; try { s = ai().settings(); } catch { s = {}; } return `Connected: ${status.model} at ${hostOf(s.baseUrl)}.${status.reason ? ` ${status.reason}` : ''}`; }
        case 'needs-model': return status.reason;
        case 'none': return `No AI is answering. ${status.reason}`;
        default: return 'Not connected yet.';
      }
    }
    function talkHTML() {
      const c = currentChar();
      if (!c) return cardHTML();
      const n = c.name;
      const log = chat ? chat.log().slice(-LOG_SHOWN).map((m) => `<p class="pf-msg ${m.role === 'user' ? 'is-user' : ''} ${m.failed ? 'is-failed' : ''}">`
        + `<b>${esc(m.role === 'user' ? 'You' : n)}:</b>${esc(m.text)}</p>`).join('') : '';
      const noAI = status.state === 'none' || status.state === 'needs-model';
      let s = {}; let keySaved = false;
      try { s = ai().settings(); keySaved = !!ai().hasKey?.(); } catch { /* defaults */ }
      return `
        <div class="pf-card"><div class="pf-face">${faceOf({ kind: 'ai', id: c.id }, CHAT_FACE_SIZE)}</div><b class="pf-name">${esc(n)}</b></div>
        <div class="pf-btns">${btn('back-card', '‹ Back', { help: 'Back to the card. The conversation is kept while this panel is open.' })}</div>
        <p class="pf-status" data-pf-status role="status">${esc(statusText(n))}</p>
        ${noAI ? `<p class="pf-help" data-pf-help>${esc(connectHelpFor(n))}</p>` : ''}
        <div class="pf-log" data-pf-log aria-live="polite">${log}${thinking ? `<p class="pf-msg"><b>${esc(n)}:</b>…</p>` : ''}</div>
        ${notice ? `<p class="pf-note" data-pf-notice>${esc(notice)}</p>` : ''}
        <div class="pf-row"><input data-pf-field="say" aria-label="${esc(`Type to ${n}`)}" placeholder="${esc(`Type to ${n}…`)}" maxlength="4000">
          ${btn('send', 'Send', { help: `Send what you typed to ${n}.` })}</div>
        <div class="pf-btns">
          ${thinking ? btn('stop', 'Stop', { help: 'Stop waiting for this answer.' }) : ''}
          ${btn('setup', 'Connect an AI…', { help: 'Which AI answers on this device: its address, a model, your own key.', extra: `aria-expanded="${setupOpen}"` })}
        </div>
        ${setupOpen ? `<div class="pf-box" data-pf-setup>
          <label for="pf-f-url">AI address (this device)</label><input id="pf-f-url" data-pf-field="baseUrl" type="url" spellcheck="false" value="${esc(s.baseUrl || DEFAULT_BASE_URL)}">
          <label for="pf-f-model">Model (blank: choose one on this computer automatically)</label><input id="pf-f-model" data-pf-field="model" spellcheck="false" value="${esc(s.model || '')}">
          <label for="pf-f-key">Your own key, if the service needs one (kept in this browser only)</label>
          <input id="pf-f-key" data-pf-field="key" type="password" autocomplete="off" placeholder="${keySaved ? 'A key is saved' : 'None'}">
          <div class="pf-btns" style="margin-top:8px">${btn('savesetup', 'Save and try again', { help: 'Keep these and ask the AI again.' })}</div></div>` : ''}`;
    }

    function stops() { return root ? [...root.querySelectorAll('[data-pf-stop]')].filter((b) => !b.disabled) : []; }
    function paintCursor() {
      const list = stops();
      for (const b of root?.querySelectorAll('.is-scan') || []) b.classList.remove('is-scan');
      if (!list.length) return;
      cursor = ((cursor % list.length) + list.length) % list.length;
      list[cursor].classList.add('is-scan');
    }
    function render() {
      if (!root || torn) return;
      const doc = root.ownerDocument;
      const active = doc.activeElement;
      const hadFocus = !!active && root.contains(active);
      const focusField = hadFocus ? active.dataset?.pfField || null : null;
      const kept = {};
      for (const el of root.querySelectorAll('[data-pf-field]')) kept[el.dataset.pfField] = el.value;
      if (draft) for (const k of ['name', 'persona', 'goodAt']) if (k in kept) draft[k] = kept[k];
      const html = view === 'pick' ? pickHTML() : view === 'edit' && draft ? editHTML() : view === 'talk' ? talkHTML() : cardHTML();
      root.innerHTML = `${html}${notice && view !== 'talk' ? `<p class="pf-note" data-pf-notice role="status">${esc(notice)}</p>` : ''}`;
      for (const el of root.querySelectorAll('[data-pf-field]')) {
        const k = el.dataset.pfField;
        if (k in kept && !['name', 'persona', 'goodAt'].includes(k)) el.value = kept[k];
      }
      paintCursor();
      if (hadFocus) {
        const f = (focusField && root.querySelector(`[data-pf-field="${focusField}"]`)) || stops()[0];
        try { f?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      }
    }

    // ---- talking ----------------------------------------------------------------------------------------
    function chatOf(c) {
      if (chat && chatFor === c.id) return chat;
      chatFor = c.id;
      chat = createGuideChat({
        ai: { chat: (...a) => ai().chat(...a) },
        // THE PERSONA, through nimrod_ai.js's own seam: its `prefs` are a name and a persona.
        prefs: () => { const x = currentChar() || c; return { name: x.name, persona: x.persona }; },
        // A character has no guide to move and nothing to press for it: no actions.
        actions: () => [],
        // The prompt a character should get (ai_characters.js), through createGuideChat's `system` option.
        system: (o) => characterSystemPrompt(currentChar() || c, o),
        model: () => status.model,
      });
      return chat;
    }
    async function checkStatus() {
      status = { ...status, state: 'checking', reason: '' };
      render();
      let s;
      try { s = ai().settings(); } catch { s = { baseUrl: DEFAULT_BASE_URL, model: '' }; }
      // A remote address is never given a model by itself (nimrod.js: it could spend somebody's money).
      if (!isLocalAddress(s.baseUrl) && !s.model) {
        status = { state: 'needs-model', model: '', reason: `Name the model to use at ${s.baseUrl} under Connect an AI.` };
        render(); return status;
      }
      let r;
      try { r = await ai().resolveModel(s.model || ''); } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
      if (torn) return status;
      if (!r?.ok) status = { state: 'none', model: '', reason: r?.reason || 'The AI did not answer.' };
      else if (r.fellBack && !isLocalAddress(s.baseUrl)) status = { state: 'needs-model', model: '', reason: `That service has no model called “${s.model}”.` };
      else status = { state: 'ok', model: r.model, reason: r.fellBack ? `“${s.model}” is not on this computer, so ${r.model} is answering.` : '' };
      render();
      return status;
    }
    function sendText(text) {
      const t = String(text || '').trim();
      if (!t) return sendChain;
      sendChain = sendChain.then(() => doSend(t)).catch((err) => console.error('profile: send', err));
      return sendChain;
    }
    async function doSend(t) {
      const c = currentChar();
      if (torn || !c) return;
      if (status.state !== 'ok') await checkStatus();
      if (torn) return;
      if (status.state !== 'ok') { notice = ''; render(); return; }
      notice = '';
      thinking = true;
      inflight = new AbortController();
      render();
      const r = await chatOf(c).send(t, { signal: inflight.signal });
      thinking = false; inflight = null;
      if (torn) return;
      if (!r.ok) { if (!r.cancelled) { notice = r.reason; if (r.noAI) status = { ...status, state: 'none' }; } render(); return; }
      render();
      speak(r.say, c);
    }
    function speak(text, c) {
      if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; }
      if (!prefs.speak || !text || typeof ctx.output?.say !== 'function') return;
      const data = voiceData(c);
      try { saidId = ctx.output.say(text, { source: AI_SOURCE, ...(data ? { data } : {}) }); } catch (err) { console.error('profile: say', err); }
    }
    function saveSetup() {
      const f = (k) => root?.querySelector(`[data-pf-field="${k}"]`)?.value ?? '';
      try {
        ai().setSettings?.({ baseUrl: f('baseUrl'), model: f('model') });
        const key = f('key');
        if (key.trim()) ai().setKey?.(key);
      } catch (err) { console.error('profile: AI settings', err); }
      const k = root?.querySelector('[data-pf-field="key"]');
      if (k) k.value = '';
      setupOpen = false;
      status = { state: 'unchecked', model: '', reason: '' };
      checkStatus();
    }

    // ---- the person's own characters ---------------------------------------------------------------------
    async function saveRow(next) {
      await ensureStore();
      row = next;
      store.set(next);
      await store.flush?.();
    }
    function setSubject(s) {
      subject = s;
      stateSet({ [SUBJECT_KEY]: { ...s } });
      if (s.kind === 'person') homeOf(s.id).then(() => { if (!torn) render(); });
    }
    async function startEdit(c) {
      draft = c
        ? { mode: 'edit', id: c.id, name: c.name, persona: c.persona, goodAt: c.goodAt, drawn: c.avatar.drawn, faceN: 0, voice: c.voice, room: c.rooms[0]?.template || 'plain', faceChanged: false }
        : { mode: 'new', name: '', persona: '', goodAt: '', drawn: surprise(`new:${Date.now()}`), faceN: 0, voice: DEFAULT_VOICE, room: 'plain', faceChanged: true };
      view = 'edit'; cursor = 0;
      // "An avatar that looks like me": the viewer's own drawing, if they made one (a record read).
      ownFace = null;
      const pid = viewerId();
      if (pid && typeof ctx.makePersonState === 'function') {
        let h = null;
        try { h = ctx.makePersonState(pid, AVATAR_KEY); } catch { h = null; }
        if (h) { try { await h.load?.(); ownFace = ownDrawing(h.get?.() || {}); } catch { ownFace = null; } finally { try { h.destroy?.(); } catch { /* gone */ } } }
      }
      render();
    }
    async function saveEdit() {
      render();          // takes what was typed into `draft`
      const d = draft;
      await ensureStore();
      const cur = store.get() || row;
      let rec;
      if (d.mode === 'new') {
        rec = createCharacter({ name: d.name, persona: d.persona, goodAt: d.goodAt, drawn: d.drawn, voice: d.voice, room: d.room }, { owner: viewerId() });
      } else {
        const was = readCharacterRow(cur).characters.find((c) => c.id === d.id);
        const r = editCharacter(was, { name: d.name, persona: d.persona, goodAt: d.goodAt, voice: d.voice, room: d.room, ...(d.faceChanged ? { drawn: d.drawn } : {}) });
        if (!r.ok) { notice = r.reason; view = 'card'; render(); return; }
        rec = r.rec;
      }
      const w = withCharacter(cur, rec);
      if (w.error) { notice = w.error; render(); return; }
      await saveRow(w.row);
      draft = null; view = 'card';
      setSubject({ kind: 'ai', id: rec.id });
      notice = d.mode === 'new' ? `${rec.name} is made. It is yours, on your profile.` : `${rec.name} is saved.`;
      render();
    }
    async function copyNow() {
      const c = currentChar();
      if (!c) return;
      await ensureStore();
      const rec = copyCharacter(c, { owner: viewerId() });
      const w = withCharacter(store.get() || row, rec);
      if (w.error) { notice = w.error; render(); return; }
      await saveRow(w.row);
      setSubject({ kind: 'ai', id: rec.id });
      notice = `${rec.name} is yours: change anything with Change.`;
      render();
    }
    async function removeNow() {
      const c = currentChar();
      if (!c || c.seed) return;
      if (removeArmed !== c.id) {
        removeArmed = c.id;
        clearTimeout(removeTimer);
        removeTimer = setTimeout(() => { removeArmed = null; render(); }, REMOVE_ARM_MS);
        render(); return;
      }
      removeArmed = null; clearTimeout(removeTimer);
      await ensureStore();
      await saveRow(withoutCharacter(store.get() || row, c.id));
      setSubject({ ...DEFAULT_SUBJECT });
      notice = `${c.name} is removed.`;
      render();
    }

    // ---- rooms ----------------------------------------------------------------------------------------
    let maker = null;
    function roomMaker() {
      if (maker) return maker;
      if (!roomsMakeable()) return null;
      maker = createRoomMaker({
        profiles: ctx.profiles,
        // No local-first cache: "is this room made, and finished?" must be the server's answer (kiosk.js's maker).
        makeSettings: (pid) => ctx.nestMakeState('settings', { cacheKey: null }, pid),
        makeInstanceState: (pid, mid) => ctx.nestMakeState(mid, { cacheKey: null }, pid),
        store: { get: () => (store ? store.get() : row), set: (p) => { row = { ...row, ...p }; store?.set(p); }, flush: () => store?.flush?.() },
        personId: () => viewerId() || '',
      });
      return maker;
    }
    async function visit(roomId) {
      const c = currentChar();
      if (!c || visiting) return;
      await ensureStore();
      const m = roomMaker();
      if (!m) { notice = 'Rooms open on a screen of your own (sign in): there is nowhere to make one here.'; render(); return; }
      visiting = roomId; notice = ''; render();
      let got = null;
      try { got = await m.ensure(c, roomId); }
      catch (err) { console.error('profile: room', err); notice = `Could not open ${c.name}’s room just now. Nothing changed.`; }
      visiting = null;
      if (torn) return;
      if (got) {
        let claimed = false;
        publish(DASHBOARD_GO_TOPIC, { id: got.id, name: got.name, source: 'profile', instanceId: ctx.instanceId || null, claim: () => { claimed = true; } });
        if (!claimed) notice = `${got.name} is ready: it is in your dashboards.`;
      }
      render();
    }
    async function visitHome() {
      const p = currentPerson();
      if (!p) return;
      const id = await homeOf(p.id);
      if (!id) { render(); return; }
      let claimed = false;
      publish(DASHBOARD_GO_TOPIC, { id, source: 'profile', instanceId: ctx.instanceId || null, claim: () => { claimed = true; } });
      if (!claimed) notice = 'Their Home opens on a screen: there is nowhere to open it here.';
      render();
    }

    // ---- presses --------------------------------------------------------------------------------------
    function doPress(what, id) {
      if (what !== 'remove' && removeArmed) { removeArmed = null; clearTimeout(removeTimer); }
      if (what !== 'send') notice = '';
      switch (what) {
        case 'pick': view = 'pick'; cursor = 0; render(); loadPeople().then(() => { if (!torn) render(); }); return;
        case 'close': view = 'card'; cursor = 0; render(); return;
        case 'choose': {
          const [kind, ...rest] = String(id || '').split(':');
          const s = readSubject({ kind, id: rest.join(':') });
          if (s) setSubject(s);
          view = 'card'; cursor = 0; render(); return;
        }
        case 'talk': view = 'talk'; cursor = 0; render(); if (status.state === 'unchecked') checkStatus(); return;
        case 'back-card': view = 'card'; cursor = 0; render(); return;
        case 'send': {
          const el = root?.querySelector('[data-pf-field="say"]');
          const t = el ? el.value : '';
          if (el) el.value = '';
          sendText(t); return;
        }
        case 'stop': try { inflight?.abort(); } catch { /* done */ } return;
        case 'setup': setupOpen = !setupOpen; render(); return;
        case 'savesetup': saveSetup(); return;
        case 'visit': visit(id); return;
        case 'visit-home': visitHome(); return;
        // Only ever drawn as a link (off a screen, for somebody this account may call). A switch's select
        // follows it the way a click does; a click on the link itself never comes here (onClick).
        case 'call': { const a = root?.querySelector('a[data-pf-do="call"]'); if (a) a.click(); return; }
        case 'copy': copyNow(); return;
        case 'edit': { const c = currentChar(); if (c && !c.seed) startEdit(c); return; }
        case 'new': startEdit(null); return;
        case 'remove': removeNow(); return;
        case 'cancel-edit': draft = null; view = 'card'; cursor = 0; render(); return;
        case 'face': render(); draft.faceN += 1; draft.drawn = surprise(`${draft.id || 'new'}:${draft.faceN}:${Date.now()}`); draft.faceChanged = true; render(); return;
        case 'myface': render(); if (ownFace) { draft.drawn = ownFace; draft.faceChanged = true; } render(); return;
        case 'voice': { render(); const i = VOICE_CHOICES.findIndex((v) => v.id === draft.voice); draft.voice = VOICE_CHOICES[(i + 1) % VOICE_CHOICES.length].id; render(); return; }
        case 'room': { render(); const i = ROOM_TEMPLATE_ORDER.indexOf(draft.room); draft.room = ROOM_TEMPLATE_ORDER[(i + 1) % ROOM_TEMPLATE_ORDER.length]; render(); return; }
        case 'save-edit': saveEdit(); return;
        default:
      }
    }
    function onClick(e) {
      const el = e.target instanceof Element ? e.target.closest('[data-pf-do]') : null;
      if (!el || !root?.contains(el) || el.disabled) return;
      cursor = Math.max(0, stops().indexOf(el));
      if (el.tagName === 'A') return;   // a link (Call): the browser follows it
      doPress(el.dataset.pfDo, el.dataset.pfId ?? null);
    }
    function onKey(e) {
      if (e.key === 'Enter' && e.target instanceof Element && e.target.matches('[data-pf-field="say"]')) { e.preventDefault(); doPress('send'); }
    }
    function back() {
      if (view === 'card') return;
      if (view === 'edit') { draft = null; }
      view = 'card'; cursor = 0; render();
    }

    return {
      async init() {
        root = mount.ownerDocument.createElement('div');
        root.className = 'pf-root';
        root.setAttribute('data-profile-card', '');
        const style = mount.ownerDocument.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKey);
        try { await ctx.state?.load?.(); } catch { /* a preview, or offline: the defaults stand */ }
        if (torn) return;
        const s = stateGet();
        prefs = profilePrefs(s);
        // Nothing stored: whoever is looking (see the header), else Nimrod.
        subject = readSubject(s[SUBJECT_KEY]) || defaultSubject(viewerId());
        // RECORDS ONLY: the person's characters, their AI's name, and (for a person) whose Home. No AI call.
        await Promise.all([ensureStore().catch(() => {}), readAIRow()]);
        if (torn) return;
        if (subject.kind === 'person') { await loadPeople(); homeOf(subject.id).then(() => { if (!torn) render(); }); }
        render();
        try {
          offState = ctx.state?.subscribe?.((v) => {
            const next = profilePrefs(v || {});
            const sub = readSubject((v || {})[SUBJECT_KEY]);
            let changed = next.speak !== prefs.speak;
            prefs = next;
            if (sub && (sub.kind !== subject.kind || sub.id !== subject.id)) { subject = sub; changed = true; }
            if (changed) render();
          }) || null;
        } catch { offState = null; }
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(PROFILE_VERB_TOPICS.next, () => { cursor += 1; paintCursor(); });
        on(PROFILE_VERB_TOPICS.prev, () => { cursor -= 1; paintCursor(); });
        on(PROFILE_VERB_TOPICS.select, () => { const b = stops()[cursor]; if (b) { doPress(b.dataset.pfDo, b.dataset.pfId ?? null); } });
        on(PROFILE_VERB_TOPICS.back, back);
      },
      onResize() {},
      onHide() { if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; } },
      destroy() {
        torn = true;
        clearTimeout(removeTimer);
        try { inflight?.abort(); } catch { /* done */ }
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        try { avatars?.destroy(); } catch { /* gone */ }
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } }
        try { store?.destroy(); } catch { /* gone */ }
        root?.removeEventListener('click', onClick);
        root?.removeEventListener('keydown', onKey);
        mount.innerHTML = '';
        root = null;
      },
      __probe: () => ({ view, subject: { ...subject }, prefs: { ...prefs }, status: { ...status }, notice, thinking,
        log: chat ? chat.log() : [], draft: draft ? { ...draft } : null, row: JSON.parse(JSON.stringify(row || {})),
        stops: stops().map((b) => b.textContent.trim()), storeKind: store?.kind || null, visiting }),
      __settled: () => sendChain,
    };
  },
);

export { SEED_CHARACTERS };
