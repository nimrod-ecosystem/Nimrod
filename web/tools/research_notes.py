"""research_notes.py - the research packs as linked Markdown notes, for Obsidian, Logseq or Foam (note GN, 2026-11-24).

    py -3.13 web/tools/research_notes.py --out "D:/My notes"          # writes D:/My notes/Nimrod research/
    py -3.13 web/tools/research_notes.py --out ... --packs other/dir   # packs from somewhere else
    py -3.13 web/tools/research_notes.py --out ... --all               # flagged and disputed items too, marked

Mike, 2026-11-24: "Sounds good" (the packs stay the master copy, a linked-note view made from them). So:

A VIEW, NEVER A SECOND COPY. One note per item, one per pack, one per course a lesson item came from. Each note's front matter
carries the columns (level, content, related, true_as_of ...), so Obsidian's search, graph, backlinks and Dataview work with
nothing for us to build; `related` and `from` are real [[links]]. Every note says it was made from a pack and that edits go to
the pack: the next run rewrites the folder, and nothing here ever reads a note back.

WHERE IT WRITES, ARGUED:
  * Into a folder the person picks, inside a subfolder of its own ("Nimrod research"), so it sits in their vault beside their
    own notes without mixing with them.
  * NOT inside a git repository (it refuses): the notes are made on demand from what is, a few thousand files a commit would
    carry for nothing, and the public repo must never collect a person's vault by accident.
  * It deletes only notes IT made: a .md file in its subfolder whose second line is MADE_BY. A note the person wrote there, or
    any other file, is left alone.
Flagged and disputed items (the check found a problem) are left out unless --all, because a wrong fact in a second brain is
read as true later.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKS = HERE.parent / 'client' / 'research'
SUBFOLDER = 'Nimrod research'
MADE_BY = 'made_by: nimrod research_notes.py'
NEVER_SHOWN = ('flagged', 'disputed')
# The same reading as research_index.js LEVEL_FROM_DIFFICULTY (a fact or quote with no level of its own); the test keeps the two
# equal, so a note and a screen never disagree about a level.
LEVEL_FROM_DIFFICULTY = {'very easy': 1, 'easy': 2, 'medium': 3, 'hard': 5}
KIND_WORDS = {'fact': 'Fact', 'quote': 'Quote', 'word': 'Word'}


def safe_name(s):
    """A file name from an id: letters, digits, dot, dash and underscore; anything else a dash."""
    return re.sub(r'[^A-Za-z0-9._-]+', '-', str(s)).strip('-.') or 'item'


def yaml_value(v):
    """A front-matter value. JSON's strings and lists are valid YAML, and quoting every string keeps a colon safe."""
    return json.dumps(v, ensure_ascii=False)


def inside_git(path):
    p = Path(path).resolve()
    for d in [p, *p.parents]:
        if (d / '.git').exists():
            return d
    return None


