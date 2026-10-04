"""claude_ai.py - CLAUDE, ON ONE ACCOUNT, PAID FOR BY THAT ACCOUNT.

Mike, 2026-10-03: an optional Claude backend for ONE account's own use - "not something where I have
to pay for everyone". A local Ollama stays the default AI (nimrod_ai.js); this is the third choice,
"Claude, on this account".

WHY ON THE SERVER, when every other AI path on this site is browser-only (ai.js): the browser path
keeps a key in the browser, and a key in a browser on a care-facility kiosk is the wrong shape -
anybody at that screen, or anybody who later gets that browser, has somebody's paid account. Here the
key is pasted ONCE, from the owner's own sign-in, is stored encrypted, and is never sent back to any
client. The screens of that account use it through the server; they never hold it.

WHAT IS IN THIS FILE: the rules, with no web framework in them, so test_claude_ai.py checks every one
with a fake SDK client and a throwaway database. app.py's routes are thin calls into `ClaudeAccounts`.

  * the models, and the price table the daily cap is counted with
  * the key box (Fernet, see `KeyBox` for why)
  * turning nimrod_ai.js's request (system + messages + allowed actions) into a Messages API call:
    actions become tools with `strict: true`, tool_choice stays auto, the stable prefix is cached
  * turning the reply back into the text nimrod_ai.js already reads: a tool call becomes the same
    `[[name arg]]` line the local path writes, so the allow-list check and the press-to-confirm queue
    in the browser are exactly the ones that run today. Nothing here runs an action.
  * stop reasons (refusal, max_tokens, tool_use) and the SDK's typed errors, in plain words
  * the hard daily spend cap, counted from `response.usage`, and the per-day usage log

NEVER LOGGED, at any level here: what anybody said. Usage lines carry token counts and dollars.
NEVER SENT: audio, images, files. `build_request` refuses any message content that is not text.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone

log = logging.getLogger("nimrod.claude")

try:  # The SDK is optional at import time: the site runs without it, and says so on the page.
    import anthropic as _anthropic
except ImportError:  # pragma: no cover - depends on the install
    _anthropic = None

# A test hands in a stand-in module with the same exception class names (test_claude_ai.py), so the
# typed-error mapping is checked even where the SDK is not installed. Production never sets it.
_sdk_override = None


def sdk():
    return _sdk_override if _sdk_override is not None else _anthropic


# --------------------------------------------------------------------------------------- models
# Mike's split, recommended by the coordinator and argued here:
#   TALKING TO THE SITE (the guide, "go to the themes", two short sentences read aloud): the job is to
#   pick from a handful of allow-listed actions and say a line. Fast and cheap wins. DEFAULT
#   claude-haiku-4-5 ($1 / $5 per million tokens in / out): roughly 250 guide turns for $1. The more
#   capable choice is claude-sonnet-5-5 ($2 / $10), for somebody whose AI should hold a longer
#   conversation; about half as many turns for the same cap.
#   WRITING QUESTIONS (claude_questions.py, ahead of time, through the Batch API at half price): quality
#   is the whole job - a wrong "correct" answer is worse than no question - and nobody is waiting.
#   DEFAULT claude-opus-5-5. Sonnet and Haiku are offered for somebody who wants it cheaper.
# IDs exactly as the claude-api skill's model table spells them (no date suffixes).
CHAT_MODELS = ("claude-haiku-4-5", "claude-sonnet-5-5")
QUIZ_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5")
DEFAULT_CHAT_MODEL = "claude-haiku-4-5"
DEFAULT_QUIZ_MODEL = "claude-opus-5-5"
MODEL_LABELS = {
    "claude-haiku-4-5": "Claude Haiku 4.5 (fast, cheapest)",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 (more capable, about twice the price)",
    "claude-opus-5-5": "Claude Opus 5.5 (most careful, for writing questions)",
}

# Dollars per MILLION tokens: (input, output, cache read). A 5-minute cache write is 1.25 x input.
# From the claude-api skill's table (cached 2026-09-25). The fallback models a refusal can be re-run
# on are listed too, and ANYTHING NOT LISTED IS PRICED AT THE MOST EXPENSIVE TIER, so a model this
# table has never heard of makes the cap stop sooner, never later.
PRICES = {
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5": (2.00, 10.00, 0.20),
    "claude-opus-5": (5.00, 25.00, 0.50),
    "claude-opus-4-8": (5.00, 25.00, 0.50),
}
UNKNOWN_PRICE = (10.00, 50.00, 1.00)
CACHE_WRITE_FACTOR = 1.25
BATCH_FACTOR = 0.5

# Models where the claude-api skill says to opt into server-side refusal fallbacks by default
# ("default" routing, beta header below). Haiku 4.5 is not one of them.
FALLBACK_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def price_of(model: str) -> tuple[float, float, float]:
    return PRICES.get(model, UNKNOWN_PRICE)


# ------------------------------------------------------------------------------------- the cap
# A HARD DAILY CAP, PER ACCOUNT, IN DOLLARS. Default $1.00/day, argued:
#   FOR smaller: nothing is lost by a guide that stops answering for the rest of the day - the tree
#   works without it, and "what happens if nobody raises it?" is inaction, not a stranded screen.
#   FOR larger: a full day of talking on Sonnet is ~125 turns at ~$0.008; $1 covers an ordinary day on
#   either model with room to spare, and a runaway (a stuck retry, a room left talking) is capped at
#   the price of a coffee. The owner can set 0 (paused) to $50 (an upper bound only so a typo of
#   "1000" is refused rather than obeyed); it is on Mike's list as a number.
# "HARD" MEANS NEVER EXCEEDED, not "stopped after it was exceeded": before each call the worst case of
# THAT call (its input at a pessimistic 2 characters a token, written to cache, plus every output token
# it is allowed) must fit under what is left. The honest limit: two calls arriving at the same instant
# can both pass the check, so the cap can be overrun by one call's worst case (about a cent on Sonnet).
DEFAULT_DAILY_CAP_USD = 1.00
MAX_DAILY_CAP_USD = 50.00
CHARS_PER_TOKEN_WORST = 2.0
# The day is UTC: one clock for every screen of the account wherever it is, and the one Anthropic's
# own usage pages count in.


def today_utc(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%d")


def cost_usd(model: str, usage, *, batch: bool = False, also: str | None = None) -> float:
    """Dollars for one response's `usage`. `also`: a second model that may have served part of it (a
    refusal fallback) - the more expensive of the two is used, so the count errs high."""
    p = price_of(model)
    if also and also != model:
        q = price_of(also)
        p = q if q[1] > p[1] else p
    pin, pout, pread = p
    inp = int(getattr(usage, "input_tokens", 0) or 0)
    out = int(getattr(usage, "output_tokens", 0) or 0)
    cw = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    cr = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    usd = (inp * pin + cw * pin * CACHE_WRITE_FACTOR + cr * pread + out * pout) / 1_000_000
    return usd * (BATCH_FACTOR if batch else 1.0)


def worst_case_usd(model: str, chars_in: int, max_tokens: int, *, batch: bool = False) -> float:
    pin, pout, _ = price_of(model)
    tokens_in = chars_in / CHARS_PER_TOKEN_WORST
    usd = (tokens_in * pin * CACHE_WRITE_FACTOR + max_tokens * pout) / 1_000_000
    return usd * (BATCH_FACTOR if batch else 1.0)


def cap_refusal(spent: float, cap: float, worst: float) -> str | None:
    """None if this call may go ahead, else the sentence that says why not."""
    if cap <= 0:
        return ("Claude is paused on this account (its daily limit is set to $0). The account owner can "
                "change that in the Claude settings.")
    if spent >= cap:
        return (f"Today's Claude spending limit for this account is reached (${spent:.2f} of ${cap:.2f}). "
                "It starts again at midnight UTC, or the account owner can raise it in the Claude settings.")
    if spent + worst > cap:
        return (f"Today's Claude spending limit is nearly reached (${spent:.2f} of ${cap:.2f}), and this "
                "message could go over it. It starts again at midnight UTC, or the account owner can raise "
                "it in the Claude settings.")
    return None


def add_usage(row: dict | None, *, model: str, usage, usd: float, batch: bool = False) -> dict:
    """The day's usage row with one response added. Counts only - never content."""
    r = dict(row or {})
    def n(k): return int(getattr(usage, k, 0) or 0)
    r["requests"] = int(r.get("requests", 0)) + 1
    r["input_tokens"] = int(r.get("input_tokens", 0)) + n("input_tokens")
    r["output_tokens"] = int(r.get("output_tokens", 0)) + n("output_tokens")
    r["cache_read_tokens"] = int(r.get("cache_read_tokens", 0)) + n("cache_read_input_tokens")
    r["cache_write_tokens"] = int(r.get("cache_write_tokens", 0)) + n("cache_creation_input_tokens")
    r["usd"] = round(float(r.get("usd", 0.0)) + usd, 6)
    by = dict(r.get("by_model") or {})
    m = dict(by.get(model) or {})
    m["requests"] = int(m.get("requests", 0)) + 1
    m["usd"] = round(float(m.get("usd", 0.0)) + usd, 6)
    by[model] = m
    r["by_model"] = by
    if batch:
        r["batch_requests"] = int(r.get("batch_requests", 0)) + 1
    return r


