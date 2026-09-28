#!/usr/bin/env python3
"""check_bare_topic_subscribers.py - FIND TESTS LISTENING ON A TOPIC THE VERB ROUTER NO LONGER PUBLISHES TO.

*** WHY THIS EXISTS. *** `e0c2027` (2026-09-10, "Instance addressing") made `input_router.js`
`dispatch` publish a verb to the FOCUSED INSTANCE'S scoped topic (`photos/next#p1`, built by
`bus.instanceTopic`) instead of the bare type topic (`photos/next`), so two photos panels stop
both hearing one verb. It updated two suites and missed a third, `input_runtime_test.html`,
whose listeners stayed on the bare topic and heard nothing. Nobody noticed for eighteen days:
the seven failures were filed as §0c, "pre-existing and unrelated", and re-filed as such by
every session after (`docs/for_chat/MIKE_CHANGE_LIST.md` §0c, resolved 2026-09-28). The suite
was red the whole time; what was missing was anything that made that red mean something.
This is the check the fix's own notes said was owed - a rule that lives only in a comment is a
suggestion.

WHAT IT FLAGS. A `<bus>.subscribe('<topic>', ...)` in a `dev/*_test.html` file where BOTH:

  1. `<topic>` is one a verb can land on - read from `MODULE_VERBS` in `actions.js` itself
     (`photos/next`, `segment/done`, ...), so the list cannot drift from the router's, and
  2. the file mounts something that dispatches verbs (`mountInputRuntime`, `createVerbRouter`,
     `mountKiosk`) or names the `verb/` vocabulary, i.e. a press in that file can reach the
     router. A test that only ever `publish`es straight to a bare topic and listens on it
     (a module's own on-screen button, `bus_test`) is correct and is left alone.

The fix is `bus.subscribe(bus.instanceTopic('<instance id>', '<topic>'), ...)`, with the id the
test's `modules: () => [{ id, type }]` uses.

*** A GATE, NOT A REPORT - unlike `check_absolutes.py` and `check_coupling.py`. *** Those
enumerate judgement calls, so a hard gate would misfire on legitimate cases. This one has a
precise, mechanical failure: a listener on a topic that provably is not published to. Where a
hit is genuinely right anyway (a test deliberately proving that bare-topic publishers still
reach everybody), say so where it happens, on the subscribe line or the line above:

    // bare-topic-ok: <why this test really wants every instance>

The reason is required - an empty marker does not count. Exit status is 1 if anything is
flagged, 0 if clean.

LIMITS, stated so a clean run is not read as more than it is. It reads string-literal topics
only: `bus.subscribe(someVariable, ...)` and topics assembled at runtime are invisible to it.
It checks the FILE, not the flow, so a file that mounts a router and also has one unrelated
bare subscriber to a verb topic will be flagged and need the marker. A subscribe on a
receiver assigned from `.scope(...)` is skipped (it answers on both addresses). It does not
look at non-test code; modules subscribe through `ctx.bus`, which `module.js` scopes for them.

USAGE, from the repo root:

    py -3.13 web/tools/check_bare_topic_subscribers.py
    py -3.13 web/tools/check_bare_topic_subscribers.py --self-test
"""
import re
import sys
from pathlib import Path

# Same fix run_suite.py and the other check_*.py already needed: a Windows console defaults to
# cp1252, and the em dashes in this file's own messages then kill the report.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIENT = REPO_ROOT / 'web' / 'client'
ACTIONS = CLIENT / 'actions.js'
TESTS = CLIENT / 'dev'

# `a/b` or `a/b-c`: a bus topic. Lower-case with `_`/`-` inside a segment, one slash.
TOPIC = r'[a-z][a-z0-9_]*/[a-z][a-z0-9_-]*'
QUOTED_TOPIC = re.compile(r"""['"`](""" + TOPIC + r""")['"`]""")
# Any receiver: bus.subscribe, this.bus.subscribe, scoped.subscribe, b.subscribe ...
SUBSCRIBE = re.compile(r"""(\w+)\.subscribe\(\s*(['"`])(""" + TOPIC + r""")\2""")
# `const scopedA = bus.scope('a')`: a subscribe on that receiver already answers on BOTH the bare
# and the instance-scoped topic (bus.js `scope`), which is how every real module hears a verb.
SCOPED_RECEIVER = re.compile(r"""\b(\w+)\s*=\s*[\w.]*\.scope\(""")
# A file in which a press can reach the verb router.
ROUTES_VERBS = re.compile(r'\b(mountInputRuntime|createVerbRouter|mountKiosk)\b|[\'"`]verb/')
MARKER = re.compile(r'bare-topic-ok:\s*\S')


def strip_line_comment(line):
    """Drop a trailing // comment. Topics have no `//` in them, so the cheap cut is safe."""
    at = line.find('//')
    return line if at < 0 else line[:at]


