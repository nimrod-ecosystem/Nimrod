# Deploy runbook — bedside dashboard

How to take the `web/` platform from "runs on a desktop" to "running at a bedside," end to end.
Legend: **👉 you do** (click-ops, no code) · **⚙️ build first** (code I prep + validate before that step
is executable). The ⚙️ items are listed up top so the order is clear; everything else is click-ops.

## What runs where (the shape)

- **Client + API — one origin on [Render](https://render.com).** The FastAPI app already serves the
  client on the same origin (`app.py` mounts `StaticFiles` at `/`). Keeping them together for v1 means
  **no CORS and no separate API URL** to configure. ~$7/mo always-on instance.
- **Database — [Neon](https://neon.tech) Postgres** (free tier). Lives *outside* the server, so a
  redeploy/restart never loses data, and it self-backs-up. Only tiny text (config, ~150 B/play).
- **CDN + HTTPS + DNS — [Cloudflare](https://cloudflare.com)** in front of Render (free). Gives the
  domain, a global cache for the static assets, and HTTPS (which the camera mirror *requires* —
  `getUserMedia` only runs on HTTPS or localhost).
- **Media — a local agent on her device.** `web/media_agent/agent.py` serves her photos/videos folder
  to `localhost`; the browser fetches media straight from it. **Nothing private ever touches the cloud.**
  An HTTPS page is allowed to fetch `http://localhost`, so this composes cleanly.
- **Auth — a per-device secret.** Her device holds a secret that maps to her user; nobody else can read
  her data. Full Google login (for caregivers/visitors) is a later slice.
- **Domain:** `nimrodecosystem.com`.

Later optimization (not needed for v1): split the static client onto **Cloudflare Pages** for a true
edge CDN. That adds CORS + a configurable API base URL — skip it until there's a reason.

## ⚙️ Build first (code slices, before the steps below are executable)

These don't exist yet; each is a small validated slice I'll build when you're ready to deploy:

1. **✅ Postgres backend in `web/server/db.py`** (built). Both engines share one `_Store` logic class;
   `app.py` picks `PostgresStore` when `DATABASE_URL` is set, else `SQLiteStore` for local dev. The
   shared logic (optimistic concurrency, append-only triggers, ownership) is validated by
   `test_store.py` (23 checks) + `test_media_sources.py` (12) via SQLite — the same code Postgres runs —
   and by an HTTP round-trip. The Postgres driver adapter's own **live smoke is this deploy** (Part B:
   deploy → open the URL → create a profile) since there's no local Postgres in dev. `requirements.txt`
   adds `psycopg[binary]` + `psycopg-pool` (used only when `DATABASE_URL` is set).
2. **✅ Device-secret auth in `web/server/identity.py`** (built). A secret sent as `X-Device-Key` is
   matched (constant-time) against the env `DEVICE_KEYS` (`user:secret,…`) → the user id. The kiosk
   pairs once via `?key=<secret>` (stored locally, sent on every request through the shared client
   `auth.js`). With `NIMROD_ENV=prod` it's **fail-closed**: only a valid device key is accepted — no
   dev override, no shared default, and a prod server with no `DEVICE_KEYS` denies everything. Validated:
   `test_identity.py` (14 checks) + a prod HTTP smoke (valid key → 200, missing/wrong/`X-Dev-User` → 401)
   + a client round-trip.
3. **✅ Env-based config + `render.yaml`** (built). The server already reads its config from the env
   (`PORT` via the start command, `DATABASE_URL` in `app.py`, `NIMROD_ENV` + `DEVICE_KEYS` in
   `identity.py`). A repo-root **`render.yaml` blueprint** declares the service (rootDir `web/server`,
   build/start commands, health check, `NIMROD_ENV=prod`, always-on plan, Python version) and marks
   `DATABASE_URL` + `DEVICE_KEYS` as **dashboard secrets kept out of git**. Validated: the blueprint
   parses with the right fields; the prod env path was smoke-tested.
4. **✅ Media-agent service** (built) — `web/media_agent/deploy/`. The agent now reads its config from
   env vars (`NIMROD_MEDIA_ROOT`/`_PORT`/`_ORIGIN`), so it runs cleanly as a service: **Pi/Linux** a
   `systemd` unit via `install-linux.sh` (restart on crash, start on boot); **Windows** a Task-Scheduler
   logon task via `install-windows.ps1` + `run-agent.ps1` (restart loop). See the `deploy/README.md`.
   Validated: `test_agent.py` (18) still green, the env-config path serves the folder over HTTP, and the
   Windows env parser handles paths-with-spaces + the origin URL. The actual `systemctl enable` /
   `Register-ScheduledTask` is Part D.

**All four ⚙️ prerequisites are built — the runbook below is now fully executable.**

---

## Part A — accounts (one-time, ~15 min)

1. 👉 **Neon:** sign up (free). Create a project → a database. Copy its **connection string** (looks like
   `postgresql://user:pass@host/db`). Keep it handy — it becomes `DATABASE_URL`.
2. 👉 **Render:** sign up. Connect your GitHub so it can see the `Nimrod` repo.
3. 👉 **Cloudflare:** sign up (free).

## Part B — the server on Render (via the blueprint)

1. 👉 Render dashboard → **New → Blueprint** → pick the `Nimrod` repo. Render reads the repo-root
   `render.yaml` and pre-fills everything: the service, `rootDir: web/server`, the build + start
   commands, the health check, `NIMROD_ENV=prod`, and the always-on Starter plan (~$7/mo).
2. 👉 It prompts for the two **secrets** (they live in the dashboard, never in git):
   - `DATABASE_URL` = the Neon string from Part A
   - `DEVICE_KEYS` = `christine:<a-long-random-secret>` (generate a random string — her device's key;
     add more `,user:secret` pairs later for other devices/people)
3. 👉 Apply. When it's live you get a URL like `https://nimrod-xxxx.onrender.com`. Open it — you should
   see the app (HTTPS, so the camera will work). Redeploys are automatic on push to the tracked branch.
   *(Prefer the blueprint; a manual "New → Web Service" with the same settings also works if you'd rather
   set the fields by hand.)*

## Part C — domain + CDN on Cloudflare

1. 👉 Cloudflare → **Add a site** → `nimrodecosystem.com`. Cloudflare shows you **two nameservers**.
2. 👉 In **Namecheap** (Domain tab → Nameservers): switch from "Namecheap BasicDNS" to **Custom DNS** and
   paste Cloudflare's two nameservers. (Propagation: minutes to a few hours. This is the one-time move
   that hands DNS to Cloudflare — your registration stays at Namecheap.)
3. 👉 In Cloudflare **DNS**, add a record for the app:
   - Type **CNAME**, name `bedside` (→ `bedside.nimrodecosystem.com`), target your `onrender.com` URL,
     **Proxy status: Proxied** (orange cloud — this gives the CDN cache + HTTPS).
4. 👉 In Render → your service → **Custom Domains**, add `bedside.nimrodecosystem.com` and follow its
   verification (it'll match the CNAME). Render issues the certificate automatically.
5. 👉 Remove the old Namecheap `nimrodecosystem.com → www` redirect (it's superseded now that Cloudflare
   runs DNS). Optionally add a Cloudflare redirect from the apex to `bedside` later.

Now `https://bedside.nimrodecosystem.com` serves the app, cached + HTTPS.

## Part D — her bedside device

1. 👉 Put her media on the device (or attach her drive), e.g. a `photos` folder and a `videos` folder.
2. 👉 Install the media agent as an always-on service from `web/media_agent/deploy/` (see its README):
   **Pi/Linux** `sudo ./install-linux.sh /path/to/media https://bedside.nimrodecosystem.com`;
   **Windows** copy `agent.env.example`→`agent.env`, edit it, then run `install-windows.ps1`. It serves
   that folder on `http://localhost:8770` and restarts on boot.
3. 👉 Open Chrome/Chromium in **kiosk mode** at `https://bedside.nimrodecosystem.com/kiosk.html`.
4. 👉 **First-run pairing (one time):** open the kiosk once as
   `https://bedside.nimrodecosystem.com/kiosk.html?key=<the DEVICE_KEYS secret>`. The device stores the
   secret locally and sends it (`X-Device-Key`) on every request from then on, so the screen auto-auths
   as her. Afterward, launch it without `?key=`.
5. 👉 **Point her modules at the local agent** (one-time, scriptable): set the photos + personal-video
   source `base_url` to `http://localhost:8770`. Until the Media/Sources UI exists, this is a small
   seed step I'll give you as a one-liner.

## Part E — verify

- 👉 Photos rotate full-screen; the camera mirror shows the room (top-right); the clock reads correct
  time bottom-left.
- 👉 Pull the network for a minute — photos/videos **keep playing** (local agent + cached config); it
  just stops syncing changes. Restore the network — it resyncs.
- 👉 From your phone, open `https://bedside.nimrodecosystem.com` (with your own login later) and confirm
  a config change reaches her screen within a couple seconds.

## Cost + upkeep

- **Neon** free · **Cloudflare** free · **Render Starter ~$7/mo** = **~$7/mo total**, and that ONE server
  serves *every* family who uses the site, not per-user. Scale up only when usage genuinely grows.
- Redeploys are automatic on push to `main` (Render watches the repo). Neon backs up the database on its
  own. Her device just needs the media agent running (the service handles restart-on-boot).

## Self-hosters (other families)

Everything above is what *you* (the operator of `nimrodecosystem.com`) do once. A regular family signs up
for **nothing** — they open the site and use it. A family that wants their own photos either runs the same
one-command media agent on any always-on machine they own, or points the platform at a **Google Drive
folder** (no server to run). A family that wants full self-hosting can run their own Render+Neon by
following this same runbook.
