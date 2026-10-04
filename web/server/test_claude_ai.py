"""Claude, on one account - the rules, then the routes, against a FAKE SDK client.

    py -3.13 test_claude_ai.py

No real key, no network, no anthropic package needed: every key here is made up in this file, and
the SDK client is a stand-in that records what it was asked and answers from a script. The SDK's
typed errors are stood in for by classes with the same names (claude_ai._sdk_override), so the
error mapping is checked even where the package is not installed.
"""
import io
import logging
import os
import sys
import tempfile
from types import SimpleNamespace as NS

from cryptography.fernet import Fernet

import claude_ai as C

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


def raises(fn, exc=ValueError):
    try:
        fn()
        return False
    except exc:
        return True


# Made up here. Shaped like a key so the shape check passes; worth nothing anywhere.
FAKE_KEY_A = "sk-ant-api03-FAKEFAKEFAKEaaaaTESTONLY-notreal-AAAA1234"
FAKE_KEY_B = "sk-ant-api03-FAKEFAKEFAKEbbbbTESTONLY-notreal-BBBB5678"


# ---- the fake SDK -----------------------------------------------------------------------------
class FakeAPIError(Exception):
    pass


class FakeAPIStatusError(FakeAPIError):
    def __init__(self, msg="x", status_code=400):
        super().__init__(msg)
        self.status_code = status_code
        self.message = msg


class FakeBadRequest(FakeAPIStatusError):
    def __init__(self, msg="bad"): super().__init__(msg, 400)


class FakeAuth(FakeAPIStatusError):
    def __init__(self, msg="auth"): super().__init__(msg, 401)


class FakePerm(FakeAPIStatusError):
    def __init__(self, msg="perm"): super().__init__(msg, 403)


class FakeNotFound(FakeAPIStatusError):
    def __init__(self, msg="nf"): super().__init__(msg, 404)


class FakeRate(FakeAPIStatusError):
    def __init__(self, msg="rate"): super().__init__(msg, 429)


class FakeConn(FakeAPIError):
    pass


class FakeTimeout(FakeConn):
    pass


FAKE_SDK = NS(AuthenticationError=FakeAuth, PermissionDeniedError=FakePerm, NotFoundError=FakeNotFound,
              RateLimitError=FakeRate, BadRequestError=FakeBadRequest, APIStatusError=FakeAPIStatusError,
              APIConnectionError=FakeConn, APITimeoutError=FakeTimeout)
C._sdk_override = FAKE_SDK


def usage(i=1000, o=50, cr=0, cw=0):
    return NS(input_tokens=i, output_tokens=o, cache_read_input_tokens=cr, cache_creation_input_tokens=cw)


def text(t):
    return NS(type="text", text=t)


def tool(name, arg=None):
    return NS(type="tool_use", id="toolu_1", name=name, input=({} if arg is None else {"arg": arg}))


def resp(content, stop="end_turn", model="claude-haiku-4-5", u=None, details=None):
    return NS(content=content, stop_reason=stop, model=model, usage=u or usage(), stop_details=details)


class FakeClient:
    """Records every create; answers from `script` (a response, or an exception to raise)."""

    def __init__(self, api_key, script, log):
        self.api_key = api_key
        self._script = script
        self._log = log
        outer = self

        class _Msgs:
            def create(self_inner, **kw):
                return outer._answer("plain", kw)

        class _BetaMsgs:
            def create(self_inner, **kw):
                return outer._answer("beta", kw)

        class _Models:
            def retrieve(self_inner, model):
                outer._log.append({"key": outer.api_key, "kind": "retrieve", "model": model})
                nxt = outer._script.pop(0) if outer._script else None
                if isinstance(nxt, BaseException):
                    raise nxt
                return NS(id=model)

        self.messages = _Msgs()
        self.beta = NS(messages=_BetaMsgs())
        self.models = _Models()

    def _answer(self, kind, kw):
        self._log.append({"key": self.api_key, "kind": kind, "kw": kw})
        nxt = self._script.pop(0) if self._script else resp([text("Okay.")])
        if isinstance(nxt, BaseException):
            raise nxt
        return nxt


SCRIPT = []
CALLS = []


def factory(api_key):
    return FakeClient(api_key, SCRIPT, CALLS)


# ============================================================================== the rules
section("the models: IDs exactly as the skill's table spells them, and the argued defaults")
check("talking: Haiku 4.5 by default, Sonnet 5.5 the more capable choice",
      C.CHAT_MODELS == ("claude-haiku-4-5", "claude-sonnet-5-5") and C.DEFAULT_CHAT_MODEL == "claude-haiku-4-5")
check("writing questions: Opus 5.5 by default", C.DEFAULT_QUIZ_MODEL == "claude-opus-5-5" and "claude-opus-5-5" in C.QUIZ_MODELS)
check("no date-suffixed IDs anywhere", not any(__import__("re").search(r"-\d{8}$", m) for m in C.CHAT_MODELS + C.QUIZ_MODELS))
check("every offered model has a price and a label", all(m in C.PRICES and m in C.MODEL_LABELS for m in C.CHAT_MODELS + C.QUIZ_MODELS))

section("money: counted from usage, with the cache and the batch discount")
u = usage(i=1_000_000, o=1_000_000, cr=1_000_000, cw=1_000_000)
check("Haiku: $1 in + $5 out + $0.10 cache read + $1.25 cache write = $7.35",
      abs(C.cost_usd("claude-haiku-4-5", u) - 7.35) < 1e-9, C.cost_usd("claude-haiku-4-5", u))
