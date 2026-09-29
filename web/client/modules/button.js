// button.js — A BUTTON: words and/or a picture on a face you can press. One module, many uses.
//
// Change list row 2.26 (NimrodEcosystemGame, step 1). Mike, 2026-09-28, revising "a name-sign
// module and a picture module" into one thing: *"They could both be AAC buttons or really just
// buttons. AAC should have all the framework somewhere... So the PFP/Name sign are basically
// instances of buttons that become their own prefabs."* So there is ONE type here, and the game's
// name sign and profile picture are two INSTANCES of it with different settings. Prefabs do not
// exist yet (change list C$6 / H1), so today each is an instance with its own settings; nothing
// here assumes otherwise.
//
// THE FACE IS THE AAC BOARD'S CARD, not a second one: `card_face.js` holds the markup (picture
// slot or symbol, then the word) and the picture loader (a URL the card owns, released when it
// goes; the word never waits on the file). Only the LOOK around it is this module's.
//
// EVERY SETTING GOES THROUGH THE UNIVERSAL MENU, declared below as data:
//   label        the words (a sign's words; a picture's caption and its accessible name)
//   imageFrom    which of the person's Media sources the picture comes from (live choice)
//   image        which picture in that source (live choice; "No picture" by default)
//   frame        none, or one of Claude Design's seven frames (the picture sits in its window)
//   font         a short list of fonts every device already has — nothing is downloaded
//   style        plain, or one of Design's six signs (the words sit on it)
//   color        the colour of the words (the menu's colour picker); until somebody picks one,
//                the colour suggested for the look they sit on — see "THE WORDS' COLOUR" below
//   background   the colour behind them (the menu's colour picker): the plain face, and a
//                frame's window. A designed sign brings its own ground, so it does not show there.
//   whenPressed  "Nothing" by default, or "Say the words" through the output bus
//
// *** THE STYLES AND FRAMES ARE DESIGN'S NOW (2026-09-29). *** Until yesterday they were CSS
// placeholders that said so; Design's sign and frame SVGs replaced them. The placeholder ids that
// were stored for real read as their designed replacements (`LEGACY_STYLES`/`LEGACY_FRAMES`), so
// nobody's saved choice had to move.
//
// STORED AS MEANING, RENDERED PER SCREEN: `font` stores an id ('serif'), never a font stack, and
// `frame`/`style` store ids, never CSS — the house rule (content as meaning; the look is a render
// setting). The colours are the one exception, because a colour IS the meaning: a hex string,
// which is what the menu's `color` kind stores.
//
// NO COLOUR IS HARD-CODED IN CSS. The two chosen colours reach the stylesheet as custom properties
// set here; their defaults are palette entries read from `color_picker.js`, not literals; the
// signs and frames are Design's own files, and the stylesheet only places them.
//
// PRESSING IT: a click, or the `select` verb (a switch, a key, anything bound to Select) while the
// panel has focus. Both end in `press()`. What a press DOES is a setting — Mike: wiring a press is
// "an optional side quest", so the default is nothing, and the one wired option is saying the
// words, through `ctx.output.say` exactly as the AAC board does (`say`, never `notify`: it speaks
// in the room and summons nobody — see board.js's header).

import { registerModule } from '../module.js';
import { cardFaceHTML, createCardImages } from '../card_face.js';
import { createMediaSourcesClient, listItemNames } from '../media_sources.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { DEFAULT_PALETTE, normalizeHex, contrast } from '../color_picker.js';
import { speak as speakDefault } from '../voice.js';

