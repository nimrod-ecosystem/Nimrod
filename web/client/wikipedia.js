// wikipedia.js — LOOK A QUIZ QUESTION UP ON WIKIPEDIA (row 2.24's fact check, register 258).
//
// Mike, 2026-09-28: the fact check "looks claims up" ("I meant looking it up, not going from
// memory"), and the source is "Wikipedia". This file is only the looking-up half: it finds the
// articles and hands back their text. What the text MEANS for a question is decided in
// `transcript_quiz.js` (`factCheck`), and the lookup NEVER changes an answer key — the most it can
// lead to is a flag that holds a question back until a person looks.
//
// *** WHAT IS SENT, AND ONLY THIS. *** Two searches per question: the question's text on its own,
// and the question's text followed by the answer the video gave. Nothing else: never the
// transcript, never the line the answer was quoted from, never a person's name, profile, topic
// or anything about who is asking. The question and answer are words a model wrote about a public
// video. The browser itself adds what every web request carries (this device's address and the
// browser's own identification); no cookies — `credentials: 'omit'`.
//
// *** THE ENDPOINT, ARGUED. *** MediaWiki's Action API, `generator=search` + `prop=extracts`
// (`exintro`, `explaintext`): ONE request returns the top few search hits WITH each one's plain-text
// introduction. The other candidate, the REST `page/summary/{title}` endpoint, returns one
// article's first paragraph and needs a search request first and then one request per article —
// three or four round trips for what this does in one, and a shorter text (only the first
// paragraph). `origin=*` is what makes an anonymous cross-site request work from a browser; it
// was verified against the live API from this desktop, 2026-09-28 (answers with
// `Access-Control-Allow-Origin: *`). No key, no account.
//
// *** WHY TWO SEARCHES. *** Measured 2026-09-28: searching the question with the answer attached
// ranks articles about the ANSWER first — for "What is the capital of Australia? Sydney" the top
// three were all about Sydney, none of which says what the capital is. The question on its own
// finds what Wikipedia says the answer is (the Australian Capital Territory's article). Both run
// at once and the hits are interleaved, so evidence for AND against the video's answer is in view.
//
// *** THE TEXT IS TRIMMED BEFORE ANY MODEL SEES IT, and that is a time decision. *** A CPU-only
// 7B model reads about 20 tokens a second; three full introductions are 2-3 thousand tokens, a
// couple of minutes per question. `pickEvidence` keeps each article's first sentence (what the
// article is about) plus the sentences sharing the most words with the question and answer, up to
// `EVIDENCE_CHARS` in all — measured at 400-570 prompt tokens and 15-35 s per question. The full
// introduction is kept alongside (`extract`), because a quote is verified against Wikipedia's own
// text, not against the trimmed copy.
//
// NEVER THROWS INTO A MODULE. Every call resolves to `{ ok: true, articles }` or
// `{ ok: false, reason, offline?, timedOut?, cancelled? }`. Offline means NOT CHECKED — never
// "wrong" — and the caller records it as exactly that.
//
// Licence: Wikipedia's text is CC BY-SA. What is kept from it is one quoted sentence per question,
// shown with the article's title and a link to it, which is the attribution the licence asks for.

export const WIKI_API = 'https://en.wikipedia.org/w/api.php';
export const DEFAULT_TIMEOUT_MS = 15 * 1000;     // per request; Wikipedia answers in ~0.5-1 s here
export const MAX_ARTICLES = 3;
export const EVIDENCE_CHARS = 1500;

// ---------------------------------------------------------------------------------------------
// building the request
// ---------------------------------------------------------------------------------------------

/**
 * Text as a plain search: lowercase, letters/digits/spaces/apostrophes/hyphens only, at most ~250
 * characters. CirrusSearch treats quotes, `-word`, `!word`, `intitle:`, `*`, `~` and uppercase
 * AND/OR/NOT as syntax; a question is words, not a query language, so none of that survives.
 */
export function searchText(text) {
  const s = String(text == null ? '' : text).normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s'’-]+/gu, ' ')
    .replace(/(^|\s)[-'’]+/g, '$1')
    .replace(/\s+/g, ' ').trim();
  if (s.length <= 250) return s;
  const cut = s.slice(0, 250);
  const sp = cut.lastIndexOf(' ');
  return (sp > 100 ? cut.slice(0, sp) : cut).trim();
}

/** The two searches for one question, deduplicated, empty ones dropped. */
export function searchQueries(question, answer) {
  const q = searchText(question);
  const qa = searchText(`${question || ''} ${answer || ''}`);
  return [...new Set([q, qa])].filter(Boolean);
}

export function searchURL(query, { limit = MAX_ARTICLES, base = WIKI_API } = {}) {
  const n = String(Math.max(1, Math.min(10, Math.floor(Number(limit) || MAX_ARTICLES))));
  const p = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: String(query || ''), gsrlimit: n, gsrnamespace: '0',
    prop: 'extracts|info|pageprops', ppprop: 'disambiguation',
    exintro: '1', explaintext: '1', exlimit: n,
    inprop: 'url', redirects: '1', format: 'json', formatversion: '2', origin: '*',
  });
  return `${base}?${p}`;
}

// ---------------------------------------------------------------------------------------------
// reading the answer
// ---------------------------------------------------------------------------------------------

const articleURL = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;

/**
 * `[{ title, url, extract }]` in search order, from an API reply. Disambiguation pages ("Bees Make
 * Honey may refer to...") and pages with no introduction (list pages) are left out — neither says
 * anything a question can be checked against. Tolerates formatversion 1 (pages as an object).
 * Garbage in is `[]`.
 */
