// join_page.js — THE PAGE AN INVITATION LINK OPENS (join.html?invite=...). 2026-10-04.
//
// Somebody made a person on their own people for you ("Mom"), and sent you a link (claim.js, Your people's
// "Invite them to use this"). This page says who sent it and which person, asks you to sign in with YOUR OWN
// login, and then "Make this mine". The server decides everything (web/server/claims.py): the link works once,
// for 14 days; it cannot be used by the login that made it, or by a screen in a room; a person already taken
// over cannot be taken again.
//
// THE THREE PEOPLE WHO ARRIVE HERE (the same three pair.js serves):
//   1. opened the link, signed in already   -> who sent it, which person, one button.
//   2. opened the link, NOT signed in       -> sign in, and come STRAIGHT BACK with the link intact (the
//                                              token rides in `next`, and is stashed first - pair.js's reason).
//   3. a link that no longer works          -> why, in words, and what to do (ask for a new one).
//
// NOTHING IS ACCEPTED WITHOUT THE PRESS. Opening the page only reads who sent it.

import { createClaimsClient, inviteFromQuery, claimWordProblems, JOIN_PAGE } from './claim.js';

const STASH = 'nimrod:joinInvite';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Where a finished claim goes: the landing (Your people), where the person now shows up.
export const AFTER_JOIN = '/';

export const JOIN_WORDS = Object.freeze({
  loading: 'Checking the link…',
  noLink: 'This link does not work. Ask whoever sent it for a new one.',
  title: (from, name) => `${from || 'Someone you know'} set up “${name}” for you`,
  body: (from, name) => `When you press Make this mine, “${name}” becomes yours, on your own login. `
    + `Everything ${from || 'they'} set up stays as it is.`,
  alsoLead: 'You will be able to:',
  pic: (name) => `change ${name}’s picture`,
  see: (from) => `see ${from ? `${from}’s` : 'their'} other people on your page`,
  sender: (from) => `see ${from || 'whoever sent this'} on your page`,
  msg: (from) => `leave messages for ${from ? `${from}’s` : 'their'} people`,
  signInLead: 'Sign in first, with your own login. You come straight back here.',
  signIn: 'Sign in',
  other: 'Not you? Sign in with a different login',
  make: 'Make this mine',
  working: 'Making it yours…',
  doneTitle: (name) => `Done. “${name}” is yours now.`,
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
  const W = JOIN_WORDS;

  root.innerHTML = '<main class="jp" data-jp></main>';
  const main = root.querySelector('[data-jp]');

  function render() {
    main.dataset.phase = phase;
    let h = '';
    if (phase === 'loading') h = `<p class="jp-note">${esc(W.loading)}</p>`;
    if (phase === 'refused') h = `<h1 class="jp-title">This link cannot be used</h1><p class="jp-note" data-jp-why>${esc(text)}</p>`;
    if ((phase === 'ready' || phase === 'signed-out' || phase === 'working') && info) {
      const also = [W.pic(info.name), info.see_people ? W.see(info.from) : W.sender(info.from)];
      if (info.messages) also.push(W.msg(info.from));
      h = `<h1 class="jp-title" data-jp-title>${esc(W.title(info.from, info.name))}</h1>
        <p class="jp-body">${esc(W.body(info.from, info.name))}</p>
        <p class="jp-note">${esc(W.alsoLead)}</p><ul class="jp-list" data-jp-also>${also.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
      if (phase === 'signed-out') {
        h += `<p class="jp-note">${esc(W.signInLead)}</p><button type="button" class="jp-btn jp-go" data-jp-act="signin">${esc(W.signIn)}</button>`;
      } else if (phase === 'working') {
        h += `<p class="jp-note" role="status">${esc(W.working)}</p>`;
      } else {
        h += `<button type="button" class="jp-btn jp-go" data-jp-act="make">${esc(W.make)}</button>
          <a class="jp-other" href="${esc(`${base}/auth/login?switch=1&next=${encodeURIComponent(backHere(token))}`)}" data-jp-other>${esc(W.other)}</a>`;
      }
      if (text) h += `<p class="jp-note" role="status" data-jp-why>${esc(text)}</p>`;
    }
    if (phase === 'done' && done) {
      h = `<h1 class="jp-title" data-jp-done>${esc(W.doneTitle(done.name))}</h1><p class="jp-body">${esc(W.doneBody(done.from))}</p>
        <a class="jp-btn jp-go" href="${esc(AFTER_JOIN)}" data-jp-go>${esc(W.go)}</a>`;
    }
    main.innerHTML = h;
  }

  async function peek() {
    try {
      const r = await client.peek(token);
      const b = r.body || {};
      if (r.status !== 200 || b.state !== 'live') { phase = 'refused'; text = b.text || W.noLink; render(); return; }
      info = { name: b.name || 'this person', from: b.from || '', see_people: !!b.see_people, messages: !!b.messages };
      if (b.screen) { phase = 'refused'; text = 'Open this on your own phone or computer, not on a screen in a room.'; }
      else if (b.is_inviter) { phase = 'refused'; text = 'This came from your own login, so it is already yours. Send it to the person it is for.'; }
      else if (b.claimed) { phase = 'refused'; text = 'Somebody has already made this theirs.'; }
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
      const r = await client.accept(token);
      if (r.status === 200 && r.body?.ok) {
        write(STASH, '');
        done = { name: r.body.name || info?.name || '', from: r.body.from || info?.from || '' };
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

  render();
  const ready = token ? peek() : Promise.resolve();
  return {
    ready,
    __probe: () => ({ phase, info, text, done, token, words: main.textContent, problems: claimWordProblems(main.textContent) }),
  };
}
