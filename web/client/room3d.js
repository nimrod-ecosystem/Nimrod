// room3d.js — A ROOM IN THREE DIMENSIONS, BUILT FROM ORDINARY PAGE ELEMENTS WITH CSS 3D TRANSFORMS.
//
// Mike, 2026-10-02, on Home's starting points: "...some of the editable rooms/scenes design built, 3d if
// possible." The site loads no library from anywhere but itself, so a WebGL room means vendoring three.js
// (~650 KB) -- Mike's call, still open. This is the cheaper experiment Code recommended first: a box room
// whose walls, floor, ceiling and furniture are plain <div>s placed in 3D by the browser's compositor.
// The point of doing it this way is that A WALL IS A PAGE ELEMENT, so a module on a wall is an ordinary
// module in an ordinary box -- every existing module works there, exactly as in the 2D room's slots.
//
//   const room = mountRoom3d(host, { preset: 'box' }, { drift: 'off' });
//   room.slots()               Map slotId -> { id, el, surface }  (the host mounts a module in el)
//   room.faceBox(surface, g)   where a FREELY placed module goes on a wall: { el, left, top, width, height }
//   room.destroy()
//
// *** THE GEOMETRY. *** One stage of 960 x 540 (the 2D room's own, so free placement means the same
// thing in both), scaled to fit the host the way room_scene.js fits its stage. `perspective` sits on
// the stage; the camera (`.r3-cam`, preserve-3d) holds the faces. Coordinates are CSS's: x right, y
// down, z toward the viewer. The screen plane is z = 0; the back wall is at z = -depth. Side walls,
// floor and ceiling reach `front` px past the screen plane, so a drifting camera never shows the edge
// of the box. Every face turns its front toward the inside of the room and hides its back
// (`backface-visibility: hidden`), which is also how a box's far sides cost nothing.
//
// *** THE RULES IT KEEPS. ***
//   1. NO LITERAL COLOUR. Every colour is a theme token (room3d.css), so the room follows the screen's
//      theme and a dark theme makes a dark room. The shading of each face is the same token mixed toward
//      the theme's own text colour, never a number picked here.
//   2. MOTION IS OPT-IN AND OFF BY DEFAULT. The one thing that moves is the camera's slow drift, and it
//      runs only when `drift: 'on'` AND the motion ladder is not 'still' AND the system does not ask for
//      reduced motion -- and the CSS rule is itself inside `prefers-reduced-motion: no-preference`, so
//      either guard alone stops it. It animates `transform` only (compositor work, never layout:
//      dev/room3d_test.html checks the keyframes, as dev/scene_motion_test.html does for the scenes).
//   3. NOTHING FLASHES. The drift changes no colour and no brightness, so the screen's flash limit
//      (flash_limit.js) has nothing here to limit. If a reaction that lights something is ever added,
//      it goes through `minFlashPeriodMs` the way room_scene.js's do.
//   4. NO CONNECTOR GEOMETRY. The furniture is boxes. Nimrod's real brick/connector shapes are IP-gated
//      and stay out of the public site.
//   5. THE HOST MOUNTS THE MODULES. Like room_scene.js (rule 2 there), this never mounts a module: it
//      hands back empty elements (slots, and the faces for free placement). arrangement.js does the rest.
//
// *** WHAT IT DOES NOT DO (YET), SAID PLAINLY. *** No day/evening/night light, no window with a live view,
// no close-ups and no cat. Those are the 2D room's; whether they come here depends on the bench measurement
// and on Mike's three.js decision, not on this file.
//
// *** ITS FURNITURE CAN BE A DOOR (2026-10-02), the 2D room's row 2.38 on the same terms. *** A piece with
// `opens: '<dashboard id>'` on its recipe entry is a BUTTON: pressing it publishes `dashboard/go { id, claim }`
// (dashboard_nest.js) -- the verb the kiosk answers with its load-then-swap, the one a 2D room object sends --
// and nobody claiming it (a preview, the modules page) reaches the host's `onUnclaimed`, as in room_scene.js.
// It is LABELLED: its name is its accessible name and, by default, a chip on its front (`labels`, below).
// A piece with no `opens` is NOT a button: in the 3D room furniture has no other role yet, and a button that
// does nothing is a dead stop for somebody pressing a switch. `setObjectOpens` changes ONE piece in place
// (its box is redrawn; the walls, their slots and the modules in them are not touched), which is what the
// map editor's Opens window and the arrangement's `applyPlaced` call.

//
// *** LEVEL OF DETAIL (2026-10-02, room_lod.js). *** Each piece is drawn `full` (its four faces) or as a
// `proxy` (its front face alone: the same place, the same colour, the same button when it is a door). Which,
// is room_lod.js `chooseLod`: a piece drawn under `lodNearPx` CSS px is far, and past this device's face
// budget the smallest pieces drop first. The budget comes from a MEASUREMENT of the device (room_lod.js
// argues the numbers) unless the host passes `lodBudget` or `lod: 'full' | 'proxy'`. On a desktop the box
// room is all full; nothing about a door, a slot or a module changes with the level.
//
// *** PROJECTION, AS PURE FUNCTIONS (2026-10-02, for room_flat.js's "flatten to 2D"). *** `project`,
// `faceToWorld`, `boxCorners`, `boxFaces`, `boxRect`: the same perspective the stage draws with, so a
// flattened room and a LOD decision are measured against exactly what the browser shows.

