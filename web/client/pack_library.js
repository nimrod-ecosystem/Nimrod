// pack_library.js — WHICH BUILT-IN PACKS EXIST, so a module's settings menu has something to
// list without a server-side catalog endpoint or an upload UI (neither exists yet).
//
// Deliberately a flat, hand-maintained array rather than a directory listing: `packs.js`
// validates a pack once it is loaded, but nothing scans `web/client/packs/` at runtime to
// discover what is there, and a static site has no server-side listing to ask. Adding a pack
// means adding one row here. When there are enough of these that a static row is genuinely the
// wrong shape — real upload, a per-account library — that is its own decision, not a reason to
// guess at one now for a codebase that ships exactly one pack.
//
// `id` is what a module's settings actually store (`packId`), so it must never change once
// shipped — a saved setting pointing at a renamed id silently falls back to nothing.

export const PACK_LIBRARY = [
  // Root-relative, not `packs/...` — this is imported by modules mounted from pages at
  // different depths (kiosk.html, modules.html, a future page), and a relative URL resolves
  // against whichever one happened to load it.
  { id: 'maths_basic', kind: 'trivia', label: 'Maths — basic arithmetic',
    url: '/packs/maths_basic.json' },
];

export const packsFor = (kind) => PACK_LIBRARY.filter((p) => p.kind === kind);

export const packById = (id) => PACK_LIBRARY.find((p) => p.id === id) || null;
