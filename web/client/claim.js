// claim.js — PEOPLE ACROSS ACCOUNTS, the client side: "Connect with someone", "Invite them to use this", "I call
// them", "Stop sharing". 2026-10-04 (night). Later that night, one card at a time (claims.py argues each): "Shared
// with" (first built as "Who has this card"; renamed 2026-10-05, Mike found it confusing) with "Stop sharing with
// <name>" for whoever looks after a profile, and "Remove just this card" for a card a connection put on your page.
// 2026-10-05: "I call them" on every card, at any time - for somebody you made, your private label beside the name on
// their card (claims.py; only you see it either way). Later that day (Mike: "an option to set I call them at account
// vs user levels"), when more than one person uses a login, the window asks who sees the name: "Everyone on this
// login" or "Just <the person the page is for>" (callLevels argues the starting choice; claims.seen_name the rules).
//
// Mike, DECISIONS.md "People across accounts: a profile has a home, and appears on other accounts": most people
// will "just want to be connected like friends on Facebook"; setting a profile up for somebody and handing it over
// is the second way in; one profile can be on several accounts, each calling them what it likes ("Mom" on one,
// "Grandma" on another); and an invite picks which profiles to share, and what the other side may do. The rules are
// the server's (web/server/claims.py). This file is the words, the calls, the window that makes a link (opened over
// Your people, modules/people.js) and the small window for "I call them". join.html / join_page.js is the other end.
//
// *** PLAIN WORDS. *** The people who read these are not building anything: none of Your people's banned words
// (people_page.js BANNED_WORDS) and none of CLAIM_BANNED. `claimWordProblems` is the check, run by the suite over
// everything this file and the join page can say.
//
// NOTHING IS MADE WITHOUT A PRESS. Opening the window reads whether a link is waiting; "Make the link" makes one.

import { authHeaders } from './auth.js';
import { qrSVG } from './qr.js';
import { pageURL, themeQrColours } from './page_links.js';
import { plainWordProblems } from './people_page.js';

export const JOIN_PAGE = '/join.html';
export const INVITE_PARAM = 'invite';

// "Stop sharing" takes two presses: the first turns the button into "Press again to stop sharing", which goes
// back by itself after this long. 6 s, ARGUED rather than a setting: long enough to read the button and press
// again (a slow press, a switch user's next scan step), short enough that a stray press does not leave a live
// trap on the card for the next person to touch. Nothing is lost if it lapses - press it twice again.
export const STOP_CONFIRM_MS = 6000;
// "I call them" is a name: the server's own limit for a person's name (app.py NAME_RE, 60 characters).
export const CALL_NAME_MAX = 60;

// Words the page may not use, beyond Your people's own (module, dashboard, panel, grant).
export const CLAIM_BANNED = Object.freeze(['account', 'token', 'widget', 'identity', 'instance']);
/** The banned words found in `text`. PURE. */
export function claimWordProblems(text) {
  const s = String(text == null ? '' : text);
  const out = plainWordProblems(s);
  for (const w of CLAIM_BANNED) if (new RegExp(`\\b${w}s?\\b`, 'i').test(s)) out.push(w);
  return out;
}

const poss = (name) => (name ? `${name}’s` : 'their');

