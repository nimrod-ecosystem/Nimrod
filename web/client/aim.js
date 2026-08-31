// aim.js — THE AIM: where on the screen somebody is pointing, whatever is doing the pointing.
//
// A mouse, a trackball, a head pointer, a hand in front of a camera, a brightly coloured sock
// on a foot. Downstream, none of them are distinguishable and none of them should be.
//
// ---------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL, given that `input_pointer.js` says the opposite
// ---------------------------------------------------------------------------------------
//
// It said, and it was right at the time:
//
//   "POSITION IS NOT AN INPUT HERE. Only buttons. Pointer position belongs to whatever the
//    person is pointing AT, and a bus that turned mouse movement into actions would fight the
//    page for control of the cursor."
//
// The load-bearing words are **turned into actions**. A position is not an action, it has no
// binding, and nothing here turns it into one. That decision stands: the input bus still
// carries only edges. What was missing is that a position is not nothing either — two modules
// had already invented it privately, each reading `pointermove` off its own element:
// `comet.js`, where the head sits EXACTLY on the cursor and that precision is the entire point
// of the module, and `pond.js`, which literally named its local copy `aim()`. And
// `docs/module-input-spec.md` tells module authors *"do not assume a pointer exists — if a verb
// needs a target, aim at the middle"*, which is the same concept a third time, as an apology.
//
// Three private copies of one idea is the definition of something that wants owning. So this
// file owns it, as a SIBLING of `input.js` and `output.js` rather than a section inside either
// — the same shape as the output bus, and for the same reason: it is a different kind of
// traffic with different rules, and burying it inside a file whose every mechanism is about
// discrete edges would make both harder to read.
//
// ---------------------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT DO, and each of these is a real temptation
// ---------------------------------------------------------------------------------------
//
// * NO BINDING. You do not bind an aim to an action. Where somebody is pointing is not a verb;
//   what they do there is, and that already goes through the input bus as a press.
// * NO DEBOUNCE, NO `holdMs`, NO `too-short`. Every one of those is an edge concept. There is
//   no such thing as a bounced position.
// * NO SMOOTHING. This is the one people will want to add here, and it belongs to the PRODUCER.
//   A hand tracker needs an exponential average because its detector is noisy at six frames a
//   second; a mouse needs none and would only be made laggy by one. Smoothing in the middle
//   would tax the device that does not need it to help the device that does.
// * NO LOG. `input.js` logs every activation including the rejected ones, because false
//   activation is a clinical measurement nobody else takes. There is no equivalent question
//   for a position, and 60 rows a second would drown the stream that does matter.
//
// ---------------------------------------------------------------------------------------
// NORMALISED, NOT PIXELS — and this is what makes a tracker possible at all
// ---------------------------------------------------------------------------------------
//
// `x` and `y` are 0..1 of the VIEWPORT. A camera-based tracker has no idea how big anything on
// screen is; it knows a blob was 40% across its frame. A consumer converts to its own element
// with `aimIn()` below. It also survives a resize, a screen swap, and a kiosk on a different
// panel, none of which a pixel would.
//
// LAST PRODUCER WINS. If a mouse and a tracker both report, whichever reported most recently is
// the aim. That is the honest behaviour — there is one cursor and one person — and it means
// picking up the mouse during a session takes over immediately, with no mode to switch.
//
// ---------------------------------------------------------------------------------------
// THE ROLE GATE, AND WHY IT IS NOT WIRED IN YET *** OPEN QUESTION ***
// ---------------------------------------------------------------------------------------
//
// `input.js` has a three-way role gate so a caregiver can lock the participant's inputs during
// setup. It is tempting to apply it here. It is not applied, because a role in this project is
// a property of a BINDING, not of a device — and an aim has no binding, so honouring the gate
// would mean inventing a device-to-role mapping that exists nowhere else. Smuggling a new
// concept in through a helper file is exactly how the vocabulary got into the state
// `docs/glossary.md` was opened to fix.
//
// What is here instead is `setEnabled(device, on)`, which is the control that was actually
// wanted: a tracker that ships off by default and is turned on per device, per room. If the
// gate turns out to be the right answer, it is a small change and it should be a deliberate one.

export const AIM_TOPIC = 'input/aim';

// Viewport pixels -> 0..1. Exported because every producer needs exactly this and there is no
// reason for three of them to disagree about it at the edges.
export function viewportAim(clientX, clientY, view = (typeof window !== 'undefined' ? window : null)) {
  const w = Number(view?.innerWidth) || 0;
  const h = Number(view?.innerHeight) || 0;
  if (!w || !h) return null;
  return { x: clamp01(clientX / w), y: clamp01(clientY / h) };
}

// 0..1 -> pixels inside one element. Returns null when the aim is outside it, so a module can
// tell "not pointing at me" from "pointing at my top-left corner" — which `{x:0,y:0}` cannot.
//
// `inside:false` gives the clamped point instead, for a module that wants to keep tracking an
// aim that has wandered off it (a game that should not lose the comet at the edge).
export function aimIn(aim, el, { inside = true } = {}) {
  if (!aim || !el?.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const vw = (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  const vh = (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
  if (!vw || !vh) return null;
  const px = aim.x * vw - r.left;
  const py = aim.y * vh - r.top;
  if (inside && (px < 0 || py < 0 || px > r.width || py > r.height)) return null;
  return { x: clampTo(px, r.width), y: clampTo(py, r.height) };
}

function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }
function clampTo(v, max) { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; }

export function createAim({
  bus,
  now = () => Date.now(),
  // A floor between published aims, in ms. DEFAULT ZERO, and that is deliberate: `comet.js`
  // puts the comet's head exactly on the aim and the whole point of that module is that her
  // own movement is unmistakably the thing that moved it. Throttling here would add lag to the
  // one module that can least afford it. A noisy producer should slow ITSELF down.
  rateMs = 0,
} = {}) {
  if (!bus) throw new Error('createAim: bus is required');

  let last = null;                 // the most recent aim, whoever produced it
  let lastAt = -Infinity;
  const off = new Set();           // devices explicitly switched off
  let destroyed = false;

  function report(device, x, y) {
    if (destroyed || !device) return null;
    if (off.has(device)) return null;
    const t = now();
    // Rate limiting drops a SAMPLE, never the state: `last` is still updated, so `latest()`
    // and the next publish both carry the newest position rather than a stale one.
    const aim = { x: clamp01(x), y: clamp01(y), device, at: t };
    last = aim;
    if (rateMs > 0 && t - lastAt < rateMs) return aim;
    lastAt = t;
    bus.publish(AIM_TOPIC, aim);
    return aim;
  }

  return {
    report,
    // A convenience for anything holding a DOM event. Returns null off-screen or before the
    // viewport has a size, rather than reporting a wrong aim.
    reportEvent(device, e, view) {
      const a = viewportAim(e?.clientX, e?.clientY, view);
      return a ? report(device, a.x, a.y) : null;
    },
    // The last known aim. A module mounted mid-session can place its cursor immediately
    // instead of waiting for the next movement — which for somebody whose movement is slow
    // and effortful is the difference between a working screen and a blank one.
    latest: () => (last ? { ...last } : null),
    setEnabled(device, on) { if (on) off.delete(device); else off.add(device); return !off.has(device); },
    enabled: (device) => !off.has(device),
    destroy() { destroyed = true; last = null; off.clear(); },
  };
}
