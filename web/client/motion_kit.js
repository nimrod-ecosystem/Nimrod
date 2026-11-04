/* motionKit.js: ONE MOTION FORMAT for characters, the cat and any village piece (notes 58 to 60).
 *
 * Plain JavaScript, no imports. A motion is data, not drawing: it names joints and says how far each
 * one turns or moves over time. Any body that has those joints can play it, so one "nod" plays on the
 * King, the baker, a child and Nimrod the cat. A body that lacks a joint simply ignores that track.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SKELETON (rest pivots, in each body's own drawing units)
 *   figure (characterKit, 200×320): root, waist, neck, shoulderL/R, elbowL/R, wristL/R, hipL/R, kneeL/R
 *   cat    (catKit,       200×320): root, neck, tail
 *   piece  (any village piece):     root only (its foot point)
 *   "L" and "R" are the character's own left and right as you look at them on screen (L = screen left).
 *
 * A POSE (one still frame) is   { id, name, joints: { joint: { rot, x, y, len } }, face, marks }
 *   rot  degrees, clockwise, about the joint's pivot
 *   x, y user units, added after the turn
 *   len  stretch of the limb segment that STARTS at this joint (1 = as drawn; 0.5 = foreshortened)
 *   face an expression name the body knows (figure: neutral happy talk sleep think puzzled frown;
 *        cat: neutral happy)
 *   marks extra drawings a pose carries (think bubble, sound arcs, zzz, question mark)
 *
 * A MOTION (an emote, a gesture or a move) is
 *   { id, name, words: [...], tags: [...], target: 'body'|'piece', duration: ms, loop: true|false,
 *     still: 0..1, face?, pose?, tracks: { joint: { channel: [[t, value], ...] } } }
 *   t        0..1, a fraction of the duration
 *   channel  rot | x | y on any joint; faceX | faceY on neck (the face slides inside the head, which
 *            is how a flat drawing turns or tips its head); scale | opacity on root
 *   props    { joint: propId } things held for the motion (characterKit PROPS: cup), drawn in that joint
 *   still    the moment that reads on its own: drawn when animation is off, by a person's needs, the
 *            screen's detail level, or the device's own "reduce motion"
 *   pose     the pose the motion plays on top of (default: the body's stand)
 *   Values are ADDED to the pose, so a nod plays on top of a wave.
 *
 * How it plays: motionCss() turns a motion into CSS keyframes scoped to one drawing's id, inside
 * @media (prefers-reduced-motion: no-preference). No script runs, so an animated SVG works in an <img>,
 * and the still frame is written into the drawing itself as plain transform attributes.
 * The format is shaped like DragonBones' bones and keyframes (Code's note, 2026-11-02) so an importer
 * for that, or for side-view angles from motion-capture BVH files, can write it later.
 * --------------------------------------------------------------------------------------------- */

import { MOTION_LIBRARY } from './motion_library.js';

export const MOTION_FORMAT_VERSION = 1;

