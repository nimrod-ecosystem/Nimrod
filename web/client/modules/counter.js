// Counter — the OVERWRITE-state demo module (config/layout/settings kind).
//
// Its value lives in versioned last-write-wins state. It still demonstrates the
// bus seam: ONE sink on "counter/delta", driven by its own buttons plus whatever
// extra sources app.js wires (keyboard, switch) — with no change here.

import { registerModule } from '../module.js';

registerModule(
  { type: 'counter', title: 'Counter', description: 'overwrite state — last-write-wins + version' },
  (ctx) => {
    const { mount, bus, state } = ctx;

    const render = (value) => {
      const el = mount.querySelector('[data-count]');
      if (el) el.textContent = value;
    };

    function applyDelta(delta) {
      const n = Number(delta) || 0;
      if (!n) return;
      state.set({ count: (state.get().count || 0) + n });
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
            <p class="kind-note">overwrite state · <code>counter/delta</code></p>
          </div>`;

        bus.subscribe('counter/delta', applyDelta);   // the module's one sink

        const buttons = bus.createSource('counter-buttons');
        bus.addBinding({
          source: 'counter-buttons', signal: 'press',
          topic: 'counter/delta', transform: (p) => p.dir,
        });
        mount.querySelector('[data-inc]').addEventListener('click', () => buttons.emit('press', { dir: +1 }));
        mount.querySelector('[data-dec]').addEventListener('click', () => buttons.emit('press', { dir: -1 }));

        state.subscribe((s) => render(s.count || 0));
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() {},
    };
  },
);
