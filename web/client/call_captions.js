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

// The plan for the call's ear, from the screen's (or person's) speech row. Pure.
//   mode 'here': local passes only (remote passes are dropped, and said in `skipped`).
export function callCaptionPlan(row, mode = 'here') {
  const base = enginePlanFrom(row || {});
  if (base.browser) {
    // The browser's own recogniser is the first pass: it cannot take the call's stream. The local service is
    // still asked, at its default or chosen address - it may be running even when commands use the browser.
    const local = enginePlanFrom({ ...(row || {}), speechEngine: 'local' });
    return finish(local, mode, [{ slot: 'browser', name: 'The browser’s recogniser', why: 'cannot hear a call' }]);
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
} = {}) {
  let stream = null;
  let rec = null;
  let offs = [];
  const plan = callCaptionPlan(row, mode);

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
