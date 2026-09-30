// room_presets.js — STARTING ROOMS, as plain recipes (the schema is room_scene.js's).
//
// Four are Claude Design's `room_presets.json` (guide-and-rooms, 2026-09-29): living, bedroom, study,
// fireside. The fifth, `theRoom`, is the room from Design's room-is-the-screen prototype
// (`room.js` `baseRecipe` + `ROLES`, 2026-09-30), where the furniture carries the screen's controls:
//
//   the low cabinet      display  -> the transport bar (a 3×1 slot), lifted flat when chosen
//   the bookshelf        display  -> the edit menus (2×3), one shelf per menu
//   the side-wall door   button   -> Settings (the same `settings.open` the plain bar's button runs)
//   the flower pot       button   -> Full screen on/off
//   the lamp and speaker react to notifications (the lamp lights, the speaker pulses)
//
// *** WHAT WAS CHANGED FROM DESIGN'S FILE, AND WHY. Everything else is Design's, value for value. ***
//
//   1. THE WORDS ON THE SIGNS. Design's samples were "Cici", "Mike" and "Grandma Rosemary". Site copy
//      never names the person this was first built for (Mike, 2026-09-11), and a stranger's room
//      should not open wearing somebody else's name either. They are neutral words now; the room
//      module's "Words on the signs" setting puts anybody's own there. Which words: Mike's list.
//   2. THE SAMPLE PHOTOS. Design pointed two frames at `assets/images/sample-photo-*.jpg`, which is
//      the design system's folder and does not exist on this site. They point at two of the site's
//      own bundled sample pictures (`/demo-media/files/*.svg`, drawn for the signed-out demo, each
//      marked "sample" on its face). Every other frame stays EMPTY, as Design drew it: a picture in
//      a frame is the person's content, and it arrives through a slot (room_scene.js `pictureFor`),
//      not from a preset.
//   3. `id`s on the items. Design's four starter rooms had none; a notification rule or a host needs
//      a stable handle for "the lamp", so each item has one. Nothing about how it draws changes.
//   4. `theRoom` uses `light:'auto'` where the prototype's recipe said 'day': the prototype had its own
//      Night button standing in for the clock. The calculator's wall of twelve key-pictures is NOT in
//      it: split controls are build step 6 of chat's order (room_as_home §6), and a key that sends a
//      digit to no calculator is a press spent for nothing. room_scene.js supports the `keys` role;
//      the suite exercises it with a recipe of its own.

const SAMPLE_1 = '/demo-media/files/morning-window.svg';
const SAMPLE_2 = '/demo-media/files/garden.svg';

