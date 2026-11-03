// The twelve mechanical checks of the SEC-* catalogue, generated from the contract: `generateCases()` returns
// a list `{ sec, name, verify }`; `verify()` throws if the tool departs from what is expected. Independent of the
// runner: `for (const c of cases) test(c.name, c.verify)` under node:test as under @playwright/test.
// The expected values (headers, cookie attributes, codes) are written here, never read from `src/`.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { REQUEST_HEADERS, signIn, compliantExample, invalidValues, readContract, httpBrowser } from './index.js';

/**
 * Eight security headers, at their exact value (and `Cache-Control: no-store` on every API or error answer); with
 * OIDC, `form-action` also names the IdP's origin (sign-out answers 303 to its end-session page): `idpOrigin`.
 */
export const EXPECTED_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types eupadev dompurify",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});
/** Rate limits without `x-rate-limit`: write, read (GET). */
export const DEFAULT_RATE = 20;
export const READ_RATE = 120;
/** Keys an attacker adds to a valid body (SEC-MASS). */
export const MASS_KEYS = ['role', 'is_admin', 'deleted_at', 'owner_id'];
/** Signature bytes of each upload type, written here, never read from `src/` (SEC-UPLOAD). */
const SIGNATURES = /** @type {Record<string, number[]>} */ ({
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'application/pdf': [...Buffer.from('%PDF-1.7\n')],
});

/**
 * A file of `type` that passes the signature check, `size` bytes long (padding after the signature).
 * @param {string} type @param {number} [size]
 */
export function exampleFile(type, size = 64) {
  const sig = SIGNATURES[type] ?? assert.fail(`no sample for ${type}`);
  return Buffer.concat([Buffer.from(sig), Buffer.alloc(Math.max(0, size - sig.length), 0x20)]);
}

/** What never leaves an error (SEC-ERR): stack trace, SQL, source file. */
const LEAKS = [/\n\s+at /, /\bat (?:file:|node:|\/)/, /SELECT/, /\.js:\d/, /node_modules/];
const PROBLEM_FIELDS = new Set(['type', 'title', 'status', 'detail', 'instance', 'code', 'error_id', 'errors']);

/** @typedef {import('./index.js').Person} Person */
/** @typedef {import('../src/contract.js').Operation} Operation */
/** @typedef {{ sec: string, name: string, verify: () => Promise<void> }} Case */
/** @typedef {{ status: number, headers: Headers, text: string, json: any }} KitResponse */
/**
 * @typedef {object} Options
 * @property {string} contract path of `openapi.yaml` (its directory is the tool's root: SEC-STATIC)
 * @property {string} base origin of the tool (`APP_URL`)
 * @property {Person[]} people accounts of the test realm and their client roles
 * @property {number} [inactivityMinutes] the tool's `SESSION_IDLE_MINUTES` (30 by default)
 * @property {string} [idpOrigin] origin of the tool's `OIDC_ISSUER` (default: `base`, where the test Compose serves Keycloak)
 * @property {() => Promise<void>} [reset] resets `rate_limits` before each check (test database)
 * @property {{ operationId: string, params?: Record<string, unknown>, query?: Record<string, unknown>, body?: unknown }[]} [failures] requests that force a 500 (SEC-ERR)
 */

/**
 * One request to the tool, static headers set; a `null` value in `headers` removes the header.
 * @param {string} base
 * @param {{ method?: string, path: string, query?: Record<string, unknown>, body?: unknown, raw?: string, file?: { type: string, body: Buffer }, cookie?: string, headers?: Record<string, string|null> }} o
 *   `file`: raw body sent with its own Content-Type (upload operations)
 * @returns {Promise<KitResponse>}
 */
export async function call(base, o) {
  const url = new URL(base);
  url.pathname = o.path; // raw pathname: the `%2e%2e%2f` of SEC-STATIC are not normalised
  for (const [k, v] of Object.entries(o.query ?? {})) for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(x));
  const headers = new Headers();
  for (const [k, v] of Object.entries({ ...REQUEST_HEADERS, ...o.headers })) if (v !== null) headers.set(k, v);
  if (o.cookie) headers.set('cookie', o.cookie);
  /** @type {string | Buffer | undefined} */ let body = o.raw;
  if (o.body !== undefined) body = JSON.stringify(o.body);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (o.file !== undefined) {
    body = o.file.body;
    headers.set('content-type', o.file.type);
  }
  const r = await fetch(url, { method: o.method ?? 'GET', headers, body, redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, text, json };
}

