#!/usr/bin/env python3
"""apply_site_defaults.py - the saved site defaults into nimrod_defaults.js (row 2.145 step 5c). Run:

    py -3.13 web/tools/test_apply_site_defaults.py

Works on a COPY of web/client/nimrod_defaults.js in a temporary folder; the real file is read, never written.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import apply_site_defaults as tool  # noqa: E402
import site_defaults as rules  # noqa: E402  (apply_site_defaults put web/server on the path)

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


REAL = tool.DEFAULTS_JS
real_before = REAL.read_bytes()
tmp = Path(tempfile.mkdtemp(prefix="nimrod_apply_defaults_"))
js = tmp / "nimrod_defaults.js"
shutil.copyfile(REAL, js)

ROOM = {"walls": "plaster", "items": [{"id": "desk1", "part": "desk", "x": 40, "y": 80}]}
PLACE = {"items": [{"part": "bed", "x": 50, "y": 90}]}
SCENE = {"pieces": [{"kind": "tree", "x": 100, "y": 200}]}
saves = [
    {"kind": "rooms", "path": ["theRoom"], "body": ROOM},
    {"kind": "town", "path": ["nimrod", "kingHall"], "body": PLACE},
    {"kind": "village", "path": ["village"], "body": SCENE},
    {"kind": "words", "path": ["/home", "Start here"], "body": {"page": "/home", "old": "Start here", "new": "Begin here"}},
]
text = rules.copy_text(saves, "2026-10-31")

check("*** the shipped file has its data block, plain JSON between the markers ***", isinstance(rules.read_block(REAL.read_text(encoding="utf-8")), dict))
entry, words = tool.split_copy(text)
check("*** the copied text splits into the defaults entry and the words ***",
      entry["rooms"]["theRoom"] == ROOM and entry["town"]["nimrod"]["kingHall"] == PLACE and entry["made"] == "2026-10-31"
      and words.startswith(rules.WORDS_HEAD) and "/home\tStart here\tBegin here" in words, text)

got = tool.apply(text, js, dry_run=True)
check("*** --dry-run: says what would change, writes nothing ***", js.read_bytes() == REAL.read_bytes() and not got["written"]
      and [(k, p, h) for k, p, h in got["said"]] == [("rooms", ["theRoom"], "new"), ("town", ["nimrod", "kingHall"], "new"), ("village", ["village"], "new")],
      str(got["said"]))
got = tool.apply(text, js)
data = rules.read_block(js.read_text(encoding="utf-8"))
check("*** applied: each one merged into the data block, made dated, every kind still there ***",
      got["written"] and data["rooms"]["theRoom"] == ROOM and data["town"]["nimrod"]["kingHall"] == PLACE and data["village"]["village"] == SCENE
      and data["made"] == "2026-10-31" and set(rules.DATA_KINDS) <= set(data), json.dumps(data)[:300])
src = js.read_text(encoding="utf-8")
check("...only the block changed: everything outside the markers is as it was",
      src.split(rules.MARK_BEGIN)[0] == REAL.read_text(encoding="utf-8").split(rules.MARK_BEGIN)[0]
      and src.split(rules.MARK_END)[1] == REAL.read_text(encoding="utf-8").split(rules.MARK_END)[1])
check("...the server now sees them as in the site", rules.in_site("rooms", ["theRoom"], ROOM, data) and not rules.in_site("rooms", ["theRoom"], {"x": 1}, data))
again = tool.apply(text, js)
check("applied twice: nothing new, nothing written", not again["written"] and all(h == "same" for _, _, h in again["said"]))
ROOM2 = {**ROOM, "walls": "wood"}
got = tool.apply(rules.copy_text([{"kind": "rooms", "path": ["theRoom"], "body": ROOM2}], "2026-11-01"), js)
data = rules.read_block(js.read_text(encoding="utf-8"))
check("*** the same room saved again replaces the one there, the others kept ***", got["said"] == [("rooms", ["theRoom"], "replaced")]
      and data["rooms"]["theRoom"] == ROOM2 and data["town"]["nimrod"]["kingHall"] == PLACE)


def refused(t):
    before = js.read_bytes()
    try:
        tool.apply(t, js)
    except tool.Refused as e:
        return js.read_bytes() == before and str(e)
    return False


bad = {"format": "nimrod-defaults", "version": 1, "made": "", "backdrops": {"steampunk": {"a": 1}}}
check("*** an unknown kind (or one nothing reads, backdrops) is refused and NOTHING is written ***", refused(json.dumps(bad)))
bad = {"format": "nimrod-defaults", "version": 1, "rooms": {"theRoom": ROOM}, "screens": {"x": {"a": 1}}}
check("...even beside a good one", refused(json.dumps(bad)))
# (step 5d) A ready-made dashboard: the `dashboards` kind, [its key], shaped as dashboards.js reads it.
DASH = {"layout": {"preset": "full", "slots": ["people"], "placed": [{"ref": "helper", "place": "overlay", "x": 70, "y": 80}]},
        "settings": {"panelSurface": "solid"}}
got = tool.apply(rules.copy_text([{"kind": "dashboards", "path": ["people"], "body": DASH}], "2026-11-01"), js)
data = rules.read_block(js.read_text(encoding="utf-8"))
check("*** 5d: a ready-made dashboard is merged under `dashboards` [its key], the others kept ***",
      got["said"] == [("dashboards", ["people"], "new")] and data["dashboards"]["people"] == DASH and data["rooms"]["theRoom"] == ROOM2, str(got["said"]))
DASH2 = {"modules": {"people": {"show": "big"}}}
got = tool.apply(rules.copy_text([{"kind": "dashboards", "path": ["people"], "body": DASH2}], "2026-11-01"), js)
check("...saved again, it REPLACES the one there as a whole (what the owner saved last is the default, not a mix of the two)",
      got["said"] == [("dashboards", ["people"], "replaced")] and rules.read_block(js.read_text(encoding="utf-8"))["dashboards"]["people"] == DASH2)
check("*** a ready-made dashboard not shaped as one (a part it does not have, a slot by instance id) is refused, nothing written ***",
      refused(json.dumps({"format": "nimrod-defaults", "version": 1, "dashboards": {"people": {"kiosk": {"clock": 1}}}}))
      and refused(json.dumps({"format": "nimrod-defaults", "version": 1, "dashboards": {"people": {"layout": {"preset": "full", "slots": ["m 1"]}}}})))
check("a path that is not an id is refused", refused(json.dumps({"format": "nimrod-defaults", "version": 1, "rooms": {"the room!": ROOM}})))
check("a town place one level short is refused", refused(json.dumps({"format": "nimrod-defaults", "version": 1, "town": {"nimrod": ROOM}})))
check("a picture inside it is refused (storage_line's content rules)",
      refused(json.dumps({"format": "nimrod-defaults", "version": 1, "rooms": {"theRoom": {"img": "data:image/png;base64,AAAA"}}})))
check("not this format: refused", refused(json.dumps({"format": "other", "version": 1, "rooms": {"theRoom": ROOM}})))
check("not JSON: refused", refused("# nimrod site defaults\n{not json"))
e2, w2 = tool.split_copy(rules.copy_text([saves[3]], "2026-10-31"))
check("words only: no defaults part, the words kept", e2 is None and "Begin here" in w2)
p = tmp / "saved.txt"
p.write_text(json.dumps({"format": "nimrod-defaults", "version": 1, "screens": {"x": {"a": 1}}}), encoding="utf-8")
check("the command: a refusal exits 2", tool.main([str(p), "--defaults", str(js)]) == 2)
check("*** the real nimrod_defaults.js was never written ***", REAL.read_bytes() == real_before)

shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
