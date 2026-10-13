# A desktop as the storyteller

The Adventure module (talk with the people in town, or a free-form story) needs an AI program to tell the
story. A screen with no AI of its own, like a Raspberry Pi, can use the one on a desktop in the house: the
desktop's Ollama, reached over Tailscale, the same way the speech program is (see `DESKTOP_SECOND_PASS.md`
beside this file). Nothing about the screen's AI settings changes except one address and one model name.

These steps were written and checked on 2026-10-12 against this desktop (Ollama 0.35.1, models `qwen2.5:7b`
and `qwen2.5:3b`) and the current Ollama and Tailscale docs. **The Tailscale steps were not run.** Nothing here
installs or downloads anything.

## Why there is a small program in the middle

The obvious way, `tailscale serve` straight to Ollama, does not work. Measured on this desktop:

    curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:11434/v1/models                                         -> 200
    curl.exe -s -o NUL -w "%{http_code}" -H "Host: desktop-56volbn.tailce89ac.ts.net" http://127.0.0.1:11434/v1/models -> 403

Ollama refuses any request that names it by another computer's name (a guard against a web trick called DNS
rebinding), and `tailscale serve` passes the name the visitor used straight through. Ollama's own FAQ shows
the fix for every proxy it lists (nginx, ngrok, Cloudflare Tunnel): send Ollama the name `localhost:11434`
instead. `tailscale serve` has no setting for that, so `web/tools/ollama_tailnet_proxy.py` does it. It is a
few dozen lines of plain Python with nothing to install.

It also does a second job. **Ollama has no password.** Anybody who can reach it can use it, and also pull,
copy or delete its models. The small program passes on only the three things the site asks for (the list of
models, and a reply, two ways). Everything else gets "not found".

## On the desktop (PowerShell)