check("Sonnet 5.5: $2 + $10 + $0.20 + $2.50", abs(C.cost_usd("claude-sonnet-5-5", u) - 14.70) < 1e-9)
check("the Batch API is half", abs(C.cost_usd("claude-opus-5-5", u, batch=True) - C.cost_usd("claude-opus-5-5", u) / 2) < 1e-9)
check("*** a model the table does not know is priced at the most expensive tier (the cap stops sooner, never later) ***",
      C.cost_usd("claude-something-new", u) > C.cost_usd("claude-opus-5-5", u))
check("a refusal fallback served by a dearer model is counted at the dearer price",
      C.cost_usd("claude-sonnet-5-5", u, also="claude-opus-4-8") == C.cost_usd("claude-opus-4-8", u))
check("a missing usage field counts as zero, not a crash", C.cost_usd("claude-haiku-4-5", NS()) == 0)

section("*** the daily cap: hard, and argued ***")
check("default $1.00 a day, at most $50", C.DEFAULT_DAILY_CAP_USD == 1.0 and C.MAX_DAILY_CAP_USD == 50.0)
check("under the cap with room: goes ahead", C.cap_refusal(0.10, 1.0, 0.01) is None)
check("*** at the cap: refused, saying when it starts again ***", "midnight UTC" in (C.cap_refusal(1.0, 1.0, 0.0) or ""))
check("*** a call whose WORST CASE would go over: refused before it is made ***", C.cap_refusal(0.995, 1.0, 0.01) is not None)
check("a cap of $0 means paused, and says so", "paused" in (C.cap_refusal(0.0, 0.0, 0.0) or ""))
check("the worst case is pessimistic: 2 characters a token, written to cache, every output token",
      abs(C.worst_case_usd("claude-haiku-4-5", 2000, 1000) - (1000 * 1.0 * 1.25 + 1000 * 5.0) / 1e6) < 1e-12)
row = C.add_usage({}, model="claude-haiku-4-5", usage=usage(100, 10, 5, 7), usd=0.5)
row = C.add_usage(row, model="claude-haiku-4-5", usage=usage(1, 1), usd=0.25)
check("the day's row: counts and dollars add up, per model too", row["requests"] == 2 and row["input_tokens"] == 101
      and row["output_tokens"] == 11 and row["cache_read_tokens"] == 5 and row["cache_write_tokens"] == 7
      and abs(row["usd"] - 0.75) < 1e-9 and row["by_model"]["claude-haiku-4-5"]["requests"] == 2, str(row))
check("*** the usage row holds COUNTS ONLY: no words ***", set(row) == {"requests", "input_tokens", "output_tokens",
      "cache_read_tokens", "cache_write_tokens", "usd", "by_model"})
check("the day is UTC", C.today_utc(__import__("datetime").datetime(2026, 10, 3, 23, 30, tzinfo=__import__("datetime").timezone.utc)) == "2026-10-03")

section("settings")
check("defaults", C.clean_settings({}) == {"chat_model": "claude-haiku-4-5", "quiz_model": "claude-opus-5-5", "daily_cap_usd": 1.0})
check("junk in a stored row reads as the defaults", C.clean_settings({"chat_model": "gpt", "daily_cap_usd": "lots"})["chat_model"] == "claude-haiku-4-5")
check("a model that is not offered is refused", raises(lambda: C.apply_settings_patch({}, {"chat_model": "claude-opus-5-5"})))
check("a cap over $50 is refused, a negative one too", raises(lambda: C.apply_settings_patch({}, {"daily_cap_usd": 51}))
      and raises(lambda: C.apply_settings_patch({}, {"daily_cap_usd": -1})))
check("a good change is kept", C.apply_settings_patch({}, {"chat_model": "claude-sonnet-5-5", "daily_cap_usd": 2.5})
      == {"chat_model": "claude-sonnet-5-5", "quiz_model": "claude-opus-5-5", "daily_cap_usd": 2.5})

section("the key's shape")
check("a key-shaped string is accepted (spaces from a paste are removed)", C.clean_key("  " + FAKE_KEY_A + "\n") == FAKE_KEY_A)
check("*** an ADMIN key is refused - more power than the job needs ***", raises(lambda: C.clean_key("sk-ant-admin01-" + "x" * 30)))
check("not a Claude key: refused", raises(lambda: C.clean_key("sk-proj-abcdefabcdefabcdefabcdef")) and raises(lambda: C.clean_key("")))

section("*** the key box: encrypted at rest, bound to the account ***")
SECRET = Fernet.generate_key()
box = C.KeyBox([SECRET])
sealed = box.seal("acct-a", FAKE_KEY_A)
check("*** the sealed text does not contain the key, or any long piece of it ***",
      FAKE_KEY_A not in sealed and FAKE_KEY_A[-12:] not in sealed and "FAKEFAKE" not in sealed)
check("it opens again for the same account", box.open("acct-a", sealed) == FAKE_KEY_A)
check("*** copied into ANOTHER account's row, it opens to nothing ***", box.open("acct-b", sealed) is None)
check("a different server secret cannot open it", C.KeyBox([Fernet.generate_key()]).open("acct-a", sealed) is None)
check("garbage opens to nothing, not a crash", box.open("acct-a", "not-a-token") is None)
new = Fernet.generate_key()
rot = C.KeyBox([new, SECRET])
check("rotation: a new secret in front still opens the old one, and seals with the new",
      rot.open("acct-a", sealed) == FAKE_KEY_A and C.KeyBox([new]).open("acct-a", rot.seal("acct-a", FAKE_KEY_A)) == FAKE_KEY_A)
