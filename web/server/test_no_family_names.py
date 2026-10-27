"""test_no_family_names.py - NO FAMILY MEMBER'S NAME AND NO MEDICAL-RECORDS DETAIL IN THIS PUBLIC REPO, ITS COMMITS OR
THEIR MESSAGES (chat's notes CY and CZ, rows 2.133-2.134; the 2026-08-31 Tier 0 ruling).

A family member's name and age, and the folder and export names of a medical records archive, came back into tracked
files after the 2026-08-31 scrub, because that scrub was a one-time pass and nothing checked it afterwards. Mike,
2026-10-26: "We've had this issue before. This can't keep happening." CLAUDE.md: "a rule that lives only in a document
and nothing checks is a suggestion." This is the check, and the git hooks in web/tools/hooks run it BEFORE anything
leaves this computer - a check that runs after a push is a check that runs once it is already public.

  py -3.13 web/server/test_no_family_names.py               every tracked file, as it is on disk
  py -3.13 web/server/test_no_family_names.py --staged      what is about to be committed (pre-commit hook)
  py -3.13 web/server/test_no_family_names.py --message F   a commit message in file F (commit-msg hook)
  py -3.13 web/server/test_no_family_names.py --push A..B   the commits about to be pushed: messages and files

No exceptions for a first name: a guard that refuses a name spells it so it does not contain it (chri[s]tine in a
regex matches exactly the same text; 'Chris' + 'tine' in code). The one word allowed through is the same word as
trivia - the film award, the playwright, the puppet - on a line that says which one it means.

What it does NOT do: rewrite history (Mike's call, row 2.134).
"""
import os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SELF = 'web/server/test_no_family_names.py'
KID = 'Os' + 'car'                       # spelled apart so this file does not match itself
FIRST = 'Chris' + 'tine'
FORBIDDEN = [
    ("a family member's first name", re.compile(r'\b' + KID + r'\b')),
    ("the first person's name", re.compile(FIRST, re.I)),
    ('a medical records export', re.compile(r'My' + 'Chart', re.I)),
    ('a medical records folder', re.compile(FIRST + '_Medical', re.I)),
]
TRIVIA = re.compile(KID + r's\b|' + KID + r' (Wilde|the Grouch|statuette|for Best|nominations)|first ' + KID
                    + r'|Best \w+(?: \w+)? ' + KID + r'|trash can|"' + KID + r'"')


def allowed(label, line):
    return label.startswith('a family') and bool(TRIVIA.search(line))


def scan_text(where, text, hits):
    for n, line in enumerate(text.splitlines(), 1):
        for label, rx in FORBIDDEN:
            if rx.search(line) and not allowed(label, line):
                hits[label].append(f'{where}:{n}: {line.strip()[:120]}')


def git(*args):
    return subprocess.run(['git', '-C', ROOT, *args], capture_output=True, check=True).stdout


def text_of(raw):
    if b'\0' in raw[:4096]:
        return None                      # binary
    return raw.decode('utf-8', errors='replace')


def scan_paths(paths, read, hits):
    for rel in paths:
        if not rel or rel.replace('\\', '/') == SELF:
            continue
        try:
            t = text_of(read(rel))
        except (OSError, subprocess.CalledProcessError):
            continue
        if t is not None:
            scan_text(rel, t, hits)


def from_disk(rel):
    with open(os.path.join(ROOT, rel), 'rb') as fh:
        return fh.read()


def main(argv):
    hits = {label: [] for label, _ in FORBIDDEN}
    mode = 'tracked files'
    if '--staged' in argv:
        mode = 'the files about to be committed'
        names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').decode('utf-8').split('\0')
        scan_paths(names, lambda rel: git('show', ':' + rel), hits)
    elif '--message' in argv:
        mode = 'the commit message'
        f = argv[argv.index('--message') + 1]
        with open(f, encoding='utf-8', errors='replace') as fh:
            msg = '\n'.join(l for l in fh.read().splitlines() if not l.startswith('#'))
        scan_text('commit message', msg, hits)
    elif '--push' in argv:
        rng = argv[argv.index('--push') + 1]
        mode = f'the commits being pushed ({rng})'
        for sha in filter(None, git('rev-list', *rng.split()).decode().split()):
            scan_text(f'message of {sha[:7]}', git('log', '-1', '--format=%B', sha).decode('utf-8', errors='replace'), hits)
            names = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', '-z', sha).decode('utf-8').split('\0')
            scan_paths(names, lambda rel, s=sha: git('show', f'{s}:{rel}'), hits)
    else:
        scan_paths(git('ls-files', '-z').decode('utf-8').split('\0'), from_disk, hits)

    passed = failed = 0

    def check(name, ok, detail=''):
        nonlocal passed, failed
        print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok or not detail else '\n      ' + detail))
        if ok:
            passed += 1
        else:
            failed += 1

    for label, found in hits.items():
        check(f'*** {mode}: nothing that is {label} ***', not found,
              '\n      '.join(found[:20]) + (f'\n      ...and {len(found) - 20} more' if len(found) > 20 else ''))
    if mode == 'tracked files':
        check('the trivia uses of the same word are told apart (the film award, the playwright, the puppet)',
              all(TRIVIA.search(s) for s in [f'Which film won Best Picture at the 1995 {KID}s?', f'"{KID} Wilde"', f'{KID} the Grouch',
                                             f'Who won the Best Actor {KID} for', f'"correct": "{KID}",'])
              and not TRIVIA.search(f'Welcome back, {KID}.'))
        check('a guard spelled chri[s]tine still matches the name, and is not the name',
              re.search('chri[s]tine', FIRST, re.I) is not None and not re.search(FIRST, 'chri[s]tine', re.I))
    print(('ALL PASS: ' if not failed else 'FAILED: ') + f'{passed} passed, {failed} failed')
    if failed:
        print('\nNothing personal goes into this public repo: not a family name, not medical detail, not in a commit '
              'message. Take it out (a stand-in name, or the design fact it stood for) and try again.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
