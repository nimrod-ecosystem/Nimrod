"""make_lesson_clips.py - recordings of every line the Lessons panel says, made ahead of time (proposal_lesson_voice_clips).

A slow computer (a Pi 400) makes the libritts-high voice at about 2.3 times slower than speaking, so a class read live
would pause before every line. This makes each line ahead of time, on a faster computer, as one small Ogg Opus file:

  1. The lines come from the panel itself: headless Chrome opens dev/lesson_lines.html on a running Nimrod server and
     calls window.lessonLines(name), which runs the panel's own spokenLines() over every class. Nothing is re-derived here.
  2. Each line not already made is spoken by Piper (the voice model and speaker given), encoded by ffmpeg (Opus, mono,
     32 kbit/s) and its WAV deleted at once.
  3. clips.json maps each voice's lines, by their exact text, to their files, with each one's length in milliseconds.
     The panel looks a line up there; it never hashes anything. The file name is the first 20 hex of
     sha-256("<model>:<speaker>\\n<text>"), so a line whose words change no longer finds its old recording.

It can stop and start: a clip already listed with its file present is skipped, and clips.json is written as it goes.

VOICES: teacher A's lines and the lines said in the learner's own voice (the answers, the end of a class) use
--speaker-a; teacher B's use --speaker-b, made only when one is given. Which teacher gets which voice is Mike's to choose
(proposal, decision 2). THE LEARNER'S NAME, for the lines that greet them, is read from --name-file, never the command
line, and clips.json is never published: a known sentence plus a guessed name would match its hash.

  py -3.13 web/tools/make_lesson_clips.py --out D:\\lesson-clips --model C:\\path\\en_US-libritts-high.onnx --speaker-a 552
  options: --base http://127.0.0.1:8000  --model-b C:\\path\\en_US-mike-medium.onnx  --speaker-b N  --name-file name.txt
           --course history-of-everything  --limit 1  --dry-run
EACH TEACHER ITS OWN VOICE (row 2.208, 2026-11-06): A is --model (+ --speaker-a for a voice with several speakers); B is
--model-b and/or --speaker-b. Changing one teacher's voice starts only that teacher's list again; a recording already on disk
under the same voice and words is reused, not made again.

Needs: a Nimrod server at --base, Chrome, ffmpeg on PATH, and the piper-tts Python package with the voice model.
"""
import argparse, asyncio, datetime, hashlib, io, json, os, shutil, subprocess, sys, tempfile, time, wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
FORMAT = 'nimrod.clips.v1'
BITRATE = '32k'           # speech is clear at 32 kbit/s mono; both teachers come to about 0.6 GB (the proposal measures it)
SAVE_EVERY = 25           # clips.json is rewritten after this many new clips, so a stop loses little


def clip_name(model, speaker, text):
    return hashlib.sha256(f'{model}:{speaker}\n{text}'.encode('utf-8')).hexdigest()[:20] + '.ogg'


def clip_ms(path):
    """A recording's length in milliseconds (ffprobe), or None when it cannot be read."""
    try:
        out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                             capture_output=True, text=True, timeout=20).stdout.strip()
        return round(float(out) * 1000)
    except Exception:
        return None


def wanted_lines(classes, with_b):
    """{(voice, text)} to make: voice 'a' for teacher A and the learner's own lines, 'b' for teacher B (when B has a voice)."""
    want = []
    seen = set()
    for c in classes:
        for line in c['lines']:
            # the two-voice cast (lesson_player.js voiceSlot): the debate's philosophical voice is B, the technical one A
            voice = 'b' if str(line.get('who') or '').lower() in ('b', 'philosophical') else 'a'
            if voice == 'b' and not with_b:
                continue
            key = (voice, line['text'])
            if key not in seen:
                seen.add(key)
                want.append(key)
    return want


