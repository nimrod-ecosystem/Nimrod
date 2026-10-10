#!/usr/bin/env python3
"""export_site_text.py - EXPORT EVERY LINE OF VISIBLE SITE TEXT, WITH WHERE IT LIVES, FOR A REWRITE.

*** WHY THIS EXISTS. *** Row 2.75 (chat note BN item 2, 2026-10-09): the site's words are to be
rewritten by a separate chat. That chat cannot read the code, and a rewrite that cannot be put back
is a document, not a change. So this lists the text a visitor can see - page by page, module by
module, menu by menu - and beside every line puts a STABLE ID, the file and line it lives on, and
the EXACT original wording, so a later `--apply` can put each rewritten line back where it came from.

WHAT IT READS (static scan, no server needed):
  * web/client/**/*.html  - text between tags, and title= / aria-label= / placeholder= / alt= /
    meta description; inline <script> blocks are read as JS (below).
  * web/client/**/*.js    - string literals (single, double, template). Comments are skipped (the
    same small scanner shape as check_site_copy.py). A literal is kept when its CONTEXT says it is
    shown (`label:`, `help:`, `note:`, `title:`, `.textContent =`, `setStatus(`, `setAttribute('aria-
    label', ...)`, ...) or when it READS like words and nothing says it is code (an `===` compare, an
    event topic, a selector, a class name, a CSS value, a URL, `console.*`). Markup built in a string
    or template is split into its text and its visible attributes, like an HTML page.
    Template `${expr}` parts are shown as `{expr}` (`{…}` when the expression is long).
  * web/client/**/*.css   - `content: "..."` with words in it.
  * web/server/*.py       - the privacy list (db.py STORAGE_NOTES / NEVER_STORED / describe_storage),
    and module-level *_TEXT / *_REFUSAL / *_MESSAGE constants, and HTTPException details (weak: shown
    only when something is refused).
SKIPPED, BY DESIGN: comments; web/client/dev/ (test pages); vendor/; question/word CONTENT (packs/,
the trivia/word-game banks, the AAC board's words) - those are counted, not exported, because they
are content, not the site's own copy.

AND A HEADLESS PASS (`--runtime`), cheap and optional: starts the app server on a scratch database
under %TEMP%, opens each page in headless Chrome (run_suite.py's browser and CDP), signed out for the
landing and signed in as a throwaway dev user for the rest, and reads `document.body.innerText` plus
title/aria-label/placeholder attributes. A runtime line that matches an exported line marks it SEEN;
one that matches nothing is listed as RUNTIME ONLY (text built at runtime, or data). The server is
stopped and the scratch folder deleted afterwards.

*** A REPORT, NOT A GATE. *** "Is this string ever on a screen?" cannot be fully decided by reading
code. Lines kept on looks alone and lines that only show when something fails are marked `?`.
Exit status is 0.

THE IDS, AND HOW `--apply` WORKS (built 2026-10-10; tests: web/tools/test_export_site_text.py):
  id = 't' + first 8 hex of sha1("<path relative to repo>\\0<the exported text>").
  It depends on the file and the words, NOT the line number, so it survives code moving around. The
  same words twice in one file are ONE row (all their lines listed) and one rewrite changes them all.
  `--apply` reads `<id> => <new text>` lines; re-runs this same scan to rebuild id -> exact source
  spans (the id is a hash of the exported words, so an id that is not found means the words changed
  since the export: it is REFUSED and reported, never guessed - and the export's trimmed ends and
  collapsed double spaces match automatically, because the scan computes the same display text);
  re-encodes the new text for where it sits (the literal's own quote and backslashes in JS, `&`/`<`
  and the attribute's quote as entities in markup, `{expr}` back to `${expr}` in a template - by
  exact name, else by order - and inline tags put back in order, the n-th <a> to the n-th <a>); keeps
  the spaces a literal had at its ends ('Error: ' + x); cuts a `+`-joined sentence back into its
  pieces at spaces; and writes edits from the end of each file backwards so earlier offsets stay
  valid. Python (server) strings are put back by exact string on the row's lines. AND IT CHECKS ITS
  OWN WORK: each file is re-scanned (every literal, shown or not) and must differ from before by
  exactly the rows applied; a row that breaks that is taken back out and refused. When the old
  words are still in the file afterwards - in code the export skipped, like an `===` compare - the
  row is applied and a WARNING says to look at that code by hand.

USAGE, from the repo root:
    py -3.13 web/tools/export_site_text.py --out site_text.md
    py -3.13 web/tools/export_site_text.py --out site_text.md --runtime      (+ headless pass)
    py -3.13 web/tools/export_site_text.py --out site_text.md --json items.json
    py -3.13 web/tools/export_site_text.py --apply changes.txt [--skip ids.txt ...] [--dry-run]
        [--export site_text.md] [--report apply_report.txt]
"""
import argparse
import ast
import bisect
import hashlib
import html
import json
import os
import re
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB = REPO_ROOT / 'web'
CLIENT = WEB / 'client'
SERVER = WEB / 'server'
SKIP_DIRS = {'dev', 'vendor', 'node_modules', 'packs', 'packs_local', 'packs_review', '__pycache__',
             'demo-media', 'design-assets'}

# CONTENT, NOT COPY: counted (string literals) and named, not exported line by line.
CONTENT_FILES = {
    'aac_vocab.js': "the AAC talk board's words",
    'aac_sets_data.js': "the AAC talk board's word sets",
    'aac_sets.js': "the AAC talk board's word sets",
    'aac_symbols.js': "the AAC talk board's symbol names",
    'aac_clips.js': "the AAC talk board's sound clips",
    'word_games_words.js': 'word-game word lists',
    'word_builder_words.js': 'word-builder word lists',
}

MASK = '\ue000'

# --------------------------------------------------------------------------------------------
# JS scanner: string literals with their exact source spans.
# --------------------------------------------------------------------------------------------
REGEX_BEFORE = set('(,=:[!&|?{};+-*%<>~^')
KW_BEFORE_REGEX = {'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else',
                   'do', 'yield', 'await', 'instanceof'}


def js_literals(src, lo=0, hi=None):
    """[(start, end, quote, exprs)] - `start:end` is the literal's CONTENT (quotes excluded);
    `exprs` lists each template `${...}` as (start, end) covering `${` through `}`."""
    out = []
    n = len(src) if hi is None else hi

    def scan_code(i, stop_at_brace=False):
        depth = 0
        prev = ''
        while i < n:
            c = src[i]
            if c in ' \t\r\n':
                i += 1
                continue
            if src.startswith('//', i):
                j = src.find('\n', i, n)
                i = n if j < 0 else j
                continue
            if src.startswith('/*', i):
                j = src.find('*/', i + 2, n)
                i = n if j < 0 else j + 2
                continue
            if c == '/' and (prev == '' or prev == 'kw' or prev in REGEX_BEFORE):
                i = skip_regex(i)
                prev = 'r'
                continue
            if c in '\'"':
                i = read_string(i, c)
                prev = 's'
                continue
            if c == '`':
                i = read_template(i)
                prev = 's'
                continue
            if c.isalpha() or c in '_$':
                j = i
                while j < n and (src[j].isalnum() or src[j] in '_$'):
                    j += 1
                prev = 'kw' if src[i:j] in KW_BEFORE_REGEX else 'w'
                i = j
                continue
            if stop_at_brace:
                if c == '{':
                    depth += 1
                elif c == '}':
                    if depth == 0:
                        return i + 1
                    depth -= 1
            prev = c
            i += 1
        return i

    def skip_regex(i):
        i += 1
        in_class = False
        while i < n and src[i] != '\n':
            c = src[i]
            if c == '\\':
                i += 2
                continue
            if c == '[':
                in_class = True
            elif c == ']':
                in_class = False
            elif c == '/' and not in_class:
                i += 1
                while i < n and src[i].isalpha():
                    i += 1
                return i
            i += 1
        return i

    def read_string(i, q):
        start = i + 1
        i += 1
        while i < n and src[i] != q and src[i] != '\n':
            if src[i] == '\\':
                i += 2
                continue
            i += 1
        out.append((start, min(i, n), q, []))
        return i + 1

    def read_template(i):
        start = i + 1
        i += 1
        exprs = []
        while i < n and src[i] != '`':
            if src[i] == '\\':
                i += 2
                continue
            if src.startswith('${', i):
                es = i
                i = scan_code(i + 2, stop_at_brace=True)
                exprs.append((es, i))
                continue
            i += 1
        out.append((start, min(i, n), '`', exprs))
        return i + 1

    scan_code(lo)
    return out


JS_ESC = re.compile(r'\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\'"`$\\/{}]|\r?\n)')


def js_unescape(s):
    def rep(m):
        g = m.group(1)
        if g.startswith('u{'):
            return chr(int(g[2:-1], 16))
        if g[0] == 'u' and len(g) == 5:
            return chr(int(g[1:], 16))
        if g[0] == 'x' and len(g) == 3:
            return chr(int(g[1:], 16))
        if g in ('\n', '\r\n'):
            return ''
        return g
    s = JS_ESC.sub(rep, s)
    try:
        s = s.encode('utf-16', 'surrogatepass').decode('utf-16')
    except Exception:
        pass
    return s


WRAPPERS = re.compile(r'^(?:esc|escape|escapeHtml|escHtml|escAttr|attr|html|text|String|safe|h|e)\((.*)\)$', re.S)


def placeholder(expr):
    e = ' '.join(expr.split())
    for _ in range(3):
        m = WRAPPERS.match(e)
        if not m:
            break
        e = m.group(1).strip()
    return '{' + (e if len(e) <= 40 and '`' not in e else '…') + '}'


def display(src, s, e, exprs, js, markup):
    """The exported text for src[s:e]: JS escapes and HTML entities decoded, `${x}` as `{x}`."""
    return ' '.join(display_raw(src, s, e, exprs, js, markup).split())


def display_raw(src, s, e, exprs, js, markup):
    parts = []
    i = s
    for es, ee in exprs:
        if ee <= s or es >= e:
            continue
        if es > i:
            parts.append(('t', src[i:es]))
        parts.append(('x', src[es + 2:ee - 1]))
        i = max(i, ee)
    if i < e:
        parts.append(('t', src[i:e]))
    out = []
    for k, v in parts:
        if k == 't':
            if js:
                v = js_unescape(v)
            if markup:
                v = html.unescape(v)
            out.append(v)
        else:
            out.append(placeholder(v))
    return ''.join(out)


# --------------------------------------------------------------------------------------------
# Markup: text nodes and visible attributes, with spans. Works on a MASKED string (template
# expressions replaced by MASK, same length) so offsets map straight back to the source.
# --------------------------------------------------------------------------------------------
HIDE_BLOCKS = re.compile(r'<!--.*?-->|<(script|style|template-x)\b[^>]*>.*?</\1\s*>', re.S | re.I)
TAG = re.compile(r'<(/?)([a-zA-Z][\w:-]*)((?:[^<>"\']|"[^"]*"|\'[^\']*\')*)>|<![^<>]*>')
VIS_ATTR = re.compile(r'(?<![\w-])(title|aria-label|aria-description|aria-valuetext|placeholder|alt|data-tip|data-tooltip)\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', re.I)
VALUE_ATTR = re.compile(r'(?<![\w-])value\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', re.I)
META_CONTENT = re.compile(r'(?<![\w-])content\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', re.I)
LOOKS_HTML = re.compile(r'<[a-zA-Z][\w-]*(?:\s[^<>]*)?/?>|</[a-zA-Z][\w-]*\s*>')


