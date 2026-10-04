"""Run the speech service.

From `web/`:

    py -3.13 -m speech_service --backend whisper                 # this desktop, faster-whisper small.en
    python3 -m speech_service --backend vosk --model ~/vosk-bench/models/vosk-model-small-en-us-0.15
    py -3.13 -m speech_service --backend fake                    # the protocol with no model
    python3 -m speech_service --backend none --wake hey_jarvis   # wake events only (openWakeWord)
    python3 -m speech_service --backend none --wake computer_please,nimrod_please   # our own (models/)
    py -3.13 -m speech_service --my-voice                        # ONE PERSON'S OWN voice model, port 8796
    py -3.13 -m speech_service --my-voice --model "D:\\voice\\ct2"  # ...kept somewhere else

A model trained on one person's voice (Google's Euphonia toolkit; the page is web/client/voice_model.js)
is a FOLDER: the one `ct2-transformers-converter --output_dir` wrote. `--my-voice` looks for it in
speech_service/my_voice_model/ (kept out of git), so nobody types a path; `--model` names one kept
elsewhere. It is checked at start-up: a folder missing a file faster-whisper needs is refused here, every
missing file named. It runs as its OWN service on its own port (8796 by default, a setting on that
person's row), so only the person whose speech settings point at it is ever heard by it; the shared
service on 8797 keeps the stock model for everybody else.

It binds 127.0.0.1:8797 by default: the room's sound stays on the machine that heard it, and only a
screen on that same machine can reach it. The screen's "this screen" recogniser looks there.

*** --host WITH ANY OTHER ADDRESS CARRIES A ROOM'S SOUND ACROSS THE NETWORK. *** It needs a shared
secret (`--secret` or the NIMROD_SPEECH_SECRET environment variable), which the screen sends as its
first message - never in the address, where logs keep it. Use a Tailscale address, not 0.0.0.0. The
refusal can be overridden only by `--no-secret-i-understand`, which exists for a closed test network.

Port 8797: nothing else here uses it (checked 2026-09-30: 8000 the site's dev server, 8080 the Cici
dashboard, 8765 the Cici session receiver on the desktop, 8770-8773 the media agents, 8791
corpus_desk). `--port` and the screen's "address" setting both change it.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from .backends import (MY_VOICE_DIR, MY_VOICE_PORT, WAKE_REFRACTORY_S, WAKE_THRESHOLD, WHISPER_FOLDER_FILES,
                       ModelFolderError, check_whisper_folder, default_threads, is_model_folder, make_backend,
                       make_wake)
from .service import MAX_UTTERANCE_S

LOOPBACK = {'127.0.0.1', 'localhost', '::1'}


def parse(argv=None):
    p = argparse.ArgumentParser(prog='speech_service', description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--backend', choices=['whisper', 'vosk', 'fake', 'none'], default='whisper',
                   help="'none': no transcription - a wake-word-only service (needs --wake)")
    p.add_argument('--wake', default=None,
                   help="wake-word models, comma-separated: this project's own by bare name (e.g. "
                        "computer_please - any <name>.onnx in speech_service/models/), openWakeWord "
                        "pre-trained names (hey_jarvis) or paths to a custom .onnx; 'fake' for tests. "
                        "Off when not given.")
    p.add_argument('--wake-threshold', type=float, default=WAKE_THRESHOLD,
                   help=f'score that counts as the wake phrase (default {WAKE_THRESHOLD}, openWakeWord\'s own)')
    p.add_argument('--wake-refractory-s', type=float, default=WAKE_REFRACTORY_S,
                   help=f'quiet time after a wake before the same phrase can fire again (default {WAKE_REFRACTORY_S})')
    p.add_argument('--wake-vad', type=float, default=0.0,
                   help="openWakeWord's Silero VAD gate, 0..1 (default 0 = off)")
    p.add_argument('--model', default=None,
                   help="whisper: a model name in the local cache (default small.en) or a converted model "
                        "FOLDER (checked at start-up); vosk: the model folder")
    p.add_argument('--threads', type=int, default=None,
                   help=f'whisper CPU threads (default: physical cores, guessed {default_threads()} here)')
    p.add_argument('--compute-type', default='int8', help='whisper: int8 (default, measured fastest) or float32')
    p.add_argument('--device', default='cpu', help="whisper: 'cpu' or 'cuda' (a GPU box)")
    p.add_argument('--no-word-confidence', action='store_true',
                   help='whisper: skip per-word confidence (the screen then cannot mark unsure words)')
    p.add_argument('--my-voice', action='store_true',
                   help='one person\'s own voice model (whisper): the folder speech_service/my_voice_model/ '
                        f'(or --model), on port {MY_VOICE_PORT} unless --port says otherwise')
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=None, help=f'default 8797 ({MY_VOICE_PORT} with --my-voice)')
    p.add_argument('--secret', default=os.environ.get('NIMROD_SPEECH_SECRET') or None)
    p.add_argument('--no-secret-i-understand', action='store_true')
    p.add_argument('--max-utterance-s', type=float, default=MAX_UTTERANCE_S)
    p.add_argument('--server', choices=['auto', 'fastapi', 'websockets'], default='auto',
                   help='auto: FastAPI/uvicorn when installed, else plain websockets')
    return p.parse_args(argv)


def model_and_port(a):
    """(model, port) after --my-voice: its folder and port unless --model / --port name others."""
    if a.my_voice:
        return (a.model or MY_VOICE_DIR), (a.port if a.port is not None else MY_VOICE_PORT)
    return (a.model or ('small.en' if a.backend == 'whisper' else None)), (a.port if a.port is not None else 8797)


def main(argv=None):
    a = parse(argv)
    if a.my_voice and a.backend != 'whisper':
        print('--my-voice is a Whisper model: leave --backend out (or say whisper)', file=sys.stderr)
        return 2
    model_arg, a.port = model_and_port(a)
    if a.my_voice and not a.model and not os.path.isdir(MY_VOICE_DIR):
        need = ', '.join([*WHISPER_FOLDER_FILES, 'vocabulary.json (or vocabulary.txt)', 'preprocessor_config.json'])
        print(f'speech service: --my-voice looks for your model in {MY_VOICE_DIR}, and there is no such folder yet. '
              'Put the converted folder there with that name (the one ct2-transformers-converter --output_dir wrote), '
              f'or pass --model <folder> for one kept elsewhere. It holds: {need}.', file=sys.stderr)
        return 2
    remote = a.host not in LOOPBACK
    if remote and not a.secret and not a.no_secret_i_understand:
        print(f'refusing to bind {a.host} without a secret: this service carries a room\'s sound. '
              'Pass --secret (or NIMROD_SPEECH_SECRET).', file=sys.stderr)
        return 2
    if remote:
        print(f'*** listening on {a.host}:{a.port}: screens elsewhere can send this machine the sound '
              'of their room. ***', file=sys.stderr)
    kw = {'device': a.device, 'compute_type': a.compute_type, 'threads': a.threads,
          'word_confidence': not a.no_word_confidence}
    if a.backend == 'whisper':
        model = os.path.expanduser(model_arg)
        if is_model_folder(model):
            # Before the model loads (seconds, and a traceback if it cannot): every missing file, by name.
            try:
                advised = check_whisper_folder(model)
            except ModelFolderError as err:
                print(f'speech service: {err}', file=sys.stderr)
                return 2
            for f in advised:
                print(f'speech service: note: the model folder has no {f}; faster-whisper uses its own defaults '
                      '(right for models up to medium, wrong for large-v3)', file=sys.stderr)
        kw['model'] = model
    elif a.backend == 'vosk':
        if not a.model:
            print('--model is required for vosk (the model folder)', file=sys.stderr)
            return 2
        kw['model'] = os.path.expanduser(a.model)
    if a.backend == 'none' and not a.wake:
        print('--backend none needs --wake (otherwise the service would do nothing)', file=sys.stderr)
        return 2
    backend = make_backend(a.backend, **kw)
    wake = make_wake([w.strip() for w in (a.wake or '').split(',') if w.strip()],
                     threshold=a.wake_threshold, refractory_s=a.wake_refractory_s, vad_threshold=a.wake_vad)
    names = ' + '.join(x.name for x in (backend, wake) if x is not None)
    print(f'speech service: {names} on ws://{a.host}:{a.port}/speech', file=sys.stderr)
    server = a.server
    if server == 'auto':
        try:
            import fastapi  # noqa: F401
            import uvicorn  # noqa: F401
            server = 'fastapi'
        except ImportError:
            server = 'websockets'
    if server == 'fastapi':
        import uvicorn
        from .service import create_app
        uvicorn.run(create_app(backend, secret=a.secret, max_utterance_s=a.max_utterance_s, wake=wake),
                    host=a.host, port=a.port, log_level='warning', ws_max_size=2 ** 20)
    else:
        from .service import serve_websockets
        try:
            asyncio.run(serve_websockets(backend, a.host, a.port, secret=a.secret,
                                         max_utterance_s=a.max_utterance_s, wake=wake))
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
