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

## ⚙️ Prerequisites — all built + validated

These four code slices had to exist before the click-ops were runnable. All are done (validation noted);
the runbook below is executable end to end:

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

1. 👉 Put her media in **one folder** on the device (or attach her drive), e.g. everything under
   `~/cici-media`. Photos + videos together is fine — the photos module shows images *and* video; personal
   videos shows the videos.
2. 👉 Install the media agent as an always-on service from `web/media_agent/deploy/` (see its README):
   **Pi/Linux** `sudo ./install-linux.sh /path/to/media https://bedside.nimrodecosystem.com`;
   **Windows** copy `agent.env.example`→`agent.env`, edit it, then run `install-windows.ps1`. It serves
   that folder on `http://localhost:8770` and restarts on boot. Check: `curl http://localhost:8770/health`.
3. 👉 **Register that folder as her media source** — once, from any machine with `curl` + her key. The
   photos + personal modules **auto-adopt the single source**, so there's no per-module config:
   ```
   curl -X POST https://bedside.nimrodecosystem.com/api/media-sources \
     -H "X-Device-Key: <her secret>" -H "Content-Type: application/json" \
     -d '{"label":"Bedside media","base_url":"http://localhost:8770","kind":"agent"}'
   ```
   (Register exactly ONE source so auto-adopt is unambiguous; a real source-picker is the Media/Sources tab.)
4. 👉 **Pair the kiosk — this must be its FIRST launch.** On her device, open the kiosk once WITH the key:
   `https://bedside.nimrodecosystem.com/kiosk.html?key=<her secret>`. It stores the secret locally and
   auto-auths as her from then on. (A prod server returns 401 to any request without a valid key, so an
   un-paired first launch would just fail — pair first.)
5. 👉 **Set it to launch on boot in kiosk mode, WITHOUT the key** (it's stored now). E.g. Chromium:

   ```
   chromium-browser --kiosk --noerrdialogs --disable-session-crashed-bubble \
     --autoplay-policy=no-user-gesture-required \
     https://bedside.nimrodecosystem.com/kiosk.html
   ```

   added to the device's autostart.

   ⚠️ **`--autoplay-policy=no-user-gesture-required` is not optional on a bedside screen.**
   Without it Chromium refuses to start a video that has sound until somebody clicks the page.
   The person this screen is for cannot click anything, so the first personal video would sit
   on its first frame indefinitely — which is precisely the failure the invariant *nothing may
   require an input in order to keep doing what it is already doing* exists to rule out.

   The flag is the fix; it is not the only defence. `modules/personal.js` also watches for a
   refused start and falls back to playing the clip **muted**, saying so on screen, rather than
   freezing — because a flag can be dropped from an autostart line by anyone, and a screen in a
   care facility should not depend on remembering it.

## Part E — verify

- 👉 On her screen: photos rotate full-screen; the camera mirror shows the room (top-right); the clock
  reads the correct time bottom-left.
- 👉 Pull the network for a minute — photos/videos **keep playing** (local agent + cached config); it
  just stops syncing changes. Restore the network — it resyncs.
- 👉 **Sync check:** pair a second browser with the same key (open `…/kiosk.html?key=<her secret>` on your
  desktop), change a setting (e.g. the theme), and confirm her screen picks it up within a couple seconds.
  (Her *media* only loads on her device — the agent is on her `localhost` by design; another device would
  need the agent reachable over Tailscale/LAN, or the future sharing model. Config/state syncs anywhere.)

## Part F — Google login (OAuth) — the "regular user" path

The device key is the unattended-kiosk fallback; **Google login is how a normal user signs in.** With
it, someone opens the site → **Sign in with Google** → they're in, with a default profile. One-time setup:

1. 👉 **Google Cloud Console** → create/select a project (the dedicated project account that anchors
   YouTube/Drive is ideal) → **APIs & Services → OAuth consent screen**: External, app name "Nimrod",
   your support email, scopes `openid` + `email` + `profile`. In **Testing** mode add yourself (and
   Christine's account) as **test users** — that's enough for a handful of people; "publish" later for
   the public.
2. 👉 **Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorized
   redirect URIs** add exactly: `https://nimrod.onrender.com/auth/callback` (add the `bedside.` one too
   if/when you use the custom domain). Copy the **Client ID** and **Client secret**.
3. 👉 In **Render → Environment**, set (all secret):
   - `GOOGLE_CLIENT_ID` = the client id
   - `GOOGLE_CLIENT_SECRET` = the client secret
   - `SESSION_SECRET` = a long random string (signs the login cookie)
   Save → it redeploys.
4. 👉 Open `https://nimrod.onrender.com` → it redirects to the kiosk → **Sign in with Google** → you land
   on a dashboard with a default profile. The session lasts 30 days, so a bedside device stays signed in.

Notes: the server reads HTTPS correctly behind Render via `--proxy-headers` (in `render.yaml`), so the
callback URL is built as `https://…`. If the callback ever mismatches, set `OAUTH_REDIRECT_URI` in Render
to the exact URL. The device-key path still works as the unattended fallback; both satisfy `/api/me`.
Validated: 19 auth-logic checks (`test_identity.py`, incl. session auth) + a prod HTTP smoke (`/api/me`
401→200, `/` redirect, `/auth/login` 503 until configured). The live Google round-trip is verified here,
in Part F.

## Cost + upkeep

- **Neon** free · **Cloudflare** free · **Render Starter ~$7/mo** = **~$7/mo total**, and that ONE server
  serves *every* family who uses the site, not per-user. Scale up only when usage genuinely grows.
- Redeploys are automatic on push to `main` (Render watches the repo). Neon backs up the database on its
  own. Her device just needs the media agent running (the service handles restart-on-boot).
- **After a client update:** Cloudflare caches the static JS/HTML, so after a deploy **purge it**
  (Cloudflare → Caching → Purge Everything) so devices pick up the new code — or add a cache rule that
  bypasses cache for `*.html` / `*.js`. (The kiosk holds its page open, so this mainly bites on a
  reboot/reload; it's the same stale-JS trap we hit in dev.)
- **If the Render build fails on the Python version,** adjust `PYTHON_VERSION` in `render.yaml` to a
  version Render offers (it's pinned to a specific patch).

## Self-hosters (other families)

Everything above is what *you* (the operator of `nimrodecosystem.com`) do once. A regular family signs up
for **nothing** — they open the site and use it. A family that wants their own photos either runs the same
one-command media agent on any always-on machine they own, or points the platform at a **Google Drive
folder** (no server to run). A family that wants full self-hosting can run their own Render+Neon by
following this same runbook.
