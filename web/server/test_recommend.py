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

# ================================================================ search by name (recommend_search.py)
import json  # noqa: E402
import recommend_search as S  # noqa: E402

section("search by name: the pure rules")
YT_KEY = "AIza" + "FakeKeyForTestsOnly_0123456789abcd"      # 39 characters, made up
SP_ID, SP_SECRET = "0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"   # made up
check("a YouTube key: whitespace stripped, shape checked", S.clean_youtube_key(f"  {YT_KEY}\n") == YT_KEY)
for bad in ("", "short", "has.dots/and:colons-but-is-long-enough-to-pass", "x" * 65, "AIza<script>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"):
    try:
        S.clean_youtube_key(bad)
        check(f"refused youtube key {bad[:20]!r}", False, "accepted")
    except ValueError as e:
        check(f"refused youtube key {bad[:20]!r}, in words", bool(str(e)))
check("Spotify id + secret", S.clean_spotify(f" {SP_ID} ", SP_SECRET) == (SP_ID, SP_SECRET))
for i, s in (("", SP_SECRET), (SP_ID, ""), ("nothex" * 6, SP_SECRET), (SP_ID, SP_ID)):
    try:
        S.clean_spotify(i, s)
        check("refused spotify pair", False, "accepted")
    except ValueError as e:
        check(f"refused spotify pair: {e}", True)
try:
    S.clean_query(" a ")
    check("one letter refused", False)
except S.Refused as e:
    check("*** one letter is not a search (it would still cost a YouTube search) ***", e.status == 400)
check("a long query is cut to 100", len(S.clean_query("x" * 300)) == 100)
check("which: both -> the saved ones only", S.which("both", {"spotify"}) == ["spotify"] and S.which("both", {"youtube", "spotify"}) == ["youtube", "spotify"])
for raw, have in (("youtube", {"spotify"}), ("both", set()), ("vimeo", {"youtube"})):
    try:
        S.which(raw, have)
        check(f"which({raw}) refused", False)
    except S.Refused:
        check(f"which({raw}, {sorted(have)}) refused", True)

yt_body = {"items": [
    {"id": {"kind": "youtube#video", "videoId": VID}, "snippet": {"title": "Don&#39;t Stop &amp; Go", "channelTitle": "Band&amp;Co",
                                                                  "thumbnails": {"medium": {"url": "https://evil.example/x.jpg"}}}},
    {"id": {"videoId": "<script>alert</script>"}, "snippet": {"title": "forged"}},
    {"id": {"videoId": VID}, "snippet": {"title": "duplicate"}},
    {"id": {"videoId": VID2}, "snippet": {"title": "Two", "channelTitle": "C2"}},
    "not a dict",
]}
yr = S.youtube_results(yt_body)
check("*** YouTube rows: forged id dropped, duplicate dropped, titles unescaped ***",
      [r["id"] for r in yr] == [VID, VID2] and yr[0]["title"] == "Don't Stop & Go" and yr[0]["by"] == "Band&Co", json.dumps(yr)[:300])
check("*** each row carries the SAME link the paste path accepts, and parse_link gives back the same ref ***",
      all(parse_link(r["link"]) == {"provider": r["provider"], "kind": r["kind"], "id": r["id"]} for r in yr)
      and yr[0]["link"] == f"https://www.youtube.com/watch?v={VID}")
