// panel_drive.js — A PANEL'S OWN SIZE, TURN, COLOUR AND PLACE, AS NUMBERS AN AUTOMATION CAN DRIVE. Row 2.62, 2026-10-07.
//
// Mike, 2026-10-07: *"You could map whatever data to things like the scale, position, rotation. hue (hls), any input
// an item could have really could be mapped to data."* Chat's question for Code: whether an object's own position,
// scale and rotation can be bound today, "since automation reaches settings read through the module's state and
// placement may live elsewhere".
//
// *** THE ANSWER, WHICH IS WHY THIS FILE EXISTS. *** Placement DOES live elsewhere: a placed panel's x / y / w / h /
// scale / rot is an entry in the dashboard's layout (layout.js `layout.placed`, saved inside the screen's `kiosk` row),
// drawn by arrangement.js `styleWrap`; a grid slot has no transform at all; a room's furniture is a recipe item
// (room_scene.js / room3d.js) with no state handle and no instance. automation.js only ever reaches a panel's OWN
// state handle (`wrapState`), so none of those could be bound. Making the layout itself bindable would mean a second
// overlay inside arrangement.js and every renderer, and a layer over a value that is SAVED for the whole dashboard.
//
// So instead, the smallest thing that reaches every panel wherever it sits: FIVE NUMBERS THE HOST KEEPS ON THE PANEL'S
// OWN STATE ROW (the `instancePanelSurface` / panel_sound.js idea - keys no module declares or reads), applied by the
// host to the panel's box ON TOP OF wherever it was put. They are given to the automation engine as extra fields
// (automation.js `extraFields`), so they are driven exactly as a module's own number is: an overlay in memory, never
// written. Nothing sets them by hand (no menu row), so with no rule they are simply absent and the panel is drawn
// exactly as before - the hand-set placement is never touched, and removing a rule puts the panel back exactly.
//
//   driveScale   size, % of as placed (100 = unchanged)        CSS `scale`
//   driveTurn    turn, degrees (0 = unchanged)                 CSS `rotate`
//   driveHue     colours shifted round the colour wheel, deg  CSS `filter: hue-rotate()`
//   driveAcross  moved right (+) or left (-), % of its width   CSS `translate`
//   driveDown    moved down (+) or up (-), % of its height     CSS `translate`
//
// They are the individual CSS transform properties, not `transform`, so they COMPOSE with whatever transform the
// panel's place already has (a placed panel's own turn and scale, a side wall's perspective) instead of replacing it.
//
// WHAT THIS DOES NOT REACH (row 2.62's report): a ROOM's own furniture (a recipe item has no state handle: binding
// one needs a target kind `{ room, item, key }` and an overlay in room_scene.js / room3d.js), and a placed panel's
// SAVED x / y / w / h (driving those would rewrite the layout; this moves the panel from where it is instead).
//
// RANGES, each a default with its reason (Rule 1; on Mike's list):
//   scale 10..400 %   the same range the Transform window and layout.js LIMITS give a placed panel, so a driven
//                     size can never go anywhere a person could not put it by hand.
//   turn -180..180    a full turn either way, the range layout.js wraps `rot` into.
//   hue 0..360        once round the wheel; 0 and 360 are the same colours.
//   move -100..100 %  up to a whole panel's width / height either way: far enough to stack or slide, never so far
//                     that a panel leaves the screen it is on by more than its own size.
// IS IT MOTION? Driven by a wave it can be. Every one of these is a VISIBLE number, so the event floor (automation.js
// `eventFloorApplies`) holds a reversal to the screen's flash limit like any colour. A screen that asks for reduced
// motion still gets the value (it is data, like a bar's length); there is no animated glide here for it to stop.
// COST ON A PI: a driven `filter` repaints the panel on every change. An LFO on hue repaints it ten times a second;
// a play count, a few times a day.

