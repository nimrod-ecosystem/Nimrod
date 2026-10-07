// voice_id.js — WHO IS TALKING, ONCE, FOR EVERY AI AND GAME ON THE SCREEN (row 2.56).
//
// Mike, 2026-10-07: *"I would want things like that to work across any AI across the site. So anyone could set up
// multiple AI for different tasks/games and they would all recognize any users that opt in by their voice."*
//
// The recognising happens in the SPEECH PROGRAM (web/speech_service/speakers.py), because that is where the sound
// is: every transcript it sends carries `speaker: { who, person, sure, maybe }`. This file is the screen's half:
//
//   * the person's two settings (VOICE_ID_FIELDS), sent to the speech program when the recogniser connects;
//   * `speakerFrom`, which turns the program's answer into the one shape everything here reads - subtitles.js reads
//     { name, confidence }, the command path and the games read { who, person, sure };
//   * SETTING UP A VOICE: `createEnrolment` (the steps) and `mountEnrolment` (the panel: a sentence to read aloud).
//
// *** WHAT IS NEVER TRUE HERE ***
//   * A VOICEPRINT NEVER REACHES THIS PAGE. The speech program keeps the numbers on its own computer and sends a
//     screen only names, dates and counts; so nothing here can send one to Nimrod's server, and the server refuses
//     one anyway (web/server/storage_line.py rule 5).
//   * IT IS NEVER A LOCK OR A PASSWORD. Nothing on the site may be allowed or refused because of `who`: voices can
//     be imitated, and they change with illness. It names; it does not admit.
//   * WORDS ARE NEVER DROPPED FOR IT. `who` null is "Unknown" and the words still go everywhere they went before.
//   * ONLY PEOPLE WHO SET UP THEIR VOICE ARE EVER NAMED. Setting up is the opt-in, one person at a time.
//
// ON BY DEFAULT for the screen (`voiceIdOn`), argued: it does nothing at all until somebody sets up their voice on
// that computer (the speech program does not even load its model), and the person whose screen it is chose to have
// people named (row 2.42: subtitles "names people who set themselves up"). Against: a screen's owner may not want
// visitors' voices compared at all, even in memory and let go. So it is a switch on their row.

// The "how sure" scale's anchors. speech_service/speakers.py SURE_NAMED / SURE_MAYBE, and subtitles.js's
// sureAt / maybeAt: test_speakers.py reads all three files and holds them equal.
export const SURE_NAMED = 0.8;
export const SURE_MAYBE = 0.4;

export const VOICE_ID_DEFAULTS = Object.freeze({
  on: true,
  // How sure the speech program must be before it NAMES somebody (for the AIs and games; subtitles has its own
  // "how sure before a name is shown plainly"). 0.8 = the program's own match level (speakers.py SPEAKER_MATCH,
  // argued there: a wrong name is worse than "Unsure", and the words show either way).
  sureAt: SURE_NAMED,
  // Setting up stops by itself when nothing is heard for this long - never a panel only a press can close.
  // 60 s: long enough to find reading glasses, short enough that a forgotten panel does not sit on the screen.
  idleMs: 60000,
  // How long "Done" (or what went wrong) stays before the panel goes by itself.
  doneMs: 8000,
});

export const VOICE_ID_FIELDS = [
  { key: 'voiceIdOn', label: 'Say who is talking', kind: 'toggle', default: VOICE_ID_DEFAULTS.on,
    level: 'standard',
    note: 'Names people who set up their voice on this computer, on what they say (subtitles, games, the AI '
        + 'helpers). Everybody else is "Unknown", and their words still show. It never unlocks anything.' },
  { key: 'voiceIdSureAt', label: 'Who is talking: how sure before it names somebody', kind: 'choice',
    default: VOICE_ID_DEFAULTS.sureAt, level: 'advanced',
    options: [
      { value: 0.6, label: 'Fairly sure (names people more often, sometimes wrongly)' },
      { value: 0.8, label: 'Sure' },
      { value: 0.9, label: 'Very sure (more often "Unknown")' },
    ] },
];

/** A settings row -> { on, sureAt }. Each unset or broken key is its default. */
export function voiceIdOptionsFrom(values = {}) {
  const v = values || {};
  const n = Number(v.voiceIdSureAt);
  const okNum = v.voiceIdSureAt !== null && v.voiceIdSureAt !== '' && typeof v.voiceIdSureAt !== 'boolean'
    && Number.isFinite(n) && n > 0 && n <= 1.01;
  return {
    on: typeof v.voiceIdOn === 'boolean' ? v.voiceIdOn : VOICE_ID_DEFAULTS.on,
    sureAt: okNum ? n : VOICE_ID_DEFAULTS.sureAt,
  };
}

/**
 * The speech program's `speaker` -> the shape the screen reads, or null (nobody said who: "Unknown").
 *   who, person   named (the program was sure enough by the person's setting); else null
 *   sure          0..1 on the shared scale, or null when nothing was compared (too short, nobody set up)
 *   maybe         the closest voice when it was not sure enough
 *   name, confidence   what subtitles.js's speakerLabel reads: the named person, else the maybe, with `sure`
 * Pure; a broken answer is null, never a guess.
 */
