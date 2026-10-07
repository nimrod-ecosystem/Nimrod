// modules/people.js — "YOUR PEOPLE", type 'people': the landing as a very simple profile page (Mike, 2026-10-04,
// DECISIONS.md "The landing is a very simple profile page"). The rules are people_page.js's; this draws them.
//
// TOP TO BOTTOM: your own card (your picture, your name, "Edit my picture"); messages left for you; a card for each
// of your people (their picture, their name, and five big buttons: Call, Send a message, Share a picture, a song, a
// video); "Connect with someone"; "More" (the fuller Start here); "Ask Nimrod". Nimrod also sits at the bottom of the
// page as a small helper over it (modules/helper.js, an "over the dashboard" overlay): pressing him opens him here.
//
// *** WHAT EACH BUTTON DOES: THE SIMPLEST REAL THING THAT EXISTS, OR DIMMED WITH WHY. ***
//   Call           a link to /call.html?person=<id> (call_page.js, 2d87fe7), for a person this account may call
//                  (modules/profile.js mayCall: your own people, and screens shared with you). The server's drive
//                  ticket is still the real check, on that page, before anything opens.
//   Send a message the "note from someone" (modules/note.js) left from your own sign-in (note_visit.js, 499c976),
//                  opened over this page: it shows on their screen with your name and the time. Dimmed when the
//                  server says you may not (they have not ticked you) or they have no screen -- asked once per card.
//   Recommend a song or video  a YouTube or Spotify link, with a message if you like (recommend.js), opened over
//                  this page; the same permission as a message. It shows under "Recommended for you" on THEIR page,
//                  with who sent it: Play (YouTube, in the site's own player, one press, on a screen too), Open in
//                  Spotify (off a screen; on a screen the address and a code), Remove (off a screen only).
//   Share a picture dimmed, "coming soon": nothing puts a picture on somebody else's screen yet.
//   Edit my picture the avatar maker (modules/avatar.js), opened over this page, saving to YOUR record.
//   PEOPLE ACROSS ACCOUNTS (2026-10-04 night, claim.js; the rules are web/server/claims.py). A profile has a home
//                  (the login that looks after it) and shows on other logins' pages, each calling them what it likes.
//                  Connect with someone  a link (and a code to scan) that, opened and signed in to, puts you on
//                  each other's page, like friends; the window picks which of your people come with it (just you,
//                  by default) and whether they may leave messages for each.
//                  Invite them to use this  under each of the people you look after but you: the same link, and
//                  opened, that person becomes the opener's own profile (their name, picture and page) - your card
//                  keeps what you called them, says "— joined", and you can no longer rename them or change the
//                  picture (I call them… instead).
//                  On a card a connection put here: I call them… (your own name for them), Messages from them:
//                  on / off, and Stop sharing (two presses; it ends the connection with that login). Call, message
//                  and recommend go where that person can be reached (`reach`, from the server), each live or dimmed
//                  by the same rules as everybody else's.
//                  ONE CARD AT A TIME (claims.py): "Remove just this card" on such a card (two presses; the
//                  connection stays), dimmed with why when the server says no (`remove`); "Shared with 2" (dimmed
//                  "Not shared yet") on each of the people you look after and on your own card, opening the list
//                  of other logins that hold it, each with "Stop sharing with <name>". (First built as "Who has
//                  this card"; renamed 2026-10-05, Mike found it confusing.)
//                  I CALL THEM… ON EVERY CARD (Mike, 2026-10-05: "can be added at any time, on any card"): on the
//                  people you made too, where it is your private label beside the name on their card. Not on your
//                  own card, nor on a screen shared with you (there is no card of yours to hold it).
//                  WHO SEES IT (Mike, 2026-10-05: "at account vs user levels"): the window asks "Everyone on this
//                  login" or "Just <the person this page is for>", and the people are read as that person (their own
//                  label first, then the login's, then the name on the card; their own card by the name on it).
//
// *** ON A SCREEN IN SOMEBODY'S ROOM (`ctx.isScreen`) IT IS FACES AND NAMES, AND WHAT CAME IN. *** A screen never
// places a call (kiosk.js; modules/profile.js) and never sends anything, so none of the five buttons could ever act
// there. ARGUED, the other way being every card's five buttons dimmed: FOR dimmed, "dimmed, never hidden" is Design's
// rule. AGAINST, and it decides it: that rule is about a control that can act SOMEWHERE and cannot right now; on a
// screen these never can, and five grey buttons per face, all day and all night, in front of somebody who may not be
// able to press anything is noise where their family's faces should be. So the screen shows the faces, the messages
// left for its person, and ONE line saying calls and messages are made from a phone or computer, with the address
// and a code to scan (page_links.js). "More" and "Ask Nimrod" stay (a carer at the screen can use both; Nimrod
// closes by himself after the person's "close after", see people_page.js).
//
// NOTHING IS SENT WITHOUT A PRESS. Mounting reads records (who, which face, may I call or leave a message, what
// came in); it never calls, never writes, never speaks.
//
// *** "EDIT MY PAGE" (2026-10-04, later; the rules are page_sections.js). *** The page is drawn as a single column of
// SECTIONS in the order the person's own page record says (`PAGE_KEY` in their per-person state), and today's parts
// are the default sections: You, Messages for you, Recommended for you, Your people, Connect with someone, Ask Nimrod.
// "Edit my page" (beside "Edit my picture") turns on an edit bar over each section -- Move up, Move down, Remove, and
// that section's own few options -- and a card under You with "Add something" (a short library, in a window over the
// page), "Done", "Put back" (the last thing removed) and, once Your people is removed, "Show your people again".
//   ONE COLUMN AT EVERY WIDTH, no side column on a wide screen. FOR a side column: a computer has the room, and a
//   profile page there often uses it. AGAINST, and it decides it for now: the page as it was before this had none,
//   and nothing may look different for somebody who never edits; a side column is a later choice the page can offer.
//   A BOX (a clock, pictures, a video) is the site's own thing mounted the normal way (mountModule) in a
//   box of the section's height, kept mounted across redraws (each section is its own element, so redrawing the
//   page never tears a box down; only removing that section does). Its settings live in the section's `options`, set
//   from its edit bar; what the thing itself changes while it runs (photos picking its first source) stays in memory,
//   so mounting the page still writes nothing.
//   ON A SCREEN the page is drawn from the same record, and "Edit my page" is shown dimmed with why: a page is
//   changed from a phone or computer.
//   WHO SEES IT (2026-10-04 night, items 7-9; page_sections.js WHO_WORDS, the server's rule page_visits.py): the card
//   under You says "Who can see my page" (Only me / People I'm connected with, the default / Only the people I pick,
//   with a button per person), and each part's edit bar "Who sees this" (Only me, the default / People who can see my
//   page) -- or, for a part that is only ever yours (Messages for you, Recommended for you, Your people, Connect with
//   someone, Ask Nimrod), a dimmed "Only you see this" that says why. On a card a connection put here, "See their
//   page" opens theirs read-only (page_visit.js), dimmed with why when they have not opened it to you; "Messages for
//   you" has "See older messages".
//   THE PAGE'S OWN LOOK (Mike, 2026-10-05; page_sections.js argues both): the card under You also has "Colours for
//   my page" (the site's own themes, the list the settings menu's Colours row offers) and "Let this page show older
//   messages" (default on). The colours are worn on this page (page_visit.js wearColours) and on the page a visitor
//   opens, unless whoever is looking uses colours for reading, like High contrast; on a screen the screen's own
//   Colours stand. "See older messages" is offered when the page allows it AND this page's own "Offer older
//   messages here" row (people_page.js, per screen) is on; otherwise it is dimmed with which one turned it off.
//   MESSAGES FOR YOU REMOVED: the newest message still shows, as one "Latest message" line on your own card, so a
//   message left for you is never only on a page you took it off. ASK NIMROD REMOVED: "More" moves onto your card,
//   so your settings stay one press away.

import { registerModule, mountModule, getManifest, extendCtx } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { authHeaders } from '../auth.js';
import { createBus } from '../bus.js';
import { avatarHtml, createAvatarCache } from '../avatar_display.js';
import { catImageURL } from '../cat_guide.js';
import { elsewhereHTML, themeQrColours, openPageTab } from '../page_links.js';
import {
  mountRecommend, mountRecommendedVideo, recommendationsURL, markURL, playPlan, recLine, recThumbHTML, recElsewhereHTML,
  kindWords, REC_WORDS,
} from '../recommend.js';
// Connect with someone / Invite them to use this / I call them / Stop sharing (claim.js; the rules are claims.py).
import { createClaimsClient, mountInviteSheet, mountCallName, mountHolders, removeWhy, twoPress, kindSub, CLAIM_WORDS, STOP_CONFIRM_MS } from '../claim.js';
import { mountNoteVisit, screensURL, noteURL } from '../note_visit.js';
import { currentNote, whenOf, whenWords } from './note.js';
import { mayCall, callURL } from './profile.js';
import { SHELL_HOST } from '../shell_verbs.js';
import { DASHBOARD_GO_TOPIC } from '../dashboard_nest.js';
import {
  PEOPLE_TYPE, PEOPLE_SETTINGS, PEOPLE_VERB_TOPICS, HELPER_OPEN_TOPIC, WHY, connectionsFrom, actionsFor,
  noteStatusFrom, scanModeOf, stepCursor, incomingFrom,
} from '../people_page.js';
import {
  PAGE_KEY, EDIT_WORDS, BOX_SIZES, BOX_SIZE_LABELS, DEFAULT_BOX_SIZE, ABOUT_MAX, viewSections, hasKind, addSection, removeSection,
  restoreSection, canMove, moveSection, updateSection, videoOf, aboutText, libraryEntry, addableEntries, mergePageDoc, boxHeight,
  WHO_KEY, PICKED_KEY, WHO_CHOICES, WHO_WORDS, SEEN_KEY, whoOf, pickedOf, togglePicked, canOpen, seenByOf,
  THEME_KEY, OLDER_KEY, ACCESS_THEMES, PAGE_LOOK_WORDS, themeOf, olderOf, pageColours,
} from '../page_sections.js';
// See their page / See older messages (page_visit.js; the server's rules are page_visits.py and notes.py).
import {
  mountPageVisit, mountOlderMessages, VISIT_WORDS, OLDER_WORDS, wearColours, viewerThemeOf, wantsMoreContrast, knownThemes,
} from '../page_visit.js';
import { listThemes } from '../theme.js';
// "Theme for my page" (2026-10-07): the same theme gallery as the Theme tab and the Themes panel.
import { mountChoicePicker, previewOf } from '../choice_picker.js';

// The site's own things a page box can hold, loaded the first time one is on a page (page_sections.js SECTION_LIBRARY).
const BOX_LOADERS = Object.freeze({
  clock: () => import('./clock.js'),
  photos: () => import('./photos.js'),
  youtube: () => import('./youtube.js'),
});
// How long About me waits after the last key before saving. ARGUED, not a setting: long enough that a word typed is
// one write rather than one per letter, short enough that closing the page straight after typing has saved it.
export const ABOUT_SAVE_MS = 600;

// The page "More" opens (dashboards.js `start`), and the act Home's page answers for it (modules.html homePress).
export const MORE_KEY = 'start';
export const MORE_ACT = 'more';
// Where a screen says calls are made (page_links.js shows it as an address and a code).
export const CALL_PAGE = '/call.html';
// A screen re-reads the messages left for its person this often. ARGUED rather than a setting: a message is not a
// call (calls ring through their own path), so a few minutes late costs nothing, and a screen asking more often is
// a request every minute, all night, from every screen; off a screen the page reads them when it opens and whenever
// it is looked at again. 5 minutes.
export const INCOMING_REFRESH_MS = 300000;
// The faces. In rem so the person's text size carries them (modules/profile.js FACE_SIZE's reasoning): 5rem for
// you at the top, 4rem on each card -- a face you know at a glance on a phone, with room beside it for a name.
export const SELF_FACE = '5rem';
export const CARD_FACE = '4rem';

