// output_channels.js - the ways of reaching a person. One adapter per channel.
//
// An adapter's whole job is to make one message happen and say when it is over. It makes
// no decisions about WHETHER to - no priorities, no routing, no arbitration. Those live
// in output.js so every channel gets them identically, exactly as every input device
// gets the same timing and gating from input.js.
//
// THE CONTRACT is deliberately loose, because the three channels finish in three
// different ways and forcing one shape on them would be a lie:
//
//   present(item, { done })  ->  a cancel function, OR a promise, OR nothing
//     concurrency            how many of these can happen at once
//
// Speech resolves when the voice stops. A banner resolves on a timer. A tone resolves
// almost immediately. `cancel` is what makes preemption real: if a channel cannot be
// interrupted, an alert has to wait behind a long sentence, which is the failure the
// whole priority system exists to prevent.
//
// CONCURRENCY IS NOT A TUNING KNOB, it is a fact about the person. There is one pair of
// ears, so speech is 1 - and Cici learned that the expensive way, with two modules
// talking over each other producing not twice the information but none. Eyes can take a
// short stack, so a screen is 3.

import { speak, cancel as cancelSpeech } from './voice.js';
import { createRemoteChannel } from './output_remote.js';

// ---------------------------------------------------------------------------------
// SPEECH - the one that must be exclusive.
// ---------------------------------------------------------------------------------
export function createSpeechChannel({
  pref = () => ({}),
  synth = null,
  Utterance = null,
  // *** THE SPEAKER ARBITER. *** Without it a spoken cue lands UNDER whatever music is
  // already playing, which is the one thing "there is one pair of ears" was about. With it,
  // speaking marks the `voice` tier active and every media source ducks for the sentence.
  // Optional: no bus means no ducking, never no speech.
  audio = null,
  audioId = 'speech',
  // *** ROW 2.35: THE AAC BOARD'S WORDS ARE THEIR OWN MIXER CHANNEL. *** A message whose `source` is
  // listed here is a person talking through the board, not the screen prompting, so it plays on the
  // audio bus's `aac` channel - with that channel's fader and its minimum (60% by default), so a
  // "quieter" meant for the video can never bury her words. Everything else stays on `voice`.
  aacSources = ['board'],
  // *** WHEN THE SCREEN IS TALKING (screen_speech.js, 2026-10-04). *** Marked at exactly the points the
  // voice tier is marked active and released below, so the voice recorder and the recogniser know what the
  // microphone heard was the screen. The board's words too: they come out of the same speaker. Optional:
  // none means nothing is marked, never no speech.
  screenSpeech = null,
  // A hard stop, because speechSynthesis does not always fire `onend` - a canceled or
  // interrupted utterance can leave the channel believing it is still speaking forever,
  // and then nothing is ever said again. Same disease as the input bus's stuck switch,
  // same cure: a watchdog with a generous ceiling.
  maxMs = 30000,
  // Row 2.27: and a shorter way out than the watchdog. An engine that reports `speaking` is
  // watched; once it has been seen speaking and then goes quiet with nothing queued, the
  // utterance is over whether or not `onend` ever arrives. Never before it was seen speaking,
  // so a slow start is not mistaken for an end. 0 turns the watching off.
  pollMs = 250,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  // own board clips (2026-10-09): A WORD WITH A RECORDED SOUND IS SAID IN THAT SOUND. `item.data.clips` is a list of
  // URLs, best first (board_sounds.js clipChoices: the card's own sound, then the shipped clip); each is tried in turn
  // and the synthesiser speaks only when none of them plays. Through THIS channel rather than an <audio> the board
  // plays itself, so everything a spoken word gets, a recorded one gets too: one word at a time, the music ducked, the
  // aac channel's level, the screen marked as talking (so the voice recorder never keeps it as the person), and the
  // subtitles. A clip that fails with an error (missing, will not decode) is remembered and not asked for again this
  // visit - most words have no shipped clip, and the word should not wait on a missing file every time.
  // `makeAudio` is the seam a suite uses instead of a real <audio>; null turns clips off (synthesiser only).
  makeAudio = (typeof Audio !== 'undefined' ? () => new Audio() : null),
} = {}) {
  const missingClips = new Set();
  // The voice tier itself makes no sound of its own - it exists so everything else can hear
  // that it is talking. No onGain: nothing ducks a voice.
  audio?.register?.(audioId, { tier: 'voice' });
  const aacId = `${audioId}-aac`;
  audio?.register?.(aacId, { tier: 'voice', channel: 'aac' });
  const isAac = (item) => !!(item && item.source && Array.isArray(aacSources) && aacSources.includes(item.source));

  // The level to speak at. The mixer's channel level when the bus has one (fader x master, lifted
  // to the channel's floor); the master alone on an older bus. Anything that goes wrong is full
  // volume - for her words above all.
  function levelFor(aac) {
    try {
      if (typeof audio.channelLevel === 'function') return Number(audio.channelLevel(aac ? 'aac' : 'voice'));
      return Number(audio.master());
    } catch { return 1; }
  }

  // own board clips (2026-10-09): the clips this word may be said in, minus the ones already found missing.
  function clipsOf(item) {
    const list = item && item.data && Array.isArray(item.data.clips) ? item.data.clips : [];
    return typeof makeAudio === 'function'
      ? list.filter((u) => typeof u === 'string' && u && !missingClips.has(u)) : [];
  }

  // own board clips: each clip in turn; the voice when none plays. Marked, ducked and bounded exactly like speech.
  function viaClips(item, clips, done) {
    const aac = isAac(item);
    const sid = aac ? aacId : audioId;
    let volume = 1;
    if (audio && (typeof audio.channelLevel === 'function' || typeof audio.master === 'function')) {
      const m = levelFor(aac);
      volume = Number.isFinite(m) ? Math.max(0, Math.min(1, m)) : 1;
    }
    audio?.setActive?.(sid, true);
    let said = null;
    try { said = screenSpeech?.begin?.(item.text) ?? null; } catch (err) { console.error('speech: screen speech', err); }
    const quiet = () => {
      audio?.setActive?.(sid, false);
      if (said !== null) { try { screenSpeech?.end?.(said); } catch (err) { console.error('speech: screen speech', err); } said = null; }
    };
    let finished = false;          // over: played, cancelled, or handed to the voice
    let el = null;
    let handed = null;             // the voice's cancel, once this word went to the synthesiser
    const stopEl = () => { const a = el; el = null; if (a) { try { a.pause(); } catch { /* stopped */ } } };
    const guard = setTimer(() => end(), maxMs);
    function end() { if (finished) return; finished = true; clearTimer(guard); stopEl(); quiet(); done(); }
    function toVoice() {
      if (finished) return;
      finished = true; clearTimer(guard); stopEl(); quiet();
      const rest = { ...item, data: { ...(item.data || {}), clips: [] } };
      const c = channel.present(rest, { done });
      handed = typeof c === 'function' ? c : null;
    }
    function attempt(i) {
      if (finished) return;
      if (i >= clips.length) { toVoice(); return; }
      const url = clips[i];
      let a;
      try { a = makeAudio(); } catch { toVoice(); return; }
      el = a;
      let moved = false;
      // `missing`: the file itself failed (an error event), so it is not asked for again. A refused play() (the
      // browser's autoplay rule) is not the file's fault and is tried again next time.
      const next = (missing) => {
        if (moved || finished || el !== a) return;
        moved = true;
        if (missing) missingClips.add(url);
        stopEl();
        attempt(i + 1);
      };
      try {
        a.addEventListener('error', () => next(true));
        a.addEventListener('ended', () => { if (!moved && el === a) { moved = true; end(); } });
        try { a.volume = volume; } catch { /* a fixed-volume element */ }
        a.src = url;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => next(false));
      } catch { next(false); }
    }
    attempt(0);
    return () => {                       // cancel
      if (handed) { const h = handed; handed = null; try { h(); } catch { /* gone */ } return; }
      if (finished) return;
      finished = true; clearTimer(guard); stopEl(); quiet();
    };
  }

  const channel = {
    name: 'speech',
    concurrency: 1,
    available: () => !!(synth || (typeof window !== 'undefined' && window.speechSynthesis)),
    present(item, { done }) {
      // own board clips (2026-10-09): a recorded sound first, when the word has one.
      const clips = clipsOf(item);
      if (clips.length) return viaClips(item, clips, done);
      const opts = {};
      if (synth) opts.synth = synth;
      if (Utterance) opts.Utterance = Utterance;
      // THE MASTER VOLUME (row 2.28/2.35). The voice registers with no `onGain` (nothing ducks a
      // voice), so it reads the master here instead - otherwise "quieter" would turn the video
      // down and leave the voice as loud as ever. The bus has already applied its floor; anything
      // that goes wrong reading it is full volume.
      // Row 2.35: the mixer's channel level instead, when the bus has channels - see levelFor.
      const aac = isAac(item);
      const sid = aac ? aacId : audioId;
      if (audio && (typeof audio.channelLevel === 'function' || typeof audio.master === 'function')) {
        const m = levelFor(aac);
        opts.volume = Number.isFinite(m) ? m : 1;
      }
      // A caller's OWN voice choice, carried through `data.voice`, wins over the person's
      // general preference — same shape `board.js`'s AAC voice picker already needs and
      // `educational.js`/`sprint.js` already had before this channel existed (a per-instance
      // `s.voice`, read from that module's own settings). Falls back to `pref()` exactly as
      // before when nothing more specific was asked for, so a caller that never sets it sees
      // no change at all.
      const v = (item.data && item.data.voice) || pref() || {};
      const u = speak(item.text, v, opts);
      if (!u) { done(); return null; }

      // Ducked for the sentence, and released on EVERY exit below - including the watchdog.
      // A voice tier left active because an utterance never fired `onend` would hold the
      // music down forever, which is the same stuck-switch disease the input bus has a
      // watchdog for, pointed at the speaker.
      audio?.setActive?.(sid, true);
      let said = null;
      try { said = screenSpeech?.begin?.(item.text) ?? null; } catch (err) { console.error('speech: screen speech', err); }
      const quiet = () => {
        audio?.setActive?.(sid, false);
        if (said !== null) { try { screenSpeech?.end?.(said); } catch (err) { console.error('speech: screen speech', err); } said = null; }
      };

      let finished = false;
      let watch = null;
      const stopWatch = () => { if (watch != null) { clearTimer(watch); watch = null; } };
      const guard = setTimer(() => { if (!finished) { finished = true; stopWatch(); quiet(); done(); } }, maxMs);
      const end = () => { if (finished) return; finished = true; clearTimer(guard); stopWatch(); quiet(); done(); };
      u.onend = end;
      u.onerror = end;

      const engine = synth || (typeof window !== 'undefined' ? window.speechSynthesis : null);
      if (pollMs > 0 && engine && typeof engine.speaking === 'boolean') {
        let seen = false;
        u.onstart = () => { seen = true; };
        const tick = () => {
          watch = null;
          if (finished) return;
          if (engine.speaking || engine.pending) seen = true;
          else if (seen) { end(); return; }
          watch = setTimer(tick, pollMs);
        };
        watch = setTimer(tick, pollMs);
      }

      return () => {                     // cancel
        if (finished) return;
        finished = true;
        clearTimer(guard);
        stopWatch();
        quiet();
        cancelSpeech(synth || undefined);
      };
    },
  };
  return channel;
}