/* ---- the starting motions. Each is a finished example of its kind (note 59). ---- */
export const MOTIONS = {
  nod: {
    id: 'nod', name: 'Nod (yes)', words: ['yes', 'agree', 'okay'], tags: ['aac', 'emote', 'gesture'],
    target: 'body', duration: 1400, loop: true, still: 0.22, face: 'happy',
    tracks: {
      neck: {
        y: [[0, 0], [0.22, 4], [0.44, 0], [0.66, 4], [0.88, 0], [1, 0]],
        faceY: [[0, 0], [0.22, 7], [0.44, -1], [0.66, 7], [0.88, 0], [1, 0]],
      },
    },
  },
  shake: {
    id: 'shake', name: 'Head shake (no)', words: ['no', 'disagree', 'not'], tags: ['aac', 'emote', 'gesture'],
    target: 'body', duration: 1400, loop: true, still: 0.18, face: 'frown',
    tracks: {
      neck: {
        rot: [[0, 0], [0.18, -5], [0.4, 5], [0.62, -5], [0.84, 0], [1, 0]],
        faceX: [[0, 0], [0.18, -9], [0.4, 9], [0.62, -9], [0.84, 0], [1, 0]],
      },
    },
  },
  waveHello: {
    id: 'waveHello', name: 'Wave', words: ['hello', 'hi', 'bye', 'goodbye'], tags: ['aac', 'emote', 'gesture'],
    target: 'body', duration: 1200, loop: true, still: 0.25, face: 'happy', pose: 'wave',
    tracks: { elbowR: { rot: [[0, 0], [0.25, -24], [0.5, 0], [0.75, -24], [1, 0]] } },
  },
  walk: {
    id: 'walk', name: 'Walk in place', words: ['walk', 'go', 'come'], tags: ['move', 'cycle'],
    target: 'body', duration: 900, loop: true, still: 0.25,
    tracks: {
      root: { y: [[0, 0], [0.25, -4], [0.5, 0], [0.75, -4], [1, 0]] },
      hipL: { rot: [[0, 14], [0.5, -14], [1, 14]] }, kneeL: { rot: [[0, 0], [0.25, 18], [0.5, 0], [1, 0]] },
      hipR: { rot: [[0, -14], [0.5, 14], [1, -14]] }, kneeR: { rot: [[0, 0], [0.5, 0], [0.75, 18], [1, 0]] },
      shoulderL: { rot: [[0, -12], [0.5, 12], [1, -12]] }, shoulderR: { rot: [[0, 12], [0.5, -12], [1, 12]] },
      tail: { rot: [[0, -6], [0.5, 6], [1, -6]] },
    },
  },
  /* A PIECE motion: moves the whole drawing on its stage. Plays on anything, a person, a cart or a cloud. */
  enterLeft: {
    id: 'enterLeft', name: 'Enter from the left', words: ['enter', 'arrive', 'come in'], tags: ['move', 'piece'],
    target: 'piece', duration: 2400, loop: false, still: 1,
    tracks: { root: { x: [[0, -420], [1, 0]], opacity: [[0, 0], [0.15, 1], [1, 1]] } },
  },
  comeCloser: {
    id: 'comeCloser', name: 'Come closer', words: ['come', 'here', 'approach'], tags: ['move', 'piece', 'aac'],
    target: 'piece', duration: 2000, loop: false, still: 1,
    tracks: { root: { scale: [[0, 0.72], [1, 1]], y: [[0, -56], [1, 0]] } },
  },
  /* Mike, 2026-11-02: going away walks back into the scene and stays there; it does not vanish. comeCloser is its
     exact reverse, so the two chain. To leave the stage for real, use exitLeft or exitRight (motionLibrary.js). */
  goAway: {
    id: 'goAway', name: 'Go away (step back)', words: ['go', 'away', 'back', 'bye'], tags: ['move', 'piece', 'aac'],
    target: 'piece', duration: 2000, loop: false, still: 1,
    tracks: { root: { scale: [[0, 1], [1, 0.72]], y: [[0, 0], [1, -56]] } },
  },
};
/* chat's drafts that Design kept (motionLibrary.js); the core seven above win on a clash */
for (const [k, v] of Object.entries(MOTION_LIBRARY)) if (!MOTIONS[k]) MOTIONS[k] = v;

/* ---- maths ---- */
export function valueAt(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys[keys.length - 1][1];
}
const r2 = (n) => Math.round(n * 100) / 100;
const DEF = { rot: 0, x: 0, y: 0, faceX: 0, faceY: 0, scale: 1, opacity: 1 };
const chan = (tr, c, t) => (tr && tr[c] ? valueAt(tr[c], t) : DEF[c]);

/* The SVG transform for one joint's motion group at time t (used for the still frame). */
export function jointAttr(pivot, tr, t) {
  const [px, py] = pivot, rot = chan(tr, 'rot', t), x = chan(tr, 'x', t), y = chan(tr, 'y', t), s = chan(tr, 'scale', t);
  if (!rot && !x && !y && s === 1) return '';
  return `translate(${r2(px + x)} ${r2(py + y)}) rotate(${r2(rot)}) scale(${r2(s)}) translate(${-px} ${-py})`;
}
export function faceAttr(tr, t) {
  const x = chan(tr, 'faceX', t), y = chan(tr, 'faceY', t);
  return x || y ? `translate(${r2(x)} ${r2(y)})` : '';
}
/* Attributes for every motion group of a body at the motion's still moment. */
export function stillAttrs(motion, pivots) {
  const out = {};
  if (!motion) return out;
  for (const [j, tr] of Object.entries(motion.tracks || {})) {
    if (pivots[j]) out[j] = jointAttr(pivots[j], tr, motion.still ?? 0);
    if (j === 'neck') out.face = faceAttr(tr, motion.still ?? 0);
  }
  const root = motion.tracks?.root;
  if (root && root.opacity) out.rootOpacity = r2(valueAt(root.opacity, motion.still ?? 0));
  return out;
}

