# The Nimrod game

A game that teaches you the Nimrod ecosystem by having you build your own part of it. You build
your world out of real modules and dashboards, one step at a time, and every step leaves you with
something real on your account rather than a tutorial you throw away.

This folder is the game. It lives in the public repo as a folder of its own so it can be lifted
out later if it ever earns its own release cycle.

## Step 1: your profile (what is here today)

Your profile is your first dashboard. `/game/` is a short checklist that drives the real product:

1. **Make my profile** — makes one screen called "My profile" for the current person. It starts
   **empty**, with a room as its background (the Cozy live theme) and clear panels so the room
   shows around whatever goes on the wall.
2. **Hang your picture** — adds a `button` module set up as a picture frame, in the first spot.
   The picture itself is chosen by the person, in its settings, from their own Media.
3. **Put up your name sign** — adds a second `button`, set up as a sign with the person's name
   (or "Your name"), in the second spot.
4. **Open my profile** — opens that screen in the real kiosk (`/kiosk.html?profile=<id>`), where
   the person uses the real transport bar and settings menu: pick a room under **Colours**, select
   the sign and change its **Words**, **Font** and **Colour of the words**.

Every step is safe to press again. The screen and the two buttons are remembered in the person's
own state, so a refresh, a second visit or a double press never makes anything twice, and the
person's own changes (a different room, the sign moved, new words) are never put back. It only
ever writes to the one screen it made.

The name sign and the picture are two instances of one module, `modules/button.js`, whose face is
the AAC board's card (`card_face.js`). That is Mike's call: *"the PFP/Name sign are basically
instances of buttons."*

## What is deliberately not here yet

- **Nimrod the cat, the guide who walks you through it** — waits on the cat's design. The steps
  above are the walkthrough's skeleton; the cat will narrate them, appear when asked or at a quest
  step, and always be dismissible.
- **Designed sign styles and frames** — the ones in `button.js` are simple placeholders until the
  designed ones arrive. They replace the CSS; the stored choices stay.
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

- `index.html` — the checklist page.
- `game.js` — the steps, as functions over any backend (tested in `dev/game_test.html`).
