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
// *** A SWITCH REACHES IT ON A SCREEN (2026-11-01). *** Until now only a pointer could: a switch user saw a question they
// could not answer. While the box is up IT TAKES THE WALK (`verb`): next / prev light its buttons, select presses the lit
// one, back says "No". Argued against the other reading, its buttons as more stops after Hang up:
//   * after Hang up, the first `next` lights Hang up and every way to the box passes over it, so one select a beat early
//     ENDS THE CALL; and in a call view with a talk board next / prev are the board's, so "after Hang up" is not even a
//     place a switch can get to;
//   * taking the walk, no single press can hang up while the box is up (Hang up is still the bar's, a pointer's, "hang
//     up" said, and Back twice: the first Back says No and the box goes). The cost: for at most CAPTION_ASK_SHOW_MS the
//     switch is the box's, not the board's or the game's; nothing on those is lost (their own lit place is kept), and
//     when the box goes the walk is exactly what it was.
// NOTHING IS LIT AT FIRST, so a stray select does nothing (as the incoming-call notice and the Call panel's faces). The
// first next OR prev lights "Yes, this call" (the notice's own "from nothing, the first either way"): the remembered
// answers, "Always" and "Never", are never one press from nothing. BACK IS "NO" FOR THIS CALL, never remembered: the
// notice's Back is Decline for the same reason - it commits nothing and tells the other end now, where going without an
// answer would leave them waiting CAPTION_ASK_WAIT_MS to be told nothing. ESCAPE, with the keyboard in the box, is the
// same "No" (and goes no further: not the screen's menu as well). Walking it NEVER HOLDS IT: the box still goes by itself
// on time, lit or not - reaching the buttons must not turn it into a gate. The buttons are ordinary buttons in the order
// drawn, so Tab reaches them in that order; when the box goes with the keyboard in it, the keyboard goes back to where it
// came from rather than to nowhere. The call page (a phone) uses none of the walk; only the keyboard part is shared.
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
//
// *** GROUP CALLS (row 2.144 step 4, 2026-11-01). *** Each other person is asked ONCE, on their own connection (the call that
// rang: call_transport.js; everybody else: call_group.js `askCaptions`, which also asks whoever joins later), and each is
// answered on their own connection, PER PERSON: what is decided without a box (already sending to them, remembered,
// chosen off, cannot) is decided for each, and a yes to one person sends subtitles to that person only (call_captions.js,
// call_page.js keep who said yes) - "nothing is sent without a yes" holds per person, not per call.
// MORE THAN ONE REQUEST AT ONCE: ONE BOX, NOT A QUEUE (`createAskDesk`, below). Argued:
//   FOR a queue (one box per asker, one after another): every person gets their own four answers.
//   AGAINST, and it wins: a group call starts with everybody asking at once, so a queue is several boxes in a row over the
//   call - up to MESH_MAX_OTHERS.audio (5) of them, two and a half minutes for a bedside screen that cannot answer any,
//   with a switch's walk taken the whole time. One box that NAMES everybody asking ("Sam and Robin ask...") is up once.
//   Its answer goes to each of them, one by one, on their own connections; "Always" / "Never" are remembered for each of
//   them that can be remembered. The cost: one answer for everybody in the box. Somebody who wants yes for one and no for
//   another says "No" here and turns them on for the one ("Send subtitles of what I say" on, or answer that one's next
//   request); it is a rare want against a common cost.
// A SECOND REQUEST WHILE THE BOX IS UP joins it: the words name both, and the box's own time starts again, so the person
// just named gets the same CAPTION_ASK_SHOW_MS to be read as the first. STILL NEVER A GATE: each other person asks at most
// once per call, so the box can be held up at most once per other person (a group's cap, MESH_MAX_OTHERS), and it still
// goes by itself; a switch keeps its place in it (the lit choice stays lit while the words change).
// REMEMBERED ANSWERS NEED SOMEBODY TO REMEMBER: the call that rang carries who placed it (`askKeyOf`); a person met through
// the group is named by the server but carries no account a page can see, so for them only Yes and No are offered, and a
// box naming any such person offers only Yes and No (an "Always" that silently remembered half the people named would be
// a button that lies). NOT YET: the server stamping an account on group members (drive.py; not this change).

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

