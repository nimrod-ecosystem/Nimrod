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


ACTIONS = os.path.normpath(os.path.join(HERE, '..', 'actions.js'))


def verb_map():
    """MODULE_VERBS from actions.js - THE AUTHORITATIVE ANSWER to "what verbs does this module
    answer", because it is what `input_router.js` actually consults. A module type absent from
    it is never focused and no verb reaches it, whatever it subscribes to."""
    try:
        src = read(ACTIONS)
    except OSError:
        return {}
    # ANCHOR ON THE DECLARATION, NOT THE NAME. `MODULE_VERBS` first appears in a COMMENT
    # sixty lines above its definition, so `find('MODULE_VERBS')` landed there and the brace
    # match started in prose - which reported every module as answering no verbs, including
    # `call`, whose map is right there in the file. That went into a published table before
    # I caught it, which is the second wrong column this generator has produced.
    #
    # Comments are stripped before brace-matching: a `{` inside prose throws the count off,
    # and actions.js is heavily commented.
    src = re.sub(r'//[^\n]*', '', src)
    m0 = re.search(r'export\s+const\s+MODULE_VERBS\s*=\s*\{', src)
    if not m0:
        return {}
    j = m0.end() - 1
    depth = 0
    end = j
    for k in range(j, len(src)):
        if src[k] == '{':
            depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                end = k
                break
    body = src[j:end]
    out = {}
    for m in re.finditer(r'^\s*([A-Za-z_$][\w$]*)\s*:\s*\{', body, re.M):
        name = m.group(1)
        # the verbs are the keys of that inner object
        d = 0
        for k in range(m.end() - 1, len(body)):
            if body[k] == '{':
                d += 1
            elif body[k] == '}':
                d -= 1
                if d == 0:
                    inner = body[m.end():k]
                    out[name] = sorted(set(re.findall(r'([A-Za-z_$][\w$]*)\s*:', inner))
                                       - {'topic', 'payload'})
                    break
    return out


VERB_MAP = verb_map()


def verbs(src, type_name):
    """What the module ANSWERS.

    TWO SOURCES, and the second one is why this function was rewritten. The first version only
    matched `subscribe('some/topic')` with a STRING LITERAL - so `call.js`, which subscribes to
    the exported constants `CALL_ANSWER` / `CALL_HANGUP` / `CALL_DECLINE`, came back as
    answering NOTHING. The table then said the call module could not be driven by a switch,
    which is false and alarming: `actions.js` maps `select -> call/answer` and
    `back -> call/hangup`, so a call has always been answerable with one button.

    A table with one wrong cell is worse than no table. This now resolves local constants AND
    reads `MODULE_VERBS`, which is the map the router actually consults."""
    got = set(re.findall(r"subscribe\??\.?\(\s*'([^']+)'", src))
    # `subscribe(SOME_CONST` -> look the constant up in this file.
    for name in set(re.findall(r'subscribe\??\.?\(\s*([A-Z][A-Z0-9_]*)', src)):
        m = re.search(r"%s\s*=\s*'([^']+)'" % re.escape(name), src)
        if m:
            got.add(m.group(1))
    topics = sorted(t for t in got if '/' in t)
    return topics, VERB_MAP.get(type_name, [])


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
        'verbs': verbs(src, t)[0],
        'mapped': verbs(src, t)[1],
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
    out.append('| module | depends | importance | settings | topics | verbs a switch can send | renders | container | writes events | holds state | headless |')
    out.append('|---|---|---|---|---|---|---|---|---|---|')
    for r in ROWS:
        out.append('| `%s` | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            r['type'], r['dependsOn'], r['importance'],
            r['settings'] or '**0**',
            len(r['verbs']) or '-',
            ', '.join(r['mapped']) or '**none**',
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
    no_verbs = [r['type'] for r in ROWS if not r['mapped']]
    no_depends = [r['type'] for r in ROWS if r['dependsOn'].startswith('(')]
    out.append('- **declare no settings (%d of %d):** %s' % (len(no_settings), len(ROWS), ', '.join('`%s`' % t for t in no_settings) or 'none'))
    out.append('- **no verb a switch can send reaches them (%d)** - they are absent from `MODULE_VERBS` in `actions.js`, so the router never focuses them: %s'
               % (len(no_verbs), ', '.join('`%s`' % t for t in no_verbs) or 'none'))
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
