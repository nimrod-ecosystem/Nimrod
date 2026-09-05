#!/usr/bin/env python3
"""Which on-screen controls does NO test ever press?

WHY THIS EXISTS. On 2026-09-05 nine buttons across five modules did nothing when
pressed - photos/youtube/personal/educational next+prev and interstitials' skip -
because `bus.route()` dropped bare signals. Every one of those modules ALSO answers
its bus topic directly, and every test drove the TOPIC. The topic worked perfectly.
Nobody drove the BUTTON, so the suite stayed green while the arrow under Christine's
photos was dead.

A test that exercises the layer UNDERNEATH the thing a person touches will stay green
through exactly that. This lists the controls with nobody on top.

    py -3.13 web/client/dev/unpressed_controls.py

SOURCE SCAN, NOT A RUN. It knows a test clicks a selector; it cannot know the click
asserted anything useful. Treat a listed control as "unproven", not "broken".
"""
import os, re, collections

HERE    = os.path.dirname(os.path.abspath(__file__))
CLIENT  = os.path.dirname(HERE)
MODULES = os.path.join(CLIENT, 'modules')

# `mount.querySelector('[data-next]').addEventListener('click', ...)` and friends
BIND = re.compile(r"""querySelector(?:All)?\(\s*['"]([^'"]+)['"]\s*\)[\s\S]{0,80}?addEventListener\(\s*['"](click|pointerdown|change|input)['"]""")
# a test pressing one: `.querySelector('[data-next]').click()` / `host.querySelector(sel).click()`
PRESS = re.compile(r"""['"]([^'"]*\[data-[^'"\]]+\][^'"]*|\.[a-z][\w-]*)['"]\s*\)?[\s\S]{0,60}?\.click\(\)""")

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def main():
    # every selector any dev test presses, anywhere
    pressed = set()
    devdir = HERE
    for fn in sorted(os.listdir(devdir)):
        if not fn.endswith('.html'):
            continue
        for m in PRESS.finditer(read(os.path.join(devdir, fn))):
            pressed.add(m.group(1))
    # plus the client's own pages (kiosk drives some controls itself)
    rows, total, unpressed_total = [], 0, 0
    for fn in sorted(os.listdir(MODULES)):
        if not fn.endswith('.js'):
            continue
        mod = fn[:-3]
        src = read(os.path.join(MODULES, fn))
        controls = sorted({m.group(1) for m in BIND.finditer(src)})
        if not controls:
            continue
        unpressed = [c for c in controls if c not in pressed]
        total += len(controls)
        unpressed_total += len(unpressed)
        if unpressed:
            rows.append((mod, len(controls), unpressed))

    print(f'| module | controls | NEVER pressed by any test |')
    print(f'|---|---|---|')
    for mod, n, un in rows:
        print(f'| `{mod}` | {n} | ' + ', '.join(f'`{c}`' for c in un) + ' |')
    print()
    print(f'{unpressed_total} of {total} controls across {len(rows)} modules are never pressed '
          f'by any test in web/client/dev/.')

if __name__ == '__main__':
    main()
