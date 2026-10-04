// search_keys.js — THE PAGE FOR YOUR OWN YOUTUBE AND SPOTIFY KEYS (/search_keys.html), so "Recommend a song or video"
// can search by name.
//
// Mike, 2026-10-04: "I have a Youtube API and Spotify account." Bring your own key (CLAUDE.md: the default costs the
// site owner nothing for anybody else), so each sign-in pastes its own here. The rules are the server's
// (web/server/recommend_search.py); this draws them and sends what is pressed.
//
// *** THE KEYS GO ONE WAY, AS ON /claude.html. *** Password fields, never filled from anything: the server never sends
// a key back (only "saved" and the last four characters), so there is nothing to fill them with. After Save the
// fields are emptied at once, whatever the answer. Nothing here touches localStorage.
//
// A SCREEN CAN READ THIS PAGE BUT NOT CHANGE IT: the server answers 403 to a change sent with a screen's key, and this
// page shows the server's own sentence.
//
// ITS OWN PAGE, NOT A SECTION OF /claude.html (argued): FOR one page of keys, one place to look. AGAINST, and it
// decides it: the Claude page is about an AI that costs money with a daily limit; these keys cost nothing and are
// for finding songs. Somebody who only wants search should not have to read about Claude spending to get it, and
// the recommend window can link straight here.

export const SEARCH_KEYS_API = '/api/recommend/keys';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every word this page can show, in one place, so the suite can hold them to the plain-word rule.
export const SEARCH_KEYS_WORDS = Object.freeze({
  title: 'Search for songs and videos by name',
  intro: 'When you recommend a song or video to one of your people, you can paste a link. With your own YouTube or '
    + 'Spotify key you can search by name instead. The keys are yours: searches count against your own free '
    + 'allowance, and nobody else’s searches use them.',
  kept: 'Each key is sent once, kept encrypted, and never shown again: only its last four characters.',
  ytHeading: 'YouTube',
  ytSteps: [
    'Go to console.cloud.google.com and sign in with a Google login.',
    'Make a project (any name will do), or pick one you already have.',
    'Open APIs & Services, then Library. Find YouTube Data API v3 and press Enable.',
    'Open APIs & Services, then Credentials. Press Create credentials, then API key, and copy the key.',
    'Under the key’s restrictions, leave Application restrictions at None (this site asks YouTube from its own '
      + 'server, not from your browser). Limiting the key to YouTube Data API v3 is fine, and safer.',
  ],
  ytQuota: 'YouTube’s free allowance is about 100 searches a day for each key. It starts again after midnight, '
    + 'Pacific time. Checking the key uses almost none of it.',
  ytLabel: 'YouTube key',
  ytFilter: 'What YouTube may show in search',
  ytFilterHelp: 'Strict is the starting choice: a recommendation lands on somebody else’s page.',
  filters: { strict: 'Strict: hide videos YouTube marks as not for everyone', moderate: 'Moderate', none: 'Off: no filter' },
  spHeading: 'Spotify',
  spSteps: [
    'Go to developer.spotify.com and sign in with your Spotify login.',
    'Press Create app. Give it any name and description. Spotify asks for a Redirect URI: put http://127.0.0.1:8080/ '
      + '(this site never uses it). Tick Web API, agree to Spotify’s terms, and save.',
    'Open the app’s Settings. Copy the Client ID, then press View client secret and copy that too.',
  ],
  spNote: 'Searching Spotify this way needs nobody to sign in to Spotify here, and plays nothing: it only finds the '
    + 'song’s link.',
  spId: 'Client ID',
  spSecret: 'Client secret',
  save: 'Save the key',
  saveBoth: 'Save both',
  check: 'Check the key',
  remove: 'Remove the key',
  saveFilter: 'Save this',
  none: 'No key saved yet.',
  savedYT: (last4) => `A key is saved, ending …${last4}. Paste a new one to replace it.`,
  savedSP: (last4) => `Saved: the Client ID ends …${last4}. Paste new ones to replace them.`,
  cannotStore: 'This server is not set up to keep keys yet (it needs its NIMROD_AI_KEY_SECRET setting), so a key cannot be saved.',
  signIn: 'Sign in first: this page is for whoever these keys belong to.',
  unreachable: 'Could not reach this website’s server.',
  savedMsg: 'Saved. It is kept encrypted and will not be shown again.',
  removedMsg: (name) => `The ${name} key is removed. Search will not use ${name} until a new one is saved.`,
  works: (name) => `The ${name} key works.`,
  didNotWork: 'The key did not work.',
  loading: 'Loading…',
});

