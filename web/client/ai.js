// ai.js — THE ONE OpenAI-COMPATIBLE ADAPTER. Several backends, one config line.
//
// The project's long-view rule (CLAUDE.md, decided 2026-06-20, revised 2026-08-28): "ONE
// OpenAI-compatible adapter, several backends. Keep the adapter thin enough that the backend is
// one config line" — and for anyone but Mike, the default must cost Mike nothing: bring-your-own-
// key, a local model, or a free endpoint. So this speaks only the OpenAI chat API that Ollama,
// llama.cpp's server, LM Studio, vLLM and the paid services all serve (`GET /models`,
// `POST /chat/completions`), and the backend is `baseUrl`. Nothing here is Ollama-specific except
// the DEFAULT address and the wording of one failure message.
//
// PER DEVICE, NOT PER PROFILE. The model server is the machine in front of you: a Pi and a desktop
// with a graphics card have different models on them, so `{ baseUrl, model }` lives in this
// browser's localStorage under ONE key (`AI_SETTINGS_KEY`), read and written inside try/catch —
// a private window or blocked storage reads as the defaults, never a throw. `model: ''` means
// "choose automatically from what this server has" (`pickModel`).
//
// NO API KEY IN THIS PASS. A bring-your-own-key endpoint needs somewhere safe to keep the key and
// a decision about whether it may ever leave the device; that is later work, not an empty field
// here. No Authorization header is sent.
//
// ERRORS ARE A PLAIN REASON STRING, never a throw into a module: every call resolves to
// `{ ok: true, ... }` or `{ ok: false, reason, cancelled?, timedOut? }`, the reason in words a
// non-programmer can follow (`explainFailure`).
//
// NOTHING HERE CALLS THE MODEL SERVER ON ITS OWN. A caller asks. `modules/lessons.js` only asks
// when somebody opens its transcript panel — a page that reached for a local address on every
// mount would fill the console on the live site and, in browsers that gate local-network access,
// could put a permission prompt on a screen nobody is there to answer.

export const AI_SETTINGS_KEY = 'nimrod.ai.device';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';     // Ollama's OpenAI-compatible API
// A 7B model on a CPU-only desktop can take minutes to write a set of questions, so the default
// is generous; every call can pass its own (`modules/lessons.js` exposes it as a setting).
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 15 * 1000;

// ---------------------------------------------------------------------------------------------
// per-device settings
// ---------------------------------------------------------------------------------------------

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

function cleanBaseUrl(v) {
  const s = typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

export function readAISettings(storage = defaultStorage()) {
  let raw = null;
  try { raw = storage ? JSON.parse(storage.getItem(AI_SETTINGS_KEY) || 'null') : null; } catch { raw = null; }
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    baseUrl: cleanBaseUrl(o.baseUrl) || DEFAULT_BASE_URL,
    model: typeof o.model === 'string' ? o.model.trim() : '',
  };
}

export function writeAISettings(patch = {}, storage = defaultStorage()) {
  const next = { ...readAISettings(storage) };
  if ('baseUrl' in patch) next.baseUrl = cleanBaseUrl(patch.baseUrl) || DEFAULT_BASE_URL;
  if ('model' in patch) next.model = typeof patch.model === 'string' ? patch.model.trim() : '';
  try { storage?.setItem(AI_SETTINGS_KEY, JSON.stringify(next)); } catch { /* read-only storage: keep defaults */ }
  return next;
}

// ---------------------------------------------------------------------------------------------
// choosing a model
// ---------------------------------------------------------------------------------------------

// Not chat models: embedding, reranking and speech models answer /models too.
const NOT_CHAT = /embed|rerank|whisper|tts|bge-|minilm/i;
export const isChatModel = (id) => typeof id === 'string' && !!id && !NOT_CHAT.test(id);

/** Parameter count in billions from a name ("qwen2.5:7b" -> 7, "smollm:135m" -> 0.135), or null. */
export function modelSize(id) {
  const m = /(?:^|[:\-_/])(?:\d+x)?(\d+(?:\.\d+)?)([bm])(?=$|[:\-_.])/i.exec(String(id || ''));
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'm' ? n / 1000 : n;
}

/**
 * The default model from a server's list, or null.
 *
 * THE RULE, argued (a default — the Lessons menu and this device's saved `model` both override it):
 *   1. NEVER an embedding/speech model — they are listed beside chat models and cannot write.
 *   2. A name that says instruct/chat outranks one that doesn't; a name that says base/text ranks
 *      last. (Ollama's default tags are instruct models without saying so — "qwen2.5:7b" — so
 *      this only matters when a list mixes the two.)
 *   3. Then the LARGER model. The deterministic check throws away every question whose answer is
 *      not in its quoted line, and smaller models fail it more often; a rejected question costs a
 *      regenerate, which costs more time than the bigger model's slower first try. On this
 *      desktop's list that picks qwen2.5:7b over qwen2.5:3b. The cost is speed on a slow device —
 *      a Pi should choose the small one, which is why this is per device and overridable.
 *   4. Ties: alphabetical, so the pick is stable.
 */
