// modules/call.js — the incoming call, as a STAGE module.
//
// *** THE CALL KIOSK IS THE KIOSK WE ALREADY HAVE. *** (Mike, 2026-08-29: *"we already have a
// kiosk layout like that … it would just be that layout with her camera that is normally the
// mirror up in the picture-in-picture window and then the big window being the person that's
// calling in."*) The kiosk is already `k-stage` plus `k-mirror`, a 4:3 overlay that defaults
// to top-right. So a call needs NO new layout: it takes the stage, and her camera stays
// exactly where it already was.
//
// ***THERE IS ONE WEBCAM AND ONE PLACE ON SCREEN TO SHOW IT.*** This module deliberately does
// NOT render a second view of her - the mirror IS the self-view for the duration. What this
// module needs from the camera is the OUTGOING track, which is not on this screen at all.
// Mike: *"there's no need to have that same camera on two windows in the call kiosk."*
//
// WHAT IT SHOWS ON THE STAGE:
//   * a video call  -> the caller, full stage;
//   * an audio call -> their name and profile, because a black rectangle tells her nothing
//                      and she cannot read a status line.
//
// ---------------------------------------------------------------------------------------
// WHAT IS HERE AND WHAT IS NOT
// ---------------------------------------------------------------------------------------
// The TRANSPORT is behind a seam and is not implemented. `drive.py` already recorded the
// decision for this stack - the WebSocket relay was chosen over WebRTC, with the note that
// the same socket can carry signalling later - and Cici's validated WebRTC callee is 356
// lines in a different codebase. Porting that is its own slice. What is here is everything
// AROUND it, which is the part that has to be right before a call ever connects:
//
//   * it takes the CALL TIER on the audio bus, so a call pauses the music rather than
//     ducking it (the tier existed and nothing used it until now);
//   * it takes the camera as a CLONE through the arbiter, so hanging up cannot blink the
//     picture-in-picture;
//   * it publishes `call/incoming` and `call/ended`, which is what the Rules tab's switch
//     writes transitions against - so the state machine, the rule and the module agree.
//
// *** IT ANSWERS AFTER A DECLINE WINDOW, AND THAT IS BETTER THAN THE SETTING I HAD. ***
// I first shipped this as auto-answer OFF by default, reasoning that a screen which opens a
// microphone because a stranger dialled it is a listening device.
//
//   Mike, 2026-08-29: *"it wouldn't be a stranger anyways because they wouldn't have access to
//   call her. It would only be someone that was given permissions through the site."*
//
// He is right, and it matters: `call_audio` / `call_video` are per-link PERMISSIONS, so the set
// of people who can ring this screen is already a set somebody chose. "A stranger dialled it"
// is not a case that exists.
//
// AND HIS DESIGN SOLVES THE REAL RESIDUE BETTER THAN MY SETTING DID. The residue is not
// strangers, it is that she cannot decline: without her, a permitted caller makes the room
// audible with nobody in it having acted. So the answer is not to refuse the call - it is to
// ANNOUNCE IT OUT LOUD WITH A COUNTDOWN, so anybody in the room can stop it:
//
//     "Incoming call from Mike. Ten. Nine. Eight… say decline to refuse it."
//
// *** THE POINT OF SAYING IT ALOUD IS THAT THE PERSON WHO CAN ACT IS NOT THE PERSON THE CALL
// IS FOR. *** An aide mid-change, a therapist mid-session, family in the room - none of them
// know they may refuse unless told. A silent auto-answer denies them the choice; a silent
// ring denies HER the call, because she cannot answer one.
//
// AND IT PASSES THE NOBODY-ANSWERS TEST DELIBERATELY, in the direction Mike chose: if nobody
// acts, the call CONNECTS. That is not the "inaction is safe" default - it is a decision that
// a missed call from her people costs more than an unwanted one, on a screen whose whole
// purpose is being her window to them. Set the window to 0 to connect at once, or turn it off
// entirely to require somebody to answer.