INLINE_TAGS = {'a', 'b', 'strong', 'em', 'i', 'u', 's', 'code', 'kbd', 'span', 'small', 'abbr', 'sup', 'sub',
               'mark', 'q', 'cite', 'time', 'var', 'samp', 'bdi', 'bdo', 'wbr', 'br', 'data', 'dfn', 'ins', 'del'}


def markup_fragments(masked, base):
    """Yield (start, end, how, tags) spans (absolute) of visible text in a markup string.

    A LINE OF TEXT RUNS FROM ONE BLOCK TAG TO THE NEXT: inline tags (<a>, <b>, <code>, <kbd>, <br>...)
    stay inside it, so a sentence with a link in it is one row, not three pieces. `tags` lists the
    inline tags inside the run as (start, end, '<a>' / '</a>') so the row can show them by name."""
    hidden = HIDE_BLOCKS.sub(lambda m: ' ' * len(m.group(0)), masked)
    # Comments, scripts and styles inside a run are left out of its text (shown as nothing).
    gone = [(base + m.start(), base + m.end(), '') for m in HIDE_BLOCKS.finditer(masked)]
    pos = 0
    inline = []

    def flush(a, b):
        tags = sorted(inline + [g for g in gone if g[0] >= base + a and g[1] <= base + b])
        yield from _run(hidden, a, b, base, tags)

    for m in TAG.finditer(hidden):
        name = (m.group(2) or '').lower()
        if not m.group(0).startswith('<!') and name in INLINE_TAGS:
            inline.append((base + m.start(), base + m.end(), f'<{m.group(1)}{name}>'))
        else:
            if m.start() > pos:
                yield from flush(pos, m.start())
            pos = m.end()
            inline = []
        if m.group(0).startswith('<!'):
            continue
        attrs = m.group(3) or ''
        a0 = m.start(3)
        for am in VIS_ATTR.finditer(attrs):
            g = 2 if am.group(2) is not None else 3
            yield from _trimmed(hidden, a0 + am.start(g), a0 + am.end(g), base, 'attr:' + am.group(1).lower())
        if name == 'input' and re.search(r'type\s*=\s*["\']?(button|submit|reset)', attrs, re.I):
            for am in VALUE_ATTR.finditer(attrs):
                g = 1 if am.group(1) is not None else 2
                yield from _trimmed(hidden, a0 + am.start(g), a0 + am.end(g), base, 'attr:value')
        if name == 'meta' and re.search(r'(name|property)\s*=\s*["\'](description|og:title|og:description|twitter:title|twitter:description)', attrs, re.I):
            for am in META_CONTENT.finditer(attrs):
                g = 1 if am.group(1) is not None else 2
                yield from _trimmed(hidden, a0 + am.start(g), a0 + am.end(g), base, 'attr:meta')
    if pos < len(hidden):
        yield from flush(pos, len(hidden))


def _trimmed(s, a, b, base, how, tags=()):
    seg = s[a:b]
    if not re.search(r'[A-Za-z\u00c0-\uffff]', seg.replace(MASK, '')):
        return
    lead = len(seg) - len(seg.lstrip())
    trail = len(seg) - len(seg.rstrip())
    yield (base + a + lead, base + b - trail, how, list(tags))


VOID_INLINE = {'<br>', '<wbr>', ''}


def _has_letters(hidden, a, b, base, tags):
    seg = list(hidden[a:b])
    for ts, te, _ in tags:
        for k in range(max(ts - base, a) - a, min(te - base, b) - a):
            seg[k] = ' '
    return bool(re.search(r'[A-Za-z\u00c0-\uffff]', ''.join(seg).replace(MASK, '')))


def _top_elements(tags, base):
    """Top-level inline elements as (open_start, open_end, close_start, close_end), relative."""
    out, depth, cur = [], 0, None
    for ts, te, name in tags:
        if name in VOID_INLINE:
            continue
        if not name.startswith('</'):
            if depth == 0:
                cur = [ts - base, te - base]
            depth += 1
        else:
            depth -= 1
            if depth == 0 and cur:
                out.append((cur[0], cur[1], ts - base, te - base))
                cur = None
            depth = max(depth, 0)
    return out


def _run(hidden, a, b, base, inline, depth=0):
    """A run of text with its inline tags; nothing if, tags aside, it has no letters.

    WHEN THE RUN IS ONLY ELEMENTS (a row of links, a list of chips): one element is opened and its
    inside is the row; several are one row each. Text outside them keeps the run whole."""
    if not _has_letters(hidden, a, b, base, inline):
        return
    seg = hidden[a:b]
    lead = len(seg) - len(seg.lstrip())
    trail = len(seg) - len(seg.rstrip())
    a2, b2 = a + lead, b - trail
    tops = [t for t in _top_elements([x for x in inline if a2 <= x[0] - base < b2], base) if a2 <= t[0] and t[3] <= b2]
    if tops and depth < 6:
        outside = [(base + t[0], base + t[3], 'x') for t in tops]
        if not _has_letters(hidden, a2, b2, base, outside + [g for g in inline if g[2] == '']):
            for os_, oe, cs, ce in tops:
                yield from _run(hidden, oe, cs, base, [x for x in inline if oe <= x[0] - base and x[1] - base <= cs], depth + 1)
            return
    yield from _trimmed(hidden, a, b, base, 'text', inline)


def markup_display(src, s, e, tags, exprs, js):
    """A run's text with its inline tags shown by name only (`<a>`, `</a>`, `<br>`)."""
    out = []
    i = s
    for ts, te, name in tags:
        if te <= s or ts >= e:
            continue
        out.append(display_raw(src, i, ts, exprs, js, True))
        out.append(name)
        i = te
    out.append(display_raw(src, i, e, exprs, js, True))
    return ' '.join(''.join(out).split())


# --------------------------------------------------------------------------------------------
# Is this literal shown? Context first, then looks.
# --------------------------------------------------------------------------------------------
KEEP_TAIL = re.compile(
    r'(?:\b(?:label|labels|title|heading|header|help|helpText|note|notes|description|desc|hint|Hint|tip|'
    r'tooltip|why|Why|text|blurb|summary|caption|placeholder|onLabel|offLabel|message|msg|prompt|question|'
    r'subtitle|sub|detail|details|body|empty|emptyText|none|nothing|confirm|confirmText|doneText|button|'
    r'buttonText|cta|alt|ariaLabel|say|spoken|speak|line|intro|explain|explanation|reason|warning|lead|'
    r'more|less|plain|plainLabel|short|shortLabel|long|longLabel|verbLabel|displayName|word|words|'
    r'headline|tagline|instructions|instruction|ask|answerText|hello|greeting|offline|error|fail|failed|'
    r'ok|okText|cancelText|yesText|noText|statusText|aria|then|else|before|after|done|off|on)\s*[:=]\s*'
    r'|\.(?:textContent|innerText|title|placeholder|ariaLabel|alt|label)\s*\+?=\s*'
    r'|setAttribute\(\s*[\'"](?:title|aria-label|placeholder|alt|aria-description|aria-valuetext)[\'"]\s*,\s*'
    r'|\b(?:setStatus|status|say|speak|announce|notify|\w+Notify|toast|alert|confirm|prompt|showMessage|'
    r'flash|setText|setHint|setNote|setLabel|setTitle|setMessage|createTextNode|insertAdjacentText|append|'
    r'prepend|replaceChildren|tell|show|showStatus|setLine|line|msg|note|caption|hint|banner|tip|speakText|'
    r'sayText|setCaption|setHeading)\s*\(\s*)$')
DROP_TAIL = re.compile(
    r'(?:===?|!==?|\bcase|\bin|\bimport|\bfrom|\brequire\(|\bexport\s+\*\s+from|\bimport\(|instanceof)\s*$'
    r'|\b(?:querySelector(?:All)?|getElementById|getElementsBy\w+|closest|matches|getAttribute|'
    r'removeAttribute|hasAttribute|toggleAttribute|addEventListener|removeEventListener|dispatchEvent|'
    r'createElement(?:NS)?|classList\.\w+|publish|subscribe|unsubscribe|emit|on|off|once|fetch|getItem|'
    r'setItem|removeItem|startsWith|endsWith|includes|indexOf|lastIndexOf|split|join|replace(?:All)?|'
    r'padStart|padEnd|postMessage|setProperty|getPropertyValue|removeProperty|CustomEvent|Event|URL|'
    r'get|set|has|delete|matchMedia|Symbol|Intl\.\w+|getContext|send|track|stateKey|key|keyOf|'
    r'storageKey|lsKey|read|write|readState|writeState|append(?:Event)?|events|stream|topic|verb|'
    r'mark|measure|assert|define|registerModule|getManifest|import|Worker|'
    r'setTimeout|requestAnimationFrame|Audio|Image|Blob|File|toLocale\w*String|DateTimeFormat|'
    r'NumberFormat|load|loadScript|css|style|setStyle|attr|dataset|data|cls|cx|class\w*|icon|svg|'
    r'path|route|go|navigate|open|sound|play|playSound|tone|cue|beep|telemetry|count|bump|emitEvent|'
    r'reportError|crumb|flag|feature)\s*\(\s*(?:[^()\n]*,\s*)?$'
    r'|(?:\b(?:type|kind|key|id|topic|mode|value|className|cls|class|klass|icon|emoji|glyph|src|href|url|'
    r'path|role|event|evt|action|source|tag|tagName|nodeName|cursor|display|position|color|colour|bg|'
    r'background|font|fontFamily|fontSize|fontWeight|width|height|transform|transition|animation|opacity|'
    r'zIndex|inputMode|autocomplete|method|slug|stream|channel|field|prop|accept|rel|target|lang|dir|unit|'
    r'format|level|shape|variant|size|align|state|scope|ext|mime|contentType|code|sel|selector|stateKey|'
    r'storeKey|storageKey|keyName|attr|attribute|dataKey|kindOf|cat|category|module|moduleType|'
    r'dependsOn|easing|fill|stroke|border|margin|padding|gap|grid|flex|area|layout|preset|theme|voice|'
    r'lang|locale|engine|model|endpoint|host|origin|base|prefix|suffix|sep|separator|delim|ns|namespace|'
    r'verb|verbs|input|output|bus|slot|pane|panel|panelType|which|side|edge|anchor|placement)\s*[:=]\s*'
    r'|\.(?:className|id|type|src|href|rel|name|htmlFor|dataset\.\w+|style\.[\w-]+|style|cssText|key|role|'
    r'lang|dir|accept|value|kind|mode|state|fill|stroke)\s*=\s*)$')
CONSOLE = re.compile(r'console\.\w+\([^;]*$|\bnew\s+(?:Error|TypeError|RangeError)\([^;]*$|\bthrow\s+[^;]*$|httpError\([^;]*$')
CSSISH = re.compile(r'(?:-?[a-z]+(?:-[a-z]+)*\s*:\s*[^;:]{1,60};\s*){2,}|^\s*-?[a-z]+(?:-[a-z]+)*\s*:\s*[^;:]+;\s*$|\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|vmin|vmax|ms|deg|fr)\b|'
                    r'var\(--|rgba?\(|hsla?\(|(?<![\w&])#[0-9a-fA-F]{3,8}\b|calc\(|cubic-bezier|!important|'
                    r'\}(?:px|em|rem|%|ms|deg|vh|vw|s)\b|translate[XYZ3d]*\(|scale\(|rotate\(|linear-gradient')
