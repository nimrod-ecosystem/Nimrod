#!/usr/bin/env python3
"""train_my_voice.py - teach Whisper one person's voice, on your own computer (home voice training, 2026-10-07).

WHAT IT DOES
    Reads the recordings the Voice model page exported (data/0/recording.wav + phrase.txt, ...), fine-tunes
    Whisper's ENCODER on them (how it hears), keeps a share of them back that it never trains on, converts the
    result for faster-whisper (int8) and writes it straight into your Nimrod folder's "Voice model" folder,
    where `py -3.13 -m speech_service --my-voice` loads it. `--score` then compares the stock model and yours
    on the held-back recordings, so you keep yours only if it does better.

THE METHOD IT FOLLOWS
    Google's Project Euphonia training notebook (github.com/google/project-euphonia-app, Apache-2.0), read
    2026-10-07 (private repo docs/for_chat/euphonia_read_20261007.md). Same idea and settings: encoder and
    projection layer trained, decoder frozen, 10 epochs, learning rate 1e-5, batch 8, 10 warm-up steps, fp16 on a
    graphics card, gradient checkpointing, scored every 5 steps and the best kept by word error rate. Left out:
    the Colab sign-in, the copy from a Firebase bucket, the Google Drive mount and TensorBoard. Fixed:
      1. the notebook saves with `save_pretrainedl` (a typo that fails at the very end): this saves properly;
      2. the notebook saves the model and the processor into DIFFERENT folders, and the converter needs
         tokenizer.json and preprocessor_config.json beside the weights: this saves them into one folder;
      3. the notebook passes `evaluation_strategy`, which newer transformers renamed `eval_strategy`: this asks
         the installed version which name it takes, and uses that;
      and for an English-only base (.en) it does not set a language or task, which such a model refuses.

YOUR RECORDINGS STAY ON YOUR OWN COMPUTERS
    It reads a folder on this computer and writes a folder on this computer. It sends nothing anywhere. The only
    thing it ever fetches is the STOCK base model (about 1 GB, from huggingface.co), and only when you add
    --allow-download (once; it is kept in the Hugging Face cache after that). The trained model is your voice in
    another form: it is written only to the folder named below, and the training work folder is deleted when
    training succeeds (--keep-work keeps it).

USAGE (from the project's web folder)
    py -3.13 tools/train_my_voice.py --check                               what is installed, what is missing
    py -3.13 tools/train_my_voice.py --data "D:\\Nimrod\\Recordings" --dry-run   what it would do; loads nothing
    py -3.13 tools/train_my_voice.py --data "D:\\Nimrod\\Recordings" --root "D:\\Nimrod"
    py -3.13 tools/train_my_voice.py --data "D:\\Nimrod\\Recordings" --cpu      no graphics card: hours
    py -3.13 tools/train_my_voice.py --score --data "D:\\Nimrod\\Recordings" --root "D:\\Nimrod"
  --data is the folder you exported to (the one holding data/ and nimrod-export.json), or its data/ itself.
  --root is your Nimrod folder; without it, speech_service/nimrod_folder.txt's line is used, as the speech
  service does; with neither, speech_service/my_voice_model (the service's fallback). --out names any other folder.
  A folder that already holds a model is not overwritten unless you add --replace (the old one is moved aside).

WHICH COMPUTER
    One with an NVIDIA graphics card: about 8 GB of graphics memory for whisper-small, 12 GB is comfortable
    [estimate, unmeasured]. Minutes to under an hour for a few hundred recordings [estimate]. Without one it
    refuses unless you add --cpu: on the desktop's processor alone, very roughly an hour or more for 100
    recordings [estimate]. A Mac's graphics are not used (--cpu).

PINNED VERSIONS (this script installs NOTHING; `--check` reports what is missing)
    Install them in a SEPARATE environment, so the speech service's own packages are not changed (the desktop's
    have newer tokenizers / huggingface_hub than transformers 4.51 accepts, and pip would downgrade them):
        py -3.13 -m venv "%USERPROFILE%\\nimrod-voice-train"
        "%USERPROFILE%\\nimrod-voice-train\\Scripts\\python" -m pip install torch==2.7.0 --index-url https://download.pytorch.org/whl/cu126
        "%USERPROFILE%\\nimrod-voice-train\\Scripts\\python" -m pip install transformers==4.51.3 accelerate==1.6.0 numpy==2.2.4 ctranslate2==4.8.1
    then run this script with that python. (cu126 suits most NVIDIA cards; an RTX 50-series wants .../whl/cu128.
    A computer with no NVIDIA card: plain `pip install torch==2.7.0`.) Each pin and why: PINNED below.
    Scoring needs faster-whisper 1.2.1, which the desktop's own py -3.13 already has: run --score there.

WHAT IS NOT CHECKED HERE
    Nothing in this file has trained a model yet: no package was installed and nothing was run for it. The pins
    are a consistent set from one release season, NOT a tested install; the first real run is the test.
"""
from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import os
import re
import shutil
import sys
import time
import wave
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
if str(WEB) not in sys.path:
    sys.path.insert(0, str(WEB))
# The speech service's own names for the places a model goes (pure Python, no packages): one source of truth.
from speech_service.backends import MY_VOICE_DIR, NIMROD_FOLDER_FILE, VOICE_MODEL_SUBFOLDER  # noqa: E402

