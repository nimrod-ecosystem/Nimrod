# Media agent as an always-on service

Run the media agent (`../agent.py`) on the device that holds the media, so it starts
on boot and restarts on crash. It serves that folder to your dashboard over
`http://localhost:<port>`; the platform server never sees the bytes.

The agent is configured from **environment variables** (CLI args still override):

| Variable | Meaning | Default |
|---|---|---|
| `NIMROD_MEDIA_ROOT` | folder of photos/videos to serve | *(required)* |
| `NIMROD_MEDIA_PORT` | port to listen on | `8770` |
| `NIMROD_MEDIA_ORIGIN` | CORS origin — your dashboard URL | `*` (lock it down in prod) |

Set them in an `agent.env` file (copy `agent.env.example`).

## Raspberry Pi / Linux (systemd)

```bash
cd web/media_agent/deploy
sudo ./install-linux.sh /path/to/media-folder https://bedside.nimrodecosystem.com
```

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

- **CORS:** set `NIMROD_MEDIA_ORIGIN` to your dashboard origin so only your site can
  read the listing. `*` is for local testing only.
- **Same device as the kiosk?** Then `base_url` for the media source is
  `http://localhost:8770` — an HTTPS page is allowed to fetch `http://localhost`, so it
  works even though the page is HTTPS.
- **Different device** (agent on a desktop/NAS, viewed elsewhere): reach it over your
  LAN or Tailscale and use that address as the source `base_url`. `getUserMedia` (the
  camera mirror) still needs the *page* served over HTTPS/localhost, but the media
  fetch can be plain-HTTP `localhost` or your tailnet address.
