// pack_loader.js — THE UI HALF OF "make your own pack with the AI of your choice."
//
// `games.html`'s course page already has the prompt (docs/PACK_SCHEMA.md's, verbatim) for
// getting an AI to produce a pack file. Without this, that path ended at a JSON file sitting
// on somebody's desktop — the AI could write the pack, but nothing in the product could ever
// read it back in. This is the other half: pick a file (or paste its contents), validate it
// the same way any built-in pack is validated, and it joins the pack list a game already
// offers, no different from `maths_basic` or `cma_art_trivia`.
//
// SAME SHAPE AS THE PHOTOS FOLDER PICKER, DELIBERATELY. `demo_strip.js`'s `onConnected`
// callback pattern, and the same honest "reload to use it" rather than pretending a running
// module's settings list can grow live. One mental model for "I added my own content," not two.
//
// Mountable from anywhere a pack matters: Trivia's and Word Forge's own settings panels, the
// Media tab, and Points & Quests — see the four callers rather than one, per Mike's own ask
// that this not be buried behind a single game's menu.

import { parsePack } from './packs.js';
import { addUserPack, listUserPacks, removeUserPack } from './user_packs.js';

const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// SELF-CONTAINED STYLE, INJECTED ONCE. This mounts into four different places (Trivia/Word
// Forge's settings panels, home.html's Media tab, Quests) and those do not share one
// stylesheet — home.html defines its own `.h-*` classes inline, `modules.html`/`kiosk.html`
// use `settings.css`. Rather than depend on either, this reads the same global theme
// variables `theme.js` sets everywhere (`--surface`, `--border`, `--text-muted`, …) and
// carries its own small rule set, guarded so mounting the loader twice on one page injects
// the `<style>` tag only once.
const STYLE_ID = 'pack-loader-style';
function ensureStyle(documentRef) {
  if (documentRef.getElementById(STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.pack-loader{font-size:.92rem;color:var(--text,#222)}
.pack-loader .pl-hint{margin:0 0 10px;color:var(--text-muted,#666);font-size:.88rem;line-height:1.5}
.pack-loader .pl-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pack-loader .pl-file{display:inline-block;padding:7px 12px;border:1px solid var(--border,#ccc);
  border-radius:8px;cursor:pointer;background:var(--surface,#fff)}
.pack-loader .pl-file input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.pack-loader .pl-or{color:var(--text-muted,#888);font-size:.85rem}
.pack-loader .pl-paste-toggle{background:none;border:none;color:var(--link,#105666);
  cursor:pointer;text-decoration:underline;font-size:.88rem;padding:0}
.pack-loader .pl-paste{width:100%;margin-top:8px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;
  border:1px solid var(--border,#ccc);border-radius:8px;padding:8px}
.pack-loader .pl-load{margin-top:6px;padding:6px 12px;border:1px solid var(--border,#ccc);
  border-radius:8px;background:var(--surface,#fff);cursor:pointer}
.pack-loader .pl-msg{margin:8px 0 0;font-size:.88rem;min-height:1.2em}
.pack-loader .pl-msg[data-tone="error"]{color:#a85f52}
.pack-loader .pl-msg[data-tone="ok"]{color:var(--accent,#3a7a4a)}
.pack-loader .pl-list{list-style:none;margin:8px 0 0;padding:0;font-size:.88rem}
.pack-loader .pl-list li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;
  border-top:1px solid var(--border,#eee)}
.pack-loader .pl-remove{background:none;border:none;color:var(--text-muted,#888);
  cursor:pointer;text-decoration:underline;font-size:.85rem;padding:0}
`;
  documentRef.head.appendChild(style);
}

/**
 * `kind` narrows which packs are listed/accepted when given ('trivia' | 'words' | 'lesson');
 * omitted, it accepts any valid pack and lists every user pack regardless of kind — the shape
 * the Media tab wants, since it is not itself a game with one fixed kind.
 *
 * `onLoaded(entry)` fires after a pack is saved. The caller decides what "use it" means —
 * a reload, a toast, nothing — this file only ever gets one pack as far as validated-and-saved.
 */
export function mountPackLoader(root, { kind = null, onLoaded = null, documentRef = document } = {}) {
  if (!root) return null;

  ensureStyle(documentRef);
  const el = documentRef.createElement('div');
  el.className = 'pack-loader';
  el.innerHTML = `
    <p class="pl-hint">A pack is a JSON file — built by hand, or by pasting
      <a href="/learn/courses/games.html#doc" target="_blank" rel="noopener">this prompt</a>
      into any AI along with a real source. Nothing here is sent anywhere; the file is read in
      this browser only.</p>
    <div class="pl-row">
      <label class="pl-file">Choose a file…
        <input type="file" accept="application/json,.json" data-pl-file>
      </label>
      <span class="pl-or">or</span>
      <button type="button" class="pl-paste-toggle" data-pl-paste-toggle>Paste JSON instead</button>
    </div>
    <textarea class="pl-paste" data-pl-paste hidden rows="6"
      placeholder="Paste a pack's JSON here"></textarea>
    <div class="pl-actions" data-pl-paste-actions hidden>
      <button type="button" class="pl-load" data-pl-load-pasted>Load this pack</button>
    </div>
    <p class="pl-msg" data-pl-msg role="status"></p>
    <ul class="pl-list" data-pl-list></ul>
  `;
  root.appendChild(el);

  const msgEl = el.querySelector('[data-pl-msg]');
  const listEl = el.querySelector('[data-pl-list]');

  function setMsg(text, tone = 'info') {
    msgEl.textContent = text;
    msgEl.dataset.tone = tone;
  }

  function renderList() {
    const mine = listUserPacks().filter((p) => !kind || p.kind === kind);
    if (!mine.length) { listEl.innerHTML = ''; listEl.hidden = true; return; }
    listEl.hidden = false;
    listEl.innerHTML = mine.map((p) =>
      `<li>${esc(p.label)} <button type="button" class="pl-remove" data-pl-remove="${esc(p.id)}">Remove</button></li>`
    ).join('');
  }

  // ONE PATH FOR BOTH ENTRY POINTS. A file and a pasted string arrive as different things
  // (a File object vs. a string already in hand) but become the same validated pack the same
  // way, so a bug fixed here cannot exist in only one of the two entry points.
  async function acceptText(text, sourceLabel) {
    let pack;
    try {
      pack = parsePack(text);
    } catch (e) {
      setMsg(e.message, 'error');
      return;
    }
    if (kind && pack.kind !== kind) {
      setMsg(`That pack is a "${pack.kind}" pack; this needs a "${kind}" pack.`, 'error');
      return;
    }
    const entry = addUserPack(pack, text);
    renderList();
    setMsg(`"${pack.name}" loaded from ${sourceLabel}. Reload the page to use it.`, 'ok');
    onLoaded?.(entry);
  }

  el.querySelector('[data-pl-file]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';               // so choosing the SAME file twice still fires 'change'
    if (!file) return;
    setMsg('Reading…');
    try {
      await acceptText(await file.text(), `"${file.name}"`);
    } catch (err) {
      setMsg(`Could not read that file: ${err.message}`, 'error');
    }
  });

  const pasteBox = el.querySelector('[data-pl-paste]');
  const pasteActions = el.querySelector('[data-pl-paste-actions]');
  el.querySelector('[data-pl-paste-toggle]').addEventListener('click', () => {
    pasteBox.hidden = !pasteBox.hidden;
    pasteActions.hidden = pasteBox.hidden;
    if (!pasteBox.hidden) pasteBox.focus();
  });
  el.querySelector('[data-pl-load-pasted]').addEventListener('click', () => {
    const text = pasteBox.value.trim();
    if (!text) { setMsg('Paste a pack first.', 'error'); return; }
    acceptText(text, 'pasted text');
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pl-remove]');
    if (!btn) return;
    removeUserPack(btn.dataset.plRemove);
    renderList();
    setMsg('Removed. Reload the page for it to disappear from the pack list.', 'ok');
  });

  renderList();

  return {
    el,
    destroy() { el.remove(); },
  };
}
