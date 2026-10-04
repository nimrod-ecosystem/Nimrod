"""pack_reviews.py - REVIEW BY PLAYING: which question packs are waiting for review, and the account's log
of what a person said about each question.

Mike, 2026-10-03, about the AI-written question packs claude_questions.py writes into packs_local/:
"Can I just play through and pass them? Maybe even play with [the person the screen is for] and just say
if any are wrong?"

TWO THINGS LIVE HERE, BOTH SMALL:

1. `list_unreviewed(folders)` - the packs whose `review.status` is "unreviewed", in two folders:
     web/client/packs_review/  TRACKED and deployed: drafts somebody decided to put up for review on the
                               real site. Moving a file here is the act of publishing it for review.
     web/client/packs_local/   NOT tracked (packs.js: the folder that "stays personal"), and where
                               claude_questions.py writes. Listed too, so a draft can be played on the
                               machine that wrote it; it simply does not exist on the deployed site.
   WHY A THIRD FOLDER, argued: packs/ means "cleared to ship" (MIT-clean, listed in pack_library.js), and
   these are not cleared. packs_local/ means "personal", and committing it would put everything anybody
   ever drops there - share-alike material included - on a public site by default. "Shipped, but
   unreviewed" is a third state, so it gets its own folder, and its name says which state it is.
   A browser cannot list a directory, and pack_library.js is a hand-kept list that must NOT name these
   files (test_claude_ai.py checks it does not), so the server lists them. Same exposure as
   /api/dev/test-pages: bare names of files this site already serves to anybody.
   Only packs that say "unreviewed" are listed - packs_local/ also holds share-alike material that is not
   "waiting for review", just private.

2. `clean_review(kind, data)` - one row of the ACCOUNT's review log (app.py: the reserved `_account`
   scope, stream `question-reviews`). Append-only, like the contests log it copies (contests.js): two
   devices reviewing at once can never undo each other, and the history of who said what stays.
   Kinds:
     pass    the question was played through (or "fine" was pressed) and nobody said it was wrong
     flag    somebody said it is wrong; it is never dealt again until somebody puts it back
     note    what is wrong with it, in that person's words (may follow a flag)
     unflag  "fixed - ask it again": a person put it back
   The key is the client's contestKey (question + right answer, normalised, hashed) - a question has no
   id in a pack, and a fixed question or answer is a new question that needs reviewing again.

WHO AND WHEN ARE THE SERVER'S, NEVER THE BROWSER'S: app.py stamps `by` (the account's display name for a
signed-in device, or "a screen" for one signed in with a device key) and `at` (the server's clock). A
browser can say WHERE ("place", e.g. which dashboard) - that is a fact it knows - but not who.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REVIEW_STREAM = "question-reviews"
REVIEW_KINDS = ("pass", "flag", "note", "unflag")
PACK_ID_PREFIX = "review:"

# Sizes, argued: a question in the shipped packs runs to ~150 characters and an answer to ~60, so the
# caps are generous multiples that still stop a runaway client writing a novel into the account's log.
# Not settings - nobody tunes how long a stored question may be - but stated here, in one place.
MAX_QUESTION = 600
MAX_ANSWER = 300
MAX_NOTE = 1000
MAX_PLACE = 80
MAX_PACK_FILE_BYTES = 2_000_000      # a 200-question pack is ~100 KB; anything this big is not one

KEY_RE = re.compile(r"^c-[0-9a-z]{1,13}$")
PACK_ID_RE = re.compile(r"^review:[a-z0-9][a-z0-9_.-]{0,99}$")
STEM_RE = re.compile(r"[^a-z0-9_.-]+")


def pack_id_for(path: Path) -> str:
    """The stable id a Trivia panel stores for this file: `review:<file stem>`, lowercased."""
    stem = STEM_RE.sub("_", path.stem.lower()).strip("_.-") or "pack"
    return PACK_ID_PREFIX + stem[:100]


def list_unreviewed(folders) -> list[dict]:
    """Every pack that says it is unreviewed, in `folders` (one Path or a list, each served at
    `/<folder name>/`), folder by folder, sorted by file name. Never raises: a broken file is skipped,
    because one bad draft must not hide the others. A file whose id an earlier folder already listed is
    skipped, so moving a draft from packs_local/ to packs_review/ keeps its id - and its reviews."""
    out: list[dict] = []
    if isinstance(folders, (str, Path)):
        folders = [folders]
    files: list[Path] = []
    for folder in folders:
        try:
            files.extend(sorted(p for p in Path(folder).glob("*.json") if p.is_file()))
        except OSError:
            continue
    seen: set[str] = set()
    for p in files:
        try:
            if p.stat().st_size > MAX_PACK_FILE_BYTES:
                continue
            pack = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(pack, dict) or pack.get("schema") != "nimrod.pack.v1":
            continue
        review = pack.get("review")
        if not isinstance(review, dict) or review.get("status") != "unreviewed":
            continue
        items = pack.get("items")
        if not isinstance(items, list) or not items:
            continue
        pid = pack_id_for(p)
        if pid in seen:          # two files that lowercase to one id: the first wins, the id stays stable
            continue
        seen.add(pid)
        out.append({
            "id": pid,
            "file": p.name,
            "url": f"/{p.parent.name}/{p.name}",
            "kind": str(pack.get("kind") or ""),
            "name": str(pack.get("name") or p.stem)[:200],
            "count": len(items),
        })
    return out


def _text(data: dict, field: str, limit: int, *, required: bool = False) -> str:
    v = data.get(field, "")
    if v is None:
        v = ""
    if not isinstance(v, str):
        raise ValueError(f"{field} must be text")
    v = re.sub(r"\s+", " ", v).strip()
    if required and not v:
        raise ValueError(f"{field} is required")
    if len(v) > limit:
        raise ValueError(f"{field} is longer than {limit} characters")
    return v


def clean_review(kind: str, data: dict) -> dict:
    """The row as it will be stored, minus `by`/`at` (app.py adds those). Raises ValueError, in plain
    words, for anything that is not a review row."""
    if kind not in REVIEW_KINDS:
        raise ValueError(f"kind must be one of {', '.join(REVIEW_KINDS)}")
    if not isinstance(data, dict):
        raise ValueError("data must be an object")
    key = data.get("key")
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise ValueError("key must be a question key (c-...)")
    row: dict = {"key": key}
    pack = data.get("pack", "")
    if pack:
        if not isinstance(pack, str) or not PACK_ID_RE.match(pack):
            raise ValueError("pack must be a review pack id (review:...)")
        row["pack"] = pack
    if kind in ("pass", "flag"):
        # The readable question rides with the verdict, so the review page and the export can show it
        # even if the pack file later changes or goes away.
        row["question"] = _text(data, "question", MAX_QUESTION, required=True)
        row["answer"] = _text(data, "answer", MAX_ANSWER)
    note = _text(data, "note", MAX_NOTE, required=(kind == "note"))
    if note:
        row["note"] = note
    place = _text(data, "place", MAX_PLACE)
    if place:
        row["place"] = place
    return row
