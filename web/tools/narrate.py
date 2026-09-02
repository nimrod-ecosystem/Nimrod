#!/usr/bin/env python3
"""narrate.py — the narration, the captions, and the muxed film. One clip per step.

    python narrate.py                       # audio + captions from the last recording
    python narrate.py --mux                 # ...and lay it over the video with ffmpeg
    python narrate.py --no-recording        # audio + a script preview, before filming

Mike chose Piper over his own voice, and the reason is the deciding one:

    *"Especially because it's something we'll be redoing with different builds. Better to be
    able to get it in one take."*

A re-runnable recorder needs re-runnable narration. A human take makes every UI change a trip
back to the microphone, and this project changes its UI weekly. It is also the voice the product
itself speaks with, which is a better fit than a stranger reading a script about accessibility
software.

---------------------------------------------------------------------------------------
*** ONE CLIP PER STEP, NOT ONE FILE ***
---------------------------------------------------------------------------------------

The obvious thing is to synthesize the whole script into one long track. Three reasons not to:

  * **Editing one sentence should cost one sentence.** A single track means re-rendering three
    minutes to fix four words, which is exactly the friction that stops people fixing them.
  * **The clips have to be PLACED, not played.** The film's step timings come from the recording
    that actually happened, and a step that took longer because a page was slow needs its line
    to start when that step starts. A single track cannot be nudged; a set of clips can be laid
    on a timeline.
  * **A clip that overruns its step is a fact worth knowing.** Reported per step below, because
    narration drifting past its picture is the failure you otherwise notice at the end.

---------------------------------------------------------------------------------------
THE CAPTIONS ARE NOT OPTIONAL, AND THEY COME FROM THE SAME PLACE
---------------------------------------------------------------------------------------

A walkthrough of accessibility software that is itself inaccessible would be its own argument
against the product. So the WebVTT is generated here from the same `say` text and the same real
timings the audio is placed with — not typed out again, and not estimated from word counts,
because a caption file that drifts from its film is worse than none.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'walkthrough_out'
DEFAULT_MODEL = Path.home() / 'piper' / 'en_US-libritts-high.onnx'


# ---------------------------------------------------------------------------------------
# WHERE THE LINES COME FROM
# ---------------------------------------------------------------------------------------
def steps_from_recording(timings_path):
    """The real film's steps, with the timings that actually happened.

    PREFERRED, because the audio has to be placed against the film that exists rather than the
    one the settle values predicted. `record_walkthrough.py` writes this on every run.
    """
    data = json.loads(timings_path.read_text(encoding='utf-8'))
    return [s for s in data['steps'] if s.get('say')], data.get('budget')


def steps_from_browser(base):
    """Straight from `steps.js`, for hearing the script before anything is filmed.

    Uses the same browser trick the recorder does, for the same reason: the list lives in a JS
    module and a second copy in Python is how two lists that must agree stop agreeing.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('playwright is needed to read steps.js without a recording.\n'
                 '    pip install playwright && python -m playwright install chromium')
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page()
        p.goto(f'{base}/landing.html', wait_until='domcontentloaded')
        data = p.evaluate("""async (base) => {
            const m = await import(base + '/steps.js');
            let t = 0;
            const steps = m.STEPS.filter((s) => s.say).map((s) => {
                const hold = m.holdMs(s);
                const row = { id: s.id, scene: s.scene, say: s.say,
                              startMs: t, endMs: t + hold };
                t += hold;
                return row;
            });
            return { steps, budget: m.wordBudget() };
        }""", base)
        b.close()
    return data['steps'], data['budget']


# ---------------------------------------------------------------------------------------
# SYNTHESIS
# ---------------------------------------------------------------------------------------
def synthesize(steps, model, out_dir, length_scale):
    from piper import PiperVoice, SynthesisConfig

    print(f'loading {model.name} …')
    voice = PiperVoice.load(str(model))
    # LENGTH SCALE IS PACE, and slower is the right default here. The audience includes people
    # who are newly brain-injured or reading captions; a brisk marketing read is the wrong
    # instinct for this product specifically.
    cfg = SynthesisConfig(length_scale=length_scale)

    clips = []
    for s in steps:
        path = out_dir / f'{s["id"]}.wav'
        with wave.open(str(path), 'wb') as w:
            voice.synthesize_wav(s['say'], w, syn_config=cfg)
        with wave.open(str(path), 'rb') as w:
            dur = w.getnframes() / float(w.getframerate())
        clips.append({**s, 'wav': path, 'durMs': int(dur * 1000)})
    return clips


