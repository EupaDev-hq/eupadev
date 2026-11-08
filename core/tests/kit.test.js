// Proof of the kit (step 7): the stack of kit/compose.test.yml (example tool ×2 behind Caddy, PostgreSQL,
// real Keycloak), the twelve SEC-* generated from the example's contract, all green; then the deliberate
// mutations of the core (a copy of src/ mounted in place of the original in the two instances), each killed by the
// expected SEC-*. Docker is required; Caddy listens on port 3000 (addresses of the test realm). KIT_KEEP=1 leaves
// the stack running at the end.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { chromium } from 'playwright';
import { anonymous, callFrom, twoUsers } from '../kit/two-users.js';
import { signIn, httpBrowser } from '../kit/index.js';
import { argsK6, argsSchemathesis } from '../kit/test-tools.js';
import { readRealm } from '../kit/realm.js';
import { generateCases } from '../kit/sec.js';
import { EXAMPLE } from './helpers/server.js';
import { TRAPS } from './example/api/lib/store.js';

const BASE = 'http://localhost:3000';
const COMPOSE = fileURLToPath(new URL('../kit/compose.test.yml', import.meta.url));

/** The three people of the realm and their roles of the `trial-tool` client, read from the realm (not copied). */
const { people: PEOPLE, secret: SECRET } = readRealm();

/**
 * `docker compose` on the kit's stack; `CORE_SRC` replaces src/ in the tool's instances (mutations).
 * @param {string[]} args @param {{ src?: string }} [o]
 */
function compose(args, o = {}) {
  return execFileSync('docker', ['compose', '-f', COMPOSE, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1e9,
    env: { ...process.env, OIDC_CLIENT_SECRET: SECRET, ...(o.src ? { CORE_SRC: o.src } : {}) },
  }).trim();
}

/** @type {pg.Client} */ let admin;
const options = {
  contract: `${EXAMPLE}openapi.yaml`, base: BASE, people: PEOPLE, inactivityMinutes: 30,
  reset: async () => { await admin.query('DELETE FROM app.rate_limits'); },
  failures: [{ operationId: 'getItem', params: { id: TRAPS.exception } }],
};

before(async () => {
  compose(['up', '-d', '--wait', '--wait-timeout', '300']);
  const port = compose(['port', 'postgres', '5432']).split(':').pop();
  admin = new pg.Client({ connectionString: `postgres://postgres:test-admin@127.0.0.1:${port}/example` });
  await admin.connect();
});
after(async () => {
  await admin?.end();
  if (process.env.KIT_KEEP !== '1') compose(['down', '-v', '--remove-orphans']);
});

test('people read from the test realm', () => {
  assert.deepEqual(PEOPLE.map((p) => [p.name, p.roles]), [['alice', ['reader']], ['bruno', ['manager']], ['chloe', ['manager', 'admin']]]);
});

describe('kit green on the example tool (production posture, two instances)', () => {
  const cases = generateCases(options);
  test('the twelve SEC-* are generated', () => {
    assert.deepEqual([...new Set(cases.map((c) => c.sec))].sort(), ['SEC-AUTH', 'SEC-BYPASS', 'SEC-COOKIE', 'SEC-CSRF', 'SEC-ERR', 'SEC-HEAD', 'SEC-MASS', 'SEC-RATE', 'SEC-ROLE', 'SEC-STATIC', 'SEC-UPLOAD', 'SEC-VALID']);
  });
  for (const c of cases) test(c.name, c.verify);
});

describe('two-user helpers (isolated Playwright contexts, real Chromium)', () => {
  /** @type {import('playwright').Browser} */ let browser;
  before(async () => { browser = await chromium.launch(); });
  after(async () => { await browser?.close(); });
  const person = (/** @type {string} */ name) => PEOPLE.find((p) => p.name === name) ?? assert.fail(name);

  test('bruno and alice signed in each in their own context: distinct sessions, each one\'s rights; an anonymous user has nothing', async () => {
    const { a, b } = await twoUsers(browser, BASE, person('bruno'), person('alice'));
    const token = async (/** @type {import('playwright').BrowserContext} */ c) => (await c.cookies(BASE)).find((x) => x.name === '__Host-session')?.value;
    const [ta, tb] = [await token(a), await token(b)];
    assert.ok(ta && tb && ta !== tb, 'two distinct sessions');
    assert.equal((await callFrom(a, BASE, 'POST', '/api/items', { name: 'from bruno' })).status, 201);
    const refusal = await callFrom(b, BASE, 'POST', '/api/items', { name: 'from alice' });
    assert.equal(refusal.status, 403);
    assert.equal(refusal.json?.code, 'FORBIDDEN');
    assert.equal((await callFrom(b, BASE, 'GET', '/api/items')).status, 200);
    const stranger = await anonymous(browser);
    assert.equal((await callFrom(stranger, BASE, 'GET', '/api/items')).status, 401);
    // SEC-URL: the export link pasted in a stranger's address bar (navigation Sec-Fetch-Site: none).
    const page = await stranger.newPage();
    assert.equal((await page.goto(`${BASE}/files/items.csv`))?.status(), 403);
    for (const c of [a, b, stranger]) await c.close();
  });
});

