"""test_no_family_names.py - NO FAMILY MEMBER'S NAME AND NO MEDICAL-RECORDS DETAIL IN THIS PUBLIC REPO, ITS COMMITS OR
THEIR MESSAGES (chat's notes CY, CZ and DC; rows 2.133-2.134; the 2026-08-31 Tier 0 ruling).

A family member's name and age, and the folder and export names of a medical records archive, came back into tracked
files after the 2026-08-31 scrub, because that scrub was a one-time pass and nothing checked it afterwards. Mike,
2026-10-26: "We've had this issue before. This can't keep happening." This is the check, and the git hooks in
web/tools/hooks run it BEFORE anything leaves this computer.

  py -3.13 web/server/test_no_family_names.py               every tracked file, as it is on disk
  py -3.13 web/server/test_no_family_names.py --staged      what is about to be committed (pre-commit hook)
  py -3.13 web/server/test_no_family_names.py --message F   a commit message in file F (commit-msg hook)
  py -3.13 web/server/test_no_family_names.py --push A..B   the commits about to be pushed: messages and files

*** THE LIST IS NOT IN THIS FILE (Mike, 2026-10-27: keep the list itself out of the public repo). *** Two sources:
  * THIS COMPUTER: the words and their allowances, in an untracked file inside the clone's own git folder,
    `.git/info/nimrod-blocked-names` (or the file named by NIMROD_BLOCKED_NAMES). One per line:
        block: <word>          refused anywhere, any capitals, as a whole word or inside one
        allow: <regex>         a line matching this is allowed for the word on it (the trivia uses of a word)
    The hooks use it; a copy lives in the private repo.
  * EVERYWHERE ELSE (GitHub's run, a fresh clone): BLOCKED_HASHES below - each word as a one-way hash, compared word
    by word. It keeps the list from being read off the page; a person guessing common names could still match them, so
    it is a screen, not a secret. Without the allowances it skips the trivia packs (web/client/packs_review), the one
    place the same word is a film award, a playwright and a puppet.

What it does NOT do: rewrite history (Mike's yes, 2026-10-27: done separately, row 2.134).
"""
import hashlib, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SELF = 'web/server/test_no_family_names.py'
# sha256 of each blocked word, lower case, with this file's salt (NAMES_SALT). Made from the private list; a new word
# is added there and its hash here (`--hash WORD` prints it).
NAMES_SALT = 'nimrod-names-v1:'
BLOCKED_HASHES = frozenset({
    '1c83fb4b42679f6758c4a9a8467f5ce5e568ec82e50bf0adb514c456f7fbaef3',
    '099207a15c6b6f8c6568e6d2cba93ab8445e84e3342a65e5484391d276d23504',
    '3c57f5fe2a8511ef76e5be54c41310cb23acd97a012fbb28e98099e24acc99cb',
    '8667996213bbaddd40f6a35d926313e0d81848293fb04a8070d8e796e80cd6e0',
})
HASH_SKIP_PATHS = ('web/client/packs_review/',)
WORD = re.compile(r'[A-Za-z]+')


def hashed(word):
    return hashlib.sha256((NAMES_SALT + word.lower()).encode('utf-8')).hexdigest()


def git(*args):
    return subprocess.run(['git', '-C', ROOT, *args], capture_output=True, check=True).stdout


def private_list():
    """(blocked words, allow regexes) from this computer's own list, or None when there is none."""
    path = os.environ.get('NIMROD_BLOCKED_NAMES')
    if not path:
        try:
            gd = git('rev-parse', '--git-common-dir').decode().strip()
            path = os.path.join(gd if os.path.isabs(gd) else os.path.join(ROOT, gd), 'info', 'nimrod-blocked-names')
        except Exception:
            path = ''
    if not path or not os.path.exists(path):
        return None
    words, allows = [], []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if line.startswith('block:') and line[6:].strip():
                words.append(line[6:].strip())
            elif line.startswith('allow:') and line[6:].strip():
                allows.append(re.compile(line[6:].strip()))
    return words, allows


