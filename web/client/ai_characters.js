// ai_characters.js — AI CHARACTERS AS PROFILES: who they are (a name, a persona, a face, a voice, what
// they are good at) and the ROOMS that go with them. Pure data and pure helpers, plus the one maker that
// turns a character's room into a real dashboard on a press. modules/profile.js draws them;
// dev/ai_characters_test.html checks them.
//
// Mike, 2026-10-02: *"The nimrod/ai module could have AI profiles. Like start with Nimrod and a few others.
// Each could have rooms too. Your AI could be pulled into the dashboard as an avatar or a profile module.
// They could have rooms with modules that would fit with them (a math tutor having a calculator in their
// room). Friends and other users could also have profiles that could be modules. I might make a second self
// AI trained on my recordings with an avatar that looks like me. Friends could share AIs the same way they
// link users."*
//
// =====================================================================================================
// *** WHERE THEY ARE KEPT, ARGUED. ***
// The ask was "as a profile with kind 'ai', if the server supports it". It does not: the server's
// `profiles` table is SCREENS (id, user_id, name, person_id — no kind), and `people` is the people on an
// account (id, account_id, name — no kind). Two ways to get there:
//   (a) A `kind` column on `people`, an AI being a person row. FOR: one list of "who", the server's own
//       ids, and grants/links already key off a person. AGAINST, and it wins for now: every surface that
//       lists people today (the people bar, the "who is this screen for" picker, removePerson's "last
//       person on the account" rule, drive grants, the avatars cache) would start listing AI characters
//       the day it shipped, and each one would need a filter written and checked — a migration across a
//       dozen callers to store a few kilobytes of text.
//   (b) CHOSEN: the ready-made characters are DATA here (SEED_CHARACTERS, like dashboards.js's ready-made
//       dashboards — offered, never copied onto anybody's record until they change one), and a person's
//       OWN characters (made, or copied from a seed) are kept on THEIR person record under
//       AI_CHARACTERS_KEY (`makePersonState(personId, 'ai-characters')`): the generic per-person store the
//       avatar, the AI's own name and the music favourites already use. No new table, no new endpoint, and
//       they follow the person to every screen. Each record still says `kind: 'ai'`, so the day (a) is
//       worth it, the records move over as they are.
// The cost of (b), stated: an AI character has no server-side id of its own, so a grant or a link cannot
// name one yet. That is exactly the sharing step (below), and it is not built.
//
// *** SHARING — THE SHAPE ONLY (no UI, no endpoint). *** Every record carries `owner` (the person id that
// made it; null for a seed) and `sharedWith: [{ kind: 'account', id, at }]` (always empty today). The plan
// it leaves room for: sharing a character is a LINK PERMISSION (links.py `link_permissions`, capability
// e.g. 'ai_character', subject = the linked account) on the owner's person, and the friend's screen reads
// the owner's record through a read-only endpoint that checks that permission — "the same way they link
// users". Until then `sharedWith` is normalised and kept, and nothing reads it.
//
// *** THE "SECOND SELF" HOOK. *** A person makes their own character (or copies Nimrod and changes him):
// a name, a persona in their own words, a face (their own avatar's drawing can be copied in), a voice
// choice and a room. `voiceModel` is RESERVED and always null: training a voice on somebody's recordings is
// out of scope, nothing here loads or plays a voice model, and a stored value is not kept (a field nothing
// can produce must not be filled in by hand and then trusted).
// =====================================================================================================

import { normalizeRecord, PARTS, surprise, readAvatar } from './avatar.js';
import { DEFAULT_PERSONA, NAME_MAX, PERSONA_MAX, AI_STATE_KEY, aiPrefs } from './nimrod_ai.js';
import { CATALOG } from './modules_catalog.js';
import { PRESETS } from './layout.js';
import { THEMES, DEFAULT_THEME } from './theme.js';
import { PANEL_SURFACES, layoutFor } from './dashboards.js';

export const CHARACTER_VERSION = 1;
export const AI_CHARACTERS_KEY = 'ai-characters';   // the PERSON's record (ctx.makePersonState)
export const PROFILE_KINDS = Object.freeze(['person', 'ai']);
export const PROFILE_TYPE = 'profile';               // modules/profile.js: the character's own card in its room
export { NAME_MAX, PERSONA_MAX };

// THE NUMBERS (Rule 1). None is a person's preference, so none is a menu row; each is a cap on stored text.
//   GOOD_AT_MAX 120  one line under a name on a card, read aloud in one breath.
//   ROOMS_MAX 3      a card shows one "Visit" button per room; three is what a card can hold without the
//                    buttons becoming a list a switch user has to walk. A character's rooms are data, so
//                    a room editor later can lift this.
//   OWN_MAX 24       characters one person keeps. A record is a few kilobytes (persona 2000 characters); 24
//                    keeps the person's row well under what one state row should carry, and is more than
//                    the picker can show on one screen.
export const GOOD_AT_MAX = 120;
export const ROOMS_MAX = 3;
export const OWN_MAX = 24;

