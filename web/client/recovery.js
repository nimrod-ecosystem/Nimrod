// recovery.js — WHAT TO DO WHEN A PANEL STOPS WORKING, decided as data.
//
// The escalation ladder, and Mike's addition is the middle step:
//
//     notice -> SWAP TO SOMETHING THAT WORKS -> wait -> re-check -> reboot -> notify
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

export const STEPS = ['swap', 'reboot', 'notify'];
export const DEFAULT_SEQUENCE = ['swap', 'reboot', 'notify'];

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

  const age = now - (Number(fault.since) || 0);
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

    if (step === 'reboot') {
      if (ctx.inUse) {
        return out('wait', 'somebody is using this screen right now', { blocked: 'in-use' });
      }
      const recent = (hist.reboots || []).filter((t) => now - t < policy.rebootWindowMs);
      if (recent.length) {
        // THE LOOP GUARD. A second identical fault after a reboot means the reboot is not the
        // repair, so the ladder must move ON rather than round.
        continue;
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
  const h = { reboots: [], ...history };
  if (action === 'swap') return { ...h, swappedAt: now };
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
  return { reboots: [], ...rest };
}
