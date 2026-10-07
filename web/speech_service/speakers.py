"""speakers.py - WHO IS TALKING: a voiceprint per person who opts in, and a "who" on every transcript (row 2.56).

Mike, 2026-10-07: *"I would want things like that to work across any AI across the site. So anyone could set up
multiple AI for different tasks/games and they would all recognize any users that opt in by their voice."* So it
lives HERE, in the speech program, once: every transcript it sends carries who said it and how sure, and every AI,
game and subtitle on the screen gets that without building its own.

    enrolment  a person reads a few sentences (web/client/voice_id.js shows them). Each one is turned into a list
               of numbers (an EMBEDDING) and the audio is let go at once; the average of those lists is the
               person's VOICEPRINT. No recording is kept, here or anywhere.
    identify   each utterance's embedding is compared with every voiceprint on this computer (cosine similarity):
               the closest, if it is close enough, is "who"; otherwise who is null ("Unknown"). THE WORDS ARE NEVER
               DROPPED for it - "who" is a label on a transcript, never a condition on one (row 2.42).

*** THE SAFETY INVARIANTS (security, so stated firmly; the wording is argued in the report to Mike) ***
  1. A VOICEPRINT NEVER LEAVES THE COMPUTER THAT MADE IT BY ANYTHING NIMROD DOES. The speech program never sends
     one over its socket - not to the screen, not to anybody: a screen gets names, dates and counts, never the
     numbers. Nimrod's server refuses one (web/server/storage_line.py rule 5). The person may move theirs
     themselves - a file they copy, or a folder they point `--voiceprints` at - and that is their choice to make.
  2. IT IS NEVER A LOCK OR A PASSWORD. Voices can be imitated and change with illness; nothing may be allowed or
     refused because of "who". It names; it does not admit.
  3. ONLY PEOPLE WHO SET THEMSELVES UP ARE EVER NAMED. Nobody else gets a voiceprint; their utterances are
     compared (in memory, then let go) and come back "Unknown".
  4. DELETABLE. `forget` removes the file; the person's settings row has the button.

WHAT IS STORED, per person, one small JSON file (VoiceprintStore): the site's person id, the name at enrolment, the
engine's name, the numbers, when, and how many sentences / seconds went in. Nothing else.

THE ENGINE is behind one small interface, so the tests use a fake and the Pi can get a lighter one later:
    engine.name            e.g. 'wespeaker:resnet34-LM'
    engine.embed(pcm)      16 kHz mono 16-bit little-endian PCM -> a list of floats (any length, fixed per engine)
The real one (WespeakerEngine) is pyannote's WeSpeaker ResNet34, loaded from files ALREADY ON THIS COMPUTER:
nothing is downloaded, ever (HF_HUB_OFFLINE is set before the import, and a missing model is an error to report).
"""
from __future__ import annotations

import glob
import json
import math
import os
import random
import re
import threading
import time

SAMPLE_RATE = 16000
FORMAT = 'nimrod-voiceprint'      # storage_line.py refuses a JSON value carrying this tag, whatever else it holds
FORMAT_VERSION = 1

