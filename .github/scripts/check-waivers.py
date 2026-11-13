#!/usr/bin/env python3
"""Every way to silence a check needs a dated line in .github/exceptions.txt.

    check-waivers.py [REV]

Counts, file by file, the markers below in the tracked files of HEAD and
compares each count with the registry read at REV (default HEAD; the CI
passes main, so a branch cannot approve its own waiver). Red when a file
holds more markers than its unexpired registry lines allow, or when a line
is malformed. Same registry format as the tools' guard-rails
(tool-template/.gitea/checks/guard-rails.sh):

    # expires;file;pattern;count;reason
    2027-05-11;infra/ansible/verify-forge.yml;noqa;3;git module cannot pass an HTTP header

A line expires at most one year ahead; once past, it no longer counts and
the check is red again until the waiver is fixed or justified anew.
Not counted: prose (Markdown, docs/), this script, its test, the registry,
and the files that hold the markers as data to detect (the tools'
guard-rails and its lab trial).
"""
import datetime
import subprocess
import sys

REGISTRY = '.github/exceptions.txt'
PATTERNS = [
    'noqa', 'nosem', 'noopengrep', 'gitleaks:allow', 'hadolint ignore', 'shellcheck disable',
    'eslint-disable', '@ts-ignore', '@ts-nocheck', '@ts-expect-error', '.skip(', '.only(', '.todo(',
    'continue-on-error', 'ignore_errors:', 'failed_when: false', '|| true', 'squawk-ignore',
    'type: ignore', 'pragma: no cover', 'c8 ignore', 'istanbul ignore',
]
NOT_COUNTED = [
    ':!*.md', ':!docs/**', ':!' + REGISTRY, ':!.github/scripts/check-waivers.py',
    ':!.github/scripts/test_check_waivers.py', ':!.github/workflows/waivers.yml', ':!tool-template/.gitea/checks/guard-rails.sh',
    ':!infra/ansible/verify-template.yml', ':!**/pnpm-lock.yaml',
]


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=False)


def found():
    """{(pattern, file): count} in HEAD, case-insensitive."""
    counts = {}
    for p in PATTERNS:
        r = git('grep', '-c', '-i', '-F', '-e', p, 'HEAD', '--', '.', *NOT_COUNTED)
        if r.returncode not in (0, 1):
            sys.exit(f'git grep failed: {r.stderr}')
        for line in r.stdout.splitlines():
            path, n = line.removeprefix('HEAD:').rsplit(':', 1)
            counts[(p, path)] = int(n)
    return counts


def allowed(text, today):
    """({(pattern, file): count} of the valid unexpired lines, [errors], [notes])."""
    allow, errors, notes = {}, [], []
    limit = today + datetime.timedelta(days=366)
    for num, line in enumerate(text.splitlines(), 1):
        line = line.rstrip('\r')
        if not line.strip() or line.startswith('#'):
            continue
        fields = line.split(';', 4)
        if len(fields) < 5:
            errors.append(f'line {num}: fewer than 5 fields (expires;file;pattern;count;reason): "{line}"')
            continue
        expires, path, pattern, count, reason = fields
        try:
            day = datetime.date.fromisoformat(expires)
        except ValueError:
            errors.append(f'line {num}: invalid expiry date "{expires}" (YYYY-MM-DD)')
            continue
        if day > limit:
            errors.append(f'line {num}: expires on {expires}, more than a year ahead')
        elif not path or pattern not in PATTERNS:
            errors.append(f'line {num}: empty file or unknown pattern "{pattern}"')
        elif not count.isdigit() or not reason.strip():
            errors.append(f'line {num}: count not an integer or empty reason')
        elif day < today:
            notes.append(f'line {num} expired on {expires}, no longer counts: "{line}"')
        else:
            allow[(pattern, path)] = allow.get((pattern, path), 0) + int(count)
    return allow, errors, notes


def main():
    rev = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'
    r = git('show', f'{rev}:{REGISTRY}')
    text = r.stdout if r.returncode == 0 else ''
    print(f'Registry: {REGISTRY} at {rev}' + ('' if r.returncode == 0 else ' (missing: no waiver allowed)'))
    allow, errors, notes = allowed(text, datetime.date.today())
    for n in notes:
        print(n)
    for (p, path), n in sorted(found().items()):
        if n > allow.get((p, path), 0):
            errors.append(f'"{p}" in {path}: {n} found, {allow.get((p, path), 0)} allowed')
    for e in errors:
        print(f'WAIVER {e}')
    if errors:
        print(f'A waiver needs a line in {REGISTRY}, merged into main first: expires;file;pattern;count;reason.')
        sys.exit(1)
    print('OK: every waiver is registered and unexpired.')


if __name__ == '__main__':
    main()
