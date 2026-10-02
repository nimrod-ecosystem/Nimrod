// modules/nimrod.js — NIMROD, THE GUIDE: a module, type 'nimrod'. Help and wiki as a
// choose-your-own-adventure, an NPC who suggests what to do next, and Kontakt's info pane.
// AND THE AI MODULE: "Talk to <your AI>" beside the tree (nimrod_ai.js, nimrod_notes.js).
//
// Mike, 2026-10-02 (DECISIONS.md, second set, item 3): the landing Home is four up, clockwise from top
// left: pictures, settings, devices and Nimrod. "Nimrod being a new module that would pretty much be our
// equivalent of a help/wiki. Have him there to suggest things for you to do. Kind of like an NPC."
// And the same day: "The Nimrod module should probably be the AI module. You wire up whatever AI you want."
//
// The tree is DATA (nimrod_guide_data.js) and so is the walk; this file draws it and does what a node's
// acts say. What it draws, top to bottom:
//   * what he says (read aloud through `ctx.output` when "Read aloud" is on — the PERSON'S output routing
//     still decides whether `say` is speech on this screen, as for the cat);
//   * the choices (A, B, C...), then what he can do from here (open a settings tab, show a settings page,
//     the switch list), then Back, Start over, the map toggle and "Talk to <name>";
//   * the map: the tree "like a file tree", on by default (a setting), with where you are open in it;
//   * the info area: whatever the pointer, the focus or the scan cursor is on, explained (hover_info.js,
//     with cat_help.js's words) — a setting too.
//
// *** HE IS NEVER A GATE. *** Nothing here waits: he says something, offers choices, and is happy to be
// ignored for ever. No acts run by themselves except showing a page in the settings PANEL (nimrod_guide_
// data.js argues why the settings MENU never opens by itself: it would take the switch scan).
//
// *** A SWITCH DRIVES HIM like any panel: next / prev walk his buttons (Back first when there is a way
// back, so a stray select goes back rather than somewhere new), select presses, back is Back. Topics:
// GUIDE_VERB_TOPICS (the actions.js MODULE_VERBS line is the coordinator's to add). Voice reaches the same
// verbs through the router.
//
// *** WHERE YOU WERE IS KEPT (`walk` on the panel's state, not a setting): "Then it goes through whatever
// you choose whenever you chose." Leave him and come back, and he is where you left him, Back and all.
// 200 steps are kept: Back "however much you want" in practice, and a few kilobytes at most.
//
// *** THE AI SEAM: `ctx.guideText(node, info)`, when a host hands one in, is asked for his words first
// (nimrod_guide_data.js `wordsFor`); anything it cannot answer in time falls back to the tree's own words.
//
// *** TALKING TO THE AI (2026-10-02). *** A second view of the same panel: a chat with whatever AI this
// device is connected to (ai.js — local Ollama, a free endpoint, or the person's own key), typed or spoken.
//   * The AI's NAME and PERSONA are the person's (nimrod_ai.js `openAIStore`: their person record), default
//     "Nimrod". Nothing on the site names anybody's AI.
//   * It tours WITH the tree: every message carries where the guide is, and the AI may ASK to move it or
//     open a page from a small allow-list. Each request is a button; nothing runs until it is pressed, or
//     until the person said "let it act without asking" (off by default — argued in nimrod_ai.js).
//   * SPEECH, ARGUED. Options were (a) a wake phrase + "ask <name> ...", (b) everything said while the
//     panel is focused, (c) a press to start talking. (b) steals: with the wake gate turned off, "next" said
//     to a focused guide would become a chat message. (a) is hands-free but needs free text after a command,
//     which a grammar-limited recogniser cannot hear. (c) is CHOSEN: "Talk" opens a DICTATION window on the
//     speech layer (input_speech.js `dictation: true`); bare words go to the chat, the wake phrase still
//     means a command, and the window closes by itself after the person's "stop listening after" time
//     (and while the reply is being read aloud, so the screen does not answer itself). (a) is the natural
//     next step and is on Mike's list.
//   * "Make a note" reduces the conversation to a short dated note the person edits and keeps; "Copy all
//     notes" puts them on the clipboard. Nothing is sent anywhere by itself.
//   * No AI connected: it says how to connect one, and the tree works exactly as before.
//   * NOTHING CALLS THE AI ON MOUNT (ai.js's rule): only a press — opening the chat, sending, Check.

import { registerModule } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { catImageURL } from '../cat_guide.js';
import { watchHover } from '../hover_info.js';
import { createAI, DEFAULT_BASE_URL } from '../ai.js';
import {
  GUIDE_NODES, GUIDE_ROOT, GUIDE_VERB_TOPICS, createGuideNav, treeRows, wordsFor, actMessages, introFor,
} from '../nimrod_guide_data.js';
// Node A's mechanics (game / learning / sandbox, the tour's points, the settings-panel check): unlocks.js.
import { createGuideGameHook, MODE_HELP } from '../unlocks.js';
import {
  AI_SOURCE, SPEECH_TOPICS, DELIVERY_TOPIC, LISTEN_CHOICES, aiPrefs, openAIStore, isLocalAddress,
  createGuideChat, createActionQueue, allowedActions, isYes, isNo,
} from '../nimrod_ai.js';
import { draftNote, makeNote, addNote, removeNote, cleanNotes, notesToText, stamp } from '../nimrod_notes.js';

