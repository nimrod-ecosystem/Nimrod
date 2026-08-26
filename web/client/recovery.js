// recovery.js — WHAT TO DO WHEN A PANEL STOPS WORKING, decided as data.
//
// The escalation ladder:
//
//     notice -> SWAP TO SOMETHING THAT WORKS -> RELOAD -> reboot -> notify
//
// WHY THE SWAP MATTERS MORE THAN IT SOUNDS. When YouTube fails today, Christine gets a broken
// panel and stares at it until somebody walks in. With a fallback she gets her photos — which
// outrank every other module anyway — and the failure stops being a ruined afternoon and
// becomes a thing to fix at leisure. The alert still fires. It just stops being urgent, which
// is the exact pressure the wayfinder lesson is about: a monitoring feature aimed at family
// fails when a person decides to stop caring about it, and that failure is permanent.
//
// ---------------------------------------------------------------------------------------
// THE ORDER IS A SETTING, NOT A LAW. Mike:
//
//   *"Maybe make the fallback module vs reboot a sequence choice. She already has pictures in
//   her kiosk. I would be selecting something else. If she likes watching youtube, I would
//   consider trying a reboot before swapping in a less interesting module."*
//
// That is exactly right and it is not resolvable in general, because it depends on SOMETHING
// ONLY THE PERSON WHO KNOWS HER CAN WEIGH: how much the fallback costs her compared to a
// minute of black screen. A module she loves is worth rebooting for. A module she tolerates
// is not.
//
// SHIPPED DEFAULT: swap first. It is instant, it is invisible to her, and it never takes the
// whole screen away. `['reboot', 'swap', 'notify']` is one setting away and is the right
// answer for a module somebody actually wants.
//
// ---------------------------------------------------------------------------------------
// THREE GUARDS, and the first one is the reason this is a policy engine rather than an if.
//
// 1. THE REBOOT LOOP. If the fault SURVIVES the reboot, a naive ladder reboots again in ten
//    minutes, and again, forever — and a screen that reboots every ten minutes is worse than
//    one that is simply broken, because it is broken AND unusable AND looks like it is
//    trying. At most one automatic reboot per fault per window; a second identical fault
//    after a reboot is INFORMATION (the reboot is not the repair) and that is precisely when
//    a person should be told instead.
// 2. NEVER REBOOT A SCREEN SOMEBODY IS USING. Presence is already known — the drive layer
//    counts who is connected, and the activity ring knows when she last pressed anything.
//    Rebooting mid-call or mid-visit is the one way this feature could actively hurt.
// 3. QUIET HOURS, for NON-URGENT notices only. An urgent alert that respects quiet hours is a
//    bug; a non-urgent one that does not is the 3am false positive that ends the feature.
//
// ---------------------------------------------------------------------------------------
// EVERYTHING HERE IS PURE. It takes a fault, a history and a policy, and returns the next
// action and WHY. It reboots nothing, mounts nothing and reads no clock of its own — which is
// what lets the whole ladder, including the parts that are frightening to run, be tested
// exhaustively at a fake timestamp.
//
// THE ACTUATOR IS DELIBERATELY NOT HERE, and cannot be: a browser cannot reboot a Pi. That
// needs a small privileged helper on the device, which is a separate decision with a separate
// blast radius. This layer decides; something else acts.

// ---------------------------------------------------------------------------------------
// RELOAD IS THE RUNG THAT WAS MISSING, and leaving it out was a real gap. Mike asked whether
// the reboot is the wrong call, and the honest answer is that it was the wrong FIRST call:
//
//   * A REBOOT ONLY WORKS ON HARDWARE YOU OWN. No browser on any platform can restart the
//     host OS - there is no API for it and that is deliberate. On somebody else's tablet or
//     laptop the reboot rung simply does not exist, so a ladder that depends on it has no
//     self-healing step at all for most of the world.
//   * MOST OF WHAT A REBOOT ACTUALLY FIXES IS THE PAGE, NOT THE MACHINE. A wedged player, a
//     leaked canvas context, a socket that will not come back, a module stuck mid-render -
//     every one of those clears on `location.reload()`.
//   * It costs about two seconds, needs no privilege, no helper, no install, and works
//     everywhere.
//
// So: swap (invisible), reload (cheap, universal), reboot (expensive, hardware you own),
// notify (a person). Each rung is more disruptive and less available than the one before it,
// which is the right shape for an escalation ladder and was not the shape it had.
export const STEPS = ['swap', 'reload', 'reboot', 'notify'];
export const DEFAULT_SEQUENCE = ['swap', 'reload', 'reboot', 'notify'];

