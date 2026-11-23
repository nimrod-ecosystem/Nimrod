"""word_builder_lists.py - the word builder's two longer-word lists, from SCOWL and 12dicts (2026-11-22, row 2.279).

    py -3.13 web/tools/word_builder_lists.py --scowl <scowl-2020.12.07 folder> --dicts <12dicts-6.0.2 folder>
        [--review <file.tsv>]   also write the 6-8 letter candidates for a person to read (never into the repository)
        [--check]               only check that web/client/word_builder_accept.js is what these sources make

Mike, 2026-11-22: "Go for the download, 8 letters, two lists". The two lists:

  THE ACCEPT LIST (written here, to web/client/word_builder_accept.js). Every lowercase a-z word of 3 to 8 letters in
  SCOWL's english-words and american-words lists at size 50 or below, minus slurs (web/client/word_filter.js). It is
  never ASKED for: a set only counts a word from it as a bonus word, so a real word somebody makes is not called "not
  on this list". Nobody reads it word by word, so the games hold back the other kinds in word_filter.js by the screen's
  setting before a bonus word is said aloud (Mike, 2026-11-23: medical words are ordinary words; slurs always out).

  THE CANDIDATES (--review, a TSV for a person). Words of 6 to 8 letters that are in 12dicts' 3esl (a list of the words
  a learner of English meets) AND its 2of12 (headwords in at least 2 of 12 dictionaries) AND SCOWL at size 20 or below,
  tiered by SCOWL size (10 -> 1, 20 -> 2), with plain "s" plurals left out, as in word_builder_words.js, and the
  commonest marked "suggested". Nothing from it is asked for until a
  person has read it and the kept words are written into word_builder_words.js by hand. A wordfreq Zipf number is added
  when that package is installed, only as a reading aid in the TSV: wordfreq's data is CC BY-SA, so no number from it
  goes into the repository (row 2.249).

LICENCES (checked 2026-11-22 on the sources' own pages). SCOWL: MIT-like, the notice must go with every copy (its
whole Copyright file is copied into the generated file). Sizes above 80 are avoided (UKACD's terms); this uses 50 and below, and none of
SCOWL's frequency data. 12dicts: public domain with acknowledgement asked; only 3esl and 2of12 are read (2of12inf and
the 2+2+3 lists depend on AGID and are not used). Neither 12dicts list is copied into the repository: they only choose
which words a person is shown.
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'client', 'word_builder_accept.js')

ACCEPT_SIZES = (10, 20, 35, 40, 50)
CANDIDATE_SIZES = {10: 1, 20: 2, 35: 3}
LONGEST = 8          # Mike, 2026-11-22: "8 letters"
REVIEW_TIERS = 2     # the review sheet holds tiers 1 and 2 (size 10 and 20); tier 3 can come later, from the same tool
# ARGUED, a reading aid only: wordfreq's Zipf 4.5 is about 30 uses per million words. Measured 2026-11-22 on these
# candidates (2,654 headwords, tiers 1-2), it suggests 717 once -ed/-ing forms are left out: a sheet a person can read in
# a sitting or two. 4.0 marked about 1,800 (too many to read well); 5.0 leaves out everyday words such as "kitchen"
# (4.65). Everyday words below it (pillow 3.96, umbrella 3.89) stay on the sheet for the reader to mark.
SUGGEST_ZIPF = 4.5

FILTER_JS = os.path.join(HERE, '..', 'client', 'word_filter.js')


def filter_lists(path=FILTER_JS):
    """kind -> (exact words, prefixes), read from web/client/word_filter.js: ONE list, the games' own (Mike,
    2026-11-23: "block any racial slurs and the like", and the rest by a screen setting). The accept list leaves out
    only slurs; the screen's setting holds back the other kinds while playing."""
    with open(path, encoding='utf-8') as f:
        src = f.read()
    block = src[src.index('const LISTS = {'):]
    block = block[:block.index('};')]
    out = {}
    for kind, text in re.findall(r'(\w+): `([^`]*)`', block):
        words = text.split()
        out[kind] = ({w for w in words if not w.endswith('*')}, [w[:-1] for w in words if w.endswith('*')])
    if 'slur' not in out:
        sys.exit('no slur list in %s' % path)
    return out


