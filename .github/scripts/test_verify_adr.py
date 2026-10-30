#!/usr/bin/env python3
"""Test of verify-adr.py in a throwaway git repository: fails if the logic breaks."""
import importlib.util
import os
import subprocess
import sys
import tempfile

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify-adr.py')
BODY = '## Decision\nThe CI refuses any decison taken without an ADR for 10 days.\n'  # typo on purpose
TODAY = '2026-10-20'  # forced current date: the test does not depend on the real date
REGISTRY = '# R\n<!-- adr-registry:start -->\n<!-- adr-registry:end -->\n'


def adr(num, status, supersedes='', date=None, related='', check='in-place', title=None, body=BODY,
        check_key='check'):
    """Minimal ADR; empty date for a "proposed" one, 2026-10-12 otherwise (unless a date is given)."""
    if date is None:
        date = '' if status in ('proposed', FR['proposed']) else '2026-10-12'
    check_line = f'{check_key}: {check}\n' if check is not None else ''
    return (f'---\nadr: {num}\ntitle: {title or "Title " + num}\nstatus: {status}\ndate: {date}\n'
            f'decision-makers: Ilan\nsupersedes: {supersedes}\nrelated: {related}\n'
            f'{check_line}---\n{body}')


def write(path, text):
    open(path, 'w', encoding='utf-8').write(text)


def run(*args, variables=None):
    env = {k: v for k, v in os.environ.items() if k not in ('BASE_PR', 'BEFORE', 'GITHUB_REF')}
    env.update(variables or {})
    return subprocess.run([sys.executable, SCRIPT, '--today', TODAY, *args],
                          capture_output=True, text=True, env=env).returncode


def git(*args, date=None):
    env = dict(os.environ)
    if date:
        env['GIT_COMMITTER_DATE'] = env['GIT_AUTHOR_DATE'] = f'{date}T12:00:00'
    return subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *args],
                          check=True, capture_output=True, text=True, env=env).stdout.strip()


sys.dont_write_bytecode = True  # no __pycache__ in .github/scripts
spec = importlib.util.spec_from_file_location('verify_adr', SCRIPT)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
# ADR-011's French vocabulary, taken from the checker's own mapping (English value → French value).
FR = {en: fr for fr, en in v.FR_VALUES.items()}
OLD = {new: old for old, new in v.RENAMED.items()}

# Frontmatter reading: "#" only cuts at the start of a line.
meta, body = v.read('---\n# comment\ntitle: Ticket #42 in C#\n\nstatus: proposed\n---\nbody\n')
assert meta == {'title': 'Ticket #42 in C#', 'status': 'proposed'}, meta
assert body == 'body\n'
print('ok - "#" inside a value kept, comment line ignored')

# Registry: empty date shown as "—", "Check" column filled.
lines = v.registry(v.adrs({'docs/adr/001-a.md': adr('001', 'proposed', check='partial'),
                           'docs/adr/002-b.md': adr('002', 'accepted', check=None)})).split('\n')
assert lines[0] == '| ADR | Title | Status | Date | Check |', lines[0]
assert lines[2] == '| [ADR-001](docs/adr/001-a.md) | Title 001 | proposed | — | partial |', lines[2]
assert lines[3] == '| [ADR-002](docs/adr/002-b.md) | Title 002 | accepted | 2026-10-12 | — |', lines[3]
print('ok - registry: empty date "—", "Check" column')


def case(name, expected, *changes, regenerate=True, args=('--base', 'HEAD'), variables=None):
    for path, text in changes:
        if text is None:
            os.remove(path)
        else:
            write(path, text)
    if regenerate:
        run('--write')
    code = run(*args, variables=variables)
    git('checkout-index', '-f', '-a')  # rewrites everything, even when date and size did not change
    git('clean', '-qfd')
    assert code == expected, f'{name}: code {code}, expected {expected}'
    print(f'ok - {name}')


