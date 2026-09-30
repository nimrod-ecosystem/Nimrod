// subtitles.js — SUBTITLES MODE: what is said near the screen, written on it.
//
// Row 2.42. Mike, 2026-09-30: *"For the voice there should be a subtitles mode where it puts
// everything on screen."* And later the same day: subtitles is a MODE, not always on; people who
// set themselves up are named, everybody else is "Unknown" or "Unsure" - and *"My worry is that it
// won't always pick her up as her so some things will be missed."*
//
// ---------------------------------------------------------------------------------------
// *** THE ONE RULE THIS FILE EXISTS TO KEEP: A LINE IS NEVER DROPPED BECAUSE OF WHO SAID IT. ***
// ---------------------------------------------------------------------------------------
//
// The TEXT and the SPEAKER are separate fields, and only the text decides whether a line is shown.
// A speaker match that is unsure changes the LABEL ("Unsure (maybe Alex)"), never the line. A
// speaker match that is missing, broken, or names somebody who never set themselves up is
// "Unknown" - and the words are still on screen. The only things that keep a line off the screen
// are: the mode is off, or there are no words at all.
//
//     line = { text, source, speaker?: { name, confidence, via } }
//
//   source   where the words came from: 'screen' (the site said it, through the output bus),
//            'room' (the recogniser heard the room microphone), 'phone' (a phone joined as a
//            microphone, phone_mic.js). Informational; it never filters.
//   speaker  a GUESS about who. Absent is normal - NO SPEAKER IDENTIFICATION ENGINE EXISTS YET.
//            This is the seam one plugs into. See `speakerLabel` for the display rule.
//
// WHAT IDENTIFICATION WOULD NEED (not built; for Mike's list): an enrolment step where a person
// who wants to be named records a few sentences (voice recording is row 2.44, OFF by default); a
// speaker-embedding model run locally on each utterance (the Cici pipeline already does voice
// identification offline in `cici_server.py` - that is the one to port, not a new one); and the
// audio of the utterance ALONGSIDE the recogniser's text, which the browser's recogniser does not
// give (it hands back text only). So identification arrives with a local recogniser that owns the
// audio (Vosk/whisper on a stream), not before.
//
// ---------------------------------------------------------------------------------------
// WHAT ELSE IT IS, AND IS NOT
// ---------------------------------------------------------------------------------------
//
// * NOT the output bus's `screen` channel. That one (output_channels.js) is a banner stack: a
//   message routed to "On screen" shows for a few seconds, with no speaker and no history, and
//   only for what the SITE says. Subtitles is the room's words AND the site's, attributed, with a
//   few lines of history. The site's own speech reaches it by TAPPING the speech channel (`tap`),
//   so a sentence routed to "Spoken" is written as it is said - and nothing muted is written.
// * NON-MODAL. `pointer-events:none`, no focus, `role=log` + `aria-live=polite`. It can never take
//   a press, and there is no state here that only an input can leave: every line goes by itself.
// * IT KEEPS NO TRANSCRIPT WHEN IT IS OFF. Lines that arrive with the mode off are not stored, and
//   turning it off clears what is on screen. Recording is a separate decision (row 2.44).
// * IT STAYS OUT OF A GAME'S ANSWERS. Before each line it looks for anything marked as an answer
//   area (`[data-answer-area]`, plus the known answer rows below) and sits at the bottom, else the
//   top, else asks the host to make room (`dock`, see `placeSubtitles`).
//
// Colours are the theme's own `--on-dark` over `--letterbox` - the caption pairing talk.html
// already uses - so every theme is readable and no theme is hard-coded here (measured in
// dev/subtitles_test.html).
//
// ---------------------------------------------------------------------------------------
// *** SUBTITLES THAT REFINE (row 2.47). ***
// ---------------------------------------------------------------------------------------
//
// Mike, 2026-09-30: *"It starts with a faster guess. Gradually adding more refinement ... The words
// updating on the screen as they're corrected. Show lower confidence scores on words and other
// phrases ... Then you could scroll back up if you need to."* So `caption(c)` (fed by
// speech_engines.js's ranker) is keyed by the utterance: the fast guess makes a line, and every later
// pass REPLACES THAT LINE'S WORDS IN PLACE - the line does not move, nothing below it jumps, and a
// word that changed gets a brief highlight (none when motion is reduced). Around it:
//   * UNSURE WORDS ARE MARKED BY SHAPE, not colour alone: a dotted underline and italics
//     (`subs-low`), below the person's own threshold (`subtitlesLowAt`, "do not mark" is a choice).
//   * TWO EARS THAT DISAGREE SHOW BOTH (row 2.46): the surer ear's words, the other's underneath
//     ("Phone heard: ..."). A person can choose "only the surer one".
//   * SCROLL BACK: `earlier()` / `latest()` (and the two actions a switch can bind) page through what
//     was said since the mode came on - kept in memory only, cleared when the mode goes off, never
//     written anywhere. It goes back to the latest lines by itself (`backMs`), so it is never a state
//     only an input can leave.
//   * THE STAR WARS CRAWL is a STYLE (`subtitlesStyle: 'crawl'`); plain captions are the default,
//     because slanted, shrinking text is harder to read for low vision or tired eyes (chat's note on
//     2.47). With reduced motion the crawl is drawn plain.
//   * THE ONLINE ROUTE (`subtitlesRoute`) is a setting whose default is 'local'. Mike said "maybe"
//     to an online model for subtitle mode; nothing here turns it on. What 'online' means on the
//     kiosk: the browser's own recogniser (which sends the room's sound to the browser's maker) ALSO
//     writes lines, marked as online. It never drives a command.

