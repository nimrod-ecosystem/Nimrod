"""make_asset_manifest.py - the asset tree's private inventory, and a page for checking it (row 2.258, note FY; proposal_asset_pack, gated).

Walks a master tree (ffprobe and hashes) and writes, BESIDE the masters, never into the site:
  assets.private.json   every file: its hash, length, its song and take, its tags as found, and whether it has been reviewed
  review_assets.html    each song: both takes to play, the lyrics from the tags, every tag it carries; a tick when it has been checked

  py -3.13 web/tools/make_asset_manifest.py "<tree>" [--names <private list>] [--account <name>]

Offline; it changes no master and uploads nothing. Ticks on the page stay in that browser until "Save what I checked" hands you a
reviewed.json: put it in the tree and the next run takes them in. `public_view` and `refuse_reasons` are what a later `publish` is held to:
the public manifest is a projection of hosted items only, and a file whose tags still carry a blocked name or the account does not go up.

Needs: ffmpeg's ffprobe on PATH.
"""
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys

SCHEMA = 'nimrod.assets.v1'
PRIVATE_NAME = 'assets.private.json'
PAGE_NAME = 'review_assets.html'
REVIEWED_NAME = 'reviewed.json'
AUDIO = ('.mp3', '.ogg', '.flac', '.wav', '.m4a')
TAKE_RE = re.compile(r'^(.*?)\s*\((\d+)\)$')
# Only these go in a public manifest (the gate: no plan, no source id, no download or review dates).
PUBLIC_FIELDS = ('id', 'song', 'take', 'path', 'pack', 'kind', 'title', 'tags', 'licence', 'credit', 'ai_written', 'bytes', 'sha256', 'seconds', 'type', 'hosted')


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-') or 'item'


def song_and_take(stem):
    """'Beloved (1)' -> ('Beloved', 2), 'Beloved' -> ('Beloved', 1): both takes are variants of one song. PURE."""
    m = TAKE_RE.match(stem)
    return (m.group(1), int(m.group(2)) + 1) if m else (stem, 1)


def lyrics_of(tags):
    return next((str(v) for k, v in (tags or {}).items() if k.lower().startswith('lyrics')), '')


def sung_lines(lyrics):
    """The words, without the [Intro] and [Verse] marks. PURE."""
    return [ln.strip() for ln in str(lyrics).splitlines() if ln.strip() and not re.fullmatch(r'\[.*\]', ln.strip())]


def source_of(tags):
    """What Suno's comment says, kept privately. PURE."""
    comment = str((tags or {}).get('comment') or '')
    out = {}
    if 'suno' in comment.lower():
        out['made_with'] = 'Suno'
    m = re.search(r'created=([^;\s]+)', comment)
    if m:
        out['made_on'] = m.group(1)[:10]
    m = re.search(r'\bid=([0-9a-fA-F-]{8,})', comment)
    if m:
        out['source_id'] = m.group(1)
    return out


def read_names(path):
    """A private list, one name a line. None when it cannot be read: a check with no list has not been made."""
    if not path:
        return None
    try:
        with open(path, encoding='utf-8') as f:
            return [ln.strip() for ln in f if ln.strip() and not ln.startswith('#')]
    except OSError:
        return None


def name_hits(text, names):
    """Which of `names` are in `text`, as whole words, any case. PURE."""
    return sorted({n for n in names or [] if re.search(r'\b' + re.escape(n) + r'\b', str(text), re.I)})


def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:format_tags:stream=codec_type,codec_name', '-of', 'json', path], capture_output=True)
    return json.loads(r.stdout.decode('utf-8', 'replace') or '{}') if r.returncode == 0 else {}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def scan(tree, names=None, account=None, reviewed=None):
    """The private manifest for a tree: every audio file, with what it carries. Takes `reviewed` ticks by file hash."""
    assets = []
    reviewed = reviewed or {}
    for dp, dirs, files in os.walk(tree):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for f in sorted(files):
            stem, ext = os.path.splitext(f)
            if ext.lower() not in AUDIO:
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, tree).replace(os.sep, '/')
            info = probe(p)
            fmt = info.get('format') or {}
            tags = fmt.get('tags') or {}
            song, take = song_and_take(stem)
            sha = sha256_of(p)
            lyrics = lyrics_of(tags)
            carried = '\n'.join(f'{k} {v}' for k, v in tags.items()) + '\n' + rel
            has_art = any(s.get('codec_type') == 'video' for s in info.get('streams') or [])
            assets.append({
                'id': f'{slug(song)}-{take}', 'song': slug(song), 'take': take, 'path': rel, 'pack': os.path.dirname(rel).replace('/', '-') or 'loose',
                'kind': 'music', 'title': song, 'tags': ['words'] if sung_lines(lyrics) else [], 'licence': None, 'credit': None,
                'ai_written': 'suno' in str(tags.get('comment') or '').lower() or None,
                'bytes': os.path.getsize(p), 'sha256': sha, 'seconds': round(float(fmt.get('duration') or 0), 1), 'type': f'audio/{ext[1:].lower()}',
                'status': 'checked' if reviewed.get(sha) else 'unreviewed', 'reviewed': reviewed.get(sha) or None, 'hosted': [],
                'sources': [source_of(tags)], 'carries': sorted(tags), 'cover_art': has_art,
                'blocked_names': name_hits(carried, names), 'account_found': bool(account and name_hits(carried, [account])),
            })
    return {'schema': SCHEMA, 'assets': assets, 'names_checked': names is not None, 'account_checked': bool(account)}


def public_view(manifest):
    """The public manifest: hosted items only, and only the public fields. What is not hosted is not named. PURE."""
    return {'schema': SCHEMA, 'assets': [{k: a.get(k) for k in PUBLIC_FIELDS} for a in manifest.get('assets', []) if a.get('hosted')]}


