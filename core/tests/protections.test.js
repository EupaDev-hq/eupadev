// Web protections (§2.7) on the example tool, without Docker: extended SEC-CSRF (hybrid rule, static header,
// preflight), cases of `csrf_test.go` (Go 1.25 `net/http.CrossOriginProtection`) and of
// `request_forgery_protection_test.rb` (Rails, including PR #56350 `:header_only`) ported with the deviations marked,
// `csrf_blocked` counter, rate limiting on a fake database (SEC-RATE), `safeEqual`, `ctx.fetch`.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, mock, test } from 'node:test';
import { DEFAULT_THRESHOLD_PER_MINUTE, READ_THRESHOLD_PER_MINUTE } from '../src/rate-limit.js';
import { STATIC_HEADER_VALUE, fetchNoFollow, originRefusal, safeEqual } from '../src/protections.js';
import { SESSION_COOKIE } from '../src/sessions.js';
import { APP_URL, call, fakeDb, testServer } from './helpers/server.js';

/** @type {Awaited<ReturnType<typeof testServer>>} */ let s;
const db = fakeDb();
before(async () => { s = await testServer({ db }); });
after(() => s?.close());

const BODY = JSON.stringify({ name: 'a' });
/** POST /api/items (manager, session by header, without a cookie) with the given headers. */
const write = (/** @type {Record<string, string>} */ headers = {}, base = s.base, path = '/api/items') =>
  call(`${base}${path}`, { method: 'POST', role: 'manager', headers: { 'content-type': 'application/json', ...headers }, body: BODY });
/** @param {any} r @param {string} [m] */
const isBlocked = (r, m) => { assert.equal(r.status, 403, m); assert.equal(r.body.code, 'CSRF_BLOCKED', m); };
const COOKIE = `${SESSION_COOKIE}=abc.def`;

describe('extended SEC-CSRF: origin rule on writes', () => {
  test('Sec-Fetch-Site: same-origin passes; same-site, cross-site, none, other → 403', async () => {
    assert.equal((await write({ 'sec-fetch-site': 'same-origin' })).status, 201);
    for (const v of ['same-site', 'cross-site', 'none', 'other', '']) isBlocked(await write({ 'sec-fetch-site': v }));
  });
  test('without Sec-Fetch-Site: Origin = APP_URL passes; foreign, null, subdomain, other port → 403 (never Host)', async () => {
    assert.equal((await write({ origin: APP_URL })).status, 201);
    for (const o of ['https://evil.test', 'null', 'https://a.tool.test', 'https://tool.test:8443', 'http://tool.test', s.base]) isBlocked(await write({ origin: o }));
  });
  test('neither Sec-Fetch-Site nor Origin: 403 with a session cookie, allowed without (machine call)', async () => {
    assert.equal((await write()).status, 201);
    isBlocked(await write({ cookie: COOKIE }));
    isBlocked(await write({ cookie: `other=1; ${COOKIE}` }));
    assert.equal((await write({ cookie: 'other=1' })).status, 201);
  });
  test('Sec-Fetch-Site takes precedence over Origin, both ways', async () => {
    isBlocked(await write({ 'sec-fetch-site': 'cross-site', origin: APP_URL }));
    assert.equal((await write({ 'sec-fetch-site': 'same-origin', origin: 'https://evil.test' })).status, 201);
  });
  test('no Referer fallback', async () => {
    isBlocked(await write({ cookie: COOKIE, referer: `${APP_URL}/` }));
  });
  test('reads: GET and HEAD pass even cross-site; cross-site PUT on a GET-only path → 403 before the 405', async () => {
    assert.equal((await call(`${s.base}/api/items`, { role: 'reader', headers: { 'sec-fetch-site': 'cross-site' } })).status, 200);
    assert.equal((await call(`${s.base}/api/items`, { method: 'HEAD', role: 'reader', headers: { 'sec-fetch-site': 'cross-site' } })).status, 200);
    isBlocked(await call(`${s.base}/api/items`, { method: 'PUT', role: 'reader', headers: { 'sec-fetch-site': 'cross-site' } }));
    assert.equal((await call(`${s.base}/api/items`, { method: 'PUT', role: 'reader' })).status, 405);
  });
  test('the origin rule comes before the session: no database query, no informative 401', async () => {
    const before = db.queries.length;
    const r = await call(`${s.base}/api/items`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: BODY });
    isBlocked(r);
    assert.equal(db.queries.length, before);
  });
});