export const ROOM_PRESETS = {
  theRoom: {
    label: 'The room (controls in the furniture)',
    recipe: {
      shell: 'room', wall: { finish: 'limewash', color: '#cfd8cf', wainscot: '#8f9c7a' }, floor: { finish: 'tile', color: '#e8e2d2' },
      light: 'auto', view: 'auto',
      items: [
        { id: 'window', kind: 'furniture', part: 'window', x: 50, y: 26, scale: 0.8 },
        { id: 'door', kind: 'furniture', part: 'door', x: 8, y: 55, wall: 'left',
          role: 'button', action: 'settings.open', label: 'Settings', needs: [1, 1], slot: [0.1, 0.06, 0.8, 0.94] },
        { id: 'shelf', kind: 'furniture', part: 'bookshelf', x: 25, y: 74,
          role: 'display', module: 'edit', label: 'Edit menus', needs: [2, 3], slot: [0.07, 0.04, 0.86, 0.92] },
        { id: 'pot', kind: 'furniture', part: 'plant', x: 40, y: 88,
          role: 'button', action: 'fullscreen.toggle', label: 'Full screen', needs: [1, 1], slot: [0.22, 0.64, 0.56, 0.36] },
        { id: 'cab', kind: 'furniture', part: 'cabinet', x: 53, y: 76,
          role: 'display', module: 'transport', label: 'Transport bar', needs: [3, 1], slot: [0.03, 0.1, 0.94, 0.68] },
        { id: 'lamp', kind: 'furniture', part: 'tableLamp', x: 47, y: 64.4, ground: 76 },
        { id: 'spk', kind: 'furniture', part: 'speaker', x: 60, y: 64.4, ground: 76 },
        { id: 'clock', kind: 'clock', x: 92, y: 30, wall: 'right', size: 64 },
        { id: 'cat', kind: 'cat', x: 84, y: 93, pose: 'sleeping', size: 96 },
      ],
    },
  },
  living: {
    label: 'Living room',
    recipe: {
      shell: 'room', wall: { finish: 'sprig', color: '#e6dcc4', wainscot: '#8f9c7a' }, floor: { finish: 'boards', color: '#9a6a42' },
      light: 'auto', view: 'auto',
      items: [
        { id: 'window', kind: 'furniture', part: 'window', x: 36, y: 30 },
        { id: 'rug', kind: 'furniture', part: 'rug', x: 50, y: 94 },
        { id: 'bookshelf', kind: 'furniture', part: 'bookshelf', x: 79, y: 70 },
        { id: 'sofa', kind: 'furniture', part: 'sofa', x: 46, y: 86 },
        { id: 'table', kind: 'furniture', part: 'sideTable', x: 18, y: 88 },
        { id: 'lamp', kind: 'furniture', part: 'tableLamp', x: 18, y: 75.5, ground: 88 },
        { id: 'plant', kind: 'furniture', part: 'plant', x: 92, y: 96 },
        { id: 'sign', kind: 'sign', x: 36, y: 6, name: 'Welcome home', variant: 'wood', size: 'sm' },
        { id: 'frame1', kind: 'frame', x: 58, y: 24, frame: 'classic', width: 92 },
        { id: 'frame2', kind: 'frame', x: 58, y: 48, frame: 'instant', width: 70, src: SAMPLE_2 },
        { id: 'clock', kind: 'clock', x: 70, y: 16, size: 70 },
        { id: 'calendar', kind: 'calendar', x: 8, y: 40, width: 64, wall: 'left' },
        { id: 'frame3', kind: 'frame', x: 92, y: 38, frame: 'ornate', width: 96, wall: 'right', src: SAMPLE_2 },
        { id: 'cat', kind: 'cat', x: 55, y: 72, ground: 86.5, pose: 'sleeping', size: 90 },
      ],
    },
  },
  bedroom: {
    label: 'Bedroom',
    recipe: {
      shell: 'corner', wall: { finish: 'stripes', color: '#c9d6d3' }, floor: { finish: 'carpet', color: '#9c8a74' },
      light: 'evening', view: 'night',
      items: [
        { id: 'window', kind: 'furniture', part: 'window', x: 76, y: 30 },
        { id: 'bed', kind: 'furniture', part: 'bed', x: 50, y: 92 },
        { id: 'table', kind: 'furniture', part: 'sideTable', x: 25, y: 88 },
        { id: 'lamp', kind: 'furniture', part: 'tableLamp', x: 25, y: 75.5, ground: 88 },
        { id: 'plant', kind: 'furniture', part: 'plant', x: 90, y: 94 },
        { id: 'frame1', kind: 'frame', x: 50, y: 26, frame: 'ornate', width: 110, src: SAMPLE_1 },
        { id: 'clock', kind: 'clock', x: 34, y: 22, size: 64 },
        { id: 'calendar', kind: 'calendar', x: 12, y: 40, width: 64, wall: 'left' },
        { id: 'sign', kind: 'sign', x: 10, y: 16, name: 'Sweet dreams', variant: 'neon', size: 'sm', wall: 'left' },
        { id: 'cat', kind: 'cat', x: 62, y: 70, ground: 92.5, pose: 'sleeping', size: 90 },
      ],
    },
  },
  study: {
    label: 'Study',
    recipe: {
      shell: 'flat', wall: { finish: 'brick', color: '#9b5a44' }, floor: { finish: 'boards', color: '#6e4a2e' },
      light: 'day', view: 'fall',
      items: [
        { id: 'bookshelf', kind: 'furniture', part: 'bookshelf', x: 12, y: 84 },
        { id: 'desk', kind: 'furniture', part: 'desk', x: 50, y: 88 },
        { id: 'lamp', kind: 'furniture', part: 'floorLamp', x: 78, y: 90 },
        { id: 'plant', kind: 'furniture', part: 'plant', x: 92, y: 94 },
        { id: 'shelf', kind: 'furniture', part: 'wallShelf', x: 82, y: 30 },
        { id: 'photos', kind: 'module', x: 44, y: 34, module: 'photos', w: 240, h: 140 },
        { id: 'sign', kind: 'sign', x: 44, y: 8, name: 'Study', variant: 'plate', size: 'sm' },
        { id: 'clock', kind: 'clock', x: 66, y: 26, size: 70 },
        { id: 'monitor', kind: 'frame', x: 24, y: 28, frame: 'monitor', aspect: '4:3', width: 110 },
        { id: 'cat', kind: 'cat', x: 56, y: 70.5, ground: 88, pose: 'idle', size: 80 },
      ],
    },
  },
  fireside: {
    label: 'Fireside attic',
    recipe: {
      shell: 'attic', wall: { finish: 'boards', color: '#a8794e' }, floor: { finish: 'boards', color: '#7a5234' },
      light: 'night', view: 'winter',
      items: [
        { id: 'rug', kind: 'furniture', part: 'rug', x: 50, y: 95 },
        { id: 'fire', kind: 'furniture', part: 'fireplace', x: 50, y: 70 },
        { id: 'chair', kind: 'furniture', part: 'armchair', x: 22, y: 92 },
        { id: 'lamp', kind: 'furniture', part: 'floorLamp', x: 82, y: 86 },
        { id: 'window', kind: 'furniture', part: 'window', x: 76, y: 32, scale: 0.7 },
        { id: 'frame1', kind: 'frame', x: 50, y: 24, frame: 'classic', width: 96, src: SAMPLE_1 },
        { id: 'sign', kind: 'sign', x: 8, y: 44, name: 'Home', variant: 'chalkboard', size: 'sm', wall: 'left' },
        { id: 'clock', kind: 'clock', x: 92, y: 46, size: 72, wall: 'right' },
        { id: 'calendar', kind: 'calendar', x: 36, y: 44, width: 56 },
        { id: 'cat', kind: 'cat', x: 58, y: 100, pose: 'sleeping', size: 90 },
      ],
    },
  },
};

export const DEFAULT_PRESET = 'theRoom';

/** [{value,label}] for a settings `choice`, in this file's order. */
export const listPresets = () => Object.entries(ROOM_PRESETS).map(([value, p]) => ({ value, label: p.label }));

/** A deep copy of a preset's recipe (an unknown key gives the default), so nothing edits the table. */
export function presetRecipe(key) {
  const p = ROOM_PRESETS[key] || ROOM_PRESETS[DEFAULT_PRESET];
  return JSON.parse(JSON.stringify(p.recipe));
}