// Every sentence, in one place, so the suite can hold all of them to the rule above.
export const CLAIM_WORDS = Object.freeze({
  // handing one of your people over
  invite: 'Invite them to use this',
  inviteShort: 'With their own login',
  inviteTitle: (name) => `Invite ${name || 'them'}`,
  inviteLead: (name) => `${name || 'They'} can use this with their own login. It becomes ${poss(name)} own: `
    + 'they can change the name, the picture and the page. You keep calling them what you call them, and '
    + 'everything you set up for them stays as it is.',
  // connecting like friends
  connect: 'Connect with someone',
  connectShort: 'Send them a link',
  connectTitle: 'Connect with someone',
  connectLead: 'Send somebody a link. When they open it and sign in with their own login, you are on each other’s '
    + 'page, and you can send each other messages.',
  connectLine: 'Send somebody a link, and when they open it and sign in you show on each other’s page. Made someone '
    + 'here for a relative or friend? Press “Invite them to use this” on their card instead, and it becomes theirs. '
    + 'Whoever looks after a screen can also share it with you, and that person shows up here.',
  // which people come with it
  sharesLead: 'Who they will see on their page:',
  shareYou: (name) => `${name || 'You'} (you)`,
  shareMsg: (name) => `…and may leave messages for ${name || 'them'}`,
  noneToShare: 'Nobody else to share yet.',
  make: 'Make the link',
  makeAgain: 'Make a new link (the old one stops working)',
  send: (name) => `Send this to ${name || 'them'}. When ${name || 'they'} open${name ? 's' : ''} it and sign${name ? 's' : ''} in, this becomes ${name ? `${name}’s` : 'theirs'}.`,
  sendConnect: 'Send this to whoever you want to connect with. It works for one person.',
  copy: 'Copy the link',
  copied: 'Copied. Paste it into a message or an email.',
  copyFailed: 'Could not copy here. Press and hold the link to copy it.',
  scan: 'Or let them scan this with their phone’s camera:',
  until: (when) => `It works once, until ${when}.`,
  waiting: (name, when) => `A link for ${name || 'them'} is waiting. It works until ${when}.`,
  takeBack: 'Take the link back',
  takenBack: 'Taken back. That link no longer works.',
  // on the cards
  joined: 'joined',
  joinedSub: 'Uses this with their own login',
  connectedSub: 'Connected',
  sharedSub: (from) => `From ${poss(from)} people`,
  addedSub: 'Added by you',
  callThem: 'I call them…',
  callThemShort: (name) => (name ? `Their own name: ${name}` : 'Your own name for them'),
  callTitle: (name) => `What you call ${name || 'them'}`,
  callLabel: 'I call them',
  callHow: (name) => `Only you see this. It does not change the name ${name || 'they'} chose.`,
  // ...on somebody you made yourself: the name on their card is yours to change too, and is what others see.
  callHowMine: (name) => `Only you see this. Anybody you share them with still sees ${name ? `the name on their card, ${name}` : 'the name on their card'}.`,
  // WHO SEES IT, when more than one person uses the same login (Mike, 2026-10-05; the server's claims.seen_name).
  // "Everyone on this login" rather than "everyone on this account" (a banned word) or "everyone here" (on Home,
  // "here" could be the page, the room or the house): the site already calls it a login ("With their own login").
  callLevel: 'Who sees this name',
  callEveryone: 'Everyone on this login',
  callJust: (name) => `Just ${name || 'you'}`,
  callJustAlone: 'Nobody else uses this login yet, so it would be the same name.',
  callJustNobody: 'This page does not know yet who it is for.',
  callHowEveryone: (name, mine) => `Everyone on this login sees this, and nobody else. ${mine
    ? `Anybody you share them with still sees ${name ? `the name on their card, ${name}` : 'the name on their card'}.`
    : `It does not change the name ${name || 'they'} chose.`}`,
  callHowJust: (viewer, name, mine) => `Shows only when this page is for ${viewer || 'you'}. ${mine
    ? `Everybody else sees ${name ? `the name on their card, ${name}` : 'the name on their card'}, or what everyone on this login calls them.`
    : `It does not change the name ${name || 'they'} chose.`}`,
  callBoth: (everyone, viewer, just) => `Everyone on this login: ${everyone || '…'} · Just ${viewer || 'you'}: ${just || '…'}`,
  callClearTo: (name) => `Back to “${name || 'their own name'}”`,
  callSave: 'Save',
  callClear: (name) => `Use ${poss(name)} own name`,
  callSaved: 'Saved.',
  stop: 'Stop sharing',
  stopShort: 'They keep nothing; it stays yours',
  stopLinked: (from) => `Stops everything ${from || 'they'} shared with you`,
  stopAgain: 'Press again to stop sharing',
  stopped: (name) => `Stopped. ${name || 'They'} no longer show${name ? 's' : ''} here, and you no longer show on ${poss(name)} page.`,
  stoppedJoined: (name) => `Stopped. ${name || 'They'} no longer use${name ? 's' : ''} this, and it is yours again.`,
  msgOn: 'Messages from them: on',
  msgOff: 'Messages from them: off',
  msgShort: 'Press to change',
  failed: 'That did not work just now. Try again in a little while.',
  // who a card you look after is shared with (the server's claims.py, "ONE CARD AT A TIME"). "Shared with", the
  // words people know from shared documents and photo albums (Mike, 2026-10-05: "Who has this card" was confusing).
  holders: (n) => (n ? `Shared with ${n}` : 'Not shared yet'),
  holdersShort: (n) => (n ? 'See who, or stop sharing' : 'Share when you connect'),
  holdersYouShort: 'Your card',
  holdersNone: (name) => (name ? `${name} is not shared with anybody yet. Share ${name} when you connect with someone, and they show here.`
    : 'Your card is not shared with anybody yet. Connect with someone, and they show here.'),
  holdersTitle: (name) => (name ? `${name} is shared with` : 'Your card is shared with'),
  holdersLead: (name) => `${name || 'You'} ${name ? 'is' : 'are'} on these people’s pages. Each shows by their own name; `
    + `whatever they call ${name || 'you'} stays theirs.`,
  someone: 'Someone',
  through: (who) => `Through ${who || 'someone else'}`,
  holderJoined: (name) => `Set this card up for ${name || 'you'} first`,
  holderHas: 'Has it on their page',
  stopWith: (n) => `Stop sharing with ${n || 'them'}`,
  stopWithShort: 'Takes this one card off their page',
  stopWithJoinedShort: 'Their card goes back to how they had it',
  stopWithAgain: 'Press again to stop sharing',
  stoppedWith: (n) => `Stopped. No longer shared with ${n || 'them'}.`,
  lastShort: 'Their only card from you',
  lastWhy: (n, through) => (through
    ? `It is the only card ${n || 'they'} ${n ? 'has' : 'have'} from ${through}. ${through} can stop sharing with them.`
    : `It is the only card ${n || 'they'} ${n ? 'has' : 'have'} from you. Stop sharing on ${poss(n)} card ends the connection instead.`),
  // removing one card from your own page
  removeCard: 'Remove just this card',
  removeShort: (from) => (from ? `You stay connected with ${from}` : 'You stay connected'),
  removeAgain: 'Press again to remove it',
  removed: (name) => `Removed. ${name || 'They'} ${name ? 'is' : 'are'} no longer on your page.`,
  removeDimShort: 'Not this card',
});