describe('extended SEC-CSRF: static header X-Requested-With on /api/**', () => {
  test('read or write without the header, or with another value → 403; HEAD too', async () => {
    isBlocked(await call(`${s.base}/api/items`, { role: 'reader', headers: { 'x-requested-with': '' } }));
    isBlocked(await call(`${s.base}/api/items`, { role: 'reader', headers: { 'x-requested-with': 'XMLHttpRequest' } }));
    assert.equal((await call(`${s.base}/api/items`, { method: 'HEAD', role: 'reader', headers: { 'x-requested-with': '' } })).status, 403);
    isBlocked(await write({ 'x-requested-with': '', 'sec-fetch-site': 'same-origin' }));
    assert.equal(STATIC_HEADER_VALUE, 'eupadev');
  });
  test('CORS preflight (OPTIONS without the header): 403 without any Access-Control-* header', async () => {
    const r = await call(`${s.base}/api/items`, { method: 'OPTIONS', headers: { 'x-requested-with': '', origin: 'https://evil.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-requested-with,content-type' } });
    isBlocked(r);
    assert.ok([...r.headers.keys()].every((k) => !k.startsWith('access-control-')));
  });
  test('/health, home page and static files: exempt (navigation)', async () => {
    assert.equal((await call(`${s.base}/health`, { headers: { 'x-requested-with': '' } })).status, 200);
    assert.equal((await call(`${s.base}/`, { headers: { 'x-requested-with': '' } })).status, 200);
    assert.equal((await call(`${s.base}/app.js`, { headers: { 'x-requested-with': '' } })).status, 200);
  });
  test('/api without a trailing slash or /apix: routes that do not exist, 404 without going through the rule', async () => {
    assert.equal((await call(`${s.base}/apix`, { headers: { 'x-requested-with': '' } })).status, 404);
  });
  test('review 1: percent-encoded path (/%61pi/items, decoded by the router): the guard still applies', async () => {
    for (const path of ['/%61pi/items', '/api/%69tems', '/%61%70%69/items']) {
      isBlocked(await write({ 'x-requested-with': '', 'sec-fetch-site': 'same-origin' }, undefined, path));
      isBlocked(await write({ 'sec-fetch-site': 'cross-site' }, undefined, path));
      assert.equal((await write({ 'sec-fetch-site': 'same-origin' }, undefined, path)).status, 201, `${path} is routed`);
    }
  });
});

describe('SEC-CSRF: /files/ downloads (navigation, rule 7, D3)', () => {
  const CSV = '/files/items.csv';
  /** @param {Record<string, string>} headers without X-Requested-With, like a navigation */
  const navigate = (headers = {}, path = CSV, method = 'GET') => call(`${s.base}${path}`, { method, role: 'reader', headers: { 'x-requested-with': '', ...headers } });
  test('Sec-Fetch-Site: same-origin passes (without X-Requested-With nor Origin); same-site, cross-site, none, other, missing → 403', async () => {
    assert.equal((await navigate({ 'sec-fetch-site': 'same-origin' })).status, 200);
    for (const v of ['same-site', 'cross-site', 'none', 'other', '']) isBlocked(await navigate({ 'sec-fetch-site': v }));
    isBlocked(await navigate());
    isBlocked(await navigate({ origin: APP_URL }), 'Origin = APP_URL does not replace Sec-Fetch-Site: a navigation does not send it, a cross-site fetch does');
    isBlocked(await navigate({ cookie: COOKIE }));
  });
  test('non-GET method: same rule before the 405; percent-encoded path (/%66iles/); unknown path under /files/ → 403 then 404', async () => {
    isBlocked(await navigate({ 'sec-fetch-site': 'cross-site' }, CSV, 'POST'));
    assert.equal((await navigate({ 'sec-fetch-site': 'same-origin' }, CSV, 'POST')).status, 405);
    isBlocked(await navigate({ 'sec-fetch-site': 'cross-site' }, '/%66iles/items.csv'));
    assert.equal((await navigate({ 'sec-fetch-site': 'same-origin' }, '/%66iles/items.csv')).status, 200);
    isBlocked(await navigate({}, '/files/unknown.pdf'));
    assert.equal((await navigate({ 'sec-fetch-site': 'same-origin' }, '/files/unknown.pdf')).status, 404);
  });
  test('the rule comes before the session: no database query, csrf_blocked counter with the sec-fetch-site rule', async () => {
    const before = db.queries.length;
    const n0 = s.lines().filter((l) => l.event === 'csrf_blocked').length;
    isBlocked(await call(`${s.base}${CSV}`, { headers: { 'x-requested-with': '', 'sec-fetch-site': 'cross-site' } }));
    assert.equal(db.queries.length, before);
    const line = s.lines().filter((l) => l.event === 'csrf_blocked')[n0];
    assert.equal(line?.rule, 'sec-fetch-site');
    assert.equal(line?.url, CSV);
  });
});