import { FLASH_LIMIT_DEFAULT, normalizeFlashLimit, minFlashPeriodMs } from './flash_limit.js';

// How long a corrected word's outline lasts: subtitles.css `.subs-fixed { animation: subs-fix 1.2s }`.
// The two must agree (the suite reads the stylesheet and checks).
export const SUBS_FIX_MS = 1200;

export const SUBTITLE_SIZES = Object.freeze({
  large: 'clamp(24px, 4.4vmin, 64px)',
  larger: 'clamp(30px, 5.6vmin, 80px)',
  largest: 'clamp(36px, 7vmin, 96px)',
});

export const SUBTITLES_DEFAULTS = Object.freeze({
  // A MODE. Off until somebody turns it on (a profile can carry it ON; this file never does).
  on: false,
  // Lines on screen at once. Three reads as "what was just said" without becoming a wall of text.
  lines: 3,
  // How long a line stays. 15 s: long enough to read three lines at a slow pace; 0 keeps each
  // line until newer ones push it off. A guess - a setting.
  holdMs: 15000,
  size: 'large',
  // Write down what the screen itself says (the spoken prompts, the board's words).
  screen: true,
  // THE SPEAKER RULE'S TWO NUMBERS. At or above `sureAt` a match is named; from `maybeAt` up it is
  // "Unsure (maybe <name>)"; below, "Unknown". Guesses, because no engine exists to measure - so
  // they are settings, and the first real engine's numbers replace them.
  sureAt: 0.8,
  maybeAt: 0.4,
  // What the screen's own lines are labelled.
  screenLabel: 'Screen',
  // What a line the recogniser could not make out says, rather than vanishing.
  unclearText: '(not clear)',
  // Row 2.47. Plain captions; the crawl is a choice.
  style: 'plain',
  // Words below this confidence are marked as unsure. 0.6: in the desktop measurement (2026-09-30)
  // right words mostly came back at 0.7+ and the misheard single words ("Vogue" for "book", 0.28)
  // well below; 0 turns the marks off.
  lowAt: 0.6,
  // Two ears that disagree: show both (Mike: "reach consensus or show both"), or only the surer.
  ears: 'both',
  // Where the words come from for this mode: 'local' (the recognisers the person ranked) or 'online'
  // (also the browser's own). Local by default; the online route is NOT approved (Mike: "maybe").
  route: 'local',
  // Lines kept to scroll back through, while the mode is on. 200 lines is a long conversation and a
  // few tens of kilobytes; in memory only.
  history: 200,
  // Scrolled back, it returns to the latest lines by itself after this long with no further scroll.
  backMs: 20000,
});

export const SUBTITLE_STYLES = ['plain', 'crawl'];
export const SUBTITLE_ROUTES = ['local', 'online'];
export const SUBTITLE_EARS = ['both', 'surer'];

// Scroll back from a switch: two ordinary actions on the bus. Nothing binds them by default.
export const SUBTITLES_EARLIER_TOPIC = 'subtitles/earlier';
export const SUBTITLES_LATEST_TOPIC = 'subtitles/latest';
export const SUBTITLE_ACTIONS = [
  { id: 'subtitles/earlier', label: 'Subtitles: show earlier lines', topic: SUBTITLES_EARLIER_TOPIC, group: 'Spoken' },
  { id: 'subtitles/latest', label: 'Subtitles: back to the latest', topic: SUBTITLES_LATEST_TOPIC, group: 'Spoken' },
];

