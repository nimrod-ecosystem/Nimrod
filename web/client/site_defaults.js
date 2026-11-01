// site_defaults.js — THE TWO LAYERS: THE SITE'S DEFAULT AND A PERSON'S OWN (row 2.145 step 5, 2026-10-31).
//
// The one editor's proposal (docs/for_chat/proposals_dc_20261027.md, DC 2) ends with "the two layers": everything a
// person changes is THEIR OWN, on top of the SITE'S DEFAULT, and the editor says which is which and puts the site's back.
// Mike's go (row 2.145, DN 1): the site's defaults are kept IN THE REPO. So the site's default for a thing is what the
// code ships:
//   a module's setting   how the ready-made dashboard it came from starts it (dashboards.js prebuiltStartOf), else the
//                        module's own default (its manifest: `default`, or `defaultFrom` the other settings)
//   the site's words     the words in the code (the editor's Words section: a change is a draft in this browser)
// This file is the pure half: what the site default of a setting is, whether a value is changed from it, and the patch
// that puts it back. No DOM, no fetch; nothing here is imported unless the editor is.
//
// *** CHANGED MEANS DIFFERENT IN FORCE, NOT ONLY PRESENT. *** A setting somebody stepped away and back to the default
// is stored (present, starting_defaults.js `isChosen`) but is not shown as changed: what is in force is compared with
// what the site default would put in force (`fieldValue` both ways, so a `defaultFrom` setting is compared on its
// computed value, and "15" and 15 are the same choice). FOR: the inspector never says "changed" about a row that reads
// exactly like the site's. AGAINST: such a stored value does not follow a later change of the site's default; "Put back
// the site default" on the row is still offered only where it would change something, so it is not offered there.
//
// *** PUTTING BACK. *** A module's own default: the setting's key AND the key it used to live under
// (settings_fields.js `legacy`) are written null -- null reads as "not chosen" everywhere (`readWithLegacy`), so the
// panel follows the site's default from then on, including a later one. A ready-made dashboard's start: its starting
// value is written (it was written at the start the same way, dashboards.js `build`), and the old key null.
//
// NEVER SHOWN AS CHANGED, never put back from here: a read-only row (it is changed somewhere else), and a SECRET (a key,
// a pass phrase: its default is "none", so putting it back would delete somebody's key -- that has its own Remove).

import { fieldValue } from './settings_fields.js';

export const SITE_DEFAULT_WORDS = Object.freeze({
  changed: 'Changed from the site default',
  putBack: 'Put back the site default',
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const present = (values, key) => isObj(values) && Object.prototype.hasOwnProperty.call(values, key)
  && values[key] !== undefined && values[key] !== null;
const same = (a, b) => { try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); } catch { return a === b; } };

/** Whether a row takes part at all: not read-only, not a secret, and a real key. PURE. */
export function comparable(field) {
  return !!field && typeof field.key === 'string' && !!field.key && !field.readOnly && !field.secret;
}

/** `values` with this setting not chosen (its own key and its old key out), and the ready-made start's value in. PURE. */
function siteValues(field, values, start) {
  const base = isObj(values) ? { ...values } : {};
  delete base[field.key];
  if (field.legacy?.key) delete base[field.legacy.key];
  if (isObj(start) && present(start, field.key)) base[field.key] = start[field.key];
  return base;
}

/** The value the site's default puts in force for `field` (with the other settings as they are, for `defaultFrom`). PURE.
 *  `start`: the ready-made dashboard's starting settings for this panel (dashboards.js prebuiltStartOf().state), or null. */
export function siteDefaultValue(field, values = {}, start = null) {
  if (!field) return undefined;
  return fieldValue(field, siteValues(field, values, start));
}

/** Whether `field`'s value in force differs from the site's default. PURE. */
export function isChanged(field, values = {}, start = null) {
  if (!comparable(field)) return false;
  return !same(fieldValue(field, isObj(values) ? values : {}), siteDefaultValue(field, values, start));
}

/** The fields (of `fields`) changed from the site default. PURE. */
export function changedFields(fields, values = {}, start = null) {
  return (Array.isArray(fields) ? fields : []).filter((f) => isChanged(f, values, start));
}

/** The patch that puts `field` back to the site default (see the head of this file). PURE. */
export function putBackPatch(field, start = null) {
  if (!comparable(field)) return {};
  const patch = {};
  if (field.legacy?.key && field.legacy.key !== field.key) patch[field.legacy.key] = null;
  patch[field.key] = isObj(start) && present(start, field.key) ? start[field.key] : null;
  return patch;
}

/** One patch putting back every changed one of `fields`. PURE. */
export function putBackAllPatch(fields, values = {}, start = null) {
  return changedFields(fields, values, start).reduce((p, f) => ({ ...p, ...putBackPatch(f, start) }), {});
}

/** The patch that undoes `patch` against the values as they were before it (a key that was not there goes back to
 *  null: "not chosen"). PURE. */
export function undoPatchFor(patch, before = {}) {
  const out = {};
  for (const k of Object.keys(isObj(patch) ? patch : {})) out[k] = isObj(before) && k in before && before[k] !== undefined ? before[k] : null;
  return out;
}
