"""Stamp every local script and stylesheet reference with a fingerprint of the code.

GitHub Pages lets browsers cache each file for ten minutes. Without stamps, a visitor
can get a new index.html with an old app.js (or a new app.js importing an old dict.js),
and features silently stop working. With `?v=<fingerprint>` on every reference, a new
page always asks for the matching new files, and an old page keeps its old ones.

Run before committing (the pre-commit hook in .githooks does it automatically):
    python tools/stamp.py
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAMP = re.compile(r'\?v=[0-9a-f]+')

# Local references that need a stamp: imports between modules, the page's script and
# stylesheet, and the stylesheet fetched for the HTML export.
JS_IMPORT = re.compile(r"""((?:from\s+|import\()\s*['"])(\./[\w-]+\.js)(?:\?v=[0-9a-f]+)?(['"])""")
HTML_REF = re.compile(r"""((?:src|href)=")((?:js|css)/[\w-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?(")""")
CSS_FETCH = re.compile(r"""(fetch\(')(css/style\.css)(?:\?v=[0-9a-f]+)?(')""")


def fingerprint():
    h = hashlib.sha1()
    for path in sorted([*ROOT.glob('js/*.js'), *ROOT.glob('css/*.css')]):
        h.update(path.name.encode())
        h.update(STAMP.sub('', path.read_text(encoding='utf-8')).encode())  # stamps don't count
    return h.hexdigest()[:10]


def main():
    v = fingerprint()
    sub = lambda m: f'{m.group(1)}{m.group(2)}?v={v}{m.group(3)}'
    changed = []
    for path in [*ROOT.glob('js/*.js'), ROOT / 'index.html']:
        text = path.read_text(encoding='utf-8')
        new = HTML_REF.sub(sub, text) if path.suffix == '.html' else CSS_FETCH.sub(sub, JS_IMPORT.sub(sub, text))
        if new != text:
            path.write_text(new, encoding='utf-8', newline='\n')
            changed.append(path.relative_to(ROOT).as_posix())
    print(f'stamp {v}: ' + (', '.join(changed) if changed else 'already current'))


if __name__ == '__main__':
    main()
