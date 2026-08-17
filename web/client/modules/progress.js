// progress.js — the PROGRESS dashboard: the consumer end of the points ledger.
//
// Every point source (the sprint timer, and every learning game after it) appends to one
// shared, profile-scoped `points` stream. This module is what reads it back: the balance,
// what was earned and spent, the school hours logged this week, the task catalog you earn
// from, and the reward store you spend into.
//
// It is modelled directly on the points-tracker spreadsheet the household already uses —
// Task Menu, Daily Log, Rewards Store, Weekly Hours, Dashboard — so the two stay
// portable in both directions and the spreadsheet can remain the family-readable mirror.
//
// THE LEDGER IS THE RECORD, AND IT IS APPEND-ONLY. Nothing here edits or deletes a past
// entry, because the whole point of a points game is that the score can't be quietly
// rewritten. Logging a task appends; buying a reward appends a NEGATIVE entry. A mistake
// is corrected by logging its opposite, which stays visible in the log.
//
// TWO ENGINES, NEVER DOUBLE-COUNTED. Discrete tasks pay per event. School TIME pays ~1
// point per focused minute, once, when a sprint finishes — and each of those events also
// records its `minutes`, so the weekly x1 / x1.5 stretch / x2 overtime banding can be
// paid later as a TOP-UP on the stretch/overtime portion only. Until that lands, this
// module SHOWS the band and says the top-up is unpaid rather than implying it was paid.
//
// CONTENT-AS-MEANING. The task catalog and the reward store are DATA in per-profile
// state, not code — seeded below from the spreadsheet, editable per profile, and a learner
// modding them is itself part of the curriculum. Colour and voice come from the theme.
//
// TESTABILITY: ctx.now() is injectable (default Date.now), like sprint.js.

import { registerModule } from '../module.js';
import {
  createPointsLedger, POINTS_TOPIC, pointsValue, sumEarned, sumSpent, sumMinutes, weekStart,
} from '../points.js';

export const SOURCE = 'progress';

// Seeded from the points-tracker's "Task Menu" tab. `double` = eligible for the x2
// multiplier (helping family / doing it for Mom). Negative base = a penalty.
export const DEFAULT_TASKS = [
  { task: 'Clean the litter box',        type: 'Obligatory', base: 5,   double: false, note: 'opt-in, then required' },
  { task: 'Do the dishes',               type: 'Bonus',      base: 15,  double: false, note: 'anytime, no penalty' },
  { task: 'Take out garbage & recycling', type: 'Bonus',     base: 8,   double: false, note: '' },
  { task: 'Cook a real meal',            type: 'Bonus',      base: 15,  double: false, note: 'more than pouring cereal' },
  { task: 'Scan & tag a photo',          type: 'Bonus',      base: 1,   double: true,  note: '~1 per photo; doubles for Mom' },
  { task: "Look up a word's meaning",    type: 'Bonus',      base: 2,   double: false, note: 'curiosity pays' },
  { task: 'Pitch a good project idea',   type: 'Idea',       base: 5,   double: false, note: 'must be a real idea' },
  { task: 'Help someone at the facility', type: 'Bonus',     base: 1,   double: true,  note: 'log actual minutes as base' },
  { task: 'Bike ride / walk',            type: 'Bonus',      base: 30,  double: false, note: 'offsets screen time' },
  { task: 'Guild Game session (host it)', type: 'Obligatory', base: 60, double: true,  note: 'weekly commitment' },
  { task: 'Mow the lawn',                type: 'Obligatory', base: 60,  double: false, note: 'higher-trust job' },
  { task: 'Missed a mandatory task',     type: 'Penalty',    base: -40, double: false, note: "lose what you'd have earned" },
];