/** Names as one phrase: 'Sam', 'Sam and Robin', 'Sam, Robin and Ann'. Blanks are dropped. Pure. */
export function askNames(names) {
  const list = (Array.isArray(names) ? names : [names]).map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The words of a request. `at`: 'screen' (made by the speech program) | 'page' (the browser's recogniser). Pure.
 * `names` (group calls, row 2.144 step 4): everybody asking at once; `name` is the one asker, as before. Anybody unnamed in
 * a list is "someone else on the call".
 */
export function askWords({ name = '', names = null, at = 'screen', where = 'here' } = {}) {
  let list = Array.isArray(names) ? names.map((n) => (typeof n === 'string' && n.trim()) || 'someone else on the call') : [name];
  if (list.length > 1) list = [...new Set(list)];
  const one = list.length <= 1;
  const named = askNames(list);
  const who = named || 'The person on the call';
  const short = named || 'them';
  const asks = one ? 'asks' : 'ask';
  const text = at === 'page'
    ? `${who} ${asks} for subtitles of what you say. Your browser would turn what you say into words and send them to `
      // To them by name: in a group call the one asking may be another caller's page rather than a screen.
      + `${named || 'the person asking'}. In Chrome that means Google’s speech service hears your voice. Nothing is kept.`
    : `${who} ${asks} for subtitles of what is said here. They would be worked out on `
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

// What a switch's Back, and Escape in the box, answer (see the header): the plain no, for this call only.
export const ASK_BACK_MEANS = 'no';

/**
 * Show a request in `host` and wait for an answer. Never blocks anything: it is a box beside the call, and it goes by
 * itself after `showMs` (then `onAnswer(null)`: no answer, nothing sent). `canRemember` false (nobody to remember them
 * by): only Yes and No. Returns { el, close(), verb(v), lit() } - close() removes it without answering; verb('next' |
 * 'prev' | 'select' | 'back') is a switch's walk (true when the box took the verb); lit() is the lit choice or null.
 */
export function showAskPrompt(host, {
  words, canRemember = true, onAnswer = () => {}, showMs = CAPTION_ASK_SHOW_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  className = 'call-ask', buttonClass = '', style = '',
} = {}) {
  const doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!host || !doc || !words) return { el: null, close() {}, verb: () => false, lit: () => null };
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
  // The buttons, drawn again by `update` (group calls: a second asker joined the box). A button that stays keeps its element,
  // so a keyboard on it stays on it.
  function drawButtons(w, remember) {
    const have = new Map([...row.querySelectorAll('[data-ask-answer]')].map((b) => [b.dataset.askAnswer, b]));
    const want = ASK_CHOICES.filter((c) => remember || (c !== 'always' && c !== 'never'));
    for (const [c, b] of have) if (!want.includes(c)) b.remove();
    for (const c of want) {
      let b = have.get(c);
      if (!b) {
        b = doc.createElement('button');
        b.type = 'button';
        b.dataset.askAnswer = c;
        if (buttonClass) b.className = buttonClass;
        else b.style.cssText = 'font:inherit;padding:.45em .9em;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer';
      }
      b.textContent = w[c];
      row.append(b);            // in ASK_CHOICES order, whether new or kept
    }
  }
  drawButtons(words, canRemember);
  const away = doc.createElement('p');
  away.textContent = words.away;
  away.style.cssText = 'margin:6px 0 0;opacity:.75;font-size:.85em';
  el.append(p, row, away);
  host.append(el);
  let done = false;
  let timer = null;
  let lit = -1;                 // the switch's lit button; -1 = nothing lit (a stray select does nothing)
  let cameFrom = null;          // where the keyboard was before it came into the box
  const buttons = () => [...row.querySelectorAll('[data-ask-answer]')];
  // The lit look: the same 4px ring in the theme's scan colour that Hang up and the incoming-call notice's buttons use, so
  // the box reads as part of the same walk.
  const paint = () => {
    buttons().forEach((b, i) => {
      if (i === lit) { b.dataset.lit = '1'; b.style.boxShadow = '0 0 0 4px var(--scan-ring, var(--focus, #fff3d9))'; }
      else { delete b.dataset.lit; b.style.boxShadow = ''; }
    });
  };
  const close = () => {
    if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; }
    const hadKeys = (() => { try { return el.contains(doc.activeElement); } catch { return false; } })();
    try { el.remove(); } catch { /* gone */ }
    // The keyboard was in the box: back to where it came from, not to nowhere (a removed button leaves it on the page).
    if (hadKeys && cameFrom && cameFrom.isConnected) { try { cameFrom.focus({ preventScroll: true }); } catch { /* gone */ } }
    cameFrom = null;
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
  el.addEventListener('focusin', (e) => {
    const from = e.relatedTarget;
    if (from && !el.contains(from)) cameFrom = from;
  });
  // Escape with the keyboard in the box: "No" for this call, and the key goes no further (not the screen's menu too).
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || done) return;
    e.preventDefault();
    e.stopPropagation();
    finish(ASK_BACK_MEANS);
  });
  /** A switch's walk while the box is up (see the header). True when the box took the verb. */
  function verb(v) {
    if (done) return false;
    const n = buttons().length;
    if (!n) return false;
    if (v === 'next') lit = lit < 0 ? 0 : (lit + 1) % n;
    else if (v === 'prev') lit = lit < 0 ? 0 : (lit - 1 + n) % n;      // from nothing, "Yes, this call" either way
    else if (v === 'select') {
      if (lit < 0) return true;                                        // nothing lit: a stray press does nothing
      const c = buttons()[lit]?.dataset.askAnswer;
      if (ASK_CHOICES.includes(c)) finish(c);
      return true;
    } else if (v === 'back') { finish(ASK_BACK_MEANS); return true; }
    else return false;
    paint();
    return true;
  }
  const arm = () => {
    if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } }
    timer = setTimer(() => { timer = null; finish(null); }, showMs);
  };
  arm();
  /**
   * New words for the same box (group calls: somebody else asked while it was up, call_caption_ask.js header). The lit
   * choice stays lit if it is still offered (else nothing is lit: a select then does nothing); `restart` gives the box its
   * whole time again. Never answers anything.
   */
  function update(w, { canRemember: remember = canRemember, restart = false } = {}) {
    if (done || !w) return false;
    const litChoice = lit >= 0 ? buttons()[lit]?.dataset.askAnswer : null;
    p.textContent = w.text;
    drawButtons(w, remember);
    lit = litChoice ? buttons().findIndex((b) => b.dataset.askAnswer === litChoice) : -1;
    paint();
    if (restart) arm();
    return true;
  }
  return {
    el,
    close: () => { done = true; close(); },
    verb,
    update,
    lit: () => (done || lit < 0 ? null : (buttons()[lit]?.dataset.askAnswer || null)),
  };
}

