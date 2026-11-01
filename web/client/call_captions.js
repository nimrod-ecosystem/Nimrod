// call_captions.js — CAPTIONS OF THE PERSON ON THE CALL (call loadouts, 2026-10-09).
//
// Mike, 2026-10-09: "The subtitles would also be a good option for calls."
//
// WHAT CAN HEAR THE FAR END TODAY, AND WHAT CANNOT:
//   * The far end's sound arrives as a MediaStream (call_transport.js `remote()` / `onRemote`).
//   * The BROWSER'S OWN recogniser (SpeechRecognition) cannot be given a stream: it listens to the default
//     microphone and nothing else. So with it, only the ROOM can be captioned, never the call.
//   * THE SPEECH PROGRAM (web/speech_service) takes any audio the page sends it: 16 kHz PCM cut into utterances
//     by the page (speech_engines.js). A phone joined as a microphone already reaches it that way - a remote
//     WebRTC stream through an AudioWorklet. The call's stream goes the same way, so this file is a thin wrapper:
//     speech_engines.js's own `rankedRecognizer`, given the far end's stream as its only "ear", with the room
//     microphone never opened, no wake phrase, no voiceprints, and NOTHING it hears ever acting as a command
//     (`actsOn` refuses everything and the text callback is a no-op). A caller saying "hang up" is a caption.
//
// WHO SAID IT: the caller's name, given by the call (the ranker's own "who is talking" is off - the caller's
// voice is not anybody's voiceprint here, and must not become one).
//
// WHERE THEIR VOICE GOES: mode 'here' keeps only this screen's own recogniser (the default "This screen" pass
// and a person's own voice model); 'any' also uses the other computers this screen's voice settings name
// (call_loadouts.js CALL_CAPTIONS_FIELD argues why that is its own choice).
// NOTHING IS KEPT: captions are drawn by subtitles.js, which holds lines in memory only, and the call view's
// caption box goes with the call.

import { rankedRecognizer, enginePlanFrom } from './speech_engines.js';
import { createSubtitles } from './subtitles.js';   // the caption box (attachCallSubtitles, below)
// row 2.144 step 3: asking the other end for subtitles of its own voice, and answering its asking.
import { answerFor, screenShouldAsk, askWords, rememberedFor, withRemembered, createAskDesk,
  CAPTION_ASK_SHOW_MS } from './call_caption_ask.js';

// The plan for the call's ear, from the screen's (or person's) speech row. Pure.
//   mode 'here': local passes only (remote passes are dropped, and said in `skipped`).
//   `opts.pageProtocol`: the page's protocol (enginePlanFrom's; on https a ws:// address on another computer is
//   left out, said in `skipped` with why 'not secure'). Default: read at the boundary; the suites pass it.
export function callCaptionPlan(row, mode = 'here', opts = {}) {
  const base = enginePlanFrom(row || {}, opts);
  if (base.browser) {
    // The browser's own recogniser is the first pass: it cannot take the call's stream. The local service is
    // still asked, at its default or chosen address - it may be running even when commands use the browser.
    const local = enginePlanFrom({ ...(row || {}), speechEngine: 'local' }, opts);
    return finish(local, mode, [{ slot: 'browser', name: 'The browser’s recognizer', why: 'cannot hear a call' }]);
  }
  return finish(base, mode, []);
}
function finish(plan, mode, extraSkipped) {
  const keep = mode === 'any' ? plan.passes : plan.passes.filter((p) => !p.remote);
  const dropped = plan.passes.filter((p) => !keep.includes(p)).map((p) => ({ slot: p.slot, name: p.name, why: 'captions here only' }));
  return { ...plan, passes: keep, skipped: [...(plan.skipped || []), ...extraSkipped, ...dropped],
           ears: 'phone', wake: null, speakers: null };
}

/**
 * Captions for one call. `sink` is a subtitles.js instance (its `caption(c)`); `who()` the caller's name.
 *   start(stream)   the far end's stream (again on a reconnect: the old one is let go)
 *   stop()          the call ended
 *   status()        the recogniser's status ('waiting' while nothing answers: said, not hidden)
 * `recognizer` is a seam for the suites (speech_engines.js `rankedRecognizer`'s shape).
 */
