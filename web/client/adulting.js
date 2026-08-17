// adulting.js — the ADULTING tab: your own points board, for anyone, without opening a
// screen on a display.
//
// The quest board started as a homeschool mechanic, but the mechanic isn't a child's:
// chores, habits, money, and the small daily things you mean to do and don't. So it gets
// a tab of its own in home, and every account has one.
//
// This mounts the REAL `quests` module — not a copy of it. Same catalog, same append-only
// ledger, same balance a kiosk-mounted board would show. What makes it "yours" is the
// PROFILE it's pointed at: boards are per-profile, so two people on one account keep
// entirely separate points, and an adult's catalog (cigarettes, groceries, the gym) has
// nothing to do with a twelve-year-old's.
//
// The module instance lives under a well-known state key rather than a profile module id,
// because it isn't part of any screen's layout — it's a page. Its ledger is the profile's
// shared `points` stream either way, so points logged here and points logged on a screen
// are the same points.

import { mountModule } from './module.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Its own state key, namespaced so it can never collide with a module instance id
// (those are 32-hex; this isn't).
export const BOARD_KEY = 'adulting-board';

export function mountAdulting(root, {
  profiles, bus, user, makeState, makeEvents, initialProfileId = null,
} = {}) {
  let list = [];
  let current = null;
  let instance = null;
  let state = null;
  let events = null;

  root.innerHTML = `
    <div class="adulting">
      <h1>Adulting</h1>
      <p class="a-lead">Your points board. Log what you did, spend what you earned. Every
        profile keeps its own — yours is yours.</p>
      <div class="a-who" data-who></div>
      <div class="a-board" data-board><p class="a-note">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  function renderWho() {
    el('[data-who]').innerHTML = list.length
      ? list.map((p) =>
          `<button class="a-chip${current && p.id === current.id ? ' on' : ''}" data-who-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')
      : '<span class="a-note">No profiles yet — make one on the Screens tab.</span>';
  }

  function teardown() {
    if (instance) { try { instance.destroy(); } catch (e) { console.error(e); } instance = null; }
    if (state) { state.destroy(); state = null; }
    if (events) { events.destroy(); events = null; }
  }

  async function select(pid) {
    const p = list.find((x) => x.id === pid);
    if (!p) return;
    current = p;
    renderWho();
    teardown();

    const board = el('[data-board]');
    board.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'a-host';
    board.append(host);

    state = makeState(`${BOARD_KEY}:${p.id}`);
    events = makeEvents(`${BOARD_KEY}:${p.id}`);
    await state.load().catch(() => {});

    instance = mountModule('quests', {
      mount: host, bus, state, events, user, profileId: p.id,
      makeState: (key, opts) => makeState(key, opts, p.id),
      makeEvents: (key, opts) => makeEvents(key, opts, p.id),
    });
    instance.init();
    state.startPolling();
  }

  async function refresh() {
    list = await profiles.list();
    renderWho();
    const target = (current && list.find((p) => p.id === current.id))
      || list.find((p) => p.id === initialProfileId) || list[0];
    if (target) await select(target.id);
    else el('[data-board]').innerHTML = '<p class="a-note">Make a profile first, then your board appears here.</p>';
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-who-id]');
    if (b) select(b.dataset.whoId);
  });

  return { refresh, select, current: () => current, destroy: teardown };
}
