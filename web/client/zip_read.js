// zip_read.js - READ A PLAIN ZIP IN THE BROWSER, ONE FILE AT A TIME (symbol packs, the proposal's step 4, 2026-11-03).
//
// The writer beside it (zip_store.js) makes zips; this reads them, with no library: the central directory at the end of
// the file names every entry, and each entry is sliced out of the File only when it is asked for, so a 30 MB symbol set is
// never held in memory whole. Two ways of storing an entry are read: stored (0) and deflate (8, through the browser's own
// DecompressionStream('deflate-raw')). Everything else is refused with a reason in words: zip64 (a zip over 4 GB or with
// over 65,535 entries; a symbol set is neither), encrypted entries, and other methods. Format: PKWARE APPNOTE 6.3.x.

const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;
// The end record is 22 bytes plus a comment of up to 65,535; that is as far back from the end as it can be.
const EOCD_SEARCH = 22 + 0xffff;

const decoder = new TextDecoder('utf-8');

/**
 * The entries of a zip `File` (or Blob): `{ entries: [{ name, size, method, packed, offset }], problem }`. `problem` is a
 * sentence when the file cannot be read as a plain zip; `entries` is then empty. Never throws.
 */
export async function zipEntries(file) {
  try {
    const tailStart = Math.max(0, file.size - EOCD_SEARCH);
    const tail = new DataView(await file.slice(tailStart).arrayBuffer());
    let at = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) { if (tail.getUint32(i, true) === EOCD_SIG) { at = i; break; } }
    if (at < 0) return { entries: [], problem: 'it is not a zip file' };
    const count = tail.getUint16(at + 10, true);
    const cenSize = tail.getUint32(at + 12, true);
    const cenOffset = tail.getUint32(at + 16, true);
    if (count === 0xffff || cenOffset === 0xffffffff) return { entries: [], problem: 'it is a very large zip (zip64), which is not read here' };
    const cen = new DataView(await file.slice(cenOffset, cenOffset + cenSize).arrayBuffer());
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cen.byteLength || cen.getUint32(p, true) !== CEN_SIG) return { entries: [], problem: 'its list of files is damaged' };
      const flags = cen.getUint16(p + 8, true);
      const method = cen.getUint16(p + 10, true);
      const packed = cen.getUint32(p + 20, true);
      const size = cen.getUint32(p + 24, true);
      const nameLen = cen.getUint16(p + 28, true), extraLen = cen.getUint16(p + 30, true), commentLen = cen.getUint16(p + 32, true);
      const offset = cen.getUint32(p + 42, true);
      const name = decoder.decode(new Uint8Array(cen.buffer, cen.byteOffset + p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;                       // a folder's own entry
      entries.push({ name, size, method, packed, offset, encrypted: !!(flags & 1) });
    }
    return { entries, problem: '' };
  } catch {
    return { entries: [], problem: 'it could not be read' };
  }
}

/** One entry's bytes, as a Blob. Throws with a sentence when it cannot be read. */
export async function zipEntryBlob(file, entry, type = '') {
  if (entry.encrypted) throw new Error('it is locked with a password');
  if (entry.method !== 0 && entry.method !== 8) throw new Error('it is packed in a way that is not read here');
  const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (head.getUint32(0, true) !== LOC_SIG) throw new Error('it is damaged');
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.packed);
  if (entry.method === 0) return new Blob([raw], { type });
  if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot unpack it');
  const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Blob([await new Response(stream).arrayBuffer()], { type });
}

/** A handle-shaped object for one entry (`{ kind, name, getFile }`), so a zip's files read like a folder's. */
export function zipEntryHandle(file, entry, type = '') {
  const name = entry.name.replace(/^.*\//, '');
  return { kind: 'file', name, async getFile() { return new File([await zipEntryBlob(file, entry, type)], name, { type }); } };
}