# ------------------------------------------------------------------------------------ settings
def clean_settings(raw: dict | None) -> dict:
    """The account's Claude settings, every one defaulted. Never raises (a stored row is trusted to be
    ours, but a bad one reads as the defaults rather than a crash)."""
    o = raw if isinstance(raw, dict) else {}
    chat = o.get("chat_model") if o.get("chat_model") in CHAT_MODELS else DEFAULT_CHAT_MODEL
    quiz = o.get("quiz_model") if o.get("quiz_model") in QUIZ_MODELS else DEFAULT_QUIZ_MODEL
    try:
        cap = float(o.get("daily_cap_usd", DEFAULT_DAILY_CAP_USD))
    except (TypeError, ValueError):
        cap = DEFAULT_DAILY_CAP_USD
    if not (0 <= cap <= MAX_DAILY_CAP_USD) or cap != cap:  # NaN check
        cap = DEFAULT_DAILY_CAP_USD
    return {"chat_model": chat, "quiz_model": quiz, "daily_cap_usd": round(cap, 2)}


def apply_settings_patch(current: dict, patch: dict) -> dict:
    """A change from the settings page. Raises ValueError, in words, on anything not allowed."""
    out = clean_settings(current)
    if "chat_model" in patch and patch["chat_model"] is not None:
        if patch["chat_model"] not in CHAT_MODELS:
            raise ValueError("choose one of the offered models for talking")
        out["chat_model"] = patch["chat_model"]
    if "quiz_model" in patch and patch["quiz_model"] is not None:
        if patch["quiz_model"] not in QUIZ_MODELS:
            raise ValueError("choose one of the offered models for writing questions")
        out["quiz_model"] = patch["quiz_model"]
    if "daily_cap_usd" in patch and patch["daily_cap_usd"] is not None:
        try:
            cap = float(patch["daily_cap_usd"])
        except (TypeError, ValueError):
            raise ValueError("the daily limit is a number of dollars")
        if cap != cap or not (0 <= cap <= MAX_DAILY_CAP_USD):
            raise ValueError(f"the daily limit is between $0 (paused) and ${MAX_DAILY_CAP_USD:.0f}")
        out["daily_cap_usd"] = round(cap, 2)
    return out


