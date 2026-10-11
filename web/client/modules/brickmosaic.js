// modules/brickmosaic.js — BRICK MOSAIC: A PICTURE BUILT FROM NIMROD BRICKS, ONE BRICK AT A TIME (brick games, row 2.76,
// 2026-10-10).
//
// Mike, 2026-10-09: "Any other ideas for games with our bricks?" Chat's list: "a photo turned into a brick mosaic, built
// a brick at a time". The arithmetic (cells, nearest colours, joined bricks, the order) is `../brick_mosaic.js`; this
// file is the panel: where the picture comes from, the pace, the presses, and the drawing.
//
// *** CALM TO WATCH, OR A PRESS AT A TIME (`mode`, argued). ***
//   'watch' (DEFAULT) It builds by itself, a brick every `paceMs`, from the bottom row up, like a wall. When it is
//          finished it stays `holdMs`, then the next picture begins. A press lays the rest of the row at once (or
//          finishes it: `pressDoes`); on a finished picture a press starts the next one. Nobody has to press anything.
//   'press' Nothing is laid until a press; each press lays the next row (or the whole picture). Cause and effect for
//          one switch: every press visibly builds something.
//   FOR 'watch' as the default: chat asked for "something calm to watch without pressing anything", and a panel that
//   waits for a press shows an empty board to a room where nobody may be able to press. AGAINST: as a game it is
//   watched more than played. 'press' is one setting away.
//
// *** THE PICTURE COMES FROM THE PERSON'S OWN PHOTO SOURCES, THE WAY THE PHOTOS PANEL GETS THEM (photos.js). *** The
// source chosen on this panel ("Pictures from"), or, with none chosen, the screen's only photo source; its album and
// "every folder inside" the same two settings as Photos. Every listing goes through `quietResolve` (media_sources.js),
// so a source on another computer is never asked and Chrome's local-network box cannot come up by itself. More than one
// source and none chosen: it does not guess (photos.js argues why a coin flip about whose photographs appear is wrong),
// it uses the built-in picture and the settings row says to choose one.
// THE BUILT-IN PICTURE when there is no photo, or the photo cannot be read: Frederic Edwin Church, "Twilight in the
// Wilderness" (1860), Cleveland Museum of Art Open Access, CC0 - already on the site for the art lessons
// (learn/images/cma, its manifest records the licence). A sunset over hills: many colours, a clear horizon, nobody's
// face. If even that cannot be read, a drawn sky-and-hills picture, so the panel is never empty.
// NOTHING GOES TO THE SERVER: the picture is read in the browser, straight from the person's own source (the media
// agent sends the CORS header on files: web/media_agent/agent.py), and only the panel's settings are saved. A picture
// the browser will not let a page read (another site without that header) is skipped for the built-in one.
//
// *** NUMBERS, ARGUED (Rule 1). Every one a person would change is a setting below. ***
//   paceMs 1000 (a brick a second): about 3 to 5 minutes for a picture at 24 across - slow enough to watch a picture
//          appear, quick enough that it does. FOR faster: an impatient watcher. AGAINST: it stops being calm.
//   cols 24 across: a face is recognisable at about 20 cells across; 24 is still a brick wall, not pixels.
//   holdMs 60 s: long enough to look at the finished picture, short enough that the next one comes.
//   SAMPLE_CELLS 4: each cell is averaged from 4 x 4 pixels of the picture drawn small, so a cell is the cell's colour,
//          not one pixel's (not a setting: nobody's picture is better for changing it).
//   LISTING_WAIT_MS: media_sources.js's own wait for a listing, used as is.

import { registerModule } from '../module.js';
import { createPointsLedger } from '../points.js';
import {
  createMediaSourcesClient, resolveListing, quietResolve, quietReach, listingWithin, LISTING_WAIT_MS,
  subfoldersField, listOptions, withListOptions, albumField, createAlbumChooser, topFoldersLister, mediaUrl,
} from '../media_sources.js';
import { personSources, personOf } from '../person_known.js';
import { pick as rngPick, record } from '../rng.js';   // the shared weighted picker, as Photos uses
// hide picture (photos.js): a picture hidden from the slideshow is never made into a mosaic either.
import { deviceHiddenPictures, pictureKey } from '../hidden_pictures.js';
import { autostartFields, shouldAutostart, panelAlone, createPlayWatch, START_VOICE, ensureStartStyle, startOverlayHtml } from '../game_start.js';
import { BRICK_COLOURS, BRICK_COLOUR_COUNT, brickColourVar } from '../brick_colours.js';
import { ALL_BRICK_COLOURS, ORDERS, JOIN_MAX, makeMosaic, restOfRow, parseColour, toHex } from '../brick_mosaic.js';

