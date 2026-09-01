// health.js — IS THIS PANEL ACTUALLY BROKEN?
//
// `recovery.js` decides what to DO about a fault. It never decides whether there is one, and
// that separation is the whole reason both halves are testable: the ladder can be walked at a
// fake clock without anything being broken, and this can be reasoned about without anything
// rebooting.
//
// ---------------------------------------------------------------------------------------
// THE HARD PART IS NOT ERRORS. IT IS SILENCE.
//
// A module that throws is easy and rare. The failure that actually happens at a bedside is a
// panel that is UP, drawing, apparently fine, and has not changed in forty minutes — a
// YouTube player wedged on a spinner, a slideshow whose source stopped answering, a director
// whose segment never ended. Nothing threw. Nothing is in the console. From across the room
// it looks exactly like a screen that is working.
//
// THE COLLECTOR ALREADY LEARNED THIS EXACT LESSON: *"stuck was indistinguishable from
// finished... quietly returning a fraction for a month is the worst outcome available."* It
// now says it is stalled and where it got to. This is that idea applied to a panel.
//
// So a module is healthy when it is DOING something, and the only reliable evidence of that
// is that it says so. A panel that has published nothing for longer than it should have is
// the primary signal; an error is a bonus.
//
// ---------------------------------------------------------------------------------------
// WHY MODULES DO NOT HAVE TO CHANGE.
//
// They already publish. `photos/next` fires on every advance, the director publishes
// `segment/done` and `segment/progress`, a player reports its state. This watches the bus for
// ANY topic a module owns — its own prefix — and treats that as a heartbeat. **A module that
// was already talking is already monitored**, which is what makes this cheap enough to be
// worth having.
//
// A module that genuinely has nothing to say can declare `idle: true` and is never judged
// silent. The clock is the obvious one: it redraws every second and publishes nothing, and
// calling it dead would be the tool's fault rather than the clock's.
//
// ---------------------------------------------------------------------------------------
// FALSE POSITIVES ARE THE ONLY FAILURE MODE THAT MATTERS.
//
// A missed fault costs a person an afternoon of a broken panel — bad, and the thing this
// exists to reduce. A FALSE fault swaps away a panel somebody was watching, or reboots a
// screen that was fine. **The second is worse**, because it breaks a thing that was working
// and it destroys trust in every alert that follows. Every default here is set to under-report
// rather than over-report, and `expectMs` is deliberately generous.
//
// EVERYTHING IS PURE. It takes observations and returns a verdict.

// A panel is judged silent only after this long with nothing from it. A module may declare
// its own; this is the fallback for one that does not.
export const DEFAULT_EXPECT_MS = 15 * 60 * 1000;

// How long a panel is given to say anything at all after it mounts. Some modules do real work
// before their first publish — a media listing over a facility connection is not fast — and
// judging one at ten seconds would mostly measure the network.
export const DEFAULT_SETTLE_MS = 2 * 60 * 1000;

export const FAULT_KINDS = ['stalled', 'errored', 'empty'];

