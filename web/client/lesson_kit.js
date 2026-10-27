/* lessonKit.js: lesson parts drawn in any theme.
 *
 * Plain JavaScript, so web/client can ship it as it is. A lesson names its parts; this file draws
 * them in the dashboard's theme. Everything returns an SVG string, plus a list of contrast WARNINGS.
 * A warning never blocks anything (Mike's ruling); it's there so a person or Code can choose.
 *
 *   lessonTheme(theme)                    → colours, type voice, warnings
 *   typeStyles(theme)                     → title, body, caption, citation, keyword, quote
 *   chartSvg(kind, data, theme, size)     → { svg, warnings }   kind: bar | line | pie | stack
 *   layoutSvg(lesson, theme, layout)      → { svg, warnings }   layout: slide | over | study
 *   teacherSvg(role, pose, theme)         → '<svg …>'            pose: stand | point | listen | desk
 *   MOTION[theme]                         → motion notes for the shared animation library
 *   inventory(theme)                      → what the theme already has that a lesson can use
 *
 * ASSUMED LESSON SHAPE (the chat's lesson_shape doc couldn't be read from here; adjust to match it):
 *   { title, teacher: 'queen', place: 'library', layout: 'study',
 *     parts: [ { type: 'text', body } | { type: 'keyword', word, meaning } | { type: 'quote', text, who }
 *            | { type: 'chart', kind, data, caption, citation } ] }
 */
import { TOWN_DRESS, HOMES, PLACES, placeSvg } from './town.js';
import { cardThemes, courtLook } from './playing_cards.js';
import { figureBody, OUTFITS } from './character_kit.js';
import { KIT } from './theme_kits.js';

export const LESSON_THEMES = ['nimrod', 'cozy', 'spring', 'summer', 'fall', 'winter', 'night', 'ocean', 'steampunk', 'cyberpunk', 'newYear', 'lunarNewYear', 'valentines', 'stPatricks', 'easter', 'july4', 'halloween', 'diwali', 'harvest', 'hanukkah', 'christmas'];

