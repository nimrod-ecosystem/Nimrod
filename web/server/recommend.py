"""recommend.py - RECOMMEND A SONG OR VIDEO TO ONE OF YOUR PEOPLE.

Mike, 2026-10-04, about Your people's dimmed "Share a song / video" buttons: "I was picturing more like
recommending a youtube or spotify song/video." DECISIONS.md 2026-10-04 item 7: *"Share" means recommending
a YouTube or Spotify song or video, not sending files.*

So a recommendation is a POINTER, never a file: a provider (youtube | spotify), a kind (video, playlist,
song, album) and the provider's own id, plus the title and picture the provider says it has, an optional
short message, and who sent it. Nothing is downloaded or copied; playing it is the provider's job.

This file is the rules, pure and tested alone (test_recommend.py), the same shape as notes.py:

  parse_link   WHICH LINKS ARE ACCEPTED. Only youtube.com (www., m., music.), youtu.be and
               open.spotify.com, over http(s), with no user name, password or port in the address. The
               host is compared EXACTLY, never by "ends with" or "contains": `youtube.com.evil.example`,
               `evilyoutube.com` and `youtube.com@evil.example` are three different ways of pointing a
               youtube-looking link somewhere else, and all three are refused. What is kept is NOT the
               pasted address but (provider, kind, id), each id checked against the provider's own shape;
               the address anybody is ever sent to is rebuilt from those (`canonical_url`). So whatever
               else was in the pasted link (tracking tags, a start time, a redirect) never reaches the
               person it was sent to.

  describe     THE TITLE AND PICTURE, from the provider's public oEmbed endpoint (both offer one, no key
               needed). The fetch is injected, so the tests use a fake one and never touch the network.
               ARGUED, what a failure does:
                 400 / 404  the provider says there is no such thing -> REFUSED ("could not find that").
                 401 / 403  it exists but is private, or may not be shown outside the provider -> REFUSED:
                            the person it was sent to could not play it either.
                 anything else (offline, slow, 5xx, a rate limit)  -> KEPT, with no title. The link was
                            already checked; the title is a convenience, and a provider having a bad minute
                            should not stop somebody sending a song. The page then says "a YouTube video".
               The picture is kept only if it is https on the provider's own image hosts (THUMB_HOSTS),
               re-checked when it is read back, because the page draws it.

  fold         WHAT THE RECIPIENT SEES, from an append-only stream on the person (like the note: nothing is
               ever deleted). `recommend` rows are the recommendations; `seen` and `dismissed` rows point at
               one by id. The newest first, dismissed ones left out, every row re-checked on the way out
               (the owner can write any row to their own person's stream through the generic event route,
               so a row is never trusted just because it is in the stream).

WHO MAY SEND: exactly who may leave a note (notes.may_leave_note): the person's owner, or an account with a
live drive grant on them that the owner has ticked on the note list. Mike's ask: the same permission as
leaving a note. One list, so "who can reach her with words" and "who can reach her with a song" never drift
apart; a separate tick is a choice for later if anybody asks for it.

WHO WROTE IT IS THE SERVER'S ANSWER: `from_name` is the sending person's name (one of the sender's own people,
checked), else the account's display name, else "Someone"; the account itself is stamped in the row's
`principal_id`, which the owner reads and a sender never does.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

PROVIDERS = ("youtube", "spotify")
KINDS = {"youtube": ("video", "playlist"), "spotify": ("song", "album", "playlist")}

STREAM = "recommended"
REC_KIND = "recommend"
SEEN_KIND = "seen"
DISMISSED_KIND = "dismissed"
MARKS = {"seen": SEEN_KIND, "dismissed": DISMISSED_KIND}

# The note's own limit (notes.MAX_TEXT), on purpose: a message with a song is the same kind of line as a note,
# and nobody should have to learn two limits for "a few words to somebody". Refused rather than cut, same reason.
MAX_MESSAGE = 280
# A title is the provider's, not the sender's, but it is drawn on somebody's page: cut, not refused (the
# sender did not write it). 200 is longer than any real song or video title and still two lines on a phone.
MAX_TITLE = 200
SOMEONE = "Someone"

YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"})
YOUTU_BE = "youtu.be"
SPOTIFY_HOST = "open.spotify.com"

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# The client's own rule (youtube.js parsePlaylistId): a playlist id carries one of YouTube's playlist prefixes.
PLAYLIST_ID_RE = re.compile(r"^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{8,62}$")
SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
SPOTIFY_KIND = {"track": "song", "album": "album", "playlist": "playlist"}
SPOTIFY_PATH = {v: k for k, v in SPOTIFY_KIND.items()}

# Where a picture may come from: YouTube's and Spotify's own image hosts. Exact host, or a subdomain of one of
# these, over https - checked on the way in and again on the way out.
THUMB_HOSTS = ("ytimg.com", "scdn.co", "spotifycdn.com")

# The words a refusal says. Plain, and about what the sender can do.
BAD_LINK = "Paste a link from YouTube (youtube.com or youtu.be) or Spotify (open.spotify.com)."
BAD_KIND = {
    "youtube": "That YouTube link is not a video or a playlist.",
    "spotify": "That Spotify link is not a song, an album or a playlist.",
}
NOT_FOUND = "Could not find that. Check the link and try again."
PRIVATE = "That one is private, or cannot be played outside {name}, so they could not play it either."
PROVIDER_NAME = {"youtube": "YouTube", "spotify": "Spotify"}


class Refused(ValueError):
    """A link, or a provider's answer about it, that will not be stored. str() is the plain-words reason."""


