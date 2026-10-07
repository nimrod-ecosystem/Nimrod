// walkthrough_wrap.js — WRAPPING UP A WALKTHROUGH (row 2.54): the notes of a walk through the site are CLEANED UP
// (Corpus Desk's ten-level dial, clean_up.js) and each cleaned note approved beside the person's own words; then the
// AI sorts what was said into three lists; then the person and the AI go through the lists one line at a time, and
// the result is saved as a Markdown file in a folder the person picks. Pure apart from the folder writing at the
// bottom (which takes its folder store and window as arguments). modules/nimrod.js draws it.
//
// Mike, 2026-10-07: *"I want it to summarize its walkthrough with me and make notes for you, code, and design. Then I
// want to review its summary and notes with it."*
// *** CORRECTED THE SAME DAY (chat note AY 1; DECISIONS.md, "summaries happen locally", item 2). *** The first build
// (f72f6e5) had the sorting AI also write a new two-to-four-sentence summary. Mike: the summary already exists, in
// Corpus Desk's Clean up dial; port it, don't keep a new summariser; and it has to run LOCALLY, before chat, because he
// talks casually and the summary is what goes to chat, so filler should not cost tokens. So:
//   * THE SUMMARY IS THE CLEAN UP. Every chosen note is cleaned at the level the person picks (1 word for word ... 10
//     one line; default 3, Tidy, as in Corpus Desk), and shown beside the note for approval: "Use this" (the cleaned
//     words, edited if they like) or "Keep mine". Corpus Desk's approval, one note at a time, plus "for all the rest".
//   * THE SORTING reads the approved words, not the raw notes, and writes no summary of its own.
//   * WHO DOES IT (WRAP_WHO): the AI on this computer by default, every time the wrap-up opens. Claude only when the
//     person presses it, and the page says plainly that it sends the notes to Anthropic. Not remembered: a choice that
//     sends notes off the computer is made each time, on purpose.
// Chat's notes on the row are the spec, and each has its place here:
//   (a) THE NOTES STAY WORD FOR WORD AND ARE THE RECORD. Nothing here edits or removes a note: the cleaned words live in
//       the review, beside the note, never in it. The lists are a layer on top, labelled as the AI's everywhere they are
//       shown and in the file. Every note's own words are beside its cleaned words while approving, and one press puts
//       them in the file too (`originals`).
//   (b) EVERY SORTED LINE POINTS BACK to the note(s) it came from (`notes`, note ids). A line the AI wrote with no
//       note behind it is not dropped (the person decides) but it goes to "Not sorted yet", marked as having no
//       note, so nothing invented can sit in a list looking sourced. A note the AI left out comes back as its own
//       "Not sorted yet" line, so nothing said is lost by the sorting.
//   (c) ONE LINE AT A TIME: keep / change / move to another list / drop (`decide`), by press, switch or voice
//       (`parseReviewWords`). The review is plain data, saved after each decision, so it can be left and resumed.
//   (d) WHICH AI: WRAP_WHO, above. With none answering, the same review starts with every note "Not sorted yet" and
//       nothing cleaned (`handReview`).
//   (f) THE FILE (`reviewToMarkdown`): the lists with note numbers, then the summary (every note as approved: cleaned,
//       or in the person's own words), then, only if the person asks, every note word for word as well.
//
// *** WHAT IS SENT TO THE AI: only the notes the person chose to wrap up. To clean one up: its words and where it was
// made (`cleanMessages`, clean_up.js). To sort them: each note's approved words, when it was written, and where (the
// page, the dashboard, the panel picked, and whether it was made as a test person) (`wrapMessages`). Never the name of
// the person who made it. Those two are the only things that build what is sent, and the suite reads both.

import { cleanNotes, stamp, contextLine } from './nimrod_notes.js';
import { cleanText, cleanLevel, levelLine, DEFAULT_CLEAN_LEVEL } from './clean_up.js';

// ---------------------------------------------------------------------------------------------------
// WHO CLEANS AND SORTS. The local one first and the default (Mike: the summarising happens locally, before chat).
// 'online' is offered only when this device has an online address set up for its AI (modules/nimrod.js decides).
// ---------------------------------------------------------------------------------------------------
export const WRAP_WHO = Object.freeze([
  Object.freeze({ id: 'local', label: 'The AI on this computer',
    help: 'Free, and nothing leaves this computer (an AI program such as Ollama). It can take a few minutes.' }),
  Object.freeze({ id: 'online', label: 'Your online AI',
    help: 'The online AI set up for your guide. Choosing it sends the notes you chose to that address.' }),
  Object.freeze({ id: 'claude', label: 'Claude, made by Anthropic',
    help: 'Quicker. Choosing it sends the notes you chose to Anthropic, through this website’s server, paid for with the Claude key saved for this website.' }),
]);
export const DEFAULT_WHO = 'local';
export const isWho = (id) => WRAP_WHO.some((w) => w.id === id);

// ---------------------------------------------------------------------------------------------------
// THE THREE LISTS. Mike's own three, as data: the label shown, and the line that tells the AI what goes in each.
// A DEFAULT, argued: these are the three places Mike's work goes (chat Claude, Claude Code, design). Somebody else
// sending notes to a site's builders might want different lists; the lists are one table so that can become a
// setting without touching the sorting, the review or the file. Not a setting yet: nobody but Mike has asked.
// ---------------------------------------------------------------------------------------------------
export const WRAP_LISTS = Object.freeze([
  Object.freeze({ id: 'chat', label: 'For chat',
    help: 'questions to think through, decisions to make, ideas and plans to talk over: things that are not yet one clear change' }),
  Object.freeze({ id: 'code', label: 'For Code',
    help: 'something broken, or a clear change to how the site works: a feature to add, fix or remove' }),
  Object.freeze({ id: 'design', label: 'For Design',
    help: 'how things look and read: layout, colours, sizes, the words on the page, what is hard to find or see' }),
]);
export const UNSORTED = 'unsorted';
export const UNSORTED_LABEL = 'Not sorted yet';
const LIST_IDS = WRAP_LISTS.map((l) => l.id);
export const listLabel = (id) => (WRAP_LISTS.find((l) => l.id === id)?.label || UNSORTED_LABEL);
export const isList = (id) => LIST_IDS.includes(id) || id === UNSORTED;

