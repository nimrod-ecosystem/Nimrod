#!/usr/bin/env python3
"""Which declared settings does the module never actually read?

WHY THIS EXISTS. On 2026-09-06 three modules - pressgame, call and comet - declared
settings and never subscribed to their own state, so every row in their menus was
inert while the panel was on screen. `dev/live_settings_test.html` now catches that
at runtime.

THIS IS THE SAME LIE POINTED THE OTHER WAY. A module can subscribe perfectly and
still declare a row whose key nothing in the file ever looks at. The menu then shows
a control, somebody moves it, the value is written to storage, the panel redraws -
and nothing changes, because no line of code asks for that key. It is worse than an
inert menu, because the module LOOKS like it is honouring the setting: the value
comes back when you reopen the menu.

    py -3.13 web/client/dev/unread_settings.py

SOURCE SCAN, NOT A RUN. It knows the file mentions the key; it cannot know the
mention does anything useful. Treat a listed row as "unproven", not "broken" - and
treat an EMPTY list as the useful result, because that is what it is normally.

WHAT IT DELIBERATELY DOES NOT FLAG:
  * a key read through a helper (`fieldValue(f, s)`, `readWithLegacy(snap, 'k', ...)`)
    - the key still appears as a string, so it is found;
  * `settingsChoices` keys, which are live OPTIONS for a declared row rather than
    rows themselves.
The one shape it cannot see is a key assembled at runtime (`cfg['fit' + n]`). No
module does that today, and if one starts, this will report a false positive rather
than a false negative - which is the right way round for a list like this.
"""
import os, re, sys

HERE    = os.path.dirname(os.path.abspath(__file__))
CLIENT  = os.path.dirname(HERE)
MODULES = os.path.join(CLIENT, 'modules')

# `{ key: 'stepMs', label: ... }` in a SETTINGS array. The manifest is the contract, so the
# declaration is what the menu shows and therefore what a person can move.
DECL = re.compile(r"""\{\s*key:\s*['"]([A-Za-z_$][\w$]*)['"]""")


def read_keys(src, key):
    """Every way the file could be ASKING for this setting, excluding its own declaration.

    Deliberately generous. A false "it is read" hides a dead control; a false "never read"
    sends somebody hunting for a bug that is not there, and this file exists to be trusted
    when it is empty.
    """
    pats = [
        rf'\bcfg\.{re.escape(key)}\b',              # cfg.stepMs
        rf'\bcfg\[\s*[\'"]{re.escape(key)}[\'"]',   # cfg['stepMs']
        rf'\{{[^{{}}\n]*\b{re.escape(key)}\b[^{{}}\n]*\}}\s*=',   # const { stepMs } = ...
        rf'\bsnap\.{re.escape(key)}\b',
        rf'\bsaved\.{re.escape(key)}\b',
        rf'\bs\.{re.escape(key)}\b',
        rf'\brow\.{re.escape(key)}\b',
        rf'\bstate\.get\(\)\.{re.escape(key)}\b',
        # A helper that takes the key as a string: readWithLegacy(snap, 'minWatchMs', ...)
        rf'[\'"]{re.escape(key)}[\'"]\s*[,)\]]',
        # DEFAULTS carries it, which is a read in every module that spreads DEFAULTS over
        # the saved row -- the value reaches `cfg` and something downstream uses it.
        rf'^\s*{re.escape(key)}\s*:',
    ]
    for p in pats:
        for m in re.finditer(p, src, re.M):
            # Not the declaration itself.
            line = src[src.rfind('\n', 0, m.start()) + 1: src.find('\n', m.start())]
            if 'key:' in line and 'label:' in line:
                continue
            return True
    return False


def main():
    findings = []
    checked = 0
    for name in sorted(os.listdir(MODULES)):
        if not name.endswith('.js'):
            continue
        path = os.path.join(MODULES, name)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        # Only the keys inside a settings DECLARATION. `DECL` matches `{ key: 'x'` which also
        # appears in option lists; those have `value:` rather than `label:` beside them, and
        # the read check below is what actually decides, so a stray match is harmless.
        keys = []
        for m in DECL.finditer(src):
            line = src[src.rfind('\n', 0, m.start()) + 1: src.find('\n', m.start()) + 1]
            if 'label:' in line or 'label:' in src[m.start(): m.start() + 200]:
                keys.append(m.group(1))
        keys = sorted(set(keys))
        if not keys:
            continue
        checked += len(keys)
        dead = [k for k in keys if not read_keys(src, k)]
        if dead:
            findings.append((name, dead))

    print(f'{checked} declared settings across {len(os.listdir(MODULES))} module files\n')
    if not findings:
        print('No declared setting is unread. Every row in every menu reaches something.')
        return 0
    print('DECLARED BUT NEVER READ -- a control somebody can move that changes nothing:\n')
    for name, dead in findings:
        print(f'  {name}')
        for k in dead:
            print(f'      {k}')
    print('\nSource scan: the key is never mentioned outside its own declaration. Check each')
    print('one before deleting it -- a key built at runtime would look like this too.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