# ---------------------------------------------------------------------------------------------------------------
# PINS. (package, version, why). Exact versions because the notebook pinned nothing, and "whatever pip finds
# today" is how its evaluation_strategy line broke.
# ---------------------------------------------------------------------------------------------------------------
PINNED = (
    ('torch', '2.7.0', 'the training itself. The CUDA build, for an NVIDIA card'),
    ('transformers', '4.51.3', 'Whisper and its Trainer. Takes eval_strategy; this script also accepts the old name'),
    ('accelerate', '1.6.0', 'the Trainer refuses to run without it'),
    ('numpy', '2.2.4', 'audio as numbers'),
    ('ctranslate2', '4.8.1', "the conversion. The SAME version the desktop's faster-whisper 1.2.1 runs (checked "
                             '2026-10-07): a newer converter can write a folder an older speech service cannot load'),
)
SCORE_PINNED = (
    ('faster-whisper', '1.2.1', "--score only: what the speech service runs (the desktop's py -3.13 has it)"),
)
TORCH_INDEX = 'https://download.pytorch.org/whl/cu126'

# ---------------------------------------------------------------------------------------------------------------
# DEFAULTS, each a command-line option. The training numbers are the notebook's own [read 2026-10-07].
# ---------------------------------------------------------------------------------------------------------------
# The base: English-only small, the model the speech service already runs (its default small.en), so a personal
# model is a like-for-like swap and --score compares like with like. Argued against the notebook's multilingual
# whisper-small: for English the .en models are as good or better at this size [training knowledge, OpenAI's
# Whisper paper], and multilingual buys nothing for an English speaker. --base openai/whisper-small for somebody
# who speaks another language too (the script then sets language and task, as the notebook does).
BASE_MODEL = 'openai/whisper-small.en'
STOCK_FOR_SCORE = 'small.en'          # faster-whisper's name for the same stock model, already on the desktop
EPOCHS = 10
LEARNING_RATE = 1e-5
BATCH = 8
WARMUP_STEPS = 10
EVAL_EVERY = 5
# Longest transcript it will write, in tokens. The notebook's 32 cuts off a long phrase (its own guidance allows up to
# 140 characters, roughly 35-40 tokens [estimate]), which would count as errors when choosing the best checkpoint.
# 64 covers that, and costs nothing on a short phrase (it stops at the end of the sentence).
MAX_TOKENS = 64
# Shares kept OUT of training, in percent. The notebook's split is 80 / 10 / 10. Held back: never trained on, used
# only by --score. Eval: never trained on, used to pick the best checkpoint during training.
HOLD_BACK_PCT = 10
EVAL_PCT = 10
# The split is by a hash of the phrase, so a recording's side never changes when more are recorded or the export
# is renumbered, and two takes of one phrase are always on the same side (no "held back" phrase the model has
# already heard). Changing this word re-deals every recording: only on purpose.
SPLIT_SALT = 'nimrod-voice-holdback-v1'
SAMPLE_RATE = 16000                   # what the recorder writes and Whisper wants
MAX_CLIP_S = 30.0                     # Whisper hears 30 s at a time; a longer clip would be cut, so it is left out
# Fewer recordings than this: it still trains, but says the result is likely no better (the Euphonia research's
# personal models used 300 or more; the 100-phrase list is the low end) [read 2026-10-07, section 3].
FEW_CLIPS = 100
# Free space it asks for where the work folder goes: two checkpoints (~1 GB each for small, model only), the
# trained copy (~1 GB) and the converted folder (~0.25 GB), with room to spare [estimate]. A warning, not a refusal.
WORK_SPACE_GB = 4
TRAINING_RECORD = 'training.json'     # written beside model.bin: what it was trained on, for --score
WORK_NAME = 'voice training work'
INDEX_NAME = 'nimrod-export.json'
DATA_NAME = 'data'
AUDIO_NAME = 'recording.wav'
PHRASE_NAME = 'phrase.txt'
MODEL_MARKERS = ('model.bin', 'model.safetensors', 'pytorch_model.bin')   # the service's own test (__main__.py)

EXIT_OK, EXIT_ERROR, EXIT_REFUSED, EXIT_MISSING = 0, 1, 2, 3


class Refusal(Exception):
    """Something the person must change before it can go on, said in words."""


# ---------------------------------------------------------------------------------------------------------------
# ARGUMENTS
# ---------------------------------------------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(prog='train_my_voice', description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='report what is installed and what is missing; installs nothing')
    mode.add_argument('--score', action='store_true', help='word error rate of the stock model and yours on the held-back recordings')
    mode.add_argument('--dry-run', action='store_true', help='list the recordings, the split and where the model would go; load nothing')
    p.add_argument('--data', default=None, help='the folder you exported to (holding data/ and nimrod-export.json), or its data/')
    p.add_argument('--root', default=None, help='your Nimrod folder; the model goes in its "Voice model" folder')
    p.add_argument('--out', default=None, help='a different folder for the voice model (training writes it; --score reads it)')
    p.add_argument('--replace', action='store_true', help='a model is already there: move it aside and put the new one in')
    p.add_argument('--work', default=None, help=f'where training keeps its work (default: "{WORK_NAME}" beside data/)')
    p.add_argument('--keep-work', action='store_true', help='keep the work folder (checkpoints, the unconverted model) afterwards')
    p.add_argument('--cpu', action='store_true', help='train on the processor when there is no NVIDIA graphics card (takes hours)')
    p.add_argument('--allow-download', action='store_true', help='fetch the stock base model from huggingface.co if it is not here yet')
    p.add_argument('--base', default=BASE_MODEL, help=f'the model to start from (default {BASE_MODEL})')
    p.add_argument('--epochs', type=float, default=EPOCHS)
    p.add_argument('--lr', type=float, default=LEARNING_RATE)
    p.add_argument('--batch', type=int, default=BATCH)
    p.add_argument('--warmup', type=int, default=WARMUP_STEPS)
    p.add_argument('--eval-every', type=int, default=EVAL_EVERY, help='steps between checks of the eval share')
    p.add_argument('--max-tokens', type=int, default=MAX_TOKENS)
    p.add_argument('--hold-back', type=float, default=HOLD_BACK_PCT, help='percent never trained on, for --score')
    p.add_argument('--eval-share', type=float, default=EVAL_PCT, help='percent never trained on, to pick the best checkpoint')
    p.add_argument('--train-decoder', action='store_true', help='also train the decoder (the notebook leaves it frozen)')
    p.add_argument('--no-train-encoder', action='store_true', help='leave the encoder frozen (the notebook trains it)')
    p.add_argument('--no-train-proj', action='store_true', help='leave the projection layer frozen (the notebook trains it)')
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--stock', default=STOCK_FOR_SCORE, help=f'--score: the stock model to compare with (default {STOCK_FOR_SCORE})')
    p.add_argument('--device', default='cpu', help="--score: 'cpu' (as the speech service) or 'cuda'")
    a = p.parse_args(argv)
    for name, lo, hi in (('hold_back', 1, 50), ('eval_share', 1, 50)):
        v = getattr(a, name)
        if not lo <= v <= hi:
            p.error(f'--{name.replace("_", "-")} is a percent from {lo} to {hi}')
    if a.hold_back + a.eval_share >= 90:
        p.error('--hold-back and --eval-share together must leave something to train on')
    for name in ('batch', 'warmup', 'eval_every', 'max_tokens'):
        if getattr(a, name) < (0 if name == 'warmup' else 1):
            p.error(f'--{name.replace("_", "-")} must be a positive whole number')
    if not a.check and not a.data:
        p.error('--data is needed: the folder you exported the recordings to')
    return a


