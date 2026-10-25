// stories.js — STORY TIME'S BUILT-IN STORIES, AS DATA, and the little that turns one into pages.
//
// Claude Design's characters handoff (2026-10-12), "Ideas for games and story time": "a short picture story read
// aloud. The person's own avatar is the hero and the court characters are the cast, in the current theme's outfits.
// One switch turns the page." And the town: "Stories and games get their sets for free: eight named places per
// theme, each with a one-line blurb." The panel is modules/story.js; this file is only the stories.
//
// *** HOW A STORY IS WRITTEN. *** Each page is a place (a town.js place id), who is in it (`hero` and the four court
// characters: 'king', 'queen', 'jack', 'joker'; at most three, so each can be seen) and one or two sentences. A place
// is written as a token, `{bakery}` or `{kingHall}`, because the places are different in every world: the King's home
// is the Great Hall in the Nimrod town and the Ice Hall in winter. `pageText` fills each token with that theme's name
// for the place ("the Ice Hall"). The court characters are Design's four (King Kenny, Queen Rose, Jack, Robin the
// Joker), written by name; they are characters, not people.
//
// *** THE HERO IS "YOU". *** The person's own avatar stands in every picture, and the words say "you", so no story
// ever needs anybody's name: nothing to look up, nothing to get wrong, and site copy names nobody.
//
// *** THE VOICE OF THEM (Mike's brief: "short, warm, adult-appropriate, not childish"). *** Small, ordinary kindnesses
// among neighbours: a recipe found, a clock mended, a letter written, a quiet day kept company, a bridge planned. No
// peril, no villain, no lesson spelled out, nothing babyish ("yay", "uh-oh"), and nothing tied to one season, so every
// story reads right in every theme. Six pages each: about a minute and a half at the default pace.

import { PLACES, placeInfo } from './town.js';

export const STORY_ROLES = Object.freeze(['hero', 'king', 'queen', 'jack', 'joker']);
export const COURT_NAMES = Object.freeze({ king: 'King Kenny', queen: 'Queen Rose', jack: 'Jack', joker: 'Robin' });
export const MAX_CAST = 3;
export const MAX_PAGE_CHARS = 400;

const P = (place, cast, text) => Object.freeze({ place, cast: Object.freeze(cast), text });