export const GAME = 'brickmosaic';
export const TITLE = 'Brick mosaic';
export const SAMPLE_URL = new URL('../learn/images/cma/files/1965_233.jpg', import.meta.url).href;
export const SAMPLE_LABEL = 'Twilight in the Wilderness, by Frederic Edwin Church, 1860 (a public domain painting)';
export const SAMPLE = 'sample';
const SAMPLE_CELLS = 4;
const RECENT = 12;          // the last pictures used are not picked again (photos.js's RECENT_CAP)
export const VOICE = Object.freeze({ more: 'select', faster: 'select', 'next picture': 'next', ...START_VOICE });

export const LINES = Object.freeze({
  press: 'Press to lay the next row.',
  pressAll: 'Press to lay the whole picture.',
  done: 'Finished. Press for the next picture.',
  loading: 'Finding a picture…',
});
// Why the built-in picture is showing, for the line under "Pictures from".
export const WHY = Object.freeze({
  sample: 'The built-in picture, as chosen.',
  none: 'No photo source here yet, so the built-in picture. Add one in Media / Sources.',
  many: 'There is more than one photo source. Choose one in "Pictures from". Until then, the built-in picture.',
  gone: 'The chosen source is not connected any more, so the built-in picture.',
  elsewhere: 'That source is on another computer, so the built-in picture here.',
  failed: 'That source could not be read just now, so the built-in picture.',
  empty: 'That source has no pictures, so the built-in picture.',
  unreadable: 'That picture could not be read here, so the built-in picture.',
});

export const DEFAULTS = Object.freeze({
  autostart: true,
  autostartAlone: 'same',
  mode: 'watch',
  pressDoes: 'row',
  paceMs: 1000,
  cols: 24,
  palette: 'theme',
  stretch: true,
  dither: false,
  join: true,
  joinMax: JOIN_MAX,
  order: 'rows',
  holdMs: 60000,
  sourceId: '',
  album: '',
  finishPoints: 1,
});

