// room_drive.js — A ROOM'S OWN FURNITURE AS SOMETHING AN AUTOMATION CAN DRIVE: ITS SIZE, TURN, COLOUR AND PLACE.
// Row 2.62 step 4, 2026-10-07.
//
// Mike, 2026-10-07: *"You could map whatever data to things like the scale, position, rotation. hue (hls), any input an
// item could have really could be mapped to data."* Step 3 (panel_drive.js) reached every PANEL. It could not reach a
// room's own furniture: a sofa or a lamp is an item in the room's recipe (room_scene.js / room3d.js), saved inside the
// dashboard's layout, with no instance and no state handle - so nothing an automation drives could land on it.
//
// *** THE SHAPE: A TARGET OF ITS OWN KIND, AND AN OVERLAY IN THE ROOM, NEVER A WRITE. ***
//   * A binding's target can be `{ room, item, key }` (automation.js `normalizeBinding`): `room` is the dashboard the
//     room belongs to (its screen id - two dashboards' rooms can both have a "sofa0"), `item` the recipe item's id, `key`
//     one of the five numbers below. The engine keys it as `roomTargetId(room, item)`, so everything else in the engine
//     (one driver per number, the flash floor, the overlay) is the same code a panel's setting goes through.
//   * The ROOM registers each of its objects with the engine (arrangement.js `attachRoomDrive`) through an in-memory
//     handle that holds nothing - every value on it is the engine's overlay - and hands what comes back to the renderer
//     (`driveItem(id, row)` on room_scene.js and room3d.js). The renderer draws THAT ONE ITEM again from its recipe entry
//     plus the driven numbers. The recipe, the saved layout and every other item are never touched, so removing the rule
//     (the row empties) draws the item from its recipe entry again: exactly where it was.
//
// *** THE NUMBERS: THE SAME FIVE KEYS AS A PANEL'S (panel_drive.js), SO A RULE READS THE SAME WAY ON EITHER. *** Only
// the words differ (a sofa is not a panel), and in the 3D room "down" means toward you, since furniture stands on the
// floor. Ranges are panel_drive.js's, for the same reasons (on Mike's list there):
//   driveScale   size, % of as placed (100 = unchanged), 10..400
//   driveTurn    turned, degrees, -180..180 (the 2D room turns it in the picture's plane; the 3D room turns it on the
//                floor, about its own foot - the turn a person gives a chair)
//   driveHue     colours shifted round the colour wheel, 0..360
//   driveAcross  moved right (+) or left (-), % of its own width, -100..100
//   driveDown    2D: moved down (+) or up (-), % of its own height; 3D: toward you (+) or away (-), % of its own depth
// A floor object that is moved keeps the SIZE its place gave it (its depth, `ground`), so moving a chair a little toward
// the front does not also make it bigger - that is what driveScale is for, and one number doing two things is a surprise.

export const ROOM_DRIVE_KEYS = Object.freeze(['driveScale', 'driveTurn', 'driveHue', 'driveAcross', 'driveDown']);

const field = (key, label, min, max, def, unit) => Object.freeze({ key, label, kind: 'number', min, max, step: 1,
  default: def, unit, level: 'advanced' });

/** The 2D room's objects. */
export const ROOM_DRIVE_FIELDS = Object.freeze([
  field('driveScale', 'This object: its size', 10, 400, 100, '%'),
  field('driveTurn', 'This object: how far it is turned', -180, 180, 0, '°'),
  field('driveHue', 'This object: its colours, shifted round the colour wheel', 0, 360, 0, '°'),
  field('driveAcross', 'This object: moved left or right', -100, 100, 0, '% of its width'),
  field('driveDown', 'This object: moved up or down', -100, 100, 0, '% of its height'),
]);
/** The 3D room's furniture: the same keys, "down" is toward you. */
export const ROOM3D_DRIVE_FIELDS = Object.freeze([
  field('driveScale', 'This piece: its size', 10, 400, 100, '%'),
  field('driveTurn', 'This piece: how far it is turned on the floor', -180, 180, 0, '°'),
  field('driveHue', 'This piece: its colours, shifted round the colour wheel', 0, 360, 0, '°'),
  field('driveAcross', 'This piece: moved left or right', -100, 100, 0, '% of its width'),
  field('driveDown', 'This piece: moved toward you or away', -100, 100, 0, '% of its depth'),
]);

const LIMIT = Object.fromEntries(ROOM_DRIVE_FIELDS.map((f) => [f.key, [f.min, f.max]]));
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The driven numbers on a row, clamped: `{ scale, turn, hue, across, down, any }`. A key the row does not carry is its
 * unchanged value (scale 1, the rest 0), and `any` says whether the row carries any of them at all. Pure.
 */
export function roomDriveOf(row) {
  const v = (k) => {
    const x = row ? row[k] : undefined;
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    if (!Number.isFinite(n)) return null;
    return Math.max(LIMIT[k][0], Math.min(LIMIT[k][1], n));
  };
  const s = v('driveScale'), t = v('driveTurn'), h = v('driveHue'), a = v('driveAcross'), d = v('driveDown');
  return {
    scale: s === null ? 1 : r2(s / 100), turn: t === null ? 0 : r2(t), hue: h === null ? null : r2(h),
    across: a === null ? 0 : r2(a), down: d === null ? 0 : r2(d),
    any: [s, t, h, a, d].some((x) => x !== null),
  };
}

/** The engine's key for one object of one room. Room and item are ids, kept as given (trimmed). */
export const ROOM_TARGET_PREFIX = 'room:';
export function roomTargetId(room, item) {
  return `${ROOM_TARGET_PREFIX}${String(room == null ? '' : room).trim()}:${String(item == null ? '' : item).trim()}`;
}

/** A state handle that holds nothing: what the engine wraps for a room object (every value on it is the overlay). */
export function emptyHandle() {
  const EMPTY = Object.freeze({});
  return { get: () => EMPTY, subscribe: () => () => {}, set: () => Promise.resolve(), destroy() {} };
}
