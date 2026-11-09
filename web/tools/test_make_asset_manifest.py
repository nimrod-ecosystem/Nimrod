"""Tests for make_asset_manifest.py on made-up files: py -3.13 web/tools/test_make_asset_manifest.py   (needs ffmpeg)"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_asset_manifest as M  # noqa: E402

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}  {detail}')


def song(path, **tags):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    meta = [x for k, v in tags.items() for x in ('-metadata', f'{k.replace("_", "-")}={v}')]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', *meta, path], check=True)


check('a second take is the same song', M.song_and_take('Beloved (1)') == ('Beloved', 2) and M.song_and_take('Beloved') == ('Beloved', 1))
check('a song with brackets in its name is not a take', M.song_and_take('Song (live)') == ('Song (live)', 1))
check('sung lines leave the section marks behind', M.sung_lines('[Intro]\n\nBreathe in\n[Verse]\nAnd out') == ['Breathe in', 'And out'])
check('[Orchestral music] alone is no words', M.sung_lines('[Orchestral music fades in]') == [])
check('names are whole words, any case', M.name_hits('Robin went home', ['robin', 'Sam']) == ['robin'] and M.name_hits('robinson', ['robin']) == [])
s = M.source_of({'comment': 'made with suno; created=2026-06-17T07:10:51.2Z; id=1c82123a-5c67-40ad-a194-e78d6ae6f6c8'})
check('Suno\'s comment is read', s == {'made_with': 'Suno', 'made_on': '2026-06-17', 'source_id': '1c82123a-5c67-40ad-a194-e78d6ae6f6c8'}, s)
check('a names list that cannot be read is None, not an empty list', M.read_names(r'Z:\nope.txt') is None and M.read_names(None) is None)

with tempfile.TemporaryDirectory() as tree:
    comment = 'made with suno; created=2026-06-17T07:10:51Z; id=1c82123a-5c67-40ad-a194-e78d6ae6f6c8'
    song(os.path.join(tree, 'music', 'games', 'Beloved.flac'), artist='testaccount', comment=comment, lyrics_eng='[Verse]\nA line about Robin')
    song(os.path.join(tree, 'music', 'games', 'Beloved (1).flac'), artist='testaccount', comment=comment, lyrics_eng='[Verse]\nA line')
    song(os.path.join(tree, 'music', 'games', 'Quiet.flac'), comment=comment, lyrics_eng='[Music]')
    with open(os.path.join(tree, 'notes.txt'), 'w') as f:
        f.write('not audio')
    names = os.path.join(tree, 'names.txt')
    with open(names, 'w') as f:
        f.write('# private\nRobin\n')
    before = {n: os.path.getmtime(os.path.join(tree, 'music', 'games', n)) for n in os.listdir(os.path.join(tree, 'music', 'games'))}
    code = M.main([tree, '--names', names, '--account', 'testaccount'])
    m = json.load(open(os.path.join(tree, M.PRIVATE_NAME), encoding='utf-8'))
    by = {a['path'].split('/')[-1]: a for a in m['assets']}
    check('it finds the audio and nothing else', code == 0 and sorted(by) == ['Beloved (1).flac', 'Beloved.flac', 'Quiet.flac'], sorted(by))
    check('*** both takes are one song ***', by['Beloved.flac']['song'] == by['Beloved (1).flac']['song'] == 'beloved' and by['Beloved (1).flac']['take'] == 2)
    check('each has its hash, size, length and tree path', len(by['Quiet.flac']['sha256']) == 64 and by['Quiet.flac']['bytes'] > 0 and by['Quiet.flac']['seconds'] == 1.0 and by['Quiet.flac']['path'] == 'music/games/Quiet.flac')
    check('*** a blocked name in the lyrics is found ***', by['Beloved.flac']['blocked_names'] == ['Robin'] and by['Beloved (1).flac']['blocked_names'] == [], by['Beloved.flac'])
    check('*** the account name in the tags is found ***', by['Beloved.flac']['account_found'] and not by['Quiet.flac']['account_found'])
    check('words or not is read from the lyrics', by['Beloved.flac']['tags'] == ['words'] and by['Quiet.flac']['tags'] == [])
    check('the masters are not touched', all(os.path.getmtime(os.path.join(tree, 'music', 'games', n)) == t for n, t in before.items()))
    page = open(os.path.join(tree, M.PAGE_NAME), encoding='utf-8').read()
    check('the page has each song, both takes and the flag', page.count('class="song"') == 2 and page.count('<audio') == 3 and 'Blocked name found: Robin' in page)
    check('with a list read, the page does not warn that none was', 'No names list was read' not in page)

    a = by['Quiet.flac']
    why = M.refuse_reasons(a, m)
    check('*** unchecked, unlicensed and uncredited: it may not go up ***', 'nobody has checked it yet' in why and 'it has no licence' in why and 'it has no credit' in why, why)
    ok = {**a, 'status': 'checked', 'licence': 'CC-BY-4.0', 'credit': 'A name'}
    check('checked, licensed and credited: it may', M.refuse_reasons(ok, m) == [], M.refuse_reasons(ok, m))
    check('*** a blocked name refuses it ***', 'a blocked name is in its tags or path' in M.refuse_reasons({**ok, 'blocked_names': ['Robin']}, m))
    check('*** the account name refuses it ***', 'the account name is in its tags' in M.refuse_reasons({**ok, 'account_found': True}, m))
    check('*** a check that was not made refuses it: a lost names list is not a clean result ***', 'the private names list was not read' in M.refuse_reasons(ok, {**m, 'names_checked': False}))
    check('no account given refuses it too', 'no account name was given to look for' in M.refuse_reasons(ok, {**m, 'account_checked': False}))

    check('*** the public view names nothing that is not hosted ***', M.public_view(m)['assets'] == [])
    hosted = {**ok, 'hosted': [{'host': 'archive.org', 'item': 'x', 'file': 'y'}], 'reviewed': '2026-11-09', 'sources': [{'source_id': 'secret', 'plan': 'pro'}]}
    pub = M.public_view({'assets': [hosted, a]})
    text = json.dumps(pub)
    check('*** nor any private field: no source id, plan, review date or what the tags carry ***', len(pub['assets']) == 1 and all(w not in text for w in ('secret', 'plan', 'reviewed', 'carries', 'blocked', 'account', 'sources')), text)
    check('it keeps what a player needs', pub['assets'][0]['song'] == 'quiet' and pub['assets'][0]['hosted'][0]['host'] == 'archive.org' and pub['schema'] == M.SCHEMA)

    with open(os.path.join(tree, M.REVIEWED_NAME), 'w') as f:
        json.dump({a['sha256']: '2026-11-09'}, f)
    M.main([tree])
    again = json.load(open(os.path.join(tree, M.PRIVATE_NAME), encoding='utf-8'))
    checked = [x for x in again['assets'] if x['status'] == 'checked']
    check('saved ticks come in by hash, so a changed file is unchecked again', [x['path'] for x in checked] == ['music/games/Quiet.flac'] and checked[0]['reviewed'] == '2026-11-09')
    check('a run with no names list says so', again['names_checked'] is False and 'No names list was read' in open(os.path.join(tree, M.PAGE_NAME), encoding='utf-8').read())

site = os.path.join(tempfile.gettempdir(), 'web', 'client', 'x')
os.makedirs(site, exist_ok=True)
try:
    M.main([site])
    check('*** it refuses a folder the site serves ***', False)
except SystemExit as e:
    check('*** it refuses a folder the site serves ***', e.code == 2 and not os.path.exists(os.path.join(site, M.PRIVATE_NAME)))

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