def read_packs(folder):
    folder = Path(folder)
    idx = folder / 'index.json'
    names = []
    if idx.exists():
        try:
            names = json.loads(idx.read_text(encoding='utf-8')).get('packs', [])
        except ValueError:
            names = []
    if not names:
        names = sorted(p.name for p in folder.glob('*.json') if p.name != 'index.json')
    out = []
    for n in names:
        try:
            pack = json.loads((folder / n).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if isinstance(pack, dict) and pack.get('schema') == 'nimrod.research.v1' and isinstance(pack.get('items'), list):
            out.append((n, pack))
    return out


def title_of(it):
    if it.get('kind') == 'word':
        return re.sub(r'[\[\]|#]', '', str(it.get('word') or it.get('text') or it.get('id')))
    # A link's shown name cannot hold [ ] | or #, which end or split an Obsidian link.
    t = re.sub(r'[\[\]|#]', '', re.sub(r'\s+', ' ', str(it.get('text') or ''))).strip()
    return t if len(t) <= 70 else t[:67].rsplit(' ', 1)[0] + '...'


def course_note(course):
    return safe_name(f'course {course}')


def item_note(it, pack_name, stem_of, pack_lang):
    fm = ['---', MADE_BY, f'id: {yaml_value(it["id"])}', f'kind: {yaml_value(it.get("kind"))}',
          f'pack: {yaml_value(pack_name)}', f'status: {yaml_value(it.get("status", "unverified"))}']
    level = it.get('level')
    if level is None and it.get('kind') != 'word':
        level = LEVEL_FROM_DIFFICULTY.get(it.get('difficulty'))
    if isinstance(level, int):
        fm.append(f'level: {level}')
    for key in ('difficulty', 'topic', 'true_as_of', 'symbol', 'speaker', 'work', 'year', 'part_of_speech'):
        if it.get(key) not in (None, '', []):
            fm.append(f'{key}: {yaml_value(it[key])}')
    lang = it.get('language') or pack_lang
    if lang:
        fm.append(f'language: {yaml_value(lang)}')
    tags = [re.sub(r'\s+', '-', str(t).strip().lower()) for t in it.get('tags') or [] if str(t).strip()]
    if tags:
        fm.append(f'tags: {yaml_value(tags)}')
    for key in ('content', 'related'):
        if it.get(key):
            fm.append(f'{key}: {yaml_value(it[key])}')
    if isinstance(it.get('from'), dict) and it['from'].get('course'):
        fm.append(f'from: {yaml_value(it["from"])}')
    fm.append('---')
    body = [f'> Made from the research pack `{pack_name}` by Nimrod\'s research_notes.py. Edit the pack, not this note: '
            f'the next run rewrites it.', '', f'# {title_of(it)}', '']
    if it.get('status') in NEVER_SHOWN:
        body += [f'**The check found a problem with this one ({it["status"]}); no screen shows it.**', '']
    kind = it.get('kind')
    if kind == 'quote':
        who = ', '.join(str(x) for x in (it.get('speaker'), it.get('work'), it.get('year')) if x)
        body += [f'> {it.get("text", "")}', '', f'- {who}']
    elif kind == 'word':
        if it.get('part_of_speech'):
            body.append(f'*{it["part_of_speech"]}*')
        if it.get('definition'):
            body.append(str(it['definition']))
        if it.get('example'):
            body += ['', f'> {it["example"]}']
    else:
        body.append(str(it.get('text', '')))
        if it.get('note'):
            body += ['', str(it['note'])]
    if it.get('true_as_of'):
        body += ['', f'As of {it["true_as_of"]}.']
    rel = [stem_of[r] for r in it.get('related') or [] if r in stem_of]
    if rel:
        body += ['', '## Related', *[f'- [[{s}]]' for s in rel]]
    fr = it.get('from') if isinstance(it.get('from'), dict) else None
    if fr and fr.get('course'):
        cls = f', class {fr["class"]}' if fr.get('class') else ''
        body += ['', '## From', f'- [[{course_note(fr["course"])}]]{cls}{": " + fr["lesson"] if fr.get("lesson") else ""}']
    srcs = [s for s in it.get('sources') or [] if isinstance(s, dict) and s.get('url')]
    if srcs:
        body += ['', '## Sources']
        for s in srcs:
            extra = ', '.join(str(x) for x in (s.get('publisher'), s.get('licence')) if x)
            body.append(f'- [{s.get("title") or s["url"]}]({s["url"]}){" (" + extra + ")" if extra else ""}')
    body += ['', f'In [[{safe_name("pack " + Path(pack_name).stem)}]].', '']
    return '\n'.join(fm + body)


def list_note(title, lines):
    return '\n'.join(['---', MADE_BY, '---',
                      '> Made by Nimrod\'s research_notes.py from the research packs; the next run rewrites it.', '',
                      f'# {title}', '', *lines, ''])


def build(packs, include_all=False):
    """{file name: text} for every note. PURE (the suites call it)."""
    stem_of = {}
    chosen = []
    for name, pack in packs:
        for it in pack['items']:
            if not isinstance(it, dict) or not it.get('id') or it['id'] in stem_of:
                continue
            if it.get('status') in NEVER_SHOWN and not include_all:
                continue
            stem = safe_name(it['id'])
            while stem in stem_of.values():
                stem += '-2'
            stem_of[it['id']] = stem
            chosen.append((name, pack, it))
    notes = {}
    by_pack = {}
    by_course = {}
    for name, pack, it in chosen:
        notes[stem_of[it['id']] + '.md'] = item_note(it, name, stem_of, pack.get('language'))
        by_pack.setdefault(name, []).append(it)
        fr = it.get('from') if isinstance(it.get('from'), dict) else None
        if fr and fr.get('course'):
            by_course.setdefault(fr['course'], []).append((fr.get('class') or 0, it))
    for name, items in by_pack.items():
        pack = dict(packs)[name]
        notes[safe_name('pack ' + Path(name).stem) + '.md'] = list_note(
            f'{pack.get("name") or Path(name).stem} ({len(items)})',
            [f'- [[{stem_of[i["id"]]}|{title_of(i)}]] ({KIND_WORDS.get(i.get("kind"), "")})' for i in items])
    for course, rows in by_course.items():
        rows.sort(key=lambda r: (r[0], r[1]['id']))
        notes[course_note(course) + '.md'] = list_note(
            f'Course: {course}', [f'- class {c or "?"}: [[{stem_of[i["id"]]}|{title_of(i)}]]' for c, i in rows])
    notes['Nimrod research.md'] = list_note(
        'Nimrod research', [f'- [[{safe_name("pack " + Path(n).stem)}]]' for n in by_pack]
        + ([''] + [f'- [[{course_note(c)}]]' for c in by_course] if by_course else []))
    return notes


def made_by_us(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.readline().strip() == '---' and f.readline().strip() == MADE_BY
    except (OSError, UnicodeDecodeError):
        return False


def write(notes, out):
    """Write into out/SUBFOLDER: remove our old notes there, then write these. Returns (written, removed)."""
    target = Path(out) / SUBFOLDER
    target.mkdir(parents=True, exist_ok=True)
    removed = 0
    for p in target.glob('*.md'):
        if p.name not in notes and made_by_us(p):
            p.unlink()
            removed += 1
    for name, text in notes.items():
        p = target / name
        if p.exists() and not made_by_us(p):
            print(f'left alone (not one of ours): {p}', file=sys.stderr)
            continue
        p.write_text(text, encoding='utf-8', newline='\n')
    return len(notes), removed


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True, help='the folder to write into (a "Nimrod research" folder is made inside it)')
    ap.add_argument('--packs', default=str(PACKS), help='the research packs folder')
    ap.add_argument('--all', action='store_true', help='include flagged and disputed items, marked')
    a = ap.parse_args(argv)
    repo = inside_git(a.out)
    if repo:
        print(f'Not writing into a git repository ({repo}): pick a folder outside it, such as your notes vault.', file=sys.stderr)
        return 2
    notes = build(read_packs(a.packs), include_all=a.all)
    n, gone = write(notes, a.out)
    print(f'{n} notes in {Path(a.out) / SUBFOLDER} ({gone} old ones removed)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