check("*** production with no secret: no box (nothing is stored) ***", C.KeyBox.from_env({}, prod=True) is None)
check("dev with no secret: the public dev-only box, so it can be tried locally", C.KeyBox.from_env({}, prod=False) is not None)
check("a malformed secret is 'cannot store', not a crash", C.KeyBox.from_env({C.SECRET_ENV: "nope"}, prod=True) is None)

section("*** the request: actions as strict tools, auto choice, the stable prefix cached ***")
ACTIONS = [{"name": "go", "args": "<place id>", "help": "move the guide to that place"},
           {"name": "back", "args": "", "help": "the guide goes back one step"}]
BODY = {"messages": [{"role": "system", "content": "You are Nimrod. " * 20},
                     {"role": "user", "content": "Show me the themes"}],
        "actions": ACTIONS, "max_tokens": 400}
kw, allowed, chars = C.build_request(BODY, model="claude-haiku-4-5")
check("the system prompt goes in `system`, not in messages", kw["system"][0]["text"].startswith("You are Nimrod.")
      and all(m["role"] != "system" for m in kw["messages"]))
check("*** every action is a tool with strict: true and additionalProperties: false ***",
      [t["name"] for t in kw["tools"]] == ["go", "back"] and all(t["strict"] is True for t in kw["tools"])
      and all(t["input_schema"]["additionalProperties"] is False for t in kw["tools"]))
check("an action with an argument takes it as `arg` (required); one without takes nothing",
      kw["tools"][0]["input_schema"]["required"] == ["arg"] and kw["tools"][1]["input_schema"]["properties"] == {})
check("*** tool_choice is AUTO - never forced ***", kw["tool_choice"] == {"type": "auto"})
check("*** cache_control on the last tool, the last system block and the last user turn ***",
      kw["tools"][-1].get("cache_control") == {"type": "ephemeral"} and "cache_control" not in kw["tools"][0]
      and kw["system"][-1].get("cache_control") == {"type": "ephemeral"}
      and kw["messages"][-1]["content"][0].get("cache_control") == {"type": "ephemeral"})
check("the tools are told to be used instead of [[lines]], and that a press still decides",
      "call its tool" in kw["system"][-1]["text"] and "presses a button" in kw["system"][-1]["text"])
check("the allow-list comes back to check the reply against", allowed == {"go", "back"})
check("Haiku: no effort parameter (it does not take one), a short reply", "output_config" not in kw and kw["max_tokens"] == 400)
kw2, _, _ = C.build_request(BODY, model="claude-sonnet-5-5")
check("Sonnet 5.5: effort low, with room for its thinking", kw2["output_config"] == {"effort": "low"} and kw2["max_tokens"] == 400 + C.THINKING_HEADROOM)
check("the same request twice is the same bytes (no timestamps, nothing random): the cache can hit",
      C.build_request(BODY, model="claude-haiku-4-5")[0] == kw)
kw3, _, _ = C.build_request({"messages": [{"role": "user", "content": "hello"}]}, model="claude-haiku-4-5")
check("no actions: no tools, no tool_choice", "tools" not in kw3 and "tool_choice" not in kw3)
check("*** an image (or any non-text content) is refused, not quietly dropped ***",
      raises(lambda: C.build_request({"messages": [{"role": "user", "content": [{"type": "image", "source": {}}]}]}, model="claude-haiku-4-5")))
check("the last message must be the person's (no prefill)",
      raises(lambda: C.build_request({"messages": [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]}, model="claude-haiku-4-5")))
check("too much text is refused", raises(lambda: C.build_request({"messages": [{"role": "user", "content": "x" * 70_000}]}, model="claude-haiku-4-5")))
check("an action name that could not be a tool is refused",
      raises(lambda: C.build_request({"messages": [{"role": "user", "content": "a"}], "actions": [{"name": "Go Now!"}]}, model="claude-haiku-4-5")))

section("*** the reply: tool calls become the [[lines]] the page already reads; stop reasons handled ***")
r = C.read_reply(resp([text("Here are the themes."), tool("page", "sc-theme")], stop="tool_use"), {"page", "go"})
check("*** tool_use -> its words, then [[page sc-theme]] on its own line ***", r["ok"] and r["text"] == "Here are the themes.\n[[page sc-theme]]", r)
r = C.read_reply(resp([tool("back")], stop="tool_use"), {"back"})
check("a tool with no argument: [[back]]", r["text"] == "[[back]]", r)
r = C.read_reply(resp([text("ok"), tool("delete-everything", "now")], stop="tool_use"), {"go"})
check("*** a tool NOT on the allow-list is dropped ***", r["text"] == "ok", r)
r = C.read_reply(resp([text("Sure"), tool("go", "theme]] [[back")], stop="tool_use"), {"go"})
check("brackets inside an argument cannot smuggle a second action", r["text"].count("[[") == 1, r["text"])
r = C.read_reply(resp([text("A long answer"), tool("go", "theme")], stop="max_tokens"), {"go"})
check("*** max_tokens: the words so far, marked cut off, and NO action (a cut-off answer is not a plan) ***",
      r["ok"] and r["truncated"] and r["text"] == "A long answer", r)
