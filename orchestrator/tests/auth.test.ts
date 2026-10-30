// I0 (ADR-017, Keycloak analysis D2, D4, D7): access token verification, without a database — local fake JWKS.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Authenticator, TokenRefused, bearerToken } from '../src/auth.ts';
import { AUDIENCE_TEST, startFakeOidc, TEST_ISSUER, type FakeOidc } from './helpers/fake-oidc.ts';

let oidc: FakeOidc;
let auth: Authenticator;

before(async () => {
  oidc = await startFakeOidc();
  auth = new Authenticator({ issuer: TEST_ISSUER, jwksUrl: oidc.jwksUrl, audience: AUDIENCE_TEST });
});
after(async () => { await oidc.stop(); });

const refuse = (token: Promise<string> | string, reason: RegExp) => assert.rejects(async () => auth.verifier(await token), (e: Error) => e instanceof TokenRefused && reason.test(e.message));

test('identity: a valid Keycloak token gives the principal (issuer, subject, mail, name, hats of the eupadev-api client)', async () => {
  const p = await auth.verifier(await oidc.token({ subject: 'u-1', mail: 'alice@example.test', name: 'Alice', roles: ['admin'] }));
  assert.deepEqual(p, { issuer: TEST_ISSUER, subject: 'u-1', mail: 'alice@example.test', name: 'Alice', roles: ['admin'] });
  // No mail (or an invalid mail): unknown contact, not an error; missing name → the subject.
  const sans = await auth.verifier(await oidc.token({ subject: 'u-2', mail: null, name: '' }));
  assert.deepEqual([sans.mail, sans.name, sans.roles], [null, 'u-2', []]);
  assert.equal((await auth.verifier(await oidc.token({ subject: 'u-3', mail: 'not an address' }))).mail, null);
});

test('identity: realm roles ignored, another client\'s roles ignored, unknown roles left out (D4)', async () => {
  const p = await auth.verifier(await oidc.token({ subject: 'u-4', roles: ['requester'] }, { claims: { realm_access: { roles: ['admin'] }, resource_access: { other: { roles: ['admin'] }, [AUDIENCE_TEST]: { roles: ['requester', 'superadmin'] } } } }));
  assert.deepEqual(p.roles, ['requester']);
  // No client role, a realm role `admin`: no hat (the realm role never counts, even on its own).
  const realm = await auth.verifier(await oidc.token({ subject: 'u-5' }, { claims: { resource_access: {}, realm_access: { roles: ['admin'] } } }));
  assert.deepEqual(realm.roles, []);
});

test('identity: typ JWT, alg none, HS256, aud missing, other iss, cnf, expired → refused (D7)', async () => {
  await refuse(oidc.token({ subject: 'u' }, { typ: 'JWT' }), /typ/);
  await refuse(oidc.token({ subject: 'u' }, { typ: null }), /typ/);
  await refuse(oidc.token({ subject: 'u' }, { audience: null }), /aud/);
  await refuse(oidc.token({ subject: 'u' }, { audience: 'other-api' }), /aud/);
  await refuse(oidc.token({ subject: 'u' }, { issuer: `${TEST_ISSUER}/` }), /iss/);
  await refuse(oidc.token({ subject: 'u' }, { issuer: 'https://other.example.test/realms/eupadev' }), /iss/);
  await refuse(oidc.token({ subject: 'u' }, { claims: { cnf: { jkt: 'x' } } }), /cnf/);
  await refuse(oidc.token({ subject: 'u' }, { expire: '-1m' }), /exp/);
  // alg none: three segments, empty signature.
  const [header, body] = (await oidc.token({ subject: 'u' })).split('.');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url');
  await refuse(`${none}.${body}.`, /alg|none|JWS/i);
  await refuse(`${header}.${body}.`, /signature|JWS/i);
  // HS256 signed with… any secret at all: never accepted (closed list).
  const hs = await new SignJWT({ resource_access: { [AUDIENCE_TEST]: { roles: ['admin'] } } }).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'test-key-1' })
    .setSubject('u').setIssuer(TEST_ISSUER).setAudience(AUDIENCE_TEST).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('test-secret-long-enough-for-hs256'));
  await refuse(hs, /alg|HS256/i);
  await refuse('not.a.token', /./);
});

test('identity: unknown kid → a single new read of the JWKS once the pause is over, never one per forged token', async () => {
  const pause = 300;
  const a = new Authenticator({ issuer: TEST_ISSUER, jwksUrl: oidc.jwksUrl, audience: AUDIENCE_TEST, pauseJwksMs: pause });
  const refuseA = (token: Promise<string>) => assert.rejects(async () => a.verifier(await token), (e: Error) => e instanceof TokenRefused && /kid|key|JWKS/i.test(e.message));
  await a.verifier(await oidc.token({ subject: 'u' })); // JWKS read a first time
  const before = oidc.reads();
  const unknown = await oidc.unknownKey();
  await refuseA(oidc.token({ subject: 'u' }, { key: unknown }));
  assert.equal(oidc.reads(), before, 'during the pause: no new read');
  await new Promise((r) => setTimeout(r, pause + 50));
  await refuseA(oidc.token({ subject: 'u' }, { key: unknown }));
  assert.equal(oidc.reads(), before + 1, 'pause over: one new read');
  await refuseA(oidc.token({ subject: 'u' }, { key: unknown }));
  await refuseA(oidc.token({ subject: 'u' }, { key: await oidc.unknownKey() }));
  assert.equal(oidc.reads(), before + 1, 'then none again until the next pause');
});

test('identity: Authorization header', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('bearer abc'), 'abc');
  assert.equal(bearerToken(undefined), null);
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken('Bearer'), null);
  assert.equal(bearerToken('Bearer a b'), null);
});
