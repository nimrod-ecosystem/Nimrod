#!/usr/bin/env python3
"""pi_scene_bench.py - what one live scene costs a Raspberry Pi 400, measured on its real display.

WHY THIS EXISTS (2026-10-06). The seasons port (71a3fa1) could only estimate the Pi cost of the new
scenes on the desktop: headless Chromium on the bench has no working GPU (its GPU process restarts in
a loop), and a hidden desktop pane never ticks animations properly. This runs a SECOND, windowed
(Wayland, GPU) Chromium full screen over the bench's kiosk, with its own throwaway profile, on a tiny
page that mounts one scene and nothing else. When it covers the kiosk, the kiosk goes idle (measured:
whole-system CPU fell to ~4% and V3D to 0% under a blank page), so each number is the scene's own.

Per run it reports:
  - CPU of each Chromium process type (browser / gpu / renderer / other), ours and the kiosk's, from /proc
  - V3D busy time: the whole chip (gpu_stats) and per DRM client (fdinfo), render and bin queues
  - frame rate and long frames from requestAnimationFrame in the page
  - main-thread time per second from CDP Performance metrics (task, script, layout, style recalc)
  - a census of the scene (elements, running animations, blurred and box-shadowed elements)
  - temperature (start/end/max), ARM clock and vcgencmd get_throttled

*** BENCH ONLY. *** CLAUDE.md: the live Pi (the unit WITH the easystore drive) is never touched. Run
the identification probe first; this script does not check which unit it is on.

It changes nothing persistent: the kiosk, its profile, its services and its settings are untouched.
Everything it makes lives in WORK (default /tmp/pi_scene_bench) and is deleted at the end unless
KEEP=1. The window closes when it finishes, and the kiosk is back on top.

USAGE (from the desktop; PowerShell strips quotes in ssh command strings, so pass plain words):
    scp web/tools/pi_scene_bench.py unclemikemic@<bench-ip>:/tmp/
    ssh unclemikemic@<bench-ip> python3 /tmp/pi_scene_bench.py blank fall christmas christmas:noglow

  A run is  scene[:variant][?pause=<selector>|keep=<selector>|raf=1]
    variant  full (default) | noglow (filter and box-shadow off) | nofilter | paused (all animation paused)
    pause=   pause only the matching elements;  keep=  pause everything EXCEPT the matching elements
    raf=1    keep a requestAnimationFrame loop running through the CPU window (see the page's comment:
             that loop is itself most of the main-thread cost; it models "something else draws every frame")
    `blank` is the control: the same window with no scene.
  Env: SETTLE (s, 10)  MEASURE (s, 60)  BASE (kiosk-only baseline before and after, s, 30; 0 = skip)
       SITE (where the modules come from, default https://nimrodecosystem.com)  WORK  KEEP=1  SHOTS=1
       TRACE="christmas fall"  after the runs, list each scene's animations Chromium would not composite

Needs python3-websockets (present on cici1), grim for SHOTS, and vcgencmd.

FIRST RESULTS, 2026-10-06, the bench Pi 400 at 1920x1080: every new seasonal scene held about 60 fps and
cost less than Fall (Fall ~141% of one core, V3D ~89%; the new scenes 66-93% CPU, V3D 48-78%). No throttling.
"""
import asyncio
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import websockets

WORK = os.environ.get('WORK', '/tmp/pi_scene_bench')
WWW, PROFILE = WORK + '/www', WORK + '/profile'
SITE = os.environ.get('SITE', 'https://nimrodecosystem.com').rstrip('/')
HTTP_PORT, CDP_PORT = 8791, 9223          # NOT 9222: do not collide with anything already listening
SETTLE = float(os.environ.get('SETTLE', 10))
MEASURE = float(os.environ.get('MEASURE', 60))
BASE = float(os.environ.get('BASE', 30))
RUNS = sys.argv[1:] or ['blank', 'fall', 'christmas', 'diwali', 'lunarNewYear', 'halloween', 'newYear', 'spring']
# The bench's own display (labwc), for the window and for grim; an ssh session has neither set.
os.environ.setdefault('WAYLAND_DISPLAY', 'wayland-0')
os.environ.setdefault('XDG_RUNTIME_DIR', '/run/user/1000')
ENV = dict(os.environ)
HZ = os.sysconf('SC_CLK_TCK')
GPU_STATS = '/sys/devices/platform/v3dbus/fec00000.v3d/gpu_stats'

