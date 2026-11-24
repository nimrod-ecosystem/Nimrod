// modules/didyouknow.js — DID YOU KNOW: a fact, a quote or a word, one card at a time (row 2.223, notes FE 5 and FH).
//
// Mike, 2026-11-06: research saved once, used everywhere; chat's packs are facts (15 topics), quotes (12 groups) and words
// (6 levels), every fact and quote checked against a source. This is the FRONT END FE 5's answer described: one module that
// shows any mix, with "Show only these" (facts / quotes / words). Facts, Quotes and Words are the same module listed again
// with that row set (library.js RESEARCH_PRESETS), as Text is a Button: one module to fix, three names to find it by.
// (Argued against three registered types: each would need its own catalog entry, verbs and suite for a difference of one
// setting, and a saved screen keyed on a type could never be switched between them.)
//
// WHAT IT READS: research_index.js, the one index, never a pack itself; so what may be shown is decided there (flagged never;
// facts and quotes only when checked, unless "Only checked ones" is off; words unless flagged). The packs are the site's
// `research/` folder (`research/index.json` names them); none there yet is an empty card that says so.
// HOW IT MOVES: a new card every minute by default ("A new one every", or only on Next), in a shuffled order of its own
// (2026-11-22: a random seed on the panel's row, new every round, so it does not repeat until it has shown them all, and
// not the same order every time), resumed where it was. Next / Previous / Read it are buttons,
// and the verbs `next`, `prev`, `select` (read it aloud) for a switch or a voice.
// READ ALOUD: OFF by default, argued. FOR on: a card nobody can read is no card. AGAINST, and it wins as the default: a panel
// that talks every minute on its own interrupts everything else on the screen (a call, a video, the board); "Read it" (and
// `select`) says it on request, and the row turns it on for a screen where a voice is wanted.

import { registerModule } from '../module.js';
import { find, itemLine, RESEARCH_KINDS } from '../research_index.js';
// (2026-11-23) The loader moved to research_load.js, shared with the word games; re-exported for the suites.
import { loadResearch, sharedResearch, forgetResearchForTest } from '../research_load.js';
import { createWordLevel } from '../word_filter.js';
export { loadResearch, forgetResearchForTest };

export const DYK_TYPE = 'didyouknow';
export const DYK_SHOW = Object.freeze(['all', 'fact', 'quote', 'word']);
// Every minute, argued: a fact or a quote is read in well under a minute, and a screen people glance at changes often enough
// to be worth a glance; slower for a panel that sits in a corner, never faster than 15 s (a card must be readable).
export const DYK_EVERY = Object.freeze([0, 15000, 30000, 60000, 120000, 300000, 900000]);
export const DYK_DEFAULTS = Object.freeze({ show: 'all', topics: '', wordLevel: 'all', onlyChecked: true, everyMs: 60000,
  readAloud: false, showSource: true, sameOrder: false });
// The credit that stands whatever the row says (note FV): where the words' meanings come from.
export const DYK_CREDITS = 'Word meanings are based on Open English WordNet 2025 (Global WordNet Association, CC BY 4.0), reworded.';

export const DYK_SETTINGS = [
  { key: 'show', label: 'Show only these', kind: 'choice', default: 'all', level: 'essential',
    options: [{ value: 'all', label: 'Facts, quotes and words' }, { value: 'fact', label: 'Facts' },
      { value: 'quote', label: 'Quotes' }, { value: 'word', label: 'Words' }] },
  { key: 'everyMs', label: 'A new one every', kind: 'choice', default: 60000, level: 'standard',
    options: DYK_EVERY.map((ms) => ({ value: ms, label: ms === 0 ? 'Only when Next is pressed'
      : ms < 60000 ? `${ms / 1000} seconds` : ms === 60000 ? '1 minute' : `${ms / 60000} minutes` })) },
  { key: 'topics', label: 'Which topics', kind: 'text', default: '', level: 'standard', maxLength: 200,
    placeholder: 'space, animals', note: 'Topics or tags, separated by commas. Empty: all of them.' },
  { key: 'wordLevel', label: 'Words: which level', kind: 'choice', default: 'all', level: 'standard',
    options: [{ value: 'all', label: 'All levels' }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: n,
      label: n === 1 ? '1 (first words)' : n === 6 ? '6 (rare words)' : String(n) }))] },
  { key: 'readAloud', label: 'Read each one aloud', default: false, level: 'standard', onLabel: 'Yes', offLabel: 'No, only on Read it' },
  { key: 'showSource', label: 'Say where it came from', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No',
    note: DYK_CREDITS },
  { key: 'onlyChecked', label: 'Only checked facts and quotes', default: true, level: 'advanced', onLabel: 'Yes', offLabel: 'No',
    note: 'Every fact and quote is checked against a source. One the check found wrong is never shown, whatever this says.' },
  // (2026-11-22, row 2.282; Mike: "It should use the shuffle feature.") Off, the default: each panel shuffles, and nothing
  // repeats until everything has shown, then it shuffles again. On: every screen walks one order (two screens side by side
  // agree, a class can follow along). AGAINST on as the default: the same panel showed the same cards in the same order.
  { key: 'sameOrder', label: 'Same order on every screen', default: false, level: 'advanced', onLabel: 'Yes',
    offLabel: 'No, shuffled', note: 'Shuffled: nothing comes round again until everything has been shown.' },
];