def refuse_reasons(asset, manifest):
    """Why a file may not go up yet; empty when it may. A check that was not made refuses too. PURE."""
    out = []
    if not manifest.get('names_checked'):
        out.append('the private names list was not read')
    if not manifest.get('account_checked'):
        out.append('no account name was given to look for')
    if asset.get('blocked_names'):
        out.append('a blocked name is in its tags or path')
    if asset.get('account_found'):
        out.append('the account name is in its tags')
    if asset.get('status') != 'checked':
        out.append('nobody has checked it yet')
    if not asset.get('licence'):
        out.append('it has no licence')
    if not asset.get('credit'):
        out.append('it has no credit')
    return out


def review_page(manifest, tree):
    """One self-contained page, for this tree only."""
    songs = {}
    for a in manifest['assets']:
        songs.setdefault(a['song'], []).append(a)
    esc = lambda s: html.escape(str(s))  # noqa: E731
    cards = []
    for song_id in sorted(songs):
        takes = songs[song_id]
        first = takes[0]
        tags = next((probe(os.path.join(tree, a['path'])).get('format', {}).get('tags') or {} for a in takes), {})
        words = lyrics_of(tags)
        flagged = sorted({n for a in takes for n in a['blocked_names']})
        cards.append(
            f'<section class="song" data-song="{esc(song_id)}"><h2>{esc(first["title"])}</h2>'
            + (f'<p class="flag">Blocked name found: {esc(", ".join(flagged))}</p>' if flagged else '')
            + ''.join(f'<div class="take"><b>Take {a["take"]}</b> <audio controls preload="none" src="{esc(a["path"])}"></audio> '
                      f'<label><input type="checkbox" data-sha="{a["sha256"]}"{" checked" if a["status"] == "checked" else ""}> Checked</label>'
                      f'<span class="small">{esc(", ".join(a["carries"]))}{"; cover art" if a["cover_art"] else ""}</span></div>' for a in takes)
            + f'<details><summary>Lyrics</summary><pre>{esc(words) or "No lyrics tag."}</pre></details></section>')
    done = sum(1 for a in manifest['assets'] if a['status'] == 'checked')
    return ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Check the songs</title>'
            '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:16px;background:#fbfaf2;color:#16261d}'
            '.song{border-top:1px solid #ccc;padding:8px 0}h2{margin:.2em 0}.take{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0}'
            '.small{font-size:.8rem;color:#555}.flag{background:#fbe3df;padding:4px 8px;font-weight:700}pre{white-space:pre-wrap}'
            'button{min-height:44px;padding:0 1em;font:inherit}@media (prefers-color-scheme:dark){body{background:#12181c;color:#e8eef0}.small{color:#aab}.flag{color:#16261d}}</style>'
            f'<h1>Check the songs</h1><p>Private. Nothing here is uploaded. {len(manifest["assets"])} files, {len(songs)} songs, {done} checked. '
            f'{"Blocked names were looked for in the tags and file names." if manifest["names_checked"] else "<b>No names list was read.</b>"} '
            'A name list misses a street, a school or a story: please listen, and read. Ticks stay in this browser until you save them; put the file beside this page and run the tool again.</p>'
            '<p><button id="save">Save what I checked</button></p>' + ''.join(cards) +
            '<script>const K="nimrod-assets-checked";let got={};try{got=JSON.parse(localStorage.getItem(K)||"{}")}catch{}'
            'const boxes=[...document.querySelectorAll("input[data-sha]")];boxes.forEach(b=>{if(got[b.dataset.sha])b.checked=true;'
            'b.addEventListener("change",()=>{if(b.checked)got[b.dataset.sha]=new Date().toISOString().slice(0,10);else delete got[b.dataset.sha];'
            'try{localStorage.setItem(K,JSON.stringify(got))}catch{}})});'
            'document.getElementById("save").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(got,null,1)],{type:"application/json"}));'
            f'a.download="{REVIEWED_NAME}";a.click()}};</script>')


def main(argv=None):
    p = argparse.ArgumentParser(description='The asset tree\'s private inventory and a page for checking it.')
    p.add_argument('tree')
    p.add_argument('--names', help='a private list of names to look for, one a line')
    p.add_argument('--account', help='an account name to look for')
    a = p.parse_args(argv)
    tree = os.path.abspath(a.tree)
    if not os.path.isdir(tree):
        p.error(f'not a folder: {tree}')
    if re.search(r'[\\/]web[\\/]client([\\/]|$)', tree):
        p.error('this writes private files beside the tree, and that folder is what the site serves')
    names = read_names(a.names)
    if a.names and names is None:
        print(f'could not read the names list: {a.names}', file=sys.stderr)
    reviewed = {}
    try:
        with open(os.path.join(tree, REVIEWED_NAME), encoding='utf-8') as f:
            reviewed = json.load(f)
    except (OSError, ValueError):
        reviewed = {}
    manifest = scan(tree, names, a.account, reviewed)
    with open(os.path.join(tree, PRIVATE_NAME), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, indent=1)
    with open(os.path.join(tree, PAGE_NAME), 'w', encoding='utf-8', newline='\n') as f:
        f.write(review_page(manifest, tree))
    print(f"{len(manifest['assets'])} files, {len({x['song'] for x in manifest['assets']})} songs, {sum(1 for x in manifest['assets'] if x['status'] == 'checked')} checked, "
          f"{sum(1 for x in manifest['assets'] if x['blocked_names'])} with a blocked name, {sum(1 for x in manifest['assets'] if x['account_found'])} with the account name")
    print(os.path.join(tree, PAGE_NAME))
    return 0


if __name__ == '__main__':
    sys.exit(main())