# ---------------------------------------------------------------------------------------------------------------
# THE RECORDINGS
# ---------------------------------------------------------------------------------------------------------------
def find_data_folder(path):
    """(export folder, data folder) from what somebody typed: the export folder (data/ inside) or data/ itself."""
    p = Path(os.path.expanduser(str(path or ''))).resolve()
    if not p.is_dir():
        raise Refusal(f'There is no folder {p}. Give --data the folder you exported the recordings to.')
    if (p / DATA_NAME).is_dir():
        return p, p / DATA_NAME
    if any(c.is_dir() and c.name.isdigit() for c in p.iterdir()):
        return p.parent, p
    raise Refusal(f'{p} does not look like an export: it has no {DATA_NAME} folder and no numbered folders. '
                  'Export the recordings from the Voice model panel (step 2) and give that folder.')


def read_index(export_root):
    """nimrod-export.json, or None when there is none (an export from somewhere else) or it cannot be read."""
    f = Path(export_root) / INDEX_NAME
    try:
        j = json.loads(f.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None
    return j if isinstance(j, dict) and isinstance(j.get('samples'), list) else None


def wav_problem(path):
    """None when the file is what the recorder writes (16 kHz, mono, 16-bit, 0 < length <= 30 s), else why not."""
    try:
        with wave.open(str(path), 'rb') as w:
            rate, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
    except (OSError, wave.Error, EOFError) as e:
        return f'cannot be read as a WAV file ({e})'
    if ch != 1 or width != 2 or rate != SAMPLE_RATE:
        return f'is {rate} Hz, {ch} channel(s), {8 * width}-bit; the recorder writes {SAMPLE_RATE} Hz mono 16-bit'
    if n == 0:
        return 'is empty'
    if n / rate > MAX_CLIP_S:
        return f'is {n / rate:.0f} s long; Whisper hears {MAX_CLIP_S:.0f} s at a time'
    return None


def normalise_text(s):
    """For comparing words: lower case, curly quotes made straight, punctuation dropped (an apostrophe inside a word
    kept), spaces collapsed. Applied to BOTH sides of every word error rate here, so "Turn on the lights." and
    "turn on the lights" count as the same."""
    t = str(s or '').lower().replace('\u2019', "'").replace('\u2018', "'")
    t = re.sub(r"[^\w\s']", ' ', t)
    t = re.sub(r"(?<!\w)'|'(?!\w)", ' ', t)
    return ' '.join(t.split())


def list_clips(data_dir, index=None):
    """(clips, notes). A clip: {folder, audio, phrase, key, pair_id}. With an index (nimrod-export.json), the folders
    it lists are the recordings - another numbered folder (an older export's) is noted and left out; without one,
    every numbered folder, in number order. Anything unusable is left out and said, never trained on quietly."""
    data_dir = Path(data_dir)
    notes, clips = [], []
    numbered = sorted((c for c in data_dir.iterdir() if c.is_dir() and c.name.isdigit()), key=lambda c: int(c.name))
    if index is not None:
        wanted = [(str(s.get('folder', '')), s) for s in index.get('samples', []) if isinstance(s, dict)]
        listed = {f for f, _ in wanted}
        extra = [c.name for c in numbered if c.name not in listed]
        if extra:
            notes.append(f'{len(extra)} numbered folder(s) not in {INDEX_NAME} (an older export?) left out: '
                         + ', '.join(extra[:10]) + (' ...' if len(extra) > 10 else ''))
    else:
        wanted = [(c.name, {}) for c in numbered]
        nums = [int(c.name) for c in numbered]
        if nums and (nums != list(range(len(nums))) or any(c.name != str(int(c.name)) for c in numbered)):
            notes.append('the folders are not numbered 0, 1, 2, ... with no gaps: fine for this script, but '
                         "Euphonia's own notebook would stop on it")
    for folder, s in wanted:
        d = data_dir / folder
        audio, phrase_file = d / AUDIO_NAME, d / PHRASE_NAME
        if not d.is_dir() or not audio.is_file() or not phrase_file.is_file():
            notes.append(f'{DATA_NAME}/{folder}: left out, it has no {AUDIO_NAME if not audio.is_file() else PHRASE_NAME}')
            continue
        why = wav_problem(audio)
        if why:
            notes.append(f'{DATA_NAME}/{folder}: left out, its recording {why}')
            continue
        try:
            phrase = phrase_file.read_text(encoding='utf-8-sig').strip()
        except (OSError, UnicodeDecodeError) as e:
            notes.append(f'{DATA_NAME}/{folder}: left out, its {PHRASE_NAME} cannot be read ({e})')
            continue
        key = normalise_text(phrase)
        if not key:
            notes.append(f'{DATA_NAME}/{folder}: left out, its {PHRASE_NAME} has no words')
            continue
        clips.append({'folder': folder, 'audio': str(audio), 'phrase': phrase, 'key': key,
                      'pair_id': s.get('pairId') if isinstance(s, dict) else None})
    return clips, notes


# ---------------------------------------------------------------------------------------------------------------
# THE SPLIT: train / eval / held back, by a hash of the phrase (stable as recordings are added)
# ---------------------------------------------------------------------------------------------------------------
def bucket(key, salt=SPLIT_SALT):
    """A number in [0, 100) that depends only on the phrase (and the salt)."""
    h = hashlib.sha256(f'{salt}\n{key}'.encode('utf-8')).digest()
    return int.from_bytes(h[:8], 'big') / 2 ** 64 * 100


def side_of(key, hold_back=HOLD_BACK_PCT, eval_share=EVAL_PCT, salt=SPLIT_SALT):
    b = bucket(key, salt)
    return 'held_back' if b < hold_back else 'eval' if b < hold_back + eval_share else 'train'


def split_clips(clips, hold_back=HOLD_BACK_PCT, eval_share=EVAL_PCT, salt=SPLIT_SALT):
    out = {'train': [], 'eval': [], 'held_back': []}
    for c in clips:
        out[side_of(c['key'], hold_back, eval_share, salt)].append(c)
    return out


def split_problem(split):
    """Why this split cannot train (a side with nothing in it), or None."""
    empty = [k for k in ('train', 'eval', 'held_back') if not split[k]]
    if not empty:
        return None
    n = sum(len(v) for v in split.values())
    words = {'train': 'to train on', 'eval': 'to choose the best checkpoint with', 'held_back': 'to score with'}
    return (f'With {n} usable recording(s) there is nothing ' + ' and nothing '.join(words[k] for k in empty)
            + '. Record more (the phrase list is about 100), or change --hold-back / --eval-share.')


# ---------------------------------------------------------------------------------------------------------------
# WORD ERROR RATE (plain Python: the same count jiwer makes - substitutions, deletions and insertions over the
# reference's words - with no package for it)
# ---------------------------------------------------------------------------------------------------------------
def word_errors(reference, hypothesis):
    """(edits, words in the reference), after normalise_text on both."""
    r, h = normalise_text(reference).split(), normalise_text(hypothesis).split()
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hw in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw))
        prev = cur
    return prev[len(h)], len(r)


