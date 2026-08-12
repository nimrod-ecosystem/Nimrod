// App wiring for the profiles + module-system demo (slice 2).
//
// Boot -> ensure the user has profiles -> render a profile picker -> open the
// active profile by mounting each of its module instances with its own scoped
// bus + per-instance state/events handles. Switching profiles tears the dashboard
// down and rebuilds it. The counter's extra input sources (keyboard, switch) from
// slice 1 still live here — untouched module, proving the bus seam holds.

import { createBus } from './bus.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createProfilesClient } from './profile.js';
import { mountModule, listManifests } from './module.js';
import './modules/clock.js';      // registers 'clock'
import './modules/camera.js';     // registers 'camera'
import './modules/photos.js';     // registers 'photos'
import './modules/counter.js';    // registers 'counter'
import './modules/presslog.js';   // registers 'presslog'

const params = new URLSearchParams(location.search);
const user = params.get('user') || 'dev-user';

const bus = createBus();
const profiles = createProfilesClient({ user });

const dashEl = document.getElementById('dashboard');
const pickerEl = document.getElementById('profile-picker');
const addSelEl = document.getElementById('add-module');
const addBtnEl = document.getElementById('add-module-btn');
const newNameEl = document.getElementById('new-profile-name');
const newBtnEl = document.getElementById('new-profile-btn');

let activeProfileId = null;
let mounted = [];   // [{ instance, state, events }]

// --- seeding (dev harness convenience) -------------------------------------
// Give a brand-new user two profiles so "switch profile swaps the dashboard" is
// visible immediately. Real onboarding replaces this.
async function ensureProfiles() {
  let list = await profiles.list();
  if (list.length === 0) {
    const room = await profiles.create('Room screen');
    await profiles.addModule(room.id, 'clock');
    await profiles.addModule(room.id, 'counter');
    await profiles.addModule(room.id, 'presslog');
    const bedside = await profiles.create('Bedside');
    await profiles.addModule(bedside.id, 'counter');
    list = await profiles.list();
  }
  return list;
}

function renderPicker(list) {
  pickerEl.innerHTML = '';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === activeProfileId) opt.selected = true;
    pickerEl.append(opt);
  }
}

function renderAddMenu() {
  addSelEl.innerHTML = '';
  for (const m of listManifests()) {
    const opt = document.createElement('option');
    opt.value = m.type; opt.textContent = m.title;
    addSelEl.append(opt);
  }
}

function teardown() {
  for (const m of mounted) m.instance.destroy();
  mounted = [];
  dashEl.innerHTML = '';
}

async function openProfile(pid) {
  teardown();
  activeProfileId = pid;
  const profile = await profiles.get(pid);

  for (const mod of profile.modules) {
    const card = document.createElement('section');
    card.className = 'card module';
    const head = document.createElement('div');
    head.className = 'mhead';
    head.innerHTML = `<span class="mtitle"></span><button class="mremove" title="remove from profile">✕</button>`;
    const body = document.createElement('div');
    body.className = 'mbody';
    card.append(head, body);
    dashEl.append(card);

    const state = createState({ url: profiles.stateURL(pid, mod.id), user });
    const events = createEvents({ url: profiles.eventsURL(pid, mod.id), user });
    const instance = mountModule(mod.type, { mount: body, bus, state, events, user, profileId: pid });

    head.querySelector('.mtitle').textContent = instance.manifest.title;
    head.querySelector('.mremove').addEventListener('click', async () => {
      await profiles.removeModule(pid, mod.id);   // removes config; events persist
      openProfile(pid);
    });

    await state.load();
    await events.load();
    instance.init();
    state.startPolling();
    events.startPolling();
    mounted.push({ instance, state, events });
  }
}

pickerEl.addEventListener('change', () => openProfile(pickerEl.value));
addBtnEl.addEventListener('click', async () => {
  if (!activeProfileId) return;
  await profiles.addModule(activeProfileId, addSelEl.value);
  openProfile(activeProfileId);
});
newBtnEl.addEventListener('click', async () => {
  const name = (newNameEl.value || '').trim();
  if (!name) return;
  const p = await profiles.create(name);
  newNameEl.value = '';
  activeProfileId = p.id;
  renderPicker(await profiles.list());
  openProfile(p.id);
});

async function boot() {
  document.querySelectorAll('[data-user-label]').forEach((el) => (el.textContent = user));
  renderAddMenu();
  const list = await ensureProfiles();
  activeProfileId = list[0].id;
  renderPicker(list);
  await openProfile(activeProfileId);
}
boot().catch((err) => console.error('boot failed', err));

// ---------------------------------------------------------------------------
// Slice-1 carry-over: extra input SOURCES for the counter, added at the app layer
// with zero edits to counter.js. They emit onto "counter/delta"; whichever counter
// instance is mounted in the active profile receives them.
const keyboard = bus.createSource('keyboard');
bus.addBinding({
  source: 'keyboard', signal: 'key', topic: 'counter/delta',
  transform: (p) =>
    (p.key === '+' || p.key === 'ArrowUp') ? +1 :
    (p.key === '-' || p.key === 'ArrowDown') ? -1 : undefined,
});
window.addEventListener('keydown', (e) => {
  if (['+', '-', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    keyboard.emit('key', { key: e.key });
  }
});

const sw = bus.createSource('switch');
bus.addBinding({ source: 'switch', signal: 'hit', topic: 'counter/delta', transform: () => +1 });
document.getElementById('switch-btn')?.addEventListener('click', () => sw.emit('hit'));
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => mounted.forEach((m) => m.instance.onResize()));
window.addEventListener('pagehide', () => mounted.forEach((m) => m.state.flush()));

// Exposed only for the demo/validation harness; not part of any contract.
window.__nimrodDemo = { bus, profiles, user, get activeProfileId() { return activeProfileId; }, get mounted() { return mounted; } };
