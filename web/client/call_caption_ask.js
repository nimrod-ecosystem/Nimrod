// call_caption_ask.js - "ASK THE OTHER END" FOR SUBTITLES (row 2.144 step 3, 2026-11-01).
//
// Mike, 2026-10-27: subtitles are "computed at whoever's end has them turned on. If they both have them on, have it default
// to outgoing in case someone had their AI learn their voice." The proposal's step 3 (docs, DC 3): "if the listener has no
// local program, the listener's page asks the speaker's page to caption itself. The speaker's own choice decides: the
// speaker is never captioned through a cloud service they did not turn on."
//
// So a person who wants subtitles of the OTHER person (their "Make subtitles of the other person on calls", call_loadouts.js
// CALL_SUBS_IN_KEY) has their end ask the other end, once per call, to send subtitles of its own voice:
//   * the CALL PAGE always asks when that choice is on: it cannot hear a call's sound, so it can make none of its own;
//   * a SCREEN asks when it prefers the speaker's own ('theirs', the default and Mike's rule: the end where the voice is
//     knows it best, a voice-trained recogniser included), or when it prefers its own but cannot make them here.
// The other end shows the request in plain words, with where the voice would go, and four answers:
//   Yes (this call) / Always for <name> / No (this call) / Never for <name>
// FOUR, not three, argued: FOR three (yes / always / no), a smaller box over a call. AGAINST, and it wins: the asker asks on
// every call, so "No" alone means answering the same question on every call from somebody who needs subtitles; "Never" is
// the remembered no, as "Always" is the remembered yes. Both are kept per asker and can be forgotten (the call page's
// setup view; a screen's menu, Subtitles heading).
//
// *** NEVER A GATE. *** The request is a small box beside the call, the call goes on under it, and it GOES AWAY BY ITSELF
// (CAPTION_ASK_SHOW_MS). Gone unanswered is a no for this call: NOTHING IS SENT WITHOUT A YES. A bedside screen whose person
// cannot press anything therefore sends nothing, and shows the box only for that long. (CLAUDE.md: a screen must never
// enter a state only an input can leave when the person in front of it cannot give that input.)
// *** A PERSON WHO CHOSE "OFF" IS NOT ASKED. *** Their own "Send subtitles of what I say on calls" set to off (not merely
// never chosen) answers no without showing anything. Argued: FOR asking anyway, the asker may need them and a yes for one
// call is a different question. AGAINST, and it wins: a person (or whoever set up a screen for somebody who cannot answer)
// who said off has answered already, and a box on every call from every asker is the nagging that choice was made to stop.
// Not chosen yet is the ordinary case, and is asked.
// *** WHERE THE VOICE GOES IS SAID IN THE REQUEST. *** On a screen: its speech program, on that computer (or also the other
// computers its voice settings name, when its row says so) - no company. On the call page: the browser's recogniser, which
// in Chrome sends the voice to Google; a yes there is that device's own yes for this call or this asker, never anybody
// else's.
// *** THE ROUTE IS THE CALL'S OWN WORDS CHANNEL *** (call_transport.js `askCaptions` / `answerCaptions` / `onCaptionAsks`),
// end to end, never the server; a page that does not know the message ignores it, and the asker then simply hears nothing.
// Group calls: not yet (row 2.144 step 4).

// How long a request stays on the answering screen or page before it goes away by itself. 30 s, argued: the first seconds
// of a call are greetings and settling the phone, so a box that left after 10 would often be gone before anybody looked at
// it; two lines and four buttons are read in well under 30; and longer keeps a box over a call nobody is answering. Not a
// person's setting: it only bounds how long an unanswered question stays, and nobody can judge it from a menu.
export const CAPTION_ASK_SHOW_MS = 30000;
// How long the ASKER waits before saying it heard nothing back. The answering end's own wait plus 5 s for the answer to
// travel and a press made in the last moment; past that, nothing more is coming for this call.
export const CAPTION_ASK_WAIT_MS = CAPTION_ASK_SHOW_MS + 5000;

// What crosses the channel as an answer.
export const CAPTION_ANSWERS = Object.freeze(['yes', 'no', 'cannot']);
// What a person can press: the two remembered ones say yes / no on the channel, and are kept for that asker.
export const ASK_CHOICES = Object.freeze(['yes', 'always', 'no', 'never']);

