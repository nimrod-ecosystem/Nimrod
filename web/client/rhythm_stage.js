// rhythm_stage.js — WHAT A SONG LOOKS LIKE (Design, note 74, `rhythm_look_20261108`): notes in 2D coming to big targets that read from a bed.
// The song (rhythm_song.js) keeps the time and judges; this only draws where things are at that time. `songFrame` is pure, so a suite can
// check every position without a screen; `paintFrame` puts a frame on a canvas.
//
// ONE BUTTON: one target in the middle, a third of the stage's height, notes coming in from both sides, left-colour notes from the left.
// So the map's two colours still show when any press counts. TWO BUTTONS: two targets. FOUR LANES: four in a row, notes falling to them.
// LEFT AND RIGHT DIFFER BY SHAPE AS WELL AS COLOUR: circles and diamonds; orange and blue, a pair colour-blind players can tell apart (both are
// settings). A theme skins the note and the ground, never the shape, so a theme never changes what a note means.
// THE CUT ARROW IS SHOWN, NOT JUDGED, and not on one button, where it would ask for something any press satisfies.
// A KIND MISS: the note fades as it passes. No cross, no sound, nothing added to the score.
// MOTION OFF: the notes do not travel. A target's ring fills like a clock, the press lands when it is full, one note at a time (`lightTimes`,
// which also holds it to the screen's flash limit). Only a target ever lights; the screen never flashes as a whole.

import { noteWindowMs } from './rhythm_beat.js';
import { themeIdFromRoot } from './aac_sets.js';

export const ARRIVE_CHOICES = Object.freeze(['auto', 'slide', 'ring']);
// How long a word stays, and a missed note fades. Long enough to see at a glance from a bed; short enough to be gone before the next note.
export const POP_MS = 700;
export const MISS_FADE_MS = 500;
export const TARGET_LIT_MS = 160;
// "Great" against "Good": a press inside this of the moment. A word of praise, not a score; nothing counts it.
export const GREAT_MS = 90;

export const NOTE_LEFT_DEFAULT = '#f08a3c';
export const NOTE_RIGHT_DEFAULT = '#3b8fe0';
// Design's four skins. The stage keeps its own dark ground in all of them, FOR: notes and the ring read at a distance on any panel. AGAINST: it
// is a solid sheet where the tile game is see-through ("Panel backgrounds"); a song's stage is a field, as a video's is, so it is kept.
export const STAGE_SKINS = Object.freeze({
  default: { ground: ['#14211c', '#0e1714'], lane: 'rgba(255,255,255,.06)', ring: '#e9eef0', left: NOTE_LEFT_DEFAULT, right: NOTE_RIGHT_DEFAULT, ink: '#0b1014', good: '#f6d36b', look: 'plain' },
  steampunk: { ground: ['#2a1d14', '#140e0a'], lane: 'rgba(201,164,74,.10)', ring: '#c9a44a', left: '#d9772f', right: '#4a8fb8', ink: '#1f1610', good: '#f6d36b', look: 'gear' },
  cyberpunk: { ground: ['#14102a', '#07060f'], lane: 'rgba(45,226,230,.08)', ring: '#2de2e6', left: '#ff8a3d', right: '#2d9cff', ink: '#07060f', good: '#f6d36b', look: 'glow' },
  halloween: { ground: ['#1f1428', '#0c0810'], lane: 'rgba(242,160,60,.08)', ring: '#f2a03c', left: '#f2843c', right: '#7aa8ff', ink: '#120a16', good: '#f6d36b', look: 'plain' },
});
/** A theme's skin, with a person's own colours over it (the default colours mean "the theme's"). PURE. */
export function skinFor(themeId, { left = NOTE_LEFT_DEFAULT, right = NOTE_RIGHT_DEFAULT } = {}) {
  const skin = STAGE_SKINS[themeId] || STAGE_SKINS.default;
  return { ...skin, left: left && left !== NOTE_LEFT_DEFAULT ? left : skin.left, right: right && right !== NOTE_RIGHT_DEFAULT ? right : skin.right };
}
/** The theme on screen, from the nearest element that wears one (the same walk as card_deck.js's, without loading a deck of cards). */
export function themeAt(el) {
  for (let n = el || null; n; n = n.parentElement) {
    const id = n.style?.getPropertyValue('--bg') ? themeIdFromRoot(n) : null;
    if (id) return id;
  }
  return null;
}
/** Slide or ring: "auto" follows the screen's reduced-motion setting. PURE. */
export const arriveFor = (setting, reducedMotion) => (setting === 'slide' || setting === 'ring' ? setting : (reducedMotion ? 'ring' : 'slide'));

