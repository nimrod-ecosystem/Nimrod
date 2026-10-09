// board_editor.js — MAKING A BOARD. The thing that turns two example boards into somebody's own.
//
// ---------------------------------------------------------------------------------------
// *** THE BLOCKER THIS EXISTS TO REMOVE ***
// ---------------------------------------------------------------------------------------
//
// Mike, 2026-09-06: *"Two boards exist and neither belongs to the person using it."* That is
// the whole state of the AAC module until this file. `aac_vocab.js` has always been able to
// DESCRIBE anybody's board — it has `addWord`, `removeWord`, `promote`, a validator — and
// there has never been a way for a person to actually make one. A vocabulary belongs to one
// person; software whose only vocabularies are two examples has not shipped the feature, it
// has shipped the demo.
//
// ---------------------------------------------------------------------------------------
// *** NOTHING LEAVES THE DEVICE, AND THERE IS NO CODE HERE THAT COULD SEND IT. ***
// ---------------------------------------------------------------------------------------
//
// Mike, earlier: *"Use the existing folder picker for images: there is no upload path in the client
// and there must not be one."* REVISITED BY MIKE 2026-10-02: *"There should be upload or a folder
// picker."* What survives is the reason the first rule existed: the BYTES never leave the machine
// they are on. "Add a picture from this device" keeps the file in this browser
// (`device_pictures.js`), not on any server, and the picker's suite fails if adding one makes a
// single network request.
//
// A picture is chosen in the SHARED picker (`picture_picker.js`) — the same one a button's and an
// avatar's picture are chosen with — and what is saved is a REFERENCE, `{sourceId, path}`. There is
// no `FormData` in this file, and no POST of anything but the board's own text.
//
// The saved reference is deliberately not the URL the picker displayed: a folder listing
// revokes its own object URLs when anything lists that folder again, so a stored URL would go
// blank without an error. The board resolves its own, per card, through `resolveItemUrl`. (This
// editor's own picker used to list through `resolveListing`, which did exactly that revoking to a
// photo panel showing the same folder; the shared picker gives each thumbnail a URL of its own.)
//
// ---------------------------------------------------------------------------------------
// *** IT CLOSES ITSELF, AND THAT IS THE MOST IMPORTANT LINE IN THE FILE. ***
// ---------------------------------------------------------------------------------------
//
// `CLAUDE.md`: **a screen must never enter a state that only an input can leave, when the
// person in front of it cannot give that input.**
//
// This editor is exactly that shape. A caregiver opens it over the board, is called away, and
// the person the board belongs to is left looking at a form they cannot fill in, cannot cancel,
// and cannot talk through — their voice replaced by somebody else's settings screen. It is not
// a hypothetical: it is a phone call in the corridor.
//
// So after `idleMs` with nothing touched it PUTS ITSELF AWAY and hands the work back as a
// draft. It does not save over the board — half a board saved on a timer is a different kind of
// damage — and it does not throw the typing away either. The board comes back; the draft is
// waiting the next time somebody opens the editor.

import { normalizeBoard, gridOf, checkBoard } from './aac_vocab.js';
import { mountPicturePicker } from './picture_picker.js';
// own board clips (2026-10-09): a card's own sound - recorded here, or a sound file - kept on the device and in the
// person's Nimrod folder (board_sounds.js), never sent anywhere from this file.
import { isSoundFile, MAX_FILE_BYTES, MAX_RECORD_MS } from './board_sounds.js';

