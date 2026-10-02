// modules/nimrod.js — NIMROD, THE GUIDE: a module, type 'nimrod'. Help and wiki as a
// choose-your-own-adventure, an NPC who suggests what to do next, and Kontakt's info pane.
//
// Mike, 2026-10-02 (DECISIONS.md, second set, item 3): the landing Home is four up, clockwise from top
// left: pictures, settings, devices and Nimrod. "Nimrod being a new module that would pretty much be our
// equivalent of a help/wiki. Have him there to suggest things for you to do. Kind of like an NPC."
//
// The tree is DATA (nimrod_guide_data.js) and so is the walk; this file draws it and does what a node's
// acts say. What it draws, top to bottom:
//   * what he says (read aloud through `ctx.output` when "Read aloud" is on — the PERSON'S output routing
//     still decides whether `say` is speech on this screen, as for the cat);
//   * the choices (A, B, C...), then what he can do from here (open a settings tab, show a settings page,
//     the switch list), then Back, Start over and the map toggle;
//   * the map: the tree "like a file tree", on by default (a setting), with where you are open in it;
//   * the info area: whatever the pointer, the focus or the scan cursor is on, explained (hover_info.js,
//     with cat_help.js's words) — a setting too.
//
// *** HE IS NEVER A GATE. *** Nothing here waits: he says something, offers choices, and is happy to be
// ignored for ever. No acts run by themselves except showing a page in the settings PANEL (nimrod_guide_
// data.js argues why the settings MENU never opens by itself: it would take the switch scan).
//
// *** A SWITCH DRIVES HIM like any panel: next / prev walk his buttons (Back first when there is a way
// back, so a stray select goes back rather than somewhere new), select presses, back is Back. Topics:
// GUIDE_VERB_TOPICS (the actions.js MODULE_VERBS line is the coordinator's to add). Voice reaches the same
// verbs through the router.
//
// *** WHERE YOU WERE IS KEPT (`walk` on the panel's state, not a setting): "Then it goes through whatever
// you choose whenever you chose." Leave him and come back, and he is where you left him, Back and all.
// 200 steps are kept: Back "however much you want" in practice, and a few kilobytes at most.
//
// *** THE AI SEAM: `ctx.guideText(node, info)`, when a host hands one in, is asked for his words first
// (nimrod_guide_data.js `wordsFor`); anything it cannot answer in time falls back to the tree's own words.

import { registerModule } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { catImageURL } from '../cat_guide.js';
import { watchHover } from '../hover_info.js';
import {
  GUIDE_NODES, GUIDE_ROOT, GUIDE_VERB_TOPICS, createGuideNav, treeRows, wordsFor, actMessages, introFor,
} from '../nimrod_guide_data.js';

export const GUIDE_TYPE = 'nimrod';
export const GUIDE_SOURCE = 'nimrod-guide';     // `source` on everything he says, for the output log
export const WALK_KEY = 'walk';                  // where he is, on the panel's own state
export const INTRO_KEY = 'intro';                // which hello: 'landing' | 'tutorial' | absent (dashboards.js)
export const WALK_KEEP = 200;
export const INFO_IDLE = 'Point at anything and I will tell you what it does.';

