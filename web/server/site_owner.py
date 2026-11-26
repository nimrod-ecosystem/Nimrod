"""site_owner.py - WHO MAY SAVE THE SITE'S OWN DEFAULTS (row 2.145 step 5, 2026-10-31). Tested: test_site_defaults.py.

Mike's go on "the one editor" (row 2.145, DN 1): the site's defaults are kept IN THE REPO. Step 5 gives the site's
owners a "Save as the site default" in the editor; what it does is QUEUE a checked entry for Code to apply with a commit
(site_defaults.py, the `site_default_saves` table) - it never changes what a visitor or a screen is shown. This file is
only the question that comes first: is the person asking one of the site's owners?

THE RULES:
  1. THE OWNERS ARE SERVER CONFIG, NOT A SETTING ANYBODY CAN CHANGE FROM A PAGE: the environment variable
     NIMROD_SITE_OWNERS, account ids (what /api/me says as `user`, "google:<number>" for a Google sign-in) separated by
     commas or spaces. It is set in the hosting dashboard (render.yaml: `sync: false`), so no account id is in this
     public repo.
  2. UNSET OR EMPTY MEANS NOBODY IS AN OWNER. It fails CLOSED, like the device keys (identity.py): a site that was never
     told who owns it has no owner, rather than everybody or the first person to sign in. Anything in the list that is
     not an account id (a stray quote, a word with spaces in it) is dropped, never guessed at.
  3. A SCREEN'S DEVICE KEY NEVER COUNTS. A request let in only by a screen's own key - a screen in a room, which anybody
     walking past can press - is not the owner, even when the screen is on the owner's own account. A browser that holds
     a screen's key AND an owner's own sign-in (somebody typed their way in on it) is that person, so it counts, whichever
     account the key is (2026-11-26, note GS: it used to need the key's own account; see `owner_status`).
  4. EVERY ROUTE ASKS AGAIN. The page's `site_owner` flag (/api/me, /api/whoami) only decides whether a Save button is
     drawn; the routes that keep anything check this themselves, on every request, and never trust the page.

Who is it for? A person who runs their own copy of the site sets their own list; nobody is an owner of anybody else's.

THE NUMBER (Rule 1, 2026-09-11):
  ID_MAX = 300 characters. FOR: OpenID Connect allows a subject id of up to 255 characters (Google's are 21 digits), and
    an account id here is a short prefix ("google:") and that subject; 300 holds the longest one OpenID allows with room
    for any prefix. AGAINST: nothing that long has been seen; a shorter cap would drop nothing real either. A longer
    "id" is not an account here, so it is dropped (rule 2).
"""
from __future__ import annotations

import os
import re

from identity import via_device_key

ENV = "NIMROD_SITE_OWNERS"
ID_MAX = 300
# What an account id is made of here: "google:1234", a dev login "pat", and the separators other sign-in providers use
# ("auth0|abc", "user@host"). No spaces, commas or quotes: those separate ids or are not part of one.
_ID_RE = re.compile(r"^[A-Za-z0-9_.:@|+-]+$")
_SPLIT_RE = re.compile(r"[,\s]+")


def owners(environ=None) -> frozenset:
    """The site's owners, from NIMROD_SITE_OWNERS. Empty (nobody) when it is unset, empty or holds no account id."""
    raw = (environ if environ is not None else os.environ).get(ENV, "") or ""
    out = set()
    for part in _SPLIT_RE.split(str(raw)):
        part = part.strip()
        if part and len(part) <= ID_MAX and _ID_RE.fullmatch(part):
            out.add(part)
    return frozenset(out)


# WHY THE ANSWER IS WHAT IT IS (note GS, 2026-11-26), for the editor to say in plain words. Mike set the owners list and
# saw no Save on a screen page while /api/me in another tab said site_owner true. A browser that once opened a screen
# page keeps that screen's key and sends it on every request, and a key always decides whose account the page runs on
# (identity.current_user). Before this, rule 3 asked whether the SCREEN'S ACCOUNT was an owner signed in here, so the
# owner signed in on that browser was refused whenever the key was another account's. The person is who saves a site
# default (it changes nobody's screen: it is queued for Code), so rule 3 now asks about the PERSON SIGNED IN ON THIS
# BROWSER: a key alone still never counts, and a key with an owner's own sign-in does, whichever account the key is.
OWNER = "owner"
NONE_SET = "none-set"        # NIMROD_SITE_OWNERS is unset or holds no account id
SCREEN_KEY = "screen-key"    # let in by a screen's key, and nobody is signed in on this browser
NOT_LISTED = "not-listed"    # signed in, and that account is not in the list


def owner_status(request, user: str | None, environ=None) -> tuple:
    """(the owner's account id, or None; why: OWNER / NONE_SET / SCREEN_KEY / NOT_LISTED). None on any doubt."""
    try:
        listed = owners(environ)
        if not listed:
            return None, NONE_SET
        if via_device_key(request):
            person = _person_signed_in(request)
            if not person:
                return None, SCREEN_KEY
            return (person, OWNER) if person in listed else (None, NOT_LISTED)
        if user and isinstance(user, str) and user in listed:
            return user, OWNER
        return None, NOT_LISTED
    except Exception:   # a request that cannot be read is not an owner
        return None, NOT_LISTED


def is_site_owner(request, user: str | None, environ=None) -> bool:
    """True only when the person asking is in the owners list, and a person, not a screen's key alone (rule 3)."""
    return owner_status(request, user, environ)[0] is not None


def _person_signed_in(request) -> str | None:
    """The account signed in on this browser (its session), whatever a screen's key says."""
    try:
        sess = request.session.get("user")
    except (AssertionError, AttributeError):
        return None
    return sess if isinstance(sess, str) and sess else None
