// OIDC, sessions and sign-outs against a real Keycloak (test realm, client trial-tool) and a real PostgreSQL, two
// instances of the example tool on the same database: sign-in through the Keycloak form, GET callback, refusals
// (altered nonce, replayed code), regeneration (ASVS 7.2.4), CVE-2024-35220, token_version, clock moved forward,
// RP-initiated logout (also from a real Chromium: CSP `form-action`), real back-channel logout (Keycloak →
// host.docker.internal:3000). Docker is required; instance A listens on port 3000 (exact addresses of realm-test.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { loadHandlers, createAuth, createDb, createLogger, createServer, readContract } from '../src/index.js';
import { TRANSACTION_COOKIE } from '../src/auth.js';
import { SESSION_COOKIE } from '../src/sessions.js';
import { TEST_REALM, startKeycloak } from './helpers/throwaway-keycloak.js';
import { signIn as kitSignIn, httpBrowser } from '../kit/index.js';
import { startPostgres, query } from './helpers/throwaway-postgres.js';
import { EXAMPLE } from './helpers/server.js';

/** @type {{ clients: { clientId: string, secret: string }[], users: { username: string, credentials: { value: string }[] }[] }} */
const REALM = JSON.parse(readFileSync(TEST_REALM, 'utf8'));
const CLIENT = REALM.clients[0] ?? assert.fail('realm-test.json: no client');
const APP = 'http://localhost:3000';
/** Host of the tool's cookies (both instances are on localhost). */
const HOST = 'localhost';
const MIN = 60_000;
const password = (/** @type {string} */ name) => REALM.users.find((u) => u.username === name)?.credentials[0]?.value ?? '';

/** @type {Awaited<ReturnType<typeof startKeycloak>>} */ let kc;
/** @type {Awaited<ReturnType<typeof startPostgres>>} */ let pgt;
/** @type {{ app: import('../src/http.js').App, base: string, lines: () => Record<string, any>[] }[]} */ const instances = [];
/** @type {ReturnType<typeof createDb>[]} */ const dbs = [];

/** One instance of the example tool (shared database, its own OIDC discovery). @param {number} port @param {string} host */
async function instance(port, host) {
  const db = createDb({ url: pgt.app, tls: false, max: 3 });
  dbs.push(db);
  /** @type {string[]} */ const raw = [];
  const logger = createLogger({ level: 'info', destination: { write: (/** @type {string} */ l) => { raw.push(l); } } });
  const config = { appUrl: APP, issuer: kc.issuer, clientId: CLIENT.clientId, clientSecret: CLIENT.secret, tlsOff: true, durations: { idleMs: 30 * MIN, maxMs: 8 * 60 * MIN } };
  const contract = readContract(`${EXAMPLE}openapi.yaml`);
  const app = await createServer({ contract, handlers: await loadHandlers(`${EXAMPLE}api`, contract), db, logger, web: `${EXAMPLE}web`, appUrl: APP, auth: await createAuth({ config, db }) });
  await app.listen({ port, host });
  const address = /** @type {import('node:net').AddressInfo} */ (app.server.address());
  const i = { app, base: `http://localhost:${address.port}`, lines: () => raw.map((l) => JSON.parse(l)) };
  instances.push(i);
  return i;
}
/** @type {Awaited<ReturnType<typeof instance>>} */ let A;
/** @type {Awaited<ReturnType<typeof instance>>} */ let B;

before(async () => {
  [kc, pgt] = await Promise.all([startKeycloak(), startPostgres()]);
  A = await instance(3000, '::');
  B = await instance(0, '127.0.0.1');
});
after(async () => {
  for (const i of instances) await i.app.close();
  for (const d of dbs) await d.close();
  kc?.remove();
  pgt?.remove();
});

/**
 * Sign-in through the kit (Keycloak form if no SSO yet); returns the steps.
 * @param {ReturnType<typeof httpBrowser>} nav @param {string} name @param {{ next?: string, base?: string }} [o]
 */