URLISH = re.compile(r'^(?:https?:|data:|blob:|mailto:|tel:|/|\./|\.\./|#)|\.(?:js|mjs|css|html?|png|jpe?g|gif|svg|json|'
                    r'mp3|mp4|wav|webm|ogg|woff2?|ttf|ico|webp|txt|md|py)(?:[?#].*)?$')
CODEY = re.compile(r'=>|&&|\|\||===|!==|\bfunction\b\s*\(|\breturn\b\s|\bconst\b\s|\blet\b\s|\bvar\b\s|'
                   r'\bdocument\.|\bwindow\.|\bthis\.|\(\)\s*[;{]|\[data-[\w-]+|^\s*[.#][\w-]+[\s.#\[>:{,]|'
                   r'^[a-z]+\[[\w-]+|:(?:hover|focus|not|nth|is|where|root)\b|'
                   r'^\((?:prefers-|min-|max-|orientation|hover|pointer|display-mode)')
KEYNAMES = {'Enter', 'Escape', 'Esc', 'Tab', 'Backspace', 'Delete', 'Shift', 'Control', 'Alt', 'Meta', 'Space',
            'Spacebar', 'Insert', 'Dead', 'Unidentified', 'PageUp', 'PageDown', 'GET', 'POST', 'PUT', 'PATCH',
            'DELETE', 'HEAD', 'OPTIONS', 'Authorization', 'Accept', 'Range', 'Infinity', 'NaN', 'Object',
            'Array', 'Date', 'Promise', 'Error', 'AbortError', 'NotAllowedError', 'NotFoundError',
            'NotReadableError', 'OverconstrainedError', 'SecurityError', 'TimeoutError', 'TypeError',
            'Function', 'Symbol', 'Map', 'Set', 'String', 'Number', 'Boolean', 'Arial', 'Helvetica',
            'Georgia', 'Roboto', 'Inter', 'Courier', 'Verdana', 'Lexend', 'Atkinson', 'Nunito', 'Fredoka',
            'Inconsolata', 'Menlo', 'Consolas', 'Monaco', 'Segoe', 'Tahoma', 'Impact', 'Comic', 'Bearer',
            'Basic', 'UTF', 'JSON', 'HTML', 'URL', 'POINTER', 'MOUSE', 'TOUCH', 'Gamepad', 'Unknown',
            'Default', 'None', 'Null', 'Undefined', 'True', 'False', 'Live'}
WORDY_TOKEN = re.compile(r'^[(\[“"‘\'¿¡*]*(?:[A-Za-z0-9\u00c0-\uffff][\w’\'\u00c0-\uffff.,/&+-]*)?[)\]”"’\'.,!?:;…%*]*$')
PUNCT_TOKENS = {'—', '–', '-', '&', '/', '·', '•', '+', '×', '→', '←', '…', '|', '·', '=', '>', '<', '↑', '↓',
                '⚙', '⛶', '✕', '★', '☆', '(', ')', '?', '!', ':', '"', '“', '”'}


def letters(t):
    return len(re.findall(r'[A-Za-z\u00c0-\u024f]', re.sub(r'\{[^{}]*\}|</?[a-z]+>', '', t)))


def looks_like_words(t):
    """'normal' / 'weak' / None for a plain (not markup) literal of unknown context."""
    # A placeholder is ONE token whatever its expression holds (`{p.name || 'a speaker'}`).
    t = re.sub(r'\{[^{}]*\}', '{p}', t)
    bare = t.replace('{p}', ' ').strip()
    if letters(t) < 2:
        return None
    if URLISH.search(bare) and ' ' not in bare:
        return None
    if CSSISH.search(t) or CODEY.search(bare):
        return None
    toks = t.split()
    if len(toks) == 1:
        w = bare
        if w in KEYNAMES:
            return None
        if re.match(r'^[A-Z][a-z’\'\u00c0-\u024f]+(?:-[a-z]+)*[.!?…:]?$', w):
            return 'normal'
        if re.match(r'^[A-Z][a-z]+(?: ?[A-Z][a-z]+)+$', w):   # CamelCase: code
            return None
        if re.match(r'^[A-Z]{2,4}$', w):
            return 'weak'
        if t.startswith('{') and re.match(r'^\{[^{}]*\}\s*[a-z]+[.!?…]?$', t):
            return 'normal'
        return None
    good = sum(1 for k in toks if k in PUNCT_TOKENS or re.fullmatch(r'\{[^{}]*\}[\w.,!?:;…’\']*', k) or WORDY_TOKEN.match(k))
    if good / len(toks) < 0.8:
        return None
    words = [k for k in toks if not k.startswith('{')]
    if words and all(k == k.lower() for k in words):
        if any(re.search(r'[a-z][-_][a-z]', k) for k in words) and not re.search(r'[.,!?:;…]', bare):
            return None   # a class list or an event name list
        if len(words) <= 2 and not re.search(r'[.,!?:;…]', bare):
            return 'weak'
    if all(re.fullmatch(r'[\w-]+', k) and re.search(r'\d', k) for k in words):
        return None
    return 'normal'


AI_PROMPT = re.compile(r'^(?:You are |You will |Return (?:only|JSON|a JSON)|Reply (?:with|only)|Respond (?:with|only)|'
                       r'Write up to|For each question|Output |Format:|Rules:)')


def classify_js(src, s, e, quote, disp):
    """'strong' / 'normal' / 'weak' / None. An instruction written FOR an AI model is not shown to a
    visitor: kept (somebody may want to reword it) but marked ?."""
    c = _classify_js(src, s, e, quote, disp)
    if c and AI_PROMPT.match(disp) and len(disp) > 50:
        return 'weak'
    return c


def _classify_js(src, s, e, quote, disp):
    if letters(disp) < 2:
        return None
    lo = max(0, s - 1 - 220)
    ctx = src[lo:s - 1]
    ctx1 = ' '.join(ctx.split())
    after = src[e + 1:e + 24]
    if CONSOLE.search(ctx.split(';')[-1]):
        if re.match(r'^\s*console\.', ctx.split(';')[-1].strip()) or 'console.' in ctx.split(';')[-1]:
            return None
        # A developer's message (`attachKeyboard: an input bus is required`, `GET /api/x -> 500`)
        # is not site copy; a sentence a catch block might show is kept, marked ?.
        if (re.match(r'^[\w.$]+(?:\(\))?:\s', disp) or '->' in disp or re.match(r'^(?:GET|POST|PUT|PATCH|DELETE)\b', disp)
                or re.search(r'\b(?:is required|must be|expected|not a function|undefined)\b', disp)):
            return None
        return 'weak' if looks_like_words(disp) or ' ' in disp.strip() else None
    tail = ctx1[-120:]
    if re.match(r'\s*:(?!:)', after) and re.search(r'[{,]\s*$', tail):
        return None   # an object key
    if re.match(r'\s*(?:in\b|===?|!==?)', after):
        return None
    if KEEP_TAIL.search(tail):
        bare = re.sub(r'\{[^{}]*\}', '', disp).strip()
        if ' ' not in bare and re.match(r'^[a-z0-9]+(?:[-_:.][\w-]+)+$', bare):
            return None
        if CSSISH.search(disp) or (URLISH.search(bare) and ' ' not in bare):
            return None
        return 'strong'
    if DROP_TAIL.search(tail):
        return None
    return looks_like_words(disp)


# --------------------------------------------------------------------------------------------
# Items
# --------------------------------------------------------------------------------------------
class Item:
    __slots__ = ('file', 'text', 'lines', 'conf', 'how', 'spans', 'seen', 'id', 'section', 'metas')

    def __init__(self, file, text, line, conf, how, span, section, meta=None):
        self.file, self.text, self.lines, self.conf, self.how = file, text, [line], conf, how
        self.spans, self.seen, self.section = [span], set(), section
        # `metas` runs beside `spans`: what --apply needs to write each place back (its quote, its
        # template parts, its inline tags). Not part of the id and not in the export.
        self.metas = [meta]
        self.id = item_id(file, text)


def item_id(file, text):
    return 't' + hashlib.sha1(f'{file}\0{text}'.encode('utf-8')).hexdigest()[:8]


CONF_RANK = {'strong': 3, 'normal': 2, 'weak': 1}


class Collector:
    def __init__(self):
        self.by_key = {}
        self.order = []
        self.skipped_content = {}

    def add(self, file, text, line, conf, how, span, section=None, meta=None):
        k = (file, text)
        it = self.by_key.get(k)
        if it:
            if line not in it.lines:
                it.lines.append(line)
            it.spans.append(span)
            it.metas.append(meta)
            if CONF_RANK[conf] > CONF_RANK[it.conf]:
                it.conf, it.how = conf, how
            return
        it = Item(file, text, line, conf, how, span, section, meta)
        self.by_key[k] = it
        self.order.append(it)


def line_index(src):
    nl = [i for i, c in enumerate(src) if c == '\n']
    return lambda off: bisect.bisect_right(nl, off - 1) + 1


DECL = re.compile(r'^ {0,2}(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|'
                  r'(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))', re.M)


def decl_index(src):
    marks = [(m.start(), m.group(1) or m.group(2)) for m in DECL.finditer(src)]
    starts = [a for a, _ in marks]

    def at(off):
        k = bisect.bisect_right(starts, off) - 1
        return marks[k][1] if k >= 0 else '(top of file)'
    return at


PLUS_ONLY = re.compile(r'^(?:\s|//[^\n]*\n|/\*.*?\*/)*\+(?:\s|//[^\n]*\n|/\*.*?\*/)*$', re.S)


def _masked(src, s, e, exprs):
    m = list(src[s:e])
    for es, ee in exprs:
        for k in range(max(es, s) - s, min(ee, e) - s):
            m[k] = MASK
    return ''.join(m)


def concat_groups(src, lits):
    """Literals joined only by `+` ('One sentence ' + 'over two lines') become ONE row: a rewrite
    has to see the whole sentence. Markup is never joined (its pieces are split as markup)."""
    groups = []
    for lit in lits:
        s, e, q, exprs = lit
        if groups:
            ps, pe, pq, pex = groups[-1][-1]
            between = src[pe + 1:s - 1]
            if (PLUS_ONLY.match(between) and not LOOKS_HTML.search(_masked(src, s, e, exprs))
                    and not LOOKS_HTML.search(_masked(src, ps, pe, pex))
                    and not any(es <= s < ee for (es, ee) in pex)):
                groups[-1].append(lit)
                continue
        groups.append([lit])
    return groups


