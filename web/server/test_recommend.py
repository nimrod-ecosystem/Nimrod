"""Recommend a song or video - the rules, and the routes under them.

    py -3.13 test_recommend.py

The rules are pure and live in recommend.py: which links are accepted (and which youtube-looking ones are
not), what a provider's oEmbed answer means, and what the recipient sees. Then the HTTP routes through
FastAPI's TestClient against a throwaway database, with a FAKE fetch: nothing here touches the network.
"""
import os
import sys
import tempfile

from recommend import (
    BAD_LINK, MAX_MESSAGE, NOT_FOUND, Refused, build_row, canonical_url, clean_message, describe, fold,
    oembed_endpoint, parse_link, thumb_ok, valid_ref, visible,
)

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t):
    print(f"\n-- {t}")


def refused(link):
    try:
        parse_link(link)
        return None
    except Refused as e:
        return str(e)


VID, VID2 = "dQw4w9WgXcQ", "aBcDeFgHiJk"
PL = "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"
SP = "4uLU6hMCjMI75M1A2tKUQC"

# ---------------------------------------------------------------- good links
section("good links: YouTube and Spotify, normalised to provider + kind + id")
cases = {
    f"https://www.youtube.com/watch?v={VID}": ("youtube", "video", VID),
    f"https://youtube.com/watch?v={VID}&t=42s&si=track": ("youtube", "video", VID),
    f"http://m.youtube.com/watch?v={VID}": ("youtube", "video", VID),
    f"https://music.youtube.com/watch?v={VID}&list={PL}": ("youtube", "video", VID),
    f"https://youtu.be/{VID}?si=abc": ("youtube", "video", VID),
    f"youtu.be/{VID}": ("youtube", "video", VID),
    f"https://www.youtube.com/shorts/{VID}": ("youtube", "video", VID),
    f"https://www.youtube.com/embed/{VID}": ("youtube", "video", VID),
    f"https://www.youtube.com/live/{VID}": ("youtube", "video", VID),
    f"https://www.youtube.com/playlist?list={PL}": ("youtube", "playlist", PL),
    f"  https://WWW.YOUTUBE.COM/watch?v={VID}  ": ("youtube", "video", VID),
    f"https://open.spotify.com/track/{SP}?si=xyz": ("spotify", "song", SP),
    f"https://open.spotify.com/album/{SP}": ("spotify", "album", SP),
    f"https://open.spotify.com/playlist/{SP}": ("spotify", "playlist", SP),
    f"https://open.spotify.com/intl-de/track/{SP}": ("spotify", "song", SP),
    f"https://open.spotify.com/embed/track/{SP}": ("spotify", "song", SP),
    f"open.spotify.com/track/{SP}": ("spotify", "song", SP),
}
for link, want in cases.items():
    got = None
    try:
        r = parse_link(link)
        got = (r["provider"], r["kind"], r["id"])
    except Refused as e:
        got = str(e)
    check(f"{link.strip()[:70]} -> {want[1]}", got == want, str(got))
check("a video watched inside a playlist is that video, not the playlist",
      parse_link(f"https://www.youtube.com/watch?v={VID}&list={PL}")["kind"] == "video")

# ---------------------------------------------------------------- bad and spoofed
section("*** bad links, and youtube-looking links that point somewhere else ***")
spoofs = [
    f"https://youtube.com.evil.example/watch?v={VID}",
    f"https://evilyoutube.com/watch?v={VID}",
    f"https://www.youtube.com@evil.example/watch?v={VID}",
    f"https://user:pw@www.youtube.com/watch?v={VID}",
    f"https://www.youtube.com:8443/watch?v={VID}",
    f"https://youtu.be.evil.example/{VID}",
    f"https://open.spotify.com.evil.example/track/{SP}",
    f"https://spotify.com/track/{SP}",
    f"https://play.spotify.com/track/{SP}",
    f"https://evil.example/?u=https://www.youtube.com/watch?v={VID}",
    f"https://evil.example/www.youtube.com/watch?v={VID}",
    f"https://www.youtube-nocookie.com/embed/{VID}",
    f"javascript:alert('https://www.youtube.com/watch?v={VID}')",
    f"ftp://www.youtube.com/watch?v={VID}",
    f"data:text/html,https://youtu.be/{VID}",
    f"https://www.youtube.com/watch?v={VID} https://evil.example",
    "",
    "just some words",
]
for s in spoofs:
    check(f"refused: {s[:72] or '(empty)'}", refused(s) is not None, "accepted")
