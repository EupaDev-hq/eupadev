#!/usr/bin/env python3
"""Refuse any Docker image or CI action not pinned by digest (ROADMAP §8.14 B).

A tag (`trivy:0.75.0`) can be moved by its publisher or by whoever steals
their account; `name:tag@sha256:…` designates one precise content.
Reads the files tracked by git (or those given as arguments) and checks:
YAML key `…image:`, Dockerfile `FROM`, a runner's `docker://` label,
the image of a `docker run`, a TypeScript constant whose name contains
`IMAGE` (`IMAGE`, `REGISTRY_IMAGE`, `IMAGE_MAILPIT` = '…').
Same reason for CI actions (`uses:` of a YAML file): `actions/checkout@v4`
follows a moving tag; only `owner/repo[/path]@<full commit SHA>` is
accepted, as well as local actions (`./…`) and `docker://…` (an image,
checked above).
A value that is a variable ($…, ${{ … }}, {{ … }}) is skipped: our
golden images (rebuilt every week under the same tag, on purpose) or an
image built on the spot.

ponytail: pattern reading, not a real parser: an image written in another
form escapes the check; Renovate (docker:pinDigests) covers the rest.
"""
import re
import subprocess
import sys

DIGEST = re.compile(r'@sha256:[0-9a-f]{64}$')
PINNED_ACTION = re.compile(r'^[\w.-]+/[\w.-]+(/[^@\s]+)?@[0-9a-f]{40}$')
# `docker run` options followed by a value (the others: flags alone).
WITH_VALUE = {'-v', '--volume', '-e', '--env', '--name', '--network', '-p', '--publish',
              '-w', '--workdir', '-u', '--user', '--entrypoint', '--platform', '--mount',
              '-l', '--label', '--add-host', '--env-file', '-m', '--memory'}


def variable(value):
    return value.startswith('$') or '{{' in value


def images(path, text):
    """(line number, image) of each image written literally in the file."""
    name = path.rsplit('/', 1)[-1]
    stages = set()
    lines = text.split('\n')
    for i, line in enumerate(lines, 1):
        if name.startswith('Dockerfile'):
            m = re.match(r'\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?', line, re.I)
            if m:
                if m.group(2):
                    stages.add(m.group(2).lower())
                if m.group(1).lower() not in stages and m.group(1) != 'scratch':
                    yield i, m.group(1)
            # COPY --from=<image> (a binary taken from an image): a stage
            # named above is not an image.
            m = re.match(r'\s*COPY\s+(?:--\S+\s+)*?--from=(\S+)', line, re.I)
            if m and m.group(1).lower() not in stages and not m.group(1).isdigit():
                yield i, m.group(1)
            continue
        if name.endswith(('.yml', '.yaml', '.j2')):
            m = re.match(r'\s*(?:-\s+)?[\w-]*image:\s*["\']?([^\s"\'#]+)', line)
            if m:
                yield i, m.group(1)
            for m in re.finditer(r'docker://([^\s"\']+)', line):
                yield i, m.group(1)
        if name.endswith('.ts'):
            # Any constant name containing IMAGE: a renamed constant stays checked.
            m = re.search(r'\b\w*IMAGE\w*\s*=\s*[\'"]([^\'"]+)', line)
            if m:
                yield i, m.group(1)
        if 'docker run' in line and name.endswith(('.yml', '.yaml', '.j2', '.sh')):
            # Whole command: next lines joined while they end with a backslash.
            command, j = line, i
            while command.rstrip().endswith('\\') and j < len(lines):
                command = command.rstrip()[:-1] + ' ' + lines[j]
                j += 1
            # A Jinja variable contains spaces: keep it as one word.
            command = re.sub(r'\{\{.*?\}\}', '{{var}}', command)
            words = command.split('docker run', 1)[1].split()
            k = 0
            while k < len(words) and words[k].startswith('-'):
                k += 2 if words[k] in WITH_VALUE else 1
            if k < len(words):
                yield i, words[k].strip('"\'')


def actions(path, text):
    """(line number, action) of each `uses:` not pinned on a full commit SHA."""
    if not path.endswith(('.yml', '.yaml', '.j2')):
        return
    for i, line in enumerate(text.split('\n'), 1):
        m = re.match(r'\s*(?:-\s+)?uses:\s*["\']?([^\s"\'#]+)', line)
        if m and not (m.group(1).startswith(('./', 'docker://')) or PINNED_ACTION.match(m.group(1))):
            yield i, m.group(1)


def main(files):
    faults = 0
    for path in files:
        try:
            text = open(path, encoding='utf-8').read()
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        for line, image in images(path, text):
            if not variable(image) and not DIGEST.search(image):
                print(f'{path}:{line}: image without digest: {image} (expected name:tag@sha256:…)')
                faults += 1
        for line, action in actions(path, text):
            print(f'{path}:{line}: action without digest: {action} (expected owner/repo@<40-character SHA> # vX.Y.Z)')
            faults += 1
    print(f'{faults} image(s) or action(s) without digest.' if faults else 'OK: every image and action is pinned by digest.')
    return 1 if faults else 0


if __name__ == '__main__':
    files = sys.argv[1:] or subprocess.run(['git', 'ls-files'], capture_output=True, text=True, check=True).stdout.split('\n')
    sys.exit(main([f for f in files if f]))
