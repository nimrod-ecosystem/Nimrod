// symbol_packs.js - THE SYMBOLS A PERSON ALREADY USES, from the "Symbols" folder (big idea 1; Mike 2026-11-03, row 2.204:
// "option A, plus a Symbols folder in the Nimrod folder tree"; Code's proposal_symbol_packs_20261102.md).
//
// WHERE A PACK LIVES. The Symbols folder in the person's Nimrod folder is looked in first; "Choose the folder your symbol
// sets are already in" on the folders page points it at ANY folder instead (option A): a Mulberry download, a folder a
// speech therapist sent. Inside it, EACH SUBFOLDER that holds a `nimrod.symbols.v1` file is one pack, and the folder
// itself may be one too (somebody who points straight at a single set). Nothing is copied, uploaded or shipped: a
// share-alike set stays the person's, read where it is on this device.
//
// THE FORMAT AND THE MATCHING ARE DESIGN'S (symbol_pack.js, copied unchanged): `resolveSymbol` tries the pack's own
// override, then the exact file name, the tidied name, the verb form and the numbered variant. A word with no match keeps
// Nimrod's own drawing, so a card is never blank.
//
// THE CHECK (`checkSymbolPack`), the way the other packs are checked: the format name, a name, a licence, the pictures
// folder there, at least one picture of a known type, and every override pointing at a picture that exists. A pack that
// fails is not offered, and says why in words. An override that points nowhere is a problem but not fatal: that word
// simply falls back, as an unmatched word does.
//
// READ, NEVER PROMPTS (lessons_folder.js's rule): with no folder on this device, or its permission lapsed after a
// restart, there are simply no packs until somebody allows it again on the folders page, and a board set to a pack draws
// Nimrod's own drawings meanwhile.
import { kindFolder, listFiles, listFolders, handleStore } from './user_folders.js';
import { resolveSymbol, PACK_DEFAULTS } from './symbol_pack.js';

export const SYMBOLS_KIND = 'symbols';
export const SYMBOLS_FORMAT = 'nimrod.symbols.v1';
export const PICTURE_TYPES = Object.freeze(['svg', 'png', 'webp', 'jpg', 'jpeg']);
export const PACK_ID_PREFIX = 'pack:';
// The largest pack file read. A pack file is a name, a licence and a list of overrides: Mulberry's whole word list as
// overrides would be well under 200 KB. 1 MB refuses a wrong file (a picture renamed .json) at once.
export const PACK_FILE_MAX = 1024 * 1024;
// How many subfolders are looked in for packs. A person pointing the Symbols folder at their whole Pictures folder must
// not make the board walk thousands of folders; 50 sets is far more than anyone keeps.
export const PACK_FOLDERS_MAX = 50;

export const packId = (folder) => `${PACK_ID_PREFIX}${folder}`;
export const isPackId = (id) => String(id || '').startsWith(PACK_ID_PREFIX);

const extOf = (name) => { const m = /\.([a-z0-9]+)$/i.exec(String(name)); return m ? m[1].toLowerCase() : ''; };

/**
 * Check a pack file against the pictures found for it. `raw`: the parsed JSON; `pictures`: the picture file names in its
 * `files` folder. Returns `{ pack, problems }`: `pack` is null when it cannot be offered at all. Pure.
 */
export function checkSymbolPack(raw, pictures = []) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { pack: null, problems: ['it is not a pack file'] };
  if (raw.format !== SYMBOLS_FORMAT) return { pack: null, problems: [`its "format" is not ${SYMBOLS_FORMAT}`] };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return { pack: null, problems: ['it has no "name" to show in the Symbols list'] };
  const licence = typeof raw.licence === 'string' ? raw.licence.trim() : '';
  if (!licence) return { pack: null, problems: ['it has no "licence" (say what the set\'s owners allow, for example "CC BY-SA")'] };
  const known = pictures.filter((f) => PICTURE_TYPES.includes(extOf(f)));
  if (!known.length) return { pack: null, problems: ['its pictures folder has no pictures (svg, png, webp or jpg)'] };
  const words = raw.words && typeof raw.words === 'object' && !Array.isArray(raw.words) ? raw.words : {};
  const stems = new Set(known.map((f) => f.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '')));
  for (const [word, stem] of Object.entries(words)) {
    if (typeof stem !== 'string' || !stems.has(stem)) problems.push(`"${word}" points at "${stem}", which is not in its pictures`);
  }
  const style = { ...PACK_DEFAULTS, ...(raw.style && typeof raw.style === 'object' ? raw.style : {}) };
  if (!['auto', 'always', 'never'].includes(style.plate)) style.plate = PACK_DEFAULTS.plate;
  return {
    pack: {
      format: SYMBOLS_FORMAT, name, licence,
      credit: typeof raw.credit === 'string' ? raw.credit.trim() : '',
      source: typeof raw.source === 'string' ? raw.source.trim() : '',
      files: typeof raw.files === 'string' ? raw.files : '',
      naming: raw.naming && typeof raw.naming === 'object' ? raw.naming : {},
      words, style,
    },
    problems,
  };
}

