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
//   3. CONVERT with Euphonia's own command (convertCommand), into web/speech_service/my_voice_model/.
//   4. USE     `--my-voice` on its OWN port (serviceCommand), and this person's "Use my own voice
//              model" switch, which points their "this screen" recogniser at it (speech_engines.js).
//
// *** NO FOLDER IS TYPED INTO THE SITE (2026-10-03). *** Mike, on the menu's "its folder" text row: *"Shouldn't
// it be a folder picker for the voice model? Which folder do I even use?"* The honest answer to the first
// half was neither: the site never handed that path to anything. It only pasted it into a command shown on
// this page, because the SERVICE needs a filesystem path at START, on the computer it runs on - which may not
// be the screen's computer - and a browser's folder picker gives a handle, never a path. So the service has
// ONE place of its own to look (MY_VOICE_PATH, kept out of git), the menu keeps only the switch and the port,
// and this page says which folder and where it goes. The picker is used where it genuinely helps: "Check a
// folder" reads the NAMES in a folder somebody picks and says whether it is the right one (checkModelFiles,
// the same rule the service applies at start). It reads no file and uploads nothing.
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

// *** THE NIMROD FOLDER (2026-10-04). *** Mike: *"Where is this? In E:\nimrod-wakeword that folder? Do I maybe not
// have it set up yet? There's going to need to be an explanation for the average user."* The honest answer: nobody
// has the folder until they have recorded, exported, trained and converted - and E:\nimrod-wakeword is unrelated
// (wake-word training). So the page now opens with "Where you are" (`voiceModelStatus`): six steps, which one you
// are on, and that the folder only exists after step 4. And the folder's place is the Nimrod folder's own
// "Voice model" subfolder (user_folders.js), which the speech service reads with `--my-voice --root <that folder>`;
// speech_service/my_voice_model stays the fallback. When the person has typed the Nimrod folder's full path
// (user_folders.js `readRootPath`, this device only), the commands carry it; otherwise they carry a placeholder
// and say to replace it.
import { cleanPrompt, exportEuphonia, EUPHONIA_DATA, EUPHONIA_AUDIO, EUPHONIA_PHRASE } from './voice_recording.js';
import { SUBFOLDERS, readRootPath, joinPath, kindFolder, handleStore } from './user_folders.js';

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
// Where `--my-voice` looks (backends.py MY_VOICE_DIR): from the project folder, and from its web folder (where
// the commands run). Gitignored: a person's voice is not project history.
export const MY_VOICE_PATH = 'web/speech_service/my_voice_model';
export const MY_VOICE_FROM_WEB = 'speech_service/my_voice_model';
// The Nimrod folder's subfolder for it, and how the page names a place it cannot see (a browser never reveals a path).
export const VOICE_FOLDER = SUBFOLDERS.voice;
export const NIMROD_ROOT_WORDS = '<your Nimrod folder>';
export const VOICE_PLACE = `${NIMROD_ROOT_WORDS}/${VOICE_FOLDER}`;
export const RECORDINGS_PLACE = `${NIMROD_ROOT_WORDS}/${SUBFOLDERS.recordings}`;
// Euphonia's README asks for short phrases (<140 characters). A longer one is kept and flagged, not cut.
export const PHRASE_CHARS = 140;
export const PHRASE_MAX = 500;

export const VOICE_MODEL_FIELDS = [
  { key: 'voiceModelOn', label: 'Use my own voice model', kind: 'toggle', default: false, level: 'advanced',
    onLabel: 'On', offLabel: 'Off',
    note: 'A speech model trained on this person’s own voice, running on this computer. Only this person’s '
        + 'settings use it. Off: the standard recogniser. Not on a Raspberry Pi. How to make one: the Voice '
        + 'recordings panel, “Your own voice model”.' },
  // No folder row (2026-10-03): the folder belongs to the speech service, which looks in its own place.
  { key: 'voiceModelPort', label: 'My own voice model: its port', kind: 'number', default: VOICE_MODEL_PORT,
    min: 1024, max: 65535, step: 1, level: 'advanced',
    note: 'Where its speech service listens, beside the standard recogniser’s 8797. The same number as --port '
        + 'in the command that starts it.' },
];

