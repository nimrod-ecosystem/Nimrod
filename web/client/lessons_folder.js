// lessons_folder.js - A PERSON'S OWN LESSON FILES, from the "Lessons" folder in their Nimrod folder (row 2.111).
//
// Chat's note CJ (2026-10-21): "Where lessons live: a Lessons folder in the Nimrod folder tree seems natural (row 2.49),
// but the files could be bundled with the site for now; your call, say which." THE CALL: BOTH, each for its own kind.
//   BUNDLED (lessons_builtin.js): the lessons that come with Nimrod - every device has them with no setup, and they
//     change only when the site does. Right to repair and Numbers 0 to 9 are these. Chat's batches (row 2.112) that are
//     for anybody land here too.
//   THE FOLDER (this file): a person's own. Argued for it, against bundling everything: a lesson somebody writes about
//     their own family, their own town or their own job must never have to go into a public repository to be played;
//     and a new lesson should not wait for a deploy. Argued for it, against the account's "made" row (lessons.js
//     MADE_LESSONS_KEY, which the maker writes): a file can be any size an AI writes, is kept where the person keeps
//     their files, and is never on our server.
//
// READ, NEVER PROMPTS: the folder is found the way every kind's is (user_folders.js kindFolder); with no Nimrod folder
// on this device, or its permission lapsed after a restart, there are simply no folder lessons until somebody allows it
// again on the folders page. Nothing is written to the folder, and nothing read here is sent anywhere.
//
// THEIR QUESTIONS DO NOT GO TO THE GAMES (yet), argued: the games' question rows are the account's, shared by every
// device; a device with the folder would write them with these questions and a device without it would write them
// without, and the two would undo each other every time either opened. Routing them waits for per-device rows. A
// built-in's or a made lesson's questions still go, as before.
import { kindFolder, listFiles, handleStore } from './user_folders.js';
import { checkLesson } from './lesson_file.js';

export const LESSON_KIND = 'lessons';
export const FILE_ID_PREFIX = 'file:';
// The largest lesson file read. The Sonnet batch's Right to repair is 67 KB as written; 2 MB is thirty of those, and
// still small enough that a wrong file dropped in (a video renamed .json) is refused at once rather than read.
export const LESSON_FILE_MAX = 2 * 1024 * 1024;

export const fileLessonId = (name) => `${FILE_ID_PREFIX}${name}`;
export const isFileLessonId = (id) => String(id || '').startsWith(FILE_ID_PREFIX);

/**
 * The lesson files on this device: `{ lessons: [{ id, label, lesson, file, sourcesChecked, problems }], skipped:
 * [{ file, why }], where }`. A file that cannot be read as a lesson at all is skipped, with why; one that can is kept
 * with what its check said (its guesses among them). Never prompts, never throws.
 */
export async function readLessonFolder({ store = handleStore(), find = kindFolder, max = LESSON_FILE_MAX } = {}) {
  const out = { lessons: [], skipped: [], where: '' };
  let k = null;
  try { k = await find(LESSON_KIND, { store }); } catch { return out; }
  out.where = k?.name || '';
  if (!k?.dir) return out;
  let files = [];
  try { files = await listFiles(k.dir, ['json']); } catch { return out; }
  for (const f of files) {
    try {
      const file = await f.handle.getFile();
      if (file.size > max) { out.skipped.push({ file: f.name, why: 'it is too big to be a lesson file' }); continue; }
      let raw;
      try { raw = JSON.parse(await file.text()); } catch { out.skipped.push({ file: f.name, why: 'it is not JSON' }); continue; }
      const r = checkLesson(raw);
      if (!r.lesson) { out.skipped.push({ file: f.name, why: r.problems[0] || 'it is not a lesson' }); continue; }
      out.lessons.push({ id: fileLessonId(f.name), label: r.lesson.about.title || f.name.replace(/\.json$/i, ''), lesson: raw,
        file: f.name, sourcesChecked: raw && raw.sourcesChecked === true, problems: r.problems });
    } catch { out.skipped.push({ file: f.name, why: 'it could not be read' }); }
  }
  return out;
}
