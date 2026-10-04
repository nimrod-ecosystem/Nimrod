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
//     (and while the reply is being read aloud, so the screen does not answer itself).
//   * (a) BUILT 2026-10-04, BESIDE (c): "<wake phrase>, ask <name>, what is this" (or "<name>, what is this")
//     sends "what is this" to the chat, exactly as if typed; "make a note, ..." keeps a note with no AI at all.
//     The speech layer owns the matching (input_speech.js "ASK <NAME>"); this panel tells it the name
//     (SPEECH_TOPICS.askTarget, re-told on a rename, withdrawn when hidden) and does what it is handed. The
//     prefix ALONE opens a ONE-utterance window when the engine can write a sentence down, and on a fixed-
//     grammar engine opens the chat (or the notes) saying "type it, or press Talk". Only the words after the
//     prefix are sent; whatever the AI then asks to do is a button, as always (no voice "yes" in that window).
//   * "Make a note" reduces the conversation to a short dated note the person edits and keeps; "Copy all
//     notes" puts them on the clipboard. Nothing is sent anywhere by itself.
//   * No AI connected: it says how to connect one, and the tree works exactly as before.
//   * NOTHING CALLS THE AI ON MOUNT (ai.js's rule): only a press — opening the chat, sending, Check.
//
// *** SETTING THE AI UP, AND NOTES FROM ANYWHERE (2026-10-03). *** Mike: "Setting [photos] up shouldn't be one
// of the initial options. It should change to setting up your guide/AI", and "I need to learn how to go
// through the site with [my AI] and make my notes."
//   * The setup is guide NODES with a `form` (nimrod_guide_data.js FORM_KINDS), so Back, the map, a switch and
//     the AI's own [[go]] all work on it unchanged. "Next" keeps the form; "Skip this step" keeps nothing.
//     Only two buttons call out: "Look for Ollama on this computer" (one GET of its model list, through a
//     client that holds only that address — never the person's key) and "Say hello" (one short chat).
//   * A third view, NOTES: write one yourself, make one from the talk, copy them all or save them as a .md
//     file. Each note carries the time, the guide's place, and `context` (dashboard, the panel picked, the
//     page PATH — never the query, which on a screen carries its key). Opened from his bottom row, the N key
//     (a setting, argued at GUIDE_SETTINGS), or GUIDE_TOPICS.notes from a host.

import { registerModule, getManifest } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { catImageURL } from '../cat_guide.js';
import { watchHover } from '../hover_info.js';
import { isTyping } from '../input_keyboard.js';
import { createAI, DEFAULT_BASE_URL, AI_SETTINGS_KEY, isChatModel, explainFailure } from '../ai.js';
import {
  GUIDE_NODES, GUIDE_ROOT, GUIDE_TOPICS, GUIDE_VERB_TOPICS, createGuideNav, treeRows, wordsFor, actMessages, introFor,
} from '../nimrod_guide_data.js';
// Node A's mechanics (game / learning / sandbox, the tour's points, the settings-panel check): unlocks.js.
import { createGuideGameHook, MODE_HELP } from '../unlocks.js';
import {
  AI_SOURCE, SPEECH_TOPICS, DELIVERY_TOPIC, LISTEN_CHOICES, ASK_WINDOW_MS, NAME_MAX, PERSONA_MAX, aiPrefs, openAIStore, isLocalAddress,
  createGuideChat, createActionQueue, allowedActions, isYes, isNo, parseReply,
  OLLAMA_URL, firstChatModel, helloMessages, HELLO_TOKENS, ollamaOriginLines, ollamaAllowsByDefault,
  AI_BACKENDS, readAIBackend, writeAIBackend, createClaudeAI, claudeStatusLine, CLAUDE_SETTINGS_PAGE, CLAUDE_PLAIN_WORDS,
} from '../nimrod_ai.js';
// A page set up somewhere else (/claude.html, /reviews.html, a link act): on a SCREEN its address and a code to
// scan, never the page itself over the dashboard (page_links.js argues it).
import { elsewhereHTML, themeQrColours } from '../page_links.js';
import { authHeaders } from '../auth.js';
import {
  draftNote, makeNote, addNote, removeNote, cleanNotes, notesToText, stamp, noteContextFrom, panelOf, contextLine,
  notesFileName, nearlyFull, NOTES_MAX, planBrowserMove, movedLine,
} from '../nimrod_notes.js';
// "Try it as someone new": notes made as the test person go to the owner's record (try_new.js argues it).
import { openTrialNotes, TRIAL_NOTE_MARK } from '../try_new.js';

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
  // notesKey ON (2026-10-03): "a notes view he can reach from anywhere ... or a hotkey". N, argued: not a
  //   browser's (Ctrl+N is, and is left alone: any Ctrl/Alt/Cmd press is ignored), not the screen's (its keys
  //   are 1-9, H, C, F, M, [, ], \), never while typing, and it only OPENS a list — nothing is sent or saved.
  //   AGAINST, and why it is a setting: a letter game on the same dashboard that reads keys from the page
  //   would lose its N to the notes. Somebody playing one turns this off.
  { key: 'notesKey', label: 'The N key opens your notes', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No',
    help: 'Press N anywhere on this screen (not while typing) to open your notes in Nimrod, ready to write one.' },
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
  return `${reason ? `${reason} ` : ''}The guide works without one. To talk to ${name}, connect an AI step by step with the`
    + ` guide’s “Set up your guide / AI”, or in “About ${name}”:`
    + ` free on this computer with Ollama (ollama.com: download a model such as qwen2.5:3b, and let this website use it`
    + ` with Ollama’s OLLAMA_ORIGINS setting; the address is ${DEFAULT_BASE_URL});`
    + ' or any online service that speaks the OpenAI API, free or with your own key (its address, a model name and the key;'
    + ' the key stays in this browser and goes only to that address);'
    + ` or Claude, on this account, if the account owner has saved a Claude key on ${CLAUDE_SETTINGS_PAGE} (kept on the server,`
    + ' never in this browser, with a daily spending limit). Nothing is sent anywhere until you talk.';
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
.ng-btn.is-scan,.ng-btn:focus-visible{outline:3px solid var(--scan-ring, var(--highlight));outline-offset:2px}
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
.ng-form{display:flex;flex-direction:column;gap:6px}
.ng-form label{color:var(--text-muted)}
.ng-form input,.ng-form textarea,.ng-quick{min-height:44px;box-sizing:border-box;padding:8px 10px;border-radius:10px;
  border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;width:100%}