PAGE = r"""<!doctype html>
<meta charset="utf-8"><title>scene bench</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}#host{position:fixed;inset:0}</style>
<div id="host"></div>
<script type="module">
import { mountScene } from './livescene.js';
const p = new URLSearchParams(location.search);
const scene = p.get('scene') || 'blank', variant = p.get('variant') || 'full';
const host = document.getElementById('host');
const info = { scene, variant };
const addCss = (t) => { const st = document.createElement('style'); st.textContent = t; document.head.append(st); };
try {
  if (scene !== 'blank') mountScene(host, { scene, motion: 'gentle', flashLimit: p.has('flash') ? p.get('flash') : undefined });
  const css = { noglow: '.ls *{filter:none!important;box-shadow:none!important}', nofilter: '.ls *{filter:none!important}',
                paused: '.ls *{animation-play-state:paused!important}' }[variant];
  if (css) addCss(css);
  if (p.get('pause')) { addCss(`.ls :is(${p.get('pause')}){animation-play-state:paused!important}`); info.pause = p.get('pause'); }
  if (p.get('keep')) { addCss(`.ls *:not(:is(${p.get('keep')})){animation-play-state:paused!important}`); info.keep = p.get('keep'); }
  const all = [...(host.querySelector('.ng')?.querySelectorAll('*') || [])];
  let animated = 0, blurred = 0, shadowed = 0;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.animationName && cs.animationName !== 'none') animated++;
    if (/blur/.test(cs.filter || '')) blurred++;
    if (cs.boxShadow && cs.boxShadow !== 'none') shadowed++;
  }
  info.census = { elements: all.length, animated, blurred, shadowed,
    runningAnimations: document.getAnimations().filter((a) => a.playState === 'running').length,
    photosafe: !!host.querySelector('.ls[data-photosafe]') };
} catch (err) { info.error = String(err && err.stack || err); }
// *** THE FRAME COUNTER IS NOT FREE. *** A continuous requestAnimationFrame loop asks the renderer for a
// main-thread frame every vsync, and every such frame re-computes the style of every animated element - on a Pi
// that is most of the scene's CPU. So by default nothing ticks during the CPU window and __count(ms) samples the
// frame rate afterwards. ?raf=1 runs the counter throughout: the "something else on screen draws every frame" case.
const fs = window.__fs = { frames: 0, last: performance.now(), over20: 0, over34: 0, over50: 0, maxGap: 0 };
const tick = (t) => { const g = t - fs.last; fs.last = t; fs.frames++; if (g > 20) fs.over20++; if (g > 34) fs.over34++;
  if (g > 50) fs.over50++; if (g > fs.maxGap) fs.maxGap = g; requestAnimationFrame(tick); };
if (p.get('raf')) requestAnimationFrame(tick);
window.__count = (ms) => new Promise((done) => requestAnimationFrame((t0) => {
  const s = { frames: 0, over20: 0, over34: 0, over50: 0, maxGap: 0 };
  let last = t0;
  const step = (t) => { const g = t - last; last = t; s.frames++; if (g > 20) s.over20++; if (g > 34) s.over34++;
    if (g > 50) s.over50++; if (g > s.maxGap) s.maxGap = g;
    if (t < t0 + ms) requestAnimationFrame(step); else done({ ...s, fps: 1000 * s.frames / (t - t0) }); };
  requestAnimationFrame(step);
}));
window.__info = info;
</script>
"""


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return ''


def fetch_modules():
    """livescene.js and everything it imports, followed from the import lines so it never goes stale."""
    os.makedirs(WWW, exist_ok=True)
    todo, seen = ['livescene.js'], set()
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        with urllib.request.urlopen(f'{SITE}/{name}', timeout=30) as r:
            src = r.read().decode('utf-8')
        with open(f'{WWW}/{name}', 'w', encoding='utf-8') as f:
            f.write(src)
        todo += re.findall(r"""^\s*(?:import|export)[^'"]*?from\s+['"]\./([^'"]+)['"]""", src, re.M)
    with open(f'{WWW}/bench.html', 'w', encoding='utf-8') as f:
        f.write(PAGE)
    return sorted(seen)