// The settings, for the host's menu. The person level: how this person wants the room shown.
export const SUBTITLES_FIELDS = [
  { key: 'subtitlesOn', label: 'Subtitles: write what is said on the screen', kind: 'toggle',
    default: SUBTITLES_DEFAULTS.on, level: 'standard',
    note: 'Words the screen hears and says, with who said them when it knows.' },
  { key: 'subtitlesLines', label: 'Subtitles: lines on screen', kind: 'number',
    default: SUBTITLES_DEFAULTS.lines, min: 1, max: 6, step: 1, level: 'standard' },
  { key: 'subtitlesHoldMs', label: 'Subtitles: each line stays', kind: 'choice',
    default: SUBTITLES_DEFAULTS.holdMs, level: 'standard',
    options: [
      { value: 8000, label: '8 seconds' },
      { value: 15000, label: '15 seconds' },
      { value: 30000, label: '30 seconds' },
      { value: 0, label: 'until newer lines replace it' },
    ] },
  { key: 'subtitlesSize', label: 'Subtitles: text size', kind: 'choice',
    default: SUBTITLES_DEFAULTS.size, level: 'standard',
    options: [
      { value: 'large', label: 'Large' },
      { value: 'larger', label: 'Larger' },
      { value: 'largest', label: 'Largest' },
    ] },
  { key: 'subtitlesScreen', label: 'Subtitles: include what the screen itself says', kind: 'toggle',
    default: SUBTITLES_DEFAULTS.screen, level: 'advanced' },
  { key: 'subtitlesSureAt', label: 'Subtitles: how sure before a name is shown plainly', kind: 'choice',
    default: SUBTITLES_DEFAULTS.sureAt, level: 'advanced',
    options: [
      { value: 0.6, label: 'fairly sure' },
      { value: 0.8, label: 'sure' },
      { value: 0.9, label: 'very sure' },
    ] },
  { key: 'subtitlesStyle', label: 'Subtitles: style', kind: 'choice',
    default: SUBTITLES_DEFAULTS.style, level: 'standard',
    options: [
      { value: 'plain', label: 'Plain captions' },
      { value: 'crawl', label: 'A crawl, like the start of a space film' },
    ],
    note: 'The crawl slants and shrinks older lines; plain is easier to read.' },
  { key: 'subtitlesLowAt', label: 'Subtitles: mark words it is unsure of', kind: 'choice',
    default: SUBTITLES_DEFAULTS.lowAt, level: 'standard',
    options: [
      { value: 0, label: 'Do not mark' },
      { value: 0.4, label: 'Only very unsure words' },
      { value: 0.6, label: 'Unsure words' },
      { value: 0.8, label: 'Anything it is not sure of' },
    ],
    note: 'Marked with a dotted underline, and corrected in place when a better check hears it.' },
  { key: 'subtitlesEars', label: 'Subtitles: when two microphones hear different words', kind: 'choice',
    default: SUBTITLES_DEFAULTS.ears, level: 'advanced',
    options: [
      { value: 'both', label: 'Show both' },
      { value: 'surer', label: 'Show only the surer one' },
    ] },
  { key: 'subtitlesRoute', label: 'Subtitles: what writes the words down', kind: 'choice',
    default: SUBTITLES_DEFAULTS.route, level: 'advanced',
    options: [
      { value: 'local', label: 'The recognisers chosen for spoken commands (the room’s sound stays where they are)' },
      { value: 'online', label: 'Also an online recogniser (sends the room’s sound to the browser’s maker)' },
    ],
    note: 'Online: tell everyone in the room first. Anything said near the screen is sent.' },
];

/** A settings row -> this file's options. Each unset or broken key is its default. */
export function subtitlesOptionsFrom(values = {}) {
  const v = values || {};
  const num = (x, lo, hi, d) => {
    const n = Number(x);
    return x !== null && x !== '' && typeof x !== 'boolean' && Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  };
  return {
    on: typeof v.subtitlesOn === 'boolean' ? v.subtitlesOn : SUBTITLES_DEFAULTS.on,
    lines: Math.round(num(v.subtitlesLines, 1, 6, SUBTITLES_DEFAULTS.lines)),
    holdMs: num(v.subtitlesHoldMs, 0, 600000, SUBTITLES_DEFAULTS.holdMs),
    size: SUBTITLE_SIZES[v.subtitlesSize] ? v.subtitlesSize : SUBTITLES_DEFAULTS.size,
    screen: typeof v.subtitlesScreen === 'boolean' ? v.subtitlesScreen : SUBTITLES_DEFAULTS.screen,
    sureAt: num(v.subtitlesSureAt, 0.01, 1, SUBTITLES_DEFAULTS.sureAt),
    style: SUBTITLE_STYLES.includes(v.subtitlesStyle) ? v.subtitlesStyle : SUBTITLES_DEFAULTS.style,
    lowAt: num(v.subtitlesLowAt, 0, 1, SUBTITLES_DEFAULTS.lowAt),
    ears: SUBTITLE_EARS.includes(v.subtitlesEars) ? v.subtitlesEars : SUBTITLES_DEFAULTS.ears,
    // Only the exact string 'online' is online. Anything else - missing, broken, a typo - is local.
    route: v.subtitlesRoute === 'online' ? 'online' : 'local',
    history: SUBTITLES_DEFAULTS.history,
    backMs: SUBTITLES_DEFAULTS.backMs,
  };
}