/** The targets on a stage this size. A narrow panel keeps them apart: the radius gives way to the width. PURE. */
export function stageLayout(mode, w, h) {
  if (mode === 'two') { const r = Math.min(h * 0.133, w * 0.16); return [0.3, 0.7].map((x) => ({ x: w * x, y: h * 0.6, r })); }
  if (mode === 'four') { const r = Math.min(h * 0.093, w * 0.085); return [0.2, 0.4, 0.6, 0.8].map((x) => ({ x: w * x, y: h * 0.78, r })); }
  return [{ x: w / 2, y: h * 0.52, r: Math.min(h / 6, w / 5) }];
}
/** Which side a note is: the map's colour. 0 left, 1 right. PURE. */
export const sideOf = (note) => (note?.colour === 1 ? 1 : 0);
/** The target nearest a touch. PURE. */
export function nearestTarget(layout, x, y) {
  let best = 0, far = Infinity;
  layout.forEach((t, i) => { const d = Math.hypot(t.x - x, t.y - y); if (d < far) { far = d; best = i; } });
  return best;
}

/**
 * What is on the stage at song time `t`. PURE.
 *   notes, lights, closed(i)/missed(i)   the song's: `lightTimes`, and whether a press answered it or it was missed
 *   mode, arrive, leadMs, windowSetting, offsetMs, targetOf(note), layout, w
 * -> { draw: [{ kind: 'note' | 'ring', ... }], from }. `from` is where the next frame may start: every note before it is over.
 */
export function songFrame({ t, notes, lights = [], answered = () => false, missed = () => false, mode = 'one', arrive = 'slide', leadMs = 2000,
  windowSetting = 'generous', offsetMs = 0, targetOf = () => 0, layout = [], w = 0, from = 0 }) {
  const draw = [];
  let start = from;
  const pastAll = Number(offsetMs || 0) + MISS_FADE_MS + 1000;
  while (start < notes.length && notes[start].ms + pastAll < t) start += 1;
  for (let i = start; i < notes.length; i += 1) {
    const n = notes[i];
    const dt = n.ms - t;
    const tg = layout[targetOf(n)] || layout[0];
    if (!tg) break;
    const side = sideOf(n);
    const cut = mode === 'one' ? 8 : n.cut;
    // The fade after a miss, wherever the note had got to, is the same in both looks.
    if (missed(i)) {
      const since = t - (n.ms + noteWindowMs(notes, i, windowSetting) + Number(offsetMs || 0));
      if (since >= 0 && since < MISS_FADE_MS) draw.push({ kind: 'note', i, side, cut: 8, x: tg.x + (mode === 'one' ? (side ? -1 : 1) * tg.r * 0.2 : 0), y: tg.y + (mode === 'one' ? 0 : tg.r * 0.3), r: tg.r * 0.45, alpha: 0.3 * (1 - since / MISS_FADE_MS), missed: true });
      continue;
    }
    if (answered(i)) continue;
    if (arrive === 'ring') {
      const l = lights[i];
      if (!l || t < l.on) { if (l && l.on > t) break; continue; }
      if (t >= l.off) continue;
      const fill = n.ms > l.on ? Math.min(1, (t - l.on) / (n.ms - l.on)) : 1;
      draw.push({ kind: 'ring', i, side, x: tg.x, y: tg.y, r: tg.r * 0.86, fill });
      if (fill > 0.7) draw.push({ kind: 'note', i, side, cut, x: tg.x, y: tg.y, r: tg.r * 0.42, alpha: Math.min(1, (fill - 0.7) / 0.3) });
      continue;
    }
    if (dt > leadMs) break;
    const away = leadMs > 0 ? dt / leadMs : 0;     // 1 at the edge of the stage, 0 on the target, a little under once it has passed
    const r = tg.r * 0.55;
    let x = tg.x, y = tg.y;
    if (mode === 'one') x = tg.x + (side ? 1 : -1) * away * (w / 2 + tg.r);
    else y = tg.y - away * (tg.y + tg.r);
    draw.push({ kind: 'note', i, side, cut, x, y, r, alpha: 1 });
  }
  return { draw, from: start };
}

