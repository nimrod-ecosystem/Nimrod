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
//   Invite them to use this  (2026-10-04, claim.js; the rules are web/server/claims.py) under each of your own
//                  people but you: a link (and a code to scan) that, opened and signed in to with somebody's own
//                  login, makes that person theirs. Once they have joined the card says "— joined", with "Stop
//                  sharing" (two presses) and their messages on / off. On THEIR page: a "You are Mom on Pat's
//                  people" card (Edit that picture, Stop sharing) and Pat's people as cards with the same buttons,
//                  each live or dimmed by the same rules as everybody else's.
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
// "Invite them to use this" / "— joined" / "Stop sharing" (claim.js; the rules are the server's claims.py).
import { createClaimsClient, linkedPeopleFrom, givenFor, mountInviteSheet, twoPress, CLAIM_WORDS, STOP_CONFIRM_MS } from '../claim.js';
import { mountNoteVisit, screensURL, noteURL } from '../note_visit.js';
import { currentNote, whenOf, whenWords } from './note.js';
import { mayCall, callURL } from './profile.js';
import { SHELL_HOST } from '../shell_verbs.js';
import { DASHBOARD_GO_TOPIC } from '../dashboard_nest.js';
import {
  PEOPLE_TYPE, PEOPLE_SETTINGS, PEOPLE_VERB_TOPICS, HELPER_OPEN_TOPIC, WHY, connectionsFrom, actionsFor,
  noteStatusFrom, scanModeOf, stepCursor, incomingFrom,
} from '../people_page.js';

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
    // Claims (claim.js): `mine` = people on OTHER logins this one took over (with their people); `given` = your
    // people somebody else's login took over. claimsOK: null not read yet, false could not read, true read.
    let claimsMine = [], claimsGiven = [], claimsOK = null;
    let armed = null;             // { key, at } - the first press of a two-press "Stop sharing"
    let armTimer = null;
    let avatars = null;
    let sheet = null;             // { kind, title, el, child, personId }
    let why = new Map();          // card key -> the reason last tapped, shown on that card
    let cursor = { level: 'cards', card: 0, at: 0 };
    let closeTimer = null, refreshTimer = null;
    const offs = [];
    let offState = null;

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
    async function loadPeople() {
      if (typeof ctx.profiles?.people === 'function') {
        try { own = (await ctx.profiles.people()) || []; peopleNote = ''; }
        catch { own = null; peopleNote = 'Your people could not be read just now.'; }
      } else { own = null; }
      if (typeof ctx.profiles?.sharedWithMe === 'function') {
        try { const r = await ctx.profiles.sharedWithMe(); shared = Array.isArray(r) ? r : []; } catch { shared = []; }
      } else { shared = []; }
      await loadClaims();
    }
    const claimsClient = () => createClaimsClient({ user: account() });
    async function loadClaims() {
      if (typeof fetch !== 'function') { claimsMine = []; claimsGiven = []; claimsOK = false; return; }
      try {
        const r = await claimsClient().list();
        const ok = r.status === 200 && r.body;
        claimsMine = ok && Array.isArray(r.body.mine) ? r.body.mine : [];
        claimsGiven = ok && Array.isArray(r.body.given) ? r.body.given : [];
        claimsOK = !!ok;
      } catch { claimsMine = []; claimsGiven = []; claimsOK = false; }
    }
    const selfRow = () => (Array.isArray(own) ? own.find((p) => p.id === selfId()) : null) || { id: selfId(), name: '' };
    // Your account's people and those shared with you (people_page.js), then the people you see because you took
    // over somebody on another login's people (claim.js linkedPeopleFrom) - each once.
    const people = () => {
      const list = connectionsFrom({ own: own || [], shared: shared || [], selfId: selfId() });
      for (const l of linkedPeopleFrom(claimsMine)) if (l.id !== selfId() && !list.some((x) => x.id === l.id)) list.push(l);
      return list;
    };
    const mayCallNow = (pid) => mayCall(pid, { own: Array.isArray(own) ? own : null, shared });

    // May a message be left for them? Asked once per card, off a screen only (a screen sends nothing).
    async function checkNotes() {
      if (isScreen()) return;
      // (A signed-in browser needs no `user`: its cookie goes with the request. Nobody signed in: the server says no,
      // and the button says to try later rather than "Checking…" for ever.)
      await Promise.all(people().filter((p) => !notes.has(p.id)).map(async (p) => {
        try { const r = await getJSON(screensURL(p.id)); notes.set(p.id, noteStatusFrom(r.status, r.body)); }
        catch { notes.set(p.id, 'error'); }
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

    function selfCard() {
      const me = selfRow();
      const pic = isScreen()
        ? ''
        : `<div class="pp-btns">${button({ act: 'picture-edit', label: 'Edit my picture', enabled: !!me.id,
          reason: me.id ? '' : 'Sign in to have a picture of your own.', short: me.id ? '' : 'Sign in first' }, 'self')}</div>`;
      return card('self', `<div class="pp-who"><div class="pp-face">${faceOf(me, SELF_FACE)}</div>
        <div><div class="pp-name" data-pp-self-name>${esc(me.name || (me.id ? 'You' : 'Welcome'))}</div>
        <p class="pp-sub">${isScreen() ? 'This screen is for you.' : 'You'}</p></div></div>${pic}`, ' pp-self');
    }

    function incomingHTML() {
      if (!prefs.incoming) return '';
      return `<h2 class="pp-h">Messages for you</h2>${incoming.length
        ? incoming.map((m) => `<p class="pp-msg" data-pp-incoming><b>${esc(m.author || 'Someone')}</b>: ${esc(m.text)}
            <br><small>${esc(whenWords(m.at))}</small></p>`).join('')
        : '<p class="pp-note" data-pp-incoming-none>No messages yet. When someone leaves you one, it shows here.</p>'}`;
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
        const acts = actionsFor(p, { isScreen: false, may: mayCallNow(p.id), noteStatus: notes.get(p.id) ?? null, callHref: callURL(p.id) });
        const given = p.via === 'account' ? givenFor(p.id, claimsGiven) : null;
        const sub = p.via === 'shared' ? 'Shared with you'
          : p.via === 'linked' ? (p.joined ? CLAIM_WORDS.linkedJoinedSub(p.from) : CLAIM_WORDS.linkedSub(p.from))
            : given ? CLAIM_WORDS.joinedSub : 'Added by you';
        return card(`p:${p.id}`, `<div class="pp-who"><div class="pp-face">${faceOf(p, CARD_FACE)}</div>
            <div><div class="pp-name"><span data-pp-name>${esc(p.name)}</span>${given ? ` <span class="pp-joined" data-pp-joined>— ${esc(CLAIM_WORDS.joined)}</span>` : ''}</div><p class="pp-sub">${esc(sub)}</p></div></div>
          <div class="pp-btns" data-pp-person="${esc(p.id)}">${acts.map((a) => button(a, `p:${p.id}`)).join('')}</div>${claimRow(p, given)}`);
      }).join('');
    }

    // UNDER ONE OF YOUR OWN PEOPLE: "Invite them to use this" (claim.js), or - once they have joined - "Stop sharing"
    // (two presses) and their messages on / off. Not under you (the account's first person cannot be handed over:
    // claims.py `invite_refusal`), and not under anybody who is not on your account.
    const stopLabel = (key) => (armed && armed.key === key && twoPress(armed.at, Date.now()) === 'fire');
    function claimRow(p, given) {
      if (p.via !== 'account' || (Array.isArray(own) && own[0] && own[0].id === p.id)) return '';
      const key = `p:${p.id}`;
      let btns;
      if (given) {
        const again = stopLabel(`${key}|stop-share`);
        btns = [button({ act: 'stop-share', label: again ? CLAIM_WORDS.stopAgain : CLAIM_WORDS.stop, short: CLAIM_WORDS.stopShort, enabled: true }, key),
          button({ act: 'claim-msg', label: given.messages ? CLAIM_WORDS.msgOn : CLAIM_WORDS.msgOff, short: CLAIM_WORDS.msgShort, enabled: true }, key)];
      } else {
        const can = claimsOK === true;
        btns = [button({ act: 'invite', label: CLAIM_WORDS.invite, short: can ? CLAIM_WORDS.inviteShort : (claimsOK === null ? 'Checking…' : 'Try again later'),
          enabled: can, reason: can ? '' : (claimsOK === null ? 'Checking…' : CLAIM_WORDS.failed) }, key)];
      }
      return `<div class="pp-btns" data-pp-claim="${esc(p.id)}">${btns.join('')}</div>`;
    }

    // YOU, ON SOMEBODY ELSE'S PEOPLE: one card per person this login took over - who you are there, "Edit that
    // picture" (the picture is yours now), and "Stop sharing" (two presses; it goes back to whoever set it up).
    function joinedCards() {
      return claimsMine.map((c) => {
        const key = `j:${c.person_id}`;
        const again = stopLabel(`${key}|stop-mine`);
        return card(key, `<div class="pp-who"><div class="pp-face">${faceOf({ id: c.person_id, name: c.name }, CARD_FACE)}</div>
            <div><div class="pp-name" data-pp-you-are>${esc(CLAIM_WORDS.youAre(c.name, c.from))}</div><p class="pp-sub">${esc(CLAIM_WORDS.youAreSub)}</p></div></div>
          <div class="pp-btns" data-pp-joined-as="${esc(c.person_id)}">${button({ act: 'edit-there', label: CLAIM_WORDS.editThere, enabled: true }, key)}
            ${button({ act: 'stop-mine', label: again ? CLAIM_WORDS.stopAgain : CLAIM_WORDS.stopMine, short: CLAIM_WORDS.stopMineShort, enabled: true }, key)}</div>`);
      }).join('');
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

    const connectCard = () => card('connect', `<h2 class="pp-h">Connect with someone</h2>
      <p class="pp-note" data-pp-connect>Made someone here for a relative or friend? Press “Invite them to use this” on their card and send
      them the link: when they open it and sign in with their own login, it becomes theirs, and you show on each other’s page.
      Whoever looks after a screen can also share it with you, and that person shows up here.</p>`);
    const moreCard = () => card('more', `<div class="pp-btns">${button({ act: 'more', label: 'More', short: 'Your settings, your devices and more', enabled: true }, 'more')}
      ${button({ act: 'nimrod', label: 'Ask Nimrod', short: 'He shows you around', enabled: true }, 'more')}</div>`);

    function render() {
      if (!root || torn) return;
      const keepFocus = root.ownerDocument.activeElement;
      const focusAct = keepFocus && root.contains(keepFocus) ? `${keepFocus.dataset?.ppCardKey || ''}|${keepFocus.dataset?.ppAct || ''}` : null;
      const list = isScreen()
        ? [selfCard(), incomingHTML(), recommendedHTML(), screenFaces(), moreCard()]
        : [selfCard(), joinedCards(), incomingHTML(), recommendedHTML(), `<h2 class="pp-h">Your people</h2>`, peopleCards(), connectCard(), moreCard()];
      const body = root.querySelector('[data-pp-list]');
      body.innerHTML = list.join('');
      paintCursor();
      if (focusAct) {
        const [k, a] = focusAct.split('|');
        const el = [...root.querySelectorAll('[data-pp-stop]')].find((b) => b.dataset.ppCardKey === k && b.dataset.ppAct === a);
        try { el?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      }
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
      if (!scanning) { scanning = true; paintCursor(); if (v !== 'back') return; }
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
      switch (what) {
        case 'message': openMessage(pid); return;
        case 'recommend': openRecommend(pid); return;
        case 'rec-play': playRec(recId); return;
        case 'rec-remove': markRec(recId, 'dismissed'); return;
        case 'picture-edit': openPicture(); return;
        case 'invite': openInvite(pid); return;
        case 'stop-share': stopSharing(pid, `${key}|stop-share`); return;
        case 'claim-msg': toggleClaimMessages(pid); return;
        case 'edit-there': openPictureThere(key.startsWith('j:') ? key.slice(2) : ''); return;
        case 'stop-mine': stopSharing(key.startsWith('j:') ? key.slice(2) : '', `${key}|stop-mine`); return;
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
    function openSheet(kind, title) {
      closeSheet({ quiet: true });
      const el = root.ownerDocument.createElement('div');
      el.className = 'pp-sheet';
      el.setAttribute('data-pp-sheet', kind);
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', title);
      el.innerHTML = `<div class="pp-sheet-top"><button type="button" class="pp-btn" data-pp-close>‹ Back to your people</button><b>${esc(title)}</b></div>
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
        sheet.child = mountNoteVisit(host, { personId: p.id, personName: p.name, user: account() });
        sheet.personId = p.id;
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: message', err); host.textContent = 'The message could not be opened here just now.'; }
    }
    // ---- claims (claim.js) ------------------------------------------------------------------------------
    function openInvite(pid) {
      const p = people().find((x) => x.id === pid);
      if (!p) return;
      const host = openSheet('invite', CLAIM_WORDS.inviteTitle(p.name));
      host.style.padding = '12px';
      try {
        sheet.child = mountInviteSheet(host, { person: { id: p.id, name: p.name }, client: claimsClient() });
        sheet.personId = p.id;
        Promise.resolve(sheet.child.ready).then(() => paintCursor());
      } catch (err) { console.error('people: invite', err); host.textContent = CLAIM_WORDS.failed; }
    }
    // The picture of the person you ARE on somebody else's people (the server lets the claimer write that one key).
    async function openPictureThere(pid) {
      const c = claimsMine.find((x) => x.person_id === pid);
      if (!c) return;
      const host = openSheet('picture', `${c.name}’s picture`);
      try { sheet.child = await mountChild('avatar', host, { personId: pid }); } catch (err) { console.error('people: picture there', err); host.textContent = CLAIM_WORDS.failed; }
      paintCursor();
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
      const name = (claimsGiven.find((g) => g.person_id === pid) || claimsMine.find((m) => m.person_id === pid) || {}).name || '';
      const cardKey = armKey.split('|')[0];
      try {
        const r = await claimsClient().stop(pid);
        why = new Map([[cardKey, r.status === 200 ? CLAIM_WORDS.stopped(name) : CLAIM_WORDS.failed]]);
      } catch { why = new Map([[cardKey, CLAIM_WORDS.failed]]); }
      await afterClaimChange();
      // The card that said it may have gone (the claimer's own "you are" card): say it on the self card instead.
      if (!root?.querySelector(`[data-pp-card="${cardKey}"]`)) { why = new Map([['self', [...why.values()][0] || '']]); render(); }
    }
    async function toggleClaimMessages(pid) {
      const g = claimsGiven.find((x) => x.person_id === pid);
      if (!g) return;
      try {
        const r = await claimsClient().setMessages(pid, !g.messages);
        if (r.status !== 200) why = new Map([[`p:${pid}`, CLAIM_WORDS.failed]]);
      } catch { why = new Map([[`p:${pid}`, CLAIM_WORDS.failed]]); }
      await afterClaimChange();
    }
    // Who is on the page, and who may get a message, can both change with a claim: read both again.
    async function afterClaimChange() {
      await loadClaims();
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
        sheet.child = mountRecommend(host, { personId: p.id, personName: p.name, fromPersonId: selfId(), user: account() });
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
        root.addEventListener('pointerdown', () => pokeClose(), { passive: true });
        try { await ctx.state?.load?.(); } catch { /* a preview, or offline: the defaults stand */ }
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
        torn = true;
        clearTimeout(closeTimer); clearInterval(refreshTimer); clearTimeout(armTimer);
        try { sheet?.child?.destroy?.(); } catch { /* gone */ }
        sheet = null;
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
        claims: { mine: claimsMine.map((c) => ({ ...c })), given: claimsGiven.map((g) => ({ ...g })), ok: claimsOK, armed: armed ? armed.key : null },
        invite: sheet?.kind === 'invite' ? sheet.child?.__probe?.() || null : null,
        stops: (sheet ? sheetStops() : allStops()).map((b) => b.textContent.trim()),
      }),
    };
  },
);
