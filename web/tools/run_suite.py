#!/usr/bin/env python3
"""run_suite.py - RUN A dev/*_test.html SUITE FROM A TERMINAL AND PRINT WHAT IT SAID.

*** WHY THIS EXISTS, AND IT IS NOT CONVENIENCE. ***

Every suite in `web/client/dev/` reports into `#summary` on the page, so reading one has always
meant having a browser pointed at it. The browsers available to an agent working on this repo
are both HIDDEN - a background tab in an automated pane, or a Chrome window that is not on
screen - and a hidden document is not a slower browser, it is a different one:

    measured 2026-09-06, in both:  document.hidden === true
                                   requestAnimationFrame  never fires
                                   ResizeObserver         never delivers, not even the
                                                          initial observation

So any suite that measures LAYOUT REACTING TO A CHANGE cannot run there at all. `fit_test`
is exactly that suite, and its resize section reported three false failures for a fix that
works - which is the same trap `run_all.html` documents at length for the amber `no summary`
rows, arrived at from the other direction.

Headless Chrome is not hidden. `document.hidden` is false, rAF runs, ResizeObserver delivers.
That is the whole trick, and it is why this is a tool and not a workaround.

USAGE, from the repo root, with the server already running:

    web/server/.venv/Scripts/python web/tools/run_suite.py fit
    web/server/.venv/Scripts/python web/tools/run_suite.py fit panel_fit photos

Each argument is a suite NAME (`fit` -> `dev/fit_test.html`) or a full path/URL. Exit status is
0 only if every suite finished and reported zero failures, so it is usable from a hook or CI.

    SUITE_BASE   default http://localhost:8000 - point it at the live site to check a deploy
    SUITE_WAIT   seconds to wait for a summary, default 90
    SUITE_HEAD   set to anything to watch it happen in a real window instead of headless

AND IT TAKES PICTURES, which is the other half of the same problem. A page can be measured all
day and still look wrong, and the pane available here is 800x520 no matter what it is asked for -
so a layout written for a 1400px browser cannot be SEEN in it at all.

    web/tools/run_suite.py --shot out/ modules.html landing.html

`--shot <dir>` captures each page full-height instead of waiting for a summary, at
SHOT_SIZE (default 1400x900). Any argument ending in `.html` is a page rather than a suite.
"""
import asyncio
import glob
import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

# *** THE OUTPUT IS UTF-8, BECAUSE THE THING BEING PRINTED IS A WEB PAGE. ***
#
# A Windows console defaults to cp1252, and a failing check whose text contains a tick, an arrow
# or an em dash then kills this tool with a UnicodeEncodeError WHILE IT IS REPORTING A FAILURE.
# That is the worst possible moment to crash: the run is thrown away and the failure it was in
# the middle of printing is lost. `errors='replace'` rather than a stricter mode for the same
# reason — a character that cannot be shown must not be able to hide a result.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

BASE = os.environ.get('SUITE_BASE', 'http://localhost:8000').rstrip('/')
WAIT = float(os.environ.get('SUITE_WAIT', '90'))


def free_port():
    """*** A FIXED DEBUGGING PORT IS A TRAP, AND IT CAUGHT ME WITHIN THE HOUR. ***

    This started as `PORT = 9224`, chosen to avoid 9222 (a person's own Chrome) and 9223
    (pi_bench). Then a long run was left in the background while a short one was started in
    front of it, and the second Chrome could not bind the port, so `/json/list` answered from
    the FIRST one — and the second run drove the first run's browser. It reported `view` as
    failing with `fit`'s results, naming a check `view_test.html` does not contain.

    That is worse than a crash: two runs quietly sharing one browser produce results that look
    ordinary and belong to the wrong page. An ephemeral port per process cannot collide."""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


PORT = free_port()

CHROME = next((p for p in [
    os.environ.get('CHROME_PATH', ''),   # explicit override, e.g. a CI step that installs one
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    os.path.expanduser(r'~\AppData\Local\Google\Chrome\Application\chrome.exe'),
    # A GitHub Actions ubuntu runner's pre-installed browser goes by one of these names
    # depending on the image; `chromium`/`google-chrome` already covered the common cases.
    shutil.which('chromium') or '', shutil.which('google-chrome') or '',
    shutil.which('google-chrome-stable') or '', shutil.which('chromium-browser') or '',
] if p and os.path.exists(p)), None)


