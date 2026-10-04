// claim.js — "INVITE SOMEBODY TO TAKE OVER A PROFILE YOU MADE", the client side. 2026-10-04.
//
// Mike: *"I was thinking about making users for her parents and sister on my account and hoping they could
// link their own accounts to it, so most of the work could already be done for them."* The rules are the
// server's (web/server/claims.py, argued there: the person STAYS on your account and their login gets a claim
// on it; the link works 14 days, once; their picture becomes theirs). This file is the words, the calls, and
// the window that makes a link (opened over Your people, modules/people.js). join.html / join_page.js is the
// other end: the page the link opens.
//
// *** PLAIN WORDS. *** The people who read these are not building anything: no "account", "token" or "grant",
// and none of Your people's banned words either (people_page.js BANNED_WORDS). `claimWordProblems` is the
// check, run by the suite over everything this file and the join page can say.
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

// Words the page may not use, beyond Your people's own (module, dashboard, panel, grant).
export const CLAIM_BANNED = Object.freeze(['account', 'token']);
/** The banned words found in `text`. PURE. */
export function claimWordProblems(text) {
  const s = String(text == null ? '' : text);
  const out = plainWordProblems(s);
  for (const w of CLAIM_BANNED) if (new RegExp(`\\b${w}s?\\b`, 'i').test(s)) out.push(w);
  return out;
}

// Every sentence, in one place, so the suite can hold all of them to the rule above.
export const CLAIM_WORDS = Object.freeze({
  invite: 'Invite them to use this',
  inviteShort: 'With their own login',
  inviteTitle: (name) => `Invite ${name || 'them'}`,
  inviteLead: (name) => `${name || 'They'} can use this with their own login: their own picture, your people on their page, `
    + 'and messages between you. Everything you set up stays as it is.',
  seePeople: (name) => `Let ${name || 'them'} see your other people`,
  messages: (name) => `Let ${name || 'them'} leave messages for your people`,
  make: 'Make the link',
  makeAgain: 'Make a new link (the old one stops working)',
  send: (name) => `Send this to ${name || 'them'}. When ${name || 'they'} open${name ? 's' : ''} it and sign${name ? 's' : ''} in, this becomes ${name ? `${name}’s` : 'theirs'}.`,
  copy: 'Copy the link',
  copied: 'Copied. Paste it into a message or an email.',
  copyFailed: 'Could not copy here. Press and hold the link to copy it.',
  scan: 'Or let them scan this with their phone’s camera:',
  until: (when) => `It works once, until ${when}.`,
  waiting: (name, when) => `A link for ${name || 'them'} is waiting. It works until ${when}.`,
  takeBack: 'Take the link back',
  takenBack: 'Taken back. That link no longer works.',
  joined: 'joined',
  joinedSub: 'On your people · uses this with their own login',
  stop: 'Stop sharing',
  stopShort: 'They keep nothing; it stays yours',
  stopAgain: 'Press again to stop sharing',
  stopped: (name) => `Stopped. ${name || 'They'} no longer use${name ? 's' : ''} this, and it stays on your people.`,
  msgOn: 'Messages from them: on',
  msgOff: 'Messages from them: off',
  msgShort: 'Press to change',
  youAre: (name, from) => `You are ${name} on ${from ? `${from}’s` : 'their'} people.`,
  youAreSub: 'Your own login, with the picture and people they set up.',
  editThere: 'Edit that picture',
  stopMine: 'Stop sharing',
  stopMineShort: 'It goes back to whoever set it up',
  linkedSub: (from) => `${from ? `${from}’s` : 'Their'} people`,
  linkedJoinedSub: (from) => `${from ? `${from}’s` : 'Their'} people · joined`,
  failed: 'That did not work just now. Try again in a little while.',
});

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

/**
 * The people a login sees because it took over somebody on another login's people (GET /api/claims `mine`). PURE.
 * -> [{ id, name, via: 'linked', joined, from, sender }], each once, never the person they ARE ('you').
 */
export function linkedPeopleFrom(mine) {
  const out = [];
  for (const c of Array.isArray(mine) ? mine : []) {
    for (const p of Array.isArray(c?.people) ? c.people : []) {
      if (!p || !p.id || p.you || out.some((x) => x.id === p.id)) continue;
      out.push({ id: String(p.id), name: String(p.name || '').trim() || 'Someone', via: 'linked', joined: !!p.joined,
        from: String(c.from || ''), sender: !!p.sender });
    }
  }
  return out;
}

