"""make_story_clips.py - recordings of every line the written adventures say, made ahead (row 2.235, note FK 1).

The same pipeline as the lessons' (make_lesson_clips.py, whose helpers this uses): the lines come from the site's own code
(dev/story_lines.html: each story's pages and choice labels, as a button says them and as the light asks them, in every town
theme, since a place's name changes with the theme), each is spoken by Piper and kept as a small Ogg Opus file, and the
lessons' clips.json lists them under a voice of their own, 'story'. A change to a teacher's voice never touches them, and a
change to the narrator's voice starts only this list again.

  py -3.13 web/tools/make_story_clips.py --out <the lessons' clips folder> --model <piper folder>/en_US-libritts-high.onnx
  options: --speaker 552 (the narrator: the board's and teacher A's voice, by default)  --base http://127.0.0.1:8000  --dry-run

Needs: a Nimrod server at --base, Chrome, ffmpeg on PATH, and the piper-tts package with the voice model.
"""
import argparse, asyncio, datetime, os, shutil, subprocess, sys, tempfile, time, wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_lesson_clips as L  # noqa: E402

SLOT = 'story'
SPEAKER = 552


def plan(m, voice, lines, out):
    """(the manifest, ready for this run; the lines still to make). PURE apart from looking for files in `out`."""
    m.setdefault('lines', {})
    was = m.get('voices') if isinstance(m.get('voices'), dict) else {}
    old = was.get(SLOT)
    if not (isinstance(old, dict) and old.get('model') == voice['model'] and old.get('speaker') == voice['speaker']):
        m['lines'][SLOT] = {}
    m['lines'].setdefault(SLOT, {})
    m['voices'] = {**was, SLOT: {'model': voice['model'], 'speaker': voice['speaker']}}
    todo = []
    for t in lines:
        fname = L.clip_name(voice['model'], voice['speaker'], t)
        have = m['lines'][SLOT].get(t)
        if have and os.path.exists(os.path.join(out, have['file'])):
            continue
        if os.path.exists(os.path.join(out, fname)):
            m['lines'][SLOT][t] = {'file': fname, 'ms': L.clip_ms(os.path.join(out, fname))}
            continue
        todo.append(t)
    return m, todo


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--speaker', type=int, default=SPEAKER)
    ap.add_argument('--base', default='http://127.0.0.1:8000')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(argv)
    got = asyncio.run(L.read_page(a.base, 'dev/story_lines.html', "document.getElementById('summary')?.dataset.done === 'true'",
                                  'window.storyLines().then((x) => JSON.stringify(x))'))
    if got.get('problems'):
        print('stories left out (the checker refused them):', '; '.join(got['problems']))
    voice = {'model': os.path.splitext(os.path.basename(a.model))[0], 'path': a.model, 'speaker': a.speaker}
    os.makedirs(a.out, exist_ok=True)
    mpath = os.path.join(a.out, 'clips.json')
    m = L.load_manifest(mpath) or {'format': L.FORMAT, 'made': None, 'lines': {}}
    m, todo = plan(m, voice, got['lines'], a.out)
    print(f"{got['stories']} stories in {got['themes']} themes, {len(got['lines'])} distinct lines, {len(todo)} to make")
    if a.dry_run:
        return 0
    if not todo:
        m['made'] = datetime.datetime.now().isoformat(timespec='seconds')
        L.save_manifest(mpath, m)
        return 0
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg is not on PATH')
    from piper import PiperVoice
    try:
        from piper import SynthesisConfig
    except ImportError:
        SynthesisConfig = None
    pv = PiperVoice.load(a.model)
    tmpdir = tempfile.mkdtemp(prefix='nimrod_story_')
    made, started = 0, time.time()
    try:
        for text in todo:
            fname = L.clip_name(voice['model'], voice['speaker'], text)
            wav = os.path.join(tmpdir, 'line.wav')
            with wave.open(wav, 'wb') as w:
                if SynthesisConfig is not None:
                    pv.synthesize_wav(text, w, syn_config=SynthesisConfig(speaker_id=voice['speaker']))
                else:
                    pv.synthesize(text, w, speaker_id=voice['speaker'])
            with wave.open(wav, 'rb') as r:
                ms = round(r.getnframes() * 1000 / r.getframerate())
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', L.BITRATE,
                            os.path.join(a.out, fname)], check=True)
            os.remove(wav)
            m['lines'][SLOT][text] = {'file': fname, 'ms': ms}
            made += 1
            if made % L.SAVE_EVERY == 0:
                m['made'] = datetime.datetime.now().isoformat(timespec='seconds')
                L.save_manifest(mpath, m)
                print(f'  {made}/{len(todo)} made', flush=True)
    finally:
        m['made'] = datetime.datetime.now().isoformat(timespec='seconds')
        L.save_manifest(mpath, m)
        shutil.rmtree(tmpdir, ignore_errors=True)
    print(f'made {made} story clips in {(time.time() - started) / 60:.1f} minutes; {mpath}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