/** How a caption's ear is named when two ears disagree. */
export function earLabel(ear) {
  const e = String(ear || '');
  if (e.startsWith('phone')) return 'Phone';
  if (e === 'room') return 'Room microphone';
  if (e === 'online') return 'Online';
  return 'Other microphone';
}

/**
 * The words of a caption as display pieces: { w, low, changed }. `low` when the word's confidence is
 * under `lowAt` (never when lowAt is 0 or the word has no confidence - a missing number is not
 * evidence of doubt); `changed` when the word differs from the one at the same position before.
 * Pure. Falls back to the plain text's words when the engine gave none.
 */
export function captionPieces(c, { lowAt = SUBTITLES_DEFAULTS.lowAt, before = null } = {}) {
  const ws = Array.isArray(c?.words) && c.words.length
    ? c.words.map((x) => ({ w: String(x?.w ?? x?.word ?? '').trim(), conf: x?.conf ?? x?.confidence }))
      .filter((x) => x.w)
    : String(c?.text || '').split(/\s+/).filter(Boolean).map((w) => ({ w, conf: null }));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9']+/g, '');
  const prev = Array.isArray(before) ? before.map((p) => norm(p.w ?? p)) : null;
  return ws.map((x, i) => {
    const n = Number(x.conf);
    const low = lowAt > 0 && x.conf != null && x.conf !== '' && Number.isFinite(n) && n < lowAt;
    return { w: x.w, low, changed: !!prev && prev[i] !== norm(x.w) };
  });
}

// The answer rows of the games that exist today, so the rule works before every game marks
// itself. A new game should mark its answers with `data-answer-area` rather than grow this list.
export const ANSWER_AREA_SELECTORS = Object.freeze([
  '[data-answer-area]', '.choice-card', '.tv-opts', '.wf-opts', '.l-tq-opts', '.wg-btns',
]);

/**
 * *** THE SPEAKER DISPLAY RULE. *** Pure, so the rule has one home and a test.
 *
 *   speaker absent / no name / garbage          -> Unknown
 *   speaker.self                                -> the screen's own label
 *   a name that is not one of `enrolled`        -> Unknown (only people who set themselves up
 *                                                  are ever named; `enrolled` null = no list kept)
 *   confidence >= sureAt                        -> the name
 *   maybeAt <= confidence < sureAt              -> Unsure (maybe <name>)
 *   a name with no usable confidence            -> Unsure (maybe <name>): naming somebody plainly
 *                                                  needs a number that says so
 *   confidence < maybeAt                        -> Unknown
 *
 * Returns { kind: 'named'|'unsure'|'unknown'|'screen', label, name }. Whatever it returns, the
 * line it labels is shown - that decision is not made here.
 */
export function speakerLabel(speaker, {
  sureAt = SUBTITLES_DEFAULTS.sureAt,
  maybeAt = SUBTITLES_DEFAULTS.maybeAt,
  enrolled = null,
  screenLabel = SUBTITLES_DEFAULTS.screenLabel,
} = {}) {
  const unknown = { kind: 'unknown', label: 'Unknown', name: null };
  if (!speaker || typeof speaker !== 'object') return unknown;
  if (speaker.self) return { kind: 'screen', label: String(screenLabel || 'Screen'), name: null };
  const name = typeof speaker.name === 'string' ? speaker.name.trim() : '';
  if (!name) return unknown;
  if (Array.isArray(enrolled)) {
    const known = enrolled.some((e) => String(e || '').trim().toLowerCase() === name.toLowerCase());
    if (!known) return unknown;
  }
  const raw = speaker.confidence;
  const c = raw === null || raw === undefined || raw === '' || typeof raw === 'boolean' ? NaN : Number(raw);
  if (Number.isFinite(c) && c >= sureAt) return { kind: 'named', label: name, name };
  if (!Number.isFinite(c) || c >= maybeAt) return { kind: 'unsure', label: `Unsure (maybe ${name})`, name };
  return unknown;
}