r = C.read_reply(resp([], stop="max_tokens"), {"go"})
check("max_tokens with nothing said: not ok, in plain words", r["ok"] is False and "cut off" in r["reason"])
r = C.read_reply(resp([text("partial")], stop="refusal", details=NS(category="cyber", explanation="x")), {"go"})
check("*** refusal: not ok, a plain sentence, the partial text NOT shown ***", r["ok"] is False and r["refusal"]
      and r["reason"] == C.REFUSAL_TEXT and "partial" not in str(r) and r["category"] == "cyber", r)
r = C.read_reply(resp([NS(type="thinking", thinking=""), text("Hi")]), set())
check("thinking blocks are not shown", r["text"] == "Hi")

section("typed SDK errors, in plain words (never a 401: that would read as 'sign in again')")
cases = [(FakeAuth(), 502, "key"), (FakePerm(), 502, "allowed"), (FakeNotFound(), 502, "model"), (FakeRate(), 429, "minute"),
         (FakeBadRequest(), 502, "refused"), (FakeAPIStatusError("x", 402), 502, "billing"),
         (FakeAPIStatusError("x", 529), 503, "busy"), (FakeTimeout(), 504, "reach"), (FakeConn(), 504, "reach")]
check("each maps to its status and a sentence", all((m := C.sdk_error_reply(e)) and m[0] == s and w in m[1] for e, s, w in cases),
      str([C.sdk_error_reply(e) for e, _, _ in cases]))
check("not the SDK's: None (re-raised, a bug is a bug)", C.sdk_error_reply(KeyError("x")) is None)
check("no status is 401", all(C.sdk_error_reply(e)[0] != 401 for e, _, _ in cases))

# ============================================================================== question writing
section("*** writing questions ahead of time: the Batch API, a DRAFT marked AI-written ***")
import json as _json  # noqa: E402
import claude_questions as Q  # noqa: E402

reqs = Q.build_batch_requests("Birds of Ohio", 25, "claude-opus-5-5")
check("25 questions -> 3 requests of 10, 10 and 5", len(reqs) == 3
      and [int(__import__("re").search(r"Write (\d+)", r["params"]["messages"][0]["content"]).group(1)) for r in reqs] == [10, 10, 5])
check("custom_ids carry the topic and part (results come back in any order)", [r["custom_id"] for r in reqs]
      == ["birds_of_ohio--001", "birds_of_ohio--002", "birds_of_ohio--003"]
      and all(__import__("re").match(r"^[a-zA-Z0-9_-]{1,64}$", r["custom_id"]) for r in reqs))
p0 = reqs[0]["params"]
check("Opus 5.5 by default for questions; effort high; structured JSON out; the shared system text cached",
      p0["model"] == "claude-opus-5-5" and p0["output_config"]["effort"] == "high"
      and p0["output_config"]["format"]["type"] == "json_schema" and p0["system"][0]["cache_control"] == {"type": "ephemeral"})
check("no thinking budget, no fallbacks (both rejected here), no forced tool", "thinking" not in p0 and "fallbacks" not in p0 and "tool_choice" not in p0)
check("a model not offered for questions is refused", raises(lambda: Q.build_batch_requests("x", 5, "claude-mythos-5-1")))
check("too many is refused", raises(lambda: Q.build_batch_requests("x", Q.MAX_COUNT + 1, "claude-opus-5-5")))
check("the worst case of the batch is priced at half (Batch API)", 0 < Q.worst_case(reqs) < 1.0, Q.worst_case(reqs))
SRC = {"url": "", "ref": "Ohio Revised Code 5.03", "title": "", "note": ""}
items, dropped = Q.clean_items([
    {"question": "Which bird is Ohio's state bird?", "answers": ["Cardinal", "Robin", "Blue jay", "Crow"], "correct": "Cardinal", "difficulty": "easy", "explain": "Since 1933.", "source": SRC},
    {"question": "Which bird is Ohio's state bird?", "answers": ["Cardinal", "Robin", "Wren", "Crow"], "correct": "Cardinal", "difficulty": "easy", "explain": "dup", "source": SRC},
    {"question": "No right answer?", "answers": ["A", "B", "C", "D"], "correct": "E", "difficulty": "hard", "explain": "", "source": SRC},
    {"question": "Two the same?", "answers": ["A", "a", "C", "D"], "correct": "A", "difficulty": "hard", "explain": "", "source": SRC},
    {"question": "Too few", "answers": ["A", "B"], "correct": "A", "source": SRC},
])
check("*** only sound questions are kept: a repeat, a missing correct answer, duplicate answers, too few - dropped ***",
      len(items) == 1 and len(dropped) == 4 and items[0]["ai_written"] is True, f"{items} {dropped}")
check("a kept question carries its source, with the empty fields left out",
      items[0]["source"] == {"ref": "Ohio Revised Code 5.03"}, items[0].get("source"))

section("*** every question names its source (Mike, 2026-10-04): the schema asks, clean_items enforces ***")
item_schema = Q.ITEM_SCHEMA["properties"]["items"]["items"]
check("*** the structured-output schema REQUIRES a source on every item, with url/ref/title/note and nothing else ***",
      "source" in item_schema["required"] and item_schema["properties"]["source"] is Q.SOURCE_SCHEMA
      and set(Q.SOURCE_SCHEMA["required"]) == {"url", "ref", "title", "note"}
      and Q.SOURCE_SCHEMA["additionalProperties"] is False)
