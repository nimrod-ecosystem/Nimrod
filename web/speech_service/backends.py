"""backends.py - the recognisers behind the one protocol.

Each backend makes one `Utterance` per thing somebody said. The service feeds it 16 kHz mono
16-bit little-endian PCM and asks it to finish; nothing else about a backend is visible outside
this file, which is what lets the Pi (Vosk) and a desktop or a GPU box (faster-whisper) answer
the screen in exactly the same words.

    backend.name               e.g. 'whisper:small.en', 'vosk:vosk-model-small-en-us-0.15'
    backend.supports_grammar   True when a word list limits what it can hear (Vosk)
    backend.open(grammar)      -> Utterance; grammar is a list of phrases or None (open)
    utt.feed(pcm) -> str|None  a partial transcript when the backend has one, else None
    utt.finish() -> dict       { text, confidence (0..1 or None), words: [{w, conf}] }

`finish()` may be slow (Whisper: ~2 s on the desktop, row 2.28) and is run off the event loop by
the service. Imports of the heavy libraries happen inside the constructors, so the protocol tests
and the fake backend run on a machine with neither installed.
"""
from __future__ import annotations

import json
import math
import os
import threading
from typing import Iterable

SAMPLE_RATE = 16000


def _clip01(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return max(0.0, min(1.0, v))


def _mean(xs: Iterable[float]):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


# ---------------------------------------------------------------------------------------------
# faster-whisper (the desktop now; Oscar's GPU box when it is free)
# ---------------------------------------------------------------------------------------------
def default_threads() -> int:
    """Physical cores, guessed as half the logical ones.

    Measured 2026-09-30 on the i5-10400 (whisper_desktop_measure_20260930.md): 6 threads (= its
    physical cores) 2.03 s median; the library default 3.01 s; 12 (hyperthreads) 2.42 s. So the
    default is the physical count, and `--threads` overrides it on a machine where halving is
    wrong (no hyperthreading: pass the core count).
    """
    return max(1, (os.cpu_count() or 2) // 2)


class WhisperBackend:
    supports_grammar = False
    partials = False

    def __init__(self, model: str = 'small.en', device: str = 'cpu', compute_type: str = 'int8',
                 threads: int | None = None, beam_size: int = 5, word_confidence: bool = True,
                 local_only: bool = True):
        # Every default here is the measured recommendation (whisper_desktop_measure_20260930.md):
        # small.en int8, VAD on (it stopped every hallucination on silence/noise/music), temperature
        # 0 (caps the worst case at ~4 s instead of 8-10 s), NO command prompt (it pulled silence and
        # "pie" onto command words). `local_only` refuses to download: a model not already on the
        # machine is an error to report, not a fetch.
        from faster_whisper import WhisperModel  # noqa: WPS433 (heavy import, on purpose here)
        self.model_name = model
        self.name = f'whisper:{model}'
        self.beam_size = int(beam_size)
        self.word_confidence = bool(word_confidence)
        self._model = WhisperModel(model, device=device, compute_type=compute_type,
                                   cpu_threads=int(threads or default_threads()),
                                   local_files_only=bool(local_only))
        # One decode at a time: two at once on one CPU is slower for both, and the second utterance
        # is the later one anyway.
        self._lock = threading.Lock()

    def open(self, grammar=None):
        return _WhisperUtterance(self)

    def transcribe(self, pcm: bytes) -> dict:
        import numpy as np
        audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
        if audio.size == 0:
            return {'text': '', 'confidence': None, 'words': []}
        with self._lock:
            segments, _info = self._model.transcribe(
                audio, language='en', beam_size=self.beam_size, vad_filter=True, temperature=0.0,
                condition_on_previous_text=False, word_timestamps=self.word_confidence)
            segs = list(segments)
        text = ' '.join(s.text.strip() for s in segs).strip()
        words = []
        for s in segs:
            for w in (getattr(s, 'words', None) or []):
                ww = (w.word or '').strip()
                if ww:
                    words.append({'w': ww, 'conf': _clip01(w.probability)})
        # CONFIDENCE: the mean of the words' probabilities when there are words (what the screen
        # marks word by word), else exp(average log-probability) of the segments. Neither is a
        # calibrated probability [training knowledge]; it is "how sure", compared against the
        # person's own threshold, and measured in the report rather than assumed.
        conf = _mean(w['conf'] for w in words)
        if conf is None and segs:
            conf = _clip01(math.exp(_mean(s.avg_logprob for s in segs) or -10))
        return {'text': text, 'confidence': conf if text else None, 'words': words}


class _WhisperUtterance:
    def __init__(self, backend: WhisperBackend):
        self.b = backend
        self.buf = bytearray()

    def feed(self, pcm: bytes):
        self.buf.extend(pcm)
        return None          # no partials: Whisper encodes a fixed 30 s window, a re-run per chunk costs ~2 s each

    def finish(self) -> dict:
        return self.b.transcribe(bytes(self.buf))


# ---------------------------------------------------------------------------------------------
# Vosk (the Pi: row 2.28 measured it at ~35 ms per answer on a Pi 400)
# ---------------------------------------------------------------------------------------------
class VoskBackend:
    supports_grammar = True
    partials = True

    def __init__(self, model_path: str):
        import vosk  # noqa: WPS433
        vosk.SetLogLevel(-1)
        self._vosk = vosk
        self.model_path = model_path
        self.name = f'vosk:{os.path.basename(os.path.normpath(model_path))}'
        self._model = vosk.Model(model_path)

    def open(self, grammar=None):
        if grammar:
            # [unk] always: row 2.28 found a grammar with no way out ALWAYS hears one of its phrases.
            g = list(dict.fromkeys([*grammar, '[unk]']))
            rec = self._vosk.KaldiRecognizer(self._model, SAMPLE_RATE, json.dumps(g))
        else:
            rec = self._vosk.KaldiRecognizer(self._model, SAMPLE_RATE)
        rec.SetWords(True)
        return _VoskUtterance(rec)


class _VoskUtterance:
    def __init__(self, rec):
        self.rec = rec
        self.last_partial = ''
        self.done = []          # results Vosk finalised on its own mid-utterance (a long pause inside)

    def feed(self, pcm: bytes):
        if self.rec.AcceptWaveform(pcm):
            self.done.append(json.loads(self.rec.Result() or '{}'))
            self.last_partial = ''
            return self._joined_text()
        p = json.loads(self.rec.PartialResult() or '{}').get('partial', '')
        if p and p != self.last_partial:
            self.last_partial = p
            return ' '.join(x for x in (self._joined_text(), p) if x)
        return None

    def _joined_text(self):
        return ' '.join(r.get('text', '') for r in self.done if r.get('text')).strip()

    def finish(self) -> dict:
        self.done.append(json.loads(self.rec.FinalResult() or '{}'))
        words = []
        for r in self.done:
            for w in r.get('result', []) or []:
                if w.get('word'):
                    words.append({'w': w['word'], 'conf': _clip01(w.get('conf'))})
        text = self._joined_text()
        # Vosk's per-word `conf` is a posterior [training knowledge]; with a grammar it is often 1.0
        # even when wrong (row 2.28: "hello there" -> "louder" at 1.0), which is why a grammar is an
        # option and not the default.
        return {'text': text, 'confidence': _mean(w['conf'] for w in words) if text else None,
                'words': words}


# ---------------------------------------------------------------------------------------------
# A fake, for the protocol tests and for a screen being built without a model
# ---------------------------------------------------------------------------------------------
class FakeBackend:
    """Answers from a script instead of a model. `script` is a list of texts (or dicts with text /
    confidence / words), used in order and then repeated from the end; or a callable taking the
    utterance's PCM bytes. Nothing is ever heard - it exists so the protocol can be tested anywhere."""

    def __init__(self, script=None, name: str = 'fake', supports_grammar: bool = True,
                 partials: bool = True, delay_s: float = 0.0):
        self.name = name
        self.supports_grammar = supports_grammar
        self.partials = partials
        self.delay_s = float(delay_s)
        self.grammars = []
        self._script = script if script is not None else ['hello']
        self._i = 0

    def _next(self, pcm: bytes, grammar):
        r = self._script(pcm, grammar)
        if isinstance(r, str):
            words = [{'w': w, 'conf': 0.9} for w in r.split()]
            r = {'text': r, 'confidence': 0.9 if r else None, 'words': words}
        return r

    def open(self, grammar=None):
        self.grammars.append(list(grammar) if grammar else None)
        return _FakeUtterance(self, grammar, self._i)

    def _pick(self, pcm: bytes, grammar, i: int):
        if callable(self._script):
            return self._next(pcm, grammar)
        s = list(self._script)
        r = s[min(i, len(s) - 1)] if s else ''
        if isinstance(r, str):
            words = [{'w': w, 'conf': 0.9} for w in r.split()]
            r = {'text': r, 'confidence': 0.9 if r else None, 'words': words}
        return r


class _FakeUtterance:
    def __init__(self, b: FakeBackend, grammar, index: int = 0):
        # The script entry is fixed when the utterance OPENS, so which answer an utterance gets
        # never depends on which decode thread finishes first.
        b._i += 1
        self.index = index
        self.b = b
        self.grammar = grammar
        self.buf = bytearray()
        self.n = 0

    def feed(self, pcm: bytes):
        self.buf.extend(pcm)
        self.n += 1
        return f'partial {self.n}' if self.b.partials else None

    def finish(self) -> dict:
        if self.b.delay_s:
            import time
            time.sleep(self.b.delay_s)
        return self.b._pick(bytes(self.buf), self.grammar, self.index)


def make_backend(kind: str, **kw) -> object:
    if kind == 'whisper':
        return WhisperBackend(**{k: v for k, v in kw.items() if k in (
            'model', 'device', 'compute_type', 'threads', 'beam_size', 'word_confidence', 'local_only')})
    if kind == 'vosk':
        return VoskBackend(kw['model'])
    if kind == 'fake':
        return FakeBackend(script=kw.get('script'))
    raise ValueError(f'unknown backend {kind!r}')


__all__ = ['SAMPLE_RATE', 'WhisperBackend', 'VoskBackend', 'FakeBackend', 'make_backend', 'default_threads']