check("the picture is YouTube's own address for the id, never the answer's", yr[0]["thumbnail"] == f"https://i.ytimg.com/vi/{VID}/mqdefault.jpg")
check("at most 8", len(S.youtube_results({"items": [{"id": {"videoId": f"abcdefghi{n:02d}"}, "snippet": {}} for n in range(20)]})) == 8)
check("nonsense answers give no rows", S.youtube_results(None) == [] and S.youtube_results({"items": "x"}) == [] and S.spotify_results([]) == [])
sp_body = {"tracks": {"items": [
    {"id": SP, "name": "Blue Moon", "artists": [{"name": "Ella"}, {"name": "Louis"}],
     "album": {"images": [{"url": "https://i.scdn.co/image/640", "width": 640}, {"url": "https://i.scdn.co/image/300", "width": 300},
                          {"url": "https://i.scdn.co/image/64", "width": 64}]}},
    {"id": "tooShort", "name": "forged"},
    {"id": "5uLU6hMCjMI75M1A2tKUQC", "name": "Elsewhere", "artists": [], "album": {"images": [{"url": "https://evil.example/x.jpg", "width": 300}]}},
]}}
sr = S.spotify_results(sp_body)
check("*** Spotify rows: a track is a 'song', artists joined, the 300 picture, forged id dropped ***",
      [r["id"] for r in sr] == [SP, "5uLU6hMCjMI75M1A2tKUQC"] and sr[0]["kind"] == "song" and sr[0]["by"] == "Ella, Louis"
      and sr[0]["thumbnail"] == "https://i.scdn.co/image/300" and sr[0]["link"] == f"https://open.spotify.com/track/{SP}", json.dumps(sr)[:300])
check("*** a picture off Spotify's own hosts is not drawn ***", sr[1]["thumbnail"] == "")
check("YouTube errors in words: used up / not enabled / restricted / bad key / offline",
      S.youtube_error(403, {"error": {"errors": [{"reason": "quotaExceeded"}]}}) == S.YT_USED_UP
      and S.youtube_error(403, {"error": {"errors": [{"reason": "accessNotConfigured"}]}}) == S.YT_NOT_ENABLED
      and S.youtube_error(403, {"error": {"message": "Requests from referer <empty> are blocked."}}) == S.YT_RESTRICTED
      and S.youtube_error(400, {"error": {"errors": [{"reason": "badRequest"}], "message": "API key not valid."}}) == S.YT_BAD_KEY
      and "reach" in S.youtube_error(0, None) and "trouble" in S.youtube_error(503, None))
check("Spotify errors in words", S.spotify_error(400, {"error": "invalid_client"}) == S.SP_BAD_KEY and "minute" in S.spotify_error(429, None)
      and "reach" in S.spotify_error(0, None))
check("the filter defaults to strict; a bad stored value reads as strict", S.clean_settings(None) == {"safe_search": "strict"}
      and S.clean_settings({"safe_search": "wild"}) == {"safe_search": "strict"})

section("*** search by name: the routes, with a fake transport (no network) ***")
CALLS = []
SCRIPT = {}       # url -> list of (status, body) answered in order; empty -> the default


def fake_http(method, url, *, params=None, data=None, headers=None, timeout=None):
    CALLS.append({"method": method, "url": url, "params": dict(params or {}), "data": dict(data or {}), "headers": dict(headers or {})})
    q = SCRIPT.get(url)
    if q:
        return q.pop(0)
    if url == S.YT_SEARCH:
        return 200, yt_body
    if url == S.YT_VIDEOS:
        return 200, {"items": [{"id": S.CHECK_VIDEO}]}
    if url == S.SP_TOKEN:
        return 200, {"access_token": "pass-1", "token_type": "Bearer", "expires_in": 3600}
    if url == S.SP_SEARCH:
        return 200, sp_body
    return 599, None


S.keys.http = fake_http
S.search_limit.reset()
S.check_limit.reset()
K = "/api/recommend/keys"
SR = "/api/recommend/search"
SK_A, SK_B = "srch-a", "srch-b"
st = c.get(K, headers=H(SK_A)).json()
check("before: nothing saved, it can store, the filter is strict", st["any"] is False and st["youtube"]["set"] is False
      and st["spotify"]["set"] is False and st["can_store"] is True and st["safe_search"] == "strict", str(st))
r = c.post(SR, json={"q": "blue moon"}, headers=H(SK_A))
check("*** no keys: search is a 404 in words, and nothing is asked of YouTube or Spotify ***",
      r.status_code == 404 and "key" in r.json()["detail"] and CALLS == [], r.text)