def corpus_wer(pairs):
    """Word error rate over (reference, hypothesis) pairs: all edits / all reference words. None with no words."""
    e = w = 0
    for ref, hyp in pairs:
        de, dw = word_errors(ref, hyp)
        e, w = e + de, w + dw
    return (e / w) if w else None


# ---------------------------------------------------------------------------------------------------------------
# WHERE THE MODEL GOES (the speech service's own places, in its own order)
# ---------------------------------------------------------------------------------------------------------------
def read_root_file(path):
    """The Nimrod folder from nimrod_folder.txt: its first line that is not blank or a # comment, quotes taken off
    - the speech service's own rule (__main__.py read_root_file; the test holds the two equal)."""
    try:
        with open(path, encoding='utf-8-sig') as f:
            text = f.read()
    except OSError:
        return None
    for line in text.splitlines():
        s = line.strip().strip('"').strip("'").strip()
        if s and not s.startswith('#'):
            return os.path.expanduser(s)
    return None


def output_folder(a, root_file=None, fallback=None):
    """(folder, how): --out; else "<Nimrod folder>/Voice model" from --root or nimrod_folder.txt; else the service's
    fallback speech_service/my_voice_model. how: 'out' | 'root' | 'file' | 'fallback'."""
    if a.out:
        return Path(os.path.expanduser(a.out)), 'out'
    if a.root:
        return Path(os.path.expanduser(a.root)) / VOICE_MODEL_SUBFOLDER, 'root'
    r = read_root_file(root_file or NIMROD_FOLDER_FILE)
    if r:
        return Path(r) / VOICE_MODEL_SUBFOLDER, 'file'
    return Path(fallback or MY_VOICE_DIR), 'fallback'


def holds_model(folder):
    return bool(folder) and any((Path(folder) / m).is_file() for m in MODEL_MARKERS)


def output_problem(folder, how, replace=False):
    """Why training must not start with this output folder (checked BEFORE an hour of training), or None."""
    folder = Path(folder)
    if how in ('root', 'file') and not folder.parent.is_dir():
        src = '--root' if how == 'root' else NIMROD_FOLDER_FILE
        return f'Your Nimrod folder {folder.parent} (from {src}) does not exist. Check the path.'
    if folder.exists() and not folder.is_dir():
        return f'{folder} is a file, not a folder.'
    if holds_model(folder) and not replace:
        return (f'{folder} already holds a voice model. It may be the better one: score it first (--score), or add '
                '--replace to move it aside (nothing is deleted) and put the new one in.')
    return None


def work_folder(a, export_root):
    return Path(os.path.expanduser(a.work)) if a.work else Path(export_root) / WORK_NAME


# ---------------------------------------------------------------------------------------------------------------
# THE TRAINING SETTINGS, from what the installed transformers accepts (fix 3: eval_strategy or evaluation_strategy)
# ---------------------------------------------------------------------------------------------------------------
def accepted_names(cls):
    try:
        return set(inspect.signature(cls).parameters)
    except (TypeError, ValueError):
        return set()


