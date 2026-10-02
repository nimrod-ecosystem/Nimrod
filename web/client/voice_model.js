// voice_model.js — A SPEECH MODEL TRAINED ON YOUR OWN VOICE (2026-10-02).
//
// Mike, 2026-10-02: *"Google's Euphonia - Sounds like something we give a link to the download for and make
// easy to hook up? I'd want it for me though."* The research is the private repo's MIKE_LIST_20260930.md,
// row 2.52. In short: Google's Project Euphonia toolkit (github.com/google/project-euphonia-app, Apache-2.0)
// fine-tunes Whisper on ~100 short phrases read by one person; its own api converts the result for
// faster-whisper, which is what web/speech_service already runs - so a trained model is a FOLDER handed to
// `--model`, with no code change to load it.
//
//   1. RECORD  here, with the screen's own recorder (voice_recording.js): a phrase is shown, the person
//              reads it, the pair is saved with the phrase as what was meant, the next phrase comes up.
//              Exported in the folder layout Euphonia's notebook reads (exportEuphonia).
//   2. TRAIN   with Euphonia's own notebook, model set to openai/whisper-small.en (ours), data pointed at
//              the exported folder instead of its Firebase bucket. Run by the person, where they choose.
//   3. CONVERT with Euphonia's own command (convertCommand), into a folder.
//   4. USE     `--model <folder>` on its OWN port (serviceCommand), and this person's "Use my own voice
//              model" switch, which points their "this screen" recogniser at it (speech_engines.js).
//
// *** WHOSE IT IS. *** A per-PERSON setting (`voiceModelOn`, on the person's row, beside their other speech
// settings), off unless that person turns it on. It runs as its own service on its own port (8796), beside
// the shared one (8797) that keeps the stock model, so another person's settings - and every other screen -
// never send their microphone to it. On the screen of the person who owns it, it hears whoever talks, as
// any recogniser does; that is said on the page rather than promised away.
// *** NOT ON A RASPBERRY PI. *** The Pi's recogniser is Vosk, a different kind of model; a Whisper checkpoint
// cannot become one. A personal model runs where Whisper runs (a desktop, or a computer with a graphics card).
//
// WHAT THIS SITE DOES NOT DO: ship Euphonia's phrase list (Apache-2.0 would allow it with its notice, but the
// file was not fetched - nothing is downloaded by this work; linked instead, and the person pastes or loads
// it), run anything, or upload anything. The recordings stay in this browser until somebody exports them.

import { cleanPrompt, exportEuphonia, EUPHONIA_DATA, EUPHONIA_AUDIO, EUPHONIA_PHRASE } from './voice_recording.js';

export const EUPHONIA = Object.freeze({
  repo: 'https://github.com/google/project-euphonia-app',
  notebook: 'https://github.com/google/project-euphonia-app/blob/main/training_colabs/Project_Euphonia_Finetuning.ipynb',
  phrases: 'https://github.com/google/project-euphonia-app/blob/main/assets/phrases.txt',
  licence: 'Apache-2.0',
});
// The speech service runs faster-whisper small.en; training from the same base keeps a personal model a
// like-for-like swap. The notebook defaults to multilingual whisper-small; its model setting is free text.
export const BASE_MODEL = 'openai/whisper-small.en';
// Its own port, beside the shared service's 8797. Free on the desktop (8000 site, 8080 the older dashboard,
// 8765 a receiver, 8770-8773 media agents, 8791 corpus_desk, 8797 speech, 8798 the wake example). A setting.
export const VOICE_MODEL_PORT = 8796;
// What a converted folder holds; the service checks the same list at start-up (backends.py).
export const MODEL_FILES = Object.freeze(['model.bin', 'config.json', 'tokenizer.json', 'preprocessor_config.json',
  'vocabulary.json (or vocabulary.txt)']);
// Euphonia's README asks for short phrases (<140 characters). A longer one is kept and flagged, not cut.
export const PHRASE_CHARS = 140;
export const PHRASE_MAX = 500;