r = c.put(f"{K}/youtube", json={"key": "nope"}, headers=H(SK_A))
check("a key of the wrong shape: 400 in words", r.status_code == 400 and "YouTube key" in r.json()["detail"], r.text)
r = c.put(f"{K}/youtube", json={"key": YT_KEY}, headers=H(SK_A))
check("*** saved: the answer says so with the last four, and NEVER the key ***",
      r.status_code == 200 and r.json()["youtube"] == {**r.json()["youtube"], "set": True, "last4": YT_KEY[-4:]} and YT_KEY not in r.text, r.text)
row = appmod.store.get_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["youtube"])["data"]
check("*** stored encrypted: the row does not hold the key in the clear ***", YT_KEY not in json.dumps(row) and row.get("sealed"))
check("the status never carries it either", YT_KEY not in c.get(K, headers=H(SK_A)).text)
CALLS.clear()
r = c.post(SR, json={"q": "  don't stop  ", "provider": "both"}, headers=H(SK_A))
j = r.json()
check("*** a YouTube key only: 'both' searches YouTube, and the rows come back ***",
      r.status_code == 200 and j["searched"] == ["youtube"] and [x["id"] for x in j["results"]] == [VID, VID2] and j["problems"] == {}, r.text)
yc = CALLS[0] if CALLS else {}
check("*** the key goes in the X-goog-api-key header, never in the address or its query ***",
      yc.get("headers", {}).get("X-goog-api-key") == YT_KEY and YT_KEY not in yc.get("url", "") and YT_KEY not in json.dumps(yc.get("params")), str(yc)[:300])
check("*** safeSearch=strict by default, type=video, 8 results, the words tidied ***",
      yc["params"].get("safeSearch") == "strict" and yc["params"].get("type") == "video" and yc["params"].get("maxResults") == "8"
      and yc["params"].get("q") == "don't stop", str(yc["params"]))
check("one call for one provider", len(CALLS) == 1)
r = c.put(f"{K}/settings", json={"safe_search": "moderate"}, headers=H(SK_A))
check("the filter can be turned down by the owner", r.status_code == 200 and r.json()["safe_search"] == "moderate")
CALLS.clear()
c.post(SR, json={"q": "blue moon", "provider": "youtube"}, headers=H(SK_A))
check("...and the next search uses it", CALLS and CALLS[0]["params"].get("safeSearch") == "moderate")
check("a filter that is not offered: 400", c.put(f"{K}/settings", json={"safe_search": "wild"}, headers=H(SK_A)).status_code == 400)
c.put(f"{K}/settings", json={"safe_search": "strict"}, headers=H(SK_A))

r = c.put(f"{K}/spotify", json={"client_id": SP_ID, "client_secret": "short"}, headers=H(SK_A))
check("a Spotify secret of the wrong shape: 400", r.status_code == 400, r.text)
r = c.put(f"{K}/spotify", json={"client_id": SP_ID, "client_secret": SP_SECRET}, headers=H(SK_A))
check("*** Spotify saved: last four of the CLIENT ID, nothing of the secret ***",
      r.status_code == 200 and r.json()["spotify"]["last4"] == SP_ID[-4:] and SP_SECRET not in r.text and SP_ID not in r.text, r.text)
check("the Spotify row holds neither in the clear", SP_SECRET not in json.dumps(appmod.store.get_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["spotify"])["data"]))
CALLS.clear()
r = c.post(SR, json={"q": "blue moon", "provider": "both"}, headers=H(SK_A))
j = r.json()
check("*** both keys, 'both': YouTube rows then Spotify rows ***", r.status_code == 200 and j["searched"] == ["youtube", "spotify"]
      and [x["provider"] for x in j["results"]] == ["youtube", "youtube", "spotify", "spotify"], r.text)
tok = [x for x in CALLS if x["url"] == S.SP_TOKEN]
spc = [x for x in CALLS if x["url"] == S.SP_SEARCH]
import base64 as _b64  # noqa: E402
check("*** Spotify: client credentials, id and secret in the Basic header only ***",
      len(tok) == 1 and tok[0]["method"] == "POST" and tok[0]["data"] == {"grant_type": "client_credentials"}
      and tok[0]["headers"].get("Authorization") == "Basic " + _b64.b64encode(f"{SP_ID}:{SP_SECRET}".encode()).decode(), str(tok)[:300])
