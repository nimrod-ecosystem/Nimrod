// PRESS THE CONTROL A PERSON ACTUALLY TOUCHES, not the topic underneath it.
//
// WHY THIS FILE EXISTS. On 2026-09-05 nine controls across five modules did nothing when
// pressed - photos, youtube, personal and educational next+prev, and interstitials' skip -
// because `bus.route()` dropped bare signals. The suite was green throughout, because every
// module ALSO answers its bus topic directly and every test drove the TOPIC:
// `bus.publish('photos/next')`. The topic worked perfectly. Nobody drove the BUTTON.
//
// A test that exercises the layer UNDERNEATH the thing a person touches will stay green
// through exactly that. This runs the top layer.
//
// It deliberately needs NO SERVER, NO AGENT and NO NETWORK: the claim is only that the
// control is WIRED to its topic, which is precisely what broke. Whether the topic then does
// something useful is the rest of each module's own suite.
//
// `dev/unpressed_controls.py` lists which controls still have nobody on top of them.

import { createBus } from '../bus.js';
import { mountModule } from '../module.js';

// A context with every handle present but inert. `dependsOn` is about how EXPOSED a module
// is; this is about what it needs to EXIST - omit `makeEvents`/`makeState` and seven modules
// throw on mount, which reads as "fragile" when it is nothing of the kind.
function inertCtx({ mount, bus, state, user, sources }) {
  const events = { append: () => Promise.resolve(), subscribe() {}, load: () => Promise.resolve() };
  return {
    mount, bus, state, events, user: user || 'test-user', profileId: 'p', personId: null,
    makeEvents: () => events,
    makeState: () => state,
    sources: sources || { list: async () => [], add: async () => ({}), remove: async () => {} },
  };
}

function fakeState(initial = {}) {
  let cfg = { ...initial };
  const subs = [];
  return {
    get: () => cfg,
    set: (p) => { cfg = { ...cfg, ...p }; subs.forEach((f) => f(cfg)); },
    // The real store calls a new subscriber IMMEDIATELY once loaded, and several modules do
    // all of their first load from inside that callback. A stub that only stores the function
    // gives you a module that mounts, renders its chrome and never loads anything - which
    // looks like a broken module and is a broken harness.
    subscribe: (f) => { subs.push(f); f(cfg); return () => {}; },
    flush() {},
    _cfg: () => cfg,
  };
}

/**
 * Press each control and assert it reaches its topic.
 *
 * @param {string} type      module type, e.g. 'youtube'
 * @param {object[]} controls  [{ sel, topic, label }]
 * @param {function} check    the suite's own check(name, cond, detail)
 * @param {object} opts       { settings, sources, presses }
 */
export async function pressControls(type, controls, check, opts = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;height:380px';
  document.body.append(host);

  const bus = createBus();
  const fired = {};
  for (const c of controls) {
    fired[c.topic] = 0;
    bus.subscribe(c.topic, () => { fired[c.topic]++; });
  }

  const state = fakeState(opts.settings || {});
  let inst = null, mountError = null;
  try {
    inst = mountModule(type, inertCtx({ mount: host, bus, state, sources: opts.sources }));
    inst.init();
  } catch (e) {
    mountError = String((e && e.message) || e);
  }
  check(`${type} mounts with an inert context`, mountError === null, mountError || '');
  if (mountError) { host.remove(); return { fired, host }; }

  await new Promise((r) => setTimeout(r, opts.settle == null ? 150 : opts.settle));

  for (const c of controls) {
    const el = host.querySelector(c.sel);
    check(`${type}: ${c.label} exists`, !!el, c.sel);
    if (!el) continue;
    const before = fired[c.topic];
    el.click();
    await new Promise((r) => setTimeout(r, 40));
    check(`*** ${type}: PRESSING ${c.label} reaches ${c.topic} ***`,
      fired[c.topic] === before + 1, `fired=${fired[c.topic] - before}`);
  }

  // A second press must count too - a control that fires once and then goes quiet is the
  // same dead button from the person's side.
  const first = controls[0];
  if (first && host.querySelector(first.sel)) {
    const before = fired[first.topic];
    host.querySelector(first.sel).click();
    host.querySelector(first.sel).click();
    await new Promise((r) => setTimeout(r, 60));
    check(`${type}: repeated presses each count`, fired[first.topic] === before + 2,
      `fired=${fired[first.topic] - before}`);
  }

  try { inst.destroy(); } catch { /* destroy is the module's business, not this check's */ }
  host.remove();
  return { fired, state };
}

/**
 * `hidden` must actually HIDE. Four modules set `display:flex` on `.status`, which outranks
 * the browser's own `[hidden]{display:none}` - so `el.hidden = true` set the attribute and
 * changed nothing on screen. That is the "Loading photos... sheet sitting over the photos"
 * seen on the live site while the code that hid it was already correct.
 *
 * Requires `modules.css` to be linked by the test page, which is the point: without it this
 * passes on a bare page and fails on the real screen.
 */
export function checkHiddenHides(moduleClass, childClass, check, label) {
  const parent = document.createElement('div');
  parent.className = moduleClass;
  const el = document.createElement('div');
  el.className = childClass;
  parent.append(el);
  document.body.append(parent);

  el.hidden = true;
  const hidden = getComputedStyle(el).display;
  el.hidden = false;
  const shown = getComputedStyle(el).display;
  parent.remove();

  const what = label || `.${moduleClass} .${childClass}`;
  check(`*** [hidden] actually hides ${what} ***`, hidden === 'none', `display=${hidden}`);
  check(`...and ${what} still shows when not hidden`, shown !== 'none', `display=${shown}`);
}