def scan_js_into(col, rel, src, lo=0, hi=None, decl=None, keep_all=False):
    """`keep_all` (used by --apply to check its own work): every literal with letters is a row, shown
    or not - the classifier's guesses are skipped, so nothing written back can hide from the check."""
    lineof = line_index(src)
    lits = sorted(js_literals(src, lo, hi))
    for grp in concat_groups(src, lits):
        if len(grp) > 1:
            s, e = grp[0][0], grp[-1][1]
            d = ' '.join(''.join(display_raw(src, a, b, ex, js=True, markup=False) for a, b, _, ex in grp).split())
            conf = classify_js(src, s, grp[0][1], grp[0][2], d) or ('weak' if keep_all and letters(d) else None)
            if conf:
                col.add(rel, d, lineof(s), conf, 'joined string', [(a, b) for a, b, _, _ in grp],
                        decl(s) if decl else None, {'kind': 'joined', 'pieces': list(grp)})
            continue
        s, e, q, exprs = grp[0]
        if e <= s:
            continue
        raw = src[s:e]
        masked = list(raw)
        for es, ee in exprs:
            for k in range(max(es, s) - s, min(ee, e) - s):
                masked[k] = MASK
        masked = ''.join(masked)
        sect = decl(s) if decl else None
        if LOOKS_HTML.search(masked):
            for fs, fe, how, tags in markup_fragments(masked, s):
                d = markup_display(src, fs, fe, tags, exprs, js=True)
                if not keep_all:
                    if letters(d) < 2 or CSSISH.search(d) and how == 'text' and '{' in d and ' ' not in d:
                        continue
                    if how == 'text' and (CODEY.search(re.sub(r'\{[^{}]*\}', '', d)) or re.search(r'[{};]\s*$', re.sub(r'\{[^{}]*\}', '', d))):
                        continue
                col.add(rel, d, lineof(fs), 'strong', 'markup ' + how, (fs, fe), sect,
                        {'kind': 'markup', 'how': how, 'tags': tags, 'exprs': exprs, 'lit': (s, e, q)})
            continue
        d = display(src, s, e, exprs, js=True, markup=False)
        conf = classify_js(src, s, e, q, d) or ('weak' if keep_all and letters(d) else None)
        if conf:
            col.add(rel, d, lineof(s), conf, 'string', (s, e), sect, {'kind': 'js', 'q': q, 'exprs': exprs})


def scan_html_into(col, rel, src, keep_all=False):
    lineof = line_index(src)
    for m in re.finditer(r'<script\b([^>]*)>(.*?)</script\s*>', src, re.S | re.I):
        attrs = m.group(1)
        t = re.search(r'type\s*=\s*["\']([^"\']+)', attrs)
        if t and t.group(1).lower() not in ('module', 'text/javascript', 'application/javascript'):
            continue
        scan_js_into(col, rel, src, m.start(2), m.end(2), keep_all=keep_all)
    for fs, fe, how, tags in markup_fragments(src, 0):
        d = markup_display(src, fs, fe, tags, [], js=False)
        if letters(d) < 2 and not keep_all:
            continue
        col.add(rel, d, lineof(fs), 'strong', 'html ' + how, (fs, fe), None, {'kind': 'html', 'how': how, 'tags': tags})


def scan_css_into(col, rel, src, keep_all=False):
    lineof = line_index(src)
    nocom = re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group(0)), src, flags=re.S)
    for m in re.finditer(r'\bcontent\s*:\s*(["\'])((?:\\.|(?!\1).)*)\1', nocom):
        d = ' '.join(m.group(2).split())
        if letters(d) >= 2 and not d.startswith('\\'):
            col.add(rel, d, lineof(m.start(2)), 'normal', 'css content', (m.start(2), m.end(2)), None,
                    {'kind': 'css', 'q': m.group(1)})


SERVER_NAMES = re.compile(r'(NOTES|STORED|TEXT|REFUSAL|MESSAGE|MESSAGES|COPY|HELP|LABELS?|WORDS|SAYS|REASONS?)$')


def scan_py_into(col, rel, src):
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return

    class S:   # one string, an f-string's `{expr}` kept visibly
        def __init__(self, value, lineno, end_lineno):
            self.value, self.lineno, self.end_lineno = value, lineno, end_lineno

    def strings(node):
        if isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant):
                    parts.append(str(v.value))
                else:
                    parts.append('{' + ast.unparse(v.value) + '}')
            yield S(''.join(parts), node.lineno, node.end_lineno)
            return
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield S(node.value, node.lineno, node.end_lineno)
            return
        for child in ast.iter_child_nodes(node):
            yield from strings(child)

    def add(node, conf, how):
        d = ' '.join(node.value.split())
        if letters(d) >= 2 and ' ' in d and not (URLISH.search(d) and ' ' not in d):
            col.add(rel, d, node.lineno, conf, how, (node.lineno, node.end_lineno), None, {'kind': 'py'})

    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names = [t.id for t in targets if isinstance(t, ast.Name)]
            if any(SERVER_NAMES.search(n) for n in names) and node.value is not None:
                for c in strings(node.value):
                    add(c, 'strong', 'server ' + names[0])
        elif isinstance(node, ast.FunctionDef) and node.name == 'describe_storage':
            for stmt in node.body:
                if isinstance(stmt, ast.Expr):
                    continue   # the docstring
                for c in strings(stmt):
                    add(c, 'strong', 'server describe_storage')
        elif isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'HTTPException':
            for kw in node.keywords:
                if kw.arg == 'detail' and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    if len(kw.value.value.split()) >= 3:
                        add(kw.value, 'weak', 'server refusal')


# --------------------------------------------------------------------------------------------
# Grouping
# --------------------------------------------------------------------------------------------
MENU_FILES = {'kiosk.js', 'settings.js', 'settings_fields.js', 'settings_audit.js', 'transport_bar.js',
              'page_links.js', 'page_sections.js', 'page_visit.js', 'edit_mode.js', 'edit_windows.js',
              'bar_toggle.js', 'controls_view.js', 'modules/transport_bar.js', 'modules/settings_menu.js',
              'modules/settings.js', 'modules/edit_options.js', 'modules/options.js', 'restart.js',
              'screen_lock.js', 'player_picker.js', 'shell_verbs.js', 'starting_defaults_panel.js'}
CALL_TALK = {'modules/call.js', 'call.html', 'talk.html', 'talk.js', 'modules/board.js', 'call_page.js',
             'call_notice.js', 'board_editor.js'}


def page_scripts():
    """{js rel (to client): [html rel, ...]} for scripts a page loads directly."""
    owners = {}
    for p in sorted(CLIENT.rglob('*.html')):
        rel = p.relative_to(CLIENT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        src = p.read_text(encoding='utf-8', errors='replace')
        refs = set(re.findall(r'<script[^>]*\bsrc\s*=\s*["\']\.?/?([\w./-]+\.js)', src))
        for m in re.finditer(r'<script\b[^>]*type\s*=\s*["\']module["\'][^>]*>(.*?)</script>', src, re.S | re.I):
            refs |= set(re.findall(r'from\s+["\']\.?/?([\w./-]+\.js)["\']', m.group(1)))
            refs |= set(re.findall(r'import\s+["\']\.?/?([\w./-]+\.js)["\']', m.group(1)))
        base = rel.parent
        for r in refs:
            if r.startswith('http'):
                continue
            js = (base / r).as_posix()
            owners.setdefault(js, []).append(rel.as_posix())
    # A script another script imports is shared (kiosk.js imports input_speech.js), not one page's own.
    for p in client_files({'.js'}):
        src = p.read_text(encoding='utf-8', errors='replace')
        base = p.relative_to(CLIENT).parent
        for r in re.findall(r'(?:from|import)\s*\(?\s*[\'"](\.{1,2}/[\w./-]+\.js)[\'"]', src):
            js = os.path.normpath((base / r).as_posix()).replace('\\', '/')
            owners.setdefault(js, []).append('(imported by ' + p.name + ')')
    return owners


def module_titles():
    out = {}
    for p in sorted((CLIENT / 'modules').glob('*.js')):
        src = p.read_text(encoding='utf-8', errors='replace')
        names = []
        for m in re.finditer(r'registerModule\(\s*([A-Za-z_$][\w$]*)?', src):
            start = m.end()
            if m.group(1):   # registerModule(MANIFEST, ...): read the object it names
                d = re.search(r'\b(?:const|let|var)\s+' + re.escape(m.group(1)) + r'\s*=\s*', src)
                start = d.end() if d else start
            chunk = src[start:start + 6000]
            types = list(re.finditer(r'\btype\s*:\s*(?:[\'"]([\w-]+)[\'"]|([A-Z_][A-Z0-9_]*)\b)', chunk))

            def tval(x):
                if x.group(1):
                    return x.group(1)
                c = re.search(r'\bconst\s+' + x.group(2) + r'\s*=\s*[\'"]([\w-]+)[\'"]', src)
                return c.group(1) if c else x.group(2)
            # The manifest's own `type:` opens the object; nested `type:` keys come later.
            t = next((x for x in types if x.start() < 200), None) \
                or next((x for x in types if tval(x) == p.stem), types[0] if types else None)
            if t:
                lab = re.search(r'\b(?:label|name|title)\s*:\s*[\'"]([^\'"]+)[\'"]', chunk[t.end():t.end() + 1500])
                names.append(f"{tval(t)}" + (f" (\"{lab.group(1)}\")" if lab else ''))
        out['modules/' + p.name] = ', '.join(dict.fromkeys(names))
    return out


def banned_lists():
    def grab(path, name):
        try:
            src = (CLIENT / path).read_text(encoding='utf-8')
            m = re.search(name + r'\s*=\s*Object\.freeze\(\[([^\]]*)\]', src)
            return re.findall(r'[\'"]([\w-]+)[\'"]', m.group(1)) if m else []
        except OSError:
            return []
    return {'people_page.js BANNED_WORDS': grab('people_page.js', 'BANNED_WORDS'),
            'page_sections.js PAGE_EXTRA_BANNED': grab('page_sections.js', 'PAGE_EXTRA_BANNED'),
            'claim.js CLAIM_BANNED': grab('claim.js', 'CLAIM_BANNED')}


# --------------------------------------------------------------------------------------------
# The scan
# --------------------------------------------------------------------------------------------
def client_files(suffixes):
    for p in sorted(CLIENT.rglob('*')):
        if p.suffix not in suffixes or not p.is_file():
            continue
        if any(part in SKIP_DIRS or part.startswith('.') for part in p.relative_to(CLIENT).parts):
            continue
        yield p


def scan_one(col, rel, src, keep_all=False):
    """One file's rows into `col`. `rel` is relative to web/client, or 'server/<name>.py'."""
    if rel.endswith('.js'):
        scan_js_into(col, rel, src, decl=decl_index(src), keep_all=keep_all)
    elif rel.endswith('.html'):
        scan_html_into(col, rel, src, keep_all=keep_all)
    elif rel.endswith('.css'):
        scan_css_into(col, rel, src, keep_all=keep_all)
    elif rel.endswith('.py'):
        scan_py_into(col, rel, src)


def source_path(rel):
    return WEB / rel if rel.startswith('server/') else CLIENT / rel


def scan():
    col = Collector()
    content_counts = {}
    for p in client_files({'.js', '.html', '.css'}):
        rel = p.relative_to(CLIENT).as_posix()
        src = p.read_text(encoding='utf-8', errors='replace')
        if p.name in CONTENT_FILES:
            content_counts[rel] = (len(js_literals(src)), CONTENT_FILES[p.name])
            continue
        scan_one(col, rel, src)
    for p in sorted(SERVER.glob('*.py')):
        if p.name.startswith('test_') or p.name.startswith('migrate_'):
            continue
        scan_one(col, 'server/' + p.name, p.read_text(encoding='utf-8', errors='replace'))
    packs = {}
    for d in ('packs', 'packs_local', 'packs_review'):
        for p in (CLIENT / d).rglob('*.json') if (CLIENT / d).exists() else []:
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
                qs = data.get('questions') or data.get('items') or data.get('cards') or []
                packs[p.relative_to(CLIENT).as_posix()] = len(qs) if isinstance(qs, list) else 0
            except Exception:
                packs[p.relative_to(CLIENT).as_posix()] = 0
    learn_json = {p.relative_to(CLIENT).as_posix(): p.stat().st_size for p in (CLIENT / 'learn').rglob('*.json')}
    return col, content_counts, packs, learn_json


# --------------------------------------------------------------------------------------------
# Runtime pass
# --------------------------------------------------------------------------------------------
RUNTIME_PAGES_OUT = ['/']   # signed out: the landing
# landing/library/modules.html are the same pages as /, /modules and /home (app.py PAGE_ALIASES).
RUNTIME_SKIP = {'spotify_callback.html', 'landing.html', 'library.html', 'modules.html'}


async def _runtime_async(base, pages_in, user, wait_s):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import run_suite as rs
    import asyncio
    import shutil
    import subprocess
    import tempfile
    import websockets
    if not rs.CHROME:
        raise RuntimeError('no Chrome found (run_suite.py CHROME)')
    profile = tempfile.mkdtemp(prefix='nimrod_suite_export_')
    args = [rs.CHROME, '--headless=new', f'--remote-debugging-port={rs.PORT}', f'--user-data-dir={profile}',
            '--no-first-run', '--no-default-browser-check', '--window-size=1400,900',
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-automation',
            '--autoplay-policy=no-user-gesture-required', 'about:blank']
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    got = {}
    grab = ("(() => { const t = (document.body && document.body.innerText) || '';"
            " const a = [...document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')]"
            ".flatMap(e => ['title','aria-label','placeholder','alt'].map(k => e.getAttribute(k)).filter(Boolean));"
            " return JSON.stringify({t, a, title: document.title}); })()")
    try:
        target = next(t for t in rs.http_json('/json/list') if t['type'] == 'page')
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=64 * 1024 * 1024) as ws:
            cdp = rs.CDP(ws)
            await cdp.send('Page.enable')
            await cdp.send('Runtime.enable')
            await cdp.send('Network.enable')
            for signed, path in [(False, p) for p in RUNTIME_PAGES_OUT] + [(True, p) for p in pages_in]:
                await cdp.send('Network.setExtraHTTPHeaders', headers=({'X-Dev-User': user} if signed else {}))
                press = path.endswith('#escape')
                path = path.replace('#escape', '')
                url = base + path + (('&' if '?' in path else '?') + 'user=' + user if signed else '')
                try:
                    await cdp.send('Page.navigate', url=url)
                    await asyncio.sleep(wait_s)
                    if press:   # the plain bar: Escape opens it (kiosk.js "THE PLAIN BAR")
                        for t in ('keyDown', 'keyUp'):
                            await cdp.send('Input.dispatchKeyEvent', type=t, key='Escape', code='Escape',
                                           windowsVirtualKeyCode=27)
                        await asyncio.sleep(1.5)
                    v = await cdp.js(grab, timeout=20)
                    if isinstance(v, str):
                        d = json.loads(v)
                        key = re.sub(r'profile=[\w-]+', 'profile=…', path) + ('' if signed else '  (signed out)') \
                            + ('  (after Escape)' if press else '')
                        got[key] = d
                        print(f'  runtime {key:<34} {len(d["t"])} chars', file=sys.stderr)
                except Exception as ex:   # one page failing must not lose the rest
                    print(f'  runtime {path}: {ex}', file=sys.stderr)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
    return got