def procs():
    out = {}
    for d in os.listdir('/proc'):
        if not d.isdigit():
            continue
        try:
            with open(f'/proc/{d}/stat') as f:
                s = f.read()
            r = s[s.rfind(')') + 2:].split()
            with open(f'/proc/{d}/cmdline', 'rb') as f:
                # Chromium rewrites its process title into ONE space-joined string, so split on spaces.
                args = b' '.join(f.read().split(b'\0')).decode(errors='replace').split()
            out[int(d)] = (int(r[1]), args, int(r[11]) + int(r[12]))
        except Exception:
            pass
    return out


def tree(root, P):
    kids = {}
    for pid, (pp, _, _) in P.items():
        kids.setdefault(pp, []).append(pid)
    seen, todo = set(), [root]
    while todo:
        p = todo.pop()
        if p in seen or p not in P:
            continue
        seen.add(p)
        todo += kids.get(p, [])
    return seen


def ptype(args):
    for a in args:
        if a.startswith('--type='):
            return {'gpu-process': 'gpu', 'renderer': 'renderer'}.get(a[7:], 'other')
    return 'browser' if args and 'chrom' in args[0] else 'other'


def kiosk_root(P):
    for pid, (_, args, _) in P.items():
        if args and args[0].endswith('chromium') and '--kiosk' in args \
                and not any(a.startswith('--type=') for a in args) and not any(PROFILE in a for a in args):
            return pid
    return None


def drm_clients(pids):
    """V3D nanoseconds per DRM client id, (render, bin), deduped across fds."""
    out = {}
    for pid in pids:
        try:
            fds = os.listdir(f'/proc/{pid}/fdinfo')
        except Exception:
            continue
        for fd in fds:
            try:
                with open(f'/proc/{pid}/fdinfo/{fd}') as f:
                    txt = f.read()
            except Exception:
                continue
            if 'drm-driver:\tv3d' not in txt:
                continue
            kv = dict(line.split(':', 1) for line in txt.splitlines() if ':' in line)
            ns = lambda k: int((kv.get(k) or '0').split()[0])
            out[kv.get('drm-client-id', '').strip()] = (ns('drm-engine-render'), ns('drm-engine-bin'))
    return out


def gpu_stats():
    with open(GPU_STATS) as f:
        return {q[0]: int(q[3]) for q in (line.split() for line in f.read().splitlines()[1:])}


def cpu_total():
    with open('/proc/stat') as f:
        v = [int(x) for x in f.readline().split()[1:]]
    return sum(v), sum(v) - v[3] - v[4]


def temp():
    try:
        return float(sh('vcgencmd measure_temp').split('=')[1].split("'")[0])
    except Exception:
        return None


def snapshot(mine_root):
    P = procs()
    k = kiosk_root(P)
    groups = {'mine': tree(mine_root, P) if mine_root else set(), 'kiosk': tree(k, P) if k else set(),
              'labwc': {pid for pid, (_, a, _) in P.items() if a and a[0].endswith('labwc')}}
    snap = {'t': time.monotonic(), 'cpu': cpu_total(), 'gpu': gpu_stats(), 'ticks': {}, 'drm': {}}
    for g, pids in groups.items():
        by = {}
        for pid in pids:
            t = ptype(P[pid][1]) if g != 'labwc' else 'labwc'
            by[t] = by.get(t, 0) + P[pid][2]
        snap['ticks'][g], snap['drm'][g] = by, drm_clients(pids)
    return snap


def diff(a, b):
    dt = b['t'] - a['t']
    tot = b['cpu'][0] - a['cpu'][0]
    out = {'seconds': round(dt, 1),
           'system_cpu_pct_of_4_cores': round(100 * (b['cpu'][1] - a['cpu'][1]) / tot, 1) if tot else None}
    for g in b['ticks']:
        cores = {t: round(100 * (b['ticks'][g].get(t, 0) - a['ticks'][g].get(t, 0)) / HZ / dt, 1) for t in b['ticks'][g]}
        cores['total'] = round(sum(cores.values()), 1)
        out[g + '_cpu_pct'] = cores
        same = [c for c in b['drm'][g] if c in a['drm'][g]]
        out[g + '_v3d_pct'] = {q: round(100 * sum(b['drm'][g][c][i] - a['drm'][g][c][i] for c in same) / 1e9 / dt, 1)
                               for i, q in enumerate(('render', 'bin'))}
    out['v3d_chip_pct'] = {q: round(100 * (b['gpu'][q] - a['gpu'][q]) / 1e9 / dt, 1) for q in ('render', 'bin')}
    return out