import { DASHBOARD_GO_TOPIC } from './dashboard_nest.js';
import { chooseLod, deviceCapability, budgetFor, LOD_DEFAULTS } from './room_lod.js';

export const OPENS_ACTION = 'dashboard.open';   // room_scene.js's name for the same press
export const OPENS_MAX = 200;                    // layout.js OPENS_MAX: an id, not prose

export const W = 960;
export const H = 540;

// *** THE NUMBERS, EACH A DEFAULT (Rule 1) AND EACH OVERRIDABLE BY THE RECIPE OR THE HOST. ***
//   lens 700, depth 467  the back wall is drawn at lens/(lens+depth) = 0.6 of the screen: 20%..80% across.
//                        The 2D room's back wall is 16%..84% (ROOM_SHELLS.room); 0.6 keeps the side walls
//                        wide enough to hang a module on and still read as walls. Deeper and a module on
//                        the back wall gets small on a TV across a room; shallower and the room is flat.
//   eye 15               the eye height, % of the stage from the top: a camera a little above a standing
//                        person, looking level. It puts the back wall's foot near 66% -- the 2D room's
//                        floor line -- so the floor is big enough to stand furniture on.
//   front 140            how far the side walls, floor and ceiling reach past the screen plane, in stage
//                        px: enough that the drift below never shows a gap at the screen's edge.
//   drift 'off'          see DRIFT below.
//   driftDeg 2.5         how far the camera turns each way. Small: enough to show the walls are walls
//                        (the near edges move against the far ones), not enough to feel like moving.
//   driftSeconds 40      one way; it then comes back, so a whole sway is 80 s. Slow enough that nobody
//                        watching a photo on the wall would notice it move within that photo's turn.
//   motion 'gentle'      the ladder livescene.js and room_scene.js use ('gentle' | 'calm' | 'still');
//                        'calm' stretches the drift by CALM_STRETCH, 'still' stops it.
//   labels 'always'      a piece that is a door carries its name on a chip -- room_scene.js's default and
//                        its reason (Design: "an object's meaning is never only its picture"; always is
//                        the reading of that for someone who cannot hover). 'pointed': only on hover/focus.
//
// *** DRIFT: OFF BY DEFAULT, ARGUED. ***
//   FOR off: the person in front of the screen may be there all day; a room that sways under her pictures
//   is motion she did not ask for, and the project's rule is that motion is opt-in (livescene.js rule 2).
//   It also costs the Pi a full-screen recomposite on every frame for as long as it runs -- the bench
//   numbers for that are on Mike's list beside this.
//   AGAINST: depth reads far more strongly when it moves; still, a CSS-3D room looks much like the 2D one.
//   So: off unless somebody turns it on, per dashboard (`layout.scene.options.drift`).
export const ROOM3D_DEFAULTS = Object.freeze({
  lens: 700, depth: 467, eye: 15, front: 140,
  drift: 'off', driftDeg: 2.5, driftSeconds: 40, motion: 'gentle', reducedMotion: false, labels: 'always',
  // Level of detail (room_lod.js argues each): 'auto' | 'full' | 'proxy'; null = room_lod.js's own number.
  lod: 'auto', lodNearPx: null, lodBudget: null,
});
/** What each level of a piece costs, in faces drawn: a box is four (front, top, two sides), its proxy one. */
export const BOX_FACES = 4;
export const PROXY_FACES = 1;
export const MOTIONS = Object.freeze(['gentle', 'calm', 'still']);
export const CALM_STRETCH = 1.8;                 // the same factor livescene.js uses for 'calm'
export const SURFACES = Object.freeze(['back', 'left', 'right', 'floor', 'ceiling']);
const LIMITS = { lens: [200, 4000], depth: [100, 2000], eye: [0, 100], front: [0, 600],
  driftDeg: [0, 8], driftSeconds: [5, 600] };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** A door's target: a trimmed id, or null (room_scene.js `opensOf`, room_doors.js `doorTarget`: one rule). */
export const opensOf = (it) => {
  const t = it && typeof it.opens === 'string' ? it.opens.trim() : '';
  return t && t.length <= OPENS_MAX ? t : null;
};
const num =(v, d, [lo, hi]) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Number(v), lo, hi) : d);

