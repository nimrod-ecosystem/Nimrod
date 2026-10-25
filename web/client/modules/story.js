// modules/story.js — STORY TIME: a short picture story, read aloud page by page, with the person as the hero.
//
// Mike, 2026-10-12 (public DECISIONS.md, newest section): build Design's ideas, the Town and Story time first. Claude
// Design's idea (characters handoff, "Ideas for games and story time"): "a short picture story read aloud. The person's
// own avatar is the hero and the court characters are the cast, in the current theme's outfits. One switch turns the
// page." The stories are data (`../stories.js`); every picture is a place in the theme's town with the people standing
// in it (`../town_scene.js`): Design's places, Design's characters, the person's own full-body character as the hero
// (the avatar row's `figure`, avatar_figure.js), or a default character for somebody who has not made one.
//
// *** TURNING THE PAGE. ***
//   * ANY PRESS: select, next, down, launch, right, a touch anywhere, Enter or Space turns to the next page; prev, back,
//     left go back one; up reads the page again. "Next page", "turn the page", "previous page" and "read it again" are
//     the module's own spoken phrases (with the wake phrase, as every module's are).
//   * BY ITSELF (`turnPages: 'itself'`, the default): a page turns `storyPageMs` after it has been read aloud (or, with
//     no voice, after time to read it). So somebody who can only watch gets the whole story.
//   * WAITING FOR A PRESS (`turnPages: 'press'`) still turns by itself after `storyWaitMs` (default a minute) unless
//     the person chose "Never": a story never becomes a picture only a press can move on from, unless that was chosen.
//   * AT THE END: "The end", a rest of `storyRestMs`, then the next story (`afterStory`), so a story left running is a
//     story at a time with quiet between, not a voice that never stops.
//
// *** READ ALOUD THROUGH THE SITE'S VOICE *** (the output bus, `ctx.output.say`, routed by the person's own settings).
// Where this screen has no voice (no output, no speech channel, the voice failed), the words are shown LARGE and the
// line under the story says so once; nothing waits on a voice that will never come.
//
// *** AN AI-WRITTEN STORY (`storySource: 'ai'`), A SEAM. *** `../story_ai.js` (built separately) provides
// `nextPage(context)`: given the theme, the hero in words, the title, the pages so far and a running summary, a
// promise of the next page's words ({ ok, text, summary }; it never throws). This file picks the page's picture from
// the words (`aiPage`: the place and the characters they name) and checks it like any page (stories.js `checkPage`,
// so nothing it says is trusted as markup). A storyteller may instead answer in this file's own page shape
// ({ place, cast, text, end? }). Off by default and until the AI is set up; if it is not set up, slow (AI_WAIT_MS) or
// wrong, the built-in stories are read.

import { registerModule } from '../module.js';
import { watchTheme, deckFor } from '../card_deck.js';
import { placeInfo } from '../town.js';
import { openTownEdits, personOf, PLACE_IDS } from '../town_edits.js';
import { sceneSvg } from '../town_scene.js';
import { STORIES, STORY_IDS, COURT_NAMES, storyById, pageText, checkPage, nextStoryId } from '../stories.js';
import { readAvatar, AVATAR_KEY } from '../avatar.js';
import { describeFigure } from '../avatar_figure.js';

export const TYPE = 'story';
export const TITLE = 'Story time';

// Without a voice, a page stays long enough to be read: 300 ms a word is 200 words a minute, a slow, comfortable reading
// pace (adults read aloud at about 150, silently at 200-250 [training knowledge]), plus the page's own time.
export const READ_MS_PER_WORD = 300;
// A voice that never says it finished (a lost report) cannot hold a page: past this, the page counts as read. 45 s is
// longer than the longest page takes to say (400 characters is about 30 s at a slow voice).
export const SPEECH_WAIT_MAX_MS = 45000;
// The AI storyteller gets this long for a page before the built-in stories take over: long enough for a local model on
// a desktop, short enough that a watcher is not left on one picture.
export const AI_WAIT_MS = 20000;
export const AI_MAX_PAGES = 8;

