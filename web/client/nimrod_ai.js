// nimrod_ai.js — "TALK TO <your AI>": the Nimrod guide as the AI module. Pure pieces, no page: the
// person's AI settings, the prompt, the ALLOW-LISTED ACTIONS the AI may ask for (and the queue that
// holds them until a press), and the conversation. modules/nimrod.js draws it; dev/nimrod_ai_test.html
// checks it with a fake AI.
//
// Mike, 2026-10-02: *"The Nimrod module should probably be the AI module. You wire up whatever AI you
// want ... It would be nice to work with [my AI] instead of Nimrod for me. I could walk through the tour
// of the modules with her and we could edit as we go."* And, for later: *"use voice commands to just
// chat with the AI naturally to set up the room. Like '..., please add a desk to the back right corner
// of the room with a gaming PC, a lamp, RGB setup ...'"* — that is what `registerAIAction` is for.
//
// *** THE BRAIN IS ai.js, UNCHANGED IN SHAPE: ONE OpenAI-compatible adapter. *** Whatever answers
// `/chat/completions` at the address this device was given — a local Ollama (free), a free endpoint,
// or the person's own key — is the AI. Nothing here knows which.
//
// *** AND A THIRD CHOICE (2026-10-03): "Claude, on this account" (`createClaudeAI`). *** Mike: an optional
// Claude backend for one account's own use, "not something where I have to pay for everyone". It has the
// SAME SHAPE as ai.js's client (settings, listModels, resolveModel, chat), so the guide, the hello, the
// notes and the action queue below cannot tell it apart. The difference is where the key is: NOWHERE in
// the browser. The account owner pastes it once on /claude.html; the server keeps it encrypted, calls
// Claude, and enforces the account's daily spending limit (web/server/claude_ai.py). The local Ollama
// stays the default (`DEFAULT_BACKEND`).
//
// *** THE NAME AND THE PERSONA ARE THE PERSON'S, NOT THE SITE'S. *** Default name "Nimrod" (he is the
// guide already); any other name is somebody's own choice for their own AI, kept on THEIR person record
// (`AI_STATE_KEY`, per person, follows them to every screen). The site never ships another name.
//
// *** ACTIONS ARE ASKED FOR, NEVER TAKEN. *** The AI writes `[[go theme]]`-style lines; only names in
// the allow-list are read (anything else is dropped and reported as ignored), each is checked again
// before it runs, and each waits for a press — unless the person turned on "let it act without asking".
//   Argued, OFF by default: FOR on — somebody talking hands-free wants "show me the themes" to just
//   happen, and a press interrupts that (saying "yes" while the chat is listening confirms, so a voice-only
//   person is not stuck). FOR off (chosen) — the AI is a language model that mis-reads, the screen may be
//   watched by somebody who is not the one talking, and the settings MENU takes a switch user's scan.
//   *** WHAT IF NOBODY ANSWERS? The action does not happen. *** Nothing waits on it: the chat goes on,
//   the guide works, and the next reply replaces it. Inaction is the failure.
//
// *** WHY [[lines]] AND NOT THE OpenAI "tools" FIELD: *** the adapter's whole point is that any backend
// works, and tool calling is the part backends disagree on most (and small local models do worst).
// A line in the text works on every model that can follow an instruction, and a model that ignores it
// costs nothing but the action.

import { MENU_TAB_IDS } from './actions.js';
import { isChatModel, DEFAULT_BASE_URL } from './ai.js';
import { GUIDE_NODES, GUIDE_TOPICS, SETTINGS_PAGES, GUIDE_ROOT, introFor } from './nimrod_guide_data.js';

export const AI_SOURCE = 'nimrod-ai';           // `source` on what the AI says, for the output log
export const AI_STATE_KEY = 'nimrod-ai';        // the PERSON's record (ctx.makePersonState)

// The speech layer's topics (input_speech.js), written out so this file imports no input code; the
// suite checks they agree, word_games.js's habit.
export const SPEECH_TOPICS = Object.freeze({
  grammar: 'speech/grammar', answer: 'speech/answer', answering: 'speech/answering',
});
export const DELIVERY_TOPIC = 'output/delivery';   // output.js: a said thing has finished (or dropped)

