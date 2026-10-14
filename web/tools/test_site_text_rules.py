#!/usr/bin/env python3
"""test_site_text_rules.py - placement rules for site text that Mike has ruled, checked rather than written down.

*** THE "NOT A NURSE CALL" LINE (Mike, 2026-10-13, DECISIONS.md "Mike's site-text answers"). *** One sentence,
"Nimrod is not a nurse call or an emergency system.", in exactly three places: the Call page (call_page.js), the
AAC board's settings on the talk page (talk.js) and the "What Nimrod is" page (landing.html). Mike: "This isn't meant
to be nursing home software ... I feel like this is really being overemphasized." So the check is both ways: the line
is in each of the three, once, word for word, and no other page or script of the site says "nurse call" at all.

This is NOT a banned-word list (those were retired the same day): it checks where one ruled sentence sits.

Comments are not copy: `//` and `/* */` comments in JS and `<!-- -->` in HTML are ignored. web/client/dev/ (test
pages), vendor/ and learn/ are skipped.

Run, from web/:
    py -3.13 tools/test_site_text_rules.py
"""
import re
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

CLIENT = Path(__file__).resolve().parents[1] / 'client'
SKIP = {'dev', 'vendor', 'node_modules', 'learn'}
LINE = 'Nimrod is not a nurse call or an emergency system.'
PLACES = ('call_page.js', 'talk.js', 'landing.html')

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


def without_comments(path, src):
    if path.suffix == '.html':
        src = re.sub(r'<!--.*?-->', ' ', src, flags=re.S)
    # JS comments (also inside an HTML page's scripts): a line comment only where it cannot be part of a URL.
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    return re.sub(r'(^|[\s;{}(),])//[^\n]*', r'\1', src)


texts = {}
for p in sorted(CLIENT.rglob('*')):
    if p.suffix not in ('.js', '.html') or not p.is_file():
        continue
    if any(part in SKIP for part in p.relative_to(CLIENT).parts):
        continue
    texts[p.relative_to(CLIENT).as_posix()] = without_comments(p, p.read_text(encoding='utf-8', errors='replace'))

for place in PLACES:
    n = texts.get(place, '').count(LINE)
    check(f'"{LINE}" is in {place}, once', n == 1, f'found {n} times')
others = sorted(rel for rel, s in texts.items() if rel not in PLACES and re.search(r'nurse[\s-]+call', s, re.I))
check('no other page or script says "nurse call"', not others, ', '.join(others))
short = sorted(rel for rel in PLACES if re.search(r"isn['’]t a nurse call", texts.get(rel, ''), re.I))
check('the short form ("isn\'t a nurse call ...") is gone from the three places too', not short, ', '.join(short))

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
