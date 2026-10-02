// whats_new_data.js — WHAT'S NEW, AS A DATED CHANGELOG (the patch notes the "What's new" module reads).
//
// Mike, 2026-10-02: *"What's new could be like a patch notes module."* Plain words, newest first, and for
// each thing WHERE it is found — a patch note that does not say where the new thing lives is a note the
// reader cannot act on.
//
// *** HOW TO ADD TO IT. *** One entry per day that changed something a person would notice, newest at the
// TOP of the list. Each item: `text` (what changed, for somebody who does not read code: no file names, no
// row numbers, never a person's name or "her screen") and `where` (how to get to it). Seeded 2026-10-02
// from `git log` of the days before; the suite (dev/whats_new_test.html) checks every entry's shape, so a
// malformed one fails a check rather than a page.

export const WHATS_NEW = Object.freeze([
  Object.freeze({ date: '2026-10-02', items: Object.freeze([
    { text: 'Nimrod is a module now: a guide who shows you around as choices you can walk back through, with a map of where you are.',
      where: 'On the dashboard you land on, bottom left. Add him to any dashboard from Add.' },
    { text: 'Point at anything and Nimrod says what it does, in his box or in a line along the bottom of the page.',
      where: 'Everywhere. Turn it off in Nimrod’s settings, or on Home in the ⚙ menu, This page.' },
    { text: 'A new starting Home: your pictures, the settings, your devices and Nimrod, four up.',
      where: 'Home, first of the examples.' },
    { text: 'A tutorial dashboard you can always go to, with Nimrod and the settings kept in its bottom two places.',
      where: 'Say “tutorial”, choose it from your dashboards, or Nimrod’s tutorial in the ⚙ menu on Home.' },
    { text: 'A page listing every voice command the screen knows, made from the same lists the screen listens with.',
      where: 'The voice commands page, from the Devices panel.' },
    { text: 'A room drawn in 3D, with your photos and a clock on its walls, and a camera drift you can turn on.',
      where: 'Home, the last of the examples; the edit bar’s Scene.' },
    { text: 'The settings menu has tabs: the panel you picked, Sound, Display, Devices and People.',
      where: 'The ⚙ on the bar. Say “next tab” to move between them.' },
    { text: 'Switch module: put another module in exactly the place of the one you picked, in one press.',
      where: 'The bar’s Switch module, or the edit bar’s Change.' },
    { text: 'Your Home is a dashboard you make your own, started from an example and changed with the edit bar.',
      where: 'Home. ⚙ Edit opens the edit bar: Scene, Add, Change, Undo.' },
    { text: 'One picture picker everywhere: your recent pictures, one from this device, or a folder’s thumbnails.',
      where: 'Any setting that takes a picture.' },
    { text: 'Games no longer ask “Would you like another one?” after each question. Stop answering, or ask the screen to stop.',
      where: 'Every quiz and word game.' },
    { text: 'A map of your dashboards: which door or frame opens which.',
      where: 'The ⚙ menu, This screen tab.' },
  ]) }),
  Object.freeze({ date: '2026-10-01', items: Object.freeze([
    { text: 'Dashboards inside dashboards: a door, a picture frame or a button can open another dashboard, with Back and Home always there.',
      where: 'The edit windows’ “Opens” and “Shows”.' },
    { text: 'Three ready-made dashboards — a room, a plain one and a moving one — one press away.',
      where: 'The bar’s Home button.' },
    { text: 'Word builder and brain games, each player at their own level.',
      where: 'Add, under Something to do.' },
    { text: 'Thinking games from a speech therapist’s exercises, and Math gets a Beginner level.',
      where: 'Add, under Something to do.' },
    { text: 'Hiding a panel can mute or pause it, asked once.',
      where: 'Each panel’s settings.' },
    { text: 'Subtitles roll up like a message thread, with an eye-chart style.',
      where: 'The subtitles’ own settings, when subtitles are on.' },
    { text: 'A visitor can leave the note from their own account, once the owner says they may.',
      where: 'The note’s settings.' },
  ]) }),
  Object.freeze({ date: '2026-09-30', items: Object.freeze([
    { text: 'Rooms drawn by Claude Design: furniture that holds the controls, a window with the weather, a bookshelf of modules.',
      where: 'Home’s examples, and Add: Room.' },
    { text: 'Klondike solitaire, brick-breaker and a rhythm game, each playable with one switch.',
      where: 'Add, under Something to do.' },
    { text: 'Music by name: say a favourite, or press it.',
      where: 'Add: Music.' },
    { text: 'The weather: now, the next hours and the next days. Nothing is sent until you set a place.',
      where: 'Add: Weather.' },
    { text: 'An avatar maker: a drawn face made a part at a time, or a picture instead.',
      where: 'Add: Avatar maker.' },
    { text: 'Nimrod as help: press him and he explains whatever is picked.',
      where: 'The cat on the bar, or in a room.' },
    { text: 'A phone can be the microphone in the room.',
      where: 'The Devices panel: Phones.' },
  ]) }),
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Every entry, newest first (whatever order the file is in). */
export function newestFirst(entries = WHATS_NEW) {
  return [...(Array.isArray(entries) ? entries : [])].filter((e) => e && DATE_RE.test(e.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The entries within `days` days of the newest one (0 = all of them). */
export function recentEntries(days = 0, entries = WHATS_NEW) {
  const all = newestFirst(entries);
  if (!(days > 0) || !all.length) return all;
  const newest = Date.parse(`${all[0].date}T00:00:00Z`);
  return all.filter((e) => newest - Date.parse(`${e.date}T00:00:00Z`) < days * 86400000);
}

/** What is wrong with the changelog, as sentences (empty = valid). */
export function whatsNewProblems(entries = WHATS_NEW) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !DATE_RE.test(e.date) || Number.isNaN(Date.parse(`${e.date}T00:00:00Z`))) { out.push(`a bad date: ${e?.date}`); continue; }
    if (seen.has(e.date)) out.push(`${e.date} twice: one entry per day`);
    seen.add(e.date);
    if (!Array.isArray(e.items) || !e.items.length) out.push(`${e.date}: nothing in it`);
    for (const it of e.items || []) {
      if (!it || typeof it.text !== 'string' || !it.text.trim()) out.push(`${e.date}: an item with no text`);
      if (!it || typeof it.where !== 'string' || !it.where.trim()) out.push(`${e.date}: “${it?.text}” does not say where it is`);
      if (/\bher screen|christine|cici/i.test(`${it?.text} ${it?.where}`)) out.push(`${e.date}: site copy names a person or says "her screen"`);
      if (/\b(row \d|[a-z_]+\.js|commit)\b/i.test(`${it?.text} ${it?.where}`)) out.push(`${e.date}: “${it?.text}” uses engineering words`);
    }
  }
  if (newestFirst(entries).map((e) => e.date).join() !== (entries || []).map((e) => e && e.date).join()) out.push('the file is not newest first');
  return out;
}