// Site copy never names a person or says "her screen" (CLAUDE.md, porting rules). Checked on every seed.
export const NAMES_RE = /\bher screen|christine|cici/i;

// =====================================================================================================
// VOICES. "A voice choice where TTS exists": the speech channel (output_channels.js) takes a caller's own
// `data.voice` ({ uri?, lang?, rate?, pitch? }) over the person's. These change RATE AND PITCH only.
//   'own' (the default for anybody who chose nothing) sends no voice at all, so the screen's own chosen
//   voice speaks, exactly as for Nimrod. AGAINST naming a system voice (uri): voices differ per device
//   (voice.js), so a character that "is" one voice would sound different on every screen anyway.
//   COST, stated: output_channels.js REPLACES the person's voice preference with a caller's, rather than
//   merging — so a character on 'bright' speaks in the device's default voice, brighter, not in the
//   person's chosen voice, brighter. The one-line merge is with the coordinator (not this file's to change).
// =====================================================================================================
export const VOICE_CHOICES = Object.freeze([
  Object.freeze({ id: 'own', label: 'The screen’s own voice', voice: null }),
  Object.freeze({ id: 'calm', label: 'Calm and a little slower', voice: Object.freeze({ rate: 0.85, pitch: 1 }) }),
  Object.freeze({ id: 'bright', label: 'Brighter', voice: Object.freeze({ rate: 1.05, pitch: 1.3 }) }),
  Object.freeze({ id: 'deep', label: 'Deeper', voice: Object.freeze({ rate: 0.95, pitch: 0.7 }) }),
]);
export const DEFAULT_VOICE = 'own';
export const voiceChoice = (id) => VOICE_CHOICES.find((v) => v.id === id) || VOICE_CHOICES[0];
/** What goes on `ctx.output.say`'s `data` for this character: `{ voice }`, or null for the screen's own. */
export function voiceData(char) {
  const v = voiceChoice(char && char.voice).voice;
  return v ? { voice: { ...v } } : null;
}

// Site portraits: a character can be shown by a picture the SITE ships instead of a drawn face. One today:
// Nimrod is the cat everywhere else (cat_guide.js), so he is the cat here too. A closed list — never a URL
// from a record — so nothing stored can point the card at an outside address.
export const PORTRAITS = Object.freeze({ cat: Object.freeze({ pose: 'talking', label: 'Nimrod the cat' }) });

// =====================================================================================================
// ROOMS. A room is a DASHBOARD TEMPLATE in dashboards.js's own record shape ({ modules: [{ ref, type,
// state? }], layout: { preset, slots: [ref] }, settings: { theme, panelSurface } }), so the same
// `layoutFor` turns it into a saved arrangement. `self: true` on a module is the character's OWN card
// (modules/profile.js, showing this character): "your AI pulled into the dashboard as an avatar".
// Every other module is one the catalog describes (checked: `roomProblems`).
//
// THE TEMPLATES, each argued (Code's picks, on Mike's list; the modules are what exists today):
//   guide    the guide himself (his panel IS him, with "Talk to"), what changed lately, the modules
//            library and the devices: "where everything is", for the character who shows you around.
//   maths    the character's card, the calculator (Mike's own example), Math (algebra: counting up to
//            solving for x, with a calculator of its own) and a scoreboard to count what was done.
//   stories  the card, your photos (a picture to tell a story about), the reading log (what was read)
//            and the word games (asked out loud, with a picture). There is no story-reading module yet;
//            when there is, it belongs here.
//   quiz     the card, Trivia (questions you write), the brain games (quick rounds) and a scoreboard.
//   plain    only the card, full screen: for a character somebody makes before they know what room it
//            wants. One step from any other through Home's Switch module.
// All four-panel rooms are "Four up" with the card top left, where a reader starts. Solid panels, the
// default theme: plain Nimrod, the look the landing dashboard has.
// =====================================================================================================
const SOLID = Object.freeze({ theme: DEFAULT_THEME, panelSurface: 'solid' });
export const ROOM_TEMPLATES = Object.freeze({
  guide: Object.freeze({ key: 'guide', name: 'Guide room', modules: [
    { ref: 'guide', type: 'nimrod' }, { ref: 'news', type: 'whats_new' }, { ref: 'devices', type: 'devices' }, { ref: 'library', type: 'library' },
  ], layout: { preset: 'quad', slots: ['guide', 'news', 'devices', 'library'] }, settings: SOLID }),
  maths: Object.freeze({ key: 'maths', name: 'Maths room', modules: [
    { ref: 'me', type: PROFILE_TYPE, self: true }, { ref: 'calculator', type: 'calculator' },
    { ref: 'maths', type: 'algebra' }, { ref: 'score', type: 'scoreboard' },
  ], layout: { preset: 'quad', slots: ['me', 'calculator', 'maths', 'score'] }, settings: SOLID }),
  stories: Object.freeze({ key: 'stories', name: 'Story room', modules: [
    { ref: 'me', type: PROFILE_TYPE, self: true }, { ref: 'photos', type: 'photos' },
    { ref: 'reading', type: 'reading_log' }, { ref: 'words', type: 'word_games' },
  ], layout: { preset: 'quad', slots: ['me', 'photos', 'reading', 'words'] }, settings: SOLID }),
  quiz: Object.freeze({ key: 'quiz', name: 'Quiz room', modules: [
    { ref: 'me', type: PROFILE_TYPE, self: true }, { ref: 'trivia', type: 'trivia' },
    { ref: 'brain', type: 'brain_games' }, { ref: 'score', type: 'scoreboard' },
  ], layout: { preset: 'quad', slots: ['me', 'trivia', 'brain', 'score'] }, settings: SOLID }),
  plain: Object.freeze({ key: 'plain', name: 'Room', modules: [{ ref: 'me', type: PROFILE_TYPE, self: true }],
    layout: { preset: 'full', slots: ['me'] }, settings: SOLID }),
});
// The order a person's own character steps through when choosing its room (one switch, one way, wrapping).
export const ROOM_TEMPLATE_ORDER = Object.freeze(['plain', 'maths', 'stories', 'quiz', 'guide']);

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const str = (v) => (typeof v === 'string' ? v : '');
const oneLine = (v, max) => str(v).replace(/\s+/g, ' ').trim().slice(0, max);

