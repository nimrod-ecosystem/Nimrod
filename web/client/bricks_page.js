// bricks_page.js — THE BRICKS PAGE (bricks.html): every basic Nimrod brick, with its picture, its size and its
// 3D model, and the furniture built from them.
//
// Mike, 2026-10-02: "Can I see all the bricks somewhere?" The bricks were published (design-assets/bricks,
// bricks.json) with no picture of any of them: the only way to see one was to download its GLB and open it in
// a viewer. The pictures are baked headless by the private repo's Blender/render_bricks.py (a 3/4 view, grey,
// transparent), one 512 px and one 128 px per brick, beside the GLBs in renders/.
//
// `?build=<assembly id>` (e.g. ?build=desk_v1) shows ONE build: its picture, and only the bricks it is made of,
// each with how many. That is where a brick-built piece's "Open its bricks" goes (edit mode, modules/room.js).
// `#<brick id>` scrolls to that brick (the library's "See every brick").
//
// Pure helpers are exported for dev/bricks_page_test.html; `mountBricksPage` draws into the page.

import { buildUrls, tintedPicture, BRICK_BUILDS, BRICKS_BASE, bricksPageFor } from './brick_builds.js';

export const KIND_GROUPS = Object.freeze([
  Object.freeze({ id: 'bricks', label: 'Bricks', kinds: Object.freeze(['brick']) }),
  Object.freeze({ id: 'brackets', label: 'Brackets', kinds: Object.freeze(['lbracket', 'corner3']) }),
  Object.freeze({ id: 'plates', label: 'Plates', kinds: Object.freeze(['plate']) }),
]);
export const CONNECTOR_ID = 'CONN_10_collar_v1';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "40 × 80 × 160 mm" */
export const sizeWords = (dims) => (Array.isArray(dims) && dims.length === 3 && dims.every(Number.isFinite) ? `${dims.join(' × ')} mm` : '');
/** "141 KB" */
export const kb = (bytes) => (Number.isFinite(bytes) && bytes > 0 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '');

/** bricks.json's objects, valid ones only, grouped by KIND_GROUPS (a kind in none goes under "Other"). */
export function groupParts(doc) {
  const objs = (doc && Array.isArray(doc.objects) ? doc.objects : []).filter((o) => o && typeof o.id === 'string' && /^[A-Za-z0-9_]+$/.test(o.id));
  const groups = KIND_GROUPS.map((g) => ({ id: g.id, label: g.label, parts: objs.filter((o) => g.kinds.includes(o.kind)) }));
  const other = objs.filter((o) => !KIND_GROUPS.some((g) => g.kinds.includes(o.kind)));
  if (other.length) groups.push({ id: 'other', label: 'Other parts', parts: other });
  return groups.filter((g) => g.parts.length);
}

/** An assembly's counts: { counts: Map id -> n, parts, collars } from its `bom` (else by counting `parts`). */
export function buildCounts(asm) {
  const counts = new Map();
  let collars = 0;
  if (asm && asm.bom && typeof asm.bom === 'object') {
    for (const [id, n] of Object.entries(asm.bom)) {
      if (!Number.isFinite(n) || n <= 0) continue;
      if (id === CONNECTOR_ID) collars = n; else counts.set(id, n);
    }
  } else if (asm && Array.isArray(asm.parts)) {
    for (const p of asm.parts) if (p && typeof p.part === 'string') counts.set(p.part, (counts.get(p.part) || 0) + 1);
  }
  let parts = 0;
  for (const n of counts.values()) parts += n;
  return { counts, parts, collars };
}

/** A build id as it may appear in a URL: letters, digits, underscores. */
export const cleanBuildId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(v) ? v : null);

/** One brick's card (HTML). `count`: how many a build uses (shown as "× n"), or null. */
export function cardHtml(o, { count = null } = {}) {
  const size = sizeWords(o.dims_mm);
  const glb = typeof o.glb === 'string' && /^\/[A-Za-z0-9_./-]+\.glb$/.test(o.glb) ? o.glb : '';
  return `<article class="card" id="${esc(o.id)}" data-brick="${esc(o.id)}">
    <div class="pic" data-pic="${esc(o.id)}" data-src="${esc(`${BRICKS_BASE}renders/${o.id}.png`)}" data-small="${esc(`${BRICKS_BASE}renders/${o.id}_sm.png`)}" role="img" aria-label="${esc(`${o.title || o.id}, seen from above and to one side`)}"></div>
    ${count ? `<span class="count" data-count>× ${esc(count)}</span>` : ''}
    <h3>${esc(o.title || o.id)}</h3>
    <p class="size" data-size>${esc(size)}</p>
    <p class="meta">${Number.isFinite(o.sockets) ? `${esc(o.sockets)} sockets` : ''}${o.fits_bed_256 === false ? ' · needs a printer bed over 256 mm' : ''}</p>
    ${glb ? `<a class="btn" href="${esc(glb)}" download data-glb>Download the 3D model (GLB${kb(o.bytes_glb) ? `, ${esc(kb(o.bytes_glb))}` : ''})</a>` : ''}
  </article>`;
}