const notSample = (v) => !!v && v.sourceId !== SAMPLE;
const SETTINGS = [
  { key: 'mode', label: 'How it is built', kind: 'choice', default: 'watch', level: 'essential',
    options: [{ value: 'watch', label: 'By itself, a brick at a time. Calm to watch' },
      { value: 'press', label: 'A press at a time. Nothing is laid without one' }] },
  { key: 'pressDoes', label: 'A press', kind: 'choice', default: 'row', level: 'standard',
    options: [{ value: 'row', label: 'Lays the rest of the row at once' }, { value: 'finish', label: 'Finishes the picture' }],
    note: 'On a finished picture, a press starts the next one.' },
  { key: 'paceMs', label: 'How fast it builds by itself', kind: 'choice', default: 1000, level: 'standard',
    options: [{ value: 250, label: 'Four bricks a second' }, { value: 500, label: 'Two bricks a second' },
      { value: 1000, label: 'A brick a second' }, { value: 2000, label: 'A brick every 2 seconds' }],
    appliesWhen: (v) => !v || v.mode !== 'press' },
  { key: 'cols', label: 'How many bricks across', kind: 'choice', default: 24, level: 'standard',
    options: [{ value: 16, label: '16: big bricks' }, { value: 24, label: '24' }, { value: 32, label: '32' }, { value: 48, label: '48: fine detail' }],
    note: 'Starts with the next picture.' },
  { key: 'palette', label: 'Brick colours', kind: 'choice', default: 'theme', level: 'standard',
    options: [{ value: 'theme', label: 'The theme\'s five brick colours' }, { value: 'all', label: 'Every brick colour, from every theme' }] },
  { key: 'stretch', label: 'Fit the picture\'s light and dark to the colours', default: true, level: 'advanced',
    onLabel: 'Yes: faces and shapes stay clear', offLabel: 'No: each cell takes its nearest colour as it is' },
  { key: 'dither', label: 'Mix bricks for in-between shades', default: false, level: 'advanced',
    onLabel: 'Yes: more detail, busier', offLabel: 'No: calmer' },
  { key: 'join', label: 'Bricks side by side in one colour join into longer bricks', default: true, level: 'advanced',
    onLabel: 'Yes', offLabel: 'No: every cell its own brick' },
  { key: 'joinMax', label: 'The longest brick', kind: 'choice', default: JOIN_MAX, level: 'advanced',
    options: [{ value: 2, label: '2 cells (80 mm)' }, { value: 3, label: '3 cells (120 mm)' }, { value: 4, label: '4 cells (160 mm)' },
      { value: 8, label: '8 cells (320 mm)' }],
    appliesWhen: (v) => !v || v.join !== false },
  { key: 'order', label: 'Where the bricks go in', kind: 'choice', default: 'rows', level: 'standard',
    options: [{ value: 'rows', label: 'From the bottom row up, like a wall' }, { value: 'scatter', label: 'Here and there, all over' }] },
  { key: 'holdMs', label: 'A finished picture stays', kind: 'choice', default: 60000, level: 'standard',
    options: [{ value: 30000, label: '30 seconds' }, { value: 60000, label: '1 minute' }, { value: 300000, label: '5 minutes' },
      { value: 0, label: 'Until a press' }],
    appliesWhen: (v) => !v || v.mode !== 'press' },
  // Where the picture comes from. A mounted panel adds every connected source (`settingsChoices`), as Photos does.
  { key: 'sourceId', label: 'Pictures from', kind: 'choice', default: '', level: 'standard',
    options: [{ value: '', label: 'Your photos (the only photo source, when there is one)' }, { value: SAMPLE, label: 'The built-in picture' }] },
  albumField({ level: 'advanced', appliesWhen: (v) => notSample(v) && !!v.sourceId }),
  subfoldersField({ on: true, what: 'pictures', appliesWhen: (v) => notSample(v) }),
  ...autostartFields({ on: true }),
  { key: 'finishPoints', label: 'Play points for a picture built a press at a time', kind: 'number', default: 1, min: 0, max: 20, step: 1,
    level: 'advanced', note: 'Only when it is built by presses. 0 means it pays nothing.' },
];

/** The theme's five brick colours as read off `el` (hex), or the default theme's where it says nothing. */
export function themeBrickColours(el) {
  let cs = null;
  try { cs = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null; } catch { cs = null; }
  return Array.from({ length: BRICK_COLOUR_COUNT }, (_, i) => {
    const v = cs ? cs.getPropertyValue(brickColourVar(i)).trim() : '';
    const rgb = parseColour(v);
    return rgb ? toHex(rgb) : BRICK_COLOURS.default[i].hex;
  });
}

/** A picture drawn here, for when not even the built-in painting can be read: sky, sun, hills. RGBA, w x h. */
export function drawnPicture(w = 96, h = 64) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = y / h;
      let r = 40 + 200 * t, g = 90 + 90 * t, b = 200 - 80 * t;                     // sky: blue to warm
      const sx = x - w * 0.7, sy = y - h * 0.35;
      if (sx * sx + sy * sy < (h * 0.12) ** 2) { r = 250; g = 210; b = 90; }       // the sun
      const hill = h * (0.62 + 0.08 * Math.sin(x / w * Math.PI * 2.2));
      if (y > hill) { r = 50; g = 110 + 40 * Math.sin(x / 9); b = 60; }            // the hills
      if (y > h * 0.88) { r = 90; g = 70; b = 40; }                                 // the ground
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, w, h };
}

