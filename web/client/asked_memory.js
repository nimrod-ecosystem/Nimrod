// asked_memory.js — WHAT A PLAYER HAS ALREADY BEEN ASKED, kept past the panel's life (row 2.173).
//
// Mike, 2026-11-01: "it just kept giving me the same old question like 4 times in a row." Trivia remembered what it
// had asked only for as long as the panel lived (trivia.js `seenBy`). A dashboard switch, a reload, a deploy or a
// restart started it over, and with few questions at a level (the built-in packs hold 21 that are not sums) the same
// handful came straight back. The usual rule, and now this one: NO QUESTION AGAIN UNTIL THE POOL IS USED UP.
//
// WHERE IT IS KEPT: row `asked`, `{ players: { [playerId]: { [game]: "<8 hex><8 hex>..." } } }`. A screen's person
// (`person:<id>`) keeps it on their OWN row (ctx.makePersonState), so it follows them to their other screens, as their
// trivia level does; a player typed into "Players" keeps it on the screen's row. One shape in both places.
//
// EACH QUESTION IS 8 HEX CHARACTERS (FNV-1a of its id), oldest first, so a thousand questions is 8 KB. Argued:
//   FOR the ids themselves: exact, and readable on the row. AGAINST, and it decides it: a trivia id is the question
//   and answer (trivia.js `triviaId`), often 100 characters, and the row is rewritten after every answer. A clash
//   between two hashes (about 1 in 4,000 over 2,000 questions) only means one question counts as asked: harmless.
//
// HOW MANY ARE KEPT: `cap`, the game's own setting (Trivia: "Questions remembered", default ASKED_CAP_DEFAULT).
// Past it the oldest is forgotten. Argued in trivia.js where the setting is declared.
//
// A REFUSED SAVE MERGES (state.js `merge`): two screens of one person both answering keep both sets of questions.

export const ASKED_KEY = 'asked';
export const ASKED_CAP_DEFAULT = 1000;
const HEX = 8;