# ---------------------------------------------------------------------------------------------
# THE NUMBERS. Each is a DEFAULT and a flag on the service (`__main__.py`), argued; the one a person decides is
# `sureAt`, sent by the screen from their settings row (voice_id.js).
# ---------------------------------------------------------------------------------------------
# RAW SCORES are the engine's cosine similarity, -1..1. They depend on the engine, so they never reach a person:
# they are mapped onto ONE "how sure" scale, 0..1, whose two anchor points are the site's own display rule
# (web/client/subtitles.js SUBTITLES_DEFAULTS.sureAt 0.8 = "named", maybeAt 0.4 = "Unsure (maybe ...)"). A test
# reads subtitles.js and holds the two equal.
SURE_NAMED = 0.8
SURE_MAYBE = 0.4
# WeSpeaker ResNet34, measured 2026-10-07 on this desktop with SAPI's two English voices (synthetic, NOT real
# people - see the report): the same voice scored 0.73-0.95 against its own print, the other voice 0.15-0.26.
# The old Cici pipeline (the same model, real room audio) kept an utterance as Christine at >= 0.42 with a margin
# of 0.06 over Mike, and Christine-vs-Mike prints sat ~0.20 apart.
#   SPEAKER_MATCH = 0.5: the raw score that maps to "named" (0.8). Above the old pipeline's 0.42 on purpose: a
#     WRONG NAME on a caption is worse than "Unsure (maybe Alex)", and the words show either way. Against: real,
#     noisy room audio scores lower than SAPI (the pipeline kept only 41% of Christine's true clips at 0.42), so
#     some true matches will read as "Unsure". Raise or lower with `--speaker-match` once real voices are measured.
#   SPEAKER_MAYBE = 0.3: the raw score that maps to "maybe" (0.4). Halfway between the different-voice ceiling
#     seen (0.26) and the match. Below it, nobody is suggested.
SPEAKER_MATCH = 0.5
SPEAKER_MAYBE = 0.3
# Two voiceprints this close for one utterance is not an answer: who stays null and the closer one is a "maybe".
# 0.06, the old pipeline's margin (it separated Christine from Mike on real audio).
SPEAKER_MARGIN = 0.06
# Shorter than this, an utterance is not compared at all ("pause" is half a second): an embedding of half a
# second of speech is mostly noise [training knowledge - speaker models are trained on 2-3 s crops], and a
# confident wrong name is the failure to avoid. 1.0 s.
SPEAKER_MIN_S = 1.0
# ENROLMENT: at least this many sentences that agree with each other, and this many seconds of speech in all.
# Commercial voice enrolment asks for a few phrases, roughly 10-30 s [training knowledge]; voice_id.js shows five
# sentences of ~4 s each. A sentence whose embedding is far from the others (somebody else spoke, a TV) is
# DROPPED: its score against the average of the rest is below SPEAKER_MAYBE.
ENROL_MIN_CLIPS = 3
ENROL_MIN_S = 10.0
ENROL_MAX_CLIPS = 20


def sure_from_score(score, match: float = SPEAKER_MATCH, maybe: float = SPEAKER_MAYBE):
    """A raw similarity -> the 0..1 "how sure" scale (maybe -> SURE_MAYBE, match -> SURE_NAMED). Piecewise linear,
    so it only re-labels the engine's own ordering. None for anything that is not a finite number."""
    try:
        s = float(score)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(s):
        return None
    maybe = float(maybe)
    match = max(float(match), maybe + 1e-6)
    if s <= 0:
        v = 0.0
    elif s < maybe:
        v = SURE_MAYBE * s / maybe if maybe > 0 else SURE_MAYBE
    elif s < match:
        v = SURE_MAYBE + (SURE_NAMED - SURE_MAYBE) * (s - maybe) / (match - maybe)
    else:
        v = SURE_NAMED + (1 - SURE_NAMED) * min(1.0, (s - match) / max(1e-6, 1 - match))
    return round(max(0.0, min(1.0, v)), 3)


# ---------------------------------------------------------------------------------------------
# Plain-Python vector maths (a Pi without numpy can still run the fake and the store).
# ---------------------------------------------------------------------------------------------
def unit(v):
    v = [float(x) for x in v]
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n > 0 else v


def cosine(a, b) -> float:
    if not a or not b or len(a) != len(b):
        return float('nan')
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return float('nan')
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def mean(vs):
    vs = [unit(v) for v in vs]
    return unit([sum(c) / len(vs) for c in zip(*vs)]) if vs else []


