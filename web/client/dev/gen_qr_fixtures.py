#!/usr/bin/env python3
"""Generate the QR ORACLE: known-good matrices, cross-checked between TWO encoders.

WHY THIS EXISTS. `qr_test.html` checked finder patterns, timing patterns, module counts and
format bits -- and every one of those passed while the encoder produced a symbol NO PHONE CAN
READ. Mike pointed a phone at it and nothing happened. Structural checks cannot catch that,
because a wrong symbol has the same STRUCTURE as a right one. The only test that catches it
compares EVERY MODULE against an implementation known to be correct.

*** AND THEN THE ORACLE ITSELF TURNED OUT TO BE WRONG, WHICH IS THE REAL LESSON HERE. ***

The first version of this file used `segno` alone. The rewritten encoder matched it on some
cases and differed by 6-13% on others, which looked like a remaining bug. It was not.
`segno.encoder.write_padding_bits` does:

    buff.extend([0] * (8 - (length % 8)))

which appends **eight zero bits when the stream already ends on a codeword boundary** --
where ISO/IEC 18004 7.4.10 says padding bits are added only "if the bit stream length is such
that it does not end at a codeword boundary". That spurious zero codeword displaces a real
pad codeword (0xEC), so segno's symbol differs from the canonical one. It is still readable;
it is just not what everyone else emits.

Cross-checking `segno` against `qrcode` showed the two libraries differing from each other by
exactly the amounts our encoder differed from segno -- 104, 176 and 120 modules on three
cases. Our encoder agreed with `qrcode`. The oracle was the thing that was wrong.

**So this file now requires TWO independent encoders and records whether they agree.** The
fixture is `qrcode`'s matrix, which follows the spec's padding rule. Where segno disagrees,
the case is annotated rather than quietly dropped -- a divergence between references is
information, not noise.

    pip install qrcode segno
    python gen_qr_fixtures.py

If a fixture changes for an existing case, suspect this generator before the encoder.
"""
import io
import json
import os

import qrcode
import qrcode.constants as QC
import qrcode.util
import segno

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qr_fixtures.json')

LEVELS = {'L': QC.ERROR_CORRECT_L, 'M': QC.ERROR_CORRECT_M,
          'Q': QC.ERROR_CORRECT_Q, 'H': QC.ERROR_CORRECT_H}

# Chosen to cover what the product actually encodes, plus the edges that break encoders: a
# version boundary, every error level, all three encoding modes, a version-1 symbol, and
# version 7+ where the extra version-information block appears.
CASES = [
    ('pairing URL, level Q (what the screen shows)',
     'https://nimrod.onrender.com/pair.html?c=9K42QX', 'Q'),
    ('pairing URL, level M', 'https://nimrod.onrender.com/pair.html?c=9K42QX', 'M'),
    ('pairing URL, level H', 'https://nimrod.onrender.com/pair.html?c=9K42QX', 'H'),
    ('pairing URL, level L', 'https://nimrod.onrender.com/pair.html?c=9K42QX', 'L'),
    ('a long self-hosted host name',
     'https://screens.some-care-facility-example.org/pair.html?c=7T3M9P', 'Q'),
    ('plain text, uppercase - alphanumeric mode is available here',
     'NIMROD PAIRING CODE 9K42QX', 'Q'),
    ('short, lands in version 1', 'HELLO', 'Q'),
    ('lowercase forces byte mode', 'hello world', 'Q'),
    ('digits only - numeric mode', '1234567890123456789', 'Q'),
    ('a code on its own', '9K42QX', 'Q'),
    # Version 7+ carries an extra 18-bit version information block in two corners. Nothing
    # below version 7 exercises that code path at all.
    ('long enough to need version 7+, exercises the version information block',
     'https://screens.some-care-facility-example.org/pair.html?c=7T3M9P'
     '&site=north-wing&bed=214&note=please-scan-with-the-family-phone', 'Q'),
]

out = {
    'generated_by': 'qrcode %s (cross-checked against segno %s)'
                    % (getattr(qrcode, '__version__', '?'), segno.__version__),
    'note': 'Known-good QR matrices. 1 = dark module. The fixture follows the SPEC padding '
            'rule; see gen_qr_fixtures.py for why segno alone was not a safe oracle.',
    'cases': [],
}