describe('csrf_blocked counter', () => {
  test('each refusal writes event csrf_blocked with the rule that played and an increasing counter', async () => {
    const lines = () => s.lines().filter((l) => l.event === 'csrf_blocked');
    const n0 = lines().length;
    await write({ 'sec-fetch-site': 'cross-site' });
    await write({ origin: 'https://evil.test' });
    await write({ cookie: COOKIE });
    await call(`${s.base}/api/items`, { role: 'reader', headers: { 'x-requested-with': '' } });
    const added = lines().slice(n0);
    assert.deepEqual(added.map((l) => l.rule), ['sec-fetch-site', 'origin', 'no-headers', 'x-requested-with']);
    assert.deepEqual(added.map((l) => l.n), added.map((_, i) => n0 + i + 1));
    assert.ok(added.every((l) => l.url === '/api/items' && l.request_id));
    // The response does not say which rule played.
    const r = await write({ cookie: COOKIE });
    assert.equal(r.body.detail, 'Cross-origin request blocked');
  });
});

describe('cases of csrf_test.go ported (Go 1.25, TestCrossOriginProtectionSecFetchSite; Host = APP_URL)', () => {
  /** [name, method, Sec-Fetch-Site, Origin, Go's result, the core's result (if different)] */
  const GO = /** @type {const} */ ([
    ['same-origin allowed', 'POST', 'same-origin', '', 200, 200],
    ['none allowed', 'POST', 'none', '', 200, 403], // deliberate deviation: `none` refused (§2.7 rule 3)
    ['cross-site blocked', 'POST', 'cross-site', '', 403, 403],
    ['same-site blocked', 'POST', 'same-site', '', 403, 403],
    ['no header with GET', 'GET', '', '', 200, 200],
    ['no header with HEAD', 'HEAD', '', '', 200, 200],
    ['no header with OPTIONS', 'OPTIONS', '', '', 200, 200],
    ['no header with PUT', 'PUT', '', '', 200, 200], // without a cookie: like Go; with a cookie: 403 (rule 5), tested apart
    ['matching origin', 'POST', '', APP_URL, 200, 200],
    ['mismatched origin', 'POST', '', 'https://attacker.example', 403, 403],
    ['null origin', 'POST', '', 'null', 403, 403],
  ]);
  for (const [name, method, sfs, origin, go, core] of GO) {
    test(`${name}: Go ${go}, core ${core}`, () => {
      const headers = { ...(sfs ? { 'sec-fetch-site': sfs } : {}), ...(origin ? { origin } : {}) };
      assert.equal(originRefusal({ method, headers, cookies: {} }, APP_URL) === null ? 200 : 403, core);
    });
  }
  test('no header with PUT + session cookie: 403 (rule 5, between Go and Rails)', () => {
    assert.equal(originRefusal({ method: 'PUT', headers: {}, cookies: { [SESSION_COOKIE]: 'x' } }, APP_URL), 'no-headers');
  });
  test('Origin compared with APP_URL, not with Host: a forged Host changes nothing', async () => {
    isBlocked(await write({ origin: 'https://evil.test', host: 'evil.test' }));
  });
});

describe('cases of request_forgery_protection_test.rb ported (Rails 8.1 and PR #56350 :header_only)', () => {
  const rule = (/** @type {string} */ method, /** @type {Record<string, string>} */ headers, withCookie = true) =>
    originRefusal({ method, headers, cookies: withCookie ? { [SESSION_COOKIE]: 'x' } : {} }, APP_URL);
  test('origin checking: correct origin → ok; wrong origin → blocked; null origin → blocked', () => {
    assert.equal(rule('POST', { origin: APP_URL }), null);
    assert.equal(rule('POST', { origin: 'http://bad.host' }), 'origin');
    assert.equal(rule('POST', { origin: 'null' }), 'origin');
  });
  test('no origin: Rails passes (the token remains); core: 403 with a cookie, ok without (deliberate deviation, rule 5)', () => {
    assert.equal(rule('POST', {}), 'no-headers');
    assert.equal(rule('POST', {}, false), null);
  });
  test('should allow get / head', () => {
    assert.equal(rule('GET', {}), null);
    assert.equal(rule('HEAD', {}), null);
  });
  test(':header_only: same-origin ok; cross-site and none blocked; same-site (Rails ok) → 403, deliberate deviation; missing + Origin (Rails blocks) → ok if Origin = APP_URL, deliberate deviation', () => {
    assert.equal(rule('POST', { 'sec-fetch-site': 'same-origin' }), null);
    assert.equal(rule('POST', { 'sec-fetch-site': 'cross-site' }), 'sec-fetch-site');
    assert.equal(rule('POST', { 'sec-fetch-site': 'none' }), 'sec-fetch-site');
    assert.equal(rule('POST', { 'sec-fetch-site': 'same-site' }), 'sec-fetch-site');
    assert.equal(rule('POST', { origin: APP_URL }), null);
    assert.equal(rule('POST', { origin: 'https://evil.test' }), 'origin');
  });
});