/**
 * A guess from WHERE the words came from: a phone that is usually with one person (phone_mic.js's
 * `from.near`) makes that person likely, never certain. Half confidence, so it always shows as
 * "Unsure (maybe <name>)" under the default rule - which is exactly Mike's worry answered: the
 * words are on screen, and the name is marked as a guess.
 */
export function devicePrior(from, confidence = 0.5) {
  const near = from && typeof from.near === 'string' ? from.near.trim() : '';
  return near ? { name: near, confidence, via: 'device' } : null;
}

/**
 * WHERE THE LINES GO. Pure. `avoid` is a list of rects ({top, bottom, width, height}) that must
 * not be covered - a game's answers. The box spans the width, so only vertical overlap counts.
 *   'bottom'  the usual caption position, when it covers nothing marked
 *   'top'     when the bottom would cover an answer
 *   'dock'    when both would: the host is asked to make room (`--subtitles-reserve` on the root)
 */
export function placeSubtitles({ viewportH = 0, boxH = 0, margin = 12, avoid = [] } = {}) {
  const hits = (top, bottom) => (avoid || []).some((r) => r && r.width > 0 && r.height > 0
    && r.bottom > top && r.top < bottom);
  if (!hits(viewportH - margin - boxH, viewportH - margin)) return 'bottom';
  if (!hits(margin, margin + boxH)) return 'top';
  return 'dock';
}

function ensureStyles(doc) {
  if (!doc || doc.querySelector('link[data-subtitles-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./subtitles.css', import.meta.url).href;
    link.setAttribute('data-subtitles-css', '');
    doc.head.append(link);
  } catch { /* a page with no head still gets working, unstyled subtitles */ }
}

