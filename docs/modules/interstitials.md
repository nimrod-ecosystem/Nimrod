# Interstitials — between-video messages + educational segments

**Type:** advisor spec, reopenable. Full brief captured 2026-08-11 (source: Mike's
`nimrod_interstitial_brief.md`). Summary + cross-refs live in `../../DECISIONS.md`.

> **CORRECTION (Mike, 2026-08-12) — SURFACE REVERSAL.** The interstitial is **ONE module that
> pops up IN the YouTube section between videos**, then returns to the video. It is **NOT** a
> separate multi-quadrant dashboard panel, and it does **NOT** embed its own self-view camera.
> The "three-/four-quadrant layout + invariant top-right camera" described below is **SUPERSEDED** —
> Mike: *"the three module setup was the wrong idea."* The **substance still holds** (generated =
> semantic data → live graphic in the profile theme + TTS in the profile voice; recorded = real
> media; weighted pick; skippable/non-blocking; content-as-meaning). What changes is the **surface**:
> a single pop-up in the YouTube stage, most likely triggered off YouTube's `ENDED` (ENDED → play an
> interstitial in place → resume `youtube/next`). The self-view camera stays its **own** module
> elsewhere on the dashboard. The nimrod_95 sub-slice-1 module (`web/client/modules/interstitials.js`,
> a standalone 2×2 renderer, validated 16/16) is **reference only for the generated-content flow** —
> rework the surface to the in-YouTube pop-up. Read the layout section below as historical.

> **CORRECTION to an earlier handoff:** this was previously scoped for the *old* Cici
> `dashboard_web`. That was wrong — build it on the **new Nimrod site** instead, and **leave the
> current Cici bedside dashboard as-is** (do not retrofit it). Building on the platform avoids
> doing this twice, and the feature depends on platform features (per-user themes, selectable
> voices, the module system) that the new site is built to have.

## What it is
Short segments that play **between videos**: personal messages (family / friends / staff
greetings, life memories) and educational bits (alphabet, counting, vocabulary, word games).
Each uses a **three-quadrant layout**, and the user's **self-view camera stays up** the whole
time (for somebody who cannot turn their head that rearview "mirror" is a constant orientation anchor — never cover it).

Layout during a segment:
- **Top-left:** the media — a recorded clip, or the Cici presenter for generated content.
- **Top-right:** UNCHANGED — the self-view camera stays.
- **Bottom-left:** a still photo of the subject / speaker, with their **name**.
- **Bottom-right:** the **graphic**, rendered LIVE (numeral(s) / letter(s) / spelled word +
  optional picture).

## Platform-wide content principle (adopt in the content-library + settings schema)
Store **meaning, not pixels; text, not fixed voice.** Content is semantic data; **theme, font,
colors, Cici, and voice are per-user settings the renderer reads.** Fall back to recorded /
authored media ONLY when a real human's voice or a specific image *is* the content.

This is not specific to interstitials — apply it site-wide (AAC boards, vision-probe stimuli,
word games, these segments). Payoff: theme and voice selection "just work" across every module
for free; content is never re-authored per theme or per voice; the library stays tiny and
universal. **(Add this to the Nimrod site; leave the current Cici as-is.)**

## Two content kinds
1. **Generated (generic/educational):** semantic data only, never pre-rendered.
   - BR graphic drawn **live in the user's active theme/font/colors** from the value
     (`count: 3`, `letters: "A"`, `word: "cup"`).
   - Audio spoken by **text-to-speech in the user's selected voice** — NOT recorded. Change the
     voice → everything re-speaks automatically. No re-recording, ever. Every user gets the
     alphabet / counting / vocab set for free.
2. **Recorded (personal):** family / friend / staff messages, life memories — the real human
   voice and face ARE the content. Play as recorded media (audio+still or video).

**Recordings are an OPTIONAL enhancement, never required.** Default for generic content is
TTS + live render; a user MAY record a generic item if a familiar voice lands better.

## Content library (data-driven)
One per-user JSON registry (mirrors the vision-probe stimuli pattern):
```
{
  id, kind: "message"|"alphabet"|"counting"|"vocab"|"memory"|"wordgame",
  mode: "generated" | "recorded",
  subjectName, subjectPhoto?,
  graphic: { type: "number"|"letters"|"word"|"none", value, picture? },   // generated
  speak: "text to speak via TTS",                                         // generated
  media: { audio?, video?, still? },                                      // recorded
  enabled, weight
}
```
Reuse assets: AAC art, vision-probe stimuli, word-game content, the user's photos.

## Voice engine (TTS)
- **Piper** (open-source, local, runs on a Pi, many natural voices) is the target voice engine —
  fully local + OSS, on-brand, and doubles as Cici's own voice. Browser Web Speech API is an
  acceptable interim/fallback.
- Voice is a **user setting**; generated segments follow whatever the user picks.
- Later nicety: letter *names* ("ay") work out of the box; phonics *sounds* ("ah") need a small
  curated pronunciation set / SSML. Not v1.

## Recording capture + spoken correction cues
- Record greetings via a module button and the **`R`** keyboard shortcut (start / stop) —
  matches the printable sign for staff & visitors.
- **Cici edits the recordings locally**, and watches for spoken cues via the local STT
  (Whisper/Piper) + simple intent matching:
  - **Start cue "message for <name>"** (and similar) → flag/tag the recording as a personal
    message for that person (routing + Layer-2 tag) and treat it as the lead-in. This is the
    consistent opener the printable sign asks recorders to say.
  - **"restart please"** (and similar) → discard and start the take over.
  - **"never mind, delete that"** (and similar) → discard the take entirely, keep nothing.
  - Match on intent, not exact words (handle close variants). Together these form a simple spoken
    protocol. MVP can be manual trim; the phrase-detection is the enhancement, riding the local
    STT already in the stack.
- Store **locally, private** (recordings can include staff → confidential, never leave the
  machine). Staff recording is **voluntary / consent-based** (see the sign).

## Scheduler & behavior
- Trigger between videos (on video end) and/or every N minutes. Keep each SHORT (fatigue).
  Auto-return to video when done. **Non-blocking, skippable, never requires input.** If the user
  can respond, offer a simple "again?" via yes/no scan — optional. Weighted/random pick; avoid
  immediate repeats.

## Sequencing (new site)
Lands as a platform **module** after the foundation is ready: profiles + module system +
media/storage + user settings (theme/voice). It is NOT an immediate build. **Content-gathering
can start now, independently:** the audio Mike already has, plus greetings collected with the
sign, are portable data the module plays later.

## MVP (first validated slice, once foundation is ready)
1. Scheduler + three-quadrant renderer; camera stays TR.
2. Content library; render **generated** segments — live BR graphic in the user's theme + TTS in
   the selected voice. Ship a small alphabet / counting / vocab set (data only).
3. **Recorded** personal segments — audio + still photo + name (fastest personal win). `R`
   capture with the restart/delete cue detection.
Then: video messages; response capture (watched? eyes tracked? vocalization?) feeding the same
"evidence, not scores" observations.

## Privacy
Recorded media = local only, private (may include staff). TTS = local (Piper) for full offline
privacy. Generic content carries no private data.

_Evidence, not scores. One validated slice at a time. Reopenable._
