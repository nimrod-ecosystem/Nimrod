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

import { createMediaSourcesClient, resolveItemUrl, sourceById } from './media_sources.js';

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
 * A GIF's FRAME DELAYS, in ms, read from its own bytes (row 2.184 stage 3; no library: the format's blocks are walked).
 * Null when it is not a GIF. A delay of 10 ms or less is counted as 100 ms, which is what Chromium plays it at.
 */
export function gifFrameDelays(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;      // "GIF"
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));                                     // the global colour table
  const delays = [];
  let pending = null;
  const skipSub = () => { while (p < b.length) { const n = b[p++]; if (n === 0) return; p += n; } };
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3B) break;                                                                 // the end
    if (t === 0x21) {                                                                      // an extension
      const label = b[p++];
      if (label === 0xF9 && b[p] === 4) pending = (b[p + 2] | (b[p + 3] << 8)) * 10;      // its delay, in 1/100 s
      skipSub();
      continue;
    }
    if (t === 0x2C) {                                                                      // a frame
      const packed = b[p + 8];
      p += 9;
      if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));                               // its own colour table
      p += 1;                                                                              // LZW minimum code size
      skipSub();
      const d = pending == null ? 0 : pending;
      delays.push(d <= 10 ? 100 : d);
      pending = null;
      continue;
    }
    break;                                                                                 // not a block we know: stop
  }
  return delays;
}

/** Could this GIF change faster than a flash limit allows? `periodMs`: flash_limit.js minFlashPeriodMs (0 = no limit). A
 *  GIF that is one frame never flashes; its quickest frame decides. Counting every frame change as a flash is stricter
 *  than WCAG (a flash is a PAIR of opposing changes, and only a bright or large enough one), on purpose: no module can
 *  measure brightness or area yet (flash_limit.js), so this errs to the still side. */
export function gifMayFlash(delays, periodMs) {
  if (!(periodMs > 0) || !Array.isArray(delays) || delays.length < 2) return false;
  return Math.min(...delays) < periodMs;
}

/** A GIF's first frame, drawn on a canvas; null for anything that is not a GIF, or where the browser cannot (row 2.184). */
export async function gifStill(url) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const blob = await (await fetch(url)).blob();
  if (!/gif/i.test(blob.type)) return null;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  try { bmp.close?.(); } catch { /* gone */ }
  return c;
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

  // *** A GIF, KEPT STILL (row 2.184 stage 3, 2026-11-02). *** When the owner says its pictures may not move (reduced
  // motion, a needs profile, a slow screen, "The pictures move: No"), an animated GIF is drawn as its FIRST frame:
  // `createImageBitmap` on the file gives the first frame reliably (drawing an <img> would give whichever frame is
  // current). Anything that fails falls back to the image itself, as before. Not for SVG: a person's own animated SVG
  // cannot be paused here, and is shown as it is.
  const stillOf = gifStill;

  // `still`: the owner's pictures may not move. `flashPeriodMs`: the screen's flash limit as a shortest period
  // (flash_limit.js minFlashPeriodMs; 0 = none) - a GIF that changes faster than it is shown still, on THIS screen, when it
  // is drawn (a screen set up later, or another screen, judges it by its own limit). Unreadable with a limit set: still.
  async function load(cardEl, ref, { alt = '', still = false, flashPeriodMs = 0 } = {}) {
    try {
      if (!ref || !ref.sourceId || !ref.path) return false;
      if (!sourcesP) {
        const client = sources
          || createMediaSourcesClient({ user, cache: true, personId: personId || null });
        sourcesP = client.list();
      }
      const list = (await sourcesP) || [];
      // `sourceById`, not a bare find: a picture added from this device (`device_pictures.js`)
      // has a source that is deliberately not in the registry's list.
      const src = sourceById(list, ref.sourceId);
      if (!src) return false;                 // the folder is not connected on this device
      const got = await resolveItemUrl(src, ref.path);
      if (!got || !alive() || !cardEl.isConnected) { got?.release?.(); return false; }
      const frame = cardEl.querySelector('[data-img]');
      if (!frame) { got.release(); return false; }
      releases.push(got.release);
      const isGif = /\.gif$/i.test(String(ref.path));
      let keepStill = still && isGif;
      if (!keepStill && isGif && flashPeriodMs > 0) {
        try { keepStill = gifMayFlash(gifFrameDelays(new Uint8Array(await (await fetch(got.url)).arrayBuffer())), flashPeriodMs); }
        catch { keepStill = true; }
      }
      if (keepStill) {
        let c = null;
        try { c = await stillOf(got.url); } catch (err) { console.warn('card: no still frame for a GIF', err); c = null; }
        if (c && alive() && cardEl.isConnected) {
          c.className = 'ab-still';
          c.dataset.still = '';
          c.setAttribute('role', 'img');
          if (alt) c.setAttribute('aria-label', alt); else c.setAttribute('aria-hidden', 'true');
          frame.append(c);
          return true;
        }
      }
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