export function createCallCaptions({
  row = {}, mode = 'here', sink = null, who = () => null,
  recognizer = rankedRecognizer, makeContext = undefined, WebSocketImpl = undefined,
  onStatus = null,
  pageProtocol = undefined,   // a seam for the suites (callCaptionPlan's `opts.pageProtocol`)
} = {}) {
  let stream = null;
  let rec = null;
  let offs = [];
  const plan = callCaptionPlan(row, mode, pageProtocol !== undefined ? { pageProtocol } : {});

  function build() {
    const opts = {
      plan, capture: true, phoneStreams: () => (stream ? [stream] : []),
      // Nothing heard on a call is ever a command.
      actsOn: () => false, wakeSays: null, micId: 'call-captions',
      ...(makeContext !== undefined ? { makeContext } : {}),
      ...(WebSocketImpl !== undefined ? { WebSocketImpl } : {}),
    };
    rec = recognizer(opts);
    if (typeof rec.onCaption === 'function') {
      offs.push(rec.onCaption((c) => {
        if (!c || !sink) return;
        const name = (() => { try { return who() || null; } catch { return null; } })();
        // The caller's name, sure: we know who is on the other end of this call.
        const out = { ...c, id: `call-${c.id}`, ear: 'call', source: 'call', others: [],
                      speaker: name ? { name, confidence: 1 } : null };
        try { sink.caption(out); } catch (err) { console.error('call captions', err); }
      }));
    }
    if (typeof rec.onStatus === 'function' && typeof onStatus === 'function') offs.push(rec.onStatus(onStatus));
    rec.start(() => {});     // commands: none
  }

  return {
    plan,
    start(s) {
      if (!s || s === stream) return;
      stream = s;
      if (!plan.passes.length) return;      // nothing to send it to: said by status(), nothing opened
      if (!rec) build();
      else rec.sourcesChanged?.();
    },
    stop() {
      stream = null;
      offs.splice(0).forEach((off) => { try { off?.(); } catch { /* gone */ } });
      if (rec) { try { rec.stop(); } catch { /* gone */ } }
      rec = null;
    },
    status() {
      if (!plan.passes.length) return { state: 'no-recogniser', skipped: plan.skipped };
      return rec?.status?.() || { state: 'stopped' };
    },
  };
}

