// lessons.js (module) — the LEVEL-UP screen: watch a lesson, unlock its questions.
//
// Each topic is a card. Locked ones say what's waiting behind them; watching the lesson
// unlocks it, and from then on that topic's words are in the game's pool. The unlock is
// appended to the `lessons` stream (see ../lessons.js) so it can't be lost or undone by a
// concurrent save on another device.
//
// ABOUT THE "I'VE WATCHED IT" BUTTON. There is no reliable way to know a video was
// actually absorbed, and gating on elapsed seconds would be exactly the time-serving this
// curriculum is built to avoid. So the button is a light nudge, not a lock: it enables
// after `minWatchSec` with the remaining count shown, and the REAL check is downstream —
// unlocking puts the questions in play, and getting them wrong is visible in progress.
// Skipping the video only means facing the questions without it.

import { registerModule } from '../module.js';
import { readWithLegacy } from '../settings_fields.js';
import { createLessons, DEFAULT_TOPICS, LESSON_TOPIC } from '../lessons.js';
import { loadPack } from '../packs.js';
import { packsFor, packById } from '../pack_library.js';

// `minWatchMs` is milliseconds - the house rule for every stored duration. It was
// `minWatchSec`; the key changed rather than the meaning of the old one. The countdown a
// person READS is still in seconds, which is the point of the rule: store one unit, display
// the one a human thinks in.
export const DEFAULTS = {
  minWatchMs: 30000,
  // *** THE VIDEO-SELECTION MECHANISM (change list §3), MIRRORING WORD FORGE'S OWN
  // contentSource/packId RATHER THAN A SECOND ONE. *** The gap this closes, named in this
  // file's own header until now: a topic's video lived in `state.topics[]` per topic, and
  // "choosing videos needs a small editor... or the shared content source this keeps
  // arriving at from every direction." `packs.js` already validates a `lesson`-kind pack
  // (topic + optional video + optional questions) — it was declared and unconsumed. This is
  // the consuming half. `bank` (unchanged) stays the default; `pack` is for somebody with no
  // topics of their own written yet.
  contentSource: 'bank',
  packId: packsFor('lesson')[0]?.id || null,
};
const LEGACY_MIN_WATCH = { key: 'minWatchSec', scale: 1000 };
const LESSON_PACKS = packsFor('lesson');

// `it.questions` (trivia-shaped, per the schema) is deliberately NOT read here. Wiring a
// lesson's own questions into Trivia's or Word Forge's pool is the SAME "per-module
// decision" packs.js's own header already declines to make on any consumer's behalf, and
// stacking that decision onto this pass would answer a bigger, separate question (does an
// unlocked lesson's content feed one pool, both, or neither) that nobody has been asked yet.
// A pack's `questions` still validates and loads correctly; nothing here reads it.
//
// `id` IS SYNTHESIZED FROM THE TOPIC TEXT, NOT FROM POSITION, and that is load-bearing. The
// schema carries no `id` field — only `topic`, `video`, `questions` — but `topics[].id` is
// what an unlock event names forever (`lessons.watch(t.id, ...)`, an append-only stream).
// An index-based id would silently re-identify every already-unlocked topic the moment a
// pack's item order changes — reordering a JSON file is not supposed to un-earn anything.
// Slugging the topic text keeps the id stable across reordering, as long as the topic's own
// wording does not change (renaming a topic changing its id is the same tradeoff `packById`
// already accepts for a pack's own `id` field, one level up).
function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'topic';
}

export function packToTopics(pack) {
  return (pack.items || []).map((it) => ({
    id: slugify(it.topic),
    label: it.topic,
    video: it.video ? { kind: 'url', value: it.video } : null,
  }));
}

