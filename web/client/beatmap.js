// beatmap.js - READING A BEAT SABER MAP THE PERSON BRINGS (row 2.222, note FE 4; proposal_teams_beatmaps_20261106, gated).
//
// Mike: custom maps in the Rhythm game. Nimrod ships no maps and no songs (most maps are of copyrighted songs): a person opens a
// map zip of their own, on their own device, and it never travels (not in a shared game, screen sync or a shared folder). This
// file only READS one: Info.dat, a difficulty's notes and its song's name, into timed notes. Rhythm plays them (a later step).
//
// THE FORMATS (bsmg.wiki), all read here:
//   Info.dat      v2: `_version`, `_songFilename`, `_beatsPerMinute`, `_songTimeOffset`, `_difficultyBeatmapSets[]`
//                 v4: `version: "4.x"`, `audio.{songFilename, bpm, audioDataFilename}`, `difficultyBeatmaps[]`
//   difficulty    v2: `_notes[{_time, _lineIndex, _lineLayer, _type (0 red, 1 blue, 3 bomb), _cutDirection}]`; tempo changes in
//                     `_customData._BPMChanges[{_time, _BPM}]` or `_events` of `_type` 100 (`_floatValue` the BPM)
//                 v3: `colorNotes[{b, x, y, c, d}]`, `burstSliders[{b, x, y, c, d}]` (a chain: its head is a note), `bpmEvents[{b, m}]`
//                 v4: `colorNotes[{b, i}]` indexing `colorNotesData[{x, y, c, d}]`, `chains[{hb, i}]` indexing `chainsData`;
//                     tempo in AudioData.dat `bpmData[{si, ei, sb, eb}]` (samples), with `songFrequency`
//   Bombs, walls, arcs' tails and lights are not notes and are left out. A note outside lanes 0-3 or rows 0-2 (a mapping
//   extension) is left out, said once in `problems`.
//
// A NOTE: `{ ms, lane: 0-3, row: 0-2, colour: 0 | 1, cut: 0-8 }`, in time order. PURE throughout, except `readMapZip`.

import { zipEntries, zipEntryBlob } from './zip_read.js';

// THE CAPS, argued (Rule 1; a Pi 400 reads a deflated entry whole into memory, zip_read.js):
//   MAP_ZIP_MAX 80 MB  a map's song is 3-10 MB, a cover a few hundred KB; 80 is several times a real map and refuses a stray
//                      video or a game's whole folder before it is read.
//   DAT_MAX 20 MB      a difficulty with a long light show can run to tens of MB of lights this file never uses; the notes of the
//                      hardest map are a few MB. FOR higher: a rare map is refused. AGAINST: a Pi parsing 50 MB of JSON stalls the
//                      screen. A refused map says why.
export const MAP_ZIP_MAX = 80 * 1024 * 1024;
export const DAT_MAX = 20 * 1024 * 1024;
export const LANES = 4;
export const ROWS = 3;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const major = (v) => { const m = /^(\d+)/.exec(String(v || '')); return m ? Number(m[1]) : null; };

/** Info.dat -> { version, songFile, bpm, offsetMs, audioDataFile, difficulties: [{ characteristic, difficulty, file }] } or null. */
export function parseInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const v = major(info.version) ?? major(info._version) ?? 2;
  if (v >= 4) {
    const a = info.audio || {};
    const bpm = num(a.bpm);
    const diffs = (Array.isArray(info.difficultyBeatmaps) ? info.difficultyBeatmaps : [])
      .map((d) => ({ characteristic: String(d?.characteristic || 'Standard'), difficulty: String(d?.difficulty || ''), file: String(d?.beatmapDataFilename || '') }))
      .filter((d) => d.file);
    if (!a.songFilename || !bpm || !diffs.length) return null;
    return { version: v, songFile: String(a.songFilename), bpm, offsetMs: 0,
      audioDataFile: a.audioDataFilename ? String(a.audioDataFilename) : null, difficulties: diffs };
  }
  const bpm = num(info._beatsPerMinute);
  const diffs = [];
  for (const set of Array.isArray(info._difficultyBeatmapSets) ? info._difficultyBeatmapSets : []) {
    for (const d of Array.isArray(set?._difficultyBeatmaps) ? set._difficultyBeatmaps : []) {
      if (d?._beatmapFilename) diffs.push({ characteristic: String(set._beatmapCharacteristicName || 'Standard'),
        difficulty: String(d._difficulty || ''), file: String(d._beatmapFilename) });
    }
  }
  if (!info._songFilename || !bpm || !diffs.length) return null;
  return { version: 2, songFile: String(info._songFilename), bpm, offsetMs: (num(info._songTimeOffset) || 0) * 1000,
    audioDataFile: null, difficulties: diffs };
}

