// call_outgoing_captions.js - SUBTITLES OF WHAT I SAY, MADE HERE AND SENT TO THE OTHER END (row 2.144, 2026-10-28).
//
// Mike, 2026-10-27: "We should add subtitles to calls. Maybe have it be something that can be computed at either
// end. You could choose to have subtitles on your outgoing and/or incoming calls." And the rule: "computed at
// whoever's end has them turned on. If they both have them on, have it default to outgoing in case someone had their
// AI learn their voice." This is the OUTGOING half, on the call page (a phone or a computer calling a screen):
//   * the speaker's own browser recogniser listens to the speaker's own microphone - it needs nothing installed, so
//     it works on a phone - and every guess goes to the other end on the call's words channel
//     (call_transport.js `sendCaption`), the same line corrected in place as the guess improves;
//   * the INCOMING half already exists on screens (call_captions.js: the far end's sound, turned into words on the
//     screen's own computer). When both are on, the screen uses these (kiosk.js, `callTheirCaptions`).
//
// *** OFF BY DEFAULT, AND SAID PLAINLY WHY. *** The browser's recogniser is not on this device: in Chrome it sends
// the voice to Google's speech service to be turned into words [training knowledge; Safari does some languages on
// the device]. Sending a person's voice to a company has to be that person's own choice, so nothing here starts
// until they turn it on, and the words beside the switch say where the voice goes (CAPTIONS_OUT_NOTE). The case for
// on: somebody whose listener is hard of hearing would want it without hunting. It is one tick on the call page, and
// it is remembered on that device.
//
// THE MICROPHONE IS SHARED WITH THE CALL. On a computer the recogniser and the call both hear it. On an Android phone
// the recogniser may not get the microphone while the call holds it [training knowledge, not measured]: then this
// says so in words ('no-mic') and the call goes on exactly as before. It never touches the call's own sound.
//
// NOTHING IS KEPT: each guess is sent and shown, and nothing is written anywhere.

export const CAPTIONS_OUT_KEY = 'nimrod:call:captions-out';
export const CAPTIONS_OUT_DEFAULT = 'off';
// Site copy: names nobody.
export const CAPTIONS_OUT_LABEL = 'Send subtitles of what I say';
export const CAPTIONS_OUT_NOTE = 'Your browser turns what you say into words and sends them to the screen you call. '
  + 'In Chrome that means Google’s speech service hears your voice. Nothing is kept.';
export const CAPTIONS_OUT_SAYS = Object.freeze({
  unsupported: 'This browser cannot turn speech into words, so no subtitles of you are sent.',
  refused: 'Subtitles of you stopped: this browser was not allowed to listen for them.',
  'no-mic': 'Subtitles of you stopped: the browser could not use the microphone for them during the call.',
});
// The pause before the recogniser is started again after it stops by itself (it does, on silence and every minute
// or so). 400 ms, argued: soon enough that a sentence started straight after is mostly caught, long enough that a
// recogniser failing at once cannot spin. Not a person's setting: nobody can judge it from a menu.
export const CAPTIONS_OUT_RESTART_MS = 400;

/** Whether this browser has a recogniser at all. */
export function captionsOutSupported(view = (typeof window !== 'undefined' ? window : null)) {
  return !!(view && (view.SpeechRecognition || view.webkitSpeechRecognition));
}

/** 'on' | 'off' as remembered on this device (anything else is the default). Pure. */
export function captionsOutChoice(stored) {
  return stored === 'on' || stored === 'off' ? stored : CAPTIONS_OUT_DEFAULT;
}

/**
 * One call's outgoing subtitles.
 *   send({ id, text, final })   where each guess goes (call_transport.js `sendCaption`)
 *   onMine({ id, text, final }) the same guess, for the speaker's own line on their page
 *   onState(state)              'listening' | 'off' | 'unsupported' | 'refused' | 'no-mic'
 * start() / stop() / state(). `Recognition` is a seam for the suites (the browser's SpeechRecognition shape).
 */
export function createOutgoingCaptions({
  send = () => false, onMine = null, onState = null,
  view = (typeof window !== 'undefined' ? window : null),
  Recognition = (view && (view.SpeechRecognition || view.webkitSpeechRecognition)) || null,
  lang = (typeof document !== 'undefined' && document.documentElement?.lang)
    || (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  restartMs = CAPTIONS_OUT_RESTART_MS,
} = {}) {
  let rec = null;
  let want = false;
  let now = 'off';
  let pass = 0;            // the recogniser numbers its results from 0 each time it starts: the pass keeps ids apart
  let again = null;

  const say = (s) => {
    if (now === s) return;
    now = s;
    try { onState?.(s); } catch (err) { console.error('outgoing captions: state', err); }
  };
  const stopFor = (s) => {
    want = false;
    if (again != null) { clearTimer(again); again = null; }
    if (rec) { const r = rec; rec = null; try { r.onend = null; r.abort?.(); } catch { /* gone */ } }
    say(s);
  };

  function open() {
    let r;
    try { r = new Recognition(); } catch { stopFor('unsupported'); return; }
    rec = r;
    pass += 1;
    const mine = pass;
    r.lang = lang;
    r.continuous = true;
    // INTERIM RESULTS ON, unlike the command recogniser (input_speech.js, which must not act on half a word): a
    // subtitle is only shown, and showing the fast guess then correcting it in place is what subtitles do here.
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      if (rec !== r) return;
      for (let i = e.resultIndex || 0; i < (e.results?.length || 0); i++) {
        const res = e.results[i];
        const text = String(res?.[0]?.transcript || '').trim();
        if (!text) continue;
        const c = { id: `me${mine}-${i}`, text, final: !!res.isFinal };
        try { send(c); } catch (err) { console.error('outgoing captions: send', err); }
        try { onMine?.(c); } catch (err) { console.error('outgoing captions: mine', err); }
      }
    };
    r.onerror = (e) => {
      const why = e && e.error;
      if (why === 'not-allowed' || why === 'service-not-allowed') stopFor('refused');
      else if (why === 'audio-capture') stopFor('no-mic');
      // 'no-speech', 'aborted', 'network': it ends, and onend starts it again.
    };
    r.onend = () => {
      if (rec !== r || !want) return;
      again = setTimer(() => { again = null; if (want && rec === r) open(); }, restartMs);
    };
    try { r.start(); say('listening'); } catch { stopFor('refused'); }
  }

  return {
    start() {
      if (want) return;
      if (!Recognition) { say('unsupported'); return; }
      want = true;
      open();
    },
    stop() { stopFor('off'); },
    state: () => now,
  };
}