with tempfile.TemporaryDirectory() as d:
    os.chdir(d)
    os.makedirs('docs/adr')
    write('ROADMAP.md', REGISTRY)
    # ADR-001 accepted without "check", like ADR-000 (older than the field).
    write('docs/adr/001-a.md', adr('001', 'accepted', related='[ADR-002]', check=None))
    write('docs/adr/002-b.md', adr('002', 'proposed'))
    assert run('--write') == 0
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    BASE = git('rev-parse', 'HEAD')
    assert run('--base', 'HEAD') == 0, 'starting state refused'
    print('ok - ADR accepted before the "check" field, without it: allowed')

    a = 'docs/adr/001-a.md'
    A = adr('001', 'accepted', related='[ADR-002]', check=None)
    case('body changed refused', 1, (a, A.replace('refuses', 'does not refuse')))
    case('word added at the end refused', 1, (a, A + 'Unless an exception.\n'))
    case('typo fixed refused (typos stay)', 1, (a, A.replace('decison', 'decision')))
    case('"related" of an accepted ADR frozen', 1, (a, adr('001', 'accepted', check=None)))
    case('"date" of an accepted ADR frozen', 1, (a, adr('001', 'accepted', related='[ADR-002]', date='2026-10-11',
                                                      check=None)))
    case('status "superseded by" an accepted ADR allowed', 0,
         (a, adr('001', 'superseded by ADR-003', related='[ADR-002]', check=None)),
         ('docs/adr/003-c.md', adr('003', 'accepted', 'ADR-001')))
    case('"superseded by" an ADR only proposed refused', 1,
         (a, adr('001', 'superseded by ADR-003', related='[ADR-002]', check=None)),
         ('docs/adr/003-c.md', adr('003', 'proposed', 'ADR-001')))
    case('"superseded by" a rejected ADR refused', 1,
         (a, adr('001', 'superseded by ADR-003', related='[ADR-002]', check=None)),
         ('docs/adr/003-c.md', adr('003', 'rejected', 'ADR-001')))
    case('chained supersessions allowed (the successor superseded in turn)', 0,
         (a, adr('001', 'superseded by ADR-003', related='[ADR-002]', check=None)),
         ('docs/adr/003-c.md', adr('003', 'superseded by ADR-004', 'ADR-001')),
         ('docs/adr/004-d.md', adr('004', 'accepted', 'ADR-003')))
    case('supersession without successor refused', 1,
         (a, adr('001', 'superseded by ADR-003', related='[ADR-002]', check=None)))
    case('accepted successor, old one not marked: refused', 1, ('docs/adr/003-c.md', adr('003', 'accepted', 'ADR-001')))
    case('proposed successor, old one still accepted: allowed', 0, ('docs/adr/003-c.md', adr('003', 'proposed', 'ADR-001')))
    case('status accepted → proposed refused', 1, (a, adr('001', 'proposed', related='[ADR-002]', check=None)))
    case('status accepted → rejected refused', 1, (a, adr('001', 'rejected', related='[ADR-002]', check=None)))
    case('deletion refused', 1, (a, None))
    case('rename refused', 1, (a, None), ('docs/adr/001-other.md', A))
    case('unknown status refused', 1, ('docs/adr/002-b.md', adr('002', 'in progress')))
    case('French status refused in the tree', 1, ('docs/adr/002-b.md', adr('002', FR['proposed'])))
    case('duplicate number refused', 1, ('docs/adr/001-other.md', adr('001', 'proposed')))
    case('proposed ADR changed freely', 0, ('docs/adr/002-b.md', adr('002', 'accepted') + 'Addition.\n'))
    case('stale registry refused', 1, ('docs/adr/002-b.md', adr('002', 'accepted')), regenerate=False)
    # Date (forced current date: 2026-10-20): empty while "proposed", date of the decision afterwards.
    case('dated proposal refused (the date comes at acceptance)', 1,
         ('docs/adr/002-b.md', adr('002', 'proposed', date='2026-10-12')))
    case('acceptance without date refused', 1, ('docs/adr/002-b.md', adr('002', 'accepted', date='')))
    case('acceptance dated today allowed', 0, ('docs/adr/002-b.md', adr('002', 'accepted', date=TODAY)))
    case('acceptance dated tomorrow refused', 1, ('docs/adr/002-b.md', adr('002', 'accepted', date='2026-10-21')))
    case('old acceptance allowed', 0, ('docs/adr/003-c.md', adr('003', 'accepted', date='2025-01-01')))
    case('invalid date refused', 1, ('docs/adr/003-c.md', adr('003', 'accepted', date='2026-02-30')))
    case('compact date format refused', 1, ('docs/adr/003-c.md', adr('003', 'accepted', date='20261012')))
    # "check" field.
    case('unknown "check" refused', 1, ('docs/adr/003-c.md', adr('003', 'proposed', check='done')))
    case('French "check" value refused', 1, ('docs/adr/003-c.md', adr('003', 'proposed', check=FR['planned'])))
    case('proposal without "check" refused', 1, ('docs/adr/003-c.md', adr('003', 'proposed', check=None)))
    case('proposal without "check" refused even without a base', 1,
         ('docs/adr/003-c.md', adr('003', 'proposed', check=None)), args=())
    case('ADR leaving "proposed" without "check" refused', 1,
         ('docs/adr/002-b.md', adr('002', 'accepted', check=None)))
    case('new accepted ADR without "check" refused', 1, ('docs/adr/003-c.md', adr('003', 'accepted', check=None)))
    case('"check" of an accepted ADR can change (added, then in-place → none)', 0,
         (a, adr('001', 'accepted', related='[ADR-002]', check='none')))
    # Base commit found in CI (--base-ci).
    main_ref, branch = {'GITHUB_REF': 'refs/heads/main'}, {'GITHUB_REF': 'refs/heads/trial'}
    ci = ('--base-ci',)
    case('CI: push to main without change allowed', 0, args=ci, variables={**main_ref, 'BEFORE': BASE})
    case('CI: new branch without change allowed', 0, args=ci, variables={**branch, 'BEFORE': '0' * 40})
    # Accepted ADR-001 changed then committed: HEAD ≠ base, as after a real push.
    write(a, A + 'Unless an exception.\n')
    git('commit', '-qam', 'forbidden change')
    case('CI: new branch compared with its fork point from main', 1, args=ci,
         variables={**branch, 'BEFORE': '0' * 40})
    case('CI: pull request compared with its base', 1, args=ci, variables={'GITHUB_REF': 'refs/pull/1/merge', 'BASE_PR': BASE})
    # After a push to main, origin/main = HEAD: comparing with the fork point from main
    # would compare HEAD with itself (the old fallback, which let everything through).
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    case('CI: push to main compared with "before"', 1, args=ci, variables={**main_ref, 'BEFORE': BASE})
    case('CI: push to main without "before" (000…) refused', 1, args=ci, variables={**main_ref, 'BEFORE': '0' * 40})
    case('CI: push to main, "before" not found (force-push) refused', 1, args=ci,
         variables={**main_ref, 'BEFORE': 'f' * 40})