check("...and that schema is the one every batch request sends",
      all(r["params"]["output_config"]["format"]["schema"] is Q.ITEM_SCHEMA for r in reqs))
check("the instructions ask for a named reference or a link, say never to make up a link, and that no source means thrown away",
      "SOURCE" in Q.SYSTEM and "never make up a link" in Q.SYSTEM and "thrown away" in Q.SYSTEM)
base = {"answers": ["A", "B", "C", "D"], "correct": "A", "difficulty": "easy", "explain": ""}
cases = [
    ("no source field", None),
    ("an empty source", {"url": "", "ref": "", "title": "", "note": ""}),
    ("'certain' is not a source", {"url": "", "ref": "certain", "title": "", "note": ""}),
    ("'from memory' is not a source", {"url": "", "ref": "From memory", "title": "", "note": ""}),
    ("common knowledge with no reason", {"url": "", "ref": "common knowledge", "title": "", "note": ""}),
    ("a link that is not a link, and nothing else", {"url": "britannica.com/giraffe", "ref": "", "title": "x", "note": ""}),
    ("a bare string non-answer", "certain"),
]
raw = [{**base, "question": f"Dropped {i}?", **({} if s is None else {"source": s})} for i, (_, s) in enumerate(cases)]
raw += [
    {**base, "question": "Kept common?", "source": {"url": "", "ref": "Common knowledge", "title": "", "note": "taught to small children"}},
    {**base, "question": "Kept link?", "source": {"url": "https://www.britannica.com/animal/giraffe", "ref": "", "title": "Giraffe", "note": ""}},
    {**base, "question": "Kept ref, bad link dropped?", "source": {"url": "not a link", "ref": "Britannica, 'Giraffe'", "title": "", "note": ""}},
]
kept, gone = Q.clean_items(raw)
no_src = [d for d in gone if d.startswith(Q.NO_SOURCE + ":")]
check("*** every source-less question is dropped, and each is counted as 'no source' ***",
      len(no_src) == len(cases) and len(gone) == len(cases), gone)
check("kept: common knowledge WITH a reason, a real link, and a reference beside a broken link (the broken link removed)",
      [k["question"] for k in kept] == ["Kept common?", "Kept link?", "Kept ref, bad link dropped?"]
      and kept[1]["source"] == {"url": "https://www.britannica.com/animal/giraffe", "title": "Giraffe"}
      and kept[2]["source"] == {"ref": "Britannica, 'Giraffe'"}, kept)
check("the collector's summary counts both: dropped for no source, and kept on common knowledge",
      Q.source_counts(kept, gone) == f"sources: {len(cases)} question(s) dropped for naming no source; 1 of 3 kept rest on 'common knowledge'",
      Q.source_counts(kept, gone))
check("clean_source reads the old fact-check strings the same way: a URL, a reference, 'certain' refused",
      Q.clean_source("https://example.org/a") == {"url": "https://example.org/a"} and Q.clean_source("Britannica") == {"ref": "Britannica"}
      and Q.clean_source("certain") is None and Q.clean_source([]) is None
      and Q.clean_source([{"ref": "A"}, "https://b.org"]) == [{"ref": "A"}, {"url": "https://b.org"}])

pack = Q.make_pack("Birds of Ohio", items, model="claude-opus-5-5", day="2026-10-03")
check("*** the pack says AI-written and UNREVIEWED in its name, source, review status and every item ***",
      "AI-written, not yet reviewed" in pack["name"] and "NOT checked" in pack["source"]["name"]
      and pack["review"]["status"] == "unreviewed" and pack["ai_written"] is True and all(i["ai_written"] for i in pack["items"]))
check("...and every item in it names a source (the rule packs.js enforces on an AI-written pack)",
      all(Q.clean_source(i.get("source")) for i in pack["items"]) and "source" in pack["source"]["name"])
check("it is a valid nimrod.pack.v1 trivia pack shape", pack["schema"] == "nimrod.pack.v1" and pack["kind"] == "trivia"
      and all(i["correct"] in i["answers"] and len(i["answers"]) >= 3 for i in pack["items"]))
check("*** it goes to packs_local (not shipped), and pack_library.js does not list it ***",
      Q.OUT_DIR.name == "packs_local" and "/packs_local/" not in (Q.OUT_DIR.parent / "pack_library.js").read_text(encoding="utf-8")
      and "_ai_unreviewed" not in (Q.OUT_DIR.parent / "pack_library.js").read_text(encoding="utf-8"))


def _msg(txt, stop="end_turn"):
    return NS(content=[text(txt)], stop_reason=stop, model="claude-opus-5-5", usage=usage(800, 1200))


def _res(cid, kind="succeeded", m=None):
    return NS(custom_id=cid, result=NS(type=kind, message=m))


good = _json.dumps({"items": [{"question": "Q1?", "answers": ["a", "b", "c", "d"], "correct": "a", "difficulty": "easy", "explain": "x",
                               "source": {"url": "https://example.org/q1", "ref": "", "title": "Q1 page", "note": ""}}]})
good2 = _json.dumps({"items": [{"question": "Q2?", "answers": ["a", "b", "c", "d"], "correct": "b", "difficulty": "hard", "explain": "y",
                                "source": {"url": "", "ref": "A reference work, 'Q2'", "title": "", "note": ""}},
                               {"question": "Q2 with no source?", "answers": ["a", "b", "c", "d"], "correct": "b", "difficulty": "hard", "explain": "y",
                                "source": {"url": "", "ref": "", "title": "", "note": ""}}]})