/**
 * PRESS THE RECOVERY BUTTON. The one somebody reaches for when something is ALREADY wrong,
 * which makes it the worst control in the module to leave untested - it only ever runs on a
 * day that is already going badly.
 *
 * Deterministic and offline: point the module at a source that cannot be reached, wait for
 * its failure sheet, press Retry, and assert the module went back and ASKED AGAIN. The probe
 * is the injected registry's own call count, so nothing depends on a network or a timeout.
 *
 * @param {string} type    module type
 * @param {function} check the suite's check(name, cond, detail)
 * @param {object} opts    { settings, sourceKind }
 */
export async function pressRetry(type, check, opts = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;height:380px';
  document.body.append(host);

  let listCalls = 0;
  // Port 9 is "discard" - it refuses immediately rather than hanging, so the failure sheet
  // appears in milliseconds instead of on a connect timeout.
  // Port 9 is refused immediately AND is on Chrome's unsafe-port list, so the fetch fails
  // fast either way - the point is only that it never succeeds and never hangs.
  const source = { id: 'dead-1', label: 'Unreachable source',
                   kind: opts.sourceKind || 'agent', base_url: 'http://127.0.0.1:9' };
  const state = fakeState({ sourceId: 'dead-1', intervalMs: 3600000, ...(opts.settings || {}) });

  let inst = null, mountError = null;
  try {
    inst = mountModule(type, inertCtx({
      mount: host, bus: createBus(), state,
      sources: { list: async () => { listCalls++; return [source]; },
                 add: async () => source, remove: async () => {} },
    }));
    inst.init();
  } catch (e) {
    // A THROW HERE MUST BECOME A VISIBLE FAILURE, never a hang. This helper is called from
    // outside some suites' try/catch, so an uncaught rejection leaves the page stuck on
    // "running…" with no failing row - which reads as a slow test rather than a broken one.
    mountError = String((e && e.message) || e);
  }
  check(`${type} mounts for the recovery check`, mountError === null, mountError || '');
  if (mountError) { host.remove(); return { listCalls }; }

  // Wait for the failure sheet, bounded by the CLOCK rather than by a tick count. A hidden
  // browser pane throttles timers to roughly one a second, so a 40 x 50ms loop that should
  // take two seconds took thirty-six - which reads as a hung suite, not a slow one.
  let btn = null;
  const deadline = Date.now() + 3000;
  while (!btn && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60));
    btn = host.querySelector('[data-retry]');
  }
  check(`${type}: an unreachable source offers Retry`, !!btn,
    `status="${(host.querySelector('[data-status]')?.textContent || '').trim()}"`);

  const status = (host.querySelector('[data-status]') || {}).textContent || '';
  check(`${type}: ...and says the source is unreachable rather than blaming the platform`,
    /unreachable/i.test(status), status.trim());

  if (btn) {
    const before = listCalls;
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    check(`*** ${type}: PRESSING Retry actually asks again ***`, listCalls > before,
      `list() calls ${before} -> ${listCalls}`);
  }

  try { inst.destroy(); } catch { /* not this check's business */ }
  host.remove();
  return { listCalls };
}

// ---------------------------------------------------------------------------------------
// agentReachable — IS THE THING THIS SUITE NEEDS ACTUALLY RUNNING?
//
// *** WHY THIS EXISTS, AND IT IS THE SAME DISEASE AS A CHECK THAT CANNOT FAIL. ***
//
// `media_stall` reported 24 FAILED and `personal` 7 FAILED on 2026-09-06. Nothing was broken.
// Both need a media agent (`python agent.py --port 8770` / `8771`) and neither was running, so
// two dozen assertions about video playback failed for the reason that there was no video.
//
// A suite that reports two dozen failures for a missing prerequisite is a suite whose red means
// nothing — and a red nobody acts on trains everybody to read red as normal, which is exactly how
// `composer_test` and `panel_fit_test` sat failing for days on top of work that was CORRECT.
// "Cannot run" and "ran and was wrong" are different facts and must not print the same.
//
// It uses a HEAD with a short abort rather than waiting on a connection: a refused connection is
// instant, but a firewalled port hangs for the OS timeout, and a suite that appears to freeze is
// worse than one that says it was skipped.
export async function agentReachable(baseURL, { timeoutMs = 1500 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // `no-cors` so a bare agent with no CORS headers still counts as REACHABLE. The question
    // here is "is something listening", not "will it answer this request politely" — the suite
    // itself is what tests the second one.
    await fetch(`${String(baseURL).replace(/\/+$/, '')}/`, {
      method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Print the one line a skipped suite should print, and hand back `false` so the caller can stop.
 * SKIP is deliberately not a pass: a green summary for a suite that never ran is the flattering
 * number this whole file exists to avoid.
 */
export function reportSkipped(what, urls) {
  const out = document.getElementById('results') || document.body;
  const d = document.createElement('div');
  d.className = 'skip';
  d.style.cssText = 'color:#7a5a12;font-weight:700;margin:10px 0;padding:10px 12px;'
    + 'background:#fdf0d5;border-radius:8px;max-width:76ch';
  d.textContent = `SKIPPED — ${what} is not running (${[].concat(urls).join(', ')}). `
    + 'Nothing here failed; nothing here ran either. Start it and reload.';
  out.append(d);
  const sum = document.getElementById('summary');
  if (sum) {
    sum.textContent = `SKIPPED — ${what} not running`;
    sum.className = 'skip';
    sum.style.color = '#7a5a12';
    sum.dataset.done = 'true';
    sum.dataset.failed = '0';
    sum.dataset.skipped = 'true';
  }
  return false;
}
