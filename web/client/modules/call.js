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

// What a CALL wants from the microphone, as opposed to what a recognizer wants. Named here so
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
  // *** AN EXAMPLE CALL ON THE EMPTY SCREEN. *** Mike, 2026-09-06: the module *"currently
  // shows 'No call right now' with no way to see what a call looks like."* Which made the one
  // module nobody can try a dead end -- you cannot evaluate it, demonstrate it to a family, or
  // check how it will look in a panel without arranging two accounts and a second machine.
  //
  // DEFAULT ON, and the counter-case is named rather than defaulted around: on a locked bedside
  // screen an example call is noise at best, and the person it might confuse is the person the
  // screen is for. It is one setting, and everything the example draws is labelled as an
  // example on every frame -- see `demoFrame`.
  demo: true,
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
  { key: 'demo', label: 'Show an example when there is no call', default: true,
    level: 'standard',
    onLabel: 'Yes \u2014 a “what does a call look like?” button',
    offLabel: 'No \u2014 just say there is no call',
    note: 'The example never rings anybody, never opens the camera or the microphone, and is '
        + 'labelled as an example the whole time. Turn it off on a screen somebody lives with.' },
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
    // *** ON-SCREEN, NOT JUST console.error. *** Found answering an open question: "does a
    // failed connection fail silently, or with a message?" It failed silently -- `end()` always
    // reverted straight to the plain idle view regardless of why, so a real failure and a normal
    // hangup looked identical to the person on screen. `lastEndReason` carries the reason through
    // to `render()`'s idle branch (see below); cleared on a timeout or the next call attempt so
    // it never lingers as a stale message.
    let lastEndReason = null;
    let lastEndTimer = null;
    let ringTimer = null;
    let tickTimer = null;
    let remaining = 0;           // seconds left in the decline window
    // *** THE EXAMPLE IS A SEPARATE VARIABLE FROM `phase`, ON PURPOSE. ***
    //
    // Making it a fourth `phase` would have put a fake call on the same code path as a real
    // one, and every guard in this file that asks `phase === 'ringing'` would then be true for
    // something that is not a call. The failure mode is not cosmetic: `answer()` would open the
    // camera and the microphone for a demonstration, and `end()` would publish CALL_ENDED,
    // which the state machine acts on. So the example is its own flag, it is only ever read by
    // `render`, and NOTHING it does reaches the bus, the transport, the camera or the mic.
    let demo = '';               // '' | 'ringing' | 'connected'
    let demoTimer = null;
    let demoTick = null;
    let demoLeft = 0;
    const offs = [];

    const AUDIO_ID = `call:${ctx.instanceId || 'call'}`;
    const CAM_ID = `call:${ctx.instanceId || 'call'}`;
    const MIC_ID = `call:${ctx.instanceId || 'call'}`;

    const el = (sel) => root?.querySelector(sel);

    function render() {
      if (!root) return;
      const stage = el('[data-stage]');
      if (!stage) return;
      if (phase === 'idle' && demo) {
        stage.innerHTML = demoFrame();
      } else if (phase === 'idle') {
        stage.innerHTML = '<div class="call-idle">No call right now</div>'
          + (lastEndReason
            ? `<div class="call-endmsg">${esc(END_MESSAGES[lastEndReason])}</div>`
            : '')
          + (cfg.demo !== false
            ? '<button type="button" class="call-demo-btn" data-demo>See what a call looks '
              + 'like</button>'
            : '');
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

    // ------------------------------------------------------------------------------------
    // THE EXAMPLE CALL
    // ------------------------------------------------------------------------------------
    //
    // It draws the two screens a real call draws and does nothing else. No bus topic, no
    // transport, no camera, no microphone, no speaker tier -- there is deliberately no call to
    // any of them below this comment, which is what makes "it cannot ring anybody" a property
    // of the code rather than an intention.

    /** Every frame of the example says it is an example, and carries a way out. A fake call
     *  that looked exactly like a real one would make a real one impossible to trust. */
    function demoFrame() {
      const body = demo === 'ringing'
        ? personCard({ name: 'Alex', note: 'Alex is calling' })
          + `<div class="call-count">${demoLeft}</div>`
          + '<div class="call-hint">On a real call, saying \u201cdecline\u201d refuses it</div>'
        : personCard({ name: 'Alex', note: 'On a call' })
          + '<div class="call-hint">A real call shows their video here, and this room stays '
            + 'in the corner</div>';
      return '<div class="call-demo-tag">Example \u2014 not a real call</div>'
        + body
        + '<button type="button" class="call-demo-stop" data-demo-stop>Stop the example</button>';
    }

    function stopDemo() {
      if (demoTimer != null) { clearTimer(demoTimer); demoTimer = null; }
      if (demoTick != null) { clearTick(demoTick); demoTick = null; }
      demo = '';
      if (phase === 'idle') render();
    }

    function startDemo() {
      if (phase !== 'idle') return;              // a real call is not interrupted by a mock
      stopDemo();
      demo = 'ringing';
      demoLeft = 5;
      render();
      demoTick = setTick(() => {
        demoLeft -= 1;
        if (demoLeft > 0) { render(); return; }
        clearTick(demoTick); demoTick = null;
        demo = 'connected';
        render();
        // *** IT ENDS ITSELF. *** Same rule as everything else on these screens: nothing may
        // sit on a screen waiting for an input from somebody who cannot give one. An example
        // call left running would be a stranger's face on her wall until a person came.
        demoTimer = setTimer(() => { demoTimer = null; stopDemo(); }, 12000);
      }, 1000);
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
    // RAW (a recognizer wants raw; see mic_owner.js), the call still gets the stream and the
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
      // A REAL CALL TAKES THE SCREEN BACK IMMEDIATELY. Somebody looking at the example when
      // her daughter rings must see her daughter, not a demonstration with a real call queued
      // behind it.
      stopDemo();
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

    // Reasons worth a word on screen, and what to say. Declined/hangup/ended are outcomes
    // somebody chose or expected - no message needed, the idle view already says "no call right
    // now". These two are the ones a person watching would otherwise have no way to explain.
    const END_MESSAGES = {
      failed: 'The call could not connect.',
      unanswered: 'No answer.',
      // *** ADDED 2026-09-08. *** `call_transport.js`'s own `onEnded` was wired to always report
      // `'remote'` regardless of why it actually ended — so a connection that STALLED (its own
      // `armStall()`, fired from ICE going `failed`, whether that happens before the call ever
      // connects or after a previously-good connection drops) looked identical on screen to the
      // other person hanging up normally. Mike's own ruling on this feature — no relay server,
      // ever, "say so honestly" when a direct connection can't be made — applies exactly as much
      // to a connection that dies mid-call as to one that never starts.
      'connection-lost': 'The connection was lost.',
    };

    function end(reason = 'ended') {
      clearRing();
      const was = phase;
      phase = 'idle';
      who = null;
      dropCamera();
      dropMic();
      takeSpeaker(false);
      if (lastEndTimer != null) { clearTimer(lastEndTimer); lastEndTimer = null; }
      lastEndReason = END_MESSAGES[reason] ? reason : null;
      if (lastEndReason) {
        lastEndTimer = setTimer(() => { lastEndReason = null; lastEndTimer = null; render(); },
          8000);
      }
      render();
      try { transport?.hangup?.(reason); } catch { /* already down */ }
      // Published on EVERY exit, including the ones nobody chose - unanswered, failed. The
      // state machine's `$back` is what returns the screen, and it only fires on this topic,
      // so a path that forgets to publish is a screen stuck on a dead call.
      if (was !== 'idle') bus.publish(CALL_ENDED, { reason });
    }

    return {
      __probe: () => ({ phase, who, hasOutgoing: !!outgoing, ringArmed: !!ringTimer,
                        counting: !!tickTimer, remaining, cfg: { ...cfg },
                        demo, demoLeft,
                        demoOffered: !!root?.querySelector('[data-demo]'),
                        tagged: !!root?.querySelector('.call-demo-tag') }),
      __demo: () => startDemo(),
      __demoStop: () => stopDemo(),
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
          '.m-call{position:absolute;inset:0;background:#05070f;color:#e8f0ea;'
          // *** `cqmin`, NOT `vmin`, AND THIS WAS A REAL BUG. ***
          //
          // Every size in this module was a viewport unit, so a call in a
          // DASHBOARD QUADRANT was drawn as though it filled the screen: in a
          // 520x400 cell the caller's avatar came out at 22% of a 900px viewport,
          // pushing the countdown off the top and the buttons off the bottom.
          // `modules/board.js` learned the same lesson and fixed it with `--u`
          // measured from the card; this is the same fix in CSS, which is
          // available here because everything in this module is relative to one
          // box. `overflow:auto` is the floor under it: a panel too small even
          // for the scaled version scrolls rather than hiding the way out.
          + 'container-type:size;overflow:auto}'
          // *** THE PIECES ARE IN FLOW, AND THIS FIXED A BUG IN THE REAL CALL, NOT THE
          // EXAMPLE. *** The countdown and the hint were both absolutely positioned against
          // the stage while the caller's card sat centred in it — so in a SHORT PANEL the
          // countdown printed straight over the caller's initial. Found by looking at the
          // example in a 520x400 cell, but a real incoming call in a dashboard quadrant did
          // exactly the same thing: the number that says how long you have to decline, on top
          // of the letter that says who is calling.
          //
          // A column with real gaps cannot overlap. The padding keeps it clear of the top
          // band, and the video goes back to `absolute` because it is the one thing that
          // should ignore all of it and fill the panel.
          + '.m-call [data-stage]{position:absolute;inset:0;display:flex;'
          + 'flex-direction:column;align-items:center;justify-content:center;gap:2cqmin;'
          + 'padding:9cqmin 3cqmin;box-sizing:border-box;text-align:center}'
          + '.m-call .call-remote{position:absolute;inset:0;width:100%;height:100%;'
          + 'object-fit:cover;background:#000}'
          + '.m-call .call-who{display:flex;flex-direction:column;align-items:center;gap:2cqmin}'
          + '.m-call .call-avatar{width:22cqmin;height:22cqmin;border-radius:50%;'
          + 'background:rgba(255,255,255,.10);display:flex;align-items:center;'
          + 'justify-content:center;font:600 10cqmin/1 system-ui,sans-serif;color:#fff3d9}'
          + '.m-call .call-name{font:600 5cqmin/1.1 system-ui,sans-serif}'
          + '.m-call .call-sub{font:400 2.6cqmin/1.2 system-ui,sans-serif;opacity:.7}'
          + '.m-call .call-count{font:600 9cqmin/1 system-ui,sans-serif;order:-1;'
          + 'color:#fff3d9;opacity:.9;font-variant-numeric:tabular-nums}'
          + '.m-call .call-hint{opacity:.6;max-width:34ch;'
          + 'font:400 2.2cqmin/1.35 system-ui,sans-serif}'
          + '.m-call .call-idle{opacity:.45;font:400 3cqmin system-ui,sans-serif}'
          // Distinct from `.call-idle` on purpose -- higher opacity, its own line -- because
          // this is information ("no answer", "could not connect"), not the ambient dimness of
          // nothing happening. Same warm tone as the demo tag rather than an alarm red; a failed
          // call is not an emergency.
          + '.m-call .call-endmsg{opacity:.85;color:#fff3d9;'
          + 'font:600 2.4cqmin/1.3 system-ui,sans-serif;margin-top:.6cqmin}'
          // The example's own chrome. The tag is at the TOP, in the reading position, and it
          // is not subtle: the one thing worse than no example is an example somebody mistakes
          // for a call from a person who is not there.
          + '.m-call .call-demo-tag{position:absolute;top:0;left:0;right:0;padding:1.4cqmin;'
          + 'background:#fff3d9;color:#12181c;font:700 2.2cqmin/1.2 system-ui,sans-serif;'
          + 'letter-spacing:.02em}'
          + '.m-call .call-demo-btn{padding:1.4cqmin 2.6cqmin;'
          + 'min-height:44px;border-radius:2cqmin;cursor:pointer;background:transparent;'
          + 'color:#e8f0ea;border:1px solid rgba(232,240,234,.4);'
          + 'font:600 2.2cqmin system-ui,sans-serif}'
          + '.m-call .call-demo-btn:hover{border-color:#e8f0ea}'
          + '.m-call .call-demo-stop{padding:1.2cqmin 2.4cqmin;'
          + 'min-height:44px;border-radius:2cqmin;cursor:pointer;background:#fff3d9;'
          + 'color:#12181c;border:0;font:600 2.1cqmin system-ui,sans-serif}';
        root.appendChild(style);
        const stage = document.createElement('div');
        stage.setAttribute('data-stage', '');
        root.appendChild(stage);
        mount.appendChild(root);
        render();

        // Delegated, because `render` replaces the stage's markup on every frame.
        root.addEventListener('click', (e) => {
          if (e.target.closest('[data-demo]')) { startDemo(); return; }
          if (e.target.closest('[data-demo-stop]')) stopDemo();
        });

        // *** SETTINGS TAKE EFFECT WHILE IT IS MOUNTED. THEY DID NOT. ***
        //
        // `cfg` was read once here and never again -- five declared settings, none of which
        // did anything until somebody remounted the panel. On a critical module that is worse
        // than on a game: a caregiver who turns "say it out loud" off, or moves "before it
        // answers" to never, has every reason to believe they have changed what the screen
        // will do the next time somebody rings.
        //
        // Same defect and the same fix as `pressgame.js`, found by sweeping every module that
        // declares settings for one that never subscribes. `comet.js` was the third.
        //
        // *** WHAT IT REFUSES TO CHANGE MID-RING, AND WHY. *** A countdown that is already
        // running is a promise to whoever is in the room: this call connects in N seconds
        // unless somebody says no. Re-reading `declineSeconds` under that would move the
        // deadline while a person is deciding against it. So a ring in progress keeps the
        // window it started with, and the new value governs the next call.
        offs.push(state?.subscribe?.(() => {
          const next = { ...DEFAULTS, ...(state.get() || {}) };
          const ringing = phase === 'ringing';
          cfg = ringing
            ? { ...next, declineSeconds: cfg.declineSeconds, ringSeconds: cfg.ringSeconds }
            : next;
          // The example is a caregiver control on an idle screen; turning it off has to take
          // it away now rather than at the next mount.
          if (cfg.demo === false) stopDemo();
          render();
        }) || (() => {}));

        // Driven by the world, not by this module deciding things.
        offs.push(bus.subscribe(CALL_INCOMING + ':signal', (from) => incoming(from)));
        offs.push(bus.subscribe(CALL_ANSWER, () => answer()));
        offs.push(bus.subscribe(CALL_HANGUP, () => end('hangup')));
        offs.push(bus.subscribe(CALL_DECLINE, () => decline()));
        transport?.onIncoming?.((from) => incoming(from));
        // THE TRANSPORT'S OWN REASON, NOT A HARDCODED ONE. It was `() => end('remote')`,
        // discarding whatever `call_transport.js`'s `finish(reason)` actually reported — so a
        // stalled/dropped connection was indistinguishable from an ordinary hangup. `'remote'`
        // (a real `bye`) and `'destroyed'` (this end tearing itself down) stay silent, same as
        // before; `'stalled'`/`'failed'` now say so.
        transport?.onEnded?.((reason) =>
          end(reason === 'stalled' || reason === 'failed' ? 'connection-lost' : 'remote'));
      },

      onResize() {},
      // Hidden mid-call is not the same as hung up - the state machine may be mid-switch.
      // Do nothing, so the audio and the track survive the transition.
      onHide() {},

      destroy() {
        clearRing();
        stopDemo();
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