# One-time translation (ADR-026): a base still in ADR-011's French vocabulary, then the translation
# commit, then the freeze again.
with tempfile.TemporaryDirectory() as d:
    os.chdir(d)
    os.makedirs('docs/adr')
    write('ROADMAP.md', REGISTRY)
    n0, n1, n2 = (f'docs/adr/{n}' for n in ('000-adr-format-and-lifecycle.md',
                                           '001-appliance-on-vms-provided-by-the-it-department.md',
                                           '011-adr-format-and-lifecycle-v2.md'))
    o0, o1, o2 = OLD[n0], OLD[n1], OLD[n2]
    n3 = 'docs/adr/025-repository-language.md'  # written in English, French status: not renamed
    french = {
        o0: adr('000', f'{v.FR_SUPERSEDED} ADR-011', check=None, title='Old title 000'),
        o1: adr('001', FR['proposed'], check=FR['planned'], check_key=v.FR_KEY, title='Old title 001'),
        o2: adr('011', FR['accepted'], 'ADR-000', related='[ADR-025]', check=FR['in-place'], check_key=v.FR_KEY,
                title='Old title 011'),
        n3: adr('025', FR['accepted'], check=FR['planned'], check_key=v.FR_KEY, title='Repository language'),
    }
    for path, text in french.items():
        write(path, text)
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-qm', 'French ADRs (ADR-011 vocabulary)')
    BODY_EN = '## Decision\nThe CI refuses any decision taken without an ADR for ten days.\n'
    english = {
        n0: adr('000', 'superseded by ADR-011', check=None, title='ADR format and lifecycle', body=BODY_EN),
        n1: adr('001', 'proposed', check='planned', title='Appliance on VMs', body=BODY_EN),
        n2: adr('011', 'accepted', 'ADR-000', related='[ADR-025]', check='in-place', title='Format v2', body=BODY_EN),
        n3: adr('025', 'accepted', check='planned', title='Repository language'),
    }
    gone = [(p, None) for p in (o0, o1, o2)]
    translation = gone + list(english.items())
    case('translation: French names and vocabulary mapped, titles and bodies translated', 0, *translation)
    others = [(p, t) for p, t in translation if p not in (o2, n2)]
    case('translation: an ADR kept under its French name refused', 1, *others, (o2, english[n2]))
    case('translation: an ADR renamed outside the mapping refused', 1, *others, (o2, None),
         ('docs/adr/011-other-name.md', english[n2]))
    case('translation: frozen field changed refused', 1, *translation,
         (n2, adr('011', 'accepted', 'ADR-000', related='', check='in-place', title='Format v2', body=BODY_EN)))
    case('translation: date changed refused', 1, *translation,
         (n2, adr('011', 'accepted', 'ADR-000', related='[ADR-025]', date='2026-10-11', check='in-place',
                  title='Format v2', body=BODY_EN)))
    case('translation: status other than the mapped one refused (accepted → rejected)', 1, *translation,
         (n2, adr('011', 'rejected', 'ADR-000', related='[ADR-025]', check='in-place', title='Format v2',
                  body=BODY_EN)))
    case('translation: superseded status changed refused', 1, *translation,
         (n0, adr('000', 'accepted', check=None, title='ADR format and lifecycle', body=BODY_EN)))
    case('translation: French vocabulary left in the tree refused', 1, *gone, *english.items(),
         (n2, adr('011', FR['accepted'], 'ADR-000', related='[ADR-025]', check='in-place', title='Format v2',
                  body=BODY_EN)))
    # The translation commit itself, then any later change of a translated accepted ADR is refused again.
    for path, text in translation:
        if text is None:
            git('rm', '-q', path)
        else:
            write(path, text)
    run('--write')
    git('add', '-A')
    git('commit', '-qm', 'translation')
    assert run('--base', 'HEAD~1') == 0, 'translation commit refused'
    print('ok - translation commit checked against the French base')
    case('after the translation: body of a translated accepted ADR changed refused', 1,
         (n2, english[n2].replace('ten days', '10 days')))
    case('after the translation: title of a translated accepted ADR changed refused', 1,
         (n2, english[n2].replace('Format v2', 'Format, v2')))
    case('after the translation: translated ADR renamed refused', 1, (n2, None), (o2, english[n2]))
    case('after the translation: status set back to French refused', 1,
         (n2, english[n2].replace('status: accepted', f'status: {FR["accepted"]}')))
    case('after the translation: a proposed ADR still changes freely', 0, (n1, english[n1] + 'More.\n'))
    # The mapping needs the French vocabulary in the base: an English base under a French name is not mapped.
    os.rename(n2, o2)
    run('--write')
    git('add', '-A')
    git('commit', '-qm', 'English ADR under its old name')
    case('English base under a French name: rename refused', 1, (o2, None), (n2, english[n2]))
    git('reset', '-q', '--hard', 'HEAD~1')