def _host_of(raw: str):
    """(scheme, host, parts) for an http(s) address with no user info or port; else None."""
    s = str(raw or "").strip()
    if not s or len(s) > 2000 or any(c.isspace() for c in s):
        return None
    if "://" not in s:
        # "youtu.be/abc" or "open.spotify.com/track/..." pasted without the scheme: the same address.
        s = "https://" + s
    try:
        parts = urlsplit(s)
        port = parts.port      # raises on a port that is not a number
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https"):
        return None
    if parts.username is not None or parts.password is not None or "@" in parts.netloc or port is not None:
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    return host, parts


def parse_link(raw: str) -> dict:
    """A pasted link -> {"provider", "kind", "id"}. PURE. Raises Refused with the words to show."""
    got = _host_of(raw)
    if not got:
        raise Refused(BAD_LINK)
    host, parts = got
    path = parts.path or "/"
    q = parse_qs(parts.query or "")

    def first(key):
        v = q.get(key) or []
        return v[0] if v else ""

    if host == YOUTU_BE:
        vid = path.strip("/").split("/")[0]
        if VIDEO_ID_RE.match(vid):
            return {"provider": "youtube", "kind": "video", "id": vid}
        raise Refused(BAD_KIND["youtube"])
    if host in YOUTUBE_HOSTS:
        v = first("v")
        if path.rstrip("/") == "/watch" and VIDEO_ID_RE.match(v):
            # A video watched from inside a playlist is still that video: the one they were listening to.
            return {"provider": "youtube", "kind": "video", "id": v}
        m = re.match(r"^/(?:shorts|embed|live|v)/([A-Za-z0-9_-]{11})/?$", path)
        if m:
            return {"provider": "youtube", "kind": "video", "id": m.group(1)}
        lst = first("list")
        if path.rstrip("/") in ("/playlist", "/watch") and PLAYLIST_ID_RE.match(lst):
            return {"provider": "youtube", "kind": "playlist", "id": lst}
        raise Refused(BAD_KIND["youtube"])
    if host == SPOTIFY_HOST:
        segs = [s for s in path.split("/") if s]
        if segs and re.match(r"^intl-[a-z]{2}(-[a-z]{2})?$", segs[0], re.I):
            segs = segs[1:]
        if segs and segs[0] == "embed":
            segs = segs[1:]
        if len(segs) == 2 and segs[0] in SPOTIFY_KIND and SPOTIFY_ID_RE.match(segs[1]):
            return {"provider": "spotify", "kind": SPOTIFY_KIND[segs[0]], "id": segs[1]}
        raise Refused(BAD_KIND["spotify"])
    raise Refused(BAD_LINK)


def valid_ref(provider, kind, item_id) -> bool:
    """Is (provider, kind, id) one this file would have produced? PURE."""
    if provider not in PROVIDERS or kind not in KINDS.get(provider, ()):
        return False
    s = str(item_id or "")
    if provider == "youtube":
        return bool(VIDEO_ID_RE.match(s) if kind == "video" else PLAYLIST_ID_RE.match(s))
    return bool(SPOTIFY_ID_RE.match(s))


def canonical_url(ref: dict) -> str:
    """The address rebuilt from (provider, kind, id): the only address anybody is ever sent to."""
    p, k, i = ref["provider"], ref["kind"], ref["id"]
    if p == "youtube":
        return f"https://www.youtube.com/watch?v={i}" if k == "video" else f"https://www.youtube.com/playlist?list={i}"
    return f"https://open.spotify.com/{SPOTIFY_PATH[k]}/{i}"


def oembed_endpoint(ref: dict) -> str:
    from urllib.parse import quote
    u = quote(canonical_url(ref), safe="")
    if ref["provider"] == "youtube":
        return f"https://www.youtube.com/oembed?format=json&url={u}"
    return f"https://open.spotify.com/oembed?url={u}"


