// call_notice.js — a call arriving at a screen that has no Call panel on it.
//
// *** THE GAP (2026-10-02). *** The caller page (call.html, 2d87fe7) rings every screen of a person and the
// first to claim answers (fd3f880). But only a CALL PANEL ever listened for a ring, so a screen showing photos
// and a clock stayed silent, and the caller heard "No answer" after 135 s. That was the old Cici design's
// first lesson too: the call overrode the clock quadrant, because being able to call her is the point.
//
// So the screen itself listens (call_transport.js `onRing`), and when a call rings with NO Call panel to ring
// for it, this shows a notice over the panels: who is calling, video or audio, and Decline / Answer.
//
// WHAT IT DOES, AND THE GUESSES IN IT (on Mike's list, 2026-10-02):
//   * NO AUTO-ANSWER. A Call panel counts down and connects (call.js's header records why, for a screen
//     somebody set up to take calls). A notice is a screen nobody set up for calls at all, so nothing opens
//     until somebody presses Answer - and then only after the claim is won, exactly as call.js does.
//   * IT RINGS FOR AS LONG AS THE CALLER WAITS (`NOTICE_RING_MS`), then goes by itself: it is never a gate
//     only an input can leave. The caller's own give-up normally ends it first (its `bye`); this is the
//     backstop for a caller who vanished without one.
//   * IT GOES THE MOMENT ANOTHER SCREEN TAKES THE CALL (or refuses it first): the transport is told
//     'elsewhere' by the server, and the notice says "Handled on another screen." for a moment.
//   * A SCREEN WITH A CALL PANEL IS UNCHANGED: the panel rings, and this does nothing (the ring event says
//     `panel: true`). One ring per screen, never two.
//   * A SCREEN SETTING TURNS IT OFF: "Calls when there's no Call panel: show a notice / don't ring here".
//
// *** DECLINE COMES FIRST, AND THE SCAN STARTS ON NOTHING. *** A switch, the keyboard and a scan all walk
// the same two stops: Decline, then Answer. Nothing is lit when the notice appears, so a stray first press -
// a `select` from a hand that was already resting on the switch - does nothing at all; the first `next` (or
// `prev`) lights Decline. Argued against the alternative, a neutral "Not now" stop first that only hides the
// notice here: it costs every switch user a third stop on every call, and a hidden notice still leaves the
// caller ringing for two minutes into a screen that will never answer. A stray press that DECLINES at least
// tells the caller at once, and they can ring again. `back` declines too (the Call panel's `back` is its hang
// up). Answer always takes two deliberate presses at least: light it, then select it.
//
// Every number here is argued where it is declared; none of them is a person's setting except the mode.

import { CALLER_GIVE_UP_MS } from './call_page.js';
import { CALL_ANSWER_TOPIC, CALL_DECLINE_TOPIC } from './actions.js';

export const CALL_NOTICE_KEY = 'callNotice';
export const CALL_NOTICE_MODES = Object.freeze(['notice', 'off']);

/** The screen-level setting (kiosk.js puts it on the screen's row). */
export const CALL_NOTICE_FIELD = Object.freeze({
  key: CALL_NOTICE_KEY,
  label: 'Calls when there’s no Call panel',
  kind: 'choice',
  // `standard`, not `essential`: it is set once by whoever sets the screen up, and the essentials are the
  // legibility and way-out rows. Not `advanced`: "this screen should not ring" is an ordinary want.
  level: 'standard',
  default: 'notice',
  options: [
    { value: 'notice', label: 'Show a notice to answer or decline' },
    { value: 'off', label: 'Don’t ring here' },
  ],
  note: 'A screen with a Call panel on it rings in the panel either way. The notice never answers by '
      + 'itself: somebody has to press Answer.',
});

/** The mode a screen's row asks for. Anything but 'off' is the default, 'notice'. */
export function callNoticeModeOf(row) {
  return row && row[CALL_NOTICE_KEY] === 'off' ? 'off' : 'notice';
}