class CDP:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def send(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('id') == self.n:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})

    async def js(self, expr, wait=False):
        r = await asyncio.wait_for(self.send('Runtime.evaluate', expression=expr, returnByValue=True,
                                             awaitPromise=wait), 60)
        return r.get('result', {}).get('value')

    async def trace(self, nav_url, seconds=4):
        """Chromium's own verdict per animation, from the DevTools 'Animation' trace events: which ones it
        could not run on the compositor, and why (compositeFailed bits, unsupportedProperties)."""
        await self.send('Tracing.start', categories='devtools.timeline,blink.animations', transferMode='ReportEvents')
        await self.send('Page.navigate', url=nav_url)
        await asyncio.sleep(seconds)
        self.n += 1
        await self.ws.send(json.dumps({'id': self.n, 'method': 'Tracing.end', 'params': {}}))
        events = []
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), 60))
            if msg.get('method') == 'Tracing.dataCollected':
                events += msg['params']['value']
            elif msg.get('method') == 'Tracing.tracingComplete':
                break
        verdict = {}
        for e in events:
            d = (e.get('args') or {}).get('data') or {} if e.get('name') == 'Animation' else {}
            if 'compositeFailed' in d or 'unsupportedProperties' in d:
                k = (f"{d.get('name') or d.get('displayName') or '?'} | failed={d.get('compositeFailed')}"
                     f" | {','.join(d.get('unsupportedProperties') or [])}")
                verdict[k] = verdict.get(k, 0) + 1
        return {'animation_events': sum(e.get('name') == 'Animation' for e in events), 'not_composited': verdict}

    async def metrics(self):
        return {m['name']: m['value'] for m in (await self.send('Performance.getMetrics')).get('metrics', [])}


async def window(label, mine_root, cdp=None, seconds=MEASURE):
    log('measure', label, f'{seconds:g}s')
    temps = [temp()]
    if cdp:
        await cdp.js('window.__fs && (window.__fs.maxGap = 0)')
        f0 = json.loads(await cdp.js('JSON.stringify(window.__fs)'))
        m0 = await cdp.metrics()
    a = snapshot(mine_root)
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        await asyncio.sleep(min(5, max(0, end - time.monotonic())))
        temps.append(temp())
    res = {'label': label, **diff(a, snapshot(mine_root))}
    if cdp:
        f1 = json.loads(await cdp.js('JSON.stringify(window.__fs)'))
        m1 = await cdp.metrics()
        ms = f1['last'] - f0['last']
        if f1['frames'] - f0['frames'] > 10:       # ?raf=1: the counter ran through the CPU window
            res['page'] = {'fps': round(1000 * (f1['frames'] - f0['frames']) / ms, 1) if ms else None,
                           **{k: f1[k] - f0[k] for k in ('over20', 'over34', 'over50')},
                           'max_gap_ms': round(f1['maxGap'], 1), 'mode': 'continuous'}
        else:                                       # nothing asked for frames; sample 5 s afterwards
            s = json.loads(await cdp.js('window.__count(5000).then(JSON.stringify)', wait=True))
            res['page'] = {'fps': round(s['fps'], 1), **{k: s[k] for k in ('over20', 'over34', 'over50')},
                           'max_gap_ms': round(s['maxGap'], 1), 'mode': 'sampled 5s after'}
        span = (m1.get('Timestamp', 0) - m0.get('Timestamp', 0)) or seconds
        res['main_thread_ms_per_s'] = {k: round(1000 * (m1.get(k, 0) - m0.get(k, 0)) / span, 1)
                                       for k in ('TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration')}
        res['census'] = json.loads(await cdp.js('JSON.stringify(window.__info)') or 'null')
    t = [x for x in temps if x is not None]
    res['temp_c'] = {'start': t[0], 'end': t[-1], 'max': max(t)} if t else None
    res['throttled'] = sh('vcgencmd get_throttled')
    log(json.dumps(res))
    return res


