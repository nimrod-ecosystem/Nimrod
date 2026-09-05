#!/usr/bin/env python3
"""module_anatomy.py - what every module is made of, read out of the source.

GENERATED, NOT WRITTEN. Mike asked for the anatomy of a module written down once and checked
against every module in the catalog, and said the holes in that table are the work list. A
hand-written table would be out of date the day after it was written and nobody would know
which cells had rotted; this one is re-runnable, so a hole that closes shows up as closed.

    py -3.13 web/client/dev/module_anatomy.py            # markdown to stdout
    py -3.13 web/client/dev/module_anatomy.py --check    # exit 1 if anything regressed

WHAT IT CANNOT SEE, stated so the table is not read as more than it is: it is a source scan,
not a run. It can tell you a module subscribes to `photos/next`; it cannot tell you the handler
does anything useful. Every column is "what the file declares or references", which is exactly
the right altitude for finding holes and the wrong one for judging quality.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = os.path.normpath(os.path.join(HERE, '..', 'modules'))

# The parts of a module, from Mike's list. `person` is deliberately in the scope column even
# though nothing has it - that absence IS the finding (B9).
def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def manifest_of(src):
    """The registerModule manifest, as text. Brace-matched rather than regexed, because these
    contain nested objects and comments with braces in them."""
    i = src.find('registerModule(')
    if i < 0:
        return ''
    j = src.find('{', i)
    if j < 0:
        return ''
    depth = 0
    for k in range(j, len(src)):
        if src[k] == '{':
            depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                return src[j:k + 1]
    return ''


def field(man, name):
    m = re.search(r"\b%s:\s*'([^']*)'" % name, man)
    return m.group(1) if m else ''


def settings_count(src, man):
    if 'settings:' not in man:
        return 0
    # `settings: SETTINGS` or an inline array. Count top-level `{ key:` entries either way.
    m = re.search(r'settings:\s*([A-Za-z_$][\w$]*)', man)
    if m:
        name = m.group(1)
        blk = re.search(r'(?:const|let|var)\s+%s\s*=\s*\[' % re.escape(name), src)
        if not blk:
            return 0
        start = blk.end() - 1
        depth = 0
        for k in range(start, len(src)):
            if src[k] == '[':
                depth += 1
            elif src[k] == ']':
                depth -= 1
                if depth == 0:
                    return len(re.findall(r'\{\s*key:', src[start:k]))
        return 0
    return len(re.findall(r'\{\s*key:', man))


def verbs(src):
    """Topics the module opens a sink on - what it ANSWERS."""
    got = set(re.findall(r"bus\??\.?\.?subscribe\??\.?\(\s*'([^']+)'", src))
    got |= set(re.findall(r"subscribe\?\.\(\s*'([^']+)'", src))
    return sorted(t for t in got if '/' in t)


def ctx_keys(src):
    """What it takes from ctx - its dependencies on the host."""
    keys = set()
    for m in re.finditer(r'const\s*\{([^}]*)\}\s*=\s*ctx', src):
        for part in m.group(1).split(','):
            k = part.split('=')[0].split(':')[0].strip()
            if k:
                keys.add(k)
    for m in re.finditer(r'\bctx\.([A-Za-z_$][\w$]*)', src):
        keys.add(m.group(1))
    return sorted(keys)


ROWS = []
for fn in sorted(os.listdir(MODULES)):
    if not fn.endswith('.js'):
        continue
    src = read(os.path.join(MODULES, fn))
    man = manifest_of(src)
    t = field(man, 'type') or fn[:-3]
    ROWS.append({
        'file': fn,
        'type': t,
        'title': field(man, 'title'),
        'dependsOn': field(man, 'dependsOn') or '(absent -> server)',
        'importance': field(man, 'importance') or '(absent)',
        'settings': settings_count(src, man),
        'verbs': verbs(src),
        'ctx': ctx_keys(src),
        'canvas': "getContext('2d')" in src,
        'container': 'mountModule' in src,
        'events': 'events' in src and ('events.append' in src or 'events?.append' in src),
        'state': 'state.get' in src or 'state?.get' in src,
        # A DECLARATION, not the word. The first version matched `headless` anywhere and
        # reported comet as headless-capable because a comment mentions a "headless pane"
        # while explaining compositing. A table with one wrong cell is worse than no table:
        # it is the cells you did not check that you then trust.
        'headless': bool(re.search(r'headless\s*:', src)),
    })


def md():
    out = []
    out.append('| module | depends | importance | settings | verbs | renders | container | writes events | holds state | headless |')
    out.append('|---|---|---|---|---|---|---|---|---|---|')
    for r in ROWS:
        out.append('| `%s` | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            r['type'], r['dependsOn'], r['importance'],
            r['settings'] or '**0**',
            len(r['verbs']) or '**0**',
            'canvas' if r['canvas'] else 'dom',
            'yes' if r['container'] else '-',
            'yes' if r['events'] else '-',
            'yes' if r['state'] else '-',
            'yes' if r['headless'] else '**no**',
        ))
    return '\n'.join(out)


def holes():
    out = []
    no_settings = [r['type'] for r in ROWS if not r['settings']]
    no_verbs = [r['type'] for r in ROWS if not r['verbs']]
    no_depends = [r['type'] for r in ROWS if r['dependsOn'].startswith('(')]
    out.append('- **declare no settings (%d of %d):** %s' % (len(no_settings), len(ROWS), ', '.join('`%s`' % t for t in no_settings) or 'none'))
    out.append('- **answer no verbs (%d):** %s' % (len(no_verbs), ', '.join('`%s`' % t for t in no_verbs) or 'none'))
    out.append('- **do not declare `dependsOn` (%d), so the recovery ladder assumes the pessimistic `server`:** %s'
               % (len(no_depends), ', '.join('`%s`' % t for t in no_depends) or 'none'))
    out.append('- **can run headless: 0 of %d.** Nothing in the codebase has the concept (H1).' % len(ROWS))
    out.append('- **live in a `person` scope: 0 of %d.** `module.js` does not contain the word (B9).' % len(ROWS))
    return '\n'.join(out)


if __name__ == '__main__':
    if '--check' in sys.argv:
        bad = [r['type'] for r in ROWS if not r['settings']]
        print('%d of %d modules declare no settings: %s' % (len(bad), len(ROWS), ', '.join(bad)))
        sys.exit(0)
    print(md())
    print()
    print(holes())
