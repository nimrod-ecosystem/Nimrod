// voice_review.js — GOING THROUGH THE VOICE RECORDINGS: what was said, and what was meant (row 2.44).
//
// The recorder (voice_recording.js) keeps each utterance with what the recogniser WROTE. A training
// pair also needs what the person MEANT, and only a person who knows them can say that. This is where
// they do: play it, read what was written, and either confirm it ("It heard it right"), type what was
// meant, or delete it. Everything here stays on this screen; Export writes the pairs into a folder
// somebody picks (for the training computer), and nothing is sent anywhere else.
//
// Deleting takes two presses (Delete, then "Delete for good") because it cannot be undone; nothing
// waits on the second press - leaving it is the same as Keep.

import { withMeant, exportPairs } from './voice_recording.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const EAR_LABELS = Object.freeze({ room: 'this screen’s microphone', phone1: 'the phone' });
const earLabel = (ear) => EAR_LABELS[ear] || EAR_LABELS[String(ear).replace(/-\d+$/, '')] || String(ear);

/** One line about what the recogniser wrote. Pure. */
export function saidLine(pair) {
  const s = (pair && pair.said) || {};
  if (!s.text) return 'Heard: nothing it could make out';
  const conf = Number.isFinite(s.confidence) && s.confidence != null ? ` (sure: ${Math.round(s.confidence * 100)}%)` : '';
  return `Heard: “${s.text}”${conf}${s.final === false ? ' — not finished checking' : ''}`;
}

/** The summary at the top. Pure. */
export function reviewSummary(pairs = [], { keepDays = null } = {}) {
  const n = pairs.length;
  const todo = pairs.filter((p) => !p.reviewed).length;
  if (!n) return 'No voice recordings on this screen.';
  const a = `${n} voice recording${n === 1 ? '' : 's'} kept on this screen`;
  const b = todo ? `, ${todo} still need${todo === 1 ? 's' : ''} what was meant.` : ', all reviewed.';
  // NEVER "deleted after N days" (fs_sink.js): this software has to be running to tidy up.
  const c = keepDays > 0 ? ` New ones are kept ${keepDays} days, tidied up whenever this screen is running.` : '';
  return a + b + c;
}

function fmtWhen(at) {
  try {
    return new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return String(new Date(at)); }
}