const FIELDS = PEOPLE_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);
export function peoplePrefs(values = {}) {
  const out = {};
  for (const f of FIELDS) out[f.key] = fieldValue(f, values || {});
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every colour a theme token; sizes in rem; every target at least 44px (48px here) tall.
const STYLE = `
.pp-root{box-sizing:border-box;height:100%;overflow:auto;padding:16px 16px 9rem;color:var(--text);font:inherit;font-size:1.05rem;position:relative}
.pp-list{display:flex;flex-direction:column;gap:14px;max-width:46rem;margin:0 auto}
.pp-card{border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:14px;display:flex;flex-direction:column;gap:12px}
.pp-card.is-scan{outline:4px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.pp-who{display:flex;align-items:center;gap:14px;min-width:0}
.pp-face{flex:0 0 auto;display:flex;align-items:center;justify-content:center}
.pp-face img{display:block;object-fit:contain}
.pp-initial{display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--surface-alt);color:var(--text-strong);font-weight:700}
.pp-name{font-size:1.3rem;font-weight:700;color:var(--text-strong);overflow-wrap:anywhere}
.pp-self .pp-name{font-size:1.6rem}
.pp-sub{margin:2px 0 0;color:var(--text-muted)}
.pp-h{margin:4px 2px 0;font-size:1.1rem;color:var(--text-strong)}
.pp-btns{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:10px}
.pp-btn{box-sizing:border-box;min-height:48px;padding:10px 12px;border-radius:12px;border:2px solid var(--border);background:var(--surface);
  color:var(--text-strong);font:inherit;font-weight:600;cursor:pointer;text-align:left;text-decoration:none;display:flex;flex-direction:column;justify-content:center}
.pp-btn.is-go{border-color:var(--accent)}
.pp-btn small{font-weight:400;color:var(--text-muted);font-size:.85rem}
.pp-btn[aria-disabled="true"]{opacity:.55;cursor:default}
.pp-btn.is-scan,.pp-btn:focus-visible{outline:4px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.pp-why{margin:0;color:var(--text);min-height:0}
.pp-why:empty{display:none}
.pp-note{margin:0;color:var(--text-muted)}
.pp-msg{margin:0;padding:10px 12px;border-radius:12px;background:var(--surface-alt);color:var(--text)}
.pp-msg b{color:var(--text-strong)}
.pp-faces{display:grid;grid-template-columns:repeat(auto-fill,minmax(8rem,1fr));gap:14px}
.pp-faces .pp-who{flex-direction:column;text-align:center}
.pp-sheet{position:absolute;inset:0;z-index:5;background:var(--bg);color:var(--text);display:flex;flex-direction:column}
.pp-sheet-top{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border)}
.pp-sheet-top b{font-size:1.15rem;color:var(--text-strong)}
.pp-sheet-body{position:relative;flex:1 1 auto;min-height:0;overflow:auto}
.pp-sec,.pp-sec-body{display:contents}
.pp-sec.is-edit{display:flex;flex-direction:column;gap:10px;border:2px dashed var(--border);border-radius:18px;padding:8px}
.pp-sec.is-edit>.pp-sec-body{display:flex;flex-direction:column;gap:14px}
.pp-edit{background:var(--surface-alt)}
.pp-edit [data-pp-edit-for]{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pp-edit [data-pp-edit-for] .pp-btn{padding:8px;text-align:center;align-items:center}
.pp-box{position:relative;overflow:hidden;border-radius:12px;background:var(--surface-alt)}
.pp-about{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text)}
.pp-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:10px}
.pp-field{display:flex;flex-direction:column;gap:4px;color:var(--text-strong);font-weight:600}
.pp-field select,.pp-field input,.pp-field textarea{box-sizing:border-box;width:100%;min-height:48px;font:inherit;font-weight:400;padding:8px 10px;
  border-radius:12px;border:2px solid var(--border);background:var(--surface);color:var(--text-strong)}
.pp-field textarea{min-height:8rem;resize:vertical}
.pp-field small{font-weight:400;color:var(--text-muted)}
.pp-lib{display:flex;flex-direction:column;gap:10px;padding:12px;max-width:46rem;margin:0 auto}
.pp-btn[data-pp-act="page-theme"]{border-color:var(--accent)}
.pp-theme-chips{display:flex;gap:4px;margin-top:6px}
.pp-theme-chips span{width:1.3rem;height:1.3rem;border-radius:6px;border:1px solid var(--border)}
.pp-theme{display:flex;flex-direction:column;gap:10px;padding:12px;max-width:60rem;margin:0 auto}
`;

registerModule(
  { type: PEOPLE_TYPE, title: 'Your people', core: 'new', dependsOn: 'server', importance: 'normal',
    description: 'You and your people as cards, with big buttons to call them or leave them a message',
    settings: PEOPLE_SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    let root = null;
    let torn = false;
    let prefs = peoplePrefs({});
    let own = null;               // /api/people rows; null = not read (yet, or not here)
    let shared = null;            // /api/drive/shared rows; null = not read yet
    let peopleNote = '';
    const notes = new Map();      // person id -> 'ok' | 'refused' | 'none' | 'error' (absent: checking)
    let incoming = [];            // people_page.js incomingFrom
    let recs = [];                // recommended to you (recommend.js), newest first
    let armed = null;             // { key, at } - the first press of a two-press "Stop sharing"
    let armTimer = null;
    let avatars = null;
    let sheet = null;             // { kind, title, el, child, personId }
    let why = new Map();          // card key -> the reason last tapped, shown on that card
    let cursor = { level: 'cards', card: 0, at: 0 };
    let closeTimer = null, refreshTimer = null;
    const offs = [];
    let offState = null;
    // "Edit my page" (page_sections.js). pageState: the person's own page record (null: nobody signed in here, or no
    // person-state path on this host -- the default page is drawn and editing is dimmed). pageDoc: its last value.
    let pageState = null, pageDoc = {}, offPage = null, pageOpening = null;
    let editing = false;
    let lastRemoved = null;       // { section, index, name } - what "Put back" puts back
    let saving = Promise.resolve();
    let aboutTimer = null;
    const wrappers = new Map();   // section id -> its element in the list (kept across redraws)
    const boxes = new Map();      // section id -> { inst, st, kind, seen } - a thing mounted in a page box

    const isScreen = () => (typeof ctx.isScreen === 'boolean' ? ctx.isScreen : false);
    const selfId = () => { try { return ctx.personId || ''; } catch { return ''; } };
    // The account the page talks to the site as: the hosting page's (Home's preview has no `ctx.user` on purpose:
    // nothing on a preview writes to your account by itself -- these are reads, and one press-made write).
    const account = () => { try { return ctx.personHost?.user ?? ctx.user ?? null; } catch { return null; } };
    const chooseMode = () => { try { return typeof ctx.chooseMode === 'function' ? ctx.chooseMode() : (ctx.chooseMode || 'point'); } catch { return 'point'; } };
    const makePS = (pid, key, opts) => {
      try { const h = ctx.makePersonState?.(pid, key, opts); if (h) return h; } catch { /* none here */ }
      try { return ctx.personHost?.state?.(pid, key) || null; } catch { return null; }
    };
    const publish = (topic, payload) => { try { ctx.bus?.publish?.(topic, payload); } catch (err) { console.error('people: publish', err); } };
    async function getJSON(url) {
      if (typeof fetch !== 'function') return { status: 0, body: null };
      const r = await fetch(url, { headers: authHeaders(account()), credentials: 'same-origin' });
      return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
    }

    // ---- who ------------------------------------------------------------------------------------------
    // Read AS the person the page is for (`selfId`; claims.seen_name on the server): their own "I call them" first,
    // and their own card by the name on it. Refused (the page's person is not one of this login's own - a page held
    // over from before a change), the login's names, as before, rather than nobody at all.
    async function loadPeople() {
      if (typeof ctx.profiles?.people === 'function') {
        const viewer = selfId();
        try { own = (await ctx.profiles.people(viewer || undefined)) || []; peopleNote = ''; }
        catch {
          try { own = viewer ? ((await ctx.profiles.people()) || []) : null; peopleNote = own ? '' : 'Your people could not be read just now.'; }
          catch { own = null; peopleNote = 'Your people could not be read just now.'; }
        }
      } else { own = null; }
      if (typeof ctx.profiles?.sharedWithMe === 'function') {
        try { const r = await ctx.profiles.sharedWithMe(); shared = Array.isArray(r) ? r : []; } catch { shared = []; }
      } else { shared = []; }
    }
    const claimsClient = () => createClaimsClient({ user: account() });
    const selfRow = () => (Array.isArray(own) ? own.find((p) => p.id === selfId()) : null) || { id: selfId(), name: '' };
    // THE PAGE'S OWN PERSON BY THE NAME ON THEIR CARD, not an "I call them" somebody on the login gave them - on a
    // screen in their room above all. A default, argued in the server's claims.seen_name, which does the same for a
    // read as them; this covers a page that read its people before it knew whose it was.
    const selfName = (me) => String(me?.profile_name || me?.name || '').trim();
    // How many people use this login (a person you made, or one of them who took their card over, keeps screens and
    // a page here; somebody you are connected with or who was shared with you does not): one, and "Just <name>" in
    // "I call them…" would be the same as everyone on the login, so it is dimmed with why.
    const peopleHere = () => (Array.isArray(own) ? own : []).filter((r) => !r.kind || r.kind === 'you' || r.kind === 'mine' || r.kind === 'joined').length;
    // Your account's people and those shared with you (people_page.js), each once. A row of yours carries what the
    // server says it is to you (claims.py): `kind`, where to reach them (`reach`), who it came through (`from`).
    const people = () => {
      const rows = new Map((Array.isArray(own) ? own : []).map((r) => [r.id, r]));
      return connectionsFrom({ own: own || [], shared: shared || [], selfId: selfId() }).map((p) => {
        const r = p.via === 'account' ? rows.get(p.id) : null;
        if (!r) return { ...p, reach: p.id };
        return { ...p, reach: r.reach || p.id, kind: r.kind || 'mine', home: r.home !== false, from: r.from || '',
          linked: !!r.linked, messagesFromThem: !!r.messages_from_them, callName: r.call_name || '', profileName: r.profile_name || p.name,
          viewerCallName: r.viewer_call_name || '',
          visit: typeof r.page === 'string' ? r.page : null,
          holders: Number.isFinite(r.holders) ? r.holders : null, remove: typeof r.remove === 'string' ? r.remove : null };
      });
    };
    const mayCallNow = (pid) => mayCall(pid, { own: Array.isArray(own) ? own : null, shared });

    // May a message be left for them? Asked once per person they can be reached at, off a screen only (a screen
    // sends nothing). Keyed by `reach`: a card a connection put here asks the person it reaches, on their login.
    async function checkNotes() {
      if (isScreen()) return;
      // (A signed-in browser needs no `user`: its cookie goes with the request. Nobody signed in: the server says no,
      // and the button says to try later rather than "Checking…" for ever.)
      const ids = [...new Set(people().map((p) => p.reach))].filter((id) => id && !notes.has(id));
      await Promise.all(ids.map(async (id) => {
        try { const r = await getJSON(screensURL(id)); notes.set(id, noteStatusFrom(r.status, r.body)); }
        catch { notes.set(id, 'error'); }
      }));
    }

    // What came in: the note each of YOUR screens shows (note_visit.js's own routes; the owner may always read).
    async function loadIncoming() {
      const me = selfId();
      if (!me || !prefs.incoming) { incoming = []; return; }
      try {
        const s = await getJSON(screensURL(me));
        const list = (s.body && Array.isArray(s.body.screens) ? s.body.screens : []).slice(0, 6);
        const rows = await Promise.all(list.map(async (sc) => {
          try { const r = await getJSON(`${noteURL(me, sc.id, 'note')}?limit=20`); return { name: sc.name, note: currentNote(r.body?.events || []) }; }
          catch { return { name: sc.name, note: null }; }
        }));
        incoming = incomingFrom(rows, { limit: prefs.incoming, whenOf });
      } catch { incoming = []; }
    }
    // Recommended to you: the songs and videos sent to the person this page is for (the owner's read).
    async function loadRecommended() {
      const me = selfId();
      if (!me || !prefs.recommended) { recs = []; return; }
      try {
        const r = await getJSON(`${recommendationsURL(me)}?limit=${prefs.recommended}`);
        recs = r.body && Array.isArray(r.body.recommendations) ? r.body.recommendations : [];
      } catch { recs = []; }
    }
    const loadInbox = () => Promise.all([loadIncoming(), loadRecommended()]);

    function avatarCache() {
      if (avatars) return avatars;
      const pid = selfId();
      if (!pid || !makePS(pid, 'avatar')) return null;
      avatars = createAvatarCache({ makePersonState: makePS, user: account(),
        context: () => { try { return ctx.avatarContext?.() || null; } catch { return null; } } });
      offs.push(avatars.subscribe(() => render()));
      return avatars;
    }
    function faceOf(p, size) {
      const cache = avatarCache();
      const html = cache && p.id ? avatarHtml(cache.get(p.id), { size, animate: false, personId: p.id }) : '';
      if (html) return html;
      const n = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
      return `<span class="pp-initial" aria-hidden="true" style="width:${size};height:${size};font-size:calc(${size} * .45)">${esc(n)}</span>`;
    }

    // ---- drawing --------------------------------------------------------------------------------------
    const button = (a, cardKey) => {
      const dim = !a.enabled;
      const id = `pp-why-${esc(cardKey)}`;
      const inner = `${esc(a.label)}${a.short ? `<small>${esc(a.short)}</small>` : ''}`;
      const common = `class="pp-btn${a.enabled && (a.act === 'call' || a.act === 'message' || a.act === 'recommend' || a.act === 'rec-play') ? ' is-go' : ''}" data-pp-stop data-pp-act="${esc(a.act)}"
        data-pp-card-key="${esc(cardKey)}" ${a.reason ? `data-pp-why="${esc(a.reason)}" title="${esc(a.reason)}" data-help="${esc(a.reason)}"` : ''}
        ${dim ? `aria-disabled="true" aria-describedby="${id}"` : ''}`;
      if (a.href && !dim) return `<a ${common} href="${esc(a.href)}">${inner}</a>`;
      return `<button type="button" ${common}>${inner}</button>`;
    };
    const card = (key, inner, extra = '') => `<section class="pp-card${extra}" data-pp-card="${esc(key)}">${inner}
      <p class="pp-why" id="pp-why-${esc(key)}" role="status">${esc(why.get(key) || '')}</p></section>`;

    // "Edit my page": live off a screen for a person with a page of their own; dimmed with why otherwise.
    const canEdit = () => !isScreen() && !!selfId() && !!pageState;
    function editButton() {
      if (isScreen()) return button({ act: 'page-edit', label: EDIT_WORDS.edit, enabled: false, reason: EDIT_WORDS.screenWhy, short: EDIT_WORDS.screenShort }, 'self');
      if (!canEdit()) return button({ act: 'page-edit', label: EDIT_WORDS.edit, enabled: false, reason: EDIT_WORDS.signInWhy, short: EDIT_WORDS.signInShort }, 'self');
      return editing ? button({ act: 'page-done', label: EDIT_WORDS.done, short: EDIT_WORDS.doneShort, enabled: true }, 'self')
        : button({ act: 'page-edit', label: EDIT_WORDS.edit, enabled: true }, 'self');
    }
    function selfCard() {
      const me = selfRow();
      const btns = [];
      if (!isScreen()) {
        btns.push(button({ act: 'picture-edit', label: 'Edit my picture', enabled: !!me.id,
          reason: me.id ? '' : 'Sign in to have a picture of your own.', short: me.id ? '' : 'Sign in first' }, 'self'));
      }
      btns.push(editButton());
      // "Theme for my page" (page_sections.js PAGE_LOOK_WORDS argues where): right after Edit my page, off a screen (a
      // page's theme is not worn on a screen). While editing, it is on the edit card just below instead.
      if (!isScreen() && !editing) btns.push(themeButton('self'));
      // "Shared with" (claim.js): the logins with your card on their page. Off a screen, once your people are read.
      if (!isScreen() && me.id && Number.isFinite(me.holders)) btns.push(holdersButton({ ...me, kind: 'you' }, 'self'));
      // Ask Nimrod taken off the page: More comes here, so the person's settings stay one press away.
      if (!hasKind(pageDoc, 'nimrod')) btns.push(button({ act: 'more', label: EDIT_WORDS.more, short: EDIT_WORDS.moreShort, enabled: true }, 'self'));
      // Messages for you taken off the page: the newest one still shows, here.
      const latest = !hasKind(pageDoc, 'messages') && prefs.incoming && incoming.length ? incoming[0] : null;
      // ...and so does the way back through the older ones.
      if (!hasKind(pageDoc, 'messages') && prefs.incoming && me.id) btns.push(olderButton('self'));
      return card('self', `<div class="pp-who"><div class="pp-face">${faceOf(me, SELF_FACE)}</div>
        <div><div class="pp-name" data-pp-self-name>${esc(selfName(me) || (me.id ? 'You' : 'Welcome'))}</div>
        <p class="pp-sub">${isScreen() ? 'This screen is for you.' : 'You'}</p></div></div>
        ${latest ? `<p class="pp-msg" data-pp-self-message><b>${esc(EDIT_WORDS.latest)}</b>, from ${esc(latest.author || 'Someone')}: ${esc(latest.text)}
          <br><small>${esc(whenWords(latest.at))}</small></p>` : ''}
        <div class="pp-btns">${btns.join('')}</div>`, ' pp-self');
    }

    // "See older messages": live when the page allows it (Edit my page) AND this page's own row does (people_page.js
    // `olderHere`, per screen); otherwise dimmed, saying which one turned it off.
    function olderButton(key) {
      const why = !olderOf(pageDoc) ? PAGE_LOOK_WORDS.olderOffPage : prefs.olderHere === false ? PAGE_LOOK_WORDS.olderOffHere : '';
      return button({ act: 'older', label: OLDER_WORDS.see, short: why ? PAGE_LOOK_WORDS.olderOffShort : OLDER_WORDS.seeShort, enabled: !why, reason: why }, key);
    }
    function incomingHTML() {
      if (!prefs.incoming) return '';
      // "See older messages" (page_visit.js): every message left for you, a page at a time. On a screen too: the
      // screen is the person's own, and its window closes by itself after "close after" (people_page.js).
      const older = selfId() ? card('older', `<div class="pp-btns">${olderButton('older')}</div>`) : '';
      return `<h2 class="pp-h">Messages for you</h2>${incoming.length
        ? incoming.map((m) => `<p class="pp-msg" data-pp-incoming><b>${esc(m.author || 'Someone')}</b>: ${esc(m.text)}
            <br><small>${esc(whenWords(m.at))}</small></p>`).join('')
        : '<p class="pp-note" data-pp-incoming-none>No messages yet. When someone leaves you one, it shows here.</p>'}${older}`;
    }

    // "Recommended for you": who sent it, what it is, their message, and Play / Open in Spotify / Remove (recommend.js
    // argues each). Each is its own card, so a switch walks them like the people. On a screen nothing is removed.
    function recommendedHTML() {
      if (!prefs.recommended) return '';
      const list = recs.slice(0, prefs.recommended);
      let colours = null;
      if (isScreen()) { try { colours = root ? themeQrColours(root) : null; } catch { colours = null; } }
      return `<h2 class="pp-h">${esc(REC_WORDS.heading)}</h2>${list.length ? list.map((r) => {
        const key = `r:${r.id}`;
        const plan = playPlan(r, { isScreen: isScreen() });
        const btns = [];
        if (plan.how === 'youtube' || plan.how === 'tab') {
          btns.push(button({ act: 'rec-play', label: plan.label, short: plan.how === 'tab' ? 'Opens in a new tab' : '', enabled: true }, key));
        }
        if (!isScreen()) btns.push(button({ act: 'rec-remove', label: REC_WORDS.remove, short: REC_WORDS.removeWhy, enabled: true }, key));
        return card(key, `<div class="pp-who" data-pp-rec="${esc(r.id)}">${recThumbHTML(r, { size: '3.5rem' })}
            <div><div class="pp-name" data-pp-rec-line>${esc(recLine(r))}</div>
            <p class="pp-sub">${esc(kindWords(r))}, ${esc(whenWords(whenOf({ created_at: r.at })))}${r.seen ? '' : ` <b data-pp-rec-new>${esc(REC_WORDS.isNew)}</b>`}</p></div></div>
          ${r.message ? `<p class="pp-msg" data-pp-rec-message>“${esc(r.message)}”</p>` : ''}
          ${plan.how === 'elsewhere' ? recElsewhereHTML(r, { colours }) : ''}
          ${btns.length ? `<div class="pp-btns">${btns.join('')}</div>` : ''}`);
      }).join('') : `<p class="pp-note" data-pp-rec-none>${esc(REC_WORDS.none)}</p>`}`;
    }

    function peopleCards() {
      const list = people();
      if (!list.length) {
        return `<p class="pp-note" data-pp-nobody>${esc(peopleNote || (own === null && !ctx.profiles ? 'Sign in to see your people.' : 'Nobody here yet. Connect with someone below.'))}</p>`;
      }
      return list.map((p) => {
        // Call, message and recommend go where they can be reached (`reach`); the face and name are this card's own.
        const acts = actionsFor(p, { isScreen: false, may: mayCallNow(p.reach), noteStatus: notes.get(p.reach) ?? null, callHref: callURL(p.reach) });
        const joined = p.kind === 'joined';
        const sub = p.via === 'shared' ? 'Shared with you' : kindSub(p);
        return card(`p:${p.id}`, `<div class="pp-who"><div class="pp-face">${faceOf(p, CARD_FACE)}</div>
            <div><div class="pp-name"><span data-pp-name>${esc(p.name)}</span>${joined ? ` <span class="pp-joined" data-pp-joined>— ${esc(CLAIM_WORDS.joined)}</span>` : ''}</div>
            <p class="pp-sub" data-pp-sub>${esc(sub)}</p></div></div>
          <div class="pp-btns" data-pp-person="${esc(p.id)}">${acts.map((a) => button(a, `p:${p.id}`)).join('')}</div>${claimRow(p)}`);
      }).join('');
    }

    // UNDER EACH OF YOUR OWN PEOPLE (claim.js; the server's claims.py decides):
    //   somebody you look after (not you - claims.py `invite_refusal`)  "Invite them to use this", "Shared with",
    //                                                                   "I call them…"
    //   somebody whose profile is on another login                     "I call them…", and - when a connection put
    //                                                                   them here - "Messages from them" and "Stop
    //                                                                   sharing" (two presses)
    // Nothing under you, or under a screen shared with you.
    const stopLabel = (key) => (armed && armed.key === key && twoPress(armed.at, Date.now()) === 'fire');
    // "Shared with 2": live when somebody else holds it; "Not shared yet", dimmed with why, when nobody does.
    function holdersButton(p, key) {
      const you = p.kind === 'you';
      const n = Number(p.holders) || 0;
      return button({ act: 'holders', label: CLAIM_WORDS.holders(n), short: you ? CLAIM_WORDS.holdersYouShort : CLAIM_WORDS.holdersShort(n),
        enabled: n > 0, reason: n > 0 ? '' : CLAIM_WORDS.holdersNone(you ? '' : (p.name || '')) }, key);
    }
    // "I call them…" (Mike, 2026-10-05: at any time, on any card): on somebody you made, a label only you see beside
    // the name on their card; on somebody whose profile is on another login, your name for them.
    const callNameButton = (p, key) => button({ act: 'call-name', label: CLAIM_WORDS.callThem,
      short: CLAIM_WORDS.callThemShort(p.callName || p.viewerCallName ? p.profileName : ''), enabled: true }, key);
    function claimRow(p) {
      if (p.via !== 'account' || p.kind === 'you') return '';
      const key = `p:${p.id}`;
      let btns = [];
      if (p.home) {
        btns = [button({ act: 'invite', label: CLAIM_WORDS.invite, short: CLAIM_WORDS.inviteShort, enabled: true }, key)];
        if (p.holders !== null && p.holders !== undefined) btns.push(holdersButton(p, key));
        btns.push(callNameButton(p, key));
      } else {
        // "See their page" (page_visit.js): live when the server says it opens for you (`page` ''), dimmed with why.
        const shut = typeof p.visit === 'string' && p.visit !== '';
        btns.push(button({ act: 'visit', label: VISIT_WORDS.see, short: shut ? VISIT_WORDS.dimShort : VISIT_WORDS.seeShort, enabled: !shut,
          reason: shut ? VISIT_WORDS.why(p.visit, p.name) : '' }, key));
        btns.push(callNameButton(p, key));
        if (p.linked) {
          const again = stopLabel(`${key}|stop-share`);
          btns.push(button({ act: 'claim-msg', label: p.messagesFromThem ? CLAIM_WORDS.msgOn : CLAIM_WORDS.msgOff, short: CLAIM_WORDS.msgShort, enabled: true }, key),
            button({ act: 'stop-share', label: again ? CLAIM_WORDS.stopAgain : CLAIM_WORDS.stop,
              short: p.kind === 'joined' ? CLAIM_WORDS.stopShort : CLAIM_WORDS.stopLinked(p.from), enabled: true }, key));
        }
        // "Remove just this card" (two presses; the connection stays). The server says whether (`remove`): '' yes,
        // else why not - dimmed with that, in words.
        if (typeof p.remove === 'string') {
          const can = p.remove === '';
          const again = can && stopLabel(`${key}|remove-card`);
          btns.push(button({ act: 'remove-card', label: again ? CLAIM_WORDS.removeAgain : CLAIM_WORDS.removeCard,
            short: can ? CLAIM_WORDS.removeShort(p.from) : CLAIM_WORDS.removeDimShort, enabled: can,
            reason: can ? '' : removeWhy(p.remove, { name: p.name, from: p.from }) }, key));
        }
      }
      return `<div class="pp-btns" data-pp-claim="${esc(p.id)}">${btns.join('')}</div>`;
    }

    function screenFaces() {
      const list = people();
      const faces = list.length
        ? `<div class="pp-faces">${list.map((p) => `<div class="pp-who" data-pp-face="${esc(p.id)}"><div class="pp-face">${faceOf(p, CARD_FACE)}</div>
            <div class="pp-name" data-pp-name>${esc(p.name)}</div></div>`).join('')}</div>`
        : '<p class="pp-note" data-pp-nobody>Nobody here yet.</p>';
      let colours = null;
      try { colours = root ? themeQrColours(root) : null; } catch { colours = null; }
      return card('faces', `<h2 class="pp-h">Your people</h2>${faces}
        <p class="pp-note" data-pp-screen-line>${esc(WHY.callOnScreen)} ${esc(WHY.messageOnScreen.replace(', not from this screen', ''))}</p>
        ${elsewhereHTML(CALL_PAGE, { colours, cls: 'pp-note pl-elsewhere' })}`);
    }

    // "Connect with someone": live once your people are read (you are signed in); dimmed with why otherwise.
    const connectCard = () => {
      const can = Array.isArray(own) && !!selfId();
      return card('connect', `<h2 class="pp-h">${esc(CLAIM_WORDS.connect)}</h2>
        <p class="pp-note" data-pp-connect>${esc(CLAIM_WORDS.connectLine)}</p>
        <div class="pp-btns">${button({ act: 'connect', label: CLAIM_WORDS.connect, short: can ? CLAIM_WORDS.connectShort : 'Sign in first',
          enabled: can, reason: can ? '' : 'Sign in to connect with someone.' }, 'connect')}</div>`);
    };
    const moreCard = () => card('more', `<div class="pp-btns">${button({ act: 'more', label: 'More', short: 'Your settings, your devices and more', enabled: true }, 'more')}
      ${button({ act: 'nimrod', label: 'Ask Nimrod', short: 'He shows you around', enabled: true }, 'more')}</div>`);

    // ---- sections (page_sections.js) --------------------------------------------------------------------
    const sectionName = (s) => s.entry?.name || 'A part from a newer version';
    // One of today's parts, or About me, or the quiet line for a kind this version does not know.
    function sectionHTML(s) {
      switch (s.kind) {
        case 'self': return selfCard() + (editing ? editCard() : '');
        case 'messages': return incomingHTML();
        case 'recommended': return recommendedHTML();
        case 'people': return isScreen() ? screenFaces() : `<h2 class="pp-h">Your people</h2>${peopleCards()}`;
        case 'connect': return connectCard();
        case 'nimrod': return moreCard();
        case 'about': {
          const text = aboutText(s.options);
          return card(`s:${s.id}`, `<h2 class="pp-h">About me</h2>${text.trim()
            ? `<p class="pp-about" data-pp-about>${esc(text)}</p>`
            : `<p class="pp-note" data-pp-about-none>${esc(isScreen() ? 'Nothing here yet.' : EDIT_WORDS.aboutEmpty)}</p>`}`);
        }
        default: return card(`s:${s.id}`, `<p class="pp-note" data-pp-newer>${esc(EDIT_WORDS.newer)}</p>`);
      }
    }
    // The card under You while editing: Add something, Done, and the two ways back.
    function editCard() {
      const btns = [button({ act: 'page-add', label: EDIT_WORDS.add, short: EDIT_WORDS.addShort, enabled: true }, 'edit'),
        button({ act: 'page-done', label: EDIT_WORDS.done, short: EDIT_WORDS.doneShort, enabled: true }, 'edit')];
      if (!hasKind(pageDoc, 'people')) btns.push(button({ act: 'show-people', label: EDIT_WORDS.showPeople, short: EDIT_WORDS.showPeopleShort, enabled: true }, 'edit'));
      if (lastRemoved) btns.push(button({ act: 'put-back', label: EDIT_WORDS.putBack(lastRemoved.name), short: EDIT_WORDS.putBackShort, enabled: true }, 'edit'));
      return card('edit', `<h2 class="pp-h" data-pp-editing>${esc(EDIT_WORDS.editing)}</h2><p class="pp-note">${esc(EDIT_WORDS.intro)}</p>
        <div class="pp-btns">${btns.join('')}</div>${whoHTML()}${lookHTML()}`, ' pp-edit');
    }
    // "Theme for my page" and "Let this page show older messages" (page_sections.js argues both): keys of the page
    // record beside "Who can see my page", written the same way.
    // (2026-10-07) The theme is a BUTTON that opens the site's one theme gallery (`openThemePicker`), not a list of
    // its own here: Mike, "The themes on the home/profile page should be the same as the regular themes."
    function lookHTML() {
      const W = PAGE_LOOK_WORDS;
      const own = colourState().viewerKeepsOwn && themeOf(pageDoc);
      const older = olderOf(pageDoc);
      return `<div class="pp-fields" data-pp-look-row>
          <div class="pp-field" data-pp-colours-field>${themeButton('edit')}
            <small data-pp-colours-line>${esc(own ? W.coloursOwn : W.coloursLine)}</small></div>
          <label class="pp-field">${esc(W.older)}<select data-pp-older><option value="1"${older ? ' selected' : ''}>${esc(W.olderOn)}</option><option value="0"${older ? '' : ' selected'}>${esc(W.olderOff)}</option></select>
            <small>${esc(W.olderLine)}</small></label>
        </div>`;
    }
    // The theme's name as the gallery shows it (the part before " — "), "The usual theme" for none, and for a theme
    // this version does not have (a newer site chose it), that said rather than a bare id.
    function pageThemeName(id) {
      if (!id) return PAGE_LOOK_WORDS.coloursNone;
      let t = null;
      try { t = listThemes().find((x) => x.id === id) || null; } catch { t = null; }
      return t ? String(t.label).split(' — ')[0] : EDIT_WORDS.newer;
    }
    // The button: "Theme for my page", the theme's name under it, and its colours as four small chips (choice_picker.js
    // previewOf, the gallery's own strip). Live wherever the page can be changed; dimmed with why otherwise.
    function themeButton(key) {
      const cur = themeOf(pageDoc);
      const ok = canEdit();
      const html = button({ act: 'page-theme', label: PAGE_LOOK_WORDS.colours, short: pageThemeName(cur), enabled: ok,
        reason: ok ? '' : EDIT_WORDS.signInWhy }, key);
      let p = null;
      try { p = cur ? previewOf({ value: cur }, { preview: 'theme' }) : null; } catch { p = null; }
      if (!p || p.kind !== 'swatch') return html;
      const chips = `<span class="pp-theme-chips" aria-hidden="true">${p.colors.map((c) => `<span style="background:${esc(c)}"></span>`).join('')}</span>`;
      return html.replace(/<\/button>$/, `${chips}</button>`);
    }
    // Which colours this page wears for whoever is looking (page_sections.js pageColours). The viewer's own colours are
    // read from around the page (the element it is mounted in), not from the page itself.
    function colourState() {
      const viewerTheme = mount ? viewerThemeOf(mount) : '';
      const moreContrast = wantsMoreContrast();
      const pageTheme = themeOf(pageDoc);
      const id = pageColours({ pageTheme, known: knownThemes(), isScreen: isScreen(), viewerTheme, moreContrast });
      return { id, pageTheme, viewerTheme, viewerKeepsOwn: !isScreen() && (moreContrast || ACCESS_THEMES.includes(viewerTheme)) };
    }
    let worn = '';
    function paintColours() { if (root) worn = wearColours(root, colourState().id); }
    // "Who can see my page" (page_sections.js WHO_WORDS; the server's rule is page_visits.py), and, for "Only the
    // people I pick", one button per person you are connected with (their own login): can or can't see it.
    const pickable = () => people().filter((p) => p.via === 'account' && !p.home && (p.kind === 'connected' || p.kind === 'joined'));
    function whoHTML() {
      const who = whoOf(pageDoc);
      const sel = `<label class="pp-field">${esc(WHO_WORDS.label)}<select data-pp-who>${WHO_CHOICES
        .map((w) => `<option value="${w}"${w === who ? ' selected' : ''}>${esc(WHO_WORDS.choice[w])}</option>`).join('')}</select>
        <small data-pp-who-line>${esc(WHO_WORDS.line[who])}</small></label>`;
      let picks = '';
      if (who === 'picked') {
        const list = pickable();
        const on = new Set(pickedOf(pageDoc));
        picks = list.length
          ? `<p class="pp-note">${esc(WHO_WORDS.pickLead)}</p><div class="pp-btns" data-pp-picks>${list.map((p) => button({ act: 'pick', label: p.name,
            short: on.has(p.id) ? WHO_WORDS.pickOn : WHO_WORDS.pickOff, enabled: true }, `k:${p.id}`).replace('<button ', `<button aria-pressed="${on.has(p.id)}" data-pp-pick="${esc(p.id)}" `)).join('')}</div>`
          : `<p class="pp-note" data-pp-picks-none>${esc(WHO_WORDS.pickNone)}</p>`;
      }
      return `<div class="pp-fields" data-pp-who-row>${sel}</div>${picks}<p class="pp-note">${esc(WHO_WORDS.selfLine)}</p>`;
    }
    // A choice / toggle / text / number row for one of a box's own settings (its manifest's, by key).
    function fieldsOf(s) {
      const type = s.entry?.module;
      const m = type ? getManifest(type) : null;
      let decl = m?.settings;
      if (typeof decl === 'function') { try { decl = decl(); } catch { decl = []; } }
      const want = s.entry?.fields || [];
      return want.map((k) => (Array.isArray(decl) ? decl : []).find((d) => d && d.key === k)).filter(Boolean).map((d) => normalizeField(d)).filter(Boolean);
    }
    function fieldHTML(s, f) {
      const values = s.options?.settings || {};
      const v = fieldValue(f, values);
      const attrs = `data-pp-sec-field="${esc(f.key)}" data-pp-sec-id="${esc(s.id)}"`;
      let ctl;
      if (f.kind === 'toggle') {
        ctl = `<select ${attrs} data-pp-kind="toggle"><option value="1"${v ? ' selected' : ''}>${esc(f.onLabel)}</option><option value="0"${v ? '' : ' selected'}>${esc(f.offLabel)}</option></select>`;
      } else if (f.kind === 'choice') {
        const words = s.entry?.relabel?.[f.key] || {};
        ctl = `<select ${attrs} data-pp-kind="choice">${(f.options || []).map((o, i) => `<option value="${i}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(words[o.value] || o.label)}</option>`).join('')}</select>`;
      } else if (f.kind === 'number') {
        ctl = `<input type="number" ${attrs} data-pp-kind="number" value="${esc(v)}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} step="${f.step || 1}">`;
      } else {
        ctl = `<input type="text" ${attrs} data-pp-kind="text" value="${esc(v ?? '')}" maxlength="200">`;
      }
      return `<label class="pp-field">${esc(f.label)}${ctl}</label>`;
    }
    // The edit bar over one section: its name, Move up / Move down / Remove, and its own few options.
    function editBarHTML(s) {
      const key = `e:${s.id}`;
      const mv = canMove(pageDoc, s.id);
      const btns = [
        button({ act: 'sec-up', label: EDIT_WORDS.moveUp, enabled: mv.up, reason: mv.up ? '' : EDIT_WORDS.topWhy, short: mv.up ? '' : EDIT_WORDS.atTop }, key),
        button({ act: 'sec-down', label: EDIT_WORDS.moveDown, enabled: mv.down, reason: mv.down ? '' : EDIT_WORDS.bottomWhy, short: mv.down ? '' : EDIT_WORDS.atBottom }, key),
        button({ act: 'sec-remove', label: EDIT_WORDS.remove, short: EDIT_WORDS.removeShort, enabled: true }, key),
      ];
      let extra = '';
      if (s.kind === 'about') {
        // The text and its count are put in after the bar is drawn (render), never in its markup: a save while
        // somebody is typing must not redraw the box they are typing in.
        extra = `<label class="pp-field">${esc(EDIT_WORDS.aboutLabel)}<textarea data-pp-about-input data-pp-sec-id="${esc(s.id)}" maxlength="${ABOUT_MAX}" rows="5"></textarea>
          <small data-pp-about-count></small></label>`;
      } else if (s.entry?.module) {
        const size = BOX_SIZES[s.options?.size] ? s.options.size : DEFAULT_BOX_SIZE;
        const sizeRow = `<label class="pp-field">${esc(EDIT_WORDS.size)}<select data-pp-sec-size data-pp-sec-id="${esc(s.id)}">${Object.keys(BOX_SIZES)
          .map((k) => `<option value="${k}"${k === size ? ' selected' : ''}>${esc(BOX_SIZE_LABELS[k])}</option>`).join('')}</select></label>`;
        const rows = s.kind === 'video'
          ? `<label class="pp-field">${esc(EDIT_WORDS.videoLink)}<input type="url" inputmode="url" data-pp-video-link data-pp-sec-id="${esc(s.id)}" value="${esc(s.options?.link || '')}" maxlength="2000">
              <small>${esc(EDIT_WORDS.videoHow)}</small></label>
              <div class="pp-btns">${button({ act: 'video-save', label: EDIT_WORDS.videoSave, enabled: true }, key)}</div>`
          : fieldsOf(s).map((f) => fieldHTML(s, f)).join('');
        extra = `<div class="pp-fields">${sizeRow}${s.kind === 'video' ? '' : rows}</div>${s.kind === 'video' ? rows : ''}`;
      }
      return card(key, `<div class="pp-name" data-pp-edit-name>${esc(sectionName(s))}</div>
        <div class="pp-btns" data-pp-edit-for="${esc(s.id)}">${btns.join('')}</div>${seenHTML(s, key)}${extra}`, ' pp-edit');
    }
    // "Who sees this": Only me (the default) or People who can see my page, for a part that may be opened; for a
    // private one (Messages for you, Your people...) a dimmed "Only you see this" that says why when pressed.
    function seenHTML(s, key) {
      if (!canOpen(s.kind)) {
        const why = WHO_WORDS.privateWhy[s.known ? s.kind : 'newer'] || WHO_WORDS.privateWhy.newer;
        return `<div class="pp-btns" data-pp-seen-private="${esc(s.id)}">${button({ act: 'seen-private', label: WHO_WORDS.privateBtn, enabled: false, reason: why, short: WHO_WORDS.keptShort }, key)}</div>`;
      }
      const seen = seenByOf(s);
      return `<div class="pp-fields"><label class="pp-field">${esc(WHO_WORDS.seen)}<select data-pp-seen data-pp-sec-id="${esc(s.id)}">${['me', 'visitors']
        .map((v) => `<option value="${v}"${v === seen ? ' selected' : ''}>${esc(WHO_WORDS.seenChoice[v])}</option>`).join('')}</select></label></div>`;
    }
    const isBox = (s) => !!s.entry?.module;

    // A box's settings, as the thing in it reads them: the section's stored `settings`, with whatever the thing set
    // itself while running laid over them in memory (see the header: mounting writes nothing).
    function sectionState(id) {
      let local = {};
      const subs = new Set();
      const stored = () => viewSections(pageDoc).find((x) => x.id === id)?.options?.settings || {};
      const cur = () => ({ ...stored(), ...local });
      const tell = () => { const v = cur(); subs.forEach((f) => { try { f(v); } catch (err) { console.error('people: box state', err); } }); };
      return {
        get: cur,
        set(p) { local = { ...local, ...(p || {}) }; tell(); },
        subscribe(f) { subs.add(f); return () => subs.delete(f); },
        load: async () => cur(), flush: async () => {}, destroy() { subs.clear(); },
        // The page's own edit bar set `key`: the stored value is the one now, not a value the thing set earlier.
        forget(key) { delete local[key]; },
        tell,
      };
    }
    function noEvents() {
      return { append: async () => ({}), subscribe: () => () => {}, load: async () => {}, get: () => ({ events: [] }), flush: async () => {}, destroy() {} };
    }
    // The card a box section lives in, made once (so the thing in it stays mounted while the page redraws).
    function boxSkeleton(w, s) {
      const body = w.querySelector('[data-pp-sec-body]');
      body.innerHTML = `<section class="pp-card" data-pp-card="s:${esc(s.id)}" data-pp-box-card="${esc(s.kind)}">
        <h2 class="pp-h" data-pp-box-title></h2><div data-pp-box-controls></div>
        <div class="pp-box" data-pp-box="${esc(s.kind)}"></div>
        <p class="pp-why" id="pp-why-s:${esc(s.id)}" role="status"></p></section>`;
    }
    function paintBox(w, s) {
      const title = w.querySelector('[data-pp-box-title]');
      if (title && title.textContent !== s.entry.name) title.textContent = s.entry.name;
      const host = w.querySelector('[data-pp-box]');
      const h = boxHeight(s.options);
      const vid = s.kind === 'video' ? videoOf(s.options) : null;
      const playing = s.kind === 'video' && boxes.get(s.id)?.inst;
      // A video box is only as tall as its player once it plays; before, it is the Play button.
      const height = s.kind === 'video' && !playing ? '0px' : h;
      if (host && host.style.height !== height) host.style.height = height;
      const ctl = w.querySelector('[data-pp-box-controls]');
      if (ctl) {
        const key = `s:${s.id}`;
        let html = '';
        if (s.kind === 'video') {
          html = !vid ? `<p class="pp-note" data-pp-video-none>${esc(isScreen() ? 'No video chosen yet.' : EDIT_WORDS.videoNone)}</p>`
            : `<div class="pp-btns">${playing ? button({ act: 'video-stop', label: EDIT_WORDS.stop, enabled: true }, key)
              : button({ act: 'video-play', label: EDIT_WORDS.play, short: EDIT_WORDS.playShort, enabled: true }, key)}</div>`;
        }
        if (ctl.dataset.html !== html) { ctl.innerHTML = html; ctl.dataset.html = html; }
      }
      const whyEl = w.querySelector('[data-pp-sec-body] .pp-why');
      const said = why.get(`s:${s.id}`) || '';
      if (whyEl && whyEl.textContent !== said) whyEl.textContent = said;
    }
    // Mount the site's own thing in a box, the normal way. A video waits for Play (nothing plays by itself).
    async function mountBox(s, w) {
      if (boxes.has(s.id) || s.kind === 'video') return;
      const type = s.entry.module;
      const slot = { inst: null, st: sectionState(s.id), kind: s.kind, seen: JSON.stringify(s.options?.settings || {}) };
      boxes.set(s.id, slot);
      const host = w.querySelector('[data-pp-box]');
      try {
        if (!getManifest(type)) await BOX_LOADERS[type]?.();
        if (torn || boxes.get(s.id) !== slot) return;
        if (!getManifest(type)) throw new Error(`no ${type} here`);
        const inst = mountModule(type, extendCtx(ctx, {
          mount: host, bus: createBus(), instanceId: `${ctx.instanceId || 'people'}-box-${s.id}`, state: slot.st, events: noEvents(),
          makePersonState: makePS,
        }));
        slot.inst = inst;
        await inst.init();
        // A section edited before the thing finished mounting: draw the edit bar's rows now its settings are known.
        if (editing && !torn) render();
      } catch (err) {
        console.error('people: box', err);
        if (boxes.get(s.id) === slot && host) host.innerHTML = `<p class="pp-note" style="padding:12px" data-pp-box-failed>${esc(EDIT_WORDS.cannotShow)}</p>`;
      }
    }
    function unmountBox(id) {
      const slot = boxes.get(id);
      if (!slot) return;
      boxes.delete(id);
      try { slot.inst?.destroy?.(); } catch (err) { console.error('people: box destroy', err); }
    }
    // The page record changed (here or on another device): each box hears only a change to its own settings.
    function tellBoxes() {
      for (const s of viewSections(pageDoc)) {
        const slot = boxes.get(s.id);
        if (!slot) continue;
        const now = JSON.stringify(s.options?.settings || {});
        if (now !== slot.seen) { slot.seen = now; slot.st.tell(); }
      }
    }

    function render() {
      if (!root || torn) return;
      const keepFocus = root.ownerDocument.activeElement;
      const focusAct = keepFocus && root.contains(keepFocus) ? `${keepFocus.dataset?.ppCardKey || ''}|${keepFocus.dataset?.ppAct || ''}` : null;
      const list = root.querySelector('[data-pp-list]');
      const secs = viewSections(pageDoc, { isScreen: isScreen() });
      root.classList.toggle('pp-editing', editing);
      paintColours();
      // Sections gone from the page: their element, and anything mounted in it.
      const want = new Set(secs.map((s) => s.id));
      for (const [id, w] of [...wrappers]) {
        if (want.has(id)) continue;
        unmountBox(id); w.remove(); wrappers.delete(id);
      }
      let prev = null;
      for (const s of secs) {
        let w = wrappers.get(s.id);
        if (w && w.dataset.ppSecKind !== s.kind) { unmountBox(s.id); w.remove(); wrappers.delete(s.id); w = null; }
        if (!w) {
          w = root.ownerDocument.createElement('div');
          w.className = 'pp-sec';
          w.dataset.ppSec = s.id;
          w.dataset.ppSecKind = s.kind;
          w.innerHTML = '<div class="pp-sec-body" data-pp-sec-edit></div><div class="pp-sec-body" data-pp-sec-body></div>';
          wrappers.set(s.id, w);
          if (isBox(s)) boxSkeleton(w, s);
        }
        // In order, moving an element only when it is out of place (a box moved is a box reloaded).
        const at = prev ? prev.nextSibling : list.firstChild;
        if (at !== w) list.insertBefore(w, at);
        prev = w;
        w.classList.toggle('is-edit', editing && s.kind !== 'self');
        const edit = editing && s.kind !== 'self' ? editBarHTML(s) : '';
        const editEl = w.querySelector('[data-pp-sec-edit]');
        if (editEl.dataset.html !== edit) {
          editEl.innerHTML = edit; editEl.dataset.html = edit;
          const ta = editEl.querySelector('[data-pp-about-input]');
          if (ta) {
            ta.value = aboutText(s.options);
            const count = editEl.querySelector('[data-pp-about-count]');
            if (count) count.textContent = EDIT_WORDS.aboutCount(ta.value.length);
          }
        }
        if (isBox(s)) { paintBox(w, s); mountBox(s, w); continue; }
        const html = sectionHTML(s);
        const bodyEl = w.querySelector('[data-pp-sec-body]');
        if (bodyEl.dataset.html !== html) { bodyEl.innerHTML = html; bodyEl.dataset.html = html; }
      }
      paintCursor();
      if (focusAct) {
        const [k, a] = focusAct.split('|');
        const el = [...root.querySelectorAll('[data-pp-stop]')].find((b) => b.dataset.ppCardKey === k && b.dataset.ppAct === a);
        try { if (el && el !== root.ownerDocument.activeElement) el.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      }
    }

    // ---- editing the page -------------------------------------------------------------------------------
    async function openPage() {
      if (pageState || torn) return;
      const pid = selfId();
      if (!pid) return;
      if (pageOpening) return pageOpening;
      pageOpening = (async () => {
        let h = null;
        try {
          h = makePS(pid, PAGE_KEY, { merge: mergePageDoc, onLost: () => { why = new Map([[editing ? 'edit' : 'self', EDIT_WORDS.lost]]); render(); } });
        } catch { h = null; }
        if (!h) return;
        try { await h.load(); } catch { /* the default page stands; a later poll may still bring theirs */ }
        if (torn) { try { h.destroy?.(); } catch { /* gone */ } return; }
        pageState = h;
        pageDoc = h.get() || {};
        offPage = h.subscribe?.((v) => { pageDoc = v || {}; tellBoxes(); render(); }) || null;
        try { h.startPolling?.(); } catch { /* a handle with no polling: this page's own edits still show */ }
      })().finally(() => { pageOpening = null; });
      return pageOpening;
    }
    // One press, one write, in order (a second press before the first is saved waits for it).
    function writePage(sections, say = '') {
      if (!pageState) { why = new Map([[editing ? 'edit' : 'self', EDIT_WORDS.failed]]); render(); return false; }
      why = say ? new Map([['edit', say]]) : new Map();
      pageState.set({ sections });
      pageDoc = pageState.get() || pageDoc;
      render();
      saving = saving.then(() => pageState?.flush?.()).catch(() => { why = new Map([['edit', EDIT_WORDS.failed]]); render(); });
      return true;
    }
    function startEditing() {
      if (!canEdit()) return;
      editing = true; lastRemoved = null; why = new Map();
      render();
      try { root.querySelector('[data-pp-card="edit"] [data-pp-act="page-add"]')?.focus({ preventScroll: true }); } catch { /* not focusable */ }
    }
    function stopEditing() {
      editing = false; lastRemoved = null;
      clearTimeout(aboutTimer); aboutTimer = null;
      if (sheet?.kind === 'library') closeSheet({ quiet: true });
      flushAbout();
      render();
    }
    function addKind(kind) {
      const entry = libraryEntry(kind);
      const r = addSection(pageDoc, kind);
      if (!r.id) return;
      lastRemoved = null;
      writePage(r.sections, EDIT_WORDS.added(entry.name));
      try { wrappers.get(r.id)?.scrollIntoView?.({ block: 'nearest' }); } catch { /* not in a scrolling box */ }
    }
    function removeSec(id) {
      const s = viewSections(pageDoc).find((x) => x.id === id);
      const r = removeSection(pageDoc, id);
      if (!r.removed) return;
      lastRemoved = { ...r.removed, name: s ? sectionName(s) : 'it' };
      writePage(r.sections, EDIT_WORDS.removed(lastRemoved.name));
    }
    function putBack() {
      if (!lastRemoved) return;
      const next = restoreSection(pageDoc, lastRemoved);
      lastRemoved = null;
      writePage(next);
    }
    function moveSec(id, dir) {
      writePage(moveSection(pageDoc, id, dir));
      // The pressed button again (it is in the section's edit bar, which moved with it).
      try { root.querySelector(`[data-pp-edit-for="${CSS.escape(id)}"] [data-pp-act="${dir < 0 ? 'sec-up' : 'sec-down'}"]:not([aria-disabled="true"])`)?.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    // A box's own setting, from its edit bar: stored in the section, and the thing in the box told.
    function setField(id, key, el) {
      const s = viewSections(pageDoc).find((x) => x.id === id);
      const f = s ? fieldsOf(s).find((x) => x.key === key) : null;
      if (!f) return;
      let v;
      if (f.kind === 'toggle') v = el.value === '1';
      else if (f.kind === 'choice') { const o = (f.options || [])[Number(el.value)]; if (!o) return; v = o.value; }
      else if (f.kind === 'number') { v = Number(el.value); if (!Number.isFinite(v)) return; if (f.min != null) v = Math.max(f.min, v); if (f.max != null) v = Math.min(f.max, v); }
      else v = String(el.value || '').slice(0, 200);
      boxes.get(id)?.st.forget(key);
      writePage(updateSection(pageDoc, id, { settings: { [key]: v } }));
    }
    function saveAbout(id, text) {
      if (!pageState) return;
      pageState.set({ sections: updateSection(pageDoc, id, { text: String(text || '').slice(0, ABOUT_MAX) }) });
      pageDoc = pageState.get() || pageDoc;
      render();
    }
    let aboutPending = null;      // { id, text } typed and not yet saved
    function flushAbout() {
      if (!aboutPending) return;
      const p = aboutPending; aboutPending = null;
      saveAbout(p.id, p.text);
    }
    function saveVideo(id) {
      const input = root.querySelector(`[data-pp-video-link][data-pp-sec-id="${CSS.escape(id)}"]`);
      const link = String(input?.value || '').trim();
      if (link && !videoOf({ link })) { why = new Map([[`e:${id}`, EDIT_WORDS.videoBad]]); render(); return; }
      stopVideo(id);
      writePage(updateSection(pageDoc, id, { link }));
    }
    async function playVideo(id) {
      const s = viewSections(pageDoc).find((x) => x.id === id);
      const vid = s ? videoOf(s.options) : null;
      const w = wrappers.get(id);
      if (!vid || !w || boxes.has(id)) return;
      const slot = { inst: null, st: null, kind: 'video', seen: '' };
      boxes.set(id, slot);
      const host = w.querySelector('[data-pp-box]');
      host.style.height = boxHeight(s.options);
      try {
        const child = await mountRecommendedVideo(host, { rec: { provider: 'youtube', kind: 'video', id: vid.id }, baseCtx: ctx,
          instanceId: `${ctx.instanceId || 'people'}-box-${id}` });
        if (torn || boxes.get(id) !== slot) { child.destroy(); return; }
        slot.inst = child;
      } catch (err) {
        console.error('people: video box', err);
        boxes.delete(id);
        host.innerHTML = `<p class="pp-note" style="padding:12px" data-pp-box-failed>${esc(EDIT_WORDS.cannotShow)}</p>`;
      }
      render();
    }
    function stopVideo(id) {
      unmountBox(id);
      const host = wrappers.get(id)?.querySelector('[data-pp-box]');
      if (host) host.innerHTML = '';
      render();
    }
    // "Add something": the library, in a window over the page.
    function openLibrary() {
      const host = openSheet('library', EDIT_WORDS.addTitle, { back: '‹ Back to your page' });
      const list = addableEntries().map((e) => {
        const there = !e.repeat && hasKind(pageDoc, e.kind);
        return `<section class="pp-card" data-pp-lib="${esc(e.kind)}"><div class="pp-name">${esc(e.name)}</div><p class="pp-sub">${esc(e.line)}</p>
          <div class="pp-btns"><button type="button" class="pp-btn${there ? '' : ' is-go'}" data-pp-lib-add="${esc(e.kind)}"${there ? ` aria-disabled="true" title="${esc(EDIT_WORDS.already)}"` : ''}>
          ${esc(EDIT_WORDS.addOne)}${there ? `<small>${esc(EDIT_WORDS.already)}</small>` : ''}</button></div></section>`;
      }).join('');
      host.innerHTML = `<div class="pp-lib" data-pp-library>${list}</div>`;
      try { root.scrollTop = 0; } catch { /* not scrolled */ }
      host.addEventListener('click', (e) => {
        const b = e.target instanceof Element ? e.target.closest('[data-pp-lib-add]') : null;
        if (!b || b.getAttribute('aria-disabled') === 'true') return;
        const kind = b.dataset.ppLibAdd;
        closeSheet({ quiet: true });
        addKind(kind);
      });
      paintCursor();
    }
    function onInput(e) {
      const t = e.target;
      if (!(t instanceof Element) || !root?.contains(t)) return;
      if (t.matches('[data-pp-about-input]')) {
        const id = t.dataset.ppSecId;
        const count = t.closest('.pp-field')?.querySelector('[data-pp-about-count]');
        if (count) count.textContent = EDIT_WORDS.aboutCount(t.value.length);
        aboutPending = { id, text: t.value };
        clearTimeout(aboutTimer);
        aboutTimer = setTimeout(flushAbout, ABOUT_SAVE_MS);
      }
    }
    function onChange(e) {
      const t = e.target;
      if (!(t instanceof Element) || !root?.contains(t) || t.closest('[data-pp-sheet-body]')) return;
      if (t.matches('[data-pp-sec-field]')) setField(t.dataset.ppSecId, t.dataset.ppSecField, t);
      else if (t.matches('[data-pp-sec-size]')) writePage(updateSection(pageDoc, t.dataset.ppSecId, { size: BOX_SIZES[t.value] ? t.value : DEFAULT_BOX_SIZE }));
      else if (t.matches('[data-pp-seen]')) writePage(updateSection(pageDoc, t.dataset.ppSecId, { [SEEN_KEY]: t.value === 'visitors' ? 'visitors' : 'me' }));
      else if (t.matches('[data-pp-who]')) writeWho({ [WHO_KEY]: WHO_CHOICES.includes(t.value) ? t.value : 'me' });
      else if (t.matches('[data-pp-older]')) writeWho({ [OLDER_KEY]: t.value !== '0' });
    }
    // "Who can see my page" and the people picked, the page's colours and its older messages: keys of the page record
    // beside its sections (page_sections.js).
    function writeWho(patch) {
      if (!pageState) { why = new Map([['edit', EDIT_WORDS.failed]]); render(); return; }
      why = new Map();
      pageState.set(patch);
      pageDoc = pageState.get() || pageDoc;
      render();
      saving = saving.then(() => pageState?.flush?.()).catch(() => { why = new Map([['edit', EDIT_WORDS.failed]]); render(); });
    }

    // ---- the switch -------------------------------------------------------------------------------------
    const live = (el) => el && el.getAttribute('aria-disabled') !== 'true' && !el.disabled;
    const cards = () => [...(root?.querySelectorAll('[data-pp-list] [data-pp-card]') || [])].filter((c) => [...c.querySelectorAll('[data-pp-stop]')].some(live));
    const stopsIn = (el) => [...(el?.querySelectorAll('[data-pp-stop]') || [])].filter(live);
    const allStops = () => stopsIn(root?.querySelector('[data-pp-list]'));
    // In a window over the page (Nimrod, your picture, a message) a switch walks whatever can be pressed in it, Back
    // first; select presses it, back closes the window. One walk for all three, rather than each one's own.
    const sheetStops = () => [...(sheet?.el?.querySelectorAll('button, a[href]') || [])]
      .filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.closest('[hidden]'));
    // The ring shows once a switch (or a spoken verb) has been used here, not before: a person pressing with a finger
    // never sees a cursor they did not ask for (on a phone it read as "this button is chosen").
    let scanning = false;
    function paintCursor() {
      if (!root) return;
      for (const el of root.querySelectorAll('.is-scan')) el.classList.remove('is-scan');
      if (!scanning) return;
      if (sheet?.kind === 'theme') return;   // the gallery lights its own rows (choice_picker.js)
      if (sheet) { const s = sheetStops(); if (s.length) s[stepCursor(cursor.at, s.length, 0)].classList.add('is-scan'); return; }
      if (scanModeOf(chooseMode()) === 'rows') {
        const cs = cards();
        if (!cs.length) return;
        const c = cs[stepCursor(cursor.card, cs.length, 0)];
        if (cursor.level === 'cards') { c.classList.add('is-scan'); return; }
        const st = stopsIn(c);
        if (st.length) st[stepCursor(cursor.at, st.length, 0)].classList.add('is-scan');
        return;
      }
      const st = allStops();
      if (st.length) st[stepCursor(cursor.at, st.length, 0)].classList.add('is-scan');
    }
    function verb(v) {
      pokeClose();
      // The first verb only shows where the cursor is (the calculator's rule: a select nobody can see the target of
      // should not press something).
      if (!scanning) { scanning = true; paintCursor(); if (v !== 'back' && sheet?.kind !== 'theme') return; }
      // "Theme for my page": the gallery's own row-and-column walk (choice_picker.js); its back from the rows is Keep.
      if (sheet?.kind === 'theme' && sheet.child && typeof sheet.child.next === 'function') {
        const g = sheet.child;
        if (v === 'next') g.next(); else if (v === 'prev') g.prev(); else if (v === 'select') g.select();
        else if (v === 'back') g.back();
        return;
      }
      if (sheet) {
        const s = sheetStops();
        if (v === 'back') { closeSheet(); return; }
        if (v === 'next' || v === 'prev') { cursor.at = stepCursor(cursor.at, s.length, v === 'next' ? 1 : -1); paintCursor(); return; }
        if (v === 'select') { const b = s[stepCursor(cursor.at, s.length, 0)]; if (b) b.click(); }
        return;
      }
      if (scanModeOf(chooseMode()) === 'rows') {
        const cs = cards();
        if (!cs.length) return;
        if (cursor.level === 'cards') {
          if (v === 'next' || v === 'prev') { cursor.card = stepCursor(cursor.card, cs.length, v === 'next' ? 1 : -1); paintCursor(); return; }
          if (v === 'select') {
            const st = stopsIn(cs[stepCursor(cursor.card, cs.length, 0)]);
            // A card with one thing on it is taken by the select that would have gone into it (picture_picker.js's rule).
            if (st.length === 1) { press(st[0]); return; }
            cursor.level = 'actions'; cursor.at = 0; paintCursor();
          }
          return;
        }
        const st = stopsIn(cs[stepCursor(cursor.card, cs.length, 0)]);
        if (v === 'back') { cursor.level = 'cards'; paintCursor(); return; }
        if (v === 'next' || v === 'prev') { cursor.at = stepCursor(cursor.at, st.length, v === 'next' ? 1 : -1); paintCursor(); return; }
        if (v === 'select' && st.length) press(st[stepCursor(cursor.at, st.length, 0)]);
        return;
      }
      const st = allStops();
      if (v === 'next' || v === 'prev') { cursor.at = stepCursor(cursor.at, st.length, v === 'next' ? 1 : -1); paintCursor(); return; }
      if (v === 'select' && st.length) press(st[stepCursor(cursor.at, st.length, 0)]);
    }

    // ---- presses ----------------------------------------------------------------------------------------
    function press(el) {
      if (!el) return;
      // A link (Call) is followed the way a click follows it.
      if (el.tagName === 'A') { el.click(); return; }
      act(el.dataset.ppAct, el);
    }
    function act(what, el) {
      const key = el?.dataset?.ppCardKey || '';
      if (el && el.getAttribute('aria-disabled') === 'true') {
        // A dimmed button says why, on its card, in words (a phone has no hover).
        why = new Map([[key, el.dataset.ppWhy || '']]);
        render();
        return;
      }
      why = new Map();
      const pid = (key.startsWith('p:') ? key.slice(2) : '') || el?.closest?.('[data-pp-person]')?.dataset.ppPerson || '';
      const recId = key.startsWith('r:') ? key.slice(2) : '';
      const secId = key.startsWith('e:') || key.startsWith('s:') ? key.slice(2) : '';
      switch (what) {
        case 'page-edit': startEditing(); return;
        case 'page-done': stopEditing(); return;
        case 'page-add': openLibrary(); return;
        case 'page-theme': openThemePicker(); return;
        case 'show-people': addKind('people'); return;
        case 'put-back': putBack(); return;
        case 'sec-up': moveSec(secId, -1); return;
        case 'sec-down': moveSec(secId, 1); return;
        case 'sec-remove': removeSec(secId); return;
        case 'video-save': saveVideo(secId); return;
        case 'video-play': playVideo(secId); return;
        case 'video-stop': stopVideo(secId); return;
        case 'message': openMessage(pid); return;
        case 'recommend': openRecommend(pid); return;
        case 'rec-play': playRec(recId); return;
        case 'rec-remove': markRec(recId, 'dismissed'); return;
        case 'picture-edit': openPicture(); return;
        case 'invite': openInvite(pid); return;
        case 'connect': openConnect(); return;
        case 'call-name': openCallName(pid); return;
        case 'stop-share': stopSharing(pid, `${key}|stop-share`); return;
        case 'claim-msg': toggleClaimMessages(pid); return;
        case 'holders': openHolders(key === 'self' ? selfId() : pid); return;
        case 'remove-card': removeCard(pid, `${key}|remove-card`); return;
        case 'visit': openVisit(pid); return;
        case 'older': openOlder(); return;
        case 'pick': if (el?.dataset.ppPick) writeWho({ [PICKED_KEY]: togglePicked(pageDoc, el.dataset.ppPick) }); return;
        case 'nimrod': openNimrod(); return;
        case 'more': more(); return;
        default: render();
      }
    }
    function onClick(e) {
      const close = e.target instanceof Element ? e.target.closest('[data-pp-close]') : null;
      if (close && root?.contains(close)) { closeSheet(); return; }
      const el = e.target instanceof Element ? e.target.closest('[data-pp-stop]') : null;
      if (!el || !root?.contains(el) || el.closest('[data-pp-sheet-body]')) return;
      if (el.tagName === 'A' && el.getAttribute('aria-disabled') !== 'true') return;   // the browser follows it
      e.preventDefault();
      act(el.dataset.ppAct, el);
    }
    function onKey(e) { if (e.key === 'Escape' && sheet) { e.preventDefault(); closeSheet(); } }

    // "More": on Home, the page shows the fuller Start here (modules.html homePress 'more'); on a screen, the
    // ready-made Start here dashboard (made the first time it is pressed, like "go to my room").
    function more() {
      if (isScreen()) { publish(DASHBOARD_GO_TOPIC, { prebuilt: MORE_KEY, source: PEOPLE_TYPE, instanceId: ctx.instanceId || null, claim: () => {} }); return; }
      publish(SHELL_HOST, { act: MORE_ACT, from: PEOPLE_TYPE });
    }

    // ---- windows over the page ------------------------------------------------------------------------
    function openSheet(kind, title, { back = '‹ Back to your people' } = {}) {
      closeSheet({ quiet: true });
      const el = root.ownerDocument.createElement('div');
      el.className = 'pp-sheet';
      el.setAttribute('data-pp-sheet', kind);
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', title);
      el.innerHTML = `<div class="pp-sheet-top"><button type="button" class="pp-btn" data-pp-close>${esc(back)}</button><b>${esc(title)}</b></div>
        <div class="pp-sheet-body" data-pp-sheet-body></div>`;
      root.append(el);
      sheet = { kind, title, el, child: null };
      cursor = { ...cursor, at: 0 };
      pokeClose();
      try { el.querySelector('[data-pp-close]').focus({ preventScroll: true }); } catch { /* not focusable */ }
      paintCursor();
      return el.querySelector('[data-pp-sheet-body]');
    }
    function closeSheet({ quiet = false } = {}) {
      clearTimeout(closeTimer); closeTimer = null;
      if (!sheet) return;
      const s = sheet; sheet = null;
      try { s.child?.destroy?.(); } catch (err) { console.error('people: close', err); }
      s.el.remove();
      if (s.kind === 'picture') { try { avatars?.destroy(); } catch { /* gone */ } avatars = null; }
      cursor = { level: 'cards', card: cursor.card, at: 0 };
      if (!quiet) render();
    }
    // On a screen an open window goes back to the people by itself (people_page.js `closeAfterMs` argues it).
    function pokeClose() {
      clearTimeout(closeTimer); closeTimer = null;
      if (!sheet || !isScreen() || !prefs.closeAfterMs) return;
      closeTimer = setTimeout(() => { if (!torn) closeSheet(); }, prefs.closeAfterMs);
    }
    function childBus() {
      const b = ctx.rootBus;
      return b && typeof b.scope === 'function' ? b : createBus();
    }
    function memState(initial = {}) {
      let v = { ...initial };
      const subs = new Set();
      return { get: () => v, set(p) { v = { ...v, ...p }; subs.forEach((f) => { try { f(v); } catch { /* gone */ } }); },
        subscribe(f) { subs.add(f); return () => subs.delete(f); }, load: async () => v, flush: async () => {}, destroy() { subs.clear(); } };
    }
    async function mountChild(type, host, extra = {}) {
      if (!getManifest(type)) { host.innerHTML = `<p class="pp-note" style="padding:12px">This is not available here.</p>`; return null; }
      const inst = mountModule(type, extendCtx(ctx, {
        mount: host, bus: childBus(), instanceId: `${ctx.instanceId || 'people'}-${type}`, state: memState(), events: null,
        makePersonState: makePS, ...extra,
      }));
      await inst.init();
      return inst;
    }
    // "THEME FOR MY PAGE" (2026-10-07): the site's one theme gallery (choice_picker.js, theme_gallery.js) in a window
    // over the page, with "The usual theme" first. A choice is written to the page record (`writeWho`, beside "Who can
    // see my page") and the window closes, so the page is seen in it at once. "Keep …" or Back leaves it as it was.
    // A switch walks the gallery's own rows (its `next`/`prev`/`select`/`back`, see `verb`), not every tile in turn.
    function openThemePicker() {
      if (!canEdit()) return;
      const W = PAGE_LOOK_WORDS;
      const cur = themeOf(pageDoc);
      const host = openSheet('theme', W.colours);
      const own = colourState().viewerKeepsOwn && cur;
      host.innerHTML = `<div class="pp-theme"><p class="pp-note" data-pp-theme-line>${esc(own ? W.coloursOwn : W.coloursLine)}</p>
        <div data-pp-theme-list></div></div>`;
      let themes = [];
      try { themes = listThemes(); } catch { themes = []; }
      const options = [{ value: '', label: W.coloursNone, hint: W.coloursNoneHint }, ...themes.map((t) => ({ value: t.id, label: t.label }))];
      // A theme this version does not have (a newer site chose it) is kept, and named as such, not quietly swapped.
      if (cur && !options.some((o) => o.value === cur)) options.push({ value: cur, label: EDIT_WORDS.newer });
      const mine = sheet;
      try {
        sheet.child = mountChoicePicker(host.querySelector('[data-pp-theme-list]'), {
          title: '', key: 'theme', preview: 'theme', value: cur, options, cancel: true,
          onPick: (v) => { if (sheet !== mine) return; closeSheet({ quiet: true }); writeWho({ [THEME_KEY]: themeOf({ [THEME_KEY]: v }) }); },
          onCancel: () => { if (sheet === mine) closeSheet(); },
        });
      } catch (err) { console.error('people: themes', err); host.textContent = 'The themes could not be shown here just now.'; }
      paintCursor();
    }
    async function openNimrod() {
      const host = openSheet('nimrod', 'Nimrod');
      try { sheet.child = await mountChild('nimrod', host); } catch (err) { console.error('people: nimrod', err); host.textContent = 'Nimrod could not open here just now.'; }
      paintCursor();
    }
    async function openPicture() {
      const host = openSheet('picture', 'My picture');
      try { sheet.child = await mountChild('avatar', host); } catch (err) { console.error('people: picture', err); host.textContent = 'Your picture could not be opened here just now.'; }
      paintCursor();
    }
    function openMessage(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('message', `A message for ${p.name}`);
      host.style.padding = '12px';
      try {
        sheet.child = mountNoteVisit(host, { personId: p.reach || p.id, personName: p.name, user: account() });
        sheet.personId = p.id;
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: message', err); host.textContent = 'The message could not be opened here just now.'; }
    }
    // "See their page": their page, read-only, as the server hands it to you (page_visit.js). "Leave a note" there is
    // the card's own "Send a message" -- the same answer from the server, the same note.
    function openVisit(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('visit', VISIT_WORDS.title(p.profileName || p.name));
      host.style.padding = '12px';
      const msg = actionsFor(p, { isScreen: isScreen(), may: mayCallNow(p.reach), noteStatus: notes.get(p.reach) ?? null, callHref: '' })
        .find((a) => a.act === 'message') || { enabled: false, reason: '', short: '' };
      try {
        sheet.child = mountPageVisit(host, { personId: p.id, name: p.profileName || p.name, faceHTML: faceOf(p, SELF_FACE), reach: p.reach,
          note: { enabled: msg.enabled, reason: msg.reason, short: msg.short }, user: account(), baseCtx: ctx, isScreen: isScreen() });
        sheet.personId = p.id;
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: visit', err); host.textContent = VISIT_WORDS.failed; }
    }
    // "See older messages": every message left for you, newest first, a page at a time.
    function openOlder() {
      const me = selfId();
      if (!me) return;
      const host = openSheet('older', OLDER_WORDS.title);
      host.style.padding = '12px';
      try {
        sheet.child = mountOlderMessages(host, { personId: me, user: account() });
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: older', err); host.textContent = OLDER_WORDS.failed; }
    }
    // ---- people across accounts (claim.js) ------------------------------------------------------------------
    function openInvite(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('invite', CLAIM_WORDS.inviteTitle(p.name));
      host.style.padding = '12px';
      try {
        sheet.child = mountInviteSheet(host, { kind: 'claim', person: { id: p.id, name: p.name }, people: own || [], client: claimsClient() });
        sheet.personId = p.id;
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: invite', err); host.textContent = CLAIM_WORDS.failed; }
    }
    function openConnect() {
      const host = openSheet('invite', CLAIM_WORDS.connectTitle);
      host.style.padding = '12px';
      try {
        sheet.child = mountInviteSheet(host, { kind: 'connect', people: own || [], client: claimsClient() });
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: connect', err); host.textContent = CLAIM_WORDS.failed; }
    }
    // "I call them…": your own name for one of your people - somebody whose profile lives on their own login, or
    // (2026-10-05) somebody you made, as a label only you see. Saved, the page reads your people again, so the card
    // shows it at once.
    function openCallName(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('callname', CLAIM_WORDS.callTitle(p.profileName || p.name));
      host.style.padding = '12px';
      try {
        // Who sees it (2026-10-05): everyone on this login, or just the person this page is for (claim.js callLevels).
        const me = selfRow();
        sheet.child = mountCallName(host, { person: { id: p.id, call_name: p.callName, viewer_call_name: p.viewerCallName, profile_name: p.profileName || p.name, home: !!p.home },
          client: claimsClient(), viewer: selfId() ? { id: selfId(), name: selfName(me) } : null, alone: peopleHere() <= 1,
          onChange: () => { afterClaimChange(); } });
        sheet.personId = p.id;
        paintCursor();
      } catch (err) { console.error('people: call name', err); host.textContent = CLAIM_WORDS.failed; }
    }
    // TWO PRESSES: the first turns the button into "Press again to stop sharing" (claim.js STOP_CONFIRM_MS argues
    // the time); the second, within it, stops. Either side may (the server checks which).
    async function stopSharing(pid, armKey) {
      if (!pid) return;
      if (twoPress(armed && armed.key === armKey ? armed.at : 0, Date.now()) === 'arm') {
        armed = { key: armKey, at: Date.now() };
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { if (armed && armed.key === armKey) { armed = null; render(); } }, STOP_CONFIRM_MS + 50);
        render();
        return;
      }
      armed = null; clearTimeout(armTimer);
      const p = people().find((x) => x.id === pid) || {};
      const name = p.kind === 'joined' ? p.name : (p.from || p.name || '');
      const cardKey = armKey.split('|')[0];
      try {
        const r = await claimsClient().stop(pid);
        why = new Map([[cardKey, r.status === 200 ? (p.kind === 'joined' ? CLAIM_WORDS.stoppedJoined(name) : CLAIM_WORDS.stopped(name)) : CLAIM_WORDS.failed]]);
      } catch { why = new Map([[cardKey, CLAIM_WORDS.failed]]); }
      await afterClaimChange();
      // The card that said it may have gone (a card the connection made): say it on your own card instead.
      if (!root?.querySelector(`[data-pp-card="${cardKey}"]`)) { why = new Map([['self', [...why.values()][0] || '']]); render(); }
    }
    // "Remove just this card": the same two presses as Stop sharing; the second takes this one card off your page and
    // keeps the connection (the server checks it is yours, and may go).
    async function removeCard(pid, armKey) {
      if (!pid) return;
      if (twoPress(armed && armed.key === armKey ? armed.at : 0, Date.now()) === 'arm') {
        armed = { key: armKey, at: Date.now() };
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { if (armed && armed.key === armKey) { armed = null; render(); } }, STOP_CONFIRM_MS + 50);
        render();
        return;
      }
      armed = null; clearTimeout(armTimer);
      const p = people().find((x) => x.id === pid) || {};
      const cardKey = armKey.split('|')[0];
      let said = CLAIM_WORDS.failed;
      try {
        const r = await claimsClient().removeCard(pid);
        said = r.status === 200 ? CLAIM_WORDS.removed(p.name || '') : (r.body?.text || r.body?.detail || CLAIM_WORDS.failed);
      } catch { said = CLAIM_WORDS.failed; }
      why = new Map([[cardKey, said]]);
      await afterClaimChange();
      // The card that said it has gone: say it on your own card instead.
      if (!root?.querySelector(`[data-pp-card="${cardKey}"]`)) { why = new Map([['self', said]]); render(); }
    }
    // "Shared with": the list, in a window over the page (claim.js mountHolders). A change
    // there reads your people again, so the counts on the cards follow.
    function openHolders(pid) {
      if (!pid) return;
      const self = pid === selfId();
      const p = self ? { ...selfRow(), kind: 'you' } : people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('holders', CLAIM_WORDS.holdersTitle(self ? '' : p.name));
      host.style.padding = '12px';
      try {
        sheet.child = mountHolders(host, { person: { id: p.id, name: p.name, you: self }, client: claimsClient(), onChange: () => { afterClaimChange(); } });
        sheet.personId = p.id;
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: holders', err); host.textContent = CLAIM_WORDS.failed; }
    }
    async function toggleClaimMessages(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p || !p.linked) return;
      try {
        const r = await claimsClient().setMessages(pid, !p.messagesFromThem);
        if (r.status !== 200) why = new Map([[`p:${pid}`, CLAIM_WORDS.failed]]);
      } catch { why = new Map([[`p:${pid}`, CLAIM_WORDS.failed]]); }
      await afterClaimChange();
    }
    // Who is on the page, what they are called, and who may get a message can all change: read them again.
    async function afterClaimChange() {
      await loadPeople();
      notes.clear();
      if (torn) return;
      render();
      await checkNotes();
      if (!torn) render();
    }

    function openRecommend(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('recommend', `A song or video for ${p.name}`);
      host.style.padding = '12px';
      try {
        sheet.child = mountRecommend(host, { personId: p.reach || p.id, personName: p.name, fromPersonId: selfId(), user: account() });
        sheet.personId = p.id;
        paintCursor();
      } catch (err) { console.error('people: recommend', err); host.textContent = 'This could not be opened here just now.'; }
    }
    // Seen (played or opened) and Remove are the person's own marks on their own list; appended, never deleted.
    async function markRec(id, mark) {
      const r = recs.find((x) => String(x.id) === String(id));
      if (!r) return;
      if (mark === 'dismissed') { recs = recs.filter((x) => x !== r); render(); } else { r.seen = true; }
      try {
        await fetch(markURL(selfId(), r.id, mark), { method: 'POST', headers: authHeaders(account()), credentials: 'same-origin' });
      } catch (err) { console.error('people: mark', err); }
    }
    // Play: YouTube in the site's own player over the page (recommend.js mountRecommendedVideo); Spotify in a new tab.
    // ON A SCREEN the video goes back to the people when it ends, or after "close after" with nothing playing -- the
    // player's own progress beat restarts that clock, so a playing video is never cut off.
    async function playRec(id) {
      const r = recs.find((x) => String(x.id) === String(id));
      if (!r) return;
      const plan = playPlan(r, { isScreen: isScreen() });
      if (plan.how === 'tab') { openPageTab(plan.url); markRec(r.id, 'seen'); render(); return; }
      if (plan.how !== 'youtube') return;
      markRec(r.id, 'seen');
      const host = openSheet('video', recLine(r));
      const mine = sheet;
      try {
        const child = await mountRecommendedVideo(host, { rec: r, baseCtx: ctx, instanceId: `${ctx.instanceId || 'people'}-rec-video`,
          onBeat: () => { if (sheet === mine) pokeClose(); },
          onDone: () => { if (sheet === mine && isScreen()) closeSheet(); } });
        if (sheet !== mine || torn) { child.destroy(); return; }
        mine.child = child;
      } catch (err) { console.error('people: video', err); host.textContent = 'The video could not be played here just now.'; }
      paintCursor();
    }

    async function refresh() {
      // The person may have been found since the page mounted (a screen learning whose it is): their page too.
      if (!pageState) { await openPage(); if (!torn) render(); }
      await loadPeople();
      if (torn) return;
      render();
      await Promise.all([checkNotes(), loadInbox()]);
      if (!torn) render();
    }

    return {
      async init() {
        const doc = mount.ownerDocument;
        root = doc.createElement('div');
        root.className = 'pp-root';
        root.setAttribute('data-people-page', isScreen() ? 'screen' : 'page');
        root.innerHTML = '<div class="pp-list" data-pp-list></div>';
        const style = doc.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKey);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        root.addEventListener('pointerdown', () => pokeClose(), { passive: true });
        // The page's settings and the person's own page record, read side by side (one round trip, not two).
        await Promise.all([
          (async () => { try { await ctx.state?.load?.(); } catch { /* a preview, or offline: the defaults stand */ } })(),
          openPage().catch(() => {}),
        ]);
        if (torn) return;
        prefs = peoplePrefs(ctx.state?.get?.() || {});
        render();
        try {
          offState = ctx.state?.subscribe?.((v) => {
            const next = peoplePrefs(v || {});
            const again = next.incoming !== prefs.incoming || next.recommended !== prefs.recommended;
            prefs = next;
            if (again) loadInbox().then(() => render()); else render();
          }) || null;
        } catch { offState = null; }
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(PEOPLE_VERB_TOPICS.next, () => verb('next'));
        on(PEOPLE_VERB_TOPICS.prev, () => verb('prev'));
        on(PEOPLE_VERB_TOPICS.select, () => verb('select'));
        on(PEOPLE_VERB_TOPICS.back, () => verb('back'));
        // Nimrod at the bottom (modules/helper.js): this page opens him over itself.
        on(HELPER_OPEN_TOPIC, (p) => { try { p?.claim?.(); } catch { /* a publisher's claim must not stop the press */ } openNimrod(); });
        await refresh();
        if (isScreen()) refreshTimer = setInterval(() => { if (!torn) loadInbox().then(() => render()); }, INCOMING_REFRESH_MS);
        const vis = () => { if (!torn && doc.visibilityState === 'visible') loadInbox().then(() => render()); };
        doc.addEventListener('visibilitychange', vis);
        offs.push(() => doc.removeEventListener('visibilitychange', vis));
      },
      onResize() {},
      onHide() {},
      destroy() {
        // Something typed in About me and not yet saved is saved now, before the page goes.
        clearTimeout(aboutTimer);
        try { flushAbout(); } catch { /* nothing to save */ }
        torn = true;
        clearTimeout(closeTimer); clearInterval(refreshTimer); clearTimeout(armTimer);
        try { sheet?.child?.destroy?.(); } catch { /* gone */ }
        sheet = null;
        for (const id of [...boxes.keys()]) unmountBox(id);
        wrappers.clear();
        try { offPage?.(); } catch { /* gone */ }
        if (pageState) {
          const h = pageState; pageState = null;
          Promise.resolve(saving).then(() => h.flush?.()).catch(() => {}).finally(() => { try { h.destroy?.(); } catch { /* gone */ } });
        }
        root?.removeEventListener('input', onInput);
        root?.removeEventListener('change', onChange);
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        try { avatars?.destroy(); } catch { /* gone */ }
        root?.removeEventListener('click', onClick);
        root?.removeEventListener('keydown', onKey);
        mount.innerHTML = '';
        root = null;
      },
      __probe: () => ({
        people: people(), self: selfRow(), notes: Object.fromEntries(notes), incoming: incoming.slice(), recs: recs.map((r) => ({ ...r })), prefs: { ...prefs },
        sheet: sheet ? sheet.kind : null, cursor: { ...cursor }, mode: scanModeOf(chooseMode()), isScreen: isScreen(),
        claims: { armed: armed ? armed.key : null },
        invite: sheet?.kind === 'invite' ? sheet.child?.__probe?.() || null : null,
        visit: sheet?.kind === 'visit' && sheet.child ? { status: sheet.child.status(), sections: sheet.child.sections(), noteOpen: sheet.child.noteOpen(),
          colours: sheet.child.colours(), pageTheme: sheet.child.pageTheme() } : null,
        look: { colours: worn, theme: themeOf(pageDoc), older: olderOf(pageDoc), olderHere: prefs.olderHere !== false },
        // "Theme for my page": the gallery's own probe while its window is open (choice_picker.js).
        themePicker: sheet?.kind === 'theme' ? sheet.child?.__probe?.() || null : null,
        older: sheet?.kind === 'older' && sheet.child ? { status: sheet.child.status(), rows: sheet.child.rows(), more: sheet.child.hasMore() } : null,
        who: whoOf(pageDoc), picked: pickedOf(pageDoc),
        page: { sections: viewSections(pageDoc, { isScreen: isScreen() }).map((s) => ({ kind: s.kind, id: s.id, known: s.known })), editing,
          own: Array.isArray(pageDoc?.sections), canEdit: canEdit(), boxes: [...boxes].map(([id, b]) => ({ id, kind: b.kind, mounted: !!b.inst })) },
        flushPage: () => Promise.resolve(saving).then(() => pageState?.flush?.()),
        stops: (sheet ? sheetStops() : allStops()).map((b) => b.textContent.trim()),
      }),
    };
  },
);
