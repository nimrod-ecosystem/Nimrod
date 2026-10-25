// story_ai.js — TALK WITH SOMEBODY IN TOWN, AND A FREE-FORM ADVENTURE. Pure pieces over ai.js, no page.
//
// Mike, 2026-10-12 (DECISIONS.md, newest section): *"It would be cool to have a conversation with people in the town
// and maybe even have little choose your own adventure stories. Preferably free form like D&D or something."*
// modules/adventure.js draws it; dev/story_ai_test.html checks it with a stubbed model. Story time
// (modules/story.js) asks this file for a page with `nextPage(context)`.
//
// *** THE BRAIN IS ai.js: ONE OpenAI-COMPATIBLE ADAPTER. *** Whatever answers `/chat/completions` at the address
// this device was given (a local Ollama, a free endpoint, the person's own key) is the storyteller, or "Claude, on
// this account" when that is the device's choice (nimrod_ai.js `createClaudeAI`, the same shape). Nothing here
// knows which. For everybody but Mike it must cost Mike nothing: that is the adapter's rule, and nothing here
// adds a backend.
//
// TWO KINDS OF STORY, ONE TURN SHAPE:
//   'talk'       a CONVERSATION with one of the town's four characters (King Kenny, Queen Rose, Jack, Robin the
//                Joker). Each has a home in the current theme's town (town.js placeInfo) and a short persona.
//   'adventure'  a FREE-FORM ADVENTURE, D&D-like: the model narrates in the second person ("you"), the person's
//                avatar is the hero, the current theme's town is the setting, and every turn offers 2 to 4
//                choices AND accepts anything said or typed instead.
// Every turn, either kind, comes back as `{ ok, say, choices, ... }`: what to show and read aloud, and the
// choices as buttons (a conversation's choices are things the person might say next, so a switch user can talk too).
//
// *** SMALL MODELS: A RUNNING SUMMARY, NOT THE WHOLE STORY. *** Each turn sends the system prompt, the story so
// far as a short summary the model itself keeps (`summary`, at most `summaryWords`), and the last `keepTurns`
// exchanges. A 3B model's window and patience are both small; the whole transcript would grow without end.
// The model is asked for one JSON object (`response_format: json_object`, honoured by Ollama); the reader below is
// tolerant anyway, because not every server enforces it and a small model sometimes wraps it in prose.
//
// *** NEVER A BLOCKED SCREEN. *** Every turn has a timeout (`turnTimeoutMs`, a setting). A turn that times out,
// fails, or cannot be read resolves to the plain fallback, "The storyteller isn't answering; here are the choices
// again.", with the last choices (or the opening ones) still offered. Nothing waits on an answer from anybody: a
// story left alone just sits on its page. What if nobody answers? Nothing happens. Inaction is the failure.
//
// *** SAFETY, IN THE SYSTEM PROMPT AND ONE CHECK THAT DOES NOT DEPEND ON A MODEL. *** The prompt keeps it warm and
// adult-appropriate (adventure and mild peril, no gore, no sexual content, no cruelty), no medical, legal or money
// advice, never claims to be a real person, never asks for personal details. A thread that turns harmful is
// refused calmly: the model sets `"stop": true` and offers gentler choices; the harmful turn is not kept in the
// story. ONE check runs here before any model is asked, because it must not depend on a model's judgement:
// words about hurting oneself get a calm, kind line pointing to a person they trust, and the story waits.
//   Argued, why only that one: FOR a longer word list (violence, swearing): a list catches what a small model
//   misses. AGAINST (chosen): "I swing my sword at the dragon" is the whole genre, and a word list cannot tell it
//   from a threat; it would refuse the ordinary adventure far more often than it caught anything. The model reads
//   the sentence in context; the list is kept to the one case where a miss costs most and a false alarm costs a
//   kind sentence.
//
// *** NOTHING HERE IS SAVED ON THE SERVER. *** A conversation is a person's own words. `toJSON()` / `restore()` let
// the page keep a story on THIS DEVICE (localStorage, `STORY_SAVE_PREFIX`), and the page may also write it to the
// person's Nimrod folder; never `ctx.state`, which is the server's copy. (The server's line: storage_line.py.)

import { createAI, quickestModel, pickModel, cleanKeepAlive } from './ai.js';
import { createClaudeAI, readAIBackend } from './nimrod_ai.js';
import { authHeaders } from './auth.js';
import { DEFAULT_CHARACTERS } from './character_kit.js';
import { placeInfo, TOWN_DRESS } from './town.js';

export const STORY_SOURCE = 'adventure';             // `source` on what is said aloud, for the output log
export const STORY_SAVE_PREFIX = 'nimrod.story.';    // + the panel's instance id: this device's copy of a story
export const STORY_FORMAT = 'nimrod-story';          // the tag on a saved story

