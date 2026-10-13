// modules/adventure.js — ADVENTURE (type 'adventure'): talk with the people in town, or play a free-form story where
// the person decides what happens. The storytelling is ../story_ai.js; this file is the panel.
//
// Mike, 2026-10-12: *"It would be cool to have a conversation with people in the town and maybe even have little
// choose your own adventure stories. Preferably free form like D&D or something. Could we do something like that on
// the pi with my desktop connected like it is for the subtitles?"* The desktop route is
// web/speech_service/DESKTOP_AI_MODEL.md: a screen with no AI of its own uses a computer in the house through ai.js's
// one address setting.
//
// WHAT IT SHOWS: the narration LARGE, read aloud; the 2 to 4 choices as BIG buttons; a box to type anything else. In
// a conversation the choices are things to say back, so somebody who can only press a switch can talk too.
//
// EVERY WAY OF CHOOSING THE OTHER CHOICE GAMES HAVE (sortbricks.js's list, kept):
//   * TOUCH OR CLICK a choice.
//   * ONE SWITCH: once the narration has been read, the light moves over the choices by itself (`lightMoves:
//     'auto'`, every `scanMs`), saying each ("Walk to the bakery?"); a press takes the lit one. It stops after
//     LIGHT_LAPS laps with no press (the next press starts it again), so an empty room does not watch a light go round.
//   * TWO SWITCHES: next / previous move the light over every button, select presses it.
//   * VOICE: the choice's number or its words ("two", "walk to the bakery"), or - with "Anything said goes into the
//     story" on - anything at all, which the storyteller takes as what the hero does (input_speech.js's dictation
//     window, the Nimrod guide's chat's). The window is shut while the screen is reading aloud, so the screen's own
//     voice is never heard as the person.
//   * KEYS: 1 to 4 choose; typing goes in the box.
//
// *** OFF UNTIL A STORYTELLER IS SET UP, AND IT SAYS SO. *** Nothing here calls the AI until somebody presses Start
// (ai.js's rule: a page that reached for a local address on every mount could put a permission prompt on a screen
// nobody is there to answer). If nothing answers the first time, the panel says how to set one up, never an error.
//
// *** NEVER A BLOCKED SCREEN. *** A turn that takes longer than `turnTimeoutMs` (a setting) says "The storyteller
// isn't answering; here are the choices again." with the choices still there. While it is thinking, "Stop waiting"
// is a button and Back is a verb. What if nobody answers? The story sits on its page. Nothing waits for a person.
//
// *** THE STORY STAYS ON THIS DEVICE. *** It is kept in this browser (story_ai.js `saveStoryLocal`) so "Carry on"
// works after a reload, and "Keep a copy in your Nimrod folder" writes it as a text file into the person's own Data
// folder (user_folders.js). Never `ctx.state`: that is the server's copy of the panel's settings, and a conversation
// is a person's own words (storage_line.py: nothing that is a person's content goes on the server).

import { registerModule } from '../module.js';
import {
  createStory, storyAIFor, characterInfo, CHARACTER_IDS, townTheme, TIMEOUT_CHOICES, STORY_DEFAULTS, STORY_SOURCE,
  saveStoryLocal, loadStoryLocal, forgetStoryLocal, storyText, NO_AI_LINE,
} from '../story_ai.js';
import { SPEECH_TOPICS, DELIVERY_TOPIC } from '../nimrod_ai.js';
import { DEFAULT_CHARACTERS, figureSvg, courtOutfit } from '../character_kit.js';
import { AVATAR_KEY, readAvatar, describeAvatar, renderAvatar } from '../avatar.js';
import { themeIdAt } from '../card_deck.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
import { kindFolder, handleStore } from '../user_folders.js';
import { registerTownTalk } from '../town_talk.js';

