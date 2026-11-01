#!/usr/bin/env python3
"""apply_site_defaults.py - PUT THE SITE DEFAULTS AN OWNER SAVED INTO THE SITE'S CODE (row 2.145 step 5c, 2026-10-31).

Mike's go on the one editor (row 2.145, DN 1): the site's defaults are kept in the repo. One of the site's owners presses
"Save as the site default" in the editor (the server keeps it waiting, web/server/site_defaults.py), then "Copy the saved
defaults", and hands Code the text. This puts it in:

    py -3.13 web/tools/apply_site_defaults.py saved.txt [--dry-run] [--no-words] [--defaults PATH]

  * THE DEFAULTS (the JSON entry under "# nimrod site defaults"): each room, village scene, Town place and (step 5d)
    ready-made dashboard is merged into the data block of web/client/nimrod_defaults.js (between its marker lines: plain
    JSON), replacing the one there for the same thing. (A ready-made dashboard's entry is replaced WHOLE: it is the
    dashboard as the owner saved it, never a mix of two saves. dashboards_test checks every one the site ships against
    dashboards.js recordProblems, so one that would not make a sound dashboard fails a suite, not a screen.) Anything that is not one of those kinds, or not shaped like one, is REFUSED and nothing is written -
    the same checks the server made (site_defaults.clean_entry), made again, since the text passed through a clipboard.
  * THE WORDS (the lines under "# nimrod wording changes"): written beside the input as <name>.words.tsv and handed to
    web/tools/export_site_text.py --apply-page-edits, which finds each line in the code by its words and refuses what
    would need a guess (that tool says why). --no-words leaves them for later.

It never commits. Code reads the change (git diff) against what the editor showed, then commits it; the site shows it after
the next deploy. Then the owner withdraws the entries from the waiting list (the list marks the ones the site now ships).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "web" / "server"))
import site_defaults as rules  # noqa: E402  (pure: the same checks and markers the server uses)

DEFAULTS_JS = REPO / "web" / "client" / "nimrod_defaults.js"

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class Refused(Exception):
    pass


def split_copy(text: str):
    """The copied text in its two parts: (the defaults entry as a dict, or None; the words as TSV text, or None)."""
    entry, words = None, None
    lines = (text or "").replace("\r\n", "\n").split("\n")
    w0 = next((i for i, ln in enumerate(lines) if ln.startswith(rules.WORDS_HEAD)), None)
    head = lines if w0 is None else lines[:w0]
    if w0 is not None:
        rows = [ln for ln in lines[w0:] if ln.strip()]
        if any(not ln.startswith("#") for ln in rows):
            words = "\n".join(lines[w0:]).rstrip("\n") + "\n"
    body = "\n".join(ln for ln in head if not ln.startswith("#")).strip()
    if body:
        try:
            entry = json.loads(body)
        except ValueError as e:
            raise Refused(f"the defaults part is not JSON ({e})")
        if not isinstance(entry, dict):
            raise Refused("the defaults part is not one entry (an object)")
    return entry, words


def leaves(entry: dict):
    """Every (kind, path, body) in an entry, checked as the server checks them. Raises Refused on the first bad one."""
    if entry.get("format") != rules.FORMAT or entry.get("version") != rules.VERSION:
        raise Refused(f"not a {rules.FORMAT} entry, version {rules.VERSION}")
    out = []
    for kind, tree in entry.items():
        if kind in ("format", "version", "made"):
            continue
        if kind not in rules.KINDS:
            raise Refused(f"'{kind}' is not a kind of site default this applies (only {', '.join(sorted(rules.KINDS))})")
        depth = rules.KINDS[kind]

        def walk(node, path):
            if len(path) == depth:
                try:
                    e = rules.clean_entry(kind, path, node)
                except rules.Refused as r:
                    raise Refused(f"{kind}/{'/'.join(path)}: {r.detail}")
                out.append((e["kind"], e["path"], e["body"]))
                return
            if not isinstance(node, dict) or not node:
                raise Refused(f"{kind}/{'/'.join(path) or '(top)'}: not shaped like a {kind} entry")
            for k, v in node.items():
                walk(v, path + [k])

        walk(tree, [])
    return out


def merge(data: dict, items, made: str = ""):
    """`data` (the file's block) with every item put in. -> (new data, [(kind, path, 'new'|'replaced'|'same')])."""
    data = json.loads(json.dumps(data))
    said = []
    for kind, path, body in items:
        node = data.setdefault(kind, {})
        for p in path[:-1]:
            node = node.setdefault(p, {})
        old = node.get(path[-1])
        how = "new" if old is None else ("same" if json.dumps(old, sort_keys=True) == json.dumps(body, sort_keys=True) else "replaced")
        node[path[-1]] = body
        said.append((kind, path, how))
    for k in rules.DATA_KINDS:
        data.setdefault(k, {})
    if made and any(h != "same" for _, _, h in said):
        data["made"] = made
    return data, said


def apply(text: str, defaults_js: Path = DEFAULTS_JS, dry_run: bool = False, today: str = "") -> dict:
    """Merge the defaults part of `text` into `defaults_js`. -> {"said": [...], "words": tsv or None, "written": bool}.
    Raises Refused (nothing written) on anything it cannot apply exactly."""
    entry, words = split_copy(text)
    said, written = [], False
    if entry is not None:
        items = leaves(entry)
        src = defaults_js.read_text(encoding="utf-8")
        data = rules.read_block(src)
        if data is None:
            raise Refused(f"{defaults_js.name} has no data block between its markers")
        new, said = merge(data, items, made=str(entry.get("made") or today or date.today().isoformat()))
        if not dry_run and new != data:
            defaults_js.write_text(rules.write_block(src, new), encoding="utf-8", newline="\n")
            written = True
    return {"said": said, "words": words, "written": written}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Put the site defaults an owner saved into the site's code.")
    ap.add_argument("saved", help="the text 'Copy the saved defaults' copied, in a file")
    ap.add_argument("--dry-run", action="store_true", help="say what would change; write nothing")
    ap.add_argument("--no-words", action="store_true", help="leave the words for later")
    ap.add_argument("--defaults", default=str(DEFAULTS_JS), help="the defaults file (default: web/client/nimrod_defaults.js)")
    a = ap.parse_args(argv)
    src = Path(a.saved)
    try:
        got = apply(src.read_text(encoding="utf-8-sig"), Path(a.defaults), dry_run=a.dry_run)
    except Refused as e:
        print(f"REFUSED, nothing written: {e}")
        return 2
    for kind, path, how in got["said"]:
        print(f"{'would be ' if a.dry_run and how != 'same' else ''}{how:9} {kind}/{'/'.join(path)}")
    if not got["said"]:
        print("no defaults in it")
    elif got["written"]:
        print(f"written: {a.defaults}")
    if got["words"]:
        tsv = src.with_name(src.stem + ".words.tsv")
        tsv.write_text(got["words"], encoding="utf-8", newline="\n")
        if a.no_words:
            print(f"words left for later: {tsv} (py -3.13 web/tools/export_site_text.py --apply-page-edits {tsv})")
        else:
            print(f"words: {tsv} -> export_site_text.py --apply-page-edits")
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import export_site_text  # noqa: E402  (heavy: only when there are words)
            export_site_text.apply_page_edits(str(tsv), dry_run=a.dry_run)
    print("Nothing is committed: read the change, then commit it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
