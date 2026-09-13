// pack_library.js — WHICH PACKS EXIST: the built-in list below, plus whatever a visitor has
// loaded themselves (`user_packs.js`) — so a module's settings menu has something to list
// without a server-side catalog endpoint.
//
// `PACK_LIBRARY` itself is deliberately a flat, hand-maintained array rather than a directory
// listing: `packs.js` validates a pack once it is loaded, but nothing scans `web/client/packs/`
// at runtime to discover what is there, and a static site has no server-side listing to ask.
// Adding a BUILT-IN pack means adding one row here. `packsFor`/`packById` are where the two
// sources meet — every caller already goes through these two functions rather than reading
// `PACK_LIBRARY` directly (checked: nothing does), which is what let user packs join the list
// here, once, instead of every consumer needing to know a second source exists.
//
// `id` is what a module's settings actually store (`packId`), so a BUILT-IN id must never
// change once shipped — a saved setting pointing at a renamed id silently falls back to
// nothing. A user pack's id is generated once in `user_packs.js` and never renamed either.

import { listUserPacks } from './user_packs.js';

export const PACK_LIBRARY = [
  // Root-relative, not `packs/...` — this is imported by modules mounted from pages at
  // different depths (kiosk.html, modules.html, a future page), and a relative URL resolves
  // against whichever one happened to load it.
  { id: 'maths_basic', kind: 'trivia', label: 'Maths — basic arithmetic',
    url: '/packs/maths_basic.json' },
  { id: 'vocab_starter', kind: 'words', label: 'Vocabulary — starter set',
    url: '/packs/vocab_starter.json' },
  // Built for the CPL sample site (/learn/) as a worked example of "make your own pack" —
  // real, shippable content (MIT-clean per docs/PACK_SCHEMA.md's packs/ vs packs_local/ split),
  // not decoration limited to that one page.
  { id: 'cma_art_trivia', kind: 'trivia', label: 'Cleveland Museum of Art — who painted it?',
    url: '/packs/cma_art_trivia.json' },
  { id: 'literary_quotes_trivia', kind: 'trivia', label: 'Who wrote it? — famous opening lines',
    url: '/packs/literary_quotes_trivia.json' },
  { id: 'cleveland_library_facts', kind: 'trivia', label: 'Cleveland Public Library — history facts',
    url: '/packs/cleveland_library_facts.json' },
];

// `listUserPacks()` reads localStorage fresh on every call — cheap, small, and it means a
// pack loaded THIS session (see `pack_loader.js`) is already visible to anything that asks
// again, with no cache to invalidate. A module's own settings list is still computed once at
// import time (see `trivia.js`/`wordforge.js`), so a pack added mid-session needs the reload
// the loader UI already tells you to do — this is what makes that reload actually work.
export const packsFor = (kind) =>
  [...PACK_LIBRARY, ...listUserPacks()].filter((p) => p.kind === kind);

export const packById = (id) =>
  [...PACK_LIBRARY, ...listUserPacks()].find((p) => p.id === id) || null;