export const STORIES = Object.freeze([
  Object.freeze({
    id: 'recipe',
    title: 'The recipe in the library',
    pages: Object.freeze([
      P('bakery', ['hero', 'queen'], 'Early one morning, the smell of warm bread leads you to {bakery}. Queen Rose is there, looking puzzled.'),
      P('bakery', ['hero', 'queen'], '“I want to bake my grandmother’s honey loaf for the whole town,” she says, “but I can’t remember how it goes.”'),
      P('library', ['hero', 'queen'], 'The two of you walk over to {library}. The shelves are tall, and the room is quiet and warm.'),
      P('library', ['hero', 'queen'], 'You take down an old book with a cracked spine. Tucked inside is a card in careful handwriting: the honey loaf.'),
      P('bakery', ['hero', 'queen'], 'Back at {bakery}, you measure the flour while Queen Rose warms the honey. Soon the whole street smells of it.'),
      P('kingHall', ['hero', 'queen', 'king'], 'That evening the loaf is shared in {kingHall}. King Kenny has two slices and asks who found the recipe. Queen Rose smiles at you.'),
    ]),
  }),
  Object.freeze({
    id: 'clock',
    title: 'The clock that stopped',
    pages: Object.freeze([
      P('park', ['hero', 'jack'], 'In {park}, people keep glancing up at the town clock. It has stopped at ten past three.'),
      P('jackWorkshop', ['hero', 'jack'], 'Jack opens the clock on his bench in {jackWorkshop}. “One small gear is missing,” he says. “It can’t have gone far.”'),
      P('shop', ['hero', 'jack'], 'You ask at {shop}. Nobody has bought a gear this week, but somebody saw Robin go by carrying something shiny.'),
      P('jokerCaravan', ['hero', 'jack', 'joker'], 'In {jokerCaravan}, Robin has made a wind chime from buttons, spoons and one small gear. It sounds lovely.'),
      P('jokerCaravan', ['hero', 'joker'], 'Robin laughs and hands the gear over. “I’ll find something else that sings,” Robin says.'),
      P('park', ['hero', 'jack', 'joker'], 'By teatime the clock is going again. Robin’s new chime hangs by the bench, and people stop to listen.'),
    ]),
  }),
  Object.freeze({
    id: 'letter',
    title: 'A letter to an old friend',
    pages: Object.freeze([
      P('kingHall', ['hero', 'king'], 'King Kenny has been writing a letter all morning in {kingHall}. He asks if you would help him finish it.'),
      P('kingHall', ['hero', 'king'], '“It’s for a friend I haven’t seen in years,” he says. “I don’t know how to say that I miss him.”'),
      P('shop', ['hero', 'king'], 'You walk together to {shop} for a stamp. King Kenny chooses one with a little sailing boat on it.'),
      P('park', ['hero', 'king'], 'On the way back you sit for a while in {park}. He tells you how he and his friend used to race paper boats.'),
      P('queenParlour', ['hero', 'king', 'queen'], 'In {queenParlour}, Queen Rose reads the letter and adds a line of her own at the bottom.'),
      P('kingHall', ['hero', 'king'], 'The letter goes in the post that afternoon. King Kenny says it was much easier to write with company.'),
    ]),
  }),
  Object.freeze({
    id: 'quiet',
    title: 'Robin’s quiet day',
    pages: Object.freeze([
      P('jokerCaravan', ['hero', 'joker'], 'Robin is usually the first to make everybody laugh. Today Robin is sitting very still in {jokerCaravan}.'),
      P('jokerCaravan', ['hero', 'joker'], '“I don’t feel like being funny today,” Robin says. You say that is perfectly all right.'),
      P('park', ['hero', 'joker'], 'You walk slowly to {park} and sit on the bench. Neither of you says much, and that is all right too.'),
      P('park', ['hero', 'joker', 'queen'], 'Queen Rose comes by with a flask of tea and sits down with you. She doesn’t ask any questions.'),
      P('bakery', ['hero', 'joker'], 'On the way home you stop at {bakery}. Robin chooses the biggest bun, and very nearly smiles.'),
      P('jokerCaravan', ['hero', 'joker'], '“Thank you for sitting with me,” Robin says at the door. “Tomorrow I might be funny again.”'),
    ]),
  }),
  Object.freeze({
    id: 'bridge',
    title: 'A bridge over the stream',
    pages: Object.freeze([
      P('library', ['hero', 'jack'], 'Rain taps on the windows, so you spend the afternoon in {library}. Jack is already there, reading about bridges.'),
      P('library', ['hero', 'jack'], 'He shows you a drawing of a little bridge he would like to build over the stream in {park}.'),
      P('jackWorkshop', ['hero', 'jack'], 'In {jackWorkshop}, you help him make a model of it from offcuts and string. It holds a whole teacup.'),
      P('kingHall', ['hero', 'jack', 'king'], 'King Kenny studies the model for a long time, then asks whether it could carry the bakery’s cart. Jack says it could.'),
      P('park', ['hero', 'jack'], 'When the rain stops, you walk down to {park} together to look at the stream and choose the spot.'),
      P('park', ['hero', 'jack', 'king'], 'Jack marks the place with a stick. The building starts in the spring, he says, and you are invited.'),
    ]),
  }),
]);
export const STORY_IDS = Object.freeze(STORIES.map((s) => s.id));
export const storyById = (id) => STORIES.find((s) => s.id === id) || null;

/** A place's name in a theme, for the middle of a sentence: "the Ice Hall", "Robin's Caravan". */
export function placeName(id, deck = 'nimrod') {
  if (!PLACES[id]) return '';
  const label = placeInfo(id, deck).label || '';
  return label.replace(/^The /, 'the ');
}

/** A page's words in a theme: every {placeId} filled with that theme's name for it. Unknown tokens are dropped. */
export function pageText(text, deck = 'nimrod') {
  return String(text || '').replace(/\{(\w+)\}/g, (all, id) => (PLACES[id] ? placeName(id, deck) : ''))
    .replace(/\s+/g, ' ').trim();
}

/**
 * A page from anywhere (a built-in story, or the AI storyteller's `nextPage`), checked: a known place, a cast of
 * known roles (the hero first, at most MAX_CAST, no repeats), and plain words no longer than MAX_PAGE_CHARS.
 * Returns null when it is not a usable page.
 */
export function checkPage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const place = typeof raw.place === 'string' && PLACES[raw.place] ? raw.place : null;
  const text = typeof raw.text === 'string' ? raw.text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_CHARS) : '';
  if (!place || !text) return null;
  const cast = ['hero'];
  for (const r of Array.isArray(raw.cast) ? raw.cast : []) {
    if (STORY_ROLES.includes(r) && !cast.includes(r) && cast.length < MAX_CAST) cast.push(r);
  }
  return { place, cast, text, ...(raw.end === true ? { end: true } : {}) };
}

/** Which story comes after `id`, going round the list (or the chosen one again, for 'again'). */
export function nextStoryId(id, { after = 'next', only = 'all' } = {}) {
  if (only !== 'all' && STORY_IDS.includes(only)) return only;
  if (after === 'again' && STORY_IDS.includes(id)) return id;
  const i = STORY_IDS.indexOf(id);
  return STORY_IDS[(i + 1) % STORY_IDS.length];
}
