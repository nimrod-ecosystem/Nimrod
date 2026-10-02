// person_known.js — "WHO IS THIS SCREEN FOR?", answered once, held, and told to latecomers.
//
// (2026-10-02. Mike's list 2026-09-30, Calls item 2: "other panels that read the person once at start
// ... may start without the person on a slow boot".)
//
// THE BUG. A screen learns whose it is in the background (kiosk.js: one GET of the screen's row), and
// its panels mount before that answer lands. Every panel that read `ctx.personId` at mount read null and
// kept it: photos, personal videos, the wallpaper, a button's picture and a board's pictures listed the
// ACCOUNT'S media (every resident's sources -- the management view) instead of this person's; the
// keyboard panel showed the shipped bindings, YouTube had no presets, and Wait and Go's music folder was
// looked up in the wrong list. The call panel had the same disease with its transport and was cured on
// its own (`CALL_TRANSPORT_READY`); this is the general cure.
//
// THE SHAPE. One handle per screen, `ctx.personKnown`, made by the kiosk:
//   get()          { settled, personId, reason } -- RETAINED: whoever asks late gets the answer
//   subscribe(fn)  fn(value) now if settled, and again whenever the answer CHANGES; returns off()
//   whenSettled()  a promise of the first answer
// `reason`: 'found' (the lookup named a person), 'none' (the screen is nobody's -- a finished answer),
// 'failed' / 'timeout' (no answer; the remembered person if there is one, else none).
//
// *** NEVER A GATE. *** Nothing here stops a panel drawing. A panel draws with what it knows and is
// told when the person arrives; the only thing that WAITS is a media panel's request for its list of
// sources, and only until the answer or the timeout -- and a screen with no answer carries on as
// "no person" (or the person it last had), never blank.
//
// HOSTS WITHOUT THE SIGNAL (home.js, module_try.js, every suite that builds its own ctx) are unchanged:
// with no `ctx.personKnown`, `ctx.personId` is taken as already settled, exactly as before.

/** Published on the screen's bus when the answer is reached or changes. The HANDLE is the retained
 *  record (a bus does not retain); this is for something that only listens. */
export const PERSON_KNOWN = 'person/known';

/**
 * HOW LONG A SCREEN WAITS FOR "WHOSE IS THIS" BEFORE CARRYING ON WITHOUT THE ANSWER: 10 seconds.
 * Argued, not chosen to look round:
 *   - What it waits on is one small request to the server that has just served this page. A refused
 *     or offline request FAILS at once and settles at once (with the remembered person); the timeout
 *     only bites a request that hangs without failing, which on facility wifi does happen.
 *   - Shorter costs the multi-person account: its panels list every resident's sources, then re-list
 *     when the answer lands -- a visible flip, and photos may say "more than one source" meanwhile.
 *   - Longer costs everybody on a hung boot: photos, videos and the wallpaper's pictures wait (the
 *     panels themselves draw -- the words, the ambient, the controls -- only the listing waits).
 *   - A late answer is not lost either way: it settles the handle again and every panel re-reads.
 * 0 means "never time out" (wait for the answer, however long). A seam on the kiosk (`personWaitMs`).
 */
export const PERSON_WAIT_MS = 10000;

const LOOKING = Object.freeze({ settled: false, personId: null, reason: 'looking' });

/**
 * The screen's one handle.
 *   timeoutMs   see PERSON_WAIT_MS; 0 = no timeout
 *   fallback()  who to carry on as when the time runs out (default: nobody)
 *   onSettle    told every time the answer is reached or changes (the kiosk publishes PERSON_KNOWN)
 */
export function createPersonKnown({
  timeoutMs = PERSON_WAIT_MS, fallback = () => null, onSettle = null,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
} = {}) {
  let value = LOOKING;
  let timer = null;
  let dead = false;
  const subs = new Set();
  let resolveFirst;
  const first = new Promise((r) => { resolveFirst = r; });

  function stopTimer() { if (timer != null) { clearTimer(timer); timer = null; } }

  function settle(personId, reason = 'found') {
    if (dead) return value;
    stopTimer();
    const next = Object.freeze({ settled: true, personId: personId || null, reason });
    const changed = !value.settled || value.personId !== next.personId;
    value = next;
    if (!changed) return value;   // the same person again (e.g. timeout, then the same answer): nothing to redo
    resolveFirst(value);
    for (const fn of [...subs]) { try { fn(value); } catch (err) { console.error('person_known: a subscriber', err); } }
    try { onSettle?.(value); } catch (err) { console.error('person_known: onSettle', err); }
    return value;
  }

  // The clock starts when the handle is made: the panels it serves are mounting now.
  if (Number(timeoutMs) > 0) {
    timer = setTimer(() => {
      timer = null;
      if (value.settled || dead) return;
      let fb = null;
      try { fb = fallback() || null; } catch { fb = null; }
      settle(fb, 'timeout');
    }, Number(timeoutMs));
  }

  return {
    get: () => value,
    settle,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      if (value.settled) { try { fn(value); } catch (err) { console.error('person_known: a subscriber', err); } }
      return () => subs.delete(fn);
    },
    whenSettled: () => (value.settled ? Promise.resolve(value) : first),
    destroy() { dead = true; stopTimer(); subs.clear(); },
  };
}

