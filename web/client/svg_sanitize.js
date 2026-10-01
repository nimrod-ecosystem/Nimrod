// svg_sanitize.js — AN SVG SOMEBODY BROUGHT IN, MADE SAFE TO DRAW INLINE, so it can move.
//
// Mike, 2026-10-01, on an avatar made with the "make your own" prompt (modules/avatar.js,
// PROMPT_DESCRIBE): "What's the risk? Seems like it should be okay." Until now such a file was shown
// as a still <img>, because an <img> cannot run anything or fetch anything — and also cannot be
// animated from outside. Animating it (the prompt asks the AI for `id="eyes"` and `id="mouth"` groups
// so they can blink and talk) means drawing the file INLINE, in the page, where an SVG CAN do harm.
//
// *** THE RULE THIS FILE KEEPS: NOTHING FROM THE FILE REACHES THE PAGE EXCEPT WHAT IS ON A LIST. ***
// It is an ALLOW-list, never a block-list: the file is parsed (DOMParser, image/svg+xml — an inert
// document: no scripts run, nothing loads), and a NEW drawing is written out from it, element by
// element and attribute by attribute, keeping only known-safe shapes and presentation. Anything not
// on a list — a script, a handler, a link, an embedded page, a picture from elsewhere, a filter, an
// animation element — is simply never written. The threats, and the list entry that answers each:
//
//   <script>, on* handlers           not on the element list / not on the attribute list
//   javascript: / data: URLs          ':' is not a character any kept value may contain
//   <foreignObject> (any HTML)        not on the element list (nor <iframe>, <a>, <image>, <feImage>)
//   external references               href only on <use>/gradients, and only "#id" of an element
//   (href, xlink:href, url())         that is kept; url() only as url(#id) of a kept element
//   <style> restyling the page        rules kept only if every selector is simple; each is rewritten
//                                     to start "#<this avatar's id> ", so it reaches nothing outside;
//                                     every @-rule but @keyframes (@import, @font-face, @media) dropped
//   <use> pointing at other files     covered by the href rule; <use> chains are counted ("expansion")
//   SMIL <set>/<animate>              not on the element list: `<set attributeName="href"
//                                     to="javascript:…">` is a known way round a sanitizer
//   huge / deeply nested / bombs      length checked BEFORE parsing; <!DOCTYPE>/<!ENTITY> refused
//                                     before parsing (entity expansion); element count, depth and
//                                     <use> expansion capped
//   id collisions with the page       every id and class is rewritten with a prefix unique to this
//                                     drawing, and references follow
//   a fast flashing animation         every animation's period is stretched to the flash limit
//                                     (flash_limit.js), counted from its own keyframes
//
// TWO STEPS, so the expensive one happens once per file and the cheap one once per drawing:
//   sanitizeSvg(text, limits)  -> { ok: true, ... } (a clean description) or { ok: false, reason }
//   svgMarkup(clean, { uid, animate, flashLimit, delay })  -> the SVG markup, ids prefixed with `uid`
// A caller that gets `ok: false` shows the file as a still <img>, exactly as before.

import { minFlashPeriodMs, FLASH_LIMIT_DEFAULT } from './flash_limit.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// *** THE CAPS. DEFAULTS, EACH ARGUED; EACH A PARAMETER (`limits`), NOT A LITERAL (Rule 1). ***
//   maxChars 300 000   An AI-drawn cartoon figure is typically 5-60 KB. 300 KB is five times the large
//                      end; past it the file is a traced photo or a bomb, and a Pi 400 parsing it on
//                      every screen that shows the person is the cost. [Guess, on Mike's list.]
//   maxElements 3000   The same reasoning in elements: a figure is tens to a few hundred.
//   maxDepth 40        Groups inside groups; a drawing tool nests maybe 10 deep.
//   maxUseExpansion 5000  What the drawing becomes once every <use> is expanded: the "billion laughs"
//                      of SVG (a <use> of a group of ten <use>s of a group of ten ...).
//   maxCssChars 20 000 A figure's own stylesheet is a few hundred characters.
//   maxKeyframes 24, maxAttrChars 20 000 (one path's `d` on a detailed figure).
export const SVG_LIMITS = Object.freeze({
  maxChars: 300000, maxElements: 3000, maxDepth: 40, maxUseExpansion: 5000,
  maxCssChars: 20000, maxKeyframes: 24, maxAttrChars: 20000,
});