# One-time product rename (ADR-026): only the old product name family may differ, the new name is a parameter;
# its display form has an inner capital (NovaDev), kept as given: lower and upper case derived, never capitalised.
with tempfile.TemporaryDirectory() as d:
    os.chdir(d)
    os.makedirs('docs/adr')
    write('ROADMAP.md', REGISTRY)
    TEXT = '## Decision\nForgeAgent runs `forgeagent-deployer` with `FORGEAGENT_ROLE`; decison kept.\n'
    old_path, new_path = 'docs/adr/005-forgeagent-images.md', 'docs/adr/005-novadev-images.md'
    write('docs/adr/004-a.md', adr('004', 'accepted', title='ForgeAgent rule', body=TEXT))
    write(old_path, adr('005', 'accepted', title='Images of forgeagent', body=TEXT))
    run('--write')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-qm', 'base')
    renamed = TEXT.replace('ForgeAgent', 'NovaDev').replace('forgeagent', 'novadev').replace('FORGEAGENT', 'NOVADEV')
    A4 = adr('004', 'accepted', title='NovaDev rule', body=renamed)
    A5 = adr('005', 'accepted', title='Images of novadev', body=renamed)
    product = ('--base', 'HEAD', '--new-product-name', 'NovaDev')
    case('product rename: name substituted, file renamed', 0, ('docs/adr/004-a.md', A4), (old_path, None),
         (new_path, A5), args=product)
    case('product rename: file keeps its name', 0, ('docs/adr/004-a.md', A4), (old_path, A5), args=product)
    case('product rename without the parameter refused', 1, ('docs/adr/004-a.md', A4), (old_path, A5))
    case('product rename with another name refused', 1, ('docs/adr/004-a.md', A4), (old_path, A5),
         args=('--base', 'HEAD', '--new-product-name', 'Vega'))
    case('product rename plus another change refused', 1, ('docs/adr/004-a.md', A4.replace('decison', 'decision')),
         (old_path, A5), args=product)
    case('product rename incomplete refused (old name left)', 1,
         ('docs/adr/004-a.md', A4.replace('NovaDev runs', 'ForgeAgent runs')), (old_path, A5), args=product)
    case('product rename: display form kept as given, a naive capitalisation refused', 1,
         ('docs/adr/004-a.md', A4.replace('NovaDev runs', 'Novadev runs')), (old_path, A5), args=product)
    case('product rename: file renamed to another name refused', 1, ('docs/adr/004-a.md', A4), (old_path, None),
         ('docs/adr/005-other-images.md', A5), args=product)
    write('docs/adr/004-a.md', A4)
    write(old_path, A5)
    git('commit', '-qam', 'product rename')
    case('after the rename: a change other than the name refused, parameter still given', 1,
         ('docs/adr/004-a.md', A4.replace('decison', 'decision')), args=product)
    case('after the rename: unchanged ADRs pass, parameter still given', 0, args=product)

