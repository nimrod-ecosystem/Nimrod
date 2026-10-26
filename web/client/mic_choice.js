// mic_choice.js - WHICH MICROPHONE THIS SCREEN HEARS WITH, chosen by name, with a level you can see (chat's notes CW/CX,
// 2026-10-26; row 2.128).
//
// Mike, 2026-10-26, after a call where the far end heard nothing (the Pi was using a USB speaker's empty mic input):
// "Switching mics has to be something easy and intuitive for the end user." Until now a call always opened the
// computer's DEFAULT microphone (mic_owner.js, no device), and the only way to change it was a terminal on the Pi.
//
// TWO THINGS, both on the screen itself:
//   * a row, Devices -> Microphone: this computer's microphones BY NAME (as speakers.js does for speakers: the browser's
//     device ids are salted per site and change; a name is what a person recognises), first choice "This computer's
//     own default", which needs nothing set up;
//   * "Test the microphones": every microphone with a live level bar beside it, so a person says something and SEES
//     which one hears them, and a big "Use this one" beside each. It closes by itself after TESTER_IDLE_MS, and
//     Close/Escape close it; nothing waits on anybody (CLAUDE.md: never a gate).
// Calls open the chosen one (modules/call.js); a named microphone that is unplugged is not an error - the default is
// used until it is back. Per module comes later (row 2.128).
//
// NAMES NEED PERMISSION: a browser hides microphone names until the page may use one. A screen started by the kiosk
// launcher has it (--use-fake-ui-for-media-stream); elsewhere the tester asks once, when somebody opens it.

export const MIC_KEY = 'micUse';
export const IN_PREFIX = 'in:';
// How long the tester stays open with nobody touching it: long enough to try three microphones, short enough that a
// tester left open does not keep every microphone on for long.
export const TESTER_IDLE_MS = 60 * 1000;

let mics = [];                 // [{ id, label }], the last list read
const watchers = new Set();

/** This computer's microphones, by name. Reads the list fresh (`list` is mic_owner.js list(), or the browser's). */
export async function refreshMics({ list = null, md = (typeof navigator !== 'undefined' ? navigator.mediaDevices : null) } = {}) {
  let got = [];
  try {
    got = list ? await list() : ((await md?.enumerateDevices?.()) || []).filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label || '' }));
  } catch { got = []; }
  mics = (got || []).filter((m) => m && m.id && m.id !== 'default' && m.id !== 'communications')
    .map((m) => ({ id: String(m.id), label: String(m.label || '') }));
  for (const f of [...watchers]) { try { f(mics); } catch { /* a watcher's problem */ } }
  return knownMics();
}
export const knownMics = () => mics.map((m) => ({ ...m }));
export const watchMics = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
export function setMicsForTest(list) { mics = (list || []).map((m) => ({ id: String(m.id), label: String(m.label) })); }

/** The device id a "Microphone" value means: a microphone by name, else null (the computer's default). PURE. */
export function micIdFor(value, list = mics) {
  const s = String(value || '');
  if (!s.startsWith(IN_PREFIX)) return null;
  const name = s.slice(IN_PREFIX.length).toLowerCase();
  const hit = (list || []).find((m) => m.label.toLowerCase() === name) || (list || []).find((m) => name && m.label.toLowerCase().includes(name));
  return hit ? hit.id : null;
}

/** The Devices row, with the microphones known now. Null when there are fewer than two (nothing to choose). */
export function micField(list = mics) {
  const named = (list || []).filter((m) => m.label);
  if (named.length < 2) return null;
  return {
    key: MIC_KEY, label: 'Microphone', kind: 'choice', level: 'standard', default: '',
    options: [{ value: '', label: 'This computer’s own default' }, ...named.map((m) => ({ value: `${IN_PREFIX}${m.label}`, label: m.label }))],
    note: 'What calls use to hear this room. "Test the microphones" shows which one hears you. A microphone unplugged '
      + 'later is not an error: the default is used until it is back.',
  };
}