// Seeded from the "Rewards Store" tab. Needs cost fewer points per dollar than wants.
export const DEFAULT_REWARDS = [
  { reward: 'Treat out (bike there)',        kind: 'Want', cost: 50,  note: '' },
  { reward: 'Screen time — 1 hr, solo',      kind: 'Want', cost: 60,  note: 'free with a real-life friend' },
  { reward: 'Screen time — 1 hr, w/ friend', kind: 'Want', cost: 30,  note: 'half price' },
  { reward: 'Movie night — you pick',        kind: 'Want', cost: 40,  note: '' },
  { reward: 'A new video game',              kind: 'Want', cost: 800, note: 'wants cost more per dollar' },
  { reward: 'Clothes ($20)',                 kind: 'Need', cost: 150, note: 'needs cost fewer per dollar' },
  { reward: 'A day off',                     kind: '—',    cost: 200, note: 'plus banked stretch hours' },
];

// The "Weekly Hours" tab's X / Y / Z.
export const DEFAULT_HOURS = { hoursPerDay: 4, schoolDays: 5, stretchHours: 5 };

// ---------- pure helpers ----------

export function weeklyTarget(h = DEFAULT_HOURS) {
  const x = Number(h.hoursPerDay) || DEFAULT_HOURS.hoursPerDay;
  const y = Number(h.schoolDays) || DEFAULT_HOURS.schoolDays;
  const z = Number(h.stretchHours) || DEFAULT_HOURS.stretchHours;
  return { base: x * y, target: x * y + z };
}

// Which weekly band the logged hours land in. `topUp` is the EXTRA the banding would owe
// beyond the base rate already paid per sprint: stretch hours earn a further 0.5x and
// overtime a further 1.0x. Reported, not yet paid — see the module header.
export function hoursBand(hours, h = DEFAULT_HOURS, pointsPerHour = 60) {
  const { base, target } = weeklyTarget(h);
  const hrs = Math.max(0, Number(hours) || 0);
  const baseHrs = Math.min(hrs, base);
  const stretchHrs = Math.min(Math.max(hrs - base, 0), Math.max(target - base, 0));
  const overHrs = Math.max(hrs - target, 0);
  const label = overHrs > 0 ? 'overtime (x2 zone)' : stretchHrs > 0 ? 'stretch (x1.5 zone)' : 'base';
  return {
    baseHrs, stretchHrs, overHrs, label, target,
    topUp: Math.round((stretchHrs * 0.5 + overHrs * 1.0) * pointsPerHour),
  };
}

