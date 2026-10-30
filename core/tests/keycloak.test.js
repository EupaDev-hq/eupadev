// Test realm `tools` (tests/keycloak/realm-test.json, R8): importable by the platform's Keycloak, and each person
// gets, by code + PKCE with the client's secret, an ID token carrying the client roles of their groups. Real
// Keycloak in a container (tests/helpers/throwaway-keycloak.js): Docker is required.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { TEST_REALM, startKeycloak } from './helpers/throwaway-keycloak.js';

/** @type {{ clients: { clientId: string, secret: string, redirectUris: string[] }[], groups: { name: string, clientRoles: Record<string, string[]> }[], users: { username: string, groups: string[], credentials: { value: string }[] }[] }} */
const REALM = JSON.parse(readFileSync(TEST_REALM, 'utf8'));
const CLIENT = REALM.clients[0] ?? assert.fail('realm-test.json: no client');
const REDIRECT = CLIENT.redirectUris[0] ?? '';
const b64url = (/** @type {Buffer} */ b) => b.toString('base64url');
/** @param {string} jwt @returns {Record<string, any>} */
const payload = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString());

/** @type {Awaited<ReturnType<typeof startKeycloak>>} */ let kc;
before(async () => { kc = await startKeycloak(); });
after(() => kc?.remove());

/** Authorisation URL; without `challenge`, no PKCE. @param {string} state @param {string} nonce @param {string} [challenge] */
function authUrl(state, nonce, challenge) {
  const q = new URLSearchParams({ client_id: CLIENT.clientId, response_type: 'code', scope: 'openid', redirect_uri: REDIRECT, state, nonce });
  if (challenge) { q.set('code_challenge', challenge); q.set('code_challenge_method', 'S256'); }
  return `${kc.base}/realms/tools/protocol/openid-connect/auth?${q}`;
}

/** Sign-in like a browser (cookies kept by hand), then code exchange. @param {string} name @param {string} password */
async function signIn(name, password) {
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const page = await fetch(authUrl(state, nonce, b64url(createHash('sha256').update(verifier).digest())));
  assert.equal(page.status, 200);
  const cookies = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(await page.text())?.[1]?.replaceAll('&amp;', '&');
  assert.ok(action, 'sign-in form missing');
  const submit = await fetch(action, {
    method: 'POST', redirect: 'manual', headers: { cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: name, password, credentialId: '' }),
  });
  assert.equal(submit.status, 302, `sign-in of ${name} refused`);
  const back = new URL(submit.headers.get('location') ?? '');
  assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
  assert.equal(back.searchParams.get('state'), state);
  const token = await fetch(`${kc.base}/realms/tools/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code') ?? '', redirect_uri: REDIRECT,
      code_verifier: verifier, client_id: CLIENT.clientId, client_secret: CLIENT.secret }),
  });
  assert.equal(token.status, 200);
  return { idToken: payload(/** @type {{ id_token: string }} */ (await token.json()).id_token), nonce };
}

describe('test realm tools', () => {
  for (const u of REALM.users) {
    const expected = REALM.groups.filter((g) => u.groups.includes(`/${g.name}`)).flatMap((g) => g.clientRoles[CLIENT.clientId] ?? []).sort();
    test(`${u.username}: ID token of the issuer, nonce, sid, roles ${expected.join(', ')}`, async () => {
      const { idToken, nonce } = await signIn(u.username, u.credentials[0]?.value ?? '');
      assert.equal(idToken.iss, kc.issuer);
      assert.equal(idToken.aud, CLIENT.clientId);
      assert.equal(idToken.nonce, nonce);
      assert.ok(idToken.sub && idToken.sid);
      assert.ok(idToken.email && idToken.name, 'email and name: contact attributes read by the core');
      assert.deepEqual(Object.keys(idToken.resource_access ?? {}), [CLIENT.clientId]);
      assert.deepEqual([...idToken.resource_access[CLIENT.clientId].roles].sort(), expected);
      assert.equal(idToken.realm_access, undefined);
    });
  }

  test('without PKCE: refused (invalid_request)', async () => {
    const r = await fetch(authUrl('s', 'n'), { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get('location') ?? '').searchParams.get('error'), 'invalid_request');
  });

  test('other redirect: refused (error page, no redirect)', async () => {
    const q = new URL(authUrl('s', 'n', 'x'.repeat(43)));
    q.searchParams.set('redirect_uri', 'http://localhost:3000/elsewhere');
    assert.equal((await fetch(q, { redirect: 'manual' })).status, 400);
  });

  test('direct password: refused', async () => {
    const u = REALM.users[0];
    const r = await fetch(`${kc.base}/realms/tools/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT.clientId, client_secret: CLIENT.secret,
        username: u?.username ?? '', password: u?.credentials[0]?.value ?? '', scope: 'openid' }),
    });
    assert.equal(r.status, 400);
    assert.equal(/** @type {{ error: string }} */ (await r.json()).error, 'unauthorized_client');
  });
});