export const URGENCIES = ['urgent', 'normal', 'quiet'];

// HOW EXPOSED A MODULE IS, not "can it fail" — Mike: *"even clock can have a fail state if
// the time/date isn't right. Maybe least likely to fail if there aren't any without a fail
// state of some sort."* He is right, and it changes the vocabulary: there is no safe module,
// only a least-exposed one. Ranked most survivable first.
export const DEPENDS = ['none', 'local', 'server', 'network'];

export const DEFAULT_POLICY = {
  sequence: DEFAULT_SEQUENCE,
  // How long a fault has to persist before anything happens. Most things that look broken for
  // twenty seconds are a slow network, and acting on those is how a recovery system becomes
  // the thing that needs recovering.
  graceMs: 10 * 60 * 1000,
  // One automatic reboot per fault per six hours. Chosen, not measured.
  rebootWindowMs: 6 * 60 * 60 * 1000,
  // A RELOAD LOOP IS AS BAD AS A REBOOT LOOP and arrives faster, because a reload is cheap
  // enough to be tempting. A page that reloads every ten minutes is a page nobody can use.
  reloadWindowMs: 30 * 60 * 1000,
  // How long the screen warns before it reboots itself, so anybody standing there can stop it.
  rebootNoticeMs: 60 * 1000,
  // Local hours, inclusive-exclusive. Null means never hold anything.
  quietHours: { fromHour: 22, toHour: 7 },
  // Below this urgency a notice waits for morning.
  quietBelow: 'normal',
};

const clampSeq = (seq) => {
  const out = [];
  for (const s of Array.isArray(seq) ? seq : []) if (STEPS.includes(s) && !out.includes(s)) out.push(s);
  return out.length ? out : [...DEFAULT_SEQUENCE];
};

export function normalizePolicy(raw = {}) {
  const p = { ...DEFAULT_POLICY, ...(raw || {}) };
  p.sequence = clampSeq(p.sequence);
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  p.graceMs = num(p.graceMs, DEFAULT_POLICY.graceMs);
  p.rebootWindowMs = num(p.rebootWindowMs, DEFAULT_POLICY.rebootWindowMs);
  p.reloadWindowMs = num(p.reloadWindowMs, DEFAULT_POLICY.reloadWindowMs);
  p.rebootNoticeMs = num(p.rebootNoticeMs, DEFAULT_POLICY.rebootNoticeMs);
  if (!URGENCIES.includes(p.quietBelow)) p.quietBelow = DEFAULT_POLICY.quietBelow;
  if (p.quietHours) {
    const h = (v) => Math.min(23, Math.max(0, Math.floor(Number(v)) || 0));
    p.quietHours = { fromHour: h(p.quietHours.fromHour), toHour: h(p.quietHours.toHour) };
    // A window of zero length would hold nothing; treat it as "no quiet hours" rather than
    // pretending, because a setting that silently does nothing is worse than an absent one.
    if (p.quietHours.fromHour === p.quietHours.toHour) p.quietHours = null;
  }
  return p;
}

// ---------------------------------------------------------------------------------------
// isQuietHour — does the clock say hold a non-urgent notice?
//
// Wraps midnight, because 22:00-07:00 is the interesting case and the naive `h >= from &&
// h < to` version silently holds NOTHING for exactly the window anybody would set.
// ---------------------------------------------------------------------------------------
export function isQuietHour(hour, quietHours) {
  if (!quietHours) return false;
  const { fromHour, toHour } = quietHours;
  const h = Number(hour);
  if (!Number.isFinite(h)) return false;
  return fromHour < toHour ? (h >= fromHour && h < toHour) : (h >= fromHour || h < toHour);
}

// Is this notice held right now? URGENT IS NEVER HELD — the whole reason urgency is the
// author's and not the user's is that otherwise every alert becomes urgent to be sure it is
// seen, which is how an alert system dies.
export function holdsNotice(urgency, hour, policy = DEFAULT_POLICY) {
  const u = URGENCIES.includes(urgency) ? urgency : 'normal';
  if (u === 'urgent') return false;
  const below = URGENCIES.indexOf(u) > URGENCIES.indexOf(policy.quietBelow || 'normal');
  const atOrBelow = URGENCIES.indexOf(u) >= URGENCIES.indexOf(policy.quietBelow || 'normal');
  return (below || atOrBelow) && isQuietHour(hour, policy.quietHours);
}