describe('external tools: static headers and session passed on', () => {
  const CORE = fileURLToPath(new URL('../', import.meta.url));
  const logs = () => compose(['logs', '--no-log-prefix', 'tool-1', 'tool-2']).split('\n');
  const count = () => {
    const l = logs();
    return { api: l.filter((x) => x.includes('"msg":"request"') && /"url":"\/(api|files)\//.test(x)).length, csrf: l.filter((x) => x.includes('"event":"csrf_blocked"')).length };
  };
  /** @param {string[]} args */
  const docker = (args) => {
    try { return { code: 0, output: execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) {
      const x = /** @type {{ status: number, stdout: string }} */ (e);
      return { code: x.status, output: String(x.stdout) };
    }
  };
  /** Sessions of the three people of the realm (k6: one VU per person); Schemathesis takes chloe's. @type {string[]} */
  const cookies = [];
  let cookie = '';
  before(async () => {
    for (const p of PEOPLE) {
      const client = httpBrowser();
      await signIn(client, BASE, p);
      cookies.push(client.cookies('localhost'));
      if (p.name === 'chloe') cookie = client.cookies('localhost');
    }
  });

  // Schemathesis's findings on the example (undeclared 4xx codes, traps) are not judged here (step 8): all that
  // counts is that its requests pass the CSRF rule, and that they no longer pass it without the static header.
  test('Schemathesis: no request refused by the CSRF rule; with a wrong X-Requested-With, refused', async () => {
    const contract = `${EXAMPLE}openapi.yaml`;
    await options.reset();
    let prior = count();
    const r = docker(argsSchemathesis({ contract, base: BASE, cookie, options: ['--max-time', '15'] }));
    let later = count();
    assert.ok(later.api - prior.api > 50, `Schemathesis sent few requests (${later.api - prior.api}):\n${r.output.slice(-2000)}`);
    assert.equal(later.csrf - prior.csrf, 0, 'requests of Schemathesis refused by the CSRF rule');
    prior = later;
    docker(argsSchemathesis({ contract, base: BASE, cookie, headers: { 'x-requested-with': 'other' }, options: ['--max-time', '5'] }));
    later = count();
    assert.ok(later.csrf - prior.csrf > 10, `without the static header, Schemathesis should be refused (${later.csrf - prior.csrf} refusals)`);
  });

  test('k6: one VU per person of the realm (K4), 3 × 15 GET /api/items at 200 with no exemption from the rate limit', async () => {
    await options.reset();
    const r = docker(argsK6({ base: BASE, cookies, dir: CORE, script: 'tests/kit-load.k6.js', options: ['--quiet'] }));
    assert.equal(r.code, 0, r.output.slice(-3000));
    assert.match(r.output, /http_reqs\D+45\b/, 'forty-five requests');
  });
});

/**
 * Deliberate mutations ("proof of the kit"): a text replacement in a copy of src/ (and a second one, `then`,
 * when needed), each `before` present exactly once in the original (otherwise the mutation is stale and the test
 * fails).
 * @type {{ sec: string, name: string, file: string, before: string, after: string, then?: [string, string, string] }[]}
 */
const MUTATIONS = [
  { sec: 'SEC-AUTH', name: 'route without guard (read served without a session)', file: 'http.js',
    before: 'const s = await session(req, reply);',
    after: "const s = (await session(req, reply)) ?? (op.method === 'GET' ? { actorId: '00000000-0000-0000-0000-000000000000', roles: op.roles } : null);" },
  { sec: 'SEC-ROLE', name: 'role not checked', file: 'http.js',
    before: 'if (!op.roles.some((r) => s.roles.includes(r)))', after: 'if (false)' },
  { sec: 'SEC-VALID', name: 'body types converted (coerceTypes)', file: 'validation.js',
    before: "coerceTypes: coerce ? 'array' : false", after: "coerceTypes: 'array'" },
  { sec: 'SEC-MASS', name: 'unknown key silently removed (removeAdditional)', file: 'validation.js',
    before: 'removeAdditional: false', after: 'removeAdditional: true' },
  { sec: 'SEC-CSRF', name: 'static header no longer required', file: 'protections.js',
    before: "if (api && req.headers['x-requested-with'] !== STATIC_HEADER_VALUE) throw refuse(req, 'x-requested-with');", after: '' },
  { sec: 'SEC-HEAD', name: 'X-Frame-Options removed', file: 'http.js', before: "'x-frame-options': 'DENY',", after: '' },
  { sec: 'SEC-HEAD', name: 'IdP origin missing from form-action (sign-out blocked by Chromium)', file: 'http.js',
    before: 'const headers = securityHeaders(o.auth?.idpOrigin);', after: 'const headers = SECURITY_HEADERS;' },
  { sec: 'SEC-COOKIE', name: 'session cookie without __Host-', file: 'sessions.js',
    before: "SESSION_COOKIE = '__Host-session'", after: "SESSION_COOKIE = 'session'" },
  { sec: 'SEC-RATE', name: 'rate limit inoperative', file: 'rate-limit.js', before: 'if (n > threshold) {', after: 'if (false) {' },
  { sec: 'SEC-RATE', name: 'counter per instance (in memory) instead of the database', file: 'rate-limit.js',
    before: 'const n = Number(r.rows[0]?.count);',
    after: 'const m = (globalThis.__counters ??= new Map()); const k = `${key}@${start.getTime()}`; m.set(k, (m.get(k) ?? 0) + 1); const n = m.get(k);' },
  { sec: 'SEC-ERR', name: 'internal message returned in a 500', file: 'errors.js',
    before: "'An unexpected error occurred'", after: 'String(err instanceof Error ? err.stack : err)' },
  { sec: 'SEC-STATIC', name: 'static files served from the tool\'s root', file: 'http.js',
    before: 'const table = buildStatic(o.web);', after: 'const table = buildStatic(`${o.web}/..`);',
    // otherwise the core already refuses to start (openapi.yaml, *.sql: extensions not served)
    then: ['static.js', 'if (!(extname(name).toLowerCase() in TYPES)) throw', 'if (!(extname(name).toLowerCase() in TYPES)) continue; if (0) throw'] },
  { sec: 'SEC-UPLOAD', name: 'file signature not checked', file: 'http.js',
    before: 'return sig !== undefined && body.length >= sig.length && sig.every((b, i) => body[i] === b);', after: 'return true;' },
  { sec: 'SEC-UPLOAD', name: 'x-max-bytes not applied', file: 'http.js',
    before: '{ bodyLimit: op.upload.maxBytes, config:', after: '{ config:' },
  { sec: 'SEC-BYPASS', name: 'test header honoured', file: 'http.js',
    before: 'const session = o.auth?.session ?? o.session ?? (async () => null);',
    after: "const real = o.auth?.session ?? o.session ?? (async () => null); const session = async (req, reply) => (typeof req.headers['x-test-session'] === 'string' ? { actorId: '00000000-0000-0000-0000-000000000001', roles: [req.headers['x-test-session']] } : real(req, reply));" },
];

describe('deliberate mutations, each killed by the expected SEC-*', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const COPY = fileURLToPath(new URL('./tmp-mutation/', import.meta.url));
  after(() => {
    compose(['up', '-d', '--wait', '--no-deps', '--force-recreate', 'tool-1', 'tool-2']);
    rmSync(COPY, { recursive: true, force: true });
  });
  for (const m of MUTATIONS) {
    test(`${m.name} → ${m.sec}`, async (t) => {
      rmSync(COPY, { recursive: true, force: true });
      cpSync(SRC, COPY, { recursive: true });
      /** @type {[string, string, string][]} */
      const changes = [[m.file, m.before, m.after], ...(m.then ? [m.then] : [])];
      for (const [file, from, to] of changes) {
        const text = readFileSync(`${COPY}${file}`, 'utf8');
        assert.equal(text.split(from).length, 2, `stale mutation: "${from}" missing or duplicated in src/${file}`);
        writeFileSync(`${COPY}${file}`, text.replace(from, () => to));
      }
      compose(['up', '-d', '--wait', '--no-deps', '--force-recreate', 'tool-1', 'tool-2'], { src: COPY });
      /** @type {Map<string, string[]>} */
      const failures = new Map();
      for (const c of generateCases(options)) {
        try { await c.verify(); } catch (e) {
          failures.set(c.sec, [...(failures.get(c.sec) ?? []), `${c.name}: ${String(e instanceof Error ? e.message : e).split('\n')[0]}`]);
        }
      }
      t.diagnostic(`failing SEC-*: ${[...failures].map(([sec, l]) => `${sec} (${l.length})`).join(', ') || 'none'}`);
      assert.ok(failures.has(m.sec), `surviving mutation: ${m.sec} stays green`);
      t.diagnostic(`first ${m.sec} failure: ${failures.get(m.sec)?.[0]}`);
    });
  }
});
