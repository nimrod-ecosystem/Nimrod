"""Suite for find_copies.py: a copied block is found (names changed or not), unrelated code is not, a repeating table in one
file is not a copy, and comments do not count. Run: py -3.13 web/tools/test_find_copies.py"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import find_copies as F

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


BODY = '''
export function settle(list, limit) {
  const out = [];
  for (const item of list) {
    if (!item || typeof item.value !== 'number') continue;
    const v = Math.max(0, Math.min(limit, item.value * 2 + 1));
    out.push({ id: item.id, value: v, label: `${item.name} (${v})` });
  }
  out.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  return out.slice(0, limit);
}
'''
RENAMED = BODY.replace('settle', 'rankThem').replace('list', 'rows').replace('item', 'row').replace('limit', 'most')
OTHER = '''
export function greet(person) {
  if (!person) return 'Hello.';
  return `Hello, ${person.name}. It is ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}.`;
}
// a comment that is long enough to look like code if comments were counted, a comment that is long enough to look like code
'''
TABLE = 'export const T = [\n' + ''.join(f"  {{ id: 'r{i}', w: {i}, h: {i * 2}, label: 'Row {i}' }},\n" for i in range(40)) + '];\n'

with tempfile.TemporaryDirectory() as d:
    for name, src in (('a.js', BODY), ('b.js', RENAMED), ('c.js', OTHER), ('table.js', TABLE)):
        with open(os.path.join(d, name), 'w', encoding='utf-8') as f:
            f.write(src)
    found, n = F.find(min_tokens=50, min_lines=5, roots=[d])
    files = {tuple(sorted((x['a']['file'], x['b']['file']))) for x in found}
    check('*** a copied function is found, even with its names changed ***', ('a.js', 'b.js') in files, found)
    check('unrelated code is not', not any('c.js' in pair for pair in files), files)
    check('a repeating table in one file is not a copy of itself', not any(pair == ('table.js', 'table.js') for pair in files), files)
    check('every block says where, in both places, with lines', all(x['a']['lines'][0] <= x['a']['lines'][1] and x['tokens'] >= 50 for x in found))

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
