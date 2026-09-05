#!/usr/bin/env python3
"""pi_bench.py - R2: does the Nimrod kiosk actually work on a Raspberry Pi 400?

*** THIS IS THE ROW NOTHING HAS EVER ANSWERED. ***

`MIKE_CHANGE_LIST.md` R2: "Nothing has been verified on a Pi. Every check this session ran in a
desktop Chromium at 1280x800, in a hidden browser pane. A Pi 400 driving a TV is a different
renderer, a different GPU, and roughly an order of magnitude less CPU. 'The suite is green' says
nothing about it."

So this runs a REAL Chromium on the BENCH Pi, against the LIVE public site, and measures. It
touches nothing persistent: it launches a browser, reads numbers out of it, and kills it. No
config, no service, no file on disk changes. The Cici dashboard kiosk keeps running underneath.

*** IT RUNS ON THE BENCH ONLY. *** CLAUDE.md is absolute that the live Pi is not touched at all -
it is the rollback, and she is at that screen ~24/7. This script does not check which unit it is
on, because it is never to be run anywhere but the bench.

USAGE - on the bench Pi, over ssh:

    scp web/tools/pi_bench.py unclemikemic@<bench-ip>:/tmp/
    ssh unclemikemic@<bench-ip> '
      export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000
      export BENCH_KIOSK=1 BENCH_URL=https://nimrodecosystem.com/kiosk.html?demo=1
      cd /tmp && python3 pi_bench.py 2'          # 2 = soak minutes

Needs `python3-websockets` on the Pi (already present on cici1). Env vars:
  BENCH_URL    what to point at. Try `modules.html?all=1` for the worst case - it mounts every
               module at once, canvases included, and reports its own verdict which this reads.
  BENCH_SIZE   default 1920,1080 - the resolution the Pi is actually driving.
  BENCH_KIOSK  set to anything for --kiosk instead of --start-maximized.

FIRST RESULTS, 2026-09-06, cici1 (Pi 400) against the live site at 1920x1080:
  59.5 fps - first contentful paint 1.94s - photos drawing at 1200x800 - ZERO containment
  escapes - no thermal throttle. And with `modules.html?all=1`: 21 modules mounted, 21 drew,
  0 blank, 0 threw, holding ~46fps with three live canvases.
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
PORT = 9223                      # NOT 9222 - do not collide with anything already listening
PROFILE = '/tmp/pi_bench_profile'


def http_json(path, tries=40):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=1) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f'devtools never answered on {PORT}')


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def send(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('id') == self.n:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})

    async def js(self, expr, timeout=120):
        r = await asyncio.wait_for(self.send(
            'Runtime.evaluate', expression=expr, awaitPromise=True,
            returnByValue=True, allowUnsafeEvalBlockedByCSP=True), timeout)
        res = r.get('result', {})
        if r.get('exceptionDetails'):
            return {'__error__': str(r['exceptionDetails'].get('text'))}
        return res.get('value')


# --- the measurements, as page scripts ------------------------------------------------
# Each one is a self-contained expression returning a plain object, because CDP hands back
# JSON and anything cleverer is a way to lose the number.

FPS = """(async () => {
  // Frames the browser ACTUALLY delivered over 5 seconds. On a Pi this is the number that
  // decides whether a canvas module is watchable or a slideshow.
  let n = 0; const t0 = performance.now();
  await new Promise((done) => {
    const tick = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });
  return { frames: n, seconds: (performance.now() - t0) / 1000, fps: n / ((performance.now() - t0) / 1000) };
})()"""

STATE = """(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const imgs = [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 0);
  const vids = [...document.querySelectorAll('video')];
  // *** CONTAINMENT, ON REAL HARDWARE. *** The fix that stopped a canvas painting to document
  // coordinates was proven in a desktop pane. A Pi has a different compositor, so it is worth
  // asking the question again where it matters.
  const escapes = [];
  for (const box of document.querySelectorAll('.mod-box, .k-mod')) {
    const b = box.getBoundingClientRect();
    for (const el of box.querySelectorAll('canvas, video, img, .photos, .comet, .pond')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < b.left - 2 || r.right > b.right + 2 || r.top < b.top - 2 || r.bottom > b.bottom + 2) {
        escapes.push(`${el.className || el.tagName} out of ${box.className}`);
      }
    }
  }
  return {
    title: document.title,
    // The modules page reports its own verdict here when run with ?all=1. Reading it means the
    // Pi run says which modules drew on a PI, not merely that the page came up.
    tally: (document.getElementById('tally') || {}).innerText || null,
    verdicts: [...document.querySelectorAll('[data-verdict]')]
      .filter((b) => !b.hidden && b.textContent.trim() && b.textContent.trim() !== '…')
      .map((b) => (b.closest('.mod')?.querySelector('[data-try]')?.dataset.try || '?') + ':' + b.textContent.trim()),
    url: location.href,
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    nodes: q('*'),
    panels: q('.mod-box, .k-mod'),
    canvases: q('canvas'),
    loadedImages: imgs.length,
    firstImage: imgs[0] ? [imgs[0].naturalWidth, imgs[0].naturalHeight] : null,
    videos: vids.length,
    escapes,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
  };
})()"""

MEM = """(() => {
  const m = performance.memory || {};
  return { usedMB: m.usedJSHeapSize ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
           totalMB: m.totalJSHeapSize ? +(m.totalJSHeapSize / 1048576).toFixed(1) : null,
           nodes: document.querySelectorAll('*').length };
})()"""

TIMING = """(() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  return { domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
           loadEvent: Math.round(n.loadEventEnd || 0),
           transferKB: Math.round((n.transferSize || 0) / 1024),
           paints };
})()"""


def pi_stats():
    """What the Pi itself says, alongside what the page says. A page reporting 12fps and a Pi
    reporting a thermal throttle are one finding, not two."""
    def sh(cmd):
        try:
            return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                                  timeout=5).stdout.strip()
        except Exception:
            return ''
    return {
        'temp': sh('vcgencmd measure_temp'),
        'throttled': sh('vcgencmd get_throttled'),
        'loadavg': open('/proc/loadavg').read().split()[:3],
        'mem_free_mb': sh("free -m | awk '/^Mem:/{print $7}'"),
    }


async def main():
    soak_minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0

    subprocess.run(['rm', '-rf', PROFILE], check=False)
    args = [
        'chromium',
        f'--remote-debugging-port={PORT}',
        f'--user-data-dir={PROFILE}',
        '--ozone-platform=wayland',
        '--use-angle=gles',
        '--enable-gpu-rasterization',
        '--js-flags=--expose-gc',
        '--enable-precise-memory-info',   # performance.memory with real numbers
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--no-first-run', '--no-default-browser-check', '--noerrdialogs',
        '--disable-session-crashed-bubble', '--password-store=basic',
        '--window-size=1280,800',
        URL,
    ]
    print(f'launching chromium -> {URL}', flush=True)
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            preexec_fn=os.setsid)
    out = {'url': URL, 'pi_before': pi_stats()}
    try:
        targets = [t for t in http_json('/json/list') if t.get('type') == 'page']
        if not targets:
            raise RuntimeError('no page target')
        ws_url = targets[0]['webSocketDebuggerUrl']
        async with websockets.connect(ws_url, max_size=None, open_timeout=30) as ws:
            cdp = CDP(ws)
            await cdp.send('Runtime.enable')
            print('connected; letting the screen settle for 20s', flush=True)
            await asyncio.sleep(20)

            out['timing'] = await cdp.js(TIMING)
            out['state'] = await cdp.js(STATE)
            out['mem_start'] = await cdp.js(MEM)
            print('measuring frame rate (5s)...', flush=True)
            out['fps'] = await cdp.js(FPS)
            out['pi_during'] = pi_stats()

            # A SHORT SOAK, ON THE HARDWARE. `dev/soak_test.html` proved the code does not grow
            # per cycle in a desktop browser. This asks the narrower, more important question:
            # does THIS screen, on THIS box, grow while it just sits there being looked at?
            mins = soak_minutes
            print(f'soaking {mins:g} minutes...', flush=True)
            await asyncio.sleep(mins * 60)
            out['mem_end'] = await cdp.js(MEM)
            out['fps_after'] = await cdp.js(FPS)
            out['state_after'] = await cdp.js(STATE)
            out['pi_after'] = pi_stats()
            out['soak_minutes'] = mins
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
        subprocess.run(['rm', '-rf', PROFILE], check=False)

    print('=====RESULT=====')
    print(json.dumps(out, indent=2))


asyncio.run(main())