export const SEARCH_KEYS_STYLE = `
.sk-card{box-sizing:border-box;width:100%;max-width:40rem;margin:0 auto;padding:20px;border-radius:16px;border:1px solid var(--border);
  background:var(--surface);color:var(--text)}
.sk-card h1{font-size:1.35rem;margin:0 0 .3em}
.sk-card h2{font-size:1.15rem;margin:1.4em 0 .4em}
.sk-muted{color:var(--text-muted)}
.sk-status{font-weight:700}
.sk-steps{margin:.4em 0;padding-left:1.4rem}
.sk-steps li{margin:.3em 0}
.sk-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:.5em 0}
.sk-card label{display:block;margin:.6em 0 .2em;color:var(--text-muted);font-weight:700}
.sk-card input,.sk-card select{box-sizing:border-box;width:100%;min-height:48px;padding:8px 10px;border-radius:10px;
  border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit}
.sk-btn{min-height:48px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer}
.sk-btn.sk-go{font-weight:700;border-color:var(--accent)}
.sk-btn[disabled]{opacity:.5;cursor:default}
.sk-btn:focus-visible,.sk-card input:focus-visible,.sk-card select:focus-visible,.sk-card a:focus-visible{outline:3px solid var(--focus, var(--accent));outline-offset:2px}
.sk-card a{color:var(--link)}
.sk-msg{margin:.5em 0;padding:8px 10px;border-radius:10px;border:1px solid var(--border)}
`;

const W = SEARCH_KEYS_WORDS;

/**
 * Draw the page into `el`. `fetchImpl` and `headers` are injectable (a suite passes a fake server).
 * Returns { refresh, ready, state() }.
 */