export const ADVENTURE_TYPE = 'adventure';
export const ADVENTURE_TITLE = 'Adventure';
export const ADVENTURE_VERB_TOPICS = Object.freeze(Object.fromEntries(
  ['next', 'prev', 'select', 'back', 'play', 'pause'].map((v) => [v, `${ADVENTURE_TYPE}/${v}`]),
));
// A press somewhere else that opens a story here: `{ who: 'king'|'queen'|'jack'|'joker' }` starts a conversation (the
// Town's "Talk to <character>"); the other starts an adventure. Never fired by anything on its own.
export const ADVENTURE_TALK_TOPIC = `${ADVENTURE_TYPE}/talk`;
export const ADVENTURE_START_TOPIC = `${ADVENTURE_TYPE}/start`;
// The light stops after this many laps with no press. 3, argued (sortbricks's IDLE_MS reasoning): enough for somebody
// slow to respond to see every choice three times; few enough that a room nobody is in goes quiet within a minute
// or so at the default step. Not a setting: any press starts it again.
export const LIGHT_LAPS = 3;
// How long the dictation window stays shut after the screen starts reading, at most, when the output bus never says
// it finished: 2 s plus 80 ms a character, capped at a minute (the Nimrod guide's own watchdog, longer cap: a page
// of story is longer than a chat reply).
const holdMsFor = (text) => Math.min(60000, 2000 + 80 * String(text || '').length);

export const ADVENTURE_DEFAULTS = Object.freeze({
  readAloud: true,
  listen: true,
  freeSpeech: true,
  lightMoves: 'auto',
  // *** 6 SECONDS A CHOICE, ARGUED. *** FOR longer (input_scan.js's 15 s from a real bedside board: the step is set by
  // how long a RESPONSE takes): a press can take seconds. AGAINST, for the default: a choice here is a short sentence
  // the screen says aloud as it lights, which itself takes 1-2 s, and with four choices a 15 s step is a minute a
  // lap. 6 s is the sentence plus time to press; 10 and 15 s are in the list. Never faster than the flashing limit.
  scanMs: 6000,
  sayChoice: true,
  turnTimeoutMs: STORY_DEFAULTS.turnTimeoutMs,
  keepOnDevice: true,
});

const SETTINGS = [
  { key: 'readAloud', label: 'Read the story aloud', default: true, level: 'essential', onLabel: 'On', offLabel: 'Off' },
  { key: 'listen', label: 'Listen for a spoken choice', default: true, level: 'essential', onLabel: 'On', offLabel: 'Off',
    note: 'Uses the screen’s voice commands, when they are on (the settings menu’s Devices tab). Say the number or the words of a choice.' },
  { key: 'freeSpeech', label: 'Anything said goes into the story', default: true, level: 'standard',
    onLabel: 'Yes: what is said is what the hero does, or says', offLabel: 'No: only the choices are heard',
    note: 'Off is better in a room with a television or other people talking.' },
  { key: 'lightMoves', label: 'The light on the choices', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Moves by itself after the story is read. A press takes the lit choice. One switch can play' },
      { value: 'off', label: 'Moves only when told: Next moves it, Select presses it' }],
    note: 'A choice touched is always taken. The light stops after three laps with no press; the next press starts it again.' },
  { key: 'scanMs', label: 'How long each choice stays lit', kind: 'choice', default: 6000, level: 'standard',
    options: [3000, 4000, 6000, 8000, 10000, 15000].map((v) => ({ value: v, label: `${v / 1000} seconds` })),
    note: 'Never faster than the screen’s flashing limit.', appliesWhen: (v) => !v || v.lightMoves !== 'off' },
  { key: 'sayChoice', label: 'Say each choice as it lights', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No', note: 'Somebody using a switch needs it.' },
  { key: 'turnTimeoutMs', label: 'How long to wait for the storyteller', kind: 'choice', default: STORY_DEFAULTS.turnTimeoutMs,
    level: 'advanced', options: TIMEOUT_CHOICES.map((v) => ({ value: v, label: v < 60000 ? `${v / 1000} seconds` : `${v / 60000} minute${v === 60000 ? '' : 's'}` })),
    note: 'After this the choices are offered again. A small model on a slow computer needs longer.' },
  { key: 'keepOnDevice', label: 'Keep the story on this device, to carry on later', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No: forget it when the panel closes',
    note: 'Only on this device. It is never sent to the website’s server.' },
];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NUMBER_WORDS = Object.freeze({ one: 0, first: 0, '1': 0, two: 1, second: 1, '2': 1, to: 1, too: 1, three: 2, third: 2, '3': 2,
  four: 3, fourth: 3, for: 3, '4': 3, five: 4, fifth: 4, '5': 4, six: 5, sixth: 5, '6': 5 });