export function parseResults(json) {
  const raw = json && json.query && json.query.pages;
  const pages = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return pages
    .filter((p) => p && typeof p.title === 'string' && typeof p.extract === 'string' && p.extract.trim()
      && !(p.pageprops && Object.prototype.hasOwnProperty.call(p.pageprops, 'disambiguation')))
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
    .map((p) => ({
      title: p.title,
      url: typeof p.fullurl === 'string' && /^https:\/\/[a-z-]+\.wikipedia\.org\//.test(p.fullurl) ? p.fullurl : articleURL(p.title),
      extract: p.extract.trim(),
    }));
}

/** Sentences of a plain-text extract. A rough split; a wrong boundary only costs context. */
export function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

const STOP = new Set(('a an the of in on at to for and or by with from is are was were be been it its that this '
  + 'these those as into their they them there than then so which who whom whose what when where why how '
  + 'about can do does did has have had not no yes very just also')
  .split(' '));
/** Content words of a text, for scoring sentences: lowercase, no stopwords, 3+ letters. */
export function termsOf(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w)));
}

/**
 * Each article trimmed to what a model needs to read: its first sentence, plus the sentences
 * sharing the most `terms`, in their original order, within an equal share of `budget` characters.
 * Adds `text` (the trimmed copy) and keeps `extract` (the whole introduction).
 */
export function pickEvidence(articles, terms, { budget = EVIDENCE_CHARS } = {}) {
  const list = Array.isArray(articles) ? articles : [];
  if (!list.length) return [];
  const want = terms instanceof Set ? terms : termsOf(terms);
  const share = Math.max(200, Math.floor(budget / list.length));
  return list.map((a) => {
    const ss = splitSentences(a.extract);
    const keep = new Set(ss.length ? [0] : []);
    let used = ss.length ? ss[0].length : 0;
    const scored = ss.map((s, i) => {
      const t = termsOf(s);
      let n = 0; for (const w of want) if (t.has(w)) n++;
      return { i, n, len: s.length };
    }).filter((x) => x.i !== 0 && x.n > 0).sort((x, y) => y.n - x.n || x.i - y.i);
    for (const x of scored) {
      if (used + x.len + 1 > share) continue;
      keep.add(x.i); used += x.len + 1;
    }
    return { ...a, text: [...keep].sort((x, y) => x - y).map((i) => ss[i]).join(' ') };
  });
}

// ---------------------------------------------------------------------------------------------
// the client
// ---------------------------------------------------------------------------------------------

export const REASONS = Object.freeze({
  offline: 'Could not reach Wikipedia, so this was not checked.',
  timeout: 'Wikipedia took too long to answer, so this was not checked.',
  cancelled: 'Stopped before it was checked.',
  unreadable: 'Wikipedia answered, but the answer could not be read, so this was not checked.',
  http: (status) => `Wikipedia answered with an error (${status || '?'}), so this was not checked.`,
});

/** `fetchImpl` is injectable for tests. */
export function createWikipedia({ fetchImpl = (...a) => fetch(...a), timeoutMs = DEFAULT_TIMEOUT_MS,
                                  base = WIKI_API, maxArticles = MAX_ARTICLES, budget = EVIDENCE_CHARS } = {}) {
  async function get(url, signal) {
    if (signal?.aborted) return { ok: false, cancelled: true, reason: REASONS.cancelled };
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    const onCancel = () => ctl.abort();
    signal?.addEventListener?.('abort', onCancel);
    try {
      const res = await fetchImpl(url, { method: 'GET', credentials: 'omit', signal: ctl.signal });
      if (!res || !res.ok) return { ok: false, status: res?.status, reason: REASONS.http(res?.status) };
      try { return { ok: true, json: await res.json() }; } catch {
        if (timedOut) return { ok: false, timedOut: true, reason: REASONS.timeout };
        if (signal?.aborted) return { ok: false, cancelled: true, reason: REASONS.cancelled };
        return { ok: false, reason: REASONS.unreadable };
      }
    } catch (err) {
      if (timedOut) return { ok: false, timedOut: true, reason: REASONS.timeout };
      if (signal?.aborted || err?.name === 'AbortError') return { ok: false, cancelled: true, reason: REASONS.cancelled };
      return { ok: false, offline: true, reason: REASONS.offline };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onCancel);
    }
  }

  /**
   * `{ ok: true, articles: [{ title, url, extract, text }], queries }` — `articles` may be empty
   * (Wikipedia has nothing on it) — or `{ ok: false, reason, ... }` when no search got an answer.
   * One search failing while the other answers still counts as looked up.
   */
  async function lookup(question, answer, { signal } = {}) {
    const queries = searchQueries(question, answer);
    if (!queries.length) return { ok: false, reason: 'There was nothing to look up.' };
    const replies = await Promise.all(queries.map((q) => get(searchURL(q, { limit: maxArticles, base }), signal)));
    const good = replies.filter((r) => r.ok);
    if (!good.length) {
      const r = replies.find((x) => x.cancelled) || replies.find((x) => x.timedOut) || replies[0];
      return { ok: false, reason: r.reason, offline: !!r.offline, timedOut: !!r.timedOut, cancelled: !!r.cancelled, queries };
    }
    const lists = good.map((r) => parseResults(r.json));
    const seen = new Set();
    const merged = [];
    for (let i = 0; merged.length < maxArticles && lists.some((l) => i < l.length); i++) {
      for (const l of lists) {
        const a = l[i];
        if (!a || seen.has(a.title) || merged.length >= maxArticles) continue;
        seen.add(a.title); merged.push(a);
      }
    }
    return { ok: true, queries, articles: pickEvidence(merged, termsOf(`${question || ''} ${answer || ''}`), { budget }) };
  }

  return { lookup };
}
