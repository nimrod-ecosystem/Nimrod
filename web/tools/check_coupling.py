#!/usr/bin/env python3
"""check_coupling.py - REPORT VIOLATIONS OF THE NODE/MODULE-ISOLATION PRINCIPLES.

*** WHY THIS EXISTS. *** `docs/for_chat/MIKE_CHANGE_LIST.md` row 2.19, Mike, 2026-09-23, after
chat found motion/flash handling spread across eight files and seven files calling `voice.js`
directly: *"This is something our architecture was supposed to avoid... Maybe one of Cici's
tasks should be looking through the code for anything that breaks our principles."* This is
Tier 1 of the two-tier auditor chat proposed in `docs/from_chat/ideas_register.md` entry 248 —
a rule-based lint, deterministic, seconds, no model involved. Tier 2 (a local model reading
what this flags, plus recent diffs, against the written principles) is separate, later work and
is deliberately NOT built here.

The principle this checks, in `module.js`'s own words: "A module talks to the world ONLY
through ctx. It never names its inputs, never reaches storage directly..." — modules
communicate over the shared bus/state/events handles, not by importing a sibling module's file
or reaching around the output bus (`output.js`'s arbitrated say/cancel) to a channel directly.

*** WHY THIS IS A REPORT, NOT A PASS/FAIL GATE *** — same reasoning as this file's two siblings
(`check_absolutes.py`, `check_hardcoded_colors.py`): some hits are genuine, understood, accepted
exceptions (a shared constants file that happens to live in `modules/` for a documented reason;
a fallback path to `voice.js` that only fires when no output bus was injected). A hard gate
would need a maintained allowlist that rots, or would misfire on the exceptions Mike has
already accepted. What is deterministic and useful is finding every candidate, with enough
context that a human doesn't have to re-derive which hits are already-argued exceptions.

FOUR CHECKS, each its own report section:

  1. MODULE-IMPORTS-MODULE  — any file in web/client/modules/*.js with a relative import that
     resolves to another file inside web/client/modules/. Precise and deterministic: this either
     is or isn't true of a given import path.

  2. VOICE.JS SIDE DOORS — any file under web/client/ (other than output_channels.js, the one
     arbitrated speech channel) importing web/client/voice.js directly. Precise and
     deterministic in the same way as #1. Files that also reference `ctx.output?.say` /
     `ctx.output?.cancel` are annotated as using the documented "prefer the bus, fall back to
     voice.js only when no bus was injected" idiom (`board.js`'s own pattern, copied by
     `educational.js` and `sprint.js`) rather than reported as bare violations — the import is
     still real and still printed, just with the context attached.

  3. MOTION/FLASH SPREAD — *** THIS CHECK IS A SPREAD-REPORT, NOT A PRECISE VIOLATION DETECTOR,
     * the same honest way check_hardcoded_colors.py's own header admits its color check needs
     human triage. *** There is no single shared photosensitivity module to import today, so
     there is nothing to grep for as "the right way" the way #1/#2 have one. What IS
     deterministic: which files reference the vocabulary this problem already has —
     `prefers-reduced-motion`, `reducedMotion`, `MOTIONS`, `peakLumRate`, `SAFETY_FLOOR_MS`,
     `photosensitiv*`. Every hit is grouped by file so a human can see the current spread at a
     glance and judge which are genuine duplication versus legitimately separate concerns —
     this check does not attempt that judgment itself.

  4. HARD-CODED TIMING CONSTANTS — narrowed deliberately, per row 2.19's own caution that some
     hard-coded numbers are "deliberate safety floors" (e.g. `SAFETY_FLOOR_MS`, row 2.2).
     Flagging every numeric literal in 100+ files would be pure noise nobody could act on, so
     this looks ONLY at top-level `const NAME = <number>` declarations in web/client/modules/*.js
     whose name contains Ms/Delay/Timeout/Duration/Interval — real candidates for "should this be
     a setting" without being a general numeric-literal scan. Two things soften the result
     further: (a) a hit with "floor"/"safety"/"photosensitiv" in a nearby comment is bucketed
     separately as a documented floor, following `pressgame.js`'s own `SAFETY_FLOOR_MS` as the
     template for what "commented as deliberate" looks like; (b) a hit whose camelCase form (e.g.
     `CUE_MIN_MS` -> `cueMinMs`) shows up as a declared `key: 'cueMinMs'` elsewhere in the same
     file is annotated as already a real settings field; (c) one that instead shows up only as
     `ctx.cueMinMs` is annotated as a test-injection seam (this codebase's own idiom — see
     `sprint.js`'s `ctx.tickMs` doc comment) rather than a person-facing setting — a real,
     useful distinction a plain substring search blurred in this check's first draft, which
     mislabeled `personal.js`'s `PROGRESS_MS` and `photos.js`'s `VIDEO_STALL_MS` as "maybe
     already a settings key" when both are only `ctx.*` test seams. KNOWN LIMITATIONS, stated
     plainly: this only catches the Ms/Delay/Timeout/Duration/Interval naming pattern, only at
     true top-of-file scope (indent 0), and only in web/client/modules/ (not the ~30 other
     client files, to keep this a first, boundable pass rather than a repo-wide noise generator)
     — a constant named something else, or one nested inside a function, is invisible to it. The
     camelCase transform (SCREAMING_SNAKE -> camelName) is a guess about this codebase's naming
     convention, not a real parse of `settings_fields.js`, and can still mismatch a module that
     names its settings key or ctx override differently from its constant.

USAGE, from the repo root:

    py -3.13 web/tools/check_coupling.py
    py -3.13 web/tools/check_coupling.py --summary   # counts per check/file only

Exit status is always 0 - this is a report, never a build-breaker. Pipe it somewhere and read it.
"""
import re
import sys
from pathlib import Path