export function mountVoiceReview(root, {
  store,
  personId = null,
  keepDays = () => null,
  now = () => Date.now(),
  pageSize = 20,
  // (ArrayBuffer wav) => { stop() }. Plays a clip; injected so the suite plays nothing.
  play = null,
  fs = null,                      // { available(), pickFolder() } from fs_sink.js
} = {}) {
  if (!root) throw new Error('mountVoiceReview: a root element is required');
  if (!store) throw new Error('mountVoiceReview: a store is required');
  let pairs = [];
  let filter = 'todo';
  let shown = pageSize;
  let confirming = null;
  let playing = null;
  let destroyed = false;
  const ac = new AbortController();

  root.innerHTML = `
    <div class="vr">
      <h3 class="vr-h">Voice recordings</h3>
      <p class="vr-summary" data-summary></p>
      <div class="vr-bar">
        <button type="button" data-filter="todo">To review</button>
        <button type="button" data-filter="all">All</button>
        <button type="button" data-export hidden>Export to a folder</button>
      </div>
      <p class="vr-said" data-msg role="status" aria-live="polite"></p>
      <ul class="vr-list" data-list></ul>
      <button type="button" data-more hidden>Show more</button>
    </div>`;
  const q = (s) => root.querySelector(s);
  const say = (t) => { const m = q('[data-msg]'); if (m) m.textContent = t || ''; };

  const visible = () => pairs.filter((p) => filter === 'all' || !p.reviewed);

  function row(p) {
    const clips = (p.clips || []).map((c) => `<button type="button" data-play="${esc(c.ear)}">Play (${esc(earLabel(c.ear))})</button>`).join(' ');
    const secs = Math.max(...(p.clips || []).map((c) => c.durationMs || 0), 0) / 1000;
    const others = (p.said?.others || []).map((o) => `<div class="vr-other">${esc(earLabel(o.ear))} heard: “${esc(o.text)}”</div>`).join('');
    const del = confirming === p.id
      ? '<button type="button" data-del-yes>Delete for good</button> <button type="button" data-del-no>Keep</button>'
      : '<button type="button" data-del>Delete</button>';
    return `<li class="vr-row" data-id="${esc(p.id)}" data-reviewed="${p.reviewed ? '1' : '0'}">
      <div class="vr-meta">${esc(fmtWhen(p.at))} · ${esc(secs.toFixed(1))} s${p.reviewed ? ' · reviewed' : ''}</div>
      <div class="vr-heard">${esc(saidLine(p))}</div>${others}
      <div class="vr-play">${clips}</div>
      <label class="vr-meant"><span>What was meant</span>
        <input type="text" data-meant maxlength="1000" value="${esc(p.meant || '')}" placeholder="type what they meant"></label>
      <div class="vr-acts">
        ${p.said?.text ? '<button type="button" data-right>It heard it right</button>' : ''}
        <button type="button" data-save>Save what was meant</button>
        ${del}
      </div>
    </li>`;
  }

  function render() {
    if (destroyed) return;
    q('[data-summary]').textContent = reviewSummary(pairs, { keepDays: keepDays() });
    for (const b of root.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    q('[data-export]').hidden = !(fs && fs.available && fs.available() && pairs.length);
    const v = visible();
    q('[data-list]').innerHTML = v.slice(0, shown).map(row).join('')
      || `<li class="vr-empty">${filter === 'todo' && pairs.length ? 'Nothing left to review.' : 'Nothing here.'}</li>`;
    q('[data-more]').hidden = v.length <= shown;
  }

  async function refresh() {
    try { pairs = await store.list({ personId }); }
    catch (err) { console.error('voice review: list', err); pairs = []; say('Could not read the recordings on this screen.'); }
    render();
  }

  function stopPlaying() { try { playing?.stop?.(); } catch { /* gone */ } playing = null; }

  async function doPlay(id, ear) {
    stopPlaying();
    const wav = await store.audio(id, ear).catch(() => null);
    if (!wav) { say('That recording’s sound is missing.'); return; }
    const player = play || defaultPlay;
    try { playing = player(wav); } catch (err) { console.error('voice review: play', err); say('Could not play it.'); }
  }

  async function setMeant(id, meant) {
    const p = pairs.find((x) => x.id === id);
    if (!p) return;
    const next = withMeant(p, meant, now());
    try {
      await store.update(id, { meant: next.meant, meantAt: next.meantAt, reviewed: true });
      Object.assign(p, { meant: next.meant, meantAt: next.meantAt, reviewed: true });
      say(next.meant ? 'Saved.' : 'Saved as reviewed, with nothing meant.');
    } catch (err) { console.error('voice review: save', err); say('Could not save that.'); }
    render();
  }

  async function doExport() {
    let dir = null;
    try { dir = await fs.pickFolder(); } catch { return; }       // cancelled is not an error
    say('Exporting…');
    try {
      const r = await exportPairs(dir, store, { personId });
      say(`Exported ${r.written.length} recording${r.written.length === 1 ? '' : 's'}${r.failed.length ? `; ${r.failed.length} could not be written` : ''}.`);
    } catch (err) { console.error('voice review: export', err); say('Could not export into that folder.'); }
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    const li = b.closest('[data-id]');
    const id = li?.dataset.id;
    if (b.dataset.filter) { filter = b.dataset.filter; shown = pageSize; confirming = null; render(); return; }
    if (b.hasAttribute('data-more')) { shown += pageSize; render(); return; }
    if (b.hasAttribute('data-export')) { doExport(); return; }
    if (!id) return;
    if (b.dataset.play) { doPlay(id, b.dataset.play); return; }
    if (b.hasAttribute('data-right')) { const p = pairs.find((x) => x.id === id); setMeant(id, p?.said?.text || ''); return; }
    if (b.hasAttribute('data-save')) { setMeant(id, li.querySelector('[data-meant]')?.value || ''); return; }
    if (b.hasAttribute('data-del')) { confirming = id; render(); return; }
    if (b.hasAttribute('data-del-no')) { confirming = null; render(); return; }
    if (b.hasAttribute('data-del-yes')) {
      confirming = null;
      stopPlaying();
      store.remove(id)
        .then((ok) => { if (ok) pairs = pairs.filter((x) => x.id !== id); say(ok ? 'Deleted.' : 'It was already gone.'); render(); })
        .catch((err) => { console.error('voice review: delete', err); say('Could not delete it.'); render(); });
    }
  }, { signal: ac.signal });

  render();
  const ready = refresh();

  return {
    ready,
    refresh,
    pairs: () => pairs.map((p) => ({ ...p })),
    destroy() { destroyed = true; stopPlaying(); ac.abort(); root.innerHTML = ''; },
  };
}

function defaultPlay(wav) {
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  const a = new Audio(url);
  const done = () => { try { URL.revokeObjectURL(url); } catch { /* gone */ } };
  a.addEventListener('ended', done, { once: true });
  a.play?.()?.catch?.(done);
  return { stop() { try { a.pause(); } catch { /* gone */ } done(); } };
}
