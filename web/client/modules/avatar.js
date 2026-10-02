// modules/avatar.js — MAKE AN AVATAR: pick a face part by part, or use a picture, or make your own.
//
// Row 2.37 item 5 (private repo, docs/for_chat/MIKE_CHANGE_LIST.md) and Mike's addition, 2026-09-30:
// *"avatars are optional; add a quick generic avatar creator/selector ... Kind of like Miis on
// Nintendo"*, next to the make-your-own prompts (the room-as-home notes, §7.4). The drawing and the
// record are `avatar.js`; this is the panel that makes one and keeps it on the person.
//
// WHERE IT IS KEPT. On the PERSON (`ctx.makePersonState(personId, 'avatar')`), so it follows them to
// every screen — the store the game and the music favourites already use, no new server table. With
// no person yet (the modules page signed out) it is kept on this panel instead, and says nothing about
// it: the same avatar, only local. Optional: a person with no row has no avatar and nothing else changes.
//
// THREE WAYS TO HAVE ONE, one press each from the panel:
//   * MAKE ONE HERE: a part at a time, with a live picture. "Surprise me" deals a whole face.
//   * USE A PICTURE INSTEAD: the shared picture picker (`picture_picker.js`, 2026-10-02) — recent
//     pictures first, "add one from this device", or a folder's thumbnails in a grid — the same one a
//     button's and an AAC card's picture are chosen with. Until then this view listed every file in
//     every folder as a button of its own, which Mike ruled out ("isn't a good way to do it").
//     Nothing is sent anywhere: a picture added from this device stays in this browser.
//   * MAKE YOUR OWN: the two prompts (a photo, or a description) with a Copy button each, and the
//     warning that a photo sent to an online AI leaves the computer. What comes back is a picture,
//     which goes in a picture folder and is chosen with "use a picture instead".
//
// ONE SWITCH REACHES EVERYTHING. The walk goes down the PARTS, then the buttons (Surprise me, Use a
// picture, Make your own, Cancel, Save — Save last, so it is one `prev` from the top). `select` on a
// part opens it: now `next`/`prev` step through that part's choices and the picture changes as they
// do; `select` keeps the one showing, `back` puts back what it was. `back` on the parts list is Cancel.
// The first `select` only lights the first stop (the calculator's rule). A pointer clicks a part to
// open it and clicks any choice; arrow keys, Enter and Escape do what next/prev/select/back do.
//
// DEFAULTS CHOSEN HERE — each a setting, each on Mike's list:
//   * It moves (a blink every 9 s, a slow breath), because "animated avatars of people" was the ask.
//     Off in one row; off by itself when the device asks for reduced motion.
//   * The PERSON's own movement choice (Mike, 2026-10-01) is kept on their avatar and follows them to
//     every screen: "the usual" (no choice, stored as null), "always moves", "still" — one button, one press each.
//     Health settings and a screen's own setting still come first (avatar_display.js `avatarMotion`).
//   * Contrast warns at 1.3:1 (`avatar.js`, DEFAULT_WARN_BELOW) and never stops a Save.
//   * A new avatar starts from "surprise me" seeded with the person's id — not from one fixed face.

import { registerModule } from '../module.js';
import {
  renderAvatar, surprise, normalizeRecord, readAvatar, avatarWarnings, PARTS, partOf, optionFor,
  describeAvatar, AVATAR_KEY, DEFAULT_WARN_BELOW,
} from '../avatar.js';
import { AVATAR_CHANGED_EVENT, avatarMotion } from '../avatar_display.js';
import { flashLimit } from '../flash_limit.js';
import { createCardImages } from '../card_face.js';
import { createMediaSourcesClient } from '../media_sources.js';
import { mountPicturePicker } from '../picture_picker.js';
import { normalizeHex } from '../color_picker.js';