// The three settings, each a person's choice (Rule 1), each argued:
//   tree   ON: Mike, "an optional view of it like a file tree that is on by default".
//   hover  ON: the feature he asked for; off for somebody who finds words changing as the mouse moves busy.
//   speak  ON: the cat's argued default (cat_guide.js `speak`) — somebody who cannot read the box hears him.
//          The person's output routing still decides whether `say` becomes speech.
export const GUIDE_SETTINGS = Object.freeze([
  { key: 'tree', label: 'Show the map of where you are', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes — like a file tree', offLabel: 'No',
    help: 'A tree of everything Nimrod can show you, open at the place you are.' },
  { key: 'hover', label: 'Explain what the pointer is on', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No',
    help: 'Point at anything, or scan to it, and Nimrod says what it does in the box at his bottom.' },
  { key: 'speak', label: 'Nimrod reads aloud', kind: 'toggle', default: true, level: 'standard',
    onLabel: 'Yes', offLabel: 'No — words only',
    help: 'His words also go to the screen’s voice, if this screen speaks.' },
]);
const FIELDS = GUIDE_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);
export function guidePrefs(values = {}) {
  const out = {};
  for (const f of FIELDS) out[f.key] = fieldValue(f, values || {});
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstSentence = (s) => (String(s || '').match(/^[^.!?]*[.!?]/) || [String(s || '')])[0].trim();

// Every colour is a theme token. Sizes are in rem so the person's own text size carries.
const STYLE = `
.ng-root{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;
  color:var(--text);font:inherit}
.ng-head{display:flex;align-items:center;gap:10px}
.ng-head img{width:56px;height:56px;flex:0 0 auto}
.ng-head b{font-size:1.1rem}
.ng-where{color:var(--text-muted)}
.ng-say{margin:0;line-height:1.45}
.ng-btns{display:flex;flex-wrap:wrap;gap:8px}
.ng-btn{min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer;text-align:left}
.ng-btn[disabled]{opacity:.5;cursor:default}
.ng-btn.ng-choice{flex:1 1 100%}
.ng-btn.ng-act{background:var(--surface-alt)}
.ng-btn.is-scan,.ng-btn:focus-visible{outline:3px solid var(--highlight);outline-offset:2px}
.ng-key{font-weight:700;margin-right:6px}
.ng-tree{margin:0;padding:8px 0 0;list-style:none;border-top:1px solid var(--border)}
.ng-tree li button{background:none;border:0;color:var(--text);font:inherit;cursor:pointer;padding:3px 0;text-align:left;min-height:32px}
.ng-tree li[aria-current="true"] button{font-weight:700;color:var(--text-strong)}
.ng-info{margin-top:auto;padding:8px 10px;border-radius:10px;background:var(--surface-alt);color:var(--text);min-height:3em}
.ng-info b{margin-right:4px}
`;

registerModule(
  { type: GUIDE_TYPE, title: 'Nimrod', core: 'new', dependsOn: 'none', importance: 'normal',
    description: 'Nimrod the guide: what everything does, and what to try next, as choices you can walk back through',
    settings: GUIDE_SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    const nav = createGuideNav();
    let root = null;
    let prefs = guidePrefs({});
    let intro = null;
    let saidId = null;
    let cursor = 0;            // the scan cursor, an index into stops()
    let hover = null;
    let offState = null;
    const offs = [];
    let torn = false;
    let words = '';            // what he is saying now (the tree's, or the AI seam's)
    let lastInfo = null;       // what the info area last explained

    const stateGet = () => { try { return ctx.state?.get?.() || {}; } catch { return {}; } };
    const stateSet = (patch) => { try { ctx.state?.set?.(patch); } catch { /* a preview with no state */ } };

    function publish(topic, payload) {
      try { ctx.bus?.publish?.(topic, payload); } catch (err) { console.error('nimrod: publish', err); }
    }
    function speak(text) {
      if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* already said */ } }
      saidId = null;
      if (!prefs.speak || !text || typeof ctx.output?.say !== 'function') return;
      try { saidId = ctx.output.say(text, { source: GUIDE_SOURCE }); } catch (err) { console.error('nimrod: say', err); }
    }
    function runAct(a) {
      for (const m of actMessages(a)) publish(m.topic, m.payload);
    }

    /** Arrive at the current node. `forward`: by a choice or a tree row (its auto acts run); else Back. */
    async function arrive({ forward = false, quiet = false } = {}) {
      const node = nav.current();
      const own = node.id === GUIDE_ROOT ? introFor(intro) : node.say;
      words = own;
      cursor = 0;
      stateSet({ [WALK_KEY]: nav.history().slice(-WALK_KEEP) });
      render();
      if (forward) for (const a of node.acts || []) if (a.auto) runAct(a);
      if (typeof ctx.guideText === 'function') {
        const mine = node.id;
        const w = await wordsFor(node, { source: ctx.guideText, intro });
        if (torn || nav.id() !== mine) return;
        if (w !== words) { words = w; render(); }
      }
      if (!quiet) speak(words);
    }

    // The stops a switch walks, in order: Back first (when there is a way back), the choices, the acts,
    // Start over, the map toggle. A link is a stop too (select follows it, in a new tab).
    function stops() {
      return root ? [...root.querySelectorAll('[data-ng-stop]')].filter((b) => !b.disabled) : [];
    }
    function paintCursor() {
      const list = stops();
      for (const b of root?.querySelectorAll('.is-scan') || []) b.classList.remove('is-scan');
      if (!list.length) return;
      cursor = ((cursor % list.length) + list.length) % list.length;
      list[cursor].classList.add('is-scan');
    }

    function render() {
      if (!root || torn) return;
      const node = nav.current();
      const acts = node.acts || [];
      const choiceBtns = (node.choices || []).map((c, i) => {
        const to = GUIDE_NODES[c.to];
        const help = to ? `${to.title}. ${firstSentence(to.id === GUIDE_ROOT ? introFor(intro) : to.say)}` : '';
        return `<button type="button" class="ng-btn ng-choice" data-ng-stop data-ng-choice="${i}" data-help="${esc(help)}"
          data-help-title="${esc(c.label)}"><span class="ng-key">${esc(c.key || '')}.</span>${esc(c.label)}</button>`;
      }).join('');
      const actBtns = acts.map((a, i) => (a.kind === 'link'
        ? `<a class="ng-btn ng-act" data-ng-stop data-ng-link href="${esc(a.href)}" target="_blank" rel="noopener"
            data-help="${esc(`Opens ${a.label} in a new tab.`)}">${esc(a.label)} ↗</a>`
        : `<button type="button" class="ng-btn ng-act" data-ng-stop data-ng-act="${i}"
            data-help="${esc(actHelp(a))}">${esc(a.label)}</button>`)).join('');
      const tree = prefs.tree
        ? `<ol class="ng-tree" role="tree" aria-label="Where you are">${treeRows(node.id).map((r) => `
            <li role="treeitem" aria-level="${r.depth + 1}" aria-current="${r.current}" ${r.hasChildren ? `aria-expanded="${r.open}"` : ''}
              style="padding-left:${r.depth * 1.1}rem"><button type="button" data-ng-tree="${esc(r.id)}"
              data-help="${esc(`Go to “${r.title}”.`)}">${r.hasChildren ? (r.open ? '▾ ' : '▸ ') : '· '}${esc(r.title)}</button></li>`).join('')}</ol>`
        : '';
      // A keyboard user who pressed one of his buttons keeps the keyboard in him: the new page's first
      // choice takes the focus the pressed (and now replaced) button had.
      const doc = root.ownerDocument;
      const hadFocus = !!doc.activeElement && root.contains(doc.activeElement);
      root.innerHTML = `
        <div class="ng-head"><img src="${esc(catImageURL('talking'))}" alt="">
          <div><b>Nimrod</b><div class="ng-where">${esc(node.title)}</div></div></div>
        <p class="ng-say" data-ng-say aria-live="polite">${esc(words)}</p>
        <div class="ng-btns">
          <button type="button" class="ng-btn" data-ng-stop data-ng-back ${nav.canBack() ? '' : 'disabled'}
            data-help="Back one step, the way you came. Press it again to keep going back.">‹ Back</button>
        </div>
        <div class="ng-btns">${choiceBtns}</div>
        ${actBtns ? `<div class="ng-btns">${actBtns}</div>` : ''}
        <div class="ng-btns">
          <button type="button" class="ng-btn" data-ng-stop data-ng-restart ${nav.id() === GUIDE_ROOT && !nav.canBack() ? 'disabled' : ''}
            data-help="Back to Nimrod’s first question.">Start over</button>
          <button type="button" class="ng-btn" data-ng-stop data-ng-treetoggle aria-pressed="${prefs.tree}"
            data-help="Show or hide the map of everything Nimrod can show you.">Map: ${prefs.tree ? 'on' : 'off'}</button>
        </div>
        ${tree}
        <div class="ng-info" data-ng-info data-hover-ignore role="status" aria-live="polite" ${prefs.hover ? '' : 'hidden'}>
          <b data-ng-info-title></b><span data-ng-info-text>${esc(INFO_IDLE)}</span></div>`;
      // A new page of his keeps what the info area last explained (Kontakt's pane does not blank either).
      if (lastInfo) showInfo(lastInfo);
      paintCursor();
      if (hadFocus) {
        const f = root.querySelector('[data-ng-choice]') || stops()[0];
        try { f?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      }
    }

    function actHelp(a) {
      switch (a.kind) {
        case 'menu-tab': return `Opens the settings menu on its ${a.tab} tab.`;
        case 'settings-page': return 'Shows that page in the settings panel.';
        case 'switch': return 'Opens the switch list: choose another module to take a panel’s place.';
        case 'host': return a.act === 'picker' ? 'Shows every module there is.' : 'Shows the ready-made dashboards to start from.';
        case 'tutorial': return 'Goes to the tutorial dashboard, where Nimrod and the settings always are.';
        case 'game-mode': return 'Game mode is still being built: this will start it.';
        default: return '';
      }
    }

    function press(el) {
      if (!el || el.disabled) return;
      const ds = el.dataset;
      if ('ngBack' in ds) { nav.back(1); arrive(); return; }
      if ('ngRestart' in ds) { nav.restart(); arrive({ forward: true }); return; }
      if ('ngTreetoggle' in ds) { setPref('tree', !prefs.tree); return; }
      if (ds.ngChoice != null) { if (nav.choose(Number(ds.ngChoice))) arrive({ forward: true }); return; }
      if (ds.ngAct != null) { const a = (nav.current().acts || [])[Number(ds.ngAct)]; if (a) runAct(a); return; }
      if (ds.ngTree) { if (nav.go(ds.ngTree)) arrive({ forward: true }); return; }
      if ('ngLink' in ds) { try { el.ownerDocument.defaultView?.open?.(el.href, '_blank', 'noopener'); } catch { /* blocked */ } }
    }
    function setPref(key, value) {
      prefs = { ...prefs, [key]: value };
      stateSet({ [key]: value });
      render();
    }
    function showInfo(i) {
      lastInfo = i ? { title: i.title || '', text: i.text || '' } : null;
      if (!root || !lastInfo) return;
      const t = root.querySelector('[data-ng-info-title]');
      const x = root.querySelector('[data-ng-info-text]');
      if (t) t.textContent = lastInfo.title ? `${lastInfo.title}:` : '';
      if (x) x.textContent = lastInfo.text;
    }

    function onClick(e) {
      const el = e.target instanceof Element ? e.target.closest('[data-ng-back],[data-ng-restart],[data-ng-treetoggle],[data-ng-choice],[data-ng-act],[data-ng-tree]') : null;
      if (!el || !root?.contains(el)) return;
      cursor = Math.max(0, stops().indexOf(el));
      press(el);
    }

    return {
      async init() {
        root = mount.ownerDocument.createElement('div');
        root.className = 'ng-root';
        root.setAttribute('data-nimrod-guide', '');
        const style = mount.ownerDocument.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        root.addEventListener('click', onClick);
        try { await ctx.state?.load?.(); } catch { /* a preview, or offline: the defaults stand */ }
        if (torn) return;
        const s = stateGet();
        prefs = guidePrefs(s);
        intro = typeof s[INTRO_KEY] === 'string' ? s[INTRO_KEY] : null;
        // Back where you left him: every step of the way you came, so Back still works.
        const walk = Array.isArray(s[WALK_KEY]) ? s[WALK_KEY].filter((id) => GUIDE_NODES[id]) : [];
        if (walk.length && walk[0] === GUIDE_ROOT) for (const id of walk.slice(1)) nav.go(id);
        // Arriving is not a forward step: what was opened last time is not opened again by itself, and
        // he does not talk over a screen that has just started (he speaks when spoken to).
        await arrive({ quiet: true });
        try {
          offState = ctx.state?.subscribe?.((v) => {
            const next = guidePrefs(v || {});
            if (next.tree !== prefs.tree || next.hover !== prefs.hover || next.speak !== prefs.speak) { prefs = next; render(); }
          }) || null;
        } catch { offState = null; }
        // The verbs a switch sends him.
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(GUIDE_VERB_TOPICS.next, () => { cursor += 1; paintCursor(); });
        on(GUIDE_VERB_TOPICS.prev, () => { cursor -= 1; paintCursor(); });
        on(GUIDE_VERB_TOPICS.select, () => { const b = stops()[cursor]; if (b) press(b); });
        on(GUIDE_VERB_TOPICS.back, () => { if (nav.canBack()) { nav.back(1); arrive(); } });
        // Hover: the whole screen he is on (a kiosk), or the page.
        const scope = mount.closest?.('.kiosk') || mount.ownerDocument;
        hover = watchHover(scope, { enabled: () => prefs.hover && !torn, onInfo: showInfo });
      },
      onResize() {},
      onHide() { if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } saidId = null; } },
      destroy() {
        torn = true;
        try { hover?.stop(); } catch { /* gone */ }
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        if (saidId != null) { try { ctx.output?.cancel?.(saidId); } catch { /* said */ } }
        root?.removeEventListener('click', onClick);
        mount.innerHTML = '';
        root = null;
      },
      // For the suite: where he is, without reaching into the closure.
      __probe: () => ({ id: nav.id(), history: nav.history(), prefs: { ...prefs }, intro, words, cursor,
        stops: stops().map((b) => b.textContent.trim()) }),
    };
  },
);