def runtime_pass(port, wait_s):
    import asyncio
    import shutil
    import subprocess
    import tempfile
    import time
    import urllib.request
    scratch = tempfile.mkdtemp(prefix='nimrod_export_text_')
    env = dict(os.environ, NIMROD_DB=os.path.join(scratch, 'scratch.db'), NIMROD_ENV='dev')
    env.pop('DATABASE_URL', None)
    log = open(os.path.join(scratch, 'server.log'), 'wb')
    srv = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app:app', '--port', str(port)],
                           cwd=str(SERVER), env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f'http://127.0.0.1:{port}'
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + '/api/version', timeout=1).read()
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError('the scratch server never answered')
        user = 'export-text-' + os.urandom(3).hex()
        # One screen for the test user, so the screen page has something to show.
        pid = None
        try:
            req = urllib.request.Request(base + '/api/profiles', method='POST',
                                         data=json.dumps({'name': 'Test screen'}).encode(),
                                         headers={'X-Dev-User': user, 'Content-Type': 'application/json'})
            r = json.loads(urllib.request.urlopen(req, timeout=10).read())
            pid = r.get('id') or r.get('profile_id') or r.get('pid')
        except Exception as ex:
            print(f'  runtime: could not make a test screen ({ex})', file=sys.stderr)
        pages = ['/home', '/modules']
        for p in sorted(CLIENT.glob('*.html')):
            if p.name not in RUNTIME_SKIP:
                pages.append('/' + p.name)
        if pid:
            pages += [f'/kiosk.html?profile={pid}', f'/kiosk.html?profile={pid}#escape']
        for p in sorted((CLIENT / 'learn').rglob('*.html')):
            pages.append('/' + p.relative_to(CLIENT).as_posix())
        return asyncio.run(_runtime_async(base, pages, user, wait_s))
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except Exception:
            srv.kill()
        log.close()
        shutil.rmtree(scratch, ignore_errors=True)


def norm(s):
    return ' '.join(s.replace('\u00a0', ' ').split()).strip()


def match_runtime(col, got):
    """Mark items SEEN; return {page: [runtime-only lines]}."""
    exact = {}
    patterns = []
    for it in col.order:
        t = norm(re.sub(r'</?[a-z]+>', ' ', it.text))
        exact.setdefault(t.lower(), []).append(it)
        if '{' in t:
            chunks = [c for c in re.split(r'\{[^{}]*\}', t) if c.strip()]
            if chunks:
                rx = re.compile('^' + r'.*?'.join(re.escape(c) for c in re.split(r'\{[^{}]*\}', t)) + '$', re.I | re.S)
                patterns.append((max(chunks, key=len).lower(), rx, it))
    long_items = sorted({k for k in exact if len(k) >= 4 and '{' not in k}, key=len, reverse=True)
    only = {}
    for page, d in got.items():
        lines = [norm(x) for x in d['t'].split('\n')] + [norm(x) for x in d['a']] + [norm(d.get('title') or '')]
        seen_here = set()
        for ln in lines:
            if letters(ln) < 2 or ln.lower() in seen_here:
                continue
            seen_here.add(ln.lower())
            low = ln.lower()
            hit = exact.get(low)
            if hit:
                for it in hit:
                    it.seen.add(page)
                continue
            matched = False
            for chunk, rx, it in patterns:
                if chunk in low and rx.match(ln):
                    it.seen.add(page)
                    matched = True
            if matched:
                continue
            # covered by several exported pieces (a row built from parts)?
            rest = low
            for t in long_items:
                if t in rest:
                    for it in exact.get(t, []):
                        it.seen.add(page)
                    rest = rest.replace(t, ' ')
                    if letters(rest) < 3:
                        break
            if letters(rest) >= 3:
                only.setdefault(page, []).append(ln)
    return only


# --------------------------------------------------------------------------------------------
# --apply: put rewritten lines back where they came from.
# --------------------------------------------------------------------------------------------
class Refuse(Exception):
    """A row that would need a guess to write back. It is reported, never applied."""


ROW_LINE = re.compile(r'^(t[0-9a-f]{8})\s*=>\s?(.*)$')
INLINE_TOKEN = re.compile(r'</?([a-z]+)>')
BRACE_TOKEN = re.compile(r'\{[^{}]*\}')


def read_changes(path):
    """`<id> => new text` lines; anything else (comments, blanks) is ignored. Returns ({id: text}, [dup ids])."""
    out, dups = {}, []
    for ln in Path(path).read_text(encoding='utf-8-sig').splitlines():
        m = ROW_LINE.match(ln)
        if m:
            if m.group(1) in out:
                dups.append(m.group(1))
            out[m.group(1)] = m.group(2).strip()
    return out, dups


def read_ids(path):
    """A skip file: every line that starts with an id - a bare list, a changes file, or the names-undo file
    (whose rows are skipped whatever they say: an undo row is not text to apply)."""
    ids = set()
    for ln in Path(path).read_text(encoding='utf-8-sig').splitlines():
        m = re.match(r'^\s*(t[0-9a-f]{8})\b', ln)
        if m:
            ids.add(m.group(1))
    return ids


def norm_text(s):
    return ' '.join(s.split())


def new_tokens(new, old, phs, tags):
    """Split the new words into [('t', text) | ('x', k) | ('g', k)]. `phs` are the placeholder displays
    (`{name}`) and `tags` the inline tag names (`<a>`, `</a>`, `<br>`), each in source order; k indexes them.

    A placeholder is matched by its exact `{name}`, else by order (the rewrite renamed it); the n-th <a> in
    the new words is the n-th <a> in the code. Anything that would need a guess raises Refuse."""
    used_x, used_g = [False] * len(phs), [False] * len(tags)
    out, buf = [], []
    by_len = sorted(set(phs), key=len, reverse=True)

    def flush():
        if buf:
            out.append(('t', ''.join(buf)))
            buf.clear()
    i = 0
    while i < len(new):
        c = new[i]
        if c == '{' and phs:
            hit = None
            for d in by_len:
                if new.startswith(d, i):
                    k = next((k for k, p in enumerate(phs) if p == d and not used_x[k]), None)
                    if k is not None:
                        hit = (k, d)
                        break
            if hit:
                flush()
                out.append(('x', hit[0]))
                used_x[hit[0]] = True
                i += len(hit[1])
                continue
        elif c == '<':
            m = INLINE_TOKEN.match(new, i)
            if m and m.group(1) in INLINE_TAGS:
                k = next((k for k, t in enumerate(tags) if t == m.group(0) and not used_g[k]), None)
                if k is None:
                    raise Refuse(f'the new words have {m.group(0)}, and the code has no such tag (left) on that line')
                flush()
                out.append(('g', k))
                used_g[k] = True
                i = m.end()
                continue
        buf.append(c)
        i += 1
    flush()
    left = [k for k in range(len(phs)) if not used_x[k]]
    if left:   # by order: the rewrite renamed a placeholder
        loose = sum(1 for kind, v in out if kind == 't' for m in BRACE_TOKEN.finditer(v) if m.group(0) not in old)
        if loose != len(left):
            raise Refuse('placeholder ' + ', '.join(phs[k] for k in left) + ' is not in the new words')
        it = iter(left)
        out2 = []
        for kind, v in out:
            if kind != 't':
                out2.append((kind, v))
                continue
            pos = 0
            for m in BRACE_TOKEN.finditer(v):
                if m.group(0) in old:
                    continue
                if m.start() > pos:
                    out2.append(('t', v[pos:m.start()]))
                out2.append(('x', next(it)))
                pos = m.end()
            if pos < len(v):
                out2.append(('t', v[pos:]))
        out = out2
    for kind, v in out:
        if kind == 't':
            for m in BRACE_TOKEN.finditer(v):
                if m.group(0) not in old:
                    raise Refuse(f'the new words have {m.group(0)}, which the code would show as written')
    missing = [tags[k] for k in range(len(tags)) if not used_g[k]]
    if missing:
        raise Refuse('the new words leave out the tag(s) ' + ' '.join(missing) + ' (the link or the markup would be lost)')
    # Tags must nest no worse than they did: a run can start inside an <a> opened before it (then its
    # `</a>` comes first in the code too), but the rewrite must not close a tag it has not opened.
    def lowest(seq):
        depth, low = {}, {}
        for t in seq:
            if t in VOID_INLINE:
                continue
            nm = t.strip('</>')
            depth[nm] = depth.get(nm, 0) + (-1 if t.startswith('</') else 1)
            low[nm] = min(low.get(nm, 0), depth[nm])
        return low
    was = lowest(tags)
    for nm, low in lowest([tags[v] for k, v in out if k == 'g']).items():
        if low < was.get(nm, 0):
            raise Refuse(f'the new words close </{nm}> before opening it')
    return out