/** A room from a template: a deep copy, with its id. */
export function roomFromTemplate(key, { id = key } = {}) {
  const t = ROOM_TEMPLATES[key] || ROOM_TEMPLATES.plain;
  return { id, template: t.key, name: t.name, modules: clone(t.modules), layout: clone(t.layout), settings: clone(t.settings) };
}

/** Every type a room may hold: what the catalog describes, and the character's own card. */
export function roomTypes() {
  return new Set([...CATALOG.map((c) => c.type), PROFILE_TYPE]);
}

/** What is wrong with a room, as sentences (empty = valid). `knownTypes`: the live registry, optional. */
export function roomProblems(room, { knownTypes = null, types = roomTypes() } = {}) {
  const out = [];
  if (!room || typeof room !== 'object') return ['not a room'];
  if (!str(room.id).trim()) out.push('a room with no id');
  if (!str(room.name).trim()) out.push('a room with no name');
  const mods = Array.isArray(room.modules) ? room.modules : [];
  if (!mods.length) out.push(`${room.name}: no modules`);
  const refs = new Set();
  for (const m of mods) {
    if (!m || !m.ref || !m.type) { out.push(`${room.name}: a module without a ref or a type`); continue; }
    if (refs.has(m.ref)) out.push(`${room.name}: ref ${m.ref} twice`);
    refs.add(m.ref);
    if (!types.has(m.type)) out.push(`${room.name}: ${m.type} is not a module the catalog describes`);
    if (knownTypes && !knownTypes.has(m.type)) out.push(`${room.name}: ${m.type} is not a registered module`);
    if (m.self && m.type !== PROFILE_TYPE) out.push(`${room.name}: only a profile card can be the character itself`);
  }
  const L = room.layout || {};
  const p = PRESETS.find((x) => x.id === L.preset);
  if (!p) out.push(`${room.name}: layout ${L.preset} does not exist`);
  const slots = Array.isArray(L.slots) ? L.slots : [];
  if (p && slots.length !== p.slots) out.push(`${room.name}: ${p.id} has ${p.slots} places, the room fills ${slots.length}`);
  for (const r of slots) if (r && !refs.has(r)) out.push(`${room.name}: the layout names ${r}, which is not one of its modules`);
  for (const r of refs) if (!slots.includes(r)) out.push(`${room.name}: ${r} is not placed`);
  const s = room.settings || {};
  if (!THEMES[s.theme]) out.push(`${room.name}: theme ${s.theme} does not exist`);
  if (!PANEL_SURFACES.includes(s.panelSurface)) out.push(`${room.name}: panel backgrounds ${s.panelSurface} is not one of ${PANEL_SURFACES.join('/')}`);
  return out;
}

/** A room kept as given when valid, else the template it names (or plain): a stored room never breaks a card. */
function cleanRoom(raw, i) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = oneLine(r.id, 40) || `room-${i + 1}`;
  const candidate = {
    id, template: ROOM_TEMPLATES[r.template] ? r.template : null, name: oneLine(r.name, NAME_MAX),
    modules: Array.isArray(r.modules) ? clone(r.modules).filter((m) => m && typeof m === 'object')
      .map((m) => ({ ref: oneLine(m.ref, 40), type: oneLine(m.type, 40), ...(m.self ? { self: true } : {}),
        ...(m.state && typeof m.state === 'object' && !Array.isArray(m.state) ? { state: m.state } : {}) })) : [],
    layout: r.layout && typeof r.layout === 'object' ? { preset: r.layout.preset, slots: Array.isArray(r.layout.slots) ? [...r.layout.slots] : [] } : {},
    settings: { ...SOLID, ...(r.settings && typeof r.settings === 'object' ? r.settings : {}) },
  };
  if (!roomProblems(candidate).length) return candidate;
  return roomFromTemplate(candidate.template || 'plain', { id });
}