/* CSS for one drawing (scoped by its id). Animates the .m-<joint> groups and .m-face. */
export function motionCss(scope, motion, pivots, { speed = 1 } = {}) {
  if (!motion) return '';
  const dur = Math.round(motion.duration / (speed || 1)), loop = motion.loop ? 'infinite' : '1 both';
  const rules = [], frames = [];
  const add = (cls, name, steps) => {
    frames.push(`@keyframes ${name}{${steps.join('')}}`);
    rules.push(`#${scope} .${cls}{transform-origin:0 0;animation:${name} ${dur}ms ease-in-out ${loop}}`);
  };
  for (const [j, tr] of Object.entries(motion.tracks || {})) {
    if (!pivots[j]) continue;
    const [px, py] = pivots[j];
    const times = [...new Set(['rot', 'x', 'y', 'scale', 'opacity'].flatMap((c) => (tr[c] || []).map((k) => k[0])).concat([0, 1]))].sort((a, b) => a - b);
    if (['rot', 'x', 'y', 'scale', 'opacity'].some((c) => tr[c])) {
      add(`m-${j}`, `${scope}-${j}`, times.map((t) => `${r2(t * 100)}%{transform:translate(${r2(px + chan(tr, 'x', t))}px,${r2(py + chan(tr, 'y', t))}px) rotate(${r2(chan(tr, 'rot', t))}deg) scale(${r2(chan(tr, 'scale', t))}) translate(${-px}px,${-py}px)${tr.opacity ? `;opacity:${r2(chan(tr, 'opacity', t))}` : ''}}`));
    }
    if (j === 'neck' && (tr.faceX || tr.faceY)) {
      const ft = [...new Set(['faceX', 'faceY'].flatMap((c) => (tr[c] || []).map((k) => k[0])).concat([0, 1]))].sort((a, b) => a - b);
      add('m-face', `${scope}-face`, ft.map((t) => `${r2(t * 100)}%{transform:translate(${r2(chan(tr, 'faceX', t))}px,${r2(chan(tr, 'faceY', t))}px)}`));
    }
  }
  if (!rules.length) return '';
  return `<style>@media (prefers-reduced-motion: no-preference){${frames.join('')}${rules.join('')}}</style>`;
}

/* Play a PIECE motion on any drawing: wraps the markup in a root group. `foot` is the piece's pivot. */
export function playOnPiece(inner, motion, { foot = [0, 0], animated = true, id } = {}) {
  if (!motion) return inner;
  const scope = id || 'mp' + Math.random().toString(36).slice(2, 8);
  const st = stillAttrs(motion, { root: foot });
  return `<g id="${scope}">${animated ? motionCss(scope, motion, { root: foot }) : ''}<g class="m-root"${st.root ? ` transform="${st.root}"` : ''}${st.rootOpacity != null && st.rootOpacity !== 1 ? ` opacity="${st.rootOpacity}"` : ''}>${inner}</g></g>`;
}

/* Check a motion before it is kept (for chat's bulk drafts): returns a list of problems, empty if fine. */
export function checkMotion(m, knownJoints = ['root', 'waist', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'tail']) {
  const p = [];
  if (!m || typeof m !== 'object') return ['not an object'];
  for (const k of ['id', 'name', 'target', 'duration', 'tracks']) if (m[k] == null) p.push(`missing ${k}`);
  if (m.target && !['body', 'piece'].includes(m.target)) p.push(`target must be body or piece`);
  if (m.still != null && (m.still < 0 || m.still > 1)) p.push('still must be 0..1');
  for (const [j, tr] of Object.entries(m.tracks || {})) {
    if (!knownJoints.includes(j)) p.push(`unknown joint ${j}`);
    for (const [c, keys] of Object.entries(tr)) {
      if (!['rot', 'x', 'y', 'faceX', 'faceY', 'scale', 'opacity'].includes(c)) p.push(`${j}: unknown channel ${c}`);
      if (!Array.isArray(keys) || keys.some((k) => !Array.isArray(k) || k.length !== 2 || k[0] < 0 || k[0] > 1)) p.push(`${j}.${c}: keys must be [[t 0..1, value], ...]`);
      else if (keys.some((k, i) => i && k[0] < keys[i - 1][0])) p.push(`${j}.${c}: times must go up`);
      if (c === 'rot' && keys.some((k) => Math.abs(k[1]) > 180)) p.push(`${j}.rot: more than 180 degrees`);
    }
  }
  /* Safety default (accessibility): no motion may flash. Opacity may fade, but not blink faster than 3 times a second. */
  const o = m.tracks?.root?.opacity;
  if (o && m.duration) {
    let flips = 0;
    for (let i = 2; i < o.length; i++) if (Math.sign(o[i][1] - o[i - 1][1]) && Math.sign(o[i][1] - o[i - 1][1]) !== Math.sign(o[i - 1][1] - o[i - 2][1])) flips++;
    if (flips / 2 / (m.duration / 1000) > 3) p.push('opacity changes more than 3 times a second (flash limit)');
  }
  return p;
}
