"""test_word_builder_lists.py - word_builder_lists.py and the accept list it wrote (2026-11-22, row 2.279).

    py -3.13 -m unittest web/tools/test_word_builder_lists.py

Without the downloads (SCOWL and 12dicts are not in the repository), it proves what can be proved from the repository:
the tool reads the games' own filter (web/client/word_filter.js); its prefixes take no ordinary word; and the
generated web/client/word_builder_accept.js is sorted, a to z, 3 to 8 letters, free of every slur, keeps medical and
everyday words (Mike, 2026-11-23), and carries SCOWL's whole notice. With the downloads, `word_builder_lists.py --check` proves the file is what they make.
"""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import word_builder_lists as T  # noqa: E402

CLIENT = os.path.join(HERE, '..', 'client')


def read(name):
    with open(os.path.join(CLIENT, name), encoding='utf-8') as f:
        return f.read()


class ToolTest(unittest.TestCase):
    def test_the_lists_are_the_games_own(self):
        js = read('word_filter.js')
        self.assertEqual(sorted(T.LISTS), ['adult', 'sexual', 'slur', 'swear'])
        for kind, (exact, starts) in T.LISTS.items():
            self.assertTrue(exact or starts, kind)
            self.assertIn('%s: `' % kind, js)

    def test_kinds(self):
        for w, k in (('wetback', 'slur'), ('nigger', 'slur'), ('fucking', 'swear'), ('bitchy', 'swear'),
                     ('orgasm', 'sexual'), ('rape', 'sexual'), ('murdered', 'adult'), ('shotgun', 'adult')):
            self.assertEqual(T.kind_of(w), k, w)
        # Mike, 2026-11-23: "Medical terms should not be blocked." Nor death, the body, or two-sense everyday words.
        for w in ('coma', 'stroke', 'dementia', 'cancer', 'disease', 'injury', 'funeral', 'dead', 'grave', 'naked',
                  'penis', 'vagina', 'spastic', 'abortion', 'insane', 'hang', 'screw', 'kitchen', 'garden', 'stable'):
            self.assertIsNone(T.kind_of(w), w)

    def test_no_prefix_takes_an_ordinary_word(self):
        # Each of these was taken by a prefix once (2026-11-22's list, or a first draft of this one).
        for w in ('arsenal', 'arsenic', 'arson', 'psychology', 'psychic', 'bulletin', 'squawk', 'killjoy', 'killdeer',
                  'junkier', 'stable', 'deadline', 'execute', 'bombast', 'puberty', 'lustre', 'lustrous', 'feckless',
                  'grenadine', 'scrape', 'cocktail', 'cockpit', 'titanic', 'raccoon', 'cracker', 'hello', 'shell'):
            self.assertIsNone(T.kind_of(w), w)

    def test_the_longest_word_is_eight(self):
        self.assertEqual(T.LONGEST, 8)
        js = read('word_builder_words.js')
        self.assertIn('export const LONGEST = 8;', js)


class AcceptFileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = read('word_builder_accept.js')
        body = cls.src[cls.src.index('const TEXT = `') + len('const TEXT = `'):cls.src.rindex('`')]
        cls.words = body.split()

    def test_sorted_unique_a_to_z_three_to_eight(self):
        self.assertGreater(len(self.words), 20000)
        self.assertEqual(self.words, sorted(set(self.words)))
        self.assertTrue(all(re.fullmatch('[a-z]{3,8}', w) for w in self.words))

    def test_no_slur(self):
        self.assertEqual([w for w in self.words if T.is_slur(w)], [])

    def test_keeps_medical_and_everyday_words_and_leaves_the_rest_to_the_setting(self):
        for w in ('coma', 'stroke', 'dementia', 'cancer', 'funeral', 'bulletin', 'stable', 'deadline'):
            self.assertIn(w, self.words, w)
        # swearing and the rest are in the file: a screen's "Words the games may use" holds them back while playing
        self.assertIn('fuck', self.words)
        self.assertIn('murder', self.words)

    def test_carries_scowls_whole_notice(self):
        for needle in ('Kevin Atkinson', 'Permission to use, copy, modify, distribute and sell these word',
                       'WordNet 1.6 Copyright 1997 by Princeton University', 'Geoff Kuenning', 'Do not edit by hand'):
            self.assertIn(needle, self.src)

    def test_the_text_is_a_plain_template_string(self):
        body = self.src[self.src.index('const TEXT = `') + 14:self.src.rindex('`')]
        self.assertNotIn('${', body)
        self.assertNotIn('`', body)


if __name__ == '__main__':
    unittest.main()