/** The claim on one of YOUR people (GET /api/claims `given`), or null. PURE. */
export function givenFor(personId, given) {
  return (Array.isArray(given) ? given : []).find((g) => g && g.person_id === personId) || null;
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
  return {
    list: () => call('GET', '/api/claims'),
    invites: (personId) => call('GET', `/api/people/${pid(personId)}/invites`),
    invite: (personId, { seePeople = true, messages = true, days = null } = {}) =>
      call('POST', `/api/people/${pid(personId)}/invites`, { see_people: !!seePeople, messages: !!messages, ...(days ? { days } : {}) }),
    cancel: (personId, inviteId) => call('DELETE', `/api/people/${pid(personId)}/invites/${pid(inviteId)}`),
    stop: (personId) => call('DELETE', `/api/claims/${pid(personId)}`),
    setMessages: (personId, on) => call('PUT', `/api/claims/${pid(personId)}/messages`, { on: !!on }),
    peek: (token) => call('POST', '/api/invites/peek', { token }),
    accept: (token) => call('POST', '/api/invites/accept', { token }),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const INVITE_STYLE = `
.cl-box{display:flex;flex-direction:column;gap:12px;max-width:34rem;margin:0 auto;color:var(--text)}
.cl-box p{margin:0}
.cl-lead{color:var(--text-muted)}
.cl-opt{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);cursor:pointer}
.cl-opt input{width:1.4rem;height:1.4rem;flex:0 0 auto;accent-color:var(--accent)}
.cl-btn{box-sizing:border-box;min-height:48px;padding:10px 14px;border-radius:12px;border:2px solid var(--border);background:var(--surface);color:var(--text-strong);font:inherit;font-weight:600;cursor:pointer;text-align:left}
.cl-btn.is-go{border-color:var(--accent)}
.cl-btn:focus-visible{outline:4px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.cl-link{box-sizing:border-box;width:100%;min-height:48px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text-strong);font:inherit;font-size:.95rem}
.cl-send{font-weight:700;color:var(--text-strong)}
.cl-qr{width:min(200px,60%)}
.cl-qr svg{display:block;width:100%;height:auto}
.cl-say{min-height:1.4em;color:var(--text)}
.cl-say:empty{display:none}
`;

/**
 * The window that makes a link for one of your people: two choices, Make the link, then the link (Copy) and a
 * code to scan, and Take the link back. Mounted into `host` (Your people's window over the page).
 *   person   { id, name }
 *   client   createClaimsClient(...)
 *   loc      where the page is served (the link's address is built from it)
 *   clipboard  { writeText } (a seam for the suites)
 * Returns { ready, destroy, __probe }.
 */
export function mountInviteSheet(host, { person, client, loc = (typeof location !== 'undefined' ? location : null),
  clipboard = (typeof navigator !== 'undefined' ? navigator.clipboard : null), onChange = null } = {}) {
  const name = String(person?.name || '').trim();
  let phase = 'loading';          // loading | choose | made | error
  let waiting = null;             // a live invite already waiting ({ id, expires_at })
  let made = null;                // { token, invite }
  let said = '';
  let seePeople = true, messages = true;
  let torn = false;
  const style = host.ownerDocument.createElement('style');
  style.textContent = INVITE_STYLE;
  const box = host.ownerDocument.createElement('div');
  box.className = 'cl-box';
  box.setAttribute('data-cl-invite', person?.id || '');
  host.append(style, box);

  function render() {
    if (torn) return;
    const W = CLAIM_WORDS;
    let h = `<p class="cl-lead" data-cl-lead>${esc(W.inviteLead(name))}</p>`;
    if (phase === 'loading') h += '<p class="cl-lead">Checking…</p>';
    if (phase === 'error') h += `<p class="cl-say">${esc(W.failed)}</p>`;
    if (phase === 'choose') {
      if (waiting) {
        h += `<p data-cl-waiting>${esc(W.waiting(name, whenText(waiting.expires_at)))}</p>
          <button type="button" class="cl-btn" data-cl-act="cancel">${esc(W.takeBack)}</button>`;
      }
      h += `<label class="cl-opt"><input type="checkbox" data-cl-see ${seePeople ? 'checked' : ''}> ${esc(W.seePeople(name))}</label>
        <label class="cl-opt"><input type="checkbox" data-cl-msg ${messages ? 'checked' : ''}> ${esc(W.messages(name))}</label>
        <button type="button" class="cl-btn is-go" data-cl-act="make">${esc(waiting ? W.makeAgain : W.make)}</button>`;
    }
    if (phase === 'made' && made) {
      const url = joinURL(made.token, loc);
      let qr = '';
      try {
        const colours = themeQrColours(box);
        if (colours) qr = qrSVG(url, { level: 'M', quiet: 4, dark: colours.dark, light: colours.light, title: `Scan to open the invitation for ${name}` });
      } catch (err) { console.error('claim: qr', err); qr = ''; }
      h += `<p class="cl-send" data-cl-send>${esc(W.send(name))}</p>
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
    try {
      const r = await client.invite(person.id, { seePeople, messages });
      if (torn) return;
      if (r.status !== 200 || !r.body?.token) { said = r.body?.text || CLAIM_WORDS.failed; render(); return; }
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
      const r = await client.cancel(person.id, id);
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
    if (e.target?.matches?.('[data-cl-see]')) seePeople = !!e.target.checked;
    if (e.target?.matches?.('[data-cl-msg]')) messages = !!e.target.checked;
  }
  box.addEventListener('click', onClick);
  box.addEventListener('change', onInput);
  render();
  const ready = load();
  return {
    ready,
    destroy() { torn = true; box.removeEventListener('click', onClick); box.removeEventListener('change', onInput); style.remove(); box.remove(); },
    __probe: () => ({ phase, waiting, made: made ? { token: made.token, expires_at: made.invite?.expires_at } : null, said, seePeople, messages }),
  };
}