const signIn = (nav, name, o = {}) => kitSignIn(nav, o.base ?? A.base, { name, password: password(name) }, o.next);
/** @param {ReturnType<typeof httpBrowser>} nav @param {string} [base] */
const api = (nav, base = A.base) => nav.request(`${base}/api/items`, { headers: { 'x-requested-with': 'eupadev' } });
/** Same-origin POST, like the front's sign-out button. */
const POST = { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } };
/** @param {import('../kit/http-browser.js').Step[]} steps @param {string} path */
const step = (steps, path) => steps.find((e) => new URL(e.url).pathname === path) ?? assert.fail(`no step ${path} in ${steps.map((e) => `${e.status} ${e.url}`).join(' → ')}`);
/** @param {string} text @param {unknown[]} [v] */
const sql = (text, v = []) => query(pgt.app, text, v);

describe('sign-in', () => {
  test('alice: Keycloak form, GET callback, __Host-session cookie, /api/items 200, actor and (iss, sub) link created once', async () => {
    const nav = httpBrowser();
    assert.equal((await api(nav)).status, 401);
    const steps = await signIn(nav, 'alice');
    assert.deepEqual(steps.map((e) => e.status), [303, 200, 302, 303, 200]);
    const back = step(steps, '/auth/callback');
    assert.equal(back.headers.get('location'), '/');
    const set = back.headers.getSetCookie();
    assert.ok(set.some((c) => /^__Host-session=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}; Max-Age=1800; Path=\/; HttpOnly; Secure; SameSite=Lax$/.test(c)), String(set));
    assert.ok(set.some((c) => /^__Host-oidc=; Max-Age=0; /.test(c)), 'transaction cookie cleared');
    assert.equal(nav.cookie(HOST, TRANSACTION_COOKIE), undefined);
    const r = await api(nav);
    assert.equal(r.status, 200);
    assert.equal(r.headers.getSetCookie().length, 0, 'no Set-Cookie as long as the session is not extended');

    const actors = (await sql("SELECT mail, display_name, type, token_version, last_sign_in_at FROM actors WHERE mail = 'alice@example.test'")).rows;
    assert.equal(actors.length, 1);
    assert.deepEqual([actors[0].display_name, actors[0].type, actors[0].token_version], ['Alice Reader', 'human', '1']);
    assert.ok(actors[0].last_sign_in_at instanceof Date);
    const links = (await sql('SELECT issuer, reason FROM actor_identities i JOIN actors a ON a.id = i.actor_id WHERE a.mail = $1', ['alice@example.test'])).rows;
    assert.deepEqual(links, [{ issuer: kc.issuer, reason: 'first sign-in' }]);
    const sessions = (await sql('SELECT s.roles, s.sid, s.id_token, s.token_version FROM sessions s JOIN actors a ON a.id = s.actor_id WHERE a.mail = $1', ['alice@example.test'])).rows;
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].roles, ['reader']);
    assert.ok(sessions[0].sid && sessions[0].id_token?.startsWith('eyJ'));
    assert.equal(sessions[0].token_version, '1');
    const log = A.lines();
    assert.ok(log.some((l) => l.event === 'sign_in' && l.sid === sessions[0].sid));
    assert.ok(!JSON.stringify(log).includes(nav.cookie(HOST, SESSION_COOKIE) ?? '!'), 'the session token does not go to the log');
    assert.ok(!log.some((l) => JSON.stringify(l).includes('eyJ')), 'no JWT in the log');

    // Second sign-in (Keycloak SSO, without the form): same actor, different session identifier, the old one is worth nothing (ASVS 7.2.4).
    const old = nav.cookie(HOST, SESSION_COOKIE) ?? '';
    const steps2 = await signIn(nav, 'alice');
    assert.deepEqual(steps2.map((e) => e.status), [303, 302, 303, 200]);
    const fresh = nav.cookie(HOST, SESSION_COOKIE) ?? '';
    assert.notEqual(fresh, old);
    assert.equal((await api(nav)).status, 200);
    nav.set(HOST, SESSION_COOKIE, old);
    assert.equal((await api(nav)).status, 401);
    nav.set(HOST, SESSION_COOKIE, fresh);
    assert.equal((await sql("SELECT count(*)::int n FROM actors WHERE mail = 'alice@example.test'")).rows[0].n, 1);
    assert.equal((await sql('SELECT count(*)::int n FROM sessions s JOIN actors a ON a.id = s.actor_id WHERE a.mail = $1', ['alice@example.test'])).rows[0].n, 1);
  });

  test('next: relative path followed, absolute URL or // replaced by /', async () => {
    const nav = httpBrowser();
    assert.equal(step(await signIn(nav, 'bruno', { next: '/items?x=1' }), '/auth/callback').headers.get('location'), '/items?x=1');
    assert.equal(step(await signIn(nav, 'bruno', { next: 'https://evil.test/' }), '/auth/callback').headers.get('location'), '/');
    assert.equal(step(await signIn(nav, 'bruno', { next: '//evil.test/' }), '/auth/callback').headers.get('location'), '/');
  });

  test('altered nonce seed → 400 without a session; replayed code → 400', async () => {
    const nav = httpBrowser();
    const before = (await sql('SELECT count(*)::int n FROM sessions')).rows[0].n;
    const steps = await nav.go(`${A.base}/auth/login`);
    const last = /** @type {import('../kit/http-browser.js').Step} */ (steps[steps.length - 1]);
    const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(last.text)?.[1]?.replaceAll('&amp;', '&') ?? assert.fail('form missing');
    const kcBack = await nav.request(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'chloe', password: password('chloe'), credentialId: '' }).toString() });
    assert.equal(kcBack.status, 302);
    const callback = new URL(kcBack.headers.get('location') ?? '');
    assert.equal(callback.origin, APP);
    const transaction = nav.cookie(HOST, TRANSACTION_COOKIE) ?? '';
    const tx = JSON.parse(Buffer.from(transaction, 'base64url').toString());
    nav.set(HOST, TRANSACTION_COOKIE, Buffer.from(JSON.stringify({ ...tx, n: `${tx.n}x` })).toString('base64url'));
    const altered = await nav.request(callback);
    assert.equal(altered.status, 400);
    assert.equal(JSON.parse(altered.text).code, 'OIDC_CALLBACK_REJECTED');
    assert.equal(nav.cookie(HOST, SESSION_COOKIE), undefined);
    assert.equal((await sql('SELECT count(*)::int n FROM sessions')).rows[0].n, before, 'no session created');
    // The code was consumed by the exchange (the nonce is checked after): replaying it with the right transaction fails too.
    nav.set(HOST, TRANSACTION_COOKIE, transaction);
    const replayed = await nav.request(callback);
    assert.equal(replayed.status, 400);
    assert.equal(nav.cookie(HOST, SESSION_COOKIE), undefined);
    const refusals = A.lines().filter((l) => l.msg === 'OIDC callback refused').map((l) => l.code);
    assert.ok(refusals.includes('OAUTH_JWT_CLAIM_COMPARISON_FAILED'), `the nonce refusal (claim comparison) is logged: ${refusals.join(' | ')}`);
    assert.ok(refusals.includes('OAUTH_RESPONSE_BODY_ERROR'), 'the replayed code is refused by Keycloak (invalid_grant)');
  });
});

