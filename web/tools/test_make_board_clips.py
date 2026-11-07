"""Tests for make_board_clips.py (no voice model needed): py -3.13 web/tools/test_make_board_clips.py"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_board_clips as M  # noqa: E402

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}  {detail}')


src = M.VOCAB.read_text(encoding='utf-8')
boards = M.board_words(src)
check('*** the five built-in boards are read, every card ***', list(boards) == ['YESNO', 'CARE', 'UNIVERSAL', 'LIBRARY', 'MEALS']
      and len(boards['UNIVERSAL']) == 36 and len(boards['CARE']) == 16, {b: len(w) for b, w in boards.items()})
w = M.wanted(src)
check('the slug is aac_clips.js clipSlug\'s', M.clip_slug('Thank you') == 'thank_you' and M.clip_slug(' All done! ') == 'all_done')
check('*** the 17 recorded already are among the words (one voice for all) ***',
      all(f[:-4] in w for f in os.listdir(M.OUT) if f.endswith('.wav') and f[:-4] in
          {'yes', 'no', 'okay', 'hi', 'thank_you', 'love_you', 'stop', 'wait', 'pain', 'help', 'hot', 'cold'}), sorted(w)[:20])
check('...core words and the extras too', all(k in w for k in ('i_want', 'all_done', 'different', 'please', 'witch_hat', 'treat_pail')))
check('a word is said with a full stop, as the first 17 were', M.spoken('Okay') == 'Okay.' and M.spoken('Help!') == 'Help!')
check('a card\'s own `say` wins over its word', M.board_words("export const YESNO = {\n { id: 'x', word: 'Loo', say: 'Restroom please' },\n"
                                                             "export const BUILTIN_BOARDS")['YESNO'] == ['Restroom please'])
missing = [s for s in w if not (M.OUT / f'{s}.wav').exists()]
check('*** EVERY WORD ON THE BUILT-IN BOARDS HAS ITS RECORDING (row 2.234); a new card word fails here until it is made ***',
      not missing, f'run make_board_clips.py for: {missing}')
with tempfile.TemporaryDirectory() as d:
    (Path(d) / 'yes.wav').write_bytes(b'RIFF')
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = M.main(['--model', 'nowhere.onnx', '--out', d, '--list'])
    check('*** --list: a file already there is not made again ***', code == 0 and 'yes.wav' not in buf.getvalue()
          and 'no.wav' in buf.getvalue(), buf.getvalue()[:200])
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        code = M.main(['--model', os.path.join(d, 'nowhere.onnx'), '--out', d])
    check('no model: refused, nothing written', code == 2 and sorted(os.listdir(d)) == ['yes.wav'])

print(f'\n{"ALL PASS" if not failed else "FAILED"} - {passed} passed' + (f', {failed} failed' if failed else ''))
sys.exit(1 if failed else 0)