def training_kwargs(names, a, device, work):
    """Seq2SeqTrainingArguments keywords for this run, using only names `names` (the installed class's) accepts."""
    kw = {
        'output_dir': str(Path(work) / 'checkpoints'),
        'per_device_train_batch_size': a.batch, 'per_device_eval_batch_size': a.batch,
        'learning_rate': a.lr, 'warmup_steps': a.warmup, 'num_train_epochs': a.epochs,
        'gradient_checkpointing': True, 'fp16': device == 'cuda',
        'save_strategy': 'steps', 'eval_steps': a.eval_every, 'save_steps': a.eval_every, 'logging_steps': a.eval_every,
        'predict_with_generate': True, 'generation_max_length': a.max_tokens,
        'load_best_model_at_end': True, 'metric_for_best_model': 'wer', 'greater_is_better': False,
        'save_total_limit': 2, 'report_to': [], 'remove_unused_columns': False, 'seed': a.seed,
        'dataloader_num_workers': 0,
        # Not in the notebook, argued: checkpoints without the optimiser's state are about half the size, and
        # nothing here resumes a run. Used where the installed version has it.
        'save_only_model': True,
        'gradient_checkpointing_kwargs': {'use_reentrant': False},
    }
    kw['eval_strategy' if 'eval_strategy' in names else 'evaluation_strategy'] = 'steps'
    if device == 'cpu':
        kw['use_cpu' if 'use_cpu' in names else 'no_cuda'] = True
    return {k: v for k, v in kw.items() if not names or k in names}


# ---------------------------------------------------------------------------------------------------------------
# WHAT IS INSTALLED (--check). Version numbers come from the installed packages' metadata: nothing is imported but
# torch, and torch only to ask whether it can see a graphics card.
# ---------------------------------------------------------------------------------------------------------------
def installed_version(name):
    from importlib import metadata
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def missing_packages(version_of=installed_version, pins=PINNED):
    return [name for name, _v, _why in pins if not version_of(name)]


def hf_cache_dir(env=None):
    env = os.environ if env is None else env
    if env.get('HF_HUB_CACHE'):
        return Path(env['HF_HUB_CACHE'])
    if env.get('HF_HOME'):
        return Path(env['HF_HOME']) / 'hub'
    return Path(os.path.expanduser('~')) / '.cache' / 'huggingface' / 'hub'


def model_in_cache(model_id, env=None):
    """Whether a Hugging Face model is already on this computer (a snapshot with its config), by looking only."""
    snaps = hf_cache_dir(env) / ('models--' + model_id.replace('/', '--')) / 'snapshots'
    try:
        return any((s / 'config.json').exists() for s in snaps.iterdir())
    except OSError:
        return False


def install_lines(missing):
    """The commands to show (never run) when something is missing: a NEW environment with every training pin (a
    fresh environment has none of them, whatever this one has)."""
    if not missing:
        return []
    py = '"%USERPROFILE%\\nimrod-voice-train\\Scripts\\python"'
    pins = dict((n, v) for n, v, _w in PINNED)
    return ['py -3.13 -m venv "%USERPROFILE%\\nimrod-voice-train"',
            f'{py} -m pip install torch=={pins["torch"]} --index-url {TORCH_INDEX}',
            f'{py} -m pip install ' + ' '.join(f'{n}=={v}' for n, v in pins.items() if n != 'torch')]


def same_version(found, pinned):
    return bool(found) and found.split('+')[0] == pinned


def check_report(version_of=installed_version, gpu=None, base=BASE_MODEL, env=None, out=None, data=None):
    """(lines, ready). `gpu`: None (torch absent), or {'cuda': bool, 'name': str, 'gb': float}."""
    lines = [f'Python {sys.version.split()[0]}']
    for title, pins in (('Training', PINNED), ('Scoring', SCORE_PINNED)):
        lines.append(f'{title} packages:')
        for name, v, why in pins:
            found = version_of(name)
            state = ('ok' if same_version(found, v) else f'found {found}, pinned {v}: different, untested'
                     if found else f'MISSING (pinned {v})')
            lines.append(f'  {name:15} {state}   - {why}')
    missing = missing_packages(version_of)
    if gpu is None:
        lines.append('Graphics card: unknown until torch is installed.')
    elif gpu.get('cuda'):
        gb = gpu.get('gb') or 0
        lines.append(f'Graphics card: {gpu.get("name")}, {gb:.0f} GB.'
                     + ('' if gb >= 8 else ' Under the ~8 GB whisper-small wants [estimate]: it may run out of memory.'))
    else:
        lines.append('Graphics card: none that torch can use. Training would need --cpu (hours).')
    lines.append(f'Base model {base}: ' + ('on this computer.' if model_in_cache(base, env) else
                 'NOT on this computer yet (about 1 GB from huggingface.co: the first run needs --allow-download).'))
    lines.append(f'Stock model for --score ({STOCK_FOR_SCORE}): ' + (
        'on this computer.' if model_in_cache(f'Systran/faster-whisper-{STOCK_FOR_SCORE}', env) else
        'not found in the Hugging Face cache (the speech service fetches it once, the same way).'))
    if out is not None:
        lines.append(f'The voice model would go in: {out[0]} ({out[1]})')
    if data is not None:
        lines.append(data)
    if missing:
        lines.append('Missing. To install them, AFTER they are approved (this script installs nothing), in their own '
                     'environment so the speech service\'s packages are not changed:')
        lines += ['    ' + x for x in install_lines(missing)]
        lines.append('  then run this script with that python.')
    return lines, not missing