// ---------------------------------------------------------------------------------
// SCREEN - a banner. Stacks, briefly.
// ---------------------------------------------------------------------------------
export function createScreenChannel({
  mount,
  holdMs = { status: 0, say: 4000, notify: 6000, alert: 12000 },
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!mount) throw new Error('createScreenChannel: a mount element is required');
  mount.classList.add('out-stack');

  return {
    name: 'screen',
    concurrency: 3,
    available: () => true,
    present(item, { done }) {
      const el = document.createElement('div');
      el.className = `out-msg out-${item.verb}`;
      el.setAttribute('role', item.verb === 'alert' ? 'alert' : 'status');
      el.textContent = item.text;
      mount.append(el);

      // `status` is ambient: it is the current state of something, so it stays until
      // something replaces it rather than timing out. Everything else is an event and
      // goes away on its own.
      const hold = Number(holdMs[item.verb]) || 0;
      if (item.verb === 'status') {
        for (const old of [...mount.querySelectorAll('.out-status')]) if (old !== el) old.remove();
      }
      const finish = () => { el.remove(); done(); };
      const timer = hold > 0 ? setTimer(finish, hold) : null;
      if (!hold && item.verb !== 'status') { finish(); return null; }

      return () => { if (timer) clearTimer(timer); el.remove(); };
    },
  };
}

