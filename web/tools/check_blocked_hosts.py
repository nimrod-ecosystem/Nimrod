#!/usr/bin/env python3
"""check_blocked_hosts.py - THE OUTSIDE ADDRESSES NIMROD LOADS, AGAINST THE COMMON DNS BLOCK LISTS (row 2.148, chat's
note DG, 2026-10-28).

Mike: "ad blockers have broken Nimrod before - Can we fix Nimrod so this doesn't happen?" check_blocked_names.py covers
the site's own FILE NAMES (what a browser blocker like uBlock refuses). A DNS blocker - Pi-hole, AdGuard Home, a
router's filter - works on ADDRESSES instead: it never sees a file name, it refuses to look up a whole host. So this
lists every outside host the site needs and checks each against the lists those blockers ship with:
  * AdGuard DNS filter (AdGuard Home's default), `||host^` rules with `@@` exceptions;
  * StevenBlack's unified hosts (Pi-hole's default list), one host per line.

TWO JOBS, two answers:
  1. REPORT: a needed host on a list is printed with what it breaks. It is not a failure: Nimrod cannot unblock
     YouTube on somebody's network. The screen says so instead (row 2.148 item 3: blocked_hint.js).
  2. GATE (exit 1): the client code names an outside host that is in neither NEEDED nor LINKS below. A new outside
     dependency has to be put on one list on purpose, so this report never quietly misses one.
Self-check: a known ad host (doubleclick.net) MUST be caught, or the matching is broken and a clean report means nothing.
Lists are cached in web/tools/.filter_cache for a week; offline with no cache -> exit 2 (unknown is not a pass).

    py -3.13 web/tools/check_blocked_hosts.py [--refresh]
"""
import os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.normpath(os.path.join(HERE, '..', 'client'))
CACHE = os.path.join(HERE, '.filter_cache')
WEEK = 7 * 24 * 3600
LISTS = {
    'adguard-dns.txt': 'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt',
    'stevenblack-hosts.txt': 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
}
KNOWN_BLOCKED = 'doubleclick.net'

# Hosts the site LOADS at run time, and what stops working without each. Includes the hosts a provider's player pulls
# in by itself (YouTube's video and thumbnail hosts, archive.org's file servers), which the code never names.
NEEDED = {
    'nimrodecosystem.com': 'everything: the site itself',
    'nimrod.onrender.com': 'everything: where the site is hosted',
    'www.youtube-nocookie.com': 'YouTube videos (the privacy-enhanced player)',
    'www.youtube.com': 'YouTube videos (the player API) and live cams',
    's.ytimg.com': "YouTube's player scripts",
    'i.ytimg.com': 'YouTube thumbnails',
    'rr1---sn-abc.googlevideo.com': 'YouTube video streams (any *.googlevideo.com)',
    'sdk.scdn.co': "Spotify's web player",
    'api.spotify.com': 'Spotify playback and search',
    'accounts.spotify.com': 'connecting a Spotify account',
    'apresolve.spotify.com': "Spotify's player connection",
    'api.open-meteo.com': 'weather',
    'geocoding-api.open-meteo.com': "weather (finding the person's town)",
    'archive.org': 'Internet Archive music and films (search)',
    'ia800000.us.archive.org': 'Internet Archive files (any *.us.archive.org)',
    'en.wikipedia.org': 'Wikipedia lookups (lessons, trivia sources)',
    'stun.l.google.com': 'calls (finding a direct route)',
    'stun.cloudflare.com': 'calls (finding a direct route, the second server)',
}
# Hosts the code names only as LINKS a person may open, or as examples - never loaded by the site itself.
LINKS = {
    'accessibility.blog.gov.uk', 'codepen.io', 'commons.wikimedia.org', 'developer.spotify.com', 'docs.ollama.com',
    'example.org', 'relay.example.org', 'github.com', 'open.spotify.com', 'open-meteo.com',
    'openprocessing.org', 'p5js.org', 'tailscale.com', 'threejs.org', 'unsplash.com', 'webkit.org',
    'www.glslsandbox.com', 'www.nasa.gov', 'www.shadertoy.com', 'www.w3.org', 'x.invalid',
    'your-desktop.your-tailnet.ts.net', 'youtu.be',
}
SKIP_DIRS = {'dev', 'packs_review', 'lessons', 'node_modules'}
HOST_RE = re.compile(r'(?:https?|wss?|stuns?|turns?):(?://)?([a-z0-9.-]+\.[a-z]{2,})', re.I)