// *** THE NUMBERS, EACH A SETTING OR ARGUED. ***
// turnTimeoutMs: MEASURED 2026-10-12 on Mike's desktop, processor only (Ollama 0.35.1), through this file: an
//   adventure turn took 19-42 s on qwen2.5:3b and 38-67 s on qwen2.5:7b once loaded; loading first took 60 s (3b) and
//   139 s (7b). 2 minutes covers every loaded turn of either with room; a 7B turn right after loading can run past
//   it, and then the opening choices are offered and the next press finds the model loaded. Longer (3 or 5 minutes)
//   is a choice for a slow computer. A setting (`TIMEOUT_CHOICES`).
// replyTokens: a narration of 2-4 sentences, 2-4 choices and a 120-word summary is about 250 tokens of JSON; 400
//   leaves room without letting a runaway model talk for minutes (nimrod_ai.js REPLY_TOKENS is the same number).
// summaryWords: 120 words is a paragraph; a 3B model keeps track of that much reliably.
// keepTurns: the last 3 exchanges verbatim, so "the door" in the last answer still means the door just mentioned.
// temperature: 0.8 for a story (the quiz writer's 0.2 is for facts, where variety is a fault).
//
// *** SPEED (2026-10-14, Mike: "Yes" to speeding up the storyteller). Measured numbers: STORY_SPEED below. ***
// talkModel / adventureModel - WHICH MODEL EACH KIND USES (MODEL_CHOICES): 'quick' = the smallest this AI has
//   (ai.js quickestModel; qwen2.5:3b on Mike's desktop), 'large' = the largest (pickModel), 'device' = whatever this
//   device's AI settings say (its saved model, else the largest - the behaviour before this). Talk on 'quick', argued:
//   FOR the big model - it plays a character more richly and keeps to the JSON more reliably. FOR quick (chosen): a
//   conversation is a reply at a time, and waiting most of a minute for "Hello! How are you?" is not a conversation;
//   a hello needs no plot. Adventure on 'device' (the big one, as before): FOR quick - twice as fast. FOR the big model
//   (chosen) - the adventure has to remember a plot through a 120-word summary and invent with it, which is where a
//   3B model is weakest, and a turn of a story can be waited for. Both a setting.
// keepAlive - how long the model stays loaded after a turn ('30m'). Ollama's own default is 5 minutes, after which the
//   next turn waits for a reload (measured 56 s for 3b, 139 s for 7b). FOR 5 minutes: memory goes back sooner (7b is
//   about 5 GB of Mike's 12 GB). FOR 30 (chosen): a person who reads slowly, waits on a switch's light (6 s a choice,
//   three laps) or steps away for a cup of tea comes back to a storyteller that answers; it is per request and changes
//   nothing in Ollama's settings. '' leaves it to the server. A setting.
// talkReplyTokens / talkSummaryWords - a conversation's reply is one or two sentences and its summary needs less: 240
//   tokens and 60 words (adventure keeps 400 and 120). Too few cuts the JSON off and the turn is lost, so the measured
//   length of a talk reply is the floor (STORY_SPEED).
export const STORY_DEFAULTS = Object.freeze({
  turnTimeoutMs: 120000,
  replyTokens: 400,
  summaryWords: 120,
  keepTurns: 3,
  maxChoices: 4,
  temperature: 0.8,
  talkModel: 'quick',
  adventureModel: 'device',
  keepAlive: '30m',
  talkReplyTokens: 240,
  talkSummaryWords: 60,
});
// STORY_SPEED - MEASURED 2026-10-14 on Mike's desktop (i5-10400, 12 GB, processor only, Ollama 0.40.4), through this
// file, 4 turns each:
//   BEFORE (both kinds on qwen2.5:7b, 400 tokens, Ollama's 5-minute keep-alive, no warm-up), from cold: six turns in a
//     row hit the 2-minute timeout (twelve minutes) while the 7B model loaded (one load took 5 min 36 s: the machine had
//     about 5 GB free); once loaded, adventure turns 35-41 s and talk turns 21-38 s.
//   AFTER: talk on qwen2.5:3b at 240 tokens - warm-up 56 s, then turns of 22, 12, 9 and 14 s (none cut short: every
//     reply read, 3-4 choices); adventure on qwen2.5:7b - warm-up 127 s, then turns of 49, 27, 32 and 33 s.
//   So: a conversation about twice as fast, and no turn lost to the load once the panel has warmed up.
export const MODEL_CHOICES = Object.freeze(['quick', 'device', 'large']);
export const KEEP_ALIVE_CHOICES = Object.freeze(['', '5m', '15m', '30m', '60m']);
export const TIMEOUT_CHOICES = Object.freeze([30000, 60000, 120000, 180000, 300000]);
export const MIN_CHOICES = 2;

