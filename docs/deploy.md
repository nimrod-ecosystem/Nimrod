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

1. **Postgres backend in `web/server/db.py`.** Read `DATABASE_URL` from the env; use Postgres when set,
   fall back to the current SQLite for local dev. The `StateStore` interface was designed for exactly
   this — it's a backend swap, not a rewrite. (Validated with the existing store tests against Postgres.)
2. **Device-secret auth in `web/server/identity.py`.** `current_user()` currently returns `dev-user`.
   Add: a secret sent as a header (e.g. `X-Device-Key`) is looked up against an env-configured
   `DEVICE_KEYS` map → the user id. The client (kiosk) sends its stored secret on every request. Unknown
   secret → 401. (Keeps the `X-Dev-User` dev override behind a `DEV_MODE` flag.)
3. **Env-based config.** Server reads `PORT`, `DATABASE_URL`, `DEVICE_KEYS`, `DEV_MODE` from the env; a
   `web/server/render.yaml` (or the Render dashboard equivalent) declares the build + start command.
4. **Media-agent service.** A tiny wrapper so `agent.py` runs on her device as an always-on service
   (Windows Scheduled Task / a `.bat` at login, or a Linux `systemd` unit on a Pi), pointed at her media
   folder, restarting on boot.

I'll build 1–4 and mark them done here before you run the click-ops.

---

## Part A — accounts (one-time, ~15 min)

1. 👉 **Neon:** sign up (free). Create a project → a database. Copy its **connection string** (looks like
   `postgresql://user:pass@host/db`). Keep it handy — it becomes `DATABASE_URL`.
2. 👉 **Render:** sign up. Connect your GitHub so it can see the `Nimrod` repo.
3. 👉 **Cloudflare:** sign up (free).

## Part B — the server on Render

1. 👉 Render dashboard → **New → Web Service** → pick the `Nimrod` repo.
2. 👉 Settings:
   - **Root directory:** `web/server`
   - **Runtime:** Python 3
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Instance type:** **Starter (~$7/mo)** — always-on (the free tier sleeps after 15 min idle).
3. 👉 **Environment variables:**
   - `DATABASE_URL` = the Neon string from Part A
   - `DEVICE_KEYS` = `christine:<a-long-random-secret>` (generate a random string; this is her device's key)
   - `DEV_MODE` = `false`
4. 👉 Deploy. When it's live you get a URL like `https://nimrod-xxxx.onrender.com`. Open it — you should
   see the app. (It's HTTPS, so the camera will work.)

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
2. ⚙️ Install the media agent as an always-on service (Part-D helper from the ⚙️ list), pointed at that
   folder, e.g. serving `http://localhost:8770`. It restarts on boot.
3. 👉 Open Chrome/Chromium in **kiosk mode** at `https://bedside.nimrodecosystem.com/kiosk.html`.
4. 👉 **First-run pairing:** the kiosk asks for (or is launched with) the **device secret** you set in
   `DEVICE_KEYS` — it stores it locally and sends it on every request, so the screen auto-auths as her
   from then on. (Exact mechanism ships with ⚙️ #2.)
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
