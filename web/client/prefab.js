// prefab.js — TYPE -> PREFAB -> INSTANCE, the third layer the new core adds.
//
// H1's own correction (`MIKE_CHANGE_LIST.md`, 2026-09-05) is the reason this is three layers
// and not two:
//
//   Mike: *"I think this conflicts with how we'll be working. There is a prefab of the module
//   with headless defaulting to off and then an instance of that prefab could be switched to
//   headless."*
//
// A TYPE is code — `module.js`'s registry, a manifest plus a factory. A PREFAB is a named,
// reusable set of overrides on top of a type's own defaults — "the audio player, configured
// this way." An INSTANCE is one placed, running thing: a prefab plus whatever THIS ONE occasion
// overrides further. Three layers because collapsing prefab into type (as an earlier version of
// this file's own design tried) makes "a default that can still be switched" impossible to
// express — you'd need to either bake the default into every type, or push it all the way down
// to every instance, and lose the "one prefab, many instances, change it once" idea the whole
// concept exists for.
//
// ---------------------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO, ON PURPOSE
// ---------------------------------------------------------------------------------------
//
// `NEW_CORE_SPEC.md` §2 also describes a FINGERPRINT — a structural hash that gives a prefab a
// stable identity across saves, so two people's independently-authored "clock, blue, top-right"
// prefabs can be recognized as the same shape. That depends on an open, unratified question
// (`identity_review_20260909.md` §3.5.5's proposed structural/configurable split — "role/order/
// links/repeat-over are structural, else configurable" — was never put to Mike): WHICH fields on
// an override set actually decide a prefab's identity versus just its current configuration.
// Building the fingerprint mechanism now would mean answering that question by omission — by
// however this file happened to implement it — rather than by Mike's own sign-off, which is
// exactly the trap CLAUDE.md's design-absolutes section exists to catch. So THIS file only does
// the override-resolution mechanics, which are useful and testable with no dependency on that
// question at all; identity/fingerprinting is left for whoever answers it.
//
// This also means prefabs here are addressed by a caller-given `id` (a name, an author's own
// choice), not a derived fingerprint — the same "declared, not inferred" discipline
// `modules_catalog.js`'s `reconcile()`/`coreReport()` already use elsewhere in this rebuild.

const prefabs = new Map(); // id -> { id, type, label, overrides, refs }

/**
 * Define a prefab: a type, a set of overrides on top of that type's own defaults, and a label
 * for whoever is picking one. `overrides` is copied, not referenced, so a caller mutating the
 * object they passed in cannot silently change an already-defined prefab out from under it.
 */
export function definePrefab({ id, type, overrides = {}, label = '' } = {}) {
  if (!id) throw new Error('definePrefab: id is required');
  if (!type) throw new Error('definePrefab: type is required');
  if (prefabs.has(id)) throw new Error(`definePrefab: "${id}" is already defined`);
  const prefab = { id, type, label, overrides: { ...overrides }, refs: 0 };
  prefabs.set(id, prefab);
  return prefab;
}

export function getPrefab(id) { return prefabs.get(id) || null; }

/** Every prefab, optionally narrowed to one type — for a picker that only wants to offer
 *  prefabs of the kind it can actually place. */
export function listPrefabs(type = null) {
  const all = [...prefabs.values()];
  return type ? all.filter((p) => p.type === type) : all;
}

// ---------------------------------------------------------------------------------------
// REFCOUNTING — "a separately-identified, shareable, refcounted value" (RESEARCH_NOTES.md,
// "Queue 8"). Tracked here as a courtesy so a UI can say "used by 3 instances" and warn before
// deleting one out from under them; NOT enforced as a deletion lock. Whether removing an
// in-use prefab should be blocked, orphan its instances, or fall back silently is a real product
// decision for whoever builds that UI, not a policy this data layer should assume on its behalf.
// ---------------------------------------------------------------------------------------

export function retainPrefab(id) {
  const p = prefabs.get(id);
  if (!p) throw new Error(`retainPrefab: no such prefab "${id}"`);
  p.refs += 1;
  return p.refs;
}

/** Never goes below zero — an unbalanced release is a caller bug, not a reason to hand back a
 *  negative count that would make "still in use" checks lie. */
export function releasePrefab(id) {
  const p = prefabs.get(id);
  if (!p) throw new Error(`releasePrefab: no such prefab "${id}"`);
  p.refs = Math.max(0, p.refs - 1);
  return p.refs;
}

export function removePrefab(id) {
  const p = prefabs.get(id);
  if (!p) return false;
  prefabs.delete(id);
  return true;
}

// ---------------------------------------------------------------------------------------
// RESOLUTION — the mechanical part, no identity question attached.
// ---------------------------------------------------------------------------------------

/** What a prefab alone gives an instance: a type's own defaults, with the prefab's overrides
 *  applied on top. `prefab: null` is legal — an instance may sit directly on a type with no
 *  prefab in between — and resolves to the type defaults unchanged. */
export function resolvePrefab(typeDefaults = {}, prefab = null) {
  return { ...typeDefaults, ...(prefab ? prefab.overrides : {}) };
}

/**
 * The final, live value for one instance: type defaults, then the prefab's overrides, then
 * this instance's own overrides — each layer able to override anything the one before it set,
 * in that order. This is the whole point of three layers: an instance changing ONE field does
 * not have to restate everything the prefab already decided.
 */
export function resolveInstance(typeDefaults = {}, prefab = null, instanceOverrides = {}) {
  return { ...resolvePrefab(typeDefaults, prefab), ...instanceOverrides };
}

/**
 * *** "DIFFED AGAINST THE RESOLVED ANCESTOR CHAIN, NOT FACTORY DEFAULTS" (RESEARCH_NOTES.md,
 * "Queue 8", Agreement 1-2) — THE WHOLE REASON THIS FUNCTION EXISTS RATHER THAN A PLAIN OBJECT
 * COMPARE. ***
 *
 * Given a fully-resolved DESIRED value (what somebody just set an instance to, in a UI that
 * shows every field whether it was overridden or not), returns only the fields that actually
 * differ from what the prefab ALREADY gives — the minimal instance override worth persisting.
 *
 * This matters precisely when a prefab has already moved a field away from the type's own
 * default: if the prefab already sets `headless: true` and someone editing one instance leaves
 * it at `true`, the diff must come back EMPTY for that field. Diffing against the type's raw
 * defaults instead would wrongly record `headless: true` as this instance's own override —
 * correct today, but wrong the moment somebody edits the PREFAB back to `headless: false`,
 * because every instance that "agreed" with the old prefab value would now incorrectly pin the
 * old one forever, permanently drowning out the very default the prefab exists to carry.
 */
export function diffFromPrefab(typeDefaults = {}, prefab = null, desired = {}) {
  const base = resolvePrefab(typeDefaults, prefab);
  const diff = {};
  for (const [k, v] of Object.entries(desired)) {
    if (!Object.is(base[k], v)) diff[k] = v;
  }
  return diff;
}