export function pickModel(ids) {
  const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id && !NOT_CHAT.test(id));
  if (!list.length) return null;
  const score = (id) => [
    /instruct|chat/i.test(id) ? 1 : 0,
    /(?:^|[:\-_])(base|text)(?:$|[:\-_])/i.test(id) ? 0 : 1,
    modelSize(id) ?? -1,
  ];
  return [...list].sort((a, b) => {
    const sa = score(a); const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return a.localeCompare(b);
  })[0];
}

// ---------------------------------------------------------------------------------------------
// failures, in words
// ---------------------------------------------------------------------------------------------

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(o || ''));

/**
 * A failure as a sentence somebody who is not a programmer can act on. `kind`:
 *   'forbidden'  the server answered 403 — it is running but refuses this website
 *   'network'    no answer at all. A browser reports "not running" and "refused this website" the
 *                SAME way (a blocked cross-site request looks like no answer), so from a page that
 *                is not on this computer it names both.
 *   'timeout' | 'cancelled' | 'http' (status, message) | 'unreadable' | 'nomodel'
 * It names the setting for whoever looks after the computer; it does not tell anybody to run a
 * command on the machine in front of them.
 */
export function explainFailure({ kind, status, message, baseUrl = DEFAULT_BASE_URL, pageOrigin = '', timeoutMs } = {}) {
  const site = pageOrigin || 'this website';
  const notAllowed = `The AI program at ${baseUrl} has not been told to accept requests from ${site}. `
    + 'Whoever looks after this computer can add this website to the AI program\'s allowed websites '
    + '(Ollama calls this setting OLLAMA_ORIGINS) and then restart it.';
  switch (kind) {
    case 'forbidden':
      return `The AI program is running, but it said no. ${notAllowed}`;
    case 'network':
      if (isLocalOrigin(pageOrigin)) {
        return `Could not reach the AI program at ${baseUrl}. It may not be running on this computer, `
          + 'or the address in the AI settings may be wrong.';
      }
      return `Could not reach the AI program at ${baseUrl}. Either it is not running on this computer, `
        + `or it is running but ${notAllowed.charAt(0).toLowerCase()}${notAllowed.slice(1)}`;
    case 'timeout': {
      const mins = Math.max(1, Math.round((Number(timeoutMs) || DEFAULT_TIMEOUT_MS) / 60000));
      return `The model took longer than ${mins} minute${mins === 1 ? '' : 's'} and was stopped. `
        + 'A smaller model, or a shorter transcript, will be quicker.';
    }
    case 'cancelled':
      return 'Cancelled.';
    case 'http':
      return `The AI program answered with an error (${status || '?'})${message ? `: ${message}` : ''}.`;
    case 'unreadable':
      return 'The AI program answered, but its answer could not be read.';
    case 'nomodel':
      return 'The AI program has no model that can write text installed (only models that cannot, '
        + 'such as embedding models). Whoever looks after this computer can add one.';
    default:
      return 'Something went wrong talking to the AI program.';
  }
}

async function errorMessage(res) {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const m = j && (typeof j.error === 'string' ? j.error : j.error && j.error.message);
      if (m) return String(m).slice(0, 300);
    } catch { /* not JSON */ }
    return String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch { return ''; }
}

// ---------------------------------------------------------------------------------------------
// the client
// ---------------------------------------------------------------------------------------------

/**
 * `fetchImpl` and `storage` are injectable for tests. `pageOrigin` is only used in messages.
 */
