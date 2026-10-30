// Permanent replay of the security advisories of Fastify, find-my-way, Hono and @hono/node-server (§2.1.4 of the
// research, list of cases): each case has its expected status; never 200, never 500, never a crash. To be extended
// with each new advisory. The cases an HTTP client would normalise (leading space, lower-case method, 1 001 headers,
// endless chunked body) go through a raw socket.
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { call, testServer } from './helpers/server.js';

/** @type {Awaited<ReturnType<typeof testServer>>} */
let s;
before(async () => { s = await testServer({ timeouts: { requestTimeout: 700, connectionTimeout: 700 } }); });
after(() => s.close());

/**
 * Raw request; returns the status line (or '' if the server cut without answering) and the body.
 * @param {string} raw
 */
function socket(raw) {
  return new Promise((resolve, reject) => {
    const c = connect(s.port, '127.0.0.1');
    let received = '';
    c.setEncoding('utf8');
    c.on('data', (d) => { received += d; });
    c.on('error', reject);
    c.on('close', () => resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(received)?.[1] ?? 0), received }));
    c.write(raw);
    setTimeout(() => c.destroy(), 2_500).unref();
  });
}
/** @param {{ status: number, text: string }} r @param {number[]} expected @param {string} name */
function expect(r, expected, name) {
  assert.ok(expected.includes(r.status), `${name}: ${r.status} (expected ${expected.join('/')})`);
  assert.ok(!r.text.includes('node_modules') && !/\.js:\d+/.test(r.text), `${name}: internal trace in the response`);
}

describe('paths', () => {
  test('encodings, double slash, semicolon, case, __proto__', async () => {
    for (const [path, codes] of /** @type {[string, number[]][]} */ ([
      ['/api/items/%2F..%2Fadmin', [400, 404]], ['//api/items', [404]], ['/api/items/..;/', [400, 404]], ['/API/ITEMS', [404]],
      ['/api/items/__proto__', [400, 404]], ['/api/__proto__/items', [404]], ['/api/items/%', [400, 404]], ['/api/items/%00', [400, 404]],
      ['/api/items/' + 'a'.repeat(200), [400, 404, 414]], ['/api/items?limit=1&limit=2', [400]], ['/api/items?__proto__[x]=1', [400]],
      ['/api/items?constructor[prototype][x]=1', [400]],
    ])) expect(await call(`${s.base}${path}`, { role: 'reader' }), codes, path);
  });
  test('static files: %5C, %2F, .. and absolute paths', async () => {
    for (const path of ['/%5C..%5Cpackage.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '//etc/passwd', '/app.js%00.html']) {
      expect(await call(`${s.base}${path}`), [400, 404], path);
    }
    // Literal `..`: a WHATWG client resolves it before sending, hence a raw socket.
    for (const path of ['/web/../../package.json', '/app.js/..', '/../package.json']) {
      const r = await socket(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      assert.ok([400, 404].includes(r.status), `${path}: ${r.status}`);
      assert.ok(!r.received.includes('"name"'), path);
    }
  });
});

describe('methods', () => {
  test('HEAD, OPTIONS, unknown method, lower-case method', async () => {
    expect(await call(`${s.base}/api/items`, { method: 'HEAD', role: 'reader' }), [200], 'HEAD');
    expect(await call(`${s.base}/api/items`, { method: 'OPTIONS' }), [405], 'OPTIONS');
    expect(await call(`${s.base}/api/items`, { method: 'PURGE' }), [404, 405], 'PURGE');
    const r = await socket('get /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\n\r\n');
    assert.ok(r.status === 400 || r.status === 0, `lower-case method: ${r.status}`);
  });
});

describe('headers and content types', () => {
  test('malformed Content-Type over a raw socket: leading space, tab, garbage, doubled parameters', async () => {
    const body = '{"name":"a"}';
    // The leading space ("Content-Type:  application/json") is an OWS that Node's HTTP parser removes: it is a normal
    // header, accepted (201); everything else is refused.
    for (const [ct, codes] of /** @type {[string, number[]][]} */ ([['  application/json', [201]], ['application/json\ta', [400, 415]],
      ['application/json garbage', [400, 415]], ['application/json; charset=utf-8; charset=utf-16', [400, 415]], ['application/json;;', [400, 415]],
      ['application/ json', [400, 415]], ['application/json\r\n x', [400, 415]]])) {
      const r = await socket(`POST /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\nx-test-session: manager\r\nContent-Type:${ct}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      assert.ok(codes.includes(r.status), `${JSON.stringify(ct)}: ${r.status}`);
    }
  });
  test('X-Forwarded-For from a direct connection: ignored (trustProxy false)', async () => {
    await call(`${s.base}/api/items`, { role: 'reader', headers: { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https', traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' } });
    const line = s.lines().find((l) => l.request_id === '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' && l.msg === 'request');
    assert.equal(line?.ip, '127.0.0.1');
  });
  test('1 001 headers or headers too large: 431, no crash', async () => {
    const headers = Array.from({ length: 1001 }, (_, i) => `X-H${i}: ${'v'.repeat(20)}`).join('\r\n');
    const r = await socket(`GET /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\n${headers}\r\n\r\n`);
    assert.ok([431, 400].includes(r.status), `1001 headers: ${r.status}`);
    assert.equal((await call(`${s.base}/health`)).status, 200, 'the server still answers');
  });
  test('Host missing, negative or non-numeric Content-Length, Transfer-Encoding and Content-Length together', async () => {
    for (const raw of [
      'GET /api/items HTTP/1.1\r\n\r\n',
      'POST /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\nContent-Type: application/json\r\nContent-Length: -1\r\n\r\n',
      'POST /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\nContent-Type: application/json\r\nContent-Length: abc\r\n\r\n',
      'POST /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\nContent-Type: application/json\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}',
    ]) {
      const r = await socket(raw);
      assert.ok([400, 0].includes(r.status), `${JSON.stringify(raw.slice(0, 60))}: ${r.status}`);
    }
  });
});

describe('bodies and timeouts', () => {
  test('1 MiB + 1: 413; lying Content-Length: 400', async () => {
    expect(await call(`${s.base}/api/items`, { method: 'POST', role: 'manager', headers: { 'content-type': 'application/json' }, body: `{"name":"${'x'.repeat(1_048_576)}"}` }), [413], '1 MiB + 1');
    const r = await socket('POST /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\nx-test-session: manager\r\nContent-Type: application/json\r\nContent-Length: 5\r\nConnection: close\r\n\r\n{"name":"a"}');
    assert.ok([400, 413, 0].includes(r.status), `lying Content-Length: ${r.status}`);
  });
  test('endless Transfer-Encoding: chunked: connection cut after requestTimeout (408 or a plain close by Node)', async () => {
    const start = Date.now();
    const r = await socket('POST /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\nx-test-session: manager\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{"na');
    assert.ok([408, 0].includes(r.status), `endless chunked: ${r.status}`);
    assert.ok(Date.now() - start < 2_000, 'the request timeout played');
  });
  test('headers never sent: connection cut after connectionTimeout', async () => {
    const r = await socket('GET /api/items HTTP/1.1\r\nHost: x\r\nX-Requested-With: eupadev\r\n');
    assert.ok([408, 0].includes(r.status), `incomplete headers: ${r.status}`);
  });
  test('after all that, the server still answers without an internal error line', async () => {
    assert.equal((await call(`${s.base}/health`)).status, 200);
    assert.deepEqual(s.lines().filter((l) => l.level >= 50).map((l) => l.msg), []);
  });
});