check("a refusal says what IS accepted, in plain words", refused("https://evil.example/") == BAD_LINK)
bad_shapes = [
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQextra",
    "https://www.youtube.com/channel/UCxyz",
    "https://www.youtube.com/playlist?list=notaplaylistid",
    "https://youtu.be/",
    f"https://open.spotify.com/artist/{SP}",
    f"https://open.spotify.com/episode/{SP}",
    "https://open.spotify.com/track/tooShort",
    f"https://open.spotify.com/track/{SP}/extra",
]
for s in bad_shapes:
    check(f"refused (not a video/playlist/song/album): {s[:72]}", refused(s) is not None, "accepted")
check("a YouTube link that is not a video says so", "not a video or a playlist" in (refused("https://www.youtube.com/channel/UCxyz") or ""))
check("a Spotify link that is not a song says so", "not a song" in (refused(f"https://open.spotify.com/artist/{SP}") or ""))

section("the address anybody is sent to is REBUILT, never the pasted one")
check("youtube video", canonical_url(parse_link(f"https://youtu.be/{VID}?si=track&t=9")) == f"https://www.youtube.com/watch?v={VID}")
check("youtube playlist", canonical_url(parse_link(f"https://www.youtube.com/playlist?list={PL}&si=x")) == f"https://www.youtube.com/playlist?list={PL}")
check("spotify song", canonical_url(parse_link(f"https://open.spotify.com/intl-fr/track/{SP}?si=tag")) == f"https://open.spotify.com/track/{SP}")
check("the oEmbed endpoints are the providers' own",
      oembed_endpoint(parse_link(f"https://youtu.be/{VID}")).startswith("https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D")
      and oembed_endpoint(parse_link(f"https://open.spotify.com/track/{SP}")).startswith("https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F"))
check("valid_ref matches parse_link's shapes", valid_ref("youtube", "video", VID) and valid_ref("spotify", "album", SP)
      and not valid_ref("youtube", "song", VID) and not valid_ref("spotify", "song", VID) and not valid_ref("vimeo", "video", VID))

# ---------------------------------------------------------------- oEmbed
section("oEmbed through a fake fetch")
asked = []


def fake(status, body=None):
    def f(url):
        asked.append(url)
        return status, body
    return f


yt = parse_link(f"https://youtu.be/{VID}")
spr = parse_link(f"https://open.spotify.com/track/{SP}")
d = describe(yt, fake(200, {"title": "  A   good song ", "thumbnail_url": "https://evil.example/x.jpg"}))
check("*** title from oEmbed, tidied; a video's picture from YouTube's own image host, not the answer's ***",
      d == {"title": "A good song", "thumb": f"https://i.ytimg.com/vi/{VID}/hqdefault.jpg"}, str(d))
check("the fetch was asked for the provider's own endpoint", asked[-1] == oembed_endpoint(yt))
d = describe(spr, fake(200, {"title": "Track", "thumbnail_url": "https://image-cdn-ak.spotifycdn.com/image/ab67"}))
check("spotify: title and its picture (on Spotify's image host)", d == {"title": "Track", "thumb": "https://image-cdn-ak.spotifycdn.com/image/ab67"}, str(d))
d = describe(spr, fake(200, {"title": "Track", "thumbnail_url": "http://i.scdn.co/image/x"}))
check("*** a picture over plain http is dropped ***", d["thumb"] == "", str(d))
d = describe(spr, fake(200, {"title": "Track", "thumbnail_url": "https://i.scdn.co.evil.example/x"}))
check("*** a picture on a look-alike host is dropped ***", d["thumb"] == "", str(d))
for st, words in ((404, NOT_FOUND), (400, NOT_FOUND)):
    try:
        describe(yt, fake(st))
        check(f"{st} refused", False, "kept")
    except Refused as e:
        check(f"*** {st}: refused - '{e}' ***", str(e) == words)
