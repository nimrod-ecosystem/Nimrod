# Home Assistant control: the plan

**Status:** a plan, not built yet (row 2.125). Written 2026-10-25, after Mike said: *"Home Assistant control - This is
something we should really do."*

**Provenance:** what the repo already has is checked against the code, with file names given. Facts about Home
Assistant and Chromium are marked **[to verify]**: they come from memory of their documentation and are checked
before the first line of the bridge is written.

## What is already here

- **The input side is done.** `web/client/actions.js` has a verb registry, so a new verb such as `ha/lamp-toggle` can be
  bound to a switch, a key, a talk-board card or a spoken word with no new input plumbing. The same bus, bindings, role
  gate (who may act) and diagnostics apply. Its own header names Home Assistant as the first thing this unlocks.
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
  the photosensitivity setting (`flash_limit.js`) like any flash on the screen, and it is a way of being told, never a
  way of calling for help (below).
- **Remote drive:** the remote-drive wire allowlist stays frozen (actions.js says so). Home Assistant verbs are not
  driveable from another device unless a grant says so. "Someone else can switch my lights" is a choice the person makes,
  off to begin with.

## The boundary wording

`docs/from_chat/aac_design.md` section 8 (private notes) has the revised wording:
- environmental control is a convenience, not a safety system;
- it depends on a network, a hub and devices, any of which can fail without warning;
- the facility's call system or a telephone is what calls for help.

**Two rulings pull different ways.** Section 8 says that wording goes everywhere environmental control is described.
Mike, 2026-10-13 (DECISIONS.md), made the "not a nurse call" line one sentence in three places: *"I feel like this is
really being overemphasized."*
- For section 8 in full on the site: once a switch can turn on a light, a reader may assume it can also reach a person.
- Against: the same paragraph on every page is the overemphasis Mike ruled out.
- **Recommendation:** the full wording goes on the Home Assistant setup screen and in this feature's documentation,
  where control is described and set up, and nowhere else. The existing one-line sentence stays where it is. **Mike's
  call** (his list).

The product follows the wording too: no Home Assistant verb is ever wired to the output bus's `alert` or `notify` as
a way to reach a person. A switch that turns on a lamp is a lamp switch.

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
5. The setup screen's boundary wording (above), after Mike's call.
6. Later: the output bus's light channel; the "Allow doors and locks" setting; the Windows helper's half.

## Settings this will add (each a setting, with a default)

- the address and the token (no default);
- which things may be controlled (none until ticked);
- "Allow doors and locks" (off);
- "Another device may control these" (off, a grant);
- the polling interval when the WebSocket is unavailable (a few seconds, argued when built).
