"""test_word_builder_lists.py - word_builder_lists.py and the accept list it wrote (2026-11-22, row 2.279).

    py -3.13 -m unittest web/tools/test_word_builder_lists.py

Without the downloads (SCOWL and 12dicts are not in the repository), it proves what can be proved from the repository:
the tool's LEFT_OUT is the game's; the block list keeps out what it says and lets ordinary words through; and the
generated web/client/word_builder_accept.js is sorted, a to z, 3 to 8 letters, free of every blocked word, and carries
SCOWL's whole notice. With the downloads, `word_builder_lists.py --check` proves the file is what they make.
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
    def test_left_out_is_the_games_own(self):
        js = read('word_builder_words.js')
        block = js[js.index('LEFT_OUT'):js.index('function parseTier')]
        self.assertEqual(sorted(re.findall(r"'([a-z]+)'", block)), sorted(T.LEFT_OUT))

    def test_the_block_list_keeps_out_what_it_names_and_not_ordinary_words(self):
        for w in ('murder', 'murdered', 'coma', 'stroke', 'naked', 'shotgun', 'bloody', 'dead', 'rape', 'fucking'):
            self.assertTrue(T.blocked(w), w)
        for w in ('kitchen', 'garden', 'window', 'gravel', 'hanger', 'warden', 'bullion', 'peel', 'brass', 'scrape'):
            self.assertFalse(T.blocked(w), w)

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

    def test_no_blocked_word(self):
        self.assertEqual([w for w in self.words if T.blocked(w)], [])

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