.ng-form textarea,.ng-quick{min-height:5em}
.ng-lines{margin:0;padding-left:1.1rem}
.ng-lines li{margin:2px 0;overflow-wrap:anywhere}
.ng-warn{margin:0;padding:6px 10px;border-radius:10px;background:var(--surface-alt);font-weight:700}
.ng-elsewhere{flex:1 1 100%;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface)}
.ng-elsewhere p{margin:0}
.ng-elsewhere b{overflow-wrap:anywhere}
.ng-elsewhere [data-elsewhere-note]{color:var(--text-muted)}
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
    // WHICH AI ANSWERS on this device (nimrod_ai.js AI_BACKENDS): 'local' and 'online' are ai.js (the host's
    // `ctx.ai` in a suite); 'claude' is the server's, with no key in this browser. `ctx.aiStorage` and
    // `ctx.claudeAI` are a suite's stand-ins for localStorage and the server.
    const backendStore = () => { if (ctx.aiStorage) return ctx.aiStorage; try { return globalThis.localStorage || null; } catch { return null; } };
    let backend = readAIBackend(backendStore());
    const ai = () => aiClient || (aiClient = backend === 'claude'
      ? (ctx.claudeAI || createClaudeAI({ ...(typeof ctx.serverFetch === 'function' ? { fetchImpl: ctx.serverFetch } : {}),
        headers: () => authHeaders(ctx.user || undefined) }))
      : (ctx.ai || createAI()));
    let claudeCheck = null;    // null | { busy } | { ok, line } — "Check Claude on this account"
    let store = null;          // nimrod_ai.js openAIStore: the person's AI settings and notes
    let notesHome = null;      // try_new.js openTrialNotes: the owner's record, while trying it as someone new
    const notesSink = () => notesHome || store;
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
    // "ask <name>" / "make a note" said alone (2026-10-04): what the NEXT dictated utterance becomes, and
    // whether the window shuts after it (opened by voice: one utterance) and how long it waits for it.
    let nextAs = null;         // null | 'ask' | 'note'
    let onceOnly = false;
    let onceMs = 0;
    let hidden = false;        // hidden panels are not asked (the reply would be read aloud from nowhere)
    let askSig = '';
    let aiSaidId = null;
    let draft = null;          // { busy } | { text, reason, fromAI }
    let setupOpen = false;
    let exportText = '';
    let notice = '';           // a one-line result (saved, copied...)
    const pending = () => queue.pending();

    // ---- setting the AI up (the guide's ai-* nodes, 2026-10-03) -------------------------------------
    let detect = null;         // null | { busy } | { ok: true, models, others, chosen } | { ok: false, reason }
    let detectAbort = null;
    let otherOpen = backend === 'online';   // the online address + key fields on the connect step
    let hello = null;          // null | { busy } | { ok: true, text, model } | { ok: false, reason }
    let helloAbort = null;
    // ---- notes from anywhere (2026-10-03) -----------------------------------------------------------
    let lastOther = null;      // the panel picked before Nimrod was: { type, title } (nimrod_notes.js panelOf)
    let focusWatch = null;     // MutationObserver on the screen's data-focused
    let keyWin = null;         // the window the N key is heard on
    const titleOf = (type) => getManifest(type)?.title || '';
    const scopeEl = () => mount.closest?.('.kiosk') || mount.ownerDocument;

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
      if (a?.kind === 'guide') { setView(a.do); return; }   // one of his own views: nothing on the bus
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
        storeOpening = openAIStore(ctx).then(async (s) => {
          if (torn) { s.destroy(); return s; }
          if (store && store !== s) { try { store.destroy(); } catch { /* gone */ } }
          store = s;
          const v = s.get() || {};
          aiP = aiPrefs(v);
          notes = cleanNotes(v.notes);
          // TRYING IT AS SOMEONE NEW (try_new.js): the notes are the OWNER's, written to their record as they are
          // made, so nothing is copied later and "Start over" cannot reach them. The AI's name and manner stay
          // the test person's (fresh). Read once; a failed read keeps the module's own list.
          if (!notesHome) {
            let personId = '';
            try { personId = ctx.personId || ''; } catch { personId = ''; }
            const h = openTrialNotes({ personId, storage: ctx.trialStorage || undefined });
            if (h) {
              try { await h.load(); notesHome = h; notes = cleanNotes(h.get().notes); }
              catch (err) { console.error('nimrod: the owner’s notes', err); h.destroy(); }
            }
          }
          if (s.kind === 'person' && !moveTried && !torn) { moveTried = true; await moveBrowserNotes(s); }
          if (s.kind !== 'person' && hasPersonStore()) storeOpening = null;
          return s;
        }).catch((err) => { storeOpening = null; throw err; });
      }
      return storeOpening;
    }
    // *** WHAT THIS BROWSER KEPT BEFORE A PERSON WAS KNOWN, MOVED TO THEIR RECORD (2026-10-04). *** A landing tried
    // before anybody saved it kept Nimrod's notes on its panel, in this browser, under one preview id shared by
    // everybody using it. On the first load where a person is known they move to the person's record: the host's
    // `ctx.personHost.browserNotes` finds them (try_new.js `browserNotesSource`), nimrod_notes.js `planBrowserMove`
    // merges them, and the browser lets go ONLY after the record has them. So a failed write loses nothing, a move
    // cut off half way runs again without doubling (by id), and a second person on the browser is handed nothing.
    // While trying it as someone new, they go where every note then goes: the owner's record (`notesHome`). The
    // person is told in one line (`movedNote`). No host source (a screen, a suite): nothing to move.
    let moveTried = false;
    let movedNote = '';
    async function moveBrowserNotes(s) {
      let src = null;
      try { src = ctx.personHost?.browserNotes || null; } catch { src = null; }
      if (!src || typeof src.find !== 'function' || typeof src.clear !== 'function') return;
      const sink = notesHome || s;
      // A record that could not be read is never written by a move: it could overwrite what is there.
      if (!notesHome && s.loaded === false) return;
      let found = [];
      try { found = (await src.find()) || []; } catch (err) { console.error('nimrod: this browser’s notes', err); return; }
      if (torn || !found.length) return;
      // The AI's name and manner are the person's own (`store`), even while notes go to the owner's record.
      const plan = planBrowserMove(sink.get() || {}, found, notesHome ? { fields: [] } : undefined);
      if (plan.patch) {
        sink.set(plan.patch);
        try { await sink.flush?.(); } catch (err) { console.error('nimrod: moving this browser’s notes (kept there)', err); return; }
      }
      // On the record: now the browser lets go of exactly what moved, row by row.
      for (const f of found) {
        const clearNotes = plan.waiting === 0 && Array.isArray(f?.ai?.notes) && f.ai.notes.length > 0;
        const fields = plan.fields.filter((k) => f?.ai?.[k] === plan.patch?.[k]);
        if (!clearNotes && !fields.length) continue;
        try { await src.clear(f, { notes: clearNotes, fields }); } catch (err) { console.error('nimrod: clearing this browser’s notes', err); }
      }
      if (torn) return;
      if (plan.patch?.notes) notes = cleanNotes(plan.patch.notes);
      if (plan.fields.length) aiP = aiPrefs({ ...aiP, ...Object.fromEntries(plan.fields.map((k) => [k, plan.patch[k]])) });
      movedNote = movedLine(plan);
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
      // ("Claude, on this account" has no address: its model is the account's own choice, on the server.)
      if (s.backend !== 'claude' && !isLocalAddress(s.baseUrl) && !s.model) {
        status = { state: 'needs-model', model: '', reason: `Name the model to use at ${s.baseUrl} in “About ${aiP.name}”.` };
        render();
        return status;
      }
      let r;
      try { r = await ai().resolveModel(s.model || ''); } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
      if (torn) return status;
      if (!r?.ok) status = { state: 'none', model: '', reason: r?.reason || 'The AI did not answer.' };
      else if (r.fellBack && s.backend !== 'claude' && !isLocalAddress(s.baseUrl)) status = { state: 'needs-model', model: '', reason: `That service has no model called “${s.model}”.` };
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
          if (s.backend === 'claude') return `Connected: Claude, on this account (${status.model}).`;
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
      idleTimer = setTimeout(() => stopListening(), onceOnly ? onceMs : aiP.listenMs);
    }
    function startListening({ once = null, ms = 0 } = {}) {
      if (torn) return;
      if (listening) {
        // Already listening (Talk): the next utterance becomes what was asked for, and the window stays open.
        if (once) { nextAs = once; render(); }
        return;
      }
      nextAs = once;
      onceOnly = !!once;
      onceMs = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : ASK_WINDOW_MS;
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
      nextAs = null;
      onceOnly = false;
      if (was) announceGrammar();
      render();
    }
    function heard(p) {
      if (!listening || !p || p.dictation !== true) return;
      const t = String(p.text || '').trim();
      if (!t) return;
      const as = nextAs;
      nextAs = null;
      // Opened by voice: ONE utterance, then the window shuts (only what followed "ask <name>" is sent).
      if (onceOnly) stopListening(); else armIdle();
      if (as === 'note') { voiceNote(t); return; }
      // A voice "yes" confirms a waiting action only in a window somebody opened with Talk, never in one a
      // spoken "ask <name>" opened: that window is for the question.
      const waiting = as ? [] : pending();
      if (waiting.length && isYes(t)) { queue.confirm(waiting[0].id); return; }
      if (waiting.length && isNo(t)) { queue.dismiss(); return; }
      sendText(t, { spoken: true });
    }

    // ---- "ask <name> ..." and "make a note ..." by voice (input_speech.js "ASK <NAME>") ----------------------
    // Tell the speech layer the name this panel answers to: on every render (a rename lands at once, with no
    // reload), withdrawn while hidden or gone. Only sent when it changed.
    function announceAsk() {
      const open = !torn && !hidden && !!root;
      const sig = JSON.stringify([open, aiP.name]);
      if (sig === askSig) return;
      askSig = sig;
      publish(SPEECH_TOPICS.askTarget, { source: AI_SOURCE, instanceId: ctx.instanceId || null, open,
        names: [aiP.name], notes: true });
    }
    // The speech layer handing over what was said after the prefix. Addressed to ONE panel (`to`).
    function onAsk(p) {
      if (torn || !p || typeof p !== 'object' || (p.to ?? null) !== (ctx.instanceId || null)) return;
      const text = String(p.text || '').trim();
      if (p.kind === 'note') { askedNote(text, p); return; }
      if (p.kind !== 'ask') return;
      setView('talk');
      if (text) { if (onceOnly) stopListening(); sendText(text, { spoken: true }); return; }
      if (p.listen) { startListening({ once: 'ask', ms: p.ms }); return; }
      // A fixed-grammar engine heard the prefix and cannot hear the question.
      notice = `Heard “ask ${aiP.name}”. This screen’s voice can only hear its own commands: type your question, or press Talk to say it.`;
      render();
      focusOn('say');
      speak(`Type your question, or press Talk to say it.`);
    }
    function askedNote(text, p) {
      if (text) { voiceNote(text); return; }
      // The window can only stay open in the chat when it is already listening there; otherwise the notes view.
      if (!(view === 'talk' && listening)) setView('notes');
      if (p.listen) {
        startListening({ once: 'note', ms: p.ms });
        notice = 'Say the note.';
        render();
        return;
      }
      notice = 'Heard “make a note”. This screen’s voice can only hear its own commands: type the note here.';
      render();
      focusOn('quick');
      speak('Type the note.');
    }
    // A note said aloud: kept as it is (no AI), with where it was made, in the person's record; said back so
    // somebody walking around knows it was KEPT (the tone only said it was heard).
    function voiceNote(text) {
      ensureStore().then(() => {
        if (torn) return;
        if (view === 'guide') setView('notes');   // the guide view has nowhere to show "Note saved"
        if (keepNote(text)) speak('Note saved.');
        render();
      }).catch((err) => console.error('nimrod: voice note', err));
    }
    function focusOn(k) {
      try { root?.querySelector(`[data-ng-field="${k}"]`)?.focus({ preventScroll: false }); } catch { /* not focusable */ }
    }

    function setView(v) {
      if (!['guide', 'talk', 'notes'].includes(v) || v === view) return;
      view = v;
      cursor = 0;
      if (v === 'talk') {
        render();
        ensureStore().then(() => { render(); if (status.state === 'unchecked') checkStatus(); });
      } else {
        stopListening();
        render();
        // The notes are the person's record: read it (never a call to the AI).
        if (v === 'notes') ensureStore().then(() => render()).catch(() => {});
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
      if (!keepNote(ta ? ta.value : draft?.text)) return;
      draft = null;
      render();
    }
    /** Keep a note with where it was made. False (and says so) when it is empty. */
    function keepNote(text) {
      const c = noteContext();
      // Made while trying it as someone new: said in the note's context, so a pasted list says which ones were.
      if (notesHome && c) c.dashboard = `${c.dashboard ? `${c.dashboard} ` : ''}${TRIAL_NOTE_MARK}`;
      const n = makeNote(text, { where: nav.current().title, context: c });
      if (!n) { notice = 'The note is empty.'; render(); return false; }
      // The owner's list as it is now (another tab of theirs may have added one), plus this.
      notes = addNote(notesHome ? cleanNotes(notesHome.get().notes) : notes, n);
      notesSink()?.set({ notes });
      notice = `Note saved (${notes.length} kept).`;
      return true;
    }
    function saveQuick() {
      const ta = root?.querySelector('[data-ng-field="quick"]');
      if (!keepNote(ta ? ta.value : '')) return;
      if (ta) ta.value = '';
      render();
    }
    /** Which dashboard, which panel is picked, which page: nimrod_notes.js `noteContextFrom`. */
    function noteContext() {
      let host = null;
      try { host = typeof ctx.noteContext === 'function' ? ctx.noteContext() : null; } catch { host = null; }
      let path = '';
      try { path = mount.ownerDocument.defaultView?.location?.pathname || ''; } catch { path = ''; }
      let dashboardId = '';
      try { dashboardId = ctx.profileId || ''; } catch { dashboardId = ''; }
      return noteContextFrom({ scope: scopeEl(), own: root, lastOther, path, host, intro, dashboardId, titleOf });
    }
    /** "Save as a file": the same text as Copy, as a .md download (or the host's own way of saving). */
    function exportFile() {
      const text = notesToText(notes);
      if (!text) { notice = 'There are no notes to save yet.'; render(); return; }
      const name = notesFileName();
      try {
        if (typeof ctx.saveFile === 'function') ctx.saveFile(name, text, 'text/markdown');
        else {
          const doc = mount.ownerDocument;
          const win = doc.defaultView;
          const url = win.URL.createObjectURL(new win.Blob([text], { type: 'text/markdown' }));
          const a = doc.createElement('a');
          a.href = url; a.download = name; a.hidden = true;
          doc.body.append(a);
          a.click();
          a.remove();
          win.setTimeout(() => { try { win.URL.revokeObjectURL(url); } catch { /* gone */ } }, 10000);
        }
        notice = `Saved as ${name} (your browser’s downloads).`;
      } catch (err) {
        console.error('nimrod: save notes', err);
        notice = 'This browser would not save a file. Copy them instead.';
      }
      render();
    }
    /** Open the notes view from anywhere (the N key, or a host's button on GUIDE_TOPICS.notes). */
    function openNotes({ focus = false } = {}) {
      if (torn || !root) return;
      // The panel that was picked when the person asked: that is what the note will be about.
      rememberOther();
      setView('notes');
      if (view === 'notes') render();
      if (focus) { try { root.querySelector('[data-ng-field="quick"]')?.focus({ preventScroll: false }); } catch { /* not focusable */ } }
    }
    function rememberOther() {
      try {
        const cell = [...(scopeEl()?.querySelectorAll?.('.k-cell[data-focused]') || [])].find((c) => !c.contains(root));
        const p = panelOf(cell, titleOf);
        if (p) lastOther = p;
      } catch { /* no screen around us */ }
    }
    function onWindowKey(e) {
      if (torn || !root || !prefs.notesKey || e.defaultPrevented || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey || String(e.key || '').toLowerCase() !== 'n') return;
      if (isTyping(e.target)) return;
      const scope = scopeEl();
      // A key that landed in another screen on the page is not ours; a key on nothing (the body) is.
      const t = e.target;
      if (scope && scope.nodeType === 1 && t instanceof Node && t !== t.ownerDocument?.body && t !== t.ownerDocument?.documentElement
          && !scope.contains(t)) return;
      // One Nimrod answers: the first on this screen (two would both jump to their notes).
      if (scope?.querySelector?.('[data-nimrod-guide]') !== root) return;
      if (!root.isConnected) return;
      e.preventDefault();      // the N must not land in the note box it is about to focus
      openNotes({ focus: true });
    }

    // ---- setting the AI up ---------------------------------------------------------------------------
    // A client for ONE address that is not this device's setting: a look that saves nothing, and never sends
    // the person's key (its storage holds only the address). `ctx.aiFetch` is the suite's fake server.
    function clientAt(baseUrl) {
      const mem = { getItem: (k) => (k === AI_SETTINGS_KEY ? JSON.stringify({ baseUrl }) : null), setItem() {}, removeItem() {} };
      let pageOrigin = '';
      try { pageOrigin = mount.ownerDocument.defaultView?.location?.origin || ''; } catch { pageOrigin = ''; }
      return createAI({ storage: mem, pageOrigin, ...(typeof ctx.aiFetch === 'function' ? { fetchImpl: ctx.aiFetch } : {}) });
    }
    async function detectOllama() {
      try { detectAbort?.abort(); } catch { /* done */ }
      detectAbort = new AbortController();
      detect = { busy: true };
      render();
      const r = await clientAt(OLLAMA_URL).listModels({ signal: detectAbort.signal });
      detectAbort = null;
      if (torn) return;
      if (!r.ok) {
        // A website reaching this computer is ALSO the browser's question (Chrome's "local network access"),
        // apart from Ollama's own list. Measured 2026-10-03: from https://nimrodecosystem.com in Chrome 152 the
        // request failed at once with that permission "denied", while Ollama itself allowed the site. Asking
        // the permission's state sends nothing; it only lets the reason name the right fix.
        let lna = '';
        try { lna = (await mount.ownerDocument.defaultView?.navigator?.permissions?.query({ name: 'local-network-access' }))?.state || ''; } catch { lna = ''; }
        if (torn) return;
        const blocked = lna === 'denied' && !ollamaAllowsByDefault(pageOrigin())
          ? ' This browser is set to stop this website reaching devices on your network: allow it in the site’s settings (the icon to the left of the address), then look again.' : '';
        detect = { ok: false, reason: r.cancelled ? 'Stopped looking.' : `${r.reason}${blocked}`, lna };
        render();
        return;
      }
      const chat = r.models.filter((id) => isChatModel(id));
      if (!chat.length) { detect = { ok: false, reason: explainFailure({ kind: 'nomodel' }) }; render(); return; }
      let saved = {};
      try { saved = ai().settings() || {}; } catch { saved = {}; }
      const already = saved.baseUrl === OLLAMA_URL && chat.includes(saved.model) ? saved.model : null;
      detect = { ok: true, models: chat, others: r.models.length - chat.length, chosen: already || firstChatModel(chat) };
      render();
    }
    /** A model pressed: that is the choice, kept on this device at once (pressing it IS choosing it). */
    function useModel(id) {
      if (!detect?.ok || !detect.models.includes(id)) return;
      detect = { ...detect, chosen: id };
      try { ai().setSettings?.({ baseUrl: OLLAMA_URL, model: id }); } catch (err) { console.error('nimrod: AI settings', err); }
      status = { state: 'unchecked', model: '', reason: '' };
      notice = `${id} on this computer will answer.`;
      render();
    }
    /** A backend pressed: that is the choice, kept on this device at once (like a model). Sends nothing. */
    function setBackend(id) {
      const was = backend;
      backend = writeAIBackend(id, backendStore());
      if (backend === 'online') otherOpen = true;
      if (backend === 'local') otherOpen = false;
      if (was !== backend) { aiClient = null; status = { state: 'unchecked', model: '', reason: '' }; claudeCheck = null; hello = null; }
      notice = backend === 'claude' ? 'Claude, on this account, will answer here once the account has a key saved.' : '';
      render();
    }
    /** "Check Claude on this account": one GET of the account's Claude status (not billed, no key in it). */
    async function checkClaude() {
      claudeCheck = { busy: true };
      render();
      let r;
      try { r = await ai().status?.(); } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
      if (torn) return;
      claudeCheck = r?.ok ? { ok: !!r.status?.key_set, line: claudeStatusLine(r.status) } : { ok: false, line: r?.reason || 'Could not ask.' };
      render();
    }
    const fieldVal = (k) => root?.querySelector(`[data-ng-field="${k}"]`)?.value ?? null;
    function keepAI(patch) {
      aiP = aiPrefs({ ...aiP, ...patch });
      ensureStore().then(() => { saveAI(patch); render(); }).catch(() => {});
    }
    /** "Next" on a step: keep what its form holds. ("Skip this step" never calls this.) */
    function commitForm(kind) {
      if (kind === 'ai-name') { const v = fieldVal('fname'); if (v != null) keepAI({ name: v }); return; }
      if (kind === 'ai-persona') { const v = fieldVal('fpersona'); if (v != null) keepAI({ persona: v }); return; }
      if (kind === 'ai-connect') {
        // Claude: the choice is already kept (pressing it), and there is nothing else here to keep - no key.
        if (backend === 'claude') { status = { state: 'unchecked', model: '', reason: '' }; return; }
        try {
          if (otherOpen && fieldVal('furl') != null) {
            ai().setSettings?.({ baseUrl: fieldVal('furl'), model: fieldVal('fmodel') || '' });
            const key = fieldVal('fkey') || '';
            if (key.trim()) ai().setKey?.(key);
          } else if (detect?.ok && detect.chosen) {
            ai().setSettings?.({ baseUrl: OLLAMA_URL, model: detect.chosen });
          } else return;
        } catch (err) { console.error('nimrod: AI settings', err); return; }
        status = { state: 'unchecked', model: '', reason: '' };
      }
    }
    function saveOther() {
      commitForm('ai-connect');
      const k = root?.querySelector('[data-ng-field="fkey"]');
      if (k) k.value = '';
      notice = 'Saved. “Say hello” checks it.';
      render();
    }
    async function sayHello() {
      try { helloAbort?.abort(); } catch { /* done */ }
      helloAbort = new AbortController();
      const signal = helloAbort.signal;
      hello = { busy: true };
      render();
      await ensureStore();
      const st = await checkStatus();
      if (torn) return;
      if (signal.aborted) { hello = { ok: false, reason: 'Stopped.' }; render(); return; }
      if (st.state !== 'ok') { hello = { ok: false, reason: statusText() }; helloAbort = null; render(); return; }
      let r;
      try { r = await ai().chat(helloMessages(aiP), { model: st.model, temperature: 0.4, maxTokens: HELLO_TOKENS, signal }); }
      catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
      helloAbort = null;
      if (torn) return;
      if (!r?.ok) { hello = { ok: false, reason: r?.cancelled ? 'Stopped.' : (r?.reason || 'The AI did not answer.') }; render(); return; }
      const said = parseReply(r.text).say || String(r.text || '').trim() || '…';
      hello = { ok: true, text: said, model: r.model || st.model };
      render();
      speakReply(said);
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
      if (backend !== 'claude') try {
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
      // A link on a SCREEN is its address and a code to scan, not a stop (there is nothing to press); anywhere
      // else it opens the page in a new tab (page_links.js).
      const actBtns = acts.map((a, i) => (a.kind === 'link'
        ? (onScreen() ? elsewhere(a.href)
          : `<a class="ng-btn ng-act" data-ng-stop data-ng-link href="${esc(a.href)}" target="_blank" rel="noopener"
            data-help="${esc(`Opens ${a.label} in a new tab.`)}">${esc(a.label)} ↗</a>`)
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
        ${node.form ? formHTML(node.form) : ''}
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
          <button type="button" class="ng-btn" data-ng-stop data-ng-do="notes"
            data-help="${esc(`Your notes: write one, see them all, copy them or save them as a file.${prefs.notesKey ? ' The N key opens them from anywhere.' : ''}`)}">Notes${notes.length ? ` (${notes.length})` : ''}</button>
          <button type="button" class="ng-btn" data-ng-stop data-ng-do="talk"
            data-help="${esc(`Talk it over with ${aiP.name}, your AI, typed or spoken. It can show you around the guide with you.`)}">Talk to ${esc(aiP.name)}</button>
        </div>
        ${movedNote ? `<p class="ng-status" data-ng-moved>${esc(movedNote)}</p>` : ''}
        ${tree}`;
    }

    const btnHTML = (doWhat, label, help, extra = '') => `<button type="button" class="ng-btn" data-ng-stop data-ng-do="${doWhat}" ${extra}
        data-help="${esc(help)}">${label}</button>`;
    const pageOrigin = () => { try { return mount.ownerDocument.defaultView?.location?.origin || ''; } catch { return ''; } };
    // *** ON A SCREEN, A PAGE IS ITS ADDRESS (2026-10-04; page_links.js argues it). *** The kiosk's own word
    // (`ctx.isScreen`: true on a real screen, false embedded in Home or the modules page); a host that does not
    // say (a suite, a try-it box) is not a screen. The code is drawn in the theme's own two colours, once per
    // page and colours (a render happens on every hover).
    const onScreen = () => ctx.isScreen === true;
    const elsewhereMemo = new Map();
    const elsewhere = (path) => {
      const colours = themeQrColours(mount);
      const k = `${path}|${colours ? `${colours.dark}/${colours.light}` : ''}`;
      if (!elsewhereMemo.has(k)) elsewhereMemo.set(k, elsewhereHTML(path, { colours, cls: 'ng-elsewhere' }));
      return elsewhereMemo.get(k);
    };
    // Which AI answers: the three backends as buttons, the chosen one pressed. Used on the connect step and in About.
    const backendRow = () => `<p class="ng-status">Which AI answers on this device:</p><div class="ng-btns" data-ng-backends>${AI_BACKENDS.map((b) =>
      btnHTML('backend', esc(b.label), b.help, `data-ng-id="${esc(b.id)}" aria-pressed="${backend === b.id}"`)).join('')}</div>`;

    // The forms of the setup steps (nimrod_guide_data.js FORM_KINDS). Field names start with f so a value
    // kept across a redraw never lands in the talk view's own "About" fields.
    function formHTML(kind) {
      const n = aiP.name;
      if (kind === 'ai-name') {
        return `<div class="ng-form ng-box" data-ng-form="ai-name"><label for="ng-f-fname">Name</label>
          <input id="ng-f-fname" data-ng-field="fname" maxlength="${NAME_MAX}" value="${esc(n)}" autocomplete="off"></div>`;
      }
      if (kind === 'ai-persona') {
        return `<div class="ng-form ng-box" data-ng-form="ai-persona"><label for="ng-f-fpersona">How it talks, in your words (optional)</label>
          <textarea id="ng-f-fpersona" data-ng-field="fpersona" maxlength="${PERSONA_MAX}" placeholder="Cheerful and brief…">${esc(aiP.persona)}</textarea></div>`;
      }
      if (kind === 'ai-connect') {
        let s = {}; let keySaved = false;
        try { s = ai().settings() || {}; keySaved = !!ai().hasKey?.(); } catch { /* defaults */ }
        let found = '';
        if (detect?.busy) found = `<p class="ng-status" data-ng-detect>Looking at ${esc(OLLAMA_URL)}…</p>${btnHTML('stopdetect', 'Stop looking', 'Stop waiting for an answer.')}`;
        else if (detect?.ok) {
          found = `<p class="ng-status" data-ng-detect>Found Ollama on this computer, with ${detect.models.length} model${detect.models.length === 1 ? '' : 's'} that can talk${detect.others ? ` (and ${detect.others} that cannot, not shown)` : ''}. Pick one:</p>
            <div class="ng-btns">${detect.models.map((m) => btnHTML('usemodel', esc(m), `${n} answers with ${m}. Bigger models write better and answer slower.`,
              `data-ng-id="${esc(m)}" aria-pressed="${m === detect.chosen}"`)).join('')}</div>`;
        } else if (detect && !detect.ok) {
          const allowed = ollamaAllowsByDefault(pageOrigin());
          found = `<p class="ng-status" data-ng-detect>${esc(detect.reason)}</p>
            <p class="ng-status">${allowed ? 'This page is on this computer, so Ollama allows it already: it may simply not be running. Start Ollama and look again.'
              : `This page is ${esc(pageOrigin())}. If Ollama is running, it may not allow this website yet: see “Why can’t the website reach it?” below.`}</p>`;
        }
        const choose = backendRow();
        if (backend === 'claude') {
          let res = '';
          if (claudeCheck?.busy) res = '<p class="ng-status" data-ng-claude>Asking this website’s server…</p>';
          else if (claudeCheck) res = `<p class="ng-status" data-ng-claude>${esc(claudeCheck.line)}</p>`;
          return `<div class="ng-form ng-box" data-ng-form="ai-connect">${choose}
            <p class="ng-status">Answering now: Claude, on this account. No key is kept in this browser.</p>
            <ul class="ng-lines" data-ng-claude-words>${CLAUDE_PLAIN_WORDS.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
            <div class="ng-btns">
              ${onScreen() ? elsewhere(CLAUDE_SETTINGS_PAGE)
                : `<a class="ng-btn ng-act" data-ng-stop data-ng-link data-ng-claude-page href="${esc(CLAUDE_SETTINGS_PAGE)}" target="_blank" rel="noopener"
                data-help="Opens the Claude settings in a new tab: the account owner saves the key, picks the model and sees today’s spending there.">Claude settings: key, model, spending ↗</a>`}
              ${claudeCheck?.busy ? '' : btnHTML('checkclaude', claudeCheck ? 'Check again' : 'Check Claude on this account',
                'Asks this website’s server whether this account has a Claude key saved, and today’s spending. Nothing is sent to Claude.')}
            </div>${res}</div>`;
        }
        const other = otherOpen ? `<label for="ng-f-furl">The AI’s address (OpenAI-style, ending in /v1)</label>
            <input id="ng-f-furl" data-ng-field="furl" type="url" spellcheck="false" value="${esc(s.baseUrl || DEFAULT_BASE_URL)}">
            <label for="ng-f-fmodel">Model name (an online AI needs one; blank picks one on this computer)</label>
            <input id="ng-f-fmodel" data-ng-field="fmodel" spellcheck="false" value="${esc(s.model || '')}">
            <label for="ng-f-fkey">Your own key, if it needs one (kept in this browser only, sent only to that address)</label>
            <input id="ng-f-fkey" data-ng-field="fkey" type="password" autocomplete="off" placeholder="${keySaved ? 'A key is saved' : 'None'}">
            <div class="ng-btns">${btnHTML('saveother', 'Save this AI', 'Keep this address, model and key on this device.')}</div>` : '';
        return `<div class="ng-form ng-box" data-ng-form="ai-connect">${choose}
          <p class="ng-status">Answering now: ${esc(s.model || 'chosen automatically')} at ${esc(hostOf(s.baseUrl || DEFAULT_BASE_URL))}.</p>
          ${backend === 'local' ? `<div class="ng-btns">${detect?.busy ? '' : btnHTML('detect', detect ? 'Look again' : 'Look for Ollama on this computer',
            `Asks ${OLLAMA_URL} which models it has. Nothing else is sent.`)}</div>` : ''}
          ${backend === 'local' ? found : ''}${other}</div>`;
      }
      if (kind === 'ai-origins') {
        const o = pageOrigin();
        const lines = ollamaOriginLines(o);
        return `<div class="ng-form ng-box" data-ng-form="ai-origins">
          ${lines ? `<p class="ng-status">This page’s address is <b data-ng-origin>${esc(o)}</b>. To let it reach Ollama:</p>
            <ul class="ng-lines">${lines.map((l) => `<li><b>${esc(l.os)}:</b> ${esc(l.how)}</li>`).join('')}</ul>`
            : `<p class="ng-status">This page is <b data-ng-origin>${esc(o || 'on this computer')}</b>: Ollama allows it already, so nothing needs adding. If it still cannot be reached, Ollama is probably not running.</p>`}</div>`;
      }
      if (kind === 'ai-hello') {
        let res = '';
        if (hello?.busy) res = `<p class="ng-status" data-ng-hello>Waiting for ${esc(n)}… (a model on a computer with no graphics card can take a minute the first time)</p>`;
        else if (hello?.ok) res = `<p class="ng-msg" data-ng-hello><b>${esc(n)}:</b>${esc(hello.text)}</p><p class="ng-status">It works (${esc(hello.model)}).</p>`;
        else if (hello) res = `<p class="ng-status" data-ng-hello>${esc(hello.reason)}</p>`;
        return `<div class="ng-form ng-box" data-ng-form="ai-hello">
          <div class="ng-btns">${hello?.busy ? btnHTML('stophello', 'Stop', 'Stop waiting for the answer.')
            : btnHTML('hello', hello ? 'Say hello again' : 'Say hello', `Sends one hello to ${n}, and shows what it says back.`)}</div>${res}</div>`;
      }
      return '';
    }

    function noteItems(list) {
      return list.length ? `<ul class="ng-notes">${list.slice().reverse().map((x) => {
        const c = contextLine(x.context);
        return `<li><small>${esc(stamp(x.at))}${x.where ? ` · ${esc(x.where)}` : ''}${c ? `<br>${esc(c)}` : ''}</small>
          <div>${esc(x.text)}</div>${btnHTML('delnote', 'Delete', 'Delete this note.', `data-ng-id="${esc(x.id)}"`)}</li>`;
      }).join('')}</ul>` : '';
    }
    function draftHTML() {
      if (!draft) return '';
      if (draft.busy) return '<p class="ng-status" data-ng-draft>Writing the note…</p>';
      return `<div class="ng-draft" data-ng-draft>
          ${draft.reason ? `<p class="ng-status">${esc(draft.reason)}</p>` : ''}
          <textarea data-ng-field="draft" aria-label="The note">${esc(draft.text)}</textarea>
          <div class="ng-btns">${btnHTML('savenote', 'Save note', 'Keep this note in your notes.')}${btnHTML('dropnote', 'Discard', 'Throw this draft away.')}</div></div>`;
    }
    const WHERE_KEPT = {
      person: 'Kept on your account: they follow you to every screen you sign into.',
      panel: 'Kept with this Nimrod panel on this dashboard (nobody is signed in as a person here).',
      memory: 'Kept only until this page closes: copy them or save them as a file.',
    };

    // THE NOTES VIEW (2026-10-03): write one, see them all, copy or save them. Reached from his bottom row, the
    // N key, a "guide" act, or GUIDE_TOPICS.notes from the host.
    function notesHTML() {
      const n = aiP.name;
      const c = contextLine(noteContext());
      return `
        <div class="ng-head"><img src="${esc(catImageURL('talking'))}" alt="">
          <div><b>Your notes</b><div class="ng-where">${notes.length} kept${notes.length >= NOTES_MAX ? ' (the most kept: the oldest goes next)' : ''}</div></div></div>
        <div class="ng-btns">${btnHTML('guide', '‹ Back to the guide', 'Back to the guide’s choices.')}
          ${btnHTML('talk', `Talk to ${esc(n)}`, `Talk it over with ${n}; “Make a note” there turns the talk into a note.`)}</div>
        <label class="ng-status" for="ng-f-quick">Write a note</label>
        <textarea id="ng-f-quick" class="ng-quick" data-ng-field="quick" maxlength="4000" placeholder="What you noticed, what you would change…"></textarea>
        <p class="ng-status" data-ng-context>${c ? `It will say when, and ${esc(c)}.` : 'It will say when it was written.'}</p>
        ${listening && nextAs === 'note' ? '<p class="ng-status" data-ng-listening role="status">Listening for your note…</p>' : '<p class="ng-status" data-ng-voicetip>Hands free: say the wake phrase, then “make a note” and the note.</p>'}
        <div class="ng-btns">${btnHTML('savequick', 'Save note', 'Keep this note, with the time and where you were.')}
          ${chat.log().some((m) => m.role === 'user') ? btnHTML('makenote', `Make a note from the talk with ${esc(n)}`, 'Turn the conversation into a short note you can edit and keep.') : ''}</div>
        ${draftHTML()}
        ${notice ? `<p class="ng-status" data-ng-notice>${esc(notice)}</p>` : ''}
        ${nearlyFull(notes) ? `<p class="ng-warn" data-ng-full>${notes.length} of ${NOTES_MAX} notes: past ${NOTES_MAX} the oldest goes. Copy them or save them as a file first.</p>` : ''}
        <div class="ng-btns">${btnHTML('copynotes', `Copy all notes${notes.length ? ` (${notes.length})` : ''}`, 'Put every note on the clipboard, dated, to paste anywhere.', notes.length ? '' : 'disabled')}
          ${btnHTML('exportfile', 'Save as a file (.md)', 'Save every note as a Markdown file in your downloads.', notes.length ? '' : 'disabled')}</div>
        ${exportText ? `<textarea class="ng-export" data-ng-export readonly aria-label="Your notes as text">${esc(exportText)}</textarea>` : ''}
        <p class="ng-status" data-ng-kept>${esc(WHERE_KEPT[store?.kind] || '')}</p>
        ${movedNote ? `<p class="ng-status" data-ng-moved>${esc(movedNote)}</p>` : ''}
        ${noteItems(notes)}`;
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
          ${backendRow()}
          ${backend === 'claude' ? (onScreen()
            ? `<p class="ng-status">Claude, on this account: no key in this browser. The key, the model and the daily limit are on the Claude settings page:</p>${elsewhere(CLAUDE_SETTINGS_PAGE)}`
            : `<p class="ng-status">Claude, on this account: no key in this browser. The key, the model and the
            daily limit are on the <a href="${esc(CLAUDE_SETTINGS_PAGE)}" target="_blank" rel="noopener" data-ng-claude-page>Claude settings page ↗</a>.</p>`)
            : `<label for="ng-f-url">AI address (this device)</label><input id="ng-f-url" data-ng-field="baseUrl" type="url" spellcheck="false" value="${esc(s.baseUrl || DEFAULT_BASE_URL)}">
          <label for="ng-f-model">Model (blank: choose one on this computer automatically)</label><input id="ng-f-model" data-ng-field="model" spellcheck="false" value="${esc(s.model || '')}">
          <label for="ng-f-key">Your own key, if the service needs one (kept in this browser only)</label>
          <input id="ng-f-key" data-ng-field="key" type="password" autocomplete="off" placeholder="${keySaved ? 'A key is saved' : 'None'}">`}
          <div class="ng-btns" style="margin-top:8px">
            ${btn('savesetup', 'Save', 'Keep these, and try the AI again.')}
            ${keySaved ? btn('forgetkey', 'Forget the key', 'Remove the saved key from this browser.') : ''}
            ${btn('actfreely', `Let ${esc(n)} act without asking: ${aiP.actFreely ? 'on' : 'off'}`, 'Off: every action is a button you press first. On: they happen as soon as it asks.', `aria-pressed="${aiP.actFreely}"`)}
            ${btn('listenms', `Stop listening after: ${listenLabel(aiP.listenMs)}`, 'How long “Talk” keeps listening after the last thing it heard.')}
          </div></div>` : '';
      const notesList = noteItems(notes);
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
          ${btn('listen', listening ? (nextAs === 'note' ? 'Listening for your note… press to stop' : onceOnly ? 'Listening for your question… press to stop' : 'Listening… press to stop') : 'Talk', listening ? 'Stop sending what is said to the chat.' : `Say what you want to ${n}; the wake phrase still gives a command. Hands free: say the wake phrase, then “ask ${n}” and your question.`, `aria-pressed="${listening}"`)}
          ${thinking ? btn('cancel', 'Stop', 'Stop waiting for this answer.') : ''}
          ${btn('makenote', 'Make a note', 'Turn this conversation into a short note you can edit and keep.')}
          ${btn('setup', `About ${esc(n)}`, 'Its name, how it talks, and which AI answers.', `aria-expanded="${setupOpen}"`)}
          ${btn('notes', `Notes${notes.length ? ` (${notes.length})` : ''}`, 'Your notes: write one yourself, copy them all, or save them as a file.')}
        </div>
        ${draftHTML()}
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
      root.innerHTML = `${view === 'talk' ? talkHTML(node) : view === 'notes' ? notesHTML() : guideHTML(node)}
        <div class="ng-info" data-ng-info data-hover-ignore role="status" aria-live="polite" ${prefs.hover ? '' : 'hidden'}>
          <b data-ng-info-title></b><span data-ng-info-text>${esc(INFO_IDLE)}</span></div>`;
      for (const el of root.querySelectorAll('[data-ng-field]')) {
        const k = el.dataset.ngField;
        if (k in kept) el.value = kept[k];
      }
      // A new page of his keeps what the info area last explained (Kontakt's pane does not blank either).
      if (lastInfo) showInfo(lastInfo);
      paintCursor();
      announceAsk();
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
        case 'guide': return a.do === 'notes' ? 'Opens your notes: write one, copy them all, or save them as a file.'
          : `Talk it over with ${aiP.name}, typed or spoken.`;
        default: return '';
      }
    }

    function doPress(what, id) {
      switch (what) {
        case 'talk': setView('talk'); return;
        case 'guide': setView('guide'); return;
        case 'notes': openNotes(); return;
        case 'savequick': saveQuick(); return;
        case 'exportfile': exportFile(); return;
        case 'detect': detectOllama(); return;
        case 'stopdetect': try { detectAbort?.abort(); } catch { /* done */ } return;
        case 'usemodel': useModel(id); return;
        case 'other': setBackend('online'); return;
        case 'backend': setBackend(id); return;
        case 'checkclaude': checkClaude(); return;
        case 'saveother': saveOther(); return;
        case 'hello': sayHello(); return;
        case 'stophello': try { helloAbort?.abort(); } catch { /* done */ } return;
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
        case 'delnote': notes = removeNote(notes, id); notesSink()?.set({ notes }); render(); return;
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
      if (ds.ngChoice != null) {
        const here = nav.current();
        const c = (here.choices || [])[Number(ds.ngChoice)];
        // "Next" on a setup step keeps what is in its form; "Skip this step" (no `keep`) keeps nothing.
        if (c?.keep && here.form) commitForm(here.form);
        if (nav.choose(Number(ds.ngChoice))) arrive({ forward: true });
        return;
      }
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
            if (FIELDS.some((f) => next[f.key] !== prefs[f.key])) { prefs = next; render(); }
          }) || null;
        } catch { offState = null; }
        // The verbs a switch sends him.
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(GUIDE_VERB_TOPICS.next, () => { cursor += 1; paintCursor(); });
        on(GUIDE_VERB_TOPICS.prev, () => { cursor -= 1; paintCursor(); });
        on(GUIDE_VERB_TOPICS.select, () => { const b = stops()[cursor]; if (b) press(b); });
        on(GUIDE_VERB_TOPICS.back, () => {
          if (view !== 'guide') { setView('guide'); return; }
          if (nav.canBack()) { nav.back(1); arrive(); }
        });
        // "Open your notes" from the host (a bar button, its own hotkey): GUIDE_TOPICS.notes.
        on(GUIDE_TOPICS.notes, (p) => openNotes({ focus: p?.via === 'key' }));
        // The N key, heard on the page (the setting `notesKey`; argued at GUIDE_SETTINGS).
        try {
          keyWin = mount.ownerDocument.defaultView || null;
          keyWin?.addEventListener('keydown', onWindowKey);
        } catch { keyWin = null; }
        // The panel picked before Nimrod, so a note written in him still says what it was about.
        try {
          const scope = scopeEl();
          const target = scope?.nodeType === 9 ? scope.body : scope;
          const MO = mount.ownerDocument.defaultView?.MutationObserver;
          if (target && MO) {
            focusWatch = new MO(() => rememberOther());
            focusWatch.observe(target, { subtree: true, attributes: true, attributeFilter: ['data-focused'] });
          }
          rememberOther();
        } catch { focusWatch = null; }
        // Speech: what was said into the chat's dictation window, and whether the speech layer heard us
        // open it (no answer = this screen is not listening, and the person is told).
        on(SPEECH_TOPICS.answer, heard);
        on(SPEECH_TOPICS.answering, (p) => {
          if (p?.on && p.instanceId === (ctx.instanceId || null) && listening) { heardAnswering = true; if (listenHint) { listenHint = ''; render(); } }
        });
        on(DELIVERY_TOPIC, (rec) => { if (holding && rec && aiSaidId != null && rec.id === aiSaidId) release(); });
        // "ask <name> ..." / "make a note ..." by voice, and the name this panel answers to.
        on(SPEECH_TOPICS.ask, onAsk);
        announceAsk();
        // Hover: the whole screen he is on (a kiosk), or the page.
        const scope = mount.closest?.('.kiosk') || mount.ownerDocument;
        hover = watchHover(scope, { enabled: () => prefs.hover && !torn, onInfo: showInfo });
      },
      onResize() {},
      onHide() {
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; }
        // A hidden chat does not keep taking the room's words, and is not asked by voice.
        if (listening) stopListening();
        hidden = true;
        announceAsk();
      },
      onShow() {
        hidden = false;
        announceAsk();
      },
      destroy() {
        if (listening) { listening = false; holding = false; announceGrammar(); }
        torn = true;
        announceAsk();
        clearTimeout(idleTimer); clearTimeout(hintTimer); clearTimeout(holdTimer);
        try { inflight?.abort(); } catch { /* done */ }
        try { detectAbort?.abort(); } catch { /* done */ }
        try { helloAbort?.abort(); } catch { /* done */ }
        try { keyWin?.removeEventListener('keydown', onWindowKey); } catch { /* gone */ }
        try { focusWatch?.disconnect(); } catch { /* gone */ }
        try { game?.destroy(); } catch { /* gone */ }
        try { hover?.stop(); } catch { /* gone */ }
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } }
        if (aiSaidId != null) { try { ctx.output?.cancel?.(aiSaidId); } catch { /* said */ } }
        try { store?.destroy(); } catch { /* gone */ }
        try { notesHome?.destroy(); } catch { /* gone */ }
        root?.removeEventListener('click', onClick);
        root?.removeEventListener('keydown', onKey);
        mount.innerHTML = '';
        root = null;
      },
      // For the suite: where he is, without reaching into the closure.
      __probe: () => ({ id: nav.id(), history: nav.history(), prefs: { ...prefs }, intro, words, cursor,
        stops: stops().map((b) => b.textContent.trim()),
        view, listening, holding, thinking, nextAs, onceOnly, status: { ...status }, ai: { ...aiP }, pending: pending(),
        log: chat.log(), notes: notes.map((x) => ({ ...x })), draft: draft ? { ...draft } : null, notice, listenHint,
        storeKind: store?.kind || null, detect: detect ? { ...detect } : null, hello: hello ? { ...hello } : null,
        otherOpen, lastOther, context: noteContext(), backend, claudeCheck: claudeCheck ? { ...claudeCheck } : null }),
      // For the suite: wait until every message sent so far is answered.
      __settled: () => sendChain,
    };
  },
);
