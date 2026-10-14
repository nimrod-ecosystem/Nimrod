"""storage_line.py - what the state and event routes refuse to keep. Tested alone: test_storage_line.py.

*** THE LINE (Mike, 2026-10-07; DECISIONS.md, "what the server may hold", row 2.58): nothing that is a
person's content or body goes on the server - no pictures, audio, video, recordings, voiceprints, or
health checkboxes. Small text the site needs across devices stays. ***

The state and event routes take any JSON a signed-in client sends, so the line is only as true as the
check in front of them. These are the server's half of it - security invariants, stated firmly on purpose:

  1. RAW SENSOR RECORDINGS ARE REFUSED. Event kind `device-blob` and stream `device-data` are what
     tools/collector.py sends (base64 logger bytes, ~22 KB a row). They belong on the household's own
     machine; the collector keeps them in its own spool when it has nowhere to send them.
  2. A PICTURE, SOUND OR VIDEO INSIDE THE JSON IS REFUSED: any string (value or key) that starts
     `data:image/`, `data:audio/` or `data:video/`, in any case, and any long unbroken run of base64
     (BASE64_RUN_MAX, argued below) - which is what such a thing looks like once it is text.
  3. EVERY ROW HAS A SIZE CAP: STATE_MAX_BYTES for a saved setting, EVENT_MAX_BYTES for an event.
     The cap is the backstop for whatever the two pattern rules cannot see (numbers in a list, say).
  4. PLAY HISTORY IS REFUSED ON THE EVENT ROUTES (Mike, 2026-10-07, row 2.58: "This is the kind of data
     people should keep on their own system though"): which photo, video or song played when. Event kind
     `play` (what every player appended to its panel's events: `{id, at}`) and stream `plays` (plays.js's
     shared stream, never written to before this). They are kept on the device that played them now
     (client/plays.js). A panel's stream is named by its instance id, so the kind is the only thing that
     says "a play". The rows already here are removed by remove_play_history.py, which Mike runs.
     *** CONDITIONAL SINCE 2026-10-07 (later), Mike: "maybe make having us save it as an option if it's not
     going to take a lot of space or cost us anything. It has to be scalable though." *** History MAY be kept
     here, but only (a) through the history route, never the append-only event log, (b) when the person has
     chosen "with us" for that kind in their own row (HISTORY_KEY), and (c) under a cap per person, the
     oldest rows rolled into totals (check_history and db.py history_append). The event routes still refuse
     `play` whatever the person chose: the event log cannot be deleted from or capped, so a history row in
     it would grow without end - which is the one thing "scalable" rules out.
  5. A VOICEPRINT IS REFUSED, EVERYWHERE (row 2.56; Mike, 2026-10-07: "Nothing should ever be going to us anyway").
     A voiceprint is the list of numbers that recognises a person by their voice (web/speech_service/speakers.py).
     The site's own code never holds one - the speech program never sends the numbers to a screen - so this is the
     server's half of that invariant, for a client that tries anyway. Refused, in state, events and history alike
     (it is part of check_content):
       (a) anything carrying the speech program's own tag, `"format": "nimrod-voiceprint"`, or a key named
           `voiceprint` / `voiceprints` (any case) - whatever its size or shape;
       (b) any flat list of VOICEPRINT_NUMBERS_MIN or more numbers of which nearly all (VOICEPRINT_FRACTION) have a
           fractional part - which is what a voiceprint, or a face print, looks like once it is JSON.
     A voiceprint as base64 is rule 2's (256 numbers as 32-bit floats is 1,368 characters); one split into pairs or
     rounded to whole numbers is the size cap's. No pattern catches every disguise; the point is that nothing the
     site sends trips it, and the obvious shapes are refused with a sentence.
  6. WHAT THE SUBTITLES LEARNED ABOUT A PERSON'S SPEECH IS REFUSED, EVERYWHERE (subtitle learning, 2026-10-09). When a
     subtitle is corrected ("what I said was ..."), the screen keeps the words it missed and the "heard X, meant Y"
     fixes, per person (client/subtitle_learning.js) - the names of the people and places in somebody's life, and
     how their speech is misheard. That is the person's, so it stays on their device or in their Nimrod folder.
     Refused in state, events and history alike (part of check_content): anything carrying the record's own tag,
     `"format": "nimrod-learned-words"`, or a key named `learnedWords` / `learned-words` / `learned_words` (any case).
     NO EXISTING OPT-IN COVERS IT: "Where your history is kept" (rule 4) covers what played, game results and the
     talk board's words - a person choosing "with us" for those chose nothing about this. The AUDIO a correction
     attaches to (a voice recording) is rule 2's and never leaves the device either (client/voice_recording.js).
  7. WHICH PICTURES SOMEBODY HID IS REFUSED, EVERYWHERE (hide picture, 2026-10-09). "Hide this picture" leaves a
     picture out of a slideshow; the list of hidden pictures (client/hidden_pictures.js) - which family photos
     somebody chose not to see - is kept on the device and in the person's Nimrod folder, never here. Refused in
     state, events and history alike (part of check_content, and check_event): anything carrying the record's own tag,
     `"format": "nimrod-hidden-pictures"`, a key named `hiddenPictures` / `hidden-pictures` / `hidden_pictures` (any
     case), the row kinds `hide-picture` / `unhide-picture`, and the stream `hidden`. The history route already takes
     only its three streams, so `hidden` is refused there before this rule is reached. NO OPT-IN COVERS IT ("Where your
     history is kept" is about plays, game results and board words).
     AND WHICH PICTURES SOMEBODY REMOVED (remove this picture, 2026-10-10), the same way and for the same reason: the
     list of removals (client/removed_pictures.js) is kept on the device and in the Nimrod folder, never here. Its tag
     `"format": "nimrod-removed-pictures"`, a key named `removedPictures` / `removed-pictures` / `removed_pictures`
     (any case), the row kinds `remove-picture` / `restore-picture`, and the stream `removed`.
  8. HOW A HOUSEHOLD'S DRIVES ARE DOING IS NOT KEPT HERE (drive status, 2026-10-10). Mike: "I think the point of the g
     drive is so you can see things anywhere. Let it be saved wherever the user wants." (DECISIONS.md: "A drive's status
     is saved wherever the person chooses, not on the server by default"; it answers storage roles Stage 4's open
     question with "no server copy is added".) A screen notes each picture drive's copy times, counts and free space
     in the person's own Nimrod folder (client/storage_notes.js), never here; the site's code never sends one. Refused
     in state, events and history alike (part of check_content, and check_event): anything carrying the note's own tag,
     `"format": "nimrod-drive-status"`, a key named `driveStatus` / `drive-status` / `drive_status` (any case), the row
     kind `drive-status`, and the stream `storage`. The history route takes only its three streams, so `storage` is
     refused there before this rule is reached. A note holds nobody's content, so this is not a privacy invariant like
     rules 5-7: it is the ruling held in code - nothing about a drive gains a copy here by accident. If Mike ever wants
     "with us" as a place for it (the ruling says "by default"), this rule becomes conditional the way rule 4 did.
  9. A CONVERSATION OR A STORY WITH THE TOWN'S CHARACTERS IS REFUSED, EVERYWHERE (talk with the town and free-form
     adventures, acbfb8c, 2026-10-12). client/story_ai.js keeps a story - every turn the person typed or said, the
     storyteller's replies, the running summary - on the device (localStorage, `nimrod.story.<instanceId>`) and in the
     person's Nimrod folder; never `ctx.state`, the server's copy. Refused in state, events and history alike (part of
     check_content, so check_event and check_history refuse it too): anything carrying the saved story's own tag,
     `"format": "nimrod-story"` (any case), or a key that is the device copy's own name, `nimrod.story.<anything>` (any
     case) - which is what a page copying its local storage into a setting would send. story_ai.js has no event kind
     or stream of its own, so there is none to refuse by name; an event CARRYING a story is refused by its content.
     ARGUED, so this is not read as a new absolute: it is THE LINE above, applied - "nothing that is a person's
     content goes on the server" - to one more kind of content. A conversation is the person's own words, the same
     as the subtitles' learned words (rule 6), and nothing here needs it across devices: "Carry on" reads this
     device's copy, and the Nimrod folder is where a story travels. Who wants the opposite: somebody who starts a
     story on the bedside screen and wants to carry on from a phone with no shared folder. A fair want, and the
     answer is the one rule 4 gave play history: if Mike ever wants "with us" as a place for stories, this becomes
     conditional - kept only through a capped route, only when the person chose it in their own row - not
     loosened here. (The words do pass THROUGH this site when a person picks the 'claude' storyteller,
     nimrod_ai.js: that route answers and keeps nothing. This rule is about keeping, not about passing through.)
 10. A PERSON'S OWN SOUND, OR OTHER MEDIA, IN THE SHAPES RULE 2 DOES NOT SEE, IS REFUSED, EVERYWHERE (Mike, 2026-10-13,
     DECISIONS.md: "We can't be letting people store their own audio files on the site. There should only be some
     default recordings we provide. If they want custom audio, they will have to store it themselves."). The site's own
     recordings - the talk board's shipped clips in web/client/aac/audio (aac_clips.js) - are files served from the
     site's own folder, not rows, so nothing here touches them. A person's own - a word recorded for a board card
     (board_sounds.js), a voice recording (voice_recording.js), a recording session (recorder.js) - is kept on their
     device and in their Nimrod folder, and a row carries only its NAME (`sound: {file, from}`); the board editor
     already says so in words ("Kept on this device and in your Nimrod folder"). Rule 2 sees a sound written as one
     data: address at the START of a string, or as one long base64 run. This rule sees the next obvious shapes (part of
     check_content, so state, events and history alike):
       (a) a data: address of a sound, picture, video, font or any other kind of file ANYWHERE in a string (inside
           CSS's url(...), after other words), and any data: address marked ;base64 whatever its type. A plain-text
           data: address (data:text/plain,hello) is text and passes; so do the words "data:image/" in a sentence (an
           address needs its comma).
       (b) base64 cut into pieces to get under rule 2's run: every run of WRAP_MIN or more base64 characters in the
           row, in every string, added up, over BASE64_RUN_MAX - when, joined, its letters are as mixed as encoded
           bytes are (ENCODED_BITS). Long folder paths, hex ids and long words are far less mixed and pass however
           many there are.
       (c) bytes written out as numbers: lists of BYTES_LIST_MIN or more whole numbers (or the {"0": .., "1": ..} shape
           JSON.stringify makes of a typed array), each in the range of a byte or a 16-bit sound sample, adding up to
           more than NUMBERS_MAX in the row - which is what a sound's or a picture's bytes are as JSON. (A sound's
           samples as fractional numbers are already rule 5b's.)
     ARGUED, so this is not read as a new absolute: Mike's own words call it the storage line applied - THE LINE above,
     to one more kind of content, the way rule 9 was. Who wants the opposite: somebody with no Nimrod folder who wants a
     word they recorded to play on every screen they have, or a family who wants Grandad's recorded "good morning" on a
     screen in another house. A fair want, and the answer is the one rule 4 gave play history: if Mike ever wants "with
     us" as a place for a person's own recordings, this becomes conditional - kept only through a capped route of its
     own, only when the person chose it in their own row - not loosened here.
     WHAT IT DOES NOT CLOSE, said so it is not mistaken for more: (1) a client set on it can still spread a sound over
     many small rows, each under every pattern here, because nothing counts how many rows an account keeps - that is a
     quota, not a pattern, and a number per account is Mike's call; (2) uncompressed sound (WAV) cut into
     pieces is not mixed enough for (b) and is left to the size cap - one piece over BASE64_RUN_MAX is still rule 2's.
     No pattern catches every disguise; the point, as with rule 5, is that nothing the site sends trips it and the
     obvious shapes are refused with a sentence.

THE NUMBERS ARE DEFAULTS, ARGUED (Rule 1, 2026-09-11) - measured 2026-10-07, not guessed:

  STATE_MAX_BYTES = 2 MiB. The local dev database's largest state row is 2,069 bytes (input-bindings),
    but that database holds no walkthrough notes, so it understates the real ceiling. The biggest thing the
    client can legitimately write is the person record `nimrod-ai`: up to 200 notes (nimrod_notes.js
    NOTES_MAX) of up to 4,000 characters each plus their context (~4.7 KB a note at the most, ~940 KB),
    plus the walkthrough wrap-ups kept beside them (walkthrough_wrap.js: a 1,500-character summary, a
    6,000-character cleaned copy and 300-character lines, five finished kept). With every list at its
    maximum at once that is about 1.26 MB (test_storage_line.py builds it and checks it passes); a realistic
    record is 100-400 KB (nimrod_notes.js's own estimate is ~100 KB). 2 MiB clears the all-maximums case
    with room to spare. Everything else measured or read is tens of KB at most.
  EVENT_MAX_BYTES = 16 KiB. Events are small facts: the largest legitimate one in the dev database is
    1,422 bytes (a transcript-lessons question set); game trials are under 300, points under 250, a play
    log under 130. 16 KiB is eleven times the largest seen and still refuses a 16 KB logger chunk.
  BASE64_RUN_MAX = 1,024 characters (768 bytes once decoded). The longest unbroken run of base64
    characters in any legitimate dev-database row is 32 (a hex id); OAuth-style tokens run 200-400. The
    smallest useful thumbnail is 1-2 KB (1,400-2,700 characters) and a second of the most compressed speech
    about 750 bytes, so 1,024 sits above every legitimate run and below nearly every real picture or sound.
    Runs that are wrapped over several lines (MIME style, lines of 60+ characters) are measured as one.

  VOICEPRINT_NUMBERS_MIN = 128 (rule 5b). Speaker embeddings are 128 to 512 numbers (WeSpeaker and d-vectors 256,
    ECAPA 192, x-vectors 512 [training knowledge]; the one this project uses is 256, measured). The dev database holds
    NO list of numbers at all, of any length, in any state, event or history row (measured 2026-10-07: 20,356 state
    rows, 45,277 events). For a lower floor: compact embeddings exist. Against: a chart's points or a drawing's path
    sent as one flat list could reach 128 - which is why (c) below also has to hold.
  VOICEPRINT_FRACTION = 0.9: of those numbers, at least 90% have a fractional part. An embedding's numbers are almost
    never whole; the site's own long numeric facts (milliseconds, counts, ids) are whole, so a list of 500 reaction
    times passes.

  RULE 10's NUMBERS - measured 2026-10-13 on a copy of the dev database (65,633 state, event and history rows), not
  guessed. Outside the device-data rows rule 1 refuses, it holds NO run of 60+ base64 characters, NO data: address of
  any kind anywhere in a string, and NO list longer than ten items.
  WRAP_MIN (60, above) is also (b)'s smallest piece: the same line length that already joins wrapped base64 up, and
    PEM's 64 and MIME's 76 are both over it. Shorter pieces are not counted, so ids (YouTube 11, Spotify 22, Drive 33,
    hex 32) never are. For shorter: catches pieces of 40. Against: OAuth verifiers (43-128) and Drive ids would start
    to count - still only when mixed - for little gain.
  ENCODED_BITS = 5.5 bits a character, for the joined pieces. Measured on samples: random bytes (which is what
    compressed sound - webm, mp3, ogg - and photos are) as base64 are 5.96-5.99; deep photo-folder paths 4.77-4.85;
    long German compound words 4.09; hex 4.00 (16 letters can carry no more); 64 letters can carry at most 6.0.
    5.5 sits well clear of both. For lower: base32 (5 bits) would be caught too, but so would mixed-case paths sooner.
  BYTES_LIST_MIN = 256: a list shorter than this is not counted at all, so points ([x, y, z]), a game's few scores or
    a week of counts never are. NUMBERS_MAX = 4,096 numbers in such lists in one row (a quarter of a second of 16 kHz
    sound as bytes). For more: an hourly reading for a year (8,760) - but raw readings are rule 1's and belong on the
    household's machine anyway. For fewer: catches less sound, starts to reach long charts. Whole numbers from
    -32,768 to 65,535 (NUMBER_LOW / NUMBER_HIGH) are what bytes and 16-bit samples are; times in milliseconds since
    1970 are far bigger, so a list of timestamps never counts.

  THE HISTORY CAP (rule 4, opted in) - argued, Mike's "scalable" is the test it is held to:
  HISTORY_MAX_ROWS = 10,000 rows per PERSON, every kind of history together. Measured row sizes: a play
    ~130 bytes, a game trial under 300, a board word ~200; HISTORY_ROW_MAX_BYTES (1 KiB) is the most one
    may be. So one person costs at most ~10 MB and typically 1.5-3 MB, and a thousand people opted in are
    1.5-10 GB whatever gets added later - flat, not growing (chat's figure: $0.30 per GB a month on
    Render). 10,000 is about a month of heavy use (300 a day) and a year of light use: enough for the
    picker's memory and a "this month" chart; older entries are not dropped, they are COUNTED (totals).
    For a smaller cap: cost and how much we hold about people in care. For a larger one: a year of a
    heavy user's results in full. Mike's call; one number.
  HISTORY_ROLL_BATCH = 1,000: when a person goes over the cap, the oldest (over + 1,000) rows are folded
    into totals at once, so the roll-up runs about once per thousand writes, not on every one.
  HISTORY_TOTALS_MAX = 2,000 totals rows per person per kind (one per song, video, game-and-topic, or
    board word). Bounded by the size of a person's library in practice; the cap is the backstop against a
    client that invents a new name on every row. Past it, rows are counted under "(other)".
  HISTORY_POST_MAX = 200 rows in one request: a screen that was offline for a day sends in batches.

Sizes are measured as the client sent them: compact JSON, UTF-8 - so a name in Chinese costs what it
weighs, not the six bytes per character the database's own escaping would charge.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter

STATE_MAX_BYTES = 2 * 1024 * 1024
EVENT_MAX_BYTES = 16 * 1024
BASE64_RUN_MAX = 1024

REFUSED_EVENT_KINDS = frozenset({"device-blob"})
REFUSED_EVENT_STREAMS = frozenset({"device-data"})
PLAY_HISTORY_KINDS = frozenset({"play"})
PLAY_HISTORY_STREAMS = frozenset({"plays"})

_MEDIA_PREFIXES = ("data:image/", "data:audio/", "data:video/")
# One run of base64 (standard or URL-safe alphabet), with its padding. A plain character class, so
# finditer is linear in the length of the string - no pattern here can be made to backtrack.
_RUN = re.compile(r"[A-Za-z0-9+/_-]+={0,2}")
# Base64 wrapped over lines (MIME style) is joined up only across lines of WRAP_MIN+ characters, so short
# lines (a list of ids one per line, a poem) are measured one line at a time like everything else.
WRAP_MIN = 60

SAY_KEEP_IT_HOME = "Pictures, sound, video and recordings stay on your own machine, not on this site."
# ---- rule 5: voiceprints ----
VOICEPRINT_FORMAT = "nimrod-voiceprint"           # web/speech_service/speakers.py FORMAT (test_storage_line.py holds them equal)
VOICEPRINT_KEYS = frozenset({"voiceprint", "voiceprints"})
VOICEPRINT_NUMBERS_MIN = 128
VOICEPRINT_FRACTION = 0.9
SAY_VOICEPRINT = ("This looks like a voiceprint (the numbers that recognize somebody by their voice). Voiceprints stay "
                  "on the computer that made them and are never kept on this site.")
# ---- rule 6: what the subtitles learned (subtitle learning) ----
LEARNED_FORMAT = "nimrod-learned-words"           # web/client/subtitle_learning.js LEARNED_FORMAT (the test holds them equal)
LEARNED_KEYS = frozenset({"learnedwords", "learned-words", "learned_words"})
SAY_LEARNED = ("This looks like the words the subtitles learned from being corrected (names, places, and how somebody's "
               "speech is misheard). They stay on the screen that learned them, or in the person's own Nimrod folder, "
               "and are never kept on this site.")
# ---- rule 7: which pictures somebody hid (hide picture) ----
HIDDEN_FORMAT = "nimrod-hidden-pictures"          # web/client/hidden_pictures.js HIDDEN_FORMAT (the test holds them equal)
HIDDEN_KEYS = frozenset({"hiddenpictures", "hidden-pictures", "hidden_pictures"})
HIDDEN_EVENT_KINDS = frozenset({"hide-picture", "unhide-picture"})   # hidden_pictures.js HIDE_KIND / UNHIDE_KIND
HIDDEN_EVENT_STREAMS = frozenset({"hidden"})                          # hidden_pictures.js HIDDEN_STREAM
SAY_HIDDEN = ("This looks like the list of pictures somebody hid from a slideshow. It stays on the screen where they "
              "were hidden, or in the person's own Nimrod folder, and is never kept on this site.")
# ---- rule 7, the removals (remove this picture, 2026-10-10) ----
REMOVED_FORMAT = "nimrod-removed-pictures"        # web/client/removed_pictures.js REMOVED_FORMAT (the test holds them equal)
REMOVED_KEYS = frozenset({"removedpictures", "removed-pictures", "removed_pictures"})
REMOVED_EVENT_KINDS = frozenset({"remove-picture", "restore-picture"})   # removed_pictures.js REMOVE_KIND / RESTORE_KIND
REMOVED_EVENT_STREAMS = frozenset({"removed"})                           # removed_pictures.js REMOVED_STREAM
SAY_REMOVED = ("This looks like the list of pictures somebody removed from a slideshow. It stays on the screen where "
               "they were removed, or in the person's own Nimrod folder, and is never kept on this site.")
# ---- rule 8: how the drives are doing (drive status) ----
DRIVE_FORMAT = "nimrod-drive-status"              # web/client/storage_notes.js NOTE_FORMAT (the test holds them equal)
DRIVE_KEYS = frozenset({"drivestatus", "drive-status", "drive_status"})
DRIVE_EVENT_KINDS = frozenset({"drive-status"})   # storage_notes.js NOTE_KIND
DRIVE_EVENT_STREAMS = frozenset({"storage"})      # storage_notes.js NOTES_STREAM
SAY_DRIVE = ("This looks like a note of how a picture drive is doing (its copy times, counts and free space). It is "
             "saved in the person's own Nimrod folder, wherever they keep it, and is not kept on this site.")
# ---- rule 9: a conversation or a story with the town (story_ai.js) ----
STORY_FORMAT = "nimrod-story"                     # web/client/story_ai.js STORY_FORMAT (the test holds them equal)
STORY_SAVE_PREFIX = "nimrod.story."               # web/client/story_ai.js STORY_SAVE_PREFIX (the test holds them equal)
SAY_STORY = ("This looks like a conversation or a story with the town's characters (what was said, turn by turn). It is "
             "the person's own words, so it stays on the screen where it was told, or in the person's own Nimrod "
             "folder, and is never kept on this site.")
# ---- rule 10: a person's own sound or other media, in the shapes rule 2 does not see ----
ENCODED_BITS = 5.5
BYTES_LIST_MIN = 256
NUMBERS_MAX = 4096
NUMBER_LOW, NUMBER_HIGH = -32768, 65535
# A data: address: `data:`, then an optional type/subtype, optional ;parameters, then the comma that starts the content.
# Not preceded by a letter or digit, so "metadata:" is not one. Every part is bounded or delimited by a character it
# cannot contain, so a search cannot backtrack badly on a long string.
_DATA_ADDRESS = re.compile(r"(?<![A-Za-z0-9+.\-])data:\s{0,4}(?:([A-Za-z]{1,30})/[A-Za-z0-9!#$&^_.+\-]{1,100})?"
                           r"((?:\s{0,4};[^;,\s]{1,200}){0,20})\s{0,4},", re.I)
_DATA_HINT = re.compile(r"data:", re.I)
_DATA_KIND_WORD = {"audio": "a sound", "image": "a picture", "video": "a video"}
SAY_OWN_MEDIA = ("A person's own recordings, sound files, pictures and videos are kept on their own device or in their "
                 "Nimrod folder, not on this site. The only sounds this site keeps are its own.")
SAY_PLAYS_STAY_HOME = ("What played when (which photo, video or song) is kept on the screen that played it, or where "
                       "its person chose in \"Where your history is kept\" - not in this site's log.")

# ---- rule 4, opted in: the history route (db.py history_*, app.py /api/people/{id}/history) ----
# The person's own row that says where each kind of history is kept: { plays, games, words } -> a place.
HISTORY_KEY = "history-place"
HISTORY_PLACE_US = "us"
# stream -> (the kind's name in the person's row, the event kinds that stream takes). A closed list: the
# history table is not a general store, and anything else sent to it is refused.
HISTORY_STREAMS = {
    "plays": ("plays", frozenset({"play"})),
    "gameplay": ("games", frozenset({"trial"})),
    "words": ("words", frozenset({"select"})),
}
HISTORY_ROW_MAX_BYTES = 1024
HISTORY_MAX_ROWS = 10_000
HISTORY_ROLL_BATCH = 1_000
HISTORY_TOTALS_MAX = 2_000
HISTORY_POST_MAX = 200
HISTORY_GROUP_MAX = 200          # characters of a totals row's name (a file path can be long)
HISTORY_SCOPE_MAX = 64           # characters of what a row is filed under (a panel or screen id)
OTHER_GROUP = "(other)"


def history_kind(stream: str) -> str:
    """The person-row name for a history stream, or Refused(400) for a stream that is not history."""
    hit = HISTORY_STREAMS.get((stream or "").lower())
    if not hit:
        raise Refused(400, "That is not a kind of history this site can keep. It keeps what played, game "
                           "results and the AAC board's words, and only when you choose to.")
    return hit[0]


def opted_in(place_doc, stream: str) -> bool:
    """Has the person chosen "with us" for this stream's kind? `place_doc` is their HISTORY_KEY row's data."""
    kind = history_kind(stream)
    return isinstance(place_doc, dict) and place_doc.get(kind) == HISTORY_PLACE_US


def group_of(stream: str, kind: str, data) -> str:
    """The totals row a history row is counted under when it is rolled up: what played, which game and topic,
    which word on which board. Plain text, capped. A row that names nothing is counted under its kind."""
    d = data if isinstance(data, dict) else {}
    s = (stream or "").lower()
    if s == "plays":
        parts = [d.get("source"), d.get("id")]
        sep = ":"
    elif s == "gameplay":
        parts = [d.get("game"), d.get("concept")]
        sep = "|"
    elif s == "words":
        parts = [d.get("board"), d.get("word")]
        sep = "|"
    else:
        parts = []
        sep = ":"
    words = [str(p).strip() for p in parts if p is not None and str(p).strip()]
    return (sep.join(words) if words else (kind or "?"))[:HISTORY_GROUP_MAX]


def check_history(stream: str, rows, place_doc) -> None:
    """Everything a batch for the history route must pass. Raises Refused; returns None when it may be kept.

    *** THE OPT-IN IS THE PERSON'S OWN ROW, READ BY THE SERVER, NOT A FLAG IN THE REQUEST. *** A client that
    sends history for somebody who never chose "with us" is refused (403) and nothing is kept."""
    kind_name = history_kind(stream)
    if not opted_in(place_doc, stream):
        raise Refused(403, f"This person's {HISTORY_WORDS.get(kind_name, 'history')} is not kept on this site. "
                           "It stays on their own device or in their Nimrod folder unless they choose "
                           "\"With us\" in \"Where your history is kept\".")
    if not isinstance(rows, list) or not rows:
        raise Refused(400, "Nothing to keep.")
    if len(rows) > HISTORY_POST_MAX:
        raise Refused(413, f"Send at most {HISTORY_POST_MAX} at a time.")
    kinds = HISTORY_STREAMS[stream.lower()][1]
    for r in rows:
        if not isinstance(r, dict) or (r.get("kind") or "") not in kinds or not isinstance(r.get("data"), dict):
            raise Refused(400, "Each entry needs a kind this history takes and its data.")
        size = row_bytes(r.get("data"))
        if size > HISTORY_ROW_MAX_BYTES:
            raise Refused(413, f"One entry is {size:,} bytes, and the most one can be is {HISTORY_ROW_MAX_BYTES:,}. "
                               "History entries are small facts: what, when, right or wrong.")
        check_content(r.get("data"))


# The words a refusal uses for each kind (the same words the site's own setting uses).
HISTORY_WORDS = {"plays": "record of what played", "games": "game results", "words": "AAC board words"}


class Refused(Exception):
    """A write the line refuses. `status` is the HTTP code; `detail` is the sentence a person reads."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def row_bytes(data) -> int:
    """How big a row is, as the client sent it: compact JSON, UTF-8."""
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def longest_base64_run(s: str) -> int:
    """The longest unbroken run of base64 characters in `s` (line-wrapped base64 counted as one run)."""
    best = max((m.end() - m.start() for m in _RUN.finditer(s)), default=0)
    if best > BASE64_RUN_MAX or best < WRAP_MIN or "\n" not in s:
        return best
    chain = 0                                   # a wrapped run that the next line may continue
    for raw in s.splitlines():
        line = raw.strip()
        runs = list(_RUN.finditer(line))
        full = len(runs) == 1 and runs[0].start() == 0 and runs[0].end() == len(line)
        total = chain + len(line) if (chain and full) else 0
        best = max(best, total)
        if full and len(line) >= WRAP_MIN:
            chain = total or len(line)
        elif runs and runs[-1].end() == len(line) and runs[-1].end() - runs[-1].start() >= WRAP_MIN:
            chain = runs[-1].end() - runs[-1].start()   # "...;base64," then the first line of it
        else:
            chain = 0
    return best


