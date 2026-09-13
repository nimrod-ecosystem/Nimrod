// user_packs.js — packs a VISITOR loaded themselves, the way Photos takes a picked folder.
//
// Stored entirely in THIS browser (localStorage), never sent anywhere: a pack a teacher, a
// parent, or a caregiver built with an AI of their choice, from a file on their own machine,
// following docs/PACK_SCHEMA.md's shape. `packs.js` validates every one before it is kept —
// this file never re-implements that check, it only stores what already passed it.
//
// STORED AS A `data:` URL, not a second copy of the parsed object. `pack_library.js`'s
// existing `packById()` → `loadPack(entry.url)` path already knows how to fetch a pack by
// URL; `fetch()` resolves a `data:` URL exactly the way it resolves an `http:` one, so every
// existing caller (Trivia, Word Forge) needs zero changes to also accept a pack that came
// from a visitor's disk rather than the network. One code path, not two.
//
// A NEW PACK APPEARS ON THE NEXT PAGE LOAD, NOT LIVE. Same rule `kiosk.html` already uses
// after a Photos folder is picked ("reloading after a folder is picked is blunt, and it is
// the honest move") — the module that lists available packs computes its list once, at
// import time, and re-running that computation mid-session would be a second boot path this
// codebase has already decided not to want. The loader UI says so; it does not pretend a
// reload can be avoided.

const STORE_KEY = 'nimrod:userpacks:v1';

function readAll() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];               // private mode / disabled storage / corrupt JSON
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // Private mode or quota. The pack is still usable for the rest of THIS session (the
    // caller already has the validated object) — it just will not survive a reload, which
    // the caller's UI should say plainly rather than silently losing it.
  }
}

export function listUserPacks() {
  return readAll();
}

/**
 * Save a pack that has ALREADY been validated by the caller (`packs.js`'s `parsePack`).
 * `text` is the exact file contents, kept verbatim in the `data:` URL — re-encoding the
 * parsed object instead would silently reformat whatever whitespace or key order somebody's
 * AI produced, for no benefit anything here needs.
 */
export function addUserPack(pack, text) {
  const id = `user:${pack.kind}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const entry = {
    id,
    kind: pack.kind,
    label: `${pack.name} (yours)`,
    url: `data:application/json,${encodeURIComponent(text)}`,
  };
  writeAll([...readAll(), entry]);
  return entry;
}

export function removeUserPack(id) {
  writeAll(readAll().filter((p) => p.id !== id));
}
