// modules/voice_model.js — VOICE MODEL, a module (type 'voice_model'): the six steps of making a speech recogniser
// trained on one person's own voice, as a guided panel, one step at a time; then its settings, in the same panel.
//
// Mike, 2026-10-04, about record -> export -> train -> convert -> put the folder in place -> start the service:
// *"I think this might need to be a module that walks people through the setup for it. Then they can change the
// folder or any settings for it later. I guess maybe just a part of the AI module? Or in a set of AI modules?"*
//
// The steps, the commands, the folder rules and the phrase prompter are ../voice_model.js's (ca15b77, 59f2186,
// 93c5a9f) and are USED here, not copied: `voiceModelStatus` says which step the evidence shows, `createPhrasePrompter`
// reads the phrases with the screen's recorder, `convertCommand` / `serviceCommand` are the commands, and
// `checkModelFiles` / `describeModelCheck` judge a folder. The progress is kept in the same place the one-page view
// keeps it (`PHRASES_KEY`), so the two never disagree about how far somebody got.
//
// =====================================================================================================
// THE DECISIONS, each argued, each a default:
//
// 1. A SET, NOT A PART OF THE GUIDE. Both sides: inside Nimrod (the AI module) it is one place for "AI things", and
//    the guide already walks a setup ("Set up your guide / AI", e800a0e). Against, and it decides it: the guide is
//    about the whole site and a voice model is a separate piece of software somebody may want with no guide at all
//    (a person whose speech the recogniser keeps missing, using only spoken commands); and a six-step walk that
//    lasts days (training happens elsewhere) would sit inside the guide's own choices for all that time. So: its
//    own module, in the "AI" group with Nimrod and the profile card (modules_catalog.js, library.js).
//
// 2. ONE STEP ON SCREEN AT A TIME, with Back / Skip this step / Done, next. Where it opens is WORKED OUT, never
//    asked: the most advanced of (a) what the evidence proves (`voiceModelStatus`: phrases read, an export made,
//    the Nimrod folder's Voice model, the last folder checked) and (b) the step after the last one the person
//    pressed "Done, next" on - training happens on another computer this page cannot see, so somebody's own
//    "done" is the only evidence there is for it. "Skip this step" moves on and claims nothing. Proven progress
//    while the panel is open (all phrases read, a converted folder checked) moves it forward by itself; nothing
//    ever moves it back. Finished (a model in place and switched on) it opens on its Settings.
//
// 3. ON A SCREEN. Recording is step 1's whole point and happens on the screen with its microphone. Steps 3, 4 and
//    6 are commands typed on a computer, and step 5's folder picker wants a mouse: on a real screen (`ctx.isScreen`)
//    those steps open with "Do this on your computer", links show their address (and a code to scan, for the
//    notebook) instead of opening a tab over the dashboard (page_links.js's rule), and Copy is not offered. What
//    can be done from a screen still can: re-reading its own Nimrod folder, the "is it answering?" probe, the switch.
//
// 4. WHAT IF NOBODY ANSWERS? Nothing waits: a step is words and buttons, the panel never covers anything, and the
//    probe only reads. The one thing that runs by itself is that probe, every PROBE_EVERY_MS while step 6 is on
//    screen and only then.
//
// 5. EXPORT GOES TO <your Nimrod folder>/Recordings BY DEFAULT (93c5a9f's guess, now wired): the folder this device
//    already has for "Recordings" (its own if somebody chose one, else the Nimrod folder's), asked for from the
//    press. "Choose a different folder" is the override, every time. No Nimrod folder on this device: it says how
//    to make one and offers the override.
//
// 6. SETTINGS, AFTERWARDS, IN THE SAME PANEL: the Nimrod folder's full path (this device only, the same value
//    "Your own folders" keeps - user_folders.js), the port and on / off (this person's own rows, through
//    `ctx.saveVoiceModel`, which writes nothing else), "Start again from step 1", and "All six steps on one page"
//    (the original page, mountVoiceModel, for somebody at a desk who would rather read it all at once). NO MODEL
//    FOLDER TO TYPE: 2026-10-03 settled that the service has one place of its own to look; a model kept elsewhere
//    is `--model`, which the one-page view explains.
//
// Verbs (actions.js MODULE_VERBS.voice_model): next / prev walk the buttons, select presses the lit one, back is
// the walk's own Back (a step, or out of Settings).

import { registerModule } from '../module.js';
import {
  STEPS, EUPHONIA, BASE_MODEL, MODEL_FILES, VOICE_FOLDER, NIMROD_ROOT_WORDS, VOICE_PLACE, RECORDINGS_PLACE, PHRASE_CHARS,
  VOICE_MODEL_PORT, PHRASES_KEY, voiceModelFrom, voiceModelStatus, convertCommand, serviceCommand, checkModelFiles,
  describeModelCheck, folderNames, parsePhrases, createPhrasePrompter, prompterBlocker, mountVoiceModel,
  modelFolderPicker, nimrodVoiceFolder, voiceModelStorage,
} from '../voice_model.js';
import { exportEuphonia, createIdbPairStore, createMemoryPairStore, EUPHONIA_DATA } from '../voice_recording.js';
import {
  SUBFOLDERS, ROOT_KEY, ROOT_MODE, kindKey, handleStore, allowAgain, subfolder, joinPath, saveRootPath,
} from '../user_folders.js';
import { available as fsAvailable, pickFolder } from '../fs_sink.js';
import { qrSVG } from '../qr.js';
import { themeQrColours } from '../page_links.js';

export const VOICE_MODEL_TYPE = 'voice_model';
export const VOICE_MODEL_TITLE = 'Voice model';
export const VOICE_MODEL_VERB_TOPICS = Object.freeze(Object.fromEntries(
  ['next', 'prev', 'select', 'back'].map((v) => [v, `voice_model/${v}`]),
));
export const STEP_COUNT = STEPS.length;

// THE PROBE'S TWO NUMBERS, argued rather than made settings: a speech service on this computer answers /health in
// milliseconds, so 3 s is already patient and a slower answer is as good as none to somebody looking at the step;
// and every 5 s while step 6 is showing is quick enough to see "it's answering" moments after starting it, at the
// cost of one tiny local request - and none at all on any other step.
export const PROBE_TIMEOUT_MS = 3000;
export const PROBE_EVERY_MS = 5000;
export const serviceHealthUrl = (port = VOICE_MODEL_PORT) => `http://127.0.0.1:${port}/health`;