# -------------------------------------------------------------------------------------- the key
# Anthropic API keys start "sk-ant-". An ADMIN key ("sk-ant-admin...") can manage the whole
# organisation - members, other keys - and this feature needs none of that, so it is refused outright:
# storing more power than the job needs is the leak this whole file exists to avoid.
KEY_RE = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{16,256}$")


def clean_key(raw: str | None) -> str:
    k = re.sub(r"\s+", "", str(raw or ""))
    if not k:
        raise ValueError("paste the key first")
    if k.startswith("sk-ant-admin"):
        raise ValueError("that is an Admin key, which can manage your whole Anthropic organisation. "
                         "Make an ordinary API key in the Anthropic Console and paste that instead")
    if not KEY_RE.match(k):
        raise ValueError("that does not look like a Claude API key (they start sk-ant-)")
    return k


SECRET_ENV = "NIMROD_AI_KEY_SECRET"
_DEV_SECRET = base64.urlsafe_b64encode(hashlib.sha256(b"nimrod-dev-only-insecure-ai-key-secret").digest())


class KeyBox:
    """Seals and opens one account's key. FERNET (the `cryptography` package, already installed as
    Authlib's dependency and now named in requirements.txt), argued:

      * THERE WAS NO SECRET FACILITY TO REUSE. The server's only secret is SESSION_SECRET, which signs
        cookies. Deriving the key-encryption key from it was considered and refused: rotating the
        session secret (the normal response to a suspected cookie leak) would silently make every
        stored key unreadable, and one leaked string would then sign sessions AND open keys.
        So: its own variable, NIMROD_AI_KEY_SECRET, a Fernet key (Fernet.generate_key()).
      * FERNET over hand-rolled AES: it is authenticated encryption with a version byte and a
        timestamp, in one call, from a maintained library. Nothing to get subtly wrong.
      * ROTATION: the variable may hold several keys, comma-separated; the FIRST seals, all of them
        open (MultiFernet). Add a new one in front, re-save, drop the old one.
      * BOUND TO THE ACCOUNT: the sealed text carries the account id, and opening checks it, so a
        sealed key copied into another account's row (by anybody with database access) opens to
        nothing rather than letting that account spend on the first one's key.
      * NO SECRET IN PRODUCTION = NO STORING, said plainly on the page. In dev (NIMROD_ENV != prod) a
        fixed, public, dev-only secret is used so the feature can be tried locally - exactly as
        SESSION_SECRET falls back to "dev-only-insecure-change-me". It protects nothing and says so.
    """

    def __init__(self, secrets: list[bytes]):
        from cryptography.fernet import Fernet, MultiFernet
        self._f = MultiFernet([Fernet(s) for s in secrets])

    @classmethod
    def from_env(cls, env=None, *, prod: bool | None = None) -> "KeyBox | None":
        env = os.environ if env is None else env
        if prod is None:
            prod = env.get("NIMROD_ENV", "dev") == "prod"
        raw = (env.get(SECRET_ENV) or "").strip()
        if raw:
            try:
                return cls([s.strip().encode() for s in raw.split(",") if s.strip()])
            except Exception:  # noqa: BLE001 - a malformed secret is "cannot store", never a crash
                log.error("%s is set but is not a valid Fernet key list", SECRET_ENV)
                return None
        return None if prod else cls([_DEV_SECRET])

    def seal(self, account: str, key: str) -> str:
        return self._f.encrypt(json.dumps({"a": account, "k": key}).encode()).decode()

    def open(self, account: str, token: str) -> str | None:
        from cryptography.fernet import InvalidToken
        try:
            d = json.loads(self._f.decrypt(str(token).encode()))
        except (InvalidToken, ValueError, TypeError):
            return None
        if not isinstance(d, dict) or d.get("a") != account or not isinstance(d.get("k"), str):
            return None
        return d["k"]


