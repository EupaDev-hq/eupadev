#!/usr/bin/env python3
"""Report every line that still contains French (switch plan: docs/reflexions/2026-10-20-note-english-switch.md).

Usage (from the repository root):
  check-english.py [PATH...]             every tracked file (or those under PATH): file:line: reasons: text,
                                         then the count of lines per top-level directory
  check-english.py --base REF [PATH...]  only the lines added since REF (git diff REF), for CI
Exit code 1 when a line is reported.

A line is French when it has:
  - an accented letter or a French quotation mark (« »);
  - one French function word that English never uses (STRONG), or two from WEAK (« de », « la »…);
  - a French word of the Words table of docs/glossary.md, alone or inside an identifier
    (`creerCycle`, `cree_le`, `garde-fous`), except rows noted « not checked »;
  - a French compound term of the other glossary tables (`image_candidate`), matched as a whole.
Allowed: ALLOWED_PATHS (French copies, private notes, i18n French dictionaries `**/lang/fr.json`) and the
entries of check-english-allow.txt (one per line: `path-glob | regex or * | reason`).

ponytail: word lists, not a language detector. A French sentence made only of English homographs and
unlisted words escapes; an English line quoting a listed French word is reported (allow-list it).
"""
import fnmatch
import os
import re
import subprocess
import sys
import unicodedata

GLOSSARY = 'docs/glossary.md'
ALLOW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'check-english-allow.txt')
ALLOWED_PATHS = ('docs/fr/*', '*/docs/fr/*', 'docs/reflexions/*', '*.fr.md', '*/lang/fr.json', GLOSSARY,
                 '*pnpm-lock.yaml', '*package-lock.json', '*.terraform.lock.hcl')
ACCENT = re.compile(r'[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ«»]')
# French words that do not occur in English text; one is enough.
STRONG = set('''les des une est sont avec dans aux cette ces nous vous ils elles leur leurs chez donc alors
puis lorsque parce afin ainsi voici ceci cela celui celle celles ceux chaque selon depuis jamais rien aucun aucune
pourquoi quand quoi toujours aussi mais tout tous toute toutes peut doit faut fait ont avoir
etre etait sera soit lui notre votre vos sous'''.split())
# Short French words that also appear in English code or text (« de facto », shell « -le », locale « en »):
# two distinct ones on a line are needed.
WEAK = set('de du la le un et ou en au il ne se si ce sur par pour sans pas que qui son sa ses'.split())
# French function words that only count inside a snake_case or camelCase identifier (`sansValeur`, `tous_les_depots`):
# alone they are English too (« sans-serif », « on par »).
IN_IDENTIFIER = set('sans pas par sur pour les des aux une avec dans vers tous tout qui que depuis'.split())
WORD = re.compile(r"(?<![\w/.\-])([A-Za-zÀ-ÿœŒ]+)(?![\w/\-])")
TOKEN = re.compile(r'[A-Za-zÀ-ÿœŒ0-9_]+(?:[-.][A-Za-zÀ-ÿœŒ0-9_]+)*')
PRIVATE_NOTE = re.compile(r'docs/reflexions/[^\s`)\]"\'>,;]*')
HEX = re.compile(r'^(?=.*\d)[0-9a-fA-F]{7,}$')


def plain(word):
    return ''.join(c for c in unicodedata.normalize('NFD', word) if unicodedata.category(c) != 'Mn').lower()


def subwords(token):
    """`creerCycleOutil` → creer, cycle, outil; `cree_le` → cree, le."""
    out = []
    for part in re.split(r'[^A-Za-zÀ-ÿœŒ]+', token):
        out += re.findall(r'[A-ZÀ-ÞŒ]+(?=[A-ZÀ-ÞŒ][a-zß-ÿœ])|[A-ZÀ-ÞŒ]?[a-zß-ÿœ]+|[A-ZÀ-ÞŒ]+', part)
    return [plain(w) for w in out]


def load_glossary(path=GLOSSARY):
    """(French words checked inside any token, French compound terms matched whole)."""
    words, terms, section = set(), set(), ''
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
    except FileNotFoundError:
        return words, terms
    for line in lines:
        if line.startswith('## '):
            section = line[3:].strip().lower()
        m = re.match(r'\|\s*`([^`]+)`\s*\|\s*`?([^`|]*)`?\s*\|(.*)$', line)
        if not m or 'not checked' in m.group(3):
            continue
        fr, en = m.group(1).strip(), m.group(2).strip()
        if fr == en:
            continue
        if section.startswith('words'):
            if fr == plain(fr):  # accented words are caught by ACCENT; their plain form may be English (rôle)
                words.add(fr)
        elif re.search(r'[_\-./]|[a-z][A-Z]', fr) and not fr.startswith(('/', '.')):
            terms.add(fr)
    return words, terms