/** What the asker's call page says about one answer that was not a yes; `name` when more than one was asked. Pure. */
export function askAnswerSays(answer, name = '') {
  const who = typeof name === 'string' ? name.trim() : '';
  if (!who) return ASK_ANSWER_SAYS[answer] || '';
  if (answer === 'no') return `${who} chose not to send subtitles of what is said there.`;
  if (answer === 'cannot') return `${who} cannot send subtitles of what is said there (that end has nothing that can make them).`;
  if (answer === 'none') return `No answer from ${who} about subtitles of what is said there.`;
  return '';
}

// ---- EVERYBODY ASKING, IN ONE BOX (row 2.144 step 4, group calls; the header argues one box over a queue) ----------------
/**
 * One end's desk for requests from the other people in a call. Each asker is a `key` (which connection), a `name` (as this
 * end knows them) and a `rememberKey` (askKeyOf, '' when nobody can be remembered by it).
 *   decide({ key, rememberKey })      'yes' | 'no' | 'cannot' | 'ask'  (answerFor, for THAT asker)
 *   reply(key, answer, again)         send it on that asker's connection; may start things on a yes (not when `again`, a
 *                                     repeat to somebody who asked twice). Returns what was actually sent ('yes' that could
 *                                     not start is 'cannot'), or null when nothing could be.
 *   remember(askers, 'yes' | 'no')    keep an Always / Never for each asker with a rememberKey
 *   words(names)                      the box's words for these names (askWords)
 *   host                              the element the box goes in, or a function returning it (a page that redraws)
 * Returns { heard(asker), asking(), verb(v), lit(), answered(key), waiting(), close() }.
 */
