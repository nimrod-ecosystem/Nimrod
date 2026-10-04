"""recommend_search.py - SEARCH BY NAME FOR "RECOMMEND A SONG OR VIDEO", ON THE PERSON'S OWN KEYS.

Mike, 2026-10-04: "I have a Youtube API and Spotify account" - so the recommend window (recommend.js) can search
by title instead of only taking a pasted link. recommend.py is unchanged: every result here is turned into the
same (provider, kind, id) a pasted link becomes, checked with recommend.valid_ref, and handed to the page as
recommend.canonical_url - so picking a result is exactly pasting that link, and the preview, the send, the
oEmbed title and every check after it are the paste path's own.

*** BRING YOUR OWN KEY, PER ACCOUNT. *** CLAUDE.md: the default must cost the site owner nothing for anybody
else. So there is NO site-wide YouTube or Spotify key here; each account pastes its own, and its searches are
counted against its own free allowance. With no key the window shows the paste box exactly as before, plus one
line saying a key turns search on.

*** THE KEYS GO ONE WAY, THE CLAUDE KEY'S WAY. *** Stored with claude_ai.KeyBox (Fernet, NIMROD_AI_KEY_SECRET,
bound to the account id) in the reserved `_account` state scope - no new table, no migration, and the generic
state routes cannot reach it (claude_ai.ClaudeAccounts says why). Each sealed blob also names its provider, so a
YouTube blob copied into the Spotify row opens to nothing. Never sent back: the page sees "saved, ending ...4f2a".
Only a signed-in device may save or remove one (`_not_a_screen`, as for the Claude key); a screen may search.

*** THE BROWSER NEVER SEES A KEY, AND NO KEY IS EVER IN AN ADDRESS. *** YouTube takes its key in the
`X-goog-api-key` header (Google's documented alternative to `?key=`), so the key is not in any URL a proxy or
a log line could keep; Spotify's id and secret go in the Basic header of the client-credentials request, which
needs no Spotify sign-in from anybody.

*** WHAT A SEARCH IS NEVER: LOGGED OR STORED. *** The words searched for go to the provider and back. They
are posted in a JSON body, not a query string, for the same reason the key is not in a URL.

*** SEARCH IS ON A PRESS, NOT PER KEYSTROKE (recommend.js). *** A YouTube search costs 100 of the free 10,000
daily units: about 100 searches a day per key. Search-as-you-type would spend that in one afternoon.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import claude_ai
import notes
import recommend
from identity import current_user, via_device_key

log = logging.getLogger("nimrod.search")

PROVIDERS = ("youtube", "spotify")
ACCOUNT_SCOPE = claude_ai.ACCOUNT_SCOPE
KEY_ROWS = {"youtube": "youtube-search-key", "spotify": "spotify-search-key"}
SETTINGS_ROW = "search-settings"

# ---------------------------------------------------------------------------------- hard-coded numbers, argued
# EIGHT RESULTS A PROVIDER: the brief's "up to ~8". Eight big rows is about two phone screens; more is scrolling
# past songs nobody meant. Both providers at once is sixteen rows, grouped.
MAX_RESULTS = 8
# A QUERY IS 2 TO 100 CHARACTERS. One letter finds nothing useful and still costs a YouTube search; a song title
# with its singer is well under 100.
MIN_QUERY, MAX_QUERY = 2, 100
# 4 SECONDS, recommend.http_fetch's own number and reason: slower than that is a provider's bad minute, and the
# page says so in words rather than making somebody wait.
TIMEOUT = 4.0
# TWENTY SEARCHES A MINUTE PER ACCOUNT. A person searching manages perhaps five; a stuck loop would manage
# hundreds and burn the day's YouTube allowance in a minute. Checks ("does my key work?") get ten a minute.
# In process, notes.RateLimit's honest limit (resets on restart, not shared across workers).
SEARCH_PER_MINUTE = 20
CHECKS_PER_MINUTE = 10
# A Spotify pass (client credentials) lasts an hour; it is dropped a minute early so a search never goes out on
# one that expires on the way.
TOKEN_MARGIN_S = 60

# GUESS (on Mike's list): YouTube's strict filter by default. A recommendation lands on somebody else's page;
# a stranger's search for an innocent title can surface things the sender would never send. It is a setting on
# the keys page (strict / moderate / off) because an adult choosing for adults is entitled to turn it down.
SAFE_SEARCH = ("strict", "moderate", "none")
DEFAULT_SAFE_SEARCH = "strict"

YT_SEARCH = "https://www.googleapis.com/youtube/v3/search"
YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos"
SP_TOKEN = "https://accounts.spotify.com/api/token"
SP_SEARCH = "https://api.spotify.com/v1/search"
# The key check asks YouTube about one fixed public video: videos.list costs 1 unit, a search would cost 100.
CHECK_VIDEO = "dQw4w9WgXcQ"

# Google API keys are 39 characters starting "AIza" today. The shape checked here is looser on purpose (30 to 64
# letters, digits, - and _): a format Google changes should not lock people out, and "Check the key" asks Google.
YOUTUBE_KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{30,64}$")
SPOTIFY_PART_RE = re.compile(r"^[0-9A-Fa-f]{32}$")

NAME = {"youtube": "YouTube", "spotify": "Spotify"}


class Refused(Exception):
    """A request that cannot go, with the HTTP status and the plain-words sentence."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