# ---------------------------------------------------------------------------------------------
# THE STORE: one file per person, in one folder on this computer.
# ---------------------------------------------------------------------------------------------
# *** WHERE, ARGUED (the report repeats it for Mike). ***
#   (a) THE HELPER'S OWN DATA FOLDER (%LOCALAPPDATA%\Nimrod Helper\voiceprints), when the helper runs the speech
#       program - CHOSEN for an installed helper (supervisor.py passes `--voiceprints`). FOR: on this computer,
#       not synced anywhere, survives an update of the program (the installer replaces app\ wholesale and leaves
#       the data folder alone), and an uninstall removes it (it is ours to delete). AGAINST: invisible to
#       somebody browsing their files.
#   (b) BESIDE THE SPEECH PROGRAM (speech_service/voiceprints/, kept out of git and out of the installer's copy),
#       when it is run by hand - the default when nothing names a folder, the same pattern as my_voice_model/.
#   (c) THE PERSON'S NIMROD FOLDER (its Data area) - NOT the default, available with `--voiceprints <folder>`.
#       FOR: visible, theirs, backed up with their other things. AGAINST, and it decides it: the Nimrod folder is
#       often inside Google Drive, OneDrive or Dropbox (the site suggests a cloud drive as one place for history,
#       row 2.58), and a voiceprint written there would leave the computer without the person ever deciding that
#       separately - which is invariant 1. Somebody who wants that can choose it, knowingly.
VOICEPRINTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'voiceprints')
_PERSON_RE = re.compile(r'^[A-Za-z0-9_.-]{1,64}$')
NAME_MAX = 80


def person_ok(person) -> bool:
    return isinstance(person, str) and bool(_PERSON_RE.match(person)) and person not in ('.', '..')


class VoiceprintStore:
    """The voiceprints on this computer. Every method is safe from several threads (one lock)."""

    def __init__(self, folder: str = VOICEPRINTS_DIR):
        self.folder = folder
        self._lock = threading.Lock()

    def _path(self, person: str) -> str:
        if not person_ok(person):
            raise ValueError('a person id is letters, digits, dot, dash or underscore (at most 64)')
        return os.path.join(self.folder, f'{person}.voiceprint.json')

    def _read(self, path: str):
        try:
            with open(path, encoding='utf-8') as f:
                d = json.load(f)
        except (OSError, ValueError):
            return None
        if not isinstance(d, dict) or d.get('format') != FORMAT or not person_ok(d.get('person')):
            return None
        v = d.get('vector')
        if not isinstance(v, list) or not v or not all(isinstance(x, (int, float)) for x in v):
            return None
        return d

    def all(self) -> list:
        """Every readable voiceprint, WITH its numbers - for this process only, never for a socket."""
        with self._lock:
            out = []
            for p in sorted(glob.glob(os.path.join(self.folder, '*.voiceprint.json'))):
                d = self._read(p)
                if d:
                    out.append(d)
            return out

    def summary(self, engine_name=None) -> list:
        """What a screen may see: who, when, how much - NEVER the numbers (invariant 1)."""
        return [{'person': d['person'], 'name': str(d.get('name') or '')[:NAME_MAX], 'engine': d.get('engine'),
                 'enrolledAt': d.get('enrolledAt'), 'clips': d.get('clips'), 'seconds': d.get('seconds'),
                 'usable': engine_name is None or d.get('engine') == engine_name}
                for d in self.all()]

    def save(self, person: str, name: str, vector, engine: str, clips: int, seconds: float) -> dict:
        path = self._path(person)
        d = {'format': FORMAT, 'v': FORMAT_VERSION, 'person': person, 'name': str(name or '').strip()[:NAME_MAX],
             'engine': engine, 'dims': len(vector), 'vector': [round(float(x), 6) for x in vector],
             'enrolledAt': int(time.time() * 1000), 'clips': int(clips), 'seconds': round(float(seconds), 1)}
        with self._lock:
            os.makedirs(self.folder, exist_ok=True)
            tmp = f'{path}.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(d, f)
            os.replace(tmp, path)     # whole or not at all: a half-written print is never read
        return d

    def forget(self, person: str) -> bool:
        path = self._path(person)
        with self._lock:
            try:
                os.remove(path)
                return True
            except FileNotFoundError:
                return False


# ---------------------------------------------------------------------------------------------
# ENGINES
# ---------------------------------------------------------------------------------------------
class SpeakerEngineMissing(RuntimeError):
    """No speaker engine can run here (a library or the model file is not on this computer)."""


