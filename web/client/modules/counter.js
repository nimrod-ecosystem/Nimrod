// Counter — the trivial module that validates the whole shared-systems loop.
//
// It exists to prove the boundary, not to be useful. Note what it does NOT do:
//   - it never names an input device (keyboard, switch, ...) — it opens ONE sink
//     on the semantic topic "counter/delta" and applies whatever arrives;
//   - it never touches storage directly — it reads/writes ctx.state, which is
//     server-backed and per-user;
//   - it never reaches outside ctx.mount.
//
// Because of the sink, ANY number of sources can drive it. This file wires only
// its own on-screen buttons; app.js adds a keyboard and a switch source later
// WITHOUT editing anything here.

import { registerModule } from '../module.js';

registerModule('counter', (ctx) => {
  const { mount, bus, state } = ctx;

  function render(value) {
    const el = mount.querySelector('[data-count]');
    if (el) el.textContent = value;
  }

  // The one and only downstream behaviour: apply a delta to server state.
  function applyDelta(delta) {
    const n = Number(delta) || 0;
    if (!n) return;
    const next = (state.get().count || 0) + n;
    state.set({ count: next });   // -> server (debounced); server is the truth
  }

  return {
    init() {
      mount.innerHTML = `
        <div class="counter">
          <div class="count" data-count>0</div>
          <div class="row">
            <button class="cbtn" data-dec aria-label="decrease">–</button>
            <button class="cbtn" data-inc aria-label="increase">+</button>
          </div>
          <p class="sink-note">sink: <code>counter/delta</code></p>
        </div>`;

      // SINK — the module's only contract with the bus. Fixed for its lifetime.
      bus.subscribe('counter/delta', applyDelta);

      // The on-screen buttons are just another SOURCE feeding that same topic.
      const buttons = bus.createSource('counter-buttons');
      bus.addBinding({
        source: 'counter-buttons', signal: 'press',
        topic: 'counter/delta', transform: (p) => p.dir,
      });
      mount.querySelector('[data-inc]').addEventListener('click', () => buttons.emit('press', { dir: +1 }));
      mount.querySelector('[data-dec]').addEventListener('click', () => buttons.emit('press', { dir: -1 }));

      // Re-render on any state change: our own writes, first load, or another
      // device's write arriving via the poller. The server drives the view.
      state.subscribe((s) => render(s.count || 0));
    },

    onResize() { /* nothing layout-sensitive yet */ },
    onHide() { state.flush(); },   // don't lose a pending write when hidden
    destroy() { /* bus scope auto-released by the runtime */ },
  };
});