// *** THE PRESETS. *** One for now: a plain box room with a slot on each wall and three pieces of
// furniture. Slot x/y/w/h are percent of THEIR FACE AS SEEN: on a side wall x runs left to right as the
// viewer sees it (the left wall's 0 is at the front, the right wall's 0 at the back). Furniture: x is %
// across the room, z is % of the depth from the back wall (0) to the screen (100), w/h/d in stage px.
export const ROOM3D_PRESETS = Object.freeze({
  box: Object.freeze({
    label: 'A 3D room',
    recipe: Object.freeze({
      slots: Object.freeze([
        Object.freeze({ id: 'back', surface: 'back', x: 50, y: 40, w: 52, h: 46 }),
        Object.freeze({ id: 'left', surface: 'left', x: 52, y: 42, w: 46, h: 34 }),
        Object.freeze({ id: 'right', surface: 'right', x: 48, y: 42, w: 46, h: 34 }),
      ]),
      furniture: Object.freeze([
        Object.freeze({ id: 'cabinet', name: 'Cabinet', x: 50, z: 10, w: 380, h: 92, d: 90 }),
        Object.freeze({ id: 'table', name: 'Table', x: 24, z: 62, w: 170, h: 74, d: 120 }),
        Object.freeze({ id: 'shelf', name: 'Bookshelf', x: 88, z: 34, w: 80, h: 300, d: 70 }),
      ]),
    }),
  }),
});
export const ROOM3D_DEFAULT_PRESET = 'box';

/** The recipe to draw: a scene's own recipe, else its preset's, with every slot/furniture entry checked. */
export function normalizeRoom3d(scene = {}) {
  const s = scene && typeof scene === 'object' ? scene : {};
  const base = (s.recipe && typeof s.recipe === 'object') ? s.recipe
    : (ROOM3D_PRESETS[s.preset] || ROOM3D_PRESETS[ROOM3D_DEFAULT_PRESET]).recipe;
  const ids = new Set();
  const pct = (v, d) => num(v, d, [0, 100]);
  const slots = (Array.isArray(base.slots) ? base.slots : []).map((x, i) => {
    if (!x || typeof x !== 'object') return null;
    const id = typeof x.id === 'string' && x.id ? x.id : `slot${i + 1}`;
    if (ids.has(id)) return null;
    ids.add(id);
    return { id, surface: SURFACES.includes(x.surface) ? x.surface : 'back',
      x: pct(x.x, 50), y: pct(x.y, 50), w: num(x.w, 30, [1, 100]), h: num(x.h, 30, [1, 100]) };
  }).filter(Boolean);
  const furniture = (Array.isArray(base.furniture) ? base.furniture : []).map((f, i) => {
    if (!f || typeof f !== 'object') return null;
    const id = typeof f.id === 'string' && f.id ? f.id : `thing${i + 1}`;
    if (ids.has(id)) return null;
    ids.add(id);
    const out = { id, name: typeof f.name === 'string' && f.name ? f.name : id,
      x: pct(f.x, 50), z: pct(f.z, 50), w: num(f.w, 120, [4, 2000]), h: num(f.h, 80, [4, 2000]), d: num(f.d, 80, [4, 2000]) };
    const opens = opensOf(f);
    if (opens) out.opens = opens;
    return out;
  }).filter(Boolean);
  const out = { slots, furniture };
  for (const k of ['lens', 'depth', 'eye', 'front']) if (base[k] !== undefined) out[k] = num(base[k], ROOM3D_DEFAULTS[k], LIMITS[k]);
  return out;
}

/** The view's numbers: the recipe's own, else the host's options, else the defaults. */
export function viewOf(recipe = {}, opts = {}) {
  const v = {};
  for (const k of ['lens', 'depth', 'eye', 'front']) {
    v[k] = num(recipe[k] ?? opts[k], ROOM3D_DEFAULTS[k], LIMITS[k]);
  }
  v.scale = v.lens / (v.lens + v.depth);       // how big the back wall is drawn, 0..1
  return v;
}

/** Each face's size (stage px) and CSS transform, with the transform origin at its top-left corner. */
export function faceTransforms(view) {
  const { depth: D, front: F } = view;
  const L = D + F;
  return {
    back: { w: W, h: H, transform: `translate3d(0px, 0px, ${-D}px)` },
    floor: { w: W, h: L, transform: `translate3d(0px, ${H}px, ${-D}px) rotateX(90deg)` },
    ceiling: { w: W, h: L, transform: `translate3d(0px, 0px, ${F}px) rotateX(-90deg)` },
    left: { w: L, h: H, transform: `translate3d(0px, 0px, ${F}px) rotateY(90deg)` },
    right: { w: L, h: H, transform: `translate3d(${W}px, 0px, ${-D}px) rotateY(-90deg)` },
  };
}

/**
 * *** FREE PLACEMENT ON A WALL: WHERE THE MODULE'S CENTRE LANDS IS WHERE THE PERSON PUT IT. ***
 * A placed entry's x/y are the centre in % of the dashboard and w/h its size in % (layout.js), the same
 * numbers the 2D room uses. Here they are run BACKWARDS through the perspective: the point on the chosen
 * surface that is drawn at (x, y) is found, and the module is sized so its drawn size at that depth is the
 * w/h asked for. Returns the box in % of the FACE (the face is the element it goes in). A point the
 * surface cannot reach (x right of centre on the left wall) is held at that surface's nearest edge.
 */
