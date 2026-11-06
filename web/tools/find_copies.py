"""find_copies.py - copied code, found mechanically (note FD 5, the audit for things built twice; rule 30).

The first half of the audit: blocks of code that appear in two places, word for word apart from names and numbers. It reads
the site's own code (web/client, web/server, web/tools, .js and .py), never the test suites (dev/), the vendored files
(vendor/) or the lessons' content, and writes a ranked list. It changes nothing. The second half (two features doing one job
with DIFFERENT code) is for fresh reviewers, because no tool sees it.

HOW: each file is cut into tokens (comments dropped; every name becomes N, every number 0 and every string S, so a copy whose
names were changed still matches). A window of MIN_TOKENS tokens is hashed at every position; a window found in two places is
a seed, and seeds that follow each other are joined into one copied block. A block is reported when it is at least MIN_TOKENS
tokens and MIN_LINES lines in both places.

THE NUMBERS, argued (Rule 1): MIN_TOKENS 50 (jscpd's own default, the usual tool) and MIN_LINES 5 (one function's worth; three
lines of boilerplate are not "built twice"). Both are options.

  py -3.13 web/tools/find_copies.py                       (the list, longest first)
  py -3.13 web/tools/find_copies.py --min-tokens 80 --json out.json
"""
import argparse, hashlib, io, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
ROOTS = ('client', 'server', 'tools')
SKIP_DIRS = {'dev', 'vendor', 'lessons', 'node_modules', '__pycache__', '.venv', 'fonts', 'assets'}
EXTS = ('.js', '.mjs', '.py')
MIN_TOKENS = 50
MIN_LINES = 5

JS_TOKEN = re.compile(r'''
    (?P<comment>//[^\n]*|/\*.*?\*/)
  | (?P<string>`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")
  | (?P<number>\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[0-9a-f]+\b)
  | (?P<name>[A-Za-z_$][\w$]*)
  | (?P<punct>===|!==|=>|\?\?|\?\.|\.\.\.|&&|\|\||[{}()\[\];,.<>+\-*/%=!&|^~?:])
''', re.S | re.X | re.I)
PY_TOKEN = re.compile(r'''
    (?P<comment>\#[^\n]*)
  | (?P<string>(?:[rbuf]{0,2})(?:"""(?:\\.|.)*?"""|\'\'\'(?:\\.|.)*?\'\'\'|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"))
  | (?P<number>\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)
  | (?P<name>[A-Za-z_]\w*)
  | (?P<punct>==|!=|<=|>=|->|\*\*|//|[{}()\[\];,.<>+\-*/%=!&|^~:@])
''', re.S | re.X | re.I)
KEEP_NAMES = {   # words that ARE the shape of the code; every other name is N
    'function', 'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'of', 'in', 'new', 'class', 'try', 'catch', 'throw',
    'await', 'async', 'export', 'import', 'from', 'typeof', 'null', 'true', 'false', 'undefined', 'this', 'break', 'continue',
    'def', 'None', 'True', 'False', 'and', 'or', 'not', 'is', 'with', 'as', 'lambda', 'yield', 'pass', 'raise', 'except', 'elif',
}


def tokens(path):
    src = io.open(path, encoding='utf-8', errors='replace').read()
    rx = PY_TOKEN if path.endswith('.py') else JS_TOKEN
    out = []
    for m in rx.finditer(src):
        kind = m.lastgroup
        if kind == 'comment':
            continue
        text = m.group(kind)
        if kind == 'string':
            if path.endswith('.py') and text.lstrip('rbuRBUfF').startswith(('"""', "'''")) and _docstring(src, m.start()):
                continue
            tok = 'S'
        elif kind == 'number':
            tok = '0'
        elif kind == 'name':
            tok = text if text in KEEP_NAMES else 'N'
        else:
            tok = text
        out.append((tok, src.count('\n', 0, m.start()) + 1))
    return out


def _docstring(src, at):
    """A triple-quoted string that is a statement of its own (a docstring) is a comment, not code."""
    before = src[:at].rstrip(' \t')
    return before.endswith(('\n', ':')) or before == ''


def files(roots=None):
    for base in (roots or [os.path.join(WEB, r) for r in ROOTS]):
        for d, dirs, names in os.walk(base):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for n in names:
                if n.endswith(EXTS) and not n.endswith('.min.js') and not n.startswith('test_') and '_test.' not in n:
                    yield os.path.join(d, n)


