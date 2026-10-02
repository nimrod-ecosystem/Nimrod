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
    try { r = await ai.chat(msgs, { model: model() || '', temperature: 0.4, maxTokens: REPLY_TOKENS, signal }); }
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