import { registerModule } from '../module.js';
import { MUSIC_GROUP } from '../audio_bus.js';
import { PROFILES as MIC_PROFILES } from '../mic_owner.js';

// What a CALL wants from the microphone, as opposed to what a recogniser wants. Named here so
// the intent is readable at the acquire site rather than being three booleans.
const MIC_PROFILE = MIC_PROFILES.call;

export const CALL_INCOMING = 'call/incoming';
export const CALL_ENDED = 'call/ended';
export const CALL_ANSWER = 'call/answer';
export const CALL_HANGUP = 'call/hangup';
// DECLINE IS ITS OWN TOPIC, not "hang up early". Refusing a call before it connects and
// ending one that is running are different things to a person and different rows in a log.
export const CALL_DECLINE = 'call/decline';

// press-to-answer is deliberately absent from the default: see the header.
const DEFAULTS = {
  // Seconds of announced countdown before it answers. 0 connects at once; `null` never
  // answers by itself and waits for somebody.
  declineSeconds: 10,
  showSelf: false,      // the mirror is the self-view; this is here to be turned ON by a
                        // surface that has no mirror, not to be used on the bedside kiosk
  ringSeconds: 45,      // give up if it is set to wait and nobody ever comes
  announce: true,       // say it out loud - see the header, this is the safeguard
};

