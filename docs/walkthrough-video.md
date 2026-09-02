# The walkthrough video — how to re-record it when the UI moves

The whole point of building it this way is that the answer is "run two commands", not "book an
afternoon". A hand-recorded screen capture is stale the first time a button moves; this is a
test that happens to produce a film.

```bash
cd web/tools
python record_walkthrough.py --base https://nimrodecosystem.com
python narrate.py --mux
```

That gives you `walkthrough_out/walkthrough.webm` (film + narration) and
`walkthrough_out/walkthrough.vtt` (captions). Neither is committed — see **Hosting**.

---

## One list, five consumers

`web/client/steps.js` is the script, the tour, the captions, the transcript and the recorder's
instructions, all at once. Edit it and everything downstream follows. Do not write the tour
twice.

**The recorder EXECUTES that list**, so a selector that has gone stale fails the recording. That
makes the video run a test of the guided tour — a tour that silently points at a button that
moved is the classic rot in this kind of feature, and here it cannot rot quietly.

**Treat a failed recording as a failed suite.** It has already earned this: on its first run it
caught `.k-mods`, which is present in the DOM but empty and zero-sized on a laid-out screen, so
the tour would have drawn a ring around nothing.

```bash
python record_walkthrough.py --check          # resolve every selector, record nothing
```

That is the cheap version, it needs no data gate because it films nothing, and it is what to run
after touching any markup the tour points at.

---

## The data gate

**Never film a real bedside instance.** A recording of one would put somebody's photographs,
voice clips and name on a public landing page — worse than anything the source-code scrub was
about, and it cannot be taken back.

The recorder refuses unless the kiosk booted its **signed-out demo screen**, and it checks that
by asking the page rather than the server: `[data-way-out]` is mounted by exactly one branch of
`kiosk.html`, so its presence proves the seeded starter screen and bundled sample media are what
is on camera. The affordance that lets a visitor leave the demo is the same one that proves this
is the demo.

**Locally the gate will refuse, and that is correct.** Dev mode resolves a missing session to a
shared `dev-user`, so a local kiosk mounts whatever profiles that user has — every test screen
anybody ever made. Record against the deployed site signed out, which is the right target anyway
since the video should show what a visitor actually gets.

`--allow-account` overrides it, and exists for the dedicated demo account. It makes you say so
out loud.

---

## Narration

Piper, using the voice model already on the machine — the voice the product itself speaks with.
Mike's reasoning: *"something we'll be redoing with different builds. Better to be able to get it
in one take."* A re-runnable recorder needs re-runnable narration.

```bash
pip install piper-tts          # the model is at ~/piper/en_US-libritts-high.onnx
python narrate.py              # audio + captions
python narrate.py --mux        # ...laid over the film
python narrate.py --no-recording   # hear the script before filming anything
```

**One clip per step, not one long file.** Editing a sentence should cost a sentence, not a
re-render of three minutes — and the clips have to be *placed* against the timings the recording
actually produced, so a step that ran long because a page was slow still has its line start on
time.

`--length-scale` is pace; the default is deliberately slower than a marketing read, because the
audience includes people who need it slower.

### If a line overruns its step

`narrate.py` reports slack per step and exits non-zero if any line runs past its picture.
**Lengthen `settle` in `steps.js`, or cut the line. Do not speed up the voice.** Holds are
derived by `holdMs()` — the longer of "how long the shot wants" and "how long the words take" —
which is what stops the film and its script drifting apart. The first real recording came out 39
seconds against 126 seconds of narration before that existed.

---

## Accessibility, which is not optional here

A walkthrough of accessibility software that is itself inaccessible would be its own argument
against the product.

- **Captions** are generated from the same `say` text and the same real timings, never typed out
  again and never estimated from word counts.
- **A full transcript belongs on the page**, so the video is not the only way to get the
  information. `transcript()` in `steps.js` produces it, grouped by scene.
- **Autoplay muted or not at all**, and honor `prefers-reduced-motion` — the same setting
  `wallpaper.js` reads.
- **No flashing or hard cuts on bright frames.** The flash-rate reasoning already written for the
  wallpaper is the standard.
- Controls reachable by keyboard, and not a custom player that traps focus.

---

## Hosting

`walkthrough_out/` and `*.webm` are gitignored. `DECISIONS.md` is explicit that a video does not
go into the tree by reflex, and a ~4 MB binary in every clone is exactly that.

The answer, in order of preference:

1. **A GitHub release asset** — attached to the repo, in nobody's clone. The same answer already
   reached for the model files.
2. Served by the platform host beside the client, with a poster and click-to-play so the bytes
   are only fetched by people who ask for them.
3. A third-party host. Cheapest, and the one that most contradicts what the landing page says
   about not sending anyone's data anywhere. Flag it rather than assuming it.

---

## What is not built

**The guided tour itself.** `steps.js` carries `tour: true/false` and the constraints are
written down — one button, one direction, wrapping; dismissable from step one; never a gate;
reduced motion governs any highlight — but nothing renders it yet. It is a candidate **module**
rather than a shell feature, and a tour that explains modules while being one is the sort of
recursion worth raising before it is built as a special case.

**The demo account.** `NimrodEcosystem@gmail.com` is the intended one. Until it exists, the
signed-out kiosk's seeded screen is what gets filmed, which is safe and is what a visitor sees
anyway.