export const GUIDE_TYPE = 'nimrod';
export const GUIDE_SOURCE = 'nimrod-guide';     // `source` on everything he says, for the output log
export const WALK_KEY = 'walk';                  // where he is, on the panel's own state
export const INTRO_KEY = 'intro';                // which hello: 'landing' | 'tutorial' | absent (dashboards.js)
export const WALK_KEEP = 200;
export const INFO_IDLE = 'Point at anything and I will tell you what it does.';
// How long a hint that the screen is not listening waits for the speech layer to say it is.
const ANSWERING_WAIT_MS = 800;

// The three settings, each a person's choice (Rule 1), each argued:
//   tree   ON: Mike, "an optional view of it like a file tree that is on by default".
//   hover  ON: the feature he asked for; off for somebody who finds words changing as the mouse moves busy.
//   speak  ON: the cat's argued default (cat_guide.js `speak`) — somebody who cannot read the box hears him.
//          The person's output routing still decides whether `say` becomes speech. The AI's replies follow it.
export const GUIDE_SETTINGS = Object.freeze([
  { key: 'tree', label: 'Show the map of where you are', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes — like a file tree', offLabel: 'No',
    help: 'A tree of everything Nimrod can show you, open at the place you are.' },
  { key: 'hover', label: 'Explain what the pointer is on', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No',
    help: 'Point at anything, or scan to it, and Nimrod says what it does in the box at his bottom.' },
  { key: 'speak', label: 'Nimrod reads aloud', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No — words only',
    help: 'His words also go to the screen’s voice, if this screen speaks.' },
]);
const FIELDS = GUIDE_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);
export function guidePrefs(values = {}) {
  const out = {};
  for (const f of FIELDS) out[f.key] = fieldValue(f, values || {});
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstSentence = (s) => (String(s || '').match(/^[^.!?]*[.!?]/) || [String(s || '')])[0].trim();
const listenLabel = (ms) => (ms >= 60000 ? `${ms / 60000} minute${ms === 60000 ? '' : 's'}` : `${ms / 1000} seconds`);

/** What to tell somebody with no AI connected: the three ways, in plain words. */
export function connectHelp(name, reason = '') {
  return `${reason ? `${reason} ` : ''}The guide works without one. To talk to ${name}, connect an AI in “About ${name}”:`
    + ` free on this computer with Ollama (ollama.com: download a model such as qwen2.5:3b, and let this website use it`
    + ` with Ollama’s OLLAMA_ORIGINS setting; the address is ${DEFAULT_BASE_URL});`
    + ' or any online service that speaks the OpenAI API, free or with your own key (its address, a model name and the key;'
    + ' the key stays in this browser and goes only to that address). Nothing is sent anywhere until you talk.';
}

// Every colour is a theme token. Sizes are in rem so the person's own text size carries.
const STYLE = `
.ng-root{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;
  color:var(--text);font:inherit}
.ng-head{display:flex;align-items:center;gap:10px}
.ng-head img{width:56px;height:56px;flex:0 0 auto}
.ng-head b{font-size:1.1rem}
.ng-where{color:var(--text-muted)}
.ng-say{margin:0;line-height:1.45}
.ng-btns{display:flex;flex-wrap:wrap;gap:8px}
.ng-btn{min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer;text-align:left}
.ng-btn[disabled]{opacity:.5;cursor:default}
.ng-btn.ng-choice{flex:1 1 100%}
.ng-btn.ng-act{background:var(--surface-alt)}
.ng-btn[aria-pressed="true"]{background:var(--surface-alt);font-weight:700}
.ng-btn.is-scan,.ng-btn:focus-visible{outline:3px solid var(--highlight);outline-offset:2px}
.ng-key{font-weight:700;margin-right:6px}
.ng-tree{margin:0;padding:8px 0 0;list-style:none;border-top:1px solid var(--border)}
.ng-tree li button{background:none;border:0;color:var(--text);font:inherit;cursor:pointer;padding:3px 0;text-align:left;min-height:32px}
.ng-tree li[aria-current="true"] button{font-weight:700;color:var(--text-strong)}
.ng-info{margin-top:auto;padding:8px 10px;border-radius:10px;background:var(--surface-alt);color:var(--text);min-height:3em}
.ng-info b{margin-right:4px}
.ng-card,.ng-help,.ng-pend,.ng-box{padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface)}
.ng-status{margin:0;color:var(--text-muted)}
.ng-log{display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto}
.ng-msg{margin:0;padding:6px 10px;border-radius:10px;line-height:1.4;background:var(--surface)}
.ng-msg.is-user{align-self:flex-end;background:var(--surface-alt)}
.ng-msg.is-failed{opacity:.6}
.ng-msg b{margin-right:4px}
.ng-row{display:flex;gap:8px;align-items:stretch}
.ng-row input,.ng-box input,.ng-box textarea,.ng-draft textarea,.ng-export{flex:1 1 auto;min-height:44px;box-sizing:border-box;
  padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;width:100%}
.ng-box label{display:block;margin:6px 0 2px;color:var(--text-muted)}
.ng-box textarea,.ng-draft textarea{min-height:6em}
.ng-notes{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.ng-notes li{padding:6px 10px;border-radius:10px;background:var(--surface);white-space:pre-wrap}
.ng-notes small{color:var(--text-muted)}
`;

registerModule(
  { type: GUIDE_TYPE, title: 'Nimrod', core: 'new', dependsOn: 'none', importance: 'normal',
    description: 'Nimrod the guide: what everything does, and what to try next, as choices you can walk back through — or talk it over with your own AI',
    settings: GUIDE_SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    const nav = createGuideNav();
    let root = null;
    let prefs = guidePrefs({});
    let intro = null;
    let saidId = null;
    let cursor = 0;            // the scan cursor, an index into stops()
    let hover = null;
    let offState = null;
    const offs = [];
    let torn = false;
    let words = '';            // what he is saying now (the tree's, or the AI seam's)
    let lastInfo = null;       // what the info area last explained
    let game = null;           // unlocks.js createGuideGameHook: null in a preview with no profile makers

    // ---- the AI side (only woken by a press) -------------------------------------------------------
    let view = 'guide';        // 'guide' | 'talk'
    let aiClient = null;
    const ai = () => aiClient || (aiClient = ctx.ai || createAI());
    let store = null;          // nimrod_ai.js openAIStore: the person's AI settings and notes
    let storeOpening = null;
    let aiP = aiPrefs({});
    let notes = [];
    // { state: 'unchecked'|'checking'|'ok'|'none'|'needs-model', model, reason }
    let status = { state: 'unchecked', model: '', reason: '' };
    let thinking = false;
    let inflight = null;       // AbortController of the message being answered
    let sendChain = Promise.resolve();
    let listening = false;
    let listenHint = '';
    let heardAnswering = false;
    let idleTimer = null;
    let hintTimer = null;
    let holding = false;       // the reply is being read aloud: the dictation window is shut meanwhile
    let holdTimer = null;
    let aiSaidId = null;
    let draft = null;          // { busy } | { text, reason, fromAI }
    let setupOpen = false;
    let exportText = '';
    let notice = '';           // a one-line result (saved, copied...)
    const pending = () => queue.pending();

    const stateGet = () => { try { return ctx.state?.get?.() || {}; } catch { return {}; } };
    const stateSet = (patch) => { try { ctx.state?.set?.(patch); } catch { /* a preview with no state */ } };

    function publish(topic, payload) {
      try { ctx.bus?.publish?.(topic, payload); } catch (err) { console.error('nimrod: publish', err); }
    }
    function speak(text) {
      if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* already said */ } }
      saidId = null;
      if (!prefs.speak || !text || typeof ctx.output?.say !== 'function') return;
      try { saidId = ctx.output.say(text, { source: GUIDE_SOURCE }); } catch (err) { console.error('nimrod: say', err); }
    }
    function runAct(a) {
      for (const m of actMessages(a)) publish(m.topic, m.payload);
      if (a?.kind === 'game-mode') game?.act(a);
    }
    // What the game hook has to say (a mode turned on, a step paid, no settings panel here): added to his
    // words, and said. A note about a step he has already left is dropped.
    function gameNote(text, nodeId) {
      if (torn || !text || (nodeId && nodeId !== nav.id())) return;
      words = `${words} ${text}`;
      render();
      speak(text);
    }

    /** Arrive at the current node. `forward`: by a choice or a tree row (its auto acts run); else Back. */
    async function arrive({ forward = false, quiet = false } = {}) {
      const node = nav.current();
      const own = node.id === GUIDE_ROOT ? introFor(intro) : node.say;
      words = own;
      cursor = 0;
      stateSet({ [WALK_KEY]: nav.history().slice(-WALK_KEEP) });
      render();
      // The game hook first, so the settings panel's answer to the auto acts below is counted.
      if (forward) { game?.arrive(node); for (const a of node.acts || []) if (a.auto) runAct(a); }
      if (typeof ctx.guideText === 'function') {
        const mine = node.id;
        const w = await wordsFor(node, { source: ctx.guideText, intro });
        if (torn || nav.id() !== mine) return;
        if (w !== words) { words = w; render(); }
      }
      if (!quiet) speak(words);
    }

    // ---- the actions the AI may ask for, and the queue that holds them ------------------------------
    const actionEnv = () => ({
      nodes: GUIDE_NODES,
      go: (id) => { if (nav.go(id)) arrive({ forward: true, quiet: view === 'talk' }); },
      back: () => { if (nav.canBack()) { nav.back(1); arrive({ quiet: view === 'talk' }); } },
      publish,
      addNote: (t) => {
        const ta = root?.querySelector('[data-ng-field="draft"]');
        if (ta && draft && !draft.busy) draft.text = ta.value;
        const line = `- ${t}`;
        draft = draft && !draft.busy ? { ...draft, text: `${draft.text ? `${draft.text}\n` : ''}${line}` } : { text: line, fromAI: false };
        if (ta) ta.value = draft.text;
        render();
      },
    });
    const queue = createActionQueue({ actions: () => allowedActions(), env: actionEnv, actFreely: () => aiP.actFreely,
      onChange: () => render() });
    const chat = createGuideChat({
      ai: { chat: (...a) => ai().chat(...a) },
      prefs: () => aiP,
      context: () => ({ node: nav.current(), nodes: GUIDE_NODES, intro, env: actionEnv() }),
      model: () => status.model,
    });

    // The person's record once there is a person; until then (a host still resolving who is here) the
    // panel's own state stands in and the person's is tried again on the next press.
    const hasPersonStore = () => typeof ctx.makePersonState === 'function';
    async function ensureStore() {
      if (store && (store.kind === 'person' || !hasPersonStore())) return store;
      if (!storeOpening) {
        storeOpening = openAIStore(ctx).then((s) => {
          if (torn) { s.destroy(); return s; }
          if (store && store !== s) { try { store.destroy(); } catch { /* gone */ } }
          store = s;
          const v = s.get() || {};
          aiP = aiPrefs(v);
          notes = cleanNotes(v.notes);
          if (s.kind !== 'person' && hasPersonStore()) storeOpening = null;
          return s;
        }).catch((err) => { storeOpening = null; throw err; });
      }
      return storeOpening;
    }
    function saveAI(patch) {
      store?.set(patch);
      aiP = aiPrefs({ ...aiP, ...patch });
    }

    async function checkStatus() {
      status = { ...status, state: 'checking', reason: '' };
      render();
      let s;
      try { s = ai().settings(); } catch { s = { baseUrl: DEFAULT_BASE_URL, model: '' }; }
      // A remote address is never given a model by itself: its list can hold paid models, and picking
      // the biggest (ai.js pickModel) could spend somebody's money without them choosing it.
      if (!isLocalAddress(s.baseUrl) && !s.model) {
        status = { state: 'needs-model', model: '', reason: `Name the model to use at ${s.baseUrl} in “About ${aiP.name}”.` };
        render();
        return status;
      }
      let r;
      try { r = await ai().resolveModel(s.model || ''); } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
      if (torn) return status;
      if (!r?.ok) status = { state: 'none', model: '', reason: r?.reason || 'The AI did not answer.' };
      else if (r.fellBack && !isLocalAddress(s.baseUrl)) status = { state: 'needs-model', model: '', reason: `That service has no model called “${s.model}”.` };
      else status = { state: 'ok', model: r.model, reason: r.fellBack ? `“${s.model}” is not on this computer, so ${r.model} is answering.` : '' };
      render();
      return status;
    }

    function hostOf(url) { try { return new URL(url).host; } catch { return String(url || ''); } }
    function statusText() {
      const n = aiP.name;
      switch (status.state) {
        case 'checking': return `Looking for ${n}’s AI…`;
        case 'ok': {
          let s; try { s = ai().settings(); } catch { s = {}; }
          return `Connected: ${status.model} at ${hostOf(s.baseUrl)}.${status.reason ? ` ${status.reason}` : ''}`;
        }
        case 'needs-model': return status.reason;
        case 'none': return `No AI is answering. ${status.reason}`;
        default: return 'Not connected yet.';
      }
    }

    // ---- talking -------------------------------------------------------------------------------------
    function sendText(text, { spoken = false } = {}) {
      const t = String(text || '').trim();
      if (!t) return sendChain;
      sendChain = sendChain.then(() => doSend(t, { spoken })).catch((err) => console.error('nimrod: send', err));
      return sendChain;
    }
    async function doSend(t, { spoken }) {
      if (torn) return;
      await ensureStore();
      if (status.state !== 'ok') await checkStatus();
      if (torn) return;
      if (status.state !== 'ok') { notice = spoken ? `Heard “${t}”, but no AI is answering.` : ''; render(); return; }
      notice = '';
      thinking = true;
      inflight = new AbortController();
      render();
      const r = await chat.send(t, { signal: inflight.signal });
      thinking = false;
      inflight = null;
      if (torn) return;
      if (!r.ok) {
        if (!r.cancelled) { status = { ...status, state: r.noAI ? 'none' : status.state }; notice = r.reason; }
        render();
        return;
      }
      if (listening) armIdle();
      queue.propose(r.actions);     // renders
      render();
      speakReply(r.say);
    }

    function speakReply(text) {
      if (aiSaidId != null) { try { ctx.output?.cancel?.(aiSaidId); } catch { /* said */ } aiSaidId = null; }
      if (!prefs.speak || !text || typeof ctx.output?.say !== 'function') return;
      try { aiSaidId = ctx.output.say(text, { source: AI_SOURCE }); } catch (err) { console.error('nimrod: say', err); return; }
      // The screen's own voice must not be heard as the person: shut the dictation window while it
      // speaks, and open it again when the output bus says it is done (or a watchdog, if it never does).
      if (listening) {
        holding = true;
        announceGrammar();
        clearTimeout(holdTimer);
        holdTimer = setTimeout(release, Math.min(30000, 2000 + 80 * text.length));
      }
    }
    function release() {
      clearTimeout(holdTimer);
      holdTimer = null;
      if (!holding) return;
      holding = false;
      announceGrammar();
    }

    // The dictation window on the speech layer (input_speech.js `dictation: true`).
    function announceGrammar() {
      publish(SPEECH_TOPICS.grammar, { source: AI_SOURCE, instanceId: ctx.instanceId || null,
        open: listening && !holding && !torn, words: [], dictation: true, phase: 'chat' });
    }
    function armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stopListening(), aiP.listenMs);
    }
    function startListening() {
      if (listening || torn) return;
      listening = true;
      heardAnswering = false;
      listenHint = '';
      announceGrammar();
      armIdle();
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        if (!listening || heardAnswering || torn) return;
        listenHint = 'This screen is not listening for voice right now (voice commands are off in the settings menu’s '
          + 'Devices tab, or no microphone answers). You can still type.';
        render();
      }, ANSWERING_WAIT_MS);
      render();
    }
    function stopListening() {
      clearTimeout(idleTimer); clearTimeout(hintTimer); clearTimeout(holdTimer);
      idleTimer = hintTimer = holdTimer = null;
      const was = listening;
      listening = false;
      holding = false;
      listenHint = '';
      if (was) announceGrammar();
      render();
    }
    function heard(p) {
      if (!listening || !p || p.dictation !== true) return;
      const t = String(p.text || '').trim();
      if (!t) return;
      armIdle();
      const waiting = pending();
      if (waiting.length && isYes(t)) { queue.confirm(waiting[0].id); return; }
      if (waiting.length && isNo(t)) { queue.dismiss(); return; }
      sendText(t, { spoken: true });
    }

    function setView(v) {
      if (v === view) return;
      view = v;
      cursor = 0;
      if (v === 'talk') {
        render();
        ensureStore().then(() => { render(); if (status.state === 'unchecked') checkStatus(); });
      } else {
        stopListening();
        render();
      }
    }

    async function makeDraft() {
      draft = { busy: true };
      render();
      await ensureStore();
      const res = await draftNote(chat.log(), { ai: status.state === 'ok' ? ai() : null, model: status.model,
        name: aiP.name, where: nav.current().title });
      if (torn) return;
      draft = res.ok ? { text: res.text, reason: res.reason || '', fromAI: res.fromAI } : null;
      notice = res.ok ? '' : res.reason;
      render();
    }
    function saveDraft() {
      const ta = root?.querySelector('[data-ng-field="draft"]');
      const n = makeNote(ta ? ta.value : draft?.text, { where: nav.current().title });
      if (!n) { notice = 'The note is empty.'; render(); return; }
      notes = addNote(notes, n);
      store?.set({ notes });
      draft = null;
      notice = `Note saved (${notes.length} kept).`;
      render();
    }
    async function copyNotes() {
      exportText = notesToText(notes);
      let ok = false;
      try { await root?.ownerDocument?.defaultView?.navigator?.clipboard?.writeText(exportText); ok = true; } catch { ok = false; }
      notice = ok ? 'Copied. Paste it wherever you like.' : 'Select the text below and copy it.';
      render();
    }
    function saveSetup() {
      const f = (k) => root?.querySelector(`[data-ng-field="${k}"]`)?.value ?? '';
      saveAI({ name: f('name'), persona: f('persona') });
      try {
        ai().setSettings?.({ baseUrl: f('baseUrl'), model: f('model') });
        const key = f('key');
        if (key.trim()) ai().setKey?.(key);
      } catch (err) { console.error('nimrod: AI settings', err); }
      const k = root?.querySelector('[data-ng-field="key"]');
      if (k) k.value = '';
      notice = 'Saved.';
      status = { state: 'unchecked', model: '', reason: '' };
      checkStatus();
    }

    // The stops a switch walks, in order: Back first (when there is a way back), the choices, the acts,
    // Start over, the map toggle, Talk. A link is a stop too (select follows it, in a new tab).
    function stops() {
      return root ? [...root.querySelectorAll('[data-ng-stop]')].filter((b) => !b.disabled) : [];
    }
    function paintCursor() {
      const list = stops();
      for (const b of root?.querySelectorAll('.is-scan') || []) b.classList.remove('is-scan');
      if (!list.length) return;
      cursor = ((cursor % list.length) + list.length) % list.length;
      list[cursor].classList.add('is-scan');
    }

    function guideHTML(node) {
      const acts = node.acts || [];
      const choiceBtns = (node.choices || []).map((c, i) => {
        const to = GUIDE_NODES[c.to];
        const help = to ? `${to.title}. ${firstSentence(to.id === GUIDE_ROOT ? introFor(intro) : to.say)}` : '';
        return `<button type="button" class="ng-btn ng-choice" data-ng-stop data-ng-choice="${i}" data-help="${esc(help)}"
          data-help-title="${esc(c.label)}"><span class="ng-key">${esc(c.key || '')}.</span>${esc(c.label)}</button>`;
      }).join('');
      const actBtns = acts.map((a, i) => (a.kind === 'link'
        ? `<a class="ng-btn ng-act" data-ng-stop data-ng-link href="${esc(a.href)}" target="_blank" rel="noopener"
            data-help="${esc(`Opens ${a.label} in a new tab.`)}">${esc(a.label)} ↗</a>`
        : `<button type="button" class="ng-btn ng-act" data-ng-stop data-ng-act="${i}"
            data-help="${esc(actHelp(a))}">${esc(a.label)}</button>`)).join('');
      const tree = prefs.tree
        ? `<ol class="ng-tree" role="tree" aria-label="Where you are">${treeRows(node.id).map((r) => `
            <li role="treeitem" aria-level="${r.depth + 1}" aria-current="${r.current}" ${r.hasChildren ? `aria-expanded="${r.open}"` : ''}
              style="padding-left:${r.depth * 1.1}rem"><button type="button" data-ng-tree="${esc(r.id)}"
              data-help="${esc(`Go to “${r.title}”.`)}">${r.hasChildren ? (r.open ? '▾ ' : '▸ ') : '· '}${esc(r.title)}</button></li>`).join('')}</ol>`
        : '';
      return `
        <div class="ng-head"><img src="${esc(catImageURL('talking'))}" alt="">
          <div><b>Nimrod</b><div class="ng-where">${esc(node.title)}</div></div></div>
        <p class="ng-say" data-ng-say aria-live="polite">${esc(words)}</p>
        <div class="ng-btns">
          <button type="button" class="ng-btn" data-ng-stop data-ng-back ${nav.canBack() ? '' : 'disabled'}
            data-help="Back one step, the way you came. Press it again to keep going back.">‹ Back</button>
        </div>
        <div class="ng-btns">${choiceBtns}</div>
        ${actBtns ? `<div class="ng-btns">${actBtns}</div>` : ''}
        <div class="ng-btns">
          <button type="button" class="ng-btn" data-ng-stop data-ng-restart ${nav.id() === GUIDE_ROOT && !nav.canBack() ? 'disabled' : ''}
            data-help="Back to Nimrod’s first question.">Start over</button>
          <button type="button" class="ng-btn" data-ng-stop data-ng-treetoggle aria-pressed="${prefs.tree}"
            data-help="Show or hide the map of everything Nimrod can show you.">Map: ${prefs.tree ? 'on' : 'off'}</button>
          <button type="button" class="ng-btn" data-ng-stop data-ng-do="talk"
            data-help="${esc(`Talk it over with ${aiP.name}, your AI, typed or spoken. It can show you around the guide with you.`)}">Talk to ${esc(aiP.name)}</button>
        </div>
        ${tree}`;
    }

    function talkHTML(node) {
      const n = aiP.name;
      const btn = (doWhat, label, help, extra = '') => `<button type="button" class="ng-btn" data-ng-stop data-ng-do="${doWhat}" ${extra}
        data-help="${esc(help)}">${label}</button>`;
      const log = chat.log().slice(-20).map((m) => `<p class="ng-msg ${m.role === 'user' ? 'is-user' : ''} ${m.failed ? 'is-failed' : ''}">`
        + `<b>${esc(m.role === 'user' ? 'You' : n)}:</b>${esc(m.text)}</p>`).join('');
      const pend = pending().map((a) => `<div class="ng-btns">
          ${btn('confirm', `Do it: ${esc(a.label)}`, `${n} asked to do this. Nothing happens unless you press it.`, `data-ng-id="${esc(a.id)}"`)}
          ${btn('dismiss', 'Not now', 'Leave it: nothing happens.', `data-ng-id="${esc(a.id)}"`)}</div>`).join('');
      const noAI = status.state === 'none' || status.state === 'needs-model';
      let keySaved = false;
      let s = {};
      try { s = ai().settings(); keySaved = !!ai().hasKey?.(); } catch { /* defaults */ }
      const setup = setupOpen ? `<div class="ng-box" data-ng-setup>
          <label for="ng-f-name">Name</label><input id="ng-f-name" data-ng-field="name" maxlength="40" value="${esc(n)}">
          <label for="ng-f-persona">How it talks (its persona, in your words)</label>
          <textarea id="ng-f-persona" data-ng-field="persona" maxlength="2000" placeholder="A patient, cheerful guide…">${esc(aiP.persona)}</textarea>
          <label for="ng-f-url">AI address (this device)</label><input id="ng-f-url" data-ng-field="baseUrl" type="url" spellcheck="false" value="${esc(s.baseUrl || DEFAULT_BASE_URL)}">
          <label for="ng-f-model">Model (blank: choose one on this computer automatically)</label><input id="ng-f-model" data-ng-field="model" spellcheck="false" value="${esc(s.model || '')}">
          <label for="ng-f-key">Your own key, if the service needs one (kept in this browser only)</label>
          <input id="ng-f-key" data-ng-field="key" type="password" autocomplete="off" placeholder="${keySaved ? 'A key is saved' : 'None'}">
          <div class="ng-btns" style="margin-top:8px">
            ${btn('savesetup', 'Save', 'Keep these, and try the AI again.')}
            ${keySaved ? btn('forgetkey', 'Forget the key', 'Remove the saved key from this browser.') : ''}
            ${btn('actfreely', `Let ${esc(n)} act without asking: ${aiP.actFreely ? 'on' : 'off'}`, 'Off: every action is a button you press first. On: they happen as soon as it asks.', `aria-pressed="${aiP.actFreely}"`)}
            ${btn('listenms', `Stop listening after: ${listenLabel(aiP.listenMs)}`, 'How long “Talk” keeps listening after the last thing it heard.')}
          </div></div>` : '';
      const notesList = notes.length ? `<ul class="ng-notes">${notes.slice().reverse().map((x) => `<li><small>${esc(stamp(x.at))}${x.where ? ` · ${esc(x.where)}` : ''}</small>
          <div>${esc(x.text)}</div>${btn('delnote', 'Delete', 'Delete this note.', `data-ng-id="${esc(x.id)}"`)}</li>`).join('')}</ul>` : '';
      return `
        <div class="ng-head"><img src="${esc(catImageURL('talking'))}" alt="">
          <div><b>${esc(n)}</b><div class="ng-where">On the tour at “${esc(node.title)}”</div></div></div>
        <div class="ng-btns">${btn('guide', '‹ Back to the guide', 'Back to the guide’s choices. The conversation is kept while this panel is open.')}</div>
        <div class="ng-card"><b>${esc(node.title)}:</b> ${esc(firstSentence(words))}</div>
        <p class="ng-status" data-ng-status role="status">${esc(statusText())}</p>
        ${noAI ? `<p class="ng-help" data-ng-help>${esc(connectHelp(n, ''))}</p>` : ''}
        <div class="ng-log" data-ng-log aria-live="polite">${log}${thinking ? `<p class="ng-msg"><b>${esc(n)}:</b>…</p>` : ''}</div>
        ${pend ? `<div class="ng-pend" data-ng-pending>${pend}</div>` : ''}
        ${notice ? `<p class="ng-status" data-ng-notice>${esc(notice)}</p>` : ''}
        ${listenHint ? `<p class="ng-status" data-ng-listenhint>${esc(listenHint)}</p>` : ''}
        <div class="ng-row"><input data-ng-field="say" aria-label="${esc(`Type to ${n}`)}" placeholder="${esc(`Type to ${n}…`)}" maxlength="4000">
          ${btn('send', 'Send', `Send what you typed to ${n}.`)}</div>
        <div class="ng-btns">
          ${btn('listen', listening ? 'Listening… press to stop' : 'Talk', listening ? 'Stop sending what is said to the chat.' : `Say what you want to ${n}; the wake phrase still gives a command.`, `aria-pressed="${listening}"`)}
          ${thinking ? btn('cancel', 'Stop', 'Stop waiting for this answer.') : ''}
          ${btn('makenote', 'Make a note', 'Turn this conversation into a short note you can edit and keep.')}
          ${btn('setup', `About ${esc(n)}`, 'Its name, how it talks, and which AI answers.', `aria-expanded="${setupOpen}"`)}
        </div>
        ${draft ? (draft.busy ? '<p class="ng-status" data-ng-draft>Writing the note…</p>' : `<div class="ng-draft" data-ng-draft>
          ${draft.reason ? `<p class="ng-status">${esc(draft.reason)}</p>` : ''}
          <textarea data-ng-field="draft" aria-label="The note">${esc(draft.text)}</textarea>
          <div class="ng-btns">${btn('savenote', 'Save note', 'Keep this note in your notes.')}${btn('dropnote', 'Discard', 'Throw this draft away.')}</div></div>`) : ''}
        ${notes.length ? `<div class="ng-btns">${btn('copynotes', `Copy all notes (${notes.length})`, 'Put every note on the clipboard, dated, to paste anywhere.')}</div>` : ''}
        ${exportText ? `<textarea class="ng-export" data-ng-export readonly aria-label="Your notes as text">${esc(exportText)}</textarea>` : ''}
        ${notesList}
        ${setup}`;
    }

    function render() {
      if (!root || torn) return;
      const node = nav.current();
      // A keyboard user who pressed one of his buttons keeps the keyboard in him: the new page's first
      // choice takes the focus the pressed (and now replaced) button had. What is typed into a field
      // survives a redraw (a reply arriving must not wipe a half-typed message).
      const doc = root.ownerDocument;
      const active = doc.activeElement;
      const hadFocus = !!active && root.contains(active);
      const focusField = hadFocus ? active.dataset?.ngField || null : null;
      const kept = {};
      for (const el of root.querySelectorAll('[data-ng-field]')) kept[el.dataset.ngField] = el.value;
      // The note being edited is the draft itself (an action adding a line appends to what was typed).
      if ('draft' in kept && draft && !draft.busy) draft.text = kept.draft;
      delete kept.draft;
      root.innerHTML = `${view === 'talk' ? talkHTML(node) : guideHTML(node)}
        <div class="ng-info" data-ng-info data-hover-ignore role="status" aria-live="polite" ${prefs.hover ? '' : 'hidden'}>
          <b data-ng-info-title></b><span data-ng-info-text>${esc(INFO_IDLE)}</span></div>`;
      for (const el of root.querySelectorAll('[data-ng-field]')) {
        const k = el.dataset.ngField;
        if (k in kept) el.value = kept[k];
      }
      // A new page of his keeps what the info area last explained (Kontakt's pane does not blank either).
      if (lastInfo) showInfo(lastInfo);
      paintCursor();
      if (hadFocus) {
        const f = (focusField && root.querySelector(`[data-ng-field="${focusField}"]`))
          || root.querySelector('[data-ng-choice]') || stops()[0];
        try { f?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      }
    }

    function actHelp(a) {
      switch (a.kind) {
        case 'menu-tab': return `Opens the settings menu on its ${a.tab} tab.`;
        case 'settings-page': return 'Shows that page in the settings panel.';
        case 'switch': return 'Opens the switch list: choose another module to take a panel’s place.';
        case 'host': return a.act === 'picker' ? 'Shows every module there is.' : 'Shows the ready-made dashboards to start from.';
        case 'tutorial': return 'Goes to the tutorial dashboard, where Nimrod and the settings always are.';
        case 'game-mode': return MODE_HELP[a.mode] || '';
        default: return '';
      }
    }

    function doPress(what, id) {
      switch (what) {
        case 'talk': setView('talk'); return;
        case 'guide': setView('guide'); return;
        case 'send': {
          const el = root?.querySelector('[data-ng-field="say"]');
          const t = el ? el.value : '';
          if (el) el.value = '';
          sendText(t);
          return;
        }
        case 'listen': if (listening) stopListening(); else startListening(); return;
        case 'cancel': try { inflight?.abort(); } catch { /* done */ } return;
        case 'confirm': queue.confirm(id); return;
        case 'dismiss': queue.dismiss(id); return;
        case 'makenote': makeDraft(); return;
        case 'savenote': saveDraft(); return;
        case 'dropnote': draft = null; render(); return;
        case 'copynotes': copyNotes(); return;
        case 'delnote': notes = removeNote(notes, id); store?.set({ notes }); render(); return;
        case 'setup': setupOpen = !setupOpen; render(); return;
        case 'savesetup': saveSetup(); return;
        case 'forgetkey': try { ai().setKey?.(''); } catch { /* none */ } notice = 'The key is forgotten.'; render(); return;
        case 'actfreely': ensureStore().then(() => { saveAI({ actFreely: !aiP.actFreely }); render(); }); return;
        case 'listenms': ensureStore().then(() => {
          const i = LISTEN_CHOICES.indexOf(aiP.listenMs);
          saveAI({ listenMs: LISTEN_CHOICES[(i + 1) % LISTEN_CHOICES.length] });
          if (listening) armIdle();
          render();
        }); return;
        default:
      }
    }

    function press(el) {
      if (!el || el.disabled) return;
      const ds = el.dataset;
      if (ds.ngDo) { doPress(ds.ngDo, ds.ngId || null); return; }
      if ('ngBack' in ds) { nav.back(1); arrive(); return; }
      if ('ngRestart' in ds) { nav.restart(); arrive({ forward: true }); return; }
      if ('ngTreetoggle' in ds) { setPref('tree', !prefs.tree); return; }
      if (ds.ngChoice != null) { if (nav.choose(Number(ds.ngChoice))) arrive({ forward: true }); return; }
      if (ds.ngAct != null) { const a = (nav.current().acts || [])[Number(ds.ngAct)]; if (a) runAct(a); return; }
      if (ds.ngTree) { if (nav.go(ds.ngTree)) arrive({ forward: true }); return; }
      if ('ngLink' in ds) { try { el.ownerDocument.defaultView?.open?.(el.href, '_blank', 'noopener'); } catch { /* blocked */ } }
    }
    function setPref(key, value) {
      prefs = { ...prefs, [key]: value };
      stateSet({ [key]: value });
      render();
    }
    function showInfo(i) {
      lastInfo = i ? { title: i.title || '', text: i.text || '' } : null;
      if (!root || !lastInfo) return;
      const t = root.querySelector('[data-ng-info-title]');
      const x = root.querySelector('[data-ng-info-text]');
      if (t) t.textContent = lastInfo.title ? `${lastInfo.title}:` : '';
      if (x) x.textContent = lastInfo.text;
    }

    function onClick(e) {
      const el = e.target instanceof Element ? e.target.closest('[data-ng-do],[data-ng-back],[data-ng-restart],[data-ng-treetoggle],[data-ng-choice],[data-ng-act],[data-ng-tree]') : null;
      if (!el || !root?.contains(el)) return;
      cursor = Math.max(0, stops().indexOf(el));
      press(el);
    }
    function onKey(e) {
      // Enter in the message box sends it (Shift+Enter is not needed: it is one line).
      if (e.key === 'Enter' && e.target instanceof Element && e.target.matches('[data-ng-field="say"]')) {
        e.preventDefault();
        doPress('send');
      }
    }

    return {
      async init() {
        root = mount.ownerDocument.createElement('div');
        root.className = 'ng-root';
        root.setAttribute('data-nimrod-guide', '');
        const style = mount.ownerDocument.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKey);
        try { await ctx.state?.load?.(); } catch { /* a preview, or offline: the defaults stand */ }
        if (torn) return;
        const s = stateGet();
        prefs = guidePrefs(s);
        intro = typeof s[INTRO_KEY] === 'string' ? s[INTRO_KEY] : null;
        game = createGuideGameHook(ctx, { onNote: gameNote });
        // The AI's name for the "Talk to" button, from the panel's own copy if there is one; the person's
        // record is opened the first time somebody presses it (it may be a server round trip).
        if (s.ai && typeof s.ai === 'object') aiP = aiPrefs(s.ai);
        // Back where you left him: every step of the way you came, so Back still works.
        const walk = Array.isArray(s[WALK_KEY]) ? s[WALK_KEY].filter((id) => GUIDE_NODES[id]) : [];
        if (walk.length && walk[0] === GUIDE_ROOT) for (const id of walk.slice(1)) nav.go(id);
        // Arriving is not a forward step: what was opened last time is not opened again by itself, and
        // he does not talk over a screen that has just started (he speaks when spoken to).
        await arrive({ quiet: true });
        // The person's AI name, for the button (a record read, never a call to the AI).
        ensureStore().then(() => { if (!torn) render(); }).catch(() => {});
        try {
          offState = ctx.state?.subscribe?.((v) => {
            const next = guidePrefs(v || {});
            if (next.tree !== prefs.tree || next.hover !== prefs.hover || next.speak !== prefs.speak) { prefs = next; render(); }
          }) || null;
        } catch { offState = null; }
        // The verbs a switch sends him.
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(GUIDE_VERB_TOPICS.next, () => { cursor += 1; paintCursor(); });
        on(GUIDE_VERB_TOPICS.prev, () => { cursor -= 1; paintCursor(); });
        on(GUIDE_VERB_TOPICS.select, () => { const b = stops()[cursor]; if (b) press(b); });
        on(GUIDE_VERB_TOPICS.back, () => {
          if (view === 'talk') { setView('guide'); return; }
          if (nav.canBack()) { nav.back(1); arrive(); }
        });
        // Speech: what was said into the chat's dictation window, and whether the speech layer heard us
        // open it (no answer = this screen is not listening, and the person is told).
        on(SPEECH_TOPICS.answer, heard);
        on(SPEECH_TOPICS.answering, (p) => {
          if (p?.on && p.instanceId === (ctx.instanceId || null) && listening) { heardAnswering = true; if (listenHint) { listenHint = ''; render(); } }
        });
        on(DELIVERY_TOPIC, (rec) => { if (holding && rec && aiSaidId != null && rec.id === aiSaidId) release(); });
        // Hover: the whole screen he is on (a kiosk), or the page.
        const scope = mount.closest?.('.kiosk') || mount.ownerDocument;
        hover = watchHover(scope, { enabled: () => prefs.hover && !torn, onInfo: showInfo });
      },
      onResize() {},
      onHide() {
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; }
        // A hidden chat does not keep taking the room's words.
        if (listening) stopListening();
      },
      destroy() {
        if (listening) { listening = false; holding = false; announceGrammar(); }
        torn = true;
        clearTimeout(idleTimer); clearTimeout(hintTimer); clearTimeout(holdTimer);
        try { inflight?.abort(); } catch { /* done */ }
        try { game?.destroy(); } catch { /* gone */ }
        try { hover?.stop(); } catch { /* gone */ }
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } }
        if (aiSaidId != null) { try { ctx.output?.cancel?.(aiSaidId); } catch { /* said */ } }
        try { store?.destroy(); } catch { /* gone */ }
        root?.removeEventListener('click', onClick);
        root?.removeEventListener('keydown', onKey);
        mount.innerHTML = '';
        root = null;
      },
      // For the suite: where he is, without reaching into the closure.
      __probe: () => ({ id: nav.id(), history: nav.history(), prefs: { ...prefs }, intro, words, cursor,
        stops: stops().map((b) => b.textContent.trim()),
        view, listening, holding, thinking, status: { ...status }, ai: { ...aiP }, pending: pending(),
        log: chat.log(), notes: notes.map((x) => ({ ...x })), draft: draft ? { ...draft } : null, notice, listenHint,
        storeKind: store?.kind || null }),
      // For the suite: wait until every message sent so far is answered.
      __settled: () => sendChain,
    };
  },
);