// ---------------------------------------------------------------------------------
// SOUND - an earcon. Short, distinct per verb, no file to load.
// ---------------------------------------------------------------------------------
// Synthesised rather than sampled on purpose: no asset to ship, no fetch to fail, and
// nothing to go missing when the drive is not mounted. Pitch carries the urgency, which
// is a thing people read without being taught.
const TONES = {
  status: [440, 0.06],
  say: [520, 0.07],
  notify: [660, 0.12],
  alert: [880, 0.22],
};

export function createSoundChannel({ context = null, gain = 0.12 } = {}) {
  let ctx = context;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  };

  return {
    name: 'sound',
    concurrency: 2,
    available: () => !!ensure(),
    present(item, { done }) {
      const audio = ensure();
      if (!audio) { done(); return null; }
      // Browsers suspend an AudioContext created before a user gesture. Resuming is
      // cheap and a no-op when it is already running.
      if (audio.state === 'suspended') audio.resume?.().catch(() => {});

      const [freq, dur] = TONES[item.verb] || TONES.notify;
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(0, audio.currentTime);
      vol.gain.linearRampToValueAtTime(gain, audio.currentTime + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      osc.connect(vol).connect(audio.destination);
      osc.onended = () => done();
      osc.start();
      osc.stop(audio.currentTime + dur);

      return () => { try { osc.stop(); } catch { /* already stopped */ } };
    },
  };
}

