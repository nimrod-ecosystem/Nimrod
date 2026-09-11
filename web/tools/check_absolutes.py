#!/usr/bin/env python3
"""check_absolutes.py - REPORT ABSOLUTE-SOUNDING LANGUAGE OUTSIDE PRINCIPLES.md's RATIFIED SECTION.

*** WHY THIS EXISTS. *** `PRINCIPLES.md` §0 rule 2, in the document's own words: *"An
absolute-sounding sentence anywhere else is a draft opinion, not a rule... This is checkable:
search a document for those words and every hit is either already in §2, or it is a draft that
needs softening or promoting."* `docs/for_chat/MIKE_CHANGE_LIST.md`'s "rules you cannot enforce
become suggestions" finding names this as check #6 of nine: deterministic, no model needed.

*** WHY THIS IS A REPORT, NOT A PASS/FAIL GATE. *** The document is heavily self-referential -
§0 itself discusses "never, always, must, ever" AS WORDS, and §2's surrounding discussion is
full of CANDIDATE absolutes still awaiting a ruling ("the three strongest candidates..."), not
yet-promoted drafts. A hard gate here would either misfire constantly on the document's own
meta-language or need a maintained exception list that itself rots. What is genuinely
deterministic and useful is enumerating every hit with its section and line, so a session
reviewing the file (the "every 3-6 months" cadence the same finding names for slow-moving
checks) has the actual list in front of it instead of having to re-skim four hundred lines.

USAGE, from the repo root:

    py -3.13 web/tools/check_absolutes.py
    py -3.13 web/tools/check_absolutes.py --outside-only    # skip §0 and §2 (expected noise)

Exit status is always 0 - this is a report, never a build-breaker. Pipe it somewhere and read it.
"""
import re
import sys
from pathlib import Path

# Same fix run_suite.py already needed: a Windows console defaults to cp1252, and this file's
# own em dashes and section markers (§) then kill the report with a UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
TARGET = REPO_ROOT / 'PRINCIPLES.md'

# Matches PRINCIPLES.md §0 rule 2's own list, as words - not substrings, so "however" or
# "nevertheless" don't false-positive on "ever".
WORDS = re.compile(r'\b(never|always|must not|must|no exceptions|ever)\b', re.I)

SECTION_RE = re.compile(r'^##\s+(§\d+)\s+—\s+(.+)$')


def sections(lines):
    """[(line_no, section_id, section_title)] for every §N heading, in file order."""
    out = []
    for i, line in enumerate(lines, start=1):
        m = SECTION_RE.match(line.rstrip())
        if m:
            out.append((i, m.group(1), m.group(2)))
    return out


def section_for(line_no, secs):
    """Which §N a given line falls under - the last heading at or before it."""
    cur = None
    for start, sid, title in secs:
        if start > line_no:
            break
        cur = (sid, title)
    return cur or (None, None)


def main(argv):
    outside_only = '--outside-only' in argv
    if not TARGET.exists():
        print(f'not found: {TARGET}', file=sys.stderr)
        return 0
    text = TARGET.read_text(encoding='utf-8')
    lines = text.splitlines()
    secs = sections(lines)

    hits = []
    for i, line in enumerate(lines, start=1):
        for m in WORDS.finditer(line):
            sid, title = section_for(i, secs)
            hits.append({'line': i, 'word': m.group(0), 'section': sid, 'title': title,
                         'text': line.strip()})

    if outside_only:
        hits = [h for h in hits if h['section'] not in ('§0', '§2')]

    by_section = {}
    for h in hits:
        by_section.setdefault(h['section'], []).append(h)

    print(f'{TARGET.relative_to(REPO_ROOT)} — {len(hits)} absolute-sounding word(s) found'
          + (' (outside §0/§2 only)' if outside_only else ' (every section)'))
    print(f'§0 rule 2: only a §2 row with Mike\'s sign-off is a real rule. Everything else here '
          f'is a draft — expected, not necessarily a defect.\n')
    for sid in sorted(by_section, key=lambda s: (s is None, s)):
        rows = by_section[sid]
        title = rows[0]['title'] or '(before any §heading)'
        print(f'{sid or "—"}  {title}  ({len(rows)} hit{"s" if len(rows) != 1 else ""})')
        for h in rows:
            print(f'    L{h["line"]:<5} "{h["word"]}"  {h["text"][:110]}')
        print()

    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