// A note's cut, as the arrow's turn from pointing down (the map's numbers: 0 up, 1 down, 2 left, 3 right, then the diagonals; 8 is any).
const CUT_TURN = [Math.PI, 0, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI / 4, -Math.PI / 4];

function paintNote(c, n, skin) {
  c.save();
  c.globalAlpha = n.alpha ?? 1;
  c.translate(n.x, n.y);
  const fill = n.side ? skin.right : skin.left;
  if (skin.look === 'glow') { c.shadowColor = fill; c.shadowBlur = n.r * 0.3; }
  c.fillStyle = fill;
  c.strokeStyle = skin.ink;
  c.lineWidth = Math.max(2, n.r * 0.08);
  c.beginPath();
  if (n.side) {
    const d = n.r * 1.15;
    c.moveTo(0, -d); c.lineTo(d, 0); c.lineTo(0, d); c.lineTo(-d, 0); c.closePath();
  } else c.arc(0, 0, n.r, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  c.stroke();
  if (skin.look === 'gear') {
    c.strokeStyle = skin.ink; c.globalAlpha = (n.alpha ?? 1) * 0.55; c.lineWidth = Math.max(1, n.r * 0.04);
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4;
      c.beginPath(); c.moveTo(Math.cos(a) * n.r * 0.35, Math.sin(a) * n.r * 0.35); c.lineTo(Math.cos(a) * n.r * 0.75, Math.sin(a) * n.r * 0.75); c.stroke();
    }
    c.globalAlpha = n.alpha ?? 1;
  }
  if (n.cut != null && CUT_TURN[n.cut] !== undefined) {
    c.rotate(CUT_TURN[n.cut]);
    c.fillStyle = skin.ink;
    c.beginPath(); c.moveTo(-n.r * 0.45, -n.r * 0.1); c.lineTo(n.r * 0.45, -n.r * 0.1); c.lineTo(0, n.r * 0.45); c.closePath(); c.fill();
  }
  c.restore();
}

/**
 * One frame on a 2D context. Where a target is lit, what words are up and what the targets say are the panel's:
 *   frame, layout, mode, skin, w, h, font, lit: [bool], pops: [{ word, x, y, age (0-1) }], labels: [string], reducedMotion
 */
export function paintFrame(c, { frame, layout, mode, skin, w, h, font = 'sans-serif', lit = [], pops = [], labels = [], reducedMotion = false }) {
  c.clearRect(0, 0, w, h);
  c.fillStyle = skin.lane;
  if (mode === 'one') c.fillRect(0, layout[0].y - layout[0].r * 0.4, w, layout[0].r * 0.8);
  else layout.forEach((t) => c.fillRect(t.x - t.r * 0.8, 0, t.r * 1.6, h));
  layout.forEach((t, i) => {
    c.save();
    c.translate(t.x, t.y);
    c.lineWidth = Math.max(3, t.r * 0.07);
    c.strokeStyle = skin.ring;
    c.globalAlpha = lit[i] ? 1 : 0.75;
    c.beginPath(); c.arc(0, 0, t.r, 0, Math.PI * 2); c.stroke();
    if (lit[i]) { c.globalAlpha = 0.35; c.fillStyle = skin.good; c.fill(); }
    if (labels[i]) {
      c.globalAlpha = 1; c.fillStyle = skin.ring;
      c.font = `800 ${Math.round(Math.max(14, t.r * 0.28))}px ${font}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(labels[i], 0, t.r * 1.35);
    }
    c.restore();
  });
  for (const d of frame.draw) {
    if (d.kind !== 'ring') continue;
    c.save();
    c.strokeStyle = d.side ? skin.right : skin.left;
    c.lineWidth = Math.max(4, d.r * 0.14);
    c.lineCap = 'round';
    c.beginPath(); c.arc(d.x, d.y, d.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * d.fill); c.stroke();
    c.restore();
  }
  for (const d of frame.draw) if (d.kind === 'note') paintNote(c, d, skin);
  for (const p of pops) {
    c.save();
    c.globalAlpha = 1 - p.age;
    c.fillStyle = skin.good;
    c.font = `800 ${Math.round(Math.max(18, p.size))}px ${font}`;
    c.textAlign = 'center';
    c.fillText(p.word, p.x, p.y - (reducedMotion ? 0 : p.age * p.size));
    c.restore();
  }
}