def http_json(path, tries=60):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=1) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f'devtools never answered on {PORT}')


class CDP:
    """The three calls this needs, and no framework. Same shape as pi_bench.py's."""

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

    async def js(self, expr, timeout=30):
        r = await asyncio.wait_for(self.send(
            'Runtime.evaluate', expression=expr, awaitPromise=True,
            returnByValue=True, allowUnsafeEvalBlockedByCSP=True), timeout)
        if r.get('exceptionDetails'):
            return {'__error__': str(r['exceptionDetails'].get('text'))}
        return r.get('result', {}).get('value')


def url_for(name):
    """The URL for a suite name, a page name, or a URL passed straight through.

    *** A FRESH `?user=` ON EVERY SUITE RUN, AND IT IS NOT COSMETIC. ***

    The suites default to a FIXED server-side user when none is given -- `youtube_test.html`
    uses `youtube-test-user` -- and several of them count rows they appended: "prev() did NOT
    log a play" asserts an exact number of play events. Run against the same user twice and
    those rows accumulate, so the count drifts and the check eventually fails for a reason that
    has nothing to do with the code.

    That is exactly what happened: `youtube` reported `plays=26 expected=23`, then passed twice
    in a row on re-run. A suite that fails on the third run and passes on the fourth teaches
    everybody to re-run until it is green, which is how a real failure gets waved through.

    `run_all.html` already solved this and this file had not copied the solution -- it appends
    `?user=runall-<name>-<random>` to every iframe. Same fix, same reason.
    """
    if name.startswith('http://') or name.startswith('https://'):
        url = name
    elif name.endswith('.html'):
        url = f'{BASE}/{name.lstrip("/")}'
    else:
        url = f'{BASE}/dev/{name}_test.html'
    # Only for suites, and only when the caller has not chosen a user themselves.
    if url.endswith('_test.html') and 'user=' not in url:
        stem = url.rsplit('/', 1)[-1][:-len('_test.html')]
        url += f'?user=suite-{stem}-{random.randint(0, 10**6)}'
    return url


# *** THERE ARE FOUR SUMMARY SHAPES IN dev/, AND READING ONLY SOME OF THEM MISREPORTS THE REST. ***
#
# Counted across every suite in the folder rather than guessed at:
#
#   79x   `${failed} FAILED / ${passed} passed`
#   49x   `ALL PASS — ${passed} checks`
#    n    `${passed} passed, ${failed} failed`
#    1    `PASS WITH SKIPS — ${n} checks, ${k} SKIPPED`
#
# The first version of this file read only the third and called `panel_fit`, `trivia`,
# `wordforge` and `board` FAIL while all four were green. The second added `ALL PASS` and then
# called `walkthrough` FAIL for saying `PASS WITH SKIPS`. Both times the harness was the thing
# that was broken, which is the failure mode this whole tool exists to remove.
#
# ORDER MATTERS: the failure shapes are tried FIRST, because a summary saying `2 FAILED / 40
# passed` contains the word `passed` and a looser pattern would happily read a pass out of it.
# A summary none of these match is reported as UNFINISHED, never as a pass — a suite still
# running says `running…`, which matches nothing here.
FAILED_OF = re.compile(r'(\d+)\s+FAILED\s*/\s*(\d+)\s+passed', re.I)
COUNTS = re.compile(r'(\d+)\s+passed,\s+(\d+)\s+failed', re.I)
PASSY = re.compile(r'(?:ALL\s+PASS|PASS\s+WITH\s+SKIPS)\D*(\d+)?', re.I)
# A WHOLE SUITE THAT COULD NOT RUN. `personal` says `SKIPPED - the personal-messages agent not
# running`, which is a suite declining to judge rather than a suite failing, and reporting it as
# FAIL is how a red that means "start a service" becomes a red nobody reads. Anchored at the
# start so a per-check "1 SKIPPED" inside a PASS line cannot be mistaken for it — which is why
# PASSY is tried first.
SKIPPED = re.compile(r'^\s*SKIPPED\b', re.I)
# A FIFTH SHAPE, IN A SECOND ELEMENT. `rng` and `statemachine` write `12/12 passed - all
# green` into `#tally`, not `#summary`. Neither this tool nor `run_all.html` looked at that
# element or that wording, so BOTH SUITES HAVE ALWAYS BEEN REPORTED AS UNFINISHED -- two
# healthy suites filed as hangs for as long as either harness has existed. Found by running
# all 86 in one go, which is the first time anybody had every verdict side by side.
SLASHED = re.compile(r'(\d+)\s*/\s*(\d+)\s+passed', re.I)