/**
 * A beats -> milliseconds function. `changes`: [{ beat, bpm }] (v2, v3), or `audioData` (v4: bpmData in samples).
 * Between changes the tempo is constant; before the first change the map's own BPM. PURE.
 */
export function beatClock({ bpm, offsetMs = 0, changes = [], audioData = null } = {}) {
  const segs = audioData && Array.isArray(audioData.bpmData) && num(audioData.songFrequency)
    ? audioData.bpmData.filter((s) => [s?.si, s?.ei, s?.sb, s?.eb].every((x) => num(x) != null) && s.eb > s.sb)
      .sort((a, b) => a.sb - b.sb) : null;
  if (segs && segs.length) {
    const f = audioData.songFrequency;
    return (beat) => {
      const s = segs.find((x) => beat <= x.eb) || segs[segs.length - 1];
      const sample = s.si + ((beat - s.sb) / (s.eb - s.sb)) * (s.ei - s.si);
      return offsetMs + (sample / f) * 1000;
    };
  }
  const steps = [{ beat: 0, bpm }, ...(changes || []).filter((c) => num(c?.beat) != null && num(c?.bpm) > 0 && c.beat > 0)
    .sort((a, b) => a.beat - b.beat)];
  // The time at each change's beat, so a later beat adds up from the change before it.
  const at = [0];
  for (let i = 1; i < steps.length; i++) at.push(at[i - 1] + ((steps[i].beat - steps[i - 1].beat) * 60000) / steps[i - 1].bpm);
  return (beat) => {
    let i = 0;
    while (i + 1 < steps.length && steps[i + 1].beat <= beat) i++;
    return offsetMs + at[i] + ((beat - steps[i].beat) * 60000) / steps[i].bpm;
  };
}

/** A difficulty file -> { notes, problems }. `info`: parseInfo's; `audioData`: v4's AudioData.dat, when there is one. PURE. */
export function parseDifficulty(dat, info, { audioData = null } = {}) {
  const problems = [];
  if (!dat || typeof dat !== 'object' || !info) return { notes: [], problems: ['This difficulty could not be read.'] };
  const v = major(dat.version) ?? major(dat._version) ?? 2;
  const raw = [];        // { beat, x, y, c, d }
  let changes = [];
  if (v >= 4) {
    const data = Array.isArray(dat.colorNotesData) ? dat.colorNotesData : [];
    for (const n of Array.isArray(dat.colorNotes) ? dat.colorNotes : []) { const d = data[n?.i]; if (d) raw.push({ beat: n.b, x: d.x, y: d.y, c: d.c, d: d.d }); }
    const cdata = Array.isArray(dat.chainsData) ? dat.chainsData : [];
    for (const n of Array.isArray(dat.chains) ? dat.chains : []) { const d = cdata[n?.i]; if (d) raw.push({ beat: n.hb, x: d.x, y: d.y, c: d.c, d: d.d }); }
  } else if (v === 3) {
    for (const n of Array.isArray(dat.colorNotes) ? dat.colorNotes : []) raw.push({ beat: n?.b, x: n?.x, y: n?.y, c: n?.c, d: n?.d });
    for (const n of Array.isArray(dat.burstSliders) ? dat.burstSliders : []) raw.push({ beat: n?.b, x: n?.x, y: n?.y, c: n?.c, d: n?.d });
    changes = (Array.isArray(dat.bpmEvents) ? dat.bpmEvents : []).map((e) => ({ beat: e?.b, bpm: e?.m }));
  } else {
    for (const n of Array.isArray(dat._notes) ? dat._notes : []) {
      if (n?._type === 0 || n?._type === 1) raw.push({ beat: n._time, x: n._lineIndex, y: n._lineLayer, c: n._type, d: n._cutDirection });
    }
    const custom = dat._customData && Array.isArray(dat._customData._BPMChanges) ? dat._customData._BPMChanges : [];
    changes = custom.length ? custom.map((e) => ({ beat: e?._time, bpm: e?._BPM }))
      : (Array.isArray(dat._events) ? dat._events : []).filter((e) => e?._type === 100).map((e) => ({ beat: e._time, bpm: e._floatValue }));
  }
  const clock = beatClock({ bpm: info.bpm, offsetMs: info.offsetMs, changes, audioData: v >= 4 ? audioData : null });
  let outside = 0;
  const notes = [];
  for (const n of raw) {
    if (num(n.beat) == null) continue;
    if (!(Number.isInteger(n.x) && n.x >= 0 && n.x < LANES && Number.isInteger(n.y) && n.y >= 0 && n.y < ROWS)) { outside++; continue; }
    notes.push({ ms: Math.round(clock(n.beat)), lane: n.x, row: n.y, colour: n.c === 1 ? 1 : 0, cut: Number.isInteger(n.d) && n.d >= 0 && n.d <= 8 ? n.d : 8 });
  }
  if (outside) problems.push(`${outside} note${outside === 1 ? '' : 's'} outside the four lanes were left out.`);
  if (v >= 4 && !audioData) problems.push('No AudioData.dat: the map’s one tempo is used throughout.');
  notes.sort((a, b) => a.ms - b.ms || a.lane - b.lane);
  return { notes, problems };
}