check("...and the search carries the pass, type=track, limit 8", spc and spc[0]["headers"].get("Authorization") == "Bearer pass-1"
      and spc[0]["params"].get("type") == "track" and spc[0]["params"].get("limit") == "8")
CALLS.clear()
c.post(SR, json={"q": "another", "provider": "spotify"}, headers=H(SK_A))
check("*** the pass is kept in memory until it runs out: no second pass request ***",
      [x["url"] for x in CALLS] == [S.SP_SEARCH], str([x["url"] for x in CALLS]))
SCRIPT[S.SP_SEARCH] = [(401, {"error": {"status": 401, "message": "The access token expired"}})]
SCRIPT[S.SP_TOKEN] = [(200, {"access_token": "pass-2", "expires_in": 3600})]
CALLS.clear()
r = c.post(SR, json={"q": "another", "provider": "spotify"}, headers=H(SK_A))
check("*** a pass Spotify says ran out: one fresh pass, the search again, the rows ***",
      r.status_code == 200 and [x["url"] for x in CALLS] == [S.SP_SEARCH, S.SP_TOKEN, S.SP_SEARCH]
      and CALLS[-1]["headers"]["Authorization"] == "Bearer pass-2" and len(r.json()["results"]) == 2, f"{r.text} {[x['url'] for x in CALLS]}")
SCRIPT[S.YT_SEARCH] = [(403, {"error": {"code": 403, "errors": [{"reason": "quotaExceeded"}]}})]
r = c.post(SR, json={"q": "blue moon", "provider": "both"}, headers=H(SK_A))
j = r.json()
check("*** YouTube used up for the day: Spotify's rows still come, and YouTube's problem is said in words ***",
      r.status_code == 200 and [x["provider"] for x in j["results"]] == ["spotify", "spotify"] and j["problems"].get("youtube") == S.YT_USED_UP, r.text)
SCRIPT[S.YT_SEARCH] = [(0, None)]
r = c.post(SR, json={"q": "blue moon", "provider": "youtube"}, headers=H(SK_A))
check("YouTube unreachable: 200, no rows, 'could not reach'", r.status_code == 200 and r.json()["results"] == [] and "reach" in r.json()["problems"]["youtube"], r.text)
check("a one-letter search: 400 before anything is asked", (CALLS.clear(), c.post(SR, json={"q": "x"}, headers=H(SK_A)).status_code)[1] == 400 and CALLS == [])

section("*** check, screens, other people, removing ***")
CALLS.clear()
r = c.post(f"{K}/youtube/check", headers=H(SK_A))
check("*** check YouTube: one video's details (1 unit), not a 100-unit search ***", r.json() == {"ok": True}
      and [x["url"] for x in CALLS] == [S.YT_VIDEOS], f"{r.text} {CALLS}")
SCRIPT[S.YT_VIDEOS] = [(400, {"error": {"errors": [{"reason": "badRequest"}], "message": "API key not valid. Please pass a valid API key."}})]
check("a key YouTube refuses says so", c.post(f"{K}/youtube/check", headers=H(SK_A)).json() == {"ok": False, "reason": S.YT_BAD_KEY})
SCRIPT[S.SP_TOKEN] = [(400, {"error": "invalid_client"})]
check("Spotify refusing the pair says so", c.post(f"{K}/spotify/check", headers=H(SK_A)).json() == {"ok": False, "reason": S.SP_BAD_KEY})
check("Spotify check passes on a good pair", c.post(f"{K}/spotify/check", headers=H(SK_A)).json() == {"ok": True})
SCREEN_HDR = {"X-Device-Key": "rec-screen-secret-for-tests"}
os.environ["DEVICE_KEYS"] = f"{SK_A}:rec-screen-secret-for-tests"
r = c.put(f"{K}/youtube", json={"key": YT_KEY}, headers=SCREEN_HDR)
check("*** a screen cannot save a key ***", r.status_code == 403, r.text)
check("...or remove one", c.delete(f"{K}/youtube", headers=SCREEN_HDR).status_code == 403)
check("...or change the filter", c.put(f"{K}/settings", json={"safe_search": "none"}, headers=SCREEN_HDR).status_code == 403)
check("...but a screen of the account may read the status and search", c.get(K, headers=SCREEN_HDR).json()["any"] is True
      and c.post(SR, json={"q": "blue moon"}, headers=SCREEN_HDR).status_code == 200)
