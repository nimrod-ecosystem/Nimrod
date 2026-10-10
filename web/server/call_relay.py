"""call_relay.py - "use a relay server for bigger calls": the SETTING, and the plan. Nothing here connects to anything.

Mike, 2026-10-09: "So for the group calls they'd need their own VPN or something? Seems like something maybe we make a
hookup for as an option."

NO VPN, AND NOT FOR SMALL CALLS. A call of up to four people (six with sound only) connects every device straight to
every other one - a mesh (drive.py CallGroups, call_group.js). Each device sends one copy of itself per other person,
which is fine for three others and not for ten. A BIGGER call needs a MEDIA RELAY (an "SFU", selective forwarding
unit): every device sends ONE copy up to it, and it forwards that copy to everybody else. LiveKit is the usual open
one (Apache-2.0, self-hostable, with a JavaScript client). So the hookup is: a household (or the site, one day) points
its account at a relay it runs or rents, and calls bigger than the mesh go through it. OFF BY DEFAULT: with none set,
calls stay direct and the mesh cap applies - exactly what happens today.

*** THIS DOES NOT CONTRADICT "no relay server, ever" AS MIKE MEANT IT. *** modules/call.js quotes it about OUR
server carrying people's video (and paying for it); DECISIONS.md already allows a relay that carries ENCRYPTED media
the relay cannot see (TURN). This is the same shape: somebody's OWN relay, chosen by them, carrying media it cannot
read (end-to-end encryption, below). Our server still carries only signalling.

---------------------------------------------------------------------------------------------------------------------
WHERE THE TOKEN COMES FROM - argued, because it decides whose secret sits where
---------------------------------------------------------------------------------------------------------------------
A LiveKit room is entered with a short-lived TOKEN signed with the relay's API SECRET. Somebody has to hold that secret
and sign tokens. Two choices:

  "own-server" (THE DEFAULT): the household's OWN small token service, beside its relay, signs them. Our server never
      holds their secret. The case FOR: nothing of theirs on our server (row 2.58, "I don't want anything from users
      on my server"), and a compromise of our server cannot spend their relay's bandwidth. The case AGAINST: their
      token service has to decide who gets a token, and a household cannot easily check "is this person in this call"
      - only we know that. ANSWER TO THE AGAINST: END-TO-END ENCRYPTION KEYS GO THROUGH OUR GATE. The key that
      unlocks a call's media is handed out over this site's group signalling (drive.py CallGroups), which only ever
      reaches the people let into the call. Somebody who talks their way into the relay room without being let in
      gets encrypted frames and nothing else. Their token service should still ask for something (a household
      password) so strangers cannot use their bandwidth - that is theirs to set.

  "this-site" (NOT BUILT; described so the choice is real): the household pastes the relay's API secret here, it is
      sealed with claude_ai.KeyBox exactly like the Claude and search keys (Fernet, NIMROD_AI_KEY_SECRET, bound to the
      account, never shown back), and our server signs a token only for a member CallGroups admitted. The case FOR:
      one gate, already tested, decides who even reaches the relay. The case AGAINST: their secret is on our server,
      and our server can unseal it to sign - a breach of our server could spend their bandwidth (not read their calls:
      the encryption above still holds). RECOMMENDATION: "own-server" first; build "this-site" only when a household
      asks for it and cannot run a token service. Nothing in this file stores a secret, and the route refuses no
      field it does not know - it simply keeps only the fields below (test_call_groups.py checks a secret sent to it
      is not kept).

---------------------------------------------------------------------------------------------------------------------
END-TO-END ENCRYPTION, SO THE RELAY CANNOT SEE THE CALL
---------------------------------------------------------------------------------------------------------------------
WebRTC's own encryption (DTLS-SRTP) ends AT the relay: a plain SFU decrypts, forwards and re-encrypts, so it could
see and hear everything. Insertable Streams (the browser's encoded-transform API; LiveKit wraps it as its E2EE
option, SFrame-style per-frame encryption) encrypts each frame again with a key the relay never has. The relay can
still forward the frames - it only needs the packet headers - but cannot decode them. The key is made by the person
who starts the call, sent to each member over this site's group signalling (one member at a time, CallGroups'
"to one member" rule), and replaced when somebody leaves, so a person who left cannot read what follows.

---------------------------------------------------------------------------------------------------------------------
THE REMAINING WORK (none of it started; no new downloads were made for this)
---------------------------------------------------------------------------------------------------------------------
  1. The client library: `livekit-client` (npm, Apache-2.0), served from this site like the other vendored files
     (a pinned copy under web/client/vendor/, not a CDN at call time). A few hundred KB [training knowledge, not
     checked]. Not downloaded now.
  2. call_relay.js: when a group call would pass the mesh cap AND the account has a relay set (`enabled` and a
     `url`), fetch a token (from `token_url`, sending the group id as the room name), `Room.connect(url, token)`,
     publish this device's camera and microphone once, and show every other participant's track as a tile in the
     same tile grid call_group.js fills. The words channel becomes LiveKit's data messages (`publishData`), the
     same `{type:'say'}` JSON.
  3. E2EE: `room.setE2EEEnabled(true)` with an `ExternalE2EEKeyProvider`; the key travels as a new group signal kind
     (`key`) through CallGroups - a fifth entry in drive.py's SIGNAL_KINDS, so it is opaque and capped like the rest.
  4. Moving a mesh call that grows past the cap onto the relay mid-call (everybody reconnects through it; a second or
     two of silence), or simpler first: a call that STARTS on the relay when the caller picks "a bigger call".
  5. The screen side: the Pi 400 decodes the relay's forwarded streams like any other; LiveKit's "simulcast" lets
     the relay send the Pi a SMALLER copy of each picture, which is the real fix for the Pi's decode limit.
  6. Tests: a fake Room in the client suites (no relay needed), and one manual call through a real relay on the bench.
  7. Mike's ruling on whether the site itself ever offers a shared relay (it would cost money per call-hour; the
     same "I can't be paying for everyone's tokens" question as the AI keys). Until then: households bring their own.

The account row: `_account` / `call-relay`, read and written by GET/PUT /api/me/call-relay (app.py).
"""