// ---------------------------------------------------------------------------------------------------
// WHAT EACH STEP NEEDS AND WHERE IT IS DONE (pure data). `where`: 'screen' (the screen you talk to), 'either', or
// 'computer' (a keyboard and a terminal: on a screen it says "Do this on your computer").
// ---------------------------------------------------------------------------------------------------
export const STEP_GUIDE = Object.freeze([
  Object.freeze({ n: 1, where: 'screen',
    need: 'A microphone on this screen; “Record this person’s voice for training” and spoken commands (or subtitles) '
      + 'turned on in this person’s settings; and the list of phrases to read.' }),
  Object.freeze({ n: 2, where: 'either',
    need: 'The recordings from step 1, on this screen, and a folder to save them in.' }),
  Object.freeze({ n: 3, where: 'computer',
    need: 'A free Google account, to run the training notebook on Google Colab (a computer Google lends you, with a '
      + 'graphics card, in your web browser), or a computer with a graphics card of its own. An ordinary laptop alone '
      + 'takes a very long time.' }),
  Object.freeze({ n: 4, where: 'computer',
    need: 'The checkpoint training left, and Python with the ctranslate2 and transformers packages.' }),
  Object.freeze({ n: 5, where: 'computer',
    need: 'The folder the conversion wrote, and the computer that runs the speech service.' }),
  Object.freeze({ n: 6, where: 'computer',
    need: 'The project’s web folder on that computer, and Python 3.13 (python3 on a Mac or Linux).' }),
]);

// ---------------------------------------------------------------------------------------------------
// THE WALK (pure). Where it opens, and how Back / Skip / Done move it (decision 2).
// ---------------------------------------------------------------------------------------------------
const clampStep = (n) => Math.max(1, Math.min(STEP_COUNT, Math.round(Number(n) || 1)));

/** The step it opens on: the evidence's, or the one after the last "Done, next", whichever is further. Pure. */
export function openingStep({ evidence = null, doneTo = 0 } = {}) {
  const ev = evidence && Number.isFinite(Number(evidence.step)) ? Number(evidence.step) : 1;
  const own = Math.max(0, Math.round(Number(doneTo) || 0));
  return clampStep(Math.max(ev, own + 1));
}

/**
 * The walk: `{ state, next, back, go, settings, steps, onePage, evidence, restart }`. `view` is 'steps', 'settings'
 * or 'onepage'. next({ claim }) - "Done, next" claims the step (remembered as `doneTo`), "Skip this step" does not;
 * past the last step it is the Settings. evidence(ev) moves it forward when proven progress passes the step on
 * screen, never back. Pure (no DOM).
 */