export function createAskDesk({
  host = null, decide = () => 'ask', reply = () => null, remember = null, words = (names) => askWords({ names }),
  showMs = CAPTION_ASK_SHOW_MS, setTimer = undefined, clearTimer = undefined,
  className = 'call-ask', buttonClass = '', style = '', onAsking = null, live = () => true,
} = {}) {
  const answered = new Map();       // key -> what was said to them this call (said again if they ask again)
  let waiting = [];                 // askers named in the box now
  let prompt = null;
  const ok = () => { try { return live() !== false; } catch { return false; } };
  const hostNow = () => { try { return typeof host === 'function' ? host() : host; } catch { return null; } };
  const tell = (on) => { if (typeof onAsking === 'function') { try { onAsking(on); } catch (err) { console.error('subtitles: asking', err); } } };
  const timers = { ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}) };
  const canRemember = () => typeof remember === 'function' && waiting.length > 0 && waiting.every((a) => !!a.rememberKey);
  const namesNow = () => waiting.map((a) => a.name);

  function settle(key, answer) {
    let sent = null;
    try { sent = reply(key, answer, false); } catch (err) { console.error('subtitles: answering', err); sent = null; }
    if (sent) answered.set(key, sent);
  }
  function chose(choice) {
    const list = waiting;
    waiting = [];
    prompt = null;
    tell(false);
    if (!ok()) return;
    const { answer, remember: r } = choiceMeans(choice);
    if (r && typeof remember === 'function') {
      const keep = list.filter((a) => a.rememberKey);
      if (keep.length) { try { remember(keep, r); } catch (err) { console.error('subtitles: remembering an answer', err); } }
    }
    if (answer) for (const a of list) settle(a.key, answer);     // gone unanswered: nothing is sent to anybody named
  }

  return {
    /** Somebody asked. Returns what happened: 'again' | 'waiting' | 'yes' | 'no' | 'cannot' | 'ask' | 'nowhere' | 'over'. */
    heard({ key, name = '', rememberKey = '' } = {}) {
      if (!ok() || !key) return 'over';
      if (answered.has(key)) {
        try { reply(key, answered.get(key), true); } catch (err) { console.error('subtitles: answering', err); }
        return 'again';
      }
      if (waiting.some((a) => a.key === key)) return 'waiting';
      let d = 'ask';
      try { d = decide({ key, rememberKey }); } catch (err) { console.error('subtitles: deciding', err); d = 'ask'; }
      if (d !== 'ask') { settle(key, d); return d; }
      const where = prompt ? null : hostNow();
      if (!prompt && !where) return 'nowhere';            // nowhere to ask: no answer, nothing sent
      waiting.push({ key, name: typeof name === 'string' ? name : '', rememberKey: rememberKey || '' });
      if (prompt) { prompt.update(words(namesNow()), { canRemember: canRemember(), restart: true }); return 'ask'; }
      prompt = showAskPrompt(where, { words: words(namesNow()), canRemember: canRemember(), showMs, ...timers,
        className, buttonClass, style, onAnswer: (choice) => chose(choice) });
      if (prompt?.el) tell(true);
      else { prompt = null; waiting = []; return 'nowhere'; }
      return 'ask';
    },
    asking: () => !!prompt,
    verb: (v) => { try { return !!prompt?.verb?.(v); } catch (err) { console.error('subtitles: a switch on the request', err); return false; } },
    lit: () => prompt?.lit?.() || null,
    /** What was said to this asker this call, or null. */
    answered: (key) => answered.get(key) ?? null,
    /** The keys named in the box now. */
    waiting: () => waiting.map((a) => a.key),
    /** Somebody left: out of the box (it goes if they were the only one), and forgotten. */
    gone(key) {
      answered.delete(key);
      if (!waiting.some((a) => a.key === key)) return;
      waiting = waiting.filter((a) => a.key !== key);
      if (!prompt) return;
      if (waiting.length) prompt.update(words(namesNow()), { canRemember: canRemember() });
      else { const p = prompt; prompt = null; try { p.close(); } catch { /* gone */ } tell(false); }
    },
    /** The call is over: the box goes without answering, and everything is forgotten. */
    close() {
      const was = !!prompt;
      const p = prompt;
      prompt = null; waiting = []; answered.clear();
      try { p?.close?.(); } catch { /* gone */ }
      if (was) tell(false);
    },
  };
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
