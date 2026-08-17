// lessons.js — TOPICS, and the lessons that unlock them.
//
// The level-up loop: a topic starts locked, its questions sit out of the game's pool, you
// watch the lesson for it, and from then on those questions are in play. Content arrives
// because you learned something, not because a timer said so.
//
// UNLOCKS ARE AN APPEND-ONLY LOG, not a flag. `state` would be last-write-wins, and a
// concurrent save from another device could silently un-earn something. A `lessons` stream
// records "watched this topic"; the unlocked set is derived from it. So an unlock cannot be
// lost, and there is an honest record of when each one happened — which is also the closest
// thing this curriculum has to a transcript.
//
// A topic is data, like everything else here:
//   { id, label, subject, video: { kind: 'youtube'|'url', value }, blurb }
//
// Word-bank entries opt in by carrying `topic: '<id>'`. **Content with NO topic is always
// available** — that is what keeps every bank written before this file existed playable.

export const LESSONS_STREAM = 'lessons';
export const LESSON_TOPIC = 'lesson/unlocked';   // bus topic — live nudge
export const WATCHED_KIND = 'watched';

// Seed topics. Videos are per-profile data; these carry no video until someone points them
// at one, and a topic with no video unlocks on the honour button alone.
export const DEFAULT_TOPICS = [
  { id: 'roots',      label: 'Word roots & origins', subject: 'English language arts',
    blurb: 'Where words come from, and how knowing that lets you guess a new one.' },
  { id: 'concision',  label: 'Saying it in fewer words', subject: 'English language arts',
    blurb: 'Why the short sentence usually wins.' },
  { id: 'punctuation', label: 'Commas that change meaning', subject: 'English language arts',
    blurb: 'Comma splices, and the ones that actually matter.' },
];

// ---------- pure ----------

export function watchedEvents(events) {
  return (events || []).filter((e) => e && e.kind === WATCHED_KIND && e.data && e.data.topic);
}

// The set of topic ids that have been unlocked.
export function unlockedFrom(events) {
  return new Set(watchedEvents(events).map((e) => e.data.topic));
}

// When each was unlocked — the transcript view.
export function unlockLog(events) {
  const seen = new Map();
  for (const e of watchedEvents(events)) {
    if (!seen.has(e.data.topic)) seen.set(e.data.topic, e.created_at);   // first time counts
  }
  return [...seen.entries()].map(([topic, at]) => ({ topic, at }));
}

// Split content into what's playable now and what's still behind a lesson.
//
// The rule that keeps this from breaking existing banks: an item with no `topic` is
// ALWAYS available. Gating is opt-in per item, not a wall that drops in front of
// everything the moment this feature exists.
export function gate(items, unlocked) {
  const open = [], locked = [];
  for (const it of items || []) {
    const t = it && it.topic;
    if (!t || (unlocked && unlocked.has(t))) open.push(it);
    else locked.push(it);
  }
  return { open, locked };
}

// Which topics are still holding content back — so a game can say "3 more words are
// waiting behind Word roots" instead of silently having a shorter deck.
export function lockedTopics(items, unlocked, topics = []) {
  const counts = new Map();
  for (const it of gate(items, unlocked).locked) {
    counts.set(it.topic, (counts.get(it.topic) || 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({
    id, count, label: (topics.find((t) => t.id === id) || {}).label || id,
  })).sort((a, b) => b.count - a.count);
}

// ---------- the handle ----------

export function createLessons({ makeEvents, bus = null, limit = 500, pollMs = 4000 } = {}) {
  if (typeof makeEvents !== 'function') throw new Error('createLessons: ctx.makeEvents is required');
  const stream = makeEvents(LESSONS_STREAM, { limit, pollMs });

  // Watching again is harmless — the log keeps both, the unlocked set is a set.
  async function watch(topic, { label = '', subject = '' } = {}) {
    if (!topic) return null;
    const data = { topic: String(topic), label: String(label || ''), subject: String(subject || '') };
    await stream.append(WATCHED_KIND, data);
    if (bus) bus.publish(LESSON_TOPIC, data);
    return data;
  }

  return {
    watch,
    load: () => stream.load(),
    startPolling: () => stream.startPolling(),
    subscribe: (fn) => stream.subscribe(fn),
    get: () => stream.get(),
    unlocked: () => unlockedFrom(stream.get().events || []),
    log: () => unlockLog(stream.get().events || []),
    destroy: () => stream.destroy(),
  };
}