# The model's files as the old Cici pipeline left them in the Hugging Face cache (pyannote 4 reads the bare
# `pytorch_model.bin`). Looked for in HF_HOME (the helper points it at its own models folder), the user's own
# cache, and speech_service/models/speaker/ - and only looked for: nothing here can fetch it.
WESPEAKER_REPO = 'models--pyannote--wespeaker-voxceleb-resnet34-LM'
SPEAKER_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'speaker')


def find_wespeaker(explicit: str | None = None):
    """The path of the WeSpeaker checkpoint on this computer, or None. `explicit` (a file, or a folder holding
    pytorch_model.bin) wins when given."""
    if explicit:
        p = os.path.expanduser(explicit)
        if os.path.isdir(p):
            p = os.path.join(p, 'pytorch_model.bin')
        return p if os.path.isfile(p) else None
    hubs = []
    if os.environ.get('HF_HOME'):
        hubs.append(os.path.join(os.environ['HF_HOME'], 'hub'))
    if os.environ.get('HUGGINGFACE_HUB_CACHE'):
        hubs.append(os.environ['HUGGINGFACE_HUB_CACHE'])
    hubs.append(os.path.join(os.path.expanduser('~'), '.cache', 'huggingface', 'hub'))
    for h in hubs:
        for p in sorted(glob.glob(os.path.join(h, WESPEAKER_REPO, 'snapshots', '*', 'pytorch_model.bin'))):
            if os.path.isfile(p):
                return p
    p = os.path.join(SPEAKER_MODELS_DIR, 'pytorch_model.bin')
    return p if os.path.isfile(p) else None


class WespeakerEngine:
    """pyannote's WeSpeaker ResNet34 (256 numbers), on the CPU. ~7-16 s to load, ~50-110 ms per 2-5 s utterance
    on this desktop (i5-10400, measured 2026-10-07)."""

    def __init__(self, checkpoint: str | None = None, threads: int | None = None):
        path = find_wespeaker(checkpoint)
        if not path:
            raise SpeakerEngineMissing('the speaker model (WeSpeaker ResNet34) is not on this computer')
        os.environ.setdefault('HF_HUB_OFFLINE', '1')      # belt and braces: a local file needs no network
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')               # torchcodec's DLL notice: audio is handed over in memory
            try:
                import torch  # noqa: WPS433
                from pyannote.audio import Inference, Model  # noqa: WPS433
            except Exception as err:  # noqa: BLE001 - ImportError, or a DLL that will not load
                raise SpeakerEngineMissing(f'pyannote.audio / torch will not load here: {err}') from err
            if threads:
                torch.set_num_threads(int(threads))
            self._torch = torch
            self._inf = Inference(Model.from_pretrained(path), window='whole')
        self.name = 'wespeaker:resnet34-LM'
        self._lock = threading.Lock()

    def embed(self, pcm: bytes):
        import numpy as np  # noqa: WPS433
        a = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
        with self._lock:
            e = self._inf({'waveform': self._torch.from_numpy(a.copy())[None], 'sample_rate': SAMPLE_RATE})
        return [float(x) for x in np.asarray(e, dtype=np.float32).reshape(-1)]


class FakeSpeakerEngine:
    """For the tests: a VOICE is the PCM's first sample value. `value // 100` picks the voice and `value % 100`
    pushes the embedding away from it (0 = exactly that voice; larger = less like it), so a test can build a sure
    match, an unsure one and a stranger from plain constant-valued audio. Nothing is heard."""

    DIMS = 64

    def __init__(self, delay_s: float = 0.0):
        self.name = 'fake-speaker'
        self.delay_s = float(delay_s)
        self.calls = 0

    @staticmethod
    def _base(k: int):
        # Mostly one dimension per voice, a little noise: two different voices score near 0, as two different
        # people do with a real engine, and never by chance close to a match.
        r = random.Random(int(k) * 7919 + 13)
        v = [r.gauss(0, 0.05) for _ in range(FakeSpeakerEngine.DIMS)]
        v[int(k) % FakeSpeakerEngine.DIMS] += 1.0
        return unit(v)

    def embed(self, pcm: bytes):
        self.calls += 1
        if self.delay_s:
            time.sleep(self.delay_s)
        v = int.from_bytes(pcm[:2], 'little', signed=True) if len(pcm) >= 2 else 0
        voice, off = divmod(abs(v), 100)
        a, b = self._base(voice), self._base(voice + 7777)
        w = off / 100.0
        return unit([x + 2.0 * w * y for x, y in zip(a, b)])