/** The settings in force, every value checked. PURE. */
export function dykConfig(s = {}) {
  const c = { ...DYK_DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  if (!DYK_SHOW.includes(c.show)) c.show = 'all';
  c.everyMs = DYK_EVERY.includes(Number(c.everyMs)) ? Number(c.everyMs) : DYK_DEFAULTS.everyMs;
  const lv = Number(c.wordLevel);
  c.wordLevel = Number.isInteger(lv) && lv >= 1 && lv <= 6 ? lv : 'all';
  c.topics = typeof c.topics === 'string' ? c.topics : '';
  c.onlyChecked = c.onlyChecked !== false; c.readAloud = c.readAloud === true; c.showSource = c.showSource !== false;
  c.sameOrder = c.sameOrder === true;
  return c;
}

/** The question this panel asks of the index. `wordsAllowed`: the screen's "Words the games may use" (note GN). PURE. */
export function dykQuery(cfg, seed, { wordsAllowed } = {}) {
  const tags = cfg.topics.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  return { kind: cfg.show === 'all' ? [...RESEARCH_KINDS] : cfg.show, onlyChecked: cfg.onlyChecked, seed,
    ...(wordsAllowed ? { wordsAllowed } : {}),
    ...(tags.length ? { tags } : {}), ...(cfg.wordLevel !== 'all' && (cfg.show === 'word') ? { level: cfg.wordLevel } : {}) };
}

/** A steady seed from a name (FNV-1a). "Same order on every screen" seeds from the module's name, so screens agree. PURE. */
export function seedOf(id) {
  let h = 2166136261;
  for (const ch of String(id || DYK_TYPE)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- the packs: research_load.js (one fetch per page, shared with the word games) ----------------------------------

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND_HEAD = { fact: 'Did you know?', quote: 'A quote', word: 'A word' };

/** One card's inner HTML. PURE. */
export function cardHtml(item, { showSource = true } = {}) {
  if (!item) return '';
  let body = '';
  if (item.kind === 'quote') {
    body = `<blockquote class="dyk-text">“${esc(item.text)}”</blockquote>`
      + `<p class="dyk-who">${esc(item.speaker)}${item.work ? `, <i>${esc(item.work)}</i>` : ''}${item.year ? ` (${esc(item.year)})` : ''}</p>`;
  } else if (item.kind === 'word') {
    body = `<p class="dyk-word">${esc(item.word)}</p>`
      + (item.partOfSpeech ? `<p class="dyk-pos">${esc(item.partOfSpeech)}</p>` : '')
      + (item.definition ? `<p class="dyk-text">${esc(item.definition)}</p>` : '')
      + (item.example ? `<p class="dyk-example">“${esc(item.example)}”</p>` : '');
  } else {
    body = `<p class="dyk-text">${esc(item.text)}</p>`
      // (note GN, `true_as_of`) A fact that can change says when it was true, rather than state an old number as today's.
      + (item.trueAsOf ? `<p class="dyk-asof" data-dyk-asof>As of ${esc(asOfWords(item.trueAsOf))}</p>` : '');
  }
  const src = showSource && item.sources?.length ? `<p class="dyk-source" data-dyk-source>${esc(sourceWords(item))}</p>` : '';
  return `<p class="dyk-head">${KIND_HEAD[item.kind] || ''}</p>${body}${src}`;
}

// *** THE CREDIT (note FV, 2026-11-08). *** A word's meaning is REWORDED from its source, so it says "based on ... reworded" with
// the source's title and licence: Open English WordNet is CC BY 4.0, which asks for the credit, the licence and a note that it
// was changed. A fact's source is what it was checked against, so it says "From". With "Say where it came from" off, the
// module's own credits still name it (`DYK_CREDITS`, the row's note and ATTRIBUTIONS.md).
function sourceWords(item) {
  const s = item.sources[0];
  if (item.kind === 'word') {
    return `Meaning based on ${s.title || s.publisher || 'a source'}${s.licence ? ` (${s.licence})` : ''}, reworded`;
  }
  return `From ${s.publisher || s.title || 'a source'}${s.licence ? ` (${s.licence})` : ''}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2024", "2024-03" or "2024-03-09" as words: "2024", "March 2024", "9 March 2024". PURE. */
export function asOfWords(v) {
  const [y, m, d] = String(v || '').split('-');
  if (!m) return y || '';
  const month = MONTHS[Number(m) - 1] || '';
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

/** What is read aloud for a card: a quote with who said it; a word, then what it means; a fact, with when it was true. PURE. */
export function cardWords(item) {
  if (!item) return '';
  if (item.kind === 'word') return [item.word, item.definition, item.example].filter(Boolean).join('. ');
  const line = itemLine(item).replace(/[“”]/g, '');
  return item.kind === 'fact' && item.trueAsOf ? `${line} As of ${asOfWords(item.trueAsOf)}.` : line;
}

/**
 * The panel, apart from the module runtime (the suites drive this). `getIndex()` resolves an index; `say(text)` speaks;
 * `state` is `{ get, set }` (the panel's own row: its settings and where it was).
 */
export function mountDidYouKnow(mount, { getIndex, state, say = () => {}, instanceId = DYK_TYPE, rand = Math.random,
  wordsAllowed = () => null, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h) } = {}) {
  let index = null;
  let list = [];
  let timer = null;
  let torn = false;
  const cfg = () => dykConfig(state?.get?.() || {});
  const pos = () => { const p = Number(state?.get?.()?.pos); return Number.isInteger(p) && p >= 0 ? p : 0; };
  // THE ORDER (2026-11-22, row 2.282). Shuffled: a random seed kept on the panel's own row, so it carries on where it was
  // after a reload, and a NEW one each time the whole list has been shown (a "round"). Same order: one seed from the
  // module's name and the round, so every screen with it on walks the same cards. Replaces the seed from the panel's id
  // (instanceId), which gave the same panel the same order every time. One number on the row, not a list of seen ids:
  // walking a shuffled list from where it was already shows nothing twice until all have been shown.
  const newSeed = () => Math.floor(rand() * 4294967296) >>> 0;
  function seedNow() {
    const s = state?.get?.() || {};
    const round = Number.isInteger(Number(s.round)) ? Number(s.round) : 0;
    if (cfg().sameOrder) return (seedOf(DYK_TYPE) + round) >>> 0;
    const v = Number(s.seed);
    if (Number.isInteger(v) && v >= 0) return v;
    const fresh = newSeed();
    state?.set?.({ seed: fresh });
    return fresh;
  }
  function recompute() {
    let allowed = null;
    try { allowed = wordsAllowed(); } catch { allowed = null; }
    list = index ? find(index, dykQuery(cfg(), seedNow(), { wordsAllowed: allowed })) : [];
  }
  function current() { return list.length ? list[pos() % list.length] : null; }
  function arm() {
    if (timer != null) { clearTimer(timer); timer = null; }
    const ms = cfg().everyMs;
    if (torn || !ms || list.length < 2) return;
    timer = setTimer(() => { timer = null; move(1, { auto: true }); }, ms);
  }
  function render() {
    if (torn || !mount) return;
    const it = current();
    const c = cfg();
    const empty = !index ? 'Finding facts…'
      : `No ${c.show === 'all' ? 'facts, quotes or words' : { fact: 'facts', quote: 'quotes', word: 'words' }[c.show]} to show here yet${c.onlyChecked && c.show !== 'word' ? ': only checked ones are shown, and none has been checked yet' : ''}.`;
    mount.innerHTML = `<div class="dyk" data-dyk>
      <div class="dyk-card" aria-live="polite" data-dyk-card>${it ? cardHtml(it, { showSource: c.showSource }) : `<p class="dyk-empty" data-dyk-empty>${esc(empty)}</p>`}</div>
      <div class="dyk-bar">
        <button type="button" data-dyk-act="prev"${list.length > 1 ? '' : ' disabled'}>Previous</button>
        <button type="button" data-dyk-act="say"${it ? '' : ' disabled'}>Read it</button>
        <button type="button" data-dyk-act="next"${list.length > 1 ? '' : ' disabled'}>Next</button>
      </div></div>`;
  }
  function sayNow() { const it = current(); if (it) { try { say(cardWords(it)); } catch (err) { console.error('didyouknow: say', err); } } }
  function move(d, { auto = false } = {}) {
    if (!list.length) return;
    const to = pos() % list.length + d;
    if (to >= list.length && list.length > 1) {
      // A ROUND IS OVER: everything has been shown. A new order, and its first card is never the one just shown.
      const was = current()?.id;
      const s = state?.get?.() || {};
      const round = (Number.isInteger(Number(s.round)) ? Number(s.round) : 0) + 1;
      state?.set?.(cfg().sameOrder ? { round, pos: 0 } : { round, seed: newSeed(), pos: 0 });
      recompute();
      if (list[0]?.id === was) state?.set?.({ pos: 1 });
    } else {
      // Previous from the first card goes to the last of this round, never into a new one.
      state?.set?.({ pos: ((to % list.length) + list.length) % list.length });
    }
    render();
    if (cfg().readAloud) sayNow();     // on a press and on the timer alike: "Read each one aloud" means each
    arm();
    return auto;
  }
  const onClick = (e) => {
    const b = e.target?.closest?.('[data-dyk-act]');
    if (!b || b.disabled) return;
    const act = b.getAttribute('data-dyk-act');
    if (act === 'next') move(1); else if (act === 'prev') move(-1); else if (act === 'say') sayNow();
  };
  mount?.addEventListener?.('click', onClick);
  render();
  Promise.resolve().then(() => getIndex()).then((ix) => { if (torn) return; index = ix; recompute(); render(); arm(); },
    () => { if (torn) return; index = { items: [] }; recompute(); render(); });
  return {
    next: () => move(1), prev: () => move(-1), say: sayNow,
    /** The settings changed: the list and the timer follow, and the card shown stays when it still may be. */
    refresh() { recompute(); render(); arm(); },
    current, size: () => list.length,
    destroy() { torn = true; if (timer != null) clearTimer(timer); timer = null; mount?.removeEventListener?.('click', onClick); },
  };
}

registerModule(
  { type: DYK_TYPE, title: 'Did you know', core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'A fact, a quote or a word, one at a time, each checked against a source. Show only facts, only quotes or only words if you like.',
    settings: DYK_SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    let panel = null;
    // (note GN) The screen's "Words the games may use" row: a fact or quote marked `content` is held back as a word is.
    const words = createWordLevel({ makeState: ctx.makeState });
    let offWords = () => {};
    return {
      init() {
        words.load().then(() => panel?.refresh());
        let was = words.get();
        offWords = words.subscribe(() => { const now = words.get(); if (now !== was) { was = now; panel?.refresh(); } });
        panel = mountDidYouKnow(mount, { getIndex: sharedResearch, state, instanceId: ctx.instanceId,
          wordsAllowed: () => words.get(),
          rand: typeof ctx.rand === 'function' ? ctx.rand : Math.random,
          say: (text) => { if (ctx.output?.say) ctx.output.say(text, { source: DYK_TYPE }); } });
        bus.subscribe(`${DYK_TYPE}/next`, () => panel?.next());
        bus.subscribe(`${DYK_TYPE}/prev`, () => panel?.prev());
        bus.subscribe(`${DYK_TYPE}/select`, () => panel?.say());
        // A settings change (not the card moving on: `pos` is left out) recomputes the list.
        const key = (s) => { const c = dykConfig(s || {}); return JSON.stringify(Object.keys(DYK_DEFAULTS).map((k) => c[k])); };
        let last = key(state.get?.());
        state.subscribe?.((s) => { const now = key(s); if (now !== last) { last = now; panel?.refresh(); } });
      },
      onResize() {},
      onHide() { state.flush?.(); },
      destroy() {
        try { panel?.destroy(); } catch { /* gone */ } panel = null;
        try { offWords(); } catch { /* gone */ } try { words.destroy(); } catch { /* gone */ }
      },
      __probe: () => ({ size: panel?.size?.() || 0, current: panel?.current?.()?.id || null }),
    };
  },
);
