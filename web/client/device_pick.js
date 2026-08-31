// device_pick.js — WHICH MICROPHONE, WHICH CAMERA, GIVEN WHAT IS ACTUALLY PLUGGED IN.
//
// Mike, 2026-08-30:
//
//   *"That does bring the point of being able to set a mic/camera as a fallback for anyone that
//    needs that for their communication, and having Nimrod know when to go to the fallback."*
//
// ---------------------------------------------------------------------------------------
// WHY THIS IS NOT A NICETY
// ---------------------------------------------------------------------------------------
//
// For most software, a microphone disappearing is a degraded experience. For somebody whose
// only route to being understood runs through it, **it is being cut off** — and the difference
// between "quieter" and "mute" is the whole reason this file exists rather than a `deviceId`
// stored in a settings row.
//
// The case that prompted it: a good microphone that is only present SOMETIMES. A phone brought
// into the room by a visitor hears far better than a webcam across it, and it leaves when they
// do. Both of those facts are normal, and neither should require anybody to change a setting.
//
// ---------------------------------------------------------------------------------------
// *** THIS PATTERN IS ALREADY IN THE REPO. IT IS `resolveVoice`. ***
// ---------------------------------------------------------------------------------------
//
// `voice.js` had the identical problem and solved it: the list of voices differs per machine, so
// a profile stores a PREFERENCE rather than an id, and resolution degrades — the exact voice by
// uri, then any voice in the right language, then the platform default, then the first one — so
// a saved voice that does not exist here never throws and never leaves somebody silent.
//
// A microphone is the same shape and the same reason. Store a preference, degrade, never strand.
// So this deliberately mirrors that file rather than inventing a second way to express it.
//
// TWO THINGS IT ADDS, and both are because a microphone matters more than a voice does:
//
//   1. **IT SAYS WHICH RUNG IT LANDED ON.** `resolveVoice` degrades silently, which is fine for
//      a voice — nobody is harmed by a slightly different accent. Falling from the good
//      microphone to the far one, silently, produces the single most confusing failure this
//      product has: everything looks fine and nothing works as well, with nothing to point at.
//      Mike's ask was "having Nimrod KNOW when to go to the fallback"; knowing is only half of
//      it, and the other half is saying so.
//
//   2. **IT DISTINGUISHES "THE DEVICE WENT AWAY" FROM "THE PERSON WENT QUIET."**
//      Falling back because a microphone was unplugged is correct. Falling back because somebody
//      stopped talking is a machine deciding that a person who went quiet must be broken — and
//      for someone who is slow to speak, that is exactly backwards.
//
// ---------------------------------------------------------------------------------------
// *** AND THE ABSOLUTE I WROTE HERE WAS TOO STRONG. CORRECTED BY MIKE, 2026-08-30. ***
// ---------------------------------------------------------------------------------------
//
// This file used to say: *"nothing here ever looks at signal, only at what the operating system
// says is PRESENT."* Mike killed it in one message:
//
//   *"What if an iPhone locks or something? Seems like a failing mic would be the definition of
//    failing silently. Maybe that's where ambient noise helps us."*
//
// He is right, and the hole is exactly where he points. **A device that has stopped working does
// not necessarily stop being PRESENT.** A phone that locks, an OS that takes the microphone for
// something else, a driver that wedges — `enumerateDevices` may still list it and `devicechange`
// may never fire. So a rule that only watches presence is blind to the most likely real failure,
// which is also the quietest one.
//
// **The corrected rule, which is the one that was actually worth protecting:**
//
//   > Never infer from signal whether a PERSON is doing anything.
//   > Signal MAY be used to tell whether the CHANNEL is alive.
//
// And what makes that safe is a fact about rooms rather than a threshold: **a working microphone
// in a real room is never digitally silent.** There is always a noise floor — a fan, a corridor,
// the building. A silent PERSON still produces room tone; a dead CHANNEL produces zeros. So the
// question is not "is anybody speaking", it is "is anything arriving at all", and those are
// different measurements with different consequences for getting them wrong.
//
// *** IF THAT IS EVER BUILT, THE THRESHOLD IS THE WHOLE RISK. *** It has to be tuned to detect
// DIGITAL SILENCE — near-zero level AND near-zero variance, sustained over many seconds — not
// "quiet". A threshold that creeps anywhere near speech level has rebuilt the exact bug this
// note exists to prevent, and it will be invisible until it happens to somebody slow to speak.
//
// THIS FILE still watches only presence, and that is a scope decision rather than a rule: it
// answers "which device", and liveness belongs to whatever holds the stream. The cheap rungs
// come first there and neither needs any audio analysis at all — `MediaStreamTrack.readyState`
// going to `ended`, and the `mute` / `unmute` events, which fire precisely when a source stops
// delivering data and are what a locked phone should raise. Ambient noise is the BACKSTOP for
// when those are not reliable, not the first move.
//
// Written up in `docs/for_chat/the_microphone_path.md`.

// Which rung the pick landed on. A closed set, for the same reason `input.js`'s rejection list
// is closed: a diagnostic that validates against it cannot drift into free text.
export const PICKS = [
  'preferred',   // the one at the top of their list is here. Nothing to say.
  'fallback',    // a LOWER entry on their list. Worth saying out loud.
  'unlisted',    // nothing they named is here; something else is. Worth saying loudly.
  'none',        // there is nothing at all. Worth saying loudest.
];

