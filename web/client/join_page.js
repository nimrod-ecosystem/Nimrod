// join_page.js — THE PAGE AN INVITATION LINK OPENS (join.html?invite=...). 2026-10-04.
//
// Two kinds of link land here (claim.js makes both, the server decides everything - web/server/claims.py):
//   CONNECT   "Connect with someone": whoever sent it wants to be on each other's page, like friends.
//   CLAIM     "Invite them to use this": somebody set up a person for you ("Mom") and hands it over - it becomes
//             your own profile, on your own login, and you can change the name, the picture and the page.
// Either can bring other people with it (the ones the sender ticked); the page names them. It asks you to sign in
// with YOUR OWN login, lets you say whether the sender may leave you messages, and then one press: Connect, or
// Make this mine. The link works once, for 14 days; not from the login that made it, and not from a screen.
//
// THE THREE PEOPLE WHO ARRIVE HERE (the same three pair.js serves):
//   1. opened the link, signed in already   -> who sent it, what it does, one button.
//   2. opened the link, NOT signed in       -> sign in, and come STRAIGHT BACK with the link intact (the
//                                              token rides in `next`, and is stashed first - pair.js's reason).
//   3. a link that no longer works          -> why, in words, and what to do (ask for a new one).
//
// NOTHING IS ACCEPTED WITHOUT THE PRESS. Opening the page only reads who sent it.

import { createClaimsClient, inviteFromQuery, claimWordProblems, JOIN_PAGE } from './claim.js';

const STASH = 'nimrod:joinInvite';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const poss = (n) => (n ? `${n}’s` : 'their');

// Where a finished link goes: the landing (Your people), where the people now show up.
export const AFTER_JOIN = '/';

export const JOIN_WORDS = Object.freeze({
  loading: 'Checking the link…',
  noLink: 'This link does not work. Ask whoever sent it for a new one.',
  title: (from, name) => `${from || 'Someone you know'} set up “${name}” for you`,
  titleConnect: (from) => `${from || 'Someone you know'} wants to connect with you`,
  body: (from, name) => `When you press Make this mine, “${name}” becomes yours, on your own login: you can change `
    + `the name, the picture and the page. Everything ${from || 'they'} set up stays as it is, and ${from || 'they'} `
    + 'can still call you what they call you.',
  bodyConnect: (from) => `When you press Connect, you and ${from || 'they'} are on each other’s page.`,
  alsoLead: 'On your page you will see:',
  person: (name, msg) => (msg ? `${name}, and you can leave ${name} messages` : name),
  back: (from) => `Let ${from || 'them'} leave messages for you`,
  signInLead: 'Sign in first, with your own login. You come straight back here.',
  signIn: 'Sign in',
  other: 'Not you? Sign in with a different login',
  make: 'Make this mine',
  connect: 'Connect',
  working: 'One moment…',
  doneTitle: (name) => `Done. “${name}” is yours now.`,
  doneTitleConnect: (from) => `Done. You and ${from || 'they'} are connected.`,
  doneBody: (from) => `${from || 'They'} can see you joined. Either of you can stop sharing at any time.`,
  go: 'Go to your people',
  failed: 'That did not work just now. Try again in a little while.',
});

