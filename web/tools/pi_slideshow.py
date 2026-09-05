#!/usr/bin/env python3
"""pi_slideshow.py - DOES THE SLIDESHOW KEEP ADVANCING, ON A PI, UNATTENDED?

*** THIS IS THE ONE QUESTION ABOUT HER SCREEN THAT MATTERS MOST, AND NOTHING HAS ASKED IT. ***

`CLAUDE.md`: "PHOTOS outrank every game/feature." R7: "photos, and being able to CALL her, are
what matter." And R6's failure mode is a screen that dies at 3am.

`pi_bench.py` proved the kiosk RENDERS on a Pi 400 - 59fps, an image drawing at 1200x800. What it
could not tell anybody is whether that image was ever REPLACED. A photos panel that draws one
picture and then stops looks identical to a working one in every measurement taken so far: the
frame rate is fine, the memory is flat, the image is there. **It is the same failure the "Loading
photos..." bug wore - the feature working and looking broken, inverted.**

So this watches the actual `src` of the photo on screen, on the Pi, for as long as you give it,
and reports every distinct image it saw and the gap between changes. It touches nothing: a
browser is launched, watched, and killed.

*** BENCH ONLY. *** Never the live Pi - it is the rollback and she is at that screen ~24/7.

USAGE, on the bench Pi:
    export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000
    python3 pi_slideshow.py 6          # minutes to watch
"""
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

import websockets

URL = os.environ.get('BENCH_URL', 'https://nimrodecosystem.com/kiosk.html?demo=1')
PORT = 9224
PROFILE = '/tmp/pi_slideshow_profile'

# The src of whatever the photos panel is currently showing, plus enough context to tell
# "advancing" from "stuck" from "never started".
PROBE = """(() => {
  const p = document.querySelector('.photos');
  if (!p) return { panel: false };
  const el = p.querySelector('img, video');
  const status = p.querySelector('.status');
  return {
    panel: true,
    src: el ? (el.currentSrc || el.getAttribute('src') || '').slice(-90) : null,
    tag: el ? el.tagName : null,
    ready: el && el.tagName === 'IMG' ? el.naturalWidth > 0 : null,
    // A status sheet still up after minutes is the "Loading photos..." defect returning.
    statusText: status && !status.hidden ? (status.innerText || '').trim().slice(0, 80) : null,
  };
})()"""


def http_json(path, tries=40):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=1) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(0.5)
    raise RuntimeError('devtools never answered')


class CDP:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def send(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            m = json.loads(await self.ws.recv())
            if m.get('id') == self.n:
                if 'error' in m:
                    raise RuntimeError(m['error'])
                return m.get('result', {})

    async def js(self, expr):
        r = await self.send('Runtime.evaluate', expression=expr, awaitPromise=True,
                            returnByValue=True)
        return r.get('result', {}).get('value')


async def main():
    minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0
    subprocess.run(['rm', '-rf', PROFILE], check=False)
    proc = subprocess.Popen([
        'chromium', f'--remote-debugging-port={PORT}', f'--user-data-dir={PROFILE}',
        '--ozone-platform=wayland', '--use-angle=gles', '--enable-gpu-rasterization',
        '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
        '--no-first-run', '--no-default-browser-check', '--noerrdialogs',
        '--disable-session-crashed-bubble', '--password-store=basic',
        '--window-size=1920,1080', '--kiosk', URL,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=os.setsid)

    seen, timeline, stuck_status = [], [], None
    try:
        t = [x for x in http_json('/json/list') if x.get('type') == 'page'][0]
        async with websockets.connect(t['webSocketDebuggerUrl'], max_size=None,
                                      open_timeout=30) as ws:
            cdp = CDP(ws)
            await cdp.send('Runtime.enable')
            await asyncio.sleep(15)
            t0 = time.time()
            last = None
            # Every 2s: fast enough to catch an 8-second interval, slow enough to cost nothing.
            while time.time() - t0 < minutes * 60:
                p = await cdp.js(PROBE)
                if not p or not p.get('panel'):
                    timeline.append((round(time.time() - t0, 1), 'NO PHOTOS PANEL'))
                    break
                if p.get('statusText'):
                    stuck_status = p['statusText']
                src = p.get('src')
                if src and src != last:
                    timeline.append((round(time.time() - t0, 1), src))
                    if src not in seen:
                        seen.append(src)
                    last = src
                await asyncio.sleep(2)
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
        subprocess.run(['rm', '-rf', PROFILE], check=False)

    gaps = [round(timeline[i][0] - timeline[i - 1][0], 1) for i in range(1, len(timeline))]
    print('=====RESULT=====')
    print(json.dumps({
        'url': URL,
        'watched_minutes': minutes,
        'distinct_images': len(seen),
        'changes': len(timeline) - 1,
        'gaps_seconds': gaps,
        'status_sheet_seen': stuck_status,
        'timeline': timeline[:40],
    }, indent=2))


asyncio.run(main())