/**
 * @param {KitResponse} r @param {number} status @param {string|null} code @param {string} where
 */
function problem(r, status, code, where) {
  assert.equal(r.status, status, `${where}: ${r.status} instead of ${status} — ${r.text.slice(0, 300)}`);
  assert.match(r.headers.get('content-type') ?? '', /^application\/problem\+json/, `${where}: problem+json expected`);
  if (code !== null) assert.equal(r.json?.code, code, `${where}: code ${r.json?.code} instead of ${code}`);
  for (const k of Object.keys(r.json ?? {})) assert.ok(PROBLEM_FIELDS.has(k), `${where}: field ${k} outside the RFC 9457 envelope`);
}

/** @param {KitResponse} r @param {string} where */
function noLeak(r, where) {
  for (const f of LEAKS) assert.doesNotMatch(r.text, f, `${where}: leak ${f} in ${r.text.slice(0, 300)}`);
}

/** @param {string} sc */
function readCookie(sc) {
  const [pair = '', ...attributes] = sc.split(';');
  /** @type {Map<string, string>} */ const a = new Map();
  for (const x of attributes) {
    const [k = '', ...v] = x.trim().split('=');
    a.set(k.toLowerCase(), v.join('='));
  }
  return { name: pair.slice(0, pair.indexOf('=')).trim(), attributes: a };
}

/**
 * The SEC-* checks of the tool described by `o.contract`.
 * @param {Options} o
 * @returns {Case[]}
 */