export const FALLBACK_LINE = 'The storyteller isn’t answering; here are the choices again.';
export const REFUSE_LINE = 'Let’s not take the story that way. Here are some other things to do.';
export const NO_AI_LINE = 'No storyteller is set up on this device yet.';
// The one check that never waits on a model (see the top). Kind, short, no advice beyond "tell somebody".
export const CARE_LINE = 'That sounds important, and it matters more than any story. Please tell someone you trust, '
  + 'or whoever looks after you, how you are feeling. The story will be here whenever you want it.';
// "myself", not "me": "the goblin wants to hurt me" is the adventure; somebody saying it about themselves says "myself".
const CARE_RE = /\b(kill(ing)?|hurt(ing)?|harm(ing)?|cut(ting)?)\s+my\s*self\b|\bsuicid|\bend\s+(it\s+all|my\s+life)\b|\bwant\s+to\s+die\b|\bdon'?t\s+want\s+to\s+(live|be\s+alive)\b/i;
/** Words about hurting oneself, which get CARE_LINE and never go to the model. */
export const needsCare = (text) => CARE_RE.test(String(text || ''));

// ---------------------------------------------------------------------------------------------------
// THE TOWN AND ITS PEOPLE
// ---------------------------------------------------------------------------------------------------
export const CHARACTER_IDS = Object.freeze(['king', 'queen', 'jack', 'joker']);
export const HOME_OF = Object.freeze({ king: 'kingHall', queen: 'queenParlour', jack: 'jackWorkshop', joker: 'jokerCaravan' });
// The town's other places, by suit (town.js PLACE_FOR): where the adventure can go.
const TOWN_PLACES = Object.freeze(['kingHall', 'queenParlour', 'jackWorkshop', 'jokerCaravan', 'bakery', 'shop', 'park', 'library']);

// Each character's persona: a few plain lines, kind and a little particular, never a real person.
export const PERSONAS = Object.freeze({
  king: 'You are warm and a little grand, and you laugh at yourself. You love old stories, your garden and a good '
    + 'fire. You speak like a kindly old king, but plainly.',
  queen: 'You are kind, practical and curious about people. You love your plants, a pot of tea and hearing how '
    + 'somebody’s day went. You ask gentle questions.',
  jack: 'You are a cheerful maker who mends things for the whole town. You like explaining how things work, '
    + 'simply, and you are proud of a job done well.',
  joker: 'You are playful and silly, full of riddles and jokes, but never mean and never at anybody’s expense. '
    + 'You cheer people up.',
});

/** The town theme for a site theme: the town's own six, else Nimrod's. */
export const townTheme = (siteTheme) => (TOWN_DRESS[siteTheme] ? siteTheme : 'nimrod');

/** One character, in a theme's town: `{ id, name, home, homeBlurb, persona }`. */
export function characterInfo(id, theme = 'nimrod') {
  const who = CHARACTER_IDS.includes(id) ? id : 'king';
  const t = townTheme(theme);
  const home = placeInfo(HOME_OF[who], t);
  return { id: who, name: DEFAULT_CHARACTERS[who].name, home: home.label, homeBlurb: home.blurb, persona: PERSONAS[who] };
}

/** The town as a few lines for a prompt: each place's name and what it is like, in this theme. */
export function townLines(theme = 'nimrod') {
  const t = townTheme(theme);
  return TOWN_PLACES.map((id) => { const p = placeInfo(id, t); return `- ${p.label}: ${p.blurb}`; }).join('\n');
}

/** The adventure's opening choices, from the town itself, so a timeout before the first turn still offers some. */
export function openingChoices(theme = 'nimrod') {
  const t = townTheme(theme);
  return [`Walk to ${placeInfo('bakery', t).label.replace(/^The /, 'the ')}`,
    `Explore ${placeInfo('park', t).label.replace(/^The /, 'the ')}`,
    `Knock at ${placeInfo('kingHall', t).label.replace(/^The /, 'the ')}`];
}
/** A conversation's opening replies: things anybody might say first. */
export const OPENING_REPLIES = Object.freeze(['Hello! How are you?', 'What are you doing today?', 'Tell me a story']);

// ---------------------------------------------------------------------------------------------------
// THE PROMPTS
// ---------------------------------------------------------------------------------------------------
export const SAFETY_RULES = [
  'Keep everything warm and kind, for an adult who wants a gentle, cheerful story. Adventure, mystery and mild peril '
    + 'are fine. No gore, no sexual content, no cruelty, no hateful words, nothing frightening for its own sake.',
  'Never give medical, legal or money advice. If asked, say kindly that you can’t help with that and suggest asking '
    + 'someone they trust.',
  // Worded so that a small model repeating it aloud still sounds right: qwen2.5:3b, asked "Are you a real person?" on
  // 2026-10-12, read the earlier wording ("Never claim to be a real person...") straight back as its answer.
  'You are a made-up character in a story, and a computer does your voice. You are not a real person, and not anyone '
    + 'the person knows. If they ask whether you are real, answer warmly in your own words, for example: "I’m a '
    + 'character in a story, and a computer is doing my voice."',
  'Never ask for personal details such as an address, a password or money.',
  'If the person asks for something harmful or unkind, do not continue that part: set "stop" to true, say one calm '
    + 'sentence that the story won’t go that way, and offer gentle choices to carry on.',
  'The person may be speaking aloud, so their words may be misheard. If something makes no sense, go with the '
    + 'nearest sensible meaning.',
].join('\n');