/* ---------- colour ---------- */
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); const n = parseInt(h.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = (r) => '#' + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const blend = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * t + y[i] * (1 - t))); };
const lum = (h) => { const c = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- type voice per theme ----------
   No webfonts: these are system stacks, so the voice comes from family, weight, case, tracking and
   the key-word treatment. */
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Iowan Old Style','Palatino Linotype','Times New Roman',serif";
const ROUND = "ui-rounded,'SF Pro Rounded','Nunito','Segoe UI',system-ui,sans-serif";
const MONO = "ui-monospace,Menlo,Consolas,monospace";
const V = (family, o = {}) => ({ family, titleWeight: 800, upper: false, track: -0.01, smallCaps: false, quoteItalic: true, key: 'mark', rule: 'line', ...o });
export const TYPE_VOICE = {
  nimrod: V(SANS),
  cozy: V(SERIF, { titleWeight: 700, key: 'underline', rule: 'dots' }),
  spring: V(ROUND, { key: 'pill' }),
  summer: V(ROUND, { titleWeight: 900, key: 'pill' }),
  fall: V(SERIF, { titleWeight: 700, key: 'underline' }),
  winter: V(SANS, { titleWeight: 700, track: 0.01, key: 'box' }),
  night: V(SANS, { titleWeight: 600, track: 0.02, key: 'underline', rule: 'dots' }),
  ocean: V(SANS, { key: 'pill', rule: 'wave' }),
  steampunk: V(SERIF, { smallCaps: true, track: 0.04, key: 'box', rule: 'double' }),
  cyberpunk: V(MONO, { upper: true, track: 0.08, quoteItalic: false, key: 'glow', rule: 'line' }),
  newYear: V(SERIF, { titleWeight: 700, track: 0.02, key: 'underline', rule: 'double' }),
  lunarNewYear: V(SERIF, { titleWeight: 700, key: 'box', rule: 'double' }),
  valentines: V(SERIF, { titleWeight: 700, key: 'underline', rule: 'dots' }),
  stPatricks: V(ROUND, { key: 'pill' }),
  easter: V(ROUND, { key: 'pill', rule: 'dots' }),
  july4: V(SANS, { titleWeight: 900, upper: true, track: 0.04, quoteItalic: false, key: 'box', rule: 'double' }),
  halloween: V(ROUND, { titleWeight: 900, key: 'mark' }),
  diwali: V(SERIF, { titleWeight: 700, key: 'underline', rule: 'dots' }),
  harvest: V(SERIF, { titleWeight: 700, key: 'underline' }),
  hanukkah: V(SERIF, { titleWeight: 700, key: 'box', rule: 'double' }),
  christmas: V(SERIF, { titleWeight: 700, key: 'underline', rule: 'dots' }),
  medieval: V(SERIF, { titleWeight: 700, smallCaps: true, track: 0.02, key: 'underline', rule: 'double' }),   // 2026-10-26: the Medieval theme
};

export function lessonTheme(theme = 'nimrod') {
  const d = TOWN_DRESS[theme] || TOWN_DRESS.nimrod, c = cardThemes[theme] || cardThemes.nimrod, v = TYPE_VOICE[theme] || TYPE_VOICE.nimrod;
  const night = !!d.night;
  const bg = night ? blend(d.sky[0], '#000000', 0.9) : c.stock;
  const ink = night ? '#f4f1e8' : c.edge;
  const soft = blend(ink, bg, 0.8);
  const series = (d.palette || []).slice(0, 5);
  const accent = series.find((s) => contrast(s, bg) >= 3) || series[0];
  const surface = night ? blend(bg, '#ffffff', 0.86) : blend(bg, '#ffffff', 0.5);
  const warnings = [];
  const check = (what, fg, back, min) => { const r = contrast(fg, back); if (r < min) warnings.push({ what, fg, bg: back, ratio: +r.toFixed(2), min }); };
  check('Body text', ink, bg, 4.5); check('Caption and citation', soft, bg, 4.5); check('Key word colour', accent, bg, 3);
  series.forEach((s, i) => check(`Chart colour ${i + 1}`, s, bg, 3));
  return { theme, label: d.label, night, bg, surface, ink, soft, accent, series, wall: d.wall, floor: d.floor, palette: d.palette, voice: v, warnings };
}

/* The six text roles. Sizes are for a 960×540 lesson stage; the screen scales the whole stage. */
export function typeStyles(theme = 'nimrod') {
  const t = lessonTheme(theme), v = t.voice;
  const base = { family: v.family, color: t.ink, track: 0, upper: false, italic: false, smallCaps: false };
  return {
    title: { ...base, size: 44, weight: v.titleWeight, track: v.track, upper: v.upper, smallCaps: v.smallCaps, leading: 1.12 },
    body: { ...base, size: 24, weight: 400, leading: 1.45 },
    caption: { ...base, size: 17, weight: 600, color: t.soft, leading: 1.35 },
    citation: { ...base, size: 15, weight: 400, color: t.soft, italic: true, leading: 1.3 },
    keyword: { ...base, size: 24, weight: 800, color: t.ink, key: v.key, accent: t.accent },
    quote: { ...base, family: v.quoteItalic ? SERIF : v.family, size: 30, weight: 500, italic: v.quoteItalic, leading: 1.3, rule: t.accent },
  };
}
/* As CSS, for HTML lessons. */
export function typeCss(st) {
  return { fontFamily: st.family, fontSize: st.size + 'px', fontWeight: st.weight, color: st.color, lineHeight: st.leading, letterSpacing: st.track ? st.track + 'em' : undefined, textTransform: st.upper ? 'uppercase' : undefined, fontStyle: st.italic ? 'italic' : undefined, fontVariant: st.smallCaps ? 'small-caps' : undefined };
}

/* ---------- SVG text with simple wrapping ---------- */
function wrap(str, size, maxW, st = {}) {
  const k = (String(st.family).startsWith('ui-monospace') ? 0.62 : 0.52) + (st.upper || st.smallCaps ? 0.1 : 0) + (st.track || 0);
  const per = Math.max(4, Math.floor(maxW / (size * k))), out = [];
  let line = '';
  for (const w of String(str).split(/\s+/)) { if ((line + ' ' + w).trim().length > per) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line);
  return out;
}
function text(x, y, str, st, maxW = 800, anchor = 'start') {
  const s = st.upper ? String(str).toUpperCase() : str;
  const lines = wrap(s, st.size, maxW, st), lh = st.size * (st.leading || 1.3);
  const attrs = `font-family="${esc(st.family)}" font-size="${st.size}" font-weight="${st.weight}" fill="${st.color}"${st.italic ? ' font-style="italic"' : ''}${st.smallCaps ? ' font-variant="small-caps"' : ''}${st.track ? ` letter-spacing="${st.track * st.size}"` : ''} text-anchor="${anchor}"`;
  return { svg: `<text ${attrs}>${lines.map((l, i) => `<tspan x="${x}" y="${y + i * lh}">${esc(l)}</tspan>`).join('')}</text>`, height: lines.length * lh };
}
/* a key word, with the theme's treatment: mark, underline, pill, box, or glow (a still glow; it never pulses) */
function keyword(x, y, word, st) {
  const w = String(word).length * st.size * 0.6 + 16, h = st.size * 1.3, top = y - st.size * 0.95, a = st.accent;
  const deco = {
    mark: `<rect x="${x - 6}" y="${top}" width="${w}" height="${h}" rx="4" fill="${a}" opacity=".35"/>`,
    underline: `<rect x="${x}" y="${y + 6}" width="${w - 12}" height="5" rx="2.5" fill="${a}"/>`,
    pill: `<rect x="${x - 10}" y="${top - 2}" width="${w + 8}" height="${h + 4}" rx="${h}" fill="none" stroke="${a}" stroke-width="3"/>`,
    box: `<rect x="${x - 8}" y="${top - 2}" width="${w + 4}" height="${h + 4}" rx="2" fill="none" stroke="${a}" stroke-width="3"/>`,
    glow: `<rect x="${x - 8}" y="${top - 2}" width="${w + 4}" height="${h + 4}" rx="4" fill="none" stroke="${a}" stroke-width="3" style="filter:drop-shadow(0 0 6px ${a})"/>`,
  }[st.key] || '';
  return deco + text(x, y, word, st).svg;
}
function rule(x, y, w, kind, color) {
  if (kind === 'none') return '';
  if (kind === 'dots') return Array.from({ length: Math.floor(w / 14) }, (_, i) => `<circle cx="${x + 4 + i * 14}" cy="${y}" r="2.5" fill="${color}"/>`).join('');
  if (kind === 'double') return `<rect x="${x}" y="${y - 3}" width="${w}" height="2" fill="${color}"/><rect x="${x}" y="${y + 2}" width="${w}" height="2" fill="${color}"/>`;
  if (kind === 'wave') return `<path d="M${x} ${y}${Array.from({ length: Math.floor(w / 24) }, () => ' q6 -6 12 0 t12 0').join('')}" stroke="${color}" stroke-width="3" fill="none"/>`;
  return `<rect x="${x}" y="${y - 2}" width="${w}" height="4" rx="2" fill="${color}"/>`;
}

/* ---------- charts ----------
   Every series has its colour AND a second signal: bars get a direct label and a pattern, lines get
   a marker shape and a label at the end, pie slices get a label with the percentage. Colour is
   never the only way to tell two things apart. Contrast below 3:1 for a graphic is a warning. */
const PATTERNS = ['', 'M0 8L8 0', 'M0 0L8 8', 'M4 0V8', 'M0 4H8'];
const MARKS = [(x, y, c) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`, (x, y, c) => `<rect x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" fill="${c}"/>`, (x, y, c) => `<path d="M${x} ${y - 7}L${x + 7} ${y + 5}H${x - 7}Z" fill="${c}"/>`, (x, y, c) => `<path d="M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z" fill="${c}"/>`, (x, y, c) => `<path d="M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}" stroke="${c}" stroke-width="4"/>`];
function pickPiece(theme) {
  const own = Object.entries(KIT).filter(([, p]) => p.theme === theme && p.on === 'floor');
  return (own[0] || Object.entries(KIT).find(([, p]) => p.on === 'floor'))[1];
}
export function chartSvg(kind = 'bar', data = {}, theme = 'nimrod', { w = 440, h = 280 } = {}) {
  const t = lessonTheme(theme), st = typeStyles(theme), lab = { ...st.caption, size: 15, color: t.ink, weight: 600 };
  const pad = { l: 36, r: 16, t: 24, b: 44 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, out = [];
  const warnings = t.warnings.filter((x) => x.what.startsWith('Chart') || x.what === 'Body text');
  const defs = `<defs>${PATTERNS.map((p, i) => (p ? `<pattern id="lp${i}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="${p}" stroke="${t.night ? '#000' : '#fff'}" stroke-width="2" opacity=".45"/></pattern>` : '')).join('')}</defs>`;
  const rows = data.rows || [];
  if (kind === 'bar' || kind === 'stack') {
    const max = Math.max(1, ...rows.map((r) => r.value)), bw = iw / Math.max(1, rows.length);
    out.push(`<rect x="${pad.l}" y="${pad.t + ih}" width="${iw}" height="2" fill="${t.soft}"/>`);
    rows.forEach((r, i) => {
      const c = t.series[i % t.series.length], cx = pad.l + bw * (i + 0.5);
      if (kind === 'bar') {
        const bh = (r.value / max) * (ih - 22), x = cx - bw * 0.32, y = pad.t + ih - bh;
        out.push(`<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${bh}" rx="4" fill="${c}"/>${i % 5 ? `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${bh}" rx="4" fill="url(#lp${i % 5})"/>` : ''}`);
        out.push(text(cx, y - 8, r.value, { ...lab, weight: 800 }, 200, 'middle').svg);
      } else {
        const piece = pickPiece(theme), unit = Math.min(bw * 0.6, (ih - 22) / Math.max(1, max)), sx = cx - unit / 2;
        for (let n = 0; n < r.value; n += 1) out.push(`<svg x="${sx}" y="${pad.t + ih - unit * (n + 1)}" width="${unit}" height="${unit}" viewBox="0 0 100 100">${piece.svg(c)}</svg>`);
        out.push(text(cx, pad.t + ih - unit * r.value - 8, r.value, { ...lab, weight: 800 }, 200, 'middle').svg);
      }
      out.push(text(cx, pad.t + ih + 22, r.label, lab, bw - 4, 'middle').svg);
    });
  } else if (kind === 'line') {
    const labels = data.labels || [], series = data.series || [], all = series.flatMap((s) => s.values), max = Math.max(1, ...all), min = Math.min(0, ...all);
    const X = (i) => pad.l + (iw - 70) * (labels.length < 2 ? 0.5 : i / (labels.length - 1)), Y = (v) => pad.t + ih - ((v - min) / (max - min)) * (ih - 10);
    out.push(`<rect x="${pad.l}" y="${pad.t + ih}" width="${iw}" height="2" fill="${t.soft}"/>`);
    [0.5, 1].forEach((f) => out.push(`<rect x="${pad.l}" y="${Y(min + (max - min) * f)}" width="${iw}" height="1" fill="${t.soft}" opacity=".3"/>`));
    series.forEach((s, si) => {
      const c = t.series[si % t.series.length];
      out.push(`<path d="${s.values.map((v, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(v)).join('')}" stroke="${c}" stroke-width="4" fill="none" stroke-linejoin="round"${si ? ` stroke-dasharray="${['', '10 6', '3 6', '14 4 3 4'][si % 4]}"` : ''}/>`);
      s.values.forEach((v, i) => out.push(MARKS[si % MARKS.length](X(i), Y(v), c)));
      const last = s.values.length - 1;
      out.push(text(X(last) + 12, Y(s.values[last]) + 5, s.name, { ...lab, weight: 800 }, 80).svg);
    });
    labels.forEach((l, i) => out.push(text(X(i), pad.t + ih + 22, l, lab, 80, 'middle').svg));
  } else if (kind === 'pie') {
    const total = rows.reduce((a, r) => a + r.value, 0) || 1, r0 = Math.min(iw, ih) / 2 - 6, cx = pad.l + r0 + 10, cy = pad.t + ih / 2 + 4;
    let a0 = -Math.PI / 2;
    rows.forEach((r, i) => {
      const a1 = a0 + (r.value / total) * Math.PI * 2, c = t.series[i % t.series.length], large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => [cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      out.push(`<path d="M${cx} ${cy}L${x0} ${y0}A${r0} ${r0} 0 ${large} 1 ${x1} ${y1}Z" fill="${c}" stroke="${t.bg}" stroke-width="3"/>${i % 5 ? `<path d="M${cx} ${cy}L${x0} ${y0}A${r0} ${r0} 0 ${large} 1 ${x1} ${y1}Z" fill="url(#lp${i % 5})"/>` : ''}`);
      const ly = pad.t + 14 + i * 30, lx = cx + r0 + 30;
      out.push(`<rect x="${lx}" y="${ly - 12}" width="16" height="16" rx="3" fill="${c}"/>${i % 5 ? `<rect x="${lx}" y="${ly - 12}" width="16" height="16" rx="3" fill="url(#lp${i % 5})"/>` : ''}`);
      out.push(text(lx + 24, ly + 1, `${r.label} · ${Math.round((r.value / total) * 100)}%`, lab, w - lx - 30).svg);
      a0 = a1;
    });
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(data.title || kind + ' chart')}">${defs}${out.join('')}</svg>`, warnings };
}

/* ---------- teachers ----------
   The AI characters are the four court characters, dressed for the theme. Poses: stand, point
   (at the visual, to their right), listen (hand at the ear), desk (behind the desk, in the Study). */
export function teacherSvg(role = 'queen', pose = 'stand', theme = 'nimrod') {
  const { look, opts } = courtLook(role, ['hearts', 'diamonds', 'clubs', 'spades'][['king', 'queen', 'jack', 'joker'].indexOf(role)] || 'hearts', theme);
  const p = pose === 'desk' ? 'talk' : pose;
  const body = figureBody(look, { ...opts, pose: p, role: p === 'stand' ? opts.role : null });
  if (pose !== 'desk') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 320" role="img" aria-label="Teacher, ${esc(pose)}">${body}</svg>`;
  const t = lessonTheme(theme), wood = (t.floor && t.floor.color) || '#8a5f3c';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 240 320" role="img" aria-label="Teacher behind the desk">${body}<rect x="-20" y="214" width="240" height="14" rx="4" fill="${blend(wood, '#ffffff', 0.85)}"/><rect x="-12" y="228" width="224" height="92" fill="${wood}"/><rect x="-12" y="228" width="224" height="92" fill="#000" opacity=".12"/><rect x="40" y="250" width="120" height="44" rx="4" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="3"/></svg>`;
}

/* ---------- layouts ---------- */
function partsBlock(parts, st, x, y, w, t) {
  const out = []; let cy = y;
  for (const p of parts) {
    if (p.type === 'text') { const r = text(x, cy, p.body, st.body, w); out.push(r.svg); cy += r.height + 14; }
    if (p.type === 'keyword') { out.push(keyword(x + 6, cy, p.word, st.keyword)); const r = text(x, cy + 34, p.meaning, st.body, w); out.push(r.svg); cy += 34 + r.height + 14; }
    if (p.type === 'quote') { const r = text(x + 22, cy, '“' + p.text + '”', st.quote, w - 22); out.push(`<rect x="${x}" y="${cy - st.quote.size}" width="5" height="${r.height + 6}" rx="2.5" fill="${st.quote.rule}"/>` + r.svg); cy += r.height + 4; if (p.who) { const s2 = text(x + 22, cy + 6, '— ' + p.who, st.citation, w); out.push(s2.svg); cy += s2.height + 18; } }
  }
  return out.join('');
}
const nest = (svg, x, y, w, h, par = 'xMidYMid meet') => svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${par}" `);

export function layoutSvg(lesson = {}, theme = 'nimrod', layout = lesson.layout || 'slide') {
  const t = lessonTheme(theme), st = typeStyles(theme), W = 960, H = 540, out = [];
  const chart = (lesson.parts || []).find((p) => p.type === 'chart');
  const words = (lesson.parts || []).filter((p) => p.type !== 'chart');
  const vis = chart ? chartSvg(chart.kind, chart.data, theme) : null;
  const foot = (x, y, w) => chart ? text(x, y, chart.caption || '', st.caption, w).svg + (chart.citation ? text(x, y + 26, chart.citation, st.citation, w).svg : '') : '';
  if (layout === 'slide') {
    out.push(`<rect width="${W}" height="${H}" fill="${t.bg}"/>`);
    const tt = text(60, 92, lesson.title, st.title, chart ? 840 : 840), ry = 92 + tt.height - st.title.size * 0.55;
    out.push(tt.svg, rule(60, ry, 220, t.voice.rule, t.accent));
    out.push(partsBlock(words, st, 60, ry + 50, chart ? 400 : 840, t));
    if (vis) out.push(`<rect x="500" y="146" width="410" height="290" rx="14" fill="${t.surface}"/>`, nest(vis.svg, 510, 154, 390, 260), foot(508, 466, 400));
  } else if (layout === 'over') {
    /* the place's own name sign would sit behind the text panel, so it's dropped here */
    const bgArt = placeSvg(lesson.place || 'library', theme).replace(/<rect[^>]*stroke="rgba\(0,0,0,\.25\)" stroke-width="3"\/><text[^>]*>[^<]*<\/text>/g, '');
    out.push(nest(bgArt, 0, 0, W, H, 'xMidYMid slice'));
    out.push(`<rect x="36" y="36" width="560" height="${H - 72}" rx="18" fill="${t.bg}" opacity=".9"/>`);
    const tt = text(70, 104, lesson.title, st.title, 500), ry = 104 + tt.height - st.title.size * 0.55;
    out.push(tt.svg, rule(70, ry, 180, t.voice.rule, t.accent));
    out.push(partsBlock(words, st, 70, ry + 50, 500, t));
  } else {
    /* THE STUDY: back wall, the Photos slot on it holding the visual, the teacher behind the desk */
    const wall = (t.wall && t.wall.color) || '#e6dcc4', floor = (t.floor && t.floor.color) || '#9a6a42';
    out.push(`<rect width="${W}" height="400" fill="${wall}"/>`);
    if (t.wall && t.wall.wainscot) out.push(`<rect y="300" width="${W}" height="100" fill="${t.wall.wainscot}"/><rect y="296" width="${W}" height="8" fill="${blend(t.wall.wainscot, '#ffffff', 0.8)}"/>`);
    out.push(`<rect y="400" width="${W}" height="140" fill="${floor}"/>${Array.from({ length: 12 }, (_, i) => `<rect x="${i * 84}" y="400" width="2" height="140" fill="#000" opacity=".15"/>`).join('')}<rect y="396" width="${W}" height="8" fill="${blend(wall, '#000000', 0.8)}"/>`);
    const fx = 430, fy = 40, fw = 480, fh = 300;
    out.push(`<rect x="${fx - 14}" y="${fy - 14}" width="${fw + 28}" height="${fh + 28}" rx="6" fill="${blend(floor, '#000000', 0.7)}"/><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="${t.bg}"/>`);
    out.push(`<rect x="${fx + fw - 92}" y="${fy + fh + 18}" width="92" height="26" rx="6" fill="${t.surface}"/>` + text(fx + fw - 46, fy + fh + 37, 'Photos', { ...st.caption, size: 14, color: t.ink }, 90, 'middle').svg);
    out.push(text(fx + 20, fy + 42, lesson.title, { ...st.title, size: 28 }, fw - 40).svg);
    if (vis) out.push(nest(vis.svg, fx + 20, fy + 64, fw - 40, fh - 80));
    out.push(nest(teacherSvg(lesson.teacher || 'queen', lesson.pose || 'desk', theme), 60, 120, 340, 420));
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lesson.title || 'Lesson')}">${out.join('')}</svg>`, warnings: [...t.warnings, ...((vis && vis.warnings) || [])].filter((x, i, a) => a.findIndex((y) => y.what === x.what) === i) };
}

/* ---------- motion notes for Code's shared animation library ----------
   One vocabulary for every theme: ENTER (a part arriving), EMPHASIS (the teacher pointing at
   something), IDLE (while somebody reads), EXIT. Each theme only changes the feel. Everything here
   runs inside prefers-reduced-motion: no-preference, and `still` says what the reduced-motion frame
   shows: always the finished state, never a half-drawn one. Nothing flashes; with the
   photosensitivity setting on, any glow or sparkle is dropped. */
const M = (feel, enter, emphasis, idle, ms = [420, 600], ease = 'cubic-bezier(.2,.7,.2,1)') => ({ feel, enter, emphasis, idle, exit: 'fade out, 200ms', ms: { enter: ms[0], emphasis: ms[1] }, ease, still: 'every part in place, key words already marked, chart fully drawn, teacher in the pose for the current part' });
export const MOTION = {
  nimrod: M('calm, plain', 'fade up 12px', 'key word mark grows from the left', 'none'),
  cozy: M('soft, unhurried', 'fade in, 600ms', 'underline draws in', 'lamp glow breathes behind the visual', [600, 800], 'ease-out'),
  spring: M('light, springy', 'rise 16px with a small overshoot', 'pill pops to 104% and settles', 'petals drift behind', [460, 520], 'cubic-bezier(.3,1.4,.5,1)'),
  summer: M('bright, easy', 'slide in from the right', 'pill fills with colour', 'water shimmer behind'),
  fall: M('slow, warm', 'fade in with a slight drop, like a settling leaf', 'underline draws in', 'a leaf drifts past now and then', [560, 700], 'ease-out'),
  winter: M('crisp, quiet', 'fade in', 'box draws its edges clockwise', 'snow behind, slowed to half speed while reading', [420, 640]),
  night: M('hushed', 'fade in, 700ms', 'dotted underline appears dot by dot', 'stars twinkle very slowly', [700, 900], 'ease-in-out'),
  ocean: M('rolling', 'rise in on a gentle wave curve', 'pill outline ripples once', 'bubbles rise behind', [520, 700], 'ease-in-out'),
  steampunk: M('mechanical, deliberate', 'slide in on a rail, with a soft stop', 'box frame closes like a shutter', 'one gear turns slowly in the corner', [500, 600], 'cubic-bezier(.6,0,.3,1)'),
  cyberpunk: M('precise, digital', 'type on, letter by letter, 18ms each', 'glow outline draws on (never flickers)', 'scanline sweep behind, 9s', [360, 400], 'steps(12)'),
  newYear: M('festive, smooth', 'fade up', 'double rule draws out from the centre', 'one firework bloom behind every 12s (dropped when photosensitive)'),
  lunarNewYear: M('graceful', 'unroll from the top, like a scroll', 'box frame draws in', 'lanterns sway', [600, 700], 'ease-out'),
  valentines: M('gentle', 'fade in', 'underline draws in', 'hearts drift up slowly', [560, 700], 'ease-out'),
  stPatricks: M('cheerful', 'hop in, 8px', 'pill fills green', 'clover sways', [440, 520], 'cubic-bezier(.3,1.4,.5,1)'),
  easter: M('soft, bouncy', 'rise with a small bounce', 'pill pops', 'eggs bob gently', [460, 520], 'cubic-bezier(.3,1.4,.5,1)'),
  july4: M('bold, upbeat', 'slide in from the left', 'box draws in', 'bunting sways', [400, 500]),
  halloween: M('playful, never scary', 'wobble in (2 degrees, once)', 'mark fills like a glowing pumpkin, held steady', 'a bat crosses now and then', [480, 560]),
  diwali: M('warm, glowing', 'fade in with a warm glow that settles', 'dotted underline lights dot by dot', 'diya flames breathe', [600, 800], 'ease-out'),
  harvest: M('steady, homely', 'fade in', 'underline draws in', 'wheat sways', [520, 640], 'ease-out'),
  hanukkah: M('quiet, steady', 'fade in', 'box draws in', 'candle flames breathe', [560, 700], 'ease-out'),
  christmas: M('cosy, twinkly', 'fade in', 'dotted underline appears dot by dot', 'tree lights twinkle slowly (still when photosensitive)', [560, 700], 'ease-out'),
  medieval: M('stately, unhurried', 'unroll from the top, like a scroll', 'underline inks in from the left', 'a banner stirs now and then', [560, 700], 'ease-out'),
};

/* ---------- inventory: what a theme already has that a lesson can use ---------- */
export function inventory(theme = 'nimrod') {
  const homes = Object.entries(HOMES[theme] || {}).map(([, h]) => h.label);
  const outfits = Object.values(OUTFITS).filter((o) => o.theme === theme).map((o) => o.label);
  const pieces = Object.values(KIT).filter((p) => p.theme === theme).map((p) => p.label);
  return { theme, label: (TOWN_DRESS[theme] || {}).label, liveScene: true, park: true, cards: !!cardThemes[theme], places: Object.keys(PLACES).length, homes, outfits, pieces, teachers: ['King Kenny', 'Queen Rose', 'Jack', 'Robin'], palette: (TOWN_DRESS[theme] || {}).palette || [] };
}

export const LESSON_KIT = { LESSON_THEMES, TYPE_VOICE, MOTION, lessonTheme, typeStyles, typeCss, chartSvg, layoutSvg, teacherSvg, inventory, contrast };