# Scheduled report of late proposals (--proposals): the age counts from the commit that adds the file;
# a later change does not reset it, and neither does a rename (followed, including the translation's).
with tempfile.TemporaryDirectory() as d:
    os.chdir(d)
    os.makedirs('docs/adr')
    write('ROADMAP.md', REGISTRY)
    git('init', '-q', '-b', 'main')
    for num, day in (('001', '2026-09-19'), ('002', '2026-09-20'), ('003', '2026-09-01'), ('004', '2026-09-01'),
                     ('006', '2026-09-02')):
        write(f'docs/adr/{num}-x.md', adr(num, 'accepted' if num == '004' else 'proposed', body=f'Body {num}.\n' * 9))
        git('add', '.')
        git('commit', '-qm', f'add {num}', date=day)
    write('docs/adr/003-x.md', adr('003', 'proposed', body='Body 003.\n' * 9) + 'Updated.\n')  # changed the day before
    git('commit', '-qam', 'update 003', date='2026-10-19')
    git('mv', 'docs/adr/006-x.md', 'docs/adr/006-y.md')
    git('commit', '-qm', 'rename 006', date='2026-10-18')
    # The translation renames ADR-007's French file and rewrites it: git sees no rename.
    trans = 'docs/adr/007-licences-no-embedded-agpl-sspl-bsl-component.md'
    write(OLD[trans], adr('007', 'proposed', body='Entirely other words.\n' * 30))
    git('add', '.')
    git('commit', '-qm', 'add 007 under its French name', date='2026-09-10')
    git('rm', '-q', OLD[trans])
    write(trans, adr('007', 'proposed', body='Translated, nothing in common.\n' * 30))
    git('add', '.')
    git('commit', '-qm', 'translation', date='2026-10-19')
    assert git('log', '--follow', '--diff-filter=A', '--format=%cs', '--', trans) == '2026-10-19', 'rename seen by git'
    write('docs/adr/005-x.md', adr('005', 'proposed'))  # not committed yet

    def late():
        assert run('--proposals', 'late.md') == 0
        return open('late.md', encoding='utf-8').read()

    text = late()
    assert 'docs/adr/001-x.md`: added on 2026-09-19, proposed for 31 days' in text, text
    print('ok - proposal added 31 days ago reported')
    assert '002-x' not in text, text
    print('ok - proposal added 30 days ago not reported')
    assert 'docs/adr/003-x.md`: added on 2026-09-01' in text, text
    print('ok - later change: the age still counts from the addition')
    assert 'docs/adr/006-y.md`: added on 2026-09-02' in text, text
    print('ok - renamed file: the age counts from the addition under the old name (--follow)')
    assert f'{trans}`: added on 2026-09-10' in text, text
    print('ok - translated file: the age counts from the addition under its French name')
    assert '004-x' not in text and '005-x' not in text, text
    print('ok - neither an accepted ADR nor a file not yet committed')
    git('rm', '-q', 'docs/adr/001-x.md', 'docs/adr/003-x.md', 'docs/adr/006-y.md', trans)
    git('commit', '-qm', 'trial: nothing late any more')
    assert late() == '', 'report not empty without late proposals'
    print('ok - nothing late: empty report (the issue closes)')
print('OK: all cases pass.')