// ---------------------------------------------------------------------------------------
// THE FONTS. *** A DEFAULT LIST, NOT A RULE — Rule 1: say why each is here. ***
//
// Every stack ends in a GENERIC family, so each choice renders as something honest on every
// device even where the named face is missing: nothing is downloaded (no web fonts — a bedside
// Pi on facility wifi, and a page that must work offline). The named faces are the ones that ship
// with Windows, macOS/iOS or both; Android and the Pi fall through to the generic, which is still
// a visibly different family from the others. Five is enough to feel like a choice and short
// enough to walk with one switch (six presses round).
// ---------------------------------------------------------------------------------------
export const FONTS = Object.freeze([
  { value: 'theme',   label: 'The screen’s own',   stack: 'var(--font)' },
  { value: 'serif',   label: 'Book (serif)',        stack: 'Georgia, Cambria, "Times New Roman", Times, serif' },
  { value: 'rounded', label: 'Rounded',             stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif' },
  { value: 'hand',    label: 'Handwritten',         stack: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive' },
  { value: 'type',    label: 'Typewriter',          stack: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace' },
  { value: 'poster',  label: 'Poster (heavy)',      stack: 'Impact, "Arial Black", "Franklin Gothic Heavy", sans-serif' },
]);

// ---------------------------------------------------------------------------------------
// THE DESIGNED LOOKS (Claude Design, delivered 2026-09-28; credited in ATTRIBUTIONS.md). The files
// are in `web/client/design-assets/`, loaded by absolute path — the same way `/packs/…` are — so a
// page at any depth reaches them. Every number below was MEASURED FROM THE SVG, not eyeballed, and
// `dev/button_test.html` re-measures the files and fails if a number here stops matching them.
//
// A SIGN is a background the words sit on. `text` is the box the words must stay inside, in the
// sign's own viewBox units: the inner edge of the board (the chalkboard's slate, the street sign's
// white border, the banner's front panel, the plate's inner line) pulled in to clear the screws,
// nails and neon tube, and centred on x=180 where Design centred its own sample word. `fontSize` is
// Design's sample size — the CEILING, so a short name is set the size Design drew it, never bigger.
// `board` is the fill the words sit on (for a gradient, every stop), and `ink` is the palette colour
// SUGGESTED for words on it, used until the person picks a colour themselves (see `color` below).
// The suite holds every ink to 4.5:1 against every one of its board colours.
//
// *** THE SIGN FILES WERE CHANGED ONE WAY ON THE WAY IN: Design drew a sample word on each, and it
// was removed, because the person's own words go there. *** The content credential in each file is
// kept; it describes the file as delivered, and a comment in the file says what changed.
// ---------------------------------------------------------------------------------------
const ASSETS = '/design-assets';
export const SIGNS = Object.freeze([
  { value: 'plate',      label: 'Name plate',  text: [42, 30, 276, 60], fontSize: 40,
    board: { fill: 'url(#b)', colors: ['#ecd28a', '#c49a44', '#e2c270'] }, ink: 'black' },
  { value: 'wood',       label: 'Wooden sign', text: [34, 18, 292, 84], fontSize: 46,
    board: { fill: 'url(#w)', colors: ['#a06a3e', '#7a4c2a'] }, ink: 'white' },
  { value: 'chalkboard', label: 'Chalkboard',  text: [26, 24, 308, 72], fontSize: 46,
    board: { fill: '#2f3b35', colors: ['#2f3b35'] }, ink: 'white' },
  { value: 'street',     label: 'Street sign', text: [26, 28, 308, 64], fontSize: 46,
    board: { fill: '#1f6b45', colors: ['#1f6b45'] }, ink: 'white' },
  { value: 'banner',     label: 'Banner',      text: [54, 26, 252, 70], fontSize: 46,
    board: { fill: '#9e5449', colors: ['#9e5449'] }, ink: 'white' },
  { value: 'neon',       label: 'Neon',        text: [30, 28, 300, 64], fontSize: 46,
    board: { fill: '#12181c', colors: ['#12181c'] }, ink: 'white' },
].map((s) => Object.freeze({ ...s, viewBox: [360, 120], file: `${ASSETS}/signs/${s.value}.svg` })));

// A FRAME comes in two shapes — `4x3` and `square` — and the picture sits in its WINDOW: the hole
// in the frame's even-odd path (every frame draws its window as a transparent hole; the classic
// frame's cream mat is a second ring inside the moulding, so its window is the mat's hole). Design
// made every window the same size in its own units, 200x150 and 160x160, which is how you can tell
// the measurement is the window and not the moulding. The picture is drawn UNDER the frame, so a
// window with rounded corners (the old TV's screen) rounds the picture too.
const fr = (id, label, v43, vsq) => Object.freeze({ value: id, label, variants: Object.freeze({
  '4x3': Object.freeze({ viewBox: v43[0], window: v43[1], file: `${ASSETS}/frames/${id}-4x3.svg` }),
  square: Object.freeze({ viewBox: vsq[0], window: vsq[1], file: `${ASSETS}/frames/${id}-square.svg` }),
}) });
export const FRAME_ART = Object.freeze([
  fr('classic', 'Picture frame',    [[244, 194], [22, 22, 200, 150]], [[204, 204], [22, 22, 160, 160]]),
  fr('ornate',  'Gold frame',       [[256, 206], [28, 28, 200, 150]], [[216, 216], [28, 28, 160, 160]]),
  fr('instant', 'Instant photo',    [[224, 214], [12, 12, 200, 150]], [[184, 224], [12, 12, 160, 160]]),
  fr('flatTv',  'TV',               [[216, 192], [8, 8, 200, 150]],   [[176, 202], [8, 8, 160, 160]]),
  fr('retroTv', 'Old TV',           [[280, 226], [14, 48, 200, 150]], [[240, 236], [14, 48, 160, 160]]),
  fr('monitor', 'Computer monitor', [[224, 222], [12, 12, 200, 150]], [[184, 232], [12, 12, 160, 160]]),
  fr('tablet',  'Tablet',           [[228, 178], [14, 14, 200, 150]], [[188, 188], [14, 14, 160, 160]]),
]);

// *** WHICH SHAPE, FROM THE PICTURE'S OWN PROPORTIONS. *** Width / height at or above √(4/3) ≈ 1.155
// takes the 4:3 frame; below it (near-square, and every portrait) takes the square one. Why that
// number: the picture FILLS the window (see modules.css — a frame shows no bars), so some of it is
// cropped either way, and √(4/3) is exactly where the two frames crop the same share of it. Above
// it 4:3 loses less, below it the square does; a portrait loses far less to a square window than
// to a wide one. Only two shapes because Design drew two — a portrait frame would be a third.
export const ASPECT_CUTOFF = Math.sqrt(4 / 3);
export const aspectVariant = (w, h) =>
  (Number(w) > 0 && Number(h) > 0 && Number(w) / Number(h) < ASPECT_CUTOFF ? 'square' : '4x3');

// `plain` STAYS, argued: it is the only look where the words sit on the BACKGROUND COLOUR the person
// chose (every designed sign brings its own ground), it is what a plain AAC-style tile wants, and
// black-on-white is the one pairing that reads on every theme. It is still the default.
export const STYLES = Object.freeze([
  { value: 'plain', label: 'Plain' },
  ...SIGNS.map(({ value, label }) => ({ value, label })),
]);
export const FRAMES = Object.freeze([
  { value: 'none', label: 'No frame' },
  ...FRAME_ART.map(({ value, label }) => ({ value, label })),
]);

// *** YESTERDAY'S PLACEHOLDER IDS STILL MEAN SOMETHING. *** They were stored for real (the game
// made every profile's sign a `plaque` and every picture a `picture` frame), and the promise was
// that the designed looks would replace them "without moving anyone's saved choices". So each old
// id reads as its nearest designed look — through the settings declaration (`aliases`), so the
// module, the menu row and a press on that row all agree — and nothing in storage is rewritten.
export const LEGACY_STYLES = Object.freeze({ plaque: 'plate', glow: 'neon' });
export const LEGACY_FRAMES = Object.freeze({ picture: 'classic', tv: 'flatTv' });

// LAYOUT PROPORTIONS — not settings, and said so (Rule 1): these are how the pieces share a panel,
// the kind of number a stylesheet holds, and nobody choosing a look would recognise them as a
// choice. A SIGN UNDER A PICTURE is 60% of the picture's width — a label on the wall below a
// painting, not a second thing competing with it. A PLAIN CAPTION under a framed picture gets a
// line 12% of the frame's width tall. FITTED WORDS never go below 8px (smaller is not reading) and
// are measured at a line height of 1.2 (the glyph box of a common font; the CSS line is 1.08).
export const CAPTION_SIGN_WIDTH = 0.6;
export const CAPTION_LINE = 0.12;
const FIT_FLOOR_PX = 8;
const FIT_LINE = 1.2;
export const WHEN_PRESSED = Object.freeze([
  { value: 'nothing', label: 'Nothing' },
  { value: 'say',     label: 'Say the words' },
]);

// The two colour defaults are PALETTE ENTRIES, looked up by id — black words on a white ground,
// the one pairing that reads on every theme because it brings its own ground with it.
const hexOf = (id) => (DEFAULT_PALETTE.find((c) => c.id === id) || DEFAULT_PALETTE[0]).hex;
export const DEFAULT_INK = hexOf('black');
export const DEFAULT_GROUND = hexOf('white');

// *** THE WORDS' PALETTE STARTS AT BLACK, AND THAT IS NOT TASTE. *** Found looking at the real
// kiosk: in the default palette's order Black is followed by WHITE, so the very first press on
// "Colour of the words" — the thing the game tells somebody to try — turned black words on a white
// sign into white on white, and the sign vanished. Same twelve colours, same names, one moved:
// Black first, so the first press lands on Red and White is the last stop before wrapping home.
// Derived from DEFAULT_PALETTE rather than copied, so a Design palette that replaces it flows
// through. The background keeps the default order (White is last, so its first press is Red).
export const INK_PALETTE = Object.freeze([
  ...DEFAULT_PALETTE.filter((c) => c.hex === DEFAULT_INK),
  ...DEFAULT_PALETTE.filter((c) => c.hex !== DEFAULT_INK),
]);

export const DEFAULTS = Object.freeze({
  label: 'Your words', imageFrom: '', image: '', frame: 'none', font: 'theme', style: 'plain',
  color: DEFAULT_INK, background: DEFAULT_GROUND, whenPressed: 'nothing',
});

const SIGN_BY_ID = new Map(SIGNS.map((s) => [s.value, s]));
const FRAME_BY_ID = new Map(FRAME_ART.map((f) => [f.value, f]));
export const signOf = (id) => SIGN_BY_ID.get(id) || null;
export const frameOf = (id) => FRAME_BY_ID.get(id) || null;

// The look a stored row asks for, with the old ids read as the new ones and garbage as the default.
// Used by the colour's `defaultFrom`, which is handed the RAW row.
function styleOfRow(row) {
  const raw = String(row?.style ?? DEFAULTS.style);
  const id = LEGACY_STYLES[raw] || raw;
  return STYLES.some((s) => s.value === id) ? id : DEFAULTS.style;
}

// ---------------------------------------------------------------------------------------
// *** THE WORDS' COLOUR NOBODY CHOSE, AND THE ONE SOMEBODY DID. ***
//
// Black words were fine on yesterday's white placeholder; on a chalkboard they are 1.8:1 and on
// the neon sign 1.2:1 — gone. So while the person has NOT chosen a colour, the words take the
// colour SUGGESTED for what they sit on; the moment they choose one, theirs wins, black included.
//
// HOW "NEVER CHOSEN" IS TOLD FROM "CHOSE BLACK": by whether `color` is STORED. The menu writes the
// key only when somebody changes it (a press, a swatch, the fine picker), and nothing else here
// writes it — so an absent key IS "never chosen". Argued against a separate `colorChosen` flag: a
// flag is a second fact that can disagree with the first (a colour stored by an older build with no
// flag beside it would read as unchosen and get overridden), and it is one more thing every writer
// of this row would have to remember. The one case it does not cover: somebody who deliberately
// picks exactly the suggested colour writes nothing (the menu ignores a "change" to the value in
// force), so a later change of sign re-suggests. They wanted that colour on THAT sign; nothing is
// lost. The suggestion reaches the menu through `defaultFrom`, so the row and its swatch show the
// colour actually in use, never "Black" over white words.
//
// On a designed sign the suggestion is the sign's `ink`. With no sign the words sit on the chosen
// BACKGROUND colour, so the suggestion is whichever of black or white reads better on it — black
// on the default white, as before, and white if somebody has chosen a dark background.
// ---------------------------------------------------------------------------------------
const BLACK = hexOf('black');
const WHITE = hexOf('white');
export function groundOf(style, background) {
  const sign = signOf(style);
  return sign ? sign.board.colors : [normalizeHex(background) || DEFAULT_GROUND];
}
export function suggestedInk(style, background) {
  const sign = signOf(style);
  if (sign) return hexOf(sign.ink);
  const ground = normalizeHex(background) || DEFAULT_GROUND;
  return contrast(BLACK, ground) >= contrast(WHITE, ground) ? BLACK : WHITE;
}
// The walk order for the words' colour on this look: the suggested ink FIRST, the palette's own
// order after it, and the colour that reads WORST on this ground LAST — the rule INK_PALETTE above
// already follows for black on white (black first, white last), made general. Without it, the
// first press from white words on a chalkboard wrapped to black ones: the vanishing sign again.
export function inkOrder(style, background) {
  const first = suggestedInk(style, background);
  const ground = groundOf(style, background);
  const worstOn = (hex) => Math.min(...ground.map((g) => contrast(hex, g)));
  const rest = DEFAULT_PALETTE.filter((c) => c.hex !== first);
  const worst = rest.reduce((a, c) => (worstOn(c.hex) < worstOn(a.hex) ? c : a), rest[0]);
  return [...DEFAULT_PALETTE.filter((c) => c.hex === first),
    ...rest.filter((c) => c !== worst), worst].map((c) => ({ ...c }));
}

// LEVELS: what somebody changes to make it theirs is `essential` (the words, the picture, the
// frame, the font, the colour of the words); the rest is `standard`, which the menu shows by
// default too. Nothing here is `advanced` — there is nothing technical about a sign.
export const SETTINGS = [
  { key: 'label', label: 'Words', kind: 'text', default: DEFAULTS.label, level: 'essential',
    placeholder: 'No words yet' },
  // LIVE: the person's Media sources (`settingsChoices` below). With exactly one, it is adopted
  // on mount — the same thing `photos` does — so nobody has to choose between one thing.
  { key: 'imageFrom', label: 'Picture from', kind: 'choice', default: '', level: 'essential',
    emptyLabel: 'No source chosen' },
  // LIVE: the pictures in that source, by name, one press each. See `IMAGE CHOICES` below.
  { key: 'image', label: 'Picture', kind: 'choice', default: '', level: 'essential',
    options: [{ value: '', label: 'No picture' }] },
  { key: 'frame', label: 'Frame', kind: 'choice', default: DEFAULTS.frame, aliases: LEGACY_FRAMES,
    level: 'essential', options: FRAMES.map(({ value, label }) => ({ value, label })) },
  { key: 'font', label: 'Font', kind: 'choice', default: DEFAULTS.font, level: 'essential',
    options: FONTS.map(({ value, label }) => ({ value, label })) },
  // `default` is what a reader with no row sees; `defaultFrom` is the colour in force for THIS
  // row while nobody has chosen one (see "THE WORDS' COLOUR" above). A mounted instance also
  // re-orders the walk for its look (`settingsChoices`); these declared options are the order for
  // the default look, and the one a surface with no live instance walks.
  { key: 'color', label: 'Colour of the words', kind: 'color', default: DEFAULTS.color,
    defaultFrom: (row) => suggestedInk(styleOfRow(row), row?.background),
    level: 'essential', options: INK_PALETTE.map((c) => ({ ...c })) },
  { key: 'style', label: 'Sign style', kind: 'choice', default: DEFAULTS.style, aliases: LEGACY_STYLES,
    level: 'standard', options: STYLES.map(({ value, label }) => ({ value, label })) },
  { key: 'background', label: 'Background colour', kind: 'color', default: DEFAULTS.background,
    level: 'standard' },
  { key: 'whenPressed', label: 'When pressed', kind: 'choice', default: DEFAULTS.whenPressed,
    level: 'standard', options: WHEN_PRESSED.map(({ value, label }) => ({ value, label })) },
];

const FIELDS = Object.fromEntries(SETTINGS.map(normalizeField).filter(Boolean).map((f) => [f.key, f]));

/** What is in force, read through each declaration — the same reading the settings menu does. */
export function configFrom(row = {}) {
  const cfg = {};
  for (const f of Object.values(FIELDS)) cfg[f.key] = fieldValue(f, row || {});
  if (!FONTS.some((x) => x.value === cfg.font)) cfg.font = DEFAULTS.font;
  if (!STYLES.some((x) => x.value === cfg.style)) cfg.style = DEFAULTS.style;
  if (!FRAMES.some((x) => x.value === cfg.frame)) cfg.frame = DEFAULTS.frame;
  if (cfg.whenPressed !== 'say') cfg.whenPressed = 'nothing';
  cfg.label = String(cfg.label ?? '');
  // Whether the colour in force is the person's or the look's suggestion (see "THE WORDS' COLOUR").
  cfg.inkChosen = !!normalizeHex(row?.color);
  return cfg;
}

export const fontStack = (id) => (FONTS.find((f) => f.value === id) || FONTS[0]).stack;

registerModule(
  { type: 'button', title: 'Button', core: 'new',
    // `local`, MEASURED (dev/button_test.html mounts it with every platform handle rejecting):
    // the words and the look render from defaults with no platform at all, and a picture comes
    // from the person's own Media — a folder on this device or their media agent — never the
    // platform. So it survives the platform being down, not the picture's folder going away:
    // the same exposure `photos` declares, for the same reason.
    dependsOn: 'local',
    description: 'Words, a picture, or both, on a button: a sign, a framed picture, anything you '
      + 'want to press. Its look, and what pressing it does, are in its settings.',
    settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    const speak = ctx.speak || ((text) => speakDefault(text));
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));

    let cfg = configFrom({});
    let torn = false;
    let faceEl = null;
    let faceKey = null;           // what the face markup was last built from (words + picture)
    let pressTimer = null;
    let resizeObs = null;

    // The person's Media, listed once per mount. `ctx.sources` is the kiosk's injected registry
    // (signed out: the bundled samples); `ctx.mediaSources` is the board's name for the same seam.
    let client = null;
    const sourcesClient = () => client || (client = ctx.sources || ctx.mediaSources
      || createMediaSourcesClient({ user: ctx.user, cache: true, personId: ctx.personId || null }));
    // The loader asks the same client; once `listSources` has the list it hands it over, so a
    // picture never costs a second listing.
    const images = createCardImages({ sources: { list: () => sourcesClient().list() },
                                      alive: () => !torn });
    let knownSources = [];
    const namesBySource = new Map();  // sourceId -> [{path,name,kind}] (images only)

    // ------------------------------------------------------------------------------------
    // IMAGE CHOICES. The menu paints SYNCHRONOUSLY (settings_fields.js `fieldsFor`), so the
    // options come from lists this instance already fetched. Every source's top level is listed
    // BY NAME ONLY at mount (`listItemNames` — no files read, and for a folder no object URLs, so
    // a photo panel showing the same folder is never blanked by this). A source with hundreds of
    // pictures is hundreds of presses to walk with one switch; that cost is real and is said in
    // the catalog note — a small folder of the pictures you want is the quick way.
    // ------------------------------------------------------------------------------------
    const effectiveSource = () => cfg.imageFrom
      || (knownSources.length === 1 ? knownSources[0].id : '');

    async function listSources() {
      try {
        knownSources = (await sourcesClient().list()) || [];
      } catch (err) {
        console.warn('button: could not list media sources', err);
        knownSources = [];
      }
      if (torn) return;
      images.useSources(knownSources);
      // One source and nothing chosen: adopt it, as `photos` does, so the picture row is usable
      // at once. Only when the stored row has no choice at all — a choice somebody made stands.
      const row = state?.get?.() || {};
      if (knownSources.length === 1 && !row.imageFrom) {
        try { state?.set?.({ imageFrom: knownSources[0].id }); } catch { /* a dead platform */ }
      }
      await Promise.all(knownSources.map((s) => listNames(s)));
      if (!torn) paint();
    }

    async function listNames(source) {
      if (!source || namesBySource.has(source.id)) return;
      try {
        const names = await listItemNames(source, '');
        namesBySource.set(source.id, (names || []).filter((n) => n.kind === 'image'));
      } catch (err) {
        // A folder whose permission lapsed lists nothing; the row says "No picture" and the
        // words still show. The picture itself will say nothing either — silence on the face.
        console.warn('button: could not list pictures', err);
        namesBySource.set(source.id, []);
      }
    }

    // ------------------------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------------------------
    // THE LOOK, as data attributes and custom properties on the face; modules.css draws it. No
    // colour is set here except the person's two (and the suggestion standing in for one of them).
    //   data-sign        a designed sign is on: the WORDS element is the sign (a caption under a
    //                    picture becomes a small sign — a plaque under a painting)
    //   data-frame-art   a designed frame is on: the picture sits in its window, or, with no
    //                    picture yet, the words do (the game's "My picture" before one is chosen)
    //   data-aspect      which of the frame's two shapes, from the picture's own proportions
    //   data-fit         the words are fitted to a box (every designed look; `plain` keeps its CSS)
    const setVar = (k, v) => (v == null ? faceEl.style.removeProperty(k) : faceEl.style.setProperty(k, v));
    const flag = (k, on) => { if (on) faceEl.dataset[k] = ''; else delete faceEl.dataset[k]; };
    const pct = (n) => String(Math.round(n * 1e5) / 1e3);        // a fraction as a % number
    let picAspect = '4x3';        // the shape of the picture on the face, once it has loaded

    function paintLook(hasPic) {
      const sign = signOf(cfg.style);
      const art = frameOf(cfg.frame);
      flag('sign', !!sign);
      flag('frameArt', !!art);
      flag('fit', !!(sign || art));
      if (sign) {
        const [vw, vh] = sign.viewBox;
        const [x, y, w, h] = sign.text;
        setVar('--nb-sign', `url("${sign.file}")`);
        setVar('--nb-sign-a', String(vw / vh));
        setVar('--nb-capw', String(CAPTION_SIGN_WIDTH));
        // Every inset as a share of the sign's WIDTH: the sign keeps its own proportions, so a
        // top inset of y units is y/vw of the width, and CSS can size all four from one length.
        setVar('--nb-tb-t', pct(y / vw)); setVar('--nb-tb-b', pct((vh - y - h) / vw));
        setVar('--nb-tb-l', pct(x / vw)); setVar('--nb-tb-r', pct((vw - x - w) / vw));
      } else {
        for (const k of ['--nb-sign', '--nb-sign-a', '--nb-capw', '--nb-tb-t', '--nb-tb-b', '--nb-tb-l', '--nb-tb-r']) setVar(k, null);
      }
      if (art) {
        const shape = hasPic ? picAspect : '4x3';
        const v = art.variants[shape];
        const [vw, vh] = v.viewBox;
        const [x, y, w, h] = v.window;
        faceEl.dataset.aspect = shape;
        setVar('--fr-art', `url("${v.file}")`);
        setVar('--fr-a', String(vw / vh));
        setVar('--fr-x', pct(x / vw)); setVar('--fr-y', pct(y / vh));
        setVar('--fr-w', pct(w / vw)); setVar('--fr-h', pct(h / vh));
        // The caption's height as a share of the frame's width, so the face can size the two
        // together: a sign caption is CAPTION_SIGN_WIDTH of the frame wide at the sign's own
        // proportions; plain words get CAPTION_LINE.
        const cap = !hasPic || !cfg.label ? 0
          : sign ? CAPTION_SIGN_WIDTH * sign.viewBox[1] / sign.viewBox[0] : CAPTION_LINE;
        setVar('--nb-cap', String(cap));
      } else {
        delete faceEl.dataset.aspect;
        for (const k of ['--fr-art', '--fr-a', '--fr-x', '--fr-y', '--fr-w', '--fr-h', '--nb-cap']) setVar(k, null);
      }
    }

    // ------------------------------------------------------------------------------------
    // FITTING THE WORDS. A name is two letters or thirty; no single font size is right for both,
    // and CSS cannot measure text. So the words start at the look's ceiling (Design's own sample
    // size on a sign; one line filling the box otherwise) and shrink until the text itself — the
    // glyphs, measured with a Range, not the element — fits inside the box. Words wrap at spaces
    // first; a single word too long even at the floor size is allowed to break, because a word
    // spilling off the sign is worse than a word split across two lines.
    // Runs after every paint, on resize, and once more when the fonts have arrived.
    // ------------------------------------------------------------------------------------
    function fitWords() {
      const w = faceEl?.querySelector('.ab-word');
      if (!w) return;
      if (!('fit' in faceEl.dataset)) {
        w.style.removeProperty('font-size'); w.style.removeProperty('overflow-wrap');
        return;
      }
      const cs = getComputedStyle(w);
      const px = (k) => parseFloat(cs[k]) || 0;
      // Fractional sizes (clientWidth/Height round to whole pixels, and a caption 33.7px tall
      // would then accept 34px of text).
      const outer = w.getBoundingClientRect();
      const boxW = outer.width - px('paddingLeft') - px('paddingRight');
      const boxH = outer.height - px('paddingTop') - px('paddingBottom');
      if (!(boxW > 1 && boxH > 1)) return;          // not laid out (hidden, or zero-sized)
      const sign = signOf(cfg.style);
      const ceiling = Math.max(FIT_FLOOR_PX, sign
        ? Math.min(boxH / FIT_LINE, sign.fontSize / sign.viewBox[1] * outer.height)
        : boxH / FIT_LINE);
      const range = document.createRange();
      range.selectNodeContents(w);
      const fits = (size) => {
        w.style.fontSize = `${size}px`;
        const r = range.getBoundingClientRect();
        return r.width <= boxW + 0.05 && r.height <= boxH + 0.05;
      };
      w.style.overflowWrap = 'normal';
      if (fits(ceiling)) return;
      let lo = FIT_FLOOR_PX, hi = ceiling;
      for (let i = 0; i < 14 && hi - lo > 0.25; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      if (!fits(lo)) w.style.overflowWrap = 'anywhere';
    }

    function paint() {
      if (!faceEl) return;
      const src = effectiveSource();
      const ref = cfg.image && src ? { sourceId: src, path: cfg.image } : null;
      const words = cfg.label;
      // The accessible name is the words; a picture with no words is still named, never blank.
      faceEl.setAttribute('aria-label', words || (ref ? 'Picture' : 'Button'));
      faceEl.dataset.style = cfg.style;
      faceEl.dataset.frame = cfg.frame;
      flag('inkChosen', cfg.inkChosen);
      faceEl.style.setProperty('--nb-ink', cfg.color);
      faceEl.style.setProperty('--nb-bg', cfg.background);
      faceEl.style.setProperty('--nb-font', fontStack(cfg.font));
      const key = JSON.stringify([words, ref]);
      if (key !== faceKey) {
        faceKey = key;
        picAspect = '4x3';
        images.releaseAll();
        faceEl.innerHTML = cardFaceHTML({ word: words, image: !!ref });
        if (ref) faceEl.dataset.hasImg = '';
        else delete faceEl.dataset.hasImg;
        if (!words) faceEl.querySelector('.ab-word')?.remove();
        // The word beside a picture names it, so the image is decoration (alt ''); a picture with
        // no words carries the name itself.
        if (ref) {
          const mine = key;
          images.load(faceEl, ref, { alt: words ? '' : 'Picture' }).then((ok) => {
            const img = ok && faceKey === mine && faceEl?.querySelector('.ab-img img');
            if (!img) return;
            const shape = () => {
              if (torn || faceKey !== mine) return;
              picAspect = aspectVariant(img.naturalWidth, img.naturalHeight);
              paintLook(true);
              fitWords();
            };
            if (img.complete && img.naturalWidth) shape();
            else img.addEventListener('load', shape, { once: true });
          });
        }
      }
      paintLook(!!ref);
      fitWords();
    }

    function apply(row) {
      cfg = configFrom(row || {});
      const src = effectiveSource();
      const known = knownSources.find((s) => s.id === src);
      if (known && !namesBySource.has(src)) listNames(known).then(() => { if (!torn) paint(); });
      paint();
    }

    // THE ONE PLACE A PRESS HAPPENS. A click and the `select` verb both end here.
    function press() {
      if (torn || !faceEl) return false;
      faceEl.classList.add('nbtn-press');
      if (pressTimer != null) clearTimer(pressTimer);
      pressTimer = setTimer(() => { pressTimer = null; faceEl?.classList.remove('nbtn-press'); }, 180);
      if (cfg.whenPressed === 'say' && cfg.label.trim()) {
        // `say`, never `notify` — see the header. It speaks in the room.
        try {
          if (ctx.output?.say) ctx.output.say(cfg.label, { source: 'button' });
          else speak(cfg.label);
        } catch (err) { console.error('button: say', err); }
      }
      return true;
    }

    return {
      init() {
        mount.innerHTML = `<div class="nbtn-wrap" data-nbtn>
            <button type="button" class="nbtn" data-face></button>
          </div>`;
        faceEl = mount.querySelector('[data-face]');
        faceEl.addEventListener('click', () => press());
        // The verb. Through `ctx.bus` it answers on the bare topic AND this instance's own scoped
        // alias (bus.js `scope`), which is the one the router publishes to.
        ctx.bus?.subscribe?.('button/select', () => press());
        apply(state?.get?.() || {});
        state?.subscribe?.((row) => apply(row));
        listSources();
        // Refit when the panel changes size (a composer drag, a layout change) and once the
        // fonts have arrived — a fallback font's widths are not the real one's.
        if (typeof ResizeObserver === 'function') {
          resizeObs = new ResizeObserver(() => { if (!torn) fitWords(); });
          resizeObs.observe(mount.querySelector('[data-nbtn]'));
        }
        document.fonts?.ready?.then(() => { if (!torn) fitWords(); });
      },
      onResize() { fitWords(); },
      onHide() {},
      destroy() {
        torn = true;
        resizeObs?.disconnect(); resizeObs = null;
        if (pressTimer != null) { clearTimer(pressTimer); pressTimer = null; }
        images.releaseAll();
        mount.innerHTML = '';
        faceEl = null;
      },

      // LIVE OPTIONS for the menu: the sources, the pictures in the one in use, and the words'
      // colours in the walk order for THIS look (`inkOrder`: what reads first, what vanishes last).
      settingsChoices: () => ({
        imageFrom: knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
        image: [{ value: '', label: 'No picture' },
          ...(namesBySource.get(effectiveSource()) || []).map((n) => ({ value: n.path, label: n.name }))],
        color: inkOrder(cfg.style, cfg.background),
      }),
    };
  },
);