class NotSetUp(Refused):
    def __init__(self, provider: str, detail: str | None = None):
        super().__init__(404, detail or f"There is no {NAME[provider]} key saved yet.")


# ------------------------------------------------------------------------------------------------ pure rules
def clean_youtube_key(raw) -> str:
    k = re.sub(r"\s+", "", str(raw or ""))
    if not k:
        raise ValueError("Paste the key first.")
    if not YOUTUBE_KEY_RE.match(k):
        raise ValueError("That does not look like a YouTube key (they are about 39 letters and numbers, usually "
                         "starting AIza).")
    return k


def clean_spotify(client_id, client_secret) -> tuple[str, str]:
    i = re.sub(r"\s+", "", str(client_id or ""))
    s = re.sub(r"\s+", "", str(client_secret or ""))
    if not i or not s:
        raise ValueError("Paste both the Client ID and the Client secret.")
    if not SPOTIFY_PART_RE.match(i):
        raise ValueError("That does not look like a Spotify Client ID (32 letters and numbers).")
    if not SPOTIFY_PART_RE.match(s):
        raise ValueError("That does not look like a Spotify Client secret (32 letters and numbers).")
    if i.lower() == s.lower():
        raise ValueError("The Client ID and the Client secret are the same - copy the secret from View client secret.")
    return i, s


def clean_query(raw) -> str:
    q = re.sub(r"\s+", " ", str(raw or "")).strip()
    if len(q) < MIN_QUERY:
        raise Refused(400, f"Type at least {MIN_QUERY} letters to search.")
    return q[:MAX_QUERY]


def which(raw, have: set) -> list[str]:
    """The providers to search: 'youtube' | 'spotify' | 'both', limited to the keys saved. PURE."""
    p = str(raw or "both").lower()
    want = list(PROVIDERS) if p == "both" else [p] if p in PROVIDERS else None
    if want is None:
        raise Refused(400, "Search YouTube, Spotify or both.")
    got = [x for x in want if x in have]
    if not got:
        missing = " or ".join(NAME[x] for x in want)
        raise Refused(404, f"There is no {missing} key saved yet, so there is nothing to search with.")
    return got


def _text(s, n: int) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(s or ""))).strip()[:n]


def result(provider: str, kind: str, item_id, title, by, thumb) -> dict | None:
    """One row the page draws, or None if it is not a shape the paste path accepts. PURE."""
    if not recommend.valid_ref(provider, kind, item_id):
        return None
    ref = {"provider": provider, "kind": kind, "id": str(item_id)}
    return {
        **ref, "title": _text(title, recommend.MAX_TITLE), "by": _text(by, 100),
        "thumbnail": thumb if recommend.thumb_ok(thumb) else "",
        "link": recommend.canonical_url(ref),
    }