def expected_display(toks, phs, tags):
    return norm_text(''.join(v if k == 't' else (phs[v] if k == 'x' else tags[v]) for k, v in toks))


def esc_js(t, q):
    """Text -> the inside of a JS literal quoted with q. A backslash already followed by n/t/r/... is the
    export's own `\\n` (kept as an escape); any other backslash is a real one."""
    t = re.sub(r'\\(?![ntrbfv0])', lambda m: '\\\\', t)
    if q == '`':
        return t.replace('`', '\\`').replace('${', '\\${')
    return t.replace(q, '\\' + q)


def esc_markup(t, attrq=None):
    """Text -> markup. Only what would be read as markup is escaped: `&` before a name or `#`, `<` before
    a tag, and the attribute's own quote."""
    t = re.sub(r'&(?=[#A-Za-z0-9])', '&amp;', t)
    t = re.sub(r'<(?=[A-Za-z/!?])', '&lt;', t)
    if attrq:
        t = t.replace(attrq, '&quot;' if attrq == '"' else '&#39;')
    return t


def split_like(text, weights):
    """Cut `text` into len(weights) pieces at spaces, near the old pieces' proportions."""
    total = sum(weights) or 1
    cuts, acc = [0], 0
    spaces = [m.end() for m in re.finditer(' ', text)]
    for w in weights[:-1]:
        acc += w
        target = round(len(text) * acc / total)
        cand = [p for p in spaces if p > cuts[-1]]
        cuts.append(min(cand, key=lambda p: abs(p - target)) if cand else len(text))
    cuts.append(len(text))
    return [text[cuts[k]:cuts[k + 1]] for k in range(len(weights))]


def _edges(raw):
    return raw[:len(raw) - len(raw.lstrip())], raw[len(raw.rstrip()):]


def _in_pre(src, at):
    """Inside <pre> or <textarea>, where line breaks show."""
    for t in ('pre', 'textarea'):
        o = src.lower().rfind('<' + t, 0, at)
        if o >= 0 and src.lower().rfind('</' + t, o, at) < 0:
            return True
    return False


def wrap_like(chunks, src, fs, fe):
    """Markup text that sat over several source lines goes back over several lines (HTML folds the
    breaks into spaces): wrapped at spaces in the text - never inside a tag or a `${...}` - at the
    width and the indent the old lines had."""
    old = src[fs:fe]
    nl = '\r\n' if '\r\n' in old else '\n'
    first = old.index('\n')
    indent = re.match(r'[ \t]*', old[first + 1:]).group(0)
    line_start = src.rfind('\n', 0, fs) + 1
    line_end = src.find('\n', fe)
    region = src[line_start:len(src) if line_end < 0 else line_end].replace('\r', '')
    width = max([100] + [len(x) for x in region.split('\n')])
    units, cur, gap, unit_gap = [], '', False, False   # units: (a space before it?, text)
    for atomic, v in chunks:
        for piece in ([v] if atomic else list(v)):
            if not atomic and piece in ' \t':
                if cur:
                    units.append((unit_gap, cur))
                    cur = ''
                gap = True
                continue
            if not cur:
                unit_gap, gap = gap, False
            cur += piece
    if cur:
        units.append((unit_gap, cur))
    return _greedy(units, fs - line_start, indent, width, nl)


def _greedy(units, col, indent, width, nl):
    out = []
    first = True
    for gap, u in units:
        if first:
            out.append(u)
            col += len(u)
            first = False
            continue
        if gap and col + 1 + len(u) > width:
            out.append(nl + indent + u)
            col = len(indent) + len(u)
        else:
            out.append((' ' if gap else '') + u)
            col += (1 if gap else 0) + len(u)
    return ''.join(out)


def encode_span(src, span, meta, new, old):
    """[(start, end, replacement)] for one place a row sits, plus the display the new source will have."""
    kind = meta['kind']
    if kind == 'js':
        s, e = span
        q, exprs = meta['q'], [x for x in meta['exprs'] if s <= x[0] and x[1] <= e]
        phs = [placeholder(src[a + 2:b - 1]) for a, b in exprs]
        toks = new_tokens(new, old, phs, [])
        lead, trail = _edges(src[s:e])
        body = ''.join(esc_js(v, q) if k == 't' else src[exprs[v][0]:exprs[v][1]] for k, v in toks)
        return [(s, e, lead + body + trail)], expected_display(toks, phs, [])
    if kind == 'joined':
        # 'One sentence ' + `over ${n} lines`: the new words are cut back into the same pieces at spaces.
        # A placeholder must land in the template piece its `${expr}` came from, so the text between
        # two placeholders is shared only among the pieces between their owners.
        pieces = meta['pieces']
        exprs, owner = [], []
        for n, (a, b, _, ex) in enumerate(pieces):
            for x in ex:
                if a <= x[0] and x[1] <= b:
                    exprs.append(x)
                    owner.append(n)
        phs = [placeholder(src[a + 2:b - 1]) for a, b in exprs]
        toks = new_tokens(new, old, phs, [])
        weights = [len(norm_text(display_raw(src, a, b, ex, True, False))) or 1 for a, b, _, ex in pieces]
        content = [[] for _ in pieces]
        segs, cur = [], []
        for k, v in toks:
            if k == 'x':
                segs.append((''.join(cur), v))
                cur = []
            else:
                cur.append(v)
        segs.append((''.join(cur), None))
        lo = 0
        used = [0] * len(pieces)   # how much of each piece's old length is already filled
        for text, x in segs:
            hi = owner[x] if x is not None else len(pieces) - 1
            if hi < lo:
                raise Refuse('the placeholders are in a different order than the code can hold')
            w = weights[lo:hi + 1]
            w[0] = max(1, w[0] - used[lo])
            for n, part in zip(range(lo, hi + 1), split_like(text, w)):
                if part:
                    content[n].append(('t', part))
                    used[n] += len(part)
            if x is not None:
                content[hi].append(('x', x))
                used[hi] += len(phs[x])
            lo = hi
        lead, _ = _edges(src[pieces[0][0]:pieces[0][1]])
        _, trail = _edges(src[pieces[-1][0]:pieces[-1][1]])
        content[0].insert(0, ('t', lead))
        content[-1].append(('t', trail))
        edits = []
        for (a, b, q, _), parts in zip(pieces, content):
            edits.append((a, b, ''.join(esc_js(v, q) if k == 't' else src[exprs[v][0]:exprs[v][1]] for k, v in parts)))
        return edits, expected_display(toks, phs, [])
    if kind in ('markup', 'html'):
        fs, fe = span
        tags = [t for t in meta['tags'] if fs <= t[0] and t[1] <= fe]
        if any(t[2] == '' for t in tags):
            raise Refuse('the line has a comment or a script inside it; put it back by hand')
        exprs = [x for x in meta.get('exprs', []) if fs <= x[0] and x[1] <= fe
                 and not any(t[0] <= x[0] < t[1] for t in tags)]
        phs = [placeholder(src[a + 2:b - 1]) for a, b in exprs]
        names = [t[2] for t in tags]
        toks = new_tokens(new, old, phs, names)
        attrq = None
        if meta['how'].startswith('attr'):
            j = fs - 1
            while j > 0 and src[j] in ' \t\r\n':
                j -= 1
            attrq = src[j] if src[j] in '"\'' else None
        q = meta['lit'][2] if kind == 'markup' else None
        out = []
        for k, v in toks:
            if k == 't':
                t = esc_markup(v, attrq)
                out.append((False, esc_js(t, q) if q else t))
            elif k == 'x':
                out.append((True, src[exprs[v][0]:exprs[v][1]]))
            else:
                out.append((True, src[tags[v][0]:tags[v][1]]))
        old_src = src[fs:fe]
        if '\n' in old_src and q in (None, '`') and not attrq and not _in_pre(src, fs):
            text = wrap_like(out, src, fs, fe)
        else:
            text = ''.join(v for _, v in out)
        return [(fs, fe, text)], expected_display(toks, phs, names)
    if kind == 'css':
        s, e = span
        toks = new_tokens(new, old, [], [])
        lead, trail = _edges(src[s:e])
        text = ''.join(v for _, v in toks)
        if meta['q'] in text or '\\' in text:
            raise Refuse('CSS content with its own quote or a backslash in the new words; put it back by hand')
        return [(s, e, lead + text + trail)], norm_text(text)
    raise Refuse(f'no writer for a {kind} row')


def _py_offsets(src):
    starts = [0]
    for m in re.finditer('\n', src):
        starts.append(m.end())

    def at(line, col_bytes):
        ls = starts[line - 1]
        le = starts[line] if line < len(starts) else len(src)
        return ls + len(src[ls:le].encode('utf-8')[:col_bytes].decode('utf-8', errors='ignore'))
    return at


def py_strings(src):
    """Every str constant / f-string in a Python file, normalized - what the check compares."""
    out = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.add(norm_text(node.value))
        elif isinstance(node, ast.JoinedStr):
            out.add(norm_text(''.join(str(v.value) if isinstance(v, ast.Constant) else '{' + ast.unparse(v.value) + '}'
                                      for v in node.values)))
    return out


def encode_py(src, item, new):
    """Python: by exact string, as designed - the str constant(s) on the row's lines whose words are the
    row's. Implicitly joined pieces are cut at spaces like a JS `+` join; f-strings, raw, bytes and
    triple-quoted strings are refused (put back by hand)."""
    import io
    import tokenize
    at = _py_offsets(src)
    lines = set()
    for a, b in item.spans:
        lines.update(range(a, b + 1))
    edits = []
    found = 0
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.JoinedStr) and node.lineno in lines:
            disp = norm_text(''.join(str(v.value) if isinstance(v, ast.Constant) else '{' + ast.unparse(v.value) + '}'
                                     for v in node.values))
            if disp == item.text:
                raise Refuse('a Python f-string; put it back by hand')
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str) and node.lineno in lines):
            continue
        if norm_text(node.value) != item.text:
            continue
        found += 1
        s, e = at(node.lineno, node.col_offset), at(node.end_lineno, node.end_col_offset)
        seg = src[s:e]
        toks = [t for t in tokenize.generate_tokens(io.StringIO(seg).readline) if t.type == tokenize.STRING]
        if not toks:
            raise Refuse('could not read the Python string')
        seg_lines = seg.split('\n')
        seg_starts = [0]
        for ln in seg_lines[:-1]:
            seg_starts.append(seg_starts[-1] + len(ln) + 1)
        pieces = []
        for t in toks:
            m = re.match(r'^([A-Za-z]*)(\'\'\'|"""|\'|")', t.string)
            pre, q = m.group(1), m.group(2)
            if set(pre.lower()) & set('rbf') or len(q) == 3:
                raise Refuse('a raw, bytes or triple-quoted Python string; put it back by hand')
            ps = s + seg_starts[t.start[0] - 1] + t.start[1]
            pe = s + seg_starts[t.end[0] - 1] + t.end[1]
            pieces.append((ps, pe, pre, q, ast.literal_eval(t.string)))
        toks_new = new_tokens(new, item.text, [], [])
        text = ''.join(v for _, v in toks_new)
        parts = split_like(text, [len(norm_text(p[4])) or 1 for p in pieces])
        parts[0] = _edges(pieces[0][4])[0] + parts[0]
        parts[-1] = parts[-1] + _edges(pieces[-1][4])[1]
        for (ps, pe, pre, q, _), part in zip(pieces, parts):
            body = part.replace('\\', '\\\\').replace(q, '\\' + q).replace('\n', '\\n')
            edits.append((ps, pe, pre + q + body + q))
    if not found:
        raise Refuse('the Python string was not found on its lines')
    return edits, norm_text(new)