export function fmtHours(hours) {
  const h = Math.max(0, Number(hours) || 0);
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- the module ----------

registerModule(
  { type: 'progress', title: 'Progress', description: 'points balance, tasks, rewards — reads the shared ledger' },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());

    let ledger = null;
    let tasks = DEFAULT_TASKS;
    let rewards = DEFAULT_REWARDS;
    let hoursCfg = { ...DEFAULT_HOURS };
    let pointsPerHour = 60;
    let tab = 'tasks';
    let doubling = false;         // the x2 toggle, only offered on double-eligible tasks
    let pendingBuy = null;        // index of a reward awaiting its confirm tap
    let flash = '';

    const el = (sel) => mount.querySelector(sel);
    const events = () => (ledger ? ledger.events() : []);

    // ---- actions (both APPEND; nothing is ever edited) ----

    async function logTask(i) {
      const t = tasks[i];
      if (!t) return;
      const mult = doubling && t.double ? 2 : 1;
      const res = await ledger.award({
        amount: Number(t.base) || 0,
        mult,
        type: t.type,
        source: SOURCE,
        tags: ['task'],
        note: t.task,
      }).catch((err) => { console.error('progress: log failed', err); return null; });
      flash = res
        ? (res.value >= 0 ? `+${res.value} — ${t.task}` : `${res.value} — ${t.task}`)
        : 'Could not save that — try again.';
      doubling = false;
      render();
    }

    // Two taps to buy: one misclick should not cost 800 points.
    async function buy(i) {
      const r = rewards[i];
      if (!r) return;
      if (pendingBuy !== i) { pendingBuy = i; flash = `Tap again to confirm — ${r.reward}`; render(); return; }
      pendingBuy = null;
      const res = await ledger.spend({ amount: r.cost, source: SOURCE, tags: ['reward'], note: r.reward })
        .catch((err) => { console.error('progress: buy failed', err); return null; });
      flash = res ? `Bought ${r.reward} — ${r.cost} points` : 'Could not save that — try again.';
      render();
    }

    // ---- render ----

    function renderHeader() {
      const evs = events();
      const balance = evs.reduce((n, e) => n + pointsValue(e), 0);
      const hrs = sumMinutes(evs, weekStart(now())) / 60;
      const band = hoursBand(hrs, hoursCfg, pointsPerHour);
      const pct = band.target ? Math.min(100, Math.round((hrs / band.target) * 100)) : 0;

      el('[data-balance]').textContent = String(balance);
      el('[data-earned]').textContent = String(sumEarned(evs));
      el('[data-spent]').textContent = String(sumSpent(evs));
      el('[data-hours]').textContent = `${fmtHours(hrs)} / ${band.target}h`;
      el('[data-band]').textContent = band.label;
      el('[data-bar]').style.width = `${pct}%`;
      // Say plainly that the banding bonus is not in the balance yet.
      el('[data-topup]').textContent = band.topUp
        ? `stretch/overtime bonus not yet paid: +${band.topUp}`
        : '';
      el('[data-flash]').textContent = flash;
    }

    function renderTasks() {
      const anyDouble = tasks.some((t) => t.double);
      return `
        <div class="p-toolbar">
          ${anyDouble ? `<label class="p-toggle"><input type="checkbox" data-double ${doubling ? 'checked' : ''}> x2 (with family / for Mom)</label>` : ''}
        </div>
        <div class="p-list">
          ${tasks.map((t, i) => `
            <button class="p-item" data-task="${i}" data-kind="${esc(t.type)}">
              <span class="p-item-main">
                <span class="p-item-name">${esc(t.task)}</span>
                ${t.note ? `<span class="p-item-note">${esc(t.note)}</span>` : ''}
              </span>
              <span class="p-item-pts">${t.base >= 0 ? '+' : ''}${esc(t.base)}${t.double ? '<i class="p-x2">x2</i>' : ''}</span>
            </button>`).join('')}
        </div>`;
    }

    function renderRewards(balance) {
      return `
        <div class="p-list">
          ${rewards.map((r, i) => {
            const afford = balance >= r.cost;
            return `
            <button class="p-item" data-buy="${i}" data-kind="${esc(r.kind)}" ${afford ? '' : 'disabled'}>
              <span class="p-item-main">
                <span class="p-item-name">${esc(r.reward)}</span>
                <span class="p-item-note">${esc(r.kind)}${r.note ? ' · ' + esc(r.note) : ''}</span>
              </span>
              <span class="p-item-pts">${pendingBuy === i ? 'confirm?' : '-' + esc(r.cost)}</span>
            </button>`;
          }).join('')}
        </div>`;
    }

    function renderLog() {
      const evs = [...events()].reverse().slice(0, 40);
      if (!evs.length) return `<p class="p-empty">Nothing logged yet. Finish a sprint or tap a task.</p>`;
      return `
        <table class="p-log">
          <thead><tr><th>When</th><th>What</th><th>Base</th><th>x</th><th>Points</th></tr></thead>
          <tbody>
            ${evs.map((e) => {
              const d = e.data || {};
              const when = new Date(e.created_at);
              const stamp = Number.isNaN(when.getTime()) ? '' :
                `${when.getMonth() + 1}/${when.getDate()} ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`;
              const v = pointsValue(e);
              return `<tr data-kind="${esc(d.type || '')}">
                <td>${esc(stamp)}</td>
                <td>${esc(d.note || d.source || '')}<span class="p-src">${esc(d.source || '')}</span></td>
                <td>${esc(d.amount)}</td>
                <td>${esc(d.mult)}</td>
                <td class="${v < 0 ? 'p-neg' : 'p-pos'}">${v >= 0 ? '+' : ''}${v}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }

    function render() {
      if (!mount.querySelector('.progress')) return;
      const balance = events().reduce((n, e) => n + pointsValue(e), 0);

      for (const b of mount.querySelectorAll('[data-tab]')) {
        b.classList.toggle('on', b.dataset.tab === tab);
      }
      el('[data-panel]').innerHTML =
        tab === 'tasks' ? renderTasks() :
        tab === 'rewards' ? renderRewards(balance) :
        renderLog();

      renderHeader();

      const dbl = el('[data-double]');
      if (dbl) dbl.addEventListener('change', (e) => { doubling = e.target.checked; });
      for (const b of mount.querySelectorAll('[data-task]')) {
        b.addEventListener('click', () => logTask(Number(b.dataset.task)));
      }
      for (const b of mount.querySelectorAll('[data-buy]')) {
        b.addEventListener('click', () => buy(Number(b.dataset.buy)));
      }
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="progress">
            <div class="p-head">
              <div class="p-balance"><b data-balance>0</b><span>points</span></div>
              <div class="p-sub">
                <span>earned <b data-earned>0</b></span>
                <span>spent <b data-spent>0</b></span>
              </div>
            </div>
            <div class="p-hours">
              <div class="p-hours-row"><span data-hours>0h / 25h</span><span class="p-band" data-band></span></div>
              <div class="p-track"><i data-bar></i></div>
              <div class="p-topup" data-topup></div>
            </div>
            <div class="p-flash" data-flash></div>
            <div class="p-tabs">
              <button class="p-tab on" data-tab="tasks">Tasks</button>
              <button class="p-tab" data-tab="rewards">Rewards</button>
              <button class="p-tab" data-tab="log">Log</button>
            </div>
            <div class="p-panel" data-panel></div>
          </div>`;

        for (const b of mount.querySelectorAll('[data-tab]')) {
          b.addEventListener('click', () => { tab = b.dataset.tab; pendingBuy = null; flash = ''; render(); });
        }

        ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus });
        ledger.subscribe(() => render());
        ledger.load().then(() => ledger.startPolling()).catch(() => {});

        // THE LIVE NUDGE. Any source publishing `points/award` — the sprint timer, a game,
        // a future companion — refreshes this dashboard immediately instead of at the next
        // poll. We only REFRESH here; we never append, or the points would double-count.
        bus.subscribe(POINTS_TOPIC, () => { ledger.load().catch(() => {}); });

        // A named task can also be logged from anywhere on the bus (a button, a game, an AI).
        bus.subscribe('progress/log', (payload) => {
          const name = typeof payload === 'string' ? payload : payload && payload.task;
          const i = tasks.findIndex((t) => t.task === name);
          if (i >= 0) logTask(i);
        });

        state.subscribe((s) => {
          const snap = s || {};
          tasks = Array.isArray(snap.tasks) && snap.tasks.length ? snap.tasks : DEFAULT_TASKS;
          rewards = Array.isArray(snap.rewards) && snap.rewards.length ? snap.rewards : DEFAULT_REWARDS;
          hoursCfg = {
            hoursPerDay: Number(snap.hoursPerDay) || DEFAULT_HOURS.hoursPerDay,
            schoolDays: Number(snap.schoolDays) || DEFAULT_HOURS.schoolDays,
            stretchHours: Number(snap.stretchHours) || DEFAULT_HOURS.stretchHours,
          };
          pointsPerHour = Number(snap.pointsPerHour) || 60;
          render();
        });

        render();
      },

      onResize() {},
      onHide() { state.flush(); },
      destroy() { if (ledger) { ledger.destroy(); ledger = null; } },
    };
  },
);
