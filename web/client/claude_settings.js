// claude_settings.js — THE OWNER'S PAGE FOR "CLAUDE, ON THIS ACCOUNT" (/claude.html).
//
// Mike, 2026-10-03: an optional Claude backend for one account's own use. This page is where the account
// owner pastes the key, picks the models, sets the daily spending limit and sees what today has cost.
// The rules are the server's (web/server/claude_ai.py); this draws them and sends what is pressed.
//
// *** THE KEY GOES ONE WAY. *** The field is a password field, never filled in from anything: the server
// never sends the key back (only "set / not set" and its last four characters), so there is nothing to
// fill it with. After Save the field is emptied. Nothing here touches localStorage.
//
// A SCREEN CAN READ THIS PAGE BUT NOT CHANGE IT: the server answers 403 to a change sent with a screen's
// device key, and this page shows the server's own sentence.

import { CLAUDE_API, CLAUDE_PLAIN_WORDS, claudeStatusLine } from './nimrod_ai.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export const CLAUDE_STYLE = `
.cs-card{box-sizing:border-box;width:100%;max-width:40rem;margin:0 auto;padding:20px;border-radius:16px;border:1px solid var(--border);
  background:var(--surface);color:var(--text)}
.cs-card h1{font-size:1.35rem;margin:0 0 .3em}
.cs-card h2{font-size:1.05rem;margin:1.2em 0 .4em}
.cs-muted{color:var(--text-muted)}
.cs-status{font-weight:700}
.cs-words{margin:.4em 0;padding-left:1.2rem}
.cs-words li{margin:.25em 0}
.cs-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:.4em 0}
.cs-card label{display:block;margin:.6em 0 .2em;color:var(--text-muted);font-weight:700}
.cs-card input,.cs-card select{box-sizing:border-box;width:100%;min-height:44px;padding:8px 10px;border-radius:10px;
  border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit}
