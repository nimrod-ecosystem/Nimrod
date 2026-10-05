"""page_visits.py - WHO MAY SEE YOUR PAGE, AND WHICH PARTS OF IT. The rules, pure.

Mike, 2026-10-04 (DECISIONS.md "People across accounts", items 7, 8 and 9):
  7. who can see your page: the people you are connected with, plus a "Who can see my page" setting;
  8. which parts visitors see is set in permissions, and the default is your profile - your card (picture and name)
     and nothing more; you open more parts yourself;
  9. no separate guestbook: "Leave a note" on someone's page is the regular note (notes.py, unchanged here).

Same shape as claims.py, links.py and notes.py: every question here is answered with no server, no socket and no
clock of its own, and tested alone (test_page_visits.py). app.py is the door; db.py stores.

*** WHERE THE CHOICES LIVE: IN THE PAGE RECORD ITSELF. *** The page is the person-state key `page` on the profile's
HOME row (claims.PROFILE_KEYS - only the home's login writes it), shaped by the client's page_sections.js:
    { sections: [{ kind, id, options }], visitors: 'me' | 'connections' | 'picked', picked: [<row id>, ...] }
and each section's `options.seenBy` is 'me' | 'visitors'. One record, so two devices editing it merge the way the
rest of the page merges (page_sections.js mergePageDoc), and no new table or column exists for it: the privacy
page's "state" row says it is there.

*** THE SECURITY INVARIANTS (these two are absolutes, and the tests hold them): ***
  * A visitor is never handed a part of a page that was not opened to them: the server filters, field by field
    (VISITOR_OPTIONS), and an option this file does not name is not sent - whatever the client wrote.
  * The private parts (PRIVATE_KINDS) and any kind this version does not know are never sent to a visitor, whatever
    their `seenBy` says.

Everything else here is a DEFAULT, argued where it is set.
"""
from __future__ import annotations

import recommend

PAGE_KEY = "page"

# "Who can see my page". The DEFAULT is the people you are connected with: Mike's item 7 ("That sounds good"), and
# with item 8's default (your card and nothing more) a connection opening your page sees what they already see on
# their own page - your picture and name - until you open more. "Only me" closes it; "picked" opens it to the
# connections you choose. A value this version does not know reads as "me": a choice made on a newer site must not
# open a page wider here than its owner asked for (fail closed).
WHO_KEY = "visitors"
PICKED_KEY = "picked"
WHO = ("me", "connections", "picked")
DEFAULT_WHO = "connections"

# Each section's "Who sees this". The DEFAULT is "me" (item 8: you open more parts yourself).
SEEN_KEY = "seenBy"
SEEN = ("me", "visitors")
DEFAULT_SEEN = "me"

# You (your picture and your name) is the profile: it follows "Who can see my page" and has no switch of its own.
FIXED_KIND = "self"
# The parts that may be opened to visitors.
OPENABLE_KINDS = frozenset({"about", "clock", "photos", "video"})
# The parts that are never shown to a visitor, each for a reason (page_sections.js PRIVATE_WHY says it in words):
#   messages     what people left for you: written to you, not to whoever opens your page
#   recommended  what your people sent you: the same
#   people       your people's faces and names are theirs to share, not yours; and a visitor's Call / message
#                buttons there would act on people they may have no connection with
#   connect      "Connect with someone" is a tool for you; there is nothing in it for a visitor
#   nimrod       Ask Nimrod and More open YOUR settings
PRIVATE_KINDS = frozenset({"messages", "recommended", "people", "connect", "nimrod"})

# WHAT OF EACH OPENED PART A VISITOR IS SENT - and nothing else, whatever else the record holds.
#   about   the words
#   clock   its size and its few settings (12/24 hours, the date, the clock's own size)
#   photos  its size only: the pictures come from the owner's own folder through their own media connection (an
#           address on their own machine), which is theirs alone; the visitor's page says the pictures are only on
#           the owner's own devices rather than leak that address or show a broken box
#   video   its size and the link - only if it is one YouTube video (recommend.parse_link), else no link
VISITOR_OPTIONS = {
    "about": ("text",),
    "clock": ("size", "settings"),
    "photos": ("size",),
    "video": ("size", "link"),
}
CLOCK_SETTINGS = ("hour12", "showDate", "size")
BOX_SIZES = ("small", "medium", "large")
# page_sections.js ABOUT_MAX: the server cuts what it sends to the same length the page lets anybody write.
ABOUT_MAX = 2000
LINK_MAX = 2000

# "COLOURS FOR MY PAGE" (Mike, 2026-10-05: "you can set the theme on your profile page"). The page record's `theme`
# is one of the site's theme ids (theme.js listThemes, which this file does not know - the client resolves an id it
# does not have to "keep the visitor's own colours"). A visitor of an open page is sent it, as an id and nothing
# else: anything that is not a short id is not sent. What the visitor's page DOES with it (their own High contrast
# wins) is page_sections.js pageColours, argued there.
THEME_KEY = "theme"
THEME_ID_MAX = 40


def visitor_theme(doc) -> str:
    """The page's own colours as a visitor is sent them: a theme id, or ''. PURE."""
    v = doc.get(THEME_KEY) if _is_obj(doc) else None
    if not isinstance(v, str) or not v or len(v) > THEME_ID_MAX:
        return ""
    return v if all(c.isascii() and (c.isalnum() or c in "-_") for c in v) else ""


