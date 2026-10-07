// clean_up.js — THE CLEAN UP DIAL, ported from Corpus Desk (row 2.54's correction, Mike via chat note AY, 2026-10-07).
//
// Mike: a summary already exists. Corpus Desk (the private tools folder's dictation desk) has a Clean up dial with ten
// levels, from word for word down to one line, and shows the cleaned text for approval before anything is kept. "Port
// that dial to the site; don't keep a new summariser." His reason: he talks casually, the summary is what goes to chat,
// so filler should not cost tokens — which means the cleaning happens on a model on HIS computer, before chat.
//
// WHAT IS PORTED, AND FROM WHERE (Corpus Desk server.py, CLEAN_LEVELS / _CLEAN_TAIL / _clean_level / ask_ollama;
// index.html, CLEAN_LEVEL_LABELS and the approval sheet):
//   * the ten prompts, one written instruction per level, NOT blended at request time. Five are Mike's own
//     definitions (1, 3, 5, 7, 10); 2, 4, 6, 8 and 9 were written to sit strictly between their neighbours. Corpus
//     Desk's reason, kept: a model asked to "interpolate between two paragraphs of instructions" writes mush; a
//     written, ordered scale gives it one clear job per level.
//   * the rule appended to all ten (CLEAN_TAIL): never add what was not said, never more formal than the speaker.
//   * the default, level 3 (TIDY), and the clamp: anything missing or unreadable is 3, out of range is 1 or 10.
//   * the shape of the call: a system line (the level + the rule) and one user message (context, then the note).
//     Context in Corpus Desk is the document being replied to; here it is where the note was made on the site.
//   * the approval: the cleaned words are shown beside the person's own, editable, with "Use this" and "Keep mine".
//     Nothing is kept until one is pressed (walkthrough_wrap.js keeps that step; modules/nimrod.js draws it).
//
// WHAT CHANGED IN THE PORT, each on purpose:
//   * "he"/"his" in the prompts became "they"/"their". Corpus Desk is Mike's own desk; the site is anybody's. The
//     meaning of every level is unchanged. "What this volley was about" (level 10) became "what this note was about".
//   * the labels shown are plain words ("Tidy", "Just the asks and decisions"); Corpus Desk's own names (VERBATIM,
//     TIDY, CONDENSED, KEY POINTS, ONE LINE) are kept as `deskName` so the two read side by side.
//   * the call goes through the site's own AI client (ai.js `chat`, or nimrod_ai.js's Claude client when somebody
//     chooses it) instead of Corpus Desk's Python server. Corpus Desk calls Ollama's own /api/chat with no options;
//     ai.js calls the OpenAI-shaped endpoint Ollama also serves. The prompt text is the same.
//   * no generation dials. Corpus Desk has an optional panel for Ollama's parameters (temperature and eleven more);
//     the site uses ai.js's defaults (CLEAN_TEMPERATURE below). The dial that matters, the level, is here.
//
// WHAT CORPUS DESK HAS THAT THE SITE ALREADY HAS (not duplicated): continuous dictation with Whisper. The site's speech
// layer (input_speech.js, speech_engines.js, and the local speech program in web/speech_service, which runs Whisper)
// already turns talk into notes, and modules/nimrod.js's dictation window keeps them; this file only cleans text.
//
// Pure apart from `cleanText`, which takes its AI client as an argument (a suite passes a fake; nothing here reaches
// any address by itself).

// ---------------------------------------------------------------------------------------------------
// THE TEN LEVELS. `prompt` is Corpus Desk's text with the pronoun change above; `label` is what a person sees.
// ---------------------------------------------------------------------------------------------------
export const CLEAN_TAIL = ' Never add anything they did not say. Never be more formal than they are: their vocabulary, '
  + 'their jokes and their profanity are the voice, not noise to launder out, even at the shortest levels. Return only '
  + 'the cleaned text, nothing else: no preamble, no "here is the cleaned version."';