// =====================================================================================================
// THE SEEDS: Nimrod and three others, each argued. Avatars are avatar.js part ids (checked: every one on
// its list, no contrast warning). None is named after a person; none is anybody's "second self".
//   Nimrod  the guide the site already has. Here he is "your AI": his name and persona follow the person's
//           own settings for him (nimrod_ai.js AI_STATE_KEY) when they changed them — one "your AI", not
//           two that disagree. Shown as the cat.
//   Tally   a maths tutor, because Mike's own example is "a math tutor having a calculator in their room".
//   Quill   a story reader: stories are the other half of what a tutor-and-games site is short of, and
//           a story about one of your own pictures is a conversation an AI can actually have.
//   Buzzer  a quiz host: the site's biggest group of modules is quizzes and brain games, and a host who
//           asks one question at a time is the most natural way to talk to them.
// =====================================================================================================
const seed = (r) => Object.freeze({
  v: CHARACTER_VERSION, kind: 'ai', seed: true, owner: null, sharedWith: [], copiedFrom: null, voiceModel: null, at: null, ...r,
});
export const SEED_CHARACTERS = Object.freeze([
  seed({
    id: 'nimrod', name: 'Nimrod', persona: DEFAULT_PERSONA, portrait: 'cat',
    goodAt: 'Showing you around: what everything does, and what to try next.',
    avatar: { use: 'drawn', drawn: { face: 'round', skin: 's3', hair: 'curly', hairColor: 'ginger', eyes: 'happy', brows: 'soft',
      mouth: 'grin', glasses: 'none', facial: 'none', extra: 'none', top: 'green', bg: 'mint' } },
    voice: 'own', rooms: [roomFromTemplate('guide')],
  }),
  seed({
    id: 'tally', name: 'Tally',
    persona: 'You are a patient maths tutor. You explain one small step at a time, with everyday things like money, '
      + 'cooking and clocks, and you check understanding with one gentle question at a time. You praise effort, '
      + 'never speed, and you never make anybody feel slow.',
    goodAt: 'Sums, fractions, money and time, one small step at a time.',
    avatar: { use: 'drawn', drawn: { face: 'square', skin: 's8', hair: 'bun', hairColor: 'black', eyes: 'round', brows: 'straight',
      mouth: 'smile', glasses: 'round', facial: 'none', extra: 'none', top: 'blue', bg: 'sand' } },
    voice: 'calm', rooms: [roomFromTemplate('maths')],
  }),
  seed({
    id: 'quill', name: 'Quill',
    persona: 'You are a warm storyteller and reading companion. You tell short stories, help choose something to read, '
      + 'talk about what was read, and make up a story about a picture somebody describes. Your sentences are short '
      + 'and easy to follow when they are read aloud.',
    goodAt: 'Short stories, reading together, and stories about your pictures.',
    avatar: { use: 'drawn', drawn: { face: 'oval', skin: 's6', hair: 'wavy', hairColor: 'auburn', eyes: 'lashes', brows: 'arched',
      mouth: 'small', glasses: 'none', facial: 'none', extra: 'flower', top: 'purple', bg: 'sky' } },
    voice: 'deep', rooms: [roomFromTemplate('stories')],
  }),
  seed({
    id: 'buzzer', name: 'Buzzer',
    persona: 'You are a lively, friendly quiz host. You ask one question at a time, give a hint when asked, cheer a right '
      + 'answer and turn a wrong one into an interesting fact. You keep score only if asked, and nobody is ever made '
      + 'to feel bad for not knowing.',
    goodAt: 'Quizzes, riddles and quick brain games, one question at a time.',
    avatar: { use: 'drawn', drawn: { face: 'heart', skin: 's10', hair: 'afro', hairColor: 'black', eyes: 'wide', brows: 'thick',
      mouth: 'open', glasses: 'big', facial: 'mustache', extra: 'none', top: 'orange', bg: 'peach' } },
    voice: 'bright', rooms: [roomFromTemplate('quiz')],
  }),
]);
export const seedById = (id) => SEED_CHARACTERS.find((c) => c.id === id) || null;

/** Is every part of an avatar record an id on its own list (not a repaired or free value)? */
export function avatarPartProblems(drawn) {
  const d = drawn && typeof drawn === 'object' ? drawn : null;
  if (!d) return ['no drawn avatar'];
  return PARTS.filter((p) => !p.options.some((o) => o.id === d[p.key])).map((p) => `avatar part ${p.key}: ${d[p.key]} is not on its list`);
}

