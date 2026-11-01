"""site_defaults.py - THE SITE'S DEFAULTS OUTBOX: what an owner saved, checked, waiting for Code (row 2.145 step 5c).
Tested: test_site_defaults.py.

Mike's go on "the one editor" (row 2.145, DN 1): the site's defaults are kept IN THE REPO. So an owner's "Save as the site
default" in the editor does NOT change the site. It queues a checked entry here (the `site_default_saves` table, db.py),
and "Copy the saved defaults" copies them all as one text. Code applies that text with web/tools/apply_site_defaults.py
(the defaults) and web/tools/export_site_text.py --apply-page-edits (the words) and commits it, reviewed like any code.
Visitors and every screen see nothing until that commit is deployed. (A server that opens a pull request itself is
"B2": not built, and only on Mike's yes.)

THE RULES:
  1. ONLY AN OWNER (site_owner.py), checked in EVERY route that reads or writes here - never the page's word for it.
  2. NOTHING IS TRUSTED FROM THE PAGE. Every entry is checked here again, whatever the editor already checked:
       kinds     rooms [preset], village [scene], town [deck, place], dashboards [ready-made key] (step 5d) - the
                 kinds nimrod_defaults.js has and something reads (DEFAULT_KINDS there; `backdrops` is read by nothing
                 yet, so it is refused rather than kept for nothing)
       a path    exactly as deep as its kind, each part an id (letters, digits, - and _, as every id on this site)
       a body    an object, no deeper than DEPTH_MAX, no bigger than ENTRY_MAX_BYTES, and storage_line.py's content
                 rules (no picture, sound or video inside it)
       a ready-  (`dashboards`, step 5d) shaped as dashboards.js reads it: only `layout`, `modules` and `settings`;
       made one  a layout's slots refs or null and its placed panels each with a ref; modules keyed by ref, each an
                 object; settings plain values. Whether the refs are the ready-made one's own is the client's check
                 (dashboards.js recordProblems, before the save and again when a dashboard is made from it): the
                 server does not know the ready-made dashboards, which are code.
       words     a page (a path on this site) and the words on it and the new words: plain text, one line, at most
                 LINE_MAX letters; never < > ` ${ a control character or a data: address (they are going into code)
  3. ONE WAITING ENTRY PER THING. Saving the same room (or the same words on the same page) again replaces what was
     waiting for it, so the list is what to apply, not a history of every press.
  4. A LIMIT ON WHAT IS WAITING (WAITING_MAX). Past it a save is refused with a sentence, never dropped.

THE NUMBERS (Rule 1, 2026-09-11):
  ENTRY_MAX_BYTES 64 KiB  FOR: town_edits.js keeps a place's recipe to RECIPE_MAX_BYTES (16 KiB, "a built-in recipe is
      about 1 KB; 40 things with every field set is about 5 KB"); a village holds up to PIECES_MAX (120) pieces, about
      15-20 KB written out. 64 KiB is four times the town's own backstop and clears the fullest village. AGAINST: the
      state rows' own cap (storage_line.STATE_MAX_BYTES, 2 MiB) would also do, and is one number fewer - but this text
      becomes a line of the site's code, which nobody should be asked to review at two megabytes. (Step 5d: a ready-made
      dashboard's entry is its layout and a few panels' starting settings, a few KB; one holding a village panel's own
      scene is the village's size again, still under it.)
  DEPTH_MAX 12  A room recipe nests about five deep (the room, its items, an item, its look, a colour). Twelve is over
      twice that; deeper is not a recipe.
  WAITING_MAX 200  FOR: by rule 3 each thing has at most one entry, and the site has about forty defaults today (five
      rooms, the villages' scenes, each town's places); retyping a page's words is tens of lines. 200 holds all of that
      several times over before anybody applies it. AGAINST: an owner retyping words across the whole site at once
      could pass it; then the refusal says to have the waiting ones applied (or withdraw some) first. At most
      200 x 64 KiB (about 13 MB) for the whole site, written only by its owners.
  LINE_MAX 300  reused: web/client/wording_edit.js LINE_MAX, the one line of words the editor keeps.
"""
from __future__ import annotations

import json
import re

import storage_line

KINDS = {"rooms": 1, "village": 1, "town": 2, "dashboards": 1}   # kind -> how many parts its path has (nimrod_defaults.js)
DASHBOARD_PARTS = ("layout", "modules", "settings")                # dashboards.js prebuiltRecord reads these
WORDS = "words"
ENTRY_MAX_BYTES = 64 * 1024
DEPTH_MAX = 12
WAITING_MAX = 200
LINE_MAX = 300
FORMAT = "nimrod-defaults"                          # web/client/nimrod_defaults.js DEFAULTS_FORMAT
VERSION = 1                                         # web/client/nimrod_defaults.js DEFAULTS_VERSION
DEFAULTS_HEAD = "# nimrod site defaults (saved by the site's owners)"
WORDS_HEAD = "# nimrod wording changes (site words edited in place)"   # wording_edit.js COPY_HEAD

