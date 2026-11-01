// page_editor.js — THE ONE EDITOR OVER ANY PAGE OF THE SITE (row 2.145 step 4, 2026-10-31).
//
// `?wording=1` on a page that loads theme.js opens the one editor (editor.js) over that page, its words shown: the page's
// parts in the list (page_targets.js), each part's words under it, and the inspector to change them -- the same Words
// section, the same draft list and the same "Copy changes" as on a dashboard. It REPLACES THE WORDING BAR (row 2.123),
// which did the same job its own way: one way to change the site's words, not two. On a dashboard (kiosk.html) the kiosk
// opens the editor itself (kiosk.js), and theme.js never starts this there.
//
// What it does not do (said so this file is not read as more): nothing on a page is moved or taken out (the page is
// written in the site's code; the tools say so), and nothing is saved to the site -- a change is a suggestion kept in this
// browser and copied for the site's next update, as before. Not step 5.
//
// *** NEVER A GATE, NEVER A TRAP (CLAUDE.md). *** Off unless somebody types the address: importing this file draws nothing.
// Done is its first button; Escape closes it (after leaving chosen words); `?wording=0` forgets it; and it closes itself
// after IDLE_OFF_MS with nobody using it (wording_edit.js: the bar's own twenty minutes), keeping every change. While the
// words are shown a press on words chooses them and presses nothing -- that is the point of it, and the status line says
// so. "It is on" is kept in this browser (ON_KEY, as the bar kept it), so moving to another page of the site keeps it
// open there; closing it any way forgets that. A dashboard never honours the kept "on" (theme.js, kiosk.html's meta).
//
// THE NUMBERS (Rule 1):
//   z-index 2147483000   the wording bar's own (proven over every page of the site for a week). FOR: a page's own layers
//                        (a dialog, the landing page's demo, a modal sheet) are all below it, so the editor is never under
//                        what it edits. AGAINST: the editor's own --z-menus (600) would have been the token; some pages
//                        put their own things above 600, and an editor under them could not be pressed.
//   list hidden under 700 px   the editor's own narrow width (editor.js THE LOOK). FOR: on a page, words are chosen by
//                        pressing them, and on a phone the list band and the inspector sheet together would leave about a
//                        quarter of the page to press on. AGAINST: the list is one press away ("Show the list"), and a
//                        switch user on a phone has one more stop to reach it. Wider than that, the list shows.
//   IDLE_OFF_MS          reused (wording_edit.js), not a new number.
import { openSceneEditor } from './editor.js';
import { pageSections, pageRest, buildPageTree } from './page_targets.js';
import { ON_KEY, IDLE_OFF_MS, wordingParam, forgetWordingOn } from './wording_edit.js';

export const PAGE_EDITOR_Z = 2147483000;
export const NARROW_PX = 700;
const HOST_ATTR = 'data-page-editor';
// The kiosk's three for its editor, and a click: a button pressed from the keyboard or a switch is a click with no
// pointer-down before it, and it is somebody using the editor as much as a press is.
const ACTIVITY = ['pointerdown', 'keydown', 'input', 'click'];

const store = {
  get(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* not kept */ } },
  del(k) { try { globalThis.localStorage?.removeItem(k); } catch { /* nothing kept */ } },
};

/**
 * Open the editor over `win`'s page. Returns its handle (editor.js's, plus `host`), or the one already open there.
 *   words        open with the words shown (default true: the address asked to change words)
 *   list         show the list (default: not under NARROW_PX)
 *   setTimer / clearTimer   for the idle close (the suite runs it by hand); clipboard, now: the editor's
 */
export function openPageEditor({ win = globalThis.window, words = true, list = null, setTimer = null, clearTimer = null,
  clipboard = undefined, now = undefined } = {}) {
  const doc = win?.document;
  if (!doc?.body) return null;
  const open = win.__nimrodPageEditor;
  if (open && open.isOpen?.()) return open;
  const setT = setTimer || ((f, ms) => win.setTimeout(f, ms));
  const clearT = clearTimer || ((h) => win.clearTimeout(h));
  const narrow = (() => { try { return !!win.matchMedia?.(`(max-width:${NARROW_PX}px)`)?.matches; } catch { return false; } })();
  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.style.cssText = `position:fixed;inset:0;z-index:${PAGE_EDITOR_Z};pointer-events:none`;
  doc.body.append(host);
  let idle = null;
  let ed = null;
  const disarm = () => { if (idle != null) { try { clearT(idle); } catch { /* gone */ } } idle = null; };
  const arm = () => {
    disarm();
    idle = setT(() => { idle = null; try { ed?.close(); } catch (err) { console.error('page editor: idle close', err); } }, IDLE_OFF_MS);
  };
  try {
    ed = openSceneEditor({
      pageRoot: doc.body, pageTargets: { sections: pageSections, rest: pageRest, tree: buildPageTree },
      mountIn: host, words: !!words, list: list === null ? !narrow : !!list, level: 'advanced',
      ...(clipboard !== undefined ? { clipboard } : {}), ...(now !== undefined ? { now } : {}),
      onActivity: arm,
      onClose: () => {
        disarm();
        try { host.remove(); } catch { /* gone */ }
        store.del(ON_KEY);
        if (win.__nimrodPageEditor === api) win.__nimrodPageEditor = null;
      },
    });
  } catch (err) {
    console.error('page editor: opening', err);
    try { host.remove(); } catch { /* gone */ }
    return null;
  }
  // Any press, key or typing in the editor is somebody using it: the wait starts again (as the kiosk does for its editor).
  for (const ev of ACTIVITY) ed.el.addEventListener(ev, arm);
  store.set(ON_KEY, '1');
  arm();
  const api = { ...ed, host };
  win.__nimrodPageEditor = api;
  return api;
}

/** On a page load: `?wording=1` opens it, `?wording=0` forgets it; otherwise it opens if it was left open in this browser. */
export function pageEditorFromPage(win = globalThis.window) {
  const p = wordingParam(win?.location?.search || '');
  if (p === false) { forgetWordingOn(); return null; }
  if (p === true || store.get(ON_KEY) === '1') return openPageEditor({ win });
  return null;
}
