// adventure_written.js — ADVENTURES WRITTEN AHEAD, for a screen with no AI (row 2.235, note FK 1;
// docs proposal_adventure_rails_styles_20261106, gated GO WITH CHANGES).
//
// A written adventure is Story time's page (stories.js: a place, who is there, a sentence or two, `{place}` tokens filled per
// theme) with choices that lead to other pages: a plain graph, `nimrod.adventure.v1`. Argued over ink and Twine in the proposal:
// a plain graph is what a switch walks, what this checker proves, and what the recordings are made from.
//
// TWO THINGS HERE:
//   checkAdventure(raw)        the checker. A story ships only when it passes, AND after a person has read it (the checker
//                              is structure only; tone is stories.js's: warm, adult, "you" is the hero, no peril).
//   createWrittenStory(story)  the same object story_ai.js `createStory` gives Adventure (start, choose, say, choices,
//                              lastSay, started, toJSON, restore), so the panel plays either the same way. Nothing is
//                              ever asked of an AI, and free text has nowhere to go (`say` says so).
//
// THE CHECKER'S RULES, each argued:
//   * every node REACHABLE from `start`, and every node able to REACH AN END: the one rule that catches a loop with no way
//     out and a path that never ends (the gate's point: "reach an end" covers both);
//   * 1 to 4 choices a page (4 is Adventure's own most, story_ai.js maxChoices); one only for a "Next"-style page; an end has
//     none (the panel adds "Another story" and "Back to the start");
//   * labels up to 40 characters (a big button, read aloud with a "?"), text up to stories.js MAX_PAGE_CHARS, a cast as
//     stories.js checkPage (the hero, at most 3), every place and every `{token}` a town.js place;
//   * 2 to 40 pages: the proposal asked chat for 6 to 15, and the checker allows a little either side of that; a story outside
//     it is refused, said.

import { PLACES, HOMES } from './town.js';
import { STORY_ROLES, MAX_CAST, MAX_PAGE_CHARS, pageText as storyPageText } from './stories.js';

/** A page's or a label's words in a theme: stories.js pageText, then a capital at the start of each sentence (a token that
 *  opens one is filled as "the Park"). PURE. */