const SETTINGS = [
  { key: 'declineSeconds', label: 'Before it answers', kind: 'choice', default: 10,
    level: 'essential',
    options: [
      { value: 0, label: 'Answer straight away' },
      { value: 10, label: 'Count down ten seconds first' },
      { value: 20, label: 'Count down twenty seconds first' },
      { value: null, label: 'Never — somebody has to answer' },
    ],
    note: 'It says who is calling and counts down out loud, so anybody in the room can '
        + 'decline. Only people you have given permission can call at all.' },
  { key: 'announce', label: 'Say it out loud', default: true, level: 'essential',
    onLabel: 'Announce the caller and the countdown', offLabel: 'On screen only',
    note: 'The person who can decline is often not the person the call is for.' },
  { key: 'ringSeconds', label: 'Ring for', kind: 'choice', default: 45, level: 'standard',
    options: [
      { value: 20, label: 'A short while' },
      { value: 45, label: 'About a minute' },
      { value: 120, label: 'A long time' },
    ] },
  { key: 'showSelf', label: 'Show a second view of this camera', default: false,
    level: 'advanced',
    note: 'Off, because the picture-in-picture already shows it. Only useful on a screen '
        + 'that has no mirror.' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Their name, big, when there is no video to show. An initial rather than an icon: it is the
// same shape whoever calls, and it reads at the far end of a room.
function personCard(who = {}) {
  const name = who.name || 'Someone';
  const initial = (name.trim()[0] || '?').toUpperCase();
  return `<div class="call-who">
    <div class="call-avatar" aria-hidden="true">${esc(initial)}</div>
    <div class="call-name">${esc(name)}</div>
    <div class="call-sub">${esc(who.note || 'Audio call')}</div>
  </div>`;
}

registerModule(
  { type: 'call', title: 'Call',
    description: 'Shows whoever is calling, full screen, while the picture-in-picture keeps '
               + 'showing this room',
    importance: 'critical', dependsOn: 'network', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, audio = null, cameraOwner = null, micOwner = null, output = null } = ctx;
    // The transport is injected. Absent, everything else still works and the stage says so —
    // which is what makes the rest of this testable before any of it exists.
    const transport = ctx.callTransport || null;
    // *** THE CLOCK IS INJECTED, like every other timed thing in this repo. *** A countdown
    // driven by the real setInterval cannot be tested honestly: a hidden or backgrounded tab
    // throttles timers, so the test either sleeps for real and is slow, or races and is flaky.
    // Both are worse than handing the module its timers.
    const io = ctx.callIO || {};
    const setTimer = io.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = io.clearTimer || ((id) => clearTimeout(id));
    const setTick = io.setTick || ((fn, ms) => setInterval(fn, ms));
    const clearTick = io.clearTick || ((id) => clearInterval(id));

    let cfg = { ...DEFAULTS };
    let root = null;
    let phase = 'idle';          // idle | ringing | connected
    let who = null;
    let outgoing = null;         // the cloned track we send; NOT the one the PiP shows
    let ringTimer = null;
    let tickTimer = null;
    let remaining = 0;           // seconds left in the decline window
    const offs = [];

    const AUDIO_ID = `call:${ctx.instanceId || 'call'}`;
    const CAM_ID = `call:${ctx.instanceId || 'call'}`;
    const MIC_ID = `call:${ctx.instanceId || 'call'}`;

    const el = (sel) => root?.querySelector(sel);

    function render() {
      if (!root) return;
      const stage = el('[data-stage]');
      if (!stage) return;
      if (phase === 'idle') {
        stage.innerHTML = '<div class="call-idle">No call right now</div>';
      } else if (phase === 'ringing') {
        const counting = remaining > 0;
        stage.innerHTML = personCard({ ...who, note: `${who?.name || 'Someone'} is calling` })
          + (counting ? `<div class="call-count" aria-live="off">${remaining}</div>` : '')
          // THE WAY OUT IS ON THE SCREEN, ALWAYS. Somebody who missed the spoken line - a
          // caregiver who walked in mid-countdown - can still see that this can be refused.
          + `<div class="call-hint">${counting
              ? 'Say “decline” to refuse this call'
              : 'Waiting to be answered'}</div>`;
      } else {
        // Connected. A remote VIDEO fills the stage; audio-only shows who it is, because a
        // black rectangle tells her nothing and she cannot read a status line.
        stage.innerHTML = who?.video
          ? '<video class="call-remote" autoplay playsinline></video>'
          : personCard({ ...who, note: 'On a call' });
      }
      root.dataset.phase = phase;
    }

    // ---- the audio bus: a call PAUSES the media, it does not duck it ------------------
    function takeSpeaker(on) {
      if (!audio) return;
      // `call` tier. The bus decides what that means - by default it silences media outright
      // rather than leaving a bed murmuring under a conversation.
      audio.register(AUDIO_ID, { tier: 'call' });
      audio.setActive(AUDIO_ID, on);
    }

    // ---- the camera: a CLONE, never a second open ------------------------------------
    let micStream = null;

    async function takeCamera() {
      if (!cameraOwner || outgoing) return null;
      try {
        outgoing = await cameraOwner.acquireTrack(CAM_ID);
        return outgoing;
      } catch (err) {
        // A call with no camera is still a call. Failing to get video must not stop audio.
        console.error('call: no camera for the outgoing track', err);
        outgoing = null;
        return null;
      }
    }
    // ---- the microphone: the same arbiter discipline as the camera -------------------
    //
    // *** A CALL WITH NO PICTURE IS STILL A CALL. A CALL WITH NO SOUND IS NOT. ***
    // That asymmetry decides how the two failures are handled: losing the camera is logged and
    // the call carries on (see `takeCamera`), while losing the microphone is worth saying out
    // loud, because the person at this end will be talking to somebody who cannot hear them and
    // nothing on screen would otherwise say why.
    //
    // It asks for the `call` profile — echo cancellation, noise suppression, gain — which is
    // what stops a room echoing. If something else got there first and opened the microphone
    // RAW (a recogniser wants raw; see mic_owner.js), the call still gets the stream and the
    // arbiter reports the mismatch rather than pretending. A slightly echoey call is a working
    // call; a silent one is not.
    async function takeMic() {
      if (!micOwner || micStream) return null;
      try {
        micStream = await micOwner.acquire(MIC_ID, MIC_PROFILE);
        const bad = micOwner.status?.().mismatch?.find((m) => m.id === MIC_ID);
        if (bad) {
          console.warn('call: microphone is not configured for a call', bad.missing.join(', '));
        }
        return micStream;
      } catch (err) {
        console.error('call: no microphone', err);
        micStream = null;
        // The one failure in this module worth telling the room about. `alert`, not `say`:
        // somebody talking to a screen that cannot hear them needs to know NOW, and the
        // person's own routing decides whether that is spoken, shown or a tone.
        try { output?.alert?.('This call has no microphone — they will not hear you.', { source: 'call' }); }
        catch { /* an output bus is optional everywhere */ }
        return null;
      }
    }

    function dropMic() {
      micStream = null;
      // ALWAYS release, even if the acquire failed — see camera_owner: a leaked ref pins the
      // device on, and on a microphone that is not merely wasteful.
      try { micOwner?.release(MIC_ID); } catch { /* already gone */ }
    }

    function dropCamera() {
      try { outgoing?.stop?.(); } catch { /* already stopped */ }
      outgoing = null;
      // ALWAYS release, even though the clone is stopped: the clone and the ref count are
      // separate, and a leaked ref pins the camera on.
      try { cameraOwner?.release(CAM_ID); } catch { /* already gone */ }
    }

    function clearRing() {
      if (ringTimer != null) { clearTimer(ringTimer); ringTimer = null; }
      if (tickTimer != null) { clearTick(tickTimer); tickTimer = null; }
      remaining = 0;
    }

    // Spoken through the output bus, so WHETHER it is spoken and how is the person's own
    // routing - the same seam every other module says things through. `alert`, not `say`:
    // this one is allowed to interrupt, because a countdown that arrives after the call has
    // connected is worse than useless.
    function announce(text) {
      if (!cfg.announce || !output || !text) return;
      try { output.alert(String(text)); } catch (err) { console.error('call announce', err); }
    }

    // The decline window. Counts down out loud, and CONNECTS when it runs out - see the
    // header for why that direction was chosen.
    function startCountdown(seconds) {
      remaining = Math.max(0, Math.round(seconds));
      render();
      announce(`Incoming call from ${who?.name || 'someone'}. `
             + `Answering in ${remaining}. Say decline to refuse it.`);
      tickTimer = setTick(() => {
        remaining -= 1;
        // Only the last few are spoken. Counting all the way down out loud is a machine
        // talking over a room; the last three are the part that means "now or never".
        if (remaining > 0 && remaining <= 3) announce(String(remaining));
        render();
        if (remaining <= 0) {
          clearRing();
          if (phase === 'ringing') answer();
        }
      }, 1000);
    }

    async function incoming(from) {
      who = from || {};
      phase = 'ringing';
      render();
      // *** THE STATE MACHINE HEARS THIS, NOT THIS MODULE. *** Publishing the topic is what
      // makes the screen switch, and it is the same topic the Rules tab writes a transition
      // against - so the rule a caregiver ticked and what actually happens cannot drift.
      bus.publish(CALL_INCOMING, { from: who });
      clearRing();

      const window_ = cfg.declineSeconds;
      if (window_ === 0) { await answer(); return; }     // straight through
      if (window_ == null) {
        // Nobody-answers is set to WAIT. Then it must still give up, or the screen sits on a
        // ringing card forever - which is the undismissable-gate shape wearing a phone icon.
        announce(`Incoming call from ${who?.name || 'someone'}.`);
        if (cfg.ringSeconds > 0) {
          ringTimer = setTimer(() => { if (phase === 'ringing') end('unanswered'); },
                               cfg.ringSeconds * 1000);
        }
        return;
      }
      startCountdown(window_);
    }

    async function answer() {
      if (phase === 'idle') return;
      clearRing();
      phase = 'connected';
      takeSpeaker(true);
      // BOTH, and in parallel: two sequential permission-gated opens is two round trips
      // before anybody can speak, on a screen where the caller is already waiting.
      const [track] = await Promise.all([takeCamera(), takeMic()]);
      render();
      const v = el('.call-remote');
      try { await transport?.answer?.({ from: who, outgoing: track, remoteVideo: v }); }
      catch (err) { console.error('call: transport failed to answer', err); end('failed'); }
    }

    // Refusing before it connects. A separate path from hangup so the record can tell
    // "somebody in the room stopped this" from "the call finished".
    function decline() {
      if (phase !== 'ringing') return;
      announce('Call declined');
      end('declined');
    }

    function end(reason = 'ended') {
      clearRing();
      const was = phase;
      phase = 'idle';
      who = null;
      dropCamera();
      dropMic();
      takeSpeaker(false);
      render();
      try { transport?.hangup?.(reason); } catch { /* already down */ }
      // Published on EVERY exit, including the ones nobody chose - unanswered, failed. The
      // state machine's `$back` is what returns the screen, and it only fires on this topic,
      // so a path that forgets to publish is a screen stuck on a dead call.
      if (was !== 'idle') bus.publish(CALL_ENDED, { reason });
    }

    return {
      __probe: () => ({ phase, who, hasOutgoing: !!outgoing, ringArmed: !!ringTimer,
                        counting: !!tickTimer, remaining, cfg: { ...cfg } }),
      __decline: () => decline(),
      __incoming: (from) => incoming(from),
      __answer: () => answer(),
      __end: (r) => end(r),

      init() {
        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        root = document.createElement('div');
        root.className = 'm-call';
        const style = document.createElement('style');
        style.textContent =
          '.m-call{position:absolute;inset:0;background:#05070f;color:#e8f0ea;overflow:hidden}'
          + '.m-call [data-stage]{position:absolute;inset:0;display:flex;align-items:center;'
          + 'justify-content:center;text-align:center}'
          + '.m-call .call-remote{width:100%;height:100%;object-fit:cover;background:#000}'
          + '.m-call .call-who{display:flex;flex-direction:column;align-items:center;gap:2vmin}'
          + '.m-call .call-avatar{width:22vmin;height:22vmin;border-radius:50%;'
          + 'background:rgba(255,255,255,.10);display:flex;align-items:center;'
          + 'justify-content:center;font:600 10vmin/1 system-ui,sans-serif;color:#fff3d9}'
          + '.m-call .call-name{font:600 5vmin/1.1 system-ui,sans-serif}'
          + '.m-call .call-sub{font:400 2.6vmin/1.2 system-ui,sans-serif;opacity:.7}'
          + '.m-call .call-count{position:absolute;top:6vmin;font:600 9vmin/1 system-ui,sans-serif;'
          + 'color:#fff3d9;opacity:.9;font-variant-numeric:tabular-nums}'
          + '.m-call .call-hint{position:absolute;bottom:6vmin;opacity:.6;'
          + 'font:400 2.2vmin system-ui,sans-serif}'
          + '.m-call .call-idle{opacity:.45;font:400 3vmin system-ui,sans-serif}';
        root.appendChild(style);
        const stage = document.createElement('div');
        stage.setAttribute('data-stage', '');
        root.appendChild(stage);
        mount.appendChild(root);
        render();

        // Driven by the world, not by this module deciding things.
        offs.push(bus.subscribe(CALL_INCOMING + ':signal', (from) => incoming(from)));
        offs.push(bus.subscribe(CALL_ANSWER, () => answer()));
        offs.push(bus.subscribe(CALL_HANGUP, () => end('hangup')));
        offs.push(bus.subscribe(CALL_DECLINE, () => decline()));
        transport?.onIncoming?.((from) => incoming(from));
        transport?.onEnded?.(() => end('remote'));
      },

      onResize() {},
      // Hidden mid-call is not the same as hung up - the state machine may be mid-switch.
      // Do nothing, so the audio and the track survive the transition.
      onHide() {},

      destroy() {
        clearRing();
        dropCamera();
        dropMic();
        takeSpeaker(false);
        try { audio?.unregister?.(AUDIO_ID); } catch { /* already gone */ }
        try { transport?.destroy?.(); } catch { /* already gone */ }
        offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
        offs.length = 0;
        root?.remove(); root = null;
      },
    };
  },
);