batch_state = {"status": "in_progress", "created": None}
fake_batches = NS(
    create=lambda requests: (batch_state.__setitem__("created", requests), NS(id="msgbatch_fake1"))[1],
    retrieve=lambda bid: NS(processing_status=batch_state["status"]),
    results=lambda bid: iter([_res("t--002", m=_msg(good2)), _res("t--001", m=_msg(good)), _res("t--003", "errored"),
                              _res("t--004", m=_msg("{not json")), _res("t--005", m=_msg(good, stop="max_tokens"))]),
)
bclient = NS(messages=NS(batches=fake_batches))
b = Q.submit(bclient, reqs)
check("submit sends the requests to messages.batches.create", b.id == "msgbatch_fake1" and batch_state["created"] == reqs)
check("not finished: says so, writes nothing", Q.collect(bclient, "msgbatch_fake1")[0] == "in_progress")
batch_state["status"] = "ended"
charged = []
status, got, probs = Q.collect(bclient, "msgbatch_fake1", on_usage=lambda m, u: charged.append((m, u.output_tokens)))
check("*** ended: results keyed by custom_id (not arrival order), failures listed, cut-off answers skipped ***",
      status == "ended" and [i["question"] for i in got] == ["Q1?", "Q2?"] and any("errored" in p for p in probs)
      and any("not readable" in p for p in probs) and any("cut off" in p for p in probs), f"{got} {probs}")
check("*** through the fake batch too: the answer that named no source is dropped and counted ***",
      sum(1 for p in probs if p.startswith(Q.NO_SOURCE + ":")) == 1 and all(i.get("source") for i in got)
      and "1 question(s) dropped for naming no source" in Q.source_counts(got, probs), f"{got} {probs}")
check("every succeeded result is charged to the account (even one that was cut off)", len(charged) == 4)
check("a batch result's cost is half the plain price", abs(C.cost_usd("claude-opus-5-5", usage(800, 1200), batch=True)
      - (800 * 4 + 1200 * 20) / 1e6 / 2) < 1e-12)

# ============================================================================== the routes
section("*** the routes, end to end, with a fake client ***")
tmp = tempfile.mkdtemp(prefix="nimrod_claude_")
DB = os.path.join(tmp, "claude_test.db")
os.environ["NIMROD_DB"] = DB
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
os.environ[C.SECRET_ENV] = SECRET.decode()
os.environ["DEVICE_KEYS"] = "own-a:screen-secret-for-tests-only"
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

check("the app's reserved account scope is claude_ai's", appmod.ACCOUNT_SCOPE == C.ACCOUNT_SCOPE)
appmod._claude = C.ClaudeAccounts(appmod.store, keybox=C.KeyBox.from_env(), client_factory=factory)
c = TestClient(appmod.app)
cap = io.StringIO()
handler = logging.StreamHandler(cap)
handler.setLevel(logging.DEBUG)
logging.getLogger("nimrod.claude").addHandler(handler)
logging.getLogger("nimrod.claude").setLevel(logging.DEBUG)


def H(u):
    return {"X-Dev-User": u}


A, B = "own-a", "other-b"
SCREEN = {"X-Device-Key": "screen-secret-for-tests-only"}
st = c.get("/api/ai/claude", headers=H(A)).json()
check("before: not set, defaults shown, it can store, today's spend is $0",
      st["key_set"] is False and st["key_last4"] is None and st["chat_model"] == "claude-haiku-4-5"
      and st["daily_cap_usd"] == 1.0 and st["can_store"] is True and st["today"]["usd"] == 0, str(st))
check("chat with no key: 404, in words", c.post("/api/ai/claude/chat", json=BODY, headers=H(A)).status_code == 404)

r = c.put("/api/ai/claude/key", json={"key": "sk-ant-admin01-" + "y" * 30}, headers=H(A))
check("an admin key is refused (400)", r.status_code == 400, r.text)
r = c.put("/api/ai/claude/key", json={"key": FAKE_KEY_A}, headers=SCREEN)
check("*** a SCREEN cannot set the key (403): only the owner's own signed-in device ***", r.status_code == 403, r.text)
r = c.put("/api/ai/claude/key", json={"key": FAKE_KEY_A}, headers=H(A))
check("the owner sets it", r.status_code == 200 and r.json()["key_set"] is True and r.json()["key_last4"] == "1234", r.text)
check("*** the reply to saving does NOT contain the key ***", FAKE_KEY_A not in r.text and "FAKEFAKE" not in r.text)
st = c.get("/api/ai/claude", headers=H(A))
check("*** status never returns it: set, and the last four, only ***", FAKE_KEY_A not in st.text and "FAKEFAKE" not in st.text
      and st.json()["key_last4"] == "1234")
rowA = appmod.store.get_state(A, C.ACCOUNT_SCOPE, C.KEY_ROW)["data"]
check("*** at rest: the database row holds a sealed token, not the key ***",
      FAKE_KEY_A not in repr(rowA) and rowA.get("sealed") and set(rowA) == {"sealed", "last4", "set_at"}, repr(rowA)[:120])
appmod.store.ping()
try:
    raw = b"".join(open(p, "rb").read() for p in (DB, DB + "-wal") if os.path.exists(p))
except OSError:
    raw = b""