// ---------------------------------------------------------------------------------------------------
// HARD-CODED VALUES, each argued:
//   BATCH_NOTES 10 / BATCH_CHARS 12000: the notes go to the AI ten at a time. Claude on this account answers in at
//     most 1,024 tokens (web/server/claude_ai.py CHAT_MAX_TOKENS) and takes at most 60,000 characters in; a small
//     model on this computer has a small window and slows down sharply with a long prompt. Ten notes make roughly
//     ten to twenty lines, which fits an answer of that size with room to spare. Against: more calls (a summary per
//     batch, then one more to join them). A walkthrough of 200 notes is 20 calls; on Claude that is cents.
//   ANSWER_TOKENS 1000: just under the server's own ceiling, so the server does not cut the request down itself.
//   LINE_MAX 300: one line of a list. A longer "line" is a paragraph, and the note itself is beside it anyway.
//   SUMMARY_MAX 1500: a wrap-up made before the correction (f72f6e5) carries the AI's own summary; it is still read
//     back and shown so a review left half way is not lost. New wrap-ups make none.
//   CLEANED_MAX 6000: one cleaned note, as approved (edited words included). Level 1 gives back about what it was
//     given; a note longer than this is a page, and its own words are kept beside it.
//   ITEMS_PER_NOTE 4: a cap on lines per batch (4 x its notes), so a runaway answer cannot bury the review.
//   KEEP_FINISHED 5: finished wrap-ups kept on the person's record (the file is the real copy).
// ---------------------------------------------------------------------------------------------------
export const BATCH_NOTES = 10;
export const BATCH_CHARS = 12000;
export const ANSWER_TOKENS = 1000;
export const LINE_MAX = 300;
export const SUMMARY_MAX = 1500;
export const CLEANED_MAX = 6000;
export const ITEMS_PER_NOTE = 4;
export const KEEP_FINISHED = 5;

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// A cleaned note keeps its line breaks (a level-7 note is often a short list); only the ends are trimmed.
const clipBlock = (s, n) => clip(String(s ?? '').replace(/\r\n?/g, '\n').trim(), n);

// ---------------------------------------------------------------------------------------------------
// WHICH NOTES: a walkthrough is the notes since it was started, or since the last wrap-up, or today, or all of
// them, or a range the person picks (first note to last note).
// ---------------------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (at) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** The ways to choose which notes, each with how many it holds. Ranges with no notes are left out. */
export function rangeChoices(list, { walkStartedAt = 0, lastWrapTo = 0, now = Date.now() } = {}) {
  const notes = cleanNotes(list);
  const count = (from) => notes.filter((n) => n.at > from).length;
  const out = [];
  if (Number(walkStartedAt) > 0) {
    out.push({ id: 'walk', from: Number(walkStartedAt) - 1, label: `Since you started the walkthrough (${stamp(walkStartedAt)})`, count: count(Number(walkStartedAt) - 1) });
  }
  if (Number(lastWrapTo) > 0) out.push({ id: 'last', from: Number(lastWrapTo), label: `Since your last wrap-up (${stamp(lastWrapTo)})`, count: count(Number(lastWrapTo)) });
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  out.push({ id: 'today', from: today.getTime() - 1, label: `Today’s notes (${dayOf(now)})`, count: count(today.getTime() - 1) });
  out.push({ id: 'all', from: -1, label: 'All your notes', count: notes.length });
  return out.filter((r) => r.count > 0);
}

/** The first choice worth suggesting: the walkthrough, else since the last wrap-up, else today, else all. */
export const suggestedRange = (choices) => (choices || [])[0] || null;

/** Notes in a range: `{ from }` (exclusive time) and/or `{ fromId, toId }` (inclusive, by id). Oldest first. */
export function notesInRange(list, { from = -1, fromId = '', toId = '' } = {}) {
  const notes = cleanNotes(list);
  let a = 0;
  let b = notes.length - 1;
  if (fromId) { const i = notes.findIndex((n) => n.id === fromId); if (i >= 0) a = i; }
  if (toId) { const i = notes.findIndex((n) => n.id === toId); if (i >= 0) b = i; }
  if (b < a) [a, b] = [b, a];
  return notes.slice(a, b + 1).filter((n) => n.at > Number(from));
}

// ---------------------------------------------------------------------------------------------------
// WHAT IS SENT. Notes are numbered 1..N within the wrap-up (the AI points back by number; the file uses the same
// numbers). Each note: its number, when, where (contextLine without the person), and its words.
// ---------------------------------------------------------------------------------------------------
/** The line describing where a note was made, as sent to the AI: never the person's name. */
export function placeForAI(note) {
  const c = note?.context && typeof note.context === 'object' ? note.context : {};
  const parts = [c.page && `page ${c.page}`, c.dashboard && `dashboard ${c.dashboard}`, c.panel && `panel picked: ${c.panel}`,
    note?.where && `guide's step: ${note.where}`, c.trial && 'made as a test person'].filter(Boolean);
  return parts.join('; ');
}

export function noteBlock(n, note) {
  const where = placeForAI(note);
  return `Note ${n} (${stamp(note.at)}${where ? `; ${where}` : ''}):\n${String(note.text || '').trim()}`;
}