export function faceBoxFor(surface, g, view) {
  const ox = W / 2, oy = (view.eye / 100) * H, P = view.lens, D = view.depth, F = view.front;
  const sx = (Number(g.x) / 100) * W, sy = (Number(g.y) / 100) * H;
  const vw = (Number(g.w) / 100) * W, vh = (Number(g.h) / 100) * H;
  // distance behind the screen plane (0 = the screen, D = the back wall) -> how much smaller it is drawn
  const k = (dz) => P / (P + dz);
  const L = D + F;
  if (surface === 'left' || surface === 'right') {
    const X = surface === 'left' ? 0 : W;
    const dx = sx - ox;
    // drawn x = ox + (X - ox) * k(dz)  ->  dz = P * (X - ox) / dx - P
    let dz = Math.abs(dx) < 1e-6 || Math.sign(dx) !== Math.sign(X - ox) ? D : P * (X - ox) / dx - P;
    dz = clamp(dz, 0, D);
    const s = k(dz);
    const along = surface === 'left' ? F + dz : D - dz;          // face px from the face's left edge
    const fy = oy + (sy - oy) / s;
    return { left: (along / L) * 100, top: (fy / H) * 100, width: ((vw / s) / L) * 100, height: ((vh / s) / H) * 100 };
  }
  if (surface === 'floor' || surface === 'ceiling') {
    const Y = surface === 'floor' ? H : 0;
    const dy = sy - oy;
    let dz = Math.abs(dy) < 1e-6 || Math.sign(dy) !== Math.sign(Y - oy) ? D : P * (Y - oy) / dy - P;
    dz = clamp(dz, -F, D);
    const s = k(dz);
    const fx = ox + (sx - ox) / s;
    // floor: the face's top edge is at the back wall; ceiling: its top edge is at the front.
    const down = surface === 'floor' ? D - dz : F + dz;
    return { left: (fx / W) * 100, top: (down / L) * 100, width: ((vw / s) / W) * 100, height: ((vh / s) / L) * 100 };
  }
  const s = view.scale;                                         // the back wall
  return { left: ((ox + (sx - ox) / s) / W) * 100, top: ((oy + (sy - oy) / s) / H) * 100,
    width: (vw / s / W) * 100, height: (vh / s / H) * 100 };
}

/**
 * *** faceBoxFor RUN FORWARDS: WHERE A SLOT IS DRAWN, AS A FREE PLACEMENT. *** A slot (`{ surface, x, y, w,
 * h }` in % of its face) -> `{ surface, x, y, w, h }` in % of the dashboard, such that `faceBoxFor` of the
 * result is the slot again. Home uses it to hang an added module where an EMPTY slot is, and to take a
 * module out of its slot (to move it by button) without it jumping: the same place, now movable.
 */
export function slotSpot(slot, view) {
  const ox = W / 2, oy = (view.eye / 100) * H, P = view.lens, D = view.depth, F = view.front;
  const L = D + F;
  const s0 = slot || {};
  const surface = SURFACES.includes(s0.surface) ? s0.surface : 'back';
  const fx = Number(s0.x) / 100, fy = Number(s0.y) / 100, fw = Number(s0.w) / 100, fh = Number(s0.h) / 100;
  const k = (dz) => P / (P + dz);
  const r1 = (v) => Math.round(v * 10) / 10;
  const out = (sx, sy, vw, vh) => ({ surface, x: r1((sx / W) * 100), y: r1((sy / H) * 100), w: r1((vw / W) * 100), h: r1((vh / H) * 100) });
  if (surface === 'left' || surface === 'right') {
    const along = fx * L;
    const dz = clamp(surface === 'left' ? along - F : D - along, 0, D);
    const s = k(dz), X = surface === 'left' ? 0 : W;
    return out(ox + (X - ox) * s, oy + (fy * H - oy) * s, fw * L * s, fh * H * s);
  }
  if (surface === 'floor' || surface === 'ceiling') {
    const down = fy * L;
    const dz = clamp(surface === 'floor' ? D - down : down - F, -F, D);
    const s = k(dz), Y = surface === 'floor' ? H : 0;
    return out(ox + (fx * W - ox) * s, oy + (Y - oy) * s, fw * W * s, fh * L * s);
  }
  const s = view.scale;
  return out(ox + (fx * W - ox) * s, oy + (fy * H - oy) * s, fw * W * s, fh * H * s);
}

/** Where a furniture box stands: its foot-centre in stage px (x, the floor's y, z). */
export function boxPlace(f, view) {
  const D = view.depth;
  // z: 0 = against the back wall, 100 = at the screen plane -- held so the whole box stays in the room
  const zc = -D + (f.z / 100) * D;
  const z = clamp(zc, -D + f.d / 2, -f.d / 2);
  const x = clamp((f.x / 100) * W, f.w / 2, W - f.w / 2);
  return { x, y: H, z };
}