check("*** ...and the database FILE does not contain it either ***", raw and FAKE_KEY_A.encode() not in raw and b"FAKEFAKE" not in raw)
check("the generic state route cannot reach the account rows", c.get(f"/api/profiles/{C.ACCOUNT_SCOPE}/state/{C.KEY_ROW}",
      headers=H(A)).status_code == 404)
check("a screen of the account CAN read the status (no key in it)", c.get("/api/ai/claude", headers=SCREEN).json()["key_set"] is True)

SCRIPT[:] = [resp([text("Here are the themes."), tool("page", "sc-theme")], stop="tool_use",
                  u=usage(i=3000, o=40, cr=0, cw=2500))]
CALLS.clear()
body = {"messages": [{"role": "system", "content": "You are Nimrod."}, {"role": "user", "content": "PRIVATE-WORDS show me the themes"}],
        "actions": [{"name": "page", "args": "<sc-theme|sc-mode>", "help": "show that page"}], "max_tokens": 400}
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
j = r.json()
check("*** chat: answered, the tool call turned into [[page sc-theme]] ***", r.status_code == 200 and j["ok"]
      and j["text"] == "Here are the themes.\n[[page sc-theme]]", r.text)
check("*** ...with THIS account's key, and only one call ***", len(CALLS) == 1 and CALLS[0]["key"] == FAKE_KEY_A)
kwc = CALLS[0]["kw"]
check("the call carried strict tools, auto choice, the cache markers, the chosen model",
      kwc["model"] == "claude-haiku-4-5" and kwc["tools"][0]["strict"] is True and kwc["tool_choice"] == {"type": "auto"}
      and kwc["tools"][-1]["cache_control"] and kwc["system"][-1]["cache_control"], str(kwc)[:300])
check("Haiku goes through the plain endpoint (no fallback beta)", CALLS[0]["kind"] == "plain")
spent1 = (3000 * 1 + 2500 * 1.25 + 40 * 5) / 1e6
check("*** usage counted from response.usage, and reported against the cap ***",
      abs(j["usd"] - spent1) < 1e-9 and abs(j["spent_today_usd"] - round(spent1, 4)) < 1e-9 and j["daily_cap_usd"] == 1.0, str(j))
day = appmod.store.get_state(A, C.ACCOUNT_SCOPE, C.USAGE_PREFIX + C.today_utc())["data"]
check("the day's usage row: one request, the tokens", day["requests"] == 1 and day["input_tokens"] == 3000 and day["cache_write_tokens"] == 2500)
check("*** the words never reach the usage row, or the log ***", "PRIVATE-WORDS" not in repr(day) and "PRIVATE-WORDS" not in cap.getvalue()
      and "show me the themes" not in cap.getvalue(), cap.getvalue()[-300:])
check("the log line carries counts", "in=3000" in cap.getvalue() and "usd=" in cap.getvalue())
check("a screen of the account may TALK", (SCRIPT.append(resp([text("Hi")])), c.post("/api/ai/claude/chat", json=body, headers=SCREEN).json()["ok"])[1])

section("*** another account never touches the key ***")
CALLS.clear()
stB = c.get("/api/ai/claude", headers=H(B)).json()
check("account B sees its own (empty) status, nothing of A's", stB["key_set"] is False and stB["key_last4"] is None and stB["today"]["usd"] == 0)
r = c.post("/api/ai/claude/chat", json=body, headers=H(B))
check("*** B's chat: 404, and NO client was made with anybody's key ***", r.status_code == 404 and CALLS == [], f"{r.status_code} {CALLS}")
r = c.delete("/api/ai/claude/key", headers=H(B))
check("B 'removing the key' removes only B's (none): A's is still set",
      r.status_code == 200 and c.get("/api/ai/claude", headers=H(A)).json()["key_set"] is True)
c.put("/api/ai/claude/key", json={"key": FAKE_KEY_B}, headers=H(B))
SCRIPT[:] = [resp([text("B here")])]
CALLS.clear()
c.post("/api/ai/claude/chat", json=body, headers=H(B))
check("B with its own key: B's key is used, never A's", [x["key"] for x in CALLS] == [FAKE_KEY_B])
sealedB = appmod.store.get_state(B, C.ACCOUNT_SCOPE, C.KEY_ROW)["data"]["sealed"]
check("B's sealed key planted in A's row does not open for A",
      appmod._claude.keybox.open(A, sealedB) is None)

section("refusal, cut-off, typed errors, through the route")
SCRIPT[:] = [resp([text("half")], stop="refusal", details=NS(category="cyber", explanation="x"), u=usage(500, 5))]
before = c.get("/api/ai/claude", headers=H(A)).json()["today"]["requests"]
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("*** a refusal is a 200 with ok:false and a plain sentence ***", r.status_code == 200 and r.json()["ok"] is False
      and r.json()["refusal"] is True and "half" not in r.text, r.text)
check("...and it is still counted (a refused request is billed)", c.get("/api/ai/claude", headers=H(A)).json()["today"]["requests"] == before + 1)
SCRIPT[:] = [FakeRate()]
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("*** Anthropic's rate limit (typed) -> 429 in words ***", r.status_code == 429 and "minute" in r.json()["detail"], r.text)
SCRIPT[:] = [FakeAuth()]
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("a key Anthropic refuses -> 502 (never 401), saying to paste a new one", r.status_code == 502 and "paste a new" in r.json()["detail"], r.text)
check("an image is refused at the door (400) and nothing is sent",
      (CALLS.clear(), c.post("/api/ai/claude/chat", json={"messages": [{"role": "user", "content": [{"type": "image"}]}]},
                             headers=H(A)).status_code)[1] == 400 and CALLS == [])

