"""test_research_tools.py - research_check.py and research_notes.py (note GN, 2026-11-24).

    py -3.13 -m unittest web/tools/test_research_tools.py

The checker: the schema file uses only keywords it applies (so a rule cannot be skipped silently); every pack on the site
passes; each new column is caught when wrong. The notes: one per item with the columns in front matter, links for related
and from, flagged items left out, never written inside a git repository, and only its own notes ever removed.
"""
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import research_check as C  # noqa: E402
import research_notes as N  # noqa: E402

GOOD = {'schema': 'nimrod.research.v1', 'kind': 'fact', 'name': 'test', 'items': [
    {'id': 'f1', 'kind': 'fact', 'text': 'Mount Everest is 8,849 m tall.', 'status': 'verified', 'difficulty': 'easy',
     'tags': ['mountains', 'big things'], 'level': 2, 'related': ['w1'], 'true_as_of': '2020-12',
     'sources': [{'url': 'https://example.org/everest', 'title': 'Everest', 'publisher': 'Example'}]},
    {'id': 'w1', 'kind': 'word', 'text': 'summit', 'word': 'summit', 'level': 3, 'definition': 'the top of a mountain',
     'status': 'unverified', 'from': {'course': 'mountains-101', 'class': 2, 'lesson': 'Up high'}},
    {'id': 'q1', 'kind': 'quote', 'text': 'Because it is there.', 'speaker': 'George Mallory', 'status': 'verified'},
    {'id': 'f2', 'kind': 'fact', 'text': 'A wrong fact.', 'status': 'flagged', 'content': ['adult']},
]}


def write_pack(folder, name, pack):
    p = Path(folder) / name
    p.write_text(json.dumps(pack), encoding='utf-8')
    return p


class Check(unittest.TestCase):
    def test_schema_uses_only_what_the_checker_applies(self):
        self.assertEqual(C.unknown_keywords(C.load_schema()), [])

    def test_every_site_pack_passes(self):
        files = sorted(p for p in C.PACKS.glob('*.json') if p.name != 'index.json')
        self.assertTrue(files)
        bad = {k: v['errors'][:3] for k, v in C.check_packs(files).items() if v['errors']}
        self.assertEqual(bad, {})

    def test_a_good_pack_passes(self):
        with tempfile.TemporaryDirectory() as d:
            r = C.check_packs([write_pack(d, 'a.json', GOOD)])['a.json']
        self.assertEqual(r['errors'], [])

    def test_each_new_column_is_caught_when_wrong(self):
        bad = json.loads(json.dumps(GOOD))
        bad['items'][0].update({'level': 7, 'content': ['rude'], 'related': 'w1', 'true_as_of': '2020-13', 'language': 'English'})
        with tempfile.TemporaryDirectory() as d:
            errs = ' | '.join(C.check_packs([write_pack(d, 'a.json', bad)])['a.json']['errors'])
        for what in ('f1.level: above 6', "f1.content[0]: 'rude'", 'f1.related: should be array',
                     "f1.true_as_of: '2020-13'", "f1.language: 'English'"):
            self.assertIn(what, errs)

    def test_across_packs_and_quotes(self):
        other = {'schema': 'nimrod.research.v1', 'items': [
            {'id': 'f1', 'kind': 'fact', 'text': 'again'}, {'id': 'q9', 'kind': 'quote', 'text': 'hi', 'speaker': ' '},
            {'id': 'x', 'kind': 'fact', 'text': 't', 'related': ['nowhere']}]}
        with tempfile.TemporaryDirectory() as d:
            r = C.check_packs([write_pack(d, 'a.json', GOOD), write_pack(d, 'b.json', other)])
        errs = ' | '.join(r['b.json']['errors'])
        self.assertIn('f1: also in a.json', errs)
        self.assertIn('q9: a quote with nobody who said it', errs)
        self.assertTrue(any('nowhere' in n for n in r['b.json']['notes']))

    def test_the_schema_names_the_columns_chat_fills(self):
        props = C.load_schema()['$defs']['item']['properties']
        for col in ('level', 'content', 'related', 'true_as_of', 'symbol', 'language', 'from'):
            self.assertIn(col, props)
        self.assertEqual(props['content']['items']['enum'], ['slur', 'swear', 'sexual', 'adult'])


class Notes(unittest.TestCase):
    def test_one_note_per_item_with_columns_and_links(self):
        notes = N.build([('facts__test.json', GOOD)])
        self.assertIn('f1.md', notes)
        f1 = notes['f1.md']
        self.assertTrue(f1.startswith('---\n' + N.MADE_BY + '\n'))
        for line in ('level: 2', 'true_as_of: "2020-12"', 'related: ["w1"]', 'tags: ["mountains", "big-things"]'):
            self.assertIn(line, f1)
        self.assertIn('- [[w1]]', f1)
        self.assertIn('Edit the pack, not this note', f1)
        self.assertIn('[Everest](https://example.org/everest) (Example)', f1)
        self.assertIn('[[course-mountains-101]], class 2: Up high', notes['w1.md'])
        self.assertIn('course-mountains-101.md', notes)
        self.assertIn('pack-facts__test.md', notes)

    def test_flagged_left_out_unless_asked(self):
        self.assertNotIn('f2.md', N.build([('a.json', GOOD)]))
        self.assertIn('no screen shows it', N.build([('a.json', GOOD)], include_all=True)['f2.md'])

    def test_refuses_a_git_repository(self):
        self.assertIsNotNone(N.inside_git(HERE))
        with tempfile.TemporaryDirectory() as d:
            os.mkdir(os.path.join(d, '.git'))
            self.assertEqual(N.main(['--out', d, '--packs', d]), 2)
            self.assertFalse(os.path.exists(os.path.join(d, N.SUBFOLDER)))

    def test_removes_only_its_own_notes(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / N.SUBFOLDER
            target.mkdir()
            (target / 'mine.md').write_text('# my own note\n', encoding='utf-8')
            (target / 'old.md').write_text('---\n' + N.MADE_BY + '\n---\nold\n', encoding='utf-8')
            (target / 'f1.md').write_text('a note of the person\'s own with our name\n', encoding='utf-8')
            n, gone = N.write(N.build([('a.json', GOOD)]), d)
            self.assertEqual(gone, 1)
            self.assertFalse((target / 'old.md').exists())
            self.assertTrue((target / 'mine.md').exists())
            self.assertEqual((target / 'f1.md').read_text(encoding='utf-8'), 'a note of the person\'s own with our name\n')
            self.assertTrue((target / 'w1.md').exists())

    def test_levels_read_as_the_site_reads_them(self):
        js = (Path(HERE).parent / 'client' / 'research_index.js').read_text(encoding='utf-8')
        m = re.search(r"LEVEL_FROM_DIFFICULTY = Object\.freeze\((\{[^}]*\})\)", js)
        pairs = dict((k.strip(), int(v)) for k, v in re.findall(r"'?([a-z ]+)'?\s*:\s*(\d)", m.group(1)))
        self.assertEqual(pairs, N.LEVEL_FROM_DIFFICULTY)
        note = N.build([('a.json', {'schema': 'nimrod.research.v1', 'items': [
            {'id': 'h', 'kind': 'fact', 'text': 't', 'difficulty': 'hard', 'status': 'verified'}]})])['h.md']
        self.assertIn('level: 5', note)

    def test_the_site_packs_make_notes(self):
        notes = N.build(N.read_packs(N.PACKS))
        self.assertGreater(len(notes), 800)


if __name__ == '__main__':
    unittest.main()
