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
// HOW IT MOVES: a new card every minute by default ("A new one every", or only on Next), in an order of its own (seeded by
// the panel, so it does not repeat until it has shown them all), resumed where it was. Next / Previous / Read it are buttons,
// and the verbs `next`, `prev`, `select` (read it aloud) for a switch or a voice.
// READ ALOUD: OFF by default, argued. FOR on: a card nobody can read is no card. AGAINST, and it wins as the default: a panel
// that talks every minute on its own interrupts everything else on the screen (a call, a video, the board); "Read it" (and
// `select`) says it on request, and the row turns it on for a screen where a voice is wanted.

import { registerModule } from '../module.js';
import { readPack, buildIndex, find, itemLine, RESEARCH_KINDS } from '../research_index.js';

export const DYK_TYPE = 'didyouknow';
export const DYK_SHOW = Object.freeze(['all', 'fact', 'quote', 'word']);
// Every minute, argued: a fact or a quote is read in well under a minute, and a screen people glance at changes often enough
// to be worth a glance; slower for a panel that sits in a corner, never faster than 15 s (a card must be readable).
export const DYK_EVERY = Object.freeze([0, 15000, 30000, 60000, 120000, 300000, 900000]);
export const DYK_DEFAULTS = Object.freeze({ show: 'all', topics: '', wordLevel: 'all', onlyChecked: true, everyMs: 60000,
  readAloud: false, showSource: true });
const MAX_PACKS = 100;            // research/index.json names a few dozen; 100 stops a broken index fetching forever

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
  { key: 'showSource', label: 'Say where it came from', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No' },
  { key: 'onlyChecked', label: 'Only checked facts and quotes', default: true, level: 'advanced', onLabel: 'Yes', offLabel: 'No',
    note: 'Every fact and quote is checked against a source. One the check found wrong is never shown, whatever this says.' },
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
  return c;
}

/** The question this panel asks of the index. PURE. */
export function dykQuery(cfg, seed) {
  const tags = cfg.topics.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  return { kind: cfg.show === 'all' ? [...RESEARCH_KINDS] : cfg.show, onlyChecked: cfg.onlyChecked, seed,
    ...(tags.length ? { tags } : {}), ...(cfg.wordLevel !== 'all' && (cfg.show === 'word') ? { level: cfg.wordLevel } : {}) };
}

/** A panel's own seed from its id: the same panel walks the same order. PURE. */
export function seedOf(id) {
  let h = 2166136261;
  for (const ch of String(id || DYK_TYPE)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- the packs: research/index.json and the files it names, read once per page ----------------------------------
let shared = null;
export function loadResearch({ base = new URL('../research/', import.meta.url).href, fetchImpl = (...a) => fetch(...a) } = {}) {
  const json = async (url) => { const r = await fetchImpl(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  return (async () => {
    const b = base.endsWith('/') ? base : `${base}/`;
    let list = [];
    try { const ix = await json(`${b}index.json`); list = Array.isArray(ix?.packs) ? ix.packs : []; } catch { list = []; }
    const files = list.filter((f) => typeof f === 'string' && /^[\w.-]+\.json$/.test(f)).slice(0, MAX_PACKS);
    const packs = await Promise.all(files.map(async (f) => { try { return readPack(await json(`${b}${f}`), { fileName: f }); }
      catch { return { name: f, items: [], problems: [`${f} could not be read`] }; } }));
    return buildIndex(packs);
  })();
}
const sharedResearch = () => (shared ||= loadResearch());
/** For the suites: start again (a new page's worth). */
export function forgetResearchForTest() { shared = null; }

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
    body = `<p class="dyk-text">${esc(item.text)}</p>`;
  }
  const src = showSource && item.sources?.length ? `<p class="dyk-source">From ${esc(item.sources[0].publisher || item.sources[0].title || 'a source')}</p>` : '';
  return `<p class="dyk-head">${KIND_HEAD[item.kind] || ''}</p>${body}${src}`;
}

/** What is read aloud for a card: a quote with who said it; a word, then what it means. PURE. */
export function cardWords(item) {
  if (!item) return '';
  if (item.kind === 'word') return [item.word, item.definition, item.example].filter(Boolean).join('. ');
  return itemLine(item).replace(/[“”]/g, '');
}

/**
 * The panel, apart from the module runtime (the suites drive this). `getIndex()` resolves an index; `say(text)` speaks;
 * `state` is `{ get, set }` (the panel's own row: its settings and where it was).
 */
export function mountDidYouKnow(mount, { getIndex, state, say = () => {}, instanceId = DYK_TYPE,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h) } = {}) {
  let index = null;
  let list = [];
  let timer = null;
  let torn = false;
  const cfg = () => dykConfig(state?.get?.() || {});
  const pos = () => { const p = Number(state?.get?.()?.pos); return Number.isInteger(p) && p >= 0 ? p : 0; };
  function recompute() { list = index ? find(index, dykQuery(cfg(), seedOf(instanceId))) : []; }
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
    state?.set?.({ pos: ((pos() + d) % list.length + list.length) % list.length });
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
    return {
      init() {
        panel = mountDidYouKnow(mount, { getIndex: sharedResearch, state, instanceId: ctx.instanceId,
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
      destroy() { try { panel?.destroy(); } catch { /* gone */ } panel = null; },
      __probe: () => ({ size: panel?.size?.() || 0, current: panel?.current?.()?.id || null }),
    };
  },
);
