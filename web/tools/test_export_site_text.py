#!/usr/bin/env python3
"""export_site_text.py --apply: putting rewritten lines back where they came from. Small fixture
sources, one per encoding case - JS strings of each quote style, template placeholders (by name and by
order), markup inside JS, HTML text and attributes, inline tags put back in order, `+`-joined
sentences, CSS `content:`, Python strings - plus the refusals (a dropped placeholder or tag, an
invented one, a row whose words changed since the export) and the end-to-end run over a scratch tree
(--skip, --dry-run, newlines kept, the file written from the end backwards). And --apply-tsv, the second pass
(2026-10-13): the first pass's words found and rewritten, the export's original words still in the code written over
(and said so), ALREADY / REFUSED / SKIPPED rows, two rows the first pass made into one line.

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

# ---------------------------------------------------------------- --apply-tsv: a second pass (2026-10-13)
# The ids are the ORIGINAL export's; the code holds a first pass's words now. Each row carries the words in the code
# now and the words to show; the export names the file.
tmp = Path(tempfile.mkdtemp(prefix='nimrod_apply_tsv_test_'))
saved = (X.WEB, X.CLIENT, X.SERVER)
try:
    X.WEB, X.CLIENT, X.SERVER = tmp, tmp / 'client', tmp / 'server'
    for d in ('client', 'server', 'client/learn'):
        (tmp / d).mkdir()
    orig = {   # the export's words, per row
        'a': 'Pick the colour you like', 'b': 'Settings menu: the selected panel', 'c': 'Play a favourite',
        'd': 'Gone since the export', 'e': 'Learn page words', 'f': 'Switch the chosen one', 'g': 'Swap in the chosen one'}
    page = tmp / 'client' / 'page.js'
    # a: first pass changed it; b: first pass left it (a held rename); c: already reads the new words;
    # d: changed again since; f and g: the first pass made two rows identical, and g's new words are already in place.
    page.write_bytes(("setStatus('Pick the color you like');\r\n"
                      "setStatus('Settings menu: the selected panel');\r\n"
                      "setStatus('Play a favorite');\r\n"
                      "setStatus('Gone since the export, changed again');\r\n"
                      "hint('show something else in the part you picked');\r\n"
                      "title('another module in the place of the one you chose');\r\n").encode('utf-8'))
    (tmp / 'client' / 'learn' / 'x.js').write_text("setStatus('Learn page words, first pass');\n", encoding='utf-8')
    files = {'a': 'page.js', 'b': 'page.js', 'c': 'page.js', 'd': 'page.js', 'e': 'learn/x.js', 'f': 'page.js', 'g': 'page.js'}
    ids = {k: X.item_id(files[k], orig[k]) for k in orig}
    md = ['# export', '', '`web/client/page.js` · 6 rows', '']
    md += [f'- {ids[k]} · L1 · - · {orig[k]}' for k in 'abcdfg']
    md += ['', '`web/client/learn/x.js` · 1 rows', '', f'- {ids["e"]} · L1 · - · {orig["e"]}']
    export = tmp / 'export.md'
    export.write_text('\n'.join(md) + '\n', encoding='utf-8')
    tsv = tmp / 'second.tsv'
    tsv.write_text('\n'.join([
        '# a comment line',
        f'{ids["a"]}\tPick the color you like\tPick the color you love',
        f'{ids["b"]}\tSettings menu: the panel you picked\tSettings menu: the panel you picked',
        f'{ids["c"]}\tPlay a favourite\tPlay a favorite',
        f'{ids["d"]}\tGone since the export, first pass\tGone, second pass',
        f'{ids["e"]}\tLearn page words, first pass\tLearn page words, second pass',
        f'{ids["f"]}\tshow something else in the part you picked\tanother module in the place of the chosen one',
        f'{ids["g"]}\tshow something else in the part you picked\tanother module in the place of the one you chose',
        't00000000\tNot in the export\tAnything',
        'not a row at all',
    ]) + '\n', encoding='utf-8')
    before = page.read_bytes()
    r = X.apply_tsv(tsv, export, skip_dirs=['learn/'], dry_run=True)
    check('tsv dry run: reports, writes nothing', page.read_bytes() == before, r['report'])
    check('tsv: the first pass\'s words in the code are found and rewritten', ids['a'] in r['applied']
          and r['applied'][ids['a']][2] == 'Pick the color you love', r['report'])
    check('tsv: the export\'s ORIGINAL words still in the code (a held rename) are written over, and said so',
          ids['b'] in r['applied'] and ids['b'] in r['original'], r['report'])
    check('tsv: a row whose new words are already there is ALREADY, not refused', ids['c'] in r['already'], r['report'])
    check('tsv: words that changed since are REFUSED, with the nearest line', ids['d'] in r['refused']
          and 'nearest line now reads: Gone since the export, changed again' in r['refused'][ids['d']], r['refused'].get(ids['d']))
    check('tsv: a row in a skipped folder is SKIPPED', any(i == ids['e'] for i, _ in r['skipped']), r['report'])
    check('tsv: an id the export does not have is refused', 't00000000' in r['refused'], r['report'])
    check('tsv: two rows the first pass made one line: the one already in place is ALREADY, the other owns the line',
          ids['g'] in r['already'] and ids['f'] in r['applied']
          and r['applied'][ids['f']][2] == 'another module in the place of the chosen one', r['report'])
    check('tsv: an unreadable line is counted', '1 unreadable' in r['report'].split('\n')[0], r['report'].split('\n')[0])
    r = X.apply_tsv(tsv, export, skip_dirs=['learn/'])
    after = page.read_bytes()
    check('tsv apply: written, CRLF kept, the refused line untouched',
          after == ("setStatus('Pick the color you love');\r\n"
                    "setStatus('Settings menu: the panel you picked');\r\n"
                    "setStatus('Play a favorite');\r\n"
                    "setStatus('Gone since the export, changed again');\r\n"
                    "hint('another module in the place of the chosen one');\r\n"
                    "title('another module in the place of the one you chose');\r\n").encode('utf-8'), repr(after))
    check('tsv apply: the skipped folder is not touched',
          (tmp / 'client' / 'learn' / 'x.js').read_text(encoding='utf-8') == "setStatus('Learn page words, first pass');\n")
    r = X.apply_tsv(tsv, export, skip_dirs=['learn/'])
    check('tsv applying twice: nothing more is written, the rows read as ALREADY',
          not r['applied'] and page.read_bytes() == after and ids['a'] in r['already'], r['report'])
finally:
    X.WEB, X.CLIENT, X.SERVER = saved
    shutil.rmtree(tmp, ignore_errors=True)

# ---------------------------------------------------------------- --apply-page-edits: words changed in place (2026-10-25)
# web/client/wording_edit.js copies `page<TAB>words on the page<TAB>new words`. No id, no file: each is found by its
# words, the page narrowing words that are in more than one file; anything that would need a guess is refused.
tmp = Path(tempfile.mkdtemp(prefix='nimrod_page_edits_test_'))
saved = (X.WEB, X.CLIENT, X.SERVER)
try:
    X.WEB, X.CLIENT, X.SERVER = tmp, tmp / 'client', tmp / 'server'
    for d in ('client', 'server'):
        (tmp / d).mkdir()
    (tmp / 'client' / 'home.html').write_text('<!doctype html><title>Home</title>\n<p>Welcome home</p>\n'
                                              '<script type="module" src="./home.js"></script>\n', encoding='utf-8')
    (tmp / 'client' / 'home.js').write_bytes((
        "import './shared.js';\r\n"
        "el.textContent = `You have ${n} new notes`;\r\n"
        "setStatus('Done for now');\r\n"
        "el.innerHTML = 'Read <a href=\"/guide\">the guide</a> first';\r\n").encode('utf-8'))
    (tmp / 'client' / 'shared.js').write_text("setStatus('Shared words here');\n", encoding='utf-8')
    (tmp / 'client' / 'other.js').write_text("setStatus('Done for now');\n", encoding='utf-8')
    (tmp / 'client' / 'third.js').write_text("setStatus('Twice over');\n", encoding='utf-8')
    (tmp / 'client' / 'fourth.js').write_text("setStatus('Twice over');\n", encoding='utf-8')
    tsv = tmp / 'wording.tsv'
    tsv.write_text('\n'.join([
        '# nimrod wording changes, 2026-10-25',
        '/home.html\tWelcome home\tWelcome back',
        '/home.html\tYou have 3 new notes\tThere are 3 new notes for you',
        '/home.html\tDone for now\tAll done',
        '/home.html\tTwice over\tTwo times',
        '/home.html\tRead the guide first\tRead the guide now',
        '/home.html\tHello Sam\tHi Sam',
        '/home.html\tShared words here\tShared words',
        'not a row at all',
    ]) + '\n', encoding='utf-8')
    r = X.apply_page_edits(tsv, dry_run=True)
    ap = {v[1]: v[2] for v in r['applied'].values()}
    refused = {old: why for _, _, old, why in r['refused']}
    check('page edits dry run: writes nothing', (tmp / 'client' / 'home.js').read_bytes().count(b'You have') == 1, r['report'])
    check('*** page edits: words the code holds once are found by their words (HTML) ***', ap.get('Welcome home') == 'Welcome back', r['report'])
    check('*** page edits: words the code filled in ({n}) are matched, and go back as {n} ***',
          ap.get('You have {n} new notes') == 'There are {n} new notes for you', r['report'])
    check('*** page edits: words in two files: the one the page loads is changed ***', ap.get('Done for now') == 'All done'
          and sum(1 for v in r['applied'].values() if v[1] == 'Done for now') == 1, r['report'])
    check('page edits: a file the page imports through another counts as on the page', ap.get('Shared words here') == 'Shared words', r['report'])
    check('*** page edits: words in two files the page does not load are REFUSED with both ids, never guessed ***',
          'Twice over' in refused and 'MORE THAN ONE PLACE' in refused['Twice over'] and refused['Twice over'].count(' t') >= 2, r['report'])
    check('*** page edits: a line with a link inside is REFUSED (the page cannot show where the tags go) ***',
          'Read the guide first' in refused and 'LINK OR BOLD' in refused['Read the guide first'], r['report'])
    check('*** page edits: words the code never holds (built at run time, or data) are NOT FOUND, for a person ***',
          'Hello Sam' in refused and 'NOT FOUND' in refused['Hello Sam'], r['report'])
    check('page edits: an unreadable line is counted', '1 unreadable' in r['report'].split('\n')[0], r['report'].split('\n')[0])
    tsv2 = tmp / 'wording2.tsv'
    tsv2.write_text('/home.html\tYou have 3 new notes\tYou have new notes\n', encoding='utf-8')
    r2 = X.apply_page_edits(tsv2, dry_run=True)
    check('*** page edits: dropping the part the code fills in is REFUSED, saying what it showed ***',
          not r2['applied'] and 'FILLS IN {n}' in r2['report'] and '"3"' in r2['report'], r2['report'])
    r = X.apply_page_edits(tsv)
    js = (tmp / 'client' / 'home.js').read_bytes().decode('utf-8')
    check('page edits apply: written in place, the template keeps ${n}, CRLF kept, the link line untouched',
          js == ("import './shared.js';\r\n"
                 "el.textContent = `There are ${n} new notes for you`;\r\n"
                 "setStatus('All done');\r\n"
                 "el.innerHTML = 'Read <a href=\"/guide\">the guide</a> first';\r\n"), repr(js))
    check('page edits apply: the other file\'s same words are left alone', (tmp / 'client' / 'other.js').read_text(encoding='utf-8') == "setStatus('Done for now');\n")
    check('page edits apply: the HTML page and the imported file too', '<p>Welcome back</p>' in (tmp / 'client' / 'home.html').read_text(encoding='utf-8')
          and (tmp / 'client' / 'shared.js').read_text(encoding='utf-8') == "setStatus('Shared words');\n")
finally:
    X.WEB, X.CLIENT, X.SERVER = saved
    shutil.rmtree(tmp, ignore_errors=True)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