export const VOICE_MODEL_FIELDS = [
  { key: 'voiceModelOn', label: 'Use my own voice model', kind: 'toggle', default: false, level: 'advanced',
    onLabel: 'On', offLabel: 'Off',
    note: 'A speech model trained on this person’s own voice, running on this computer. Only this person’s '
        + 'settings use it. Off: the standard recogniser. Not on a Raspberry Pi. How to make one: the Voice '
        + 'recordings panel, “Your own voice model”.' },
  { key: 'voiceModelFolder', label: 'My own voice model: its folder', kind: 'text', default: '', level: 'advanced',
    note: 'The converted folder on this computer. Used to show the command that starts it.' },
  { key: 'voiceModelPort', label: 'My own voice model: its port', kind: 'number', default: VOICE_MODEL_PORT,
    min: 1024, max: 65535, step: 1, level: 'advanced',
    note: 'Its own port, beside the standard recogniser’s 8797.' },
];

export const voiceModelUrl = (port = VOICE_MODEL_PORT) => `ws://127.0.0.1:${port}/speech`;

/** `{ on, port, folder, url }` from a person's row. Only a literal true turns it on. Pure. */
export function voiceModelFrom(values = {}) {
  const v = values || {};
  const p = Number(v.voiceModelPort);
  const port = typeof v.voiceModelPort !== 'boolean' && Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : VOICE_MODEL_PORT;
  const folder = typeof v.voiceModelFolder === 'string' ? v.voiceModelFolder.trim() : '';
  return { on: v.voiceModelOn === true, port, folder, url: voiceModelUrl(port) };
}

// A folder goes inside double quotes; a quote in it would end the argument early, so it is removed.
const q = (s, dflt) => `"${String(s || '').replace(/"/g, '').trim() || dflt}"`;

/** Euphonia's own conversion (its api's app_faster_whisper.py), with the tokenizer files copied. Pure. */
export function convertCommand({ checkpoint = '', folder = '' } = {}) {
  return `ct2-transformers-converter --model ${q(checkpoint, '<checkpoint folder>')} --output_dir ${q(folder, '<model folder>')} `
    + '--quantization int8 --copy_files tokenizer.json preprocessor_config.json';
}

/** The speech service on that folder, on its own port. Run from the project's web folder. Pure. */
export function serviceCommand({ folder = '', port = VOICE_MODEL_PORT } = {}) {
  const p = Number.isInteger(Number(port)) ? Number(port) : VOICE_MODEL_PORT;
  return `py -3.13 -m speech_service --backend whisper --model ${q(folder, '<model folder>')} --port ${p}`;
}

/** A pasted or loaded list: one phrase per line; blanks, `#` comments and repeats skipped. Pure. */
export function parsePhrases(text, { max = PHRASE_MAX } = {}) {
  const seen = new Set();
  const all = [];
  let dupes = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const k = line.toLowerCase();
    if (seen.has(k)) { dupes += 1; continue; }
    seen.add(k);
    all.push(line);
  }
  const phrases = all.slice(0, max);
  return { phrases, dupes, cut: all.length - phrases.length,
           long: phrases.map((p, i) => (p.length > PHRASE_CHARS ? i : -1)).filter((i) => i >= 0) };
}

/** Why reading phrases cannot record right now, from the recorder's state; '' when nothing is in the way. Pure. */
export function prompterBlocker(s) {
  if (!s) return 'Recording happens on the screen you speak to: open this panel there.';
  if (!s.on) return 'Turn on “Record this person’s voice for training” in this person’s settings (Devices, Voice) first.';
  if (s.held && s.held.length) return 'Paused while the intercom or a call is open.';
  if (s.paused === 'full') return 'This screen has kept as many recordings as it may. Export them, delete some, or raise the limit.';
  if (s.paused === 'failed') return 'The last recording could not be saved.';
  if (!s.attached || !s.listening) return 'Nothing is listening: turn on spoken commands or subtitles, and check the recogniser is answering.';
  return '';
}

/**
 * Show a phrase, wait for its recording, show the next. `recorder` is voice_recording.js's (prompt / onPrompt
 * / state); `store` lets "Again" delete the last take. state(): { index, total, phrase, running, done, last,
 * blocked } - `last` is the newest phrase saved ({ index, ok, heard, pairId }) so the page can show what the
 * recogniser made of it.
 */
