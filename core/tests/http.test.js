// HTTP heart on the example tool: closed authorisation, Ajv 2020-12 validation of requests and responses,
// RFC 9457 errors, 404/405/HEAD, strict 415, 413, headers, traceparent, /health, static files, clean shutdown.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { SECURITY_HEADERS } from '../src/index.js';
import { FILE_CAP, fileDisposition, signatureMatches } from '../src/http.js';
import { ajvRequest, compile } from '../src/validation.js';
import { TRAPS, files, items, witness } from './example/api/lib/store.js';
import { call, fakeDb, testServer } from './helpers/server.js';

/** @type {Awaited<ReturnType<typeof testServer>>} */
let s;
before(async () => { s = await testServer(); });
after(() => s.close());

/** @param {Record<string, unknown>} body */
const json = (body, role = 'manager') => ({ method: 'POST', role, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** @param {any} r @param {number} status @param {string} code */
function isProblem(r, status, code) {
  assert.equal(r.status, status);
  assert.equal(r.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  assert.equal(r.body.status, status);
  assert.equal(r.body.code, code);
  assert.equal(r.body.type, 'about:blank');
  assert.match(r.body.error_id, /^[0-9a-f-]{36}$/);
  assert.equal(r.body.instance, `urn:uuid:${r.body.error_id}`);
}

describe('authorisation closed by default', () => {
  test('without a session: 401 problem+json, even on a valid operation', async () => {
    isProblem(await call(`${s.base}/api/items`), 401, 'UNAUTHENTICATED');
  });
  test('role missing from x-roles: 403', async () => {
    isProblem(await call(`${s.base}/api/items`, json({ name: 'a' }, 'reader')), 403, 'FORBIDDEN');
  });
  test('role present: passes', async () => {
    const r = await call(`${s.base}/api/items`, { role: 'reader' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { items: [], next: null });
    assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  });
});

describe('request validation (Ajv 2020-12, closed schemas)', () => {
  test('unknown key in the body: 400 with a pointer, never removed', async () => {
    const r = await call(`${s.base}/api/items`, json({ name: 'a', extra: 1 }));
    isProblem(r, 400, 'VALIDATION_FAILED');
    assert.deepEqual(r.body.errors, [{ pointer: '/body', message: 'unexpected property "extra"' }]);
  });
  test('body outside the schema: pattern, maxLength, type', async () => {
    isProblem(await call(`${s.base}/api/items`, json({ name: '<script>' })), 400, 'VALIDATION_FAILED');
    isProblem(await call(`${s.base}/api/items`, json({ name: 'x'.repeat(81) })), 400, 'VALIDATION_FAILED');
    isProblem(await call(`${s.base}/api/items`, json({ name: 12 })), 400, 'VALIDATION_FAILED');
  });
  test('body with a non-object root or unreadable JSON: 400', async () => {
    isProblem(await call(`${s.base}/api/items`, { ...json({}), body: '[1]' }), 400, 'VALIDATION_FAILED');
    isProblem(await call(`${s.base}/api/items`, { ...json({}), body: '{oops' }), 400, 'BAD_REQUEST');
  });
  test('__proto__ and constructor in the body: 400, never 500', async () => {
    isProblem(await call(`${s.base}/api/items`, { ...json({}), body: '{"name":"a","__proto__":{"x":1}}' }), 400, 'BAD_REQUEST');
    isProblem(await call(`${s.base}/api/items`, { ...json({}), body: '{"name":"a","constructor":{"prototype":{"x":1}}}' }), 400, 'BAD_REQUEST');
  });
  test('U+0000 in a body value, a body key or the query string: 400 with its pointer, never a 500 from PostgreSQL', async () => {
    const r = await call(`${s.base}/api/items`, json({ name: 'a\u0000b' }));
    isProblem(r, 400, 'VALIDATION_FAILED');
    assert.deepEqual(r.body.errors, [{ pointer: '/body/name', message: 'must not contain the NUL character (U+0000)' }]);
    isProblem(await call(`${s.base}/api/items`, { ...json({}), body: '{"name":"a","n\\u0000":1}' }), 400, 'VALIDATION_FAILED');
    const q = await call(`${s.base}/api/items?tags=a%00`, { role: 'reader' });
    isProblem(q, 400, 'VALIDATION_FAILED');
    assert.equal(q.body.errors[0].pointer, '/query/tags/0', 'checked after Ajv: the value is already coerced to an array');
  });
  test('deeply nested body (50 000 arrays): 400, never a 500 from a stack overflow', async () => {
    const deep = `${'['.repeat(50_000)}${']'.repeat(50_000)}`;
    const t = await testServer(); // its own rate-limit counters: createItem allows 10 a minute
    try {
      isProblem(await call(`${t.base}/api/items`, { ...json({}), body: deep }), 400, 'VALIDATION_FAILED');
      isProblem(await call(`${t.base}/api/items`, { ...json({}), body: `{"name":"a","x":${deep}}` }), 400, 'VALIDATION_FAILED');
    } finally {
      await t.close();
    }
  });
  test('query string: type coercion, unknown parameter refused, bounds', async () => {
    items.clear();
    for (const name of ['a', 'b', 'c']) items.set(name, { id: name, name, status: 'open' });
    const r = await call(`${s.base}/api/items?limit=2`, { role: 'reader' });
    assert.equal(r.status, 500, 'the fake ids are not uuids: the response breaks the contract');
    items.clear();
    isProblem(await call(`${s.base}/api/items?limit=abc`, { role: 'reader' }), 400, 'VALIDATION_FAILED');
    isProblem(await call(`${s.base}/api/items?limit=1000`, { role: 'reader' }), 400, 'VALIDATION_FAILED');
    isProblem(await call(`${s.base}/api/items?unknown=1`, { role: 'reader' }), 400, 'VALIDATION_FAILED');
    const ok = await call(`${s.base}/api/items?limit=5&status=open&tags=a&tags=b`, { role: 'reader' });
    assert.equal(ok.status, 200);
  });
  test('path parameter out of format: 400 /params/id', async () => {
    const r = await call(`${s.base}/api/items/not-a-uuid`, { role: 'reader' });
    isProblem(r, 400, 'VALIDATION_FAILED');
    assert.equal(r.body.errors[0].pointer, '/params/id');
  });
  test('uuid: `urn:uuid:` refused (PostgreSQL does not read it, INJ-3); upper case accepted', async () => {
    const r = await call(`${s.base}/api/items/urn:uuid:00000000-0000-0000-0000-000000000002`, { role: 'reader' });
    isProblem(r, 400, 'VALIDATION_FAILED');
    assert.equal(r.body.errors[0].pointer, '/params/id');
    assert.equal((await call(`${s.base}/api/items/0000000A-0000-0000-0000-00000000000B`, { role: 'reader' })).status, 404);
  });
  test('query numbers: Infinity, -Infinity, 1e309 → 400, never a 500 from PostgreSQL (INJ-4)', async () => {
    for (const v of ['Infinity', '-Infinity', '1e309']) {
      const r = await call(`${s.base}/api/items?limit=${v}`, { role: 'reader' });
      isProblem(r, 400, 'VALIDATION_FAILED');
      assert.equal(r.body.errors[0].pointer, '/query/limit', v);
    }
  });
  test('free text: control and format characters stripped (tab and line feed kept); invisible only = empty, refused (INJ-5)', async () => {
    const t = await testServer(); // its own rate-limit counters: createItem allows 10 a minute
    try {
      const r = await call(`${t.base}/api/items`, json({ name: 'BL\u202E123\u200B\u0007', note: 'a\tb\nc\u2066\u00AD' }));
      assert.equal(r.status, 201);
      assert.deepEqual([r.body.name, r.body.note], ['BL123', 'a\tb\nc']);
      const empty = await call(`${t.base}/api/items`, json({ name: '\u200B\u202E\uFEFF' }));
      isProblem(empty, 400, 'VALIDATION_FAILED');
      assert.equal(empty.body.errors[0].pointer, '/body/name');
      // Query string too, after coercion (validated before cleaning: invisible characters count toward maxLength).
      const query = { tags: decodeURIComponent('%E2%80%8Ba') };
      const vQuery = compile(ajvRequest, { type: 'object', additionalProperties: false, properties: { tags: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 20 } } } }, true);
      assert.deepEqual(vQuery(query), []);
      assert.deepEqual(query, { tags: ['a'] });
    } finally {
      await t.close();
    }
  });
});

describe('responses: contract kept on both sides', () => {
  test('creation then read, Location allowed, 204 without a body', async () => {
    const c = await call(`${s.base}/api/items`, json({ name: 'folder' }));
    assert.equal(c.status, 201);
    assert.equal(c.body.status, 'open', 'default applied by useDefaults');
    assert.equal(c.headers.get('location'), `/api/items/${c.body.id}`);
    const g = await call(`${s.base}/api/items/${c.body.id}`, { role: 'reader' });
    assert.deepEqual(g.body, c.body);
    const d = await call(`${s.base}/api/items/${c.body.id}`, { method: 'DELETE', role: 'manager' });
    assert.equal(d.status, 204);
    assert.equal(d.text, '');
    isProblem(await call(`${s.base}/api/items/${c.body.id}`, { role: 'reader' }), 404, 'NOT_FOUND');
  });
  test('response outside the contract (extra column): generic 500, the leak does not go out', async () => {
    const r = await call(`${s.base}/api/items/${TRAPS.outsideContract}`, { role: 'reader' });
    isProblem(r, 500, 'INTERNAL_ERROR');
    assert.ok(!r.text.includes('leak'));
    const line = s.lines().find((l) => l.error_id === r.body.error_id);
    assert.match(line?.err?.message ?? '', /outside the contract/);
  });
  test('handler exception: generic 500, internal message only in the log', async () => {
    const r = await call(`${s.base}/api/items/${TRAPS.exception}`, { role: 'reader' });
    isProblem(r, 500, 'INTERNAL_ERROR');
    assert.equal(r.body.detail, 'An unexpected error occurred');
    assert.ok(!r.text.includes('SELECT'));
    assert.ok(s.lines().some((l) => l.error_id === r.body.error_id && /SELECT \* FROM secrets/.test(l.err?.message)));
  });
  test('forbidden header (Set-Cookie) or undeclared status: 500', async () => {
    isProblem(await call(`${s.base}/api/items/${TRAPS.forbiddenHeader}`, { role: 'reader' }), 500, 'INTERNAL_ERROR');
    isProblem(await call(`${s.base}/api/items/${TRAPS.undeclaredStatus}`, { role: 'reader' }), 500, 'INTERNAL_ERROR');
  });
});

describe('routing', () => {
  test('unknown route: 404 problem+json', async () => {
    isProblem(await call(`${s.base}/api/nope`, { role: 'reader' }), 404, 'NOT_FOUND');
  });
  test('undeclared method: 405 with Allow; OPTIONS too', async () => {
    const r = await call(`${s.base}/api/items`, { method: 'PUT', role: 'manager' });
    isProblem(r, 405, 'METHOD_NOT_ALLOWED');
    assert.equal(r.headers.get('allow'), 'GET, HEAD, POST');
    const o = await call(`${s.base}/api/items/${TRAPS.exception}`, { method: 'OPTIONS' });
    assert.equal(o.status, 405);
    assert.equal(o.headers.get('allow'), 'GET, HEAD, DELETE');
  });
  test('QUERY (without Content-Type, with a body): 405 with Allow, not 400 (Schemathesis unsupported_method)', async () => {
    for (const init of [{}, { body: '{}', headers: { 'content-type': 'application/json' } }]) {
      const r = await call(`${s.base}/api/items`, { method: 'QUERY', role: 'manager', ...init });
      isProblem(r, 405, 'METHOD_NOT_ALLOWED');
      assert.equal(r.headers.get('allow'), 'GET, HEAD, POST');
    }
    const f = await call(`${s.base}/files/items.csv`, { method: 'QUERY', role: 'reader', headers: { 'sec-fetch-site': 'same-origin' } });
    isProblem(f, 405, 'METHOD_NOT_ALLOWED');
    assert.equal(f.headers.get('allow'), 'GET');
  });
  test('method Fastify does not route (PROPFIND): 404 problem+json', async () => {
    isProblem(await call(`${s.base}/api/items`, { method: 'PROPFIND', role: 'manager' }), 404, 'NOT_FOUND');
  });
  test('HEAD derived from GET: 200 without a body', async () => {
    const r = await call(`${s.base}/api/items`, { method: 'HEAD', role: 'reader' });
    assert.equal(r.status, 200);
    assert.equal(r.text, '');
  });
});

describe('content types (strict 415) and size (413)', () => {
  test('text/plain, utf-16 charset, invalid type, body without Content-Type', async () => {
    const body = JSON.stringify({ name: 'a' });
    // (the leading space is removed by every HTTP client: that case is in advisory-replay.test.js, over a raw socket)
    for (const ct of ['text/plain', 'application/json; charset=utf-16', 'application/json garbage', 'application/json\ta', 'application/xml']) {
      const r = await call(`${s.base}/api/items`, { method: 'POST', role: 'manager', headers: { 'content-type': ct }, body });
      isProblem(r, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const without = await call(`${s.base}/api/items`, { method: 'POST', role: 'manager', body, headers: { 'content-type': '' } });
    assert.equal(without.status, 415);
  });
  test('utf-8 charset accepted, in upper case too', async () => {
    const r = await call(`${s.base}/api/items`, { ...json({ name: 'a' }), headers: { 'content-type': 'Application/JSON; charset=UTF-8' } });
    assert.equal(r.status, 201);
  });
  test('body on an operation without requestBody: 415', async () => {
    const r = await call(`${s.base}/api/items/${TRAPS.exception}`, { method: 'DELETE', role: 'manager', headers: { 'content-type': 'application/json' }, body: '{}' });
    isProblem(r, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });
  test('1 MiB + 1 byte: 413', async () => {
    const r = await call(`${s.base}/api/items`, { ...json({}), body: `{"name":"${'x'.repeat(1_048_576)}"}` });
    isProblem(r, 413, 'PAYLOAD_TOO_LARGE');
    // Answered before reading, connection kept: a proxy still writing the body would turn a close into a 502 (Caddy).
    assert.notEqual(r.headers.get('connection'), 'close');
  });
});

describe('file bodies (uploads, decision E5)', () => {
  const ID = '00000000-0000-0000-0000-0000000000f1';
  const URL_ = () => `${s.base}/api/items/${ID}/attachment`;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  /** @param {string} type @param {Buffer | string} body */
  const send = (type, body, role = 'manager') => call(URL_(), { method: 'PUT', role, headers: { 'content-type': type }, body });
  before(() => { items.set(ID, { id: ID, name: 'with file', status: 'open' }); });

  test('signatureMatches: PNG, JPEG, PDF by their first bytes; anything else refused', () => {
    assert.ok(signatureMatches('image/png', PNG));
    assert.ok(signatureMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
    assert.ok(signatureMatches('application/pdf', Buffer.from('%PDF-1.7')));
    assert.ok(!signatureMatches('image/png', Buffer.from('<html>')));
    assert.ok(!signatureMatches('image/png', PNG.subarray(0, 7)), 'truncated signature');
    assert.ok(!signatureMatches('image/svg+xml', Buffer.from('<svg/>')));
  });
  test('a valid file reaches the handler as { type, body }, then downloads as an attachment', async () => {
    const r = await send('image/png', PNG);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { type: 'image/png', size: PNG.length });
    assert.deepEqual(files.get(ID), { type: 'image/png', body: PNG });
    const d = await fetch(`${s.base}/files/items/${ID}/attachment`, { headers: { 'x-test-session': 'reader', 'sec-fetch-site': 'same-origin' } });
    assert.equal(d.status, 200);
    assert.equal(d.headers.get('content-type'), 'image/png');
    assert.equal(d.headers.get('content-disposition'), "attachment; filename*=UTF-8''photo.png");
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await d.arrayBuffer()), PNG);
  });
  test('undeclared type, content that is not its declared type, JSON, empty body, over x-max-bytes: refused before the handler', async () => {
    files.clear();
    isProblem(await send('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 415, 'UNSUPPORTED_MEDIA_TYPE');
    isProblem(await send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    isProblem(await send('text/html', '<script>alert(1)</script>'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    isProblem(await send('application/json', '{}'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const r = await send('image/png', '<html><script>alert(1)</script></html>');
    isProblem(r, 415, 'FILE_TYPE_MISMATCH');
    assert.equal(r.body.detail, 'File content is not image/png');
    isProblem(await send('application/pdf', PNG), 415, 'FILE_TYPE_MISMATCH');
    isProblem(await send('image/png', Buffer.alloc(0)), 400, 'FILE_REQUIRED');
    isProblem(await call(URL_(), { method: 'PUT', role: 'manager' }), 400, 'FILE_REQUIRED');
    const big = await send('image/png', Buffer.concat([PNG, Buffer.alloc(1024)]));
    isProblem(big, 413, 'PAYLOAD_TOO_LARGE');
    assert.notEqual(big.headers.get('connection'), 'close');
    assert.equal(files.size, 0, 'nothing reached the handler');
  });
  test('Content-Type parameters and case are tolerated; auth and roles come first', async () => {
    assert.equal((await send('Image/PNG; foo=bar', PNG)).status, 200);
    isProblem(await send('image/png', PNG, 'reader'), 403, 'FORBIDDEN');
    isProblem(await call(URL_(), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }), 401, 'UNAUTHENTICATED');
  });
  test('a file type on a JSON operation: 415', async () => {
    isProblem(await call(`${s.base}/api/items`, { method: 'POST', role: 'manager', headers: { 'content-type': 'image/png' }, body: PNG }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('headers, log, traceparent', () => {
  test('the eight headers and Cache-Control: no-store on every response, errors included', async () => {
    for (const r of [await call(`${s.base}/api/items`, { role: 'reader' }), await call(`${s.base}/api/nope`), await call(`${s.base}/health`)]) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(name), value, name);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('x-powered-by'), null);
    }
  });
  test('valid traceparent taken, invalid one replaced, present in the log', async () => {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const r = await call(`${s.base}/api/items`, { role: 'reader', headers: { traceparent: tp } });
    assert.equal(r.headers.get('traceparent'), tp);
    assert.ok(s.lines().some((l) => l.request_id === tp && l.msg === 'request' && l.status === 200 && l.method === 'GET'));
    for (const fake of ['00-00000000000000000000000000000000-00f067aa0ba902b7-01', 'whatever', '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01']) {
      const r2 = await call(`${s.base}/api/items`, { role: 'reader', headers: { traceparent: fake } });
      const returned = r2.headers.get('traceparent') ?? '';
      assert.notEqual(returned, fake);
      assert.match(returned, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
  });
  test('the log redacts secrets and holds no per-request line from Fastify', async () => {
    const r = await call(`${s.base}/api/items`, { role: 'reader', headers: { authorization: 'Bearer secret-xyz', cookie: '__Host-session=abc' } });
    assert.equal(r.status, 200);
    const all = JSON.stringify(s.lines());
    assert.ok(!all.includes('secret-xyz') && !all.includes('__Host-session=abc'));
    assert.ok(!s.lines().some((l) => l.msg === 'incoming request'));
  });
});

describe('/health and static files', () => {
  test('/health: 200 with the database, 503 without', async () => {
    const ok = await call(`${s.base}/health`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { status: 'ok' });
    const down = await testServer({ db: fakeDb({ health: false }), web: false });
    try {
      const r = await call(`${down.base}/health`);
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { status: 'unavailable' });
    } finally { await down.close(); }
  });
  test('web/: index, types, ETag/304, 404 problem+json, no traversal', async () => {
    const index = await call(`${s.base}/`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(index.headers.get('etag') ?? '', /^"[A-Za-z0-9_-]{27}"$/);
    assert.equal(index.headers.get('cache-control'), 'no-cache');
    const js = await call(`${s.base}/app.js`);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const cache = await call(`${s.base}/app.js`, { headers: { 'if-none-match': js.headers.get('etag') ?? '' } });
    assert.equal(cache.status, 304);
    isProblem(await call(`${s.base}/nope.js`), 404, 'NOT_FOUND');
    for (const path of ['/%2e%2e/package.json', '/..%2fpackage.json', '/%5c..%5cpackage.json', '/web/../package.json', '/index.html/']) {
      const r = await call(`${s.base}${path}`);
      assert.ok(r.status === 404 || r.status === 400, `${path} → ${r.status}`);
      assert.ok(!r.text.includes('"name"'), path);
    }
  });
  test('the core\'s dictionaries are served under /core/lang/', async () => {
    const en = await call(`${s.base}/core/lang/en.json`);
    assert.equal(en.status, 200);
    assert.equal(en.headers.get('content-type'), 'application/json');
    assert.equal(en.body['form.saved'], 'Saved.');
    assert.equal((await call(`${s.base}/core/lang/fr.json`)).status, 200);
  });
});

describe('clean shutdown', () => {
  test('close() closes idle connections and frees the port', async () => {
    const other = await testServer({ web: false });
    assert.equal((await call(`${other.base}/health`)).status, 200);
    const start = Date.now();
    await other.close();
    assert.ok(Date.now() - start < 5_000);
    await assert.rejects(fetch(`${other.base}/health`));
  });
});

describe('downloads (/files/, D3)', () => {
  const CSV = '/files/items.csv';
  /** GET /files/… like a same-origin navigation (neither X-Requested-With nor Origin). */
  const download = (/** @type {string} */ path = CSV, /** @type {RequestInit & { role?: string }} */ init = {}) =>
    call(`${s.base}${path}`, { role: 'reader', ...init, headers: { 'x-requested-with': '', 'sec-fetch-site': 'same-origin', ...init.headers } });

  test('fileDisposition: attachment, filename* RFC 8187, name sanitised (../, quotes, line breaks, non-ASCII, empty)', () => {
    assert.equal(fileDisposition('items.csv'), "attachment; filename*=UTF-8''items.csv");
    assert.equal(fileDisposition('../../etc/passwd'), "attachment; filename*=UTF-8''_.._etc_passwd");
    assert.equal(fileDisposition('..\\..\\x.csv'), "attachment; filename*=UTF-8''_.._x.csv");
    assert.equal(fileDisposition('a"b.csv'), "attachment; filename*=UTF-8''a_b.csv");
    assert.equal(fileDisposition('a\r\nContent-Type: text/html\r\n.csv'), "attachment; filename*=UTF-8''a_Content-Type%3A%20text_html_.csv");
    assert.equal(fileDisposition('\u00e9t\u00e9 (1)*.csv'), "attachment; filename*=UTF-8''%C3%A9t%C3%A9%20%281%29%2A.csv");
    assert.equal(fileDisposition(''), "attachment; filename*=UTF-8''file");
    assert.equal(fileDisposition('a\ud800.csv'), "attachment; filename*=UTF-8''a%EF%BF%BD.csv", 'lone surrogate replaced, no URIError');
    assert.equal(fileDisposition('.htaccess'), "attachment; filename*=UTF-8''htaccess");
    assert.equal(fileDisposition('x'.repeat(300)).length, "attachment; filename*=UTF-8''".length + 200);
  });
  test('streamed CSV: 200, text/csv, attachment, nosniff, no-store, right content; the query string is validated', async () => {
    items.clear();
    items.set('00000000-0000-0000-0000-000000000011', { id: '00000000-0000-0000-0000-000000000011', name: 'Screw "M6"', status: 'open' });
    items.set('00000000-0000-0000-0000-000000000012', { id: '00000000-0000-0000-0000-000000000012', name: 'Nut', status: 'closed' });
    const r = await download();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(r.headers.get('content-disposition'), "attachment; filename*=UTF-8''items.csv");
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.text, 'id,name,status\r\n00000000-0000-0000-0000-000000000011,"Screw ""M6""",open\r\n00000000-0000-0000-0000-000000000012,"Nut",closed\r\n');
    assert.equal((await download(`${CSV}?status=closed`)).text, 'id,name,status\r\n00000000-0000-0000-0000-000000000012,"Nut",closed\r\n');
    isProblem(await download(`${CSV}?status=other`), 400, 'VALIDATION_FAILED');
    isProblem(await download(`${CSV}?unknown=1`), 400, 'VALIDATION_FAILED');
  });
  test('without a session: 401; role missing from x-roles: 403; X-Requested-With is not required', async () => {
    isProblem(await download(CSV, { role: undefined }), 401, 'UNAUTHENTICATED');
    isProblem(await download(CSV, { role: 'unknown' }), 403, 'FORBIDDEN');
  });
  test('trapped name (../"\u00e9 t\u00e9s"\\r\\n.csv): sanitised in Content-Disposition, Buffer sent', async () => {
    const r = await download(`${CSV}?trap=name`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-disposition'), "attachment; filename*=UTF-8''_%C3%A9%20t%C3%A9s_.csv");
    assert.equal(r.text, 'id\r\n');
  });
  test('type not declared for the operation: generic 500, nothing is sent', async () => {
    const r = await download(`${CSV}?trap=type`);
    isProblem(r, 500, 'INTERNAL_ERROR');
    assert.equal(r.headers.get('content-disposition'), null);
    assert.ok(s.lines().some((l) => l.level === 50 && /exportItems: a download returns/.test(l.err?.message)));
    assert.equal(witness.stream?.destroyed, true, 'the refused stream is destroyed, not left open');
  });
  test('50 MiB cap on a stream: the response is cut, less than 51 MiB received, file_truncated log', async () => {
    const res = await fetch(`${s.base}${CSV}?trap=cap`, { headers: { 'x-test-session': 'reader', 'sec-fetch-site': 'same-origin' } });
    assert.equal(res.status, 200);
    let received = 0;
    let cut = false;
    try { for await (const chunk of /** @type {ReadableStream<Uint8Array>} */ (res.body)) received += chunk.length; } catch { cut = true; }
    assert.equal(cut, true, 'the client sees an interrupted response');
    assert.ok(received <= FILE_CAP + 1024 * 1024, `${received} bytes received`);
    const line = s.lines().find((l) => l.event === 'file_truncated');
    assert.equal(line?.operation, 'exportItems');
    assert.ok(line?.bytes > FILE_CAP);
  });
  test('HEAD, POST, PUT, DELETE on /files/: 405 with Allow: GET (no derived HEAD)', async () => {
    for (const method of ['HEAD', 'POST', 'PUT', 'DELETE']) {
      const r = await download(CSV, { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.get('allow'), 'GET');
    }
  });
});
