#!/usr/bin/env python3
"""record_walkthrough.py — drive the real site while Playwright films it.

    python record_walkthrough.py --base http://127.0.0.1:8000

WHY A SCRIPT AND NOT A SCREEN CAPTURE. A hand-recorded capture is stale the first time the UI
moves, and re-recording means re-doing the whole take. This is re-runnable: the UI changes, you
run it again, you get a new video. It is a test that happens to produce a film.

*** AND IT IS A TEST OF THE GUIDED TOUR, WHICH IS THE POINT. *** The step list in
`web/client/steps.js` is the single source for the recorder, the narration, the captions, the
transcript AND the on-site guided tour. This script EXECUTES that list, so a selector that has
gone stale fails the recording. A tour that silently points at a button that moved is the classic
rot in this kind of feature; here it cannot rot quietly.

**Treat a failed recording as a failed suite.** `--check` runs every selector against the live
pages and reports, without recording anything — that is the cheap version to run in a hurry.

---------------------------------------------------------------------------------------
THE DATA GATE
---------------------------------------------------------------------------------------

This must never run against a real bedside instance. A recording of one would put somebody's
photographs, voice clips and name on a public landing page, which is worse than anything the
source-code scrub was about and cannot be taken back.

So it refuses to start unless the target is a signed-out or demo surface: it drives the LOCAL
signed-out kiosk, whose data is the seeded starter screen and bundled sample media, and it
asserts that before it films anything. `--allow-account` exists for the day there is a dedicated
demo account, and it makes the operator say so out loud.

---------------------------------------------------------------------------------------
WHAT IT DOES NOT DO
---------------------------------------------------------------------------------------

No narration. Piper generates that from the same `say` fields, separately, and the audio is muxed
afterwards with ffmpeg — because a recorder that also shells out to a TTS binary is two tools that
fail as one. `--timings` writes the per-step timings this run actually measured, which is what the
caption file is built from; guessing them from word counts would put the captions out of sync with
the film the moment a page loads slowly.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parent / 'client'
STEPS_JS = CLIENT / 'steps.js'


# ---------------------------------------------------------------------------------------
# READING THE STEP LIST
# ---------------------------------------------------------------------------------------
#
# The list lives in a JS module because five of its six consumers are in the browser. Rather
# than duplicate it into Python — which is how two lists that must agree stop agreeing — this
# asks the browser for it. The page is loaded, the module imported, and the value handed back
# as JSON. One list, and Python never gets its own copy.
def load_steps(page, base):
    page.goto(f'{base}/landing.html', wait_until='domcontentloaded')
    return page.evaluate("""async (base) => {
        const m = await import(base + '/steps.js');
        // `_holdMs` is computed HERE rather than in Python, so the recorder and the caption
        // builder get the number from the same function instead of two implementations of it.
        const steps = m.STEPS.map((s) => ({ ...s, _holdMs: m.holdMs(s) }));
        return { steps, scenes: m.SCENES, budget: m.wordBudget(), seed: m.demoSeed() };
    }""", base)


# ---------------------------------------------------------------------------------------
# THE GATE
# ---------------------------------------------------------------------------------------
def assert_demo_surface(page, base, allow_account):
    """Refuse to film anything that might be somebody's real screen.

    *** THE GATE ASKS THE KIOSK WHAT IT ACTUALLY BOOTED, not what the server says. ***

    The first version checked `/api/me` for a session, and it was wrong in the environment this
    will be run in most. In dev, `identity.py` resolves a missing session to a shared `dev-user`,
    so a local kiosk takes the SIGNED-IN path and mounts whatever profiles that user has
    accumulated — on a development machine, every test screen anybody ever made. The gate
    refused for the right reason and the wrong evidence; on the live site the same check would
    have waved it through without ever looking at what was on screen.

    So it asks the page instead. `[data-way-out]` is mounted by exactly one branch of
    `kiosk.html` — the signed-out local boot — because that is the only path a stranger can be
    on. Its presence is proof that the kiosk is running its SEEDED starter screen over bundled
    sample media, which is precisely what is safe to film.

    A property rather than a coincidence: the affordance that exists so a visitor can get out of
    the demo is the same one that proves this IS the demo.
    """
    if allow_account:
        print('  !! --allow-account: filming a signed-in surface because you said so.')
        return

    page.goto(base + '/kiosk.html', wait_until='domcontentloaded')
    try:
        page.wait_for_selector('[data-way-out]', timeout=12000)
    except Exception:
        sys.exit(
            "REFUSING TO RECORD: the kiosk did not boot its signed-out demo screen, so what is\n"
            "on it is somebody's real account rather than seeded sample data.\n\n"
            "Locally this is expected — dev mode resolves a missing session to a shared dev\n"
            "user, so the kiosk mounts that user's profiles. Record against the DEPLOYED site\n"
            "signed out, which is the right target anyway since the video should show what a\n"
            "visitor actually gets:\n\n"
            "    python record_walkthrough.py --base https://nimrodecosystem.com\n\n"
            "Or pass --allow-account if you are deliberately signed in as the demo account.")
    print('  gate: the kiosk booted its seeded demo screen (signed-out path confirmed).')


# ---------------------------------------------------------------------------------------
# PERFORMING ONE STEP
# ---------------------------------------------------------------------------------------
def perform(page, step, base, timeout_ms):
    """Do what the step says. Returns (ok, detail)."""
    action, target = step.get('action'), step.get('target')

    if step.get('page'):
        want = base + step['page']
        # Only navigate when the page actually changes: a re-goto reloads and throws away the
        # state the previous steps just built.
        if page.url.rstrip('/') != want.rstrip('/'):
            page.goto(want, wait_until='domcontentloaded')
            page.wait_for_timeout(600)

    if action in (None, 'none', 'wait'):
        return True, 'no action'

    if not target:
        return False, f'{action} with no target'

    try:
        el = page.locator(target).first
        # A KEYPRESS GOES TO THE PAGE, NOT TO AN ELEMENT. Its target exists so the tour has
        # something to highlight, so it must RESOLVE — but requiring it to be visible was
        # wrong, and it produced a failure that read like a stale selector when the element was
        # simply not on screen for this shape of screen. `attached` still catches a target that
        # no longer exists, which is the failure worth catching.
        el.wait_for(state='attached' if action == 'press' else 'visible', timeout=timeout_ms)
    except Exception as exc:
        # THIS IS THE FAILURE THAT MATTERS. A selector that no longer resolves means the guided
        # tour would point at nothing, and the recording is how we find out.
        return False, f'selector not found: {target}  ({type(exc).__name__})'

    try:
        if action == 'click':
            el.click()
        elif action == 'type':
            el.fill('')
            el.type(step.get('value', ''), delay=55)   # delay so typing is legible on film
        elif action == 'press':
            page.keyboard.press(step.get('value', ''))
        else:
            return False, f'unknown action {action}'
    except Exception as exc:
        return False, f'{action} failed: {type(exc).__name__}'

    return True, action


# ---------------------------------------------------------------------------------------
# HIGHLIGHT — so the film points at what the narration is talking about
# ---------------------------------------------------------------------------------------
#
# Injected rather than added to the product: the ring belongs to the recording, not to the
# kiosk, and a highlight that shipped would be one more thing on a bedside screen.
HIGHLIGHT = """
(sel) => {
  document.querySelectorAll('[data-rec-ring]').forEach((n) => n.remove());
  if (!sel) return;
  const el = document.querySelector(sel);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.setAttribute('data-rec-ring', '');
  ring.style.cssText = [
    'position:fixed', `left:${r.left - 6}px`, `top:${r.top - 6}px`,
    `width:${r.width + 12}px`, `height:${r.height + 12}px`,
    'border:3px solid #F7C948', 'border-radius:10px', 'pointer-events:none',
    'z-index:2147483000', 'box-shadow:0 0 0 4px rgba(247,201,72,.25)',
  ].join(';');
  document.body.append(ring);
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8000')
    ap.add_argument('--out', default=str(HERE / 'walkthrough_out'))
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=720)
    ap.add_argument('--timeout', type=int, default=8000, help='ms to wait for a selector')
    ap.add_argument('--check', action='store_true',
                    help='resolve every selector and report; record nothing')
    ap.add_argument('--allow-account', action='store_true',
                    help='film a signed-in surface (only for the dedicated demo account)')
    ap.add_argument('--no-highlight', action='store_true')
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('playwright is not installed.\n'
                 '    pip install playwright && python -m playwright install chromium')

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx_args = {
            'viewport': {'width': args.width, 'height': args.height},
            # A CLEAN CONTEXT, so there is no OS chrome, no profile name, no other tab and no
            # notification toast anywhere in the frame. Playwright's own viewport rather than a
            # desktop capture is what makes that true by construction.
            'reduced_motion': 'no-preference',
        }
        if not args.check:
            ctx_args['record_video_dir'] = str(out)
            ctx_args['record_video_size'] = {'width': args.width, 'height': args.height}

        ctx = browser.new_context(**ctx_args)
        page = ctx.new_page()

        data = load_steps(page, args.base)
        steps, budget = data['steps'], data['budget']
        print(f'{len(steps)} steps · {budget["words"]} words · '
              f'~{budget["estimateSeconds"]}s of {budget["capSeconds"]}s'
              + ('   OVER BUDGET' if budget['overBudget'] else ''))
        if budget['overBudget']:
            print('  !! the script is longer than the cap. Cut it before recording.')

        # THE GATE PROTECTS THE RECORDING, so --check does not need it: nothing is filmed,
        # so nothing can be published. Making --check pass the gate would mean the cheap way
        # to verify selectors is unavailable on the machine where they are edited, which is
        # the one place it needs to be cheap.
        if args.check:
            print('  gate: skipped — --check records nothing.')
        else:
            assert_demo_surface(page, args.base, args.allow_account)

        timings, failures = [], []
        t0 = time.time()
        for i, step in enumerate(steps, 1):
            started = time.time()
            ok, detail = perform(page, step, args.base, args.timeout)
            if not ok:
                failures.append((step['id'], detail))
                print(f'  {i:2}. FAIL  {step["id"]:12} {detail}')
                continue

            if not args.no_highlight and step.get('target'):
                try: page.evaluate(HIGHLIGHT, step['target'])
                except Exception: pass

            # THE LONGER OF "how long the shot wants" and "how long the line takes". The first
            # real recording was 39s against 126s of narration, because every settle was
            # shorter than the sentence spoken over it. `holdMs` lives in steps.js so the
            # caption builder computes the same number.
            hold = step.get('_holdMs') or step.get('settle') or 0
            if not args.check and hold:
                page.wait_for_timeout(hold)

            timings.append({
                'id': step['id'], 'scene': step['scene'],
                'startMs': int((started - t0) * 1000),
                'endMs': int((time.time() - t0) * 1000),
                'say': step.get('say'),
            })
            print(f'  {i:2}. ok    {step["id"]:12} {detail}')

        # The timings this run actually measured. The caption file is built from these rather
        # than from word counts, so a slow page load cannot put the captions out of sync.
        (out / 'timings.json').write_text(
            json.dumps({'steps': timings, 'budget': budget}, indent=2), encoding='utf-8')

        ctx.close()          # the WebM is written on close, not before
        browser.close()

    print()
    if failures:
        print(f'{len(failures)} STEP(S) FAILED — treat this as a failed suite:')
        for sid, detail in failures:
            print(f'   {sid}: {detail}')
        print('\nA selector that no longer resolves means the GUIDED TOUR would point at')
        print('nothing. Fix steps.js (or the page) before re-recording.')
        sys.exit(1)

    if args.check:
        print('every selector resolved. Nothing was recorded (--check).')
    else:
        vids = sorted(out.glob('*.webm'))
        print(f'recorded: {vids[-1] if vids else "NO VIDEO — did the context close?"}')
        print(f'timings:  {out / "timings.json"}')
        print('\nNext: narration from the same `say` fields (Piper), then mux with ffmpeg.')


if __name__ == '__main__':
    main()