/** The folder a pack's `files` names ("EN/"), under the pack's own folder; the pack's folder itself when it names none. */
async function picturesDir(dir, files) {
  let d = dir;
  for (const part of String(files || '').split('/').filter(Boolean)) {
    if (part === '.' || part === '..') return null;
    try { d = await d.getDirectoryHandle(part); } catch { return null; }
  }
  return d;
}

/** One folder as a pack, or why not: `{ entry }` | `{ why }` | null when it holds no pack file at all. */
async function readPackFolder(dir, folderName, max) {
  const jsons = await listFiles(dir, ['json']);
  let raw = null, fileName = '';
  for (const f of jsons) {
    try {
      const file = await f.handle.getFile();
      if (file.size > max) continue;
      const parsed = JSON.parse(await file.text());
      if (parsed && parsed.format === SYMBOLS_FORMAT) { raw = parsed; fileName = f.name; break; }
    } catch { /* not this one */ }
  }
  if (!raw) return null;
  const pics = await picturesDir(dir, raw.files);
  if (!pics) return { why: `its pictures folder "${raw.files}" is not there` };
  const listed = await listFiles(pics, PICTURE_TYPES);
  const r = checkSymbolPack(raw, listed.map((f) => f.name));
  if (!r.pack) return { why: r.problems[0] };
  return { entry: { id: packId(folderName), label: r.pack.name, folder: folderName, file: fileName, pack: r.pack,
    problems: r.problems, pictures: new Map(listed.map((f) => [f.name, f.handle])) } };
}

/**
 * The symbol packs on this device: `{ packs: [{ id, label, folder, pack, problems, pictures }], skipped: [{ folder, why }],
 * where }`. `pictures` maps a picture's file name to its handle. Never prompts, never throws.
 */
export async function readSymbolPacks({ store = handleStore(), find = kindFolder, max = PACK_FILE_MAX,
  folderMax = PACK_FOLDERS_MAX } = {}) {
  const out = { packs: [], skipped: [], where: '' };
  let k = null;
  try { k = await find(SYMBOLS_KIND, { store }); } catch { return out; }
  out.where = k?.name || '';
  if (!k?.dir) return out;
  const take = async (dir, folderName) => {
    try {
      const r = await readPackFolder(dir, folderName, max);
      if (r?.entry) out.packs.push(r.entry);
      else if (r?.why) out.skipped.push({ folder: folderName, why: r.why });
    } catch { out.skipped.push({ folder: folderName, why: 'it could not be read' }); }
  };
  await take(k.dir, '.');
  let folders = [];
  try { folders = await listFolders(k.dir); } catch { folders = []; }
  for (const f of folders.slice(0, folderMax)) await take(f.handle, f.name);
  if (folders.length > folderMax) out.skipped.push({ folder: '', why: `only the first ${folderMax} folders were looked in` });
  // Two packs with one name would read the same in the Symbols list: the second says which folder it is in.
  const seen = new Map();
  for (const p of out.packs) {
    const n = (seen.get(p.label) || 0) + 1;
    seen.set(p.label, n);
    if (n > 1) p.label = `${p.label}, folder ${p.folder}`;
  }
  return out;
}

/** The picture a pack gives a board word: `{ name, handle, how }`, or null (the word keeps Nimrod's own). Pure. */
export function packPicture(entry, word) {
  if (!entry || !word) return null;
  const names = [...entry.pictures.keys()];
  const r = resolveSymbol(String(word), entry.pack, names);
  return r ? { name: r.file, handle: entry.pictures.get(r.file), how: r.how } : null;
}

/** What the Symbols list says for a pack: its name, "your own", and its licence. Pure. */
export const packLabel = (entry) => `${entry.label} (your own, ${entry.pack.licence})`;