def _strings(data):
    """Every string in a JSON value, keys included. Iterative, so a deeply nested body cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            yield v
        elif isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str):
                    yield k
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            stack.extend(v)


def _fractional(x) -> bool:
    return isinstance(x, float) and x == x and x not in (float("inf"), float("-inf")) and not x.is_integer()


def looks_like_voiceprint(data) -> bool:
    """Rule 5: the speech program's tag, a key named voiceprint(s), or a long flat list of fractional numbers.
    Iterative, like _strings, so a deeply nested body cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str) and k.strip().lower() in VOICEPRINT_KEYS:
                    return True
                if isinstance(k, str) and k.lower() == "format" and isinstance(x, str) \
                        and x.strip().lower() == VOICEPRINT_FORMAT:
                    return True
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            if len(v) >= VOICEPRINT_NUMBERS_MIN:
                nums = [x for x in v if isinstance(x, (int, float)) and not isinstance(x, bool)]
                if len(nums) == len(v) and sum(1 for x in nums if _fractional(x)) >= VOICEPRINT_FRACTION * len(v):
                    return True
            stack.extend(v)
    return False


def looks_like_learned_words(data) -> bool:
    """Rule 6: the subtitle learning record's own tag, or a key named learnedWords (any spelling above, any case).
    Iterative, like _strings, so a deeply nested body cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str) and k.strip().lower() in LEARNED_KEYS:
                    return True
                if isinstance(k, str) and k.lower() == "format" and isinstance(x, str) \
                        and x.strip().lower() == LEARNED_FORMAT:
                    return True
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            stack.extend(v)
    return False


def looks_like_hidden_pictures(data, keys=HIDDEN_KEYS, fmt=HIDDEN_FORMAT) -> bool:
    """Rule 7: the hidden-pictures record's own tag, or a key named hiddenPictures (any spelling above, any case).
    `keys` / `fmt` are the removals' (looks_like_removed_pictures). Iterative, like _strings, so a deeply nested body
    cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str) and k.strip().lower() in keys:
                    return True
                if isinstance(k, str) and k.lower() == "format" and isinstance(x, str) \
                        and x.strip().lower() == fmt:
                    return True
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            stack.extend(v)
    return False