def make_speaker_engine(kind: str, **kw):
    if kind == 'fake':
        return FakeSpeakerEngine()
    if kind in ('wespeaker', 'auto'):
        return WespeakerEngine(checkpoint=kw.get('checkpoint'), threads=kw.get('threads'))
    raise ValueError(f'unknown speaker engine {kind!r}')


# ---------------------------------------------------------------------------------------------
# SPEAKERS: the engine (loaded the first time somebody asks), the store, and the rules.
# ---------------------------------------------------------------------------------------------
class Speakers:
    """One per service. `factory()` makes the engine; it is called at most once, the FIRST time a screen asks to
    identify or to enrol - a computer where nobody opted in never loads it (~200 MB of memory, ~10 s)."""

    def __init__(self, factory, store: VoiceprintStore, name: str, match: float = SPEAKER_MATCH,
                 maybe: float = SPEAKER_MAYBE, margin: float = SPEAKER_MARGIN, min_s: float = SPEAKER_MIN_S):
        self._factory = factory
        self.store = store
        self.name = name                   # what hello says, before the engine is loaded
        self.match, self.maybe, self.margin, self.min_s = float(match), float(maybe), float(margin), float(min_s)
        self._engine = None
        self._error = None
        self._load_lock = threading.Lock()
        self._cache = None                 # (signature of the folder, prints) - re-read when a file changes

    # -- the engine --
    def engine(self):
        """Blocking (call it off the event loop). The engine, or raise SpeakerEngineMissing with why."""
        with self._load_lock:
            if self._engine is None and self._error is None:
                try:
                    self._engine = self._factory()
                    self.name = getattr(self._engine, 'name', self.name)
                except SpeakerEngineMissing as err:
                    self._error = str(err)
                except Exception as err:  # noqa: BLE001
                    self._error = f'the speaker engine would not start: {err}'
            if self._engine is None:
                raise SpeakerEngineMissing(self._error or 'no speaker engine')
            return self._engine

    def embed(self, pcm: bytes):
        return self.engine().embed(pcm)

    # -- the prints --
    def _prints(self):
        sig = []
        try:
            for p in sorted(glob.glob(os.path.join(self.store.folder, '*.voiceprint.json'))):
                st = os.stat(p)
                sig.append((p, st.st_mtime_ns, st.st_size))
        except OSError:
            sig = []
        if self._cache is None or self._cache[0] != sig:
            self._cache = (sig, self.store.all())
        return [d for d in self._cache[1] if d.get('engine') == self.name]

    def anybody(self) -> bool:
        """Is anybody enrolled for this engine? Cheap; no engine is loaded to answer it."""
        return bool(self._prints())

    # -- identify --
    def identify(self, pcm: bytes, sure_at: float = SURE_NAMED) -> dict:
        """{who, person, sure, maybe, engine[, why]}. who/person are null unless the closest voiceprint is sure
        enough by `sure_at` (the person's setting) AND clear of the next one by the margin."""
        out = {'who': None, 'person': None, 'sure': None, 'maybe': None, 'engine': self.name}
        secs = len(pcm) / 2 / SAMPLE_RATE
        if secs < self.min_s:
            return {**out, 'why': 'short'}
        prints = self._prints()
        if not prints:
            return {**out, 'why': 'nobody'}
        try:
            e = self.embed(pcm)
        except SpeakerEngineMissing as err:
            return {**out, 'why': 'engine', 'error': str(err)[:200]}
        scored = []
        for d in prints:
            s = cosine(e, d['vector'])
            if math.isfinite(s):
                scored.append((s, d))
        if not scored:
            return {**out, 'why': 'nobody'}
        scored.sort(key=lambda x: -x[0])
        best_s, best = scored[0]
        second = scored[1][0] if len(scored) > 1 else None
        sure = sure_from_score(best_s, self.match, self.maybe)
        clear = second is None or best_s - second >= self.margin
        out['sure'] = sure
        if sure is not None and sure >= float(sure_at) and clear:
            out['who'] = str(best.get('name') or '') or None
            out['person'] = best['person']
        elif sure is not None and sure >= SURE_MAYBE:
            out['maybe'] = str(best.get('name') or '') or None
            if not clear:
                out['why'] = 'close'       # two voiceprints scored nearly the same
        return out

    # -- enrolment --
    def enrol(self, person: str, name: str, clips) -> dict:
        """`clips`: [(embedding, seconds)]. Saves the voiceprint and returns its summary, or raises ValueError with
        a sentence a person can read. Clips far from the others are dropped first (somebody else, a TV)."""
        if not person_ok(person):
            raise ValueError('That person cannot be set up here (their id is not one this computer can store).')
        clips = [(list(v), float(s)) for v, s in clips if v]
        dropped = 0
        if len(clips) >= 3:
            keep = []
            for i, (v, s) in enumerate(clips):
                rest = mean([c[0] for j, c in enumerate(clips) if j != i])
                if cosine(v, rest) >= self.maybe:
                    keep.append((v, s))
                else:
                    dropped += 1
            clips = keep
        secs = sum(s for _, s in clips)
        if len(clips) < ENROL_MIN_CLIPS or secs < ENROL_MIN_S:
            raise ValueError(f'Not enough clear speech yet: {len(clips)} sentence(s), {secs:.0f} seconds. It needs '
                             f'at least {ENROL_MIN_CLIPS} sentences and {ENROL_MIN_S:.0f} seconds from one voice. '
                             'Nothing was saved.')
        d = self.store.save(person, name, mean([v for v, _ in clips]), self.name, len(clips), secs)
        self._cache = None
        return {'person': d['person'], 'name': d['name'], 'clips': d['clips'], 'seconds': d['seconds'],
                'enrolledAt': d['enrolledAt'], 'dropped': dropped}

    def forget(self, person: str) -> bool:
        gone = self.store.forget(person)
        self._cache = None
        return gone


