#!/usr/bin/env python3
"""Test of check-english.py: fails if French slips through or if plain English starts to be reported."""
import importlib.util
import os
import pathlib
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True  # no __pycache__ in .github/scripts
SCRIPT = pathlib.Path(__file__).with_name('check-english.py')
spec = importlib.util.spec_from_file_location('check_english', SCRIPT)
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

GLOSSARY = '''# Glossary
## Words
| French | English | Where | Notes |
|---|---|---|---|
| `outil` | `tool` | `x` | |
| `creer` | `create` | `x` | |
| `cree` | `created` | `x` | |
| `garde` | `guard` | `x` | |
| `fous` | `rails` | `x` | |
| `rôle` | `role` | `x` | accented: caught by the accent rule only |
| `journal` | `log` | `x` | not checked: English homograph |
## Engine
| French | English | Where | Notes |
|---|---|---|---|
| `image_candidate` | `candidate_image` | `x` | word order |
| `gate_1` | `gate_1` | `x` | unchanged |
'''


def french(line, glossary):
    return c.reasons(line, *glossary)


with tempfile.TemporaryDirectory() as d:
    g = os.path.join(d, 'glossary.md')
    open(g, 'w', encoding='utf-8').write(GLOSSARY)
    gl = c.load_glossary(g)
    assert gl[0] == {'outil', 'creer', 'cree', 'garde', 'fous'}, gl[0]
    assert gl[1] == {'image_candidate'}, gl[1]
    print('ok - glossary: checked words and compound terms read, « not checked » and accented rows left out')

    for line in ['The son of the date message is in the table service, but not here.',
                 "font-family: system-ui, sans-serif;",
                 'du -sh /var/lib/docker && [ "$n" -le 3 ] && [ "$a" -ne 0 ]',
                 'Load lang/en.json, a de facto standard (Smith et al.).',
                 'Add a comment, then encore: OnCalendar=Mon *-*-* 03:00',
                 'image: postgres@sha256:6844eaf354e19d50dcdd8ee78968d6ae32ccd4b9f15a883902d60e93d69caf84',
                 'The systemd journal keeps the role of each tool.',
                 'gate_1 waits for the admin; deploy on par with the plan.',
                 'Source: `docs/reflexions/2026-10-13-note-suivi-versions.md` (private note).']:
        assert not french(line, gl), (line, french(line, gl))
    print('ok - English lines (son, but, date, message, table, service, sans-serif, du, -le, en, Mon, hex, '
          'paths of the private notes) not reported')

    for line, why in [('La tâche est finie.', 'accent'),
                      ('« Contrôle »', 'accent'),
                      ('les outils sont prets', 'stop-word'),
                      ('voir le cycle de vie', 'stop-words'),
                      ('const x = creerCycleOutil(db);', 'glossary'),
                      ('SELECT cree_le FROM cycles;', 'glossary'),
                      ('run .gitea/controles/garde-fous.sh', 'glossary'),
                      ("if (etat === 'image_candidate')", 'glossary'),
                      ('const sansValeur = tous_les_depots;', 'glossary')]:
        got = french(line, gl)
        assert any(w.startswith(why) for w in got), (line, got)
    print('ok - French lines reported: accents, stop-words, glossary words inside identifiers, compound terms')

    allow = os.path.join(d, 'allow.txt')
    open(allow, 'w', encoding='utf-8').write('# comment\nREADME.md | Lire en français | language link\n'
                                             'fixtures/* | * | deliberate accents\n')
    rules = c.load_allow(allow)
    assert c.allowed('README.md', '🇫🇷 [Lire en français](README.fr.md)', rules)
    assert not c.allowed('README.md', 'Une phrase en français.', rules)
    assert c.allowed('fixtures/utf8.txt', 'Électricité', rules)
    for path in ['docs/fr/architecture.md', 'docs/fr/adr/011-x.md', 'tool-template/docs/fr/README.md',
                 'README.fr.md', 'orchestrator/web/lang/fr.json', 'docs/reflexions/2026-10-20-note.md',
                 'docs/glossary.md']:
        assert c.allowed(path, 'texte français', []), path
    assert not c.allowed('orchestrator/web/lang/en.json', 'texte français', [])
    print('ok - allowed: built-in paths, allow-list entries by path and regex; en.json still checked')

    open(allow, 'w', encoding='utf-8').write('README.md | * |\n')
    try:
        c.load_allow(allow)
        raise AssertionError('allow-list entry without a reason accepted')
    except SystemExit:
        pass
    print('ok - allow-list entry without a reason refused')

    def git(*args):
        return subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *args], cwd=d,
                              check=True, capture_output=True, text=True).stdout

    def run(*args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=d, capture_output=True, text=True)

    os.makedirs(os.path.join(d, 'docs'))
    os.rename(g, os.path.join(d, 'docs', 'glossary.md'))
    os.remove(allow)
    open(os.path.join(d, 'a.md'), 'w', encoding='utf-8').write('Les outils sont là.\nEnglish only.\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-qm', 'base')
    r = run()
    assert r.returncode == 1 and 'a.md:1:' in r.stdout and 'a.md:2:' not in r.stdout, r.stdout
    assert re.search(r'^\s+1\s+\.$', r.stdout, re.M) and re.search(r'^\s+1\s+total$', r.stdout, re.M), r.stdout
    r = run('--base', 'HEAD')
    assert r.returncode == 0 and 'OK' in r.stdout, r.stdout
    open(os.path.join(d, 'a.md'), 'a', encoding='utf-8').write('Another English line.\nUne ligne ajoutée.\n')
    r = run('--base', 'HEAD')
    assert r.returncode == 1 and 'a.md:4:' in r.stdout and 'a.md:1:' not in r.stdout, r.stdout
    r = run('docs')
    assert r.returncode == 0, r.stdout
    print('ok - full mode, --base (only added lines) and path filter')
