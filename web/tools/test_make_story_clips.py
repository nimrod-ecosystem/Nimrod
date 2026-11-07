"""Tests for make_story_clips.py's plan (no voice, no browser): py -3.13 web/tools/test_make_story_clips.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_story_clips as S  # noqa: E402
import make_lesson_clips as L  # noqa: E402

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}  {detail}')


V = {'model': 'en_US-libritts-high', 'path': 'x.onnx', 'speaker': 552}
with tempfile.TemporaryDirectory() as d:
    lessons = {'format': L.FORMAT, 'voices': {'a': {'model': 'en_US-libritts-high', 'speaker': 552},
                                              'b': {'model': 'en_US-libritts-high', 'speaker': 26}},
               'lines': {'a': {'Hello.': {'file': 'aaaaaaaaaaaaaaaaaaaa.ogg', 'ms': 900}}, 'b': {}}}
    m, todo = S.plan(lessons, V, ['The Park is quiet.', 'Walk to the Bakery', 'Walk to the Bakery?'], d)
    check('*** the stories get a voice of their own; the teachers\' voices and lines are untouched ***',
          m['voices']['story'] == {'model': 'en_US-libritts-high', 'speaker': 552} and m['voices']['b']['speaker'] == 26
          and 'Hello.' in m['lines']['a'], m['voices'])
    check('every line not yet recorded is to be made', todo == ['The Park is quiet.', 'Walk to the Bakery', 'Walk to the Bakery?'], todo)
    f = L.clip_name('en_US-libritts-high', 552, 'The Park is quiet.')
    open(os.path.join(d, f), 'wb').close()
    m2, todo2 = S.plan(m, V, ['The Park is quiet.'], d)
    check('a recording already on disk under the same voice and words is listed, not made again',
          todo2 == [] and m2['lines']['story']['The Park is quiet.']['file'] == f, todo2)
    m3, _ = S.plan(m2, {**V, 'speaker': 26}, ['The Park is quiet.'], d)
    check('*** a new narrator voice starts only the stories\' list again ***',
          m3['lines']['story'] == {} and 'Hello.' in m3['lines']['a'] and m3['voices']['story']['speaker'] == 26)

print(f'\n{"ALL PASS" if not failed else "FAILED"} - {passed} passed' + (f', {failed} failed' if failed else ''))
sys.exit(1 if failed else 0)
