#!/usr/bin/env python3
"""Which `var(--x)` does nothing, because nothing defines `--x`?

WHY THIS EXISTS. On 2026-09-07 the theme variables were renamed from brand names to role
names - 1053 occurrences across 23 files. The rename script asserted that no legacy name
survived, which catches a HALF-done rename in the obvious direction. It cannot catch the
other one: a name renamed to something nothing defines.

*** AND THAT FAILURE IS SILENT. *** `color: var(--txet)` is not an error. The declaration is
simply dropped, the element inherits, and in four themes out of five it looks fine because
the inherited colour happens to be close. You find it in the fifth theme, on somebody's
screen, at night.

    py -3.13 web/client/dev/undefined_vars.py

WHAT COUNTS AS DEFINED:
  * a key in theme.js's BASE map or in any theme's `vars` override;
  * anything assigned in CSS or by JS `setProperty`, anywhere in web/client - which covers
    module-scoped variables like `--ab-card` and the ones set per-element at runtime.

A `var(--x, fallback)` WITH a fallback is reported separately and quietly: it still renders,
so it is a smell rather than a defect - though a fallback that silently masks a typo'd name
is exactly how a rename goes half-done without anybody noticing.

SOURCE SCAN, NOT A RUN. It cannot see a variable a page defines only under a media query it
never matches, and it will call that defined. Treat a listed name as "check this", and treat
an empty list as the useful answer - which is what it should normally be.
"""
import io, os, re, sys

HERE   = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.dirname(HERE)
EXT    = ('.js', '.css', '.html')

# `var(--x)` and `var(--x, something)`
USE = re.compile(r'var\(\s*(--[\w-]+)\s*(,)?')
# `--x: value` in CSS or in a JS object literal, and `setProperty('--x', ...)`
# CSS `--x: value` AND the JS object form `'--x': value`, which has a quote between the name
# and the colon. Missing the second meant every variable that lives only in `theme.js`'s BASE
# map read as undefined -- the scanner was quietly relying on the palette ALSO being written
# into `index.html`'s `:root`, which is true for the old keys and was not true for a new one.
DEF_CSS = re.compile(r'''(--[\w-]+)['"]?\s*:''')
DEF_JS  = re.compile(r"""setProperty\(\s*['"](--[\w-]+)['"]""")
# *** A NAME BUILT AT RUNTIME IS STILL A DEFINITION. ***
#
# `theme.js` derives the readable-ink colours with a COMPUTED name:
#
#     rootEl.style.setProperty(`--on${accent.slice(1)}`, onColor(value));
#
# so `--on-accent`, `--on-link` and `--on-accent-warm-deep` are all defined, and none of them
# appears as a literal anywhere. The first version of this script reported all three as
# "renders as nothing" -- which is the same over-reporting that `unpressed_controls.py` did
# twice today, and it is the failure mode that sends somebody to fix what is not broken.
#
# Any literal PREFIX in a template-literal setProperty marks that whole family as computed.
DEF_JS_TEMPLATE = re.compile(r'setProperty\(\s*`(--[\w-]*)\$\{')


# A `var(--x)` inside a COMMENT is prose, not a reference. Without this, writing *about* a dead
# variable in the comment that explains why it is dead keeps it on the list for ever.
BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.S)
LINE_COMMENT = re.compile(r'^[ \t]*(?://|#).*$', re.M)
HTML_COMMENT = re.compile(r'<!--.*?-->', re.S)


def strip_comments(src):
    src = BLOCK_COMMENT.sub('', src)
    src = HTML_COMMENT.sub('', src)
    return LINE_COMMENT.sub('', src)


def files():
    for base, dirs, names in os.walk(CLIENT):
        dirs[:] = [d for d in dirs if d not in ('.venv', 'node_modules', '__pycache__')]
        for n in names:
            if n.endswith(EXT):
                yield os.path.join(base, n)


def main():
    defined, computed, used, used_with_fallback = set(), set(), {}, {}
    for path in files():
        src = strip_comments(io.open(path, encoding='utf-8').read())
        for m in DEF_CSS.finditer(src):
            defined.add(m.group(1))
        for m in DEF_JS.finditer(src):
            defined.add(m.group(1))
        for m in DEF_JS_TEMPLATE.finditer(src):
            computed.add(m.group(1))
        for m in USE.finditer(src):
            name, fallback = m.group(1), bool(m.group(2))
            rel = os.path.relpath(path, CLIENT)
            (used_with_fallback if fallback else used).setdefault(name, set()).add(rel)

    def known(n):
        return n in defined or any(n.startswith(pfx) for pfx in computed)

    bare = {n: p for n, p in used.items() if not known(n)}
    fell = {n: p for n, p in used_with_fallback.items() if not known(n)}

    print(f'{len(defined)} variables defined'
          + (f' (+{len(computed)} computed families: {", ".join(sorted(computed))}*)' if computed else '')
          + f', {len(used) + len(used_with_fallback)} referenced\n')

    if bare:
        print('*** USED WITH NO DEFINITION AND NO FALLBACK -- these render as nothing:\n')
        for n in sorted(bare):
            print(f'  {n}')
            for f in sorted(bare[n]):
                print(f'      {f}')
        print()
    if fell:
        print('used with no definition but WITH a fallback (renders, but the name is dead):\n')
        for n in sorted(fell):
            print(f'  {n}  <- {", ".join(sorted(fell[n]))}')
        print()
    if not bare and not fell:
        print('Every var() resolves to something a theme or a stylesheet defines.')
    return 1 if bare else 0


if __name__ == '__main__':
    sys.exit(main())