// ---------------------------------------------------------------------------------------
// *** A CARD'S OWN SOUND (own board clips, 2026-10-09). ***
// ---------------------------------------------------------------------------------------
//
// Per card: "Record this word", "Use a sound file", "Remove the sound". Only when the host hands in `sounds` (the
// board does); without it the editor is exactly what it was.
//
// WHOSE VOICE, AND HOW THE FORM HANDLES IT. The recorder says, beside the button that starts it, who to record: the
// person this board speaks for, or somebody they have said may lend their voice. Nothing records until "Start
// recording" is pressed; the form says "Recording" while it does; it stops by itself after MAX_RECORD_MS; and nothing
// is kept until somebody has heard it back and pressed Keep. No tick-box "they agreed": argued - a box nobody can
// check the truth of is a click, not consent, and it would sit between a person and their own words every time. The
// case for one: a record that somebody said yes. If Mike wants it, it is one line in `recorderMarkup`.
//
// THE FILES. A sound kept here and then replaced, removed or cancelled before the board is saved is deleted from this
// device (nothing else can be using it). A sound the SAVED board stops using is the board's to tidy (modules/board.js).
// The copy in the Nimrod folder is never deleted from here (board_sounds.js `remove` says why).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Three minutes. Long enough to think about a word, short enough that somebody who walked away
// mid-sentence gets their board back before it matters.
//
// *** AND THE EDGE CASE I UNDER-HUNTED, WHICH IS THE USUAL ONE: A USER WHO IS NOT CHRISTINE. ***
//
// Mike asked why this exists, and the answer above is only half of it. The rule is right for a
// board mounted on the screen somebody LIVES WITH. On a laptop where a family member is building
// a board for later, nobody is stranded by an open form, and the timeout is pure friction —
// worse than it looks, because typing resets the clock and THINKING DOES NOT, and thinking is
// most of authoring. Four minutes deciding what goes in slot seven and the form puts itself away.
//
// So two things changed. It is a DEFAULT rather than a rule (`idleSeconds` on the board, which
// includes never), and the last stretch of it is VISIBLE with one press to stay — nobody should
// meet this by having a form vanish and not know why.
export const IDLE_MS = 180000;

// How much of the end is spent warning. A countdown somebody can see and dismiss is not the
// undismissable gate the rule is about; it is the opposite — it is the screen saying what it is
// about to do while there is still time to say no.
export const WARN_MS = 30000;

// The same bound `aac_vocab.js` puts on a stored board, repeated here so the editor refuses a
// shape rather than offering one the model will silently drop. It was 8 until a measurement
// showed that columns are not what sets target size -- see the note on `dim` in aac_vocab.js.
export const MAX_DIM = 12;

const clampDim = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= MAX_DIM ? n : fallback;
};

/** A blank board of the shape somebody asked for. Named, because an unnamed board is one more
 *  thing to work out later from a switcher that says "board". */
export function blankBoard({ cols = 3, rows = 2, name = 'My board' } = {}) {
  return normalizeBoard({ id: `own-${Date.now().toString(36)}`, name, cols, rows, cells: [] });
}

