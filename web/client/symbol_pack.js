/* symbolPack.js: big idea 1, bring the symbols a person already uses (Mike, 2026-11-02: "We're trying to make it
 * so people can bring in whatever they want or are already using as much as possible"). Decision log, 2026-09-01:
 * Nimrod draws its own set, and anyone may upload their own.
 *
 * A SYMBOL PACK is a folder or zip of pictures plus one small JSON file, shaped like Code's other packs
 * (nimrod.pack.v1: a `source` and a licence on everything; share-alike or unclear sets stay in packs_local/).
 *
 *   {
 *     "format": "nimrod.symbols.v1",
 *     "name": "Mulberry",                     what the person sees in the symbol-set menu
 *     "source": "https://mulberrysymbols.org", where it came from
 *     "licence": "CC BY-SA", "credit": "Mulberry Symbols, Steve Lee",
 *     "files": "EN/",                          the folder of pictures inside the pack (svg, png, webp, jpg)
 *     "naming": { "separator": "_", "verbMarker": ",_to", "variant": "_2" },   how its file names spell words
 *     "words": { "all_done": "finished" },      overrides: board word -> file stem, where names differ
 *     "style": { "tint": false, "plate": "auto", "padding": 6 }
 *   }
 *
 *   resolveSymbol(word, pack, fileList) → { file, how } | null   which picture a board word uses, and why
 *   plateFor(cardColour, pictureColours, style) → null | '#hex'   a light plate behind the picture, when needed
 *   PACK_DEFAULTS                                                  the style settings and their starting values
 *
 * Matching, in order: the pack's own `words` override; the exact file name; the name tidied (case, spaces and
 * the separator); the verb form ("drink_,_to"); the first numbered variant ("drink_2"). If nothing matches, the
 * board keeps Nimrod's own symbol for that word, so a card is never blank, and the editor marks it so the person
 * can pick one. A person can also set any single word to their own picture (a photo of their own cup).
 */
export const PACK_DEFAULTS = {
  /* recolour a one-colour line set to the board's word colours. Off: a pack keeps its own colours */
  tint: false,
  /* 'auto': a light plate behind a picture whose colours fall under 3:1 on the card (dark boards); 'always'; 'never' */
  plate: 'auto',
  plateColour: '#fbf8ee',
  /* space around the picture inside its box, in the 100-unit symbol box */
  padding: 6,
  /* below this contrast with the card, 'auto' adds the plate (graphics need 3:1) */
  minContrast: 3,
};

const tidy = (s) => String(s).toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/i, '').replace(/[\s_\-]+/g, ' ').trim();

export function resolveSymbol(word, pack = {}, fileList = []) {
  const n = pack.naming || {}, sep = n.separator || '_';
  const stems = new Map(fileList.map((f) => [f.replace(/^.*\//, '').replace(/\.(svg|png|webp|jpe?g)$/i, ''), f]));
  const tidyMap = new Map([...stems].map(([k, v]) => [tidy(k), v]));
  const w = String(word);
  const tries = [
    ['override', pack.words && pack.words[w]],
    ['exact', w],
    ['tidied', tidy(w)],
    ['verb', n.verbMarker ? w + n.verbMarker : null],
    ['variant', n.variant ? w + n.variant : null],
    ['spaced', w.split(/_/).join(sep)],
  ];
  for (const [how, stem] of tries) {
    if (!stem) continue;
    if (stems.has(stem)) return { file: stems.get(stem), how };
    if (tidyMap.has(tidy(stem))) return { file: tidyMap.get(tidy(stem)), how };
  }
  return null;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05); };

/* pictureColours: the colours the picture draws with (from its SVG, or a PNG's main colours). The plate goes in
   when the darkest-reading colour against the card is below minContrast. */
export function plateFor(cardColour, pictureColours = [], style = {}) {
  const s = { ...PACK_DEFAULTS, ...style };
  if (s.plate === 'never') return null;
  if (s.plate === 'always') return s.plateColour;
  const hex = pictureColours.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (!hex.length) return null;
  const best = Math.max(...hex.map((c) => contrast(c, cardColour)));
  return best < s.minContrast ? s.plateColour : null;
}