// ---- the module side -----------------------------------------------------------------------
// Small enough to read in one go; each listed panel uses one or two of these.

/** The person a panel should use right now: `ctx.personId` (a getter on the kiosk), or null. */
export function personOf(ctx) {
  try { return (ctx && ctx.personId) || null; } catch { return null; }
}

/** Resolves when the screen knows whose it is -- at once on a host with no signal. Never rejects. */
export function whenPersonKnown(ctx) {
  const h = ctx && ctx.personKnown;
  if (!h || typeof h.whenSettled !== 'function') return Promise.resolve(null);
  try { return Promise.resolve(h.whenSettled()).catch(() => null); } catch { return Promise.resolve(null); }
}

/**
 * Run `fn(personId)` NOW with whoever is known (null if nobody yet), and again each time the screen's
 * answer names somebody different. Returns off(). For a panel that draws first and fills in later
 * (the keyboard's bindings, YouTube's presets).
 */
export function followPerson(ctx, fn) {
  let last = personOf(ctx);
  try { fn(last); } catch (err) { console.error('person_known: follow', err); }
  const h = ctx && ctx.personKnown;
  if (!h || typeof h.subscribe !== 'function') return () => {};
  return h.subscribe((v) => {
    const p = (v && v.personId) || null;
    if (p === last) return;
    last = p;
    try { fn(p); } catch (err) { console.error('person_known: follow', err); }
  });
}

/**
 * A media-sources client that belongs to WHOEVER THE SCREEN IS FOR, not to whoever it was at mount.
 * `make(personId)` builds the real one (media_sources.js `createMediaSourcesClient`); this rebuilds it
 * when the person changes, and its `list()` waits for the answer first, so a panel never asks for the
 * account's whole list on a person's screen just because it mounted early. `onChange(personId)` is
 * called when the person changes AFTER a list was made for somebody else -- the panel re-lists.
 * `dispose()` lets go of the screen's handle (call it from the panel's destroy).
 */
export function personSources(ctx, make, { onChange = null } = {}) {
  let pid, client = null;
  let listedFor;            // undefined until a list has been made
  let listedReason;         // the screen's answer's reason when that list was made
  const current = () => {
    const p = personOf(ctx);
    if (!client || p !== pid) { pid = p; client = make(p); }
    return client;
  };
  const h = ctx && ctx.personKnown;
  const off = (h && typeof h.subscribe === 'function')
    ? h.subscribe((v) => {
      const p = (v && v.personId) || null;
      if (listedFor === undefined || p === listedFor) return;
      try { onChange?.(p); } catch (err) { console.error('person_known: sources changed', err); }
    })
    : () => {};
  return {
    async list(...a) {
      await whenPersonKnown(ctx);
      const c = current();
      listedFor = pid;
      try { listedReason = h && typeof h.get === 'function' ? h.get().reason : undefined; } catch { listedReason = undefined; }
      return c.list(...a);
    },
    // *** MAY A PANEL SAVE A CHOICE MADE FROM THE LAST LIST? *** Not when that list was made after the
    // wait ran out (`timeout`): then nobody knows whose screen this is, the list is the whole account's,
    // and "the only source there, so save it" would write a wrong fact that outlives the timeout. The
    // listing may still be SHOWN. 'screen-row' / 'found' / 'none' (known to be nobody's) are answers;
    // a host with no signal is settled by definition. A late person re-lists, and then it may save.
    trusted: () => listedReason !== 'timeout',
    add: (...a) => current().add(...a),
    remove: (...a) => current().remove(...a),
    moveTo: (...a) => current().moveTo(...a),
    personId: () => personOf(ctx),
    dispose: () => { try { off(); } catch { /* already gone */ } },
  };
}
