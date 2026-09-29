#!/usr/bin/env python3
"""check_blocked_names.py - FAIL IF AN AD BLOCKER WOULD REFUSE ONE OF THE SITE'S OWN FILES.

*** WHY THIS EXISTS (2026-09-29). *** The bench Pi sat on "Starting Nimrod..." forever. Its
Chromium loads uBlock Origin Lite by default (Raspberry Pi OS ships it), and the filter lists
block any file called `hitbox.js` -- HitBox was an old web-analytics product. `comet.js` imported
`hitbox.js`, the kiosk imports comet, and one blocked module means the WHOLE module graph never
runs: no error on screen, nothing in the console, just the boot text. Every visitor with an ad
blocker got the same dead page. The file is now `pressable.js`; this makes the next one fail here
instead of on somebody's screen.

*** WHY A GATE, UNLIKE THE OTHER check_*.py REPORTS. *** Those report candidates a human must
triage (a literal colour can be legitimate). A first-party file that a common blocker refuses has
no legitimate case: it is a broken page for everyone running that blocker. Exit 1 on any hit.

WHAT IT CHECKS: every file under web/client, as https://nimrodecosystem.com/<path>, against the
network rules of EasyList, EasyPrivacy and uBlock Origin's own filters + privacy lists -- the lists
uBlock Origin (Lite) is built from. Rules marked third-party-only, or restricted to other domains,
are skipped (these are our own first-party files). Element-hiding (##) rules are not network
rules and are ignored. It is an approximation of each blocker's matcher, not a copy of it, so it
proves itself first: the old name `/hitbox.js` MUST be caught, or the run fails as broken.

Lists are cached in web/tools/.filter_cache for a week. Offline with no cache -> exit 2 (unknown
is not a pass).

USAGE, from the repo root:

    py -3.13 web/tools/check_blocked_names.py
    py -3.13 web/tools/check_blocked_names.py --refresh     # re-download the lists
"""
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.normpath(os.path.join(HERE, '..', 'client'))
CACHE = os.path.join(HERE, '.filter_cache')
HOST = 'nimrodecosystem.com'
LISTS = {
    'easylist.txt': 'https://easylist.to/easylist/easylist.txt',
    'easyprivacy.txt': 'https://easylist.to/easylist/easyprivacy.txt',
    'ubo-filters.txt': 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
    'ubo-privacy.txt': 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
}
WEEK = 7 * 24 * 3600
# Must be caught, or the matcher is not working and a clean result means nothing.
KNOWN_BLOCKED = '/hitbox.js'

TYPE_OF_EXT = {
    '.js': 'script', '.mjs': 'script', '.css': 'stylesheet', '.html': 'document',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.webp': 'image',
    '.ico': 'image', '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.mp3': 'media', '.mp4': 'media',
    '.wav': 'media', '.webm': 'media', '.json': 'xmlhttprequest', '.txt': 'xmlhttprequest',
}
TYPE_OPTS = {'script', 'image', 'stylesheet', 'xmlhttprequest', 'xhr', 'media', 'font', 'document', 'doc',
             'subdocument', 'frame', 'object', 'other', 'ping', 'websocket', 'css'}
ALIAS = {'xhr': 'xmlhttprequest', 'doc': 'document', 'frame': 'subdocument', 'css': 'stylesheet'}