os.environ.pop("DEVICE_KEYS", None)
stB = c.get(K, headers=H(SK_B)).json()
check("*** another account sees its own (empty) keys, nothing of A's ***", stB["any"] is False and stB["youtube"]["last4"] is None)
CALLS.clear()
check("*** and its search is a 404, with nobody's key used ***", c.post(SR, json={"q": "blue moon"}, headers=H(SK_B)).status_code == 404 and CALLS == [])
sealedA = appmod.store.get_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["youtube"])["data"]["sealed"]
check("A's sealed key does not open for B", S.keys.keybox.open(SK_B, sealedA) is None)
spA = appmod.store.get_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["spotify"])["data"]
appmod.store.put_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["youtube"], {**spA},
                       appmod.store.get_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["youtube"])["version"])
CALLS.clear()
r = c.post(SR, json={"q": "blue moon", "provider": "youtube"}, headers=H(SK_A))
check("*** a Spotify blob planted in the YouTube row opens to nothing: no YouTube call, words to paste again ***",
      r.status_code == 200 and "Paste it again" in r.json()["problems"].get("youtube", "") and CALLS == [], r.text)
r = c.delete(f"{K}/youtube", headers=H(SK_A))
check("*** removing: not set, and the row no longer holds a sealed key ***", r.status_code == 200 and r.json()["youtube"]["set"] is False
      and "sealed" not in appmod.store.get_state(SK_A, S.ACCOUNT_SCOPE, S.KEY_ROWS["youtube"])["data"])
check("...Spotify still searches", c.post(SR, json={"q": "blue moon"}, headers=H(SK_A)).json()["searched"] == ["spotify"])
check("removing a provider that is not one: 404", c.delete(f"{K}/vimeo", headers=H(SK_A)).status_code == 404)

section("*** one key, entered once (row 2.57): the levels, pure ***")
check("account (or nothing) is the default", S.clean_where("account", "x") == ("account", None) and S.clean_where("", "") == ("account", None))
check("a panel, device or person needs which one", S.clean_where("Panel", " pnl-1 ") == ("panel", "pnl-1"))
for lv, ref in (("room", "x"), ("panel", ""), ("device", "a b"), ("person", "x" * 81)):
    try:
        S.clean_where(lv, ref)
        check(f"refused where {lv}/{ref[:10]!r}", False, "accepted")
    except S.Refused as e:
        check(f"refused where {lv}/{ref[:10]!r}, in words", e.status == 400 and bool(e.detail))
check("a context keeps only good ids, in level order", S.clean_context({"device": "d-1", "panel": "bad id", "person": "", "x": "y"}) == {"device": "d-1"})
check("the order a search looks in: panel, device, person, then the account", S.LEVELS == ("panel", "device", "person"))

section("*** one key, entered once (row 2.57): the routes ***")
YT2 = "AIza" + "SecondFakeKeyForTestsOnly_01234567"     # made up
YT3 = "AIza" + "ThirdFakeKeyForTestsOnly_012345678"      # made up
SK_C, SK_D = "srch-c", "srch-d"
pc = c.get("/api/people", headers=H(SK_C)).json()["people"][0]["id"]
c.patch(f"/api/people/{pc}", json={"name": "Pat"}, headers=H(SK_C))
c.put(f"{K}/youtube", json={"key": YT_KEY}, headers=H(SK_C))


