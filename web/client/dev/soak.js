// soak.js — DOES IT LEAK? Instrumentation for the one R-row nobody could check.
//
// *** WHY THIS EXISTS. ***
//
// `MIKE_CHANGE_LIST.md` R6: *"Nothing has run for longer than a few minutes. A bedside screen
// runs for WEEKS. Object URLs, the scan loop, the wake lock, the settings poll — none of it has
// been soaked, and the failure mode of a leak is a screen that dies at 3am."*
//
// R6 sits next to R1, R2, R5 and R8, and every one of those needs a Pi, a switch or a physical
// swap. **R6 does not.** A leak is a per-cycle growth, and growth is measurable in a browser in
// under a minute — you do not have to wait three weeks to find out that something adds a timer
// every time it is mounted. So this is the row that could be moved from this machine, and the
// reason it had not been is that nobody had written the meter.
//
// *** MEASURED, NOT GREPPED. ***
//
// Twice in the previous session a count taken by reading source patterns was wrong — eleven dead
// buttons that were nine, twenty-seven untested controls that were eighteen. Both times the
// method was the same mistake: inferring behaviour from call sites instead of running the thing.
// So nothing here reads a file. It wraps the browser's own registries, runs the real modules
// through the real mount/destroy contract, and reports the difference.
//
// *** THE ONE RULE THAT KEEPS THIS FROM CRYING WOLF: A ONE-TIME COST IS NOT A LEAK. ***
//
// A module's FIRST mount legitimately does things it never does again — lazily importing a
// stylesheet, priming a cache, registering a singleton. Comparing any of that against zero
// reports a leak on every module that has ever been optimised. What a leak actually looks like
// is a cost that recurs: cycle 5 holding more than cycle 4, holding more than cycle 3.
//
// So `growthPerCycle` throws away the first cycles and measures the SLOPE of the rest. A suite
// that reports a false leak is worse than no suite: it is a red nobody acts on, which is exactly
// the disease four suites in this folder were suffering from the same night this was written.

// ---------------------------------------------------------------------------------------
// The meter. Wraps the four registries a long-running screen actually dies of.
// ---------------------------------------------------------------------------------------
export function installMeter({ target = window } = {}) {
  const doc = target.document;

  const liveTimeouts = new Set();
  const liveIntervals = new Set();
  const liveFrames = new Set();
  const liveURLs = new Set();
  // Keyed `<what>:<event>` — a bare net number tells you something leaked and not what, and on
  // a screen somebody has to repair at a distance, "what" is the whole value of the report.
  const listeners = new Map();

  const orig = {
    setTimeout: target.setTimeout,
    clearTimeout: target.clearTimeout,
    setInterval: target.setInterval,
    clearInterval: target.clearInterval,
    raf: target.requestAnimationFrame,
    caf: target.cancelAnimationFrame,
    add: target.EventTarget.prototype.addEventListener,
    remove: target.EventTarget.prototype.removeEventListener,
    createURL: target.URL.createObjectURL,
    revokeURL: target.URL.revokeObjectURL,
  };

  // A TIMEOUT THAT HAS FIRED IS NOT OUTSTANDING. Counting it as live would report a leak for
  // every module that has ever used a one-shot delay, which is all of them.
  target.setTimeout = function (fn, ms, ...rest) {
    let id;
    const wrapped = typeof fn === 'function'
      ? function (...a) { liveTimeouts.delete(id); return fn.apply(this, a); }
      : fn;
    id = orig.setTimeout.call(target, wrapped, ms, ...rest);
    liveTimeouts.add(id);
    return id;
  };
  target.clearTimeout = function (id) { liveTimeouts.delete(id); return orig.clearTimeout.call(target, id); };

  // An interval is outstanding until somebody clears it, which is exactly the thing that kills a
  // screen at 3am: a module torn down while its heartbeat keeps beating.
  target.setInterval = function (fn, ms, ...rest) {
    const id = orig.setInterval.call(target, fn, ms, ...rest);
    liveIntervals.add(id);
    return id;
  };
  target.clearInterval = function (id) { liveIntervals.delete(id); return orig.clearInterval.call(target, id); };

  target.requestAnimationFrame = function (fn) {
    let id;
    id = orig.raf.call(target, (t) => { liveFrames.delete(id); return fn(t); });
    liveFrames.add(id);
    return id;
  };
  target.cancelAnimationFrame = function (id) { liveFrames.delete(id); return orig.caf.call(target, id); };

  target.URL.createObjectURL = function (obj) {
    const u = orig.createURL.call(target.URL, obj);
    liveURLs.add(u);
    return u;
  };
  target.URL.revokeObjectURL = function (u) { liveURLs.delete(u); return orig.revokeURL.call(target.URL, u); };

  // *** ONLY LISTENERS ON THINGS THAT OUTLIVE THE PANEL COUNT. ***
  //
  // A module's own DOM is thrown away with its host element, and every listener on it goes with
  // it — counting those would report a "leak" for every button any module has ever drawn, which
  // is a number so large and so meaningless that nobody would read the report twice.
  //
  // What DOES survive a panel is `window`, `document`, and anything the host handed the module
  // that it did not create: the bus, a media element the shell owns, the screen's own root.
  // Those are what a bedside screen accumulates over weeks.
  const survives = (t) => t === target || t === doc || t === doc.documentElement || t === doc.body;
  const nameOf = (t) => (t === target ? 'window'
    : t === doc ? 'document'
    : t === doc.documentElement ? 'html'
    : t === doc.body ? 'body' : 'other');

  target.EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (survives(this)) {
      const k = `${nameOf(this)}:${type}`;
      listeners.set(k, (listeners.get(k) || 0) + 1);
    }
    return orig.add.call(this, type, fn, opts);
  };
  target.EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (survives(this)) {
      const k = `${nameOf(this)}:${type}`;
      const n = (listeners.get(k) || 0) - 1;
      if (n <= 0) listeners.delete(k); else listeners.set(k, n);
    }
    return orig.remove.call(this, type, fn, opts);
  };

  return {
    /** A snapshot of everything outstanding, right now. */
    read() {
      return {
        timeouts: liveTimeouts.size,
        intervals: liveIntervals.size,
        frames: liveFrames.size,
        objectURLs: liveURLs.size,
        listeners: [...listeners.values()].reduce((a, b) => a + b, 0),
        nodes: doc.querySelectorAll('*').length,
      };
    },
    /** Which listeners are outstanding, so a leak names itself. */
    listenerDetail() { return Object.fromEntries(listeners); },
    /** Put the browser back the way it was. A meter left installed is its own leak. */
    uninstall() {
      target.setTimeout = orig.setTimeout;
      target.clearTimeout = orig.clearTimeout;
      target.setInterval = orig.setInterval;
      target.clearInterval = orig.clearInterval;
      target.requestAnimationFrame = orig.raf;
      target.cancelAnimationFrame = orig.caf;
      target.EventTarget.prototype.addEventListener = orig.add;
      target.EventTarget.prototype.removeEventListener = orig.remove;
      target.URL.createObjectURL = orig.createURL;
      target.URL.revokeObjectURL = orig.revokeURL;
    },
  };
}

