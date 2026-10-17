// zip_store.js - A ZIP FILE, STORED (NOT COMPRESSED), MADE IN THE PAGE. Row 2.49 (the folder tree's step 3): a copy of
// the Nimrod folder to download, for a browser that cannot make folders (Firefox, Safari, a phone) and for a computer
// set up by hand.
//
// STORED, NOT DEFLATED, argued: what goes in is a few empty folders and a dozen short README files - a few kilobytes,
// where compression saves nothing worth a dependency. Every operating system opens a stored zip. If something big ever
// goes in a zip made here, CompressionStream('deflate-raw') is the next step, and this file is where it goes.
//
// The format (PKWARE APPNOTE 6.3.x): a local header and the bytes for each entry, then the central directory, then the
// end record. Names are UTF-8 (general-purpose bit 11), so "Colour looks/README.txt" and any accent survive. Folders are
// entries whose name ends in '/', with no bytes. Times are DOS times in local time, as zip tools expect. PURE apart from
// `Blob` at the end, which every browser and the suites have.

const enc = new TextEncoder();

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}
/** CRC-32 of bytes (the zip one, IEEE 802.3). PURE. */
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
}
function dosDate(d) {
  return (((Math.max(1980, d.getFullYear()) - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
}

/**
 * The zip's bytes for `entries`: [{ name: 'Folder/', } | { name: 'Folder/README.txt', text } | { name, bytes }].
 * A name ending in '/' is a folder. Returns a Uint8Array. PURE (`date` is a seam).
 */
export function zipBytes(entries, { date = new Date() } = {}) {
  const time = dosTime(date), day = dosDate(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries || []) {
    const name = enc.encode(String(e.name || ''));
    const isDir = String(e.name || '').endsWith('/');
    const data = isDir ? new Uint8Array(0) : (e.bytes instanceof Uint8Array ? e.bytes : enc.encode(String(e.text || '')));
    const crc = isDir ? 0 : crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);       // local file header
    lv.setUint16(4, 20, true);               // version needed (2.0)
    lv.setUint16(6, 0x0800, true);           // flags: UTF-8 names
    lv.setUint16(8, 0, true);                // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    locals.push(local, data);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);       // central directory header
    cv.setUint16(4, 20, true);               // made by
    cv.setUint16(6, 20, true);               // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, isDir ? 0x10 : 0, true); // external attributes: a folder is marked as one (MS-DOS directory bit)
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The same, as a Blob a page can download. */
export function zipBlob(entries, opts = {}) {
  return new Blob([zipBytes(entries, opts)], { type: 'application/zip' });
}