def thumb_ok(url) -> bool:
    """https, on YouTube's or Spotify's own image hosts. PURE."""
    got = _host_of(url) if isinstance(url, str) and url.lower().startswith("https://") else None
    if not got:
        return False
    host = got[0]
    return any(host == h or host.endswith("." + h) for h in THUMB_HOSTS)


def _clean_title(t) -> str:
    s = re.sub(r"\s+", " ", str(t or "")).strip()
    return s[:MAX_TITLE]


def describe(ref: dict, fetch) -> dict:
    """{"title", "thumb"} for a parsed link. `fetch(url) -> (status, json_or_None)`. Raises Refused on a
    provider's "no such thing" or "private" (see the header for why each answer does what it does)."""
    status, body = 0, None
    try:
        status, body = fetch(oembed_endpoint(ref))
    except Exception:  # noqa: BLE001 - a fetch that throws is "the provider is having a bad minute"
        status, body = 0, None
    if status in (400, 404):
        raise Refused(NOT_FOUND)
    if status in (401, 403):
        raise Refused(PRIVATE.format(name=PROVIDER_NAME[ref["provider"]]))
    title, thumb = "", ""
    if status == 200 and isinstance(body, dict):
        title = _clean_title(body.get("title"))
        t = body.get("thumbnail_url")
        thumb = t if thumb_ok(t) else ""
    if ref["provider"] == "youtube" and ref["kind"] == "video":
        # A video's picture is at a fixed address on YouTube's image host: no need to trust anybody's answer.
        thumb = f"https://i.ytimg.com/vi/{ref['id']}/hqdefault.jpg"
    return {"title": title, "thumb": thumb}


def clean_message(raw) -> str:
    s = str(raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(s) > MAX_MESSAGE:
        raise Refused(f"A message is at most {MAX_MESSAGE} characters.")
    return s


def build_row(ref: dict, about: dict, *, message: str, from_name: str, from_person: str | None) -> dict:
    """The `data` stored for one recommendation. PURE. Who it is FOR is the stream's person; when is the row's."""
    return {
        "provider": ref["provider"], "kind": ref["kind"], "id": ref["id"],
        "title": _clean_title(about.get("title")), "thumb": about.get("thumb") if thumb_ok(about.get("thumb")) else "",
        "message": message, "from_name": (str(from_name or "").strip() or SOMEONE)[:40],
        "from_person": from_person or None,
    }


def visible(row_id, created_at, d: dict, *, seen: bool = False) -> dict | None:
    """One recommendation as a page shows it, re-checked; None if the row is not one. No account ids."""
    if not isinstance(d, dict) or not valid_ref(d.get("provider"), d.get("kind"), d.get("id")):
        return None
    msg = str(d.get("message") or "")[:MAX_MESSAGE]
    return {
        "id": row_id, "at": created_at, "provider": d["provider"], "kind": d["kind"], "item_id": d["id"],
        "title": _clean_title(d.get("title")), "thumb": d.get("thumb") if thumb_ok(d.get("thumb")) else "",
        "message": msg, "from_name": (str(d.get("from_name") or "").strip() or SOMEONE)[:40],
        "url": canonical_url({"provider": d["provider"], "kind": d["kind"], "id": d["id"]}), "seen": bool(seen),
    }


def fold(events: list[dict], limit: int = 20) -> list[dict]:
    """The stream (oldest first, as db.list_events gives it) -> the live recommendations, newest first. PURE."""
    seen, gone = set(), set()
    for e in events or []:
        d = e.get("data") if isinstance(e.get("data"), dict) else {}
        of = d.get("of")
        if not isinstance(of, int) or isinstance(of, bool):
            continue
        if e.get("kind") == SEEN_KIND:
            seen.add(of)
        elif e.get("kind") == DISMISSED_KIND:
            gone.add(of)
    out = []
    for e in reversed(events or []):
        if len(out) >= max(0, limit):
            break
        if e.get("kind") != REC_KIND or e.get("id") in gone:
            continue
        v = visible(e.get("id"), e.get("created_at"), e.get("data"), seen=e.get("id") in seen)
        if v:
            out.append(v)
    return out


def http_fetch(url: str, *, timeout: float = 4.0):
    """The real fetch: GET, JSON, no redirects followed. (status, json_or_None). Only ever called with an
    address from `oembed_endpoint`, which is always one of the two providers' own oEmbed endpoints.

    4 SECONDS: a provider answering slower than that is having the bad minute `describe` already plans for
    (the recommendation is kept, untitled); somebody pressing Send should not wait longer for a title."""
    import httpx
    try:
        r = httpx.get(url, timeout=timeout, follow_redirects=False,
                      headers={"Accept": "application/json", "User-Agent": "nimrod-recommend/1"})
    except httpx.HTTPError:
        return 0, None
    try:
        return r.status_code, (r.json() if r.status_code == 200 else None)
    except ValueError:
        return r.status_code, None