.cs-btn{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer}
.cs-btn.cs-go{font-weight:700;border-color:var(--accent)}
.cs-btn[disabled]{opacity:.5;cursor:default}
.cs-btn:focus-visible,.cs-card input:focus-visible,.cs-card select:focus-visible{outline:3px solid var(--focus, var(--accent));outline-offset:2px}
.cs-msg{margin:.5em 0;padding:8px 10px;border-radius:10px;border:1px solid var(--border)}
.cs-days{width:100%;border-collapse:collapse}
.cs-days th,.cs-days td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--border)}
`;

/**
 * Draw the page into `el`. `fetchImpl` and `headers` are injectable (a suite passes a fake server).
 * Returns { refresh, state() } for the suite.
 */
export function mountClaudeSettings(el, { fetchImpl = (...a) => fetch(...a), headers = () => ({}) } = {}) {
  let st = null;          // the last status from the server
  let msg = '';
  let busy = false;

  async function call(method, path = '', body) {
    let h = {};
    try { h = headers() || {}; } catch { h = {}; }
    const init = { method, credentials: 'same-origin', headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) } };
    if (body) init.body = JSON.stringify(body);
    let res;
    try { res = await fetchImpl(`${CLAUDE_API}${path}`, init); } catch { return { ok: false, detail: 'Could not reach this website’s server.' }; }
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) return { ok: false, status: res.status, detail: (j && typeof j.detail === 'string' && j.detail) || `Error ${res.status}.` };
    return { ok: true, body: j };
  }

  async function refresh() {
    const r = await call('GET');
    if (r.ok) st = r.body;
    else msg = r.status === 401 ? 'Sign in first: this page is for the account owner.' : r.detail;
    render();
  }

  async function act(fn) {
    if (busy) return;
    busy = true; render();
    try { await fn(); } finally { busy = false; render(); }
  }

  function render() {
    const words = `<ul class="cs-words" data-cs-words>${CLAUDE_PLAIN_WORDS.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    if (!st) {
      el.innerHTML = `<div class="cs-card"><h1>Claude, on your account</h1>
        <p class="cs-msg" data-cs-msg>${esc(msg || 'Loading…')}</p>${words}</div>`;
      return;
    }
    const opt = (list, cur) => list.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    const warn = [
      st.sdk_installed ? '' : 'This server does not have the Claude package installed yet, so Claude cannot answer here until whoever runs the site installs it.',
      st.can_store ? '' : 'This server is not set up to keep keys yet (it needs its NIMROD_AI_KEY_SECRET setting), so a key cannot be saved.',
    ].filter(Boolean);
    const days = (st.days || []).filter((d) => d.requests > 0);
    el.innerHTML = `<div class="cs-card" data-cs-card>
      <h1>Claude, on your account</h1>
      <p class="cs-muted">An optional AI for the guide on your screens, paid for by your own Claude key. The free choice,
        an AI program on your own computer (Ollama), stays the default; each screen chooses in the guide’s
        “Set up your guide / AI”.</p>
      <p class="cs-status" data-cs-status role="status">${esc(claudeStatusLine(st))}</p>
      ${warn.map((w) => `<p class="cs-msg" data-cs-warn>${esc(w)}</p>`).join('')}
      ${msg ? `<p class="cs-msg" data-cs-msg role="status">${esc(msg)}</p>` : ''}
      ${words}

      <h2>The key</h2>
      <p class="cs-muted">${st.key_set ? `A key is saved, ending <b data-cs-last4>${esc(st.key_last4 || '')}</b>. Paste a new one to replace it.`
        : 'Make an API key in the Anthropic Console and paste it here. It is sent once, kept encrypted, and never shown again.'}</p>
      <label for="cs-key">Claude API key</label>
      <input id="cs-key" data-cs-key type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…">
      <div class="cs-row">
        <button type="button" class="cs-btn cs-go" data-cs-do="savekey" ${busy || !st.can_store ? 'disabled' : ''}>Save the key</button>
        ${st.key_set ? `<button type="button" class="cs-btn" data-cs-do="check" ${busy ? 'disabled' : ''}>Check the key</button>
        <button type="button" class="cs-btn" data-cs-do="removekey" ${busy ? 'disabled' : ''}>Remove the key</button>` : ''}
      </div>

      <h2>Models and the daily limit</h2>
      <label for="cs-chat">For talking to the guide</label>
      <select id="cs-chat" data-cs-chat>${opt(st.chat_models || [], st.chat_model)}</select>
      <label for="cs-quiz">For writing quiz questions ahead of time (at half price, through Anthropic’s Batch API)</label>
      <select id="cs-quiz" data-cs-quiz>${opt(st.quiz_models || [], st.quiz_model)}</select>
      <label for="cs-cap">Daily spending limit, in US dollars (0 pauses Claude; at most ${money(st.max_daily_cap_usd)})</label>
      <input id="cs-cap" data-cs-cap type="number" min="0" max="${esc(st.max_daily_cap_usd)}" step="0.25" value="${esc(st.daily_cap_usd)}">
      <div class="cs-row"><button type="button" class="cs-btn cs-go" data-cs-do="savesettings" ${busy ? 'disabled' : ''}>Save these</button></div>
      <p class="cs-muted">Also set a monthly spend limit on the key itself in the Anthropic Console: a second wall that holds
        even if this site gets something wrong.</p>

      <h2>Today, and the last week</h2>
      <p data-cs-today>Today (the day is counted in UTC): ${money(st.today?.usd)} of ${money(st.daily_cap_usd)},
        ${Number(st.today?.requests) || 0} message${Number(st.today?.requests) === 1 ? '' : 's'}.</p>
      ${days.length ? `<table class="cs-days" data-cs-days><thead><tr><th>Day</th><th>Messages</th><th>Cost</th></tr></thead><tbody>
        ${days.map((d) => `<tr><td>${esc(d.day)}</td><td>${esc(d.requests)}</td><td>${money(d.usd)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="cs-muted">Nothing used in the last week.</p>'}
      <p class="cs-muted">Only these counts are kept: never what was said.</p>
    </div>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-cs-do]');
    if (!b || b.disabled) return;
    const what = b.dataset.csDo;
    if (what === 'savekey') {
      const input = el.querySelector('[data-cs-key]');
      const key = input ? input.value : '';
      if (input) input.value = '';          // emptied at once, whatever the answer
      act(async () => {
        const r = await call('PUT', '/key', { key });
        if (r.ok) { st = r.body; msg = 'Saved. The key is kept encrypted and will not be shown again.'; } else msg = r.detail;
      });
    } else if (what === 'removekey') {
      act(async () => {
        const r = await call('DELETE', '/key');
        if (r.ok) { st = r.body; msg = 'The key is removed. Claude will not answer on this account until a new one is saved.'; } else msg = r.detail;
      });
    } else if (what === 'check') {
      act(async () => {
        const r = await call('POST', '/check');
        msg = r.ok ? (r.body?.ok ? `The key works (${r.body.model}).` : (r.body?.reason || 'The key did not work.')) : r.detail;
      });
    } else if (what === 'savesettings') {
      const chat = el.querySelector('[data-cs-chat]')?.value;
      const quiz = el.querySelector('[data-cs-quiz]')?.value;
      const capRaw = el.querySelector('[data-cs-cap]')?.value;
      const cap = Number(capRaw);
      act(async () => {
        if (capRaw === '' || !Number.isFinite(cap)) { msg = 'The daily limit is a number of dollars.'; return; }
        const r = await call('PUT', '/settings', { chat_model: chat, quiz_model: quiz, daily_cap_usd: cap });
        if (r.ok) { st = r.body; msg = 'Saved.'; } else msg = r.detail;
      });
    }
  });

  render();
  const ready = refresh();
  return { refresh, ready, state: () => ({ status: st, msg, busy }) };
}
