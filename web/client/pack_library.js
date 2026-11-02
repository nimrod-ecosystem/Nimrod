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
  { id: 'maths_basic', kind: 'trivia', label: 'Math — basic arithmetic',
    url: '/packs/maths_basic.json' },
  { id: 'vocab_starter', kind: 'words', label: 'Vocabulary — starter set',
    url: '/packs/vocab_starter.json' },
  { id: 'lesson_starter', kind: 'lesson', label: 'Lessons — starter topics',
    url: '/packs/lesson_starter.json' },
  // Built for the CPL sample site (its pages removed 2026-10-13) as a worked example of "make your own pack" —
  // real, shippable content (MIT-clean per docs/PACK_SCHEMA.md's packs/ vs packs_local/ split),
  // not decoration limited to that one page.
  { id: 'cma_art_trivia', kind: 'trivia', label: 'Cleveland Museum of Art — who painted it?',
    url: '/packs/cma_art_trivia.json' },
  { id: 'literary_quotes_trivia', kind: 'trivia', label: 'Who wrote it? — famous opening lines',
    url: '/packs/literary_quotes_trivia.json' },
  { id: 'cleveland_library_facts', kind: 'trivia', label: 'Cleveland Public Library — history facts',
    url: '/packs/cleveland_library_facts.json' },
  // General trivia, eleven topics at three levels (2026-11-02, row 2.175): 1,448 questions written from cited pages, every
  // item naming its own, then checked by a second model pass. Of the 36 it flagged, 31 were corrected and four left out
  // (their answer is itself disputed); one stands as written. One more is left out because its answer is a word this
  // repo's name check refuses (and the film award is called the Academy Award throughout for the same reason; the
  // installer, in the private repo, does both). "Every question pack", Trivia's default, deals from all of
  // these, a pack first and then a question in it, so the 300 sums above no longer crowd out everything else.
  { id: 'trivia_art_easy', kind: 'trivia', label: 'Art trivia (easy)', url: '/packs/trivia_art_easy.json' },
  { id: 'trivia_art_medium', kind: 'trivia', label: 'Art trivia (medium)', url: '/packs/trivia_art_medium.json' },
  { id: 'trivia_art_hard', kind: 'trivia', label: 'Art trivia (hard)', url: '/packs/trivia_art_hard.json' },
  { id: 'trivia_film-and-tv_easy', kind: 'trivia', label: 'Film and TV trivia (easy)', url: '/packs/trivia_film-and-tv_easy.json' },
  { id: 'trivia_film-and-tv_medium', kind: 'trivia', label: 'Film and TV trivia (medium)', url: '/packs/trivia_film-and-tv_medium.json' },
  { id: 'trivia_film-and-tv_hard', kind: 'trivia', label: 'Film and TV trivia (hard)', url: '/packs/trivia_film-and-tv_hard.json' },
  { id: 'trivia_food_easy', kind: 'trivia', label: 'Food trivia (easy)', url: '/packs/trivia_food_easy.json' },
  { id: 'trivia_food_medium', kind: 'trivia', label: 'Food trivia (medium)', url: '/packs/trivia_food_medium.json' },
  { id: 'trivia_food_hard', kind: 'trivia', label: 'Food trivia (hard)', url: '/packs/trivia_food_hard.json' },
  { id: 'trivia_general_easy', kind: 'trivia', label: 'General trivia (easy)', url: '/packs/trivia_general_easy.json' },
  { id: 'trivia_general_medium', kind: 'trivia', label: 'General trivia (medium)', url: '/packs/trivia_general_medium.json' },
  { id: 'trivia_general_hard', kind: 'trivia', label: 'General trivia (hard)', url: '/packs/trivia_general_hard.json' },
  { id: 'trivia_geography_easy', kind: 'trivia', label: 'Geography trivia (easy)', url: '/packs/trivia_geography_easy.json' },
  { id: 'trivia_geography_medium', kind: 'trivia', label: 'Geography trivia (medium)', url: '/packs/trivia_geography_medium.json' },
  { id: 'trivia_geography_hard', kind: 'trivia', label: 'Geography trivia (hard)', url: '/packs/trivia_geography_hard.json' },
  { id: 'trivia_history_easy', kind: 'trivia', label: 'History trivia (easy)', url: '/packs/trivia_history_easy.json' },
  { id: 'trivia_history_medium', kind: 'trivia', label: 'History trivia (medium)', url: '/packs/trivia_history_medium.json' },
  { id: 'trivia_history_hard', kind: 'trivia', label: 'History trivia (hard)', url: '/packs/trivia_history_hard.json' },
  { id: 'trivia_music_easy', kind: 'trivia', label: 'Music trivia (easy)', url: '/packs/trivia_music_easy.json' },
  { id: 'trivia_music_medium', kind: 'trivia', label: 'Music trivia (medium)', url: '/packs/trivia_music_medium.json' },
  { id: 'trivia_music_hard', kind: 'trivia', label: 'Music trivia (hard)', url: '/packs/trivia_music_hard.json' },
  { id: 'trivia_nature_easy', kind: 'trivia', label: 'Nature trivia (easy)', url: '/packs/trivia_nature_easy.json' },
  { id: 'trivia_nature_medium', kind: 'trivia', label: 'Nature trivia (medium)', url: '/packs/trivia_nature_medium.json' },
  { id: 'trivia_nature_hard', kind: 'trivia', label: 'Nature trivia (hard)', url: '/packs/trivia_nature_hard.json' },
  { id: 'trivia_science_easy', kind: 'trivia', label: 'Science trivia (easy)', url: '/packs/trivia_science_easy.json' },
  { id: 'trivia_science_medium', kind: 'trivia', label: 'Science trivia (medium)', url: '/packs/trivia_science_medium.json' },
  { id: 'trivia_science_hard', kind: 'trivia', label: 'Science trivia (hard)', url: '/packs/trivia_science_hard.json' },
  { id: 'trivia_sports_easy', kind: 'trivia', label: 'Sports trivia (easy)', url: '/packs/trivia_sports_easy.json' },
  { id: 'trivia_sports_medium', kind: 'trivia', label: 'Sports trivia (medium)', url: '/packs/trivia_sports_medium.json' },
  { id: 'trivia_sports_hard', kind: 'trivia', label: 'Sports trivia (hard)', url: '/packs/trivia_sports_hard.json' },
  { id: 'trivia_words_easy', kind: 'trivia', label: 'Words trivia (easy)', url: '/packs/trivia_words_easy.json' },
  { id: 'trivia_words_medium', kind: 'trivia', label: 'Words trivia (medium)', url: '/packs/trivia_words_medium.json' },
  { id: 'trivia_words_hard', kind: 'trivia', label: 'Words trivia (hard)', url: '/packs/trivia_words_hard.json' },
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