// THE ELEMENTS KEPT: shapes, groups, and the paint servers/clips that shapes refer to. Left out on
// purpose (and so dropped with everything inside them): script, style (read, never copied), a,
// foreignObject, image, iframe, filter and every fe*, pattern, marker, text/tspan (the prompt asks for
// no text, and a font is one more thing to fetch), title/desc/metadata, the SMIL elements, nested svg,
// switch, and anything not in the SVG namespace (an editor's own elements).
const ELEMENTS = new Set([
  'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'symbol', 'use',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
]);
const HREF_OK = new Set(['use', 'linearGradient', 'radialGradient']);

// THE ATTRIBUTES KEPT: geometry and presentation. No on*, no href except as above, no style except as
// re-written declarations, no aria/role/tabindex (the drawing is decorative; focus is not its to take).
const ATTRS = new Set([
  'id', 'class', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'width', 'height', 'points', 'transform', 'pathLength', 'offset',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color',
  'stop-color', 'stop-opacity', 'clip-path', 'clip-rule', 'mask', 'visibility', 'display',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'viewBox', 'preserveAspectRatio', 'vector-effect', 'paint-order', 'transform-origin',
]);
// The presentation attributes a root <svg> may hand down (moved onto the wrapping group).
const ROOT_PRESENTATION = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'color']);

// THE CSS PROPERTIES KEPT (in a <style> rule, a keyframe, or a `style` attribute).
const CSS_PROPS = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color',
  'stop-color', 'stop-opacity', 'visibility', 'display', 'transform', 'transform-origin', 'transform-box',
  'clip-path', 'clip-rule', 'mask', 'paint-order', 'vector-effect',
]);
// Animation, only in a <style> rule (never a `style` attribute: those are not re-timed — see below).
// `animation-name` and `animation-duration` are NOT kept on their own: every period has to pass the
// flash re-timing, so it may only arrive inside the `animation` shorthand, where it is read.
const ANIM_PROPS = new Set(['animation', 'animation-delay', 'animation-timing-function',
  'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state']);
const ANIM_KEYWORDS = new Set(['infinite', 'alternate', 'alternate-reverse', 'normal', 'reverse',
  'forwards', 'backwards', 'both', 'none', 'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out',
  'ease-in-out', 'step-start', 'step-end']);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_\-]{0,63}$/;