export function createWalk({ evidence = null, doneTo = 0, onChange = null } = {}) {
  let done = Math.max(0, Math.min(STEP_COUNT, Math.round(Number(doneTo) || 0)));
  let seen = evidence && Number(evidence.step) ? clampStep(evidence.step) : 1;
  let at = openingStep({ evidence, doneTo: done });
  let view = evidence && evidence.done ? 'settings' : 'steps';
  const state = () => ({ at, view, evidence: seen, doneTo: done, first: at === 1, last: at === STEP_COUNT });
  const emit = () => { try { onChange?.(state()); } catch (err) { console.error('voice model: walk', err); } };
  return {
    state,
    next({ claim = false } = {}) {
      if (view !== 'steps') return state();
      if (claim) done = Math.max(done, at);
      if (at >= STEP_COUNT) view = 'settings'; else at += 1;
      emit();
      return state();
    },
    back() {
      if (view === 'onepage') view = 'settings';
      else if (view === 'settings') view = 'steps';
      else if (at > 1) at -= 1;
      else return state();
      emit();
      return state();
    },
    go(n) { at = clampStep(n); view = 'steps'; emit(); return state(); },
    settings() { view = 'settings'; emit(); return state(); },
    steps() { view = 'steps'; emit(); return state(); },
    onePage() { view = 'onepage'; emit(); return state(); },
    evidence(ev) {
      const step = ev && Number(ev.step) ? clampStep(ev.step) : seen;
      // Only NEW proof moves it: the furthest step ever proven is remembered, so evidence that wobbles (a folder
      // checked, then a different one) does not drag back to a step somebody chose to leave.
      const moved = step > seen && step > at && view === 'steps';
      seen = Math.max(seen, step);
      if (moved) { at = step; emit(); }
      return state();
    },
    /** Back to step 1, nothing claimed; `ev` (the evidence after the reset) is what new proof is measured from. */
    restart(ev = null) {
      at = 1; done = 0; view = 'steps';
      if (ev && Number(ev.step)) seen = clampStep(ev.step);
      emit();
      return state();
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// "IS IT ANSWERING?" (decision 4). The service's /health (web/speech_service/service.py) says it is up and which
// engine. It sends no header letting another site READ that answer, so a page served from anywhere else gets a
// network error from a plain request even when the service is up - which is why a second, `no-cors` request is
// made: it cannot read the answer either, but it resolves when something answered and fails when nothing did.
// Resolves `{ answering: true|false|null, engine, why }`, why: 'ok' | 'opaque' | 'status <n>' | 'refused' |
// 'timeout' | 'no-fetch'. Never throws.
// ---------------------------------------------------------------------------------------------------
export async function probeVoiceService({ port = VOICE_MODEL_PORT, fetchImpl = (typeof fetch === 'function' ? fetch : null),
  timeoutMs = PROBE_TIMEOUT_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
  if (typeof fetchImpl !== 'function') return { answering: null, engine: null, why: 'no-fetch' };
  const url = serviceHealthUrl(port);
  let timedOut = false;
  const attempt = async (mode) => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let t = null;
    const expiry = new Promise((_, reject) => {
      t = setTimer(() => { timedOut = true; try { ctl?.abort(); } catch { /* gone */ } reject(new Error('timeout')); }, timeoutMs);
    });
    try {
      return await Promise.race([fetchImpl(url, { mode, cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) }), expiry]);
    } finally { clearTimer(t); }
  };
  try {
    const r = await attempt('cors');
    if (r && r.ok && r.type !== 'opaque') {
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { answering: true, engine: body && body.engine ? String(body.engine) : null, why: 'ok' };
    }
    if (r && r.type !== 'opaque' && Number(r.status)) return { answering: true, engine: null, why: `status ${r.status}` };
  } catch { if (timedOut) return { answering: false, engine: null, why: 'timeout' }; }
  try {
    await attempt('no-cors');
    return { answering: true, engine: null, why: 'opaque' };
  } catch {
    return { answering: false, engine: null, why: timedOut ? 'timeout' : 'refused' };
  }
}

/** The words for a probe result. Pure. */
export function describeProbe(r, { port = VOICE_MODEL_PORT } = {}) {
  if (!r) return '';
  if (r.answering === null) return 'This browser cannot check: start the service and watch its window for “Uvicorn running”.';
  if (r.answering && r.why === 'ok') return `It is answering on port ${port}${r.engine ? `, with “${r.engine}”` : ''}.`;
  if (r.answering && r.why === 'opaque') {
    return `Something is answering on port ${port}. This page is not allowed to read which recogniser it is; if it is the `
      + 'speech service you started, it is running.';
  }
  if (r.answering) return `Something answered on port ${port}, but not as the speech service does (${r.why}). Is it another program?`;
  return `Nothing is answering on port ${port} yet. Start it with the command above, on this computer, and leave its window `
    + 'open. If it is running and this still says no, the browser may be blocking this page from reaching the computer it '
    + 'is on: allow it in the site’s settings.';
}

// ---------------------------------------------------------------------------------------------------
// WHERE AN EXPORT GOES BY DEFAULT (decision 5): this device's Recordings folder - the kind's own folder if somebody
// chose one, else the Nimrod folder's "Recordings" (made if it was deleted). Asks the browser to let this page write
// there, so ONLY FROM A PRESS. Resolves `{ dir, name, source }`, or `{ dir: null, why: 'none'|'permission'|'missing' }`.
// ---------------------------------------------------------------------------------------------------
export async function recordingsFolder({ store = handleStore(), names = SUBFOLDERS } = {}) {
  const get = async (k) => { try { return await store.get(k); } catch { return null; } };
  const own = await get(kindKey('recordings'));
  if (own) {
    const p = await allowAgain(own, ROOT_MODE);
    return p === 'granted' ? { dir: own, name: String(own.name || ''), source: 'own' } : { dir: null, why: 'permission', name: String(own.name || '') };
  }
  const root = await get(ROOT_KEY);
  if (!root) return { dir: null, why: 'none', name: '' };
  const p = await allowAgain(root, ROOT_MODE);
  if (p !== 'granted') return { dir: null, why: 'permission', name: String(root.name || '') };
  let dir = await subfolder(root, 'recordings', { names });
  if (!dir) { try { dir = await root.getDirectoryHandle(names.recordings || 'Recordings', { create: true }); } catch { dir = null; } }
  return dir ? { dir, name: `${root.name || ''}/${dir.name || names.recordings}`, source: 'root' }
    : { dir: null, why: 'missing', name: String(root.name || '') };
}

// ---------------------------------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------------------------------
export const VOICE_MODEL_GUIDE_CSS = `
.vmg{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;color:var(--text);font:inherit;
  display:flex;flex-direction:column;gap:10px}
.vmg *{box-sizing:border-box}
.vmg h3{margin:0;font-size:1.1rem}
.vmg h4{margin:0;font-size:1.25rem;line-height:1.25}
.vmg p{margin:2px 0}
.vmg a{color:inherit}
.vmg-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.vmg-soft{color:var(--text-muted)}
.vmg-bar,.vmg-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.vmg button,.vmg .vmg-btn{min-height:44px;padding:6px 14px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface-alt,var(--surface));color:var(--text);font:inherit;cursor:pointer;text-decoration:none;
  display:inline-flex;align-items:center;gap:6px;position:relative}
.vmg button[disabled]{opacity:.55;cursor:default}
.vmg button.primary{border-color:var(--accent);font-weight:600}
.vmg button[aria-pressed="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent)}
.vmg .is-scan,.vmg button:focus-visible,.vmg .vmg-btn:focus-visible{outline:3px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.vmg-btn input[type=file]{position:absolute;opacity:0;width:1px;height:1px}
.vmg-step{border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;
  background:var(--surface)}
.vmg-where{border-left:4px solid var(--accent);padding:4px 10px;font-weight:600}
.vmg code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;overflow-wrap:anywhere}
.vmg code[data-cmd]{display:block;padding:8px 10px;border-radius:8px;border:1px solid var(--border);white-space:pre-wrap;
  word-break:break-all;user-select:all}
.vmg textarea,.vmg input[type=text],.vmg input[type=number]{width:100%;font:inherit;padding:6px 10px;border-radius:10px;
  border:1px solid var(--border);background:var(--bg,var(--surface));color:var(--text)}
.vmg textarea{min-height:6em}
.vmg input[type=text],.vmg input[type=number]{min-height:44px}
.vmg input[type=number]{max-width:12em}
.vmg-phrase{font-size:1.8em;font-weight:600;line-height:1.25;margin:4px 0}
.vmg-qr{width:min(180px,60%)}
.vmg-address{overflow-wrap:anywhere;font-weight:600}
.vmg label{display:flex;flex-direction:column;gap:4px}`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const shortAddress = (url) => String(url || '').replace(/^https?:\/\//, '');

/**
 * `mountVoiceModelGuide(root, opts)` -> { verb, refresh, destroy, ready, walk, __probe }.
 *   personId, values() (this person's row), save(patch) (only voiceModelOn / voiceModelPort; absent: names the menu)
 *   recorder, store       the screen's voice recorder and its pair store (absent on a page that does not listen)
 *   isScreen              a real screen (decision 3)
 *   storage               where the progress is kept on this screen (voice_model.js PHRASES_KEY's shape)
 *   nimrodFolder          { path(), voice() } (voice_model.js's default: this device's own)
 *   pickModelFolder       "Check a folder" (null hides it)
 *   recordingsDir()       the default export folder (recordingsFolder); fs { available(), pickFolder() } the override
 *   probe({ port })       the "is it answering?" check; copy(text) the clipboard
 *   rootPathStorage       where the Nimrod folder's typed path is kept (user_folders.js's default when absent)
 *   setTimer / clearTimer / every / stopEvery   for a suite
 */
export function mountVoiceModelGuide(root, {
  personId = null, values = () => ({}), save = null, recorder = null, store = null, isScreen = false,
  storage = voiceModelStorage(), nimrodFolder = nimrodVoiceFolder(), pickModelFolder = modelFolderPicker(),
  recordingsDir = () => recordingsFolder(), fs = null, probe = (o) => probeVoiceService(o),
  copy = null, rootPathStorage = undefined,
  every = (fn, ms) => setInterval(fn, ms), stopEvery = (t) => clearInterval(t),
} = {}) {
  if (!root) throw new Error('mountVoiceModelGuide: a root element is required');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const row = () => { try { return values() || {}; } catch { return {}; } };
  let vm = voiceModelFrom(row());
  let destroyed = false;
  const key = PHRASES_KEY(personId);
  const load = () => { try { return JSON.parse(storage?.getItem(key) || 'null') || {}; } catch { return {}; } };
  const keep = (x) => { try { storage?.setItem(key, JSON.stringify({ ...load(), ...x })); } catch { /* this visit only */ } };
  let phrases = parsePhrases(load().text || '').phrases;
  let prompter = null;
  let nimrodCheck = null;
  let pickedCheck = null;
  let probeResult = null;
  let probing = false;
  let probeT = null;
  let armedRestart = false;
  let onePage = null;
  let cursor = -1;
  const notes = { export: '', check: '', settings: '', copy: '' };

  const rootPath = () => { try { return String(nimrodFolder?.path?.() || ''); } catch { return ''; } };
  const places = () => {
    const p = rootPath();
    return { root: p || NIMROD_ROOT_WORDS, voice: p ? joinPath(p, VOICE_FOLDER) : VOICE_PLACE,
      recordings: p ? joinPath(p, SUBFOLDERS.recordings) : RECORDINGS_PLACE, known: !!p };
  };
  const phraseIndex = () => (prompter ? prompter.state().index : (load().index || 0));
  const evidence = () => voiceModelStatus({ total: phrases.length, index: phraseIndex(), exported: !!load().exportedAt,
    nimrod: nimrodCheck, picked: pickedCheck, on: vm.on, place: places().voice });

  const walk = createWalk({ evidence: evidence(), doneTo: load().doneTo || 0,
    onChange: (s) => { keep({ doneTo: s.doneTo }); } });

  root.innerHTML = `<style>${VOICE_MODEL_GUIDE_CSS}</style>
    <div class="vmg" data-vmg>
      <div class="vmg-head"><h3>${esc(VOICE_MODEL_TITLE)}</h3><span class="vmg-soft" data-vmg-count></span></div>
      <p class="vmg-soft" data-vmg-seen role="status" aria-live="polite"></p>
      <div class="vmg-bar" data-vmg-bar></div>
      <div data-vmg-body></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const body = $('[data-vmg-body]');

  // ---- links and commands, as fits where this is ----
  const qrColours = () => { try { return themeQrColours(root.querySelector('.vmg')); } catch { return null; } };
  function linkHtml(href, text, { qr = false } = {}) {
    if (!isScreen) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-vmg-link>${esc(text)}</a>`;
    const c = qr ? qrColours() : null;
    let code = '';
    if (c) { try { code = qrSVG(href, { level: 'M', quiet: 4, dark: c.dark, light: c.light, title: `Scan to open ${text}` }); } catch { code = ''; } }
    return `<span data-vmg-addr>${esc(text)}: on your phone or computer, open <span class="vmg-address">${esc(shortAddress(href))}</span></span>`
      + (code ? `<div class="vmg-qr" data-vmg-qr>${code}</div>` : '');
  }
  const cmdHtml = (id, text) => `<code data-cmd="${esc(id)}">${esc(text)}</code>`
    + (isScreen ? '' : `<div class="vmg-row"><button type="button" data-vmg-act="copy" data-vmg-copy="${esc(id)}">Copy</button></div>`);

  // ---- the walk's own bar ----
  function barHtml(s) {
    if (s.view === 'settings') {
      return '<button type="button" data-vmg-act="steps" class="primary">Back to the steps</button>';
    }
    if (s.view === 'onepage') return '<button type="button" data-vmg-act="back">Back to the settings</button>';
    return `<button type="button" data-vmg-act="back" ${s.first ? 'disabled' : ''}>Back</button>
      <button type="button" data-vmg-act="skip">Skip this step</button>
      <button type="button" data-vmg-act="done" class="primary">${s.last ? 'Done' : 'Done, next'}</button>
      <button type="button" data-vmg-act="settings">Settings</button>`;
  }

  // ---- each step's body ----
  function whereHtml(n) {
    const g = STEP_GUIDE[n - 1];
    if (!isScreen || !g || g.where !== 'computer') return '';
    return '<p class="vmg-where" data-vmg-where>Do this on your computer: it needs a keyboard and a terminal. This screen shows '
      + 'the words, and moves on when you press Done.</p>';
  }
  function stepHtml(n) {
    const g = STEP_GUIDE[n - 1];
    const pl = places();
    const head = `<h4>${esc(`${n}. ${STEPS[n - 1]}`)}</h4>${whereHtml(n)}
      <p><b>What you need:</b> ${esc(g.need)}</p>`;
    if (n === 1) {
      return `${head}
        <p>Read about 100 short phrases aloud, one at a time. Each recording is kept on this screen with the phrase it is;
          the next phrase comes up once it has been saved. A pause mid-phrase ends a recording, so set “A pause this long
          ends what was said” to Long while you read. Leave “Use my own voice model” off until the model exists.</p>
        <p>The phrases: Euphonia’s list (${linkHtml(EUPHONIA.phrases, 'its 100 phrases')}; this site does not ship a copy), or
          your own, one per line. Pasting them needs a keyboard here, or load a text file.</p>
        <textarea data-vmg-phrases aria-label="Phrases to read, one per line"></textarea>
        <div class="vmg-row">
          <button type="button" data-vmg-act="use-phrases">Use these phrases</button>
          <label class="vmg-btn">Load a text file<input type="file" data-vmg-load accept=".txt,text/plain"></label>
          <span class="vmg-soft" data-vmg-phrase-summary></span>
        </div>
        <p class="vmg-soft" data-vmg-progress></p>
        <p class="vmg-phrase" data-vmg-phrase aria-live="polite"></p>
        <p data-vmg-status role="status" aria-live="polite"></p>
        <div class="vmg-row">
          <button type="button" data-vmg-act="start" class="primary">Start reading</button>
          <button type="button" data-vmg-act="stop" hidden>Stop</button>
          <button type="button" data-vmg-act="prev-phrase">Previous phrase</button>
          <button type="button" data-vmg-act="skip-phrase">Skip this phrase</button>
          <button type="button" data-vmg-act="again" hidden>Again</button>
        </div>`;
    }
    if (n === 2) {
      const can = !!store;
      const pick = !!(fs && typeof fs.available === 'function' && fs.available());
      return `${head}
        <p>Export saves your recordings, each with the phrase it is, into a folder, in the layout the training notebook reads:
          a <code>${esc(EUPHONIA_DATA)}</code> folder with one numbered folder per phrase, and <code>nimrod-export.json</code>
          saying which recording is which. Nothing is uploaded.</p>
        <p>Where it goes: <code data-vmg-recordings>${esc(pl.recordings)}</code>, your Nimrod folder’s Recordings.</p>
        ${can ? '' : '<p class="vmg-soft" data-vmg-nostore>There is nothing to export on this page: recordings are kept on the screen that recorded them. Open this panel there.</p>'}
        <div class="vmg-row">
          <button type="button" data-vmg-act="export-default" class="primary" ${can ? '' : 'hidden'}>Export to Recordings</button>
          <button type="button" data-vmg-act="export-pick" ${can && pick ? '' : 'hidden'}>Choose a different folder</button>
        </div>
        <p data-vmg-export-msg role="status" aria-live="polite">${esc(notes.export)}</p>
        <p class="vmg-soft">Then take that folder to the computer that trains (or leave it where it is, if that is this one).</p>`;
    }
    if (n === 3) {
      return `${head}
        <p>Open ${linkHtml(EUPHONIA.notebook, 'the training notebook', { qr: true })} (Google’s Project Euphonia toolkit,
          ${linkHtml(EUPHONIA.repo, 'its home page')}, ${esc(EUPHONIA.licence)}).</p>
        <p>Set its model to this (type it; the list does not offer it), so the result matches the recogniser the speech
          service already runs:</p>
        ${cmdHtml('base', BASE_MODEL)}
        <p>Its data cell copies from a Firebase bucket: point it at the <code>${esc(EUPHONIA_DATA)}</code> folder you
          exported instead. On your own computer, skip the three Colab-only cells (sign-in, Google Drive, TensorBoard), and
          turn fp16 off if there is no graphics card. Training leaves a <b>checkpoint</b>: a folder named like
          <code>checkpoint-200</code>.</p>`;
    }
    if (n === 4) {
      return `${head}
        <p>The speech service cannot load a checkpoint; converting makes the folder it can. <b>This is the step that makes
          your voice model folder.</b> Run this, with the checkpoint’s folder in place of the first name:</p>
        ${cmdHtml('convert', convertCommand({ folder: pl.voice }))}
        <p class="vmg-soft">${pl.known
          ? 'That writes the converted files straight into your Nimrod folder’s Voice model folder. Converting on a different computer? Run it there with that computer’s path, then copy the files across.'
          : esc(`Replace ${NIMROD_ROOT_WORDS} with your Nimrod folder’s full path, or type that path once in this panel’s Settings and the commands fill it in.`)}</p>`;
    }
    if (n === 5) {
      const canPick = typeof pickModelFolder === 'function' && !isScreen;
      return `${head}
        <p><b>The folder you want is the one the conversion wrote</b>, not the checkpoint and not the recordings. It holds:
          ${esc(MODEL_FILES.join(', '))}. Its place: <code data-vmg-place>${esc(pl.voice)}</code>. Put the files directly in
          it, on the computer that runs the speech service.</p>
        <div class="vmg-row">
          <button type="button" data-vmg-act="check" ${canPick ? '' : 'hidden'}>Check a folder</button>
          <button type="button" data-vmg-act="look">Look in my Nimrod folder again</button>
        </div>
        <p data-vmg-check-msg role="status" aria-live="polite">${esc(notes.check)}</p>
        <p class="vmg-soft">${canPick ? 'Check a folder reads the <i>names</i> of the files in the folder you choose. It opens no file and sends nothing anywhere.'
          : 'Look in my Nimrod folder again reads the names in this device’s Voice model folder, if this device has a Nimrod folder.'}</p>`;
    }
    return `${head}
      <p>Run this in the project’s <code>web</code> folder, on the computer that runs the speech service. It checks the folder
        when it starts and names any file that is missing.</p>
      ${cmdHtml('serve', serviceCommand({ port: vm.port, root: pl.root }))}
      <p class="vmg-soft">It runs beside the standard recogniser (port 8797), which stays for everybody else. Its port is this
        panel’s Settings, and the two numbers must match.</p>
      <div class="vmg-row">
        <button type="button" data-vmg-act="probe" class="primary">Is it answering?</button>
        <button type="button" data-vmg-act="use" aria-pressed="${vm.on}" ${typeof save === 'function' ? '' : 'hidden'}>Use my own voice model: ${vm.on ? 'On' : 'Off'}</button>
      </div>
      <p data-vmg-probe role="status" aria-live="polite">${esc(probing ? 'Checking…' : describeProbe(probeResult, { port: vm.port }))}</p>
      <p class="vmg-soft" data-vmg-use-note>${esc(useNote())}</p>`;
  }
  const useNote = () => (typeof save !== 'function'
    ? 'Turn on “Use my own voice model” in this person’s settings (Devices, Voice) once it is answering.'
    : vm.on ? `On: your speech goes to ${vm.url}. If it is not running, this screen says no recogniser is answering.`
      : 'Off: your speech goes to the standard recogniser. Turn it on once it is answering.');

  function settingsHtml() {
    const pl = places();
    const canSave = typeof save === 'function';
    return `<h4>Settings</h4>
      <p class="vmg-soft">${esc(evidence().done ? 'You have it, in its place, and it is on.' : 'You can come back to the steps at any time.')}</p>
      <label>Your Nimrod folder’s full path (this device only)
        <input type="text" data-vmg-root value="${esc(rootPath())}" placeholder="D:\\Nimrod" spellcheck="false" autocomplete="off"></label>
      <div class="vmg-row"><button type="button" data-vmg-act="save-root">Save the path</button>
        <button type="button" data-vmg-act="forget-root" ${rootPath() ? '' : 'hidden'}>Forget it</button></div>
      <p class="vmg-soft">The commands use it (<code>${esc(pl.voice)}</code>). It is the same path “Your own folders” keeps, kept in
        this browser only. A screen with no keyboard: type it on the computer that runs the speech service instead.</p>
      <label>Its port
        <input type="number" data-vmg-port value="${esc(vm.port)}" min="1024" max="65535" step="1" ${canSave ? '' : 'disabled'}></label>
      <div class="vmg-row"><button type="button" data-vmg-act="save-port" ${canSave ? '' : 'hidden'}>Save the port</button>
        <button type="button" data-vmg-act="use" aria-pressed="${vm.on}" ${canSave ? '' : 'hidden'}>Use my own voice model: ${vm.on ? 'On' : 'Off'}</button></div>
      ${canSave ? '' : '<p class="vmg-soft" data-vmg-nosave>This page cannot change a person’s settings: the port and the switch are in the ⚙ menu, Devices, Voice.</p>'}
      <p data-vmg-settings-msg role="status" aria-live="polite">${esc(notes.settings)}</p>
      <div class="vmg-row">
        <button type="button" data-vmg-act="restart">${armedRestart ? 'Press again: start again from step 1' : 'Start again from step 1'}</button>
        <button type="button" data-vmg-act="onepage" ${isScreen ? 'hidden' : ''}>All six steps on one page</button>
      </div>
      <p class="vmg-soft">Starting again keeps the phrase list and every recording; it only goes back to step 1.</p>`;
  }

  // ---- drawing ----
  let drawnKey = '';
  function draw({ force = false } = {}) {
    if (destroyed) return;
    const s = walk.state();
    const ev = evidence();
    $('[data-vmg-count]').textContent = s.view === 'steps' ? `Step ${s.at} of ${STEP_COUNT}` : s.view === 'settings' ? 'Settings' : 'All six steps';
    $('[data-vmg-seen]').textContent = `What this screen can see: step ${ev.step} of ${STEP_COUNT}. ${ev.text}`;
    const k = `${s.view}:${s.at}`;
    if (force || k !== drawnKey) {
      const litAct = litEl()?.dataset?.vmgAct || null;
      if (onePage && s.view !== 'onepage') { try { onePage.destroy(); } catch { /* gone */ } onePage = null; }
      $('[data-vmg-bar]').innerHTML = barHtml(s);
      if (s.view === 'onepage') {
        if (!onePage) {
          body.innerHTML = '';
          const box = doc.createElement('div');
          body.append(box);
          onePage = mountVoiceModel(box, { personId, values, save, recorder, store, fs, storage, pickModelFolder, nimrodFolder });
        }
      } else {
        body.innerHTML = `<section class="vmg-step" data-vmg-step="${s.view === 'steps' ? s.at : 'settings'}">${s.view === 'steps' ? stepHtml(s.at) : settingsHtml()}</section>`;
        if (s.view === 'steps' && s.at === 1) {
          const ta = $('[data-vmg-phrases]');
          if (ta) ta.value = load().text || '';
        }
      }
      drawnKey = k;
      // The cursor stays on the button it was on (a switch pressing "Done, next" again and again), else the first.
      const list = stops();
      const i = litAct ? list.findIndex((b) => b.dataset.vmgAct === litAct) : -1;
      cursor = i >= 0 ? i : (cursor >= 0 ? 0 : -1);
      syncProbeTimer();
    }
    if (s.view === 'steps' && s.at === 1) drawPrompt();
    paint();
  }
  function drawPrompt() {
    const sum = $('[data-vmg-phrase-summary]');
    if (!sum) return;
    const ta = $('[data-vmg-phrases]');
    const r = parsePhrases(ta ? ta.value : '');
    const n = phrases.length;
    sum.textContent = n ? `${n} phrase${n === 1 ? '' : 's'}.${r.long.length ? ` ${r.long.length} longer than ${PHRASE_CHARS} characters.` : ''}` : 'No phrases yet.';
    const st = prompter ? prompter.state() : { index: Math.min(phrases.length, load().index || 0), total: phrases.length, phrase: null,
      running: false, done: phrases.length > 0 && (load().index || 0) >= phrases.length, last: null,
      blocked: prompterBlocker(recorder ? recorder.state?.() : null) };
    $('[data-vmg-progress]').textContent = !st.total ? '' : st.done ? `All ${st.total} phrases read.` : `Phrase ${st.index + 1} of ${st.total}`;
    $('[data-vmg-phrase]').textContent = st.running ? (st.phrase || '') : '';
    const lastLine = st.last ? (st.last.ok ? `Saved. It heard: “${st.last.heard || 'nothing it could make out'}”.` : 'That one was not saved.') : '';
    $('[data-vmg-status]').textContent = st.blocked || (st.running ? `Read it now. ${lastLine}` : lastLine);
    const set = (act, hidden, disabled = false) => { const b = root.querySelector(`[data-vmg-act="${act}"]`); if (b) { b.hidden = hidden; b.disabled = disabled; } };
    set('start', st.running, !st.total || !recorder);
    set('stop', !st.running);
    set('again', !(st.last && st.last.ok && store));
  }

  // ---- the stops a switch walks (buttons and links, never a text box) ----
  function stops() {
    return [...root.querySelectorAll('button, a[href], label.vmg-btn')].filter((b) => !b.disabled && !b.hidden && !b.closest('[hidden]'));
  }
  function litEl() { const l = stops(); return cursor >= 0 && cursor < l.length ? l[cursor] : null; }
  function paint() {
    for (const n of root.querySelectorAll('.is-scan')) n.classList.remove('is-scan');
    const el = litEl();
    if (el) { el.classList.add('is-scan'); try { el.scrollIntoView?.({ block: 'nearest' }); } catch { /* old browser */ } }
  }
  function step(d) {
    const n = stops().length;
    if (!n) return;
    cursor = cursor < 0 ? (d > 0 ? 0 : n - 1) : ((cursor + d) % n + n) % n;
    paint();
  }
  function selectVerb() {
    if (cursor < 0) { cursor = 0; paint(); return; }      // the first select only lights the first stop
    const el = litEl();
    if (!el) return;
    if (el.tagName === 'LABEL') { el.querySelector('input')?.click(); return; }
    if (el.tagName === 'A') { try { win?.open?.(el.href, '_blank', 'noopener'); } catch { /* blocked */ } return; }
    el.click();
  }

  // ---- what the presses do ----
  function makePrompter(at) {
    try { prompter?.destroy(); } catch { /* gone */ }
    prompter = createPhrasePrompter({ phrases, recorder, store, list: personId ? `own:${personId}` : 'own', start: at,
      onChange: (st) => { keep({ index: st.index }); afterEvidence(); drawPrompt(); } });
  }
  function afterEvidence() { walk.evidence(evidence()); draw(); }
  async function readNimrodVoice() {
    try {
      const k = await nimrodFolder?.voice?.();
      if (!k || !k.dir || destroyed) return false;
      nimrodCheck = checkModelFiles(await folderNames(k.dir));
      afterEvidence();
      return true;
    } catch { return false; }
  }
  async function checkFolder() {
    let dir = null;
    try { dir = await pickModelFolder(); } catch { return; }      // cancelled is not an error
    if (!dir || destroyed) return;
    try {
      const r = checkModelFiles(await folderNames(dir));
      pickedCheck = { ...r, name: dir.name || '' };
      notes.check = describeModelCheck(r, dir.name || 'That folder', { place: places().voice });
    } catch (err) { console.error('voice model: check folder', err); notes.check = 'Could not look inside that folder.'; }
    setText('[data-vmg-check-msg]', notes.check);
    afterEvidence();
  }
  async function exportTo(dir, label) {
    setText('[data-vmg-export-msg]', notes.export = 'Exporting…');
    try {
      const r = await exportEuphonia(dir, store, { personId });
      const n = r.written.length;
      notes.export = n
        ? `Exported ${n} recording${n === 1 ? '' : 's'} to ${label}${r.failed.length ? `; ${r.failed.length} could not be written` : ''}.`
        : 'There was nothing to export yet: read some phrases first (step 1).';
      if (n) keep({ exportedAt: Date.now() });
    } catch (err) { console.error('voice model: export', err); notes.export = `Could not export into ${label}.`; }
    setText('[data-vmg-export-msg]', notes.export);
    afterEvidence();
  }
  async function exportDefault() {
    if (!store) return;
    let r = null;
    try { r = await recordingsDir(); } catch { r = null; }
    if (destroyed) return;
    if (!r || !r.dir) {
      const why = r && r.why;
      notes.export = why === 'permission'
        ? `The browser did not let this page write to ${r.name || 'that folder'}. Press again to be asked again, or choose a different folder.`
        : why === 'missing' ? 'Your Nimrod folder has no Recordings folder and one could not be made. Choose a different folder.'
          : 'This device has no Nimrod folder yet. Make one with “Set up your Nimrod folder” (Settings, Your own folders), or choose a different folder.';
      setText('[data-vmg-export-msg]', notes.export);
      return;
    }
    await exportTo(r.dir, r.name || SUBFOLDERS.recordings);
  }
  async function exportPick() {
    if (!store || !fs) return;
    let dir = null;
    try { dir = await fs.pickFolder(); } catch { return; }      // cancelled is not an error
    if (!dir || destroyed) return;
    await exportTo(dir, `“${dir.name || 'that folder'}”`);
  }
  async function runProbe() {
    if (probing || destroyed) return;
    probing = true;
    setText('[data-vmg-probe]', 'Checking…');
    let r = null;
    try { r = await probe({ port: vm.port }); } catch { r = { answering: false, engine: null, why: 'refused' }; }
    probing = false;
    if (destroyed) return;
    probeResult = r;
    setText('[data-vmg-probe]', describeProbe(r, { port: vm.port }));
  }
  function syncProbeTimer() {
    const s = walk.state();
    const want = !destroyed && s.view === 'steps' && s.at === STEP_COUNT;
    if (want && probeT == null) { probeT = every(() => { runProbe(); }, PROBE_EVERY_MS); runProbe(); }
    if (!want && probeT != null) { stopEvery(probeT); probeT = null; }
  }
  async function copyCmd(id) {
    const code = root.querySelector(`code[data-cmd="${id}"]`);
    const text = code ? code.textContent : '';
    let ok = false;
    try {
      if (typeof copy === 'function') ok = (await copy(text)) !== false;
      else { await win.navigator.clipboard.writeText(text); ok = true; }
    } catch { ok = false; }
    if (!ok && code) { try { const r = doc.createRange(); r.selectNodeContents(code); const sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch { /* old browser */ } }
    const b = root.querySelector(`[data-vmg-copy="${id}"]`);
    if (b) b.textContent = ok ? 'Copied' : 'Selected: copy it with Ctrl+C';
    notes.copy = ok ? 'copied' : 'selected';
  }
  function setVm(patch) {
    if (typeof save !== 'function') return false;
    let ok = false;
    try { ok = save(patch) !== false; } catch (err) { console.error('voice model: save', err); }
    if (ok) vm = voiceModelFrom({ voiceModelOn: vm.on, voiceModelPort: vm.port, ...row(), ...patch });
    return ok;
  }
  function setText(sel, text) { const n = root.querySelector(sel); if (n) n.textContent = text; }

  function press(act, el) {
    if (act !== 'restart') armedRestart = false;
    switch (act) {
      case 'back': walk.back(); draw(); return;
      case 'skip': walk.next(); draw(); return;
      case 'done': walk.next({ claim: true }); draw(); return;
      case 'settings': walk.settings(); draw(); return;
      case 'steps': walk.steps(); draw(); return;
      case 'onepage': walk.onePage(); draw(); return;
      case 'use-phrases': {
        const text = $('[data-vmg-phrases]')?.value || '';
        phrases = parsePhrases(text).phrases;
        keep({ text, index: 0 });
        makePrompter(0);
        afterEvidence(); drawPrompt();
        return;
      }
      case 'start': if (!prompter) makePrompter(load().index || 0); prompter.start(); return;
      case 'stop': prompter?.stop(); return;
      case 'skip-phrase': if (!prompter) makePrompter(load().index || 0); prompter.next(); return;
      case 'prev-phrase': if (!prompter) makePrompter(load().index || 0); prompter.back(); return;
      case 'again': prompter?.again(); return;
      case 'export-default': exportDefault(); return;
      case 'export-pick': exportPick(); return;
      case 'check': if (typeof pickModelFolder === 'function') checkFolder(); return;
      case 'look': readNimrodVoice().then((ok) => {
        if (!ok) setText('[data-vmg-check-msg]', notes.check = 'This device’s Nimrod folder could not be read now (none set up, or the browser asks again after a restart: open “Your own folders”).');
        else setText('[data-vmg-check-msg]', notes.check = describeModelCheck(nimrodCheck, VOICE_FOLDER, { place: places().voice }));
      }); return;
      case 'probe': runProbe(); return;
      case 'copy': copyCmd(el?.dataset?.vmgCopy || ''); return;
      case 'use': if (setVm({ voiceModelOn: !vm.on })) { afterEvidence(); draw({ force: true }); } return;
      case 'save-port': {
        const n = Number($('[data-vmg-port]')?.value);
        if (!Number.isInteger(n) || n < 1024 || n > 65535) { setText('[data-vmg-settings-msg]', notes.settings = 'A port is a whole number from 1024 to 65535.'); return; }
        notes.settings = setVm({ voiceModelPort: n }) ? `Saved: port ${n}. Start the service with --port ${n}.` : 'That could not be saved.';
        draw({ force: true });
        return;
      }
      case 'save-root': {
        const p = saveRootPath($('[data-vmg-root]')?.value || '', rootPathStorage);
        notes.settings = p ? `Saved on this device: ${p}.` : 'No path saved: the commands keep the placeholder.';
        draw({ force: true });
        return;
      }
      case 'forget-root': saveRootPath('', rootPathStorage); notes.settings = 'Forgotten on this device. The folder itself is not touched.'; draw({ force: true }); return;
      case 'restart':
        if (!armedRestart) { armedRestart = true; draw({ force: true }); return; }
        armedRestart = false;
        try { prompter?.destroy(); } catch { /* gone */ }
        prompter = null;
        keep({ index: 0, exportedAt: null, doneTo: 0 });
        pickedCheck = null;
        walk.restart(evidence());
        notes.settings = '';
        draw({ force: true });
        return;
      default:
    }
  }

  const onClick = (e) => {
    const b = e.target instanceof win.Element ? e.target.closest('[data-vmg-act]') : null;
    if (!b || !root.contains(b) || b.closest('[data-vmg-body] .vm')) return;
    const list = stops();
    const i = list.indexOf(b);
    if (i >= 0) cursor = i;
    press(b.dataset.vmgAct, b);
  };
  const onChange = async (e) => {
    if (!e.target.matches?.('[data-vmg-load]')) return;
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { const ta = $('[data-vmg-phrases]'); if (ta) ta.value = await f.text(); drawPrompt(); }
    catch (err) { console.error('voice model: load', err); setText('[data-vmg-phrase-summary]', 'Could not read that file.'); }
  };
  const onInput = (e) => { if (e.target.matches?.('[data-vmg-phrases]')) drawPrompt(); };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);

  // The recorder's own state (on, listening, held, full) changes from the settings menu, not from here, and so does
  // this person's row: re-read both once a second while the panel is open (a few text nodes).
  // Only a CHANGE in the row is taken up (a host whose row catches up a moment after a save must not flip it back).
  let rowVm = voiceModelFrom(row());
  const tick = setInterval(() => {
    if (destroyed) return;
    const next = voiceModelFrom(row());
    if (next.on !== rowVm.on || next.port !== rowVm.port) { rowVm = next; vm = next; afterEvidence(); draw({ force: true }); return; }
    const s = walk.state();
    if (s.view === 'steps' && s.at === 1) drawPrompt();
  }, 1000);

  draw({ force: true });
  // Settles once this device's Nimrod folder has been looked at (a suite waits on it).
  const ready = readNimrodVoice();

  return {
    ready,
    walk: () => walk.state(),
    prompter: () => prompter,
    verb(v) {
      if (destroyed) return false;
      if (v === 'next') step(1);
      else if (v === 'prev') step(-1);
      else if (v === 'select') selectVerb();
      else if (v === 'back') { walk.back(); draw(); }
      else return false;
      return true;
    },
    refresh() { vm = voiceModelFrom(row()); readNimrodVoice(); afterEvidence(); draw({ force: true }); },
    destroy() {
      destroyed = true;
      clearInterval(tick);
      if (probeT != null) { stopEvery(probeT); probeT = null; }
      try { prompter?.destroy(); } catch { /* gone */ }
      prompter = null;
      try { onePage?.destroy(); } catch { /* gone */ }
      onePage = null;
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      root.innerHTML = '';
    },
    __probe: () => {
      const s = walk.state();
      return { ...s, evidenceNow: evidence(), cursor, lit: litEl()?.dataset?.vmgAct || litEl()?.textContent?.trim() || null,
        probing: probeT != null, probe: probeResult, notes: { ...notes }, phrases: phrases.length };
    },
  };
}

registerModule(
  { type: VOICE_MODEL_TYPE, title: VOICE_MODEL_TITLE, core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'make a speech recogniser trained on one person’s own voice, one step at a time: record the phrases '
      + 'here, export them, train, convert, put the folder in place and start the service; then its settings',
    settings: [] },
  (ctx) => {
    const { mount } = ctx;
    let guide = null;
    let store = null;
    let ownStore = false;
    const offs = [];
    return {
      init() {
        try { store = ctx.voiceStore || null; } catch { store = null; }
        if (!store) {
          ownStore = true;
          try { store = createIdbPairStore(); } catch (err) { console.error('voice model: no storage', err); store = createMemoryPairStore(); }
        }
        const box = mount.ownerDocument.createElement('div');
        box.style.cssText = 'position:absolute;inset:0;overflow:hidden';
        mount.append(box);
        guide = mountVoiceModelGuide(box, {
          personId: ctx.personId || null,
          values: () => { try { return ctx.personRow?.() || {}; } catch { return {}; } },
          save: typeof ctx.saveVoiceModel === 'function' ? (patch) => ctx.saveVoiceModel(patch) : null,
          recorder: ctx.voiceRecorder || null,
          store,
          isScreen: ctx.isScreen === true,
          fs: { available: () => fsAvailable(), pickFolder: () => pickFolder() },
        });
        for (const [verb, topic] of Object.entries(VOICE_MODEL_VERB_TOPICS)) {
          try { const off = ctx.bus?.subscribe?.(topic, () => guide?.verb(verb)); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ }
        }
      },
      onResize() {},
      onHide() {},
      destroy() {
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { guide?.destroy(); } catch { /* gone */ }
        guide = null;
        if (ownStore) { try { store?.close?.(); } catch { /* gone */ } }
        store = null;
        mount.innerHTML = '';
      },
      verb: (v) => (guide ? guide.verb(v) : false),
      __probe: () => (guide ? guide.__probe() : null),
    };
  },
);
