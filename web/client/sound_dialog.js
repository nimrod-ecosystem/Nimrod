// sound_dialog.js - RECORD A CARD'S OWN SOUND, from the one editor (row 2.184 stage 2, 2026-11-02;
// docs/for_chat/proposal_board_in_editor_20261102.md). The board maker's recorder (board_editor.js, own board clips
// 2026-10-09), as a small dialog over the page, so a card chosen in the one editor can be given its own sound.
//
// THE SAME RULES AS THE BOARD MAKER'S:
//   * WHOSE VOICE: it says, beside the button that starts it, to record the person the board speaks for, or somebody they
//     have said may lend their voice. Nothing records until "Start recording" is pressed; it says "Recording" while it
//     does; it stops by itself after the recorder's own limit (board_sounds.js MAX_RECORD_MS); nothing is kept until
//     somebody has heard it back and pressed Keep.
//   * A SOUND FILE instead: checked as a sound and for size (board_sounds.js isSoundFile, MAX_FILE_BYTES).
//   * KEPT where the board's sounds are kept (board_sounds.js `keep`: this device, and the person's Nimrod folder).
//
// IT IS NEVER LEFT OVER THE SCREEN. It lives inside the board's editing: the board closes it the moment the editor leaves
// (Done, Escape, or by itself when idle), and Cancel or Escape closes it at any time. Closed, nothing is recording.

import { isSoundFile, MAX_FILE_BYTES, MAX_RECORD_MS } from './board_sounds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SOUND_DIALOG_WORDS = Object.freeze({
  whose: (word) => `Record the person this board speaks for, or somebody they have said may lend their voice. Say “${word}” once. `
    + 'Nothing is kept until you press Keep.',
  cannot: 'This browser cannot record sound here. Use a sound file instead.',
  notSound: 'That file is not a sound. Choose a sound file (.mp3, .wav, .m4a, .ogg and the like).',
  tooBig: `That file is too big for a card (the most is ${MAX_FILE_BYTES / 1024 / 1024} MB). A word or a short sound is what fits.`,
  keeping: 'Keeping it…',
});

/**
 * Open the dialog. `word`: what to say. `mode`: 'record' or 'file'. `sounds`: board_sounds.js's store (`keep`).
 * `recorder`: () => a recorder (board_sounds.js createWordRecorder). `onKept({ file, from, folder })` when a sound is kept.
 * Returns { close(), el }.
 */