export function createPhrasePrompter({ phrases = [], recorder = null, store = null, list = null, start = 0, onChange = null } = {}) {
  const ph = (phrases || []).map((p) => String(p).trim()).filter(Boolean);
  const total = ph.length;
  let index = Math.max(0, Math.min(total, Math.round(Number(start) || 0)));
  let running = false;
  let last = null;
  let off = null;

  const state = () => ({
    index, total, phrase: index < total ? ph[index] : null, running, done: total > 0 && index >= total, last: last ? { ...last } : null,
    blocked: recorder ? prompterBlocker(recorder.state?.()) : prompterBlocker(null),
  });
  const emit = () => { try { onChange?.(state()); } catch (err) { console.error('voice model: onChange', err); } };
  function arm() {
    try { recorder?.prompt?.(running && index < total ? cleanPrompt({ text: ph[index], index, list }) : null); }
    catch (err) { console.error('voice model: prompt', err); }
  }
  function onPrompt(ev) {
    if (!ev) return;
    const i = ev.prompt ? ev.prompt.index : null;
    if (!ev.ok) { last = { index: i, ok: false, why: ev.why || 'failed' }; if (running) arm(); emit(); return; }
    last = { index: i, ok: true, pairId: ev.pair?.id || null, heard: String(ev.pair?.said?.text || '') };
    if (running && i === index) {
      index += 1;
      if (index >= total) running = false;
      arm();
    }
    emit();
  }

  return {
    state,
    start() {
      if (!total) return;
      if (index >= total) index = 0;
      running = true;
      if (!off && recorder?.onPrompt) off = recorder.onPrompt(onPrompt);
      arm();
      emit();
    },
    stop() { running = false; arm(); emit(); },
    next() { index = Math.min(total, index + 1); if (index >= total) running = false; arm(); emit(); },
    back() { index = Math.max(0, index - 1); arm(); emit(); },
    /** Delete the last take and show that phrase again. */
    async again() {
      if (!last || !last.ok || last.index == null) return false;
      const { pairId, index: i } = last;
      if (store && pairId) { try { await store.remove(pairId); } catch (err) { console.error('voice model: again', err); } }
      index = i;
      last = null;
      running = true;
      if (!off && recorder?.onPrompt) off = recorder.onPrompt(onPrompt);
      arm();
      emit();
      return true;
    },
    destroy() {
      running = false;
      arm();
      try { off?.(); } catch { /* gone */ }
      off = null;
    },
  };
}

// ---------------------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------------------
export const VOICE_MODEL_CSS = `
.vm{display:flex;flex-direction:column;gap:14px;max-width:72ch}
.vm h3{margin:0;font-size:1.2em}
.vm h4{margin:0 0 4px;font-size:1.05em}
.vm p{margin:4px 0}
.vm .vm-soft{color:var(--text-soft,inherit)}
.vm a{color:inherit}
.vm code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
.vm code[data-cmd]{display:block;padding:8px 10px;border-radius:8px;border:1px solid var(--border,currentColor);
  white-space:pre-wrap;word-break:break-all;user-select:all}
.vm textarea,.vm input[type=text]{width:100%;box-sizing:border-box;font:inherit;padding:6px 10px;border-radius:10px;
  border:1px solid var(--border,currentColor);background:var(--surface,transparent);color:inherit}
.vm textarea{min-height:7em}
.vm input[type=text]{min-height:44px}
.vm .vm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.vm button,.vm .vm-file{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--border,currentColor);
  background:var(--surface-alt,transparent);color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center}
.vm button[aria-pressed="true"]{background:var(--accent,currentColor);color:var(--on-accent,Canvas);border-color:var(--accent,currentColor)}
.vm .vm-file input{position:absolute;opacity:0;width:1px;height:1px}
.vm .vm-phrase{font-size:1.8em;font-weight:600;line-height:1.25;margin:6px 0}
.vm .vm-step{border:1px solid var(--border,currentColor);border-radius:12px;padding:10px 12px}`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

export const PHRASES_KEY = (personId) => `nimrod-voice-model:${personId || 'anyone'}`;
const defaultStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