export function pageText(text, theme = 'nimrod') {
  return storyPageText(text, theme).replace(/(^|[.!?]["”’)]?\s+)(["“‘(]?)the /g, (all, a, q) => `${a}${q}The `);
}

export const ADVENTURE_SCHEMA = 'nimrod.adventure.v1';
export const WRITTEN_FORMAT = 'nimrod-written-story';
export const CHOICES_MAX = 4;
export const LABEL_MAX = 40;
export const NODES_MIN = 2;
export const NODES_MAX = 40;
export const NO_FREE_TEXT_LINE = 'This story is written ahead, so it goes by its choices. Pick one of them.';

const isId = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(s);
// PLACE NAMES, two rules found on chat's first twelve (2026-11-07): a `{token}` is filled with the place's whole name, its
// "The" included (stories.js placeName: "the Workshop"), so "the {jackWorkshop}" reads "the the Workshop"; and a place that a
// theme RENAMES (town.js HOMES: the Workshop is the Smithy in one world, the Potting Shed in another) must be written as its
// token, in a label too, or the words name a place that is not on the screen. A place no theme renames (the park, the bakery)
// may be written in plain words.
const RENAMED = Object.keys(PLACES).filter((id) => Object.values(HOMES || {}).some((h) => h && h[id] && h[id].label && h[id].label !== PLACES[id].label));
const plainName = (id) => String(PLACES[id].label || '').replace(/^The /, '');
function placeProblems(text, at) {
  const out = [];
  if (/\bthe \{\w+\}/i.test(text)) out.push(`${at}: write {place}, not "the {place}" (the name already has its "the")`);
  const bare = text.replace(/\{\w+\}/g, '');
  for (const id of RENAMED) {
    const name = plainName(id);
    if (name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}\\b`, 'i').test(bare)) {
      out.push(`${at}: "${name}" is {${id}} (its name changes with the theme)`);
    }
  }
  return out;
}
const words = (s) => (typeof s === 'string' ? s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim() : '');

/** `{ ok, problems: [..], story }`: the story cleaned when ok, else null. PURE. */
export function checkAdventure(raw) {
  const problems = [];
  const say = (m) => problems.push(m);
  if (!raw || typeof raw !== 'object' || raw.schema !== ADVENTURE_SCHEMA) return { ok: false, problems: [`not a ${ADVENTURE_SCHEMA} story`], story: null };
  if (!isId(raw.id)) say('the story needs an id: letters, digits, - and _');
  const version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : (say('version must be a whole number from 1'), 1);
  const title = words(raw.title).slice(0, 120);
  if (!title) say('the story needs a title');
  const nodesIn = raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes) ? raw.nodes : {};
  const ids = Object.keys(nodesIn);
  if (ids.length < NODES_MIN || ids.length > NODES_MAX) say(`${ids.length} pages; a story has ${NODES_MIN} to ${NODES_MAX}`);
  if (!nodesIn[raw.start]) say(`the start "${raw.start}" is not one of the pages`);
  const nodes = {};
  for (const id of ids) {
    const n = nodesIn[id] || {};
    const at = `page "${id}"`;
    if (!isId(id)) say(`${at}: its name must be letters, digits, - and _`);
    if (!PLACES[n.place]) say(`${at}: "${n.place}" is not a place in town`);
    const text = words(n.text);
    if (!text) say(`${at}: no words`);
    if (text.length > MAX_PAGE_CHARS) say(`${at}: ${text.length} characters; ${MAX_PAGE_CHARS} at most`);
    for (const m of text.matchAll(/\{(\w+)\}/g)) if (!PLACES[m[1]]) say(`${at}: {${m[1]}} is not a place in town`);
    for (const p of placeProblems(text, at)) say(p);
    const cast = Array.isArray(n.cast) ? n.cast : [];
    if (cast.some((r) => !STORY_ROLES.includes(r))) say(`${at}: the cast is from ${STORY_ROLES.join(', ')}`);
    if (new Set(cast).size !== cast.length) say(`${at}: someone is in the cast twice`);
    if (cast.length > MAX_CAST) say(`${at}: ${cast.length} in the cast; ${MAX_CAST} at most`);
    const end = n.end === true;
    const choices = Array.isArray(n.choices) ? n.choices : [];
    if (end && choices.length) say(`${at}: an end has no choices (the screen adds "Another story" and "Back")`);
    if (!end && (choices.length < 1 || choices.length > CHOICES_MAX)) say(`${at}: ${choices.length} choices; 1 to ${CHOICES_MAX}, or "end": true`);
    const cleanChoices = [];
    for (const c of choices) {
      const label = words(c && c.label);
      if (!label) say(`${at}: a choice with no words`);
      else if (label.length > LABEL_MAX) say(`${at}: "${label}" is ${label.length} characters; ${LABEL_MAX} at most`);
      if (!nodesIn[c && c.to]) say(`${at}: "${label || '?'}" leads to "${c && c.to}", which is not a page`);
      for (const m of label.matchAll(/\{(\w+)\}/g)) if (!PLACES[m[1]]) say(`${at}: {${m[1]}} is not a place in town`);
      for (const p of placeProblems(label, `${at}, "${label}"`)) say(p);
      cleanChoices.push({ label, to: c && c.to });
    }
    const seen = new Set(cleanChoices.map((c) => c.label.toLowerCase()));
    if (seen.size !== cleanChoices.length) say(`${at}: two choices say the same thing`);
    const role = ['hero', ...cast.filter((r) => r !== 'hero')].slice(0, MAX_CAST);
    nodes[id] = Object.freeze({ place: n.place, cast: Object.freeze(role), text, end, choices: Object.freeze(cleanChoices.map(Object.freeze)) });
  }
  // Reachable from the start, and able to reach an end.
  if (nodes[raw.start]) {
    const reach = new Set([raw.start]);
    const todo = [raw.start];
    while (todo.length) { for (const c of nodes[todo.pop()]?.choices || []) if (nodes[c.to] && !reach.has(c.to)) { reach.add(c.to); todo.push(c.to); } }
    for (const id of ids) if (!reach.has(id)) say(`page "${id}": nothing leads to it`);
    const ends = new Set(ids.filter((id) => nodes[id].end));
    if (!ends.size) say('no page is an end');
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of ids) if (!ends.has(id) && nodes[id].choices.some((c) => ends.has(c.to))) { ends.add(id); grew = true; }
    }
    for (const id of ids) if (!ends.has(id)) say(`page "${id}": no way from it to an end (a loop with no way out)`);
  }
  if (problems.length) return { ok: false, problems, story: null };
  return { ok: true, problems, story: Object.freeze({ id: raw.id, version, title, start: raw.start, nodes: Object.freeze(nodes) }) };
}

/** Every line a written story says in a theme, for its recordings: each page, each label, and each label as the light says it. PURE. */
export function writtenLines(story, theme = 'nimrod') {
  const out = new Set();
  for (const n of Object.values(story?.nodes || {})) {
    out.add(pageText(n.text, theme));
    for (const c of n.choices) { const l = pageText(c.label, theme); out.add(l); out.add(`${l}?`); }
  }
  return [...out];
}

/**
 * A written story as Adventure's story object (story_ai.js createStory's shape). `theme` names the places. Every answer is
 * at once: `{ ok: true, say, choices, page, end? }`.
 */
export function createWrittenStory(story, { theme = 'nimrod' } = {}) {
  let at = null;
  let started = false;
  let count = 0;
  const node = () => (at ? story.nodes[at] : null);
  const answer = (extra = {}) => {
    const n = node();
    return Promise.resolve({ ok: true, written: true, say: pageText(n.text, theme), choices: n.choices.map((c) => pageText(c.label, theme)),
      page: { place: n.place, cast: [...n.cast] }, ...(n.end ? { end: true } : {}), ...extra });
  };
  return {
    kind: 'adventure', written: true, id: story.id, title: story.title,
    start() { at = story.start; started = true; count = 1; return answer(); },
    choose(i) {
      const c = node()?.choices?.[Number(i)];
      if (!c) return Promise.resolve({ ok: false, fallback: true, reason: 'No such choice.', say: this.lastSay(), choices: this.choices() });
      at = c.to; count += 1;
      return answer();
    },
    /** Free text has nowhere to go in a written story: said, and the choices stay. */
    say() { return Promise.resolve({ ok: true, written: true, say: NO_FREE_TEXT_LINE, choices: this.choices(), note: true }); },
    choices: () => (node() ? node().choices.map((c) => pageText(c.label, theme)) : []),
    lastSay: () => (node() ? pageText(node().text, theme) : ''),
    started: () => started,
    ended: () => !!node()?.end,
    turns: () => count,
    toJSON: () => ({ format: WRITTEN_FORMAT, id: story.id, version: story.version, node: at, turns: count }),
    /** Back to a saved place: the same story and version, and a page it still has; else from the start, and said. */
    restore(saved) {
      if (saved && saved.format === WRITTEN_FORMAT && saved.id === story.id && saved.version === story.version && story.nodes[saved.node]) {
        at = saved.node; started = true; count = Number(saved.turns) || 1;
        return { ok: true };
      }
      at = story.start; started = true; count = 1;
      return { ok: false, reason: 'The story has changed since it was saved, so it starts again.' };
    },
  };
}
