# Landing page — decisions and open items

Decisions from a review of the live page at `nimrod.onrender.com` (27 Aug 2026). Nothing here
is built yet. Mockup of the restructured page, with every change annotated in place:
<https://claude.ai/code/artifact/b4594e8e-a415-4291-8d1b-a66ac042d765>

> **Read before editing the landing page.** These are settled unless marked OPEN. The mockup is
> the reference for ordering and copy; this file is the reasoning. Append, don't rewrite.

---

## The four things that were actually broken

1. **Both primary CTAs dropped the reader into Google OAuth with no warning.** `/auth/login`
   redirects straight to `accounts.google.com` — after 2,000 words about privacy, with no
   explanation of what an account is for. Also excludes facilities on Microsoft tenancies.
2. **The privacy headline overstated what the live table shows.** "Your personal data never
   leaves your machine" sat directly above a table listing a person's name, an append-only
   event log, media addresses, sharing grants, and device credentials.
3. **Zero images** on a page whose thesis is "real, running software — not a mockup."
4. **No meta description, no OG tags, no favicon, no canonical.** Shared into a caregiver group
   or a text message, the link renders as a bare grey URL. This is the project's main
   distribution channel.

## Settled

### Structure and copy
- Benefit headline: **"A better quality of life for your loved ones — and for you."** The
  *and for you* half is doing the work — caregivers are almost never told the tool is for them.
- Immediately beneath it, one plain sentence: **Nimrod is a device and media hub designed for
  people with accessibility needs.** Answers "what is this" in the first eight seconds.
- Then hardware and inputs — off-the-shelf or custom, on both sides. Then a list: AAC board,
  YouTube, games, lights/thermostat/fan.
- **The demo is the primary CTA everywhere.** Signed-out `/kiosk.html` boots the real product
  over sample media; almost nothing in this category lets a stranger touch the software before
  making an account. It was styled as the quieter button.
- **Story moves up** to position 3 — short version inline, full version behind a toggle. The
  webcam-as-rearview-mirror line is the most concrete thing on the page and was 1,500 words down.
- **Voice is first person throughout.** "The line I don't cross," not "we." One person building
  for one person is the trust asset; the corporate voice appeared exactly where trust is asked for.
- Four British spellings out: `colour`, `centre`, `analysed`, `labelled`.
- **Maker block added** — plug in an ESP32, wire it to anything on the screen. A commercial
  adaptive switch is $75; a button, a microcontroller and a printed enclosure is about $15.

### Demo block
- **2×2, clockwise from top left:** Pictures, live view, Clock, Word Forge with AAC terms.
- **A public zoo cam stands in for the room camera**, muted. This is what makes the embed viable
  — it removes the camera permission prompt, which is the worst possible thing to happen on
  arrival at a privacy-pitched page.
- **Poster image with a play affordance**; one tap swaps in the live kiosk iframe. Everyone sees
  the picture instantly, the page still works when the kiosk doesn't, and cold starts don't
  block first paint.

### Privacy section
- Headline narrows to **"Your photos, video, and files never leave your machine"** — a claim the
  live table supports.
- The live table gains an **on/off column** per account, so "every one of these is opt in" is
  visible rather than asserted.
- Opt-in language added: nothing is collected because someone made an account, turning a thing
  off stops it, and **anything added later arrives switched off** needing its own separate opt-in.

### Accessibility — the page scored worst on the thing the product is about
Counted in the served HTML: zero `aria-*` attributes, zero `<main>`, no skip link, no `:focus`
rule anywhere in the stylesheet, and `scroll-behavior: smooth` with no `prefers-reduced-motion`
guard. Decorative emoji are unlabelled, so a screen reader announces "sun behind small cloud"
before each heading.

Fixes: `<main>`, skip link, visible focus ring that clears the sticky nav, `aria-hidden="true"`
on every decorative emoji, reduced-motion guard, and **nav anchors — the section ids
(`#intention`, `#backstory`, `#progress`, `#future`, `#involve`) already exist and nothing links
to them.**

### Contrast
Nineteen of twenty-two pairs pass AA. Three fixes: `--rosy-deep` `#a85f52` → `#9e5449`
(4.26 → 4.94 on cream, and it fixes the milestone box), and a new `--pill-accent` `#E8BDB4` for
hero pills, which measured 3.34 against the gradient's teal end.

### Footer
Add: an email address, a link to GitHub issues, **the MIT license named on the page**, and
*"Nimrod is not a medical device and is not intended to diagnose, treat, cure, or prevent any
condition."* The page says "open source" seven times and names the license zero times.

---

## Blocked — needs Mike's words

Two sections are stubbed in the mockup. Inventing either would put claims on the site he never
made.

- **What setup actually takes.** Minimum hardware; honest time for a non-technical person; what
  connecting a media folder involves; what is genuinely hard; where to go when it breaks. A
  caregiver with no spare hours can't tell from the current page whether this is fifteen minutes
  or a weekend, and that unanswered question is a bigger adoption barrier than anything on it.
- **The facilities / clinician track.** Free to use, procurement justification, train-the-trainer
  availability, assistive-technology funding paperwork, and a way to make contact. The page
  currently addresses exactly one reader: a family member of one patient.

## OPEN

- **Home Assistant** stays out of present tense until it ships. Honest phrasing that still sells
  is in the mockup.
- **The name.** In American English "nimrod" colloquially means idiot, and that's the first
  meaning most people under sixty carry. It matters because of how this spreads — nurse to
  family to facility, each handoff a moment where the name is said aloud to someone new. Raised,
  not decided.
- **Render tier.** Served warm at 0.31–0.73 s TTFB, but free-tier services sleep after ~15 min
  idle and traffic here will be sporadic. Confirm the tier before promoting the link.
- `robots.txt` and `sitemap.xml` both 404.

## Bugs in `kiosk.html` — the primary CTA now points at both of these

- Line 76 says **"Loading her dashboard…"** to every stranger who opens the demo.
- **No visible way back out** of the fullscreen kiosk. Someone who can't find the exit closes
  the tab and the whole argument goes with it. Needs a persistent low-contrast affordance on the
  signed-out path only, so it never appears on a real bedside screen.

---

## What was already right

Worth recording, because the list above is long and these are not small.

- **The live `/api/what-we-store` table.** A privacy disclosure generated from the running schema,
  which flags its own undescribed tables rather than going stale, and which names the failure and
  points at the source when the fetch fails. Better practice than most funded companies manage.
- **The switch-access section.** "A dead switch, a wrong binding, too high a hold, or a panel with
  nothing to say are four different repairs that look identical." Nobody writes that paragraph
  without having sat with a patient and a switch that wasn't working.
- **The backstory.** Specific, unposturing, and it explains the architecture rather than just
  supplying pathos. The note about building with AI tools and wanting experienced help buys more
  credibility than hiding it would.
- The failed-sign-in banner uses `role="alert"` and explains in a comment why silence would be
  worse.