def looks_like_removed_pictures(data) -> bool:
    """Rule 7, the removals: the removed-pictures record's own tag, or a key named removedPictures (any case)."""
    return looks_like_hidden_pictures(data, keys=REMOVED_KEYS, fmt=REMOVED_FORMAT)


def looks_like_drive_note(data) -> bool:
    """Rule 8: the drive note's own tag, or a key named driveStatus (any spelling above, any case).
    Iterative, like _strings, so a deeply nested body cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str) and k.strip().lower() in DRIVE_KEYS:
                    return True
                if isinstance(k, str) and k.lower() == "format" and isinstance(x, str) \
                        and x.strip().lower() == DRIVE_FORMAT:
                    return True
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            stack.extend(v)
    return False


def looks_like_story(data) -> bool:
    """Rule 9: a saved story's own tag, or a key named after the device copy (nimrod.story.<id>), any case.
    Iterative, like _strings, so a deeply nested body cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str) and k.strip().lower().startswith(STORY_SAVE_PREFIX):
                    return True
                if isinstance(k, str) and k.lower() == "format" and isinstance(x, str) \
                        and x.strip().lower() == STORY_FORMAT:
                    return True
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            stack.extend(v)
    return False


def media_data_address(s: str) -> str | None:
    """Rule 10a: the type of the first data: address of a file anywhere in `s` ('audio', 'image', 'font', ... or
    'base64' for one marked ;base64 with no type), or None. A plain-text data: address is not one."""
    if not isinstance(s, str) or not _DATA_HINT.search(s):
        return None
    for m in _DATA_ADDRESS.finditer(s):
        kind = (m.group(1) or "").lower()
        params = [p.strip().lower() for p in (m.group(2) or "").split(";") if p.strip()]
        if kind and kind != "text":
            return kind
        if "base64" in params:
            return kind or "base64"
    return None