const jsonShape = (choicesWhat, n, words) => 'Answer with ONE JSON object and nothing else, exactly these keys:\n'
  + '{"say": "...", "choices": ["...", "..."], "summary": "...", "stop": false}\n'
  + `- "say": what you say now, 2 to 4 short, plain sentences. It is read aloud.\n`
  + `- "choices": ${MIN_CHOICES} to ${n} ${choicesWhat}, each 2 to 7 words.\n`
  + `- "summary": everything that has happened so far, in at most ${words} words.\n`
  + '- "stop": false, or true only when refusing something harmful.';

/** The system prompt for a conversation with `character` (characterInfo). */
export function talkSystem({ character = characterInfo('king'), theme = 'nimrod', hero = '', maxChoices = STORY_DEFAULTS.maxChoices,
                             summaryWords = STORY_DEFAULTS.summaryWords } = {}) {
  const c = character;
  const t = townTheme(theme);
  return [
    `You are ${c.name}, who lives in ${c.home} in a small storybook town (${TOWN_DRESS[t].label}). ${c.homeBlurb}`,
    c.persona,
    'You are chatting with a visitor to the town. Be friendly, ask about them now and then, and talk about your town '
      + 'and your day. Keep every reply short.',
    hero ? `The visitor looks like this: ${hero}` : '',
    `The town:\n${townLines(t)}`,
    SAFETY_RULES,
    jsonShape('things the visitor might say back to you, in their own voice', maxChoices, summaryWords),
  ].filter(Boolean).join('\n\n');
}

/** The system prompt for a free-form adventure. */
export function adventureSystem({ theme = 'nimrod', hero = '', maxChoices = STORY_DEFAULTS.maxChoices,
                                  summaryWords = STORY_DEFAULTS.summaryWords } = {}) {
  const t = townTheme(theme);
  const folk = CHARACTER_IDS.map((id) => { const c = characterInfo(id, t); return `- ${c.name}, at ${c.home}`; }).join('\n');
  return [
    'You are the storyteller of a gentle, free-form adventure, like a friendly game master. Tell it in the second '
      + 'person ("you"). The person playing is the hero. Each turn, describe what happens in a few vivid, simple '
      + 'sentences, then offer choices. The person may pick a choice or say anything else they want to do; go along '
      + 'with it whenever you can, and let their ideas change the story.',
    hero ? `The hero looks like this: ${hero}` : '',
    `The story happens in a small storybook town (${TOWN_DRESS[t].label}). Its places:\n${townLines(t)}`,
    `Its people:\n${folk}`,
    'Small quests are good: a lost cat, a missing recipe, a riddle, a festival to prepare. Nobody gets badly hurt.',
    SAFETY_RULES,
    jsonShape('things the hero could do next', maxChoices, summaryWords),
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------------------------------
// READING A REPLY
// ---------------------------------------------------------------------------------------------------
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const trimWords = (s, n) => { const w = clean(s).split(' ').filter(Boolean); return w.length > n ? w.slice(w.length - n).join(' ') : w.join(' '); };

function firstJson(text) {
  const s = String(text || '');
  try { return JSON.parse(s); } catch { /* not bare JSON */ }
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* not JSON either */ } }
  return null;
}

/**
 * A reply, read: `{ say, choices, summary, stop }`, or null when there is nothing usable. JSON first; failing that,
 * prose with numbered or bulleted lines (the lines become the choices, the rest is the narration).
 */
export function parseTurn(text, { maxChoices = STORY_DEFAULTS.maxChoices } = {}) {
  const n = Math.max(MIN_CHOICES, Math.min(6, Number(maxChoices) || STORY_DEFAULTS.maxChoices));
  const tidyChoices = (list) => {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map((c) => clean(typeof c === 'string' ? c : (c && (c.text || c.label)) || ''))
      .map((c) => c.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^["“]|["”]$/g, '').slice(0, 80))
      .filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase())).slice(0, n);
  };
  const j = firstJson(text);
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const say = clean(j.say ?? j.story ?? j.narration ?? j.text ?? '').slice(0, 1200);
    const choices = tidyChoices(j.choices ?? j.options ?? j.replies);
    const stop = j.stop === true || j.stop === 'true';
    if (!say && !choices.length && !stop) return null;
    return { say, choices, summary: clean(j.summary || '').slice(0, 2000), stop };
  }
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  const isChoice = (l) => /^\s*(\d+[.)]|[-*•])\s+\S/.test(l);
  const choices = tidyChoices(lines.filter(isChoice));
  const say = clean(lines.filter((l) => !isChoice(l)).join(' ')).replace(/\bchoices?:?\s*$/i, '').trim().slice(0, 1200);
  if (!say && !choices.length) return null;
  return { say, choices, summary: '', stop: false };
}

