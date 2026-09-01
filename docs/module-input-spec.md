# Making a module somebody can actually use

**Status:** draft. The runtime described here is implemented and tested; the distribution
story at the end is not.
**License:** MIT, same as the rest of this repository.
**Reference implementations:** [`web/client/modules/pond.js`](../web/client/modules/pond.js)
(canvas, answers verbs) · [`web/client/modules/photos.js`](../web/client/modules/photos.js)
(declared settings, live options)
**Vocabulary:** [`web/client/actions.js`](../web/client/actions.js)

---

## Read this part even if you read nothing else

Somebody using this may have **one button**. Not one hand — one button, sometimes pressed
with a cheek or a shoulder, sometimes taking several seconds to press deliberately.

That is not an accessibility checkbox bolted onto a normal app. It is the whole
qualification:

> **A thing that reads its own keyboard and gamepad input is not usable by the person this
> platform exists for, and wrapping it in a module changes nothing.**

If you build a game in Unity or Godot and export it to the web, it will run here. It will
also be **unreachable** — the player will watch it and never touch it. The work that makes it
usable is one function, described below, and it is small. **It is also not optional.**

The good news is the reverse: **answer two verbs and your thing works with every existing
user's existing switch, on the day you ship, with nobody rebinding anything.**

---

## Scope

**This document defines the input contract**, plus the small amount of metadata the host needs
in order to reason about your module without running it.

**It does not define how you draw.** Canvas, DOM, WebGL, an `<iframe>` — the host hands you an
element and stays out of it.