def apply_edits(src, edits):
    """Write edits from the end of the file backwards, so earlier offsets stay valid."""
    for s, e, rep in sorted(edits, key=lambda x: x[0], reverse=True):
        src = src[:s] + rep + src[e:]
    return src


def file_texts(rel, src):
    if rel.endswith('.py'):
        return py_strings(src)
    col = Collector()
    scan_one(col, rel, src, keep_all=True)
    return {it.text for it in col.order}


def plan_file(rel, src, items, wanted):
    """Rows of one file -> (new source, {id: new display}, {id: reason refused}, {id: [warnings]}).

    Every row is encoded; the file is re-scanned (every literal, shown or not) and must differ from the
    old scan by exactly the rows applied - old words out, new words in. A row that breaks that (an
    escape gone wrong would move a literal's end) is taken back out and refused."""
    refused, warn, plans = {}, {}, {}
    for it in items:
        new = wanted[it.id]
        try:
            if rel.endswith('.py'):
                edits, disp = encode_py(src, it, new)
            else:
                edits, disp = [], None
                for span, meta in zip(it.spans, it.metas):
                    e, d = encode_span(src, span, meta, new, it.text)
                    if disp is not None and d != disp:
                        raise Refuse('the same words sit in places that would read differently after the rewrite')
                    edits += e
                    disp = d
            plans[it.id] = (edits, disp, it.text)
            # A short word in several places may be a code value in one of them (clock.js ['UTC', 'UTC']:
            # the first is the zone name handed to the browser) - the scan cannot tell, so say so.
            if len(it.spans) > 1 and len(it.text.split()) <= 2:
                warn.setdefault(it.id, []).append(f'written in {len(it.spans)} places; a short word - check that '
                                                  'each one is shown text, not a value the code uses')
            if not rel.endswith('.py') and any('\n' in src[s:e].strip() and '\n' not in r for s, e, r in edits):
                warn.setdefault(it.id, []).append('a line written over several source lines is now on one line')
        except Refuse as ex:
            refused[it.id] = str(ex)
    # A row inside another row's `${...}` (a string in a template's placeholder): the outer row is
    # written now (it copies the placeholder as it is) and the inner one is DEFERRED to the next pass.
    deferred = []
    while True:
        spans = sorted((s, e, i) for i, (edits, _, _) in plans.items() for s, e, _ in edits)
        clash = next(((a, b) for a, b in zip(spans, spans[1:]) if b[0] < a[1] and a[2] != b[2]), None)
        if not clash:
            break
        size = {i: sum(e - s for s, e, _ in plans[i][0]) for i in (clash[0][2], clash[1][2])}
        inner = min(size, key=size.get)
        deferred.append(inner)
        plans.pop(inner)
    before = file_texts(rel, src)

    def attempt(ids):
        new_src = apply_edits(src, [x for i in ids for x in plans[i][0]])
        try:
            after = file_texts(rel, new_src)
        except SyntaxError as ex:
            return new_src, None, f'the file no longer parses ({ex})'
        added = after - before - {plans[i][1] for i in ids}
        gone = before - after - {plans[i][2] for i in ids}
        # A row's words can also show inside ANOTHER line's placeholder (`{st.away ? ' (dropped off)' : ''}`
        # is part of that line's display); that line changes with it, and only inside its placeholders.
        for g in list(gone):
            flat = BRACE_TOKEN.sub('{}', g)
            a = next((a for a in added if BRACE_TOKEN.sub('{}', a) == flat), None)
            if a is not None:
                gone.discard(g)
                added.discard(a)
        missing = [i for i in ids if plans[i][1] not in after]
        return new_src, (added, gone, missing), None

    ids = list(plans)
    new_src, res, err = attempt(ids)
    if err or res[0] or res[1] or res[2]:
        # Find the culprits one at a time, then try the good ones together.
        good = []
        for i in ids:
            _, r, er = attempt([i])
            if er or r[0] or r[1] or r[2]:
                why = er or ('the re-scan does not find the new words' if r[2] else
                             'writing it changes other text in the file (an escape went wrong)')
                refused[i] = why
            else:
                good.append(i)
        ids = good
        new_src, res, err = attempt(ids)
        if err or res[0] or res[1] or res[2]:
            for i in ids:
                refused[i] = 'fine alone, not together with the other rows of this file'
            ids, new_src = [], src
    after = file_texts(rel, new_src) if ids else before
    for i in ids:
        old = plans[i][2]
        if old != plans[i][1] and old in after:
            warn.setdefault(i, []).append('the old words are still in this file, in code the export skipped '
                                          '(a compare or a lookup?) - check it by hand')
    return new_src, {i: plans[i][1] for i in ids}, refused, warn, deferred


def apply_to_file(rel, src, items, wanted):
    """plan_file, pass after pass, until no row is left deferred. Returns (new src, done, refused, warn)."""
    done, refused, warn = {}, {}, {}
    pending = items
    while pending:
        src2, d, r, w, deferred = plan_file(rel, src, pending, wanted)
        done.update(d)
        refused.update(r)
        warn.update(w)
        if not deferred:
            src = src2
            break
        if not d:
            refused.update({i: 'overlaps another row in the code' for i in deferred})
            break
        src = src2
        col = Collector()
        scan_one(col, rel, src)
        now = {it.id: it for it in col.order}
        refused.update({i: 'its words changed when the line around it was rewritten' for i in deferred if i not in now})
        pending = [now[i] for i in deferred if i in now]
    return src, done, refused, warn


def read_export(path):
    """{id: (file, text)} from an exported Markdown file (only used to explain a refusal)."""
    out, cur = {}, None
    for ln in Path(path).read_text(encoding='utf-8').splitlines():
        m = re.match(r'^`web/(?:client/)?([^`]+)` · \d+ rows', ln)
        if m:
            cur = m.group(1)
        m = re.match(r'^- (t[0-9a-f]{8}) · [^·]* · [^·]* · (.*)$', ln)
        if m:
            out[m.group(1)] = (cur, m.group(2))
    return out


def raw_scan():
    """The same scan as scan(), on files read byte-for-byte (newlines kept), so offsets are true."""
    col, srcs = Collector(), {}
    paths = [(p.relative_to(CLIENT).as_posix(), p) for p in client_files({'.js', '.html', '.css'})
             if p.name not in CONTENT_FILES]
    paths += [('server/' + p.name, p) for p in sorted(SERVER.glob('*.py'))
              if not (p.name.startswith('test_') or p.name.startswith('migrate_'))]
    for rel, p in paths:
        with open(p, encoding='utf-8', newline='') as f:
            srcs[rel] = f.read()
        scan_one(col, rel, srcs[rel])
    return col, srcs


def apply_changes(changes_path, skip_paths=(), dry_run=False, export_path=None, report_path=None):
    import difflib
    wanted, dups = read_changes(changes_path)
    skip = set()
    for p in skip_paths or ():
        skip |= read_ids(p)
    skipped = sorted(i for i in wanted if i in skip)
    wanted = {i: t for i, t in wanted.items() if i not in skip}
    col, srcs = raw_scan()
    by_id = {it.id: it for it in col.order}
    export = read_export(export_path) if export_path else {}
    refused, warns, applied = {}, {}, {}
    per_file = {}
    for i in wanted:
        it = by_id.get(i)
        if it is None:
            why = 'not found: the words (or the file) changed since the export'
            if i in export:
                f, old = export[i]
                if f and f in {x.file for x in col.order}:
                    cands = [x.text for x in col.order if x.file == f]
                    best = difflib.get_close_matches(old, cands, n=1, cutoff=0.6)
                    why = f'{f}: the words changed since the export' + (f'; it now reads: {best[0]}' if best else
                                                                        '; no line like it is left in that file')
                else:
                    why = f'{f}: the file is gone or holds no rows'
            refused[i] = why
            continue
        if norm_text(wanted[i]) == it.text:
            refused[i] = 'the new words are the same as the old'
            continue
        per_file.setdefault(it.file, []).append(it)
    for rel, items in per_file.items():
        src = srcs[rel]
        if not dry_run:   # somebody may have edited the file since the scan: plan on what is there now
            with open(source_path(rel), encoding='utf-8', newline='') as f:
                now_src = f.read()
            if now_src != src:
                c2 = Collector()
                scan_one(c2, rel, now_src)
                now = {it.id: it for it in c2.order}
                refused.update({it.id: 'the file changed while applying and these words with it'
                                for it in items if it.id not in now})
                items = [now[it.id] for it in items if it.id in now]
                src = now_src
        new_src, done, ref, warn = apply_to_file(rel, src, items, wanted)
        refused.update(ref)
        warns.update(warn)
        applied.update({i: (rel, by_id[i].text, d) for i, d in done.items()})
        if done and not dry_run:
            with open(source_path(rel), 'w', encoding='utf-8', newline='') as f:
                f.write(new_src)
    lines = [f'{"DRY RUN - nothing written. " if dry_run else ""}{len(applied)} applied, {len(refused)} refused, '
             f'{len(skipped)} skipped (--skip), {len(dups)} duplicate ids in the changes file.']
    for i, (rel, old, new) in sorted(applied.items(), key=lambda x: (x[1][0], x[0])):
        lines.append(f'APPLIED  {i}  {rel}\n    was: {old}\n    now: {new}')
        for w in warns.get(i, []):
            lines.append(f'    WARNING: {w}')
    for i, why in sorted(refused.items(), key=lambda x: x[0]):
        f = by_id[i].file if i in by_id else (export.get(i, ('?',))[0])
        lines.append(f'REFUSED  {i}  {f}  {why}')
    if dups:
        lines.append('DUPLICATE ids (the last one was used): ' + ' '.join(dups))
    text = '\n'.join(lines) + '\n'
    if report_path:
        Path(report_path).write_text(text, encoding='utf-8')
    return {'applied': applied, 'refused': refused, 'warnings': warns, 'skipped': skipped, 'report': text}


