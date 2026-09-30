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
});

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
  };
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
} = {}) {
  if (!host || !doc) throw new Error('createSubtitles: a host element is required');
  ensureStyles(doc);
  let opts = subtitlesOptionsFrom(settings);
  let seq = 0;
  let lines = [];                          // { id, at, text, source, speaker, who, el, timer }

  const box = doc.createElement('div');
  box.className = 'subs';
  box.hidden = true;
  box.setAttribute('role', 'log');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-label', 'Subtitles');
  box.dataset.place = 'bottom';
  host.append(box);

  function applyLook() {
    box.style.setProperty('--subs-size', SUBTITLE_SIZES[opts.size] || SUBTITLE_SIZES.large);
    const still = reducedMotion == null ? prefersStill(view) : !!reducedMotion;
    box.classList.toggle('subs-still', still);
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
    lines = lines.filter((l) => l !== line);
    if (!lines.length) box.hidden = true;
    place();
  }

  function render(line) {
    const p = doc.createElement('p');
    p.className = `subs-line subs-${line.who.kind}`;
    const who = doc.createElement('span');
    who.className = 'subs-who';
    who.textContent = `${line.who.label}:`;
    const said = doc.createElement('span');
    said.className = 'subs-text';
    said.textContent = line.text;
    p.append(who, ' ', said);
    return p;
  }

  function add(input = {}) {
    if (!opts.on) return null;                 // a mode that is off keeps nothing
    const raw = input && typeof input === 'object' ? input : { text: input };
    let text = String(raw.text == null ? '' : raw.text).trim();
    if (!text) return null;                    // no words: nothing to show
    if (text.toLowerCase() === '[unk]') text = SUBTITLES_DEFAULTS.unclearText;
    // THE SPEAKER IS LOOKED AT FOR THE LABEL ONLY. Nothing below this line can return null.
    let who;
    try {
      who = speakerLabel(raw.speaker, { sureAt: opts.sureAt, maybeAt: SUBTITLES_DEFAULTS.maybeAt,
                                        enrolled, screenLabel: SUBTITLES_DEFAULTS.screenLabel });
    } catch { who = { kind: 'unknown', label: 'Unknown', name: null }; }
    const line = { id: `s${++seq}`, at: now(), text, source: raw.source || null,
                   speaker: raw.speaker || null, who, el: null, timer: null };
    line.el = render(line);
    box.append(line.el);
    lines.push(line);
    while (lines.length > opts.lines) drop(lines[0]);
    box.hidden = false;
    if (opts.holdMs > 0) {
      try { line.timer = setTimer(() => { line.timer = null; drop(line); }, opts.holdMs); } catch { line.timer = null; }
    }
    place();
    return { id: line.id, at: line.at, text: line.text, source: line.source, speaker: line.speaker, who: { ...who } };
  }

  function clear() { for (const l of [...lines]) drop(l); }

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
    lines: () => lines.map((l) => ({ id: l.id, at: l.at, text: l.text, source: l.source,
                                      speaker: l.speaker, who: { ...l.who } })),
    options: () => ({ ...opts }),
    element: () => box,
    destroy() { clear(); setReserve(0); box.remove(); },
  };
}