// When a held notice comes out. A HELD ALERT IS NOT A DROPPED ALERT: it fires at the end of
// quiet hours carrying its ORIGINAL timestamp, or it batches into one morning summary.
// Silently discarding it is worse than never having sent it, because the person believes
// something is watching.
export function releaseHour(policy = DEFAULT_POLICY) {
  return policy.quietHours ? policy.quietHours.toHour : null;
}

// ---------------------------------------------------------------------------------------
// rankFallbacks — what to swap in, least exposed first.
//
// NOTHING IS FAILURE-FREE and the vocabulary says so. A clock with the wrong time is a failed
// clock; photos from a drive that is not mounted is a failed slideshow. So this ranks by how
// many things have to be working, and the last resort is whatever needs the fewest.
//
// A FALLBACK CHAIN THAT ENDS IN SOMETHING NETWORK-DEPENDENT HAS NOT TERMINATED, which is why
// `network` modules are excluded from being fallbacks at all rather than merely ranked last.
// ---------------------------------------------------------------------------------------
export function rankFallbacks(manifests = [], { exclude = [], allowNetwork = false } = {}) {
  const skip = new Set(exclude);
  const rank = (m) => {
    const d = DEPENDS.includes(m?.dependsOn) ? m.dependsOn : 'server';
    return DEPENDS.indexOf(d);
  };
  return (manifests || [])
    .filter((m) => m && m.type && !skip.has(m.type))
    .filter((m) => allowNetwork || (DEPENDS.includes(m.dependsOn) ? m.dependsOn : 'server') !== 'network')
    .map((m) => ({
      type: m.type,
      title: m.title || m.type,
      dependsOn: DEPENDS.includes(m.dependsOn) ? m.dependsOn : 'server',
      importance: m.importance || 'normal',
    }))
    // Least exposed first; among equals, the one that matters most to her. Photos being
    // `critical` is what floats it above a game at the same exposure level.
    .sort((a, b) => (DEPENDS.indexOf(a.dependsOn) - DEPENDS.indexOf(b.dependsOn))
      || ((a.importance === 'critical' ? 0 : 1) - (b.importance === 'critical' ? 0 : 1))
      || a.type.localeCompare(b.type));
}