// What "it should have said something by now" means, per module type, in ms. Data rather than
// logic, the same as MODULE_VERBS — and `idle` is not a special case in the code, it is a row.
//
// THESE ARE UPPER BOUNDS ON SILENCE, NOT EXPECTED INTERVALS. A slideshow on its slowest
// setting advances once a minute; sixty minutes of silence from one is genuinely wrong.
export const HEALTH_EXPECT = {
  photos:      { expectMs: 60 * 60 * 1000 },
  personal:    { expectMs: 60 * 60 * 1000 },
  youtube:     { expectMs: 90 * 60 * 1000 },
  educational: { expectMs: 60 * 60 * 1000 },
  director:    { expectMs: 60 * 60 * 1000 },
  // Draws constantly, publishes nothing. Silence is its normal state.
  clock:       { idle: true },
  camera:      { idle: true },
  pond:        { idle: true },
  comet:       { idle: true },
  pressgame:   { idle: true },
  call:        { idle: true },
  counter:     { idle: true },
  // Games only move when somebody plays them, and nobody playing is not a fault.
  wordforge:   { idle: true },
  algebra:     { idle: true },
  trivia:      { idle: true },
  // *** ADDED 2026-08-31, AND ALL FOUR WERE ALREADY WRONG. ***
  //
  // `trivia`, `bank`, `wallpaper` and `board` shipped without rows, so they fell to the
  // 15-minute default and were judged STALLED for doing exactly what they are supposed to do.
  // A board nobody has touched for twenty minutes is a board. A wallpaper publishes nothing at
  // all — it is the `clock` case precisely. An editor with nobody typing at it is an editor.
  //
  // The consequence was not cosmetic: a false fault feeds the recovery ladder, and the ladder
  // SWAPS THE PANEL AWAY. So a quiet communication board would have been replaced under
  // somebody who was about to use it — which is the false positive this file's own header calls
  // the only failure mode that matters, arriving through a missing table row rather than
  // through a bad judgement.
  //
  // Found because the board happened to become the chosen fallback in `kiosk_test`, so the
  // fault never cleared and the ladder climbed on. Nothing was watching for the general case,
  // which is why `modules_catalog_test` now fails if a registered module has no row here.
  bank:        { idle: true },
  wallpaper:   { idle: true },
  board:       { idle: true },
  quests:      { idle: true },
  sprint:      { idle: true },
  progress:    { idle: true },
  lessons:     { idle: true },
};

export function expectFor(type, table = HEALTH_EXPECT) {
  const row = table[type] || {};
  return {
    idle: !!row.idle,
    expectMs: Number.isFinite(row.expectMs) ? row.expectMs : DEFAULT_EXPECT_MS,
    settleMs: Number.isFinite(row.settleMs) ? row.settleMs : DEFAULT_SETTLE_MS,
  };
}

// ---------------------------------------------------------------------------------------
// judgePanel — one panel, one verdict. PURE.
//
// `panel`  { id, type, mountedAt, lastSeenAt, lastErrorAt, reportedEmpty }
// `now`    ms
//
// Returns `{ ok, kind, since, why }`. `kind` is null when it is fine.
// ---------------------------------------------------------------------------------------
export function judgePanel(panel = {}, now = 0, table = HEALTH_EXPECT) {
  const { idle, expectMs, settleMs } = expectFor(panel.type, table);
  const mountedAt = Number(panel.mountedAt) || 0;
  const good = (kind = null, why = '') => ({ ok: !kind, kind, since: null, why });

  // AN ERROR IS BELIEVED IMMEDIATELY, because unlike silence it is unambiguous — something
  // said so. Reported even for an `idle` module: a clock that threw is still broken.
  if (panel.lastErrorAt) {
    return { ok: false, kind: 'errored', since: Number(panel.lastErrorAt),
             why: panel.errorText || 'the panel reported an error' };
  }

  // A PANEL THAT SAYS IT HAS NOTHING TO SHOW IS NOT BROKEN SOFTWARE, and this is the one that
  // would otherwise be mistaken for it: "no photo source connected" is a setup state with a
  // human repair, and rebooting a screen over it would be absurd. Reported so a person can be
  // told, and marked so the ladder can skip straight past the machine remedies.
  if (panel.reportedEmpty) {
    return { ok: false, kind: 'empty', since: Number(panel.emptySince) || mountedAt,
             why: panel.emptyText || 'the panel has nothing to show' };
  }

  if (idle) return good();                 // silence is its normal state

  // Still settling. Some modules do real work before their first publish, and judging one at
  // ten seconds would mostly measure the network.
  const seen = Number(panel.lastSeenAt) || 0;
  if (!seen && now - mountedAt < settleMs) return good();
  if (!seen) {
    // IT MOUNTED AND NEVER SAID A WORD. Worth reporting as stalled from the MOUNT, not from
    // now — the fault is as old as the panel, and dating it from the moment somebody noticed
    // would restart the grace period every time it was checked.
    return { ok: false, kind: 'stalled', since: mountedAt,
             why: 'the panel has not said anything since it mounted' };
  }

  if (now - seen > expectMs) {
    return { ok: false, kind: 'stalled', since: seen,
             why: 'the panel has been silent longer than it should be' };
  }
  return good();
}

