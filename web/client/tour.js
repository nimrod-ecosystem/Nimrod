// tour.js — THE GUIDED TOUR. The same list the video is made of, walked by a person instead.
//
// Mike, on the recorder: *"Can we use this as a guided tour of the site where they get walked
// through the script?"* This is that. `steps.js` is the single source; the recorder PERFORMS the
// steps while Playwright films them, and this WAITS at each one while a person does it
// themselves. Nothing is written twice — and the recorder executing the same list is what keeps
// these selectors honest, because a target that goes stale fails a recording instead of leaving
// the tour quietly pointing at nothing.
//
// ---------------------------------------------------------------------------------------
// *** IT IS NOT A MODULE, AND THIS IS THE ARGUMENT MIKE ASKED TO SEE BEFORE IT WAS BUILT ***
// ---------------------------------------------------------------------------------------
//
// The standing ask is that everything is a module, and a tour that explains modules while being
// one is exactly the recursion worth wanting. It cannot be one here, for a reason about
// capability rather than taste:
//
//   **A module cannot point at the thing that contains it.** This tour rings the composer's own
//   controls, the kiosk's chrome and the nav — and it walks a person across THREE separate pages
//   (`/`, `/home.html`, `/kiosk.html`). A module lives inside one panel of one screen. It has no
//   way to draw around the shell it is mounted in, and no way to survive being navigated away
//   from.
//
// So it is shell-level, like `cursor.js` and `demo_strip.js` — and like both of those it is
// SELF-CONTAINED AND INJECTABLE rather than woven in: a host calls `mountTour` and nothing in
// `kiosk.js` or `home.html` knows what a step is.
//
// **The module-shaped half is still worth having later.** A `tour` module could be a thin
// wrapper mounting this same renderer scoped to one screen, for a tour that explains one panel
// rather than the product. Different artifact, and it does not need deciding now. What is
// decided here is only that THIS one cannot be a module.
//
// ---------------------------------------------------------------------------------------
// WHAT IT INHERITS FROM THE PRODUCT, NOT FROM TOUR CONVENTION
// ---------------------------------------------------------------------------------------
//
// *** IT IS NEVER A GATE. *** A tour overlay a person cannot leave is precisely the shape the
// safety invariant forbids — a screen must never enter a state that only an input can leave. So
// there is no scrim: the overlay is `pointer-events: none` everywhere except its own two
// buttons, the page underneath stays fully usable while the tour is up, and **Skip works from
// step one**. Somebody who wants to ignore this can ignore it without dismissing it first.
//
// *** ONE BUTTON, ONE DIRECTION, AND `next()` ALWAYS TERMINATES. ***
// The wrapping in `AGENTS.md` is about not stranding somebody, and with a single switch bound to
// one verb the honest form of that is stronger than wrapping: **from any state, pressing Next
// enough times ends the tour.** Nothing is ever disabled, nothing sits there refusing. That is
// the property `tour_test.html` pins with a negative control, because it is what makes a
// one-switch user's only verb sufficient to escape.
//
// *** THE TOUR NEVER PERFORMS THE ACTION. *** It highlights and it waits. That is the whole
// difference from the recorder, and it is what makes this a tour rather than a demo playing at
// somebody. A step whose action is a click shows the person the button; it does not press it.
//
// *** REDUCED MOTION *** governs the highlight, read from the same media query `wallpaper.js`
// reads and followed live, rather than from a second setting somebody has to find.
//
// ---------------------------------------------------------------------------------------
// IT SPANS THREE PAGES, SO ITS POSITION LIVES IN STORAGE
// ---------------------------------------------------------------------------------------
//
// The walk goes `/` → `/home.html` → `/kiosk.html`. Anything held in memory is lost at the first
// navigation, which is one step in. So the position is kept in `localStorage` and the tour picks
// up where it was when the next page mounts it — the same problem `setup_timing.js` has, solved
// the same way.
//
// At a page boundary it SAYS WHERE TO GO AND WAITS rather than navigating. Navigating for
// somebody is performing the action, and the point is that they do it. But waiting is a state,
// and a state Next cannot leave is the thing forbidden above — so a SECOND Next at a boundary
// finishes the tour. Pressing forward twice with nothing ahead of you is a person telling you
// they are done.
//
// *** THE POSITION IS AN INDEX INTO THE WHOLE WALK, NOT INTO THIS PAGE'S STEPS. ***
// The first version of this file filtered `STEPS` down to the ones whose `page` matched, and
// walked that. It is the obvious shape and it is wrong, because **`/` is visited twice** — the
// opening line and the closing card are both on the landing page with the entire product
// demonstration in between. Filtering by page splices those two into one run, so the tour would
// have gone "someone you love is in a bed" → "it is free and open source" and skipped everything
// it exists to show. Nothing about that failure looks like a bug from inside the function; it
// just quietly renders a two-step tour.
//
// So position is a global index, and a page shows the tour only when the CURRENT step lives
// here. That handles the revisit for free and needs no notion of runs or segments.

