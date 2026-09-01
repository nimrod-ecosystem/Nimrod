// telemetry.js — the GAMEPLAY stream: how someone actually did, trial by trial.
//
// The twin of points.js. That one records what a person EARNED (an economy, meant to
// motivate); this one records what they DID (a measurement, meant to be read as evidence
// of progress). Same substrate — one profile-scoped append-only stream reached with
// ctx.makeEvents(), "only the source appends", plus a live bus nudge — different question.
//
// ONE SHAPE FOR TWO KINDS OF GAME. A response game (a cue appears; press in time) and a
// learning game (a question appears; answer it) look like different worlds, but their
// trial data is the same three facts: was there a response, was it right, how long did it
// take. So there is ONE `trial` event, and the vocabularies map onto it:
//
//     responded && correct   -> a HIT          (appropriate signal / right answer)
//     responded && !correct  -> a FALSE ALARM  (commission / wrong answer)
//     !responded             -> a MISS         (omission / left blank)
//
// That matters because ONE PERSON MAY PLAY GAMES FROM BOTH SETS. Nothing here is keyed to
// a persona or a diagnosis — the viewer switches by GAME, and every game is welcome in the
// same stream.
//
// `concept` IS THE IMPORTANT FIELD. Accuracy alone says how someone is doing; accuracy
// PER CONCEPT says what they are getting and what they are struggling with, which is the
// whole reason to keep this data. Games should always set it — a topic ("fractions",
// "comma splices"), or the skill a cue exercises ("inhibition", "sustained attention").
//
// EVENT SHAPE — kind `trial`, data:
//   { game, session, mode?, concept?, responded, correct, latencyMs?, waitMs?, prompt? }
//     game       which game produced it — the viewer's primary filter
//     session    groups trials into one sitting; per-session accuracy keys off it
//     mode       optional variant ("calm" / "challenge" / "practice")
//     concept    the skill or topic exercised
//     responded  did the player act at all
//     correct    was it right (null when they didn't respond)
//     latencyMs  cue/question -> response
//     waitMs     how long the game made them wait before the cue (pacing)
//     band       optional grouping label the game supplies — e.g. a grade band from its
//                own content ("grade 8"). It is the CONTENT'S OWN label, not a normed or
//                national measure; see byBand() and docs/modules/progress.md.
//     prompt     optional human label of the item, for a readable log
//   The server stamps `id` and `created_at`; the client clock is never the record.
//
// KNOWN BOUND: metrics derive from the most-recent `limit` trials (default 1000), same as
// points.js. When that is outgrown the answer is a server-side rollup, not a cached total.

export const GAMEPLAY_STREAM = 'gameplay';        // well-known shared stream key
export const GAMEPLAY_TOPIC  = 'gameplay/logged'; // bus topic — live nudge, NOT the record
export const TRIAL_KIND      = 'trial';

// ---------- pure helpers (the math the viewer and the tests share) ----------

export function trials(events) {
  return (events || []).filter((e) => e && e.kind === TRIAL_KIND && e.data);
}

export const isHit        = (t) => !!t.data.responded && t.data.correct === true;
export const isFalseAlarm = (t) => !!t.data.responded && t.data.correct === false;
export const isMiss       = (t) => !t.data.responded;

