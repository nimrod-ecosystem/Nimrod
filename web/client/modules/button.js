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
//   frame        none / picture frame / TV / monitor — SIMPLE CSS PLACEHOLDERS for now
//   font         a short list of fonts every device already has — nothing is downloaded
//   style        sign looks — SIMPLE CSS PLACEHOLDERS for now
//   color        the colour of the words (the menu's colour picker)
//   background   the colour behind them (the menu's colour picker)
//   whenPressed  "Nothing" by default, or "Say the words" through the output bus
//
// *** THE STYLES AND FRAMES ARE PLACEHOLDERS, AND SAY SO. *** Sign styles and frames are on
// Design's list (2026-09-29, alongside Nimrod the cat). What ships here is a few honest CSS
// treatments so the settings exist and can be walked; when the designed ones land they replace
// the CSS under the same stored values, and nobody's saved choice has to move.
//
// STORED AS MEANING, RENDERED PER SCREEN: `font` stores an id ('serif'), never a font stack, and
// `frame`/`style` store ids, never CSS — the house rule (content as meaning; the look is a render
// setting). The colours are the one exception, because a colour IS the meaning: a hex string,
// which is what the menu's `color` kind stores.
//
// NO COLOUR IS HARD-CODED IN CSS. The two chosen colours reach the stylesheet as custom properties
// set here; their defaults are palette entries read from `color_picker.js`, not literals; and every
// frame and style is drawn with theme tokens and `currentColor`.
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
import { DEFAULT_PALETTE } from '../color_picker.js';
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

// PLACEHOLDER LOOKS (see the header). Ids are what is stored; the CSS for each is in modules.css
// under "button".
export const STYLES = Object.freeze([
  { value: 'plain',  label: 'Plain' },
  { value: 'plaque', label: 'Plaque' },
  { value: 'banner', label: 'Banner' },
  { value: 'glow',   label: 'Glow' },
]);
export const FRAMES = Object.freeze([
  { value: 'none',    label: 'No frame' },
  { value: 'picture', label: 'Picture frame' },
  { value: 'tv',      label: 'TV' },
  { value: 'monitor', label: 'Computer monitor' },
]);
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
  { key: 'frame', label: 'Frame (simple look for now)', kind: 'choice', default: DEFAULTS.frame,
    level: 'essential', options: FRAMES.map(({ value, label }) => ({ value, label })) },
  { key: 'font', label: 'Font', kind: 'choice', default: DEFAULTS.font, level: 'essential',
    options: FONTS.map(({ value, label }) => ({ value, label })) },
  { key: 'color', label: 'Colour of the words', kind: 'color', default: DEFAULTS.color,
    level: 'essential', options: INK_PALETTE.map((c) => ({ ...c })) },
  { key: 'style', label: 'Sign style (simple look for now)', kind: 'choice', default: DEFAULTS.style,
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
    function paint() {
      if (!faceEl) return;
      const src = effectiveSource();
      const ref = cfg.image && src ? { sourceId: src, path: cfg.image } : null;
      const words = cfg.label;
      // The accessible name is the words; a picture with no words is still named, never blank.
      faceEl.setAttribute('aria-label', words || (ref ? 'Picture' : 'Button'));
      faceEl.dataset.style = cfg.style;
      faceEl.dataset.frame = cfg.frame;
      faceEl.style.setProperty('--nb-ink', cfg.color);
      faceEl.style.setProperty('--nb-bg', cfg.background);
      faceEl.style.setProperty('--nb-font', fontStack(cfg.font));
      const key = JSON.stringify([words, ref]);
      if (key === faceKey) return;
      faceKey = key;
      images.releaseAll();
      faceEl.innerHTML = cardFaceHTML({ word: words, image: !!ref });
      if (ref) faceEl.dataset.hasImg = '';
      else delete faceEl.dataset.hasImg;
      if (!words) faceEl.querySelector('.ab-word')?.remove();
      // The word beside a picture names it, so the image is decoration (alt ''); a picture with
      // no words carries the name itself.
      if (ref) images.load(faceEl, ref, { alt: words ? '' : 'Picture' });
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
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        if (pressTimer != null) { clearTimer(pressTimer); pressTimer = null; }
        images.releaseAll();
        mount.innerHTML = '';
        faceEl = null;
      },

      // LIVE OPTIONS for the menu: the sources, and the pictures in the one in use.
      settingsChoices: () => ({
        imageFrom: knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
        image: [{ value: '', label: 'No picture' },
          ...(namesBySource.get(effectiveSource()) || []).map((n) => ({ value: n.path, label: n.name }))],
      }),
    };
  },
);