// Where remembered answers are kept. A SCREEN: on its person's own row (call_loadouts.js CALL_SUBS_PERSON_ROW), because the
// voice is theirs and their screens should agree. The CALL PAGE: on this device only, because a yes there lets this
// browser's recogniser send the voice to its maker, which is this device's question (call_outgoing_captions.js).
export const CALL_SUBS_ASKED_KEY = 'callSubtitlesAsked';
export const CAPTIONS_ASKED_DEVICE_KEY = 'nimrod:call:captions-asked';

/** Who is asking, as a stable key: the account the server stamped on the call (`by`, which a page cannot forge), else the
 *  person card the call is with. '' when neither is known (then nothing can be remembered for them). Pure. */
export function askKeyOf(who) {
  if (!who || typeof who !== 'object') return '';
  if (typeof who.by === 'string' && who.by) return `by:${who.by.slice(0, 80)}`;
  const pid = who.personId || who.id;
  if (typeof pid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(pid)) return `person:${pid}`;
  return '';
}

/** The remembered answers, cleaned: { [key]: { answer: 'yes' | 'no', name } }. Accepts the object or its JSON. Pure. */
export function rememberedAnswers(raw) {
  let m = raw;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = null; } }
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const [k, v] of Object.entries(m)) {
    if (!k || !v || typeof v !== 'object') continue;
    if (v.answer !== 'yes' && v.answer !== 'no') continue;
    out[k] = { answer: v.answer, name: typeof v.name === 'string' ? v.name.slice(0, 60) : '' };
  }
  return out;
}
/** 'yes' | 'no' | null for one asker. Pure. */
export function rememberedFor(raw, key) {
  if (!key) return null;
  const r = rememberedAnswers(raw)[key];
  return r ? r.answer : null;
}
/** The answers with one asker's set ('yes' | 'no') or forgotten (null). Pure. */
export function withRemembered(raw, key, answer, name = '') {
  const m = rememberedAnswers(raw);
  if (!key) return m;
  if (answer === 'yes' || answer === 'no') m[key] = { answer, name: typeof name === 'string' ? name.slice(0, 60) : '' };
  else delete m[key];
  return m;
}

/**
 * What the answering end does with a request. Pure.
 *   running     its subtitles of its own voice are already going to the other end
 *   able        it could make them now (a speech program or a recogniser, and a microphone in the call)
 *   chosenOff   its person chose "Send subtitles of what I say on calls": off
 *   remembered  'yes' | 'no' | null for this asker
 * -> 'yes' (already, or remembered yes) | 'no' | 'cannot' | 'ask' (show the request)
 */
export function answerFor({ running = false, able = true, chosenOff = false, remembered = null } = {}) {
  if (running) return 'yes';
  if (!able) return 'cannot';
  if (remembered === 'no' || chosenOff) return 'no';
  if (remembered === 'yes') return 'yes';
  return 'ask';
}

/**
 * Whether a SCREEN asks the other end, from its call plan (call_loadouts.js callSubtitlesPlan). Pure.
 * `oursCan`: whether this screen can make subtitles of the other person itself.
 */
export function screenShouldAsk(plan, oursCan = true) {
  if (!plan || !plan.captions || plan.captions === 'off') return false;      // nobody here wants them
  if (plan.theirCaptions === 'none') return false;                           // theirs would not be shown here
  if (plan.theirCaptions === 'ours') return !oursCan;                        // ours first: ask only when ours cannot run
  return true;                                                               // 'theirs': the speaker's own are better
}

/** The words of a request. `at`: 'screen' (made by the speech program) | 'page' (the browser's recogniser). Pure. */
export function askWords({ name = '', at = 'screen', where = 'here' } = {}) {
  const who = (typeof name === 'string' && name.trim()) || 'The person on the call';
  const short = (typeof name === 'string' && name.trim()) || 'them';
  const text = at === 'page'
    ? `${who} asks for subtitles of what you say. Your browser would turn what you say into words and send them to that `
      + 'screen. In Chrome that means Google’s speech service hears your voice. Nothing is kept.'
    : `${who} asks for subtitles of what is said here. They would be worked out on `
      + (where === 'any' ? 'this computer and the other computers in this screen’s voice settings' : 'this computer')
      + ` and sent to ${short} as words. No company hears the voice, and nothing is kept.`;
  return {
    text,
    yes: 'Yes, this call',
    always: `Always for ${short}`,
    no: 'No',
    never: `Never for ${short}`,
    away: 'This goes away by itself.',
  };
}