def youtube_results(body) -> list[dict]:
    """search.list's answer -> rows. YouTube's titles come HTML-escaped (&#39;), so they are unescaped here and
    escaped again by the page when drawn. The picture is YouTube's fixed address for the id, as in recommend.py:
    no need to trust the answer's."""
    out = []
    for it in (body or {}).get("items") or [] if isinstance(body, dict) else []:
        if not isinstance(it, dict):
            continue
        vid = (it.get("id") or {}).get("videoId") if isinstance(it.get("id"), dict) else None
        sn = it.get("snippet") if isinstance(it.get("snippet"), dict) else {}
        r = result("youtube", "video", vid, sn.get("title"), sn.get("channelTitle"),
                   f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg")
        if r and all(x["id"] != r["id"] for x in out):
            out.append(r)
        if len(out) >= MAX_RESULTS:
            break
    return out


def _spotify_picture(images) -> str:
    """The smallest album picture at least 120 wide (Spotify lists 640, 300, 64); else the first."""
    imgs = [i for i in (images or []) if isinstance(i, dict) and recommend.thumb_ok(i.get("url"))]
    if not imgs:
        return ""
    big = [i for i in imgs if int(i.get("width") or 0) >= 120]
    pick = min(big, key=lambda i: int(i.get("width") or 0)) if big else imgs[0]
    return pick.get("url") or ""


def spotify_results(body) -> list[dict]:
    """search?type=track's answer -> rows. A Spotify track is recommend.py's "song"."""
    tracks = (body or {}).get("tracks") if isinstance(body, dict) else None
    out = []
    for it in (tracks or {}).get("items") or [] if isinstance(tracks, dict) else []:
        if not isinstance(it, dict):
            continue
        artists = ", ".join(a.get("name", "") for a in (it.get("artists") or []) if isinstance(a, dict) and a.get("name"))
        album = it.get("album") if isinstance(it.get("album"), dict) else {}
        r = result("spotify", "song", it.get("id"), it.get("name"), artists, _spotify_picture(album.get("images")))
        if r and all(x["id"] != r["id"] for x in out):
            out.append(r)
        if len(out) >= MAX_RESULTS:
            break
    return out


def _reasons(body) -> set[str]:
    err = body.get("error") if isinstance(body, dict) else None
    if not isinstance(err, dict):
        return set()
    out = {str(e.get("reason") or "") for e in (err.get("errors") or []) if isinstance(e, dict)}
    out.add(str(err.get("status") or ""))
    for d in err.get("details") or []:
        if isinstance(d, dict) and d.get("reason"):
            out.add(str(d["reason"]))
    msg = str(err.get("message") or "").lower()
    if "referer" in msg or "referrer" in msg or "ip address" in msg:
        out.add("ipRefererBlocked")
    return out - {""}


YT_USED_UP = ("Today’s YouTube searches on your key are used up (the free allowance is about 100 searches a day). "
              "They start again after midnight, Pacific time. You can still paste a link.")
YT_NOT_ENABLED = ("Your key works, but YouTube Data API v3 is not turned on for it. In the Google Cloud console, open "
                  "APIs & Services, then Library, find YouTube Data API v3 and press Enable.")
YT_RESTRICTED = ("Your key is limited to certain websites or addresses, so this site cannot use it. In the Google Cloud "
                 "console, set the key’s Application restrictions to None (limiting it to YouTube Data API v3 is fine).")
YT_BAD_KEY = "YouTube did not accept your key. Check it was copied whole, or paste a new one."


def youtube_error(status: int, body) -> str:
    """YouTube's error answer -> the sentence for the page. PURE."""
    r = _reasons(body)
    if r & {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"}:
        return YT_USED_UP
    if r & {"accessNotConfigured", "SERVICE_DISABLED"}:
        return YT_NOT_ENABLED
    if r & {"ipRefererBlocked", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
            "API_KEY_SERVICE_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED"}:
        return YT_RESTRICTED
    if status == 400 or r & {"keyInvalid", "keyExpired", "API_KEY_INVALID", "badRequest"} or status in (401, 403):
        return YT_BAD_KEY
    if status == 0:
        return "Could not reach YouTube just now. Try again shortly."
    if status >= 500:
        return "YouTube is having trouble just now. Try again shortly."
    return f"YouTube answered with an error ({status})."


SP_BAD_KEY = "Spotify did not accept your Client ID and Client secret. Check both were copied whole, or paste them again."


def spotify_error(status: int, body) -> str:
    """Spotify's error answer (the pass or the search) -> the sentence. PURE."""
    if status in (400, 401) or (isinstance(body, dict) and body.get("error") in ("invalid_client", "unauthorized_client")):
        return SP_BAD_KEY
    if status == 403:
        return ("Spotify refused the search for your app. Open the app on developer.spotify.com and check it is set "
                "up for the Web API.")
    if status == 429:
        return "Spotify says that is a lot of searches just now. Wait a minute and try again."
    if status == 0:
        return "Could not reach Spotify just now. Try again shortly."
    if status >= 500:
        return "Spotify is having trouble just now. Try again shortly."
    return f"Spotify answered with an error ({status})."


def clean_settings(raw) -> dict:
    o = raw if isinstance(raw, dict) else {}
    s = o.get("safe_search")
    return {"safe_search": s if s in SAFE_SEARCH else DEFAULT_SAFE_SEARCH}


# ------------------------------------------------------------------------------------------------ the network
def http_call(method: str, url: str, *, params=None, data=None, headers=None, timeout: float = TIMEOUT):
    """The real transport: (status, json_or_None). No redirects followed; 0 when nothing came back. Only ever
    called with the four fixed addresses above. Never logs the address's query or any header."""
    import httpx
    h = {"Accept": "application/json", "User-Agent": "nimrod-recommend-search/1", **(headers or {})}
    try:
        r = httpx.request(method, url, params=params, data=data, headers=h, timeout=timeout, follow_redirects=False)
    except httpx.HTTPError:
        return 0, None
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, None


# ------------------------------------------------------------------------------------------------ the keys
class SearchKeys:
    """Per account, over the ordinary state table: `_account` rows youtube-search-key, spotify-search-key and
    search-settings. `http` is injected (test_recommend.py hands in a fake; nothing there reaches the network)."""

    def __init__(self, store, *, keybox, http=None, now=None, clock=time.monotonic):
        self.store = store
        self.keybox = keybox
        self.http = http
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._clock = clock
        self._tokens: dict[str, tuple[str, str, float]] = {}   # account -> (fingerprint, pass, good until)
        self._lock = threading.Lock()

    def _call(self, *a, **kw):
        return (self.http or http_call)(*a, **kw)

    # -- plumbing (claude_ai.ClaudeAccounts' optimistic write, same reason)
    def _get(self, account: str, key: str) -> dict:
        return self.store.get_state(account, ACCOUNT_SCOPE, key)

    def _put(self, account: str, key: str, data: dict) -> None:
        for _ in range(5):
            cur = self._get(account, key)
            status, _res = self.store.put_state(account, ACCOUNT_SCOPE, key, data, cur.get("version", 0))
            if status == "ok":
                return
        raise Refused(503, "Could not save just now. Try again.")

    def _open(self, account: str, provider: str):
        row = self._get(account, KEY_ROWS[provider]).get("data") or {}
        sealed = row.get("sealed")
        if not sealed:
            raise NotSetUp(provider)
        if self.keybox is None:
            raise Refused(503, "This server cannot open saved keys right now (its key secret is not set).")
        raw = self.keybox.open(account, sealed)
        try:
            d = json.loads(raw) if raw else None
        except ValueError:
            d = None
        if not isinstance(d, dict) or d.get("p") != provider:
            raise NotSetUp(provider, f"Your saved {NAME[provider]} key can no longer be opened. Paste it again.")
        return d

    def have(self, account: str) -> set:
        return {p for p in PROVIDERS if (self._get(account, KEY_ROWS[p]).get("data") or {}).get("sealed")}

    # -- what the page sees: never a key
    def status(self, account: str) -> dict:
        out = {"can_store": self.keybox is not None, **self.settings(account),
               "safe_search_options": list(SAFE_SEARCH), "max_results": MAX_RESULTS}
        for p in PROVIDERS:
            row = self._get(account, KEY_ROWS[p]).get("data") or {}
            on = bool(row.get("sealed"))
            out[p] = {"set": on, "last4": row.get("last4") if on else None, "set_at": row.get("set_at") if on else None}
        out["any"] = out["youtube"]["set"] or out["spotify"]["set"]
        return out

    def settings(self, account: str) -> dict:
        return clean_settings(self._get(account, SETTINGS_ROW).get("data"))

    def set_settings(self, account: str, patch: dict) -> dict:
        s = (patch or {}).get("safe_search")
        if s not in SAFE_SEARCH:
            raise Refused(400, "Choose strict, moderate or off.")
        self._put(account, SETTINGS_ROW, {"safe_search": s})
        return self.status(account)

    def _seal(self, account: str, provider: str, payload: dict, last4: str) -> None:
        if self.keybox is None:
            raise Refused(503, "This server is not set up to keep keys yet (NIMROD_AI_KEY_SECRET is not set).")
        sealed = self.keybox.seal(account, json.dumps({"p": provider, **payload}))
        self._put(account, KEY_ROWS[provider], {"sealed": sealed, "last4": last4, "set_at": self._now().isoformat()})
        with self._lock:
            self._tokens.pop(account, None)
        log.info("search key set (account=%s provider=%s)", account, provider)

    def set_youtube(self, account: str, raw) -> dict:
        try:
            k = clean_youtube_key(raw)
        except ValueError as e:
            raise Refused(400, str(e))
        self._seal(account, "youtube", {"k": k}, k[-4:])
        return self.status(account)

    def set_spotify(self, account: str, client_id, client_secret) -> dict:
        try:
            i, s = clean_spotify(client_id, client_secret)
        except ValueError as e:
            raise Refused(400, str(e))
        # The last four shown are the CLIENT ID's: the id is not the secret, so nothing of the secret is kept clear.
        self._seal(account, "spotify", {"id": i, "secret": s}, i[-4:])
        return self.status(account)

    def clear(self, account: str, provider: str) -> dict:
        if provider not in PROVIDERS:
            raise Refused(404, "Only YouTube or Spotify.")
        # Overwritten with no sealed key: the state table keeps only the latest version (the Claude key's way).
        self._put(account, KEY_ROWS[provider], {"cleared_at": self._now().isoformat()})
        if provider == "spotify":
            with self._lock:
                self._tokens.pop(account, None)
        log.info("search key removed (account=%s provider=%s)", account, provider)
        return self.status(account)

    # -- YouTube
    def _youtube(self, account: str, q: str) -> list[dict]:
        k = self._open(account, "youtube")["k"]
        params = {"part": "snippet", "type": "video", "maxResults": str(MAX_RESULTS), "q": q,
                  "safeSearch": self.settings(account)["safe_search"]}
        st, body = self._call("GET", YT_SEARCH, params=params, headers={"X-goog-api-key": k})
        if st != 200:
            raise Refused(502, youtube_error(st, body))
        return youtube_results(body)

    # -- Spotify
    def _spotify_pass(self, account: str, *, fresh: bool = False) -> str:
        d = self._open(account, "spotify")
        fp = hashlib.sha256(f"{d['id']}:{d['secret']}".encode()).hexdigest()[:16]
        with self._lock:
            got = self._tokens.get(account)
            if got and not fresh and got[0] == fp and got[2] > self._clock():
                return got[1]
        basic = base64.b64encode(f"{d['id']}:{d['secret']}".encode()).decode()
        st, body = self._call("POST", SP_TOKEN, data={"grant_type": "client_credentials"},
                              headers={"Authorization": f"Basic {basic}"})
        tok = body.get("access_token") if isinstance(body, dict) else None
        if st != 200 or not isinstance(tok, str) or not tok:
            raise Refused(502, spotify_error(st, body))
        try:
            life = int(body.get("expires_in") or 3600)
        except (TypeError, ValueError):
            life = 3600
        with self._lock:
            self._tokens[account] = (fp, tok, self._clock() + max(0, life - TOKEN_MARGIN_S))
        return tok

    def _spotify(self, account: str, q: str) -> list[dict]:
        params = {"q": q, "type": "track", "limit": str(MAX_RESULTS)}
        for attempt in (0, 1):
            tok = self._spotify_pass(account, fresh=attempt == 1)
            st, body = self._call("GET", SP_SEARCH, params=params, headers={"Authorization": f"Bearer {tok}"})
            if st == 401 and attempt == 0:
                continue   # the pass ran out early: one fresh one, once
            if st != 200:
                raise Refused(502, spotify_error(st, body))
            return spotify_results(body)
        return []

    # -- the routes' calls
    def search(self, account: str, q, provider) -> dict:
        query = clean_query(q)
        want = which(provider, self.have(account))
        results: dict[str, list] = {}
        problems: dict[str, str] = {}

        def one(p):
            try:
                results[p] = self._youtube(account, query) if p == "youtube" else self._spotify(account, query)
            except Refused as e:
                problems[p] = e.detail

        if len(want) == 1:
            one(want[0])
        else:
            with ThreadPoolExecutor(max_workers=len(want)) as ex:
                list(ex.map(one, want))
        # COUNTS ONLY: never the words searched for.
        log.info("search account=%s providers=%s found=%s problems=%s", account, ",".join(want),
                 {p: len(v) for p, v in results.items()}, sorted(problems))
        return {"results": [r for p in want for r in results.get(p, [])], "searched": want, "problems": problems,
                "safe_search": self.settings(account)["safe_search"]}

    def check(self, account: str, provider: str) -> dict:
        if provider == "youtube":
            k = self._open(account, "youtube")["k"]
            st, body = self._call("GET", YT_VIDEOS, params={"part": "id", "id": CHECK_VIDEO}, headers={"X-goog-api-key": k})
            return {"ok": True} if st == 200 else {"ok": False, "reason": youtube_error(st, body)}
        if provider == "spotify":
            try:
                self._spotify_pass(account, fresh=True)
            except NotSetUp:
                raise
            except Refused as e:
                return {"ok": False, "reason": e.detail}
            return {"ok": True}
        raise Refused(404, "Only YouTube or Spotify.")


# ------------------------------------------------------------------------------------------------ the routes
class YouTubeKeyPut(BaseModel):
    key: str = ""


class SpotifyKeyPut(BaseModel):
    client_id: str = ""
    client_secret: str = ""


class SearchSettingsPut(BaseModel):
    safe_search: str = ""


class SearchPost(BaseModel):
    q: str = ""
    provider: str = "both"


# Set by make_router; looked up when a route runs, so test_recommend.py can swap in a fake transport
# (`recommend_search.keys.http = fake`) and reset the limits.
keys: SearchKeys | None = None
search_limit = notes.RateLimit(limit=SEARCH_PER_MINUTE, window=60.0)
check_limit = notes.RateLimit(limit=CHECKS_PER_MINUTE, window=60.0)


def _not_a_screen(request: Request) -> None:
    if via_device_key(request):
        raise HTTPException(status_code=403, detail="Change your search keys from your own phone or computer, "
                                                    "signed in - not from a screen.")


def _do(fn):
    try:
        return fn()
    except Refused as e:
        raise HTTPException(status_code=e.status, detail=e.detail)


def make_router(store, *, keybox=None) -> APIRouter:
    """The doors, under /api/recommend. app.py includes this with one line."""
    global keys
    keys = SearchKeys(store, keybox=keybox if keybox is not None else claude_ai.KeyBox.from_env())
    r = APIRouter(prefix="/api/recommend")

    @r.get("/keys")
    def search_keys_status(user: str = Depends(current_user)):
        """Which keys are saved (and their last four), the YouTube filter. NEVER a key."""
        return _do(lambda: keys.status(user))

    @r.put("/keys/youtube")
    def search_set_youtube(body: YouTubeKeyPut, request: Request, user: str = Depends(current_user)):
        _not_a_screen(request)
        return _do(lambda: keys.set_youtube(user, body.key))

    @r.put("/keys/spotify")
    def search_set_spotify(body: SpotifyKeyPut, request: Request, user: str = Depends(current_user)):
        _not_a_screen(request)
        return _do(lambda: keys.set_spotify(user, body.client_id, body.client_secret))

    @r.delete("/keys/{provider}")
    def search_clear_key(provider: str, request: Request, user: str = Depends(current_user)):
        _not_a_screen(request)
        return _do(lambda: keys.clear(user, provider))

    @r.post("/keys/{provider}/check")
    def search_check_key(provider: str, user: str = Depends(current_user)):
        """Does the saved key work? YouTube: one video's details (1 unit, not a 100-unit search). Spotify: a pass."""
        if not check_limit.hit(user):
            raise HTTPException(status_code=429, detail="That is a lot of checks in a minute - wait a moment.")
        return _do(lambda: keys.check(user, provider))

    @r.put("/keys/settings")
    def search_set_settings(body: SearchSettingsPut, request: Request, user: str = Depends(current_user)):
        _not_a_screen(request)
        return _do(lambda: keys.set_settings(user, body.model_dump()))

    @r.post("/search")
    def search(body: SearchPost, user: str = Depends(current_user)):
        """{q, provider: youtube|spotify|both} -> {results: [{provider, kind, id, title, by, thumbnail, link}],
        searched, problems: {provider: sentence}}. Each `link` is one the paste path accepts as it is."""
        try:
            clean_query(body.q)
        except Refused as e:
            raise HTTPException(status_code=e.status, detail=e.detail)
        if not search_limit.hit(user):
            raise HTTPException(status_code=429, detail="That is a lot of searches in a minute - wait a moment.")
        return _do(lambda: keys.search(user, body.q, body.provider))

    return r
