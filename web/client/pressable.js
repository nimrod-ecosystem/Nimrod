// pressable.js — CAN THIS SCENE THING BE PRESSED? One shared answer, not a per-item reinvention.
//
// *** RENAMED FROM hitbox.js, 2026-09-29, AND THE NAME MATTERS. *** Ad blockers block any file called
// `hitbox.js` (HitBox was an old web-analytics product, and the filter lists still carry it). uBlock
// Origin Lite -- loaded by default in Raspberry Pi OS's Chromium -- refused it on the bench Pi, and
// because comet.js imports this file, the WHOLE kiosk script never ran: the screen sat on
// "Starting Nimrod..." with no error at all. Any visitor with an ad blocker got the same.
// tools/check_blocked_names.py now checks every client file name against the filter lists.
//
// Mike, 2026-09-26, asking how buttons detect "the cursor is over them" and how Godot and other
// engines handle it: an ordinary DOM button gets that FOR FREE from the browser's own layout
// engine — `:hover` is the browser doing hit-testing nobody wrote. This file is for the things
// that DON'T get that for free: a balloon drawn on a `<canvas>`, or any moving scene item — the
// browser has no idea a "balloon" exists at all, so nothing about it can ever `:hover`.
//
// Godot's answer for exactly this case is `Area2D`/`CollisionShape2D`: its physics engine runs
// a broad-phase-then-narrow-phase overlap test, every frame, between the pointer's position (or
// another shape) and each collider, and fires `mouse_entered`/`mouse_exited`/`input_event`
// signals off the result. Nimrod doesn't need a physics engine for this — `modules/comet.js`
// already proved the whole mechanism in one line, checked every frame, for exactly one shape:
// squared-distance-to-a-point versus a radius (`dx*dx + dy*dy < r*r`). That is a circle-vs-point
// overlap test — the simplest case a real physics engine also has to solve, just without the
// engine. This file is that one line, generalized to MORE THAN ONE target, plus the enter/exit
// bookkeeping ("was this hit last tick but not now") a per-item author would otherwise
// re-derive, plus the switch-scanning half no module in this codebase has shared before now.
//
// ---------------------------------------------------------------------------------------
// TWO WAYS SOMETHING GETS "HIT", MATCHING THE TWO INPUT PARADIGMS ALREADY IN THIS CODEBASE
// ---------------------------------------------------------------------------------------
//
// - POINTER (a mouse, a camera tracker, anything reporting through `aim.js`): test the current
//   aim POSITION against every registered target's circle, every tick. `hitTest`/`hitCircle`
//   below are exactly `comet.js`'s own check, moved here and made reusable.
// - SWITCH SCAN: there is no continuous "position" a switch can supply — `docs/module-input-
//   spec.md`'s own rule is "do not assume a pointer exists." `comet.js`'s existing
//   `steerToNearestHeart()` already answers this for its own game (glide the comet to the
//   closest live heart, so a switch user reaches one at all); `nearest()` below is that same
//   question, generalized, so the next scene item that wants "go to the closest thing" does not
//   re-derive it. The GLIDE/EASE-OUT itself stays with each caller — that motion is specific
//   enough to how a given item feels (comet.js's own ease-out curve, tuned for a comet) that
//   sharing the destination-picking logic is the right amount to share, not the animation too.
//
// ---------------------------------------------------------------------------------------
// DELIBERATELY CIRCLES ONLY
// ---------------------------------------------------------------------------------------
//
// The one real precedent (`comet.js`'s hearts) is a circle. A general shape system (rectangles,
// polygons) is not built here because nothing has asked for one yet — the same discipline this
// codebase applies elsewhere (`input_marker.js`'s own header: ship the thing that is needed
// first, not the general system a maybe-later case might want). Add a shape kind the day
// something real needs it.

export function distSq(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

// Is a point inside one circular target ({ x, y, r })? Pure — the exact check `comet.js`
// already ran inline, unchanged, just named and shared.
export function hitCircle(px, py, target) {
  const r = target.r;
  return distSq(px, py, target.x, target.y) < r * r;
}

// Every target a point is currently inside, NEAREST FIRST — a caller that only wants "the one
// thing" takes index 0; a caller in a dense scene where circles can overlap still gets every
// hit, in a sensible order rather than whichever the array happened to list first.
export function hitTest(px, py, targets) {
  const hits = [];
  for (const t of targets) {
    if (hitCircle(px, py, t)) hits.push({ target: t, d2: distSq(px, py, t.x, t.y) });
  }
  hits.sort((a, b) => a.d2 - b.d2);
  return hits.map((h) => h.target);
}

// The switch-scan half: which live target is closest to wherever the "cursor" (a comet head, a
// scan position, whatever a caller's own concept of "here" is) currently sits. Targets with no
// `id` are still compared, but `nearest` returns the TARGET OBJECT itself either way, so a
// caller keying by `.id` is its own choice, not required by this function.
export function nearest(fromX, fromY, targets) {
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const d = distSq(fromX, fromY, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

// *** THE STATEFUL HALF: ENTER/EXIT, THE SAME SHAPE AS A DOM BUTTON'S `:hover` OR GODOT'S
// `Area2D.mouse_entered`/`mouse_exited`. *** Without this, a caller polling `hitTest` every
// frame has to keep its own "was this id inside last tick" bookkeeping to know when something
// was JUST entered versus has been sitting under the cursor for a while — exactly the kind of
// small, easy-to-get-subtly-wrong state worth sharing once. Targets need an `id` to be tracked
// this way (a plain object identity would work too, but an id survives a target being rebuilt
// each frame the way `comet.js`'s own hearts array already is).
export function createHoverTracker() {
  let inside = new Set();

  return {
    // Call once per tick with the current pointer position and the FULL live target list.
    // Returns which targets were newly entered, newly left, and everything currently inside
    // (nearest first) — a caller reacts to `entered`/`left` for state-CHANGE feedback (a
    // highlight turning on, an announcement) and to `inside[0]` for "what would a press hit
    // right now."
    update(px, py, targets) {
      const hits = hitTest(px, py, targets);
      const nowInside = new Set(hits.map((t) => t.id));
      const entered = [...nowInside].filter((id) => !inside.has(id));
      const left = [...inside].filter((id) => !nowInside.has(id));
      inside = nowInside;
      return { entered, left, inside: hits };
    },
    isInside: (id) => inside.has(id),
    // A target that disappeared (caught, expired, unmounted) without a final `update()` call
    // covering it must not be remembered as still "inside" forever — the same stuck-state
    // failure `input.js`'s own stuck-switch watchdog exists to prevent, applied here.
    forget(id) { inside.delete(id); },
    reset() { inside = new Set(); },
  };
}
