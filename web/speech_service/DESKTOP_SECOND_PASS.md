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
   * If the Nimrod helper is installed here, it already runs the speech program on port 8797, and this
     second copy says "already running" and stops. Give the helper the name and the pass phrase instead
     (**Starting by itself**, below).

3. Give it a secure address, in a second PowerShell window:

       tailscale serve --bg 8797

   This serves `https://your-desktop.your-tailnet.ts.net/` and passes everything, WebSockets included,
   to `http://127.0.0.1:8797`. `--bg` keeps it on after you close the window, until you turn it off.
   If it complains about HTTPS or certificates, go back to the admin console step above.

4. Check it. `tailscale serve status` shows the address. On any device in your tailnet, open
   `https://your-desktop.your-tailnet.ts.net/health`. You should see `"ok": true` and `"engine":
   "whisper:small.en"`. The first visit can take a few seconds while the certificate is made.

To stop sharing it: `tailscale serve reset` (this clears every `tailscale serve` setting on the desktop).

**After a restart.** `tailscale serve --bg` comes back by itself: Tailscale's page on `tailscale serve`
(section "Effects of rebooting and restarting", last validated 26 January 2026) says that with `--bg`,
when you reboot the device or run `tailscale down` and `tailscale up`, Serve automatically resumes sharing.
On Windows, Tailscale itself only connects once someone signs in, unless **Run unattended** is turned on
in Tailscale's menu (Tailscale's "Run unattended" page). The speech program does **not** come back by
itself when it was started by hand. For that, use the helper.

## Starting by itself: the Nimrod helper

The Nimrod helper (`web/nimrod_helper`) starts the speech program when you sign in to Windows and starts
it again if it stops. It can give the speech program the secure name and the pass phrase, so it replaces
step 2 above. `tailscale serve` (step 3) stays as it is: it passes everything to `127.0.0.1:8797`,
whichever program is answering there. (Added 2026-10-12. `nimrod_helper/test_helper.py` runs the real
helper and speech program this way with the test engine; it has not yet been installed on a real desktop
with these settings.)

From the repo's `web` folder, in PowerShell:

1. Install it, with the desktop's full Tailscale name. `--models-dir` points at the Whisper model already
   on this computer, so nothing is downloaded. `--no-start` means nothing starts yet.

       py -3.13 -m nimrod_helper install --use-this-python --models-dir "$env:USERPROFILE\.cache\huggingface" --allow-host your-desktop.your-tailnet.ts.net --no-start

2. Give it the pass phrase. It asks twice and does not show what you type, so the pass phrase never goes
   in your command history:

       py -3.13 -m nimrod_helper secret

   It is kept in `%LOCALAPPDATA%\Nimrod Helper\speech_secret.txt`, on its own and not in `settings.json`.
   Your Windows account, the computer's administrators and Windows itself can read it; other ordinary
   accounts can't. The helper passes it to the speech program in that program's environment, never on its
   command line, so it is not in any log or in Task Manager. `secret --clear` removes it. Uninstalling
   removes it too.

3. Stop the copy you started by hand: press Ctrl+C in its window, or close the window. Port 8797 is free
   when this prints nothing:

       Get-NetTCPConnection -LocalPort 8797 -State Listen -ErrorAction SilentlyContinue

   (If you forget, nothing breaks: the helper sees 8797 is taken, does not start a second copy, and takes
   over within 15 seconds of the hand-started copy closing.)

4. Sign out of Windows and sign back in.

5. Check it:

       py -3.13 -m nimrod_helper status

   This should say `Speech program: running` (or `loading the speech model` for a few seconds first),
   `Speech program also answers to: your-desktop.your-tailnet.ts.net` and `Speech pass phrase: set`.
   Then, on any device in your tailnet, `https://your-desktop.your-tailnet.ts.net/health` should show
   `"ok": true`, `"engine": "whisper:small.en"` and `"secret": true`. The helper's own page is
   `http://127.0.0.1:8790/` on the desktop; the speech program's log is
   `%LOCALAPPDATA%\Nimrod Helper\logs\speech.log`.

**To change the name later:** run step 1 again with the new `--allow-host` (or `--allow-host ""` for none).
To change the pass phrase, run step 2 again: a running helper restarts the speech program with it
within a few seconds. Change it on the screen too.

**To update it after pulling new code:** stop it first, then install again with the same flags. The
pass phrase and settings are kept:

    py -3.13 -m nimrod_helper unregister --keep-data
    py -3.13 -m nimrod_helper install --use-this-python --models-dir "$env:USERPROFILE\.cache\huggingface" --allow-host your-desktop.your-tailnet.ts.net

**To go back to starting it by hand:** Settings, Apps, Installed apps, Nimrod helper, Uninstall (or
`py -3.13 -m nimrod_helper uninstall`). This removes the pass phrase file and the helper's settings. The
model cache named with `--models-dir` is left alone. Then run step 2 of the section above again.

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
