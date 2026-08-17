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
import { createLessons, DEFAULT_TOPICS, LESSON_TOPIC } from '../lessons.js';

export const DEFAULTS = { minWatchSec: 30 };

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
  { type: 'lessons', title: 'Lessons', description: 'watch a lesson to unlock its questions' },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());

    let lessons = null;
    let topics = DEFAULT_TOPICS;
    let cfg = { ...DEFAULTS };
    let openId = null;        // the topic whose lesson is showing
    let openedAt = 0;
    let ticker = null;

    const el = (sel) => mount.querySelector(sel);
    const unlocked = () => (lessons ? lessons.unlocked() : new Set());
    const waited = () => Math.max(0, Math.floor((now() - openedAt) / 1000));
    const remaining = () => Math.max(0, cfg.minWatchSec - waited());

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
              ${videoHTML(t.video) || '<p class="l-none">No video attached to this topic yet.</p>'}
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
      el('[data-count]').textContent = topics.length
        ? `${n} of ${topics.length} unlocked`
        : 'No topics yet — add some in this module’s settings.';
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
          await lessons.watch(t.id, { label: t.label, subject: t.subject })
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
            <div class="l-list" data-list></div>
          </div>`;

        lessons = createLessons({ makeEvents: ctx.makeEvents, bus });
        lessons.subscribe(() => render());
        lessons.load().then(() => lessons.startPolling()).catch(() => {});

        // Another device unlocked something — reflect it.
        bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });

        state.subscribe((s) => {
          const snap = s || {};
          topics = Array.isArray(snap.topics) && snap.topics.length ? snap.topics : DEFAULT_TOPICS;
          cfg = { minWatchSec: Number(snap.minWatchSec) >= 0 ? Number(snap.minWatchSec) : DEFAULTS.minWatchSec };
          render();
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
