# The Nimrod game

A game that teaches you the Nimrod ecosystem by having you build your own part of it. You build
your world out of real modules and dashboards, one step at a time, and every step leaves you with
something real on your account rather than a tutorial you throw away.

This folder is the game. It lives in the public repo as a folder of its own so it can be lifted
out later if it ever earns its own release cycle.

## Step 1: your profile (what is here today)

Your profile is your first dashboard. Since 2026-09-30 (row 2.29) it lives on **Home** (the
modules page): a signed-in person lands there on it, as a preview, and **Save** (on the real
transport bar) runs the three steps below (`profileSetup()` is the same setup as data, so the preview
and the real thing cannot drift). `/game/`'s four buttons that ran them one at a time were retired
the same day (the follow-up to rows 2.29/2.30): they were a second way to do what Save does, and
Nimrod's walk now points at Home. The page keeps what the game is, a link to the profile on Home,
"Show me how", and Nimrod's settings.

1. **Make my profile** (`makeProfile`) — one screen called "My profile" for the current person. It
   starts **empty**, with a room as its background (the Cozy live theme) and see-through panels
   (`PROFILE_SURFACE`; clear until 2026-09-30, Mike: "Make see through the default") so the room
   shows around whatever goes on the wall.
2. **Hang your picture** (`hangPicture`) — a `button` module set up as a picture frame, in the
   first spot. The picture itself is chosen by the person, in its settings, from their own Media.
3. **Put up your name sign** (`putUpSign`) — a second `button`, set up as a sign with the person's
   name (or "Your name"), in the second spot.

Then the person uses the real transport bar and settings menu on Home: pick a room under
**Colours**, select the sign and change its **Words**, **Font** and **Colour of the words**, Save.

Every step is safe to run again. The screen and the two buttons are remembered in the person's
own state, so a refresh, a second visit or a double press never makes anything twice, and the
person's own changes (a different room, the sign moved, new words) are never put back. It only
ever writes to the one screen it made.

The name sign and the picture are two instances of one module, `modules/button.js`, whose face is
the AAC board's card (`card_face.js`). That is Mike's call: *"the PFP/Name sign are basically
instances of buttons."*

## Nimrod the cat, the guide

**Show me how** — in Home's ⚙ menu (This page), on Home's welcome card, or on the game page —
starts an 11-step walk narrated by Nimrod the cat, all of it on Home, on the profile: **Save** to
make it, the transport bar, **Modules**, **Panel ▸** to choose the picture or the sign, **⚙ Edit**
(the settings menu), the picture's **Picture** and **Frame** rows, the sign's **Words**, **Colours**
for the room, and **Save** again. The steps are data in `cat_steps.js`; the cat is
`../cat_guide.js`, which runs on the guided tour's own engine (`../tour.js`) rather than a second
one. Started anywhere else (the game page, a kiosk), he waits with a link to the profile on Home.
On Home his Next / Back / Close also answer `nimrod-cat/next|prev|skip` on the stage's own bus.

What Mike decided (2026-09-29), and where it is enforced:

- **Only when asked.** He appears when "Show me how" is pressed (or a later quest step calls
  `mountCat({ start: true })`), and on a later page only if a walk was started in that browser.
  Nothing makes him pop up by himself; a paired bedside screen never sees him.
- **Always dismissible.** A **Close** button, and **Escape**. Escape inside the open settings menu
  closes the menu first; the next Escape closes him.
- **Never a gate.** No scrim, no focus grab; everything under him keeps working, and Next alone
  always ends the walk. Nobody touching the page for 10 minutes (a setting) closes him.
- **How chatty is a setting.** "A few", "Some" (default) or "Lots" — on his own panel (one press)
  and under **Nimrod's settings** on the game page, with **read aloud**, **move on by himself**
  and the **rest** time.
- **He is heard as well as read.** His words go to the page's output bus as `say` — on the
  profile, the kiosk's own bus, so he queues with everything else that talks there.

He notices what you do (a step already done is skipped; opening the menu moves him on), but he
never does anything for you. His settings and his place in the walk are kept in this browser, like
the site tour's.

While he points at the bar, the kiosk holds it on screen (`holdBar`) — including Home's placed bar
in full screen, where it otherwise tucks itself away after a few seconds.

## What is deliberately not here yet

(The designed sign styles and frames that used to be listed here arrived on 2026-09-29 and are in
`button.js`.)

- **Prefabs** — "a sign" and "a picture" are just `button` instances with their own settings until
  prefabs exist.
- **The AI sidekick, points and currencies, 3D rooms, and the later sections** of the outline.

## How it talks to the rest

Only through what every page already shares — never by reaching into another module:

- the **screens** client (`profile.js` signed in, `local_store.js` signed out) to make the one
  screen and add the two buttons;
- the screen's **settings** doc (theme, panel background, arrangement) and each button's
  **instance state** (its starting settings);
- **per-person state**, key `game`, for what the game remembers;
- the **kiosk URL** to hand the person to their screen.

It works signed out too, on the browser's own storage, the same way the Home page does.

## Files

- `index.html` — the game's page: what it is, the link to Home, "Show me how", Nimrod's settings.
- `game.js` — the steps, as functions over any backend (tested in `dev/game_test.html`); Home's Save
  calls them.
- `cat_steps.js` — Nimrod's walk, as data (tested, with `../cat_guide.js`, in
  `dev/cat_guide_test.html`, which mounts a real embedded kiosk with Home's buttons on its bar, on a
  real profile, to check every target).