# Same fix run_suite.py, check_absolutes.py and check_hardcoded_colors.py all already needed:
# a Windows console defaults to cp1252, and this file's own em dashes kill the report otherwise.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIENT_DIR = REPO_ROOT / 'web' / 'client'
MODULES_DIR = CLIENT_DIR / 'modules'
VOICE_JS = (CLIENT_DIR / 'voice.js').resolve()

# Matches a static `from '...'` (import or re-export) and a dynamic `import('...')` — both are
# how a file names another module in this codebase.
IMPORT_RE = re.compile(r"""from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]""")

# Check 1: an import path is a documented, accepted exception when its target basename is one
# of these — a shared-constants file that happens to live in modules/, not gameplay logic. Say
# so next to the hit rather than silently allowlisting it, per row 2.19's own instruction.
KNOWN_MODULE_IMPORT_EXCEPTIONS = {
    'bank.js': ("documented exception — modules/bank.js holds shared question/word-bank "
                "constants (BANK_STATE, BANK_TOPIC) that Trivia and Word Forge both read; "
                "the actual question/word CONTENT lives in a shared per-profile state row "
                "(ctx.makeState('bank')), not in this import. See modules/bank.js's own header "
                "and MIKE_CHANGE_LIST.md row 2.19."),
}

# Check 2: the one legitimate importer of voice.js — the arbitrated speech output channel
# itself (output.js routes every other caller through here).
VOICE_ALLOWED_IMPORTER = 'output_channels.js'

# Check 3: vocabulary this problem already has, per row 2.19's own list plus the terms chat used
# to find it. Not a "the right shared mechanism" grep — there isn't one shared mechanism yet —
# just the words today's scattered implementations already use.
MOTION_RE = re.compile(
    r'prefers-reduced-motion|reducedMotion|\bMOTIONS\b|peakLumRate|SAFETY_FLOOR_MS|photosensitiv',
    re.I,
)

# Check 4: a top-level (indent 0) `const NAME = <number>` whose name reads as a timing constant.
TIMING_CONST_RE = re.compile(
    r'^const\s+([A-Z][A-Z0-9_]*(?:MS|DELAY|TIMEOUT|DURATION|INTERVAL)[A-Z0-9_]*)\s*=\s*(-?\d[\d.]*)\s*;',
)
FLOOR_COMMENT_RE = re.compile(r'floor|safety|photosensitiv', re.I)


def resolve_relative_import(importer, spec):
    """None if `spec` isn't a relative path; otherwise the resolved target Path (.js added if
    the bare resolved path doesn't exist but the same path + .js does — every import in this
    codebase spells the extension out today, but a future one might not)."""
    if not spec.startswith('.'):
        return None
    target = (importer.parent / spec).resolve()
    if not target.exists() and target.suffix != '.js':
        candidate = target.with_name(target.name + '.js')
        if candidate.exists():
            target = candidate
    return target


