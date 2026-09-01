// settings_audit.js — THE CHECK NOBODY ELSE WOULD WRITE.
//
// Two jobs, and the second one is the reason this exists rather than a linter.
//
// 1. THE DECLARATIONS ARE CONSISTENT. Every failure mode in the settings layer is SILENT: a
//    row that looks right, a value that cannot be compared, a control nobody can reach. None
//    of them throw, none of them show up in a test of the thing they break, and all of them
//    are obvious the moment somebody looks at every manifest at once — which nobody does.
//
// 2. HOW MANY PRESSES IT COSTS. Mike, and it is the better half of the idea:
//    *"people can customize their own AAC setups and they need to know which buttons actually
//    get used compared to how hard they are to get to."*
//
//    THAT TURNS A JUDGEMENT CALL INTO A NUMBER. "Is this usable with one switch" is
//    unanswerable by looking; "her most-used setting costs eleven presses and her least-used
//    one costs two" is a fact, and the repair is obvious the moment it is stated. A board
//    where the thing she says most is scanned last costs her real minutes every day, and
//    NOBODY CAN SEE THAT BY LOOKING AT IT.
//
// PRESSES ARE THE UNIT, not seconds, because a press is what the person spends. Multiply by a
// SCAN STEP where there is one — `input_scan.js` runs a 15 SECOND step, with the reason
// written beside it ("she understands the task but needs time to process the cue"), so twelve
// presses there is three minutes, not twelve seconds. The multiplier belongs to the surface;
// the count belongs here.
//
// (This used to say "scan dwell". `dwell` now means holding still to click — `input_dwell.js`
// — and the scanning sense moved to `step` when scanning was extracted. See the glossary.)
//
// EVERYTHING IS PURE. It takes manifests and returns findings. It does not read the registry,
// it does not touch the DOM, and it does not know what a module is — which is what lets the
// same functions audit a live build, a proposed change, and a fixture with known faults.

import { normalizeField, fieldsFor, showsAtLevel, readWithLegacy, LEVELS } from './settings_fields.js';

export const SEVERITY = ['error', 'warn', 'info'];

// Presses at which a control stops being a control. Chosen, not measured, and worth
// revisiting against a real person rather than defending:
//   12  about a full lap of a twelve-stop control. Fine.
//   24  two laps of that. On a 15s step it is six minutes to change one setting.
export const WALK_WARN = 12;
export const WALK_BAD = 24;

// ---------------------------------------------------------------------------------------
// IMPORTANCE — THE PART THE FIRST VERSION GOT WRONG, and the pond is what exposed it.
//
// The audit's first run named `pond.ambientMs` as the worst control in the product. Mike's
// reply: *"I'm not too concerned about the pond game. We can lose it if we need to."*
//
// HE WAS RIGHT AND THE TOOL WAS WRONG. Ranking by COST ALONE sends you to fix whatever is
// most expensive, which is not the same as whatever MATTERS — and here it pointed at the one
// module its owner would happily delete. A finding about a module nobody would miss is not
// the same finding as one about the module that is the entire point of the product.
//
// Cost per use fixes this properly, and it is built — but it needs a per-person press log
// that does not exist yet. THIS IS THE STANDING SIGNAL IN THE MEANTIME, and it is already a
// stated fact of the project rather than a guess: CLAUDE.md says *"PHOTOS outrank every
// game/feature"*, and somebody may not be able to reach for anything, so a module they must PLAY is one
// she may never use at all.
//
// Thresholds scale with it. Twelve presses on the photos panel is a real problem; twelve on
// a pond nobody has to touch is a note.
export const IMPORTANCE = ['critical', 'normal', 'optional'];
const IMPORTANCE_SCALE = { critical: 0.5, normal: 1, optional: 2 };
export const importanceOf = (man) =>
  (IMPORTANCE.includes(man?.importance) ? man.importance : 'normal');

// Words that mean "a length of time". Used only to ask whether a key ends in `Ms`, so a false
// positive costs one `info` line and a false negative costs a unit mismatch nobody notices.
const DURATION_WORDS = /(interval|delay|timeout|duration|dwell|display|watch|hold|linger|linger|period|every|wait|lockout|debounce)/i;
const SECONDS_SUFFIX = /(sec|secs|seconds)$/i;

const finding = (severity, code, text, where = {}) => ({ severity, code, text, ...where });

