// avatar.js — A PERSON'S AVATAR AS DATA: a small record in, an SVG drawing out.
//
// Row 2.37 item 5 (private repo, docs/for_chat/MIKE_CHANGE_LIST.md), Mike 2026-09-30: *"animated
// versions of people as their avatars"*, and the addition the same day: avatars are OPTIONAL, with a
// quick generic creator *"Kind of like Miis on Nintendo"* next to the make-your-own prompts.
//
// WHY A RECORD AND NOT A PICTURE. A drawn avatar is a dozen short ids (face shape, skin, hair, ...), so
// it is tiny to keep on the person, it redraws at any size, and a later drawing (Design's parts, when
// they exist) can redraw every saved avatar without anybody making theirs again. A record never holds
// markup: every value is an id from a list below or a checked `#rrggbb`, so nothing typed or stored can
// put anything into the SVG but a colour.
//
// *** THE PARTS ARE PLACEHOLDERS, DRAWN BY CODE. *** Design's room-add-ons hand-off (§3, "Avatars from
// descriptions") names the parts — body, hair, facial hair, glasses, earrings, top and colour,
// expression — and says "the art isn't drawn yet". So these are simple flat shapes in a 200x200 box,
// friendly and plain, made to be replaced: the record's ids are the contract, the paths are not.
//
// COLOURS ARE DATA, NOT DECISIONS SCATTERED THROUGH DRAWING CODE. Every literal colour in this file is
// in one of the palettes below, and the suite checks that (`avatar_test.html`, "no colour outside a
// declared palette"). A record may also carry ANY `#rrggbb` for its skin, hair, top or background —
// Mike's rule is to offer every colour — and `avatarWarnings` says when two of them are close, never
// refusing one.
//
// THE MOVEMENT is CSS inside the SVG: a blink and a slow breath, on the cadence of Design's own cat
// (`motion.css`: a blink every 9 s, a breath over 4.4 s), so the guide and the people move alike. It is
// inside `prefers-reduced-motion: no-preference`, and `animate: false` leaves it out entirely. No timer
// runs anywhere, so there is nothing to stop when a drawing is thrown away.

import { mulberry32 } from './rng.js';
import { DEFAULT_PALETTE, normalizeHex, contrast } from './color_picker.js';

export const AVATAR_VERSION = 1;
export const VIEWBOX = 200;

const freeze = (list) => Object.freeze(list.map((x) => Object.freeze({ ...x })));

// ---------------------------------------------------------------------------------------
// THE PALETTES. *** DEFAULTS, NOT RULES (Rule 1). *** Each is a starting list; a record can hold any
// colour instead, and the creator offers a free colour choice beside every list.
// ---------------------------------------------------------------------------------------

// SKIN: twelve tones from very light to very deep, named by lightness only — no food, no places, no
// peoples. `feature` is the ink for brows-free lines on that skin (the nose, a mouth line, dot eyes,
// glasses): dark on the lighter eight, light on the deeper four, each measured at 3:1 or better
// against its skin (WCAG's floor for graphics; checked by the suite, not trusted).
export const SKIN = freeze([
  { id: 's1',  name: 'Very light',    hex: '#fbe4d6', feature: '#3b2219' },
  { id: 's2',  name: 'Light',         hex: '#f3cfb5', feature: '#3b2219' },
  { id: 's3',  name: 'Light warm',    hex: '#eab991', feature: '#3b2219' },
  { id: 's4',  name: 'Light medium',  hex: '#dba27a', feature: '#3b2219' },
  { id: 's5',  name: 'Medium',        hex: '#c98d63', feature: '#3b2219' },
  { id: 's6',  name: 'Medium warm',   hex: '#b5774c', feature: '#3b2219' },
  { id: 's7',  name: 'Medium olive',  hex: '#b99a6b', feature: '#3b2219' },
  { id: 's8',  name: 'Medium deep',   hex: '#9c6641', feature: '#f4d9c8' },
  { id: 's9',  name: 'Deep',          hex: '#7f5034', feature: '#f4d9c8' },
  { id: 's10', name: 'Deep warm',     hex: '#673f28', feature: '#f4d9c8' },
  { id: 's11', name: 'Very deep',     hex: '#4d2e1e', feature: '#f4d9c8' },
  { id: 's12', name: 'Deepest',       hex: '#3a2215', feature: '#f4d9c8' },
]);

// The two inks a feature can be drawn in, for a skin colour that is not on the list: whichever reads
// better on it (the same measured choice note.js makes for its paper).
export const FEATURE_INKS = freeze([
  { id: 'dark',  name: 'Dark',  hex: '#3b2219' },
  { id: 'light', name: 'Light', hex: '#f4d9c8' },
]);

// HAIR: the natural range, then greys and white, then dyed colours, because dyed hair is ordinary.
export const HAIR_COLORS = freeze([
  { id: 'black',      name: 'Black',             hex: '#1c1714' },
  { id: 'darkbrown',  name: 'Dark brown',        hex: '#3b2518' },
  { id: 'brown',      name: 'Brown',             hex: '#6a4228' },
  { id: 'lightbrown', name: 'Light brown',       hex: '#9a6b43' },
  { id: 'auburn',     name: 'Auburn',            hex: '#8e3b1f' },
  { id: 'ginger',     name: 'Ginger',            hex: '#c8612b' },
  { id: 'strawberry', name: 'Strawberry blonde', hex: '#d9955f' },
  { id: 'blonde',     name: 'Blonde',            hex: '#e3c16f' },
  { id: 'platinum',   name: 'Platinum',          hex: '#efe3bd' },
  { id: 'grey',       name: 'Grey',              hex: '#8f8a86' },
  { id: 'silver',     name: 'Silver',            hex: '#c9c6c2' },
  { id: 'white',      name: 'White',             hex: '#f4f1ec' },
  { id: 'dyedblue',   name: 'Blue',              hex: '#3f6fd1' },
  { id: 'dyedpink',   name: 'Pink',              hex: '#e0679b' },
  { id: 'dyedpurple', name: 'Purple',            hex: '#8a55c4' },
  { id: 'dyedgreen',  name: 'Green',             hex: '#3f9a6a' },
]);

