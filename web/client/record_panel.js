// record_panel.js — PRESSING RECORD. The surface for everything the last few files built.
//
// The chain existed and nothing could reach it: an arbiter that can hold two microphones, a
// recorder that pairs them, a sink that writes into a folder somebody picked. All of it
// unreachable without a button. This is the button.
//
// It lives under Devices, beneath the microphone chooser, and that placement is deliberate
// rather than convenient: **the first thing anybody should do after choosing microphones is
// record ten seconds and find out whether it worked.** A setup screen that cannot be tested from
// itself sends people away to discover the problem somewhere less forgiving.
//
// ---------------------------------------------------------------------------------------
// WHICH MICROPHONE IS WHICH — a default, not a guess dressed as a fact
// ---------------------------------------------------------------------------------------
//
// A paired recording needs to know which channel is the CLOSE one (`label` — clear enough to
// know what was said) and which is the FAR one (`input` — what the daily device actually hears).
// Getting them the wrong way round would silently invert the corpus.
//
// The default is the person's own preference order: the microphone they put FIRST is the one
// they think sounds best, which is almost always the close one. That is a reasonable default and
// it is not a certainty, so it is shown in words — *"Phone by the pillow → what was said"* — and
// it can be swapped. A default nobody can see is a guess.
//
// ---------------------------------------------------------------------------------------
// ONE MICROPHONE IS NOT AN ERROR
// ---------------------------------------------------------------------------------------
//
// Somebody with a single microphone gets a single-channel recording, labelled `label`, and a
// line saying the pair is not available. That is a smaller thing and an honest one — refusing to
// record at all because the second microphone is missing would be the worse failure, and it is
// the same reasoning as the fallback ladder.

import { sessionName } from './fs_sink.js';

export const RECORD_KEY = 'recording';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Which device plays which part.
 *
 * Pure and exported, because getting it backwards inverts a whole corpus and that is worth being
 * able to assert directly rather than by reading a panel.
 *
 * `swap` is the person saying the default was wrong for their room.
 */
export function assignRoles(preferred, available, { swap = false } = {}) {
  const have = new Map((available || []).map((d) => [d.id, d]));
  const order = (preferred || []).filter((id) => have.has(id));
  // Nothing chosen yet: fall back to whatever is plugged in, in the order the machine gave them.
  const ids = order.length ? order : (available || []).map((d) => d.id);
  const pick = swap ? [ids[1], ids[0]] : ids;
  const roles = [];
  if (pick[0]) roles.push({ role: 'label', deviceId: pick[0], label: have.get(pick[0])?.label || '' });
  if (pick[1]) roles.push({ role: 'input', deviceId: pick[1], label: have.get(pick[1])?.label || '' });
  return roles;
}

// Said in words rather than left as an arrow between two device names, because "label" and
// "input" mean nothing to somebody setting up a bedside screen.
export function describeRoles(roles) {
  if (!roles.length) return 'No microphone is connected.';
  const bits = roles.map((r) => `${r.label || 'a microphone'} → ${r.role === 'label' ? 'what was said' : 'what it sounds like from further away'}`);
  if (roles.length === 1) return `${bits[0]}. Only one microphone, so there is nothing to compare it with.`;
  return bits.join(', and ');
}