/** What is wrong with a character, as sentences (empty = valid). */
export function characterProblems(c, { knownTypes = null } = {}) {
  const out = [];
  if (!c || typeof c !== 'object') return ['not a character'];
  if (c.kind !== 'ai') out.push('kind is not ai');
  if (!str(c.id).trim()) out.push('no id');
  for (const k of ['name', 'persona', 'goodAt']) if (!str(c[k]).trim()) out.push(`no ${k}`);
  if (str(c.name).length > NAME_MAX) out.push('name too long');
  if (str(c.persona).length > PERSONA_MAX) out.push('persona too long');
  if (str(c.goodAt).length > GOOD_AT_MAX) out.push('goodAt too long');
  if (!VOICE_CHOICES.some((v) => v.id === c.voice)) out.push(`voice ${c.voice} is not a choice`);
  if (c.voiceModel !== null) out.push('voiceModel must be null (nothing trains or loads a voice yet)');
  if (c.portrait != null && !PORTRAITS[c.portrait]) out.push(`portrait ${c.portrait} is not one the site ships`);
  const a = c.avatar && typeof c.avatar === 'object' ? c.avatar : null;
  if (!a || a.use !== 'drawn') out.push('avatar is not a drawn one');
  else out.push(...avatarPartProblems(a.drawn));
  const rooms = Array.isArray(c.rooms) ? c.rooms : [];
  if (!rooms.length) out.push('no room');
  if (rooms.length > ROOMS_MAX) out.push(`more than ${ROOMS_MAX} rooms`);
  const ids = new Set();
  for (const r of rooms) {
    if (ids.has(r?.id)) out.push(`room ${r?.id} twice`);
    ids.add(r?.id);
    out.push(...roomProblems(r, { knownTypes }));
  }
  if (!Array.isArray(c.sharedWith)) out.push('sharedWith is not a list');
  if (NAMES_RE.test(JSON.stringify(c))) out.push('names a person or says "her screen"');
  return out;
}

// =====================================================================================================
// A PERSON'S OWN CHARACTERS: cleaned, made, changed, copied. Pure: the row in, a new row out.
// =====================================================================================================
const SHARE_KINDS = Object.freeze(['account']);
function cleanShared(list) {
  return (Array.isArray(list) ? list : []).filter((s) => s && SHARE_KINDS.includes(s.kind) && typeof s.id === 'string' && s.id)
    .map((s) => ({ kind: s.kind, id: s.id.slice(0, 200), at: Number.isFinite(s.at) ? s.at : null }));
}

/** A stored (or typed) character, repaired: every field present and valid. Seeds come back as seeds. */
export function normalizeCharacter(raw, { owner = null } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const av = r.avatar && typeof r.avatar === 'object' ? r.avatar : {};
  const drawn = normalizeRecord(av.drawn || surprise(r.id || r.name || 'character'));
  const rooms = (Array.isArray(r.rooms) && r.rooms.length ? r.rooms : [roomFromTemplate('plain')]).slice(0, ROOMS_MAX).map(cleanRoom);
  // Two rooms with one id would make one made dashboard answer for both.
  const seen = new Set();
  for (const room of rooms) { while (seen.has(room.id)) room.id = `${room.id}-2`; seen.add(room.id); }
  return {
    v: CHARACTER_VERSION, kind: 'ai',
    id: oneLine(r.id, 80),
    name: oneLine(r.name, NAME_MAX) || 'My AI',
    persona: str(r.persona).trim().slice(0, PERSONA_MAX) || DEFAULT_PERSONA,
    goodAt: oneLine(r.goodAt, GOOD_AT_MAX) || 'Talking things over.',
    avatar: { use: 'drawn', drawn },
    ...(PORTRAITS[r.portrait] ? { portrait: r.portrait } : {}),
    voice: VOICE_CHOICES.some((v) => v.id === r.voice) ? r.voice : DEFAULT_VOICE,
    voiceModel: null,
    rooms,
    seed: r.seed === true,
    owner: r.seed === true ? null : (typeof r.owner === 'string' && r.owner ? r.owner : owner),
    sharedWith: cleanShared(r.sharedWith),
    copiedFrom: typeof r.copiedFrom === 'string' && r.copiedFrom ? r.copiedFrom.slice(0, 80) : null,
    at: Number.isFinite(r.at) ? r.at : null,
  };
}

let idSeq = 0;
/** A fresh id for a person's own character (never a seed's). */
export function newCharacterId(now = Date.now(), rand = Math.random) {
  idSeq += 1;
  return `c-${Math.floor(now).toString(36)}-${idSeq.toString(36)}${Math.floor(rand() * 1296).toString(36)}`;
}

/** A NEW character of the person's own. `room` is a template key. */
export function createCharacter({ name = '', persona = '', goodAt = '', drawn = null, voice = DEFAULT_VOICE, room = 'plain' } = {},
                                { owner = null, id = newCharacterId(), now = Date.now() } = {}) {
  return normalizeCharacter({
    id, name, persona, goodAt, voice, owner, seed: false, at: now,
    avatar: { use: 'drawn', drawn: drawn || surprise(id) },
    rooms: [roomFromTemplate(ROOM_TEMPLATES[room] ? room : 'plain')],
  }, { owner });
}