export const voiceModelUrl = (port = VOICE_MODEL_PORT) => `ws://127.0.0.1:${port}/speech`;

/** `{ on, port, url }` from a person's row. Only a literal true turns it on. A `voiceModelFolder` stored by
 * the first version is left on the row and read by nothing. Pure. */
export function voiceModelFrom(values = {}) {
  const v = values || {};
  const p = Number(v.voiceModelPort);
  const port = typeof v.voiceModelPort !== 'boolean' && Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : VOICE_MODEL_PORT;
  return { on: v.voiceModelOn === true, port, url: voiceModelUrl(port) };
}

// A folder goes inside double quotes; a quote in it would end the argument early, so it is removed.
const q = (s, dflt) => `"${String(s || '').replace(/"/g, '').trim() || dflt}"`;

/** Euphonia's own conversion (its api's app_faster_whisper.py), with the tokenizer files copied. By default it
 * writes straight into the folder the service looks in (run in the project's web folder). Pure. */
export function convertCommand({ checkpoint = '', folder = '' } = {}) {
  return `ct2-transformers-converter --model ${q(checkpoint, '<checkpoint folder>')} --output_dir ${q(folder, MY_VOICE_FROM_WEB)} `
    + '--quantization int8 --copy_files tokenizer.json preprocessor_config.json';
}

/** The speech service on this person's own model, on its own port. Run from the project's web folder. `root`: the
 * Nimrod folder, whose "Voice model" it then loads (2026-10-04). `folder` only for a model kept somewhere else. Pure. */
