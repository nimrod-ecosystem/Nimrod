# Nimrod — locked decisions

A running log so decisions aren't re-litigated or lost. Everything here is reopenable if
there's a real reason, but treat it as settled by default. Dates are when decided.

## Identity & licensing
- **Name:** Nimrod Ecosystem (GitHub org: `nimrod-ecosystem`). Core repo: **Nimrod**
  (the platform — web now, desktop/other apps later). **Cici** = the local AI care
  companion, a first-class product/module on Nimrod, not the platform. (2026-08-09)
- **License:** MIT — free to use/modify/build on, including commercially. The free version
  always exists. License covers code, not the name. (2026-08-09)
- **Copyright holder in LICENSE:** set to the correct name/entity (personal name, or an LLC
  if one is formed later). Placeholder is "Nimrod Ecosystem". _(open — set before launch)_

## Scope & focus
- Public focus is **patient care**: quality of life, recovery, and communication/advocacy
  for TBI, stroke, and other patients — and tools for the families and (later) therapists,
  nurses, and other caregivers who support them. Built to be useful to everyone; wider
  adoption means more people building modules. (2026-08-09)
- **Not selling anything** right now — this is an open-source project. No product
  Kickstarter, no hardware sales. Light GitHub Sponsors possible later; not a driving
  campaign. No medical crowdfunding on the public site. (2026-08-09)
- **3D-printing / physical hardware line is PAUSED** — separate from this site for now.
- Demo videos feature the developer on the bench, not the patient.

## Architecture principles
- **Rebuild from scratch.** Do not copy/scrub the old private codebase. Reimplement clean
  so no private data or addresses live in the code or git history. The old `dashboard_web`
  is a **design reference only**. (2026-08-09)
- **Device-independent / no swaps.** Per-user state lives server-side, tied to the account,
  not to any machine. Open a setup on any device; replace a screen and it returns exactly.
  No machine-specific setup, no "swap" dependency. (This is the whole point.)
- **Privacy boundary = per data, not per name.** Anything touching a patient's private /
  clinical data runs **locally on open-source models**, never a cloud service. Generic help
  (setup, onboarding, "how does X work") **may** use a cloud assistant, and never touches
  patient data.
- **Media is peer-to-peer.** Camera stays on the patient's device; video/audio flow
  directly between devices; the server only brokers signaling. TURN relays *encrypted*
  media when a direct connection isn't possible — the server never sees the video.
- **BYO storage + BYO compute.** Files live in a folder the user owns; the platform
  references them, never hosts or locks them in. AI runs on the user's own machine.

## Reach & hosting
- **Any-network by default** — "open a link and it works." Uses a small always-on host
  (~$5/mo) for presence/signaling + a TURN relay. **Tailscale is optional** (an advanced
  "max privacy / zero-cloud" mode), never required. (2026-08-09)
- **GitHub Pages** hosts the static landing page (`index.html`) for free once enabled.

## Cici — the assistant, two data planes
- **Helper Cici** (onboarding/setup): cloud-OK; can read the **public** repo so answers
  stay current; a non-sensitive cloud store (FAQs, public docs, AAC references). Ends every
  response with the disclaimer in `claude-setup/setup-guide.md`. "Learning" limited to
  non-sensitive / aggregate improvements — never individual patient info.
- **Companion Cici** (anything about a patient): fully local, offline, open-source models.
- Setup is intentionally light (a simple profile shouldn't need much help) — YouTube
  walkthroughs + a modest in-site helper. The downloadable `claude-setup/` pack is the
  stopgap until in-site Cici exists.

## Integrations (planned)
- Home Assistant, Alexa, Google Home. The setup assistant is itself one such integration.
- Docs to integrate other popular AI tools.
- Per-module markdown walkthroughs (`docs/modules/`) so people and their AI tools can
  understand and extend each module.
- **Direct device control through the shared bus** — so a patient can control their own
  environment (lights, thermostat, fan) using whatever input they can.

## Accounts & assets
- **Google:** a dedicated project account anchors YouTube + Drive (non-sensitive assets
  only — never patient data) + the Google OAuth the site's login uses.
- **AAC symbols** are AI-generated (Claude) — no third-party symbol-set license to honor;
  free to ship. (US: purely AI-generated images generally aren't copyrightable, which is
  fine for a free/open project.)

## Community / pre-launch
- Reserve the name across GitHub org, domain, YouTube, Reddit, Discord, and major socials
  **before** going public. Open the community later; nothing needs to be active until
  there's something to show.

## Context (not public-site items)
- Patient is transferring facility-to-facility (not home soon) — caregiver-pay income path
  stays gated; tracked in the private repo / project, not here.