export function createAI({ fetchImpl = (...a) => fetch(...a), storage = defaultStorage(),
                           timeoutMs = DEFAULT_TIMEOUT_MS, pageOrigin = globalThis.location?.origin || '' } = {}) {
  const settings = () => readAISettings(storage);

  // One request with a timeout AND an outside Cancel. Resolves `{ ok, res }` or `{ ok:false, ... }`.
  async function request(url, init, { signal, timeoutMs: t } = {}) {
    const limit = Number(t) > 0 ? Number(t) : timeoutMs;
    const base = settings().baseUrl;
    if (signal?.aborted) return { ok: false, cancelled: true, reason: explainFailure({ kind: 'cancelled' }) };
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, limit);
    const onCancel = () => ctl.abort();
    signal?.addEventListener?.('abort', onCancel);
    try {
      // credentials 'omit': the server address comes from this device's storage, so never send the
      // site's cookies with it, even if it points somewhere unexpected.
      const res = await fetchImpl(url, { ...init, credentials: 'omit', signal: ctl.signal });
      if (res.status === 403) {
        return { ok: false, status: 403, reason: explainFailure({ kind: 'forbidden', baseUrl: base, pageOrigin }) };
      }
      if (!res.ok) {
        return { ok: false, status: res.status,
          reason: explainFailure({ kind: 'http', status: res.status, message: await errorMessage(res) }) };
      }
      let body;
      try { body = await res.json(); } catch {
        if (timedOut) return { ok: false, timedOut: true, reason: explainFailure({ kind: 'timeout', timeoutMs: limit }) };
        if (signal?.aborted) return { ok: false, cancelled: true, reason: explainFailure({ kind: 'cancelled' }) };
        return { ok: false, reason: explainFailure({ kind: 'unreadable' }) };
      }
      return { ok: true, body };
    } catch (err) {
      if (timedOut) return { ok: false, timedOut: true, reason: explainFailure({ kind: 'timeout', timeoutMs: limit }) };
      if (signal?.aborted || err?.name === 'AbortError') {
        return { ok: false, cancelled: true, reason: explainFailure({ kind: 'cancelled' }) };
      }
      return { ok: false, reason: explainFailure({ kind: 'network', baseUrl: base, pageOrigin }) };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onCancel);
    }
  }

  /** `{ ok, models: [ids], reason }`. */
  async function listModels({ signal, timeoutMs: t = LIST_TIMEOUT_MS } = {}) {
    const r = await request(`${settings().baseUrl}/models`, { method: 'GET' }, { signal, timeoutMs: t });
    if (!r.ok) return { ok: false, models: [], reason: r.reason, cancelled: r.cancelled, timedOut: r.timedOut };
    const data = r.body && Array.isArray(r.body.data) ? r.body.data : [];
    return { ok: true, models: data.map((m) => m && m.id).filter((id) => typeof id === 'string' && id) };
  }

  /**
   * The model to use: `preferred` if this server has it, else this device's saved model if the
   * server has it, else `pickModel`. `fellBack` is true when a preference was named and missing —
   * the caller should say so rather than silently use another model.
   */
  async function resolveModel(preferred = '', { signal } = {}) {
    const l = await listModels({ signal });
    if (!l.ok) return { ok: false, model: null, models: [], reason: l.reason, cancelled: l.cancelled };
    const has = (id) => !!id && l.models.includes(id) && !NOT_CHAT.test(id);
    const saved = settings().model;
    if (has(preferred)) return { ok: true, model: preferred, models: l.models, fellBack: false };
    const model = has(saved) ? saved : pickModel(l.models);
    if (!model) return { ok: false, model: null, models: l.models, reason: explainFailure({ kind: 'nomodel' }) };
    return { ok: true, model, models: l.models, fellBack: !!preferred };
  }

  /**
   * One chat completion. `{ ok, text, model, ms }` or `{ ok:false, reason, cancelled?, timedOut? }`.
   * `json: true` asks for a JSON object (`response_format`) — standard OpenAI, honoured by Ollama;
   * the caller still parses tolerantly, because not every server enforces it.
   */
  // `maxTokens` caps how long the ANSWER may be (OpenAI's `max_tokens`; Ollama honours it). Absent =
  // the server's own limit, as before. Measured 2026-09-29: asked for "as many questions as this
  // supports", qwen2.5:7b on this CPU wrote 2,000+ tokens for one 900-word piece — 15+ minutes — and
  // ran into the 4,096-token window, which cuts the answer mid-JSON.
  async function chat(messages, { model = '', json = false, temperature = 0.2, timeoutMs: t, signal, maxTokens = 0 } = {}) {
    const started = Date.now();
    let use = model;
    if (!use) {
      const m = await resolveModel('', { signal });
      if (!m.ok) return { ok: false, reason: m.reason, cancelled: m.cancelled };
      use = m.model;
    }
    const body = { model: use, messages, temperature, stream: false };
    if (json) body.response_format = { type: 'json_object' };
    if (Number(maxTokens) > 0) body.max_tokens = Math.floor(Number(maxTokens));
    const r = await request(`${settings().baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { signal, timeoutMs: t });
    if (!r.ok) return { ...r, ms: Date.now() - started };
    const text = r.body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      return { ok: false, reason: explainFailure({ kind: 'unreadable' }), ms: Date.now() - started };
    }
    return { ok: true, text, model: use, ms: Date.now() - started };
  }

  return {
    settings,
    setSettings: (patch) => writeAISettings(patch, storage),
    listModels,
    resolveModel,
    chat,
  };
}
