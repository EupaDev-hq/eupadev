// Authentication, without a network or a database: OIDC client built on static metadata, local JWKS (jose), fake
// database. Covers the sign-in redirect, the transaction cookie, the callback refusals that come before any code
// exchange (cookie missing, forged state, issuer error), the session provider (malformed token → no query), sign-out
// without a session, and each rule of the logout token (§2.2).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import * as oidc from 'openid-client';
import { TRANSACTION_COOKIE, assembleAuth, authConfigFromEnv, resolveActor, rolesFromClaims } from '../src/auth.js';
import { LOGIN_THRESHOLD_PER_IP } from '../src/rate-limit.js';
import { SECURITY_HEADERS } from '../src/http.js';
import { safeReturnTo } from '../src/protections.js';
import { SESSION_COOKIE, durationsFromEnv } from '../src/sessions.js';
import { call, fakeDb, testServer } from './helpers/server.js';

const ISSUER = 'https://auth.test/realms/tools';
const CLIENT = 'trial-tool';
const APP = 'https://tool.test';
const EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const CONFIG = { appUrl: APP, issuer: ISSUER, clientId: CLIENT, clientSecret: 'ci-only', tlsOff: false, durations: durationsFromEnv({}) };
const META = {
  issuer: ISSUER, authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`, token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`, jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
};

/** @type {Awaited<ReturnType<typeof testServer>>} */ let s;
const db = fakeDb();
/** @type {Awaited<ReturnType<typeof generateKeyPair>>} */ let keys;
/** @type {Awaited<ReturnType<typeof generateKeyPair>>} */ let otherKeys;
before(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('ES256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  const client = new oidc.Configuration(META, CLIENT, CONFIG.clientSecret);
  s = await testServer({ db, auth: assembleAuth({ config: CONFIG, db, client, jwks }), web: false });
});
after(() => s?.close());

/** @param {Headers} h @param {string} name */
const cookieSet = (h, name) => h.getSetCookie().find((c) => c.startsWith(`${name}=`));
/** @param {string} setCookie */
const value = (setCookie) => setCookie.split(';')[0]?.split('=')[1] ?? '';

/**
 * Logout token signed by the test issuer's key.
 * @param {Record<string, unknown>} [payload] @param {{ iss?: string, aud?: string, iatOffsetS?: number, key?: import('jose').CryptoKey, alg?: string, exp?: string | number | false }} [o]
 */
async function logoutToken(payload = {}, o = {}) {
  const j = new SignJWT({ events: { [EVENT]: {} }, sid: 'sid-1', sub: 'subject-1', ...payload })
    .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? ISSUER).setAudience(o.aud ?? CLIENT)
    .setIssuedAt(Math.floor(Date.now() / 1000) + (o.iatOffsetS ?? 0));
  if (!('jti' in payload)) j.setJti(randomUUID());
  if (o.exp !== false) j.setExpirationTime(o.exp ?? '2m');
  return j.sign(o.key ?? keys.privateKey);
}
/** @param {string} token */
const backchannel = (token) => call(`${s.base}/auth/backchannel-logout`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: token }).toString(),
});