/**
 * The page. `values()` is this person's row; `save(patch)` writes it (only voiceModelOn / voiceModelFolder),
 * absent where a page cannot. `recorder` / `store` are the screen's voice recorder and its store (absent on a
 * page that does not listen). `fs` { available(), pickFolder() } for the export. `storage` keeps the pasted
 * phrase list and the place in it, per person, on this screen.
 */
export function mountVoiceModel(root, {
  personId = null, values = () => ({}), save = null, recorder = null, store = null, fs = null, storage = defaultStorage(),
} = {}) {
  if (!root) throw new Error('mountVoiceModel: a root element is required');
  const row = () => { try { return values() || {}; } catch { return {}; } };
  let vm = voiceModelFrom(row());
  let folder = vm.folder;
  let prompter = null;
  let destroyed = false;
  const ac = new AbortController();
  const key = PHRASES_KEY(personId);
  const load = () => { try { return JSON.parse(storage?.getItem(key) || 'null') || {}; } catch { return {}; } };
  const keep = (x) => { try { storage?.setItem(key, JSON.stringify({ ...load(), ...x })); } catch { /* storage refused: works for this visit */ } };
  let phrases = parsePhrases(load().text || '').phrases;

  root.innerHTML = `<style>${VOICE_MODEL_CSS}</style>
  <div class="vm">
    <h3>Your own voice model</h3>
    <p>A speech recogniser trained on one person’s voice. Google’s Project Euphonia toolkit fine-tunes Whisper
      (the recogniser this site’s speech service runs) on about 100 short phrases read aloud by that person. You
      run every step yourself, on computers you choose. Nothing you record here is uploaded by this site: the
      recordings stay on this screen until you export them to a folder.</p>
    <p class="vm-row">${link(EUPHONIA.repo, 'Project Euphonia toolkit (GitHub, Apache-2.0)')} ·
      ${link(EUPHONIA.notebook, 'its training notebook')} · ${link(EUPHONIA.phrases, 'its 100 phrases')}</p>
    <p class="vm-soft">The toolkit’s own phone app uploads recordings to a Firebase bucket. You do not need it:
      record here instead.</p>
    <p><b>Who it is for.</b> It is yours. Only your own speech settings use it (“Use my own voice model”); other
      people’s settings, and every screen but yours, keep the standard recogniser. On your screen it hears whoever is
      talking, as any recogniser does. It runs where Whisper runs: a desktop or laptop, or a computer with a
      graphics card. It does not run on a Raspberry Pi: the Pi’s recogniser (Vosk) is a different kind of model
      and cannot use it.</p>

    <section class="vm-step">
      <h4>1. Record the phrases</h4>
      <p>Turn on “Record this person’s voice for training” and spoken commands (or subtitles) in your settings, and
        leave “Use my own voice model” off until the model exists. Paste the phrases below, one per line, or load a
        text file (Euphonia’s list is linked above; this site does not ship a copy). Press Start and read each
        phrase as it appears; the next one comes up once it has been saved. A pause mid-phrase ends a recording,
        so set “A pause this long ends what was said” to Long while you read.</p>
      <textarea data-phrases aria-label="Phrases to read, one per line"></textarea>
      <div class="vm-row">
        <button type="button" data-use-phrases>Use these phrases</button>
        <label class="vm-file">Load a text file<input type="file" data-load accept=".txt,text/plain"></label>
        <span data-phrase-summary class="vm-soft"></span>
      </div>
      <p data-progress class="vm-soft"></p>
      <p data-phrase class="vm-phrase" aria-live="polite"></p>
      <p data-status role="status" aria-live="polite"></p>
      <div class="vm-row">
        <button type="button" data-start>Start</button>
        <button type="button" data-stop hidden>Stop</button>
        <button type="button" data-back>Back</button>
        <button type="button" data-skip>Skip</button>
        <button type="button" data-again hidden>Again</button>
      </div>
      <div class="vm-row">
        <button type="button" data-export hidden>Export for training</button>
        <span data-export-msg class="vm-soft" role="status" aria-live="polite"></span>
      </div>
      <p class="vm-soft">Export into an empty folder. It gets a <code>${esc(EUPHONIA_DATA)}</code> folder with one numbered
        folder per phrase (<code>${esc(EUPHONIA_DATA)}/001/${esc(EUPHONIA_AUDIO)}</code> and
        <code>${esc(EUPHONIA_PHRASE)}</code>), plus <code>nimrod-export.json</code> saying which recording is which.
        Every recording with what was meant goes in: the phrases you read, and any you typed in the review.</p>
    </section>

    <section class="vm-step">
      <h4>2. Train it with Euphonia’s notebook</h4>
      <p>Open ${link(EUPHONIA.notebook, 'the training notebook')}. Set its model to <code>${esc(BASE_MODEL)}</code>
        (type it; the dropdown does not list it), so the result matches the model the speech service already runs.
        Its data cell copies from a Firebase bucket: point it at the <code>${esc(EUPHONIA_DATA)}</code> folder you
        exported instead. On your own computer, skip the three Colab-only cells (sign-in, Google Drive,
        TensorBoard), and turn fp16 off if there is no graphics card. A computer with a graphics card is much
        faster than one without.</p>
    </section>

    <section class="vm-step">
      <h4>3. Convert it for the speech service</h4>
      <p>On the computer that trained it (it needs the ctranslate2 and transformers Python packages), with the
        trained checkpoint’s folder in place of the first name:</p>
      <code data-cmd="convert"></code>
      <p class="vm-soft">The folder must end up holding ${esc(MODEL_FILES.join(', '))}.</p>
    </section>

    <section class="vm-step">
      <h4>4. Start it, and use it</h4>
      <label>The converted folder on this computer
        <input type="text" data-folder spellcheck="false" placeholder="for example C:\\models\\my-voice"></label>
      <div class="vm-row"><button type="button" data-save-folder>Save as my model’s folder</button>
        <span data-saved class="vm-soft" role="status" aria-live="polite"></span></div>
      <p>Run this in the project’s <code>web</code> folder, on this computer (<code>python3</code> instead of
        <code>py -3.13</code> on a Mac or Linux):</p>
      <code data-cmd="serve"></code>
      <p class="vm-soft">It checks the folder when it starts and names any file that is missing. It runs beside the
        standard recogniser (port 8797), which stays for everybody else.</p>
      <div class="vm-row"><button type="button" data-use aria-pressed="false"></button></div>
      <p class="vm-soft" data-use-note></p>
    </section>
  </div>`;

  const $ = (s) => root.querySelector(s);
  $('[data-phrases]').value = load().text || '';
  $('[data-folder]').value = folder;
  if (typeof save !== 'function') {
    $('[data-save-folder]').hidden = true;
    $('[data-saved]').textContent = 'To keep it, set it in this person’s settings (Devices, Voice).';
  }

  function renderCommands() {
    $('[data-cmd="convert"]').textContent = convertCommand({ folder });
    $('[data-cmd="serve"]').textContent = serviceCommand({ folder, port: vm.port });
  }
  function renderUse() {
    const b = $('[data-use]');
    b.setAttribute('aria-pressed', String(vm.on));
    b.textContent = `Use my own voice model: ${vm.on ? 'On' : 'Off'}`;
    b.hidden = typeof save !== 'function';
    $('[data-use-note]').textContent = vm.on
      ? `On: your speech goes to ${vm.url}. If it is not running, this screen says no recogniser is answering.`
      : 'Off: your speech goes to the standard recogniser.';
  }
  function renderPhrases() {
    const n = phrases.length;
    const r = parsePhrases($('[data-phrases]').value);
    const long = r.long.length ? ` ${r.long.length} longer than ${PHRASE_CHARS} characters.` : '';
    $('[data-phrase-summary]').textContent = n ? `${n} phrase${n === 1 ? '' : 's'}.${long}` : 'No phrases yet.';
  }
  function renderPrompt() {
    if (destroyed) return;
    const s = prompter ? prompter.state() : { index: 0, total: phrases.length, phrase: null, running: false, done: false, last: null,
      blocked: prompterBlocker(recorder ? recorder.state?.() : null) };
    $('[data-progress]').textContent = !s.total ? '' : s.done ? `All ${s.total} phrases read.` : `Phrase ${s.index + 1} of ${s.total}`;
    $('[data-phrase]').textContent = s.running ? (s.phrase || '') : '';
    const lastLine = s.last ? (s.last.ok ? `Saved. It heard: “${s.last.heard || 'nothing it could make out'}”.` : 'That one was not saved.') : '';
    $('[data-status]').textContent = s.blocked || (s.running ? `Read it now. ${lastLine}` : lastLine);
    $('[data-start]').hidden = s.running;
    $('[data-start]').disabled = !s.total || !recorder;
    $('[data-stop]').hidden = !s.running;
    $('[data-again]').hidden = !(s.last && s.last.ok && store);
    $('[data-export]').hidden = !(fs && typeof fs.available === 'function' && fs.available() && store);
  }

  function makePrompter(at) {
    try { prompter?.destroy(); } catch { /* gone */ }
    prompter = createPhrasePrompter({ phrases, recorder, store, list: personId ? `own:${personId}` : 'own', start: at,
      onChange: (s) => { keep({ index: s.index }); renderPrompt(); } });
  }

  async function doExport() {
    let dir = null;
    try { dir = await fs.pickFolder(); } catch { return; }      // cancelled is not an error
    const msg = $('[data-export-msg]');
    msg.textContent = 'Exporting…';
    try {
      const r = await exportEuphonia(dir, store, { personId });
      msg.textContent = `Exported ${r.written.length} recording${r.written.length === 1 ? '' : 's'}${r.failed.length ? `; ${r.failed.length} could not be written` : ''}.`;
    } catch (err) { console.error('voice model: export', err); msg.textContent = 'Could not export into that folder.'; }
  }

  root.addEventListener('input', (e) => {
    if (e.target.matches?.('[data-folder]')) { folder = e.target.value.trim(); renderCommands(); }
  }, { signal: ac.signal });
  root.addEventListener('change', async (e) => {
    if (!e.target.matches?.('[data-load]')) return;
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { $('[data-phrases]').value = await f.text(); renderPhrases(); }
    catch (err) { console.error('voice model: load', err); $('[data-phrase-summary]').textContent = 'Could not read that file.'; }
  }, { signal: ac.signal });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-use-phrases')) {
      const text = $('[data-phrases]').value;
      phrases = parsePhrases(text).phrases;
      keep({ text, index: 0 });
      makePrompter(0);
      renderPhrases(); renderPrompt();
      return;
    }
    if (b.hasAttribute('data-start')) { if (!prompter) makePrompter(load().index || 0); prompter.start(); return; }
    if (b.hasAttribute('data-stop')) { prompter?.stop(); return; }
    if (b.hasAttribute('data-skip')) { if (!prompter) makePrompter(load().index || 0); prompter.next(); return; }
    if (b.hasAttribute('data-back')) { if (!prompter) makePrompter(load().index || 0); prompter.back(); return; }
    if (b.hasAttribute('data-again')) { prompter?.again(); return; }
    if (b.hasAttribute('data-export')) { doExport(); return; }
    if (b.hasAttribute('data-save-folder') && typeof save === 'function') {
      let ok = false;
      try { ok = save({ voiceModelFolder: folder }) !== false; } catch (err) { console.error('voice model: save', err); }
      $('[data-saved]').textContent = ok ? 'Saved.' : 'Could not save it.';
      return;
    }
    if (b.hasAttribute('data-use') && typeof save === 'function') {
      const next = !vm.on;
      let ok = false;
      try { ok = save({ voiceModelOn: next }) !== false; } catch (err) { console.error('voice model: save', err); }
      if (ok) vm = { ...vm, on: next };
      renderUse();
    }
  }, { signal: ac.signal });

  // The recorder's own state (on/off, listening, held, full) changes what is in the way, and it changes from
  // the settings menu, not from here: re-read it once a second while the page is open (a few text nodes).
  const tick = setInterval(() => { if (!destroyed) renderPrompt(); }, 1000);
  const offState = () => clearInterval(tick);

  renderCommands(); renderUse(); renderPhrases(); renderPrompt();

  return {
    prompter: () => prompter,
    refresh() { vm = voiceModelFrom(row()); renderUse(); renderCommands(); renderPrompt(); },
    destroy() {
      destroyed = true;
      try { prompter?.destroy(); } catch { /* gone */ }
      prompter = null;
      try { offState?.(); } catch { /* gone */ }
      ac.abort();
      root.innerHTML = '';
    },
  };
}
