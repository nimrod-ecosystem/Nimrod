#!/usr/bin/env python3
"""test_ha_bridge.py - nimrod-ha-bridge.py against a pretend Home Assistant (web/tools/pretend_home_assistant.py).

The bridge and the pretend hub each run in a thread on 127.0.0.1; the page is played by requests carrying the kiosk
site's Origin. Covers: another site refused (every route, and the preflight); connect checks the address really is Home
Assistant and the token works, and the token is never sent back; list, tick, name; a ticked thing's actions reach Home
Assistant as its services; an unticked thing, an unknown action and a door with "Allow doors and locks" off are refused;
forget forgets. Run from web/:  py -3.13 kiosk_installer/deploy/test_ha_bridge.py
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'tools'))
import pretend_home_assistant as P  # noqa: E402

spec = importlib.util.spec_from_file_location('ha_bridge', HERE / 'nimrod-ha-bridge.py')
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


SITE = 'https://nimrodecosystem.com'
tmp = Path(tempfile.mkdtemp(prefix='nimrod_ha_test_'))
os.environ['NIMROD_HA_CONFIG'] = str(tmp / 'home-assistant.json')
hub, pretend, hub_url = P.start(token='pretend-token-123456')
bridge = B.make_server(port=0, origins={SITE})
threading.Thread(target=bridge.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{bridge.server_address[1]}'


def ask(method, path, body=None, origin=SITE):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    if origin:
        req.add_header('Origin', origin)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b'{}'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}'), dict(e.headers)


try:
    # ---- who may ask
    for m, p in (('GET', '/ha/status'), ('GET', '/ha/entities'), ('POST', '/ha/call')):
        code, _, _ = ask(m, p, {} if m == 'POST' else None, origin='https://evil.example')
        check(f'*** another site is refused: {m} {p} ***', code == 403, code)
    code, _, _ = ask('GET', '/ha/status', origin=None)
    check('no Origin at all is refused too (the states are private)', code == 403, code)
    code, _, h = ask('OPTIONS', '/ha/call')
    check('the kiosk site\'s preflight is allowed, private-network header included',
          code == 204 and h.get('Access-Control-Allow-Origin') == SITE and h.get('Access-Control-Allow-Private-Network') == 'true', (code, h))

    # ---- connecting
    code, s, _ = ask('GET', '/ha/status')
    check('before connecting: not connected', code == 200 and s['connected'] is False)
    code, s, _ = ask('GET', '/ha/entities')
    check('nothing to list before connecting (409, said so)', code == 409 and s['reason'] == 'not connected', (code, s))
    code, s, _ = ask('POST', '/ha/connect', {'url': hub_url, 'token': 'wrong-token-000000'})
    check('*** a wrong token: refused, in words, and nothing kept ***', code == 401 and 'token' in s['reason'] and not (tmp / 'home-assistant.json').exists(), (code, s))
    code, s, _ = ask('POST', '/ha/connect', {'url': 'ftp://nope', 'token': 'x'})
    check('an address that is not http(s): refused', code == 400, (code, s))
    code, s, _ = ask('POST', '/ha/connect', {'url': 'http://127.0.0.1:9/', 'token': 'pretend-token-123456'})
    check('an address where nothing answers: said so (504)', code == 504 and 'did not answer' in s['reason'], (code, s))
    code, s, _ = ask('POST', '/ha/connect', {'url': hub_url + '/some/path', 'token': ' pretend-token-123456 '})
    check('*** connected: the address kept without its path, the token only by its ends ***', code == 200 and s['url'] == hub_url
          and s['token'] == 'pret…3456' and 'pretend-token-123456' not in json.dumps(s), (code, s))
    code, s, _ = ask('GET', '/ha/status')
    check('*** status never carries the token ***', s['connected'] is True and 'pretend-token-123456' not in json.dumps(s) and s['token'] == 'pret…3456', s)
    if os.name != 'nt':
        check('the kept file is this user\'s only (0600)', (os.stat(tmp / 'home-assistant.json').st_mode & 0o777) == 0o600)

    # ---- listing and ticking
    code, s, _ = ask('GET', '/ha/entities')
    ids = {e['entity_id']: e for e in s.get('entities', [])}
    check('*** the list: lights, the fan, the TV, the scene - with their names and actions ***',
          {'light.lamp', 'light.big_light', 'fan.ceiling_fan', 'media_player.tv', 'scene.evening'} <= set(ids)
          and ids['light.lamp']['name'] == 'Lamp' and 'dimmer' in ids['light.lamp']['actions'], json.dumps(s)[:300])
    check('a sensor (nothing to control) and, with doors off, the lock are not offered', 'sensor.temperature' not in ids and 'lock.front_door' not in ids)
    code, s, _ = ask('POST', '/ha/call', {'entity_id': 'light.lamp', 'action': 'on'})
    check('*** an unticked thing cannot be called ***', code == 403 and 'ticked' in s['reason'] and not pretend.calls, (code, s))
    code, s, _ = ask('POST', '/ha/choose', {'entity_id': 'light.lamp', 'label': 'the lamp by the bed'})
    check('tick the lamp, in the person\'s own words', code == 200 and s['chosen'] == {'light.lamp': 'the lamp by the bed'}, s)
    ask('POST', '/ha/choose', {'entity_id': 'media_player.tv', 'label': 'TV'})
    code, s, _ = ask('POST', '/ha/choose', {'entity_id': 'sensor.temperature'})
    check('a thing with nothing to do cannot be ticked', code == 400, (code, s))

    # ---- calling
    code, s, _ = ask('POST', '/ha/call', {'entity_id': 'light.lamp', 'action': 'on'})
    check('*** "on": Home Assistant is asked light.turn_on for the lamp, and the lamp is on ***',
          code == 200 and pretend.calls[-1] == ('light', 'turn_on', {'entity_id': 'light.lamp'}) and pretend.devices['light.lamp']['state'] == 'on', (code, s, pretend.calls))
    ask('POST', '/ha/call', {'entity_id': 'light.lamp', 'action': 'dimmer'})
    check('"dimmer": turn_on with brightness_step_pct -20', pretend.calls[-1] == ('light', 'turn_on', {'entity_id': 'light.lamp', 'brightness_step_pct': -20})
          and pretend.devices['light.lamp']['attributes']['brightness'] == 204, pretend.calls[-1])
    ask('POST', '/ha/call', {'entity_id': 'media_player.tv', 'action': 'louder'})
    check('the TV "louder": media_player.volume_up', pretend.calls[-1][:2] == ('media_player', 'volume_up') and pretend.devices['media_player.tv']['attributes']['volume_level'] == 0.4)
    code, s, _ = ask('POST', '/ha/call', {'entity_id': 'light.lamp', 'action': 'explode'})
    check('*** an action not on the list is refused (no arbitrary service calls) ***', code == 400 and len(pretend.calls) == 3, (code, s))
    code, s, _ = ask('GET', '/ha/states')
    st = {e['entity_id']: e for e in s['states']}
    check('*** the ticked things as they are now: the lamp on, dimmed; nothing unticked ***', set(st) == {'light.lamp', 'media_player.tv'}
          and st['light.lamp']['state'] == 'on' and st['light.lamp']['label'] == 'the lamp by the bed' and st['light.lamp']['brightness'] == 204, s)

    # ---- doors and locks, a setting (off)
    code, s, _ = ask('POST', '/ha/choose', {'entity_id': 'lock.front_door', 'label': 'front door'})
    code, s, _ = ask('POST', '/ha/call', {'entity_id': 'lock.front_door', 'action': 'unlock'})
    check('*** a lock, ticked, with "Allow doors and locks" off: refused, and Home Assistant never asked ***',
          code == 403 and 'doors' in s['reason'] and pretend.devices['lock.front_door']['state'] == 'locked', (code, s))
    ask('POST', '/ha/settings', {'allowDoors': True})
    code, s, _ = ask('POST', '/ha/call', {'entity_id': 'lock.front_door', 'action': 'unlock'})
    check('...turned on by the person: the lock answers', code == 200 and pretend.devices['lock.front_door']['state'] == 'unlocked', (code, s))
    ask('POST', '/ha/settings', {'allowDoors': 'yes'})
    code, s, _ = ask('GET', '/ha/status')
    check('the setting is on only for a real true (anything else turns it off)', s['allowDoors'] is False)

    # ---- the hub going away, and forgetting
    hub.shutdown()
    hub.server_close()
    code, s, _ = ask('POST', '/ha/call', {'entity_id': 'light.lamp', 'action': 'off'})
    check('*** Home Assistant gone: the page is told it did not answer, in words ***', code == 504 and 'did not answer' in s['reason'], (code, s))
    code, s, _ = ask('POST', '/ha/forget', {})
    code2, s2, _ = ask('GET', '/ha/status')
    check('*** forget: the address, the token and the ticks are gone ***', code == 200 and s2['connected'] is False and s2['chosen'] == {}
          and not (tmp / 'home-assistant.json').exists(), s2)
    code, s, _ = ask('POST', '/ha/connect', {'url': hub_url, 'token': 'y' * 5000})
    check('a body bigger than the page ever sends is refused (413)', code == 413, code)
    src = (HERE / 'nimrod-ha-bridge.py').read_text(encoding='utf-8')
    check('it listens on 127.0.0.1 only', "('127.0.0.1', port)" in src and '0.0.0.0' not in src)
finally:
    bridge.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