// THE FIELDS EDIT MAY CHANGE. Not the id (a made room is found by it), not owner/seed/copiedFrom (who
// made it), not sharedWith (sharing is its own step).
export const EDITABLE = Object.freeze(['name', 'persona', 'goodAt', 'drawn', 'voice', 'room']);
export const SEED_EDIT_REASON = 'A ready-made character is not changed: copy it, and change the copy.';

/** One character, changed. `{ ok, rec }` or `{ ok: false, reason }` (a seed is never changed in place). */
export function editCharacter(rec, patch = {}, { now = Date.now() } = {}) {
  if (!rec || rec.seed) return { ok: false, reason: SEED_EDIT_REASON };
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = clone(rec);
  for (const k of ['name', 'persona', 'goodAt', 'voice']) if (k in p) next[k] = p[k];
  // A face chosen for it replaces a site portrait too (a copy of Nimrod given a face is no longer the cat).
  if (p.drawn) { next.avatar = { use: 'drawn', drawn: p.drawn }; delete next.portrait; }
  // A room picked from the templates REPLACES the first room, keeping its id (so the dashboard made for it
  // is still the one it opens; what is on that dashboard is the person's now, as with every made one).
  if (p.room && ROOM_TEMPLATES[p.room] && next.rooms[0]?.template !== p.room) {
    next.rooms[0] = roomFromTemplate(p.room, { id: next.rooms[0]?.id || 'room-1' });
  }
  next.at = now;
  return { ok: true, rec: normalizeCharacter(next, { owner: rec.owner }) };
}

/** A copy of ANY character (a seed or one's own), the person's own from then on. */
export function copyCharacter(rec, { owner = null, id = newCharacterId(), now = Date.now() } = {}) {
  if (!rec) return null;
  const c = clone(rec);
  return normalizeCharacter({
    ...c, id, seed: false, owner, sharedWith: [], copiedFrom: rec.id, at: now,
    name: `${rec.name} (copy)`.slice(0, NAME_MAX),
  }, { owner });
}

/** The person's row, read: their own characters (cleaned, capped) and the rooms made for them. */
export function readCharacterRow(row) {
  const r = row && typeof row === 'object' ? row : {};
  const own = (Array.isArray(r.characters) ? r.characters : []).slice(0, OWN_MAX)
    .map((c) => normalizeCharacter({ ...c, seed: false })).filter((c) => c.id && !seedById(c.id));
  const rooms = {};
  for (const [k, v] of Object.entries(r.rooms && typeof r.rooms === 'object' ? r.rooms : {})) {
    if (typeof v === 'string' && v && k.length <= 200) rooms[k] = v;
  }
  return { characters: own, rooms };
}

/** The row with `rec` put in (replacing one with its id), or `{ error }` at OWN_MAX. */
export function withCharacter(row, rec) {
  const r = readCharacterRow(row);
  const at = r.characters.findIndex((c) => c.id === rec.id);
  if (at < 0 && r.characters.length >= OWN_MAX) return { error: `You can keep ${OWN_MAX} characters of your own. Remove one to make another.` };
  const characters = [...r.characters];
  if (at < 0) characters.push(rec); else characters[at] = rec;
  return { row: { characters, rooms: r.rooms } };
}
export function withoutCharacter(row, id) {
  const r = readCharacterRow(row);
  return { characters: r.characters.filter((c) => c.id !== id), rooms: r.rooms };
}

/**
 * Every character this person can see: the seeds, then their own. `aiRow` is their nimrod_ai.js record:
 * the Nimrod seed takes the name and persona they gave "their AI" there, so the card and the guide agree.
 */
export function allCharacters(row, { aiRow = null } = {}) {
  const seeds = SEED_CHARACTERS.map((c) => (c.id === 'nimrod' ? withYourAI(c, aiRow) : c));
  return [...seeds, ...readCharacterRow(row).characters];
}
export function withYourAI(nimrod, aiRow) {
  if (!aiRow || typeof aiRow !== 'object') return nimrod;
  const p = aiPrefs(aiRow);
  return { ...nimrod, name: p.name, persona: p.persona || nimrod.persona };
}
export function findCharacter(row, id, opts = {}) {
  return allCharacters(row, opts).find((c) => c.id === id) || null;
}

