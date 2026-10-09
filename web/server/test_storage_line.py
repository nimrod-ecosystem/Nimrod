"""The storage line on the state and event routes - the rules, then the six routes, then the collector.

    py -3.13 test_storage_line.py

Mike, 2026-10-07 (DECISIONS.md, "what the server may hold", row 2.58): nothing that is a person's content
or body goes on the server. storage_line.py is the server's half of that; this file proves each rule
refuses what it should, lets through what the site legitimately writes, and is wired into every route
that takes a client's JSON for state or events.
"""
import base64
import os
import sys
import tempfile
from pathlib import Path

import storage_line as sl

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


def refused(fn):
    """(status, detail) of a Refused, or None when it passed."""
    try:
        fn()
        return None
    except sl.Refused as e:
        return (e.status, e.detail)


B64_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
def b64ish(n):
    return (B64_ALPHA * (n // len(B64_ALPHA) + 1))[:n]


# ---------------------------------------------------------------- rule 1: raw sensor recordings
section("rule 1 - raw sensor recordings are refused")
r = refused(lambda: sl.check_event("anything", "device-blob", {}))
check("*** kind device-blob is refused, whatever the stream ***", r and r[0] == 400, r)
check("...and the sentence says where it belongs (the household's own machine)",
      r and "household's own machine" in r[1], r)
r = refused(lambda: sl.check_event("device-data", "note", {"x": 1}))
check("*** stream device-data is refused, whatever the kind ***", r and r[0] == 400, r)
check("case does not get round it", refused(lambda: sl.check_event("Device-Data", "x", {}))
      and refused(lambda: sl.check_event("s", "DEVICE-BLOB", {})))
check("an ordinary event passes", refused(lambda: sl.check_event("gameplay", "trial", {"ms": 812, "ok": True})) is None)

# ---------------------------------------------------------------- rule 4: play history
section("rule 4 - play history (which photo, video or song played when) is refused (row 2.58)")
r = refused(lambda: sl.check_event("0f3c9a2b7d", "play", {"id": "dQw4w9WgXcQ", "at": 1759800000000}))
check("*** a panel's `play {id, at}` is refused, whatever the stream (a panel's stream is its instance id) ***",
      r and r[0] == 400, r)
check("...and the sentence says where it is kept (the screen that played it)", r and "screen that played it" in r[1], r)
r = refused(lambda: sl.check_event("plays", "play", {"source": "spotify", "id": "spotify:track:1", "panel": "m-1"}))
check("*** the shared `plays` stream is refused ***", r and r[0] == 400, r)
check("...whatever kind is sent on it", refused(lambda: sl.check_event("plays", "note", {"x": 1})))
check("case does not get round it", refused(lambda: sl.check_event("s", "PLAY", {"id": "a"}))
      and refused(lambda: sl.check_event("Plays", "x", {})))
check("*** NOT refused: game results (a trial), the talk board's words, a `held` notice - not ruled, left alone ***",
      refused(lambda: sl.check_event("gameplay", "trial", {"ms": 812, "ok": True})) is None
      and refused(lambda: sl.check_event("aac", "pressed", {"word": "drink"})) is None
      and refused(lambda: sl.check_event("0f3c9a2b7d", "held", {"id": "v", "at": 1, "afterMs": 60000})) is None)
check("a kind that merely starts with 'play' is its own kind (only `play` itself is play history)",
      refused(lambda: sl.check_event("gameplay", "player-joined", {"seat": 1})) is None
      and refused(lambda: sl.check_event("playlists", "added", {"id": "x"})) is None)

# ---------------------------------------------------------------- rule 2: pictures, sound, video
section("rule 2 - no picture, sound or video inside the JSON")
for prefix in ("data:image/png;base64,iVBOR", "data:audio/webm;base64,GkXf", "data:video/mp4;base64,AAAA"):
    r = refused(lambda: sl.check_state({"pic": prefix}))
    check(f"*** a string starting {prefix.split(';')[0]} is refused ***", r and r[0] == 400, r)
check("in any case (DATA:Image/...)", refused(lambda: sl.check_state({"a": "DATA:Image/JPEG;base64,/9j/"})))
check("after leading spaces", refused(lambda: sl.check_state({"a": "   data:image/gif;base64,R0lG"})))
check("deep inside lists and objects", refused(lambda: sl.check_state({"a": [{"b": [1, {"c": "data:audio/ogg,xx"}]}]})))
check("as an object KEY too", refused(lambda: sl.check_state({"data:image/png;base64,iVBOR": 1})))
check("in an event as well as in state", refused(lambda: sl.check_event("s", "k", {"img": "data:image/png;base64,x"})))
check("a data: address for TEXT is not a picture (only image/audio/video are named)",
      refused(lambda: sl.check_state({"a": "data:text/plain,hello"})) is None)
check("a link to a picture somewhere else is fine (a pointer, not the picture)",
      refused(lambda: sl.check_state({"src": "https://example.org/photo.jpg", "y": "https://youtu.be/dQw4w9WgXcQ"})) is None)
check("the words 'data:image' mid-sentence are fine (it has to START the string)",
      refused(lambda: sl.check_state({"note": "the site refuses data:image/ addresses now"})) is None)

section("rule 2 - a long unbroken base64 run")
check(f"a run of exactly {sl.BASE64_RUN_MAX} passes", refused(lambda: sl.check_state({"a": b64ish(sl.BASE64_RUN_MAX)})) is None)
r = refused(lambda: sl.check_state({"a": b64ish(sl.BASE64_RUN_MAX + 1)}))
check(f"*** a run of {sl.BASE64_RUN_MAX + 1} is refused, 400, with the count in the sentence ***",
      r and r[0] == 400 and f"{sl.BASE64_RUN_MAX + 1:,}" in r[1], r)
real = base64.b64encode(bytes(range(256)) * 8).decode()          # 2 KB of bytes -> 2,732 characters
check("real base64 of 2 KB of bytes is refused", refused(lambda: sl.check_state({"a": real})))
urlsafe = base64.urlsafe_b64encode(bytes(range(256)) * 8).decode().rstrip("=")
check("URL-safe base64 is refused too", refused(lambda: sl.check_state({"a": urlsafe})))
check("a hex dump is base64's alphabet too, so it is caught", refused(lambda: sl.check_state({"a": "0f" * 600})))
check("*** base64 inside a longer string (prefix, then the run) is caught ***",
      refused(lambda: sl.check_state({"a": "here it is: " + real + " - enjoy"})))
mime = "\n".join(real[i:i + 76] for i in range(0, len(real), 76))
check("*** base64 wrapped at 76 characters a line (MIME) is measured as one run and refused ***",
      sl.longest_base64_run(mime) > sl.BASE64_RUN_MAX and refused(lambda: sl.check_state({"a": mime})), sl.longest_base64_run(mime))
mime_crlf = "\r\n".join(real[i:i + 64] for i in range(0, len(real), 64))
check("...and at 64 with CRLF line ends", refused(lambda: sl.check_state({"a": mime_crlf})))
ids = "\n".join(f"dQw4w9WgXc{i % 10}" for i in range(300))            # 300 YouTube-style ids, one per line
check("a list of short ids one per line is NOT joined up (short lines never chain)",
      sl.longest_base64_run(ids) == 11 and refused(lambda: sl.check_state({"a": ids})) is None, sl.longest_base64_run(ids))
prose = ("I would like the photos to change a little slower in the morning, and the clock bigger. " * 60)
check("ordinary prose thousands of characters long passes", len(prose) > 5000 and refused(lambda: sl.check_state({"a": prose})) is None)
check("a 32-character hex id (the longest legitimate run in the dev database) passes",
      refused(lambda: sl.check_state({"id": "cfd1ec3d186f47e2beecd7ea11518d40"})) is None)
token = b64ish(380)
check("an OAuth-sized token (~380 characters) passes", refused(lambda: sl.check_state({"t": token})) is None)
check("Chinese text with no spaces is not base64", refused(lambda: sl.check_state({"a": "我想看照片" * 1000})) is None)

# ---------------------------------------------------------------- rule 3: size caps
section("rule 3 - a size cap per row")
def sized(n, ch="a b "):
    """A JSON object whose compact UTF-8 size is exactly n bytes (prose, so rule 2 has nothing to say)."""
    base = sl.row_bytes({"t": ""})
    s = (ch * (n // len(ch) + 1))[:n - base]
    d = {"t": s}
    assert sl.row_bytes(d) == n, (sl.row_bytes(d), n)
    return d
check(f"state of exactly {sl.STATE_MAX_BYTES:,} bytes passes", refused(lambda: sl.check_state(sized(sl.STATE_MAX_BYTES))) is None)
r = refused(lambda: sl.check_state(sized(sl.STATE_MAX_BYTES + 1)))
check("*** one byte over is refused with 413 and a plain sentence ***",
      r and r[0] == 413 and "too big" in r[1] and "KB" in r[1], r)
check(f"an event of exactly {sl.EVENT_MAX_BYTES:,} bytes passes",
      refused(lambda: sl.check_event("s", "k", sized(sl.EVENT_MAX_BYTES))) is None)
r = refused(lambda: sl.check_event("s", "k", sized(sl.EVENT_MAX_BYTES + 1)))
check("*** an event one byte over is refused with 413 ***", r and r[0] == 413 and "event" in r[1], r)
check("size is counted as UTF-8 as sent, not as the database's escaping (a CJK character is 3 bytes, not 6)",
      sl.row_bytes({"a": "我"}) == len('{"a":"我"}'.encode("utf-8")))

section("legitimate maxima the client can write still pass")
note = {"id": "n-abc-12345", "at": 1759800000000, "where": "w" * 80, "text": ("a note line. " * 400)[:4000],
        "context": {"dashboard": "d" * 120, "panel": "p" * 120, "page": "/home.html", "person": "x" * 120}}
nimrod_ai = {"ai": {"notes": [dict(note, id=f"n-{i}") for i in range(200)],
                    "wraps": [{"summary": "s " * 750, "cleaned": "c " * 3000, "lines": ["l " * 150] * 200} for _ in range(5)],
                    "persona": "p " * 1000}}
size = sl.row_bytes(nimrod_ai)
check(f"*** the person record nimrod-ai with EVERY list at its maximum ({size:,} bytes) passes the state cap ***",
      refused(lambda: sl.check_state(nimrod_ai)) is None, str(size))
trial = {"game": "wait-go", "ms": 812, "ok": True, "level": 3, "at": 1759800000000, "seat": 0, "mode": "solo"}
check("a game trial passes", refused(lambda: sl.check_event("gameplay", "trial", trial)) is None)
rec = {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "t" * 200, "message": "m " * 140,
       "thumb": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "from": "Aunt Dolly"}
check("a recommendation-sized event passes", refused(lambda: sl.check_event("recommendations", "rec", rec)) is None)
about = {"sections": [{"kind": "about", "text": "word " * 400}], "theme": {"bg": "#123456"}}
check("a page with a full 2,000-character About me passes", refused(lambda: sl.check_state(about)) is None)

# ---------------------------------------------------------------- rule 5: voiceprints
section("rule 5 - a voiceprint is refused, everywhere (row 2.56)")
import random  # noqa: E402
rnd = random.Random(7)
emb = [round(rnd.gauss(0, 0.06), 6) for _ in range(256)]
vp_file = {"format": "nimrod-voiceprint", "v": 1, "person": "p_1", "name": "Alex", "engine": "wespeaker:resnet34-LM",
           "dims": 256, "vector": emb, "enrolledAt": 1759800000000, "clips": 5, "seconds": 21.4}
r = refused(lambda: sl.check_state({"me": vp_file}))
check("*** the speech program's own voiceprint file, put in a setting: refused, 400, with a sentence ***",
      r and r[0] == 400 and "voiceprint" in r[1].lower(), r)
check("...in an event as well", refused(lambda: sl.check_event("anything", "note", {"x": vp_file})))
check("*** the tag alone is enough, whatever else is there (even no numbers) ***",
      refused(lambda: sl.check_state({"format": "nimrod-voiceprint"})) and
      refused(lambda: sl.check_state({"a": [{"FORMAT": " Nimrod-Voiceprint "}]})))
check("a key named voiceprint or voiceprints (any case) is refused, whatever it holds",
      refused(lambda: sl.check_state({"voiceprint": "x"})) and refused(lambda: sl.check_state({"VoicePrints": []})))
check("*** a bare list of 256 fractional numbers (an embedding with every label stripped) is refused ***",
      refused(lambda: sl.check_event("s", "k", {"v": emb})))
check(f"...and of exactly {sl.VOICEPRINT_NUMBERS_MIN}", refused(lambda: sl.check_state({"v": emb[:sl.VOICEPRINT_NUMBERS_MIN]})))
check(f"{sl.VOICEPRINT_NUMBERS_MIN - 1} of them pass (the floor, argued in storage_line.py)",
      refused(lambda: sl.check_state({"v": emb[:sl.VOICEPRINT_NUMBERS_MIN - 1]})) is None)
check("deep inside lists and objects", refused(lambda: sl.check_state({"a": [{"b": [1, {"c": emb}]}]})))
check("as 32-bit floats in base64 it is rule 2's (refused as encoded data)",
      refused(lambda: sl.check_state({"v": base64.b64encode(bytes(1024)).decode()})))
check("NOT refused: 500 reaction times in whole milliseconds (the site's long numeric facts are whole numbers)",
      refused(lambda: sl.check_event("gameplay", "trial", {"ms": [800 + i for i in range(500)]})) is None)
check("NOT refused: a list of 300 mixed numbers that are mostly whole",
      refused(lambda: sl.check_state({"v": [i if i % 4 else i + 0.5 for i in range(300)]})) is None)
check("NOT refused: the site's own who-is-talking settings (voiceIdOn / voiceIdSureAt)",
      refused(lambda: sl.check_state({"voiceIdOn": True, "voiceIdSureAt": 0.8})) is None)
check("NOT refused: the word in a sentence", refused(lambda: sl.check_state({"note": "set up my voiceprint today"})) is None)
check("NOT refused: a transcript's speaker label ({who, sure}) - a name and one number, not a voiceprint",
      refused(lambda: sl.check_event("s", "said", {"text": "hi", "speaker": {"who": "Alex", "sure": 0.91}})) is None)
spk_src = (Path(__file__).resolve().parents[1] / "speech_service" / "speakers.py").read_text(encoding="utf-8")
check("*** the tag here is the speech program's own (speakers.py FORMAT) - one name, two files ***",
      f"FORMAT = '{sl.VOICEPRINT_FORMAT}'" in spk_src)

deep = {}
cur = deep
for _ in range(5000):
    cur["n"] = {}
    cur = cur["n"]
cur["x"] = "data:image/png;base64,x"
check("a very deeply nested body is walked without blowing the stack (and the picture at the bottom found)",
      refused(lambda: sl.check_content(deep)) is not None)


# ---------------------------------------------------------------- rule 6: what the subtitles learned
section("rule 6 - what the subtitles learned from corrections is refused, everywhere (subtitle learning)")
learned = {"format": "nimrod-learned-words", "v": 1, "key": "p_1", "name": "Alex",
           "words": [{"w": "Rosalind", "n": 2, "at": 1759800000000}],
           "fixes": [{"from": "rose lind", "to": "Rosalind", "n": 2, "at": 1759800000000}], "updatedAt": 1759800000000}
r = refused(lambda: sl.check_state(learned))
check("*** a learned-words record, put in a setting: refused, 400, with a sentence ***",
      r and r[0] == 400 and "never kept on this site" in r[1], r)
check("...inside anything, in any case, and as a key named learnedWords / learned-words / learned_words",
      refused(lambda: sl.check_state({"a": [{"FORMAT": " Nimrod-Learned-Words "}]}))
      and refused(lambda: sl.check_state({"learnedWords": []})) and refused(lambda: sl.check_state({"x": {"Learned-Words": {}}}))
      and refused(lambda: sl.check_state({"learned_words": "Rosalind"})))
check("*** in an event, and through the history route even for a person who chose \"with us\" ***",
      refused(lambda: sl.check_event("s", "said", {"learned": learned}))
      and refused(lambda: sl.check_history("words", [{"kind": "select", "data": {"word": "hi", "learnedWords": ["Rosalind"]}}],
                                           {"words": "us"})))
check("NOT refused: the site's own subtitle-learning settings (subtitlesLearn / subtitlesFixAfter / subtitlesHints)",
      refused(lambda: sl.check_state({"subtitlesLearn": True, "subtitlesFixAfter": 2, "subtitlesHints": True})) is None)
check("NOT refused: the words in a sentence, or a talk-board word",
      refused(lambda: sl.check_state({"note": "the learned words list is long"})) is None
      and refused(lambda: sl.check_history("words", [{"kind": "select", "data": {"board": "home", "word": "drink"}}],
                                           {"words": "us"})) is None)
sl_src = (Path(__file__).resolve().parents[1] / "client" / "subtitle_learning.js").read_text(encoding="utf-8")
check("*** the tag here is the client's own (subtitle_learning.js LEARNED_FORMAT) - one name, two files ***",
      f"export const LEARNED_FORMAT = '{sl.LEARNED_FORMAT}';" in sl_src)


# ---------------------------------------------------------------- own board clips (2026-10-09)
section("own board clips - a board's card sounds stay on the device and in the Nimrod folder (board_sounds.js)")
own_board = {"board": {"id": "own-x", "name": "My board", "cols": 3, "rows": 2, "cells": [
    {"id": "c0", "word": "Thank you", "sound": {"file": "thank_you-lq3k2a.webm", "from": "recorded"}},
    {"id": "c1", "word": "Tea", "sound": {"file": "tea-lq3k9z.mp3", "from": "file"}}]}, "boardId": "custom"}
check("a board whose cards NAME their sounds passes (a name is small text the site needs on every device)",
      refused(lambda: sl.check_state(own_board)) is None)
one_second = base64.b64encode(os.urandom(6000)).decode()     # ~1 s of compressed speech, as text
inline = {"board": {**own_board["board"], "cells": [{"id": "c0", "word": "Thank you",
                                                     "sound": {"file": "thank_you.webm", "data": "data:audio/webm;base64," + one_second}}]}}
r = refused(lambda: sl.check_state(inline))
check("*** the same board with the recording INSIDE it (data:audio/...): refused, 400, keep it at home ***",
      r and r[0] == 400 and "own machine" in r[1], r)
bare = {"board": {**own_board["board"], "cells": [{"id": "c0", "word": "Thank you", "sound": {"file": "thank_you.webm", "bytes": one_second}}]}}
r = refused(lambda: sl.check_state(bare))
check("*** ...and as bare base64 with no data: address: refused too ***", r and r[0] == 400, r)
check("...in an event as well", refused(lambda: sl.check_event("s", "select", {"word": "hi", "clip": "data:audio/ogg;base64," + one_second})))
bs_src = (Path(__file__).resolve().parents[1] / "client" / "board_sounds.js").read_text(encoding="utf-8")
check("*** board_sounds.js has no way to send a sound anywhere (no fetch, FormData, XMLHttpRequest, sendBeacon) ***",
      not any(s in bs_src for s in ("fetch(", "new FormData", "XMLHttpRequest", "sendBeacon(")))


# ---------------------------------------------------------------- the six routes
section("the six routes refuse, and keep nothing")
tmp = tempfile.mkdtemp(prefix="nimrod_storage_line_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "storage_line_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
U = "storage-line-user"
H = {"X-Dev-User": U}
person = c.get("/api/people", headers=H).json()["people"][0]["id"]
screen = c.post("/api/profiles", json={"name": "Bedside", "person_id": person}, headers=H).json()["id"]

state_urls = {
    "per-screen state": f"/api/profiles/{screen}/state/settings",
    "per-person state": f"/api/people/{person}/state/prefs",
    "account (user) state": "/api/user-state/prefs-legacy",   # the default person's row: its own key here
}
event_urls = {
    "per-screen events": f"/api/profiles/{screen}/events/gameplay",
    "per-person events": f"/api/people/{person}/events/gameplay",
    "account (user) events": "/api/user-events/gameplay",
}
PIC = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"
for name, url in state_urls.items():
    ok = c.put(url, json={"data": {"theme": "warm"}, "base_version": 0}, headers=H)
    check(f"{name}: an ordinary setting saves", ok.status_code == 200, ok.text)
    v = ok.json().get("version", 0)
    r = c.put(url, json={"data": {"theme": "warm", "pic": PIC}, "base_version": v}, headers=H)
    check(f"*** {name}: a picture inside is refused, 400, with a sentence ***",
          r.status_code == 400 and "picture" in r.json().get("detail", ""), r.text)
    r = c.put(url, json={"data": {"blob": b64ish(5000)}, "base_version": v}, headers=H)
    check(f"{name}: a long base64 run is refused", r.status_code == 400, r.text)
    r = c.put(url, json={"data": {"theme": "warm", "me": vp_file}, "base_version": v}, headers=H)
    check(f"*** {name}: a voiceprint inside is refused, 400, with a sentence (rule 5) ***",
          r.status_code == 400 and "voiceprint" in r.json().get("detail", "").lower(), r.text)
    r = c.put(url, json={"data": {"theme": "warm", "subs": learned}, "base_version": v}, headers=H)
    check(f"*** {name}: what the subtitles learned is refused, 400 (rule 6) ***",
          r.status_code == 400 and "never kept on this site" in r.json().get("detail", ""), r.text)
    r = c.put(url, json={"data": sized(sl.STATE_MAX_BYTES + 10), "base_version": v}, headers=H)
    check(f"*** {name}: too big is refused, 413 ***", r.status_code == 413 and "too big" in r.json().get("detail", ""),
          f"{r.status_code} {r.text[:200]}")
    got = c.get(url, headers=H).json()
    check(f"{name}: ...and none of it was kept (still the ordinary setting, same version)",
          got.get("data") == {"theme": "warm"} and got.get("version") == v, str(got)[:200])

for name, url in event_urls.items():
    ok = c.post(url, json={"kind": "trial", "data": trial}, headers=H)
    check(f"{name}: an ordinary event is kept", ok.status_code == 200, ok.text)
    before = c.get(url, headers=H).json()["total"]
    blob_url = url.rsplit("/", 1)[0] + "/device-data"
    r = c.post(blob_url, json={"kind": "device-blob", "data": {"bytes": "AAAA", "encoding": "base64"}}, headers=H)
    check(f"*** {name}: the collector's device-blob on device-data is refused, 400 ***",
          r.status_code == 400 and "household's own machine" in r.json().get("detail", ""), r.text)
    r = c.post(url, json={"kind": "device-blob", "data": {}}, headers=H)
    check(f"{name}: device-blob on any other stream is refused", r.status_code == 400, r.text)
    r = c.post(blob_url, json={"kind": "trial", "data": {}}, headers=H)
    check(f"{name}: the device-data stream refuses any kind", r.status_code == 400, r.text)
    r = c.post(url, json={"kind": "trial", "data": {"clip": "data:audio/webm;base64,GkXfo"}}, headers=H)
    check(f"{name}: a sound inside an event is refused", r.status_code == 400, r.text)
    r = c.post(url, json={"kind": "trial", "data": {"v": emb}}, headers=H)
    check(f"*** {name}: a voiceprint's numbers in an event are refused, 400 (rule 5) ***",
          r.status_code == 400 and "voiceprint" in r.json().get("detail", "").lower(), r.text)
    r = c.post(url, json={"kind": "trial", "data": {"learned": learned}}, headers=H)
    check(f"*** {name}: what the subtitles learned, in an event: refused, 400 (rule 6) ***",
          r.status_code == 400 and "never kept on this site" in r.json().get("detail", ""), r.text)
    r = c.post(url, json={"kind": "trial", "data": sized(sl.EVENT_MAX_BYTES + 10)}, headers=H)
    check(f"*** {name}: an event too big is refused, 413 ***", r.status_code == 413, f"{r.status_code} {r.text[:200]}")
    r = c.post(url, json={"kind": "play", "data": {"id": "dQw4w9WgXcQ", "at": 1759800000000}}, headers=H)
    check(f"*** {name}: a `play` (what played when) is refused, 400 ***",
          r.status_code == 400 and "screen that played it" in r.json().get("detail", ""), r.text)
    plays_url = url.rsplit("/", 1)[0] + "/plays"
    r = c.post(plays_url, json={"kind": "play", "data": {"source": "youtube", "id": "dQw4w9WgXcQ"}}, headers=H)
    check(f"{name}: the shared `plays` stream is refused", r.status_code == 400, r.text)
    check(f"{name}: ...and nothing refused was appended", c.get(url, headers=H).json()["total"] == before)
    check(f"{name}: ...nor on device-data", c.get(blob_url, headers=H).json()["total"] == 0)
    check(f"{name}: ...nor on plays", c.get(plays_url, headers=H).json()["total"] == 0)


# ---------------------------------------------------------------- the collector, end to end
section("tools/collector.py pointed at this site: refused, not retried, nothing kept")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
from collector import Settings, Spool, Uploader  # noqa: E402

spool_dir = Path(tmp) / "spool"
s = Settings(spool_dir=str(spool_dir), server="http://testserver", device_key="unused", person_id=person)
spool = Spool(str(spool_dir), s.device_name)
spool.append(bytes((i * 7 + 11) % 256 for i in range(4096)))
check("the defaults name no Nimrod site and upload nowhere until told to", Settings().server == "")


def post_through_testclient(url, body, headers):
    return c.post(url.replace("http://testserver", ""), json=body, headers=H).status_code


up = Uploader(s, post=post_through_testclient)
ok, msg = up.send_next(spool)
check("*** the site refuses the collector's upload ***", ok is False and "400" in msg, msg)
check("*** ...and the collector treats it as a rejection, not an outage (no blind retry) ***", "will not retry" in msg, msg)
check("...its upload pointer did not move, so the bytes are still in its spool", spool.state["uploaded"] == 0)
check("...and the site kept none of it", c.get(f"/api/people/{person}/events/device-data", headers=H).json()["total"] == 0)


# ---------------------------------------------------------------- the privacy page agrees
section("the privacy page no longer says sensor readings arrive here")
text = str(c.get("/api/what-we-store").json())
check("*** /api/what-we-store does not say sensor readings arrive here ***",
      "Sensor readings" not in text and "run a logger" not in text, "found the old sentence")
store_page = c.get("/api/what-we-store").json()
events_row = next((row["what"] for row in store_page["stores"] if row["table"] == "events"), "")
check("*** the event log's description no longer says which photo was shown when ***",
      events_row and "which photo was shown" not in events_row, events_row[:200])
check("*** ...and the never-stored list says what played is kept on the screen that played it ***",
      any("played" in n and "screen that played" in n for n in store_page["never"]), str(store_page["never"]))


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
