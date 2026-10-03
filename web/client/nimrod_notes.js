// nimrod_notes.js — "MAKE A NOTE": a conversation with the AI, reduced to a short dated note the person
// reads, edits and keeps, in a list they can copy out. Pure; modules/nimrod.js draws it.
//
// Mike, 2026-10-02: *"we could edit as we go. Like we did with the notes probably. That way I can just
// speak plainly and have it reduced to a more reasonable amount for you and the other Claudes."*
//
// *** NOTHING IS SENT ANYWHERE BY ITSELF. *** The draft is written by the person's own AI (the same one
// they are talking to, on a press), or — with no AI answering — from their own words, and nothing is
// kept until they press Save. The list is copied out by a press too. Where it goes from there (a chat,
// a document, Claude Code's inbox) is the person's to decide; the site never posts it.

// *** WHERE NOTES LIVE (checked 2026-10-03, not assumed): on the ACCOUNT. *** With a person known, the person
// record (`/api/people/<id>/state/nimrod-ai`, nimrod_ai.js `openAIStore`), so they follow the person to every
// screen and browser they sign into; state.js keeps a last-known-good copy in this browser for offline. With
// no person (a host still resolving, Home's try-out stage), the Nimrod PANEL's own state on that dashboard.
// A preview with no state at all: memory only, gone on reload. (The AI's address and a key are different:
// those are this browser's, ai.js.)
//
// *** 2026-10-03: 200, was 40. *** Mike is walking the whole site making notes for Code, and 40 is a morning.
// Argued: a note is a few lines (~500 characters), so 200 is ~100 KB on the person record, rewritten on each
// save — fine for a record nobody polls. Past it the oldest still goes (a record cannot grow for ever), but
// never silently: `nearlyFull` warns from NOTES_WARN_AT on, so there is time to copy or save them first.
export const NOTES_MAX = 200;         // kept on the person record: the oldest goes first past this
export const NOTES_WARN_AT = NOTES_MAX - 10;
export const NOTE_MAX_CHARS = 4000;   // one note; a "reduced" note longer than this has not been reduced
export const NOTE_TOKENS = 500;

const pad = (n) => String(n).padStart(2, '0');
/** "2026-10-02 14:03", local time: the date a person reads, not a timestamp. */
export function stamp(at = Date.now()) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The person's own lines as bullets: the note when no AI is answering (still worth keeping). */
export function fallbackNote(log = []) {
  const mine = (log || []).filter((m) => m && m.role === 'user' && String(m.text || '').trim());
  return clip(mine.map((m) => `- ${String(m.text).replace(/\s+/g, ' ').trim()}`).join('\n'), NOTE_MAX_CHARS);
}