1. **Let the website use Ollama.** Ollama only answers web pages from websites on its allowed list, which is
   the setting `OLLAMA_ORIGINS`. On 2026-10-12 this desktop's Ollama already allowed
   `https://nimrodecosystem.com` (it answered the browser's check with that address). To see for yourself:

       curl.exe -s -i -X OPTIONS -H "Origin: https://nimrodecosystem.com" -H "Access-Control-Request-Method: POST" http://127.0.0.1:11434/v1/chat/completions

   The answer should include `Access-Control-Allow-Origin: https://nimrodecosystem.com`. If it does not:

       setx OLLAMA_ORIGINS "https://nimrodecosystem.com,https://nimrod.onrender.com"

   then quit Ollama from the tray and start it again (a running Ollama does not read the setting again).
   This adds to Ollama's own list, which always includes pages on this computer.

2. **Start the small program**, from the repo's `web` folder:

       py -3.13 tools\ollama_tailnet_proxy.py

   It says `Passing the site's AI requests from http://127.0.0.1:11435 to Ollama at http://127.0.0.1:11434`.
   Leave the window open. It listens on this computer only, so nothing on the home network can reach it
   directly. Tailscale is the only way in.

3. **Give it a secure address**, in a second PowerShell window:

       tailscale serve --bg --https=8443 http://127.0.0.1:11435

   This serves `https://desktop-56volbn.tailce89ac.ts.net:8443/` to devices on your tailnet only, and keeps
   it on after you close the window (`--bg`). Port 8443 leaves the speech program's address (port 443)
   alone. If it complains about HTTPS or certificates, do the admin-console step in
   `DESKTOP_SECOND_PASS.md` ("Once, in the Tailscale admin console") first. **Never use `tailscale funnel`
   for this:** Funnel puts it on the whole internet.

4. **Check it.** `tailscale serve status` shows the address. On any device in your tailnet, open
   `https://desktop-56volbn.tailce89ac.ts.net:8443/v1/models`. You should see a list with `qwen2.5:7b` and
   `qwen2.5:3b` in it. The first visit can take a few seconds while the certificate is made.

To stop sharing it: `tailscale serve --https=8443 off`, and close the small program's window. That leaves
the speech program's address as it was. (`tailscale serve reset` would clear both.)

**After a restart.** `tailscale serve --bg` comes back by itself. The small program does **not**: start it
again (step 2). Making it start by itself, like the speech program does through the Nimrod helper, is on
Mike's list.

## On the screen

Open the Nimrod guide, choose **Set up your guide / AI**, then **Use an online AI, or another address**:

* **Address:** `https://desktop-56volbn.tailce89ac.ts.net:8443/v1`
* **Model:** `qwen2.5:7b` for better stories, or `qwen2.5:3b` for quicker ones (the numbers are below).
  An address that is not on the screen's own network must name its model, so type it.

No key is needed: Ollama ignores one.

**The browser may ask once.** Chrome 147 and later ask before a website reaches a device on your own
network, and a Tailscale address counts as one. Someone has to press **Allow** once. A kiosk with nobody to
press it needs the browser policy that allows the site; the kiosk installer writes it when run with
`NIMROD_LOCK_POLICY=1`. Until it is allowed, the storyteller counts as not answering.

## How quick it is

Measured on this desktop on 2026-10-12 (processor only, no graphics card), through the real story code
(`story_ai.js`), with nothing else using the model:

| | `qwen2.5:3b` | `qwen2.5:7b` |
|---|---|---|
| Loading the model (first use after it has been idle) | 60 s | 139 s |
| An adventure turn (story and choices) | 19 to 42 s | 38 to 67 s |
| A reply in a conversation | 14 to 25 s | 27 to 43 s |
| A page of a story (Story time) | 43 s | 52 s |

The 7B model writes noticeably better stories and refuses unkind turns more reliably; the 3B model is about
twice as quick and once ran two choices together into one. Ollama unloads a model after 5 idle minutes by
default, so the first turn after a break also pays the loading time. The Adventure waits 2 minutes for a turn
by default (its setting "How long to wait for the storyteller"), then offers the choices again; pressing one
then finds the model loaded. (Ollama's `OLLAMA_KEEP_ALIVE` setting keeps a model loaded longer, at the cost of
its memory; it was not changed.)

## When the desktop is off

The screen keeps working. The Adventure says "The storyteller isn't answering; here are the choices again."
and the choices stay on the screen. Nothing waits for a computer that is not there. Every other module is
unaffected.

## Anyone on the tailnet can use it

There is no password on Ollama, and this does not add one. Every device on your tailnet can ask the desktop's
AI for a reply. Both sides:

* **Against:** a device on the tailnet that was taken over could use the desktop's processor for its own
  prompts, and read which models are installed. Anyone you ever share the desktop with in Tailscale gets the
  same. Ollama also answers whatever is asked, so a misbehaving device could keep the desktop busy.
* **For:** Mike's tailnet is his own devices (this desktop, the two Pis, his phone). Through the small
  program, a device can only ask for replies and see the list of models. It cannot add, change or delete
  models, or reach anything else on the desktop. Websites in a browser can only use it if they are on
  `OLLAMA_ORIGINS`. Nothing here is on the open internet.

**Recommendation:** acceptable for Mike's tailnet as it is, through the small program, never straight to
Ollama and never with Funnel. If the tailnet ever has other people's devices on it, limit port 8443 to the
screens with a Tailscale access rule (the admin console's Access controls), so only they can reach it.

## Sources

* Ollama FAQ, "How can I allow additional web origins to access Ollama?", "How can I use Ollama with a proxy
  server?" (nginx `proxy_set_header Host localhost:11434`), ngrok and Cloudflare Tunnel sections:
  https://docs.ollama.com/faq
* Ollama OpenAI compatibility (base URL `http://localhost:11434/v1/`, `/v1/chat/completions`, `/v1/models`,
  `response_format`, the key is ignored): https://docs.ollama.com/api/openai-compatibility
* Tailscale, `tailscale serve` command (last validated 26 January 2026): `--https=<port>`, `--bg`, `off`,
  `status`, "only `http://127.0.0.1` is supported for proxies", tailnet only: https://tailscale.com/kb/1242/tailscale-serve
* Tailscale source, the Serve reverse proxy passes the visitor's Host header on (`r.Out.Host = r.In.Host`):
  https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go