function mean(xs) {
  const ys = xs.filter((n) => Number.isFinite(n));
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

// The headline numbers for a set of trials.
//
// TWO accuracy measures, deliberately, because they answer different questions:
//   accuracy    hits / ALL trials      — a miss counts against you (did you get it right?)
//   whenAnswered hits / trials answered — misses excluded (were you right when you tried?)
// A big gap between them means the problem is not knowing, it's not responding.
export function summarize(list) {
  const ts = trials(list);
  const hits = ts.filter(isHit).length;
  const falseAlarms = ts.filter(isFalseAlarm).length;
  const misses = ts.filter(isMiss).length;
  const answered = hits + falseAlarms;
  return {
    trials: ts.length,
    hits, falseAlarms, misses, answered,
    accuracy: ts.length ? hits / ts.length : null,
    whenAnswered: answered ? hits / answered : null,
    meanLatency: mean(ts.filter(isHit).map((t) => Number(t.data.latencyMs))),
    meanWait: mean(ts.map((t) => Number(t.data.waitMs))),
  };
}

export function games(list) {
  return [...new Set(trials(list).map((t) => t.data.game).filter(Boolean))].sort();
}

export function modes(list) {
  return [...new Set(trials(list).map((t) => t.data.mode).filter(Boolean))].sort();
}

export function filterTrials(list, { game = null, mode = null } = {}) {
  return trials(list).filter((t) =>
    (!game || t.data.game === game) && (!mode || t.data.mode === mode));
}

// One row per sitting, oldest first — the x-axis of the progress chart.
export function bySession(list) {
  const by = new Map();
  for (const t of trials(list)) {
    const id = t.data.session || '?';
    if (!by.has(id)) by.set(id, { session: id, game: t.data.game, mode: t.data.mode, at: t.created_at, items: [] });
    const g = by.get(id);
    g.items.push(t);
    if (t.created_at < g.at) g.at = t.created_at;
  }
  return [...by.values()]
    .map((g) => ({ ...g, ...summarize(g.items) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Split a concept's trials in half by time and compare — is this getting better or stuck?
// `null` until there is enough to say, because a confident arrow on 3 trials is a lie.
export function conceptTrend(items, minPerHalf = 3) {
  const ts = [...items].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const half = Math.floor(ts.length / 2);
  if (half < minPerHalf) return { trend: null, earlier: null, recent: null };
  const earlier = summarize(ts.slice(0, half)).accuracy;
  const recent = summarize(ts.slice(ts.length - half)).accuracy;
  if (earlier == null || recent == null) return { trend: null, earlier, recent };
  const d = recent - earlier;
  return { trend: Math.abs(d) < 0.08 ? 'flat' : (d > 0 ? 'up' : 'down'), earlier, recent };
}

// Sort order for tied accuracy: a concept that is SLIPPING needs attention before one that
// is merely low but climbing. "60% and falling" is a different problem from "60% and rising",
// and the list is read top-down, so the ordering has to carry that.
const TREND_URGENCY = { down: 0, flat: 1, up: 3 };
const urgency = (t) => (t in TREND_URGENCY ? TREND_URGENCY[t] : 2);   // no trend yet: middle

// Per-BAND accuracy — "how is he doing on grade-8 words vs grade-10 words".
//
// A band is whatever label the game attached to the item (see the `band` field). It is
// descriptive of the CONTENT, not a percentile against other children: nothing here is
// normed, and presenting it as though it were would be inventing a number about someone's
// education. Sorted by band label so the progression reads in order.
export function byBand(list) {
  const by = new Map();
  for (const t of trials(list)) {
    const b = t.data.band;
    if (!b) continue;                       // unlabeled content simply doesn't appear
    if (!by.has(b)) by.set(b, []);
    by.get(b).push(t);
  }
  return [...by.entries()]
    .map(([band, items]) => ({ band, ...summarize(items), ...conceptTrend(items) }))
    .sort((a, b) => String(a.band).localeCompare(String(b.band), undefined, { numeric: true }));
}

export function bands(list) {
  return [...new Set(trials(list).map((t) => t.data.band).filter(Boolean))];
}

// Per-concept mastery, HARDEST FIRST — the answer to "what is he struggling with".
export function byConcept(list) {
  const by = new Map();
  for (const t of trials(list)) {
    const c = t.data.concept || '(unlabeled)';
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(t);
  }
  return [...by.entries()]
    .map(([concept, items]) => ({ concept, ...summarize(items), ...conceptTrend(items) }))
    .sort((a, b) =>
      (a.accuracy ?? 1) - (b.accuracy ?? 1) ||       // lowest accuracy first
      urgency(a.trend) - urgency(b.trend) ||         // then whichever is heading the wrong way
      b.trials - a.trials ||                         // then the better-evidenced one
      a.concept.localeCompare(b.concept));           // then stable, so the list doesn't jitter
}

export function fmtPct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }
export function fmtMs(x) { return x == null ? '—' : `${Math.round(x)} ms`; }

// ---------- the handle ----------

// A telemetry handle over the shared `gameplay` stream. `makeEvents` is ctx.makeEvents —
// a module never builds a storage URL itself. The caller owns the lifecycle: call
// destroy() in the module's destroy().
export function createTelemetry({ makeEvents, bus = null, limit = 1000, pollMs = 4000 } = {}) {
  if (typeof makeEvents !== 'function') {
    throw new Error('createTelemetry: ctx.makeEvents is required');
  }
  const stream = makeEvents(GAMEPLAY_STREAM, { limit, pollMs });

  async function log({ game, session, mode = null, concept = null, band = null,
                       responded = true, correct = null, latencyMs = null,
                       waitMs = null, prompt = '' } = {}) {
    if (!game) return null;                       // an unattributed trial is unreadable
    const data = {
      game: String(game),
      session: String(session || 'adhoc'),
      responded: !!responded,
      // `correct` is meaningless when they didn't respond — keep it null rather than false,
      // so "wrong" and "no answer" never blur together in the metrics.
      correct: responded ? (correct === true) : null,
    };
    if (mode) data.mode = String(mode);
    if (concept) data.concept = String(concept);
    if (band) data.band = String(band);
    if (Number.isFinite(Number(latencyMs))) data.latencyMs = Number(latencyMs);
    if (Number.isFinite(Number(waitMs))) data.waitMs = Number(waitMs);
    if (prompt) data.prompt = String(prompt);

    await stream.append(TRIAL_KIND, data);        // 1. the record (durable, first)
    if (bus) bus.publish(GAMEPLAY_TOPIC, data);   // 2. the nudge (live)
    return data;
  }

  // Ergonomics for game authors: bind a fresh session once, then just log trials.
  function session({ game, mode = null } = {}) {
    const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
      id,
      trial: (t) => log({ ...t, game, mode, session: id }),
    };
  }

  return {
    log,
    session,
    load: () => stream.load(),
    startPolling: () => stream.startPolling(),
    subscribe: (fn) => stream.subscribe(fn),
    get: () => stream.get(),
    trials: () => trials(stream.get().events || []),
    games: () => games(stream.get().events || []),
    destroy: () => stream.destroy(),
  };
}
