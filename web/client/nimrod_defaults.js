// nimrod_defaults.js - THE SITE'S OWN DEFAULTS, AS ITS DESIGNER SET THEM (Design's item 42.3, "one change-the-defaults
// route"; Design System19 README, 2026-10-25).
//
// Design: "change_defaults.html collects every default into one file, nimrod_defaults.json ... Code installs it as the
// built-in versions. A missing entry keeps the built-in one. ... It matches what Code built on dashboards ('Copy as the
// default'). Send that to the same file, under the same keys." So this is that file, as a module (importing JSON needs
// a newer browser than a Pi's: the same reason lessons/right_to_repair.js is a module):
//   rooms       { <preset>: <room recipe> }                  over room_presets.js (presetRecipe)
//   town        { <deck>: { <placeId>: <room recipe> } }      over town.js's places (town_edits.js recipeFor)
//   village     { <scene>: <village recipe> }                over village_kit.js's starting scenes (modules/village.js)
//   backdrops   { <theme>: <backdrop recipe> }                once the themes' backdrops are pieces (item 42.2; nothing reads it yet)
// HOW AN ENTRY GETS HERE: "Copy as the default" on a dashboard's room (and the village and town builders' "Designer:
// change the defaults") copies an entry in this exact shape (`defaultsEntry`); it is pasted to Code and merged in
// here as a commit. The defaults are code, reviewed like code: the page never writes this file.

export const DEFAULTS_FORMAT = 'nimrod-defaults';
export const DEFAULTS_VERSION = 1;
export const DEFAULT_KINDS = Object.freeze(['rooms', 'town', 'village', 'backdrops']);

export const NIMROD_DEFAULTS = Object.freeze({
  format: DEFAULTS_FORMAT,
  version: DEFAULTS_VERSION,
  made: '',
  rooms: {},
  town: {},
  village: {},
  backdrops: {},
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The designer's default at `kind` / ...path (a copy), or null: the built-in one stands. PURE. */
export function defaultFor(kind, path = [], defaults = NIMROD_DEFAULTS) {
  let v = isObj(defaults) && DEFAULT_KINDS.includes(kind) ? defaults[kind] : null;
  for (const k of path) v = isObj(v) ? v[k] : null;
  return isObj(v) ? clone(v) : null;
}

/** An entry for this file, as text to copy: `{ format, version, made, <kind>: { ...path: recipe } }`. PURE. */
export function defaultsEntry(kind, path, recipe, { made = '' } = {}) {
  if (!DEFAULT_KINDS.includes(kind) || !Array.isArray(path) || !path.length || !isObj(recipe)) return '';
  let body = clone(recipe);
  for (const k of [...path].reverse()) body = { [String(k)]: body };
  return JSON.stringify({ format: DEFAULTS_FORMAT, version: DEFAULTS_VERSION, made: String(made || ''), [kind]: body }, null, 2);
}
