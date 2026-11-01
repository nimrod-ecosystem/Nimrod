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
export function attachCallSubtitles({
  transport = null, host = null, plan = {}, row = {}, who = () => null, live = () => true,
  recognizer = undefined, flashLimit = undefined,
  makeSubtitles = createSubtitles, makeCaptions = createCallCaptions,
} = {}) {
  let subs = null;
  let captions = null;           // incoming, made here
  let own = null;                // outgoing, made here
  let stopped = false;
  const offs = [];
  const ok = () => { if (stopped) return false; try { return live() !== false; } catch { return false; } };
  const name = () => { try { return who() || 'On the call'; } catch { return 'On the call'; } };
  const rec = recognizer ? { recognizer } : {};

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

  if (plan.captions && plan.captions !== 'off') {
    try {
      box();
      captions = makeCaptions({ row, mode: plan.captions, sink: subs, ...rec, who: name });
      const now = transport?.remote?.();
      if (now) captions.start(now);
      offs.push(transport?.onRemote?.((s) => { if (ok() && s) captions?.start(s); }) || (() => {}));
    } catch (err) { console.error('call subtitles: incoming', err); }
  }

  if (plan.theirCaptions && plan.theirCaptions !== 'none') {
    try {
      offs.push(transport?.onCaptions?.((c) => {
        if (!ok() || !c || !c.text) return;
        const oursRunning = !!captions && !['no-recogniser', 'stopped'].includes(captions.status?.()?.state);
        if (plan.theirCaptions === 'ours' && oursRunning) return;
        if (captions && plan.theirCaptions === 'theirs') { try { captions.stop(); } catch { /* gone */ } captions = null; }
        try {
          box()?.caption({ id: `their-${c.id}`, text: c.text, ear: 'call', source: 'call', others: [],
            speaker: { name: name(), confidence: 1 } });
        } catch (err) { console.error('call subtitles: theirs', err); }
      }) || (() => {}));
    } catch (err) { console.error('call subtitles: theirs', err); }
  }

  /**
   * Outgoing: caption `track` (this end's plain microphone; absent, the call's own audio track as it is sent now) and
   * send each line on the call's words channel. Not while a board word's clip plays into the call: that word went as
   * text already. True when it started. NOT YET: a microphone changed mid-call is not followed.
   */
  function startOwn(track = null) {
    if (!ok() || own || !plan.ownCaptions || plan.ownCaptions === 'off') return false;
    try {
      const t = track || (transport?.sending?.() || []).find((x) => x && x.kind === 'audio');
      if (!t || typeof MediaStream === 'undefined') return false;
      own = makeCaptions({ row, mode: plan.ownCaptions, ...rec, sink: { caption: (c) => {
        if (!ok() || !c || !c.text) return;
        if (transport?.clipPlaying?.()) return;
        try { transport?.sendCaption?.({ id: c.id, text: c.text, final: !!c.final }); } catch (err) { console.error('call subtitles: own', err); }
      } } });
      own.start(new MediaStream([t]));
      return true;
    } catch (err) { console.error('call subtitles: own', err); own = null; return false; }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    offs.splice(0).forEach((off) => { try { off?.(); } catch { /* gone */ } });
    try { captions?.stop(); } catch { /* gone */ }
    try { own?.stop(); } catch { /* gone */ }
    try { subs?.destroy?.(); } catch { /* gone */ }
    captions = null; own = null; subs = null;
  }

  return {
    startOwn, stop, plan,
    // For the suites and the host: what is running now.
    probe: () => ({ box: !!subs, incoming: !!captions, own: !!own, stopped }),
  };
}