def iter_js_files(root, exclude_dev=True):
    for path in sorted(root.rglob('*.js')):
        if exclude_dev and 'dev' in path.relative_to(CLIENT_DIR).parts:
            continue
        yield path


def check_module_imports_module():
    hits = []
    module_files = sorted(MODULES_DIR.glob('*.js'))
    for f in module_files:
        text = f.read_text(encoding='utf-8')
        for i, line in enumerate(text.splitlines(), start=1):
            for m in IMPORT_RE.finditer(line):
                spec = m.group(1) or m.group(2)
                target = resolve_relative_import(f, spec)
                if target is None:
                    continue
                try:
                    target.relative_to(MODULES_DIR)
                except ValueError:
                    continue
                if target.resolve() == f.resolve():
                    continue
                note = KNOWN_MODULE_IMPORT_EXCEPTIONS.get(target.name)
                hits.append({
                    'file': f.relative_to(REPO_ROOT), 'line': i, 'spec': spec,
                    'target': target.name, 'note': note, 'text': line.strip()[:110],
                })
    return hits


def check_voice_side_doors():
    hits = []
    for f in iter_js_files(CLIENT_DIR):
        text = f.read_text(encoding='utf-8')
        has_bus_fallback = bool(re.search(r'ctx\.output\?\.(say|cancel)', text))
        for i, line in enumerate(text.splitlines(), start=1):
            for m in IMPORT_RE.finditer(line):
                spec = m.group(1) or m.group(2)
                target = resolve_relative_import(f, spec)
                if target is None or target.resolve() != VOICE_JS:
                    continue
                if f.name == VOICE_ALLOWED_IMPORTER:
                    note = 'ALLOWED — this is the arbitrated speech channel itself (output.js routes every other caller through here).'
                elif has_bus_fallback:
                    note = ("documented fallback — file also calls ctx.output?.say / "
                            "ctx.output?.cancel; this import is used only when no output bus "
                            "was injected (board.js's idiom, copied here). Still a real import "
                            "of voice.js, listed for completeness.")
                else:
                    note = 'no ctx.output fallback found in this file — looks like a bare side door around the output bus.'
                hits.append({
                    'file': f.relative_to(REPO_ROOT), 'line': i, 'spec': spec, 'note': note,
                    'text': line.strip()[:110],
                })
    return hits


def check_motion_flash_spread():
    by_file = {}
    for f in iter_js_files(CLIENT_DIR):
        text = f.read_text(encoding='utf-8')
        lines = text.splitlines()
        file_hits = []
        for i, line in enumerate(lines, start=1):
            for m in MOTION_RE.finditer(line):
                file_hits.append({'line': i, 'term': m.group(0), 'text': line.strip()[:110]})
        if file_hits:
            by_file[f.relative_to(REPO_ROOT)] = file_hits
    return by_file


def check_hardcoded_timing_constants():
    floors, candidates = [], []
    for f in sorted(MODULES_DIR.glob('*.js')):
        text = f.read_text(encoding='utf-8')
        lines = text.splitlines()
        for i, line in enumerate(lines, start=1):
            m = TIMING_CONST_RE.match(line.strip())
            if not m:
                continue
            name, value = m.group(1), m.group(2)
            # look at this line plus up to 2 lines above for a "floor/safety/photosensitivity" note
            context = '\n'.join(lines[max(0, i - 3):i])
            is_floor = bool(FLOOR_COMMENT_RE.search(context))
            # crude SCREAMING_SNAKE -> camelCase, this codebase's own convention for a settings
            # key or a ctx.* test-injection override (e.g. CUE_MIN_MS -> cueMinMs)
            camel = re.sub(r'_([a-zA-Z0-9])', lambda mm: mm.group(1).upper(), name.lower())
            rest = text.replace(line, '', 1)
            is_settings_key = bool(re.search(r"key:\s*['\"]" + re.escape(camel) + r"['\"]", rest))
            is_ctx_seam = bool(re.search(r'ctx\.' + re.escape(camel) + r'\b', rest))
            row = {
                'file': f.relative_to(REPO_ROOT), 'line': i, 'name': name, 'value': value,
                'text': line.strip()[:110], 'camel_guess': camel,
                'is_settings_key': is_settings_key, 'is_ctx_seam': is_ctx_seam,
            }
            (floors if is_floor else candidates).append(row)
    return floors, candidates