def find(min_tokens=MIN_TOKENS, min_lines=MIN_LINES, roots=None):
    toks = {}
    base = os.path.dirname(WEB) if not roots else os.path.commonpath([os.path.abspath(r) for r in roots])
    for p in files(roots):
        t = tokens(p)
        if len(t) >= min_tokens:
            toks[os.path.relpath(p, base).replace('\\', '/')] = t
    seen = defaultdict(list)          # window hash -> [(file, start)]
    for f, t in toks.items():
        seq = [x[0] for x in t]
        for i in range(len(seq) - min_tokens + 1):
            h = hashlib.blake2b(' '.join(seq[i:i + min_tokens]).encode(), digest_size=8).digest()
            seen[h].append((f, i))
    # Seeds: pairs of places sharing a window (a window in many places is boilerplate: capped at 6 places).
    pairs = defaultdict(set)
    for places in seen.values():
        if len(places) < 2 or len(places) > 6:
            continue
        for a in range(len(places)):
            for b in range(a + 1, len(places)):
                (fa, ia), (fb, ib) = sorted((places[a], places[b]))
                if fa == fb and abs(ia - ib) < min_tokens:
                    continue
                pairs[(fa, fb, ib - ia if fa == fb else None)].add((ia, ib))
    blocks = []
    for (fa, fb, _), starts in pairs.items():
        run = None
        for ia, ib in sorted(starts):
            if run and ia == run[1] + 1 and ib == run[3] + 1:
                run[1], run[3] = ia, ib
            else:
                if run:
                    blocks.append((fa, fb, run))
                run = [ia, ia, ib, ib]
        if run:
            blocks.append((fa, fb, run))
    out = []
    for fa, fb, (a0, a1, b0, b1) in blocks:
        ta, tb = toks[fa], toks[fb]
        n = a1 - a0 + min_tokens
        la = (ta[a0][1], ta[min(a1 + min_tokens - 1, len(ta) - 1)][1])
        lb = (tb[b0][1], tb[min(b1 + min_tokens - 1, len(tb) - 1)][1])
        if la[1] - la[0] + 1 < min_lines or lb[1] - lb[0] + 1 < min_lines:
            continue
        if fa == fb and la[0] <= lb[1] and lb[0] <= la[1]:
            continue        # a block that overlaps itself is a repeating table, not a copy
        out.append({'tokens': n, 'a': {'file': fa, 'lines': list(la)}, 'b': {'file': fb, 'lines': list(lb)}})
        continue
        out.append({'tokens': n, 'a': {'file': fa, 'lines': list(la)}, 'b': {'file': fb, 'lines': list(lb)}})
    out.sort(key=lambda x: -x['tokens'])
    return out, len(toks)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--min-tokens', type=int, default=MIN_TOKENS)
    ap.add_argument('--min-lines', type=int, default=MIN_LINES)
    ap.add_argument('--json', default=None, help='also write the list as JSON here')
    ap.add_argument('--top', type=int, default=60)
    a = ap.parse_args()
    found, nfiles = find(a.min_tokens, a.min_lines)
    print(f'{nfiles} files read; {len(found)} copied blocks of at least {a.min_tokens} tokens and {a.min_lines} lines')
    # BY PAIR OF FILES: where to look first. A block counted once per pair at its longest, so overlapping windows of one
    # copied stretch do not inflate the total.
    pairs = defaultdict(lambda: {'blocks': 0, 'tokens': 0})
    for x in found:
        k = tuple(sorted((x['a']['file'], x['b']['file'])))
        pairs[k]['blocks'] += 1
        pairs[k]['tokens'] = max(pairs[k]['tokens'], x['tokens'])
    print(f'\n{len(pairs)} pairs of files; the {min(a.top, len(pairs))} with the longest copied block:')
    for (fa, fb), v in sorted(pairs.items(), key=lambda kv: -kv[1]['tokens'])[:a.top]:
        print(f"{v['tokens']:5d}  {fa}  ==  {fb}   ({v['blocks']} block{'s' if v['blocks'] != 1 else ''})")
    print('\nthe longest blocks:')
    for x in found[:a.top]:
        print(f"{x['tokens']:5d}  {x['a']['file']}:{x['a']['lines'][0]}-{x['a']['lines'][1]}  ==  {x['b']['file']}:{x['b']['lines'][0]}-{x['b']['lines'][1]}")
    if a.json:
        with io.open(a.json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(found, f, indent=1)


if __name__ == '__main__':
    main()