def probe_gpu():
    """{'cuda', 'name', 'gb'} from torch, or None when torch is not installed. Imports torch: --check only."""
    if not installed_version('torch'):
        return None
    try:
        import torch  # noqa: WPS433 (on purpose, here only)
    except Exception:  # noqa: BLE001 - a broken install is reported as "unknown"
        return None
    if not torch.cuda.is_available():
        return {'cuda': False}
    props = torch.cuda.get_device_properties(0)
    return {'cuda': True, 'name': props.name, 'gb': props.total_memory / 1024 ** 3}


# ---------------------------------------------------------------------------------------------------------------
# THE DEVICE: a graphics card, or the processor only when asked
# ---------------------------------------------------------------------------------------------------------------
def pick_device(a, torch_module):
    """'cuda', or 'cpu' with --cpu. Without a card and without --cpu: Refusal (hours of processor is a choice)."""
    if torch_module.cuda.is_available():
        return 'cuda'
    if a.cpu:
        return 'cpu'
    raise Refusal('No NVIDIA graphics card that PyTorch can use was found. Training on the processor alone takes '
                  'hours (very roughly an hour or more for 100 recordings; unmeasured). Run it on the computer with '
                  'the graphics card, or add --cpu to do it here anyway.')


# ---------------------------------------------------------------------------------------------------------------
# PRINTING
# ---------------------------------------------------------------------------------------------------------------
def say(*parts):
    print(*parts, flush=True)


def describe_plan(clips, notes, split, out, work, a):
    n = len(clips)
    lines = [f'Recordings: {n} usable.']
    lines += [f'  note: {x}' for x in notes]
    lines.append(f'Split by phrase (stable as you record more): {len(split["train"])} to train on, '
                 f'{len(split["eval"])} to choose the best checkpoint, {len(split["held_back"])} held back for --score '
                 '(never trained on).')
    if n < FEW_CLIPS:
        lines.append(f'  Fewer than {FEW_CLIPS}: it will run, but expect little or no gain. Google\'s research models '
                     'used 300 or more.')
    lines.append(f'Base model: {a.base}' + (' (English only: no language or task is set)' if a.base.endswith('.en') else ''))
    lines.append(f'Trains: encoder {"yes" if not a.no_train_encoder else "no"}, projection layer '
                 f'{"yes" if not a.no_train_proj else "no"}, decoder {"yes" if a.train_decoder else "no"}; '
                 f'{a.epochs:g} epochs, learning rate {a.lr:g}, batch {a.batch}, warm-up {a.warmup}, '
                 f'checked every {a.eval_every} steps.')
    lines.append(f'The voice model goes in: {out[0]} ({out[1]})')
    lines.append(f'Work folder (deleted afterwards unless --keep-work): {work}')
    return lines


# ---------------------------------------------------------------------------------------------------------------
# TRAINING (the heavy part: every ML import is inside)
# ---------------------------------------------------------------------------------------------------------------
def read_pcm(path):
    with wave.open(str(path), 'rb') as w:
        return w.readframes(w.getnframes())


def set_trainable(model, encoder=True, decoder=False, proj=True):
    """The notebook's three switches, in its order. NOTE [training knowledge]: Whisper's projection layer shares its
    weights with the decoder's word embeddings, so "projection on, decoder off" leaves exactly those embeddings
    trainable, as in the notebook."""
    for p in model.model.encoder.parameters():
        p.requires_grad = encoder
    for p in model.model.decoder.parameters():
        p.requires_grad = decoder
    for p in model.proj_out.parameters():
        p.requires_grad = proj


def train(a, split, work, device, torch):
    import numpy as np
    from transformers import (Seq2SeqTrainer, Seq2SeqTrainingArguments, WhisperForConditionalGeneration,
                              WhisperProcessor, WhisperTokenizerFast)

    local_only = not a.allow_download
    try:
        processor = WhisperProcessor.from_pretrained(a.base, local_files_only=local_only)
        model = WhisperForConditionalGeneration.from_pretrained(a.base, local_files_only=local_only)
    except OSError as e:
        if local_only:
            raise Refusal(f'The base model {a.base} is not on this computer yet. Run again with --allow-download to '
                          'fetch it once (about 1 GB, the stock model only; nothing of yours is sent).') from e
        raise
    english_only = a.base.endswith('.en')
    if not english_only:
        processor.tokenizer.set_prefix_tokens(language='english', task='transcribe')
        model.generation_config.language = 'en'
        model.generation_config.task = 'transcribe'
    model.config.use_cache = False
    set_trainable(model, encoder=not a.no_train_encoder, decoder=a.train_decoder, proj=not a.no_train_proj)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    say(f'Training {trainable / 1e6:.0f} million of the model\'s {sum(p.numel() for p in model.parameters()) / 1e6:.0f} '
        'million numbers.')

    class Clips(torch.utils.data.Dataset):
        def __init__(self, clips):
            self.clips = clips

        def __len__(self):
            return len(self.clips)

        def __getitem__(self, i):
            c = self.clips[i]
            audio = np.frombuffer(read_pcm(c['audio']), dtype='<i2').astype(np.float32) / 32768.0
            feats = processor.feature_extractor(audio, sampling_rate=SAMPLE_RATE).input_features[0]
            return {'input_features': feats, 'labels': processor.tokenizer(c['phrase']).input_ids}

    start_id = model.config.decoder_start_token_id

    def collate(items):
        batch = processor.feature_extractor.pad([{'input_features': x['input_features']} for x in items],
                                                return_tensors='pt')
        lab = processor.tokenizer.pad([{'input_ids': x['labels']} for x in items], return_tensors='pt')
        labels = lab['input_ids'].masked_fill(lab['attention_mask'].ne(1), -100)
        if bool((labels[:, 0] == start_id).all()):
            labels = labels[:, 1:]            # the model adds the start token itself
        batch['labels'] = labels
        return batch

    pad_id = processor.tokenizer.pad_token_id

    def compute_metrics(pred):
        ids = pred.predictions[0] if isinstance(pred.predictions, tuple) else pred.predictions
        ids = np.where(ids == -100, pad_id, ids)
        lab = np.where(pred.label_ids == -100, pad_id, pred.label_ids)
        got = processor.tokenizer.batch_decode(ids, skip_special_tokens=True)
        want = processor.tokenizer.batch_decode(lab, skip_special_tokens=True)
        return {'wer': corpus_wer(zip(want, got)) or 0.0}

    targs = Seq2SeqTrainingArguments(**training_kwargs(accepted_names(Seq2SeqTrainingArguments), a, device, work))
    trainer = Seq2SeqTrainer(model=model, args=targs, train_dataset=Clips(split['train']),
                             eval_dataset=Clips(split['eval']), data_collator=collate, compute_metrics=compute_metrics)
    trainer.train()
    best = trainer.state.best_metric

    # Fixes 1 and 2: saved properly, the processor BESIDE the model, so the converter finds the tokenizer files.
    trained = Path(work) / 'trained'
    trainer.save_model(str(trained))
    processor.save_pretrained(str(trained))
    if not (trained / 'tokenizer.json').is_file():
        WhisperTokenizerFast.from_pretrained(str(trained)).save_pretrained(str(trained))
    return trained, best