/** Split numbered notes ([{ n, note }]) into batches by count and size. A single huge note is its own batch. */
export function batchesOf(numbered, { maxNotes = BATCH_NOTES, maxChars = BATCH_CHARS } = {}) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const x of numbered || []) {
    const len = noteBlock(x.n, x.note).length;
    if (cur.length && (cur.length >= maxNotes || size + len > maxChars)) { out.push(cur); cur = []; size = 0; }
    cur.push(x);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

const SHAPE = '{"items": [{"list": "code", "text": "...", "notes": [3]}]}';

/**
 * The messages for one batch: the only thing that decides what the sorting AI is sent. The notes in the batch carry
 * their APPROVED words (cleaned, or the person's own: `approvedNotes`). No summary is asked for: the clean up is it.
 */
export function wrapMessages(batch, { lists = WRAP_LISTS, part = 1, parts = 1 } = {}) {
  const listLines = lists.map((l) => `- "${l.id}" (${l.label}): ${l.help}`).join('\n');
  return [
    { role: 'system', content: 'You sort the notes a person made while walking through a website into lists for the '
      + 'people who build it. Reply with JSON only, in this shape: '
      + `${SHAPE}. Rules: each item is one thing to do or think about, one line, in plain words. Every item names `
      + 'the number of each note it came from in "notes". A note that holds several things becomes several items; '
      + 'notes that say the same thing become one item naming all of them. Use every note at least once. Do not '
      + 'invent anything the notes do not say. Keep the person\'s own words where they are clear.' },
    { role: 'user', content: `The lists:\n${listLines}\n\n${parts > 1 ? `These are notes ${batch[0]?.n} to ${batch.at(-1)?.n}, part ${part} of ${parts} of one walkthrough.\n\n` : ''}`
      + `The notes:\n${batch.map((x) => noteBlock(x.n, x.note)).join('\n\n')}` },
  ];
}

// ---------------------------------------------------------------------------------------------------
// READING THE ANSWER: tolerant of fences and prose around the JSON, strict about what goes into the review.
// ---------------------------------------------------------------------------------------------------
export function readJSON(text) {
  const s = String(text || '');
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  let body = tryParse(s.trim());
  if (body == null) { const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(s); if (m) body = tryParse(m[1].trim()); }
  if (body == null) { const a = s.indexOf('{'); const b = s.lastIndexOf('}'); if (a >= 0 && b > a) body = tryParse(s.slice(a, b + 1)); }
  return body && typeof body === 'object' ? body : null;
}

const LIST_WORDS = { chat: 'chat', 'for chat': 'chat', code: 'code', 'for code': 'code', 'claude code': 'code',
  design: 'design', 'for design': 'design', designer: 'design' };
const listOf = (v) => LIST_WORDS[flat(v).toLowerCase()] || UNSORTED;
const numsOf = (v) => {
  const raw = Array.isArray(v) ? v : (v == null ? [] : [v]);
  const out = [];
  for (const x of raw) {
    const m = String(x).match(/\d+/g) || [];
    for (const d of m) out.push(Number(d));
  }
  return out;
};
const lineOf = (v) => clip(flat(typeof v === 'string' ? v : (v?.text ?? v?.line ?? v?.item ?? '')).replace(/^[-*•]\s*/, ''), LINE_MAX);

/**
 * One batch's answer, read: `{ ok, items: [{ list, text, nums, unanchored? , left? }], reason? }`. `nums` are
 * note numbers from `allowed` only. Unreadable: `ok` false and every note of the batch comes back as its own
 * unsorted line (the caller's notes, so `lines` are made by `noteLine`). Notes no item points at come back the same way.
 */
export function parseWrap(text, allowed, { noteLine = (n) => `Note ${n}`, max = ITEMS_PER_NOTE * Math.max(1, (allowed || []).length) } = {}) {
  const ok = new Set(allowed || []);
  const body = readJSON(text);
  const raw = [];
  if (body) {
    if (Array.isArray(body.items)) for (const it of body.items) raw.push({ list: listOf(it?.list ?? it?.for), it });
    // Also the shape { chat: [...], code: [...], design: [...] }, which a model asked for "lists" sometimes writes.
    for (const id of LIST_IDS) if (Array.isArray(body[id])) for (const it of body[id]) raw.push({ list: id, it });
  }
  const read = !!body && (Array.isArray(body.items) || LIST_IDS.some((id) => Array.isArray(body[id])));
  const items = [];
  const used = new Set();
  for (const { list, it } of raw) {
    if (items.length >= max) break;
    let t = lineOf(it);
    if (!t) continue;
    let pointers = it && typeof it === 'object' ? (it.notes ?? it.note ?? it.from ?? it.source) : null;
    // A bare string line: its pointer, if any, is written into it ("Fix the clock (note 3)"), and cut out of the words.
    if (typeof it === 'string') {
      const m = /\s*\(?\bnotes?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\)?\s*$/i.exec(t);
      if (m) { pointers = m[1]; t = t.slice(0, m.index).trim() || t; }
    }
    const nums = [...new Set(numsOf(pointers))].filter((n) => ok.has(n));
    for (const n of nums) used.add(n);
    // No note behind it: kept for the person to judge, never in a list looking sourced.
    if (!nums.length) items.push({ list: UNSORTED, text: t, nums: [], unanchored: true });
    else items.push({ list, text: t, nums });
  }
  for (const n of allowed || []) if (!used.has(n)) items.push({ list: UNSORTED, text: clip(flat(noteLine(n)), LINE_MAX), nums: [n], left: true });
  return read ? { ok: true, items } : { ok: false, items, reason: 'The AI’s answer could not be read, so those notes are not sorted yet.' };
}

// ---------------------------------------------------------------------------------------------------
// THE REVIEW: plain data, kept on the person's record after every decision (so it can be left and picked up).
//   { v: 2, id, at, by: 'ai'|'hand', who, model, aiName, noteIds,
//     clean: null | { level, model, cursor, auto: ''|'use'|'mine',
//                     notes: [{ id, state, cleaned, text, failed? }] },
//     sorted, summary: null (a v1 wrap-up's AI summary: { text, was, state }),
//     items: [{ id, list, wasList, text, was, notes: [noteId], state: 'open'|'kept'|'dropped', unanchored?, left? }],
//     cursor, problems: [string], savedAs, savedAt, originals }
// A cleaned note's `state`: 'pending' (not cleaned yet), 'open' (cleaned, waiting for Use this / Keep mine), 'used'
// (the cleaned words, as cleaned), 'changed' (the cleaned words, edited by the person), 'mine' (their own words).
// `cleaned` is what the model gave back; `text` is what was approved. A note that could not be cleaned is 'mine' with
// `failed` saying why. The stages, in order (`stageOf`): approve the clean up, sort, go through the lists, save.
// The list steps are the summary (only a v1 wrap-up has one) and then each item, in list order.
// ---------------------------------------------------------------------------------------------------
const rid = (p, at) => `${p}-${Number(at).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const ORDER = [...LIST_IDS, UNSORTED];
const byList = (items) => ORDER.flatMap((l) => items.filter((i) => i.list === l));
export const CLEAN_STATES = Object.freeze(['pending', 'open', 'used', 'changed', 'mine']);
const UNDECIDED = new Set(['pending', 'open']);

function blankReview({ noteIds, by, who = '', model = '', aiName = '', at = Date.now() }) {
  return { v: 2, id: rid('w', at), at, by, who: isWho(who) ? who : '', model: String(model || ''), aiName: String(aiName || ''),
    noteIds, clean: null, sorted: false, summary: null, items: [], cursor: 0, problems: [], savedAs: '', savedAt: 0, originals: false };
}

function finishReview({ notes, raw = [], by, model = '', aiName = '', problems = [], at = Date.now() }) {
  const noteIds = notes.map((n) => n.id);
  const items = byList(raw.map((r, i) => ({ id: `i${i + 1}`, list: r.list, wasList: r.list, text: r.text, was: r.text,
    notes: (r.nums || []).map((n) => noteIds[n - 1]).filter(Boolean), state: 'open',
    ...(r.unanchored ? { unanchored: true } : {}), ...(r.left ? { left: true } : {}) })));
  return { ...blankReview({ noteIds, by, model, aiName, at }), sorted: true, items, problems };
}

// ---------------------------------------------------------------------------------------------------
// THE CLEAN UP (clean_up.js, Corpus Desk's dial): one note at a time, each shown for approval.
// ---------------------------------------------------------------------------------------------------
/** A new wrap-up that starts with the clean up: every chosen note waiting to be cleaned at `level`. */
export function startReview(list, { level = DEFAULT_CLEAN_LEVEL, who = DEFAULT_WHO, aiName = '', at = Date.now() } = {}) {
  const notes = cleanNotes(list);
  const r = blankReview({ noteIds: notes.map((n) => n.id), by: 'ai', who, aiName, at });
  r.clean = { level: cleanLevel(level), model: '', cursor: 0, auto: '',
    notes: notes.map((n) => ({ id: n.id, state: 'pending', cleaned: '', text: '' })) };
  return r;
}

/** Where a wrap-up is: 'approve' (the clean up), 'sort', 'review' (the lists), 'done' (ready to save). */
export function stageOf(r) {
  if (!r) return '';
  if (r.clean && cleanProgress(r).undecided > 0) return 'approve';
  if (!r.sorted) return 'sort';
  return currentStep(r) ? 'review' : 'done';
}

/** How the clean up stands: how many are waiting to be cleaned, waiting for a decision, and how each was decided. */
export function cleanProgress(r) {
  const ns = r?.clean?.notes || [];
  const n = (s) => ns.filter((x) => x.state === s).length;
  const undecided = ns.filter((x) => UNDECIDED.has(x.state)).length;
  return { total: ns.length, pending: n('pending'), open: n('open'), used: n('used'), changed: n('changed'), mine: n('mine'),
    failed: ns.filter((x) => x.failed).length, undecided, decided: ns.length - undecided };
}

/** A note's cleaned words have come back (or failed): a new review. A note already decided is left as it is. */
export function setCleaned(r, id, res = {}) {
  if (!r?.clean) return r;
  const i = r.clean.notes.findIndex((x) => x.id === id);
  if (i < 0 || r.clean.notes[i].state !== 'pending') return r;
  const n = r.noteIds.indexOf(id) + 1;
  let entry;
  let problems = r.problems;
  const text = res.ok ? clipBlock(res.text, CLEANED_MAX) : '';
  if (text) {
    entry = { ...r.clean.notes[i], cleaned: text, text, state: r.clean.auto === 'use' ? 'used' : (r.clean.auto === 'mine' ? 'mine' : 'open') };
  } else {
    const why = flat(res.reason || 'The AI gave back nothing.');
    entry = { ...r.clean.notes[i], state: 'mine', failed: why };
    problems = [...problems, `Note ${n} could not be cleaned up (${why}), so your own words are used.`];
  }
  const notes = r.clean.notes.map((x, k) => (k === i ? entry : x));
  return { ...r, problems, clean: { ...r.clean, notes, model: res.ok && res.model ? String(res.model) : r.clean.model } };
}

/** The note being approved: `{ index, entry }`, or null once every note is decided. */
export function approveStep(r) {
  const ns = r?.clean?.notes || [];
  const i = Number(r?.clean?.cursor) || 0;
  return i >= 0 && i < ns.length ? { index: i, entry: ns[i] } : null;
}

// After a decision: the next undecided note after this one, else the first undecided, else past the end.
function nextUndecided(ns, from) {
  for (let i = from + 1; i < ns.length; i += 1) if (UNDECIDED.has(ns[i].state)) return i;
  for (let i = 0; i <= from && i < ns.length; i += 1) if (UNDECIDED.has(ns[i].state)) return i;
  return ns.length;
}

/**
 * One decision on the clean up, as a new review (the old one is not changed). `action`:
 *   use, words?   the cleaned words are used: as cleaned, or `words` when given (edited: 'changed'). Only once cleaned.
 *   mine          the person's own words are used for this note
 *   useall        every note waiting gets its cleaned words, and every note still being cleaned will when it comes back
 *   mineall       every note not yet decided keeps the person's own words (and is not cleaned)
 *   prev          back one note (a decided one can be decided again); goto, index: that note
 *   next          skip for now: on to the next note still to decide
 * Anything not possible returns the review unchanged.
 */
export function approve(r, action, arg) {
  if (!r?.clean) return r;
  const ns = r.clean.notes;
  const at = Math.max(0, Math.min(Number(r.clean.cursor) || 0, ns.length));
  const withClean = (patch) => ({ ...r, clean: { ...r.clean, ...patch } });
  if (action === 'prev') return withClean({ cursor: Math.max(0, at - 1) });
  if (action === 'next') {
    // Skip for now: the next note still to decide (round to the start); none other: unchanged.
    for (let i = at + 1; i < ns.length; i += 1) if (UNDECIDED.has(ns[i].state)) return withClean({ cursor: i });
    for (let i = 0; i < at; i += 1) if (UNDECIDED.has(ns[i].state)) return withClean({ cursor: i });
    return r;
  }
  if (action === 'goto') { const i = Number(arg); return Number.isInteger(i) && i >= 0 && i < ns.length ? withClean({ cursor: i }) : r; }
  if (action === 'useall' || action === 'mineall') {
    const use = action === 'useall';
    const notes = ns.map((x) => {
      if (x.state === 'open') return { ...x, state: use ? 'used' : 'mine' };
      if (x.state === 'pending' && !use) return { ...x, state: 'mine' };
      return x;
    });
    return withClean({ notes, auto: use ? 'use' : 'mine', cursor: nextUndecided(notes, at - 1) });
  }
  const e = ns[at];
  if (!e) return r;
  let patch = null;
  if (action === 'mine') patch = { state: 'mine' };
  else if (action === 'use') {
    if (e.state === 'pending' || !e.cleaned) return r;
    const words = arg == null ? e.cleaned : clipBlock(arg, CLEANED_MAX);
    if (!words) return r;
    patch = { text: words, state: words === e.cleaned ? 'used' : 'changed' };
  }
  if (!patch) return r;
  const notes = ns.map((x, k) => (k === at ? { ...x, ...patch } : x));
  return withClean({ notes, cursor: nextUndecided(notes, at) });
}

/** The words a note goes on with: the approved cleaned words, or its own. */
export function approvedWords(r, note) {
  const e = r?.clean?.notes?.find((x) => x.id === note?.id);
  return e && (e.state === 'used' || e.state === 'changed') && e.text ? e.text : String(note?.text || '');
}
/** The wrap-up's notes (from the person's list, in its order) carrying their approved words: what is sorted. */
export function approvedNotes(r, list) {
  const byId = new Map(cleanNotes(list).map((n) => [n.id, n]));
  return (r?.noteIds || []).map((id) => byId.get(id)).filter(Boolean).map((n) => ({ ...n, text: approvedWords(r, n) }));
}

/**
 * Clean the notes still waiting, one at a time, in order. Never throws. `isWaiting(id)` is asked before each (the
 * person may decide one, or all of them, while this runs); `onNote(id, result)` after each. A cancel stops at once.
 * Resolves `{ ok, cancelled? }`.
 */
export async function cleanUpNotes(list, { ai, model = '', level = DEFAULT_CLEAN_LEVEL, signal, isWaiting = () => true,
                                           onNote = () => {} } = {}) {
  for (const note of cleanNotes(list)) {
    if (signal?.aborted) return { ok: false, cancelled: true };
    if (!isWaiting(note.id)) continue;
    const res = await cleanText(note.text, { ai, model, level, context: placeForAI(note), signal });
    if (res.cancelled || signal?.aborted) return { ok: false, cancelled: true };
    try { onNote(note.id, res); } catch { /* a progress line is not worth failing for */ }
  }
  return { ok: true };
}

/** After a clean up, sorting by hand: every note one "Not sorted yet" line in its approved words. Sends nothing. */
export function sortedByHand(r, list) {
  if (!r) return r;
  const h = handReview(approvedNotes(r, list));
  return { ...r, by: 'hand', sorted: true, items: h.items, cursor: 0 };
}

/** The sorted lists put into a wrap-up that was cleaned and approved first (its clean up and choices are kept). */
export function withSorted(r, sorted) {
  if (!r || !sorted) return r;
  return { ...r, by: 'ai', model: sorted.model || r.model || r.clean?.model || '', sorted: true, items: sorted.items, cursor: 0,
    problems: [...(r.problems || []), ...(sorted.problems || [])] };
}

/** The line a note is when it comes into the review unsorted: its own words, flattened. */
export const noteAsLine = (note) => clip(flat(note?.text), LINE_MAX);

/** Sorting by hand (no AI, or the person's choice): one unsorted line per note, its own words. */
export function handReview(list, { at = Date.now() } = {}) {
  const notes = cleanNotes(list);
  return finishReview({ notes, by: 'hand', raw: notes.map((n, i) => ({ list: UNSORTED, text: noteAsLine(n), nums: [i + 1], left: false })), at });
}

/**
 * Ask the AI to sort, batch by batch, and make the lists. Never throws. `ai` has ai.js's `chat(messages, opts)`.
 * `list` is what is sorted: after a clean up, `approvedNotes` (each note carrying its approved words).
 * `onProgress({ done, total })` after each batch. A batch whose answer fails or cannot be read comes back unsorted
 * (with the reason in `problems`); a cancel stops and returns `{ ok: false, cancelled: true }`.
 */
export async function wrapUp(list, { ai, model = '', aiName = '', signal, onProgress = () => {}, lists = WRAP_LISTS, at = Date.now() } = {}) {
  const notes = cleanNotes(list);
  if (!notes.length) return { ok: false, reason: 'There are no notes to wrap up.' };
  if (!ai || typeof ai.chat !== 'function') return { ok: false, reason: 'No AI is connected.' };
  const numbered = notes.map((note, i) => ({ n: i + 1, note }));
  const batches = batchesOf(numbered);
  const raw = [];
  const problems = [];
  let usedModel = model;
  const noteLine = (n) => noteAsLine(notes[n - 1]);
  for (let b = 0; b < batches.length; b += 1) {
    if (signal?.aborted) return { ok: false, cancelled: true, reason: 'Stopped.' };
    const batch = batches[b];
    const nums = batch.map((x) => x.n);
    let r;
    try {
      r = await ai.chat(wrapMessages(batch, { lists, part: b + 1, parts: batches.length }),
        { model, json: true, temperature: 0.2, maxTokens: ANSWER_TOKENS, signal });
    } catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
    if (r?.cancelled || signal?.aborted) return { ok: false, cancelled: true, reason: 'Stopped.' };
    if (r?.ok && r.model) usedModel = r.model;
    const span = nums.length > 1 ? `notes ${nums[0]} to ${nums.at(-1)}` : `note ${nums[0]}`;
    if (!r?.ok) {
      problems.push(`The AI did not answer for ${span}, so they are not sorted yet${r?.reason ? ` (${flat(r.reason)})` : ''}.`);
      for (const n of nums) raw.push({ list: UNSORTED, text: noteLine(n), nums: [n], left: true });
    } else {
      const p = parseWrap(r.text, nums, { noteLine });
      if (!p.ok) problems.push(`The AI’s answer for ${span} could not be read, so they are not sorted yet.`);
      else if (r.truncated) problems.push(`The AI’s answer for ${span} was cut off; anything it left out is under “${UNSORTED_LABEL}”.`);
      raw.push(...p.items);
    }
    try { onProgress({ done: b + 1, total: batches.length }); } catch { /* a progress line is not worth failing for */ }
  }
  return { ok: true, review: finishReview({ notes, raw, by: 'ai', model: usedModel, aiName, problems, at }) };
}

// ---------------------------------------------------------------------------------------------------
// STEPPING THROUGH IT.
// ---------------------------------------------------------------------------------------------------
/** Every step: `{ kind: 'summary' }` first when there is a summary, then `{ kind: 'item', item }`. */
export function reviewSteps(r) {
  if (!r) return [];
  return [...(r.summary ? [{ kind: 'summary' }] : []), ...(r.items || []).map((item) => ({ kind: 'item', item }))];
}
const stateOf = (r, step) => (step.kind === 'summary' ? r.summary.state : step.item.state);
/** The step under the cursor, or null when every step is decided. */
export function currentStep(r) {
  const s = reviewSteps(r);
  return r && r.cursor >= 0 && r.cursor < s.length ? s[r.cursor] : null;
}
export function progress(r) {
  const items = r?.items || [];
  const s = reviewSteps(r);
  const open = s.filter((x) => stateOf(r, x) === 'open').length;
  return { total: s.length, open, done: s.length - open,
    kept: items.filter((i) => i.state === 'kept').length,
    dropped: items.filter((i) => i.state === 'dropped').length,
    changed: items.filter((i) => i.state === 'kept' && i.text !== i.was).length,
    moved: items.filter((i) => i.state === 'kept' && i.list !== i.wasList).length };
}
export const finished = (r) => !!r && progress(r).open === 0;

// After a decision: the next open step after this one, else the first open one, else past the end (all decided).
function advance(r, from) {
  const s = reviewSteps(r);
  for (let i = from + 1; i < s.length; i += 1) if (stateOf(r, s[i]) === 'open') return i;
  for (let i = 0; i <= from && i < s.length; i += 1) if (stateOf(r, s[i]) === 'open') return i;
  return s.length;
}

/**
 * One decision, as a new review (the old one is not changed). `action`:
 *   keep              the line (or the summary) stays as it is
 *   change, text      its words become `text` (and it is kept)
 *   move, list        it goes to `list` (and is kept); the summary cannot move
 *   drop              left out of the file
 *   prev / next       the cursor moves one step without deciding anything
 *   goto, index       the cursor goes to that step
 * Anything not possible returns the review unchanged.
 */
export function decide(r, action, arg) {
  if (!r) return r;
  const s = reviewSteps(r);
  const at = Math.max(0, Math.min(Number(r.cursor) || 0, s.length));
  if (action === 'prev') return { ...r, cursor: Math.max(0, Math.min(at, s.length) - 1) };
  if (action === 'next') return { ...r, cursor: Math.min(s.length, at + 1) };
  if (action === 'goto') { const i = Number(arg); return Number.isInteger(i) && i >= 0 && i <= s.length ? { ...r, cursor: i } : r; }
  const step = s[at];
  if (!step) return r;
  if (step.kind === 'summary') {
    let sum = null;
    if (action === 'keep') sum = { ...r.summary, state: 'kept' };
    else if (action === 'drop') sum = { ...r.summary, state: 'dropped' };
    else if (action === 'change') { const t = clip(flat(arg), SUMMARY_MAX); if (!t) return r; sum = { ...r.summary, text: t, state: 'kept' }; }
    if (!sum) return r;
    const n = { ...r, summary: sum };
    return { ...n, cursor: advance(n, at) };
  }
  const id = step.item.id;
  let patch = null;
  if (action === 'keep') patch = { state: 'kept' };
  else if (action === 'drop') patch = { state: 'dropped' };
  else if (action === 'change') { const t = clip(flat(arg), LINE_MAX); if (!t) return r; patch = { text: t, state: 'kept' }; }
  else if (action === 'move') { if (!isList(arg)) return r; patch = { list: arg, state: 'kept' }; }
  if (!patch) return r;
  const n = { ...r, items: r.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
  return { ...n, cursor: advance(n, at) };
}

/** A clean up read back from storage, checked; null when there is none. */
function readClean(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.notes)) return null;
  const notes = c.notes.filter((x) => x && typeof x.id === 'string').map((x) => {
    const state = CLEAN_STATES.includes(x.state) ? x.state : 'pending';
    const cleaned = typeof x.cleaned === 'string' ? clipBlock(x.cleaned, CLEANED_MAX) : '';
    const text = typeof x.text === 'string' ? clipBlock(x.text, CLEANED_MAX) : '';
    // A note marked as using cleaned words that has none is back to its own words; one "open" with none is waiting.
    const s = (state === 'used' || state === 'changed') && !text ? 'mine' : (state === 'open' && !cleaned ? 'pending' : state);
    return { id: x.id, state: s, cleaned, text, ...(typeof x.failed === 'string' && x.failed ? { failed: x.failed } : {}) };
  });
  const cursor = Number.isInteger(c.cursor) ? Math.max(0, Math.min(c.cursor, notes.length)) : 0;
  return { level: cleanLevel(c.level), model: String(c.model || ''), cursor, auto: ['use', 'mine'].includes(c.auto) ? c.auto : '', notes };
}

/** A review read back from storage, checked; null when it is not one. A v1 one (before the clean up) still reads. */
export function cleanReview(raw) {
  if (!raw || typeof raw !== 'object' || ![1, 2].includes(raw.v) || typeof raw.id !== 'string' || !Array.isArray(raw.items)) return null;
  const st = (v) => (['open', 'kept', 'dropped'].includes(v) ? v : 'open');
  const items = raw.items.filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string').map((i) => ({
    id: i.id, list: isList(i.list) ? i.list : UNSORTED, wasList: isList(i.wasList) ? i.wasList : UNSORTED,
    text: clip(flat(i.text), LINE_MAX), was: typeof i.was === 'string' ? i.was : i.text,
    notes: Array.isArray(i.notes) ? i.notes.filter((x) => typeof x === 'string') : [], state: st(i.state),
    ...(i.unanchored ? { unanchored: true } : {}), ...(i.left ? { left: true } : {}) }));
  const s = raw.summary && typeof raw.summary.text === 'string'
    ? { text: clip(flat(raw.summary.text), SUMMARY_MAX), was: typeof raw.summary.was === 'string' ? raw.summary.was : raw.summary.text, state: st(raw.summary.state) } : null;
  const r = { v: 2, id: raw.id, at: Number(raw.at) || 0, by: raw.by === 'hand' ? 'hand' : 'ai', who: isWho(raw.who) ? raw.who : '',
    model: String(raw.model || ''), aiName: String(raw.aiName || ''),
    noteIds: Array.isArray(raw.noteIds) ? raw.noteIds.filter((x) => typeof x === 'string') : [],
    clean: raw.v === 2 ? readClean(raw.clean) : null, sorted: raw.v === 1 ? true : raw.sorted === true,
    summary: s, items, cursor: 0, problems: Array.isArray(raw.problems) ? raw.problems.filter((x) => typeof x === 'string').slice(0, 200) : [],
    savedAs: typeof raw.savedAs === 'string' ? raw.savedAs : '', savedAt: Number(raw.savedAt) || 0, originals: raw.originals === true };
  const n = reviewSteps(r).length;
  r.cursor = Math.max(0, Math.min(Number.isInteger(raw.cursor) ? raw.cursor : 0, n));
  return r;
}

/** What is kept on the person's record once a wrap-up is saved: the decided lines, not the notes again. */
export function finishedRecord(r, { at = Date.now() } = {}) {
  return { id: r.id, at: r.at, savedAt: at, savedAs: r.savedAs || '', by: r.by, who: r.who || '', model: r.model, noteIds: r.noteIds,
    cleanLevel: r.clean ? r.clean.level : 0,
    summary: r.summary && r.summary.state !== 'dropped' ? r.summary.text : '',
    items: r.items.filter((i) => i.state !== 'dropped').map((i) => ({ list: i.list, text: i.text, notes: i.notes })) };
}
/** The finished list with this one added (or replaced, by id), newest last, KEEP_FINISHED at most. */
export function addFinished(list, rec) {
  const l = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.id === 'string' && x.id !== rec.id);
  return [...l, rec].slice(-KEEP_FINISHED);
}

// ---------------------------------------------------------------------------------------------------
// BY VOICE: "use this" / "keep mine" (approving the clean up); "keep", "drop", "move to design", "change it to ...",
// "back", "skip" (the lists). Whole words at the start, so a
// sentence about keeping something is not taken for "keep". What follows "change it to" keeps its own spelling.
// ---------------------------------------------------------------------------------------------------
const norm = (s) => flat(String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' '));
const KEEP = new Set(['keep', 'keep it', 'keep that', 'keep this', 'keep this one', 'keep that one', 'keep the line']);
const DROP = new Set(['drop', 'drop it', 'drop that', 'drop this', 'drop this one', 'drop that one', 'remove it', 'delete it', 'leave it out']);
const PREV = new Set(['back', 'go back', 'previous', 'previous one', 'last one', 'the one before']);
const NEXT = new Set(['skip', 'skip it', 'skip this', 'next', 'next one', 'later']);
const CHANGE_ALONE = new Set(['change', 'change it', 'change this', 'change that', 'edit', 'edit it']);
// Approving the clean up (Corpus Desk's two buttons, "Use this" and "Keep mine"), by voice.
const USE = new Set(['use this', 'use it', 'use that', 'use this one', 'use the cleaned one', 'use the clean one', 'use cleaned']);
const MINE = new Set(['keep mine', 'mine', 'keep my words', 'keep my own', 'keep my own words', 'my words', 'my own words', 'use mine']);
const MOVE_RE = /^(?:move|put|send)(?: it| this| that)? (?:to|in|into|under|on)(?: the)? (?:for )?(chat|code|design|unsorted|not sorted)(?: list)?$/;
const CHANGE_RE = /^\s*(?:change|edit|make)\s+(?:it|this|that|the line)?\s*(?:to|so it says|to say|say)\s*[,:]?\s*/i;

/** `{ action, list?, text? }` or null. `change` with empty `text`: open the line for new words. */
export function parseReviewWords(said) {
  const raw = String(said || '').trim();
  const t = norm(raw);
  if (!t) return null;
  if (KEEP.has(t)) return { action: 'keep' };
  if (USE.has(t)) return { action: 'use' };
  if (MINE.has(t)) return { action: 'mine' };
  if (DROP.has(t)) return { action: 'drop' };
  if (PREV.has(t)) return { action: 'prev' };
  if (NEXT.has(t)) return { action: 'next' };
  if (CHANGE_ALONE.has(t)) return { action: 'change', text: '' };
  const m = MOVE_RE.exec(t) || /^(?:for )?(chat|code|design)$/.exec(t);
  if (m) return { action: 'move', list: m[1] === 'not sorted' ? UNSORTED : m[1] };
  const c = CHANGE_RE.exec(raw);
  if (c) { const text = raw.slice(c[0].length).trim(); return text ? { action: 'change', text } : { action: 'change', text: '' }; }
  return null;
}
/** The words the review listens for, for the speech layer's list (a fixed-grammar engine hears only these). */
export const REVIEW_WORDS = Object.freeze(['use this', 'keep mine', 'keep', 'drop', 'change it', 'move to chat', 'move to code', 'move to design', 'back', 'skip']);

// ---------------------------------------------------------------------------------------------------
// THE FILE.
// ---------------------------------------------------------------------------------------------------
/** "walkthrough_2026-10-07.md", or "_2", "_3"... when `taken` already has it. */
export function walkthroughFileName(at = Date.now(), taken = []) {
  const base = `walkthrough_${dayOf(at)}`;
  const have = new Set((taken || []).map((x) => String(x).toLowerCase()));
  if (!have.has(`${base}.md`)) return `${base}.md`;
  for (let i = 2; i < 1000; i += 1) if (!have.has(`${base}_${i}.md`)) return `${base}_${i}.md`;
  return `${base}_${Date.now()}.md`;
}

const mdLine = (s) => String(s || '').replace(/\r?\n+/g, ' ').trim();
const refs = (ids, num) => {
  const ns = (ids || []).map((id) => num.get(id)).filter(Boolean).sort((a, b) => a - b);
  return ns.length ? `note${ns.length > 1 ? 's' : ''} ${ns.join(', ')}` : '';
};

const CLEAN_MARK = { used: 'cleaned up, approved as it was', changed: 'cleaned up, then changed by you', mine: 'your own words', open: 'cleaned up, not approved yet', pending: 'your own words (not cleaned up yet)' };

/**
 * The reviewed wrap-up as Markdown: the three lists (and anything still unsorted) with note numbers, then the summary:
 * every note as approved (its cleaned words, or its own); then, only when `r.originals` (or when nothing was cleaned),
 * every note word for word. `list` is the person's notes now (a note deleted since is said to be missing).
 * WHY THE WORD-FOR-WORD NOTES ARE LEFT OUT BY DEFAULT after a clean up: this file is what goes to chat, and the point of
 * the clean up is that filler does not (Mike, 2026-10-07). The notes themselves are untouched on the person's record,
 * and "Save as a file" in their notes writes them all, word for word; one press here adds them to this file too.
 */
export function reviewToMarkdown(r, list, { at = Date.now(), aiLabel = '' } = {}) {
  const all = cleanNotes(list);
  const byId = new Map(all.map((n) => [n.id, n]));
  const num = new Map((r.noteIds || []).map((id, i) => [id, i + 1]));
  const p = progress(r);
  const notes = (r.noteIds || []).map((id) => byId.get(id) || null);
  const present = notes.filter(Boolean);
  const span = present.length ? `${stamp(present[0].at)} to ${stamp(present.at(-1).at)}` : '';
  const name = `${aiLabel || r.aiName || 'the AI'}${r.model ? ` (${r.model})` : ''}`;
  const who = r.by === 'hand' ? 'Sorted by hand (no AI).' : `Sorted by ${name}.`;
  const cp = r.clean ? cleanProgress(r) : null;
  const cleanedLine = cp ? `Cleaned up at level ${levelLine(r.clean.level)}, by ${aiLabel || r.aiName || 'the AI'}${r.clean.model ? ` (${r.clean.model})` : ''}, `
    + `each note approved: ${cp.used} as cleaned, ${cp.changed} changed by you, ${cp.mine} in your own words${cp.undecided ? `, ${cp.undecided} not decided yet` : ''}. ` : '';
  const out = [`# Walkthrough, ${dayOf(r.at || at)}`, '',
    `${(r.noteIds || []).length} notes${span ? `, ${span}` : ''}. ${cleanedLine}${who} Reviewed together, saved ${stamp(at)}: of ${r.items.length} lines, `
      + `${p.kept} kept (${p.changed} changed, ${p.moved} moved), ${p.dropped} dropped${p.open ? `; ${p.open} not looked at yet` : ''}.`, '',
    `_${r.by === 'hand' ? 'The lists below were sorted by hand.' : 'The lists below are the AI’s, checked line by line in the review.'}`
      + `${r.clean ? ' The summary after them is every note as you approved it.' : ' The notes at the end are the record, word for word.'}_`, ''];
  if (r.summary && r.summary.state !== 'dropped') {
    const how = r.summary.text !== r.summary.was ? 'written by the AI, changed in the review' : (r.summary.state === 'open' ? 'written by the AI, not looked at yet' : 'written by the AI');
    out.push(`## Summary (${how})`, '', mdLine(r.summary.text), '');
  }
  for (const l of [...WRAP_LISTS.map((x) => x.id), UNSORTED]) {
    const items = r.items.filter((i) => i.list === l && i.state !== 'dropped');
    if (!items.length && l === UNSORTED) continue;
    out.push(`## ${listLabel(l)}`, '');
    if (!items.length) out.push('_Nothing._', '');
    for (const i of items) {
      const marks = [refs(i.notes, num) || 'no note named', i.text !== i.was && 'changed in the review',
        i.list !== i.wasList && `moved from ${listLabel(i.wasList)}`, i.state === 'open' && 'not looked at yet',
        i.unanchored && 'the AI named no note for this'].filter(Boolean);
      out.push(`- ${mdLine(i.text)} (${marks.join('; ')})`);
    }
    if (items.length) out.push('');
  }
  if (r.problems?.length) out.push('## What went wrong while cleaning up or sorting', '', ...r.problems.map((x) => `- ${mdLine(x)}`), '');
  const noteHead = (n, i) => {
    const c = contextLine(n.context);
    return [`### Note ${i + 1}: ${stamp(n.at)}${n.where ? ` (at “${n.where}”)` : ''}`, ...(c ? ['', `_${c}_`] : []), ''];
  };
  const gone = (i) => [`### Note ${i + 1}`, '', '_This note was deleted after the wrap-up was made._', ''];
  if (r.clean) {
    out.push(`## Summary: the notes cleaned up (level ${levelLine(r.clean.level)})`, '');
    notes.forEach((n, i) => {
      if (!n) { out.push(...gone(i)); return; }
      const e = r.clean.notes.find((x) => x.id === n.id);
      out.push(...noteHead(n, i), `_${CLEAN_MARK[e?.state] || CLEAN_MARK.mine}${e?.failed ? ': it could not be cleaned up' : ''}._`, '', approvedWords(r, n).trim(), '');
    });
  }
  if (!r.clean || r.originals) {
    out.push('## The notes, word for word', '');
    notes.forEach((n, i) => { if (!n) out.push(...gone(i)); else out.push(...noteHead(n, i), n.text.trim(), ''); });
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---------------------------------------------------------------------------------------------------
// SAVING INTO A FOLDER THE PERSON PICKS, remembered on this device (user_folders.js's handle store, its own key).
// `store` is { get(key), put(key, handle) }; `view` has `showDirectoryPicker`. Both are the caller's, so a suite
// runs this on a fake folder. ONLY FROM A PRESS: the picker and the browser's "allow again" both need one.
// ---------------------------------------------------------------------------------------------------
export const WALK_FOLDER_KEY = 'folder:walkthroughs';

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

/**
 * Write `text` into the remembered folder (or a newly picked one when `pick`, or when none is remembered).
 * `ownName`: the file this wrap-up was saved as before, written over (saving again after more review); any other
 * file already there is never written over (`_2`, `_3`...). Resolves `{ ok, name, folder, picked, reason? }`.
 */
export async function saveToFolder(text, { store, view, pick = false, ownName = '', at = Date.now() } = {}) {
  let dir = null;
  let picked = false;
  if (!pick) { try { dir = await store?.get?.(WALK_FOLDER_KEY); } catch { dir = null; } }
  if (!dir) {
    if (!view || typeof view.showDirectoryPicker !== 'function') return { ok: false, reason: 'This browser cannot save into a folder you choose. Download it instead.' };
    try { dir = await view.showDirectoryPicker({ id: 'nimrod-walkthroughs', mode: 'readwrite' }); }
    catch (err) { return { ok: false, cancelled: err?.name === 'AbortError', reason: err?.name === 'AbortError' ? 'No folder was chosen.' : 'The folder could not be opened.' }; }
    picked = true;
    try { await store?.put?.(WALK_FOLDER_KEY, dir); } catch { /* remembered for this visit only */ }
  }
  let perm = 'granted';
  try {
    if (typeof dir.queryPermission === 'function' && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      perm = typeof dir.requestPermission === 'function' ? await dir.requestPermission({ mode: 'readwrite' }) : 'denied';
    }
  } catch { perm = 'denied'; }
  if (perm !== 'granted') return { ok: false, folder: dir.name || '', reason: 'The browser did not let this page write into that folder.' };
  let name = '';
  const base = walkthroughFileName(at);
  // Its own file only in the folder it was saved in: a newly picked folder's file of that name is somebody else's.
  if (ownName && !picked && ownName.startsWith(base.replace(/\.md$/, ''))) name = ownName;
  else {
    const taken = [];
    let n = base;
    while (await exists(dir, n)) { taken.push(n); n = walkthroughFileName(at, taken); }
    name = n;
  }
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try { await w.write(text); } finally { await w.close(); }
  } catch { return { ok: false, folder: dir.name || '', reason: 'The file could not be written into that folder.' }; }
  return { ok: true, name, folder: dir.name || '', picked };
}

/** The remembered folder's name, without asking anything ('' when there is none). */
export async function rememberedFolderName(store) {
  try { const d = await store?.get?.(WALK_FOLDER_KEY); return d ? String(d.name || '') : ''; } catch { return ''; }
}