for st in (401, 403):
    try:
        describe(spr, fake(st))
        check(f"{st} refused", False, "kept")
    except Refused as e:
        check(f"*** {st}: refused as private / not playable elsewhere ***", "private" in str(e) and "Spotify" in str(e), str(e))
d = describe(spr, fake(503))
check("*** 503: KEPT with no title (a provider's bad minute does not stop a song being sent) ***", d == {"title": "", "thumb": ""}, str(d))


def boom(url):
    raise OSError("offline")


check("a fetch that throws: kept, untitled", describe(spr, boom) == {"title": "", "thumb": ""})
check("a YouTube video offline still has its picture", describe(yt, boom)["thumb"].startswith("https://i.ytimg.com/vi/"))
check("a long title is cut to 200", len(describe(spr, fake(200, {"title": "x" * 500}))["title"]) == 200)

section("messages, rows and what the recipient sees")
check("a message is tidied", clean_message("  hi\r\nthere ") == "hi\nthere")
try:
    clean_message("x" * (MAX_MESSAGE + 1))
    check("too long refused", False)
except Refused:
    check(f"*** a message over {MAX_MESSAGE} is refused, not cut ***", True)
row = build_row(yt, {"title": "T", "thumb": "https://evil.example/x"}, message="m", from_name="", from_person=None)
check("a row: provider, kind, id, title, message, 'Someone' when no name; a bad picture dropped",
      row["provider"] == "youtube" and row["id"] == VID and row["from_name"] == "Someone" and row["thumb"] == "", str(row))
ev = [
    {"id": 1, "kind": "recommend", "created_at": "t1", "data": build_row(yt, {"title": "One"}, message="", from_name="Pat", from_person=None)},
    {"id": 2, "kind": "recommend", "created_at": "t2", "data": build_row(spr, {"title": "Two"}, message="for you", from_name="Sam", from_person=None)},
    {"id": 3, "kind": "recommend", "created_at": "t3", "data": {"provider": "youtube", "kind": "video", "id": "<script>"}},
    {"id": 4, "kind": "recommend", "created_at": "t4", "data": {**build_row(yt, {"title": "Four"}, message="", from_name="Lee", from_person=None), "thumb": "https://evil.example/x"}},
    {"id": 5, "kind": "seen", "created_at": "t5", "data": {"of": 2}},
    {"id": 6, "kind": "dismissed", "created_at": "t6", "data": {"of": 1}},
    {"id": 7, "kind": "seen", "created_at": "t7", "data": {"of": True}},
]
f = fold(ev)
check("*** newest first, the dismissed one gone, a forged row with a bad id dropped ***", [x["id"] for x in f] == [4, 2], str([x["id"] for x in f]))
check("*** a forged picture is dropped on the way OUT too ***", f[0]["thumb"] == "")
check("seen is carried", f[1]["seen"] is True and f[0]["seen"] is False)
check("each carries the rebuilt address and who sent it, and no account", f[1]["url"] == f"https://open.spotify.com/track/{SP}"
      and f[1]["from_name"] == "Sam" and f[1]["message"] == "for you" and "principal_id" not in repr(f))
check("limit", [x["id"] for x in fold(ev, 1)] == [4] and fold(ev, 0) == [])
check("visible() refuses a non-row", visible(1, "t", None) is None and visible(1, "t", {"provider": "x"}) is None)
check("thumb_ok", thumb_ok("https://i.ytimg.com/vi/x/hq.jpg") and thumb_ok("https://mosaic.scdn.co/640/x")
      and not thumb_ok("https://ytimg.com.evil.example/x") and not thumb_ok("javascript:x") and not thumb_ok(None))

