"""claude_questions.py - A BANK OF QUIZ QUESTIONS, WRITTEN AHEAD OF TIME BY CLAUDE, THROUGH THE BATCH API.

Mike's split (claude_ai.py, "the models"): question writing is Opus 5.5's job, done in advance at the
Batch API's half price, because quality is the whole job and nobody is waiting for it.

    py -3.13 claude_questions.py submit  --account <account id> --topic "Birds of Ohio" [--count 20]
    py -3.13 claude_questions.py collect --account <account id> --batch <msgbatch_...> [--topic "..."] [--out PATH]

`--account` uses THAT ACCOUNT'S saved key and model choice, checks its daily cap before submitting, and
counts what the results cost against its day. Run it where the server's database is (DATABASE_URL or
NIMROD_DB, and NIMROD_AI_KEY_SECRET, as the server has them). `--env-key` instead uses the Anthropic
SDK's own credentials on this machine (ANTHROPIC_API_KEY or `ant auth login`) and counts nothing.

*** WHAT IT WRITES IS A DRAFT, NOT CONTENT. *** A `nimrod.pack.v1` trivia pack, marked AI-written and
"unreviewed" in three places (the name, `source.name`, `review.status`) and on every item, saved into
`web/client/packs_local/` - the folder packs.js keeps for material that is not cleared to ship - and
NOT added to pack_library.js, so no game loads it until a person has checked every question and
answer and listed it. A wrong "correct" answer taught as fact is worse than no question.

*** EVERY QUESTION NAMES ITS SOURCE (Mike, 2026-10-04: "Shouldn't the sources be noted when the questions
are made?"). *** The structured-output schema requires a `source` on every item (a reference work, a link,
or "common knowledge" with a reason); `clean_items` drops - and counts - any whose source is not one, with
the same rule packs.js enforces on an AI-written pack. What Claude names is still unchecked: the reviewer
sees it beside each question (pack_reviews.js) and is the one who checks it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import claude_ai as C

PER_REQUEST = 10                 # questions per batch request: a long list drifts and repeats itself
MAX_COUNT = 200
QUIZ_MAX_TOKENS = 16000
OUT_DIR = Path(__file__).resolve().parent.parent / "client" / "packs_local"
# "very easy" (2026-10-06, Mike: "even easier questions for children"): the client's packs.js reads it as the
# level below easy. Written with a space, the way packs.js writes it.
DIFFICULTIES = ("very easy", "easy", "medium", "hard")

SYSTEM = (
    "You write multiple-choice quiz questions for a website of games and learning used by people of every "
    "age and ability. Every question has exactly ONE correct answer that is well established and not "
    "disputed; if you are not certain a fact is right, leave it out and write a different question. Give "
    "exactly four answers: the correct one and three wrong ones of the same kind, plausible but clearly "
    "wrong to somebody who knows. Plain, short words. No trick questions, no 'all of the above', no "
    "questions about private individuals, nothing frightening or upsetting. For each, one plain sentence "
    "saying why the answer is right. Mark each very easy (a young child could answer it), easy, medium "
    "or hard.\n\n"
    "Every question names its SOURCE: where a person could check that the answer is right. Prefer a named "
    "reference work and entry in `ref` (for example: Encyclopaedia Britannica, \"Giraffe\"; or the official "
    "state website for Ohio). Put a link in `url` only when you are confident that exact page exists; never "
    "make up a link, and leave `url` empty rather than guess. `title` is the page or entry's name, or empty. "
    "Only for a fact nearly every child knows (a baby dog is a puppy) may `ref` be \"common knowledge\", and "
    "then `note` must say why no reference is needed. If you cannot name a source for a fact, leave that "
    "question out and write a different one: a question without a source is thrown away."
)

# PER-ITEM SOURCES (packs.js "PER-ITEM SOURCES", docs/PACK_SCHEMA.md). Every field is required and may be
# empty, so structured output always returns the same four keys; clean_source decides whether what came
# back is a source at all, and an item whose source is not one is dropped and counted.
SOURCE_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {"type": "string"},
        "ref": {"type": "string"},
        "title": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["url", "ref", "title", "note"],
    "additionalProperties": False,
}
COMMON_KNOWLEDGE = "common knowledge"
NO_SOURCE = "no source"          # the prefix of every "dropped for having no source" line, so it can be counted
# The same list packs.js refuses: words that answer "where is this from?" with nothing.
NOT_A_SOURCE = {"certain", "sure", "known", "well known", "memory", "from memory", "my memory", "my own knowledge",
                "own knowledge", "general knowledge", "unknown", "none", "n/a", "na", "-", "ai", "claude"}
_URL_RE = re.compile(r"^https?://\S+$", re.I)

ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "answers": {"type": "array", "items": {"type": "string"}},
                    "correct": {"type": "string"},
                    "difficulty": {"type": "string", "enum": list(DIFFICULTIES)},
                    "explain": {"type": "string"},
                    "source": SOURCE_SCHEMA,
                },
                "required": ["question", "answers", "correct", "difficulty", "explain", "source"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


def slug_of(topic: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(topic or "").lower()).strip("_")
    return (s or "topic")[:40]


def build_batch_requests(topic: str, count: int, model: str) -> list[dict]:
    """The batch: one request per PER_REQUEST questions. custom_id carries the slug and the part, so
    results (which arrive in any order) are keyed by it, never by position."""
    topic = re.sub(r"\s+", " ", str(topic or "")).strip()
    if not topic or len(topic) > 200:
        raise ValueError("a topic is 1 to 200 characters")
    if not (1 <= int(count) <= MAX_COUNT):
        raise ValueError(f"between 1 and {MAX_COUNT} questions")
    if model not in C.QUIZ_MODELS:
        raise ValueError("not one of the models offered for writing questions")
    count = int(count)
    parts = [PER_REQUEST] * (count // PER_REQUEST) + ([count % PER_REQUEST] if count % PER_REQUEST else [])
    slug = slug_of(topic)
    out = []
    for i, k in enumerate(parts):
        params = {
            "model": model,
            "max_tokens": QUIZ_MAX_TOKENS,
            # The same system text on every request, marked for the cache: the batch's requests share it.
            "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content":
                          f"Topic: {topic}\nWrite {k} questions on this topic. This is part {i + 1} of {len(parts)}; "
                          f"other parts are written separately, so pick a varied spread across the topic rather "
                          f"than its most famous facts. Aim for a mix: a few very easy, then about a third each easy, medium and hard."}],
            "output_config": {"format": {"type": "json_schema", "schema": ITEM_SCHEMA}},
        }
        if model != "claude-haiku-4-5":
            # Opus 5.5 / Sonnet 5.5: adaptive thinking is on by default; quality is the job, so effort
            # is set to high explicitly (Opus 5.5's default is medium). No `fallbacks`: the Batch API
            # rejects it.
            params["output_config"]["effort"] = "high"
        out.append({"custom_id": f"{slug}--{i + 1:03d}", "params": params})
    return out


def worst_case(requests: list[dict]) -> float:
    return sum(C.worst_case_usd(r["params"]["model"], len(SYSTEM) + len(r["params"]["messages"][0]["content"]),
                                r["params"]["max_tokens"], batch=True) for r in requests)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def _one_line(v) -> str:
    return re.sub(r"\s+", " ", v).strip() if isinstance(v, str) else ""


def clean_source(raw):
    """An item's source as the pack stores it ({url?, ref?, title?, note?} with only what is there; a list for
    several), or None when it is not a source: nothing given, a link that is not http(s) with no reference
    beside it, a bare non-answer ("certain", "from memory"), or "common knowledge" with no reason. The same
    rule as packs.js `itemSourceProblem`, so what this keeps, the site loads."""
    if isinstance(raw, list):
        got = [clean_source(s) for s in raw]
        return got if got and all(g is not None for g in got) else None
    if isinstance(raw, str):
        s = _one_line(raw)
        if not s or s.lower() == COMMON_KNOWLEDGE or s.lower() in NOT_A_SOURCE:
            return None
        return {"url": s} if _URL_RE.match(s) else {"ref": s}
    if not isinstance(raw, dict):
        return None
    url, ref, title, note = (_one_line(raw.get(f)) for f in ("url", "ref", "title", "note"))
    if url and not _URL_RE.match(url):
        url = ""                 # a broken link is not kept; a reference beside it still can be
    if not url and not ref:
        return None
    if not url and ref.lower() == COMMON_KNOWLEDGE and not note:
        return None
    if not url and ref.lower() in NOT_A_SOURCE:
        return None
    return {k: v for k, v in (("url", url), ("ref", ref), ("title", title), ("note", note)) if v}


def is_common_knowledge(src) -> bool:
    return isinstance(src, dict) and not src.get("url") and str(src.get("ref", "")).lower() == COMMON_KNOWLEDGE


def clean_items(raw_items) -> tuple[list[dict], list[str]]:
    """Keep only questions packs.js would accept (and a few rules of its own). Returns (kept, why-dropped)."""
    kept, dropped, seen = [], [], set()
    for it in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(it, dict):
            dropped.append("not an object")
            continue
        q = re.sub(r"\s+", " ", str(it.get("question") or "")).strip()
        answers = [re.sub(r"\s+", " ", str(a)).strip() for a in (it.get("answers") or []) if isinstance(a, str)]
        correct = re.sub(r"\s+", " ", str(it.get("correct") or "")).strip()
        diff = it.get("difficulty") if it.get("difficulty") in DIFFICULTIES else None
        why = None
        if not q:
            why = "no question"
        elif len(answers) < 3 or any(not a for a in answers):
            why = f"needs 3+ answers: {q[:60]}"
        elif len({_norm(a) for a in answers}) != len(answers):
            why = f"two answers are the same: {q[:60]}"
        elif correct not in answers:
            why = f"the correct answer is not one of the answers: {q[:60]}"
        elif _norm(q) in seen:
            why = f"a repeat: {q[:60]}"
        source = clean_source(it.get("source")) if not why else None
        if not why and source is None:
            # *** THE RULE (Mike, 2026-10-04): a question Claude cannot say where it came from is not kept. ***
            why = f"{NO_SOURCE}: {q[:60]}"
        if why:
            dropped.append(why)
            continue
        seen.add(_norm(q))
        item = {"question": q, "answers": answers, "correct": correct, "category": "",
                "explain": re.sub(r"\s+", " ", str(it.get("explain") or "")).strip(), "ai_written": True,
                "source": source}
        if diff:
            item["difficulty"] = diff
        kept.append(item)
    return kept, dropped


def make_pack(topic: str, items: list[dict], *, model: str, day: str | None = None) -> dict:
    day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for it in items:
        it["category"] = it.get("category") or topic
    return {
        "schema": "nimrod.pack.v1",
        "kind": "trivia",
        "name": f"{topic} (AI-written, not yet reviewed)",
        "description": f"{len(items)} questions on {topic}, written by Claude. Every question and answer needs "
                       "checking by a person before anybody plays it.",
        "source": {"name": f"Written by {model} (Anthropic, Claude) through the Batch API on {day}. Each question "
                           "names the source Claude gave for it (its `source` field); NOT checked against those "
                           "sources.", "url": "", "licence": "unreviewed - not cleared to ship"},
        "generated": day,
        "ai_written": True,
        "review": {"status": "unreviewed",
                   "how": "Check every question, answer and explanation. Fix or delete what is wrong, set status to "
                          "'reviewed' with your name and the date, then move the file to packs/ and list it in "
                          "pack_library.js."},
        "items": items,
    }


def source_counts(items: list[dict], problems: list[str]) -> str:
    """One line for the person collecting: how many were dropped for naming no source, and how many kept
    ones rest only on "common knowledge" (allowed with a reason, but the weakest kind - worth knowing)."""
    no_src = sum(1 for p in problems if p.startswith(NO_SOURCE + ":"))
    common = sum(1 for it in items if is_common_knowledge(it.get("source")))
    return (f"sources: {no_src} question(s) dropped for naming no source; "
            f"{common} of {len(items)} kept rest on 'common knowledge'")


def submit(client, requests: list[dict]):
    return client.messages.batches.create(requests=requests)


def collect(client, batch_id: str, *, on_usage=None) -> tuple[str, list[dict], list[str]]:
    """('ended', items, problems) once the batch is done, else (its status, [], []). `on_usage(model,
    usage)` is called for every succeeded result, so the account is charged for what it used."""
    b = client.messages.batches.retrieve(batch_id)
    if getattr(b, "processing_status", None) != "ended":
        return getattr(b, "processing_status", "unknown"), [], []
    raw, problems = [], []
    results = sorted(client.messages.batches.results(batch_id), key=lambda r: r.custom_id)  # any order -> by id
    for r in results:
        res = r.result
        if res.type != "succeeded":
            problems.append(f"{r.custom_id}: {res.type}")
            continue
        msg = res.message
        if on_usage is not None and getattr(msg, "usage", None) is not None:
            on_usage(getattr(msg, "model", None) or "", msg.usage)
        if getattr(msg, "stop_reason", None) == "refusal":
            problems.append(f"{r.custom_id}: declined")
            continue
        if getattr(msg, "stop_reason", None) == "max_tokens":
            problems.append(f"{r.custom_id}: cut off (max_tokens) - skipped rather than half-read")
            continue
        txt = next((blk.text for blk in msg.content if getattr(blk, "type", None) == "text"), "")
        try:
            raw.extend(json.loads(txt).get("items") or [])
        except (ValueError, AttributeError):
            problems.append(f"{r.custom_id}: the answer was not readable JSON")
    items, dropped = clean_items(raw)
    return "ended", items, problems + dropped


def _accounts():
    import app as appmod  # the server's own store and key box, configured from the same environment
    return appmod._claude


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Write a bank of quiz questions with Claude's Batch API (a draft for review).")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("submit", "collect"):
        sp = sub.add_parser(name)
        who = sp.add_mutually_exclusive_group(required=True)
        who.add_argument("--account", help="use this account's saved key, model and daily cap")
        who.add_argument("--env-key", action="store_true", help="use this machine's Anthropic credentials instead")
        sp.add_argument("--topic", default="")
        if name == "submit":
            sp.add_argument("--count", type=int, default=20)
            sp.add_argument("--model", default="", help="override the account's question model")
        else:
            sp.add_argument("--batch", required=True)
            sp.add_argument("--out", default="")
    a = p.parse_args(argv)

    accounts = None
    if a.account:
        accounts = _accounts()
        try:
            client, settings = accounts.client_for_account(a.account)
        except (C.NotSetUp, C.Refused) as e:
            print(f"cannot: {getattr(e, 'detail', None) or e}")
            return 2
        model = settings["quiz_model"]
    else:
        sdk = C.sdk()
        if sdk is None:
            print("cannot: the anthropic package is not installed (pip install -r requirements.txt)")
            return 2
        client, settings, model = sdk.Anthropic(), C.clean_settings({}), C.DEFAULT_QUIZ_MODEL

    try:
        if a.cmd == "submit":
            model = a.model or model
            reqs = build_batch_requests(a.topic, a.count, model)
            if accounts is not None:
                why = C.cap_refusal(accounts.spent_today(a.account), settings["daily_cap_usd"], worst_case(reqs))
                if why:
                    print(f"not submitted: {why}")
                    return 3
            b = submit(client, reqs)
            print(f"submitted {len(reqs)} request(s) for {a.count} questions on {a.topic!r} with {model}: {b.id}")
            print(f"most batches finish within an hour; then:\n  py -3.13 claude_questions.py collect "
                  f"{'--account ' + a.account if a.account else '--env-key'} --batch {b.id} --topic \"{a.topic}\"")
            return 0
        on_usage = (lambda m, u: accounts.record_usage(a.account, model=m or model, usage=u, batch=True)) if accounts else None
        status, items, problems = collect(client, a.batch, on_usage=on_usage)
        if status != "ended":
            print(f"not finished yet: {status}. Try again later.")
            return 4
        topic = a.topic or a.batch
        pack = make_pack(topic, items, model=model)
        out = Path(a.out) if a.out else OUT_DIR / f"{slug_of(topic)}_ai_unreviewed.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {len(items)} questions to {out} (UNREVIEWED - check every one before use)")
        print(f"  {source_counts(items, problems)}")
        for line in problems:
            print(f"  dropped/skipped: {line}")
        return 0
    except ValueError as e:
        print(f"cannot: {e}")
        return 2
    except Exception as e:  # noqa: BLE001
        mapped = C.sdk_error_reply(e)
        if mapped is None:
            raise
        print(f"Anthropic: {mapped[1]}")
        return 5


if __name__ == "__main__":
    sys.exit(main())