def make_finder():
    """A function line, where -> a reason or None. The private list when this computer has one, else the hashes."""
    pl = private_list()
    if pl:
        words, allows = pl
        rx = re.compile('|'.join(re.escape(w) for w in words), re.I) if words else None

        def find(line, where):
            if rx and rx.search(line) and not any(a.search(line) for a in allows):
                return 'a blocked name or medical-records word (this computer\'s list)'
            return None
        return find, 'this computer\'s private list'

    def find(line, where):
        if any(where.startswith(p) for p in HASH_SKIP_PATHS):
            return None
        for w in WORD.findall(line):
            if hashed(w) in BLOCKED_HASHES:
                return 'a blocked name or medical-records word (matched by hash)'
        return None
    return find, 'the hashed list'


def scan_text(where, text, find, hits):
    for n, line in enumerate(text.splitlines(), 1):
        why = find(line, where)
        if why:
            hits.append(f'{where}:{n}: {why}')    # the line itself is not printed: it may be the name


def text_of(raw):
    if b'\0' in raw[:4096]:
        return None
    return raw.decode('utf-8', errors='replace')


def scan_paths(paths, read, find, hits):
    for rel in paths:
        if not rel or rel.replace('\\', '/') == SELF:
            continue
        try:
            t = text_of(read(rel))
        except (OSError, subprocess.CalledProcessError):
            continue
        if t is not None:
            scan_text(rel, t, find, hits)


def from_disk(rel):
    with open(os.path.join(ROOT, rel), 'rb') as fh:
        return fh.read()


def main(argv):
    if '--hash' in argv:
        for w in argv[argv.index('--hash') + 1:]:
            print(hashed(w))
        return 0
    find, source = make_finder()
    hits = []
    mode = 'tracked files'
    if '--staged' in argv:
        mode = 'the files about to be committed'
        names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').decode('utf-8').split('\0')
        scan_paths(names, lambda rel: git('show', ':' + rel), find, hits)
    elif '--message' in argv:
        mode = 'the commit message'
        f = argv[argv.index('--message') + 1]
        with open(f, encoding='utf-8', errors='replace') as fh:
            msg = '\n'.join(l for l in fh.read().splitlines() if not l.startswith('#'))
        scan_text('commit message', msg, find, hits)
    elif '--push' in argv:
        rng = argv[argv.index('--push') + 1]
        mode = f'the commits being pushed ({rng})'
        for sha in filter(None, git('rev-list', *rng.split()).decode().split()):
            scan_text(f'message of {sha[:7]}', git('log', '-1', '--format=%B', sha).decode('utf-8', errors='replace'), find, hits)
            names = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', '-z', sha).decode('utf-8').split('\0')
            scan_paths(names, lambda rel, s=sha: git('show', f'{s}:{rel}'), find, hits)
    else:
        scan_paths(git('ls-files', '-z').decode('utf-8').split('\0'), from_disk, find, hits)

    passed = failed = 0

    def check(name, ok, detail=''):
        nonlocal passed, failed
        print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok or not detail else '\n      ' + detail))
        if ok:
            passed += 1
        else:
            failed += 1

    check(f'*** {mode}: no family name and no medical-records detail (checked against {source}) ***', not hits,
          '\n      '.join(hits[:20]) + (f'\n      ...and {len(hits) - 20} more' if len(hits) > 20 else ''))
    if mode == 'tracked files':
        here = open(os.path.abspath(__file__), encoding='utf-8').read()
        pl = private_list()
        check('this file names nobody: no word of the private list is in it',
              not pl or not any(re.search(re.escape(w), here, re.I) for w in pl[0]))
        check('the hashed list is filled (not the placeholder)', all(not h.startswith('b85a6c2cb3c3') for h in BLOCKED_HASHES)
              and len(BLOCKED_HASHES) >= 2)
        check('a word is matched by hash without capitals mattering', hashed('Example') == hashed('example'))
    print(('ALL PASS: ' if not failed else 'FAILED: ') + f'{passed} passed, {failed} failed')
    if failed:
        print('\nNothing personal goes into this public repo: not a family name, not medical detail, not in a commit '
              'message. Take it out (a stand-in name, or the design fact it stood for) and try again.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
