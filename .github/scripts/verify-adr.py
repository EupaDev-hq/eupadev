#!/usr/bin/env python3
"""ADR checker (format rule: docs/adr/026-*.md, which supersedes 011-*.md).

Usage (from the repository root):
  verify-adr.py                   ADRs consistent + ROADMAP.md registry up to date
                                  (between the markers adr-registry:start / adr-registry:end)
  verify-adr.py --base REF        also: nothing deleted, ADRs not "proposed" in REF changed only
                                  within the allowed limits, "check" present on every ADR that
                                  is new or leaves "proposed"
  verify-adr.py --base-ci         same, base found from the CI variables (BASE_PR, BEFORE,
                                  GITHUB_REF); refused if not found on main
  verify-adr.py --write           regenerates the registry in ROADMAP.md
  verify-adr.py --proposals FILE  only: writes to FILE the list of "proposed" ADRs added in git
                                  more than 30 days ago (empty otherwise); run by the scheduled
                                  workflow adr-proposals.yml
  --today YYYY-MM-DD              forced current date (tests)
  --new-product-name NAME         one-time product rename (ADR-026): passed by adr.yml in the
                                  rename commit; harmless afterwards (no old name left to replace)

The two one-time exceptions of ADR-026 are applied to the base before comparing:
  - translation: a base ADR that still has ADR-011's French vocabulary (its status) is read under
    its English file name (RENAMED) with English status and check, and its title and body may
    change; once the base is English, nothing is mapped and the freeze applies again;
  - product rename: with --new-product-name, the old name (ForgeAgent, forgeagent, FORGEAGENT) is
    replaced by the new one in the base title, body and file name; the tree must then match
    exactly (the file may keep its name).

ponytail: frontmatter read line by line (key: value), not real YAML; enough for the flat
template of docs/adr/template.md. A line starting with "#" is a comment; a "#" inside a value
is part of the value.
"""
import datetime
import glob
import os
import re
import subprocess
import sys

DIR = 'docs/adr'
NAME = re.compile(r'^(\d{3})-[a-z0-9-]+\.md$')
STATUS = re.compile(r'^(proposed|accepted|rejected|withdrawn|superseded by ADR-(\d{3}))$')
FROZEN = ('adr', 'date', 'decision-makers', 'supersedes', 'related')
# Outside the frozen fields: goes from "planned" to "in-place" when the check arrives.
CHECK = ('in-place', 'partial', 'planned', 'none')
PROPOSED_DELAY = 30  # days since the file was added in git after which a "proposed" ADR is reported
ROADMAP = 'ROADMAP.md'
START, END = '<!-- adr-registry:start -->', '<!-- adr-registry:end -->'
OLD_PRODUCT = 'ForgeAgent'