# ================================================================ the routes
section("*** the routes, against a throwaway database, with a fake fetch ***")
tmp = tempfile.mkdtemp(prefix="nimrod_rec_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "rec_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

fetched = []


def route_fetch(url):
    fetched.append(url)
    if "404404404" in url or "NotThere" in url:
        return 404, None
    return 200, {"title": "Fake title", "thumbnail_url": "https://i.scdn.co/image/abc"}


appmod._rec_fetch = route_fetch
c = TestClient(appmod.app)


def H(u):
    return {"X-Dev-User": u}


OWN, VIS, STR = "rown-a", "rvis-b", "rstr-c"
person = c.get("/api/people", headers=H(OWN)).json()["people"][0]["id"]
vis_person = c.get("/api/people", headers=H(VIS)).json()["people"][0]["id"]
c.patch(f"/api/people/{vis_person}", json={"name": "Aunt Dolly"}, headers=H(VIS))
str_person = c.get("/api/people", headers=H(STR)).json()["people"][0]["id"]
url = f"/api/people/{person}/recommendations"
link = f"https://youtu.be/{VID}?si=x"

r = c.post(url, json={"link": link}, headers=H(VIS))
check("*** no grant, no tick: refused (403) ***", r.status_code == 403, r.text)
c.post(f"/api/people/{person}/drive-grants", json={"subject_id": VIS}, headers=H(OWN))
r = c.post(url, json={"link": link}, headers=H(VIS))
check("*** a drive grant but NOT ticked for notes: still refused - the note's own rule ***", r.status_code == 403, r.text)
c.put(f"/api/people/{person}/state/input-bindings", json={"data": {"noteWriters": [VIS]}, "base_version": 0}, headers=H(OWN))
n_before = len(fetched)
r = c.post(url, json={"link": link, "message": "  This one made me think of you ", "from_person": vis_person}, headers=H(VIS))
row = r.json() if r.status_code == 200 else {}
check("*** granted AND ticked: sent ***", r.status_code == 200, r.text)
check("stored as provider + kind + id with the provider's title, and the rebuilt address",
      row.get("provider") == "youtube" and row.get("kind") == "video" and row.get("item_id") == VID
      and row.get("title") == "Fake title" and row.get("url") == f"https://www.youtube.com/watch?v={VID}", str(row))
check("*** from: the sender's own person's name ***", row.get("from_name") == "Aunt Dolly", str(row))
check("the message, tidied", row.get("message") == "This one made me think of you")
check("the sender's copy carries no account id", "principal_id" not in row and VIS not in repr(row))
check("the provider was asked once", len(fetched) == n_before + 1 and "youtube.com/oembed" in fetched[-1])
r = c.post(url, json={"link": link, "from_person": person}, headers=H(VIS))
check("*** naming somebody ELSE's person as 'from' is ignored: the account's display name, else Someone ***",
      r.status_code == 200 and r.json()["from_name"] == "Someone", r.text)

section("what the route refuses")
for bad in (f"https://youtube.com.evil.example/watch?v={VID}", "https://evil.example/", f"https://open.spotify.com/artist/{SP}"):
    n = len(fetched)
    r = c.post(url, json={"link": bad}, headers=H(VIS))
    check(f"400 for {bad[:60]}, and the provider is never asked", r.status_code == 400 and len(fetched) == n and r.json().get("detail"), r.text)
r = c.post(url, json={"link": f"https://open.spotify.com/track/NotThereNotThereNotThe"}, headers=H(VIS))
check("*** oEmbed says no such thing: 400, nothing stored ***", r.status_code == 400 and "Could not find" in r.json()["detail"], r.text)
check("a message that is too long is refused", c.post(url, json={"link": link, "message": "x" * (MAX_MESSAGE + 1)}, headers=H(VIS)).status_code == 400)
r1 = c.post(url, json={"link": link}, headers=H(STR))
r2 = c.post("/api/people/doesnotexist123/recommendations", json={"link": link}, headers=H(STR))
check("*** a stranger is refused, and a person that does not exist looks the same (no id oracle) ***",
      r1.status_code == 403 and r2.status_code == 403 and r1.json() == r2.json(), f"{r1.text} {r2.text}")

section("*** the recipient's list ***")
c.post(url, json={"link": f"https://open.spotify.com/track/{SP}", "message": "dance"}, headers=H(OWN))
r = c.get(url, headers=H(OWN))
lst = r.json().get("recommendations", []) if r.status_code == 200 else []
check("*** the owner (the person's own page) reads them, newest first ***",
      r.status_code == 200 and [x["provider"] for x in lst] == ["spotify", "youtube", "youtube"], r.text)
check("the owner's own is signed by the owner's person's name rule (no name set: Someone)", lst[0]["from_name"] == "Someone")
check("none seen yet", not any(x["seen"] for x in lst))
check("the list has no account ids", VIS not in repr(lst) and OWN not in repr(lst))
check("*** a sender cannot read the recipient's list ***", c.get(url, headers=H(VIS)).status_code == 404)
check("a stranger cannot either", c.get(url, headers=H(STR)).status_code == 404)
own_log = c.get(f"/api/people/{person}/events/recommended", headers=H(OWN)).json()["events"]
check("*** the owner's log knows which account sent each one ***",
      [e["principal_id"] for e in own_log if e["kind"] == "recommend"] == [VIS, VIS, OWN], str([e["principal_id"] for e in own_log]))

section("seen and dismiss")
first = lst[-1]["id"]
r = c.post(f"{url}/{first}/seen", headers=H(OWN))
check("mark seen", r.status_code == 200 and next(x for x in c.get(url, headers=H(OWN)).json()["recommendations"] if x["id"] == first)["seen"])
r = c.post(f"{url}/{first}/dismissed", headers=H(OWN))
after = c.get(url, headers=H(OWN)).json()["recommendations"]
check("*** dismissed: gone from the list ***", r.status_code == 200 and first not in [x["id"] for x in after] and len(after) == 2, str(after))
check("*** nothing deleted: the stream only grew ***",
      len(c.get(f"/api/people/{person}/events/recommended", headers=H(OWN)).json()["events"]) == len(own_log) + 2)
check("*** a sender cannot dismiss ***", c.post(f"{url}/{after[0]['id']}/dismissed", headers=H(VIS)).status_code == 404)
check("another mark is refused", c.post(f"{url}/{after[0]['id']}/deleted", headers=H(OWN)).status_code == 400)
check("a row that is not a recommendation cannot be marked", c.post(f"{url}/999999/seen", headers=H(OWN)).status_code == 404)

section("preview")
r = c.post("/api/recommend/preview", json={"link": f"https://open.spotify.com/intl-de/album/{SP}?si=1"}, headers=H(VIS))
check("*** preview: what the link is, its title and picture, before Send ***",
      r.status_code == 200 and r.json()["kind"] == "album" and r.json()["title"] == "Fake title"
      and r.json()["url"] == f"https://open.spotify.com/album/{SP}" and r.json()["thumb"] == "https://i.scdn.co/image/abc", r.text)
check("preview refuses a bad link with words", c.post("/api/recommend/preview", json={"link": "https://evil.example"}, headers=H(VIS)).status_code == 400)

section("rate limit")
appmod._rec_limit.reset()
codes = [c.post(url, json={"link": link}, headers=H(VIS)).status_code for _ in range(appmod._rec_limit.limit + 1)]
check(f"*** {appmod._rec_limit.limit} in the window are fine, the next is a 429 ***",
      codes[:-1] == [200] * appmod._rec_limit.limit and codes[-1] == 429, str(codes))
n = len(fetched)
c.post(url, json={"link": link}, headers=H(VIS))
check("a refused send never asks the provider", len(fetched) == n)
appmod._rec_limit.reset()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