// ---- ALL OF A CALL'S SUBTITLES ON A SCREEN, IN ONE PLACE (row 2.144, 2026-10-31) -----------------------------------------
// Until now this lived in kiosk.js and only the call view (a call answered over the panels) had it; a Call panel on a
// dashboard showed none. Both now use this, so the two cannot drift:
//   INCOMING made here    plan.captions 'here' | 'any': the far end's stream, captioned by this computer (createCallCaptions)
//   INCOMING they sent    plan.theirCaptions 'theirs' | 'ours': subtitles the other end made of its own voice, on the
//                         call's words channel. 'theirs' (Mike's both-on rule): this screen's own of them stop at the first.
//   OUTGOING made here    plan.ownCaptions 'here' | 'any': this end's microphone, captioned here and SENT (`startOwn`, once
//                         the call has a microphone track). Nothing of it is shown here; it is the other end's to show.
// The caption box (subtitles.js) is made inside `host` on the first line to show, placed against `host` rather than the
// window, and goes with `stop()`. `plan` is call_loadouts.js `callSubtitlesPlan` (the person's choice, else the screen's).
// `live()`: false once the call this belongs to is over (anything still arriving does nothing).
//
// ASKING AND BEING ASKED (row 2.144 step 3, 2026-11-01; call_caption_ask.js argues all of it):
//   ASKS    once the call is answered (`answered`), when this end wants subtitles of the other person and prefers theirs
//           (screenShouldAsk). Whatever the answer, or none, its own (if any) keep going until theirs actually arrive.
//   ASKED   the other end asks for subtitles of what is said here: already sending -> yes; cannot (no speech program
//           known here, no microphone in the call) -> cannot; its person chose off, or said "Never" to this asker -> no;
//           said "Always" -> yes; otherwise a box in `host` asks, and goes by itself (nothing is sent without a yes).
//           A yes starts this end's own subtitles (as OUTGOING above) where the plan says they are worked out (`ownWhere`).
//   `askKey` / `askName`: who the other end is (call_caption_ask.js askKeyOf) and what to call them. `answers`:
//   `{ get(), set(map) }` over the remembered answers (this end's person's row), or null (then only Yes and No).
//   `able()`: false when this computer is known to have no speech program (nothing could be made).
//   A SWITCH REACHES THE BOX (2026-11-01, call_caption_ask.js argues it): while it is up `asking()` is true and the host
//   hands its walk to `askVerb(v)` (next / prev / select / back) instead of its own; `onAsking(on)` says when the box comes
//   and goes, so the host can put its own lit look away meanwhile and back after. The host's own walk is never changed.
//
// *** GROUP CALLS (row 2.144 step 4, 2026-11-01). *** A call with more than two people (call_group.js: the call that rang
// this screen, plus one connection straight to each other person). Everything above happens PER PERSON:
//   INCOMING made here    ONE RECOGNISER PER OTHER PERSON, each fed only that person's own sound and labelled with their
//                         name. What the recogniser allows, checked (speech_engines.js `rankedRecognizer`): it takes any
//                         number of remote streams, each its own "ear" with its own connection to the speech program, and
//                         the speech program takes any number of connections (web/speech_service: one utterance at a time
//                         per connection, decoded one after another). BUT one recogniser PAIRS utterances from different
//                         ears that overlap or come within PAIR_MS (500 ms) of each other, as ONE utterance heard twice -
//                         right for one voice on two microphones, wrong for two people talking at once, where it would
//                         keep one person's words and drop the other's. So each person gets a recogniser of their own.
//                         Nothing is ever mixed: in a mesh every person's sound arrives on its own connection, so the
//                         "only the mixed sound, labelled as the call" case does not arise here (it would with a relay
//                         that mixes, which is not built - call_relay.py). The cost: an audio context and a connection to
//                         each engine per person, at most MESH_MAX_OTHERS of them [unmeasured on the bench Pi, like the
//                         mesh cap itself]; the speech program decodes them in turn, so with several people talking the
//                         words come later, never mixed up.
//   INCOMING they sent    labelled by the connection they came on (the call that rang: `who()`; anybody else: the server's
//                         name for them, call_group.js), never by anything inside the message. Mike's both-on rule is per
//                         person too: Sam sending his own stops this screen's subtitles OF SAM, nobody else's.
//   OUTGOING made here    one recogniser of this room, as before. Chosen ("Send subtitles of what is said here", or the
//                         person's own "Send subtitles of what I say"): to EVERYBODY in the call. Started by a yes to a
//                         request: to the people who got that yes, and nobody else.
//   THE BOX               one subtitles.js box, lines labelled per speaker, at its own line limit (the screen's
//                         "Subtitles: lines on screen", 1 to 6, default 3): no new number, and it cannot grow.
//   ASKING / ASKED        each other person asked once, each answered on their own connection (call_caption_ask.js header
//                         argues one box for everybody asking at once, `createAskDesk`).
export function attachCallSubtitles({
  transport = null, host = null, plan = {}, row = {}, who = () => null, live = () => true,
  recognizer = undefined, flashLimit = undefined,
  makeSubtitles = createSubtitles, makeCaptions = createCallCaptions,
  askKey = '', askName = '', answers = null, able = () => true,
  setTimer = undefined, clearTimer = undefined, askShowMs = CAPTION_ASK_SHOW_MS,
  onAsking = null,
} = {}) {
  // THE ENDS: the call that rang this screen ('call') and each other person in a group call (`peer:<id>`).
  const CALL = 'call';
  const keyOf = (peer) => `peer:${peer}`;
  const peerOf = (key) => (typeof key === 'string' && key.startsWith('peer:') ? key.slice(5) : null);
  let subs = null;
  const incoming = new Map();    // end -> { caps, stream } : subtitles of that person, made here
  const theirsCame = new Set();  // ends whose own subtitles arrived (Mike's both-on rule): ours of them stopped, not restarted
  let own = null;                // outgoing, made here
  let ownBy = null;              // 'choice' (to everybody) | 'ask' (to those who said yes)
  const yesTo = new Set();       // ends this end said yes to
  let micTrack = null;           // the microphone track the call was answered with (`answered`)
  let askedAll = false;          // we asked (once per call)
  const askedOf = new Map();     // end -> 'sent' | their answer
  let stopped = false;
  const offs = [];
  const ok = () => { if (stopped) return false; try { return live() !== false; } catch { return false; } };
  const name = () => { try { return who() || 'On the call'; } catch { return 'On the call'; } };
  const ableNow = () => { try { return able() !== false; } catch { return true; } };
  const timers = { ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}) };
  const rec = recognizer ? { recognizer } : {};
  const group = (() => { try { return transport?.group?.() || null; } catch { return null; } })();
  // The call that rang is still connected (false once its caller left and the group carried on). A transport that does
  // not say is the two-person call, connected while it lasts.
  const legOn = () => { try { return typeof transport?.legOn === 'function' ? !!transport.legOn() : true; } catch { return true; } };
  const tiles = () => { try { return group?.tiles?.() || []; } catch { return []; } };
  const nameOfEnd = (key, fallback = '') => {
    if (key === CALL) return name();
    const t = tiles().find((x) => keyOf(x.peer) === key);
    return (t && t.name) || fallback || 'Someone on the call';
  };
  // A line's id, kept apart per person: two recognisers (and two people's pages) number their lines the same way.
  // The call that rang keeps the ids it always had.
  const lineId = (prefix, key, id) => (key === CALL ? `${prefix}-${id}` : `${prefix}-${id}@${peerOf(key)}`);

  function box() {
    if (subs || !host) return subs;
    subs = makeSubtitles(host, {
      settings: { ...(row || {}), subtitlesOn: true, subtitlesScreen: false },
      ...(flashLimit !== undefined ? { flashLimit } : {}),
    });
    subs.setOn?.(true);
    // Inside the call's own box, not across the whole screen (subtitles.css places a box against the window).
    const b = host.querySelector?.('.subs');
    if (b) { b.style.position = 'absolute'; b.style.width = '92%'; b.style.zIndex = '2'; }
    return subs;
  }

  // ---- INCOMING, MADE HERE: one recogniser per other person (see the header) ----
  const wantIncoming = !!plan.captions && plan.captions !== 'off';
  function incomingFor(key, stream) {
    if (!wantIncoming || theirsCame.has(key) || !ok()) return null;
    let e = incoming.get(key);
    if (!e) {
      box();
      const sink = key === CALL ? subs : { caption: (c) => {
        if (!c || !subs) return;
        try { subs.caption({ ...c, id: `${c.id}@${peerOf(key)}` }); } catch (err) { console.error('call subtitles: incoming', err); }
      } };
      e = { caps: makeCaptions({ row, mode: plan.captions, sink, ...rec, who: () => nameOfEnd(key) }), stream: null };
      incoming.set(key, e);
    }
    if (stream && stream !== e.stream) { e.stream = stream; e.caps.start(stream); }
    return e;
  }
  function stopIncoming(key) {
    const e = incoming.get(key);
    if (!e) return;
    incoming.delete(key);
    try { e.caps.stop(); } catch { /* gone */ }
  }
  const incomingRunning = (key) => {
    const e = incoming.get(key);
    if (!e) return false;
    try { return !['no-recogniser', 'stopped'].includes(e.caps.status?.()?.state); } catch { return false; }
  };
  if (wantIncoming) {
    try {
      incomingFor(CALL, transport?.remote?.() || null);
      offs.push(transport?.onRemote?.((s) => {
        if (!ok()) return;
        if (s) incomingFor(CALL, s);
        else if (!legOn()) stopIncoming(CALL);       // the caller who rang left; the group carries on
      }) || (() => {}));
    } catch (err) { console.error('call subtitles: incoming', err); }
  }
  const hasAudio = (s) => { try { return (s?.getAudioTracks?.() || []).length > 0; } catch { return false; } };
  // The group's people as they come and go: each one's own sound to their own recogniser; gone, theirs stops.
  function followGroup() {
    if (!group || !ok()) return;
    const here = new Set();
    for (const t of tiles()) {
      const key = keyOf(t.peer);
      here.add(key);
      if (t.stream && hasAudio(t.stream)) incomingFor(key, t.stream);
      else stopIncoming(key);       // their connection is lost (or not up yet): nothing to listen to
    }
    for (const key of [...incoming.keys()]) if (key !== CALL && !here.has(key)) stopIncoming(key);
    for (const key of [...yesTo]) if (key !== CALL && !here.has(key)) yesTo.delete(key);
    for (const key of [...askedOf.keys()]) if (key !== CALL && !here.has(key)) askedOf.delete(key);
    for (const key of desk.waiting()) if (key !== CALL && !here.has(key)) desk.gone(key);
  }

  // ---- INCOMING, THEY SENT: per person, labelled by the connection it came on ----
  function theirs(key, c, speakerName) {
    if (!ok() || !c || !c.text) return;
    if (plan.theirCaptions === 'ours' && incomingRunning(key)) return;
    if (plan.theirCaptions === 'theirs' && incoming.has(key)) { stopIncoming(key); }
    if (plan.theirCaptions === 'theirs') theirsCame.add(key);
    try {
      box()?.caption({ id: lineId('their', key, c.id), text: c.text, ear: 'call', source: 'call', others: [],
        speaker: { name: speakerName || nameOfEnd(key), confidence: 1 } });
    } catch (err) { console.error('call subtitles: theirs', err); }
  }
  if (plan.theirCaptions && plan.theirCaptions !== 'none') {
    try {
      offs.push(transport?.onCaptions?.((c) => theirs(CALL, c, name())) || (() => {}));
      if (group) offs.push(group.onCaptions?.((c) => { if (c && c.peer) theirs(keyOf(c.peer), c, c.name || null); }) || (() => {}));
    } catch (err) { console.error('call subtitles: theirs', err); }
  }

  /**
   * Outgoing: caption `track` (this end's plain microphone; absent, the call's own audio track as it is sent now) and
   * send each line on the call's words channels - to everybody when chosen, else to those who said yes. Not while a board
   * word's clip plays into the call: that word went as text already. True when it started. NOT YET: a microphone changed
   * mid-call is not followed.
   */
  function startOwn(track = null) {
    if (track) micTrack = track;
    if (!plan.ownCaptions || plan.ownCaptions === 'off') return false;
    return startOwnAs(plan.ownCaptions, track, 'choice');
  }
  const ownTrack = (track = null) => track || micTrack
    || (transport?.sending?.() || []).find((x) => x && x.kind === 'audio') || null;
  const sendsTo = (key) => !!own && (ownBy === 'choice' || yesTo.has(key));
  function sendOwn(c) {
    if (!ok() || !c || !c.text) return;
    if (transport?.clipPlaying?.()) return;
    const msg = { id: c.id, text: c.text, final: !!c.final };
    if (sendsTo(CALL)) { try { transport?.sendCaption?.(msg); } catch (err) { console.error('call subtitles: own', err); } }
    if (group) {
      const to = ownBy === 'choice' ? null : [...yesTo].map(peerOf).filter(Boolean);
      if (to === null || to.length) { try { group.sendCaption?.(msg, to); } catch (err) { console.error('call subtitles: own (group)', err); } }
    }
  }
  function startOwnAs(mode, track = null, by = 'choice') {
    if (!ok()) return false;
    if (own) { if (by === 'choice') ownBy = 'choice'; return false; }
    try {
      const t = ownTrack(track);
      if (!t || typeof MediaStream === 'undefined') return false;
      own = makeCaptions({ row, mode, ...rec, sink: { caption: sendOwn } });
      ownBy = by;
      own.start(new MediaStream([t]));
      return true;
    } catch (err) { console.error('call subtitles: own', err); own = null; ownBy = null; return false; }
  }

  // ---- ASKING EACH OTHER PERSON, AND ANSWERING EACH ONE'S ASKING (steps 3 and 4; see the headers) ----
  const ownWhere = plan.ownWhere === 'any' ? 'any' : 'here';
  function askOther() {
    if (!ok() || askedAll) return false;
    let oursCan = false;
    try {
      oursCan = ableNow() && [...incoming.values()].some((e) => e.caps.status?.()?.state !== 'no-recogniser');
    } catch { oursCan = false; }
    if (!screenShouldAsk(plan, oursCan)) return false;
    let sent = false;
    if (legOn()) {
      try { sent = !!transport?.askCaptions?.(); } catch (err) { console.error('call subtitles: asking', err); }
      if (sent) askedOf.set(CALL, 'sent');
    }
    let sentGroup = false;
    if (group) { try { sentGroup = !!group.askCaptions?.(); } catch (err) { console.error('call subtitles: asking (group)', err); } }
    askedAll = sent || sentGroup;
    return askedAll;
  }
  const answerOn = (key, a) => {
    if (key === CALL) return !!transport?.answerCaptions?.(a);
    return !!group?.answerCaptions?.(peerOf(key), a);
  };
  const desk = createAskDesk({
    host, live: ok, showMs: askShowMs, ...timers, onAsking,
    words: (names) => askWords({ names, at: 'screen', where: ownWhere }),
    // Over the top of the call's own box, clear of the subtitles at the bottom; the call goes on under it.
    style: 'position:absolute;top:8px;left:50%;transform:translateX(-50%);width:min(92%,640px);box-sizing:border-box;'
      + 'z-index:3;padding:12px 14px;border-radius:12px;background:var(--surface,#fff);color:var(--text,#111);'
      + 'box-shadow:0 2px 12px rgba(0,0,0,.25);font-size:clamp(15px,1.6vw,20px);line-height:1.35',
    decide: ({ key, rememberKey }) => {
      let canMake = false;
      try { canMake = !!own || (!!ownTrack() && ableNow() && callCaptionPlan(row, ownWhere).passes.length > 0); } catch { canMake = false; }
      let remembered = null;
      try { remembered = rememberKey ? rememberedFor(answers?.get?.(), rememberKey) : null; } catch { remembered = null; }
      return answerFor({ running: sendsTo(key), able: canMake, remembered,
        chosenOff: plan.decided?.out === 'person' && plan.ownCaptions === 'off' });
    },
    reply: (key, answer, again) => {
      let a = answer;
      if (a === 'yes' && !again) {
        if (!own && !startOwnAs(ownWhere, null, 'ask')) a = 'cannot';
        else yesTo.add(key);
      }
      try { answerOn(key, a); } catch (err) { console.error('call subtitles: answering', err); }
      return a;
    },
    remember: answers && typeof answers.set === 'function' ? (askers, r) => {
      let m = answers.get?.();
      for (const x of askers) m = withRemembered(m, x.rememberKey, r, x.name);
      answers.set(m);
    } : null,
  });
  function heardAsk(key, m, speakerName) {
    if (!ok() || !m) return;
    if (m.answer) { if (askedOf.has(key) || (key !== CALL && askedAll)) askedOf.set(key, m.answer); return; }
    if (!m.ask) return;
    const isCall = key === CALL;
    // Who to remember an "Always" / "Never" by: the call that rang, by who placed it; a member of the group, by the key
    // the server gave them (call_caption_ask.js header). '' (an older server): Yes and No only.
    desk.heard({ key, name: isCall ? (askName || '') : (speakerName || nameOfEnd(key)),
      rememberKey: isCall ? (askKey || '') : (typeof m.key === 'string' ? m.key : '') });
  }
  try {
    offs.push(transport?.onCaptionAsks?.((m) => heardAsk(CALL, m, null)) || (() => {}));
    if (group) offs.push(group.onCaptionAsks?.((m) => { if (m && m.peer) heardAsk(keyOf(m.peer), m, m.name || null); }) || (() => {}));
  } catch (err) { console.error('call subtitles: asks', err); }
  if (group) {
    try { offs.push(group.onChange?.(() => followGroup()) || (() => {})); followGroup(); }
    catch (err) { console.error('call subtitles: the group', err); }
  }

  /** The call is answered: this end's own subtitles start (when chosen), and the other people are asked (when wanted). */
  function answered(track = null) {
    const started = startOwn(track);
    askOther();
    return started;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    offs.splice(0).forEach((off) => { try { off?.(); } catch { /* gone */ } });
    desk.close();
    for (const key of [...incoming.keys()]) stopIncoming(key);
    try { own?.stop(); } catch { /* gone */ }
    try { subs?.destroy?.(); } catch { /* gone */ }
    own = null; ownBy = null; subs = null; micTrack = null;
    yesTo.clear(); askedOf.clear(); theirsCame.clear();
  }

  return {
    answered, startOwn, askOther, stop, plan,
    // A switch's walk while a request is up (see the header): whether it is up, and one verb for it.
    asking: () => desk.asking(),
    askVerb: (v) => desk.verb(v),
    // For the suites and the host: what is running now. `asked` / `answered`: the call that rang, as before; `askedBy` /
    // `answeredBy` / `incomingFor` / `sendsTo`: per person (row 2.144 step 4).
    probe: () => ({ box: !!subs, incoming: incoming.size > 0, own: !!own, stopped,
      asked: askedOf.get(CALL) ?? null, answered: desk.answered(CALL),
      prompt: desk.asking(), askLit: desk.lit(),
      ownBy, incomingFor: [...incoming.keys()], askedBy: Object.fromEntries(askedOf),
      answeredBy: Object.fromEntries([CALL, ...tiles().map((t) => keyOf(t.peer))].map((k) => [k, desk.answered(k)]).filter(([, v]) => v)),
      sendsTo: [CALL, ...tiles().map((t) => keyOf(t.peer))].filter((k) => sendsTo(k)),
      waiting: desk.waiting() }),
  };
}