export function mountRecordPanel(root, {
  micOwner,
  // Injected so the panel is driven with no microphone, no folder and no clock.
  makeRecorder,                       // ({ producer, keepDays }) => recorder
  fs,                                 // { available, pickFolder, saveSession, rememberFolder, recallFolder, listSessions, deleteSession, ensurePermission }
  settings = () => ({}),
  save = async () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
} = {}) {
  if (!root) throw new Error('mountRecordPanel: a root element is required');
  if (!micOwner || !makeRecorder || !fs) throw new Error('mountRecordPanel: micOwner, makeRecorder and fs are required');

  let devices = [];
  let folder = null;
  let needsPermission = false;
  let rec = null;
  let startedAt = 0;
  let tick = null;
  let sessions = [];
  let lastSaved = null;
  let destroyed = false;

  const cfg = () => ({ swapRoles: false, keepDays: 30, producer: 'human', ...(settings() || {}) });
  const preferred = () => (settings() || {}).microphonePreferred || [];
  const roles = () => assignRoles(preferred(), devices, { swap: cfg().swapRoles });

  root.innerHTML = `
    <div class="rp">
      <h3>Record a session</h3>
      <p class="rp-lede">Two microphones at once: the near one is clear enough to know what was
        said, the far one is what the everyday screen actually hears. Recording both together is
        what makes the far one usable later.</p>

      <p class="rp-folder" data-folder></p>
      <button type="button" data-pick>Choose where to save recordings</button>
      <button type="button" data-grant hidden>Use the remembered folder again</button>

      <p class="rp-roles" data-roles></p>
      <button type="button" data-swap hidden>Swap which is which</button>

      <div class="rp-go">
        <button type="button" class="rp-rec" data-rec>Record</button>
        <span class="rp-elapsed" data-elapsed></span>
      </div>

      <div class="rp-mark" data-markrow hidden>
        <input type="text" data-marktext placeholder="what was said, or the word being tried">
        <button type="button" data-mark>Mark this moment</button>
      </div>
      <p class="rp-marks" data-marks></p>

      <p class="rp-said" data-said role="status" aria-live="polite"></p>
      <div class="rp-list" data-list></div>
    </div>`;

  const el = (s) => root.querySelector(s);
  const say = (t) => { el('[data-said]').textContent = t || ''; };

  function render() {
    if (destroyed) return;
    const running = !!rec?.isRunning?.();
    const rs = roles();

    el('[data-folder]').textContent = folder
      ? `Saving into “${folder.name || 'the folder you chose'}”.`
      : (fs.available() ? 'No folder chosen yet — nothing can be saved until there is one.'
                        : 'This browser cannot write to a folder you choose, so recordings cannot be saved here.');
    el('[data-pick]').hidden = !fs.available() || running;
    el('[data-pick]').textContent = folder ? 'Choose a different folder' : 'Choose where to save recordings';
    el('[data-grant]').hidden = !needsPermission || running;

    el('[data-roles]').textContent = describeRoles(rs);
    el('[data-swap]').hidden = rs.length < 2 || running;

    const btn = el('[data-rec]');
    btn.textContent = running ? 'Stop' : 'Record';
    btn.dataset.on = running ? '1' : '';
    // NO FOLDER MEANS NO RECORDING, and the button says so rather than recording into nothing
    // and losing it at the end — which is the version of this that wastes somebody's session.
    btn.disabled = !running && (!folder || !rs.length);

    el('[data-markrow]').hidden = !running;
    const marks = rec?.marks?.() || [];
    el('[data-marks]').textContent = marks.length
      ? `Marked: ${marks.map((m) => m.label || '(unnamed)').join(', ')}`
      : '';

    el('[data-list]').innerHTML = sessions.length
      ? `<p class="rp-note">Saved recordings:</p>` + sessions.map((s) => `
          <div class="rp-row" data-folder-name="${esc(s.folder)}">
            <span>${esc(s.folder)}${s.incomplete ? ' — incomplete' : ''}</span>
            <button type="button" data-del="${esc(s.folder)}">Delete</button>
          </div>`).join('')
      : '';
  }

  function showElapsed() {
    if (!rec?.isRunning?.()) { el('[data-elapsed]').textContent = ''; return; }
    const s = Math.floor((now() - startedAt) / 1000);
    el('[data-elapsed]').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  async function refreshSessions() {
    sessions = folder ? await fs.listSessions(folder).catch(() => []) : [];
    render();
  }

  async function refresh() {
    if (destroyed) return;
    devices = await micOwner.list().catch(() => []);
    if (!folder) {
      const back = await fs.recallFolder().catch(() => ({ handle: null, permission: 'unknown' }));
      if (back.handle && back.permission === 'granted') folder = back.handle;
      else if (back.handle) needsPermission = true;
    }
    await refreshSessions();
    render();
    return this;
  }

  async function startRecording() {
    if (!folder) { say('Choose a folder first — otherwise there is nowhere to put it.'); return; }
    const rs = roles();
    if (!rs.length) { say('No microphone is connected.'); return; }
    const c = cfg();
    rec = makeRecorder({ producer: c.producer, keepDays: c.keepDays });
    try {
      await rec.start(rs);
    } catch (err) {
      // A refused microphone is the likely failure and it must not look like a recording.
      console.error('record: start', err);
      rec = null;
      say('Could not start recording — the microphone was refused or is in use.');
      render();
      return;
    }
    startedAt = now();
    say(rs.length > 1 ? 'Recording both microphones.' : 'Recording one microphone.');
    tick = setTimer(showElapsed, 500);
    render();
  }

  async function stopRecording() {
    if (!rec) return;
    if (tick != null) { clearTimer(tick); tick = null; }
    const out = rec.stop();
    rec = null;
    el('[data-elapsed]').textContent = '';
    render();
    if (!out) { say('Nothing was recorded.'); return; }
    try {
      lastSaved = await fs.saveSession(folder, out);
      say(`Saved ${lastSaved.files.length} files into ${lastSaved.folder}.`);
    } catch (err) {
      // *** THE RECORDING IS STILL IN MEMORY AND SHOULD NOT BE DISCARDED SILENTLY. *** Somebody
      // just spent a session on it; losing it because a write failed, without saying so, is the
      // worst outcome this panel can produce.
      console.error('record: save', err);
      say('The recording could not be saved — the folder may no longer be available. '
        + 'Do not close this page: choose the folder again and press Record→Stop is not needed; '
        + 'press "Save again".');
      showRetry(out);
      return;
    }
    await refreshSessions();
  }

  // A retry that keeps the audio rather than asking somebody to record it again.
  function showRetry(out) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Save again';
    btn.addEventListener('click', async () => {
      try {
        lastSaved = await fs.saveSession(folder, out);
        say(`Saved into ${lastSaved.folder}.`);
        btn.remove();
        await refreshSessions();
      } catch { say('Still could not save. Choose a folder again.'); }
    });
    el('[data-said]').after(btn);
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.hasAttribute('data-pick')) {
      try {
        folder = await fs.pickFolder();
        needsPermission = false;
        await fs.rememberFolder(folder);
        say('');
        await refreshSessions();
      } catch { /* the picker was cancelled, which is not an error */ }
      return render();
    }
    if (t.hasAttribute('data-grant')) {
      const back = await fs.recallFolder();
      // From a click, so the browser is allowed to prompt.
      if (back.handle && await fs.ensurePermission(back.handle) === 'granted') {
        folder = back.handle; needsPermission = false;
        await refreshSessions();
      } else say('That folder is no longer available — choose it again.');
      return render();
    }
    if (t.hasAttribute('data-swap')) {
      await save({ swapRoles: !cfg().swapRoles });
      return render();
    }
    if (t.hasAttribute('data-rec')) {
      return rec?.isRunning?.() ? stopRecording() : startRecording();
    }
    if (t.hasAttribute('data-mark')) {
      const input = el('[data-marktext]');
      rec?.mark(input.value.trim());
      input.value = '';
      return render();
    }
    if (t.dataset.del) {
      await fs.deleteSession(folder, t.dataset.del);
      return refreshSessions();
    }
    return undefined;
  });

  render();

  return {
    refresh,
    render,
    roles,
    isRecording: () => !!rec?.isRunning?.(),
    lastSaved: () => (lastSaved ? { ...lastSaved } : null),
    destroy() {
      destroyed = true;
      if (tick != null) { clearTimer(tick); tick = null; }
      try { rec?.stop?.(); } catch { /* nothing to stop */ }
      rec = null;
      root.innerHTML = '';
    },
  };
}