/** FNV-1a, 32 bits, as 8 hex characters. PURE. */
export function askedHash(id) {
  const s = String(id ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(HEX, '0');
}

/** A stored string as its hashes, oldest first; anything malformed is dropped. PURE. */
export function askedList(str) {
  const s = typeof str === 'string' ? str : '';
  const out = [];
  for (let i = 0; i + HEX <= s.length; i += HEX) {
    const h = s.slice(i, i + HEX);
    if (/^[0-9a-f]{8}$/.test(h)) out.push(h);
  }
  return out;
}

/** `list` with `hashes` added (each moved to the newest end), at most `cap` kept (the newest). PURE. */
export function askedAdd(list, hashes, cap = ASKED_CAP_DEFAULT) {
  const n = Math.max(0, Math.floor(Number(cap) || 0));
  if (!n) return [];
  const add = new Set(hashes);
  const out = list.filter((h) => !add.has(h)).concat([...add]);
  return out.length > n ? out.slice(out.length - n) : out;
}

/** Two copies of one player's list, as one: theirs, then what only mine has, newest last. PURE. */
export function askedUnion(theirs, mine, cap = ASKED_CAP_DEFAULT) {
  const t = askedList(theirs);
  const have = new Set(t);
  return askedAdd(t, askedList(mine).filter((h) => !have.has(h)), cap).join('');
}

/** state.js `merge(base, mine, theirs)`: every player's every game, both copies kept. PURE. */
export function askedMerge(base, mine, theirs) {
  const m = mine?.players || {}, t = theirs?.players || {};
  const players = {};
  for (const pid of new Set([...Object.keys(t), ...Object.keys(m)])) {
    const games = {};
    for (const g of new Set([...Object.keys(t[pid] || {}), ...Object.keys(m[pid] || {})])) {
      // Unbounded here: the cap is the game's setting, applied at its next answer.
      games[g] = askedUnion(t[pid]?.[g], m[pid]?.[g], Number.MAX_SAFE_INTEGER);
    }
    players[pid] = games;
  }
  return { data: { ...(theirs || {}), ...(mine || {}), players }, lost: [] };
}
export const ASKED_STATE_OPTIONS = Object.freeze({ merge: askedMerge });

/**
 * One game's memory of what each player was asked.
 *   ctx    the module's ctx (makeState, makePersonState). Without either, it remembers for the panel's life only.
 *   game   whose list ('trivia')
 *   cap()  how many to keep, read at each answer (the game's setting)
 * has(pid, id), add(pid, id), forgetOldest(pid, fraction), ready(pid), destroy().
 */
export function createAskedMemory(ctx, { game, cap = () => ASKED_CAP_DEFAULT } = {}) {
  const handles = new Map();   // row key -> handle
  const local = new Map();     // pid -> hashes (no row to keep them on)
  // (2026-11-02, game_teardown_test) DESTROYED MEANS DESTROYED: a row still loading when the game went did start polling
  // after it, and a call made after it opened a fresh row that nobody would close. After `destroy`, nothing opens a row.
  let dead = false;
  const rowFor = (pid) => {
    if (dead) return { handle: null, ready: Promise.resolve() };
    const person = typeof pid === 'string' && pid.startsWith('person:') ? pid.slice(7) : null;
    const key = person && typeof ctx?.makePersonState === 'function' ? `p:${person}` : 's';
    if (handles.has(key)) return handles.get(key);
    let h = null;
    try {
      h = key === 's' ? (typeof ctx?.makeState === 'function' ? ctx.makeState(ASKED_KEY, { ...ASKED_STATE_OPTIONS }) : null)
        : ctx.makePersonState(person, ASKED_KEY, { ...ASKED_STATE_OPTIONS });
    } catch { h = null; }
    const entry = { handle: h || null, ready: Promise.resolve() };
    if (entry.handle) {
      entry.ready = Promise.resolve().then(() => entry.handle.load?.()).catch(() => {})
        .then(() => { if (dead) return; try { entry.handle?.startPolling?.(); } catch { /* none */ } });
    }
    handles.set(key, entry);
    return entry;
  };
  const doc = (pid) => { try { return rowFor(pid).handle?.get?.() || {}; } catch { return {}; } };
  const listOf = (pid) => {
    const e = rowFor(pid);
    if (!e.handle) return local.get(pid) || [];
    const s = doc(pid)?.players?.[pid]?.[game];
    return askedList(s);
  };
  const write = (pid, list) => {
    const e = rowFor(pid);
    if (!e.handle) { local.set(pid, list); return; }
    const d = doc(pid);
    const players = { ...(d.players || {}) };
    players[pid] = { ...(players[pid] || {}), [game]: list.join('') };
    try { e.handle.set({ players }); } catch (err) { console.error('asked: save', err); }
  };
  let cache = { pid: null, src: null, set: null };
  return {
    ready: (pid) => rowFor(pid).ready,
    has(pid, id) {
      const e = rowFor(pid);
      const src = e.handle ? doc(pid)?.players?.[pid]?.[game] : local.get(pid);
      if (cache.pid !== pid || cache.src !== src) cache = { pid, src, set: new Set(e.handle ? askedList(src) : (src || [])) };
      return cache.set.has(askedHash(id));
    },
    add(pid, id) { write(pid, askedAdd(listOf(pid), [askedHash(id)], cap())); },
    size: (pid) => listOf(pid).length,
    /** The pool is used up: the oldest `fraction` is forgotten, so those come round first. */
    forgetOldest(pid, fraction = 0.5) {
      const l = listOf(pid);
      if (!l.length) return;
      write(pid, l.slice(Math.max(1, Math.ceil(l.length * fraction))));
    },
    destroy() {
      dead = true;
      for (const e of handles.values()) { try { e.handle?.flush?.(); e.handle?.destroy?.(); } catch { /* gone */ } }
      handles.clear();
    },
  };
}