/** A level from 0 to 1 from an analyser's time-domain samples (RMS, scaled so speech fills most of the bar). PURE. */
export function levelOf(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (const v of samples) { const x = (v - 128) / 128; sum += x * x; }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/**
 * "Test the microphones": a box over `host` listing every microphone with a live level and "Use this one". `open(id)`
 * returns a MediaStream for a device (mic_owner.js acquire, or getUserMedia); `close(id, stream)` lets it go. `onPick(
 * value)` is called with the Microphone row's value. Returns { el, close() }.
 */
export function openMicTester(host, { list = knownMics(), current = '', open, close: release = () => {}, onPick = () => {},
  AudioContextImpl = (typeof AudioContext !== 'undefined' ? AudioContext : null), setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = (h) => clearTimeout(h), raf = (f) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(f) : setTimeout(f, 50)),
  idleMs = TESTER_IDLE_MS } = {}) {
  const doc = host?.ownerDocument;
  if (!doc) return { el: null, close() {} };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = doc.createElement('div');
  el.dataset.micTester = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Test the microphones');
  el.style.cssText = 'position:fixed;inset:5vh 5vw;z-index:2147482000;overflow:auto;padding:16px 18px;border-radius:14px;'
    + 'background:var(--surface,#fff);color:var(--text,#222);border:2px solid var(--accent,#2b6cb0);box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:1.05rem';
  const named = list.filter((m) => m.label);
  el.innerHTML = `<h2 style="margin:0 0 6px">Which microphone hears you?</h2>`
    + `<p style="margin:0 0 12px">Say something. The bar beside the microphone that hears you moves. Then press “Use this one”.</p>`
    + (named.length ? named.map((m) => {
      const v = `${IN_PREFIX}${m.label}`;
      return `<div data-mic-row="${esc(m.id)}" style="display:grid;grid-template-columns:1fr minmax(120px,30%) auto;gap:10px;align-items:center;margin:8px 0">`
        + `<span>${esc(m.label)}${v === current ? ' <b>(in use)</b>' : ''}</span>`
        + `<span style="height:18px;border-radius:9px;background:var(--surface-alt,#eee);overflow:hidden"><span data-mic-level style="display:block;height:100%;width:0;background:var(--accent,#2b6cb0)"></span></span>`
        + `<button type="button" data-mic-use="${esc(v)}" style="min-height:48px;padding:6px 14px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer">Use this one</button></div>`;
    }).join('') : '<p>No microphones with names were found on this computer.</p>')
    + `<div style="display:flex;gap:10px;margin-top:12px"><button type="button" data-mic-use="" style="min-height:48px;padding:6px 14px;border-radius:10px;font:inherit;cursor:pointer">Use this computer’s own default</button>`
    + `<button type="button" data-mic-close style="min-height:48px;padding:6px 14px;border-radius:10px;font:inherit;cursor:pointer">Close</button></div>`;
  doc.body.append(el);
  const live = [];             // { id, stream, analyser, buf, bar }
  let ctx = null, done = false, timer = null;
  try { ctx = AudioContextImpl ? new AudioContextImpl() : null; } catch { ctx = null; }
  // A context made without a press can start suspended, and then every bar reads silence (seen on the bench Pi,
  // 2026-10-26, in a browser without the kiosk's autoplay flag). Resuming is harmless when it is already running.
  try { Promise.resolve(ctx?.resume?.()).catch(() => {}); } catch { /* it plays or it does not */ }
  (async () => {
    for (const m of named) {
      if (done) return;
      let stream = null;
      try { stream = await open?.(m.id); } catch { stream = null; }
      if (!stream) continue;
      if (done) { try { release(m.id, stream); } catch { /* gone */ } return; }
      const entry = { id: m.id, stream, bar: el.querySelector(`[data-mic-row="${CSS.escape(m.id)}"] [data-mic-level]`) };
      try {
        if (ctx) {
          const src = ctx.createMediaStreamSource(stream);
          entry.analyser = ctx.createAnalyser();
          entry.analyser.fftSize = 512;
          entry.buf = new Uint8Array(entry.analyser.fftSize);
          src.connect(entry.analyser);
        }
      } catch { /* a bar that does not move; the choice still works */ }
      live.push(entry);
    }
  })();
  const paint = () => {
    if (done) return;
    for (const e of live) {
      if (!e.analyser || !e.bar) continue;
      try { e.analyser.getByteTimeDomainData(e.buf); e.bar.style.width = `${Math.round(levelOf(e.buf) * 100)}%`; } catch { /* stopped */ }
    }
    raf(paint);
  };
  raf(paint);
  const arm = () => { if (timer != null) clearTimer(timer); timer = setTimer(() => close(), idleMs); };
  function close() {
    if (done) return;
    done = true;
    if (timer != null) clearTimer(timer);
    for (const e of live) { try { release(e.id, e.stream); } catch { /* gone */ } }
    live.length = 0;
    try { ctx?.close?.(); } catch { /* closed */ }
    doc.removeEventListener('keydown', onKey, true);
    try { el.remove(); } catch { /* gone */ }
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } else arm(); }
  el.addEventListener('click', (e) => {
    arm();
    const use = e.target.closest?.('[data-mic-use]');
    if (use) { try { onPick(use.getAttribute('data-mic-use') || ''); } catch { /* the row's problem */ } close(); return; }
    if (e.target.closest?.('[data-mic-close]')) close();
  });
  doc.addEventListener('keydown', onKey, true);
  arm();
  return { el, close, live: () => live.length };
}
