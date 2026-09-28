#!/usr/bin/env python3
"""check_site_copy.py - REPORT VISIBLE TEXT THAT REFERS TO ONE PARTICULAR PERSON.

*** WHY THIS EXISTS. *** Mike, 2026-09-11 (CLAUDE.md, porting rules): "Site copy never says 'her
screen' or refers to the person the project was first built for -- a visitor has no idea what that
means. Internal docs may; the site may not." Twice on 2026-09-28 a manual search for this missed
strings a visitor could read ("Pick up where she left off" in the restart menu, "Nothing she is
bound to..." on the controls page), because a grep over two files is not a check. The project's own
rule for that situation: "the question is 'what test proves it,' not 'where do we record it.'"

WHAT IT LOOKS AT: text a person could plausibly SEE --
  * string literals in `web/client/**/*.js` (single, double and template quotes), with `//` and
    `/* */` comments stripped first, so the file's many comments about her are not reported;
  * text and `title=`/`aria-label=`/`placeholder=`/`alt=` attributes in `web/client/**/*.html`.
`web/client/dev/` (test pages) and `vendor/` are skipped: nobody meets those as the product.

WHAT IT LOOKS FOR: she / her / hers / herself, and the names the project was built around. The
names list is `NAMES` below; add to it rather than to the pronoun list.

*** A REPORT, NOT A GATE, same as its siblings (check_absolutes.py, check_hardcoded_colors.py,
check_coupling.py). *** A string literal is not always visible (a log message, a telemetry key, an
error that never reaches a screen), and "her" can be legitimate in copy about a real named example.
Telling those apart needs a person reading each hit in context; what is automatable is making sure
none is missed. Exit status is always 0.

USAGE, from the repo root:
    py -3.13 web/tools/check_site_copy.py
    py -3.13 web/tools/check_site_copy.py --summary
"""
import re
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIENT = REPO_ROOT / 'web' / 'client'
SKIP_DIRS = {'dev', 'vendor', 'node_modules'}

NAMES = ['Christine', 'Cici']
WORDS = re.compile(r'\b(she|her|hers|herself|' + '|'.join(NAMES) + r')\b', re.I)

# JS: strip comments while leaving strings intact, then pull out string literals. A small scanner
# rather than a regex, because a `//` inside a URL string must not be read as a comment, a quote
# inside a regex literal (`/'/g`) must not open a string, and a template literal's `${ ... }`
# holds CODE -- its comments and quotes belong to the code scanner, not to the template's text.
REGEX_BEFORE = set('(,=:[!&|?{};+-*%<>~^')

def js_strings(src):
    out = []
    n = len(src)
    line = [1]

    def scan_code(i, stop_at_brace=False):
        depth = 0
        prev = ''
        while i < n:
            c = src[i]
            if c == '\n':
                line[0] += 1; i += 1; continue
            if c in ' \t\r':
                i += 1; continue
            if src.startswith('//', i):
                j = src.find('\n', i); i = n if j < 0 else j; continue
            if src.startswith('/*', i):
                j = src.find('*/', i + 2); j = n if j < 0 else j + 2
                line[0] += src.count('\n', i, j); i = j; prev = ' '; continue
            if c == '/' and (prev == '' or prev in REGEX_BEFORE):
                i = skip_regex(i); prev = 'r'; continue
            if c in '\'"':
                i = read_string(i, c); prev = 's'; continue
            if c == '`':
                i = read_template(i); prev = 's'; continue
            if stop_at_brace:
                if c == '{':
                    depth += 1
                elif c == '}':
                    if depth == 0:
                        return i + 1
                    depth -= 1
            prev = c
            i += 1
        return i

    def skip_regex(i):
        i += 1
        in_class = False
        while i < n and src[i] != '\n':
            c = src[i]
            if c == '\\':
                i += 2; continue
            if c == '[':
                in_class = True
            elif c == ']':
                in_class = False
            elif c == '/' and not in_class:
                i += 1
                while i < n and src[i].isalpha():
                    i += 1
                return i
            i += 1
        return i

    def read_string(i, q):
        start, start_line = i + 1, line[0]
        i += 1
        while i < n and src[i] != q and src[i] != '\n':
            if src[i] == '\\':
                i += 2; continue
            i += 1
        out.append((start_line, src[start:i]))
        return i + 1

    def read_template(i):
        i += 1
        start_line, parts, seg = line[0], [], i
        while i < n and src[i] != '`':
            if src[i] == '\\':
                i += 2; continue
            if src[i] == '\n':
                line[0] += 1
            if src.startswith('${', i):
                parts.append(src[seg:i])
                i = scan_code(i + 2, stop_at_brace=True)
                seg = i
                continue
            i += 1
        parts.append(src[seg:i])
        out.append((start_line, ' '.join(parts)))
        return i + 1

    scan_code(0)
    return out

HTML_COMMENT = re.compile(r'<!--.*?-->', re.S)
HTML_SCRIPT = re.compile(r'<(script|style)\b.*?</\1>', re.S | re.I)
HTML_ATTR = re.compile(r'\b(?:title|aria-label|placeholder|alt)\s*=\s*"([^"]*)"', re.I)
HTML_TEXT = re.compile(r'>([^<]+)<')

def html_texts(src):
    # Scripts are handled as JS (their string literals); comments and styles are not visible.
    out = []
    for m in HTML_SCRIPT.finditer(src):
        if m.group(1).lower() == 'script':
            base = src.count('\n', 0, m.start())
            out += [(base + ln, s) for ln, s in js_strings(m.group(0))]
    stripped = HTML_SCRIPT.sub(lambda m: '\n' * m.group(0).count('\n'), src)
    stripped = HTML_COMMENT.sub(lambda m: '\n' * m.group(0).count('\n'), stripped)
    for rx in (HTML_ATTR, HTML_TEXT):
        for m in rx.finditer(stripped):
            out.append((stripped.count('\n', 0, m.start()) + 1, m.group(1)))
    return out

def files():
    for p in sorted(CLIENT.rglob('*')):
        if p.suffix not in ('.js', '.html') or not p.is_file():
            continue
        if any(part in SKIP_DIRS for part in p.relative_to(CLIENT).parts):
            continue
        yield p

def main(argv):
    summary = '--summary' in argv
    hits = []
    for p in files():
        src = p.read_text(encoding='utf-8', errors='replace')
        texts = js_strings(src) if p.suffix == '.js' else html_texts(src)
        for line, s in texts:
            s = HTML_COMMENT.sub(' ', s)      # markup built in JS carries <!-- notes --> nobody sees
            for m in WORDS.finditer(s):
                hits.append((p.relative_to(REPO_ROOT), line, m.group(0), ' '.join(s.split())[:110]))
    by_file = {}
    for h in hits:
        by_file.setdefault(h[0], []).append(h)
    print(f'check_site_copy.py -- {len(hits)} possible reference(s) to one particular person in text '
          f'a visitor could see, across {len(by_file)} file(s). Report only; exit code is always 0.')
    print('Mike, 2026-09-11: site copy never refers to the person the project was first built for.\n')
    for f, rows in by_file.items():
        print(f'{f}  ({len(rows)})')
        if not summary:
            for _, line, word, text in rows:
                print(f'    L{line:<5} "{word}"  {text}')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
