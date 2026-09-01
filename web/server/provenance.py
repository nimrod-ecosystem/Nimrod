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
#   principal_type    denormalized ON PURPOSE - it is the filter every consumer actually
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

# ---------------------------------------------------------------------------
# *** IS THIS ROSTER EVERYBODY? - three states, not two ***
# ---------------------------------------------------------------------------
# Mike, 2026-08-28, inverting an argument I had backwards: unassisted SOLO play is the MAIN
# use case and the CLEANEST data the system produces, because *you know for sure nobody
# assisted them*. The single biggest confound in every measurement here is the person in the
# room - it is what cue_level, prompt_delivered_by and moderator-comparison-off-by-default all
# exist to manage. A solo session deletes that confound at the source instead of modelling it.
#
# So "she played alone" has to be a POSITIVE ASSERTION, not an inference from a short list.
# Fifth appearance of the four-non-answers lesson:
#
#   None   nobody said whether this is everybody          <- absent, NOT "solo"
#   True   confirmed: this is everybody who was here
#   False  known to be incomplete - somebody was here and is not listed
#
# A one-row roster with `roster_complete=None` is NOT solo. It is one person we know about.
ROSTER_COMPLETE_STATES = (None, True, False)


def is_solo(roster: list[dict] | None, roster_complete: bool | None = None,
            max_players: int | None = None) -> bool:
    """Did exactly one person play, with nobody helping, ATTESTED? PURE.

    *** MIKE'S POINT ABOUT max_players, AND IT IS THE GOOD HALF OF THE ANSWER: ***

        "the max number of players for a module can determine how many player rows"

    A module that DECLARES it takes one player could never have had a second, so solo is
    STRUCTURAL there rather than a claim somebody has to make - and a structural fact needs no
    human to attest it. That is why `max_players == 1` alone is enough.

    For anything that COULD have had more, somebody has to say so, because a null slot cannot
    distinguish "nobody was there" from "nobody wrote it down" - which is the whole reason
    `roster_complete` exists rather than counting rows.
    """
    rows = roster or []
    players = [r for r in rows if normalize_role(r.get("role")) in ("player", "subject")]
    helpers = [r for r in rows
               if normalize_role(r.get("role")) in ("moderator", "clinician", "aide")]
    if len(players) != 1 or helpers:
        return False
    # A single-player module: solo is a property of the module, not a claim about the room.
    if max_players == 1:
        return True
    return roster_complete is True

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


# ---------------------------------------------------------------------------------------
# ATTESTATION - somebody looked at a row and vouched for it.
#
# *** PRESENCE IS NOT ATTESTATION, AND THIS IS THE DISTINCTION THE FIELD EXISTS TO KEEP. ***
# A clinician moderating a session was IN THE ROOM. Attesting means they LOOKED AT THIS
# OBSERVATION AND VOUCHED FOR IT. If the second is generated from the first, `attested_by`
# empties out: every row a clinician was near carries their name whether they reviewed it or
# not, and nobody downstream can tell a vouched row from a merely-witnessed one. The roster
# already records who was in the room (ROSTER_ROLES), truthfully and for free - that is the
# fact worth having, and it costs nobody a claim they did not make.
#
# *** AN ATTESTATION IS ITS OWN APPEND-ONLY EVENT THAT CITES A TARGET. NOT A FIELD ON IT. ***
# Three things fall out, and none of them needed a new trust model:
#
#   1. THE ATTESTER IS THE AUTHENTICATED USER. You may only attest AS YOURSELF, so the server
#      never has to evaluate a claim about a third party. `attested_by` is stamped from the
#      session, NEVER read from the request body - which is the whole reason the four
#      attestation columns were left unpostable in the first place.
#   2. `attested_at` IS REAL. It is when the attestation row was written, which is genuinely
#      when somebody looked. The spec's own words: "attesting from memory months later is
#      recollection, not attestation, and the gap between event time and attest time is what
#      shows that." An auto-stamp at trial time would destroy exactly that gap.
#   3. APPEND-ONLY IS INTACT. Events cannot be updated, so attestation could never have been a
#      mutation of the trial row. This is the only shape that was ever going to work.
#
# TWO PEOPLE MAY ATTEST THE SAME ROW, and the same person may attest it again later - a second
# look months on is a real event and the timestamps say so. Neither is deduplicated, because
# collapsing them would throw away the thing that makes attestation worth recording.
# ---------------------------------------------------------------------------------------

ATTESTATION_KIND = "attestation"


def attestation_problem(target: dict | None, attester: str | None) -> str | None:
    """What is wrong with attesting this row, in a person's words, or None. PURE."""
    if not attester:
        return "an attestation needs somebody making it"
    if not target:
        return "there is nothing here to attest"
    # NOT A NESTING TREE. Vouching for a vouching is not a claim about the observation, and
    # allowing it invites a chain nobody can summarize. Attest the trial.
    if target.get("kind") == ATTESTATION_KIND:
        return "an attestation cannot itself be attested - attest the row it cites"
    if not target.get("id"):
        return "the row being attested has no id to cite"
    return None


def attestation_row(*, target_id, attester: str, note: str = "") -> dict:
    """The event body for an attestation. PURE - storage stamps the columns.

    The citation lives in `data.attests` rather than in a column because it is a reference
    between two rows of the SAME table, and the provenance columns are about who produced a
    row rather than what it points at.
    """
    body = {"attests": target_id, "attested_by": attester}
    if note:
        # Free text, and deliberately not on any allowlist - it never leaves the machine
        # through the research payload, which carries no attestation fields at all.
        body["note"] = str(note)[:2000]
    return body


def attestations_for(events: list[dict] | None, target_id) -> list[dict]:
    """Every attestation citing this row, oldest first. PURE."""
    return [e for e in (events or [])
            if e.get("kind") == ATTESTATION_KIND
            and (e.get("data") or {}).get("attests") == target_id]


def attesters_of(events: list[dict] | None, target_id) -> list[str]:
    """WHO vouched for this row - distinct, in the order they first did. PURE.

    A LIST, NOT A BOOLEAN, for the same reason `attested_by` is a principal reference: "a
    clinician attested this" and "her brother did" are the whole point, and an is_attested()
    flag would flatten exactly the distinction the CRS-R work turns on.
    """
    seen: list[str] = []
    for e in attestations_for(events, target_id):
        who = e.get("attested_by") or (e.get("data") or {}).get("attested_by")
        if who and who not in seen:
            seen.append(who)
    return seen


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