// ---------------------------------------------------------------------------------------------
// PROJECTION: where a point of the room is drawn. Pure, and the stage's own perspective exactly:
// `perspective: lens` with its origin at (W/2, eye% of H), z toward the viewer, the screen plane at z = 0.
// ---------------------------------------------------------------------------------------------
/** The nearest a point may come to the eye before it is cut off (a fraction of the lens). A point at the
 *  eye itself has no picture; 0.98 keeps every drawn point finite. Geometry, not a preference. */
export const NEAR_CLIP = 0.98;
/** A point [x, y, z] (stage px) -> where it is drawn [sx, sy] (stage px). */
export function project(view, x, y, z) {
  const ox = W / 2, oy = (view.eye / 100) * H, P = view.lens;
  const k = P / Math.max(P - z, P * (1 - NEAR_CLIP));
  return [ox + (x - ox) * k, oy + (y - oy) * k];
}
/** A point on a face, (u, v) in that face's own px from its top-left corner -> [x, y, z] in the room.
 *  faceTransforms() run as arithmetic (CSS rotateX(a): y' = y cos a - z sin a; rotateY(a): x' = x cos a + z sin a). */
export function faceToWorld(surface, u, v, view) {
  const D = view.depth, F = view.front;
  switch (surface) {
    case 'floor': return [u, H, -D + v];          // translate3d(0, H, -D) rotateX(90deg): v runs back -> front
    case 'ceiling': return [u, 0, F - v];         // translate3d(0, 0, F) rotateX(-90deg): v runs front -> back
    case 'left': return [0, v, F - u];            // translate3d(0, 0, F) rotateY(90deg): u runs front -> back
    case 'right': return [W, v, -D + u];          // translate3d(W, 0, -D) rotateY(-90deg): u runs back -> front
    default: return [u, v, -D];                   // the back wall
  }
}
/** A face's size in its own px: { w, h } (faceTransforms' sizes). */
export function faceSize(surface, view) {
  const ft = faceTransforms(view);
  const f = ft[SURFACES.includes(surface) ? surface : 'back'];
  return { w: f.w, h: f.h };
}
/**
 * A piece's box, as its four drawn faces in the room: `{ front, top, left, right }`, each four [x, y, z]
 * corners in order around the face, and whether it can be SEEN from the eye -- a face turned
 * away is hidden by `backface-visibility`, so it is neither drawn by the bake nor counted.
 */
function boxExtent(f, view) {
  const p = boxPlace(f, view);
  return { x0: p.x - f.w / 2, x1: p.x + f.w / 2, y0: H - f.h, y1: H, z0: p.z - f.d / 2, z1: p.z + f.d / 2 };
}
export function boxFaces(f, view) {
  const { x0, x1, y0, y1, z0, z1 } = boxExtent(f, view);
  const ox = W / 2, oy = (view.eye / 100) * H;
  return {
    front: { pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], seen: true },
    top: { pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], seen: oy < y0 },
    left: { pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], seen: ox < x0 },
    right: { pts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], seen: ox > x1 },
  };
}
/** The box's eight corners in the room. */
export function boxCorners(f, view) {
  const { x0, x1, y0, y1, z0, z1 } = boxExtent(f, view);
  const out = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
}
/** The rectangle a piece is drawn in, stage px: { left, top, w, h }. */
export function boxRect(f, view) {
  const pts = boxCorners(f, view).map(([x, y, z]) => project(view, x, y, z));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}
/** The level each piece is drawn at (room_lod.js `chooseLod`), for a view and a fit `scale`. */
export function lodPlan(recipe, view, scale = 1, opts = {}) {
  const objs = (recipe.furniture || []).map((f) => {
    const r = boxRect(f, view);
    return { id: f.id, w: r.w, h: r.h, faces: BOX_FACES, proxyFaces: PROXY_FACES };
  });
  const mode = ['auto', 'full', 'proxy'].includes(opts.lod) ? opts.lod : 'auto';
  const budget = Number.isFinite(Number(opts.lodBudget)) && opts.lodBudget !== null && opts.lodBudget !== ''
    ? Number(opts.lodBudget)
    : mode === 'auto' ? budgetFor(opts.capability || deviceCapability()) : Infinity;
  const nearPx = Number.isFinite(Number(opts.lodNearPx)) && opts.lodNearPx !== null && opts.lodNearPx !== '' ? Number(opts.lodNearPx) : LOD_DEFAULTS.nearPx;
  return chooseLod(objs, { scale, mode, nearPx, budget });
}