// Everything on a screen at once. Returns only the faults, worst first — an error is more
// certain than silence, and a fault that is older is more certain than a fresh one.
export function judgeScreen(panels = [], now = 0, table = HEALTH_EXPECT) {
  const rank = { errored: 0, stalled: 1, empty: 2 };
  return (panels || [])
    .map((p) => ({ panel: p, ...judgePanel(p, now, table) }))
    .filter((v) => !v.ok)
    .map((v) => ({ module: v.panel.id, type: v.panel.type, kind: v.kind, since: v.since, why: v.why }))
    .sort((a, b) => (rank[a.kind] - rank[b.kind]) || (a.since - b.since));
}

// ---------------------------------------------------------------------------------------
// createHealthWatch — the only impure part, and it is thin on purpose.
//
// It listens for heartbeats and remembers the last one per panel. It does not decide anything
// and it does not act; a host asks it for panels and hands those to `judgeScreen`.
//
// A HEARTBEAT IS ANY PUBLISH ON A TOPIC THE MODULE OWNS, which is why no module had to change:
// `photos/next` from a slideshow, `segment/done` from the director. Prefix matching is crude
// and it is the right kind of crude — it cannot go stale when a module adds a topic.
// ---------------------------------------------------------------------------------------
export function createHealthWatch({ bus, now = () => Date.now() } = {}) {
  if (!bus) throw new Error('createHealthWatch: a bus is required');
  const panels = new Map();     // id -> record
  const offs = [];

  function add(id, type) {
    const t = now();
    panels.set(id, { id, type, mountedAt: t, lastSeenAt: 0, lastErrorAt: 0 });
    return panels.get(id);
  }
  function forget(id) { panels.delete(id); }

  function beat(id) {
    const p = panels.get(id);
    if (!p) return;
    p.lastSeenAt = now();
    // A HEARTBEAT CLEARS AN ERROR. A panel that recovered on its own must not stay marked
    // broken forever — otherwise one transient blip pins it at "faulty" until a remount, and
    // the ladder acts on a fault that is no longer there.
    p.lastErrorAt = 0;
    p.reportedEmpty = false;
  }

  function fail(id, text = '') {
    const p = panels.get(id);
    if (!p) return;
    p.lastErrorAt = now();
    p.errorText = String(text || '');
  }

  function empty(id, text = '') {
    const p = panels.get(id);
    if (!p) return;
    if (!p.reportedEmpty) p.emptySince = now();
    p.reportedEmpty = true;
    p.emptyText = String(text || '');
  }

  // One subscription per panel prefix rather than a wildcard, because the bus has no wildcard
  // and adding one for this would be a bigger change than the feature.
  function watch(id, type, prefixes = null) {
    const rec = add(id, type);
    for (const prefix of prefixes || [type]) {
      // Topics are `<prefix>/<something>`; a module owns its own prefix by convention and
      // MODULE_VERBS already relies on that.
      for (const topic of [`${prefix}/next`, `${prefix}/prev`, `${prefix}/shown`,
                           `${prefix}/state`, 'segment/done', 'segment/progress']) {
        offs.push(bus.subscribe(topic, () => beat(id)));
      }
    }
    return rec;
  }

  return {
    watch, forget, beat, fail, empty,
    has: (id) => panels.has(id),
    panels: () => [...panels.values()].map((p) => ({ ...p })),
    // The whole point, in one call.
    faults: (table = HEALTH_EXPECT) => judgeScreen([...panels.values()], now(), table),
    destroy() {
      offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
      offs.length = 0;
      panels.clear();
    },
  };
}