/**
 * Pick a device.
 *
 * `preferred` is an ORDERED list of device ids, best first — the shape a person's setting takes.
 * `available` is what the machine reports right now: [{ id, label }].
 *
 * Returns { id, label, pick, rank, wanted } and NEVER throws. `wanted` is the top preference, so
 * a caller can say "using the webcam, not the phone" rather than only naming what it got.
 */
export function pickDevice(preferred, available) {
  const want = (Array.isArray(preferred) ? preferred : []).filter(Boolean);
  const have = (Array.isArray(available) ? available : []).filter((d) => d && d.id);
  const wanted = want[0] || null;

  if (!have.length) return { id: null, label: '', pick: 'none', rank: -1, wanted };

  for (let i = 0; i < want.length; i++) {
    const found = have.find((d) => d.id === want[i]);
    if (found) {
      return { id: found.id, label: found.label || '', rank: i, wanted,
               pick: i === 0 ? 'preferred' : 'fallback' };
    }
  }

  // NOTHING THEY NAMED IS HERE, BUT SOMETHING IS. Using it beats using nothing — a screen that
  // refuses to listen because the preferred microphone is missing has chosen the worse failure.
  // But it is `unlisted`, not `fallback`, because it is a device nobody chose and that is a
  // different sentence.
  return { id: have[0].id, label: have[0].label || '', pick: 'unlisted', rank: -1, wanted };
}

// Did the pick change in a way anybody should hear about? Used to decide whether to speak, so
// that re-picking the same device on every `devicechange` event does not become chatter.
export function pickChanged(before, after) {
  if (!after) return false;
  if (!before) return after.pick !== 'preferred';
  return before.id !== after.id || before.pick !== after.pick;
}

/**
 * What to say about it, in words somebody in a room can act on.
 *
 * Returned rather than spoken, so the caller decides the verb and the routing — and so the
 * wording is testable, which for the only feedback a silent failure has is the point.
 *
 * `null` means say nothing: the preferred device is in use and there is no news.
 */
export function describePick(res, { kind = 'microphone' } = {}) {
  if (!res) return null;
  const name = res.label || 'a device';
  if (res.pick === 'preferred') return null;
  if (res.pick === 'none') {
    return { level: 'alert', text: `There is no ${kind} available.` };
  }
  if (res.pick === 'unlisted') {
    return { level: 'notify',
             text: `Using ${name} — none of the chosen ${kind}s is connected.` };
  }
  return { level: 'notify', text: `Using ${name} — the usual ${kind} is not connected.` };
}

/**
 * Watch for devices appearing and disappearing, and re-pick.
 *
 * *** `onPick` FIRES ON EVERY RE-PICK, NOT ONLY ON A CHANGE, and the third argument is why. ***
 *
 * It is called with (result, previous, changed). Two different things want to happen here and
 * they want it at different rates: the device has to be APPLIED every time, and the change has
 * to be ANNOUNCED only when it is news. An earlier version fired only on a change, so the very
 * first pick — which is not a change — never got applied, and the arbiter opened the default
 * microphone while cheerfully reporting it had chosen another one.
 *
 * That is the second time today the same mistake appeared in this session's work (see the note
 * on `syncEnabled` in `marker_panel.js`), which is a strong enough signal to write down as a
 * rule: **a control that is only applied on change is not applied.** So this hands over both
 * facts and lets the caller act on each at its own rate.
 *
 * A change back UP the list counts too — a visitor arriving should restore the better device
 * without anybody touching a setting.
 *
 * Everything is injected, so this is exercised with no hardware and no browser events.
 */
export function watchDevices({
  list,                       // async () => [{id, label}]
  preferred = () => [],
  onPick = null,
  // The browser's own notification that the hardware changed. A getter for the target rather
  // than the object itself, because `navigator.mediaDevices` DOES NOT EXIST on an insecure
  // origin — reading it eagerly at construction throws, which is how the same mistake was made
  // once already in `mic_owner.js`.
  target = () => (typeof navigator !== 'undefined' ? navigator.mediaDevices : null),
} = {}) {
  if (typeof list !== 'function') throw new Error('watchDevices: a list function is required');
  let current = null;
  let stopped = false;
  let bound = null;

  async function repick() {
    if (stopped) return current;
    let have = [];
    try { have = await list(); } catch { have = []; }
    const next = pickDevice(preferred(), have);
    const before = current;
    current = next;
    if (onPick) {
      const changed = pickChanged(before, next);
      try { onPick(next, before, changed); } catch (err) { console.error('devicePick onPick', err); }
    }
    return next;
  }

  try {
    const t = target();
    if (t?.addEventListener) {
      bound = () => { repick(); };
      t.addEventListener('devicechange', bound);
    }
  } catch { /* no mediaDevices here: the manual repick() still works */ }

  return {
    repick,
    current: () => (current ? { ...current } : null),
    stop() {
      stopped = true;
      try {
        const t = target();
        if (bound && t?.removeEventListener) t.removeEventListener('devicechange', bound);
      } catch { /* already gone */ }
      bound = null;
    },
  };
}