# --------------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------------
HEADER = """# Site text, for the rewrite - exported {date}

Exported by `web/tools/export_site_text.py` (public repo) from the code as it stood on {date}
(commit `{commit}`{dirty}). Row 2.75, chat note BN item 2.

## For the chat doing the rewrite - read this first

**How to send the rewrite back.** One line per change, using the id at the start of each row:

    t1a2b3c4d => The new words here

Leave out any row you are not changing. Do not change ids. A row's text is the EXACT current wording;
an apply step finds it by id, checks the wording has not changed since this export, and puts yours in
its place (every place it appears in that file - repeats are listed once, with all their line numbers).

**Rules for the new words.**
1. Plain words. Short. Say what a thing does for the person using it, not how it is built.
2. Never "her screen". Never name Christine or Cici, or refer to the person the project was first built
   for - a visitor has no idea who that is (Mike, 2026-09-11; checked by `web/tools/check_site_copy.py`).
3. These words are banned in what a visitor reads on Your people, the ⚙ menu and the join/claim pages,
   and the suites check for them (whole words, plurals too) - avoid them everywhere you can:
{banned}
4. Keep every `{{placeholder}}` exactly as written (curly braces and what is inside) - the code fills
   them in. You may move one within the sentence; do not drop, rename or add one.
5. Keep keyboard hints and key names as they are (Ctrl+Shift+L, Esc, Space, arrow keys, "press Enter").
6. Keep a line's job: a button stays short enough to be a button, a status line stays one line. `\\n` is a
   line break inside the string - keep it or remove it, but write it as `\\n`.
7. A `?` row might not be on any screen (it was kept because it reads like words, or it only shows when
   something fails). Rewrite it if it reads like site copy; skip it if it looks like code.

**Row format.** `- <id> · L<line>[, L<line>…] · <flags> · <text>`
Flags: `?` maybe not shown (see rule 7) · `seen` found on a page by the headless pass · `⚠word` contains a
banned word (rule 3) or a reference to one person (rule 2).

**Grouping.** Part A pages (each with the scripts only it loads), Part B modules (the parts a person puts
on a screen), Part C menus and settings, Part D the shared parts used by several pages, Part E the
server's words (the privacy list), Part F CSS text, Part G text seen only when the pages ran, Part H what
is not covered. Files with many rows are split by the function the text sits in (`#### in name`).
Inline markup inside a line is shown by tag name only (`<a>`, `<b>`, `<code>`, `<br>`): keep the tags
around the same words and the apply step restores each tag (its link, its class) in the same order.

**One line to ADD, not rewrite.** The call and talk board sections (call.html, call_page.js, call_notice.js,
modules/call.js, talk.html, talk.js, modules/board.js, board_editor.js) start with a SUGGESTED new line
that is not in the site yet: "Nimrod isn't a nurse call or an emergency system — for help, use the
room's call button or phone." Place it (or your version of it) wherever calls and the talk board are
described to a visitor; say where it should go, and it will be added by hand.

## Totals
"""

SUGGESTION = ("> **SUGGESTED NEW LINE - not in the site yet (Mike's wording, for wherever calls and the talk board "
              "are described):**\n> \"Nimrod isn't a nurse call or an emergency system — for help, use the room's "
              "call button or phone.\"\n")


def write_md(path, col, content_counts, packs, learn_json, only, ran):
    import datetime
    import subprocess
    date = datetime.date.today().isoformat()
    try:
        commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=str(REPO_ROOT),
                                capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'web'], cwd=str(REPO_ROOT),
                               capture_output=True, text=True).stdout.strip()
    except Exception:
        commit, dirty = '?', ''
    bl = banned_lists()
    allbanned = sorted({w for v in bl.values() for w in v})
    banned_md = '\n'.join(f'   - `{k}` (web/client/{k.split()[0]}): ' + ', '.join(f'"{w}"' for w in v) for k, v in bl.items())
    bad_rx = re.compile(r'\b(' + '|'.join(allbanned) + r')s?\b', re.I) if allbanned else None
    her_rx = re.compile(r'\b(she|her|hers|herself|Christine|Cici)\b', re.I)

    owners = page_scripts()
    mods = module_titles()

    def part_of(rel):
        if rel.startswith('server/'):
            return 'E'
        if rel.endswith('.css'):
            return 'F'
        if rel.endswith('.html'):
            return 'A'
        if rel in MENU_FILES:
            return 'C'
        if rel.startswith('modules/'):
            return 'B'
        own = owners.get(rel, [])
        if len(own) == 1 and own[0].endswith('.html'):
            return 'A'
        return 'D'

    files = {}
    for it in col.order:
        files.setdefault(it.file, []).append(it)
    page_of = {rel: owners[rel][0] for rel in files if part_of(rel) == 'A' and not rel.endswith('.html')}

    out = []
    counts = []
    parts = {'A': [], 'B': [], 'C': [], 'D': [], 'E': [], 'F': []}
    for rel in files:
        parts[part_of(rel)].append(rel)
    # Pages: each html, then the scripts only it loads.
    a_order = []
    for rel in sorted(r for r in parts['A'] if r.endswith('.html')):
        a_order.append(rel)
        a_order += sorted(r for r in parts['A'] if page_of.get(r) == rel)
    a_order += [r for r in parts['A'] if r not in a_order]
    parts['A'] = a_order
    for k in 'BCDEF':
        parts[k] = sorted(parts[k], key=lambda r: (r != 'kiosk.js', r))

    titles = {'A': 'Part A - Pages', 'B': 'Part B - Modules (the parts a person puts on a screen)',
              'C': 'Part C - Menus, settings, the bar', 'D': 'Part D - Shared parts (used by several pages)',
              'E': 'Part E - Server text (the privacy list "what we store", refusals)',
              'F': 'Part F - CSS text (`content:`)'}
    body = []
    total = {'rows': 0, 'weak': 0, 'seen': 0}
    for k in 'ABCDEF':
        if not parts[k]:
            continue
        body.append(f'\n## {titles[k]}\n')
        for rel in parts[k]:
            items = sorted(files[rel], key=lambda i: i.lines[0])
            nweak = sum(1 for i in items if i.conf == 'weak')
            nseen = sum(1 for i in items if i.seen)
            total['rows'] += len(items)
            total['weak'] += nweak
            total['seen'] += nseen
            label = rel
            if rel in mods and mods[rel]:
                label += f' - module {mods[rel]}'
            elif k == 'A' and not rel.endswith('.html'):
                label += f' - script of {page_of.get(rel, "")}'
            counts.append((k, label, len(items), nweak, nseen))
            where = f'web/{rel}' if rel.startswith('server/') else f'web/client/{rel}'
            body.append(f'\n### {label}\n')
            body.append(f'`{where}` · {len(items)} rows' + (f' · {nweak} marked ?' if nweak else '')
                        + (f' · {nseen} seen' if ran else '') + '\n')
            if rel in CALL_TALK:
                body.append('\n' + SUGGESTION)
            body.append('')
            big = len(items) > 80
            last_sect = None
            for it in items:
                if big and it.section and it.section != last_sect:
                    body.append(f'\n#### in `{it.section}`\n')
                    last_sect = it.section
                flags = []
                if it.conf == 'weak':
                    flags.append('?')
                if it.seen:
                    flags.append('seen')
                if bad_rx:
                    flags += sorted({'⚠' + m.group(1).lower() for m in bad_rx.finditer(it.text)})
                flags += sorted({'⚠' + m.group(1).lower() for m in her_rx.finditer(it.text)})
                lines = ', '.join(f'L{n}' for n in sorted(it.lines)[:12]) + (' …' if len(it.lines) > 12 else '')
                body.append(f'- {it.id} · {lines} · {" ".join(flags) or "-"} · {it.text}')
    # Runtime only
    body.append('\n## Part G - Text seen only when the pages ran (not found in the export above)\n')
    if not ran:
        body.append('The headless pass was not run for this export (`--runtime`).\n')
    else:
        body.append('Each page was opened in headless Chrome against a scratch server (empty database, a '
                    'throwaway signed-in test user; the landing signed out). These lines matched nothing '
                    'exported above: text assembled at runtime, a placeholder filled in, or data (names, '
                    'dates, sample content). They have NO file:line - finding their source is part of '
                    'applying a rewrite of them.\n')
        for page, lines in only.items():
            body.append(f'\n### {page} - {len(lines)} lines\n')
            for ln in lines:
                rid = 'r' + hashlib.sha1(f'{page}\0{ln}'.encode('utf-8')).hexdigest()[:8]
                body.append(f'- {rid} · runtime · {ln}')
    body.append('\n## Part H - Not covered\n')
    body.append('Counted here, not exported line by line - content, not the site\'s own copy:\n')
    for rel, (n, why) in sorted(content_counts.items()):
        body.append(f'- `web/client/{rel}` - {why}: {n} strings')
    by_dir = {}
    for rel, n in sorted(packs.items()):
        d = rel.split('/')[0]
        by_dir.setdefault(d, [0, 0])
        by_dir[d][0] += 1
        by_dir[d][1] += n
    for d, (nf, n) in sorted(by_dir.items()):
        body.append(f'- `web/client/{d}/` - question/lesson packs (trivia and lessons): {nf} files, {n} questions/items')
    for rel, n in sorted(learn_json.items()):
        body.append(f'- `web/client/{rel}` - learn-site data: {n} bytes of JSON')
    body.append("""- Question and word banks written inside module files (trivia, word games, quiz mixes) ARE scanned
  as strings: a question reads like a sentence, so many appear in Part B. They are content - rewrite
  them only if you mean to.
- The AAC talk board's words (`aac_*.js`) - the board's vocabulary is the person's voice, not site copy.
- Text a person typed or a server returns (names, notes, screen names, pack text, search results).
- Text drawn into a canvas or an image, and emoji used as icons.
- Sentences built from pieces with code between them (`'a ' + name + ' c'`, or a list `.join(', ')`): each
  piece is its own row. Pieces joined only by `+` ARE one row.
- Browser-made text (permission prompts, file pickers, the browser's own error pages).
- The headless pass sees only what a page shows on arrival with an empty database: menus not opened,
  steps not taken and error states not reached show up only in the static export.""")

    head = HEADER.format(date=date, commit=commit, dirty=', with uncommitted changes in web/' if dirty else '',
                         banned=banned_md)
    tot = [f'{total["rows"]} rows across {len(files)} files · {total["weak"]} marked ? · '
           + (f'{total["seen"]} seen in the headless pass · {sum(len(v) for v in only.values())} runtime-only lines'
              if ran else 'headless pass not run'), '',
           '| part | file | rows | ? | seen |', '|---|---|---:|---:|---:|']
    for k, label, n, w, s in counts:
        tot.append(f'| {k} | {label} | {n} | {w} | {s if ran else ""} |')
    Path(path).write_text(head + '\n'.join(tot) + '\n' + '\n'.join(body) + '\n', encoding='utf-8')
    return total, counts


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', help='the Markdown file to write')
    ap.add_argument('--json', help='also write every item (id, file, lines, spans, text) as JSON')
    ap.add_argument('--runtime', action='store_true', help='also run the headless pass')
    ap.add_argument('--port', type=int, default=8944)
    ap.add_argument('--wait', type=float, default=5.0, help='seconds to let each page settle')
    ap.add_argument('--apply', metavar='CHANGES', help='write `<id> => new text` lines back into the code')
    ap.add_argument('--skip', action='append', default=[], metavar='IDS',
                    help='with --apply: leave out every id this file lists (repeatable)')
    ap.add_argument('--dry-run', action='store_true', help='with --apply: report, write nothing')
    ap.add_argument('--export', metavar='MD', help='with --apply: the export the changes were made from '
                    '(only to say what a refused row reads like now)')
    ap.add_argument('--report', metavar='FILE', help='with --apply: write the full report here')
    a = ap.parse_args(argv)
    if a.apply:
        r = apply_changes(a.apply, a.skip, a.dry_run, a.export, a.report)
        print(r['report'] if not a.report else r['report'].split('\n')[0])
        return 0
    if not a.out:
        ap.error('--out is required (or --apply)')
    col, content_counts, packs, learn_json = scan()
    print(f'static scan: {len(col.order)} rows', file=sys.stderr)
    only, ran = {}, False
    if a.runtime:
        got = runtime_pass(a.port, a.wait)
        only = match_runtime(col, got)
        ran = True
    total, counts = write_md(a.out, col, content_counts, packs, learn_json, only, ran)
    if a.json:
        Path(a.json).write_text(json.dumps([{'id': i.id, 'file': i.file, 'lines': i.lines, 'spans': i.spans,
                                             'conf': i.conf, 'how': i.how, 'text': i.text, 'seen': sorted(i.seen)}
                                            for i in col.order], ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'wrote {a.out}: {total["rows"]} rows ({total["weak"]} marked ?)', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