def load_allow(path=ALLOW_FILE):
    rules = []
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
    except FileNotFoundError:
        return rules
    for n, line in enumerate(lines, 1):
        if not line.strip() or line.startswith('#'):
            continue
        parts = [p.strip() for p in line.split(' | ')]
        if len(parts) != 3 or not parts[2]:
            raise SystemExit(f'{path}:{n}: expected `path-glob | regex or * | reason` (the reason is required)')
        rules.append((parts[0], None if parts[1] == '*' else re.compile(parts[1]), parts[2]))
    return rules


def allowed(path, text, rules):
    if any(fnmatch.fnmatch(path, g) for g in ALLOWED_PATHS):
        return True
    return any(fnmatch.fnmatch(path, g) and (rx is None or rx.search(text)) for g, rx, _ in rules)


def reasons(text, words, terms):
    """Why the line is French; empty when it is not."""
    why = []
    # A path into the private French notes (L7) is a publication matter, not a language one.
    text = PRIVATE_NOTE.sub('', text)
    m = ACCENT.search(text)
    if m:
        why.append(f'accent « {m.group(0)} »')
    prose = re.sub(r'\b(de facto|et al)\b', '', text, flags=re.I)  # Latin in English text
    found = {w.lower() for w in WORD.findall(prose)}
    strong = sorted(found & STRONG)
    weak = sorted(found & WEAK)
    if strong:
        why.append('stop-word ' + ', '.join(strong[:3]))
    elif len(weak) >= 2:
        why.append('stop-words ' + ', '.join(weak[:3]))
    hits = []
    for tok in TOKEN.findall(text):
        if HEX.match(tok):
            continue
        if tok in terms:
            hits.append(tok)
            continue
        compound = '_' in tok or re.search(r'[a-z][A-Z]', tok)
        for w in subwords(tok):
            if (w in words and len(w) > 2) or (compound and w in IN_IDENTIFIER):
                hits.append(tok if tok.lower() == w else f'{w} in {tok}')
                break
    if hits:
        why.append('glossary ' + ', '.join(dict.fromkeys(hits[:3])))
    return why


def tracked(paths):
    out = subprocess.run(['git', 'ls-files', '--', *paths], capture_output=True, text=True, check=True).stdout
    return [p for p in out.split('\n') if p]


def added_lines(base, paths):
    """{path: {line numbers added since base}} from `git diff -U0`."""
    diff = subprocess.run(['git', 'diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=AMR', base, '--', *paths],
                          capture_output=True, text=True, check=True).stdout
    added, path, n = {}, None, 0
    for line in diff.split('\n'):
        if line.startswith('+++ '):
            path = line[6:] if line.startswith('+++ b/') else None
        elif line.startswith('@@'):
            n = int(re.match(r'@@ -\S+ \+(\d+)', line).group(1))
        elif line.startswith('+') and path:
            added.setdefault(path, set()).add(n)
            n += 1
    return added


def scan(files, only=None, glossary=GLOSSARY, allow=ALLOW_FILE):
    """[(path, line number, reasons, text)] of the French lines."""
    words, terms = load_glossary(glossary)
    rules = load_allow(allow)
    found = []
    for path in files:
        if only is not None and path not in only:
            continue
        try:
            lines = open(path, encoding='utf-8').read().split('\n')
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue  # binary, deleted or a submodule
        for n, text in enumerate(lines, 1):
            if only is not None and n not in only[path]:
                continue
            why = reasons(text, words, terms)
            if why and not allowed(path, text, rules):
                found.append((path, n, why, text.strip()))
    return found


def main(args):
    base = None
    if '--base' in args:
        i = args.index('--base')
        base = args[i + 1]
        args = args[:i] + args[i + 2:]
    only = added_lines(base, args) if base else None
    found = scan(tracked(args), only)
    per_dir = {}
    for path, n, why, text in found:
        print(f'{path}:{n}: {"; ".join(why)}: {text[:160]}')
        top = path.split('/')[0] if '/' in path else '.'
        per_dir[top] = per_dir.get(top, 0) + 1
    if found:
        print('\nFrench lines per top-level directory:')
        for top, count in sorted(per_dir.items(), key=lambda x: -x[1]):
            print(f'  {count:6d}  {top}')
        print(f'  {len(found):6d}  total')
        return 1
    print('OK: no French line found.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