LISTS = filter_lists()


def kind_of(w):
    """The word's kind in word_filter.js ('slur', 'swear', 'sexual', 'adult'), or None: the JS kindOf, in Python."""
    for kind, (exact, starts) in LISTS.items():
        if w in exact or any(w.startswith(s) for s in starts):
            return kind
    return None


def is_slur(w):
    return kind_of(w) == 'slur'


def read_scowl(folder, sizes):
    """word -> the smallest SCOWL size it is listed at, over english-words and american-words."""
    final = os.path.join(folder, 'final')
    out = {}
    for size in sizes:
        for part in ('english-words', 'american-words'):
            p = os.path.join(final, '%s.%d' % (part, size))
            if not os.path.exists(p):
                sys.exit('missing %s: --scowl must be the scowl-2020.12.07 folder (the one holding final/)' % p)
            with open(p, encoding='latin-1') as f:
                for line in f:
                    w = line.strip()
                    if re.fullmatch('[a-z]+', w) and w not in out:
                        out[w] = size
    return out


def read_2of12(folder):
    """12dicts' 2of12: words in at least 2 of 12 dictionaries, headwords (public domain; not 2of12inf, which is AGID's)."""
    p = os.path.join(folder, 'American', '2of12.txt')
    if not os.path.exists(p):
        sys.exit('missing %s' % p)
    with open(p, encoding='latin-1') as f:
        return {w for w in (line.strip() for line in f) if re.fullmatch('[a-z]+', w)}


def read_3esl(folder):
    p = os.path.join(folder, 'American', '3esl.txt')
    if not os.path.exists(p):
        sys.exit('missing %s: --dicts must be the unpacked 12dicts folder (the one holding American/)' % p)
    with open(p, encoding='latin-1') as f:
        return {w for w in (line.strip() for line in f) if re.fullmatch('[a-z]+', w)}


def notice(folder):
    """SCOWL's whole Copyright file, word for word, as comment lines: its terms ask for the notice in every copy, and
    the file also names the terms of each of its own sources, so all of it goes, not a retyped part."""
    p = os.path.join(folder, 'Copyright')
    if not os.path.exists(p):
        sys.exit('missing %s: the notice has to travel with the list' % p)
    with open(p, encoding='latin-1') as f:
        text = f.read().replace('\r', '').rstrip('\n')     # comment lines, outside the template string: verbatim
    version = ''
    vp = os.path.join(folder, 'VERSION')
    if os.path.exists(vp):
        with open(vp, encoding='latin-1') as f:
            version = ' ' + f.read().strip()
    head = ('// SOURCE AND LICENCE. Made from SCOWL%s (Spell Checker Oriented Word Lists), english-words and american-words\n'
            '// at size 50 and below, by web/tools/word_builder_lists.py. Do not edit by hand: run the tool. Filtered:\n'
            '// lowercase a to z only, 3 to 8 letters, slurs kept out (word_filter.js). The other kinds there (swearing,\n'
            '// sexual words, drugs and violence) stay in, and a screen\'s "Words the games may use" holds them back while\n'
            '// playing. SCOWL\'s Copyright file follows, whole, as its terms ask.\n//\n' % version)
    return head + '\n'.join(('//   ' + line).rstrip() for line in text.split('\n')) + '\n'


