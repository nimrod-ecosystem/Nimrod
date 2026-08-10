// Press log — the APPEND-ONLY events demo module (event/log/progress kind).
//
// This is the press-game-data scenario made literal: every press appends an
// immutable event. Nothing here can overwrite or delete history — the events
// handle offers only append + read, and the server enforces it with triggers.
// Removing the module from a profile deletes its config but NOT these events.
//
// It reads the same bus topic the counter does ("counter/delta"), so the SAME
// keyboard/switch sources that drive the counter also log presses — one more
// demonstration that inputs are interchangeable across modules.

import { registerModule } from '../module.js';

registerModule(
  { type: 'presslog', title: 'Press log', description: 'append-only events — never overwritten' },
  (ctx) => {
    const { mount, bus, events } = ctx;

    function renderList(cache) {
      const total = mount.querySelector('[data-total]');
      const list = mount.querySelector('[data-list]');
      if (total) total.textContent = cache.total;
      if (!list) return;
      list.innerHTML = '';
      // cache.events is chronological; show the most recent few, newest first.
      for (const e of [...cache.events].reverse().slice(0, 6)) {
        const li = document.createElement('li');
        const t = new Date(e.created_at).toLocaleTimeString();
        li.textContent = `${e.kind} · ${t}`;
        list.append(li);
      }
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="presslog">
            <div class="total"><span data-total>0</span><small>presses (append-only)</small></div>
            <button class="cbtn wide" data-press>Press</button>
            <ul class="log" data-list></ul>
            <p class="kind-note">append-only events</p>
          </div>`;

        mount.querySelector('[data-press]').addEventListener('click', () => {
          events.append('press', { via: 'button' }).catch((e) => console.error(e));
        });

        // Also log presses that arrive via the shared bus (keyboard/switch/counter
        // buttons) — a sink, exactly like the counter's.
        bus.subscribe('counter/delta', () => {
          events.append('press', { via: 'bus' }).catch((e) => console.error(e));
        });

        events.subscribe(renderList);
      },
      onResize() {},
      onHide() {},
      destroy() {},
    };
  },
);
