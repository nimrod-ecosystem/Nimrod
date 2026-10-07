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

*** ONE KEY, ENTERED ONCE (row 2.57, Mike 2026-10-07). *** "We should only have to enter the API once ... Entering
it in either place should set it as the default everywhere for that account or user. It should be something that
you can change at any level." So the account's key above is THE DEFAULT, and every use reads it: the recommend
window, and a YouTube panel's own search (modules/youtube.js), which used to keep a second copy of the key in the
panel's settings and ask Google from the browser with it in the address. That copy is gone (the panel hands an old
one over once, `adopt_youtube`), and the panel searches through here.
  WHERE A KEY MAY SIT, most particular first: one panel, one device, one person, then the account. The nearest one
  that has a key wins (settings.js's "nearest level set wins", the theme rule). Leaving a level out IS "use the
  default". The three particular ones live in ONE row per provider (`OVERRIDE_ROWS`), each entry sealed exactly
  like the default, so resolving a search is two reads.
  WHY THOSE FOUR AND NOT EVERY SETTINGS LEVEL (argued): a key answers "whose free allowance pays for this", which
  is an account's or a person's question, and "which key does this machine use", a device's. A panel is the rare
  one (trying out a new key on one player) and costs nothing extra to offer. "Every panel of this kind",
  "this dashboard" and "this screen" have no case a device or a panel does not already cover, so they are not
  offered; adding one is one entry in LEVELS.
  WHO MAY CHANGE WHICH (argued in `_may_change`): the account's owner, signed in on that browser, anything. A
  screen nobody has signed in on: a key for that one panel or that one device (what it could already do when the
  panel kept its own key), never the account's or a person's, and never the filter.

*** THE SPOTIFY CLIENT ID, ENTERED ONCE, AND READ BACK (row 2.61, Mike 2026-10-07). *** One Spotify app serves two
things: search here (Client ID + Client secret, client credentials, on this server) and the Music panel's Connect
(Client ID only, the person's own sign-in, PKCE in their browser; music_spotify.js). So the Client ID is kept in ONE
place, the Spotify row above, whichever page it was typed on, and:
  - it may be saved WITHOUT a secret (`set_spotify` with the secret blank). That row plays but does not search, and
    says so (`search: false`). Saving the same Client ID again without a secret keeps the secret already there.
  - the Music panel READS IT BACK (`GET /keys/spotify/client_id`), the one thing in these rows that ever leaves the
    server. ARGUED: FOR keeping it sealed like the rest - one rule for the whole row. AGAINST, and it decides it: a
    Client ID is public by design in PKCE. It is in the address of every Spotify sign-in this site starts, where
    anybody at that browser can read it, and on its own it can neither search (that needs the secret) nor play
    (that needs a person's own Spotify sign-in). Keeping it from the page would only mean a second copy in the
    panel's settings - the two-copies problem row 2.57 removed for YouTube. The secret never leaves.
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
from identity import current_user, signed_in_here, via_device_key

log = logging.getLogger("nimrod.search")

PROVIDERS = ("youtube", "spotify")
ACCOUNT_SCOPE = claude_ai.ACCOUNT_SCOPE
KEY_ROWS = {"youtube": "youtube-search-key", "spotify": "spotify-search-key"}
SETTINGS_ROW = "search-settings"
# Row 2.57: keys for one panel, one device or one person, one row per provider (see the header).
OVERRIDE_ROWS = {"youtube": "youtube-search-key-overrides", "spotify": "spotify-search-key-overrides"}
# The particular levels, MOST PARTICULAR FIRST: the order a search looks in before the account's default.
LEVELS = ("panel", "device", "person")
ACCOUNT = "account"
# What a screen nobody has signed in on may change (`_may_change`).
SCREEN_LEVELS = ("panel", "device")
# A panel id, a device id or a person id: the shapes this site makes them in (ids, uuids), nothing else.
REF_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,80}$")
# FIFTY PARTICULAR KEYS A PROVIDER. A household has a handful of screens and panels; fifty is far past any of
# them and still keeps the one row small. Past it the page says so, rather than the row growing without end.
MAX_OVERRIDES = 50
# A label (where it is used, in the owner's words: "Windows", "YouTube") is for the keys page to show, so short.
LABEL_MAX = 60

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


def clean_spotify_id(client_id) -> str:
    """A Spotify Client ID on its own (row 2.61: the Music panel's Connect needs nothing else). PURE."""
    i = re.sub(r"\s+", "", str(client_id or ""))
    if not i:
        raise ValueError("Paste the Client ID first.")
    if not SPOTIFY_PART_RE.match(i):
        raise ValueError("That does not look like a Spotify Client ID (32 letters and numbers).")
    return i


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


def clean_where(level, ref) -> tuple[str, str | None]:
    """(level, ref) a key is saved at or removed from. 'account' (or nothing) is the default. PURE."""
    lv = str(level or ACCOUNT).strip().lower()
    if lv == ACCOUNT:
        return ACCOUNT, None
    if lv not in LEVELS:
        raise Refused(400, "A key is saved for everywhere, one person, one device or one player.")
    r = str(ref or "").strip()
    if not REF_RE.match(r):
        raise Refused(400, f"Which {lv} the key is for was not said.")
    return lv, r


def clean_context(raw) -> dict:
    """{level: ref} for the particular levels a request names, the bad ones dropped (a search with a garbled
    device id still finds the account's key). PURE."""
    o = raw if isinstance(raw, dict) else {}
    out = {}
    for lv in LEVELS:
        r = str(o.get(lv) or "").strip()
        if r and REF_RE.match(r):
            out[lv] = r
    return out


def override_id(level: str, ref: str) -> str:
    return f"{level}:{ref}"


def clean_label(raw) -> str:
    return re.sub(r"\s+", " ", str(raw or "")).strip()[:LABEL_MAX]


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
    """Per account, over the ordinary state table: `_account` rows youtube-search-key, spotify-search-key (the
    defaults), youtube-search-key-overrides, spotify-search-key-overrides (one panel, device or person) and
    search-settings. `http` is injected (test_recommend.py hands in a fake; nothing there reaches the network)."""

    def __init__(self, store, *, keybox, http=None, now=None, clock=time.monotonic):
        self.store = store
        self.keybox = keybox
        self.http = http
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._clock = clock
        self._tokens: dict[str, tuple[str, float]] = {}   # account|fingerprint -> (pass, good until)
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

    def _edit(self, account: str, key: str, change) -> dict:
        """Read-change-write one row, retried on a conflict (two screens saving at once). `change(data)` returns
        the new data."""
        for _ in range(5):
            cur = self._get(account, key)
            data = change(dict(cur.get("data") or {}))
            status, _res = self.store.put_state(account, ACCOUNT_SCOPE, key, data, cur.get("version", 0))
            if status == "ok":
                return data
        raise Refused(503, "Could not save just now. Try again.")

    def _overrides(self, account: str, provider: str) -> dict:
        data = self._get(account, OVERRIDE_ROWS[provider]).get("data") or {}
        return data if isinstance(data, dict) else {}

    def _row(self, account: str, provider: str, level: str, ref: str | None, overrides: dict | None = None) -> dict:
        """The stored row for a key at one level (the default's row for 'account'); {} when none is there."""
        if level == ACCOUNT:
            return self._get(account, KEY_ROWS[provider]).get("data") or {}
        o = overrides if overrides is not None else self._overrides(account, provider)
        row = o.get(override_id(level, ref))
        return row if isinstance(row, dict) else {}

    def _open_row(self, account: str, provider: str, row: dict):
        if self.keybox is None:
            raise Refused(503, "This server cannot open saved keys right now (its key secret is not set).")
        raw = self.keybox.open(account, row.get("sealed"))
        try:
            d = json.loads(raw) if raw else None
        except ValueError:
            d = None
        if not isinstance(d, dict) or d.get("p") != provider:
            raise NotSetUp(provider, f"Your saved {NAME[provider]} key can no longer be opened. Paste it again.")
        return d

    def _chain(self, context) -> list[tuple[str, str | None]]:
        ctx = clean_context(context)
        return [(lv, ctx[lv]) for lv in LEVELS if lv in ctx] + [(ACCOUNT, None)]

    def in_force(self, account: str, provider: str, context=None) -> dict | None:
        """{level, last4, label} of the key a search here would use - the nearest level that has one - or None."""
        o = self._overrides(account, provider)
        for lv, ref in self._chain(context):
            row = self._row(account, provider, lv, ref, o)
            if row.get("sealed"):
                # `search: False` only for a Spotify Client ID saved without its secret (row 2.61), and only then
                # present: every other key searches, and rows from before that carry no flag and had both.
                out = {"level": lv, "last4": row.get("last4"), "label": row.get("label") or ""}
                if row.get("search") is False:
                    out["search"] = False
                return out
        return None

    def _open(self, account: str, provider: str, context=None):
        """The key a search here uses: the nearest level that has one. A key there that will not open is said,
        never silently skipped for the next one up (somebody would be searching on a key they did not choose)."""
        o = self._overrides(account, provider)
        for lv, ref in self._chain(context):
            row = self._row(account, provider, lv, ref, o)
            if row.get("sealed"):
                return self._open_row(account, provider, row)
        raise NotSetUp(provider)

    def have(self, account: str, context=None) -> set:
        """The providers a search here can use. A Spotify Client ID saved without its secret plays but does not
        search, so it is not counted - and the one in force is never skipped for a fuller one further up."""
        return {p for p in PROVIDERS if (f := self.in_force(account, p, context)) and f.get("search", True)}

    # -- what the page sees: never a key
    def status(self, account: str, context=None) -> dict:
        out = {"can_store": self.keybox is not None, **self.settings(account),
               "safe_search_options": list(SAFE_SEARCH), "max_results": MAX_RESULTS}
        ctx = clean_context(context)
        for p in PROVIDERS:
            row = self._row(account, p, ACCOUNT, None)
            on = bool(row.get("sealed"))
            parts = []
            for oid, e in sorted(self._overrides(account, p).items()):
                if not (isinstance(e, dict) and e.get("sealed") and ":" in oid):
                    continue
                lv, ref = oid.split(":", 1)
                parts.append({"level": lv, "ref": ref, "label": e.get("label") or "", "last4": e.get("last4"),
                              "set_at": e.get("set_at"), "here": ctx.get(lv) == ref})
            out[p] = {"set": on, "last4": row.get("last4") if on else None, "set_at": row.get("set_at") if on else None,
                      "search": (row.get("search", True) is not False) if on else None,
                      "in_force": self.in_force(account, p, ctx), "overrides": parts}
        out["any"] = bool(out["youtube"]["in_force"] or out["spotify"]["in_force"])
        return out

    def settings(self, account: str) -> dict:
        return clean_settings(self._get(account, SETTINGS_ROW).get("data"))

    def set_settings(self, account: str, patch: dict) -> dict:
        s = (patch or {}).get("safe_search")
        if s not in SAFE_SEARCH:
            raise Refused(400, "Choose strict, moderate or off.")
        self._put(account, SETTINGS_ROW, {"safe_search": s})
        return self.status(account)

    def _label_for(self, account: str, level: str, ref: str | None, label) -> str:
        """A person's key is labelled with the person's own name, and only a person of this account may have one."""
        if level == "person":
            got = None
            try:
                got = self.store.get_person(account, ref)
            except Exception:
                got = None
            if not got:
                raise Refused(404, "That person is not one of yours.")
            return clean_label(got.get("name") or label)
        return clean_label(label)

    def _seal(self, account: str, provider: str, payload: dict, last4: str, level: str = ACCOUNT,
              ref: str | None = None, label="", search: bool = True) -> None:
        if self.keybox is None:
            raise Refused(503, "This server is not set up to keep keys yet (NIMROD_AI_KEY_SECRET is not set).")
        level, ref = clean_where(level, ref)
        name = self._label_for(account, level, ref, label)
        sealed = self.keybox.seal(account, json.dumps({"p": provider, **payload}))
        row = {"sealed": sealed, "last4": last4, "set_at": self._now().isoformat()}
        if not search:
            row["search"] = False       # a Spotify Client ID with no secret (row 2.61): plays, does not search
        if level == ACCOUNT:
            self._put(account, KEY_ROWS[provider], row)
        else:
            oid = override_id(level, ref)

            def put(data):
                if oid not in data and sum(1 for v in data.values() if isinstance(v, dict) and v.get("sealed")) >= MAX_OVERRIDES:
                    raise Refused(409, f"There are already {MAX_OVERRIDES} {NAME[provider]} keys saved for one "
                                       "person, device or player. Remove some first.")
                data[oid] = {**row, "label": name}
                return data
            self._edit(account, OVERRIDE_ROWS[provider], put)
        self._forget_passes(account)
        log.info("search key set (account=%s provider=%s level=%s)", account, provider, level)

    def set_youtube(self, account: str, raw, level: str = ACCOUNT, ref: str | None = None, label="") -> dict:
        try:
            k = clean_youtube_key(raw)
        except ValueError as e:
            raise Refused(400, str(e))
        self._seal(account, "youtube", {"k": k}, k[-4:], level, ref, label)
        return self.status(account)

    def set_spotify(self, account: str, client_id, client_secret, level: str = ACCOUNT, ref: str | None = None,
                    label="") -> dict:
        if not re.sub(r"\s+", "", str(client_secret or "")):
            # (row 2.61) The Client ID alone: what the Music panel's Connect needs.
            self.set_spotify_id(account, client_id, level, ref, label)
            return self.status(account)
        try:
            i, s = clean_spotify(client_id, client_secret)
        except ValueError as e:
            raise Refused(400, str(e))
        # The last four shown are the CLIENT ID's: the id is not the secret, so nothing of the secret is kept clear.
        self._seal(account, "spotify", {"id": i, "secret": s}, i[-4:], level, ref, label)
        return self.status(account)

    def _spotify_at(self, account: str, level: str, ref: str | None) -> dict | None:
        """The Spotify pair saved at exactly this level (not the one in force), opened; None when there is none or
        it will not open."""
        row = self._row(account, "spotify", level, ref)
        if not row.get("sealed"):
            return None
        try:
            return self._open_row(account, "spotify", row)
        except NotSetUp:
            return None

    def set_spotify_id(self, account: str, client_id, level: str = ACCOUNT, ref: str | None = None,
                       label="") -> str:
        """(row 2.61) Save a Spotify Client ID with no secret. {'saved' | 'same'}:
          - the same Client ID already saved at this level: its secret is KEPT (it belongs to that app), and the row
            is sealed again - nothing is lost by typing the ID twice;
          - a different one: saved with no secret (the old secret belongs to the old app, so it goes with it), and
            the row says it plays but does not search;
          - a narrower level (panel, device, person) whose nearest saved Client ID is ALREADY this one: nothing is
            saved ('same'). A copy there would carry no secret and would stop search from that place for no gain."""
        try:
            i = clean_spotify_id(client_id)
        except ValueError as e:
            raise Refused(400, str(e))
        level, ref = clean_where(level, ref)
        mine = self._spotify_at(account, level, ref)
        if level != ACCOUNT and not mine:
            have = self.client_id(account, {level: ref})
            if have and have["client_id"] == i:
                return "same"
        secret = ((mine or {}).get("secret") or "") if (mine or {}).get("id") == i else ""
        self._seal(account, "spotify", {"id": i, "secret": secret}, i[-4:], level, ref, label, search=bool(secret))
        return "saved"

    def adopt_spotify_id(self, account: str, raw, panel_ref, label="") -> dict:
        """A Music panel's OLD Client ID, kept in its own settings before row 2.61, handed over once - exactly
        `adopt_youtube`'s rule: the account's when it has none, nothing when it is the same, else kept for that one
        panel. The panel then empties its own copy. {where: 'account' | 'same' | 'panel', ...status}."""
        try:
            i = clean_spotify_id(raw)
        except ValueError as e:
            raise Refused(400, str(e))
        _lv, ref = clean_where("panel", panel_ref)
        acct = self._row(account, "spotify", ACCOUNT, None)
        where = "account"
        if acct.get("sealed"):
            where = "same" if (self._spotify_at(account, ACCOUNT, None) or {}).get("id") == i else "panel"
        if where == "account":
            self.set_spotify_id(account, i)
        elif where == "panel":
            self.set_spotify_id(account, i, "panel", ref, label)
        return {"where": where, **self.status(account, {"panel": ref})}

    def client_id(self, account: str, context=None) -> dict | None:
        """(row 2.61) The Spotify Client ID in force from here - the nearest level that has one - for the Music
        panel's Connect: {client_id, level, search}, or None. The ONE value from these rows that leaves the server;
        the module header argues why. Never the secret."""
        o = self._overrides(account, "spotify")
        for lv, ref in self._chain(context):
            row = self._row(account, "spotify", lv, ref, o)
            if row.get("sealed"):
                d = self._open_row(account, "spotify", row)
                cid = d.get("id") if isinstance(d.get("id"), str) else ""
                if not SPOTIFY_PART_RE.match(cid or ""):
                    raise NotSetUp("spotify", "Your saved Spotify Client ID can no longer be opened. Paste it again.")
                return {"client_id": cid, "level": lv, "search": row.get("search", True) is not False}
        return None

    def adopt_youtube(self, account: str, raw, panel_ref, label="") -> dict:
        """A YouTube panel's OLD key, kept in its own settings before row 2.57, handed over once. It becomes the
        account's default when there is none; when the default is the same key there is nothing to keep; when it
        is a different key, it is kept for that one panel, so the panel searches exactly as it did. The panel then
        empties its own copy. {where: 'account' | 'same' | 'panel', ...status}."""
        try:
            k = clean_youtube_key(raw)
        except ValueError as e:
            raise Refused(400, str(e))
        _lv, ref = clean_where("panel", panel_ref)
        row = self._row(account, "youtube", ACCOUNT, None)
        where = "account"
        if row.get("sealed"):
            try:
                same = self._open_row(account, "youtube", row).get("k") == k
            except NotSetUp:
                same = False      # the default no longer opens: keep this one for the panel, say nothing
            where = "same" if same else "panel"
        if where == "account":
            self._seal(account, "youtube", {"k": k}, k[-4:])
        elif where == "panel":
            self._seal(account, "youtube", {"k": k}, k[-4:], "panel", ref, label)
        return {"where": where, **self.status(account, {"panel": ref})}

    def clear(self, account: str, provider: str, level: str = ACCOUNT, ref: str | None = None) -> dict:
        if provider not in PROVIDERS:
            raise Refused(404, "Only YouTube or Spotify.")
        level, ref = clean_where(level, ref)
        if level == ACCOUNT:
            # Overwritten with no sealed key: the state table keeps only the latest version (the Claude key's way).
            self._put(account, KEY_ROWS[provider], {"cleared_at": self._now().isoformat()})
        else:
            oid = override_id(level, ref)

            def drop(data):
                data.pop(oid, None)
                return data
            self._edit(account, OVERRIDE_ROWS[provider], drop)
        self._forget_passes(account)
        log.info("search key removed (account=%s provider=%s level=%s)", account, provider, level)
        return self.status(account)

    def _forget_passes(self, account: str) -> None:
        with self._lock:
            for k in [k for k in self._tokens if k.startswith(f"{account}|")]:
                self._tokens.pop(k, None)

    # -- YouTube
    def _youtube(self, account: str, q: str, context=None) -> list[dict]:
        k = self._open(account, "youtube", context)["k"]
        params = {"part": "snippet", "type": "video", "maxResults": str(MAX_RESULTS), "q": q,
                  "safeSearch": self.settings(account)["safe_search"]}
        st, body = self._call("GET", YT_SEARCH, params=params, headers={"X-goog-api-key": k})
        if st != 200:
            raise Refused(502, youtube_error(st, body))
        return youtube_results(body)

    # -- Spotify
    def _spotify_pass(self, account: str, *, fresh: bool = False, context=None) -> str:
        d = self._open(account, "spotify", context)
        if not d.get("secret"):
            raise NotSetUp("spotify", "Your Spotify Client ID is saved without its Client secret, so it can play but "
                                      "not search. Add the Client secret to search Spotify too.")
        fp = hashlib.sha256(f"{d['id']}:{d['secret']}".encode()).hexdigest()[:16]
        slot = f"{account}|{fp}"
        with self._lock:
            got = self._tokens.get(slot)
            if got and not fresh and got[1] > self._clock():
                return got[0]
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
            self._tokens[slot] = (tok, self._clock() + max(0, life - TOKEN_MARGIN_S))
        return tok

    def _spotify(self, account: str, q: str, context=None) -> list[dict]:
        params = {"q": q, "type": "track", "limit": str(MAX_RESULTS)}
        for attempt in (0, 1):
            tok = self._spotify_pass(account, fresh=attempt == 1, context=context)
            st, body = self._call("GET", SP_SEARCH, params=params, headers={"Authorization": f"Bearer {tok}"})
            if st == 401 and attempt == 0:
                continue   # the pass ran out early: one fresh one, once
            if st != 200:
                raise Refused(502, spotify_error(st, body))
            return spotify_results(body)
        return []

    # -- the routes' calls
    def search(self, account: str, q, provider, context=None) -> dict:
        query = clean_query(q)
        want = which(provider, self.have(account, context))
        results: dict[str, list] = {}
        problems: dict[str, str] = {}

        def one(p):
            try:
                results[p] = (self._youtube(account, query, context) if p == "youtube"
                              else self._spotify(account, query, context))
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

    def check(self, account: str, provider: str, context=None) -> dict:
        if provider == "youtube":
            k = self._open(account, "youtube", context)["k"]
            st, body = self._call("GET", YT_VIDEOS, params={"part": "id", "id": CHECK_VIDEO}, headers={"X-goog-api-key": k})
            return {"ok": True} if st == 200 else {"ok": False, "reason": youtube_error(st, body)}
        if provider == "spotify":
            try:
                self._spotify_pass(account, fresh=True, context=context)
            except NotSetUp:
                raise
            except Refused as e:
                return {"ok": False, "reason": e.detail}
            return {"ok": True}
        raise Refused(404, "Only YouTube or Spotify.")


# ------------------------------------------------------------------------------------------------ the routes
class Where(BaseModel):
    """Where a key is saved: level 'account' (the default) | 'person' | 'device' | 'panel', and which one."""
    level: str = ACCOUNT
    ref: str = ""
    label: str = ""


class YouTubeKeyPut(Where):
    key: str = ""


class SpotifyKeyPut(Where):
    client_id: str = ""
    client_secret: str = ""


class YouTubeAdopt(BaseModel):
    key: str = ""
    panel: str = ""
    label: str = ""


class SpotifyAdopt(BaseModel):
    client_id: str = ""
    panel: str = ""
    label: str = ""


class SearchSettingsPut(BaseModel):
    safe_search: str = ""


class SearchPost(BaseModel):
    q: str = ""
    provider: str = "both"
    # Where the search is made from, so the nearest key wins (row 2.57). All optional: none = the default.
    panel: str = ""
    device: str = ""
    person: str = ""


# Set by make_router; looked up when a route runs, so test_recommend.py can swap in a fake transport
# (`recommend_search.keys.http = fake`) and reset the limits.
keys: SearchKeys | None = None
search_limit = notes.RateLimit(limit=SEARCH_PER_MINUTE, window=60.0)
check_limit = notes.RateLimit(limit=CHECKS_PER_MINUTE, window=60.0)

SIGN_IN_FIRST = ("Saving or removing a key for everywhere, or for a person, needs you signed in on this browser. "
                 "From a screen nobody has signed in on, a key can be saved for that one player or that one device.")


def owner_here(request: Request, user: str) -> bool:
    """The account's owner is at this browser: it is not a screen, or it is one somebody has signed in on with this
    account's own login (identity.signed_in_here: Mike's computer showing a screen page)."""
    return not via_device_key(request) or signed_in_here(request, user)


def _may_change(request: Request, user: str, level: str) -> None:
    """*** WHO MAY CHANGE A KEY (row 2.57), argued. ***
    BEFORE: no screen could change any key ("pasting, replacing or removing a paid key is for the account owner's
    own signed-in device", identity.via_device_key). That kept a passer-by in a care room from swapping a key - and
    also stopped Mike, at his own computer showing a screen page, which is what he hit: the Devices row could only
    show him a code for his phone.
    NOW: (1) a screen that ALSO carries the account owner's own sign-in is the owner's browser, so it may change
    anything; (2) a screen nobody has signed in on may save or remove a key for ONE PANEL or ONE DEVICE - what it
    could always do when a panel kept its own key in its settings - and nothing wider: not the account's default,
    not a person's, not the filter. FOR letting a bare screen fill an EMPTY default (what Mike first asked: "either
    place should set it as the default"): it is the owner's own panel, usually. AGAINST, and it decides it: the
    server cannot tell the owner from whoever walked past, and the default is what every screen and search of the
    account uses. So from a bare screen the panel says to sign in, or to save it for this panel or device."""
    if owner_here(request, user) or level in SCREEN_LEVELS:
        return
    raise HTTPException(status_code=403, detail=SIGN_IN_FIRST)


def _do(fn):
    try:
        return fn()
    except Refused as e:
        raise HTTPException(status_code=e.status, detail=e.detail)


def _level(level) -> str:
    try:
        return clean_where(level, "x")[0]
    except Refused as e:
        raise HTTPException(status_code=e.status, detail=e.detail)


def make_router(store, *, keybox=None) -> APIRouter:
    """The doors, under /api/recommend. app.py includes this with one line."""
    global keys
    keys = SearchKeys(store, keybox=keybox if keybox is not None else claude_ai.KeyBox.from_env())
    r = APIRouter(prefix="/api/recommend")

    def _status(request: Request, user: str, context=None) -> dict:
        return {**keys.status(user, context), "can_change": owner_here(request, user),
                "signed_in": signed_in_here(request, user), "screen_levels": list(SCREEN_LEVELS)}

    @r.get("/keys")
    def search_keys_status(request: Request, panel: str = "", device: str = "", person: str = "",
                           user: str = Depends(current_user)):
        """Which keys are saved (their last four), which one is in force from here, the YouTube filter, and what
        this browser may change. NEVER a key. `panel`/`device`/`person`: where "here" is."""
        ctx = {"panel": panel, "device": device, "person": person}
        return _do(lambda: _status(request, user, ctx))

    @r.put("/keys/youtube")
    def search_set_youtube(body: YouTubeKeyPut, request: Request, user: str = Depends(current_user)):
        _may_change(request, user, _level(body.level))
        return _do(lambda: (keys.set_youtube(user, body.key, body.level, body.ref, body.label),
                            _status(request, user, {body.level: body.ref}))[1])

    @r.post("/keys/youtube/adopt")
    def search_adopt_youtube(body: YouTubeAdopt, request: Request, user: str = Depends(current_user)):
        """A panel's old key, handed over once (SearchKeys.adopt_youtube). ALLOWED FROM A SCREEN, argued: the key is
        already in that panel's own settings on this server, where the screen can read it; moving it into the
        sealed store makes it harder to see, never easier. The one thing a bare screen gets here that it does not
        get from PUT is filling an EMPTY default - and only with a key the account's own panel already held."""
        out = _do(lambda: keys.adopt_youtube(user, body.key, body.panel, body.label))
        return {**out, "can_change": owner_here(request, user), "signed_in": signed_in_here(request, user),
                "screen_levels": list(SCREEN_LEVELS)}

    @r.put("/keys/spotify")
    def search_set_spotify(body: SpotifyKeyPut, request: Request, user: str = Depends(current_user)):
        _may_change(request, user, _level(body.level))
        return _do(lambda: (keys.set_spotify(user, body.client_id, body.client_secret, body.level, body.ref, body.label),
                            _status(request, user, {body.level: body.ref}))[1])

    @r.get("/keys/spotify/client_id")
    def search_spotify_client_id(request: Request, panel: str = "", device: str = "", person: str = "",
                                 user: str = Depends(current_user)):
        """(row 2.61) The Spotify Client ID in force from here, for the Music panel's Connect: {client_id, level,
        search, can_change, signed_in, screen_levels}; client_id '' when none is saved. A screen may read it (it is
        what the screen signs in to Spotify with); the module header argues why it may leave the server at all."""
        got = _do(lambda: keys.client_id(user, {"panel": panel, "device": device, "person": person}))
        return {"client_id": (got or {}).get("client_id", ""), "level": (got or {}).get("level"),
                "search": bool((got or {}).get("search")), "can_store": keys.keybox is not None,
                "can_change": owner_here(request, user), "signed_in": signed_in_here(request, user),
                "screen_levels": list(SCREEN_LEVELS)}

    @r.post("/keys/spotify/adopt")
    def search_adopt_spotify(body: SpotifyAdopt, request: Request, user: str = Depends(current_user)):
        """A Music panel's old Client ID, handed over once (SearchKeys.adopt_spotify_id). Allowed from a screen for
        the YouTube adopt's reason: it is already in that panel's own settings on this server."""
        out = _do(lambda: keys.adopt_spotify_id(user, body.client_id, body.panel, body.label))
        return {**out, "can_change": owner_here(request, user), "signed_in": signed_in_here(request, user),
                "screen_levels": list(SCREEN_LEVELS)}

    @r.delete("/keys/{provider}")
    def search_clear_key(provider: str, request: Request, level: str = ACCOUNT, ref: str = "",
                         user: str = Depends(current_user)):
        """Remove the key at one level: that level then uses the next one up ("use the default")."""
        _may_change(request, user, _level(level))
        return _do(lambda: (keys.clear(user, provider, level, ref), _status(request, user, {level: ref}))[1])

    @r.post("/keys/{provider}/check")
    def search_check_key(provider: str, panel: str = "", device: str = "", person: str = "",
                         user: str = Depends(current_user)):
        """Does the key in force from here work? YouTube: one video's details (1 unit, not a 100-unit search).
        Spotify: a pass."""
        if not check_limit.hit(user):
            raise HTTPException(status_code=429, detail="That is a lot of checks in a minute - wait a moment.")
        return _do(lambda: keys.check(user, provider, {"panel": panel, "device": device, "person": person}))

    @r.put("/keys/settings")
    def search_set_settings(body: SearchSettingsPut, request: Request, user: str = Depends(current_user)):
        _may_change(request, user, ACCOUNT)
        return _do(lambda: keys.set_settings(user, body.model_dump()))

    @r.post("/search")
    def search(body: SearchPost, user: str = Depends(current_user)):
        """{q, provider: youtube|spotify|both, panel?, device?, person?} -> {results: [{provider, kind, id, title,
        by, thumbnail, link}], searched, problems: {provider: sentence}}. Each `link` is one the paste path accepts
        as it is. The key used is the nearest one saved for that panel, device, person, else the account's."""
        try:
            clean_query(body.q)
        except Refused as e:
            raise HTTPException(status_code=e.status, detail=e.detail)
        if not search_limit.hit(user):
            raise HTTPException(status_code=429, detail="That is a lot of searches in a minute - wait a moment.")
        ctx = {"panel": body.panel, "device": body.device, "person": body.person}
        return _do(lambda: keys.search(user, body.q, body.provider, ctx))

    return r