// BACKGROUNDS: soft grounds first (an avatar sits on a wall, a card, a call screen), two deep ones,
// then every colour of the shared picker palette (`color_picker.js`, reused, not copied), then none.
export const SOFT_GROUNDS = freeze([
  { id: 'sky',   name: 'Sky',   hex: '#cfe6f5' },
  { id: 'mint',  name: 'Mint',  hex: '#d3eedf' },
  { id: 'peach', name: 'Peach', hex: '#fbe0cf' },
  { id: 'lilac', name: 'Lilac', hex: '#e4dcf3' },
  { id: 'sand',  name: 'Sand',  hex: '#efe6cf' },
  { id: 'rose',  name: 'Rose',  hex: '#f6d5dc' },
  { id: 'slate', name: 'Slate', hex: '#56677a' },
  { id: 'night', name: 'Night', hex: '#1f2a44' },
]);
export const NO_GROUND = Object.freeze({ id: 'none', name: 'None (see-through)', hex: null });
export const BACKGROUNDS = Object.freeze([...SOFT_GROUNDS, ...DEFAULT_PALETTE, NO_GROUND]);
// A top can be any of the same colours but "none".
export const TOPS = Object.freeze([...DEFAULT_PALETTE, ...SOFT_GROUNDS]);

// THE FIXED INKS: the outline (a dark and a light one; whichever stands out from the background is
// used, so a figure never vanishes into a dark ground), the whites of the eyes and teeth, the inside
// of a mouth, a tongue, and the gold of earrings and a flower's middle.
export const INKS = Object.freeze({
  outlineDark: '#2b2320',
  outlineLight: '#f7efe6',
  pupil: '#2b2320',
  white: '#ffffff',
  mouth: '#6b2226',
  tongue: '#e0787a',
  gold: '#d4a63a',
  lens: '#2b2320',
});

/** Every colour this file can draw by itself, for the suite's "no stray colour" check. */
export function declaredColors() {
  const all = [
    ...SKIN.flatMap((s) => [s.hex, s.feature]), ...FEATURE_INKS.map((c) => c.hex),
    ...HAIR_COLORS.map((c) => c.hex), ...BACKGROUNDS.map((c) => c.hex).filter(Boolean),
    ...TOPS.map((c) => c.hex), ...Object.values(INKS),
  ];
  return new Set(all.map((h) => normalizeHex(h)).filter(Boolean));
}

// ---------------------------------------------------------------------------------------
// THE SHAPES. `w` is the half-width of the head, `top`/`chin` its extent — the hair and the hats are
// fitted to them, so every hair goes on every face.
// ---------------------------------------------------------------------------------------
export const FACES = freeze([
  { id: 'round',  name: 'Round',  w: 48, top: 38, chin: 138 },
  { id: 'oval',   name: 'Oval',   w: 43, top: 34, chin: 142 },
  { id: 'square', name: 'Square', w: 47, top: 37, chin: 138 },
  { id: 'heart',  name: 'Heart',  w: 48, top: 35, chin: 141 },
  { id: 'long',   name: 'Long',   w: 40, top: 31, chin: 145 },
]);
export const HAIR_STYLES = freeze([
  { id: 'none',     name: 'None' },
  { id: 'buzz',     name: 'Very short' },
  { id: 'short',    name: 'Short' },
  { id: 'side',     name: 'Side sweep' },
  { id: 'curly',    name: 'Short curls' },
  { id: 'afro',     name: 'Afro' },
  { id: 'bob',      name: 'Bob' },
  { id: 'long',     name: 'Long' },
  { id: 'wavy',     name: 'Long and wavy' },
  { id: 'bun',      name: 'Bun' },
  { id: 'ponytail', name: 'Ponytail' },
  { id: 'braids',   name: 'Braids' },
  { id: 'locs',     name: 'Locs' },
  { id: 'mohawk',   name: 'Mohawk' },
  // A head covering in the top's colour. With hair styles rather than hats, because it replaces the
  // hair rather than sitting on it.
  { id: 'scarf',    name: 'Head scarf' },
]);
export const EYES = freeze([
  { id: 'round',  name: 'Round' },
  { id: 'dots',   name: 'Dots' },
  { id: 'happy',  name: 'Smiling' },
  { id: 'wide',   name: 'Wide' },
  { id: 'sleepy', name: 'Sleepy' },
  { id: 'lashes', name: 'With lashes' },
]);
export const BROWS = freeze([
  { id: 'soft',     name: 'Soft' },
  { id: 'straight', name: 'Straight' },
  { id: 'arched',   name: 'Arched' },
  { id: 'thick',    name: 'Thick' },
  { id: 'none',     name: 'None' },
]);
export const MOUTHS = freeze([
  { id: 'smile', name: 'Smile' },
  { id: 'grin',  name: 'Big smile' },
  { id: 'open',  name: 'Open' },
  { id: 'small', name: 'Small smile' },
  { id: 'smirk', name: 'Half smile' },
  { id: 'flat',  name: 'Straight' },
]);
export const GLASSES = freeze([
  { id: 'none',   name: 'None' },
  { id: 'round',  name: 'Round' },
  { id: 'square', name: 'Square' },
  { id: 'big',    name: 'Big' },
  { id: 'sun',    name: 'Sunglasses' },
]);
export const FACIAL_HAIR = freeze([
  { id: 'none',      name: 'None' },
  { id: 'stubble',   name: 'Stubble' },
  { id: 'mustache',  name: 'Moustache' },
  { id: 'goatee',    name: 'Goatee' },
  { id: 'beard',     name: 'Beard' },
  { id: 'chinstrap', name: 'Beard, no moustache' },
]);
// Hats and the rest are in the TOP's colour ("a matching outfit"), so the walk has one colour row
// fewer; earrings and a flower's middle are gold.
export const EXTRAS = freeze([
  { id: 'none',     name: 'None' },
  { id: 'beanie',   name: 'Woolly hat' },
  { id: 'cap',      name: 'Cap' },
  { id: 'headband', name: 'Headband' },
  { id: 'bow',      name: 'Bow' },
  { id: 'flower',   name: 'Flower' },
  { id: 'earrings', name: 'Earrings' },
]);

