#!/usr/bin/env python3
"""make_board_clips.py - a recording for every word on the built-in AAC boards, in the board's one voice (row 2.234).

Mike, 2026-11-06: *"It would be nice to have the default AAC board ones just have recordings on them."* The board already
plays a word's recording first and the screen's voice second (board_sounds.js clipChoices), but only 17 words had one. This
makes the rest, in THE SAME VOICE as those 17 (web/client/aac/audio/README.md): Piper, en_US-libritts-high, speaker 552,
mono 22050 Hz 16-bit WAV, the spoken text with a full stop ("Okay."), as Cici/tools/gen_aac_voice.py made them. One model
load for the lot (that tool started Piper once per word).

    py -3.13 web/tools/make_board_clips.py --model <your piper folder>/en_US-libritts-high.onnx

The words: every card on aac_vocab.js's built-in boards (YESNO to MEALS: the text a card says, `say` or else `word`), and
EXTRA below, the words Nimrod's own pictures are drawn for that no built-in board has yet, so a person who adds one hears the
same voice. A file already there is never made again (`--force` remakes). File names follow aac_clips.js clipSlug.
Needs the piper-tts package. Nothing is downloaded. Tested: tools/test_make_board_clips.py.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import wave
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
VOCAB = WEB / 'client' / 'aac_vocab.js'
OUT = WEB / 'client' / 'aac' / 'audio'
SPEAKER = 552
# The pictures (aac_themed.js ROLES, aac_symbols.js) whose word is on no built-in board: the nine plain ones and the six
# seasonal ones, said as a card would say them.
EXTRA = ['Bad', 'Bye', 'Come', 'Dad', 'Mom', 'Music', 'Please', 'Suction', 'Rephrase',
         'Bat', 'Candy', 'Ghost', 'Pumpkin', 'Treat pail', 'Witch hat']


def clip_slug(text: str) -> str:
    """aac_clips.js clipSlug: lower case, every run of anything else one underscore."""
    return re.sub(r'^_+|_+$', '', re.sub(r'[^a-z0-9]+', '_', str(text).lower().strip()))


def board_words(src: str) -> dict[str, list[str]]:
    """{board constant: [spoken text]} for the boards between YESNO and BUILTIN_BOARDS in aac_vocab.js."""
    body = src[src.index('export const YESNO'):src.index('export const BUILTIN_BOARDS')]
    boards, cur = {}, None
    for line in body.splitlines():
        m = re.match(r'export const (\w+) = \{', line)
        if m:
            cur = m.group(1)
            boards[cur] = []
            continue
        w = re.search(r"\bword:\s*'((?:[^'\\]|\\.)*)'", line) if cur else None
        if w:
            s = re.search(r"\bsay:\s*'((?:[^'\\]|\\.)*)'", line)
            boards[cur].append((s or w).group(1).replace("\\'", "'"))
    return boards


def wanted(src: str, extra=EXTRA) -> dict[str, str]:
    """{slug: spoken text}, every board word then the extras, first spelling kept."""
    out = {}
    for words in board_words(src).values():
        for t in words:
            out.setdefault(clip_slug(t), t)
    for t in extra:
        out.setdefault(clip_slug(t), t)
    return out


def spoken(text: str) -> str:
    """The text Piper is given: a full stop at the end, as the first 17 were made ("Okay.")."""
    t = text.strip()
    return t if t[-1:] in '.!?' else t + '.'


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--model', required=True, help='en_US-libritts-high.onnx (its .onnx.json beside it)')
    ap.add_argument('--speaker', type=int, default=SPEAKER)
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--force', action='store_true', help='make again the files already there')
    ap.add_argument('--list', action='store_true', help='only say which would be made')
    a = ap.parse_args(argv)
    words = wanted(VOCAB.read_text(encoding='utf-8'))
    out = Path(a.out)
    todo = {s: t for s, t in words.items() if a.force or not (out / f'{s}.wav').exists()}
    print(f'{len(words)} words, {len(words) - len(todo)} already recorded, {len(todo)} to make')
    if a.list or not todo:
        for s, t in todo.items():
            print(f'  {s}.wav  {spoken(t)!r}')
        return 0
    if not Path(a.model).is_file():
        print(f'no voice model at {a.model}', file=sys.stderr)
        return 2
    from piper import PiperVoice
    try:
        from piper import SynthesisConfig
    except ImportError:
        SynthesisConfig = None
    voice = PiperVoice.load(a.model)
    out.mkdir(parents=True, exist_ok=True)
    for s, t in todo.items():
        path = out / f'{s}.wav'
        tmp = path.with_suffix('.wav.part')
        with wave.open(str(tmp), 'wb') as w:
            if SynthesisConfig is not None:
                voice.synthesize_wav(spoken(t), w, syn_config=SynthesisConfig(speaker_id=a.speaker))
            else:
                voice.synthesize(spoken(t), w, speaker_id=a.speaker)
        os.replace(tmp, path)
        print(f'  {path.name:<16} {path.stat().st_size:>6} bytes  {spoken(t)!r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