export function generateCases(o) {
  const contract = readContract(o.contract);
  const root = dirname(o.contract);
  const inactivity = (o.inactivityMinutes ?? 30) * 60;
  const formAction = `form-action 'self' ${o.idpOrigin ?? new URL(o.base).origin}`;
  const expected = { ...EXPECTED_HEADERS, 'content-security-policy': EXPECTED_HEADERS['content-security-policy'].replace("form-action 'self'", formAction) };
  /** @type {Case[]} */
  const cases = [];
  /** @param {string} sec @param {string} name @param {() => Promise<void>} fn */
  const add = (sec, name, fn) => cases.push({ sec, name: `${sec} ${name}`, verify: async () => { await o.reset?.(); await fn(); } });

  // Sign-in of each person, once, at the first check that needs it. The session is the host's whole `Cookie`
  // header, as a browser would send it: a misnamed cookie fails SEC-COOKIE, not the whole kit.
  /** @type {Promise<Map<string, { cookie: string, setCookies: string[] }>> | null} */
  let signIns = null;
  const sessions = () => (signIns ??= (async () => {
    /** @type {Map<string, { cookie: string, setCookies: string[] }>} */ const m = new Map();
    for (const p of o.people) {
      const client = httpBrowser();
      const steps = await signIn(client, o.base, p);
      const cookie = client.cookies(new URL(o.base).hostname);
      // Cookies set by the core (`/auth/…`), not the IdP's (same origin in the test Compose).
      const setCookies = steps.filter((e) => e.url.startsWith(`${o.base}/auth/`)).flatMap((e) => e.headers.getSetCookie());
      const back = steps.find((e) => e.url.startsWith(`${o.base}/auth/callback`));
      if (back?.status !== 303) throw new Error(`${p.name}: sign-in not completed (${steps.map((e) => `${e.status} ${e.url}`).join(' → ')})`);
      m.set(p.name, { cookie, setCookies });
    }
    return m;
  })());
  /** @param {Person} p */
  const cookieOf = async (p) => /** @type {{ cookie: string }} */ ((await sessions()).get(p.name)).cookie;
  /** @param {Operation} op */
  const allowed = (op) => o.people.find((p) => p.roles.some((r) => op.roles.includes(r)))
    ?? assert.fail(`${op.operationId}: no person of the kit has one of the roles ${op.roles.join(', ')}`);

  /** Valid request of an operation (values drawn from the schema, checked by Ajv). @param {Operation} op */
  const valid = (op) => ({
    method: op.method,
    params: /** @type {Record<string, unknown>} */ (compliantExample(op.schemas.params, `${op.operationId} path`, true)),
    query: /** @type {Record<string, unknown>} */ (compliantExample(op.schemas.query, `${op.operationId} query`, true)),
    body: op.schemas.body ? compliantExample(op.schemas.body, `${op.operationId} body`) : undefined,
  });
  /** @param {Operation} op @param {Record<string, unknown>} params */
  const path = (op, params) => op.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(String(params[n])));
  /** @param {Operation} op @param {{ params?: Record<string, unknown>, query?: Record<string, unknown>, body?: unknown, cookie?: string, headers?: Record<string, string|null>, raw?: string, file?: { type: string, body: Buffer } }} [x] */
  const callOp = (op, x = {}) => {
    const v = valid(op);
    const body = 'body' in x ? x.body : v.body;
    return call(o.base, {
      method: op.method, path: path(op, x.params ?? v.params), query: x.query ?? v.query,
      ...(x.raw === undefined ? { body } : { raw: x.raw }), file: x.file, cookie: x.cookie, headers: x.headers,
    });
  };
  const isWrite = (/** @type {Operation} */ op) => op.method !== 'GET';
  const isFile = (/** @type {Operation} */ op) => op.path.startsWith('/files/');

  // SEC-COOKIE: every cookie the core sets during sign-in.
  add('SEC-COOKIE', 'sign-in cookies', async () => {
    for (const [name, { setCookies }] of await sessions()) {
      const read = setCookies.map(readCookie);
      const session = read.find((c) => c.name === '__Host-session' && c.attributes.get('max-age') !== '0');
      assert.ok(session, `${name}: no session cookie among ${setCookies.join(' | ')}`);
      assert.equal(session.attributes.get('max-age'), String(inactivity), `${name}: Max-Age ≠ inactivity (${inactivity} s)`);
      for (const c of read) {
        const where = `${name}: cookie ${c.name}`;
        assert.ok(c.name.startsWith('__Host-'), `${where}: __Host- prefix expected`);
        assert.ok(!c.attributes.has('domain'), `${where}: Domain forbidden`);
        assert.equal(c.attributes.get('path'), '/', `${where}: Path=/ expected`);
        assert.ok(c.attributes.has('secure') && c.attributes.has('httponly'), `${where}: Secure and HttpOnly expected`);
        assert.equal(c.attributes.get('samesite')?.toLowerCase(), 'lax', `${where}: SameSite=Lax expected`);
      }
    }
  });

  // SEC-HEAD: a page, an API read, a 404.
  const readOp = contract.operations.find((op) => op.method === 'GET' && !isFile(op) && !op.path.includes('{'));
  /** @param {KitResponse} r @param {string} where @param {boolean} [page] */
  const headers = (r, where, page = false) => {
    for (const [k, v] of Object.entries(expected)) assert.equal(r.headers.get(k), v, `${where}: header ${k}`);
    // A static page is revalidated (`no-cache` + ETag, static.js); data is never kept.
    if (!page) assert.equal(r.headers.get('cache-control'), 'no-store', `${where}: header cache-control`);
  };
  add('SEC-HEAD', 'page /', async () => headers(await call(o.base, { path: '/' }), '/', true));
  add('SEC-HEAD', '404', async () => {
    const r = await call(o.base, { path: '/kit-nonexistent-path' });
    assert.equal(r.status, 404);
    headers(r, '404');
  });
  if (readOp) {
    add('SEC-HEAD', `API ${readOp.operationId}`, async () => {
      const r = await callOp(readOp, { cookie: await cookieOf(allowed(readOp)) });
      assert.equal(r.status, 200, r.text);
      headers(r, readOp.operationId);
    });
  }

  for (const op of contract.operations) {
    const id = op.operationId;
    add('SEC-AUTH', id, async () => problem(await callOp(op), 401, 'UNAUTHENTICATED', id));

    for (const p of o.people.filter((x) => !x.roles.some((r) => op.roles.includes(r)))) {
      add('SEC-ROLE', `${id} by ${p.name} (${p.roles.join(', ')})`, async () => problem(await callOp(op, { cookie: await cookieOf(p) }), 403, 'FORBIDDEN', id));
    }

    add('SEC-BYPASS', id, async () => {
      for (const r of op.roles) problem(await callOp(op, { headers: { 'x-test-session': r } }), 401, 'UNAUTHENTICATED', `${id} x-test-session: ${r}`);
      for (const p of o.people) problem(await callOp(op, { headers: { 'x-test-user': p.name, 'x-forwarded-user': p.name, 'remote-user': p.name } }), 401, 'UNAUTHENTICATED', `${id} user headers of ${p.name}`);
      problem(await callOp(op, { headers: { authorization: 'Bearer test' } }), 401, 'UNAUTHENTICATED', `${id} Authorization: Bearer test`);
    });

    // SEC-VALID: one invalid variant per case, the allowed person.
    /** @type {[string, Record<string, any>, (v: any) => object][]} */
    const parts = [
      ['path', op.schemas.params, (v) => ({ params: v })],
      ['query', op.schemas.query, (v) => ({ query: v })],
      ...(op.schemas.body ? /** @type {[string, Record<string, any>, (v: any) => object][]} */ ([['body', op.schemas.body, (v) => ({ body: v })]]) : []),
    ];
    for (const [part, schema, place] of parts) {
      const text = part !== 'body';
      for (const v of invalidValues(schema, text)) {
        // A missing path parameter changes the route (404): outside SEC-VALID.
        if (part === 'path' && v.what.endsWith(' missing')) continue;
        add('SEC-VALID', `${id} ${part} ${v.what}`, async () => {
          problem(await callOp(op, { ...place(v.value), cookie: await cookieOf(allowed(op)) }), 400, 'VALIDATION_FAILED', `${id} ${part} ${v.what}`);
        });
      }
    }

    if (op.schemas.body) {
      for (const key of MASS_KEYS) {
        add('SEC-MASS', `${id} + ${key}`, async () => {
          const body = { .../** @type {object} */ (valid(op).body), [key]: key === 'deleted_at' ? '2026-01-01T00:00:00Z' : true };
          problem(await callOp(op, { body, cookie: await cookieOf(allowed(op)) }), 400, 'VALIDATION_FAILED', `${id} + ${key}`);
        });
      }
      add('SEC-ERR', `${id} unreadable JSON`, async () => {
        const r = await callOp(op, { raw: '{"kit":', cookie: await cookieOf(allowed(op)) });
        problem(r, 400, null, `${id} unreadable JSON`);
        noLeak(r, id);
      });
    }

    // SEC-UPLOAD: what the core refuses before the handler; a valid file stored and downloaded as an attachment is
    // the tool's own test (it needs a real resource).
    if (op.upload) {
      const { types, maxBytes } = op.upload;
      const type = /** @type {string} */ (types[0]);
      /** @type {[string, { type: string, body: Buffer } | undefined, string|undefined, number, string][]} */
      const sends = [
        ['HTML page as text/html', { type: 'text/html', body: Buffer.from('<!doctype html><script>alert(1)</script>') }, undefined, 415, 'UNSUPPORTED_MEDIA_TYPE'],
        ['SVG with a script', { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }, undefined, 415, 'UNSUPPORTED_MEDIA_TYPE'],
        ['JSON body', undefined, '{"kit":true}', 415, 'UNSUPPORTED_MEDIA_TYPE'],
        ...types.map((t) => /** @type {[string, { type: string, body: Buffer }, undefined, number, string]} */ ([`HTML content declared ${t}`, { type: t, body: Buffer.from('<html><script>alert(1)</script></html>') }, undefined, 415, 'FILE_TYPE_MISMATCH'])),
        [`empty ${type}`, { type, body: Buffer.alloc(0) }, undefined, 400, 'FILE_REQUIRED'],
        [`${type} of ${maxBytes + 1} bytes`, { type, body: exampleFile(type, maxBytes + 1) }, undefined, 413, 'PAYLOAD_TOO_LARGE'],
      ];
      for (const [what, f, raw, status, code] of sends) {
        add('SEC-UPLOAD', `${id} ${what}`, async () => {
          problem(await callOp(op, { ...(f ? { file: f } : { raw }), cookie: await cookieOf(allowed(op)) }), status, code, `${id} ${what}`);
        });
      }
    }

    // SEC-CSRF: the session is valid, only the origin (or the static header) is missing.
    /** @type {[string, Record<string, string|null>][]} */
    const refusals = [];
    if (isFile(op)) refusals.push(['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }], ['Sec-Fetch-Site: none', { 'sec-fetch-site': 'none' }], ['Sec-Fetch-Site missing', { 'sec-fetch-site': null }]);
    else {
      refusals.push(['no X-Requested-With', { 'x-requested-with': null }]);
      if (isWrite(op)) {
        refusals.push(
          ['foreign Origin without Sec-Fetch-Site', { 'sec-fetch-site': null, origin: 'https://evil.example' }],
          ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
          ['Sec-Fetch-Site: same-site', { 'sec-fetch-site': 'same-site' }],
          ['Sec-Fetch-Site: none', { 'sec-fetch-site': 'none' }],
        );
      }
    }
    for (const [what, e] of refusals) {
      add('SEC-CSRF', `${id} ${what}`, async () => problem(await callOp(op, { headers: e, cookie: await cookieOf(allowed(op)) }), 403, 'CSRF_BLOCKED', `${id} ${what}`));
    }

    // SEC-RATE: limit + 5 simultaneous valid requests (spread by Caddy over the instances).
    const limit = op.rateLimit ?? (op.method === 'GET' ? READ_RATE : DEFAULT_RATE);
    add('SEC-RATE', `${id} (${limit}/min)`, async () => {
      const cookie = await cookieOf(allowed(op));
      // Fixed one-minute window: never fire the burst across two windows.
      if (Date.now() % 60_000 > 55_000) await wait(60_100 - (Date.now() % 60_000));
      const rs = await Promise.all(Array.from({ length: limit + 5 }, () => callOp(op, { cookie })));
      const refused = rs.filter((r) => r.status === 429);
      assert.equal(refused.length, 5, `${id}: ${refused.length} 429 answers out of ${limit + 5} (5 expected); statuses: ${rs.map((r) => r.status).join(' ')}`);
      for (const r of refused) {
        problem(r, 429, 'RATE_LIMITED', id);
        assert.match(r.headers.get('retry-after') ?? '', /^[1-9]\d*$/, `${id}: Retry-After integer > 0`);
      }
    });
  }

  // SEC-ERR: unknown route, forced failures named by the bench.
  add('SEC-ERR', 'unknown route', async () => {
    const r = await call(o.base, { path: '/api/kit-nonexistent-route' });
    problem(r, 404, null, 'unknown route');
    noLeak(r, 'unknown route');
  });
  for (const e of o.failures ?? []) {
    const op = contract.operations.find((x) => x.operationId === e.operationId) ?? assert.fail(`failures: ${e.operationId} missing from the contract`);
    add('SEC-ERR', `${op.operationId} forced failure`, async () => {
      const r = await callOp(op, { ...e, cookie: await cookieOf(allowed(op)) });
      problem(r, 500, null, `${op.operationId} forced failure`);
      assert.match(String(r.json?.error_id), /^[0-9a-f-]{36}$/, 'error_id expected');
      noLeak(r, op.operationId);
    });
  }

  // SEC-STATIC: nothing of the tool or of the package outside `web/` is served.
  const list = (/** @type {string} */ d) => (existsSync(join(root, d)) ? readdirSync(join(root, d), { recursive: true, encoding: 'utf8' }).filter((f) => f.includes('.')).slice(0, 3).map((f) => `/${d}/${f}`) : []);
  const statics = [
    '/package.json', '/pnpm-lock.yaml', '/Dockerfile', '/AGENTS.md', '/.git/HEAD', '/.env', '/openapi.yaml', '/docs/contract/openapi.yaml',
    ...contract.operations.map((op) => `/api/${op.operationId}.js`), ...list('db'), ...list('tests'), ...list('api'),
    '/web/index.html', '/node_modules/@eupadev/core/package.json', '/core/package.json', '/core/src/http.js',
    '/%2e%2e%2fpackage.json', '/core/%2e%2e%2fpackage.json', '/core/vendor/%2e%2e%2f%2e%2e%2fpackage.json', '/..%2fopenapi.yaml',
  ];
  add('SEC-STATIC', `${statics.length} paths`, async () => {
    for (const c of statics) problem(await call(o.base, { path: c }), 404, null, c);
  });
  return cases;
}