// Everything this device can actually do. A channel whose adapter reports unavailable is
// left out entirely, so output.js drops to `no-adapter` and SAYS SO in the log, rather
// than a message vanishing into a channel that was never going to work.
//
// `captions` (row 2.42): a subtitles controller (subtitles.js). When given, what the SPEECH channel
// says is also written as a subtitle line, at the moment it is said - so a sentence the person's
// routing sends to "Spoken" is captioned, and one that is muted or dropped is not. Only speech is
// tapped: the screen channel is already on screen, and a tone has no words.
// `screenSpeech` (2026-10-04): the screen_speech.js tracker the speech channel marks while it talks.
export function defaultChannels({ mount = null, pref = () => ({}), events = null, audio = null,
                                  captions = null, screenSpeech = null } = {}) {
  const out = {};
  // Signed out there is no account, so there are no "other devices" and no mailbox.
  // The channel is absent rather than present-and-broken, which is what makes
  // output.js report `no-adapter` instead of a message vanishing.
  if (events) out.remote = createRemoteChannel({ events });
  const speech = createSpeechChannel({ pref, audio, screenSpeech });
  if (speech.available()) {
    out.speech = captions && typeof captions.tap === 'function' ? captions.tap(speech) : speech;
  }
  const sound = createSoundChannel();
  if (sound.available()) out.sound = sound;
  if (mount) out.screen = createScreenChannel({ mount });
  return out;
}
