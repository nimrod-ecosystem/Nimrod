// karaoke.js — SING ALONG, A FIRST VERSION (row 2.45). Mike, 2026-09-30: *"Karaoke."*
//
// The director has carried a labelled "Sing-along" placeholder for a long time (`director.js`,
// `real: false`), planned as "a curated youtube karaoke playlist + lyric/caption overlay". This is
// the first half of that, as its own module, and it is deliberately small:
//
// *** IT IS THE YOUTUBE MODULE, MOUNTED INSIDE A SING-ALONG FRAME — NOT A SECOND PLAYER. ***
// Everything a video panel already does is reused by mounting `youtube` as a child, the way the
// director mounts its providers: the playlist, adding by link, SEARCH with the person's own key
// (the same `apiKey` setting, declared by reusing youtube's own row), the stall watchdog, the held
// pause, and the speaker arbiter — so the song's volume is on the MIXER's media fader like any
// video. What this module adds is the frame, one word added to every search ("karaoke", a setting),
// and its own verbs.
//
// *** NO LYRICS ARE STORED, ANYWHERE. *** Song words are copyrighted. Karaoke videos carry their own
// words on screen, published by whoever has the right to, and that is the only place words come
// from here: nothing in this module or its settings holds a line of a song. (Chat's note (a) on
// row 2.45.) The suite checks the saved state for it.
//
// *** WHAT IS NOT BUILT, SAID RATHER THAN IMPLIED. *** No curated starter playlist (choosing songs
// is a family's call, and a list shipped in the code would be somebody's taste); no "sing along"
// scoring or pitch; the director's placeholder is not switched over to this (its providers publish
// `segment/done` under their own name, and this one's inner player speaks as `youtube`). All on
// Mike's list.

import { registerModule, mountModule, extendCtx } from '../module.js';
// The player this frames. Imported here because this module cannot work without it, not for the
// registry's sake: every page that offers karaoke also imports youtube.js itself.
import { SETTINGS as YT_SETTINGS, searchVideos } from './youtube.js';

export const GAME = 'karaoke';

export const DEFAULTS = Object.freeze({
  framing: true,
  // Added to every search from this panel so the results are sing-along videos with the words on
  // screen. A setting (Rule 1): "lyrics", "sing along" or nothing are all reasonable.
  searchWord: 'karaoke',
});

// The YouTube rows this panel shares, reused AS DECLARED so the two can never disagree about what a
// key means. `presetId` is left out: its choices come from a mounted youtube instance's live list,
// which this frame does not forward yet.
const SHARED = ['apiKey', 'apiKeyFor', 'volume', 'volumeStep', 'heldNotifyMs'];
const SETTINGS = [
  { key: 'framing', label: 'Show the "Sing along" heading', default: true, level: 'essential',
    onLabel: 'On', offLabel: 'Off (just the video)' },
  { key: 'searchWord', label: 'Added to every search', kind: 'text', default: 'karaoke', level: 'advanced',
    note: 'So a search finds sing-along videos with the words on screen. Leave it empty to search exactly what is typed.' },
  ...YT_SETTINGS.filter((s) => SHARED.includes(s.key)),
];

/** What is typed, plus the search word — unless it is already there, or there is nothing typed. */
export function karaokeQuery(q, word = DEFAULTS.searchWord) {
  const text = String(q == null ? '' : q).trim();
  const w = String(word == null ? '' : word).trim();
  if (!text) return '';
  if (!w || text.toLowerCase().includes(w.toLowerCase())) return text;
  return `${text} ${w}`;
}

const STYLE_ID = 'karaoke-style';
const CSS = `
.karaoke{position:absolute;inset:0;display:grid;grid-template-rows:auto 1fr auto;background:var(--bg);
  color:var(--text);font-family:var(--font)}
.kk-head{display:flex;align-items:baseline;gap:1em;flex-wrap:wrap;padding:.5em .9em}
.kk-head b{font-size:1.3em}
.kk-tag{font-size:.8em;padding:.1em .6em;border-radius:1em;border:2px solid var(--border);color:var(--text-soft)}
.kk-note{font-size:.85em;color:var(--text-soft)}
.kk-stage{position:relative;min-height:0}
.kk-empty{margin:0;padding:.5em .9em;color:var(--text-soft)}
`;

