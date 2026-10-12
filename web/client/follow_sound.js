// follow_sound.js — THE FOLLOW PAGE'S SOUND: the follower's half of "hear the same thing" (row 2.79, 2026-10-12).
//
// Mike, 2026-10-12: "we both see and hear the same thing at the same time... the same pictures and videos on a call or
// even just to know I'm looking at the same things when it's not a call." Watch along (follow_view.js) started MUTED,
// with a Sound button: the plan's worry was two speakers in one room a fraction of a second apart, and a page that
// starts making sound by itself. Pressing Follow is a person's own press, so the browser lets that page play sound;
// whether it SHOULD is this file's question. Two halves:
//
//   1. THE SETTING, "Sound here", remembered on this computer (the follow page's other setting, "Stop following by
//      itself", is kept the same way). Argued below.
//   2. KNOWING WHETHER THIS COMPUTER IS ON A CALL WITH THAT SCREEN, because a call changes the answer (the echo case,
//      below). The call page (call_page.js) says so on a same-browser BroadcastChannel; nothing leaves this computer.
//
// *** THE ECHO CASE, AND WHY A CALL TURNS THE FOLLOWER'S OWN SOUND OFF BY DEFAULT. *** During a call between this
// computer and the screen it follows, two copies of the film reach this person: the follow page's own, and the screen's,
// which plays in that room and is picked up by the screen's microphone and sent down the call. A browser's echo
// cancellation removes the call's own sound from a microphone, not other sound on the page (call_page.js says the same
// of the browser's voice, WORDS_HOLD_MAX_MS) [training knowledge, unmeasured here]. So the two copies arrive a call's
// delay apart (a few hundred ms) - an echo. And it goes both ways: this computer's speakers playing the film go into
// THIS microphone and back to the screen's room, late. The screen's sound cannot be "kept out of the call" from here:
// the only thing that could is echo cancellation on the screen, which does not cover a YouTube player. So:
//   * DURING A CALL WITH THAT SCREEN (the default): the follow page goes quiet and the film is heard THROUGH THE CALL,
//     with the voices, in step with them - one copy, no echo either way. The screen keeps it under the voices
//     (call_sound.js), so it is heard, quietly. AGAINST: the film arrives at call quality, and the screen's microphone
//     noise suppression may thin music out [unmeasured - on Mike's list for the bench]. Somebody with headphones loses
//     nothing by choosing "On" (headphones stop the second echo, though they still hear the screen's copy in the call).
//   * NOT ON A CALL: sound ON. Mike's words are "hear the same thing ... even when it's not a call", the press on Follow
//     is a person asking for it, and the usual follower is somebody at home, in another room from the screen. AGAINST:
//     two screens in ONE room (the plan's edge case) echo; that person picks "Off".
export const FOLLOW_SOUND_KEY = 'nimrod:follow-sound';
export const FOLLOW_SOUND_DEFAULT = 'auto';
export const FOLLOW_SOUND_CHOICES = Object.freeze([
  Object.freeze({ value: 'auto', label: 'on, but off while I am on a call with that screen (the call carries it)' }),
  Object.freeze({ value: 'on', label: 'on, even during a call (use headphones)' }),
  Object.freeze({ value: 'off', label: 'off until I press Sound on (the same room as the screen)' }),
]);
export function soundModeOf(v) {
  return FOLLOW_SOUND_CHOICES.some((c) => c.value === v) ? v : FOLLOW_SOUND_DEFAULT;
}
/** Should the follow page be muted? PURE. `override`: the Sound button's choice this session (true = muted), or null. */
export function followMuted({ mode = FOLLOW_SOUND_DEFAULT, inCall = false, override = null } = {}) {
  if (override === true || override === false) return override;
  const m = soundModeOf(mode);
  if (m === 'off') return true;
  if (m === 'on') return false;
  return !!inCall;
}