# ------------------------------------------------------------------------------ the request
MAX_MESSAGES = 60
MAX_CHARS = 60_000           # every message and the system prompt together; a guide turn is ~6-10k
MAX_ACTIONS = 20
ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,30}$")
CHAT_MAX_TOKENS = 1024       # a reply read aloud is short; nimrod_ai.js asks for 400
THINKING_HEADROOM = 1024     # Sonnet 5.5 thinks (adaptive, low effort) inside max_tokens
TOOL_NOTE = ("On this connection the requests listed above are also tools with the same names. To ask "
             "for one, call its tool (put what would follow the name in `arg`) instead of writing the "
             "double-bracket line. The person still presses a button before anything happens.")


def _tool(a: dict) -> dict:
    name = a["name"]
    args = str(a.get("args") or "").strip()[:200]
    help_ = str(a.get("help") or "").strip()[:300] or f"Ask the screen to {name}."
    props = {"arg": {"type": "string", "description": args or "what to do"}} if args else {}
    return {
        "name": name,
        "description": help_,
        "strict": True,
        "input_schema": {"type": "object", "properties": props, "required": list(props),
                         "additionalProperties": False},
    }


def build_request(body: dict, *, model: str) -> tuple[dict, set[str], int]:
    """nimrod_ai.js's request -> (kwargs for messages.create, the allowed action names, chars sent).
    Raises ValueError, in words, on anything that cannot go."""
    if not isinstance(body, dict):
        raise ValueError("nothing to send")
    raw = body.get("messages")
    if not isinstance(raw, list) or not raw:
        raise ValueError("nothing to send")
    if len(raw) > MAX_MESSAGES + 1:
        raise ValueError("that conversation is too long to send")
    system_parts: list[str] = []
    msgs: list[dict] = []
    for m in raw:
        if not isinstance(m, dict):
            raise ValueError("a message is not readable")
        role, content = m.get("role"), m.get("content")
        # TEXT ONLY. A list (image/document/audio blocks) or anything else is refused, not filtered:
        # silently dropping a picture somebody meant to send would answer a question they did not ask.
        if not isinstance(content, str):
            raise ValueError("only text can be sent to Claude from this site")
        if role == "system":
            if msgs:
                raise ValueError("the instructions must come first")
            if content.strip():
                system_parts.append(content)
            continue
        if role not in ("user", "assistant"):
            raise ValueError("a message has no sender")
        if not content.strip():
            continue
        msgs.append({"role": role, "content": content})
    if not msgs or msgs[0]["role"] != "user":
        raise ValueError("the conversation must start with the person")
    if msgs[-1]["role"] != "user":
        raise ValueError("the last message must be the person's")
    system_text = "\n\n".join(system_parts)
    chars = len(system_text) + sum(len(m["content"]) for m in msgs)

    actions = body.get("actions") or []
    if not isinstance(actions, list):
        raise ValueError("the allowed actions are not readable")
    tools, seen = [], set()
    for a in actions[:MAX_ACTIONS]:
        if not isinstance(a, dict) or not ACTION_NAME_RE.match(str(a.get("name") or "")):
            raise ValueError("an allowed action has a name that cannot be used")
        if a["name"] in seen:
            continue
        seen.add(a["name"])
        tools.append(_tool(a))
    chars += sum(len(json.dumps(t)) for t in tools)
    if chars > MAX_CHARS:
        raise ValueError("that is too much text to send at once")

    try:
        asked = int(body.get("max_tokens") or 0)
    except (TypeError, ValueError):
        asked = 0
    max_tokens = min(CHAT_MAX_TOKENS, max(64, asked or 400))
    params: dict = {}
    if model != "claude-haiku-4-5":
        # Opus 5.5 / Sonnet 5.5 think adaptively; a guide turn is chat, which the skill puts at `low`.
        params["output_config"] = {"effort": "low"}
        max_tokens += THINKING_HEADROOM

    # *** THE CACHE (render order: tools -> system -> messages). *** Three breakpoints:
    #   1. the last tool - the allow-list is the most stable thing in the request;
    #   2. the last system block - the guide's prompt changes only when the guide moves;
    #   3. the last user turn - the next turn re-reads the whole conversation from cache.
    # The tool list is kept in the order the page sent it (nimrod_ai.js's is fixed: built-ins, then
    # registered ones), never re-sorted per request. NOTE: Haiku 4.5 caches nothing under 4,096 tokens,
    # so on Haiku a short guide prompt is simply not cached - silently, and cheaply either way.
    eph = {"type": "ephemeral"}
    if tools:
        tools[-1] = {**tools[-1], "cache_control": eph}
    system_blocks = [{"type": "text", "text": system_text}] if system_text else []
    if tools:
        system_blocks.append({"type": "text", "text": TOOL_NOTE})
    if system_blocks:
        system_blocks[-1] = {**system_blocks[-1], "cache_control": eph}
    last = msgs[-1]
    msgs[-1] = {"role": "user", "content": [{"type": "text", "text": last["content"], "cache_control": eph}]}

    kwargs = {"model": model, "max_tokens": max_tokens, "messages": msgs, **params}
    if system_blocks:
        kwargs["system"] = system_blocks
    if tools:
        kwargs["tools"] = tools
        # AUTO, NEVER FORCED: forced tool_choice is a 400 on Sonnet 5.5 / Opus 5.5, and a guide that had
        # to call a tool on every turn could not just answer a question. Said explicitly, not left to a
        # default, so a future edit cannot change it without changing this line.
        kwargs["tool_choice"] = {"type": "auto"}
    return kwargs, seen, chars


