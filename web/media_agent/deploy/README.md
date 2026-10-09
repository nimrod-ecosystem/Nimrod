# Media agent as an always-on service

Run the media agent (`../agent.py`) on the device that holds the media, so it starts
on boot and restarts on crash. It serves that folder to your dashboard over
`http://localhost:<port>`; the platform server never sees the bytes.

The agent is configured from **environment variables** (CLI args still override):

| Variable | Meaning | Default |
|---|---|---|
| `NIMROD_MEDIA_ROOT` | folder of photos/videos to serve | *(required)* |
| `NIMROD_MEDIA_HOST` | bind address (`127.0.0.1` = localhost only) | `127.0.0.1` |
| `NIMROD_MEDIA_PORT` | port to listen on | `8770` |
| `NIMROD_MEDIA_ORIGIN` | the sites whose pages may use it (comma-separated) | unset: `https://nimrodecosystem.com` and the older address of the same site; pages on this computer always |

| `NIMROD_MEDIA_DATA` | the Data folder of your Nimrod folder; history is appended there (see below) | unset: off |

Set them in an `agent.env` file (copy `agent.env.example`).

## History to your Nimrod folder (optional)

When a person keeps their history in "your Nimrod folder", the page normally writes it
through the browser's own folder permission, and the browser can ask for that again after
a restart. Give the agent the Data folder and it writes the files itself, so nothing waits
for someone to press "Allow it again":

```bash
sudo NIMROD_MEDIA_DATA=/media/you/drive/Nimrod/Data ./install-linux.sh /path/to/media-folder
curl http://localhost:8770/history/status       # {"ready": true, "folder_id": ...} once the folder is there
```

- **Append only.** No route deletes, renames or overwrites anything; files are only added
  to, under `Data/History/` (one per kind, panel and month, a new part every 512 KiB -
  the same files the page writes itself).
- **Only from this computer**, only from the sites allowed above, only JSON, and at most
  256 KiB at once. Never outside `Data/History/`.
- **The Data folder is never created.** A drive that is not plugged in is reported as
  missing and the screen keeps the history until it is; then everything that waited is
  copied, once.
- The page uses it when one of the screen's media sources is this agent at
  `http://localhost:<port>`. Otherwise it uses the browser folder, as before.
- Keep the Data folder beside the media folder, not inside it: inside, its history files
  could be fetched from `/files` like a photo (the agent says so when it starts).
- An existing `/etc/nimrod/agent.env` is kept; the installer adds the line only when the
  file has none.

## Raspberry Pi / Linux (systemd)

```bash
cd web/media_agent/deploy
sudo ./install-linux.sh /path/to/media-folder
```

(A second argument names other sites, for a Nimrod served somewhere else. Without it the
agent allows the Nimrod site, as the helper does. It used to default to `*`, any website.)

That writes `/etc/nimrod/agent.env`, installs `nimrod-media-agent.service` (with your
python + agent path + login user), and enables + starts it. Then:

```bash
sudo systemctl status nimrod-media-agent      # is it running?
journalctl -u nimrod-media-agent -f           # logs
curl http://localhost:8770/health             # sanity check
```

## Windows (Task Scheduler)

```powershell
cd web\media_agent\deploy
copy agent.env.example agent.env      # then edit agent.env (set NIMROD_MEDIA_ROOT etc.)
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
Start-ScheduledTask -TaskName NimrodMediaAgent
```

`run-agent.ps1` loads `agent.env` and runs the agent in a restart loop; the scheduled
task launches it hidden at logon and restarts it if it stops. Check it with
`curl http://localhost:8770/health`.

## Notes

- **Bind address — the one that matters.** The agent has **no authentication**, and CORS
  is a *browser* policy: it does nothing against `curl`. So an all-interfaces bind
  (`0.0.0.0`) on a shared or public network means anyone on that network can list and
  download every file you are serving. `install-linux.sh` therefore binds
  **`127.0.0.1`** by default — correct for the common case where the agent runs on the
  kiosk machine itself. Serving a different device? Pass
  `sudo NIMROD_MEDIA_HOST=0.0.0.0 ./install-linux.sh ...`, and prefer a private/tailnet
  address over `0.0.0.0` where you can.
- **Which sites:** a page from any other site is refused (403). Leave `NIMROD_MEDIA_ORIGIN`
  unset for the Nimrod site; `*` lets every website you visit read the folder.
- **Same device as the kiosk?** Then `base_url` for the media source is
  `http://localhost:8770` — an HTTPS page is allowed to fetch `http://localhost`, so it
  works even though the page is HTTPS.
- **Different device** (agent on a desktop/NAS, viewed elsewhere): reach it over your
  LAN or Tailscale and use that address as the source `base_url`. `getUserMedia` (the
  camera mirror) still needs the *page* served over HTTPS/localhost, but the media
  fetch can be plain-HTTP `localhost` or your tailnet address.
