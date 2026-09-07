#!/usr/bin/env python3
"""Which rule still invents its own z-index?

WHY THIS EXISTS. Before `layers.css`, the client held z-indexes from `1` to `2147483000`, each
chosen locally, and the comments beside them reasoned about one another: *"z-index 6, ABOVE the
settings sheet (5)"*, *"sits ABOVE the press overlay (40)"*, *"deliberately BELOW
[data-way-out]'s 2147483000"*. That is a stacking order held together by whoever last read all
of it at once, and it makes Mike's two asks impossible: balloons drifting BEHIND the clock and
IN FRONT of the wallpaper, and a card that throws a coin OVER EVERYTHING.

    py -3.13 web/client/dev/raw_zindex.py

A raw number is not always wrong, but it is always a DECISION MADE ALONE. The bands are 100
apart so ordering within one needs no new number: `calc(var(--z-panel-contents) + 10)`.

THE ONE ALLOWED EXCEPTION, and it is listed rather than hidden: `[data-way-out]` in
`demo_strip.js` (and `tour.js`, which is pinned just below it) uses a literal, because that
element must render even if the stylesheet failed to load — which is exactly when somebody most
needs to leave. A `var()` that resolves to nothing drops the z-index entirely.
"""
import io, os, re, sys

HERE   = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.dirname(HERE)
EXT    = ('.css', '.html', '.js')

RAW = re.compile(r'z-?[iI]ndex\s*[:=]\s*[\'"]?(-?\d+)')
ALLOWED_FILES = {'layers.css', 'layers.js'}
# The escape hatch and the tour that is pinned below it. Named here so the exception is a
# decision somebody can find, rather than a number that quietly passes.
ESCAPES = {'demo_strip.js', 'tour.js'}


def main():
    findings, escapes = [], []
    for base, dirs, names in os.walk(CLIENT):
        # `dev/` is harnesses, not product. A test fixture positioning its own badge is not a
        # module inventing a depth, and listing them trains everybody to skim the output.
        dirs[:] = [d for d in dirs
                   if d not in ('.venv', 'node_modules', '__pycache__', 'dev')]
        for n in names:
            if not n.endswith(EXT) or n in ALLOWED_FILES:
                continue
            path = os.path.join(base, n)
            rel = os.path.relpath(path, CLIENT)
            src = io.open(path, encoding='utf-8').read()
            for m in RAW.finditer(src):
                line = src[:m.start()].count('\n') + 1
                # A comment quoting an old value is prose, not a rule.
                ln = src[src.rfind('\n', 0, m.start()) + 1: src.find('\n', m.start())]
                if ln.strip().startswith(('//', '*', '/*', '#')):
                    continue
                (escapes if n in ESCAPES else findings).append((rel, line, m.group(1), ln.strip()[:70]))

    if escapes:
        print('the documented escape-hatch exceptions (these are correct):\n')
        for rel, line, val, ln in escapes:
            print(f'  {rel}:{line}  z-index:{val}')
        print()
    if findings:
        print('*** A Z-INDEX INVENTED OUTSIDE THE SCALE:\n')
        for rel, line, val, ln in findings:
            print(f'  {rel}:{line}  z-index:{val}')
            print(f'      {ln}')
        print('\nUse a band from `layers.css`, or `calc(var(--z-<band>) + n)` to order within one.')
        return 1
    print('Every z-index outside the escape hatch comes from the scale.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