def fetch(refresh):
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    for name, url in LISTS.items():
        path = os.path.join(CACHE, name)
        fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < WEEK
        if refresh or not fresh:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'nimrod-check-blocked-hosts'})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read().decode('utf-8', 'replace')
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.write(data)
            except Exception as e:
                if not os.path.exists(path):
                    print(f'cannot fetch {name} ({e}) and no cached copy: unknown is not a pass')
                    sys.exit(2)
        with open(path, encoding='utf-8', errors='replace') as fh:
            out[name] = fh.read()
    return out


def parse(lists):
    """{'adguard': (blocked set, exception set), 'hosts': set} - AdGuard's ||host^ rules, StevenBlack's host lines."""
    block, allow, hosts = set(), set(), set()
    rule = re.compile(r'^(@@)?\|\|([a-z0-9.*-]+)\^(\$.*)?$', re.I)
    for line in lists['adguard-dns.txt'].splitlines():
        m = rule.match(line.strip())
        if not m:
            continue
        opts = (m.group(3) or '')
        if 'badfilter' in opts or 'client=' in opts or 'denyallow' in opts:
            continue
        (allow if m.group(1) else block).add(m.group(2).lower())
    for line in lists['stevenblack-hosts.txt'].splitlines():
        parts = line.split('#', 1)[0].split()
        if len(parts) >= 2 and parts[0] in ('0.0.0.0', '127.0.0.1'):
            hosts.update(p.lower() for p in parts[1:] if p not in ('localhost', '0.0.0.0'))
    return block, allow, hosts


def blocked_by(host, block, allow, hosts):
    """Which lists block `host`: AdGuard's rule for it or any parent domain (unless excepted), or the exact host line."""
    out = []
    labels = host.split('.')
    parents = ['.'.join(labels[i:]) for i in range(len(labels) - 1)]
    if any(p in block for p in parents) and not any(p in allow for p in parents):
        out.append('AdGuard DNS filter')
    if host in hosts:
        out.append("Pi-hole's default list")
    return out


def named_hosts():
    found = {}
    for root, dirs, files in os.walk(CLIENT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if not f.endswith(('.js', '.html', '.css', '.mjs')):
                continue
            p = os.path.join(root, f)
            with open(p, encoding='utf-8', errors='replace') as fh:
                for m in HOST_RE.finditer(fh.read()):
                    found.setdefault(m.group(1).lower(), os.path.relpath(p, CLIENT).replace('\\', '/'))
    return found


def main(argv):
    block, allow, hosts = parse(fetch('--refresh' in argv))
    if not blocked_by(KNOWN_BLOCKED, block, allow, hosts) and not blocked_by('ad.' + KNOWN_BLOCKED, block, allow, hosts):
        print(f'self-check failed: {KNOWN_BLOCKED} is not caught, so the matching is broken')
        return 1
    print(f'{len(block)} AdGuard rules, {len(hosts)} Pi-hole hosts; self-check ({KNOWN_BLOCKED}) caught.\n')
    print('Needed outside hosts:')
    hit = 0
    for host, why in NEEDED.items():
        by = blocked_by(host, block, allow, hosts)
        hit += bool(by)
        print(f'  {"BLOCKED" if by else "ok     "}  {host:34} {why}' + (f'  <- {", ".join(by)}' if by else ''))
    untriaged = {h: f for h, f in named_hosts().items()
                 if h not in NEEDED and h not in LINKS and not h.endswith(('googlevideo.com', '.us.archive.org'))}
    print(f'\n{hit} needed host(s) on a common DNS block list (reported, not a failure: the screen says so instead).')
    if untriaged:
        print('\nFAIL: the client names outside hosts that are on neither list here (NEEDED or LINKS):')
        for h, f in sorted(untriaged.items()):
            print(f'  {h:40} first seen in {f}')
        return 1
    print('Every outside host the client names is listed (needed, or a link).')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