# ------------------------------------------------------------------------------- the reply
REFUSAL_TEXT = "Claude declined to answer that one. Try asking another way."
CUT_OFF_EMPTY = "The answer ran too long and was cut off before it said anything. Try asking for something shorter."


def _clean_arg(v) -> str:
    s = v if isinstance(v, str) else ("" if v is None else str(v))
    return re.sub(r"[\[\]\r\n]+", " ", s).strip()[:500]


def read_reply(resp, allowed: set[str]) -> dict:
    """A Messages API response -> what nimrod_ai.js's `ai.chat` returns: `{ok, text, ...}`.

    A tool call becomes `[[name arg]]` on its own line after the words - the format parseReply in the
    browser already reads, checks against the allow-list again, and puts behind a press.
    """
    stop = getattr(resp, "stop_reason", None)
    served = getattr(resp, "model", None)
    if stop == "refusal":
        det = getattr(resp, "stop_details", None)
        return {"ok": False, "refusal": True, "reason": REFUSAL_TEXT,
                "category": getattr(det, "category", None) if det else None, "model": served,
                "stop_reason": stop}
    texts, lines = [], []
    for b in getattr(resp, "content", None) or []:
        t = getattr(b, "type", None)
        if t == "text":
            texts.append(getattr(b, "text", "") or "")
        elif t == "tool_use":
            # A CUT-OFF ANSWER IS NOT A PLAN: at max_tokens no tool call is offered, even a complete one.
            if stop == "max_tokens":
                continue
            name = getattr(b, "name", "")
            if name not in allowed:
                continue  # strict tools cannot produce this; checked anyway
            inp = getattr(b, "input", None)
            arg = _clean_arg(inp.get("arg")) if isinstance(inp, dict) else ""
            lines.append(f"[[{name}{(' ' + arg) if arg else ''}]]")
        # thinking blocks and anything else are not for the screen
    text = "\n".join(s.strip() for s in texts if s and s.strip()).strip()
    if stop == "max_tokens" and not text:
        return {"ok": False, "truncated": True, "reason": CUT_OFF_EMPTY, "model": served, "stop_reason": stop}
    full = text + (("\n" if text else "") + "\n".join(lines) if lines else "")
    return {"ok": True, "text": full, "model": served, "stop_reason": stop,
            "truncated": stop == "max_tokens", "actions_asked": len(lines)}