export const CLEAN_LEVELS = Object.freeze([
  Object.freeze({ level: 1, deskName: 'VERBATIM', label: 'Word for word',
    help: 'Only the mistakes of turning talk into text are fixed: words run together, missing full stops, a word misheard. Every um and false start stays.',
    prompt: 'You are cleaning up a voice-dictated note. Fix ONLY transcription noise: run-together words, missing '
      + 'punctuation, obvious mishearings. Do not remove anything else: every filler, false start, self-correction and '
      + 'repeat stays exactly where it was. This is the transcript as spoken, just legible.' }),
  Object.freeze({ level: 2, deskName: 'verbatim → tidy', label: 'Word for word, without the ums',
    help: 'As word for word, and the empty sounds (um, uh, like) go. False starts and repeats stay.',
    prompt: 'You are cleaning up a voice-dictated note. Fix transcription noise (run-together words, missing '
      + 'punctuation, obvious mishearings) AND strip pure verbal filler sounds ("um", "uh", "like" used as a filler) '
      + 'with nothing behind them. Leave false starts, self-corrections and repeats untouched: those are still '
      + 'information at this level, only the meaningless sounds around them are gone.' }),
  Object.freeze({ level: 3, deskName: 'TIDY', label: 'Tidy',
    help: 'Everything you said, said well: ums, false starts and repeats gone, every idea kept, in your order.',
    prompt: 'You are cleaning up a voice-dictated note so it reads clearly, said well. Remove fillers, false starts, '
      + 'self-corrections and repeats, but every IDEA they expressed must still be in the output; nothing they said '
      + 'gets dropped, only the noise around it. Keep uncertainty ("I\'m not sure whether...") because that is '
      + 'information, not noise. Keep the order they said things in. THE TEST: they read this and find EVERYTHING '
      + 'they said, and are willing to send it as-is. Something missing is a failure at this level, and so is '
      + 'sounding like a memo.' }),
  Object.freeze({ level: 4, deskName: 'tidy → condensed', label: 'Tidy, a little shorter',
    help: 'As tidy, and a point said twice in a row is said once.',
    prompt: 'You are cleaning up a voice-dictated note. Do everything level 3 does (fillers, false starts, '
      + 'self-corrections and repeats removed; every idea kept; uncertainty kept; order kept) AND ALSO lightly tighten '
      + 'the wording: merge a phrase that immediately restates the same point in slightly different words, tighten a '
      + 'sentence that rambles to say the same thing shorter. Still essentially everything they said, just a little '
      + 'more compact.' }),
  Object.freeze({ level: 5, deskName: 'CONDENSED', label: 'Shorter',
    help: 'Every point kept, in fewer words. Side remarks may be folded into the point they were about.',
    prompt: 'You are condensing a voice-dictated note. Keep every point they made, but tighten it: say the same '
      + 'things in fewer words. Asides and side comments may be merged into the point they were supporting rather '
      + 'than kept as separate sentences. This should read shorter than a level-3 cleanup of the same note, while '
      + 'still containing every point.' }),
  Object.freeze({ level: 6, deskName: 'condensed → key points', label: 'Shorter still',
    help: 'Every ask and decision, with enough of the why to make sense. Side remarks that change nothing go.',
    prompt: 'You are condensing a voice-dictated note further. Keep every ASK and DECISION, and keep enough of the '
      + 'reasoning behind each one that it still makes sense on its own, but drop a side comment or passing aside if '
      + 'removing it changes nothing about what they are asking for or deciding. Say what remains as compactly as it '
      + 'reads naturally.' }),
  Object.freeze({ level: 7, deskName: 'KEY POINTS', label: 'Just the asks and decisions',
    help: 'Only what you want done, what you decided, and what you need answered. Thinking out loud goes.',
    prompt: 'You are extracting the key points from a voice-dictated note. Keep ONLY the actual asks and decisions: '
      + 'what they want done, what they decided, what they need answered. Drop all thinking-aloud, all '
      + 'reasoning-it-through-out-loud, all context that is not itself an ask or a decision. What is left should read '
      + 'as a short, direct list or a few short sentences of exactly what to act on.' }),
  Object.freeze({ level: 8, deskName: 'key points → one line', label: 'The asks, as short as they go',
    help: 'The asks and decisions in the fewest words that are still clear. Close ones may share a line.',
    prompt: 'You are extracting the key points from a voice-dictated note, tighter than a normal key-points pass. '
      + 'Keep only the asks and decisions, stated as tersely as they can be while still being clear on their own: '
      + 'short phrases or short sentences, most connecting explanation gone. If two asks are closely related, they may '
      + 'be combined into one line.' }),
  Object.freeze({ level: 9, deskName: 'nearly one line', label: 'Two or three lines',
    help: 'What it was about, and what you want done, in two or three short lines.',
    prompt: 'You are summarising a voice-dictated note in a very few words. Two or three short lines at most, '
      + 'capturing the actual gist of what this was about and what (if anything) they want done: not yet a single '
      + 'line, but close to it.' }),
  Object.freeze({ level: 10, deskName: 'ONE LINE', label: 'One line',
    help: 'What the note was about, in one line, in your own words as far as one line allows.',
    prompt: 'You are summarising a voice-dictated note in ONE LINE: what this note was about, in their own words as '
      + 'far as that is possible in one line. Nothing else.' }),
]);

// Corpus Desk's default (its README and server.py: "3, TIDY, the documented default"). A DEFAULT, argued there and
// kept: it is the level that drops the noise and nothing that was said. A person moves the dial; this device
// remembers where they left it (CLEAN_LEVEL_KEY), as Corpus Desk's page does in its own browser.
export const DEFAULT_CLEAN_LEVEL = 3;
export const CLEAN_LEVEL_KEY = 'nimrod.clean.level';

