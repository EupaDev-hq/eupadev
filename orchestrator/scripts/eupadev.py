#!/usr/bin/env python3
"""EupaDev from the terminal: browser login (Keycloak client `eupadev-cli`) and calls to the engine's local API.

Python standard library only. The API is reached through the SSH tunnel (`ssh -N -L 8080:127.0.0.1:8080 ...`).
Login = authorization code + PKCE S256, loopback redirect `http://127.0.0.1:<free port>/callback` (D15).
Tokens are kept in ~/.cache/eupadev/token.json (0600) and never printed; the access token lives 5 min and is
renewed with the refresh token (rotated by Keycloak) until the SSO session ends (30 min idle) -> `login` again.

    eupadev.py login
    eupadev.py health
    eupadev.py submit --name "Fleet" --slug fleet --service logistics --need-file need.txt
    eupadev.py submit --tool-id 3 --need-file change.txt
    eupadev.py show 1
    eupadev.py answer 1 reply.txt
    eupadev.py opinion 1 satisfied | opinion 1 correction fix.txt
    eupadev.py decide 1 gate_1 approved [--comment-file c.txt] [--digest sha256:...] [--extra-budget 5]
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import pathlib
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser

CLIENT = 'eupadev-cli'
TOKEN_FILE = pathlib.Path.home() / '.cache' / 'eupadev' / 'token.json'
VARS = pathlib.Path(__file__).resolve().parents[2] / 'infra' / 'ansible' / 'group_vars' / 'all' / 'vars.yml'


def default_auth():
    """Keycloak's public address, https://auth.<base_domain> of the lab (EUPADEV_AUTH overrides it)."""
    if os.environ.get('EUPADEV_AUTH'):
        return os.environ['EUPADEV_AUTH']
    m = re.search(r'^base_domain:\s*(\S+)', VARS.read_text(encoding='utf-8'), re.M) if VARS.exists() else None
    return f'https://auth.{m.group(1)}' if m else None


def pkce():
    verifier = secrets.token_urlsafe(48)
    return verifier, base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()


def oidc(auth, path):
    return f'{auth}/realms/eupadev/protocol/openid-connect/{path}'


def post_form(url, data):
    """(status, JSON body) of a form POST; Keycloak errors are JSON too."""
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        return e.code, json.loads(body) if body.startswith('{') else {'error': body[:200]}


def save_tokens(t):
    """Writes only what is needed, mode 0600 in a 0700 folder (even if the file already existed)."""
    TOKEN_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(TOKEN_FILE.parent, 0o700)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'access_token': t['access_token'], 'refresh_token': t.get('refresh_token'),
                   'expires_at': time.time() + t.get('expires_in', 0)}, f)


def login(auth):
    verifier, challenge = pkce()
    state = secrets.token_urlsafe(16)
    result = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            if u.path != '/callback':
                self.send_error(404)
                return
            if q.get('state', [None])[0] == state:
                result.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'EupaDev: you can close this tab and go back to the terminal.\n')

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Callback)
    redirect = f'http://127.0.0.1:{server.server_port}/callback'
    url = oidc(auth, 'auth') + '?' + urllib.parse.urlencode({
        'client_id': CLIENT, 'response_type': 'code', 'scope': 'openid', 'redirect_uri': redirect,
        'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256',
        # Always ask who signs in: the browser's Keycloak session may belong to someone else (a requester).
        'prompt': 'login'})
    print(f'Opening the browser to log in. If nothing opens, paste this address into it:\n{url}', file=sys.stderr)
    webbrowser.open(url)
    server.timeout = 300
    deadline = time.time() + 300
    while not result and time.time() < deadline:
        server.handle_request()
    server.server_close()
    if 'code' not in result:
        sys.exit(f'login failed: {result.get("error_description") or result.get("error") or "no answer within 5 minutes"}')
    status, t = post_form(oidc(auth, 'token'), {'grant_type': 'authorization_code', 'client_id': CLIENT,
                                               'code': result['code'], 'redirect_uri': redirect, 'code_verifier': verifier})
    if status != 200:
        sys.exit(f'login failed: {t.get("error")} {t.get("error_description", "")}')
    save_tokens(t)
    print('Logged in.', file=sys.stderr)


def access_token(auth):
    """A valid access token: the saved one, or renewed with the refresh token; else asks to log in again."""
    try:
        t = json.loads(TOKEN_FILE.read_text())
    except (OSError, ValueError):
        sys.exit('not logged in: run  eupadev.py login')
    if t['expires_at'] - 30 > time.time():
        return t['access_token']
    if t.get('refresh_token'):
        status, new = post_form(oidc(auth, 'token'), {'grant_type': 'refresh_token', 'client_id': CLIENT,
                                                     'refresh_token': t['refresh_token']})
        if status == 200:
            save_tokens(new)
            return new['access_token']
    sys.exit('session expired: run  eupadev.py login')


