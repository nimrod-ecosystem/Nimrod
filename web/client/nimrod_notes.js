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

export const NOTES_MAX = 40;          // kept on the person record: the oldest goes first past this
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

/** A note as kept: `{ id, at, where, text }`, or null when there is nothing in it. */
export function makeNote(text, { at = Date.now(), where = '' } = {}) {
  const t = clip(String(text || '').replace(/\r\n/g, '\n').trim(), NOTE_MAX_CHARS);
  if (!t) return null;
  return { id: `n-${Number(at).toString(36)}-${Math.random().toString(36).slice(2, 7)}`, at: Number(at), where: String(where || '').slice(0, 80), text: t };
}

/** The list, read from storage: well-formed notes only, oldest first. */
export function cleanNotes(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim() && Number.isFinite(Number(n.at)) && typeof n.id === 'string')
    .map((n) => ({ id: n.id, at: Number(n.at), where: typeof n.where === 'string' ? n.where : '', text: n.text }))
    .sort((a, b) => a.at - b.at);
}

/** Add one; the oldest goes past NOTES_MAX. */
export function addNote(list, note) {
  if (!note) return cleanNotes(list);
  return [...cleanNotes(list), note].slice(-NOTES_MAX);
}
export const removeNote = (list, id) => cleanNotes(list).filter((n) => n.id !== id);

/** Every note as one block of text to paste into a chat: dated, newest last. */
export function notesToText(list, { title = 'Notes from the Nimrod guide', at = Date.now() } = {}) {
  const notes = cleanNotes(list);
  if (!notes.length) return '';
  const body = notes.map((n) => `### ${stamp(n.at)}${n.where ? ` (at "${n.where}")` : ''}\n${n.text}`).join('\n\n');
  return `## ${title} (copied ${stamp(at).slice(0, 10)})\n\n${body}\n`;
}