const prefersStill = (view) => {
  try { return !!view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
};

/**
 * THE SUBTITLES. Mounted once into `host` (the screen's root, so it wears the screen's theme).
 *
 *   add(line)        show a line (returns the stored line, or null when off / no words)
 *   caption(c)       a recogniser pass (speech_engines.js): a new line, or the SAME line corrected
 *   earlier(n) / latest()   scroll back through what was said since the mode came on, and return
 *   heard(h, extra)  the adapter for input_speech.js's `onHeard` - what the recogniser wrote down
 *   tap(adapter)     wrap an output channel (the speech one) so what the screen says is written
 *   setOn(bool)      the mode; off clears the screen and keeps nothing
 *   update(values)   a settings row (SUBTITLES_FIELDS) changed
 */
export function createSubtitles(host, {
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  view = doc?.defaultView || (typeof window !== 'undefined' ? window : null),
  settings = {},
  enrolled = null,            // names of the people who set themselves up, or null
  boardSpeaker = null,        // () => ({ name }) — whose words the AAC board speaks
  aacSources = ['board'],     // the output bus sources that are a person talking through a board
  reducedMotion = null,       // null = follow the system setting
  avoidSelectors = ANSWER_AREA_SELECTORS,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  flashLimit = FLASH_LIMIT_DEFAULT,   // the screen's flash limit (flash_limit.js): a number or a getter
} = {}) {
  if (!host || !doc) throw new Error('createSubtitles: a host element is required');
  const limitNow = () => {
    try { return normalizeFlashLimit(typeof flashLimit === 'function' ? flashLimit() : flashLimit); }
    catch { return FLASH_LIMIT_DEFAULT; }
  };
  ensureStyles(doc);
  let opts = subtitlesOptionsFrom(settings);
  let seq = 0;
  let lines = [];                          // { id, at, text, source, speaker, who, el, timer, cid, pieces, others, ... }
  let hist = [];                           // every line since the mode came on (the same objects), for scroll back
  let back = 0;                            // lines scrolled back from the latest; 0 = live
  let backTimer = null;

  const box = doc.createElement('div');
  box.className = 'subs';
  box.hidden = true;
  box.setAttribute('role', 'log');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-label', 'Subtitles');
  box.dataset.place = 'bottom';
  host.append(box);
  // The scroll-back view: drawn in its own container, so the live lines (and their timers) are never
  // touched by looking back. In the box only while looking back.
  const histEl = doc.createElement('div');
  histEl.className = 'subs-hist';

  function applyLook() {
    box.style.setProperty('--subs-size', SUBTITLE_SIZES[opts.size] || SUBTITLE_SIZES.large);
    const still = reducedMotion == null ? prefersStill(view) : !!reducedMotion;
    box.classList.toggle('subs-still', still);
    // The crawl is motion: with reduced motion it is drawn as plain captions.
    box.classList.toggle('subs-crawl', opts.style === 'crawl' && !still);
    box.dataset.style = opts.style;
  }
  applyLook();

  const root = doc.documentElement;
  function setReserve(px) {
    try {
      if (px > 0) root.style.setProperty('--subtitles-reserve', `${Math.ceil(px)}px`);
      else root.style.removeProperty('--subtitles-reserve');
    } catch { /* no root style: nothing to reserve */ }
  }

  function avoidRects() {
    const out = [];
    for (const sel of avoidSelectors || []) {
      let found = [];
      try { found = [...doc.querySelectorAll(sel)]; } catch { found = []; }
      for (const el of found) {
        if (box.contains(el)) continue;
        try { out.push(el.getBoundingClientRect()); } catch { /* detached */ }
      }
    }
    return out;
  }

  function place() {
    if (box.hidden) { setReserve(0); return box.dataset.place; }
    const vh = Number(view?.innerHeight) || Number(root?.clientHeight) || 0;
    const where = placeSubtitles({ viewportH: vh, boxH: box.offsetHeight || 0, avoid: avoidRects() });
    box.dataset.place = where;
    setReserve(where === 'dock' ? (box.offsetHeight || 0) + 12 : 0);
    return where;
  }

  function drop(line) {
    if (line.timer != null) { try { clearTimer(line.timer); } catch { /* gone */ } line.timer = null; }
    line.el?.remove();
    line.el = null;
    lines = lines.filter((l) => l !== line);
    if (!lines.length && !back) box.hidden = true;
    place();
  }

  // *** OUTLINE: ONE FLASH PER FLASH PERIOD, NOT ONE PER RECOGNISER PASS. *** (Photosensitivity
  // audit, 2026-09-30.) A corrected word gets a brief outline (subtitles.css `subs-fixed`, 1.2 s).
  // A recogniser can correct a line several times a second, and every redraw RESTARTED the outline
  // - a new flash each pass. Now a new outline starts only when `minFlashPeriodMs(flashLimit)` has
  // passed since the last one began on that line (339 ms at 3, 1017 ms at 1). A correction inside
  // that window is outlined at the RUNNING outline's phase (a negative animation-delay), so the word
  // is still marked and nothing restarts. Which words are outlined is unchanged (the ones this pass
  // changed); the words themselves are corrected at once either way.
  function outlineFor(line) {
    const words = new Set((line.pieces || []).map((pc, i) => (pc.changed ? i : -1)).filter((i) => i >= 0));
    if (!words.size) return { words, intoMs: 0 };
    const t = now();
    const since = line.fixAt == null ? Infinity : t - line.fixAt;
    if (since < minFlashPeriodMs(limitNow())) return { words, intoMs: since };
    line.fixAt = t;
    line.fixCount = (line.fixCount || 0) + 1;
    return { words, intoMs: 0 };
  }

  // The inside of a line: who, the words (unsure ones marked), and what another ear heard.
  function fill(p, line, { fresh = false } = {}) {
    p.className = `subs-line subs-${line.who.kind}${line.partial ? ' subs-partial' : ''}`
      + `${line.agreed ? ' subs-agreed' : ''}${line.revised ? ' subs-revised' : ''}`;
    if (line.cid) p.dataset.caption = line.cid;
    p.textContent = '';
    const who = doc.createElement('span');
    who.className = 'subs-who';
    who.textContent = `${line.who.label}:`;
    const said = doc.createElement('span');
    said.className = 'subs-text';
    // The corrected-word outline, rate-limited (see OUTLINE, below): which words carry it on this
    // draw, and how far into its fade it already is (0 = a new outline, one flash onset).
    const fix = fresh ? null : outlineFor(line);
    if (line.pieces && line.pieces.length) {
      line.pieces.forEach((pc, i) => {
        if (i) said.append(' ');
        const fixed = !!fix && fix.words.has(i);
        if (!pc.low && !fixed) { said.append(pc.w); return; }
        const s = doc.createElement('span');
        s.className = `${pc.low ? 'subs-low' : ''}${fixed ? ' subs-fixed' : ''}`.trim();
        if (fixed && fix.intoMs > 0) s.style.animationDelay = `-${Math.round(fix.intoMs)}ms`;
        // The mark is also said in words, for a screen reader and for anybody who cannot see a
        // dotted line: "not sure".
        if (pc.low) s.title = 'not sure';
        s.textContent = pc.w;
        said.append(s);
      });
    } else said.textContent = line.text;
    p.append(who, ' ', said);
    for (const o of line.others || []) {
      const alt = doc.createElement('span');
      alt.className = 'subs-alt';
      alt.textContent = `${earLabel(o.ear)} heard: ${o.text}`;
      p.append(alt);
    }
    return p;
  }
  function render(line) { return fill(doc.createElement('p'), line, { fresh: true }); }

  function whoOf(speaker) {
    try {
      return speakerLabel(speaker, { sureAt: opts.sureAt, maybeAt: SUBTITLES_DEFAULTS.maybeAt,
                                     enrolled, screenLabel: SUBTITLES_DEFAULTS.screenLabel });
    } catch { return { kind: 'unknown', label: 'Unknown', name: null }; }
  }
  function arm(line) {
    if (line.timer != null) { try { clearTimer(line.timer); } catch { /* gone */ } line.timer = null; }
    if (opts.holdMs > 0) {
      try { line.timer = setTimer(() => { line.timer = null; drop(line); }, opts.holdMs); } catch { line.timer = null; }
    }
  }
  function remember(line) {
    hist.push(line);
    while (hist.length > opts.history) hist.shift();
    if (back) { back += 1; drawBack(); }       // looking back: the view stays on the same lines
  }
  function show(line) {
    line.el = render(line);
    box.insertBefore(line.el, histEl.parentNode === box ? histEl : null);
    lines.push(line);
    while (lines.length > opts.lines) drop(lines[0]);
    box.hidden = false;
    arm(line);
    remember(line);
    place();
  }
  const pub = (line) => ({ id: line.id, at: line.at, text: line.text, source: line.source, speaker: line.speaker,
                           who: { ...line.who }, ...(line.cid ? { caption: line.cid, partial: !!line.partial,
                           revised: !!line.revised, agreed: !!line.agreed, others: (line.others || []).map((o) => ({ ...o })),
                           low: (line.pieces || []).filter((x) => x.low).map((x) => x.w) } : {}) });

  function add(input = {}) {
    if (!opts.on) return null;                 // a mode that is off keeps nothing
    const raw = input && typeof input === 'object' ? input : { text: input };
    let text = String(raw.text == null ? '' : raw.text).trim();
    if (!text) return null;                    // no words: nothing to show
    if (text.toLowerCase() === '[unk]') text = SUBTITLES_DEFAULTS.unclearText;
    // THE SPEAKER IS LOOKED AT FOR THE LABEL ONLY. Nothing below this line can return null.
    const who = whoOf(raw.speaker);
    const line = { id: `s${++seq}`, at: now(), text, source: raw.source || null,
                   speaker: raw.speaker || null, who, el: null, timer: null };
    show(line);
    return pub(line);
  }

  /**
   * A recogniser pass (speech_engines.js's caption): { id, text, words, ear, partial, revised,
   * agreed, others, speaker? }. The first pass for an id makes a line; every later pass for the same
   * id CORRECTS THAT LINE IN PLACE - same element, same position - and its changed words flash once.
   * The same rule as `add`: only the words decide whether it shows; who said it is only the label.
   */
  function caption(c = {}) {
    if (!opts.on || !c || typeof c !== 'object') return null;
    const cid = String(c.id || '');
    let text = String(c.text == null ? '' : c.text).trim();
    const known = cid ? hist.find((l) => l.cid === cid) : null;
    if (!text && !known) return null;          // nothing heard yet, nothing to show
    if (text.toLowerCase() === '[unk]') text = SUBTITLES_DEFAULTS.unclearText;
    const others = opts.ears === 'both' && Array.isArray(c.others)
      ? c.others.filter((o) => o && String(o.text || '').trim()).map((o) => ({ ear: o.ear, text: String(o.text).trim(), confidence: o.confidence ?? null }))
      : [];
    if (known) {
      if (!text) return pub(known);            // a later pass heard nothing: keep what was shown
      const pieces = captionPieces({ ...c, text }, { lowAt: opts.lowAt, before: known.pieces });
      // THE SAME WORDS AGAIN (a pass confirming, or the line closing): nothing is redrawn, so a word
      // that was just corrected keeps its highlight and nothing on screen flickers.
      const sig = JSON.stringify([text, pieces.map((x) => [x.w, x.low]), others, !!c.partial, !!c.agreed]);
      if (sig === known.sig) return pub(known);
      known.sig = sig;
      const changedWords = known.text !== text;
      Object.assign(known, { text, pieces, others, partial: !!c.partial, agreed: !!c.agreed,
                             revised: known.revised || (!!c.revised && changedWords) });
      if (c.speaker) { known.speaker = c.speaker; known.who = whoOf(c.speaker); }
      if (known.el) { fill(known.el, known); arm(known); place(); }
      if (back) drawBack();
      return pub(known);
    }
    const line = { id: `s${++seq}`, at: now(), text, source: c.ear && String(c.ear).startsWith('phone') ? 'phone' : (c.source || 'room'),
                   speaker: c.speaker || null, who: whoOf(c.speaker), el: null, timer: null, cid: cid || null,
                   pieces: captionPieces({ ...c, text }, { lowAt: opts.lowAt }), others,
                   partial: !!c.partial, agreed: !!c.agreed, revised: false };
    line.sig = JSON.stringify([text, line.pieces.map((x) => [x.w, x.low]), others, line.partial, line.agreed]);
    show(line);
    return pub(line);
  }

  // ---- scroll back ------------------------------------------------------------------------
  function clearBackTimer() {
    if (backTimer !== null) { try { clearTimer(backTimer); } catch { /* gone */ } backTimer = null; }
  }
  function drawBack() {
    const end = Math.max(0, hist.length - back);
    const start = Math.max(0, end - opts.lines);
    histEl.textContent = '';
    const mark = doc.createElement('p');
    mark.className = 'subs-line subs-mark';
    mark.textContent = start > 0 ? `Earlier - ${back} line${back === 1 ? '' : 's'} back` : 'The start';
    histEl.append(mark);
    for (const l of hist.slice(start, end)) histEl.append(render(l));
    place();
  }
  function earlier(n = opts.lines) {
    if (!opts.on || !hist.length) return 0;
    const max = Math.max(0, hist.length - 1);
    back = Math.min(max, back + Math.max(1, Math.round(Number(n) || 1)));
    if (!back) return 0;
    box.classList.add('subs-back');
    if (histEl.parentNode !== box) box.append(histEl);
    box.hidden = false;
    drawBack();
    clearBackTimer();
    // NEVER A STATE ONLY AN INPUT CAN LEAVE: back to the latest lines by itself.
    if (opts.backMs > 0) {
      try { backTimer = setTimer(() => { backTimer = null; latest(); }, opts.backMs); } catch { backTimer = null; }
    }
    return back;
  }
  function latest() {
    clearBackTimer();
    back = 0;
    box.classList.remove('subs-back');
    histEl.remove();
    histEl.textContent = '';
    if (!lines.length) box.hidden = true;
    place();
    return 0;
  }

  function clear() { latest(); for (const l of [...lines]) drop(l); hist = []; }

  function speakerForItem(item) {
    const src = item && item.source;
    if (src && Array.isArray(aacSources) && aacSources.includes(src)) {
      // The board's words are a PERSON talking, and it is their board: named, with certainty.
      let who = null;
      try { who = typeof boardSpeaker === 'function' ? boardSpeaker() : boardSpeaker; } catch { who = null; }
      if (who && who.name) return { name: who.name, confidence: 1, via: 'board' };
      return null;                             // a board, but nobody named: "Unknown", still shown
    }
    return { self: true };
  }

  return {
    add,
    caption,
    earlier,
    latest,
    /** Lines scrolled back from the latest (0 = showing the latest). */
    scrolledBack: () => back,
    /** What was said since the mode came on (in memory only), oldest first. */
    history: () => hist.map(pub),
    clear,
    place,
    /** The adapter for input_speech.js's `onHeard`: everything the recogniser wrote down. */
    heard(h = {}, extra = {}) {
      const speaker = (h && h.speaker) || (extra && extra.speaker) || null;
      return add({ text: h && h.text, source: (extra && extra.source) || 'room', speaker });
    },
    /** Wrap an output channel adapter: what it presents is written as it is presented. */
    tap(adapter) {
      if (!adapter || typeof adapter.present !== 'function') return adapter;
      return {
        ...adapter,
        name: adapter.name,
        concurrency: adapter.concurrency,
        available: () => (typeof adapter.available === 'function' ? adapter.available() : true),
        present(item, ctx) {
          if (opts.screen) {
            try { add({ text: item && item.text, source: 'screen', speaker: speakerForItem(item) }); }
            catch (err) { console.error('subtitles: tap', err); }
          }
          return adapter.present(item, ctx);
        },
      };
    },
    setOn(on) {
      opts = { ...opts, on: !!on };
      if (!opts.on) clear();
      return opts.on;
    },
    isOn: () => opts.on,
    update(values = {}) {
      const was = opts.on;
      opts = subtitlesOptionsFrom(values);
      applyLook();
      if (was && !opts.on) clear();
      while (lines.length > opts.lines) drop(lines[0]);
      return { ...opts };
    },
    setReducedMotion(v) { reducedMotion = v == null ? null : !!v; applyLook(); },
    lines: () => lines.map(pub),
    options: () => ({ ...opts }),
    element: () => box,
    destroy() { clear(); setReserve(0); box.remove(); },
  };
}