// =====================================================================================================
// WHAT THE AI IS TOLD. nimrod_ai.js's `createGuideChat` takes the persona today (its `prefs`: name and
// persona), so a character talks through it unchanged. Its system prompt also describes the guide's tree,
// which is noise for a maths tutor; `characterSystemPrompt` is the prompt a character SHOULD get, and the
// one-option change to nimrod_ai.js that would use it is with the coordinator (`system`, a function).
// =====================================================================================================
export function characterSystemPrompt(char, { actions = [] } = {}) {
  const c = char || {};
  const acts = actions.map((a) => `  [[${a.name}${a.args ? ` ${a.args}` : ''}]]  ${a.help}`).join('\n');
  return [
    `Your name is ${c.name || 'Nimrod'}. ${c.persona || DEFAULT_PERSONA}`,
    `What you are good at: ${c.goodAt || 'talking things over'}.`,
    'You are a character on the Nimrod website, a site of dashboards made of modules (pictures, games, music '
      + 'and more). You are talking with the person using it. They may be speaking out loud, so their words can be '
      + 'mis-heard: if something makes no sense, ask.',
    'Keep every reply short: two or three plain sentences. Your replies may be read aloud.',
    ...(acts ? ['', 'You can ask the screen to do these things, each on its own line at the END of your reply, in double '
      + 'square brackets. The person sees each as a button and nothing happens unless they press it.', acts] : []),
  ].join('\n');
}

// =====================================================================================================
// THE PICKER'S LIST: the people on this account, then the characters. "Friends and other users could also
// have profiles": linking accounts is not built, so a person here is only somebody on THIS account.
// =====================================================================================================
export function profileEntries({ people = [], characters = [], viewerId = null } = {}) {
  const persons = (Array.isArray(people) ? people : []).filter((p) => p && p.id).map((p) => ({
    kind: 'person', id: p.id, name: oneLine(p.name, NAME_MAX) || 'Somebody',
    line: viewerId && p.id === viewerId ? 'You' : 'On this account',
  }));
  const ais = (Array.isArray(characters) ? characters : []).map((c) => ({
    kind: 'ai', id: c.id, name: c.name, line: c.goodAt, seed: !!c.seed,
  }));
  return [...persons, ...ais];
}
/** A panel's stored subject, repaired: `{ kind, id }` or null. */
export function readSubject(v) {
  return v && typeof v === 'object' && PROFILE_KINDS.includes(v.kind) && typeof v.id === 'string' && v.id ? { kind: v.kind, id: v.id } : null;
}

// =====================================================================================================
// WHERE THE PERSON'S CHARACTERS LIVE ON THIS SCREEN: their person record when the host has one, else this
// panel's own state under `aiCharacters` (a preview; nimrod_ai.js openAIStore's same two-way shape).
// =====================================================================================================
export const PANEL_ROW_KEY = 'aiCharacters';
export async function openCharacterStore(ctx, key = AI_CHARACTERS_KEY) {
  let pid = null;
  try { pid = ctx?.personId || null; } catch { pid = null; }
  let handle = null;
  if (pid && typeof ctx?.makePersonState === 'function') {
    try { handle = ctx.makePersonState(pid, key); } catch { handle = null; }
  }
  if (handle && typeof handle.get === 'function') {
    try { await handle.load?.(); } catch { /* offline: what is cached */ }
    return {
      kind: 'person', personId: pid,
      get: () => { try { return handle.get() || {}; } catch { return {}; } },
      set: (patch) => { try { handle.set(patch); } catch (err) { console.error('ai characters: save', err); } },
      flush: () => Promise.resolve(handle.flush?.()).catch(() => {}),
      destroy: () => { try { handle.flush?.(); } catch { /* gone */ } try { handle.destroy?.(); } catch { /* gone */ } },
    };
  }
  const st = ctx?.state || null;
  const own = () => { try { const a = st?.get?.()?.[PANEL_ROW_KEY]; return a && typeof a === 'object' ? a : {}; } catch { return {}; } };
  return {
    kind: st ? 'panel' : 'memory', personId: null,
    get: own,
    set: (patch) => { try { st?.set?.({ [PANEL_ROW_KEY]: { ...own(), ...patch } }); } catch (err) { console.error('ai characters: save', err); } },
    flush: () => Promise.resolve(st?.flush?.()).catch(() => {}),
    destroy: () => {},
  };
}
/** The person's own avatar's drawing, if they made one ("an avatar that looks like me"). */
export function ownDrawing(avatarRow) {
  const a = readAvatar(avatarRow);
  return a.drawn || null;
}
export { AI_STATE_KEY };

// =====================================================================================================
// A CHARACTER'S ROOM AS A REAL DASHBOARD — made on the press of "Visit room", once, then opened.
// The ready-made dashboards' rules (dashboards.js `createDashboardMaker`), for a room:
//   * OFFERED, NOT FORCED: nothing is made by looking at a card. Visit is a press, and the press makes it.
//   * A PLAIN COPY: what is made is an ordinary dashboard the person can change; changing the character's
//     room later changes what a NEW visit would make, never the one already made.
//   * RE-ENTRANT: the dashboard's settings doc is stamped first (`aiRoom: '<character>/<room>'`), and the
//     person's row remembers its id straight after it is created, so a page closed half-way leaves a
//     dashboard the next press FINISHES rather than a second one.
//   * FOUND BY THE PERSON'S ROW, not by reading every dashboard's settings (one read, not one per screen).
// =====================================================================================================
export const AI_ROOM_KEY = 'aiRoom';
export const AI_ROOM_REFS_KEY = 'aiRoomRefs';
export const AI_ROOM_DONE_KEY = 'aiRoomDone';
export const roomKey = (charId, roomId) => `${charId}/${roomId}`;
export const roomDashboardName = (char, room) => `${char.name}: ${room.name}`.slice(0, 80);

