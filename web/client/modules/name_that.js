// name_that.js — NAME THAT STATE, ANIMAL OR PERSON (row 2.45).
//
// Mike, 2026-09-30: *"Name that state, animal, person. Person could actually be really good. Get
// everyone to record video messages for it where they say how they know her etc. Maybe even do
// multiple clips or audio with a picture."*
//
// One module with a `game` setting, the way word games holds opposites, rhyming and yes/no: the
// three are the same kind of question ("which one is it?"), answered the same way — one name
// offered at a time on a switch, or said aloud — on the shared engine (`quiz_flow.js`).
//
//   STATE   a text clue: its nickname ("the Sunshine State"), hints its region then its capital.
//           No map is downloaded and none is drawn here: fifty outlines are Design's work, and a
//           wrong-looking outline is worse than a good sentence. On Mike's list.
//   ANIMAL  a spoken question ("Which animal says moo?"), hint a fact, then the first letter. The
//           board's drawings have no animals yet, so there are no pictures — on Mike's list too.
//   PERSON  built from the family's OWN recorded messages. A clip plays — a person saying how they
//           know the one watching — and then: "Who is this?" Chat's note (c) on row 2.45: the
//           recording IS the hint and the answer, so this is the messages module with a question
//           on top, and it reads its clips the way `personal.js` does (a media source, the
//           person's own machine, nothing uploaded).
//
// *** PERSON'S MISS FLOW IS GENTLE BY DEFAULT, AND A SETTING. *** Missing a loved one's name can
// hit harder than missing an opposite. Chat asked Mike; until he answers, the best guess is the
// default: a miss says "That was Annie's message. Let's listen again?" — never "incorrect" — and
// Mike's standard flow is one setting away (`personMiss`). The other two games use Mike's flow.
//
// *** NOTHING TALKS OVER THE PERSON ON SCREEN. *** While a clip plays the question is held back
// (and the recogniser is not listening — it would hear the clip), and said when the clip ends.
// A clip that will not play, or stops moving, lets the question through rather than stranding it.
//
// WHERE THE MESSAGES COME FROM, and why this shape:
//   * one video per message, NAMED FOR THE PERSON: "Annie - how we met.mp4", "Annie 2.mp4";
//   * or, on a media agent, one folder per person: "Annie/…", "Uncle Bob/…".
// File names work on every kind of source. Folders-per-person are read only from a media AGENT:
// listing a browser-connected FOLDER's sub-folders means building a listing that releases the
// previous one's files, which would blank a photo or a message already on screen from the same
// folder (see `folder_source.js` on `listFolderNames`). On Mike's list.
// Needs at least two people: a choice of one is not a question. Said plainly when it is not met.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import {
  createMediaSourcesClient, resolveListing, listItemNames, resolveItemUrl,
} from '../media_sources.js';
import { flowSettings, fill, esc, normalize, shuffle } from '../quiz_flow.js';
import { quizModule, up } from '../quiz_view.js';

export const GAME = 'name_that';
export const GAMES = ['animal', 'state', 'person'];

export const LINES = Object.freeze({
  offerLine: 'Is it {candidate}?',
  hintFirst: 'it starts with {letter}',
  askState: 'Which state is known as {nickname}?',
  hintRegion: 'it is in {region}',
  hintCapital: 'its capital is {capital}',
  explainState: '{state} is {nickname}. Its capital is {capital}.',
  askPerson: 'Who is this?',
  explainPerson: 'That was {name}.',
  gentleLine: "That was {name}'s message. Let's listen again?",
});
const LINE_LABELS = {
  offerLine: 'Offering one answer', hintFirst: 'Hint: the first letter', askState: 'State: the question',
  hintRegion: 'State: first hint', hintCapital: 'State: second hint', explainState: 'State: the answer',
  askPerson: 'Person: the question', explainPerson: 'Person: the answer',
  gentleLine: 'Person: a miss, the gentle way',
};

export const DEFAULTS = Object.freeze({
  // Animal first: it works the moment it is added, with nothing to set up.
  game: 'animal',
  personMiss: 'gentle',
  sourceId: '',
  album: '',
  ...LINES,
});