export function speakerFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const s = Number(raw.sure);
  const sure = raw.sure !== null && raw.sure !== undefined && typeof raw.sure !== 'boolean' && Number.isFinite(s)
    ? Math.max(0, Math.min(1, s)) : null;
  const who = str(raw.who);
  const maybe = who ? null : str(raw.maybe);
  const out = { who, person: who ? str(raw.person) : null, sure, maybe, via: 'voice', engine: str(raw.engine) };
  if (typeof raw.why === 'string') out.why = raw.why;
  const name = who || maybe;
  if (name) { out.name = name; out.confidence = sure; }
  return out;
}

/** What a game or an AI gets with a transcript: who, which person, how sure. Pure. */
export function speakerDetail(sp) {
  if (!sp || typeof sp !== 'object') return null;
  return { who: sp.who || null, person: sp.person || null, sure: Number.isFinite(sp.sure) ? sp.sure : null,
           ...(sp.maybe ? { maybe: sp.maybe } : {}) };
}

// ---------------------------------------------------------------------------------------
// SETTING UP A VOICE
// ---------------------------------------------------------------------------------------
// Five sentences of everyday words with a spread of sounds, ~4 seconds each read aloud: about 20 seconds in all,
// over the speech program's minimum (3 sentences, 10 seconds - speakers.py ENROL_MIN_*). Written for this project.
export const ENROL_SENTENCES = Object.freeze([
  'Good morning. The kettle is on, and the toast is nearly ready.',
  'Seven small boats were sailing past the lighthouse in the evening.',
  'Please bring my blue jumper and the photos from the kitchen table.',
  'We watched the geese fly over the field before the rain came.',
  'Thank you for visiting. I will see you again on Thursday at two.',
]);

/**
 * The steps of setting up one person's voice, with the recogniser's voice-id seam (speech_engines.js
 * `rec.voiceId`): { available(), enrol(person, name), done(person), cancel(), onEvent(fn) }.
 *
 * state: 'idle' -> 'reading' (sentence `index`) -> 'saving' -> 'done' | 'failed' | 'cancelled' | 'unavailable'
 * Each thing heard (enrol-heard) moves to the next sentence; one too short to use says so and stays. After the
 * last, it asks the program to make the voiceprint. NOTHING HEARD FOR `idleMs`: it cancels itself.
 */
export function createEnrolment({
  voice, person, name = '', sentences = ENROL_SENTENCES, onChange = null,
  idleMs = VOICE_ID_DEFAULTS.idleMs,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
} = {}) {
  let st = { state: 'idle', index: 0, total: sentences.length, sentence: '', clips: 0, seconds: 0, note: '', error: '' };
  let idle = null;
  let off = null;
  const tell = () => { try { onChange?.({ ...st }); } catch (err) { console.error('voice id: onChange', err); } };
  const set = (patch) => { st = { ...st, ...patch, sentence: sentences[Math.min(patch.index ?? st.index, sentences.length - 1)] || '' }; tell(); };
  const stopIdle = () => { if (idle !== null) { try { clearTimer(idle); } catch { /* gone */ } idle = null; } };
  const armIdle = () => {
    stopIdle();
    if (idleMs > 0) {
      try { idle = setTimer(() => { idle = null; cancel('Nothing was heard for a while, so setting up stopped. Nothing was saved.'); }, idleMs); }
      catch { idle = null; }
    }
  };
  const finish = (patch) => { stopIdle(); try { off?.(); } catch { /* gone */ } off = null; set(patch); };
  function onEvent(m) {
    if (!m || m.person !== person || ['done', 'failed', 'cancelled', 'unavailable'].includes(st.state)) return;
    if (m.kind === 'enrol-heard') {
      armIdle();
      if (m.short) { set({ note: 'That was a bit short. Please read the whole sentence.', clips: m.clips || 0, seconds: m.seconds || 0 }); return; }
      const next = st.index + 1;
      if (next >= sentences.length) {
        set({ state: 'saving', index: sentences.length - 1, clips: m.clips || 0, seconds: m.seconds || 0, note: '' });
        try { voice.done(person); } catch (err) { finish({ state: 'failed', error: String(err?.message || err) }); }
        return;
      }
      set({ index: next, clips: m.clips || 0, seconds: m.seconds || 0, note: '' });
    } else if (m.kind === 'enrolled') {
      finish({ state: 'done', clips: m.clips || st.clips, seconds: m.seconds || st.seconds, note: '' });
    } else if (m.kind === 'enrol-failed') {
      finish({ state: 'failed', error: String(m.error || 'It could not be set up.') });
    }
  }
  function start() {
    if (st.state !== 'idle') return { ...st };
    let ok = false;
    try { ok = !!voice?.available?.(); } catch { ok = false; }
    if (!ok) { set({ state: 'unavailable', error: 'This computer cannot recognise voices yet: its speech program has no voice engine, or it is not running.' }); return { ...st }; }
    off = voice.onEvent(onEvent);
    try { voice.enrol(person, name); } catch (err) { finish({ state: 'failed', error: String(err?.message || err) }); return { ...st }; }
    set({ state: 'reading', index: 0 });
    armIdle();
    return { ...st };
  }
  function cancel(why = 'Stopped. Nothing was saved.') {
    if (['done', 'failed', 'cancelled', 'unavailable'].includes(st.state)) return { ...st };
    try { voice?.cancel?.(); } catch { /* gone */ }
    finish({ state: 'cancelled', note: why });
    return { ...st };
  }
  return { start, cancel, state: () => ({ ...st }), destroy() { cancel(); } };
}