/** The room as dashboards.js's record shape, its own card pointed at the character. */
export function roomRecord(char, roomId) {
  const room = (char?.rooms || []).find((r) => r.id === roomId) || (char?.rooms || [])[0];
  if (!room) return null;
  return {
    key: roomKey(char.id, room.id), name: roomDashboardName(char, room),
    modules: room.modules.map((m) => ({ ref: m.ref, type: m.type,
      ...(m.self ? { state: { ...(m.state || {}), subject: { kind: 'ai', id: char.id } } } : (m.state ? { state: clone(m.state) } : {})) })),
    layout: clone(room.layout), settings: clone(room.settings),
  };
}

export function createRoomMaker({ profiles, makeSettings, makeInstanceState, store, personId = () => '' } = {}) {
  if (!profiles || typeof profiles.create !== 'function' || typeof profiles.addModule !== 'function'
      || typeof makeSettings !== 'function' || typeof makeInstanceState !== 'function' || !store) {
    throw new Error('createRoomMaker: profiles (create, addModule, get, list), makeSettings, makeInstanceState and store are required');
  }
  const read = (v) => { try { return (typeof v === 'function' ? v() : v) || ''; } catch { return ''; } };
  const inflight = new Map();
  async function withDoc(handle, fn) {
    await Promise.resolve(handle?.load?.()).catch(() => {});
    try { const out = await fn(handle); await Promise.resolve(handle?.flush?.()).catch(() => {}); return out; }
    finally { try { handle?.destroy?.(); } catch { /* gone */ } }
  }
  const readDoc = (pid) => withDoc(makeSettings(pid), (h) => ({ ...(h?.get?.() || {}) }));
  const patchDoc = (pid, fn) => withDoc(makeSettings(pid), (h) => { h.set(fn(h.get?.() || {})); });
  const remember = async (key, pid) => {
    const r = readCharacterRow(store.get());
    store.set({ rooms: { ...r.rooms, [key]: pid } });
    await store.flush?.();
  };

  async function build(char, roomId) {
    const rec = roomRecord(char, roomId);
    if (!rec) throw new Error('this character has no room');
    let pid = readCharacterRow(store.get()).rooms[rec.key] || null;
    if (pid) {
      let list = null;
      try { list = await profiles.list(); } catch { list = null; }
      // Deleted since (it is the person's to delete): make it again. Offline: trust the row.
      if (Array.isArray(list) && !list.some((s) => s && s.id === pid)) pid = null;
    }
    let doc = pid ? await readDoc(pid).catch(() => ({})) : {};
    if (pid && doc[AI_ROOM_KEY] === rec.key && doc[AI_ROOM_DONE_KEY] === true) return { id: pid, name: rec.name, created: false };
    let created = false;
    if (!pid) {
      const s = await profiles.create(rec.name, read(personId));
      pid = s.id; created = true;
      await patchDoc(pid, () => ({ [AI_ROOM_KEY]: rec.key, [AI_ROOM_REFS_KEY]: {} }));
      await remember(rec.key, pid);
      doc = {};
    }
    const screen = await profiles.get?.(pid).catch?.(() => null);
    const ids = new Set(((screen && screen.modules) || []).map((m) => m.id));
    const refs = { ...(doc[AI_ROOM_REFS_KEY] || {}) };
    for (const m of rec.modules) {
      if (refs[m.ref] && ids.has(refs[m.ref])) continue;
      const mod = await profiles.addModule(pid, m.type);
      if (m.state) await withDoc(makeInstanceState(pid, mod.id), (h) => { h.set({ ...m.state }); });
      refs[m.ref] = mod.id;
      await patchDoc(pid, () => ({ [AI_ROOM_REFS_KEY]: { ...refs } }));
    }
    const layout = layoutFor(rec, refs);
    await patchDoc(pid, (cur) => ({
      ...rec.settings, kiosk: { ...(cur.kiosk || {}), layout },
      [AI_ROOM_KEY]: rec.key, [AI_ROOM_REFS_KEY]: { ...refs }, [AI_ROOM_DONE_KEY]: true,
    }));
    return { id: pid, name: rec.name, created };
  }
  /** The character's room as a dashboard: found if made, made (once) if not. `{ id, name, created }`. */
  function ensure(char, roomId) {
    const k = roomKey(char?.id, roomId);
    if (inflight.has(k)) return inflight.get(k);
    const p = build(char, roomId).finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }
  return { ensure };
}