export const TOUR_POS_KEY = 'nimrod:tourStep';
export const TOUR_DONE_KEY = 'nimrod:tourDone';

/** Every stop on the whole walk, in order, across all pages. */
export const allTourSteps = (steps) => (steps || []).filter((s) => s.tour !== false && s.say);

/** Where in the WHOLE walk a step sits — so "3 of 13" counts the tour, not the page. */
export const overallIndex = (steps, step) => allTourSteps(steps).indexOf(step);

/** Same page? Tolerant about `/index.html`, query strings and fragments. */
export function samePage(a, b) {
  const norm = (p) => {
    const s = String(p == null ? '/' : p).split(/[?#]/)[0].replace(/\/index\.html$/, '/');
    return s === '' ? '/' : s;
  };
  return norm(a) === norm(b);
}

// What to say when the next step is somewhere else. Keyed by DESTINATION, because "open the
// screen" and "go back to the front page" are different instructions and a generic "navigate to
// continue" is the kind of line that reads as an error message.
const GO_THERE = {
  '/': 'Head back to the front page to finish the tour.',
  '/home.html': 'Open your screens to carry on — the tour picks up where you left it.',
  '/kiosk.html': 'Open the screen you just made — the tour picks up where you left it.',
};
const goThere = (page) => GO_THERE[page] || 'Open the next page to carry on.';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const prefersReducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

/**
 * Mount the tour on this page.
 *
 * `steps` is the whole list from `steps.js`; this picks out the ones for `path` and keeps the
 * position across navigation. Returns null when there is nothing to show here, so a host can
 * call it unconditionally and never branch.
 */
export function mountTour(root, {
  steps = [],
  path = (typeof location !== 'undefined' ? location.pathname : '/'),
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  doc = (typeof document !== 'undefined' ? document : null),
  bus = null,
  reducedMotion = null,   // null = ask the system, and keep asking
  onStep = null,
  onFinish = null,
  respectDone = true,
} = {}) {
  if (!root || !doc) return null;

  const all = allTourSteps(steps);
  if (!all.length) return null;

  const read = (k, d = null) => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const write = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };
  const drop = (k) => { try { storage?.removeItem(k); } catch { /* private mode */ } };

  // Somebody who finished or skipped is not asked again. A tour that reappears on every page
  // load is the thing people learn to close without reading.
  if (respectDone && read(TOUR_DONE_KEY)) return null;

  const savedId = read(TOUR_POS_KEY);
  let i = Math.max(0, all.findIndex((s) => s.id === savedId));

  // *** THE TOUR ONLY EXISTS ON THE PAGE ITS CURRENT STEP IS ON. *** Somebody who has not
  // started it and opens the kiosk directly gets no overlay; somebody mid-walk who arrives at
  // the page the walk was heading for picks it straight back up. Returning null here rather
  // than mounting-and-hiding means a host can call this unconditionally on all three pages.
  if (!samePage(all[i].page, path)) return null;

  let waiting = false;     // at a page boundary, holding for the person to navigate
  let done = false;
  let off = [];

  let reduced = reducedMotion == null ? prefersReducedMotion() : !!reducedMotion;

  // ------------------------------------------------------------------------------------
  // THE OVERLAY. `pointer-events:none` on the container is what makes this not a gate: the page
  // underneath stays fully usable while the tour is up, and only the two buttons take clicks.
  //
  // The z-index sits deliberately BELOW `[data-way-out]`'s 2147483000. If those two ever
  // overlap, the affordance that lets somebody leave the demo has to be the one on top.
  // ------------------------------------------------------------------------------------
  const layer = doc.createElement('div');
  layer.setAttribute('data-tour', '');
  layer.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147482000', 'pointer-events:none',
    'font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
  ].join(';');

  const ring = doc.createElement('div');
  ring.setAttribute('data-tour-ring', '');
  ring.hidden = true;

  const panel = doc.createElement('div');
  panel.setAttribute('data-tour-panel', '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Guided tour');
  panel.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:22px', 'transform:translateX(-50%)',
    'max-width:min(62ch,92vw)', 'box-sizing:border-box',
    // The one part of the overlay that takes pointer events.
    'pointer-events:auto',
    'background:rgba(10,51,35,.96)', 'color:#e8f0ea', 'border:1px solid rgba(255,255,255,.22)',
    'border-radius:14px', 'padding:14px 16px', 'box-shadow:0 10px 40px rgba(0,0,0,.45)',
  ].join(';');

  function styleRing() {
    ring.style.cssText = [
      'position:fixed', 'border:3px solid #F7C948', 'border-radius:10px', 'pointer-events:none',
      'box-shadow:0 0 0 4px rgba(247,201,72,.25)',
      // The only animation in the file, and reduced motion removes it rather than slowing it.
      reduced ? '' : 'transition:left .18s ease,top .18s ease,width .18s ease,height .18s ease',
    ].filter(Boolean).join(';');
  }
  styleRing();

  layer.append(ring, panel);
  root.append(layer);

  // ------------------------------------------------------------------------------------
  const current = () => all[i];

  function place() {
    const sel = current()?.target;
    const el = sel ? doc.querySelector(sel) : null;
    // A TARGET THAT IS NOT ON THIS PAGE IS NOT AN ERROR HERE — it is the graceful half of the
    // failure the recorder makes loud. The line still shows; there is simply no ring. Drawing
    // one at 0,0 around nothing would be worse than drawing none, and it is what `.k-mods`
    // would have produced before the recorder caught it.
    const r = el?.getBoundingClientRect?.();
    if (!r || (!r.width && !r.height)) { ring.hidden = true; return; }
    ring.hidden = false;
    ring.style.left = `${r.left - 6}px`;
    ring.style.top = `${r.top - 6}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;
  }

  function render() {
    if (done) return;
    const step = current();
    const n = i + 1;
    const label = waiting ? 'End the tour' : n >= all.length ? 'Done' : 'Next';
    const say = waiting ? goThere(step.page) : step.say;

    panel.innerHTML = `
      <div data-tour-say>${esc(say)}</div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
        <button type="button" data-tour-next style="flex:0 0 auto;background:#F7C948;
          color:#0A3323;border:0;border-radius:9px;padding:9px 16px;font:inherit;
          font-weight:700;cursor:pointer">${esc(label)}</button>
        <button type="button" data-tour-skip style="flex:0 0 auto;background:transparent;
          color:#cfe0d6;border:1px solid rgba(255,255,255,.28);border-radius:9px;
          padding:9px 14px;font:inherit;cursor:pointer">Skip the tour</button>
        <span data-tour-count style="margin-left:auto;opacity:.6;font-size:.86rem">${n} of ${all.length}</span>
      </div>`;
    panel.querySelector('[data-tour-next]').addEventListener('click', next);
    panel.querySelector('[data-tour-skip]').addEventListener('click', skip);
    place();
    try { onStep?.(step, n, { waiting }); } catch (err) { console.error('tour: onStep', err); }
  }

  // ------------------------------------------------------------------------------------
  // ONE DIRECTION, AND IT ALWAYS DOES SOMETHING. Read this whole function looking for a branch
  // that leaves the tour exactly where it was: there is not one, and that is the point.
  // ------------------------------------------------------------------------------------
  function next() {
    if (done) return;
    // Second Next at a boundary: they pressed forward with nothing ahead of them here.
    if (waiting) { finish('done'); return; }
    if (i >= all.length - 1) { finish('done'); return; }

    i += 1;
    // The position is saved to the step they are being sent to, so arriving on that page
    // resumes exactly here rather than at the top of it.
    write(TOUR_POS_KEY, current().id);
    // The next step lives somewhere else: hold and say where. `place()` will find no target for
    // it on this page and simply draw no ring, which is the right picture for "not here yet".
    waiting = !samePage(current().page, path);
    render();
  }

  // Back is a convenience, not a way out, and it is allowed to stop at the first step: the
  // escape guarantee is carried entirely by `next()` and by Skip, both of which are always
  // available. A one-verb user never has this bound.
  function prev() {
    if (done || i === 0) return;
    i -= 1;
    waiting = !samePage(current().page, path);
    write(TOUR_POS_KEY, current().id);
    render();
  }

  function skip() { finish('skipped'); }

  function finish(reason) {
    if (done) return;
    done = true;
    write(TOUR_DONE_KEY, '1');
    drop(TOUR_POS_KEY);
    teardown();
    try { onFinish?.(reason); } catch (err) { console.error('tour: onFinish', err); }
  }

  function teardown() {
    off.forEach((f) => { try { f(); } catch { /* already gone */ } });
    off = [];
    layer.remove();
  }

  // THE TOUR NEVER NAMES ITS INPUT, same as every module. A switch, a key, a dwell or a remote
  // all drive it by publishing these; binding them is somebody else's job.
  if (bus?.subscribe) {
    for (const [topic, fn] of [['tour/next', next], ['tour/prev', prev], ['tour/skip', skip]]) {
      const u = bus.subscribe(topic, fn);
      if (typeof u === 'function') off.push(u);
    }
  }

  if (typeof window !== 'undefined') {
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, { passive: true });
    off.push(() => window.removeEventListener('resize', onMove));
    off.push(() => window.removeEventListener('scroll', onMove));

    // FOLLOW THE SETTING RATHER THAN SAMPLING IT ONCE. Somebody who turns reduced motion on
    // mid-tour did it because something on screen was bothering them.
    if (reducedMotion == null) {
      try {
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const onMq = (e) => { reduced = e.matches; styleRing(); place(); };
        mq?.addEventListener?.('change', onMq);
        if (mq?.removeEventListener) off.push(() => mq.removeEventListener('change', onMq));
      } catch { /* no matchMedia: the transition stays on, which is the pre-existing behavior */ }
    }
  }

  write(TOUR_POS_KEY, current().id);
  render();

  return {
    el: layer,
    next, prev, skip,
    step: () => current(),
    index: () => i,
    total: all.length,
    waiting: () => waiting,
    reduced: () => reduced,
    shown: () => !done && !!layer.isConnected,
    // `destroy` is NOT `skip`: a host tearing down a page must not record that the person
    // finished, or navigating away once would silently cancel the tour for good.
    destroy() { if (!done) { done = true; teardown(); } },
  };
}

/** Let somebody take the tour again. Nothing calls this yet; a settings row should. */
export function resetTour(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { storage?.removeItem(TOUR_DONE_KEY); storage?.removeItem(TOUR_POS_KEY); }
  catch { /* private mode */ }
}
