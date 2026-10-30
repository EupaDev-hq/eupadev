#!/usr/bin/env python3
"""Test of eupadev.py without network: API payloads match api.ts, token file is 0600 in a 0700 folder, PKCE is S256."""
import base64
import hashlib
import importlib.util
import os
import pathlib
import stat
import sys
import tempfile

spec = importlib.util.spec_from_file_location('eupadev', pathlib.Path(__file__).with_name('eupadev.py'))
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)


def build(*argv):
    return fa.payload(fa.parser().parse_args(['--auth', 'https://auth.example', *argv]))


with tempfile.TemporaryDirectory() as d:
    text_file = pathlib.Path(d, 'text.txt')
    text_file.write_text('  Add a "plate" column.\n', encoding='utf-8')

    assert build('health') == ('GET', '/health', None)
    assert build('show', '7') == ('GET', '/requests/7', None)
    assert build('list') == ('GET', '/requests', None)
    assert build('history', '7') == ('GET', '/requests/7/messages?since=0', None)
    assert build('history', '7', '--since', '42') == ('GET', '/requests/7/messages?since=42', None)
    need = ('--need-file', str(text_file))
    assert build('submit', '--name', 'Car fleet', '--slug', 'car-fleet', '--service', 'logistics', *need) == (
        'POST', '/requests', {'type': 'creation', 'name': 'Car fleet', 'slug': 'car-fleet', 'owner_service': 'logistics', 'need': 'Add a "plate" column.'})
    assert build('submit', '--tool-id', '3', *need) == ('POST', '/requests', {'type': 'evolution', 'tool_id': 3, 'need': 'Add a "plate" column.'})
    for incomplete in (('--name', 'Car fleet', *need), ('--tool-id', '3')):
        try:
            build('submit', *incomplete)
            raise AssertionError(f'incomplete submit accepted: {incomplete}')
        except SystemExit:
            pass
    assert build('answer', '2', str(text_file)) == (
        'POST', '/messages', {'cycle_id': 2, 'message': {'type': 'requester_message', 'text': 'Add a "plate" column.'}})
    assert build('opinion', '2', 'satisfied')[2] == {'cycle_id': 2, 'message': {'type': 'scoping_feedback', 'outcome': 'satisfied'}}
    assert build('opinion', '2', 'correction', str(text_file))[2]['message']['text'] == 'Add a "plate" column.'
    digest = 'sha256:' + 'a' * 64
    assert build('decide', '2', 'gate_2', 'approved', '--digest', digest, '--extra-budget', '5')[2] == {
        'cycle_id': 2, 'message': {'type': 'decision', 'gate': 'gate_2', 'outcome': 'approved', 'digest': digest, 'budget_top_up_usd': 5.0}}
    assert build('decide', '2', 'gate_1', 'correction', '--comment-file', str(text_file))[2]['message'] == {
        'type': 'decision', 'gate': 'gate_1', 'outcome': 'correction', 'comment': 'Add a "plate" column.'}

    # Token file: 0600 even if it existed with wider rights; folder 0700; only the needed fields.
    fa.TOKEN_FILE = pathlib.Path(d, 'cache', 'eupadev', 'token.json')
    fa.TOKEN_FILE.parent.mkdir(parents=True)
    fa.TOKEN_FILE.write_text('{}')
    os.chmod(fa.TOKEN_FILE, 0o644)
    fa.save_tokens({'access_token': 'a', 'refresh_token': 'r', 'expires_in': 300, 'id_token': 'i'})
    assert stat.S_IMODE(os.stat(fa.TOKEN_FILE).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(fa.TOKEN_FILE.parent).st_mode) == 0o700
    assert fa.access_token('https://auth.example') == 'a'
    assert 'id_token' not in fa.TOKEN_FILE.read_text()

verifier, challenge = fa.pkce()
assert challenge == base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
assert fa.default_auth().startswith('https://auth.')
print('test_eupadev: OK', file=sys.stderr)