async def read_lines(base, name, courses=None, limit=None):
    """Every class's lines, from the panel's own code, through headless Chrome."""
    import run_suite as RS
    import websockets
    if not RS.CHROME:
        raise SystemExit('no Chrome found (run_suite.py lists where it looks)')
    profile = tempfile.mkdtemp(prefix='nimrod_lines_')
    proc = subprocess.Popen([RS.CHROME, '--headless=new', f'--remote-debugging-port={RS.PORT}', f'--user-data-dir={profile}',
                             '--no-first-run', '--no-default-browser-check', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = next(t for t in RS.http_json('/json/list') if t['type'] == 'page')
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=256 * 1024 * 1024) as ws:
            cdp = RS.CDP(ws)
            await cdp.send('Page.enable')
            await cdp.send('Runtime.enable')
            await cdp.send('Page.navigate', url=f'{base.rstrip("/")}/dev/lesson_lines.html')
            for _ in range(240):
                if await cdp.js("!!(window.lessonLines && document.getElementById('summary')?.dataset.done)"):
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit('dev/lesson_lines.html never finished loading: is the server running at --base?')
            out = await cdp.js(f'window.lessonLines({json.dumps(name)}).then((x) => JSON.stringify(x))', timeout=600)
            if isinstance(out, dict) and '__error__' in out:
                raise SystemExit(f'lessonLines failed: {out["__error__"]}')
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except Exception: proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
    classes = json.loads(out)
    if courses:
        classes = [c for c in classes if c['course'] in courses]
    if limit:
        classes = classes[:limit]
    return classes


def load_manifest(path):
    try:
        with io.open(path, encoding='utf-8') as f:
            m = json.load(f)
        return m if m.get('format') == FORMAT else None
    except (OSError, ValueError):
        return None


def save_manifest(path, m):
    tmp = path + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(m, f, ensure_ascii=False, indent=0)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', required=True, help="teacher A's voice model (and B's, unless --model-b)")
    ap.add_argument('--speaker-a', type=int, default=None, help="A's speaker, for a voice with several (libritts: 552)")
    # (row 2.208, 2026-11-06) EACH TEACHER ITS OWN VOICE: B may be another model (Nimrod: en_US-mike-medium) with or without a
    # speaker of its own. B's lines are made only when B has a voice: --model-b or --speaker-b.
    ap.add_argument('--model-b', default=None, help="teacher B's voice model, when it is not A's")
    ap.add_argument('--speaker-b', type=int, default=None)
    ap.add_argument('--base', default='http://127.0.0.1:8000')
    ap.add_argument('--name-file', default=None)
    ap.add_argument('--course', action='append', default=None)
    ap.add_argument('--limit', type=int, default=None, help='only the first N classes (a trial)')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    name = ''
    if a.name_file:
        with io.open(a.name_file, encoding='utf-8') as f:
            name = f.read().strip()
    mid = lambda p: os.path.splitext(os.path.basename(p))[0]
    # Each teacher's voice: { model id, model path, speaker or None }. B only when it was given a voice.
    voices = {'a': {'model': mid(a.model), 'path': a.model, 'speaker': a.speaker_a}}
    if a.model_b or a.speaker_b is not None:
        pb = a.model_b or a.model
        voices['b'] = {'model': mid(pb), 'path': pb, 'speaker': a.speaker_b}
    classes = asyncio.run(read_lines(a.base, name, a.course, a.limit))
    want = wanted_lines(classes, 'b' in voices)
    os.makedirs(a.out, exist_ok=True)
    mpath = os.path.join(a.out, 'clips.json')
    m = load_manifest(mpath) or {'format': FORMAT, 'made': None, 'lines': {'a': {}, 'b': {}}}
    m.setdefault('lines', {}).setdefault('a', {}); m['lines'].setdefault('b', {})
    # A VOICE CHANGED: only that teacher's list starts again (the other's recordings stand). A recording already on disk
    # under the same name is reused (the name is the voice and the words, so it is the same recording).
    was = m.get('voices') if isinstance(m.get('voices'), dict) else {}
    for v, cur in voices.items():
        old = was.get(v)
        same = isinstance(old, dict) and old.get('model') == cur['model'] and old.get('speaker') == cur['speaker']
        if not same:
            m['lines'][v] = {}
    m['voices'] = {v: {'model': c['model'], 'speaker': c['speaker']} for v, c in voices.items()}
    m.pop('model', None)   # the old one-model shape
    todo = []
    for (v, t) in want:
        fname = clip_name(voices[v]['model'], voices[v]['speaker'], t)
        if t in m['lines'][v] and os.path.exists(os.path.join(a.out, m['lines'][v][t]['file'])):
            continue
        if os.path.exists(os.path.join(a.out, fname)):   # made before, under the same voice and words
            m['lines'][v][t] = {'file': fname, 'ms': clip_ms(os.path.join(a.out, fname))}
            continue
        todo.append((v, t))
    words = sum(len(t.split()) for _, t in todo)
    print(f'{len(classes)} classes, {len(want)} distinct lines, {len(todo)} to make (about {words / 150 / 60:.1f} hours of speech)')
    if a.dry_run:
        return
    if not todo:
        m['made'] = datetime.datetime.now().isoformat(timespec='seconds')
        save_manifest(mpath, m)      # what was reused from disk is listed
        return
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg is not on PATH')

    from piper import PiperVoice
    try:
        from piper import SynthesisConfig
    except ImportError:
        SynthesisConfig = None
    loaded = {}                      # each model loaded once, whichever teacher uses it
    tmpdir = tempfile.mkdtemp(prefix='nimrod_clip_')
    made, started = 0, time.time()
    try:
        for i, (v, text) in enumerate(todo, 1):
            vc = voices[v]
            voice = loaded.get(vc['path']) or loaded.setdefault(vc['path'], PiperVoice.load(vc['path']))
            spk = vc['speaker']
            fname = clip_name(vc['model'], spk, text)
            wav = os.path.join(tmpdir, 'line.wav')
            with wave.open(wav, 'wb') as w:
                if SynthesisConfig is not None:
                    voice.synthesize_wav(text, w, syn_config=SynthesisConfig(speaker_id=spk))
                else:
                    voice.synthesize(text, w, speaker_id=spk)
            with wave.open(wav, 'rb') as r:
                ms = round(r.getnframes() * 1000 / r.getframerate())
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE,
                            os.path.join(a.out, fname)], check=True)
            os.remove(wav)
            m['lines'].setdefault(v, {})[text] = {'file': fname, 'ms': ms}
            made += 1
            if made % SAVE_EVERY == 0:
                m['made'] = datetime.datetime.now().isoformat(timespec='seconds')
                save_manifest(mpath, m)
                rate = made / (time.time() - started)
                print(f'  {i}/{len(todo)} made, about {(len(todo) - i) / rate / 3600:.1f} hours left', flush=True)
    finally:
        m['made'] = datetime.datetime.now().isoformat(timespec='seconds')
        save_manifest(mpath, m)
        shutil.rmtree(tmpdir, ignore_errors=True)
    print(f'made {made} clips in {(time.time() - started) / 60:.1f} minutes; {mpath}')


if __name__ == '__main__':
    main()