def convert(trained, out_folder, replace):
    """The CTranslate2 int8 conversion (the speech service's format), written beside the target first and moved in
    only when the service's own check passes - so a failed conversion never leaves a half folder in its place."""
    from ctranslate2.converters import TransformersConverter
    from speech_service.backends import check_whisper_folder

    out_folder = Path(out_folder)
    staging = out_folder.parent / f'{out_folder.name} (converting)'
    if staging.exists():
        shutil.rmtree(staging)                 # this script's own leftover from an interrupted run
    TransformersConverter(str(trained), copy_files=['tokenizer.json', 'preprocessor_config.json']).convert(
        str(staging), quantization='int8')
    check_whisper_folder(str(staging))
    out_folder.mkdir(parents=True, exist_ok=True)
    if holds_model(out_folder):
        if not replace:
            raise Refusal(f'{out_folder} gained a model while this ran. The new one is in {staging}.')
        aside = out_folder.parent / f'{out_folder.name} (replaced {time.strftime("%Y%m%d-%H%M%S")})'
        aside.mkdir()
        for f in out_folder.iterdir():
            if f.name.lower() != 'readme.txt':
                shutil.move(str(f), str(aside / f.name))
        say(f'The model that was there is now in {aside} (nothing deleted).')
    for f in staging.iterdir():
        shutil.move(str(f), str(out_folder / f.name))
    staging.rmdir()
    return out_folder


def write_record(out_folder, a, split, best, device, versions):
    rec = {
        'kind': 'nimrod-voice-model', 'v': 1, 'made': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'method': 'Project Euphonia notebook, run at home (web/tools/train_my_voice.py)',
        'base': a.base, 'device': device,
        'trained': {'encoder': not a.no_train_encoder, 'proj': not a.no_train_proj, 'decoder': a.train_decoder},
        'settings': {'epochs': a.epochs, 'lr': a.lr, 'batch': a.batch, 'warmup': a.warmup, 'eval_every': a.eval_every,
                     'max_tokens': a.max_tokens},
        'split': {'by': 'phrase', 'salt': SPLIT_SALT, 'hold_back': a.hold_back, 'eval_share': a.eval_share,
                  'counts': {k: len(v) for k, v in split.items()},
                  # Which recordings were held back: folder numbers and recording ids, no words.
                  'held_back': [{'folder': c['folder'], 'pairId': c['pair_id']} for c in split['held_back']]},
        'best_eval_wer': best, 'packages': versions,
    }
    (Path(out_folder) / TRAINING_RECORD).write_text(json.dumps(rec, indent=2), encoding='utf-8')