# ---------------------------------------------------------------------------------------
# CAPTIONS
# ---------------------------------------------------------------------------------------
def write_vtt(clips, path, film_ms=None):
    def ts(ms):
        h, ms = divmod(max(0, ms), 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f'{h:02}:{m:02}:{s:02}.{ms:03}'

    lines = ['WEBVTT', '']
    for c in clips:
        # The cue lasts as long as the LINE, not as long as the step: a caption that hangs on
        # screen for eight seconds after the sentence ended reads as a stuck player.
        end = min(c['endMs'], c['startMs'] + c['durMs'] + 300)
        # AND NEVER PAST THE END OF THE FILM. The muxed file comes out a few hundred
        # milliseconds shorter than the recorder's own timings — encoder rounding plus
        # `-shortest` — so the last cue overran the media by 0.3s until this was added. A cue
        # with no video under it is how a player ends up showing a caption that will not clear.
        if film_ms is not None:
            end = min(end, film_ms)
        lines += [c['id'], f'{ts(c["startMs"])} --> {ts(end)}', c['say'], '']
    path.write_text('\n'.join(lines), encoding='utf-8')


# ---------------------------------------------------------------------------------------
# ONE TRACK, LAID OUT ON THE FILM'S OWN TIMELINE
# ---------------------------------------------------------------------------------------
def build_track(clips, total_ms, out_path):
    """Place every clip at its step's start time and mix them into one file.

    `adelay` per clip and `amix` to sum them: the clips do not overlap in practice, so this is a
    placement rather than a blend. Done in one ffmpeg call so there is no intermediate to clean
    up and no chance of the pieces going out of order.
    """
    if not shutil.which('ffmpeg'):
        return None, 'ffmpeg not found on PATH'
    args = ['ffmpeg', '-y']
    for c in clips:
        args += ['-i', str(c['wav'])]
    parts = [f'[{i}]adelay={c["startMs"]}|{c["startMs"]}[d{i}]' for i, c in enumerate(clips)]
    mix = ''.join(f'[d{i}]' for i in range(len(clips)))
    # `normalize=0` so a single clip plays at the level Piper produced rather than being
    # divided by the number of inputs — the clips do not overlap, so averaging them would just
    # make the whole track quiet. The limiter is the belt for the case that breaks that
    # assumption: if a line ever overruns its step, two clips sum, and Piper's output already
    # peaks at 0 dB. Overruns are reported and should be fixed in the script, but a clipped
    # track is a worse way to find out than a warning line.
    graph = (';'.join(parts) + f';{mix}amix=inputs={len(clips)}:normalize=0[m]'
             + ';[m]alimiter=limit=0.94[a]')
    args += ['-filter_complex', graph, '-map', '[a]',
             '-t', f'{total_ms / 1000:.3f}', '-ar', '48000', str(out_path)]
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        return None, r.stderr.decode('utf-8', 'replace')[-500:]
    return out_path, None


def film_duration_ms(out_dir):
    """How long the recorded film actually is, from the file rather than from the plan."""
    vids = sorted(out_dir.glob('page@*.webm'))
    if not vids or not shutil.which('ffprobe'):
        return None
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'csv=p=0', str(vids[-1])], capture_output=True)
    try:
        return int(float(r.stdout.decode().strip()) * 1000)
    except (ValueError, AttributeError):
        return None


def mux(video, audio, out_path):
    if not shutil.which('ffmpeg'):
        return None, 'ffmpeg not found on PATH'
    r = subprocess.run(
        ['ffmpeg', '-y', '-i', str(video), '-i', str(audio),
         '-c:v', 'copy', '-c:a', 'libopus', '-shortest', str(out_path)],
        capture_output=True)
    if r.returncode != 0:
        return None, r.stderr.decode('utf-8', 'replace')[-500:]
    return out_path, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=str(DEFAULT_MODEL))
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--base', default='http://127.0.0.1:8000')
    ap.add_argument('--no-recording', action='store_true',
                    help='read steps.js directly instead of the last recording')
    ap.add_argument('--length-scale', type=float, default=1.08,
                    help='pace; >1 is slower. Slower is the right default for this audience.')
    ap.add_argument('--mux', action='store_true', help='lay the audio over the recorded video')
    args = ap.parse_args()

    model = Path(args.model)
    if not model.exists():
        sys.exit(f'voice model not found: {model}\n'
                 'Point --model at the .onnx (its .json must sit beside it).')

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    clips_dir = out / 'narration'
    clips_dir.mkdir(exist_ok=True)

    timings = out / 'timings.json'
    if args.no_recording or not timings.exists():
        if not args.no_recording:
            print('no timings.json — reading steps.js directly. Run the recorder for real '
                  'timings before muxing.')
        steps, budget = steps_from_browser(args.base)
        have_film = False
    else:
        steps, budget = steps_from_recording(timings)
        have_film = True

    print(f'{len(steps)} spoken step(s)'
          + (f' · film {steps[-1]["endMs"] / 1000:.1f}s' if have_film else ' · no film yet'))

    clips = synthesize(steps, model, clips_dir, args.length_scale)

    # *** A LINE THAT OUTLASTS ITS PICTURE IS THE FAILURE WORTH REPORTING. *** It is why the
    # holds are derived from the script rather than hand-picked, and this is the check that the
    # derivation actually held once real page loads were involved.
    over = [c for c in clips if c['durMs'] > (c['endMs'] - c['startMs'])]
    for c in clips:
        room = (c['endMs'] - c['startMs']) - c['durMs']
        flag = '  OVERRUNS' if room < 0 else ''
        print(f'  {c["id"]:12} {c["durMs"] / 1000:5.1f}s  slack {room / 1000:+5.1f}s{flag}')

    vtt = out / 'walkthrough.vtt'
    write_vtt(clips, vtt, film_ms=film_duration_ms(out) if have_film else None)
    print(f'\ncaptions: {vtt}')

    total = clips[-1]['endMs'] if have_film else sum(c['durMs'] for c in clips)
    track, err = build_track(clips, total, out / 'narration.wav')
    print(f'audio:    {track or "FAILED: " + str(err)}')

    if args.mux:
        # `page@*.webm` IS THE RECORDER'S OWN NAMING, and matching it is not fussiness: a bare
        # `*.webm` also matched walkthrough.webm — this script's own output from the previous
        # run — and sorted it last, so the second mux tried to read the file it was writing.
        # ffmpeg said "Invalid argument" and meant "that is the same file".
        vids = sorted(out.glob('page@*.webm'))
        if not vids:
            sys.exit('--mux: no recording found. Run record_walkthrough.py first.')
        final, err = mux(vids[-1], out / 'narration.wav', out / 'walkthrough.webm')
        print(f'film:     {final or "FAILED: " + str(err)}')

    if over:
        print(f'\n{len(over)} line(s) run past their step. Lengthen `settle` in steps.js, or '
              'cut the line — do not speed up the voice.')
        sys.exit(1)


if __name__ == '__main__':
    main()