// Said on the asker's call page about the answer (a screen that asked says nothing: its own subtitles simply keep going).
export const ASK_ANSWER_SAYS = Object.freeze({
  no: 'They chose not to send subtitles of what is said there.',
  cannot: 'That screen cannot make subtitles of what is said there (it needs its speech program running).',
  none: 'No answer about subtitles of what is said there.',
});

/**
 * Show a request in `host` and wait for an answer. Never blocks anything: it is a box beside the call, and it goes by
 * itself after `showMs` (then `onAnswer(null)`: no answer, nothing sent). `canRemember` false (nobody to remember them
 * by): only Yes and No. Returns { el, close() } - close() removes it without answering.
 */
export function showAskPrompt(host, {
  words, canRemember = true, onAnswer = () => {}, showMs = CAPTION_ASK_SHOW_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  className = 'call-ask', buttonClass = '', style = '',
} = {}) {
  const doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!host || !doc || !words) return { el: null, close() {} };
  const el = doc.createElement('section');
  el.className = className;
  el.dataset.captionAsk = '';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Asked for subtitles');
  el.setAttribute('aria-live', 'polite');
  if (style) el.style.cssText = style;
  const p = doc.createElement('p');
  p.textContent = words.text;
  p.style.margin = '0';
  const row = doc.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  for (const c of ASK_CHOICES) {
    if (!canRemember && (c === 'always' || c === 'never')) continue;
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.askAnswer = c;
    if (buttonClass) b.className = buttonClass;
    else b.style.cssText = 'font:inherit;padding:.45em .9em;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer';
    b.textContent = words[c];
    row.append(b);
  }
  const away = doc.createElement('p');
  away.textContent = words.away;
  away.style.cssText = 'margin:6px 0 0;opacity:.75;font-size:.85em';
  el.append(p, row, away);
  host.append(el);
  let done = false;
  let timer = null;
  const close = () => {
    if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; }
    try { el.remove(); } catch { /* gone */ }
  };
  const finish = (choice) => {
    if (done) return;
    done = true;
    close();
    try { onAnswer(choice); } catch (err) { console.error('subtitles: answering a request', err); }
  };
  el.addEventListener('click', (e) => {
    const b = e.target?.closest?.('[data-ask-answer]');
    if (b && ASK_CHOICES.includes(b.dataset.askAnswer)) finish(b.dataset.askAnswer);
  });
  timer = setTimer(() => { timer = null; finish(null); }, showMs);
  return { el, close: () => { done = true; close(); } };
}

// ---- THE CALL PAGE'S OWN "ASK FOR SUBTITLES OF WHAT IS SAID THERE" ----
// The person's "Make subtitles of the other person on calls" (call_loadouts.js CALL_SUBS_IN_KEY) once they have chosen;
// until then this device's own tick, as "Send subtitles of what I say" works (call_outgoing_captions.js). No device's own
// yes is needed here, unlike sending: asking sends nothing of this person's, it only asks.
export const CAPTIONS_IN_DEVICE_KEY = 'nimrod:call:captions-in';
export const CAPTIONS_IN_LABEL = 'Ask for subtitles of what is said there';
export const CAPTIONS_IN_NOTE = 'The screen you call is asked to send subtitles of what is said in its room. Whoever is '
  + 'there says yes or no; nothing is sent without a yes. Nothing is kept.';
/** Whether the call page asks: the person's choice (true | false) once made, else this device's tick. Pure. */
export function captionsInOn(person, stored) {
  if (person === true || person === false) return person;
  return stored === 'on';
}

/** A pressed choice as it goes on the channel ('yes' | 'no'), and what is remembered ('yes' | 'no' | null). Pure. */
export function choiceMeans(choice) {
  if (choice === 'yes') return { answer: 'yes', remember: null };
  if (choice === 'always') return { answer: 'yes', remember: 'yes' };
  if (choice === 'no') return { answer: 'no', remember: null };
  if (choice === 'never') return { answer: 'no', remember: 'no' };
  return { answer: null, remember: null };      // gone unanswered: nothing is sent
}