/** The motion actually used: the system's reduced-motion and the host's own ask can only lower it. */
export function motionFor(opts = {}, systemReduced = false) {
  if (opts.reducedMotion || systemReduced) return 'still';
  return MOTIONS.includes(opts.motion) ? opts.motion : 'gentle';
}
/** Whether the camera drifts, and how: null when it does not. */
export function driftFor(opts = {}, systemReduced = false) {
  const m = motionFor(opts, systemReduced);
  if (opts.drift !== 'on' || m === 'still') return null;
  const deg = num(opts.driftDeg, ROOM3D_DEFAULTS.driftDeg, LIMITS.driftDeg);
  if (!(deg > 0)) return null;
  const secs = num(opts.driftSeconds, ROOM3D_DEFAULTS.driftSeconds, LIMITS.driftSeconds) * (m === 'calm' ? CALM_STRETCH : 1);
  return { deg, seconds: Math.round(secs * 10) / 10 };
}

// ---------------------------------------------------------------------------------------------
// THE STYLESHEET, loaded once per page by the renderer itself (as room_scene.js loads its own).
// ---------------------------------------------------------------------------------------------
let cssPromise = null;
export function ensureRoom3dCss(doc = document) {
  const existing = doc.querySelector('link[data-room3d-css]');
  if (existing && cssPromise) return cssPromise;
  cssPromise = new Promise((resolve) => {
    let link = existing;
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./room3d.css', import.meta.url).href;
      link.setAttribute('data-room3d-css', '');
      doc.head.append(link);
    }
    if (link.sheet) { resolve(true); return; }
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener('error', () => resolve(false), { once: true });
  });
  return cssPromise;
}

// ---------------------------------------------------------------------------------------------
// THE RENDERER
// ---------------------------------------------------------------------------------------------
/**
 * Mount a 3D room into `host` (which should be positioned; the room fills it).
 *   scene  the layout's scene: `{ kind: 'room3d', preset?, recipe?, options? }` (options are read from
 *          `opts`; the arrangement spreads `scene.options` into them)
 *   opts   ROOM3D_DEFAULTS' keys
 */