// ---------------------------------------------------------------------------------------
// nextAction — THE LADDER, one step at a time.
//
// `fault`    { module, since, kind }
// `history`  { swappedAt, reboots: [ms], notifiedAt }
// `ctx`      { now, hour, inUse, fallback, urgency }
//
// Returns `{ action, why, ... }`. `action` is one of the STEPS, or 'wait' (too soon, or
// blocked for a reason that may pass), or 'hold' (a notice waiting for morning), or 'done'.
//
// WHY IT RETURNS A REASON AND NOT JUST AN ACTION: every branch here is something a person
// will eventually have to be told. "Nothing happened because the screen was in use" and
// "nothing happened because it already rebooted an hour ago" are different sentences and
// different repairs, which is the same lesson as "why nothing happened".
// ---------------------------------------------------------------------------------------
export function nextAction(fault, history = {}, ctx = {}, rawPolicy = DEFAULT_POLICY) {
  const policy = normalizePolicy(rawPolicy);
  const now = Number(ctx.now) || 0;
  const hist = { reboots: [], ...history };
  const out = (action, why, extra = {}) => ({ action, why, policy, ...extra });

  if (!fault || !fault.module) return out('done', 'nothing is faulty');

  const since = Number(fault.since) || 0;
  // TWO DIFFERENT GUARDS, and conflating them was a real modelling bug the tests caught.
  //
  //   SPENT THIS FAULT   a remedy that already ran since this fault began does not run again.
  //                      A fault that SURVIVED a reboot will not be fixed by a second one -
  //                      that is the whole "move on rather than round" rule, and without this
  //                      a long-lived fault just cycles remedies forever and NOBODY IS EVER
  //                      TOLD, which is the failure the ladder exists to prevent.
  //   THE WINDOW         a remedy is rationed across faults that keep RETURNING. `cleared()`
  //                      deliberately keeps the timestamps for exactly this, so a screen with
  //                      a fault that comes back every twenty minutes cannot reboot itself
  //                      every twenty minutes.
  //
  // Both are needed and they answer different questions.
  const spentThisFault = (list) => (list || []).some((t) => Number(t) >= since);
  const age = now - since;
  if (age < policy.graceMs) {
    return out('wait', 'the fault is younger than the grace period', {
      readyIn: policy.graceMs - age,
    });
  }

  for (const step of policy.sequence) {
    if (step === 'swap') {
      if (hist.swappedAt) continue;                       // already done for this fault
      if (!ctx.fallback) {
        // NOT a silent skip. "There was nothing to swap to" is the repair (declare a
        // fallback), and it is invisible unless somebody says it.
        continue;
      }
      return out('swap', 'a fallback is available and costs her nothing', { to: ctx.fallback });
    }

    if (step === 'reload') {
      if (spentThisFault(hist.reloads)) continue;
      if ((hist.reloads || []).some((t) => now - t < policy.reloadWindowMs)) continue;
      // DELIBERATELY NOT GATED ON `inUse`, unlike the reboot. A reload is about two seconds
      // and the panel is ALREADY broken - making her wait for a working screen because she
      // is sitting in front of a broken one is the wrong trade. The reboot is a different
      // matter: it takes the whole screen away for a minute.
      return out('reload', 'the page can be restarted, which fixes most of what looks like a '
        + 'dead machine', { noticeMs: Math.min(policy.rebootNoticeMs, 5000), cancellable: true });
    }

    if (step === 'reboot') {
      // CAN THIS DEVICE EVEN DO IT? A browser cannot restart the host OS on any platform, so
      // on anything but hardware running a Nimrod helper this rung does not exist. Skipping
      // it rather than waiting on it is what keeps the ladder working on somebody else's
      // tablet - and `why` says so, because "nothing happened" needs a reason.
      if (ctx.canReboot === false) continue;
      // THE LOOP GUARD, in both of its forms. Checked BEFORE `inUse`, because a reboot that
      // is not going to happen at all should not make the ladder sit and wait for an empty
      // room - it should move on to telling somebody.
      if (spentThisFault(hist.reboots)) continue;
      if ((hist.reboots || []).some((t) => now - t < policy.rebootWindowMs)) continue;
      if (ctx.inUse) {
        return out('wait', 'somebody is using this screen right now', { blocked: 'in-use' });
      }
      return out('reboot', 'the fault has persisted and nobody is using the screen', {
        noticeMs: policy.rebootNoticeMs,
        // THE WARNING GOES ON THE DEVICE THAT IS ABOUT TO REBOOT (Mike). Anybody standing in
        // front of it can stop it, and — just as importantly — nobody is startled by a screen
        // that goes black on its own.
        notice: 'this screen will restart itself shortly',
        cancellable: true,
      });
    }

    if (step === 'notify') {
      if (hist.notifiedAt) continue;
      const urgency = URGENCIES.includes(ctx.urgency) ? ctx.urgency : 'normal';
      if (holdsNotice(urgency, ctx.hour, policy)) {
        return out('hold', 'quiet hours — this is not urgent enough to wake anybody', {
          urgency, releaseHour: releaseHour(policy),
        });
      }
      return out('notify', 'the ladder is exhausted and a person should know', { urgency });
    }
  }

  return out('done', 'every step in the sequence has been tried', {
    exhausted: true,
    // The honest end state. Everything automatic has been attempted and the fault is still
    // here, which is itself the most useful thing anybody could be told.
  });
}

// ---------------------------------------------------------------------------------------
// applied — the history a host keeps, updated. Pure, so a test can walk a whole ladder.
// ---------------------------------------------------------------------------------------
export function applied(history = {}, action, now = 0) {
  const h = { reboots: [], reloads: [], ...history };
  if (action === 'swap') return { ...h, swappedAt: now };
  if (action === 'reload') return { ...h, reloads: [...(h.reloads || []), now] };
  if (action === 'reboot') return { ...h, reboots: [...(h.reboots || []), now] };
  if (action === 'notify') return { ...h, notifiedAt: now };
  return h;
}

// A fault is over. Clearing `swappedAt` is what lets the panel come BACK — a module that
// recovers should get its slot again without anybody driving there. The reboot history is
// deliberately KEPT: it is what stops a fault that keeps returning from rebooting the screen
// every ten minutes forever.
export function cleared(history = {}) {
  const { swappedAt, notifiedAt, ...rest } = history || {};
  return { reboots: [], reloads: [], ...rest };
}