# ---------------------------------------------------------------------------------------------------------------
# SCORING (--score): the stock model and yours, decoded exactly as the speech service decodes
# ---------------------------------------------------------------------------------------------------------------
def read_record(folder):
    try:
        return json.loads((Path(folder) / TRAINING_RECORD).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def score_settings(a, record):
    """(hold_back, eval_share, salt, said): the split the model was trained with when its record says, else the
    command line's (and a sentence saying it cannot know what that model was trained on)."""
    sp = (record or {}).get('split') or {}
    if sp.get('salt') and sp.get('hold_back') is not None:
        return float(sp['hold_back']), float(sp.get('eval_share', a.eval_share)), sp['salt'], ''
    return a.hold_back, a.eval_share, SPLIT_SALT, (
        f'This model has no {TRAINING_RECORD} (made some other way?): the held-back set is this script\'s own split, '
        'and nothing here can tell whether that model was trained on some of it.')


def verdict(stock, mine):
    if stock is None or mine is None:
        return 'No words to score.'
    if mine < stock:
        return (f'Yours made {100 * (stock - mine) / stock:.0f}% fewer word errors than the stock model on recordings '
                'it never trained on. Keep it.' if stock else 'Both perfect: keep either.')
    if mine == stock:
        return 'No better than the stock model on these recordings. Keep using the standard one.'
    return 'Worse than the stock model on these recordings. Keep using the standard one.'


def score(a, out):
    export_root, data_dir = find_data_folder(a.data)
    clips, notes = list_clips(data_dir, read_index(export_root))
    folder = out[0]
    record = read_record(folder)
    hb, ev, salt, said = score_settings(a, record)
    held = split_clips(clips, hb, ev, salt)['held_back']
    for x in notes:
        say(f'note: {x}')
    if said:
        say(said)
    if not held:
        raise Refusal('No held-back recordings to score with. Record more phrases and export again.')
    if not installed_version('faster-whisper'):
        raise Refusal("--score needs faster-whisper, which the speech service uses: run it with the desktop's own "
                      'py -3.13, where the speech service runs.')
    from speech_service.backends import ModelFolderError, WhisperBackend, check_whisper_folder
    try:
        check_whisper_folder(str(folder))
    except ModelFolderError as e:
        raise Refusal(f'Your voice model cannot be scored: {e}') from e
    say(f'Scoring {len(held)} held-back recording(s): stock {a.stock} against {folder} ...')
    try:
        # The service's own decoding (VAD, beam 5, temperature 0), and its refusal to download anything.
        stock = WhisperBackend(model=a.stock, device=a.device, word_confidence=False)
    except Exception as e:  # noqa: BLE001 - said in words, whatever faster-whisper raised
        raise Refusal(f'The stock model {a.stock} could not be loaded ({e}). It is the one the speech service runs: '
                      'start the speech service once on this computer, then score again.') from e
    mine = WhisperBackend(model=str(folder), device=a.device, word_confidence=False)
    rows, s_pairs, m_pairs = [], [], []
    for c in held:
        pcm = read_pcm(c['audio'])
        s_text, m_text = stock.transcribe(pcm)['text'], mine.transcribe(pcm)['text']
        s_pairs.append((c['phrase'], s_text))
        m_pairs.append((c['phrase'], m_text))
        rows.append((c['folder'], word_errors(c['phrase'], s_text)[0], word_errors(c['phrase'], m_text)[0],
                     c['phrase'], s_text, m_text))
    say(f'{"folder":>6}  {"stock":>5}  {"yours":>5}  said / stock heard / yours heard')
    for f, se, me, ref, st, mt in rows:
        say(f'{f:>6}  {se:>5}  {me:>5}  {ref}\n{"":>22}{st}\n{"":>22}{mt}')
    s_wer, m_wer = corpus_wer(s_pairs), corpus_wer(m_pairs)
    fmt = lambda w: 'n/a' if w is None else f'{100 * w:.1f}%'  # noqa: E731
    say(f'Word error rate: stock {fmt(s_wer)}, yours {fmt(m_wer)} ({len(held)} recordings).')
    say(verdict(s_wer, m_wer))
    if len(held) < 30:
        say(f'Only {len(held)} recordings: a difference of a word or two is luck. More recordings make this surer.')
    return EXIT_OK


# ---------------------------------------------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------------------------------------------
def main(argv=None, version_of=installed_version):
    try:
        sys.stdout.reconfigure(errors='replace')     # a phrase's curly quote must not crash a Windows console
    except (AttributeError, ValueError):
        pass
    a = parse_args(argv)
    out = output_folder(a)
    try:
        if a.check:
            data_line = None
            if a.data:
                er, dd = find_data_folder(a.data)
                clips, notes = list_clips(dd, read_index(er))
                data_line = f'Recordings in {dd}: {len(clips)} usable' + (f', {len(notes)} note(s) (see --dry-run)' if notes else '')
            lines, ready = check_report(version_of, probe_gpu() if version_of is installed_version else None,
                                        base=a.base, out=out, data=data_line)
            for x in lines:
                say(x)
            return EXIT_OK if ready else EXIT_MISSING
        if a.score:
            return score(a, out)

        export_root, data_dir = find_data_folder(a.data)
        clips, notes = list_clips(data_dir, read_index(export_root))
        split = split_clips(clips, a.hold_back, a.eval_share)
        work = work_folder(a, export_root)
        for x in describe_plan(clips, notes, split, out, work, a):
            say(x)
        why = split_problem(split) or output_problem(out[0], out[1], a.replace)
        if why:
            raise Refusal(why)
        if a.dry_run:
            say('Dry run: nothing loaded, nothing written.')
            return EXIT_OK
        missing = missing_packages(version_of)
        if missing:
            say('Missing: ' + ', '.join(missing) + '. `--check` lists them with the lines to install them (after '
                'they are approved; this script installs nothing).')
            return EXIT_MISSING
        import torch  # noqa: WPS433 - the first heavy import, after every check that needs none
        device = pick_device(a, torch)
        if device == 'cpu':
            say('Training on the processor (--cpu). This takes hours; leave the window open.')
        work.mkdir(parents=True, exist_ok=True)
        free_gb = shutil.disk_usage(work).free / 1024 ** 3
        if free_gb < WORK_SPACE_GB:
            say(f'WARNING: {free_gb:.1f} GB free where the work goes ({work}); it may need about {WORK_SPACE_GB} GB. '
                '--work names somewhere else.')
        torch.manual_seed(a.seed)
        try:
            trained, best = train(a, split, work, device, torch)
            say('Converting for the speech service (int8) ...')
            folder = convert(trained, out[0], a.replace)
            versions = {n: version_of(n) for n, _v, _w in PINNED}
            write_record(folder, a, split, best, device, versions)
        except BaseException:
            if work.is_dir() and any(work.iterdir()):
                say(f'Stopped. The work folder is kept: {work}. It may hold a copy of the voice in model form; delete '
                    'it when you are done with it.')
            raise
        if not a.keep_work:
            shutil.rmtree(work, ignore_errors=True)
        say(f'Done. Your voice model is in {folder}.')
        say('Next: score it against the stock model, on recordings it never trained on (run where the speech '
            'service runs):')
        say(f'    py -3.13 tools/train_my_voice.py --score --data "{export_root}"'
            + (f' --out "{folder}"' if out[1] in ('out', 'fallback') else f' --root "{folder.parent}"'))
        say('Then start it: py -3.13 -m speech_service --my-voice' + ('' if out[1] in ('out', 'fallback') else
            f' --root "{folder.parent}"') + ', and turn on "Use my own voice model".')
        return EXIT_OK
    except Refusal as e:
        say(str(e))
        return EXIT_REFUSED


if __name__ == '__main__':
    sys.exit(main())