**It does not define distribution.** How a module gets from you to somebody else is not
settled; see [Not settled yet](#not-settled-yet).

---

## Terminology

| term | meaning |
| --- | --- |
| **verb** | What a person binds a control to. `select`, `next`, `menu`. Nine of them, plus two for moving focus. |
| **binding** | A saved link from one physical control to one verb. Belongs to a **person**, not to a machine or a screen. |
| **focus** | Which panel on a screen the verbs are currently aimed at. |
| **module** | One panel. A manifest plus a factory function. |
| **host** | The Nimrod runtime — the thing that owns the screen and delivers verbs. |

---

## The vocabulary

Eleven names. That is the whole list, and it is short on purpose: a person binding controls
reads nine rows, not two hundred.

| verb | what it means |
| --- | --- |
| `select` | The main "do it". **The one everybody has.** |
| `back` | Back, or cancel. |
| `next` | Forward through whatever is in front of you. |
| `prev` | Backward. |
| `up` `down` `left` `right` | Direction, where direction means something. |
| `menu` | Open the settings menu. Handled by the host — **do not answer this one.** |
| `focus-next` `focus-prev` | Move to another panel. Handled by the host — **do not answer these.** |

**Answer only the verbs that mean something to you.** A verb you do not answer is not an
error: the host uses that to decide whether your panel is even worth stopping on while
scanning, which saves the person presses.

**If you answer exactly one verb, make it `select`.**

---

## The contract

There are two shapes depending on what you are building.

### A. A native module — plain HTML/CSS/JS, canvas, p5, anything web

You subscribe to your own topics. **You never see a verb**, and that is deliberate: it means
your module works identically when driven by a switch, a keyboard, a mouse, a remote
clinician, or a test.

```js
import { registerModule } from '../module.js';

registerModule(
  {
    type: 'ripple',
    title: 'Ripple',
    description: 'taps make rings',
    dependsOn: 'none',
    settings: [ /* see Settings below */ ],
  },
  (ctx) => {
    const { mount, bus, state } = ctx;
    return {
      init() {
        mount.innerHTML = '<canvas></canvas>';
        // Your own topics. Anything can feed them: a switch, a button you draw,
        // a timer, a clinician on another machine.
        bus.subscribe('ripple/tap', () => spawnRing());
        bus.subscribe('ripple/clear', () => clear());
      },
      onResize() {},
      onHide() {},          // stop animating — you may be off-screen
      destroy() {},         // release everything you took
    };
  },
);
```

Then tell the host which verb means which topic, by adding a row to `MODULE_VERBS` in
[`actions.js`](../web/client/actions.js):

```js
ripple: { select: 'ripple/tap', back: 'ripple/clear' },
```

That table is **plain data, not logic** — which is why a screen can later re-point it
("on this screen, `select` means clear") without touching your module.

### B. An engine export — Unity, Godot, or anything else that owns its own canvas

The host cannot reach inside your engine, so **you expose one function and a thin wrapper
module calls it.**

```
onNimrodVerb(verb)     // called with a verb name: "select", "next", ...
nimrodVerbs()          // optional: returns the verbs you answer, e.g. ["select","next"]
```

That is the entire input side.

#### Unity (WebGL)

Unity already has the hook — `SendMessage` exists for exactly this.

```csharp
// On a GameObject named "NimrodInput"
public class NimrodInput : MonoBehavior {
    public void OnNimrodVerb(string verb) {
        switch (verb) {
            case "select": Fire();      break;
            case "next":   NextLevel(); break;
        }
    }
}
```

```js
// the wrapper module
unityInstance.SendMessage('NimrodInput', 'OnNimrodVerb', verb);
```

#### Godot 4

```gdscript
extends Node

var _cb   # keep a reference or it is garbage collected

func _ready():
    if OS.has_feature("web"):
        _cb = JavaScriptBridge.create_callback(_on_verb)
        JavaScriptBridge.get_interface("window").onNimrodVerb = _cb

func _on_verb(args):
    match str(args[0]):
        "select": fire()
        "next":   next_level()
```

> **Godot's web export is heavy** — several megabytes of engine before any content — and the
> target hardware includes a Raspberry Pi 400. It also historically wants `SharedArrayBuffer`,
> which needs COOP/COEP headers **site-wide**. Neither is fatal, both are real. Consider
> whether what you are making needs an engine at all.

#### Anything sandboxed in an `<iframe>`

Use `postMessage`. Same contract, different transport:

```js
window.addEventListener('message', (e) => {
  if (e.data?.type === 'nimrod/verb') onNimrodVerb(e.data.verb);
});
```

---

## What the host already did before your function is called

You do not have to think about any of this, and **you should not reimplement it**:

- **Which physical control was pressed**, and what it is bound to. Bindings belong to the
  person and follow them between machines.
- **Whether the press cleared the minimum hold**, whether it was a bounce, whether it was
  inside a repeat lockout, and whether a watchdog released a stuck switch.
- **Whether the person is currently allowed to act** — there is a three-way gate
  (moderator / participant / both) and it applies to remote drivers identically.
- **Which panel is focused**, including scanning between panels with one switch.
- **Where the press came from** — a control in the room or somebody driving from another
  house. Same path, longer wire.
- **Explaining a press that did nothing**, in words, on a diagnostic page.

**By the time `onNimrodVerb('select')` runs, all of that has happened.** Your job is the last
inch.

---

## If you are measuring, not just reacting

Most modules want a verb and nothing else. Some — an assessment, a calibration tool, an input
trainer — need to know what the person's hand actually did, **including the presses that
changed nothing on screen.** For those there is a second, opt-in stream.

```js
bus.subscribe('access/edge', (e) => {
  // e.phase   'down' | 'up'
  // e.heldMs  null on a down; on an up, HOW LONG IT WAS ACTUALLY HELD
  // e.auto    true = the watchdog or a window blur synthesized this release
  // e.bound   was anything bound to this control at the time
  // e.pressId joins the down, the up, and every activation from the same press
});
```

**Three things about it are the whole reason it exists.**

**1. It reports what happened, not what was configured.** `heldMs` on the *activation* stream
(`access/activation`) is the binding's own threshold echoed back: a binding set to 250ms, held
for 900ms, reports 250. `access/edge` reports 900. If you are measuring a person, read the edge
stream; the other number is the caregiver's setup.

**2. The release is a measurement in its own right.** A press-edge binding decides on the way
down and produces no second record, so how long someone held a switch — and how long it took
them to let go — was not observable anywhere. It matters: somebody who has to commit hard to
close a switch may struggle to open it, and that difficulty is data, not noise.

**3. You may measure what you do not react to.** An unbound press is on this stream with full
timing. So is an echo press 200ms after your game already paid out — it changes no pixels and
is *perseveration* in the record.

**What it deliberately does not include:** presses made while a caregiver is binding a control.
That is somebody configuring hardware, not the person using the screen, and a channel that
cannot tell those apart is worse than one that misses the setup.

**Where it goes is yours.** The platform does not put this on the wire — the opt-in research
payload has its own allowlist and this is not on it. If you are keeping clinical data, it goes
where the person storing it chose to put it.

---

## The manifest

```js
{
  type: 'ripple',              // required, stable, machine-safe. Never change it.
  title: 'Ripple',             // required, human. Shown in menus.
  description: 'taps make rings',
  dependsOn: 'none',           // none | local | server | network
  importance: 'normal',        // critical | normal | optional
  settings: [ /* below */ ],
}
```

### `dependsOn` — what has to be working for you to work

| value | meaning |
| --- | --- |
| `none` | Nothing outside the page. |
| `local` | A device, a drive, a local agent. |
| `server` | The platform. **This is the assumed default if you say nothing.** |
| `network` | The open internet. |

The host uses this to pick a **fallback** when something else on the screen breaks. Ranked
most survivable first, and **a `network` module is never offered as a fallback** — a fallback
chain that ends in something network-dependent has not terminated.

> There is no safe value. A clock with the wrong time is a failed clock. The field is called
> `dependsOn`, not `cannotFail`, for that reason.

### `importance` — how much it matters that this works

`critical` for a panel that is the reason somebody is at the screen; `optional` for something
nobody would miss. It scales how loudly the audit complains about your module — a control that
is expensive to reach is a real problem on a critical panel and a note on an optional one.

---

## Settings

**Declare them as data. Do not render your own settings UI.**

```js
settings: [
  { key: 'speed', label: 'Speed', kind: 'choice', default: 2, level: 'essential',
    options: [
      { value: 1, label: 'slow' }, { value: 2, label: 'normal' }, { value: 3, label: 'fast' },
    ] },
  { key: 'holdMs', label: 'Rings last', kind: 'number', default: 2000,
    min: 500, max: 5000, step: 500, level: 'advanced' },
]
```

The reason is the same one as everything else here: **if you hand over markup, the shell does
not know what your controls ARE, so it cannot move a cursor through them, so your settings are
unreachable by somebody with one switch.** A declaration can be walked. A `<div>` cannot.

| kind | what `select` does |
| --- | --- |
| `toggle` | flips it |
| `choice` | next option, **wrapping** |
| `number` | steps by `step`, **wrapping** at max back to min |
| `text` | nothing — it renders read-only and says it needs a keyboard |

**Rules worth knowing before you write one:**

- **Count the presses.** A `choice` costs one press per option to get all the way round; a
  `number` from 2 to 60 in ones costs **fifty-nine**. That is not a control, it is a
  punishment. Prefer a short list of known-good values over a range.
- **Bound your numbers.** A `number` with no `min`/`max` cannot wrap, so it renders
  non-cycleable.
- **Store milliseconds, and end the key in `Ms`.** Every duration in the product is stored in
  milliseconds and displayed in seconds, so durations can be compared across modules. Use
  `unit` / `displayScale` for how it reads.
- **`level`** is `essential` (a patient's own screen) / `standard` (the default) / `advanced`
  (raw timings, precedence). **Mark at least one field `essential`** or your panel has no
  settings at all on a stripped-down screen.
- **Live options** — a mounted instance may return `settingsChoices()` for options that are
  data (which album, which source). It must be **synchronous**; cache from work you were doing
  anyway.

---

## What not to do

- **Do not listen on `window` for keys.** You will fight the input bus and break rebinding.
  Subscribe to your own topics.
- **Do not assume a pointer exists.** If a verb needs a target, aim at the middle.
- **Do not touch the DOM outside `ctx.mount`.** No `<style>` in `<head>`, no globals. Two
  copies of your module may be on one screen.
- **Do not keep running when hidden.** Implement `onHide()` and stop. A canvas animating
  behind a hidden panel is heat on a machine that is on twenty-four hours a day.
- **Do not assume size or aspect.** You may be one ninth of a screen or all of it.
- **Do not start audio unasked.** If you make sound, make it a declared setting.
- **Do not use color alone** to carry meaning. Shape plus color, always.

---

## Testing it

One test matters more than the rest:

> **Unplug everything except one button. Bind that button to `select`. Can you use your
> module?**

If reaching something takes more presses than you would tolerate yourself, it is too many —
the person using this cannot press faster, and on a scanning setup each step can take fifteen
seconds.

`web/client/settings_audit.js` will count the presses for you and tell you which of your
settings is the most expensive to reach.

---

## Custom verbs

The nine are a curated **default**, not a closed set. A screen may register its own —
`lights-dim`, `i-want-music` — and map them to topics the same way.

Two rules:

1. **A custom verb may never shadow a built-in.** Every binding a person owns is keyed to
   those names.
2. **A custom verb is local by default.** It does **not** cross the remote-drive wire, which
   carries a frozen allowlist of the eleven names, enforced independently at both ends.

> For somebody who cannot speak, a custom verb is closer to a **sentence she can say with a
> switch** than to a keybinding. `i-want-music` is not a control; it is an utterance. Design
> them that way.

---

## Not settled yet

- **Distribution.** How a module gets from you to somebody else — a registry, a URL, a
  reviewed list — is not decided. The platform is likely to store a **reference** rather than
  host your bytes, the way it already handles media.
- **Sandboxing.** A module today is JavaScript with the same access as the page it runs on.
  Anything shared beyond people who already trust each other needs an isolation boundary
  first. The module contract — you only ever touch `ctx` — was written with that in mind.
- **Declared capabilities.** "Needs a camera", "makes sound", "talks to the network" as
  machine-readable fields, so a person can see what a module wants before installing it.

If you are building something for one particular person you already know, none of that is in
your way. If you are building for strangers, it is — and it is being worked on.
