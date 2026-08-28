// pair.js — THE OTHER END OF THE QR CODE.
//
// Somebody has just pointed a phone at a screen in a room and landed here. This page's only
// job is to turn that into a claimed screen with as close to zero typing as possible.
//
// THE THREE PEOPLE WHO ARRIVE HERE, and the page has to serve all three:
//
//   1. scanned the QR, signed in already   -> one button, code prefilled. The common case.
//   2. scanned the QR, NOT signed in       -> sign in, then come STRAIGHT BACK with the
//                                             code intact. Losing it here is the failure
//                                             that sends people back to the room to squint
//                                             at the screen again.
//   3. typed the address by hand           -> an empty box and the code from the screen.
//
// *** WHY THE CODE SURVIVES A SIGN-IN, and it is the only subtle thing here. ***
// The OAuth round trip leaves this page entirely and comes back through a callback that
// knows nothing about it. So the code is put in sessionStorage BEFORE leaving and read back
// on return, and `/auth/login` is asked to send us back here rather than to the home page.
// Belt and braces on purpose: if the `next` hop is ever lost, the stored code still means a
// person who ends up on the home page can come back here and find it waiting.
//
// WHAT THIS PAGE DOES NOT DO: it never touches the device key. The key is minted for the
// SCREEN and handed to the screen on its next poll; this page only says "yes, that screen
// is mine". A phone that could collect the key would be a phone that could impersonate the
// bedside unit.

import { authHeaders } from './auth.js';

const STASH = 'nimrod:pairCode';

// Six characters, upper case, no spaces or dashes however somebody typed them. The screen
// prints the code grouped ("9K4 2QX") and people copy the space along with it.
export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function codeFromQuery(search) {
  const q = new URLSearchParams(search || '');
  return normalizeCode(q.get('c') || q.get('code') || '');
}

// WHERE TO COME BACK TO after signing in. An open-redirect check, not paranoia for its own
// sake: `next` ends up in a redirect, and a value like `//evil.example` is a protocol-
// relative URL that would send a signed-in person off this site entirely.
export function safeNext(path) {
  const p = String(path || '');
  return (p.startsWith('/') && !p.startsWith('//')) ? p : '/';
}

export function claimMessage(state, { code = '', label = '', error = '' } = {}) {
  if (state === 'signed-out') return {
    title: 'Sign in to add this screen',
    body: 'The screen is waiting. Signing in is what proves it should belong to you.',
  };
  if (state === 'ready') return {
    title: 'Add this screen?',
    body: code
      ? 'This is the code showing on the screen. Check it matches, then add it.'
      : 'Type the six characters showing on the screen.',
  };
  if (state === 'working') return { title: 'Adding it…', body: '' };
  if (state === 'done') return {
    title: 'Done',
    // The person is standing next to the screen. Tell them to look at it — the screen
    // itself is the confirmation, and it is more convincing than this page is.
    body: `${label || 'The screen'} is yours. Look up — it should be starting now. `
      + 'It will come back on its own after a restart.',
  };
  // Each failure names what to DO, because "error" on a phone in a corridor is useless.
  const known = {
    unknown: 'No screen is showing that code. Check the characters, or wait for the screen '
      + 'to show a new one.',
    expired: 'That code has expired. The screen shows a new one every few minutes — read '
      + 'the current one off it and try again.',
    claimed: 'That code has already been used. If the screen is still asking to be set up, '
      + 'wait for it to show a new code.',
  };
  return { title: 'Not added', body: known[error] || error || 'Something went wrong.' };
}