// How long the chat keeps listening after the last thing it heard, as the person's choice.
//   Argued, 2 minutes: long enough to think between sentences on a tour; short enough that a screen
//   somebody walked away from stops sending the room's talk to the AI (and stops answering the TV).
//   "Until I press it" is deliberately NOT a choice: what if nobody presses? The room talks to the AI
//   all night. The longest is 5 minutes.
export const LISTEN_CHOICES = Object.freeze([30000, 60000, 120000, 300000]);
export const AI_DEFAULTS = Object.freeze({ name: 'Nimrod', persona: '', actFreely: false, listenMs: 120000 });
export const NAME_MAX = 40;
export const PERSONA_MAX = 2000;

const str = (v) => (typeof v === 'string' ? v : '');
/** The person's AI settings, every one cleaned and defaulted. */
export function aiPrefs(v = {}) {
  const o = v && typeof v === 'object' ? v : {};
  const name = str(o.name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  const ms = Number(o.listenMs);
  return {
    name: name || AI_DEFAULTS.name,
    persona: str(o.persona).trim().slice(0, PERSONA_MAX),
    actFreely: o.actFreely === true,
    listenMs: LISTEN_CHOICES.includes(ms) ? ms : AI_DEFAULTS.listenMs,
  };
}

/** Is this address on this computer or this house's network? (A remote one must name its model.) */
export function isLocalAddress(url) {
  let h = '';
  try { h = new URL(String(url || '')).hostname.toLowerCase(); } catch { return false; }
  h = h.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.local') || h === '::1' || /^127\./.test(h) || /^10\./.test(h)
    || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h);
}

// ---------------------------------------------------------------------------------------------------
// *** SETTING IT UP (2026-10-03, the guide's "Set up your guide / AI"). *** The pure parts of the flow.
// ---------------------------------------------------------------------------------------------------
// Where "Look for Ollama on this computer" looks: Ollama's own default, the same as ai.js DEFAULT_BASE_URL.
// Not a setting here because it IS the setting's default: somebody whose AI is elsewhere types its address
// under "Use an online AI, or another address" instead.
export const OLLAMA_URL = DEFAULT_BASE_URL;

/**
 * The model to offer first from a server's list: THE FIRST CHAT MODEL, in the server's own order. Argued
 * against ai.js `pickModel` (the LARGEST), which suits writing a quiz: a guide is a conversation, where a
 * reply that takes a minute is worse than a slightly plainer one, and Ollama lists the model pulled most
 * recently first, which is usually the one the person just installed for this. Either way it is only the one
 * pressed in for them: every model is a button. Embedding and speech models are never offered.
 */
export function firstChatModel(ids) {
  return (Array.isArray(ids) ? ids : []).find((id) => isChatModel(id)) || null;
}

/** The hello test: a short system line (name + persona) and one question. Short, so a CPU model is quick. */
export const HELLO_TEXT = 'Hello! Please say hello back in one short sentence, and tell me your name.';
export const HELLO_TOKENS = 80;
export function helloMessages(prefs = {}) {
  const p = aiPrefs(prefs);
  return [
    { role: 'system', content: `Your name is ${p.name}. ${p.persona || DEFAULT_PERSONA} Keep replies to one or two short sentences.` },
    { role: 'user', content: HELLO_TEXT },
  ];
}

// Ollama's OWN default allow-list (its OLLAMA_ORIGINS defaults, as of 0.35.1 on this desktop, 2026-10-03):
// pages from this computer, any port. Anything else must be added. Measured with curl, not assumed: an
// Origin of http://127.0.0.1:8270 was answered; https://example.org got 403 Forbidden.
const DEFAULT_ALLOWED = /^(https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?|app:\/\/.*|file:\/\/.*|tauri:\/\/.*|vscode-webview:\/\/.*)$/i;
/** Does Ollama, as shipped, already accept a page from this origin? */
export const ollamaAllowsByDefault = (origin) => DEFAULT_ALLOWED.test(String(origin || '').replace(/\/+$/, ''));