// THE PARTS, IN WALK ORDER: the face first, then the things that make someone recognisable (hair,
// glasses, a beard), then colours around them. `color: true` rows accept any `#rrggbb` as well.
export const PARTS = Object.freeze([
  { key: 'face',      label: 'Face shape',        options: FACES },
  { key: 'skin',      label: 'Skin',              options: SKIN, color: true },
  { key: 'hair',      label: 'Hair',              options: HAIR_STYLES },
  { key: 'hairColor', label: 'Hair colour',       options: HAIR_COLORS, color: true },
  { key: 'eyes',      label: 'Eyes',              options: EYES },
  { key: 'brows',     label: 'Eyebrows',          options: BROWS },
  { key: 'mouth',     label: 'Mouth',             options: MOUTHS },
  { key: 'glasses',   label: 'Glasses',           options: GLASSES },
  { key: 'facial',    label: 'Beard or moustache', options: FACIAL_HAIR },
  { key: 'extra',     label: 'Hat or extra',      options: EXTRAS },
  { key: 'top',       label: 'Top colour',        options: TOPS, color: true },
  { key: 'bg',        label: 'Background',        options: BACKGROUNDS, color: true },
].map((p) => Object.freeze(p)));
export const PART_KEYS = Object.freeze(PARTS.map((p) => p.key));

// THE STARTING RECORD, used to fill anything missing or unknown in a stored one. *** A GUESS, ON
// MIKE'S LIST. *** A new avatar in the creator does NOT start here — it starts from `surprise(<the
// person's id>)`, so no single skin tone or hair is "the default person". This record only repairs.
export const DEFAULT_RECORD = Object.freeze({
  v: AVATAR_VERSION, face: 'round', skin: 's5', hair: 'short', hairColor: 'brown', eyes: 'round',
  brows: 'soft', mouth: 'smile', glasses: 'none', facial: 'none', extra: 'none', top: 'blue', bg: 'sky',
});

// ---------------------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------------------

export const partOf = (key) => PARTS.find((p) => p.key === key) || null;

/** A stored or typed record, repaired: every key present, every value an id on its list or a hex. */
export function normalizeRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { v: AVATAR_VERSION };
  for (const p of PARTS) {
    const v = r[p.key];
    if (typeof v === 'string' && p.options.some((o) => o.id === v)) out[p.key] = v;
    else if (p.color && normalizeHex(v)) out[p.key] = normalizeHex(v);
    else out[p.key] = DEFAULT_RECORD[p.key];
  }
  return out;
}

/** The option a record holds for a part, or a made-up one for a free colour. */
export function optionFor(record, key) {
  const p = partOf(key);
  if (!p) return null;
  const v = normalizeRecord(record)[key];
  return p.options.find((o) => o.id === v) || { id: v, name: `Colour ${v}`, hex: v };
}

/** The hex a colour part resolves to, or null (a see-through background). */
export function colorOf(record, key) {
  const o = optionFor(record, key);
  return o ? (o.hex ? normalizeHex(o.hex) : null) : null;
}

/** The ink for features on a skin: the listed one, or the better of two for a free colour. */
export function featureInkFor(skinHex) {
  const listed = SKIN.find((s) => normalizeHex(s.hex) === normalizeHex(skinHex));
  if (listed) return listed.feature;
  const [a, b] = FEATURE_INKS.map((c) => c.hex);
  return contrast(skinHex, a) >= contrast(skinHex, b) ? a : b;
}

/** The outline for a background: whichever of the two stands out more. No background: the dark one. */
export function outlineFor(bgHex) {
  if (!bgHex) return INKS.outlineDark;
  return contrast(bgHex, INKS.outlineDark) >= contrast(bgHex, INKS.outlineLight) ? INKS.outlineDark : INKS.outlineLight;
}

/** The option `steps` along a part's list from the record's value, wrapping. A free colour steps from the start. */
export function stepPart(record, key, steps = 1) {
  const p = partOf(key);
  const rec = normalizeRecord(record);
  if (!p) return rec;
  const n = p.options.length;
  const i = p.options.findIndex((o) => o.id === rec[key]);
  const from = i < 0 ? (steps > 0 ? -1 : 0) : i;
  return { ...rec, [key]: p.options[(((from + steps) % n) + n) % n].id };
}

// *** CONTRAST: A WARNING, NEVER A BLOCK (Mike, row 2.37 item 3). *** The outline is always there and
// is picked to stand out from the background, so nothing here can make a part invisible. What CAN
// happen is a face, hair or top so close to the background that the figure blurs into it at a small
// size (a 64px call tile). `min` is the ratio below which that is said; 1.3:1 is "nearly the same
// colour" [a guess, on Mike's list, and a setting on the creator]. Hair against the face is not
// checked: blonde hair on a pale face is how some people look.
export const DEFAULT_WARN_BELOW = 1.3;
export function avatarWarnings(record, { min = DEFAULT_WARN_BELOW } = {}) {
  const rec = normalizeRecord(record);
  const bg = colorOf(rec, 'bg');
  if (!bg) return [];
  const out = [];
  const check = (key, what, hex) => {
    if (!hex) return;
    const ratio = contrast(hex, bg);
    if (ratio < min) {
      out.push({ part: key, ratio: Math.round(ratio * 100) / 100,
        text: `The ${what} and the background are close in colour (${ratio.toFixed(2)}:1). It will still show, `
          + 'with its outline, but it may blur into the background when small. Another background would stand out more.' });
    }
  };
  check('skin', 'face', colorOf(rec, 'skin'));
  if (rec.hair !== 'none') check('hairColor', rec.hair === 'scarf' ? 'head scarf' : 'hair', rec.hair === 'scarf' ? colorOf(rec, 'top') : colorOf(rec, 'hairColor'));
  check('top', 'top', colorOf(rec, 'top'));
  return out;
}

