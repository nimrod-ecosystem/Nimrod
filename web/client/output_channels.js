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
  // A hard stop, because speechSynthesis does not always fire `onend` - a cancelled or
  // interrupted utterance can leave the channel believing it is still speaking forever,
  // and then nothing is ever said again. Same disease as the input bus's stuck switch,
  // same cure: a watchdog with a generous ceiling.
  maxMs = 30000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  // The voice tier itself makes no sound of its own - it exists so everything else can hear
  // that it is talking. No onGain: nothing ducks a voice.
  audio?.register?.(audioId, { tier: 'voice' });

  return {
    name: 'speech',
    concurrency: 1,
    available: () => !!(synth || (typeof window !== 'undefined' && window.speechSynthesis)),
    present(item, { done }) {
      const opts = {};
      if (synth) opts.synth = synth;
      if (Utterance) opts.Utterance = Utterance;
      const u = speak(item.text, pref() || {}, opts);
      if (!u) { done(); return null; }

      // Ducked for the sentence, and released on EVERY exit below - including the watchdog.
      // A voice tier left active because an utterance never fired `onend` would hold the
      // music down forever, which is the same stuck-switch disease the input bus has a
      // watchdog for, pointed at the speaker.
      audio?.setActive?.(audioId, true);

      let finished = false;
      const guard = setTimer(() => { if (!finished) { finished = true; audio?.setActive?.(audioId, false); done(); } }, maxMs);
      const end = () => { if (finished) return; finished = true; clearTimer(guard); audio?.setActive?.(audioId, false); done(); };
      u.onend = end;
      u.onerror = end;

      return () => {                     // cancel
        if (finished) return;
        finished = true;
        clearTimer(guard);
        audio?.setActive?.(audioId, false);
        cancelSpeech(synth || undefined);
      };
    },
  };
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
export function defaultChannels({ mount = null, pref = () => ({}), events = null, audio = null } = {}) {
  const out = {};
  // Signed out there is no account, so there are no "other devices" and no mailbox.
  // The channel is absent rather than present-and-broken, which is what makes
  // output.js report `no-adapter` instead of a message vanishing.
  if (events) out.remote = createRemoteChannel({ events });
  const speech = createSpeechChannel({ pref, audio });
  if (speech.available()) out.speech = speech;
  const sound = createSoundChannel();
  if (sound.available()) out.sound = sound;
  if (mount) out.screen = createScreenChannel({ mount });
  return out;
}
