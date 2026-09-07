#!/usr/bin/env python3
"""Which rules paint a hardcoded light background under THEMED text?

WHY THIS EXISTS. `--surface` and `--text` are defined as a MATCHED PAIR in every theme. A rule
that hardcodes the background and themes the text keeps half the pair and throws away the
other - and in `dusk` and `contrast`, `--text` is a NEAR-WHITE.

    background:#fff; color:var(--text);      <- white on white, in two of five themes

*** IT IS INVISIBLE IN THE THEME YOU ARE LOOKING AT. *** Everybody develops in `default`, where
the hardcoded white and the themed surface happen to be the same colour, so the rule looks
perfect. It breaks for whoever chose the dark theme, which on a bedside screen is the person
most likely to have chosen it deliberately.

    py -3.13 web/client/dev/unthemed_surfaces.py

Found this way on 2026-09-07, after the same class had already been fixed once inside
`modules.css`: every form field on `index.html`, the pairing-code input somebody TYPES INTO on
`pair.html`, inline code and the try button's hover on `modules.html`.

WHAT IT DOES NOT FLAG, because none of these is the bug:
  * `rgba(255,255,255,.x)` - a translucent wash over chrome that is deliberately dark;
  * a literal background paired with a literal colour (`#fff` + `#1f1f1f`) - self-consistent,
    unthemed on purpose, e.g. Google's sign-in branding or a QR code that must be white to scan;
  * a background with no colour in the same block at all - the text is inherited and this
    scanner cannot tell from here what it inherited. Those are worth a human's eye, and are
    listed separately and quietly.
"""
import io, os, re, sys

HERE   = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.dirname(HERE)
EXT    = ('.css', '.html')

# A CSS rule body: everything between { and the next }.
RULE = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)
# An OPAQUE light literal. rgba() with alpha is excluded on purpose - see the docstring.
OPAQUE_LIGHT = re.compile(
    r'background(?:-color)?\s*:\s*(#fff\b|#ffffff\b|white\b|#f[0-9a-f]{2}\b|#f[0-9a-f]{5}\b)', re.I)
THEMED_TEXT = re.compile(r'color\s*:\s*var\(\s*--(text|text-soft|text-muted|text-strong|ink)')
LITERAL_TEXT = re.compile(r'(?<!-)color\s*:\s*(#[0-9a-f]{3,8}\b|rgb|black|white)', re.I)


def files():
    for base, dirs, names in os.walk(CLIENT):
        dirs[:] = [d for d in dirs if d not in ('.venv', 'node_modules', '__pycache__', 'dev')]
        for n in names:
            if n.endswith(EXT):
                yield os.path.join(base, n)


def main():
    bad, unclear = [], []
    for path in files():
        src = io.open(path, encoding='utf-8').read()
        rel = os.path.relpath(path, CLIENT)
        for m in RULE.finditer(src):
            sel, body = m.group(1).strip().splitlines()[-1].strip(), m.group(2)
            bg = OPAQUE_LIGHT.search(body)
            if not bg:
                continue
            line = src[:m.start(2)].count('\n') + 1
            if THEMED_TEXT.search(body):
                bad.append((rel, line, sel[:60], bg.group(1)))
            elif not LITERAL_TEXT.search(body):
                unclear.append((rel, line, sel[:60], bg.group(1)))

    if bad:
        print('*** HARDCODED LIGHT BACKGROUND UNDER THEMED TEXT -- unreadable in dusk/contrast:\n')
        for rel, line, sel, colour in bad:
            print(f'  {rel}:{line}  {sel}')
            print(f'      background:{colour} with color:var(--text...)')
        print()
    if unclear:
        print('a hardcoded light background whose text is INHERITED (a human should look):\n')
        for rel, line, sel, colour in unclear:
            print(f'  {rel}:{line}  {sel}  ({colour})')
        print()
    if not bad and not unclear:
        print('No rule pairs a hardcoded light background with themed text.')
    elif not bad:
        print('No rule pairs a hardcoded light background with THEMED text.')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