export function mountSearchKeys(el, { fetchImpl = (...a) => fetch(...a), headers = () => ({}) } = {}) {
  let st = null;
  let msg = '';
  let busy = false;

  async function call(method, path = '', body) {
    let h = {};
    try { h = headers() || {}; } catch { h = {}; }
    const init = { method, credentials: 'same-origin', headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) } };
    if (body) init.body = JSON.stringify(body);
    let res;
    try { res = await fetchImpl(`${SEARCH_KEYS_API}${path}`, init); } catch { return { ok: false, detail: W.unreachable }; }
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) return { ok: false, status: res.status, detail: (j && typeof j.detail === 'string' && j.detail) || `Error ${res.status}.` };
    return { ok: true, body: j };
  }

  async function refresh() {
    const r = await call('GET');
    if (r.ok) st = r.body;
    else msg = r.status === 401 ? W.signIn : r.detail;
    render();
  }

  async function act(fn) {
    if (busy) return;
    busy = true; render();
    try { await fn(); } finally { busy = false; render(); }
  }

  const steps = (list) => `<ol class="sk-steps">${list.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;

  function render() {
    if (!st) {
      el.innerHTML = `<style>${SEARCH_KEYS_STYLE}</style><div class="sk-card"><h1>${esc(W.title)}</h1><p class="sk-msg" data-sk-msg>${esc(msg || W.loading)}</p></div>`;
      return;
    }
    const yt = st.youtube || {};
    const sp = st.spotify || {};
    const dis = busy ? 'disabled' : '';
    const opts = (st.safe_search_options || ['strict', 'moderate', 'none'])
      .map((v) => `<option value="${esc(v)}" ${v === st.safe_search ? 'selected' : ''}>${esc(W.filters[v] || v)}</option>`).join('');
    // Its own styles come with it (recommend.js's way), so the page and a suite draw it the same.
    el.innerHTML = `<style>${SEARCH_KEYS_STYLE}</style><div class="sk-card" data-sk-card>
      <h1>${esc(W.title)}</h1>
      <p class="sk-muted">${esc(W.intro)}</p>
      <p class="sk-muted">${esc(W.kept)}</p>
      ${st.can_store ? '' : `<p class="sk-msg" data-sk-warn>${esc(W.cannotStore)}</p>`}
      ${msg ? `<p class="sk-msg" data-sk-msg role="status">${esc(msg)}</p>` : ''}

      <h2>${esc(W.ytHeading)}</h2>
      <p class="sk-status" data-sk-status="youtube">${esc(yt.set ? W.savedYT(yt.last4 || '') : W.none)}</p>
      ${steps(W.ytSteps)}
      <p class="sk-muted">${esc(W.ytQuota)}</p>
      <label for="sk-yt">${esc(W.ytLabel)}</label>
      <input id="sk-yt" data-sk-yt type="password" autocomplete="off" spellcheck="false" placeholder="AIza…">
      <div class="sk-row">
        <button type="button" class="sk-btn sk-go" data-sk-do="save-youtube" ${busy || !st.can_store ? 'disabled' : ''}>${esc(W.save)}</button>
        ${yt.set ? `<button type="button" class="sk-btn" data-sk-do="check-youtube" ${dis}>${esc(W.check)}</button>
        <button type="button" class="sk-btn" data-sk-do="remove-youtube" ${dis}>${esc(W.remove)}</button>` : ''}
      </div>
      <label for="sk-filter">${esc(W.ytFilter)}</label>
      <select id="sk-filter" data-sk-filter>${opts}</select>
      <p class="sk-muted">${esc(W.ytFilterHelp)}</p>
      <div class="sk-row"><button type="button" class="sk-btn" data-sk-do="save-filter" ${dis}>${esc(W.saveFilter)}</button></div>

      <h2>${esc(W.spHeading)}</h2>
      <p class="sk-status" data-sk-status="spotify">${esc(sp.set ? W.savedSP(sp.last4 || '') : W.none)}</p>
      ${steps(W.spSteps)}
      <p class="sk-muted">${esc(W.spNote)}</p>
      <label for="sk-sp-id">${esc(W.spId)}</label>
      <input id="sk-sp-id" data-sk-sp-id type="text" autocomplete="off" spellcheck="false">
      <label for="sk-sp-secret">${esc(W.spSecret)}</label>
      <input id="sk-sp-secret" data-sk-sp-secret type="password" autocomplete="off" spellcheck="false">
      <div class="sk-row">
        <button type="button" class="sk-btn sk-go" data-sk-do="save-spotify" ${busy || !st.can_store ? 'disabled' : ''}>${esc(W.saveBoth)}</button>
        ${sp.set ? `<button type="button" class="sk-btn" data-sk-do="check-spotify" ${dis}>${esc(W.check)}</button>
        <button type="button" class="sk-btn" data-sk-do="remove-spotify" ${dis}>${esc(W.remove)}</button>` : ''}
      </div>
    </div>`;
  }

  const NAME = { youtube: 'YouTube', spotify: 'Spotify' };

  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-sk-do]');
    if (!b || b.disabled) return;
    const [what, which] = b.dataset.skDo.split('-');
    if (what === 'save' && which === 'youtube') {
      const input = el.querySelector('[data-sk-yt]');
      const key = input ? input.value : '';
      if (input) input.value = '';           // emptied at once, whatever the answer
      act(async () => {
        const r = await call('PUT', '/youtube', { key });
        if (r.ok) { st = r.body; msg = W.savedMsg; } else msg = r.detail;
      });
    } else if (what === 'save' && which === 'spotify') {
      const a = el.querySelector('[data-sk-sp-id]');
      const s = el.querySelector('[data-sk-sp-secret]');
      const body = { client_id: a ? a.value : '', client_secret: s ? s.value : '' };
      if (a) a.value = '';
      if (s) s.value = '';
      act(async () => {
        const r = await call('PUT', '/spotify', body);
        if (r.ok) { st = r.body; msg = W.savedMsg; } else msg = r.detail;
      });
    } else if (what === 'save' && which === 'filter') {
      const v = el.querySelector('[data-sk-filter]')?.value;
      act(async () => {
        const r = await call('PUT', '/settings', { safe_search: v });
        if (r.ok) { st = r.body; msg = 'Saved.'; } else msg = r.detail;
      });
    } else if (what === 'remove' && NAME[which]) {
      act(async () => {
        const r = await call('DELETE', `/${which}`);
        if (r.ok) { st = r.body; msg = W.removedMsg(NAME[which]); } else msg = r.detail;
      });
    } else if (what === 'check' && NAME[which]) {
      act(async () => {
        const r = await call('POST', `/${which}/check`);
        msg = r.ok ? (r.body?.ok ? W.works(NAME[which]) : (r.body?.reason || W.didNotWork)) : r.detail;
      });
    }
  });

  render();
  const ready = refresh();
  return { refresh, ready, state: () => ({ status: st, msg, busy }) };
}
