#!/usr/bin/env python3
"""Guard of the guard: fails if the reading of `uses:` or images loosens."""
import importlib.util
import sys

sys.dont_write_bytecode = True  # no __pycache__ in .github/scripts
import pathlib

spec = importlib.util.spec_from_file_location('v', pathlib.Path(__file__).with_name('verify-digests.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

SHA = '11d5960a326750d5838078e36cf38b85af677262'


def refused(line):
    return [a for _, a in v.actions('w.yml', line)]


assert refused('      - uses: actions/checkout@v4'), 'tag accepted'
assert refused('        uses: "actions/upload-artifact@v4.6.2"'), 'quoted tag accepted'
assert refused('      - uses: actions/checkout@11d5960'), 'short SHA accepted'
assert refused(f'      - uses: actions/checkout@{SHA}0'), 'too long SHA accepted'
assert not refused(f'      - uses: actions/checkout@{SHA} # v4.4.0'), 'full SHA refused'
assert not refused(f'      - uses: github/codeql-action/init@{SHA}'), 'pinned sub-path refused'
assert not refused('      - uses: ./.gitea/actions/local'), 'local action refused'
assert not refused('      - uses: docker://alpine:3.22@sha256:' + '0' * 64), 'docker:// refused'
assert not list(v.actions('notes.md', '- uses: actions/checkout@v4')), 'non-YAML file read'
print('OK: test of the action check.')


def images(text):
    return [img for _, img in v.images('Dockerfile', text)]


DIG = '@sha256:' + '0' * 64
assert images('COPY --from=docker:29-cli /usr/local/bin/docker /x') == ['docker:29-cli'], 'COPY --from not read'
assert images(f'COPY --chown=1:1 --from=docker:29-cli{DIG} /a /b') == [f'docker:29-cli{DIG}'], 'COPY --from after an option not read'
assert images('FROM node:22' + DIG + ' AS deps\nCOPY --from=deps /app /app') == ['node:22' + DIG], 'named stage taken for an image'
assert images('COPY --from=0 /a /b') == [], 'numbered stage taken for an image'
assert not [i for i in images(f'COPY --from=docker:29-cli{DIG} /a /b') if not v.DIGEST.search(i)], 'pinned COPY --from refused'
print('OK: test of the COPY --from check.')


def ts(text):
    return [img for _, img in v.images('x.ts', text)]


# Trap met during the English switch: a constant renamed from IMAGE escaped the check.
for const in ('IMAGE', 'REGISTRY_IMAGE', 'IMAGE_MAILPIT'):
    assert ts(f"export const {const} = 'postgres:18';") == ['postgres:18'], f'{const} not read'
assert ts('const IMAGE = (reason: string) => `x`;') == [], 'function taken for an image'
print('OK: test of the TypeScript image constants.')