def used_key(**ctx):
    CALLS.clear()
    r = c.post(SR, json={"q": "blue moon", "provider": "youtube", **ctx}, headers=H(SK_C))
    yc = [x for x in CALLS if x["url"] == S.YT_SEARCH]
    return (yc[0]["headers"].get("X-goog-api-key") if yc else None), r


check("*** the account's key is the default everywhere: a panel and a device with none of their own use it ***",
      used_key(panel="pnl-1", device="dev-1")[0] == YT_KEY)
r = c.put(f"{K}/youtube", json={"key": YT2, "level": "device", "ref": "dev-1", "label": "Windows"}, headers=H(SK_C))
check("a key saved for one device: the answer never carries it", r.status_code == 200 and YT2 not in r.text, r.text)
check("*** that device now uses its own; another device still uses the default ***",
      used_key(device="dev-1")[0] == YT2 and used_key(device="dev-2")[0] == YT_KEY)
c.put(f"{K}/youtube", json={"key": YT3, "level": "panel", "ref": "pnl-1", "label": "YouTube"}, headers=H(SK_C))
check("*** the nearest wins: a panel's own beats its device's ***", used_key(panel="pnl-1", device="dev-1")[0] == YT3
      and used_key(panel="pnl-2", device="dev-1")[0] == YT2)
r = c.put(f"{K}/youtube", json={"key": YT2, "level": "person", "ref": "nobody-here-1"}, headers=H(SK_C))
check("a person who is not one of this account's: 404, nothing saved", r.status_code == 404, r.text)
r = c.put(f"{K}/youtube", json={"key": YT2, "level": "person", "ref": pc, "label": "ignored"}, headers=H(SK_C))
check("a person's key: labelled with the person's own name", r.status_code == 200
      and any(o["level"] == "person" and o["label"] == "Pat" for o in r.json()["youtube"]["overrides"]), r.text)
check("...and used for that person where no panel or device has one", used_key(person=pc, device="dev-9")[0] == YT2)
st = c.get(K, params={"panel": "pnl-1", "device": "dev-1"}, headers=H(SK_C)).json()
ov = {(o["level"], o["ref"]): o for o in st["youtube"]["overrides"]}
check("*** the status: the key in force from here (the panel's), every particular key with its last four, and which are here ***",
      st["youtube"]["in_force"] == {"level": "panel", "last4": YT3[-4:], "label": "YouTube"}
      and ov[("device", "dev-1")]["here"] is True and ov[("panel", "pnl-1")]["here"] is True and ov[("person", pc)]["here"] is False
      and ov[("device", "dev-1")]["label"] == "Windows", json.dumps(st)[:400])
raw_row = json.dumps(appmod.store.get_state(SK_C, S.ACCOUNT_SCOPE, S.OVERRIDE_ROWS["youtube"])["data"])
check("*** the particular keys are sealed too: none of them in the clear, in the row or the status ***",
      all(k not in raw_row and k not in json.dumps(st) for k in (YT_KEY, YT2, YT3)))
check("another account sees none of them", c.get(K, headers=H(SK_D)).json()["youtube"]["overrides"] == [])
r = c.delete(f"{K}/youtube", params={"level": "device", "ref": "dev-1"}, headers=H(SK_C))
check("*** removing a device's key = use the default again ***", r.status_code == 200 and used_key(device="dev-1")[0] == YT_KEY)
check("...the account's default untouched", c.get(K, headers=H(SK_C)).json()["youtube"]["set"] is True)
c.put(f"{K}/spotify", json={"client_id": SP_ID, "client_secret": SP_SECRET}, headers=H(SK_C))
_ov = appmod.store.get_state(SK_C, S.ACCOUNT_SCOPE, S.OVERRIDE_ROWS["youtube"])
_sp_sealed = appmod.store.get_state(SK_C, S.ACCOUNT_SCOPE, S.KEY_ROWS["spotify"])["data"]["sealed"]
appmod.store.put_state(SK_C, S.ACCOUNT_SCOPE, S.OVERRIDE_ROWS["youtube"],
                       {**_ov["data"], "panel:pnl-bad": {"sealed": _sp_sealed, "last4": "zzzz"}}, _ov["version"])