def parse_summary(text):
    m = FAILED_OF.search(text)
    if m:
        return int(m.group(2)), int(m.group(1))
    m = COUNTS.search(text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = PASSY.search(text)
    if m:
        return int(m.group(1) or 0), 0
    if SKIPPED.match(text):
        return (0, 0)
    m = SLASHED.search(text)
    if m:
        passed, total = int(m.group(1)), int(m.group(2))
        return passed, max(0, total - passed)
    return None


async def run_one(cdp, name):
    url = url_for(name)
    # *** THE NAVIGATION RESULT IS THE ONLY RELIABLE WAY TO KNOW THE SERVER IS DOWN. ***
    # A refused connection still leaves `location.href` set to the target and still puts text
    # in the body (Chrome's own "site can't be reached" page), so every heuristic read off the
    # DOM calls it a suite that loaded and stayed quiet. CDP says so plainly in `errorText`.
    nav = await cdp.send('Page.navigate', url=url)
    nav_error = nav.get('errorText') or ''
    # *** WAIT FOR THE NEW DOCUMENT BEFORE READING ANY SUMMARY. *** `Page.navigate` returns as
    # soon as the navigation is ACCEPTED, not when it has committed, so the first poll can still
    # be looking at the previous suite — whose summary is already there and already matches. The
    # result is the last suite's numbers printed under this suite's name, and nothing about it
    # looks wrong.
    deadline = time.time() + WAIT
    while time.time() < deadline:
        here = await cdp.js('location.href') or ''
        if here.split('?')[0].rstrip('/') == url.split('?')[0].rstrip('/'):
            break
        await asyncio.sleep(0.2)

    text = ''
    parsed = None
    while time.time() < deadline:
        # `#summary` is the convention; `#tally` is an older one two suites still use.
        # The harness should know the repo it reports on, rather than two working suites
        # being rewritten to satisfy the harness.
        text = await cdp.js(
            "((document.getElementById('summary')||document.getElementById('tally'))||{})"
            ".textContent || ''") or ''
        parsed = parse_summary(text)
        if parsed or text.startswith('threw'):
            break
        await asyncio.sleep(0.5)
    fails = await cdp.js(
        "JSON.stringify([...document.querySelectorAll('.fail')].map(e=>e.textContent.trim()))")
    fails = json.loads(fails) if isinstance(fails, str) else []

    # *** "(no summary)" MEANT FOUR DIFFERENT THINGS, AND ONE OF THEM COST AN HOUR. ***
    #
    # Every one of these printed the same amber line:
    #
    #   * the app server is not running at all   -> every suite fails at once
    #   * the suite name does not exist          -> a 404 page with no #summary in it
    #   * the page loaded and threw              -> a real defect, the only one worth chasing
    #   * the page is genuinely still running     -> the timeout was too short
    #
    # On 2026-09-06 the server had died and all 89 suites went amber. The message said nothing
    # about a server, so the obvious reading was "the change I just made broke everything" --
    # and the next twenty minutes went on stashing a correct change and instrumenting CDP to
    # prove a syntax error that was never there. The FIRST failure was `points`, a suite that
    # does not exist (the ledger is tested inside `quests_test.html`), which sent the hunt off
    # in a second wrong direction.
    #
    # A harness that reports on this repo has to be more honest than the repo. Same rule the
    # modules are held to: say what actually happened, not the symptom nearest to hand.
    detail = ''
    if not parsed and not text.startswith('threw'):
        title = await cdp.js('document.title') or ''
        body_len = await cdp.js('(document.body && document.body.textContent || "").length') or 0
        here = await cdp.js('location.href') or ''
        if nav_error:
            detail = (f' - THE SERVER DID NOT ANSWER ({nav_error}). Start the app server at '
                      + BASE + ' - run_suite does not start one.')
        elif not here or here == 'about:blank':
            detail = ' - THE PAGE NEVER LOADED. Is the app server running? ' + BASE
        elif '404' in title or 'Not Found' in title or int(body_len or 0) < 40:
            detail = f' - NO SUCH SUITE, or the page is empty ({url}).'
        else:
            detail = ' - the page loaded but never reported. It may still be running (raise '\
                     'SUITE_WAIT), or it threw before writing a summary.'
    return {'name': name, 'url': url,
            'text': (text.strip() or '(no summary)') + detail,
            'passed': parsed[0] if parsed else 0,
            'failed': parsed[1] if parsed else -1,
            'fails': fails}


async def shoot(cdp, name, outdir, w, h):
    url = url_for(name)
    await cdp.send('Emulation.setDeviceMetricsOverride',
                   width=w, height=h, deviceScaleFactor=1, mobile=False)
    await cdp.send('Page.navigate', url=url)
    deadline = time.time() + 20
    while time.time() < deadline:
        here = await cdp.js('location.href') or ''
        if here.split('?')[0].rstrip('/') == url.split('?')[0].rstrip('/'):
            break
        await asyncio.sleep(0.2)
    # Settle: several of these pages mount real modules, and a picture taken before they draw
    # shows an empty box and blames the layout for it.
    await asyncio.sleep(3.5)
    shot = await cdp.send('Page.captureScreenshot', format='png', captureBeyondViewport=True)
    import base64
    os.makedirs(outdir, exist_ok=True)
    safe = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
    path = os.path.join(outdir, f'{safe}.png')
    with open(path, 'wb') as f:
        f.write(base64.b64decode(shot['data']))
    return path


async def main(names, shotdir=None):
    if not CHROME:
        print('no chrome found - set one of the paths at the top of this file', file=sys.stderr)
        return 2
    # *** SWEEP WHAT EARLIER RUNS COULD NOT. ***
    #
    # The `finally` below removes this run's profile, and that is enough when the run ENDS. It
    # is not enough when the run is KILLED -- a timeout, a Ctrl-C, an agent moving a command to
    # the background -- because then the finally never executes at all. And on Windows even the
    # clean path can silently fail: Chrome holds handles under the profile for a moment after
    # terminate, rmtree raises, and `ignore_errors=True` swallows it.
    #
    # Measured on this machine 2026-09-07: four orphaned profiles, 45 MB each, 181 MB total, on
    # a disk with 10 GB free and a history of filling up. A test harness must not be the thing
    # that fills the disk it is testing on.
    #
    # Age-gated so two concurrent runs cannot delete each other's live profile.
    for old_dir in glob.glob(os.path.join(tempfile.gettempdir(), 'nimrod_suite_*')):
        try:
            if time.time() - os.path.getmtime(old_dir) > 900:
                shutil.rmtree(old_dir, ignore_errors=True)
        except OSError:
            pass
    profile = tempfile.mkdtemp(prefix='nimrod_suite_')
    args = [CHROME, f'--remote-debugging-port={PORT}', f'--user-data-dir={profile}',
            '--no-first-run', '--no-default-browser-check', '--window-size=1440,900',
            # A suite must not be judged against a permission prompt nobody can answer, and
            # several of these modules ask for a camera. Fake devices give them a real stream.
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            'about:blank']
    if not os.environ.get('SUITE_HEAD'):
        args.insert(1, '--headless=new')
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = next(t for t in http_json('/json/list') if t['type'] == 'page')
        async with websockets.connect(target['webSocketDebuggerUrl'],
                                      max_size=32 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.send('Page.enable')
            await cdp.send('Runtime.enable')
            hidden = await cdp.js('document.hidden')
            print(f'chrome up · document.hidden={hidden} · base={BASE}\n')
            if shotdir:
                w, h = (int(x) for x in os.environ.get('SHOT_SIZE', '1400x900').split('x'))
                for n in names:
                    print(f'shot  {n:<18} {await shoot(cdp, n, shotdir, w, h)}')
                return 0
            results = [await run_one(cdp, n) for n in names]
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    bad = 0
    for r in results:
        flag = 'skip' if SKIPPED.match(r['text']) else ('ok  ' if r['failed'] == 0 else 'FAIL')
        if r['failed'] != 0:
            bad += 1
        print(f"{flag}  {r['name']:<18} {r['text']}")
        for f in r['fails']:
            print(f"        {f}")
    print(f"\n{len(results) - bad} of {len(results)} suites clean")
    return 1 if bad else 0


if __name__ == '__main__':
    argv = sys.argv[1:]
    shotdir = None
    if argv and argv[0] == '--shot':
        shotdir = argv[1]
        argv = argv[2:]
    sys.exit(asyncio.run(main(argv or ['fit'], shotdir)))