/** Why "Remove just this card" cannot act on this card, in words, from the server's code (GET /api/people `remove`). PURE. */
export function removeWhy(code, { name = '', from = '' } = {}) {
  switch (code) {
    case 'last-here': return `This is the only card from ${from || name || 'them'} on your page. Stop sharing ends the connection instead.`;
    case 'screens': return 'This card has a screen of its own. Move or delete that screen first.';
    case 'joined': return `You made this card, and ${name || 'they'} took it over with their own login. Stop sharing gives it back to you.`;
    default: return code ? CLAIM_WORDS.failed : '';
  }
}

/** How the home's list names one holder: their own name, or "Someone" (somebody this login is not connected with). PURE. */
export function holderName(h) { return String(h?.name || '').trim() || CLAIM_WORDS.someone; }

/** The token in a join page's address, or ''. PURE. */
export function inviteFromQuery(search) {
  try { return String(new URLSearchParams(search || '').get(INVITE_PARAM) || '').trim().slice(0, 200); } catch { return ''; }
}

/** The join page's path for a token, and the whole address (what a phone scans). PURE over `loc`. */
export function joinPath(token) { return `${JOIN_PAGE}?${INVITE_PARAM}=${encodeURIComponent(token || '')}`; }
export function joinURL(token, loc = (typeof location !== 'undefined' ? location : null)) { return pageURL(joinPath(token), loc); }

/** "18 October": a date somebody reads, from an ISO time. PURE (the locale is the browser's). */
export function whenText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'it runs out';
  try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }); } catch { return new Date(t).toDateString(); }
}

/** The line under a name on a card, from what the row is to you (GET /api/people `kind`). PURE. */
export function kindSub(p) {
  switch (p && p.kind) {
    case 'joined': return CLAIM_WORDS.joinedSub;
    case 'connected': return CLAIM_WORDS.connectedSub;
    case 'shared': return CLAIM_WORDS.sharedSub(p.from || '');
    default: return CLAIM_WORDS.addedSub;
  }
}

/** The people an invite can share: the ones you look after, you first, never the person being handed over. PURE. */
export function shareable(own, { exclude = '' } = {}) {
  const rows = (Array.isArray(own) ? own : []).filter((p) => p && p.id && p.home !== false && p.id !== exclude);
  return rows.map((p, i) => ({ id: String(p.id), name: String(p.name || '').trim() || 'Someone', you: p.kind === 'you' || (!p.kind && i === 0) }));
}

/** The shares the window sends, from its ticks. PURE. */
export function sharesFrom(picked, msgs) {
  return [...picked].map((id) => ({ person_id: id, messages: msgs.has(id) }));
}

/** A two-press button's state: the first press arms, the second (within `ms`) fires. PURE over `now`. */
export function twoPress(armedAt, now, ms = STOP_CONFIRM_MS) {
  return armedAt && now - armedAt <= ms ? 'fire' : 'arm';
}