# One-time translation (ADR-026): ADR-011's French vocabulary and file names, read only in the base.
FR_STATUS = re.compile(r'^(proposé|accepté|rejeté|retiré|remplacé par ADR-\d{3})$')
FR_KEY, FR_SUPERSEDED = 'controle', 'remplacé par'
FR_STATUSES = {'proposé': 'proposed', 'accepté': 'accepted', 'rejeté': 'rejected', 'retiré': 'withdrawn'}
FR_CHECKS = {'en-place': 'in-place', 'partiel': 'partial', 'prévu': 'planned', 'aucun': 'none'}
FR_VALUES = {**FR_STATUSES, **FR_CHECKS}
RENAMED = {f'{DIR}/{old}': f'{DIR}/{new}' for old, new in (
    ('000-format-et-cycle-de-vie-des-adr.md', '000-adr-format-and-lifecycle.md'),
    ('001-appliance-sur-vm-fournies-par-la-dsi.md', '001-appliance-on-vms-provided-by-the-it-department.md'),
    ('002-une-seule-pile-et-deux-profils-d-exploitation.md', '002-one-stack-and-two-operating-profiles.md'),
    ('003-cles-et-modelisation-de-la-base-des-outils.md', '003-keys-and-modelling-of-the-tools-database.md'),
    ('004-migrations-immuables-sans-down-controlees-par-squawk.md', '004-immutable-migrations-without-down-checked-by-squawk.md'),
    ('005-images-et-actions-ci-designees-par-empreinte.md', '005-images-and-ci-actions-pinned-by-digest.md'),
    ('006-moteur-d-agent-interchangeable.md', '006-interchangeable-agent-engine.md'),
    ('007-licences-aucun-composant-embarque-agpl-sspl-bsl.md', '007-licences-no-embedded-agpl-sspl-bsl-component.md'),
    ('008-garder-gitea-passer-a-incus-et-opentofu.md', '008-keep-gitea-move-to-incus-and-opentofu.md'),
    ('009-maquette-de-cadrage-servie-en-fichiers-statiques.md', '009-scoping-mockup-served-as-static-files.md'),
    ('010-labo-sur-incus-et-opentofu-avant-la-publication.md', '010-lab-on-incus-and-opentofu-before-publication.md'),
    ('011-format-et-cycle-de-vie-des-adr-v2.md', '011-adr-format-and-lifecycle-v2.md'),
    ('012-forge-rester-sur-gitea-porte-ouverte-vers-forgejo.md', '012-forge-stay-on-gitea-door-open-to-forgejo.md'),
    ('013-moteur-d-agent-interchangeable-claude-code-binaire-signe.md', '013-interchangeable-agent-engine-claude-code-signed-binary.md'),
    ('014-deployeur-des-outils.md', '014-tool-deployer.md'),
    ('015-domaine-des-previews-ordre-de-preference.md', '015-preview-domain-order-of-preference.md'),
    ('016-registre-npm-en-lecture-seule-pour-les-agents.md', '016-read-only-npm-registry-for-agents.md'),
    ('017-identite-des-personnes.md', '017-identity-of-people.md'),
    ('018-les-instructions-viennent-de-l-image-signee.md', '018-instructions-come-from-the-signed-image.md'),
    ('019-socle-commun-des-outils-generes-et-dependances-autorisees.md', '019-common-core-of-generated-tools-and-allowed-dependencies.md'),
    ('020-relecteurs-en-lecture-seule-par-le-harnais.md', '020-read-only-reviewers-enforced-by-the-harness.md'),
    ('021-un-seul-agent-builder-ecrit-le-code.md', '021-a-single-builder-agent-writes-the-code.md'),
    ('023-socle-distributed-through-the-forge-npm-registry.md', '023-core-distributed-through-the-forge-npm-registry.md'),
)}


def read(text):
    """(frontmatter, body) of an ADR; empty frontmatter if missing."""
    m = re.match(r'---\n(.*?)\n---\n(.*)', text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).split('\n'):
        if not line.strip() or line.startswith('#'):
            continue
        key, _, value = line.partition(':')
        meta[key.strip()] = value.strip()
    return meta, m.group(2)


def adrs(files):
    """{path: (meta, body)} for the given NNN-*.md files {path: text}."""
    return {p: read(t) for p, t in files.items() if NAME.match(os.path.basename(p))}


def consistency(tree, today):
    faults, by_num = [], {}
    values = ' | '.join(CHECK)
    for path, (meta, _) in sorted(tree.items()):
        num = NAME.match(os.path.basename(path)).group(1)
        if meta.get('adr') != num:
            faults.append(f'{path}: "adr: {meta.get("adr")}" ≠ file number {num}')
        if num in by_num:
            faults.append(f'{path}: number {num} already taken by {by_num[num][0]}')
        by_num[num] = (path, meta)
        if not STATUS.match(meta.get('status', '')):
            faults.append(f'{path}: unknown status "{meta.get("status")}"')
        if not meta.get('title'):
            faults.append(f'{path}: missing title')
        check = meta.get('check', '')
        if check and check not in CHECK:
            faults.append(f'{path}: unknown "check: {check}" ({values})')
        date = meta.get('date', '')
        if meta.get('status') == 'proposed':
            # The date is the date of the decision: it does not exist yet.
            if date:
                faults.append(f'{path}: "date: {date}" on a proposed ADR (leave it empty: '
                              'the date of the decision is filled at acceptance)')
            if not check:
                faults.append(f'{path}: missing "check" ({values})')
            continue
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
                raise ValueError
            if datetime.date.fromisoformat(date) > today:
                faults.append(f'{path}: date "{date}" in the future (date of the decision)')
        except ValueError:
            faults.append(f'{path}: invalid date "{date}" (YYYY-MM-DD, date of the decision)')
    for num, (path, meta) in by_num.items():
        m = STATUS.match(meta.get('status', ''))
        if m and m.group(2):
            new = by_num.get(m.group(2))
            if not new or new[1].get('supersedes') != f'ADR-{num}':
                faults.append(f'{path}: superseded by ADR-{m.group(2)}, which does not declare "supersedes: ADR-{num}"')
            elif new[1].get('status') in ('proposed', 'rejected'):
                # The successor must have been accepted (it may since have been superseded in turn).
                faults.append(f'{path}: superseded by ADR-{m.group(2)}, which is "{new[1].get("status")}" '
                              '(accept it first)')
        sup = meta.get('supersedes', '')
        if sup and meta.get('status') == 'accepted':
            old = by_num.get(sup[4:]) if re.fullmatch(r'ADR-\d{3}', sup) else None
            if not old or old[1].get('status') != f'superseded by ADR-{num}':
                faults.append(f'{path}: supersedes {sup}, whose status must be "superseded by ADR-{num}"')
    return faults