// HOW LONG THE NOTICE RINGS: the caller page's own wait (call_page.js CALLER_GIVE_UP_MS), imported rather
// than restated. Argued: a shorter ring here would vanish while the caller still hears ringing, and the call
// could then never be answered on this screen; a longer one would ring for a caller who has already gone.
// The caller's clock starts before the offer leaves, so its give-up (a `bye`) normally lands first, and this
// timer only fires for a caller who disappeared without saying so. Not a setting: it is the caller's number.
export const NOTICE_RING_MS = CALLER_GIVE_UP_MS;

// How long a short line ("Handled on another screen.") stays after the notice goes: the same 8 s the Call
// panel shows its own ending messages for (call.js `end`), so a call ends the same way with or without one.
export const NOTICE_NOTE_MS = 8000;

// The two stops, in scan order. Decline FIRST - see the header.
export const NOTICE_STOPS = Object.freeze(['decline', 'answer']);

const nameOf = (from) => {
  const n = from && typeof from.name === 'string' ? from.name.trim() : '';
  return n || 'Someone';
};

/** The words the notice shows. Pure. */
export function noticeText(from) {
  const name = nameOf(from);
  return {
    who: `${name} is calling`,
    kind: from && from.video ? 'Video call' : 'Audio call',
    announce: `${from && from.video ? 'Video call' : 'Call'} from ${name}.`,
  };
}

/**
 * The notice. `transport` is the screen's call transport (it needs `onRing`, `claim`, `hangup`).
 *
 *   host       the element it draws into (the kiosk's root box)
 *   bus        the screen's bus: "answer" / "decline" said or switched arrive on it (actions.js topics)
 *   mode       () => 'notice' | 'off', read at every ring
 *   openCall   async (from, { ringStartedAt }) => true when the call was handed to something that hosts it
 *              (kiosk.js mounts the Call module over the panels). false: nothing could host it - the call is
 *              hung up as failed rather than left answered with nobody on it.
 *   output     the output bus (or a function returning it): the ring is announced once through `alert`,
 *              so whether it is spoken, shown or a tone is the person's own routing
 *   holdScan   (on) => void: the screen gives its switch scan to the notice while it shows
 *   zIndex     the notice's depth (kiosk.js passes one above its menu)
 */
