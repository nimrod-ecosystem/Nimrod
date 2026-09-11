#!/usr/bin/env python3
"""check_hardcoded_colors.py - REPORT LITERAL COLOR VALUES IN CSS OUTSIDE theme.js.

*** WHY THIS EXISTS. *** CI check #2 of nine from `docs/for_chat/MIKE_CHANGE_LIST.md`'s "rules
you cannot enforce become suggestions" finding: "no module hardcodes a colour... every one of
this project's worst visual bugs was an undeclared constant" — `--gold` defined nowhere and
hardcoded amber in every theme, white panel backgrounds that ignored every dark theme, a
1.00:1 contrast ratio nobody caught because nothing was checking. `theme.js` is where a color
is SUPPOSED to live (its `THEMES` vars, referenced elsewhere as `var(--whatever)`); a literal
hex/rgb/hsl value sitting directly in a stylesheet is a decision that bypassed it.

*** WHY THIS IS A REPORT, NOT A GATE, AND WHY THAT'S NOT A COP-OUT HERE EITHER. *** A first
pass over this repo's five stylesheets found ~180 literal color values. Some genuinely are
undeclared theme decisions waiting to be found (the exact bug class this exists to catch).
Some are legitimate as literals — `transparent`, `currentColor`, a one-off `rgba(0,0,0,.4)`
scrim that isn't meant to themeable, `#fff`/`#000` inside a shadow's alpha channel. Telling
those apart needs a human looking at each one in context; a hard gate would need either a
maintained allowlist (which rots the way every other unenforced rule does) or false failures
on every legitimate literal. What's genuinely automatable is finding every candidate so that
triage is a known, bounded task instead of an occasional manual grep nobody remembers to run.

USAGE, from the repo root:

    py -3.13 web/tools/check_hardcoded_colors.py
    py -3.13 web/tools/check_hardcoded_colors.py --summary   # counts per file only

Exit status is always 0 - this is a report, never a build-breaker.
"""
import re
import sys
from pathlib import Path

# Same fix run_suite.py and check_absolutes.py both already needed: a Windows console
# defaults to cp1252, and this file's own em dashes kill the report otherwise.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
CSS_FILES = sorted((REPO_ROOT / 'web' / 'client').glob('*.css'))

# hex (#abc, #aabbcc, #aabbccdd), rgb()/rgba(), hsl()/hsla() — NOT var()/currentColor/named
# CSS keywords, which are either already theme-driven or deliberately not a color at all.
COLOR_RE = re.compile(
    r'#[0-9a-fA-F]{3,8}\b'
    r'|rgba?\([^)]*\)'
    r'|hsla?\([^)]*\)'
)
# Lines that are themselves a custom-property DECLARATION (`--foo: #abc;`) are the thing this
# check wants to see happen, not flag — a literal belongs exactly once, at the declaration.
CUSTOM_PROP_DECL = re.compile(r'^\s*--[\w-]+\s*:')


def scan(path):
    hits = []
    for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith('//') or stripped.startswith('/*') or stripped.startswith('*'):
            continue
        if CUSTOM_PROP_DECL.match(line):
            continue
        for m in COLOR_RE.finditer(line):
            hits.append({'line': i, 'value': m.group(0), 'text': stripped[:100]})
    return hits


def main(argv):
    summary_only = '--summary' in argv
    total = 0
    print(f'Scanning {len(CSS_FILES)} stylesheet(s) under web/client/ for literal color values '
          f'outside a --custom-property declaration.\n'
          f'Not a failure by itself — theme.js is where a color SHOULD live; this just finds '
          f'every place one is written directly instead, for a human to triage.\n')
    for path in CSS_FILES:
        hits = scan(path)
        total += len(hits)
        rel = path.relative_to(REPO_ROOT)
        print(f'{rel} — {len(hits)} literal color value(s)')
        if not summary_only:
            for h in hits:
                print(f'    L{h["line"]:<5} {h["value"]:<20} {h["text"]}')
        print()
    print(f'{total} total across {len(CSS_FILES)} file(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
