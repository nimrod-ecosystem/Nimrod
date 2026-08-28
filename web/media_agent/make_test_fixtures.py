#!/usr/bin/env python3
"""Build the media-agent fixture trees the browser suites need, and print how to serve them.

WHY THIS EXISTS. `photos_test.html`, `personal_test.html`, `media_sources_test.html` and
`media_stall_test.html` mount the REAL modules against a REAL local media agent. Without one
running they fail on "Failed to fetch" -- which is why `personal_test` sat in the handoffs as
NOT RUN rather than green for weeks, and why a change to the photos or personal module could
not be checked against anything.

The suites assert on LISTINGS, names, counts and element wiring -- not on decoded pixels or
audio -- and the agent classifies purely by file extension. So tiny stand-ins are enough. They
are GENERATED rather than committed because binary fixtures in a repo are a thing nobody ever
updates, and because a fake .mp4 sitting in the tree is exactly the file somebody later
mistakes for real content.

    python make_test_fixtures.py

Then run the two agents it names, and the suites go green.

*** WHAT THESE FIXTURES CANNOT TEST. *** The .mp4 files are valid CONTAINERS with nothing
decodable inside. Playback, codecs, audio, and anything about how a clip actually looks on a
Pi are outside every test that uses them. `media_stall_test.html` stubs `play()` and `src`
deliberately for that reason and says so. Real clips on real hardware remain a separate,
manual check.
"""
import base64
import os
import shutil
import sys

BASE = os.path.join(
    os.environ.get('TEMP') or os.environ.get('TMPDIR') or '/tmp', 'nimrod_fixtures')

# A 1x1 PNG. Small enough to inline, real enough for an <img> to fire `load`.
PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8'
    'z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)

# A minimal MP4 container: ftyp + free + an empty mdat. Enough to be a .mp4 as far as the
# agent (which reads the extension) and the module (which reads the listing) are concerned.
MP4 = (
    b'\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41'
    b'\x00\x00\x00\x08free'
    b'\x00\x00\x00\x08mdat'
)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def main():
    if os.path.isdir(BASE):
        shutil.rmtree(BASE)

    # --- the photos agent (:8770) -----------------------------------------------------
    photos = os.path.join(BASE, 'photos')
    for i in range(1, 7):
        write(os.path.join(photos, 'sample-%02d.png' % i), PNG)
    # One nested album, so "the root album" is a meaningful phrase rather than "everything".
    for i in range(1, 3):
        write(os.path.join(photos, 'Holiday', 'holiday-%02d.png' % i), PNG)

    # --- the personal-video agent (:8771) ----------------------------------------------
    # personal_test asserts EXACTLY TWO video clips and that non-video files are skipped, so
    # the .amr and the extensionless file are part of the fixture, not clutter. The agent's
    # root is the Oscar folder itself: the suite's URL check is /files/Oscar..., which the
    # file names satisfy on their own.
    oscar = os.path.join(BASE, 'oscar')
    write(os.path.join(oscar, 'Oscar Counting To 100.mp4'), MP4)
    write(os.path.join(oscar, 'Oscar singing ABC.mp4'), MP4)
    write(os.path.join(oscar, 'Oscar mumbling.amr'), b'#!AMR\n')
    write(os.path.join(oscar, 'notes'), b'not media at all')

    print('fixtures written under %s\n' % BASE)
    print('Now run BOTH agents (each in its own terminal), then open the suites:\n')
    print('  python agent.py --root "%s" --port 8770 --origin http://localhost:8000' % photos)
    print('  python agent.py --root "%s" --port 8771 --origin http://localhost:8000' % oscar)
    print('\n  http://localhost:8000/dev/photos_test.html')
    print('  http://localhost:8000/dev/personal_test.html')
    print('  http://localhost:8000/dev/media_sources_test.html')
    print('  http://localhost:8000/dev/media_stall_test.html')
    print('  http://localhost:8000/dev/run_all.html      <- all of them at once')
    return 0


if __name__ == '__main__':
    sys.exit(main())