export function createCallNotice({
  transport,
  host,
  bus = null,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  mode = () => 'notice',
  openCall = null,
  output = null,
  holdScan = null,
  zIndex = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!transport || typeof transport.onRing !== 'function') throw new Error('createCallNotice: a call transport with onRing is required');
  if (!host || !doc) throw new Error('createCallNotice: a host element is required');

  let phase = 'idle';            // idle | ringing | answering
  let who = null;
  let ringAt = null;
  let seq = 0;                   // which ring this is: an answer that outlives its ring opens nothing
  let lit = -1;                  // which stop the scan is on; -1 = none (a stray first press does nothing)
  let ringT = null;
  let noteT = null;
  let held = false;
  const offs = [];

  // ---- the elements: the notice, and the short line it leaves behind -------------------------------
  const el = doc.createElement('div');
  el.className = 'k-callnote';
  el.dataset.callNotice = '';
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Incoming call');
  // Theme tokens only (no colour of its own), centred over the panels, never under the menu.
  el.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
    + `${zIndex != null ? `z-index:${zIndex};` : ''}min-width:min(86%,360px);max-width:min(92%,560px);`
    + 'box-sizing:border-box;padding:clamp(14px,3vmin,28px);border-radius:16px;text-align:center;'
    + 'background:var(--surface);color:var(--text);border:3px solid var(--focus);'
    + 'font:600 clamp(16px,2.6vmin,28px)/1.3 system-ui,-apple-system,Segoe UI,sans-serif';
  const whoEl = doc.createElement('div');
  whoEl.dataset.cnWho = '';
  whoEl.setAttribute('aria-live', 'assertive');
  whoEl.style.cssText = 'font-size:1.25em;margin-bottom:.2em';
  const kindEl = doc.createElement('div');
  kindEl.dataset.cnKind = '';
  kindEl.style.cssText = 'font-weight:400;color:var(--text-muted);margin-bottom:1em';
  const btns = doc.createElement('div');
  btns.style.cssText = 'display:flex;gap:1em;justify-content:center;flex-wrap:wrap';
  const mkBtn = (stop, label) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.cnStop = stop;
    b.textContent = label;
    b.style.cssText = 'min-height:56px;min-width:7em;padding:.5em 1.2em;border-radius:12px;cursor:pointer;'
      + 'font:inherit;background:var(--surface-alt);color:var(--text);border:2px solid var(--border);'
      + 'outline:none';
    return b;
  };
  // Decline first, in the document as well as the scan: a keyboard Tab and a screen reader meet them in the
  // same order a switch does.
  const declineBtn = mkBtn('decline', 'Decline');
  const answerBtn = mkBtn('answer', 'Answer');
  btns.append(declineBtn, answerBtn);
  el.append(whoEl, kindEl, btns);

  const noteEl = doc.createElement('div');
  noteEl.dataset.callNoticeNote = '';
  noteEl.hidden = true;
  noteEl.setAttribute('role', 'status');
  noteEl.setAttribute('aria-live', 'polite');
  noteEl.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
    + `${zIndex != null ? `z-index:${zIndex};` : ''}max-width:min(80%,560px);padding:12px 18px;border-radius:12px;`
    + 'pointer-events:none;text-align:center;font:600 clamp(15px,2.1vmin,22px)/1.4 system-ui,-apple-system,Segoe UI,sans-serif;'
    + 'background:var(--surface);color:var(--text);border:2px solid var(--focus)';
  host.append(el, noteEl);

  declineBtn.addEventListener('click', () => { decline(); });
  answerBtn.addEventListener('click', () => { answer().catch(() => {}); });

  function paint() {
    for (const [i, b] of [declineBtn, answerBtn].entries()) {
      const on = i === lit;
      if (on) b.dataset.lit = '1'; else delete b.dataset.lit;
      b.style.boxShadow = on ? '0 0 0 4px var(--scan-ring, var(--focus))' : '';
      b.style.borderColor = on ? 'var(--focus)' : 'var(--border)';
      b.disabled = phase !== 'ringing';
    }
  }

  function setHold(on) {
    if (held === on) return;
    held = on;
    try { holdScan?.(on); } catch (err) { console.error('call notice: scan', err); }
  }

  function showNote(text) {
    if (noteT != null) { try { clearTimer(noteT); } catch { /* gone */ } noteT = null; }
    if (!text) { noteEl.hidden = true; return; }
    noteEl.textContent = text;
    noteEl.hidden = false;
    noteT = setTimer(() => { noteT = null; noteEl.hidden = true; }, NOTICE_NOTE_MS);
  }

  /** The notice goes. `note`: a short line to leave for a moment (or null). Never touches the call. */
  function clear(note = null) {
    if (ringT != null) { try { clearTimer(ringT); } catch { /* gone */ } ringT = null; }
    phase = 'idle';
    who = null;
    ringAt = null;
    lit = -1;
    el.hidden = true;
    paint();
    setHold(false);
    if (note) showNote(note);
  }

  function ring(ev) {
    if (ev.panel) return;                              // a Call panel rings for it: never twice
    let m = 'notice';
    try { m = mode(); } catch { m = 'notice'; }
    if (m === 'off') return;                           // "don't ring here": the caller waits on the others
    if (phase === 'answering') return;                 // an answer is already being made here
    // A new ring (or a caller ringing again over the last one): this caller, from the start.
    if (ringT != null) { try { clearTimer(ringT); } catch { /* gone */ } ringT = null; }
    showNote(null);
    seq += 1;
    who = ev.from || {};
    ringAt = now();
    phase = 'ringing';
    lit = -1;
    const t = noticeText(who);
    whoEl.textContent = t.who;
    kindEl.textContent = t.kind;
    el.hidden = false;
    paint();
    setHold(true);
    const mine = seq;
    ringT = setTimer(() => {
      ringT = null;
      if (phase !== 'ringing' || seq !== mine) return;
      const name = nameOf(who);
      clear(`Missed call from ${name}.`);
      // Nobody answered in the caller's whole wait: the caller is told, as the Call panel's own ring-out
      // does (call.js `end('unanswered')`). Normally the caller's `bye` got here first and this never runs.
      try { transport.hangup('unanswered'); } catch { /* already gone */ }
    }, NOTICE_RING_MS);
    try {
      const out = typeof output === 'function' ? output() : output;
      out?.alert?.(t.announce, { source: 'call' });
    } catch (err) { console.error('call notice: announce', err); }
  }

  function ended(ev) {
    if (phase === 'idle') return;                      // nothing showing (a call this notice handed on)
    if (ev.local) return;                              // this screen's own decline / ring-out: already done
    const name = nameOf(who);
    if (ev.reason === 'elsewhere') clear('Handled on another screen.');
    else if (ev.reason === 'failed' || ev.reason === 'stalled') clear('The call could not connect.');
    else clear(`Missed call from ${name}.`);           // the caller hung up or gave up
  }

  offs.push(transport.onRing((ev) => {
    if (!ev) return;
    try { if (ev.type === 'ring') ring(ev); else if (ev.type === 'end') ended(ev); }
    catch (err) { console.error('call notice', err); }
  }));

  function decline() {
    if (phase !== 'ringing') return false;
    clear(null);
    try { transport.hangup('declined'); } catch { /* already gone */ }
    return true;
  }

  async function answer() {
    if (phase !== 'ringing') return false;
    phase = 'answering';
    paint();
    whoEl.textContent = `Answering ${nameOf(who)}…`;
    const mine = seq;
    const from = who;
    const at = ringAt;
    // THE CLAIM FIRST, before anything opens (call_transport.js `claim`): the server says whether this
    // screen has the call. It fails open on a server that cannot answer, as the Call panel's does.
    let won = true;
    try { won = await transport.claim(); } catch (err) { console.error('call notice: claim', err); won = true; }
    if (seq !== mine || phase !== 'answering') return false;    // the ring ended while asking
    if (won !== true) { clear('Handled on another screen.'); return false; }
    clear(null);
    let ok = false;
    try { ok = (await openCall?.(from, { ringStartedAt: at })) === true; }
    catch (err) { console.error('call notice: hosting the call', err); ok = false; }
    if (!ok) {
      // Answered with nothing to host it: hang up rather than leave the caller "answered" by nobody.
      try { transport.hangup('failed'); } catch { /* already gone */ }
      showNote('The call could not connect.');
    }
    return ok;
  }

  /** A verb while the notice shows: next / prev light a stop, select presses it, back declines. */
  function verb(v) {
    if (phase === 'answering') return true;            // swallowed: nothing to do until the claim answers
    if (phase !== 'ringing') return false;
    const n = NOTICE_STOPS.length;
    if (v === 'next') lit = lit < 0 ? 0 : (lit + 1) % n;
    else if (v === 'prev') lit = lit < 0 ? 0 : (lit - 1 + n) % n;      // from nothing, Decline either way
    else if (v === 'select') {
      if (lit < 0) return true;                        // a stray first press: nothing happens
      if (NOTICE_STOPS[lit] === 'decline') decline(); else answer().catch(() => {});
      return true;
    } else if (v === 'back') { decline(); return true; }
    else return true;                                  // any other verb is held while it shows
    paint();
    return true;
  }

  if (bus && typeof bus.subscribe === 'function') {
    offs.push(bus.subscribe(CALL_ANSWER_TOPIC, () => { if (phase === 'ringing') answer().catch(() => {}); }));
    offs.push(bus.subscribe(CALL_DECLINE_TOPIC, () => { if (phase === 'ringing') decline(); }));
  }

  return {
    showing: () => phase !== 'idle',
    phase: () => phase,
    who: () => (who ? { ...who } : null),
    lit: () => (lit < 0 ? null : NOTICE_STOPS[lit]),
    note: () => (noteEl.hidden ? null : noteEl.textContent),
    element: () => el,
    verb,
    answer,
    decline,
    destroy() {
      offs.splice(0).forEach((off) => { try { off?.(); } catch { /* gone */ } });
      if (ringT != null) { try { clearTimer(ringT); } catch { /* gone */ } ringT = null; }
      if (noteT != null) { try { clearTimer(noteT); } catch { /* gone */ } noteT = null; }
      phase = 'idle';
      setHold(false);
      el.remove();
      noteEl.remove();
    },
  };
}