/** A build's card (HTML), for the "built from bricks" list. */
export function buildCardHtml(b) {
  const u = buildUrls(b.id);
  return `<article class="card build" data-build-card="${esc(b.id)}">
    <div class="pic" data-pic="${esc(b.id)}" data-src="${esc(u.threeQuarter)}" data-small="${esc(u.small)}" role="img" aria-label="${esc(`${b.title}, built from Nimrod bricks`)}"></div>
    <h3>${esc(b.title)}</h3>
    <p class="meta">${esc(`${b.parts} parts: ${b.bricks} bricks, ${b.brackets} brackets`)}</p>
    <a class="btn" href="${esc(bricksPageFor(b.id))}" data-open-build>Its bricks</a>
  </article>`;
}

/** Fill every `.pic` placeholder under `root` with its tinted picture (theme token, so it follows the theme). */
export function fillPictures(root, { color = 'var(--accent)' } = {}) {
  const doc = root.ownerDocument || document;
  for (const el of root.querySelectorAll('.pic[data-src]')) {
    if (el.firstChild) continue;
    const wide = (doc.defaultView?.devicePixelRatio || 1) * el.getBoundingClientRect().width > 160;
    el.append(tintedPicture(doc, wide || !el.dataset.small ? el.dataset.src : el.dataset.small, color, { position: 'center', onFail: (pic) => { pic.remove(); el.dataset.missing = ''; el.textContent = 'No picture yet'; } }));
  }
}

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/**
 * Draw the page into `doc` (bricks.html's elements). Returns { ready: Promise, state() } -- `state()` says what
 * was drawn, for the suite.
 */
export function mountBricksPage(doc = document, { search = (doc.defaultView || window).location.search, fetchImpl = fetch.bind(globalThis) } = {}) {
  const $ = (id) => doc.getElementById(id);
  const st = { build: null, buildMissing: false, cards: 0, groups: [], error: null };
  const params = new URLSearchParams(search || '');
  const want = cleanBuildId(params.get('build'));

  const ready = (async () => {
    let bricks;
    try { bricks = await getJson(`${BRICKS_BASE}bricks.json`, fetchImpl); }
    catch (err) { st.error = String(err && err.message || err); $('grid').innerHTML = '<p class="muted" data-error>The list of bricks could not be loaded just now.</p>'; return st; }
    let asm = null;
    if (want) {
      try { asm = await getJson(buildUrls(want).assembly, fetchImpl); } catch { asm = null; st.buildMissing = true; }
    }
    const { counts, parts, collars } = buildCounts(asm);
    const groups = groupParts(bricks).map((g) => ({ ...g, parts: asm ? g.parts.filter((o) => counts.has(o.id)) : g.parts })).filter((g) => g.parts.length);
    st.groups = groups.map((g) => ({ id: g.id, ids: g.parts.map((o) => o.id) }));
    $('grid').innerHTML = groups.map((g) => `<h3 class="group" data-group="${esc(g.id)}">${esc(g.label)}</h3>`
      + g.parts.map((o) => cardHtml(o, { count: asm ? counts.get(o.id) : null })).join('')).join('')
      || '<p class="muted">No bricks to show.</p>';
    st.cards = groups.reduce((n, g) => n + g.parts.length, 0);

    const head = $('build');
    if (asm) {
      st.build = { id: want, parts, collars, title: asm.title || want };
      const u = buildUrls(want);
      const merged = asm.display && typeof asm.display.merged_glb === 'string' ? asm.display.merged_glb : '';
      $('title').textContent = `${asm.title || want}: its bricks`;
      $('lede').textContent = `Built from ${parts} Nimrod parts, each shown below with how many it takes`
        + (collars ? `, plus ${collars} connector collars that join them.` : '.');
      head.innerHTML = `<div class="pic big" data-pic="${esc(want)}" data-src="${esc(u.threeQuarter)}" role="img" aria-label="${esc(`${asm.title || want}, built from Nimrod bricks`)}"></div>
        <div class="build-text">
          <p class="meta">${asm.bbox_mm ? esc(`${(asm.bbox_mm.max[0] - asm.bbox_mm.min[0])} × ${(asm.bbox_mm.max[1] - asm.bbox_mm.min[1])} × ${(asm.bbox_mm.max[2] - asm.bbox_mm.min[2])} mm`) : ''}</p>
          <p class="actions">${merged ? `<a class="btn" href="${esc(merged)}" download data-merged>The whole piece as one 3D model (GLB)</a>` : ''}
            <a class="btn" href="${esc(u.assembly)}" data-assembly>Its parts list (JSON)</a>
            <a class="btn" href="/bricks.html" data-all>Every brick</a></p>
        </div>`;
      head.hidden = false;
      $('builds-sec').hidden = true;
    } else {
      if (st.buildMissing) {
        head.innerHTML = `<p class="muted" data-missing-build>There is no build called “${esc(want)}”. Here is every brick.</p>`;
        head.hidden = false;
      }
      $('builds').innerHTML = Object.values(BRICK_BUILDS).map(buildCardHtml).join('');
      $('builds-sec').hidden = false;
    }
    fillPictures(doc.body);
    const hash = (doc.defaultView || window).location.hash.slice(1);
    if (hash && /^[A-Za-z0-9_]+$/.test(hash)) doc.getElementById(hash)?.scrollIntoView({ block: 'center' });
    return st;
  })();
  return { ready, state: () => st };
}