export function mountRoom3d(host, scene = {}, opts = {}) {
  if (!host) throw new Error('mountRoom3d: a host element is required');
  const doc = host.ownerDocument || document;
  const win = doc.defaultView || window;
  const o = { ...ROOM3D_DEFAULTS, ...opts };
  ensureRoom3dCss(doc);

  let recipe = normalizeRoom3d(scene);
  let view = viewOf(recipe, o);
  let destroyed = false;
  const mq = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let systemReduced = !!mq?.matches;

  const el = (cls, parent) => { const d = doc.createElement('div'); d.className = cls; if (parent) parent.append(d); return d; };
  const root = el('r3');
  root.setAttribute('data-room3d', '');
  root.setAttribute('aria-hidden', 'false');
  const stage = el('r3-stage', root);
  const cam = el('r3-cam', stage);
  host.append(root);

  const faces = {};           // surface -> element
  const slotEls = new Map();  // slot id -> { id, el, surface, slot }
  const boxes = new Map();    // furniture id -> its element
  let lod = null;             // room_lod.js chooseLod's last answer: which level each piece is drawn at
  let scanId = null;          // the piece a host's scan is on (`focusTarget`), or null
  const levelOf = (id) => (lod && lod.levels.get(id)) || 'full';
  const planNow = () => lodPlan(recipe, view, scale, o);
  const publish = (topic, payload) => { try { o.bus?.publish?.(topic, payload); } catch (err) { console.error('room3d: publish', topic, err); } };

  /** Press a piece of furniture, exactly as a click on it does. Returns what happened (null: not a door). */
  function press(id) {
    if (destroyed) return null;
    const f = recipe.furniture.find((x) => x.id === id);
    const target = f ? opensOf(f) : null;
    if (!target) return null;
    let claimed = false;
    publish(DASHBOARD_GO_TOPIC, { id: target, source: 'room', objectId: id, claim: () => { claimed = true; } });
    if (!claimed) { try { o.onUnclaimed?.(OPENS_ACTION, { id, topic: DASHBOARD_GO_TOPIC, opens: target, api }); } catch (err) { console.error('room3d: onUnclaimed', err); } }
    return { did: 'action', action: OPENS_ACTION, topic: DASHBOARD_GO_TOPIC, opens: target, claimed };
  }

  // One piece of furniture: a box of four faces. A door's FRONT face is a real <button> (its name is the
  // button's name, so a keyboard, a screen reader and Tab reach it); a press on ANY of its faces presses it.
  // `level` 'proxy' (room_lod.js): the front face alone -- the same place, colour, name and button.
  function buildBox(f, level = levelOf(f.id)) {
    const p = boxPlace(f, view);
    const b = el('r3-box');
    b.dataset.object = f.id;
    b.dataset.lod = level;
    // The host's scan mark (`focusTarget`) outlives a redraw of this piece -- only while it is still a door.
    if (scanId === f.id && opensOf(f)) b.classList.add('is-scan');
    b.title = f.name;
    b.style.transform = `translate3d(${p.x}px, ${p.y}px, ${p.z}px)`;
    const door = opensOf(f);
    const face = (cls, w, h, t, tag = 'div') => {
      const d = doc.createElement(tag);
      d.className = `r3-face r3-bf ${cls}`;
      b.append(d);
      d.style.width = `${w}px`; d.style.height = `${h}px`;
      d.style.left = `${-w / 2}px`; d.style.top = `${-h / 2}px`;
      d.style.transform = t;
      return d;
    };
    const front = face('r3-bf-front', f.w, f.h, `translate3d(0px, ${-f.h / 2}px, ${f.d / 2}px)`, door ? 'button' : 'div');
    if (level !== 'proxy') {
      face('r3-bf-top', f.w, f.d, `translate3d(0px, ${-f.h}px, 0px) rotateX(90deg)`);
      face('r3-bf-left', f.d, f.h, `translate3d(${-f.w / 2}px, ${-f.h / 2}px, 0px) rotateY(-90deg)`);
      face('r3-bf-right', f.d, f.h, `translate3d(${f.w / 2}px, ${-f.h / 2}px, 0px) rotateY(90deg)`);
    }
    if (door) {
      b.dataset.opens = door;
      front.type = 'button';
      front.dataset.scan = '';
      front.setAttribute('aria-label', f.name);
      const chip = doc.createElement('span');
      chip.className = 'r3-chip';
      chip.textContent = f.name;
      front.append(chip);
      b.addEventListener('click', (e) => { e.stopPropagation(); press(f.id); });
    }
    return b;
  }

  function build() {
    cam.replaceChildren();
    for (const k of Object.keys(faces)) delete faces[k];
    slotEls.clear();
    boxes.clear();
    stage.style.perspective = `${view.lens}px`;
    stage.style.perspectiveOrigin = `50% ${view.eye}%`;
    cam.style.transformOrigin = `50% ${view.eye}% ${-view.depth / 2}px`;
    const ft = faceTransforms(view);
    for (const name of ['back', 'floor', 'ceiling', 'left', 'right']) {
      const f = el(`r3-face r3-${name}`, cam);
      f.dataset.surface = name;
      f.style.width = `${ft[name].w}px`;
      f.style.height = `${ft[name].h}px`;
      f.style.transform = ft[name].transform;
      faces[name] = f;
    }
    for (const sl of recipe.slots) {
      const s = el('r3-slot', faces[sl.surface]);
      s.dataset.slot = sl.id;
      s.style.left = `${sl.x}%`; s.style.top = `${sl.y}%`;
      s.style.width = `${sl.w}%`; s.style.height = `${sl.h}%`;
      slotEls.set(sl.id, { id: sl.id, el: s, surface: sl.surface, slot: { ...sl } });
    }
    lod = planNow();
    for (const f of recipe.furniture) {
      const b = buildBox(f);
      cam.append(b);
      boxes.set(f.id, b);
    }
  }

  // ------------------------------------------------------------------ fitting the stage
  let scale = 1;
  function fit() {
    const r = root.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    if (!(k > 0)) return scale;
    const was = scale;
    scale = k;
    stage.style.transform = `translate(${(r.width - W * k) / 2}px, ${(r.height - H * k) / 2}px) scale(${k})`;
    if (k !== was) relod();
    return scale;
  }
  /** The levels again (the room was drawn at a new size, or the options changed): only a piece whose level
   *  CHANGED is redrawn, so the walls, their slots and the modules in them are never touched. Returns how many. */
  function relod() {
    if (destroyed) return 0;
    const next = planNow();
    const changed = recipe.furniture.filter((f) => (next.levels.get(f.id) || 'full') !== levelOf(f.id));
    lod = next;
    for (const f of changed) {
      const old = boxes.get(f.id);
      const b = buildBox(f);
      if (old && old.parentNode) old.replaceWith(b); else cam.append(b);
      boxes.set(f.id, b);
    }
    return changed.length;
  }
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => { if (!destroyed) fit(); }) : null;
  ro?.observe(root);

  // ------------------------------------------------------------------ the drift
  function applyMotion() {
    root.dataset.labels = o.labels === 'pointed' ? 'pointed' : 'always';
    const d = driftFor(o, systemReduced);
    root.dataset.motion = motionFor(o, systemReduced);
    root.dataset.drift = d ? 'on' : 'off';
    if (d) {
      root.style.setProperty('--r3-yaw', `${d.deg}deg`);
      root.style.setProperty('--r3-drift-s', `${d.seconds}s`);
    } else {
      root.style.removeProperty('--r3-yaw');
      root.style.removeProperty('--r3-drift-s');
    }
  }
  const onMq = (e) => { systemReduced = !!e.matches; applyMotion(); };
  mq?.addEventListener?.('change', onMq);

  build();
  applyMotion();
  fit();

  const api = {
    kind: 'room3d',
    root, stage,
    get scale() { return scale; },
    recipe: () => JSON.parse(JSON.stringify(recipe)),
    view: () => ({ ...view }),
    /** Map slotId -> { id, el, surface, kind, item }: where the host mounts a module. */
    slots() {
      const m = new Map();
      for (const [id, s] of slotEls) m.set(id, { id, el: s.el, surface: s.surface, kind: 'module', item: { ...s.slot }, layer: 'content' });
      return m;
    },
    /** A face element (`back`, `left`, `right`, `floor`, `ceiling`), or null. */
    surface: (name) => faces[name] || null,
    /** Where a module placed freely on `surface` goes: the face element, and its box in % of that face. */
    faceBox(surface, g) {
      const name = SURFACES.includes(surface) ? surface : 'back';
      return { el: faces[name], surface: name, ...faceBoxFor(name, g, view) };
    },
    /** The furniture, for the map editor: `{ id, name, opens }`, in recipe order. */
    objects: () => recipe.furniture.map((f) => ({ id: f.id, name: f.name, opens: opensOf(f) })),
    /** EDIT MODE (edit_mode.js, 2026-10-02): each piece as drawn, `{ id, name, el }`, for choosing it by a
     *  press (the box: a press on any of its faces is a press on it). In recipe order. */
    objectEls: () => recipe.furniture.map((f) => ({ id: f.id, name: f.name, el: boxes.get(f.id) || null })).filter((x) => x.el),
    /**
     * Make piece `id` a door to dashboard `target` (null: no longer one) IN PLACE: only its box is redrawn,
     * so the walls, their slots and every module in them stay mounted. True if anything changed.
     */
    setObjectOpens(id, target) {
      if (destroyed) return false;
      const t = opensOf({ opens: target });
      const i = recipe.furniture.findIndex((f) => f.id === id);
      if (i < 0 || opensOf(recipe.furniture[i]) === t) return false;
      const next = { ...recipe.furniture[i] };
      if (t) next.opens = t; else delete next.opens;
      recipe = { ...recipe, furniture: recipe.furniture.map((f, j) => (j === i ? next : f)) };
      const old = boxes.get(id);
      const b = buildBox(next);
      if (old && old.parentNode) old.replaceWith(b); else cam.append(b);
      boxes.set(id, b);
      return true;
    },
    /** Press a piece as a click on it does (a door publishes `dashboard/go`); null if it is not a door. */
    press,
    /** The doors' buttons, in READING ORDER: what a host walks with a switch (arrangement.js puts them in the
     *  dashboard's lap). Left to right by where each piece is DRAWN (its projected box's middle), then top to
     *  bottom, then recipe order. Argued: the furniture all stands on the one floor, so it reads as one row,
     *  left to right; and it is the order a flattened copy of this room walks too (room_flat.js puts each
     *  hotspot at that same drawn middle, and room_scene.js walks a row left to right), so the same room is
     *  the same lap in 3D and flattened. Recipe order was the order somebody happened to add things in. */
    scanTargets: () => recipe.furniture
      .map((f, i) => { const r = boxRect(f, view); return { f, i, x: r.left + r.w / 2, y: r.top + r.h / 2 }; })
      .sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.i - b.i))
      .map(({ f }) => boxes.get(f.id)?.querySelector('button.r3-bf-front'))
      .filter(Boolean),
    /** A HOST'S LAP: mark the piece `el` belongs to as the one the scan is on (`is-scan`, room3d.css draws it
     *  as its focus), or clear the mark (null, or anything not one of its doors). Kept through a redraw of
     *  that piece. Returns the element, or null. */
    focusTarget(el) {
      const box = el && typeof el.closest === 'function' ? el.closest('.r3-box') : null;
      const id = box && root.contains(box) && box.dataset.opens ? box.dataset.object : null;
      scanId = id;
      for (const b of boxes.values()) b.classList.toggle('is-scan', !!id && b.dataset.object === id);
      return id ? el : null;
    },
    drifting: () => root.dataset.drift === 'on',
    motion: () => root.dataset.motion,
    /** The levels the pieces are drawn at: `{ levels: { id: 'full' | 'proxy' }, cost, budget, far, dropped }`. */
    lod: () => ({ levels: Object.fromEntries(lod ? lod.levels : []), cost: lod ? lod.cost : 0,
      budget: lod ? lod.budget : Infinity, far: lod ? [...lod.far] : [], dropped: lod ? [...lod.dropped] : [] }),
    setOptions(next = {}) {
      if (destroyed) return;
      const rebuild = ['lens', 'depth', 'eye', 'front'].some((k) => k in next && next[k] !== o[k]);
      const relevel = ['lod', 'lodNearPx', 'lodBudget', 'capability'].some((k) => k in next && next[k] !== o[k]);
      Object.assign(o, next);
      if (rebuild) { view = viewOf(recipe, o); build(); } else if (relevel) relod();
      applyMotion();
    },
    fit,
    timers: () => 0,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mq?.removeEventListener?.('change', onMq);
      ro?.disconnect();
      slotEls.clear();
      root.remove();
    },
    destroyed: () => destroyed,
  };
  return api;
}