# ------------------------------------------------------------------------------ SDK errors
def sdk_error_reply(e: BaseException) -> tuple[int, str] | None:
    """A typed SDK error -> (HTTP status for the page, a sentence). None if it is not the SDK's.
    Most specific first. Never 401 from here: the page reads 401 as "sign in again", and this is about
    Anthropic and the stored key, not about the person's session."""
    a = sdk()
    if a is None:
        return None
    if isinstance(e, a.AuthenticationError):
        return 502, ("Anthropic did not accept this account's Claude key. The account owner can paste a new "
                     "one in the Claude settings.")
    if isinstance(e, a.PermissionDeniedError):
        return 502, "Anthropic says this key is not allowed to do that (check the key's workspace in the Anthropic Console)."
    if isinstance(e, a.NotFoundError):
        return 502, "Anthropic does not offer the chosen model to this key. Pick another model in the Claude settings."
    if isinstance(e, a.RateLimitError):
        return 429, "Anthropic says this key is sending too much right now. Try again in a minute."
    if isinstance(e, a.BadRequestError):
        return 502, "Anthropic refused the request as it was written. If it keeps happening, tell whoever looks after the site."
    if isinstance(e, a.APIStatusError):
        code = getattr(e, "status_code", 0) or 0
        if code == 402:
            return 502, "Anthropic says this account's Claude billing needs attention (there may be no credit left)."
        if code >= 500:
            return 503, "Anthropic is busy or having trouble. Try again shortly."
        return 502, f"Anthropic answered with an error ({code})."
    if isinstance(e, a.APIConnectionError):  # includes APITimeoutError
        return 504, "Could not reach Anthropic. Try again shortly."
    return None


# --------------------------------------------------------------------------- the accounts
ACCOUNT_SCOPE = "_account"          # app.ACCOUNT_SCOPE - the same reserved state scope
KEY_ROW = "claude-key"
SETTINGS_ROW = "claude-settings"
USAGE_PREFIX = "claude-usage-"     # + YYYY-MM-DD, one small row per account per day
USAGE_DAYS_SHOWN = 7


class NotSetUp(Exception):
    """No key on this account (or it no longer opens). The route answers 404 with this text."""