k_used, r = used_key(panel="pnl-bad")
check("*** a panel's key that will not open is SAID, never quietly swapped for the account's ***",
      k_used is None and "Paste it again" in r.json()["problems"].get("youtube", ""), r.text)
saved_max = S.MAX_OVERRIDES
S.MAX_OVERRIDES = 2
r = c.put(f"{K}/youtube", json={"key": YT2, "level": "device", "ref": "dev-x"}, headers=H(SK_C))
check(f"*** a cap on particular keys: past it, 409 in words ***", r.status_code == 409 and "Remove some" in r.json()["detail"], r.text)
check("...replacing one already there is not past the cap", c.put(f"{K}/youtube", json={"key": YT_KEY, "level": "panel", "ref": "pnl-1"}, headers=H(SK_C)).status_code == 200)
S.MAX_OVERRIDES = saved_max

section("*** who may change which: a bare screen, a screen with the owner signed in ***")
import base64 as _b64s  # noqa: E402
from itsdangerous import TimestampSigner  # noqa: E402


def session_cookie(user):
    signer = TimestampSigner(os.environ.get("SESSION_SECRET", "dev-only-insecure-change-me"))
    return signer.sign(_b64s.b64encode(json.dumps({"user": user}).encode("utf-8"))).decode("utf-8")


os.environ["DEVICE_KEYS"] = f"{SK_C}:rec-screen-c-secret-for-tests"
SCR = {"X-Device-Key": "rec-screen-c-secret-for-tests"}
st = c.get(K, headers=SCR).json()
check("a bare screen: the status says it cannot change everything, and which levels it can", st["can_change"] is False
      and st["signed_in"] is False and st["screen_levels"] == ["panel", "device"])
r = c.put(f"{K}/youtube", json={"key": YT2}, headers=SCR)
check("*** a bare screen cannot save the account's key: 403, saying to sign in or save it for this player or device ***",
      r.status_code == 403 and r.json()["detail"] == S.SIGN_IN_FIRST, r.text)
check("...nor a person's", c.put(f"{K}/youtube", json={"key": YT2, "level": "person", "ref": pc}, headers=SCR).status_code == 403)
r = c.put(f"{K}/youtube", json={"key": YT2, "level": "panel", "ref": "pnl-scr"}, headers=SCR)
check("*** ...but may save one for one panel (what it could always do in the panel's settings) ***", r.status_code == 200, r.text)
check("...or one device", c.put(f"{K}/youtube", json={"key": YT2, "level": "device", "ref": "dev-scr"}, headers=SCR).status_code == 200)
check("...and remove those", c.delete(f"{K}/youtube", params={"level": "device", "ref": "dev-scr"}, headers=SCR).status_code == 200)
check("...but not remove the account's", c.delete(f"{K}/youtube", headers=SCR).status_code == 403)
check("...or change the filter", c.put(f"{K}/settings", json={"safe_search": "none"}, headers=SCR).status_code == 403)
cs = TestClient(appmod.app)
cs.cookies.set("session", session_cookie(SK_C))
st = cs.get(K, headers=SCR).json()
check("*** the same screen page with the owner's own sign-in: it may change everything ***", st["can_change"] is True and st["signed_in"] is True)
r = cs.put(f"{K}/youtube", json={"key": YT_KEY}, headers=SCR)
check("...saving the account's key from it works", r.status_code == 200, r.text)
check("/api/me says signed in there", cs.get("/api/me", headers=SCR).json().get("signed_in") is True)
check("/api/me says not signed in on a bare screen", c.get("/api/me", headers=SCR).json().get("signed_in") is False)
cs = TestClient(appmod.app)
cs.cookies.set("session", session_cookie("google:somebody-else"))
check("*** somebody ELSE's sign-in on that screen is not the owner: 403 ***",
      cs.put(f"{K}/youtube", json={"key": YT2}, headers=SCR).status_code == 403)
os.environ.pop("DEVICE_KEYS", None)