/** Where the sign-in comes back to: this page, with the link. An open-redirect check (pair.js safeNext). PURE. */
export function backHere(token) {
  const p = `${JOIN_PAGE}?invite=${encodeURIComponent(token || '')}`;
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

export function mountJoinPage(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  loc = (typeof location !== 'undefined' ? location : null),
  store = (typeof sessionStorage !== 'undefined' ? sessionStorage : null),
  user = null,                         // the dev/test login override (auth.js); null on the real site
  base = '',
} = {}) {
  if (!root) throw new Error('mountJoinPage: a root element is required');
  const read = (k) => { try { return store?.getItem(k) || ''; } catch { return ''; } };
  const write = (k, v) => { try { if (v) store?.setItem(k, v); else store?.removeItem(k); } catch { /* private mode */ } };
  const client = createClaimsClient({ user, fetchImpl, base });
  // The address wins over the stash: a second link opened while an old one is stashed must be the one used.
  const token = inviteFromQuery(search) || read(STASH);
  let phase = token ? 'loading' : 'refused';   // loading | ready | signed-out | working | done | refused
  let info = null;
  let text = token ? '' : JOIN_WORDS.noLink;
  let done = null;
  // GUESS (claims.py MESSAGES_BACK): ticked. Connecting "like friends" is two-way; untick to only receive.
  let messagesBack = true;
  const W = JOIN_WORDS;

  root.innerHTML = '<main class="jp" data-jp></main>';
  const main = root.querySelector('[data-jp]');

  function render() {
    main.dataset.phase = phase;
    let h = '';
    if (phase === 'loading') h = `<p class="jp-note">${esc(W.loading)}</p>`;
    if (phase === 'refused') h = `<h1 class="jp-title">This link cannot be used</h1><p class="jp-note" data-jp-why>${esc(text)}</p>`;
    if ((phase === 'ready' || phase === 'signed-out' || phase === 'working') && info) {
      const connect = info.kind === 'connect';
      const also = info.shares.map((s) => W.person(s.name, s.messages));
      h = `<h1 class="jp-title" data-jp-title>${esc(connect ? W.titleConnect(info.from) : W.title(info.from, info.name))}</h1>
        <p class="jp-body">${esc(connect ? W.bodyConnect(info.from) : W.body(info.from, info.name))}</p>
        ${also.length ? `<p class="jp-note">${esc(W.alsoLead)}</p><ul class="jp-list" data-jp-also>${also.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`;
      if (phase === 'signed-out') {
        h += `<p class="jp-note">${esc(W.signInLead)}</p><button type="button" class="jp-btn jp-go" data-jp-act="signin">${esc(W.signIn)}</button>`;
      } else if (phase === 'working') {
        h += `<p class="jp-note" role="status">${esc(W.working)}</p>`;
      } else {
        h += `<label class="jp-opt"><input type="checkbox" data-jp-back ${messagesBack ? 'checked' : ''}> ${esc(W.back(info.from))}</label>
          <button type="button" class="jp-btn jp-go" data-jp-act="make">${esc(connect ? W.connect : W.make)}</button>
          <a class="jp-other" href="${esc(`${base}/auth/login?switch=1&next=${encodeURIComponent(backHere(token))}`)}" data-jp-other>${esc(W.other)}</a>`;
      }
      if (text) h += `<p class="jp-note" role="status" data-jp-why>${esc(text)}</p>`;
    }
    if (phase === 'done' && done) {
      h = `<h1 class="jp-title" data-jp-done>${esc(done.kind === 'connect' ? W.doneTitleConnect(done.from) : W.doneTitle(done.name))}</h1>
        <p class="jp-body">${esc(W.doneBody(done.from))}</p>
        <a class="jp-btn jp-go" href="${esc(AFTER_JOIN)}" data-jp-go>${esc(W.go)}</a>`;
    }
    main.innerHTML = h;
  }

  async function peek() {
    try {
      const r = await client.peek(token);
      const b = r.body || {};
      if (r.status !== 200 || b.state !== 'live') { phase = 'refused'; text = b.text || W.noLink; render(); return; }
      info = { kind: b.kind === 'connect' ? 'connect' : 'claim', name: b.name || 'this person', from: b.from || '',
        shares: (Array.isArray(b.shares) ? b.shares : []).filter((s) => s && s.name).map((s) => ({ name: String(s.name), messages: !!s.messages })) };
      if (b.screen) { phase = 'refused'; text = 'Open this on your own phone or computer, not on a screen in a room.'; }
      else if (b.is_inviter) { phase = 'refused'; text = 'This came from your own login. Send it to the person it is for.'; }
      else if (b.claimed) { phase = 'refused'; text = 'Somebody already uses this with their own login.'; }
      else phase = b.signed_in ? 'ready' : 'signed-out';
    } catch { phase = 'refused'; text = W.failed; }
    render();
  }

  function signIn() {
    write(STASH, token);       // stash first, THEN leave (pair.js: a dropped `next` must not lose the link)
    if (loc) loc.href = `${base}/auth/login?next=${encodeURIComponent(backHere(token))}`;
  }

  async function make() {
    phase = 'working'; text = ''; render();
    try {
      const r = await client.accept(token, { messagesBack });
      if (r.status === 200 && r.body?.ok) {
        write(STASH, '');
        done = { kind: r.body.kind || info?.kind, name: r.body.name || info?.name || '', from: r.body.from || info?.from || '' };
        phase = 'done';
      } else if (r.status === 401) {
        phase = 'signed-out';
      } else {
        phase = 'refused'; text = r.body?.text || W.failed;
      }
    } catch { phase = 'ready'; text = W.failed; }
    render();
  }

  main.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-jp-act]') : null;
    if (!b) return;
    if (b.dataset.jpAct === 'make') make();
    if (b.dataset.jpAct === 'signin') signIn();
  });
  main.addEventListener('change', (e) => {
    if (e.target?.matches?.('[data-jp-back]')) messagesBack = !!e.target.checked;
  });

  render();
  const ready = token ? peek() : Promise.resolve();
  return {
    ready,
    __probe: () => ({ phase, info, text, done, token, messagesBack, words: main.textContent, problems: claimWordProblems(main.textContent) }),
  };
}