describe('pure functions', () => {
  test('safeReturnTo: a relative path with a single /, otherwise /', () => {
    for (const ok of ['/', '/items', '/items/42?x=1#h', '/a/b/']) assert.equal(safeReturnTo(ok), ok);
    for (const ko of [undefined, '', 'items', '//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)', '/a b', '/a\nb', 42]) assert.equal(safeReturnTo(ko), '/', String(ko));
  });
  test('resolveActor: IdP name without invisible characters, 200 code points at most (INJ-5, INJ-1); nothing left → sub', async () => {
    /** @type {unknown[]} */ const names = [];
    const fake = /** @type {any} */ ({
      tx: async (/** @type {unknown} */ _c, /** @type {(t: any) => Promise<unknown>} */ fn) => fn({
        query: async (/** @type {string} */ sql, /** @type {unknown[]} */ v) => {
          if (sql.startsWith('UPDATE')) { names.push(v[2]); return { rows: [{ token_version: '1' }] }; }
          return { rows: [{ actor_id: 'a1' }] };
        },
      }),
    });
    await resolveActor(fake, { iss: ISSUER, sub: 's1', name: 'Paul \u202Eevil\u202C Dupont\u200B' });
    await resolveActor(fake, { iss: ISSUER, sub: 's1', name: `${'\u{1F600}'.repeat(199)} b` });
    await resolveActor(fake, { iss: ISSUER, sub: 's1', name: '\u200B\u2066\u0007' });
    assert.deepEqual(names, ['Paul evil Dupont', '\u{1F600}'.repeat(199), 's1']);
  });
  test('rolesFromClaims: client roles only, non-empty strings', () => {
    assert.deepEqual(rolesFromClaims({ resource_access: { [CLIENT]: { roles: ['reader', '', 7, 'admin'] }, other: { roles: ['x'] } }, realm_access: { roles: ['y'] } }, CLIENT), ['reader', 'admin']);
    assert.deepEqual(rolesFromClaims({}, CLIENT), []);
    assert.deepEqual(rolesFromClaims({ resource_access: { [CLIENT]: { roles: 'admin' } } }, CLIENT), []);
  });
  test('authConfigFromEnv: required variables, https required unless OIDC_TLS=off, APP_URL without a path, secret from a file', () => {
    const base = { APP_URL: APP, OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT, OIDC_CLIENT_SECRET: 'x' };
    assert.deepEqual(authConfigFromEnv(base), { ...CONFIG, clientSecret: 'x' });
    for (const name of ['APP_URL', 'OIDC_ISSUER', 'OIDC_CLIENT_ID']) assert.throws(() => authConfigFromEnv({ ...base, [name]: '' }), new RegExp(`${name} missing`));
    assert.throws(() => authConfigFromEnv({ ...base, OIDC_CLIENT_SECRET: '' }), /OIDC_CLIENT_SECRET/);
    assert.throws(() => authConfigFromEnv({ ...base, APP_URL: 'http://localhost:3000' }), /https required/);
    assert.throws(() => authConfigFromEnv({ ...base, OIDC_ISSUER: 'http://127.0.0.1:8080/realms/tools' }), /https required/);
    assert.equal(authConfigFromEnv({ ...base, APP_URL: 'http://localhost:3000', OIDC_TLS: 'off' }).appUrl, 'http://localhost:3000');
    assert.throws(() => authConfigFromEnv({ ...base, APP_URL: 'https://tool.test/sub' }), /origin only/);
    assert.throws(() => authConfigFromEnv({ ...base, APP_URL: 'https://tool.test/?x' }), /no credentials/);
    assert.throws(() => authConfigFromEnv({ ...base, OIDC_ISSUER: 'not-a-url' }), /absolute URL/);
    assert.equal(authConfigFromEnv({ ...base, OIDC_ISSUER: `${ISSUER}/` }).issuer, ISSUER);
    const d = mkdtempSync(join(tmpdir(), 'core-auth-'));
    writeFileSync(join(d, 'secret'), 'from-file\n');
    const { OIDC_CLIENT_SECRET: _, ...noSecret } = base;
    assert.equal(authConfigFromEnv({ ...noSecret, OIDC_CLIENT_SECRET_FILE: join(d, 'secret') }).clientSecret, 'from-file');
  });
});

describe('sign-in: redirect and transaction cookie', () => {
  test('GET /auth/login: 303 to the issuer with code + PKCE S256 + state + hashed nonce, __Host-oidc cookie of 10 min', async () => {
    const r = await call(`${s.base}/auth/login?next=/items/42`);
    assert.equal(r.status, 303);
    const u = new URL(r.headers.get('location') ?? '');
    assert.equal(`${u.origin}${u.pathname}`, META.authorization_endpoint);
    const q = u.searchParams;
    assert.equal(q.get('client_id'), CLIENT);
    assert.equal(q.get('redirect_uri'), `${APP}/auth/callback`);
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('response_mode'), 'query');
    assert.equal(q.get('scope'), 'openid');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.ok((q.get('state') ?? '').length >= 22 && (q.get('nonce') ?? '').length >= 22);
    const c = cookieSet(r.headers, TRANSACTION_COOKIE);
    assert.ok(c);
    assert.match(c, /; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    assert.ok(!/Domain=/i.test(c));
    const tx = JSON.parse(Buffer.from(value(c), 'base64url').toString());
    assert.equal(tx.s, q.get('state'));
    assert.equal(tx.r, '/items/42');
    assert.notEqual(tx.n, q.get('nonce'), 'the cookie keeps the seed, the URL its hash');
    assert.match(tx.v, /^[A-Za-z0-9_-]{43,128}$/);
    const r2 = await call(`${s.base}/auth/login?next=https://evil.test`);
    assert.equal(JSON.parse(Buffer.from(value(cookieSet(r2.headers, TRANSACTION_COOKIE) ?? ''), 'base64url').toString()).r, '/');
    assert.notEqual((await call(`${s.base}/auth/login`, { method: 'HEAD' })).status, 303);
  });
  test('GET /auth/callback: cookie missing, unreadable, forged state, issuer error → 400 without a session, transaction cookie cleared', async () => {
    const without = await call(`${s.base}/auth/callback?code=abc&state=xyz`);
    assert.equal(without.status, 400);
    assert.equal(without.body.code, 'OIDC_TRANSACTION_MISSING');
    const unreadable = await call(`${s.base}/auth/callback?code=abc&state=xyz`, { headers: { cookie: `${TRANSACTION_COOKIE}=not-json` } });
    assert.equal(unreadable.body.code, 'OIDC_TRANSACTION_MISSING');
    const login = await call(`${s.base}/auth/login`);
    const cookie = `${TRANSACTION_COOKIE}=${value(cookieSet(login.headers, TRANSACTION_COOKIE) ?? '')}`;
    const forged = await call(`${s.base}/auth/callback?code=abc&state=other`, { headers: { cookie } });
    assert.equal(forged.status, 400);
    assert.equal(forged.body.code, 'OIDC_CALLBACK_REJECTED');
    assert.equal(cookieSet(forged.headers, SESSION_COOKIE), undefined);
    assert.match(cookieSet(forged.headers, TRANSACTION_COOKIE) ?? '', /^__Host-oidc=; Max-Age=0; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax$/);
    const state = JSON.parse(Buffer.from(value(cookieSet(login.headers, TRANSACTION_COOKIE) ?? ''), 'base64url').toString()).s;
    const refused = await call(`${s.base}/auth/callback?error=access_denied&state=${state}`, { headers: { cookie } });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'OIDC_CALLBACK_REJECTED');
    assert.ok(s.lines().some((l) => l.msg === 'OIDC callback refused' && l.oauth_error === 'access_denied'));
    assert.ok(s.lines().some((l) => l.msg === 'OIDC callback refused' && l.code === 'OAUTH_INVALID_RESPONSE'), 'forged state logged');
    assert.equal(db.queries.filter((q) => !q.includes('rate_limits')).length, 0, 'no database query before a valid code (except the rate counter)');
  });
});