// Module-scope, not per-instance — two Lessons panels on the same screen reading the same
// pack should share one fetch, same as Word Forge's own `loadPackCached`.
const packCache = new Map();
function loadPackCached(id) {
  if (packCache.has(id)) return packCache.get(id);
  const entry = packById(id);
  const p = entry ? loadPack(entry.url) : Promise.reject(new Error(`no such pack: ${id}`));
  // A failed fetch is not cached — a network blip should not permanently doom every
  // instance that asks for this pack for the rest of the page's life.
  p.catch(() => packCache.delete(id));
  packCache.set(id, p);
  return p;
}

// ---------------------------------------------------------------------------------------
// *** IT DECLARED NO SETTINGS, AND ITS OWN EMPTY-STATE COPY USED TO POINT AT THE MENU. ***
// ---------------------------------------------------------------------------------------
//
// That was G12: the "no topics" line said *"add some in this module's settings"* and this
// module declares none, so it sent somebody looking for a panel that was never built. The copy
// was fixed then; the missing panel was not, and `minWatchMs` has been live config that no
// surface could reach ever since.
//
// *** VIDEO SELECTION, CLOSED 2026-09-16 \u2014 BY A PACK, NOT AN EDITOR. ***
//
// Chat: Lessons *"says no video chosen and does not say where to choose one."* A topic's video
// lives in `state.topics[]` as `{kind, value}` PER TOPIC, and a list of objects was never going
// to be one settings row \u2014 a `videoUrl` row could only ever set the first topic's video, a
// control that lies about what it does. The two live options this file's own comment already
// named were a bespoke per-topic editor (the `board_editor.js` shape) or "the shared content
// source this keeps arriving at from every direction" \u2014 a `lesson`-kind pack was already
// declared and validated in `packs.js`, unconsumed by anything. This is that consuming half,
// mirroring Word Forge's own `contentSource`/`packId` rather than inventing a second mechanism
// for the same idea. A pack supplies topic + video (and optionally per-topic questions this
// file does not read \u2014 see `packToTopics`'s own note) ready-made; a caregiver with topics of
// their own still writes `state.topics[]` directly via `contentSource: 'bank'`, unchanged.
const SETTINGS = [
  // ESSENTIAL, and it is the only knob that changes what a person is asked to DO here: how long
  // the unlock button stays disabled after a lesson is opened. Too long and somebody who
  // genuinely watched is told to wait; too short and the honour button means nothing.
  { key: 'minWatchMs', label: 'Wait before the unlock button works', kind: 'choice',
    default: 30000, level: 'essential',
    options: [
      { value: 0,      label: 'No wait \u2014 trust them' },
      { value: 15000,  label: '15 seconds' },
      { value: 30000,  label: '30 seconds' },
      { value: 120000, label: 'Two minutes' },
    ],
    note: 'Unlocking a topic puts its questions into the game whether or not a video was '
      + 'watched, so this is a nudge rather than a gate.' },
  ...(LESSON_PACKS.length ? [
    { key: 'contentSource', label: 'Where topics come from', kind: 'choice', default: 'bank',
      level: 'standard',
      options: [{ value: 'bank', label: 'Written topics' },
                { value: 'pack', label: 'A built-in pack' }],
      note: 'A pack is ready-made, video included where one exists \u2014 nobody has to write '
        + 'topics or find videos first.' },
    { key: 'packId', label: 'Which pack', kind: 'choice', default: LESSON_PACKS[0].id,
      level: 'standard',
      options: LESSON_PACKS.map((p) => ({ value: p.id, label: p.label })) },
  ] : []),
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A topic's video, as an embeddable element. YouTube ids become a privacy-mode embed;
// a plain url becomes a <video>. No video at all is fine — the card still unlocks.
export function videoHTML(video) {
  if (!video || !video.value) return '';
  if (video.kind === 'youtube') {
    return `<iframe class="l-video" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.value)}"
      title="lesson video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  return `<video class="l-video" src="${esc(video.value)}" controls playsinline></video>`;
}

registerModule(
    // `network`, not `server`, and the distinction is the point of having both. MEASURED
    // 2026-09-05 with every handle rejecting: it still renders its list, gating and titles from
    // the built-in defaults - 284 characters of real content, better than any other content
    // module degraded. **But a lesson IS a video, and the videos are YouTube embeds** (see
    // `videoEl` above). So the platform being down leaves it useful and the INTERNET being down
    // leaves it a list of things it cannot play. That is exactly what `network` means, and
    // calling it `server` would have understated how well it survives a platform outage.
  { type: 'lessons', title: 'Lessons',
    dependsOn: 'network', description: 'Watch a short lesson, then answer questions about it',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());

    let lessons = null;
    let topics = DEFAULT_TOPICS;
    let cfg = { ...DEFAULTS };
    let openId = null;        // the topic whose lesson is showing
    let openedAt = 0;
    let ticker = null;
    // Guards against a stale pack fetch landing after a NEWER settings change (switch to a
    // different pack, or back to written topics) already superseded it — same shape as
    // Word Forge's own `wordGen`.
    let topicsGen = 0;

    const el = (sel) => mount.querySelector(sel);
    const unlocked = () => (lessons ? lessons.unlocked() : new Set());
    const waited = () => Math.max(0, Math.floor((now() - openedAt) / 1000));
    const remaining = () => Math.max(0, Math.ceil(cfg.minWatchMs / 1000) - waited());

    // Written topics resolve synchronously; a pack needs a fetch, so this is async either
    // way and guarded by `topicsGen` the same way Word Forge guards `resolveWords` — a
    // settings change mid-fetch (switch packs, or switch back to written topics) must not
    // have an in-flight older fetch land last and silently win.
    async function resolveTopics(snap) {
      const gen = ++topicsGen;
      if (cfg.contentSource === 'pack' && cfg.packId) {
        try {
          const pack = await loadPackCached(cfg.packId);
          if (gen !== topicsGen) return;           // superseded while the fetch was in flight
          const fromPack = packToTopics(pack);
          topics = fromPack.length ? fromPack : DEFAULT_TOPICS;
          render();
          return;
        } catch (err) {
          console.error(`lessons: pack "${cfg.packId}" failed to load, falling back to written topics`, err);
          // fall through — an unreachable pack reads as no topics chosen, not a dead panel
        }
      }
      if (gen !== topicsGen) return;
      topics = Array.isArray(snap.topics) && snap.topics.length ? snap.topics : DEFAULT_TOPICS;
      render();
    }

    function card(t) {
      const isOpen = openId === t.id;
      const done = unlocked().has(t.id);
      return `
        <section class="l-card${done ? ' is-done' : ''}">
          <div class="l-head">
            <div>
              <h3>${esc(t.label)}${done ? '<span class="l-badge">unlocked</span>' : ''}</h3>
              ${t.blurb ? `<p class="l-blurb">${esc(t.blurb)}</p>` : ''}
            </div>
            <button class="l-btn${done ? '' : ' l-primary'}" data-open="${esc(t.id)}">
              ${isOpen ? 'Close' : (done ? 'Watch again' : 'Start lesson')}
            </button>
          </div>
          ${isOpen ? `
            <div class="l-body">
              ${videoHTML(t.video) || `<p class="l-none">No video has been chosen for
                <b>${esc(t.label)}</b> yet. Unlocking still puts its questions in the game.</p>`}
              <div class="l-actions">
                <button class="l-btn l-primary" data-watched="${esc(t.id)}" ${remaining() ? 'disabled' : ''}>
                  ${done ? 'Already unlocked' : 'I’ve watched it — unlock the questions'}
                </button>
                ${remaining() ? `<span class="l-wait">available in ${remaining()}s</span>` : ''}
              </div>
            </div>` : ''}
        </section>`;
    }

    function render() {
      const host = el('[data-list]');
      if (!host) return;
      const n = unlocked().size;
      // *** SAY "NOT FINISHED YET" ONCE, AT THE TOP, RATHER THAN "BROKEN" ON EVERY CARD. ***
      //
      // G12, Mike off the live site: Lessons *"renders as broken rather than unfinished to
      // anybody who lands on it."* He is right, and both halves of why were copy:
      //
      //   * every opened card said "No video attached to this topic yet", which reads as a
      //     card that failed to load rather than a card nobody has filled in; and
      //   * the empty-topics line said "add some in this module's settings" — and this module
      //     DECLARES NO SETTINGS, so it pointed at a panel that does not exist. That is the
      //     same shape as A14, and a sentence sending somebody to look for a control that was
      //     never built is worse than saying nothing.
      //
      // What is true, and is now what it says: the topics ship with no videos chosen, and the
      // cards still do their real job — unlocking a topic puts its questions into the game
      // whether or not a video was watched, which is stated at the top of this file as a
      // deliberate design decision rather than a gap.
      const noVideos = topics.length && topics.every((t) => !(t.video && t.video.value));
      const note = el('[data-unfinished]');
      if (note) {
        note.hidden = !noVideos;
        note.textContent = 'No lesson videos have been chosen yet. The topics below still '
          + 'work: unlocking one puts its questions into the game.';
      }
      el('[data-count]').textContent = topics.length
        ? `${n} of ${topics.length} unlocked`
        : 'No topics on this screen yet.';
      host.innerHTML = topics.map(card).join('');

      for (const b of host.querySelectorAll('[data-open]')) {
        b.addEventListener('click', () => {
          const id = b.dataset.open;
          openId = openId === id ? null : id;
          openedAt = now();
          render();
        });
      }
      for (const b of host.querySelectorAll('[data-watched]')) {
        b.addEventListener('click', async () => {
          const t = topics.find((x) => x.id === b.dataset.watched);
          if (!t) return;
          b.disabled = true;
          // How long the card stayed open before she pressed it — `openedAt` is stamped the
          // moment the card opens, above, already, for the countdown. This was the missing
          // half: the number existed on screen (`remaining()`'s countdown reads off it) and
          // was never carried into the durable record. See lessons.js's own note on why this
          // is NOT a reaction-time test the way board's or call's latency is — the minimum
          // wait is a stated nudge, not a gate — recorded anyway as real engagement time, the
          // same spirit as board.js's own header: it measures, and shows her nothing about it.
          // This button only ever exists in the DOM for the currently-open card (see `card`
          // above), so `openId === t.id` is already guaranteed here, not re-checked.
          const latencyMs = Math.max(0, now() - openedAt);
          await lessons.watch(t.id, { label: t.label, subject: t.subject, latencyMs })
            .catch((e) => console.error('lessons: watch', e));
          openId = null;
          render();
        });
      }
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="lessons">
            <div class="l-top"><span data-count></span></div>
            <p class="l-unfinished" data-unfinished hidden></p>
            <div class="l-list" data-list></div>
          </div>`;

        lessons = createLessons({ makeEvents: ctx.makeEvents, bus });
        lessons.subscribe(() => render());
        lessons.load().then(() => lessons.startPolling()).catch(() => {});

        // Another device unlocked something — reflect it.
        bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });

        state.subscribe((s) => {
          const snap = s || {};
          const saved = readWithLegacy(snap, 'minWatchMs', LEGACY_MIN_WATCH);
          cfg = {
            minWatchMs: Number(saved) >= 0 ? Number(saved) : DEFAULTS.minWatchMs,
            contentSource: snap.contentSource === 'pack' ? 'pack' : DEFAULTS.contentSource,
            packId: typeof snap.packId === 'string' && snap.packId ? snap.packId : DEFAULTS.packId,
          };
          resolveTopics(snap);
        });

        // Re-render while a lesson is open so the countdown ticks down.
        ticker = setInterval(() => { if (openId && remaining()) render(); }, 1000);
        render();
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() {
        if (ticker != null) { clearInterval(ticker); ticker = null; }
        if (lessons) { lessons.destroy(); lessons = null; }
      },
    };
  },
);