def call(api, method, path, token=None, body=None):
    """Calls the API, prints the HTTP status and the JSON answer (RFC 9457 problem on error); exit code 1 on error."""
    headers = {'X-EupaDev': '1'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = None
    if body is not None:
        headers.update({'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())})
        data = json.dumps(body).encode()
    req = urllib.request.Request(api + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, text = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode(errors='replace')
    except urllib.error.URLError as e:
        sys.exit(f'API unreachable at {api} ({e.reason}): is the SSH tunnel open?')
    try:
        text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    except ValueError:
        pass
    print(f'HTTP {status}\n{text}')
    return 0 if status < 400 else 1


def read_text(path):
    return pathlib.Path(path).read_text(encoding='utf-8').strip() if path else None


def payload(a):
    """(method, path, body) of an API command, built from the parsed arguments."""
    if a.cmd == 'health':
        return 'GET', '/health', None
    if a.cmd == 'show':
        return 'GET', f'/requests/{a.cycle}', None
    if a.cmd == 'list':
        return 'GET', '/requests', None
    if a.cmd == 'history':
        return 'GET', f'/requests/{a.cycle}/messages?since={a.since}', None
    if a.cmd == 'submit':
        need = read_text(a.need_file)
        if a.tool_id is not None:
            return 'POST', '/requests', {'type': 'evolution', 'tool_id': a.tool_id, 'need': need}
        if not (a.name and a.slug and a.service):
            sys.exit('submit: --name, --slug and --service (new tool) or --tool-id (change to an existing tool)')
        return 'POST', '/requests', {'type': 'creation', 'name': a.name, 'slug': a.slug, 'owner_service': a.service, 'need': need}
    if a.cmd == 'answer':
        message = {'type': 'requester_message', 'text': read_text(a.file)}
    elif a.cmd in ('opinion', 'preview'):
        message = {'type': 'scoping_feedback' if a.cmd == 'opinion' else 'preview_feedback', 'outcome': a.outcome}
        if a.file:
            message['text'] = read_text(a.file)
    else:  # decide
        message = {'type': 'decision', 'gate': a.gate, 'outcome': a.outcome}
        if a.comment_file:
            message['comment'] = read_text(a.comment_file)
        if a.digest:
            message['digest'] = a.digest
        if a.extra_budget is not None:
            message['budget_top_up_usd'] = a.extra_budget
    return 'POST', '/messages', {'cycle_id': a.cycle, 'message': message}


def parser():
    p = argparse.ArgumentParser(description='EupaDev: log in and drive a cycle through the local API.')
    p.add_argument('--api', default=os.environ.get('EUPADEV_API', 'http://localhost:8080'), help='API address (SSH tunnel)')
    p.add_argument('--auth', default=default_auth(), help='Keycloak address (default: https://auth.<base_domain>)')
    s = p.add_subparsers(dest='cmd', required=True)
    s.add_parser('login', help='log in through the browser')
    s.add_parser('health', help='GET /health')
    x = s.add_parser('submit', help='new request (POST /requests)')
    x.add_argument('--name')
    x.add_argument('--slug', help='lowercase letters, digits and dashes')
    x.add_argument('--service', help='owning department')
    x.add_argument('--tool-id', type=int, help='change to an existing tool instead of a new one')
    x.add_argument('--need-file', required=True, help='UTF-8 text file: what the tool must do (or what to change); first chat message')
    x = s.add_parser('show', help="a request's state (GET /requests/<cycle>)")
    x.add_argument('cycle', type=int)
    s.add_parser('list', help='my requests (GET /requests; an admin sees all)')
    x = s.add_parser('history', help="a request's chat (GET /requests/<cycle>/messages)")
    x.add_argument('cycle', type=int)
    x.add_argument('--since', type=int, default=0, help='only messages with an id above this one')
    x = s.add_parser('answer', help="requester's message, text from a file (requester_message)")
    x.add_argument('cycle', type=int)
    x.add_argument('file')
    x = s.add_parser('opinion', help='opinion on the mock-up (scoping_feedback)')
    x.add_argument('cycle', type=int)
    x.add_argument('outcome', choices=['satisfied', 'correction'])
    x.add_argument('file', nargs='?', help='text file (what to correct)')
    x = s.add_parser('preview', help='opinion on the Preview (preview_feedback)')
    x.add_argument('cycle', type=int)
    x.add_argument('outcome', choices=['satisfied', 'bug', 'new_capability'])
    x.add_argument('file', nargs='?', help='text file (the bug or the new capability)')
    x = s.add_parser('decide', help='gate decision (decision)')
    x.add_argument('cycle', type=int)
    x.add_argument('gate', help='gate id, as shown by `show` (state)')
    x.add_argument('outcome', choices=['approved', 'correction', 'refused', 'scope_change'])
    x.add_argument('--comment-file', help='required for correction and scope_change')
    x.add_argument('--digest', help='sha256:... (gate_2: candidate_digest shown by `show`)')
    x.add_argument('--extra-budget', type=float, help='extra budget in USD (with approved)')
    return p


def main():
    a = parser().parse_args()
    if a.cmd != 'health' and not a.auth:
        sys.exit('Keycloak address unknown: pass --auth https://auth.<domain>')
    if a.cmd == 'login':
        return login(a.auth)
    method, path, body = payload(a)
    return call(a.api, method, path, None if a.cmd == 'health' else access_token(a.auth), body)


if __name__ == '__main__':
    sys.exit(main())