// *** THE MAKE-YOUR-OWN PROMPTS — chat's draft (room-as-home notes §7.4), unchanged in substance. ***
export const PROMPT_PHOTO = [
  'Make a friendly cartoon avatar of the person in this photo, for a family dashboard.',
  'Style: flat 2D, soft shading, clean dark outlines, warm colours, no text, plain transparent',
  'background. Keep what makes them recognisable (hair, glasses, beard, usual clothes) and',
  'nothing unflattering. Draw the same character, identical in every image, in these poses,',
  'one image each, square, full body, facing slightly toward the viewer:',
  'idle, talking (mouth open), waving, thinking (hand on chin), happy (big smile), sleeping',
  '(eyes closed, sitting), pointing left, pointing right. Then one head-and-shoulders image.',
].join('\n');
export const PROMPT_DESCRIBE = [
  'Write a single SVG file, viewBox="0 0 512 512", no width or height, no text, no external',
  'images, transparent background. Draw a friendly flat cartoon avatar of: <describe the',
  'person: hair colour and style, glasses, skin tone, beard, favourite clothes, one thing',
  'they are known for>. Use simple shapes and dark outlines so it reads at 64px. Put the eyes',
  'in a group with id="eyes" and the mouth in a group with id="mouth", so they can be',
  'animated (blinking, talking). Keep the whole figure inside the frame.',
].join('\n');

