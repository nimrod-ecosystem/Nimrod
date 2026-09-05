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

It reads two shapes of press - the direct `querySelector('[data-x]').click()` and the
two-step `const b = btn('[data-x]'); ... b?.click()`. Missing the second produced false
"never pressed" rows on controls that WERE covered, which is the worst way for a list
like this to be wrong: it sends somebody to write a test that already exists.
"""
import os, re, collections

HERE    = os.path.dirname(os.path.abspath(__file__))
CLIENT  = os.path.dirname(HERE)
MODULES = os.path.join(CLIENT, 'modules')

# `mount.querySelector('[data-next]').addEventListener('click', ...)` and friends
BIND = re.compile(r"""querySelector(?:All)?\(\s*['"]([^'"]+)['"]\s*\)[\s\S]{0,80}?addEventListener\(\s*['"](click|pointerdown|change|input)['"]""")
# A test pressing one, in either shape:
#   direct   - `host.querySelector('[data-next]').click()`
#   two-step - `const gear = btn('[data-gear]'); ... gear?.click()`
# The two-step form is common and missing it produced FALSE "never pressed" rows on controls
# that were in fact covered, which is the worst failure mode for a list like this: it sends
# somebody to write a test that already exists.
SEL = r"""[^'"]*\[data-[^'"\]]+\][^'"]*|\.[a-z][\w-]*"""
# Selectors are compared by the ATTRIBUTE THEY NAME, not by their exact text. A module binds
# `[data-opt]` while a test presses `[data-opt="fit"]`; those are the same control, and
# comparing strings reported it as untested. Same for a quoted value inside the selector,
# which an "anything but a quote" pattern can never match in the first place.
ATTR = re.compile(r"\[(data-[\w-]+)")

def key(sel):
    """The control a selector names: its data-attribute, else the selector itself."""
    m = ATTR.search(sel or '')
    return m.group(1) if m else (sel or '').strip()

# A press, in either shape:
#   direct   - `host.querySelector('[data-next]').click()`
#   two-step - `const gear = btn('[data-gear]'); ... gear?.click()`
PRESS_DIRECT = re.compile(r"""['"]([^'"]*\[data-[\w-]+[^'"]*|\.[a-z][\w-]*)['"]\s*\)?[\s\S]{0,80}?\.click\(\)""")
# NON-GREEDY on purpose: `const gear = btn('[data-gear]'), panel = q('[data-settings]')` must
# bind `gear` to the FIRST selector on the line, not the last one a greedy match would reach.
ASSIGN = re.compile(r"""(?:const|let|var)\s+(\w+)\s*=\s*[^;
]*?['"]([^'"]*\[data-[\w-]+[^'"]*)['"]""")
CLICKED_VAR = re.compile(r"""(\w+)\s*\??\.click\(\)""")
DISPATCHED_VAR = re.compile(r"""(\w+)\s*\??\.dispatchEvent\(""")

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

MOUNTS = re.compile(r"""mountModule\(\s*['"]([a-z_]+)['"]|pressControls\(\s*['"]([a-z_]+)['"]|modules/([a-z_]+)\.js""")

# A suite can delegate to the shared checker instead of writing its own clicks:
#     await pressControls('youtube', [{ sel: '[data-next]', topic: 'youtube/next', ... }])
# The `.click()` then lives in dev/press_controls.js, not in the suite - so scanning only for
# clicks reported those controls as untested the moment they became tested, which is precisely
# backwards.
DELEGATED = re.compile(r"""sel:\s*['"]([^'"]+)['"]""")

# Some helpers in dev/press_controls.js drive a control WITHOUT the suite naming a selector -
# `pressRetry('photos', check)` presses `[data-retry]` itself. What each helper drives is
# declared here because the scanner cannot infer it, and a helper gaining a control without
# this map being updated will show up as a false "never pressed" row.
HELPER_DRIVES = {
    'pressRetry': ['[data-retry]'],
}
HELPER_CALL = re.compile(r'\b(%s)\s*\(' % '|'.join(HELPER_DRIVES))

def presses_in(src):
    """Every control a single test file drives, directly or through the shared checker."""
    found = {key(m.group(1)) for m in DELEGATED.finditer(src)}
    for m in HELPER_CALL.finditer(src):
        found |= {key(sel) for sel in HELPER_DRIVES[m.group(1)]}
    for m in PRESS_DIRECT.finditer(src):
        found.add(key(m.group(1)))
    for m in re.finditer(r"""['"]([^'"]*\[data-[\w-]+[^'"]*)['"]\s*\)?[\s\S]{0,80}?\.dispatchEvent\(""", src):
        found.add(key(m.group(1)))
    held = {m.group(1): m.group(2) for m in ASSIGN.finditer(src)}
    for rx in (CLICKED_VAR, DISPATCHED_VAR):
        for m in rx.finditer(src):
            if m.group(1) in held:
                found.add(key(held[m.group(1)]))
    return found

def main():
    # PER MODULE, not globally. `[data-opt]` exists on five modules; one test pressing its own
    # would otherwise mark all five covered, which turns this list into a comfortable lie.
    # A press only counts for a module the test actually mounts.
    pressed = collections.defaultdict(set)
    for fn in sorted(os.listdir(HERE)):
        if not fn.endswith('.html'):
            continue
        src = read(os.path.join(HERE, fn))
        mods = {g for m in MOUNTS.finditer(src) for g in m.groups() if g}
        if not mods:
            continue
        here = presses_in(src)
        for mod in mods:
            pressed[mod] |= here

    rows, total, unpressed_total = [], 0, 0
    for fn in sorted(os.listdir(MODULES)):
        if not fn.endswith('.js'):
            continue
        mod = fn[:-3]
        controls = sorted({m.group(1) for m in BIND.finditer(read(os.path.join(MODULES, fn)))})
        if not controls:
            continue
        unpressed = [c for c in controls if key(c) not in pressed.get(mod, set())]
        total += len(controls)
        unpressed_total += len(unpressed)
        if unpressed:
            rows.append((mod, len(controls), unpressed))

    print('| module | controls | NEVER pressed by any test |')
    print('|---|---|---|')
    for mod, n, un in rows:
        print(f'| `{mod}` | {n} | ' + ', '.join(f'`{c}`' for c in un) + ' |')
    print()
    print(f'{unpressed_total} of {total} controls across {len(rows)} modules are never pressed '
          f'by any test in web/client/dev/.')

if __name__ == '__main__':
    main()