describe('sign-outs', () => {
  test('cross-site POST /auth/logout with the real cookie → 403, session intact; without X-Requested-With, /api/items → 403', async () => {
    const nav = httpBrowser();
    await signIn(nav, 'bruno');
    const r = await nav.request(`${A.base}/auth/logout`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403);
    assert.equal(JSON.parse(r.text).code, 'CSRF_BLOCKED');
    assert.equal((await api(nav)).status, 200, 'the session is intact');
    assert.equal((await nav.request(`${A.base}/api/items`)).status, 403);
    assert.ok(A.lines().some((l) => l.event === 'csrf_blocked' && l.rule === 'sec-fetch-site'));
  });
  test('RP-initiated: session destroyed, cookie cleared, 303 to end_session with id_token_hint, Keycloak sends back to APP_URL; the old cookie reopens nothing (CVE-2024-35220)', async () => {
    const nav = httpBrowser();
    await signIn(nav, 'alice');
    const token = nav.cookie(HOST, SESSION_COOKIE) ?? '';
    const steps = await nav.go(`${A.base}/auth/logout`, POST);
    const out = step(steps, '/auth/logout');
    assert.equal(out.status, 303);
    const end = new URL(out.headers.get('location') ?? '');
    assert.equal(end.origin + end.pathname, `${kc.base}/realms/tools/protocol/openid-connect/logout`);
    assert.equal(end.searchParams.get('post_logout_redirect_uri'), `${APP}/`);
    assert.equal(end.searchParams.get('client_id'), CLIENT.clientId);
    assert.match(end.searchParams.get('id_token_hint') ?? '', /^eyJ/);
    assert.ok(out.headers.getSetCookie().some((c) => /^__Host-session=; Max-Age=0; /.test(c)));
    assert.deepEqual(steps.slice(1).map((e) => [e.status, new URL(e.url).origin]), [[302, kc.base], [200, APP]], 'Keycloak redirects without an intermediate page, APP_URL/ answers');
    assert.equal(nav.cookie(HOST, SESSION_COOKIE), undefined);
    nav.set(HOST, SESSION_COOKIE, token);
    assert.equal((await api(nav)).status, 401);
    assert.equal((await sql('SELECT count(*)::int n FROM sessions WHERE id = $1', [token.split('.')[0]])).rows[0].n, 0);
    assert.ok(A.lines().some((l) => l.event === 'sign_out'));
    // The Keycloak SSO session is over: a new sign-in goes through the form again.
    assert.deepEqual((await signIn(nav, 'alice')).map((e) => e.status), [303, 200, 302, 303, 200]);
  });

  // INJ-2: Chromium checks `form-action` on the redirects of a form submission; with `form-action 'self'` alone, the
  // 303 to Keycloak (another origin here) was blocked, the SSO session survived and the next sign-in was silent.
  test('Chromium: sign-out (api.signOut) reaches Keycloak\'s end-session page with no CSP violation; signing in again asks for the password', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      /** @type {string[]} */ const violations = [];
      page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
      await page.goto(`${A.base}/auth/login`);
      await page.fill('#username', 'alice');
      await page.fill('#password', password('alice'));
      await Promise.all([page.waitForURL(`${APP}/`), page.click('#kc-login')]);
      const endSession = page.waitForRequest((r) => r.url().startsWith(`${kc.base}/realms/tools/protocol/openid-connect/logout?`), { timeout: 10_000 });
      const back = page.waitForRequest((r) => r.url() === `${APP}/` && r.isNavigationRequest(), { timeout: 10_000 });
      const load = page.waitForEvent('load', { timeout: 10_000 });
      await page.evaluate('import("/core/api.js").then((m) => m.api.signOut())');
      await Promise.all([endSession, back, load]);
      assert.deepEqual(violations, []);
      await page.goto(`${A.base}/auth/login`);
      await page.waitForSelector('#password', { timeout: 10_000 });
      assert.equal(new URL(page.url()).origin, kc.base, 'Keycloak\'s sign-in form, not a silent SSO return');
    } finally {
      await browser.close();
    }
  });

  test('real back-channel: two sessions of the same sid, sign-out of one, Keycloak kills the other through host.docker.internal:3000', async () => {
    const nav = httpBrowser();
    await signIn(nav, 'bruno');
    const s1 = nav.cookie(HOST, SESSION_COOKIE) ?? '';
    nav.set(HOST, SESSION_COOKIE); // another session, same Keycloak SSO: the regeneration does not destroy s1
    await signIn(nav, 'bruno');
    const s2 = nav.cookie(HOST, SESSION_COOKIE) ?? '';
    assert.notEqual(s1, s2);
    const sids = (await sql('SELECT DISTINCT sid FROM sessions WHERE id = ANY($1)', [[s1.split('.')[0], s2.split('.')[0]]])).rows;
    assert.equal(sids.length, 1, 'same Keycloak sid');
    nav.set(HOST, SESSION_COOKIE, s1);
    assert.equal((await api(nav)).status, 200);
    nav.set(HOST, SESSION_COOKIE, s2);
    await nav.go(`${A.base}/auth/logout`, POST);
    nav.set(HOST, SESSION_COOKIE, s1);
    const limit = Date.now() + 10_000;
    for (;;) {
      if ((await api(nav)).status === 401) break;
      assert.ok(Date.now() < limit, 'back-channel logout not received within 10 s');
      await wait(200);
    }
    const line = A.lines().find((l) => l.event === 'backchannel_logout' && l.sid === sids[0].sid);
    assert.ok(line && line.sessions >= 1, JSON.stringify(line));
  });
});