export const METRICS = ['timeouts', 'intervals', 'frames', 'objectURLs', 'listeners', 'nodes'];

/**
 * The slope, in units per cycle, of the last `(samples.length - warmup)` samples.
 *
 * `warmup` is what makes this honest. See the header: the first mount of anything does one-time
 * work, and measuring against zero calls that a leak. Least squares rather than
 * (last - first) / n so one noisy sample — a garbage collection, a frame that happened to be in
 * flight — cannot invent a slope on its own.
 */
export function growthPerCycle(samples, warmup = 2) {
  const xs = samples.slice(warmup);
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (xs[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Run `fn` `cycles` times, sampling the meter after each, and report the per-cycle growth of
 * every metric.
 *
 * `settleMs` is not politeness: several modules arm their first timer on a delay rather than at
 * init, and a sample taken before that has not seen the thing it is measuring.
 */
export async function soak(meter, fn, { cycles = 6, settleMs = 160, warmup = 2 } = {}) {
  const series = Object.fromEntries(METRICS.map((m) => [m, []]));
  for (let i = 0; i < cycles; i += 1) {
    await fn(i);
    await new Promise((r) => setTimeout(r, settleMs));
    const s = meter.read();
    for (const m of METRICS) series[m].push(s[m]);
  }
  const growth = Object.fromEntries(METRICS.map((m) => [m, growthPerCycle(series[m], warmup)]));
  return { series, growth };
}

/**
 * What a growth figure means over the run a bedside screen actually has.
 *
 * Written as a SENTENCE ABOUT THE ROOM rather than a number, because "0.5 intervals per cycle"
 * is not a thing anybody can weigh, and "about 4,300 timers still running after a week" is.
 */
export function overAWeek(growthPerCycle_, cyclesPerHour) {
  const perWeek = growthPerCycle_ * cyclesPerHour * 24 * 7;
  if (Math.abs(perWeek) < 1) return 'nothing measurable over a week';
  return `about ${Math.round(perWeek).toLocaleString()} more after a week at ${cyclesPerHour}/hour`;
}