from __future__ import annotations

from urllib.parse import urlparse

RELAY_ROW = "call-relay"
TOKEN_FROM = ("own-server", "this-site")
DEFAULT_RELAY = {"enabled": False, "url": "", "token_from": "own-server", "token_url": "", "e2ee": True}
MAX_URL = 300


def _url(v, schemes: tuple[str, ...], what: str) -> str:
    s = ("" if v is None else str(v)).strip()
    if not s:
        return ""
    if len(s) > MAX_URL:
        raise ValueError(f"{what} is too long")
    u = urlparse(s)
    if u.scheme not in schemes or not u.netloc:
        raise ValueError(f"{what} must start with {' or '.join(x + '://' for x in schemes)}")
    return s


def clean_relay(data) -> dict:
    """The setting as it may be kept: ONLY these fields, each checked. Raises ValueError with a plain reason.

    The relay address must be wss:// (or https://, which LiveKit turns into wss://): the setting-up of the media goes
    over it, and it is never sent in the clear. The token address must be https://. `e2ee` is ON and the setting keeps
    it on (a relay that can see the call is not what this hookup is for); it is a field so a later version can say so.
    """
    if not isinstance(data, dict):
        raise ValueError("not a setting")
    out = dict(DEFAULT_RELAY)
    out["enabled"] = data.get("enabled") is True
    out["url"] = _url(data.get("url"), ("wss", "https"), "the relay address")
    tf = data.get("token_from") or "own-server"
    if tf not in TOKEN_FROM:
        raise ValueError("the token comes from your own server or (not built yet) this site")
    out["token_from"] = tf
    out["token_url"] = _url(data.get("token_url"), ("https",), "the token address")
    out["e2ee"] = True
    if out["enabled"] and not out["url"]:
        raise ValueError("a relay that is on needs its address")
    return out


def relay_view(row) -> dict:
    """What GET returns: the kept fields (defaults where nothing is set), and that nothing uses it yet."""
    try:
        v = clean_relay(row if isinstance(row, dict) else {})
    except ValueError:
        v = dict(DEFAULT_RELAY)
    return {**v, "connected": False, "status": "not built: calls stay direct (the mesh) whatever this says"}