def as_today(base, tree, new_product=None):
    """The base ADRs seen through ADR-026's one-time exceptions: {path: (meta, body, translated)}."""
    out = {}
    for path, (meta, body) in base.items():
        meta, translated = dict(meta), bool(FR_STATUS.match(meta.get('status', '')))
        if translated:
            path = RENAMED.get(path, path)
            s = meta['status']
            meta['status'] = FR_VALUES.get(s) or s.replace(FR_SUPERSEDED, 'superseded by')
            if FR_KEY in meta:
                v = meta.pop(FR_KEY)
                meta['check'] = FR_VALUES.get(v, v)
        if new_product:
            # ponytail: one parameter, three casings derived from it; a name whose identifier form is
            # not its lower case (a space, a hyphen) needs one pair per casing.
            def sub(text):
                for old, new in ((OLD_PRODUCT, new_product), (OLD_PRODUCT.lower(), new_product.lower()),
                                 (OLD_PRODUCT.upper(), new_product.upper())):
                    text = text.replace(old, new)
                return text
            body, meta['title'] = sub(body), sub(meta.get('title', ''))
            renamed = os.path.join(os.path.dirname(path), sub(os.path.basename(path)))
            path = renamed if renamed in tree else path
        out[path] = (meta, body, translated)
    return out


def compare(base, tree, new_product=None):
    """Faults of the tree `tree` against the base ADRs."""
    faults = []
    base = as_today(base, tree, new_product)
    for path, (meta, _) in sorted(tree.items()):
        # New ADR, or one leaving "proposed": "check" is mandatory (for a "proposed" one,
        # consistency() already requires it). ADRs that left "proposed" before this field
        # existed (ADR-000, ADR-008) have none.
        meta0 = base.get(path, ({}, '', False))[0]
        if (path not in base or meta0.get('status') == 'proposed') \
                and meta.get('status') != 'proposed' and not meta.get('check'):
            faults.append(f'{path}: missing "check" ({" | ".join(CHECK)})')
    for path, (meta0, body0, translated) in sorted(base.items()):
        if path not in tree:
            faults.append(f'{path}: deleted or renamed (an ADR is never deleted)')
            continue
        if meta0.get('status') == 'proposed':
            continue
        meta, body = tree[path]
        for key in FROZEN:
            if meta.get(key) != meta0.get(key):
                faults.append(f'{path}: "{key}" changed ({meta0.get(key)} → {meta.get(key)})')
        s0, s = meta0.get('status'), meta.get('status', '')
        if s != s0 and not (s0 == 'accepted' and (s == 'withdrawn' or s.startswith('superseded by '))):
            faults.append(f'{path}: status "{s0}" → "{s}" forbidden')
        if not translated and (meta.get('title') != meta0.get('title') or body != body0):
            faults.append(f'{path}: title or body changed while "{s0}" (typos stay); '
                          'write a new ADR that supersedes it')
    return faults


def registry(tree):
    lines = ['| ADR | Title | Status | Date | Check |', '|---|---|---|---|---|']
    for path, (meta, _) in sorted(tree.items()):
        title = meta.get('title', '').replace('|', '\\|')
        lines.append(f'| [ADR-{meta.get("adr")}]({path}) | {title} | {meta.get("status")} | '
                     f'{meta.get("date") or "—"} | {meta.get("check") or "—"} |')
    return '\n'.join(lines)