/** The calls, for a page that is signed in (`user` is the dev/test override; the real site's cookie goes along). */
export function createClaimsClient({ user = null, fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null), base = '' } = {}) {
  async function call(method, path, body) {
    if (!fetchImpl) return { status: 0, body: null };
    const headers = { ...authHeaders(user) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetchImpl(`${base}${path}`, { method, headers, credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    return { status: r.status, body: j };
  }
  const pid = (id) => encodeURIComponent(id);
  const withDays = (o, days) => (days ? { ...o, days } : o);
  return {
    invites: (personId) => call('GET', `/api/people/${pid(personId)}/invites`),
    invite: (personId, { shares = null, days = null } = {}) =>
      call('POST', `/api/people/${pid(personId)}/invites`, withDays(shares ? { shares } : {}, days)),
    cancel: (personId, inviteId) => call('DELETE', `/api/people/${pid(personId)}/invites/${pid(inviteId)}`),
    connect: ({ shares = null, days = null } = {}) => call('POST', '/api/connect/invites', withDays(shares ? { shares } : {}, days)),
    connectInvites: () => call('GET', '/api/connect/invites'),
    cancelConnect: (inviteId) => call('DELETE', `/api/connect/invites/${pid(inviteId)}`),
    stop: (personId) => call('DELETE', `/api/people/${pid(personId)}/link`),
    setMessages: (personId, on) => call('PUT', `/api/people/${pid(personId)}/messages`, { on: !!on }),
    // `viewer`: a person on this login - the label is theirs alone (2026-10-05); left out, everyone on the login's.
    callName: (personId, name, { viewer = '' } = {}) => call('PUT', `/api/people/${pid(personId)}/call-name`,
      viewer ? { name: String(name || ''), viewer: String(viewer) } : { name: String(name || '') }),
    holders: (personId) => call('GET', `/api/people/${pid(personId)}/holders`),
    unshare: (personId, holderId) => call('DELETE', `/api/people/${pid(personId)}/holders/${pid(holderId)}`),
    removeCard: (personId) => call('DELETE', `/api/people/${pid(personId)}/card`),
    peek: (token) => call('POST', '/api/invites/peek', { token }),
    accept: (token, { messagesBack = true } = {}) => call('POST', '/api/invites/accept', { token, messages_back: !!messagesBack }),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const INVITE_STYLE = `
.cl-box{display:flex;flex-direction:column;gap:12px;max-width:34rem;margin:0 auto;color:var(--text)}
.cl-box p{margin:0}
.cl-lead{color:var(--text-muted)}
.cl-h{font-weight:700;color:var(--text-strong)}
.cl-share{display:flex;flex-direction:column;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.cl-opt{display:flex;align-items:center;gap:10px;min-height:48px;cursor:pointer}
.cl-opt.is-sub{padding-left:2rem;color:var(--text-muted)}
.cl-opt.is-off{opacity:.55;cursor:default}
.cl-opt input{width:1.4rem;height:1.4rem;flex:0 0 auto;accent-color:var(--accent)}
.cl-btn{box-sizing:border-box;min-height:48px;padding:10px 14px;border-radius:12px;border:2px solid var(--border);background:var(--surface);color:var(--text-strong);font:inherit;font-weight:600;cursor:pointer;text-align:left}
.cl-btn.is-go{border-color:var(--accent)}
.cl-btn:focus-visible{outline:4px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.cl-link,.cl-input{box-sizing:border-box;width:100%;min-height:48px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text-strong);font:inherit;font-size:.95rem}
.cl-send{font-weight:700;color:var(--text-strong)}
.cl-qr{width:min(200px,60%)}
.cl-qr svg{display:block;width:100%;height:auto}
.cl-say{min-height:1.4em;color:var(--text)}
.cl-say:empty{display:none}
`;

/**
 * The window that makes a link: who comes with it (a tick per person you look after - just you by default - and,
 * under each, whether they may leave messages for them), Make the link, then the link (Copy) and a code to scan,
 * and Take the link back. Mounted into `host` (Your people's window over the page).
 *   kind     'claim' (hand `person` over) | 'connect' (connect like friends)
 *   person   { id, name } for a claim
 *   people   your rows from GET /api/people (who can be shared)
 *   client   createClaimsClient(...)
 *   loc      where the page is served (the link's address is built from it)
 *   clipboard  { writeText } (a seam for the suites)
 * Returns { ready, destroy, __probe }.
 */
export function mountInviteSheet(host, { kind = 'claim', person = null, people = [], client, loc = (typeof location !== 'undefined' ? location : null),
  clipboard = (typeof navigator !== 'undefined' ? navigator.clipboard : null), onChange = null } = {}) {
  const isClaim = kind !== 'connect';
  const name = String(person?.name || '').trim();
  const options = shareable(people, { exclude: isClaim ? person?.id : '' });
  // GUESS (claims.py DEFAULT_SHARES): just you, ticked; messages ticked under each person that is ticked.
  const picked = new Set(options.filter((o) => o.you).map((o) => o.id));
  const msgs = new Set(options.map((o) => o.id));
  let phase = isClaim ? 'loading' : 'choose';     // loading | choose | made | error
  let waiting = null;             // a live claim invite already waiting ({ id, expires_at })
  let made = null;                // { token, invite }
  let said = '';
  let torn = false;
  const style = host.ownerDocument.createElement('style');
  style.textContent = INVITE_STYLE;
  const box = host.ownerDocument.createElement('div');
  box.className = 'cl-box';
  box.setAttribute('data-cl-invite', isClaim ? (person?.id || '') : 'connect');
  host.append(style, box);

  function sharesHTML() {
    const W = CLAIM_WORDS;
    if (!options.length) return `<p class="cl-lead" data-cl-none>${esc(W.noneToShare)}</p>`;
    return `<p class="cl-h">${esc(W.sharesLead)}</p>${options.map((o) => {
      const on = picked.has(o.id);
      // DIMMED WITH WHY rather than hidden: messages for somebody not shared cannot be allowed, and the box says so.
      return `<div class="cl-share" data-cl-share-row="${esc(o.id)}">
        <label class="cl-opt"><input type="checkbox" data-cl-share="${esc(o.id)}" ${on ? 'checked' : ''}> ${esc(o.you ? W.shareYou(o.name) : o.name)}</label>
        <label class="cl-opt is-sub${on ? '' : ' is-off'}"${on ? '' : ` title="${esc(`Tick ${o.name} first`)}"`}><input type="checkbox" data-cl-msg="${esc(o.id)}" ${on && msgs.has(o.id) ? 'checked' : ''} ${on ? '' : 'disabled'}> ${esc(W.shareMsg(o.you ? 'you' : o.name))}</label></div>`;
    }).join('')}`;
  }

  function render() {
    if (torn) return;
    const W = CLAIM_WORDS;
    let h = `<p class="cl-lead" data-cl-lead>${esc(isClaim ? W.inviteLead(name) : W.connectLead)}</p>`;
    if (phase === 'loading') h += '<p class="cl-lead">Checking…</p>';
    if (phase === 'error') h += `<p class="cl-say">${esc(W.failed)}</p>`;
    if (phase === 'choose') {
      if (waiting) {
        h += `<p data-cl-waiting>${esc(W.waiting(name, whenText(waiting.expires_at)))}</p>
          <button type="button" class="cl-btn" data-cl-act="cancel">${esc(W.takeBack)}</button>`;
      }
      h += `${sharesHTML()}<button type="button" class="cl-btn is-go" data-cl-act="make">${esc(waiting ? W.makeAgain : W.make)}</button>`;
    }
    if (phase === 'made' && made) {
      const url = joinURL(made.token, loc);
      let qr = '';
      try {
        const colours = themeQrColours(box);
        if (colours) qr = qrSVG(url, { level: 'M', quiet: 4, dark: colours.dark, light: colours.light, title: isClaim ? `Scan to open the invitation for ${name}` : 'Scan to open the invitation' });
      } catch (err) { console.error('claim: qr', err); qr = ''; }
      h += `<p class="cl-send" data-cl-send>${esc(isClaim ? W.send(name) : W.sendConnect)}</p>
        <input class="cl-link" readonly data-cl-link value="${esc(url)}" aria-label="The link to send">
        <button type="button" class="cl-btn is-go" data-cl-act="copy">${esc(W.copy)}</button>
        ${qr ? `<p>${esc(W.scan)}</p><div class="cl-qr" data-cl-qr>${qr}</div>` : ''}
        <p data-cl-until>${esc(W.until(whenText(made.invite?.expires_at)))}</p>
        <button type="button" class="cl-btn" data-cl-act="cancel">${esc(W.takeBack)}</button>`;
    }
    h += `<p class="cl-say" role="status" data-cl-say>${esc(said)}</p>`;
    box.innerHTML = h;
  }

  async function load() {
    if (!isClaim) { render(); return; }
    try {
      const r = await client.invites(person.id);
      if (torn) return;
      if (r.status !== 200) { phase = 'error'; render(); return; }
      waiting = (r.body?.invites || [])[0] || null;
      phase = 'choose';
    } catch { phase = 'error'; }
    render();
  }

  async function make() {
    said = '';
    const shares = sharesFrom(options.filter((o) => picked.has(o.id)).map((o) => o.id), msgs);
    try {
      const r = isClaim ? await client.invite(person.id, { shares }) : await client.connect({ shares });
      if (torn) return;
      if (r.status !== 200 || !r.body?.token) { said = r.body?.text || r.body?.detail || CLAIM_WORDS.failed; render(); return; }
      made = { token: r.body.token, invite: r.body.invite };
      waiting = null;
      phase = 'made';
      onChange?.();
    } catch { said = CLAIM_WORDS.failed; }
    render();
  }

  async function cancel() {
    const id = made?.invite?.id || waiting?.id;
    if (!id) return;
    try {
      const r = isClaim ? await client.cancel(person.id, id) : await client.cancelConnect(id);
      if (torn) return;
      said = r.status === 200 ? CLAIM_WORDS.takenBack : CLAIM_WORDS.failed;
      if (r.status === 200) { made = null; waiting = null; phase = 'choose'; onChange?.(); }
    } catch { said = CLAIM_WORDS.failed; }
    render();
  }

  async function copy() {
    const url = made ? joinURL(made.token, loc) : '';
    let ok = false;
    try { if (clipboard?.writeText) { await clipboard.writeText(url); ok = true; } } catch { ok = false; }
    if (!ok) {
      try { const el = box.querySelector('[data-cl-link]'); el?.select?.(); ok = !!host.ownerDocument.execCommand?.('copy'); } catch { ok = false; }
    }
    said = ok ? CLAIM_WORDS.copied : CLAIM_WORDS.copyFailed;
    render();
  }

  function onClick(e) {
    const b = e.target instanceof Element ? e.target.closest('[data-cl-act]') : null;
    if (!b || !box.contains(b)) return;
    const a = b.dataset.clAct;
    if (a === 'make') make();
    else if (a === 'cancel') cancel();
    else if (a === 'copy') copy();
  }
  function onInput(e) {
    const t = e.target;
    if (t?.matches?.('[data-cl-share]')) {
      if (t.checked) picked.add(t.dataset.clShare); else picked.delete(t.dataset.clShare);
      render();
    } else if (t?.matches?.('[data-cl-msg]')) {
      if (t.checked) msgs.add(t.dataset.clMsg); else msgs.delete(t.dataset.clMsg);
    }
  }
  box.addEventListener('click', onClick);
  box.addEventListener('change', onInput);
  render();
  const ready = load();
  return {
    ready,
    destroy() { torn = true; box.removeEventListener('click', onClick); box.removeEventListener('change', onInput); style.remove(); box.remove(); },
    __probe: () => ({ kind: isClaim ? 'claim' : 'connect', phase, waiting, made: made ? { token: made.token, expires_at: made.invite?.expires_at } : null, said,
      options: options.map((o) => ({ ...o })), shares: sharesFrom(options.filter((o) => picked.has(o.id)).map((o) => o.id), msgs) }),
  };
}

/**
 * WHO SEES AN "I CALL THEM" NAME (Mike, 2026-10-05: "an option to set I call them at account vs user levels"). PURE.
 *   viewerId  the person the page is for ('' when the page does not know yet)
 *   alone     true when nobody else uses this login (the two levels would show the same name to the same person)
 *   person    { call_name, viewer_call_name }
 * -> { level: 'everyone' | 'viewer', justWhy: '' | why "Just <name>" cannot be picked }
 * THE STARTING CHOICE, argued: a label already there opens at its own level (the viewer's own if they have one -
 * it is the one they see). A NEW label starts at "Everyone on this login". FOR "Just me": a nickname is personal,
 * and Dad's "Sweetie" showing to Mom by surprise is the worse mistake. AGAINST, and it decides it: until today
 * every label was the whole login's, so that is what people who have used it expect; most labels are the family's
 * shared name ("Grandma", "Mom") that everybody on the login would otherwise set again one by one; and the choice is
 * shown right under the box, before Save. On a login only one person uses, the choice is dimmed with why.
 */
export function callLevels({ viewerId = '', alone = false, person = null } = {}) {
  const justWhy = !viewerId ? CLAIM_WORDS.callJustNobody : alone ? CLAIM_WORDS.callJustAlone : '';
  const level = !justWhy && String(person?.viewer_call_name || '').trim() ? 'viewer' : 'everyone';
  return { level, justWhy };
}

/**
 * "I call them": a text box, who sees it (everyone on this login, or just the person the page is for), Save, and
 * "Use their own name". Mounted into `host`.
 *   person  { id, name, call_name, viewer_call_name, profile_name, home } (a row from GET /api/people?viewer=;
 *           `home`: somebody you look after, whose card's name is yours to change - the words say others still see it)
 *   viewer  { id, name } the person the page is for (`name`: the name on their own card); null: not known yet
 *   alone   nobody else uses this login
 * Returns { destroy, __probe }.
 */
export function mountCallName(host, { person, client, viewer = null, alone = false, onChange = null } = {}) {
  const own = String(person?.profile_name || '').trim();
  const W = CLAIM_WORDS;
  const viewerId = String(viewer?.id || '');
  const viewerName = String(viewer?.name || '').trim();
  const labels = { everyone: String(person?.call_name || '').trim(), viewer: String(person?.viewer_call_name || '').trim() };
  const start = callLevels({ viewerId, alone, person });
  let level = start.level;
  let said = '';
  let torn = false;
  const style = host.ownerDocument.createElement('style');
  style.textContent = INVITE_STYLE;
  const box = host.ownerDocument.createElement('div');
  box.className = 'cl-box';
  box.setAttribute('data-cl-callname', person?.id || '');
  host.append(style, box);
  const group = `cl-level-${esc(person?.id)}`;
  const off = !!start.justWhy;
  box.innerHTML = `<label class="cl-h" for="cl-call-${esc(person?.id)}">${esc(W.callLabel)}</label>
    <input class="cl-input" id="cl-call-${esc(person?.id)}" data-cl-call maxlength="${CALL_NAME_MAX}" value="" placeholder="">
    <fieldset class="cl-share" data-cl-levels><legend class="cl-h">${esc(W.callLevel)}</legend>
      <label class="cl-opt"><input type="radio" name="${group}" value="everyone" data-cl-level>${esc(W.callEveryone)}</label>
      <label class="cl-opt${off ? ' is-off' : ''}"${off ? ` title="${esc(start.justWhy)}"` : ''}><input type="radio" name="${group}" value="viewer" data-cl-level${off ? ` disabled aria-describedby="cl-just-why-${esc(person?.id)}"` : ''}>${esc(W.callJust(viewerName))}</label>
      ${off ? `<p class="cl-lead" id="cl-just-why-${esc(person?.id)}" data-cl-just-why>${esc(start.justWhy)}</p>` : ''}
    </fieldset>
    <p class="cl-lead" data-cl-call-how></p>
    <button type="button" class="cl-btn is-go" data-cl-act="save">${esc(W.callSave)}</button>
    <button type="button" class="cl-btn" data-cl-act="clear"></button>
    <p class="cl-lead" data-cl-both></p>
    <p class="cl-say" role="status" data-cl-say></p>`;
  const input = box.querySelector('[data-cl-call]');
  const $ = (s) => box.querySelector(s);
  const say = (t) => { said = t; const el = $('[data-cl-say]'); if (el) el.textContent = t; };
  // What the box, its hint, the words under it and the clear button say, for the level picked.
  function paint({ value = true } = {}) {
    for (const r of box.querySelectorAll('[data-cl-level]')) r.checked = r.value === level;
    const just = level === 'viewer';
    if (value) input.value = labels[level] || '';
    input.placeholder = just ? (labels.everyone || own) : own;
    const how = off && start.justWhy === W.callJustAlone
      ? (person?.home ? W.callHowMine(own) : W.callHow(own))
      : just ? W.callHowJust(viewerName, own, !!person?.home) : W.callHowEveryone(own, !!person?.home);
    $('[data-cl-call-how]').textContent = how;
    $('[data-cl-act="clear"]').textContent = just && labels.everyone ? W.callClearTo(labels.everyone) : W.callClear(own);
    // Both levels set: say both, so nobody wonders why the card shows the other one.
    $('[data-cl-both]').textContent = labels.everyone && labels.viewer ? W.callBoth(labels.everyone, viewerName, labels.viewer) : '';
  }
  async function save(name) {
    const at = level;
    try {
      const r = await client.callName(person.id, name, at === 'viewer' ? { viewer: viewerId } : {});
      if (torn) return;
      if (r.status === 200) {
        labels.everyone = String(r.body?.call_name || '').trim();
        if (at === 'viewer') labels.viewer = String(r.body?.viewer_call_name || '').trim();
        paint();
        say(W.callSaved);
        onChange?.(r.body);
      } else say(r.body?.detail || W.failed);
    } catch { say(W.failed); }
  }
  function onClick(e) {
    const b = e.target instanceof Element ? e.target.closest('[data-cl-act]') : null;
    if (!b || !box.contains(b)) return;
    if (b.dataset.clAct === 'save') save(String(input.value || '').trim().slice(0, CALL_NAME_MAX));
    if (b.dataset.clAct === 'clear') save('');
  }
  function onChangeLevel(e) {
    const t = e.target;
    if (!t?.matches?.('[data-cl-level]') || t.disabled) return;
    level = t.value === 'viewer' && !off ? 'viewer' : 'everyone';
    say('');
    paint();
  }
  box.addEventListener('click', onClick);
  box.addEventListener('change', onChangeLevel);
  paint();
  return {
    destroy() { torn = true; box.removeEventListener('click', onClick); box.removeEventListener('change', onChangeLevel); style.remove(); box.remove(); },
    __probe: () => ({ value: input.value, said, level, justWhy: start.justWhy, labels: { ...labels } }),
  };
}

/**
 * "Shared with": the other logins holding a profile you look after, each with "Stop sharing with <name>" (two
 * presses, like Stop sharing; it takes that one card off their page and keeps the connection). Dimmed with why when it
 * is the only card they have from you. Readable only by whoever looks after the profile (the server checks).
 *   person  { id, name, you } - `you`: your own card ("Your card is shared with")
 * Returns { ready, destroy, __probe }.
 */
export function mountHolders(host, { person, client, onChange = null, now = () => Date.now() } = {}) {
  const W = CLAIM_WORDS;
  const name = person?.you ? '' : String(person?.name || '').trim();
  let list = null;                 // null: reading; [] nobody
  let phase = 'loading';           // loading | ready | error
  let armed = null;                // { id, at }
  let armTimer = null;
  let said = '';
  let torn = false;
  const style = host.ownerDocument.createElement('style');
  style.textContent = INVITE_STYLE;
  const box = host.ownerDocument.createElement('div');
  box.className = 'cl-box';
  box.setAttribute('data-cl-holders', person?.id || '');
  host.append(style, box);

  function render() {
    if (torn) return;
    let h = `<p class="cl-lead" data-cl-lead>${esc(W.holdersLead(name))}</p>`;
    if (phase === 'loading') h += '<p class="cl-lead">Checking…</p>';
    if (phase === 'error') h += `<p class="cl-say">${esc(said || W.failed)}</p>`;
    if (phase === 'ready' && !list.length) h += `<p data-cl-holders-none>${esc(W.holdersNone(name))}</p>`;
    if (phase === 'ready') {
      for (const x of list) {
        const n = holderName(x);
        const again = armed && armed.id === x.id && twoPress(armed.at, now()) === 'fire';
        const dim = !!x.stop;
        const why = dim ? W.lastWhy(x.name || '', x.through || '') : '';
        // DIMMED WITH WHY rather than hidden: the person can see they have it, and what to do instead.
        h += `<div class="cl-share" data-cl-holder="${esc(x.id)}">
          <p class="cl-h" data-cl-holder-name>${esc(n)}</p>
          <p class="cl-lead" data-cl-holder-sub>${esc(x.through ? W.through(x.through) : x.joined ? W.holderJoined(name) : W.holderHas)}</p>
          <button type="button" class="cl-btn" data-cl-act="unshare" data-cl-id="${esc(x.id)}" ${dim ? `aria-disabled="true" title="${esc(why)}" data-cl-why="${esc(why)}"` : ''}>${esc(again ? W.stopWithAgain : W.stopWith(x.name ? n : ''))}<br><small>${esc(dim ? W.lastShort : x.joined ? W.stopWithJoinedShort : W.stopWithShort)}</small></button>
        </div>`;
      }
    }
    h += `<p class="cl-say" role="status" data-cl-say>${esc(phase === 'error' ? '' : said)}</p>`;
    box.innerHTML = h;
  }

  async function load() {
    try {
      const r = await client.holders(person.id);
      if (torn) return;
      if (r.status !== 200) { phase = 'error'; said = r.body?.text || r.body?.detail || W.failed; render(); return; }
      list = Array.isArray(r.body?.holders) ? r.body.holders : [];
      phase = 'ready';
    } catch { phase = 'error'; said = W.failed; }
    render();
  }

  async function unshare(id, el) {
    const x = (list || []).find((y) => y.id === id);
    if (!x) return;
    if (el?.getAttribute('aria-disabled') === 'true') { said = el.dataset.clWhy || ''; render(); return; }
    if (twoPress(armed && armed.id === id ? armed.at : 0, now()) === 'arm') {
      armed = { id, at: now() };
      said = '';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { if (armed && armed.id === id) { armed = null; render(); } }, STOP_CONFIRM_MS + 50);
      render();
      return;
    }
    armed = null; clearTimeout(armTimer);
    try {
      const r = await client.unshare(person.id, id);
      if (torn) return;
      if (r.status === 200) {
        said = W.stoppedWith(x.name ? holderName(x) : '');
        list = list.filter((y) => y.id !== id);
        onChange?.();
        await load();
        if (!torn) { said = W.stoppedWith(x.name ? holderName(x) : ''); render(); }
        return;
      }
      said = r.body?.text || r.body?.detail || W.failed;
    } catch { said = W.failed; }
    render();
  }

  function onClick(e) {
    const b = e.target instanceof Element ? e.target.closest('[data-cl-act]') : null;
    if (!b || !box.contains(b)) return;
    if (b.dataset.clAct === 'unshare') unshare(b.dataset.clId, b);
  }
  box.addEventListener('click', onClick);
  render();
  const ready = load();
  return {
    ready,
    destroy() { torn = true; clearTimeout(armTimer); box.removeEventListener('click', onClick); style.remove(); box.remove(); },
    __probe: () => ({ phase, said, armed: armed ? armed.id : null, holders: (list || []).map((x) => ({ ...x })) }),
  };
}