// ---- this computer's calls, across its tabs -------------------------------------------------------------------------
// The call page and the follow page are different pages (call.html, remote.html), often in two tabs of one browser. A
// BroadcastChannel reaches every page of the same site in the same browser and nothing else - no server, no network.
// What crosses it: which people this tab is on a call with (person ids this computer already holds), nothing more.
export const CALL_CHANNEL = 'nimrod-call';
// *** A CALL TAB SAYS SO EVERY 5 SECONDS; SILENCE FOR 15 IS "NO CALL". *** A tab that crashes or is killed never says
// "ended", and a follow page that believed it would stay muted for good. Three missed beats, argued: one late timer in a
// background tab (browsers slow those to once a second or less) never flips it, and a dead tab clears within 15 s. Not a
// person's setting: nobody can judge it from a menu. Seams for the suite.
export const CALL_BEAT_MS = 5000;
export const CALL_STALE_MS = 15000;

function makeChannel(Channel) {
  try {
    const C = Channel || (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
    return C ? new C(CALL_CHANNEL) : null;
  } catch { return null; }
}
const cleanIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x && x.length <= 80))];

/** The call page's half: `set(personIds)` while on a call ([] when not). Re-says it every CALL_BEAT_MS. */
export function createCallAnnouncer({
  Channel = null, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  beatMs = CALL_BEAT_MS, tab = Math.random().toString(36).slice(2, 10),
} = {}) {
  const ch = makeChannel(Channel);
  let people = [];
  let beat = null;
  let dead = false;
  const post = () => { try { ch?.postMessage({ type: 'call', tab, people }); } catch { /* closed */ } };
  function restart() {
    if (beat != null) { clearTimer(beat); beat = null; }
    if (dead || !people.length) return;
    beat = setTimer(() => { beat = null; post(); restart(); }, beatMs);
  }
  // A follow page opened mid-call asks, and is told at once rather than at the next beat.
  try { if (ch) ch.onmessage = (e) => { if (!dead && e?.data?.type === 'call-ask' && people.length) post(); }; } catch { /* none */ }
  return {
    set(ids) {
      if (dead) return;
      const next = cleanIds(ids);
      if (next.join('\n') === people.join('\n')) return;
      people = next;
      post();
      restart();
    },
    people: () => people.slice(),
    destroy() {
      if (dead) return;
      if (people.length) { people = []; post(); }
      dead = true;
      if (beat != null) { clearTimer(beat); beat = null; }
      try { ch?.close?.(); } catch { /* closed */ }
    },
  };
}

/** The follow page's half: is any tab of this browser on a call with `personId`? `onChange(fn)` hears each message. */
export function watchLocalCalls({ Channel = null, now = () => Date.now(), staleMs = CALL_STALE_MS } = {}) {
  const ch = makeChannel(Channel);
  const tabs = new Map();               // tab -> { people, at }
  const fns = new Set();
  let dead = false;
  try {
    if (ch) {
      ch.onmessage = (e) => {
        const m = e && e.data;
        if (dead || !m || m.type !== 'call' || typeof m.tab !== 'string') return;
        const people = cleanIds(m.people);
        if (people.length) tabs.set(m.tab, { people, at: now() }); else tabs.delete(m.tab);
        for (const fn of fns) { try { fn(); } catch (err) { console.error('follow sound: call change', err); } }
      };
      ch.postMessage({ type: 'call-ask' });
    }
  } catch { /* no channel: never "on a call", and the Sound button still works */ }
  return {
    inCallWith(personId) {
      if (!personId) return false;
      const t = now();
      for (const [k, v] of tabs) {
        if (t - v.at > staleMs) { tabs.delete(k); continue; }
        if (v.people.includes(personId)) return true;
      }
      return false;
    },
    onChange(fn) { if (typeof fn === 'function') fns.add(fn); return () => fns.delete(fn); },
    available: () => !!ch,
    destroy() { dead = true; fns.clear(); tabs.clear(); try { ch?.close?.(); } catch { /* closed */ } },
  };
}