/** The request that reduces a conversation to a note. */
export function notePrompt(log = [], { name = 'the AI', where = '' } = {}) {
  const convo = (log || []).filter((m) => m && !m.failed && String(m.text || '').trim())
    .map((m) => `${m.role === 'user' ? 'PERSON' : name.toUpperCase()}: ${String(m.text).replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  return [
    { role: 'system', content: 'You turn a spoken conversation into a short note for the people who build this '
      + 'website. Write 3 to 8 bullet points, each one line, starting with "- ". Keep: what the person wants '
      + 'changed and where (which module, page or setting), what they decided, what they liked or disliked, '
      + 'and open questions. Leave out small talk, greetings and anything said twice. Use the person\'s own '
      + 'words where they are clear. Do not invent anything that was not said. No heading, no closing line.' },
    { role: 'user', content: `${where ? `They were on the guide's page "${where}".\n` : ''}The conversation:\n${convo}` },
  ];
}

/** Tidy what a model wrote: no code fences, no heading, bullets kept, capped. */
export function cleanNote(text) {
  const t = String(text || '').replace(/```[a-z]*\n?|```/gi, '').replace(/^\s*#+\s.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return clip(t, NOTE_MAX_CHARS);
}

/**
 * A draft for the person to edit: `{ ok, text, fromAI, reason? }`. Asks the AI when there is one and
 * falls back to the person's own lines when it cannot answer (the reason is kept, to show).
 */
export async function draftNote(log, { ai = null, model = '', name = 'the AI', where = '', signal } = {}) {
  const fallback = fallbackNote(log);
  if (!fallback) return { ok: false, text: '', fromAI: false, reason: 'Nothing has been said yet.' };
  if (!ai || typeof ai.chat !== 'function') return { ok: true, text: fallback, fromAI: false, reason: 'No AI is connected, so this is your own words.' };
  let r;
  try { r = await ai.chat(notePrompt(log, { name, where }), { model, temperature: 0.2, maxTokens: NOTE_TOKENS, signal }); }
  catch (err) { r = { ok: false, reason: String(err?.message || err) }; }
  const text = r?.ok ? cleanNote(r.text) : '';
  if (!text) return { ok: true, text: fallback, fromAI: false, reason: r?.reason ? `${r.reason} This is your own words instead.` : 'The AI wrote nothing, so this is your own words.' };
  return { ok: true, text, fromAI: true };
}

// ---------------------------------------------------------------------------------------------------
// *** WHERE A NOTE WAS MADE (2026-10-03). *** "Each note automatically carries context: which dashboard, which
// panel is selected, the page and the time." The time is `at`; the guide's place is `where` (as before); the
// rest is `context: { dashboard, panel, page }`, short strings, each '' when it cannot be known.
//   page       the PATH only. *** Never the query string: a screen's address carries its device key
//              (kiosk.html?key=...), and a note is made to be pasted into a chat. *** The suite checks it.
//   panel      the selected panel's module ("Settings"), read from the screen (`.k-cell[data-focused]`). A
//              press inside Nimrod selects Nimrod, so the panel picked BEFORE him is used then (`lastOther`).
//   dashboard  the host's name for it (`host.dashboard`, kiosk's `ctx.noteContext`), else what the guide
//              knows (the landing, the tutorial), else the dashboard's id.
// ---------------------------------------------------------------------------------------------------
const CTX_MAX = 120;
const short = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, CTX_MAX) : '');
const DASHBOARD_BY_INTRO = Object.freeze({ landing: 'Start here (the landing dashboard)', tutorial: 'the tutorial dashboard' });

/** `{ type, title }` of a panel cell, or null. `titleOf(type)` names a module (module.js getManifest). */
export function panelOf(cell, titleOf = () => '') {
  const type = cell?.getAttribute?.('data-kind') || '';
  if (!type) return null;
  let title = '';
  try { title = short(titleOf(type) || ''); } catch { title = ''; }
  return { type, title: title || type };
}

/**
 * The context of a note made now. `scope`: the screen's element (or the document); `own`: Nimrod's own root
 * (a selected panel that holds it is Nimrod himself); `lastOther`: the panel picked before him, if any.
 */
export function noteContextFrom({ scope = null, own = null, lastOther = null, path = '', host = null, intro = null,
                                  dashboardId = '', titleOf = () => '' } = {}) {
  let cell = null;
  try { cell = [...(scope?.querySelectorAll?.('.k-cell[data-focused]') || [])].find((c) => !(own && c.contains(own))) || null; } catch { cell = null; }
  const p = panelOf(cell, titleOf) || lastOther || null;
  const h = host && typeof host === 'object' ? host : {};
  const dashboard = short(h.dashboard) || DASHBOARD_BY_INTRO[intro] || (dashboardId ? `dashboard ${short(String(dashboardId))}` : '');
  // `path` is a pathname by contract; anything after ? or # is cut here too, whatever a caller passed.
  const page = short(String(path || '').split(/[?#]/)[0]);
  return { dashboard, panel: p ? (p.title && p.title !== p.type ? `${p.title} (${p.type})` : p.type) : '', page };
}

/** "Dashboard: …; panel picked: …; page: …" — the line a note's context reads as. '' when there is none. */
export function contextLine(c) {
  const o = c && typeof c === 'object' ? c : {};
  return [o.dashboard && `dashboard: ${o.dashboard}`, o.panel && `panel picked: ${o.panel}`, o.page && `page: ${o.page}`]
    .filter(Boolean).join('; ');
}

const cleanContext = (c) => {
  const o = c && typeof c === 'object' ? c : {};
  const out = { dashboard: short(o.dashboard), panel: short(o.panel), page: short(String(o.page || '').split(/[?#]/)[0]) };
  return out.dashboard || out.panel || out.page ? out : null;
};

/** A note as kept: `{ id, at, where, text, context? }`, or null when there is nothing in it. */
export function makeNote(text, { at = Date.now(), where = '', context = null } = {}) {
  const t = clip(String(text || '').replace(/\r\n/g, '\n').trim(), NOTE_MAX_CHARS);
  if (!t) return null;
  const c = cleanContext(context);
  return { id: `n-${Number(at).toString(36)}-${Math.random().toString(36).slice(2, 7)}`, at: Number(at), where: String(where || '').slice(0, 80), text: t,
    ...(c ? { context: c } : {}) };
}

/** The list, read from storage: well-formed notes only, oldest first. */
export function cleanNotes(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim() && Number.isFinite(Number(n.at)) && typeof n.id === 'string')
    .map((n) => {
      const c = cleanContext(n.context);
      return { id: n.id, at: Number(n.at), where: typeof n.where === 'string' ? n.where : '', text: n.text, ...(c ? { context: c } : {}) };
    })
    .sort((a, b) => a.at - b.at);
}
/** Close to the most kept: time to copy them out before the oldest goes. */
export const nearlyFull = (list) => cleanNotes(list).length >= NOTES_WARN_AT;

/** Add one; the oldest goes past NOTES_MAX. */
export function addNote(list, note) {
  if (!note) return cleanNotes(list);
  return [...cleanNotes(list), note].slice(-NOTES_MAX);
}
export const removeNote = (list, id) => cleanNotes(list).filter((n) => n.id !== id);

/** Every note as one block of text to paste into a chat: dated, newest last. */
// The context goes on its own line under the heading, in italics, so a pasted list still reads as notes.
export function notesToText(list, { title = 'Notes from the Nimrod guide', at = Date.now() } = {}) {
  const notes = cleanNotes(list);
  if (!notes.length) return '';
  const body = notes.map((n) => {
    const c = contextLine(n.context);
    return `### ${stamp(n.at)}${n.where ? ` (at "${n.where}")` : ''}\n${c ? `_${c}_\n` : ''}${n.text}`;
  }).join('\n\n');
  return `## ${title} (copied ${stamp(at).slice(0, 10)})\n\n${body}\n`;
}

/** The file "Save as a file" writes: Markdown, named by the minute it was saved ("nimrod-notes-2026-10-03-1405.md"). */
export function notesFileName(at = Date.now()) {
  const s = stamp(at);
  return `nimrod-notes-${s ? s.replace(' ', '-').replace(':', '') : 'export'}.md`;
}
