// card_face.js — THE FACE OF A CARD: a picture (or a symbol) and a word. Shared, not copied.
//
// Factored out of `modules/board.js` on 2026-09-28 for `modules/button.js` (change list row 2.26,
// Mike: *"They could both be AAC buttons or really just buttons. AAC should have all the
// framework somewhere."*). The board's card already carried a word and an optional `image`; the
// name sign and the profile picture are that same card with a different look around it. So the
// part that is genuinely the same moved here, and each module keeps its own look:
//
//   * `cardFaceHTML` — the markup INSIDE a card: the picture slot or the symbol, then the word.
//     Byte-for-byte what `board.js` wrote inline before, so the board's own suite is the proof
//     nothing about the board moved.
//   * `createCardImages` — the picture loader, with the two rules the board learned the hard way
//     kept in ONE place instead of two:
//
//       1. THE PICTURE IS OPTIONAL AND ARRIVES LATE; THE WORD IS NEITHER. The word renders at once
//          with an empty frame, and the frame fills when the file has been read. Nothing waits on
//          the file.
//       2. EACH PICTURE TAKES A URL IT OWNS (`resolveItemUrl`), never one off a shared listing: a
//          folder listing revokes the previous listing's URLs, so a card reusing one goes blank
//          the moment a photo panel refreshes the same folder. The owner releases it.
//
// WHAT IS NOT HERE: any styling, any colour, any behaviour on press. A board card, a name sign and
// a framed picture look and act differently; only the face is shared. The class names on the
// spans (`ab-img`, `ab-sym`, `ab-word`) are kept so the board's stylesheet is untouched; a module
// that reuses the face styles them under its own root.

import { createMediaSourcesClient, resolveItemUrl } from './media_sources.js';

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The inside of a card. `symbol` is ready-made SVG markup (or ''), `image` is truthy when the card
 * has a picture — its frame is drawn empty and filled later by `createCardImages().load`. A picture
 * wins over a symbol, as it always has on the board.
 */
export function cardFaceHTML({ word = '', symbol = '', image = false } = {}) {
  return (image ? '<span class="ab-img" data-img></span>'
    : symbol ? `<span class="ab-sym">${symbol}</span>` : '')
    + `<span class="ab-word">${escapeHtml(word)}</span>`;
}

/**
 * A picture loader for one mounted module. `ref` is `{ sourceId, path }` — a reference into the
 * person's own media sources; nothing is uploaded, and nothing here could upload anything.
 *
 *   sources   a client with `list()` (the kiosk's injected one, or the real registry)
 *   user, personId   used only when no client is given, to build the real registry client
 *   alive()   false once the owning module is torn down, so a late file is released, not shown
 *   alt       the image's alt text; '' when a word beside it already names it (the board)
 */
export function createCardImages({ sources = null, user = null, personId = null,
                                   alive = () => true } = {}) {
  let sourcesP = null;                        // listed once per mount, not once per card
  let releases = [];

  function releaseAll() {
    for (const r of releases) { try { r(); } catch { /* already gone */ } }
    releases = [];
  }

  async function load(cardEl, ref, { alt = '' } = {}) {
    try {
      if (!ref || !ref.sourceId || !ref.path) return false;
      if (!sourcesP) {
        const client = sources
          || createMediaSourcesClient({ user, cache: true, personId: personId || null });
        sourcesP = client.list();
      }
      const list = (await sourcesP) || [];
      const src = list.find((x) => x.id === ref.sourceId);
      if (!src) return false;                 // the folder is not connected on this device
      const got = await resolveItemUrl(src, ref.path);
      if (!got || !alive() || !cardEl.isConnected) { got?.release?.(); return false; }
      const frame = cardEl.querySelector('[data-img]');
      if (!frame) { got.release(); return false; }
      releases.push(got.release);
      const img = document.createElement('img');
      img.alt = alt;
      img.src = got.url;
      frame.append(img);
      return true;
    } catch (err) {
      // Silent on the CARD, loud in the console. A red error over somebody's word is worse than a
      // missing picture, and the word is still there.
      console.warn('card: could not load a picture', err);
      return false;
    }
  }

  return {
    load,
    releaseAll,
    // A caller that has already listed the sources hands the list over, so a picture never
    // costs a second listing.
    useSources(list) { sourcesP = Promise.resolve(Array.isArray(list) ? list : []); },
  };
}