// ---------------------------------------------------------------------------------------------------
// THE STORY: one conversation or one adventure, turn by turn
// ---------------------------------------------------------------------------------------------------
const cfgOf = (s) => {
  const o = { ...STORY_DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  o.turnTimeoutMs = Number(o.turnTimeoutMs) > 0 ? Number(o.turnTimeoutMs) : STORY_DEFAULTS.turnTimeoutMs;
  o.replyTokens = Number(o.replyTokens) > 0 ? Math.floor(Number(o.replyTokens)) : STORY_DEFAULTS.replyTokens;
  o.summaryWords = Number(o.summaryWords) > 0 ? Math.floor(Number(o.summaryWords)) : STORY_DEFAULTS.summaryWords;
  o.keepTurns = Number(o.keepTurns) >= 0 ? Math.floor(Number(o.keepTurns)) : STORY_DEFAULTS.keepTurns;
  o.maxChoices = Math.max(MIN_CHOICES, Math.min(6, Number(o.maxChoices) || STORY_DEFAULTS.maxChoices));
  o.temperature = Number.isFinite(Number(o.temperature)) ? Number(o.temperature) : STORY_DEFAULTS.temperature;
  o.talkModel = MODEL_CHOICES.includes(o.talkModel) ? o.talkModel : STORY_DEFAULTS.talkModel;
  o.adventureModel = MODEL_CHOICES.includes(o.adventureModel) ? o.adventureModel : STORY_DEFAULTS.adventureModel;
  o.keepAlive = o.keepAlive === '' ? '' : (cleanKeepAlive(o.keepAlive) ?? STORY_DEFAULTS.keepAlive);
  o.talkReplyTokens = Number(o.talkReplyTokens) > 0 ? Math.floor(Number(o.talkReplyTokens)) : STORY_DEFAULTS.talkReplyTokens;
  o.talkSummaryWords = Number(o.talkSummaryWords) > 0 ? Math.floor(Number(o.talkSummaryWords)) : STORY_DEFAULTS.talkSummaryWords;
  return o;
};

/**
 * The model a kind of story uses, from `choice` (MODEL_CHOICES): '' means "let the AI choose" (ai.js's own rule: this
 * device's saved model, else the largest). 'quick' / 'large' ask the server's list once; a server that cannot list,
 * or lists no chat model, gets '' (the AI's own choice), never a failure: the turn still happens.
 */
export async function storyModel(ai, choice, { signal } = {}) {
  if (choice !== 'quick' && choice !== 'large') return '';
  if (!ai || typeof ai.listModels !== 'function') return '';
  let l = null;
  try { l = await ai.listModels({ signal }); } catch { l = null; }
  if (!l || !l.ok || !Array.isArray(l.models)) return '';
  return (choice === 'quick' ? quickestModel(l.models) : pickModel(l.models)) || '';
}

/**
 * LOAD THE STORYTELLER AHEAD (2026-10-14): ask the AI to load the model `kind` will use, so the first turn does not
 * also wait for the load. Only an AI with `warm` (ai.js, for an Ollama address); anything else - "Claude, on this
 * account", another server - is `{ ok: false, skipped: true }` and nothing is asked. No words are sent. Never throws.
 */
export async function warmStoryteller({ ai = null, kind = 'adventure', settings = () => ({}), signal } = {}) {
  if (!ai || typeof ai.warm !== 'function') return { ok: false, skipped: true };
  const cfg = cfgOf(typeof settings === 'function' ? settings() : settings);
  try {
    const model = await storyModel(ai, kind === 'talk' ? cfg.talkModel : cfg.adventureModel, { signal });
    return await ai.warm(model, { keepAlive: cfg.keepAlive, signal });
  } catch (err) { return { ok: false, reason: String(err?.message || err) }; }
}

/**
 * `createStory({ ai, kind, character, theme, hero, settings })`. `ai` has ai.js's `chat`. `settings()` returns any of
 * STORY_DEFAULTS. Every method resolves a TURN: `{ ok, say, choices, refused?, care?, fallback?, reason?, ms? }` -
 * `ok: false` only with `fallback: true` (the storyteller did not answer; `say` is FALLBACK_LINE or NO_AI_LINE and
 * `choices` are the last ones), or `cancelled: true`.
 */
export function createStory({ ai = null, kind = 'adventure', character = 'king', theme = 'nimrod', hero = '',
                              settings = () => ({}), now = () => Date.now() } = {}) {
  const k = kind === 'talk' ? 'talk' : 'adventure';
  let turns = [];          // [{ role: 'user'|'assistant', text }]
  let summary = '';
  let choices = [];
  let lastSay = '';
  let started = false;
  let busy = false;
  let count = 0;
  const who = () => characterInfo(character, theme);
  const opening = () => (k === 'talk' ? [...OPENING_REPLIES] : openingChoices(theme));
  // A conversation's own, shorter numbers (STORY_DEFAULTS, "SPEED").
  const words = (cfg) => (k === 'talk' ? cfg.talkSummaryWords : cfg.summaryWords);
  const tokens = (cfg) => (k === 'talk' ? cfg.talkReplyTokens : cfg.replyTokens);
  // The model, asked for once a story (and again after a turn that failed: the list may have changed).
  let picked = null;       // { choice, model }
  async function modelFor(cfg, signal) {
    const choice = k === 'talk' ? cfg.talkModel : cfg.adventureModel;
    if (!picked || picked.choice !== choice) picked = { choice, model: await storyModel(ai, choice, { signal }) };
    return picked.model;
  }

  function system(cfg) {
    return k === 'talk'
      ? talkSystem({ character: who(), theme, hero, maxChoices: cfg.maxChoices, summaryWords: words(cfg) })
      : adventureSystem({ theme, hero, maxChoices: cfg.maxChoices, summaryWords: words(cfg) });
  }
  function messagesFor(userText, cfg) {
    const msgs = [{ role: 'system', content: system(cfg) }];
    if (summary) msgs.push({ role: 'system', content: `What has happened so far: ${summary}` });
    for (const t of turns.slice(-cfg.keepTurns * 2)) msgs.push({ role: t.role, content: t.text });
    msgs.push({ role: 'user', content: userText });
    return msgs;
  }
  // The choices offered with a fallback ARE the story's choices from then on, so pressing one works (found 2026-10-12:
  // a first turn that timed out showed the opening choices, and choosing one answered "No such choice").
  const fallback = (reason, extra = {}) => {
    if (!choices.length) choices = opening();
    return { ok: false, fallback: true, say: FALLBACK_LINE, choices: [...choices], reason: reason || '', ...extra };
  };

  async function turn(userText, { signal, shown = userText } = {}) {
    const cfg = cfgOf(settings());
    if (!ai || typeof ai.chat !== 'function') {
      return { ...fallback('No AI is connected.'), say: NO_AI_LINE, noAI: true };
    }
    if (busy) return { ...fallback('A turn is already being told.'), busy: true };
    busy = true;
    const started0 = now();
    let r;
    try {
      const model = await modelFor(cfg, signal);
      if (signal?.aborted) throw Object.assign(new Error('Canceled.'), { cancel: true });   // stopped while choosing
      r = await ai.chat(messagesFor(userText, cfg), { json: true, temperature: cfg.temperature, maxTokens: tokens(cfg),
        timeoutMs: cfg.turnTimeoutMs, signal, ...(model ? { model } : {}), ...(cfg.keepAlive ? { keepAlive: cfg.keepAlive } : {}) });
    } catch (err) { r = { ok: false, reason: String(err?.message || err), ...(err?.cancel ? { cancelled: true } : {}) }; }
    finally { busy = false; }
    if (!r || !r.ok) {
      if (!r?.cancelled && !r?.timedOut) picked = null;
      if (r?.cancelled) return { ok: false, cancelled: true, say: '', choices: [...choices], reason: r.reason || 'Canceled.' };
      return fallback(r?.reason || 'The storyteller did not answer.', r?.timedOut ? { timedOut: true } : {});
    }
    const p = parseTurn(r.text, { maxChoices: cfg.maxChoices });
    if (!p) return fallback('The storyteller’s answer could not be read.', { unreadable: true });
    if (p.stop) {
      // Refused: the harmful turn is NOT kept, so the next turn carries on from before it.
      if (p.choices.length >= MIN_CHOICES) choices = p.choices;
      else if (!choices.length) choices = opening();
      return { ok: true, refused: true, say: p.say || REFUSE_LINE, choices: [...choices], ms: now() - started0, model: r.model || null };
    }
    turns.push({ role: 'user', text: shown }, { role: 'assistant', text: p.say });
    turns = turns.slice(-Math.max(2, cfg.keepTurns * 2 + 2));
    summary = p.summary ? trimWords(p.summary, words(cfg)) : trimWords(`${summary} ${p.say}`, words(cfg));
    choices = p.choices.length ? p.choices : (choices.length ? choices : opening());
    lastSay = p.say;
    started = true;
    count += 1;
    return { ok: true, say: p.say, choices: [...choices], ms: now() - started0, model: r.model || null };
  }

  return {
    kind: k,
    /** The first turn: an opening scene, or a hello. */
    start({ signal } = {}) {
      turns = []; summary = ''; choices = []; lastSay = ''; started = false; count = 0;
      const first = k === 'talk' ? `(A visitor has just arrived at ${who().home}.) Greet them.`
        : 'Begin the adventure: set the scene in town and give the hero a small mystery or quest.';
      return turn(first, { signal });
    },
    /** One of the offered choices, by index. */
    choose(i, { signal } = {}) {
      const c = choices[Number(i)];
      if (!c) return Promise.resolve(fallback('No such choice.'));
      return turn(k === 'talk' ? c : `I choose: ${c}`, { signal, shown: c });
    },
    /** Anything the person said or typed. Words about hurting oneself never reach the model (see the top). */
    say(text, { signal } = {}) {
      const t = clean(text).slice(0, 600);
      if (!t) return Promise.resolve(fallback('Nothing was said.'));
      if (needsCare(t)) return Promise.resolve({ ok: true, care: true, say: CARE_LINE, choices: choices.length ? [...choices] : opening() });
      return turn(t, { signal });
    },
    choices: () => [...choices],
    summary: () => summary,
    lastSay: () => lastSay,
    started: () => started,
    turns: () => count,
    get busy() { return busy; },
    /** This story, to keep on this device (or in the person's Nimrod folder). Never the server. */
    toJSON() {
      return { format: STORY_FORMAT, kind: k, character, theme: townTheme(theme), summary, choices: [...choices],
        turns: turns.map((t) => ({ ...t })), lastSay, count, at: now() };
    },
    restore(saved) {
      const s = saved && typeof saved === 'object' && saved.format === STORY_FORMAT && saved.kind === k ? saved : null;
      if (!s) return false;
      summary = clean(s.summary).slice(0, 2000);
      choices = Array.isArray(s.choices) ? s.choices.map(clean).filter(Boolean).slice(0, 6) : [];
      turns = Array.isArray(s.turns) ? s.turns.filter((t) => t && (t.role === 'user' || t.role === 'assistant'))
        .map((t) => ({ role: t.role, text: clean(t.text).slice(0, 1200) })).slice(-12) : [];
      lastSay = clean(s.lastSay).slice(0, 1200);
      count = Number(s.count) || turns.length / 2;
      started = !!(lastSay || turns.length);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// STORY TIME'S SEAM: one more page
// ---------------------------------------------------------------------------------------------------
export const PAGE_DEFAULTS = Object.freeze({ keepPages: 2, pageTokens: 350 });

/** The system prompt for one page of a read-aloud story in town. */
export function pageSystem({ theme = 'nimrod', hero = '', title = '', summaryWords = STORY_DEFAULTS.summaryWords } = {}) {
  const t = townTheme(theme);
  return [
    'You write one page at a time of a gentle picture-book story for an adult listener, read aloud. Each page is 3 to '
      + '5 short, plain sentences, and moves the story on a little.',
    title ? `The story is called "${clean(title).slice(0, 80)}".` : '',
    hero ? `The main character looks like this: ${hero}` : '',
    `It happens in a small storybook town (${TOWN_DRESS[t].label}). Its places:\n${townLines(t)}`,
    `Its people:\n${CHARACTER_IDS.map((id) => `- ${characterInfo(id, t).name}`).join('\n')}`,
    SAFETY_RULES,
    jsonShape('ways the story could go next', STORY_DEFAULTS.maxChoices, summaryWords).replace('what you say now', 'this page'),
  ].filter(Boolean).join('\n\n');
}

/**
 * ONE MORE PAGE, for Story time (modules/story.js). `context`:
 *   { ai?, ctx?, theme?, hero?, title?, pages?: [text], summary?, choice?, signal?, timeoutMs?, settings? }
 * `ai` defaults to this device's storyteller (`storyAIFor(ctx)`). Resolves
 *   { ok: true, text, choices, summary, ms }  or  { ok: false, fallback: true, text: '', choices: [], reason, timedOut? }
 * and never throws: Story time keeps its own pages when the storyteller does not answer.
 */
export async function nextPage(context = {}) {
  const c = context && typeof context === 'object' ? context : {};
  const cfg = cfgOf({ ...(typeof c.settings === 'function' ? c.settings() : c.settings || {}),
    ...(Number(c.timeoutMs) > 0 ? { turnTimeoutMs: Number(c.timeoutMs) } : {}) });
  let ai = c.ai || null;
  if (!ai) { try { ai = storyAIFor(c.ctx || {}); } catch { ai = null; } }
  if (!ai || typeof ai.chat !== 'function') return { ok: false, fallback: true, noAI: true, text: '', choices: [], reason: NO_AI_LINE };
  const pages = (Array.isArray(c.pages) ? c.pages : []).map(clean).filter(Boolean).slice(-PAGE_DEFAULTS.keepPages);
  const msgs = [{ role: 'system', content: pageSystem({ theme: c.theme, hero: c.hero, title: c.title, summaryWords: cfg.summaryWords }) }];
  if (c.summary) msgs.push({ role: 'system', content: `What has happened so far: ${clean(c.summary).slice(0, 2000)}` });
  for (const p of pages) msgs.push({ role: 'assistant', content: JSON.stringify({ say: p }) });
  const ask = c.choice ? `Next page. The listener chose: ${clean(c.choice).slice(0, 200)}`
    : pages.length ? 'Next page.' : 'Write the first page.';
  if (needsCare(c.choice)) return { ok: true, care: true, text: CARE_LINE, choices: [], summary: clean(c.summary) };
  msgs.push({ role: 'user', content: ask });
  const t0 = Date.now();
  let r;
  try {
    // A page is a story: the adventure's model and keep-alive (STORY_DEFAULTS, "SPEED").
    const model = await storyModel(ai, cfg.adventureModel, { signal: c.signal });
    r = await ai.chat(msgs, { json: true, temperature: cfg.temperature, maxTokens: PAGE_DEFAULTS.pageTokens,
      timeoutMs: cfg.turnTimeoutMs, signal: c.signal, ...(model ? { model } : {}), ...(cfg.keepAlive ? { keepAlive: cfg.keepAlive } : {}) });
  } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
  if (!r || !r.ok) return { ok: false, fallback: true, text: '', choices: [], reason: r?.reason || 'The storyteller did not answer.',
    ...(r?.timedOut ? { timedOut: true } : {}), ...(r?.cancelled ? { cancelled: true } : {}) };
  const p = parseTurn(r.text, { maxChoices: cfg.maxChoices });
  if (!p || !p.say) return { ok: false, fallback: true, text: '', choices: [], reason: 'The storyteller’s answer could not be read.' };
  if (p.stop) return { ok: true, refused: true, text: p.say || REFUSE_LINE, choices: p.choices, summary: clean(c.summary) };
  return { ok: true, text: p.say, choices: p.choices,
    summary: p.summary ? trimWords(p.summary, cfg.summaryWords) : trimWords(`${clean(c.summary)} ${p.say}`, cfg.summaryWords),
    ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------------------------------
// WHICH AI TELLS IT: this device's choice (nimrod_ai.js AI_BACKENDS), the same as the Nimrod guide's.
// ---------------------------------------------------------------------------------------------------
/** `ctx.storyAI` / `ctx.ai` (a suite's or a host's) win; else 'claude' is the server's, anything else ai.js. */
export function storyAIFor(ctx = {}) {
  if (ctx.storyAI) return ctx.storyAI;
  if (ctx.ai) return ctx.ai;
  let storage = ctx.aiStorage || null;
  if (!storage) { try { storage = globalThis.localStorage || null; } catch { storage = null; } }
  if (readAIBackend(storage) === 'claude') {
    return ctx.claudeAI || createClaudeAI({ ...(typeof ctx.serverFetch === 'function' ? { fetchImpl: ctx.serverFetch } : {}),
      headers: () => authHeaders(ctx.user || undefined) });
  }
  return createAI(ctx.aiStorage ? { storage: ctx.aiStorage } : {});
}

// ---------------------------------------------------------------------------------------------------
// THIS DEVICE'S COPY (localStorage, in try/catch: blocked storage keeps nothing and never throws)
// ---------------------------------------------------------------------------------------------------
const deviceStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export function saveStoryLocal(key, story, storage = deviceStorage()) {
  if (!key) return false;
  try { storage?.setItem(STORY_SAVE_PREFIX + key, JSON.stringify(story && typeof story.toJSON === 'function' ? story.toJSON() : story)); return true; }
  catch { return false; }
}
export function loadStoryLocal(key, storage = deviceStorage()) {
  if (!key) return null;
  try { const v = JSON.parse(storage?.getItem(STORY_SAVE_PREFIX + key) || 'null'); return v && v.format === STORY_FORMAT ? v : null; }
  catch { return null; }
}
export function forgetStoryLocal(key, storage = deviceStorage()) {
  try { storage?.removeItem?.(STORY_SAVE_PREFIX + key); } catch { /* read-only */ }
}

// HAS THE STORYTELLER ANSWERED ON THIS DEVICE? (2026-10-14) The warm-up's guard: a panel loads the model ahead only on a
// device where a press has already reached it, so it never reaches for an address this browser has not used (and been
// allowed to use) before. A time, kept in this browser; nothing about the story.
export const STORY_ANSWERED_KEY = 'nimrod.storyteller.answered';
export function markStorytellerAnswered(storage = deviceStorage(), now = Date.now()) {
  try { storage?.setItem(STORY_ANSWERED_KEY, String(now)); } catch { /* read-only */ }
}
export function storytellerAnswered(storage = deviceStorage()) {
  try { return Number(storage?.getItem(STORY_ANSWERED_KEY)) > 0; } catch { return false; }
}

/** A story as plain text, for the person's Nimrod folder: what was said, turn by turn. */
export function storyText(saved, { title = 'A story from town' } = {}) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const lines = [title, ''];
  for (const t of Array.isArray(s.turns) ? s.turns : []) lines.push(`${t.role === 'user' ? 'You' : 'Story'}: ${clean(t.text)}`, '');
  if (s.summary) lines.push(`So far: ${clean(s.summary)}`);
  return lines.join('\n');
}