def accept_js(words, notice_text):
    lines = []
    row = ''
    for w in words:
        if len(row) + len(w) + 1 > 118:
            lines.append(row)
            row = ''
        row = (row + ' ' + w) if row else w
    if row:
        lines.append(row)
    body = '\n'.join(lines)
    return ('// word_builder_accept.js - THE ACCEPT LIST for the word builder (row 2.279). Data, no DOM. Generated.\n//\n'
            '// A word on this list and not on word_builder_words.js is never ASKED for: when the letters make it, it\n'
            '// counts as a bonus word (Mike, 2026-11-22: "two lists"), so a real word is not called "not on this list".\n'
            '//\n' + notice_text +
            '\nconst TEXT = `\n' + body + '\n`;\n\n'
            '/** Every accepted word, sorted. */\n'
            'export const ACCEPT = Object.freeze(TEXT.split(/\\s+/).filter(Boolean));\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scowl', required=True)
    ap.add_argument('--dicts')
    ap.add_argument('--review')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()

    scowl = read_scowl(a.scowl, ACCEPT_SIZES)
    accept = sorted(w for w, s in scowl.items() if 3 <= len(w) <= LONGEST and not is_slur(w))
    js = accept_js(accept, notice(a.scowl))
    if a.check:
        with open(OUT, encoding='utf-8') as f:
            same = f.read() == js
        print('word_builder_accept.js is %s' % ('up to date' if same else 'NOT what the sources make: run the tool'))
        sys.exit(0 if same else 1)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print('accept list: %d words, %d bytes -> %s' % (len(accept), len(js.encode()), os.path.normpath(OUT)))

    if a.review:
        if not a.dicts:
            sys.exit('--review needs --dicts')
        esl = read_3esl(a.dicts)
        heads = read_2of12(a.dicts)
        # Measured 2026-11-22: 3esl and SCOWL 35 alone gave 7,048, too many for a person to read. Headwords (2of12) at the
        # two commonest tiers give about 2,650, and "suggested" marks the commonest of those (below).
        cands = {w: CANDIDATE_SIZES[s] for w, s in scowl.items()
                 if s in CANDIDATE_SIZES and CANDIDATE_SIZES[s] <= REVIEW_TIERS and 6 <= len(w) <= LONGEST
                 and w in esl and w in heads and kind_of(w) is None}
        # plain "s" plurals of another candidate, or of a word the list already has, are left out (the file's rule)
        plural = {w for w in cands if w.endswith('s') and (w[:-1] in cands or w[:-1] in esl)}
        try:
            from wordfreq import zipf_frequency
        except ImportError:
            zipf_frequency = None
        rows = []
        zf = (lambda x: zipf_frequency(x, 'en')) if zipf_frequency else (lambda x: 0.0)
        for w in sorted(cands, key=lambda x: (cands[x], -zf(x), x)):
            if w in plural:
                continue
            z = '%.2f' % zf(w) if zipf_frequency else ''
            flags = []
            if w.endswith('ing') or w.endswith('ed'):
                flags.append('inflected?')
            # SUGGESTED: commonest in real use (a reading aid, the person decides) and not an -ed/-ing form, which would
            # crowd a set with "jump, jumped, jumping". Unknown without wordfreq: nothing is suggested.
            sug = 'y' if zipf_frequency and zf(w) >= SUGGEST_ZIPF and not flags else ''
            rows.append('\t'.join([w, str(len(w)), str(cands[w]), z, ','.join(flags), sug, '']))
        with open(a.review, 'w', encoding='utf-8', newline='\n') as f:
            f.write('word\tletters\ttier\tzipf (wordfreq, reading aid only)\tflags\tsuggested\tkeep? (y / n / tier)\n')
            f.write('\n'.join(rows) + '\n')
        by_tier = {t: sum(1 for r in rows if r.split('\t')[2] == str(t)) for t in (1, 2, 3)}
        by_len = {n: sum(1 for r in rows if r.split('\t')[1] == str(n)) for n in (6, 7, 8)}
        n_sug = sum(1 for r in rows if r.split('\t')[5] == 'y')
        print('candidates: %d (by tier %s, by letters %s, %d plurals left out, %d suggested) -> %s'
              % (len(rows), by_tier, by_len, len(plural), n_sug, a.review))


if __name__ == '__main__':
    main()
