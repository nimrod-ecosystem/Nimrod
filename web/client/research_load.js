// research_load.js — THE RESEARCH PACKS, FETCHED ONCE PER PAGE AND SHARED BY EVERY MODULE THAT READS THEM (2026-11-23).
//
// Moved out of modules/didyouknow.js (where it was written, row 2.223) when the word games started reading the same packs
// (note GM 3; Mike, 2026-11-23: "yes to shared words"). Did you know, Word builder and Spelling on one page share ONE fetch
// of research/index.json and the files it names: `sharedResearch()` returns the same promise to all of them.
// research_index.js stays pure (what may be shown, `find`); this file is the only one that touches the network for it.

import { readPack, buildIndex } from './research_index.js';

export const MAX_PACKS = 100;   // research/index.json names a few dozen; 100 stops a broken index fetching forever

/** Read research/index.json and every pack it names into one index. Never throws: a missing file is a problem, said. */
export function loadResearch({ base = new URL('./research/', import.meta.url).href, fetchImpl = (...a) => fetch(...a) } = {}) {
  const json = async (url) => { const r = await fetchImpl(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  return (async () => {
    const b = base.endsWith('/') ? base : `${base}/`;
    let list = [];
    try { const ix = await json(`${b}index.json`); list = Array.isArray(ix?.packs) ? ix.packs : []; } catch { list = []; }
    const files = list.filter((f) => typeof f === 'string' && /^[\w.-]+\.json$/.test(f)).slice(0, MAX_PACKS);
    const packs = await Promise.all(files.map(async (f) => { try { return readPack(await json(`${b}${f}`), { fileName: f }); }
      catch { return { name: f, items: [], problems: [`${f} could not be read`] }; } }));
    return buildIndex(packs);
  })();
}

let shared = null;
/** The page's one index (a promise), fetched on first ask. */
export const sharedResearch = () => (shared ||= loadResearch());
/** For the suites: start again (a new page's worth). */
export function forgetResearchForTest() { shared = null; }