export function mountBoardEditor(root, {
  board = null,
  // WHAT IT SAYS AT THE TOP, stated rather than inferred from `board` being null. "Make a new
  // board" hands in a BLANK board -- so it is not null, and the heading read "Edit this board"
  // over an empty grid. A caregiver who thinks they are editing the board somebody is using
  // does not press Save.
  making = !board,
  sources = null,                       // a media-sources client; injectable for tests
  // The shared picker's seams, passed straight through (see `picture_picker.js`): the listing,
  // the thumbnail URLs, the folder picker, the device store, storage for the recent list.
  picker: pickerOpts = {},
  folders = null,                       // { isSupported, pick, request }; injectable for tests
  onSave = () => {},
  onCancel = () => {},
  onIdle = null,
  idleMs = IDLE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // own board clips (2026-10-09). `sounds`: board_sounds.js createBoardSounds() (keep/url/remove). `recorder`: a
  // factory for one recording (board_sounds.js createWordRecorder). `playSound(url)`: plays a sound, returns a stop.
  sounds = null,
  recorder = null,
  playSound = (url) => {
    const a = new Audio(url);
    try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch { /* will not play here */ }
    return () => { try { a.pause(); } catch { /* stopped */ } };
  },
  makeUrl = (b) => URL.createObjectURL(b),
  dropUrl = (u) => { try { URL.revokeObjectURL(u); } catch { /* gone */ } },
} = {}) {
  // The board being edited is a COPY. Cancel has to mean cancel, and an editor holding a
  // reference to the live board would have already changed it by the time somebody pressed it.
  let draft = normalizeBoard(board || blankBoard());
  let picked = -1;                      // which slot is open for editing, -1 for none
  let picking = null;                   // { el, api } while the shared picker is open
  let note = '';                        // an inline message; never an alert, never a modal
  let idleId = null;
  let warnId = null;
  let warning = false;            // the last stretch, when it says so on screen
  let dead = false;
  // own board clips: the recorder while it is open ({ phase, api, blob, url, error }), the sounds kept in THIS
  // session (deleted again if they never reach a saved board), what the sound row says, what plays now, and which
  // control takes the focus after a redraw (so a keyboard or switch user is not dropped back to the top of the page).
  let rec = null;
  const fresh = new Set();
  let soundNote = '';
  let stopPlay = null;
  let heldUrl = null;             // a URL made to play a kept sound, released at the next one
  let focusSel = null;

  const gone = new AbortController();
  const listen = (t, type, fn) => t.addEventListener(type, fn, { signal: gone.signal });

  // ---------------------------------------------------------------------------------------
  // THE IDLE CLOCK
  // ---------------------------------------------------------------------------------------
  function armIdle() {
    if (dead || !idleMs) return;
    if (idleId != null) clearTimer(idleId);
    if (warnId != null) clearTimer(warnId);
    // Coming back from the warning is a state change somebody can see, so it redraws.
    const wasWarning = warning;
    warning = false;
    if (wasWarning) render();
    // The warning only exists if there is room for it. A caller that sets a very short idle
    // gets no warning rather than a warning that is already the whole timeout.
    const warnAt = idleMs - WARN_MS;
    if (warnAt > 0) {
      warnId = setTimer(() => { warnId = null; warning = true; render(); }, warnAt);
    }
    idleId = setTimer(() => {
      idleId = null;
      // The draft goes back to the caller INTACT. Not saved over the board — a half-finished
      // board written on a timer is worse than the one it replaced — and not discarded either.
      if (onIdle) { const d = current(); handOver(d); onIdle(d); }
      else { dropAllFresh(); onCancel(); }
    }, idleMs);
  }
  function disarmIdle() {
    if (idleId != null) { clearTimer(idleId); idleId = null; }
    if (warnId != null) { clearTimer(warnId); warnId = null; }
    warning = false;
  }

  // ---------------------------------------------------------------------------------------
  // THE DRAFT
  // ---------------------------------------------------------------------------------------

  /** The board as it stands, normalized — what Save would write and what an idle close hands
   *  back. One function, so those two can never be different things. */
  function current() {
    return normalizeBoard(draft);
  }

  const filledCount = () => draft.cells.filter(Boolean).length;
  const lastFilled = () => {
    for (let i = draft.cells.length - 1; i >= 0; i--) if (draft.cells[i]) return i;
    return -1;
  };

  /**
   * Change the grid.
   *
   * *** A SMALLER GRID IS REFUSED WHILE THE SLOTS IT WOULD DROP STILL HAVE WORDS IN THEM. ***
   *
   * The alternative was to truncate and say so, and it is the wrong trade on this module: the
   * cards being dropped are words somebody chose for somebody who cannot ask for them back.
   * Refusing costs one extra step — empty those cards first — and cannot lose anything.
   *
   * Changing the COLUMNS does move cards around the grid, and that is the one reflow this
   * project allows: it is a person deliberately reshaping their own board, with the result
   * visible in front of them before they save. `aac_vocab.js` forbids a layout changing
   * WITHOUT a decision; this is the decision.
   */
  function setGrid(cols, rows) {
    const c = clampDim(cols, draft.cols || gridOf(draft).cols);
    const r = clampDim(rows, draft.rows || gridOf(draft).rows);
    const need = lastFilled() + 1;
    if (c * r < need) {
      note = `That is ${c * r} cards and ${need} are in use. Clear the last ones first.`;
      return false;
    }
    draft = normalizeBoard({ ...draft, cols: c, rows: r });
    note = '';
    return true;
  }

  function setCell(i, patch) {
    const cells = draft.cells.slice();
    while (cells.length <= i) cells.push(null);
    const was = cells[i] || {};
    const next = { ...was, ...patch };
    // A card with no word is not a card. Emptying the word EMPTIES THE SLOT rather than
    // leaving a wordless cell that renders as a picture nobody can read aloud.
    cells[i] = String(next.word || '').trim() ? next : null;
    draft = normalizeBoard({ ...draft, cells });
  }

  // ---------------------------------------------------------------------------------------
  // PICTURES
  // ---------------------------------------------------------------------------------------

  // THE SHARED PICKER (`picture_picker.js`), mounted into an element of its own that outlives this
  // editor's redraws: `render()` rebuilds the form (the idle warning, a grid change), and the
  // picker — with where somebody had got to in it — is put back into its slot each time rather than
  // thrown away. It opens on the card's own picture when it has one.
  function openPicker() {
    note = '';
    closePicker();
    const el = document.createElement('div');
    el.className = 'be-picker';
    const cell = draft.cells[picked] || null;
    const api = mountPicturePicker(el, {
      ...pickerOpts,
      sources: pickerOpts.sources || sources || { list: async () => [] },
      ...(folders ? { folders } : {}),
      value: cell && cell.image ? cell.image : null,
      title: 'Choose a picture for this card',
      // Columns of thumbnails at the board editor's own width: a caregiver's form, so a pointer
      // and a keyboard, and the picker handles its own arrow keys here.
      keys: true,
      onPick: (ref) => {
        if (ref) setCell(picked, { image: { sourceId: ref.sourceId, path: ref.path } });
        closePicker(); render();
      },
      onCancel: () => { closePicker(); render(); },
    });
    picking = { el, api };
    render();
  }
  function closePicker() {
    const p = picking;
    picking = null;
    try { p?.api?.destroy(); } catch { /* gone */ }
  }

  // ---------------------------------------------------------------------------------------
  // A CARD'S OWN SOUND (own board clips, 2026-10-09)
  // ---------------------------------------------------------------------------------------

  const secs = Math.round(MAX_RECORD_MS / 1000);

  function stopPlaying() {
    const s = stopPlay; stopPlay = null;
    try { s?.(); } catch { /* stopped */ }
  }
  function play(url) {
    stopPlaying();
    try { stopPlay = playSound(url) || null; } catch { stopPlay = null; }
  }

  function closeRecorder() {
    const r = rec; rec = null;
    if (!r) return;
    try { if (r.api && r.api.state() !== 'done') r.api.cancel(); } catch { /* gone */ }
    if (r.url) dropUrl(r.url);
  }

  // A sound made in this session and no longer wanted: nothing else can be using it, so it goes.
  function dropFreshFile(file) {
    if (!file || !fresh.has(file)) return;
    fresh.delete(file);
    try { sounds?.remove?.(file); } catch { /* gone */ }
  }
  function dropAllFresh() { for (const f of [...fresh]) dropFreshFile(f); }

  async function startRecording() {
    if (!rec || typeof recorder !== 'function') return;
    let api;
    try { api = recorder(); } catch { api = null; }
    if (!api) { rec.error = 'This browser cannot record sound here. Use a sound file instead.'; render(); return; }
    rec.api = api; rec.phase = 'starting'; rec.error = ''; render();
    try {
      const ok = await api.start({
        onStop: (blob) => {
          if (dead || !rec || rec.api !== api) return;
          rec.phase = 'heard'; rec.blob = blob || null;
          focusSel = blob ? '[data-rec-play]' : '[data-rec-redo]';
          render();
        },
      });
      if (dead || !rec || rec.api !== api) { try { api.cancel(); } catch { /* gone */ } return; }
      if (ok && rec.phase === 'starting') { rec.phase = 'recording'; focusSel = '[data-rec-stop]'; render(); }
    } catch (err) {
      if (dead || !rec || rec.api !== api) return;
      rec.phase = 'ready'; rec.api = null; rec.error = String(err && err.message || err);
      focusSel = '[data-rec-start]';
      render();
    }
  }

  const KEPT_WORDS = {
    saved: 'Kept on this device and in your Nimrod folder (Board sounds), so another device with that folder plays it too.',
    'no-folder': 'Kept on this device. Another device says this word in its own voice: set up your Nimrod folder to share it.',
    'not-allowed': 'Kept on this device. The Nimrod folder was not allowed, so another device says this word in its own voice.',
    failed: 'Kept on this device. It could not be saved in your Nimrod folder, so another device says this word in its own voice.',
  };

  async function keepSound(blob, from, name = '') {
    const slot = picked;
    const cell = draft.cells[slot];
    if (!cell || !sounds) return;
    if (from === 'file') {
      if (!isSoundFile(blob)) { soundNote = 'That file is not a sound. Choose a sound file (.mp3, .wav, .m4a, .ogg and the like).'; render(); return; }
      if (Number(blob.size) > MAX_FILE_BYTES) {
        soundNote = `That file is too big for a card (the most is ${MAX_FILE_BYTES / 1024 / 1024} MB). A word or a short sound is what fits.`;
        render(); return;
      }
    }
    soundNote = 'Keeping it…'; render();
    let r;
    try { r = await sounds.keep(blob, { word: cell.say || cell.word, from, name }); }
    catch (err) { if (!dead) { soundNote = String(err && err.message || err); render(); } return; }
    // The editor went away while it was being kept (idle, cancel): nothing will ever point at it.
    if (dead) { try { sounds.remove(r.file); } catch { /* gone */ } return; }
    const prev = draft.cells[slot] && draft.cells[slot].sound ? draft.cells[slot].sound.file : null;
    if (prev && prev !== r.file) dropFreshFile(prev);
    fresh.add(r.file);
    setCell(slot, { sound: { file: r.file, from: r.from } });
    closeRecorder();
    soundNote = KEPT_WORDS[r.folder] || KEPT_WORDS.failed;
    focusSel = '[data-sound-play]';
    render();
  }

  async function playKept(file) {
    if (!sounds || !file) return;
    let r = null;
    try { r = await sounds.url(file); } catch { r = null; }
    if (dead) { try { r?.release?.(); } catch { /* gone */ } return; }
    if (!r) { soundNote = 'That sound is not on this device or in its Nimrod folder. Record it again, or remove it.'; render(); return; }
    if (heldUrl) { try { heldUrl(); } catch { /* gone */ } }
    heldUrl = r.release || null;
    play(r.url);
  }

  function soundMarkup(c) {
    if (!sounds) return '';
    if (rec) return recorderMarkup(c);
    const has = c && c.sound;
    const canRecord = typeof recorder === 'function';
    return `
        <div class="be-field be-picrow be-soundrow" data-sound-row>
          <span>Sound</span>
          <div class="be-picwrap">
            ${has
              ? `<span class="be-hint" data-sound-has>${c.sound.from === 'file' ? 'A sound file' : 'A recording'}</span>
                 <button type="button" class="be-btn" data-sound-play>Play it</button>
                 <button type="button" class="be-btn" data-sound-remove>Remove the sound</button>`
              : '<span class="be-hint" data-sound-none>none: the board says the word in its own voice</span>'}
            ${canRecord ? `<button type="button" class="be-btn" data-sound-record>${has ? 'Record it again' : 'Record this word'}</button>` : ''}
            <button type="button" class="be-btn" data-sound-file>Use a sound file…</button>
            <input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.webm,.flac" data-sound-input hidden tabindex="-1">
          </div>
          ${soundNote ? `<p class="be-hint" role="status" data-sound-note>${esc(soundNote)}</p>` : ''}
        </div>`;
  }

  function recorderMarkup(c) {
    const word = c ? (c.say || c.word) : '';
    const r = rec;
    let body;
    if (r.phase === 'ready') {
      body = `<button type="button" class="be-btn be-primary" data-rec-start>Start recording</button>
              <button type="button" class="be-btn" data-rec-cancel>Cancel</button>`;
    } else if (r.phase === 'starting') {
      body = `<span class="be-hint" role="status">Opening the microphone…</span>
              <button type="button" class="be-btn" data-rec-cancel>Cancel</button>`;
    } else if (r.phase === 'recording') {
      body = `<span class="be-warn be-rec-on" role="status" data-rec-on>Recording now. It stops by itself after ${secs} seconds.</span>
              <button type="button" class="be-btn be-primary" data-rec-stop>Stop</button>`;
    } else {
      body = `<span class="be-hint" role="status" data-rec-heard>${r.blob ? 'Recorded. Play it back, then keep it or record again.' : 'Nothing was recorded. Try again.'}</span>
              ${r.blob ? `<button type="button" class="be-btn" data-rec-play>Play it back</button>
              <button type="button" class="be-btn be-primary" data-rec-keep>Keep</button>` : ''}
              <button type="button" class="be-btn" data-rec-redo>Record again</button>
              <button type="button" class="be-btn" data-rec-cancel>Cancel</button>`;
    }
    return `
        <div class="be-field be-recorder" data-recorder role="group" aria-label="Record this word">
          <p class="be-hint" data-rec-whose>Record the person this board speaks for, or somebody they have said may lend
            their voice. Say “${esc(word)}” once. Nothing is kept until you press Keep.</p>
          <div class="be-picwrap">${body}</div>
          ${r.error ? `<p class="be-warn" role="status" data-rec-error>${esc(r.error)}</p>` : ''}
          ${soundNote ? `<p class="be-hint" role="status" data-sound-note>${esc(soundNote)}</p>` : ''}
        </div>`;
  }

  // ---------------------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------------------

  function slotsMarkup() {
    const g = gridOf(draft);
    let out = '';
    for (let i = 0; i < g.cells; i++) {
      const c = draft.cells[i] || null;
      out += `<button type="button" class="be-slot${c ? '' : ' be-slot-empty'}`
        + `${i === picked ? ' be-slot-on' : ''}" data-slot="${i}"`
        + ` aria-pressed="${i === picked}">`
        + (c && c.image ? '<span class="be-slot-pic">▣</span>' : '')
        + `<span class="be-slot-word">${c ? esc(c.word) : '+'}</span></button>`;
    }
    return `<div class="be-slots" style="grid-template-columns:repeat(${g.cols},1fr)">${out}</div>`;
  }

  function cardMarkup() {
    if (picked < 0) {
      return '<p class="be-hint">Press a card above to give it a word and a picture.</p>';
    }
    const c = draft.cells[picked] || null;
    if (picking) return pickerMarkup();
    return `
      <div class="be-card">
        <label class="be-field"><span>Word on the card</span>
          <input type="text" data-word value="${esc(c ? c.word : '')}"
                 placeholder="Yes, Water, Mum…" autocomplete="off"></label>
        <label class="be-field"><span>Say instead <i>(optional)</i></span>
          <input type="text" data-say value="${esc(c && c.say ? c.say : '')}"
                 placeholder="what it reads out, if that differs" autocomplete="off"></label>
        <div class="be-field be-picrow">
          <span>Picture</span>
          <div class="be-picwrap">
            ${c && c.image
              ? `<code class="be-picpath">${esc(c.image.path)}</code>
                 <button type="button" class="be-btn" data-pic-clear>Remove</button>`
              : '<span class="be-hint">none</span>'}
            <button type="button" class="be-btn" data-pic>Choose a picture…</button>
          </div>
        </div>
        ${soundMarkup(c)}
        <div class="be-field be-picrow">
          <button type="button" class="be-btn" data-clear-slot>Empty this card</button>
        </div>
      </div>`;
  }

  // The slot the shared picker is put back into after every redraw (see `openPicker`).
  const pickerMarkup = () => '<div data-picker-slot></div>';

  function render() {
    if (dead) return;
    const g = gridOf(draft);
    const rep = checkBoard(draft);
    root.innerHTML = `
      <div class="bedit">
        <div class="be-head">
          <b>${making ? 'Make a board' : 'Edit this board'}</b>
          <span class="be-count">${rep.cells} of ${g.cells} cards</span>
        </div>
        <label class="be-field"><span>Name</span>
          <input type="text" data-name value="${esc(draft.name)}" autocomplete="off"></label>
        <div class="be-field be-dims">
          <label><span>Columns</span>
            <input type="number" data-cols min="1" max="${MAX_DIM}" value="${g.cols}"></label>
          <label><span>Rows</span>
            <input type="number" data-rows min="1" max="${MAX_DIM}" value="${g.rows}"></label>
        </div>
        ${note ? `<p class="be-warn">${esc(note)}</p>` : ''}
        ${slotsMarkup()}
        ${cardMarkup()}
        <div class="be-foot">
          <button type="button" class="be-btn" data-cancel>Cancel</button>
          <button type="button" class="be-btn be-primary" data-save>Save board</button>
        </div>
        ${warning
          ? `<div class="be-idlewarn" role="status">
               <span>Putting this away shortly, so the board is not left behind a form.
                 Nothing is lost.</span>
               <button type="button" class="be-btn be-primary" data-stay>I’m still here</button>
             </div>`
          : `<p class="be-hint be-idle">${idleMs
              ? 'This closes itself if nobody is using it, so the board is never left behind a '
                + 'form. Whatever you have typed is kept.'
              : 'This stays open until you close it.'}</p>`}
      </div>`;
    if (picking) root.querySelector('[data-picker-slot]')?.replaceWith(picking.el);
    // own board clips: the redraw replaced the control somebody was on; the next one they need takes the focus.
    if (focusSel) {
      const f = root.querySelector(focusSel);
      focusSel = null;
      try { f?.focus?.(); } catch { /* not focusable here */ }
    }
  }

  // ---------------------------------------------------------------------------------------
  // WIRING
  // ---------------------------------------------------------------------------------------

  listen(root, 'click', (e) => {
    armIdle();
    const t = e.target;
    // The shared picker handles its own presses; a click in it only counts as somebody being here.
    if (t.closest('[data-picture-picker]')) return;
    const slot = t.closest('[data-slot]');
    if (slot) { picked = Number(slot.dataset.slot); closePicker(); closeRecorder(); stopPlaying(); note = ''; soundNote = ''; render(); return; }
    // own board clips (2026-10-09): the card's sound, and the recorder.
    if (sounds && picked >= 0) {
      const cell = draft.cells[picked] || null;
      // A sound belongs to a word: an empty card has nothing to say yet (and a wordless card is not kept).
      if (!cell && t.closest('[data-sound-record],[data-sound-file]')) { soundNote = 'Give the card a word first, then its sound.'; render(); return; }
      if (t.closest('[data-sound-record]')) { soundNote = ''; rec = { phase: 'ready', api: null, blob: null, url: null, error: '' }; focusSel = '[data-rec-start]'; render(); return; }
      if (t.closest('[data-rec-start]')) { startRecording(); return; }
      if (t.closest('[data-rec-stop]')) { try { rec?.api?.stop(); } catch { /* gone */ } return; }
      if (t.closest('[data-rec-play]')) {
        if (rec && rec.blob) { if (!rec.url) rec.url = makeUrl(rec.blob); play(rec.url); }
        return;
      }
      if (t.closest('[data-rec-keep]')) { if (rec && rec.blob) { stopPlaying(); keepSound(rec.blob, 'recorded'); } return; }
      if (t.closest('[data-rec-redo]')) {
        stopPlaying(); closeRecorder();
        rec = { phase: 'ready', api: null, blob: null, url: null, error: '' };
        startRecording();
        return;
      }
      if (t.closest('[data-rec-cancel]')) { stopPlaying(); closeRecorder(); focusSel = '[data-sound-record]'; render(); return; }
      if (t.closest('[data-sound-file]')) { root.querySelector('[data-sound-input]')?.click(); return; }
      if (t.closest('[data-sound-play]')) { if (cell && cell.sound) playKept(cell.sound.file); return; }
      if (t.closest('[data-sound-remove]')) {
        if (cell && cell.sound) {
          stopPlaying();
          dropFreshFile(cell.sound.file);
          setCell(picked, { sound: null });
          soundNote = 'The sound is off this card. It says its word in the board’s own voice.';
          focusSel = '[data-sound-record]';
          render();
        }
        return;
      }
    }
    // `armIdle` at the top of this handler has already reset the clock and cleared the warning;
    // the button exists so somebody who is reading rather than pressing has something to press.
    if (t.closest('[data-stay]')) return;
    if (t.closest('[data-pic]')) { openPicker(); return; }
    if (t.closest('[data-pic-clear]')) { setCell(picked, { image: null }); render(); return; }
    if (t.closest('[data-clear-slot]')) { setCell(picked, { word: '' }); render(); return; }
    if (t.closest('[data-cancel]')) { disarmIdle(); dropAllFresh(); onCancel(); return; }
    if (t.closest('[data-save]')) {
      const out = current();
      if (!out.cells.some(Boolean)) { note = 'Give at least one card a word first.'; render(); return; }
      disarmIdle();
      handOver(out);
      onSave(out);
    }
  });

  // own board clips: the board leaves this editor (saved, or kept as a draft). Sounds made here that it does not use
  // go; the rest are the board's now.
  function handOver(board) {
    const used = new Set((board.cells || []).filter((c) => c && c.sound).map((c) => c.sound.file));
    for (const f of [...fresh]) if (!used.has(f)) dropFreshFile(f);
    fresh.clear();
  }

  // own board clips: a sound file chosen with the file input.
  listen(root, 'change', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('[data-sound-input]')) return;
    const file = t.files && t.files[0];
    t.value = '';
    if (file) keepSound(file, 'file', file.name || '');
  });

  // `input`, not `change`: a caregiver typing a word is using this, and an idle clock that only
  // noticed completed fields would close the editor under somebody mid-sentence.
  listen(root, 'input', (e) => {
    armIdle();
    const t = e.target;
    if (t.matches('[data-name]')) { draft = normalizeBoard({ ...draft, name: t.value }); return; }
    if (t.matches('[data-word]')) { setCell(picked, { word: t.value }); return; }
    if (t.matches('[data-say]')) { setCell(picked, { say: t.value }); }
  });

  // The grid inputs redraw, so they are on `change` — redrawing on every keystroke of a number
  // field takes the caret away mid-type.
  listen(root, 'change', (e) => {
    armIdle();
    const t = e.target;
    if (t.matches('[data-cols]') || t.matches('[data-rows]')) {
      const cols = Number(root.querySelector('[data-cols]').value);
      const rows = Number(root.querySelector('[data-rows]').value);
      setGrid(cols, rows);
      render();
    }
  });

  listen(root, 'keydown', (e) => {
    armIdle();
    if (e.key === 'Escape') { e.stopPropagation(); disarmIdle(); dropAllFresh(); onCancel(); }
  });

  render();
  armIdle();

  return {
    __probe: () => ({
      name: draft.name, cols: gridOf(draft).cols, rows: gridOf(draft).rows,
      cells: draft.cells.filter(Boolean).length, picked, note,
      picking: picking ? (({ cur, items }) => ({ sourceId: cur.sourceId, album: cur.album, items }))(picking.api.__probe()) : null,
      warning,
      slots: [...root.querySelectorAll('[data-slot]')].length,
      // own board clips
      recorder: rec ? rec.phase : null,
      fresh: [...fresh],
      soundNote,
    }),
    draft: () => current(),
    destroy() {
      dead = true;
      disarmIdle();
      closePicker();
      // own board clips: a microphone left open by a recorder nobody stopped is let go, and so is anything playing.
      closeRecorder();
      stopPlaying();
      if (heldUrl) { try { heldUrl(); } catch { /* gone */ } heldUrl = null; }
      // Closed without Save or a draft (the board was locked, the panel went): this session's sounds point nowhere.
      dropAllFresh();
      gone.abort();
      root.innerHTML = '';
    },
  };
}
