// Local sign-in of the discovery mode (ADR-028): driven by the engine's own client code (`WebSignIn`, ADR-024) and
// verified by the engine's own `Authenticator` (ADR-017), so that the engine needs no change. Without a database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Authenticator } from '../src/auth.ts';
import { text } from '../src/i18n.ts';
import { optionsFromEnv, passwordVariable, startLocalSignIn, type LocalSignIn } from '../src/local-signin.ts';
import { LOGIN_COOKIE, SignInRefused, WebSignIn } from '../src/web-session.ts';

const ISSUER = 'http://localhost:8081/realms/eupadev';
const CLIENT = { clientId: 'eupadev-web', clientSecret: 'web-test-password', redirectUrl: 'http://localhost:8080/auth/callback' };
const log: string[] = [];
let issuer: LocalSignIn;
let web: WebSignIn;
let auth: Authenticator;
// What install.sh generates and shows once on the terminal (ADR-028).
const passwords: Record<string, string> = { requester: randomBytes(12).toString('hex'), admin: randomBytes(12).toString('hex') };

const cookieValue = (setCookie: string) => setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
const authUrl = (issuerBase: string, location: string) => location.replace(ISSUER, `${issuerBase}/realms/eupadev`);
/** The browser: GET the form, POST the credentials, read where it is sent back. */
async function signIn(account: string, password: string, next = '/'): Promise<{ transaction: string; form: Response; back: Response }> {
  const start = await web.start(next, 'fr');
  const url = authUrl(issuer.url, start.location);
  const form = await fetch(url, { redirect: 'manual' });
  const back = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: account, password }) });
  return { transaction: cookieValue(start.cookie), form, back };
}

before(async () => {
  issuer = await startLocalSignIn({ issuer: ISSUER, ...CLIENT, passwords, port: 0, log: (l) => log.push(l) });
  web = new WebSignIn({ ...CLIENT, tokenUrl: issuer.jwksUrl.replace(/certs$/, 'token') }, ISSUER);
  auth = new Authenticator({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: 'eupadev-api', pauseJwksMs: 0 });
});
after(async () => { await issuer.stop(); });

test('the passwords come from the installer: never in the log, nothing written, a missing one refuses to start', async () => {
  assert.ok(log.length > 0);
  for (const p of Object.values(passwords)) assert.ok(!log.some((l) => l.includes(p)), 'no password in the log');
  assert.ok(!log.some((l) => /password:/.test(l)), log.join('\n'));
  await assert.rejects(startLocalSignIn({ issuer: ISSUER, ...CLIENT, passwords: { requester: passwords['requester']! }, port: 0, log: () => {} }), /SIGNIN_ADMIN_PASSWORD missing/);
  await assert.rejects(startLocalSignIn({ issuer: ISSUER, ...CLIENT, passwords: { ...passwords, admin: ' ' }, port: 0, log: () => {} }), /SIGNIN_ADMIN_PASSWORD missing/);
  assert.equal(passwordVariable('requester'), 'SIGNIN_REQUESTER_PASSWORD');
});

test('JWKS: one ES256 key, served under Keycloak\'s path of the realm', async () => {
  const r = await fetch(issuer.jwksUrl);
  assert.equal(r.status, 200);
  const { keys } = (await r.json()) as { keys: { alg: string; kid: string; use: string; d?: string }[] };
  assert.equal(keys.length, 1);
  assert.equal(keys[0]!.alg, 'ES256');
  assert.equal(keys[0]!.use, 'sig');
  assert.equal(keys[0]!.d, undefined, 'public part only');
});

