# A desktop as the second pass

The screen makes a fast first guess at what was said. A desktop with a better model can check it a moment
later and fix the words. This is the setting **Then check what it heard with: Another computer**.

These steps run the speech program on a Windows desktop with Whisper `small.en`, and give it a secure
address with Tailscale. (Checked against the code and current docs on 2026-10-11. The Tailscale steps
were not run on this desktop.)

## Why the address must start with `wss://`

The site is served over https. A browser will not let a secure page open a plain `ws://` connection to
another computer by name. It only allows `ws://` to the same computer (`127.0.0.1`, `localhost`).
So an address like `ws://your-desktop:8797/speech` fails, and the screen now says so in the voice menu
instead of failing quietly. The fix is a secure address, `wss://...`, which `tailscale serve` gives you.

(Chrome 147 and later will also let a secure page use `ws://` to a Tailscale number like
`ws://100.x.y.z:8797/speech`, but only after someone allows it, and older browsers refuse it. The screen
keeps such an address but warns about it. `wss://` is the surer choice.)

## Once, in the Tailscale admin console

1. Open the **DNS** page.
2. Turn on **MagicDNS** if it is off.
3. Under **HTTPS Certificates**, press **Enable HTTPS**. Note: this puts your machine names in a public
   list of certificates. If the desktop's name says something private, rename it first.

The desktop and the screen's computer must both be on the same tailnet. The screen's computer must use
Tailscale's DNS (on by default on Linux) so it can find the `.ts.net` name.

## On the desktop (PowerShell)

1. If the Whisper model is not on this computer yet, fetch it once (about 500 MB):

       py -3.13 -c "from faster_whisper import WhisperModel; WhisperModel('small.en')"

2. Start the speech program, from the repo's `web` folder. Pick a pass phrase; the screen will need it too.

       cd <the Nimrod repo>\web
       py -3.13 -m speech_service --backend whisper --model small.en --allow-origin https://nimrodecosystem.com --secret "<pass phrase>" --allow-host your-desktop.your-tailnet.ts.net

   * Leave `--host` and `--port` alone. It stays on `127.0.0.1:8797`, so nothing on your home network can
     reach it directly. Tailscale is the only way in.
   * `--allow-host` must be the desktop's full Tailscale name. Tailscale passes that name on, and without
     this flag the program refuses it (that check stops a different attack, so it stays on for every
     other name).
   * `--allow-origin` replaces the default list. The default already has `https://nimrodecosystem.com`
     and `https://nimrod.onrender.com`, so you can leave it out.
   * To keep the pass phrase out of your command history, set `NIMROD_SPEECH_SECRET` instead of `--secret`.
   * If the Nimrod helper is installed here, it may already run the speech program on port 8797 (without
     `--allow-host`). The program then says "already running" and stops. Turn speech off in the helper,
     or start this one with `--port 8799` and use `8799` in the next step.

3. Give it a secure address, in a second PowerShell window:

       tailscale serve --bg 8797

   This serves `https://your-desktop.your-tailnet.ts.net/` and passes everything, WebSockets included,
   to `http://127.0.0.1:8797`. `--bg` keeps it on after you close the window, until you turn it off.
   If it complains about HTTPS or certificates, go back to the admin console step above.

4. Check it. `tailscale serve status` shows the address. On any device in your tailnet, open
   `https://your-desktop.your-tailnet.ts.net/health`. You should see `"ok": true` and `"engine":
   "whisper:small.en"`. The first visit can take a few seconds while the certificate is made.

To stop sharing it: `tailscale serve reset` (this clears every `tailscale serve` setting on the desktop).

## On the screen (the voice menu, advanced settings)

* **Then check what it heard with:** Another computer
* **Another computer: its address:** `wss://your-desktop.your-tailnet.ts.net/speech`
* **Another computer: its pass phrase:** the same pass phrase as `--secret`

The voice menu should then say the room's sound goes to that computer.

**The browser may ask once.** Chrome 147 and later ask before a website reaches a device on your own
network, and a Tailscale address counts as one. Someone has to press **Allow** once. A kiosk with nobody
to press it needs the browser policy that allows the site; the kiosk installer writes it when run with
`NIMROD_LOCK_POLICY=1`. Until it is allowed, the desktop just counts as not answering.

## When the desktop is off

The screen keeps working on its own first guess. Nothing waits for a computer that is not there:

* A sentence is only sent to the programs that are answering when it starts. If the desktop is off, the
  first guess is the final word: commands act at once and subtitles show it at once.
* The screen tries the desktop again after 1, 3 and 10 seconds, then every 30 seconds. When it comes
  back, the next sentence uses it.
* If the desktop is connected but slow (asleep, busy): a sure first guess acts at once. An unsure one
  waits for the desktop at most **4 seconds** (the setting "How long an unsure guess waits for a better
  one", 1 to 15 seconds), then acts on the best answer so far. A subtitle line stops waiting after
  15 seconds at most.
* A correction that comes after a command already acted only fixes the words on screen. It never runs a
  second command.