def _bits_per_letter(counts: dict, n: int) -> float:
    return -sum(c / n * math.log2(c / n) for c in counts.values()) if n else 0.0


def encoded_pieces(data, strings=None) -> tuple[int, float]:
    """Rule 10b: (how many characters of base64 there are in runs of WRAP_MIN or more, over every string in the row,
    and how mixed those characters are, in bits a character). `strings`: the row's strings, if already gathered."""
    total = 0
    counts: Counter = Counter()          # counted in C, so a 2 MiB row costs milliseconds, not a second
    for s in (strings if strings is not None else _strings(data)):
        if len(s) < WRAP_MIN:
            continue
        for m in _RUN.finditer(s):
            if m.end() - m.start() >= WRAP_MIN:
                total += m.end() - m.start()
                counts.update(m.group())
    return total, _bits_per_letter(counts, total)


def _small_whole(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and NUMBER_LOW <= x <= NUMBER_HIGH


def bytes_as_numbers(data) -> int:
    """Rule 10c: how many small whole numbers the row holds in lists of BYTES_LIST_MIN or more (a typed array's
    {"0": .., "1": ..} shape counted the same). Iterative, like _strings, so a deeply nested body cannot blow the stack."""
    total = 0
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            if len(v) >= BYTES_LIST_MIN and all(isinstance(k, str) and k.isdigit() for k in v) \
                    and all(_small_whole(x) for x in v.values()):
                total += len(v)
                continue
            stack.extend(x for x in v.values() if isinstance(x, (dict, list, tuple)))
        elif isinstance(v, (list, tuple)):
            if len(v) >= BYTES_LIST_MIN and all(_small_whole(x) for x in v):
                total += len(v)
                continue
            stack.extend(x for x in v if isinstance(x, (dict, list, tuple)))   # only what can hold a list
    return total


def check_own_media(data) -> None:
    """Rule 10: a person's own sound or other media in the shapes rule 2 does not see. Raises Refused."""
    strings = list(_strings(data))
    for s in strings:
        kind = media_data_address(s)
        if kind:
            what = _DATA_KIND_WORD.get(kind, "a file")
            raise Refused(400, f"This has {what} inside it, written as a data: address. " + SAY_OWN_MEDIA
                          + " Save a link to where it lives instead.")
    total, bits = encoded_pieces(data, strings)
    if total > BASE64_RUN_MAX and bits >= ENCODED_BITS:
        raise Refused(400, f"This has {total:,} characters of encoded data inside it, in pieces, which is what a "
                           f"sound or a picture looks like once it is cut up to fit (the most allowed is "
                           f"{BASE64_RUN_MAX:,} in all). " + SAY_OWN_MEDIA)
    n = bytes_as_numbers(data)
    if n > NUMBERS_MAX:
        raise Refused(400, f"This has {n:,} small whole numbers in long lists inside it, which is what a sound or a "
                           f"picture looks like once its bytes are written out as numbers (the most allowed is "
                           f"{NUMBERS_MAX:,}). " + SAY_OWN_MEDIA)


def check_content(data) -> None:
    """Rule 2: no picture, sound or video inside the JSON, as a data: address or as a long base64 run.
    Rule 5: no voiceprint. Rule 6: no record of what the subtitles learned. Rule 7: no list of hidden pictures.
    Rule 8: no note of how a drive is doing. Rule 9: no conversation or story with the town.
    Rule 10: no person's own sound or other media in the shapes rule 2 does not see (check_own_media)."""
    if looks_like_voiceprint(data):
        raise Refused(400, SAY_VOICEPRINT)
    if looks_like_learned_words(data):
        raise Refused(400, SAY_LEARNED)
    if looks_like_hidden_pictures(data):
        raise Refused(400, SAY_HIDDEN)
    if looks_like_removed_pictures(data):
        raise Refused(400, SAY_REMOVED)
    if looks_like_drive_note(data):
        raise Refused(400, SAY_DRIVE)
    if looks_like_story(data):
        raise Refused(400, SAY_STORY)
    for s in _strings(data):
        if s.lstrip()[:11].lower().startswith(_MEDIA_PREFIXES):
            raise Refused(400, "This has a picture, a sound or a video inside it. " + SAY_KEEP_IT_HOME
                          + " Save a link to where it lives instead.")
        run = longest_base64_run(s) if len(s) > BASE64_RUN_MAX else 0
        if run > BASE64_RUN_MAX:
            raise Refused(400, f"This has {run:,} characters of encoded data in a row inside it, which is what a "
                               f"picture, a sound or a recording looks like as text (the most allowed is "
                               f"{BASE64_RUN_MAX:,}). " + SAY_KEEP_IT_HOME)
    check_own_media(data)


def _too_big(what: str, size: int, cap: int) -> Refused:
    return Refused(413, f"This {what} is too big to keep here: {size / 1024:,.0f} KB, and the most one can be is "
                        f"{cap / 1024:,.0f} KB. " + SAY_KEEP_IT_HOME)


def check_state(data) -> None:
    """Everything a saved setting (state row) must pass. Raises Refused; returns None when it may be kept."""
    size = row_bytes(data)
    if size > STATE_MAX_BYTES:
        raise _too_big("saved setting", size, STATE_MAX_BYTES)
    check_content(data)


def check_event(stream: str, kind: str, data) -> None:
    """Everything an event must pass. Raises Refused; returns None when it may be kept."""
    if (kind or "").lower() in REFUSED_EVENT_KINDS or (stream or "").lower() in REFUSED_EVENT_STREAMS:
        raise Refused(400, "Raw sensor recordings are not kept on this site. Keep them on the household's own "
                           "machine: point the collector's server setting there, or leave it empty and the "
                           "recordings stay in the collector's own spool.")
    if (kind or "").lower() in PLAY_HISTORY_KINDS or (stream or "").lower() in PLAY_HISTORY_STREAMS:
        raise Refused(400, SAY_PLAYS_STAY_HOME)
    if (kind or "").lower() in HIDDEN_EVENT_KINDS or (stream or "").lower() in HIDDEN_EVENT_STREAMS:
        raise Refused(400, SAY_HIDDEN)      # rule 7: a hide / bring-back row, or the stream they are kept in
    if (kind or "").lower() in REMOVED_EVENT_KINDS or (stream or "").lower() in REMOVED_EVENT_STREAMS:
        raise Refused(400, SAY_REMOVED)     # rule 7: a remove / bring-back row, or the stream they are kept in
    if (kind or "").lower() in DRIVE_EVENT_KINDS or (stream or "").lower() in DRIVE_EVENT_STREAMS:
        raise Refused(400, SAY_DRIVE)       # rule 8: a drive note, or the stream it is kept in
    size = row_bytes(data)
    if size > EVENT_MAX_BYTES:
        raise _too_big("event", size, EVENT_MAX_BYTES)
    check_content(data)
