"""test_no_family_names.py - NO CHILD'S NAME AND NO MEDICAL-RECORDS PATH IN THIS PUBLIC REPO (chat's note CY, row 2.133;
the 2026-08-31 Tier 0 ruling).

A family member's name and age, and the folder and export names of a medical records archive, had come back into
tracked files (DECISIONS.md, the teen maths lessons, test fixtures, comments) after the 2026-08-31 scrub, because that
scrub was a one-time pass and nothing checked it afterwards. CLAUDE.md: "a rule that lives only in a document and
nothing checks is a suggestion." This is the check. Run: py -3.13 web/server/test_no_family_names.py

What it does NOT do: rewrite history. Past commits still hold what was removed; that is Mike's call (note CY).
Not yet guarded: the first person's own name, which is in many more files and is being swept separately.
"""
import os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
KID = 'Os' + 'car'                       # spelled apart so this file does not match itself
FORBIDDEN = [
    ("a family member's first name", re.compile(r'\b' + KID + r'\b')),
    ('a medical records export', re.compile(r'My' + 'Chart', re.I)),
    ('a medical records folder', re.compile(r'Taylor' + '_Medical', re.I)),
]
# The same word as trivia (the film award, Oscar Wilde, Oscar the Grouch) is not the person. Allowed only on lines
# that say which one they mean.
TRIVIA = re.compile(KID + r's\b|' + KID + r' (Wilde|the Grouch|statuette|for Best|nominations)|first ' + KID
                    + r'|Best \w+(?: \w+)? ' + KID + r'|trash can|"' + KID + r'"')

passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok or not detail else '\n      ' + detail))
    if ok: passed += 1
    else: failed += 1

files = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z'], capture_output=True, check=True).stdout.decode('utf-8').split('\0')
hits = {label: [] for label, _ in FORBIDDEN}
for rel in filter(None, files):
    if rel.replace('\\', '/') == 'web/server/test_no_family_names.py':
        continue
    p = os.path.join(ROOT, rel)
    try:
        with open(p, 'rb') as fh:
            raw = fh.read()
        if b'\0' in raw[:4096]:
            continue                     # binary
        text = raw.decode('utf-8', errors='replace')
    except OSError:
        continue
    for n, line in enumerate(text.splitlines(), 1):
        for label, rx in FORBIDDEN:
            if rx.search(line) and not (label.startswith('a family') and TRIVIA.search(line)):
                hits[label].append(f'{rel}:{n}: {line.strip()[:120]}')

for label, found in hits.items():
    check(f'*** no tracked file holds {label} ***', not found, '\n      '.join(found[:20]) + (f'\n      ...and {len(found) - 20} more' if len(found) > 20 else ''))
check('the trivia uses of the same word are told apart (the film award, the playwright, the puppet)',
      all(TRIVIA.search(s) for s in [f'Which film won Best Picture at the 1995 {KID}s?', f'"{KID} Wilde"', f'{KID} the Grouch',
                                     f'Who won the Best Actor {KID} for', f'"correct": "{KID}",'])
      and not TRIVIA.search(f'Welcome back, {KID}.'))

print(('ALL PASS: ' if not failed else 'FAILED: ') + f'{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