def main(argv):
    summary_only = '--summary' in argv

    print('check_coupling.py — Tier 1 rule-based lint against the module-isolation / no-side-door')
    print('principles (MIKE_CHANGE_LIST.md row 2.19). Report only — exit code is always 0.\n')

    # --- Check 1 --------------------------------------------------------------------------
    hits1 = check_module_imports_module()
    print(f'1. MODULE-IMPORTS-MODULE — {len(hits1)} hit(s) in web/client/modules/*.js\n'
          f'   Modules talk over ctx (bus/state/events), never by importing a sibling module file.\n')
    if hits1:
        for h in hits1:
            print(f'    {h["file"]}:{h["line"]:<5} imports "{h["spec"]}"')
            if not summary_only:
                print(f'        {h["text"]}')
            if h['note']:
                print(f'        NOTE: {h["note"]}')
            else:
                print(f'        no known exception recorded for "{h["target"]}" — treat as a real hit')
        print()
    else:
        print('    none found.\n')

    # --- Check 2 --------------------------------------------------------------------------
    hits2 = check_voice_side_doors()
    real2 = [h for h in hits2 if 'ALLOWED' not in h['note']]
    print(f'2. VOICE.JS SIDE DOORS — {len(hits2)} import(s) of voice.js under web/client/ '
          f'({len(real2)} outside the allowed channel)\n'
          f'   Everything but output_channels.js should reach speech through output.js\'s '
          f'arbitrated say/cancel, not voice.js directly.\n')
    if hits2:
        for h in hits2:
            print(f'    {h["file"]}:{h["line"]:<5} imports "{h["spec"]}"')
            if not summary_only:
                print(f'        {h["text"]}')
            print(f'        {h["note"]}')
        print()
    else:
        print('    none found.\n')

    # --- Check 3 --------------------------------------------------------------------------
    spread = check_motion_flash_spread()
    total3 = sum(len(v) for v in spread.values())
    print(f'3. MOTION/FLASH SPREAD — {total3} reference(s) across {len(spread)} file(s)\n'
          f'   SPREAD-REPORT, not a violation detector (see header) — no single shared '
          f'photosensitivity module exists yet to check against. Grouped by file so a human can '
          f'judge genuine duplication vs. legitimately separate concerns.\n')
    if spread:
        for file, file_hits in spread.items():
            print(f'    {file} — {len(file_hits)} reference(s)')
            if not summary_only:
                for h in file_hits:
                    print(f'        L{h["line"]:<5} "{h["term"]}"  {h["text"]}')
        print()
    else:
        print('    none found.\n')

    # --- Check 4 --------------------------------------------------------------------------
    floors, candidates = check_hardcoded_timing_constants()
    print(f'4. HARD-CODED TIMING CONSTANTS — {len(candidates)} candidate(s), '
          f'{len(floors)} documented floor(s), in web/client/modules/*.js\n'
          f'   Top-level Ms/Delay/Timeout/Duration/Interval constants only (see header for why '
          f'this is narrower than "hard-coded numbers"). A "no absolutes" candidate for becoming '
          f'a user setting, unless it is a deliberate floor.\n')
    print(f'    -- {len(candidates)} candidate(s), not (yet) commented as a deliberate floor --')
    if candidates:
        for h in candidates:
            if h['is_settings_key']:
                tag = f'  [already a declared settings field: key: \'{h["camel_guess"]}\']'
            elif h['is_ctx_seam']:
                tag = f'  [testable via ctx.{h["camel_guess"]}, but that is a test seam, not a person-facing setting]'
            else:
                tag = ''
            print(f'    {h["file"]}:{h["line"]:<5} {h["name"]} = {h["value"]}{tag}')
            if not summary_only:
                print(f'        {h["text"]}')
    else:
        print('        none found.')
    print(f'\n    -- {len(floors)} documented safety floor(s) — shown for completeness, not action items --')
    if floors:
        for h in floors:
            print(f'    {h["file"]}:{h["line"]:<5} {h["name"]} = {h["value"]}')
            if not summary_only:
                print(f'        {h["text"]}')
    else:
        print('        none found.')
    print()

    total = len(hits1) + len(real2) + total3 + len(candidates)
    print(f'--- {total} item(s) worth a human look (checks 1, 2, 3, and 4\'s candidates; '
          f'check 3 is a spread count, not a violation count; documented floors and the '
          f'allowed voice.js importer are excluded from this number). ---')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
