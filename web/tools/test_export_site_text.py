#!/usr/bin/env python3
"""export_site_text.py --apply: putting rewritten lines back where they came from. Small fixture
sources, one per encoding case - JS strings of each quote style, template placeholders (by name and by
order), markup inside JS, HTML text and attributes, inline tags put back in order, `+`-joined
sentences, CSS `content:`, Python strings - plus the refusals (a dropped placeholder or tag, an
invented one, a row whose words changed since the export) and the end-to-end run over a scratch tree
(--skip, --dry-run, newlines kept, the file written from the end backwards).

Run, from web/:
    py -3.13 tools/test_export_site_text.py
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import export_site_text as X  # noqa: E402

passed = 0
failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


def rows(rel, src, keep_all=False):
    col = X.Collector()
    X.scan_one(col, rel, src, keep_all=keep_all)
    return {it.text: it for it in col.order}


def run(rel, src, changes):
    """changes: {old exported text: new text} -> (new src, done, refused, warn), refused keyed by OLD text."""
    by_text = rows(rel, src)
    missing = [o for o in changes if o not in by_text]
    assert not missing, f'fixture rows not exported: {missing} (have {list(by_text)})'
    wanted = {by_text[o].id: n for o, n in changes.items()}
    new_src, done, refused, warn = X.apply_to_file(rel, src, [by_text[o] for o in changes], wanted)
    back = {by_text[o].id: o for o in changes}
    return new_src, {back[i]: d for i, d in done.items()}, {back[i]: r for i, r in refused.items()}, \
        {back[i]: w for i, w in warn.items()}


def shows(rel, src, text):
    return text in rows(rel, src, keep_all=True)


# ---------------------------------------------------------------- JS strings, each quote style
src = "el.textContent = 'Press start';\n"
out, done, ref, _ = run('a.js', src, {'Press start': "Don't stop"})
check('single quote: an apostrophe is escaped', out == "el.textContent = 'Don\\'t stop';\n", repr(out))
check('single quote: the re-scan shows the new words', shows('a.js', out, "Don't stop"))

src = 'const x = { label: "Save it" };\n'
out, done, ref, _ = run('a.js', src, {'Save it': 'Say "hi"'})
check('double quote: a double quote is escaped', out == 'const x = { label: "Say \\"hi\\"" };\n', repr(out))

src = "setStatus(`Press it`);\n"
out, done, ref, _ = run('a.js', src, {'Press it': 'Press `Go` for $5 or ${'})
check('template: a backtick and a ${ are escaped', out == "setStatus(`Press \\`Go\\` for $5 or \\${`);\n", repr(out))

src = "alert('Line one\\nLine two');\n"
out, done, ref, _ = run('a.js', src, {'Line one\\nLine two': 'First\\nSecond'})
check('the export\'s \\n stays a line break escape', out == "alert('First\\nSecond');\n", repr(out))

src = "note('Saved to the folder.');\n"
out, done, ref, _ = run('a.js', src, {'Saved to the folder.': 'Saved in C:\\Users\\you.'})
check('a real backslash is doubled', out == "note('Saved in C:\\\\Users\\\\you.');\n", repr(out))
check('... and reads back as one backslash', shows('a.js', out, 'Saved in C:\\Users\\you.'))

src = "setStatus('Error: ' + e.message);\n"
out, done, ref, _ = run('a.js', src, {'Error:': 'Problem:'})
check('spaces at a literal\'s ends are kept', out == "setStatus('Problem: ' + e.message);\n", repr(out))

src = "setStatus('Two  spaces   here');\n"
out, done, ref, _ = run('a.js', src, {'Two spaces here': 'One space now'})
check('collapsed double spaces in the export still match', out == "setStatus('One space now');\n", repr(out))

src = "a.title = 'Same words';\nb.title = 'Same words';\n"
out, done, ref, _ = run('a.js', src, {'Same words': 'New words'})
check('the same words twice in a file: both change', out == "a.title = 'New words';\nb.title = 'New words';\n", repr(out))

src = "const ZONES = [['UTC', 'UTC']];\n"
out, done, ref, warn = run('a.js', src, {'UTC': 'Coordinated Universal Time (UTC)'})
check('a short word in several places carries a WARNING (one may be a code value)',
      'UTC' in warn and any('places' in w for w in warn['UTC']), repr(warn))

# ---------------------------------------------------------------- template placeholders
src = "setStatus(`Saved ${n} photos.`);\n"
out, done, ref, _ = run('a.js', src, {'Saved {n} photos.': '{n} photos are saved.'})
check('placeholder by name', out == "setStatus(`${n} photos are saved.`);\n", repr(out))

out, done, ref, _ = run('a.js', src, {'Saved {n} photos.': '{count} photos are saved.'})
check('placeholder by order when the rewrite renamed it', out == "setStatus(`${n} photos are saved.`);\n", repr(out))

src = "setStatus(`From ${a} to ${b}.`);\n"
out, done, ref, _ = run('a.js', src, {'From {a} to {b}.': 'To {b}, from {a}.'})
check('two placeholders moved: each by its name', out == "setStatus(`To ${b}, from ${a}.`);\n", repr(out))

src = "setStatus(`Saved ${n} photos.`);\n"
out, done, ref, _ = run('a.js', src, {'Saved {n} photos.': 'Photos are saved.'})
check('a dropped placeholder is refused', 'Saved {n} photos.' in ref and out == src, repr(ref))

src = "setStatus('Photos are saved.');\n"
out, done, ref, _ = run('a.js', src, {'Photos are saved.': 'Saved {n} photos.'})
check('an invented placeholder is refused', 'Photos are saved.' in ref and out == src, repr(ref))

src = "setStatus(`Hi ${user.name.first.toUpperCase() + ' and ' + other.name.first}, welcome.`);\n"
d = next(iter(rows('a.js', src)))
check('a long placeholder shows as {…}', '{…}' in d, d)
out, done, ref, _ = run('a.js', src, {d: 'Welcome, {…}.'})
check('{…} goes back as the same expression', out == "setStatus(`Welcome, ${user.name.first.toUpperCase() + ' and ' + other.name.first}.`);\n", repr(out))

# ---------------------------------------------------------------- markup inside JS
src = "el.innerHTML = '<p>It is <b>on</b> now</p>';\n"
out, done, ref, _ = run('a.js', src, {'It is <b>on</b> now': "It's <b>off</b> now"})
check('markup in a quoted string: tags back, quote escaped', out == "el.innerHTML = '<p>It\\'s <b>off</b> now</p>';\n", repr(out))

src = "el.innerHTML = `<p>Hi ${esc(name)}, <b>welcome</b></p>`;\n"
out, done, ref, _ = run('a.js', src, {'Hi {name}, <b>welcome</b>': '<b>Welcome</b>, {name} & R&D'})
check('markup in a template: placeholder and tag back, & escaped only where it would read as markup',
      out == "el.innerHTML = `<p><b>Welcome</b>, ${esc(name)} & R&amp;D</p>`;\n", repr(out))

src = "el.innerHTML = '<button title=\"Open it\">Go</button>';\n"
out, done, ref, _ = run('a.js', src, {'Open it': 'Open "it" now'})
check('an attribute in JS markup: its quote becomes an entity',
      out == "el.innerHTML = '<button title=\"Open &quot;it&quot; now\">Go</button>';\n", repr(out))

src = "x = '<a class=\"btn\" href=\"' + url + '\">Parts list (JSON)</a>';\n"
old = next(t for t in rows('a.js', src) if 'Parts' in t)
out, done, ref, _ = run('a.js', src, {old: old.replace('(JSON)', '(JSON, a text file)')})
check('a run that starts inside a tag keeps its </a> (nesting no worse than before)',
      'a text file)</a>' in out and not ref, repr(ref))

# ---------------------------------------------------------------- HTML files
src = '<p>Fish &amp; chips</p>\n'
out, done, ref, _ = run('a.html', src, {'Fish & chips': 'Tom & Jerry, R&D, <your folder>'})
check('HTML text: & and < escaped only where they would read as markup',
      out == '<p>Tom & Jerry, R&amp;D, &lt;your folder></p>\n', repr(out))
check('... and the re-scan shows the new words', shows('a.html', out, 'Tom & Jerry, R&D, <your folder>'))

src = '<p>Read <a href="/x">the guide</a> or <a href="/y">the list</a>.</p>\n'
out, done, ref, _ = run('a.html', src, {'Read <a>the guide</a> or <a>the list</a>.':
                                         'See <a>the list</a> and <a>the guide</a>.'})
check('inline tags go back in order: the first <a> keeps the first link',
      out == '<p>See <a href="/x">the list</a> and <a href="/y">the guide</a>.</p>\n', repr(out))

out, done, ref, _ = run('a.html', src, {'Read <a>the guide</a> or <a>the list</a>.': 'See the guide or the list.'})
check('a dropped tag is refused', len(ref) == 1 and out == src, repr(ref))
out, done, ref, _ = run('a.html', src, {'Read <a>the guide</a> or <a>the list</a>.':
                                         'See <b>the</b> <a>guide</a> or <a>list</a>.'})
check('an added tag is refused', len(ref) == 1 and out == src, repr(ref))
out, done, ref, _ = run('a.html', src, {'Read <a>the guide</a> or <a>the list</a>.':
                                         'See </a>the guide<a> or <a>the list</a>.'})
check('a tag closed before it opens is refused', len(ref) == 1 and out == src, repr(ref))

src = '<button title="Open it" aria-label=\'Open it now\'>Go</button>\n'
out, done, ref, _ = run('a.html', src, {'Open it': 'Open "it"', 'Open it now': "Open 'it' now"})
check('HTML attributes: each one\'s own quote becomes an entity',
      out == '<button title="Open &quot;it&quot;" aria-label=\'Open &#39;it&#39; now\'>Go</button>\n', repr(out))

src = ('<div>\n  <p>One long line of text that was written over\n     several lines in the source, the way an\n'
       '     editor wraps a paragraph.</p>\n</div>\n')
old = 'One long line of text that was written over several lines in the source, the way an editor wraps a paragraph.'
new = ('A new and somewhat longer paragraph, written back over several lines, at the width and the indent the old '
       'lines had, so the diff reads like the code around it.')
out, done, ref, warn = run('a.html', src, {old: new})
check('text that sat over several lines is wrapped back with the old indent',
      '\n     ' in out and shows('a.html', out, new) and not warn, repr(out))

src = '<pre>Line one\nLine two</pre>\n'
out, done, ref, warn = run('a.html', src, {'Line one Line two': 'Only one line'})
check('inside <pre> nothing is wrapped (line breaks show there)', out == '<pre>Only one line</pre>\n' and warn, repr(out))

# ---------------------------------------------------------------- + joined sentences
src = "setStatus('One sentence ' +\n  'over two lines.');\n"
out, done, ref, _ = run('a.js', src, {'One sentence over two lines.': 'A different and longer sentence, still over two lines.'})
check('a + joined sentence stays two pieces', out.count("'") == 4 and "+\n  '" in out, repr(out))
check('... and reads back as one sentence', shows('a.js', out, 'A different and longer sentence, still over two lines.'))

src = "setStatus('You have ' +\n  `${n} new` + ' pictures.');\n"
old = next(iter(rows('a.js', src)))
out, done, ref, _ = run('a.js', src, {old: 'There are {n} new pictures to see today.'})
check('a joined sentence with a placeholder: it lands in its own template piece',
      '`' in out and '${n}' in out.split('`')[1] and shows('a.js', out, 'There are {n} new pictures to see today.'),
      repr(out))

# ---------------------------------------------------------------- nested: a row inside another row's placeholder
src = "el.innerHTML = `<p>Has <b>${n}</b> voices${n ? '' : ' - so it is silent and nothing plays here'}.</p>`;\n"
outer = next(t for t in rows('a.js', src) if t.startswith('Has'))
out, done, ref, _ = run('a.js', src, {outer: 'It has <b>{n}</b> voices{…}.',
                                       '- so it is silent and nothing plays here': '(so nothing can be heard)'})
check('a row inside another row\'s placeholder: both are written (two passes)',
      len(done) == 2 and "' (so nothing can be heard)'" in out and 'It has <b>${n}</b>' in out, repr((out, ref)))

src = "x = `<li>${name}${st.away ? ' (dropped off)' : ''}</li>`;\n"
out, done, ref, _ = run('a.js', src, {'(dropped off)': '(stopped answering)'})
check('a string shown inside another line\'s placeholder still applies', "' (stopped answering)'" in out and not ref,
      repr(ref))

# ---------------------------------------------------------------- the old words left in skipped code
src = "label: 'Muted',\nif (b.textContent === 'Muted') go();\n"
out, done, ref, warn = run('a.js', src, {'Muted': 'Quiet'})
check('old words still in a compare: applied, with a WARNING', 'Muted' in warn and "=== 'Muted'" in out, repr(warn))

# ---------------------------------------------------------------- CSS, Python
src = '.x::after { content: "Read more"; }\n'
out, done, ref, _ = run('a.css', src, {'Read more': "Read what's next"})
check('CSS content: the other quote is plain text', out == '.x::after { content: "Read what\'s next"; }\n', repr(out))
out, done, ref, _ = run('a.css', src, {'Read more': 'Read "more"'})
check('CSS content with its own quote is refused (the export shows CSS escapes raw)', len(ref) == 1 and out == src,
      repr(ref))

src = 'REFUSAL_TEXT = ("That is not "\n                "allowed here.")\n'
out, done, ref, _ = run('server/a.py', src, {'That is not allowed here.': "That isn't allowed on this \"site\"."})
check('Python: the implicit join stays two pieces, quotes escaped',
      out.count('\n') == 2 and X.py_strings(out) >= {"That isn't allowed on this \"site\"."}, repr(out))

src = 'N = 5\nNOTES_TEXT = f"At most {N} rows are kept here."\n'
out, done, ref, _ = run('server/a.py', src, {'At most {N} rows are kept here.': 'Up to {N} rows are kept.'})
check('Python f-strings are refused (put back by hand)', len(ref) == 1 and out == src, repr(ref))

# ---------------------------------------------------------------- end to end over a scratch tree
tmp = Path(tempfile.mkdtemp(prefix='nimrod_apply_test_'))
saved = (X.WEB, X.CLIENT, X.SERVER)
try:
    X.WEB, X.CLIENT, X.SERVER = tmp, tmp / 'client', tmp / 'server'
    (tmp / 'client').mkdir()
    (tmp / 'server').mkdir()
    page = (tmp / 'client' / 'page.js')
    page.write_bytes(b"setStatus('First line here');\r\nsetStatus('Second line here');\r\nsetStatus('Third line here');\r\n")
    col, _ = X.raw_scan()
    ids = {it.text: it.id for it in col.order}
    changes = tmp / 'changes.txt'
    changes.write_text('# a comment\n'
                       f'{ids["First line here"]} => The first line\n'
                       f'{ids["Second line here"]} => The second line\n'
                       f'{ids["Third line here"]} => The third line\n'
                       't00000000 => A row whose words changed since the export\n', encoding='utf-8')
    skip = tmp / 'undo.txt'
    skip.write_text(f'{ids["Third line here"]} => (leave as it is today)\n', encoding='utf-8')
    before = page.read_bytes()
    r = X.apply_changes(changes, [skip], dry_run=True)
    check('dry run: reports, writes nothing', page.read_bytes() == before and len(r['applied']) == 2, r['report'])
    check('a stale id is refused, not guessed', 't00000000' in r['refused'] and 'changed' in r['refused']['t00000000'])
    check('--skip leaves a row out', r['skipped'] == [ids['Third line here']])
    r = X.apply_changes(changes, [skip])
    after = page.read_bytes()
    check('apply: both rows written, CRLF kept',
          after == b"setStatus('The first line');\r\nsetStatus('The second line');\r\nsetStatus('Third line here');\r\n",
          repr(after))
    r = X.apply_changes(changes, [skip])
    check('applying twice: the second run refuses every row (the words already changed)',
          len(r['applied']) == 0 and page.read_bytes() == after)
finally:
    X.WEB, X.CLIENT, X.SERVER = saved
    shutil.rmtree(tmp, ignore_errors=True)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