export const PANEL_DRIVE_FIELDS = Object.freeze([
  Object.freeze({ key: 'driveScale', label: 'The whole panel: its size', kind: 'number', min: 10, max: 400, step: 1,
    default: 100, unit: '%', level: 'advanced' }),
  Object.freeze({ key: 'driveTurn', label: 'The whole panel: how far it is turned', kind: 'number', min: -180, max: 180,
    step: 1, default: 0, unit: '°', level: 'advanced' }),
  Object.freeze({ key: 'driveHue', label: 'The whole panel: its colours, shifted round the colour wheel', kind: 'number',
    min: 0, max: 360, step: 1, default: 0, unit: '°', level: 'advanced' }),
  Object.freeze({ key: 'driveAcross', label: 'The whole panel: moved left or right', kind: 'number', min: -100, max: 100,
    step: 1, default: 0, unit: '% of its width', level: 'advanced' }),
  Object.freeze({ key: 'driveDown', label: 'The whole panel: moved up or down', kind: 'number', min: -100, max: 100,
    step: 1, default: 0, unit: '% of its height', level: 'advanced' }),
]);
export const PANEL_DRIVE_KEYS = Object.freeze(PANEL_DRIVE_FIELDS.map((f) => f.key));

const FIELD = Object.fromEntries(PANEL_DRIVE_FIELDS.map((f) => [f.key, f]));
const r2 = (n) => Math.round(n * 100) / 100;
/** A driven value from a row, clamped to its field; null when the row does not carry it (not driven). */
function valueOf(row, key) {
  const v = row ? row[key] : undefined;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = FIELD[key];
  return Math.max(f.min, Math.min(f.max, n));
}

/**
 * The CSS for one panel's row: `{ scale, rotate, translate, filter }`, each '' when nothing drives it (so the
 * property is cleared and the panel is drawn exactly as before). Pure.
 *
 * A property is SET whenever its key is present - even at its unchanged value (scale 100, turn 0) - and cleared only
 * when the key is gone. Argued: a `filter` or a transform makes the box a new containing block for anything inside it
 * fixed to the screen, so toggling it every time a wave passes through 0 would jump such a thing back and forth. While
 * a rule drives it, it stays one kind of box; when the rule goes, it is the plain box again.
 */
export function panelDriveStyle(row) {
  const scale = valueOf(row, 'driveScale');
  const turn = valueOf(row, 'driveTurn');
  const hue = valueOf(row, 'driveHue');
  const across = valueOf(row, 'driveAcross');
  const down = valueOf(row, 'driveDown');
  return {
    scale: scale === null ? '' : String(r2(scale / 100)),
    rotate: turn === null ? '' : `${r2(turn)}deg`,
    translate: across === null && down === null ? '' : `${r2(across ?? 0)}% ${r2(down ?? 0)}%`,
    filter: hue === null ? '' : `hue-rotate(${r2(hue)}deg)`,
  };
}

/** Apply a row to the panel's box. */
export function applyPanelDrive(el, row) {
  if (!el || !el.style) return;
  const s = panelDriveStyle(row);
  for (const k of ['scale', 'rotate', 'translate', 'filter']) {
    if (el.style[k] !== s[k]) el.style[k] = s[k];
  }
  if (s.scale || s.rotate || s.translate || s.filter) el.dataset.driven = '1';
  else delete el.dataset.driven;
}

/**
 * Follow one panel's (wrapped) state handle: apply now and on every change. Returns the stop, which clears what it
 * set - a panel swapped away must not leave its box turned. Both hosts call it (kiosk.js `mountInstance`, a
 * dashboard's own children in modules/view.js), as they call panel_sound.js `watchPanelSound`.
 */
export function watchPanelDrive(el, state) {
  if (!el || !state?.subscribe) return () => {};
  let off = null;
  try { off = state.subscribe((s) => applyPanelDrive(el, s || {})); } catch { off = null; }
  return () => {
    try { off?.(); } catch { /* already gone */ }
    applyPanelDrive(el, {});
  };
}