def make_speakers(kind: str, folder: str | None = None, **kw):
    """The service's Speakers, or None for `--speakers none`. Never loads the engine here (see Speakers)."""
    if kind == 'none':
        return None
    store = VoiceprintStore(folder or VOICEPRINTS_DIR)
    rules = {k: kw[k] for k in ('match', 'maybe', 'margin', 'min_s') if kw.get(k) is not None}
    if kind == 'fake':
        eng = kw.get('engine') or FakeSpeakerEngine()
        return Speakers(lambda: eng, store, eng.name, **rules)
    name = 'wespeaker:resnet34-LM'
    return Speakers(lambda: make_speaker_engine('wespeaker', checkpoint=kw.get('checkpoint'),
                                                threads=kw.get('threads')), store, name, **rules)


__all__ = ['FORMAT', 'SURE_NAMED', 'SURE_MAYBE', 'SPEAKER_MATCH', 'SPEAKER_MAYBE', 'SPEAKER_MARGIN',
           'SPEAKER_MIN_S', 'ENROL_MIN_CLIPS', 'ENROL_MIN_S', 'ENROL_MAX_CLIPS', 'VOICEPRINTS_DIR',
           'sure_from_score', 'cosine', 'mean', 'unit', 'person_ok', 'VoiceprintStore', 'SpeakerEngineMissing',
           'find_wespeaker', 'WespeakerEngine', 'FakeSpeakerEngine', 'make_speaker_engine', 'Speakers',
           'make_speakers']