_PART_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_PAGE_RE = re.compile(r"^/[A-Za-z0-9._~/-]{0,200}$")
_REFUSED_IN_WORDS = re.compile(r"[<>`\x00-\x1f\x7f  ]|\$\{|data:", re.I)

SAY_NOT_OWNER = "Only the site's owners can save the site's defaults. Your own changes are kept as yours."
SAY_KIND = ("That is not a kind of site default that can be saved (rooms, village scenes, Town's places and ready-made "
            "dashboards can).")
SAY_DASHBOARD = ("A ready-made dashboard's default is its layout, its panels' starting settings and its look, each "
                 "named by the ready-made one's own names for its panels.")
SAY_PATH = "That is not a place for a site default."
SAY_BODY = "A site default has to be the thing's settings, as an object."
SAY_DEEP = f"That is nested more than {DEPTH_MAX} deep, which no site default is."
SAY_WORDS = ("Words are saved as plain text on one line, at most {n} letters, without < > ` ${{ or data: in them "
             "(they are going into the site's code).").format(n=LINE_MAX)
SAY_PAGE = "Words are saved with the page they are on (a path on this site)."
SAY_FULL = (f"{WAITING_MAX} saved defaults are already waiting to be put into the site. Have those applied first, or "
            "withdraw some.")


