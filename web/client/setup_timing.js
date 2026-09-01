// setup_timing.js — HOW LONG A FIRST SETUP ACTUALLY TAKES.
//
// The landing page has a hole in it, and the hole is deliberate. Mike, 2026-09-01:
//
//   *"WRITE NOTHING. I have not done a setup end to end yet, so nobody knows the real number
//   and the page must not guess one."*
//
// A caregiver deciding whether they have the evening for this is exactly the reader an
// invented estimate would betray, and "about twenty minutes" from somebody who has never done
// it is a lie that costs somebody their Saturday. So the section is absent until there is a
// measurement, and this is the thing that measures it.
//
// The demo-account setup for the walkthrough video is the first real end-to-end setup anybody
// will do. It happens once. Instrumenting it is the difference between a number and a guess.
//
// ---------------------------------------------------------------------------------------
// *** OFF UNLESS SOMEBODY ASKS FOR IT, AND NEVER LEAVES THE MACHINE ***
// ---------------------------------------------------------------------------------------
//
// This measures a person using the product. On a privacy-pitched project that makes it exactly
// the kind of thing that must not be quietly on:
//
//   * it is enabled by `?instrument=setup` in the URL and by nothing else — no setting, no
//     remembered flag, no server switch. Somebody has to mean it, every time.
//   * it writes to `localStorage` on that one machine and to nowhere else. There is no
//     endpoint, no beacon, and no code path here that can reach the network.
//   * it records STEP NAMES AND CLOCK TIMES. Not what was typed, not what was chosen, not
//     which folder, not who. A duration cannot identify anybody; the content of a setup can.
//   * `export()` hands the log back as text for a person to paste somewhere. Nothing sends it.
//
// If any of that ever needs to change, it stops being an instrument and becomes analytics, and
// that is a different decision with a different answer.
//
// ---------------------------------------------------------------------------------------
// WHY WALL-CLOCK GAPS AND NOT A STOPWATCH
// ---------------------------------------------------------------------------------------
//
// The interesting number is not "how long was the software busy". It is **how long the person
// took**, including reading the screen, finding the folder, going to look for the cable, and
// stopping to answer the door. Those gaps ARE the setup experience, and a stopwatch that only
// runs while something is happening measures the wrong thing.
//
// So each mark carries the real elapsed time since the previous one, and `report()` says which
// gap was the longest. **The longest gap is the answer to "where do people get stuck"**, which
// is the other question the landing page cannot answer yet.
//
// A gap longer than `pauseMs` is recorded as `paused: true` rather than dropped — somebody who
// walked away for lunch should not have that counted as difficulty, and should not have it
// silently deleted either.

export const STORAGE_KEY = 'nimrod.setupLog';

// The milestones of a first setup, in the order they normally happen. `optional` steps are
// genuinely skippable, so a run that lacks them is complete rather than abandoned.
export const MILESTONES = [
  { id: 'arrive',        label: 'Landed on the site' },
  { id: 'signin-start',  label: 'Started signing in' },
  { id: 'signin-done',   label: 'Signed in' },
  { id: 'screen-named',  label: 'Named a screen' },
  { id: 'screen-made',   label: 'Created the screen' },
  { id: 'module-first',  label: 'Added the first module' },
  { id: 'module-done',   label: 'Finished adding modules' },
  { id: 'media-start',   label: 'Started connecting a media folder', optional: true },
  { id: 'media-done',    label: 'Media folder connected', optional: true },
  { id: 'kiosk-open',    label: 'Opened the screen' },
  { id: 'kiosk-working', label: 'Confirmed it is actually working' },
];

const MILESTONE_IDS = new Set(MILESTONES.map((m) => m.id));

/** Is instrumentation asked for? Query string only — see the header. */
export function instrumentRequested(search = (typeof location !== 'undefined' ? location.search : '')) {
  try { return new URLSearchParams(search).get('instrument') === 'setup'; }
  catch { return false; }
}

/**
 * The log.
 *
 * Append-only within a run, and it survives a page navigation — a setup crosses `landing.html`,
 * an OAuth round trip, `home.html` and `kiosk.html`, so anything held in memory would lose the
 * most interesting part.
 */
