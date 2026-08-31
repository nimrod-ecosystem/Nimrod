// App wiring for the profiles + module-system demo (slice 2).
//
// Boot -> ensure the user has profiles -> render a profile picker -> open the
// active profile by mounting each of its module instances with its own scoped
// bus + per-instance state/events handles. Switching profiles tears the dashboard
// down and rebuilds it. The counter's extra input sources (keyboard, switch) from
// slice 1 still live here — untouched module, proving the bus seam holds.

import { createBus } from './bus.js';
import { createAim } from './aim.js';
import { POINTER_DEVICE } from './input_pointer.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createProfilesClient } from './profile.js';
import { mountModule, listManifests } from './module.js';
import { applyTheme, listThemes } from './theme.js';
import { listVoices, waitForVoices, speak } from './voice.js';
import './modules/clock.js';      // registers 'clock'
import './modules/camera.js';     // registers 'camera'
import './modules/photos.js';     // registers 'photos'
import './modules/youtube.js';    // registers 'youtube'
import './modules/interstitials.js'; // registers 'interstitials'
import './modules/personal.js';   // registers 'personal' (Personal videos — recorded)
import './modules/educational.js'; // registers 'educational' (generated learning segments)
import './modules/director.js';   // registers 'director' (the content director / Lineup)
import './modules/sprint.js';     // registers 'sprint' (focus timer -> points ledger)
import './modules/quests.js';     // registers 'quests' (the quest board <- ledger)
import './modules/progress.js';   // registers 'progress' (measurement <- gameplay stream)
import './modules/wordforge.js';  // registers 'wordforge' (a game -> BOTH streams)
import './modules/lessons.js';    // registers 'lessons' (watch to unlock topics)
import './modules/algebra.js';    // registers 'algebra' (solve for x, with a calculator)
import './modules/counter.js';    // registers 'counter'
import './modules/presslog.js';   // registers 'presslog'

const params = new URLSearchParams(location.search);
const user = params.get('user') || 'dev-user';

const bus = createBus();

// THE AIM, on this surface too. `comet.js` and anything else that wants a position read it
// off the bus rather than off their own element, so without a producer here a comet mounted
// on this page would sit still — which is a worse bug than the one that change fixed.
//
// This page has no input runtime (the verb layer lives in `input_runtime.js` and is mounted
// by the kiosk), so the mouse is wired straight to the aim rather than through
// `attachPointer`. Passive: a page that authors modules must not have its own scrolling and
// selecting interfered with by a listener that only wants to know where the pointer is.
const aim = createAim({ bus });
window.addEventListener('mousemove', (e) => aim.reportEvent(POINTER_DEVICE, e), { passive: true });
const profiles = createProfilesClient({ user });

const dashEl = document.getElementById('dashboard');
const pickerEl = document.getElementById('profile-picker');
const addSelEl = document.getElementById('add-module');
const addBtnEl = document.getElementById('add-module-btn');
const newNameEl = document.getElementById('new-profile-name');
const newBtnEl = document.getElementById('new-profile-btn');
const themePickerEl = document.getElementById('theme-picker');
const voicePickerEl = document.getElementById('voice-picker');
const voiceRateEl = document.getElementById('voice-rate');
const voiceTestEl = document.getElementById('voice-test');

let activeProfileId = null;
let mounted = [];   // [{ instance, state, events }]
let profileSettings = null;   // per-profile render settings handle (theme now; voice next)

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

function renderThemePicker() {
  themePickerEl.innerHTML = '';
  for (const t of listThemes()) {
    const opt = document.createElement('option');
    opt.value = t.id; opt.textContent = t.label;
    themePickerEl.append(opt);
  }
}

// Web Speech voices differ per machine and load async; (re)build the picker on
// boot and on 'voiceschanged', then reflect the active profile's saved choice.
function renderVoicePicker() {
  const voices = listVoices();
  voicePickerEl.innerHTML = '';
  if (!voices.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '(no voices available)';
    voicePickerEl.append(o);
  }
  for (const v of voices) {
    const o = document.createElement('option');
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})${v.default ? ' •' : ''}`;
    voicePickerEl.append(o);
  }
  if (profileSettings) reflectSettings(profileSettings.get());
}

// Reflect a settings snapshot into the shell controls (theme + voice pickers).
function reflectSettings(s) {
  themePickerEl.value = applyTheme(document.documentElement, s.theme);
  const pref = (s && s.voice) || {};
  if (pref.uri) voicePickerEl.value = pref.uri;
  voiceRateEl.value = String(pref.rate || 1);
}

const currentVoicePref = () => (profileSettings ? (profileSettings.get().voice || {}) : {});

function teardown() {
  for (const m of mounted) m.instance.destroy();
  mounted = [];
  dashEl.innerHTML = '';
  if (profileSettings) { profileSettings.destroy(); profileSettings = null; }
}

async function openProfile(pid) {
  teardown();
  activeProfileId = pid;

  // Per-profile render settings (theme now; voice next) ride the versioned
  // overwrite store under the reserved key 'settings' — module ids are 32-hex
  // UUIDs, so it never collides with an instance's state. Load + apply the theme
  // BEFORE mounting modules, so they render already themed (no flash of default).
  profileSettings = createState({ url: profiles.stateURL(pid, 'settings'), user });
  profileSettings.subscribe((s) => reflectSettings(s));
  await profileSettings.load();
  profileSettings.startPolling();

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
    // Additive ctx for CONTAINER modules (leaf modules ignore these): the root bus
    // for children to re-scope, this instance's id to namespace child storage, and
    // per-key handle factories so a container can mount its own children.
    const instance = mountModule(mod.type, {
      mount: body, bus, state, events, user, profileId: pid,
      rootBus: bus,
      instanceId: mod.id,
      aim,
      makeState: (key, opts) => createState({ url: profiles.stateURL(pid, key), user, ...opts }),
      makeEvents: (key, opts) => createEvents({ url: profiles.eventsURL(pid, key), user, ...opts }),
    });

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
themePickerEl.addEventListener('change', () => {
  const id = themePickerEl.value;
  applyTheme(document.documentElement, id);   // instant, optimistic
  profileSettings?.set({ theme: id });        // persist to THIS profile (versioned)
});
voicePickerEl.addEventListener('change', () => {
  const uri = voicePickerEl.value;
  const v = listVoices().find((x) => x.voiceURI === uri);
  profileSettings?.set({ voice: { ...currentVoicePref(), uri, lang: v?.lang } });
});
voiceRateEl.addEventListener('change', () => {
  profileSettings?.set({ voice: { ...currentVoicePref(), rate: Number(voiceRateEl.value) } });
});
voiceTestEl.addEventListener('click', () => {
  speak('Hi Christine. This is how your voice sounds.', currentVoicePref());
});
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
  renderThemePicker();
  // voices load asynchronously; render now (may be empty) and again on change
  window.speechSynthesis?.addEventListener?.('voiceschanged', renderVoicePicker);
  waitForVoices().then(renderVoicePicker);
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