const CSS = `
.vid-panel{position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);z-index:60;max-width:min(92vw,60rem);
  box-sizing:border-box;padding:1.2rem 1.6rem;border-radius:14px;background:var(--letterbox,rgba(0,0,0,.88));
  color:var(--on-dark,#fff);font-size:clamp(20px,3.4vmin,40px);line-height:1.35;box-shadow:0 6px 30px rgba(0,0,0,.4)}
.vid-step{font-size:.6em;opacity:.85;margin:0 0 .4em}
.vid-say{margin:0 0 .5em;font-weight:600}
.vid-note{font-size:.6em;margin:0 0 .6em;min-height:1.2em}
.vid-panel button{font:inherit;font-size:.6em;padding:.4em 1em;border-radius:10px;border:2px solid currentColor;
  background:transparent;color:inherit;cursor:pointer}
.vid-panel button:focus-visible{outline:3px solid currentColor;outline-offset:3px}
`;

/** What the panel says for a state. Pure (the suite reads it). */
export function enrolmentText(s, who = '') {
  const name = who ? `${who}'s` : 'your';
  switch (s?.state) {
    case 'reading': return { step: `Setting up ${name} voice on this computer - sentence ${s.index + 1} of ${s.total}. Read it aloud:`,
      say: s.sentence, note: s.note || '' };
    case 'saving': return { step: 'Nearly done', say: 'Making the voiceprint on this computer...', note: '' };
    case 'done': return { step: 'Done', say: `This computer now knows ${name} voice.`,
      note: 'It is kept only on this computer. "Forget my voice" removes it.' };
    case 'failed': return { step: 'Not set up', say: s.error || 'It could not be set up.', note: 'Nothing was saved.' };
    case 'cancelled': return { step: 'Stopped', say: s.note || 'Nothing was saved.', note: '' };
    case 'unavailable': return { step: 'Not available here', say: s.error || '', note: '' };
    default: return { step: '', say: '', note: '' };
  }
}

/**
 * The panel. Not modal: it covers no control, the rest of the screen works, and it always goes by itself -
 * after `doneMs` once finished, and the enrolment cancels itself after `idleMs` of silence.
 */
export function mountEnrolment(host, enrolment, {
  who = '', doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  doneMs = VOICE_ID_DEFAULTS.doneMs,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  onClosed = null,
} = {}) {
  if (!host || !doc) throw new Error('mountEnrolment: a host element is required');
  if (!doc.getElementById('voice-id-style')) {
    const style = doc.createElement('style');
    style.id = 'voice-id-style';
    style.textContent = CSS;
    (doc.head || doc.documentElement).append(style);
  }
  const el = doc.createElement('div');
  el.className = 'vid-panel';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.dataset.voiceIdPanel = '';
  const step = doc.createElement('p'); step.className = 'vid-step';
  const say = doc.createElement('p'); say.className = 'vid-say';
  const note = doc.createElement('p'); note.className = 'vid-note';
  const stop = doc.createElement('button'); stop.type = 'button';
  el.append(step, say, note, stop);
  host.append(el);
  let closeTimer = null;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (closeTimer !== null) { try { clearTimer(closeTimer); } catch { /* gone */ } closeTimer = null; }
    el.remove();
    try { onClosed?.(); } catch (err) { console.error('voice id: onClosed', err); }
  }
  function draw(s) {
    const t = enrolmentText(s, who);
    step.textContent = t.step;
    say.textContent = t.say;
    note.textContent = t.note;
    el.dataset.state = s?.state || 'idle';
    const over = ['done', 'failed', 'cancelled', 'unavailable'].includes(s?.state);
    stop.textContent = over ? 'Close' : 'Stop';
    if (over && closeTimer === null && doneMs > 0) {
      try { closeTimer = setTimer(() => { closeTimer = null; close(); }, doneMs); } catch { closeTimer = null; }
    }
  }
  stop.addEventListener('click', () => {
    const s = enrolment.state();
    if (['done', 'failed', 'cancelled', 'unavailable'].includes(s.state)) close();
    else enrolment.cancel();
  });
  draw(enrolment.state());
  return { draw, close, element: el, isOpen: () => !closed };
}