/**
 * What to do so Ollama accepts `origin`: plain lines per system, or null when it already does. The setting
 * REPLACES Ollama's list, so somebody who already set it adds this address after a comma.
 * "Then quit Ollama and start it again" on each: a running Ollama does not read the setting again.
 */
export function ollamaOriginLines(origin) {
  const o = String(origin || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/i.test(o) || ollamaAllowsByDefault(o)) return null;
  return [
    { os: 'Windows', how: `In a Command Prompt: setx OLLAMA_ORIGINS "${o}"  — then quit Ollama from the tray and start it again.` },
    { os: 'Mac', how: `In Terminal: launchctl setenv OLLAMA_ORIGINS "${o}"  — then quit Ollama and start it again.` },
    { os: 'Linux', how: `sudo systemctl edit ollama.service, add the two lines [Service] and Environment="OLLAMA_ORIGINS=${o}", then sudo systemctl restart ollama.` },
    { os: 'Already set?', how: `If OLLAMA_ORIGINS already lists other addresses, add this one after a comma: ...,${o}` },
  ];
}

// ---------------------------------------------------------------------------------------------------
// *** WHICH AI ANSWERS (2026-10-03). *** Three backends, the local one first and the default.
// PER DEVICE, like ai.js's address: the machine in front of you decides where its AI is (a desktop with
// Ollama, a kiosk with none). The choice is not a secret, so it is plain localStorage, in try/catch.
// ---------------------------------------------------------------------------------------------------
export const AI_BACKEND_KEY = 'nimrod.ai.backend';
export const DEFAULT_BACKEND = 'local';
export const AI_BACKENDS = Object.freeze([
  Object.freeze({ id: 'local', label: 'Local (Ollama)',
    help: 'Free: an AI program on this computer. Nothing leaves it.' }),
  Object.freeze({ id: 'online', label: 'Online address + your own key',
    help: 'Any online AI that speaks the OpenAI API, free or with your own key. The key stays in this browser and goes only to that address.' }),
  Object.freeze({ id: 'claude', label: 'Claude, on this account',
    help: 'Claude, paid for by this account’s own Claude key, which the account owner saves once on the Claude settings page. The key is kept on the server, never in this browser.' }),
]);
const BACKEND_IDS = AI_BACKENDS.map((b) => b.id);
const backendStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** This device's choice, or the default. Unreadable storage reads as the default, never a throw. */
export function readAIBackend(storage = backendStorage()) {
  let v = null;
  try { v = storage ? storage.getItem(AI_BACKEND_KEY) : null; } catch { v = null; }
  return BACKEND_IDS.includes(v) ? v : DEFAULT_BACKEND;
}
/** Keep a choice on this device. Returns what is now chosen. */
export function writeAIBackend(id, storage = backendStorage()) {
  const v = BACKEND_IDS.includes(id) ? id : DEFAULT_BACKEND;
  try { storage?.setItem(AI_BACKEND_KEY, v); } catch { /* read-only storage */ }
  return readAIBackend(storage);
}

// The server's doors (web/server/app.py, "CLAUDE, ON THIS ACCOUNT") and the owner's page.
export const CLAUDE_API = '/api/ai/claude';
export const CLAUDE_SETTINGS_PAGE = '/claude.html';
export const CLAUDE_TIMEOUT_MS = 90 * 1000;
// What is sent, the limit, and how to remove the key, in plain words: said on the connect step and on
// the settings page, from this one list.
export const CLAUDE_PLAIN_WORDS = Object.freeze([
  'What is sent: only the words of the conversation (typed, or what the microphone heard) and the guide’s place, as text, to Anthropic, who make Claude. Never pictures, sound or files.',
  'The key: saved once by the account owner on the Claude settings page, kept encrypted on the server, and never sent back to any screen or browser. Only its last four characters are ever shown.',
  'The limit: a daily spending limit for the account, $1 a day unless the owner changes it. Past it, Claude stops answering until midnight UTC; the guide itself keeps working.',
  'To remove the key: “Remove the key” on the Claude settings page. Also set a monthly spend limit for the key in the Anthropic Console, as a second wall.',
]);

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
/** One line for a status from GET /api/ai/claude: what answers, and today's spend against the limit. */
export function claudeStatusLine(st) {
  if (!st || typeof st !== 'object') return 'Could not read the Claude settings.';
  if (!st.key_set) return 'Claude is not set up on this account yet: the account owner saves a key on the Claude settings page.';
  const label = (st.chat_models || []).find((m) => m.id === st.chat_model)?.label || st.chat_model || 'Claude';
  return `Claude is set up (key ending ${st.key_last4 || '????'}), answering with ${label}. Today: ${money(st.today?.usd)} of ${money(st.daily_cap_usd)}.`;
}