describe('SEC-RATE: rate limiting per (operation, actor), fake database', () => {
  const T0 = new Date('2026-10-18T10:00:30Z');
  test('listItems (a read): 120 pass, the 121st → 429 RATE_LIMITED with Retry-After until the end of the minute; other operation not counted; the next minute starts again', async () => {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    try {
      assert.equal(READ_THRESHOLD_PER_MINUTE, 120);
      for (let i = 0; i < READ_THRESHOLD_PER_MINUTE; i++) assert.equal((await call(`${s.base}/api/items`, { role: 'reader' })).status, 200, `call ${i + 1}`);
      const r = await call(`${s.base}/api/items`, { role: 'reader' });
      assert.equal(r.status, 429);
      assert.equal(r.body.code, 'RATE_LIMITED');
      assert.equal(r.headers.get('content-type'), 'application/problem+json; charset=utf-8');
      assert.equal(r.headers.get('retry-after'), '30');
      assert.equal((await call(`${s.base}/api/items/00000000-0000-0000-0000-000000000002`, { role: 'reader' })).status, 404, 'getItem has its own counter');
      mock.timers.setTime(T0.getTime() + 30_000);
      assert.equal((await call(`${s.base}/api/items`, { role: 'reader' })).status, 200);
      assert.ok([...db.counters.keys()].some((k) => k.startsWith('listItems|')));
    } finally { mock.timers.reset(); }
  });
  test('createItem (x-rate-limit: 10): the 11th → 429, even invalid (counted before validation)', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T11:00:00Z') });
    try {
      for (let i = 0; i < 10; i++) assert.equal((await write()).status, 201, `call ${i + 1}`);
      assert.equal((await write()).status, 429);
      const invalid = await call(`${s.base}/api/items`, { method: 'POST', role: 'manager', headers: { 'content-type': 'application/json' }, body: '{"name":12}' });
      assert.equal(invalid.status, 429, 'limiting comes before validation');
      assert.equal(invalid.headers.get('retry-after'), '60');
    } finally { mock.timers.reset(); }
  });
  test('deleteItem (a write without x-rate-limit): 20 pass, the 21st → 429', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T12:00:00Z') });
    try {
      assert.equal(DEFAULT_THRESHOLD_PER_MINUTE, 20);
      const remove = () => call(`${s.base}/api/items/00000000-0000-0000-0000-000000000002`, { method: 'DELETE', role: 'manager' });
      for (let i = 0; i < DEFAULT_THRESHOLD_PER_MINUTE; i++) assert.equal((await remove()).status, 404, `call ${i + 1}`);
      assert.equal((await remove()).status, 429);
    } finally { mock.timers.reset(); }
  });
  test('401 and 403 do not count (session and roles first)', async () => {
    const before = db.counters.size;
    await call(`${s.base}/api/items`);
    await call(`${s.base}/api/items`, { role: 'unknown' });
    assert.equal(db.counters.size, before);
  });
});

describe('safeEqual', () => {
  test('equal → true; different, same length or not → false; strings and buffers', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual(Buffer.from('abc'), 'abc'), true);
    assert.equal(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  });
});

describe('ctx.fetch (fetchNoFollow)', () => {
  /** @type {import('node:http').Server} */ let srv;
  /** @type {string} */ let base;
  before(async () => {
    srv = createServer((req, res) => {
      if (req.url === '/redir') { res.writeHead(302, { location: '/target' }).end(); return; }
      if (req.url === '/slow') return; // never answers
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok ${req.url}`);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(null)));
    base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  });
  after(() => { srv.closeAllConnections(); srv.close(); });
  test('a redirect is not followed: the handler sees the 302', async () => {
    const r = await fetchNoFollow(`${base}/redir`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/target');
  });
  test('redirect of init ignored; normal response read', async () => {
    assert.equal((await fetchNoFollow(`${base}/redir`, { redirect: 'follow' })).status, 302);
    assert.equal(await (await fetchNoFollow(new URL('/x', base))).text(), 'ok /x');
  });
  test('file:, data:, ftp: schemes refused without a request', async () => {
    for (const u of ['file:///etc/passwd', 'data:text/plain,hello', 'ftp://x/']) await assert.rejects(fetchNoFollow(u), /scheme .* refused/);
    await assert.rejects(fetchNoFollow('not a url'), TypeError);
  });
  test('timeout: init.signal replaces the default 10 s', async () => {
    await assert.rejects(fetchNoFollow(`${base}/slow`, { signal: AbortSignal.timeout(100) }), /timeout|abort/i);
  });
});