export function mountPairClaim(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
  loc = (typeof location !== 'undefined' ? location : null),
  store = (typeof sessionStorage !== 'undefined' ? sessionStorage : null),
  base = '',
  onDone = null,
} = {}) {
  if (!root) throw new Error('mountPairClaim: a root element is required');
  if (!fetchImpl) throw new Error('mountPairClaim: no fetch available');

  const read = (k) => { try { return store?.getItem(k) || ''; } catch { return ''; } };
  const write = (k, v) => { try { if (v) store?.setItem(k, v); else store?.removeItem(k); } catch { /* private mode */ } };

  // The query wins over the stash: a person who scans a SECOND screen while an old code is
  // still stashed must get the one they just scanned.
  let code = codeFromQuery(loc?.search) || read(STASH);
  let state = 'ready';
  let error = '';
  let label = '';

  root.innerHTML = '<div class="pc-card" data-card></div>';
  const card = root.querySelector('[data-card]');

  function paint() {
    const m = claimMessage(state, { code, label, error });
    const showForm = state === 'ready' || state === 'failed';
    card.dataset.state = state;
    card.innerHTML = `<h1 class="pc-title">${escapeHTML(m.title)}</h1>`
      + (m.body ? `<p class="pc-body">${escapeHTML(m.body)}</p>` : '')
      + (showForm ? `
        <label class="pc-label" for="pc-code">Code from the screen</label>
        <input id="pc-code" class="pc-input" data-code inputmode="latin" autocapitalize="characters"
               autocomplete="off" spellcheck="false" maxlength="12" value="${escapeHTML(code)}">
        <button class="pc-go" data-go>Add this screen</button>` : '')
      + (state === 'signed-out' ? '<button class="pc-go" data-signin>Sign in</button>' : '')
      + (state === 'working' ? '<div class="pc-wait" role="status">Working…</div>' : '');

    card.querySelector('[data-code]')?.addEventListener('input', (e) => {
      code = normalizeCode(e.target.value);
      if (e.target.value !== code) e.target.value = code;
    });
    card.querySelector('[data-go]')?.addEventListener('click', () => { claim(); });
    card.querySelector('[data-signin]')?.addEventListener('click', () => { signIn(); });
    card.querySelector('[data-code]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') claim();
    });
  }

  function signIn() {
    // Stash first, THEN leave. In that order: a browser that drops the `next` parameter, a
    // proxy that rewrites it, an OAuth provider that returns to a default — none of those
    // can lose the code if it is already written down here.
    write(STASH, code);
    const back = safeNext((loc?.pathname || '/pair.html') + (code ? `?c=${encodeURIComponent(code)}` : ''));
    loc.href = `${base}/auth/login?next=${encodeURIComponent(back)}`;
  }

  async function whoAmI() {
    try {
      const res = await fetchImpl(`${base}/api/me`, { headers: authHeaders(), credentials: 'same-origin' });
      return res.ok;
    } catch { return false; }
  }

  async function claim() {
    code = normalizeCode(code);
    if (code.length < 4) { state = 'failed'; error = 'unknown'; paint(); return; }
    state = 'working'; paint();
    try {
      const res = await fetchImpl(`${base}/api/screen-pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'same-origin',
        body: JSON.stringify({ code }),
      });
      if (res.status === 401) { state = 'signed-out'; paint(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's own words are better than a guess; the codes below are the three
        // cases it distinguishes, and `claimMessage` turns each into an instruction.
        const detail = String(data.detail || '');
        error = /expired/i.test(detail) ? 'expired'
          : /already been used/i.test(detail) ? 'claimed'
          : /no such code/i.test(detail) ? 'unknown' : detail;
        state = 'failed'; paint(); return;
      }
      label = data.label || '';
      write(STASH, '');            // spent — do not offer it again
      state = 'done'; paint();
      onDone?.(data);
    } catch (err) {
      state = 'failed';
      error = 'Could not reach the server. Check your connection and try again.';
      paint();
    }
  }

  // Decide what to show FIRST, before painting, so a signed-in person never sees a
  // sign-in button flash past.
  (async () => {
    if (!(await whoAmI())) state = 'signed-out';
    paint();
  })();

  paint();
  return {
    state: () => state,
    code: () => code,
    claim,
    setCode(v) { code = normalizeCode(v); paint(); },
  };
}

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