/** Read a picture's pixels, small: { data, w, h }. Rejects when it will not load, or the browser will not let it be read. */
export function readPixels(url, { cols = 24, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
  return new Promise((resolve, reject) => {
    if (!doc || typeof Image !== 'function') { reject(new Error('no document')); return; }
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';   // the agent answers with the CORS header; others: unreadable
    img.decoding = 'async';
    img.onload = () => {
      try {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        if (!(iw > 0 && ih > 0)) { reject(new Error('empty picture')); return; }
        const c = Math.max(2, Math.round(cols)) * SAMPLE_CELLS;
        const w = Math.min(iw, c), h = Math.max(1, Math.round((w * ih) / iw));
        const cv = doc.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        resolve({ data: g.getImageData(0, 0, w, h).data, w, h });   // throws (SecurityError) on a picture it may not read
      } catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error('picture did not load'));
    img.src = url;
  });
}

// THE PANEL'S OWN LOOK. Theme roles only; the bricks' colours are the theme's (read off the element) or the full set.
const STYLE_ID = 'brickmosaic-style';
const CSS = `
.bm-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;position:relative;cursor:pointer}
.bm-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px;box-shadow:inset 0 0 0 5px var(--surface, Canvas)}
.bm{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:.3rem;padding:.4rem;box-sizing:border-box;font-family:var(--font)}
.bm [hidden]{display:none !important}
.bm-stage{min-height:0;position:relative}
.bm-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.bm-say{margin:0;text-align:center;font-size:clamp(14px, 2.2vmin, 26px);font-weight:600;color:var(--text-strong, var(--text))}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

registerModule(
  { type: GAME, title: TITLE, core: 'new',
    description: 'A picture from your photos built out of Nimrod bricks, one brick at a time, in the theme\'s brick colours. '
      + 'Calm to watch. A press lays a row at once, or finishes it. With no photos, a built-in painting.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state, user } = ctx;
    const rand = ctx.rand || Math.random;
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const read = typeof ctx.readPixels === 'function' ? ctx.readPixels : readPixels;
    const scoped = ctx.sources ? null : personSources(ctx,
      (pid) => createMediaSourcesClient({ user, cache: true, personId: pid }),
      { onChange: () => { if (!dead && cfg.sourceId !== SAMPLE) nextPicture(); } });
    const client = ctx.sources || scoped;
    const listPics = quietResolve(withListOptions(ctx.resolveListing || resolveListing, (s) => listOptions(cfg, s && s.id)),
      { check: ctx.checkFromHere || null });
    const albumChooser = createAlbumChooser({ listTop: topFoldersLister({ resolve: ctx.resolveListing || null, check: ctx.checkFromHere || null }) });
    const plays = createPlayWatch(bus, ctx);
    const hides = ctx.hiddenPictures || deviceHiddenPictures({ history: ctx.history || null });
    const hiddenNow = () => { try { return hides.paths(personOf(ctx) || ''); } catch { return new Set(); } };

    let cfg = { ...DEFAULTS };
    let dead = false, hidden = false, started = true;
    let mosaic = null;          // { cols, rows, bricks, palette, colours }
    let laid = 0;               // bricks laid so far
    let phase = 'loading';      // loading | building | done
    let pressed = false;        // this picture had a press that built something (for the points)
    let allByPress = true;      // every brick of this picture was laid by a press
    let picture = null;         // { label, url, sourceId, why }
    let pixels = null;          // the picture read, kept so a change of colours re-matches without reading it again
    let knownSources = [];
    let recent = [];
    // The shared weighted picker's counts for this panel (rng.js: freshness, recency, folder diversity). Page memory
    // only: a mosaic takes minutes, so the few pictures one panel builds in a day need no play log of their own.
    let pickStats = {};
    let loadSeq = 0;
    let buildTimer = null, holdTimer = null;
    let rootEl = null, canvas = null, sayEl = null, overlayEl = null;
    let drawnUpTo = 0, drawnSize = '', paletteKey = '';
    let ledger = null;
    let lastSay = null, lastOverlay = null;

    const mode = () => (cfg.mode === 'press' ? 'press' : 'watch');
    const pace = () => Math.max(50, Number(cfg.paceMs) || DEFAULTS.paceMs);
    const coloursNow = () => (cfg.palette === 'all' ? ALL_BRICK_COLOURS.map((c) => c.hex) : themeBrickColours(rootEl || mount));

    // ---- timers -------------------------------------------------------------------------------------------
    function stopBuild() { if (buildTimer != null) { try { clearT(buildTimer); } catch { /* gone */ } buildTimer = null; } }
    function stopHold() { if (holdTimer != null) { try { clearT(holdTimer); } catch { /* gone */ } holdTimer = null; } }
    function schedule() {
      stopBuild(); stopHold();
      if (dead || hidden || !started || !mosaic) return;
      if (phase === 'building' && mode() === 'watch') {
        buildTimer = setT(() => { buildTimer = null; if (dead) return; allByPress = false; lay(laid + 1); schedule(); }, pace());
      } else if (phase === 'done' && mode() === 'watch') {
        const hold = Number(cfg.holdMs);
        if (hold > 0) holdTimer = setT(() => { holdTimer = null; if (!dead) nextPicture(); }, hold);
      }
    }

    // ---- laying -------------------------------------------------------------------------------------------
    function lay(upTo) {
      if (!mosaic || phase !== 'building') return;
      laid = Math.max(laid, Math.min(mosaic.bricks.length, upTo));
      if (laid >= mosaic.bricks.length) finish();
      draw();
    }
    function finish() {
      phase = 'done';
      // Points only for a picture built a press at a time: one press that finishes what the clock was building is not
      // building it (the same reason Brick breaker's wall pays nothing for a ball that keeps coming back).
      if (mode() === 'press' && allByPress && pressed) pay();
      say();
    }
    function pay() {
      const per = Math.round(Number(cfg.finishPoints) || 0);
      if (!(per > 0) || !ledger) return;
      Promise.resolve(ledger.award({ amount: per, source: GAME, type: 'Play', tags: [GAME], note: `${TITLE}: a picture built` }))
        .catch((err) => console.error('brickmosaic: points', err));
    }

    // ---- the picture ----------------------------------------------------------------------------------------
    // Which source this panel means: the chosen one; none chosen, the only one (asked quietly); otherwise none, and why.
    async function chooseSource() {
      if (cfg.sourceId === SAMPLE) return { source: null, why: 'sample' };
      let sources = [];
      try { sources = (await client.list()) || []; } catch (err) { console.warn('brickmosaic: sources', err); sources = []; }
      knownSources = Array.isArray(sources) ? sources.filter((s) => s && s.id) : [];
      if (cfg.sourceId) {
        const found = knownSources.find((s) => s.id === cfg.sourceId);
        return found ? { source: found } : { source: null, why: 'gone' };
      }
      if (knownSources.length === 1) {
        if (!(await quietReach(knownSources[0], { check: ctx.checkFromHere || null })).quiet) return { source: null, why: 'elsewhere' };
        return { source: knownSources[0] };
      }
      return { source: null, why: knownSources.length ? 'many' : 'none' };
    }
    async function choosePicture() {
      const { source, why } = await chooseSource();
      if (!source) return { why };
      const r = await listingWithin(listPics, source, cfg.album || '', {
        accept: (l) => ((l && l.items) || []).filter((it) => it && it.kind === 'image'),
        waitMs: Number(ctx.listingWaitMs ?? LISTING_WAIT_MS), setTimer: setT, clearTimer: clearT });
      if (r.ok || (r.err && r.err.code === 'album')) albumChooser.heard(source, cfg.album, r.ok ? r.listing : null);
      if (!r.ok) return { why: r.err && r.err.code === 'elsewhere' ? 'elsewhere' : 'failed' };
      // photos.js's wait for the hidden list (bounded, the real clock: a store that never answers must not hold it back)
      await new Promise((done) => { Promise.resolve(hides.ready).then(done, done); setTimeout(done, 1500); });
      const hidden = hiddenNow();
      const shown = hidden.size ? r.items.filter((it) => !hidden.has(pictureKey(it))) : r.items;
      if (!shown.length) return { why: 'empty' };
      const fresh = shown.filter((it) => !recent.includes(`${source.id}:${it.path || it.url}`));
      const pool = fresh.length ? fresh : shown;
      // Mike, 2026-10-10: "Are we using our universal random function for the picture slideshow?" Photos does; so does
      // this now. The last RECENT stay out (above); among the rest, rng.js's pick() favours pictures not built yet and
      // spreads the picks across folders (each picture's folder is its diversity channel), as Photos does.
      const keyOf = (x) => `${source.id}:${x.path || x.url}`;
      const byKey = new Map(pool.map((x) => [keyOf(x), x]));
      const channels = {};
      for (const [k, x] of byKey) { const path = String(x.path || x.url || ''); channels[k] = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
      const chosen = rngPick([...byKey.keys()], pickStats, { now: Date.now(), rand, recent, channels });
      const it = byKey.get(chosen) || pool[0];
      const url = it.url || (source.base_url ? mediaUrl(source.base_url, it.path) : '');
      if (!url) return { why: 'unreadable' };
      return { url, label: it.name || it.path || 'A picture', key: `${source.id}:${it.path || it.url}`, sourceId: source.id };
    }
    async function nextPicture() {
      const seq = ++loadSeq;
      stopBuild(); stopHold();
      phase = 'loading'; say();
      let pick = null;
      try { pick = await choosePicture(); } catch (err) { console.warn('brickmosaic: picture', err); pick = { why: 'failed' }; }
      if (dead || seq !== loadSeq) return;
      let px = null;
      if (pick && pick.url) {
        try { px = await read(pick.url, { cols: Number(cfg.cols) || DEFAULTS.cols }); }
        catch (err) { console.warn('brickmosaic: reading the picture', err); pick = { why: 'unreadable' }; }
        if (dead || seq !== loadSeq) return;
        if (px) { recent = [...recent, pick.key].slice(-RECENT); pickStats = record(pickStats, pick.key, Date.now()); picture = { label: pick.label, url: pick.url, sourceId: pick.sourceId, why: null }; }
      }
      if (!px) {
        const why = (pick && pick.why) || 'failed';
        try { px = await read(SAMPLE_URL, { cols: Number(cfg.cols) || DEFAULTS.cols }); }
        catch (err) { console.warn('brickmosaic: the built-in picture', err); px = drawnPicture(); }
        if (dead || seq !== loadSeq) return;
        picture = { label: SAMPLE_LABEL, url: SAMPLE_URL, sourceId: null, why };
      }
      pixels = px;
      build();
    }
    function build({ keepLaid = false } = {}) {
      if (!pixels) return;
      const colours = coloursNow();
      const was = keepLaid ? laid : 0;
      mosaic = makeMosaic(pixels, colours, { cols: Number(cfg.cols) || DEFAULTS.cols, stretch: cfg.stretch !== false,
        dither: cfg.dither === true, join: cfg.join !== false, joinMax: Number(cfg.joinMax) || JOIN_MAX,
        order: ORDERS.includes(cfg.order) ? cfg.order : 'rows', rand });
      mosaic.colours = colours;
      paletteKey = colours.join(',');
      laid = Math.min(was, mosaic.bricks.length);
      if (!keepLaid) { pressed = false; allByPress = true; }
      phase = laid >= mosaic.bricks.length ? 'done' : 'building';
      drawnUpTo = 0; drawnSize = '';
      draw(); say(); schedule();
    }

    // ---- presses ---------------------------------------------------------------------------------------------
    function start() {
      if (dead || started) return false;
      started = true;
      render(); schedule();
      return true;
    }
    function press() {
      if (dead) return;
      plays.active();
      if (start()) return;
      if (phase === 'loading' || !mosaic) return;
      if (phase === 'done') { nextPicture(); return; }
      pressed = true;
      let upTo;
      if (cfg.pressDoes === 'finish') upTo = mosaic.bricks.length;
      else if (cfg.order === 'scatter') upTo = laid + Math.max(1, Math.ceil(mosaic.bricks.length / mosaic.rows));
      else upTo = restOfRow(mosaic.bricks, laid);
      lay(upTo);
      schedule();
    }
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
      press();
    }
    function onKey(e) {
      if (dead || e.repeat) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); press(); }
    }

    // ---- drawing ---------------------------------------------------------------------------------------------
    function say() {
      if (!sayEl) return;
      let line = '';
      if (!started) line = '';
      else if (phase === 'loading') line = mosaic ? '' : LINES.loading;
      else if (phase === 'done') line = mode() === 'press' || !(Number(cfg.holdMs) > 0) ? LINES.done : '';
      else if (mode() === 'press') line = cfg.pressDoes === 'finish' ? LINES.pressAll : LINES.press;
      if (line !== lastSay) { sayEl.textContent = line; sayEl.hidden = !line; lastSay = line; }
      if (canvas) canvas.setAttribute('aria-label', picture ? `A brick mosaic of ${picture.label}` : 'A brick mosaic');
    }
    function render() {
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      say();
      draw();
    }
    function emptyColour() {
      let cs = null;
      try { cs = getComputedStyle(rootEl || mount); } catch { cs = null; }
      const rgb = parseColour(cs && cs.getPropertyValue('--border').trim());
      return rgb ? toHex(rgb) : '#c9c3ad';
    }
    function shade(hex, k) {   // k < 0 darker, k > 0 lighter (black or white laid over, as brick_face.js's bevel)
      const rgb = parseColour(hex) || [128, 128, 128];
      return toHex(rgb.map((v) => (k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    }
    function geometry() {
      const w = canvas.clientWidth || 0, h = canvas.clientHeight || 0;
      if (!(w > 0 && h > 0) || !mosaic) return null;
      const cell = Math.max(1, Math.floor(Math.min(w / mosaic.cols, h / mosaic.rows)));
      return { w, h, cell, ox: Math.floor((w - cell * mosaic.cols) / 2), oy: Math.floor((h - cell * mosaic.rows) / 2) };
    }
    function drawBrick(g2, G, b, colour) {
      const x = G.ox + b.x * G.cell, y = G.oy + b.y * G.cell, w = b.len * G.cell, h = G.cell;
      const inset = G.cell >= 8 ? 1 : 0;
      g2.fillStyle = colour;
      g2.fillRect(x + inset, y + inset, w - 2 * inset, h - 2 * inset);
      if (G.cell >= 6) {
        const bev = Math.max(1, Math.round(G.cell / 14));
        g2.fillStyle = shade(colour, 0.35); g2.fillRect(x + inset, y + inset, w - 2 * inset, bev); g2.fillRect(x + inset, y + inset, bev, h - 2 * inset);
        g2.fillStyle = shade(colour, -0.35); g2.fillRect(x + inset, y + h - inset - bev, w - 2 * inset, bev); g2.fillRect(x + w - inset - bev, y + inset, bev, h - 2 * inset);
      }
      if (G.cell >= 10) {   // a keyed socket per cell (brick_face.js's proportions: a hole 36% across, slots 52% x 10%)
        const hole = shade(colour, -0.58);
        for (let k = 0; k < b.len; k++) {
          const cx = x + (k + 0.5) * G.cell, cy = y + G.cell / 2;
          g2.fillStyle = hole;
          g2.fillRect(cx - 0.26 * G.cell, cy - 0.05 * G.cell, 0.52 * G.cell, 0.1 * G.cell);
          g2.beginPath(); g2.arc(cx, cy, 0.18 * G.cell, 0, Math.PI * 2); g2.fill();
        }
      }
    }
    function draw() {
      if (dead || !canvas || !mosaic) return;
      const G = geometry();
      if (!G) return;
      const dpr = Math.max(1, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
      const size = `${G.w}x${G.h}@${dpr}:${mosaic.cols}x${mosaic.rows}`;
      const g2 = canvas.getContext('2d');
      if (!g2) return;
      if (size !== drawnSize || laid < drawnUpTo) {
        canvas.width = Math.round(G.w * dpr); canvas.height = Math.round(G.h * dpr);
        g2.setTransform(dpr, 0, 0, dpr, 0, 0);
        g2.clearRect(0, 0, G.w, G.h);
        // The empty board: a plate of sockets, one per cell, in the theme's border colour.
        const empty = emptyColour();
        g2.fillStyle = shade(empty, 0.25);
        g2.fillRect(G.ox, G.oy, G.cell * mosaic.cols, G.cell * mosaic.rows);
        if (G.cell >= 6) {
          g2.fillStyle = empty;
          for (let y = 0; y < mosaic.rows; y++) {
            for (let x = 0; x < mosaic.cols; x++) {
              g2.beginPath(); g2.arc(G.ox + (x + 0.5) * G.cell, G.oy + (y + 0.5) * G.cell, 0.14 * G.cell, 0, Math.PI * 2); g2.fill();
            }
          }
        }
        drawnSize = size; drawnUpTo = 0;
      }
      for (let i = drawnUpTo; i < laid; i++) {
        const b = mosaic.bricks[i];
        drawBrick(g2, G, b, mosaic.palette[b.c] ? mosaic.palette[b.c].hex : '#808080');
      }
      drawnUpTo = laid;
      if (rootEl) { rootEl.dataset.phase = phase; rootEl.dataset.laid = String(laid); }
    }
    // The theme may have changed under the panel (its colours are read off the element): re-match, keep the progress.
    function recolour() {
      if (!pixels || !mosaic) return;
      if (coloursNow().join(',') !== paletteKey) build({ keepLaid: true });
    }

    return {
      __probe: () => ({ cfg: { ...cfg }, phase, laid, total: mosaic ? mosaic.bricks.length : 0, mosaic, picture: picture ? { ...picture } : null,
        started, building: buildTimer != null, holding: holdTimer != null, playing: plays.playing(), sources: knownSources.map((s) => s.id),
        say: sayEl ? sayEl.textContent : '', pressed, allByPress }),
      __recolour: () => recolour(),
      settingsChoices: () => ({
        sourceId: {
          options: [
            { value: '', label: 'Your photos (the only photo source, when there is one)' },
            ...knownSources.map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
            { value: SAMPLE, label: 'The built-in picture' },
          ],
          status: picture ? (picture.why ? WHY[picture.why] || WHY.failed : `Now: ${picture.label}`) : '',
        },
        album: albumChooser.row(cfg.sourceId, cfg.album),
      }),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStartStyle(doc);
        ensureStyle(doc);
        mount.innerHTML = '<div class="bm-wrap gs-host" data-bm-root tabindex="0" aria-label="Brick mosaic"><div class="bm">'
          + '<div class="bm-stage"><canvas class="bm-canvas" data-canvas role="img" aria-label="A brick mosaic"></canvas></div>'
          + '<p class="bm-say" data-say role="status" aria-live="polite" hidden></p>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-bm-root]');
        canvas = mount.querySelector('[data-canvas]');
        sayEl = mount.querySelector('[data-say]');
        overlayEl = mount.querySelector('[data-start-host]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);
        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('brickmosaic: no points ledger', err); }

        const applyCfg = (s = {}) => {
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          for (const k of ['subfolders', 'leaveOut']) if (s[k] !== undefined) next[k] = s[k];
          return next;
        };
        cfg = applyCfg(state?.get?.() || {});
        started = shouldAutostart(state?.get?.() || {}, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) });
        state?.subscribe?.((s) => {
          const was = cfg;
          cfg = applyCfg(s || {});
          if (['sourceId', 'album', 'subfolders'].some((k) => was[k] !== cfg[k])) { nextPicture(); return; }
          if (['cols', 'stretch', 'dither', 'join', 'joinMax', 'order', 'palette'].some((k) => was[k] !== cfg[k])) {
            // The look changed: the same picture again, from the first brick (the order and the bricks are new).
            if (pixels) build(); return;
          }
          render(); schedule();
        });

        bus.subscribe(`${GAME}/press`, () => press());
        bus.subscribe(`${GAME}/next`, () => { plays.active(); if (!start()) nextPicture(); });
        bus.subscribe(`${GAME}/resume`, () => { plays.active(); start(); });

        render();
        nextPicture();
      },
      onResize() { draw(); recolour(); },
      onHide() { hidden = true; stopBuild(); stopHold(); plays.rest(); },
      onShow() { hidden = false; recolour(); draw(); schedule(); },
      destroy() {
        dead = true;
        stopBuild(); stopHold();
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('keydown', onKey);
        try { scoped?.dispose?.(); } catch { /* gone */ }
        try { plays.destroy(); } catch { /* gone */ }
        try { ledger?.destroy?.(); } catch { /* gone */ } ledger = null;
      },
    };
  },
);