class Refused(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


class ClaudeAccounts:
    """Everything per account, over the ordinary state table (no new table, no migration):
    `_account` scope, rows claude-key / claude-settings / claude-usage-<day>. Real profile ids are 32
    hex characters, so `_account` never collides, and the generic state routes cannot reach it (they
    check the profile id belongs to the account, and no profile is called `_account`)."""

    def __init__(self, store, *, keybox: KeyBox | None, client_factory=None, now=None, sdk_present=None):
        self.store = store
        self.keybox = keybox
        self._factory = client_factory
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._sdk_present = sdk_present

    # -- plumbing
    def _get(self, account: str, key: str) -> dict:
        return self.store.get_state(account, ACCOUNT_SCOPE, key)

    def _put(self, account: str, key: str, data: dict) -> None:
        for _ in range(5):  # optimistic concurrency: re-read and retry on a conflicting write
            cur = self._get(account, key)
            status, _res = self.store.put_state(account, ACCOUNT_SCOPE, key, data, cur.get("version", 0))
            if status == "ok":
                return
        raise Refused(503, "could not save just now - try again")

    def _bump_usage(self, account: str, fn) -> dict:
        key = USAGE_PREFIX + today_utc(self._now())
        for _ in range(8):
            cur = self._get(account, key)
            new = fn(cur.get("data") or {})
            status, _res = self.store.put_state(account, ACCOUNT_SCOPE, key, new, cur.get("version", 0))
            if status == "ok":
                return new
        log.error("claude usage: could not record a usage row after retries (account=%s)", account)
        return {}

    def sdk_installed(self) -> bool:
        return self._sdk_present if self._sdk_present is not None else (sdk() is not None or self._factory is not None)

    def client_for(self, api_key: str):
        if self._factory is not None:
            return self._factory(api_key)
        a = sdk()
        if a is None:
            raise Refused(503, "The Claude option is not installed on this server yet (the anthropic package).")
        # One retry (not the SDK's default two): a screen waiting on a reply should hear "try again"
        # within a minute, and every retry is a request that may be billed.
        return a.Anthropic(api_key=api_key, max_retries=1, timeout=60.0)

    def client_for_account(self, account: str):
        """(an SDK client on this account's own key, its settings) - for claude_questions.py."""
        return self.client_for(self._key(account)), self.settings(account)

    def record_usage(self, account: str, *, model: str, usage, batch: bool = False) -> float:
        """Count one response against today (claude_questions.py's batch results). Returns dollars."""
        usd = cost_usd(model, usage, batch=batch)
        self._bump_usage(account, lambda d: add_usage(d, model=model, usage=usage, usd=usd, batch=batch))
        return usd

    def settings(self, account: str) -> dict:
        return clean_settings(self._get(account, SETTINGS_ROW).get("data"))

    def spent_today(self, account: str) -> float:
        d = self._get(account, USAGE_PREFIX + today_utc(self._now())).get("data") or {}
        try:
            return float(d.get("usd", 0.0))
        except (TypeError, ValueError):
            return 0.0

    def _key(self, account: str) -> str:
        row = self._get(account, KEY_ROW).get("data") or {}
        sealed = row.get("sealed")
        if not sealed:
            raise NotSetUp("Claude is not set up on this account.")
        if self.keybox is None:
            raise Refused(503, "This server cannot open stored keys right now (its key secret is not set).")
        key = self.keybox.open(account, sealed)
        if not key:
            raise NotSetUp("This account's saved Claude key can no longer be opened. Paste it again in the Claude settings.")
        return key

    # -- what the settings page sees. NEVER the key: set or not, and its last four characters.
    def status(self, account: str) -> dict:
        row = self._get(account, KEY_ROW).get("data") or {}
        s = self.settings(account)
        now = self._now()
        days = []
        for i in range(USAGE_DAYS_SHOWN):
            day = today_utc(datetime.fromtimestamp(now.timestamp() - i * 86400, timezone.utc))
            d = self._get(account, USAGE_PREFIX + day).get("data") or {}
            days.append({"day": day, "usd": round(float(d.get("usd", 0.0) or 0.0), 4),
                         "requests": int(d.get("requests", 0) or 0),
                         "input_tokens": int(d.get("input_tokens", 0) or 0),
                         "output_tokens": int(d.get("output_tokens", 0) or 0)})
        return {
            "key_set": bool(row.get("sealed")),
            "key_last4": row.get("last4") if row.get("sealed") else None,
            "key_set_at": row.get("set_at") if row.get("sealed") else None,
            **s,
            "chat_models": [{"id": m, "label": MODEL_LABELS[m]} for m in CHAT_MODELS],
            "quiz_models": [{"id": m, "label": MODEL_LABELS[m]} for m in QUIZ_MODELS],
            "max_daily_cap_usd": MAX_DAILY_CAP_USD,
            "today": days[0],
            "days": days,
            "can_store": self.keybox is not None,
            "sdk_installed": self.sdk_installed(),
            "day_is": "UTC",
        }

    def set_key(self, account: str, raw: str) -> dict:
        if self.keybox is None:
            raise Refused(503, "This server is not set up to keep keys yet (NIMROD_AI_KEY_SECRET is not set).")
        try:
            key = clean_key(raw)
        except ValueError as e:
            raise Refused(400, str(e))
        self._put(account, KEY_ROW, {"sealed": self.keybox.seal(account, key), "last4": key[-4:],
                                     "set_at": self._now().isoformat()})
        log.info("claude key set (account=%s)", account)
        return self.status(account)

    def clear_key(self, account: str) -> dict:
        # The row is OVERWRITTEN with no sealed key: the state table keeps only the latest version.
        self._put(account, KEY_ROW, {"cleared_at": self._now().isoformat()})
        log.info("claude key removed (account=%s)", account)
        return self.status(account)

    def set_settings(self, account: str, patch: dict) -> dict:
        try:
            new = apply_settings_patch(self.settings(account), patch or {})
        except ValueError as e:
            raise Refused(400, str(e))
        self._put(account, SETTINGS_ROW, new)
        return self.status(account)

    def check_key(self, account: str) -> dict:
        """Ask Anthropic whether the key works, for nothing: retrieving a model's details is not billed."""
        key = self._key(account)
        model = self.settings(account)["chat_model"]
        client = self.client_for(key)
        try:
            client.models.retrieve(model)
        except Exception as e:  # noqa: BLE001 - mapped to typed SDK errors below, else re-raised
            mapped = sdk_error_reply(e)
            if mapped is None:
                raise
            return {"ok": False, "reason": mapped[1]}
        return {"ok": True, "model": model}

    # -- the chat
    def chat(self, account: str, body: dict) -> dict:
        key = self._key(account)
        s = self.settings(account)
        model = s["chat_model"]
        try:
            kwargs, allowed, chars = build_request(body, model=model)
        except ValueError as e:
            raise Refused(400, str(e))
        spent = self.spent_today(account)
        why = cap_refusal(spent, s["daily_cap_usd"], worst_case_usd(model, chars, kwargs["max_tokens"]))
        if why:
            raise Refused(429, why)
        client = self.client_for(key)
        resp = self._create(client, kwargs)
        usage = getattr(resp, "usage", None)
        served = getattr(resp, "model", None) or model
        usd = cost_usd(model, usage, also=served) if usage is not None else 0.0
        day = self._bump_usage(account, lambda d: add_usage(d, model=served, usage=usage, usd=usd)) if usage is not None else {}
        out = read_reply(resp, allowed)
        # COUNTS ONLY. Never the words, at any level.
        log.info("claude chat account=%s model=%s stop=%s in=%s out=%s cache_r=%s cache_w=%s usd=%.5f",
                 account, served, out.get("stop_reason"), getattr(usage, "input_tokens", None),
                 getattr(usage, "output_tokens", None), getattr(usage, "cache_read_input_tokens", None),
                 getattr(usage, "cache_creation_input_tokens", None), usd)
        out["usd"] = round(usd, 6)
        out["spent_today_usd"] = round(float(day.get("usd", spent + usd)), 4)
        out["daily_cap_usd"] = s["daily_cap_usd"]
        return out

    def _create(self, client, kwargs: dict):
        model = kwargs["model"]
        try:
            if model in FALLBACK_MODELS:
                # Server-side refusal fallback, "default" routing (the claude-api skill's default for
                # Sonnet 5.5 / Opus 5.5). A refused request is re-run on Anthropic's recommended model
                # inside the same call; the cost is counted at the dearer of the two models.
                try:
                    return client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
                except Exception as e:  # noqa: BLE001
                    a = sdk()
                    # A beta this organisation is not enabled for is a 400. Then the plain call, once -
                    # an answer without the fallback beats no answer.
                    if a is not None and isinstance(e, a.BadRequestError):
                        log.warning("claude: the refusal-fallback beta was refused (400); retrying without it")
                        return client.messages.create(**kwargs)
                    raise
            return client.messages.create(**kwargs)
        except Refused:
            raise
        except Exception as e:  # noqa: BLE001 - typed SDK errors are mapped; anything else is a bug
            mapped = sdk_error_reply(e)
            if mapped is None:
                raise
            log.warning("claude chat failed: %s (status %s)", type(e).__name__, getattr(e, "status_code", None))
            raise Refused(*mapped)
