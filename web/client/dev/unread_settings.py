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


# `const DEFAULTS = { ... }` -- what the module reads out of its own state row. The keys here
# are the module's real configuration surface, whether or not anything declares them.
# *** THE FIRST VERSION OF THIS MISSED EVERY CASE IT WAS WRITTEN FOR. ***
# It required a multi-line DEFAULTS block and a two-space indent on each key. But `clock`
# declares its five ON ONE LINE, and clock is one of the three modules that prompted this
# check at all. So the audit ran clean while the thing it hunts sat in the file it was
# aimed at. A false negative here is worse than no audit: it is a green light over the
# exact gap. Verified after the fix by watching it name clock, educational and lessons.
DEFAULTS_BLOCK = re.compile(r'DEFAULTS\s*=\s*\{(.*?)\}\s*;', re.S)
DEFAULT_KEY = re.compile(r'[{,]\s*([A-Za-z_$][\w$]*)\s*:')


def undeclared(src, declared):
    """Keys the module READS that no settings row offers.

    *** THE MIRROR OF THE CHECK BELOW, AND THE ONE THAT KEEPS TURNING UP BY HAND. ***

    `educational` declared none and read four. `lessons` declared none and read one -- and had
    already been caught by its symptom, when its empty state pointed at "this module's settings"
    and there were none. `clock` declares none, reads five, and puts a gear on the panel that
    writes all five.

    A key like this is not a dead control, it is a LIVE one with no menu entry: the module
    honours it perfectly, and the only way to reach it is whatever the module drew itself. On a
    kiosk grid, where panel chrome may not be reachable at all, that is configuration nobody can
    get to.

    NOT EVERY KEY BELONGS IN A MENU, which is why this prints a list to read rather than a
    failure. Some state is genuinely internal -- a saved position, a deck somebody imported, a
    board somebody built. The question each row asks is "should a person be able to change this
    from the settings menu", and only a person can answer it.
    """
    m = DEFAULTS_BLOCK.search(src)
    if not m:
        return []
    # The capture group starts AFTER the opening brace, so the FIRST key in every DEFAULTS has
    # no `{` or `,` in front of it and the pattern skipped it -- silently, in every module at
    # once. `clock` reported four of its five and `hour12` never appeared. Putting the brace
    # back is the whole fix; finding it took noticing that a list of five printed four.
    # TOP-LEVEL KEYS ONLY. `view.js` holds { mirror: { size, corner }, clock: { corner } }, and a
    # flat scan reported `corner` twice as though the object literal had a duplicate key -- a
    # scary-looking finding that was purely the scanner not understanding nesting. Nested values
    # are one setting from a menu's point of view anyway.
    body = re.sub(r'\{[^{}]*\}', 'X', m.group(1))
    for _ in range(4):
        body = re.sub(r'\{[^{}]*\}', 'X', body)
    keys = DEFAULT_KEY.findall('{' + body)
    return [k for k in keys if k not in declared]


def main():
    findings = []
    reads = []
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
            # NO SETTINGS DECLARED AT ALL -- which is exactly the case that keeps being found by
            # hand, so it must not be the case this loop skips. `educational`, `lessons` and
            # `clock` were all here.
            missing = undeclared(src, set())
            if missing:
                reads.append((name, missing))
            continue
        checked += len(keys)
        dead = [k for k in keys if not read_keys(src, k)]
        if dead:
            findings.append((name, dead))
        missing = undeclared(src, set(keys))
        if missing:
            reads.append((name, missing))

    print(f'{checked} declared settings across {len(os.listdir(MODULES))} module files\n')

    if reads:
        print('READ BUT NEVER DECLARED -- live config with no row in the settings menu:\n')
        for name, missing in reads:
            print(f'  {name}')
            print(f'      {", ".join(missing)}')
        print('\nNot every one of these belongs in a menu -- some state is genuinely internal.')
        print('The question each asks is whether a person should be able to change it from the')
        print('settings menu, and only a person can answer that.\n')

    if not findings:
        print('No declared setting is unread. Every row in every menu reaches something.')
        return 1 if reads else 0
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