def roadmap_with(text, table):
    m = re.search(re.escape(START) + r'\n.*?' + re.escape(END), text, re.S)
    if not m:
        return None
    return text[:m.start()] + f'{START}\n{table}\n{END}' + text[m.end():]


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout


def added(path):
    """Committer date of the oldest commit that added the file, renames followed; None if not committed.

    `--follow` also follows copies (an ADR started from the template or from another ADR): -M90%
    keeps plain renames and the product rename, not a copy rewritten into a new ADR. The
    translation's renames are looked up by their old name: the content changed language in the
    same commit, so git does not see them as renames.
    """
    dates = git('log', '--follow', '-M90%', '--diff-filter=A', '--format=%cs', '--', path).split()
    old = next((o for o, n in RENAMED.items() if n == path), None)
    if old:
        dates += git('log', '--diff-filter=A', '--format=%cs', '--', old).split()
    return min(dates) if dates else None


def proposals(tree, today):
    """[(path, date added, days)] of the "proposed" ADRs added in git more than 30 days ago."""
    late = []
    for path, (meta, _) in sorted(tree.items()):
        if meta.get('status') != 'proposed':
            continue
        date = added(path)
        if not date:
            continue
        days = (today - datetime.date.fromisoformat(date)).days
        if days > PROPOSED_DELAY:
            late.append((path, date, days))
    return late


def base_ci(variables):
    """Base commit in CI: the pull request base, else the push's `before`.

    `before` missing (new branch: 000…) or not found (force-push, rewritten history): on a
    branch other than main, compare with the fork point from main; on main, that point would be
    HEAD itself (nothing compared) → None = refused.
    """
    base = variables.get('BASE_PR') or variables.get('BEFORE') or ''
    if base and subprocess.run(['git', 'cat-file', '-e', f'{base}^{{commit}}'], capture_output=True).returncode == 0:
        return base
    if variables.get('GITHUB_REF') == 'refs/heads/main':
        return None
    return git('merge-base', 'origin/main', 'HEAD').strip()


def main(args):
    today = datetime.date.today()
    if '--today' in args:
        today = datetime.date.fromisoformat(args[args.index('--today') + 1])
    new_product = args[args.index('--new-product-name') + 1] if '--new-product-name' in args else None
    tree = adrs({p: open(p, encoding='utf-8').read() for p in glob.glob(f'{DIR}/*.md')})
    if '--proposals' in args:
        late = proposals(tree, today)
        text = ''.join(f'- `{p}`: added on {d}, proposed for {n} days\n' for p, d, n in late)
        if text:
            text = (f'"proposed" ADRs added in git more than {PROPOSED_DELAY} days ago: '
                    'accept or reject them (and write a new ADR if needed); format rule: '
                    '`docs/adr/026-adr-format-and-lifecycle-v3.md`.\n\n' + text)
        open(args[args.index('--proposals') + 1], 'w', encoding='utf-8').write(text)
        print(text or f'No ADR proposed for more than {PROPOSED_DELAY} days.')
        return 0
    faults = consistency(tree, today)
    ref = None
    if '--base' in args:
        ref = args[args.index('--base') + 1]
    elif '--base-ci' in args:
        ref = base_ci(os.environ)
        if ref is None:
            faults.append('push to main without a known "before" commit (force-push or rewritten history): '
                          'nothing to compare with, refused')
        else:
            print(f'Base commit: {ref}')
    if ref:
        paths = git('ls-tree', '-r', '--name-only', ref, '--', f'{DIR}/').split()
        faults += compare(adrs({p: git('show', f'{ref}:{p}') for p in paths}), tree, new_product)
    text = open(ROADMAP, encoding='utf-8').read()
    expected = roadmap_with(text, registry(tree))
    if expected is None:
        faults.append(f'{ROADMAP}: markers {START} / {END} not found')
    elif '--write' in args:
        open(ROADMAP, 'w', encoding='utf-8').write(expected)
    elif expected != text:
        faults.append(f'{ROADMAP}: ADR registry out of date (run .github/scripts/verify-adr.py --write)')
    for f in faults:
        print(f)
    print(f'{len(faults)} fault(s) in the ADRs.' if faults else f'OK: {len(tree)} ADRs, registry up to date.')
    return 1 if faults else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