const AGAIN_WORDS = Object.freeze(['read it again', 'say it again', 'again', 'repeat', 'what was that']);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** What a spoken or typed line means here: `{ kind: 'choose', index } | { kind: 'again' } | { kind: 'free', text }`. Pure. */
export function readHeard(text, choices = []) {
  const said = norm(text).replace(/^(number|option|choice)\s+/, '').replace(/^(i choose|i pick|i'll|i will)\s+/, '');
  if (!said) return null;
  if (AGAIN_WORDS.includes(said)) return { kind: 'again' };
  const n = NUMBER_WORDS[said];
  if (n != null && n < choices.length) return { kind: 'choose', index: n };
  const at = choices.findIndex((c) => norm(c) === said);
  if (at >= 0) return { kind: 'choose', index: at };
  // A choice's words said with a little more or less ("the bakery" for "Walk to the bakery") is that choice only
  // when it matches ONE choice: more than one is free speech, which the storyteller can make sense of.
  if (said.split(' ').length >= 2) {
    const hits = choices.map((c, i) => [norm(c), i]).filter(([c]) => c.includes(said) || said.includes(c));
    if (hits.length === 1) return { kind: 'choose', index: hits[0][1] };
  }
  return { kind: 'free', text: String(text || '').trim() };
}

const STYLE_ID = 'adventure-style';
const CSS = `
.adv{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;padding:12px 14px;box-sizing:border-box;overflow:auto;
  background:var(--bg);color:var(--text);font-family:var(--font)}
.adv h2{margin:0;font-size:1.3em}
.adv-soft{color:var(--text-muted);margin:0}
.adv button{min-height:48px;padding:8px 16px;border-radius:12px;border:1px solid var(--border);background:var(--surface-alt,var(--surface));
  color:var(--text);font:inherit;cursor:pointer;text-align:left}
.adv button[disabled]{opacity:.55;cursor:default}
.adv button.primary{border-color:var(--accent);font-weight:600}
.adv .is-scan,.adv button:focus-visible{outline:4px solid var(--scan-ring, var(--highlight));outline-offset:3px}
.adv-menu{display:flex;flex-direction:column;gap:10px;max-width:40em}
.adv-who{display:grid;grid-template-columns:repeat(auto-fit,minmax(12em,1fr));gap:10px}
.adv-stage{display:flex;gap:14px;align-items:flex-start;min-height:0}
.adv-face{flex:0 0 auto;width:clamp(64px,14vmin,140px)}
.adv-face svg{width:100%;height:auto;display:block}
.adv-words{flex:1 1 auto;min-width:0}
.adv-say{margin:0;font-size:clamp(1.25em,3.4vmin,2.1em);line-height:1.35}
.adv-say[data-dim]{opacity:.6}
.adv-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(14em,1fr));gap:10px}
.adv-choices button{min-height:64px;font-size:clamp(1.05em,2.6vmin,1.5em);font-weight:600}
.adv-own{display:flex;gap:8px}
.adv-own input{flex:1 1 auto;min-height:48px;font:inherit;padding:6px 12px;border-radius:12px;border:1px solid var(--border);
  background:var(--surface);color:var(--text)}
.adv-bar{display:flex;flex-wrap:wrap;gap:8px}
.adv-note{margin:0;color:var(--text-muted);font-size:.95em}
.adv-thinking{font-weight:600}
`;

registerModule(
  { type: ADVENTURE_TYPE, title: ADVENTURE_TITLE, core: 'new',
    description: 'Talk with the people in town, or play a story where you choose what happens: pick a choice, or say or type '
      + 'anything. Needs an AI (artificial intelligence) storyteller on this device or on a computer in the house.',
    // The storyteller is an AI program somewhere (this computer, the house, or online): without one there is no story.
    dependsOn: 'network', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    const win = mount.ownerDocument?.defaultView || globalThis;
    let cfg = { ...ADVENTURE_DEFAULTS };
    let root = null;
    let view = 'home';          // 'home' | 'story' | 'setup'
    let story = null;
    let storyKind = 'adventure';
    let character = 'king';
    let ai = null;
    let say = '';               // what is on the page now
    let choices = [];
    let note = '';
    let setupReason = '';
    let thinking = false;
    let inflight = null;        // AbortController of the turn being told
    let cursor = -1;
    let lightTimer = null;
    let lightSteps = 0;
    let holding = false;
    let holdTimer = null;
    let saidId = null;
    let hidden = false;
    let torn = false;
    let hero = '';              // the person's avatar, in words, for the prompt
    let heroSvg = '';
    const offs = [];
    const saveKey = () => String(ctx.instanceId || ADVENTURE_TYPE);
    const theme = () => { try { return townTheme(themeIdAt(mount)); } catch { return 'nimrod'; } };

    function publish(topic, payload) { try { ctx.bus?.publish?.(topic, payload); } catch (err) { console.error('adventure: publish', err); } }

    // ---- reading aloud, and the dictation window shut meanwhile ----------------------------------------------
    function speak(text, { hold = true } = {}) {
      if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; }
      if (!cfg.readAloud || !text || typeof ctx.output?.say !== 'function') { if (hold) release(); return; }
      try { saidId = ctx.output.say(text, { source: STORY_SOURCE }); } catch (err) { console.error('adventure: say', err); if (hold) release(); return; }
      if (!hold) return;
      holding = true;
      stopLight();
      announceGrammar();
      clearTimeout(holdTimer);
      holdTimer = setTimeout(release, holdMsFor(text));
    }
    function release() {
      clearTimeout(holdTimer);
      holdTimer = null;
      holding = false;
      announceGrammar();
      startLight();
    }

    function announceGrammar() {
      const open = !!cfg.listen && view === 'story' && !thinking && !holding && !hidden && !torn;
      const words = [...choices, ...Object.keys(NUMBER_WORDS).filter((w) => !/^\d$/.test(w) && NUMBER_WORDS[w] < choices.length), 'read it again'];
      publish(SPEECH_TOPICS.grammar, { source: ADVENTURE_TYPE, instanceId: ctx.instanceId || null, open,
        words: open ? words : [], dictation: open && cfg.freeSpeech !== false, phase: storyKind });
    }

    // ---- the light (one switch: by itself; two switches: next / prev) -----------------------------------------
    function stops() { return root ? [...root.querySelectorAll('button')].filter((b) => !b.disabled && !b.hidden && !b.closest('[hidden]')) : []; }
    function choiceStops() { return root ? [...root.querySelectorAll('[data-adv-act="choose"]')].filter((b) => !b.disabled) : []; }
    function litEl() { const l = stops(); return cursor >= 0 && cursor < l.length ? l[cursor] : null; }
    function paint() {
      if (!root) return;
      for (const n of root.querySelectorAll('.is-scan')) n.classList.remove('is-scan');
      const el = litEl();
      if (el) { el.classList.add('is-scan'); try { el.scrollIntoView?.({ block: 'nearest' }); } catch { /* old browser */ } }
    }
    function step(d) {
      const n = stops().length;
      if (!n) return;
      cursor = cursor < 0 ? (d > 0 ? 0 : n - 1) : ((cursor + d) % n + n) % n;
      paint();
    }
    const scanStep = () => Math.max(Number(cfg.scanMs) || ADVENTURE_DEFAULTS.scanMs, minFlashPeriodMs(flashLimit(ctx)));
    function stopLight() { if (lightTimer != null) { clearTimeout(lightTimer); lightTimer = null; } }
    function startLight() {
      stopLight();
      lightSteps = 0;
      if (cfg.lightMoves === 'off' || view !== 'story' || thinking || holding || hidden || torn) return;
      if (!choiceStops().length) return;
      const tick = () => {
        lightTimer = null;
        if (view !== 'story' || thinking || holding || hidden || torn) return;
        const cs = choiceStops();
        if (!cs.length || lightSteps >= cs.length * LIGHT_LAPS) { paint(); return; }
        const all = stops();
        const at = cs.indexOf(litEl());
        const next = cs[(at + 1) % cs.length];
        cursor = all.indexOf(next);
        lightSteps += 1;
        paint();
        if (cfg.sayChoice) speak(`${next.dataset.advText}?`, { hold: false });
        lightTimer = setTimeout(tick, scanStep());
      };
      tick();
    }
    const pressed = () => { lightSteps = 0; };

    // ---- drawing -------------------------------------------------------------------------------------------
    function faceHtml() {
      if (storyKind === 'talk') {
        const c = DEFAULT_CHARACTERS[character];
        try { return figureSvg(c.look, { outfit: courtOutfit(character, theme()), role: character, pose: 'wave' }, c.name); } catch { return ''; }
      }
      return heroSvg;
    }
    function render() {
      if (!root || torn) return;
      const t = theme();
      if (view === 'home') {
        const saved = cfg.keepOnDevice ? loadStoryLocal(saveKey()) : null;
        const carry = saved ? (saved.kind === 'talk' ? `Carry on talking with ${esc(characterInfo(saved.character, t).name)}` : 'Carry on the adventure') : '';
        root.innerHTML = `<div class="adv-menu">
          <h2>Stories in town</h2>
          <p class="adv-soft">Play a story where you choose what happens, or talk with somebody in town. An AI (artificial intelligence) storyteller makes it up as you go.</p>
          ${carry ? `<button class="primary" data-adv-act="carry">${carry}</button>` : ''}
          <button class="${carry ? '' : 'primary'}" data-adv-act="adventure">Start an adventure</button>
          <div class="adv-who">${CHARACTER_IDS.map((id) => { const c = characterInfo(id, t);
            return `<button data-adv-act="talk" data-adv-who="${id}">Talk to ${esc(c.name)}<br><small class="adv-soft">at ${esc(c.home)}</small></button>`; }).join('')}</div>
          ${note ? `<p class="adv-note" data-adv-note>${esc(note)}</p>` : ''}
        </div>`;
      } else if (view === 'setup') {
        root.innerHTML = `<div class="adv-menu" data-adv-setup>
          <h2>No storyteller answered</h2>
          <p>${esc(setupReason || NO_AI_LINE)}</p>
          <p>A storyteller is an AI program. To set one up:</p>
          <ul>
            <li>On a computer with Ollama (free, nothing leaves the house): open the Nimrod guide and choose “Set up your guide / AI”.</li>
            <li>On a screen with no AI of its own: whoever looks after the house can let it use a computer in the house that has one. Then put that computer’s address in this screen’s AI settings.</li>
            <li>Or an online AI with your own key, in the same AI settings.</li>
          </ul>
          <div class="adv-bar"><button class="primary" data-adv-act="retry">Try again</button><button data-adv-act="home">Back</button></div>
        </div>`;
      } else {
        const face = faceHtml();
        root.innerHTML = `<div class="adv-stage">
            ${face ? `<div class="adv-face" aria-hidden="true">${face}</div>` : ''}
            <div class="adv-words" aria-live="polite">
              <p class="adv-say" data-adv-say${thinking ? ' data-dim' : ''}>${esc(say)}</p>
              ${thinking ? '<p class="adv-thinking" data-adv-thinking>The storyteller is thinking…</p>' : ''}
            </div>
          </div>
          <div class="adv-choices" data-adv-choices>${choices.map((c, i) => `<button data-adv-act="choose" data-adv-i="${i}" data-adv-text="${esc(c)}"${thinking ? ' disabled' : ''}>${i + 1}. ${esc(c)}</button>`).join('')}</div>
          <form class="adv-own" data-adv-form><input data-adv-free type="text" maxlength="600" autocomplete="off"
            aria-label="${storyKind === 'talk' ? 'Say something else' : 'Do something else'}"
            placeholder="${storyKind === 'talk' ? 'Or type what you say…' : 'Or type what you do…'}"${thinking ? ' disabled' : ''}>
            <button data-adv-act="send"${thinking ? ' disabled' : ''}>Send</button></form>
          <div class="adv-bar">
            ${thinking ? '<button data-adv-act="stop">Stop waiting</button>' : '<button data-adv-act="again">Read it again</button>'}
            <button data-adv-act="folder">Keep a copy in your Nimrod folder</button>
            <button data-adv-act="home">Back to the start</button>
          </div>
          ${note ? `<p class="adv-note" data-adv-note>${esc(note)}</p>` : ''}`;
      }
      if (cursor >= stops().length) cursor = -1;
      paint();
    }

    // ---- telling the story ---------------------------------------------------------------------------------
    function remember() {
      if (!story) return;
      if (cfg.keepOnDevice) saveStoryLocal(saveKey(), { ...story.toJSON(), character });
      else forgetStoryLocal(saveKey());
    }
    async function told(promise, { first = false } = {}) {
      thinking = true;
      stopLight();
      announceGrammar();
      render();
      let r;
      try { r = await promise; } catch (err) { r = { ok: false, fallback: true, say: '', choices, reason: String(err?.message || err) }; }
      inflight = null;
      thinking = false;
      if (torn) return r;
      if (r.cancelled && !choices.length) { goHome(); return r; }   // stopped before the story began: back to the start
      if (r.cancelled) { note = 'Stopped waiting. The choices are here again.'; render(); announceGrammar(); startLight(); return r; }
      // Nothing answered at all: how to set one up. A storyteller that answered too SLOWLY is there (a big model
      // loading): the opening choices, and the next press tries again.
      if (!r.ok && first && !r.timedOut && !(story && story.started())) {
        setupReason = r.noAI ? NO_AI_LINE : (r.reason || NO_AI_LINE);
        view = 'setup';
        cursor = -1;
        render();
        announceGrammar();
        return r;
      }
      note = r.ok ? '' : (r.reason ? `(${r.reason})` : '');
      say = r.say || say;
      choices = Array.isArray(r.choices) ? r.choices : choices;
      cursor = -1;
      if (r.ok && !r.refused && !r.care) remember();
      render();
      speak(say);
      announceGrammar();
      return r;
    }
    function newStory(kind, who) {
      storyKind = kind === 'talk' ? 'talk' : 'adventure';
      character = CHARACTER_IDS.includes(who) ? who : 'king';
      ai = storyAIFor(ctx);
      story = createStory({ ai, kind: storyKind, character, theme: theme(), hero: storyKind === 'adventure' ? hero : '',
        settings: () => ({ turnTimeoutMs: Number(cfg.turnTimeoutMs) || STORY_DEFAULTS.turnTimeoutMs }) });
      return story;
    }
    function begin(kind, who) {
      newStory(kind, who);
      view = 'story';
      say = storyKind === 'talk' ? `You knock at ${characterInfo(character, theme()).home}…` : 'Once upon a time, in town…';
      choices = [];
      note = '';
      inflight = new AbortController();
      return told(story.start({ signal: inflight.signal }), { first: true });
    }
    function carryOn() {
      const saved = loadStoryLocal(saveKey());
      if (!saved) { view = 'home'; render(); return; }
      newStory(saved.kind, saved.character);
      story.restore(saved);
      view = 'story';
      say = story.lastSay() || 'Where were we…';
      choices = story.choices();
      note = '';
      cursor = -1;
      render();
      speak(say);
      announceGrammar();
    }
    function choose(i) {
      if (!story || thinking) return null;
      pressed();
      inflight = new AbortController();
      return told(story.choose(i, { signal: inflight.signal }));
    }
    function freeSay(text) {
      const t = String(text || '').trim();
      if (!story || thinking || !t) return null;
      pressed();
      inflight = new AbortController();
      return told(story.say(t, { signal: inflight.signal }));
    }
    function heard(p) {
      if (view !== 'story' || thinking || holding || !p || typeof p.text !== 'string') return;
      const h = readHeard(p.text, choices);
      if (!h) return;
      if (h.kind === 'again') { speak(say); return; }
      if (h.kind === 'choose') { choose(h.index); return; }
      if (cfg.freeSpeech !== false) freeSay(h.text);
    }
    async function keepInFolder() {
      if (!story) return;
      const store = ctx.folderStore || handleStore();
      let k = null;
      try { k = await kindFolder('data', { store }); } catch { k = null; }
      if (!k || !k.dir) {
        note = k && k.holder ? 'This device’s Nimrod folder needs to be allowed again (the Your own folders page). The story is kept on this device.'
          : 'This device has no Nimrod folder. The story is kept on this device only.';
        render();
        return;
      }
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const name = `story ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}.txt`;
      const title = storyKind === 'talk' ? `Talking with ${characterInfo(character, theme()).name}` : 'An adventure in town';
      try {
        const fh = await k.dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(storyText(story.toJSON(), { title }));
        await w.close();
        note = `Kept in your Nimrod folder: ${k.name}/${name}`;
      } catch {
        note = 'Could not write to the Nimrod folder from here. The story is kept on this device.';
      }
      render();
    }
    function goHome() {
      if (inflight) { try { inflight.abort(); } catch { /* done */ } }
      if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; }
      holding = false;
      stopLight();
      view = 'home';
      note = '';
      cursor = -1;
      render();
      announceGrammar();
    }

    function press(act, el) {
      if (act !== 'choose') pressed();
      switch (act) {
        case 'adventure': return begin('adventure');
        case 'talk': return begin('talk', el?.dataset?.advWho);
        case 'carry': return carryOn();
        case 'retry': return begin(storyKind, character);
        case 'home': return goHome();
        case 'choose': return choose(Number(el?.dataset?.advI));
        case 'send': { const inp = root?.querySelector('[data-adv-free]'); const v = inp?.value || ''; if (inp) inp.value = ''; return freeSay(v); }
        case 'again': speak(say); return null;
        case 'stop': if (inflight) { try { inflight.abort(); } catch { /* done */ } } return null;
        case 'folder': return keepInFolder();
        default: return null;
      }
    }
    function verb(v) {
      if (torn) return false;
      pressed();
      if (v === 'next') { stopLight(); step(1); }
      else if (v === 'prev') { stopLight(); step(-1); }
      else if (v === 'select') {
        if (cursor < 0) { cursor = 0; paint(); return true; }   // the first select only lights the first stop
        const el = litEl();
        if (el) press(el.dataset.advAct, el);
      } else if (v === 'back') {
        if (thinking) press('stop');
        else if (view !== 'home') goHome();
      } else if (v === 'play') speak(say);
      else if (v === 'pause') { if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; } release(); }
      else return false;
      return true;
    }

    async function loadHero() {
      const pid = ctx.personId || null;
      if (!pid || typeof ctx.makePersonState !== 'function') return;
      let h = null;
      try { h = ctx.makePersonState(pid, AVATAR_KEY); } catch { h = null; }
      if (!h) return;
      try {
        await h.load?.();
        const a = readAvatar(h.get?.() || {});
        if (a.drawn) { hero = describeAvatar(a.drawn).replace(/^A drawn avatar: /, ''); heroSvg = renderAvatar(a.drawn, { animate: false }); }
      } catch { /* no avatar: the hero is "you" */ }
      finally { try { h.destroy?.(); } catch { /* gone */ } }
      if (view === 'story' && storyKind === 'adventure') render();
    }

    const onClick = (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-adv-act]') : null;
      if (!b || !root?.contains(b) || b.disabled) return;
      e.preventDefault();
      const i = stops().indexOf(b);
      if (i >= 0) cursor = i;
      stopLight();
      press(b.dataset.advAct, b);
    };
    const onSubmit = (e) => { if (e.target?.matches?.('[data-adv-form]')) { e.preventDefault(); press('send'); } };
    const onKey = (e) => {
      if (view !== 'story' || thinking || e.target?.matches?.('input,textarea')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) { e.preventDefault(); choose(n - 1); }
    };

    return {
      init() {
        const doc = mount.ownerDocument || document;
        if (!doc.getElementById(STYLE_ID)) {
          const st = doc.createElement('style');
          st.id = STYLE_ID;
          st.textContent = CSS;
          (doc.head || doc.documentElement).append(st);
        }
        root = doc.createElement('div');
        root.className = 'adv';
        root.dataset.adventure = '';
        mount.append(root);
        root.addEventListener('click', onClick);
        root.addEventListener('submit', onSubmit);
        root.addEventListener('keydown', onKey);
        const st = ctx.state;
        try { cfg = { ...ADVENTURE_DEFAULTS, ...(st?.get?.() || {}) }; } catch { cfg = { ...ADVENTURE_DEFAULTS }; }
        try {
          const off = st?.subscribe?.((snap) => {
            const was = cfg;
            cfg = { ...ADVENTURE_DEFAULTS, ...(snap || {}) };
            if (was.listen !== cfg.listen || was.freeSpeech !== cfg.freeSpeech) announceGrammar();
            if (was.lightMoves !== cfg.lightMoves || was.scanMs !== cfg.scanMs) { if (cfg.lightMoves === 'off') stopLight(); else if (!holding) startLight(); }
            if (was.keepOnDevice !== cfg.keepOnDevice) { if (!cfg.keepOnDevice) forgetStoryLocal(saveKey()); else remember(); }
          });
          if (typeof off === 'function') offs.push(off);
        } catch { /* no state */ }
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        for (const [v, topic] of Object.entries(ADVENTURE_VERB_TOPICS)) on(topic, () => verb(v));
        // THE TOWN'S "Talk to <character>" (modules/town.js) and anything else that opens a story: a press elsewhere.
        on(ADVENTURE_TALK_TOPIC, (p) => { if (!thinking && CHARACTER_IDS.includes(p?.who)) begin('talk', p.who); });
        on(ADVENTURE_START_TOPIC, () => { if (!thinking) begin('adventure'); });
        // The Town's own seam (town_talk.js): while this panel is on a screen, its "Talk to <character>" buttons show,
        // and a press opens the conversation HERE. Taken back when the panel goes (the newest Adventure panel wins).
        try {
          offs.push(registerTownTalk((req) => {
            if (torn || thinking || !CHARACTER_IDS.includes(req?.character)) return false;
            begin('talk', req.character);
            return true;
          }));
        } catch (err) { console.error('adventure: town talk', err); }
        on(SPEECH_TOPICS.answer, heard);
        on(DELIVERY_TOPIC, (rec) => { if (holding && rec && saidId != null && rec.id === saidId) release(); });
        render();
        loadHero();
      },
      onResize() {},
      onHide() {
        hidden = true;
        stopLight();
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; }
        announceGrammar();
      },
      onShow() { hidden = false; announceGrammar(); if (view === 'story' && !thinking) startLight(); },
      destroy() {
        torn = true;
        stopLight();
        clearTimeout(holdTimer);
        if (inflight) { try { inflight.abort(); } catch { /* done */ } }
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } }
        publish(SPEECH_TOPICS.grammar, { source: ADVENTURE_TYPE, instanceId: ctx.instanceId || null, open: false, words: [] });
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        if (!cfg.keepOnDevice) forgetStoryLocal(saveKey());
        root?.removeEventListener('click', onClick);
        root?.removeEventListener('submit', onSubmit);
        root?.removeEventListener('keydown', onKey);
        root?.remove();
        root = null;
      },
      verb,
      // A suite's window on it.
      __probe: () => ({ view, kind: storyKind, character, say, choices: [...choices], note, thinking, holding, cursor,
        lit: litEl()?.textContent?.trim() || null, setupReason, saved: loadStoryLocal(saveKey()), story }),
      __press: (act, i) => press(act, act === 'choose' ? { dataset: { advI: String(i) } } : act === 'talk' ? { dataset: { advWho: i } } : null),
      __heard: (text) => heard({ text, dictation: true }),
      __release: () => release(),
    };
  },
);