def verb_topics(actions_src):
    """Every topic a verb can be routed to, read out of the MODULE_VERBS literal itself."""
    start = actions_src.find('export const MODULE_VERBS')
    if start < 0:
        raise SystemExit('check_bare_topic_subscribers: MODULE_VERBS not found in actions.js '
                         '- the check has lost its source of truth, so it is refusing to '
                         'report a clean run.')
    end = actions_src.find('\n};', start)
    if end < 0:
        raise SystemExit('check_bare_topic_subscribers: could not find the end of MODULE_VERBS.')
    body = '\n'.join(strip_line_comment(l) for l in actions_src[start:end].splitlines())
    topics = set(QUOTED_TOPIC.findall(body))
    if len(topics) < 10:
        raise SystemExit(f'check_bare_topic_subscribers: only {len(topics)} verb topics parsed '
                         f'from MODULE_VERBS - the table has changed shape; fix the parser '
                         f'rather than trust a run against so few.')
    return topics


def scan(text, topics):
    """[(line_no, topic, line)] for each unmarked bare subscriber in a router-mounting file."""
    if not ROUTES_VERBS.search(text):
        return []
    lines = text.splitlines()
    scoped = set(SCOPED_RECEIVER.findall(text))
    hits = []
    for i, raw in enumerate(lines):
        for m in SUBSCRIBE.finditer(strip_line_comment(raw)):
            receiver, topic = m.group(1), m.group(3)
            if topic not in topics or receiver in scoped:
                continue
            near = raw + '\n' + (lines[i - 1] if i else '')
            if MARKER.search(near):
                continue
            hits.append((i + 1, topic, raw.strip()))
    return hits


def self_test(topics):
    """The check has to bite: it must flag the exact shape that broke, and pass its fixes."""
    t = next(iter(sorted(topics)))
    good = [
        ("mountInputRuntime({}); bus.subscribe(bus.instanceTopic('p1', 'photos/next'), f)", False),
        ("mountInputRuntime({}); bus.subscribe('photos/next', f)", True),
        ("mountInputRuntime({}); bus.subscribe(\"photos/next\", f)", True),
        ("mountInputRuntime({}); this.bus.subscribe(`photos/next`, f)", True),
        ("mountInputRuntime({}); // bare-topic-ok: proves bare publishers reach all\n"
         "bus.subscribe('photos/next', f)", False),
        ("mountInputRuntime({}); bus.subscribe('photos/next', f) // bare-topic-ok: every one", False),
        ("mountInputRuntime({}); bus.subscribe('photos/next', f) // bare-topic-ok:", True),
        ("mountInputRuntime({}); // bus.subscribe('photos/next', f)", False),
        ("mountInputRuntime({}); bus.subscribe('not/a-verb-topic', f)", False),
        ("bus.publish('photos/next'); bus.subscribe('photos/next', f)", False),
        ("createVerbRouter({}); bus.subscribe('segment/done', f)", True),
        ("mountInputRuntime({}); const a = bus.scope('p1'); a.subscribe('photos/next', f)", False),
        ("mountInputRuntime({}); const a = bus.scope('p1'); bus.subscribe('photos/next', f)", True),
    ]
    bad = 0
    if 'photos/next' not in topics or 'segment/done' not in topics:
        print('SELF-TEST FAIL: MODULE_VERBS no longer yields photos/next and segment/done')
        bad += 1
    for src, should_flag in good:
        got = bool(scan(src, topics))
        if got != should_flag:
            bad += 1
            print(f'SELF-TEST FAIL: expected {"flag" if should_flag else "clean"}, got '
                  f'{"flag" if got else "clean"}: {src!r}')
    print(f'self-test: {len(good) + 1 - bad} of {len(good) + 1} ok ({len(topics)} verb topics)')
    return 1 if bad else 0


def main(argv):
    topics = verb_topics(ACTIONS.read_text(encoding='utf-8'))
    if '--self-test' in argv:
        return self_test(topics)
    files = sorted(TESTS.glob('*_test.html'))
    if not files:
        print(f'check_bare_topic_subscribers: no *_test.html found under {TESTS}', file=sys.stderr)
        return 1
    total = 0
    for f in files:
        for line_no, topic, line in scan(f.read_text(encoding='utf-8'), topics):
            total += 1
            print(f'{f.relative_to(REPO_ROOT)}:{line_no}  bare subscriber on "{topic}"')
            print(f'    {line[:120]}')
            print(f'    the router publishes to bus.instanceTopic(<id>, "{topic}") now - '
                  f'subscribe there, or mark it "// bare-topic-ok: <why>"')
    print(f'\n{len(files)} test files, {len(topics)} verb topics: '
          + (f'{total} bare subscriber(s) flagged.' if total else 'clean.'))
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