/** A plain sentence about the avatar, for its accessible name and for being read aloud. */
export function describeAvatar(record) {
  const rec = normalizeRecord(record);
  const name = (k) => String(optionFor(rec, k).name).toLowerCase();
  const bits = [];
  if (rec.hair === 'none') bits.push('no hair');
  else if (rec.hair === 'scarf') bits.push('a head scarf');
  else bits.push(`${name('hairColor')} hair, ${name('hair')}`);
  if (rec.glasses !== 'none') bits.push(rec.glasses === 'sun' ? 'sunglasses' : `${name('glasses')} glasses`);
  if (rec.facial !== 'none') bits.push(`a ${name('facial')}`);
  if (rec.extra !== 'none') bits.push(rec.extra === 'earrings' ? 'earrings' : `a ${name('extra')}`);
  bits.push({ open: 'an open mouth', flat: 'a straight mouth' }[rec.mouth] || `a ${name('mouth')}`);
  return `A drawn avatar: ${bits.join(', ')}.`;
}

// ---------------------------------------------------------------------------------------
// SURPRISE ME — deterministic from a seed, so the same seed gives the same face (testable, and a
// person's first avatar is stable across reloads).
// ---------------------------------------------------------------------------------------

/** FNV-1a: any string (a person's id, "id:3") to a 32-bit seed. */
export function seedFrom(seed) {
  if (Number.isFinite(seed)) return seed >>> 0;
  let h = 0x811c9dc5;
  for (const ch of String(seed ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// How often a surprise has each "none". Glasses, a beard and a hat are each a minority of faces, so a
// surprise that picked them uniformly would be mostly bearded, spectacled people in hats. The chances
// below are ONLY for "surprise me" — every option is one press away in the creator. [Guesses.]
export const SURPRISE_NONE_CHANCE = Object.freeze({ glasses: 0.6, facial: 0.7, extra: 0.6, hair: 0.08 });
// Only the listed colours (no free hexes) and only real hair colours most of the time.
export const SURPRISE_DYED_CHANCE = 0.1;
// Tries before a surprise gives up looking for a background with no warning. Deterministic either way.
export const SURPRISE_TRIES = 12;

export function surprise(seed, { min = DEFAULT_WARN_BELOW } = {}) {
  const rand = mulberry32(seedFrom(seed));
  const pickFrom = (list) => list[Math.floor(rand() * list.length) % list.length].id;
  const rec = { v: AVATAR_VERSION };
  for (const p of PARTS) {
    const none = SURPRISE_NONE_CHANCE[p.key];
    if (none !== undefined) {
      const rest = p.options.filter((o) => o.id !== 'none');
      rec[p.key] = rand() < none ? 'none' : pickFrom(rest);
    } else if (p.key === 'hairColor') {
      const dyed = HAIR_COLORS.filter((c) => c.id.startsWith('dyed'));
      rec[p.key] = pickFrom(rand() < SURPRISE_DYED_CHANCE ? dyed : HAIR_COLORS.filter((c) => !dyed.includes(c)));
    } else if (p.key === 'bg') {
      rec[p.key] = pickFrom(SOFT_GROUNDS);
    } else {
      rec[p.key] = pickFrom(p.options);
    }
  }
  // A surprise nobody asked to be warned about: re-pick the background (then the top) a few times.
  for (let i = 0; i < SURPRISE_TRIES && avatarWarnings(rec, { min }).length; i++) {
    const w = avatarWarnings(rec, { min });
    if (w.some((x) => x.part === 'top')) rec.top = pickFrom(TOPS);
    else rec.bg = pickFrom(i < SURPRISE_TRIES / 2 ? SOFT_GROUNDS : BACKGROUNDS.filter((b) => b.hex));
  }
  // Still warned after the tries: the first background in the list, then the first top, that clears it.
  if (avatarWarnings(rec, { min }).length) {
    const bgOk = BACKGROUNDS.find((b) => b.hex && !avatarWarnings({ ...rec, bg: b.id }, { min }).some((x) => x.part !== 'top'));
    if (bgOk) rec.bg = bgOk.id;
    const topOk = TOPS.find((t) => !avatarWarnings({ ...rec, top: t.id }, { min }).length);
    if (topOk) rec.top = topOk.id;
  }
  return normalizeRecord(rec);
}

// ---------------------------------------------------------------------------------------
// THE DRAWING
// ---------------------------------------------------------------------------------------

const f1 = (n) => String(Math.round(n * 10) / 10);
const escText = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The movement, inside the drawing so it travels with it (inline or as an <img>). Class names are
// prefixed `nav-` so several avatars on one page share one meaning. Resting lids are closed-to-nothing
// OUTSIDE the motion guard, so a still avatar never has its eyes shut.
export const MOTION_CSS = [
  '.nav-lid{transform-box:fill-box;transform-origin:center top;transform:scaleY(0)}',
  '@media (prefers-reduced-motion: no-preference){',
  '.nav-anim .nav-lid{animation:navBlink 9s ease-in-out infinite;animation-delay:var(--nav-delay,0s)}',
  '.nav-anim .nav-body{transform-box:view-box;transform-origin:100px 200px;animation:navBreathe 4.4s ease-in-out infinite alternate;animation-delay:var(--nav-delay,0s)}',
  '}',
  '@keyframes navBlink{0%,90%{transform:scaleY(0)}94%,96%{transform:scaleY(1)}100%{transform:scaleY(0)}}',
  '@keyframes navBreathe{from{transform:scale(1,1)}to{transform:scale(1.01,1.02)}}',
].join('');

function headShape(face, fill, line) {
  const a = `fill="${fill}" stroke="${line}" stroke-width="3"`;
  switch (face.id) {
    case 'square': return `<rect x="53" y="37" width="94" height="101" rx="28" ${a}/>`;
    case 'heart': return `<path d="M52 80C52 48 74 35 100 35C126 35 148 48 148 80C148 112 124 139 100 141C76 139 52 112 52 80Z" ${a}/>`;
    default: return `<ellipse cx="100" cy="88" rx="${face.w}" ry="${(face.chin - face.top) / 2}" ${a}/>`;
  }
}

// The dome every hair sits on, and the hairline across the forehead. `fringe` is the control point of
// the hairline: lower (bigger) is a lower fringe.
function dome(face, fringe) {
  const L = 100 - face.w - 3, R = 100 + face.w + 3, T = face.top;
  return `M${L} 92C${L} ${T + 8} ${f1(100 - face.w * 0.6)} ${T - 6} 100 ${T - 6}C${f1(100 + face.w * 0.6)} ${T - 6} ${R} ${T + 8} ${R} 92`
    + `L${R - 5} 74Q100 ${fringe} ${L + 5} 74Z`;
}

function hairLayers(rec, face, hair, line, topHex) {
  const L = 100 - face.w - 3, R = 100 + face.w + 3, T = face.top;
  const st = `stroke="${line}" stroke-width="3"`;
  const fill = rec.hair === 'scarf' ? topHex : hair;
  const p = (d, extra = '') => `<path d="${d}" fill="${fill}" ${st}${extra}/>`;
  const back = [], side = [], front = [];
  switch (rec.hair) {
    case 'none': break;
    case 'buzz': front.push(`<path d="${dome(face, T + 6)}" fill="${fill}" fill-opacity="0.6"/>`); break;
    case 'short': front.push(p(dome(face, T + 16))); break;
    case 'side':
      front.push(p(`M${L} 92C${L} ${T + 8} ${f1(100 - face.w * 0.6)} ${T - 6} 100 ${T - 6}C${f1(100 + face.w * 0.6)} ${T - 6} ${R} ${T + 8} ${R} 92`
        + `L${R - 5} 72Q100 ${T + 34} ${L + 4} 86Z`));
      break;
    case 'curly': {
      front.push(p(dome(face, T + 14)));
      for (let i = 0; i <= 7; i++) {
        const a = Math.PI * (1.08 + (0.84 * i) / 7);
        const cx = 100 + (face.w + 1) * Math.cos(a), cy = 84 + (84 - T + 6) * Math.sin(a);
        front.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="11" fill="${fill}" ${st}/>`);
      }
      break;
    }
    case 'afro':
      back.push(`<circle cx="100" cy="${T + 34}" r="${face.w + 28}" fill="${fill}" ${st}/>`);
      front.push(`<path d="${dome(face, T + 18)}" fill="${fill}"/>`);
      break;
    case 'bob':
      back.push(p(`M${L - 4} 80L${L - 7} 130Q100 140 ${R + 7} 130L${R + 4} 80Z`));
      front.push(p(`M${L} 92C${L} ${T + 8} ${f1(100 - face.w * 0.6)} ${T - 6} 100 ${T - 6}C${f1(100 + face.w * 0.6)} ${T - 6} ${R} ${T + 8} ${R} 92L${R - 4} 70L${L + 4} 70Z`));
      break;
    case 'long': case 'wavy': {
      back.push(p(`M${L - 2} 84C${L - 12} 130 ${L - 10} 160 ${L} 178L${R} 178C${R + 10} 160 ${R + 12} 130 ${R + 2} 84Z`));
      const wav = rec.hair === 'wavy';
      side.push(p(wav
        ? `M${L} 86Q${L - 10} 104 ${L - 2} 120Q${L - 10} 138 ${L} 164L${L + 14} 164Q${L + 6} 138 ${L + 13} 120Q${L + 6} 104 ${L + 13} 96Z`
        : `M${L} 86Q${L - 8} 130 ${L + 2} 165L${L + 14} 165Q${L + 8} 130 ${L + 13} 96Z`));
      side.push(p(wav
        ? `M${R} 86Q${R + 10} 104 ${R + 2} 120Q${R + 10} 138 ${R} 164L${R - 14} 164Q${R - 6} 138 ${R - 13} 120Q${R - 6} 104 ${R - 13} 96Z`
        : `M${R} 86Q${R + 8} 130 ${R - 2} 165L${R - 14} 165Q${R - 8} 130 ${R - 13} 96Z`));
      front.push(p(`M${L} 92C${L} ${T + 8} ${f1(100 - face.w * 0.6)} ${T - 6} 100 ${T - 6}C${f1(100 + face.w * 0.6)} ${T - 6} ${R} ${T + 8} ${R} 92`
        + `L${R - 4} 84Q${f1(100 + face.w * 0.4)} ${T + 10} 100 ${T + 4}Q${f1(100 - face.w * 0.4)} ${T + 10} ${L + 4} 84Z`));
      break;
    }
    case 'bun':
      back.push(`<circle cx="100" cy="${T - 10}" r="17" fill="${fill}" ${st}/>`);
      front.push(p(dome(face, T + 14)));
      break;
    case 'ponytail':
      back.push(p(`M${R - 8} ${T + 4}Q${R + 32} ${T + 18} ${R + 20} 132Q${R + 8} 100 ${R - 6} ${T + 22}Z`));
      front.push(p(dome(face, T + 14)));
      break;
    case 'braids':
      for (const x of [L + 3, R - 3]) {
        for (let y = 100; y <= 168; y += 12) side.push(`<ellipse cx="${x}" cy="${y}" rx="7" ry="7.5" fill="${fill}" ${st}/>`);
      }
      front.push(p(`M${L} 92C${L} ${T + 8} ${f1(100 - face.w * 0.6)} ${T - 6} 100 ${T - 6}C${f1(100 + face.w * 0.6)} ${T - 6} ${R} ${T + 8} ${R} 92`
        + `L${R - 4} 84Q${f1(100 + face.w * 0.4)} ${T + 10} 100 ${T + 4}Q${f1(100 - face.w * 0.4)} ${T + 10} ${L + 4} 84Z`));
      break;
    case 'locs':
      for (const x of [L - 2, L + 6, R - 6, R + 2]) side.push(`<rect x="${x - 4}" y="84" width="8" height="${x < 100 ? 80 : 76}" rx="4" fill="${fill}" ${st}/>`);
      front.push(p(dome(face, T + 18)));
      break;
    case 'mohawk':
      front.push(p(`M92 ${T + 16}Q100 ${T - 30} 108 ${T + 16}Z`));
      break;
    case 'scarf':
      side.push(p(`M${L - 8} 96C${L - 10} ${T - 14} ${R + 10} ${T - 14} ${R + 8} 96L${R + 16} 152Q100 168 ${L - 16} 152Z`));
      front.push(p(`M${L - 1} 94C${L} ${T - 8} ${R} ${T - 8} ${R + 1} 94L${R - 4} 80Q100 ${T + 12} ${L + 4} 80Z`));
      break;
    default: break;
  }
  return { back: back.join(''), side: side.join(''), front: front.join('') };
}

function eyesSvg(rec, skin, feat, line, animate) {
  const one = (cx) => {
    const cy = 88;
    switch (rec.eyes) {
      case 'dots': return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${feat}"/>`;
      case 'happy': return `<path d="M${cx - 7} ${cy + 2}Q${cx} ${cy - 7} ${cx + 7} ${cy + 2}" fill="none" stroke="${feat}" stroke-width="3.5"/>`;
      case 'wide': return `<ellipse cx="${cx}" cy="${cy}" rx="9" ry="9.5" fill="${INKS.white}" stroke="${line}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy + 1}" r="5" fill="${INKS.pupil}"/><circle cx="${cx + 1.8}" cy="${cy - 1.5}" r="1.6" fill="${INKS.white}"/>`;
      case 'sleepy': return `<ellipse cx="${cx}" cy="${cy + 1}" rx="7" ry="5.5" fill="${INKS.white}" stroke="${line}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy + 2}" r="3.6" fill="${INKS.pupil}"/>`
        + `<path d="M${cx - 8} ${cy}Q${cx} ${cy - 4} ${cx + 8} ${cy}" fill="none" stroke="${feat}" stroke-width="3"/>`;
      case 'lashes': return `<ellipse cx="${cx}" cy="${cy}" rx="7" ry="8" fill="${INKS.white}" stroke="${line}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy + 1}" r="4" fill="${INKS.pupil}"/><circle cx="${cx + 1.5}" cy="${cy - 0.5}" r="1.4" fill="${INKS.white}"/>`
        + `<path d="M${cx - 6} ${cy - 6}L${cx - 9} ${cy - 10}M${cx} ${cy - 8}L${cx} ${cy - 12}M${cx + 6} ${cy - 6}L${cx + 9} ${cy - 10}" fill="none" stroke="${feat}" stroke-width="2"/>`;
      default: return `<ellipse cx="${cx}" cy="${cy}" rx="7" ry="8" fill="${INKS.white}" stroke="${line}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy + 1}" r="4" fill="${INKS.pupil}"/><circle cx="${cx + 1.5}" cy="${cy - 0.5}" r="1.4" fill="${INKS.white}"/>`;
    }
  };
  // The lids exist only when the avatar moves: a still drawing has nothing to blink with.
  const lids = animate
    ? `<g class="nav-lids"><ellipse class="nav-lid" cx="82" cy="88" rx="11" ry="11" fill="${skin}"/><ellipse class="nav-lid" cx="118" cy="88" rx="11" ry="11" fill="${skin}"/></g>`
    : '';
  return `<g class="nav-eyes" data-part="eyes">${one(82)}${one(118)}${lids}</g>`;
}

function browsSvg(rec, hair) {
  if (rec.brows === 'none') return '';
  const one = (cx, m) => {
    const x = (dx) => cx + m * dx;
    switch (rec.brows) {
      case 'straight': return `<path d="M${x(-9)} 72L${x(9)} 71" fill="none" stroke="${hair}" stroke-width="4"/>`;
      case 'arched': return `<path d="M${x(-9)} 73Q${cx} 62 ${x(9)} 71" fill="none" stroke="${hair}" stroke-width="3"/>`;
      case 'thick': return `<path d="M${x(-10)} 73Q${cx} 65 ${x(10)} 72" fill="none" stroke="${hair}" stroke-width="6.5"/>`;
      default: return `<path d="M${x(-9)} 72Q${cx} 66 ${x(9)} 72" fill="none" stroke="${hair}" stroke-width="3"/>`;
    }
  };
  return `<g data-part="brows">${one(82, 1)}${one(118, -1)}</g>`;
}

function mouthSvg(rec, feat) {
  const s = (d, w = 3.5) => `<path d="${d}" fill="none" stroke="${feat}" stroke-width="${w}"/>`;
  let inner;
  switch (rec.mouth) {
    case 'grin': inner = `<path d="M84 112Q100 134 116 112Z" fill="${INKS.mouth}" stroke="${feat}" stroke-width="2.5"/>`
      + `<path d="M87 113.5L113 113.5Q112 117.5 108 118.5L92 118.5Q88 117.5 87 113.5Z" fill="${INKS.white}"/>`; break;
    case 'open': inner = `<ellipse cx="100" cy="118" rx="8" ry="9" fill="${INKS.mouth}" stroke="${feat}" stroke-width="2.5"/>`
      + `<ellipse cx="100" cy="123" rx="5" ry="3.5" fill="${INKS.tongue}"/>`; break;
    case 'small': inner = s('M94 116Q100 121 106 116'); break;
    case 'smirk': inner = s('M88 117Q102 121 112 111'); break;
    case 'flat': inner = s('M90 117L110 117'); break;
    default: inner = s('M86 114Q100 126 114 114');
  }
  return `<g class="nav-mouth" data-part="mouth">${inner}</g>`;
}

const MUSTACHE = 'M86 111Q93 104 100 108Q107 104 114 111Q107 112 100 110Q93 112 86 111Z';
function facialSvg(rec, face, hair) {
  const w = face.w, chin = face.chin;
  const under = [], over = [];
  switch (rec.facial) {
    case 'stubble':
      under.push(`<path d="M${100 - w + 6} 100Q${100 - w + 8} ${chin - 4} 100 ${chin}Q${100 + w - 8} ${chin - 4} ${100 + w - 6} 100Q100 128 ${100 - w + 6} 100Z" fill="${hair}" fill-opacity="0.28"/>`);
      break;
    case 'mustache': over.push(`<path d="${MUSTACHE}" fill="${hair}"/>`); break;
    case 'goatee':
      under.push(`<path d="M92 125Q100 122 108 125Q107 135 100 137Q93 135 92 125Z" fill="${hair}"/>`);
      over.push(`<path d="${MUSTACHE}" fill="${hair}"/>`);
      break;
    case 'beard': case 'chinstrap':
      under.push(`<path d="M${100 - w} 92Q${100 - w + 2} ${chin + 6} 100 ${chin + 8}Q${100 + w - 2} ${chin + 6} ${100 + w} 92L${100 + w - 8} 96Q100 132 ${100 - w + 8} 96Z" fill="${hair}"/>`);
      if (rec.facial === 'beard') over.push(`<path d="${MUSTACHE}" fill="${hair}"/>`);
      break;
    default: break;
  }
  return { under: under.join(''), over: over.join('') };
}

function glassesSvg(rec, face, feat) {
  if (rec.glasses === 'none') return '';
  const arms = `<path d="M${rec.glasses === 'big' ? 68 : 70} 86L${100 - face.w} 83M${rec.glasses === 'big' ? 132 : 130} 86L${100 + face.w} 83" fill="none" stroke="${feat}" stroke-width="2.5"/>`;
  const bridge = `<path d="M${rec.glasses === 'big' ? 96 : 93} 88Q100 84 ${rec.glasses === 'big' ? 104 : 107} 88" fill="none" stroke="${feat}" stroke-width="2.5"/>`;
  let lenses;
  switch (rec.glasses) {
    case 'round': lenses = [82, 118].map((cx) => `<circle cx="${cx}" cy="88" r="11" fill="none" stroke="${feat}" stroke-width="3"/>`).join(''); break;
    case 'big': lenses = [82, 118].map((cx) => `<rect x="${cx - 14}" y="77" width="28" height="23" rx="8" fill="none" stroke="${feat}" stroke-width="3"/>`).join(''); break;
    case 'sun': lenses = [82, 118].map((cx) => `<rect x="${cx - 12}" y="79" width="24" height="18" rx="5" fill="${INKS.lens}" fill-opacity="0.88" stroke="${feat}" stroke-width="3"/>`).join(''); break;
    default: lenses = [82, 118].map((cx) => `<rect x="${cx - 12}" y="79" width="24" height="18" rx="4" fill="none" stroke="${feat}" stroke-width="3"/>`).join('');
  }
  return `<g data-part="glasses">${arms}${bridge}${lenses}</g>`;
}

function extraSvg(rec, face, topHex, line) {
  const L = 100 - face.w - 3, R = 100 + face.w + 3, T = face.top;
  const st = `stroke="${line}" stroke-width="3"`;
  switch (rec.extra) {
    case 'beanie':
      return `<path d="M${L - 2} ${T + 22}C${L} ${T - 26} ${R} ${T - 26} ${R + 2} ${T + 22}Z" fill="${topHex}" ${st}/>`
        + `<rect x="${L - 4}" y="${T + 13}" width="${R - L + 8}" height="13" rx="6" fill="${topHex}" ${st}/>`
        + `<circle cx="100" cy="${T - 17}" r="7" fill="${topHex}" ${st}/>`;
    case 'cap':
      return `<path d="M${L} ${T + 20}C${L} ${T - 18} ${R} ${T - 18} ${R} ${T + 20}Z" fill="${topHex}" ${st}/>`
        + `<path d="M94 ${T + 17}Q${R + 26} ${T + 11} ${R + 30} ${T + 23}Q${R} ${T + 28} 94 ${T + 22}Z" fill="${topHex}" ${st}/>`;
    case 'headband':
      return `<path d="M${L + 1} ${T + 30}C${L + 4} ${T - 4} ${R - 4} ${T - 4} ${R - 1} ${T + 30}" fill="none" stroke="${topHex}" stroke-width="8"/>`;
    case 'bow': {
      const x = R - 12, y = T + 4;
      return `<path d="M${x} ${y}L${x - 16} ${y - 10}L${x - 16} ${y + 10}Z" fill="${topHex}" ${st}/>`
        + `<path d="M${x} ${y}L${x + 16} ${y - 10}L${x + 16} ${y + 10}Z" fill="${topHex}" ${st}/>`
        + `<circle cx="${x}" cy="${y}" r="5" fill="${topHex}" ${st}/>`;
    }
    case 'flower': {
      const x = R - 10, y = T + 10;
      const petals = [0, 1, 2, 3, 4].map((i) => {
        const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        return `<circle cx="${f1(x + 7 * Math.cos(a))}" cy="${f1(y + 7 * Math.sin(a))}" r="6" fill="${topHex}" stroke="${line}" stroke-width="2"/>`;
      }).join('');
      return `${petals}<circle cx="${x}" cy="${y}" r="4" fill="${INKS.gold}"/>`;
    }
    case 'earrings':
      return [100 - face.w + 1, 100 + face.w - 1].map((cx) => `<circle cx="${cx}" cy="104" r="3.5" fill="${INKS.gold}" stroke="${line}" stroke-width="1.5"/>`).join('');
    default: return '';
  }
}

/**
 * The avatar as an SVG string. `record` is repaired first, so anything renders.
 *   size      width/height attributes (the viewBox is always 200); null for none (fills its box)
 *   animate   true: blinks and breathes (inside prefers-reduced-motion: no-preference); false: still
 *   title     the accessible name; defaults to `describeAvatar`
 *   delay     seconds into the cycle, so two avatars side by side do not blink in step; defaults to
 *             one derived from the record, so it is stable
 */
export function renderAvatar(record, { size = null, animate = true, title = null, delay = null } = {}) {
  const rec = normalizeRecord(record);
  const face = FACES.find((x) => x.id === rec.face) || FACES[0];
  const skin = colorOf(rec, 'skin');
  const hair = colorOf(rec, 'hairColor');
  const top = colorOf(rec, 'top');
  const bg = colorOf(rec, 'bg');
  const line = outlineFor(bg);
  const feat = featureInkFor(skin);
  const hairL = hairLayers(rec, face, hair, line, top);
  const facial = facialSvg(rec, face, hair);
  const st = `stroke="${line}" stroke-width="3"`;
  const d = delay == null ? (seedFrom(JSON.stringify(rec)) % 90) / 10 : Number(delay) || 0;
  const name = title == null ? describeAvatar(rec) : String(title);
  const ears = rec.hair === 'scarf' ? ''
    : [100 - face.w + 1, 100 + face.w - 1].map((cx) => `<circle cx="${cx}" cy="92" r="10" fill="${skin}" ${st}/>`).join('');
  const dims = size ? ` width="${Number(size) || 0}" height="${Number(size) || 0}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}"${dims} role="img" aria-label="${escText(name)}"`
    + ` class="nav${animate ? ' nav-anim' : ''}" data-avatar="1" data-motion="${animate ? 'on' : 'off'}" style="--nav-delay:-${f1(d)}s">`
    + `<title>${escText(name)}</title>`
    + (animate ? `<style>${MOTION_CSS}</style>` : '')
    + (bg ? `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="${bg}" data-part="bg"/>` : '')
    + `<g class="nav-body" stroke-linejoin="round" stroke-linecap="round">`
    + `<g data-part="hair-back">${hairL.back}</g>`
    + `<rect x="86" y="116" width="28" height="40" fill="${skin}" ${st}/>`
    + `<path d="M24 200C26 164 58 148 86 147Q100 162 114 147C142 148 174 164 176 200Z" fill="${top}" ${st} data-part="top"/>`
    + `<g data-part="hair-side">${hairL.side}</g>`
    + ears
    + `<g data-part="face">${headShape(face, skin, line)}</g>`
    + `<g data-part="facial">${facial.under}</g>`
    + eyesSvg(rec, skin, feat, line, animate)
    + browsSvg(rec, hair)
    + `<path d="M100 94Q95 105 101 106" fill="none" stroke="${feat}" stroke-width="3"/>`
    + mouthSvg(rec, feat)
    + `<g data-part="facial-over">${facial.over}</g>`
    + `<g data-part="hair">${hairL.front}</g>`
    + glassesSvg(rec, face, feat)
    + `<g data-part="extra">${extraSvg(rec, face, top, line)}</g>`
    + '</g></svg>';
}

// ---------------------------------------------------------------------------------------
// WHAT IS KEPT ON THE PERSON. Per-person state (`makePersonState(personId, AVATAR_KEY)`), the same
// store the game and the music favourites use, so it follows the person to every screen with no new
// server table. Optional in every sense: a person with no row has no avatar, and whatever shows for
// them today is unchanged.
//
//   { use: 'drawn' | 'picture' | 'none', drawn: <record> | null, picture: { sourceId, path } | null, at }
//
// `picture` is a reference into the person's own Media sources — the same `{ sourceId, path }` a
// button's or an AAC card's picture is (`card_face.js`). Nothing is uploaded; the file stays where it is.
// ---------------------------------------------------------------------------------------
export const AVATAR_KEY = 'avatar';

export function readAvatar(row) {
  const r = row && typeof row === 'object' ? row : {};
  const drawn = r.drawn && typeof r.drawn === 'object' ? normalizeRecord(r.drawn) : null;
  const pic = r.picture && typeof r.picture === 'object' && typeof r.picture.sourceId === 'string'
    && typeof r.picture.path === 'string' && r.picture.sourceId && r.picture.path
    ? { sourceId: r.picture.sourceId, path: r.picture.path } : null;
  let use = ['drawn', 'picture', 'none'].includes(r.use) ? r.use : (drawn ? 'drawn' : pic ? 'picture' : 'none');
  if (use === 'drawn' && !drawn) use = pic ? 'picture' : 'none';
  if (use === 'picture' && !pic) use = drawn ? 'drawn' : 'none';
  return { use, drawn, picture: pic };
}
