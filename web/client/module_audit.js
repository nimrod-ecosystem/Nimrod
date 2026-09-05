// module_audit.js — MOUNT EVERY MODULE AND SAY WHAT HAPPENED, in one place.
//
// This was `dev/modules_live.html`, inline, and `modules.html` was a second page that could
// mount a module but never judged one. Two pages, two half-answers, and only one of them was
// linked from anywhere a visitor would find. Mike's ask was to join them, so the JUDGING moved
// here — the same move `module_try.js` already made for the SCAFFOLDING — and both callers now
// run the same code.
//
// *** THE VERDICT IS DELIBERATELY WEAK, AND THAT IS THE WHOLE DESIGN. ***
//
// The first version of this check was `childElementCount > 0 || textContent.length > 0`, and it
// returned RAN for all twenty-one modules — exactly the flattering green number the page exists
// to replace. It was wrong about at least one: `educational` drew its previous/next arrows and
// its "Learning" label around a COMPLETELY EMPTY content stage. Chrome is not content, and a
// check that cannot tell them apart is another way of saying "it works" without looking.
//
// So `judge` reports NUMBERS and the badge says only DREW — pixels appeared, nothing more.
// Whether it is the RIGHT something is what the box on screen is for. A page using this must
// show the module, not just the badge; a badge on its own is the thing being replaced.

/**
 * What a mounted module put on screen. Pure, synchronous, and takes no view on whether that is
 * good — the counts are the evidence and the caller renders them.
 */
export function judge(host) {
  const els = host.querySelectorAll('*').length;
  const chars = (host.textContent || '').trim().length;
  // `canvas` and `video` hold no elements and no text, so a module that draws nothing else
  // would read as blank without this. Comet is the case: one canvas, zero characters.
  const canvases = host.querySelectorAll('canvas, video, img, svg').length;
  const controls = host.querySelectorAll(
    'button, [role="button"], input, select, [data-cell], [data-key]').length;
  const painted = els > 0 || chars > 0 || canvases > 0;
  return {
    state: painted ? 'ran' : 'empty',
    els, chars, canvases, controls,
    detail: painted
      ? `${els} elements · ${chars} chars of text · ${canvases} canvas/img · ${controls} controls`
      : 'Mounted without error, but put nothing on screen at all.',
  };
}

export const VERDICT_LABEL = { ran: 'drew', empty: 'blank', threw: 'threw' };

/**
 * Mount one module and judge it, giving it time to draw first.
 *
 * `settleMs` is not politeness. Several modules render on a timer rather than at `init`, and a
 * verdict taken too early libels them — which is how a harness meant to replace false claims
 * would generate its own.
 */
export async function auditOne(host, type, mountEl, { settleMs = 2200 } = {}) {
  try {
    const rec = host.mount(type, mountEl);
    await new Promise((r) => setTimeout(r, settleMs));
    try { rec.onResize?.(); } catch { /* not every module has one */ }
    return judge(mountEl);
  } catch (err) {
    console.error(`[${type}] threw`, err);
    return { state: 'threw', els: 0, chars: 0, canvases: 0, controls: 0,
             detail: `${err && err.name}: ${err && err.message}` };
  }
}

/**
 * The sentence under the grid. Worded so it cannot be read as a pass rate: "drew something" is
 * the whole claim, and the last line says so out loud rather than leaving somebody to infer it.
 */
export function tallyLine(results) {
  const n = (s) => results.filter((r) => r.state === s).length;
  return `${results.length} modules mounted · ${n('ran')} drew something · `
    + `${n('empty')} drew nothing · ${n('threw')} threw. `
    + 'Drawing something is not working — look at the boxes.';
}

/** The ones worth opening, named rather than left to be scrolled for. */
export function worthLooking(results) {
  return results.filter((r) => r.state !== 'ran');
}