export const VOICE = Object.freeze({
  'next page': 'next', 'turn the page': 'next', 'previous page': 'prev', 'go back a page': 'prev',
  'read it again': 'up', 'read that again': 'up', 'pause the story': 'pause', 'carry on reading': 'play',
});

export const DEFAULTS = Object.freeze({
  storyPick: 'all',
  turnPages: 'itself',
  storyPageMs: 8000,
  storyWaitMs: 60000,
  readAloud: true,
  storyText: 'normal',
  heroOutfit: 'own',
  afterStory: 'next',
  storyRestMs: 60000,
  storySource: 'builtin',
});

// *** THE DEFAULTS, ARGUED (each on Mike's list). ***
//   turnPages 'itself'   FOR: Mike's brief, "so someone who can only watch gets the whole story". AGAINST: somebody who
//                        wants to linger on a picture. A press still turns at once, and "Wait for a press" is a choice.
//   storyPageMs 8 s      after the words are read: time to look at the picture. With the reading, about 15 s a page and
//                        a minute and a half a story. Longer (15, 30 s) for somebody who takes longer to take it in.
//   storyWaitMs 1 min    waiting for a press, the page turns anyway after a minute: the invariant's way out. "Never" is
//                        the person's own choice.
//   readAloud on         it is a story read aloud. Off shows the words for somebody who would rather read.
//   storyText 'normal'   the words at the size that leaves the picture big. Large for reading across a room; the words
//                        are large anyway where there is no voice.
//   heroOutfit 'own'     the person's character as they dressed it: it is theirs. AGAINST: the cast is in the theme's
//                        outfits and the hero can look out of place in a Halloween story; "dressed for the theme" is one
//                        setting away.
//   afterStory 'next', storyRestMs 1 min   FOR going on: a story left running reaches the end of one and, after a quiet
//                        minute, starts the next, so a watcher is never left on "The end" (a picture only a press would
//                        move on from). AGAINST: a voice reading on and off all day. "Stay on The end" is a choice, and
//                        five minutes between stories is in the list.
//   storySource 'builtin' the AI storyteller is not set up anywhere yet.
const SETTINGS = [
  { key: 'storyPick', label: 'Which story', kind: 'choice', default: 'all', level: 'essential',
    options: [{ value: 'all', label: 'Each story in turn' }, ...STORIES.map((s) => ({ value: s.id, label: s.title }))] },
  { key: 'turnPages', label: 'Turning the pages', kind: 'choice', default: DEFAULTS.turnPages, level: 'essential',
    options: [{ value: 'itself', label: 'By itself, after each page is read. A press turns it sooner' },
      { value: 'press', label: 'Wait for a press' }] },
  { key: 'storyPageMs', label: 'How long a page stays after it is read', kind: 'choice', default: DEFAULTS.storyPageMs, level: 'standard',
    options: [4000, 8000, 15000, 30000].map((v) => ({ value: v, label: `${v / 1000} seconds` })),
    appliesWhen: (v) => !v || v.turnPages !== 'press' },
  { key: 'storyWaitMs', label: 'When waiting for a press, turn by itself anyway after', kind: 'choice', default: DEFAULTS.storyWaitMs,
    level: 'standard',
    options: [{ value: 30000, label: '30 seconds' }, { value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' },
      { value: 300000, label: '5 minutes' }, { value: 0, label: 'Never (only a press turns it)' }],
    appliesWhen: (v) => !!v && v.turnPages === 'press' },
  { key: 'readAloud', label: 'Read the story aloud', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No, show the words',
    note: 'If this screen has no voice, the words are shown large instead, and the story still turns by itself.' },
  { key: 'storyText', label: 'Size of the words', kind: 'choice', default: DEFAULTS.storyText, level: 'standard',
    options: [{ value: 'normal', label: 'Normal: the picture stays big' }, { value: 'large', label: 'Large: easy to read across a room' }] },
  { key: 'heroOutfit', label: 'What your character wears in the story', kind: 'choice', default: DEFAULTS.heroOutfit, level: 'standard',
    options: [{ value: 'own', label: 'What you dressed them in' }, { value: 'theme', label: 'Dressed for the theme, like the others' }],
    note: 'Your character comes from the avatar maker\'s "Make a full-body character". Without one, a friendly default character is the hero.' },
  { key: 'afterStory', label: 'After a story', kind: 'choice', default: DEFAULTS.afterStory, level: 'standard',
    options: [{ value: 'next', label: 'A rest, then the next story' }, { value: 'again', label: 'A rest, then the same story again' },
      { value: 'stop', label: 'Stay on "The end" until pressed' }] },
  { key: 'storyRestMs', label: 'Rest between stories', kind: 'choice', default: DEFAULTS.storyRestMs, level: 'standard',
    options: [{ value: 30000, label: '30 seconds' }, { value: 60000, label: '1 minute' }, { value: 300000, label: '5 minutes' }],
    appliesWhen: (v) => !v || v.afterStory !== 'stop' },
  { key: 'storySource', label: 'Where the stories come from', kind: 'choice', default: DEFAULTS.storySource, level: 'advanced',
    options: [{ value: 'builtin', label: 'The stories built in' }, { value: 'ai', label: 'The AI storyteller writes a new one (once it is set up)' }],
    note: 'Until the AI storyteller is set up on this screen, the built-in stories are read either way.' },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

const COURT_WORDS = Object.freeze({ king: /\bking\b|\bbram\b/i, queen: /\bqueen\b|\brosa\b/i, jack: /\bjack\b|\btheo\b/i, joker: /\bpip\b|\bjoker\b/i });
/**
 * An AI storyteller's answer as a page. A page in this file's own shape ({ place, cast, text }) is checked as it is;
 * story_ai.js's ({ ok, text, refused?, care? }) gets its picture here: the first place in the town the words name
 * (by its name in this theme, or its Nimrod name), else `lastPlace`; the court characters the words name, else the
 * hero alone. A refusal or a "please tell somebody" line is shown and ends the story. Null when it is no page.
 */
export function aiPage(raw, deck = 'nimrod', lastPlace = 'park') {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.place) return checkPage(raw);
  if (raw.ok === false || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  const text = raw.text;
  const low = text.toLowerCase();
  let place = null, firstAt = Infinity;
  for (const id of PLACE_IDS) {
    for (const name of [placeInfo(id, deck).label, placeInfo(id, 'nimrod').label]) {
      const n = String(name || '').toLowerCase().replace(/^the /, '');
      const m = n ? new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(low) : null;
      const i = m ? m.index : -1;
      if (i >= 0 && i < firstAt) { firstAt = i; place = id; }
    }
  }
  const cast = ['hero', ...Object.keys(COURT_WORDS).filter((r) => COURT_WORDS[r].test(text))];
  const p = checkPage({ place: place || lastPlace, cast, text });
  if (!p) return null;
  return raw.refused || raw.care || raw.end === true ? { ...p, end: true } : p;
}

const STYLE_ID = 'story-style';
const CSS = `
.st-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;container-type:size;font-family:var(--font);cursor:pointer}
.st-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px}
.st-wrap *{box-sizing:border-box}
.st{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto auto;gap:.35rem;padding:.45rem;position:relative}
.st [hidden]{display:none !important}
.st-pic{min-height:0;display:flex;align-items:center;justify-content:center;border-radius:12px;overflow:hidden}
.st-pic svg{display:block;width:100%;height:100%;max-height:100%}
.st-words{margin:0;padding:.3em .6em;border-radius:12px;background:var(--surface);color:var(--text-strong, var(--text));
  font:600 clamp(15px,5cqh,30px)/1.3 var(--font);text-align:center}
.st-words[data-size="large"]{font-size:clamp(20px,8.5cqh,52px)}
.st-words[data-title]{font-weight:800}
.st-bar{display:flex;justify-content:space-between;gap:1rem;align-items:baseline;min-height:1.2em}
.st-bar p{margin:0;font-size:clamp(12px,2.4cqh,17px);color:var(--text)}
.st-paused{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font-weight:800;font-size:clamp(18px,8cqh,56px);color:var(--text-strong, var(--text))}
.st-paused span{padding:.05em .4em;border-radius:.3em;background:var(--surface)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

registerModule(
  { type: TYPE, title: TITLE, core: 'new',
    description: 'A short picture story read aloud, page by page. You are the hero, the King, the Queen, Jack and Robin are '
      + 'the cast, and it all happens in the theme\'s town. Any press turns the page, and it can turn by itself.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const clear = (h) => { if (h != null) { try { clearT(h); } catch { /* gone */ } } return null; };

    let cfg = { ...DEFAULTS };
    let dead = false, hidden = false, paused = false;
    let rootEl = null, picEl = null, wordsEl = null, noteEl = null, countEl = null, pausedEl = null;
    let themeWatch = null, townStore = null, offTown = null;
    let avatarStore = null, avatarFor = null, offAvatar = null;
    // The story: `pages` are checked pages; `at` is -1 for the cover, pages.length for "The end".
    let storyId = null, title = '', pages = [], at = -1, ai = null, aiState = 'off', aiPending = null, wantTurn = false;
    let turnTimer = null, speechTimer = null, aiTimer = null;
    let seq = 0, speakingId = null, reading = false;
    let voice = 'unknown';       // 'unknown' | 'ok' | 'none'
    let voiceNoted = false;
    let note = '';
    let lastPic = '';
    const said = [];

    const deckNow = () => deckFor(themeWatch ? themeWatch.id() : 'default');
    const ended = () => at >= pages.length && aiState !== 'more';

    // ---- the hero ---------------------------------------------------------------------------------------------
    function heroRecord() {
      const pid = personOf(ctx);
      if (pid && typeof ctx.makePersonState === 'function' && avatarFor !== pid) {
        try { offAvatar?.(); } catch { /* gone */ }
        try { avatarStore?.destroy?.(); } catch { /* gone */ }
        avatarStore = null; offAvatar = null; avatarFor = pid;
        try { avatarStore = ctx.makePersonState(pid, AVATAR_KEY) || null; } catch { avatarStore = null; }
        if (avatarStore) {
          Promise.resolve(avatarStore.load?.()).catch(() => {}).then(() => { if (!dead) { lastPic = ''; render(); } });
          try { offAvatar = avatarStore.subscribe?.(() => { if (!dead) { lastPic = ''; render(); } }) || null; } catch { offAvatar = null; }
        }
      }
      const row = avatarStore ? avatarStore.get?.() : (state?.get?.() || {})[AVATAR_KEY];
      return readAvatar(row || {}).figure || null;
    }

    // ---- speech -------------------------------------------------------------------------------------------------
    function noVoice() {
      if (voice === 'none') return;
      voice = 'none';
      if (!voiceNoted) { voiceNoted = true; note = 'This screen has no voice, so the words are shown large.'; }
      render();
    }
    function speak(text) {
      if (!text || !cfg.readAloud || dead || hidden || paused) return false;
      if (!ctx.output?.say) { noVoice(); return false; }
      const mine = seq;
      reading = true;
      let id = null;
      try {
        id = ctx.output.say(text, { source: TYPE, onReport: (rec) => {
          if (!rec || mine !== seq) return;
          if (rec.delivered) { if (rec.channel === 'speech' || rec.channel == null) voice = 'ok'; doneReading(mine); return; }
          if (['no-adapter', 'no-channel', 'failed', 'muted'].includes(rec.reason)) { noVoice(); doneReading(mine); return; }
          if (rec.reason === 'expired' || rec.reason === 'queue-full' || rec.reason === 'preempted') doneReading(mine);
        } });
      } catch (err) { console.error('story: say', err); reading = false; noVoice(); return false; }
      speakingId = id;
      said.push(text);
      if (said.length > 60) said.shift();
      if (reading) speechTimer = setT(() => { speechTimer = null; doneReading(mine); }, SPEECH_WAIT_MAX_MS);
      return reading;
    }
    function hush() {
      speechTimer = clear(speechTimer);
      if (speakingId && ctx.output?.cancel) { try { ctx.output.cancel(speakingId); } catch { /* gone */ } }
      speakingId = null; reading = false;
    }
    function doneReading(mine) {
      if (mine !== seq || !reading) return;
      reading = false; speakingId = null;
      speechTimer = clear(speechTimer);
      armTurn();
    }

    // ---- turning by itself --------------------------------------------------------------------------------------
    function textNow() {
      if (at < 0) return title;
      if (at >= pages.length) return 'The end.';
      return pageText(pages[at].text, deckNow());
    }
    function armTurn() {
      turnTimer = clear(turnTimer);
      if (dead || hidden || paused || reading) return;
      let ms;
      if (ended()) {
        if (cfg.afterStory === 'stop') return;
        ms = Number(cfg.storyRestMs) || DEFAULTS.storyRestMs;
      } else if (cfg.turnPages === 'press') {
        ms = Number(cfg.storyWaitMs);
        if (!(ms > 0)) return;
      } else {
        ms = Number(cfg.storyPageMs) || DEFAULTS.storyPageMs;
        if (!cfg.readAloud || voice === 'none') ms += words(textNow()) * READ_MS_PER_WORD;
      }
      turnTimer = setT(() => { turnTimer = null; turn(1, { byItself: true }); }, ms);
    }

    // ---- the story ----------------------------------------------------------------------------------------------
    function builtIn(id) {
      const s = storyById(id) || STORIES[0];
      storyId = s.id; title = s.title; ai = null; aiState = 'off';
      pages = s.pages.map((p) => checkPage(p)).filter(Boolean);
    }
    async function loadAi() {
      if (ctx.storyAi && typeof ctx.storyAi.nextPage === 'function') return ctx.storyAi;
      try {
        const m = await import(new URL('../story_ai.js', import.meta.url).href);
        return m && typeof m.nextPage === 'function' ? m : null;
      } catch { return null; }
    }
    // story_ai.js's contract (its `nextPage`): { ctx, theme, hero, title, pages: [text], summary } in, and
    // { ok, text, summary, refused?, care?, noAI? } out, never a throw. The words are the storyteller's; the PICTURE is
    // chosen here (`aiPage`): the place and the people the page names, else the last page's place and the hero alone.
    let aiSummary = '';
    function aiContext() {
      const deck = deckNow();
      const rec = heroRecord();
      return {
        ctx, theme: deck, title, summary: aiSummary,
        hero: rec ? describeFigure(rec) : '',
        pages: pages.map((p) => pageText(p.text, deck)),
        // Also given, for a storyteller that wants them: the places by id and the cast by role.
        places: PLACE_IDS.map((id) => { const p = placeInfo(id, deck); return { id, label: p.label, blurb: p.blurb }; }),
        cast: [{ role: 'hero', name: 'you' }, ...Object.entries(COURT_NAMES).map(([role, name]) => ({ role, name }))],
        pageNumber: pages.length + 1,
        maxPages: AI_MAX_PAGES,
      };
    }
    function askAi() {
      if (!ai || aiPending || aiState !== 'more') return;
      const mine = storyId;
      let settled = false;
      aiPending = Promise.resolve().then(() => ai.nextPage(aiContext()));
      aiTimer = setT(() => { aiTimer = null; if (!settled) { settled = true; aiPending = null; aiFailed(); } }, AI_WAIT_MS);
      aiPending.then((raw) => {
        if (settled || dead || mine !== storyId) return;
        settled = true; aiTimer = clear(aiTimer); aiPending = null;
        if (raw && raw.noAI) { aiFailed({ notSetUp: true }); return; }
        const p = aiPage(raw, deckNow(), pages.length ? pages[pages.length - 1].place : 'park');
        if (!p) { aiFailed(); return; }
        if (raw && typeof raw.summary === 'string') aiSummary = raw.summary.slice(0, 2000);
        pages.push(p);
        if (p.end || pages.length >= AI_MAX_PAGES) aiState = 'done';
        if (wantTurn) { wantTurn = false; turn(1); }
        else render();
      }, () => { if (!settled) { settled = true; aiTimer = clear(aiTimer); aiPending = null; aiFailed(); } });
    }
    function aiFailed({ notSetUp = false } = {}) {
      if (dead) return;
      if (pages.length) { aiState = 'done'; note = 'The storyteller stopped here.'; if (wantTurn) { wantTurn = false; turn(1); } else render(); return; }
      note = notSetUp ? 'The AI storyteller is not set up on this screen, so here is a story from the book.'
        : 'The AI storyteller did not answer, so here is a story from the book.';
      builtIn(nextStoryId(storyId, { only: cfg.storyPick }));
      at = -1; showPage();
    }
    async function startStory(id) {
      seq++; hush();
      turnTimer = clear(turnTimer); aiTimer = clear(aiTimer); aiPending = null; wantTurn = false;
      if (cfg.storySource === 'ai') {
        const m = await loadAi();
        if (dead) return;
        if (m) {
          ai = m; aiState = 'more'; storyId = `ai${Date.now()}`; title = 'A new story'; pages = []; at = -1;
          askAi(); showPage(); return;
        }
        note = 'The AI storyteller is not set up on this screen, so here is a story from the book.';
      }
      builtIn(id);
      at = -1;
      showPage();
    }
    function showPage() {
      seq++;
      hush();
      turnTimer = clear(turnTimer);
      render();
      if (ai && aiState === 'more' && at >= pages.length - 1) askAi();
      const t = textNow();
      if (!speak(t)) armTurn();
    }
    function turn(dir, { byItself = false } = {}) {
      if (dead) return;
      if (dir > 0) {
        if (ended()) { startStory(nextStoryId(storyId, { after: cfg.afterStory === 'again' ? 'again' : 'next', only: cfg.storyPick })); return; }
        if (at + 1 >= pages.length && ai && aiState === 'more') { wantTurn = true; askAi(); note = 'The storyteller is thinking.'; render(); return; }
        at += 1;
      } else {
        if (at <= -1) { showPage(); return; }
        at -= 1;
      }
      if (!byItself) note = voice === 'none' ? note : '';
      showPage();
    }
    function again() { if (!dead) showPage(); }
    function pause() {
      if (dead || paused) return;
      paused = true; hush(); turnTimer = clear(turnTimer); render();
    }
    function resume() {
      if (dead || !paused) return;
      paused = false; render(); showPage();
    }
    // Every press-shaped input: a paused story goes on; otherwise the page turns.
    const press = (dir) => { if (paused) { resume(); return; } turn(dir); };

    // ---- drawing ------------------------------------------------------------------------------------------------
    function picture() {
      const deck = deckNow();
      const town = townStore ? townStore.forDeck(deck) : {};
      const page = at < 0 ? pages[0] : at >= pages.length ? pages[pages.length - 1] : pages[at];
      const place = page ? page.place : 'park';
      const cast = at < 0 || at >= pages.length ? [{ role: 'hero', pose: 'wave' }]
        : page.cast.map((role) => ({ role, pose: 'stand' }));
      const who = cast.map((c) => (c.role === 'hero' ? 'you' : COURT_NAMES[c.role])).join(', ');
      const label = `${placeInfo(place, deck).label}, with ${who}`;
      return sceneSvg({ place, deck, edited: town[place] || null, cast, hero: heroRecord(), heroOutfit: cfg.heroOutfit, title: label });
    }
    function render() {
      if (dead || !rootEl) return;
      const pic = picture();
      if (pic !== lastPic) { picEl.innerHTML = pic; lastPic = pic; }
      const big = cfg.storyText === 'large' || voice === 'none' || !cfg.readAloud;
      wordsEl.dataset.size = big ? 'large' : 'normal';
      wordsEl.toggleAttribute('data-title', at < 0 || at >= pages.length);
      const t = at < 0 ? title : textNow();
      if (wordsEl.textContent !== t) wordsEl.textContent = t;
      const total = pages.length + (aiState === 'more' ? 1 : 0);
      countEl.textContent = at < 0 ? title : at >= pages.length ? 'The end' : `Page ${at + 1} of ${aiState === 'more' ? `${total}+` : total}`;
      noteEl.textContent = note;
      pausedEl.hidden = !paused;
      rootEl.dataset.page = String(at);
      rootEl.dataset.voice = voice;
    }

    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      e.preventDefault();
      press(1);
    }
    function onKey(e) {
      if (dead || e.repeat) return;
      let act = null;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowDown') act = () => press(1);
      else if (e.key === 'ArrowLeft') act = () => press(-1);
      else if (e.key === 'ArrowUp') act = () => again();
      else if (e.key === 'Escape') act = () => (paused ? resume() : pause());
      if (act) { e.preventDefault(); e.stopPropagation(); act(); }
    }

    return {
      __probe: () => ({ storyId, title, at, pages: pages.length, paused, voice, note, said: said.slice(), reading,
        cfg: { ...cfg }, aiState, turnPending: turnTimer != null, text: textNow(),
        timers: [turnTimer, speechTimer, aiTimer].filter((h) => h != null).length }),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStyle(doc);
        mount.innerHTML = `<div class="st-wrap" data-st-root tabindex="0" aria-label="${esc(TITLE)}"><div class="st">`
          + '<div class="st-pic" data-pic></div><p class="st-words" data-words aria-live="polite"></p>'
          + '<div class="st-bar"><p data-count></p><p data-note role="status"></p></div>'
          + '<div class="st-paused" data-paused hidden><span>Paused</span></div></div></div>';
        rootEl = mount.querySelector('[data-st-root]');
        picEl = mount.querySelector('[data-pic]');
        wordsEl = mount.querySelector('[data-words]');
        noteEl = mount.querySelector('[data-note]');
        countEl = mount.querySelector('[data-count]');
        pausedEl = mount.querySelector('[data-paused]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);

        const applyCfg = (snap) => {
          const s = snap || {};
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined && s[k] !== null) next[k] = s[k];
          cfg = next;
        };
        applyCfg(state?.get?.());
        townStore = openTownEdits({ makePersonState: typeof ctx.makePersonState === 'function' ? ctx.makePersonState : null,
          personId: () => personOf(ctx) });
        offTown = townStore.subscribe(() => { lastPic = ''; render(); });
        themeWatch = watchTheme(mount, () => { lastPic = ''; render(); });
        state?.subscribe?.((s) => {
          const was = { ...cfg };
          applyCfg(s);
          if (was.storyPick !== cfg.storyPick || was.storySource !== cfg.storySource) {
            startStory(cfg.storyPick !== 'all' ? cfg.storyPick : storyId || STORY_IDS[0]); return;
          }
          if (was.readAloud !== cfg.readAloud && !cfg.readAloud) hush();
          lastPic = ''; render();
          if (!reading) armTurn();
        });

        bus.subscribe(`${TYPE}/next`, () => press(1));
        bus.subscribe(`${TYPE}/prev`, () => press(-1));
        bus.subscribe(`${TYPE}/again`, () => again());
        bus.subscribe(`${TYPE}/pause`, () => pause());
        bus.subscribe(`${TYPE}/resume`, () => resume());
        startStory(cfg.storyPick !== 'all' ? cfg.storyPick : STORY_IDS[0]);
      },
      onResize() { /* the layout is CSS */ },
      onHide() { hidden = true; hush(); turnTimer = clear(turnTimer); },
      onShow() { hidden = false; if (!paused) showPage(); },
      destroy() {
        dead = true;
        hush();
        turnTimer = clear(turnTimer); aiTimer = clear(aiTimer);
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('keydown', onKey);
        try { offTown?.(); } catch { /* gone */ }
        try { townStore?.destroy(); } catch { /* gone */ }
        try { offAvatar?.(); } catch { /* gone */ }
        try { avatarStore?.destroy?.(); } catch { /* gone */ }
        try { themeWatch?.stop(); } catch { /* gone */ }
      },
    };
  },
);