// What any kept value may contain once its url(#id)s are taken out: no ':' (so no scheme), no
// quotes, no backslash (no CSS escapes), no '<', '>', '&', '@', '{', '}', ';'.
const VALUE_RE = /^[A-Za-z0-9_\s#%.,()+\-]*$/;
const BAD_WORDS = /(expression|javascript|vbscript|data|var|attr|env|image|element|cross-fade|binding|behavior|import)\s*\(/i;
const LOCAL_URL = /url\(\s*#([A-Za-z_][A-Za-z0-9_\-]{0,63})\s*\)/g;
const TIME_RE = /^(-?\d+(?:\.\d+)?)(ms|s)$/;

const fail = (reason) => ({ ok: false, reason });

/** "Is this text an SVG file at all", cheaply, for a caller deciding whether to try. */
// (Not .svgz: that is compressed, and reading it would mean unpacking somebody's file to find out.)
export const looksLikeSvgPath = (path) => /\.svg$/i.test(String(path || '').split(/[?#]/)[0]);

// A value with its url(#id)s replaced by a placeholder, or null when anything else is in it.
function checkValue(v, maxLen) {
  if (typeof v !== 'string' || v.length > maxLen) return null;
  const refs = [];
  const bare = v.replace(LOCAL_URL, (_, id) => { refs.push(id); return 'URLREF'; });
  if (/url\s*\(/i.test(bare) || BAD_WORDS.test(bare) || !VALUE_RE.test(bare)) return null;
  return { value: v.trim(), refs };
}

// ---------------------------------------------------------------------------------------
// CSS: a small parser for the few shapes kept. Everything it does not recognise is dropped.
// ---------------------------------------------------------------------------------------

// Split CSS text into top-level items: { prelude, block } for "x { ... }", { statement } for "x;".
function splitTop(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    let j = i;
    while (j < n && css[j] !== '{' && css[j] !== ';' && css[j] !== '}') j++;
    if (j >= n) break;
    if (css[j] === ';' || css[j] === '}') { out.push({ statement: css.slice(i, j) }); i = j + 1; continue; }
    const prelude = css.slice(i, j).trim();
    let depth = 1, k = j + 1;
    while (k < n && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    if (depth) break;                          // unbalanced: the rest is dropped
    out.push({ prelude, block: css.slice(j + 1, k - 1) });
    i = k;
  }
  return out;
}

// Split on commas that are not inside parentheses (cubic-bezier(a, b, c, d)).
function splitCommas(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
// Split on spaces that are not inside parentheses.
function splitSpaces(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

const timeMs = (tok) => { const m = TIME_RE.exec(tok); return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : null; };
const isTimingFn = (tok) => /^(steps|cubic-bezier)\([0-9.,\s\-a-z]*\)$/.test(tok);

// One `animation` shorthand, read into parts, or null when any part is not understood. A name must be
// one of THIS file's @keyframes (never the page's own).
function parseAnimation(value, keyframes) {
  const parts = [];
  for (const one of splitCommas(value)) {
    let name = null, dur = null, delay = null;
    const rest = [];
    for (const tok of splitSpaces(one)) {
      const t = timeMs(tok);
      if (t !== null) { if (dur === null) dur = t; else if (delay === null) delay = t; else return null; continue; }
      if (ANIM_KEYWORDS.has(tok) || /^\d+(\.\d+)?$/.test(tok) || isTimingFn(tok)) { rest.push(tok); continue; }
      if (NAME_RE.test(tok) && keyframes.has(tok) && name === null) { name = tok; continue; }
      return null;
    }
    if (!name) return null;
    parts.push({ name, dur: dur === null ? 0 : Math.max(0, dur), delay, rest });
  }
  return parts.length ? parts : null;
}

// Declarations, cleaned. `anim`: whether animation properties may be kept (and the keyframes they may
// name). Returns [{ prop, value, refs, anim? }].
function cleanDecls(text, { anim = null, maxLen }) {
  const out = [];
  for (const raw of String(text || '').split(';')) {
    const c = raw.indexOf(':');
    if (c < 0) continue;
    const prop = raw.slice(0, c).trim().toLowerCase();
    let value = raw.slice(c + 1).replace(/!\s*important\s*$/i, '').trim();
    if (!value) continue;
    if (CSS_PROPS.has(prop)) {
      const v = checkValue(value, maxLen);
      if (v) out.push({ prop, value: v.value, refs: v.refs });
      continue;
    }
    if (anim && ANIM_PROPS.has(prop)) {
      if (prop === 'animation') {
        const parts = parseAnimation(value, anim);
        if (parts) out.push({ prop, value, refs: [], anim: parts });
        continue;
      }
      value = value.trim();
      const ok = splitCommas(value).every((p) => splitSpaces(p).every((tok) => timeMs(tok) !== null
        || ANIM_KEYWORDS.has(tok) || /^\d+(\.\d+)?$/.test(tok) || isTimingFn(tok)));
      if (ok) out.push({ prop, value, refs: [] });
    }
  }
  return out;
}

const STOP_RE = /^(from|to|\d{1,3}(?:\.\d+)?%)$/;
const stopPct = (s) => (s === 'from' ? 0 : s === 'to' ? 100 : Number(s.slice(0, -1)));

// A selector kept only if it is simple: names, #ids, .classes, * and the combinators, starting with a
// name (never a combinator, which could reach the page's elements beside the drawing).
const SELECTOR_RE = /^[A-Za-z0-9_\-#.*][A-Za-z0-9_\-#.*\s>+~]{0,199}$/;

function parseCss(css, limits) {
  const dropped = [];
  const keyframes = new Map();                 // name -> { stops: number, frames: [{ sel, decls }] }
  const rules = [];
  const items = splitTop(css);
  // @keyframes first, so a rule may name one that comes after it.
  for (const it of items) {
    if (!it.prelude || !/^@keyframes\s/i.test(it.prelude)) continue;
    const name = it.prelude.replace(/^@keyframes\s+/i, '').trim();
    if (!NAME_RE.test(name) || keyframes.size >= limits.maxKeyframes) { dropped.push('keyframes'); continue; }
    const frames = [];
    const pcts = new Set([0, 100]);            // a missing end is the element's own value: still a stop
    for (const f of splitTop(it.block)) {
      if (!f.prelude) continue;
      const sels = f.prelude.split(',').map((s) => s.trim().toLowerCase());
      if (!sels.length || !sels.every((s) => STOP_RE.test(s)) || sels.some((s) => stopPct(s) > 100)) { dropped.push('keyframe-stop'); continue; }
      const decls = cleanDecls(f.block, { maxLen: limits.maxAttrChars });
      sels.forEach((s) => pcts.add(stopPct(s)));
      frames.push({ sel: sels.join(','), decls });
    }
    keyframes.set(name, { stops: pcts.size, frames });
  }
  for (const it of items) {
    if (it.statement !== undefined) { if (it.statement.trim()) dropped.push('css-statement'); continue; }
    if (it.prelude.startsWith('@')) { if (!/^@keyframes\s/i.test(it.prelude)) dropped.push(`at-rule ${it.prelude.split(/[\s({]/)[0]}`); continue; }
    const sels = it.prelude.split(',').map((s) => s.trim()).filter((s) => SELECTOR_RE.test(s));
    if (!sels.length) { dropped.push('selector'); continue; }
    const decls = cleanDecls(it.block, { anim: keyframes, maxLen: limits.maxAttrChars });
    if (decls.length) rules.push({ sels, decls });
  }
  return { rules, keyframes, dropped };
}

// ---------------------------------------------------------------------------------------
// THE SANITIZER
// ---------------------------------------------------------------------------------------

/**
 * Text in, a clean description out — or `{ ok: false, reason }`. Nothing is fetched, nothing is run,
 * nothing touches the page. `limits` overrides any of SVG_LIMITS.
 *   { ok, viewBox, root: node, rules, keyframes, parts: { eyes, mouth }, dropped: [what was left out] }
 * A node is { tag, attrs: [{ name, value, refs, idRef? }], children }.
 */
export function sanitizeSvg(text, limitsIn = {}) {
  const limits = { ...SVG_LIMITS, ...(limitsIn || {}) };
  if (typeof text !== 'string' || !text.trim()) return fail('empty');
  if (text.length > limits.maxChars) return fail('too-big');
  // Entity declarations can expand a small file into a huge one inside the parser; a drawing has no
  // use for a DOCTYPE at all.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return fail('doctype');
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch { return fail('unparseable'); }
  const top = doc?.documentElement;
  if (!top || top.getElementsByTagName('parsererror').length || doc.getElementsByTagName('parsererror').length) return fail('unparseable');
  if (top.namespaceURI !== SVG_NS || top.localName !== 'svg') return fail('not-svg');
  if (doc.getElementsByTagName('*').length > limits.maxElements) return fail('too-many');

  const dropped = [];
  const note = (w) => { if (dropped.length < 200) dropped.push(w); };

  // The frame. A viewBox, or the numeric width/height an editor writes instead; otherwise the drawing
  // has no frame to fit in its box, and it is shown as a still picture instead.
  const vbRaw = top.getAttribute('viewBox');
  let viewBox = null;
  if (vbRaw) {
    const nums = vbRaw.trim().split(/[\s,]+/).map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) viewBox = nums.join(' ');
  }
  if (!viewBox) {
    const w = parseFloat(top.getAttribute('width')), h = parseFloat(top.getAttribute('height'));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      && /^\s*[\d.]+(px)?\s*$/.test(top.getAttribute('width')) && /^\s*[\d.]+(px)?\s*$/.test(top.getAttribute('height'))) viewBox = `0 0 ${w} ${h}`;
  }
  if (!viewBox) return fail('no-frame');

  // Every <style>, wherever it is, read as text (never copied as an element).
  let cssText = '';
  for (const st of top.getElementsByTagNameNS(SVG_NS, 'style')) cssText += `\n${st.textContent || ''}`;
  cssText = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  let css = { rules: [], keyframes: new Map(), dropped: [] };
  if (cssText.length > limits.maxCssChars) note('css-too-big');
  else if (cssText.trim()) css = parseCss(cssText, limits);
  css.dropped.forEach(note);

  const ids = new Map();                       // id -> node
  let tooDeep = false;

  function cleanAttrs(el, tag, isRoot) {
    const attrs = [];
    for (const a of [...el.attributes]) {
      const local = a.localName;
      const ns = a.namespaceURI;
      if (/^on/i.test(local)) { note('handler'); continue; }
      // href: plain or xlink, only on the elements that use one, only "#id".
      if (local === 'href' && (ns === null || ns === XLINK_NS)) {
        if (!HREF_OK.has(tag)) { note('href'); continue; }
        const m = /^#([A-Za-z_][A-Za-z0-9_\-]{0,63})$/.exec(a.value.trim());
        if (!m) { note('external-href'); continue; }
        if (attrs.some((x) => x.name === 'href')) continue;   // href AND xlink:href: the first one
        attrs.push({ name: 'href', value: '', refs: [], idRef: m[1] });
        continue;
      }
      if (ns !== null) { note('foreign-attr'); continue; }
      if (local === 'style') {
        // A style attribute keeps presentation only. Its animation is NOT kept: an animation here
        // could not be wrapped in the reduced-motion guard or re-timed per rule. [On Mike's list.]
        const decls = cleanDecls(a.value, { maxLen: limits.maxAttrChars });
        if (decls.length) attrs.push({ name: 'style', value: '', refs: [], decls });
        continue;
      }
      if (!ATTRS.has(local)) { note(`attr ${local}`); continue; }
      if (isRoot && !ROOT_PRESENTATION.has(local)) continue;   // the root's frame is ours
      if (local === 'viewBox' && tag !== 'symbol') continue;
      if (local === 'id') {
        const id = a.value.trim();
        if (!NAME_RE.test(id) || ids.has(id)) { note('id'); continue; }
        attrs.push({ name: 'id', value: id, refs: [] });
        continue;
      }
      if (local === 'class') {
        const cls = a.value.trim().split(/\s+/).filter((c) => NAME_RE.test(c));
        if (cls.length) attrs.push({ name: 'class', value: cls.join(' '), refs: [] });
        continue;
      }
      const v = checkValue(a.value, limits.maxAttrChars);
      if (!v) { note(`value ${local}`); continue; }
      attrs.push({ name: local, value: v.value, refs: v.refs });
    }
    return attrs;
  }

  function walk(el, depth) {
    if (depth > limits.maxDepth) { tooDeep = true; return null; }
    const tag = el.localName;
    if (el.namespaceURI !== SVG_NS || !ELEMENTS.has(tag)) { if (tag !== 'style') note(`element ${tag}`); return null; }
    const node = { tag, attrs: cleanAttrs(el, tag, false), children: [] };
    const id = node.attrs.find((x) => x.name === 'id');
    if (id) ids.set(id.value, node);
    for (const c of el.children) {
      const k = walk(c, depth + 1);
      if (tooDeep) return null;
      if (k) node.children.push(k);
    }
    return node;
  }

  const root = { tag: 'g', attrs: cleanAttrs(top, 'svg', true), children: [] };
  for (const c of top.children) {
    const k = walk(c, 1);
    if (tooDeep) return fail('too-deep');
    if (k) root.children.push(k);
  }

  // References only to what was kept. A reference to anything else (an id that was dropped, never
  // existed, or lives in another file) is dropped with the attribute that holds it.
  const fix = (node) => {
    node.attrs = node.attrs.filter((a) => {
      if (a.idRef !== undefined && !ids.has(a.idRef)) { note('dangling-href'); return false; }
      if (a.refs.some((r) => !ids.has(r))) { note('dangling-url'); return false; }
      if (a.decls) a.decls = a.decls.filter((d) => d.refs.every((r) => ids.has(r)));
      return true;
    });
    node.children.forEach(fix);
  };
  fix(root);
  for (const r of css.rules) r.decls = r.decls.filter((d) => d.refs.every((x) => ids.has(x)));
  for (const k of css.keyframes.values()) for (const f of k.frames) f.decls = f.decls.filter((d) => d.refs.every((x) => ids.has(x)));

  // <use> expansion: what the drawing becomes once every <use> is followed; a loop is refused.
  const memo = new Map();
  const visiting = new Set();
  let loop = false;
  const size = (node) => {
    if (memo.has(node)) return memo.get(node);
    if (visiting.has(node)) { loop = true; return Infinity; }
    visiting.add(node);
    let n = 1;
    for (const c of node.children) { n += size(c); if (n > limits.maxUseExpansion) break; }
    const ref = node.tag === 'use' ? node.attrs.find((a) => a.name === 'href') : null;
    if (ref && n <= limits.maxUseExpansion) n += size(ids.get(ref.idRef));
    visiting.delete(node);
    memo.set(node, n);
    return n;
  };
  const total = size(root);
  if (loop) return fail('use-loop');
  if (total > limits.maxUseExpansion) return fail('too-many');

  // The groups the prompt asks for (case is forgiven: "Eyes" is the same group).
  const findPart = (name) => [...ids.keys()].find((id) => id.toLowerCase() === name) || null;
  return {
    ok: true, viewBox, root, rules: css.rules, keyframes: css.keyframes,
    parts: { eyes: findPart('eyes'), mouth: findPart('mouth') }, dropped,
  };
}

// ---------------------------------------------------------------------------------------
// THE MARKUP
// ---------------------------------------------------------------------------------------

let uidN = 0;
const uidSalt = Math.floor(Math.random() * 36 ** 4).toString(36);
/** An id prefix no other drawing on the page has. */
export function newSvgUid() { uidN += 1; return `navx${uidSalt}${uidN.toString(36)}`; }

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * How many flashes one cycle of a keyframes animation can hold: a flash is a pair of opposing
 * changes (WCAG), and every stop is a possible change, so `stops` stops make at most stops-1 changes.
 */
export const flashesPerCycle = (stops) => Math.max(1, Math.ceil((Math.max(2, stops) - 1) / 2));

/** The shortest period (ms) an animation with `stops` keyframe stops may have at `limit`. */
export function minAnimationMs(stops, limit = FLASH_LIMIT_DEFAULT) {
  return Math.ceil(flashesPerCycle(stops) * minFlashPeriodMs(limit));
}

// The built-in movement for a drawing brought in: the same cadence as the drawn avatar (avatar.js
// MOTION_CSS: a blink every 9 s, a breath over 4.4 s). The eyes and the whole figure are WRAPPED in a
// new group that moves, so a `transform` the file itself put on its eyes is never overwritten.
const BLINK_STOPS = '0%,90%,100%{transform:scaleY(1)}94%,96%{transform:scaleY(0.1)}';
const BREATHE_STOPS = 'from{transform:scale(1,1)}to{transform:scale(1.01,1.02)}';

/**
 * The clean drawing as SVG markup, every id, class, keyframes name and reference prefixed with `uid`.
 *   animate     false: no animation of any kind is written (the file's own or ours)
 *   flashLimit  flashes a second (flash_limit.js); every period is stretched to honour it
 *   delay       seconds into the blink cycle, so two faces do not blink in step
 *   size        width/height ('100%' fills its box)
 */
export function svgMarkup(clean, { uid = newSvgUid(), animate = false, flashLimit = FLASH_LIMIT_DEFAULT,
  delay = 0, size = '100%' } = {}) {
  if (!clean || !clean.ok) return '';
  const pre = `${uid}-`;
  const kf = (name) => `${pre}k-${name}`;
  const urls = (v) => v.replace(LOCAL_URL, (_, id) => `url(#${pre}${id})`);
  const declText = (d) => `${d.prop}:${urls(d.value)}`;

  // The file's own rules: presentation always; animation only when moving, and then re-timed and
  // inside the reduced-motion guard.
  const plain = [], moving = [];
  const scope = (sels) => sels.map((s) => `#${uid} ${s.replace(/#([A-Za-z_][A-Za-z0-9_\-]*)/g, `#${pre}$1`)
    .replace(/\.([A-Za-z_][A-Za-z0-9_\-]*)/g, `.${pre}$1`)}`).join(',');
  for (const r of clean.rules) {
    const sel = scope(r.sels);
    const p = r.decls.filter((d) => !ANIM_PROPS.has(d.prop)).map(declText);
    if (p.length) plain.push(`${sel}{${p.join(';')}}`);
    if (!animate) continue;
    const a = r.decls.filter((d) => ANIM_PROPS.has(d.prop)).map((d) => {
      if (d.prop !== 'animation') return `${d.prop}:${d.value}`;
      return `animation:${d.anim.map((part) => {
        const stops = clean.keyframes.get(part.name)?.stops || 2;
        // A zero period draws nothing (it is not an animation), so it is left at zero, not stretched
        // into one nobody wrote.
        const dur = part.dur > 0 ? Math.max(part.dur, minAnimationMs(stops, flashLimit)) : 0;
        return [kf(part.name), `${Math.round(dur)}ms`, part.delay !== null ? `${Math.round(part.delay)}ms` : '', ...part.rest].filter(Boolean).join(' ');
      }).join(',')}`;
    });
    if (a.length) moving.push(`${sel}{${a.join(';')}}`);
  }
  const frames = [];
  if (animate) {
    for (const [name, k] of clean.keyframes) {
      frames.push(`@keyframes ${kf(name)}{${k.frames.map((f) => `${f.sel}{${f.decls.map(declText).join(';')}}`).join('')}}`);
    }
    const blinkMs = Math.max(9000, minAnimationMs(5, flashLimit));
    const breatheMs = Math.max(4400, minAnimationMs(2, flashLimit));
    const d = `-${Math.max(0, Number(delay) || 0).toFixed(1)}s`;
    frames.push(`@keyframes ${pre}-blink{${BLINK_STOPS}}`, `@keyframes ${pre}-breathe{${BREATHE_STOPS}}`);
    moving.push(`#${uid} .${pre}-eyes{transform-box:fill-box;transform-origin:center;animation:${pre}-blink ${blinkMs}ms ease-in-out infinite;animation-delay:${d}}`);
    moving.push(`#${uid} .${pre}-body{transform-box:view-box;transform-origin:50% 100%;animation:${pre}-breathe ${breatheMs}ms ease-in-out infinite alternate;animation-delay:${d}}`);
  }
  const css = plain.join('') + frames.join('')
    + (moving.length ? `@media (prefers-reduced-motion: no-preference){${moving.join('')}}` : '');

  const attrText = (a) => {
    if (a.name === 'href') return ` href="#${escAttr(pre + a.idRef)}"`;
    if (a.name === 'id') return ` id="${escAttr(pre + a.value)}"`;
    if (a.name === 'class') return ` class="${escAttr(a.value.split(' ').map((c) => pre + c).join(' '))}"`;
    if (a.name === 'style') return a.decls.length ? ` style="${escAttr(a.decls.map(declText).join(';'))}"` : '';
    return ` ${a.name}="${escAttr(urls(a.value))}"`;
  };
  const partOf = (node) => {
    const id = node.attrs.find((a) => a.name === 'id')?.value;
    if (!id) return null;
    if (id === clean.parts.eyes) return 'eyes';
    if (id === clean.parts.mouth) return 'mouth';
    return null;
  };
  const draw = (node) => {
    const inner = node.children.map(draw).join('');
    const el = `<${node.tag}${node.attrs.map(attrText).join('')}>${inner}</${node.tag}>`;
    const part = partOf(node);
    // The eyes and the mouth wrapped in a group of our own (see BLINK_STOPS above).
    return part ? `<g class="${pre}-${part}" data-part="${part}">${el}</g>` : el;
  };
  const dims = size ? ` width="${escAttr(size)}" height="${escAttr(size)}"` : '';
  return `<svg xmlns="${SVG_NS}" viewBox="${escAttr(clean.viewBox)}"${dims} preserveAspectRatio="xMidYMid meet"`
    + ` id="${escAttr(uid)}" class="nav nav-svg" data-avatar="imported" data-motion="${animate ? 'on' : 'off'}"`
    + ' aria-hidden="true" focusable="false">'
    + (css ? `<style>${css.replace(/</g, '\\3c ')}</style>` : '')
    + `<g class="${pre}-body"${clean.root.attrs.map(attrText).join('')}>${clean.root.children.map(draw).join('')}</g></svg>`;
}

/** Every element and attribute name `svgMarkup` can write, for the suite's structural check. */
export const WRITABLE = Object.freeze({
  elements: Object.freeze(['svg', 'style', ...ELEMENTS]),
  attrs: Object.freeze(['xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'id', 'class',
    'data-avatar', 'data-motion', 'data-part', 'aria-hidden', 'focusable', 'href', 'style', ...ATTRS]),
});