export function createSetupLog({
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  now = () => Date.now(),
  // Longer than this and the person was doing something else. Recorded, flagged, not dropped.
  pauseMs = 5 * 60 * 1000,
} = {}) {
  const read = () => {
    try { return JSON.parse(storage?.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  };
  const write = (rows) => {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* private mode */ }
  };

  return {
    /**
     * Record reaching a milestone. Unknown ids are refused rather than stored: the whole value
     * of this log is that it can be read against MILESTONES, and free-text step names would
     * also be the first place somebody accidentally writes something personal.
     */
    mark(id, { at = null } = {}) {
      if (!MILESTONE_IDS.has(id)) return null;
      const rows = read();
      // Idempotent. A page that re-mounts, or a person who goes back and forth, must not
      // turn one milestone into three and make the gaps meaningless.
      if (rows.some((r) => r.id === id)) return null;
      const t = at != null ? at : now();
      const prev = rows.length ? rows[rows.length - 1] : null;
      const gap = prev ? t - prev.at : 0;
      const row = { id, at: t, gapMs: gap, paused: gap > pauseMs };
      rows.push(row);
      write(rows);
      return row;
    },

    entries: () => read(),

    /**
     * What actually happened, in a shape the landing page copy can be written from.
     *
     * `activeMs` excludes the long pauses; `elapsedMs` does not. Both are reported, because
     * "it took an hour, forty minutes of which was lunch" and "it took twenty minutes" are
     * different sentences and only one of them is honest on its own.
     */
    report() {
      const rows = read();
      if (rows.length < 2) return { steps: rows.length, complete: false };
      const elapsed = rows[rows.length - 1].at - rows[0].at;
      const active = rows.reduce((n, r) => n + (r.paused ? 0 : r.gapMs), 0);
      const gaps = rows.slice(1).filter((r) => !r.paused);
      const worst = gaps.slice().sort((a, b) => b.gapMs - a.gapMs)[0] || null;
      const seen = new Set(rows.map((r) => r.id));
      const missing = MILESTONES.filter((m) => !m.optional && !seen.has(m.id)).map((m) => m.id);
      return {
        steps: rows.length,
        complete: missing.length === 0,
        missing,
        elapsedMs: elapsed,
        activeMs: active,
        pausedMs: elapsed - active,
        // THE ANSWER TO "WHERE DO PEOPLE GET STUCK", which is the other question the landing
        // page cannot answer yet. One run is an anecdote, not data — but one honest anecdote
        // beats the invented estimate it replaces.
        longestStep: worst ? { id: worst.id, ms: worst.gapMs } : null,
      };
    },

    /** Human-readable, for pasting into the work order. Nothing here sends anything. */
    export() {
      const rows = read();
      const label = (id) => (MILESTONES.find((m) => m.id === id) || {}).label || id;
      const mmss = (ms) => {
        const s = Math.round(ms / 1000);
        return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
      };
      const r = this.report();
      const lines = rows.map((row, i) => (i === 0
        ? `  ${label(row.id)}`
        : `  +${mmss(row.gapMs)}${row.paused ? '  (paused — counted separately)' : ''}  ${label(row.id)}`));
      if (!rows.length) return 'No setup recorded.';
      return [
        'FIRST SETUP, measured — not estimated.',
        '',
        ...lines,
        '',
        `  total elapsed   ${mmss(r.elapsedMs || 0)}`,
        `  hands-on        ${mmss(r.activeMs || 0)}`,
        `  stepped away    ${mmss(r.pausedMs || 0)}`,
        r.longestStep ? `  longest step    ${label(r.longestStep.id)} (${mmss(r.longestStep.ms)})` : '',
        r.complete ? '' : `  INCOMPLETE — never reached: ${r.missing.join(', ')}`,
      ].filter(Boolean).join('\n');
    },

    reset() { try { storage?.removeItem(STORAGE_KEY); } catch { /* private mode */ } },
  };
}

/**
 * Wire it up, if and only if it was asked for.
 *
 * Returns null when it was not, so every call site is one `?.mark()` away from being a no-op
 * and nobody has to remember to guard it.
 */
export function attachSetupLog(opts = {}) {
  if (!instrumentRequested(opts.search)) return null;
  const log = createSetupLog(opts);
  // So the person running the setup can get the log out without opening a file:
  //   copy(window.nimrodSetupLog.export())
  try {
    if (typeof window !== 'undefined') window.nimrodSetupLog = log;
    console.info('%cSetup timing is ON for this run. window.nimrodSetupLog.export() when done.',
                 'font-weight:700');
  } catch { /* no window: a test */ }
  return log;
}