const SETTINGS = [
  { key: 'animate', label: 'Gentle movement', default: true, level: 'standard',
    onLabel: 'Blinks and breathes', offLabel: 'Still',
    note: 'Off keeps the face still on this panel, whatever the person chose. It is always still when this device asks for reduced motion.' },
  { key: 'allowChange', label: 'Change the avatar from this panel', default: true, level: 'standard',
    onLabel: 'Allowed', offLabel: 'Only shows it' },
  { key: 'warnBelow', label: 'Warn when a colour is this close to the background', kind: 'number',
    default: DEFAULT_WARN_BELOW, min: 1, max: 3, step: 0.1, unit: ':1', level: 'advanced',
    note: 'A warning only. Any colour can still be saved.' },
];
export const DEFAULTS = Object.freeze(Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// THE PERSON'S MOVEMENT CHOICE, kept on their avatar (`animate` on the row), in the order one press
// steps through them. "The usual" is no choice (null), so somebody who never touches it gets whatever each
// screen does by default (large faces move, small ones are still — avatar_display.js).
export const MOTION_CHOICES = Object.freeze([
  Object.freeze({ value: null, label: 'the usual (moves when shown large)' }),
  Object.freeze({ value: true, label: 'always moves' }),
  Object.freeze({ value: false, label: 'still' }),
]);

// The action buttons after the parts, in walk order. Save LAST so `prev` from the first part reaches it.
export const MAKE_ACTIONS = Object.freeze([
  { act: 'surprise', label: 'Surprise me' },
  { act: 'to-picture', label: 'Use a picture instead' },
  { act: 'to-own', label: 'Make your own' },
  { act: 'cancel', label: 'Cancel' },
  { act: 'save', label: 'Save' },
]);

registerModule(
  { type: 'avatar', title: 'Avatar maker', core: 'new',
    description: 'Make a drawn avatar for a person a part at a time, like a game character, or use a '
      + 'picture instead. It is kept on the person and follows them to every screen. Optional.',
    // `local`: the drawing needs nothing but this file; keeping it on the person needs the platform,
    // and without it the avatar is kept on this panel.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    let cfg = { ...DEFAULTS };
    let view = 'show';            // 'show' | 'make' | 'picture' | 'own'
    let draft = null;             // the record being made
    let openPart = null;          // the part whose choices are being walked, or null
    let openBefore = null;        // its value when it was opened (what `back` puts back)
    let lit = -1;
    let surprises = 0;
    let msg = '';
    let dead = false;
    let rootEl = null;
    let picker = null;            // the shared picture picker, while the picture view is open

    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };
    // THE SAME DECISION EVERY OTHER FACE MAKES (avatar_display.js `avatarMotion`), as a large face: the
    // device's reduced motion first, then this panel's own "Gentle movement" (it stands where a screen's
    // setting would), then the person's choice kept on their avatar, then "large faces move".
    const motionNow = () => avatarMotion({
      context: { deviceReduced: reducedMotion(), screen: cfg.animate ? 'follow' : 'still', flashLimit: flashLimit(ctx) },
      person: personChoice(), big: true,
    });
    const moving = () => motionNow().animate;
    const personIdNow = () => { try { return ctx.personId || null; } catch { return null; } };
    const seedBase = () => personIdNow() || ctx.instanceId || 'avatar';

    // ---- where it is kept ----------------------------------------------------------------
    let personStore = null;
    let personStoreFor = null;
    let offPerson = null;
    function ensureStore() {
      const pid = personIdNow();
      if (!pid || typeof ctx.makePersonState !== 'function' || personStoreFor === pid) return;
      closeStore();
      let h = null;
      try { h = ctx.makePersonState(pid, AVATAR_KEY); } catch (e) { console.error('avatar: person state', e); }
      if (!h) return;
      personStore = h; personStoreFor = pid;
      Promise.resolve(h.load?.()).catch(() => {}).then(() => { if (!dead && view === 'show') render(); });
      try { offPerson = h.subscribe?.(() => { if (!dead && view === 'show') render(); }) || null; } catch { offPerson = null; }
    }
    function closeStore() {
      try { offPerson?.(); } catch { /* gone */ }
      offPerson = null;
      const h = personStore;
      personStore = null; personStoreFor = null;
      // Let a write still in flight finish, then let go. No timer is left behind either way.
      if (h) Promise.resolve().then(() => h.flush?.()).catch(() => {}).finally(() => { try { h.destroy?.(); } catch { /* gone */ } });
    }
    const savedRow = () => {
      ensureStore();
      if (personStore) return personStore.get?.() || {};
      return (state?.get?.() || {})[AVATAR_KEY] || {};
    };
    const saved = () => readAvatar(savedRow());
    // The person's own movement choice, kept on the avatar row (Mike, 2026-10-01: movement follows the
    // person): true "always moves", false "still", null "the usual" (no choice made).
    function personChoice() {
      const a = savedRow().animate;
      return a === true || a === false ? a : null;
    }
    function writeRow(patch) {
      ensureStore();
      const cur = savedRow();
      const row = { ...readAvatar(cur), ...patch, at: now() };
      // A save of the face keeps the movement choice already made; only the movement button changes it.
      // "The usual" is written as null, not left out: a person's state is MERGED on write (state.js
      // `set`), so a key left out would keep the old choice.
      if (!Object.prototype.hasOwnProperty.call(patch, 'animate')) row.animate = cur.animate;
      if (typeof row.animate !== 'boolean') row.animate = null;
      if (personStore) {
        personStore.set(row); try { personStore.flush?.(); } catch { /* retried by the handle */ }
        // Tell any face on this page showing this person (`avatar_display.js`), with the row itself,
        // so it redraws without asking the server.
        try {
          globalThis.dispatchEvent?.(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: { personId: personStoreFor, row: { ...row } } }));
        } catch { /* no window: nothing on the page to tell */ }
      } else state?.set?.({ [AVATAR_KEY]: row });
    }

    // ---- the picture path (reused, not rebuilt) --------------------------------------------
    let client = null;
    const sourcesClient = () => client || (client = ctx.sources || ctx.mediaSources
      || createMediaSourcesClient({ user: ctx.user, cache: true, personId: personIdNow() }));
    const images = createCardImages({ sources: { list: () => sourcesClient().list() }, alive: () => !dead });
    function openPicker(host) {
      closePicker();
      picker = mountPicturePicker(host, {
        sources: sourcesClient(),
        // The suite's seam for the listing (and anybody else's); the picker's own default otherwise.
        listEntries: ctx.listItemNames || undefined,
        resolveUrl: ctx.resolveItemUrl || undefined,
        value: saved().picture,
        title: 'Use a picture instead',
        onPick: (ref) => { if (ref) savePicture(ref); },
        onCancel: () => leavePicture(),
      });
    }
    function closePicker() {
      const p = picker;
      picker = null;
      try { p?.destroy(); } catch { /* gone */ }
    }

    // ---- actions ---------------------------------------------------------------------------
    function startMake() {
      const s = saved();
      draft = s.drawn ? normalizeRecord(s.drawn) : surprise(seedBase());
      openPart = null; openBefore = null; msg = '';
      view = 'make';
      lit = lit >= 0 ? 0 : -1;
      render();
    }
    function toShow() { view = 'show'; openPart = null; draft = null; msg = ''; if (lit >= 0) lit = 0; render(); }
    function save() {
      if (!draft) return;
      writeRow({ use: 'drawn', drawn: normalizeRecord(draft) });
      toShow();
    }
    function doSurprise() {
      surprises += 1;
      draft = surprise(`${seedBase()}:${surprises}`, { min: Number(cfg.warnBelow) || DEFAULT_WARN_BELOW });
      render();
    }
    function openPartRow(key) {
      if (!partOf(key) || !draft) return;
      openPart = key; openBefore = draft[key];
      // The light moves onto the choice showing now, so the first `next` is the next choice. A pointer
      // that never started the walk gets no light.
      if (lit >= 0) lit = Math.max(0, partOf(key).options.findIndex((o) => o.id === draft[key]));
      render();
    }
    function closePart(keep) {
      if (!openPart) return;
      const key = openPart;
      if (!keep && draft) draft = { ...draft, [key]: openBefore };
      openPart = null; openBefore = null;
      if (lit >= 0) lit = PARTS.findIndex((p) => p.key === key);
      render();
    }
    function setPart(key, value) {
      if (!draft || !partOf(key)) return;
      draft = normalizeRecord({ ...draft, [key]: value });
      render();
    }
    function stepOpen(d) {
      const p = partOf(openPart);
      if (!p || !draft) return;
      const n = p.options.length;
      const i = p.options.findIndex((o) => o.id === draft[openPart]);
      const next = i < 0 ? (d > 0 ? 0 : n - 1) : (((i + d) % n) + n) % n;
      draft = { ...draft, [openPart]: p.options[next].id };
      lit = next;
      render();
    }
    function toPicture() {
      view = 'picture'; openPart = null; msg = '';
      if (lit >= 0) lit = 0;
      render();
    }
    // Choosing a picture in the picker IS the choice: one select, not a pick and then a Save.
    function savePicture(ref) {
      writeRow({ use: 'picture', picture: { sourceId: ref.sourceId, path: ref.path } });
      toShow();
    }
    // Cancel in the picker: back to the avatar being made, if one is, or to showing.
    function leavePicture() {
      if (draft) { view = 'make'; msg = ''; if (lit >= 0) lit = 0; render(); return; }
      toShow();
    }
    function noAvatar() { writeRow({ use: 'none' }); toShow(); }
    // One press steps the choice round: the usual -> always moves -> still -> the usual.
    function stepMotion() {
      const at = MOTION_CHOICES.findIndex((c) => c.value === personChoice());
      writeRow({ animate: MOTION_CHOICES[(at + 1) % MOTION_CHOICES.length].value });
      msg = '';
      render();
    }
    function useDrawn() { writeRow({ use: 'drawn' }); toShow(); }

    async function copy(which) {
      const text = which === 'photo' ? PROMPT_PHOTO : PROMPT_DESCRIBE;
      let ok = false;
      try {
        const cb = ctx.clipboard || globalThis.navigator?.clipboard;
        if (cb?.writeText) { await cb.writeText(text); ok = true; }
      } catch { ok = false; }
      if (!ok) {
        try {
          const pre = mount.querySelector(`[data-prompt="${which}"]`);
          const range = document.createRange(); range.selectNodeContents(pre);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          ok = !!document.execCommand?.('copy');
        } catch { ok = false; }
      }
      if (dead) return;
      msg = ok ? 'Copied. Paste it into the AI you use.' : 'Could not copy by itself. The words are selected: copy them with the keyboard or a long press.';
      render();
    }

    function act(el) {
      if (!el || dead) return;
      const a = el.dataset.act;
      switch (a) {
        case 'make': startMake(); return;
        case 'to-picture': toPicture(); return;
        case 'to-own': view = 'own'; openPart = null; msg = ''; if (lit >= 0) lit = 0; render(); return;
        case 'no-avatar': noAvatar(); return;
        case 'use-drawn': useDrawn(); return;
        case 'motion': stepMotion(); return;
        case 'part': if (openPart === el.dataset.part) closePart(true); else { if (openPart) closePart(true); openPartRow(el.dataset.part); } return;
        case 'opt': {
          const key = el.dataset.part;
          if (openPart !== key) { openPart = key; openBefore = draft?.[key]; }
          setPart(key, el.dataset.value);
          const idx = partOf(key).options.findIndex((o) => o.id === el.dataset.value);
          if (lit >= 0) { lit = idx; render(); }
          return;
        }
        case 'done': closePart(true); return;
        case 'surprise': doSurprise(); return;
        case 'cancel': toShow(); return;
        case 'save': save(); return;
        case 'back': back(); return;
        case 'copy': copy(el.dataset.which); return;
        default:
      }
    }

    // ---- drawing ---------------------------------------------------------------------------
    const btn = (a, label, extra = '') => `<button type="button" class="av-btn" data-walk data-act="${a}"${extra}>${label}</button>`;
    const avatarSvg = (rec) => renderAvatar(rec, { animate: moving() });

    function pictureSlot(ref, label = 'The chosen picture') {
      return `<span class="av-pic" data-avatar-picture data-source="${esc(ref.sourceId)}" data-path="${esc(ref.path)}" role="img" aria-label="${esc(label)}"><span class="ab-img" data-img></span></span>`;
    }
    function loadPictures() {
      for (const el of mount.querySelectorAll('[data-avatar-picture]')) {
        images.load(el, { sourceId: el.dataset.source, path: el.dataset.path }, { alt: '' });
      }
    }

    function showHtml() {
      const s = saved();
      let face;
      if (s.use === 'drawn' && s.drawn) face = `<div class="av-face" data-avatar-shown="drawn">${avatarSvg(s.drawn)}</div>`;
      else if (s.use === 'picture' && s.picture) face = `<div class="av-face" data-avatar-shown="picture">${pictureSlot(s.picture, 'Avatar picture')}</div>`;
      else face = '<div class="av-face av-empty" data-avatar-shown="none"><p>No avatar. That is fine: an avatar is optional.</p></div>';
      const btns = cfg.allowChange ? [
        btn('make', s.drawn ? 'Change the drawn avatar' : 'Make an avatar'),
        btn('to-picture', 'Use a picture instead'),
        btn('to-own', 'Make your own'),
        s.use === 'picture' && s.drawn ? btn('use-drawn', 'Use the drawn one again') : '',
        s.use !== 'none' ? btn('motion', `Movement: ${esc(MOTION_CHOICES.find((c) => c.value === personChoice()).label)}`,
          ` data-motion-choice="${personChoice() === null ? 'usual' : personChoice() ? 'moves' : 'still'}"`) : '',
        s.use !== 'none' ? btn('no-avatar', 'No avatar') : '',
      ].join('') : '';
      return `<div class="av-show">${face}<div class="av-btns">${btns}</div></div>`;
    }

    function partRowHtml(p) {
      const o = optionFor(draft, p.key);
      const open = openPart === p.key;
      const sw = p.color && o.hex ? `<span class="av-sw" style="background:${esc(o.hex)}" aria-hidden="true"></span>` : '';
      let choices = '';
      if (open) {
        const opts = p.options.map((x) => {
          const on = draft[p.key] === x.id;
          const swx = p.color ? (x.hex ? `<span class="av-sw" style="background:${esc(x.hex)}" aria-hidden="true"></span>` : '<span class="av-sw av-sw-none" aria-hidden="true"></span>') : '';
          return `<button type="button" class="av-opt" data-walk data-act="opt" data-part="${p.key}" data-value="${esc(x.id)}" aria-pressed="${on}">${swx}${esc(x.name)}</button>`;
        }).join('');
        const free = p.color
          ? `<label class="av-free">Any colour <input type="color" data-free="${p.key}" value="${esc(normalizeHex(o.hex) || '')}"></label>` : '';
        choices = `<div class="av-choices" role="group" aria-label="${esc(p.label)}">${opts}${free}<button type="button" class="av-btn av-done" data-act="done">Done</button></div>`;
      }
      return `<div class="av-part${open ? ' av-open' : ''}">
        <button type="button" class="av-row" data-walk data-act="part" data-part="${p.key}" aria-expanded="${open}">
          <span class="av-label">${esc(p.label)}</span><span class="av-val" data-val="${p.key}">${sw}${esc(o.name)}</span>
        </button>${choices}</div>`;
    }

    function makeHtml() {
      const warns = avatarWarnings(draft, { min: Number(cfg.warnBelow) || DEFAULT_WARN_BELOW });
      return `<div class="av-make" data-open="${openPart || ''}">
        <div class="av-preview">
          <div class="av-face" data-avatar-preview>${avatarSvg(draft)}</div>
          <p class="av-desc" data-avatar-desc>${esc(describeAvatar(draft))}</p>
          <div class="av-warn" role="status" data-avatar-warnings>${warns.map((w) => `<p data-warn="${w.part}">${esc(w.text)}</p>`).join('')}</div>
        </div>
        <div class="av-parts">${PARTS.map(partRowHtml).join('')}
          <div class="av-btns">${MAKE_ACTIONS.map((x) => btn(x.act, x.label)).join('')}</div>
        </div>
      </div>`;
    }

    function ownHtml() {
      return `<div class="av-own">
        <p class="av-head">Make your own avatar with an AI</p>
        <p class="av-hint"><b>Only make an avatar of yourself, or of someone who has said yes.</b> A photo sent to an
          online image AI leaves your computer. If that is not all right, use the second prompt: it needs a
          description, not a photo, or use an AI that runs on your own computer.</p>
        <p class="av-head">From a photo</p>
        <pre class="av-prompt" data-prompt="photo">${esc(PROMPT_PHOTO)}</pre>
        ${btn('copy', 'Copy the photo prompt', ' data-which="photo"')}
        <p class="av-head">From a description, no photo</p>
        <pre class="av-prompt" data-prompt="describe">${esc(PROMPT_DESCRIBE)}</pre>
        ${btn('copy', 'Copy the description prompt', ' data-which="describe"')}
        ${msg ? `<p class="av-msg" role="status" data-avatar-msg>${esc(msg)}</p>` : ''}
        <p class="av-hint">Save what the AI makes into one of your picture folders, then choose it with
          <b>Use a picture instead</b>. A drawing saved as an SVG file can move: if its eyes are in a group
          named eyes they blink, and the figure breathes gently. Anything in the file that could run, or
          reach another website, is taken out before it is shown; a file that cannot be made safe shows as
          a still picture. Photos and other pictures stay still.</p>
        <div class="av-btns">${btn('to-picture', 'Use a picture instead')}${btn('back', draft ? 'Back to making one' : 'Back')}</div>
      </div>`;
    }

    function render() {
      if (dead || !rootEl) return;
      if (!cfg.allowChange && view !== 'show') { view = 'show'; draft = null; openPart = null; }
      // THE PICTURE VIEW IS THE SHARED PICKER, mounted once and left alone while it is open: a
      // redraw here would throw away where somebody had got to in it.
      if (view === 'picture') {
        if (picker && rootEl.querySelector('[data-avatar-picker]')) return;
        images.releaseAll();
        rootEl.innerHTML = '<div class="av" data-avatar-maker data-view="picture"><div class="av-picture" data-avatar-picker></div></div>';
        openPicker(rootEl.querySelector('[data-avatar-picker]'));
        return;
      }
      closePicker();
      images.releaseAll();
      const html = view === 'make' && draft ? makeHtml() : view === 'own' ? ownHtml() : showHtml();
      rootEl.innerHTML = `<div class="av" data-avatar-maker data-view="${view}">${html}</div>`;
      loadPictures();
      paintLit();
    }

    // ---- the walk ----------------------------------------------------------------------------
    // With a part open, the walk is that part's choices; otherwise every [data-walk] in reading order.
    const walk = () => {
      const sel = view === 'make' && openPart ? `[data-act="opt"][data-part="${openPart}"]` : '[data-walk]';
      return [...mount.querySelectorAll(sel)].filter((b) => !b.disabled && !b.closest('[hidden]'));
    };
    function paintLit() {
      const list = walk();
      if (lit >= list.length) lit = list.length ? list.length - 1 : -1;
      list.forEach((b, i) => {
        if (i === lit) { b.dataset.on = '1'; b.setAttribute('aria-current', 'true'); }
        else { delete b.dataset.on; b.removeAttribute('aria-current'); }
      });
      if (lit >= 0) { try { list[lit]?.scrollIntoView?.({ block: 'nearest' }); } catch { /* no layout */ } }
    }
    function moveLit(d) {
      if (view === 'picture' && picker) { if (d > 0) picker.next(); else picker.prev(); return; }
      if (view === 'make' && openPart) { if (lit < 0) lit = 0; stepOpen(d); return; }
      const n = walk().length;
      if (!n) return;
      lit = lit < 0 ? (d > 0 ? 0 : n - 1) : ((lit + d) % n + n) % n;
      paintLit();
    }
    function selectLit() {
      if (view === 'picture' && picker) { picker.select(); return; }
      if (view === 'make' && openPart) {
        if (lit < 0) { lit = Math.max(0, partOf(openPart).options.findIndex((o) => o.id === draft?.[openPart])); paintLit(); return; }
        closePart(true); return;
      }
      const list = walk();
      if (!list.length) return;
      if (lit < 0) { lit = 0; paintLit(); return; }
      act(list[lit]);
    }
    function back() {
      // In the picker, `back` is the picker's: out of a row of pictures, then (from its rows) Cancel.
      if (view === 'picture' && picker) { picker.back(); return; }
      if (view === 'make' && openPart) { closePart(false); return; }
      if (view === 'make') { toShow(); return; }
      // From the picture or the prompts, back to the avatar being made, if one is.
      if ((view === 'own' || view === 'picture') && draft) { view = 'make'; msg = ''; if (lit >= 0) lit = 0; render(); return; }
      if (view !== 'show') toShow();
    }

    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      if (b && mount.contains(b)) act(b);
    }
    function onInput(e) {
      const key = e.target?.dataset?.free;
      if (!key || !draft) return;
      const hex = normalizeHex(e.target.value);
      if (hex) { draft = normalizeRecord({ ...draft, [key]: hex }); if (!openPart) openPart = key; render(); }
    }
    function onKey(e) {
      if (e.target?.matches?.('input,textarea,select')) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); moveLit(1); }
      else if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); moveLit(-1); }
      else if (k === 'Escape') { e.preventDefault(); back(); }
      // Enter works the lit stop once the walk has started; before that, a focused button's own click.
      else if (k === 'Enter' && lit >= 0) { e.preventDefault(); selectLit(); }
    }

    const applyCfg = (s) => {
      const snap = s || {};
      const next = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (snap[k] !== undefined) next[k] = snap[k];
      cfg = next;
    };

    return {
      __probe: () => ({ view, lit, openPart, draft: draft ? { ...draft } : null, saved: saved(), cfg: { ...cfg },
        moving: moving(), motionWhy: motionNow().because, personChoice: personChoice(), litAct: lit >= 0 ? walk()[lit]?.dataset.act : null,
        litLabel: lit >= 0 ? walk()[lit]?.textContent.trim().replace(/\s+/g, ' ') : null,
        stored: personStore ? 'person' : 'panel', picker: picker ? picker.__probe() : null }),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../avatar.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-avatar-css href="${esc(cssHref)}">` : ''}<div class="av-wrap" data-avatar-root></div>`;
        rootEl = mount.querySelector('[data-avatar-root]');
        mount.addEventListener('click', onClick);
        mount.addEventListener('keydown', onKey);
        mount.addEventListener('input', onInput);
        applyCfg(state?.get?.());
        state?.subscribe?.((s) => { applyCfg(s); render(); });
        ensureStore();
        bus.subscribe('avatar/next', () => moveLit(1));
        bus.subscribe('avatar/prev', () => moveLit(-1));
        bus.subscribe('avatar/select', () => selectLit());
        bus.subscribe('avatar/back', () => back());
        render();
      },
      onResize() {},
      onHide() { try { state?.flush?.(); personStore?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        mount.removeEventListener('click', onClick);
        mount.removeEventListener('keydown', onKey);
        mount.removeEventListener('input', onInput);
        closePicker();
        images.releaseAll();
        closeStore();
        // The drawing goes with the panel, so its CSS movement stops with it.
        if (rootEl) rootEl.innerHTML = '';
      },
    };
  },
);