describe('two instances, token_version, clock', () => {
  test('cookie obtained on A accepted by B; sign-out on B refused by A', async () => {
    const nav = httpBrowser();
    await signIn(nav, 'chloe');
    assert.equal((await api(nav, B.base)).status, 200);
    const out = await nav.request(`${B.base}/auth/logout`, POST);
    assert.equal(out.status, 303);
    assert.equal((await api(nav, A.base)).status, 401);
  });

  test('UPDATE actors SET token_version + 1 → immediate 401 on A and B', async () => {
    const nav = httpBrowser();
    await signIn(nav, 'alice');
    assert.equal((await api(nav, A.base)).status, 200);
    assert.equal((await api(nav, B.base)).status, 200);
    await sql("UPDATE actors SET token_version = token_version + 1 WHERE mail = 'alice@example.test'");
    assert.equal((await api(nav, A.base)).status, 401);
    assert.equal((await api(nav, B.base)).status, 401);
    // Sign-in again: new session with the new version.
    await signIn(nav, 'alice');
    assert.equal((await api(nav, B.base)).status, 200);
  });

  test('clock moved forward: 31 min without activity → 401; activity in steps of 25 min → cookie extended, then 401 at 8 h', async (t) => {
    const nav = httpBrowser();
    await signIn(nav, 'bruno');
    const start = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now: start });
    t.mock.timers.tick(31 * MIN);
    assert.equal((await api(nav)).status, 401);
    t.mock.timers.reset();

    await signIn(nav, 'bruno');
    const token = nav.cookie(HOST, SESSION_COOKIE) ?? '';
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    for (let minutes = 25; minutes < 480; minutes += 25) {
      t.mock.timers.tick(25 * MIN);
      const r = await api(nav);
      assert.equal(r.status, 200, `${minutes} min`);
      assert.ok(r.headers.getSetCookie().some((c) => c.startsWith(`__Host-session=${token}; Max-Age=1800;`)), `${minutes} min: cookie extended`);
    }
    t.mock.timers.tick(25 * MIN);
    const end = await api(nav);
    assert.equal(end.status, 401);
    assert.ok(end.headers.getSetCookie().some((c) => /^__Host-session=; Max-Age=0; /.test(c)));
    assert.equal((await sql('SELECT count(*)::int n FROM sessions WHERE id = $1', [token.split('.')[0]])).rows[0].n, 0, 'outdated session deleted');
  });
});