export function openSoundDialog({ word = '', mode = 'record', sounds = null, recorder = null, onKept = null,
  doc = (typeof document !== 'undefined' ? document : null), makeAudio = (url) => new Audio(url) } = {}) {
  if (!doc) return { close() {}, el: null };
  const el = doc.createElement('div');
  el.className = 'snd-dialog';
  el.dataset.soundDialog = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', mode === 'file' ? `A sound file for “${word}”` : `Record “${word}”`);
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(0,0,0,.45)';
  let phase = mode === 'file' ? 'file' : 'ready';   // ready | starting | recording | heard | file | keeping
  let api = null, blob = null, url = null, error = '', note = '', audio = null, closed = false;
  const secs = Math.round(MAX_RECORD_MS / 1000);

  const btn = (attr, label, primary = false) => `<button type="button" class="snd-btn${primary ? ' snd-primary' : ''}" ${attr}>${label}</button>`;
  function body() {
    if (phase === 'file') {
      return `<p class="snd-hint">Choose a sound file for “${esc(word)}”.</p>
        <input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.webm,.flac" data-snd-input>
        <div class="snd-row">${btn('data-snd-cancel', 'Cancel')}</div>`;
    }
    if (phase === 'keeping') return `<p class="snd-hint" role="status">${SOUND_DIALOG_WORDS.keeping}</p>`;
    let row;
    if (phase === 'ready') row = btn('data-snd-start', 'Start recording', true) + btn('data-snd-cancel', 'Cancel');
    else if (phase === 'starting') row = '<span class="snd-hint" role="status">Opening the microphone…</span>' + btn('data-snd-cancel', 'Cancel');
    else if (phase === 'recording') row = `<span class="snd-on" role="status" data-snd-on>Recording now. It stops by itself after ${secs} seconds.</span>`
      + btn('data-snd-stop', 'Stop', true);
    else row = `<span class="snd-hint" role="status">${blob ? 'Recorded. Play it back, then keep it or record again.' : 'Nothing was recorded. Try again.'}</span>`
      + (blob ? btn('data-snd-play', 'Play it back') + btn('data-snd-keep', 'Keep', true) : '')
      + btn('data-snd-redo', 'Record again') + btn('data-snd-cancel', 'Cancel');
    return `<p class="snd-hint" data-snd-whose>${esc(SOUND_DIALOG_WORDS.whose(word))}</p><div class="snd-row">${row}</div>`;
  }
  function render() {
    if (closed) return;
    el.innerHTML = `<div class="snd-box" style="background:var(--surface,#12181c);color:var(--text,#e8eef0);border:1px solid var(--border,#7d939d);`
      + 'border-radius:12px;padding:16px 18px;max-width:30rem;width:calc(100% - 32px);box-sizing:border-box;font:15px/1.45 var(--font,system-ui,sans-serif)">'
      + `${body()}${error ? `<p class="snd-warn" role="alert" data-snd-error>${esc(error)}</p>` : ''}`
      + `${note ? `<p class="snd-hint" role="status" data-snd-note>${esc(note)}</p>` : ''}</div>`;
    const first = el.querySelector('[data-snd-stop], [data-snd-keep], [data-snd-start], [data-snd-input], [data-snd-cancel]');
    try { first?.focus(); } catch { /* not focusable */ }
  }
  function stopAudio() { try { audio?.pause?.(); } catch { /* gone */ } audio = null; }
  function dropUrl() { if (url) { try { URL.revokeObjectURL(url); } catch { /* gone */ } url = null; } }
  function close() {
    if (closed) return;
    closed = true;
    try { if (api && api.state?.() !== 'done') api.cancel?.(); } catch { /* gone */ }
    stopAudio(); dropUrl();
    el.remove();
    doc.removeEventListener('keydown', onKey, true);
  }
  async function start() {
    let r = null;
    try { r = typeof recorder === 'function' ? recorder() : null; } catch { r = null; }
    if (!r) { error = SOUND_DIALOG_WORDS.cannot; render(); return; }
    api = r; phase = 'starting'; error = ''; render();
    try {
      const ok = await r.start({ onStop: (b) => { if (closed || api !== r) return; blob = b || null; phase = 'heard'; render(); } });
      if (closed || api !== r) { try { r.cancel(); } catch { /* gone */ } return; }
      if (ok && phase === 'starting') { phase = 'recording'; render(); }
    } catch (err) {
      if (closed || api !== r) return;
      api = null; phase = 'ready'; error = String(err && err.message || err); render();
    }
  }
  async function keep(b, from, name = '') {
    if (!sounds || typeof sounds.keep !== 'function') { error = 'Sounds cannot be kept here.'; render(); return; }
    phase = 'keeping'; note = ''; error = ''; render();
    let r;
    try { r = await sounds.keep(b, { word, from, name }); }
    catch (err) { if (!closed) { phase = from === 'file' ? 'file' : 'heard'; error = String(err && err.message || err); render(); } return; }
    if (closed) { try { sounds.remove?.(r.file); } catch { /* gone */ } return; }
    try { onKept?.(r); } catch (err) { console.error('sound dialog: kept', err); }
    close();
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t === el || t.closest('[data-snd-cancel]')) { close(); return; }
    if (t.closest('[data-snd-start]') || t.closest('[data-snd-redo]')) { blob = null; dropUrl(); start(); return; }
    if (t.closest('[data-snd-stop]')) { try { api?.stop?.(); } catch { /* gone */ } return; }
    if (t.closest('[data-snd-play]') && blob) {
      stopAudio(); dropUrl();
      try { url = URL.createObjectURL(blob); audio = makeAudio(url); audio?.play?.()?.catch?.(() => {}); } catch { /* cannot play */ }
      return;
    }
    if (t.closest('[data-snd-keep]') && blob) { keep(blob, 'recording'); }
  });
  el.addEventListener('change', (e) => {
    const input = e.target instanceof Element ? e.target.closest('[data-snd-input]') : null;
    const f = input?.files?.[0];
    if (!f) return;
    if (!isSoundFile(f)) { error = SOUND_DIALOG_WORDS.notSound; render(); return; }
    if (Number(f.size) > MAX_FILE_BYTES) { error = SOUND_DIALOG_WORDS.tooBig; render(); return; }
    keep(f, 'file', f.name || '');
  });
  doc.addEventListener('keydown', onKey, true);
  doc.body.append(el);
  render();
  return { close, el, phase: () => phase, closed: () => closed };
}