def fetch_lists(refresh):
    os.makedirs(CACHE, exist_ok=True)
    texts = {}
    for name, url in LISTS.items():
        path = os.path.join(CACHE, name)
        fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < WEEK
        if refresh or not fresh:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'nimrod-check-blocked-names'})
                data = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
                with open(path, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(data)
            except Exception as e:  # noqa: BLE001 - reported, then the cache (if any) is used
                print(f'  could not download {name}: {e}')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                texts[name] = f.read()
    return texts


def to_regex(pattern):
    if len(pattern) > 2 and pattern.startswith('/') and pattern.endswith('/'):
        return re.compile(pattern[1:-1], re.I)
    out, i = '', 0
    if pattern.startswith('||'):
        out, i = r'^[a-z-]+://(?:[^/]*\.)?', 2
    elif pattern.startswith('|'):
        out, i = '^', 1
    tail = ''
    if pattern.endswith('|') and len(pattern) > i + 1:
        pattern, tail = pattern[:-1], '$'
    for ch in pattern[i:]:
        if ch == '*':
            out += '.*'
        elif ch == '^':
            out += r'(?:[^\w.%-]|$)'
        else:
            out += re.escape(ch)
    return re.compile(out + tail, re.I)


def parse(text):
    """-> [(regex, types or None, negtypes, raw, is_exception)] for rules that can apply here."""
    rules = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(('!', '[')) or re.search(r'#[@?$%]?#|#\+js', line):
            continue
        exc = line.startswith('@@')
        body = line[2:] if exc else line
        opts = []
        if '$' in body and not (body.startswith('/') and body.endswith('/')):
            body, _, o = body.rpartition('$')
            opts = [x.strip().lower() for x in o.split(',') if x.strip()]
        if not body or body in ('*', '|', '||'):
            continue
        # Our own files are first-party.
        if any(o in ('third-party', '3p', 'strict3p') for o in opts):
            continue
        dom = next((o for o in opts if o.startswith(('domain=', 'from='))), None)
        if dom:
            ds = dom.split('=', 1)[1].split('|')
            pos = [d for d in ds if not d.startswith('~')]
            if pos and not any(HOST == d or HOST.endswith('.' + d) for d in pos):
                continue
            if any(d[1:] == HOST for d in ds if d.startswith('~')):
                continue
        # A host-anchored rule only matters if it names our host.
        if body.startswith('||'):
            host = re.split(r'[/^*$|]', body[2:], maxsplit=1)[0].lower()
            if host and not (HOST == host or HOST.endswith('.' + host) or '*' in body[2:2 + len(host) + 1]):
                continue
        types = {ALIAS.get(o, o) for o in opts if o in TYPE_OPTS}
        neg = {ALIAS.get(o[1:], o[1:]) for o in opts if o.startswith('~') and o[1:] in TYPE_OPTS}
        try:
            rx = to_regex(body)
        except re.error:
            continue
        rules.append((rx, types or None, neg, line, exc))
    return rules


def blocked(url, kind, rules):
    hit = None
    for rx, types, neg, raw, exc in rules:
        if exc:
            continue
        if types is not None and kind not in types:
            continue
        if kind in neg:
            continue
        if rx.search(url):
            hit = raw
            break
    if not hit:
        return None
    for rx, types, neg, raw, exc in rules:
        if exc and (types is None or kind in types) and rx.search(url):
            return None
    return hit


def client_paths():
    out = []
    for d, dirs, files in os.walk(CLIENT):
        dirs[:] = [x for x in dirs if x not in ('node_modules', '.git')]
        for f in files:
            out.append('/' + os.path.relpath(os.path.join(d, f), CLIENT).replace(os.sep, '/'))
    return sorted(out)


def main():
    texts = fetch_lists('--refresh' in sys.argv)
    if not texts:
        print('No filter lists (offline, no cache) -- cannot say. Exit 2.')
        return 2
    rules = []
    for text in texts.values():
        rules.extend(parse(text))
    kind = lambda p: TYPE_OF_EXT.get(os.path.splitext(p)[1].lower(), 'other')
    if not blocked(f'https://{HOST}{KNOWN_BLOCKED}', 'script', rules):
        print(f'SELF-CHECK FAILED: {KNOWN_BLOCKED} should be blocked and was not -- the lists or the matcher are broken.')
        return 2
    paths = client_paths()
    hits = [(p, blocked(f'https://{HOST}{p}', kind(p), rules)) for p in paths]
    hits = [(p, r) for p, r in hits if r]
    print(f'{len(rules)} applicable rules from {len(texts)} lists; {len(paths)} client files; '
          f'self-check ({KNOWN_BLOCKED}) caught.')
    for p, r in hits:
        print(f'  BLOCKED  {p}   by  {r}')
    print('clean' if not hits else f'{len(hits)} file(s) an ad blocker would refuse -- rename them.')
    return 1 if hits else 0


if __name__ == '__main__':
    sys.exit(main())