def url(spec):
    head, _, extra = spec.partition('?')
    scene, _, variant = head.partition(':')
    q = [('scene', scene)] + ([('variant', variant)] if variant else []) + urllib.parse.parse_qsl(extra)
    return f'http://127.0.0.1:{HTTP_PORT}/bench.html?' + urllib.parse.urlencode(q)


async def main():
    results = {'runs': [], 'start': time.strftime('%Y-%m-%d %H:%M:%S'), 'site': SITE,
               'settle_s': SETTLE, 'measure_s': MEASURE, 'throttled_before': sh('vcgencmd get_throttled')}
    shutil.rmtree(WORK, ignore_errors=True)
    results['modules'] = fetch_modules()
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(HTTP_PORT), '--bind', '127.0.0.1', '--directory', WWW],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    browser = None
    try:
        if BASE > 0:
            results['kiosk_only_before'] = await window('kiosk_only_before', None, None, BASE)
        # `timeout` is the belt and braces: whatever happens to this script, the window goes in 40 minutes.
        args = ['timeout', '2400', 'chromium', f'--remote-debugging-port={CDP_PORT}', f'--user-data-dir={PROFILE}',
                '--ozone-platform=wayland', '--use-angle=gles', '--enable-gpu-rasterization',   # the kiosk's own GPU flags
                '--kiosk', '--start-maximized', '--noerrdialogs', '--disable-infobars',
                '--disable-session-crashed-bubble', '--no-first-run', '--no-default-browser-check',
                '--password-store=basic', url('blank')]
        browser = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True, env=ENV)
        targets = []
        for _ in range(60):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json/list', timeout=1) as r:
                    targets = [t for t in json.loads(r.read()) if t.get('type') == 'page']
                if targets:
                    break
            except Exception:
                pass
            await asyncio.sleep(1)
        if not targets:
            raise RuntimeError('devtools never answered')
        with urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json/version', timeout=2) as r:
            results['browser'] = json.loads(r.read()).get('Browser')
        async with websockets.connect(targets[0]['webSocketDebuggerUrl'], max_size=None, open_timeout=30) as ws:
            cdp = CDP(ws)
            await cdp.send('Runtime.enable')
            await cdp.send('Performance.enable')
            for spec in RUNS:
                await cdp.send('Page.navigate', url=url(spec))
                await asyncio.sleep(SETTLE)
                results['runs'].append(await window(spec, browser.pid, cdp))
                if os.environ.get('SHOTS'):
                    tag = ''.join(c if c.isalnum() else '_' for c in spec)
                    sh(f'grim -s 0.5 -t png {WORK}/shot_{tag}.png')     # this grim build has no jpeg
            for spec in os.environ.get('TRACE', '').split():     # TRACE="christmas fall": the not-composited list
                tr = {'label': 'trace ' + spec, **(await cdp.trace(url(spec)))}
                log(json.dumps(tr))
                results.setdefault('traces', []).append(tr)
    except Exception as e:
        results['error'] = repr(e)
        log('ERROR', repr(e))
    finally:
        for p in (browser, srv):
            if p:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                except Exception:
                    pass
        for _ in range(20):
            if not browser or browser.poll() is not None:
                break
            time.sleep(0.5)
        if browser:
            try:
                os.killpg(browser.pid, signal.SIGKILL)
            except Exception:
                pass
        time.sleep(3)
        # Chromium also leaves /tmp/org.chromium.Chromium.XXXXXX (its singleton socket) per launch; ours is
        # the one this profile's SingletonSocket link points at, and only that one goes.
        try:
            sock = os.readlink(PROFILE + '/SingletonSocket')
            if '/org.chromium.Chromium.' in sock:
                shutil.rmtree(os.path.dirname(sock), ignore_errors=True)
        except OSError:
            pass
        shutil.rmtree(PROFILE, ignore_errors=True)
        results['leftover_pids'] = [p for p, (_, a, _) in procs().items() if any(PROFILE in x for x in a)]
    if BASE > 0:
        await asyncio.sleep(10)
        results['kiosk_only_after'] = await window('kiosk_only_after', None, None, BASE)
    results['throttled_after'] = sh('vcgencmd get_throttled')
    if not os.environ.get('KEEP'):
        shutil.rmtree(WORK, ignore_errors=True)
    print('=====RESULT=====')
    print(json.dumps(results, indent=1))


asyncio.run(main())