registerModule(
  { type: GAME, title: 'Sing along', core: 'new',
    description: 'A first version of karaoke: sing-along videos from YouTube that show their own words. '
      + 'Nothing here stores song words.',
    // The songs are YouTube videos: without the network there is nothing to sing.
    dependsOn: 'network', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    let cfg = { ...DEFAULTS };
    let child = null;
    let dead = false;
    const childSubs = [];
    const childId = `${ctx.instanceId || GAME}-player`;
    const root = ctx.rootBus && typeof ctx.rootBus.scope === 'function' ? ctx.rootBus : null;
    const topicFor = (topic) => (root && typeof root.instanceTopic === 'function'
      ? root.instanceTopic(childId, topic) : `${topic}#${childId}`);

    // *** THE INNER PLAYER'S HANDLES. *** Its state IS this panel's state — one row, so the playlist,
    // the key and the volume set from this panel's menu are the ones it plays with — but it may not
    // CLOSE it: `mountModule` destroys a child's state and events when the child goes, and these
    // belong to this panel's host.
    const childState = {
      get: () => (typeof state?.get === 'function' ? state.get() : {}),
      set: (p) => state?.set?.(p),
      flush: () => state?.flush?.(),
      load: async () => {},
      startPolling() {},
      subscribe(fn) {
        const off = state?.subscribe?.(fn) || (() => {});
        childSubs.push(off);
        return off;
      },
      destroy() {},
    };
    const ev = ctx.events || null;
    const childEvents = {
      append: (...a) => (ev?.append ? ev.append(...a) : Promise.resolve()),
      subscribe: (fn) => (ev?.subscribe ? ev.subscribe(fn) : () => {}),
      load: async () => {}, flush: async () => {}, get: () => (ev?.get ? ev.get() : { events: [] }),
      startPolling() {}, destroy() {},
    };

    // *** THE INNER PLAYER'S BUS. *** Its heartbeat (`segment/progress`) is ALSO said as
    // `karaoke/progress`, because health watches a panel by its own topic prefix and a sing-along
    // that only ever spoke as `youtube` would look silent. Scoped under its own id so this panel's
    // verbs can reach it alone.
    const scopeVia = (id) => {
      if (root) return root.scope(id);
      const offs = [];
      return {
        subscribe(topic, fn) {
          const a = bus.subscribe(topic, fn);
          const b = id ? bus.subscribe(`${topic}#${id}`, fn) : null;
          const off = () => { a?.(); b?.(); };
          offs.push(off);
          return off;
        },
        addBinding: (x) => { const off = bus.addBinding(x); offs.push(off); return off; },
        createSource: (...a) => bus.createSource(...a),
        publish: (...a) => bus.publish(...a),
        instanceId: id,
        dispose: () => { while (offs.length) { try { offs.pop()(); } catch { /* gone */ } } },
      };
    };
    const childBus = {
      scope(id) {
        const s = scopeVia(id);
        return {
          ...s,
          publish(topic, payload, meta) {
            s.publish(topic, payload, meta);
            if (topic === 'segment/progress') bus.publish(`${GAME}/progress`, payload);
          },
        };
      },
    };

    const search = typeof ctx.searchVideos === 'function' ? ctx.searchVideos : searchVideos;

    function frame() {
      const head = mount.querySelector('[data-karaoke-head]');
      if (head) head.hidden = cfg.framing === false;
      const empty = mount.querySelector('[data-karaoke-empty]');
      if (empty) {
        const none = !(Array.isArray(cfg.playlist) && cfg.playlist.length) && !cfg.playlistId
          && !(Array.isArray(cfg.schedule) && cfg.schedule.length) && !cfg.presetId;
        empty.hidden = !none;
      }
    }

    return {
      init() {
        const doc = mount.ownerDocument || document;
        if (!doc.getElementById(STYLE_ID)) {
          const st = doc.createElement('style');
          st.id = STYLE_ID;
          st.textContent = CSS;
          (doc.head || doc.documentElement).append(st);
        }
        mount.innerHTML = `<div class="karaoke" data-karaoke>
          <div class="kk-head" data-karaoke-head><b>Sing along</b><span class="kk-tag">First version</span>
            <span class="kk-note">The words come from the video itself; nothing here stores them.</span></div>
          <div class="kk-stage" data-karaoke-stage></div>
          <p class="kk-empty" data-karaoke-empty hidden>No songs yet. Open the settings on the video (the gear) to search for a song, and "karaoke" is added to the search, or paste a karaoke video link.</p>
        </div>`;
        state?.subscribe?.((snap) => { cfg = { ...DEFAULTS, ...(snap || {}) }; if (!dead) frame(); });
        frame();

        child = mountModule('youtube', extendCtx(ctx, {
          mount: mount.querySelector('[data-karaoke-stage]'),
          bus: childBus,
          instanceId: childId,
          state: childState,
          events: childEvents,
          searchVideos: (q, opts) => search(karaokeQuery(q, cfg.searchWord), opts),
        }));
        child.init();

        // This panel's verbs, to its own player only.
        for (const v of ['next', 'prev', 'play', 'pause']) {
          bus.subscribe(`${GAME}/${v}`, (p) => bus.publish(topicFor(`youtube/${v}`), p));
        }
      },
      onResize() { try { child?.onResize?.(); } catch { /* noop */ } },
      onHide() { try { child?.onHide?.(); } catch { /* noop */ } state?.flush?.(); },
      onShow() { try { child?.onShow?.(); } catch { /* noop */ } },
      destroy() {
        dead = true;
        try { child?.destroy(); } catch (err) { console.error('karaoke: player', err); }
        child = null;
        while (childSubs.length) { try { childSubs.pop()(); } catch { /* gone */ } }
      },
      // (row 2.57) The key rows are the player's: a typed key goes to the server through it, and the
      // rows' live words (which key is in use) are its words. Only the shared rows are forwarded.
      settingsWrite: (k, v) => SHARED.includes(k) && child?.impl?.settingsWrite?.(k, v) === true,
      settingsChoices: () => {
        let c = {};
        try { c = child?.impl?.settingsChoices?.() || {}; } catch { c = {}; }
        return Object.fromEntries(Object.entries(c).filter(([k]) => SHARED.includes(k)));
      },
    };
  },
);
