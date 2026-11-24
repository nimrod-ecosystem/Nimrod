"""research_check.py - check research packs against web/tools/research_pack.schema.json (note GN, 2026-11-24).

    py -3.13 web/tools/research_check.py                 # every pack in web/client/research
    py -3.13 web/tools/research_check.py a.json b.json   # just these
    py -3.13 web/tools/research_check.py --quiet ...     # problems only

Chat's batch tools run this before a pack is committed, so a column with the wrong type is caught when it is researched, not
on a screen. Exit status 1 when any pack has an ERROR. A NOTE (a related id that is in no pack, a fact with no level of its
own) does not fail the check.

THE SCHEMA FILE IS THE RULES. This reads research_pack.schema.json and applies it: a small reader for the parts of JSON
Schema that file uses (type, const, enum, required, properties, items, $ref, pattern, min/max length, minimum, maximum,
maxItems). Argued against the `jsonschema` package: it is not installed here, a download needs Mike's go, and the file uses
a dozen keywords. A keyword this reader does not know is an error in the test (test_research_check.py), so the file cannot
grow a rule that is silently skipped.

Beyond the schema (what one file cannot say about the others): an id must be unique across every pack, a quote needs who
said it, and a `related` id should be an item somewhere.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA_PATH = HERE / 'research_pack.schema.json'
PACKS = HERE.parent / 'client' / 'research'
KNOWN = {'$schema', '$id', 'title', 'description', '$defs', 'type', 'const', 'enum', 'required', 'properties', 'items',
         '$ref', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'maxItems'}

TYPES = {
    'object': lambda v: isinstance(v, dict),
    'array': lambda v: isinstance(v, list),
    'string': lambda v: isinstance(v, str),
    'integer': lambda v: isinstance(v, int) and not isinstance(v, bool),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    'boolean': lambda v: isinstance(v, bool),
    'null': lambda v: v is None,
}


def load_schema(path=SCHEMA_PATH):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def unknown_keywords(node, path='#'):
    """Every keyword in the schema this reader does not apply (the test keeps this empty)."""
    out = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k not in KNOWN:
                out.append(f'{path}/{k}')
            if k in ('properties', '$defs'):
                for name, sub in v.items():
                    out += unknown_keywords(sub, f'{path}/{k}/{name}')
            elif k == 'items':
                out += unknown_keywords(v, f'{path}/items')
    return out


def validate(value, node, root, path='', out=None):
    """The problems with `value` against schema `node`, as 'path: what' strings."""
    out = [] if out is None else out
    if '$ref' in node:
        ref = node['$ref']
        target = root
        for part in ref.lstrip('#/').split('/'):
            target = target[part]
        validate(value, target, root, path, out)
    where = path or '(the pack)'
    if 'type' in node:
        types = node['type'] if isinstance(node['type'], list) else [node['type']]
        if not any(TYPES[t](value) for t in types):
            out.append(f'{where}: should be {" or ".join(types)}, is {type(value).__name__}')
            return out
    if 'const' in node and value != node['const']:
        out.append(f'{where}: should be {node["const"]!r}')
    if 'enum' in node and value not in node['enum']:
        out.append(f'{where}: {value!r} is not one of {", ".join(map(str, node["enum"]))}')
    if isinstance(value, str):
        if 'minLength' in node and len(value) < node['minLength']:
            out.append(f'{where}: empty' if node['minLength'] == 1 else f'{where}: shorter than {node["minLength"]}')
        if 'maxLength' in node and len(value) > node['maxLength']:
            out.append(f'{where}: longer than {node["maxLength"]} characters')
        if 'pattern' in node and not re.search(node['pattern'], value):
            out.append(f'{where}: {value!r} is not in the expected form')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 'minimum' in node and value < node['minimum']:
            out.append(f'{where}: below {node["minimum"]}')
        if 'maximum' in node and value > node['maximum']:
            out.append(f'{where}: above {node["maximum"]}')
    if isinstance(value, dict):
        for k in node.get('required', []):
            if k not in value:
                out.append(f'{where}: no {k}')
        for k, sub in node.get('properties', {}).items():
            if k in value:
                validate(value[k], sub, root, f'{path}.{k}' if path else k, out)
    if isinstance(value, list):
        if 'maxItems' in node and len(value) > node['maxItems']:
            out.append(f'{where}: more than {node["maxItems"]} entries')
        if 'items' in node:
            for i, v in enumerate(value):
                validate(v, node['items'], root, f'{path}[{i}]', out)
    return out


def item_name(pack, i):
    items = pack.get('items') if isinstance(pack, dict) else None
    it = items[i] if isinstance(items, list) and i < len(items) else None
    return it.get('id') if isinstance(it, dict) and it.get('id') else f'item {i}'


def check_packs(files, schema=None):
    """{file name: {'errors': [...], 'notes': [...]}} for every file, checked alone and against the others."""
    schema = schema or load_schema()
    report = {}
    packs = {}
    for f in files:
        name = Path(f).name
        r = report.setdefault(name, {'errors': [], 'notes': []})
        try:
            pack = json.loads(Path(f).read_text(encoding='utf-8'))
        except (OSError, ValueError) as e:
            r['errors'].append(f'not readable JSON: {e}')
            continue
        packs[name] = pack
        for p in validate(pack, schema, schema):
            m = re.match(r'items\[(\d+)\](.*)', p)
            r['errors'].append(f'{item_name(pack, int(m.group(1)))}{m.group(2)}' if m else p)
    seen = {}
    for name, pack in packs.items():
        for it in pack.get('items', []) if isinstance(pack.get('items'), list) else []:
            if not isinstance(it, dict) or not isinstance(it.get('id'), str):
                continue
            if it['id'] in seen:
                report[name]['errors'].append(f'{it["id"]}: also in {seen[it["id"]]}')
            else:
                seen[it['id']] = name
            if it.get('kind') == 'quote' and not str(it.get('speaker') or '').strip():
                report[name]['errors'].append(f'{it["id"]}: a quote with nobody who said it')
    for name, pack in packs.items():
        no_level = 0
        for it in pack.get('items', []) if isinstance(pack.get('items'), list) else []:
            if not isinstance(it, dict):
                continue
            for rid in it.get('related') or [] if isinstance(it.get('related'), list) else []:
                if isinstance(rid, str) and rid not in seen:
                    report[name]['notes'].append(f'{it.get("id")}: related {rid!r} is in no pack checked')
            if it.get('kind') in ('fact', 'quote') and 'level' not in it:
                no_level += 1
        if no_level:
            report[name]['notes'].append(f'{no_level} facts or quotes have no level of their own (read from difficulty)')
    return report


def main(argv):
    quiet = '--quiet' in argv
    args = [a for a in argv if a != '--quiet']
    files = [Path(a) for a in args] if args else sorted(p for p in PACKS.glob('*.json') if p.name != 'index.json')
    report = check_packs(files)
    bad = 0
    for name, r in report.items():
        if r['errors']:
            bad += 1
            print(f'ERROR {name}: {len(r["errors"])}')
            for e in r['errors'][:50]:
                print(f'  {e}')
        elif not quiet:
            print(f'ok    {name}')
        for n in ([] if quiet else r['notes'][:10]):
            print(f'  note: {n}')
    print(f'{len(report) - bad} of {len(report)} packs clean')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