# Why a visit is refused, in plain words (no "account", "token" or "grant"). `{name}` is the profile's name.
REFUSAL_TEXT = {
    "closed": "{name} has not opened their page to you.",
    "not-connected": "You are not connected with {name}, so their page is not open to you.",
    "yours": "This is somebody you look after. Their page is yours to change.",
}


def _is_obj(v) -> bool:
    return isinstance(v, dict)


def who_of(doc) -> str:
    """"Who can see my page", as stored, or the default. PURE. Unknown values read as "me" (fail closed)."""
    if not _is_obj(doc) or WHO_KEY not in doc or doc.get(WHO_KEY) in (None, ""):
        return DEFAULT_WHO
    v = doc.get(WHO_KEY)
    return v if v in WHO else "me"


def picked_of(doc) -> set[str]:
    """The rows (on the owner's own page) whose logins may see the page when "who" is "picked". PURE."""
    raw = doc.get(PICKED_KEY) if _is_obj(doc) else None
    return {x for x in raw if isinstance(x, str) and x} if isinstance(raw, list) else set()


def page_refusal(doc, *, linked: bool, visitor_rows: set[str] | frozenset = frozenset()) -> str:
    """Why this visitor may NOT open the page, or '' if they may. PURE.

    `linked`        the visitor's login and the owner's are connected right now (links.linked)
    `visitor_rows`  the owner's own rows that stand for the visitor (rows on the owner's page whose profile is the
                    visitor's, or that came through the visitor's login) - what a "picked" choice names
    *** A SECURITY INVARIANT: nobody who is not connected sees anybody's page through here. ***"""
    if not linked:
        return "not-connected"
    who = who_of(doc)
    if who == "connections":
        return ""
    if who == "picked" and picked_of(doc) & set(visitor_rows or ()):
        return ""
    return "closed"


def seen_by(section) -> str:
    """Who sees one section: 'visitors' or 'me'. PURE. You always 'visitors' (it follows the page's own setting);
    an openable part as its switch says (default 'me'); a private or unknown part always 'me'."""
    if not _is_obj(section):
        return "me"
    kind = section.get("kind")
    if kind == FIXED_KIND:
        return "visitors"
    if kind not in OPENABLE_KINDS:
        return "me"
    opts = section.get("options") if _is_obj(section.get("options")) else {}
    return "visitors" if opts.get(SEEN_KEY) == "visitors" else "me"


def _drawn(doc) -> list[dict]:
    """The page's sections as the page draws them (page_sections.js viewSections): entries that are not sections are
    passed over, an id seen twice counts once, and You comes first whatever the list says (added if it left it out).
    A person who never saved a page has today's default, in which only You is anything but private."""
    raw = doc.get("sections") if _is_obj(doc) else None
    if not isinstance(raw, list):
        return [{"kind": FIXED_KIND, "id": FIXED_KIND, "options": {}}]
    seen, out = set(), []
    for s in raw:
        if not _is_obj(s):
            continue
        sid, kind = s.get("id"), s.get("kind")
        if not isinstance(sid, str) or not sid or not isinstance(kind, str) or not kind or sid in seen:
            continue
        seen.add(sid)
        out.append({"kind": kind, "id": sid, "options": s.get("options") if _is_obj(s.get("options")) else {}})
    at = next((i for i, s in enumerate(out) if s["kind"] == FIXED_KIND), -1)
    me = out.pop(at) if at >= 0 else {"kind": FIXED_KIND, "id": FIXED_KIND, "options": {}}
    return [me, *out]


def visitor_options(kind: str, options) -> dict:
    """What a visitor is sent of one opened part's options (VISITOR_OPTIONS). PURE."""
    o = options if _is_obj(options) else {}
    out: dict = {}
    for k in VISITOR_OPTIONS.get(kind, ()):
        if k not in o:
            continue
        v = o[k]
        if k == "size":
            if v in BOX_SIZES:
                out["size"] = v
        elif k == "text":
            out["text"] = str(v if v is not None else "")[:ABOUT_MAX]
        elif k == "settings" and _is_obj(v):
            out["settings"] = {sk: v[sk] for sk in CLOCK_SETTINGS
                               if sk in v and isinstance(v[sk], (bool, int, float, str)) and len(str(v[sk])) <= 40}
        elif k == "link":
            link = str(v or "")[:LINK_MAX].strip()
            try:
                ref = recommend.parse_link(link) if link else None
            except recommend.Refused:
                ref = None
            if ref and ref.get("provider") == "youtube" and ref.get("kind") == "video":
                out["link"] = recommend.canonical_url(ref)
    return out


def visitor_view(doc) -> list[dict]:
    """The page as a visitor who may open it sees it: You, then each part opened to visitors, in the page's order,
    each with only what VISITOR_OPTIONS names. PURE. *** Private and unknown parts are never in it. ***"""
    out = []
    for s in _drawn(doc):
        if seen_by(s) != "visitors":
            continue
        if s["kind"] == FIXED_KIND:
            out.append({"kind": FIXED_KIND, "id": s["id"], "options": {}})
            continue
        out.append({"kind": s["kind"], "id": s["id"], "options": visitor_options(s["kind"], s["options"])})
    return out


def card_only() -> list[dict]:
    """What is left of a page for somebody it is not open to: the card (You) - which their page shows anyway."""
    return [{"kind": FIXED_KIND, "id": FIXED_KIND, "options": {}}]


def refusal_text(reason: str, name: str) -> str:
    return REFUSAL_TEXT.get(reason, "").format(name=(name or "They").strip() or "They")