export function serviceCommand({ folder = '', port = VOICE_MODEL_PORT, root = '' } = {}) {
  const p = Number.isInteger(Number(port)) ? Number(port) : VOICE_MODEL_PORT;
  const f = String(folder || '').replace(/"/g, '').trim();
  const r = String(root || '').replace(/"/g, '').trim();
  return `py -3.13 -m speech_service --my-voice${r ? ` --root "${r}"` : ''}${f ? ` --model "${f}"` : ''} --port ${p}`;
}

/**
 * Is this the right folder? From the NAMES in it - the same rule the service applies at start (backends.py):
 * model.bin, config.json, tokenizer.json and a vocabulary are needed; preprocessor_config.json is advised.
 * `kind`: 'model' (converted), 'checkpoint' (the training output, not converted yet), 'recordings' (the
 * export), or 'other'. Pure.
 */
export function checkModelFiles(names = []) {
  const has = new Set((names || []).map((n) => String(n)));
  const missing = ['model.bin', 'config.json', 'tokenizer.json'].filter((f) => !has.has(f));
  if (!has.has('vocabulary.json') && !has.has('vocabulary.txt')) missing.push('vocabulary.json (or vocabulary.txt)');
  const advised = has.has('preprocessor_config.json') ? [] : ['preprocessor_config.json'];
  const checkpoint = !has.has('model.bin') && (has.has('model.safetensors') || has.has('pytorch_model.bin'));
  const recordings = has.has('nimrod-export.json') || (has.has('data') && !has.has('config.json'));
  const kind = !missing.length ? 'model' : checkpoint ? 'checkpoint' : recordings ? 'recordings' : 'other';
  return { ok: missing.length === 0, missing, advised, kind };
}

/** The sentence "Check a folder" shows for a checkModelFiles result. `place`: where the files go. Pure. */
export function describeModelCheck(r, name = 'That folder', { place = VOICE_PLACE } = {}) {
  const n = `“${String(name || 'That folder')}”`;
  if (!r) return '';
  if (r.ok) {
    return `${n} is ready: it has everything the speech service needs${r.advised.length ? ` (it has no ${r.advised.join(', ')}, which the service can do without)` : ''}. `
      + `Its place is ${place}: put these files directly in that folder (step 5).`;
  }
  if (r.kind === 'checkpoint') return `${n} is the training checkpoint, not converted yet. Convert it with the command in step 4; the folder that makes is the one you want.`;
  if (r.kind === 'recordings') return `${n} holds the recordings you exported for training, not a model. The model is the folder step 4’s conversion writes.`;
  return `${n} is missing ${r.missing.join(', ')}. If it is the converted folder, convert it again with the command in step 4 (it copies the tokenizer files).`;
}

// ---------------------------------------------------------------------------------------
// *** "WHERE YOU ARE" (2026-10-04): which of the six steps somebody is on. *** Mike's question - "Do I maybe not
// have it set up yet?" - answered on the page rather than by whoever he asks. Pure, from what the page can know:
//   total, index  the phrase list and how far through it this person is (kept on this screen);
//   exported      an export for training was made from this page (kept on this screen);
//   nimrod        checkModelFiles of the Nimrod folder's "Voice model", when it could be read (null otherwise);
//   picked        checkModelFiles of the last folder "Check a folder" looked at, plus its `name` (null if none);
//   on            this person's "Use my own voice model" switch.
// The most advanced thing PROVEN wins: a ready model in place beats everything; a folder somebody checked beats
// what this screen remembers. It cannot see training happen on another computer, so a checkpoint is only known
// once somebody checks it - said in the steps rather than guessed.
// ---------------------------------------------------------------------------------------
export const STEPS = Object.freeze([
  'Record the phrases',
  'Export them',
  'Train the model (on Euphonia’s notebook)',
  'Convert it',
  `Put the folder in ${VOICE_PLACE}`,
  'Start the speech service',
]);

const hasModelBin = (r) => !!r && !r.missing.includes('model.bin');

/** `{ step (1-6), done, text, haveFolder }`. Pure. */
export function voiceModelStatus({ total = 0, index = 0, exported = false, nimrod = null, picked = null, on = false, place = VOICE_PLACE } = {}) {
  const at = (step, text, extra = {}) => ({ step, done: false, text, haveFolder: step >= 5, ...extra });
  if (nimrod && nimrod.ok) {
    return on
      ? at(6, `You have it, in its place, and “Use my own voice model” is on. If this screen says no recogniser is answering, start the speech service (step 6).`, { done: true })
      : at(6, 'You have it, in its place. Last step: start the speech service, then turn on “Use my own voice model”.');
  }
  if (picked && picked.ok) return at(5, `You have the converted folder (“${picked.name || 'the folder you checked'}”). Next: put its files in ${place}.`);
  const partial = [nimrod, picked].find((r) => r && !r.ok && r.kind !== 'checkpoint' && hasModelBin(r));
  if (partial) return at(4, `A converted model is there but it is missing ${partial.missing.join(', ')}. Convert it again: the command copies them.`);
  if ((nimrod && nimrod.kind === 'checkpoint') || (picked && picked.kind === 'checkpoint')) {
    return at(4, 'You have the training result (a checkpoint). Next: convert it, which makes the voice model folder.');
  }
  if (exported || (picked && picked.kind === 'recordings')) return at(3, 'Your recordings are exported. Next: train the model on them.');
  const n = Math.max(0, Math.round(Number(total) || 0));
  const i = Math.max(0, Math.min(n, Math.round(Number(index) || 0)));
  if (n && i >= n) return at(2, `All ${n} phrases are read. Next: export them for training.`);
  if (n) return at(1, `${i} of ${n} phrases read so far.`);
  return at(1, 'Not started: there are no phrases to read yet.');
}

/** The names in a folder somebody picked (a FileSystemDirectoryHandle). Names only: no file is opened. */
export async function folderNames(dir) {
  const out = [];
  if (!dir) return out;
  if (typeof dir.entries === 'function') { for await (const [name] of dir.entries()) out.push(String(name)); return out; }
  if (typeof dir.values === 'function') { for await (const h of dir.values()) out.push(String(h?.name || '')); }
  return out.filter(Boolean);
}

// A folder picker that only READS (no "let this site edit files" prompt); null where the browser has none.
const defaultPicker = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      return () => window.showDirectoryPicker({ id: 'nimrod-voice-model', mode: 'read' });
    }
  } catch { /* no picker */ }
  return null;
};

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
.vm .vm-step{border:1px solid var(--border,currentColor);border-radius:12px;padding:10px 12px}
.vm [data-vm-steps]{margin:4px 0;padding-left:1.6em}
.vm [data-vm-state="now"]{font-weight:700}
.vm [data-vm-state="now"]::after{content:" \\2190  you are here"}
.vm [data-vm-state="done"]{color:var(--text-soft,inherit)}
.vm [data-vm-state="done"]::after{content:" (done)"}`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

export const PHRASES_KEY = (personId) => `nimrod-voice-model:${personId || 'anyone'}`;
const defaultStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

/**
 * The page. `values()` is this person's row; `save(patch)` writes it (only voiceModelOn), absent where a page
 * cannot. `recorder` / `store` are the screen's voice recorder and its store (absent on a page that does not
 * listen). `fs` { available(), pickFolder() } for the export. `pickModelFolder()` -> a folder handle for "Check
 * a folder" (default: the browser's read-only picker; null hides the button). `storage` keeps the pasted
 * phrase list and the place in it, per person, on this screen. `nimrodFolder` (2026-10-04) `{ path(), voice() }`:
 * the Nimrod folder's typed full path ('' when none) and its "Voice model" folder (a user_folders.js `kindFolder`
 * reading; never prompts) - the default reads this device's own; null leaves both out.
 */
const defaultNimrodFolder = () => {
  let st = null;
  return {
    path: () => readRootPath(),
    voice: () => kindFolder('voice', { store: st || (st = handleStore()) }),
  };
};

export function mountVoiceModel(root, {
  personId = null, values = () => ({}), save = null, recorder = null, store = null, fs = null, storage = defaultStorage(),
  pickModelFolder = defaultPicker(), nimrodFolder = defaultNimrodFolder(),
} = {}) {
  if (!root) throw new Error('mountVoiceModel: a root element is required');
  const row = () => { try { return values() || {}; } catch { return {}; } };
  let vm = voiceModelFrom(row());
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
    <p>A speech recogniser trained on one person’s voice, so it understands that person better. You read about
      100 short phrases aloud; Google’s Project Euphonia toolkit then fine-tunes (further trains) Whisper, the
      recogniser this site’s speech service runs, on them. You run every step yourself, on computers you choose.
      Nothing you record here is uploaded by this site: the recordings stay on this screen until you export them.</p>
    <p class="vm-row">${link(EUPHONIA.repo, 'Project Euphonia toolkit (GitHub, Apache-2.0)')} ·
      ${link(EUPHONIA.notebook, 'its training notebook')} · ${link(EUPHONIA.phrases, 'its 100 phrases')}</p>

    <section class="vm-step" data-vm-status>
      <h4>Where you are</h4>
      <p data-vm-now role="status" aria-live="polite"></p>
      <ol data-vm-steps>${STEPS.map((s, i) => `<li data-vm-step="${i + 1}">${esc(s)}</li>`).join('')}</ol>
      <p class="vm-soft" data-vm-notyet>You will not have the voice model folder until step 4 (convert) is done.
        Before that there is nothing to put anywhere. Its place is waiting: <code data-vm-place></code>.</p>
    </section>

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
    </section>

    <section class="vm-step">
      <h4>2. Export them</h4>
      <p>Export saves your recordings, with the phrase each one is, into a folder you choose: choose
        <code data-vm-recordings></code>. Nothing is uploaded.</p>
      <div class="vm-row">
        <button type="button" data-export hidden>Export for training</button>
        <span data-export-msg class="vm-soft" role="status" aria-live="polite"></span>
      </div>
      <p class="vm-soft">It makes a <code>${esc(EUPHONIA_DATA)}</code> folder with one numbered folder per phrase
        (<code>${esc(EUPHONIA_DATA)}/001/${esc(EUPHONIA_AUDIO)}</code> and <code>${esc(EUPHONIA_PHRASE)}</code>), plus
        <code>nimrod-export.json</code> saying which recording is which. Every recording with what was meant goes
        in: the phrases you read, and any you typed in the review.</p>
    </section>

    <section class="vm-step">
      <h4>3. Train it, with Euphonia’s notebook</h4>
      <p><b>What you need:</b> a Google account, to run the notebook free on Google Colab (Google’s notebooks that
        run in your web browser, on a computer Google lends you with a graphics card), <b>or</b> a computer with a
        graphics card (GPU) of its own. An ordinary laptop alone takes a very long time.</p>
      <p>Open ${link(EUPHONIA.notebook, 'the training notebook')}. Set its model to <code>${esc(BASE_MODEL)}</code>
        (type it; the list does not offer it), so the result matches the recogniser the speech service already
        runs. Its data cell copies from a Firebase bucket: point it at the <code>${esc(EUPHONIA_DATA)}</code> folder
        you exported instead. On your own computer, skip the three Colab-only cells (sign-in, Google Drive,
        TensorBoard), and turn fp16 off if there is no graphics card.</p>
    </section>

    <section class="vm-step">
      <h4>4. Convert it</h4>
      <p>Training leaves a <b>checkpoint</b>: a folder named like <code>checkpoint-200</code>, holding
        <code>model.safetensors</code> - the trained model in the form training writes. The speech service cannot
        load that; converting makes the folder it can. <b>This is the step that makes your voice model
        folder.</b> It needs the ctranslate2 and transformers Python packages. Run this, with the checkpoint’s
        folder in place of the first name:</p>
      <code data-cmd="convert"></code>
      <p class="vm-soft" data-vm-fill></p>
    </section>

    <section class="vm-step">
      <h4>5. Put the folder in place</h4>
      <p><b>The folder you want is the one the conversion wrote</b>: whatever followed <code>--output_dir</code>
        in step 4. It is not the checkpoint training left, and not the recordings you exported. It holds these
        files: ${esc(MODEL_FILES.join(', '))}.</p>
      <p data-where></p>
      <div class="vm-row"><button type="button" data-check>Check a folder</button>
        <span data-check-msg role="status" aria-live="polite"></span></div>
      <p class="vm-soft" data-check-note>Check a folder opens your browser’s folder picker and reads the
        <i>names</i> of the files in the folder you choose. It opens no file and sends nothing anywhere.</p>
    </section>

    <section class="vm-step">
      <h4>6. Start the speech service, and use it</h4>
      <p>Run this in the project’s <code>web</code> folder, on the computer that runs the speech service
        (<code>python3</code> instead of <code>py -3.13</code> on a Mac or Linux). <code>--root</code> tells it
        where your Nimrod folder is; or write that path as the only line of
        <code>speech_service/nimrod_folder.txt</code> and leave <code>--root</code> off.</p>
      <code data-cmd="serve"></code>
      <p class="vm-soft">It checks the folder when it starts and names any file that is missing. It runs beside the
        standard recogniser (port 8797), which stays for everybody else. Its port is “My own voice model: its
        port” in your settings; the two numbers must match.</p>
      <p class="vm-soft" data-elsewhere>No Nimrod folder? Leave <code>--root</code> off: the service then looks in
        <code>${esc(MY_VOICE_PATH)}</code> inside the project, which is kept out of git, so your voice never ends
        up in the project’s history. A model kept anywhere else: add <code>--model "&lt;that folder&gt;"</code>
        after <code>--my-voice</code>.</p>
      <div class="vm-row"><button type="button" data-use aria-pressed="false"></button></div>
      <p class="vm-soft" data-use-note></p>
    </section>
  </div>`;

  const $ = (s) => root.querySelector(s);
  $('[data-phrases]').value = load().text || '';
  // No picker in this browser (Firefox, Safari): no button. The service's own start-up check still names
  // every missing file, so nothing is lost but the early warning.
  $('[data-check]').hidden = typeof pickModelFolder !== 'function';
  $('[data-check-note]').hidden = typeof pickModelFolder !== 'function';

  // THE NIMROD FOLDER: its typed full path (this device only), and what is in its "Voice model" right now.
  let nimrodCheck = null;          // checkModelFiles of <root>/Voice model, when it could be read
  let pickedCheck = null;          // the last folder "Check a folder" looked at, with its name
  const rootPath = () => { try { return String(nimrodFolder?.path?.() || ''); } catch { return ''; } };
  const places = () => {
    const p = rootPath();
    return { root: p || NIMROD_ROOT_WORDS, voice: p ? joinPath(p, VOICE_FOLDER) : VOICE_PLACE,
      recordings: p ? joinPath(p, SUBFOLDERS.recordings) : RECORDINGS_PLACE, known: !!p };
  };
  function renderCommands() {
    const pl = places();
    $('[data-cmd="convert"]').textContent = convertCommand({ folder: pl.voice });
    $('[data-cmd="serve"]').textContent = serviceCommand({ port: vm.port, root: pl.root });
    $('[data-vm-fill]').textContent = pl.known
      ? 'That writes the converted files straight into your Nimrod folder’s Voice model folder. Converting on a different '
        + 'computer? Run it there with that computer’s path, then copy the folder’s files into the Voice model folder here.'
      : `Replace ${NIMROD_ROOT_WORDS} with your Nimrod folder’s full path. Or type that path once in “Your own folders” `
        + '(Settings) and these commands fill it in.';
    $('[data-where]').textContent = `Its place: ${pl.voice}, the Voice model folder your Nimrod folder already has `
      + '(“Set up your Nimrod folder” in “Your own folders” makes it). Put the files directly in it, on the computer that '
      + 'runs the speech service.';
    $('[data-vm-place]').textContent = pl.voice;
    $('[data-vm-recordings]').textContent = pl.recordings;
  }
  function renderStatus() {
    if (destroyed) return;
    const l = load();
    const s = voiceModelStatus({ total: phrases.length, index: prompter ? prompter.state().index : (l.index || 0),
      exported: !!l.exportedAt, nimrod: nimrodCheck, picked: pickedCheck, on: vm.on, place: places().voice });
    $('[data-vm-now]').textContent = `Step ${s.step} of ${STEPS.length}: ${s.text}`;
    for (const li of root.querySelectorAll('[data-vm-step]')) {
      const n = Number(li.dataset.vmStep);
      if (n === s.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.dataset.vmState = n < s.step || (s.done && n === s.step) ? 'done' : n === s.step ? 'now' : 'later';
    }
    $('[data-vm-notyet]').hidden = s.haveFolder;
  }
  async function readNimrodVoice() {
    try {
      const k = await nimrodFolder?.voice?.();
      if (!k || !k.dir || destroyed) return;
      nimrodCheck = checkModelFiles(await folderNames(k.dir));
      renderStatus();
    } catch { /* not readable now: the status goes on what this screen knows */ }
  }
  async function checkFolder() {
    let dir = null;
    try { dir = await pickModelFolder(); } catch { return; }       // cancelled is not an error
    if (!dir || destroyed) return;
    const msg = $('[data-check-msg]');
    try {
      const r = checkModelFiles(await folderNames(dir));
      pickedCheck = { ...r, name: dir.name || '' };
      if (!destroyed) { msg.textContent = describeModelCheck(r, dir.name || 'That folder', { place: places().voice }); renderStatus(); }
    } catch (err) {
      console.error('voice model: check folder', err);
      if (!destroyed) msg.textContent = 'Could not look inside that folder.';
    }
  }
  function renderUse() {
    const b = $('[data-use]');
    b.setAttribute('aria-pressed', String(vm.on));
    b.textContent = `Use my own voice model: ${vm.on ? 'On' : 'Off'}`;
    b.hidden = typeof save !== 'function';
    $('[data-use-note]').textContent = vm.on
      ? `On: your speech goes to ${vm.url}. If it is not running, this screen says no recogniser is answering.`
      : 'Off: your speech goes to the standard recogniser.';
    renderStatus();
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
    renderStatus();
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
      if (r.written.length) { keep({ exportedAt: Date.now() }); renderStatus(); }
    } catch (err) { console.error('voice model: export', err); msg.textContent = 'Could not export into that folder.'; }
  }

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
    if (b.hasAttribute('data-check') && typeof pickModelFolder === 'function') { checkFolder(); return; }
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
  const nimrodRead = readNimrodVoice();

  return {
    prompter: () => prompter,
    /** Settles once the Nimrod folder's Voice model has been looked at (for a suite). */
    ready: nimrodRead,
    refresh() { vm = voiceModelFrom(row()); renderUse(); renderCommands(); renderPrompt(); readNimrodVoice(); },
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