LEVEL_BITS = {'L': 0b01, 'M': 0b00, 'Q': 0b11, 'H': 0b10}


def format_bits(level, mask):
    """BCH(15,5) format information, XOR-masked with 0x5412 -- same as qr.js."""
    data = (LEVEL_BITS[level] << 3) | mask
    rem = data << 10
    for i in range(14, 9, -1):
        if (rem >> i) & 1:
            rem ^= 0x537 << (i - 10)
    return ((data << 10) | rem) ^ 0x5412


def read_mask(rows, level):
    """Which mask did the encoder pick? Read it back out of the format block.

    `qrcode` leaves `mask_pattern` as None when it chooses one itself, so the only honest
    place to get the answer is the symbol. Index 0 is the MOST significant bit -- the
    convention that cost an hour when qr.js had it reversed.
    """
    n = len(rows)
    positions = [(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
                 (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)]
    value = 0
    for i, (r, c) in enumerate(positions):
        value |= (1 if rows[r][c] == '1' else 0) << (14 - i)
    for mask in range(8):
        if format_bits(level, mask) == value:
            return mask
    raise AssertionError('could not read a mask out of the format block for level %s' % level)


agree = 0
for label, text, level in CASES:
    # Version first, from the library's own fitting.
    probe = qrcode.QRCode(error_correction=LEVELS[level], box_size=1, border=0)
    probe.add_data(text)
    probe.make(fit=True)
    version = probe.version

    # *** THE MASK IS DERIVED, NOT TRUSTED. ***
    #
    # `qrcode`'s automatic mask selection disagrees with its OWN penalty function: for
    # '9K42QX' it emits mask 5 while `lost_point` ranks mask 2 lowest (368 vs 418). segno
    # picks 2, our encoder picks 2, and qrcode's own scoring picks 2 -- only its auto path
    # says 5. Generating fixtures from that path baked a third library's bug into the oracle
    # and failed four correct cases.
    #
    # So: build all eight masks explicitly, score them with the spec's penalty rules, and
    # take the minimum. That is what the standard actually specifies, and it is reproducible
    # without trusting any library's convenience wrapper.
    best = None
    for mask in range(8):
        e = qrcode.QRCode(version=version, error_correction=LEVELS[level],
                          box_size=1, border=0, mask_pattern=mask)
        e.add_data(text)
        e.make(fit=False)
        grid = e.get_matrix()
        score = qrcode.util.lost_point(grid)
        if best is None or score < best[0]:
            best = (score, mask, grid)
    _, chosen_mask, grid = best

    rows = [''.join('1' if v else '0' for v in row) for row in grid]
    read_back = read_mask(rows, level)
    assert read_back == chosen_mask, \
        'format block says mask %d but we built mask %d' % (read_back, chosen_mask)

    class _Q:
        pass
    q = _Q()
    q.version = version
    q.mask_pattern = chosen_mask

    # The second opinion. Same version and mask, so any difference is real disagreement
    # rather than a different-but-valid choice.
    s = segno.make(text, error=level, micro=False, boost_error=False,
                   version=q.version, mask=q.mask_pattern)
    srows = [''.join('1' if v else '0' for v in row) for row in s.matrix]
    diff = sum(1 for a, b in zip(rows, srows) for x, y in zip(a, b) if x != y)
    if diff == 0:
        agree += 1

    out['cases'].append({
        'label': label,
        'text': text,
        'level': level,
        'version': q.version,
        'size': len(rows),
        'mask': q.mask_pattern,
        'rows': rows,
        'second_opinion_agrees': diff == 0,
        'second_opinion_diff': diff,
    })
    note = 'both agree' if diff == 0 else 'segno differs by %d (its padding quirk)' % diff
    print('  v%-2d %s mask%d  %-58s %s' % (q.version, level, q.mask_pattern, label[:58], note))

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(json.dumps(out, indent=1))
print('\nwrote %d cases (%d/%d cross-confirmed) -> %s'
      % (len(out['cases']), agree, len(out['cases']), OUT))