describe('session provider', () => {
  test('without a cookie: 401 without Set-Cookie; malformed token: 401 without a query; well-formed unknown token: one query, cookie cleared', async () => {
    const without = await call(`${s.base}/api/items`);
    assert.equal(without.status, 401);
    assert.equal(without.headers.getSetCookie().length, 0);
    const before = db.queries.length;
    const malformed = await call(`${s.base}/api/items`, { headers: { cookie: `${SESSION_COOKIE}=abc.def` } });
    assert.equal(malformed.status, 401);
    assert.equal(db.queries.length, before);
    assert.match(cookieSet(malformed.headers, SESSION_COOKIE) ?? '', /^__Host-session=; Max-Age=0; /);
    const unknown = await call(`${s.base}/api/items`, { headers: { cookie: `${SESSION_COOKIE}=${'a'.repeat(22)}.${'b'.repeat(43)}` } });
    assert.equal(unknown.status, 401);
    assert.equal(db.queries.length, before + 1);
    assert.match(db.queries[before] ?? '', /FROM sessions s JOIN actors a/);
  });
});

describe('sign-outs', () => {
  test('POST /auth/logout without a session: 303 / and cookie cleared; GET: not a sign-out; JSON or form accepted', async () => {
    const r = await call(`${s.base}/auth/logout`, { method: 'POST' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/');
    assert.match(cookieSet(r.headers, SESSION_COOKIE) ?? '', /^__Host-session=; Max-Age=0; /);
    assert.equal((await call(`${s.base}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' })).status, 303);
    assert.equal((await call(`${s.base}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 303);
    assert.equal((await call(`${s.base}/auth/logout`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
    assert.notEqual((await call(`${s.base}/auth/logout`)).status, 303);
  });
  test('CSP: the issuer\'s origin is a form action (sign-out\'s 303 to end_session), nothing else changes (INJ-2)', async () => {
    const csp = (await call(`${s.base}/auth/logout`, { method: 'POST' })).headers.get('content-security-policy');
    assert.equal(csp, SECURITY_HEADERS['content-security-policy'].replace("form-action 'self'", "form-action 'self' https://auth.test"));
    assert.equal((await call(`${s.base}/api/items`)).headers.get('content-security-policy'), csp);
  });
  test('back-channel: valid logout token by sid → 200 and deletion by sid; by sub only → lookup of the actor', async () => {
    const before = db.queries.length;
    const r = await backchannel(await logoutToken());
    assert.equal(r.status, 200);
    assert.equal(r.text, '');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(db.queries[before] ?? '', /DELETE FROM sessions WHERE sid = \$1/);
    const r2 = await backchannel(await logoutToken({ sid: undefined }));
    assert.equal(r2.status, 200);
    assert.match(db.queries[before + 1] ?? '', /FROM actor_identities WHERE issuer = \$1 AND subject = \$2/);
    assert.ok(s.lines().some((l) => l.event === 'backchannel_logout' && l.sid === 'sid-1'));
  });
  test('back-channel: each rule refuses (400 INVALID_LOGOUT_TOKEN), the contract never receives a form', async () => {
    const [h, p] = (await logoutToken()).split('.');
    const algNone = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    const hs256 = await new SignJWT({ events: { [EVENT]: {} }, sid: 'x' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience(CLIENT).setIssuedAt().setJti('j').sign(new TextEncoder().encode('shared-secret'));
    /** @type {[string, string][]} */
    const cases = [
      ['alg none', algNone],
      ['HS256', hs256],
      ['other key', await logoutToken({}, { key: otherKeys.privateKey, alg: 'ES256' })],
      ['other issuer', await logoutToken({}, { iss: 'https://auth.test/realms/other' })],
      ['other audience', await logoutToken({}, { aud: 'other-client' })],
      ['nonce present', await logoutToken({ nonce: 'n' })],
      ['events missing', await logoutToken({ events: undefined })],
      ['other event', await logoutToken({ events: { 'http://schemas.openid.net/event/other': {} } })],
      ['jti missing', await logoutToken({ jti: undefined })],
      ['iat older than 10 min', await logoutToken({}, { iatOffsetS: -11 * 60 })],
      ['expired', await logoutToken({}, { iatOffsetS: -5 * 60, exp: Math.floor(Date.now() / 1000) - 60 })],
      ['neither sid nor sub', await logoutToken({ sid: undefined, sub: undefined })],
      ['header without signature', `${h}.${p}.`],
    ];
    for (const [name, token] of cases) {
      const r = await backchannel(token);
      assert.equal(r.status, 400, name);
      assert.equal(r.body.code, 'INVALID_LOGOUT_TOKEN', name);
    }
    const replayed = await logoutToken();
    assert.equal((await backchannel(replayed)).status, 200);
    const second = await backchannel(replayed);
    assert.equal(second.status, 400);
    assert.match(second.body.detail, /replayed jti/);
    assert.equal((await backchannel('')).body.code, 'INVALID_REQUEST');
    assert.equal((await call(`${s.base}/auth/backchannel-logout`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
    const contract = await call(`${s.base}/api/items`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=x' });
    assert.equal(contract.status, 415);
    const offRoute = await call(`${s.base}/nowhere`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    assert.ok([404, 415].includes(offRoute.status), `never 500 off route: ${offRoute.status}`);
  });
});

describe('step 5 on /auth/*: origin rule and limit per IP', () => {
  const cookie = `${SESSION_COOKIE}=abc.def`;
  test('cross-site POST /auth/logout with a cookie → 403 CSRF_BLOCKED, session never read, cookie intact; same-origin → 303', async () => {
    const reads = () => db.queries.filter((q) => q.includes('FROM sessions')).length;
    const before = reads();
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.test' }, {}]) {
      const r = await call(`${s.base}/auth/logout`, { method: 'POST', headers: { cookie, ...headers } });
      assert.equal(r.status, 403, JSON.stringify(headers));
      assert.equal(r.body.code, 'CSRF_BLOCKED');
      assert.equal(cookieSet(r.headers, SESSION_COOKIE), undefined);
    }
    assert.equal(reads(), before);
    assert.equal((await call(`${s.base}/auth/logout`, { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin' } })).status, 303);
    assert.equal((await call(`${s.base}/auth/logout`, { method: 'POST', headers: { cookie, origin: APP } })).status, 303);
  });
  test('POST /auth/backchannel-logout outside the origin rule: a cross-site header does not block it (400 without a token, not 403)', async () => {
    const r = await call(`${s.base}/auth/backchannel-logout`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }, body: '' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'INVALID_REQUEST');
  });
  test(`GET /auth/login: ${LOGIN_THRESHOLD_PER_IP} a minute per IP, then 429 with Retry-After; the next minute starts again`, async () => {
    const T0 = new Date('2026-10-18T12:00:00Z');
    mock.timers.enable({ apis: ['Date'], now: T0 });
    try {
      for (let i = 0; i < LOGIN_THRESHOLD_PER_IP; i++) assert.equal((await call(`${s.base}/auth/login`)).status, 303, `call ${i + 1}`);
      const r = await call(`${s.base}/auth/login`);
      assert.equal(r.status, 429);
      assert.equal(r.body.code, 'RATE_LIMITED');
      assert.equal(r.headers.get('retry-after'), '60');
      assert.equal(cookieSet(r.headers, TRANSACTION_COOKIE), undefined, 'no transaction cookie set');
      mock.timers.setTime(T0.getTime() + 60_000);
      assert.equal((await call(`${s.base}/auth/login`)).status, 303);
      assert.ok([...db.counters.keys()].some((k) => k.startsWith('login|ip:127.0.0.1@')));
    } finally { mock.timers.reset(); }
  });
});