section("*** Sonnet 5.5: the refusal-fallback beta, and the plain call if the beta is refused ***")
r = c.put("/api/ai/claude/settings", json={"chat_model": "claude-sonnet-5-5"}, headers=H(A))
check("the owner switches to Sonnet 5.5", r.status_code == 200 and r.json()["chat_model"] == "claude-sonnet-5-5", r.text)
check("a screen cannot change settings", c.put("/api/ai/claude/settings", json={"daily_cap_usd": 5}, headers=SCREEN).status_code == 403)
check("a model not offered for talking: 400", c.put("/api/ai/claude/settings", json={"chat_model": "claude-opus-5-5"}, headers=H(A)).status_code == 400)
SCRIPT[:] = [resp([text("ok")], model="claude-sonnet-5-5")]
CALLS.clear()
c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("Sonnet goes through the beta endpoint with fallbacks='default' and the 2026-07-01 header",
      CALLS and CALLS[0]["kind"] == "beta" and CALLS[0]["kw"]["fallbacks"] == "default"
      and CALLS[0]["kw"]["betas"] == ["server-side-fallback-2026-07-01"] and CALLS[0]["kw"]["output_config"] == {"effort": "low"}, str(CALLS)[:300])
SCRIPT[:] = [FakeBadRequest("beta not enabled"), resp([text("plain ok")], model="claude-sonnet-5-5")]
CALLS.clear()
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("a 400 on the beta call: one plain call, and the answer", r.json().get("text") == "plain ok"
      and [x["kind"] for x in CALLS] == ["beta", "plain"] and "fallbacks" not in CALLS[1]["kw"], r.text)
c.put("/api/ai/claude/settings", json={"chat_model": "claude-haiku-4-5"}, headers=H(A))

section("*** the cap, through the route ***")
r = c.put("/api/ai/claude/settings", json={"daily_cap_usd": 51}, headers=H(A))
check("over $50: 400", r.status_code == 400)
spent = c.get("/api/ai/claude", headers=H(A)).json()["today"]["usd"]
c.put("/api/ai/claude/settings", json={"daily_cap_usd": round(spent + 0.001, 4)}, headers=H(A))
CALLS.clear()
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("*** a call whose worst case would pass the cap: 429 BEFORE any call is made ***", r.status_code == 429
      and CALLS == [] and "limit" in r.json()["detail"], r.text)
c.put("/api/ai/claude/settings", json={"daily_cap_usd": 0}, headers=H(A))
r = c.post("/api/ai/claude/chat", json=body, headers=H(A))
check("a cap of $0: paused, 429, in words", r.status_code == 429 and "paused" in r.json()["detail"])
c.put("/api/ai/claude/settings", json={"daily_cap_usd": 1}, headers=H(A))

section("check the key, for nothing")
SCRIPT[:] = []
CALLS.clear()
r = c.post("/api/ai/claude/check", headers=H(A))
check("check: asks for the chosen model's details (not billed), with A's key", r.json() == {"ok": True, "model": "claude-haiku-4-5"}
      and CALLS == [{"key": FAKE_KEY_A, "kind": "retrieve", "model": "claude-haiku-4-5"}], f"{r.text} {CALLS}")
SCRIPT[:] = [FakeAuth()]
check("a refused key says so", c.post("/api/ai/claude/check", headers=H(A)).json()["ok"] is False)

section("rate limit")
appmod._claude_limit.reset()
SCRIPT[:] = []
codes = [c.post("/api/ai/claude/chat", json=body, headers=H(A)).status_code for _ in range(appmod._claude_limit.limit + 1)]
check(f"*** {appmod._claude_limit.limit} a minute are fine, the next is a 429 ***",
      codes[:-1] == [200] * appmod._claude_limit.limit and codes[-1] == 429, str(codes))
appmod._claude_limit.reset()

section("removing the key")
r = c.delete("/api/ai/claude/key", headers=SCREEN)
check("a screen cannot remove it", r.status_code == 403)
r = c.delete("/api/ai/claude/key", headers=H(A))
check("*** the owner removes it: not set, and the row no longer holds a sealed key ***", r.status_code == 200 and r.json()["key_set"] is False
      and "sealed" not in appmod.store.get_state(A, C.ACCOUNT_SCOPE, C.KEY_ROW)["data"])
check("chat after removing: 404", c.post("/api/ai/claude/chat", json=body, headers=H(A)).status_code == 404)

section("a server that cannot store keys says so")
appmod._claude = C.ClaudeAccounts(appmod.store, keybox=None, client_factory=factory)
r = c.put("/api/ai/claude/key", json={"key": FAKE_KEY_A}, headers=H(A))
check("no key secret in production: 503, naming the variable", r.status_code == 503 and C.SECRET_ENV in r.json()["detail"], r.text)
check("...and the status says it cannot store", c.get("/api/ai/claude", headers=H(A)).json()["can_store"] is False)

section("the privacy page")
d = repr(c.get("/api/what-we-store").json())
check("the state row's description says the key is ENCRYPTED and only counts are kept", "ENCRYPTED" in d and "never what was said" in d)
check("...and still mentions signing notes", "sign notes" in d)

logging.getLogger("nimrod.claude").removeHandler(handler)
try:
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
except Exception:  # noqa: BLE001
    pass

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