class Refused(Exception):
    """A save refused. `status` is the HTTP code; `detail` the sentence a person reads."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _depth(v, d=0) -> int:
    if d > DEPTH_MAX:
        return d
    if isinstance(v, dict):
        return max([d] + [_depth(x, d + 1) for x in v.values()])
    if isinstance(v, list):
        return max([d] + [_depth(x, d + 1) for x in v])
    return d


def clean_entry(kind, path, body) -> dict:
    """A default entry checked (rule 2): {"kind", "path": [..], "body": {..}}. Raises Refused."""
    if not isinstance(kind, str) or kind not in KINDS:
        raise Refused(400, SAY_KIND)
    if not isinstance(path, list) or len(path) != KINDS[kind] or not all(isinstance(p, str) and _PART_RE.fullmatch(p) for p in path):
        raise Refused(400, SAY_PATH)
    if not isinstance(body, dict) or not body:
        raise Refused(400, SAY_BODY)
    if _depth(body) > DEPTH_MAX:
        raise Refused(400, SAY_DEEP)
    size = storage_line.row_bytes(body)
    if size > ENTRY_MAX_BYTES:
        raise Refused(413, f"This is too big to save as a site default: {size / 1024:,.0f} KB, and the most one can be "
                           f"is {ENTRY_MAX_BYTES / 1024:,.0f} KB.")
    try:
        storage_line.check_content(body)
    except storage_line.Refused as e:
        raise Refused(e.status, e.detail)
    if kind == "dashboards" and not _dashboard_shaped(body):
        raise Refused(400, SAY_DASHBOARD)
    return {"kind": kind, "path": list(path), "body": json.loads(json.dumps(body))}


def _is_ref(v) -> bool:
    return isinstance(v, str) and bool(_PART_RE.fullmatch(v))


def _dashboard_shaped(body: dict) -> bool:
    """A `dashboards` body as dashboards.js reads it (rule 2, step 5d): only its three parts, each the right shape."""
    if any(k not in DASHBOARD_PARTS for k in body):
        return False
    lay = body.get("layout")
    if lay is not None:
        if not isinstance(lay, dict) or not isinstance(lay.get("preset"), str) or not _PART_RE.fullmatch(lay["preset"]):
            return False
        slots = lay.get("slots", [])
        if not isinstance(slots, list) or not all(s is None or _is_ref(s) for s in slots):
            return False
        placed = lay.get("placed", [])
        if not isinstance(placed, list) or not all(isinstance(p, dict) and _is_ref(p.get("ref")) and "id" not in p
                                                   for p in placed):
            return False
        if "scene" in lay and not isinstance(lay["scene"], dict):
            return False
    mods = body.get("modules")
    if mods is not None and (not isinstance(mods, dict) or not all(_is_ref(r) and isinstance(s, dict) for r, s in mods.items())):
        return False
    sets = body.get("settings")
    if sets is not None and (not isinstance(sets, dict)
                             or not all(isinstance(k, str) and (v is None or isinstance(v, (str, int, float, bool)))
                                        for k, v in sets.items())):
        return False
    return True


def _one_line(s) -> str | None:
    """Words as one line (every run of spaces one space, trimmed), or None when they are not plain words (rule 2)."""
    if not isinstance(s, str):
        return None
    if _REFUSED_IN_WORDS.search(s.replace("\n", " ").replace("\t", " ").replace("\r", " ")):
        return None
    t = " ".join(s.split())
    return t if 0 < len(t) <= LINE_MAX else None


def clean_words(rows) -> list[dict]:
    """Words changed on pages, checked (rule 2): [{"page", "old", "new"}]. Raises Refused on the first bad row."""
    if not isinstance(rows, list) or not rows or len(rows) > WAITING_MAX:
        raise Refused(400, SAY_WORDS)
    out = []
    for r in rows:
        if not isinstance(r, dict):
            raise Refused(400, SAY_WORDS)
        page = r.get("page")
        if not isinstance(page, str) or not _PAGE_RE.fullmatch(page) or "//" in page or ".." in page:
            raise Refused(400, SAY_PAGE)
        old, new = _one_line(r.get("old")), _one_line(r.get("new"))
        if old is None or new is None or old == new:
            raise Refused(400, SAY_WORDS)
        out.append({"page": page, "old": old, "new": new})
    return out


def entry_key(kind: str, path: list) -> str:
    """What makes two entries the same thing (rule 3): the kind and its path, as stored (JSON)."""
    return json.dumps([kind, *path], ensure_ascii=False, separators=(",", ":"))


# ------------------------------------------------------------------------------------------------------------------------
# THE SHIPPED FILE. web/client/nimrod_defaults.js keeps its data between two marker lines as PLAIN JSON, so the apply tool
# merges into it deterministically and this server can say which waiting entries are already in the site.
MARK_BEGIN = "// nimrod-defaults:begin"
MARK_END = "// nimrod-defaults:end"
DATA_KINDS = ("rooms", "town", "village", "backdrops", "dashboards")     # nimrod_defaults.js DEFAULT_KINDS
_BLOCK_RE = re.compile(re.escape(MARK_BEGIN) + r"[^\n]*\n(.*?)\n[ \t]*" + re.escape(MARK_END), re.S)


def read_block(text: str):
    """The JSON between the markers of nimrod_defaults.js, or None when it is not there or not JSON."""
    m = _BLOCK_RE.search(text or "")
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def write_block(text: str, data: dict) -> str:
    """`text` with the JSON between the markers replaced by `data` (two spaces, keys in a fixed order). Raises
    ValueError when the markers are not there."""
    m = _BLOCK_RE.search(text or "")
    if not m:
        raise ValueError("nimrod_defaults.js has no data block between its markers")
    body = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True)
    return text[:m.start(1)] + body + text[m.end(1):]


def in_site(kind: str, path: list, body, shipped) -> bool:
    """Whether the shipped defaults already hold exactly this entry (so it has been applied and deployed)."""
    node = shipped.get(kind) if isinstance(shipped, dict) else None
    for p in path:
        node = node.get(p) if isinstance(node, dict) else None
    return node is not None and json.dumps(node, sort_keys=True) == json.dumps(body, sort_keys=True)


def copy_text(saves: list[dict], date: str = "") -> str:
    """The text "Copy the saved defaults" copies: the defaults as ONE nimrod_defaults entry (every waiting one merged, in
    the order saved), then the words in wording_edit.js's own copied format (what --apply-page-edits reads). Either part
    is left out when nothing of it is waiting. web/tools/apply_site_defaults.py reads it."""
    merged: dict = {}
    words = []
    for s in saves:
        if s.get("kind") == WORDS:
            b = s.get("body") or {}
            words.append(b)
            continue
        node = merged.setdefault(s["kind"], {})
        path = list(s.get("path") or [])
        for p in path[:-1]:
            node = node.setdefault(p, {})
        if path:
            node[path[-1]] = s.get("body")
    parts = []
    if merged:
        entry = {"format": FORMAT, "version": VERSION, "made": date, **merged}
        parts.append(f"{DEFAULTS_HEAD}{', ' + date if date else ''}\n"
                     "# Code: py -3.13 web/tools/apply_site_defaults.py <this file>, then read the change and commit it.\n"
                     + json.dumps(entry, indent=2, ensure_ascii=False) + "\n")
    if words:
        cell = lambda t: str(t).replace("\t", " ").replace("\r", "").replace("\n", "\\n")  # noqa: E731
        lines = [f"{WORDS_HEAD}{', ' + date if date else ''}", "# page\twords on the page\tnew words"]
        lines += [f"{cell(w.get('page', ''))}\t{cell(w.get('old', ''))}\t{cell(w.get('new', ''))}" for w in words]
        parts.append("\n".join(lines) + "\n")
    return "\n".join(parts)