const SETTINGS = [
  { key: 'game', label: 'Which game', kind: 'choice', default: 'animal', level: 'essential',
    options: [{ value: 'animal', label: 'Name that animal' }, { value: 'state', label: 'Name that state' },
              { value: 'person', label: 'Name that person' }] },
  ownScoreField({ level: 'essential', note: 'How many are right. A Scoreboard on the same screen can show it instead.' }),
  { key: 'personMiss', label: 'Name that person: when a name is missed', kind: 'choice', default: 'gentle',
    level: 'standard',
    options: [{ value: 'gentle', label: 'Say whose message it was, and offer to listen again' },
              { value: 'standard', label: 'The usual: "That is incorrect", a hint, and again' }],
    note: 'Missing somebody’s name can feel worse than missing a word, so the default is gentle.' },
  { key: 'sourceId', label: 'Name that person: messages from', kind: 'choice', default: '', level: 'standard',
    emptyLabel: 'No source connected' },
  { key: 'album', label: 'Name that person: folder', kind: 'text', default: '', level: 'standard',
    placeholder: 'The top folder',
    note: 'Name each video after the person in it ("Annie - how we met.mp4"), or on a media agent, give each person a folder.' },
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

// ---------------------------------------------------------------------------------------
// THE STATES — nickname, capital, Census region. Text only (see the header).
// ---------------------------------------------------------------------------------------
const NE = 'the Northeast'; const MW = 'the Midwest'; const SO = 'the South'; const WE = 'the West';
const STATE_ROWS = [
  ['Alabama', 'Montgomery', 'the Yellowhammer State', SO], ['Alaska', 'Juneau', 'the Last Frontier', WE],
  ['Arizona', 'Phoenix', 'the Grand Canyon State', WE], ['Arkansas', 'Little Rock', 'the Natural State', SO],
  ['California', 'Sacramento', 'the Golden State', WE], ['Colorado', 'Denver', 'the Centennial State', WE],
  ['Connecticut', 'Hartford', 'the Constitution State', NE], ['Delaware', 'Dover', 'the First State', SO],
  ['Florida', 'Tallahassee', 'the Sunshine State', SO], ['Georgia', 'Atlanta', 'the Peach State', SO],
  ['Hawaii', 'Honolulu', 'the Aloha State', WE], ['Idaho', 'Boise', 'the Gem State', WE],
  ['Illinois', 'Springfield', 'the Prairie State', MW], ['Indiana', 'Indianapolis', 'the Hoosier State', MW],
  ['Iowa', 'Des Moines', 'the Hawkeye State', MW], ['Kansas', 'Topeka', 'the Sunflower State', MW],
  ['Kentucky', 'Frankfort', 'the Bluegrass State', SO], ['Louisiana', 'Baton Rouge', 'the Pelican State', SO],
  ['Maine', 'Augusta', 'the Pine Tree State', NE], ['Maryland', 'Annapolis', 'the Old Line State', SO],
  ['Massachusetts', 'Boston', 'the Bay State', NE], ['Michigan', 'Lansing', 'the Great Lakes State', MW],
  ['Minnesota', 'Saint Paul', 'the North Star State', MW], ['Mississippi', 'Jackson', 'the Magnolia State', SO],
  ['Missouri', 'Jefferson City', 'the Show-Me State', MW], ['Montana', 'Helena', 'the Treasure State', WE],
  ['Nebraska', 'Lincoln', 'the Cornhusker State', MW], ['Nevada', 'Carson City', 'the Silver State', WE],
  ['New Hampshire', 'Concord', 'the Granite State', NE], ['New Jersey', 'Trenton', 'the Garden State', NE],
  ['New Mexico', 'Santa Fe', 'the Land of Enchantment', WE], ['New York', 'Albany', 'the Empire State', NE],
  ['North Carolina', 'Raleigh', 'the Tar Heel State', SO], ['North Dakota', 'Bismarck', 'the Peace Garden State', MW],
  ['Ohio', 'Columbus', 'the Buckeye State', MW], ['Oklahoma', 'Oklahoma City', 'the Sooner State', SO],
  ['Oregon', 'Salem', 'the Beaver State', WE], ['Pennsylvania', 'Harrisburg', 'the Keystone State', NE],
  ['Rhode Island', 'Providence', 'the Ocean State', NE], ['South Carolina', 'Columbia', 'the Palmetto State', SO],
  ['South Dakota', 'Pierre', 'the Mount Rushmore State', MW], ['Tennessee', 'Nashville', 'the Volunteer State', SO],
  ['Texas', 'Austin', 'the Lone Star State', SO], ['Utah', 'Salt Lake City', 'the Beehive State', WE],
  ['Vermont', 'Montpelier', 'the Green Mountain State', NE], ['Virginia', 'Richmond', 'the Old Dominion', SO],
  ['Washington', 'Olympia', 'the Evergreen State', WE], ['West Virginia', 'Charleston', 'the Mountain State', SO],
  ['Wisconsin', 'Madison', 'the Badger State', MW], ['Wyoming', 'Cheyenne', 'the Equality State', WE],
];
// A capital that contains its state's name (Oklahoma City, Indianapolis) would BE the answer, so
// that state's second hint is its first letter instead.
const capitalHint = (state, capital, c) => (capital.toLowerCase().includes(state.toLowerCase())
  ? fill(c.hintFirst, { letter: state[0] }) : fill(c.hintCapital, { capital }));
export const STATES = Object.freeze(STATE_ROWS.map(([answer, capital, nickname, region]) => Object.freeze({
  answer, capital, nickname, region,
  hints: Object.freeze([fill(LINES.hintRegion, { region }), capitalHint(answer, capital, LINES)]),
})));

// ---------------------------------------------------------------------------------------
// THE ANIMALS — a question, a fact for the hint, and the sentence the answer is said in.
// ---------------------------------------------------------------------------------------
export const ANIMALS = Object.freeze([
  { answer: 'cow', a: 'a cow', ask: 'Which animal says moo?', hint: 'it gives us milk', explain: 'A cow says moo.' },
  { answer: 'dog', a: 'a dog', ask: 'Which animal says woof?', hint: 'it wags its tail', explain: 'A dog says woof.' },
  { answer: 'cat', a: 'a cat', ask: 'Which animal says meow?', hint: 'it purrs when it is happy', explain: 'A cat says meow.' },
  { answer: 'duck', a: 'a duck', ask: 'Which animal says quack?', hint: 'it swims on ponds', explain: 'A duck says quack.' },
  { answer: 'pig', a: 'a pig', ask: 'Which animal says oink?', hint: 'it rolls in the mud', explain: 'A pig says oink.' },
  { answer: 'sheep', a: 'a sheep', ask: 'Which animal says baa?', hint: 'its wool keeps us warm', explain: 'A sheep says baa.' },
  { answer: 'horse', a: 'a horse', ask: 'Which animal says neigh?', hint: 'people ride it', explain: 'A horse says neigh.' },
  { answer: 'rooster', a: 'a rooster', ask: 'Which animal says cock-a-doodle-doo?', hint: 'it wakes the farm up in the morning', explain: 'A rooster says cock-a-doodle-doo.' },
  { answer: 'owl', a: 'an owl', ask: 'Which animal says hoot?', hint: 'it is awake all night', explain: 'An owl says hoot.' },
  { answer: 'lion', a: 'a lion', ask: 'Which animal roars?', hint: 'it has a big mane', explain: 'A lion roars.' },
  { answer: 'frog', a: 'a frog', ask: 'Which animal says ribbit?', hint: 'it hops and lives near water', explain: 'A frog says ribbit.' },
  { answer: 'bee', a: 'a bee', ask: 'Which animal buzzes?', hint: 'it makes honey', explain: 'A bee buzzes.' },
  { answer: 'snake', a: 'a snake', ask: 'Which animal hisses?', hint: 'it has no legs', explain: 'A snake hisses.' },
  { answer: 'donkey', a: 'a donkey', ask: 'Which animal says hee-haw?', hint: 'it has long ears', explain: 'A donkey says hee-haw.' },
  { answer: 'mouse', a: 'a mouse', ask: 'Which animal squeaks?', hint: 'it is small and likes cheese', explain: 'A mouse squeaks.' },
  { answer: 'elephant', a: 'an elephant', ask: 'Which animal has a long trunk?', hint: 'it is the biggest animal on land', explain: 'An elephant has a long trunk.' },
  { answer: 'giraffe', a: 'a giraffe', ask: 'Which animal has a very long neck?', hint: 'it eats leaves from the tops of trees', explain: 'A giraffe has a very long neck.' },
  { answer: 'zebra', a: 'a zebra', ask: 'Which animal has black and white stripes?', hint: 'it looks like a horse', explain: 'A zebra has black and white stripes.' },
  { answer: 'kangaroo', a: 'a kangaroo', ask: 'Which animal hops and carries its baby in a pouch?', hint: 'it lives in Australia', explain: 'A kangaroo carries its baby in a pouch.' },
  { answer: 'turtle', a: 'a turtle', ask: 'Which animal carries its home on its back?', hint: 'it is very slow', explain: 'A turtle carries its shell on its back.' },
  { answer: 'penguin', a: 'a penguin', ask: 'Which bird cannot fly but swims very well?', hint: 'it lives where it is very cold', explain: 'A penguin swims but cannot fly.' },
  { answer: 'monkey', a: 'a monkey', ask: 'Which animal swings from trees and loves bananas?', hint: 'it has a long tail', explain: 'A monkey swings from trees.' },
].map((a) => Object.freeze(a)));
const ANIMAL_A = Object.fromEntries(ANIMALS.map((a) => [a.answer, a.a]));

// ---------------------------------------------------------------------------------------
// NAMES — matching what was heard to one of them
// ---------------------------------------------------------------------------------------

/** "Annie - how we met.mp4" -> "Annie"; "Uncle Bob 2.mp4" -> "Uncle Bob"; "carol_smith.webm" -> "carol smith". */
export function personFromFileName(name) {
  const base = String(name || '').split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const dash = base.split(/\s+-\s+/)[0];
  return dash.replace(/[\s-]*\d+$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * The one name in `names` that `text` means, or null. The whole name said anywhere in the sentence
 * wins (longest first, so "New York" beats "York"); otherwise a PART of exactly one name ("Annie"
 * for "Aunt Annie") — a part that fits two people means nobody in particular.
 */
export function matchName(text, names) {
  const t = ` ${normalize(text)} `;
  if (!t.trim()) return null;
  const byLen = [...names].sort((a, b) => normalize(b).length - normalize(a).length);
  const whole = byLen.find((n) => normalize(n) && t.includes(` ${normalize(n)} `));
  if (whole) return whole;
  const part = names.filter((n) => ` ${normalize(n)} `.includes(t));
  return part.length === 1 ? part[0] : null;
}

function pickOthers(answer, pool, rand, n = 2) {
  return shuffle(pool.filter((x) => normalize(x) !== normalize(answer)), rand).slice(0, n);
}

function nameGame({ items, names, ask, hint, explain, offerName = (x) => x }) {
  return {
    items,
    ask,
    candidates: (it, c, rand) => shuffle([it.answer, ...pickOthers(it.answer, names(), rand)], rand),
    offer: (it, cand, c) => fill(c.offerLine, { candidate: offerName(cand) }),
    judge(it, v) {
      const s = normalize(v);
      if (!s) return null;
      if (s === normalize(it.answer)) return true;
      const m = matchName(v, names());
      return m ? normalize(m) === normalize(it.answer) : false;
    },
    hint,
    answer: (it) => it.answer,
    explain,
    vocab: () => names().map((n) => normalize(n)),
    fromVoice: (it, { text }) => (text ? { value: matchName(text, names()) || text } : null),
  };
}

const firstLetter = (it, c) => fill(c.hintFirst, { letter: up(it.answer[0]) });

const animal = nameGame({
  items: () => ANIMALS,
  names: () => ANIMALS.map((a) => a.answer),
  ask: (it) => it.ask,
  hint: (it, n, c) => (n === 1 ? it.hint : n === 2 ? firstLetter(it, c) : ''),
  explain: (it) => it.explain,
  offerName: (x) => ANIMAL_A[x] || x,
});

const state = nameGame({
  items: () => STATES,
  names: () => STATES.map((s) => s.answer),
  ask: (it, c) => fill(c.askState, { nickname: it.nickname }),
  hint: (it, n, c) => (n === 1 ? fill(c.hintRegion, { region: it.region })
    : n === 2 ? capitalHint(it.answer, it.capital, c) : ''),
  explain: (it, answer, c) => fill(c.explainState, { state: it.answer, nickname: it.nickname, capital: it.capital }),
});

// ---------------------------------------------------------------------------------------
// THE MODULE — the person game's messages are loaded per instance, so the view is built per
// mount; the animal and state games are shared data.
// ---------------------------------------------------------------------------------------

// What the screen says when person has nothing to ask. For whoever sets the screen up — shown,
// never spoken to the room.
const NO_SOURCE = 'Name that person plays recorded messages from a media source, and none is connected yet. '
  + 'Connect one in Media / Sources.';
const MANY_SOURCES = 'Choose which media source holds the messages, in this game’s settings.';
const TOO_FEW = 'Name that person needs recorded messages from at least two people. Name each video after '
  + 'the person in it ("Annie - how we met.mp4"), or on a media agent, give each person a folder.';
const UNREADABLE = 'Could not read the messages from that media source. It may be switched off or disconnected.';

// A clip that has not moved for this long is treated as finished, so the question is never
// stranded behind a frozen frame. The same number `personal.js` uses, for the same reason.
const STALL_MS = 20000;

function defaultPlayClip(host, clip, h) {
  const doc = host.ownerDocument || document;
  host.innerHTML = '';
  const tag = clip.kind === 'audio' ? 'audio' : 'video';
  if (tag === 'audio') {
    if (clip.pictureUrl) {
      const img = doc.createElement('img');
      img.src = clip.pictureUrl;
      img.alt = '';
      host.append(img);
    } else {
      const s = doc.createElement('span');
      s.className = 'qz-sound';
      s.textContent = '♪';
      host.append(s);
    }
  }
  const el = doc.createElement(tag);
  el.src = clip.url;
  el.controls = false;
  el.playsInline = true;
  el.autoplay = true;
  el.preload = 'auto';
  if (tag === 'audio') el.hidden = true;
  let done = false;
  const finish = (fn) => () => { if (done) return; done = true; fn?.(); };
  el.addEventListener('ended', finish(h.onEnded));
  el.addEventListener('error', finish(() => h.onError?.(new Error('clip error'))));
  el.addEventListener('timeupdate', () => h.onProgress?.());
  host.append(el);
  // A blocked autoplay: try again muted, and say so — the same rung `personal.js` uses. A message
  // with no voice is a loss; a frozen first frame is a worse one.
  el.play?.().catch((err) => {
    const blocked = err && (err.name === 'NotAllowedError' || /gesture|user activation/i.test(String(err.message || '')));
    if (!blocked || done) return;
    el.muted = true;
    h.onMuted?.();
    el.play?.().catch(() => finish(() => h.onError?.(err))());
  });
  return {
    stop() {
      done = true;
      try { el.pause(); } catch { /* gone */ }
      el.removeAttribute('src');
      try { el.load?.(); } catch { /* gone */ }
      host.innerHTML = '';
    },
  };
}

function playable(files) {
  const media = files.filter((f) => f && (f.kind === 'video' || f.kind === 'audio'));
  const images = files.filter((f) => f && f.kind === 'image');
  const base = (p) => String(p || '').replace(/\.[^.]+$/, '').toLowerCase();
  return media.map((f) => ({
    path: f.path, kind: f.kind, name: f.name || String(f.path || '').split('/').pop(),
    picturePath: f.kind === 'audio' ? (images.find((i) => base(i.path) === base(f.path))?.path || null) : null,
  }));
}

function factory(ctx) {
  let people = null;          // null: not loaded; [] and up: loaded
  let emptyText = '';
  let knownSources = [];
  let source = null;
  let loadSeq = 0;
  let loadedRef = null;
  let clip = null;            // the clip chosen for the current question
  let player = null;
  let playing = false;
  let muted = false;
  let stallTimer = null;
  let urls = [];
  let mediaHost = null;
  let leftHtml = null;
  let apiRef = null;
  let dead = false;

  const client = () => ctx.sources || createMediaSourcesClient({ user: ctx.user, cache: true, personId: ctx.personId || null });
  const listNames = ctx.listItemNames || listItemNames;
  const listAlbums = ctx.resolveListing || resolveListing;
  const itemUrl = ctx.resolveItemUrl || resolveItemUrl;
  const playClip = ctx.playClip || defaultPlayClip;

  async function discover(src, album) {
    const byKey = new Map();
    const add = (name, clips) => {
      const key = normalize(name);
      if (!key || !clips.length) return;
      if (!byKey.has(key)) byKey.set(key, { name: String(name).trim(), clips: [] });
      byKey.get(key).clips.push(...clips);
    };
    const flat = await listNames(src, album);
    for (const c of playable(flat)) add(personFromFileName(c.name), [c]);
    let albums = [];
    if (src.kind !== 'folder') {
      try { albums = (await listAlbums(src, album)).albums || []; } catch { albums = []; }
    }
    for (const a of albums) {
      const sub = await listNames(src, album ? `${album}/${a}` : a);
      add(String(a).split('/').pop(), playable(sub));
    }
    return [...byKey.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  async function loadPeople(cfg, api) {
    const seq = ++loadSeq;
    people = null;
    api.engine.refresh();
    let found = [];
    try {
      const sources = await client().list();
      if (seq !== loadSeq || dead) return;
      knownSources = sources || [];
      source = cfg.sourceId ? knownSources.find((s) => s.id === cfg.sourceId) || null
        : (knownSources.length === 1 ? knownSources[0] : null);
      if (!source) { emptyText = knownSources.length > 1 ? MANY_SOURCES : NO_SOURCE; people = []; api.engine.refresh(); return; }
      found = await discover(source, cfg.album || '');
    } catch (err) {
      if (seq !== loadSeq || dead) return;
      console.error('name_that: messages', err);
      emptyText = UNREADABLE; people = []; api.engine.refresh(); return;
    }
    if (seq !== loadSeq || dead) return;
    people = found;
    emptyText = found.length < 2 ? TOO_FEW : '';
    api.engine.refresh();
  }

  const personItems = () => {
    if (people == null) return null;
    if (people.length < 2) return [];
    return people.map((p) => Object.freeze({ answer: p.name, clips: p.clips }));
  };
  const personNames = () => (people || []).map((p) => p.name);

  const person = {
    ...nameGame({
      items: personItems,
      names: personNames,
      ask: (it, c) => c.askPerson,
      hint: (it, n, c) => (n === 1 ? firstLetter(it, c) : ''),
      explain: (it, answer, c) => fill(c.explainPerson, { name: it.answer }),
    }),
    empty: () => emptyText,
    canReplay: true,
    missStyle: (c) => (c.personMiss === 'standard' ? 'standard' : 'gentle'),
    gentle: (it, c) => fill(c.gentleLine, { name: it.answer }),
  };

  // ---- the clip ----
  function clearStall() {
    if (stallTimer == null) return;
    const clr = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (id) => clearTimeout(id);
    try { clr(stallTimer); } catch { /* gone */ }
    stallTimer = null;
  }
  // Stopped without finishing (hidden, or another game dealt): whatever was waiting to be said
  // after the clip is dropped, not said later to a panel nobody is looking at.
  function abandonClip() { if (!playing) return; playing = false; stopClip(); apiRef?.dropHeld(); }
  function armStall() {
    clearStall();
    const set = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    stallTimer = set(() => { stallTimer = null; finishClip(); }, STALL_MS);
  }
  function releaseUrls() { for (const u of urls) { try { u.release?.(); } catch { /* gone */ } } urls = []; }
  function stopClip() {
    clearStall();
    try { player?.stop?.(); } catch { /* gone */ }
    player = null;
    releaseUrls();
  }
  function finishClip() {
    if (!playing) return;
    playing = false;
    stopClip();
    apiRef?.release();
  }
  function host() {
    if (!mediaHost) {
      mediaHost = (ctx.mount.ownerDocument || document).createElement('div');
      mediaHost.className = 'qz-media';
      mediaHost.dataset.media = '';
    }
    return mediaHost;
  }
  async function startClip(c) {
    stopClip();
    if (!c || !source) { if (playing) finishClip(); return; }
    playing = true;
    muted = false;
    apiRef?.reannounce();
    apiRef?.render();
    const mine = c;
    try {
      const main = await itemUrl(source, c.path);
      if (main) urls.push(main);
      const pic = c.picturePath ? await itemUrl(source, c.picturePath) : null;
      if (pic) urls.push(pic);
      if (dead || clip !== mine || !playing) { releaseUrls(); return; }
      armStall();
      player = playClip(host(), { ...c, url: main?.url, pictureUrl: pic?.url || null }, {
        onEnded: () => { if (clip === mine) finishClip(); },
        onError: () => { if (clip === mine) finishClip(); },
        onProgress: () => { if (clip === mine && playing) armStall(); },
        onMuted: () => { muted = true; apiRef?.render(); },
      });
    } catch (err) {
      console.error('name_that: clip', err);
      if (clip === mine) finishClip();
    }
  }

  const views = {
    animal: { left: () => '' },
    state: { left: (s) => `<p class="qz-card" data-clue>${esc(s.item.nickname)}</p>` },
  };

  const view = {
    init(api) { apiRef = api; },
    onConfig(cfg, prev, api) {
      if (cfg.game !== 'person') return;
      const ref = `${cfg.sourceId}|${cfg.album}`;
      if (ref === loadedRef) return;
      loadedRef = ref;
      loadPeople(cfg, api);
    },
    onDeal(item, api) {
      if (api.engine.game() !== 'person') { abandonClip(); return; }
      const list = item.clips || [];
      clip = list.length ? list[Math.floor(api.rand() * list.length) % list.length] : null;
      startClip(clip);
    },
    onReplay(item) { if (clip) startClip(clip); },
    speechGate: () => playing,
    leftEl(el, s, cfg) {
      if (s.game === 'person') {
        if (el.dataset.kind !== 'person') { el.innerHTML = ''; el.dataset.kind = 'person'; leftHtml = null; }
        const h = host();
        if (h.parentNode !== el) el.append(h);
        let note = el.querySelector('[data-muted]');
        if (muted && !note) {
          note = (el.ownerDocument || document).createElement('p');
          note.className = 'qz-note';
          note.dataset.muted = '';
          note.textContent = 'Sound is off for this message — this screen blocked it.';
          el.append(note);
        } else if (!muted && note) note.remove();
        const q = s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss';
        return !!s.item && (q || playing);
      }
      if (el.dataset.kind === 'person') { el.innerHTML = ''; delete el.dataset.kind; }
      const q = s.item && (s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss');
      const html = q ? String(views[s.game]?.left(s, cfg) || '') : '';
      if (html !== leftHtml) { el.innerHTML = html; leftHtml = html; }
      return !!html;
    },
    pointNote: (game, item, answer) => (game === 'person' ? 'name that person: right' : `name that ${game}: ${answer}`),
    settingsChoices: () => ({
      sourceId: knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
    }),
    destroy() { dead = true; playing = false; stopClip(); },
    // Hidden: the clip stops (a message nobody is watching is a message missed). Shown again
    // mid-question: it plays again from the start, and the question follows it as before.
    onHide() { abandonClip(); },
    onShow(api) {
      const s = api.engine.snapshot();
      if (s.game === 'person' && s.phase === 'asking' && clip && !playing) {
        api.dropHeld();
        startClip(clip);                // sets `playing` at once, so the question below is held
        api.engine.press('repeat');
      }
    },
  };

  return quizModule({ type: GAME, title: 'Name that', scoreLabel: 'Name that: right answers',
    games: { animal, state, person }, defaults: DEFAULTS, gameKey: 'game', view })(ctx);
}

registerModule(
  { type: GAME, title: 'Name that', core: 'new',
    description: 'Name that animal, state, or person. Person plays the family’s own recorded '
      + 'messages and asks who it is. Answer with a switch, the screen, or aloud.',
    // `local`: the animals and states are built in; the person game's clips come from a media
    // source on the person's own machine, exactly like Personal videos.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  factory,
);