// ---------------------------------------------------------------------------------------
// pressesToWalk — a full lap of one control, in `select` presses.
//
// A LAP, not a single step, because with one switch you can only travel one way: getting back
// to where you started means going all the way round, so the lap IS the cost of changing your
// mind. Zero means the control cannot be driven at all.
// ---------------------------------------------------------------------------------------
export function pressesToWalk(field) {
  if (!field || !field.cycleable) return 0;
  if (field.kind === 'toggle') return 2;
  if (field.kind === 'choice') return (field.options || []).length;
  if (field.kind === 'number') {
    const { min, max, step } = field;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(step > 0)) return 0;
    const span = max - min;
    const whole = Math.floor(span / step);
    // The stepper lands ON the bound before it wraps, so an off-grid range costs ONE MORE
    // press than the arithmetic suggests — and that extra press is the thing that makes a
    // declared maximum reachable at all.
    return whole + (whole * step === span ? 1 : 2);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------
// walkCosts — the whole menu, at one complexity level.
//
// `reach` is how many `next` presses it takes to land on a row: rows are walked in order and
// the cursor wraps, so row N costs N presses from the top. Non-cycleable rows are skipped by
// the cursor and therefore cost nothing to pass — which is exactly why they are rendered
// disabled rather than hidden.
//
// `total` is reach + a full lap, i.e. THE WORST CASE for "change this one thing and be sure
// you could have picked anything else".
// ---------------------------------------------------------------------------------------
export function walkCosts(fields = [], { level = 'standard', usage = null } = {}) {
  const shown = (fields || []).filter((f) => f && showsAtLevel(f, level));
  const stops = shown.filter((f) => f.cycleable);
  const rows = [];
  stops.forEach((f, i) => {
    const walk = pressesToWalk(f);
    const uses = usage && Object.prototype.hasOwnProperty.call(usage, f.key)
      ? Number(usage[f.key]) || 0 : null;
    rows.push({
      key: f.key,
      label: f.label,
      kind: f.kind,
      level: f.level,
      reach: i,
      walk,
      total: i + walk,
      uses,
      // MIKE'S NUMBER. Cost per use is what says a cheap control nobody touches is fine and
      // an expensive one somebody uses every day is not. Null when there is no usage data,
      // rather than 0 — "we do not know" and "never used" are different answers and merging
      // them would hide the second one.
      costPerUse: uses == null ? null : (uses === 0 ? null : (i + walk) / uses),
    });
  });
  const unreachable = shown.filter((f) => !f.cycleable).map((f) => ({ key: f.key, why: f.why }));
  return {
    level,
    rows,
    unreachable,
    worst: rows.reduce((a, r) => (r.total > (a?.total ?? -1) ? r : a), null),
    // What one person spends in a session, if the usage numbers are real. This is the number
    // a reordering has to reduce, and the only honest way to say a change helped.
    weighted: rows.every((r) => r.uses == null)
      ? null
      : rows.reduce((sum, r) => sum + (r.uses || 0) * r.total, 0),
  };
}

// ---------------------------------------------------------------------------------------
// suggestOrder — the reordering that the numbers imply.
//
// Cheapest position to the most-used control. It is the whole optimisation and it is one
// sort, which is the point: the hard part was never the algorithm, it was HAVING THE NUMBERS.
//
// Returns null when there is nothing to say — either no usage data, or the order is already
// the best one. Silence is the right output for "no change needed"; a recommendation that
// recommends what you already do is how a tool teaches people to ignore it.
// ---------------------------------------------------------------------------------------
export function suggestOrder(fields = [], { level = 'standard', usage = null } = {}) {
  const before = walkCosts(fields, { level, usage });
  if (before.weighted == null) return null;
  const byUse = [...before.rows].sort((a, b) => (b.uses || 0) - (a.uses || 0));
  const after = byUse.reduce((sum, r, i) => sum + (r.uses || 0) * (i + r.walk), 0);
  if (after >= before.weighted) return null;
  return {
    order: byUse.map((r) => r.key),
    before: before.weighted,
    after,
    saved: before.weighted - after,
  };
}

// ---------------------------------------------------------------------------------------
// auditFields — one module's declarations.
// ---------------------------------------------------------------------------------------
export function auditFields(fields = [], { type = '', declared = null } = {}) {
  const out = [];
  const at = (key) => ({ module: type, key });

  // Anything `normalizeField` REFUSED. It drops a bad declaration rather than throwing, which
  // is right at runtime (the menu is how somebody repairs a screen) and invisible — so this is
  // the only place a module author ever finds out.
  if (Array.isArray(declared)) {
    for (const d of declared) {
      if (!d || typeof d !== 'object' || typeof d.key !== 'string' || !d.key.trim()) {
        out.push(finding('error', 'no-key',
          'a declared field has no key and was silently dropped', at('')));
      }
    }
  }

  const seen = new Set();
  for (const f of fields) {
    if (seen.has(f.key)) {
      out.push(finding('error', 'duplicate-key',
        `"${f.key}" is declared twice in one module; the second one is unreachable`, at(f.key)));
    }
    seen.add(f.key);

    if (f.kind === 'number' && !f.cycleable && f.why === 'needs a keyboard') {
      out.push(finding('error', 'unbounded-number',
        `"${f.key}" is a number with no min/max, so it cannot wrap and nobody on one switch `
        + 'can reach it', at(f.key)));
    }
    if (f.kind === 'choice' && !f.cycleable && !(f.options || []).length) {
      out.push(finding('info', 'empty-choice',
        `"${f.key}" has no options declared — fine if a mounted instance supplies them through `
        + 'settingsChoices(), a dead row if not', at(f.key)));
    }
    if (f.kind === 'choice' && (f.options || []).length === 1) {
      out.push(finding('warn', 'single-choice',
        `"${f.key}" declares exactly one option, so it renders disabled`, at(f.key)));
    }

    // THE HOUSE RULE FOR DURATIONS. Two "how long between things" settings in two units cannot
    // be compared, grouped or set together, which is what makes them decoration rather than
    // data — and it is precisely the drift that took four settings to unpick.
    if (SECONDS_SUFFIX.test(f.key)) {
      out.push(finding('error', 'seconds-key',
        `"${f.key}" stores seconds; every stored duration is milliseconds and its key ends in `
        + '"Ms" (declare `legacy` and rename — never reinterpret the old key)', at(f.key)));
    } else if (DURATION_WORDS.test(f.key) && !/Ms$/.test(f.key) && f.kind !== 'text') {
      out.push(finding('warn', 'duration-key',
        `"${f.key}" reads like a duration but its key does not end in "Ms"`, at(f.key)));
    }

    if (f.label === f.key) {
      out.push(finding('info', 'unlabelled',
        `"${f.key}" has no label, so the row shows the raw key`, at(f.key)));
    }
  }

  // A module where nothing is `essential` offers nothing at all on a stripped-down screen.
  if (fields.length && !fields.some((f) => f.level === 'essential')) {
    out.push(finding('warn', 'no-essential',
      'no field is marked `essential`, so this panel has no settings on a patient screen',
      { module: type }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// auditAcross — the checks that only exist when you look at every module at once.
//
// This is the class of fault that took a real migration to find: `photos.intervalSec` in
// seconds beside `pond.ambientMs` in milliseconds, both correct on their own, together
// impossible to compare. Nobody sees it from inside one file.
// ---------------------------------------------------------------------------------------
export function auditAcross(byModule = {}) {
  const out = [];
  const kinds = new Map();     // key -> Map(kind -> [modules])
  const stems = new Map();     // "interval" -> Map(fullKey -> [modules])

  for (const [type, fields] of Object.entries(byModule)) {
    for (const f of fields || []) {
      if (!kinds.has(f.key)) kinds.set(f.key, new Map());
      const m = kinds.get(f.key);
      m.set(f.kind, [...(m.get(f.kind) || []), type]);

      const stem = f.key.replace(/(Ms|Sec|Secs|Seconds)$/i, '').toLowerCase();
      if (DURATION_WORDS.test(f.key) || /(Ms|Sec)$/i.test(f.key)) {
        if (!stems.has(stem)) stems.set(stem, new Map());
        const g = stems.get(stem);
        g.set(f.key, [...(g.get(f.key) || []), type]);
      }
    }
  }

  for (const [key, m] of kinds) {
    if (m.size > 1) {
      const how = [...m.entries()].map(([k, mods]) => `${k} in ${mods.join('/')}`).join(', ');
      out.push(finding('error', 'type-conflict',
        `"${key}" is declared as ${how} — one setting, two types, and nothing can compare them`,
        { key }));
    }
  }
  for (const [stem, g] of stems) {
    if (g.size > 1) {
      const how = [...g.entries()].map(([k, mods]) => `${k} (${mods.join('/')})`).join(' vs ');
      out.push(finding('error', 'unit-conflict',
        `"${stem}" is stored under different names/units: ${how}`, { key: stem }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// auditValues — STORED data against the declarations.
//
// The declarations can be perfect and storage still hold what was written before the rule
// existed. This is what says whether a migration actually finished, which is the difference
// between "read both keys" being a transitional state and being permanent.
// ---------------------------------------------------------------------------------------
export function auditValues(fields = [], values = {}, { type = '' } = {}) {
  const out = [];
  const at = (key) => ({ module: type, key });
  const has = (k) => values && Object.prototype.hasOwnProperty.call(values, k)
    && values[k] !== undefined && values[k] !== null;

  for (const f of fields) {
    if (f.legacy && has(f.legacy.key)) {
      out.push(finding(has(f.key) ? 'info' : 'warn', 'legacy-value',
        has(f.key)
          ? `"${f.legacy.key}" is still stored but shadowed by "${f.key}" — safe to delete`
          : `"${f.key}" has not been written yet; it is still reading "${f.legacy.key}". `
            + 'When the legacy read is removed this falls back to the default.',
        at(f.key)));
    }
    if (!has(f.key)) continue;
    const v = values[f.key];
    const want = f.kind === 'toggle' ? 'boolean' : (f.kind === 'number' ? 'number' : null);
    if (want && typeof v !== want) {
      out.push(finding('error', 'type-mismatch',
        `"${f.key}" is stored as ${typeof v} (${JSON.stringify(v)}) but declared ${f.kind}`,
        at(f.key)));
    }
    if (f.kind === 'choice' && (f.options || []).length) {
      const hit = f.options.some((o) => o.value === v);
      if (!hit) {
        const loose = f.options.some((o) => String(o.value) === String(v));
        out.push(finding(loose ? 'error' : 'warn',
          loose ? 'type-mismatch' : 'orphan-value',
          loose
            ? `"${f.key}" holds ${JSON.stringify(v)}, which matches an option only loosely — `
              + 'it is the wrong type and will not compare'
            : `"${f.key}" holds ${JSON.stringify(v)}, which is not one of its options`,
          at(f.key)));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// auditManifests — everything, over a list of manifests. The one call a page makes.
// ---------------------------------------------------------------------------------------
export function auditManifests(manifests = [], { level = 'standard', values = {}, usage = {} } = {}) {
  // `importance` is read off each manifest below - see IMPORTANCE above for why the tool
  // needs it and what happens when it does not have it.
  const byModule = {};
  const findings = [];
  const costs = {};

  for (const man of manifests || []) {
    const type = man?.type || '(unnamed)';
    let declared = man?.settings;
    if (typeof declared === 'function') { try { declared = declared(); } catch { declared = []; } }
    const fields = fieldsFor(man, null);
    byModule[type] = fields;
    if (!fields.length) continue;

    findings.push(...auditFields(fields, { type, declared }));
    findings.push(...auditValues(fields, values[type] || {}, { type }));
    costs[type] = walkCosts(fields, { level, usage: usage[type] || null });

    const w = costs[type].worst;
    const imp = importanceOf(man);
    const k = IMPORTANCE_SCALE[imp];
    costs[type].importance = imp;
    if (w && w.total >= WALK_BAD * k) {
      findings.push(finding('error', 'unreachable-cost',
        `"${w.key}" costs ${w.total} presses to reach and walk — on a 15s scan step that is `
        + `${Math.round(w.total * 15 / 60)} minutes to change one setting`,
        { module: type, key: w.key, importance: imp }));
    } else if (w && w.total > WALK_WARN * k) {
      findings.push(finding(imp === 'optional' ? 'info' : 'warn', 'costly',
        `"${w.key}" costs ${w.total} presses to reach and walk`
        + (imp === 'optional' ? ' (this module is marked optional, so it is a note)' : ''),
        { module: type, key: w.key, importance: imp }));
    }
  }

  findings.push(...auditAcross(byModule));
  const rank = (f) => SEVERITY.indexOf(f.severity);
  findings.sort((a, b) => rank(a) - rank(b));
  return {
    findings,
    costs,
    byModule,
    counts: SEVERITY.reduce((o, s) => ({ ...o, [s]: findings.filter((f) => f.severity === s).length }), {}),
  };
}

// Re-exported so a caller auditing raw declarations does not need two imports.
export { normalizeField, readWithLegacy, LEVELS };
