# Home Assistant control: the plan

**Status:** the bridge, its terminal setup, the client and the Home controls panel are built (row 2.125; "Order of
work" below). Not yet tried on a screen. Written 2026-10-25, after Mike said: *"Home Assistant control - This is
something we should really do."*

**Provenance:** what the repo already has is checked against the code, with file names given. Facts about Home
Assistant and Chromium were marked **[to verify]**, from memory of their documentation.
- **Checked 2026-10-25 against Home Assistant's own documentation:** `Authorization: Bearer <token>`, `GET /api/`
  returning `{"message": "API running."}`, `GET /api/states`, `POST /api/services/<domain>/<service>` with
  `{"entity_id": ...}`, and the WebSocket at `/api/websocket` (auth messages, then `subscribe_events` with
  `state_changed`).
- Still marked: the CORS setting, the `demo` integration, and the per-domain service names beyond lights.

**Built so far:**
- **Step 1, the bridge** (`web/kiosk_installer/deploy/nimrod-ha-bridge.py`, public 2ba9973): tested against
  `web/tools/pretend_home_assistant.py`, on Windows and the bench Pi.
- **Setup is from a terminal first** (`--connect`, `--list`, `--tick`; over ssh), because the bridge is on the
  screen's own 127.0.0.1 and a page on another computer cannot reach it. Setup from the page comes once a screen
  has a pointer for it.

## What is already here

- **The input side is mostly there.** `web/client/actions.js`'s action registry takes new actions at run time
  (`register({ id, label, topic, payload, group })`). So a ticked lamp's "on" can be bound to a switch, a key, a
  talk-board card or a spoken word with no new input plumbing: the same bus, bindings, role gate (who may act) and
  diagnostics.
  - **Corrected 2026-10-25:** this page first said "the input side is done". The custom-VERB functions
    (`normalizeVerb` / `mergeVerbs`) exist and are tested, but nothing on a screen calls them yet. The registry is
    what the client uses.
- **The Connections page knows it.** `web/client/connections.js` has a `home-assistant` entry. It is hidden until
  connected, at the advanced level.
- **The words are Home Assistant's.** `web/client/modules/view.js` already took "scene" in Home Assistant's sense and
  renamed its own idea "preset", so the two cannot be confused.
- **A local helper on the Pi already works this way.** `web/kiosk_installer/deploy/nimrod-lock-helper.py`:
  - listens on 127.0.0.1 only;
  - accepts only the kiosk site's Origin;
  - is stdlib Python, run as a user unit, with tests beside it;
  - comes with the Chromium policy that lets the site reach it without a prompt on the screen (install-linux.sh,
    `NIMROD_LOCK_POLICY=1`).

  That last point was seen on the bench 2026-10-05: without the policy, Chromium asks "wants to access other apps and
  services on this device" until somebody answers.

**Nothing talks to Home Assistant yet:** no client, no token handling, no service calls.

## The one hard question: who makes the call

The screen loads the site over HTTPS (the bench kiosk loads `https://nimrodecosystem.com/kiosk.html`, checked
2026-10-25). Most Home Assistant installs answer on plain `http://homeassistant.local:8123`. **A browser will not call
an `http://` address on the network from an `https://` page** (mixed content). The one exception is the computer's own
`127.0.0.1` [to verify: Chromium treats loopback as trustworthy; the lock helper is evidence it works]. So there are
three places the call could come from:

| | Where the token lives | Needs | Against |
|---|---|---|---|
| **A. A bridge on the screen's computer** (like the lock helper) | A file on that computer, readable only by its user | A small service, installed with the kiosk; the Chromium local-network policy (already written for the lock helper) | One more service to install and keep running |
| **B. The browser calls Home Assistant directly** | The browser's storage on that device | Home Assistant on HTTPS (Nabu Casa or an own certificate) and the site added to its `http: cors_allowed_origins` [to verify] | The token sits in a web page's storage. Most homes don't have HTTPS on Home Assistant |
| **C. The platform's server calls it** | Our server | Home Assistant reachable from the internet | A key to someone's house on our server. **No.** |

**Recommendation: A, with B as the no-install path for people who already have Home Assistant on HTTPS.** A works with
the Home Assistant most people have, keeps the token off the web page and off our server, and copies a pattern already
proven on the bench. Both use the same client code, so B costs little once A exists: the bridge is a proxy with the
token, and the client talks Home Assistant's own REST shape either way.

- **On a Windows desktop**, the bridge is a part of the Nimrod Helper (`web/nimrod_helper/`), not a second program.
- **On a Pi**, it is `nimrod-ha-bridge.py` beside the lock helper, with its own user unit.

## What connecting needs

Set up once, by a person with a pointer, on the Connections page (Home Assistant area):

1. **The address**, for example `http://homeassistant.local:8123`. The bridge checks it answers
   `GET /api/` [to verify: returns `{"message": "API running."}` with a valid token].
2. **A long-lived access token**, made in Home Assistant under the person's profile, Security tab [to verify]. It is
   pasted once and goes to the bridge, never to our server. The page shows "connected" and the first and last four
   characters, never the whole token (the site already hides pass phrases behind Show).
3. **Which things**: the bridge lists entities (`GET /api/states` [to verify]) and the person ticks the ones the
   screen may control, each with a name in their own words ("the lamp", "the big light"). Nothing is controllable until
   ticked.

## The first actions

Picked because a switch user asks for them first and they are the same few services in every home [service names to verify]:

| Thing | Domain | Actions |
|---|---|---|
| A light | `light` | on, off, toggle, brighter, dimmer (`brightness_step_pct`) |
| A fan | `fan` | on, off, toggle |
| A TV or speaker | `media_player` | on, off, volume up and down, pause and play |
| A Home Assistant scene | `scene` | turn it on ("Evening", "Movie") |

Each ticked thing becomes **verbs** in actions.js's registry, such as `ha/<name>-toggle` or `ha/<name>-dimmer`. Calling
one sends `POST /api/services/<domain>/<service>` with `{ "entity_id": ... }` through the bridge [to verify].

**Left out of the first version, as a default rather than a rule:** locks, alarm panels, garage doors, cameras and
covers. Someone controlling their own front door from their own switch is a legitimate want, so these are a setting
("Allow doors and locks", off), not a ban. They are left out first because a wrong press costs more there, and the
first version should be the one where a wrong press turns a lamp on.

## How it rides the buses

- **The INPUT bus, not the output bus, carries control.** Turning on a lamp is something a person does, like a press.
  So it is a verb, bound like any other: a switch, a talk-board card ("lamp on"), a spoken word, a button on a panel.
  The role gate applies, so a moderator-only screen means the participant's switch doesn't turn off the TV.
- **A "Home controls" panel** (a new module) shows the ticked things as big buttons with their real state: on or off,
  and how bright. State comes from Home Assistant's WebSocket API (`state_changed` events [to verify]) through the
  bridge, with polling as the fallback. A button whose thing is unavailable says so; it is never silently dead.
- **The OUTPUT bus is where a light can TELL someone something.** output.js already names a `light` channel with no
  adapter yet. An adapter could blink a lamp for an `alert` the person has routed there. That comes later. It must obey
  the photosensitivity setting (`flash_limit.js`) like any flash on the screen. It is a way of being told.
- **Remote drive:** the remote-drive wire allowlist stays frozen (actions.js says so). Home Assistant verbs are not
  driveable from another device unless a grant says so. "Someone else can switch my lights" is a choice the person makes,
  off to begin with.

## The boundary wording

**Settled 2026-10-25 (row 2.130): none on the site.** The longer environmental-control paragraph in the private design
notes (`aac_design.md` section 8) was chat's wording, not Mike's and not a rule. It does not go on the site, the setup
screen or the panel. The site's one "not a nurse call" sentence (DECISIONS.md, 2026-10-13) stays where it is. This page
first recommended the paragraph on the setup screen; that is withdrawn.

What the first version does, as a fact about it rather than a rule: Home Assistant actions are switched by a person's
press. None is wired to the output bus's `alert` or `notify`.

## Setting up Home Assistant itself (Mike doesn't run it yet, 2026-10-25)

Home Assistant is its own program, and it needs a computer that stays on, on the same network as the things it
switches. Three places it could run [from Home Assistant's install options as remembered; to verify before buying
or installing]:

| Where | For | Against |
|---|---|---|
| **Its own small box:** Home Assistant OS on a spare Pi 4 or 5, or Home Assistant's own "Green" box | The way most homes run it. It updates itself and isn't touched when a Nimrod screen is updated or swapped | One more device to buy and plug in |
| **Beside the screen:** Home Assistant in a container on the screen's own Pi | Nothing to buy. The bridge and Home Assistant on one computer | The Pi 400 is already busy drawing the screen. A screen swap moves Home Assistant with it, and the live unit is not to be touched remotely |
| **On the desktop** | Good for trying it out | The desktop is not always on, and its disk is nearly full |

**Recommendation:** try it out with the pretend one first (below). For real use in a room, its own small box, so the
screen and the house's switches can each be swapped or updated without the other.
- At the facility it would also need the facility's network and their say-so for devices in the room. That is a
  conversation for Mike, not a setting.
- The bridge doesn't care which: it is given an address.

## Testing without a hub

1. **The client, pure:** the service-call shapes, the verb registration and the state mapping, tested against a fake
   `fetch`, like the rest of `web/client/dev/`.
2. **A pretend Home Assistant** in `web/tools/` (stdlib Python, about a hundred lines). It answers `/api/`,
   `/api/states` and `/api/services/...`, plus the WebSocket's auth and `subscribe_events`, from a small table of pretend
   lights, a fan and a TV. The bridge's tests and a page suite run against it, so a missing hub never blocks a run.
3. **The real thing, once:** Home Assistant's own `demo` integration gives a real Home Assistant with pretend devices
   [to verify], in a container on the bench or the desktop (disk allowing). One end-to-end run before claiming it works.
4. **Real hardware**, when there is a hub: one lamp, on a bench screen, never the live one.

## Order of work

1. The bridge (Pi first, beside the lock helper) with its tests against the pretend Home Assistant.
2. The client: connect, list, tick, name; verbs registered.
3. The Home controls panel.
4. Bindings: a switch, a talk-board card and a spoken word each turning the pretend lamp on, end to end.
5. A run on the bench screen after a deploy: the pretend Home Assistant on the bench Pi, the bridge as a user unit,
   the launcher's `NIMROD_HA_BRIDGE`.
6. Later: the output bus's light channel; the Windows helper's half; setup from the page.

**Done so far (2026-10-25):** 1 (public 2ba9973, the terminal setup b7597c1), 2 and 3 (9baf93b: the client and the
Home controls panel; the "Allow doors and locks" setting is in the bridge).

## Settings this will add (each a setting, with a default)

- the address and the token (no default);
- which things may be controlled (none until ticked);
- "Allow doors and locks" (off);
- "Another device may control these" (off, a grant);
- the polling interval when the WebSocket is unavailable (a few seconds, argued when built).