// HARD-CODED VALUES, each argued:
//   CLEAN_TEMPERATURE 0.2: ai.js's own default for a careful job. Corpus Desk sends none (Ollama's own, about 0.8 for
//     most models) unless its tuning panel is used; lower suits "change as little as the level says". Against: a
//     model at 0.2 can repeat a phrase it should have cut. Not a setting: nobody has asked to tune it here.
//   CLEAN_CONTEXT_MAX 600: the "where this note was made" line, cut. Corpus Desk sends up to 6,000 characters of the
//     document being replied to; a note's place on the site is one line, so 600 is generous.
//   CLEAN_TOKENS_MIN 200 / CLEAN_TOKENS_MAX 1000: how long the cleaned answer may be. Level 1 gives back about as
//     many words as it was given, so the cap follows the note's length (a character is about a quarter of a token;
//     a third, for room). 1000 is just under the Claude door's own ceiling (web/server/claude_ai.py, 1,024), so a
//     person who chooses Claude is not cut short by the server. A note longer than about 3,000 characters may come
//     back cut at level 1 or 2; the person sees it beside their own words and can keep theirs.
export const CLEAN_TEMPERATURE = 0.2;
export const CLEAN_CONTEXT_MAX = 600;
export const CLEAN_TOKENS_MIN = 200;
export const CLEAN_TOKENS_MAX = 1000;

/** A level 1-10: anything unreadable is the default (3), anything out of range the nearest end. Never throws. */
export function cleanLevel(raw) {
  if (raw == null || raw === '') return DEFAULT_CLEAN_LEVEL;
  const v = Math.round(Number(raw));
  if (!Number.isFinite(v)) return DEFAULT_CLEAN_LEVEL;
  return Math.max(1, Math.min(10, v));
}
export const levelInfo = (raw) => CLEAN_LEVELS[cleanLevel(raw) - 1];
/** "3 of 10: Tidy" — the dial's position, as shown. */
export const levelLine = (raw) => `${cleanLevel(raw)} of 10: ${levelInfo(raw).label}`;

/** This device's remembered level, or the default. Unreadable storage is the default, never a throw. */
export function readCleanLevel(storage = defaultStorage()) {
  let v = null;
  try { v = storage ? storage.getItem(CLEAN_LEVEL_KEY) : null; } catch { v = null; }
  return v == null ? DEFAULT_CLEAN_LEVEL : cleanLevel(v);
}
export function writeCleanLevel(raw, storage = defaultStorage()) {
  const v = cleanLevel(raw);
  try { storage?.setItem(CLEAN_LEVEL_KEY, String(v)); } catch { /* read-only storage */ }
  return v;
}
function defaultStorage() { try { return globalThis.localStorage || null; } catch { return null; } }

/** The answer size for one note (see CLEAN_TOKENS_*). */
export function cleanTokens(text) {
  const n = Math.ceil(String(text || '').length / 3) + 100;
  return Math.max(CLEAN_TOKENS_MIN, Math.min(CLEAN_TOKENS_MAX, n));
}

/**
 * The messages for one note: the only thing that decides what the model is sent. The level's instruction and the
 * shared rule; then where the note was made (if given), then the note's words.
 */
export function cleanMessages(text, { level = DEFAULT_CLEAN_LEVEL, context = '' } = {}) {
  const c = String(context || '').replace(/\s+/g, ' ').trim().slice(0, CLEAN_CONTEXT_MAX);
  return [
    { role: 'system', content: levelInfo(level).prompt + CLEAN_TAIL },
    { role: 'user', content: `${c ? `Where this note was made, for context only: ${c}\n\n---\n\n` : ''}`
      + `Clean up this note:\n\n${String(text || '').trim()}` },
  ];
}

/**
 * The model's words, tidied of the wrapping a model adds when told not to: a code fence around the whole answer, or
 * one opening line announcing it ("Here is the cleaned version:"). Nothing inside the text is touched.
 */
export function readCleaned(text) {
  let s = String(text ?? '').trim();
  const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(s);
  if (fence) s = fence[1].trim();
  const intro = /^(?:sure[,!.]?\s*)?here(?:'s| is)(?: the| your)? clean(?:ed)?(?:[- ]up)?(?: version| note| text)?(?: of [^:\n]*)?:\s*\n+/i.exec(s);
  if (intro) s = s.slice(intro[0].length).trim();
  return s;
}

/**
 * Clean one note. `ai` has ai.js's `chat(messages, opts)` (or the Claude client's). Never throws.
 * Resolves `{ ok: true, text, model }` or `{ ok: false, reason, cancelled? }`. An empty answer is a failure: the
 * person's own words are what is left, never an empty line.
 */
export async function cleanText(text, { ai, model = '', level = DEFAULT_CLEAN_LEVEL, context = '', signal } = {}) {
  const words = String(text || '').trim();
  if (!words) return { ok: false, reason: 'There are no words to clean up.' };
  if (!ai || typeof ai.chat !== 'function') return { ok: false, reason: 'No AI is connected.' };
  let r;
  try {
    r = await ai.chat(cleanMessages(words, { level, context }),
      { model, temperature: CLEAN_TEMPERATURE, maxTokens: cleanTokens(words), signal });
  } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
  if (r?.cancelled || signal?.aborted) return { ok: false, cancelled: true, reason: 'Stopped.' };
  if (!r?.ok) return { ok: false, reason: String(r?.reason || 'The AI did not answer.') };
  const out = readCleaned(r.text);
  if (!out) return { ok: false, reason: 'The AI gave back nothing.' };
  return { ok: true, text: out, model: r.model || model || '', ...(r.truncated ? { truncated: true } : {}) };
}
