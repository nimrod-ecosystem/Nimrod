#!/usr/bin/env python3
"""The home voice-training script's pieces that need no machine learning: its arguments, reading an export, the
split, the word error rate, where the model goes, the training settings it builds, the device refusal, --check,
and that it never installs anything. Nothing is trained, downloaded or installed; no ML package is imported.

Run, from web/:
    py -3.13 tools/test_train_my_voice.py
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import wave
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

HEAVY = ('torch', 'transformers', 'ctranslate2', 'faster_whisper', 'numpy', 'accelerate')
before = {m for m in HEAVY if m in sys.modules}
import train_my_voice as T  # noqa: E402
from speech_service import backends  # noqa: E402

passed = 0
failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


def heavy_loaded():
    return sorted(m for m in HEAVY if m in sys.modules and m not in before)


def write_wav(path, seconds=0.5, rate=16000, channels=1, width=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b'\x01\x00' * int(rate * seconds) * channels * (width // 2))


def make_export(root, phrases, index=True, names=None):
    """An export as the Voice model page writes it (v2: data/0..N-1)."""
    data = root / 'data'
    samples = []
    for i, ph in enumerate(phrases):
        folder = (names or [str(k) for k in range(len(phrases))])[i]
        write_wav(data / folder / 'recording.wav')
        (data / folder / 'phrase.txt').write_text(ph, encoding='utf-8')
        samples.append({'folder': folder, 'pairId': f'vp-{i}', 'phrase': ph})
    if index:
        (root / 'nimrod-export.json').write_text(json.dumps({'kind': 'nimrod-euphonia-export', 'v': 2, 'count': len(samples),
                                                             'samples': samples}), encoding='utf-8')
    return data


def quiet(fn, *a, **k):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        try:
            r = fn(*a, **k)
        except SystemExit as e:
            r = ('exit', e.code)
    return r, buf.getvalue()


def args_tests():
    print('\n-- arguments --')
    a = T.parse_args(['--data', 'x'])
    check('*** the base is whisper-small.en, the model the speech service runs ***', a.base == 'openai/whisper-small.en'
          and T.STOCK_FOR_SCORE == 'small.en')
    check("*** the notebook's numbers by default: 10 epochs, 1e-5, batch 8, 10 warm-up, every 5 steps ***",
          (a.epochs, a.lr, a.batch, a.warmup, a.eval_every) == (10, 1e-5, 8, 10, 5), vars(a))
    check("*** encoder and projection trained, decoder frozen (the notebook's switches) ***",
          not a.no_train_encoder and not a.no_train_proj and not a.train_decoder)
    check('split 80 / 10 / 10 by default', (a.hold_back, a.eval_share) == (10, 10))
    check('*** nothing downloads, nothing replaced, the processor not used, by default ***',
          not a.allow_download and not a.replace and not a.cpu and not a.keep_work)
    check('transcripts up to 64 tokens (the notebook cut at 32)', a.max_tokens == 64)
    r, _ = quiet(T.parse_args, ['--check', '--score', '--data', 'x'])
    check('--check and --score cannot be asked at once', r == ('exit', 2), r)
    r, _ = quiet(T.parse_args, [])
    check('*** training needs --data (it never guesses where the recordings are) ***', r == ('exit', 2), r)
    check('--check needs no --data', T.parse_args(['--check']).check)
    r, _ = quiet(T.parse_args, ['--data', 'x', '--hold-back', '0'])
    check('a held-back share of 0 is refused (--score would have nothing)', r == ('exit', 2), r)
    r, _ = quiet(T.parse_args, ['--data', 'x', '--hold-back', '45', '--eval-share', '45'])
    check('shares that leave nothing to train on are refused', r == ('exit', 2), r)


def listing_tests():
    print('\n-- reading an export --')
    with tempfile.TemporaryDirectory() as d:
        D = Path(d)
        ex = D / 'Recordings'
        make_export(ex, ['Good morning', 'Turn on the lights.', 'I want a drink'])
        root, data = T.find_data_folder(ex)
        check('the export folder: data/ inside it', (root, data) == (ex.resolve(), (ex / 'data').resolve()))
        check('...or data/ itself', T.find_data_folder(ex / 'data') == (ex.resolve(), (ex / 'data').resolve()))
        try:
            T.find_data_folder(D)
            ok = False
        except T.Refusal as e:
            ok = 'Export the recordings' in str(e)
        check('*** a folder that is not an export: refused, saying how to make one ***', ok)
        try:
            T.find_data_folder(D / 'nope')
            ok = False
        except T.Refusal:
            ok = True
        check('a folder that does not exist: refused', ok)
        clips, notes = T.list_clips(data, T.read_index(ex))
        check('*** the folders the index lists, in its order, with the phrase from phrase.txt ***',
              [c['folder'] for c in clips] == ['0', '1', '2'] and clips[1]['phrase'] == 'Turn on the lights.'
              and clips[2]['pair_id'] == 'vp-2' and not notes, (clips, notes))
        check('the split key is the phrase, normalised', clips[1]['key'] == 'turn on the lights')

        # Problems, each left out and SAID.
        write_wav(data / '3' / 'recording.wav', channels=2)
        (data / '3' / 'phrase.txt').write_text('Stereo', encoding='utf-8')
        write_wav(data / '4' / 'recording.wav', rate=44100)
        (data / '4' / 'phrase.txt').write_text('Wrong rate', encoding='utf-8')
        write_wav(data / '5' / 'recording.wav')
        write_wav(data / '6' / 'recording.wav', seconds=31)
        (data / '6' / 'phrase.txt').write_text('Too long', encoding='utf-8')
        write_wav(data / '7' / 'recording.wav')
        (data / '7' / 'phrase.txt').write_text(' ... ', encoding='utf-8')
        idx = json.loads((ex / 'nimrod-export.json').read_text(encoding='utf-8'))
        idx['samples'] += [{'folder': str(k), 'pairId': f'vp-{k}'} for k in (3, 4, 5, 6, 7, 8)]
        (ex / 'nimrod-export.json').write_text(json.dumps(idx), encoding='utf-8')
        write_wav(data / '9' / 'recording.wav')
        (data / '9' / 'phrase.txt').write_text('From an older export', encoding='utf-8')
        clips, notes = T.list_clips(data, T.read_index(ex))
        text = '\n'.join(notes)
        check('*** unusable recordings are left out, never trained on quietly ***', [c['folder'] for c in clips] == ['0', '1', '2'],
              [c['folder'] for c in clips])
        check('...each one said: stereo, wrong rate, no phrase, too long, no words, missing folder',
              all(s in text for s in ('data/3: left out', '2 channel', 'data/4: left out', '44100 Hz', 'data/5: left out, it has no phrase.txt',
                                      'data/6: left out', '31 s long', 'data/7: left out, its phrase.txt has no words',
                                      'data/8: left out, it has no recording.wav')), text)
        check("*** a numbered folder the index does not list (an older export's) is left out and said ***",
              'not in nimrod-export.json' in text and ', 9' not in text.split('left out:')[0] and '9' in text.split('left out:')[1].split('\n')[0], text)

    with tempfile.TemporaryDirectory() as d:
        ex = Path(d)
        data = make_export(ex, ['a', 'b', 'c', 'd'], index=False, names=['0', '1', '2', '10'])
        clips, notes = T.list_clips(data, T.read_index(ex))
        check('*** no index: every numbered folder, in NUMBER order (0,1,2,10 - not 0,1,10,2) ***',
              [c['folder'] for c in clips] == ['0', '1', '2', '10'], [c['folder'] for c in clips])
        check("...and a gap is said: Euphonia's own notebook would stop on it", any('notebook would stop' in n for n in notes), notes)
    with tempfile.TemporaryDirectory() as d:
        ex = Path(d)
        data = make_export(ex, ['a', 'b'], index=False, names=['001', '002'])
        clips, notes = T.list_clips(data, None)
        check('an old (v1) export, padded from 001: still read, and the numbering said',
              [c['folder'] for c in clips] == ['001', '002'] and any('not numbered 0, 1, 2' in n for n in notes), (clips, notes))
    with tempfile.TemporaryDirectory() as d:
        ex = Path(d)
        data = make_export(ex, ['a', 'b', 'c'], index=False)
        clips, notes = T.list_clips(data, None)
        check('*** the new export (0..N-1, no gaps): no note at all ***', len(clips) == 3 and not notes, notes)
    with tempfile.TemporaryDirectory() as d:
        # subtitle learning (2026-10-09): a corrected subtitle line's recording, exported by voice_recording.js
        # exportEuphonia with `from: "correction"` in its index entry - the same data/N/recording.wav + phrase.txt.
        ex = Path(d)
        data = make_export(ex, ['Good morning', 'I am seeing Rosalind today'])
        idx = json.loads((ex / 'nimrod-export.json').read_text(encoding='utf-8'))
        idx['samples'][1]['from'] = 'correction'
        (ex / 'nimrod-export.json').write_text(json.dumps(idx), encoding='utf-8')
        clips, notes = T.list_clips(data, T.read_index(ex))
        check('*** a sample whose words came from a subtitle correction is trained on like any other ***',
              [c['folder'] for c in clips] == ['0', '1'] and clips[1]['phrase'] == 'I am seeing Rosalind today' and not notes,
              (clips, notes))


def split_tests():
    print('\n-- the split --')
    phrases = [f'phrase number {i}' for i in range(2000)]
    clips = [{'folder': str(i), 'key': T.normalise_text(p), 'phrase': p, 'pair_id': None, 'audio': ''} for i, p in enumerate(phrases)]
    s = T.split_clips(clips)
    n = {k: len(v) for k, v in s.items()}
    check('*** about 80 / 10 / 10 ***', 1500 < n['train'] < 1700 and 150 < n['eval'] < 250 and 150 < n['held_back'] < 250, n)
    keys = {k: {c['key'] for c in v} for k, v in s.items()}
    check('*** nothing held back is trained on (the three sides never share a phrase) ***',
          not (keys['train'] & keys['held_back']) and not (keys['train'] & keys['eval']) and not (keys['eval'] & keys['held_back']))
    again = T.split_clips(list(reversed(clips)))
    check('the same split whatever the order (re-numbered export)', {c['key'] for c in again['held_back']} == keys['held_back'])
    more = T.split_clips(clips + [{'folder': 'x', 'key': f'new {i}', 'phrase': '', 'pair_id': None, 'audio': ''} for i in range(500)])
    check('*** STABLE as more are recorded: every held-back phrase stays held back, every trained one stays trained ***',
          keys['held_back'] <= {c['key'] for c in more['held_back']} and keys['train'] <= {c['key'] for c in more['train']})
    two = T.split_clips([{'key': 'pause', 'folder': '1'}, {'key': 'pause', 'folder': '2'}, {'key': 'pause', 'folder': '3'}])
    check('two takes of one phrase are always on the same side', sum(1 for v in two.values() if v) == 1)
    other = T.split_clips(clips, salt='another-salt')
    check('the salt decides the deal (a different salt, a different held-back set)', {c['key'] for c in other['held_back']} != keys['held_back'])
    check('*** a side with nothing in it: said, with what to do ***',
          'nothing to score with' in (T.split_problem({'train': [1], 'eval': [1], 'held_back': []}) or '')
          and T.split_problem(s) is None)


def wer_tests():
    print('\n-- word error rate --')
    check('punctuation and case do not count', T.word_errors('Turn on the lights.', 'turn on the lights') == (0, 4))
    check('one word wrong of four', T.word_errors('turn on the lights', 'turn on the light') == (1, 4))
    check('a missing word and an extra word', T.word_errors('a b c', 'a c d') == (2, 3))
    check("an apostrophe inside a word is kept ('don't' is not 'don t')", T.normalise_text("Don't STOP!") == "don't stop"
          and T.normalise_text("\u2018quoted\u2019 it\u2019s") == "quoted it's")
    check('corpus WER is all edits over all words', abs(T.corpus_wer([('a b c d', 'a b c x'), ('e f', 'e f')]) - 1 / 6) < 1e-9)
    check('no words: no rate', T.corpus_wer([('', 'x')]) is None)
    check('*** the verdict: keep it only if it wins ***', 'Keep it' in T.verdict(0.4, 0.2) and 'standard one' in T.verdict(0.2, 0.2)
          and 'Worse' in T.verdict(0.2, 0.3))


def output_tests():
    print('\n-- where the model goes --')
    check('*** the "Voice model" name is the speech service\'s (and so the site\'s) ***', T.VOICE_MODEL_SUBFOLDER == backends.VOICE_MODEL_SUBFOLDER == 'Voice model')
    with tempfile.TemporaryDirectory() as d:
        D = Path(d)
        nf = D / 'nimrod_folder.txt'
        a = T.parse_args(['--data', 'x', '--root', str(D / 'Nimrod')])
        check('*** --root: <Nimrod folder>/Voice model ***', T.output_folder(a, root_file=nf) == (D / 'Nimrod' / 'Voice model', 'root'))
        a = T.parse_args(['--data', 'x', '--root', str(D / 'Nimrod'), '--out', str(D / 'Elsewhere')])
        check('--out wins over --root', T.output_folder(a, root_file=nf) == (D / 'Elsewhere', 'out'))
        a = T.parse_args(['--data', 'x'])
        check('*** neither, no nimrod_folder.txt: the service\'s own fallback (speech_service/my_voice_model) ***',
              T.output_folder(a, root_file=nf, fallback=backends.MY_VOICE_DIR) == (Path(backends.MY_VOICE_DIR), 'fallback'))
        nf.write_text(f'# my Nimrod folder\n\n"{D / "Nimrod"}"\n', encoding='utf-8')
        check('*** no --root: nimrod_folder.txt names it, as the speech service reads it ***',
              T.output_folder(a, root_file=nf) == (D / 'Nimrod' / 'Voice model', 'file'))
        try:
            from speech_service.__main__ import read_root_file as service_reads
            same = all(T.read_root_file(p) == service_reads(p) for p in (nf, D / 'missing.txt'))
            for body in ('# only comments\n', "  'C:\\x y'  \n", ''):
                nf.write_text(body, encoding='utf-8')
                same = same and T.read_root_file(nf) == service_reads(nf)
            check('*** reads nimrod_folder.txt exactly as the speech service does (the same answers) ***', same)
        except ImportError as e:
            check('the speech service\'s reader can be imported to compare', False, e)

        vm = D / 'Nimrod' / 'Voice model'
        check('*** a Nimrod folder that does not exist: refused before training ***',
              'does not exist' in (T.output_problem(vm, 'root') or ''))
        vm.mkdir(parents=True)
        (vm / 'README.txt').write_text('Put the converted voice model here.', encoding='utf-8')
        check("the site's README alone is not a model: fine", T.output_problem(vm, 'root') is None)
        (vm / 'model.bin').write_bytes(b'x')
        check('*** a model already there: refused BEFORE training, saying --score and --replace ***',
              all(s in (T.output_problem(vm, 'root') or '') for s in ('already holds', '--score', '--replace', 'nothing is deleted')))
        check('...and allowed with --replace', T.output_problem(vm, 'root', replace=True) is None)
        a = T.parse_args(['--data', 'x'])
        check('the work folder: beside data/ by default', T.work_folder(a, D / 'Rec') == D / 'Rec' / T.WORK_NAME)
        a = T.parse_args(['--data', 'x', '--work', str(D / 'W')])
        check('...or --work', T.work_folder(a, D / 'Rec') == D / 'W')


def settings_tests():
    print('\n-- the training settings (fix 3: eval_strategy or evaluation_strategy) --')
    a = T.parse_args(['--data', 'x'])
    new = {'output_dir', 'eval_strategy', 'save_strategy', 'eval_steps', 'save_steps', 'use_cpu', 'fp16', 'save_only_model',
           'per_device_train_batch_size', 'learning_rate', 'num_train_epochs', 'warmup_steps', 'predict_with_generate',
           'generation_max_length', 'load_best_model_at_end', 'metric_for_best_model', 'greater_is_better'}
    kw = T.training_kwargs(new, a, 'cuda', '/w')
    check('*** a version that takes eval_strategy gets eval_strategy ***', kw.get('eval_strategy') == 'steps' and 'evaluation_strategy' not in kw, kw)
    old = (new - {'eval_strategy', 'use_cpu', 'save_only_model'}) | {'evaluation_strategy', 'no_cuda'}
    kw2 = T.training_kwargs(old, a, 'cpu', '/w')
    check('*** an older one that only knows evaluation_strategy gets that ***', kw2.get('evaluation_strategy') == 'steps' and 'eval_strategy' not in kw2, kw2)
    check('a name the installed version does not know is left out (save_only_model)', 'save_only_model' not in kw2 and kw['save_only_model'] is True)
    check('fp16 only on a graphics card; the processor says so as use_cpu / no_cuda', kw['fp16'] is True and kw2.get('fp16') is False
          and kw2.get('no_cuda') is True and 'use_cpu' not in kw)
    check("*** the best checkpoint is chosen by word error rate, lower is better, every 5 steps ***",
          kw['metric_for_best_model'] == 'wer' and kw['greater_is_better'] is False and kw['load_best_model_at_end'] is True
          and kw['eval_steps'] == kw['save_steps'] == 5 and kw['generation_max_length'] == 64)

    class Fake:
        def __init__(self, output_dir, eval_strategy='no'):
            pass
    check('the names are read from the installed class itself', T.accepted_names(Fake) == {'output_dir', 'eval_strategy'})


def device_tests():
    print('\n-- the device --')
    gpu = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True))
    none = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
    check('a graphics card: used', T.pick_device(T.parse_args(['--data', 'x']), gpu) == 'cuda')
    try:
        T.pick_device(T.parse_args(['--data', 'x']), none)
        msg = ''
    except T.Refusal as e:
        msg = str(e)
    check('*** no graphics card and no --cpu: REFUSED, saying it takes hours and naming --cpu ***', 'hours' in msg and '--cpu' in msg, msg)
    check('with --cpu: the processor', T.pick_device(T.parse_args(['--data', 'x', '--cpu']), none) == 'cpu')


def check_mode_tests():
    print('\n-- --check: reports, installs nothing --')
    with tempfile.TemporaryDirectory() as d:
        env = {'HF_HOME': d}
        have = {'numpy': '2.2.4', 'torch': '2.7.0+cu126', 'faster-whisper': '1.2.1'}
        lines, ready = T.check_report(lambda n: have.get(n), gpu=None, env=env)
        text = '\n'.join(lines)
        check('*** missing packages named, with their pins ***', 'transformers' in text and 'MISSING (pinned 4.51.3)' in text
              and 'accelerate' in text and not ready, text)
        check('a CUDA build of the pinned torch counts as the pin', 'torch           ok' in text, text)
        check('*** the install lines are SHOWN, for a NEW environment with every pin, never run ***',
              'venv' in text and 'pip install torch==2.7.0 --index-url https://download.pytorch.org/whl/cu126' in text
              and 'pip install transformers==4.51.3 accelerate==1.6.0 numpy==2.2.4 ctranslate2==4.8.1' in text
              and 'AFTER they are approved' in text, text)
        check('the base model: not here yet, and --allow-download named', 'NOT on this computer yet' in text and '--allow-download' in text)
        snap = Path(d) / 'hub' / 'models--openai--whisper-small.en' / 'snapshots' / 'abc'
        snap.mkdir(parents=True)
        (snap / 'config.json').write_text('{}', encoding='utf-8')
        check('*** the base model found in the Hugging Face cache by looking only ***', T.model_in_cache('openai/whisper-small.en', env))
        all_have = {n: v for n, v, _w in T.PINNED + T.SCORE_PINNED}
        lines, ready = T.check_report(lambda n: all_have.get(n), gpu={'cuda': True, 'name': 'Card', 'gb': 6}, env=env)
        text = '\n'.join(lines)
        check('everything installed: ready, and no install line', ready and 'pip install' not in text, text)
        check('a card under ~8 GB is warned about', 'may run out of memory' in text)
        lines, _ = T.check_report(lambda n: all_have.get(n), gpu={'cuda': False}, env=env)
        check('no card: says training would need --cpu', '--cpu' in '\n'.join(lines))
        r, out = quiet(T.main, ['--check'], version_of=lambda n: None)
        check('*** --check exits 3 when something is missing (and prints the lines) ***', r == T.EXIT_MISSING and 'pip install' in out, (r, out[-300:]))
    src = Path(T.__file__).read_text(encoding='utf-8')
    code = '\n'.join(l for l in src.splitlines() if not l.lstrip().startswith('#'))
    check('*** IT NEVER INSTALLS: no subprocess, os.system, pip module or ensurepip anywhere in the script ***',
          not any(s in code for s in ('subprocess', 'os.system', 'import pip', 'pip.main', 'ensurepip', 'os.popen', 'Popen')))
    check('*** and never uploads: no web request of its own (no requests, urllib, http, socket) ***',
          not any(s in code for s in ('import requests', 'urllib', 'http.client', 'import socket')))


def pins_tests():
    print('\n-- the pins --')
    pins = {n: v for n, v, _w in T.PINNED + T.SCORE_PINNED}
    check('*** every training package is pinned to an exact version ***',
          set(pins) == {'torch', 'transformers', 'accelerate', 'numpy', 'ctranslate2', 'faster-whisper'}
          and all(v.count('.') == 2 for v in pins.values()), pins)
    check('*** the converter is the same ctranslate2 the speech service loads with (checked here 2026-10-07: 4.8.1) ***', pins['ctranslate2'] == '4.8.1')
    doc = T.__doc__
    check('the header lists the same pins it checks', all(f'{n}=={v}' in doc for n, v in pins.items() if n != 'faster-whisper'), doc[-1200:])
    check('*** the header says the recordings stay on your own computers and only the stock model is fetched ***',
          'STAY ON YOUR OWN COMPUTERS' in doc and 'sends nothing anywhere' in doc and '--allow-download' in doc)
    check("the header names the notebook's three fixes", 'save_pretrainedl' in doc and 'tokenizer.json' in doc and 'eval_strategy' in doc)


def end_to_end_tests():
    print('\n-- the whole run, up to the first heavy import --')
    with tempfile.TemporaryDirectory() as d:
        D = Path(d)
        ex = D / 'Recordings'
        make_export(ex, [f'phrase {i}' for i in range(120)])
        (D / 'Nimrod').mkdir()
        r, out = quiet(T.main, ['--data', str(ex), '--root', str(D / 'Nimrod'), '--dry-run'])
        check('*** --dry-run: lists, splits, names the folder, writes nothing ***', r == T.EXIT_OK and 'Recordings: 120 usable' in out
              and 'held back for --score' in out and str(D / 'Nimrod' / 'Voice model') in out and 'Dry run' in out
              and not (D / 'Nimrod' / 'Voice model').exists() and not (ex / T.WORK_NAME).exists(), out)
        r, out = quiet(T.main, ['--data', str(ex), '--root', str(D / 'Nimrod')], version_of=lambda n: None)
        check('*** training with the packages missing: exit 3, pointing at --check, nothing made ***',
              r == T.EXIT_MISSING and '--check' in out and not (ex / T.WORK_NAME).exists(), out[-300:])
        vm = D / 'Nimrod' / 'Voice model'
        vm.mkdir()
        (vm / 'model.bin').write_bytes(b'x')
        r, out = quiet(T.main, ['--data', str(ex), '--root', str(D / 'Nimrod')])
        check('*** a model already in place: refused (exit 2) before anything heavy ***', r == T.EXIT_REFUSED and 'already holds' in out, out[-300:])
        small = D / 'Small'
        make_export(small, ['one', 'two'])
        r, out = quiet(T.main, ['--data', str(small), '--out', str(D / 'Out')])
        check('two recordings: refused, saying what is missing from the split', r == T.EXIT_REFUSED and 'Record more' in out, out[-300:])
        r, out = quiet(T.main, ['--score', '--data', str(ex), '--out', str(D / 'Out')], version_of=lambda n: None)
        check('*** --score with no model there: refused in words (exit 2) before any model is loaded ***',
              r == T.EXIT_REFUSED and ('cannot be scored' in out or 'faster-whisper' in out), out[-300:])
        check('...and it says it has no training record, so it uses its own split', 'no training.json' in out, out[-400:])
    check('*** NO ML PACKAGE WAS IMPORTED by any of the above ***', heavy_loaded() == [], heavy_loaded())


if __name__ == '__main__':
    check('importing the script imports no ML package', heavy_loaded() == [], heavy_loaded())
    args_tests()
    listing_tests()
    split_tests()
    wer_tests()
    output_tests()
    settings_tests()
    device_tests()
    check_mode_tests()
    pins_tests()
    end_to_end_tests()
    print(f'\n{"ALL PASS" if not failed else "FAILED"} - {passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)