/**
 * "Claude, on this account": ai.js's shape, answered by the server. NO KEY IS EVER HELD HERE: `hasKey` is
 * always false and `setKey` stores nothing. `fetchImpl` and `headers` are the host's (the screen's
 * X-Device-Key, or a signed-in session's cookie, same-origin).
 */
export function createClaudeAI({ fetchImpl = (...a) => fetch(...a), headers = () => ({}), base = '',
                                 timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  let last = null;     // the last status the server gave
  async function call(path, init = {}, { signal, timeoutMs: t } = {}) {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, Number(t) > 0 ? Number(t) : timeoutMs);
    const onCancel = () => ctl.abort();
    if (signal?.aborted) return { ok: false, cancelled: true, reason: 'Cancelled.' };
    signal?.addEventListener?.('abort', onCancel);
    try {
      let h = {};
      try { h = headers() || {}; } catch { h = {}; }
      const res = await fetchImpl(`${base}${path}`, { ...init, headers: { ...(init.headers || {}), ...h },
        credentials: 'same-origin', signal: ctl.signal });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (!res.ok) {
        const d = body && typeof body.detail === 'string' ? body.detail : '';
        return { ok: false, status: res.status, reason: d || `The site answered with an error (${res.status}).` };
      }
      return { ok: true, body };
    } catch (err) {
      if (timedOut) return { ok: false, timedOut: true, reason: 'Claude took too long to answer and was stopped.' };
      if (signal?.aborted || err?.name === 'AbortError') return { ok: false, cancelled: true, reason: 'Cancelled.' };
      return { ok: false, reason: 'Could not reach this website’s server.' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onCancel);
    }
  }
  async function status({ signal } = {}) {
    const r = await call(CLAUDE_API, { method: 'GET' }, { signal, timeoutMs: 15000 });
    if (r.ok) last = r.body;
    return r.ok ? { ok: true, status: r.body } : r;
  }
  async function listModels({ signal } = {}) {
    const r = await status({ signal });
    if (!r.ok) return { ok: false, models: [], reason: r.reason, cancelled: r.cancelled };
    if (!r.status?.key_set) return { ok: false, models: [], reason: claudeStatusLine(r.status) };
    return { ok: true, models: [r.status.chat_model] };
  }
  async function resolveModel(_preferred = '', { signal } = {}) {
    const l = await listModels({ signal });
    if (!l.ok) return { ok: false, model: null, models: [], reason: l.reason, cancelled: l.cancelled };
    return { ok: true, model: l.models[0], models: l.models, fellBack: false };
  }
  /** One reply. `actions` (the allow-list, from createGuideChat) go to the server as tools. */
  async function chat(messages, { maxTokens = 0, signal, timeoutMs: t, actions = [] } = {}) {
    const started = Date.now();
    const list = (Array.isArray(actions) ? actions : []).map((a) => ({ name: String(a?.name || ''), args: String(a?.args || ''), help: String(a?.help || '') }));
    const body = { messages: (Array.isArray(messages) ? messages : []).map((m) => ({ role: m?.role, content: m?.content })),
      actions: list, ...(Number(maxTokens) > 0 ? { max_tokens: Math.floor(Number(maxTokens)) } : {}) };
    const r = await call(`${CLAUDE_API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }, { signal, timeoutMs: t });
    if (!r.ok) return { ...r, ms: Date.now() - started };
    const b = r.body || {};
    if (!b.ok) return { ok: false, reason: b.reason || 'Claude did not answer.', refusal: !!b.refusal, ms: Date.now() - started };
    return { ok: true, text: String(b.text || ''), model: b.model || null, ms: Date.now() - started, truncated: !!b.truncated,
      spentToday: b.spent_today_usd, cap: b.daily_cap_usd };
  }
  return {
    backend: 'claude',
    settings: () => ({ backend: 'claude', baseUrl: '', model: last?.chat_model || '' }),
    setSettings: () => ({ backend: 'claude', baseUrl: '', model: last?.chat_model || '' }),
    hasKey: () => false,
    setKey: () => false,
    status,
    lastStatus: () => last,
    listModels,
    resolveModel,
    chat,
  };
}

// ---------------------------------------------------------------------------------------------------
// WHERE THE PERSON'S AI SETTINGS LIVE: their person record when the host has one (they follow them),
// else this panel's own state under `ai` (a preview, Home without a person). One shape either way.
// ---------------------------------------------------------------------------------------------------
export async function openAIStore(ctx) {
  let pid = null;
  try { pid = ctx?.personId || null; } catch { pid = null; }
  let handle = null;
  if (pid && typeof ctx?.makePersonState === 'function') {
    try { handle = ctx.makePersonState(pid, AI_STATE_KEY); } catch { handle = null; }
  }
  if (handle && typeof handle.get === 'function') {
    try { await handle.load?.(); } catch { /* offline: what is cached */ }
    return {
      kind: 'person',
      get: () => { try { return handle.get() || {}; } catch { return {}; } },
      set: (patch) => { try { handle.set(patch); } catch (err) { console.error('nimrod-ai: save', err); } },
      destroy: () => { try { handle.flush?.(); } catch { /* gone */ } try { handle.destroy?.(); } catch { /* gone */ } },
    };
  }
  const st = ctx?.state || null;
  const own = () => { try { const a = st?.get?.()?.ai; return a && typeof a === 'object' ? a : {}; } catch { return {}; } };
  return {
    kind: st ? 'panel' : 'memory',
    get: own,
    set: (patch) => { try { st?.set?.({ ai: { ...own(), ...patch } }); } catch (err) { console.error('nimrod-ai: save', err); } },
    destroy: () => {},
  };
}

// ---------------------------------------------------------------------------------------------------
// THE ACTIONS. A spec: { name, args, help, check(arg, env) -> value | null, describe(value, env), run(value, env) }.
// `env` is the host's: { nodes, go(id), back(), publish(topic, payload), addNote(text), knownTypes? }.
// The built-in set is SAFE: it moves the guide and opens pages; nothing is changed or deleted.
// ---------------------------------------------------------------------------------------------------
const TAB_WORDS = { sound: 'audio', audio: 'audio', display: 'display', devices: 'devices', device: 'devices',
  people: 'people', screen: 'screen', 'this-screen': 'screen', module: 'module', panel: 'module' };
const TAB_LABELS = { module: 'this panel', audio: 'Sound', display: 'Display', devices: 'Devices', people: 'People', screen: 'This screen' };
const PAGE_LABELS = { 'sc-theme': 'the themes', 'sc-mode': 'the game and learning settings', 'sc-device': 'this device' };

function findNode(arg, nodes) {
  const a = String(arg || '').trim();
  if (!a) return null;
  if (nodes[a]) return a;
  const low = a.toLowerCase().replace(/^["“']|["”']$/g, '');
  const hit = Object.values(nodes).find((n) => n.id.toLowerCase() === low || n.title.toLowerCase() === low);
  return hit ? hit.id : null;
}

export const BUILTIN_ACTIONS = Object.freeze([
  Object.freeze({
    name: 'go', args: '<place id>', help: 'move the guide to that place',
    check: (arg, env) => findNode(arg, env?.nodes || GUIDE_NODES),
    describe: (id, env) => `Go to “${(env?.nodes || GUIDE_NODES)[id]?.title || id}”`,
    run: (id, env) => env?.go?.(id),
  }),
  Object.freeze({
    name: 'back', args: '', help: 'the guide goes back one step',
    check: () => '',
    describe: () => 'Go back one step',
    run: (_, env) => env?.back?.(),
  }),
  Object.freeze({
    name: 'tab', args: `<${MENU_TAB_IDS.join('|')}>`, help: 'open the settings menu on that tab',
    check: (arg) => { const t = TAB_WORDS[String(arg || '').trim().toLowerCase().replace(/\s+/g, '-')] || null; return t && MENU_TAB_IDS.includes(t) ? t : null; },
    describe: (tab) => `Open the settings menu on ${TAB_LABELS[tab] || tab}`,
    run: (tab, env) => env?.publish?.(GUIDE_TOPICS.menuTab, { tab }),
  }),
  Object.freeze({
    name: 'page', args: `<${SETTINGS_PAGES.join('|')}>`, help: 'show that page in the settings panel',
    check: (arg, env) => {
      const p = String(arg || '').trim();
      if (SETTINGS_PAGES.includes(p)) return p;
      if (/^type:[a-z0-9_-]+$/i.test(p) && (!env?.knownTypes || env.knownTypes.has(p.slice(5)))) return p;
      return null;
    },
    describe: (page) => `Show ${PAGE_LABELS[page] || (page.startsWith('type:') ? `the ${page.slice(5)} settings` : page)} in the settings panel`,
    run: (page, env) => env?.publish?.(GUIDE_TOPICS.settingsPage, { page }),
  }),
  Object.freeze({
    name: 'note', args: '<a short line>', help: 'add a line to the notes being made of this conversation',
    check: (arg) => { const t = String(arg || '').replace(/\s+/g, ' ').trim(); return t && t.length <= 500 ? t : null; },
    describe: (t) => `Add to the notes: “${t.length > 80 ? `${t.slice(0, 77)}…` : t}”`,
    run: (t, env) => env?.addNote?.(t),
  }),
]);

// *** THE HOOK FOR LATER (room building by voice). *** A module that can do something safely registers
// it here, and from then on the AI is told about it and may ask for it — through the same press-to-
// confirm queue. Nothing is registered yet beyond the built-ins. Returns an unregister function.
const extraActions = new Map();
const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
export function registerAIAction(spec) {
  if (!spec || !NAME_RE.test(spec.name || '') || ['check', 'describe', 'run'].some((k) => typeof spec[k] !== 'function')) {
    throw new Error('registerAIAction: { name, check, describe, run } are required');
  }
  if (BUILTIN_ACTIONS.some((b) => b.name === spec.name)) throw new Error(`registerAIAction: "${spec.name}" is built in`);
  const s = Object.freeze({ args: '', help: '', ...spec });
  extraActions.set(s.name, s);
  return () => { if (extraActions.get(s.name) === s) extraActions.delete(s.name); };
}
/** The allow-list right now: built-ins, then anything registered. */
export function allowedActions() { return [...BUILTIN_ACTIONS, ...extraActions.values()]; }

// `[[name arg...]]`, anywhere in the reply. At most MAX_ACTIONS a reply (a model in a loop is not a plan).
export const MAX_ACTIONS = 3;
const ACTION_RE = /\[\[\s*([a-z][a-z0-9-]*)(?:\s*[:\s]\s*([^\]]*?))?\s*\]\]/gi;

/**
 * A reply, read: `{ say, actions: [{ name, value, label }], ignored: [raw] }`. `say` is the reply with
 * every [[...]] taken out. An unknown name, a bad argument or one past MAX_ACTIONS goes to `ignored`.
 */
export function parseReply(text, { actions = allowedActions(), env = {} } = {}) {
  const raw = String(text || '');
  const out = [];
  const ignored = [];
  const byName = new Map(actions.map((a) => [a.name, a]));
  for (const m of raw.matchAll(ACTION_RE)) {
    const spec = byName.get(m[1].toLowerCase());
    let value = null;
    if (spec) { try { value = spec.check(m[2] ?? '', env); } catch { value = null; } }
    if (!spec || value == null || out.length >= MAX_ACTIONS) { ignored.push(m[0]); continue; }
    let label = spec.name;
    try { label = spec.describe(value, env) || spec.name; } catch { /* the name will do */ }
    out.push({ name: spec.name, value, label });
  }
  const say = raw.replace(ACTION_RE, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { say, actions: out, ignored };
}

/**
 * THE QUEUE: what the AI asked for, held until a press. `propose` replaces whatever was waiting (a stale
 * request is not kept for a later press to fire by surprise). With `actFreely()` true they run at once.
 * Every run re-checks the action against the allow-list first.
 */
export function createActionQueue({ actions = () => allowedActions(), env = () => ({}), actFreely = () => false, onChange = null } = {}) {
  let pending = [];
  let seq = 0;
  const changed = () => { try { onChange?.(); } catch (err) { console.error('nimrod-ai: queue', err); } };
  function run(a) {
    const spec = (typeof actions === 'function' ? actions() : actions).find((s) => s.name === a.name);
    if (!spec) return false;
    const e = env();
    let v = null;
    try { v = spec.check(String(a.value ?? ''), e); } catch { v = null; }
    if (v == null) return false;
    try { spec.run(v, e); return true; } catch (err) { console.error(`nimrod-ai: ${a.name}`, err); return false; }
  }
  return {
    propose(list) {
      pending = [];
      const ran = [];
      const items = (Array.isArray(list) ? list : []).slice(0, MAX_ACTIONS);
      if (actFreely()) { for (const a of items) if (run(a)) ran.push(a); }
      else pending = items.map((a) => ({ ...a, id: `act-${++seq}` }));
      changed();
      return { ran, pending: [...pending] };
    },
    confirm(id) {
      const i = pending.findIndex((a) => a.id === id);
      if (i < 0) return false;
      const [a] = pending.splice(i, 1);
      const ok = run(a);
      changed();
      return ok;
    },
    dismiss(id) {
      const before = pending.length;
      pending = id == null ? [] : pending.filter((a) => a.id !== id);
      if (pending.length !== before) changed();
    },
    pending: () => [...pending],
  };
}

// ---------------------------------------------------------------------------------------------------
// THE PROMPT. The guide's place goes in every time: the AI tours WITH the tree, not instead of it.
// ---------------------------------------------------------------------------------------------------
export const DEFAULT_PERSONA = 'You are a patient, cheerful guide. You help people find their way around this '
  + 'website and set things up the way they like. When you do not know something, you say so.';

export function systemPrompt({ prefs = aiPrefs({}), node = GUIDE_NODES[GUIDE_ROOT], nodes = GUIDE_NODES,
                               actions = allowedActions(), intro = null } = {}) {
  const p = aiPrefs(prefs);
  const say = node ? (node.id === GUIDE_ROOT ? introFor(intro) : node.say) : '';
  const choices = (node?.choices || []).map((c) => `  ${c.key || '-'}. ${c.label} -> ${c.to}`).join('\n');
  const places = Object.values(nodes).map((n) => `  ${n.id}: ${n.title}`).join('\n');
  const acts = actions.map((a) => `  [[${a.name}${a.args ? ` ${a.args}` : ''}]]  ${a.help}`).join('\n');
  const how = p.actFreely
    ? 'The person has chosen to let these happen straight away, so only ask for one when they want it.'
    : 'The person sees each request as a button and presses it to allow it. Nothing happens unless they do.';
  return [
    `Your name is ${p.name}. ${p.persona || DEFAULT_PERSONA}`,
    'You live in the guide panel of the Nimrod website, a site of dashboards made of modules (pictures, '
      + 'games, music, settings and more). You are talking with the person using it. They may be speaking '
      + 'out loud, so their words can be mis-heard: if something makes no sense, ask.',
    'Keep every reply short: two or three plain sentences. Your replies may be read aloud.',
    '',
    `Where the guide is now: "${node?.title || ''}" (${node?.id || ''}). The guide says there: ${say}`,
    choices ? `Its choices:\n${choices}` : '',
    `Every place in the guide (id: title):\n${places}`,
    '',
    'You can ask the screen to do these things. Write each request on its own line at the END of your reply, '
      + `exactly in double square brackets. ${how}`,
    acts,
    `Use only these, at most ${MAX_ACTIONS} in a reply. Never invent another.`,
  ].filter((l) => l !== null).join('\n');
}

// ---------------------------------------------------------------------------------------------------
// THE CONVERSATION. In memory only: nothing is written anywhere until the person makes a note (argued:
// a conversation is not kept unless somebody chooses to keep it).
// ---------------------------------------------------------------------------------------------------
export const KEEP_TURNS = 12;     // turns sent with each message: a small local model's window is small
export const REPLY_TOKENS = 400;  // a reply that is read aloud should be short; this stops a runaway

export function createGuideChat({ ai, prefs = () => aiPrefs({}), context = () => ({}), actions = () => allowedActions(),
                                  model = () => '', now = () => Date.now(), system = null } = {}) {
  // `system({ prefs, actions, context })`: a caller's own system prompt (an AI character's, ai_characters.js via
  // modules/profile.js). Absent, or returning nothing, it is Nimrod the guide's.
  const log = [];   // { role: 'user'|'assistant', text, raw?, at, failed? }
  let busy = false;
  async function send(text, { signal } = {}) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!t) return { ok: false, reason: 'Nothing to send.' };
    if (!ai || typeof ai.chat !== 'function') return { ok: false, noAI: true, reason: 'No AI is connected.' };
    log.push({ role: 'user', text: t, at: now() });
    const c = context() || {};
    const list = typeof actions === 'function' ? actions() : actions;
    const msgs = [
      { role: 'system', content: (typeof system === 'function' && system({ prefs: prefs(), actions: list, context: c }))
        || systemPrompt({ prefs: prefs(), node: c.node, nodes: c.nodes || GUIDE_NODES, actions: list, intro: c.intro }) },
      ...log.filter((m) => !m.failed).slice(-KEEP_TURNS * 2).map((m) => ({ role: m.role, content: m.raw ?? m.text })),
    ];
    busy = true;
    let r;
    // `actions`: the allow-list as data. ai.js ignores it (its models read the [[lines]] in the prompt);
    // "Claude, on this account" sends it to the server, which offers each one as a strict tool.
    const acts = list.map((a) => ({ name: a.name, args: a.args || '', help: a.help || '' }));
    try { r = await ai.chat(msgs, { model: model() || '', temperature: 0.4, maxTokens: REPLY_TOKENS, signal, actions: acts }); }
    catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
    finally { busy = false; }
    if (!r || !r.ok) {
      log[log.length - 1].failed = true;
      return { ok: false, reason: r?.reason || 'The AI did not answer.', cancelled: !!r?.cancelled };
    }
    const p = parseReply(r.text, { actions: list, env: c.env || { nodes: c.nodes || GUIDE_NODES } });
    const say = p.say || (p.actions.length ? 'Here is what I can do.' : '…');
    log.push({ role: 'assistant', text: say, raw: r.text, at: now() });
    return { ok: true, say, actions: p.actions, ignored: p.ignored, model: r.model || null };
  }
  return {
    send,
    log: () => log.map((m) => ({ ...m })),
    get busy() { return busy; },
    clear() { log.length = 0; },
  };
}

// Spoken answers to a waiting action, while the chat is listening. Whole utterance only.
export const YES_WORDS = Object.freeze(['yes', 'yes please', 'do it', 'go ahead', 'ok do it', 'okay do it']);
export const NO_WORDS = Object.freeze(['no', 'no thanks', 'no thank you', 'not now', 'cancel', 'don\'t']);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const isYes = (s) => YES_WORDS.includes(norm(s));
export const isNo = (s) => NO_WORDS.includes(norm(s));
