"""mark_very_easy.py - give pack questions marked "very easy" in a note the real difficulty "very easy".

Until 2026-10-06 a pack's `difficulty` could only be easy, medium or hard, so question writers filed the gentlest
questions under "easy" and said so in the item's `note` ("very easy: the game only knows easy/medium/hard, ...",
or just "very easy"). packs.js now reads "very easy" as a level of its own, below easy (DIFFICULTY_LEVELS). This
script moves those items over, and can be run again on new files: an item already converted is left alone.

For each `nimrod.pack.v1` file given (a file, or every *.json in a folder; by default web/client/packs and
web/client/packs_review), for every item (and every question inside a lesson item):
  * a `note` that starts with "very easy" (any case, "very_easy" and "veryeasy" too), on an item whose difficulty
    is easy or missing  ->  `difficulty: "very easy"`. The note is removed when it says nothing else (just the
    marker, or the marker and the old "the game only knows easy/medium/hard" explanation, which is no longer
    true); a note that says something more is kept as it is.
  * a difficulty spelled "very_easy", "veryeasy", "Very Easy" ...  ->  "very easy", the spelling packs.js writes.
  * a note saying "very easy" on an item marked medium or hard is NOT changed, only reported: two marks that
    disagree are for a person to settle.
  * a pack `description` that says "(filed as easy, marked in `note`)" loses those words, which stop being true.
Everything else in the item is kept as it is.

A file is rewritten only when something in it changed, as JSON with two-space indents (the layout the packs
are written in). A file laid out any other way is reported and left alone unless --reformat is given, so a
hand-laid-out pack never gets a whole-file diff by surprise.

Usage (from web/):
    py -3.13 tools/mark_very_easy.py                       # the default folders
    py -3.13 tools/mark_very_easy.py client/packs_review/new_pack.json
    py -3.13 tools/mark_very_easy.py --dry-run             # say what would change, write nothing
    py -3.13 tools/mark_very_easy.py --reformat some.json  # rewrite even a file laid out differently
Exit code: 0, or 1 when a file could not be read or written.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
DEFAULT_PATHS = [WEB / "client" / "packs", WEB / "client" / "packs_review"]
SCHEMA = "nimrod.pack.v1"
VERY_EASY = "very easy"

MARKER_RE = re.compile(r"^\s*very[\s_-]*easy\b\s*[:;,.\-]?\s*", re.IGNORECASE)
# What the old marker note said after "very easy:" - an explanation that is no longer true once converted.
OLD_EXPLANATION_RE = re.compile(r"only knows easy\s*/\s*medium\s*/\s*hard", re.IGNORECASE)
DESCRIPTION_RE = re.compile(r"\s*\(filed as easy, marked in `note`\)")


def flat(word) -> str:
    return re.sub(r"[\s_-]+", "", str(word or "").strip().lower())


def convert_item(item: dict, where: str, report: list[str]) -> bool:
    """Convert one item in place. True when it changed."""
    if not isinstance(item, dict):
        return False
    changed = False
    diff = item.get("difficulty")
    if isinstance(diff, str) and flat(diff) == "veryeasy" and diff != VERY_EASY:
        item["difficulty"] = VERY_EASY
        diff = VERY_EASY
        changed = True
        report.append(f"{where}: difficulty spelled {VERY_EASY!r}")
    note = item.get("note")
    if isinstance(note, str) and MARKER_RE.match(note):
        if diff in (None, "", "easy", VERY_EASY) or flat(diff) in ("easy", "veryeasy"):
            if diff != VERY_EASY:
                item["difficulty"] = VERY_EASY
                changed = True
                report.append(f"{where}: easy -> very easy")
            rest = MARKER_RE.sub("", note, count=1).strip()
            if not rest or OLD_EXPLANATION_RE.search(rest):
                del item["note"]
                changed = True
        else:
            report.append(f"{where}: NOT CHANGED - its note says very easy but its difficulty is {diff!r}")
    return changed


def convert_pack(pack: dict, name: str, report: list[str]) -> bool:
    changed = False
    items = pack.get("items")
    if not isinstance(items, list):
        return False
    for i, it in enumerate(items):
        if convert_item(it, f"{name} item {i}", report):
            changed = True
        for j, q in enumerate((it or {}).get("questions") or [] if isinstance(it, dict) else []):
            if convert_item(q, f"{name} item {i} question {j}", report):
                changed = True
    desc = pack.get("description")
    if changed and isinstance(desc, str) and DESCRIPTION_RE.search(desc):
        pack["description"] = DESCRIPTION_RE.sub("", desc)
    return changed


def dumps(pack: dict) -> str:
    return json.dumps(pack, indent=2, ensure_ascii=False) + "\n"


def files_in(paths: list[Path]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out.extend(sorted(x for x in p.glob("*.json") if x.is_file()))
        elif p.is_file():
            out.append(p)
        else:
            print(f"not found: {p}", file=sys.stderr)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("paths", nargs="*", type=Path, help="pack files or folders (default: client/packs, client/packs_review)")
    ap.add_argument("--dry-run", action="store_true", help="say what would change; write nothing")
    ap.add_argument("--reformat", action="store_true", help="rewrite a changed file even if laid out differently")
    args = ap.parse_args(argv)
    failed = 0
    total_files = total_items = 0
    for path in files_in(args.paths or DEFAULT_PATHS):
        try:
            raw = io.open(path, encoding="utf-8", newline="").read()
            pack = json.loads(raw)
        except (OSError, ValueError) as err:
            print(f"skipped (unreadable): {path}: {err}", file=sys.stderr)
            failed += 1
            continue
        if not isinstance(pack, dict) or pack.get("schema") != SCHEMA:
            continue
        same_layout = dumps(pack) == raw.replace("\r\n", "\n")
        report: list[str] = []
        if not convert_pack(pack, path.name, report):
            for line in report:
                print(line)
            continue
        n = sum(1 for line in report if line.endswith("-> very easy") or "spelled" in line)
        for line in report:
            print(line)
        if not same_layout and not args.reformat:
            print(f"LEFT ALONE: {path} is not laid out as two-space JSON; run again with --reformat to rewrite it")
            continue
        total_files += 1
        total_items += n
        if args.dry_run:
            print(f"would write {path} ({n} items)")
            continue
        text = dumps(pack)
        if "\r\n" in raw:
            text = text.replace("\n", "\r\n")
        try:
            io.open(path, "w", encoding="utf-8", newline="").write(text)
            print(f"wrote {path} ({n} items)")
        except OSError as err:
            print(f"could not write {path}: {err}", file=sys.stderr)
            failed += 1
    print(f"{'would change' if args.dry_run else 'changed'} {total_items} items in {total_files} files")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