test('the engine\'s flow end to end: form in the page\'s language, code, token exchange with PKCE and client password, hats from the token', async () => {
  for (const [account, roles] of [['requester', ['requester']], ['admin', ['admin']]] as const) {
    const { transaction, form, back } = await signIn(account, passwords[account]!, '/cycles/3');
    assert.equal(form.status, 200);
    assert.equal(form.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(form.headers.get('content-security-policy') ?? '', /form-action 'self' http:\/\/localhost:8080;/);
    const html = await form.text();
    assert.ok(html.includes('<html lang="fr">') && html.includes(text('fr', 'signin.password')), 'ui_locales=fr → French form');
    assert.ok(html.includes(text('fr', 'signin.notice')), 'the discovery notice is on the form too');
    assert.equal(back.status, 303);
    const location = new URL(back.headers.get('location')!);
    assert.equal(`${location.origin}${location.pathname}`, CLIENT.redirectUrl);
    assert.ok(location.searchParams.get('code'));
    const end = await web.finish(transaction, location.searchParams);
    assert.equal(end.returnPath, '/cycles/3');
    const principal = await auth.verifier(end.accessToken);
    assert.deepEqual(principal, { issuer: ISSUER, subject: account, mail: `${account}@eupadev.invalid`, name: account === 'admin' ? 'Sam Bernard' : 'Alex Martin', roles });
    // The code is single use.
    await assert.rejects(web.finish(transaction, location.searchParams), SignInRefused);
  }
});

test('refusals: wrong password or unknown account (same answer), wrong client password, foreign redirect, bad request, unknown route', async () => {
  for (const [account, password] of [['admin', 'not-the-password'], ['nobody', passwords['admin']!], ['admin', '']]) {
    const { back } = await signIn(account!, password!);
    assert.equal(back.status, 401, account);
    assert.ok((await back.text()).includes('role="alert"'));
  }
  // Right code, wrong client password at the token endpoint.
  const other = new WebSignIn({ ...CLIENT, clientSecret: 'wrong', tokenUrl: issuer.jwksUrl.replace(/certs$/, 'token') }, ISSUER);
  const start = await other.start('/');
  const back = await fetch(authUrl(issuer.url, start.location), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'admin', password: passwords['admin']! }) });
  assert.equal(back.status, 303);
  await assert.rejects(other.finish(cookieValue(start.cookie), new URL(back.headers.get('location')!).searchParams), SignInRefused);
  // The authorization request itself: another redirect URI, another client, no PKCE.
  const good = new URL(authUrl(issuer.url, (await web.start('/')).location));
  for (const [name, value] of [['redirect_uri', 'http://evil.example/auth/callback'], ['client_id', 'other'], ['code_challenge_method', 'plain'], ['response_type', 'token']]) {
    const u = new URL(good);
    u.searchParams.set(name!, value!);
    const r = await fetch(u, { redirect: 'manual' });
    assert.equal(r.status, 400, name);
    assert.match(await r.text(), /authorization request refused/);
  }
  assert.equal((await fetch(`${issuer.url}/realms/eupadev/protocol/openid-connect/userinfo`)).status, 404);
  assert.equal((await fetch(`${issuer.url}/realms/other/protocol/openid-connect/certs`)).status, 404);
});

test('logout: back to the page\'s origin only', async () => {
  const end = new URL(web.endSessionUrl());
  const r = await fetch(authUrl(issuer.url, end.href), { redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), 'http://localhost:8080/');
  end.searchParams.set('post_logout_redirect_uri', 'http://evil.example/');
  assert.equal((await fetch(authUrl(issuer.url, end.href), { redirect: 'manual' })).status, 400);
});

test('never beyond the loopback: a public issuer or redirect URL is refused at startup; the container reads the engine\'s variables', async () => {
  await assert.rejects(startLocalSignIn({ issuer: 'https://auth.example.test/realms/eupadev', ...CLIENT, passwords, port: 0, log: () => {} }), /OIDC_ISSUER: a loopback URL/);
  await assert.rejects(startLocalSignIn({ issuer: ISSUER, ...CLIENT, redirectUrl: 'https://chat.example.test/auth/callback', passwords, port: 0, log: () => {} }), /OIDC_WEB_REDIRECT_URL: a loopback URL/);
  const env = { OIDC_ISSUER: ISSUER, OIDC_WEB_CLIENT_ID: 'eupadev-web', OIDC_WEB_CLIENT_SECRET: 'x', OIDC_WEB_REDIRECT_URL: CLIENT.redirectUrl, SIGNIN_REQUESTER_PASSWORD: 'r', SIGNIN_ADMIN_PASSWORD: 'a' };
  assert.deepEqual(optionsFromEnv(env), { issuer: ISSUER, clientId: 'eupadev-web', clientSecret: 'x', redirectUrl: CLIENT.redirectUrl, audience: 'eupadev-api', address: '127.0.0.1', port: 8080, passwords: { requester: 'r', admin: 'a' } });
  assert.equal(optionsFromEnv({ ...env, API_ADDRESS: '0.0.0.0', API_PORT: '8081' }).port, 8081);
  assert.throws(() => optionsFromEnv({ ...env, SIGNIN_ADMIN_PASSWORD: '' }), /SIGNIN_ADMIN_PASSWORD missing/);
  assert.throws(() => optionsFromEnv({ ...env, OIDC_WEB_CLIENT_SECRET: '' }), /OIDC_WEB_CLIENT_SECRET missing/);
  assert.throws(() => optionsFromEnv({ ...env, OIDC_ISSUER: ' ' }), /OIDC_ISSUER missing/);
});