/**
 * THINNING, NOT MERGING (the gate on FE 4): the first note of each run, and the next only once `minGapMs` has passed since the
 * last one kept. Merging everything within a window would chain a fast stream into one press; a minimum gap keeps a steady,
 * playable beat for one button. PURE.
 */
export function thinNotes(notes, minGapMs) {
  const gap = Math.max(0, Number(minGapMs) || 0);
  const out = [];
  let last = -Infinity;
  for (const n of notes || []) {
    if (n.ms - last >= gap) { out.push(n); last = n.ms; }
  }
  return out;
}

/**
 * A map zip the person chose -> { info, file(name) -> Blob, problems } or { problem }. Info.dat is found at the top or one folder
 * down, its name in any case; nothing is read past the caps. Never throws.
 */
export async function readMapZip(file) {
  if (!file || typeof file.size !== 'number') return { problem: 'That is not a file.' };
  if (file.size > MAP_ZIP_MAX) return { problem: `That file is larger than ${MAP_ZIP_MAX / 1048576} MB, so it is not read.` };
  const { entries, problem } = await zipEntries(file);
  if (problem) return { problem };
  const infoEntry = entries.find((e) => /^(?:[^/]+\/)?info\.dat$/i.test(e.name));
  if (!infoEntry) return { problem: 'There is no Info.dat in it, so it is not a Beat Saber map.' };
  const dir = infoEntry.name.includes('/') ? infoEntry.name.slice(0, infoEntry.name.lastIndexOf('/') + 1) : '';
  const byName = (name) => entries.find((e) => e.name.toLowerCase() === (dir + name).toLowerCase()) || null;
  const readJson = async (e) => {
    if (!e) return null;
    if (e.size > DAT_MAX) return { tooBig: true };
    try { const b = await zipEntryBlob(file, e, 'application/json'); return b ? JSON.parse(await b.text()) : null; } catch { return null; }
  };
  const info = parseInfo(await readJson(infoEntry));
  if (!info) return { problem: 'Its Info.dat could not be read as a map.' };
  const songEntry = byName(info.songFile);
  if (!songEntry) return { problem: `The song it names (${info.songFile}) is not in the file.` };
  return {
    info,
    // The song, typed as Ogg (a map's song.egg is Ogg Vorbis whatever its name), and a difficulty's notes, read when chosen.
    song: () => zipEntryBlob(file, songEntry, 'audio/ogg'),
    async difficulty(d) {
      const dat = await readJson(byName(d.file));
      if (dat && dat.tooBig) return { notes: [], problems: [`That difficulty is larger than ${DAT_MAX / 1048576} MB, so it is not read.`] };
      const audioData = info.audioDataFile ? await readJson(byName(info.audioDataFile)) : null;
      return parseDifficulty(dat, info, { audioData: audioData && !audioData.tooBig ? audioData : null });
    },
  };
}
