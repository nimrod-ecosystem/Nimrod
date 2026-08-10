// App wiring for the shared-systems demo.
//
// Read this alongside modules/counter.js. The point of the file is the section
// marked "SECOND / THIRD INPUT SOURCE": those sources drive the counter with
// ZERO changes to the module — that's the acceptance criterion, made literal.

import { createBus } from './bus.js';
import { createState } from './state.js';
import { mountModule } from './module.js';
import './modules/counter.js';   // side-effect: registers the 'counter' module

// Identity is stubbed. `?user=` selects who this browser acts as (dev only) and
// is carried to the server as X-Dev-User. Real auth replaces this later.
const params = new URLSearchParams(location.search);
const user = params.get('user') || 'dev-user';

const bus = createBus();
const state = createState({ module: 'counter', user });

const mount = document.getElementById('app');
const counter = mountModule('counter', { mount, bus, state, user });

async function boot() {
  document.querySelectorAll('[data-user-label]').forEach((el) => (el.textContent = user));
  await state.load();     // server is the source of truth on open
  counter.init();
  state.startPolling();   // interim cross-device live-sync (see state.js)
}
boot().catch((err) => console.error('boot failed', err));

// ---------------------------------------------------------------------------
// SECOND INPUT SOURCE — a keyboard. Added here, at the app layer, with no edit
// to counter.js. It drives the counter purely by emitting onto the same
// "counter/delta" topic through its own binding. The binding does the reshaping
// (raw key -> +1/-1); an unmapped key returns undefined and is ignored.
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

// THIRD INPUT SOURCE — a simulated external "switch/remote" device (the kind of
// single-action accessible input a patient might use). Same story: new source,
// new binding, same topic, module untouched.
const sw = bus.createSource('switch');
bus.addBinding({ source: 'switch', signal: 'hit', topic: 'counter/delta', transform: () => +1 });
document.getElementById('switch-btn')?.addEventListener('click', () => sw.emit('hit'));
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => counter.onResize());
window.addEventListener('pagehide', () => state.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) counter.onHide(); });

// Exposed only so the demo page can show the acceptance checks live; not part of
// the module or bus contract.
window.__nimrodDemo = { bus, state, user };