section("*** a panel's old key, handed over once (adopt) ***")
r = c.post(f"{K}/youtube/adopt", json={"key": YT2, "panel": "pnl-old", "label": "YouTube"}, headers=H(SK_D))
check("*** no default yet: the panel's old key becomes the account's default ***", r.status_code == 200 and r.json()["where"] == "account"
      and r.json()["youtube"]["set"] is True and YT2 not in r.text, r.text)
r = c.post(f"{K}/youtube/adopt", json={"key": YT2, "panel": "pnl-old2"}, headers=H(SK_D))
check("the same key from another panel: nothing more to keep", r.json()["where"] == "same" and r.json()["youtube"]["overrides"] == [])
r = c.post(f"{K}/youtube/adopt", json={"key": YT3, "panel": "pnl-old3", "label": "YouTube"}, headers=H(SK_D))
check("*** a DIFFERENT key: kept for that one panel, so it searches exactly as it did; the default is untouched ***",
      r.json()["where"] == "panel" and r.json()["youtube"]["in_force"]["level"] == "panel"
      and r.json()["youtube"]["last4"] == YT2[-4:], r.text)
os.environ["DEVICE_KEYS"] = f"{SK_D}:rec-screen-d-secret-for-tests"
r = c.post(f"{K}/youtube/adopt", json={"key": YT3, "panel": "pnl-old4"}, headers={"X-Device-Key": "rec-screen-d-secret-for-tests"})
check("a screen may hand over a panel's old key (it only ever makes it harder to see)", r.status_code == 200 and r.json()["where"] == "panel", r.text)
os.environ.pop("DEVICE_KEYS", None)
check("a key of the wrong shape is not adopted", c.post(f"{K}/youtube/adopt", json={"key": "nope", "panel": "p"}, headers=H(SK_D)).status_code == 400)

section("*** Spotify at a level too ***")
SP_ID2, SP_SECRET2 = "1111111111abcdef0123456789abcdef", "2222222222543210fedcba9876543210"   # made up
c.put(f"{K}/spotify", json={"client_id": SP_ID, "client_secret": SP_SECRET}, headers=H(SK_C))
c.put(f"{K}/spotify", json={"client_id": SP_ID2, "client_secret": SP_SECRET2, "level": "device", "ref": "dev-sp"}, headers=H(SK_C))
CALLS.clear()
c.post(SR, json={"q": "blue moon", "provider": "spotify", "device": "dev-sp"}, headers=H(SK_C))
tok = [x for x in CALLS if x["url"] == S.SP_TOKEN]
check("*** a device's own Spotify pair is the one asked for a pass from that device ***",
      tok and tok[0]["headers"].get("Authorization") == "Basic " + _b64.b64encode(f"{SP_ID2}:{SP_SECRET2}".encode()).decode())

section("search rate limit")
S.search_limit.reset()
codes = [c.post(SR, json={"q": "blue moon"}, headers=H(SK_A)).status_code for _ in range(S.search_limit.limit + 1)]
check(f"*** {S.search_limit.limit} searches a minute are fine, the next is a 429 ***",
      codes[:-1] == [200] * S.search_limit.limit and codes[-1] == 429, str(codes))
S.search_limit.reset()

section("a server that cannot store keys says so")
saved_box = S.keys.keybox
S.keys.keybox = None
r = c.put(f"{K}/youtube", json={"key": YT_KEY}, headers=H(SK_B))
check("no key secret: 503 naming the variable; the status says it cannot store",
      r.status_code == 503 and "NIMROD_AI_KEY_SECRET" in r.json()["detail"] and c.get(K, headers=H(SK_B)).json()["can_store"] is False, r.text)
S.keys.keybox = saved_box

section("the privacy page")
d = repr(c.get("/api/what-we-store").json())
check("*** 'what we store' describes the search keys (encrypted) and says searches are not kept ***",
      "YouTube or Spotify key" in d and "is not kept here" in d)
check("...and still says what it said before", "never what was said" in d and "sign notes" in d)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
