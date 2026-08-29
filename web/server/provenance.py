"""provenance.py - WHO PRODUCED THIS ROW, AND WHO WAS IN THE ROOM.

Pure rules, no storage - the same shape as `grants.py` and `links.py`.

Design: `docs/from_chat/for_code.md` sections 9f and 9g (private repo), decided 2026-08-27.

*** WHY THIS LANDED BEFORE THE FIRST TRIAL, AND WHY IT COULD NOT WAIT ***

An append-only log has no update. A field that does not exist at write time can NEVER be
supplied afterwards - you can append a correction, but a correction has to be *about*
something, and a trial written with no notion of a producer has nothing to correct against.

    A FIELD THAT EXISTS AND IS EMPTY IS SELF-DESCRIBING.
    A FIELD THAT DOES NOT EXIST YET PRODUCES DATA THAT LOOKS COMPLETE.

That asymmetry is the whole argument. Someone filtering for human trials in two years would
otherwise get a clean-looking result set that silently includes synthetic play, because before
the column existed nothing was excluded. And there is no forensic recovery: a game emits
hit/miss with latency, and an agent playing that game emits hit/miss with latency. Same shape,
same fields, same server stamp, no residue.

*** THE SCHEMA IS A FLOOR, NOT A CEILING (Mike, 2026-08-28) ***

    "I would nail down the basic schema and let it be added to by whichever fields a
     game/study needs."

So: a small fixed core that every row carries and nothing may redefine, plus `extra` - an open
namespace a game or a study fills with whatever it measures. `merge_extra` refuses to let an
extension shadow a core field, because the day a module writes its own `principal_type` is the
day the core column stops meaning one thing.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# THE FIVE PROVENANCE COLUMNS - section 9f's minimum set
# ---------------------------------------------------------------------------
#   principal_id      which principal produced the event
#   principal_type    denormalised ON PURPOSE - it is the filter every consumer actually
#                     uses, and it has to survive the principal being renamed or deleted
#   attested_by       A PRINCIPAL REFERENCE, NOT A BOOLEAN. This is what makes "a clinician
#                     attested this" and "her brother observed it" different values in one
#                     field rather than the same `true`
#   attested_at       WHEN, not just whether. Attesting from memory months later is
#                     recollection, not attestation, and the gap is what shows that
#   producer_version  which version of the board, module or prompt produced it. Without it a
#                     change you make six months from now is indistinguishable in the data
#                     from the person changing - the exact question this telemetry exists for
PROVENANCE_FIELDS = (
    "principal_id", "principal_type", "attested_by", "attested_at", "producer_version",
)

PRINCIPAL_TYPES = ("human", "local_model", "cloud_service")


# ---------------------------------------------------------------------------
# THE FOUR NON-ANSWERS - section 9g, and this is the third place the same lesson lands
# ---------------------------------------------------------------------------
# Collapsing any two of these corrupts every denominator built on top of them.
NON_ANSWERS = {
    "": "nobody got to it - absent, not skipped",
    "prefer_not_to_say": "asked, and declined. A choice, and a legitimate answer",
    "other": "they have an answer and it is not on your list; carries optional free text",
    "unknown": "asked, and they genuinely do not know",
}

#: `other` does a second job: its free text is never aggregated, but its COUNT is, and a
#: rising rate is the cleanest signal available that the controlled vocabulary is wrong for
#: the people actually using the product. Surface it deliberately.
OTHER = "other"


# ---------------------------------------------------------------------------
# THE ROSTER - section 9g, plus Mike's 2026-08-28 additions
# ---------------------------------------------------------------------------
# Per-trial "who was present" is unworkable: in a real room people come and go all day and
# nobody is going to tag four hundred trials. So a SESSION carries the roster and trials
# carry one `session_id`. Correcting who was present appends a correction to the SESSION,
# which an append-only log can do; editing four hundred trials is not something it can do.
#
# `player` is Mike's addition - the original list had no word for somebody who is just
# playing. `subject` is a clinical role and most people in a game are not subjects.
ROSTER_ROLES = (
    "subject", "player", "moderator", "clinician", "family", "aide", "observer",
)

#: Mike: *"Spots for every user and their class (moderator, player). Up to maybe 8 players."*
#: A cap that exists to catch a bug rather than to limit anybody - a roster of 200 is a loop
#: that ran away, not a therapy session. Players only; observers are not capped.
MAX_PLAYERS = 8

END_REASONS = ("ended_by_person", "ended_by_inactivity", "ended_by_cap")

# Ordered LEAST to MOST help. The distance between "correct unaided" and "correct after a
# gestural cue", tracked over weeks, IS the progress measure - which is why cueing is a
# recorded field rather than something to worry about. `unknown` is NOT `none`.
CUE_LEVELS = ("none", "verbal_general", "verbal_specific", "gestural", "physical_partial",
              "physical_full")

# Session timers. Section 9g: elapsed time must NEVER end an active session; inactivity does.
DEFAULT_EXPECTED_MIN = 30
DEFAULT_OVERSHOOT_FRACTION = 0.5     # +50% past expected...
MIN_OVERSHOOT_MIN = 15               # ...but never less than 15 minutes of grace
DEFAULT_INACTIVITY_MIN = 15


def normalize_principal_type(t: str | None) -> str | None:
    """Unknown types become None - "not captured" - rather than a guess.

    Deliberately NOT `grants.normalize_role`'s quiet default. A role only narrows what an
    already-authorised person may do, so defaulting a typo is harmless. A principal type is a
    CLAIM ABOUT WHO MADE THIS DATA, and defaulting a typo to `human` would write a falsehood
    into an append-only log that can never be corrected.
    """
    if t is None:
        return None
    v = str(t).strip().lower()
    return v if v in PRINCIPAL_TYPES else None


def normalize_role(role: str | None) -> str | None:
    if role is None:
        return None
    r = str(role).strip().lower()
    return r if r in ROSTER_ROLES else None


def normalize_cue(level: str | None) -> str | None:
    """`unknown` and `none` are DIFFERENT and both are valid - see NON_ANSWERS."""
    if level is None:
        return None
    c = str(level).strip().lower()
    if c == "unknown":
        return "unknown"
    return c if c in CUE_LEVELS else None


def cue_rank(level: str | None) -> int | None:
    """How much help was given, as an ordinal. None for unknown/unset - and that is the point:
    an unknown cue level must not sort as "no help given"."""
    c = normalize_cue(level)
    if c is None or c == "unknown":
        return None
    return CUE_LEVELS.index(c)


class SchemaCollision(ValueError):
    """An extension tried to redefine a core field."""


#: Everything a row carries that an extension may not shadow.
CORE_FIELDS = frozenset(PROVENANCE_FIELDS) | {
    "session_id", "role", "cue_level", "prompt_delivered_by", "id", "created_at",
    "user_id", "profile_id", "stream", "kind",
}


def merge_extra(core: dict, extra: dict | None) -> dict:
    """Attach a game's or a study's own fields, refusing to let them shadow a core one.

    *** THIS IS THE RULE THAT MAKES "EXTENSIBLE" SAFE. *** The schema is a floor and anything
    may add to it - but the day a module writes its own `principal_type` is the day the core
    column stops meaning one thing, and every filter built on it silently starts lying. It
    RAISES rather than dropping the key, because a study that thinks it recorded something and
    did not is worse off than one that failed loudly at write time.
    """
    out = dict(core)
    if not extra:
        return out
    clashes = sorted(k for k in extra if k in CORE_FIELDS)
    if clashes:
        raise SchemaCollision(
            f"extension fields may not redefine core fields: {', '.join(clashes)}")
    out["extra"] = dict(extra)
    return out


def roster_problem(roster: list[dict] | None) -> str | None:
    """What is wrong with this roster, in a person's words, or None. PURE.

    Returns a MESSAGE rather than raising, because the caller (a session start) usually wants
    to tell somebody what to fix rather than blow up mid-therapy.
    """
    rows = roster or []
    if not rows:
        # Not an error. An empty roster is honest - nobody said who was there - and it is far
        # better than a confidently wrong one. See the auto-close rules.
        return None
    for r in rows:
        if not r.get("principal_id"):
            return "every roster entry needs a principal"
        if normalize_role(r.get("role")) is None:
            return f"unknown role {r.get('role')!r}"
    players = [r for r in rows if normalize_role(r.get("role")) in ("player", "subject")]
    if len(players) > MAX_PLAYERS:
        return f"more than {MAX_PLAYERS} players in one session ({len(players)})"
    ids = [r["principal_id"] for r in rows]
    if len(set(ids)) != len(ids):
        return "the same principal is listed twice"
    return None


def auto_close(*, started_at_ms: int, last_event_ms: int | None, now_ms: int,
               expected_min: int = DEFAULT_EXPECTED_MIN,
               inactivity_min: int = DEFAULT_INACTIVITY_MIN,
               overshoot_fraction: float = DEFAULT_OVERSHOOT_FRACTION,
               min_overshoot_min: int = MIN_OVERSHOOT_MIN) -> dict | None:
    """Should this session end by itself, and how? PURE. None means leave it open.

    *** ELAPSED TIME MUST NEVER END AN ACTIVE SESSION. INACTIVITY DOES. *** Mike's instinct,
    and it is the right one: a therapy session that is going well is exactly the one you must
    not cut at minute 31. The cap is a backstop for a tablet left on, not the mechanism for a
    normal ending.

    *** AND AN AUTO-CLOSE IS BACKDATED TO THE LAST EVENT ***, not to the moment the timer
    fired, or every inactivity-closed session carries 15 minutes of phantom duration into any
    length statistic. The timer moment is kept as a separate field because the gap is itself
    informative.
    """
    last = last_event_ms if last_event_ms is not None else started_at_ms
    idle_ms = now_ms - last
    inactivity_ms = inactivity_min * 60_000
    expected_ms = expected_min * 60_000
    grace_ms = max(int(expected_ms * overshoot_fraction), min_overshoot_min * 60_000)
    cap_ms = expected_ms + grace_ms
    elapsed_ms = now_ms - started_at_ms

    if idle_ms >= inactivity_ms:
        return {"reason": "ended_by_inactivity", "ended_at_ms": last,
                "detected_at_ms": now_ms,
                "ran_over_by_ms": max(0, last - started_at_ms - expected_ms)}
    # Only reachable while events are still arriving - a session being actively used past its
    # cap. The roster on this one is the least trustworthy of the three and anything reading
    # it should know that.
    if elapsed_ms >= cap_ms:
        return {"reason": "ended_by_cap", "ended_at_ms": now_ms, "detected_at_ms": now_ms,
                "ran_over_by_ms": elapsed_ms - expected_ms}
    return None
