// Clock — the first default-dashboard module (slice 3a).
//
// Display-only orientation for a disoriented patient: a large time, the weekday +
// part-of-day ("Tuesday afternoon"), and the date. No inputs, no media, no events.
// Its job in the build order is to establish the default-module + settings-UI
// convention: preferences live in OVERWRITE state, keyed per (user, profile,
// instance), so they persist and travel with the profile.

import { registerModule } from '../module.js';

const DEFAULTS = { hour12: true, seconds: false, showDate: true, size: 'm', tz: '' };
const ZONES = [
  ['', 'Device'],
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Los_Angeles', 'Pacific'],
  ['UTC', 'UTC'],
];

// THE PRE-DAWN HOURS GET THEIR OWN NAME, and this is not cosmetic. This module's whole
// job is orienting someone who is disoriented, and at 4:33am it used to read "Monday
// night" — which to anyone reading it means about ten in the evening. Wrong by twenty
// hours, on the one panel whose only purpose is being right about this.
//
// Saying "Monday early morning" is unambiguous: it is genuinely Monday, and "early"
// cannot be mistaken for the evening.
//
// NOT SHARED WITH daypart.js ON PURPOSE. That file schedules content and its bands are
// one real household’s rhythm (morning starts at 6, sleepytime at 21); these bands are how a person
// would describe the hour out loud. Same clock, two different questions, and forcing one
// answer would make one of them wrong.
function partOfDay(hour) {
  if (hour < 5) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function fmt(cfg, now) {
  const zone = cfg.tz ? { timeZone: cfg.tz } : {};
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: cfg.hour12,
    ...(cfg.seconds ? { second: '2-digit' } : {}), ...zone,
  }).format(now);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', ...zone }).format(now);
  const date = new Intl.DateTimeFormat(undefined,
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...zone }).format(now);
  // 0–23 hour in the chosen zone, for part-of-day.
  const h = parseInt(new Intl.DateTimeFormat('en-US',
    { hour: 'numeric', hour12: false, ...zone }).format(now), 10) % 24;
  // *** THE WEEKDAY IS SAID ONCE, NOT TWICE. ***
  //
  // Mike, 2026-09-02: *"How many times have I said to lose the wednesday morning?!? There's only
  // a few words there and 2 of them are the day of the week."* On screen it read
  //
  //     1:30 AM  /  Wednesday Early Morning  /  Wednesday, September 2, 2026
  //
  // — three lines, and the same word opening two of them. On the one panel whose entire job is
  // orienting somebody, half the words were spent repeating themselves.
  //
  // This is a REPEAT correction. It was not written down the previous times, which is why it
  // came back; it is in `DECISIONS.md` now.
  //
  // The pre-dawn argument above is untouched and still load-bearing: "early morning" is here so
  // that 4:33am cannot read as the evening. What goes is the duplicated weekday — and only when
  // the date line is actually showing it. With `showDate` off there is nothing else naming the
  // day, so this line keeps it rather than leaving a disoriented person with "early morning" and
  // no idea which one.
  const when = cfg.showDate ? partOfDay(h) : `${weekday} ${partOfDay(h)}`;
  return { time, when, date };
}

registerModule(
  // FALLBACK EXPOSURE. A clock needs nothing but the browser - but Mike's point stands:
  // *"even clock can have a fail state if the time/date isn't right."* There is no safe
  // module, only a least-exposed one, which is why the vocabulary is `dependsOn` rather than
  // `cannotFail`. This makes it a good LAST RESORT, not a guarantee.
  { dependsOn: 'none',
    type: 'clock', title: 'Clock', description: 'The time, the day and the date — for somebody who has lost track of all three' },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = { ...DEFAULTS };
    let timer = null;

    function paint() {
      const now = new Date();
      const { time, when, date } = fmt(cfg, now);
      const root = mount.querySelector('.clock');
      if (!root) return;
      root.dataset.size = cfg.size;
      mount.querySelector('[data-time]').textContent = time;
      mount.querySelector('[data-when]').textContent = when;
      const dateEl = mount.querySelector('[data-date]');
      dateEl.textContent = date;
      dateEl.hidden = !cfg.showDate;
    }

    // Reflect saved config into the controls (only when config changes, so a live
    // tick never clobbers a control the user is interacting with).
    function syncControls() {
      mount.querySelectorAll('[data-opt]').forEach((el) => {
        const key = el.dataset.opt;
        if (el.type === 'checkbox') el.checked = !!cfg[key];
        else el.value = cfg[key];
      });
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="clock" data-size="m">
            <div class="time" data-time>—</div>
            <div class="when" data-when></div>
            <div class="date" data-date></div>
            <button class="gear" data-gear aria-label="clock settings">⚙</button>
            <div class="settings" data-settings hidden>
              <label><input type="checkbox" data-opt="hour12"> 12-hour</label>
              <label><input type="checkbox" data-opt="seconds"> seconds</label>
              <label><input type="checkbox" data-opt="showDate"> date</label>
              <label>size
                <select data-opt="size"><option value="s">S</option><option value="m">M</option><option value="l">L</option></select>
              </label>
              <label>zone
                <select data-opt="tz">${ZONES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
              </label>
            </div>
          </div>`;

        mount.querySelector('[data-gear]').addEventListener('click', () => {
          const s = mount.querySelector('[data-settings]');
          s.hidden = !s.hidden;
        });

        // Each control writes its key into overwrite state (versioned, per profile).
        mount.querySelectorAll('[data-opt]').forEach((el) => {
          el.addEventListener('change', () => {
            const key = el.dataset.opt;
            const value = el.type === 'checkbox' ? el.checked : el.value;
            state.set({ [key]: value });
          });
        });

        // Server is the source of truth: adopt saved config (own writes, first
        // load, or another device via the poller), then repaint.
        state.subscribe((s) => {
          cfg = { ...DEFAULTS, ...s };
          syncControls();
          paint();
        });

        paint();
        timer = setInterval(paint, 1000);
      },
      onResize() {},
      onHide() {},
      destroy() { clearInterval(timer); timer = null; },
    };
  },
);
